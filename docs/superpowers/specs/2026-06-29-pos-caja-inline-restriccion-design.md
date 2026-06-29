# Design: Gestión de caja inline en POS y restricción del módulo Caja

**Status:** Approved  
**Date:** 2026-06-29  
**Owner:** Cesar Matheus

---

## Context

El POS actual muestra un "gate" cuando no hay caja abierta: un mensaje con un botón "Ir a caja" que redirige al módulo `/caja`. Esto interrumpe el flujo del vendedor, quien debe navegar fuera del POS, abrir la caja, y volver. Además, el módulo Caja es visible para cualquier usuario con `Caja:Leer`, sin distinción entre vendedor y supervisor/admin.

## Scope

**Dentro del alcance:**
- Reemplazar el gate del POS por apertura de caja inline (`CajaAperturaForm`)
- Agregar acciones de caja (registrar movimiento, cerrar) desde el header del POS
- Restringir el módulo `/caja` a `esAdmin || can('Caja', 'VerTodas')`
- Actualizar seed del rol Vendedor con permisos de Caja necesarios

**Fuera del alcance:**
- No se crean nuevos permisos en la BD (se usa `Caja:VerTodas` existente)
- No se modifican endpoints del backend
- No se modifica la lógica interna de `CajaAperturaForm`, `CajaMovimientoModal` ni `CajaCierreModal`
- No se agrega historial de caja dentro del POS

---

## Frontend

### 1. POS page — `frontend/app/pages/ventas/index.vue`

**Gate sin caja (estado actual):**
```
<UIcon name="i-heroicons-lock-closed" />
<h2>Necesitás una caja abierta</h2>
<UButton label="Ir a caja" to="/caja" />
```

**Gate sin caja (nuevo):**  
Reemplazar el bloque completo por `<CajaAperturaForm />`. Al abrir exitosamente, el store reactivo `cajaStore.activa` cambia a non-null y el POS muestra el catálogo de inmediato.

**Header con caja activa:**  
Agregar en el área del `AppNavbar` del POS (o junto al título) un componente de estado de caja que muestre:
- Badge verde "CAJA ABIERTA" con saldo esperado del store
- `UDropdownMenu` con tres items:
  - "Registrar movimiento" → abre `CajaMovimientoModal`
  - "Cerrar caja" → abre `CajaCierreModal`

Los modales `CajaMovimientoModal` y `CajaCierreModal` se instancian en `ventas/index.vue` (igual que hoy están en `CajaActivaDashboard`), con sus respectivos `v-model:open` y props.

**Estado de carga:**  
Durante `cajaStore.loadingActiva`, mostrar skeleton/spinner en lugar del gate o del header.

### 2. Layout — `frontend/app/layouts/dashboard.vue`

Cambiar la condición del item "Caja" en la navegación:

```diff
- if (permissionsStore.esAdmin || permissionsStore.can('Caja', 'Leer')) {
+ if (permissionsStore.esAdmin || permissionsStore.can('Caja', 'VerTodas')) {
```

Los vendedores con `Caja:Leer/Crear/Actualizar` pero sin `Caja:VerTodas` dejan de ver el item en el sidebar.

### 3. Caja page — `frontend/app/pages/caja/index.vue`

Agregar guard de acceso en `onMounted`, después de cargar permisos:

```typescript
onMounted(async () => {
  // ... carga existente
  const perms = usePermissionsStore()
  if (!perms.esAdmin && !perms.can('Caja', 'VerTodas')) {
    await navigateTo('/ventas')
    toast.add({ title: 'No tenés acceso al módulo Caja', color: 'warning' })
    return
  }
  // ... resto de la carga
})
```

Esto protege la ruta ante acceso directo por URL.

---

## Backend — Seeder

**Archivo:** `backend/src/modules/seeder/seeder.service.ts`

El rol Vendedor de Paris necesita los siguientes permisos de Caja para que las llamadas API desde el POS funcionen:

| Permiso | Endpoint que lo necesita |
|---|---|
| `Caja:Leer` | `GET /caja/activa`, `GET /caja/:id/movimientos` |
| `Caja:Crear` | `POST /caja/abrir`, `POST /caja/:id/movimientos` |
| `Caja:Actualizar` | `POST /caja/:id/cerrar` |

**No** se asigna `Caja:VerTodas` — ese permiso es el que distingue al admin/supervisor.

Adicionalmente, el rol Vendedor necesita permisos de Ventas para poder crear ventas desde el POS:
- `Ventas:Leer`, `Ventas:Crear`

Agregar en `seedVendedorPermisosTest()` (o en un nuevo método dedicado) la asignación de estos permisos al rol Vendedor en el tenant Paris.

---

## Flujos de usuario

### Vendedor

1. Entra a `/ventas`
2. Si no hay caja abierta → ve `CajaAperturaForm` inline → ingresa saldo inicial → caja abierta → POS reactivo muestra catálogo
3. Durante el turno → dropdown "Caja" en header del POS → registrar movimiento o cerrar caja
4. No ve "Caja" en el sidebar; navegar a `/caja` directamente redirige a `/ventas` con aviso

### Admin / Supervisor (con `esAdmin` o `Caja:VerTodas`)

1. Ve "Caja" en el sidebar → accede a `/caja` con historial completo, movimientos de todos los usuarios
2. También puede usar el POS normalmente con el widget inline de caja

---

## Archivos que cambian

| Archivo | Cambio |
|---|---|
| `frontend/app/pages/ventas/index.vue` | Gate inline + header dropdown con acciones de caja |
| `frontend/app/layouts/dashboard.vue` | Condición `Caja:VerTodas` en lugar de `Caja:Leer` |
| `frontend/app/pages/caja/index.vue` | Guard de acceso en onMounted |
| `backend/src/modules/seeder/seeder.service.ts` | Permisos Caja y Ventas para rol Vendedor |

---

## Verification

- [ ] Vendedor puede abrir caja desde el POS sin navegar a `/caja`
- [ ] Vendedor puede registrar movimientos desde el POS
- [ ] Vendedor puede cerrar caja desde el POS
- [ ] Vendedor NO ve "Caja" en el sidebar
- [ ] Vendedor que navega directamente a `/caja` es redirigido a `/ventas`
- [ ] Admin ve "Caja" en el sidebar y accede normalmente
- [ ] Admin puede abrir el POS y gestionar caja desde ahí también
- [ ] El POS carga el catálogo inmediatamente después de abrir caja (sin reload de página)
