# Investigación de mercado — Aviso de stock bajo / punto de reorden

**Fecha:** 2026-09-20 · **Para:** `docs/agent/pendientes.md` § 4, entrada "Aviso de stock bajo"

> ⛔ Esto **no es diseño ni decisión**. Es insumo para cruzar contra el código y contra lo
> que el owner ya decidió. Si el mercado dice A y nuestro modelo dice B, gana B — se
> documenta por qué en cada sección. Regla completa: [`investigacion-mercado.md`](../investigacion-mercado.md).

---

## 0. Lo que el owner ya decidió — no se re-abre acá

De `docs/agent/pendientes.md` § 4 (owner, 2026-09-20):

1. El mínimo es **por producto Y lugar** — `(item_id, ubicacion_id)`, el mismo par que ya es
   la PK de `stock_ubicacion`.
2. **Nace vacío**: sin mínimo cargado, no hay aviso. No hay que llenar todo el catálogo.
3. Avisa en **dos lugares fijos**: bloque en el dashboard de inicio y marca en el listado de
   inventario. Permiso candidato: `Inventario:Leer`.
4. **Cuenta unidades**, igual para `cantidad`, `serie` y `lote`. El vencimiento queda
   **explícitamente afuera**.

Esta pasada no vuelve a preguntar nada de esto. Busca lo que el mercado resolvió
**alrededor**, y sobre todo lo que el owner **todavía no decidió**: nombre estándar, fijo vs.
calculado, ruido, puente a compras/traslados, y casos borde.

---

## 1. Nombre estándar y modelo de datos

La industria no usa un solo término — y la diferencia importa para saber qué se está
copiando:

