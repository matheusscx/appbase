# El reporte de anulaciones, con merma y cortesía separadas

**Fecha:** 2026-09-18 · **Tipo:** spec de diseño
**Frente:** *"El reporte de anulaciones de platos, separando merma de cortesía"*, en
[`docs/agent/pendientes.md`](../../agent/pendientes.md) § 6. Es la **parte 3** (y última) del frente
*"Anular un plato ya enviado a cocina"* ([spec de la parte 2](2026-09-16-anular-plato-despachado-design.md)).
**Decisiones del owner:** las cinco del 2026-09-18, en § 2.

---

## 1. El problema que cierra

Desde la parte 2, anular un plato despachado con un motivo de tipo `merma` o `cortesia` deja sus
movimientos de inventario con `motivo = 'merma'`, y `GET /api/mermas` lista todo movimiento con ese
motivo sin mirar el tipo. Hoy, en el local:

- Una **cortesía** de un lomo a lo pobre aparece en Mermas como filas sueltas de sus ingredientes
  (*"Lomo 250 g · Cortesía de la casa"*, *"Papas 200 g · Cortesía de la casa"*…), mezcladas con
  *"Leche 2 L · Vencimiento"* de bodega, y el costo perdido las suma juntas.
- Un plato **no se llegó a hacer** no aparece en ningún lado fuera de la cuenta: no movió stock.
- **No hay ningún reporte que agregue.** `/mermas` es un listado; la app no tiene reportes.

## 2. Las decisiones que la sostienen

| Decisión (owner, 2026-09-18) | Por qué importa |
|---|---|
| **Dos reportes, cada uno con su pregunta.** Mermas muestra toda pérdida real —de bodega o de cocina— y deja de mostrar cortesías. Un reporte nuevo de **Anulaciones** muestra lo que pasó en las mesas, una fila por plato | Es el patrón del mercado: el *waste* vive en inventario y los *voids/comps* en el control de ventas (§ 8). El plato quemado en mesa aparece en los dos; el reporte de Anulaciones lo avisa |
| **Cada fila de Anulaciones muestra precio de carta y costo** | El precio dice cuánto se regaló (la métrica de control del mercado); el costo, cuánto dolió. El `no_elaborado` tiene precio y no tiene costo |
| **El precio se congela en la anulación** al anular | Hoy solo vive en la línea, que se borra cuando el plato se anula entero: leerlo de ahí obliga a saltarse el filtro de borrado |
| **La anulación guarda el garzón de la mesa en ese momento**, y el reporte agrupa por garzón y por quién autorizó | Si siempre autoriza el encargado, agrupar solo por quien autorizó esconde de qué garzón son las cortesías. Leer el responsable vigente de la cuenta se la atribuye al que recibió la mesa después de una transferencia |
| **Sin % sobre ventas en esta versión** | La app no calcula en ningún lado cuánto vendió cada garzón, y "de quién es la venta de una mesa transferida" es una regla nueva que merece pensarse aparte (§ 7) |
| **Lo ve quien tenga `Salones:Leer`** | Es la lectura de auditoría del salón (ya protege `GET /cuentas/:id/asignaciones`) y el dueño decide a qué rol dársela. No se crea permiso nuevo. `Salones:Anular` dejaría a quien autoriza revisándose a sí mismo |

## 3. Modelo de datos

### 3.1 `cuenta_linea_anulaciones` suma dos columnas

| Columna | Tipo | Nota |
|---|---|---|
| `precio_unitario` | `numeric(18,4)` NOT NULL | Copiado de `cuenta_lineas.precio_unitario` al anular: **lo que decía la carta**, extras incluidos, ya en la **moneda oficial**, **antes** de descuentos, recargos e impuestos (ver el docblock de la columna en `cuenta-linea.entity.ts`) |
| `garzon_id` | `uuid` NULL | `cuentas.garzon_responsable_id` **en el momento de anular**. Null si la cuenta no tenía responsable. Ni una transferencia ni una fusión posterior lo cambian |

Las escribe **un solo lugar**: `escribirAnulacionEnLinea` (`salones.service.ts`), el escritor común de
`anularLinea` y `cancelarConMotivo`. El precio sale de la línea que ya recibe; el garzón, de la cuenta que
el llamador ya tiene bloqueada. Cómo le llega el garzón —parámetro o dato de la cuenta— lo decide el plan
con el código a la vista.

**Sin backfill:** no hay datos productivos. Se cambia la entidad, se actualiza `startup-pos.sql` como
documentación y se resetea.

⚠️ **Por qué no se calcula "lo que se habría cobrado":** eso es correr el pipeline de reglas e impuestos,
es decir, el motor de cálculo, que no se toca de arrastre (`CLAUDE.md`). El reporte dice **precio de
carta**, y la pantalla lo nombra así.

