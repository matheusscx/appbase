# Feature: Conversión de Unidades de Medida

**Status**: Complete  
**Owner**: SDD Team  
**Last Updated**: 2026-07-14

---

## Overview

### What is it?

Un catálogo global de unidades de medida (`unidades_medida`) que permite convertir cantidades entre unidades compatibles (ej: 500 g → 0,5 kg) en el ajuste de stock. Cada unidad pertenece a una magnitud (masa, volumen, conteo, longitud) y se define mediante un factor base relativo a la unidad más pequeña de su magnitud. La conversión ocurre **antes de registrar el movimiento de inventario**, de modo que el kardex siempre queda en la unidad base del producto: una única representación de la verdad.

### Why does it exist?

Antes de esta feature, `item_producto.unidad_medida` era un campo de texto libre: la API aceptaba cualquier string (`kg`, `g`, `l`, `ml`, `unidad`, `m`), y no sabía que `kg` y `g` son la misma magnitud. El frontend tenía tres catálogos hardcodeados y desalineados:

- El seeder sembraba productos en `'unidad'`, `'kg'`, `'l'`, `'m'`
- `frontend/app/utils/stock-format.ts` declaraba `UNIDADES_FRACCIONARIAS = {kg, l, m}`
- `items.vue` tenía su propio selector de unidades

Sin conversión, recetas futuras no pueden expresar "200 g de un insumo stockeado en kg" ni cualquier ajuste en unidad distinta a la base. El catálogo global cierra ese gap y es prerequisito directo de la pieza 3 (Recetas).

### Scope

**Included in this version:**
- Tabla global `unidades_medida` (catálogo estático, sin `tenant_id`).
- 6 unidades sembradas: `g`, `kg`, `ml`, `l`, `unidad`, `m`.
- Servicio de conversión: fórmula `cantidad × (factor_desde / factor_hacia)` con Decimal.js y redondeo a 4 decimales.
- Validación de `unidad_medida` del producto contra el catálogo (crear y editar).
- Conversión en el ajuste de stock (`PATCH /items/:id/stock` con `unidadCodigo` opcional).
- Endpoint `GET /catalog/unidades-medida` como única fuente de verdad.
- Reglas de rechazo: cross-magnitud, serie/lote con unidad distinta a la base, cambio de base con movimientos, cantidad que redondea a cero.

**NOT included (future):**
- Recetas y consumo de ingredientes (pieza 3).
- Unidades propias por tenant (el catálogo es global).
- Conversión entre magnitudes vía densidad (`l → kg`).
- Conversión de unidad de venta / precio por unidad distinta a stock.

---

## API Endpoints

### GET /catalog/unidades-medida

Lista las 6 unidades de medida del catálogo global, ordenadas por magnitud y factor.

```
GET /api/catalog/unidades-medida

Authorization: Bearer <token>

Response (200) — array plano, sin envelope (no hay interceptor de transformación global, solo `ClassSerializerInterceptor`):
[
    {
      "unidadMedidaId": "550e8400-e29b-41d4-a716-446655440250",
      "codigo": "g",
      "nombre": "Gramo",
      "magnitud": "masa",
      "factorBase": "1"
    },
    {
      "unidadMedidaId": "550e8400-e29b-41d4-a716-446655440251",
      "codigo": "kg",
      "nombre": "Kilogramo",
      "magnitud": "masa",
      "factorBase": "1000"
    },
    {
      "unidadMedidaId": "550e8400-e29b-41d4-a716-446655440252",
      "codigo": "ml",
      "nombre": "Mililitro",
      "magnitud": "volumen",
      "factorBase": "1"
    },
    {
      "unidadMedidaId": "550e8400-e29b-41d4-a716-446655440253",
      "codigo": "l",
      "nombre": "Litro",
      "magnitud": "volumen",
      "factorBase": "1000"
    },
    {
      "unidadMedidaId": "550e8400-e29b-41d4-a716-446655440254",
      "codigo": "unidad",
      "nombre": "Unidad",
      "magnitud": "conteo",
      "factorBase": "1"
    },
    {
      "unidadMedidaId": "550e8400-e29b-41d4-a716-446655440255",
      "codigo": "m",
      "nombre": "Metro",
      "magnitud": "longitud",
      "factorBase": "1"
    }
]
```

**Purpose**: Reemplaza los tres catálogos hardcodeados (seeder, `stock-format.ts`, `items.vue`). El frontend consulta este endpoint al abrir el formulario de item o el modal de ajuste de stock.

---

### PATCH /items/:id/stock

Ajusta el stock de un producto, con conversión de unidad opcional.

