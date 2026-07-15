# Feature: Gestión de Inventario (Kardex de Movimientos de Stock)

**Status**: Complete  
**Owner**: SDD Team  
**Last Updated**: 2026-06-23

---

## Overview

### What is it?

Un sistema de trazabilidad auditable para todos los cambios de stock en items de tipo **producto**. Cada movimiento de inventario (entrada, salida, ajuste) queda registrado en un kardex (`movimientos_inventario`) con su tipo, motivo, cantidad, usuario y saldo resultante. El stock materializado (`item_producto.stock`) se mantiene sincronizado con el kardex mediante transacciones DB, garantizando consistencia.

### Why does it exist?

El stock de productos es un activo crítico: cambios sin trazabilidad generan mermas ocultas, complicaciones en auditorías fiscales y dificultades para localizar discrepancias. El kardex es la fuente de verdad auditable; el saldo en `item_producto` es un cache materializado para lectura rápida y alertas.

### Scope

**Included in this version:**
- Registro de movimientos `entrada`/`salida` con motivos (`compra`, `venta`, `devolucion`, `merma`, `ajuste_manual`, `inventario_inicial`)
- Endpoint `GET /inventario/movimientos` con filtros por item, motivo y rango de fechas
- Endpoint `PATCH /items/:id/stock` actualizado para registrar motivo + comentario
- Creación automática de movimiento `inventario_inicial` al crear un producto con stock > 0
- Integración con ventas: cada línea vendida genera `salida`/`motivo='venta'` de forma automática (transacción única)
- Vistas: modal "Historial" en `/configuracion/items` + página global `/configuracion/inventario`
- Validación: `salida` rechaza movimientos que resultarían en stock negativo

**NOT included (future):**
- Tipo `'ajuste'` (recuento absoluto de inventario — reservado para fase posterior)
- Bodegas / almacenes y stock por bodega
- Traspasos entre bodegas
- Costeo y valoración de inventario (FIFO, promedio)
- Integración con proveedores externos de inventario

---

## API Endpoints

### GET /inventario/movimientos

Lista todos los movimientos de inventario del tenant actual, con opciones de filtro.

```
GET /api/inventario/movimientos?itemId=<uuid>&motivo=<string>&desde=<ISO-8601>&hasta=<ISO-8601>&skip=0&take=50

Authorization: Bearer <token>

Response (200):
{
  "data": [
    {
      "movimiento_id": "uuid",
      "item_id": "uuid",
      "item_nombre": "Smartphone XYZ",
      "tipo": "entrada",
      "motivo": "compra",
      "cantidad": 10,
      "stock_anterior": 15,
      "stock_resultante": 25,
      "usuario_nombre": "Juan Admin",
      "comentario": "Reorden semanal",
      "venta_id": null,
      "creado_el": "2026-06-23T14:30:00Z",
      "actualizado_el": "2026-06-23T14:30:00Z"
    },
    {
      "movimiento_id": "uuid",
      "item_id": "uuid",
      "item_nombre": "Smartphone XYZ",
      "tipo": "salida",
      "motivo": "venta",
      "cantidad": 1,
      "stock_anterior": 25,
      "stock_resultante": 24,
      "usuario_nombre": "Vendedor Carlos",
      "comentario": null,
      "venta_id": "uuid-venta",
      "creado_el": "2026-06-23T14:35:00Z",
      "actualizado_el": "2026-06-23T14:35:00Z"
    }
  ],
  "total": 45,
  "skip": 0,
  "take": 50
}
```

**Query Parameters:**
- `itemId` (optional): Filtrar por item UUID
- `motivo` (optional): Filtrar por motivo exacto (`compra`, `venta`, `devolucion`, `merma`, `ajuste_manual`, `inventario_inicial`)
- `desde` (optional): ISO-8601, filtrar movimientos a partir de esta fecha
- `hasta` (optional): ISO-8601, filtrar movimientos hasta esta fecha
- `skip` (optional, default 0): Paginación
- `take` (optional, default 50): Cantidad por página

---

### PATCH /items/:id/stock

Ajusta manualmente el stock de un producto, generando un movimiento de `entrada` o `salida` según corresponda.

