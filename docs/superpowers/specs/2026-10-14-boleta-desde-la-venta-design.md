# La venta emite la boleta electrónica

**Fecha:** 2026-10-14 · **Tipo:** spec de diseño · **Fiscal: frente propio** (`CLAUDE.md`, ADR-010)
**Subproyecto 4 de 6** del emisor de DTE propio, **frente 1 de 3**. **Status:** Draft, a revisión del owner.
**Se apoya en:** el perfil fiscal, el motor y la cola de envío, ya desplegados
([`features/emision-electronica.md`](../../features/emision-electronica.md), [ADR-033](../../adr/033-emisor-dte-propio.md)),
y en los documentos de la venta ([ADR-028](../../adr/028-emision-registrada-por-venta.md),
[`features/ventas.md`](../../features/ventas.md)).

---

## 0. Cómo se decidió

El owner eligió cada punto el 2026-10-14, en la sesión de brainstorming: las preguntas fueron por
AskUserQuestion con el costo de cada opción, y las tres secciones de diseño las aprobó en el chat.

| Decisión | Elegida | Descartada, y por qué |
|---|---|---|
| Alcance del subproyecto 4 | **Tres frentes**: (1) la venta emite la boleta, (2) anular y la NC electrónica, (3) la pantalla de atrasadas y rechazadas | Todo junto: la NC electrónica (tipo 61) es otro documento y otro canal del SII, y nada saldría hasta tener todo |
| Si la boleta no se puede emitir al cobrar | **La venta entra y la boleta queda "sin emitir"**, para emitirla después | Frenar el cobro (era la recomendada): el local no vende hasta arreglar el perfil |
| Cómo empieza a emitir un local | **Un interruptor** que solo prende con el perfil completo | Automático con el perfil completo: un CAF de prueba haría emitir boletas reales |
| Pago mixto (parte con la máquina) | **Una línea por el saldo**, con los montos que la venta ya congeló | Todas las líneas con un descuento global (le informa al SII un descuento que no hubo); líneas a prorrata (cantidades que no existen) |
| NC sobre una boleta ya emitida, mientras no exista el frente 2 | **Se registra como hoy y queda marcada "NC electrónica pendiente"**; la venta emitida ya no se anula | Bloquear la NC: el local no podría devolver plata ni stock |
| Fecha de una boleta emitida después | **La de la venta** | La del día en que se emite: dice otro día y, si cruza el mes, otro período de IVA |
| Quién emite las pendientes | **El admin, con un botón** | Automático al arreglarse el perfil: un reintento que nadie ve (la app avisa y el usuario reintenta) |
| Nombres de ítem fuera de norma | **Se validan al crear y al editar**; no hay datos productivos, así que no hace falta otra guarda | Que el interruptor no prenda con nombres malos; usar el nombre de hoy del catálogo al emitir |
| Dónde se emite | **Al final de la transacción de la venta, detrás de un savepoint** (enfoque A) | B: emitir en una segunda transacción (cuatro caminos que deben acordarse, y una ventana entre las dos); C: siempre con un job (el ticket nunca lleva el folio) |
| La boleta de una venta que un descuento deja en $0 (decidida después de escribir la spec, mientras se armaba el plan) | **Se emite por $0, con el descuento**: el motor acepta `MntTotal` 0 solo si un descuento lo explica (Res. Ex. SII 60/2023; decisión del 2026-10-04 en ADR-028). El XSD lo admite (`MontoType` es `nonNegativeInteger`) | No emitirla y dejarla como documento interno: contradice la Res. 60/2023 |

### Confirmado en la revisión de esta spec

Dos puntos que el diseño necesitaba y no se preguntaron. Los decidió el agente y el owner los
aprobó con la spec:

- **El medio de pago de una boleta de más de 135 UF con varios pagos** (§ 4.3): el SII admite uno
  solo, y va el del pago de mayor monto de esa boleta.
- **El texto de la línea de saldo** (§ 4.2): "Saldo de la venta". Las ventas no tienen un número
  para la gente, así que no puede decir "Venta N° X".

---

## 1. Qué cambia para el local

