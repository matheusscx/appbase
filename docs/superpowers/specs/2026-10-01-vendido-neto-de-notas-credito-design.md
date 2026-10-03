# El vendido, el cobrado y el "Total facturado" restan las notas de crédito

**Fecha:** 2026-10-01 · **Tipo:** spec de diseño
**Frente:** *"El vendido, el cobrado y el 'Total facturado' restan las notas de crédito del día en que
se emiten"*, en [`docs/agent/resueltos.md`](../../agent/resueltos.md) (salió de `pendientes.md` § 3 al cerrarse). Es **fiscal y va solo**
(`CLAUDE.md`, ADR-010).
**Investigación:** [`2026-09-30-vendido-y-notas-credito.md`](../../agent/investigaciones/2026-09-30-vendido-y-notas-credito.md).
**Decisiones:** § 2. Cada una dice quién la tomó y cómo.

---

## 1. El problema

Hoy toda nota de crédito (NC) es invisible para los números del negocio:

- **Vendido, cantidad, ticket, Local/Online y lo más vendido** del inicio (`GET /resumen-negocio/hoy`)
  la **excluyen**: no la suman ni la restan. El vendido lleva el rótulo "(antes de notas de crédito)".
- **Cobrado** no la ve. La NC nunca escribe `pagos`, y el efectivo devuelto queda como `salida` en
  `movimientos_caja`, con el `venta_id` de la NC. El arqueo resta esa salida, así que **el cobrado
  y la caja del mismo día cuentan la devolución al revés**. El reembolso por Webpay tampoco resta:
  queda como `REFUND` en `pasarela_transacciones`.
- **"Total facturado" de `/ventas`** (`GET /ventas/resumen`) la excluye con **otro mecanismo**:
  compara contra el id del tipo del país (`tipoNotaCreditoDelTenant`), mientras el dashboard usa
  `es_nota_credito`. Ese resumen **no tiene fecha**, porque suma desde siempre, y además **suma
  las canceladas**: una mesa anulada de $40.000 sigue en "Total facturado", en "Ventas
  registradas" y como $40.000 de "Saldo pendiente".
- **"Saldo pendiente" de `/ventas` y "Por cobrar" del inicio** calculan `total − pagado` y no ven
  la NC. Una venta de $100.000 con $40.000 pagados y una NC por $60.000 aparece con $60.000 por
  cobrar. Pasa porque la NC manual se puede emitir sobre una venta `pagada_parcial`
  (`ventas.service.ts`, `crearNotaCreditoEnTransaccion`).

### Lo medido antes de diseñar (2026-10-01)

- **Toda NC tiene líneas.** La NC por monto libre también: su línea va contra el ítem de sistema
  "Ajuste" (`items.es_ajuste_nota_credito`). La NC con devoluciones lleva una línea por ítem real.
  Esas líneas van valorizadas al precio de la venta original y escaladas para no pasar el monto.
  El resto va a la línea de ajuste (`ajusteTotal = monto − líneas`). Así la cabecera es la suma de
  las líneas.
- **La NC copia de la original** `canal`, `caja_id` y `moneda_id`, y la moneda ya es la oficial.
  Su `total_final` es positivo y su `fecha` es la de la emisión.
- **El reembolso por pasarela** (`reembolso-callback.handler.ts`) **no pasa `devolverDinero`**: no
  deja salida de caja. La NC es opcional (`generarNotaCredito`), así que puede haber `REFUND` sin
  NC.
- **El `REFUND` no guarda qué NC generó.** `aplicarPostReembolso` devuelve `notaCreditoId` en la
  respuesta, pero no lo persiste.
- **El cobro online sí escribe `pagos`** (`online-callback.handler.ts`), así que hoy suma en el
  cobrado.

## 2. Las decisiones

