# Design: Cantidad con unidad de presentación en carrito (POS / Salones / Online)

**Status:** Done  
**Date:** 2026-07-16  
**Owner:** Product / Engineering

---

## Context

Hoy las líneas de carrito/cuenta usan un `UInput` de cantidad (string decimal) sin botones ± y sin selector de unidad. La cantidad se interpreta siempre en la unidad base del ítem (`item.unidadMedida`).

El operador necesita:

1. Controles **− / input / +** en POS, Salones y Online.
2. Que la cantidad respete la **magnitud** de la unidad (conteo = enteros; masa/volumen/longitud = decimales).
3. Poder vender en una unidad de la misma magnitud distinta a la base (ej. producto en `kg` → cargar `500 g`), y que boleta/comanda/historial muestren **500 g**, no `0,5 kg`.

Ya existe el catálogo global `unidades_medida` (`magnitud`, `factorBase`) y `CatalogService.convertirUnidad` (misma magnitud). Reusar ese motor; no hardcodear solo kg/g y L/ml.

---

## Goals

- Control de cantidad transversal (POS, Salones, Online) con ± y, cuando aplique, selector de unidad.
- Separar **cantidad canónica** (precio, stock, inventario) de **cantidad + unidad de presentación** (UI, tickets, auditoría).
- Persistencia de la presentación elegida en `cuenta_lineas` y `venta_detalles`.
- Compatibilidad con líneas antiguas (sin presentación → unidad base + cantidad canónica).

## Non-goals

- Conversión cross-magnitud (L ↔ kg).
- Cambiar la unidad base del producto al vender.
- Editar personalización de recetas al cambiar cantidad.
- Persistir carrito POS en localStorage.
- Densidades o unidades custom por ítem fuera del catálogo global.

---

## Modelo de datos

### Dos representaciones por línea

| Campo | Rol |
|-------|-----|
| `cantidad` | Canónica, en unidad base del ítem. Precio, stock, kardex, motor de cálculo. |
| `cantidadPresentacion` | Lo que ve/escribe el operador. |
| `unidadCodigoPresentacion` | Código del catálogo (`g`, `kg`, `ml`, …). Misma magnitud que la unidad base. |

Ejemplo: producto base `kg`, precio $10.000/kg, operador elige `500 g`:

- `cantidad` = `"0.5000"`
- `cantidadPresentacion` = `"500"`
- `unidadCodigoPresentacion` = `"g"`
- Precio unitario mostrado: **$10.000/kg** (unidad base).
- Subtotal: $5.000.

### Persistencia

**`cuenta_lineas`** (nuevas columnas):

| Columna | Tipo | Notes |
|---------|------|-------|
| `cantidad_presentacion` | NUMERIC(18,4) NULL | NULL = legado |
| `unidad_codigo_presentacion` | TEXT NULL FK → `unidades_medida(codigo)` | NULL = legado |

**`venta_detalles`** (iguales):

| Columna | Tipo | Notes |
|---------|------|-------|
| `cantidad_presentacion` | NUMERIC(18,4) NULL | |
| `unidad_codigo_presentacion` | TEXT NULL FK → `unidades_medida(codigo)` | |

Actualizar `startup-pos.sql` (fuente de esquema) + entidades TypeORM. El stack de desarrollo sincroniza desde entidades; el SQL documenta el contrato.

### Compatibilidad

Si `unidad_codigo_presentacion` IS NULL:

- Presentación = `cantidad` + `item.unidad_medida`.
- Tickets/historial se comportan como hoy.

### Reglas de validación (backend)

1. `cantidad` > 0.
2. Si se envía presentación: ambos campos obligatorios juntos.
3. `unidadCodigoPresentacion` ∈ catálogo y misma magnitud que unidad base del ítem.
4. Magnitud `conteo`: `cantidadPresentacion` debe ser entero ≥ 1 (y la canónica también entera).
5. Magnitudes continuas: presentación > 0; convertir a base con `convertirUnidad`; si el resultado redondeado a 4 decimales es 0 → `BadRequest`.
6. El servidor **recalcula** `cantidad` desde presentación; no confía en la canónica del cliente cuando hay presentación.
7. Recetas (`tipo='receta'`): solo conteo (enteros); sin selector de unidad (o selector fijo a “unidad”).

---

## API

### Entrada de línea (ventas / salones / online)

Extender DTOs de **persistencia / venta** (no el motor de cálculo):

- `LineaVentaDto`
- `AddLineaDto` / `UpdateLineaDto`

Campos opcionales (van juntos o ninguno):

```ts
cantidadPresentacion?: string
unidadCodigoPresentacion?: string
```

**Decisión fija:** `CalcularVentaDto` / motor de precios recibe **solo** `cantidad` canónica. El front convierte antes de `calcular`. La presentación viaja al crear/actualizar líneas de cuenta y al crear la venta; se congela en `venta_detalles`.

### Respuestas

- `CuentaLineaDetalle` y detalle de venta incluyen ambos campos (o `null`).
- Al cerrar cuenta: mapear presentación a `CreateVentaDto.lineas`.

### Online

`CheckoutSnapshot.lineas` y `POST /online/pagar` incluyen presentación para materializar `venta_detalles` con la unidad elegida. El cálculo previo al pago usa canónica.

---

## Frontend

### Componente `AppCantidadInput`

Props principales:

- `modelValue` / emit: presentación (`cantidadPresentacion` string).
- `unidadCodigo` / emit: unidad de presentación.
- `unidadBaseCodigo`: unidad del ítem (para filtrar opciones y precio).
- `disabled?`

Comportamiento:

- `UInputNumber` con ± horizontales.
- Selector de unidad: todas las unidades del catálogo con la **misma magnitud** que `unidadBaseCodigo` (`useUnidadesMedidaStore`).
- Conteo: enteros, `min=1`, sin selector (o un solo ítem).
- Continua: decimales; `min` efectivo > 0; el botón − no lleva a ≤ 0 (deshabilitado si restar `step` ≤ 0).
- **Step**: 1 en la unidad visible (en `g`, + suma 1 g; en `kg`, + suma 1 kg).
- Al cambiar unidad en el selector: convertir el valor visible (ej. `0.5 kg` → `500 g`) vía factores del store / helper puro; no mutar precio base.
- Precio en UI de línea: siempre “c/u” en unidad base; subtotal = f(canónica).

### Helpers puros (testeables)

Ej. `frontend/app/utils/cantidad-presentacion.ts` (o composable puro):

- `opcionesMismaMagnitud(base, catalog)`
- `convertirPresentacion(cantidad, desde, hacia, catalog)`
- `aCantidadCanonica(presentacion, unidadPres, unidadBase, catalog)`
- `desdeCantidadCanonica(canonica, unidadBase, unidadPres, catalog)`
- `puedeDecrementar(presentacion, unidadPres, catalog)` — conteo: no bajar de 1; continua: no bajar a ≤ 0.

### Integración por canal

| Canal | Dónde | Persistencia |
|-------|--------|--------------|
| POS | `CarritoPanel.vue` | Memoria `CarritoLinea` + body `POST /ventas` |
| Online | `CarritoOnline.vue` | `useTiendaCarrito` / `useState` + pagar |
| Salones | líneas en `salones/index.vue` | PATCH/POST con debounce por línea + disable durante request |

### `CarritoLinea` / cuenta

```ts
cantidad: string // canónica
cantidadPresentacion?: string
unidadCodigoPresentacion?: string
```

Al agregar desde catálogo: presentación = `1` en unidad base (conteo) o `1` en unidad base (continua).

**Merge al re-agregar el mismo ítem** (misma personalización): sumar en canónica (+1 unidad base) y **reescribir** presentación en la unidad actualmente visible de esa línea (ej. línea en `g` con 500 → al sumar 1 kg queda 1500 g).

Papelera: única forma de eliminar (no borrar con −).

### Salones: concurrencia

- Update optimista de presentación/canónica en el `ref` local.
- Debounce ~300 ms por `lineaId` antes del PATCH.
- Mientras hay request in-flight de esa línea: control disabled.
- Error: restaurar última respuesta del servidor + toast existente.
- Cobrar / enviar comanda: flush o esperar pendientes (no enviar cantidad stale).

### Impresión / UI historial

- Tickets (`TicketItem`): cantidad formateada con unidad de presentación (`500 g`).
- `VentaDetalleDrawer`, listados: mostrar presentación si existe.

---

## Backend (servicios)

1. Al agregar/actualizar línea de cuenta o crear venta: validar + convertir → setear `cantidad` canónica y columnas de presentación.
2. `cuenta_lineas.cantidad_enviada` sigue en **unidad canónica** (diff de comanda no cambia de semántica).
3. `venderIngredientesReceta` / stock producto: usar solo `cantidad` canónica.
4. Payloads de impresión / comanda: cantidad visible = presentación si existe.
5. Soft-delete y timestamps sin cambio.

---

## Testing

### Unit FE

- Conversión kg↔g, L↔ml; conteo rechaza 0.5.
- ± en unidad visible; − no cruza a ≤0 / no baja de 1 en conteo.
- Cambio de selector preserva magnitud física.
- Merge re-agregar convierte a presentación actual.

### Unit BE

- DTOs + `resolver`/`convertir`: presentación → canónica.
- Cross-magnitud → 400.
- Conteo decimal → 400.
- Legado sin presentación sigue funcionando.
- Persistencia en cuenta y venta_detalle.

### Integración / specs existentes

- Actualizar specs de ventas, salones, online que asumen solo `cantidad`.
- Ticket-builder: cantidad con unidad.

---

## Documentation (mismo commit que código)

- `docs/features/ventas.md`, salones, tienda online (si existe), impresion-termica si aplica.
- `docs/ESTADO.md` fila/estado.
- `startup-pos.sql` + ADR solo si se considera decisión estructural nueva (opcional: referenciar motor de unidades ADR/spec 2026-07-14).

---

## Acceptance criteria

- [ ] POS, Salones y Online muestran − / cantidad / + en todas las líneas (productos y recetas).
- [ ] Conteo: solo enteros; − no elimina la línea (mínimo 1).
- [ ] Masas/volumenes/longitud: selector con todas las unidades de la misma magnitud.
- [ ] 500 g de producto en kg se cobra como 0.5 kg y se imprime/audita como 500 g.
- [ ] Precio unitario se muestra en unidad base.
- [ ] Stock e inventario usan cantidad canónica.
- [ ] Líneas legacy sin presentación no rompen.
- [ ] Tests FE/BE verdes; docs actualizados.

---

## Open points resolved in brainstorming

| Tema | Decisión |
|------|----------|
| Alcance líneas | Todas (productos + recetas) |
| − en mínimo | No elimina; papelera aparte |
| Decimales | Según magnitud; step ±1 en unidad visible |
| UI unidad | Selector junto al control |
| Tickets | Mostrar unidad elegida |
| Catálogo | Toda la magnitud |
| Precio | Mostrar c/u en unidad base |

---

## Related

- [`2026-07-14-motor-conversion-unidades-design.md`](./2026-07-14-motor-conversion-unidades-design.md)
- [`2026-07-16-edicion-recetas-antes-carrito-design.md`](./2026-07-16-edicion-recetas-antes-carrito-design.md)
- Features: ventas, gestión-cajas/salones, inventarios, impresión térmica
