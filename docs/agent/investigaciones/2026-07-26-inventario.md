# Inventario — análisis de mercado vs. implementación

> 🟡 **PARCIALMENTE CERRADA — dos de las seis preguntas ya están contestadas; las otras cuatro
> siguen vivas y ahora tienen entrada en el backlog** (barrido del 2026-09-03).
>
> Estaba en el peor estado posible: sección de *"preguntas abiertas para el owner"* y **cero
> menciones en el backlog**, o sea que nadie estaba esperando esas decisiones y el que la
> leyera no podía saber cuáles seguían vivas.
>
> - **1 y 2 — ¿costo de gestión o tributario? ¿método elegible por tenant?** ✅ **Contestadas
>   por [ADR-016](../../adr/016-costeo-promedio-ponderado-movil.md)**: costo promedio ponderado
>   móvil, **método único y fijo, de gestión** — no tributario, así que no hay elección por
>   tenant que persistir. Ese ADR cita explícitamente la § 1 de esta investigación.
> - **3, 4, 5 y 6 — guía de despacho en traslados · ¿bodega es sucursal? · recepción desde un
>   DTE · ¿el objetivo es el reporte de varianza?** ⛔ **Siguen abiertas**, y la 1 ya no las
>   bloquea. Anotadas en [`pendientes.md`](../pendientes.md).
>
> ⚠️ **Ojo con la 3 y la 5: son fiscales** (guía de despacho, DTE de compra) y por `CLAUDE.md`
> abren su propio frente. La **4** no es de inventario: si "bodega" resulta ser **sucursal**,
> toca cajas, ventas y usuarios.


**Fecha:** 2026-07-26 (una pasada, cuatro ejes: costeo/valoración, bodegas/traslados, compras/recepción, recuento/ajustes)
**Estado:** 🔎 En investigación — insumo, todavía no hay diseño ni decisión tomada. No se tocó código.
**Features relacionadas:** [`inventario-kardex.md`](../../features/inventario-kardex.md) · [`inventario-serializado.md`](../../features/inventario-serializado.md) · [`mermas-valorizadas.md`](../../features/mermas-valorizadas.md) · [`recetas.md`](../../features/recetas.md) · [`simulador-impacto-costos.md`](../../features/simulador-impacto-costos.md) · [`terceros.md`](../../features/terceros.md)

> ⚠️ Método (`docs/agent/investigacion-mercado.md`): lo que trae el mercado es **insumo
> para cruzar, no verdad a copiar**. Abajo se marca qué sobrevive al cruce contra el
> código y qué queda como **decisión de negocio del owner**.

---

## 0. Punto de partida — qué tenemos hoy

Antes del mercado, el estado real del código (verificado en `startup-pos.sql` e
`inventario.service.ts`):

- `movimientos_inventario` es el kardex auditable, con `costo_unitario` **congelado por
  movimiento**. El enum de `tipo` ya contempla `'ajuste'`, pero **no está implementado**.
- `item_producto.costo_actual` es **último costo**: solo lo pisa una entrada con
  `motivo='compra'` y `costoUnitario` presente (`inventario.service.ts:113-120`).
  Ninguna otra entrada lo toca; la merma explícitamente nunca.
- Tres modos: `cantidad` (escalar), `lote` (`item_lote.cantidad_disponible`), `serie`
  (`item_unidad`). **Ni `item_lote` ni `item_unidad` tienen columna de costo.**
- **No existe ninguna dimensión de ubicación** en el esquema: ni sucursal, ni bodega, ni
  almacén. `stock` es un escalar por item y por tenant.
- **No existe módulo de compras.** `terceros` guarda proveedores como directorio, sin
  flujo. La "compra" hoy es una línea suelta del kardex.
- Sí existen y están completos: recetas con costo cacheado, mermas tipificadas y
  valorizadas, conversión de unidades, simulador de impacto de costos.

---

## 1. Costeo y valoración

### Lo que hace el mercado

Tres métodos dominan, y todos los POS maduros eligen entre dos:

- **Costo promedio ponderado (WAC / AVCO)** — un único promedio móvil que se recalcula
  en cada entrada. Simple, un solo número por producto, sin capas. Es el default de
  Lightspeed Retail y una de las dos opciones de Odoo.
