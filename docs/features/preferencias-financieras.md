# Feature: Preferencias Financieras

**Status**: Complete  
**Owner**: Desarrollo Backend/Frontend  
**Last Updated**: 2026-06-24

---

## Overview

### What is it?

Preferencias Financieras es una pantalla de configuración que permite al administrador del tenant personalizar cómo se calculan los precios finales de venta. Específicamente:

1. **Modo de cálculo de descuentos**: `base` (todos los descuentos se aplican sobre el precio neto) o `compuesto` (cada descuento se aplica en cascada sobre el resultado anterior).
2. **Modo de cálculo de recargos**: `base` (todos sobre precio neto) o `compuesto` (en cascada).
3. **Orden de la fórmula de precios**: reordenar los tres pasos (descuentos, recargos, impuestos) en la secuencia que prefiera.

La configuración se persiste en la base de datos y es consultada por el motor de cálculo de precios (pendiente) al procesar ventas.

### Why does it exist?

Diferentes tipos de negocio y regímenes fiscales requieren distintas estrategias de cálculo de precios. Algunos aplican todos los descuentos sobre el precio base; otros los aplican en cascada. El orden de aplicación de impuestos, descuentos y recargos también varía según la jurisdicción. Esta pantalla permite a cada tenant configurar su propia lógica sin cambiar el código.

### Scope

- **Included in this version:**
  - Lectura y escritura de preferencias (`GET` y `PUT`)
  - Validación de la fórmula (contiene exactamente los 3 pasos, sin duplicados)
  - Persistencia en `tenants.calculo_descuentos`, `tenants.calculo_recargos`, y tabla `tenant_formula_precio`
  - Acceso restringido a admin del tenant (guard RBAC)
  
- **NOT included (future):**
  - Motor de cálculo de precios que consume estas preferencias (ver `Motor de cálculo de precios` en CLAUDE.md)
  - Interfaz gráfica de reordenamiento interactivo (drag-and-drop); la v1 espera un array en el body
  - Evaluación de condiciones de descuentos/recargos (`monto_minimo`, `cantidad_minima`, etc.)

---

## API Endpoints

### GET /api/tenants/preferencias-financieras

Recupera las preferencias financieras del tenant actual.

```
GET /api/tenants/preferencias-financieras

Authorization: Bearer <access_token>

Response (200):
{
  "calculoDescuentos": "base",
  "calculoRecargos": "compuesto",
  "formula": ["descuentos", "recargos", "impuestos"],
  "escalaCalculo": 6,
  "modoRedondeo": "HALF_UP",
  "montoTolerancia": "0"
}
```

---

### PUT /api/tenants/preferencias-financieras

Actualiza las preferencias financieras del tenant. Requiere rol admin.

```
PUT /api/tenants/preferencias-financieras

Authorization: Bearer <access_token>

Request:
{
  "calculoDescuentos": "compuesto",
  "calculoRecargos": "base",
  "formula": ["recargos", "descuentos", "impuestos"],
  "escalaCalculo": 4,
  "modoRedondeo": "HALF_EVEN",
  "montoTolerancia": "1.5"
}

Response (200):
{
  "calculoDescuentos": "compuesto",
  "calculoRecargos": "base",
  "formula": ["recargos", "descuentos", "impuestos"],
  "escalaCalculo": 4,
  "modoRedondeo": "HALF_EVEN",
  "montoTolerancia": "1.5"
}

Response (400):
{
  "message": "Formula debe contener exactamente ['descuentos', 'recargos', 'impuestos'] sin duplicados",
  "statusCode": 400
}
```

---

## Backend

### Module & Services

- **Module**: `src/modules/tenants/tenants.module.ts`
- **Controller**: `src/modules/tenants/tenants.controller.ts`
- **Service**: `src/modules/tenants/tenants.service.ts`

Se integra en el módulo de tenants existente (no es un módulo nuevo).

### Entity & Database

**Tables**:

1. **`tenants`** (columnas nuevas/modificadas)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK | Ya existe |
| `calculo_descuentos` | TEXT | NOT NULL, default 'base' | Valores: 'base', 'compuesto' |
| `calculo_recargos` | TEXT | NOT NULL, default 'base' | Valores: 'base', 'compuesto' |
| `escala_calculo` | SMALLINT | NOT NULL, default 6 | Decimales para cálculos intermedios (0–12) |
| `modo_redondeo` | TEXT | NOT NULL, default 'HALF_UP' | Valores: 'HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL' |
| `monto_tolerancia` | NUMERIC(18,6) | NOT NULL, default 0 | Tolerancia máxima en conciliaciones |

2. **`tenant_formula_precio`** (tabla nueva)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `tenant_id` | UUID | PK, FK (tenants.id) | Identifica el tenant |
| `paso` | SMALLINT | PK | 1, 2, 3 — orden de aplicación |
| `tipo` | TEXT | NOT NULL | Valores: 'descuentos', 'recargos', 'impuestos' |
| `creado_el` | TIMESTAMPTZ | default NOW() | Timestamp de creación |
| `actualizado_el` | TIMESTAMPTZ | default NOW() | Timestamp de actualización |

**Índices**: 
- PK compuesto: `(tenant_id, paso)`
- Único: `(tenant_id, tipo)` — garantiza que no hay duplicados de tipo en la fórmula

### DTOs

```typescript
// GET response + PUT request/response
export class PreferenciasFinancierasDto {
  calculoDescuentos: 'base' | 'compuesto';
  calculoRecargos: 'base' | 'compuesto';
  formula: ('descuentos' | 'recargos' | 'impuestos')[];
  escalaCalculo: number;        // entero 0-12
  modoRedondeo: string;         // 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL'
  montoTolerancia: string;      // numeric como string (Decimal.js)
}

// PUT request
export class UpdatePreferenciasFinancierasDto {
  calculoDescuentos: 'base' | 'compuesto';
  calculoRecargos: 'base' | 'compuesto';
  formula: ('descuentos' | 'recargos' | 'impuestos')[];
  escalaCalculo: number;        // @IsInt @Min(0) @Max(12)
  modoRedondeo: string;         // @IsIn(['HALF_UP','HALF_EVEN','FLOOR','CEIL'])
  montoTolerancia: string;      // @IsNumberString — string end-to-end
}
```

Validación con `class-validator`:
- `formula` debe ser un array con exactamente 3 elementos
- Cada elemento debe ser uno de: 'descuentos', 'recargos', 'impuestos'
- No hay duplicados
- `escalaCalculo`: entero entre 0 y 12
- `modoRedondeo`: uno de 'HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL'
- `montoTolerancia`: number string (p.ej. `"1.5"`) — string de punta a punta

### Key Methods

**Service**:
- `getPreferenciasFinancieras(tenantId: string): Promise<PreferenciasFinancierasDto>` — Lee de `tenants` y `tenant_formula_precio`
- `updatePreferenciasFinancieras(tenantId: string, dto: UpdatePreferenciasFinancierasDto): Promise<PreferenciasFinancierasDto>` — Actualiza ambas tablas en una transacción

**Controller**:
- `GET /api/tenants/preferencias-financieras` — Endpoint admin-only (TenantAdminGuard)
- `PUT /api/tenants/preferencias-financieras` — Endpoint admin-only (TenantAdminGuard)

---

## Frontend

### Pages

- `pages/configuracion/preferencias-financieras.vue` — Única página, muestra formulario de edición en línea (edit-inline)

### Components

La página usa estado local (`ref`) — sin Pinia store. Secciones del formulario:
- `URadioGroup` para `calculoDescuentos` y `calculoRecargos`
- Lista reordenable (botones arriba/abajo) para `formula`
- Sección "Precisión y redondeo":
  - `UInput type="number"` para `escalaCalculo` (entero real → excepción del patrón, @IsInt)
  - `URadioGroup` con 4 opciones para `modoRedondeo`
  - `UInput inputmode="decimal"` para `montoTolerancia` (string end-to-end, @IsNumberString)
- Botón guardar

### State

```typescript
{
  calculoDescuentos: 'base' | 'compuesto' — ref
  calculoRecargos: 'base' | 'compuesto'   — ref
  formula: string[]                        — ref
  escalaCalculo: number                    — ref (default 6)
  modoRedondeo: string                     — ref (default 'HALF_UP')
  montoTolerancia: string                  — ref (default '0', string end-to-end)
}
```

