# Contexto transaccional con ALS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar por construcción el deadlock del pool de conexiones: toda query dentro de una transacción resuelve el `EntityManager` de esa transacción vía `AsyncLocalStorage`, sin enhebrado manual.

**Architecture:** Un `TxContext` (ALS) + fachada `Db` en `src/common/db/`; los repos se proveen bajo el mismo token de `@InjectRepository` como proxies que resuelven el manager del contexto. Los 21 sitios del deadlock se arreglan sin editarlos; el barrido mecánico convierte `dataSource.transaction/query` a la fachada.

**Tech Stack:** NestJS 11, TypeORM 1.0, `node:async_hooks` (built-in, **sin dependencias nuevas**), pg.

**Spec:** [`docs/superpowers/specs/2026-08-18-contexto-transaccional-als-design.md`](../specs/2026-08-18-contexto-transaccional-als-design.md)

## Global Constraints

- **Sin dependencias nuevas.** ALS es `node:async_hooks`.
- **El seeder NO se toca** (`seeder.service.ts`: corre al boot, sin concurrencia).
- **Las firmas existentes con `manager` explícito QUEDAN** — son correctas; el explícito gana donde ya está.
- **No tocar los ➕ de orden de locks** de la entrada del backlog (piezas siguientes de la tanda): nada de `FOR UPDATE`, nada de `aplicarDesfases`/`descartarDesfases`.
- ⚠️ **No editar ningún `.ts` del backend mientras corre un e2e** (el compose bind-montea y re-siembra; ver CLAUDE.md).
- `./scripts/reset-db.sh` **antes** de cada `test:e2e`; `--verificar` después si algo falla raro.
- Comprobar **exit codes**, nunca la última línea de un pipe (`| tail` se traga el status).
- Commits intermedios que toquen services: `git commit --no-verify` (el recibo de la revisión independiente que exige el pre-commit se genera al final, Task 10, sobre el diff completo de la tanda). Base del diff: `d49a55f2`.
- Todos los comandos corren desde `backend/` salvo que se indique otra cosa.

---

### Task 1: Pool explícito + timeout de conexión

**Files:**
- Modify: `backend/src/app.module.ts` (bloque `TypeOrmModule.forRootAsync`, líneas ~153-265; `synchronize` está al final del objeto de config)
- Modify: `.env.example` (raíz del repo)

**Interfaces:**
- Produces: pool de tamaño `DB_POOL_SIZE` (default **10**) y `connectTimeoutMS: 5000`. La Task 2 asume estos valores: ráfaga de 10 y fallo ruidoso a los ~5 s.

**Evidencia (no re-verificar):** `node_modules/typeorm/driver/postgres/PostgresDriver.js:1370-1381` mapea `poolSize` → `max` y `connectTimeoutMS` → `connectionTimeoutMillis` del Pool de `pg`, con `options.extra` spread al final. Son opciones de primera clase; no hace falta `extra`.

- [ ] **Step 1: Configurar el pool en `app.module.ts`**

En el objeto que devuelve `useFactory`, junto a `url`:

```ts
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        // Pool explícito: el default mudo de pg (10) es exactamente lo que el
        // deadlock de conexiones explotaba sin que nadie supiera el número.
        poolSize: Number(config.get<string>('DB_POOL_SIZE') ?? 10),
        // Defensa en profundidad, NO el fix: si algún día algo vuelve a pedir
        // una segunda conexión dentro de una transacción, esto lo convierte en
        // un 500 ruidoso con stack trace en vez de una API muerta hasta
        // reiniciar (pendientes.md, entrada del deadlock).
        connectTimeoutMS: 5000,
```

- [ ] **Step 2: Documentar la variable en `.env.example`**

Agregar junto a `DATABASE_URL`:

```bash
# Tamaño del pool de conexiones de Postgres (default 10)
DB_POOL_SIZE=10
```

- [ ] **Step 3: Verificar que el backend arranca**

```bash
cd .. && docker-compose up -d && sleep 25 && docker-compose logs backend | grep -c "Seed complete"
```

Expected: `1` (o más si ya venía corriendo — lo que importa es que el último arranque no tiene errores: `docker-compose logs --tail 30 backend` sin stack traces).

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.module.ts .env.example
git commit --no-verify -m "feat(db): pool explícito y timeout de conexión — el deadlock futuro falla ruidoso"
```

---

### Task 2: Test e2e de ráfaga — RED (demuestra el bug)

**Files:**
- Create: `backend/test/concurrencia-pool.e2e-spec.ts`

**Interfaces:**
- Consumes: pool = 10 y `connectTimeoutMS` de Task 1.
- Produces: el detector que las Tasks 5 y 7 usan como criterio GREEN/mutante.

**Contexto para quien no vio el bug:** cada `POST /ventas` abre una transacción (1 conexión) y adentro llama services que toman una **segunda** conexión del pool. 10 ventas simultáneas → 10 conexiones tomadas, 10 esperando una segunda que no existe → deadlock. Medido 2026-08-11: 9 ok / 10 cuelga. Con el timeout de Task 1, en vez de colgar, fallan con error de conexión a los ~5 s — el test da ROJO legible.

**Patrones obligatorios** (los tres vienen de fallos ya pagados, ver `test/rbac-y-contrasena.e2e-spec.ts:330` y memoria del proyecto):
1. Armado **en serie**, ráfaga por **HTTP real contra un puerto** (supertest levanta un listener por request; 10 a la vez revientan con `ECONNRESET` antes de que el pool importe).
2. Ítem **propio tipo `'servicio'`** — sin stock, así las corridas locales repetidas no agotan nada (contaminación acumulativa conocida del seed).
3. Canal `'online'` — usa la caja virtual del tenant, sin depender de una caja abierta (patrón de `test/papelera.e2e-spec.ts:880`).

- [ ] **Step 1: Escribir el spec**

```ts
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { Server, AddressInfo } from 'net';
import { AppModule } from '../src/app.module';

