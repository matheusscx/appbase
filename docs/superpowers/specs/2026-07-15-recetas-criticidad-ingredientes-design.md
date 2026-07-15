# Diseño — Recetas + criticidad de ingredientes

**Status**: Draft
**Date**: 2026-07-15
**Owner**: Cesar Matheus
**Cluster**: Recetas/costos food-service — **pieza 3 de 5** (ver
[análisis de alineamiento](./2026-07-14-alineamiento-cliente-foodservice-analisis.md))

## Context

El cliente food-service vende productos compuestos (ej. una hamburguesa) que al venderse
deben descontar stock de sus insumos (pan, carne, queso, salsa), no tener stock propio.
Hoy `items.tipo` solo admite `'producto'` (con stock propio) | `'servicio'` |
`'suscripcion'`; no existe el concepto de producto compuesto.

Caso de referencia del cliente: una hamburguesa donde pan y carne son **bloqueantes** (sin
stock de cualquiera de los dos, no se puede vender) y queso/salsa son **no bloqueantes**
(si faltan, la venta sigue igual, sin ese insumo). Los insumos se compran en una unidad
(ej. carne en `kg`) y la receta los consume en otra (ej. `150 g`) — la conversión ya la
resuelve la pieza 2 (`CatalogService.convertirUnidad`), que esta pieza reutiliza sin
cambios.

Esta pieza depende de las dos piezas anteriores del cluster, ya implementadas:
**costo por producto** (`item_producto.costo_actual`) y **motor de conversión de
unidades** (`unidades_medida` + `CatalogService`).

## Scope

**Incluido:**
- Nuevo `items.tipo = 'receta'`, extensión 1:1 `item_receta` (sin stock propio).
- Tabla `receta_ingredientes`: N ingredientes por receta, cada uno con cantidad, unidad y
  flag `bloqueante`.
- Costo de receta cacheado en `item_receta.costo_actual`, calculado al crear/editar la
  receta o su lista de ingredientes — **nunca se recalcula automáticamente** por un
  cambio de costo en un ingrediente.
- Venta de una receta: expande la línea en N movimientos de inventario (uno por
  ingrediente, convertidos a la unidad base de cada ingrediente), dentro de la misma
  transacción de la venta.
- Ingrediente bloqueante sin stock suficiente → la venta completa se rechaza.
- Ingrediente no bloqueante sin stock suficiente → se omite su descuento (no va a
  negativo) y la venta devuelve una advertencia no persistida.
- Disponibilidad calculada al vuelo en el listado (`GET /items?tipo=receta`): mínimo,
  entre los ingredientes bloqueantes, de `stock convertido / cantidad por receta`.
- Frontend: `items.vue` gana el tipo `receta` con editor de ingredientes; `pos.vue` lista
  recetas junto a productos y muestra la disponibilidad calculada.

**NO incluido (documentado en el análisis de alineamiento como ideas separadas):**
- Recetas anidadas (una receta como ingrediente de otra) — YAGNI, el cliente no lo pidió.
- Personalización de ingredientes por pedido (agregar/quitar al tomar la orden) — capacidad
  de mayor alcance, toca la captura de la línea de venta, no el motor de recetas.
- Detección de desfase de costo + modal "este ingrediente cambió de precio, aplicar a estas
  recetas" — es la **pieza 5 (simulador de impacto de costos)**, que depende de esta pieza
  y se diseña completa cuando le toque el turno.
- Ingredientes en modo `serie`/`lote` — requeriría una estrategia de selección automática
  (qué unidad serializada o qué lote consumir) fuera de alcance; solo `modo_inventario =
  'cantidad'`.

## Decisions

