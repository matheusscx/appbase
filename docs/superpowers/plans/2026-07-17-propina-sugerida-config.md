# Propina sugerida configurable — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que cada tenant configure el % de propina sugerida (hoy hardcodeado en `0.10`) y que Salones lo use al cerrar cuenta.

**Architecture:** Extender `propina_configuracion` con `porcentaje_sugerido`. Exponerlo en `GET/PUT /propinas/distribucion` y en un endpoint liviano `GET /propinas/porcentaje-sugerido` (`Salones:Operar`). Config UI en la página de distribución; Salones + `CobroModal` consumen el valor con fallback `0.10`.

**Tech Stack:** NestJS, TypeORM, PostgreSQL 15, Decimal.js, Jest, Nuxt 4, Vue 3, Nuxt UI v4, `useApiFetch`.

## Global Constraints

- Trabajar directamente sobre `main`; no crear ramas ni PRs.
- Desarrollo Docker-first; no agregar dependencias npm.
- `tenant_id` siempre del JWT, nunca del body.
- Toda PK/FK UUID declara `type: 'uuid'` explícito (ADR-004).
- Soft delete: lecturas con `eliminado_el IS NULL`.
- Dinero y porcentajes con Decimal.js / `numeric` string; **porcentajes en decimal** (`0.10` = 10%).
- UI de config muestra % humano (`10`); API/BD guardan decimal (`0.10`).
- Cambiar el % **no** debe bump-ear `version` por sí solo; el bump de `PUT` sigue ocurriendo por el reemplazo de grupos.
- Fallback cobro: si falla la lectura → `'0.10'`.
- Esquema documental: `startup-pos.sql`; dev usa TypeORM `synchronize`.
- Actualizar `docs/ESTADO.md`, `docs/features/` y marcar la spec Done en el commit final de docs.

**Spec:** `docs/superpowers/specs/2026-07-17-propina-sugerida-config-design.md`

---

## Mapa de archivos

### Modificar

- `startup-pos.sql` — columna + CHECK en `propina_configuracion`
- `backend/src/modules/propinas/entities/propina-configuracion.entity.ts`
- `backend/src/modules/propinas/dto/update-distribucion.dto.ts`
- `backend/src/modules/propinas/propina-distribucion.service.ts` — tipos públicos, `asegurarDefault`, `reemplazar`, `cargarPublica`, nuevo `obtenerPorcentajeSugerido`
- `backend/src/modules/propinas/propina-distribucion.service.spec.ts`
- `backend/src/modules/propinas/propina-distribucion.controller.ts` — nuevo GET
- `backend/src/modules/tenants/tenants.service.ts` — default explícito al crear tenant (opcional si DB default basta; setear `porcentajeSugerido: '0.10'`)
- `frontend/app/composables/usePropinaDistribucion.ts`
- `frontend/app/composables/usePropina.ts` — helper fetch % + constante default
- `frontend/app/composables/usePropina.spec.ts` (si se agregan helpers de conversión)
- `frontend/app/pages/configuracion/propinas-distribucion.vue`
- `frontend/app/pages/salones/index.vue`
- `frontend/app/components/ventas/CobroModal.vue`
- `docs/features/turnos-garzones.md` o feature propinas existente / `docs/features/` tip config
- `docs/ESTADO.md`
- `docs/superpowers/specs/2026-07-17-propina-sugerida-config-design.md` → Status Done
- `docs/superpowers/specs/2026-07-17-registro-propinas-design.md` — tachar “fuera de alcance: config %” si aplica

### Crear

- Nada obligatorio (todo extiende módulo propinas existente).

---

### Task 1: Columna + entity + validación en service (TDD)

**Files:**
- Modify: `startup-pos.sql` (bloque `propina_configuracion`)
- Modify: `backend/src/modules/propinas/entities/propina-configuracion.entity.ts`
- Modify: `backend/src/modules/propinas/dto/update-distribucion.dto.ts`
- Modify: `backend/src/modules/propinas/propina-distribucion.service.ts`
- Modify: `backend/src/modules/propinas/propina-distribucion.service.spec.ts`
- Modify: `backend/src/modules/tenants/tenants.service.ts` (create con `'0.10'`)

**Interfaces:**
- Consumes: `PropinaConfiguracion`, `UpdateDistribucionDto`, `DistribucionPublica`
- Produces:
  - `PropinaConfiguracion.porcentajeSugerido: string`
  - `DistribucionPublica.porcentajeSugerido: string`
  - `UpdateDistribucionDto.porcentajeSugerido: string` (required `@IsNumberString`)
  - `PropinaDistribucionService.obtenerPorcentajeSugerido(tenantId: string): Promise<{ porcentajeSugerido: string }>`
  - Validación en `reemplazar`: `0 ≤ porcentaje ≤ 1` con Decimal; si `>= 1` o parece porcentaje humano típico (`> 1`), mensaje: `'porcentajeSugerido debe ser decimal (0.10 = 10%), no porcentaje entero'`

