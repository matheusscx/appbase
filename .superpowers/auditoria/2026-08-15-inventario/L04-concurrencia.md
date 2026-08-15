## Lente: Concurrencia y transacciones
## Veredicto: 1 hallazgo

### Qué revisé para poder afirmarlo

- `backend/src/modules/inventario/inventario.service.ts` completo (871 líneas): los tres
  modos (`cantidad`/`serie`/`lote`) en `registrarMovimiento`/`moverCantidad`/`moverSerie`/
  `moverLote`, el `FOR UPDATE` de entrada sobre `item_producto`, y los recálculos de saldo.
- `backend/src/modules/recuentos/recuentos.service.ts` completo (693 líneas): `create`,
  `updateLinea`, `update`, `cancelar`, `aplicar`/`aplicarEnTransaccion` — incluido el
  retry-on-40P01 y el `ORDER BY l.item_id` ya existentes.
- `backend/src/modules/mermas/mermas.service.ts` completo (298 líneas) y
  `backend/src/modules/motivos-diferencia-inventario/motivos-diferencia-inventario.service.ts`
  completo (393 líneas): todo mutador (`create`/`update`/`remove`/`restaurar`) y sus locks
  (`FOR UPDATE`, `FOR UPDATE OF i`, `FOR SHARE`).
- `backend/src/modules/catalog/catalog.service.ts` completo (167 líneas, solo
  `convertirUnidad`/`convertirUnidades`/`crearConversor`/`findAllUnidadesMedida` — el resto
  del archivo no está en el alcance de esta pasada). Es de solo lectura, sin escritura.
- La costura de stock en `backend/src/modules/ventas/ventas.service.ts`: los cuatro loops
  que llaman `registrarMovimiento` en `crearEnTransaccion` (línea 633), `cancelar` (861),
  `crearNotaCredito` (1006) y `registrarDevolucionesPorReembolso` (1152), más el wrapper de
  reintento de deadlock (`esDeadlock`/`MAX_REINTENTOS_DEADLOCK`, líneas 44-143) y su cobertura
  en `ventas.service.spec.ts` (líneas 400-493).
- En `backend/src/modules/items/items.service.ts` (fuera de alcance profundo, solo la
  costura): grep dirigido a `registrarMovimiento`/`FOR UPDATE`/`.sort(`/`ORDER BY.*id` —
  confirmé que `venderIngredientesReceta` (2698), `venderComponentesCombo` (2803) y el loop
  de grupos-modificadores (2982) ya ordenan por `itemId` antes de mover stock.
- Seguí la cadena completa del reembolso: `reembolso-callback.handler.ts` →
  `cobros.service.ts:400-446` para confirmar qué pasa con un error de
  `registrarDevolucionesPorReembolso`/`crearNotaCredito` en ese camino.

Fuera de lo reportado abajo, el resto de las 43+ escrituras revisadas sigue el patrón
correcto: `FOR UPDATE` antes de leer el valor que decide el `UPDATE`, movimiento+saldo en
la misma transacción, y estados terminales cerrados con `WHERE estado = ...` bajo lock.

### H1. Los tres caminos que revierten stock de una venta (anular, nota de crédito,
devolución por reembolso) no tienen la protección de deadlock que sí tiene la creación
de venta — y en el camino de reembolso, la falla queda como plata devuelta sin stock
corregido

- **Severidad:** alta
- **Ubicación:**
  - `backend/src/modules/ventas/ventas.service.ts:845-872` (`cancelar`, loop `reponerStock`)
  - `backend/src/modules/ventas/ventas.service.ts:960-1016` (`crearNotaCredito`) +
    `:1301` (`validarDevolucionesReembolso` devuelve `devoluciones.map(...)`, preservando
    el orden que mandó el cliente)
  - `backend/src/modules/ventas/ventas.service.ts:1132-1163`
    (`registrarDevolucionesPorReembolso`)
  - Contraste con el camino que sí está protegido: `:44-62` (`esDeadlock`/
    `MAX_REINTENTOS_DEADLOCK`), `:132-143` (`crear()` reintenta), `:603-633` (`ordenLocks`,
    orden determinista por `itemId` en la creación de venta)
  - Consecuencia silenciosa del fallo: `backend/src/modules/pasarela/services/cobros.service.ts:436-445`
    y el docblock de `backend/src/modules/ventas/reembolso-callback.handler.ts:9-17`
  (abrí los cinco archivos: sí)

