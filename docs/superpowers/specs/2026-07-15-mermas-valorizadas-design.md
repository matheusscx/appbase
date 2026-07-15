# Diseño — Mermas tipificadas y valorizadas

**Status**: Approved
**Date**: 2026-07-15
**Owner**: Cesar Matheus
**Cluster**: Recetas/costos food-service — **pieza 4 de 5** (ver
[análisis de alineamiento](./2026-07-14-alineamiento-cliente-foodservice-analisis.md))

## Context

El cliente food-service necesita registrar mermas de insumos con **causa tipificada** y
ver el **impacto financiero** (costo perdido), no solo un movimiento anónimo en el kardex.

Hoy existe la base mínima:
- `motivo='merma'` en `movimientos_inventario` vía ajuste de stock genérico.
- Conversión de unidades (pieza 2) y `costo_unitario` congelado en salidas (pieza 1).

Lo que falta: tipificación por causa, UX dedicada, y tratar el valorizado como dato de
primera clase en el listado (`cantidad × costo_unitario`). El ajuste genérico de stock
no debe seguir ofreciendo “Merma” sin causa.

Esta pieza depende de **costo por producto** y **conversión de unidades** (ya
implementadas). No depende de recetas para el registro de merma (se merma un
`producto`), aunque en food-service las mermas serán sobre insumos de recetas.

## Scope

**Incluido:**
- Tabla `causas_merma` **por tenant**, con CRUD para el administrador.
- Causas **por defecto del sistema** (`es_fijo=true`): no se editan ni se borran.
  Defaults: `Vencimiento`, `Deterioro`, `Robo`, `Error operativo`, `Otro`.
- Semilla de causas fijas al **crear un tenant** (mismo patrón que el rol admin fijo)
  y en el seeder de desarrollo (Paris).
- Columna nullable `causa_merma_id` en `movimientos_inventario`.
- Endpoint dedicado `POST /mermas` (producto + cantidad + unidad opcional + causa +
  comentario opcional + `costoUnitario` opcional/condicional).
- Listado `GET /mermas` con `costoPerdido` calculado al vuelo.
- CRUD `GET/POST/PATCH/DELETE /causas-merma`.
- Quitar `'merma'` del ajuste de stock genérico (`AjusteStockDto` + UI del modal).
- Frontend: pantalla de causas (config) + pantalla de mermas (operación) con modal
  informativo cuando el producto no tiene `costo_actual`.
- En kardex, movimientos `motivo=merma` muestran causa y costo perdido cuando aplique.

**NO incluido:**
- Adjuntos / fotos de evidencia.
- Exigir lote/serie al mermar (sigue la selección automática actual del kardex si el
  producto es serie/lote; no se pide en el formulario dedicado).
- Reportes/dashboards avanzados (solo listado filtrable).
- Asientos contables / integración externa.
- Simulador de impacto de costos (pieza 5).

## Decisions

| Decisión | Elección | Razón |
|---|---|---|
| Modelado | **FK `causa_merma_id` en el kardex** + tabla `causas_merma` | Reusa movimiento + `costo_unitario` ya congelado; mismo patrón que `venta_id` opcional en el movimiento. Sin cabecera `mermas` duplicada (YAGNI) |
| Causas | **Por tenant + defaults fijos (`es_fijo`)** | El admin configura su catálogo; el sistema garantiza un mínimo común inmutable |
| Registro | **Solo flujo dedicado** (`POST /mermas`) | Obliga causa tipificada; evita mermas “huérfanas” desde el ajuste genérico |
| Producto sin `costo_actual` | **Exige `costoUnitario` puntual** + modal informativo; **no** actualiza `costo_actual` | Permite operar y valorizar sin forzar corregir el maestro; respeta la regla de que solo una compra actualiza el costo vigente |
| Producto con `costo_actual` | Campo prellenado **editable** | Congela el valor elegido en el movimiento (como hoy); no pisa `costo_actual` salvo que en el futuro se decida otra regla — aquí la merma **nunca** actualiza `costo_actual` |
| Valorizado | **Calculado al leer**: `cantidad × costo_unitario` | Evita otra columna cacheada; fuente de verdad = kardex |
| Soft-delete causa custom en uso | **Bloqueado** | Evita romper historial tipificado; mismos criterios que ingredientes en recetas |

## Backend

### Modelo de datos

**`causas_merma`:**

| Columna | Tipo | Notas |
|---|---|---|
| `causa_merma_id` | UUID PK | `type: 'uuid'` (ADR-004) |
| `tenant_id` | UUID FK tenants | |
| `nombre` | TEXT NOT NULL | Único vivo por tenant (índice parcial) |
| `activo` | BOOLEAN NOT NULL DEFAULT true | Desactivar sin borrar |
| `es_fijo` | BOOLEAN NOT NULL DEFAULT false | Defaults del sistema |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete |

Índice único parcial sugerido: `(tenant_id, lower(nombre)) WHERE eliminado_el IS NULL`.

**`movimientos_inventario`** — columna nueva:

| Columna | Tipo | Notas |
|---|---|---|
| `causa_merma_id` | UUID NULL FK → `causas_merma` | Obligatoria iff `motivo='merma'` |

