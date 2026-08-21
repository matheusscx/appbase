# Feature: Preferencias Financieras

**Status**: Complete  
**Owner**: Desarrollo Backend/Frontend  
**Last Updated**: 2026-08-21

---

## Overview

### What is it?

Preferencias Financieras es una pantalla de configuración que permite al administrador del tenant personalizar cómo se calculan los precios finales de venta. Específicamente:

1. **Modo de cálculo de descuentos**: `base` (todos los descuentos se aplican sobre el precio neto) o `compuesto` (cada descuento se aplica en cascada sobre el resultado anterior).
2. **Modo de cálculo de recargos**: `base` (todos sobre precio neto) o `compuesto` (en cascada).
3. **Orden de la fórmula de precios**: reordenar los tres pasos (descuentos, recargos, impuestos) en la secuencia que prefiera.
4. **Escala de cálculo** (`escalaCalculo`, default 6): la precisión del **borrador**, o sea de los cálculos intermedios. Con `nivelRedondeo = 'linea'` **no decide nada de lo persistido** — eso lo decide la escala de la moneda oficial. Con `'documento'` sí, porque ahí las líneas se guardan sin cuantizar: por eso esa combinación tiene tope 4 (ver la validación del service).
5. **Modo de redondeo** (`modoRedondeo`, default `HALF_UP`): con qué criterio se redondea (`HALF_UP` | `HALF_EVEN` | `FLOOR` | `CEIL`). Es el modo que usa la cuantización final, así que hoy los cuatro producen totales distintos sobre el mismo carrito.
6. **Nivel de redondeo** (`nivelRedondeo`, default `linea`): `linea` (cada línea de la venta se cuantiza a la escala de la moneda y el total es la suma) o `documento` (las líneas quedan a `escalaCalculo` y solo el total final se cuantiza — la regla mexicana). El motor de cálculo de precios la consume vía `ConfigCalculo`.
7. **Tolerancia de conciliación** (`montoTolerancia`, default `'0'`): diferencia máxima permitida antes de rechazar una conciliación.

⚠️ **Esta lista enumeraba 3 campos cuando la pantalla mostraba 6.** Se corrigió el 2026-08-21, contando los controles del `.vue` en vez de asumirlos: hoy son **7**, y `nivelRedondeo` es el que agregó el frente de redondeo de plata.

La configuración se persiste en la base de datos y **el motor de cálculo de precios la consume en cada venta** desde junio de 2026 (ver [motor-calculo-precios.md](./motor-calculo-precios.md)). Este documento decía *"pendiente"* hasta el 2026-08-21.

### Why does it exist?

Diferentes tipos de negocio y regímenes fiscales requieren distintas estrategias de cálculo de precios. Algunos aplican todos los descuentos sobre el precio base; otros los aplican en cascada. El orden de aplicación de impuestos, descuentos y recargos también varía según la jurisdicción. Esta pantalla permite a cada tenant configurar su propia lógica sin cambiar el código.

### Scope

- **Included in this version:**
  - Lectura y escritura de preferencias (`GET` y `PUT`)
  - Validación de la fórmula (contiene exactamente los 3 pasos, sin duplicados)
  - Validación de la matriz `nivelRedondeo` × moneda oficial × `escalaCalculo`: rechaza
    `documento` con moneda de 0 decimales, `escalaCalculo` menor que los decimales de la
    moneda oficial, y `documento` con `escalaCalculo` mayor que 4
  - Persistencia en `tenants.calculo_descuentos`, `tenants.calculo_recargos`,
    `tenants.nivel_redondeo`, y tabla `tenant_formula_precio`
  - Acceso restringido a admin del tenant (guard RBAC)
  
- **NOT included (future):**
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
  "nivelRedondeo": "linea",
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
  "nivelRedondeo": "linea",
  "montoTolerancia": "1500"
}

Response (200):
{
  "calculoDescuentos": "compuesto",
  "calculoRecargos": "base",
  "formula": ["recargos", "descuentos", "impuestos"],
  "escalaCalculo": 4,
  "modoRedondeo": "HALF_EVEN",
  "nivelRedondeo": "linea",
  "montoTolerancia": "1500"
}

Response (400):
{
  "message": "Formula debe contener exactamente ['descuentos', 'recargos', 'impuestos'] sin duplicados",
  "statusCode": 400
}

Response (400) — matriz nivelRedondeo × moneda:
{
  "message": "El nivel \"documento\" deja decimales en las líneas y la moneda oficial del tenant no admite decimales. Usá \"linea\".",
  "statusCode": 400
}

Response (400) — matriz nivelRedondeo × escalaCalculo:
{
  "message": "El nivel \"documento\" persiste las líneas con la escala de cálculo (6 decimales) y las columnas de dinero son NUMERIC(18,4): el recorte lo terminaría decidiendo Postgres, fuera del modo de redondeo del tenant. Bajá la escala de cálculo a 4 o menos, o usá \"linea\".",
  "statusCode": 400
}