- **FIFO por capas de costo** — cada recepción crea una **capa** (Lightspeed la llama
  *inventory lot*, Odoo *stock valuation layer*) con su costo propio; la salida consume
  la capa más antigua. Es el método de Square for Retail y la otra opción de Odoo.
- **Costo estándar** — costo fijo predefinido, la diferencia contra el real va a una
  cuenta de varianza. Es de manufactura, no de POS retail.

Dos hallazgos transversales:

1. **Nadie usa "último costo" como método de valoración.** Aparece como dato de
   referencia (*last cost*) para sugerir precio de compra, pero la valoración del stock
   y el COGS salen de WAC o FIFO. Es exactamente lo que tenemos hoy.
2. **Odoo separa el método de costeo de la contabilización**: *automated* (cada
   movimiento genera asiento contable en tiempo real) vs *manual* (los movimientos no
   generan asientos; la valoración se corre por período). La decisión de "qué método"
   es independiente de "¿esto llega a la contabilidad?".

### Realidad chilena (obligatorio)

Acá el mercado se vuelve norma. El **art. 30 de la Ley de la Renta** obliga a usar
**FIFO (costos directos más antiguos)** o, si el contribuyente lo opta,
**Costo Promedio Ponderado** — y **el método elegido debe mantenerse por 5 años**
(jurisprudencia SII Ord. N° 3190 de 2015). No hay una tercera opción: **último costo no
es un método válido para determinar el costo directo de venta ni valorizar existencias
en Chile.**

Los ERP chilenos lo reflejan: Laudus documenta la "tarjeta de existencias" (kardex
valorizado) como el instrumento donde se sostiene el método elegido.

### Cruce contra nuestro modelo

| Concepto del mercado | Nuestro estado | Veredicto |
|---|---|---|
| Kardex con costo congelado por movimiento | `movimientos_inventario.costo_unitario` | ✅ Ya existe — es la base de cualquier método |
| Capas de costo FIFO | `item_lote` es una capa natural, **sin columna de costo** | 🟡 Estructura a medio camino, solo en modo `lote` |
| Capa unitaria (serie) | `item_unidad` = capa de 1, sin costo | 🟡 Igual |
| Promedio ponderado móvil | No existe; `costo_actual` = último costo | ❌ Faltante |
| Modo `cantidad` sin capas | El 90% de los productos cae acá | ⚠️ Es donde hay que decidir |
| Asientos contables por movimiento | No hay contabilidad en el producto | ➖ Dimensión que no tenemos |

**El hallazgo que importa:** el método de costeo no es una feature más, es el
**prerrequisito de los otros tres ejes**. Valorizar un recuento, valorizar un traslado
entre bodegas y valorizar una recepción parcial dependen todos de haber decidido antes
cómo se valoriza una salida.

**Tensión no resuelta — decisión de negocio del owner.** Hay dos lecturas posibles y
llevan a diseños muy distintos:

- **(a) Costo de gestión.** El costo existe para calcular margen, food-cost y valorizar
  mermas. La contabilidad tributaria la hace el contador en su ERP a partir de las
  compras y ventas, no de nuestro stock. → el "último costo" actual es defendible, y
  alcanza con hacerlo explícito y consistente.
- **(b) Costo tributario.** El sistema pretende ser fuente de la valorización de
  existencias que el tenant declara. → **hay que implementar FIFO o CPP, elegible por
  tenant e inmutable en el tiempo**, y "último costo" pasa a ser un bug fiscal.

Nada en `docs/PRODUCTO.md` ni en las features responde cuál de las dos es. **Esta es la
pregunta que hay que cerrar antes de diseñar cualquier cosa de los cuatro ejes.**

---

## 2. Bodegas y traslados

### Lo que hace el mercado

- **Lightspeed / Odoo / Bsale**: el stock nunca es un escalar por producto — es
  `(producto, ubicación) → cantidad`. La ubicación es el eje transversal de todo el
  módulo.
- **Traslado** = una salida en origen + una entrada en destino, con un estado intermedio
  (**stock en tránsito**) y una **recepción explícita** en destino que puede diferir de
  lo despachado (faltantes en el camino).
- Odoo modela ubicaciones jerárquicas (bodega → zona → posición); los POS retail se
  quedan en un nivel plano (sucursal/bodega).