| Decisión | Elección | Razón |
|---|---|---|
| Modelado de la receta | **Nuevo `items.tipo = 'receta'`**, no un modo de `item_producto` | Consistente con la regla existente "solo `tipo='producto'` tiene stock" — la receta nunca tiene stock propio, mezclar el concepto en `modo_inventario` (que hoy es un eje de *cómo se cuenta* el stock propio) confundiría dos cosas distintas |
| Costo de receta | **Cacheado en `item_receta.costo_actual`, sin auto-recálculo** | El cliente no quiere que el costo cambie solo; un cambio de costo en un ingrediente debe pasar por una decisión explícita del usuario (pieza 5), no un cascade silencioso |
| Ingrediente bloqueante sin stock | **Rechaza la venta completa**, reusando la validación existente de `registrarMovimiento` ("salida no negativa") | Todo corre en la misma transacción de la venta; dejar que la validación existente lance el error aborta la venta gratis, sin código nuevo de validación de stock |
| Ingrediente no bloqueante sin stock | **Se omite el movimiento** (no va a negativo) + advertencia en la respuesta | Evita un stock negativo "fantasma" de un insumo secundario; la advertencia no persistida es suficiente porque es accionable solo en el momento de la venta (el cajero necesita saberlo ahora, no en un reporte después) |
| Recetas anidadas | **No permitidas** — un ingrediente siempre es `tipo='producto'` | Evita ciclos y costeo/consumo recursivo; el cliente no lo pidió |
| Ingredientes en modo serie/lote | **Rechazados** — solo `modo_inventario='cantidad'` | Automatizar qué lote (FIFO/vencimiento) o qué unidad serializada consumir es un problema propio, no forma parte de "receta descuenta ingredientes" |
| Disponibilidad en el listado | **Calculada al vuelo**, sin columna cacheada | Coherente con la filosofía de "costo al vuelo" de la pieza 2 salvo por el costo de receta (que es cacheado por pedido explícito del cliente); evita otra invalidación de caché |
| Borrado de un ingrediente en uso | **Bloqueado** si está referenciado por una receta activa (`eliminado_el IS NULL`) | Evita recetas rotas silenciosamente; consistente con el resto del sistema, donde el soft delete nunca corrompe referencias vivas |

## Backend

### Modelo de datos

**`item_receta`** (extensión 1:1, mismo patrón que `item_producto`/`item_servicio`):

| Columna | Tipo | Notas |
|---|---|---|
| `item_id` | `UUID` PK, FK `items` | `type: 'uuid'` explícito (ADR-004) |
| `costo_actual` | `NUMERIC(18,4)` | Cacheado; ver Decisions |

**`receta_ingredientes`** (N ingredientes por receta):

| Columna | Tipo | Notas |
|---|---|---|
| `receta_ingrediente_id` | `UUID` PK | |
| `tenant_id` | `UUID` NOT NULL, FK `tenants` | Filtro obligatorio en toda query (regla transversal) |
| `receta_item_id` | `UUID` NOT NULL, FK `items` | Debe ser un item `tipo='receta'` |
| `ingrediente_item_id` | `UUID` NOT NULL, FK `items` | Debe ser un item `tipo='producto'`, `modo_inventario='cantidad'` |
| `cantidad` | `NUMERIC(18,4)` NOT NULL | Cantidad por **1 unidad** de la receta |
| `unidad_codigo` | `TEXT` NOT NULL, FK `unidades_medida.codigo` | Unidad en la que se expresa `cantidad` (debe ser de la misma magnitud que la unidad base del ingrediente — mismo `convertirUnidad` que valida esto hoy) |
| `bloqueante` | `BOOLEAN` NOT NULL DEFAULT true | |
| `creado_el` / `actualizado_el` / `eliminado_el` | `TIMESTAMPTZ` | Convención transversal |

Ambas tablas van en `backend/src/modules/items/entities/` (`item-receta.entity.ts`,
`receta-ingrediente.entity.ts`), registradas en `items.module.ts` junto a las entidades
existentes — mismo patrón que `ItemServicio`/`ItemSuscripcion`.

### Validaciones al crear/editar una receta

En `ItemsService`, junto a la rama `dto.tipo === 'producto' | 'servicio'` ya existente
(`items.service.ts:260,320`), nueva rama `dto.tipo === 'receta'`:

1. `ingredientes` no puede venir vacío.
2. Cada `ingredienteItemId` debe existir, pertenecer al tenant, ser `tipo='producto'` y
   `modo_inventario='cantidad'` → si no, `BadRequest`.
3. `unidadCodigo` de cada línea se valida contra el catálogo y su magnitud debe coincidir
   con la magnitud de la unidad base del ingrediente (mismo chequeo que ya hace
   `CatalogService.convertirUnidad` al lanzar cross-magnitud) → `BadRequest` si no.
4. Costo de la receta = `Σ (costo_actual del ingrediente convertido a su unidad base ×
   cantidad convertida a esa unidad base)`, calculado con Decimal.js, guardado en
   `item_receta.costo_actual`.
5. Editar la lista de ingredientes de una receta existente recalcula el costo cacheado en
   el momento (mismo punto 4) — pero **no** dispara nada sobre otras recetas ni sobre el
   ingrediente.

Borrado de un item `tipo='producto'`: se agrega el chequeo de que no exista una fila viva
en `receta_ingredientes` con `ingrediente_item_id = item.id` antes de permitir el soft
delete → `BadRequest` con el nombre de la(s) receta(s) que lo usan.

### Venta de una receta

En `VentasService.crearVenta`, el loop de movimientos de inventario
(`ventas.service.ts:308-323`, hoy `if (item.tipo !== 'producto') continue;`) gana una
rama nueva antes del `continue`:

```
if (item.tipo === 'receta') {
  const ingredientes = await obtenerIngredientes(item.id); // con tenant_id
  for (const ing of ingredientes) {
    const cantidadConvertida = convertirUnidad(
      ing.cantidad.mul(linea.cantidad), ing.unidadCodigo, ing.ingrediente.unidadMedida,
    );
    if (ing.bloqueante) {
      // deja que registrarMovimiento valide "salida no negativa" y aborte la venta
      await this.inventarioService.registrarMovimiento(manager, {
        tenantId, itemId: ing.ingredienteItemId, tipo: 'salida', motivo: 'venta',
        cantidad: cantidadConvertida, usuarioId, ventaId: venta.id,
      });
    } else {
      const stockActual = await obtenerStock(ing.ingredienteItemId); // dentro de la tx
      if (stockActual.gte(cantidadConvertida)) {
        await this.inventarioService.registrarMovimiento(manager, { /* igual */ });
      } else {
        advertenciasReceta.push(
          `${item.nombre}: no había stock suficiente de ${ing.ingrediente.nombre}, se vendió sin ese insumo`,
        );
      }
    }
  }
  continue; // la receta en sí no tiene movimiento propio
}
```

- El motivo del movimiento sigue siendo `'venta'` (sin cambios en el enum de
  `movimientos_inventario.motivo`); el `ventaId` ya conecta cada movimiento de ingrediente
  con la venta que lo originó.
- `advertenciasReceta: string[]` se agrega a la respuesta de `POST /ventas` — **no se
  persiste** (ver Decisions).
- No se pre-valida stock de ingredientes bloqueantes por separado: si
  `registrarMovimiento` lanza por stock insuficiente, la transacción completa de la venta
  hace rollback (comportamiento ya existente, gratis).

### Disponibilidad en el listado

`GET /items?tipo=receta` (y el `tipo=producto,receta` combinado que usará el POS) agrega
un campo calculado `disponible: number | null` por receta:

- `null` si la receta no tiene ingredientes bloqueantes (no aplica límite).
- Si no, `Math.floor(min sobre ingredientes bloqueantes de (stockIngredienteConvertido /
  cantidadPorReceta))`, calculado con Decimal.js y redondeo hacia abajo con `.floor()`.
- Se calcula en `ItemsService` al listar (no hay columna ni caché), igual que hoy se
  calculan otros campos derivados de la respuesta de items.

### Cambios de API

- `CreateItemDto` / `UpdateItemDto`: `tipo` admite `'receta'`; nuevo array
  `ingredientes?: RecetaIngredienteInputDto[]` (`ingredienteItemId`, `cantidad`,
  `unidadCodigo`, `bloqueante`), mismo patrón que `series?: SerieInputDto[]`
  (`create-item.dto.ts:17-30,101-106`).
