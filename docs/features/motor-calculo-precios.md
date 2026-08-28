# Feature: Motor de cálculo de precios

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-08-21

---

## Overview

### What is it?

Motor que, dada una lista de líneas (ítem + cantidad) y un contexto (método de
pago, reglas a nivel venta), devuelve el **desglose de precio**: neto →
descuentos → recargos → impuestos → total, con trazabilidad por regla. Es un
**servicio puro y stateless**: no persiste nada. Lo consumirán ventas, notas de
crédito y la previsualización de precio en el POS.

### Why does it exist?

Todos los insumos de precio ya estaban modelados (ítems, impuestos, descuentos,
recargos, fórmula y preferencias financieras por tenant) pero faltaba la pieza
que los combina aplicando la configuración del tenant de forma consistente y
auditable. El cálculo de dinero usa **Decimal.js** en todo (nunca `number`).

### Scope

- **Incluido**: cálculo por línea y por venta; reglas planas (% o monto fijo),
  tramos (**cada tramo dice si su umbral es cantidad o monto**, según cuál de
  `minimo_cantidad`/`minimo_monto` esté lleno — desde el 2026-08-24 el motor ya
  no lo deduce del código de la regla) y filtro por
  método de pago —que desde el 2026-08-25 es solo eso, un **filtro**: la rama de
  `METODO_PAGO_CODIGOS` decide *si* la regla aplica y sigue de largo, así que
  esos dos tipos también cobran por escalones si los tienen—; **vigencia por
  fecha** para cualquier regla con
  `fechaInicio`/`fechaFin` (ver `docs/superpowers/specs/2026-08-23-vigencia-por-fecha-design.md`);
  desbruteo cuando `precio_incluye_impuesto`; `base` vs `compuesto`; orden de
  fórmula configurable; `escala_calculo` + `modo_redondeo`; **cuantización a la
  escala de la moneda oficial** al cerrar cada paso, con `nivel_redondeo`
  (`linea` | `documento`) eligiendo dónde cierra.
- **NO incluido (futuro)**: reglas por vencimiento (`mora`, `pronto_pago`) —
  requieren datos de crédito aún inexistentes; condiciones
  `monto_minimo`/`cantidad_minima`/`customer`/`categoria`.
  (Persistencia de ventas y conversión a moneda oficial **ya existen** desde entonces —
  ver `convertirAMonedaOficial`, más abajo.)

---

## API Endpoints

```
POST /calculo-precios/calcular
Authorization: Bearer <token>   (JwtAuthGuard + TenantGuard; tenant del token)

Request:
{
  "lineas": [
    { "itemId": "uuid", "cantidad": "2",
      "precioUnitario": "100",            // opcional (override de precio_base)
      "descuentoIds": ["uuid"],           // opcional (reemplaza los del ítem)
      "recargoIds": [],                   // opcional (reemplaza los del ítem)
      "impuestoIds": []                   // opcional (reemplaza los ADICIONALES del
                                           // ítem, tipo='otro'; el IVA no se puede
                                           // pisar ni quitar — 400 si trae un id
                                           // tipo='iva', ver ADR-018)
    }
  ],
  "metodoPagoId": "uuid",                 // opcional (habilita reglas metodo_pago)
  "descuentosVentaIds": ["uuid"],         // opcional (reglas a nivel venta)
  "recargosVentaIds": []
}

Response (201):
{
  "lineas": [{
    "itemId", "cantidad", "precioUnitario",
    "subtotalNeto", "descuentoAplicado", "recargoAplicado",
    "impuestoAplicado", "totalLinea",
    "trazas": {
      "descuentos": [{ "id", "nombre", "monto" }],
      "recargos":   [...],
      "impuestos":  [{ "id", "nombre", "tasa", "monto" }]
    },
    "advertencias": [{ "titulo": "Descuento \"X\"", "detalle": "no se aplicó completo porque superaba el monto disponible" }]
  }],
  "totales": {
    "subtotalNeto", "totalDescuentos", "totalRecargos",
    "totalImpuestos", "totalFinal"
  },
  "trazasVenta": { "descuentos": [...], "recargos": [...] },
  "advertenciasVenta": [{ "titulo": "…", "detalle": "…" }],
  "advertencias": [{ "titulo": "…", "detalle": "…" }]
}
```

**Advertencias.** El motor emite avisos que **no frenan el cálculo**. Hoy son cuatro:
un descuento que supera el monto disponible y se topea; una **regla pausada**
(`activo = false`) que por eso no se aplica; un **impuesto pausado**, ídem; y un **ítem
pausado**, que a diferencia de los anteriores **sí se cobra** —el aviso es que ya no se
ofrece en el catálogo, no que no se aplicó— y por eso lo emite el service y no el motor
(un ítem pausado no cambia ningún monto). Ver
[descuentos-recargos.md](./descuentos-recargos.md). Cada advertencia viaja
partida en `{ titulo, detalle }` (`AdvertenciaPrecio` en el motor) en vez de una
frase única: el carrito es angosto y una sola línea de texto con todo el mensaje
ocupaba varios renglones, así que `titulo` (ej. `Descuento "X"`) se muestra en la
línea y `detalle` (ej. `no se aplicó completo porque superaba el monto disponible`,
sin nombrar montos: el aplicado ya viaja en la traza, que el front formatea) queda
en un tooltip. El resultado los expone en dos granularidades porque se muestran en
lugares distintos: `ResultadoLinea.advertencias` va bajo la línea que lo produjo, y
`advertenciasVenta` —las reglas a nivel venta, que no pertenecen a ninguna línea— va
junto al total. `advertencias` es el aplanado de ambos.

> ⚠️ `advertenciasVenta` son **descuentos Y recargos** de venta. Hasta 2026-08-03 decía
> "solo los descuentos", y era cierto por accidente: la única advertencia que existía
> —el tope— solo se emite en descuentos, así que el ensamblado leía `dv` e ignoraba `rv`
> sin que se notara. Cuando las reglas pausadas hicieron que un recargo también pudiera
> avisar, ese supuesto se volvió un bug: un recargo de venta pausado bajaba la plata
> cobrada sin traza ni advertencia. Si tocás esta parte, las dos ramas van siempre.

La razón de
separarlos en vez de que el consumidor reste por igualdad: dos advertencias con el
mismo `titulo`+`detalle` son alcanzables (dos descuentos distintos topeados al mismo
monto producen el mismo mensaje).

