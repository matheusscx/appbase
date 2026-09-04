# Investigación: ¿"bodega" es "sucursal"? — Bsale y el SII

> ⛔ **Regla del cruce** ([`../investigacion-mercado.md`](../investigacion-mercado.md)): lo que
> trae la investigación es **insumo para cruzar y adaptar**, nunca verdad a copiar.
>
> **Por qué se corrió** (owner, 2026-09-03): la pregunta 4 de la investigación de inventario
> —*"¿'bodega' es realmente sucursal?"*— llevaba desde julio sin entrada en el backlog, y al
> anotarla quedó como la que más convenía contestar primero: **si la respuesta es sí, deja de
> ser una tarea de inventario** y toca cajas, ventas y usuarios. El owner pidió mirar Bsale.

**Respuesta corta: no, y no es una discusión de nombres — es una distinción fiscal.** Son
**dos ejes independientes**, no dos niveles del mismo. Y hoy **no tenemos ninguno de los dos**.

---

## 1. Bsale: el corte es "¿se puede vender desde ahí?"

Frase literal de su documentación de producto:

> *"Desde una bodega no podrás hacer ventas. La diferencia entre una sucursal adicional y una
> bodega adicional es que en la última **no se pueden efectuar ventas**."*

Lo demás se sigue de eso:

- **Las dos guardan stock**, y las dos aparecen separadas en los reportes de stock actual.
- **El movimiento entre ellas es un despacho interno** — una guía que se emite y se recepciona,
  no un ajuste de inventario. Hay flujo de recepción explícito.
- **Una bodega no vende**, así que no necesita caja, ni documentos, ni usuarios de venta.

## 2. Y el SII lo endurece: la sucursal es una entidad fiscal

Esto es lo que convierte la decisión en algo más que una preferencia de modelado:

- **Hay que declararlas.** Apertura y cierre de sucursales se comunican al SII **dentro de dos
  meses**, por internet, con la dirección basada en el **ROL de la propiedad** y la comuna.
- **El SII asigna un código**, y ese código **viaja en cada documento**: `CdgSIISucur`, dentro
  de `Encabezado > Emisor` del DTE. Si no se envía, se usa el que esté configurado por defecto
  en el contribuyente.
- **Una bodega no tiene existencia fiscal ninguna.** No se declara, no tiene código, no aparece
  en ningún documento.

📌 O sea: **"sucursal" es un concepto del SII antes que del POS.** Un sistema que las tenga
tiene que poder decir, por cada documento emitido, de qué sucursal salió.

## 3. Cómo las vende Bsale — las dos son add-on mensual, y la sucursal vale el doble

Es la parte que más rápido se copia y la que más conviene mirar con cuidado.

| | Activación | Mensualidad |
|---|---|---|
| **Bodega adicional** | 0,5 UF + IVA | **0,5 UF + IVA / mes** |
| **Sucursal adicional** | 1 UF + IVA | **1 UF + IVA / mes** |

- **Recurrente y por unidad**, no un salto de plan. Sin límite por plan: se agregan las que
  hagan falta, **con descuento por cantidad**.
- **Autoservicio**: un cliente existente activa una bodega o una sucursal **solo, desde su
  cuenta, y sin costo de activación**. La activación se cobra al que llega de afuera.
- **Precio local por país**: Perú S/ 141/mes, México 640 MXN activación + 640 MXN/mes,
  internacional USD 38 + USD 38/mes.

**Lo que este modelo dice, más allá del precio:** el eje "ubicación" es una **palanca de
ingreso recurrente**, y el que sí vende vale exactamente **el doble** del que solo guarda. La
diferencia de precio sigue a la diferencia de capacidad, no al costo de infraestructura —
guardar stock y vender cuestan casi lo mismo de operar.

⚠️ **Un detalle que nos toca de refilón: Bsale cotiza en UF.** La decisión 3 de
[ADR-024](../../adr/024-decimales-redondeo-y-unidades-de-cuenta.md) —la UF— sigue abierta y
pausada. No es argumento para reabrirla, pero sí es un dato: el competidor más cercano factura
su propio SaaS en la unidad que nosotros todavía no sabemos si vamos a soportar.

## 4. El cruce contra nuestro modelo — no tenemos ninguno de los dos

Verificado el 2026-09-03:

- **Ni `bodega` ni `sucursal` existen en el código.** Los únicos resultados de un grep en
  `backend/src` son un tenant demo que se llama literalmente *"Demo Bodega"* y un comentario.
