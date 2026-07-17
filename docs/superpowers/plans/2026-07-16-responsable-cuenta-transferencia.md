# Responsable de Cuenta, Transferencia e Historial — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incorporar un responsable vigente por cuenta, transferencias por PIN o administración e historial append-only, sin confundir al responsable con quien abrió o cerró la cuenta.

**Architecture:** `cuentas.garzon_responsable_id` materializa el responsable vigente para lecturas y futuras propinas. `cuenta_asignaciones` conserva cada tramo de responsabilidad y `CuentaAsignacionesService` encapsula transferencias, historial, cierre de tramos y backfill; `SalonesService` solo orquesta esos cambios dentro de sus transacciones existentes.

**Tech Stack:** NestJS, TypeORM, PostgreSQL 15, Jest, Nuxt 4, Vue 3, Nuxt UI v4, `useApiFetch`, TypeScript.

## Global Constraints

- Trabajar directamente sobre `main`; no crear ramas ni PRs.
- Desarrollo Docker-first; no agregar dependencias.
- `tenant_id` siempre proviene del JWT, nunca del body.
- Toda PK/FK UUID declara `type: 'uuid'` explícito.
- Soft delete y timestamps usan `eliminado_el`, `creado_el`, `actualizado_el`.
- `cuenta_asignaciones` es append-only: no exponer update/delete de asignaciones.
- PIN inválido, garzón inactivo, sesión ausente y cuenta no abierta responden `400`, no `401`.
- El claim por PIN requiere `Salones:Operar`; la transferencia admin requiere `Salones:Actualizar`; el historial requiere `Salones:Leer`.
- Todo garzón destino debe estar activo y tener sesión abierta, incluso en transferencia admin.
- `garzon_apertura_id` y `garzon_cierre_id` siguen siendo auditoría; D/E usarán `garzon_responsable_id`.
- Abrir, transferir, cerrar, cancelar y fusionar deben actualizar cuenta y asignación en una sola transacción.
- Locks de transferencia/cierre se toman sobre `cuentas` con `pessimistic_write`.
- Frontend usa tokens semánticos de Nuxt UI y `useApiFetch`; no axios ni colores Tailwind hardcoded.
- Tras mutaciones frontend, actualizar `cuentas` y `activeCuenta` localmente; no volver a cargar la lista.
- Fuente de verdad del esquema documental: `startup-pos.sql`; runtime de desarrollo usa TypeORM `synchronize`.
- No crear datos demo nuevos; el backfill debe ser idempotente.

---

## Mapa de archivos

### Crear

- `backend/src/modules/salones/entities/cuenta-asignacion.entity.ts` — entidad append-only y enum de motivos.
- `backend/src/modules/salones/dto/transferir-cuenta.dto.ts` — DTOs de claim por PIN y transferencia admin.
- `backend/src/modules/salones/cuenta-asignaciones.service.ts` — transferencia, cierre de tramo, historial y backfill.
- `backend/src/modules/salones/cuenta-asignaciones.service.spec.ts` — pruebas unitarias del nuevo servicio.

### Modificar

- `backend/src/modules/salones/entities/cuenta.entity.ts` — `garzonResponsableId`.
- `backend/src/modules/salones/salones.module.ts` — registrar entidad y servicio.
- `backend/src/app.module.ts` — registrar `CuentaAsignacion`.
- `backend/src/modules/garzones/garzones.service.ts` — lookup público de garzón activo por ID.
- `backend/src/modules/garzones/garzones.service.spec.ts` — validar lookup activo.
- `backend/src/modules/salones/salones.service.ts` — integrar apertura/cierre/cancelación/fusión y respuesta.
- `backend/src/modules/salones/salones.service.spec.ts` — pruebas de integración entre orquestadores.
- `backend/src/modules/salones/salones.controller.ts` — tres endpoints y permisos.
- `startup-pos.sql` — columna, tabla, índices y backfill SQL.
- `frontend/app/composables/useSalones.ts` — tipos y wrappers API.
- `frontend/app/pages/salones/index.vue` — responsable, claim, transferencia admin e historial.
- `docs/features/salones-mesas.md` — contrato funcional/API actualizado.
- `docs/ESTADO.md` — marcar subproyecto C implementado.
- `docs/superpowers/specs/2026-07-16-responsable-cuenta-transferencia-design.md` — cambiar metadata a `Done / Approved` al finalizar.

---

### Task 1: Modelo persistente y backfill idempotente

**Files:**
- Create: `backend/src/modules/salones/entities/cuenta-asignacion.entity.ts`
- Modify: `backend/src/modules/salones/entities/cuenta.entity.ts`
- Modify: `backend/src/modules/salones/salones.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `startup-pos.sql`
- Test: `backend/src/modules/salones/cuenta-asignaciones.service.spec.ts` (se crea en Task 2)

**Interfaces:**
- Produces: `MotivoCuentaAsignacion`, `CuentaAsignacion`, `Cuenta.garzonResponsableId`.
- Consumes: entidades existentes `Cuenta`, `Garzon`, `Usuario`, convención TypeORM del proyecto.

- [ ] **Step 1: Crear la entidad de asignación**

```typescript
export enum MotivoCuentaAsignacion {
  APERTURA = 'apertura',
  TRANSFERENCIA_PIN = 'transferencia_pin',
  TRANSFERENCIA_ADMIN = 'transferencia_admin',
}

