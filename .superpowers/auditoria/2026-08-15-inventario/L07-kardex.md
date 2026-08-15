## Lente: el kardex como fuente de verdad (¿puede el saldo divergir de la suma de sus movimientos?)
## Veredicto: 2 hallazgos

### Qué revisé para poder afirmarlo

- `backend/src/modules/inventario/inventario.service.ts` completo (872 líneas): las tres
  ramas de `registrarMovimiento` (modo `cantidad`/`serie`/`lote`), `registrarAjusteCosto`,
  `calcularCostoPromedio`, `recalcularStockSerie/Lote`, `insertarDetalleMovimiento` y
  `findMovimientos` — línea por línea.
- `backend/src/modules/inventario/inventario.controller.ts` completo (2 endpoints: los únicos
  que expone el módulo).
- `backend/src/modules/mermas/mermas.service.ts` (`registrar` y `findAll` completos) y
  `recuentos/recuentos.service.ts` (`create`, `cancelar`, `aplicar`, `assertBorrador`).
- `backend/src/modules/items/items.service.ts`: alta de item con stock inicial (~920-1040),
  `ajustarStock` (~2002-2077), edición con guard de `modo_inventario` inmutable (~1360-1470),
  `remove`/`restaurar` (~1815-1920).
- `backend/src/modules/ventas/ventas.service.ts`: los 3 sitios que llaman
  `registrarMovimiento` (venta, anulación con reposición, devolución) y las 2 queries que
  leen `movimientos_inventario` para calcular "ya devuelto" (~1260-1300, ~1540-1600).
- `backend/src/modules/seeder/seeder.service.ts`: los 4 sitios que escriben
  `item_producto.stock` + `movimientos_inventario` para datos demo.
- Grep de todo `backend/src/modules` por `item_producto`, `item_lote`, `item_unidad` y
  `movimientos_inventario` para confirmar que **ningún otro archivo** escribe esas tablas
  fuera de `inventario.service.ts` (y el seeder) — un solo chokepoint real.
- Grep de `.sql`/`.sh` fuera de `node_modules` por las mismas tablas: no hay scripts de
  arreglo ni migraciones de datos que las toquen.

Conclusión general: el chokepoint (`registrarMovimiento`) es sólido — todo camino de
producción que mueve stock pasa por ahí, movimiento y saldo se escriben en la misma
transacción, y el signo/cantidad del kardex siempre coincide con el delta aplicado. Los
dos hallazgos de abajo no son "el saldo ya divergió", sino dos huecos reales alrededor de
esa garantía: uno estructural (no hay forma de detectar una divergencia si ocurriera) y uno
de visibilidad (el kardex se vacía de una vista de auditoría por una acción de catálogo sin
relación con inventario).

---

### H1. Modo `cantidad` no tiene ningún camino que recalcule el saldo desde el kardex — y el módulo no expone reconciliación
- **Severidad:** alta
- **Ubicación:** `backend/src/modules/inventario/inventario.service.ts:358-379` (`moverCantidad`,
  único lugar que toca `item_producto.stock` en modo `cantidad`) vs.
  `inventario.service.ts:640-675` (`recalcularStockSerie`/`recalcularStockLote`, que sí
  existen para los otros dos modos) y `inventario.controller.ts:24-43` (los únicos 2
  endpoints del módulo: `GET movimientos` y `POST ajustes-costo` — ninguno reconcilia nada).
- **Qué está mal:** en modo `serie` y `lote`, el saldo materializado se recalcula desde una
  fuente independiente (`COUNT` sobre `item_unidad`/`SUM` sobre `item_lote`) cada vez que se
  mueve algo — si el saldo y esa fuente alguna vez difirieran, el próximo movimiento lo
  autocorrige. En modo `cantidad` (el default, y el que usan ingredientes y la mayoría de
  productos) no existe absolutamente ningún mecanismo equivalente: `moverCantidad` hace un
  `UPDATE item_producto SET stock = $1` con un valor calculado en memory
  (`stockAnterior.plus/minus(cantidad)`), y esa es la única fuente que existe — no hay una
  función `recalcularStockCantidad` que sume `movimientos_inventario` y la compare o la
  reescriba. El propio controller no tiene un endpoint de "recalcular" ni de "verificar".
- **Escenario:** cualquier evento que deje `item_producto.stock` desalineado de la suma de
  sus movimientos —el seeder (ver nota abajo, no atómico), una migración futura, un `UPDATE`
  manual de soporte en producción, un bug que algún día se cuele en `moverCantidad`— **nunca
  se detecta ni se corrige**. No hay job, endpoint ni query en todo el backend que compare
  `item_producto.stock` contra `SUM(cantidad con signo) de movimientos_inventario`. El kardex
  deja de ser verificable como fuente de verdad: es fuente de verdad de palabra, pero nada en
  el sistema la audita contra el saldo que en la práctica gobierna las ventas (el `FOR UPDATE`
  de `registrarMovimiento` lee `item_producto.stock`, no recalcula desde el kardex).
