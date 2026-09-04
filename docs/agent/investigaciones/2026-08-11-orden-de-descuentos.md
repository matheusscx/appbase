# Orden de aplicación de descuentos apilados — investigación de mercado (2026-08-11)

> ⛔ **ABIERTA de verdad — y ahora tiene entrada en el backlog** (barrido del 2026-09-03).
>
> Se verificó contra el código: **ninguna de las cuatro opciones de la § 4 se construyó**. No
> existe columna `orden` en el puente ítem↔descuento (la única `orden` del módulo está en
> `descuento_tramo`, que es otra cosa), y el motor sigue con el par
> `calculoDescuentos: 'base' | 'compuesto'` sin criterio de orden entre tipos.
>
> Estaba con *"qué queda para decidir"* y **cero menciones en el backlog**, o sea que la
> decisión se había perdido de vista. Ya no: [`pendientes.md`](../pendientes.md) § 4.
>
> 📌 **Sigue valiendo lo que la propia investigación medía:** el problema es **más chico de lo
> que parecía** —solo afecta al modo `compuesto`, y el default es `base`— y **toca el motor de
> precios**, así que va solo y con el sistema quieto.


> ⛔ **Esto no es una decisión ni un diseño.** Es la foto de cómo lo resolvieron otros,
> insumo para cruzar y adaptar. Regla del cruce en
> [`investigacion-mercado.md`](../investigacion-mercado.md): si el mercado dice A y
> nuestro modelo o el owner dicen B, **gana B**.

**La pregunta que la origina** (entrada abierta en [`pendientes.md`](../pendientes.md)):
cuando un ítem tiene dos o más descuentos, ¿con qué criterio se ordenan? Hoy el orden no
está definido en ninguna query y **la tabla puente no tiene timestamp**, así que "el orden
en que el usuario los agregó" no existe ni se puede recuperar. El batch del 2026-07-28 fijó
un `ORDER BY` por id solo para que fuera **determinista**, no porque sea el criterio
correcto.

**Decisión del owner (2026-08-08):** correr esta investigación **antes** de diseñar.
Corrida inline por el agente el 2026-08-11.

---

## 1. El hallazgo que contesta la pregunta

**No hay un orden estándar de la industria que copiar.** Los dos POS más grandes fijan el
orden en el motor, no lo hacen configurable, **y lo fijan al revés uno del otro**:

| Sistema | Orden que aplica | ¿Configurable? |
|---|---|---|
| **Toast** | ítem → cheque **monto fijo** → cheque **porcentaje** | No |
| **Square** | **porcentaje** → monto fijo; entre porcentajes, **ascendente** (el menor primero) | No |
| **Lightspeed** | No aplica: **prohíbe apilar** | No |
| **Shopify** | producto → pedido → envío; **dentro** de un nivel, todos sobre el subtotal original | No |