@Index(
  'uq_cuenta_asignacion_vigente',
  ['cuentaId'],
  {
    unique: true,
    where: '"hasta_el" IS NULL AND "eliminado_el" IS NULL',
  },
)
@Index(
  'idx_cuenta_asignaciones_timeline',
  ['tenantId', 'cuentaId', 'desdeEl'],
)
@Entity('cuenta_asignaciones')
export class CuentaAsignacion {
  @PrimaryGeneratedColumn('uuid', { name: 'cuenta_asignacion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'cuenta_id', type: 'uuid' })
  cuentaId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  @Column({ name: 'desde_el', type: 'timestamptz' })
  desdeEl: Date;

  @Column({ name: 'hasta_el', type: 'timestamptz', nullable: true })
  hastaEl: Date | null;

  @Column({ type: 'text' })
  motivo: MotivoCuentaAsignacion;

  @Column({ name: 'origen_garzon_id', type: 'uuid', nullable: true })
  origenGarzonId: string | null;

  @Column({ name: 'actor_usuario_id', type: 'uuid', nullable: true })
  actorUsuarioId: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
```

Importar `Index` y los demás decoradores desde `typeorm`. No agregar relaciones
TypeORM: los IDs explícitos mantienen el patrón actual y evitan cargas implícitas.

- [ ] **Step 2: Agregar el responsable vigente a `Cuenta`**

Agregar `@Index('idx_cuentas_responsable', ['tenantId', 'garzonResponsableId'])`
sobre la clase `Cuenta`. Después de `garzonAperturaId`:

```typescript
// Garzón responsable vigente. Cambia al transferir; D/E atribuyen a este ID.
@Column({ name: 'garzon_responsable_id', type: 'uuid', nullable: true })
garzonResponsableId: string | null;
```

- [ ] **Step 3: Registrar la entidad en los módulos**

En `salones.module.ts`:

```typescript
import { CuentaAsignacion } from './entities/cuenta-asignacion.entity';

TypeOrmModule.forFeature([
  Salon,
  Mesa,
  Cuenta,
  CuentaLinea,
  CuentaAsignacion,
])
```

En `app.module.ts`, importar `CuentaAsignacion` y agregarla inmediatamente después de `Cuenta` en `entities`.

- [ ] **Step 4: Actualizar el esquema SQL con tabla, índices y backfill**

En `startup-pos.sql`, dentro de la sección de cuentas:

```sql
ALTER TABLE cuentas
    ADD COLUMN garzon_responsable_id UUID REFERENCES garzones(garzon_id);

CREATE INDEX idx_cuentas_responsable
    ON cuentas (tenant_id, garzon_responsable_id);

CREATE TABLE cuenta_asignaciones (
    cuenta_asignacion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    cuenta_id UUID NOT NULL REFERENCES cuentas(cuenta_id),
    garzon_id UUID NOT NULL REFERENCES garzones(garzon_id),
    desde_el TIMESTAMPTZ NOT NULL,
    hasta_el TIMESTAMPTZ,
    motivo TEXT NOT NULL,
    origen_garzon_id UUID REFERENCES garzones(garzon_id),
    actor_usuario_id UUID REFERENCES usuarios(usuario_id),
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ,
    CONSTRAINT chk_cuenta_asignaciones_motivo CHECK (
      motivo IN ('apertura', 'transferencia_pin', 'transferencia_admin')
    )
);

CREATE INDEX idx_cuenta_asignaciones_timeline
    ON cuenta_asignaciones (tenant_id, cuenta_id, desde_el);

CREATE UNIQUE INDEX uq_cuenta_asignacion_vigente
    ON cuenta_asignaciones (cuenta_id)
    WHERE hasta_el IS NULL AND eliminado_el IS NULL;

UPDATE cuentas
   SET garzon_responsable_id = garzon_apertura_id
 WHERE garzon_responsable_id IS NULL
   AND garzon_apertura_id IS NOT NULL;

INSERT INTO cuenta_asignaciones (
    tenant_id, cuenta_id, garzon_id, desde_el, hasta_el, motivo
)
SELECT c.tenant_id,
       c.cuenta_id,
       c.garzon_apertura_id,
       c.abierta_el,
       CASE WHEN c.estado = 'abierta' THEN NULL ELSE c.cerrada_el END,
       'apertura'
  FROM cuentas c
 WHERE c.garzon_apertura_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1
       FROM cuenta_asignaciones ca
      WHERE ca.cuenta_id = c.cuenta_id
        AND ca.eliminado_el IS NULL
   );
```

- [ ] **Step 5: Compilar backend para verificar metadata**

Run: `cd backend && npm run build`

Expected: exit `0`; sin `EntityMetadataNotFoundError` ni errores TypeScript.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/salones/entities/cuenta-asignacion.entity.ts \
  backend/src/modules/salones/entities/cuenta.entity.ts \
  backend/src/modules/salones/salones.module.ts \
  backend/src/app.module.ts startup-pos.sql
git commit -m "feat(salones): modelar responsable e historial de cuenta"
```

---

### Task 2: Servicio transaccional de asignaciones

**Files:**
- Create: `backend/src/modules/salones/cuenta-asignaciones.service.ts`
- Create: `backend/src/modules/salones/cuenta-asignaciones.service.spec.ts`
- Modify: `backend/src/modules/salones/salones.module.ts`
- Modify: `backend/src/modules/garzones/garzones.service.ts`
- Modify: `backend/src/modules/garzones/garzones.service.spec.ts`

**Interfaces:**
- Consumes: `GarzonesService.resolverGarzonPorPin`, `SesionesGarzonService.assertSesionAbierta`, `EntityManager`.
- Produces:
  - `GarzonesService.obtenerActivoPorId(tenantId: string, id: string): Promise<Garzon>`
  - `CuentaAsignacionesService.registrarApertura(manager, cuenta, garzonId): Promise<void>`
  - `CuentaAsignacionesService.transferirPorPin(tenantId, cuentaId, pin): Promise<Cuenta>`
  - `CuentaAsignacionesService.transferirAdmin(tenantId, usuarioId, cuentaId, garzonId): Promise<Cuenta>`
  - `CuentaAsignacionesService.cerrarTramoVigente(manager, tenantId, cuentaId, hastaEl): Promise<void>`
  - `CuentaAsignacionesService.listar(tenantId, cuentaId): Promise<CuentaAsignacionDetalle[]>`
  - `CuentaAsignacionesService.onApplicationBootstrap(): Promise<void>` — backfill idempotente.

- [ ] **Step 1: Escribir pruebas fallidas para lookup activo por ID**

En `garzones.service.spec.ts`, cubrir:

```typescript
it('devuelve un garzón activo del tenant', async () => {
  repo.findOne.mockResolvedValue({ id: GARZON, tenantId: TENANT, activo: true });
  await expect(service.obtenerActivoPorId(TENANT, GARZON))
    .resolves.toEqual(expect.objectContaining({ id: GARZON }));
});

it('rechaza un garzón inactivo', async () => {
  repo.findOne.mockResolvedValue({ id: GARZON, tenantId: TENANT, activo: false });
  await expect(service.obtenerActivoPorId(TENANT, GARZON))
    .rejects.toThrow('Garzón no encontrado o inactivo');
});
```

- [ ] **Step 2: Ejecutar prueba y confirmar RED**

Run: `cd backend && npm test -- modules/garzones/garzones.service.spec.ts`

Expected: FAIL porque `obtenerActivoPorId` no existe.

- [ ] **Step 3: Implementar lookup activo**

```typescript
async obtenerActivoPorId(tenantId: string, id: string): Promise<Garzon> {
  const garzon = await this.garzonRepo.findOne({
    where: { id, tenantId, activo: true },
  });
  if (!garzon) {
    throw new BadRequestException('Garzón no encontrado o inactivo');
  }
  return garzon;
}
```

- [ ] **Step 4: Escribir pruebas fallidas del servicio de asignaciones**

Crear el spec con mocks de `DataSource`, `EntityManager`, `GarzonesService` y `SesionesGarzonService`. Casos obligatorios:

```typescript
it('transfiere por PIN cerrando el tramo anterior y creando el nuevo', async () => {
  garzones.resolverGarzonPorPin.mockResolvedValue({ id: DESTINO, activo: true });
  manager.findOne.mockResolvedValue({
    id: CUENTA, tenantId: TENANT, estado: EstadoCuenta.ABIERTA,
    garzonResponsableId: ORIGEN,
  });

  const result = await service.transferirPorPin(TENANT, CUENTA, PIN);

  expect(manager.findOne).toHaveBeenCalledWith(Cuenta, expect.objectContaining({
    lock: { mode: 'pessimistic_write' },
  }));
  expect(sesiones.assertSesionAbierta).toHaveBeenCalledWith(TENANT, DESTINO);
  expect(manager.update).toHaveBeenCalledWith(
    CuentaAsignacion,
    expect.objectContaining({ cuentaId: CUENTA, tenantId: TENANT, hastaEl: IsNull() }),
    expect.objectContaining({ hastaEl: expect.any(Date) }),
  );
  expect(manager.create).toHaveBeenCalledWith(
    CuentaAsignacion,
    expect.objectContaining({
      garzonId: DESTINO,
      origenGarzonId: ORIGEN,
      motivo: MotivoCuentaAsignacion.TRANSFERENCIA_PIN,
      actorUsuarioId: null,
    }),
  );
  expect(result.garzonResponsableId).toBe(DESTINO);
});
```

Agregar además:

- admin registra `actorUsuarioId` y `TRANSFERENCIA_ADMIN`;
- cuenta inexistente → `NotFoundException`;
- cuenta cerrada → `BadRequestException('La cuenta no está abierta')`;
- destino igual a responsable → `BadRequestException`;
- destino sin sesión propaga `400`;
- `registrarApertura` crea tramo `APERTURA`;
- `cerrarTramoVigente` actualiza solo `tenantId + cuentaId + hastaEl IS NULL`;
- `listar` devuelve nombres de garzón/origen/actor y orden ascendente;
- el SELECT del historial filtra tenant y `eliminado_el IS NULL`.
- `onApplicationBootstrap` ejecuta el backfill idempotente y no duplica una
  asignación existente.

- [ ] **Step 5: Ejecutar pruebas y confirmar RED**

Run: `cd backend && npm test -- modules/salones/cuenta-asignaciones.service.spec.ts`

Expected: FAIL porque el servicio aún no existe.

- [ ] **Step 6: Implementar servicio mínimo**

Definir:

```typescript
export interface CuentaAsignacionDetalle {
  id: string;
  garzonId: string;
  garzonNombre: string | null;
  desdeEl: Date;
  hastaEl: Date | null;
  motivo: MotivoCuentaAsignacion;
  origenGarzonId: string | null;
  origenGarzonNombre: string | null;
  actorUsuarioId: string | null;
  actorUsuarioNombre: string | null;
}
```

Usar un helper privado común para las dos transferencias:

```typescript
private async transferir(
  tenantId: string,
  cuentaId: string,
  destinoGarzonId: string,
  motivo: MotivoCuentaAsignacion,
  actorUsuarioId: string | null,
): Promise<Cuenta> {
  return this.dataSource.transaction(async (manager) => {
    const cuenta = await manager.findOne(Cuenta, {
      where: { id: cuentaId, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!cuenta) throw new NotFoundException(`Cuenta ${cuentaId} no encontrada`);
    if (cuenta.estado !== EstadoCuenta.ABIERTA) {
      throw new BadRequestException('La cuenta no está abierta');
    }
    if (cuenta.garzonResponsableId === destinoGarzonId) {
      throw new BadRequestException('El garzón ya es responsable de la cuenta');
    }

    const ahora = new Date();
    await this.cerrarTramoVigente(manager, tenantId, cuentaId, ahora);
    await manager.save(
      CuentaAsignacion,
      manager.create(CuentaAsignacion, {
        tenantId,
        cuentaId,
        garzonId: destinoGarzonId,
        desdeEl: ahora,
        hastaEl: null,
        motivo,
        origenGarzonId: cuenta.garzonResponsableId,
        actorUsuarioId,
      }),
    );
    cuenta.garzonResponsableId = destinoGarzonId;
    return manager.save(Cuenta, cuenta);
  });
}
```

`transferirPorPin` resuelve PIN y valida sesión antes de llamar al helper. `transferirAdmin` llama `obtenerActivoPorId`, valida sesión y luego al helper.

Para `listar`, usar SQL parametrizado con `LEFT JOIN garzones` y `LEFT JOIN usuarios`, filtrar por `$1 tenantId`, `$2 cuentaId` y `ca.eliminado_el IS NULL`, orden `ca.desde_el ASC`.

Implementar `OnApplicationBootstrap` en el mismo servicio. Ejecutar dentro de una
transacción los dos statements idempotentes del Task 1:

```typescript
async onApplicationBootstrap(): Promise<void> {
  await this.dataSource.transaction(async (manager) => {
    await manager.query(`
      UPDATE cuentas
         SET garzon_responsable_id = garzon_apertura_id
       WHERE garzon_responsable_id IS NULL
         AND garzon_apertura_id IS NOT NULL
    `);
    await manager.query(`
      INSERT INTO cuenta_asignaciones (
        tenant_id, cuenta_id, garzon_id, desde_el, hasta_el, motivo
      )
      SELECT c.tenant_id,
             c.cuenta_id,
             c.garzon_apertura_id,
             c.abierta_el,
             CASE WHEN c.estado = 'abierta' THEN NULL ELSE c.cerrada_el END,
             'apertura'
        FROM cuentas c
       WHERE c.garzon_apertura_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
             FROM cuenta_asignaciones ca
            WHERE ca.cuenta_id = c.cuenta_id
              AND ca.eliminado_el IS NULL
         )
    `);
  });
}
```

Esto permite que `synchronize` agregue la estructura y luego repare cuentas ya
existentes en Docker. No delegar el backfill al seeder demo.

- [ ] **Step 7: Registrar provider y correr pruebas**

Agregar `CuentaAsignacionesService` a `providers` y `exports` de `SalonesModule`.

Run:

```bash
cd backend
npm test -- modules/garzones/garzones.service.spec.ts modules/salones/cuenta-asignaciones.service.spec.ts
```

Expected: PASS en ambos suites.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/garzones/garzones.service.ts \
  backend/src/modules/garzones/garzones.service.spec.ts \
  backend/src/modules/salones/cuenta-asignaciones.service.ts \
  backend/src/modules/salones/cuenta-asignaciones.service.spec.ts \
  backend/src/modules/salones/salones.module.ts
git commit -m "feat(salones): agregar transferencias auditables de cuentas"
```

---

### Task 3: Integrar asignaciones al ciclo de vida de la cuenta

**Files:**
- Modify: `backend/src/modules/salones/salones.service.ts`
- Modify: `backend/src/modules/salones/salones.service.spec.ts`

**Interfaces:**
- Consumes: `CuentaAsignacionesService.registrarApertura`, `cerrarTramoVigente`.
- Produces: `CuentaDetalle.garzonResponsableId`, `CuentaDetalle.garzonResponsableNombre`.

- [ ] **Step 1: Extender los mocks y escribir pruebas fallidas**

Registrar un mock:

```typescript
let asignaciones: {
  registrarApertura: jest.Mock;
  cerrarTramoVigente: jest.Mock;
};
```

Casos:

1. `abrirCuenta` crea `Cuenta` con ambos IDs y llama `registrarApertura` dentro del manager:

```typescript
expect(manager.create).toHaveBeenCalledWith(
  Cuenta,
  expect.objectContaining({
    garzonAperturaId: GARZON,
    garzonResponsableId: GARZON,
  }),
);
expect(asignaciones.registrarApertura)
  .toHaveBeenCalledWith(manager, expect.objectContaining({ id: CUENTA }), GARZON);
```

2. `cerrarCuenta` llama `cerrarTramoVigente` con `cuenta.cerradaEl` y conserva `garzonResponsableId`.
3. `cancelarCuenta` se vuelve transaccional, bloquea cuenta, la cancela y cierra tramo.
4. `fusionarCuentas` cierra el tramo de cada origen cancelado y no cambia el responsable de destino.
5. `armarDetalle` devuelve ID/nombre del responsable, incluso si el garzón fue soft-deleted (lookup con `LEFT JOIN`/sin filtro destructivo).

- [ ] **Step 2: Ejecutar suite y confirmar RED**

Run: `cd backend && npm test -- modules/salones/salones.service.spec.ts`

Expected: FAIL por dependencia/propiedades nuevas y llamadas ausentes.

- [ ] **Step 3: Inyectar `CuentaAsignacionesService` y ampliar contrato**

```typescript
export interface CuentaDetalle {
  // campos existentes
  garzonResponsableId: string | null;
  garzonResponsableNombre: string | null;
}
```

Agregar al constructor:

```typescript
private readonly cuentaAsignacionesService: CuentaAsignacionesService,
```

- [ ] **Step 4: Integrar apertura**

Al crear:

```typescript
const creada = await manager.save(
  Cuenta,
  manager.create(Cuenta, {
    tenantId,
    mesaId,
    numero,
    nombre: dto.nombre ?? null,
    estado: EstadoCuenta.ABIERTA,
    garzonAperturaId: garzon.id,
    garzonResponsableId: garzon.id,
  }),
);
await this.cuentaAsignacionesService.registrarApertura(
  manager,
  creada,
  garzon.id,
);
return creada;
```

- [ ] **Step 5: Integrar cierre, cancelación y fusión**

En cierre, después de fijar `cerradaEl` y antes del save final:

```typescript
await this.cuentaAsignacionesService.cerrarTramoVigente(
  manager,
  tenantId,
  cuenta.id,
  cuenta.cerradaEl,
);
```

Rehacer `cancelarCuenta` dentro de `dataSource.transaction`, con `findOne(... lock: pessimistic_write)`, estado `CANCELADA`, `cerradaEl = new Date()`, cierre de tramo y `manager.save`.

En fusión, por cada origen:

```typescript
origen.estado = EstadoCuenta.CANCELADA;
origen.cerradaEl = new Date();
await this.cuentaAsignacionesService.cerrarTramoVigente(
  manager,
  tenantId,
  origen.id,
  origen.cerradaEl,
);
await manager.save(Cuenta, origen);
```

- [ ] **Step 6: Ampliar `armarDetalle`**

Resolver tres IDs:

```typescript
const nombresGarzon = await this.nombresGarzon(
  runner,
  cuenta.garzonAperturaId,
  cuenta.garzonCierreId,
  cuenta.garzonResponsableId,
);
```

Y devolver:

```typescript
garzonResponsableId: cuenta.garzonResponsableId,
garzonResponsableNombre: cuenta.garzonResponsableId
  ? (nombresGarzon[cuenta.garzonResponsableId] ?? null)
  : null,
```

Actualizar `nombresGarzon` para aceptar rest params (`...ids`) y deduplicarlos.

- [ ] **Step 7: Ejecutar suite**

Run: `cd backend && npm test -- modules/salones/salones.service.spec.ts`

Expected: PASS; especialmente apertura, cierre, cancelación y fusión.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/salones/salones.service.ts \
  backend/src/modules/salones/salones.service.spec.ts
git commit -m "feat(salones): integrar responsable al ciclo de cuenta"
```

---

### Task 4: Exponer API con DTOs y RBAC

**Files:**
- Create: `backend/src/modules/salones/dto/transferir-cuenta.dto.ts`
- Modify: `backend/src/modules/salones/salones.controller.ts`
- Test: `backend/src/modules/salones/cuenta-asignaciones.service.spec.ts`

**Interfaces:**
- Consumes: wrappers públicos de `SalonesService`, que internamente usan
  `CuentaAsignacionesService`.
- Produces:
  - `POST /cuentas/:id/transferir`
  - `POST /cuentas/:id/transferir-admin`
  - `GET /cuentas/:id/asignaciones`

- [ ] **Step 1: Crear DTOs validados**

```typescript
import { IsString, Matches, IsUUID } from 'class-validator';

export class TransferirCuentaDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener 6 dígitos' })
  pin: string;
}

export class TransferirCuentaAdminDto {
  @IsUUID()
  garzonId: string;
}
```

- [ ] **Step 2: Inyectar el servicio en `CuentasController`**

```typescript
constructor(private readonly salonesService: SalonesService) {}
```

- [ ] **Step 3: Agregar wrappers públicos a `SalonesService`**

```typescript
async transferirCuentaPorPin(
  tenantId: string,
  cuentaId: string,
  pin: string,
): Promise<CuentaDetalle> {
  const cuenta = await this.cuentaAsignacionesService.transferirPorPin(
    tenantId,
    cuentaId,
    pin,
  );
  return this.armarDetalle(tenantId, cuenta);
}

async transferirCuentaAdmin(
  tenantId: string,
  usuarioId: string,
  cuentaId: string,
  garzonId: string,
): Promise<CuentaDetalle> {
  const cuenta = await this.cuentaAsignacionesService.transferirAdmin(
    tenantId,
    usuarioId,
    cuentaId,
    garzonId,
  );
  return this.armarDetalle(tenantId, cuenta);
}

listarAsignacionesCuenta(
  tenantId: string,
  cuentaId: string,
): Promise<CuentaAsignacionDetalle[]> {
  return this.cuentaAsignacionesService.listar(tenantId, cuentaId);
}
```

Agregar en `salones.service.spec.ts` una prueba por wrapper que confirme el
resultado `CuentaDetalle` con nombre de responsable.

- [ ] **Step 4: Agregar endpoints y permisos exactos**

```typescript
@Post(':id/transferir')
@RequiresPermiso('Salones', 'Operar')
transferir(
  @Req() req: Request,
  @Param('id') id: string,
  @Body() dto: TransferirCuentaDto,
) {
  const u = req.user as JwtUser;
  return this.salonesService.transferirCuentaPorPin(
    u.tenantId ?? '',
    id,
    dto.pin,
  );
}

@Post(':id/transferir-admin')
@RequiresPermiso('Salones', 'Actualizar')
transferirAdmin(
  @Req() req: Request,
  @Param('id') id: string,
  @Body() dto: TransferirCuentaAdminDto,
) {
  const u = req.user as JwtUser;
  return this.salonesService.transferirCuentaAdmin(
    u.tenantId ?? '',
    u.id,
    id,
    dto.garzonId,
  );
}

@Get(':id/asignaciones')
@RequiresPermiso('Salones', 'Leer')
asignaciones(@Req() req: Request, @Param('id') id: string) {
  const u = req.user as JwtUser;
  return this.salonesService.listarAsignacionesCuenta(u.tenantId ?? '', id);
}
```

Las mutaciones devuelven `CuentaDetalle` mediante los wrappers de
`SalonesService`; el controller no accede al servicio interno.

- [ ] **Step 5: Probar compilación y suites**

Run:

```bash
cd backend
npm test -- modules/salones/cuenta-asignaciones.service.spec.ts modules/salones/salones.service.spec.ts
npm run build
```

Expected: suites PASS y build exit `0`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/salones/dto/transferir-cuenta.dto.ts \
  backend/src/modules/salones/salones.controller.ts \
  backend/src/modules/salones/salones.service.ts \
  backend/src/modules/salones/salones.service.spec.ts
git commit -m "feat(salones): exponer transferencias e historial de cuentas"
```

---

### Task 5: Contrato frontend y actualización local

**Files:**
- Modify: `frontend/app/composables/useSalones.ts`
- Test: `frontend/app/composables/useSalones.spec.ts` (crear si el proyecto ya ejecuta composables con Vitest; si no, verificar por `npm run build`)

**Interfaces:**
- Produces: `CuentaAsignacionDetalle`, `transferirCuenta`, `transferirCuentaAdmin`, `listarAsignaciones`.
- Consumes: endpoints de Task 4.

- [ ] **Step 1: Extender tipos**

```typescript
export type MotivoCuentaAsignacion =
  | 'apertura'
  | 'transferencia_pin'
  | 'transferencia_admin'

export interface CuentaAsignacionDetalle {
  id: string
  garzonId: string
  garzonNombre: string | null
  desdeEl: string
  hastaEl: string | null
  motivo: MotivoCuentaAsignacion
  origenGarzonId: string | null
  origenGarzonNombre: string | null
  actorUsuarioId: string | null
  actorUsuarioNombre: string | null
}
```

En `CuentaDetalle`:

```typescript
garzonResponsableId: string | null
garzonResponsableNombre: string | null
```

- [ ] **Step 2: Agregar wrappers**

```typescript
const transferirCuenta = (cuentaId: string, pin: string) =>
  useApiFetch<CuentaDetalle>(`${apiUrl}/cuentas/${cuentaId}/transferir`, {
    method: 'POST',
    body: { pin },
  })

const transferirCuentaAdmin = (cuentaId: string, garzonId: string) =>
  useApiFetch<CuentaDetalle>(`${apiUrl}/cuentas/${cuentaId}/transferir-admin`, {
    method: 'POST',
    body: { garzonId },
  })

const listarAsignaciones = (cuentaId: string) =>
  useApiFetch<CuentaAsignacionDetalle[]>(
    `${apiUrl}/cuentas/${cuentaId}/asignaciones`,
  )
```

Exportarlos en el return del composable.

- [ ] **Step 3: Verificar tipo/build**

Run: `cd frontend && npm run build`

Expected: exit `0`; ningún error por propiedades nuevas.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useSalones.ts
git commit -m "feat(frontend): agregar API de responsables de cuenta"
```

---

### Task 6: UX de responsable, claim, admin e historial

**Files:**
- Modify: `frontend/app/pages/salones/index.vue`

**Interfaces:**
- Consumes: `useSalones` Task 5, `useGarzones().listar()`, `usePermissionsStore`, `GarzonPinModal`, `useFormatters().formatFecha`.
- Produces: UI completa sin re-fetch tras transferencia.

- [ ] **Step 1: Agregar estado y permisos**

```typescript
const garzonesApi = useGarzones()
const permissionsStore = usePermissionsStore()
const puedeTransferirAdmin = computed(
  () => permissionsStore.esAdmin
    || permissionsStore.can('Salones', 'Actualizar'),
)

const transferAdminOpen = ref(false)
const transferAdminGarzonId = ref<string | undefined>()
const garzonesActivos = ref<Garzon[]>([])
const transfiriendo = ref(false)

const historialOpen = ref(false)
const historialLoading = ref(false)
const asignaciones = ref<CuentaAsignacionDetalle[]>([])
```

Importar tipos `Garzon` y `CuentaAsignacionDetalle`.

- [ ] **Step 2: Crear helper de merge local**

```typescript
function aplicarCuentaActualizada(actualizada: CuentaDetalle) {
  cuentas.value = cuentas.value.map(c =>
    c.id === actualizada.id ? actualizada : c,
  )
  if (activeCuenta.value?.id === actualizada.id) {
    activeCuenta.value = actualizada
  }
}
```

Este helper es obligatorio para no llamar `cargarCuentas()` después de transferir.

- [ ] **Step 3: Implementar claim por PIN**

```typescript
function tomarCuenta() {
  if (!activeCuenta.value) return
  solicitarPin('PIN para tomar esta cuenta', (pin) => {
    void transferirCuentaConPin(pin)
  })
}

async function transferirCuentaConPin(pin: string) {
  const cuenta = activeCuenta.value
  if (!cuenta || transfiriendo.value) return
  transfiriendo.value = true
  try {
    const actualizada = await salonesApi.transferirCuenta(cuenta.id, pin)
    aplicarCuentaActualizada(actualizada)
    toast.add({
      title: `Cuenta tomada por ${actualizada.garzonResponsableNombre ?? 'garzón'}`,
      color: 'success',
    })
  }
  catch (e: unknown) {
    toastErrorOperativo(e, 'No se pudo tomar la cuenta')
  }
  finally {
    transfiriendo.value = false
  }
}
```

- [ ] **Step 4: Implementar transferencia admin**

Al abrir el modal, cargar una sola vez `garzonesApi.listar()`, filtrar `activo`, excluir el responsable actual y seleccionar el primero. Al confirmar:

```typescript
const actualizada = await salonesApi.transferirCuentaAdmin(
  activeCuenta.value.id,
  transferAdminGarzonId.value,
)
aplicarCuentaActualizada(actualizada)
transferAdminOpen.value = false
toast.add({ title: 'Responsable actualizado', color: 'success' })
```

Errores pasan por `toastErrorOperativo`.

- [ ] **Step 5: Implementar carga de historial**

```typescript
async function abrirHistorial() {
  const cuenta = activeCuenta.value
  if (!cuenta) return
  historialOpen.value = true
  historialLoading.value = true
  try {
    asignaciones.value = await salonesApi.listarAsignaciones(cuenta.id)
  }
  catch (e: unknown) {
    toast.add({
      title: apiErrorMsg(e, 'No se pudo cargar el historial'),
      color: 'error',
    })
  }
  finally {
    historialLoading.value = false
  }
}
```

Mapa de etiquetas:

```typescript
const motivoAsignacionLabel: Record<MotivoCuentaAsignacion, string> = {
  apertura: 'Apertura',
  transferencia_pin: 'Transferencia',
  transferencia_admin: 'Transferencia admin',
}
```

- [ ] **Step 6: Sustituir visualmente apertura por responsable**

En header y tarjetas usar:

```vue
<span
  v-if="activeCuenta?.garzonResponsableNombre"
  class="flex items-center gap-1 text-xs text-muted"
>
  <UIcon name="i-lucide-user" class="size-3" />
  Responsable: {{ activeCuenta.garzonResponsableNombre }}
</span>
```

En cada tarjeta usar `cuenta.garzonResponsableNombre`.

- [ ] **Step 7: Agregar acciones en detalle**

En el panel derecho, antes de productos:

```vue
<div class="flex flex-wrap items-center gap-2">
  <UButton
    label="Tomar cuenta"
    icon="i-lucide-user-check"
    color="neutral"
    variant="soft"
    :loading="transfiriendo"
    @click="tomarCuenta"
  />
  <UButton
    v-if="puedeTransferirAdmin"
    label="Transferir"
    icon="i-lucide-arrow-right-left"
    color="neutral"
    variant="ghost"
    @click="abrirTransferenciaAdmin"
  />
  <UButton
    label="Ver historial"
    icon="i-lucide-history"
    color="neutral"
    variant="ghost"
    @click="abrirHistorial"
  />
</div>
```

- [ ] **Step 8: Agregar modal admin y drawer/modal de historial**

Modal admin:

- `USelectMenu` con `{ label: garzon.nombre, value: garzon.id }`.
- Confirmar deshabilitado sin destino.
- Footer con `AppModalFooter`.

Historial:

- `AppDrawer` o `UModal` con loading/vacío.
- Lista `divide-y divide-default`.
- Mostrar nombre, motivo, `formatFecha(desdeEl)` y `hastaEl ? formatFecha(hastaEl) : 'Vigente'`.
- Para admin mostrar `actorUsuarioNombre` cuando exista.

- [ ] **Step 9: Verificar frontend**

Run:

```bash
cd frontend
npm run build
```

Expected: build exit `0`.

Verificación manual:

1. Entrar a turno con garzón A y abrir cuenta.
2. Confirmar “Responsable: A”.
3. Entrar a turno con garzón B y “Tomar cuenta” usando PIN B.
4. Confirmar cambio inmediato a B sin GET adicional de cuentas.
5. Abrir historial: Apertura A → Transferencia B, tramo B vigente.
6. Como admin, transferir a A y confirmar actor admin en historial.
7. Probar destino sin sesión: `400` + toast con CTA “Entrar a turno”.

- [ ] **Step 10: Commit**

```bash
git add frontend/app/pages/salones/index.vue
git commit -m "feat(salones): gestionar responsable e historial en operación"
```

---

### Task 7: Documentación y verificación final

**Files:**
- Modify: `docs/features/salones-mesas.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/superpowers/specs/2026-07-16-responsable-cuenta-transferencia-design.md`
- Verify: todos los archivos de Tasks 1–6

**Interfaces:**
- Consumes: implementación completa.
- Produces: documentación viva alineada y evidencia de verificación.

- [ ] **Step 1: Actualizar feature doc**

Agregar:

- tres roles de garzón;
- tabla `cuenta_asignaciones`;
- endpoints y permisos;
- transferencia por PIN/admin;
- cierre de tramos al cerrar/cancelar/fusionar;
- reglas de concurrencia.

Actualizar el texto que hoy dice que apertura/cierre identifican al “responsable”, porque ahora son auditoría y el responsable vigente es independiente.

- [ ] **Step 2: Actualizar estado**

Agregar fila:

```markdown
| Responsable vigente de cuenta + transferencia por PIN/admin + historial auditable | ✅ Implementado (2026-07-16) |
```

- [ ] **Step 3: Cerrar metadata del spec**

Cambiar:

```markdown
**Status**: Done / Approved
```

- [ ] **Step 4: Ejecutar verificación completa**

Run:

```bash
cd backend
npm test -- modules/garzones/garzones.service.spec.ts \
  modules/salones/cuenta-asignaciones.service.spec.ts \
  modules/salones/salones.service.spec.ts
npm run build

cd ../frontend
npm run build
```

Expected: todas las suites PASS; ambos builds exit `0`.

- [ ] **Step 5: Revisar invariantes en PostgreSQL**

Con el stack Docker activo, ejecutar SELECTs de verificación en réplica si está configurada; este repo no declara `DATABASE_REPLICA_URL`, por lo que en desarrollo se usa la única conexión disponible:

```sql
SELECT cuenta_id, garzon_apertura_id, garzon_responsable_id, garzon_cierre_id
FROM cuentas
ORDER BY creado_el DESC
LIMIT 10;

SELECT cuenta_id, COUNT(*)
FROM cuenta_asignaciones
WHERE hasta_el IS NULL AND eliminado_el IS NULL
GROUP BY cuenta_id
HAVING COUNT(*) > 1;
```

Expected: responsable poblado cuando hay apertura; segunda consulta devuelve cero filas.

- [ ] **Step 6: Revisar diff y lints**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` sin salida; status solo muestra archivos previstos.

- [ ] **Step 7: Commit**

```bash
git add docs/features/salones-mesas.md docs/ESTADO.md \
  docs/superpowers/specs/2026-07-16-responsable-cuenta-transferencia-design.md
git commit -m "docs: documentar responsable y transferencias de cuenta"
```

---

## Self-review del plan

- Cobertura del spec: modelo, backfill, claim PIN, transferencia admin, historial, RBAC, concurrencia, ciclo abrir/cerrar/cancelar/fusionar, UI, actualización local y docs están asignados a Tasks 1–7.
- Consistencia de tipos: backend/frontend usan `garzonResponsableId`, `garzonResponsableNombre`, `CuentaAsignacionDetalle` y los tres valores exactos de `MotivoCuentaAsignacion`.
- Sin dependencias nuevas ni infraestructura especulativa.
- La atribución de propinas queda preparada, pero D/E permanecen fuera de alcance.
- El plan no crea un módulo separado: mantiene la feature dentro de `Salones`, con servicio enfocado para evitar seguir inflando `SalonesService`.
