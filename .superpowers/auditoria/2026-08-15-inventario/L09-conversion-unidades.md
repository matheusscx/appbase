## Lente: Conversión de unidades de medida
## Veredicto: 1 hallazgo

### Qué revisé para poder afirmarlo

- `catalog.service.ts` completo: `convertirUnidad`, `convertirUnidades`, `crearConversor`,
  `convertirConMapa` (la única aritmética real, líneas 112–166) y `findAllUnidadesMedida`.
  Verifiqué la fórmula (`cantidad × factorDesde / factorHacia`, redondeo HALF_UP a 4
  decimales) es un único paso —no hay conversión en dos etapas vía una "unidad base"
  materializada, así que no hay doble redondeo en cadena dentro de la función misma.
- Los 7 sitios que llaman a `convertirUnidad`/`convertirUnidades`/`crearConversor`:
  `items.service.ts` (7 call sites: reconversión de costo al cambiar unidad, ajuste de
  stock, costeo de receta, disponibilidad de receta/combo por lotes, venta de
  ingredientes/componentes/opciones), `mermas.service.ts:124`, y
  `grupos-modificadores.service.ts:171,910` (solo validación). En cada uno verifiqué el
  ORDEN de las operaciones: todos multiplican por la cantidad vendida/contada ANTES de
  convertir (no convierten primero y multiplican después), así que no hay amplificación
  de redondeo por línea.
- El seed de `unidades_medida` (`seeder.service.ts:263-331`): 7 unidades, 4 magnitudes
  (masa, volumen, conteo, longitud), factores enteros exactos (1, 100, 1000) — sin riesgo
  de pérdida de precisión en la escala `numeric(18,6)` de `factor_base`.
- El espejo del frontend: `useUnidadConversion.ts` línea por línea contra
  `convertirConMapa` — misma fórmula, mismo redondeo, `convertirCosto` es el inverso
  algebraico correcto de `convertirCantidad`. Comparé también
  `convertirCostoUnitario` (backend, `costo-conversion-unidad.util.ts`) contra el uso que
  el frontend le da a `convertirCosto`: son la misma aritmética con distinta forma
  (una preserva el valor total con cantidad arbitraria, la otra asume cantidad=1), y
  coinciden cuando se sustituye una en la otra.
- Los 4 usos de `convertirCantidad`/`convertirCosto` en el frontend
  (`mermas.vue`, `configuracion/items.vue` ×2): confirmé que los cuatro son previews de
  UI (prefill de costo, preview de conversión, costo de receta en vivo) y que el backend
  siempre recalcula de forma autoritativa al guardar — no hay caso donde el número del
  front se persista sin pasar de nuevo por el backend.
- `item_producto.stock`/`unidad_medida` (`item-producto.entity.ts`): confirmé que el
  stock SIEMPRE nace en `'0'` (`items.service.ts:956,964`) y solo se mueve vía
  `registrarMovimiento` (kardex), nunca por `UPDATE` directo — así que "cambiar la unidad
  con stock existente sin convertir el saldo" no es alcanzable por la vía obvia. Fue
  perseguir esta pregunta la que llevó al hallazgo de abajo: el guard que protege esto
  mira el movimiento del ítem, no a quién lo referencia.
- `recuentos/`: sin ningún `unidadCodigo` en el módulo (grep vacío) — el recuento siempre
  cuenta en la unidad base del ítem, cero superficie de conversión. Confirmé lo mismo en
  el composable/página del frontend (`useRecuentoInventario.ts`,
  `pages/inventario/recuentos/*.vue`): ninguna referencia a unidad/conversión.
- `motivos-diferencia-inventario/`: sin ninguna referencia a `unidad` en el módulo — fuera
  del alcance real de esta lente.
- Los tests de `catalog.service.spec.ts` (8 casos: kg→g, g→kg, misma unidad, redondeo a 4
  decimales, unidad desconocida, magnitudes distintas, cantidad que se pierde al
  redondear, `factor_base <= 0`) — la función pura está bien cubierta. El hueco no está
  ahí, está en el llamador que deja stale una referencia cruzada.

### H1. Cambiar la unidad de un ingrediente sin stock rompe el listado completo de items del tenant si una receta ya lo referencia con una unidad de otra magnitud

- **Severidad:** alta
- **Ubicación:**
  - `backend/src/modules/items/items.service.ts:1391-1418` (guard de cambio de unidad:
    solo cuenta movimientos del ítem, nunca mira `receta_ingredientes` ni
    `grupo_modificador_opciones`)
  - `backend/src/modules/items/items.service.ts:1425-1431` (la reconversión de costo, que
    SÍ detectaría la incompatibilidad de magnitud, solo se dispara si
    `costo_actual != null`)
  - `backend/src/modules/items/items.service.ts:3160-3166` (`convertirUnidades` en batch
    dentro de `calcularDisponibilidadBatch`)
  - `backend/src/modules/catalog/catalog.service.ts:77-90` (`convertirUnidades` hace
    `conversiones.map(...)`: si una conversión del lote lanza, lanza para TODO el lote,
    sin aislar por fila)
  - `backend/src/modules/items/items.service.ts:254,316-320` (`findAll`, el listado de
    items, llama a `calcularDisponibilidadBatch` sin `try/catch`)
  - `backend/src/modules/items/items.controller.ts:31-33` (el controller tampoco atrapa
    el error — se propaga como 400 para todo el endpoint)
