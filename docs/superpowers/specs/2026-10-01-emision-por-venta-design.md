# Emitir al SII: cada venta registra quién emitió, y la regla la declara cada método de pago

**Fecha:** 2026-10-01 · **Tipo:** spec de diseño
**Frente:** *"Emitir al SII se elige al cerrar cada venta…"* y *"Un reembolso por pasarela sin nota
de crédito…"*, en [`docs/agent/pendientes.md`](../../agent/pendientes.md) § 6. Es **fiscal y va
solo** (`CLAUDE.md`, ADR-010).
**Reglas:** [`PRODUCTO.md`](../../PRODUCTO.md) § 10, "Emitir al SII es una elección de cada venta".
**Investigaciones:**
[`2026-10-01-emision-por-venta-y-boleta-del-terminal.md`](../../agent/investigaciones/2026-10-01-emision-por-venta-y-boleta-del-terminal.md)
y [`2026-10-01-reembolso-sin-nota-credito.md`](../../agent/investigaciones/2026-10-01-reembolso-sin-nota-credito.md).
**Diseño aprobado por el owner** en la sesión del frente (2026-10-01, "parece bien").

En una frase: el sistema lleva bien la venta y la plata, y lo tributario queda en manos del comercio
y registrado.

---

## 1. Lo que hay hoy (medido el 2026-10-01)

- **La venta tiene una etiqueta, no un documento.** `ventas.tipo_documento_id` es nullable y el
  servidor **no lo valida**: lo copia del body (`ventas.service.ts:717`, `dto.tipoDocumentoId ??
  null`). El POS lo elige con un selector y lo exige para cobrar (`useVenta.ts:446`). Salones manda
  siempre el primero de `/tipos-documento` (la Boleta, por orden alfabético) y, si esa carga falla,
  manda nada (`salones/index.vue:2780`, `.catch(() => null)` en l.1100). La venta online y la de
  suscripción nacen sin tipo.
- **Anular mira la etiqueta.** `cancelarUnaVez` rechaza si hay `tipo_documento_id`
  (`ventas.service.ts:1329`). Como el POS lo escribe siempre, casi ninguna venta del POS se puede
  anular. El drawer replica la regla (`VentaDetalleDrawer.vue:268-274`).
- **`metodos_pago` es un catálogo global** (4 filas: efectivo, débito, crédito, transferencia). Lo
  que es de cada comercio vive en **`tenant_metodo_pago`** (`habilitada`, `permite_vuelto`,
  `requiere_conteo`), y la pantalla `configuracion/metodos-pago.vue` lo edita con
  `PATCH /metodos-pago/:id` bajo `TenantAdminGuard`. No hay método "Webpay": la venta online cobra
  con el método de crédito o débito del tenant (`online-callback.handler.ts:57-61`).
- **Dónde nace un pago:** solo en `PagosService.registrar`, que llaman `crearEnTransaccion` (POS,
  salones, online, suscripción) y `registrarAbono` (`POST /pagos`). La UI no deja cerrar sin al
  menos un pago, salvo total $0. Sí deja el pago parcial (`pagada_parcial`).
- **La NC es una fila de `ventas`** con `tipo_documento_id` = el tipo `es_nota_credito` del país y
  `venta_referencia_id` = la venta que corrige. `venta_referencia_id` no lo usa nadie más. Lleva
  líneas e impuestos derivados de la venta original. Con `devolverDinero` deja una salida de caja en
  efectivo.
- **El reembolso por pasarela deja NC solo si se tilda** (`ReembolsoModal.vue:36`, nace en
  `false`). Sin la casilla mueve stock o nada (`reembolso-callback.handler.ts:41-65`). El `REFUND`
  no guarda la NC que generó. La API externa (`POST /pasarela/api/cobros/:ordenId/reembolsos`,
  `ApiKeyGuard`) acepta el mismo body.
- **El código de autorización de Webpay** vive en `pasarela_transacciones.codigo_autorizacion` y en
  `pasarela_ordenes.metadata`. El `pago` no lo tiene: `pagos.referencia` existe y el handler online
  no la llena.