**El aplanado se deduplica; las otras dos listas no** (decisión del owner, 2026-08-11).
Un carrito de 10 líneas con el mismo impuesto pausado producía **10 avisos idénticos**,
que el POS aplana a 10 toasts; igual con un ítem pausado cargado en varias líneas. Es
información de **catálogo**, no de una línea, y repetirla tapa los avisos que sí son de
una línea. `ResultadoLinea.advertencias` y `advertenciasVenta` quedan intactos: cada uno
se muestra pegado a lo que lo produjo, y ahí la repetición es la que marca **cuáles**
líneas están afectadas.

**El alcance es más ancho que "lo pausado", a propósito.** `sinRepetidas` colapsa
cualquier par de avisos con el mismo `titulo`+`detalle`, y eso **incluye el aviso del
tope**, que sí es por línea: dos líneas cuyo descuento se topea producen el mismo texto.
Se decidió colapsarlo igual, y el criterio es el mismo: **dos mensajes idénticos no le
dicen al lector que hubo dos eventos** —el `detalle` no nombra montos ni líneas a
propósito—, así que repetirlo no informa, solo tapa. Lo que sí distingue las dos líneas es
`ResultadoLinea.advertencias`, que no se toca. El párrafo de arriba advierte que ese
choque de textos es alcanzable: lo es, y por eso está contemplado en vez de asumido.

✅ **El borde donde el colapso escondía algo se cerró el 2026-08-16.** `impuestos` era la
única de la familia sin índice único de nombre por tenant, así que dos impuestos distintos
con el mismo nombre, ambos pausados, daban un solo aviso. Ahora lleva
`uq_impuestos_tenant_nombre_vivo`, como `descuentos` y `recargos` — ver
[impuestos.md](./impuestos.md) y `docs/agent/resueltos.md`.

Va en **dos lugares y no en uno**: `sinRepetidas` en el motor, y un `Set` por `itemId` en
`advertirItemsPausados`, porque esa advertencia se empuja **después** de que el motor
devolvió y la del motor ya corrió. Si aparece una tercera fuente de advertencias fuera del
motor, tiene que deduplicar también. La clave del `Set` va en minúsculas: `@IsUUID('4')`
acepta mayúsculas y la BD devuelve minúsculas, así que el mismo ítem puede llegar con dos
casings en el mismo carrito (es lo que resuelve `aliasarCasingDeIds`).

**Un impuesto pausado ya no avisa si la fórmula del tenant no incluye el paso
`impuestos`.** El aviso se armaba antes de recorrer `cfg.formula`, así que salía siempre;
en un tenant sin ese paso el impuesto no se iba a cobrar de todos modos y el "no se
aplicó" describía la fórmula, haciéndolo pasar por consecuencia de la pausa.

Al persistir la venta, `ventas.service.ts` vuelve a componer cada advertencia en una
sola frase (`` `${titulo}: ${detalle}` ``) para el campo `advertencias: string[]` de
la respuesta de la venta —el mismo formato de siempre, que consumen los toasts del
POS—. Ese contrato no cambia; la partición en `titulo`/`detalle` solo viaja por el
motor y la previsualización del carrito.

Todos los montos son strings con `escala_calculo` decimales — pero eso es **formato, no
valor**: `fmt()` hace `toFixed(escalaCalculo)` sobre un Decimal ya cuantizado a la escala
de la moneda oficial del tenant, así que un total de CLP viaja como `"1000.000000"` y no
como `"1000.500000"` (ver *La escala de cierre*, más abajo). Con
`nivelRedondeo = 'documento'` las líneas llegan finas de verdad y solo los totales están
cuantizados.

---

## Backend

### Module & Services

- **Module**: `src/modules/calculo-precios/calculo-precios.module.ts`
  (importa `ItemsModule`, `ImpuestosModule`, `DescuentosModule`,
  `RecargosModule`, `TenantsModule` — **reúsa** sus servicios, no crea entidades).
- **Controller**: `calculo-precios.controller.ts` — `POST /calculo-precios/calcular`.
- **Service**: `calculo-precios.service.ts` — resuelve datos del tenant (ítems,
  catálogos de reglas, preferencias) y delega en el motor puro. **Carga el
  carrito entero en 2 queries fijas**, no una por línea:
  `ItemsService.cargarBasePorIds` (fila base + validación de pertenencia al
  tenant, 404 si falta) y `cargarReglasPorIds` (los ids de
  impuestos/descuentos/recargos de todos los ítems en un `UNION ALL`).
  `resolverLinea` no hace I/O.
- **Motor puro**: `calculo-precios.engine.ts` — `calcularVenta(VentaResuelta)`,
  sin BD ni NestJS; 100% testeable de forma aislada.

**Orden de las reglas — cerrado el 2026-08-11.** En modo `compuesto` cada regla se
aplica sobre el acumulado de la anterior, así que el orden **cambia el total**
cuando se mezclan `monto_fijo` y porcentaje. Ese orden no estuvo definido hasta
esa fecha: entre 2026-07-28 y 2026-08-11 fue "determinista por id" (`ORDER BY` en
`cargarReglasPorIds`) y nada más — determinismo sin criterio.

**Hoy lo decide el motor**, no la query: `ordenarReglas` pone los porcentajes antes
que los montos fijos. La regla, su porqué y sus consecuencias están en
**Algoritmo (núcleo)**, más abajo. El `ORDER BY` de `cargarReglasPorIds` quedó como
desempate entre reglas del mismo modo, donde el orden no mueve el total.

### DTOs

- `CalcularVentaDto` / `LineaDto` (`dto/calcular.dto.ts`) — validación con
  `class-validator`. `cantidad`/`precioUnitario` como `@IsNumberString`.

### Algoritmo (núcleo)

**De dónde sale el importe de una regla (2026-08-23).** Desde que `valor` se partió, cada
descuento y cada recargo lleva su importe en `valor_monto` **o** en `valor_porcentaje`, y el
motor toma la que corresponde con `valorDelModo(regla.modo, …)`. La otra se ignora: el `modo`
manda, aunque un CHECK de tabla ya impide que las dos vengan llenas.

⚠️ **`modo` no se volvió redundante con eso**, y conviene decirlo porque es lo primero que
uno supone: sigue siendo la **clave de orden** de los pasos —los `monto_fijo` se aplican
después de los porcentajes, ver `ordenarReglas()`— y sigue siendo lo que se **congela en la venta**.
Lo que sí cambió es que `valorEfectivo` ya no puede salir de un número ambiguo.


