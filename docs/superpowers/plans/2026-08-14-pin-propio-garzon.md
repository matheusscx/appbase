# El PIN del garzón es suyo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`2026-08-14-pin-propio-garzon-design.md`](../specs/2026-08-14-pin-propio-garzon-design.md) — leerla entera antes de la Task 1.

**Goal:** Que el garzón con cuenta fije su propio PIN sin que el encargado lo vea nunca, y que todo cambio de PIN quede en un registro con historia completa.

**Architecture:** El vínculo `garzones.usuario_id` es el ancla: al vincular, el PIN emitido por el encargado se invalida con el centinela `pinHash = '!'` (que ya usa el placeholder `Mostrador`), y el garzón fija el suyo desde su perfil vía `PATCH /garzones/mi-pin`, resuelto por JWT + tenant. Cada escritura de `pin_hash` va en la misma transacción que una fila de `garzon_pin_evento`.

**Tech Stack:** NestJS + TypeORM (`synchronize`, sin migraciones) + Postgres 15 · bcryptjs 3.0.3 · Nuxt 4 + Nuxt UI · Jest + supertest · Playwright.

## Global Constraints

- **`tenant_id` siempre del token**, nunca del body, query ni ruta — incluidas las rutas de "mi PIN".
- **Soft delete en todo:** `garzon_pin_evento` lleva `eliminado_el` y toda lectura filtra `eliminado_el IS NULL`. Nunca `DELETE` físico.
- **PK/FK con `type: 'uuid'` explícito** (ADR-004, forzado por test + CI).
- **`startup-pos.sql` es documentación, no se ejecuta.** El esquema real lo genera `synchronize` desde las entities: todo índice y CHECK que tenga que existir de verdad va en decoradores, y además se refleja en el `.sql`.
- **Toda entidad nueva se registra en el array `entities` de `app.module.ts`**, no solo en `forFeature`. No hay `autoLoadEntities`; ni `typecheck` ni los unit tests lo cazan — solo el e2e real.
- **Sin N+1:** el dato derivado por fila se resuelve con `JOIN`/agregación o batch, nunca una query por iteración.
- **No tocar un `.ts` del backend con el e2e corriendo** (bind-mount → recompila y re-siembra).
- **Trabajo directo sobre `main`**, sin ramas ni PRs.
- El centinela de PIN inutilizable es la constante `PIN_INUTILIZABLE = '!'` (Task 1). No repetir el literal.
- Los cinco `tipo` de evento, exactos: `emitido_en_alta`, `regenerado_por_encargado`, `invalidado_por_encargado`, `invalidado_por_vinculo`, `fijado_por_garzon`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `backend/src/modules/garzones/entities/garzon-pin-evento.entity.ts` | **Nuevo.** La fila de historia. Sin lógica |
| `backend/src/modules/garzones/dto/fijar-pin.dto.ts` | **Nuevo.** El PIN que teclea el garzón + confirmación |
| `backend/src/modules/garzones/garzones.service.ts` | Toda la lógica: invalidar, fijar, regenerar, escribir eventos, leer historial |
| `backend/src/modules/garzones/garzones.controller.ts` | Las cuatro rutas y de dónde sale cada identidad |
| `backend/src/modules/garzones/dto/create-garzon.dto.ts` | Suma `usuarioId` |
| `backend/src/app.module.ts` | Registro de la entidad nueva en el array `entities` |
| `backend/test/garzon-pin.e2e-spec.ts` | **Nuevo.** El ciclo completo contra la API real |
| `frontend/app/composables/useGarzones.ts` | Las cuatro llamadas nuevas y los tipos |
| `frontend/app/components/configuracion/MiPinForm.vue` | **Nuevo.** El bloque "Mi PIN" del perfil |
| `frontend/app/components/garzones/PinEventosLista.vue` | **Nuevo.** El historial, compartido por perfil y ficha |
| `frontend/app/pages/configuracion/perfil.vue` · `garzones.vue` · `salones/index.vue` | Las tres superficies |

---

### Task 1: La tabla de eventos existe de verdad

**Files:**
- Create: `backend/src/modules/garzones/entities/garzon-pin-evento.entity.ts`
- Modify: `backend/src/app.module.ts` (import + array `entities`, junto a `Garzon` en la línea ~250)
- Modify: `backend/src/modules/garzones/garzones.service.ts` (solo la constante)
- Modify: `startup-pos.sql` (documentación)

**Interfaces:**
- Produces: `GarzonPinEvento` (entity), `TipoEventoPin` (union type), `PIN_INUTILIZABLE` (const exportada desde `garzones.service.ts`).

- [ ] **Step 1: Crear la entidad**

```ts
// backend/src/modules/garzones/entities/garzon-pin-evento.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  Check,
} from 'typeorm';

/**
 * Qué le pasó al PIN. Los dos de invalidación se distinguen porque dicen cosas
 * distintas: `invalidado_por_vinculo` es "te di una cuenta, tu PIN viejo ya no
 * hace falta"; `invalidado_por_encargado` es "te corté el PIN".
 */
export type TipoEventoPin =
  | 'emitido_en_alta'
  | 'regenerado_por_encargado'
  | 'invalidado_por_encargado'
  | 'invalidado_por_vinculo'
  | 'fijado_por_garzon';

/**
 * Historia de los cambios de PIN de un garzón. Las filas son **hechos con
 * hora**: se insertan y nunca se editan ni se borran. El soft delete está por
 * convención del repo.
 *
 * **Nunca guarda el PIN**, ni en claro ni hasheado — solo el hecho de que
 * cambió. Lo que hace visible el abuso es la frecuencia ("le regeneró el PIN a
 * Ana tres veces esta semana"), y para eso alcanza con quién, a quién y cuándo.
 * Por eso es una tabla y no dos columnas en `garzones`: dos columnas guardan
 * solo el último cambio, y el patrón se pierde en cada sobrescritura.
 *
 * `startup-pos.sql` es documentación de referencia — el esquema real lo genera
 * `synchronize` desde ESTA entity, así que el índice y el CHECK van acá.
 */
@Entity('garzon_pin_evento')
// La lectura siempre es "la historia de este garzón, más nueva primero".
@Index('idx_garzon_pin_evento_garzon', ['garzonId', 'creadoEl'])
@Check(
  'chk_garzon_pin_evento_tipo',
  `"tipo" IN ('emitido_en_alta','regenerado_por_encargado','invalidado_por_encargado','invalidado_por_vinculo','fijado_por_garzon')`,
)
export class GarzonPinEvento {
  @PrimaryGeneratedColumn('uuid', { name: 'garzon_pin_evento_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  @Column({ type: 'text' })
  tipo: TipoEventoPin;

  /**
   * Quién ejecutó la acción. En `fijado_por_garzon` es la cuenta del propio
   * garzón; en el resto, el encargado. NOT NULL a propósito: un evento sin
   * actor no sirve como registro.
   */
  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl?: Date | null;
}
```

- [ ] **Step 2: Registrar la entidad en `app.module.ts`**

Agregar el import junto a los otros y sumar `GarzonPinEvento` al array `entities`, inmediatamente después de `Garzon` (línea ~250). **Este paso es el que se olvida**: sin él la tabla no se crea, y ni `typecheck` ni los unit tests lo cazan — solo el e2e real.

**No hace falta tocar `garzones.module.ts`.** El `forFeature` solo sirve para inyectar un `Repository<GarzonPinEvento>`, y el service no inyecta ninguno: escribe por `manager.save(GarzonPinEvento, …)` dentro de la transacción (Task 2), que resuelve la metadata desde el `DataSource`. Agregarlo sería una línea que no hace nada.

- [ ] **Step 3: Exportar la constante del centinela**

En `garzones.service.ts`, junto a `BCRYPT_COST`:

```ts
/**
 * PIN inutilizable. No es un bcrypt válido, así que `bcrypt.compare` contra él
 * devuelve `false` **sin tirar** (medido con bcryptjs 3.0.3): un garzón sin PIN
 * usable cae por el camino normal de "PIN inválido", sin rama especial.
 * Ya lo usaba el placeholder `Mostrador`; ahora también el garzón con cuenta
 * que todavía no fijó el suyo.
 */
export const PIN_INUTILIZABLE = '!';
```