```
PATCH /api/items/:id/stock

Authorization: Bearer <token>

Request:
{
  "tipo": "entrada",
  "cantidad": 5,
  "motivo": "ajuste_manual",
  "comentario": "Ajuste tras recuento físico"
}

Response (200):
{
  "id": "uuid",
  "nombre": "Smartphone XYZ",
  "stock_anterior": 20,
  "stock_nuevo": 25,
  "movimiento_id": "uuid",
  "mensaje": "Stock ajustado exitosamente"
}

Response (400 — Stock insuficiente):
{
  "statusCode": 400,
  "message": "Stock insuficiente para la salida: disponible 10, solicitado 15",
  "error": "Bad Request"
}
```

**Request Body (`AjusteStockDto`):**
- `tipo` (required): `'entrada'` | `'salida'`
- `cantidad` (required): Número positivo (siempre; el signo lo define `tipo`)
- `motivo` (required): `'compra'` | `'venta'` | `'devolucion'` | `'merma'` | `'ajuste_manual'` | `'inventario_inicial'`
- `comentario` (optional): Texto libre (máx 500 caracteres)

**Constraints:**
- Solo para items con `tipo = 'producto'`
- `cantidad > 0`
- Si `tipo = 'salida'`, valida que `item_producto.stock >= cantidad`

---

## Backend

### Module & Services

- **Module**: `src/modules/inventario/inventario.module.ts`
- **Controller**: `src/modules/inventario/inventario.controller.ts`
- **Service**: `src/modules/inventario/inventario.service.ts`

### Entity & Database

**Table**: `movimientos_inventario`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `movimiento_id` | UUID | PK | |
| `tenant_id` | UUID | FK `tenants`, NOT NULL | Garantiza isolamiento multi-tenant |
| `item_id` | UUID | FK `items`, NOT NULL | Producto del que se mueve stock |
| `tipo` | enum | `'entrada'` \| `'salida'` \| `'ajuste'` | Define dirección del movimiento |
| `motivo` | varchar | `'compra'` \| `'venta'` \| `'devolucion'` \| `'merma'` \| `'ajuste_manual'` \| `'inventario_inicial'` | Razón del movimiento |
| `cantidad` | integer | NOT NULL, `> 0` | Siempre positiva; `tipo` define signo |
| `stock_anterior` | integer | NOT NULL | Saldo antes del movimiento (snapshot) |
| `stock_resultante` | integer | NOT NULL | Saldo después del movimiento (snapshot) |
| `usuario_id` | UUID | FK `usuarios`, NOT NULL | Quién registró el movimiento |
| `venta_id` | UUID | FK `ventas`, nullable | Si es `motivo = 'venta'`, referencia a la venta |
| `comentario` | text | nullable | Observaciones del usuario |
| `costo_unitario` | NUMERIC(18,4) | nullable | Congela el costo del momento del movimiento |
| `creado_el` | TIMESTAMPTZ | NOT NULL, default NOW | Marca de tiempo |
| `actualizado_el` | TIMESTAMPTZ | NOT NULL, default NOW | Marca de tiempo |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete (aunque movimientos raramente se borren) |

**Regla de costo:**
- **Entrada con motivo `compra` y `costoUnitario`:** actualiza `item_producto.costo_actual` y congela ese costo en `costo_unitario` del movimiento. Costos `<= 0` se rechazan.
- **Otras entradas con `costoUnitario`:** congelan el valor en el kardex **sin** pisar `costo_actual`.
- **Cualquier otro movimiento (sin costoUnitario):** congela el `costo_actual` vigente del momento en `costo_unitario` (snapshot del costo).
- En `ajustarStock`, la fila `item_producto` se bloquea con `FOR UPDATE` antes de convertir unidades.

**Índices (para performance):**
- `(tenant_id, item_id)` — consultas por producto del tenant
- `(tenant_id, motivo)` — filtrado por motivo
- `(tenant_id, creado_el)` — ordenamiento temporal

### DTOs

- `AjusteStockDto` — Request para `PATCH /items/:id/stock`
  ```typescript
  export class AjusteStockDto {
    @IsIn(['entrada', 'salida'])
    tipo: 'entrada' | 'salida';

    @IsNumber()
    @Min(1)
    cantidad: number;

    @IsIn(['compra', 'venta', 'devolucion', 'merma', 'ajuste_manual', 'inventario_inicial'])
    motivo: 'compra' | 'venta' | 'devolucion' | 'merma' | 'ajuste_manual' | 'inventario_inicial';

    @IsOptional()
    @IsString()
    @MaxLength(500)
    comentario?: string;
  }
  ```

