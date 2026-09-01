# Anular una línea ya despachada a cocina — investigación de mercado (2026-09-01)

> ⛔ **Esto es insumo, no diseño.** Lo que trae el mercado se cruza contra el código y lo
> decide el owner. Regla completa: [`../investigacion-mercado.md`](../investigacion-mercado.md).
> **Todavía no hay spec ni plan**: este archivo termina en preguntas, no en decisiones.

## 0. La pregunta, y por qué no la cubre la pasada de julio

Hoy el sistema **bloquea** quitar o bajar una línea de cuenta con `cantidad_enviada > 0`
(`salones.service.ts`, los dos guards, construidos el 2026-08-16). El bloqueo evita que se
regale comida sin rastro, pero **no da la salida legítima**: si el plato se quemó, se
regala, o el garzón se equivocó después de mandar la comanda, hoy no hay ningún camino. El
propio mensaje de error manda a *"merma o cortesía"*, que **no existen** para este caso.

La investigación de julio —[`2026-07-27-anulacion-y-notas-credito.md`](2026-07-27-anulacion-y-notas-credito.md)—
cubre **otra** frontera: anular una **venta** (void vs nota de crédito, el corte fiscal
"¿ya se consolidó?"). Acá la cuenta está **abierta**: no hay venta, no hay documento y no
hay pago. Es un problema de **operación y costo**, no fiscal. Por eso se investigó de nuevo.

---

## 1. El eje en el que coincide todo el mercado

La industria no parte por "¿se puede borrar?" sino por **¿la comida se hizo?**:

| | La comida NO se hizo | La comida SÍ se hizo |
|---|---|---|
| Qué se hace | se saca de la cuenta y listo | se perdona el cobro, pero el ítem cuenta como consumido |
| Efecto en costo | ninguno | el costo del ingrediente **salió igual** |