- El admin carga el perfil (ya existe), prende **"Emitir boletas electrónicas"** y desde esa venta
  cada boleta del sistema sale con folio, timbrada, firmada y en la cola que la lleva al SII.
- El ticket dice **"BOLETA ELECTRÓNICA N° 1234"** y las leyendas del SII, en vez de "SIN VALIDEZ
  FISCAL".
- Si algo impide emitir (se acabaron los folios, venció el certificado), **la venta entra igual**,
  el cajero ve por qué y el admin la emite después con un botón, con la fecha de la venta.
- El cajero ve una franja cuando quedan pocos folios, el certificado está por vencer o hay boletas
  sin emitir.
- La pantalla de boleta electrónica la ven todos los admin, no solo el superadmin.

Con el interruptor apagado (el default), **nada cambia**: todo queda como hoy.

## 2. Alcance

**Incluido:**

- La validación del nombre del ítem en el catálogo (80 caracteres, ISO-8859-1).
- El interruptor por tenant.
- La emisión de la boleta del sistema (39 o 41) dentro de la transacción de la venta, para todos
  los caminos que crean ventas: POS, cierre de mesa, tienda online y suscripciones.
- El estado `sin_emitir` y el botón "Emitir pendientes".
- El ticket de una boleta emitida, sin emitir y de certificación, y su reimpresión.
- El aviso al cajero (ruta propia) y la pantalla abierta a todos los admin.
- La marca "NC electrónica pendiente" sobre la nota de crédito de una venta con boleta emitida.
- El proveedor de software (`RutProvSW` / `RznSocProvSW`) por variables de entorno.

**No incluido (cada cosa tiene su dueño):**

- La NC electrónica tipo 61 y su envío (frente 2 del subproyecto 4).
- La pantalla de atrasadas y rechazadas, y qué se hace con una rechazada (frente 3).
- La factura (33): un documento `sistema` de factura queda `armado`, como hoy; el motor no la arma.
- La certificación (subproyecto 5).
- El PDF417 en el papel: desde 2026 el timbre impreso es opcional
  ([investigación](../../agent/investigaciones/2026-10-13-emision-electronica-sii.md)).

## 3. Datos

### 3.1 El interruptor

`tenants.emite_boleta_electronica boolean NOT NULL DEFAULT false`.

- **Solo prende si `evaluarPerfil` no devuelve faltantes** (400 con la lista si los hay). Apagar
  no tiene condición.
- Ruta: `PATCH /dte/emision { activa: boolean }`, con `TenantAdminGuard` como el resto del perfil.
- La venta lo lee en la consulta que ya trae `t.facturador` (`ventas.service.ts`, la de la moneda
  oficial): sin una ida más a la base.
- Que el perfil deje de estar completo con el interruptor prendido (vence el certificado) **no lo
  apaga**: cada venta cae en `sin_emitir` con su motivo, que es lo que decidió el owner.

### 3.2 El proveedor de software

`DTE_PROVEEDOR_RUT` y `DTE_PROVEEDOR_RAZON_SOCIAL`, variables de entorno. Son de la empresa dueña
del SaaS y el esquema del SII las exige en cada boleta.

- **Sin ellas el backend arranca**: `evaluarPerfil` suma el faltante "falta el proveedor de
  software (configuración del sistema)", así que el interruptor no prende y una venta con el
  interruptor ya prendido cae en `sin_emitir` (`PERFIL_INCOMPLETO`).
- El RUT se valida con `rutValido`; uno inválido es el mismo faltante.
- Las carga el owner en Railway. En `.env.example` van vacías con un comentario; en el e2e,
  `setup-env.ts` les pone un valor de prueba.

### 3.3 El estado de la boleta del sistema

`venta_documentos.estado_envio` pasa de `('armado','enviado')` a **`('armado','sin_emitir','emitido')`**:

| Valor | Cuándo |
|---|---|
| `armado` | Lo de hoy: la factura, la NC, y toda boleta de un local con el interruptor apagado |
| `sin_emitir` | Una boleta del sistema que debía emitirse (interruptor prendido) y falló con un `DteError` |
| `emitido` | Tiene folio: está en `dte_documentos`, en la cola o ya en el SII |