**Desbruteo.** Si `precio_incluye_impuesto`, el neto sale de dividir por `1 + Σ tasas`
de **todos** los impuestos vigentes de la línea, no solo el IVA: el precio de góndola de
una botella con ILA ya trae los dos, y tratarlo como "IVA solamente" cobraría el ILA dos
veces. Un impuesto **pausado sale de esa suma antes de dividir** (si no se cobra, no puede
inflar el divisor), y eso tiene una consecuencia querida y decidida por el owner el
2026-08-04: **la etiqueta manda**. El precio final no cambia y lo que se dejó de cobrar
pasa a ser neto. La boleta reporta más neto y menos impuesto, que es exactamente lo que
pasó. La alternativa —bajar el precio final para preservar el neto— se descartó porque
dejaba lo cobrado sin coincidir con el precio impreso en góndola.
Lo fija el test *"el desbruteo no usa la tasa del impuesto pausado"*.

**Y el total cierra a la etiqueta.** La misma decisión gobierna el redondeo: con precio
bruto-inclusivo y **la base de la línea en el neto de la etiqueta**, el impuesto no es
`tasa × base` sino lo que sobra — `q(bruto × cantidad) − neto` —, porque el cliente paga
exactamente lo que vio en la góndola. Con `tasa × base` no cerraba: góndola $993 → neto
834, IVA 158, total **992**. Los impuestos **adicionales** (`tipo = 'otro'`, el ILA) van
por su fórmula y el **IVA absorbe el residuo**; si la línea es exenta —sin IVA que ceda—
lo absorbe el adicional de mayor tasa, con desempate por `id` para que la traza no dependa
del orden en que llegó la lista. La traza del absorbente declara **lo que absorbió**, no su
fórmula: `Σ trazas = impuesto_aplicado` sigue valiendo, que es lo que hace que cada
impuesto sea una línea del documento.

**Cuando la base se mueve vuelve la fórmula normal**, y no es un parche:
"la etiqueta manda" vale mientras el cliente pague la etiqueta. Con un descuento ya no la
paga, así que no hay góndola que cerrar y lo que el documento tiene que declarar es el
impuesto de la base realmente cobrada. Medido sobre esa misma línea con un 10% (base 751):
restar contra la góndola da un IVA de 242 —cobra la etiqueta entera e ignora el
descuento— y contra góndola−descuento da 159, cuando el correcto es **143**, que es lo que
da `tasa × base`. Lo fija el test *"con descuento en la línea el IVA vuelve a ser
tasa × base, no la resta"*.

**La condición mira lo que el cliente pagó, no cómo llegó ahí** (decisión del owner,
2026-08-21). Hasta esa fecha la rama pedía que la línea no tuviera *ninguna regla
aplicada*, y eso dejaba afuera un caso donde el cliente **sí** paga la etiqueta: un
descuento y un recargo que se anulan entre sí. La base es la misma, el ticket cobra lo que
dice la góndola, y el documento salía igual por la fórmula. Medido: barriendo góndolas
100..3000 con IVA 19% en CLP, **463 de 2901 precios (16%) declaraban ±1 peso contra su
propia etiqueta** —993 → 992, pero también 103 → **104**, cobrando de más—. Y no hacía
falta un caso exótico: alcanza un descuento y un recargo del **mismo porcentaje**, porque
con `calculo_descuentos = 'base'` —el default de todo tenant— los dos aplican sobre el
neto y se cancelan.

La condición pasó a ser `base == subtotal_neto`. Las dos reglas se siguen **declarando**
en el documento —el ticket imprime el descuento y el recargo—; lo que cambia es de dónde
sale el impuesto. La comparación de bases subsume al guard viejo: la línea con un 10% de
descuento real la excluye sola, porque ahí la base no volvió. El borde queda en el peso: un
recargo de 49 contra un descuento de 50 **no** cierra a la etiqueta, y es correcto que no
lo haga —el cliente pagó un peso menos que la góndola—. Lo fijan los tests *"un descuento y
un recargo que se anulan siguen cerrando a la etiqueta"*, *"la etiqueta también manda
cuando la fórmula cobraría de más"* y *"si el recargo no compensa exacto, la línea vuelve a
la fórmula"*.

📌 **El salto de un peso no se creó ni se eliminó, se movió.** Con descuento 50 y recargos
48→52 la línea daba `990, 991, 992, 994, 995` —el salto de 2 entre 992 y 994 ya estaba, es
el escalón de la cuantización del IVA— y ahora da `990, 991, 993, 994, 995`. Elegir la
regla de la etiqueta no agrega discontinuidades: elige **cuál** de las dos vecinas cae del
lado de la góndola.

Por línea: neto unitario (desbruteo si incluye impuesto) × cantidad → recorrer la
fórmula (`paso 1,2,3`) sobre un acumulador. Descuentos restan, recargos suman;
el `%` se calcula sobre el neto (`base`) o sobre el acumulado (`compuesto`).
Impuestos sobre la base ya descontada/recargada (sin impuesto sobre impuesto) —
**salvo la rama de góndola de arriba**, donde el IVA es el residuo y no una fórmula
sobre esa base. Reglas a nivel venta se aplican sobre el neto agregado.

### La escala de cierre: dónde se decide el último decimal (2026-08-21)

Hasta el cierre del redondeo de plata, **el último redondeo de una venta no lo decidía
nadie**: los montos llegaban del motor con `escala_calculo` decimales (6 por default) y
Postgres los recortaba al castear a `NUMERIC(18,4)`. Eso persistía medio peso chileno en
ventas y vueltos, ignoraba el `modo_redondeo` del tenant (`FLOOR`, `CEIL` y `HALF_UP`
producían el mismo total) y ocurría fuera de toda configuración. Hoy la escala final la
decide el motor.

**Dos escalas, y no hay que confundirlas:**

| | Qué es | De dónde sale | Qué decide |
|---|---|---|---|
| `escala_calculo` | La precisión del **borrador** | Preferencias del tenant (default 6) | **Nada de lo persistido.** Solo cuánta precisión conservan los cálculos intermedios |
| `decimalesMoneda` | El **minor unit** de la moneda oficial | `moneda.decimales` (`CHECK 0..4`) | El valor final de todo monto que la venta guarda |

La frase *"`escala_calculo` no decide nada de lo persistido"* recién ahora es verdadera.