// Seed (IDs fijos, ver seeder.service.ts)
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// = poolSize default de app.module.ts (DB_POOL_SIZE). El umbral medido del
// deadlock era exactamente N = tamaño del pool: 9 ok / 10 cuelga.
const RAFAGA = 10;

describe('Concurrencia: el pool de conexiones no se deadlockea (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let itemId: string;
  let port: number;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.use(cookieParser());
    await app.init();

    // Login en DOS pasos: el token de `/auth/login` de un usuario multi-tenant
    // sale con `tenant_id: null` y PermisosGuard lo rechaza con 403. El tenant
    // activo se fija con `switch-tenant`, que además exige la cookie de refresh
    // (mismo patrón que rbac-y-contrasena.e2e-spec.ts:47 y papelera:63).
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
    expect(resLogin.status).toBe(200);

    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (resLogin.headers['set-cookie'] as unknown as string[]) ?? [])
      .set('Authorization', `Bearer ${(resLogin.body as { access_token: string }).access_token}`)
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as { access_token: string }).access_token;

    // Ítem propio, tipo servicio: sin stock → sin contaminación acumulativa
    // entre corridas locales, y sin locks de inventario que ensucien la medición.
    const item = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `E2E Ráfaga Pool ${Date.now()}`,
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      });
    expect(item.status).toBe(201);
    itemId = (item.body as { id: string }).id;

    // La ráfaga va por HTTP real: supertest levanta un listener efímero por
    // request y N simultáneas lo tumban con ECONNRESET — fallaría siempre,
    // por la razón equivocada (ver rbac-y-contrasena.e2e-spec.ts:330).
    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      await new Promise<void>((resolve) => server.listen(0, resolve));
    }
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    // Acumular fallos de limpieza y afirmar DESPUÉS de app.close(): un expect
    // que tira antes de cerrar deja el pool abierto y jest no termina nunca
    // (medido: 7 min colgado; patrón de caja-testigo.e2e-spec.ts).
    const fallos: string[] = [];
    try {
      if (itemId) {
        const res = await request(app.getHttpServer())
          .delete(`/api/items/${itemId}`)
          .set('Authorization', `Bearer ${token}`);
        if (res.status !== 200) fallos.push(`DELETE item: ${res.status}`);
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  it(`${RAFAGA} ventas simultáneas (= tamaño del pool) responden todas y el backend sigue vivo`, async () => {
    const respuestas = await Promise.all(
      Array.from({ length: RAFAGA }, () =>
        fetch(`http://127.0.0.1:${port}/api/ventas`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            canal: 'online', // caja virtual: sin depender de una caja abierta
            lineas: [{ itemId, cantidad: '1' }],
            pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
          }),
        }),
      ),
    );

    expect(respuestas.map((r) => r.status)).toEqual(
      Array.from({ length: RAFAGA }, () => 201),
    );

    // Y el proceso no quedó envenenado: la request siguiente también responde.
    const despues = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    expect(despues.status).toBe(200);
  }, 60_000);
});
```

- [ ] **Step 2: Correr SOLO este spec y verificar que falla POR LA RAZÓN CORRECTA**

```bash
cd .. && ./scripts/reset-db.sh && cd backend
npm run test:e2e -- concurrencia-pool
echo "exit: $?"
```

Expected: **FAIL**. Statuses distintos de 201 (500 por timeout de conexión) en parte de la ráfaga, **a los ~5 s, no un cuelgue de 60 s** — eso valida a la vez el bug y el `connectTimeoutMS` de Task 1. Si en cambio TODAS dan 201, detenerse: o el pool no quedó en 10, o el bug ya no existe — reportar antes de seguir.

- [ ] **Step 3: Commit (el test queda rojo a propósito; no bloquea porque no entra al gate hasta Task 5)**

```bash
git add test/concurrencia-pool.e2e-spec.ts
git commit --no-verify -m "test(e2e): ráfaga N=pool de ventas simultáneas — RED, documenta el deadlock medido"
```

---

### Task 3: `TxContext` + fachada `Db` (TDD)

**Files:**
- Create: `backend/src/common/db/tx-context.ts`
- Create: `backend/src/common/db/db.service.ts`
- Create: `backend/src/common/db/db.spec.ts`
- Modify: `backend/src/common/common.module.ts` (registrar y exportar ambos; es `@Global`, así que quedan inyectables en toda la app sin imports nuevos)

**Interfaces:**
- Produces (Tasks 4, 5, 6 dependen de estas firmas exactas):
  - `TxContext.managerActivo(): EntityManager | undefined`
  - `TxContext.correrCon<T>(manager: EntityManager, fn: () => Promise<T>): Promise<T>`
  - `TxContext.correrFuera<T>(fn: () => Promise<T>): Promise<T>`
  - `Db.transaccion<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T>` — el callback recibe el manager **para compatibilidad sed con los 76 callbacks existentes**, que ya se llaman `(manager) => {...}`.
  - `Db.query<T = any>(sql: string, params?: unknown[]): Promise<T>`
  - `Db.sinTransaccion<T>(fn: () => Promise<T>): Promise<T>`

- [ ] **Step 1: Escribir los tests que fallan** (`db.spec.ts`)

```ts
import { Test } from '@nestjs/testing';
import { DataSource, type EntityManager } from 'typeorm';
import { TxContext } from './tx-context';
import { Db } from './db.service';