```
PATCH /api/items/:id/stock

Authorization: Bearer <token>

Request:
{
  "tipo": "entrada",
  "cantidad": 500,
  "motivo": "merma",
  "comentario": "Merma por vencimiento",
  "unidadCodigo": "g"
}

Response (200):
{
  "stock": "0.5000"
}
```

**Request Body (`AjusteStockDto`):**
- `tipo` (required): `'entrada'` | `'salida'`
- `cantidad` (required): Número positivo (el signo lo define `tipo`)
- `motivo` (required): `'compra'` | `'devolucion'` | `'merma'` | `'ajuste_manual'` | `'inventario_inicial'`
- `comentario` (optional): Texto libre
- **`unidadCodigo` (optional)**: Código de la unidad en la que viene `cantidad`. Si difiere de la unidad base del producto, se convierte antes de registrar. Si no se envía o coincide con la base, se registra tal cual.

**Behavior:**
- Si `unidadCodigo` es igual a la unidad base del producto → sin conversión.
- Si `unidadCodigo` difiere y el producto es `modo_inventario = 'cantidad'` → conversión y registro en unidad base.
- Si `unidadCodigo` difiere y el producto es `modo_inventario = 'serie'` o `'lote'` → error 400 (ver Reglas de Rechazo).

---

## Backend

### Module & Services

- **Module**: `src/modules/catalog/catalog.module.ts`
- **Controller**: `src/modules/catalog/catalog.controller.ts`
- **Service**: `src/modules/catalog/catalog.service.ts`

### Entity & Database

**Table**: `unidades_medida` (global, sin `tenant_id`)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `unidad_medida_id` | UUID | PK | `type: 'uuid'` explícito (ADR-004) |
| `codigo` | TEXT | UNIQUE, NOT NULL | Código guardado en `item_producto.unidad_medida` (kg, g, l, ml, unidad, m) |
| `nombre` | TEXT | NOT NULL | Etiqueta legible para UI ("Kilogramo") |
| `magnitud` | TEXT | NOT NULL | `'masa'` \| `'volumen'` \| `'conteo'` \| `'longitud'` — Solo se convierte dentro de una magnitud |
| `factor_base` | NUMERIC(18,6) | NOT NULL, CHECK > 0 | Cuántas unidades base (de la magnitud) equivale 1 de esta. Ej: `kg` = 1000 g → `factor_base = 1000`. Runtime también valida en `convertirUnidad`. |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | — | Convención transversal; lecturas filtran `eliminado_el IS NULL` |

### Semilla (6 Unidades)

| codigo | nombre | magnitud | factor_base | Notas |
|--------|--------|----------|-------------|-------|
| `g` | Gramo | masa | 1 | Unidad base de masa |
| `kg` | Kilogramo | masa | 1000 | 1 kg = 1000 g |
| `ml` | Mililitro | volumen | 1 | Unidad base de volumen |
| `l` | Litro | volumen | 1000 | 1 l = 1000 ml |
| `unidad` | Unidad | conteo | 1 | Unidad base de conteo (items discretos) |
| `m` | Metro | longitud | 1 | Unidad base de longitud (compatibilidad con seeder existente) |

**Cero migración de datos:** Todos los productos existentes usan uno de estos códigos, así que son válidos desde el primer seed.

### Conversión de Unidades

**Servicio**: `CatalogService.convertirUnidad(cantidad: string, codigoDesde: string, codigoHacia: string): Promise<string>`

**Fórmula:**
```
cantidad_convertida = cantidad × (factor_desde / factor_hacia)
```
redondeada a 4 decimales (ROUND_HALF_UP).

**Ejemplo**: 500 g a kg:
- `factor_desde` (g) = 1
- `factor_hacia` (kg) = 1000
- convertida = 500 × (1 / 1000) = 0.5000

**Validaciones:**
1. Unidad desconocida → `BadRequest` ("Unidad de medida no reconocida: X")
2. Magnitudes distintas → `BadRequest` ("No se puede convertir de masa a volumen")
3. `factor_base <= 0` → `BadRequest` ("El factor de conversión de la unidad debe ser mayor a 0")
4. Cantidad convertida que redondea a 0 (cuando original > 0) → `BadRequest` ("La cantidad convertida es menor a la precisión de stock")

**Precisión — decisión explícita:** La escala de `item_producto.stock` y `movimientos_inventario.cantidad` es NUMERIC(18,4), así que 4 decimales es el límite. Convertir 1 g a kg da 0.0010, exacto. Pero cantidades chicas en magnitudes con salto de 1000 pueden perder resolución (ej: 0.00005 kg → 0.0001). Se acepta: el límite es preexistente, no lo introduce la conversión.

