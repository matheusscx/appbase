# Cierre forzado de caja ajena con testigo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un encargado pueda cerrar la caja de un cajero ausente, que un garzón en turno pueda **dar fe del conteo desde su propia pantalla**, y que el registro cuente la historia completa.

**Architecture:** Se extiende el cierre en dos fases que ya existe. La **fase 1** (`enviarConteo`) deja de ser owner-only y congela además *quién contó* y *cuánta gente había*; entre fase 1 y fase 2 viven las **solicitudes de testigo**, que solo el garzón puede resolver contra su sesión abierta; la **fase 2** (`cerrar`) exige comentario si no hubo firma. Ninguna fase nueva: la ventana `en_conciliacion` ya existía.

**Tech Stack:** NestJS + TypeORM + Postgres 15 · Nuxt 4 (SPA) + Nuxt UI · Jest (unit + e2e supertest) · Vitest (frontend)

**Spec:** [`2026-08-11-testigo-cierre-forzado-design.md`](../specs/2026-08-11-testigo-cierre-forzado-design.md)

## Global Constraints

- `tenant_id` **siempre del token**, nunca del body/query/param.
- Dinero y porcentajes con **Decimal.js**, nunca `number`.
- **Soft delete** en todo: nunca `DELETE`; toda lectura filtra `eliminado_el IS NULL`.
- **No modificar el sistema de tokens JWT.**
- PK/FK con `type: 'uuid'` explícito (ADR-004, lo fuerza un test + CI).
- **Nada de N+1:** el dato derivado por fila se resuelve con `JOIN`/agregación o batch `WHERE id = ANY($1)`.
- Frontend: `useApiFetch`, nunca axios. Tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado.
- Commits **directo sobre `main`**, sin ramas ni PRs.
- **Gate completo antes de cada commit** (ver `CLAUDE.md` → checklist), incluido `npm run test:e2e` **entero** precedido de `./scripts/reset-db.sh`.
- ⚠️ **No tocar ningún `.ts` del backend con el e2e corriendo** (bind-mount → recompila y re-siembra).

---

## File Structure

**Backend — crear**
- `backend/src/modules/caja/entities/caja-testigo.entity.ts` — la fila de solicitud/firma.
- `backend/src/modules/caja/dto/solicitar-testigo.dto.ts` — a qué garzones se les pide.
- `backend/src/modules/caja/dto/resolver-testigo.dto.ts` — PIN + firma/rechazo + comentario.
- `backend/src/modules/caja/caja-testigo.service.ts` — todo el ciclo de vida de las solicitudes, aparte de `caja.service.ts` (que ya tiene 1300+ líneas).

**Backend — modificar**
- `startup-pos.sql` — 2 columnas en `cajas` + tabla `caja_testigo`.
- `backend/src/modules/caja/entities/caja.entity.ts` — `cerradaPor`, `testigosDisponibles`.
- `backend/src/app.module.ts` — registrar `CajaTestigo` en el array `entities` ⚠️ (no hay `autoLoadEntities`; olvidarlo solo lo caza el e2e real).
- `backend/src/modules/caja/caja.service.ts` — `enviarConteo` (cierre forzado) y `cerrar` (comentario obligatorio).
- `backend/src/modules/caja/caja.controller.ts` — rutas nuevas.
- `backend/src/modules/caja/caja.module.ts` — el service nuevo + `TurnosModule`.
- `backend/src/modules/turnos/sesiones-garzon.service.ts` — caducar solicitudes al cerrar sesión.

**Frontend — modificar**
- `frontend/app/composables/useCaja.ts` (o el que exista) — llamadas nuevas.
- `frontend/app/pages/cajas/` — el flujo del encargado.
- `frontend/app/pages/salones/index.vue` — la solicitud pendiente del garzón.

**Docs**
- `docs/features/gestion-cajas.md`, `docs/ESTADO.md`, `docs/DIFERENCIADORES.md` (pasar el testigo de 📐 a ✅).

---

## Task 1: Esquema y entidades

**Files:**
- Modify: `startup-pos.sql`
- Modify: `backend/src/modules/caja/entities/caja.entity.ts`
- Create: `backend/src/modules/caja/entities/caja-testigo.entity.ts`
- Modify: `backend/src/app.module.ts`
- Test: `backend/test/caja-testigo.e2e-spec.ts` (solo el arranque, en esta task)

**Interfaces:**
- Consumes: nada.
- Produces: entidad `CajaTestigo` con `id, tenantId, cajaId, garzonId, sesionGarzonId, solicitadaPor, estado, comentarioGarzon, solicitadaEl, resueltaEl`; y en `Caja`, los campos `cerradaPor: string | null` y `testigosDisponibles: number | null`.

- [ ] **Step 1: Agregar las columnas y la tabla al esquema**

En `startup-pos.sql`, dentro de `CREATE TABLE "cajas"`, después de `"comentario" TEXT,`:

```sql
  -- Quién EJECUTÓ el cierre, distinto de `usuario_id` (de quién es el turno).
  -- Se guarda SIEMPRE, también en el cierre normal: "forzado" se deriva
  -- (`cerrada_por <> usuario_id`) en vez de guardarse como flag, que podría
  -- terminar contradiciendo a los datos.
  "cerrada_por"    UUID          REFERENCES "usuarios" ("usuario_id"),
  -- Cuántos garzones tenían sesión abierta al congelar el conteo. Es lo que
  -- distingue "cerró solo porque no había nadie" de "cerró solo habiendo tres".
  "testigos_disponibles" SMALLINT,
```

Y después del bloque de índices de `cajas`:

```sql
-- Quién dio fe de un conteo. Una fila por solicitud; cero, una o varias por caja.
-- Las filas NO se editan ni se borran: son hechos con hora.
CREATE TABLE "caja_testigo" (
  "caja_testigo_id"  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        UUID        NOT NULL REFERENCES "tenants" ("tenant_id"),
  "caja_id"          UUID        NOT NULL REFERENCES "cajas" ("caja_id"),
  "garzon_id"        UUID        NOT NULL REFERENCES "garzones" ("garzon_id"),
  -- La sesión, y no solo el garzón: el garzón dice QUIÉN es, la sesión prueba
  -- que ESTABA EN TURNO. Sin esto la firma no es evidencia.
  "sesion_garzon_id" UUID        NOT NULL REFERENCES "sesiones_garzon" ("sesion_garzon_id"),
  "solicitada_por"   UUID        NOT NULL REFERENCES "usuarios" ("usuario_id"),
  "estado"           TEXT        NOT NULL DEFAULT 'pendiente',
  -- pendiente | firmada | rechazada | cancelada | caducada
  "comentario_garzon" TEXT,
  "solicitada_el"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "resuelta_el"      TIMESTAMPTZ,
  "creado_el"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "actualizado_el"   TIMESTAMPTZ,
  "eliminado_el"     TIMESTAMPTZ,
  CONSTRAINT chk_caja_testigo_estado
    CHECK ("estado" IN ('pendiente','firmada','rechazada','cancelada','caducada'))
);
CREATE INDEX "idx_caja_testigo_caja" ON "caja_testigo" ("caja_id");
-- Bloquea firmar dos veces y tener dos pendientes al mismo garzón — pero NO
-- bloquea volver a pedirle fe si rechazó o si su solicitud caducó (decisión del
-- owner 2026-08-11). Con `WHERE eliminado_el IS NULL` a secas, un rechazo dejaba
-- a ese garzón vetado para siempre en esa caja, con un 23505 crudo.
CREATE UNIQUE INDEX "ux_caja_testigo_caja_garzon"
  ON "caja_testigo" ("caja_id", "garzon_id")
  WHERE "estado" IN ('pendiente','firmada') AND "eliminado_el" IS NULL;
-- Búsqueda del garzón: "¿tengo algo pendiente?" en su pantalla.
CREATE INDEX "idx_caja_testigo_pendiente"
  ON "caja_testigo" ("tenant_id", "garzon_id")
  WHERE "estado" = 'pendiente' AND "eliminado_el" IS NULL;
```

- [ ] **Step 2: Agregar los dos campos a la entidad `Caja`**

En `caja.entity.ts`, junto a las otras columnas:

```ts
  @Column({ name: 'cerrada_por', type: 'uuid', nullable: true })
  cerradaPor: string | null;

  @Column({ name: 'testigos_disponibles', type: 'smallint', nullable: true })
  testigosDisponibles: number | null;
```

- [ ] **Step 3: Crear la entidad `CajaTestigo`**

`backend/src/modules/caja/entities/caja-testigo.entity.ts`:

```ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

export type EstadoTestigo =
  | 'pendiente'
  | 'firmada'
  | 'rechazada'
  | 'cancelada'
  | 'caducada';

/**
 * Quién dio fe de un conteo de caja. Las filas son **hechos con hora**: se
 * insertan y se resuelven una vez, nunca se editan ni se borran. El soft delete
 * está por convención del repo; ninguna operación de esta feature lo usa.
 */
@Entity('caja_testigo')
@Index('ux_caja_testigo_caja_garzon', ['cajaId', 'garzonId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class CajaTestigo {
  @PrimaryGeneratedColumn('uuid', { name: 'caja_testigo_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'caja_id', type: 'uuid' })
  cajaId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  /** La prueba de que estaba en turno, no solo de quién es. */
  @Column({ name: 'sesion_garzon_id', type: 'uuid' })
  sesionGarzonId: string;

  @Column({ name: 'solicitada_por', type: 'uuid' })
  solicitadaPor: string;

  @Column({ name: 'estado', type: 'text', default: 'pendiente' })
  estado: EstadoTestigo;

  @Column({ name: 'comentario_garzon', type: 'text', nullable: true })
  comentarioGarzon: string | null;

  @Column({ name: 'solicitada_el', type: 'timestamptz' })
  solicitadaEl: Date;

  @Column({ name: 'resuelta_el', type: 'timestamptz', nullable: true })
  resueltaEl: Date | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

- [ ] **Step 4: Registrar la entidad en `app.module.ts`** ⚠️

Importar `CajaTestigo` y agregarla al array `entities: [...]` de la config de TypeORM (`app.module.ts:157`). **No hay `autoLoadEntities`:** `forFeature` en el módulo no alcanza, y ni el unit ni el typecheck lo cazan — solo el e2e contra Postgres real.

- [ ] **Step 5: Levantar la base y verificar que la tabla existe**

```bash
./scripts/reset-db.sh
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c "\d caja_testigo"
```

Expected: la tabla con sus 12 columnas y los tres índices.

- [ ] **Step 6: Gate y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```

```bash
git add startup-pos.sql backend/src/modules/caja/entities/ backend/src/app.module.ts
git commit -m "feat(caja): esquema del testigo de cierre — quién contó y quién dio fe"
```

---