- **Toteat** (restaurante chileno) tiene inventarios multi-bodega y consulta de
  disponibilidad por local en tiempo real.

### Realidad chilena (obligatorio)

Acá aparece algo que ningún POS internacional contempla: **el traslado físico de
mercadería por vía pública exige guía de despacho electrónica (DTE tipo 52)**, incluso
cuando no hay venta. El traslado entre bodegas del mismo contribuyente usa el
**código de traslado 5** ("traslados internos"), donde el valor unitario puede omitirse
pero el motivo debe declararse. Obligatorio en formato electrónico desde septiembre de
2019, con la representación impresa acompañando la carga.

Bsale implementa exactamente esto: el traslado entre sucursales **se hace emitiendo una
guía de despacho de traslado interno**, y el destino la recepciona desde
"Documentos de recepción → Despacho interno". O sea: en Chile el traslado no es un
movimiento interno privado, **es un documento tributario**.

Ojo con el timing: la **Resolución 154 del SII** endurece requisitos de guías de
despacho con entrada en vigencia durante 2026 — si esto se diseña, hay que verificar el
texto vigente en ese momento, no asumir el régimen anterior.

### Cruce contra nuestro modelo

| Concepto del mercado | Nuestro estado | Veredicto |
|---|---|---|
| Stock por (producto, ubicación) | `item_producto.stock` escalar | ❌ Cambio estructural profundo |
| Traslado con tránsito y recepción | No existe | ❌ Faltante completo |
| Guía de despacho tipo 52 código 5 | Sin emisión DTE (ADR-010: fiscal diferido) | ⚠️ **Choca con ADR-010** |
| Multi-sucursal como eje del tenant | El tenant no tiene sucursales; sí `razones_sociales` | ➖ Dimensión que no tenemos |

**Este es, por lejos, el eje más invasivo de los cuatro.** Una columna de ubicación no
se agrega solo al kardex: toca ventas (¿de qué bodega descuenta?), recetas (¿dónde están
los insumos?), mermas (¿en qué bodega se perdió?), combos, alertas de stock, y el modo
`lote`/`serie` (un lote vive en una bodega). Es un refactor del módulo, no una feature.

**Punto de detención (regla de `CLAUDE.md`):** el traslado interno chileno **es un
documento tributario**, y ADR-010 dice explícitamente *no construir infraestructura DTE
especulativa*. Diseñar traslados obliga a decidir si el traslado se registra sin
documento (y el tenant emite la guía por fuera, en Bsale o su facturador) o si es la
primera pieza DTE del producto. **No se puede auto-resolver.**

---

## 3. Compras y recepción

### Lo que hace el mercado

- **Square for Retail**: orden de compra con proveedor y costo por línea;
  **recepción parcial** línea por línea (`Receive` con cantidad menor a la pedida). La
  recepción es la que ingresa stock **y fija el costo**, no la orden.
- **Zoho / Cin7 / Lightspeed**: agregan costos de flete e impuestos prorrateados al costo
  unitario (*landed cost*), y catálogo de productos por proveedor con reorden sugerido.
- Patrón universal: **orden de compra ≠ recepción ≠ factura**. Son tres eventos con
  fechas distintas; el stock se mueve en la recepción, el costo se confirma en la
  factura, y las diferencias entre las tres son un caso de negocio real.

### Realidad chilena (obligatorio)

El flujo de compra chileno está mediado por el SII de una forma que no existe afuera:

- La factura electrónica de compra llega al **Registro de Compras y Ventas** del SII.
- El comprador tiene **8 días corridos** para dar **acuse de recibo** de las mercaderías
  o reclamar el documento; **pasado el plazo, el acuse es automático** y la factura
  queda registrada.
- El **crédito fiscal IVA** se usa en el período en que se hace el acuse de recibo (o en
  que se cumplen los 8 días).

Consecuencia de diseño: en Chile la recepción de mercadería **ya tiene un documento
fuente electrónico**. Bsale y Relbase explotan esto — se recepciona stock *desde* el DTE
de compra, no tipeando el detalle a mano. Un POS chileno que obliga a re-digitar la
factura de compra está peleando contra el flujo real del usuario.

### Cruce contra nuestro modelo