- `MovimientoInventarioDto` — Response
  ```typescript
  export class MovimientoInventarioDto {
    movimiento_id: string;
    item_id: string;
    item_nombre: string;
    tipo: 'entrada' | 'salida' | 'ajuste';
    motivo: string;
    cantidad: number;
    stock_anterior: number;
    stock_resultante: number;
    usuario_nombre: string;
    comentario?: string;
    venta_id?: string;
    creado_el: Date;
    actualizado_el: Date;
  }
  ```

- `AjusteStockResponseDto` — Respuesta de PATCH
  ```typescript
  export class AjusteStockResponseDto {
    id: string;
    nombre: string;
    stock_anterior: number;
    stock_nuevo: number;
    movimiento_id: string;
    mensaje: string;
  }
  ```

### Key Methods

**InventarioService**

- `async registrarMovimiento(manager: EntityManager, params: { tenant_id, item_id, tipo, motivo, cantidad, usuario_id, venta_id?, comentario? }): Promise<MovimientoInventario>`
  
  Registra un movimiento y actualiza el saldo del item **en una sola transacción**. Usa `EntityManager` para que pueda ser reutilizado por otras transacciones (ventas, devoluciones).
  
  - Valida que el item exista y sea de `tipo = 'producto'`
  - Si `tipo = 'salida'`, valida stock suficiente; si no, lanza error sin modificar
  - Obtiene el stock actual con `FOR UPDATE` (evita carreras)
  - Inserta en `movimientos_inventario` con snapshots `stock_anterior` / `stock_resultante`
  - Actualiza `item_producto.stock` en la misma transacción
  - Retorna la entidad persistida

- `async ajustarStock(itemId: string, tenantId: string, usuarioId: string, dto: AjusteStockDto): Promise<AjusteStockResponseDto>`
  
  Endpoint handler para `PATCH /items/:id/stock`. Abre su propia transacción y llama a `registrarMovimiento`.

- `async findMovimientos(tenantId: string, filtros?: { itemId?, motivo?, desde?, hasta?, skip?, take? }): Promise<{ data: MovimientoInventarioDto[], total: number, skip, take }>`
  
  Consulta el kardex del tenant con JOINs a `items` y `usuarios` para enriquecer nombres. Retorna movimientos paginados, ordenados por `creado_el DESC`.

---

## Frontend

### Pages

- `pages/configuracion/inventario.vue` — Vista global del kardex
  - Tabla de movimientos con columnas: Item, Tipo, Motivo, Cantidad, Stock Anterior, Stock Resultante, Usuario, Fecha
  - Filtros laterales: por item (select/search), por motivo (select multi), por rango de fechas
  - Paginación
  - Botón "Exportar a CSV" (opcional)

- `pages/configuracion/items.vue` — Modificación: agregar modal "Historial"
  - En la fila de cada producto, agregar botón/enlace "Historial"
  - Modal `InventarioHistorialModal.vue` que muestra los últimos 20 movimientos del producto
  - Dentro del modal, resumen de saldo actual y últimas transacciones

### Components

- `components/InventarioTable.vue` — Tabla reutilizable de movimientos
  - Props: `movimientos[]`, `loading`, `total`, `skip`, `take`
  - Eventos: `@update:skip`, `@update:take`, `@filter`
  - Estilos: filas alternadas, resaltado de salidas/entradas por color

- `components/InventarioHistorialModal.vue` — Modal de historial de producto
  - Props: `itemId`, `itemNombre`, `isOpen`
  - Eventos: `@close`
  - Muestra últimos 20 movimientos + saldo actual del producto
  - Botón "Ver completo" que abre la página global `/configuracion/inventario` pre-filtrada por item

- `components/AjusteStockModal.vue` — Modal para ajustar stock manualmente
  - Props: `itemId`, `itemNombre`, `stockActual`, `isOpen`
  - Eventos: `@close`, `@success`
  - Campos: tipo (radio), cantidad (input numérico), motivo (select), comentario (textarea)
  - Validación: cantidad > 0, si salida entonces cantidad <= stockActual
  - Toast "Stock ajustado exitosamente" o error si falla

### Pinia Store

**File**: `stores/inventario.ts`

**State**:
```typescript
interface InventarioState {
  movimientos: MovimientoInventarioDto[];
  total: number;
  skip: number;
  take: number;
  filtros: {
    itemId?: string;
    motivo?: string;
    desde?: Date;
    hasta?: Date;
  };
  loading: boolean;
  error: string | null;
}
```