**Actions**:
- `fetch()` — `GET /api/tenants/preferencias-financieras`
- `update(dto)` — `PUT /api/tenants/preferencias-financieras`

---

## Data Flow

### Load & Display

```
[User navigates to Configuración > Preferencias Financieras]
  ↓
[Page mounted, composable usePreferenciasFinancieras()]
  ↓ store.fetch()
[GET /api/tenants/preferencias-financieras]
  ↓
[Backend service lee tenants.calculo_descuentos, .calculo_recargos]
[Backend service lee tenant_formula_precio ordenado por paso]
  ↓ respuesta PreferenciasFinancierasDto
[Store actualiza state]
  ↓
[UI renderiza form con valores]
```

### Save

```
[User modifica valores y hace clic en "Guardar"]
  ↓ store.update(nuevasPreferencias)
[PUT /api/tenants/preferencias-financieras, body = dto]
  ↓
[Backend valida DTO]
  ↓ si inválido: 400 Bad Request
[Backend inicia transacción]
  ↓
[Actualiza tenants.calculo_descuentos, tenants.calculo_recargos]
[Borra filas de tenant_formula_precio para este tenant]
[Inserta nuevas filas con los pasos en orden]
  ↓ commit
[Response 200 con PreferenciasFinancierasDto]
  ↓
[Store actualiza estado]
[UI muestra toast "Guardado"]
```

---

## Testing

### Unit Tests (Backend)

```bash
npm test -- modules/tenants/tenants.service.spec.ts
npm test -- modules/tenants/tenants.controller.spec.ts
```

**Casos clave:**
- Validación de fórmula: rechaza fórmulas incompletas, con duplicados, con valores inválidos
- Lectura por tenant: verifica que se lean `calculo_descuentos`, `calculo_recargos` y el array de pasos
- Escritura: verifica que se actualicen ambas tablas atómicamente
- Permissions: verifica que solo admin pueda escribir (PUT)

### Manual Testing (Swagger)

1. Open http://localhost:3000/api/docs
2. Autenticar como usuario admin
3. Navegar a `GET /api/tenants/preferencias-financieras` — debe retornar las prefs actuales
4. Llamar a `PUT /api/tenants/preferencias-financieras` con una fórmula válida — debe actualizar
5. Llamar a `PUT` con una fórmula inválida (p. ej. duplicados) — debe retornar 400

### Manual Testing (Frontend)

1. Start: `docker-compose up`
2. Login como admin
3. Navegar a Configuración > Preferencias Financieras
4. Modificar cálculos y fórmula
5. Guardar y verificar que persista (recarga la página)
6. Verificar que valores inválidos muestren error

---

## Acceptance Criteria

- [x] Tabla `tenant_formula_precio` creada en BD
- [x] Columnas `calculo_descuentos`, `calculo_recargos` agregadas a `tenants`
- [x] DTOs con validación
- [x] Endpoint GET implementado
- [x] Endpoint PUT implementado con validación de fórmula
- [x] Guard RBAC en PUT (admin only)
- [x] Transacción atomic en actualización
- [x] Página frontend (form de edición)
- [x] Pinia store con fetch + update
- [x] Documentación actualizada (este archivo, CLAUDE.md)

---

## Related Features

- [Motor de cálculo de precios](../../CLAUDE.md#estado-actual) (🔲 Por construir) — consumirá estas preferencias
- [Configuración de monedas por tenant](./configuracion-monedas.md) — otra configuración financiera del tenant
- [Catálogos financieros](../../CLAUDE.md#estado-actual) — definición de descuentos, recargos, impuestos

---

## Notes

- **Default al crear un tenant:** la fórmula default es `['descuentos', 'recargos', 'impuestos']` con `calculo_descuentos = 'base'` y `calculo_recargos = 'base'`. Ver seeder en `backend/src/modules/seeder/seeder.service.ts`.
- **Moneda:** las preferencias financieras son globales por tenant, independientes de la moneda. El cálculo se aplica al mismo monto en cualquier moneda.
- **Fase siguiente:** una vez que el motor de cálculo de precios esté implementado, estas prefs serán consultadas en cada línea de venta para aplicar el descuento, recargo e impuesto en el orden y modo configurado.