describe('TxContext + Db', () => {
  let tx: TxContext;
  let db: Db;
  // Managers falsos distinguibles por identidad; query espía a dónde fue cada llamada
  const managerTx = {
    query: jest.fn().mockResolvedValue(['desde-manager']),
  } as unknown as EntityManager;
  const dataSource = {
    query: jest.fn().mockResolvedValue(['desde-pool']),
    transaction: jest.fn(
      (cb: (m: EntityManager) => Promise<unknown>) => cb(managerTx),
    ),
  } as unknown as DataSource;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [TxContext, Db, { provide: DataSource, useValue: dataSource }],
    }).compile();
    tx = module.get(TxContext);
    db = module.get(Db);
  });

  it('sin transacción en contexto, query va al pool', async () => {
    await expect(db.query('SELECT 1')).resolves.toEqual(['desde-pool']);
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1', undefined);
  });

  it('dentro de transaccion(), query resuelve el manager del contexto', async () => {
    await db.transaccion(async () => {
      await expect(db.query('SELECT 1')).resolves.toEqual(['desde-manager']);
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('transaccion() anidada REUSA el manager: no abre una segunda transacción', async () => {
    // El vector de la reincidencia de auth.service.ts (2026-08-15): envolver
    // código viejo en una transacción nueva. Con esto es un no-op seguro.
    await db.transaccion(async () => {
      await db.transaccion(async (m) => {
        expect(m).toBe(managerTx);
      });
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('el callback de transaccion() recibe el manager (compatibilidad con los callbacks existentes)', async () => {
    await db.transaccion(async (m) => {
      expect(m).toBe(managerTx);
    });
  });

  it('sinTransaccion() escapa del contexto: query vuelve al pool', async () => {
    await db.transaccion(async () => {
      await db.sinTransaccion(async () => {
        await expect(db.query('SELECT 1')).resolves.toEqual(['desde-pool']);
      });
    });
  });

  it('el contexto NO se filtra entre operaciones concurrentes', async () => {
    // Dos "requests" en paralelo: una transaccional, la otra no. La segunda
    // jamás debe ver el manager de la primera — es la razón por la que esto
    // es un ALS y no un campo del singleton.
    await Promise.all([
      db.transaccion(async () => {
        await new Promise((r) => setTimeout(r, 20));
        expect(tx.managerActivo()).toBe(managerTx);
      }),
      (async () => {
        await new Promise((r) => setTimeout(r, 10));
        expect(tx.managerActivo()).toBeUndefined();
      })(),
    ]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npm test -- db.spec
echo "exit: $?"
```

Expected: FAIL — `Cannot find module './tx-context'`.

- [ ] **Step 3: Implementar**

`tx-context.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { type EntityManager } from 'typeorm';

/**
 * Ata el EntityManager de la transacción en curso a la operación en vuelo
 * (request, venta, job) vía AsyncLocalStorage. Es el "singleton que sabe de
 * quién es cada conexión": el estado no vive en un campo —diez requests
 * concurrentes lo pisarían entre sí— sino en el árbol async de cada operación.
 *
 * Por qué existe: 21 sitios tomaban una conexión NUEVA del pool desde adentro
 * de una transacción abierta (2 conexiones por operación → deadlock permanente
 * con N = tamaño del pool operaciones simultáneas, medido 2026-08-11). Ver
 * spec 2026-08-18-contexto-transaccional-als-design.md y el ADR.
 */
@Injectable()
export class TxContext {
  private readonly als = new AsyncLocalStorage<EntityManager>();

  managerActivo(): EntityManager | undefined {
    return this.als.getStore();
  }

  correrCon<T>(manager: EntityManager, fn: () => Promise<T>): Promise<T> {
    return this.als.run(manager, fn);
  }

  /** Corre fn FUERA de cualquier contexto transaccional (conexión del pool). */
  correrFuera<T>(fn: () => Promise<T>): Promise<T> {
    return this.als.exit(fn);
  }
}
```

`db.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { TxContext } from './tx-context';

/**
 * La única puerta al acceso a datos fuera de los repos. `dataSource.query` /
 * `dataSource.transaction` directos están prohibidos por lint en los services:
 * ignoran el contexto transaccional y reabren el deadlock del pool.
 */
@Injectable()
export class Db {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tx: TxContext,
  ) {}

  /**
   * Abre una transacción y la registra en el contexto. Si YA hay una en
   * contexto la REUSA (sin savepoint) — misma semántica que el enhebrado
   * manual de `manager` que este mecanismo reemplaza. El callback recibe el
   * manager por compatibilidad con los callbacks preexistentes; el código
   * nuevo no necesita usarlo: repos y db.query lo resuelven solos.
   */
  transaccion<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    const activo = this.tx.managerActivo();
    if (activo) return fn(activo);
    return this.dataSource.transaction((manager) =>
      this.tx.correrCon(manager, () => fn(manager)),
    );
  }

  /** Manager del contexto si hay transacción en curso; pool si no. */
  query<T = any>(sql: string, params?: unknown[]): Promise<T> {
    const manager = this.tx.managerActivo();
    return manager
      ? (manager.query(sql, params) as Promise<T>)
      : (this.dataSource.query(sql, params) as Promise<T>);
  }

  /**
   * Salida EXPLÍCITA: corre fn con conexión propia del pool aunque haya una
   * transacción en contexto. Para semántica deliberada de fuera-de-transacción
   * (auditoría que debe sobrevivir al rollback, etc.). Auditado 2026-08-18:
   * ningún sitio actual lo necesita — documentado para el que lo necesite.
   */
  sinTransaccion<T>(fn: () => Promise<T>): Promise<T> {
    return this.tx.correrFuera(fn);
  }
}
```

En `common.module.ts`: importar ambos, agregarlos a `providers` y `exports` (junto a los guards existentes).

- [ ] **Step 4: Correr y verificar que pasa, más el typecheck**

```bash
npm test -- db.spec && npm run typecheck
echo "exit: $?"
```

Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/common/db/ src/common/common.module.ts
git commit --no-verify -m "feat(db): TxContext (ALS) + fachada Db — el manager de la transacción viaja solo"
```

---

### Task 4: Proxy de repos + `RepositoriosModule.forFeature` — cero ediciones en services

**Files:**
- Create: `backend/src/common/db/repositorios.module.ts`
- Modify: `backend/src/common/db/db.spec.ts` (agregar el describe del proxy)
- Modify: los **34** módulos con `TypeOrmModule.forFeature(...)` (listar con `grep -rln 'TypeOrmModule.forFeature' src --include='*.module.ts'`)
- Modify: `backend/src/common/common.module.ts` (es el ÚNICO que además re-exporta `TypeOrmModule` — verificado 2026-08-18; el reemplazo del export es `RepositoriosModule`)

**Interfaces:**
- Consumes: `TxContext.managerActivo()` de Task 3.
- Produces: `RepositoriosModule.forFeature(entidades: EntityClassOrSchema[]): DynamicModule` — provee, bajo `getRepositoryToken(entidad)` (el MISMO token que `@InjectRepository`), un proxy `Repository` context-aware. Por eso los 37 specs que mockean con `getRepositoryToken` no se tocan, y los 441 accesos `this.xRepo.*` tampoco.

**Clave de seguridad de esta task:** hasta la Task 5 nadie registra nada en el ALS, así que el proxy siempre resuelve el repo base — **cero cambio de comportamiento**. Es un checkpoint estable.

- [ ] **Step 1: Agregar los tests del proxy a `db.spec.ts`**

```ts
import { getRepositoryToken } from '@nestjs/typeorm';
import { RepositoriosModule } from './repositorios.module';
import { Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
class EntidadDePrueba {
  @PrimaryGeneratedColumn('uuid')
  id: string;
}

describe('RepositoriosModule.forFeature (proxy context-aware)', () => {
  const repoBase = { find: jest.fn().mockResolvedValue('base'), metadata: { name: 'EntidadDePrueba' } };
  const repoDeTx = { find: jest.fn().mockResolvedValue('tx') };
  const managerTx = {
    getRepository: jest.fn().mockReturnValue(repoDeTx),
  } as unknown as EntityManager;
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(repoBase),
  } as unknown as DataSource;

  let tx: TxContext;
  let repo: { find: () => Promise<string>; metadata: { name: string } };

  // `RepositoriosModule.forFeature` es un dynamic module sin `imports` propios,
  // así que sus providers solo ven lo que venga de un módulo `@Global`. En
  // producción eso se cumple solo: `TypeOrmCoreModule` (token `DataSource`) y
  // `CommonModule` (`TxContext`) son los dos globales. El test lo espeja en vez
  // de inyectar los dos como providers sueltos del módulo raíz, que quedarían
  // invisibles adentro del dynamic module (`UnknownDependenciesException`).
  @Global()
  @Module({
    providers: [TxContext, { provide: DataSource, useValue: dataSource }],
    exports: [TxContext, DataSource],
  })
  class ContextoGlobalDePrueba {}

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      imports: [
        ContextoGlobalDePrueba,
        RepositoriosModule.forFeature([EntidadDePrueba]),
      ],
    }).compile();
    tx = module.get(TxContext);
    repo = module.get(getRepositoryToken(EntidadDePrueba));
  });

  it('sin contexto, delega en el repo del pool', async () => {
    await expect(repo.find()).resolves.toBe('base');
  });

  it('con transacción en contexto, delega en el repo del manager — sin editar al llamador', async () => {
    await tx.correrCon(managerTx, async () => {
      await expect(repo.find()).resolves.toBe('tx');
    });
    expect(managerTx.getRepository).toHaveBeenCalledWith(EntidadDePrueba);
  });

  it('reenvía propiedades no-método (metadata)', () => {
    expect(repo.metadata.name).toBe('EntidadDePrueba');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npm test -- db.spec
echo "exit: $?"
```

Expected: FAIL — `Cannot find module './repositorios.module'`.

- [ ] **Step 3: Implementar `repositorios.module.ts`**

```ts
import { Module, type DynamicModule } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { type EntityClassOrSchema } from '@nestjs/typeorm/dist/interfaces/entity-class-or-schema.type';
import { TxContext } from './tx-context';

/**
 * Reemplazo drop-in de `TypeOrmModule.forFeature`: provee bajo el MISMO token
 * de `@InjectRepository` un proxy que resuelve el repo del manager en contexto
 * (TxContext) si hay transacción en curso, o el repo del pool si no. Así los
 * services no enhebran el manager: la conexión correcta se resuelve sola, y
 * tomar una segunda conexión dentro de una transacción dejó de ser posible
 * por olvido.
 */
function crearRepoProxy(
  entidad: EntityClassOrSchema,
  dataSource: DataSource,
  tx: TxContext,
): unknown {
  const base = dataSource.getRepository(entidad);
  return new Proxy(base, {
    get(target, prop, _receiver) {
      const manager: EntityManager | undefined = tx.managerActivo();
      const repo = manager ? manager.getRepository(entidad) : target;
      const valor: unknown = Reflect.get(repo as object, prop, repo);
      return typeof valor === 'function'
        ? (valor as (...args: unknown[]) => unknown).bind(repo)
        : valor;
    },
  });
}

@Module({})
export class RepositoriosModule {
  static forFeature(entidades: EntityClassOrSchema[]): DynamicModule {
    const providers = entidades.map((entidad) => ({
      provide: getRepositoryToken(entidad),
      useFactory: (dataSource: DataSource, tx: TxContext) =>
        crearRepoProxy(entidad, dataSource, tx),
      inject: [getDataSourceToken(), TxContext],
    }));
    return {
      module: RepositoriosModule,
      providers,
      exports: providers.map((p) => p.provide),
    };
  }
}
```

Nota: `TxContext` se resuelve porque `CommonModule` es `@Global` (Task 3); el token del `DataSource` lo registra `TypeOrmModule.forRootAsync`, que es global en Nest.

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npm test -- db.spec
echo "exit: $?"
```

Expected: PASS.

- [ ] **Step 5: Swap mecánico en los 34 módulos**

En cada `*.module.ts` con `TypeOrmModule.forFeature`:
- `TypeOrmModule.forFeature(` → `RepositoriosModule.forFeature(`
- Import: agregar `import { RepositoriosModule } from '<ruta relativa>/common/db/repositorios.module';` y quitar el de `TypeOrmModule` **si quedó sin otros usos** (el typecheck y el lint de unused-imports cazan los restos).
- En `common.module.ts` además: `exports: [..., TypeOrmModule]` → `exports: [..., RepositoriosModule]` (re-export del dynamic module por clase; los módulos que hoy heredan repos de `CommonModule` los siguen recibiendo).

- [ ] **Step 6: Suite unit COMPLETA + typecheck + boot (cero regresión esperada)**

```bash
npm test && npm run typecheck && npm run lint:check
echo "exit: $?"
cd .. && docker-compose restart backend && sleep 25 && docker-compose logs --tail 20 backend
```

Expected: todo verde, backend arranca sin errores de DI. Si un módulo falla la resolución de un token, el nombre de la entidad está en el error de Nest — revisar el swap de ese módulo.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit --no-verify -m "feat(db): repos como proxies context-aware — mismo token, cero ediciones en services"
```

---

### Task 5: Conversión del camino de la venta → burst GREEN

**Files (Modify):** los services del camino `POST /ventas` y sus specs. Lista cerrada (medida 2026-08-18 siguiendo el fan-out de `crear` → `crearEnTransaccion` → `calcular`):
- `src/modules/ventas/ventas.service.ts` (5 `.transaction`, ~17 `.query`) + `ventas.service.spec.ts`
- `src/modules/items/items.service.ts` (7 `.transaction`, ~30 `.query`, 1 `.manager`) + `items.service.spec.ts`
- `src/modules/calculo-precios/calculo-precios.service.ts` (si tiene acceso directo; sus datos vienen de los services de abajo)
- `src/modules/impuestos/impuestos.service.ts` (2 `.query`) + spec
- `src/modules/descuentos/descuentos.service.ts` (2 `.transaction`, 1 `.query`) + spec
- `src/modules/recargos/recargos.service.ts` (2 `.transaction`, 1 `.query`) + spec
- `src/modules/monedas/monedas.service.ts` (1 `.transaction`, 1 `.query`, 2 `.manager`) + spec
- `src/modules/tenants/tenants.service.ts` (8 `.transaction`, 4 `.query`, 1 `.manager`) + spec
- `src/modules/caja/caja.service.ts` (7 `.transaction`, ~12 `.query`) + spec — `findVirtual` ya quedó cubierto por el proxy, pero el service tiene acceso directo propio
- `src/modules/pagos/pagos.service.ts` (1 `.transaction`, 3 `.query`) + spec
- `src/modules/garzones/garzones.service.ts` (2 `.transaction`) + spec
- `src/modules/propinas/venta-propina.service.ts` — **solo si** tiene acceso directo; su `crearEnTransaccion` ya recibe `manager` explícito y queda como está

**Interfaces:**
- Consumes: `Db.transaccion`/`Db.query` (Task 3) — firmas exactas en Task 3.
- Produces: el patrón de conversión que la Task 6 replica en el resto del backend.

**La transformación, por forma** (aplicar a cada archivo):

1. Constructor: agregar `private readonly db: Db` (import `{ Db } from '../../common/db/db.service'`). Quitar `@InjectDataSource() private readonly dataSource: DataSource` **cuando el archivo quede sin usos** de `dataSource`.
2. `this.dataSource.transaction(async (manager) => {...})` → `this.db.transaccion(async (manager) => {...})` — el callback no cambia: sigue recibiendo el manager y el código interno que ya lo usa explícito sigue igual.
3. `this.dataSource.query(...)` → `this.db.query(...)`.
4. `this.dataSource.manager.<x>(...)` → caso por caso: si es una lectura suelta, `this.db.query` o el repo; anotar en el commit cada uno.
5. Specs: donde el spec provee `{ provide: DataSource, useValue: dataSource }` para el service convertido, cambiar a `{ provide: Db, useValue: db }` con `db = { transaccion: dataSource.transaction, query: dataSource.query, sinTransaccion: (fn) => fn() }` — los fakes de manager existentes se reusan tal cual (35 specs proveen DataSource en el repo; acá solo los de esta lista).

⚠️ Reglas de esta task:
- **No refactorizar nada más.** Ni renombres, ni reordenar queries, ni "aprovechar que estamos acá". Los comentarios existentes sobre el orden de locks (`items.service.ts:1330-1338`, `pg_advisory` si aparece) se preservan intactos.
- Los sitios con semántica deliberada de fuera-de-transacción de esta lista (`abrir` de caja, restore de `items`) están **fuera** de callbacks de transacción: convertir su `dataSource.query` a `db.query` NO los cambia (sin contexto activo, `db.query` va al pool). Verificar el comentario de cada uno al tocarlo; si alguno resultara correr dentro de un contexto, usar `db.sinTransaccion` y documentar por qué.

- [ ] **Step 1: Convertir `ventas.service.ts` + spec; correr su suite**

```bash
npm test -- ventas.service && npm run typecheck
echo "exit: $?"
```

Expected: PASS.

- [ ] **Step 2: Convertir el resto de la lista, de a un archivo, corriendo el spec de cada uno**

```bash
npm test -- <nombre>.service && npm run typecheck
```

- [ ] **Step 3: Suite unit completa + lint + typecheck**

```bash
npm test && npm run typecheck && npm run lint:check
echo "exit: $?"
```

Expected: PASS completo, exit 0. **`lint:check` va en el mismo paso a propósito**: la Task 2
commiteó 3 errores de prettier que nadie vio hasta dos tasks después, porque su checklist no
lo incluía. Todo archivo nuevo o tocado pasa por lint antes del commit.

- [ ] **Step 4: El burst pasa a GREEN**

```bash
cd .. && ./scripts/reset-db.sh && cd backend
npm run test:e2e -- concurrencia-pool
echo "exit: $?"
```

Expected: **PASS** — las 10 dan 201 y el login posterior 200. Si sigue rojo: algún service del camino quedó tomando pool; el error de timeout dice qué query — buscar su archivo y convertirlo.

⚠️ **El verde de status no alcanza como criterio** (lo levantó la revisión de la Task 2): las
aserciones actuales distinguen un arreglo parcial, pero **no cazarían 201 falsos sin
persistencia real**. Antes de dar la task por hecha, sumar al test la verificación de que las
10 ventas existen de verdad: cada respuesta trae un `id`, los 10 ids son distintos, y un
`GET /api/ventas/:id` sobre uno de ellos devuelve 200 con su detalle. Sin esto, un arreglo que
devolviera 201 sin escribir pasaría el gate.

Verificación adicional del criterio de éxito del spec (una vez, mientras el burst corre en otra terminal o repitiéndolo):

```bash
docker-compose -f ../docker-compose.yml exec -T postgres psql -U postgres -d startup_pos -c "SELECT state, wait_event, count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1,2;"
```

Expected: sin filas `idle in transaction` + `ClientRead` acumuladas (la firma del deadlock medida el 2026-08-11 era eso: transacción abierta con el JS esperando otra conexión).

- [ ] **Step 5: Commit**

```bash
git add src/ test/
git commit --no-verify -m "feat(db): camino de la venta sobre el contexto ALS — la ráfaga N=pool pasa"
```

---

### Task 6: Barrido del resto del backend

**Files (Modify):** todos los services restantes con `this.dataSource.`. Encontrarlos SIEMPRE por conducta, no por lista (la lista envejece — lección repetida del backlog):

```bash
grep -rln 'this\.dataSource\.' src --include='*.service.ts' | grep -v seeder
grep -rln 'this\.dataSource\.' src --include='*.ts' | grep -v seeder | grep -v spec | grep -v common/db
```

(Al momento de escribir el plan: salones, cuenta-asignaciones, turnos/sesiones-garzon, propinas (distribución, liquidación, reportes), mermas + causas-merma, recuentos, roles, rbac, auth, suscripciones, grupos-modificadores, motivos-diferencia ×2, metodos-pago, cajones, caja-testigo, pasarela (cobros, inscripciones, tenant-pasarela), inventario, categorias, garzones, `cron/jobs/expirar-ordenes.job.ts`, `app.service.ts`. **La verdad la da el grep del día.**)

**Interfaces:**
- Consumes: el patrón de conversión de Task 5, aplicado idéntico.

🔴 **Dos cosas que la revisión de la Task 5 dejó para esta task, y una es una mina.**

1. **`salones.service.ts` y `suscripciones.service.ts` son PRIORITARIOS.** Los dos abren
   `dataSource.transaction` crudo y adentro llaman `ventasService.crearEnTransaccion(manager, …)`.
   Como el `TxContext` solo lo puebla `Db.transaccion`, ahí **no hay contexto**: todos los
   colaboradores ya convertidos vuelven a pedir conexión al pool con la transacción externa
   abierta. No es regresión —era así antes—, pero es la firma exacta del deadlock en el flujo
   de mesa de un POS de restaurante, y el burst de la Task 2 no lo cubre porque entra por
   `POST /ventas` directo.
2. ⚠️ **El loop de reintento de `ventas.service.ts:132-141` es una trampa.** Reintenta
   `this.db.transaccion(...)`, y `Db.transaccion` **reusa** la transacción si ya hay uno en
   contexto. Hoy es inofensivo (verificado: los únicos llamadores de `crear()` son el
   controller y `online-callback.handler.ts`, ninguno con transacción envolvente). Pero **en
   cuanto esta task convierta un llamador aguas arriba a `db.transaccion`, el reintento va a
   correr dentro de la MISMA transacción ya abortada**: tres fallos garantizados (`25P02`) en
   vez de un reintento. Antes de convertir un llamador de `crear()`, resolver esto —y dejar
   la precondición escrita en un comentario de `crear()`.

⚠️ Auditoría obligada en esta task (sitios con semántica deliberada, identificados 2026-08-18):
- `cobros.service.ts` — el `catch` que registra el intento de reembolso **después del rollback** (`:367`): está fuera del callback → sin contexto → `db.query`/repo van al pool. Correcto sin cambios. Preservar el comentario.
- `auth.service.ts:493` — la poda fuera de la transacción: ídem.
- Cualquier otro comentario "fuera de la transacción" que aparezca al convertir: verificar que el sitio quede lexicalmente fuera de `db.transaccion` y anotarlo en el mensaje de commit.

- [ ] **Step 1: Convertir de a un módulo, corriendo el spec del módulo tras cada uno**

```bash
npm test -- <nombre> && npm run typecheck
```

- [ ] **Step 2: Verificación de barrido completo (por conducta)**

```bash
grep -rn 'this\.dataSource\.' src --include='*.ts' | grep -v seeder | grep -v spec | grep -v common/db
echo "exit: $?"
```

Expected: **sin resultados** (exit 1 del grep). Todo acceso directo restante vive en `seeder` o `common/db`.

- [ ] **Step 3: Suite unit completa + typecheck + lint**

```bash
npm test && npm run typecheck && npm run lint:check
echo "exit: $?"
```

Expected: PASS.

- [ ] **Step 4: E2E completo (primera pasada del gate)**

```bash
cd .. && ./scripts/reset-db.sh && cd backend
npm run test:e2e
echo "exit: $?"
cd .. && ./scripts/reset-db.sh --verificar
```

Expected: PASS completo (el gate corre **entero**, no un subset — lección del backlog). Ante fallos raros, `--verificar` primero: la base pudo re-sembrarse a mitad de suite.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit --no-verify -m "refactor(db): barrido completo a la fachada Db — dataSource directo solo en seeder"
```

---

### Task 7: Mutante — probar que el detector detecta

**Files:**
- Modify (temporal, se revierte): `backend/src/common/db/repositorios.module.ts`

El mutante **revierte al comportamiento viejo** (repo del pool siempre), no rompe por romper — es lo que prueba que el test habría cazado el bug original (regla de la memoria del proyecto).

- [ ] **Step 1: Mutar — el proxy ignora el contexto**

En `crearRepoProxy`, reemplazar la línea `const repo = manager ? manager.getRepository(entidad) : target;` por `const repo = target;`.

- [ ] **Step 2: El burst tiene que fallar RUIDOSO**

```bash
cd .. && ./scripts/reset-db.sh && cd backend
npm run test:e2e -- concurrencia-pool
echo "exit: $?"
```

Expected: **FAIL** con statuses ≠ 201 en ~5 s (el `connectTimeoutMS` de Task 1 evita el cuelgue). Si PASA, detenerse: el detector no detecta — reportar antes de seguir.

- [ ] **Step 3: Revertir y verificar el revert de verdad**

```bash
git checkout -- src/common/db/repositorios.module.ts
git status --porcelain
npm run test:e2e -- concurrencia-pool
echo "exit: $?"
```

Expected: working tree limpio y burst PASS de nuevo. (El e2e compila desde el fuente en el proceso de jest, así que no depende del watcher del contenedor; el `git status` limpio es la verificación del revert.)

- [ ] **Step 4: No hay commit** (el mutante no deja rastro; el checkpoint es este paso del plan).

---

### Task 8: Regla de lint — `dataSource` directo prohibido en services

**Files:**
- Modify: `backend/eslint.config.mjs`
- Modify: `backend/src/common/db/db.service.ts` (docblock de la clase `Db`)

⚠️ **Deuda de la Task 3 que se paga acá:** el docblock de `Db` dice hoy que la regla de lint "se construye en la Task 8". Al crear la regla en esta task, pasarlo a presente — es la frase que vuelve verdadera este cambio.

**Por qué `no-restricted-syntax` y no `no-restricted-properties`:** la forma del repo es `this.dataSource.query(...)` — el objeto del member expression es `this.dataSource` (otro member expression), que `no-restricted-properties` no matchea (solo matchea objetos identificador).

- [ ] **Step 1: Agregar el bloque a `eslint.config.mjs`** (después del bloque de reglas general, antes del de specs)

```js
  {
    // El acceso directo al DataSource ignora el contexto transaccional (ALS) y
    // reabre el deadlock del pool (ADR-020). Toda query/transacción pasa por la
    // fachada Db. Excepciones: la propia fachada, y el seeder (corre al boot,
    // sin concurrencia).
    files: ['src/**/*.ts'],
    ignores: [
      'src/common/db/**',
      'src/modules/seeder/**',
      'src/**/*.spec.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'MemberExpression[object.property.name="dataSource"][property.name=/^(query|transaction|manager|createQueryRunner)$/]',
          message:
            'dataSource directo ignora la transacción en contexto y reabre el deadlock del pool. Usar Db.query / Db.transaccion (src/common/db) — ver docs/patterns/backend.md.',
        },
      ],
    },
  },
```

- [ ] **Step 2: Mutante de la regla — una violación temporal tiene que caer**

Agregar `void this.dataSource.query('SELECT 1');` (y un `@InjectDataSource` temporal si hace falta) en cualquier método de `src/modules/categorias/categorias.service.ts`, correr:

```bash
npm run lint:check
echo "exit: $?"
```

Expected: **FAIL** con el mensaje de la regla apuntando a la línea. Revertir la violación:

```bash
git checkout -- src/modules/categorias/categorias.service.ts
```

- [ ] **Step 3: Lint limpio sobre el repo real**

```bash
npm run lint:check
echo "exit: $?"
```

Expected: PASS (Task 6 dejó cero accesos directos fuera de las excepciones).

- [ ] **Step 4: Commit**

```bash
git add eslint.config.mjs
git commit --no-verify -m "chore(lint): dataSource directo prohibido en services — la regla que faltó tras la reincidencia"
```

---

### Task 9: Documentación (la tabla de CLAUDE.md, en el mismo cuerpo de trabajo)

**Files:**
- Create: `docs/adr/020-contexto-transaccional-als.md`
- Modify: `docs/adr/README.md` — fila nueva en el índice:

  ```
  | [020](./020-contexto-transaccional-als.md) | Contexto transaccional con AsyncLocalStorage — la conexión de la transacción viaja sola | Accepted | 2026-08-18 |
  ```
- Modify: `docs/patterns/backend.md` (sección nueva)
- Modify: `docs/ARCHITECTURE.md` (el contexto transaccional como pieza transversal, 2-4 líneas donde se describe el flujo de un request)
- Modify: `docs/agent/pendientes.md` + `docs/agent/resueltos.md` (mudanza parcial)
- Modify: `docs/agent/anti-patterns.md` (una entrada nueva, ver Step 5)
- Modify: `backend/src/common/db/repositorios.module.ts` (solo docblock, ver Step 5)

📋 **Deuda de la revisión de la Task 4 que se paga acá** (todas verificadas con grep como
latentes: cero consumidores hoy, ninguna bloquea):

| Qué | Dónde va |
|---|---|
| `RepositoriosModule.forFeature` no cubre `getTreeRepository` (entidades `@Tree`) | ADR-020, Consequences |
| No alimenta `EntitiesMetadataStorage` → `autoLoadEntities` no funcionaría | ADR-020, Consequences |
| No pasa `targetEntitySchema` (workaround de Nest para nombres de clase duplicados) | ADR-020, Consequences |
| No acepta el 2º parámetro `dataSource` (data sources con nombre) | ADR-020, Consequences |
| El docblock de `repositorios.module.ts` afirma en pasado que tomar una 2ª conexión "dejó de ser posible" — hoy nadie registra en el ALS, y aun tras T5 la garantía cubre acceso por repo, no `dataSource.query` directo | Reformular a futuro + alcance explícito |
| `repositorios.module.ts` depende de que `TxContext` y `DataSource` vengan de módulos `@Global`; si `TxContext` alguna vez inyectara algo no global, el lazo se rompe al arrancar | Comentario en el propio archivo |

📋 **Y lo que dejaron las revisiones de las Tasks 5, 6 y 8** — los límites conocidos del
enforcement y de la evidencia, que el ADR tiene que decir en voz alta para que nadie los
redescubra como si fueran nuevos:

| Qué | Dónde va |
|---|---|
| La regla de lint es **name-based**: un alias de importación (`import { DataSource as DS }`) la esquiva. Cero instancias hoy, realismo bajo, pero es un límite real | ADR-020, Consequences |
| La regla ataca el **chokepoint de inyección**, no cada uso: un `DataSource` recibido como parámetro de función libre (`nombre-sugerido.util.ts`, `rango-fecha.util.ts`) queda fuera por diseño — esas funciones no pasan por DI | ADR-020, Consequences |
| **Ningún e2e toca `suscripciones` ni `pasarela`** (la suite de pasarela es la única skipped): esa mitad del barrido la sostienen los unit tests, no el e2e | ADR-020, Consequences |
| Dentro de una transacción, un `Promise.all` de lecturas ya no da paralelismo real y dispara la deprecación de pg. Ya anotado en `pendientes.md` por la Task 5 — acá solo el puntero | ADR-020 + `anti-patterns.md` |

- [ ] **Step 1: Escribir el ADR-020** con este contenido (formato de los ADR existentes: Status/Context/Decision/Consequences):

  - **Context:** el deadlock medido (2 conexiones por operación, umbral N = pool, experimento del 2026-08-11) y la reincidencia del 2026-08-15 que probó que documentar no alcanza.
  - **Decision:** contexto propio con ALS (`TxContext` + `Db` + proxies de repo bajo el mismo token). Alternativas descartadas **con el porqué de cada una** (tabla del spec §Contexto: manager explícito no es de raíz; `typeorm-transactional` parchea internals de TypeORM 1.0; Prisma/Drizzle tienen el mismo modelo manual; MikroORM resuelve esto nativo pero migrar 103 entidades por ~200 líneas es desproporcionado).
  - **Consequences:** (+) el vector "envolver código viejo en transacción nueva" es un no-op seguro; los repos no cambian de API; specs intactos. (−) los `Promise.all` de lecturas dentro de transacción se serializan en una conexión (~ms, medido); una pieza de infraestructura propia que mantener (~200 líneas); `dataSource` directo prohibido por lint salvo fachada y seeder.

- [ ] **Step 2: Sección en `docs/patterns/backend.md`:** transacciones con `db.transaccion` (nunca `dataSource.transaction`), queries crudas con `db.query`, cuándo `db.sinTransaccion` (semántica deliberada de fuera-de-transacción, con los ejemplos de `cobros` y la poda de `auth`), y que el `manager` explícito preexistente sigue siendo válido.

- [ ] **Step 3: Mudanza en el backlog** — en `pendientes.md`, de la entrada 🚩 del deadlock:
  - Se muda a `resueltos.md` (con fecha 2026-08-18 y resumen del cierre: mecanismo, los 21 sitios cubiertos, la regla de lint, el burst test): **todo lo relativo al pool de conexiones**.
  - **Quedan en `pendientes.md`**, como entrada propia dentro de la sección 🔴 (siguen siendo la tanda): los dos ciclos de orden de lock de la bandeja de desfases, los `FOR UPDATE` antes de validar tenant, y el hueco de test de lecturas constantes para N combos.
  - En la sección 6 (proyectos que van solos), una línea nueva: *"Si algún día se evalúa cambiar el ORM, el candidato es MikroORM (resuelve el contexto transaccional nativo, con ALS — ADR-020); Prisma y Drizzle tienen el mismo modelo manual de transacciones que TypeORM."*
  - La fila "Conexiones / deadlock" de la tabla de la tanda pasa a apuntar a la entrada residual de locks.

- [ ] **Step 5: Entrada nueva en `docs/agent/anti-patterns.md`** — *guardar una referencia a un
método de repo y llamarla después*. `const find = repo.find` tomado fuera de una transacción
y llamado adentro usa el repo del pool: el proxy resuelve el manager **en el acceso a la
propiedad**, no en la llamada, así que una referencia cacheada se lleva el repo equivocado y
reabre exactamente el deadlock que este trabajo cierra. Medido en la revisión de la Task 4:
**cero ocurrencias hoy** en `backend/src` (tres greps distintos), por eso es prevención y no
un arreglo.

- [ ] **Step 6: Verificar links y tablas (el pre-commit los chequea igual)**

```bash
cd .. && git add docs/ && git commit -m "docs(db): ADR-020 contexto transaccional ALS + patrón Db + mudanza parcial del deadlock"
```

(Este commit es docs-only: el hook de revisión independiente no aplica; los checks de links/tablas sí corren y deben pasar.)

---

### Task 10: Gate completo + revisión independiente + cierre

- [ ] **Step 1: Gate backend completo**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
echo "exit: $?"
cd .. && ./scripts/reset-db.sh && cd backend && npm run test:e2e
echo "exit: $?"
cd .. && ./scripts/reset-db.sh --verificar
```

Expected: todo PASS, `--verificar` confirma una sola siembra.

- [ ] **Step 2: Gate frontend completo** (no se tocó, pero el gate corre entero — regla del proyecto)

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
echo "exit: $?"
```

Expected: PASS.

- [ ] **Step 3: Revisión independiente (verify-feature paso 7)** — invocar el skill `verify-feature`; el sub-agente `domain-reviewer` revisa `git diff d49a55f2..HEAD` (el diff completo de la tanda) contra invariantes, N+1 y alcance. **Fijar `model` explícito al despachar el sub-agente** (regla de memoria del proyecto). Los hallazgos se resuelven antes de cerrar; el recibo que deja es el que el pre-commit exige.

- [ ] **Step 4: Commit de cierre si la revisión pidió cambios** (con el recibo ya generado, sin `--no-verify`):

```bash
git add -A && git commit -m "fix(db): ajustes de la revisión independiente del contexto transaccional"
```

- [ ] **Step 5: Post-push** — tras el push a `main`, revisar el CI **y el deploy de Railway** (el push despliega; este cambio toca el arranque de TypeORM):

```bash
cd .. && ./scripts/smoke-produccion.sh
```

Expected: smoke OK con el deploy en SUCCESS.