| Término | Qué es | Quién lo documenta |
|---|---|---|
| **Reorder point (ROP)** | El nivel de stock que dispara "hay que reponer ya". Es un **gatillo**, no un objetivo de cuánto tener | [Lightspeed](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534223596571-Stock-reorder-point-and-restock-level): *"the level stock must get to before Retail POS identifies this stock as 'low stock'"* · [Wikipedia](https://en.wikipedia.org/wiki/Reorder_point) |
| **Par level** | El nivel al que **se repone** después de pedir — el objetivo, no el gatillo | [Fishbowl](https://www.fishbowlinventory.com/blog/par-level), [Suplery](https://suplery.com/blog/reorder-point-vs-par-level/): *"reorder point tells you when to order; par level tells you how high to fill"* |
| **Minimum stock / safety stock** | El colchón contra la variabilidad de demanda y de plazo de entrega, insumo del cálculo del ROP, no un concepto separado en la práctica | [Unleashed](https://www.unleashedsoftware.com/blog/par-levels-in-inventory-management-with-formula-examples/): *"Reorder Point = Normal consumption during lead-time + Safety Stock"* |
| **Stock mínimo** (término usado en LatAm/Chile) | Se usa indistintamente para el gatillo — no siempre se distingue de par level en el habla local | Defontana, Nubox (ver § 6) |

**Toast** es el ejemplo más explícito de que **par level en la práctica son dos números, no
uno**: PAR **mínimo** (el gatillo — cuándo avisar) y PAR **máximo** (el techo — hasta cuánto
reponer). [Toast (SMB Automations)](https://www.smb-automations.com/automate/toast/toast-low-inventory-alert):
*"the minimum PAR is the lowest quantity... the maximum PAR is the highest quantity... to
avoid overstocking"*.

**Cruce contra el código y contra la decisión del owner:**

- El owner decidió **un número**, no un par mínimo/máximo — el aviso, no el "hasta cuánto
  reponer" (eso solo tendría sentido si existiera un pedido automático, que hoy no existe;
  ver § 4). Eso lo acerca al concepto de **reorder point** puro (Lightspeed, Odoo) más que al
  **par level de Toast** (que es min+max). Nombrarlo internamente "stock mínimo" es
  consistente con cómo lo llaman Defontana/Nubox, y evita el par min/max que el owner no pidió.
- La forma de dato que el owner ya fijó — **por (producto, lugar)** — es exactamente la
  forma en la que Lightspeed y Odoo declaran el reorder point: *"a reordering rule is
  defined per product and per location"* ([Odoo](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.html)),
  *"reorder settings... at different locations"* ([Lightspeed](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534223596571-Stock-reorder-point-and-restock-level)).
  No es una preferencia nuestra sin precedente: es la forma estándar en los dos productos que
  documentan multi-ubicación con algo de detalle.
- **Confirmado en el código:** `grep -rniE "stock_minimo|punto_reorden|reorder" backend/src`
  no devuelve nada — el campo no existe hoy. `item_producto` (`backend/src/modules/items/entities/item-producto.entity.ts`)
  no tiene ninguna columna de mínimo, y `stock_ubicacion` (`stock-ubicacion.entity.ts`) es
  hoy `PK (item_id, ubicacion_id) → stock`, sin nada más. La forma que el owner ya eligió
  —un número por (ítem, ubicación)— es literalmente la misma forma que ya tiene esta tabla:
  agregar el mínimo ahí (o en una tabla que comparta esa misma PK) es la extensión natural,
  no una estructura nueva. Esto es una observación de forma, no una propuesta de esquema —
  el diseño queda para cuando se tome la entrada.
- Por la regla de dominio ya escrita en `CLAUDE.md` ("solo `tipo='producto'` tiene stock"),
  el mínimo solo puede tener sentido en ítems de ese tipo — no es un hallazgo nuevo, es la
  regla existente aplicada a este campo.

---

## 2. ¿Un número fijo, o calculado?

Los cuatro POS/ERP con documentación pública se dividen en dos grupos:

**Fijo, cargado a mano:**
- **Toast**: el PAR mínimo/máximo se tipea por ítem ([SMB Automations](https://www.smb-automations.com/automate/toast/toast-low-inventory-alert)).
- **Odoo** (reordering rules): "Min Quantity" y "Max Quantity" son campos que se tipean por
  producto y ubicación — la cuenta que Odoo automatiza es **cuánto pedir**
  (`Max − Forecasted`), no el mínimo en sí ([Odoo](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase/products/reordering.html)).
- **Lightspeed** (nivel base, sin el add-on): el reorder point se tipea por ítem/ubicación
  ([Lightspeed](https://x-series-support.lightspeedhq.com/hc/en-us/articles/115000271633-Setting-reorder-points-and-desired-inventory-levels)).

**Calculado desde el consumo:**
- **Lightspeed Analytics** (add-on de pago): *"automated reorder points... based on your own
  sales metrics like sales volume, your desired trailing sales period, and... vendor lead
  time"* ([Lightspeed](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25533877849627-Can-I-be-alerted-when-my-stock-levels-drop-to-a-certain-point)).
- **Bsale** (Chile — ver § 6): el aviso "por Días" proyecta cuánto dura el stock usando la
  velocidad de venta de una ventana elegida (7, 28 o 120 días), y avisa cuando el stock
  alcanza para menos de N días — una alternativa **calculada** al número fijo, configurable
  por sucursal ([Bsale](https://ayuda.bsale.io/support/solutions/articles/151000228457-c%C3%B3mo-configurar-alertas-de-stock-para-tus-productos)).

**Cruce contra la decisión del owner:** "nace vacío y se carga a mano donde importa" es
exactamente el modelo **fijo** — el mismo que usan Toast, Odoo y Lightspeed en su nivel base.
No es una simplificación sin precedente; es el 80% del mercado relevado. La versión
**calculada** (Bsale por días, Lightspeed Analytics) es real y con fuente, pero es
consistente con lo que `pendientes.md` ya marca como pendiente de diseño: una **segunda
etapa**, no algo que haya que resolver ahora. El dato que necesitaría —consumo histórico por
(ítem, ubicación)— ya existe en el sistema (`venta_detalles` tiene cantidad y fecha,
descuenta del local); calcularlo no requeriría una fuente de datos nueva, pero sí una
decisión propia de ventana y de cómo tratar productos sin historial (§ 5 de esta
investigación, casos borde).

---

## 3. Cómo evitan el ruido

Esto es lo que más le importa al owner porque decidió avisar en **dos lugares fijos**, sin
ningún mecanismo de silenciar todavía decidido. Lo que el mercado documenta:

- **Toast**: no avisa exactamente en el mínimo — deja configurar el umbral de aviso como un
  **porcentaje sobre el par** (ej. avisar al 150% del par), para tener margen de reacción
  antes de llegar al mínimo real ([SMB Automations](https://www.smb-automations.com/automate/toast/toast-low-inventory-alert)).
  Es un colchón de anticipación, no una histéresis propiamente dicha (no hay un "umbral de
  apagado" distinto del "umbral de encendido").
- **Square**: agrupa por sucursal y manda **un email por sucursal por día**, 90 minutos
  después del cierre de esa sucursal — no hay email por ítem ([Square](https://squareup.com/help/us/en/article/8333-create-inventory-alerts)).
  Es la forma más simple de evitar spam: un digest diario, no un evento por cruce de umbral.
- **Bsale**: agrupa igual por sucursal en **un resumen** por email, o notificación en la app
  — misma lógica de digest, no alerta por ítem ([Bsale](https://ayuda.bsale.io/support/solutions/articles/151000228457-c%C3%B3mo-configurar-alertas-de-stock-para-tus-productos)).
- **Lightspeed**: en su reporte de reposición, la **cantidad sugerida** ya resta lo que está
  en camino (`Forecasted demand − closing − inbound`) — así que un pedido ya hecho hace que
  el ítem baje de urgencia o desaparezca del reporte la próxima vez que se abre
  ([Lightspeed](https://x-series-support.lightspeedhq.com/hc/en-us/articles/27946369696027-Using-demand-forecasting-with-reports-to-create-purchase-orders)).
  Esto es un mecanismo real de "ya lo pedí, no me molestes" — pero vive en un **reporte que
  se abre a demanda**, no en una marca fija en pantalla como la que decidió el owner.

**No encontré fuente** de ningún POS o ERP relevado (Toast, Square, Lightspeed, Clover,
Bsale, Defontana, Nubox) que documente un mecanismo de silenciar o marcar "ya pedido" sobre
una marca **fija y siempre visible** — el patrón que sí decidió el owner (bloque de
dashboard + marca en el listado, ambos permanentes). Todos los mecanismos de reducir ruido
que se documentan public actúan sobre **notificaciones que llegan y se pueden ignorar**
(un email, un reporte), no sobre un indicador fijo en una pantalla que se mira todos los
días. Esto va a `docs/DIFERENCIADORES.md` como hallazgo — ver el cierre de este documento.

**Cruce:** el diseño del owner ya está más cerca del "indicador fijo" que del "digest
diario" — es una decisión tomada (dos lugares fijos), y el mercado no ofrece un patrón
directamente aplicable para bajarle el ruido a ESE formato específico. Lo que sí es
trasladable sin inventar nada: agrupar por ubicación en el bloque del dashboard (como hacen
Square y Bsale con sus emails), en vez de listar ítem por ítem.

---

## 4. El puente al pedido (compras)

`startup-app` ya tiene compras (recibir mercadería, `docs/features/compras.md`, desde
2026-09-19), pero **no tiene orden de compra** — el propio doc lo dice explícito: *"Fuera:
orden de compra, devolución al proveedor, moneda extranjera, flete..."*. Compras hoy es
"cargar lo que YA llegó", no "pedirle algo a un proveedor". Esto importa para leer el
hallazgo de mercado con la escala correcta:

- **Lightspeed** sí arma el puente completo: el reporte de bajo stock trae una
  **cantidad sugerida** por ítem (`Forecasted demand − closing − inbound`), se puede
  **agrupar por proveedor** (*"if there is a supplier attached to the purchase order, only
  products from that supplier will be recommended"*), y de ahí se arma la orden de compra
  directamente ([Lightspeed](https://x-series-support.lightspeedhq.com/hc/en-us/articles/27946369696027-Using-demand-forecasting-with-reports-to-create-purchase-orders)).
- **Odoo**: la regla de reposición genera la orden de compra automáticamente
  (`Max − Forecasted`) cuando el mínimo se cruza ([Odoo](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.html)).
- **Bsale**: la ficha de ayuda de alertas **no menciona** generación de orden de compra ni
  vínculo a proveedor — el aviso es puramente informativo (email o notificación), sin
  puente documentado a una acción de compra.

**Cruce:** el puente Lightspeed/Odoo **necesita una entidad que hoy no existe en
`startup-app`**: una orden de compra al proveedor (borrador de "esto es lo que le voy a
pedir", distinto de "esto es lo que ya me llegó"). El aviso de stock bajo puede ser el
insumo natural de esa pieza el día que se construya —y de hecho `compra.proveedor_id` ya
existe, así que agrupar por proveedor no requeriría un dato nuevo—, pero diseñar el mínimo
"pensando en que alimente un pedido" no cambia nada del campo en sí (sigue siendo un número
por ítem+ubicación); lo que sí valdría la pena es que la data se guarde de forma que un
futuro "sugerir pedido" pueda leerla sin rehacer el modelo. Eso es un criterio de diseño
para cuando se tome la entrada, no algo que esta investigación resuelva.

---

## 5. Multi-ubicación: ¿traslado antes que compra?

Esta es la pregunta que más pega con la decisión que ya tomó el owner (el caso de la
cerveza en bodega).

- **Clover** documenta la ausencia como limitación explícita: *"Automated low-stock alerts
  won't [cross] multiple stores... moving stock between locations is a manual process"*
  ([ParallelPOS](https://parallelpos.com/blog/clover-multi-location-inventory)). O sea, ni
  siquiera ve el stock de otro local automáticamente, y mucho menos sugiere un traslado.
- **Odoo** SÍ tiene un mecanismo — pero es de **ruteo configurado de antemano**, no una
  decisión "aviso por aviso": con la ruta "Resupply from Warehouse" activada, la regla de
  reposición de un almacén satélite genera un traslado interno en vez de una compra
  ([Odoo](https://www.odoo.com/documentation/16.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/resupply_warehouses.html)).
  Es del lado ERP, no de un POS de mostrador, y compara "esta ubicación se resurte de esa
  otra" como regla fija — no compara caso por caso "hoy hay en bodega, mejor traslado que
  compra".
- **Bsale**: el traslado entre sucursales existe como documento separado (guía de despacho
  interna, con su propio flujo de despacho/recepción), pero no encontré que se dispare o
  sugiera desde una alerta de stock — son dos features documentadas por separado.

**No encontré fuente** de ningún POS (no ERP) que, al avisar stock bajo con más de una
ubicación con saldo, prefiera automáticamente sugerir un traslado interno sobre un pedido de
compra.

**Cruce — esto es lo más accionable de toda la investigación:** `startup-app` ya construyó
exactamente este patrón, pero en OTRO punto del sistema. Cuando una venta rechaza por falta
de stock en el local, el 400 **ya nombra dónde está la mercadería** y ofrece el **traslado
precargado a un clic** a quien tiene el permiso (`docs/features/bodegas-y-traslados.md`,
sección "El rechazo dice dónde está la mercadería": *"Sin carne en el local — hay 10 kg en
Bodega Subsuelo"*). El aviso de stock bajo podría reusar esa misma UX en vez de inventar una
nueva: el mercado no ofrece el patrón, pero el propio código ya lo tiene resuelto para el
caso hermano (falta al vender). Esto es un candidato fuerte de diferenciador si se construye
— ver cierre.

---

## 6. Casos borde

- **Ítem eliminado (soft delete) con un mínimo cargado**: ninguna fuente de mercado lo
  aborda (es demasiado específico de implementación para documentación pública). En
  `startup-app`, `items.eliminado_el` ya filtra la mayoría de las lecturas — habría que
  decidir si el aviso se apaga solo con el borrado del ítem o si el mínimo sigue vivo y
  "molesta" sobre un producto descontinuado. Pregunta abierta, no resuelta por el mercado.
- **Ubicación eliminada con un mínimo cargado ahí**: mismo caso, mirado desde el otro lado.
  `docs/features/bodegas-y-traslados.md` (tabla de Bordes) ya resuelve qué pasa con el
  **stock** al borrar una bodega (400 si queda stock adentro), pero no dice nada de un
  mínimo cargado — porque el mínimo no existe todavía. Si se agrega una tabla con la PK
  `(item_id, ubicacion_id)`, cae bajo la misma regla de soft-delete que todo lo demás
  (`CLAUDE.md`, invariante 3): habría que decidir si se soft-borra junto con la ubicación o
  si sobrevive huérfano.
- **Los tres modos de inventario, comparados de la misma forma**: la decisión del owner de
  "contar unidades igual en los tres modos" **cruza limpio contra el código**. Con bodegas y
  traslados, `stock_ubicacion.stock` ya es el número recalculado también para `serie`
  (`recalcularStockSerie`) y `lote` (`recalcularStockLote`) — no solo para `cantidad`
  (`docs/features/inventario-serializado.md`, `docs/features/bodegas-y-traslados.md` §
  "Quién escribe `stock_ubicacion`"). Comparar un mínimo contra `stock_ubicacion.stock` ya
  funciona igual para los tres modos sin lógica extra por modo — el owner pidió algo que el
  esquema actual ya deja implementar sin bifurcaciones. Esto no es un hallazgo de mercado;
  es una confirmación de que la decisión ya tomada no choca con nada del código.
- **Producto sin historial de ventas** (relevante solo si algún día se calcula el mínimo, no
  para el modelo fijo de hoy): ninguna fuente da una regla concreta más allá de "arrancar
  conservador y ajustar con datos reales" (búsqueda genérica, sin cita de un POS puntual —
  **no encontré fuente específica de un producto real** para este caso, solo consejo
  genérico de blogs de inventario).
- **Estacionalidad** (mismo comentario — solo relevante para un cálculo automático, no para
  el número fijo de hoy): tampoco hay una fuente de un POS puntual, solo ejemplos genéricos
  de blogs (ropa de baño en verano/invierno). Como el owner decidió un número fijo cargado a
  mano, quien lo carga ya decide el ajuste estacional él mismo al escribir el número — el
  mercado no aporta nada aplicable hoy.
- **Mínimo en cero**: ninguna fuente aclara si "0" significa "sin mínimo" (igual que no
  tener el campo cargado) o "avisame si llega literalmente a 0". Como el owner ya decidió
  que el campo nace vacío y solo avisa donde se cargó, la distinción entre "vacío" y "cero"
  es una decisión de diseño que el mercado no resuelve — hay que decidirla al construir,
  probablemente tratando NULL (nunca cargado) distinto de 0 (mínimo es literalmente cero).

---

## 7. Realidad chilena (obligatorio)

Confirmando lo que ya advierte `investigacion-mercado.md`: en Chile la señal fuerte está en
la norma (SII), no en la competencia — y acá **no hay norma**. El stock mínimo es un
concepto puramente operativo/comercial, no fiscal: no hay ninguna obligación del SII sobre
"a partir de qué saldo hay que reponer". Confirma la propia calibración de la plantilla, que
avisa que los POS chilenos publican **cómo cargar el dato en la UI**, no su motor. Lo que sí
se pudo relevar de los locales:

| POS/ERP | Qué documenta | Fuente |
|---|---|---|
| **Bsale** | El más completo de los cuatro: mínimo **por producto o variante**, marcando **sucursales** donde aplica; alerta **por Cantidad o por Días** (esta última calculada sobre 7/28/120 días de venta); notificación por **email** (resumen por sucursal) o **push en la app**. Sin mención de vínculo a orden de compra o proveedor | [ayuda.bsale.io](https://ayuda.bsale.io/support/solutions/articles/151000228457-c%C3%B3mo-configurar-alertas-de-stock-para-tus-productos) |
| **Defontana** | Documenta el **concepto** ("artículos bajo stock mínimo son los que están por debajo del stock definido en la ficha") pero la página de Informes de inventario no pudo leerse completa (403/contenido truncado en el fetch) — **no verificado el mecanismo de alerta ni si es por bodega** | [Confluence de Defontana](https://defontana.atlassian.net/wiki/spaces/CDAV2/pages/19922997/Informes+de+inventario) (parcial) |
| **Nubox** | Su línea "Control de Existencias" menciona "stocks mínimos y máximos" como característica general del producto — **sin detalle público** de cómo se configura la alerta ni si es por bodega | [servifactura.cl](https://www.servifactura.cl/software-de-control-existencias.html) |
| **Toteat** | POS de restaurante chileno **verificado como tal** (no una app de pagos). Su página de control de inventario habla de entradas/salidas y sincronización con ventas, pero **no salió nada público sobre stock mínimo** — coincide con la advertencia ya escrita en la plantilla de que de Toteat no sale documentación pública de este tipo | [toteat.com/productos/control-de-inventarios-y-stock](https://toteat.com/productos/control-de-inventarios-y-stock) |

**Lo más útil de la pata chilena** es Bsale: confirma con fuente que el modelo "por
(producto, sucursal)" que el owner ya decidió es el mismo que usa el POS chileno más
documentado del rubro, y que el modo "por Días" (calculado) convive ahí con el modo "por
Cantidad" (fijo) como dos opciones del mismo campo — no una reemplaza a la otra. Es
consistente con leer la versión calculada como una segunda etapa **opcional**, no como el
único camino correcto.

---

## Cierre

**Qué cambia de lo que el owner ya decidió:** nada. Las cuatro decisiones (mínimo por
producto+lugar, nace vacío, dos lugares de aviso, cuenta unidades sin vencimiento) están
todas respaldadas por al menos un producto del relevamiento, y ninguna choca con lo que
soporta el esquema actual (§ 1 y § 6).

**Qué es segunda etapa, con fuente que la valida (no especulativa):**
1. Un mínimo **calculado** desde la velocidad de venta, como alternativa opcional al fijo —
   Bsale (por Días) y Lightspeed Analytics lo validan como patrón real, no una idea nuestra.
2. Un **puente a un pedido de compra sugerido**, agrupado por proveedor — necesita primero
   la pieza de orden de compra que `docs/features/compras.md` deja explícitamente fuera de
   alcance; Lightspeed y Odoo lo validan como patrón, pero ninguno de los dos lo resuelve sin
   esa entidad previa.
3. Una **sugerencia de traslado interno** antes que de compra, cuando hay stock en otra
   ubicación del mismo tenant — sin precedente documentado en el mercado (§ 5), pero con
   precedente **propio**: el mismo patrón ya construido para el rechazo de venta por falta de
   stock.

**Preguntas nuevas para el owner, formuladas concretas:**

1. Cuando el aviso dispara porque el local está bajo el mínimo pero **hay stock en una
   bodega del mismo tenant**, ¿el bloque debería ofrecer el traslado precargado (como ya
   hace el rechazo de venta), o alcanza con mostrar los dos números —local y bodega— por
   separado, sin acción directa?
2. El campo nace vacío y se carga a mano. El día que haya suficiente historial de ventas,
   ¿quiere que el sistema **sugiera** un valor de mínimo (a la Bsale/Lightspeed, calculado
   de la venta) que el usuario acepta o edita, o prefiere que quede 100% manual para
   siempre, sin importar cuántos datos haya?
3. Si un ítem con mínimo cargado se elimina (papelera), ¿el aviso se apaga solo o hay que
   apagarlo a mano? Mismo caso desde el otro lado: si se borra la ubicación donde estaba
   cargado el mínimo.