### Validación de Unidad en Crear/Editar Item

En `ItemsService`:

**Crear** (`create`, líneas 261–263):
```typescript
if (dto.unidadMedida !== undefined) {
  await this.validarUnidadMedida(dto.unidadMedida);
}
```
- Si no se envía → default `'unidad'` (intacto, compatible con datos históricos).
- Si se envía → debe existir en el catálogo global.

**Editar** (`update`, líneas 457–479):
- Validar contra el catálogo si se envía.
- **Si cambia la unidad base y el producto ya tiene movimientos** → `BadRequest` ("No se puede cambiar la unidad de medida de un producto con movimientos registrados").
  - Razón: El stock guardado está en la unidad vieja; cambiar el código sin reescribir el kardex lo corrompe silenciosamente (100 kg pasarían a leerse como 100 g).

### Conversión en el Ajuste de Stock

En `ItemsService.ajustarStock` (líneas 593–652):

1. Obtener unidad base del producto.
2. Si `dto.unidadCodigo` viene:
   - Si coincide con la base → sin conversión; pasar `cantidad` tal cual a `registrarMovimiento`.
   - Si difiere y modo `'cantidad'` → convertir con `CatalogService.convertirUnidad()`.
   - Si difiere y modo `'serie'` o `'lote'` → `BadRequest` ("Los productos por serie o lote solo admiten su unidad base").
3. Pasar la cantidad convertida (o original si sin conversión) a `InventarioService.registrarMovimiento`.

**Por qué aquí y no en `registrarMovimiento`:**
- El kardex **siempre** guarda la unidad base del producto.
- `registrarMovimiento` (inventario.service.ts) es agnóstico de unidades: solo registra una cantidad.
- Así, una única representación de la verdad y sin duplicar lógica de conversión.

---

## Frontend

### Catálogo en Runtime

El `catalog.service` carga `GET /catalog/unidades-medida` al iniciar y lo almacena en un store (Pinia o estado global). El selector de unidades en:

- Formulario de item: lista todas las unidades cargadas del catálogo; el campo solo se muestra cuando `tipo === 'producto'`.
- Modal de ajuste de stock: lista las unidades de la **misma magnitud** que la base del producto (previene cross-magnitud accidental).

### Selector de Unidad en Formulario de Item

En `items.vue`, el `<USelectMenu>` de unidad reemplaza la constante `unidadesMedidaOpts` (líneas 149–154) por la lista cargada del catálogo. **Decisión explícita:** no se deshabilita el selector en el frontend aunque el producto tenga movimientos — se deja que el backend rechace el cambio (`update`, ver "Rechazo: Cambio de Base con Movimientos") y el error se muestra al usuario. Evita duplicar la regla de negocio en dos capas.

### Modal de Ajuste de Stock

En `items.vue`, el modal de ajuste:
- Selector de unidad limitado a la magnitud del producto (ej: producto en `kg` → selector muestra solo `g` y `kg`).
- Unidad base preseleccionada.
- Feedback: "500 g → 0,5 kg" visible antes de confirmar (permite al usuario verificar la conversión).
- Oculto si `modo_inventario !== 'cantidad'` (serie/lote no soportan unidad distinta a la base).

### Fraccionalidad de Display (`stock-format.ts`)

La función `UNIDADES_FRACCIONARIAS` deja de ser un set hardcodeado (`{kg, l, m}`). Se reemplaza por: **una unidad es fraccionaria si su magnitud !== 'conteo'**. Esto automáticamente incluye:
- Masa: `g`, `kg` → fraccionarias
- Volumen: `ml`, `l` → fraccionarias
- Longitud: `m` → fraccionaria
- Conteo: `unidad` → entera

---

## Data Flow

### Crear Producto en kg, Ajustar Stock en g

