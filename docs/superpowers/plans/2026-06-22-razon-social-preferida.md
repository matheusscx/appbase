# Razón Social Preferida — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar campo `preferida` a razones sociales: solo una por tenant, marcada con estrella en la UI, guardada en BD.

**Architecture:** Columna `preferida BOOLEAN` en `razones_sociales` gestionada por TypeORM sync. Endpoint dedicado `PATCH /tenants/razones-sociales/:id/preferida` que, dentro de una transacción, limpia todas las preferidas del tenant y marca la nueva. El frontend hace update optimista y revierte en error.

**Tech Stack:** NestJS (TypeORM, DataSource transactions), Nuxt 4 (Vue 3, `useApiFetch`, Heroicons)

## Global Constraints

- Soft delete siempre activo: toda query filtra `eliminado_el IS NULL`
- PKs en entidades TypeORM deben declarar `type: 'uuid'` explícitamente
- TypeORM `synchronize: true` en dev — la columna nueva se crea sola al reiniciar el backend
- `tenant_id` siempre viene del JWT, nunca del body
- Guards de tenant: `JwtAuthGuard`, `TenantGuard`, `TenantAdminGuard`

---

### Task 1: Backend — entidad, service, controller y tests

**Files:**
- Modify: `backend/src/modules/tenants/entities/razon-social.entity.ts`
- Modify: `backend/src/modules/tenants/tenants.service.ts`
- Modify: `backend/src/modules/tenants/tenants.controller.ts`
- Modify: `backend/src/modules/tenants/tenants.service.spec.ts`

**Interfaces:**
- Produces: `TenantsService.setPreferida(tenantId: string, id: string): Promise<RazonSocial>`
- Produces: `PATCH /api/tenants/razones-sociales/:id/preferida` → `RazonSocial`

---

- [ ] **Step 1: Agregar campo `preferida` a la entidad**

En `backend/src/modules/tenants/entities/razon-social.entity.ts`, agregar después de `habilitado`:

```typescript
@Column({ default: false })
preferida: boolean;
```

El archivo completo queda:

```typescript
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('razones_sociales')
export class RazonSocial {
  @PrimaryGeneratedColumn('uuid', { name: 'razon_social_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ length: 100 })
  nombre: string;

  @Column({ length: 50 })
  rut: string;

  @Column({ length: 255, nullable: true, type: 'varchar' })
  direccion: string | null;

  @Column({ length: 50, nullable: true, type: 'varchar' })
  telefono: string | null;

  @Column({ default: false })
  habilitado: boolean;

  @Column({ default: false })
  preferida: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

- [ ] **Step 2: Escribir el test que falla para `setPreferida`**

En `backend/src/modules/tenants/tenants.service.spec.ts`:

1. Agregar `preferida: false` al `mockRazonSocial` existente (línea ~135):

```typescript
const mockRazonSocial: RazonSocial = {
  id: 'rs-uuid',
  tenantId: 'tenant-uuid',
  nombre: 'Paris SPA',
  rut: '76.123.456-7',
  direccion: 'Av. Kennedy 9001',
  telefono: null,
  habilitado: false,
  preferida: false,
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null,
};
```

2. Agregar bloque `describe` para `setPreferida` al final del describe principal:

```typescript
describe('setPreferida', () => {
  it('limpia la preferida anterior y marca la nueva', async () => {
    const mockManager = {
      findOne: jest.fn().mockResolvedValue({ ...mockRazonSocial }),
      query: jest.fn().mockResolvedValue(undefined),
    };
    dataSource.transaction.mockImplementation((cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager));

    const result = await service.setPreferida('tenant-uuid', 'rs-uuid');

    expect(mockManager.query).toHaveBeenCalledWith(
      expect.stringContaining('SET preferida = false'),
      ['tenant-uuid'],
    );
    expect(mockManager.query).toHaveBeenCalledWith(
      expect.stringContaining('SET preferida = true'),
      ['rs-uuid'],
    );
    expect(result.preferida).toBe(true);
  });

  it('lanza NotFoundException si la razón social no existe en el tenant', async () => {
    const mockManager = {
      findOne: jest.fn().mockResolvedValue(null),
      query: jest.fn(),
    };
    dataSource.transaction.mockImplementation((cb: (m: typeof mockManager) => Promise<unknown>) => cb(mockManager));

    await expect(service.setPreferida('tenant-uuid', 'no-existe')).rejects.toThrow(
      NotFoundException,
    );
    expect(mockManager.query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

```bash
cd backend && npm test -- --testPathPattern=tenants.service.spec --verbose 2>&1 | tail -20
```

Esperado: FAIL — `service.setPreferida is not a function`

- [ ] **Step 4: Implementar `setPreferida` en el service**

En `backend/src/modules/tenants/tenants.service.ts`, agregar después de `removeRazonSocial`:

```typescript
async setPreferida(tenantId: string, id: string): Promise<RazonSocial> {
  return this.dataSource.transaction(async (manager) => {
    const rs = await manager.findOne(RazonSocial, {
      where: { id, tenantId },
    });
    if (!rs) throw new NotFoundException(`Razón social ${id} no encontrada`);

    await manager.query(
      `UPDATE razones_sociales SET preferida = false WHERE tenant_id = $1 AND eliminado_el IS NULL`,
      [tenantId],
    );
    await manager.query(
      `UPDATE razones_sociales SET preferida = true WHERE razon_social_id = $1`,
      [id],
    );

    rs.preferida = true;
    return rs;
  });
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

```bash
cd backend && npm test -- --testPathPattern=tenants.service.spec --verbose 2>&1 | tail -20
```

Esperado: PASS — todos los tests de `TenantsService` en verde.

- [ ] **Step 6: Agregar el endpoint en el controller**

En `backend/src/modules/tenants/tenants.controller.ts`, agregar después del `@Delete('razones-sociales/:id')`:

```typescript
@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)
@Patch('razones-sociales/:id/preferida')
setPreferida(@Req() req: Request, @Param('id') id: string) {
  const user = req.user as { tenantId: string };
  return this.tenantsService.setPreferida(user.tenantId, id);
}
```

- [ ] **Step 7: Reiniciar el backend y verificar la ruta**

```bash
docker-compose restart backend
```

Esperar ~10 segundos, luego:

```bash
docker-compose logs backend --tail=20 2>&1 | grep -E "razones-sociales|error|Error"
```

Esperado: ver `Mapped {/api/tenants/razones-sociales/:id/preferida, PATCH} route` en los logs.

- [ ] **Step 8: Commit del backend**

```bash
git add backend/src/modules/tenants/entities/razon-social.entity.ts \
        backend/src/modules/tenants/tenants.service.ts \
        backend/src/modules/tenants/tenants.controller.ts \
        backend/src/modules/tenants/tenants.service.spec.ts
git commit -m "feat(tenants): agregar campo preferida y endpoint PATCH razones-sociales/:id/preferida"
```

---

### Task 2: Frontend — interface, lógica y UI de estrella

**Files:**
- Modify: `frontend/app/pages/configuracion/razones-sociales.vue`

**Interfaces:**
- Consumes: `PATCH /api/tenants/razones-sociales/:id/preferida` (sin body) → `RazonSocial` con `preferida: true`

---

- [ ] **Step 1: Agregar `preferida` a la interface**

En `frontend/app/pages/configuracion/razones-sociales.vue`, actualizar la interface `RazonSocial`:

```typescript
interface RazonSocial {
  id: string
  nombre: string
  rut: string
  direccion: string | null
  telefono: string | null
  habilitado: boolean
  preferida: boolean
}
```

- [ ] **Step 2: Agregar función `togglePreferida`**

Después de la función `toggleHabilitado` existente, agregar:

```typescript
async function togglePreferida(rs: RazonSocial) {
  if (rs.preferida || toggling.has(rs.id)) return
  const prev = razones.value.find(r => r.preferida)
  if (prev) prev.preferida = false
  rs.preferida = true
  toggling.add(rs.id)
  try {
    await useApiFetch(`${apiUrl}/tenants/razones-sociales/${rs.id}/preferida`, {
      method: 'PATCH',
    })
    toast.add({ title: 'Razón social preferida actualizada', color: 'success' })
  }
  catch (e: unknown) {
    rs.preferida = false
    if (prev) prev.preferida = true
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al actualizar preferida', color: 'error' })
  }
  finally {
    toggling.delete(rs.id)
  }
}
```

- [ ] **Step 3: Agregar la estrella en el template del row**

Localizar el bloque de acciones del row (el `<div class="flex items-center gap-4 shrink-0 ml-4">`). Agregar el botón de estrella **antes** del `<USwitch>`:

```html
<div class="flex items-center gap-4 shrink-0 ml-4">
  <button
    type="button"
    class="p-1 rounded transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
    :disabled="toggling.has(rs.id)"
    @click="togglePreferida(rs)"
  >
    <UIcon
      :name="rs.preferida ? 'i-heroicons-star-solid' : 'i-heroicons-star'"
      class="w-5 h-5"
      :class="rs.preferida ? 'text-yellow-400' : 'text-gray-400'"
    />
  </button>
  <USwitch
    :model-value="rs.habilitado"
    :disabled="toggling.has(rs.id)"
    @update:model-value="toggleHabilitado(rs)"
  />
  <div class="flex gap-2">
    <UButton
      icon="i-heroicons-pencil-square"
      color="neutral"
      variant="ghost"
      @click="abrirEditar(rs)"
    />
    <UButton
      icon="i-heroicons-trash"
      color="error"
      variant="ghost"
      @click="() => { confirmDeleteId = rs.id; confirmModalOpen = true }"
    />
  </div>
</div>
```

- [ ] **Step 4: Verificar en el navegador**

Abrir `http://localhost:5173/configuracion/razones-sociales`.

Verificar:
- Cada row muestra una estrella outline gris
- Clic en la estrella de una no-preferida → estrella se pone amarilla (sólida), toast de éxito
- La estrella anterior (si había) vuelve a outline gris
- Clic en la estrella ya preferida → no hace nada
- Recargar la página → la preferida sigue marcada (persiste en BD)

- [ ] **Step 5: Commit del frontend**

```bash
git add frontend/app/pages/configuracion/razones-sociales.vue
git commit -m "feat(frontend): agregar estrella de preferida en razones sociales con update optimista"
```