**Dónde se cuantiza — la regla que hace que el documento cuadre.** Al cerrar cada **paso**
de la fórmula, nunca en cada regla:

- **Dentro** de un paso —varias reglas encadenadas en `compuesto`— el acumulado corre fino.
  Cuantizar regla por regla **compone** el error (es el caso del Vancouver Stock Exchange).
- **Al cerrar el paso**, el acumulado pasa a ser el que el documento declara:
  `neto_Q − Σ descuentos_Q + Σ recargos_Q`. El paso siguiente parte de ahí.

Importa por el IVA: la base imponible es el acumulado al inicio del paso `impuestos`. Sobre
un acumulado fino, el impuesto declarado no sería `tasa ×` la base que la boleta muestra.
Con tres pasos como máximo, el error queda acotado a tres redondeos y no a uno por regla.

**Los totales se derivan, no se cuantizan aparte.** `total_final` sale de sus componentes
(`neto − descuentos + recargos + impuestos`); cuantizar cada total por su cuenta rompe esa
identidad. Medido durante el frente: **3.965 de 10.000** carritos generados quedaban con
`MntTotal ≠ MntNeto − Desc + Rec + IVA`. Lo mismo vale por línea: `Σ totalLinea − dv + rv`
tiene que dar `totalFinal` exacto.

**`nivelRedondeo` elige dónde cierra** (preferencia del tenant, default `linea`):

- **`linea`** — cada línea cierra en la escala de la moneda y el total es la suma. Los
  totales del documento ya son suma de valores cuantizados, así que no se vuelven a tocar.
- **`documento`** — las líneas corren finas de punta a punta y **solo los totales** se
  cuantizan al final (la regla mexicana). Rechazada por 400 con moneda oficial de 0
  decimales: no hay nada que ganar y las líneas quedarían con decimales que la moneda no
  tiene. Ver [preferencias-financieras.md](./preferencias-financieras.md).

⚠️ **Lo que `documento` cuesta contra `linea`, medido el 2026-08-28** — antes y después del
arreglo del reparto, que entró ese mismo día. La comparación es contra **aritmética de alta
precisión** (el mismo carrito con escala y moneda de 10 decimales, donde no se cuantiza nada),
no contra otra config del sistema: comparar una config contra sí misma da cero por definición
y no mide nada. Carritos con IVA, moneda de 2 decimales y `escalaCalculo` 4, peor caso sobre
2.103 carritos por tamaño, en unidades de la escala:

| carrito (1 / 2 / 3 / 5 / 8 líneas) | `linea` | `documento` antes | `documento` ahora |
|---|---|---|---|
| **con** descuento de nivel venta | 0,95 / 1,33 / 1,63 / 2,35 / 2,57 | 1,90 / 2,92 / 3,84 / 5,90 / **8,88** | 0,97 / 0,97 / 0,98 / 0,98 / **0,98** |
| **sin** descuento de nivel venta | 0,50 / 1,00 / 1,37 / 2,04 / 2,51 | 0,50 / 0,50 / 0,50 / 0,50 / 0,50 | sin cambio |

⚠️ Las tres columnas salen de **un mismo generador de carritos**, corrido dos veces (motor
viejo y motor nuevo). Por eso no coinciden con las cifras de la primera medición del frente,
que usó otro generador: lo comparable es antes/después dentro de esta tabla, no entre tablas.

- **Sin descuento de nivel venta el nivel siempre cumplió**: `documento` se queda **plano**
  (0,50, no crece con el carrito) mientras `linea` acumula el redondeo de cada línea.
- **Con descuento de nivel venta `documento` crecía ~1 unidad por línea y sin techo.** Ese
  era el hueco, y quedó cerrado: ahora también es **plano** y le gana a `linea` de dos líneas
  en adelante. ⚠️ El 0,97–0,98 de la tabla es el **máximo de este barrido, no una cota**: la
  revisión independiente repitió la medición con otro generador y llegó a 1,00 con ocho
  líneas. Lo que las dos mediciones sostienen es que **no crece con las líneas**, no el
  dígito.

**La condición que lo encendía eran las dos cosas juntas: `nivelRedondeo: 'documento'` Y
`escalaCalculo > decimalesMoneda`.** Ninguna sola alcanzaba — barriendo las diez combinaciones
`(decimalesMoneda, escalaCalculo)` que los guards dejan pedir, con `escalaCalculo ==
decimalesMoneda` la penalidad era **0,00 en las cuatro configs donde eso pasa**, y con
`'linea'` subir la escala por encima de los decimales no agrega nada. Lo que queda debajo
—el ~1 a 2,6 unidades que las dos columnas comparten— **no es un defecto del nivel: es lo que
cuesta redondear**, y `linea`, el default de todos los tenants, lo tiene igual.

**Por qué pasaba, y qué lo cerró.** `repartirProporcional` (el reparto del descuento de venta
por línea) y la conversión de ese descuento a neto cuantizaban **siempre, sin mirar
`nivelRedondeo`**. Inofensivo cuando la línea ya corre cuantizada; el hueco cuando corre fina.
Pero **pasar el cuantizador del nivel no alcanzaba**: el residuo del reparto llegaba entonces
en fracción de centavo y el paso de unidad mínima nunca lo llevaba a cero, así que el loop le
sumaba un centavo a **cada** línea — de ahí el crecimiento de ~1 unidad por línea. Medido
sobre 20.000 repartos con moneda de 2 decimales: con el monto fino y las partes cuantizadas
(lo que hacía `'documento'`) el 99,02 % de los repartos no sumaba el monto; con las partes
finas y pasos de unidad a secas, el 23,69 % — porque `monto × peso / total` redondea a 20
dígitos significativos y deja un epsilon (~2e-16).