- Respuesta de items: recetas incluyen `ingredientes` (con nombre del ingrediente
  resuelto) y `costoActual`; en el listado además `disponible`.
- `POST /ventas`: la respuesta gana `advertenciasReceta?: string[]`.

## Frontend

- **Form de item** (`items.vue`): el selector de `tipo` gana la opción `receta`. Al
  elegirla, el form muestra un editor de filas de ingredientes — mismo patrón visual que
  ya existe para impuestos/descuentos/recargos (N:M sobre un item): buscador de item
  filtrado a `tipo=producto`, input de cantidad, selector de unidad (reusa el componente
  de la pieza 2, limitado a la magnitud de la unidad base del ingrediente elegido), toggle
  bloqueante por fila. Muestra el costo calculado de la receta (solo lectura) a medida que
  se arman los ingredientes.
- **POS** (`pos.vue`): el fetch de catálogo (`pos.vue:98`, hoy `?tipo=producto`) pasa a
  incluir recetas. Cada card de receta muestra `disponible` cuando no es `null` (ej. "8
  disponibles"); si es `0`, se deshabilita visualmente pero no se bloquea el click (la
  venta puede seguir intentándose — la validación real vive en el backend, esto es solo
  UX informativa, evita una fuente de verdad duplicada en el frontend).
- Si la venta responde con `advertenciasReceta`, el toast de confirmación de venta las
  muestra junto al mensaje de éxito.
- Tokens semánticos de Nuxt UI, sin Tailwind hardcodeado.

## Verification

### Unit
- `items.service.spec.ts`: crear receta con ingredientes válidos calcula `costoActual`
  correctamente (Decimal.js, conversión de unidades incluida); ingrediente inexistente o
  de `tipo!='producto'` → `BadRequest`; ingrediente en modo serie/lote → `BadRequest`;
  unidad de magnitud incorrecta → `BadRequest`; editar ingredientes recalcula el costo sin
  tocar otras recetas; borrar un producto usado como ingrediente → `BadRequest`.
- `ventas.service.spec.ts`: vender una receta genera un movimiento de salida por
  ingrediente con la cantidad convertida; ingrediente bloqueante sin stock aborta toda la
  venta (rollback, ningún movimiento persiste); ingrediente no bloqueante sin stock omite
  su movimiento y agrega la advertencia; receta sin ingredientes bloqueantes nunca aborta
  la venta.

### E2E (`recetas.e2e-spec.ts` nuevo)
1. Crear receta "Hamburguesa" con pan (bloqueante, 1 unidad), carne (bloqueante, 150 g,
   insumo en kg), queso (no bloqueante, 20 g) → costo calculado correcto.
2. Vender 1 hamburguesa con stock suficiente de todo → 3 movimientos de salida (pan,
   carne, queso) con las cantidades convertidas correctas; stock de la hamburguesa (no
   existe) no se toca.
3. Vender con carne insuficiente (bloqueante) → venta rechazada, `0` movimientos nuevos en
   el kardex de ningún ingrediente de esa venta.
4. Vender con queso insuficiente (no bloqueante) → venta se confirma, sin movimiento de
   queso, `advertenciasReceta` incluye el aviso, pan y carne sí se descuentan.
5. `GET /items?tipo=receta` refleja `disponible` correcto según el stock de pan/carne.
6. Intentar borrar "carne" mientras la receta la usa → `BadRequest`.

### Manual
- Swagger: crear receta vía `POST /items`, vender vía `POST /ventas`.
- Frontend: armar la hamburguesa en el form de items, venderla en el POS con y sin stock
  de queso, ver la advertencia y el `disponible` del listado bajar tras la venta.

## Open questions

- ¿El cliente quiere ver el margen (precio venta − costo receta) en algún reporte ya en
  esta pieza, o eso espera a un reporte dedicado? No bloquea esta pieza — el dato
  (`precioBase` del item, `costoActual` de la receta) ya queda disponible para cuando se
  necesite.