| # | Decisión | Quién y cómo |
|---|---|---|
| D1 | El vendido es lo vendido menos las NC con fecha de ese día, aunque la venta original sea de otro día. Debajo va "bruto $X · notas de crédito −$Y". Sale el rótulo "(antes de notas de crédito)". La semana pasada se calcula igual. | Owner, 2026-09-30 (entrada en [`resueltos.md`](../../agent/resueltos.md)) |
| D2 | El cobrado descuenta lo devuelto ese día. | Owner, 2026-09-30 |
| D3 | "Total facturado" usa el mismo criterio y el mismo rótulo, con **un solo** mecanismo para reconocer una NC. | Owner, 2026-09-30 |
| D4 | La NC **no es una venta**: la cantidad no la cuenta. El ticket es el neto dividido por la cantidad. Local/Online van en neto, así que suman el número grande. | Owner, AskUserQuestion 2026-10-01 |
| D5 | Lo más vendido resta las líneas de mercadería de la NC, con su cantidad y su monto. Las líneas de "Ajuste" no restan. Solo entran ítems con neto > 0. | Owner (AskUserQuestion) + orquestadora (`b5436263`) |
| D6 | El cobrado resta **dos** cosas: el efectivo devuelto por NC y los `REFUND` aprobados de pasarela, con o sin NC. Debajo va "cobrado $X · devuelto −$Y". | Owner, AskUserQuestion 2026-10-01 |
| D7 | El vendido negativo se muestra tal cual. La variación es "—" cuando la semana pasada es cero **o negativa**. | Owner, AskUserQuestion 2026-10-01 |
| D8 | El ticket es "—" con neto ≤ 0 o sin ventas. | Orquestadora (`61810f42`) |
| D9 | `/ventas` saca las canceladas: de "Total facturado", de "Ventas registradas" y, como consecuencia, de "Saldo pendiente". | Owner, AskUserQuestion 2026-10-01 |
| D10 | **Cerrado por la tarea 14 del frente de emisión (2026-10-02): reemplazado por la expresión única del saldo** (`backend/src/modules/ventas/saldo-venta.ts`): `total − Σ aplicado − Σ correcciones "no vuelve plata"`, con piso 0. Una corrección que devolvió plata (efectivo, tarjeta, pasarela) no cambia lo que se debe. Lo que decía: saldo por venta = `total − NC de esa venta − (pagado − devuelto)`, con piso 0; "devuelto" era **solo** el efectivo de `movimientos_caja` con `venta_id` de una NC, y los `REFUND` quedaban afuera porque no guardaban su NC (§ 1). Las NC siguen fuera de la suma como ventas. | Orquestadora (`b5436263`, `61810f42`); cierre: orquestadora, 2026-10-02 |
| D11 | "Por cobrar" del inicio usa la misma regla que "Saldo pendiente" de `/ventas`. | Owner, AskUserQuestion 2026-10-01 |
| D12 | El reembolso por pasarela sin NC: "lo vemos aparte". Tiene entrada propia en la § 6, y mientras tanto el saldo no lo cuenta. | Owner, AskUserQuestion 2026-10-01 |

**Lo que D10 dejaba mal, a sabiendas (cerrado por la tarea 14, 2026-10-02: con la expresión única se deben $40).** El caso es una venta pagada en parte por pasarela, con saldo
vivo, `REFUND` y NC. Con $100 de total, $60 pagados, y `REFUND` y NC de $20 cada uno, se deben $40
y la fórmula da 20: el saldo muestra **de menos** lo reembolsado. Lo cubre la entrada de D12.

## 3. Diseño

No hace falta una arquitectura nueva. Cambian las consultas de los dos servicios que ya existen, los
tipos de respuesta y los dos componentes que las muestran.

### 3.1 Cómo se reconoce una corrección (D3)

Un solo mecanismo, y no es ninguno de los dos de hoy: una venta que corrige a otra se reconoce por
**`v.venta_referencia_id IS NOT NULL`**. Ni `es_nota_credito` del catálogo (el inicio) ni el id del
tipo del país (`/ventas/resumen`).

- **Por qué esta columna** (orquestadora, 2026-10-01, última viñeta de la entrada en
  [`resueltos.md`](../../agent/resueltos.md)): el frente de emisión (`2026-10-01-emision-por-venta-design.md` § 3.7, E7) suma la
  devolución interna, que corrige una venta sin ser documento tributario. Con esta columna resta
  sola, y ese frente no reescribe estas consultas.
- **El resultado hoy es idéntico.** El único que escribe `venta_referencia_id` es
  `crearNotaCreditoEnTransaccion` (`ventas.service.ts`, `ventaReferenciaId: params.ventaOriginalId`);
  el seed no la escribe. Medido el 2026-10-01 con un grep de `venta_referencia_id` y
  `ventaReferenciaId` sobre `backend/src`.
- **Lo que sale con el mecanismo viejo.** Las consultas de este frente dejan de cruzar
  `tipos_documento_tributario`, así que también sale el `LEFT JOIN` sin `td.eliminado_el IS NULL` y
  el comentario que justificaba esa excepción: no queda lectura sin filtro que justificar.
  `VentasService.resumen` deja de llamar a `tipoNotaCreditoDelTenant`. La emisión
  (`crearNotaCreditoEnTransaccion`) y los demás lectores del id del tipo (tope, composición, listado,
  detalle) no se tocan: el inventario completo es la tarea 1 del plan de emisión.

### 3.2 `GET /resumen-negocio/hoy`

**Vendido, cantidad, canal (D1, D4).** Es la misma consulta única con `FILTER`. Deja de excluir
las NC y separa los dos lados en cada período:

- **bruto:** ventas no canceladas y no NC con `v.fecha` en el período;
- **notas de crédito:** NC con `v.fecha` en el período. Su `total_final` es positivo y se resta;
- **neto** = bruto − notas, para hoy, la semana pasada y cada canal;
- **cantidad:** solo ventas, igual que hoy.

**Cobrado (D2, D6).** Cobrado neto = pagos aplicados − devuelto. Devuelto tiene dos partes:

- efectivo: `movimientos_caja` con `tipo = 'salida'`, cuyo `venta_id` es una NC, con fecha del
  movimiento en el período. Una salida de caja que no es de una NC, como un retiro, **no** cuenta;
- pasarela: `pasarela_transacciones` con `tipo = 'REFUND'` y `estado = 'aprobada'`, de una orden
  con `venta_id`, en el período.

Hoy y la semana pasada salen en consultas fijas: no hay N+1.

**Ticket (D4, D8).** El ticket es neto / cantidad, y queda `null` si la cantidad es 0 o el neto es
≤ 0.

**Variación (D7).** `calcularVariacion` devuelve `null` cuando la semana pasada es ≤ 0, no solo
cuando es cero. Vale para las cuatro comparaciones del bloque.

**Lo más vendido (D5).** Por ítem, el neto es lo vendido hoy menos las líneas de las NC de hoy, en
cantidad y en monto. Las líneas de ítems con `es_ajuste_nota_credito` quedan afuera. Se filtra
`HAVING neto_monto > 0`, se ordena por el neto y se toman 5.

**Por cobrar (D10 —reemplazado por la tarea 14—, D11).** Por venta (la expresión de abajo es la original; la vigente es la de D10): `GREATEST(total − Σ NC de la venta − (pagado − devuelto en
efectivo), 0)`. Sobre las mismas ventas `pendiente`/`pagada_parcial` que hoy, sin NC.

- **Consecuencia que el owner tiene que ver en la spec:** `cantidad` pasa a contar las ventas con
  saldo > 0. Una venta que la NC dejó en cero deja de aparecer como deuda.
- Las Σ por venta van como subconsultas correlacionadas dentro de **una sola** consulta agregada,
  la forma que ya tiene hoy. No es N+1.

**Forma de la respuesta.** Son campos nuevos y aditivos. Los nombres finales salen en el plan:

- `ventas.vendidoDesglose: { bruto, notasCredito }`, de hoy;
- `ventas.cobradoDesglose: { cobrado, devuelto }`, de hoy;
- `vendido.hoy`, `cobrado.hoy`, `porCanal` y `ticketPromedio` cambian de significado, porque pasan
  a ser netos, pero no de forma.

### 3.3 `GET /ventas/resumen` (D3, D9, D10)

Sigue sin fecha y respeta "solo mis cajas" (`filtroDeMisCajas`). La NC hereda la caja de la
original, así que cae en el mismo alcance. La consulta queda así:

- se excluyen las canceladas;
- `totalVentas` cuenta ventas no NC;
- `totalFacturado` = bruto − Σ NC. El campo es nuevo y aditivo: `totalBruto` y `totalNotasCredito`,
  para la línea de debajo;
- `saldoPendiente` = Σ por venta no NC de `GREATEST(total − NC − (pagado − devuelto en efectivo),
  0)`. Es la misma expresión que "Por cobrar". *(Reemplazado por la tarea 14 de emisión,
  2026-10-02: ahora es la expresión única de `saldo-venta.ts`, `total − aplicado − notas "no
  vuelve plata"`; ver D10.)*

La expresión del saldo queda en dos consultas, la del inicio y la de `/ventas`. Duplicar dos veces
es aceptable (`CLAUDE.md`), y se extrae a la tercera. El saldo por venta del listado **no** se toca:
tiene su propia entrada en la § 2 de `pendientes.md`.

### 3.4 Frontend

- **`InicioVentas.vue`:** sale el rótulo. Debajo del vendido va "bruto $X · notas de crédito −$Y"
  y debajo del cobrado, "cobrado $X · devuelto −$Y". Las dos líneas se muestran solo si hay notas
  o devoluciones. Un vendido negativo se ve con signo, y la variación nula se ve "—", como ya lo
  hace `formatPorcentaje`.
- **`frontend/app/types/resumen-negocio.ts`:** es el espejo, con los campos nuevos.
- **`pages/ventas/index.vue`:** la misma línea debajo de "Total facturado". Sin lógica de negocio
  en la página: solo muestra lo que llega.
- **Moneda:** el formateo de montos negativos se verifica con `formatMonto`. Si no lo soporta, el
  ajuste va en el composable y no en el `.vue`.

## 4. Lo medido al escribir el plan (2026-10-01)

