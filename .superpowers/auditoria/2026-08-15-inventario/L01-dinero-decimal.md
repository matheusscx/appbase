## Lente: Dinero y Decimal
## Veredicto: LIMPIA

### Qué revisé para poder afirmarlo

- **Backend, línea por línea completas:** `inventario/inventario.service.ts` (871
  líneas — kardex, CPP, ajuste de costo, moverCantidad/moverSerie/moverLote,
  recalcularStockSerie/Lote, findMovimientos), `mermas/mermas.service.ts` (298),
  `recuentos/recuentos.service.ts` (693), `motivos-diferencia-inventario/*.service.ts`
  (393), `catalog/catalog.service.ts` (167, `convertirUnidad`/`convertirUnidades`/
  `crearConversor`/`convertirConMapa`), `common/utils/costo-conversion-unidad.util.ts`.
- **Costura de `items.service.ts`/`ventas.service.ts`** por donde tocan costo/stock:
  `ajustarStock`, la reconversión de costo al cambiar unidad (`~L1465-1502`),
  `venderIngredientesReceta`/`venderComponentesCombo`, `validarYCostearIngredientes`,
  y el simulador de impacto (`margenPct`, `precioSugerido`, `costoPropuesto`,
  `~L3520-3650`) contra la fórmula documentada en
  `docs/features/simulador-impacto-costos.md`. Las llamadas a `registrarMovimiento`
  desde `ventas.service.ts` (5 sitios) — ninguna pasa `costoUnitario` en la venta en
  sí, solo cantidad.
- **DTOs y validación de signo:** `ajuste-costo.dto.ts`, `create-merma.dto.ts`,
  `ajuste-stock.dto.ts`, `update-recuento-linea.dto.ts`, `create-recuento.dto.ts`,
  el decorador `IsDecimalPositivo`/`IsDecimalNoNegativo`.
- **Escalas de columnas:** confirmé `NUMERIC(18,4)` en `movimiento_inventario`,
  `movimiento_inventario_detalle`, `recuento_inventario_linea`, `item_producto`
  (`stock`, `costo_actual`) — todas coinciden con los `toFixed(4)`/
  `toDecimalPlaces(4, HALF_UP)` del código que escribe ahí.
- **Frontend, archivos completos del alcance:** `pages/inventario/index.vue` (393),
  `pages/mermas.vue` (514), `pages/inventario/recuentos/index.vue` (288),
  `pages/inventario/recuentos/[id].vue` (527), `components/DevolucionInventarioLista.vue`
  (49), `composables/useDevolucionInventario.ts` (113), `useRecuentoInventario.ts` (91),
  `useUnidadConversion.ts` (53) — grep dirigido de operadores aritméticos
  (`+ - * /`) alrededor de variables `costo|precio|valor|monto` en cada uno, cero
  resultados fuera de comentarios/nombres de campo; todo el cálculo de dinero se
  hace en el backend y el front solo formatea (`formatMonto`) o hace prefill
  editable (`useUnidadConversion.convertirCosto`, usado una sola vez en `mermas.vue`).
  `causas-merma.vue`/`motivos-diferencia-inventario.vue` no tienen ningún campo de
  dinero (son catálogos de texto).
- **Agregaciones SQL:** el único `SUM()` del alcance es `diferencia_neta` en
  `recuentos.service.ts findAll` (`CASE WHEN … cantidad_contada - stock_sistema …
  ELSE 0 END`, ambas ramas `NUMERIC`) — confirmé que Postgres unifica el `CASE` a
  `numeric`, que node-postgres devuelve `NUMERIC` como string por defecto (no hay
  `setTypeParser`/`::float` en todo `backend/src`, grepeado), y que el código
  siempre lo reenvuelve en `new Decimal(...)` antes de devolverlo. Cero `AVG()`,
  `parseFloat`, `Number(...)` o casts `::float`/`::double`/`::real` en las carpetas
  del alcance.
- **División por cero / stock negativo en el CPP:** `calcularCostoPromedio`
  (`inventario.service.ts:336-352`) devuelve el costo de compra directo cuando
  `stockAnterior.lessThanOrEqualTo(0)` — cubre tanto stock 0 como negativo, sin
  dividir. Con test unitario para "sin stock previo" (`inventario.service.spec.ts:687`),
  pero no para stock previo **negativo**; leí la condición completa y el operador es
  `lessThanOrEqualTo`, así que el mismo guard cubre ambos casos — no hay una rama
  sin cubrir en el código, solo en el test.
- **Ratios del catálogo de unidades:** verifiqué en el seeder
  (`seeder.service.ts:263-330`) que las 7 unidades activas (`g/kg`, `ml/l`, `cm/m`,
  `unidad`) tienen `factorBase` en potencias de 10 (1, 100, 1000) — descarté a mano
  el escenario de "doble redondeo" (conversión de cantidad redondeada a 4
  decimales, usada después como divisor de `convertirCostoUnitario`) porque con
  estos factores la conversión nunca pierde precisión real; sin un factor no
  potencia de 10 en la tabla (que solo escribe el seeder — ya conocido) el
  escenario no es alcanzable hoy.

### Nada para reportar

No encontré aritmética nativa (`number`/`+`/`*`/`/` sin `Decimal.js`), división por
cero/negativo sin guardia, agregación SQL mal tipada, signo sin validar, ni
desacuerdo entre dos caminos que debieran coincidir (verifiqué explícitamente
`useUnidadConversion.convertirCosto` del front contra `convertirCostoUnitario` del
backend con un caso numérico concreto — 5000/kg → 5/g → round-trip a 5000 — y
coinciden exacto, sin arrastre de error, por la razón de factores-potencia-de-10
de arriba).

Hallé un sitio que reproduce la MISMA fórmula ya señalada como conocida (`cantidad ×
costoUnitario` con `toFixed(4)` fijo) en un tercer lugar —
`inventario.service.ts:818-821` (`mapMovimientoRow`, el listado general de kardex,
no solo `/mermas`) — pero es el mismo mecanismo, mismo archivo de origen del dato
(`costo_unitario` congelado), sin comportamiento distinto ni resultado que pueda
discrepar de los dos sitios ya anotados. Lo dejo mencionado acá en vez de como
hallazgo porque no agrega una consecuencia nueva: no lo cuento en el veredicto.
