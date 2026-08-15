## Lente: modo_inventario — cantidad, serie y lote
## Veredicto: 3 hallazgos

### Qué revisé para poder afirmarlo

- `backend/src/modules/inventario/inventario.service.ts` completo (872 líneas): las tres
  ramas de `registrarMovimiento` (`moverCantidad`, `moverSerie`, `moverLote`), los dos
  helpers `recalcularStockSerie`/`recalcularStockLote`, y `insertarDetalleMovimiento`.
- Las entidades `item-producto.entity.ts`, `item-unidad.entity.ts`, `item-lote.entity.ts`
  (los tres `@Entity` completos) contra lo que documentan ADR-007 y
  `docs/features/inventario-serializado.md`, y contra `startup-pos.sql` como referencia
  de qué se documentó pero no manda.
- Los 4 caminos que escriben `modo_inventario`: alta (`items.service.ts:940-971`),
  edición con el guard de inmutabilidad (`items.service.ts:1364-1432`), y confirmé por
  grep que ningún endpoint hace `UPDATE movimientos_inventario SET eliminado_el` — así
  que la medición de "ya tiene movimientos" no tiene forma de vaciarse por soft-delete.
  `tipo` no es editable (no existe en `update-item.dto.ts`), así que un ítem no puede
  cambiar de `servicio`/`suscripción` a `producto` después de tener stock.
- Los tres módulos que hacen salidas de stock contra un modo no-`cantidad`:
  `mermas.service.ts` (registro completo, 201 líneas), `recuentos.service.ts` (aplicar
  diferencias, líneas 519-668), y el seam en `ventas.service.ts` (venta, anulación,
  devolución — grep de las 3 rutas que llaman a `registrarMovimiento` o lo rechazan).
- Grep de `fecha_vencimiento`/`vencid` en todo `backend/src` (fuera de DTOs/entidades):
  cero comparaciones contra `NOW()` en ningún archivo.
- `inventario.service.spec.ts` (13 tests) y `mermas.service.spec.ts` (12 tests) enteros,
  para confirmar qué escenario cada uno ejercita y cuál no.

### H1. Los índices únicos documentados de serie y lote no existen en las entidades — nada impide duplicar un IMEI o crear dos lotes con el mismo código

- **Severidad:** alta
- **Ubicación:** `backend/src/modules/items/entities/item-unidad.entity.ts:1-45` y
  `item-lote.entity.ts:1-54` (sin `@Index` en ningún lado del archivo); escritura sin
  chequeo de duplicado en `backend/src/modules/inventario/inventario.service.ts:399-416`
  (INSERT de cada serie) y condición de carrera en `inventario.service.ts:504-541`
  (SELECT-then-INSERT de lote sin lock efectivo cuando no existe fila previa).
- **Qué está mal:** `docs/features/inventario-serializado.md:168` documenta
  `(tenant_id, serie) WHERE eliminado_el IS NULL` como índice único de `item_unidad`, y
  la línea 183 documenta `(item_id, codigo_lote) WHERE eliminado_el IS NULL` para
  `item_lote`. `startup-pos.sql:813,833` también los tiene. Pero ninguna de las dos
  entidades TypeORM (que es lo que de verdad crea el esquema vía `synchronize`, según el
  propio CLAUDE.md) declara un `@Index`. El proyecto sí usa `@Index` con `unique` y
  `where` parcial en otras entidades del mismo repo (ej.
  `caja-testigo.entity.ts:48-51`), así que no es un mecanismo desconocido: acá
  simplemente no se escribió. Además, el código de aplicación tampoco lo compensa:
  `moverSerie` (entrada) inserta cada `serie` sin ningún `SELECT` previo que busque un
  duplicado, ni dentro del mismo tenant ni dentro de la misma request; y
  `moverLote` (entrada) hace `SELECT ... WHERE codigo_lote = $2 FOR UPDATE` para
  reusar el lote existente, pero cuando la consulta no devuelve filas el `FOR UPDATE` no
  bloquea nada — dos entradas concurrentes con el mismo `codigoLote` nuevo pueden pasar
  la comprobación a la vez y terminar en dos filas `item_lote` con el mismo código.
