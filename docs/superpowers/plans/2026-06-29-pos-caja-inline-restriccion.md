# Caja Inline en POS y Restricción Módulo Caja — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir al vendedor gestionar su caja (abrir, cerrar, registrar movimientos) directamente desde el POS, y restringir el acceso al módulo `/caja` a admin/supervisores.

**Architecture:** Reutilización directa de componentes Vue existentes (`CajaAperturaForm`, `CajaMovimientoModal`, `CajaCierreModal`) en el contexto del POS. La restricción del módulo Caja se implementa cambiando el permiso de visibilidad en el sidebar de `Caja:Leer` a `Caja:VerTodas`, y agregando un guard client-side en la página `/caja`. El seeder agrega el módulo "Ventas" y actualiza los permisos del rol Vendedor para habilitar el acceso a los endpoints de Caja desde el POS.

**Tech Stack:** Nuxt 4, Vue 3, Pinia (`useCajaStore`, `usePermissionsStore`), Nuxt UI (`UDropdownMenu`, `UBadge`, `DropdownMenuItem`), Decimal.js, NestJS seeder (TypeScript, TypeORM, raw SQL).

## Global Constraints

- Aritmética de dinero siempre con `Decimal.js` — nunca `number` nativo para montos o porcentajes
- Soft delete en todas las tablas — nunca borrar filas, marcar `eliminado_el`
- IDs del seeder siguen el patrón `550e8400-e29b-41d4-a716-XXXXXXXXXXXX`; usar el siguiente número libre
- No tocar endpoints del backend ni lógica interna de `CajaAperturaForm`, `CajaMovimientoModal`, `CajaCierreModal`
- Columnas UUID en entidades TypeORM deben declarar `type: 'uuid'` explícitamente

---

## File Map

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `backend/src/modules/seeder/seeder.service.ts` | Modificar | Módulo "Ventas" + permisos Caja y Ventas al rol Vendedor |
| `frontend/app/layouts/dashboard.vue` | Modificar | Condición del item "Caja" en sidebar: `Caja:Leer` → `Caja:VerTodas` |
| `frontend/app/pages/caja/index.vue` | Modificar | Guard de acceso en `onMounted` |
| `frontend/app/pages/ventas/index.vue` | Modificar | Gate inline con `CajaAperturaForm` + header dropdown con acciones de caja |

---