- **El ticket** dice siempre "DOCUMENTO INTERNO" (los tres llamadores pasan
  `facturacionElectronica: false`). No lee el tipo de la venta.

## 2. Las decisiones

Las de fondo están en `PRODUCTO.md` § 10 y en la entrada de `pendientes.md`, con su procedencia.
Las que salieron de este diseño:

| # | Decisión | Quién y cómo |
|---|---|---|
| E1 | El documento de lo que todavía no se pagó **sale al pagarlo**: cada cobro sigue la regla de su medio. Una mesa de $100.000 que paga $40.000 con tarjeta tiene el voucher por $40.000, y los $60.000 tienen su documento recién en el abono. | Owner, AskUserQuestion 2026-10-01 |
| E2 | **La factura la hace siempre el sistema**, se pague como se pague. La regla de cada medio decide solo quién emite las **boletas**, que es lo que el comercio declara ante el SII como "modelo de emisión". | Owner, AskUserQuestion 2026-10-01 |
| E3 | Un comercio nuevo trae **"emite el sistema"** en todos los medios. Es el error barato: se corrige con NC. | Owner, AskUserQuestion 2026-10-01 |
| E4 | La regla va en **`tenant_metodo_pago`**, no en `metodos_pago`. La decisión decía `metodos_pago`, pero esa tabla es global: la regla sería la misma para todos los comercios. La pantalla es la que se decidió. | Sesión del frente, por lo medido en § 1; aprobado con el diseño |
| E5 | **La venta online la documenta el sistema**, sin mirar la regla del medio. Si la mirara, "Tarjeta de crédito → la máquina" la dejaría sin documento, porque en lo online no hay máquina. | Derivada de la decisión del owner sobre la venta online; aprobada con el diseño |
| E6 | **Una venta de $0 no lleva documento**: el mínimo de la boleta es $1 (Res. Ex. SII N°60/2023). | Sesión del frente; aprobado con el diseño |
| E7 | **Una corrección se reconoce por `venta_referencia_id`**, no por `es_nota_credito`. La devolución interna no es un documento tributario y no lleva ese tipo. | Sesión del frente; aprobado con el diseño |

## 3. Diseño

### 3.1 La regla por medio de pago

- `tenant_metodo_pago.emisor`: `'sistema' | 'maquina' | 'nadie'`, no nulo, default `'sistema'`
  (E3). Es una columna de texto con `CHECK`, como las otras enumeraciones del esquema; el plan sigue
  la forma que ya usan.
- El alta de tenant (`tenants.service.ts:450-458`) y el seed lo dejan en `'sistema'`.
- `UpdateTenantMetodoPagoDto` suma `emisor?` con `@IsIn`. `GET /metodos-pago` lo devuelve.
- `configuracion/metodos-pago.vue`: un selector por fila con "El sistema", "La máquina" y "Nadie",
  junto a los dos switches de hoy. Con "Nadie" la fila dice en una línea qué implica: las ventas
  con ese medio quedan sin documento y la responsabilidad es del comercio.

### 3.2 Los documentos de una venta

Tabla nueva **`venta_documentos`**, una fila por documento:

| Columna | Qué guarda |
|---|---|
| `documento_id` | PK uuid |
| `tenant_id` | el tenant |
| `venta_id` | la fila de `ventas` a la que pertenece: la venta, o la corrección (§ 3.6) |
| `emisor` | `'sistema' \| 'maquina' \| 'nadie'` |
| `tipo_documento_id` | con `sistema`, el tipo (boleta, factura, NC). Nulo con `nadie` |
| `clase_maquina` | con `maquina`: `'voucher' \| 'boleta'`. Nulo hasta que se sepa |
| `numero` | con `maquina`: el número del voucher o el folio de la máquina. Nulo hasta que se tipee |
| `estado_envio` | con `sistema`: `'armado'`. `'enviado'` queda reservado para la emisión (ADR-010) |
| `monto` | lo que cubre, en moneda oficial, sin propina ni vuelto |
| `monto_afecto`, `monto_exento`, `monto_impuestos` | con `sistema`: los baldes congelados del documento |
| `pago_id` | con `maquina`: el pago que cubre (cada pasada de tarjeta es su voucher) |
| `documento_corregido_id` | en una corrección: el documento que corrige |
| timestamps + `eliminado_el` | como todo el esquema |