## Task 2: El cierre forzado congela quién contó y cuánta gente había

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts` (`enviarConteo`, ~línea 655)
- Modify: `backend/src/modules/caja/caja.controller.ts` (`POST :id/conteo`, ~línea 183)
- Modify: `backend/src/modules/caja/caja.module.ts` (importar `TurnosModule`)
- Test: `backend/src/modules/caja/caja.service.spec.ts`

**Interfaces:**
- Consumes: `Caja.cerradaPor`, `Caja.testigosDisponibles` (Task 1).
- Produces: `enviarConteo(tenantId, usuarioId, cajaId, dto, esAdmin: boolean)` — **firma nueva, con un 5º parámetro**. Devuelve lo mismo que antes: `{ estado: 'cerrada' | 'en_conciliacion'; arqueo: LineaArqueo[] }`.

- [ ] **Step 1: Escribir los tests que fallan**

En `caja.service.spec.ts`:

```ts
it('cierre forzado: un admin no dueño puede enviar el conteo y queda registrado quién contó', async () => {
  const caja = { ...cajaAbierta, usuarioId: OTRO_USUARIO_ID };
  managerMock.findOne.mockResolvedValue(caja);

  await service.enviarConteo(TENANT_ID, ADMIN_ID, CAJA_ID, dtoConteo, true);

  expect(managerMock.save).toHaveBeenCalledWith(
    Caja,
    expect.objectContaining({ cerradaPor: ADMIN_ID }),
  );
});

it('cierre normal: cerrada_por también se guarda, y es el dueño', async () => {
  await service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, dtoConteo, false);

  expect(managerMock.save).toHaveBeenCalledWith(
    Caja,
    expect.objectContaining({ cerradaPor: USUARIO_ID }),
  );
});

it('un NO admin que no es dueño sigue sin poder tocar la caja', async () => {
  const caja = { ...cajaAbierta, usuarioId: OTRO_USUARIO_ID };
  managerMock.findOne.mockResolvedValue(caja);

  await expect(
    service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, dtoConteo, false),
  ).rejects.toBeInstanceOf(ForbiddenException);
});

// El retoque al flujo existente: sin esta ventana no hay dónde poner la firma.
it('un cierre forzado que CUADRA igual queda en_conciliacion, no se auto-cierra', async () => {
  const caja = { ...cajaAbierta, usuarioId: OTRO_USUARIO_ID };
  managerMock.findOne.mockResolvedValue(caja);
  // dtoConteoExacto: contado == esperado en todas las líneas

  const r = await service.enviarConteo(
    TENANT_ID, ADMIN_ID, CAJA_ID, dtoConteoExacto, true,
  );

  expect(r.estado).toBe('en_conciliacion');
});

it('un cierre NORMAL que cuadra sigue auto-cerrándose', async () => {
  const r = await service.enviarConteo(
    TENANT_ID, USUARIO_ID, CAJA_ID, dtoConteoExacto, false,
  );

  expect(r.estado).toBe('cerrada');
});