**Actions**:
- `async fetchMovimientos(filtros?: any)` — GET `/api/inventario/movimientos` con filtros
- `async ajustarStock(itemId: string, dto: AjusteStockDto)` — PATCH `/api/items/:id/stock`
- `setFiltros(filtros: any)` — Actualiza filtros locales y re-fetch
- `resetFiltros()` — Limpia filtros
- `setPaginacion(skip: number, take: number)` — Cambia paginación

---

## Data Flow

### Crear Producto con Stock Inicial

```
[Usuario abre formulario de nuevo producto]
  ↓
[Completa: nombre, precio, stock inicial = 25]
  ↓ POST /api/items
[Backend: Controller valida DTO]
  ↓
[Service inicia transacción]
  ├→ Inserta en `items`
  ├→ Inserta en `item_producto` (stock = 25)
  ├→ Si stock > 0, llama a InventarioService.registrarMovimiento(
  │   tipo='entrada', motivo='inventario_inicial', cantidad=25
  │ )
  │ ├→ Inserta en `movimientos_inventario` (stock_anterior=0, stock_resultante=25)
  │ └→ Confirma `item_producto.stock = 25`
  └→ Retorna item creado
  ↓
[Frontend: recibe item, muestra toast "Producto creado"]
  ↓
[Usuario navega a /configuracion/items, ve el producto con Stock 25]
  ↓
[Usuario hace clic en "Historial" → modal muestra 1 movimiento: inventario_inicial, 25 unidades]
```

### Ajustar Stock Manualmente

```
[Usuario en /configuracion/items hace clic en "Ajustar stock" de un producto]
  ↓
[Se abre AjusteStockModal]
  ↓
[Usuario elige tipo=entrada, cantidad=10, motivo=compra, comentario="Reorden"]
  ↓ Click "Guardar"
[PATCH /api/items/:id/stock con AjusteStockDto]
  ↓
[Backend: Controller valida DTO]
  ↓
[InventarioService.ajustarStock inicia transacción]
  ├→ Obtiene stock actual con FOR UPDATE
  ├→ Llama a registrarMovimiento(
  │   tipo='entrada', motivo='compra', cantidad=10, usuario_id=<del token>,
  │   comentario="Reorden"
  │ )
  │ ├→ Calcula stock_resultante = stock_anterior + 10
  │ ├→ Inserta movimiento en `movimientos_inventario`
  │ └→ Actualiza `item_producto.stock`
  └→ Retorna AjusteStockResponseDto
  ↓
[Frontend: recibe respuesta, muestra toast "Stock ajustado exitosamente"]
  ↓
[Store se actualiza: refetch movimientos del item → modal "Historial" muestra el movimiento nuevo]
```

### Salida de Stock (Insuficiente)

```
[Usuario intenta salida: cantidad 15, pero stock actual es 10]
  ↓ PATCH /api/items/:id/stock { tipo='salida', cantidad=15 }
  ↓
[InventarioService.registrarMovimiento]
  ├→ Obtiene stock con FOR UPDATE: 10
  ├→ Valida: 10 >= 15? → NO
  └→ Lanza BadRequestException("Stock insuficiente para la salida: disponible 10, solicitado 15")
  ↓
[Transacción revierte, no se crea movimiento]
  ↓
[Frontend: captura error 400, muestra toast rojo "Stock insuficiente para la salida…"]
```

### Venta Genera Movimiento Automático

```
[Usuario en /ventas crea una venta con 1 unidad de Smartphone]
  ↓ POST /api/ventas
  ↓
[Backend: VentasService inicia transacción]
  ├→ Inserta en `ventas`, `venta_detalle`, `venta_impuesto`, etc.
  ├→ Por cada línea del detalle:
  │ ├→ Obtiene el item
  │ └→ Llama a InventarioService.registrarMovimiento(
  │     manager, {
  │       tipo='salida',
  │       motivo='venta',
  │       cantidad=1,
  │       venta_id=<id de la venta>,
  │       usuario_id=<del token>
  │     }
  │   )
  │ ├→ Valida stock: si no hay suficiente, lanza error
  │ └→ Registra movimiento e inserta en `movimientos_inventario`
  └→ Transacción se confirma (venta + movimientos en una sola unidad atómica)
  ↓
[Frontend: toast "Venta registrada"]
  ↓
[Usuario navega a `/configuracion/inventario`, filtra por motivo='venta', ve la salida registrada automáticamente]
```

---

## Testing

### Unit Tests (Backend)

```bash
npm test -- modules/inventario/inventario.service.spec.ts
npm test -- modules/inventario/inventario.controller.spec.ts
npm test -- modules/items/items.service.spec.ts  # Tests de creación con stock inicial
```