### 3.2 Lo que ya existe y el reporte lee

- `cuenta_linea_anulaciones`: plato (nombre congelado), cantidad, motivo, quién autorizó (`usuarios`),
  cuándo, cuenta.
- `movimientos_inventario.cuenta_linea_anulacion_id` (parte 2): une cada anulación con los movimientos del
  consumo que descontó. Un `no_elaborado` no tiene ninguno.
- `cuentas` → `mesas` → `salones`: dónde pasó. **Después de una fusión**, la anulación de la cuenta de
  origen queda colgada de la cuenta destino (el `UPDATE` de la fusión), así que el reporte muestra la mesa
  de la destino. Es el estado que ya muestra la pantalla del salón; no se cambia.

## 4. La plata

**Precio de carta de una fila** = `cantidad × precio_unitario`. **Costo de una fila** =
`Σ cantidad × costo_unitario` de sus movimientos, la misma fórmula que `costoPerdido` en Mermas. Las dos
son **proyecciones de lectura** a `ESCALA_COSTO`: nadie las paga, no se persisten y no se redondean con
la configuración vigente del tenant (el historial no puede cambiar al cambiar esa preferencia). El
formateo a moneda es de la pantalla. Decimal.js, nunca `number`. **Los totales son la suma de las filas.**

**El costo nunca se convierte de moneda.** Está en la moneda de cada ítem movido, y la regla del owner
(2026-09-09, `pendientes.md` § 3, *"sin mezclar"*) es no meter una tasa del día adentro de un costo. Así
que el costo va **desglosado por moneda** —una lista `{ monedaId, monto }`—, por fila y en los totales. En
un tenant de una sola moneda es una sola cifra. El precio de carta ya está en la moneda oficial: una
cifra siempre.

**Tres estados del costo, que no se mezclan:**

| Estado | Cuándo | Qué muestra |
|---|---|---|
| **Valorizado** | Todos los movimientos tienen `costo_unitario` | La cifra, por moneda |
| **No aplica** | Tipo `no_elaborado`: no hay movimientos | `—` |
| **Sin valorizar** | Al menos un movimiento sin `costo_unitario` | La fila entera marcada; **no** una cifra parcial que parezca completa |

Una fila sin valorizar **no suma** al costo de los totales, y el resumen dice **cuántos platos quedaron
sin valorizar**: es la regla 6 de la spec del costo sin tipear
([`2026-08-28-merma-sin-costo-tipeado-design.md`](2026-08-28-merma-sin-costo-tipeado-design.md)), que
exige que un reporte agregado no esconda lo que no suma.

⚠️ **Hueco conocido, heredado de la parte 2, que este reporte no ve:** al anular, los ingredientes,
componentes y opciones **borrados del catálogo** se saltean sin movimiento. El costo de ese plato sale más
bajo y nada lo marca, porque desde el kardex no se distingue "no tenía ese ingrediente" de "se salteó".
Queda anotado en § 7; no se arregla acá.

## 5. API

### 5.1 `GET /api/salones/anulaciones` (nuevo)

`@RequiresPermiso('Salones', 'Leer')`, en `SalonesController`. `tenant_id` del token.

**Filtros:** `desde` / `hasta` (criterio compartido de rangos por fecha: la fecha pura se expande a la
medianoche de la zona del tenant; `rango-fecha.util.ts`), `garzonId`, `tipo`
(`merma` | `cortesia` | `no_elaborado`), `motivoBajaId`, `page` / `pageSize`.

**Respuesta:**

```
{
  resumen: {
    porTipo:      [{ tipo, platos, precioCarta, costo: [{ monedaId, monto }], sinValorizar }],
    porGarzon:    [{ garzonId | null, garzonNombre | null, platos, precioCarta, costo, sinValorizar }],
    porAutorizo:  [{ usuarioId, usuarioNombre, platos, precioCarta, costo, sinValorizar }],
  },
  data: [{
    id, creadoEl, cuentaId, cuentaNumero, mesaNombre, salonNombre,
    itemNombre, cantidad, motivoBajaNombre, tipo,
    garzonNombre | null, autorizadoPorNombre,
    precioCarta, costoEstado: 'valorizado' | 'no_aplica' | 'sin_valorizar',
    costo: [{ monedaId, monto }]
  }],
  meta: { ...paginación }
}
```

`platos` es la suma de `cantidad`. El resumen cubre **todo el rango filtrado**, no la página.

**Consultas:** un número fijo —el `COUNT`, la página y el resumen—, sin importar cuántas filas haya. El
costo de cada anulación sale de un `GROUP BY` sobre sus movimientos (por anulación y moneda) unido a la
consulta, **nunca** una consulta por fila.

