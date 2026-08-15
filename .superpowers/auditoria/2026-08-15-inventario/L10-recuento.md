## Lente: El ciclo de vida del recuento de inventario (máquina de estados)

## Veredicto: 2 hallazgos

### Qué revisé para poder afirmarlo

Leí completo `recuentos.service.ts` (693 líneas: `create`, `findAll`, `findOne`,
`updateLinea`, `update`, `cancelar`, `aplicar`/`aplicarEnTransaccion`, `assertBorrador`),
el controller (los 7 endpoints con sus guards de permiso), las dos entidades
(`recuento-inventario.entity.ts`, `recuento-inventario-linea.entity.ts`),
`motivos-diferencia-inventario.service.ts` completo (los locks `FOR UPDATE`/`FOR SHARE`
que le dan a `aplicar()` su consistencia contra el catálogo), la definición de índices
en `seeder.service.ts:1241` y `startup-pos.sql:862-876`, `docs/features/recuento-inventario.md`
completo, el frontend (`pages/inventario/recuentos/index.vue`, `[id].vue`,
`useRecuentoInventario.ts`), y el tramo de `inventario.service.ts` que `aplicar()` invoca
(`registrarMovimiento` líneas 71-241, `moverCantidad` líneas 358-379) para verificar con
precisión el mecanismo del delta. Crucé el listado de `it(...)` de
`recuentos.service.spec.ts` y `test/recuentos.e2e-spec.ts` (28 casos entre ambos) contra
cada hallazgo para confirmar que no hay test que lo mate.

Mapeé la máquina de estados completa (`borrador` → `aplicado` | `cancelado`, los dos
últimos terminales) y probé cada transición inválida contra el código:

| Transición inválida | ¿Bloqueada? | Mecanismo |
|---|---|---|
| `cancelar` sobre `aplicado` | Sí | `assertBorrador` (SELECT FOR UPDATE + `if estado==='aplicado'`), `recuentos.service.ts:686-688` |
| `cancelar` sobre `cancelado` | Sí | ídem, `recuentos.service.ts:689-691` |
| `aplicar` sobre `aplicado` | Sí | check explícito en `aplicarEnTransaccion`, `recuentos.service.ts:514-516` |
| `aplicar` sobre `cancelado` | Sí | ídem, `recuentos.service.ts:517-519` |
| `aplicar` × 2 concurrente (doble clic) sobre la misma sesión | Sí | `SELECT ... FOR UPDATE` sobre `recuento_inventario` en `aplicarEnTransaccion` (`recuentos.service.ts:503-509`) serializa: la segunda transacción espera el commit de la primera y relee `estado='aplicado'` ya escrito — no hay ventana |
| `updateLinea`/`update`/`cancelar` sobre `aplicado`/`cancelado` | Sí | las tres pasan por `assertBorrador`, `recuentos.service.ts:672-692` |
| Deadlock `aplicar` vs venta concurrente sobre el mismo item (40P01) | Mitigado | reintento único y seguro (rollback ya sin efecto), `recuentos.service.ts:473-489` |
| Causa desactivada/eliminada entre asignarla y aplicar | Bloqueada | segunda validación con `FOR SHARE` justo antes de mover stock, `recuentos.service.ts:594-617`, sincronizada contra `remove`/`update` del catálogo que toman `FOR UPDATE` (`motivos-diferencia-inventario.service.ts:136,199`) |
| Item eliminado entre contar y aplicar | Manejada (con matiz, ver H2) | línea descartada, no aborta la sesión, `recuentos.service.ts:548-556` |
| `modo_inventario` cambia de `cantidad` a otro mientras está en `borrador` | Bloqueada, con mensaje nombrando el producto | `recuentos.service.ts:566-570` |
| Delta dejaría stock negativo | Bloqueada | `moverCantidad` en `inventario.service.ts:369-371`, re-etiquetado con el nombre del producto en `recuentos.service.ts:637-644` |
| **Dos sesiones `borrador` abiertas sobre el mismo item, ambas aplicadas** | **Abierta — H1** | ninguna, ver abajo |

Confirmé además que "el momento del delta" — el punto que el brief marcaba como el
hallazgo más probable de esta lente — está bien implementado: `stock_sistema` se congela
en la línea al crear la sesión (`create`, `recuentos.service.ts:200-208`), el delta se
calcula contra ese valor congelado (`aplicarEnTransaccion:559`), y se aplica como
cantidad relativa (`entrada`/`salida`) sobre el stock **vigente** leído bajo
`FOR UPDATE` dentro de `registrarMovimiento` (`inventario.service.ts:91`,
`moverCantidad:364-367: stockAnterior.plus/minus(cantidad)`, nunca un `SET` absoluto).
No es un hallazgo — coincide con lo documentado.

### H1. Dos sesiones de recuento abiertas sobre el mismo item aplican el mismo faltante dos veces

- **Severidad:** alta
- **Ubicación:** `backend/src/modules/recuentos/recuentos.service.ts:149-212` (`create`, sin
  chequeo de sesiones abiertas sobre el mismo item) y `recuentos.service.ts:619-631`
  (`aplicar` mueve stock por delta congelado, sin ver otras sesiones). Confirmado también
  que no hay índice ni constraint que lo impida: el único índice único es
  `(recuento_id, item_id)` — `backend/src/modules/seeder/seeder.service.ts:1241` y
  `startup-pos.sql:876` — acotado a una sola sesión, no entre sesiones.