- `enviado` no tiene escritor ni filas (ADR-028 lo reservó para esto) y sale del CHECK. Es
  `migration:generate` + el CHECK a mano (`migration:generate` no ve los CHECK).
- Columnas nuevas en `venta_documentos`:
  - `dte_documento_id uuid NULL`: la boleta de la cola. Con `emitido`, siempre; si no, nulo.
  - `emision_error_codigo text NULL` y `emision_error text NULL`: el `DteError` del último intento.
    Con `sin_emitir`, siempre; se limpian al emitir.
- CHECK: `estado_envio = 'emitido'` ⇔ `dte_documento_id IS NOT NULL`.
- El estado ante el SII (pendiente, enviado, aceptado, rechazado…) **no se copia**: se lee de
  `dte_documentos` por el `dte_documento_id`. Copiarlo abriría la ventana del dato copiado.
- Índice parcial para el botón y el aviso: `(tenant_id, creado_el) WHERE estado_envio = 'sin_emitir'
  AND descarte IS NULL AND eliminado_el IS NULL`.

### 3.4 El medio de pago para el SII

`metodos_pago.medio_pago_sii smallint NULL` (catálogo global, lo escribe solo el seeder), con los
códigos del formato v4.2 (`1` efectivo, `2` pago electrónico, `3` transferencia, `4` cheque,
`5` otro): Efectivo `1`, Tarjeta de débito y de crédito `2`, Transferencia bancaria `3`. Nulo se
manda como `5`. Solo se usa sobre 135 UF (§ 4.3).

## 4. La emisión

### 4.1 Una sola función emite

`EmisionBoletaService.emitir(tenantId, ventaDocumentoId)`, en el módulo `dte`. La llaman la venta y
el botón; no hay un segundo camino que pueda armar otra boleta.

1. **Lee de la base**, en consultas fijas (sin una por línea): el documento, su venta, las líneas
   (`venta_detalles`: `descripcion`, cantidad, precio, total de línea, clasificación), el customer
   (`venta_customer`), los pagos que cubre esa boleta y sus `medio_pago_sii`, los ajustes globales
   de la venta y el umbral de identidad. Dentro de la transacción de la venta ve lo que la venta
   acaba de escribir.
2. **Arma `DatosBoleta`** con una función pura, `datosBoletaDeVenta(...)` (§ 4.2–4.3).
3. `FoliosService.tomarFolio(tenantId, tipo)` → `{ cafId, folio }`.
4. `FoliosService.credencialesParaFirmar(tenantId, cafId, ahora)`.
5. `emitirBoleta(datos, credenciales, ahoraChile)` y `ColaDteService.encolar(tenantId, boleta, cafId)`.
6. Marca el documento `emitido`, con `dte_documento_id`, y limpia el error.

Corre siempre dentro de una transacción (falla si no hay una activa, como `tomarFolio` y `encolar`).

### 4.2 Qué boleta sale

- **Tipo:** 41 si todas las porciones del documento son exentas; 39 si no.
- **Fecha (`FchEmis`):** la fecha de la venta (`ventas.creado_el`) en la hora de Chile, **también
  cuando se emite después**. El `ahora` de la firma es el del momento de firmar.
- **El documento cubre la venta entera** (`monto = total_final`): una línea por `venta_detalles`,
  con su `descripcion` congelada. Los descuentos y recargos de nivel venta **ya vienen repartidos en
  cada línea** (`venta_detalles.ajuste_venta`, con la identidad `subtotal − descuento_aplicado +
  recargo_aplicado + ajuste_venta + impuesto_aplicado = total_linea`), así que la boleta no lleva
  `DscRcgGlobal`. Por línea, con IVA incluido:
  - `MontoItem` = `total_linea`;
  - `QtyItem` = `cantidad`, y `PrcItem` = `subtotal / cantidad × (1 + tasa)`, a 6 decimales, donde la
    tasa es la suma de los `porcentaje_aplicado` de los `ventas_impuestos` de esa línea con impuesto
    de tipo `iva` (0 en una exenta);
  - la diferencia `PrcItem × QtyItem − MontoItem`, redondeada a pesos, va como `DescuentoMonto` si es
    positiva o como `RecargoMonto` si es negativa. Así la igualdad de la regla 2 del motor se cumple
    por construcción, con menos de un peso de diferencia;
  - una línea con `subtotal` 0 sale como la línea gratis del motor (sin `PrcItem`).

  Los montos (`neto`, `exento`, `iva`, `total`) son los baldes congelados del documento.