- [ ] **Step 1: Extender el test de `cargarPublica` / `obtener` para esperar `porcentajeSugerido`**

En `propina-distribucion.service.spec.ts`, dentro de `stubCargarPublica`, añadir al config mock:

```typescript
porcentajeSugerido: '0.10',
```

Y en el assert de `obtener` / respuesta pública:

```typescript
expect(result.porcentajeSugerido).toBe('0.10')
```

Añadir casos nuevos:

```typescript
it('reemplazar persiste porcentajeSugerido y lo devuelve', async () => {
  // arrange: manager.findOne → config existente con version 1
  // stubCargarPublica after save returns porcentajeSugerido: '0.15'
  // act
  const result = await service.reemplazar(TENANT, USER, {
    porcentajeSugerido: '0.15',
    grupos: [
      {
        tipoGarzon: TipoGarzon.GARZON,
        nombre: 'Garzones',
        porcentaje: '1',
        criterio: CriterioDistribucion.PARTES_IGUALES,
        activo: true,
        orden: 0,
      },
    ],
  })
  expect(result.porcentajeSugerido).toBe('0.15')
  expect(manager.save).toHaveBeenCalledWith(
    PropinaConfiguracion,
    expect.objectContaining({ porcentajeSugerido: '0.150000' }),
  )
})

it('reemplazar rechaza porcentajeSugerido > 1', async () => {
  await expect(
    service.reemplazar(TENANT, USER, {
      porcentajeSugerido: '10',
      grupos: [
        {
          tipoGarzon: TipoGarzon.GARZON,
          nombre: 'Garzones',
          porcentaje: '1',
          criterio: CriterioDistribucion.PARTES_IGUALES,
          activo: true,
          orden: 0,
        },
      ],
    }),
  ).rejects.toThrow(BadRequestException)
})

it('obtenerPorcentajeSugerido asegura default y responde string', async () => {
  configRepo.findOne.mockResolvedValue(null)
  // transaction crea config con 0.10; stub findOneOrFail / cargar
  manager.findOne.mockResolvedValueOnce(null) // race lock miss
  // after create+save, obtenerPorcentajeSugerido reads config
  const result = await service.obtenerPorcentajeSugerido(TENANT)
  expect(result).toEqual({ porcentajeSugerido: '0.10' })
})
```

Adaptar mocks al estilo existente del spec (ver `stubCargarPublica` y tests de `reemplazar` ya presentes).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && npx jest src/modules/propinas/propina-distribucion.service.spec.ts --no-cache
```

Expected: FAIL (propiedad / método inexistentes).

- [ ] **Step 3: SQL + entity**

En `startup-pos.sql`, dentro de `CREATE TABLE propina_configuracion`, añadir:

```sql
  porcentaje_sugerido NUMERIC(10,6) NOT NULL DEFAULT 0.10,
  CONSTRAINT chk_propina_config_pct_sugerido CHECK (
    porcentaje_sugerido >= 0 AND porcentaje_sugerido <= 1
  ),
```

En entity:

```typescript
@Column({
  name: 'porcentaje_sugerido',
  type: 'numeric',
  precision: 10,
  scale: 6,
  default: '0.10',
})
porcentajeSugerido: string;
```

- [ ] **Step 4: DTO**

En `UpdateDistribucionDto`:

```typescript
@IsNumberString()
porcentajeSugerido: string;
```

- [ ] **Step 5: Service**

1. Extender interface `DistribucionPublica` con `porcentajeSugerido: string`.
2. En `asegurarDefault` / creates: set `porcentajeSugerido: '0.10'`.
3. En `reemplazar`, **antes** de mutar grupos:

```typescript
const pct = new Decimal(dto.porcentajeSugerido);
if (pct.lt(0) || pct.gt(1)) {
  throw new BadRequestException(
    'porcentajeSugerido debe ser decimal (0.10 = 10%), no porcentaje entero',
  );
}
config.porcentajeSugerido = pct.toFixed(6);
```

(No incrementar `version` solo por el tip; el `config.version = config.version + 1` existente por grupos se mantiene.)

4. En `cargarPublica` return:

```typescript
porcentajeSugerido: config.porcentajeSugerido,
```

5. Nuevo método:

```typescript
async obtenerPorcentajeSugerido(
  tenantId: string,
): Promise<{ porcentajeSugerido: string }> {
  const config = await this.asegurarDefault(tenantId);
  return { porcentajeSugerido: config.porcentajeSugerido };
}
```

6. En `tenants.service.ts` al crear `PropinaConfiguracion`, añadir `porcentajeSugerido: '0.10'`.

- [ ] **Step 6: Run tests — expect PASS**

```bash
cd backend && npx jest src/modules/propinas/propina-distribucion.service.spec.ts --no-cache
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add startup-pos.sql \
  backend/src/modules/propinas/entities/propina-configuracion.entity.ts \
  backend/src/modules/propinas/dto/update-distribucion.dto.ts \
  backend/src/modules/propinas/propina-distribucion.service.ts \
  backend/src/modules/propinas/propina-distribucion.service.spec.ts \
  backend/src/modules/tenants/tenants.service.ts
