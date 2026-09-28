# Compras: la deuda con el proveedor y sus pagos, con la salida de caja automática

**Fecha:** 2026-09-28 · **Tipo:** spec de diseño · **Status:** Approved (owner, 2026-09-28, por la sesión orquestadora: "Sí, aprobado con esos dos cambios" —decisiones 11 y 12— más una corrección de redacción en la 5)
**Frente:** pieza 3 de *"Compras: carga manual, y el DTE del SII como atajo encima"*, en
[`docs/agent/pendientes.md`](../../agent/pendientes.md). Viene después de las piezas 1 y 2 y
de la lectura del XML; lo que hace hoy compras está en
[`features/compras.md`](../../features/compras.md).
**Investigación:** [`2026-09-18-compras.md`](../../agent/investigaciones/2026-09-18-compras.md) § 5
(las decisiones de origen) y [`2026-09-28-deuda-proveedor.md`](../../agent/investigaciones/2026-09-28-deuda-proveedor.md)
(cómo lo resuelve el mercado).

---

## 1. El problema que cierra

Compras ya registra lo que llega (pieza 1), en la unidad del proveedor (pieza 2) y con el XML
de la factura (lectura del DTE). Lo que no sabe es **cuánto se le debe a quién y cuándo
vence**, ni deja registrar que se pagó. Hoy el pago a un proveedor en efectivo sale del cajón
como una salida manual con glosa libre, y la deuda vive en un cuaderno.

Esta pieza hace eso: **cada compra confirmada deja deuda con su proveedor**, con vencimiento;
un **pago** se reparte entre sus compras (o queda a favor); el pago en **efectivo** sale de la
caja de quien paga en el mismo acto; la compra al contado se registra en un solo gesto al
confirmar; y una pantalla **"Por pagar"** muestra lo que se debe por proveedor.

## 2. Decisiones

**Heredadas, sin re-litigar** (owner, 2026-09-18; investigación de compras § 5, decisión 3):

- **Cada compra deja saldo con el proveedor**, con pagos parciales y vencimientos.
- **Un pago en efectivo sale de una caja y la salida la genera el sistema en el mismo acto.**
  Un pago por transferencia no toca la caja. Costo asumido: para pagar en efectivo hay que
  tener caja abierta, y el pago queda en el turno de quien lo hizo. La salida pasa por la
  **misma** validación contra el efectivo real que la salida manual
  ([`gestion-cajas.md`](../../features/gestion-cajas.md)).
- **La compra al contado se registra en un solo gesto**: "¿la pagaste ya?", con medio y caja.
- ⛔ **Lo fiscal va solo** (CLAUDE.md, ADR-010): IVA crédito fiscal, notas de crédito del
  proveedor en lo tributario y retenciones no entran. **Moneda:** siempre la oficial.
- **Gastos sin stock** (pieza 4) no entran en esta pieza.

**Tomadas en este frente:**