- **La venta que un descuento deja en $0** sale con la línea a precio de lista y su descuento, y
  `MntTotal` 0. El motor la acepta solo si la suma de los `DescuentoMonto` y de los descuentos
  globales es mayor que cero; un total 0 sin descuento sigue siendo `TOTAL_NO_POSITIVO`.
- **El documento cubre una parte** (pago mixto con la máquina): **una línea "Saldo de la venta"**
  por `monto_afecto + monto_impuestos` (afecta), y otra "Saldo de la venta (exento)" por
  `monto_exento` si es mayor que cero. Sin cantidad ni precio, que es lo que el motor admite
  (regla 2: una línea con solo el monto no se verifica). Los montos son los baldes que el documento
  ya congeló a prorrata (ADR-028). *(El texto, confirmado: § 0.)*
- **Receptor:** el `venta_customer` si tiene RUT; si no, el genérico (lo pone el motor).
- **Impuestos adicionales:** la suma de los `ventas_impuestos` de la venta cuyo impuesto no es de tipo
  `iva` va en `montos.adicionales`. Mayor que cero da `IMPUESTO_ADICIONAL_NO_SOPORTADO` (decidido: el
  ILA es costo).

### 4.3 Más de 135 UF

`superaUmbralIdentificacion` sale de comparar `total_final` contra el umbral que ya usa la venta
(`umbral_identidad_pagador`, misma regla, con el año **de la venta** y no el de hoy: una boleta emitida en enero por una venta de diciembre usa el umbral de diciembre). La venta ya exige nombre y RUT; la boleta
lleva además `MedioPago`: **el `medio_pago_sii` del pago de mayor monto aplicado a esa boleta**
(empate: el primero registrado). *(Confirmado: § 0.)*

Un documento parcial sobre 135 UF sale con la línea de saldo, y el SII pide ahí la descripción de
los productos. Hoy eso es una venta de más de ~$5,3 millones pagada en parte con la máquina; se
emite igual y queda anotado en "Lo que queda abierto".

### 4.4 En la venta, detrás de un savepoint

Al final de `crearEnTransaccion`, **después de `documentarVenta`**, si el interruptor está prendido
y la venta dejó un documento `sistema` de boleta (`tipos_documento_tributario.es_boleta`), vigente:

```
SAVEPOINT emision_boleta
  emitir(...)
  ── DteError → ROLLBACK TO SAVEPOINT emision_boleta
                marcar el documento sin_emitir, con código y mensaje
  ── cualquier otro error → se propaga y la venta se cae, como hoy
RELEASE SAVEPOINT emision_boleta
```

- **Un solo lugar cubre los cuatro caminos**: el POS (`crear`), el cierre de mesa
  (`salones.service`), el callback de la tienda (`online-callback.handler` → `crear`) y las
  suscripciones (`suscripciones.service`). Todos pasan por `crearEnTransaccion`.
- **El folio vuelve en el rollback**, tanto si falla la emisión (savepoint) como si después se cae
  la venta entera: nunca queda un hueco que anular ante el SII.
- **Un error que no es `DteError` no se traga** (la regla de la cola, R9). En el callback de la
  tienda deja la orden "pagada sin venta", que ya se concilia.
- `Db` no ofrece savepoints hoy: el savepoint se abre con `manager.query('SAVEPOINT …')` sobre el
  manager de la transacción activa, encapsulado en un método de `Db` (`conSavepoint(nombre, fn)`),
  con su prueba propia. El nombre es una constante, nunca un valor de entrada.
- **La respuesta de la venta** suma el folio, el tipo y si quedó sin emitir (con el mensaje), y se
  guarda junto a la `Idempotency-Key` después de emitir: el reintento devuelve el mismo folio.

### 4.5 Errores: qué arregla el admin y qué no

Todo `DteError` deja `sin_emitir`. La lista y el botón los separan:

| Grupo | Códigos | Qué hace el botón | Qué dice la pantalla |
|---|---|---|---|
| **Del perfil** | `SIN_FOLIOS`, `SIN_CERTIFICADO`, `CERTIFICADO_VENCIDO`, `PERFIL_INCOMPLETO`, `AMBIENTE_DISTINTO` | Corta en la primera: las siguientes fallarían igual | El motivo y qué hacer ("sube un CAF", "renueva el certificado") |
| **De esa boleta** | `IMPUESTO_ADICIONAL_NO_SOPORTADO`, `FALTA_IDENTIFICACION_135_UF`, `TEXTO_*`, y cualquier otro código del motor | Sigue con la siguiente | "No se puede emitir: …". El de ILA explica que el producto lleva un impuesto adicional que la boleta no informa; los de montos (`TOTALES_NO_CIERRAN`, `LINEA_NO_CIERRA`…) son un error nuestro y dicen "avísanos" |

La clasificación es una función pura (`grupoDelError(codigo)`), con un test por código.

### 4.6 Bloqueos y cambios a mitad de camino

- **El bloqueo del CAF es el último de la transacción** (la emisión va después de stock, caja,
  pagos y documentos) y dura hasta el commit. Ningún camino bloquea el CAF y después otra fila, así
  que no se forma un ciclo con el orden de fila de la venta (el comentario de `crear()` en
  `ventas.service.ts`) ni con el de las tablas del catálogo (`docs/patterns/backend.md` § 15). Las ventas de un mismo local se
  ordenan en ese tramo final.
- **Cambio de ambiente** entre `tomarFolio` y `credencialesParaFirmar`: `AMBIENTE_DISTINTO`, la
  boleta queda `sin_emitir` y el botón la resuelve. No se agrega un bloqueo de la razón social en
  cada venta: ordenaría todas las ventas contra cualquier edición del perfil para cubrir un caso
  que ya cae en `sin_emitir`.
- **Cambio de razón social preferida:** la boleta sale con la que era preferida al tomar el folio;
  las credenciales salen de la razón social del CAF (`credencialesParaFirmar`), así que emisor, CAF
  y certificado son siempre del mismo RUT.
- **Deadlock (`40P01`):** `crear` reintenta la transacción entera, y el folio volvió con el rollback.

## 5. Emitir después: el botón

`POST /dte/emitir-pendientes` (`TenantAdminGuard`, `tenant_id` del token, sin body).

1. Lee los documentos `sin_emitir`, vigentes, del tenant, **del más viejo al más nuevo**, hasta 200
   por llamada (una consulta).
2. Por cada uno, **en su propia `db.transaccion`**:
   - toma el bloqueo de su venta (`lockVentaOriginal`, el mismo que anular y que el `PATCH` del
     número), y después vuelve a leer el documento: si ya no está `sin_emitir` o tiene descarte, lo
     salta;
   - `emitir(...)` con la fecha de la venta;
   - con un `DteError`, anota el error nuevo (sigue `sin_emitir`) y, si es del grupo del perfil,
     **corta**.
3. Responde `{ emitidas, pendientes, errores: [{ ventaId, codigo, mensaje }] }`.

El orden de bloqueo es venta → CAF, igual que en la venta (la venta se bloquea al crearse, y el CAF
al final). Dos admins con el botón a la vez, o un botón y una anulación: la segunda ve el estado
nuevo y salta.

## 6. Anular y la nota de crédito, mientras no exista el frente 2

- **Anular** (`evaluarAnulacion`): una boleta `sin_emitir` se trata como `armado` (no salió:
  se anula y queda descartada con `armado_sin_enviar`, E8). Una `emitido` **bloquea**: 400 *"La
  boleta ya se emitió: se revierte con una nota de crédito."*. La fila de `enviado` de la tabla de
  `ventas.md` pasa a ser `emitido`.
- **La nota de crédito** sobre una venta cuya boleta está `emitido` se registra como hoy (stock,
  caja, totales, su documento `sistema` / `armado`). La marca **"NC electrónica pendiente"** no es
  una columna: se deriva de que su `documento_corregido_id` apunte a un documento `emitido`, y la
  devuelve el detalle de la venta (`documentos[].ncElectronicaPendiente`). El drawer la muestra con
  *"Hazla en el portal del SII por ahora; el sistema la emitirá cuando esté disponible."*, y la
  respuesta de la emisión de la nota trae el mismo aviso.