**Test Coverage:**
- ✅ `registrarMovimiento` con entrada, salida, inventario_inicial
- ✅ Validación de stock insuficiente en `salida`
- ✅ Transacción atómica: rollback al fallar
- ✅ Creación automática de movimiento al crear producto con stock > 0
- ✅ `findMovimientos` con filtros (itemId, motivo, fechas)
- ✅ Paginación correcta

### E2E Tests

```bash
npm run test:e2e -- inventario.e2e.spec.ts
```

**Escenarios:**
1. Crear producto con stock inicial 25 → verificar movimiento `inventario_inicial` automático
2. Ajustar stock (entrada): +10 unidades, motivo=compra → verificar nuevo saldo, movimiento visible en historial
3. Ajustar stock (salida): -5 unidades, stock actual=8 → éxito, saldo=3, movimiento registrado
4. Intentar salida con cantidad > stock → error 400, no se crea movimiento, stock sin cambios
5. Crear venta con 1 unidad de producto → movimiento `salida`/`motivo='venta'` registrado automáticamente
6. Filtrar kardex por motivo='venta' → solo movimientos de ventas
7. Filtrar kardex por rango de fechas → movimientos dentro del rango

### Manual Testing (Swagger + Frontend)

1. Swagger: http://localhost:3000/api/docs
   - POST `/items` con stock_inicial=25
   - PATCH `/items/:id/stock` con tipo/cantidad/motivo
   - GET `/inventario/movimientos?motivo=entrada&skip=0&take=10`

2. Frontend: `docker-compose up`
   - Login → Configuración → Items
   - Crear producto con stock inicial
   - Hacer clic en "Historial" → ver movimiento inicial
   - Ajustar stock (entrada/salida) → ver cambios
   - Navegar a Configuración → Inventario
   - Probar filtros (item, motivo, fechas)

---

## Acceptance Criteria

- [x] Entity `MovimientoInventario` creada con columnas correctas
- [x] Endpoint `GET /inventario/movimientos` implementado y testado
- [x] Endpoint `PATCH /items/:id/stock` actualizado para registrar motivo+comentario
- [x] `InventarioService.registrarMovimiento` implementado con manager-awareness
- [x] Movimiento `inventario_inicial` automático al crear producto con stock > 0
- [x] Validación de stock insuficiente en `salida`
- [x] Transacción atómica: movimiento + actualización de saldo juntos
- [x] Integración con ventas: cada línea genera `salida`/`motivo='venta'` automáticamente
- [x] Frontend: modal "Historial" en `/configuracion/items`
- [x] Frontend: página `/configuracion/inventario` con filtros
- [x] Unit tests: ✅
- [x] E2E tests: ✅
- [x] API docs: Swagger decorators
- [x] Feature docs: esta file

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Carreras de actualización en saldo materializado | Inconsistencia stock | `FOR UPDATE` en query de stock antes de operar |
| Movimiento registrado pero venta falla → stock cambia sin venta | Inconsistencia | Una sola transacción DB para venta + movimiento |
| Usuarios olvidan ajustar stock manualmente | Discrepancias | Alertas de "próximo vencimiento" y "stock bajo"; recordatorios periódicos |
| Auditoría: quién cambió qué y cuándo | Compliance | `usuario_id` y `creado_el` en cada movimiento; soft delete para trazabilidad |

---

## Related Features

- [Catálogo de items (productos y servicios)](./catalogo-items.md) — Donde vive `item_producto.stock`
- [Procesamiento de ventas](./ventas.md) — Integración automática: cada venta genera salida
- [Gestión de cajas](./cajas.md) — Ventas se asocian a cajas (futuro: movimientos de caja)

---

## Notes

- **Reutilización de `InventarioService.registrarMovimiento(manager, ...)`:** El servicio está diseñado para recibir un `EntityManager`, permitiendo que el módulo de ventas (o futuras integraciones) use la misma lógica dentro de su propia transacción sin duplicar código.
- **Tipo `'ajuste'` reservado:** SQL permite `'ajuste'` pero esta fase solo usa `'entrada'`/`'salida'`. El tipo `'ajuste'` está reservado para fase futura cuando se implemente recuento absoluto de inventario.
- **Confirmación en BD:** el nombre real de la columna de usuario en `usuarios` se usa en JOINs (`usuarios.nombre AS usuario_nombre`). Ajustar si la columna tiene otro nombre o alias.