- **Por qué ningún test lo caza:** los tests existentes (`inventario.service.spec.ts`) prueban
  que UN movimiento deja saldo y kardex consistentes entre sí — nunca prueban una
  reconciliación masiva `stock vs. SUM(movimientos)`, porque esa función no existe para
  probarla. Un test de invariante tipo "para todo item, `stock == SUM(movimientos con signo)`"
  no tiene qué código ejercitar.
- **Confianza:** alta — verificado abriendo el archivo completo: no hay ningún otro `UPDATE
  item_producto SET stock` en modo `cantidad` fuera de `moverCantidad`, y `grep` confirma que
  no existe función de recálculo ni endpoint de auditoría en el módulo.

### H2. Borrar un ítem (acción de catálogo, sin guard de kardex) vacía su historial de kardex y de mermas de toda vista de auditoría
- **Severidad:** media
- **Ubicación:** `backend/src/modules/inventario/inventario.service.ts:729` y `:754` (`JOIN
  items i ON i.item_id = mv.item_id AND i.eliminado_el IS NULL` en `findMovimientos`);
  mismo patrón en `backend/src/modules/mermas/mermas.service.ts:213` y `:233` (`findAll`);
  guard de borrado en `backend/src/modules/items/items.service.ts:1834-1849` (`remove`).
- **Qué está mal:** `items.service.ts:remove()` bloquea el borrado si el ítem está pedido en
  una cuenta abierta, es ingrediente de una receta, componente de un combo, u opción de un
  grupo — pero **no** si tiene movimientos de kardex o mermas registradas. Es una acción de
  catálogo perfectamente alcanzable (discontinuar un producto) y no requiere que el stock esté
  en cero ni nada relacionado a inventario. Una vez soft-eliminado el ítem, tanto
  `GET /inventario/movimientos` como `GET /mermas` hacen `JOIN items ... AND
  i.eliminado_el IS NULL` — un INNER JOIN, no LEFT — así que **todas** las filas de
  `movimientos_inventario` de ese ítem (compras, ventas, mermas con su `costoPerdido`,
  ajustes de costo, recuentos) desaparecen de ambas pantallas de auditoría, aunque las filas
  siguen físicamente en la tabla.
- **Escenario:** producto "Queso laminado" recibe 3 compras, se vende varias veces y registra
  2 mermas por vencimiento (costo perdido real, ej. $12.000). El admin lo discontinúa desde
  Catálogo → Items → Eliminar (sin fricción, ningún aviso menciona el kardex). A partir de ese
  momento, un usuario que abre "Inventario → Movimientos" o "Mermas" para reconciliar el
  período **ya no ve ninguna de esas filas** — ni las compras, ni las mermas, ni su costo
  perdido — sin ningún indicador de que faltan filas. La única forma de recuperarlas es
  restaurar el ítem desde la papelera (si el operador sabe que existió) o consultar la BD
  directamente.
- **Por qué ningún test lo caza:** ninguno de los specs de `mermas.service.spec.ts` ni
  `inventario.service.spec.ts` prueba "listar movimientos/mermas de un ítem que fue
  eliminado" — todos los fixtures de esos specs usan ítems vivos. El guard de `remove()` en
  `items.service.spec.ts` prueba los 4 bloqueos existentes (`cuenta`, `ingrediente`, `combo`,
  `opcion`) pero no ejercita el caso "ítem con movimientos de kardex", así que no hay ningún
  test que documente —ni bloquee— esta pérdida de visibilidad.
- **Confianza:** alta — verificado abriendo los 3 archivos; el `INNER JOIN` (no `LEFT JOIN`)
  está confirmado en las 4 líneas citadas, y el guard de `remove()` fue leído completo sin
  encontrar ninguna condición sobre `movimientos_inventario`.

---

### Nota (no cuenta como hallazgo, ruled out): seeder no atómico

`seeder.service.ts` (4 sitios: ~3006-3031, ~3057-3076, ~3186-3209, y un cuarto patrón
idéntico ~3370-3385) hace `UPDATE item_producto SET stock` y luego `INSERT INTO
movimientos_inventario` como dos `this.dataSource.query()` sueltos, no dentro de una
transacción — a diferencia del resto del código, que siempre pasa por
`registrarMovimiento` dentro de un `manager.transaction`. Si el proceso muriera entre esas
dos queries quedaría stock sin movimiento respaldándolo. No lo reporto como hallazgo de
producción porque es exclusivamente dato de seed/demo (el proyecto no tiene datos
productivos — memoria del agente), corre una sola vez al boot con chequeo de idempotencia
(`exists` antes de insertar), y el cantidad/costo escrito en ambas queries coincide en los
4 sitios verificados. Queda anotado por si en algún momento se decide envolver el seeder en
una transacción por otra razón.
