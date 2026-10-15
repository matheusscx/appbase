# Boletas con problemas en el SII: verlas y avisar — diseño

**Subproyecto 4, frente 3** del emisor SII propio
([`emision-electronica.md`](../../features/emision-electronica.md)). Fiscal: frente propio
(ADR-010, `CLAUDE.md`). Diseño aprobado por el owner el 2026-10-15, por AskUserQuestion, después
de la [investigación](../../agent/investigaciones/2026-10-15-boleta-rechazada-o-atrasada.md).

## 1. Qué resuelve

Hoy una boleta que el SII rechazó, que lleva más de una hora sin llegar o que volvió con reparos
**solo queda en la base**: nadie se entera. Este frente la hace visible al admin del local, al
cajero (como aviso) y a soporte (el superadmin), y arregla dos fallas de la cola que harían
mentir a esa pantalla.

**No incluye** (decisión del owner): **reemitir** una rechazada. El SII no publica qué pasa con el
folio de una boleta ya rechazada ni con qué fecha sale la de reemplazo (preguntas 1 y 2 de la
investigación); hasta que conteste, la pantalla dice *"no la vuelvas a emitir: escribe a soporte"*.
Tampoco: el aviso por correo, la salida de una `sin_emitir` del grupo `boleta` (sigue siendo
anular la venta) y la nota de crédito electrónica (frente 2, en pausa).

## 2. Decisiones del owner (2026-10-15, AskUserQuestion)

| Pregunta | Elegido | Descartado |
|---|---|---|
| Alcance con el folio y la fecha del reemplazo sin respuesta | La parte visible ahora; reemitir después | Reemitir con supuestos; pausar el frente |
| Los códigos `RLV` y `DOK` por boleta | Leerlos según el OpenAPI del SII | Dejarlos como desconocidos |
| El sobre que el SII rechaza entero por una boleta mala | Revisar cada boleta contra el esquema antes de enviar | Reenviar las buenas de a una; dejarlo |
| El validador (`xmllint-wasm` 5.3.0) a producción, y dónde | Sí, en el job de envío | En la venta; en los dos; no llevarlo |
| Dónde avisar, además de la pantalla del admin | Franja del cajero **y** panel del superadmin | Solo la pantalla del admin |
| Las boletas con reparos en la lista | Sí, las de los últimos 30 días | Solo atrasadas y rechazadas |

## 3. Leer bien lo que contesta el SII (`resultado-sii.ts`)

El OpenAPI de la API de boletas (v1.0.5,
`ResultadoEnvioDataRespuesta_detalle_rep_rech.estado`) define **cuatro** estados por boleta:
`DOK` (aceptado), `RPR` (aceptado con reparos), `RLV` (aceptado con reparos leves) y `RCH`
(rechazado). Hoy `repartirResultado` entiende solo `RCH` y `RPR`: una entrada `RLV` o `DOK` cuenta
como código desconocido, la boleta queda `enviado` para siempre y se vería **atrasada** aunque el
SII la aceptó (verificado contra el OpenAPI publicado, 2026-10-15).

- **`RLV` → `reparos`**, con la entrada en `detalle_sii`, igual que `RPR`.
- **`DOK` → `aceptado`**, con `detalle_sii` null, igual que la ausencia de entrada.
- **Prioridad cuando una boleta trae varias entradas:** `RCH` > `RPR`/`RLV` > `DOK`. Manda la peor,
  como hoy.
- **`DOK` y `RLV` dejan de ser observaciones.** La regla del owner del 2026-10-14 sigue intacta para
  todo lo demás: un código que no está en esa lista nunca acepta ni rechaza una boleta, y las que
  no tienen entrada propia no se dan por aceptadas si hubo cualquier observación.
- El estado del **envío** no cambia: su enum (`EPR`, `RPR`, `RCH`, …) no trae `RLV` ni `DOK`.

## 4. Revisar cada boleta antes de enviarla (job de envío)

Una boleta mal formada hace que el SII rechace el sobre entero (`RSC`), y hoy eso marca
`rechazado` a las 50 que iban en él. Desde este frente el job **valida el sobre contra el esquema
antes de mandarlo**, y la boleta mala no sale.

- **El esquema:** el mismo que usan las pruebas, `esquemas/EnvioBOLETA_v11_formato42.xsd` con
  `xmldsignature_v10.xsd`, con la única corrección en memoria que ya hacen las pruebas (el
  `PctType` de 0,00 a 0,01, que libxml2 no compila). La lectura y la validación pasan del
  fixture de pruebas a código de producción en `dte/` (un solo lugar; las pruebas lo importan de
  ahí). `xmllint-wasm` pasa de `devDependencies` a `dependencies`, con la misma versión fija.