| # | Decisión | Quién, cuándo y cómo | Costo asumido |
|---|---|---|---|
| 1 | Investigación de mercado antes de diseñar | Owner, 2026-09-28, por la sesión orquestadora ("A investigación"), entre *investigar primero* y *preguntar directo* | Una ronda más antes de las preguntas |
| 2 | **El pago se asigna a facturas.** Al pagar, la pantalla propone repartirlo desde la compra más vieja; el usuario puede cambiar el reparto. Cada compra muestra su estado: pagada, "te faltan $X" o vencida | Owner, 2026-09-28, por la sesión orquestadora ("Vamos con A"), entre *A: elegir facturas con propuesta* (recomendada), *B: cuenta corriente sin atar a facturas* y *C: automático a la más vieja, sin elegir*. Escena: Don Pedro, $120.000 + $80.000, paga $150.000 | Un paso más al pagar (revisar el reparto propuesto) y lo más trabajoso de construir. Se descartó B porque no dice qué factura está pagada ni vencida, y C porque no se puede corregir sin anular el pago |
| 3 | **El efectivo sale solo de la caja abierta de quien paga.** Si no tiene caja abierta, la abre, o registra el pago alguien que sí la tiene (con el permiso de pagar). Ninguna regla de caja cambia: los movimientos siguen siendo solo del dueño del turno | Owner, 2026-09-28, por la sesión orquestadora ("Vamos con la A"), entre *A: solo la caja propia* (recomendada) y *B: elegir cualquier caja abierta, limitado a quien supervisa cajas*. Escena: Don Pedro cobra $80.000, el dueño sin caja y Marta con la suya abierta. Resolvía el choque entre "se elige de qué caja sale" y "queda en el turno de quien lo hizo" (18/09): manda el segundo | El dueño que no atiende caja no puede pagar en efectivo sin abrir una. Se descartó B porque el descuadre de un error del que paga caería en el cierre de otra persona. **B queda como posible suma futura** si se ve que el dueño nunca abre caja |
| 4 | **El vencimiento sale del plazo en días de cada proveedor**, contado desde la fecha del documento, y se puede cambiar en cada compra. Si el XML de la factura trae `FchVenc`, manda esa fecha. Un proveedor sin plazo cargado usa **30 días** | Owner, 2026-09-28, por la sesión orquestadora ("A"), entre *A: plazo por proveedor, editable por compra* (recomendada) y *B: fecha tipeada en cada compra*. Escena: Don Pedro 30 días, Andina 15, factura de Andina del 1/10 vence el 16/10 | Un dato más en la ficha del proveedor; un plazo mal cargado hace vencer mal todas sus compras hasta corregirlo. Se descartó B porque la compra sin fecha tipeada nunca aparece como vencida |
| 4b | **Una factura en cuotas queda con un solo vencimiento**, el de la fecha final. Las cuotas se pagan como pagos parciales | Tomada por esta sesión y planteada al owner junto con la 4 ("decido yo salvo que digas otra cosa"); **no la objetó** (2026-09-28) | Se pierde el aviso de cada cuota vencida. El XML puede traer hasta 30 pagos programados (`MntPagos`, Formato DTE v2.5) |
| 5 | **Se puede pagar sin factura (anticipo).** El pago sale de la caja ese día y queda **a favor** con el proveedor; al pagar su próxima compra, la pantalla propone usar ese saldo. El mismo saldo a favor recibe lo pagado de más cuando una corrección baja el total de una compra ya pagada: corregir el total transcrito, o, en una compra sin documento o con boleta, corregir una línea (§ 6). En una factura, corregir una línea no cambia la deuda (decisión 10) | Owner, 2026-09-28, por la sesión orquestadora ("Dale con A"), entre *A: se permite el pago sin factura* (recomendada) y *B: solo se paga contra una compra cargada*. Escenas: una compra de Andina pagada por $100.000 que resulta ser de $90.000 (saldo a favor en las dos opciones), y $50.000 adelantados a Don Pedro sin factura. *Redacción corregida al aprobar la spec* (sesión orquestadora, 2026-09-28): la escena se planteó como "un precio mal tipeado", que con la decisión 10 ya no baja la deuda de una factura; el caso es un total transcrito mal | Una opción más en la pantalla de pago y un saldo a favor que puede quedar olvidado. Se descartó B porque el efectivo del adelanto sale del cajón sin registro: descuadra, o se paga dos veces al llegar la factura |
| 6 | **Anular un pago en efectivo con su caja ya cerrada no toca ninguna caja.** La deuda vuelve y el cierre queda como quedó. Con la caja todavía abierta, la plata vuelve sola a esa caja, y solo su dueño puede anular (decisión 3) | Owner, 2026-09-28, por la sesión orquestadora ("A"), entre *A: no toca caja* (recomendada), *B: la plata entra a la caja abierta de quien anula* y *C: no se puede anular con la caja cerrada*. Escena: Marta registró por error $80.000 a Don Pedro, cerró con $80.000 de sobrante, y el jueves se anula | Si la plata sí había salido y el proveedor la devuelve, quien la recibe la anota como entrada manual en su caja. Se descartó B porque mete un descuadre en la caja de otro, y C porque deja la compra pagada cuando no lo está |
| 6b | **Anular una compra que ya tenía pagos deja lo pagado a favor** con el proveedor (mecanismo de la decisión 5) | Tomada por esta sesión y mostrada al owner junto con la 6; **no la objetó** (2026-09-28) | — |
| 6c | **Anular un pago por transferencia solo devuelve la deuda**; no toca caja | Tomada por esta sesión y mostrada al owner junto con la 6; **no la objetó** (2026-09-28) | — |
| 7 | **Permiso nuevo `Compras:Pagar`**: registrar pagos y anticipos, y anular pagos. Sin él, "¿la pagaste ya?" no aparece al confirmar y la compra queda como deuda. Anular un pago va con `Pagar`, no con `Anular` (el de la compra entera), para que quien se equivocó de monto lo deshaga desde su caja abierta | Owner, 2026-09-28, por la sesión orquestadora ("Dale con A"), entre *A: permiso propio `Pagar`* (recomendada) y *B: pagar va con `Actualizar`*. Escena: Juan, el bodeguero, recibe la feria y paga $35.000 de su caja | Un permiso más que configurar por rol. Se descartó B porque no deja corregir facturas sin tocar plata, que es lo que la spec de recepción quería separar ("el bodeguero recibe y el dueño paga") |
| 7b | **El rol `Compras · Encargado` arranca sin `Pagar`**; el admin se lo da si quiere | Propuesta de esta sesión; la orquestadora se la preguntó explícito al owner junto con la 7 y respondió "Dale con A" **sin objetarla** (2026-09-28) | — |
| 8 | **Se puede pagar una compra a la que todavía no se le sabe el total.** Pasa en dos casos: una compra sin documento o con boleta a la que le falta el precio de una línea (su total es la suma de las líneas), o una compra con documento a la que todavía no se le cargó el total (decisión 10). Mientras tanto la compra muestra lo pagado y "falta el precio de N línea(s)" o "falta el total"; en el primer caso la deuda se muestra como "al menos $X". Al completarse, la cuenta se hace sola: lo que sobra queda a favor (decisión 5), lo que falta queda como "te faltan $X" | Owner, 2026-09-28, por la sesión orquestadora ("Dale A"), entre *A: se puede pagar* (recomendada) y *B: no acepta pagos hasta completar el precio; lo pagado antes va como anticipo*. Escena: Andina, bebidas $60.000 + queso sin precio, se pagan $90.000, el queso sale $28.000 → $2.000 a favor. **Reescrita el mismo día por la decisión 10**, que el owner eligió sabiendo que el "al menos $X" quedaba solo para las compras sin documento | Mientras falta, lo que se le debe al proveedor no es un número exacto. Se descartó B porque la compra pagada al contado sin precio tipeado figuraría impaga |
| 9 | **Pantalla nueva "Por pagar"**: una fila por proveedor con lo que se le debe, lo vencido, lo que vence esta semana y el saldo a favor, ordenada por urgencia. Al tocar un proveedor, sus compras abiertas con su estado ("vencida", "te faltan $X", "falta precio") y el botón Pagar. El listado de compras suma la insignia de pago de cada compra. **Sin tabla de antigüedad** por tramos | Owner, 2026-09-28, por la sesión orquestadora ("Dale con A"), entre *A: pantalla por proveedor* (recomendada), *B: A + antigüedad 0-30/31-60/61-90/+90* y *C: solo insignia y filtro en el listado*. Escena: lunes 9:00, Don Pedro $50.000 vencido, Andina $88.000 vence el miércoles con $2.000 a favor, gas $40.000 en 20 días | Una pantalla nueva. Se descartó B porque con el tope legal de 30 días casi nunca hay números fuera del primer tramo, y C porque no muestra el total por proveedor ni el saldo a favor |
| 10 | **La deuda de una compra con documento es el total que dice el documento**, transcrito: se tipea, o sale del XML (`MntTotal`). **El sistema no lo calcula, no calcula impuestos y no lo valida contra el neto de las líneas** (la diferencia es el impuesto, y decidirlo es del frente fiscal). Sin documento o con boleta, el total es la suma de las líneas, como hoy | Owner, 2026-09-28, por la sesión orquestadora, **como pregunta aparte de la ronda de producto y marcada como que roza lo fiscal** ("A"), entre *A: total del documento transcrito* (recomendada), *B: calcular el IVA sobre el neto* (frente fiscal) y *C: la suma de las líneas*. Escena: Andina, neto $100.000 + IVA $19.000 = $119.000; con C el sistema dice $100.000 y deja $19.000 "a favor" falsos | Un campo más al cargar una factura a mano, que puede no calzar con las líneas sin que el sistema lo note. Se descartó B por ser fiscal, y C porque queda mal en toda factura afecta |
| 11 | **La guía de despacho lleva el total como opcional**: se recibe sin total y se completa cuando llega la factura. **La factura que agrupa varias guías queda fuera** (§ 13): su total se reparte a mano entre las compras | Propuesta de esta sesión en la spec (§ 14); **confirmada por el owner** al aprobarla (2026-09-28, por la sesión orquestadora: "Sí, aprobado con esos dos cambios") | La factura de tres guías se reparte a mano; entrada en `pendientes.md` |
| 12 | **Lo que se debe lo ve solo quien tiene `Pagar`.** "Por pagar", el detalle por proveedor y los pagos van con `Pagar`, no con `Leer`; y a quien tiene `Leer` sin `Pagar`, el listado y el detalle de compras **no le mandan** los datos de pago (§ 8) | Hallazgo de la sesión orquestadora al revisar la spec, **aceptado por el owner** al aprobarla (2026-09-28): con `Leer`, el bodeguero veía lo que se le debe a cada proveedor, contra "el bodeguero recibe y el dueño paga". Qué pasa con los campos de pago del listado y el detalle lo decidió esta sesión, a pedido de la orquestadora (§ 8) | Quien carga compras no ve si una compra está pagada. Lo que él mismo transcribe (total, vencimiento) lo sigue viendo |