- **Qué está mal:** nada impide crear dos sesiones `borrador` con el mismo item, contar el
  mismo faltante real en las dos, y aplicarlas ambas. Cada una calcula su delta contra su
  propio `stock_sistema` congelado (que es el mismo valor si no hubo movimiento real entre
  medio) y lo aplica sobre el stock vigente — así que la segunda aplicación resta (o suma)
  el mismo faltante otra vez, sin que ningún mecanismo lo detecte.
- **Escenario:** item con stock=100 (sistema y realidad en sync). `POST /recuentos
  {itemIds:[item]}` crea sesión A, `stock_sistema=100`. Sin que nada haya cambiado,
  `POST /recuentos {itemIds:[item]}` crea sesión B, también `stock_sistema=100` (dos
  personas contando el mismo pasillo, o un mismo operador que no recuerda tener un borrador
  abierto). Ambas cuentan 90 físico (un solo faltante real de 10 unidades, descubierto por
  las dos). `PATCH .../lineas/:id {cantidadContada:"90"}` en cada una → delta -10 en cada
  una. Un aprobador aplica A: `stock` 100→90 (correcto, coincide con la realidad). Aplica B
  (sesión distinta, válida, nadie le avisó que ya se corrigió el mismo faltante): delta -10
  otra vez sobre el vigente → `stock` 90→80. El sistema queda en 80 cuando la realidad es
  90: kardex con dos movimientos `motivo='recuento'` de -10 cada uno, ambos "legítimos" en
  la máquina de estados (cada sesión hizo `borrador → aplicado` correctamente), pero el
  stock quedó corrompido en -10 unidades sin ningún error ni aviso.
- **Por qué ningún test lo caza:** ni `recuentos.service.spec.ts` ni
  `test/recuentos.e2e-spec.ts` tienen un caso con dos sesiones sobre el mismo item (grep
  confirmado: cero coincidencias de "concurrent", "dos sesion", "segunda sesion" o
  similares). El test que lo cazaría: crear dos sesiones sobre el mismo item, cargar el
  mismo conteo en ambas, aplicar las dos, y afirmar que el stock resultante coincide con lo
  contado (no con contado − delta acumulado). El propio doc
  (`docs/features/recuento-inventario.md:451`) documenta la tabla de riesgos con la fila
  "Dos sesiones en `borrador` sobre el mismo producto" y la da por mitigada ("aplicar ambas
  en cualquier orden da el mismo resultado final") — la afirmación de conmutatividad es
  cierta (A luego B = B luego A, aritméticamente), pero conmutar dos restas de -10 no las
  vuelve **correctas**: el resultado final es -20, no -10, en cualquier orden. El
  frontend tampoco avisa: el selector de productos al crear una sesión
  (`frontend/app/pages/inventario/recuentos/index.vue:71-75`) no filtra ni marca items que
  ya estén en otra sesión `borrador`.
- **Confianza:** alta — verificado leyendo `create`, `aplicar`, el índice único real y el
  selector del frontend; no hay ningún punto del código (backend o frontend) que consulte
  otras sesiones al crear, cargar o aplicar.

### H2. El detalle de una sesión oculta silenciosamente las líneas cuyo item se borró, pero el listado sigue contando esas líneas

- **Severidad:** media
- **Ubicación:** `backend/src/modules/recuentos/recuentos.service.ts:288-297` (`findOne`,
  `JOIN items i ON i.item_id = l.item_id AND i.eliminado_el IS NULL` — INNER JOIN que
  descarta la línea si el item está borrado) vs. `recuentos.service.ts:236-256` (`findAll`,
  `COUNT(l.linea_id)::int AS cantidad_lineas` sin ningún JOIN a `items`, así que cuenta la
  línea igual).
- **Qué está mal:** mientras una sesión sigue en `borrador`, si alguien borra (soft-delete)
  un item que ya tiene una línea en el recuento, el listado (`GET /recuentos`) sigue
  mostrando la cantidad de líneas original, pero al abrir el detalle (`GET /recuentos/:id`)
  esa línea desaparece sin ningún aviso — el `INNER JOIN` a `items` la excluye de la
  respuesta entera. El usuario que está contando ve menos filas de las que el listado
  prometía, sin ningún indicio de por qué (no hay mensaje, no hay fila tachada). Recién al
  aplicar la sesión aparece explicada en `lineasDescartadas` (`recuentos.service.ts:548-556`,
  que sí usa `LEFT JOIN` sin filtrar `eliminado_el` a propósito, con comentario explícito) —
  pero para entonces ya pasó por toda la etapa de conteo sin que nadie supiera que esa línea
  no iba a contar.
- **Escenario:** sesión con 5 líneas, `cantidadLineas: 5` en el listado. Se borra
  (soft-delete) el item de la línea 3 mientras la sesión sigue en `borrador`. `GET
  /recuentos/:id` devuelve solo 4 líneas — el listado y el detalle de la misma sesión
  quedan inconsistentes (5 vs 4), sin mensaje que lo explique al usuario que está contando.
- **Por qué ningún test lo caza:** no hay ningún test que borre un item mientras una sesión
  está en `borrador` y luego llame a `findOne`/`GET /recuentos/:id` para comparar contra
  `cantidadLineas` del listado; los tests de "producto eliminado" solo cubren el camino de
  `aplicar` (`test/recuentos.e2e-spec.ts`, sección "Recuentos — aplicar").
- **Confianza:** media — el comportamiento está verificado leyendo ambas queries línea por
  línea; lo que falta para subir la confianza es confirmar con el owner si el detalle
  debería, en cambio, mostrar la línea marcada como "item eliminado" (igual que hace
  `aplicar` internamente) en vez de ocultarla, ya que podría ser una decisión de producto
  deliberada y no documentada.
