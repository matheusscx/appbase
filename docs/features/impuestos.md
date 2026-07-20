# Feature: Catálogo de impuestos del sistema + clasificación tributaria

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-19

---

## Overview

### What is it?

Catálogo de impuestos con dos orígenes que conviven en la misma tabla:

- **Sistema**: impuestos oficiales por país (ej. IVA Chile 19%), compartidos por
  todos los tenants de ese país, administrados solo vía seeder — sin CRUD.
- **Personalizado**: impuestos propios de un tenant (como antes de este cambio).

Además, cada item lleva una **clasificación tributaria** explícita (`afecto` |
`exento`) que se congela por línea al vender, y que el motor de precios usa para
decidir qué impuestos aplicar en esa línea.

### Why does it exist?

Antes, los impuestos eran 100% por tenant: cada tenant chileno creaba su propio
"IVA 19%" (el seeder mismo sembraba uno por tenant), sin ninguna fuente única de
verdad ni garantía de que coincidieran entre sí. Tampoco existía una forma
explícita de marcar un item como exento — sería equivalente a "no tiene impuestos
asignados", ambiguo entre "exento por ley" y "olvidaron asignarle impuesto"
(prohibido por [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md): "exento"
debe ser un estado explícito).

Ver el razonamiento completo (alternativas descartadas, base legal) en
[ADR-011](../adr/011-catalogo-impuestos-sistema.md).

### Scope

- **Incluido**: catálogo de impuestos del sistema por país (hoy: IVA Chile);
  convivencia con impuestos personalizados por tenant; campo `tipo` (`'iva'` |
  `'otro'`) en todo impuesto; clasificación tributaria `afecto`/`exento` en todos
  los tipos de item; congelamiento de la clasificación en `venta_detalles` al
  vender (venta normal y nota de crédito); motor de precios suprime impuestos
  `tipo='iva'` en líneas exentas (los `tipo='otro'` siempre aplican); migración
  automática e idempotente de duplicados de IVA por tenant hacia el impuesto del
  sistema.
- **NO incluido (futuro)**: CRUD superadmin para administrar el catálogo del
  sistema (agregar un país nuevo = agregar su catálogo al seed); impuestos
  adicionales chilenos concretos (ILA, bebidas analcohólicas, suntuarios) en el
  seed — el modelo ya los soporta (`tipo='otro'`) pero no se siembran hoy;
  indicador "Exento" impreso en boletas/recibos y emisión DTE (diferido por
  ADR-010); nuevas clasificaciones tributarias más allá de afecto/exento.

---

## API Endpoints

```
GET /impuestos
Authorization: Bearer <token>   (JwtAuthGuard + TenantGuard)

Response (200):
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440280",
    "tenantId": null,
    "paisId": "550e8400-e29b-41d4-a716-446655440000",
    "tipo": "iva",
    "nombre": "IVA",
    "porcentaje": "0.1900",
    "activo": true,
    "origen": "sistema"
  },
  {
    "id": "...",
    "tenantId": "<tenant>",
    "paisId": null,
    "tipo": "otro",
    "nombre": "Impuesto verde",
    "porcentaje": "0.0500",
    "activo": true,
    "origen": "personalizado"
  }
]
```

```
POST   /impuestos          (TenantAdminGuard) — crea impuesto PERSONALIZADO del tenant
PATCH  /impuestos/:id       (TenantAdminGuard) — 404 si :id es del sistema (tenant_id NULL no matchea el WHERE)
DELETE /impuestos/:id       (TenantAdminGuard) — idem, soft delete

Request (POST/PATCH):
{
  "nombre": "Impuesto verde",
  "porcentaje": "0.05",     // decimal: 0.19 = 19%
  "activo": true,
  "tipo": "otro"            // opcional, default 'otro'; 'iva' | 'otro'
}
```

No existe endpoint para crear impuestos del sistema — se siembran solo vía
`seeder.service.ts` (ver más abajo).

---

## Backend

### Módulo & Servicios

- **Module**: `src/modules/impuestos/impuestos.module.ts`
- **Controller**: `src/modules/impuestos/impuestos.controller.ts`
- **Service**: `src/modules/impuestos/impuestos.service.ts`
- **Entity**: `src/modules/impuestos/entities/impuesto.entity.ts`

