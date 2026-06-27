# Feature: Descuentos y Recargos — Formularios dinámicos por tipo

**Status**: Implemented
**Owner**: Cesar Matheus
**Last Updated**: 2026-06-27

---

## Overview

### What is it?

Las pantallas de gestión de descuentos y recargos adaptan dinámicamente sus formularios
según el `tipo_regla` seleccionado. Cada uno de los 10 tipos muestra únicamente los campos
relevantes: tabla de tramos, multi-select de métodos de pago, días de vencimiento, fechas
de vigencia, o un valor fijo simple.

### Why does it exist?

Los formularios previos eran estáticos y mostraban todos los campos sin importar el tipo,
generando confusión y datos incompletos. El spec de descuentos/recargos requiere que cada tipo
capture exactamente los datos que necesita para que el motor de precios pueda evaluarlos.

### Scope

- Incluido en esta versión:
  - 10 `tipos_regla` en seeder (PORCENTAJE, MONTO_FIJO, POR_MAYOR, POR_MONTO_VENTA, METODO_PAGO, PRONTO_PAGO, MORA, RECARGO_METODO_PAGO, RECARGO_FIJO, RECARGO_PORCENTAJE)
  - Almacenamiento relacional de tramos y bridges de métodos de pago
  - Formularios dinámicos en frontend (descuentos y recargos)
  - Endpoint `nombre-disponible` para validación en tiempo real
  - 122 tests TDD (unitarios + integración)

- NOT included (future):
  - Evaluación de condiciones en el motor de cálculo de precios
  - Aplicación de tramos y métodos a ventas
  - UI para gestión de la tabla `tipos_regla` (es solo seed por ahora)

---

## API Endpoints

### Descuentos

```
GET /api/descuentos
Authorization: Bearer <token>
Response (200): Descuento[] — incluye tramos[] y metodosPago[]

POST /api/descuentos
Authorization: Bearer <token>
Body: CreateDescuentoDto
Response (201): Descuento

PATCH /api/descuentos/:id
Authorization: Bearer <token>
Body: UpdateDescuentoDto
Response (200): Descuento

DELETE /api/descuentos/:id
Authorization: Bearer <token>
Response (200): { message: 'Descuento eliminado' }

GET /api/descuentos/nombre-disponible?nombre=<str>&excludeId=<uuid>
Authorization: Bearer <token>
Response (200): { disponible: boolean }
```

### Recargos

Mismos endpoints bajo `/api/recargos`.

---

## Backend

### Modules & Services

- **Módulo descuentos**: `src/modules/descuentos/`
- **Módulo recargos**: `src/modules/recargos/`
- **Módulo tipos-regla**: `src/modules/tipos-regla/`

### Entities & Database

**Tablas principales (preexistentes, extendidas):**

| Tabla | Cambio |
|-------|--------|
| `descuentos` | `valor` ahora nullable |
| `recargos` | `valor` ahora nullable |

**Nuevas tablas:**

| Tabla | Descripción |
|-------|-------------|
| `descuento_tramos` | Tramos de descuento (minimo, maximo nullable, valor). PK UUID, FK descuento_id |
| `recargo_tramos` | Tramos de recargo. Misma estructura |
| `descuento_metodo_pago` | Bridge descuento ↔ metodo_pago. PK compuesta |
| `recargo_metodo_pago` | Bridge recargo ↔ metodo_pago. PK compuesta |

Todas con soft delete (`eliminado_el`) y timestamps.

### DTOs (extendidos)

- `CreateDescuentoDto` / `UpdateDescuentoDto`: nuevos campos `metodoPagoIds?: string[]`,
  `tramos?: TramoDto[]`, `diasVencimiento?: number`, `fechaInicio?: string`, `fechaFin?: string`
- `TramoDto`: `{ minimo: string, maximo?: string, valor: string }` (strings para `@IsNumberString`)

### Key Methods

- `service.create(dto, tenantId)` — crea descuento/recargo + hijos (tramos, bridges) en transacción
- `service.update(id, dto, tenantId)` — reemplaza hijos completos (delete all → insert new)
- `service.findAll(tenantId)` — trae entidades con relaciones `tramos` y `metodosPago`
- `service.nombreDisponible(nombre, tenantId, excludeId?)` — check unicidad de nombre

---

## Frontend

### Pages

- `app/pages/configuracion/descuentos.vue` — lista + formulario dinámico inline
- `app/pages/configuracion/recargos.vue` — igual estructura

### Utilities

- `app/utils/reglas-form-config.ts` — configuración declarativa por tipo de regla:
  qué campos mostrar, labels, validaciones. Consultar este archivo para agregar nuevos tipos.

### Data Flow

```
[Usuario abre modal crear/editar]
  ↓
[Selecciona tipo_regla]
  ↓
[reglas-form-config.ts devuelve { campos: [...] } para ese tipo]
  ↓
[Template renderiza campos condicionalmente con v-if]
  ↓
[guardar() arma payload con { tipoReglaId, valor?, tramos?, metodoPagoIds?, diasVencimiento? }]
  ↓
[POST/PATCH /api/descuentos|recargos]
  ↓
[Backend valida, persiste transaccionalmente, devuelve entidad enriquecida]
  ↓
[cargar() re-fetch → lista actualizada]
```

---

## Testing

### Unit Tests (Backend)

```bash
cd backend
npm test -- --testPathPattern=descuentos
npm test -- --testPathPattern=recargos
```

122 tests passing (service + controller, descuentos + recargos).

### Manual Testing

1. `docker-compose up`
2. Login como admin → `/configuracion/descuentos`
3. Crear descuento con tipo POR_MAYOR → debe mostrar tabla de tramos
4. Crear descuento con tipo METODO_PAGO → debe mostrar multi-select de métodos
5. Editar → los campos pre-cargan correctamente
6. Verificar en Swagger: `GET /api/descuentos` retorna `tramos` y `metodosPago`

---

## Acceptance Criteria

- [x] 10 tipos_regla en seeder
- [x] 4 nuevas tablas relacionales
- [x] valor nullable en descuentos y recargos
- [x] DTOs extendidos con validación class-validator
- [x] Servicio transaccional (create/update con reemplazo de hijos)
- [x] Endpoint nombre-disponible
- [x] 122 tests TDD passing
- [x] Formularios dinámicos en frontend
- [x] reglas-form-config.ts como fuente de verdad de la lógica de campos

---

## Related

- [ADR-006: Modelado relacional de tramos y métodos de pago](../adr/006-relational-tramos-and-metodos-pago.md)
- [Preferencias financieras](./preferencias-financieras.md) — fórmula de precios que consume estas reglas
- [Plan de implementación](../superpowers/plans/2026-06-27-descuentos-recargos-formularios-dinamicos.md)