Toast, literal: *"the Toast platform applies the discounts in the following order: 1.
Item-level discounts 2. Check-level discounts that reduce the check price by a currency
amount 3. Check-level discounts that reduce the check price by a percent value"*
([platform guide](https://doc.toasttab.com/doc/platformguide/adminDiscountPricing.html)).

Square, literal: *"The discounts are applied in ascending order, starting with the lower
percentage"* y *"If you're applying a combination of dollar and percentage discounts, the
percentage discount will be applied first followed by the dollar amount discount"*
([support](https://squareup.com/help/us/en/article/5362-apply-discounts)).

**Ninguno de los cuatro ofrece prioridad configurable por comercio.** Eso choca de frente
con el insumo que el owner había aportado el 2026-07-28 —"los e-commerce suelen darle a
cada descuento una prioridad configurable"— y que lo inclinaba por esa forma. La prioridad
configurable aparece en plataformas de e-commerce y en apps de terceros del ecosistema
Shopify, **no en los POS**. Vale como señal de hacia dónde mira el mercado adyacente, no
como práctica establecida del rubro.

### Las otras dos estrategias que aparecieron, y que no estaban sobre la mesa

- **Prohibir apilar** (Lightspeed): un descuento por línea y uno por transacción, y no se
  pueden apilar dos del mismo tipo. Toast va en la misma dirección por default —*"By
  default, item-level discounts cannot be combined"*— y exige habilitarlo regla por regla.
  Si no se puede apilar, **la pregunta del orden desaparece**. Es la respuesta más barata
  de implementar y la que más gente usa.
- **Elegir el mejor en vez de sumarlos** (Square con descuentos automáticos, Shopify al
  cruzar % con monto fijo): cuando dos aplican, gana el que más le conviene al cliente.
  Convierte el orden en un `max()`, que es conmutativo y por lo tanto inmune al problema.

### El dato de Shopify que más se parece a lo nuestro

Dos descuentos de pedido en porcentaje **se calculan ambos sobre el subtotal original**
(100 con 10% y 20% da 30 de descuento, no 28), mientras que un descuento de producto
seguido de uno de pedido **sí cascadea** (100 → 80 → 72).
([Shopify Help](https://help.shopify.com/en/manual/discounts/discount-combinations))

O sea: **`base` dentro de un nivel, `compuesto` entre niveles.** Nosotros tenemos esos dos
modos como una configuración por tenant que aplica a todo parejo.

---

## 2. La pata chilena: la norma estandariza los campos, no el algoritmo

El SII define los campos de descuento y recargo —`DescuentoPct`/`DescuentoMonto` y
`RecargoPct`/`RecargoMonto` por línea, y la sección `DscRcgGlobal` a nivel documento (hasta
20 líneas, con `TpoMov` D/R y `TpoValor` %/$)— pero **no impone en qué orden se aplican ni
sobre qué base**. Pide los montos resultantes; cómo se llegó a ellos es del emisor.

**Un buscador afirmó lo contrario** —que `NroLinDR` "garantiza que los descuentos se
apliquen en el orden especificado"— y **se verificó y es falso**. Dos documentaciones de
implementadores independientes lo definen como numeración y nada más:

- *"Numero secuencial de linea de Dcto o Recgo"*
  ([csc-chile](https://dtem3.csc-chile.com/rest_api/1-emisi%C3%B3n/1-documentos/dscrcgglobal/))
- *"Indica el número secuencial de línea de descuento / recargo de la Boleta Electrónica"*
  ([facturacion.cl](https://www.facturacion.cl/manualintegracion/archivoboletaintegracion.php))

Ninguna de las dos especifica la base de cálculo de un descuento global porcentual.
Es exactamente lo que [`investigacion-mercado.md`](../investigacion-mercado.md) anticipaba
sobre qué esperar de la pata chilena, y queda como caso testigo: **el resumen de un
buscador no es una fuente.**

**POS locales:** Bsale documenta que en su punto de venta **solo se aplica un cupón por
compra** ([ayuda Bsale](https://ayuda.bsale.app/support/solutions/articles/151000006134-c%C3%B3mo-crear-cupones-de-descuento)),
o sea la misma estrategia de Lightspeed. De Toteat no salió documentación pública del
motor, igual que en la pasada del 2026-08-02.

**Consecuencia para nosotros:** el orden es una decisión **de producto**, no fiscal. No hay
riesgo de incumplimiento por elegir cualquiera de las tres formas — el DTE va a llevar los
montos resultantes igual.

---

## 3. El cruce contra nuestro código (medido, no deducido)

Lo que el mercado no puede saber y cambia el tamaño del problema:

**El orden solo mueve el total en modo `compuesto`.** `aplicarValor`
(`calculo-precios.engine.ts:240`) devuelve el valor plano para `monto_fijo` e ignora la
base, así que en modo `base` todas las reglas se calculan sobre el neto y la suma es
conmutativa. Medido con el ejemplo de la entrada (neto 1000, 20% y fijo 100):

| Modo | % primero | Fijo primero |
|---|---|---|
| `base` | 700 | **700** |
| `compuesto` | 700 | **720** |

**Los dos tenants del seed están en `base`** (`SELECT calculo_descuentos FROM tenants`), y
`base` es el default de la columna (`tenant.entity.ts:30`). O sea que hoy el problema es
**inalcanzable en producción**, y la superficie real es "los tenants que elijan
`compuesto`", no "todos".

**Dónde el orden sí importa aunque el modo sea `base`:** en la **traza**, cuando el piso en
cero recorta. El total topeado es el mismo en cualquier orden, pero *cuál* de las reglas
aparece recortada en el comprobante depende del orden. No es plata, es atribución — y el
comprobante la muestra.

**Lo que ya está resuelto y no hay que rediseñar:** el piso en cero por regla y su
advertencia; el congelado de la regla aplicada en la venta; los dos modos de cálculo por
tenant. Nada de lo que trajo el mercado los contradice.

---

## 4. Qué queda para decidir

Las tres formas que ya estaban sobre la mesa, ahora con la evidencia al lado:

1. **Columna `orden` en la tabla puente, reordenable en la UI del ítem.** Es lo más
   flexible y lo que el owner prefería — pero **ningún POS del relevamiento lo hace**, y
   agrega un campo, migración de las filas existentes y UI nueva para un problema que hoy
   no toca a ningún tenant. Es la opción más cara y la que menos respaldo tiene.
2. **Regla fija en el motor.** Lo que hacen los cuatro. Barato y determinista. La
   contra: hay que elegir cuál, y Toast y Square eligieron al revés — o sea que **no hay
   una "correcta"**, hay que decidirla como producto. La lectura más común al mezclar
   tipos es aplicar el porcentaje sobre el monto sin descontar (Square), que además es la
   que un cliente entiende sin explicación.
3. **No apilar** (Lightspeed, Toast por default, Bsale con cupones). Hace desaparecer la
   pregunta. Es la más restrictiva y la que más se usa.

Una cuarta que apareció en la investigación y no estaba: **quedarse con el mayor** cuando
dos descuentos compiten. Es conmutativa, así que también disuelve el problema, y es lo que
Square hace con los automáticos.

⛔ **Cualquiera de las cuatro toca el motor de precios**, así que no se avanza sin volver a
confirmar con el owner. Lo que esta pasada aporta a esa conversación: el problema es más
chico de lo que parecía (solo `compuesto`, ningún tenant hoy), no hay estándar que copiar,
y la opción que el owner prefería es justo la que el mercado del rubro no usa.

---

## Fuentes

- Toast — [Effect of discounts on prices](https://doc.toasttab.com/doc/platformguide/adminDiscountPricing.html) ·
  [Discounts overview](https://doc.toasttab.com/doc/platformguide/platformDiscountsOverview.html)
- Square — [Apply discounts](https://squareup.com/help/us/en/article/5362-apply-discounts) ·
  [Order Discounts (API)](https://developer.squareup.com/docs/orders-api/discounts)
- Lightspeed — [Managing discounts (S-Series)](https://shopkeep-support.lightspeedhq.com/hc/en-us/articles/47480028867867-Managing-discounts)
- Shopify — [Combining discounts](https://help.shopify.com/en/manual/discounts/discount-combinations)
- SII / DTE — [Formato DTE v2.5 (2026-02)](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) ·
  [DscRcgGlobal (csc-chile)](https://dtem3.csc-chile.com/rest_api/1-emisi%C3%B3n/1-documentos/dscrcgglobal/) ·
  [Boleta electrónica (facturacion.cl)](https://www.facturacion.cl/manualintegracion/archivoboletaintegracion.php)
- Bsale — [Cómo crear cupones de descuento](https://ayuda.bsale.app/support/solutions/articles/151000006134-c%C3%B3mo-crear-cupones-de-descuento)