**Los 30 días, verificados contra el texto legal.** Ley 19.983, art. 2, en el texto que le
dio la Ley 21.131 ([texto publicado](http://www.sice.oas.org/SME_CH/CHL/Ley_21131_s.pdf),
generado por la BCN): el plazo máximo es de **treinta días corridos contados desde la
recepción de la factura**; un plazo mayor exige acuerdo escrito, suscrito e **inscrito en un
registro del Ministerio de Economía** dentro de cinco días hábiles, y si no, "se tendrán por
no escritas". Y si la factura no menciona plazo, *"se entenderá que debe ser pagada dentro de
los treinta días corridos siguientes a la recepción de la factura"*: el default de 30 días es
el de la propia ley. **Decisión técnica de esta sesión:** el sistema cuenta desde la fecha del
documento, no desde la recepción, porque la compra no guarda cuándo llegó la factura (la
fecha de confirmación es cuándo llegó la mercadería). Como la recepción nunca es anterior a
la emisión, el vencimiento calculado cae el mismo día o antes que el legal: nunca después.

---

## 3. El modelo

Tablas y columnas nuevas. Todas las tablas con `tenant_id`, `creado_el`/`actualizado_el`,
`eliminado_el`, PK `uuid` explícito y fechas `timestamptz` (las invariantes automatizadas).

| Dónde | Qué | Por qué |
|---|---|---|
| `terceros.plazo_pago_dias` | `int` NULL, > 0 | El plazo del proveedor (decisión 4). NULL = 30 días |
| `tipos_documento_compra.total_documento` | `text` NOT NULL: `'suma_lineas'` · `'obligatorio'` · `'opcional'` | Qué tipos llevan total transcrito (decisión 10). Catálogo por país, como `requiere_folio` |
| `compras.total_documento` | `numeric(18,4)` NULL, a escala de la moneda | Lo que dice el documento que hay que pagar. NULL en los tipos `suma_lineas` y en un `opcional` que todavía no lo tiene |
| `compras.fecha_vencimiento` | `date` NULL | Se fija al confirmar (§ 4.2) y se puede corregir |
| `pagos_proveedor` | `proveedor_id`, `fecha` (`timestamptz`), `monto` (> 0), `metodo_pago_id`, `referencia` NULL, `caja_id` NULL, `creado_por`, `estado` (`'vigente'` · `'anulado'`), `anulado_por`, `anulado_el`, `motivo_anulacion` | Un pago real: plata que salió, por un medio, un día |
| `pago_proveedor_aplicaciones` | `pago_proveedor_id`, `compra_id`, `monto` (> 0) | Cuánto de ese pago cubre esa compra (decisión 2). Lo no aplicado de un pago es saldo a favor (decisión 5) |
| `movimientos_caja.pago_proveedor_id` | `uuid` NULL | La salida (o su reversa) de un pago en efectivo. Mismo patrón que `venta_id` y `pago_id` |

Seed de `tipos_documento_compra.total_documento` en Chile: Factura, Factura exenta y Factura
de compra → `obligatorio`; Guía de despacho → `opcional`; Boleta y Sin documento →
`suma_lineas`. En los demás países: Factura → `obligatorio`; Sin documento → `suma_lineas`.

**Las aplicaciones no se editan.** Un ajuste (§ 6) marca `eliminado_el` en la aplicación y,
si queda un resto, inserta otra por ese resto: queda el rastro de qué se aplicó y cuándo.

## 4. La cuenta

### 4.1 Total, deuda, saldo a favor y estado

- **Total de la compra:** `total_documento` si el tipo lo lleva. Si el tipo es
  `suma_lineas`, Σ cantidad × precio − descuento, **cuantizado una sola vez** a la escala de
  la moneda oficial con el modo de redondeo del tenant (la `cuantizar` del motor, importada,
  no modificada). **Desconocido** si falta el total transcrito o, en `suma_lineas`, el
  precio de alguna línea.
- **Aplicado:** Σ aplicaciones vivas de pagos vigentes a esa compra.
- **Deuda de la compra:** total − aplicado, si el total se conoce. Nunca negativa: § 6 lo
  sostiene recortando aplicaciones.
- **Saldo a favor de un pago:** monto − Σ sus aplicaciones vivas. **Del proveedor:** la suma
  sobre sus pagos vigentes.
- **Estado de pago** (derivado, no guardado, igual que "falta costo"): `pagada` (deuda 0),
  `parcial` (aplicado > 0 y deuda > 0), `pendiente` (sin aplicado); encima, la marca
  `vencida` si queda deuda (o el total es desconocido) y `fecha_vencimiento` < hoy, con "hoy"
  en la zona del tenant (`rango-fecha.util.ts`). Con total desconocido: `falta_total` o
  `falta_precio`, y en `suma_lineas` la deuda mínima conocida ("al menos $X", decisión 8).
- **Solo cuentan las compras `confirmada`.** Un borrador no debe nada; una anulada tampoco.

### 4.2 El vencimiento

Al **confirmar**: si el borrador trae `fechaVencimiento` (tipeada, o del XML `FchVenc`), esa;
si no, `fecha_documento + (terceros.plazo_pago_dias ?? 30)`. Se corrige después con
`PATCH /compras/:id/documento`. Por qué desde la fecha del documento: el párrafo de la ley,
arriba.

### 4.3 Moneda y escala

Todo en la moneda oficial. `totalDocumento` y los `monto` de pagos y aplicaciones van
marcados `@EsMontoCobrado` y pasan por `EscalaMonedaPipe`. Un monto que no cabe en la moneda
es 400: el sistema no redondea lo que alguien tipea.

## 5. Pagar

### 5.1 `POST /compras/pagos`

```
{ proveedorId, monto, metodoPagoId?, referencia?,
  aplicaciones: [{ compraId, monto }] }        // vacía = anticipo
```

- `monto` ≥ 0. **`monto` = 0 con aplicaciones** es "usar el saldo a favor" (decisión 5): no
  crea pago ni toca caja. `metodoPagoId` es obligatorio si `monto` > 0.
- Las aplicaciones se fondean **primero con el saldo a favor** del proveedor (sus pagos más
  viejos primero) y después con el pago nuevo. Una aplicación del request puede quedar
  partida en dos filas.
- 400 si: el proveedor no está vivo; una compra no es del proveedor, no está `confirmada` o
  se repite; Σ aplicaciones > saldo a favor + `monto`; una aplicación supera la deuda de su
  compra **cuando el total se conoce** (con total desconocido no hay tope, decisión 8: § 6
  recorta después). Lo que sobra del `monto` queda a favor.
- **La propuesta de reparto la arma la pantalla** (la más vieja primero, por
  `fecha_vencimiento` y después `fecha_documento`); el servidor valida el reparto que llega,
  no lo decide.
- **Efectivo** (`metodos_pago.es_efectivo`): el servidor busca la caja física **abierta del
  usuario** (`CajaService.findActiva`); **nunca viene del body** (decisión 3). Sin caja: 400
  "Para pagar en efectivo necesitás tu caja abierta". Con caja: la **misma** validación que
  la salida manual —`calcularEsperadoEfectivo` y, si no alcanza, `IntentoRechazadoError('Saldo
  insuficiente en caja', { tipo: 'pago_proveedor', motivo: 'saldo_insuficiente', … })` dentro
  de `conRastroDeRechazo`— y la salida con `registrarMovimientoEnTransaccion` (`tipo:
  'salida'`, concepto "Pago a proveedor · <nombre>", `metodoPagoId`, `pagoProveedorId`), en la
  misma transacción que el pago.
- **Otro medio:** no toca caja (`caja_id` NULL).
- **Idempotencia:** exige `Idempotency-Key` y corre dentro de `IdempotenciaService.ejecutar`
  (ADR-026, pattern backend § 18), operación nueva `compras.pago`: un reintento tras un corte
  no paga dos veces.
- Medios: los habilitados del tenant, que la pantalla lee de `GET /compras/medios-pago`
  (pattern backend § 19: lista propia, no la de otro módulo).

### 5.2 `POST /compras/pagos/:id/anular` con `{ motivo }`

- Marca el pago `anulado` y `eliminado_el` en sus aplicaciones vivas: las compras vuelven a
  deber (decisión 6c).
- **Efectivo con su caja todavía abierta:** solo el dueño de esa caja puede anular (403 si
  no), y se genera la **entrada** reversa en esa misma caja, con `pagoProveedorId`.
  **Con la caja ya cerrada o en conciliación:** no toca ninguna caja (decisión 6).
- Si el saldo a favor de ese pago había fondeado otras compras, esas vuelven a deber: la
  plata no se pagó.

### 5.3 El rastro de intentos rechazados

Un pago en efectivo sin plata en la caja deja su fila en `caja_intentos_rechazados` con
`tipo: 'pago_proveedor'`. **No cambia la regla del rastro** (qué guarda, que sobrevive al
rollback, quién lo lee): suma un camino a su tabla en `gestion-cajas.md` y un rótulo en
`CajaIntentosRechazados.vue`. El 422 no interpola el esperado (modo ciego).

## 6. Correcciones y anulaciones de la compra

Cuando el total de una compra **baja** o **pasa a conocerse** —corregir precio o cantidad de
una línea en un tipo `suma_lineas`, el descuento, o `totalDocumento`—, en la misma transacción
se **recortan sus aplicaciones** hasta que el aplicado no supere el total, **de la más nueva a
la más vieja**: el resto vuelve a su pago como saldo a favor (decisiones 5 y 8). Si el total
sube, no se toca nada: la compra pasa a deber la diferencia.

**Anular una compra** marca `eliminado_el` en todas sus aplicaciones: lo pagado vuelve a
favor (decisión 6b). Los pagos siguen vigentes.

**`PATCH /compras/:id/documento`** con `{ totalDocumento?, fechaVencimiento? }` (ausente =
no se toca; `totalDocumento: null` solo en un tipo `opcional`), permiso **`Actualizar`**:
corregir lo transcrito es lo mismo que corregir un precio. En un tipo `suma_lineas`,
`totalDocumento` es 400.

## 7. La compra al contado, en un solo gesto

- **Borrador:** `POST`/`PATCH /compras` aceptan `totalDocumento` y `fechaVencimiento`
  opcionales. El XML los pre-llena (`MntTotal`, `FchVenc`).
- **Confirmar** (`POST /compras/:id/confirmar`) exige el total si el tipo es `obligatorio`
  (400 "Falta el total del documento"), fija el vencimiento (§ 4.2) y acepta un cuerpo
  opcional `{ pago: { monto, metodoPagoId, referencia? } }`.
- **Con `pago`:** exige `Compras:Pagar` —resuelto en el controller, como
  `resolverEscrituraCompartida` en caja, porque el decorador no puede exigirlo solo cuando
  viene el campo— y `Idempotency-Key`. En **la misma transacción** confirma y corre § 5.1 con
  una aplicación a esta compra por `min(monto, total)` (por `monto` si el total es
  desconocido). Si el pago falla (sin caja abierta, caja sin plata), **no se confirma nada**:
  es un gesto, no dos.
- **Sin `Pagar`:** la pantalla no pregunta "¿la pagaste ya?" (decisión 7), y mandar `pago` es
  403.

## 8. Lo que ve el dueño

Todo lo de esta sección es de **`Pagar`** (decisión 12): "el bodeguero recibe y el dueño
paga", y lo que se le debe a cada proveedor es información del que paga.

- **`GET /compras/por-pagar`** (`Pagar`): una fila por proveedor con la deuda conocida, lo
  vencido, lo que vence en los próximos 7 días, cuántas compras tienen el total desconocido y
  el saldo a favor; ordenada por vencido y después por lo que vence pronto. Una consulta con
  agregación, sin N+1. Sin deuda y sin saldo a favor, el proveedor no aparece.
- **`GET /compras/por-pagar/:proveedorId`** (`Pagar`): sus compras confirmadas con deuda o
  total desconocido, con estado y vencimiento; sus pagos vigentes con saldo a favor.
- **`GET /compras/pagos?proveedorId=`** (`Pagar`): los pagos, con su caja y sus aplicaciones.
- **`GET /compras` y `GET /compras/:id`** siguen con `Leer`, y **solo a quien además tiene
  `Pagar`** le suman los datos de pago: `estadoPago`, `deuda` y `vencida` en cada fila; total,
  aplicado, deuda y los pagos que la cubren en el detalle. **A quien no tiene `Pagar` no se los
  manda**: no vienen en la respuesta, y el filtro `estadoPago` es 403. El controller resuelve
  el permiso y el service arma la consulta con o sin la parte de pagos. Lo que sí le llega es
  lo que él mismo transcribe: `totalDocumento` y `fechaVencimiento`.
  *Por qué omitir y no dejar solo la insignia* (decisión de esta sesión, a pedido de la
  orquestadora): la insignia "Pagada · Te faltan $X · Vencida" **es** el dato de pago —dice
  cuánto se debe y a quién—, así que dejarla reabre lo que la decisión 12 cierra. Y esconderla
  solo en la pantalla no alcanza: el dato viajaría igual en la respuesta (invariante 6: el
  permiso se hace cumplir en el backend).

## 9. Permisos y API

Todas bajo `JwtAuthGuard + TenantGuard + PermisosGuard`, con el `tenant_id` del token. Las
rutas con nombre van **antes** de `@Get(':id')`.

| Endpoint | Permiso |
|---|---|
| `GET /compras/por-pagar` · `GET /compras/por-pagar/:proveedorId` · `GET /compras/pagos` | Pagar |
| `GET /compras` · `GET /compras/:id` con los datos de pago (y el filtro `estadoPago`) | Leer + Pagar; con `Leer` solo, sin esos datos (§ 8) |
| `GET /compras/medios-pago` | Pagar |
| `POST /compras/pagos` (con `Idempotency-Key`) | Pagar |
| `POST /compras/pagos/:id/anular` | Pagar |
| `PATCH /compras/:id/documento` | Actualizar |
| `POST /compras/:id/confirmar` con `pago` | Crear + Pagar |
| `PATCH /terceros/:id` con `plazoPagoDias` | el de Terceros, sin cambios |

Seed: la acción `Pagar` en el módulo `Compras` (el admin la tiene por rol fijo); el rol
`Compras · Encargado` **sin** `Pagar` (decisión 7b); un fixture con `Pagar` (el dueño que
paga) para el Playwright y los 403 del de carga. Ids: los siguientes libres del seed.

## 10. Las pantallas

- **Ficha del proveedor** (`pages/terceros.vue`): "Plazo de pago (días)"; vacío = 30.
- **Carga del borrador** (`pages/compras/[id].vue`): "Total del documento" (obligatorio,
  opcional u oculto según el tipo) y "Vence el" (sugerido desde el plazo, editable). El XML
  los pre-llena.
- **Confirmar:** con `Pagar`, el modal suma "¿La pagaste ya?" → No / Sí, con medio y monto
  (propuesto: el total). Efectivo sin caja abierta: el aviso antes de mandar, y el 400 igual.
- **Detalle de una confirmada** (`CompraConfirmada.vue`): total, vencimiento y "Corregir
  total o vencimiento" (`Actualizar`); con `Pagar`, además pagado, deuda, sus pagos y "Pagar".
- **`pages/compras/por-pagar.vue`** (nueva, detrás de `Pagar` con middleware de ruta, no un
  `v-if` por botón): la lista por proveedor (decisión 9); al tocar uno, sus compras abiertas y
  sus pagos con saldo a favor. Sin `Pagar`, la entrada no aparece en el menú **y** la ruta del
  backend contesta 403.
- **`PagarProveedorModal.vue`** (nuevo): monto, medio, referencia, el saldo a favor propuesto
  y el reparto propuesto (la más vieja primero), editable; lo que no se reparte queda a favor
  y la pantalla lo dice. Manda la clave con `useIntentoCobro` (pattern frontend § 18).
- **Anular un pago:** desde el detalle del proveedor, con motivo; en efectivo con la caja
  cerrada, el modal avisa que no vuelve plata a ninguna caja.
- **Listado de compras:** con `Pagar`, la insignia de pago (Pagada · Te faltan $X · Vencida ·
  Falta total) y su filtro; sin `Pagar`, ni la insignia ni el filtro.
- Utilidades de presentación en `composables/useCompras.ts`; los montos, strings de punta a
  punta.

## 11. El orden de bloqueo

Toda escritura de esta pieza toma, en este orden: **las compras** involucradas (`FOR UPDATE`,
`ORDER BY compra_id`) → lo que compras ya toma hoy (ubicación, productos, movimientos) si el
camino mueve stock → **los pagos del proveedor** que fondean o se anulan (`FOR UPDATE`,
`ORDER BY pago_proveedor_id`) → **la caja** (`bloquearCajaAbierta`). Pagar no toca stock y
salta del primero al tercero. Cada `ORDER BY` de un `FOR UPDATE` nuevo va con su unitario
sobre el SQL (pattern backend § 15). Dos pagos simultáneos a las mismas compras se serializan
en el primer lock, y el segundo ve la deuda ya bajada.

## 12. Testing

- **Unitarios** del service: el fondeo (saldo primero, más viejo primero, partición), el
  recorte (de la más nueva), el estado derivado, el vencimiento, la cuantización única del
  total `suma_lineas`, y el SQL de los locks.
- **E2E de API** (Postgres real, `validacionGlobal()`, `Idempotency-Key` nueva por POST):
  Don Pedro ($120.000 + $80.000, paga $150.000 → la del lunes pagada y $50.000 de la otra);
  Andina (factura pagada por $100.000 cuyo total transcrito se corrige a $90.000 → $10.000 a
  favor, usados en la próxima; y una línea de factura corregida que **no** cambia la deuda); anticipo de
  $50.000 usado en una de $80.000; queso sin precio pagado de más → $2.000 a favor al
  completar (sin documento); factura sin total → "falta total" y pagable; efectivo sin caja
  (400), sin plata (422, fila en el rastro, sin el esperado en el mensaje) y con caja (la
  salida baja el esperado); anular con la caja abierta (entrada), con la caja cerrada (nada)
  y la caja ajena abierta (403); anular la compra (a favor); confirmar con un pago que falla
  (nada confirmado); el reintento con la misma clave (un solo pago); **403 de `Pagar` con el
  rol real del bodeguero** en `POST /compras/pagos`, `por-pagar`, `por-pagar/:id`, `pagos` y
  el filtro `estadoPago`; y con ese mismo rol, `GET /compras` y `GET /compras/:id` **sin** los
  campos de pago en el body (decisión 12); montos fuera de escala (400); proveedor, compra o
  pago de otro tenant (404).
- **Vitest:** la propuesta de reparto y los rótulos del composable; el modal de pagar con la
  clave de idempotencia; la carga con total y vencimiento; confirmar con y sin `Pagar`.
- **Playwright**, con el rol real que paga y con el bodeguero sin `Pagar`: recibir la feria y
  pagarla al contado en un gesto (el efectivo baja en la caja); pagar dos compras de un
  proveedor desde "Por pagar"; el bodeguero no ve "¿la pagaste ya?", ni la entrada "Por
  pagar", ni la insignia de pago, y al entrar por URL a `/compras/por-pagar` lo frena el
  middleware; su llamada a la API da 403 (lo cubre el e2e).

## 13. Fuera de esta pieza

- ⛔ **Lo fiscal**: calcular IVA o ILA, validar el total contra el neto, el crédito fiscal y
  la factura de compra (código 46) con retención. Va como entrada en `pendientes.md` para su
  frente.
- **Una factura que agrupa varias guías:** acá cada compra lleva su propio total; si una
  factura cubre tres guías, su total se reparte a mano entre las tres. Entrada en
  `pendientes.md`.
- **Pagar desde la caja de otra persona** (decisión 3, opción B): posible suma futura.
- **Un vencimiento por cuota** (decisión 4b), **la devolución de plata del proveedor** como
  flujo propio (hoy: entrada manual), **los gastos sin stock** (pieza 4) y **la moneda
  extranjera**.

## 14. Decisiones técnicas de esta sesión, para la revisión

- La deuda se deriva al leer (total − aplicaciones vivas), no se guarda: no hay columna de
  saldo que desincronizar. Las lecturas agregan en una consulta.
- El total `suma_lineas` se cuantiza **una vez** con el modo del tenant, importando
  `cuantizar` del motor sin tocarlo. Es la única cuantización de la pieza: lo transcrito ya
  llega a escala.
- La caja del pago en efectivo la resuelve el servidor, nunca el cliente.
- Un tipo nuevo en el rastro de intentos rechazados (`pago_proveedor`), sin cambiar su regla.
- El vencimiento se cuenta desde la fecha del documento (párrafo de la ley, § 2).
- Los datos de pago del listado y el detalle se **omiten** de la respuesta para quien no
  tiene `Pagar`, en vez de esconderse en la pantalla (§ 8, decisión 12).
- La guía de despacho con total `opcional` se propuso acá y el owner la confirmó al aprobar
  (decisión 11).