git commit -m "$(cat <<'EOF'
feat(propinas): persistir porcentaje sugerido en propina_configuracion

EOF
)"
```

---

### Task 2: Endpoint operativo `GET /propinas/porcentaje-sugerido`

**Files:**
- Modify: `backend/src/modules/propinas/propina-distribucion.controller.ts`

**Interfaces:**
- Consumes: `PropinaDistribucionService.obtenerPorcentajeSugerido`
- Produces: ruta `GET /propinas/porcentaje-sugerido` con `@RequiresPermiso('Salones', 'Operar')`

- [ ] **Step 1: Añadir handler al controller**

```typescript
@Get('porcentaje-sugerido')
@RequiresPermiso('Salones', 'Operar')
porcentajeSugerido(@Req() req: Request) {
  const user = req.user as JwtUser;
  return this.distribucion.obtenerPorcentajeSugerido(user.tenantId!);
}
```

**Importante:** declarar esta ruta **antes** de cualquier `@Get(':id')` si existiera; hoy solo hay `distribucion`, así que orden junto a los otros `@Get` estáticos.

- [ ] **Step 2: Verificar a mano / smoke (opcional con curl autenticado)**

Si el stack está up:

```bash
# Tras login JWT con Salones:Operar
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/propinas/porcentaje-sugerido
# Expected: {"porcentajeSugerido":"0.10"}
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/propinas/propina-distribucion.controller.ts
git commit -m "$(cat <<'EOF'
feat(propinas): GET porcentaje-sugerido para cobro en salones

EOF
)"
```

---

### Task 3: Frontend composables

**Files:**
- Modify: `frontend/app/composables/usePropinaDistribucion.ts`
- Modify: `frontend/app/composables/usePropina.ts`
- Modify: `frontend/app/composables/usePropina.spec.ts`

**Interfaces:**
- Consumes: APIs de Task 1–2
- Produces:
  - `DistribucionPublica.porcentajeSugerido: string`
  - `UpdateDistribucionBody.porcentajeSugerido: string`
  - `PROPINA_PORCENTAJE_DEFAULT = '0.10'`
  - `porcentajeHumanoADecimal(humano: string): string` — `'10'` → `'0.10'`, `'10.5'` → `'0.105'`
  - `porcentajeDecimalAHumano(decimal: string): string` — `'0.10'` → `'10'`, `'0.105'` → `'10.5'`
  - `usePropina().obtenerPorcentajeSugerido(): Promise<string>` — fetch + fallback default

- [ ] **Step 1: Tests de conversión UI↔API**

En `usePropina.spec.ts`:

```typescript
import {
  sugerirPropina,
  porcentajeHumanoADecimal,
  porcentajeDecimalAHumano,
  PROPINA_PORCENTAJE_DEFAULT,
} from './usePropina'

describe('porcentajeHumanoADecimal', () => {
  it('convierte 10 → 0.10', () => {
    expect(porcentajeHumanoADecimal('10')).toBe('0.10')
  })
  it('convierte 10.5 → 0.105', () => {
    expect(porcentajeHumanoADecimal('10.5')).toBe('0.105')
  })
})

describe('porcentajeDecimalAHumano', () => {
  it('convierte 0.10 → 10', () => {
    expect(porcentajeDecimalAHumano('0.10')).toBe('10')
  })
  it('convierte 0.105 → 10.5', () => {
    expect(porcentajeDecimalAHumano('0.105')).toBe('10.5')
  })
})
```

Implementación sugerida (Decimal.js):

```typescript
export const PROPINA_PORCENTAJE_DEFAULT = '0.10'

