---
name: preferencias-financieras
description: Nueva sección de Configuración para definir modo de cálculo de descuentos y recargos (base vs compuesto) y el orden de la fórmula de precios del tenant
metadata:
  type: project
  status: Draft
  date: 2026-06-24
  owner: Cesar Matheus
---

# Plan: Preferencias financieras

## Context

El tenant necesita configurar **cómo se combinan** descuentos, recargos e impuestos al calcular precios:

1. **Cálculo de descuentos**: `base` (todos los descuentos sobre el precioNeto) vs `compuesto` (en cascada, cada uno sobre el acumulado anterior). Ya existe el campo `tenants.calculo_descuentos`, pero no hay UI para editarlo.
2. **Cálculo de recargos**: mismo concepto, pero para recargos. **No existe** el campo todavía.
3. **Orden de la fórmula**: en qué orden se aplican los 3 pasos (`descuentos`, `recargos`, `impuestos`). Ya existe la tabla `tenant_formula_precio` (sembrada con el default `descuentos → recargos → impuestos`), pero no hay endpoint para leerla ni editarla.

Estas tres configuraciones viven hoy dispersas (una columna existente, una columna faltante, una tabla sin API) y sin ninguna pantalla. Este plan las unifica bajo una sola sección de Configuración llamada **"Preferencias financieras"**, dentro del clúster financiero del menú (Monedas, Categorías, Impuestos, Descuentos, Recargos, Métodos de pago).

**Importante:** el "Motor de cálculo de precios" que *consume* esta configuración está marcado 🔲 *Por construir* en el `CLAUDE.md`. Este plan solo construye el **almacenamiento + la UI de configuración**, no la lógica de cálculo.

## Scope

**In scope:**
- Nueva columna `tenants.calculo_recargos` (espejo de `calculo_descuentos`).
- Endpoints backend para leer y actualizar las preferencias financieras (modos de cálculo + orden de fórmula) en un solo grupo cohesivo.
- Nuevo item "Preferencias financieras" en el menú lateral de Configuración (solo admin).
- Nueva página de configuración con: dos selectores de modo de cálculo + reordenamiento de los 3 pasos de la fórmula + guardar.
- Tests backend del nuevo método de service.
- Documentación: `startup-pos.sql`, `docs/features/`, tabla de estado en `CLAUDE.md`.

**Out of scope:**
- El motor de cálculo de precios que aplica esta configuración (fase separada, 🔲 Por construir).
- Activar/desactivar pasos de la fórmula: los 3 pasos (`descuentos`, `recargos`, `impuestos`) siempre están presentes; solo se reordenan. `precioNeto` siempre primero y `totalFinal` siempre último (fijos, no editables).
- Cualquier preferencia financiera adicional (redondeo, etc.) — la sección queda lista para crecer, pero no se agregan ahora.

## Backend

### Entidad — `Tenant`

Agregar la columna espejo de `calculoDescuentos`:

```typescript
@Column({ name: 'calculo_recargos', default: 'base' })
calculoRecargos: string;
```

TypeORM `synchronize` (activo en dev, `NODE_ENV !== 'production'`) crea la columna automáticamente.

### Sin cambios de estructura en `tenant_formula_precio`

La tabla ya tiene `tenantId`, `paso` (smallint), `tipo`. Solo se le agrega lectura/escritura vía service.

### DTO — `UpdatePreferenciasFinancierasDto`

```typescript
export class UpdatePreferenciasFinancierasDto {
  @IsIn(['base', 'compuesto'])
  calculoDescuentos: string;

  @IsIn(['base', 'compuesto'])
  calculoRecargos: string;

  // El orden de la fórmula: array con exactamente los 3 tipos, sin repetir.
  // El `paso` (1,2,3) se deriva del índice del array — no se confía en el cliente.
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @IsIn(['descuentos', 'recargos', 'impuestos'], { each: true })
  formula: string[];
}
```

Validación adicional en el service (no expresable con decoradores): que `formula` contenga los 3 tipos **sin duplicados** (un array `['descuentos','descuentos','recargos']` pasa los decoradores pero es inválido) → `BadRequestException`.

### Service (`TenantsService`)

**`getPreferenciasFinancieras(tenantId: string)`**
```typescript
{
  calculoDescuentos: string,
  calculoRecargos: string,
  formula: string[]   // ordenada por paso asc, p.ej. ['descuentos','recargos','impuestos']
}
```
- Lee el tenant (404 si no existe) → `calculoDescuentos`, `calculoRecargos`.
- Lee `tenant_formula_precio` filtrando por `tenantId`, ordenado por `paso ASC`, y mapea a `tipo[]`.

**`updatePreferenciasFinancieras(tenantId, dto)`** — dentro de una transacción:
1. Validar que `dto.formula` tenga los 3 tipos sin duplicados (`BadRequestException` si no).
2. `UPDATE tenants SET calculo_descuentos = $1, calculo_recargos = $2 WHERE tenant_id = $tenantId`.
3. Reemplazar la fórmula: borrar las filas actuales de `tenant_formula_precio` del tenant e insertar 3 nuevas con `paso = índice + 1` según el orden de `dto.formula`.
4. Retornar la misma forma que `getPreferenciasFinancieras`.