| Concepto del mercado | Nuestro estado | Veredicto |
|---|---|---|
| Proveedor como entidad | `terceros` ya lo cubre | ✅ Ya existe |
| Entrada por compra que fija costo | `motivo='compra'` + `costoUnitario` | ✅ Existe, en versión mínima de una línea |
| Orden de compra multi-línea, estados | No existe | ❌ Faltante |
| Recepción parcial | No existe | ❌ Faltante |
| Landed cost (flete prorrateado) | No existe | ❌ Faltante — y depende del método de costeo (§1) |
| Recepción desde DTE del SII | Sin integración SII | ⚠️ Tensión con ADR-010 |

Lo interesante del cruce: **ya tenemos una compra degenerada** — la entrada con
`motivo='compra'` que actualiza `costo_actual` es funcionalmente "recibí mercadería a
este costo". Formalizar compras es promover eso a un documento multi-línea con
proveedor y estados, no inventar un concepto nuevo. Es el eje con la ruta de migración
más limpia.

---

## 4. Recuento y ajustes

### Lo que hace el mercado

- **Odoo** separa el ajuste en dos columnas explícitas: *On Hand Quantity* (lo que dice
  el sistema) vs *Counted Quantity* (lo que contó la persona); la **diferencia** es el
  ajuste, y se aplica en bloque. El recuento es **por ubicación**, no por producto
  suelto.
- **Cycle count** — contar un subconjunto rotativo del inventario de forma frecuente en
  vez de parar la operación una vez al año. Square recomienda contar cada variante al
  menos **cada 90 días**; los ítems fuera del ciclo no se tocan.
- **Square** distingue *full count* (recuento total, con revisión y aprobación antes de
  aplicar) de ajustes sueltos. El recuento tiene un **ciclo de vida con aprobación**, no
  es un `PATCH` inmediato.
- **Toast / xtraCHEF — Actual vs Theoretical (AVT)**: el gran patrón del food-service.
  *Teórico* = lo que las recetas dicen que se debió consumir según las ventas.
  *Real* = inventario inicial + compras − inventario final. La **varianza** es lo que se
  perdió sin registrar: sobre-porcionado, robo, merma no declarada, recetas mal
  cargadas. Referencia de industria: **varianza < 2% es sano, > 5% es problema
  sistémico**. Requiere obligatoriamente conteos por período, recetas y compras.
- **Inventario negativo** (vender antes de recibir) es un caso borde que todos
  documentan y nadie resuelve bien: bajo promedio ponderado provoca saltos raros de
  COGS, y bajo FIFO una recepción retroactiva **desordena las capas** y corrompe el
  margen histórico.

### Cruce contra nuestro modelo

| Concepto del mercado | Nuestro estado | Veredicto |
|---|---|---|
| Ajuste absoluto (contado vs sistema) | `tipo='ajuste'` reservado en el enum, **sin implementar** | 🟡 Hueco ya identificado en `inventario-kardex.md` |
| Recuento con ciclo de vida y aprobación | Hoy solo `PATCH /items/:id/stock` inmediato | ❌ Faltante |
| Cycle count / recuento parcial rotativo | No existe | ❌ Faltante |
| Teórico vs real (AVT) | **Tenemos las dos mitades**: recetas con costo + mermas valorizadas | 🟢 Faltaría el conteo periódico que cierra la fórmula |
| Stock negativo | Prohibido — la salida que dejaría negativo se rechaza | ✅ Ya decidido, y evita el peor caso borde del §1 |

**El hallazgo con mejor relación valor/invasividad está acá.** El AVT de Toast necesita
tres insumos: recetas costeadas ✅, mermas tipificadas ✅, y **conteos por período ❌**.
Nos falta solo el tercero. Implementar recuento con `tipo='ajuste'` no solo cierra un
hueco conocido del kardex: **habilita el reporte de varianza**, que es la razón por la
que un restaurante paga por un módulo de inventario.

Y hay un refuerzo del cruce: la prohibición de stock negativo que ya tomamos nos ahorra
la clase entera de problemas de "recepción retroactiva que desordena las capas FIFO" que
el mercado documenta como el dolor crónico del costeo.

---

## 5. Qué sobrevive al cruce — lectura de conjunto

**Dependencias reales entre los ejes:**