Reemplazar el literal `'!'` de `asegurarPlaceholder` (`garzones.service.ts:577`) por la constante.

- [ ] **Step 4: Documentar la tabla en `startup-pos.sql`**

Agregar inmediatamente después del bloque `CREATE TABLE garzones`, con el mismo estilo de comentarios del archivo:

```sql
-- Historia de los cambios de PIN de un garzón. Hechos con hora: se insertan y
-- nunca se editan. NUNCA guarda el PIN, ni en claro ni hasheado — solo el hecho
-- de que cambió. Lo que hace visible el abuso es la frecuencia.
CREATE TABLE garzon_pin_evento (
  garzon_pin_evento_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  garzon_id UUID NOT NULL REFERENCES garzones(garzon_id),
  tipo TEXT NOT NULL,
  usuario_id UUID NOT NULL REFERENCES usuarios(usuario_id),
  creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  eliminado_el TIMESTAMPTZ,
  CONSTRAINT chk_garzon_pin_evento_tipo CHECK (tipo IN (
    'emitido_en_alta','regenerado_por_encargado','invalidado_por_encargado',
    'invalidado_por_vinculo','fijado_por_garzon'
  ))
);
CREATE INDEX idx_garzon_pin_evento_garzon
  ON garzon_pin_evento (garzon_id, creado_el);
```

- [ ] **Step 5: Verificar que la tabla se crea de verdad**

```bash
docker-compose restart backend && sleep 25 && docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c "\d garzon_pin_evento"
```

Esperado: la tabla existe, con `idx_garzon_pin_evento_garzon` y `chk_garzon_pin_evento_tipo` listados. Si dice `Did not find any relation`, falta el registro en `app.module.ts` (Step 2).