**Filtro de borrado:** todo filtra `eliminado_el IS NULL` (anulaciones, movimientos, motivos), con dos
**excepciones deliberadas**, cada una con su porqué escrito en la consulta:

- el **garzón** y el **usuario** que autorizó, aunque hoy estén dados de baja;
- la **cuenta, la mesa y el salón**, aunque se hayan borrado después.

Misma razón que Mermas con el producto eliminado: es algo que ya pasó, y dar de baja a alguien después no
puede sacarlo del reporte ni bajar el total sin avisar.

⚠️ **La ruta es `/salones/anulaciones`**, un solo segmento: no choca con las rutas `:id/...` del
controller. Si el plan encuentra una colisión, la ruta estática va declarada antes.

### 5.2 `GET /api/mermas` (cambia)

- **Deja de listar cortesías:** filtra por el **tipo del motivo = `merma`**, en el listado **y** en el
  `COUNT`, para que el total no se mueva sin avisar. Un motivo en uso no se puede borrar, pero el filtro
  por tipo no depende de eso.
- Cada fila suma **`deAnulacion: boolean`** (`cuenta_linea_anulacion_id IS NOT NULL`). La pantalla la
  muestra con un badge *"Anulación en mesa"*: es lo que hace visible que el plato quemado también está en
  el otro reporte.
- **Único consumidor:** `frontend/app/pages/mermas.vue` (medido 2026-09-18). El POST y sus reglas no
  cambian.

## 6. Pantalla

**`/salones/anulaciones`**, con entrada *"Anulaciones"* en el menú (`layouts/dashboard.vue`) visible con
`can('Salones', 'Leer')`.

- **Filtros:** rango de fechas (por defecto **hoy**: el hábito del mercado es la revisión diaria),
  garzón, tipo y motivo.
- **Resumen:** tres tarjetas —*Cortesías · Mermas en mesa · No se hizo*— con platos, precio de carta y
  costo; si hay, la línea *"N platos sin valorizar"*.
- **Dos tablas chicas:** por garzón y por quién autorizó.
- **Detalle** paginado, una fila por anulación. Costo `—` si no aplica, badge *Sin valorizar* si falta.
- **Aviso fijo:** *"Las mermas de esta lista también están contadas en Mermas."*
- **Mermas** (`mermas.vue`): el badge *"Anulación en mesa"* en las filas con `deAnulacion`.

Tokens semánticos de Nuxt UI, formateo con `useFormatters` (`formatMonto`, `formatStock`), nada de
lógica de negocio en la página. Tiene que andar a ancho de teléfono.

## 7. Fuera de alcance

Cada uno queda como entrada en `pendientes.md` en el mismo commit que cierre este frente:

- **% de anulaciones y cortesías sobre lo vendido por garzón**, con la regla de de quién es la venta de
  una mesa transferida (decisión del owner, § 2).
- **La cortesía como retiro gravado con IVA** (DL 825, art. 8 d; § 8). Es **fiscal**: abre su propio
  frente con su propia sesión (`CLAUDE.md`, ADR-010) y no se cuelga de este.
- **Día comercial que cruza la medianoche:** un bar que cierra a las 2 AM parte su noche en dos. Pasa
  igual en todos los listados de hoy.
- **Ingredientes borrados que se saltean sin movimiento** al anular (§ 4): el costo sale bajo sin marca.
- Exportar a CSV, alertas por umbral.
- Anular **después** de cobrar: es una nota de crédito, que tiene su camino.

## 8. Investigación de mercado

Pasada del 2026-09-18 (Sonnet, WebSearch), pedida por el owner antes de diseñar. **Informa, no
decide** (`docs/agent/investigacion-mercado.md`): lo que sigue es lo que sobrevivió al cruce con el código.