```
[Usuario abre formulario de nuevo producto]
  ↓
[Selecciona unidad = 'kg' (cargado de GET /catalog/unidades-medida)]
  ↓ POST /api/items
[Backend: ItemsService.create]
  ├→ Valida 'kg' contra el catálogo (✓ existe, magnitud='masa')
  ├→ Inserta item + item_producto (unidad_medida='kg', stock=0)
  └→ Si stock_inicial > 0, registra movimiento 'inventario_inicial'
  ↓
[Usuario en /configuracion/items: hace clic en "Ajustar stock"]
  ↓
[Modal abre; selector de unidad se llena con unidades de magnitud 'masa': g, kg]
  ↓
[Usuario ingresa: cantidad=500, unidad=g, tipo=entrada, motivo=merma]
  ↓ Click "Guardar"
[PATCH /api/items/:id/stock con AjusteStockDto]
  ↓
[Backend: ItemsService.ajustarStock]
  ├→ Lee unidad base del producto: 'kg'
  ├→ unidadCodigo='g' ≠ 'kg' → llamar convertirUnidad('500', 'g', 'kg')
  │ ├→ Buscar unidades: g (factor=1), kg (factor=1000)
  │ ├→ Validar magnitudes iguales (masa, masa ✓)
  │ ├→ Calcular: 500 × (1/1000) = 0.5000
  │ └→ Retornar "0.5000"
  ├→ Pasar cantidad="0.5000" a InventarioService.registrarMovimiento
  │ ├→ Inserta en movimientos_inventario (cantidad=0.5000, en unidad base)
  │ └→ Actualiza item_producto.stock = 0.5000
  └→ Retorna { stock: "0.5000" }
  ↓
[Frontend: cierra modal, actualiza saldo (ahora 0.5000 kg visible)]
```

### Rechazo: Cross-Magnitud

```
[Usuario ingresa cantidad=500, unidad='ml' (volumen), pero producto está en 'kg' (masa)]
  ↓ PATCH /api/items/:id/stock
  ↓
[ItemsService.ajustarStock]
  ├→ unidadCodigo='ml' ≠ unidad base 'kg'
  ├→ Llamar convertirUnidad('500', 'ml', 'kg')
  │ ├→ Buscar unidades: ml (magnitud='volumen', factor=1), kg (magnitud='masa', factor=1000)
  │ ├→ Validar: 'volumen' ≠ 'masa' → FAIL
  │ └→ Lanzar BadRequest("No se puede convertir de volumen a masa")
  └→ No se modifica stock
  ↓
[Frontend: Toast de error]
```

### Rechazo: Serie/Lote con Unidad Distinta a Base

```
[Usuario intenta PATCH /items/:id/stock con unidadCodigo='g' en producto modo='serie', unidad='kg']
  ↓
[ItemsService.ajustarStock]
  ├→ unidadCodigo='g' ≠ unidad base 'kg' → requiere conversión
  ├→ Leer modo_inventario del producto → 'serie'
  └→ Lanzar BadRequest("Los productos por serie o lote solo admiten su unidad base")
  ↓
[No se modifica stock; frontend: error]
```

### Rechazo: Cambio de Base con Movimientos

```
[Usuario edita producto: intenta cambiar unidadMedida de 'kg' a 'g', pero ya hay 3 movimientos registrados]
  ↓ PATCH /api/items/:id
  ↓
[ItemsService.update]
  ├→ Leer unidad actual: 'kg'
  ├→ dto.unidadMedida='g' ≠ 'kg' → cambio real
  ├→ Contar movimientos: 3 > 0
  └→ Lanzar BadRequest("No se puede cambiar la unidad de medida de un producto con movimientos registrados")
  ↓
[No se actualiza; frontend: error]
```

---

## Testing

### Unit Tests (Backend)

**`catalog.service.spec.ts`:**
- `convertirUnidad`: misma magnitud (kg → g, g → kg, l → ml)
- `convertirUnidad`: identidad (codigoDesde === codigoHacia)
- `convertirUnidad`: unidad desconocida → BadRequest
- `convertirUnidad`: cross-magnitud → BadRequest
- `convertirUnidad`: redondeo a 4 decimales correcto
- `convertirUnidad`: cantidad → cero tras redondeo → BadRequest

**`items.service.spec.ts`:**
- `ajustarStock` con `unidadCodigo` distinto convierte antes de `registrarMovimiento`
- `ajustarStock` sin `unidadCodigo` no convierte
- `ajustarStock` con `unidadCodigo` ≠ base y modo `'serie'` → BadRequest
- `ajustarStock` con `unidadCodigo` ≠ base y modo `'lote'` → BadRequest
- `create` con `unidadMedida` inválido → BadRequest
- `update` con `unidadMedida` inválido → BadRequest
- `update` cambio de base con movimientos → BadRequest

### E2E Tests

```bash
npm run test:e2e -- inventario.e2e-spec.ts
```

**Escenarios:**
1. Crear producto en `kg` → ajuste por compra de 500 g → stock resultante 0.5000.
2. Producto en `kg`, merma de 250 g → stock 0.2500, movimiento en unidad base.
3. Cross-magnitud: ajuste de producto en `kg` con unidad `ml` → 400 (BadRequest).
4. Serie/lote: crear producto modo='serie', intentar ajuste con `unidadCodigo` ≠ base → 400 (BadRequest).
5. Cambio de base con movimientos: editar producto con movimientos, cambiar unidad → 400 (BadRequest).