```
Costeo (§1) ──┬──> Recuento valorizado (§4)
              ├──> Traslado valorizado (§2)
              └──> Recepción / landed cost (§3)
```

El costeo no es un eje paralelo a los otros tres: es su base. Diseñar recuento sin haber
decidido FIFO/CPP obliga a rehacerlo después.

**Por invasividad, de menor a mayor:**

1. **Recuento y ajustes** — hueco ya reservado en el enum, cero cambios estructurales,
   y desbloquea el reporte de varianza sobre features que ya están hechas.
2. **Compras y recepción** — módulo nuevo pero aditivo; `terceros` y `motivo='compra'`
   ya son el punto de anclaje. No obliga a tocar lo existente.
3. **Costeo** — cambia la semántica de un campo que ya usan recetas, mermas y el
   simulador. Sin datos productivos no hay migración que hacer (se actualiza el seeder
   y se resetea); el costo real es el blast radius sobre esas tres features.
4. **Bodegas y traslados** — refactor del módulo completo + primera pieza DTE. El más
   caro, y el que más choca con ADR-010.

**Dimensiones que el mercado asume y nosotros no tenemos** (no son gaps, son decisiones
de alcance): contabilidad y asientos, sucursales, emisión DTE, órdenes de compra,
proveedores como flujo (solo directorio).

---

## 6. Preguntas abiertas para el owner

Ninguna se puede auto-resolver: son reglas de negocio no documentadas.

1. **¿Costo de gestión o costo tributario?** (§1) — determina si "último costo" es
   aceptable o si hay que implementar FIFO/CPP elegible por tenant. **Bloquea los otros
   tres ejes.**
2. **Si es tributario: ¿método elegible por tenant o uno solo para el producto?** En
   Chile la elección es del contribuyente y dura 5 años → habría que persistirla y
   hacerla inmutable, igual que `modo_inventario`.
3. **¿El traslado entre bodegas emite guía de despacho, o se registra sin documento y el
   tenant la emite por fuera?** (§2) — choca de frente con ADR-010.
4. **¿"Bodega" es realmente sucursal?** Si el tenant multi-local necesita stock por
   local, el eje que falta no es bodega sino **sucursal**, y eso también toca cajas,
   ventas y usuarios — mucho más allá de inventario.
5. **¿La recepción de compra parte de un DTE del SII o se digita?** (§3) — define si
   compras es un módulo interno o el primer punto de integración fiscal.
6. **¿El objetivo real es el reporte de varianza (AVT)?** (§4) — si sí, el orden natural
   es recuento primero, y compras después para cerrar la fórmula
   `inicial + compras − final`.

---

## Fuentes