El nombre estándar del segundo caso es **comp** (de *complimentary*). Y la razón por la que
la industria insiste en separarlos no es semántica: si un plato que se hizo se registra como
si nunca hubiera existido, la comida **sale del inventario sin venta asociada** y aparece
como merma o robo, inflando el food cost y castigando a la cocina por algo que decidió el
salón ([Restaurant Systems Pro](https://restaurantsystemspro.net/use-void-vs-comp-restaurant/)).

## 2. Dónde el mercado se contradice: los NOMBRES, no el fondo

⚠️ **`void` y `comp` no significan lo mismo en Toast que en Square.** Verificado en la
documentación oficial de cada uno:

| | Toast | Square |
|---|---|---|
| `void` | *"remueve como si nunca hubiera pasado"*, y **solo se necesita DESPUÉS de mandar el ítem** a cocina | *"el ítem se cargó mal y la comida todavía no se hizo ni se entregó"* |
| `comp` | *"perdona el cobro de un ítem que el comensal recibió"* | *"se aplica después de que la comida se preparó o entregó"* |

O sea que **el mismo gesto —sacar un plato ya despachado— se llama `void` en Toast y `comp`
en Square.** Cualquier decisión que tomemos tiene que elegir su propio vocabulario y
definirlo por escrito; copiar el nombre de uno y la semántica del otro es la forma de
quedar con dos conceptos que no cierran. El fondo, en cambio, sí es el mismo en los dos:
existen **dos salidas distintas** y las separa si la comida se hizo.

Un detalle de UX que sí difiere de verdad: en Square **el comp aparece en la cuenta del
comensal** (sin detalle del ítem) y el void no aparece. Es una decisión de producto, no un
detalle de implementación: define si la cortesía se le muestra a la mesa.

## 3. El mecanismo documentado: la RAZÓN lleva la consecuencia de stock

Es el hallazgo más aprovechable, y es de Lightspeed (K-Series). Cada **razón de anulación**
es configurable en el back office y tiene un flag `Reverse stock`. Citado literal:

- `Reverse stock = No` (default) — *"The item is deducted from the inventory when the void
  reason is selected on the POS."*
- `Reverse stock = Yes` — *"The item is not deducted from the inventory."*

O sea: **una sola operación, N razones, y cada razón declara qué pasa con el stock.** No hay
dos endpoints "void" y "comp": hay un catálogo de razones donde el efecto sobre el
inventario es un atributo del motivo. Eso mapea directo contra lo que ya tenemos
(`causas_merma` ya es un catálogo por tenant con causas fijas + propias).

Lo que además queda registrado en Lightspeed por cada anulación: usuario del POS, mesa,
ítem, fecha y razón, en el reporte *Cancellations and corrections*.

**Control de fraude.** El consenso operativo —no de un fabricante, de la literatura de
gestión— es exigir **aprobación de manager** para todo void/comp y **razón obligatoria**, con
una taxonomía cerrada del estilo *customer dissatisfaction / kitchen error / spill / staff
meal*. En Toast eso se implementa quitándole el permiso al garzón (`3.31`), de modo que la
acción exige que un manager la complete; en Square depende del permiso de *checkout*.

## 4. Dónde el mercado NO tiene respuesta

- **Ninguno documenta qué pasa con una anulación parcial de una línea con cantidad > 1**
  (se despacharon 3, se anula 1). Los tres hablan de "el ítem", no de la cantidad.
- **Square no tiene seguimiento de mermas real**: los propios usuarios reconocen en su
  comunidad que usan razones de comp como sustituto (*"accidental damage / incorrect
  product"*) porque no hay otra forma. Es una carencia declarada del producto, no una
  decisión de diseño.
- **Ninguno documenta el costo valorizado** de lo anulado: Lightspeed mueve la unidad de
  stock, pero no dice a qué costo la registra.

## 5. El cruce contra nuestro código — acá el mercado cambia de pregunta

Este es el punto donde la investigación **no se puede copiar**, y hay que medirlo antes de
diseñar. Medido el 2026-09-01:

**El stock no sale cuando se despacha: sale cuando la cuenta se cierra en venta.**
`ventas.service.ts:840` registra el movimiento de inventario dentro de la creación de la
venta —`motivo: 'venta'`—, y para un ítem `receta` la salida de los ingredientes la hace
`venderIngredientesReceta`, también en ese momento y atada al `ventaId`. Una línea de cuenta
abierta, despachada o no, **nunca generó un movimiento de inventario**.

Consecuencia directa: **el flag `Reverse stock` de Lightspeed no se puede portar**, porque
resuelve la pregunta al revés que la nuestra.

| | Lightspeed | Nosotros |
|---|---|---|
| Estado al anular | el stock **ya salió** | el stock **todavía no salió** |
| Lo que decide la razón | si se devuelve | si hay que **sacarlo igual**, sin venta que lo justifique |

O sea que para nosotros la pregunta no es *"¿el void devuelve el stock?"* sino **"¿anular
una línea despachada tiene que generar la salida de inventario que la venta habría
generado?"** — y con qué motivo, porque `motivo: 'venta'` ya no aplica.

**Lo que ya tenemos y sirve** (no hay que inventarlo):

- `cuenta_lineas.cantidad_enviada` — el eje "¿se hizo?" del mercado **ya está medido por
  línea**, y además por cantidad parcial, que es justo lo que ningún POS documenta (§4).
- Módulo `mermas` completo: catálogo `causas_merma` por tenant (fijas: *Vencimiento,
  Deterioro, Robo, Error operativo, Otro*), movimiento de inventario y **costo valorizado**.
  Es más de lo que Square tiene.
- `movimientos_inventario` como fuente de verdad auditable, con `usuarioId` en cada
  movimiento — la traza que Lightspeed guarda en su reporte.

**Lo que NO tenemos:**

- **`cortesía` no existe en ningún lado.** Solo aparece como texto en los dos mensajes de
  error de `salones.service.ts`. Hoy es una promesa de la UI sin nada detrás.
- Las mermas operan sobre `tipo = 'producto'`. Un plato despachado es normalmente una
  `receta`: mermarlo significa mermar **sus ingredientes**, que es la misma expansión que
  hace `venderIngredientesReceta` pero con otro motivo. Eso no existe.

## 6. Pata chilena (obligatoria)

- **No hay hecho fiscal.** La cuenta abierta no es un documento tributario: no hay boleta ni
  folio, así que sacar una línea antes de cerrar **no le debe nada al SII**. Es exactamente
  la frontera que fijó la pasada de julio (*"antes: se puede anular libre; después: solo NC
  electrónica"*), y acá estamos del lado libre. El problema es de **control interno**, no
  tributario.
- **Toteat no documenta la mecánica**, como advertía la plantilla. Su material comercial sí
  nombra el concepto —dice registrar *"ventas anuladas, cambios de pedido y salidas
  irregulares con contexto"* y tener registro de mermas—, lo que confirma que en el mercado
  chileno la función existe y se vende, pero no expone las reglas.
- ⚠️ **Una pregunta fiscal que queda ABIERTA y no se contesta acá:** si regalar un plato
  genera IVA débito por retiro/consumo. Busqué y lo que sale del SII es otra cosa (el
  control de facturas por consumos personales en restaurantes, dic-2024). Por
  **ADR-010 y la regla de que lo fiscal va solo**, esto no se resuelve de arrastre en este
  frente: se anota y, si el diseño lo toca, abre su propio frente con el owner.

## 7. Lo que queda para que decida el owner

Ninguna de estas la contesta el mercado por nosotros, y las tres cambian el diseño:

1. **¿La cortesía descuenta stock?** El plato se hizo, así que físicamente el ingrediente
   salió. Si no se descuenta, el inventario miente. Si se descuenta, hay que decidir con qué
   motivo y si entra al mismo reporte de mermas o a uno propio (el mercado dice que
   mezclarlos arruina el food cost, §1).
2. **¿Es una causa de merma más, o un concepto propio?** Lightspeed lo resuelve con un
   catálogo de razones y un flag; nosotros ya tenemos `causas_merma`. Reusarlo es barato,
   pero mezcla "se me cayó al piso" con "se lo regalé al cliente", que para el negocio son
   cosas distintas.
3. **¿Quién puede hacerlo?** El consenso del mercado es aprobación de manager y motivo
   obligatorio. En nuestro modelo eso es un permiso, y el garzón hoy opera con sesión propia.

📌 Y una que sale del cruce, no del mercado: **anular parcial** (se despacharon 3, se anula
1) es expresable en nuestro modelo porque `cantidad_enviada` es una cantidad, no un flag.
Ningún POS relevado lo documenta. Vale preguntarlo explícitamente en vez de asumir que se
anula la línea entera.

---

## Fuentes

- [Toast — Void Items, Payments, and Checks](https://support.toasttab.com/en/article/Voiding-Items-Payments-and-Checks)
- [Square — Get started with comp and void](https://squareup.com/help/us/en/article/5814-get-started-with-comp-and-void)
- [Square — Comp, void and reassign checks (Square for Restaurants)](https://squareup.com/help/us/en/article/8166-comp-void-and-reassign-checks-with-square-for-restaurants)
- [Lightspeed K-Series — Understanding void reasons](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804657449-Understanding-void-reasons)
- [Lightspeed K-Series — Cancellations and Corrections report](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4403189318043-Cancellations-and-Corrections-report)
- [Restaurant Systems Pro — When to use void vs comp](https://restaurantsystemspro.net/use-void-vs-comp-restaurant/)
- [Restaurant365 — How to reduce restaurant comps and voids](https://www.restaurant365.com/blog/how-to-reduce-restaurant-comps-and-voids/)
- [Square Community — falta de seguimiento de mermas](https://community.squareup.com/t5/Feature-Requests/Inventory-Waste-Tracking-amp-Management/idi-p/842747)
- [Toteat — soluciones para restaurantes](https://toteat.com/soluciones/restaurantes)
- [SII — control al uso indebido de facturas en restaurantes (dic-2024)](https://www.sii.cl/noticias/2024/191224noti01smn.htm)