Response (400) — escala de `montoTolerancia` (`EscalaMonedaPipe`):
{
  "message": "montoTolerancia tiene más decimales de los que admite la moneda (0).",
  "statusCode": 400
}
```

⚠️ **`montoTolerancia` es un monto cobrado, no un número libre.** El ejemplo de arriba
usa `"1500"` a propósito: para todo tenant sembrado la moneda oficial es CLP (0
decimales), así que un `"1.5"` —que este documento mostraba como request válido hasta
el 2026-08-21— hoy es un 400. En un tenant en dólares `"1.5"` sí entra.

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
| `nivel_redondeo` | TEXT | NOT NULL, default 'linea', CHECK IN ('linea','documento') | 'linea' cuantiza cada línea; 'documento' solo el total (regla mexicana) |
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
  nivelRedondeo: string;        // 'linea' | 'documento'
  montoTolerancia: string;      // numeric como string (Decimal.js)
}

// PUT request
export class UpdatePreferenciasFinancierasDto {
  calculoDescuentos: 'base' | 'compuesto';
  calculoRecargos: 'base' | 'compuesto';
  formula: ('descuentos' | 'recargos' | 'impuestos')[];
  escalaCalculo: number;        // @IsInt @Min(0) @Max(12)
  modoRedondeo: string;         // @IsIn(['HALF_UP','HALF_EVEN','FLOOR','CEIL'])
  nivelRedondeo: string;        // @IsIn(['linea','documento'])
  montoTolerancia: string;      // @IsNumberString @IsDecimalNoNegativo @EsMontoCobrado
}
```

Validación con `class-validator`:
- `formula` debe ser un array con exactamente 3 elementos
- Cada elemento debe ser uno de: 'descuentos', 'recargos', 'impuestos'
- No hay duplicados
- `escalaCalculo`: entero entre 0 y 12
- `modoRedondeo`: uno de 'HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL'
- `nivelRedondeo`: 'linea' o 'documento'
- `montoTolerancia`: number string, nunca negativo, y con **como mucho los decimales que
  admite la moneda oficial del tenant** (`@EsMontoCobrado()` + `EscalaMonedaPipe`, colgado
  del `@Body` de esta ruta). En CLP eso es cero: `"1.5"` es un 400.

Validación adicional en el service (no expresable con `class-validator`, depende de la
moneda oficial del tenant — `MonedasService.decimalesOficiales`). Son **tres** reglas, y
las tres existen por la misma razón: que ninguna combinación configurable devuelva el
último redondeo al cast de Postgres.
- `nivelRedondeo = 'documento'` con moneda oficial de 0 decimales → 400. Las líneas
  quedarían con decimales que la moneda no puede representar; es exactamente el bug que
  el frente de redondeo de plata vino a cerrar, ofrecido como opción de configuración.
- `escalaCalculo` menor que los decimales de la moneda oficial → 400. El borrador de los
  cálculos intermedios no puede ser más grueso que el resultado final.
- `nivelRedondeo = 'documento'` con `escalaCalculo` mayor que **4** → 400. Con
  `'documento'` las líneas se persisten sin cuantizar, formateadas a `escalaCalculo`, y
  toda columna de plata de `venta_detalles` es `NUMERIC(18,4)`: una escala mayor deja el
  recorte final en manos de Postgres y rompe la identidad `Σ totalLinea − dv + rv =
  totalFinal` al releer las filas. El tope es la escala de la **columna**, no los
  decimales de la moneda, porque lo que se controla es lo que entra a la columna. Con
  `'linea'` no aplica: ahí el valor ya sale cuantizado a los decimales de la moneda (≤ 4
  por el `@Check` de `moneda.decimales`) y lo que agrega el formateo son ceros — por eso
  el default sembrado (escala 6, nivel `'linea'`) sigue siendo válido.

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
  - `URadioGroup` con 2 opciones para `nivelRedondeo` ("Por línea" / "Por documento"),
    con texto de ayuda en lenguaje de negocio, no técnico
  - `MoneyInput oficial` para `montoTolerancia` (string end-to-end): es un monto cobrado
    en la moneda oficial y el backend lo rechaza con 400 si trae más decimales de los que
    ésta admite, así que el input no lo deja tipear. Era un `UInput inputmode="decimal"`
    hasta el 2026-08-21 — mismo caso que el monto manual de propinas
- Botón guardar

### State

```typescript
{
  calculoDescuentos: 'base' | 'compuesto' — ref
  calculoRecargos: 'base' | 'compuesto'   — ref
  formula: string[]                        — ref
  escalaCalculo: number                    — ref (default 6)
  modoRedondeo: string                     — ref (default 'HALF_UP')
  nivelRedondeo: string                    — ref (default 'linea')
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
- [x] `nivelRedondeo` configurable, con la matriz de combinaciones prohibidas contra la
      moneda oficial del tenant
- [x] Guard RBAC en PUT (admin only)
- [x] Transacción atomic en actualización
- [x] Página frontend (form de edición)
- [x] Pinia store con fetch + update
- [x] Documentación actualizada (este archivo, CLAUDE.md)

---

## Related Features

- [Motor de cálculo de precios](./motor-calculo-precios.md) — consume estas preferencias
- [Configuración de monedas por tenant](./configuracion-monedas.md) — otra configuración financiera del tenant
- [Catálogos financieros](../ESTADO.md) — definición de descuentos, recargos, impuestos

---

## Notes

- **Default al crear un tenant:** la fórmula default es `['descuentos', 'recargos', 'impuestos']` con `calculo_descuentos = 'base'` y `calculo_recargos = 'base'`. Ver seeder en `backend/src/modules/seeder/seeder.service.ts`.
- **Moneda:** la mayoría de las preferencias son globales por tenant, independientes de la moneda. La excepción es `nivelRedondeo`: el service la valida contra `MonedasService.decimalesOficiales(tenantId)` (misma noción de "moneda oficial" que usa el motor de precios) porque 'documento' solo tiene sentido si la moneda admite decimales.
- **Consumo real (desde 2026-06-28):** el motor consulta estas prefs en cada línea de venta para aplicar descuento, recargo e impuesto en el orden y modo configurado, y las **congela** en `ventas.config_calculo` — junto con `nivelRedondeo` y la escala de la moneda con la que cerró. Cambiar una preferencia no reescribe el pasado: una venta vieja se lee con su propio snapshot.