- **Folio ≠ PK** (ADR-010): el folio del sistema no existe todavía y no se inventa. El `numero` es
  el de la máquina, que es un dato externo.
- **Los baldes congelados.** Si el documento cubre la venta entera, son los de la venta. Si cubre
  una parte (pago mixto, abono), se reparten a prorrata de las porciones afecta y exenta de la
  venta, con el mismo cuantizador y el mismo reparto que la NC por monto
  (`nota-credito-composicion.ts`). El residuo de cuantización va igual que en la NC. Lo que
  congela es lo que el emisor futuro lee sin recalcular.
- **Lo que suman los documentos no tiene que dar el total de la venta.** Mientras falte un pago,
  falta su documento (E1). "Sin documento todavía" es la venta pendiente o la parte pendiente.

### 3.3 Cómo se resuelve, siempre en el servidor

Se resuelve **dentro de la misma transacción** que registra los pagos, en `crearEnTransaccion` y en
`registrarAbono`. El cliente nunca manda quién emitió.

1. **Factura** (`tipos_documento_tributario.es_boleta = false` y no NC): al crear la venta, un
   documento `sistema` / `armado` por el **total**, aunque no se pague nada (E2). Los abonos de esa
   venta no generan documentos.
2. **Boleta**: en cada cobro (el cierre o un abono), los pagos se agrupan por el `emisor` de su
   medio, sobre lo aplicado a la venta (`pago_aplicaciones.tipo = 'venta'`):
   - cada pago con `maquina` da su documento, con su `pago_id`, y con número y clase si vinieron;
   - los pagos con `sistema` dan **una** boleta por su suma;
   - los pagos con `nadie` dan **una** fila `nadie` por su suma.
3. **Online** (`canal = 'online'`): un documento `sistema` / `armado` por el total, con la boleta del
   país, sin mirar el medio (E5). La venta online pasa a nacer con ese `tipo_documento_id`.
4. **Total $0**: sin documento (E6).

- **El catálogo marca la boleta.** `tipos_documento_tributario.es_boleta` (bool, default `false`),
  sembrado `true` en la Boleta chilena (código 39). Es lo que separa "sigue la regla del medio" de
  "la hace siempre el sistema", y lo que resuelve "la boleta del país" para la venta online.
  Hoy la única forma de encontrarla es el orden alfabético.
- **`tipoDocumentoId` se valida en el servidor**: del país del tenant, activo y no NC. Si no viene,
  se usa la boleta del país (lo que hoy salones hace por accidente). Un país sin boleta sembrada
  (AR/CO/MX) no cambia: el POS de esos países ya no cobra hoy, y el frente fiscal de esos países es
  otro (§ 6 de `pendientes.md`).
- **Pago mixto**: queda con los dos documentos sin regla aparte. Sale del agrupamiento.
- **Sin N+1**: el `emisor` de los medios del cobro sale en la misma lectura que ya hace
  `PagosService.registrar` sobre `tenant_metodo_pago` (l.137-150). Los documentos se insertan en un
  solo `save` con el array.

### 3.4 El número de la máquina

- **Al cobrar**: `PagoVentaDto` suma `numeroDocumento?` y `claseDocumento?` (`'voucher' |
  'boleta'`). `CobroModal.vue` los muestra solo en los pagos cuyo medio emite con la máquina, y son
  opcionales. Llegan por `POST /ventas`, `POST /cuentas/:id/cerrar` y `POST /pagos`.
- **Después**: `PATCH /ventas/:id/documentos/:documentoId` con `{ numero, clase }`. Solo sobre
  documentos `maquina` de esa venta. Permiso `Ventas:Crear`, con el mismo alcance de caja que
  `findOne`. El `tenant_id` sale del token.
- **El detalle de la venta** (`GET /ventas/:id`) devuelve `documentos[]`. El drawer los muestra en
  una sección "Documentos", con "Completar número" en los de la máquina que no lo tienen.

### 3.5 Anular