## 7. El ticket

`BoletaVenta` suma `boletaElectronica: { tipo, folio, monto, cubreTodo, ambiente, resolucion:
{ numero, fecha }, emisor: { rut, razonSocial, giro, direccion, comuna } } | null` y
`boletaSinEmitir: { mensaje } | null`. Lo arma el servidor (`armarBoleta`), así que el cobro y la
reimpresión salen iguales. El emisor del papel es el de la boleta (la razón social de su CAF), no
la preferida de hoy.

- **Pago mixto** (`cubreTodo: false`): el papel sigue listando la venta entera, como hoy, porque es
  lo que el cliente consumió. Pero el bloque de la boleta dice *"BOLETA ELECTRÓNICA N° 1234 por
  $60.000 (saldo de la venta)"*, para que no se lea como una boleta por el total.

- **Emitida:** se enciende la rama `BOLETA ELECTRÓNICA` que ya existe, apagada, en
  `buildBoletaTicket`: arriba *"BOLETA ELECTRÓNICA N° 1234"* (o *"BOLETA EXENTA ELECTRÓNICA"*), y al
  pie *"Timbre Electrónico SII"*, *"Res. N° X de AAAA"* y *"Verifique documento en www.sii.cl"*.
  Sale *"SIN VALIDEZ FISCAL"*.
- **En certificación:** además, *"CERTIFICACIÓN – SIN VALIDEZ"*.
- **Sin emitir:** el ticket de hoy más la línea *"Boleta electrónica pendiente de emisión"*.
- **Reimpresión** (`GET /ventas/:id/boleta`): después de emitirla, sale con el folio.

## 8. El aviso al cajero y la pantalla

### 8.1 `GET /dte/estado-emision`

La lee quien vende: `@RequiresPermiso('Ventas', 'Crear')`, no `TenantAdminGuard` (`GET /dte/perfil`
es de admin y el cajero recibe 403). Devuelve:

```
{ activa: boolean,
  avisos: [{ codigo: 'POCOS_FOLIOS' | 'CERTIFICADO_POR_VENCER', mensaje }],
  sinEmitir: number }
```

- `avisos` son los que ya calcula el perfil (`UMBRAL_FOLIOS` 100, `DIAS_AVISO_CERTIFICADO` 30). No
  devuelve nada del emisor ni del certificado más allá del mensaje.
- Con `activa: false` devuelve `avisos: []` y `sinEmitir: 0`: un local que no emite no ve la franja.
- Son consultas fijas (el estado del perfil y un `count`), sin importar cuántos CAF haya.

### 8.2 El POS y el salón

- Una franja arriba con el aviso: *"Quedan 40 folios: avisa al encargado"*, *"El certificado vence
  en 12 días"*, *"Hay 3 boletas sin emitir: avisa al encargado"*. Se lee al entrar y después de
  cada cobro.
- Al cobrar, si la boleta quedó sin emitir: *"La boleta no se emitió: <motivo>. Avisa al
  encargado."*. La venta ya entró y el ticket sale (§ 7).

### 8.3 `/configuracion/boleta-electronica`

- **El menú la muestra a todo admin del tenant**: sale `auth.isSuperadmin` de `configuracion.vue`
  (la ruta ya era del admin).
- Arriba, el interruptor **"Emitir boletas electrónicas"**: deshabilitado con faltantes, con el
  texto de qué falta; al prenderlo, confirma (*"Desde ahora cada venta emite una boleta ante el
  SII"*).
- Debajo de las tarjetas de hoy, **"Boletas sin emitir"**: fecha, monto, link a la venta y motivo,
  más el botón **"Emitir pendientes"** con el resultado.

## 9. El nombre del ítem

- `CreateItemDto` y el de edición: `nombre` con **máximo 80 caracteres e ISO-8859-1**, con el mensaje
  *"El nombre no puede pasar de 80 caracteres ni llevar símbolos fuera del alfabeto latino (lo exige
  el SII en la boleta)"*.
