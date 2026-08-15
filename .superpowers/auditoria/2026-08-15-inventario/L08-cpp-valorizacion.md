## Lente: Costeo CPP y valorización
## Veredicto: 2 hallazgos

### Qué revisé para poder afirmarlo

- `InventarioService.registrarMovimiento` y `calcularCostoPromedio` completos
  (`backend/src/modules/inventario/inventario.service.ts`, 871 líneas): los 9 branches de
  `costoActualNuevo` (compra / ajuste_costo / resto), los 3 modos (`cantidad`/`serie`/`lote`)
  y los bordes (stock 0, costo previo null, costo 0, cantidad 0, división).
- Los **8 call sites** de `registrarMovimiento` fuera del propio módulo:
  `mermas.service.ts:162`, `recuentos.service.ts:622`, y los 6 de `items.service.ts` /
  `ventas.service.ts` (creación con stock inicial ×3, `ajustarStock`, reconversión de
  unidad, venta/anulación/devolución ×4) — para cada uno, qué `costoUnitario` pasa y si
  dispara `calcularCostoPromedio`.
- `mermas.service.ts` completo (298 líneas): valorización, congelamiento, conversión de
  unidad+costo junto.
- `recuentos.service.ts` (aplicar, 693 líneas): confirmé que el motivo `'recuento'` nunca
  toca `costo_actual` y que no hay lectura de costo en todo el archivo (`grep costo` → 0
  resultados).
- `items.service.ts`: `validarYCostearIngredientes`, `costoPropuesto`, `construirFilasDesfase`,
  `aplicarDesfases`, `descartarDesfases`, `margenPct`, `precioSugerido` (simulador de
  impacto de costos) — comparé fórmula contra `simulador-impacto-costos.md` línea por línea.
  También `validarYCostearComponentes` (combos) y el flujo completo de `PATCH /items/:id`
  para combos (recompone costo solo si el body trae `componentes`).
- `catalog.service.ts` (`convertirUnidad`, `crearConversor`) y
  `common/utils/costo-conversion-unidad.util.ts` — la conversión de cantidad y costo juntos,
  contra su espejo en `frontend/app/composables/useUnidadConversion.ts`.
- Cruce contra `docs/features/inventario-kardex.md`, `mermas-valorizadas.md` y
  `simulador-impacto-costos.md`: cada regla de costo documentada la verifiqué en el código
  citado (no encontré divergencias además de las dos de abajo).
- Tests: `costeo-cpp.e2e-spec.ts` (14 casos), `mermas.service.spec.ts`,
  `inventario.service.spec.ts` (sin ocurrencias de `anulacion`/`devolucion`),
  `ventas.service.spec.ts` (mockea `inventarioService.registrarMovimiento` por completo en
  el bloque de anulación — solo verifica que se llamó, no el efecto en costo).

### H1. La anulación y la devolución reingresan stock al costo promedio ACTUAL, no al costo con el que la unidad salió — inflan o desinflan el CPP en cada compra futura

- **Severidad:** alta
- **Ubicación:**
  - `backend/src/modules/inventario/inventario.service.ts:156-169` — `costoActualNuevo` solo
    se calcula cuando `tipo==='entrada' && motivo==='compra'`; para `anulacion` y
    `devolucion` queda `null`, así que `item_producto.costo_actual` no se toca.
  - `backend/src/modules/ventas/ventas.service.ts:862-871` (anulación de venta,
    `POST /ventas/:id/anular`), `:1006-1011` (devolución vía nota de crédito) y
    `:1153-1158` (devolución por reembolso directo) — ninguno de los 3 pasa
    `costoUnitario` a `registrarMovimiento`.