### Entity & Database

**Tabla**: `impuestos`

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `impuesto_id` | UUID | PK | |
| `tenant_id` | UUID | nullable | `NULL` en filas del sistema |
| `pais_id` | UUID | nullable, FK `pais` | `NULL` en filas personalizadas |
| — | — | `CHECK (tenant_id IS NULL) <> (pais_id IS NULL)` | exactamente uno de los dos |
| `tipo` | TEXT | default `'otro'` | `'iva'` \| `'otro'` |
| `nombre` | TEXT | | |
| `porcentaje` | NUMERIC(7,4) | | decimal: `0.19` = 19% |
| `activo` | BOOLEAN | default `true` | |
| `creado_el`/`actualizado_el`/`eliminado_el` | TIMESTAMPTZ | | soft delete estándar |

**Sistema**: `(tenant_id NULL, pais_id set)` — ej. IVA Chile, id fijo del seeder
`550e8400-e29b-41d4-a716-446655440280`, `tipo='iva'`, `porcentaje='0.19'`.
**Personalizado**: `(tenant_id set, pais_id NULL)`.

**Tabla `items`** — nueva columna en la base (todos los tipos: producto,
servicio, suscripción, ingrediente):

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `clasificacion_tributaria` | TEXT | default `'afecto'` | `'afecto'` \| `'exento'` |

**Tabla `venta_detalles`** — snapshot congelado al vender:

| Columna | Tipo | Constraints | Notas |
|---|---|---|---|
| `clasificacion_tributaria` | TEXT | default `'afecto'` | copiado del item al crear el detalle; ventas históricas quedan `'afecto'` |

Sin cambios en `item_impuestos` ni `ventas_impuestos` (mismas FKs de siempre).

### DTOs

- `CreateImpuestoDto` / `UpdateImpuestoDto` (`dto/`) — `tipo?: 'iva' | 'otro'`
  (`@IsIn(['iva', 'otro'])`), default `'otro'` cuando se omite.

### `ImpuestosService`

- `findAll(tenantId)`: resuelve el país del tenant
  (`tenants.provincia_id → provincia.pais_id`) y devuelve
  `WHERE tenant_id = :t OR pais_id = :pais` (`AND eliminado_el IS NULL`), con
  `origen: 'sistema' | 'personalizado'` derivado de si `tenantId` es `null` en la
  fila.
- `create`/`update`/`remove`: siempre filtran por `tenant_id = :tenantId` — las
  filas del sistema (`tenant_id NULL`) nunca matchean ese filtro, así que
  cualquier intento de mutarlas devuelve 404 sin necesidad de un guard adicional.

### Motor de precios (`CalculoPreciosService`)

Cada línea lleva la `clasificacionTributaria` del item. Si es `'exento'`, se
filtran de esa línea los impuestos con `tipo === 'iva'` **antes** del paso de
impuestos de la fórmula; los `tipo === 'otro'` se aplican siempre, exento o no.
Los impuestos del sistema entran automáticamente al cálculo porque
`ImpuestosService.findAll` ya los incluye en la unión.

```ts
// calculo-precios.service.ts (resumen)
impuestosLinea.filter(
  (imp) => item.clasificacionTributaria !== 'exento' || imp.tipo !== 'iva',
);
```

### `VentasService`

Al persistir cada `venta_detalle` en una venta normal, copia
`clasificacionTributaria` del item (`item.clasificacionTributaria ?? 'afecto'`).
En una **nota de crédito**, el detalle se genera a partir de
`validarDevolucionesReembolso`, que **lee la clasificación directamente del
`venta_detalles` de la venta original** (no vuelve a leer el item actual) — así
la NC refleja fielmente lo que se vendió, aunque el item haya cambiado de
clasificación después.

### Seeder (`seeder.service.ts`)

1. **Catálogo del sistema**: siembra IVA de Chile con id fijo
   `550e8400-e29b-41d4-a716-446655440280`, `paisId` = Chile, `tipo='iva'`,
   `porcentaje='0.19'` (si no existe ya).