**Costeo y valoración:**
- Lightspeed Retail — [Understanding average cost and FIFO cost methods](https://retail-support.lightspeedhq.com/hc/en-us/articles/40045780747035-Understanding-average-cost-and-FIFO-cost-methods) · [How average cost is calculated](https://retail-support.lightspeedhq.com/hc/en-us/articles/4867917457307-How-average-cost-is-calculated) · [Inventory costing methods: FIFO, LIFO, WAC](https://www.lightspeedhq.com/blog/inventory-costing-methods/)
- Odoo — [Inventory valuation cheat sheet (capas / SVL)](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/inventory_valuation/cheat_sheet.html) · [Automatic inventory valuation (automated vs manual)](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/inventory_valuation_config.html) · [Using inventory valuation](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/using_inventory_valuation.html)
- Square — [Set and update unit costs (COGS por FIFO)](https://squareup.com/help/us/en/article/6472-square-for-retail-reporting-faqs)
- SII Chile — [Ord. N° 3190 de 2015, art. 30 Ley de la Renta (FIFO o CPP)](https://www.sii.cl/pagina/jurisprudencia/adminis/2015/renta/ja3190.htm) · [Art. 30 — costo directo](https://www.sii.cl/pagina/jurisprudencia/adminis/1998/renta/oct06.htm)
- Transtecnia — [Metodologías de valorización reguladas por ley](https://transtecnia.cl/articulo-tributario/sii-para-determinar-costo-de-las-ventas-del-ejercicio-y-valorizar-las-existencias-contribuyentes-deben-sujetarse-a-las-metodologias-reguladas-por-ley/)
- Laudus (ERP chileno) — [Método de valoración de existencias (permanencia 5 años)](https://www.laudus.cl/blog/metodo-de-valoracion-de-existencias/) · [Tarjetas de existencias](https://laudus.cl/existencias/tarjetas-de-existencias-el-pilar-de-una-gestion-de-inventario-profesional/)

**Bodegas y traslados:**
- Bsale Chile — [¿Cómo despachar stock de una sucursal o bodega a otra?](https://ayuda.bsale.io/support/solutions/articles/151000212312--c%C3%B3mo-despachar-stock-de-una-sucursal-o-bodega-a-otra-) · [¿Cómo recepcionar stock de un despacho interno?](https://ayuda.bsale.io/support/solutions/articles/151000212508--c%C3%B3mo-recepcionar-stock-de-un-despacho-interno-entre-sucursales-) · [Características de productos (guías electrónicas de transferencia)](https://www.bsale.cl/sheet/caracteristicas-productos)
- SII — [Guía de despacho electrónica para traslados que no constituyen venta](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_4090.htm) · [Resolución 154 de 2025 (nuevos requisitos, vigencia 2026)](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso154.pdf)
- BaseAPI — [DTE tipo 52: guía de despacho, código de traslado 5](https://baseapi.cl/docs/dte/52)
- Sovos — [Guías de despacho y Resolución 154: nuevos requisitos](https://sovos.com/es/blog/iva/guias-despacho-resolucion-154-sii-nuevos-requisitos-mayo-2026/)
- Toteat — [Control de inventarios y stock (multi-bodega, disponibilidad por local)](https://toteat.com/productos/control-de-inventarios-y-stock)
- Odoo — [Cycle counts (ubicaciones)](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/cycle_counts.html)

**Compras y recepción:**
- Square — [Create and manage purchase orders](https://squareup.com/help/us/en/article/8258-create-purchase-orders-with-square-for-retail) · [View, receive, and adjust inventory (recepción parcial)](https://squareup.com/help/us/en/article/6110-manage-inventory-with-the-retail-pos-app)
- SII — [Acuse de recibo: plazo de 8 días](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6514.htm) · [Guía de aceptación o reclamo de un DTE](https://www.sii.cl/factura_electronica/GUIA_aceptacion_reclamo_dte.pdf) · [Acuse de recibo y crédito fiscal (F29)](https://www.sii.cl/destacados/f29/acuse_recibo_facturas.pdf)
- Bsale — [¿Hasta cuándo puedo aceptar una factura para usar el crédito fiscal?](https://www.bsale.cl/article/hasta-cuando-puedo-aceptar-una-factura-para-usar-el-credito-fiscal)
- EasyTax — [Registro de Compras y Ventas: cómo funciona en Chile](https://www.easytax.cl/blog/registro-de-compras-y-ventas-como-funciona-en-chile)

**Recuento y ajustes:**
- Odoo — [Inventory adjustments (On Hand vs Counted)](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html) · [Cycle counts](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/cycle_counts.html)
- Square — [Conduct, review, and approve inventory counts](https://squareup.com/help/us/en/article/8249-conduct-full-inventory-counts-with-square-for-retail) · [Improve inventory accuracy with cycle counts (cada 90 días)](https://squareup.com/us/en/townsquare/inventory-cycle-count)
- Toast — [Actual vs. theoretical food cost analysis](https://pos.toasttab.com/blog/on-the-line/actual-vs-theoretical-food-cost) · [xtraCHEF: get started with AVT reports](https://support.toasttab.com/en/article/xtraCHEF-Get-Started-With-Actual-vs-Theoretical-Analysis-Reports) · [xtraCHEF: review inventory analytics](https://support.toasttab.com/en/article/xtraCHEF-Inventory-Analytics)
- CrunchTime — [Explaining actual vs. theoretical food cost variance](https://www.crunchtime.com/blog/blog/explaining-actual-vs-theoretical-food-cost-variance)
- Microsoft / inFlow — [How general ledger is affected by negative inventory](https://support.microsoft.com/en-us/topic/how-general-ledger-is-affected-by-negative-inventory-quantities-e577365e-f923-a0df-be05-e1ab4a2ba124) · [Why avoid negative inventory](https://www.inflowinventory.com/support/cloud/why-should-i-avoid-negative-inventory-in-inflow)