### Manual Testing (Swagger)

1. GET `/api/catalog/unidades-medida` → devuelve las 6 unidades, ordenadas por magnitud y factor.
2. POST `/api/items` con `unidadMedida='kg'` → producto creado.
3. PATCH `/api/items/:id/stock` con `{ cantidad: 500, tipo: 'entrada', unidadCodigo: 'g' }` → stock 0.5000.
4. PATCH `/api/items/:id/stock` con `{ cantidad: 500, tipo: 'entrada', unidadCodigo: 'ml' }` en producto `kg` → 400.

### Manual Testing (Frontend)

1. Login → Configuración → Items.
2. Crear producto nuevo, seleccionar unidad = `kg`.
3. En listado, hacer clic en "Ajustar stock".
4. Modal abre; selector de unidad muestra solo masa (`g`, `kg`).
5. Ingresar: cantidad 500, unidad `g`, motivo merma.
6. Visualizar feedback "500 g → 0,5 kg".
7. Confirmar → stock actualizado a 0.5000.
8. Historial del producto muestra movimiento de merma, cantidad 0.5000 kg.

---

## Acceptance Criteria

- [x] Tabla `unidades_medida` creada con 6 unidades sembradas
- [x] `CatalogService.convertirUnidad()` implementado con Decimal.js y 4 decimales
- [x] Validación de `unidad_medida` en crear/editar item
- [x] Rechazo: cambio de base con movimientos
- [x] Rechazo: cross-magnitud
- [x] Rechazo: serie/lote con unidad distinta a base
- [x] Rechazo: cantidad → cero tras redondeo
- [x] `GET /catalog/unidades-medida` implementado
- [x] `PATCH /items/:id/stock` + `unidadCodigo` integrado
- [x] Conversión en `ajustarStock` antes de `registrarMovimiento`
- [x] Kardex siempre en unidad base (agnóstico de conversión)
- [x] Unit tests: catálogo
- [x] Unit tests: items (validación + conversión)
- [x] E2E tests: full flow conversión
- [x] Frontend: selector de unidad en formulario de item
- [x] Frontend: modal de ajuste con feedback de conversión
- [x] Frontend: fraccionalidad derivada de `magnitud !== 'conteo'`
- [x] Feature docs: esta file
- [x] Linked from `docs/README.md`

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Cross-magnitud accidental (usuario selecciona ml para producto en kg) | Validación backend rechaza; frontend limita a magnitud | Selector frontend pre-filtrado; mensaje de error claro en Swagger |
| Pérdida de resolución (0.00005 kg → 0.0001 al redondear a 4 decimales) | Cantidad que debería ser registrada se pierde silenciosamente | Se rechaza si redondea a 0 y original > 0; el límite es preexistente (NUMERIC(18,4)) |
| Cambio de base sin notice (usuario cambia unidad de 'kg' a 'g' sin darse cuenta) | Stock histórico se interpreta mal (100 kg = 100 g) | Backend rechaza el cambio si hay movimientos (400); el frontend no bloquea el selector, solo propaga el error |
| Inconsistencia entre BD y catálogo en runtime (alguien borra 'kg' de la tabla) | Item no válido, nuevos items con 'kg' fallan | Catálogo global es inmutable tras seed; no hay UI para editar/borrar unidades |

---

## Related Features

- [Inventario — Kardex de movimientos de stock](./inventario-kardex.md) — El kardex siempre queda en unidad base; esta feature convierte antes de escribir.
- [Catálogo de items (productos y servicios)](./catalogo-items.md) — `item_producto.unidad_medida` es validado por este catálogo.
- [Recetas](./recetas.md) — **Pieza 3 del cluster**: requiere conversión para expresar "200 g de insumo stockeado en kg".

---

## Notes

- **Catálogo global:** No hay `tenant_id` en `unidades_medida` porque un kg es un kg en todos los tenants, igual que `moneda` y `pais`. Diseño coherente con la jerarquía de datos.
- **Compatible con datos históricos:** Los 6 códigos ya están en uso en el seeder existente, así que la validación no rompe nada.
- **Agnóstico de unidades en el kardex:** `InventarioService.registrarMovimiento()` nunca recibe un código de unidad; siempre recibe una cantidad ya en unidad base. Esto mantiene el kardex simple y consistente.
- **Unidades propias por tenant:** Reservado para fase futura si algún cliente necesita unidades no estándar (ej: "docena", "pack").