`cancelarUnaVez` deja de mirar `tipo_documento_id`. Rechaza si la venta tiene algún documento con
emisor `sistema` o `maquina`. Siguen los otros dos rechazos (estado `pendiente`, sin pagos). Con
E1, una venta pendiente sin pagos solo tiene documento si es una factura (E2). El detalle expone
`anulable` desde el backend, y el drawer deja de replicar la regla.

### 3.6 Devoluciones: todo reembolso deja registro

Una corrección sigue siendo una fila de `ventas` con `venta_referencia_id`, compuesta como la NC de
hoy: líneas, devoluciones de stock, IVA por porción y los dos topes que ya existen. Eso es lo que
baja lo vendido, lo cobrado y el saldo. Lo nuevo es **su documento**, que sale de **qué documento
corrige**:

| El documento corregido lo emitió… | La corrección lleva | `tipo_documento_id` de la fila |
|---|---|---|
| el sistema | NC `sistema` / `armado` | el tipo NC del país |
| la máquina | NC `maquina`, con número opcional (la hace la máquina o su portal; el sistema la anota) | el tipo NC del país |
| nadie, o la parte no tiene documento | **devolución interna**: fila `nadie` | nulo |

- **Qué documento corrige lo decide por dónde vuelve la plata.** El modal de NC
  (`NotaCreditoModal.vue`) cambia la casilla "devolver dinero" por **"¿Por dónde vuelve la
  plata?"**:
  - **Uno de los pagos de la venta** (*"Efectivo de la caja · $60.000"*, *"Tarjeta de débito ·
    $40.000"*). Corrige el documento de ese pago. Si el pago fue en efectivo, la plata sale de la
    caja (la salida de hoy, con sus topes). Si no, no se mueve caja, porque la reversa se hace por
    fuera, en la máquina o en el banco. Es por pago y no por "efectivo" porque hay máquinas que
    emiten también por efectivo, y porque una venta puede tener dos pagos en efectivo.
  - **No vuelve plata**: solo se ofrece si la venta tiene saldo, y lo rebaja. Corrige el documento
    de la parte no pagada: la factura si la hay; si no, una devolución interna.
  El servidor recibe el pago elegido, o "no vuelve plata", y resuelve el documento. El cliente
  nunca manda el documento. En una venta con factura, el documento de todos sus pagos es la
  factura (E2).
- **Tope por documento**: lo corregido de un documento no pasa su `monto`. Se suma a los dos topes
  de hoy, bajo el mismo lock.
- **Reembolso por pasarela**: se va `generarNotaCredito`, del modal, del DTO y del evento. Todo
  `REFUND` aprobado con `venta_id` crea la corrección contra el documento del pago online (la
  boleta del sistema, por E5). `pasarela_transacciones` suma `correccion_venta_id`, escrito cuando
  la corrección se crea. Si el hook falla, el `REFUND` queda sin corrección, con `warning`, como
  hoy: la plata ya volvió. La API externa pierde el campo (no hay clientes productivos).
- **El código de Webpay** pasa a `pagos.referencia` en el cobro online. Es un dato del pago, no el
  documento.
- **Una corrección no se corrige**: el rechazo de "NC sobre NC" pasa a mirar `venta_referencia_id`
  (E7).

### 3.7 Reportes y lectores

- **Todo lector que hoy reconoce una NC** por `es_nota_credito` o por el id del tipo NC pasa a
  reconocer una corrección por `venta_referencia_id IS NOT NULL` (E7). Así la devolución interna y
  la NC de la máquina restan sin regla aparte. El inventario completo de lectores sale en la tarea
  1 del plan: hoy son `ventas.service.ts` (tope, composición, efectivo devuelto, resumen, listado,
  detalle) y `resumen-negocio.service.ts`.
- ⚠️ **Dependencia:** el frente del vendido neto está reescribiendo esas consultas de
  `resumen-negocio` y `/ventas/resumen`. La parte del plan que las toca se implementa **después**
  de que ese frente esté en main. La orquestadora avisa.
- **`/ventas` suma un filtro por quién emitió**: sistema, máquina, máquina sin número, sin
  documento. Es lo que deja al comercio revisar sus ventas sin documento. Va como un `EXISTS` en
  `buildListarFilters`, sin N+1.

## 4. Lo que el plan mide primero (tarea 1, antes de fijar código)

1. Todos los lectores de "es NC": `es_nota_credito`, `tipoNotaCreditoDelTenant`, y los que cruzan
   `tipo_documento_id` con el tipo NC, en backend y frontend.
2. Que `pago_aplicaciones` deje separar lo aplicado a la venta por pago, con propina y vuelto, en
   los tres caminos que crean pagos.
3. Que el reparto a prorrata de `nota-credito-composicion.ts` sirva para un documento que no es NC
   sin cambiarle la conducta a la NC.
4. Cómo están declaradas las otras enumeraciones de texto del esquema, para seguir la misma forma.

## 5. Pruebas

Los specs unitarios mockean `Db` y no ven la forma del SQL. La red real es `test:e2e`. Los montos
tienen que discriminar (ni 1 ni factores iguales).

| Escenario | Lo que afirma |
|---|---|
| Boleta $100.000: efectivo $60.000 (sistema) + débito $40.000 (máquina, con número) | dos documentos, con montos 60.000 y 40.000; el de la máquina con su número y su `pago_id`; los baldes de la boleta suman 60.000 |
| La misma mesa, $40.000 con tarjeta y abono de $60.000 en efectivo al día siguiente | el voucher al cerrar; la boleta del sistema recién en el abono (E1) |
| Factura de $119.000 pagada con tarjeta, medio en `maquina` | un solo documento `sistema` por 119.000; ninguno de la máquina (E2) |
| Factura sin pago, después anulada | rechaza anular: tiene documento |
| Boleta pendiente sin pagos (por API) | se anula aunque traiga `tipoDocumentoId` |
| Venta online con el método de crédito en `maquina` | documento `sistema` / `armado` por el total, con la boleta del país; el código de Webpay en `pagos.referencia` (E5) |
| Medio en `nadie` | fila `nadie`; aparece en el filtro "sin documento" |
| `tipoDocumentoId` de otro país, o el de la NC | 400 |
| Venta $0 | sin documentos |
| NC por efectivo sobre el pago mixto | corrige la boleta del sistema, no el voucher; tope por documento |
| NC por la tarjeta | NC `maquina`, sin salida de caja |
| NC sobre una venta cuyo medio estaba en `nadie` | devolución interna, con tipo nulo; baja lo vendido y el saldo |
| `REFUND` aprobado | siempre deja corrección; `correccion_venta_id` escrito |
| Completar el número después | solo sobre documentos de la máquina; el tenant sale del token |

Cada test nuevo lleva un mutante que **revierte** a la conducta de hoy y lo tiene que matar.
Después va un smoke con Playwright del cobro mixto, el número después y la NC por medio, como un rol
con los permisos del módulo y no como admin.

## 6. Fuera de alcance

- Enviar al SII, folios, CAF, firma (ADR-010). `estado_envio = 'enviado'` queda sin escritor.
- Un módulo para configurar las máquinas de cobro.
- El ticket impreso: sigue diciendo "documento interno".
- Boleta y factura de AR/CO/MX (§ 6 de `pendientes.md`).
- El motor de precios.
- El % de anulaciones por garzón.
- La NC que se emite dos veces al reintentar (§ 6 de `pendientes.md`).
- El saldo por venta del listado (§ 2 de `pendientes.md`). El `correccion_venta_id` del `REFUND`
  le da al frente del vendido neto el dato que le faltaba para el caso de su D10, pero cambiar esa
  fórmula es de ese frente.

## 7. Docs vivas en el commit del código

- `docs/PRODUCTO.md` § 10: la regla de `cancelada` pasa a leerse contra lo emitido, y se va el
  párrafo de "hoy el tipo es solo una etiqueta".
- `docs/features/ventas.md`, `docs/features/pagos.md`, `docs/features/reembolsos-nota-credito.md`,
  `docs/features/pasarela-pagos.md`, y el feature de métodos de pago si existe.
- ADR nuevo: la emisión registrada por venta y la corrección por `venta_referencia_id`. Más la
  actualización de ADR-010 y el índice.
- `docs/ESTADO.md`. Las dos entradas de la § 6 de `pendientes.md` pasan a `resueltos.md`.