- **Qué está mal:** `registrarMovimiento` toma `SELECT ... FOR UPDATE` sobre
  `item_producto` por cada ítem que toca. La creación de venta (`crearEnTransaccion`,
  línea 633) ya sabe que esto puede deadlockear entre dos ventas con los mismos ítems en
  orden distinto — lo dice el comentario de línea 603-608 — y lo resuelve con **dos**
  capas: orden determinista por `itemId` (línea 618-625) y, como red de seguridad porque
  la expansión de recetas/combos igual puede romper ese orden global (comentario línea
  114-120), un reintento automático ante `40P01` (línea 132-143), con test dedicado en
  `ventas.service.spec.ts:434-493`.

  Los otros tres caminos que también recorren varios ítems y llaman `registrarMovimiento`
  en un loop —`cancelar` con `reponerStock`, `crearNotaCredito` y
  `registrarDevolucionesPorReembolso`— no tienen NINGUNA de las dos capas: ni ordenan por
  `itemId` (`cancelar` itera el orden crudo del `SELECT` sin `ORDER BY`, línea 845-851;
  los otros dos iteran literalmente el array `devoluciones` que manda el cliente en el
  DTO, sin ordenar — línea 1301) ni están envueltos en el retry de `esDeadlock`. Un
  `40P01` ahí se propaga tal cual.

- **Escenario:** Dos reembolsos de pasarela llegan casi simultáneos (webhooks de la
  pasarela, o el admin procesando dos devoluciones manuales seguidas) sobre dos ventas
  ORIGINALES DISTINTAS que comparten dos productos, X e Y. Reembolso A pide devolver
  `[{itemId: X}, {itemId: Y}]`; reembolso B pide devolver `[{itemId: Y}, {itemId: X}]`
  (orden invertido — nada en el DTO ni en el service lo normaliza). Transacción A toma el
  lock de X y espera el de Y; transacción B toma el de Y y espera el de X → ciclo,
  Postgres aborta una con `40P01`. En `crearNotaCredito`/`registrarDevolucionesPorReembolso`
  esa excepción sube hasta `cobros.service.ts:436`, que la loguea y devuelve
  `{ warning: 'El reembolso fue procesado, pero la nota de crédito/devolución falló...' }`
  — la respuesta pública igual dice reembolso OK. El dinero ya volvió al cliente (el
  reembolso en la pasarela no se revierte, por diseño: línea 16-17 de
  `reembolso-callback.handler.ts`), pero el `movimientos_inventario`/`item_producto.stock`
  de esa devolución nunca se escribió y nadie reintenta: el stock queda permanentemente
  desincronizado hasta que alguien note el warning en el log y lo corrija a mano. Con
  `cancelar`, el resultado es más benigno pero igual de real: la venta queda sin anular
  (transacción entera abortada) y el cajero recibe un 500 genérico donde una venta
  concurrente con orden de ítems compatible hubiera fallado antes de llegar a este código
  (la caja ya está lockeada, así que dos `cancelar` concurrentes sobre la misma venta no
  aplica — el ciclo es entre DOS ventas distintas que comparten ítems).

- **Por qué ningún test lo caza:** `ventas.service.spec.ts` solo prueba el retry de
  `40P01` para `crear()` (líneas 434-493), con `manager.query` mockeado — no existe el
  equivalente para `cancelar`, `crearNotaCredito` ni `registrarDevolucionesPorReembolso`.
  Aunque existiera, un mock de `manager.query` no puede reproducir un deadlock real de
  Postgres; hace falta el e2e con concurrencia real, y el e2e corre con `maxWorkers: 1`
  (ya anotado en el brief como ceguera estructural del gate).

- **Confianza:** alta — verifiqué los cinco archivos línea por línea, confirmé que el
  propio comentario del código (línea 603-608 y 114-120) describe exactamente este
  mecanismo como la razón por la que la creación de venta necesitó las dos capas, y seguí
  la cadena de manejo de errores hasta `cobros.service.ts` para confirmar que el fallo se
  traduce en un `warning` sin reintento ni compensación. Lo que me faltaría para subirla
  más: reproducir el `40P01` con dos transacciones reales contra Postgres (bloqueado por
  el mismo límite de `maxWorkers: 1` que el resto de la auditoría).