| Hallazgo | Fuente | Qué hicimos con él |
|---|---|---|
| *Void* = no se preparó, no gasta stock; *comp* = se entregó y no se cobró, se modela como descuento del 100% y además impacta inventario | [Restaurant Systems Pro](https://restaurantsystemspro.net/use-void-vs-comp-restaurant/), [Square](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void), [TouchBistro](https://www.touchbistro.com/help/articles/using-discounts-and-voids-to-correct-errors/) | Calza con `no_elaborado` / `cortesia`, que ya existen. La cortesía **no** se modela como descuento: el motor no se toca y la línea anulada sale de la cuenta (parte 2) |
| El *waste* vive en inventario, separado de voids y comps | [Toast Inventory](https://support.toasttab.com/en/article/Toast-Inventory-Tracking-and-Managing-Waste-Canada-Ireland-and-UK) | Decisión 1 de § 2 |
| Void Summary de Toast: por motivo, conteo, *Void %* sobre ventas netas, *by Server*, *by Approver*, detalle por ítem. Lightspeed: dueño del cheque, quién autorizó, motivo, ítem, cantidad, monto | [Toast](https://support.toasttab.com/en/article/Managing-Voided-Items-and), [Lightspeed K](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403189318043-Cancellations-and-Corrections-report) | Agrupar por garzón y por quién autorizó (§ 2). El % queda fuera (§ 7) |
| Control: % sobre ventas por empleado, semáforo por umbral, revisión diaria | [Mirus](https://blog.mirus.com/restaurant-employee-theft-voids-comps), [Restaurant365](https://www.restaurant365.com/blog/how-to-reduce-restaurant-comps-and-voids/) | Filtro por defecto = hoy. Umbrales fuera (§ 7) |
| La cifra principal de un comp es el precio de venta perdido; el costo es un cálculo aparte de food-cost. Poco documentado | [Tableview](https://www.tableview.com/blog/restaurant-voids-and-comps/) | Mostramos las dos (§ 2) |
| Cómo tratan un ítem sin costo cargado: **no encontrado** en ninguna fuente pública | — | Regla propia: *Sin valorizar* (§ 4) |
| Día comercial: Square usa 24 h fijas; Toast y Lightspeed lo configuran | [Lightspeed](https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329451314459-FAQ-How-do-I-generate-sales-reports-if-I-trade-past-midnight) | Fuera (§ 7) |
| Chile — Toteat: "Reporte de Anulaciones" con quién anuló, comentario, si el producto se recuperó; la "Anulación No Recuperable" descuenta inventario | [Toteat](http://ayuda.toteat.com/es/articles/4889478-anulacion-de-boletas) | Mismo corte merma / no elaborado |
| Chile — fiscal: un retiro para consumo de terceros es venta gravada con IVA (DL 825 art. 8 d), salvo rifas y sorteos promocionales; no se encontró oficio del SII sobre la cortesía de restaurante. La merma normal se acredita con control interno; la pérdida por caso fortuito exige aviso en 48 h | [DL 825](https://www.sii.cl/pagina/jurisprudencia/legislacion/basica/dl825.doc), [SII merma](https://www.sii.cl/preguntas_frecuentes/declaracion_renta/001_140_0736.htm), [SII pérdida de existencias](https://www.sii.cl/portales/sismo/pf_perdida_exis_docum.html) | **Frente fiscal aparte** (§ 7) |

## 9. Cómo se prueba

- **Unitarios** (service del reporte): los tres estados del costo; costo desglosado por moneda sin
  convertir; precio de carta = cantidad × precio congelado; una fila sin valorizar no suma al costo y sí
  cuenta en `sinValorizar`; filtros; `escribirAnulacionEnLinea` escribe precio y garzón.
- **E2E de backend:**
  - el permiso rige: `403` sin `Salones:Leer` (molde: `permiso-operar-salon.e2e-spec.ts`);
  - anular una cortesía, una merma y un *no se hizo* y ver cada una con su precio de carta y su costo;
  - **transferir la mesa después de anular y que el garzón siga siendo el original**;
  - `cancelar-con-motivo` también deja precio y garzón;
  - Mermas deja de mostrar la cortesía, marca `deAnulacion` en la merma de mesa, y `COUNT` y listado
    coinciden.
  - Garzón propio del spec, no el del seed (se pisa entre specs).
- **Mutantes que revierten** cada decisión —el filtro por tipo en Mermas (listado y `COUNT` por
  separado), el precio congelado vs leído de la línea, el garzón congelado vs el vigente, la fila sin
  valorizar sumando—, medidos fila por fila.
- **Frontend:** spec de la página (resumen, estados del costo, aviso) y del badge en Mermas; smoke test
  en navegador antes de cerrar.

## 10. Documentación que cambia

- `docs/features/mermas-valorizadas.md`: sale el ⚠️ que anunciaba la parte 3; entra el filtro por tipo y
  `deAnulacion`.
- `docs/features/salones-mesas.md`: el reporte, su permiso y sus dos columnas nuevas.
- `docs/features/roles-permisos.md`: qué gobierna ahora `Salones:Leer`.
- `docs/ESTADO.md`: fila del reporte.
- `docs/agent/pendientes.md`: la parte 3 sale (a `resueltos.md`) y entran las de § 7. La entrada de la
  **regla 6** se reescribe, no se cierra: dice que no existe ningún reporte agregado, y desde acá existe
  uno —este— que la cumple; lo que sigue abierto es un reporte agregado **de Mermas**, que tampoco existe.
- `startup-pos.sql`: las dos columnas.