- **Escenario:** un tenant con un producto en modo `serie` (ej. celulares por IMEI).
  Dos compras separadas —o un typo del mismo operador— cargan el mismo IMEI
  `359999112345678` dos veces vía `PATCH /items/:id/stock` con `series: [{serie:
  "359999112345678"}]`. Ambas entradas se aceptan con 200: quedan dos filas
  `item_unidad` distintas, ambas `estado='disponible'`, con la misma serie. El stock
  materializado se infla en 1 unidad fantasma (`recalcularStockSerie` cuenta filas, no
  series distintas), y el catálogo de series (`GET /items/:id/unidades`) muestra el
  mismo IMEI dos veces — rompe la premisa completa de ADR-007 ("cada unidad tiene
  identidad propia").
- **Por qué ningún test lo caza:** `inventario.service.spec.ts` (`describe
  'registrarMovimiento — modo serie'`) solo prueba series distintas entre sí
  (`IMEI-001`, `IMEI-002`); no hay ningún test que inserte la misma serie dos veces y
  espere un rechazo. Como tampoco hay `@Index` en la entidad, ni siquiera el e2e contra
  Postgres real lo vería fallar — la base simplemente lo permite.
- **Confianza:** alta — verificado abriendo las dos entidades completas y confirmando
  la ausencia de `@Index`, más el flujo de escritura en `inventario.service.ts` línea
  por línea.

### H2. `fecha_vencimiento` de un lote se guarda pero nunca se valida: un lote vencido es tan vendible como uno fresco, y la salida es FIFO por fecha de creación, no FEFO por vencimiento

- **Severidad:** alta
- **Ubicación:** `backend/src/modules/inventario/inventario.service.ts:551-563` (salida
  lote sin `loteId`: auto-selección `ORDER BY creado_el ASC`, sin filtrar ni ordenar por
  `fecha_vencimiento`) y `inventario.service.ts:600-625` (salida lote con `loteId`
  explícito: solo valida `tenant_id`, `item_id` y `cantidad_disponible` — nunca
  `fecha_vencimiento`).
- **Qué está mal:** `item_lote.fecha_vencimiento` se escribe en la entrada
  (`inventario.service.ts:528-537`) y se expone en `GET /items/:id/lotes`
  (`items.service.ts:2115-2140`), pero un grep de `vencimiento`/`vencid` en todo
  `backend/src` (excluyendo DTOs y entidades) no encuentra ninguna comparación contra
  `NOW()` ni ningún filtro que excluya un lote vencido de una salida. ADR-007 documenta
  como trabajo futuro el FEFO *automático* ("el usuario elige el lote manualmente"), pero
  eso presupone que elegir un lote vencido debería, como mínimo, avisar o bloquear — hoy
  no hace ninguna de las dos cosas, ni en la selección automática ni en la manual.
- **Escenario:** un producto en modo `lote` (ej. Paracetamol, el mismo del seed) tiene un
  lote con `fecha_vencimiento = '2026-01-01'` (vencido hace 7 meses respecto de la fecha
  actual 2026-08-15) y `cantidad_disponible = 100`. Un garzón/cajero vende 10 unidades
  sin elegir lote explícito (`loteId` ausente): `moverLote` ordena por `creado_el ASC` y
  descuenta del lote vencido igual que de cualquier otro, sin error ni advertencia. Si el
  cajero sí elige el lote vencido a propósito (`loteId` explícito, ej. porque es el único
  con stock), el `SELECT` de la línea 600-606 tampoco lo rechaza. La venta se registra
  como si el producto estuviera en condiciones normales.
- **Por qué ningún test lo caza:** ningún test de `inventario.service.spec.ts` incluye
  un lote con `fecha_vencimiento` en el pasado ni afirma un rechazo por vencimiento — los
  tests de "salida lote" solo verifican cantidad y existencia del lote. No hay ningún
  archivo `*.spec.ts` en el alcance que mencione una fecha de vencimiento vencida.
- **Confianza:** alta — el grep negativo (cero comparaciones de fecha de vencimiento en
  todo el backend) es exhaustivo dentro del alcance del módulo; la única forma de que
  esto no sea un hallazgo es que exista una decisión de producto documentada en
  `docs/PRODUCTO.md` de que el vencimiento es solo informativo, y no encontré esa
  decisión en `docs/features/inventario-serializado.md` ni en ADR-007 (solo dicen que
  FEFO automático es futuro, no que el vencimiento en sí no se valida).

### H3. Merma de un producto en modo serie o lote no pide qué unidad/lote se dio de baja: acepta la request y descuenta el más antiguo, no el que de verdad se dañó

- **Severidad:** alta
- **Ubicación:** `backend/src/modules/mermas/mermas.service.ts:70-172` (método
  `registrar` completo — ningún chequeo de `modo_inventario` salvo dentro del `if
  (huboConversion)` de la línea 118, que solo cubre conversión de unidad, no
  serie/lote) y `backend/src/modules/mermas/dto/create-merma.dto.ts` (sin campos
  `unidadIds` ni `loteId`).
- **Qué está mal:** `CreateMermaDto` no tiene forma de que el cliente indique qué serie o
  qué lote se está dando de baja. `mermas.service.ts` llama a
  `inventarioService.registrarMovimiento` con `motivo: 'merma'` sin `unidadIds` ni
  `loteId` (líneas 162-172). Cuando el ítem está en modo `serie`,
  `moverSerie` (`inventario.service.ts:427-449`) interpreta `unidadIds` vacío como
  "auto-selección FIFO" y da de baja la(s) unidad(es) `disponible` más antigua(s) por
  `creado_el`. Cuando está en modo `lote`, `moverLote` (`inventario.service.ts:552-598`)
  hace lo mismo con el lote más antiguo. Esto contrasta con los otros dos escritores de
  salida por motivo no-cantidad del mismo seam: `recuentos.service.ts:566-569` rechaza
  con un 400 explícito ("cambió a modo X … no se puede aplicar por cantidad") y
  `ventas.service.ts:856-858` (anulación) y `:1316-1318` (devolución) también rechazan
  con un mensaje accionable. Mermas es el único de los cuatro escritores del kardex que,
  frente al mismo caso, **acepta y hace algo distinto de lo pedido en silencio** en vez
  de rechazar. El frontend tampoco filtra: `frontend/app/pages/mermas.vue:161-165` carga
  TODOS los productos (`tipo=producto` y `tipo=ingrediente`) en el selector sin excluir
  los que están en modo `serie`/`lote`, y el formulario nunca pide una serie o un lote.
- **Escenario:** un producto en modo `serie` tiene 3 IMEIs disponibles: A (el más
  antiguo, sin daño), B, y C (el más nuevo, recién cargado, y es el que un empleado dejó
  caer y rompió). El empleado registra una merma por 1 unidad con la causa "daño físico"
  desde `pages/mermas.vue`, sin ninguna opción para indicar cuál de los 3 IMEIs es el
  dañado. El backend acepta la request con 200 y marca **la unidad A** (`estado='baja'`)
  — la que en la vida real sigue intacta — mientras la unidad C (la que realmente se
  rompió) queda `estado='disponible'` y vendible. Un vendedor puede despachar C a un
  cliente creyendo que está sano, y si alguna vez se consulta el historial de garantía
  por ese IMEI (`item_unidad.serie`), el registro de "dado de baja por daño" queda
  atado al IMEI equivocado — corrompe la trazabilidad que es la razón de ser del modo
  `serie` (ADR-007, sección Context).
- **Por qué ningún test lo caza:** `mermas.service.spec.ts:14-21` define el `itemRow`
  por defecto con `modo_inventario: 'cantidad'` y ningún test del archivo lo sobreescribe
  a `'serie'` o `'lote'`; además `InventarioService.registrarMovimiento` está mockeado
  como `jest.fn()` (línea 39), así que la lógica real de auto-selección FIFO de
  `moverSerie`/`moverLote` nunca corre bajo este test — el mock devuelve lo que el test
  configure, sin importar qué unidad "eligió". El escenario tampoco aparece en
  `mermas.e2e-spec.ts` (grep de `modo_inventario`/`serie`/`lote` en ese archivo: sin
  resultados) — el e2e de mermas nunca ejercita un ítem no-`cantidad`.
- **Confianza:** alta — comparé el mismo caso (salida por motivo no-`cantidad` sin
  `unidadIds`/`loteId`) contra los otros tres escritores del kardex y los tres rechazan;
  mermas es la única excepción, confirmada leyendo el método `registrar` completo.
