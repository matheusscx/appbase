# La cortesía como retiro gravado con IVA

**Fecha:** 2026-10-03 · **Tipo:** spec de diseño · **Frente fiscal** (va solo: `CLAUDE.md`, ADR-010)
**Entrada:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) § 6, *"La cortesía como retiro
gravado con IVA"*. **Investigación:**
[`2026-10-03-cortesia-retiro-iva.md`](../../agent/investigaciones/2026-10-03-cortesia-retiro-iva.md)
(Sesión de esfuerzo máximo; insumo, no verdad).

---

## 1. El problema

Anular un plato despachado con un motivo de tipo `cortesia` (`/salones/anulaciones`) descuenta el
stock y deja una fila en `cuenta_linea_anulaciones` con el precio de carta y la cantidad congelados.
La línea sale de la cuenta: la venta que se cierra después no la incluye. **No queda ningún hecho
tributario**, y para el SII una entrega gratuita con fin promocional es venta gravada (DL 825, art. 8
d), inc. 3), con base en el valor que el contribuyente le asigna al bien (art. 16 b)) y devengo al
retirar (art. 9 c)). Hay dos datos que hoy no se guardan y no se pueden reconstruir después: el
tratamiento tributario del ítem en ese momento y el IVA que correspondía.

## 2. Decisiones del owner (2026-10-03, AskUserQuestion, con el análisis de la investigación)

| # | Decisión | Descartadas |
|---|---|---|
| D1 | **Guardar el IVA ya**: al anular como cortesía se congela el neto y el IVA; el reporte muestra el IVA del período; la boleta la emite el frente de emisión electrónica leyendo esos datos | Boleta armada por cortesía; esperar la emisión |
| D2 | **Siempre paga IVA**: toda cortesía a un cliente se trata como promoción | Lo elige quien autoriza; ninguna paga; lo veo con mi contador |
| D3 | **La base es el precio de carta**, sin descuentos ni promociones, neto de todo impuesto incluido. Escena: cerveza de carta $3.000 con happy hour al 50% → base $2.521, IVA $479 | Precio con los descuentos del día |
| D4 | **La comida del personal se anota aparte** (no es retiro, Oficio 734/2002): no va como cortesía y su motivo propio es otra entrada de `pendientes.md` § 6 | — |

Costo aceptado de D1: hasta que exista la emisión, el contador declara con el número del reporte y el
riesgo de no emitir el documento sigue (art. 97 N° 10 del Código Tributario). Costo de D2: se paga IVA
también por las compensaciones.

## 3. Diseño

### 3.1 Qué se congela

Tres columnas nuevas en `cuenta_linea_anulaciones`, con los mismos nombres y la misma escala que los
baldes de `venta_documentos` (ADR-028), para que el emisor del SII lea un solo vocabulario:
`monto_afecto`, `monto_exento`, `monto_impuestos` (`numeric(18,4)`, nullable).

- **Solo una cortesía de un bien las llena** (`producto`, `receta`, `combo`: `esBienRetirable`). El
  art. 8 d) grava el retiro de bienes corporales muebles; un servicio regalado no lo es. `merma` y
  `no_elaborado` tampoco son retiro: quedan en `NULL`. Las tres
  van juntas —un `CHECK` exige que sean todas nulas o todas no nulas—, así que una cortesía con base
  y sin impuesto no se puede escribir.
- **Exento es explícito** (invariante 5): una cortesía de un ítem exento guarda la base en
  `monto_exento`, `monto_afecto = 0` y `monto_impuestos = 0`. Nunca `NULL`.
- **`monto_impuestos` es solo el IVA.** Los impuestos adicionales (tipo `'otro'`) se sacan del precio
  para llegar a la base (art. 15), pero no se congelan: el art. 43, último inciso, excluye del
  adicional la venta del comerciante minorista al consumidor. Hoy no hay adicionales chilenos
  sembrados; el caso es de un tenant que los cree por API. Por eso, con adicionales,
  `afecto + exento + impuestos` **no** suma el precio de carta: suma el precio menos los adicionales.

### 3.2 Cómo se calcula (sin tocar el motor de precios)

No se llama a `CalculoPreciosService.calcular()`. Medido: aplica las promociones vigentes (contra D3)
y `cargarBasePorIds` filtra `eliminado_el`, así que la cortesía de un ítem borrado del catálogo daría
404, y esa anulación está permitida a propósito (es la única salida de esa mesa). La orquestadora
pidió además no tocar `calcular()` (es el motor; `CLAUDE.md`).

Una función pura, `baldesDeCortesia`, con lo que la anulación ya tiene o lee en la misma consulta del
ítem:

- `carta = cantidad × precio_unitario` (el `precioCarta` que el reporte ya muestra, en moneda
  oficial, con los extras de la personalización y sin reglas);
- `q` = cuantizar a la escala de la moneda oficial con el `modo_redondeo` del tenant (`cuantizar` del
  motor, el mismo de cada paso);
- `tasaIva` = el IVA del país si el ítem es `afecto`, 0 si es `exento`; `adicionales` = las tasas de
  los impuestos tipo `'otro'` del ítem, activos y no borrados (un impuesto pausado no se cobra y no
  infla el divisor: mismo criterio que el motor).

Si el precio **incluye** impuesto: `base = q(carta ÷ (1 + tasaIva + Σ adicionales))`, cada adicional
`q(base × tasa)`, e `IVA = q(carta) − base − Σ adicionales` (el IVA absorbe el residuo, como en la
línea de góndola del motor). Si **no** incluye: `base = q(carta)` e `IVA = q(base × tasaIva)`, sin ida
y vuelta. Puede diferir en un peso de lo que cobraría el motor con varios impuestos; no es un problema
normativo, porque un regalo no tiene una venta con la que cuadrar (investigación, segunda pasada).

**Los impuestos son los vigentes al anular**, que es cuando se devenga el retiro. La línea congela su
precio al pedir, pero no su tratamiento tributario (`cuenta_lineas.reglas_congeladas` lleva solo
descuentos y recargos, ADR-010): si el ítem cambió de clasificación entre el pedido y la anulación, se
descompone con la nueva. Se acepta y se anota.

Un ítem sin clasificación o un ítem afecto en un país sin IVA rechazan **la cortesía** con 400, igual
que la venta (`ventas.service.ts`, `calculo-precios.service.ts`); `merma` y `no_elaborado` siguen.

### 3.3 Dónde se escribe

`escribirAnulacionEnLinea` recibe los baldes ya calculados. Los dos llamadores los resuelven **antes**
del bucle y en lote: `anularLinea` para su línea, `cancelarConMotivo` para todas las despachadas, con
**una** consulta que lee clasificación, `precio_incluye_impuesto` y Σ adicionales por ítem
(`WHERE item_id = ANY($1)`) más el IVA del país y la config de redondeo. La lectura del ítem no filtra
`eliminado_el`, deliberadamente y con el porqué escrito en la consulta (invariante 3).

### 3.4 El reporte

- `GET /salones/anulaciones`: cada fila trae `fiscal: { montoAfecto, montoExento, montoImpuestos } |
  null` (no nulo solo en una cortesía). La pantalla suma la columna **IVA** (`—` en las demás).
- `GET /salones/anulaciones/resumen`: cada grupo de `porTipo` trae `fiscal`, con la suma de las filas
  del grupo; `null` en `merma` y `no_elaborado`. La tarjeta *Cortesías* muestra *"IVA: $X"*. No toca
  `porGarzon` ni lo vendido (frente paralelo del % de anulaciones).

## 4. Fuera de alcance

- **El documento.** No se arma boleta ni fila en `venta_documentos` (D1): la emisión electrónica lee
  los baldes congelados. La boleta electrónica no tiene indicador de entrega gratuita y exige monto
  mayor que 0: un retiro se documenta por su base, nunca por $0 (investigación § 4).
- **El kardex sigue llamando `merma` al movimiento de una cortesía** (`motivo: 'merma'` con
  `motivo_baja_id` de tipo `cortesia`). Se distingue por el motivo de baja; cambiar el `motivo` del
  movimiento es escribir en `movimientos_inventario` y no lo pidió el owner.
- **La comida del personal** (D4): entrada propia.
- **Otros países:** en pausa (owner, 2026-10-03). El cálculo usa el IVA del país del tenant y no
  tiene rama por país; la regla decidida es la chilena.

## 5. Cómo se prueba

- **Unitario** de `baldesDeCortesia`: afecto con precio bruto (la escena de D3: 3.000 → 2.521 + 479),
  afecto neto, exento, afecto con adicional (el adicional no se congela y la base sale de Σ tasas),
  impuesto pausado fuera del divisor, cantidad fraccionaria.
- **E2E** (`salones-anular-linea`, `salones-anulaciones-reporte`): una cortesía congela los tres
  baldes; una merma y un "no se hizo" los dejan en `NULL`; la cancelación con motivo cortesía los
  congela en cada línea; el reporte trae `fiscal` en la fila y en `porTipo`; la cortesía de un ítem
  borrado del catálogo sigue pasando.
- **Frontend**: el spec de la página muestra la columna IVA y la línea de la tarjeta.