- **Qué está mal:** cuando una unidad SALE (`tipo='salida', motivo='venta'`),
  `registrarMovimiento` congela el CPP vigente en `movimientos_inventario.costo_unitario`
  de ESA venta (línea 172-173: `costoUnitarioCongelado = costoActualPrevio`) — ese dato
  queda en el kardex, ligado a `venta_id`. Cuando esa misma venta se anula o se devuelve, el
  movimiento de reingreso (`entrada`/`anulacion` o `entrada`/`devolucion`) **nunca lee ese
  costo congelado**: simplemente aumenta `stock` y dejar `costo_actual` intacto (código
  arriba). El resultado es que la unidad reingresa valorizada al CPP **del momento de la
  reversión**, no al costo con el que salió — y si hubo compras a otro precio entre la venta
  y la anulación/devolución, el valor implícito del inventario (`stock × costo_actual`)
  cambia sin que ninguna compra ni venta lo explique.
- **Escenario:**
  1. Producto P: `stock=9`, `costo_actual=$50.0000` (tras vender 1 de 10 unidades a `$50`,
     kardex de esa venta con `costo_unitario=$50` congelado, `venta_id=V1`).
  2. Compra de 5 unidades a `$70`: `calcularCostoPromedio(9, 50, 5, 70)` =
     `(9×50 + 5×70)/(9+5) = 800/14 = $57.1429`. `stock=14`, `costo_actual=$57.1429`.
     Valor implícito = `14 × 57.1429 = $800.00` (correcto: `450 + 350`).
  3. Se anula V1 (`POST /ventas/V1/anular`): `registrarMovimiento` con
     `tipo='entrada', motivo='anulacion'`, sin `costoUnitario` → `costo_actual` sigue en
     `$57.1429`, `stock=15`. Valor implícito = `15 × 57.1429 = $857.14`.
  4. El valor correcto tras revertir esa venta es `$800.00 + $50.00` (lo que esa unidad
     costaba cuando salió) `= $850.00`, es decir CPP `$56.6667`. El sistema muestra
     `$857.14` — **$7.14 de valorización manufacturada de la nada**, y el `costo_actual`
     de las 15 unidades queda `$0.4762` por encima del que le correspondería. Cada compra
     futura promedia sobre este número ya inflado, así que el error no se autocorrige:
     se arrastra indefinidamente.
- **Por qué ningún test lo caza:** `ventas.service.spec.ts` mockea
  `inventarioService.registrarMovimiento` completo en el bloque de "anula, repone el stock y
  deja el rastro..." (línea ~2059) y solo verifica que se llamó con
  `motivo: 'anulacion'` — nunca ejercita el cálculo de costo real.
  `inventario.service.spec.ts` no tiene ningún caso con `motivo: 'anulacion'` ni
  `'devolucion'` (grep → 0 resultados). `costeo-cpp.e2e-spec.ts` cubre compra, compra con
  conversión de unidad y ajuste de costo, pero ningún escenario de venta → compra a otro
  precio → anulación/devolución → verificar `costo_actual` resultante.
- **Nota sobre el propio razonamiento documentado:** `inventario-kardex.md:263` dice
  *"Salidas y devoluciones nunca recalculan el promedio: la unidad que sale (o vuelve) ya
  tiene un costo congelado; re-promediarla mezclaría costo de venta con costo de compra."*
  Esa frase es cierta para la salida (vender no debe tocar el CPP) pero no resuelve el caso
  de la reversión: el argumento asume que el costo congelado de la unidad devuelta sigue
  siendo el CPP vigente, lo cual solo es cierto si no hubo compras en el medio. El propio
  kardex ya tiene el costo con el que esa unidad salió (`movimientos_inventario.costo_unitario`
  de la venta original, indexado por `venta_id`) — no se usa. Creo que **el código es el que
  está mal** frente a la intención real de un CPP (preservar continuidad de valor), y que la
  frase de la doc es una justificación incompleta que no cubre este caso, no una decisión de
  producto deliberada sobre este escenario específico.
- **Confianza:** alta — verificado con números concretos contra el código real de
  `calcularCostoPromedio` y los 3 call sites de ventas; no requiere correr nada para
  confirmarlo, la aritmética es determinista.

### H2. El costo de un combo se cachea en `item_combo.costo_actual` pero, a diferencia de las recetas, no tiene ningún mecanismo de recálculo ni de aviso — queda stale para siempre salvo que alguien reenvíe la lista completa de componentes sin cambios