it('congela cuántos garzones había en turno', async () => {
  sesionesGarzonServiceMock.listarAbiertas.mockResolvedValue([{}, {}, {}]);

  await service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, dtoConteo, false);

  expect(managerMock.save).toHaveBeenCalledWith(
    Caja,
    expect.objectContaining({ testigosDisponibles: 3 }),
  );
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && npx jest src/modules/caja/caja.service.spec.ts -t "cierre forzado"`
Expected: FAIL — `enviarConteo` toma 4 parámetros, no 5.

- [ ] **Step 3: Inyectar `SesionesGarzonService` en `CajaService`**

En `caja.module.ts`, agregar `TurnosModule` a `imports` (ahí vive `SesionesGarzonService`; verificar que esté exportado y, si no, exportarlo). En el constructor de `CajaService`, agregar `private readonly sesionesGarzonService: SesionesGarzonService`.

- [ ] **Step 4: Cambiar el guard de dueño y guardar los dos campos**

En `enviarConteo`, reemplazar:

```ts
      if (caja.usuarioId !== usuarioId) {
        throw new ForbiddenException('No tienes acceso a esta caja');
      }
```

por:

```ts
      // Cierre forzado (decisión del owner 2026-08-11): un admin del tenant puede
      // cerrar la caja de otro. Sin esto, un cajero que se va deja su caja abierta
      // para siempre y —por `ux_cajas_activa_por_usuario`— no puede volver a abrir
      // ninguna. El dueño sigue siendo el único no-admin que puede.
      const esForzado = caja.usuarioId !== usuarioId;
      if (esForzado && !esAdmin) {
        throw new ForbiddenException('No tienes acceso a esta caja');
      }
```

Y antes de `await manager.save(Caja, caja)`:

```ts
      // Se guarda SIEMPRE, no solo en el forzado: "forzado" se deriva de
      // `cerrada_por <> usuario_id`. Un flag podría contradecir a los datos.
      caja.cerradaPor = usuarioId;
      // Congelado acá y no consultado después: más tarde daría otro número.
      // Cuenta sesiones abiertas, que es lo único que el sistema sabe de "quién
      // está en turno" (los usuarios no tienen sesión de turno).
      const abiertas = await this.sesionesGarzonService.listarAbiertas(tenantId);
      caja.testigosDisponibles = abiertas.length;
```

Y en la bifurcación, cambiar `if (hayDescuadre)` por `if (hayDescuadre || esForzado)`, con:

```ts
      // Un cierre forzado pasa por la ventana de conciliación AUNQUE CUADRE: es
      // donde viven las solicitudes de testigo. Sin esto, una caja forzada que
      // cuadra se auto-cerraría y no habría dónde poner la firma.
```

- [ ] **Step 5: Pasar `esAdmin` desde el controller**

En `caja.controller.ts`, `POST :id/conteo` pasa a ser `async` y computa `esAdmin` igual que `cerrar` (línea ~209):

```ts
    const esAdmin = await this.rbacService.userIsTenantAdmin(u.id, u.tenantId!);
    return this.cajaService.enviarConteo(u.tenantId!, u.id, cajaId, dto, esAdmin);
```

- [ ] **Step 6: Correr los tests**

Run: `cd backend && npx jest src/modules/caja`
Expected: PASS, incluidos los que ya existían.

- [ ] **Step 7: Mutante — verificar que el test del cuadre sirve**

Revertir `if (hayDescuadre || esForzado)` a `if (hayDescuadre)` y correr:
Run: `npx jest src/modules/caja -t "cuadra igual queda en_conciliacion"`
Expected: **FAIL**. Restaurar y confirmar verde.

- [ ] **Step 8: Gate completo y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
cd .. && ./scripts/reset-db.sh && cd backend && npm run test:e2e
```

```bash
git add backend/src/modules/caja/
git commit -m "feat(caja): el encargado puede cerrar la caja de un cajero ausente"
```

---

## Task 3: Solicitar, firmar y rechazar

**Files:**
- Create: `backend/src/modules/caja/caja-testigo.service.ts`
- Create: `backend/src/modules/caja/dto/solicitar-testigo.dto.ts`
- Create: `backend/src/modules/caja/dto/resolver-testigo.dto.ts`
- Modify: `backend/src/modules/caja/caja.controller.ts`, `caja.module.ts`
- Test: `backend/src/modules/caja/caja-testigo.service.spec.ts`

**Interfaces:**
- Consumes: entidad `CajaTestigo` (Task 1); `Caja.estado === 'en_conciliacion'` (Task 2).
- Produces:
  - `solicitar(tenantId, usuarioId, cajaId, garzonIds: string[]): Promise<CajaTestigo[]>`
  - `pendientesDeGarzon(tenantId, garzonId): Promise<SolicitudPublica[]>`
  - `resolver(tenantId, testigoId, dto: ResolverTestigoDto): Promise<CajaTestigo>`
  - `cancelarPendientes(manager, tenantId, cajaId): Promise<void>`
  - `caducarPorSesion(manager, tenantId, sesionGarzonId): Promise<void>`
  - `hayFirmaDe(tenantId, cajaId): Promise<boolean>`

- [ ] **Step 1: Los DTOs**

`solicitar-testigo.dto.ts`:

```ts
import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class SolicitarTestigoDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  garzonIds: string[];
}
```

`resolver-testigo.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

export class ResolverTestigoDto {
  /** El PIN del propio garzón. Es lo que hace que el encargado no pueda firmar por él. */
  @IsString()
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener 6 dígitos' })
  pin: string;

  /** `true` = doy fe · `false` = rechazo. */
  @IsBoolean()
  firma: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  comentario?: string;
}
```

⚠️ Verificar el largo del PIN contra `garzones.service.ts` antes de fijar el `@Matches` (el seed usa 6 dígitos: `111111`).

- [ ] **Step 2: Escribir los tests que fallan**

En `caja-testigo.service.spec.ts`:

```ts
it('solicita a los garzones con sesión abierta y deja las filas pendientes', async () => {
  sesionesMock.listarAbiertas.mockResolvedValue([
    { garzonId: GARZON_A, sesionGarzonId: SESION_A },
    { garzonId: GARZON_B, sesionGarzonId: SESION_B },
  ]);

  await service.solicitar(TENANT_ID, ADMIN_ID, CAJA_ID, [GARZON_A]);

  expect(repoMock.save).toHaveBeenCalledWith(
    expect.objectContaining({
      garzonId: GARZON_A,
      sesionGarzonId: SESION_A,
      solicitadaPor: ADMIN_ID,
      estado: 'pendiente',
    }),
  );
});

it('rechaza pedirle fe a un garzón SIN sesión abierta', async () => {
  sesionesMock.listarAbiertas.mockResolvedValue([]);

  await expect(
    service.solicitar(TENANT_ID, ADMIN_ID, CAJA_ID, [GARZON_A]),
  ).rejects.toBeInstanceOf(BadRequestException);
});

// ⚠️ CORREGIDO 2026-08-11 tras medirlo en la revisión de la Task 2: el
// placeholder "Mostrador" **no puede** aparecer en `listarAbiertas`. Se crea
// `activo: false` con `pinHash: '!'` (`garzones.service.ts`), y `verificarPin`
// exige `activo: true`, así que no tiene ningún camino para abrir sesión.
// El test de abajo montaba un escenario IMPOSIBLE por API — el molde de
// "test de estado inalcanzable" que el repo ya tiene anotado.
//
// Lo que SÍ hay que fijar es la conducta observable: la exclusión existe
// porque el garzón tiene que estar en turno, y el placeholder nunca lo está.
// Un test que fuerce `esPlaceholder` por mock probaría una defensa que
// ninguna entrada real puede ejercitar. **No escribir ese test.**
// Si al implementar aparece un camino real por el que un placeholder tenga
// sesión abierta, eso es un hallazgo: reportarlo, no taparlo con un guard.
it('rechaza pedirle fe a un garzón que no está en la lista de sesiones abiertas', async () => {
  sesionesMock.listarAbiertas.mockResolvedValue([
    { garzonId: GARZON_B, sesionGarzonId: SESION_B },
  ]);

  await expect(
    service.solicitar(TENANT_ID, ADMIN_ID, CAJA_ID, [GARZON_A]),
  ).rejects.toBeInstanceOf(BadRequestException);
});

it('solo se puede solicitar sobre una caja en conciliación (conteo ya congelado)', async () => {
  cajaRepoMock.findOne.mockResolvedValue({ id: CAJA_ID, estado: 'abierta' });

  await expect(
    service.solicitar(TENANT_ID, ADMIN_ID, CAJA_ID, [GARZON_A]),
  ).rejects.toBeInstanceOf(BadRequestException);
});

it('firma con el PIN correcto y queda `firmada` con hora', async () => {
  const r = await service.resolver(TENANT_ID, TESTIGO_ID, { pin: '111111', firma: true });

  expect(r.estado).toBe('firmada');
  expect(r.resueltaEl).toBeInstanceOf(Date);
});

it('un PIN incorrecto no firma', async () => {
  bcryptCompare.mockResolvedValue(false);

  await expect(
    service.resolver(TENANT_ID, TESTIGO_ID, { pin: '999999', firma: true }),
  ).rejects.toBeInstanceOf(ForbiddenException);
});

it('el rechazo se guarda con lo que el garzón quiso decir', async () => {
  const r = await service.resolver(TENANT_ID, TESTIGO_ID, {
    pin: '111111',
    firma: false,
    comentario: 'No vi el conteo, estaba en la cocina',
  });

  expect(r.estado).toBe('rechazada');
  expect(r.comentarioGarzon).toBe('No vi el conteo, estaba en la cocina');
});

it('una solicitud ya resuelta no se puede volver a resolver', async () => {
  repoMock.findOne.mockResolvedValue({ id: TESTIGO_ID, estado: 'firmada' });

  await expect(
    service.resolver(TENANT_ID, TESTIGO_ID, { pin: '111111', firma: true }),
  ).rejects.toBeInstanceOf(BadRequestException);
});
```

- [ ] **Step 3: Correr y verificar que fallan**

Run: `cd backend && npx jest src/modules/caja/caja-testigo.service.spec.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 4: Implementar `CajaTestigoService`**

Puntos que el código tiene que respetar, cada uno con su test arriba:

1. `solicitar` valida que la caja esté en `en_conciliacion` — **el conteo ya está congelado**. Es lo que hace que la firma valga: contra números que no pueden cambiar.
2. Los garzones pedidos tienen que estar en `listarAbiertas(tenantId)`; de ahí sale además el `sesionGarzonId` (no se acepta del cliente).
3. La elegibilidad se resuelve **por estar en `listarAbiertas`**, no por una lista
   de exclusiones. El placeholder queda afuera solo, porque no puede abrir sesión
   (medido). No agregues un guard de `esPlaceholder` "por las dudas": sería una
   defensa que ninguna entrada real puede ejercitar.
4. `resolver` compara el PIN con `bcrypt.compare` contra `garzones.pin_hash` — **misma mecánica que `sesiones-garzon`**, reusar el helper que ya exista ahí en vez de duplicar el compare.
5. Solo resuelve una fila `pendiente`; cualquier otro estado → 400.
6. Una sola query para traer garzones (`WHERE garzon_id = ANY($1)`), nunca una por id.
7. Toda lectura filtra `eliminado_el IS NULL`.

- [ ] **Step 5: Rutas en el controller**

```ts
  /** El encargado pide la firma. Requiere `Cajas:Actualizar` — primera ruta que lo usa. */
  @Post(':id/testigos')
  @RequiresPermiso('Cajas', 'Actualizar')
  solicitarTestigos(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: SolicitarTestigoDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaTestigoService.solicitar(u.tenantId!, u.id, cajaId, dto.garzonIds);
  }

  /**
   * El garzón resuelve la SUYA. Ojo: NO lleva `Cajas:Actualizar` a propósito — el
   * garzón no tiene permisos de caja. El control es el PIN + que la solicitud sea
   * de una sesión abierta suya. Es exactamente lo que impide que el encargado
   * firme por él.
   */
  @Post('testigos/:testigoId/resolver')
  resolverTestigo(
    @Req() req: Request,
    @Param('testigoId') testigoId: string,
    @Body() dto: ResolverTestigoDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaTestigoService.resolver(u.tenantId!, testigoId, dto);
  }

  /** Lo que el garzón ve al entrar a su pantalla. */
  @Get('testigos/pendientes/:garzonId')
  pendientesDeGarzon(@Req() req: Request, @Param('garzonId') garzonId: string) {
    const u = req.user as JwtUser;
    return this.cajaTestigoService.pendientesDeGarzon(u.tenantId!, garzonId);
  }
```

⚠️ `pendientesDeGarzon` devuelve **lo contado, nunca lo esperado** — si filtra el esperado, rompe el cierre ciego. Que el `SELECT` traiga solo `contado` de `caja_arqueo_medio`.

- [ ] **Step 6: Correr los tests**

Run: `cd backend && npx jest src/modules/caja`
Expected: PASS.

- [ ] **Step 7: Gate completo y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
cd .. && ./scripts/reset-db.sh && cd backend && npm run test:e2e
```

```bash
git add backend/src/modules/caja/
git commit -m "feat(caja): el garzón da fe del conteo, o lo rechaza, desde su propia sesión"
```

---

## Task 4: Cerrar exige comentario si nadie firmó, y las pendientes se resuelven

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts` (`cerrar`, ~línea 770)
- Modify: `backend/src/modules/caja/dto/finalizar-cierre.dto.ts`
- Modify: `backend/src/modules/turnos/sesiones-garzon.service.ts`
- Test: `backend/src/modules/caja/caja.service.spec.ts`, `sesiones-garzon.service.spec.ts`

**Interfaces:**
- Consumes: `hayFirmaDe`, `cancelarPendientes`, `caducarPorSesion` (Task 3).
- Produces: `cerrar(...)` valida el comentario; `FinalizarCierreDto.comentario?: string`.

> **Por qué el comentario se valida acá y no en el conteo:** al congelar el conteo **todavía no hay firmas** —se piden después—. "Si nadie firmó" solo se sabe al cerrar.
>
> **Y por qué no hay columna nueva:** `cajas.comentario` ya lo escribe `enviarConteo` (`caja.service.ts:737`). Es, de hecho, el comentario del cierre. Ver la corrección en la spec.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('cierre forzado sin ninguna firma exige comentario', async () => {
  cajaTestigoServiceMock.hayFirmaDe.mockResolvedValue(false);
  const caja = { ...cajaEnConciliacion, usuarioId: OTRO_USUARIO_ID, cerradaPor: ADMIN_ID };
  managerMock.findOne.mockResolvedValue(caja);

  await expect(
    service.cerrar(TENANT_ID, ADMIN_ID, CAJA_ID, true, { motivos: [] }),
  ).rejects.toThrow(/comentario/i);
});

it('cierre forzado CON firma no exige comentario', async () => {
  cajaTestigoServiceMock.hayFirmaDe.mockResolvedValue(true);
  const caja = { ...cajaEnConciliacion, usuarioId: OTRO_USUARIO_ID, cerradaPor: ADMIN_ID };
  managerMock.findOne.mockResolvedValue(caja);

  await expect(
    service.cerrar(TENANT_ID, ADMIN_ID, CAJA_ID, true, { motivos: [] }),
  ).resolves.toBeDefined();
});

it('cierre NORMAL sin comentario sigue funcionando', async () => {
  await expect(
    service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, { motivos: [] }),
  ).resolves.toBeDefined();
});

it('al cerrar, las solicitudes pendientes quedan canceladas', async () => {
  await service.cerrar(TENANT_ID, ADMIN_ID, CAJA_ID, true, {
    motivos: [], comentario: 'conté solo',
  });

  expect(cajaTestigoServiceMock.cancelarPendientes).toHaveBeenCalledWith(
    expect.anything(), TENANT_ID, CAJA_ID,
  );
});
```

Y en `sesiones-garzon.service.spec.ts`:

```ts
it('cerrar la sesión caduca las solicitudes de testigo pendientes', async () => {
  await service.cerrarPropia(TENANT_ID, GARZON_ID, PIN);

  expect(cajaTestigoServiceMock.caducarPorSesion).toHaveBeenCalledWith(
    expect.anything(), TENANT_ID, SESION_ID,
  );
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && npx jest src/modules/caja src/modules/turnos -t "testigo|comentario|caduca"`
Expected: FAIL.

- [ ] **Step 3: Agregar `comentario` al DTO de fase 2**

```ts
  @IsOptional()
  @IsString()
  @Length(1, 500)
  comentario?: string;
```

- [ ] **Step 4: Implementar la validación y el cierre de pendientes**

En `cerrar`, dentro de la transacción y **antes** de pasar a `cerrada`:

```ts
      // El comentario se exige acá y no en el conteo porque al congelar todavía
      // no había firmas: "nadie firmó" solo se sabe al cerrar. Sin esto, un
      // cierre sin testigo no dice nada y es justo el caso que hay que explicar.
      const esForzado = caja.cerradaPor !== null && caja.cerradaPor !== caja.usuarioId;
      if (esForzado && !(await this.cajaTestigoService.hayFirmaDe(tenantId, cajaId))) {
        if (!dto.comentario?.trim()) {
          throw new BadRequestException(
            'Un cierre sin testigo requiere un comentario que explique qué pasó',
          );
        }
        caja.comentario = dto.comentario.trim();
      }
      await this.cajaTestigoService.cancelarPendientes(manager, tenantId, cajaId);
```

Y en `sesiones-garzon.service.ts`, dentro de la transacción de cierre de sesión (las dos vías: `cerrarPropia` y `cerrarAdmin`):

```ts
      // Una solicitud viva contra una sesión cerrada es un estado imposible de
      // honrar: la firma se valida contra esa sesión.
      await this.cajaTestigoService.caducarPorSesion(manager, tenantId, sesion.id);
```

⚠️ **Cuidado con la dependencia circular:** `TurnosModule` ya va a estar importado por `CajaModule` (Task 2). Si al importar `CajaModule` desde `TurnosModule` aparece un ciclo, resolverlo con `forwardRef` **y dejar un comentario de por qué**, en vez de mover lógica de lugar.

- [ ] **Step 5: Correr los tests**

Run: `cd backend && npx jest src/modules/caja src/modules/turnos`
Expected: PASS.

- [ ] **Step 6: Gate completo y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
cd .. && ./scripts/reset-db.sh && cd backend && npm run test:e2e
```

```bash
git add backend/src/modules/
git commit -m "feat(caja): cerrar sin testigo exige explicar por qué"
```

---

## Task 5: E2E — el camino completo, y el que NO tiene que poder pasar

**Files:**
- Create: `backend/test/caja-testigo.e2e-spec.ts`

**Interfaces:**
- Consumes: todas las rutas de las Tasks 2-4.
- Produces: nada.

⚠️ **Garzón PROPIO, no el del seed.** La sesión es única por garzón y varias specs comparten a Ana; usarla rompe `garzon-modo-personal` con un 400 "ya tiene una sesión abierta". Crear garzón y turno propios en `beforeAll` y cerrarlos en `afterAll`.

- [ ] **Step 1: Escribir el spec completo**

Casos, en este orden:

1. **Camino feliz:** admin cierra la caja de otro → queda `en_conciliacion` aunque cuadre → solicita firma a un garzón con sesión → el garzón firma con su PIN → cierra sin comentario → el detalle muestra `cerradaPor`, `testigosDisponibles` y la firma.
2. **🔒 El que más importa — el encargado NO puede firmar por el garzón.** Con el token del admin, `POST /caja/testigos/:id/resolver` con el PIN correcto del garzón → **403**. Si este test pasa en verde con la implementación equivocada, la feature entera no sirve.
3. **Rechazo:** el garzón rechaza con comentario → la caja igual se puede cerrar, pero **exige comentario** (rechazo ≠ firma).
4. **Sin testigo:** cerrar sin solicitar nada → 400 sin comentario, 201 con comentario.
5. **Cierre normal intacto:** el dueño cierra su propia caja que cuadra → `cerrada` directo, sin pasar por conciliación.
6. **Garzón sin sesión:** solicitar a un garzón sin sesión abierta → 400.

- [ ] **Step 2: Correr sobre base limpia**

```bash
./scripts/reset-db.sh
cd backend && npx jest --config test/jest-e2e.json caja-testigo
```

Expected: PASS. Si falla raro: `./scripts/reset-db.sh --verificar` dice si la base se movió.

- [ ] **Step 3: El mutante que anula la feature**

En `caja-testigo.service.ts`, cambiar la validación de `resolver` para que acepte cualquier usuario autenticado en vez de exigir el PIN del garzón. Correr el caso 2:
Expected: **FAIL**. Restaurar y confirmar verde.

- [ ] **Step 4: El otro mutante — el orden**

Permitir `solicitar` sobre una caja `abierta` (o sea, **antes** de congelar el conteo). Correr el spec:
Expected: **FAIL** en el caso 6 o en un caso nuevo que lo cubra. Si ningún test se cae, **agregar el test**: es el error que vacía de sentido a la firma.

- [ ] **Step 5: Gate completo y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
cd .. && ./scripts/reset-db.sh && cd backend && npm run test:e2e
```

```bash
git add backend/test/caja-testigo.e2e-spec.ts
git commit -m "test(e2e): el encargado no puede firmar por el garzón"
```

---

## Task 6: Frontend — el encargado

**Files:**
- Modify: el composable de caja en `frontend/app/composables/` (identificar el existente; **no crear uno nuevo** si ya hay uno de caja)
- Modify: `frontend/app/pages/cajas/`
- Test: el `.nuxt.spec.ts` de la página que se toque

**Interfaces:**
- Consumes: `POST /caja/:id/conteo`, `POST /caja/:id/testigos`, `POST /caja/:id/cerrar`, `GET /sesiones-garzon` (abiertas).
- Produces: nada para otras tasks.

- [ ] **Step 1: Invocar la skill de Nuxt UI antes de escribir componentes**

Cargar `nuxt-ui` (y `search_components` si hace falta) — vale también para copiar un patrón existente.

- [ ] **Step 2: Escribir el test de la página**

```ts
it('el botón de cerrar caja ajena aparece solo con permiso sobre Cajas', async () => { /* ... */ })

it('muestra cuántos garzones hay en turno, y avisa cuando no hay ninguno', async () => { /* ... */ })

it('sin firma, el botón de cerrar pide el comentario antes de habilitarse', async () => { /* ... */ })
```

- [ ] **Step 3: Implementar**

Sobre la vista de supervisión: acción "Cerrar por el cajero" en una caja abierta ajena, que muestre **de quién es y desde cuándo**; el conteo a ciegas ya existente; la lista de garzones en turno para pedir firma; y el estado de cada solicitud (pendiente / firmada / rechazada) mientras se espera.

Usar tokens semánticos de Nuxt UI. La excepción de colores financieros de Caja aplica solo a montos.

- [ ] **Step 4: Correr los tests**

Run: `cd frontend && npm test`

- [ ] **Step 5: Gate del frontend y commit**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

```bash
git add frontend/app/
git commit -m "feat(cajas): el encargado cierra la caja de un ausente y pide testigo"
```

---

## Task 6b (INSERTADA 2026-08-13, no estaba en el plan original): forzar el cierre pasa a ser operativo

**Por qué se insertó:** la revisión independiente de la Task 6 mostró que quien fuerza un
cierre **siempre ve el esperado** —forzar exigía ser admin del tenant, y el modo ciego exime
al admin—, así que el "cuenta a ciegas" de la spec no lo ejercía nadie. El owner decidió que
la causa era el requisito, no el ciego: *"el administrador no siempre estará pendiente, hay que
pasarlo a la operación, esto es parte de la operación"*.

**Decisión 1:** forzar exige **`Cajas:Actualizar`** (el mismo permiso que ya exigía pedir la
firma desde la Task 6 — las dos mitades del mismo camino tenían puertas distintas). El admin lo
conserva por el short-circuit de su rol fijo.
**Decisión 2:** el encargado cuenta a ciegas; el admin mantiene su exención (§3.4). **No hubo
que implementarlo**: la exención ya estaba escrita como `!esAdmin`, así que sale sola en cuanto
un no-admin puede forzar. Se verificó con e2e, no se tocó ninguna de las cuatro superficies.

- [x] Autorización de `enviarConteo`/`cerrar`: `esAdmin` → `puedeForzar`, resuelto por
  `resolverEscrituraCompartida` (dueño con `MiCaja:Actualizar` **o** cualquiera con
  `Cajas:Actualizar`). Las dos rutas pierden el `@RequiresPermiso` y el piso se comprueba a
  mano, explícito — nunca borrando el guard sin reemplazo.
- [x] Seed: `encargado@paris.cl` + rol con `Cajas:Leer` + `Cajas:Actualizar` (no admin).
  `supervisor@paris.cl` queda intacto: es el arnés del "no-admin al que el ciego sí le aplica".
- [x] Frontend: el gate pasa de `perms.esAdmin` a `usePermisosCrud('Cajas').puedeActualizar`.
- [x] E2E: el encargado puede forzar; con el tenant en ciego **no ve `esperado`** y el admin sí
  sobre la misma caja; `Cajas:Leer` a secas sigue en 403.
- [x] Mutante: `puedeForzar = true` sin mirar el permiso → muere el 403. Revertido y verificado.

**Lo que dejó abierto** (`docs/agent/pendientes.md`): la spec sigue prometiendo un ciego sin
excepciones y hay que corregir ese texto; y `Cajas:Actualizar` quedó siendo un permiso grueso
—gobierna el CRUD de cajones, pedir la firma y forzar el cierre—, elegido a conciencia por el
owner sobre crear uno nuevo.

---

## Task 7: Frontend — el garzón, y el smoke en navegador

**Files:**
- Modify: `frontend/app/pages/salones/index.vue`
- Test: `frontend/app/pages/salones/index.nuxt.spec.ts`

**Interfaces:**
- Consumes: `GET /caja/testigos/pendientes/:garzonId`, `POST /caja/testigos/:id/resolver`.

- [ ] **Step 1: Escribir el test**

```ts
it('muestra la solicitud pendiente al entrar', async () => { /* ... */ })

it('muestra LO CONTADO y nunca lo esperado', async () => {
  // Si el esperado aparece, se rompe el cierre ciego. Este test es el guardián.
})

it('firmar pide el PIN; rechazar permite comentario', async () => { /* ... */ })
```

- [ ] **Step 2: Implementar**

Aviso **pasivo**: la solicitud se consulta al montar la pantalla, sin polling ni tiempo real. Modal con lo contado, botón de firmar (pide PIN) y de rechazar (PIN + comentario opcional).

- [ ] **Step 3: Correr los tests**

Run: `cd frontend && npm test`

- [ ] **Step 4: Smoke en navegador — obligatorio**

⚠️ Los tests de esta pantalla no ven bugs de runtime (auto-imports de Nuxt, drift de duplicados). Con `docker-compose up`, en el Chrome real del owner (no el navegador del agente): abrir un cierre forzado, pedir firma, ir a `/salones`, firmar, y ver el detalle con la historia completa. Mirar la consola y el log de red.

- [ ] **Step 5: Gate del frontend y commit**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

```bash
git add frontend/app/
git commit -m "feat(salones): el garzón ve la solicitud y da fe con su PIN"
```

---

## Task 8: Documentación

**Files:**
- Modify: `docs/features/gestion-cajas.md`, `docs/ESTADO.md`, `docs/DIFERENCIADORES.md`, `docs/agent/pendientes.md`

- [ ] **Step 1: `gestion-cajas.md`** — el cierre forzado, el ciclo de vida de una solicitud, y **por qué el conteo se congela antes de pedir la firma** (que es lo que hace que valga).

- [ ] **Step 2: `ESTADO.md`** — fila nueva, ✅ con fecha.

- [ ] **Step 3: `DIFERENCIADORES.md`** — mover el testigo de 📐 a ✅ con la fecha. **No tocar** la advertencia de que el ángulo legal chileno sigue sin validar por un abogado.

- [ ] **Step 4: `pendientes.md`** — cerrar la entrada del cierre forzado y mudarla a `resueltos.md` con el texto de su cierre. **Dejar abiertas** la del umbral y la del aviso al dueño de la plata.

- [ ] **Step 5: Revisión independiente y commit**

Antes de commitear, `verify-feature` paso 7: revisión por `domain-reviewer` sobre el diff completo, y el recibo que pide el hook:

```bash
git diff --cached | git hash-object --stdin > .git/verify-feature.receipt
```

```bash
git commit -m "docs(caja): el testigo del cierre forzado, y por qué el orden importa"
```

---

## Self-Review

**Cobertura de la spec:** modelo → Task 1; cierre forzado + `cerrada_por` + `testigos_disponibles` + la ventana aunque cuadre → Task 2; solicitud/firma/rechazo + que el encargado no pueda firmar → Task 3; comentario obligatorio + cancelar + caducar → Task 4; el e2e del control central → Task 5; las dos superficies → Tasks 6-7; docs → Task 8.

**Un requisito de la spec quedó sin task propia y es a propósito:** *"la diferencia se lee como incidente"* no es código — se deriva de `cerrada_por <> usuario_id` en la presentación, y va dentro de las Tasks 6-7.

**Consistencia de tipos:** `enviarConteo` toma 5 parámetros desde Task 2 y las Tasks 4-5 lo usan así. `hayFirmaDe`, `cancelarPendientes` y `caducarPorSesion` se definen en Task 3 y se consumen en Task 4 con esas firmas.

**Lo que este plan asume y hay que verificar al ejecutarlo** (no son placeholders: son cosas que el ejecutor tiene que medir, no inventar):
- El largo del PIN (Task 3, Step 1) — el seed usa 6 dígitos.
- Si `SesionesGarzonService` está exportado por `TurnosModule` (Task 2, Step 3).
- Si aparece dependencia circular entre `CajaModule` y `TurnosModule` (Task 4, Step 4).
- El nombre del composable de caja existente en el frontend (Task 6) — **no crear uno nuevo sin mirar**.