- **Qué está mal:** el guard que bloquea cambiar `unidadMedida` de un producto/ingrediente
  (`items.service.ts:1395-1418`) solo verifica si el ÍTEM MISMO tiene movimientos de
  stock (`movimientos_inventario` no-`ajuste`). No verifica si otras entidades lo
  referencian con una unidad ya fijada: `receta_ingredientes.unidad_codigo` (validado
  contra la magnitud del ingrediente solo en el momento de crear/editar la receta,
  `validarYCostearIngredientes`) y `grupo_modificador_opciones.unidad_codigo` /
  `item_grupo_modificador_opciones.unidad_codigo` (mismo problema, validado solo al
  crear la opción). Un ingrediente creado sin costo y sin movimientos puede cambiar de
  magnitud (p. ej. masa → volumen) libremente, dejando esas filas con una unidad
  guardada que ya no es convertible contra la nueva `unidad_medida` del ingrediente.
  Cuando algo intenta esa conversión después, `convertirConMapa` lanza
  `BadRequestException` (`catalog.service.ts:134-138`, comportamiento correcto en
  aislamiento) — pero el llamador que la dispara en el listado de items
  (`calcularDisponibilidadBatch` → `convertirUnidades`) la hace en un solo batch sin
  aislar por fila, y el listado (`GET /items`) no atrapa el error. El resultado no es
  "esa receta falla": es que **todo el catálogo del tenant deja de listarse**.
- **Escenario:**
  1. Crear ingrediente "Queso" con `unidadMedida='kg'` (magnitud `masa`), sin `costo`
     (queda `costo_actual = null`) y sin comprar/mover stock todavía.
  2. Crear receta "Pizza" con un ingrediente `{ ingredienteItemId: Queso,
     cantidad: '0.2', unidadCodigo: 'kg' }` — pasa la validación porque `kg` es
     convertible contra `kg` (misma unidad).
  3. `PATCH /items/{quesoId}` con `unidadMedida: 'l'` (magnitud `volumen`). El guard de
     `items.service.ts:1391-1418` cuenta movimientos no-`ajuste` de Queso → 0 → permite
     el cambio. El bloque de reconversión de costo (línea 1425) se salta porque
     `costo_actual` es `null`. El `UPDATE` a `unidad_medida='l'` se ejecuta sin más
     validación. `receta_ingredientes` para Pizza queda con
     `unidad_codigo='kg'` apuntando a un ingrediente cuya `unidad_medida` ahora es `l`
     (masa vs. volumen: incompatibles por diseño, correctamente, según la regla del
     propio sistema).
  4. Cualquier `GET /items` posterior (el menú del POS, la grilla de
     `configuracion/items.vue`) dispara `calcularDisponibilidadBatch`, que arma el batch
     de conversiones de TODAS las recetas de la página e incluye la fila de Pizza/Queso.
     `convertirUnidades` intenta `0.2 kg → l`, `convertirConMapa` lanza
     `BadRequestException('No se puede convertir de masa a volumen')`. Ese throw sale de
     `convertirUnidades` sin capturarse fila por fila, sale de
     `calcularDisponibilidadBatch`, sale de `findAll`, y el controller no lo atrapa: el
     endpoint completo responde 400. Ninguna receta ni producto del tenant se puede
     listar hasta que alguien corrija manualmente la fila en la base (ni siquiera desde
     la UI de items, porque esa misma UI depende de `GET /items`).
  - Exposición secundaria con el mismo root cause: si en vez de (o además de) una receta
    hubiera una opción de grupo de modificadores apuntando al mismo ingrediente con una
    unidad ahora incompatible (`grupo_modificador_opciones.unidad_codigo` /
    `item_grupo_modificador_opciones.unidad_codigo`), el mismo throw se dispara en
    `venderOpcionesGrupos` (`items.service.ts:3019`) en el momento de una venta concreta
    — rompe esa venta puntual en vez del listado completo, pero es la misma causa raíz:
    el guard de cambio de unidad no mira nada río abajo.
- **Por qué ningún test lo caza:** `items.service.spec.ts:2521` solo cubre "cambiar
  unidad con movimientos existentes → rechazado". No hay ningún test que arme una receta
  (o una opción de grupo) contra un ingrediente sin costo/sin movimientos y después
  cambie la unidad del ingrediente a otra magnitud, ni que verifique el efecto en
  `GET /items`. `catalog.service.spec.ts` prueba `convertirUnidad`/`convertirConMapa` en
  aislamiento (correctamente), pero nada ejercita `convertirUnidades` con un lote mixto
  donde una fila es inválida y las demás no, así que el "todo o nada" del batch nunca se
  observó.
- **Confianza:** alta — el guard (líneas 1391-1418), el corto-circuito por `costo_actual
  == null` (línea 1425) y el `.map` sin aislamiento de `convertirUnidades` (líneas 77-90)
  están verificados leyendo el archivo; el `try/catch` ausente en `findAll` y en el
  controller también. Lo único que no ejecuté es el escenario end-to-end contra una base
  real (no corrí el e2e para reproducirlo) — la confianza sería total con esa
  corroboración, pero la lectura del código deja una sola interpretación posible.