- **El stock es un escalar por ítem**: `item_producto.stock` es una columna, una fila por ítem.
  O sea **una sola bolsa de stock por tenant**.
- **Las cajas no tienen ubicación.** Una caja es `'fisica'` o `'virtual'` y cuelga del tenant
  y del usuario; es un cajón de dinero, no un lugar.
- **`razones_sociales` es otro eje** —entidad legal, con su RUT—, no ubicación. Un tenant puede
  tener varias, y eso no dice nada de cuántos locales tiene.

**Consecuencia práctica de hoy:** un tenant con dos locales tendría que operar como **dos
tenants** —cada uno con su catálogo, su stock y sus cajas— o compartir una sola bolsa de stock
entre los dos, que es incorrecto.

## 5. Qué se decide, entonces

La pregunta *"¿bodega es sucursal?"* no tiene respuesta porque **no es una pregunta**: son dos
ejes distintos y tenemos cero. Lo que hay que decidir es **cuál hace falta**, y se pueden
construir por separado.

| | **Bodega** (guarda, no vende) | **Sucursal** (vende) |
|---|---|---|
| **Dónde vive** | Adentro de inventario | Transversal |
| **Qué cambia** | `stock` deja de ser escalar y pasa a ser por ubicación; los movimientos ganan origen y destino | Cajas, ventas, usuarios, reportes **y lo fiscal** |
| **¿Toca lo fiscal?** | **No** | **Sí** — `CdgSIISucur` en cada documento |
| **Costo** | Contenido | Alto, y toca el motor de lo que ya está construido |

⛔ **Y una consecuencia de [ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md) que
conviene ver ahora, no después:** si van a existir sucursales, **de qué sucursal salió cada
venta es un hecho fiscal**, y un hecho fiscal no capturado en la transacción **no se
reconstruye**. Hoy no cuesta nada porque no hay datos productivos; el día que haya un local
real vendiendo y se sepa que viene un segundo, registrar el origen de cada venta es barato
**antes** e imposible **después**.

📌 **Lo que NO se sigue de esto:** que haya que construir sucursales ya. Bsale las vende como
add-on justamente porque la mayoría de sus clientes tiene una sola. La decisión es del owner.

---

## 6. Fuentes

**Bsale — oficial:**
- [Bodega Adicional](https://www.bsale.cl/product/bodega-adicional) — la frase de la diferencia,
  activación y mensualidad, autoservicio sin costo para clientes existentes ✅ **abierta y
  verificada el 2026-09-03**
- [Sucursal Adicional](https://www.bsale.cl/product/sucursal-adicional-bsale) · [Precios](https://www.bsale.cl/sheet/precios)
- [¿Cómo despachar Stock de una sucursal o bodega a otra?](https://ayuda.bsale.app/support/solutions/articles/151000005918--c%C3%B3mo-despachar-stock-de-una-sucursal-o-bodega-a-otra-)
- [¿Cómo recepcionar Stock de un Despacho Interno?](https://ayuda.bsale.app/support/solutions/articles/151000005919--c%C3%B3mo-recepcionar-stock-de-un-despacho-interno-entre-sucursales-)

**SII — oficial:**
- [Apertura y cierre de sucursales](https://www.sii.cl/preguntas_frecuentes/solic_actualiz_info/001_110_3479.htm) ·
  [plazo y trámite](https://www.sii.cl/preguntas_frecuentes/solic_actualiz_info/001_110_1189.htm) ·
  [guía para actualizar domicilio, actividad y sucursales](https://www.sii.cl/servicios_online/docs/guia_actualizar_domicilio_actividad_economica_sucursales.pdf)
- `CdgSIISucur` en `Encabezado > Emisor`: **[SECUNDARIA]** — descrito por un proveedor de
  facturación, coherente con el Formato DTE ya leído en otras pasadas, **pero no se abrió el
  formato para verificar este campo puntual**.

---

## 7. Relacionados

- [`2026-07-26-inventario.md`](2026-07-26-inventario.md) — de donde sale esta pregunta (§ 6, punto 4)
- [`pendientes.md`](../pendientes.md) § 4 — la entrada que la contiene
- [ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md) — congelar el hecho fiscal ahora
- [ADR-016](../../adr/016-costeo-promedio-ponderado-movil.md) — cerró las dos primeras preguntas de inventario