El arreglo son las dos cosas: el cuantizador del nivel viaja hasta el reparto y hasta la
conversión a neto, y el residuo se reparte en dos tramos —pasos de unidad mientras quepa una
entera, y lo que queda va entero a la parte de mayor resto—. Con `'linea'` el reparto sale
idéntico al de antes (0 de 20.000 repartos cambian), y el detalle vive en el docblock de
`repartirProporcional`. La identidad aditiva del documento cerraba en todos los casos medidos
antes y después: el desvío era contra la aritmética, no entre las partes del comprobante.
Cubierto en `calculo-precios.engine.spec.ts` ("con 'documento' el desvío del total no crece
con las líneas" y "el carrito que se desviaba 3,23 unidades ahora se desvía 0,23").

**Lo que hereda por construcción.** Nada fuera del motor tuvo que cambiar: el vuelto de un
pago en efectivo (`pagos.vuelto`, que llegaba a persistir `994942.5000`) queda entero
porque se calcula sobre un total que ya lo está. Un monto que no pasa por el motor no se
cuantiza solo — **se rechaza en el borde HTTP** (ver
[backend.md](../patterns/backend.md)).

**La conversión a moneda oficial: el único lugar que hace `precio × tasa`.**
Cuando el ítem está en otra moneda, su precio se convierte antes de armar la línea.
Vive en `CalculoPreciosService.convertirAMonedaOficial` y es **una sola función
compartida**: la llaman la previsualización (`POST /calculo-precios/calcular`) y
ventas, que convierte por su cuenta el precio que después persiste. Estuvieron
duplicadas hasta el 2026-08-11 y esa duplicación era el bug: se podía arreglar una
y dejar la otra, y entonces el POS mostraba un precio y la venta guardaba otro.
Ventas carga la config con `cargarConfig` y se la pasa a `calcular` por
`configPrecargada` — así convierte con el mismo `modo_redondeo` que el motor sin
consultar las preferencias dos veces por venta.

Dos decisiones, porque las dos parecen descuidos y solo una lo era:

- **El modo sale de `modo_redondeo`** (desde el 2026-08-11; antes era el default de
  Decimal.js, HALF_UP, y le desobedecía a un tenant en `FLOOR`).
- **La escala son 4 decimales fijos, no `escala_calculo`, y es correcto.**
  `escala_calculo` es el borrador de los cálculos intermedios; este valor no es
  intermedio: se persiste en `venta_detalles.precio_unitario`, `NUMERIC(18,4)`.
  Subirlo no evitaría el recorte, lo movería al `INSERT` —Postgres, su propia
  regla, fuera de la config y sin test—. Hay un test que lo fija justamente porque
  el arreglo **se ve** incompleto e invita a "completarlo".

No es un tercer sitio: el `.toFixed(4)` de `precioBase + precioExtraTotal` en
ventas nunca redondea —suma dos strings que ya vienen con 4 decimales exactos—, así
que solo formatea. Si algún día las unidades de un extra admiten fracción, el
redondeo real va a ocurrir en los tres `toFixed(4)` de `items.service.ts`, no ahí.

⚠️ **"Único" es acotado a `precio × tasa`, no a "toda la plata fuera del motor":** el
CPP de inventario, el costo propuesto de una receta y el reparto de propinas también
redondean y siguen en HALF_UP fijo (`docs/agent/pendientes.md`).

**Decisiones**: `monto_fijo` se aplica por línea (no por unidad); las reglas
diferidas (`mora`, `pronto_pago`) devuelven monto 0; una regla con fechas fuera
de su vigencia hace `continue` antes de evaluar (sin traza ni advertencia); los
ids de
descuento/recargo/impuesto en la línea **reemplazan** a los asociados al ítem
(override) — con una excepción: para impuestos, el override solo alcanza a los
**adicionales** (`tipo='otro'`). El IVA nunca sale de `impuestoIds`, ni del ítem
ni de la línea — lo deriva el motor de `clasificacion_tributaria` y no se puede
pisar ni quitar por payload (400 si llega un id `tipo='iva'` explícito, ver
[ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)).

**Orden de aplicación dentro de un paso: porcentajes antes que montos fijos**
(decisión del owner, 2026-08-11). Cuando un ítem —o una venta— tiene varias reglas
del mismo paso, el motor las ordena él mismo (`ordenarReglas`) antes de aplicarlas.
Vale para descuentos **y** recargos.

- **Por qué la pregunta se reduce a esto:** `aplicarValor` ignora la base cuando el
  modo es `monto_fijo`, así que un fijo resta lo mismo vaya donde vaya. El único
  que depende de la posición es el porcentaje, y lo que se elige es si mira el
  precio original o el ya rebajado. Con 1000, un 20% y un fijo de 100: **700** con
  el porcentaje primero, 720 al revés.
- **Las tres razones:** "20% de descuento" significa 20% del precio, que es lo que
  se le dijo al cliente; le conviene al cliente; y **el último es el que se recorta**
  cuando entra el piso en cero — un fijo recortado se explica en el ticket ("el
  descuento de 1200 aplicó 1000"), un porcentaje recortado no.
- **Va en el motor y no en el `ORDER BY` de las queries** porque hay tres caminos
  que arman listas de reglas (ventas, salones, combos): una regla que dependa de que
  los tres se acuerden del mismo `ORDER BY` se rompe sola.
- **Dentro de cada grupo el orden no se toca** (el sort es estable): entre reglas del
  mismo modo el total no cambia, así que el desempate del llamador —hoy por id— es
  arbitrario sin consecuencias. Con tres o más porcentajes puede mover el último
  decimal por redondeo de paso; está anotado en `docs/agent/pendientes.md`.
- **Efecto lateral bueno, medido:** un descuento fijo que se topeaba dejaba el
  acumulado negativo y **evaporaba en silencio** al porcentaje que venía después
  (el guard lo llevaba a 0). Con el orden nuevo eso no ocurre por construcción.
- No se relevó ningún estándar de industria que copiar: Toast y Square fijan órdenes
  **opuestos** y ninguno lo hace configurable. Detalle y fuentes:
  [`investigaciones/2026-08-11-orden-de-descuentos.md`](../agent/investigaciones/2026-08-11-orden-de-descuentos.md).
  **Config por tenant: no por ahora** — se evalúa si aparece un tenant que la pida.

**Piso en cero del descuento** (decisión del owner, 2026-07-28). **Ninguna regla
puede dejar el total bajo cero** — un `precio_base` negativo sí puede, y eso es
otro pendiente. Sin tope, un `monto_fijo` de 500 sobre un ítem de 100
dejaba `totalLinea: -400` y el tenant terminaba pagándole al cliente. Cuatro
precisiones que hacen a la regla:

- Se topea **regla por regla, al aplicarla**, no al final sobre el total. Así la
  traza registra lo que realmente se descontó y el comprobante cuadra
  (`subtotalNeto − totalDescuentos` sigue dando el total). Con tres descuentos
  del 40% en modo `base` sobre 100, la traza queda 40 / 40 / 20.
- Aplica **también a los descuentos a nivel venta**, y ahí el tope se mide
  contra el **total real** (`Σ totalLinea`, ya con descuentos e impuestos de
  línea adentro), **no** contra el neto agregado. El neto sigue siendo la base de
  los `%` —esa es la semántica de las reglas a nivel venta—, pero la plata
  disponible para topear es otra magnitud. Confundirlas dejaba ventas en negativo
  sin advertencia **y** recortaba descuentos sanos cobrando de más; lo detectó la
  revisión independiente porque el primer test usaba una línea pelada, el único
  caso donde las dos magnitudes coinciden.
- **El sobrante del descuento se pierde** (decisión del owner, 2026-08-11): no se
  guarda para compensar un recargo posterior. Con neto 1000, descuento fijo 1200 y
  después un recargo fijo de 2000, el cliente paga **2000**, no 1800 — 200 más en
  una venta que nunca fue negativa. Es **más estricto que la regla original**, que
  habla del total y no del acumulado intermedio, y se eligió igual: topear recién
  al final dejaría la traza mostrando un descuento de 1200 sobre una línea que
  bajó 1000, y ahí el comprobante deja de cuadrar. El borde es raro por diseño
  —exige un descuento fijo mayor al neto **y** un recargo posterior que lo
  levante— y lo encontró un fuzz de 20.000 ventas de la revisión independiente.
  Lo fija el test `el sobrante de un descuento topeado NO compensa un recargo
  posterior`, que está ahí para que nadie lo "arregle" creyéndolo un descuido.
- **No frena la venta**: emite una advertencia, igual que un ingrediente no
  bloqueante sin stock. Viaja en `advertencias`/`advertenciasVenta`, tanto del
  cálculo como de la respuesta de la venta. La previsualización del carrito
  (POS, Salones, Tienda) ya la muestra **antes** de cobrar — ver "Frontend"
  más abajo. Los caminos de tienda online y suscripciones siguen
  descartándola al crear el pedido/la suscripción (ver
  `docs/agent/pendientes.md`).

- **Ninguna regla aporta una magnitud negativa.** El signo lo pone el tipo de
  regla, nunca el valor calculado. Hace falta porque el acumulado que sirve de
  base en modo `compuesto` **sí** puede quedar negativo a nivel venta (arranca en
  el neto agregado mientras la plata disponible es `Σ totalLinea`), y un `%`
  sobre esa base producía un "recargo" que restaba y un "descuento" que le
  cobraba al cliente, ambos impresos así en la traza. Un fuzz de 40.000 ventas
  con configuración válida encontró el caso en el 0,78%.

Los recargos **no tienen tope superior** —subir el total no tiene el problema
que el piso resuelve— pero sí el piso en cero de arriba: un recargo nunca resta.

### La venta congela la regla que aplicó (2026-08-02)

**El problema:** las tablas `ventas_descuentos` / `ventas_recargos` /
`ventas_impuestos` guardaban el monto y un puntero al catálogo vivo. Editar un
descuento de 10% a 20% —o borrarlo— reescribía el pasado: la venta ya no podía
decir cuánto valía la regla cuando se cobró.

**La regla ahora:** la fila se basta sola. No se consulta el catálogo para leer
una venta vieja. Es la misma idea de [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md)
—congelar el hecho fiscal en la transacción— extendida a las tres familias, y el
mismo idioma que `venta_detalles`, que ya congela `descripcion` y
`clasificacion_tributaria` del ítem.

Qué congela cada familia. **Las asimetrías son intencionales:**

| Columna | `ventas_descuentos` | `ventas_recargos` | `ventas_impuestos` | Por qué |
|---|:--:|:--:|:--:|---|
| `nombre_regla` | ✅ | ✅ | ✅ | El catálogo puede renombrarla o borrarla |
| `modo` | ✅ | ✅ | — | Un impuesto es siempre porcentaje |
| `porcentaje_aplicado` | ✅ | ✅ | ✅ | Ya existía; solo impuestos la poblaba |
| `valor_solicitado` | ✅ | — | — | Solo a los descuentos los topea el piso |
| `detalle_id` | ✅ | ✅ | ✅ | Nullable: las de nivel venta no son de ninguna línea |

Tres decisiones que no se deducen de la tabla:

- **`porcentaje_aplicado` va `null` explícito en las reglas de monto fijo.** Un
  `0` se leería después como "valía 0%", que es una regla distinta. El otro
  `null` posible —una regla de porcentaje que no llegó a aplicar (diferida,
  método de pago que no coincide, sin tramo)— lo desambigua `modo`.
- **`valor_solicitado` separa lo que la regla pedía de lo que el piso dejó
  aplicar.** `valor_aplicado` sigue siendo lo que entró en el total, para que el
  comprobante cuadre. Sin la columna, un cupón de $5.000 topeado a $2.000 es
  indistinguible de uno que valía $2.000.
- **`detalle_id` se cruza por índice** contra `resultado.lineas`, **nunca por
  `itemId`**: el mismo ítem puede aparecer en dos líneas con personalizaciones
  distintas, y buscar por ítem atribuiría las dos reglas a la misma.

**`ventas.config_calculo` (`jsonb`)** guarda la config con la que se calculó
(`formula`, `calculoDescuentos`, `calculoRecargos`, `escalaCalculo`,
`modoRedondeo`, y desde 2026-08-21 `nivelRedondeo` y `decimalesMoneda`). Sin ella el
congelado no es interpretable: el mismo 10% da un total distinto según el orden de la
fórmula, según base|cascada y según con qué escala cerró, las tres cosas editables desde
Preferencias.

⚠️ **`decimalesMoneda` es dato derivado congelado, no configuración.** Sale de la moneda
oficial del tenant —la moneda en que la venta se persiste— y va al snapshot por la misma
razón que `tasa_cambio` se congela por línea: si mañana se corrige la moneda del tenant, la
venta vieja tiene que seguir explicando por qué cerró donde cerró. **Quien lee una venta
vieja lee este snapshot, nunca las preferencias vigentes** — es lo que hace que una nota de
crédito pueda heredar el criterio del documento que corrige (ver
[reembolsos-nota-credito.md](./reembolsos-nota-credito.md)). Va en `jsonb` y no en columnas por una razón de
forma —`formula` es un array y el objeto se lee entero—, no por contradecir la
decisión de columnas del resto.

`nombre_regla`, `modo` y `valor_solicitado` son **`NOT NULL`**:
`crearEnTransaccion` es el único camino de escritura de estas tablas, así que el
congelado es invariante de esquema y no convención. Un segundo camino que se
olvide de poblarlas falla al insertar.

**Dónde se ve** (2026-08-02): `VentaDetalleDrawer.vue` → tarjeta **"Líneas de
venta"**. Las reglas **no tienen tarjeta propia**: cuelgan de su ítem, en la
misma tabla, y cada línea se lee como la derivación que es —neto, los pasos con
su signo, total de línea:

El desglose viene **plegado**: una venta de 10 líneas no puede abrirse en 40
filas para responder "¿qué se vendió?". Se expande por línea, y solo las que
tienen reglas ofrecen el toggle.

```
Concepto                    Cantidad    Valor      Monto
› Producto demo               1.0000   $5.000     $5.653     ← plegado
                                                    total

⌄ Producto demo               1.0000   $5.000     $5.653     ← expandido
    Neto                                          $5.000
    Descuento  Socio 10%               10,00%      -$500
    Recargo    Delivery 5%              5,00%      +$250
    Impuesto   IVA                     19,00%      +$903
```

⛔ **El monto de la fila del ítem va rotulado `total` en la propia celda. Es lo
que hace honesta la tabla, y costó tres intentos.** Sin rótulo, esa plata al
lado de `Cantidad` y `Valor` invita a leer una multiplicación que **no cierra**:

- Con el **neto** ahí falla cuando `precio_incluye_impuesto`: el motor desbrutea,
  así que el neto es `precio / (1 + tasas) × cantidad`. Un ítem de $5.950 con IVA
  incluido tiene neto $5.000, y `1 × 5.950` no da `5.000`. *(Ningún ítem
  **vendible** del seeder tiene la marca —solo ingredientes, que no se venden—;
  se reprodujo creando uno por API.)*
- Con el **total** ahí falla en el caso **normal**: el IVA se suma sobre el
  precio, así que una línea de `1 × $1.500` termina en `$1.785`. Esto alcanza a
  todos los ítems del seed, no a un borde.
- Y en cualquiera de los dos, una **venta por presentación** muestra en Cantidad
  la presentación ("2 cajas") mientras el motor multiplicó por la cantidad
  **canónica** (24 unidades).

El rótulo va **en la celda y no en la cabecera** porque esa columna sirve a dos
cosas: totales de línea y montos de regla. La versión que quitó los rótulos
viejos (`Precio unit.` / `Total línea`) para poner cabeceras genéricas fue
justamente la que se rechazó. **No sacar el rótulo `total`.**

El bloque expandido empieza en `Neto` —el punto de partida del que salen las
reglas— y no repite el total al cerrar: ya está arriba, en la fila del ítem.
Una línea sin reglas no ofrece toggle: no hay nada que derivar.

La otra versión descartada, por si alguien la reintenta: listar **por familia**
(todos los descuentos, después todos los recargos) describe la venta pero no el
cálculo, y deja al lector reconstruyendo a qué ítem pertenecía cada fila.

El signo lo pone la familia, no el monto: el motor nunca guarda magnitudes
negativas, así que sin él un descuento y un recargo del mismo valor se ven
idénticos salvo por el color del badge.

El orden sale de `configCalculo.formula` de **esa** venta, no de un orden fijo
del frontend: dos ventas del mismo tenant pueden tener órdenes distintos si
alguien editó Preferencias entre una y otra. Para ventas sin `config_calculo`
—las anteriores al congelado— cae al orden por defecto.

La cabecera muestra el orden **y sobre qué base calculó cada familia**:
`orden: Descuento (base) → Recargo (cascada) → Impuesto`. Mismo vocabulario que
Preferencias financieras, que es donde se configura. No es decoración: con un
neto de $5.000 y un descuento del 10%, un recargo del **mismo** 5% da $250 en
`base` (5% del neto) y **$225** en `cascada` (5% de los $4.500 ya descontados).
El porcentaje congelado es idéntico en los dos casos, así que sin el modo el
monto no se puede reconstruir. Los impuestos no llevan modo —van siempre sobre
el acumulado del paso— y una venta sin config no muestra ninguno, en vez de
inventar el default.

Las reglas de nivel venta van en un bloque final, "Toda la venta", porque no
pertenecen a ninguna línea. Cada fila dice con qué valor aplicó la regla
(`10,00%` o `Monto fijo`) y cuánta plata. Dos casos con nombre propio: un
descuento topeado muestra **`pedía $5.000`** bajo el monto, y una regla que se
evaluó sin aportar nada dice **`No aplicó`** en vez de un guion —que hacía
dudar de si el dato se había perdido— con la fila atenuada.

⚠️ `config_calculo` se escribió durante meses sin que **nadie lo leyera**: el
`SELECT` de `findOne` no lo traía. Lo destapó necesitar el orden para esta
pantalla. El e2e de "congela la config del cálculo" ahora verifica las dos
mitades —que se persista y que viaje por la API—, no solo la primera.

---

## Frontend

- **Composable**: `app/composables/useCalculoPrecios.ts` — `calcular(input)` con
  `useApiFetch` a `POST /calculo-precios/calcular`. El tipo `AdvertenciaPrecio`
  (`{ titulo, detalle }`) espeja al del motor; el tipo `ResultadoLinea` incluye
  `advertencias: AdvertenciaPrecio[]` y el tipo `ResultadoVenta` incluye
  `advertencias` + `advertenciasVenta`, ambos `AdvertenciaPrecio[]`.
- **Previsualización del carrito** (POS `components/ventas/CarritoPanel.vue`,
  Salones `pages/salones/index.vue`, Tienda `components/tienda/CarritoOnline.vue`)
  — los tres renderizan el componente compartido `components/AdvertenciasPrecio.vue`:
  por línea con `resultado.lineas[index].advertencias`, junto al total con
  `resultado.advertenciasVenta`. Por cada advertencia el componente muestra el
  ícono de warning + el `titulo` en una sola línea, con un ícono informativo cuyo
  tooltip (alcanzable con teclado, no solo con hover) revela el `detalle`. **El
  cruce línea↔resultado es por índice, nunca por `itemId`**: el mismo ítem puede
  aparecer en dos líneas del carrito con personalizaciones distintas (por
  ejemplo, dos porciones de la misma receta con extras diferentes), y el
  `itemId` no las distingue.
  El índice solo sirve mientras el resultado corresponda al carrito que se está
  viendo: los tres carritos guardan ese estado en `useResultadoCalculado()` y
  **solo dibujan advertencias cuando el cálculo está vigente**. Quien lee los
  totales para mover plata (abrir el cobro, imprimir) llama antes
  `asegurarVigente()`. Detalle: `docs/patterns/frontend.md` §10.1.
- **Confirmación de la Tienda** (`pages/tienda/pasarela.vue`) — último paso antes de
  "Aprobar pago". Usa `resultado.advertencias`, el **aplanado**, no las dos
  granularidades: esa pantalla no desglosa líneas, así que renderizar
  `lineas[].advertencias` y `advertenciasVenta` por separado duplicaría las de venta.
- **Las suscripciones no previsualizan nada** (decisión del owner, 2026-08-02). El alta
  (`pages/tienda/suscripciones.vue`, dos call sites: `confirmar()` en 229 y
  `reanudarAltaPendiente()` en 260) llama a `crear()`, que cobra por Oneclick en el mismo
  request, y las renovaciones son automáticas: no hay a quién avisarle.
  ⚠️ **La decisión es del owner; la razón NO es que el caso sea imposible.**
  `suscripciones.service.ts:88-91` corre **el mismo motor** y descarta `resultado.advertencias`,
  y `cargarReglasPorIds` (`items.service.ts`) hace `JOIN items` solo para acotar por tenant,
  id y no-borrado — **sin filtro por `tipo`**. O sea que nada impide hoy colgarle un descuento de monto
  fijo a un ítem de suscripción, y ahí el piso en cero sí emitiría advertencia sobre un
  cobro Oneclick irreversible. Lo que sostiene la decisión es un hecho de configuración
  ("hoy ningún ítem de suscripción tiene descuentos"), no una propiedad del código: si eso
  cambia, hay que rediscutirlo.
- ⚠️ **`advertenciasVenta` hoy no se puede ver por la UI.** El render junto al
  total está construido y correcto, pero está inerte: depende de que el request
  mande `descuentosVentaIds`/`recargosVentaIds`, y ningún archivo de
  `frontend/app` los arma ni los ofrece al usuario — los descuentos/recargos a
  nivel venta son superficie de API sin pantalla. No es un defecto, es una
  limitación conocida hasta que exista esa UI (ver `docs/agent/pendientes.md`).

---

## Testing

### Unit Tests (Backend)

```bash
cd backend && npm test            # incluye los specs del motor y del servicio
```

- `calculo-precios.engine.spec.ts` — neto/desbruteo, base vs compuesto, orden de
  fórmula, tramos, método de pago, reglas diferidas, redondeo, nivel venta, y el
  congelado en la traza (`modo`, `valorEfectivo` incluido el de una regla por
  tramos, `valorSolicitado` de un descuento topeado).
- `calculo-precios.service.spec.ts` — resolución de reglas asociadas vs override,
  errores (regla inexistente, cantidad ≤ 0).

### E2E (Backend)

```bash
./scripts/reset-db.sh && cd backend && npx jest --config test/jest-e2e.json test/calculo-precios.e2e-spec.ts
```

- `calculo-precios.e2e-spec.ts` — descuento `monto_fijo` que supera el monto
  disponible ("Promo fija $5.000", seed): confirma que la advertencia de tope
  aparece en `lineas[].advertencias` cuando el descuento va por línea y en
  `advertenciasVenta` cuando va a nivel venta, sin mezclarse entre sí.
- `ventas.e2e-spec.ts` → "la venta congela la regla aplicada" — el que prueba el
  objetivo: crea una venta con un descuento del 10%, **edita la regla a 20%** (y
  verifica contra el catálogo que el cambio ocurrió) y confirma que la venta
  sigue diciendo 10%. Su gemelo con la regla **borrada**, la misma regla en dos
  líneas atribuida a `detalle_id` distintos, el descuento topeado
  (`valor_solicitado` ≠ `valor_aplicado`) y `config_calculo` en la cabecera.

### Manual (Swagger)

1. `docker-compose up` → http://localhost:3000/api/docs
2. Autenticar con Bearer token.
3. `POST /calculo-precios/calcular` con un ítem del seed → verificar desglose.

---

## Related Features

- [features/preferencias-financieras.md](./preferencias-financieras.md) — fórmula, base/compuesto, redondeo
- [features/descuentos-recargos.md](./descuentos-recargos.md) — reglas, tramos, método de pago
- Catálogo de ítems e impuestos (insumos del motor)

---

## Notes

### El prorrateo de las reglas de nivel venta (2026-08-21)

`calcularVenta` corre **dos pasadas** sobre las líneas. La primera las calcula sin ajuste y da
los pesos del reparto y la plata cobrada sobre la que se miden las reglas de documento; la
segunda las recalcula con su parte prorrateada, para que la base imponible de cada línea
refleje el descuento global. Es aritmética pura —ni una consulta— así que el costo es nulo.

**El residuo no es un refinamiento.** Repartir 100 entre netos de 333/333/334 cuantizando cada
parte da `33 + 33 + 33 = 99` (medido). La unidad que sobra va a la línea con el **resto
fraccionario más grande**, desempatando por posición. El desempate por posición vale acá y no
valdría en `elegirAbsorbente`: la posición de una línea es el orden del documento, mientras que
allá el orden venía de una consulta y podía cambiar entre dos lecturas de la misma venta.

**El ancla del cierre se mueve, no se apaga.** Una línea con precio de góndola y un descuento
global cierra contra "etiqueta menos su parte", y el impuesto sale por resta contra ese ancla.
Aplicar `tasa × base` en su lugar rompe que `base + impuesto` sea el total en el **15,6%** de
los casos (barrido de 11.604): `87 + 17 = 104` sobre un total de 103. Compone con la regla de
la etiqueta: si las reglas de línea se anulan, el ancla parte de la góndola y recién ahí se
corre por el descuento de venta.

**Las reglas de documento se evalúan en plata cobrada y se declaran en neto.** `MntNeto` resta
descuentos netos, así que las trazas y los totales se convierten con el factor agregado que las
líneas ya resolvieron. `valorSolicitado` se convierte con el mismo factor: su docblock promete
que es igual a `monto` salvo en un descuento topeado, y dejarlo en plata cobrada rompería justo
esa comparación.



Primera pieza de la cadena de ventas. El módulo de ventas (por construir)
consumirá este motor para calcular y luego persistir `ventas` / `venta_detalles`
/ `ventas_descuentos`, y para convertir a moneda oficial.