> Nota: `tenant_formula_precio` no tiene soft delete (no tiene `eliminado_el`); el reemplazo es un `DELETE` físico + `INSERT` dentro de la transacción. Esto es consistente con cómo el seeder ya maneja la tabla.

### Controller (`TenantsController`)

Dos rutas nuevas en el controlador `/tenants` (tenant activo), ambas solo admin:

```
GET  /api/tenants/preferencias-financieras
PUT  /api/tenants/preferencias-financieras
```
- Guards: `JwtAuthGuard, TenantGuard, TenantAdminGuard` (mismo patrón que las rutas de razones sociales que ya usan `TenantAdminGuard`).
- `tenantId` siempre desde `req.user.tenantId`, nunca del body.
- `GET` responde con `{ calculoDescuentos, calculoRecargos, formula }`.
- `PUT` recibe el DTO y responde con la misma forma actualizada.

### Seeder

En `seeder.service.ts`, asegurar que los tenants sembrados tengan `calculoRecargos: 'base'` (junto al `calculoDescuentos: 'base'` que ya se setea en `seedTenants`). La fórmula sembrada en `seedTenantFormulaPrecio` no cambia.

## Frontend

### Menú — `pages/configuracion.vue`

Agregar un item nuevo en el bloque admin, después de "Recargos" y antes de "Métodos de pago":

```typescript
{
  label: 'Preferencias financieras',
  icon: 'i-heroicons-adjustments-horizontal',
  to: '/configuracion/preferencias-financieras',
},
```

### Página — `pages/configuracion/preferencias-financieras.vue`

Patrón estándar del proyecto: `useApiFetch`, `useRuntimeConfig().public.apiUrl`, `useToast`, `apiErrorMsg`.

**Estado y carga:**
- Al montar, `GET /tenants/preferencias-financieras` → llena `calculoDescuentos`, `calculoRecargos`, y `formula` (array reordenable).
- `loading` mientras carga; `saving` mientras guarda.

**UI — tres bloques:**

1. **Cálculo de descuentos** — selector (RadioGroup o Select) con:
   - "Sobre monto base" (`base`) — *Todos los descuentos se calculan sobre el precio neto.*
   - "En cascada (compuesto)" (`compuesto`) — *Cada descuento se aplica sobre el resultado del anterior.*

2. **Cálculo de recargos** — mismo selector, mismas dos opciones, textos equivalentes para recargos.

3. **Orden de la fórmula** — lista vertical reordenable de los 3 pasos. Cada fila muestra el nombre del paso (Descuentos / Recargos / Impuestos) con botones ↑ / ↓ para moverlo (deshabilitados en los extremos). Como contexto visual fijo (no editable): una fila "Precio neto" arriba y "Total final" abajo, atenuadas, para comunicar que la fórmula siempre empieza en precioNeto y termina en totalFinal.

**Guardar:**
- Botón "Guardar" → `PUT /tenants/preferencias-financieras` con `{ calculoDescuentos, calculoRecargos, formula }`.
- Éxito: toast "Preferencias actualizadas". Error: toast con `apiErrorMsg`.

## Verification

**Backend:**
- Test de `getPreferenciasFinancieras`: retorna los modos del tenant y la fórmula ordenada por paso.
- Test de `updatePreferenciasFinancieras`:
  - Persiste `calculoDescuentos` y `calculoRecargos`.
  - Reescribe `tenant_formula_precio` con los pasos 1/2/3 según el orden recibido.
  - Rechaza (`BadRequestException`) una `formula` con tipos duplicados o faltantes.
- Seguir el estilo de `tenants.service.spec.ts`.

**Frontend:**
- `npm run build` del frontend pasa.
- Verificación manual: la página carga la config actual, reordenar + cambiar modos + guardar persiste y recarga correctamente.

**Docs:**
- `startup-pos.sql`: agregar columna `calculo_recargos` a la tabla `tenants` (junto a `calculo_descuentos`, línea ~165).
- `docs/features/<feature>.md` desde el template + link en `docs/README.md`.
- Marcar el estado en la tabla de `CLAUDE.md` / `docs/MIGRACION-FUNCIONALIDADES.md`.

## Decisions / Open questions

- **Endpoint unificado, no piezas sueltas.** Un solo `GET`/`PUT` para los 3 valores en vez de mezclarlos en `PATCH /tenants/me` + endpoints sueltos de fórmula. Mantiene la sección cohesiva y la escritura atómica (transacción).
- **El `paso` se deriva del orden del array, no se confía en el cliente.** Evita inconsistencias (pasos repetidos o saltados).
- **Reemplazo físico de la fórmula** (DELETE + INSERT en transacción) porque `tenant_formula_precio` no tiene soft delete, consistente con el seeder.
- **Los 3 pasos siempre presentes; solo se reordenan.** No se permite omitir pasos en esta fase (decisión de alcance confirmada).
- **Solo configuración.** El motor que consume esta config es fase aparte.