### Task 1: Seeder — módulo Ventas y permisos del rol Vendedor

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts`

**Interfaces:**
- Produces: usuario `vendedor.paris` (contraseña: `admin`) con permisos `Ventas:Leer`, `Ventas:Crear`, `Caja:Leer`, `Caja:Crear`, `Caja:Actualizar` — sin `Caja:VerTodas`

---

- [ ] **Paso 1: Agregar módulo app "Ventas" en `seedModulosApp`**

Localizar `private async seedModulosApp()` (~línea 276). Agregar una entrada al array `modulos` junto a Facturación, Caja y Test:

```typescript
{
  moduloAppId: '550e8400-e29b-41d4-a716-446655440058',
  nombre: 'Ventas',
  url: '/ventas',
  icono: 'mdi-shopping',
  tieneConfiguracion: false,
},
```

- [ ] **Paso 2: Agregar `moduloAppPermiso` de Ventas en `seedModuloAppPermisos`**

Localizar `private async seedModuloAppPermisos()` (~línea 339). Las constantes `LEER` y `CREAR` ya están definidas al inicio del método. Agregar al array `entries` (después de las entradas de TEST):

```typescript
{
  moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440059',
  moduloAppId: '550e8400-e29b-41d4-a716-446655440058', // Ventas
  permisoId: '550e8400-e29b-41d4-a716-446655440012',   // Leer
},
{
  moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440060',
  moduloAppId: '550e8400-e29b-41d4-a716-446655440058', // Ventas
  permisoId: '550e8400-e29b-41d4-a716-446655440013',   // Crear
},
```

- [ ] **Paso 3: Agregar `tenantModulo` Paris → Ventas en `seedTenantModulo`**

Localizar `private async seedTenantModulo()` (~línea 530). Agregar al array `entries`:

```typescript
{
  moduloTenantId: '550e8400-e29b-41d4-a716-446655440061',
  tenantId: '550e8400-e29b-41d4-a716-446655440007',       // Paris
  moduloAppId: '550e8400-e29b-41d4-a716-446655440058',    // Ventas
  estado: 'activo',
  expiraEn: new Date('2026-12-31T23:59:59Z'),
},
```

- [ ] **Paso 4: Crear método `seedVendedorPermisosCaja`**

Agregar un nuevo método privado al final de la clase `SeederService`, antes del cierre de la clase (`}`):

```typescript
private async seedVendedorPermisosCaja(): Promise<void> {
  const PARIS = '550e8400-e29b-41d4-a716-446655440007';
  // moduloTenantId para Paris → Caja (definido en seedTenantModulo)
  const MODULO_TENANT_CAJA = '550e8400-e29b-41d4-a716-446655440023';
  // moduloTenantId para Paris → Ventas (recién agregado en Paso 3)
  const MODULO_TENANT_VENTAS = '550e8400-e29b-41d4-a716-446655440061';
  // moduloAppPermiso IDs de Caja (definidos en seedModuloAppPermisos)
  const CAJA_LEER = '550e8400-e29b-41d4-a716-446655440034';
  const CAJA_CREAR = '550e8400-e29b-41d4-a716-446655440035';
  const CAJA_ACTUALIZAR = '550e8400-e29b-41d4-a716-446655440036';
  // moduloAppPermiso IDs de Ventas (recién agregados en Paso 2)
  const VENTAS_LEER = '550e8400-e29b-41d4-a716-446655440059';
  const VENTAS_CREAR = '550e8400-e29b-41d4-a716-446655440060';

  const vendedorRows: { rol_id: string }[] = await this.dataSource.query(
    `SELECT rol_id FROM roles WHERE tenant_id = $1 AND nombre = 'Vendedor' AND eliminado_el IS NULL`,
    [PARIS],
  );

  if (vendedorRows.length === 0) {
    this.logger.warn('seedVendedorPermisosCaja: rol Vendedor not found in Paris, skipping.');
    return;
  }

  const rolId = vendedorRows[0].rol_id;

  // Asociar Vendedor al módulo Caja del tenant Paris
  await this.dataSource.query(
    `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
     VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [rolId, MODULO_TENANT_CAJA],
  );

  // Asociar Vendedor al módulo Ventas del tenant Paris
  await this.dataSource.query(
    `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
     VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [rolId, MODULO_TENANT_VENTAS],
  );

  // Asignar Caja: Leer, Crear, Actualizar (sin VerTodas — ese es el diferenciador admin/supervisor)
  for (const moduloAppPermisoId of [CAJA_LEER, CAJA_CREAR, CAJA_ACTUALIZAR]) {
    await this.dataSource.query(
      `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [rolId, MODULO_TENANT_CAJA, moduloAppPermisoId],
    );
  }

  // Asignar Ventas: Leer, Crear
  for (const moduloAppPermisoId of [VENTAS_LEER, VENTAS_CREAR]) {
    await this.dataSource.query(
      `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [rolId, MODULO_TENANT_VENTAS, moduloAppPermisoId],
    );
  }
}
```

- [ ] **Paso 5: Llamar al nuevo método desde `run()`**

Localizar el método `run()`. Agregar la llamada después de `seedVendedorPermisosTest()`:

```typescript
await this.seedVendedorPermisosTest();
await this.seedVendedorPermisosCaja(); // nueva línea
```

- [ ] **Paso 6: Rebuild y verificar**

```bash
docker-compose down -v && docker-compose up --build
```

Autenticarse en el backend (POST `/auth/login`) con `{ "correo": "vendedor@paris.cl", "contrasena": "admin" }`, luego con el tenant de Paris (POST `/auth/select-tenant`) y verificar permisos:

```bash
# GET /rbac/mis-permisos con token y header X-Tenant-Id del tenant Paris
# Respuesta debe incluir: "Caja:Leer", "Caja:Crear", "Caja:Actualizar", "Ventas:Leer", "Ventas:Crear"
# Respuesta NO debe incluir: "Caja:VerTodas"
```

- [ ] **Paso 7: Commit**

```bash
git add backend/src/modules/seeder/seeder.service.ts
git commit -m "feat(seeder): módulo Ventas y permisos Caja/Ventas al rol Vendedor de Paris"
```

---

### Task 2: Frontend — restricción del módulo Caja

**Files:**
- Modify: `frontend/app/layouts/dashboard.vue`
- Modify: `frontend/app/pages/caja/index.vue`

**Interfaces:**
- Consumes: `permissionsStore.esAdmin: boolean`, `permissionsStore.can(modulo: string, permiso: string): boolean`, `navigateTo(path: string)`, `useToast()`
- Produces: sidebar sin item "Caja" para usuarios sin `esAdmin` ni `Caja:VerTodas`; redirect a `/ventas` si acceden a `/caja` directamente

---

- [ ] **Paso 1: Cambiar condición del sidebar en `dashboard.vue`**

En `frontend/app/layouts/dashboard.vue`, localizar el bloque que agrega el item "Caja" al array `base` (línea ~21):

```diff
-  if (permissionsStore.esAdmin || permissionsStore.can('Caja', 'Leer')) {
+  if (permissionsStore.esAdmin || permissionsStore.can('Caja', 'VerTodas')) {
```

- [ ] **Paso 2: Agregar guard en `caja/index.vue`**

En `frontend/app/pages/caja/index.vue`, reemplazar el `onMounted` existente:

```typescript
// ANTES:
onMounted(async () => {
  loading.value = true
  try {
    await cajaStore.cargarActiva()
  }
  catch {
    toast.add({ title: 'Error al cargar caja', color: 'error' })
  }
  finally {
    loading.value = false
  }
})
```

```typescript
// DESPUÉS:
onMounted(async () => {
  const perms = usePermissionsStore()
  if (!perms.esAdmin && !perms.can('Caja', 'VerTodas')) {
    toast.add({ title: 'No tenés acceso al módulo Caja', color: 'warning' })
    await navigateTo('/ventas')
    return
  }
  loading.value = true
  try {
    await cajaStore.cargarActiva()
  }
  catch {
    toast.add({ title: 'Error al cargar caja', color: 'error' })
  }
  finally {
    loading.value = false
  }
})
```

- [ ] **Paso 3: Verificar manualmente**

Stack levantado (`docker-compose up`):

1. Login como `vendedor@paris.cl` / `admin` → seleccionar tenant Paris
2. Verificar que el sidebar **no** muestra el item "Caja"
3. Navegar directamente a `http://localhost:5173/caja` → debe redirigir a `/ventas` con un toast de advertencia amarillo
4. Login como `admin.paris@paris.cl` / `admin` → seleccionar tenant Paris
5. Verificar que el sidebar **sí** muestra "Caja" y la página carga normalmente

- [ ] **Paso 4: Commit**

```bash
git add frontend/app/layouts/dashboard.vue frontend/app/pages/caja/index.vue
git commit -m "feat(frontend): restringir módulo Caja a esAdmin o Caja:VerTodas"
```

---

### Task 3: Frontend — gestión de caja inline en el POS

**Files:**
- Modify: `frontend/app/pages/ventas/index.vue`

**Interfaces:**
- Consumes:
  - `cajaStore.activa: Caja | null` — reactive, determina qué pantalla mostrar
  - `cajaStore.movimientos: MovimientoCaja[]` — para calcular saldo esperado
  - `cajaStore.cargarMovimientos(cajaId: string): Promise<void>`
  - `CajaAperturaForm` — sin props, gestiona la apertura internamente via `cajaStore.abrir()`
  - `CajaMovimientoModal` props: `open: boolean`, `cajaId: string`
  - `CajaCierreModal` props: `open: boolean`, `cajaId: string`, `saldoEsperado: Decimal`
  - `AppNavbar` slot `#right` — acepta contenido Vue adicional antes del `<UserMenu />`
  - `UDropdownMenu` prop `items: DropdownMenuItem[][]`
- Produces: POS con apertura de caja inline; header con dropdown de acciones de caja cuando hay caja activa

---

- [ ] **Paso 1: Agregar imports y refs en `<script setup>`**

En `frontend/app/pages/ventas/index.vue`, agregar después de la línea `import { useVenta, ... }`:

```typescript
import Decimal from 'decimal.js'
import type { DropdownMenuItem } from '@nuxt/ui'
```

Y agregar estos refs/refs después de `const submitting = ref(false)`:

```typescript
const movimientoModalOpen = ref(false)
const cierreModalOpen = ref(false)

function abrirMovimientoModal() { movimientoModalOpen.value = true }
function abrirCierreModal() { cierreModalOpen.value = true }
```

- [ ] **Paso 2: Agregar computed `saldoEsperado` y `watch` para cargar movimientos**

Agregar después de `const totalFinal = computed(...)`:

```typescript
const saldoEsperado = computed(() => {
  if (!cajaStore.activa) return new Decimal(0)
  const entradas = cajaStore.movimientos
    .filter(m => m.tipo === 'entrada')
    .reduce((acc, m) => acc.plus(new Decimal(m.monto)), new Decimal(0))
  const salidas = cajaStore.movimientos
    .filter(m => m.tipo === 'salida')
    .reduce((acc, m) => acc.plus(new Decimal(m.monto)), new Decimal(0))
  return new Decimal(cajaStore.activa.saldoInicial).plus(entradas).minus(salidas)
})

const cajaMenuItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: 'Registrar movimiento',
      icon: 'i-lucide-circle-plus',
      onSelect: abrirMovimientoModal,
    },
    {
      label: 'Cerrar caja',
      icon: 'i-lucide-lock',
      color: 'error' as const,
      onSelect: abrirCierreModal,
    },
  ],
])

watch(
  () => cajaStore.activa,
  async (activa) => {
    if (activa) {
      try {
        await cajaStore.cargarMovimientos(activa.id)
      }
      catch {
        // no crítico — saldoEsperado quedará en saldoInicial si falla
      }
    }
  },
  { immediate: true },
)
```

- [ ] **Paso 3: Reemplazar el gate "sin caja" en el template**

En el template, localizar el bloque:

```html
<div v-if="!cajaStore.loadingActiva && !tieneCaja" class="max-w-md mx-auto text-center py-16">
  <UIcon name="i-lucide-lock" class="w-12 h-12 text-muted mx-auto mb-4" />
  <h2 class="text-lg font-semibold text-default mb-1">Necesitás una caja abierta</h2>
  <p class="text-sm text-muted mb-4">Abrí una caja para registrar ventas del canal físico.</p>
  <UButton label="Ir a caja" icon="i-lucide-banknote" to="/caja" />
</div>
```

Reemplazarlo por:

```html
<div v-if="!cajaStore.loadingActiva && !tieneCaja" class="max-w-md mx-auto py-12">
  <CajaAperturaForm />
</div>
```

- [ ] **Paso 4: Agregar header con dropdown de caja al `AppNavbar`**

En el template, localizar:

```html
<AppNavbar title="Punto de venta" />
```

Reemplazar por:

```html
<AppNavbar title="Punto de venta">
  <template #right>
    <div v-if="tieneCaja" class="flex items-center gap-2 mr-2">
      <UDropdownMenu :items="cajaMenuItems">
        <UButton variant="soft" color="success" size="sm" icon="i-lucide-banknote">
          Caja abierta
        </UButton>
      </UDropdownMenu>
    </div>
    <UserMenu />
  </template>
</AppNavbar>
```

- [ ] **Paso 5: Agregar los modales de caja al template**

Dentro del `<template #body>` del `UDashboardPanel`, agregar los modales después de `<VentasCobroModal ... />`:

```html
<CajaMovimientoModal
  v-if="cajaStore.activa"
  v-model:open="movimientoModalOpen"
  :caja-id="cajaStore.activa.id"
/>
<CajaCierreModal
  v-if="cajaStore.activa"
  v-model:open="cierreModalOpen"
  :caja-id="cajaStore.activa.id"
  :saldo-esperado="saldoEsperado"
/>
```

- [ ] **Paso 6: Verificar manualmente — flujo completo del vendedor**

Stack levantado (`docker-compose up`). Login como `vendedor@paris.cl` / `admin`, seleccionar tenant Paris, navegar a `/ventas`.

**Escenario A — sin caja:**
1. El POS muestra el formulario "Abrir caja" (UCard con campos saldo inicial y comentario)
2. Ingresar saldo inicial (ej: `50000`) y hacer click en "Abrir caja"
3. El catálogo de productos aparece sin recargar la página
4. El header muestra el botón verde "Caja abierta"

**Escenario B — con caja activa:**
1. Click en "Caja abierta" en el header → dropdown con "Registrar movimiento" y "Cerrar caja"
2. Click en "Registrar movimiento" → modal abre, registrar entrada de `10000` → modal cierra, toast de éxito
3. Click en "Caja abierta" → "Cerrar caja" → modal muestra saldo esperado calculado (debe ser `60000`)
4. Ingresar monto contado y confirmar → POS vuelve al formulario de apertura

- [ ] **Paso 7: Commit**

```bash
git add frontend/app/pages/ventas/index.vue
git commit -m "feat(pos): gestión de caja inline — apertura, movimientos y cierre desde el POS"
```

---

## Checklist de verificación final

- [ ] Vendedor puede abrir caja desde el POS sin navegar a `/caja`
- [ ] Vendedor puede registrar movimientos desde el POS
- [ ] Vendedor puede cerrar caja desde el POS con saldo esperado correcto
- [ ] Vendedor NO ve "Caja" en el sidebar
- [ ] Vendedor que navega directamente a `/caja` es redirigido a `/ventas` con toast
- [ ] Admin ve "Caja" en el sidebar y accede normalmente al módulo completo
- [ ] Admin puede abrir el POS y gestionar caja desde ahí también
- [ ] El POS carga el catálogo reactivamente al abrir caja (sin reload de página)