### API

**Causas**
- `GET /api/causas-merma` — lista del tenant (activas y/o todas según query).
- `POST /api/causas-merma` — `{ nombre, activo? }` → `es_fijo=false`.
- `PATCH /api/causas-merma/:id` — rechaza si `es_fijo`.
- `DELETE /api/causas-merma/:id` — soft delete; rechaza si `es_fijo` o si hay movimientos con esa causa.

**Mermas**
- `POST /api/mermas`
  ```json
  {
    "itemId": "<uuid>",
    "cantidad": "250",
    "unidadCodigo": "g",
    "causaMermaId": "<uuid>",
    "comentario": "optional",
    "costoUnitario": "8000"
  }
  ```
  - Valida item producto del tenant; causa activa del tenant.
  - Convierte cantidad a unidad base si `unidadCodigo` ≠ base (`CatalogService`).
  - Transacción: `InventarioService.registrarMovimiento` con
    `tipo='salida'`, `motivo='merma'`, `causaMermaId`, `costoUnitario?`.
  - Reglas de costo:
    - Si hay `costo_actual` y no envían `costoUnitario` → congela el vigente.
    - Si no hay `costo_actual` → exige `costoUnitario > 0`; congela solo en el
      movimiento; **nunca** actualiza `item_producto.costo_actual` (aunque envíen
      costo — la merma no es compra).
  - Response incluye `costoPerdido` (= `cantidad × costo_unitario` o `null`).

- `GET /api/mermas` — paginado; filtros `itemId`, `causaMermaId`, `desde`, `hasta`.
  Cada fila: datos del movimiento + `causaNombre` + `costoPerdido`.

**Cambios de endurecimiento**
- `AjusteStockDto`: quitar `'merma'` del enum de motivos.
- `registrarMovimiento`:
  - si `motivo === 'merma'` → exigir `causaMermaId` válida;
  - si `motivo !== 'merma'` y viene `causaMermaId` → `400`.
- Al crear tenant: insertar las 5 causas fijas (`es_fijo=true`).

### Key modules

- Nuevo módulo Nest `mermas` (controller/service/entities DTOs) o split
  `causas-merma` + handler de registro en el mismo módulo — una feature module.
- Reusa `InventarioService` y `CatalogService` (sin duplicar conversión/stock).

## Frontend

### Configuración — Causas de merma
- Página CRUD con tokens semánticos Nuxt UI.
- Badge “Fija” en filas `es_fijo`; sin acciones de editar/borrar en esas filas.

### Operación — Mermas
- Listado filtrable con `costoPerdido` formateado (`formatMonto`).
- Drawer “Registrar merma”: producto, cantidad, unidad, causa, comentario, costo unitario.
- Sin `costo_actual` en el producto: modal informativo obligatorio de lectura antes de
  continuar (“costo solo para esta merma; no actualiza el costo del producto”); campo
  costo unitario requerido.
- Con `costo_actual`: prellenar editable.

### Ajuste de stock / kardex
- Quitar opción Merma del modal de ajuste en items.
- En listado de movimientos, si `motivo=merma`: mostrar causa y costo perdido.

## Data flow — Registrar merma

```
[Usuario abre Operación → Mermas → Registrar]
  ↓ elige producto / cantidad / unidad / causa
  ↓ si !costo_actual → modal informativo → ingresa costoUnitario
  ↓ POST /api/mermas
[MermasService valida causa + item]
  ↓ convierte unidad si aplica
  ↓ transaction → InventarioService.registrarMovimiento(salida, merma, causa, costo?)
[Kardex + stock actualizados; costo_actual del producto NO cambia]
  ↓ response con costoPerdido
[UI refresca listado]
```

## Testing

### Unit
- Causas: create custom; reject patch/delete de fija; reject delete en uso.
- `POST /mermas`: feliz path con conversión; exige costo si no hay `costo_actual`;
  con `costo_actual` congela vigente; nunca actualiza `costo_actual` en merma.
- Ajuste stock: rechaza `motivo=merma`.

### E2E
- Crear causa custom → registrar merma → listado con `costoPerdido` → intentar
  merma vía ajuste de stock → 400.

## Verification (aceptación)

- [ ] Admin puede CRUD causas custom; no puede editar/borrar fijas.
- [ ] Registrar merma tipificada descuenta stock y congela costo en el movimiento.
- [ ] Producto sin costo: modal + `costoUnitario` obligatorio; producto no cambia de costo.
- [ ] Listado muestra valorizado; kardex muestra causa en mermas.
- [ ] El ajuste genérico ya no ofrece ni acepta `merma`.

## Related

- [costo-producto-kardex-design.md](./2026-07-14-costo-producto-kardex-design.md) — pieza 1
- [motor-conversion-unidades-design.md](./2026-07-14-motor-conversion-unidades-design.md) — pieza 2
- [recetas-criticidad-ingredientes-design.md](./2026-07-15-recetas-criticidad-ingredientes-design.md) — pieza 3
- [alineamiento-cliente-foodservice-analisis.md](./2026-07-14-alineamiento-cliente-foodservice-analisis.md) — cluster