export function porcentajeHumanoADecimal(humano: string): string {
  return new Decimal(humano || '0').div(100).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0'
  // Preferir toFixed estable: new Decimal(humano||'0').div(100).toFixed(6)
  // y al guardar el service ya normaliza a 6 decimales.
}

export function porcentajeDecimalAHumano(decimal: string): string {
  return new Decimal(decimal || '0').times(100).toString()
}
```

Usar `toFixed(6)` en humano→decimal para alinear con backend; en tests ajustar expectativas a `'0.100000'` **o** normalizar en el helper a strip trailing zeros — elegir una y ser consistente con el PUT body (el service hace `toFixed(6)`).

Recomendación: helpers:

```typescript
export function porcentajeHumanoADecimal(humano: string): string {
  return new Decimal(humano || '0').div(100).toFixed(6)
}

export function porcentajeDecimalAHumano(decimal: string): string {
  const n = new Decimal(decimal || '0').times(100)
  return n.equals(n.toDecimalPlaces(0)) ? n.toFixed(0) : n.toString()
}
```

Tests:

```typescript
expect(porcentajeHumanoADecimal('10')).toBe('0.100000')
expect(porcentajeDecimalAHumano('0.100000')).toBe('10')
expect(porcentajeDecimalAHumano('0.105000')).toBe('10.5')
```

- [ ] **Step 2: Run — FAIL then implement helpers + fetch**

```bash
cd frontend && npx vitest run app/composables/usePropina.spec.ts
```

Añadir en `usePropina.ts`:

```typescript
export async function fetchPorcentajeSugerido(): Promise<string> {
  const apiUrl = useRuntimeConfig().public.apiUrl
  try {
    const res = await useApiFetch<{ porcentajeSugerido: string }>(
      `${apiUrl}/propinas/porcentaje-sugerido`,
    )
    return res.porcentajeSugerido || PROPINA_PORCENTAJE_DEFAULT
  }
  catch {
    return PROPINA_PORCENTAJE_DEFAULT
  }
}

export function usePropina() {
  return { sugerirPropina, fetchPorcentajeSugerido, porcentajeHumanoADecimal, porcentajeDecimalAHumano }
}
```

Extender `usePropinaDistribucion.ts`:

```typescript
export interface DistribucionPublica {
  // ...
  porcentajeSugerido: string
}

export interface UpdateDistribucionBody {
  porcentajeSugerido: string
  grupos: Array<{ ... }>
}
```

- [ ] **Step 3: Run tests — PASS**

```bash
cd frontend && npx vitest run app/composables/usePropina.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/usePropina.ts \
  frontend/app/composables/usePropina.spec.ts \
  frontend/app/composables/usePropinaDistribucion.ts
git commit -m "$(cat <<'EOF'
feat(propinas): helpers y fetch del porcentaje sugerido

EOF
)"
```

---

### Task 4: UI Config → Propinas

**Files:**
- Modify: `frontend/app/pages/configuracion/propinas-distribucion.vue`

**Interfaces:**
- Consumes: `porcentajeHumanoADecimal`, `porcentajeDecimalAHumano`, `DistribucionPublica.porcentajeSugerido`
- Produces: campo editable + incluido en `PUT`

- [ ] **Step 1: Estado y load/save**

```typescript
import { porcentajeDecimalAHumano, porcentajeHumanoADecimal } from '~/composables/usePropina'

const porcentajeSugeridoHumano = ref('10')

function aplicarRespuesta(data: DistribucionPublica) {
  version.value = data.version
  porcentajeSugeridoHumano.value = porcentajeDecimalAHumano(data.porcentajeSugerido ?? '0.10')
  // ... grupos como hoy
}

// en guardar():
const body = {
  porcentajeSugerido: porcentajeHumanoADecimal(porcentajeSugeridoHumano.value),
  grupos: grupos.value.map(/* igual que hoy */),
}
```

- [ ] **Step 2: Template — card/campo arriba de grupos**

Dentro del `space-y-6`, **antes** del listado de grupos:

```vue
<UCard>
  <UFormField
    label="Propina sugerida (%)"
    hint="Porcentaje que se prellena al cerrar una cuenta de mesa. El cajero puede editarlo."
  >
    <UInput
      v-model="porcentajeSugeridoHumano"
      inputmode="decimal"
      class="w-32"
      :disabled="!puedeConfigurar"
      data-qa="propina-sugerida-pct"
    />
  </UFormField>
</UCard>
```

Actualizar description del header si hace falta: mencionar tip sugerido + distribución.

- [ ] **Step 3: Verificación manual rápida**

Abrir `/configuracion/propinas-distribucion`, cambiar a `15`, Guardar, recargar → debe mostrar `15`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/configuracion/propinas-distribucion.vue
git commit -m "$(cat <<'EOF'
feat(propinas): UI para editar propina sugerida en distribución

EOF
)"
```