2. **Remapeo idempotente** (`remapImpuestosOficialesDuplicados`): detecta
   impuestos personalizados por tenant cuyo `porcentaje` coincide con el IVA
   oficial del país del tenant y cuyo `nombre` contiene "IVA" (case-insensitive);
   remapea `item_impuestos.impuesto_id` hacia el del sistema (insert + delete de
   la fila vieja del join) y soft-deletea el impuesto duplicado. Corre en cada
   arranque del backend; correrlo dos veces no produce cambios nuevos.
   `ventas_impuestos` histórico no se toca (el snapshot ya congeló porcentaje y
   valor; la fila soft-deleteada sigue existiendo).

---

## Frontend

### `configuracion/impuestos.vue`

- Lista unificada con badge de **origen**: "Sistema" (color `info`) /
  "Personalizado" (color `neutral`).
- Filas de origen `'sistema'`: solo lectura — sin editar, sin eliminar, sin
  toggle de activo (los handlers de editar/eliminar retornan temprano si
  `origen === 'sistema'`).
- Form de alta/edición (solo aplica a personalizados): campo **Tipo** (`USelect`
  "IVA"/"Otro", default "Otro") con ayuda contextual: "Los impuestos tipo IVA no
  se aplican a items exentos."

### `configuracion/items.vue`

- Selector de impuestos: cada opción muestra `"${nombre} (Sistema)"` cuando
  `origen === 'sistema'`, sin sufijo para personalizados.
- Campo **Clasificación tributaria** (`Afecto` default | `Exento`), visible para
  todos los tipos de item, con ayuda: "Exento: no se aplica IVA (los demás
  impuestos sí). Se congela en cada venta."

### POS / tienda / salones

Sin cambios — el cálculo viene íntegro del backend
(`POST /calculo-precios/calcular`). Mostrar "Exento" en boletas/recibos queda
fuera de alcance (llegará con la emisión fiscal, ver ADR-010).

---

## Data Flow

### Ejemplo: vender un item exento con un impuesto adicional (`tipo='otro'`)

```
[Item catálogo: clasificacionTributaria='exento',
 impuestos asociados = [IVA (sistema, tipo='iva'), Impuesto verde (tenant, tipo='otro')]]
  ↓
[POS agrega la línea al carrito]
  ↓ POST /calculo-precios/calcular
[CalculoPreciosService: línea exenta → filtra impuestos tipo='iva' → solo aplica "Impuesto verde"]
  ↓
[POST /ventas: VentasService copia clasificacionTributaria del item al venta_detalle]
  ↓
[venta_detalles.clasificacion_tributaria = 'exento' (congelado, no cambia aunque el item cambie después)]
```

---

## Testing

### Unit Tests (Backend)

```bash
cd backend && npm test -- modules/impuestos/impuestos.service.spec.ts
cd backend && npm test -- modules/calculo-precios/calculo-precios.service.spec.ts
cd backend && npm test -- modules/ventas/ventas.service.spec.ts
```

- `impuestos.service.spec`: `findAll` devuelve la unión sistema+tenant con
  `origen` correcto; `create`/`update`/`remove` no alcanzan filas del sistema
  (404); `tipo` default `'otro'`.
- `calculo-precios.service.spec`: línea exenta omite impuestos `tipo='iva'` y
  conserva `tipo='otro'`; línea afecta sin cambios de comportamiento.
- `ventas.service.spec`: `clasificacion_tributaria` congelada en el detalle
  (venta normal y nota de crédito, usando el valor original de la venta
  referenciada).

### Manual

1. `docker-compose down -v && docker-compose up -d --build` (seed desde cero).
2. `/configuracion/impuestos` → IVA aparece con badge "Sistema", solo lectura.
3. POS: vender un item `afecto` con IVA asociado → suma IVA; vender un item
   `exento` → no suma IVA pero sí impuestos `tipo='otro'` que tenga asociados.
4. Segundo arranque del backend sin `down -v` → sin cambios nuevos en
   `impuestos` (verifica idempotencia del remapeo).

---

## Related Features

- [ADR-011](../adr/011-catalogo-impuestos-sistema.md) — decisión completa: modelado, semántica de exento, alternativas descartadas.
- [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md) — regla transversal: capturar/congelar el hecho fiscal ahora, diferir DTE.
- [motor-calculo-precios.md](./motor-calculo-precios.md) — motor que consume estos impuestos.
- [ventas.md](./ventas.md) — persistencia de `venta_detalles` y notas de crédito.