- La regla es **la misma función** que usa el motor (`validarTexto` / su predicado, exportado desde
  `dte`): el catálogo y la boleta no pueden discrepar.
- El frontend muestra el mismo límite en el formulario del ítem (contador y error).
- Es la primera tarea del plan: no depende de nada.

## 10. Pruebas

**Unitarias:**
- `datosBoletaDeVenta`: venta completa; pago mixto con la línea de saldo, afecta y exenta; venta
  con afecto y exento (39 con líneas exentas); todo exento (41); más de 135 UF con customer y
  `MedioPago` del pago mayor; la fecha de la venta y no la de hoy; el nombre congelado.
- `grupoDelError`: un caso por código.
- `Db.conSavepoint`: libera en el éxito, vuelve en el error y propaga.
- `buildBoletaTicket`: emitida (39 y 41), certificación y sin emitir.

**e2e contra Postgres:**
- Una venta que un descuento deja en $0: sale la boleta por $0 con la línea y su descuento.
- Interruptor prendido: la venta del POS sale con folio; `dte_documentos` queda `pendiente`; el
  documento `emitido` con `dte_documento_id`; la respuesta trae el folio.
- Interruptor apagado: `armado`, `dte_documentos` vacío.
- Prender con faltantes: 400 con la lista.
- Sin folios: la venta da 201, el documento queda `sin_emitir` con `SIN_FOLIOS` y
  `siguiente_folio` no se mueve.
- Una venta que se cae después de emitir (stock insuficiente en otra línea): el folio vuelve.
- Mismo cobro dos veces con la misma `Idempotency-Key`: el mismo folio.
- 10 ventas en paralelo: 10 folios consecutivos y distintos.
- El cierre de mesa, el callback de la tienda y la suscripción también emiten.
- El botón, después de subir un CAF: emite con la fecha de la venta y deja `emitido`; con
  `SIN_FOLIOS` corta; con un error de la boleta sigue.
- El botón contra una anulación en paralelo: nunca una venta cancelada con boleta emitida.
- Anular una `sin_emitir`: se anula y se descarta. Anular una `emitido`: 400.
- La NC sobre una venta emitida: se registra y el detalle la marca pendiente.
- El cajero: 403 en el botón y en el interruptor; 200 en `estado-emision`.
- El nombre del ítem: 81 caracteres o un "€" dan 400; 80 con "ñ" pasa.

**Mutantes** (revertidos con `cp` y comprobados con `cmp`): sin el savepoint; emitir antes de
`documentarVenta`; el botón sin `lockVentaOriginal`; la fecha de hoy en vez de la de la venta;
`grupoDelError` que no corta con `SIN_FOLIOS`.

**Playwright:** el interruptor, la lista y el botón de la pantalla; la franja del POS; el ticket
con folio.

## 11. Documentación que se actualiza

`features/emision-electronica.md` (sección nueva "La venta emite la boleta" y lo que cambia en
Perfil y Envío), `features/ventas.md` (la tabla de anular, la respuesta del cobro, el detalle),
`features/impresion-termica.md` (el ticket), `features/reembolsos-nota-credito.md` (la marca),
`features/catalogo-paginado.md` (el límite del nombre del ítem), `ESTADO.md`, `ARCHITECTURE.md`,
`agent/desarrollo-nuevo.md` (frente 1 hecho, frentes 2 y 3 abiertos), ADR-028 (el estado
`emitido`) y `startup-pos.sql`.

## 12. Lo que queda abierto

- **La NC electrónica (tipo 61)** y el envío por el canal de facturas: frente 2. Hasta entonces la
  nota ante el SII se hace en su portal.
- **Atrasadas y rechazadas**, y qué se hace con una rechazada: frente 3.
- **Documento parcial sobre 135 UF** con la línea de saldo: el SII pide la descripción de los
  productos (§ 4.3).
- **El plazo del SII para recibir una boleta con fecha pasada** no se investigó; la emitida después
  lleva la fecha de la venta (decidido).
- **El orden de las ventas en el tramo del CAF** es la nueva contención del local: se mide si
  aparece.