---

### Task 5: Salones + CobroModal usan el % configurado

**Files:**
- Modify: `frontend/app/pages/salones/index.vue`
- Modify: `frontend/app/components/ventas/CobroModal.vue`

**Interfaces:**
- Consumes: `fetchPorcentajeSugerido`, `sugerirPropina`
- Produces: cobro con % del tenant; `propinaPorcentajeSugerido` en cierre = valor cargado

- [ ] **Step 1: CobroModal — prop `porcentajeSugerido`**

```typescript
const props = withDefaults(
  defineProps<{
    total?: string
    metodos: MetodoPago[]
    submitting?: boolean
    modoPropina?: boolean
    ventaTotal?: string
    /** Decimal API, ej. '0.10'. Solo modoPropina. */
    porcentajeSugerido?: string
  }>(),
  {
    modoPropina: false,
    total: '0',
    ventaTotal: '0',
    porcentajeSugerido: '0.10',
  },
)

watch(open, (v) => {
  if (v) {
    if (props.modoPropina) {
      propinaMonto.value = sugerirPropina(
        props.ventaTotal || '0',
        props.porcentajeSugerido || '0.10',
      )
    }
    resetPagos()
  }
})
```

- [ ] **Step 2: Salones — cargar % y pasar props**

Reemplazar:

```typescript
const PROPINA_PORCENTAJE = '0.10'
```

por:

```typescript
import { sugerirPropina, fetchPorcentajeSugerido, PROPINA_PORCENTAJE_DEFAULT } from '~/composables/usePropina'

const propinaPorcentaje = ref(PROPINA_PORCENTAJE_DEFAULT)
```

En `onMounted` (junto a otros loads):

```typescript
propinaPorcentaje.value = await fetchPorcentajeSugerido()
```

En watch de cobro:

```typescript
propinaSugerida.value = sugerirPropina(totalFinal.value, propinaPorcentaje.value)
```

En `cerrarCuenta` body:

```typescript
propinaPorcentajeSugerido: propinaPorcentaje.value,
```

En template del modal:

```vue
<VentasCobroModal
  ...
  :porcentaje-sugerido="propinaPorcentaje"
  ...
/>
```

(Verificar el nombre del componente en el template: `VentasCobroModal` vs `CobroModal` — usar el que ya existe en el archivo.)

- [ ] **Step 3: Verificación manual**

1. Config → Propinas: set 15%, guardar.
2. Salones: abrir cobro → propina prellenada = 15% del total.
3. Confirmar → detalle venta `porcentajeSugerido` ≈ `0.15`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/salones/index.vue \
  frontend/app/components/ventas/CobroModal.vue
git commit -m "$(cat <<'EOF'
feat(salones): usar propina sugerida configurada al cobrar

EOF
)"
```

---

### Task 6: Docs vivas

**Files:**
- Modify: `docs/ESTADO.md` — nueva fila o actualizar tip config
- Modify: `docs/features/` — añadir nota en feature de propinas/salones (el que documente cierre + tip; p.ej. `docs/features/salones-mesas.md` y/o crear `docs/features/propina-sugerida.md` desde TEMPLATE si no hay sitio claro)
- Modify: `docs/superpowers/specs/2026-07-17-propina-sugerida-config-design.md` → `Status: Done`
- Modify: `docs/superpowers/specs/2026-07-17-registro-propinas-design.md` — en “Fuera de alcance”, marcar config % como resuelto / link a la nueva spec

- [ ] **Step 1: Actualizar docs**

Fila sugerida en `ESTADO.md`:

```markdown
| Configuración de propina sugerida por tenant (`propina_configuracion.porcentaje_sugerido`) | ✅ Implementado (2026-07-17) |
```

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs(propinas): marcar config propina sugerida como implementada

EOF
)"
```

---

## Self-review del plan vs spec

| Requisito spec | Task |
|---|---|
| Columna `porcentaje_sugerido` + CHECK | 1 |
| Default `0.10` en asegurarDefault / tenant | 1 |
| GET/PUT distribucion incluye campo | 1 (+ DTO) |
| Validación decimal 0–1 | 1 |
| GET `/propinas/porcentaje-sugerido` + Salones:Operar | 2 |
| UI Config → Propinas (humano ↔ decimal) | 3 + 4 |
| Salones + CobroModal usan % | 5 |
| Docs / ESTADO | 6 |
| No versiona liquidación solo por tip | 1 (documentado; bump solo por flujo grupos existente) |

Sin placeholders pendientes.