- **Severidad:** media
- **Ubicación:**
  - `backend/src/modules/items/items.service.ts:1610-1646` — `costo_actual` del combo solo
    se recalcula dentro de `PATCH /items/:id` cuando el body trae `componentes !== undefined`
    (reenvío explícito de la lista completa); no hay ningún trigger automático cuando cambia
    el costo de un componente.
  - `backend/src/modules/items/items.service.ts:177` — `COALESCE(ip.costo_actual,
    ir.costo_actual, icb.costo_actual)`: el `costo_actual` del combo se expone igual que el
    de producto/ingrediente/receta en cada listado/detalle de items (usado para margen).
  - Contraste: el simulador de impacto de costos (`recetas-desfases.controller.ts`,
    `ItemsService.listarDesfases/aplicarDesfases/descartarDesfases`) cubre **solo**
    `item_receta` — no hay ningún query ni endpoint equivalente para `item_combo`.
- **Qué está mal:** un combo cachea su costo igual que una receta (`validarYCostearComponentes`,
  suma de `costo_actual × cantidad` de cada componente), pero solo la receta tiene el
  mecanismo (`recetas-desfases`) que detecta cuándo ese cacheado quedó viejo y fuerza una
  decisión explícita. Para combos no existe: si sube el costo de un producto o receta que es
  componente de un combo, `item_combo.costo_actual` se queda exactamente en el valor viejo
  para siempre, y ese valor viejo sigue mostrándose como "costo" del combo en cualquier
  listado (línea 177) — el margen que ve el negocio para ese combo queda mal indefinidamente,
  sin ninguna señal.
- **Escenario:**
  1. Combo "Menú almuerzo" = 1 Hamburguesa (receta, `costo_actual=$1200`) + 1 Bebida
     (producto, `costo_actual=$500`). Al crearlo, `item_combo.costo_actual = $1700`
     (`validarYCostearComponentes`).
  2. Sube el costo de la Bebida a `$700` (compra con `costoUnitario` mayor, vía
     `PATCH /items/:id/stock`) → CPP de la Bebida recalcula, `costo_actual=$700`.
  3. `item_combo.costo_actual` del "Menú almuerzo" sigue en `$1700` — el costo real ahora es
     `$1900`. `GET /items` sigue devolviendo `costoActual: "1700.0000"` para el combo.
     El margen mostrado en Items/reportes para ese combo está subestimado en `$200` de costo
     (sobreestimado en margen) hasta que alguien edite el combo reenviando su lista completa
     de componentes — nada en la UI ni en el backend indica que eso hace falta.
- **Por qué ningún test lo caza:** `items.service.spec.ts` solo prueba el recálculo de costo
  del combo cuando el PATCH explícitamente reenvía `componentes` (líneas ~2101, ~4926); no
  hay ningún caso que suba el costo de un componente y luego verifique (o falle en verificar)
  que el combo se actualiza o se marca como desfasado. No existe un
  `combos-desfases.e2e-spec.ts` ni equivalente.
- **Divergencia doc/código:** `docs/features/simulador-impacto-costos.md` (Overview y Scope)
  describe la motivación en términos generales ("food-service necesita decidir explícitamente
  si actualizar costo... cuando sube el insumo") pero solo menciona "recetas" en cada regla
  concreta, y la lista "NOT included (future)" no incluye a los combos como exclusión
  explícita — el lector razonable asume que la cobertura es de "ítems compuestos" en general.
  Creo que **la doc es la que está incompleta**: el código sí tiene un límite de scope real
  y consistente (solo `item_receta`), pero ese límite no está declarado donde correspondería
  (la lista de exclusiones), así que hoy es un hueco silencioso y no una decisión visible.
- **Confianza:** media — el efecto en el número de margen mostrado es directo y verificado
  en el código; me falta confirmar si hay algún reporte de rentabilidad fuera del scope de
  esta pasada (`items` únicamente) que además consuma `item_combo.costo_actual` y amplifique
  el impacto — no lo revisé por estar fuera de los módulos asignados.
