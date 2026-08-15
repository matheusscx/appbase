## Lente: Soft delete y forma de las consultas
## Veredicto: LIMPIA (0 hallazgos)

### Qué revisé para poder afirmarlo

- **`inventario/inventario.service.ts`** (872 líneas, archivo completo abierto): las ~15
  queries crudas (`manager.query`/`dataSource.query`) sobre `item_producto`, `item_unidad`,
  `item_lote`, `movimientos_inventario`, `items`, `usuarios`, `causas_merma`. Verifiqué
  entidad por entidad si la tabla tiene `eliminado_el`: `item_producto` (extensión,
  **no** tiene la columna — confirmado leyendo `item-producto.entity.ts`, así que las
  queries que no la filtran están bien) vs. `item_unidad`, `item_lote` y
  `movimientos_inventario` (sí la tienen — `@DeleteDateColumn` confirmado en las tres
  entidades), y las 8 queries contra ellas sí filtran `eliminado_el IS NULL`, incluidos
  los `LEFT/INNER JOIN` en `findMovimientos`.
- **`mermas/mermas.service.ts`** (298 líneas) y **`mermas/causas-merma.service.ts`**
  (353 líneas), completos: las 3 + 8 queries filtran `eliminado_el IS NULL` en toda tabla
  que lo tiene (`items`, `movimientos_inventario`, `usuarios`, `causas_merma`); la
  papelera (`findAll(incluirEliminados=true)`) usa el patrón documentado
  (`eliminado_el IS NULL OR eliminado_por IS NOT NULL`) y no filtra `eliminado_el` de
  `usuarios` **a propósito**, comentado en el código.
- **`recuentos/recuentos.service.ts`** (693 líneas, completo): las ~13 queries sobre
  `recuento_inventario`, `recuento_inventario_linea`, `items`, `item_producto`,
  `motivo_diferencia_inventario`, `usuarios`. El único `LEFT JOIN items` sin
  `eliminado_el` (línea 530, dentro de `aplicarEnTransaccion`) está comentado como
  intencional — necesita ver el item borrado para descartar la línea, no ocultarlo — y
  lo verifiqué correcto contra su uso tres líneas más abajo (`item_eliminado_el != null`
  dispara el descarte).
- **`motivos-diferencia-inventario/motivos-diferencia-inventario.service.ts`**
  (393 líneas, completo): mismo patrón que `causas-merma.service.ts`, 9 queries, todas
  correctas, incluida la verificación de uso con `UNION ALL` sobre
  `movimientos_inventario`/`recuento_inventario_linea`/`recuento_inventario` (una sola
  query, no N+1).
- **`catalog/catalog.service.ts`** — solo `convertirUnidad`, `convertirUnidades`,
  `crearConversor`, `findAllUnidadesMedida`: usan `Repository.find()` de TypeORM sobre
  `UnidadMedida`, que **sí** tiene `@DeleteDateColumn` (confirmado en
  `unidad-medida.entity.ts`) — a diferencia de la advertencia del brief sobre
  `dataSource.query()`/`withDeleted()`, acá es el método de repo sin overrides, que
  excluye lo borrado automáticamente. No hay bypass.
- **Costura con `ventas.service.ts`/`items.service.ts`**: grep de
  `movimientos_inventario|item_producto|item_lote|item_unidad|registrarMovimiento` en
  ambos archivos — todas las llamadas de escritura pasan por
  `inventarioService.registrarMovimiento` (nunca `UPDATE`/`INSERT` directo a esas
  tablas desde afuera del módulo); las dos únicas lecturas directas de
  `movimientos_inventario` (líneas 1289 y 1575 de `ventas.service.ts`) están acotadas
  por `venta_id = $1` (o subquery de `venta_referencia_id = $1`, ya validado contra el
  tenant unas líneas antes) — no son un escaneo de la tabla completa.
- **N+1**: busqué `for`/`map`/`forEach` con un `await` de query adentro en los cinco
  services de backend. Encontré varios loops de escritura (`moverSerie`/`moverLote`
  insertando N unidades/lotes; `aplicarEnTransaccion` de recuentos llamando
  `registrarMovimiento` una vez por línea con diferencia) — son inserts/movimientos de
  kardex que necesariamente son uno por fila de dominio (una serie, un lote, una línea
  de recuento con su propio `FOR UPDATE` sobre `item_producto`), no una lectura
  redundante por iteración. Ningún loop hace una **lectura** que debería ser JOIN/batch.
- **`SELECT *`**: ninguna de las queries revisadas usa `SELECT *`; todas listan columnas
  explícitas.
- **Falta de `LIMIT`**: `findMovimientos` (inventario) y `findAll` (mermas, recuentos)
  pagina con `LIMIT/OFFSET`; `resolvePagination` topea `pageSize` en 100
  (`common/utils/pagination.util.ts:6`) — no hay forma de pedir la tabla completa desde
  estos endpoints, incluida `movimientos_inventario`, que es el log que nunca se poda.
- **`DELETE` físico**: ninguno — todo `remove`/borrado en el alcance es
  `UPDATE ... SET eliminado_el = NOW()`.
- **Frontend** (`pages/inventario/*.vue`, `pages/mermas.vue`,
  `pages/configuracion/{causas-merma,motivos-diferencia-inventario}.vue`,
  `DevolucionInventarioLista.vue`, y los tres composables del alcance): sin queries
  propias (consumen la API vía `useApiFetch`); grep de `pageSize` confirma que ningún
  fetch pide más de 100 filas; los composables (`useRecuentoInventario.ts`,
  `useDevolucionInventario.ts`, `useUnidadConversion.ts`) son cálculo puro sin I/O, no
  hay loop de fetch por ítem.

No encontré ninguna variante nueva de los puntos ya conocidos del brief (CPP/redondeo,
`convertirUnidad` fuera de `manager`, filtros de fecha por TimeZone, recuento sin
serie/lote, `registrarMovimientoEnTransaccion` sin test propio, idempotencia de venta,
`maxWorkers: 1`) — esos quedaron fuera del reporte tal como indica el brief.