Esta sección eran cuatro preguntas para la tarea 1. Se midieron al escribir el plan, y ninguna
vuelve al owner:

1. **Moneda del `REFUND`:** es la oficial y en la misma escala que `pagos`. La transacción copia
   `orden.moneda`, que sale de la constante `MONEDA_ORDEN_V1 = 'CLP'` (`pasarela-orden.entity.ts`), y
   el monto se valida con la escala de CLP antes de abrir la transacción (`CobrosService.reembolsar`,
   `validarEscalaDeMoneda`). Oneclick y Webpay Plus solo se configuran en un tenant chileno
   (`pasarela-solo-chile.e2e-spec.ts`), así que CLP es su moneda oficial.
2. **`REVERSAL`:** ningún código lo escribe. El tipo solo aparece en el comentario de la entity. No
   resta nada, y el día que alguien lo escriba es un frente nuevo.
3. **Fecha del reembolso:** `pasarela_transacciones.fecha_transaccion`. Hoy es `new Date()` al
   registrar (`TransaccionesService.registrar`), así que coincide con `creado_el`, pero es la columna
   que lleva la fecha de la operación. La salida de caja usa `movimientos_caja.fecha`, que es la que
   tiene el movimiento.
4. **Doble cuenta:** el webhook (`VentasReembolsoHandler.onReembolsoAprobado`) llama a
   `crearNotaCredito` sin `devolverDinero`, así que no deja salida de caja. Lo afirma el e2e del
   `REFUND` con NC.

Tres datos más, que fijan la forma de las consultas y de las pruebas:

- **`movimientos_caja` no tiene `tenant_id`.** El alcance del efectivo devuelto va por la NC
  (`nc.tenant_id = $1`).
- **Las líneas de la NC son positivas** (`totalLinea: l.bruto`), igual que su `total_final`. El neto
  se arma con signo en la consulta.
- **El `REFUND` no se alcanza por la app en el e2e.** `ProviderFactory.getReembolsable` solo conoce
  `oneclick` y `webpay_plus`, que hablan con Transbank, y la pasarela demo no reembolsa. El plan
  arma lo que deja el proveedor (orden y `REFUND` aprobado) y de ahí en adelante usa el camino real.

## 5. Pruebas

Los specs unitarios mockean `Db` y no ven la forma del SQL, así que la red real es el `test:e2e`.
Escenarios mínimos, con montos que discriminan (no 1, no factores iguales):

| Escenario | Lo que afirma |
|---|---|
| Venta de ayer + NC de hoy por una parte | vendido de hoy = bruto − NC; ayer no cambia; cantidad sin la NC |
| NC con `devolverDinero` | el cobrado de hoy resta el efectivo; un retiro de caja ajeno no resta |
| `REFUND` aprobado sin NC | el cobrado resta; el vendido no; el saldo no lo cuenta |
| `REFUND` con NC (webhook) | el cobrado resta **una sola vez**; no hay salida de caja |
| Día con neto negativo | vendido negativo; ticket `null`; variación `null` contra semana negativa |
| Lomito devuelto + NC de ajuste | lo más vendido resta el lomito; la línea de ajuste no aparece; un ítem con neto ≤ 0 no aparece |
| Venta `pagada_parcial` + NC por el resto | "Por cobrar" y "Saldo pendiente" la dejan en 0 y ya no la cuentan |
| Cancelada en `/ventas` | fuera de "Total facturado", "Ventas registradas" y "Saldo pendiente" |
| Alcance "mis cajas" | la NC de una venta de otra caja no resta del resumen propio |

Cada test nuevo lleva un mutante que **revierte** a la consulta de hoy y lo tiene que matar.
Después va un smoke del inicio y de `/ventas` con Playwright, como un rol con el permiso del
módulo y no como admin.

## 6. Fuera de alcance

- El % de anulaciones por garzón (§ 6 de `pendientes.md`). *(Cerrada el 2026-10-03 como "no corresponde":
  el owner decidió que la nota no toca ese %; ver `resueltos.md`.)*
- La NC que se emite dos veces al reintentar (§ 6).
- El reembolso por pasarela sin NC y el caso de D10 (§ 6, entrada nueva). *(Cerrada por la tarea 14
  de emisión, 2026-10-02: ver D10.)*
- El saldo por venta del listado, el listado de deuda, y si se puede seguir cobrando una venta ya
  acreditada (§ 2).
- El motor de precios y la emisión de la NC: no se toca `crearNotaCreditoEnTransaccion`.

## 7. Docs vivas en el commit del código

- `docs/ESTADO.md`;
- `docs/features/dashboard-inicio.md` y `docs/features/ventas.md`: qué es vendido, cobrado,
  facturado y saldo;
- la entrada pasa de la § 3 de `pendientes.md` a `resueltos.md`.