- **El flujo**, después de `armarEnvioBoleta` y antes de `cliente.enviar`:
  1. se valida el sobre firmado. Si pasa, sigue como hoy;
  2. si no pasa, se valida **cada `<DTE>`** del sobre envuelto en un `EnvioBOLETA` con la misma
     carátula y la firma del sobre real (el XSD mira la forma de la firma, no la verifica);
  3. las boletas que fallan solas pasan a `rechazado` con
     `detalle_sii = { origen: 'esquema', errores: [...] }` (los mensajes de xmllint, recortados) y
     no entran a ningún sobre;
  4. las demás **vuelven a la cola sin espera ni intento sumado** y salen en el próximo sobre;
  5. si **ninguna** falla sola, el error está en el sobre mismo (la carátula): todas pasan a
     `rechazado` con `origen: 'esquema'`. Es un error nuestro, como el 400 del envío, y
     reintentarlo repetiría el error.
- El envío que no salió no existió para el SII: se descarta como hoy un sobre que nunca se mandó.
- **Costo medido:** ~33 ms por validación (casi todo es compilar el esquema), en el job, no en la
  venta. Un sobre que pasa cuesta una validación; uno que falla, 1 + N.
- **Riesgo:** se valida contra **nuestra** copia del esquema, con los cinco campos del formato v4.2
  que el v11 del SII no trae. Si la copia está mal, rechazaríamos boletas que el SII aceptaría.
  Es la misma copia contra la que pasan todas las pruebas del motor.

## 5. Qué es cada grupo

Se calcula al leer, nunca se guarda. Todas las consultas filtran `eliminado_el IS NULL` en
`dte_documentos`, `venta_documentos` y `ventas`.

| Grupo | Condición en `dte_documentos` |
|---|---|
| **Atrasada** | `estado IN ('pendiente','enviado') AND emitido_el < now() - interval '1 hour'` (la consulta que ya fija un e2e del subproyecto 3) |
| **Rechazada** | `estado = 'rechazado'` |
| **Con reparos** | `estado = 'reparos' AND emitido_el >= now() - interval '30 days'` |

"Con problemas", lo que cuentan el aviso del cajero y el panel de soporte, es **atrasada o
rechazada**. Con reparos es válida y no avisa.

**Índice nuevo**, porque el conteo del cajero corre después de cada cobro: parcial en
`dte_documentos (tenant_id, emitido_el)` con
`WHERE estado IN ('pendiente','enviado','rechazado') AND eliminado_el IS NULL`, con su migración
(ADR-030). La lista de reparos usa el mismo `tenant_id` y es solo del admin. Y un segundo índice,
parcial, en `venta_documentos (dte_documento_id) WHERE dte_documento_id IS NOT NULL`: el cruce de
la boleta con su venta (§ 6) no tiene hoy ninguno.

## 6. La tarjeta del admin

**Ruta:** `GET /dte/boletas-con-problemas`, con `TenantAdminGuard`, como las otras de
configuración del módulo. `tenant_id` del token.

**Respuesta:** `{ atrasadas: Fila[], rechazadas: Fila[], conReparos: Fila[] }`, hasta 200 filas
por grupo: atrasadas y rechazadas de la más vieja a la más nueva; reparos de la más nueva a la más
vieja. Cada `Fila`:

```ts
{
  documentoId: string        // dte_documentos
  ventaId: string | null     // la venta, para el enlace al detalle
  tipo: 39 | 41
  folio: number
  emitidaEl: string          // emitido_el
  monto: string | null       // venta_documentos.monto: lo que cubre la boleta, en moneda oficial
  motivo: string | null      // en palabras del local, ver abajo
}
```

**Una consulta por grupo** (tres, fijas), cada una con `LEFT JOIN` a `venta_documentos` (por
`dte_documento_id`) y a `ventas`: nunca una consulta por fila.

**El motivo**, armado en el service desde `detalle_sii` y `ultimo_error`:

| Origen | Texto |
|---|---|
| `origen: 'esquema'`, `'sobre'` o `'envio'` | *"Error del sistema al enviarla al SII."* |
| Entrada `RCH` del SII | *"El SII la rechazó: {descripción del primer error}."* (si no hay error, la descripción de la entrada) |
| Entrada `RPR`/`RLV` | *"El SII avisa: {descripción del primer error}."* |
| Atrasada | `null` (la pantalla pone su texto fijo). Si la boleta tiene `ultimo_error`, va ese |

**La pantalla** (`configuracion/boleta-electronica.vue`): una tarjeta *"Boletas con observaciones
del SII"* debajo de la de pendientes, con los tres grupos (vacíos no se muestran; todos vacíos
muestra *"No hay boletas con observaciones"*). Cada fila: fecha, folio, tipo, monto, motivo y enlace
a la venta. Texto fijo por grupo:

- **Atrasadas:** *"El sistema la sigue enviando; no tienes que hacer nada. Si pasa de un día,
  escribe a soporte con el folio."*