- [ ] **Step 6: Gate parcial y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```

```bash
git add backend/src/modules/garzones/entities/garzon-pin-evento.entity.ts backend/src/app.module.ts backend/src/modules/garzones/garzones.service.ts startup-pos.sql
git commit -m "feat(garzones): la historia del PIN tiene dónde vivir"
```

---

### Task 2: Vincular una cuenta mata el PIN emitido

**Files:**
- Modify: `backend/src/modules/garzones/dto/create-garzon.dto.ts`
- Modify: `backend/src/modules/garzones/garzones.service.ts` (`crear`, `actualizar`, `assertVinculable`, helper nuevo)
- Modify: `backend/src/modules/garzones/garzones.controller.ts` (pasar `user.id`)
- Test: `backend/src/modules/garzones/garzones.service.spec.ts`

**Interfaces:**
- Consumes: `GarzonPinEvento`, `TipoEventoPin`, `PIN_INUTILIZABLE` (Task 1).
- Produces:
  - `crear(tenantId: string, usuarioActorId: string, dto: CreateGarzonDto): Promise<GarzonConPin>` — `pin` es `string | null`.
  - `actualizar(tenantId: string, usuarioActorId: string, id: string, dto: UpdateGarzonDto): Promise<GarzonConAdvertencias>`
  - `GarzonConPin.pin: string | null`
  - `private guardarConEvento(garzon: Garzon, evento: { tipo: TipoEventoPin; usuarioId: string } | null): Promise<Garzon>`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al harness de `garzones.service.spec.ts`. Primero, `makeRepo()` necesita el manager transaccional (el helper nuevo escribe garzón y evento juntos):

```ts
// dentro de makeRepo(), reemplazando `manager: { query: jest.fn()... }`
const eventos: Record<string, unknown>[] = [];
const manager = {
  query: jest.fn().mockResolvedValue([]),
  eventos, // sonda del test: qué filas se escribieron
  save: jest.fn((_entity: unknown, row: Record<string, unknown>) => {
    if (row && 'tipo' in row) eventos.push(row);
    return Promise.resolve(row);
  }),
  create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
  transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
};
```

Y el tipo `Repo` suma `manager: { query: jest.Mock; eventos: Record<string, unknown>[]; save: jest.Mock; create: jest.Mock; transaction: jest.Mock }`.

Los tests:

```ts
describe('el vínculo con una cuenta y el PIN', () => {
  const ACTOR = 'encargado-uuid';

  it('el alta CON cuenta no emite PIN y no escribe evento', async () => {
    repo.manager.query.mockResolvedValue([{ es_totem: false, garzon_nombre: null }]);

    const res = await service.crear(TENANT, ACTOR, {
      nombre: 'Ana',
      usuarioId: 'cuenta-de-ana',
    });

    expect(res.pin).toBeNull();
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.manager.eventos).toHaveLength(0);
    const guardado = repo.manager.save.mock.calls[0][1] as { pinHash: string };
    expect(guardado.pinHash).toBe('!');
  });

  it('el alta SIN cuenta emite PIN y lo registra', async () => {
    const res = await service.crear(TENANT, ACTOR, { nombre: 'Bruno' });

    expect(res.pin).toMatch(/^\d{6}$/);
    expect(repo.manager.eventos).toEqual([
      expect.objectContaining({ tipo: 'emitido_en_alta', usuarioId: ACTOR }),
    ]);
  });

  it('vincular una cuenta invalida el PIN y lo registra', async () => {
    repo.findOne.mockResolvedValue(garzon({ id: 'g1', pin: '111111', usuarioId: null }));
    repo.manager.query.mockResolvedValue([{ es_totem: false, garzon_nombre: null }]);

    await service.actualizar(TENANT, ACTOR, 'g1', { usuarioId: 'cuenta-de-ana' });

    const guardado = repo.manager.save.mock.calls[0][1] as { pinHash: string };
    expect(guardado.pinHash).toBe('!');
    expect(repo.manager.eventos).toEqual([
      expect.objectContaining({ tipo: 'invalidado_por_vinculo', usuarioId: ACTOR }),
    ]);
  });

  it('DESVINCULAR no toca el PIN: el garzón sigue con el que eligió', async () => {
    const g = garzon({ id: 'g1', pin: '111111', usuarioId: 'cuenta-de-ana' });
    const hashOriginal = g.pinHash;
    repo.findOne.mockResolvedValue(g);

    await service.actualizar(TENANT, ACTOR, 'g1', { usuarioId: null });

    const guardado = repo.manager.save.mock.calls[0][1] as { pinHash: string };
    expect(guardado.pinHash).toBe(hashOriginal);
    expect(repo.manager.eventos).toHaveLength(0);
  });

  it('renombrar a un garzón ya vinculado no re-invalida su PIN', async () => {
    const g = garzon({ id: 'g1', pin: '111111', usuarioId: 'cuenta-de-ana' });
    const hashOriginal = g.pinHash;
    repo.findOne.mockResolvedValue(g);

    await service.actualizar(TENANT, ACTOR, 'g1', { nombre: 'Ana María' });

    const guardado = repo.manager.save.mock.calls[0][1] as { pinHash: string };
    expect(guardado.pinHash).toBe(hashOriginal);
    expect(repo.manager.eventos).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && npx jest src/modules/garzones/garzones.service.spec.ts -t "el vínculo con una cuenta y el PIN"`
Esperado: FAIL — `crear` recibe 2 argumentos, no 3.

- [ ] **Step 3: `CreateGarzonDto` acepta la cuenta**

```ts
  /**
   * Vincula el garzón a una cuenta del tenant desde el alta (**modo personal**).
   * Cuando viene, el garzón **nace sin PIN usable**: lo fija él desde su perfil,
   * y el encargado nunca llega a ver uno. Sin este campo el alta habría que
   * hacerla en dos pasos, y el encargado vería un PIN que muere al vincular.
   */
  @IsOptional()
  @IsUUID('4', { message: 'usuarioId debe ser un UUID' })
  usuarioId?: string;
```

(Sumar `IsUUID` al import de `class-validator`. Acá **sí** va `IsOptional` y no `ValidateIf`: en un alta no existe la distinción ausente/`null` que obligó a `ValidateIf` en `UpdateGarzonDto`.)

- [ ] **Step 4: El helper que escribe garzón y evento juntos**

En `garzones.service.ts`, importar `GarzonPinEvento` y `TipoEventoPin`, y agregar:

```ts
  /**
   * Guarda el garzón y —si hubo cambio de PIN— su fila de historia **en la
   * misma transacción**. Un log que puede quedar desincronizado del hecho que
   * registra no sirve como registro.
   */
  private async guardarConEvento(
    garzon: Garzon,
    evento: { tipo: TipoEventoPin; usuarioId: string } | null,
  ): Promise<Garzon> {
    return this.garzonRepo.manager.transaction(async (m) => {
      const guardado = await m.save(Garzon, garzon);
      if (evento) {
        await m.save(
          GarzonPinEvento,
          m.create(GarzonPinEvento, {
            tenantId: guardado.tenantId,
            garzonId: guardado.id,
            tipo: evento.tipo,
            usuarioId: evento.usuarioId,
          }),
        );
      }
      return guardado;
    });
  }
```

- [ ] **Step 5: `crear` se parte según haya cuenta**

```ts
  async crear(
    tenantId: string,
    usuarioActorId: string,
    dto: CreateGarzonDto,
  ): Promise<GarzonConPin> {
    // Con cuenta el garzón nace SIN PIN usable: lo fija él desde su perfil y el
    // encargado nunca ve uno. No queda bloqueado —en modo personal
    // `resolverGarzonActuante` lo resuelve por JWT—, solo pierde el tótem hasta
    // que fije el suyo.
    if (dto.usuarioId) {
      await this.assertVinculable(tenantId, dto.usuarioId);
    }
    const pin = dto.usuarioId ? null : await this.generarPinUnico(tenantId);
    const garzon = this.garzonRepo.create({
      tenantId,
      nombre: dto.nombre,
      pinHash: pin ? await bcrypt.hash(pin, BCRYPT_COST) : PIN_INUTILIZABLE,
      activo: dto.activo ?? true,
      tipo: dto.tipo ?? TipoGarzon.GARZON,
      usuarioId: dto.usuarioId ?? null,
    });
    // Sin PIN emitido no hay nada que registrar: la historia de ese garzón
    // empieza el día que él fija el suyo.
    const guardado = await this.guardarConEvento(
      garzon,
      pin ? { tipo: 'emitido_en_alta', usuarioId: usuarioActorId } : null,
    );
    return { ...this.toPublico(guardado), pin, advertencias: [] };
  }
```

Y `GarzonConPin` pasa a `pin: string | null`, con el docblock actualizado:

```ts
/**
 * Respuesta de creación / regeneración. `pin` viene en claro **una sola vez**
 * cuando el sistema lo emitió, y es `null` cuando no hay PIN que mostrar: el
 * garzón tiene cuenta y lo fija él. No se persiste en claro ni se puede volver
 * a leer.
 */
export interface GarzonConPin extends GarzonConAdvertencias {
  pin: string | null;
}
```

- [ ] **Step 6: `assertVinculable` sirve también al alta**

`garzonId` pasa a opcional, porque en el alta la fila todavía no existe:

```ts
  private async assertVinculable(
    tenantId: string,
    usuarioId: string,
    garzonId?: string,
  ): Promise<void> {
```

y en el SQL, el parámetro `$3` pasa a `[usuarioId, tenantId, garzonId ?? null]` con la condición
`AND ($3::uuid IS NULL OR g.garzon_id <> $3)`. Sin ese guard, `g.garzon_id <> NULL` es `NULL` y
el `LEFT JOIN` no encontraría nunca un garzón ya vinculado: el alta dejaría crear la colisión que
`uq_garzones_usuario_tenant` después rechaza con un 500.

- [ ] **Step 7: `actualizar` invalida al vincular**

Reemplazar el bloque de `:192-201`:

```ts
    // El PIN emitido por el encargado muere en el instante en que el garzón
    // recibe una cuenta: desde acá la identidad la prueba el JWT, y el PIN que
    // el encargado conoce no puede seguir valiendo. Solo la transición
    // null → cuenta; desvincular NO toca el PIN (el garzón sigue operando con
    // el que eligió, que el encargado no conoce).
    let eventoPin: { tipo: TipoEventoPin; usuarioId: string } | null = null;
    if (dto.usuarioId !== undefined) {
      if (dto.usuarioId !== null) {
        await this.assertVinculable(tenantId, dto.usuarioId, id);
        if (garzon.usuarioId === null) {
          garzon.pinHash = PIN_INUTILIZABLE;
          eventoPin = {
            tipo: 'invalidado_por_vinculo',
            usuarioId: usuarioActorId,
          };
        }
      }
      garzon.usuarioId = dto.usuarioId;
    }
    return {
      ...this.toPublico(await this.guardarConEvento(garzon, eventoPin)),
      advertencias,
    };
```

y la firma pasa a `actualizar(tenantId, usuarioActorId, id, dto)`.

- [ ] **Step 8: El controller pasa quién actúa**

En `crear` y `actualizar`, cambiar `req.user as { tenantId: string }` por `req.user as JwtUser` y pasar `user.id` como segundo argumento — mismo patrón que ya usa `eliminar` (`garzones.controller.ts:74-75`).

- [ ] **Step 9: Correr los tests y verificar que pasan**

Run: `cd backend && npx jest src/modules/garzones/garzones.service.spec.ts`
Esperado: PASS, incluidos los tests viejos (los que llamaban `crear(TENANT, dto)` hay que actualizarlos a la firma nueva).

- [ ] **Step 10: Mutante — el revert**

Comentar la línea `garzon.pinHash = PIN_INUTILIZABLE;` del Step 7 (volver al comportamiento anterior: vincular no tocaba el PIN). Correr los tests: **debe fallar** `vincular una cuenta invalida el PIN y lo registra`. Descomentar y volver a correr en verde.

- [ ] **Step 11: Gate parcial y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```

```bash
git add backend/src/modules/garzones backend/src/app.module.ts
git commit -m "feat(garzones): darle una cuenta a alguien le mata el PIN que el encargado conoce"
```

---

### Task 3: El encargado invalida sin ver, y la ficha lee la historia

**Files:**
- Modify: `backend/src/modules/garzones/garzones.service.ts` (`regenerarPin`, `listarEventosPin` nuevo)
- Modify: `backend/src/modules/garzones/garzones.controller.ts`
- Test: `backend/src/modules/garzones/garzones.service.spec.ts`

**Interfaces:**
- Consumes: `guardarConEvento`, `PIN_INUTILIZABLE`, `TipoEventoPin` (Task 2).
- Produces:
  - `regenerarPin(tenantId: string, usuarioActorId: string, id: string): Promise<GarzonConPin>`
  - `listarEventosPin(tenantId: string, garzonId: string): Promise<EventoPinPublico[]>`
  - `interface EventoPinPublico { id: string; tipo: TipoEventoPin; usuarioNombre: string | null; creadoEl: Date }`
  - `GET /garzones/:id/pin-eventos` (`Salones:Leer`)

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe('regenerarPin se parte según el garzón', () => {
  const ACTOR = 'encargado-uuid';

  it('CON cuenta: invalida, no devuelve PIN, y lo registra', async () => {
    repo.findOne.mockResolvedValue(
      garzon({ id: 'g1', pin: '111111', usuarioId: 'cuenta-de-ana' }),
    );

    const res = await service.regenerarPin(TENANT, ACTOR, 'g1');

    expect(res.pin).toBeNull();
    const guardado = repo.manager.save.mock.calls[0][1] as { pinHash: string };
    expect(guardado.pinHash).toBe('!');
    expect(repo.manager.eventos).toEqual([
      expect.objectContaining({ tipo: 'invalidado_por_encargado', usuarioId: ACTOR }),
    ]);
  });

  it('SIN cuenta: genera y revela, como siempre', async () => {
    repo.findOne.mockResolvedValue(garzon({ id: 'g1', pin: '111111', usuarioId: null }));

    const res = await service.regenerarPin(TENANT, ACTOR, 'g1');

    expect(res.pin).toMatch(/^\d{6}$/);
    expect(repo.manager.eventos).toEqual([
      expect.objectContaining({ tipo: 'regenerado_por_encargado', usuarioId: ACTOR }),
    ]);
  });

  it('en turno CON cuenta, el aviso NO dice que no va a poder operar', async () => {
    repo.findOne.mockResolvedValue(
      garzon({ id: 'g1', nombre: 'Ana', pin: '111111', usuarioId: 'cuenta-de-ana' }),
    );
    sesionRepo.count.mockResolvedValue(1);

    const res = await service.regenerarPin(TENANT, ACTOR, 'g1');

    expect(res.advertencias).toHaveLength(1);
    expect(res.advertencias[0]).toContain('tótem');
    expect(res.advertencias[0]).not.toContain('marcar salida');
  });

  it('en turno SIN cuenta, el aviso sigue siendo el de siempre', async () => {
    repo.findOne.mockResolvedValue(
      garzon({ id: 'g1', nombre: 'Ana', pin: '111111', usuarioId: null }),
    );
    sesionRepo.count.mockResolvedValue(1);

    const res = await service.regenerarPin(TENANT, ACTOR, 'g1');

    expect(res.advertencias[0]).toContain('marcar salida');
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && npx jest src/modules/garzones/garzones.service.spec.ts -t "regenerarPin se parte"`
Esperado: FAIL — la firma tiene 2 argumentos y `pin` nunca es `null`.

- [ ] **Step 3: Implementar `regenerarPin`**

```ts
  /**
   * El PIN del garzón, según quién puede probarlo.
   *
   * **Con cuenta → invalida y no muestra nada.** El garzón fija el suyo desde
   * su perfil; devolverle un PIN legible al encargado sería volver al problema
   * que esta feature existe para resolver.
   * **Sin cuenta → genera y revela**, como siempre: sin cuenta no hay forma de
   * que la persona elija un secreto que el encargado no vea, y eso es una
   * elección del local, no un bug.
   *
   * Una sola ruta para los dos casos y no dos: manda el estado del garzón, así
   * que el encargado no puede elegir mal.
   *
   * Con sesión abierta **advierte, no bloquea** (decisión del owner,
   * 2026-08-07): rotar una credencial es la respuesta correcta a una filtración.
   */
  async regenerarPin(
    tenantId: string,
    usuarioActorId: string,
    id: string,
  ): Promise<GarzonConPin> {
    const garzon = await this.getOrThrow(tenantId, id);
    const tieneCuenta = garzon.usuarioId !== null;
    const advertencias: string[] = [];
    if ((await this.contarSesionesAbiertas(tenantId, id)) > 0) {
      advertencias.push(
        tieneCuenta
          ? `${garzon.nombre} está en turno, pero opera desde su cuenta: sigue trabajando ` +
              `normal. Lo único que pierde hasta fijar un PIN nuevo es el tótem compartido.`
          : `${garzon.nombre} está en turno: el PIN anterior deja de funcionar ya mismo, ` +
              `así que no va a poder operar ni marcar salida hasta que reciba el nuevo.`,
      );
    }

    const pin = tieneCuenta ? null : await this.generarPinUnico(tenantId, id);
    garzon.pinHash = pin
      ? await bcrypt.hash(pin, BCRYPT_COST)
      : PIN_INUTILIZABLE;
    const guardado = await this.guardarConEvento(garzon, {
      tipo: tieneCuenta ? 'invalidado_por_encargado' : 'regenerado_por_encargado',
      usuarioId: usuarioActorId,
    });
    return { ...this.toPublico(guardado), pin, advertencias };
  }
```

- [ ] **Step 4: El historial de la ficha, en una consulta**

```ts
/** Una línea de historia, lista para mostrar. Nunca incluye el PIN. */
export interface EventoPinPublico {
  id: string;
  tipo: TipoEventoPin;
  /** Quién lo hizo. `null` si la cuenta ya no existe — el hecho igual vale. */
  usuarioNombre: string | null;
  creadoEl: Date;
}
```

```ts
  /**
   * La historia de PIN de un garzón, más nueva primero.
   *
   * Una sola consulta con `JOIN` a `usuarios`: resolver el nombre del actor
   * fila por fila sería un N+1 exacto. El `JOIN` **no** filtra `eliminado_el`
   * de `usuarios` — misma excepción documentada que el autor de un borrado en
   * `listar()`: quién hizo algo es un hecho histórico y no desaparece porque
   * la cuenta se dé de baja.
   */
  async listarEventosPin(
    tenantId: string,
    garzonId: string,
  ): Promise<EventoPinPublico[]> {
    await this.getOrThrow(tenantId, garzonId);
    return this.garzonRepo.manager.query<EventoPinPublico[]>(
      `SELECT e.garzon_pin_evento_id AS id,
              e.tipo,
              u.nombre_usuario AS "usuarioNombre",
              e.creado_el AS "creadoEl"
         FROM garzon_pin_evento e
         LEFT JOIN usuarios u ON u.usuario_id = e.usuario_id
        WHERE e.tenant_id = $1
          AND e.garzon_id = $2
          AND e.eliminado_el IS NULL
        ORDER BY e.creado_el DESC`,
      [tenantId, garzonId],
    );
  }
```

- [ ] **Step 5: Las rutas**

En `garzones.controller.ts`, `regenerarPin` pasa `user.id`, y se suma:

```ts
  /**
   * La historia de PIN del garzón, para la ficha. `Salones:Leer` — el mismo
   * permiso con el que se lee el resto de la ficha.
   */
  @Get(':id/pin-eventos')
  @RequiresPermiso('Salones', 'Leer')
  listarEventosPin(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.garzonesService.listarEventosPin(user.tenantId!, id);
  }
```

⚠️ **Declarar `@Get(':id/pin-eventos')` ANTES de las rutas literales existentes no hace falta** —`mi-vinculo` y `para-selector` ya están declaradas después de las paramétricas y funcionan porque no chocan—, pero `mi-pin` de la Task 4 **sí** choca con `:id`. Ver la advertencia de esa task.

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `cd backend && npx jest src/modules/garzones/garzones.service.spec.ts`
Esperado: PASS.

- [ ] **Step 7: Mutante — el revert**

En `regenerarPin`, forzar `const tieneCuenta = false;` (el comportamiento anterior: siempre generaba y revelaba). Correr: **debe fallar** `CON cuenta: invalida, no devuelve PIN, y lo registra`. Revertir y correr en verde.

- [ ] **Step 8: Gate parcial y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```

```bash
git add backend/src/modules/garzones
git commit -m "feat(garzones): al que tiene cuenta se le invalida el PIN, no se le regala uno nuevo"
```

---

### Task 4: El garzón fija su propio PIN

**Files:**
- Create: `backend/src/modules/garzones/dto/fijar-pin.dto.ts`
- Modify: `backend/src/modules/garzones/garzones.service.ts`
- Modify: `backend/src/modules/garzones/garzones.controller.ts`
- Test: `backend/src/modules/garzones/garzones.service.spec.ts`

**Interfaces:**
- Consumes: `garzonPersonalDe`, `guardarConEvento`, `PIN_INUTILIZABLE`, `listarEventosPin`, `EventoPinPublico`.
- Produces:
  - `fijarMiPin(tenantId: string, usuarioId: string, dto: FijarPinDto): Promise<void>`
  - `miPin(tenantId: string, usuarioId: string): Promise<{ fijado: boolean; eventos: EventoPinPublico[] }>`
  - `PATCH /garzones/mi-pin`, `GET /garzones/mi-pin`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
describe('el garzón fija su propio PIN', () => {
  const CUENTA = 'cuenta-de-ana';
  const body = (pin: string) => ({ pin, confirmarPin: pin });

  beforeEach(() => {
    // `garzonPersonalDe` resuelve por SQL crudo: cuenta no-tótem con garzón vivo.
    repo.manager.query.mockResolvedValue([{ es_totem: false, garzon_id: 'g1' }]);
    repo.findOneOrFail.mockResolvedValue(
      garzon({ id: 'g1', usuarioId: CUENTA, pin: undefined }),
    );
  });

  it('guarda el hash del PIN elegido y lo registra a nombre del garzón', async () => {
    await service.fijarMiPin(TENANT, CUENTA, body('482915'));

    const guardado = repo.manager.save.mock.calls[0][1] as { pinHash: string };
    expect(await bcrypt.compare('482915', guardado.pinHash)).toBe(true);
    expect(repo.manager.eventos).toEqual([
      expect.objectContaining({ tipo: 'fijado_por_garzon', usuarioId: CUENTA }),
    ]);
  });

  it('rechaza si la confirmación no coincide', async () => {
    await expect(
      service.fijarMiPin(TENANT, CUENTA, { pin: '482915', confirmarPin: '482916' }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.manager.eventos).toHaveLength(0);
  });

  it.each(['000000', '111111', '999999', '123456', '654321', '456789'])(
    'rechaza el PIN obvio %s',
    async (pin) => {
      await expect(service.fijarMiPin(TENANT, CUENTA, body(pin))).rejects.toThrow(
        BadRequestException,
      );
    },
  );

  it('ACEPTA un PIN que ya usa otro garzón: la unicidad no aplica al elegido', async () => {
    // `pinYaUsado` recorre garzones vivos; si se consultara, encontraría match.
    repo.find.mockResolvedValue([garzon({ id: 'otro', pin: '482915' })]);

    await service.fijarMiPin(TENANT, CUENTA, body('482915'));

    expect(repo.manager.eventos).toHaveLength(1);
  });

  it('404 si la cuenta no es garzón en este tenant', async () => {
    repo.manager.query.mockResolvedValue([{ es_totem: false, garzon_id: null }]);

    await expect(service.fijarMiPin(TENANT, CUENTA, body('482915'))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('miPin dice que NO está fijado cuando el hash es el centinela', async () => {
    // `...rest` se esparce último en el helper `garzon()`, así que este
    // `pinHash` gana sobre el default.
    repo.findOneOrFail.mockResolvedValue(
      garzon({ id: 'g1', usuarioId: CUENTA, pinHash: '!' }),
    );
    repo.manager.query
      .mockResolvedValueOnce([{ es_totem: false, garzon_id: 'g1' }])
      .mockResolvedValueOnce([]);

    const res = await service.miPin(TENANT, CUENTA);

    expect(res.fijado).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && npx jest src/modules/garzones/garzones.service.spec.ts -t "el garzón fija su propio PIN"`
Esperado: FAIL — `service.fijarMiPin is not a function`.

- [ ] **Step 3: El DTO**

```ts
// backend/src/modules/garzones/dto/fijar-pin.dto.ts
import { Matches } from 'class-validator';

/**
 * El PIN que el garzón elige para sí mismo.
 *
 * **No pide el PIN anterior**, a diferencia de `UpdateContrasenaDto`. Es
 * deliberado: el caso principal de esta pantalla es el olvido, y exigir el
 * viejo la dejaría sin salida — que es exactamente el problema que se está
 * arreglando. La cuenta es el ancla: el JWT ya probó quién es, y el PIN es un
 * factor **menor** que la cuenta, no otro igual.
 *
 * La confirmación se valida en el service (no acá) porque `class-validator` no
 * compara dos campos entre sí sin un decorador propio, y el proyecto no tiene
 * ninguno — mismo criterio que `UpdateContrasenaDto`, que también deja la
 * comparación afuera.
 */
export class FijarPinDto {
  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  pin: string;

  @Matches(/^\d{6}$/, { message: 'El PIN debe tener exactamente 6 dígitos' })
  confirmarPin: string;
}
```

- [ ] **Step 4: El rechazo de PIN obvios**

En `garzones.service.ts`:

```ts
/**
 * Los PIN que no protegen nada: 6 dígitos repetidos y las escaleras de 6 en el
 * orden natural, para arriba y para abajo. Son 20 en total y son los primeros
 * que prueba cualquiera que quiera hacerse pasar por otro.
 *
 * Se derivan por regla y no por diccionario para que la lista no se desactualice
 * sola. Antes esto no hacía falta: el PIN lo sorteaba el sistema, así que nunca
 * salía `123456`.
 */
function esPinObvio(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  return '0123456789'.includes(pin) || '9876543210'.includes(pin);
}
```

- [ ] **Step 5: Implementar `fijarMiPin` y `miPin`**

```ts
  /**
   * El garzón elige su propio PIN. El encargado nunca lo ve — ese es el punto
   * entero de la feature.
   *
   * **No se valida unicidad contra otros garzones**, a diferencia del PIN que
   * genera el sistema. Siempre se elige a la persona antes de teclear
   * (`verificarPin` recibe `garzonId`), así que dos PIN iguales no crean
   * ambigüedad; y rechazar la colisión convertiría este formulario en un
   * oráculo: probando PIN, un garzón descubriría el de otro.
   *
   * Resuelve por `garzonPersonalDe`, que es la definición canónica de "esta
   * cuenta es este garzón" — incluye el override duro de `es_totem`. Una cuenta
   * de tótem no puede tener garzón, así que acá da 404, que es lo correcto.
   */
  async fijarMiPin(
    tenantId: string,
    usuarioId: string,
    dto: FijarPinDto,
  ): Promise<void> {
    if (dto.pin !== dto.confirmarPin) {
      throw new BadRequestException('Los PIN no coinciden');
    }
    if (esPinObvio(dto.pin)) {
      throw new BadRequestException(
        'Ese PIN es demasiado previsible. Elegí uno que no sea todo el mismo ' +
          'dígito ni una secuencia.',
      );
    }
    const garzon = await this.miGarzonOrThrow(tenantId, usuarioId);
    garzon.pinHash = await bcrypt.hash(dto.pin, BCRYPT_COST);
    await this.guardarConEvento(garzon, {
      tipo: 'fijado_por_garzon',
      usuarioId,
    });
  }

  /** Su propio estado e historia, para el bloque "Mi PIN" del perfil. */
  async miPin(
    tenantId: string,
    usuarioId: string,
  ): Promise<{ fijado: boolean; eventos: EventoPinPublico[] }> {
    const garzon = await this.miGarzonOrThrow(tenantId, usuarioId);
    return {
      fijado: garzon.pinHash !== PIN_INUTILIZABLE,
      eventos: await this.listarEventosPin(tenantId, garzon.id),
    };
  }

  /** El garzón que es esta cuenta en este tenant, o 404. */
  private async miGarzonOrThrow(
    tenantId: string,
    usuarioId: string,
  ): Promise<Garzon> {
    const garzonId = await this.garzonPersonalDe(tenantId, usuarioId);
    if (!garzonId) {
      throw new NotFoundException('Tu cuenta no es un garzón en este local');
    }
    return this.garzonRepo.findOneOrFail({ where: { id: garzonId, tenantId } });
  }
```

- [ ] **Step 6: Las rutas — con la advertencia de orden**

```ts
  /**
   * El garzón fija su propio PIN. **Sin `@RequiresPermiso`**: `PermisosGuard`
   * es `return true` sin el decorador (`permisos.guard.ts:24`), así que quedan
   * `JwtAuthGuard` + `TenantGuard`, que es exactamente lo que hace falta — un
   * garzón puede no tener ningún permiso de módulo.
   *
   * Vive acá y no en `MeController` porque ese controller **no tiene
   * `TenantGuard`**, y un garzón es por tenant: la misma persona puede ser
   * garzón en dos locales con PIN distintos.
   */
  @Patch('mi-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  fijarMiPin(@Req() req: Request, @Body() dto: FijarPinDto) {
    const user = req.user as JwtUser;
    return this.garzonesService.fijarMiPin(user.tenantId!, user.id, dto);
  }

  /** Su propio estado e historia de PIN. Mismo criterio de guards que el PATCH. */
  @Get('mi-pin')
  miPin(@Req() req: Request) {
    const user = req.user as JwtUser;
    return this.garzonesService.miPin(user.tenantId!, user.id);
  }
```

⚠️ **`@Patch('mi-pin')` tiene que declararse ANTES de `@Patch(':id')`.** Nest resuelve por orden de declaración: si `:id` va primero, `PATCH /garzones/mi-pin` entra por `actualizar` con `id = 'mi-pin'` y muere en un 404 confuso. Lo mismo para `@Get('mi-pin')` respecto de cualquier `@Get(':id')` futuro. Poner las dos rutas de `mi-pin` **arriba de todo**, justo después del constructor.

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `cd backend && npx jest src/modules/garzones/garzones.service.spec.ts`
Esperado: PASS.

- [ ] **Step 8: Verificar el orden de rutas a mano**

```bash
docker-compose restart backend && sleep 25 && docker logs tecnica_backend 2>&1 | grep -i "garzones" | tail -12
```

Esperado: en el mapeo de rutas, `{/garzones/mi-pin, PATCH}` aparece **antes** que `{/garzones/:id, PATCH}`.

- [ ] **Step 9: Mutante — el revert**

Cambiar `if (esPinObvio(dto.pin))` por `if (false)` (el comportamiento anterior: el sistema sorteaba el PIN, nada lo validaba). Correr: **deben fallar** los seis casos de `rechaza el PIN obvio`. Revertir y correr en verde.

- [ ] **Step 10: Gate parcial y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```

```bash
git add backend/src/modules/garzones
git commit -m "feat(garzones): el PIN lo teclea el garzón, y el encargado no lo ve"
```

---

### Task 5: El ciclo completo contra la API real

**Files:**
- Create: `backend/test/garzon-pin.e2e-spec.ts`
- Modify: `backend/src/modules/seeder/seeder.service.ts` (un garzón con cuenta propia para el e2e)

**Interfaces:**
- Consumes: las cuatro rutas de las Tasks 3 y 4.

- [ ] **Step 1: Sembrar un garzón con cuenta propia, exclusivo de este spec**

⚠️ **No usar a Ana, Bruno ni Carla.** La sesión de garzón es única y seis specs las comparten; un e2e nuevo que las tome rompe a los otros de forma difusa. Crear en `seeder.service.ts` una cuenta `garzon.pin@paris.cl` (contraseña `admin`) y un garzón `PIN Fixture` vinculado a ella, con IDs fijos siguiendo el patrón `550e8400-e29b-41d4-a716-446655440XXX` — usar los dos números libres siguientes al último asignado (verificar con `grep -o '44665544[0-9]\{4\}' src/modules/seeder/seeder.service.ts | sort -u | tail -3`).

Como está vinculado, su `pinHash` va `'!'`: nace sin PIN usable, igual que en producción.

- [ ] **Step 2: Escribir el e2e**

```ts
// backend/test/garzon-pin.e2e-spec.ts
/**
 * El ciclo entero del PIN propio, contra la API real. Lo que ningún unit ve:
 * que las rutas `mi-pin` no las coma `:id`, que la tabla de eventos exista de
 * verdad, y que el aislamiento entre garzones lo sostenga el backend.
 */
describe('PIN propio del garzón (e2e)', () => {
  let app: INestApplication;
  let tokenAdmin: string;   // admin.paris@paris.cl
  let tokenGarzon: string;  // garzon.pin@paris.cl
  let garzonId: string;     // el garzón vinculado a esa cuenta

  it('el alta con cuenta no devuelve PIN', async () => {
    const res = await request(app.getHttpServer())
      .post('/garzones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Nuevo Con Cuenta', usuarioId: CUENTA_LIBRE })
      .expect(201);

    expect(res.body.pin).toBeNull();
  });

  it('antes de fijarlo, mi-pin dice que no está fijado', async () => {
    const res = await request(app.getHttpServer())
      .get('/garzones/mi-pin')
      .set('Authorization', `Bearer ${tokenGarzon}`)
      .expect(200);

    expect(res.body.fijado).toBe(false);
    expect(res.body.eventos).toEqual([]);
  });

  it('el garzón fija su PIN y con eso entra por el tótem', async () => {
    await request(app.getHttpServer())
      .patch('/garzones/mi-pin')
      .set('Authorization', `Bearer ${tokenGarzon}`)
      .send({ pin: '481502', confirmarPin: '481502' })
      .expect(204);

    // `verificarPin` es el oráculo del tótem: prueba que el PIN sirve de verdad.
    await request(app.getHttpServer())
      .post('/garzones/verificar-pin')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonId, pin: '481502' })
      .expect(200);
  });

  it('el encargado lo invalida sin ver ningún PIN, y el viejo deja de servir', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/garzones/${garzonId}/pin`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(res.body.pin).toBeNull();

    await request(app.getHttpServer())
      .post('/garzones/verificar-pin')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonId, pin: '481502' })
      .expect(400);
  });

  it('la historia quedó completa, en orden y con nombre del actor', async () => {
    const res = await request(app.getHttpServer())
      .get(`/garzones/${garzonId}/pin-eventos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(res.body.map((e: { tipo: string }) => e.tipo)).toEqual([
      'invalidado_por_encargado',
      'fijado_por_garzon',
    ]);
    expect(res.body[0].usuarioNombre).toBeTruthy();
  });

  it('un garzón NO puede fijarle el PIN a otro: la ruta no recibe a quién', async () => {
    // No hay forma de apuntar a otro garzón; lo único que se puede intentar es
    // llamar con una cuenta que no es garzón, y eso es 404.
    await request(app.getHttpServer())
      .patch('/garzones/mi-pin')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ pin: '481503', confirmarPin: '481503' })
      .expect(404);
  });

  it('rechaza un PIN obvio', async () => {
    await request(app.getHttpServer())
      .patch('/garzones/mi-pin')
      .set('Authorization', `Bearer ${tokenGarzon}`)
      .send({ pin: '123456', confirmarPin: '123456' })
      .expect(400);
  });
});
```

Completar el `beforeAll` (login de las dos cuentas, resolver `garzonId` desde `GET /garzones/mi-vinculo` con el token del garzón) y el `afterAll` siguiendo el patrón de `test/caja-testigo.e2e-spec.ts`: **la limpieza acumula fallos en un array y `app.close()` va en el `finally`, con el `expect` después**. Si el `expect` va antes del `close`, un fallo de limpieza deja la app viva y la suite cuelga sin output.

- [ ] **Step 3: Correr el e2e**

```bash
./scripts/reset-db.sh
cd backend && npm run test:e2e -- garzon-pin
```

Esperado: PASS. **No tocar ningún `.ts` del backend mientras corre.**

- [ ] **Step 4: Mutante — el revert del orden de rutas**

Mover `@Patch('mi-pin')` debajo de `@Patch(':id')` (el orden que tendría quien no conociera la trampa). Reiniciar el backend, esperar, y correr el spec: **debe fallar** con 404/400 en el que fija el PIN. Verificar por timestamp que el backend efectivamente reinició antes de sacar conclusiones:

```bash
docker logs tecnica_backend 2>&1 | grep -i "Nest application successfully started" | tail -1
```

Revertir y volver a verde.

- [ ] **Step 5: Commit**

```bash
git add backend/test/garzon-pin.e2e-spec.ts backend/src/modules/seeder/seeder.service.ts
git commit -m "test(garzones): el ciclo del PIN propio, de punta a punta"
```

---

### Task 6: El bloque "Mi PIN" en el perfil

**Files:**
- Modify: `frontend/app/composables/useGarzones.ts`
- Create: `frontend/app/components/garzones/PinEventosLista.vue`
- Create: `frontend/app/components/configuracion/MiPinForm.vue`
- Modify: `frontend/app/pages/configuracion/perfil.vue`
- Test: `frontend/app/components/configuracion/MiPinForm.nuxt.spec.ts`

**Interfaces:**
- Consumes: `PATCH /garzones/mi-pin`, `GET /garzones/mi-pin`, `GET /garzones/:id/pin-eventos`.
- Produces: `EventoPin`, `MiPinEstado`, `fijarMiPin()`, `miPin()`, `listarEventosPin()`, `<GarzonesPinEventosLista :eventos="…" />`.

- [ ] **Step 1: Los tipos y las llamadas en el composable**

```ts
export type TipoEventoPin =
  | 'emitido_en_alta'
  | 'regenerado_por_encargado'
  | 'invalidado_por_encargado'
  | 'invalidado_por_vinculo'
  | 'fijado_por_garzon'

export interface EventoPin {
  id: string
  tipo: TipoEventoPin
  usuarioNombre: string | null
  creadoEl: string
}

export interface MiPinEstado {
  fijado: boolean
  eventos: EventoPin[]
}
```

```ts
  /** Mi propio estado e historia de PIN. 404 si esta cuenta no es garzón acá. */
  const miPin = () => useApiFetch<MiPinEstado>(`${apiUrl}/garzones/mi-pin`)

  /** Fijo mi PIN. No pide el anterior: la cuenta es el ancla. */
  const fijarMiPin = (pin: string, confirmarPin: string) =>
    useApiFetch<void>(`${apiUrl}/garzones/mi-pin`, {
      method: 'PATCH',
      body: { pin, confirmarPin },
    })

  /** La historia de PIN de un garzón, para la ficha. */
  const listarEventosPin = (id: string) =>
    useApiFetch<EventoPin[]>(`${apiUrl}/garzones/${id}/pin-eventos`)
```

Y `GarzonConPin.pin` pasa a `string | null` para seguir al backend.

Agregar los tres al `return` del composable.

- [ ] **Step 2: El componente del historial (lo comparten perfil y ficha)**

```vue
<!-- frontend/app/components/garzones/PinEventosLista.vue -->
<script setup lang="ts">
import type { EventoPin, TipoEventoPin } from '~/composables/useGarzones'

const props = defineProps<{ eventos: EventoPin[] }>()

const { formatFecha } = useFormatters()

/**
 * El texto de cada tipo. Los dos de invalidación dicen cosas distintas a
 * propósito: uno es "te di una cuenta", el otro es "te corté el PIN".
 */
const TEXTO: Record<TipoEventoPin, (quien: string) => string> = {
  emitido_en_alta: quien => `${quien} emitió el PIN al dar de alta`,
  regenerado_por_encargado: quien => `${quien} generó un PIN nuevo`,
  invalidado_por_encargado: quien => `${quien} invalidó el PIN`,
  invalidado_por_vinculo: quien => `El PIN quedó sin efecto al vincular la cuenta (${quien})`,
  fijado_por_garzon: () => 'Puso su PIN',
}

function texto(e: EventoPin): string {
  return TEXTO[e.tipo](e.usuarioNombre ?? 'Una cuenta dada de baja')
}
</script>

<template>
  <p v-if="props.eventos.length === 0" class="text-sm text-muted">
    Todavía no hubo cambios de PIN.
  </p>
  <ul v-else class="divide-y divide-default">
    <li
      v-for="e in props.eventos"
      :key="e.id"
      class="flex items-center justify-between gap-3 py-2 text-sm"
    >
      <span class="text-default">{{ texto(e) }}</span>
      <span class="shrink-0 text-xs text-muted">{{ formatFecha(e.creadoEl) }}</span>
    </li>
  </ul>
</template>
```

- [ ] **Step 3: El formulario del perfil**

```vue
<!-- frontend/app/components/configuracion/MiPinForm.vue -->
<script setup lang="ts">
import type { MiPinEstado } from '~/composables/useGarzones'

const garzonesApi = useGarzones()
const toast = useToast()

/**
 * `null` = esta cuenta no es garzón en el local activo (el backend responde
 * 404). En ese caso el bloque entero no se renderiza: "Mi PIN" no significa
 * nada para quien no atiende.
 */
const estado = ref<MiPinEstado | null>(null)
const cargando = ref(true)
const guardando = ref(false)
const form = reactive({ pin: '', confirmarPin: '' })

async function cargar() {
  cargando.value = true
  try {
    estado.value = await garzonesApi.miPin()
  }
  catch {
    estado.value = null
  }
  finally {
    cargando.value = false
  }
}

async function guardar() {
  guardando.value = true
  try {
    await garzonesApi.fijarMiPin(form.pin, form.confirmarPin)
    toast.add({ title: 'PIN actualizado', color: 'success' })
    form.pin = ''
    form.confirmarPin = ''
    await cargar()
  }
  catch (e: unknown) {
    toast.add({ title: apiErrorMsg(e, 'No se pudo guardar el PIN'), color: 'error' })
  }
  finally {
    guardando.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <AppCard v-if="!cargando && estado">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-key-round" class="w-5 h-5" />
        <span class="font-semibold">Mi PIN</span>
      </div>
    </template>

    <UAlert
      v-if="!estado.fijado"
      color="warning"
      variant="subtle"
      icon="i-lucide-info"
      title="Todavía no tenés PIN"
      description="Sin PIN no podés operar desde un dispositivo compartido. Desde el tuyo trabajás normal."
      class="mb-4"
    />

    <UForm :state="form" class="space-y-4" @submit="guardar">
      <UFormField label="PIN nuevo" required>
        <UInput v-model="form.pin" type="password" inputmode="numeric" maxlength="6" placeholder="6 dígitos" />
      </UFormField>

      <UFormField label="Repetir PIN" required>
        <UInput v-model="form.confirmarPin" type="password" inputmode="numeric" maxlength="6" placeholder="Repetilo" />
      </UFormField>

      <UButton type="submit" :loading="guardando">
        Guardar PIN
      </UButton>
    </UForm>

    <div class="mt-6">
      <p class="mb-2 text-sm font-medium text-default">Historial</p>
      <GarzonesPinEventosLista :eventos="estado.eventos" />
    </div>
  </AppCard>
</template>
```

Y en `perfil.vue`, sumar `<ConfiguracionMiPinForm />` después de `<ConfiguracionContrasenaForm />`.

- [ ] **Step 4: El test de render**

```ts
// frontend/app/components/configuracion/MiPinForm.nuxt.spec.ts
// Seguir el harness de los otros `.nuxt.spec.ts` del repo (mount + mock de useApiFetch).
it('no renderiza nada si la cuenta no es garzón', async () => {
  // miPin() rechaza (404)
  const wrapper = await montar({ falla: true })
  expect(wrapper.text()).not.toContain('Mi PIN')
})

it('avisa cuando todavía no hay PIN fijado', async () => {
  const wrapper = await montar({ estado: { fijado: false, eventos: [] } })
  expect(wrapper.text()).toContain('Todavía no tenés PIN')
})

it('no avisa cuando ya está fijado', async () => {
  const wrapper = await montar({ estado: { fijado: true, eventos: [] } })
  expect(wrapper.text()).not.toContain('Todavía no tenés PIN')
})
```

- [ ] **Step 5: Correr y commitear**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

```bash
git add frontend/app/composables/useGarzones.ts frontend/app/components/garzones frontend/app/components/configuracion frontend/app/pages/configuracion/perfil.vue
git commit -m "feat(garzones): el garzón se pone su PIN desde su perfil"
```

---

### Task 7: La ficha del encargado

**Files:**
- Modify: `frontend/app/pages/configuracion/garzones.vue`

**Interfaces:**
- Consumes: `listarEventosPin()`, `GarzonConPin.pin: string | null`, `<GarzonesPinEventosLista />`.

- [ ] **Step 1: El botón cambia de nombre según el garzón**

El botón de `:428-435` pasa a decidirse por `usuarioId`. Un solo botón y no dos: manda el estado del garzón, así que el encargado no puede elegir mal.

```ts
/** Con cuenta el encargado invalida y no ve nada; sin cuenta genera y revela. */
function esInvalidar(garzon: Garzon): boolean {
  return garzon.usuarioId !== null
}
```

En el template, `:title` y `:aria-label` pasan a
`esInvalidar(garzon) ? 'Invalidar PIN' : 'Generar PIN nuevo'`.

- [ ] **Step 2: El modal de confirmación dice lo que va a pasar**

En el modal de `confirmarRegenerar`, el texto se parte:

- Invalidar: *"El PIN de {nombre} deja de servir ahora. No vas a ver ningún número: {nombre} pone el suyo desde su cuenta. Puede seguir trabajando desde su dispositivo; lo único que pierde hasta entonces es el tótem compartido."*
- Generar: el texto actual, sin cambios.

- [ ] **Step 3: La respuesta sin PIN no abre el modal de revelado**

```ts
    const res = await garzonesApi.regenerarPin(regenerarTarget.value.id)
    regenerarOpen.value = false
    // `pin: null` = se invalidó y no hay nada que mostrar. Abrir el modal de
    // revelado con un hueco donde va el número sería peor que no abrirlo.
    if (res.pin !== null) {
      revelarPin(res.nombre, res.pin, res.advertencias)
    }
    else {
      toast.add({ title: `PIN de ${res.nombre} invalidado`, color: 'success' })
      res.advertencias.forEach(a => toast.add({ title: a, color: 'warning' }))
    }
    await recargar()
```

- [ ] **Step 4: La ficha muestra si ya puso su PIN, y su historial**

En el detalle/edición del garzón, para los que tienen `usuarioId`, un `UBadge` con el estado y el historial:

```vue
<UBadge :color="pinFijado ? 'success' : 'warning'" variant="subtle">
  {{ pinFijado ? 'PIN puesto' : 'Sin PIN todavía' }}
</UBadge>
<GarzonesPinEventosLista :eventos="eventosPin" />
```

`eventosPin` se carga con `listarEventosPin(id)` al abrir la ficha, y `pinFijado` se deriva de que el evento más reciente sea `fijado_por_garzon`. **Sin ese dato, invalidar sería a ciegas.**

- [ ] **Step 5: Correr y commitear**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

```bash
git add frontend/app/pages/configuracion/garzones.vue
git commit -m "feat(garzones): el encargado invalida sin ver, y la ficha cuenta la historia"
```

---

### Task 8: El aviso en la pantalla del salón

**Files:**
- Modify: `frontend/app/pages/salones/index.vue`

**Interfaces:**
- Consumes: `miPin()` (Task 6).

- [ ] **Step 1: Cargar el estado en modo personal**

En el `Promise.all` de carga inicial, sumar la llamada **con `.catch(() => null)`**:

```ts
  // `.catch` obligatorio: un 404 (esta cuenta no es garzón) es normal acá y no
  // debe voltear el resto de la carga. Es el mismo bug que hizo que la pantalla
  // del garzón nunca apareciera en la feature del testigo.
  garzonesApi.miPin().catch(() => null),
```

- [ ] **Step 2: El aviso**

La **condición** es el estado, no una comparación de fechas entre eventos:

```ts
/** Sin PIN usable no puede operar desde el tótem. El texto sale del último
 *  evento de invalidación; la condición, del estado. Separarlo evita que el
 *  aviso dependa de ordenar eventos. */
const avisoPin = computed(() => {
  if (!modoPersonal.value || !miPinEstado.value || miPinEstado.value.fijado) return null
  const ultima = miPinEstado.value.eventos.find(
    e => e.tipo === 'invalidado_por_encargado' || e.tipo === 'invalidado_por_vinculo',
  )
  return ultima
    ? `${ultima.usuarioNombre ?? 'El encargado'} invalidó tu PIN el ${formatFecha(ultima.creadoEl)}. Poné uno nuevo desde tu perfil.`
    : 'Todavía no tenés PIN. Ponelo desde tu perfil para poder usar el tótem.'
})
```

Y arriba de la grilla de mesas, un `UAlert color="warning"` con `v-if="avisoPin"` y un `UButton` a `/configuracion/perfil`.

- [ ] **Step 3: Correr y commitear**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

```bash
git add frontend/app/pages/salones/index.vue
git commit -m "feat(salones): el garzón se entera de que le tocaron el PIN donde sí mira"
```

---

### Task 9: Documentación, gate completo y smoke

**Files:**
- Modify: `docs/features/garzones.md`, `docs/features/gestion-cajas.md`, `docs/DIFERENCIADORES.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/resueltos.md`

- [ ] **Step 1: `docs/features/garzones.md`**

Sección nueva **"El ciclo de vida del PIN"**: las dos mitades (con cuenta / sin cuenta), el principio *la fuerza del registro escala con si la persona tiene cuenta*, la tabla de los cinco eventos, por qué el PIN elegido no valida unicidad (el oráculo) y por qué fijar el propio no pide el anterior (el olvido es el caso principal).

- [ ] **Step 2: `docs/features/gestion-cajas.md` y `docs/DIFERENCIADORES.md` — la corrección**

⚠️ Lo importante de esta task. Dejar escrito, con estas palabras:

> La vía `'pin'` del testigo **no cambia de fuerza** con el PIN propio. Quien tiene cuenta ya firma por la vía `'cuenta'`; la vía `'pin'` la usan por construcción los garzones **sin** cuenta, a quienes el encargado les sigue emitiendo el PIN. Ninguna firma ya guardada cambia de significado.

Y en `DIFERENCIADORES.md`, la advertencia de no comunicar *"nadie puede firmar por otro"* **queda tal cual**, con una línea que explique por qué el PIN propio no la levanta.

- [ ] **Step 3: `ESTADO.md`, `pendientes.md`, `resueltos.md`**

Fila de la feature en `ESTADO.md`. Cerrar la entrada 🔴 de `pendientes.md` moviéndola a `resueltos.md` **con la corrección de su propio encuadre**: la entrada afirmaba que esto convertía la vía PIN del testigo en prueba real, y no es así — lo que gana es el tótem compartido, que alcanza mesas, comandas, turnos y propinas.

- [ ] **Step 4: Resetear la base ANTES de verificar**

```bash
./scripts/reset-db.sh
```

- [ ] **Step 5: Gate completo — entero, no un subset**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
```

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

⚠️ Correr el `test:e2e` **completo**. Un campo de DTO hecho requerido en un endpoint compartido rompió 6 specs y el subset local no lo vio. Y no usar `| tail`: descarta el exit code y el `&&` siguiente corre igual, reportando un verde falso.

```bash
./scripts/reset-db.sh --verificar
```

- [ ] **Step 6: Smoke a mano en el Chrome del owner**

Vía chrome-devtools MCP, en la ventana real: crear un garzón con cuenta (verificar que **no** aparece ningún PIN) → entrar con esa cuenta → ver el aviso en el salón → poner el PIN desde el perfil → verificar que el aviso desaparece → usarlo en el tótem → invalidarlo desde la ficha del encargado (verificar que no se muestra ningún número) → ver las dos líneas del historial en las dos pantallas.

- [ ] **Step 7: Revisión independiente y commit**

Despachar `domain-reviewer` (opus) sobre el diff completo. Después:

```bash
git add -A && git diff --cached | git hash-object --stdin > .git/verify-feature.receipt
git commit -m "docs(garzones): el PIN propio, y por qué no arregla la firma por PIN del testigo"
git push origin main
```

Revisar el deployment de Railway además del CI: el push toca entidades.

---

## Self-Review

**Cobertura de la spec:** §1 disparador → Task 2. §2 unicidad → Task 4 Step 1 (test que acepta la colisión). §3 PIN obvios → Task 4. §4 API → Tasks 3 y 4 (las cuatro rutas). §5 historial → Tasks 1, 3, 4. §6 frontend → Tasks 6, 7, 8. Casos borde → Tasks 2 (desvincular, renombrar), 3 (aviso en turno), 4 (tótem vía `garzonPersonalDe`, dos tenants vía `TenantGuard`), 5 (aislamiento). Testing → Tasks 2-8. Docs → Task 9.

**Consistencia de tipos:** `pin: string | null` se define en Task 2 y lo consumen Tasks 3, 6, 7. `TipoEventoPin` se define en Task 1 y lo repiten Tasks 6 (frontend) y 9. `guardarConEvento` se define en Task 2 y lo usan 3 y 4. `EventoPinPublico` (backend) ↔ `EventoPin` (frontend) tienen los mismos cuatro campos, con `creadoEl` como `Date` en el backend y `string` en el frontend, que es como viaja el JSON.

**Riesgo con nombre:** el choque de rutas `mi-pin` vs `:id` (Task 4 Step 6). Es el único punto donde el código compila, los unit tests pasan y la feature no funciona. Por eso tiene verificación propia en el log del backend (Step 8) y un mutante en el e2e (Task 5 Step 4).