- **Rechazadas:** *"No la vuelvas a emitir: escribe a soporte con el folio."*
- **Con reparos:** *"Es válida. Revisa el aviso del SII para corregirlo en las próximas
  boletas."*

## 7. La franja del cajero

`GET /dte/estado-emision` (`Ventas:Crear`) suma `conProblemas: number`, el conteo de atrasadas y
rechazadas del tenant. Va en **la misma consulta** que hoy cuenta las `sin_emitir` (dos subselects
en un `SELECT`), así que no suma una ida a la base. Con la emisión apagada sigue siendo una sola
consulta al interruptor y devuelve `conProblemas: 0`.

`FranjaEmision.vue` (POS, salones y drawer) muestra, si `conProblemas > 0`:
*"Hay {n} boleta(s) con problemas en el SII: avisa al encargado."* (singular y plural bien
escritos; "encargado" es el sufijo que ya usan los otros avisos de la franja). Las boletas con
reparos no cuentan.

## 8. El panel de soporte (superadmin)

**Ruta:** `GET /admin/dte/boletas-con-problemas`, con `JwtAuthGuard` + `SuperadminGuard`, como
`/admin/tenants`. Es la única lectura del frente que cruza tenants, y es justamente lo que
distingue al eje superadmin; no recibe `tenant_id` de ningún lado.

**Respuesta:** hasta 200 filas, atrasadas y rechazadas de **todos** los tenants, de la más vieja a la
más nueva. Cada fila: `tenantId`, nombre del tenant, razón social, ambiente, tipo, folio,
`emitidaEl`, `grupo` (`'atrasada'` | `'rechazada'`), `intentos`, `ultimoError` y `detalleSii`
**completo** (soporte necesita lo técnico). Una consulta, con `JOIN` a `tenants` y a la razón social.

**La pantalla:** `pages/admin.vue` deja de ser "próximamente" y muestra la tarjeta *"Boletas con
problemas en el SII"* con esa tabla; el detalle de cada fila se despliega. Si no hay ninguna,
*"Ningún local tiene boletas con problemas."*.

## 9. Pruebas

- **Unitarias**:
  - `repartirResultado` con `DOK`, `RPR`, `RLV` y `RCH`; la prioridad entre varias entradas; y un
    código desconocido que sigue sin aceptar nada;
  - la validación: un sobre bueno pasa; un `<DTE>` roto lo detecta envuelto solo;
  - el job: un sobre con una boleta rota y dos buenas deja la rota `rechazado` (origen
    `esquema`), las buenas en la cola sin intento sumado, y no llama al cliente del SII con la rota;
    un sobre roto por la carátula rechaza todas;
  - el armado del motivo, una fila por origen.
- **e2e contra Postgres:**
  - la ruta del admin, con un caso de cada grupo, una con reparos de hace 31 días que no aparece,
    una borrada que no aparece, y la de otro tenant que no aparece;
  - el `conProblemas` de `estado-emision` (cuenta atrasadas y rechazadas, no reparos; 0 con la
    emisión apagada);
  - la ruta de soporte: 403 a un admin común, ve dos tenants, no ve lo borrado;
  - los 403 de la ruta del admin para un cajero.
- **Playwright:** la tarjeta del admin, la franja con el aviso nuevo, y el panel de soporte como
  superadmin. Playwright no llega a la base y no hay SII de verdad, así que las respuestas de las
  dos rutas se simulan con `page.route` (como los specs de nota de crédito); el contrato real lo
  fijan los e2e de API, que sí recorren el job.
- **Mutantes** (revertidos con `cp` y `cmp`): `RLV` leído como desconocido, la ventana de 30 días
  quitada, el conteo del cajero sumando reparos, el guard del superadmin quitado, y la validación
  saltada en el job.

## 10. Documentación

`emision-electronica.md` (§ Envío al SII: los cuatro estados por boleta y la validación previa;
una sección nueva para la lista, la franja y el panel; "Lo que queda abierto"), `ESTADO.md`,
`desarrollo-nuevo.md` (frente 3 cerrado; reemitir queda abierto con su pregunta al SII),
`startup-pos.sql` (el índice) y, si cambia la convención del panel, `ARCHITECTURE.md`.

## 11. Lo que queda abierto

- **Reemitir una rechazada** espera la respuesta del SII (folio y fecha del reemplazo).
- **Una rechazada no tiene salida** todavía, así que mantiene la franja del cajero arriba hasta
  que exista reemitir: es el costo de avisar sin poder resolver.
- **Una `sin_emitir` del grupo `boleta`** sigue sin salida salvo anular la venta.
- **La copia del esquema** (formato v4.2) es nuestra; si está mal, la validación rechazaría boletas
  buenas. Solo lo confirma la certificación.
- **Cómo declara el IVA** el local con una boleta rechazada o atrasada es pregunta para el contador
  (pregunta 9 de la investigación).
