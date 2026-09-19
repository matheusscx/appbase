# Plan: Un cobro que se repite no se registra dos veces

**Status:** Draft
**Date:** 2026-09-19
**Owner:** Cesar Matheus

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /ventas`, `POST /cuentas/:id/cerrar` y `POST /pagos` exigen una `Idempotency-Key`. El reintento con la misma clave reproduce la respuesta original y no crea nada; con otros datos, responde 422.

**Architecture:** Una tabla `solicitudes_idempotentes` y un `IdempotenciaService.ejecutar()` que reclama la clave con `INSERT … ON CONFLICT DO NOTHING` **como primera sentencia de la transacción de la operación** y guarda la respuesta al final, en la misma transacción. En el frontend, un composable `useIntentoCobro` guarda la clave en memoria por ámbito (el carrito del POS, la cuenta del salón, la venta del abono, el checkout de la tienda), desde el primer *Confirmar* hasta el éxito o el vaciado.

**Tech Stack:** NestJS + TypeORM + Postgres 15 (`Db`, ADR-020), `node:crypto`, `class-validator` (`isUUID`), `class-transformer` (`instanceToPlain`); Nuxt 4 + Nuxt UI v4, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-19-idempotencia-venta-design.md`](../specs/2026-09-19-idempotencia-venta-design.md). Leerlo entero antes de la primera tarea: los porqués están ahí, no acá.

## Global Constraints

- Nombre de la cabecera: `Idempotency-Key`. Valor: UUID. **Obligatoria** en los tres endpoints; sin ella o con un valor que no es UUID, **400**.
- Reproducción: el mismo body que el primer intento más `repetida: true`, con el mismo status.
- Otros datos con la misma clave: **422** con body `{ statusCode: 422, message, ventaId }`, y message **exacto**: `Este cobro ya se había registrado con otros datos. Revisá la venta antes de cobrar de nuevo.`
- Aviso del frontend al reproducir, **exacto**: `Este cobro ya había entrado, no se registró dos veces`.
- Operaciones, **exactas**: `venta.crear`, `cuenta.cerrar`, `pago.abono`.
- Unicidad por `(tenant_id, usuario_id, clave)` con `eliminado_el IS NULL`. `tenant_id` y `usuario_id` salen **siempre del JWT**.
- La huella **nunca** incluye el PIN del garzón.
- Sin dependencias nuevas (ni backend ni frontend).
- La clave del frontend **no se regenera** al editar el carrito o los pagos. Solo muere con el éxito o con el vaciado (spec § 7.1).
- **No hay reintento automático**: la app nunca repite sola el request. El que reintenta es el cajero (memoria del owner, 2026-09-11).

---

## Context

La entrada del backlog y las decisiones del owner están en el spec (§ 1 y § 2). Lo que el plan
suma es **cómo** llevarlo al código de hoy:

- `VentasService.crear` (`backend/src/modules/ventas/ventas.service.ts`, `async crear`) abre
  `db.transaccion` dentro de un loop que reintenta el `40P01`. Adentro llama a
  `crearEnTransaccion` y a `armarBoleta`, y devuelve `{ ...venta, boleta }`. También lo llama
  `OnlineCallbackHandler` (Webpay), **sin** HTTP y **sin** clave.
- `SalonesService.cerrarCuenta` (`salones.service.ts`, `async cerrarCuenta`): resuelve el
  garzón y valida su sesión **fuera** de la transacción. Adentro toma `FOR UPDATE` sobre la
  cuenta y rechaza con *"La cuenta no está abierta"*. Devuelve `{ cuenta, ventaId, boleta }`.
- `PagosService.registrarAbono` (`pagos.service.ts`) abre `db.transaccion`, toma `FOR UPDATE`
  sobre la venta y devuelve `{ pagos, venta: { id, estado, saldo } }`.
- `Db.transaccion(fn)` **reusa** la transacción activa si la hay (`db.service.ts`). Por eso
  `IdempotenciaService.ejecutar` puede abrir la suya con `db.transaccion`: dentro de la de la
  operación se suma a ella, y fuera abre una propia. En los dos casos el reclamo y la operación
  son atómicos.
- Hay un `ClassSerializerInterceptor` global (`main.ts:20`) y un `ValidationPipe` con
  `whitelist: true, transform: true` (`main.ts:19`).
- Frontend: `pages/ventas/pos.vue` (`confirmarCobro`), `pages/tienda/pasarela.vue` (`aprobar`),
  `composables/useSalones.ts` (`cerrarCuenta`, llamado desde `pages/salones/index.vue` en el
  flujo de *Cerrar y cobrar*) y `components/pagos/AbonoModal.vue` (`confirmar`). Todos usan
  `useApiFetch`, que acepta `headers` en las opciones y los conserva en el reintento por 401
  (`composables/useApiFetch.ts`).

## Scope / Out of scope

**Entra:** los tres endpoints y las cuatro pantallas del spec § 3.1.
**No entra:** el callback de Webpay, las suscripciones, la nota de crédito (frente fiscal
propio, ya anotado en `pendientes.md` § 6) y anular (spec § 3.2).

## Coordinación y entorno (leer antes de la Task 0)

- El código va en el worktree **`.claude/worktrees/idempotencia-venta`**, rama propia desde
  `main` con el commit de este plan ya integrado. **Nunca** en el checkout principal.
- **Stack de Docker compartido** con otras sesiones: un Postgres y un `tecnica_backend`.
  **Antes de cualquier `reset-db.sh` o `test:e2e`, aunque sea de un solo spec**, pedir turno
  por mensaje a la sesión orquestadora del owner (buscarla con `list_sessions`) y esperar el OK.
  Cada corrida empieza con `./scripts/reset-db.sh` **desde este worktree** y cierra con
  `./scripts/reset-db.sh --verificar`. Al soltar el stack, avisar con la hora.
- El plan agrupa las corridas de e2e en **dos turnos**: uno al terminar el backend (Task 5) y
  el del gate final (Task 11). Los e2e de las Tasks 2 a 4 se **escriben** en su tarea y se
  **corren** en el turno de la Task 5.
- ⚠️ Con el e2e corriendo, **no tocar ningún `.ts` del backend**: el watcher recompila, reinicia
  y vuelve a sembrar. Y **nunca** correr la revisión independiente (que muta el working tree)
  a la vez que el e2e.
- **Un solo commit para todo el frente**, al final (Task 11). El estado intermedio entre el
  backend (cabecera obligatoria) y el frontend (que todavía no la manda) deja el POS sin poder
  cobrar, y un commit ahí sería peor que el punto de partida. Las tareas son puntos de control
  sin commit.

---

## Backend

### Task 0: Worktree y entorno

**Files:** ninguno del repo.

- [ ] **Step 1: Crear el worktree desde main**

```bash
cd /Users/m2pro/cmatheus/startup-app
git worktree add .claude/worktrees/idempotencia-venta -b idempotencia-venta main
git -C .claude/worktrees/idempotencia-venta log --oneline -1
```
Expected: el último commit es el de estos docs (`docs(idempotencia): …`). Si no, **parar**:
el fast-forward de los docs todavía no está en `main`.

- [ ] **Step 2: Entorno**

```bash
cp /Users/m2pro/cmatheus/startup-app/.env /Users/m2pro/cmatheus/startup-app/.claude/worktrees/idempotencia-venta/.env
cd /Users/m2pro/cmatheus/startup-app/.claude/worktrees/idempotencia-venta/backend && npm ci
cd /Users/m2pro/cmatheus/startup-app/.claude/worktrees/idempotencia-venta/frontend && npm ci
git -C /Users/m2pro/cmatheus/startup-app/.claude/worktrees/idempotencia-venta config core.hooksPath .githooks
```
⚠️ Revisar `API_PROXY_TARGET` en el `.env` copiado. El de `.env.example` cuelga el proxy del
frontend (memoria *worktree nuevo viene sin entorno*). A partir de acá, **rutas absolutas y
`git -C`**: el cwd puede volver solo al checkout principal.

### Task 1: Núcleo — tabla, huella, servicio y cabecera

**Files:**
- Create: `backend/src/modules/idempotencia/entities/solicitud-idempotente.entity.ts`
- Create: `backend/src/modules/idempotencia/huella.ts`
- Create: `backend/src/modules/idempotencia/huella.spec.ts`
- Create: `backend/src/modules/idempotencia/idempotencia.service.ts`
- Create: `backend/src/modules/idempotencia/idempotencia.service.spec.ts`
- Create: `backend/src/modules/idempotencia/idempotencia.module.ts`
- Create: `backend/src/common/decorators/clave-idempotencia.decorator.ts`
- Create: `backend/src/common/decorators/clave-idempotencia.decorator.spec.ts`
- Modify: `backend/src/app.module.ts` (import del módulo **y** entidad en el array `entities`,
  porque no hay `autoLoadEntities`)

**Interfaces — Produces:**
- `type OperacionIdempotente = 'venta.crear' | 'cuenta.cerrar' | 'pago.abono'`
- `huellaDe(operacion: OperacionIdempotente, datos: unknown): string` (64 hex)
- `IdempotenciaService.ejecutar<T extends object>(solicitud: SolicitudIdempotente, operar: () => Promise<T>, ventaIdDe: (r: T) => string | null): Promise<T & { repetida?: true }>`
  (la reproducción es el `T` ya serializado: mismas claves, fechas como string. Se tipa como
  `T` a propósito, porque una unión rompería a los llamadores internos, como el callback de
  Webpay, que leen `venta.id`)
  con `SolicitudIdempotente = { tenantId: string; usuarioId: string; clave: string; operacion: OperacionIdempotente; huella: string }`
- `MENSAJE_OTROS_DATOS` (string exacto de Global Constraints)
- `@ClaveIdempotencia()`: param decorator que devuelve el UUID de la cabecera o lanza 400

- [ ] **Step 1: Test de la huella (falla)**

`huella.spec.ts`:
```ts
import { huellaDe } from './huella';

describe('huellaDe', () => {
  it('no depende del orden de las claves, a ninguna profundidad', () => {
    const a = { lineas: [{ itemId: 'i1', cantidad: '2' }], pagos: [{ monto: '10', metodoPagoId: 'm' }] };
    const b = { pagos: [{ metodoPagoId: 'm', monto: '10' }], lineas: [{ cantidad: '2', itemId: 'i1' }] };
    expect(huellaDe('venta.crear', a)).toBe(huellaDe('venta.crear', b));
  });
  it('cambia con cualquier dato del cobro', () => {
    const base = { pagos: [{ metodoPagoId: 'tarjeta', monto: '12000' }] };
    const efectivo = { pagos: [{ metodoPagoId: 'efectivo', monto: '12000' }] };
    expect(huellaDe('venta.crear', base)).not.toBe(huellaDe('venta.crear', efectivo));
  });
  it('el orden de un array sí importa (dos líneas no son intercambiables en el motor)', () => {
    expect(huellaDe('venta.crear', { l: ['a', 'b'] })).not.toBe(huellaDe('venta.crear', { l: ['b', 'a'] }));
  });
  it('la operación es parte de la huella', () => {
    expect(huellaDe('venta.crear', { x: 1 })).not.toBe(huellaDe('pago.abono', { x: 1 }));
  });
  it('trata igual una instancia de clase que su objeto plano', () => {
    class Dto { monto = '10'; }
    expect(huellaDe('pago.abono', new Dto())).toBe(huellaDe('pago.abono', { monto: '10' }));
  });
});
```
Run: `cd backend && npx jest src/modules/idempotencia/huella.spec.ts` → FAIL (no existe el módulo).

- [ ] **Step 2: `huella.ts`**

```ts
import { createHash } from 'node:crypto';

export type OperacionIdempotente = 'venta.crear' | 'cuenta.cerrar' | 'pago.abono';

/**
 * JSON canónico (claves ordenadas a toda profundidad, arrays en su orden) →
 * SHA-256. Es lo que distingue "el mismo cobro reintentado" de "otro cobro con
 * la misma clave" (spec § 6.3). El llamador arma `datos` a mano y decide qué
 * NO entra: el PIN del garzón nunca (un hash de pocos dígitos se revierte).
 */
export function huellaDe(operacion: OperacionIdempotente, datos: unknown): string {
  const plano: unknown = JSON.parse(JSON.stringify(datos ?? null));
  return createHash('sha256')
    .update(JSON.stringify({ operacion, datos: ordenar(plano) }))
    .digest('hex');
}

function ordenar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, ordenar((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
```
Run el spec → PASS.

- [ ] **Step 3: Entidad**

`solicitud-idempotente.entity.ts`: `@Entity('solicitudes_idempotentes')` con `@Index` único
parcial `['tenantId', 'usuarioId', 'clave']`, `where: '"eliminado_el" IS NULL'`. Columnas con
**tipo explícito** en cada `@Column` (memoria *typeorm-tipo-de-columna-explicito*):
`@PrimaryGeneratedColumn('uuid', { name: 'solicitud_idempotente_id' })`,
`tenant_id`/`usuario_id`/`clave` `type: 'uuid'`, `operacion` `type: 'varchar'` (tipado
`string`, **no** la unión con `import type`), `huella` `type: 'varchar', length: 64`,
`respuesta` `type: 'jsonb', nullable: true`, `venta_id` `type: 'uuid', nullable: true`, y la
triada `creado_el`/`actualizado_el`/`eliminado_el` con `type: 'timestamptz'`.
**Sin `@ManyToOne`**: el docblock copia el porqué de `caja_intentos_rechazados` (spec § 5).

- [ ] **Step 4: Test del servicio (falla)**

`idempotencia.service.spec.ts`, con `Db` mockeado (`transaccion: (fn) => fn()` y `query` como
`jest.fn()`). Tres casos:
1. El `INSERT` devuelve una fila → llama a `operar` una vez, hace el `UPDATE` con
   `JSON.stringify(instanceToPlain(respuesta))` y el `ventaIdDe(respuesta)`, y devuelve la
   respuesta **sin** `repetida`.
2. El `INSERT` no devuelve filas y el `SELECT` trae la misma huella → **no** llama a `operar` y
   devuelve `{ ...respuesta, repetida: true }`.
3. El `INSERT` no devuelve filas y la huella difiere → `UnprocessableEntityException` con
   `getResponse()` igual a `{ statusCode: 422, message: MENSAJE_OTROS_DATOS, ventaId }`, y
   `operar` no se llamó.

⚠️ Este unitario prueba **la rama**, no la concurrencia ni el SQL: eso lo prueba el e2e de la
Task 2 contra Postgres real. No escribir aserciones `toContain` sobre el texto del SQL (memoria
*test-que-afirma-sobre-el-sql*).

- [ ] **Step 5: `idempotencia.service.ts`**

```ts
@Injectable()
export class IdempotenciaService {
  constructor(private readonly db: Db) {}

  /**
   * Corre `operar` UNA vez por (tenant, usuario, clave). El reclamo es la
   * PRIMERA sentencia de la transacción, y `db.transaccion` reusa la del
   * llamador si la hay: reclamo, operación y respuesta commitean juntos o no
   * commitea ninguno (spec § 6.1). Un duplicado concurrente espera en el
   * índice único hasta el commit del primero y cae en `reproducir`.
   */
  ejecutar<T extends object>(
    s: SolicitudIdempotente,
    operar: () => Promise<T>,
    ventaIdDe: (r: T) => string | null,
  ): Promise<T & { repetida?: true }> {
    return this.db.transaccion(async () => {
      const reclamo = unwrap<{ id: string }>(
        await this.db.query(
          `INSERT INTO solicitudes_idempotentes
             (tenant_id, usuario_id, clave, operacion, huella)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, usuario_id, clave) WHERE eliminado_el IS NULL
           DO NOTHING
           RETURNING solicitud_idempotente_id AS id`,
          [s.tenantId, s.usuarioId, s.clave, s.operacion, s.huella],
        ),
      );
      if (reclamo.length === 0) return this.reproducir<T>(s);

      const respuesta = await operar();
      await this.db.query(
        `UPDATE solicitudes_idempotentes
            SET respuesta = $1, venta_id = $2, actualizado_el = NOW()
          WHERE solicitud_idempotente_id = $3`,
        [JSON.stringify(instanceToPlain(respuesta)), ventaIdDe(respuesta), reclamo[0].id],
      );
      return respuesta;
    });
  }

  private async reproducir<T>(s: SolicitudIdempotente): Promise<T & { repetida: true }> {
    const [fila] = await this.db.query<
      { huella: string; respuesta: Record<string, unknown> | null; venta_id: string | null }[]
    >(
      `SELECT huella, respuesta, venta_id
         FROM solicitudes_idempotentes
        WHERE tenant_id = $1 AND usuario_id = $2 AND clave = $3
          AND eliminado_el IS NULL`,
      [s.tenantId, s.usuarioId, s.clave],
    );
    // ON CONFLICT solo no inserta contra una fila COMMITEADA, y esa fila se
    // commitea con su respuesta. Si falta, algo rompió la atomicidad: 500, no
    // un falso "ya entró".
    if (!fila?.respuesta)
      throw new InternalServerErrorException('Solicitud idempotente sin respuesta');
    if (fila.huella !== s.huella)
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: MENSAJE_OTROS_DATOS,
        ventaId: fila.venta_id,
      });
    // Es el `T` que se serializó al guardarlo (spec § 6.4): mismas claves, fechas
    // como string. Para el cliente HTTP es idéntico.
    return { ...fila.respuesta, repetida: true } as unknown as T & { repetida: true };
  }
}
```
(`unwrap` de `common/utils/pg-returning.util`, `instanceToPlain` de `class-transformer`.)
Run el spec → PASS.

- [ ] **Step 6: Módulo y registro**

`idempotencia.module.ts` provee y exporta `IdempotenciaService`. Si `Db` no es global,
importar lo que corresponda: **copiar** cómo lo resuelve `pagos.module.ts`. Registrar
`SolicitudIdempotente` en el array `entities` de `app.module.ts` e importar
`IdempotenciaModule`. Sin la entidad en `entities`, `synchronize` no crea la tabla y **solo el
e2e lo ve** (memoria *entidad-nueva-registrar-en-app-module*).

- [ ] **Step 7: Decorador de cabecera (test primero)**

`clave-idempotencia.decorator.spec.ts`: la fábrica del decorador con un `ExecutionContext`
falso. Cabecera ausente → `BadRequestException`; `'abc'` → `BadRequestException`; un UUID →
lo devuelve. Para testear la fábrica de un `createParamDecorator`, usar el patrón que ya use
algún `*.decorator.spec.ts` del repo, o exportar la función de resolución aparte y testear esa.

```ts
export function resolverClaveIdempotencia(valor: unknown): string {
  if (typeof valor !== 'string' || !isUUID(valor))
    throw new BadRequestException(
      'Falta la cabecera Idempotency-Key, o no es un UUID. Cada intento de cobro manda la suya.',
    );
  return valor;
}

export const ClaveIdempotencia = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    resolverClaveIdempotencia(ctx.switchToHttp().getRequest<Request>().headers['idempotency-key']),
);
```
Los guards de ruta corren antes que los parámetros: sin permiso sigue saliendo 401/403, no 400.

- [ ] **Step 8: Checkpoint**

```bash
cd /Users/m2pro/cmatheus/startup-app/.claude/worktrees/idempotencia-venta/backend
npm run lint:check && npm run typecheck && npx jest src/modules/idempotencia src/common/decorators
```
Expected: exit 0 (mirar el exit code, no la última línea).

### Task 2: `venta.crear`

**Files:**
- Modify: `backend/src/modules/ventas/ventas.controller.ts` (`crear`)
- Modify: `backend/src/modules/ventas/ventas.service.ts` (`crear` y su docblock)
- Modify: `backend/src/modules/ventas/ventas.module.ts` (importar `IdempotenciaModule`)
- Modify: `backend/src/modules/ventas/ventas.service.spec.ts` (el constructor suma un provider)
- Create: `backend/test/idempotencia-venta.e2e-spec.ts`
- Modify: todo spec e2e que haga `POST /api/ventas` (19 archivos medidos el 2026-09-19; se
  vuelven a contar con el grep del Step 5)

**Interfaces — Consumes:** `IdempotenciaService.ejecutar`, `huellaDe`, `@ClaveIdempotencia()`.
**Produces:** `VentasService.crear(tenantId, usuarioId, dto, clave?: string)`.

- [ ] **Step 1: e2e (se escribe ahora y se corre en la Task 5)**

`test/idempotencia-venta.e2e-spec.ts`. Usar el setup de `test/ventas.e2e-spec.ts` (login,
caja abierta, ítem con stock). Cada `.body` que se lee lleva su `expect(res.status)` al lado
(lo exige el pre-commit). Para contar ventas, por SQL directo con el `DataSource` del spec
(`SELECT count(*) FROM ventas WHERE tenant_id = $1 AND eliminado_el IS NULL`), antes y después.
Casos:
1. **Mismo request, misma clave, dos veces** → las dos 201; mismo `id`; la segunda trae
   `repetida: true` y la primera no; el conteo de ventas sube **1**; el stock del ítem bajó
   **una** vez.
2. **Misma clave, otro pago** (otro `metodoPagoId`) → 422, `message` exacto, `ventaId` igual al
   de la primera; el conteo no se mueve.
3. **Sin cabecera** → 400; **cabecera `'no-es-uuid'`** → 400.
4. **Primer intento rechazado** (cantidad mayor al stock → 400) y reintento con **la misma
   clave** y cantidad válida → 201 sin `repetida`.
5. **Misma clave, otro usuario** (crear un segundo usuario con `Ventas:Crear` y caja propia;
   **no** reusar usuarios del seed que otros specs pisan) → 201 sin `repetida`, venta distinta.
6. **Concurrencia**: dos `POST` con la misma clave lanzados con `Promise.all` → los dos 201,
   mismo `id`, exactamente uno con `repetida: true`, conteo +1.
7. **Nivel de aislamiento**: `SHOW transaction_isolation` dentro de un
   `dataSource.transaction` → `read committed`. Si da otra cosa, **parar y reportar**: el
   caso 6 del spec § 6.1 se apoya en esto.

- [ ] **Step 2: Controller**

```ts
@Post()
@RequiresPermiso('Ventas', 'Crear')
@ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID por intento de cobro' })
async crear(
  @Req() req: Request,
  @Body(EscalaMonedaPipe) dto: CreateVentaDto,
  @ClaveIdempotencia() clave: string,
) {
  const u = req.user as JwtUser;
  return this.ventasService.crear(u.tenantId ?? '', u.id, dto, clave);
}
```

- [ ] **Step 3: Service**

En `crear`, dentro del `db.transaccion` del loop, envolver lo que hoy arma
`{ ...venta, boleta }` en un `cobrar = async () => { … }`, y:
```ts
return clave
  ? this.idempotencia.ejecutar(
      { tenantId, usuarioId, clave, operacion: 'venta.crear', huella: huellaDe('venta.crear', dto) },
      cobrar,
      (r) => r.id,
    )
  : cobrar();
```
`clave` opcional **solo** porque `OnlineCallbackHandler` llama sin HTTP (spec § 3.2). Poner el
porqué en el docblock de `crear`, junto al que ya explica el loop de `40P01`. El loop no
cambia: el rollback de un intento con deadlock suelta el reclamo y el siguiente vuelve a
reclamar.

- [ ] **Step 4: Unitarios existentes**

`ventas.service.spec.ts` construye el service a mano o por `Test.createTestingModule`: sumar el
provider de `IdempotenciaService`. Correr **el unitario completo del backend** (`npm test`),
no un subset: un cambio de constructor ya rompió 96 unitarios antes (memoria
*gate-e2e-completo-no-subset*).

- [ ] **Step 5: Barrido de e2e**

```bash
cd /Users/m2pro/cmatheus/startup-app/.claude/worktrees/idempotencia-venta/backend
grep -rnE "post\(['\"\`]/api/ventas['\"\`]\)" test
```
A cada llamada, sumarle `.set('Idempotency-Key', randomUUID())` (`import { randomUUID } from
'node:crypto'`). Una clave **nueva por llamada**: cada `POST` de esos specs es un cobro
distinto. Si algún spec reintenta a propósito, leerlo antes de tocarlo. Volver a correr el
grep con `| grep -v Idempotency` sobre las líneas siguientes para confirmar que no quedó
ninguna. Buscar también helpers que armen el request (p. ej. `test/helpers/`).

### Task 3: `cuenta.cerrar`

**Files:**
- Modify: `backend/src/modules/salones/salones.controller.ts` (`cerrar`)
- Modify: `backend/src/modules/salones/salones.service.ts` (`cerrarCuenta`)
- Modify: `backend/src/modules/salones/salones.module.ts`, `salones.service.spec.ts`
- Modify: `backend/test/idempotencia-venta.e2e-spec.ts` (bloque `describe` del salón)
- Modify: todo spec e2e y helper que haga `POST /api/cuentas/:id/cerrar`

**Produces:** `SalonesService.cerrarCuenta(tenantId, usuarioId, cuentaId, dto, clave: string)`.

- [ ] **Step 1: e2e (se corre en la Task 5)**
  1. Cerrar una cuenta con clave K → 201. Mismo request con K → 201, `repetida: true`, mismo
     `ventaId`, y **no** *"La cuenta no está abierta"*. Una sola venta.
  2. Misma K con otros pagos → 422 con `ventaId`.
  3. Reintento con K y **PIN equivocado** (tótem compartido) → rechazado como hoy, no
     reproducido. La credencial sigue fuera de la transacción (spec § 6.2).
  4. Sin cabecera → 400.
  Crear el garzón del spec: **no** usar a Ana del seed (memoria *e2e-garzon-del-seed-se-pisa*).

- [ ] **Step 2: Controller** — igual que la Task 2: `@ApiHeader` + `@ClaveIdempotencia() clave`
  y pasarla a `cerrarCuenta`.

- [ ] **Step 3: Service**

La resolución del garzón y `assertSesionAbierta` quedan **donde están**, antes de
`db.transaccion`. El **cuerpo entero** del callback de la transacción, desde el `findOne` con
`pessimistic_write`, pasa a ser el `operar` de `ejecutar`. El reclamo tiene que ir **antes**
del `FOR UPDATE` de la cuenta y del chequeo de estado: es lo que convierte el rebote en
reproducción. Huella, armada a mano **sin el PIN**:
```ts
const { pin: _pin, ...cobro } = dto;
const huella = huellaDe('cuenta.cerrar', { cuentaId, ...cobro });
```
Si el lint rechaza la variable descartada, usar la forma que ya use el repo para descartar un
campo. No cambiar la regla de lint. `ventaIdDe: (r) => r.ventaId`.

- [ ] **Step 3b: Unitario de la huella del salón** — en `salones.service.spec.ts`: dos
  cierres con el mismo cobro y **distinto PIN** le pasan a `ejecutar` la **misma** huella, y
  con distinto `garzonId` o distintos pagos, otra. Mutante: sacar la exclusión del `pin` tiene
  que hacerlo fallar.

- [ ] **Step 4: Barrido de e2e**

```bash
grep -rnE "cuentas/.*/cerrar" test | grep -v "caja/"
```
Mismo tratamiento que la Task 2, incluido `test/helpers/caja.ts` si cierra cuentas.
⚠️ `/caja/:id/cerrar` **no** es este endpoint: no se toca.

### Task 4: `pago.abono`

**Files:**
- Modify: `backend/src/modules/pagos/pagos.controller.ts` (`registrarAbono`)
- Modify: `backend/src/modules/pagos/pagos.service.ts` (`registrarAbono`)
- Modify: `backend/src/modules/pagos/pagos.module.ts` y su `*.spec.ts`
- Modify: `backend/test/idempotencia-venta.e2e-spec.ts` (bloque del abono)
- Modify: specs e2e con `POST /api/pagos` (4 archivos medidos el 2026-09-19)

**Produces:** `PagosService.registrarAbono(tenantId, usuarioId, dto, clave: string)`.

- [ ] **Step 1: e2e (se corre en la Task 5)** — sobre una venta `pendiente` de $X:
  1. Abono de $X/2 con K dos veces → las dos 201, la segunda `repetida: true`; en la base hay
     **un** pago; el saldo quedó en $X/2.
  2. Misma K con otro monto → 422 con `ventaId` = la venta abonada.
  3. Sin cabecera → 400.

- [ ] **Step 2: Controller** — igual que las anteriores.

- [ ] **Step 3: Service** — el cuerpo del `db.transaccion` de `registrarAbono` pasa a ser el
  `operar`. El reclamo va antes del `FOR UPDATE` sobre la venta. Huella:
  `huellaDe('pago.abono', dto)` (el DTO no trae credenciales). `ventaIdDe: (r) => r.venta.id`.

- [ ] **Step 4: Barrido** — `grep -rnE "post\(['\"\`]/api/pagos['\"\`]\)" test`, mismo
  tratamiento.

### Task 5: Turno de e2e del backend y mutantes

- [ ] **Step 1: Pedir turno** a la orquestadora y esperar el OK. No arrancar sin él.
- [ ] **Step 2:** `./scripts/reset-db.sh` desde el worktree. Confirmar en los logs del
  contenedor que el backend corre **este** worktree (`synchronize` crea
  `solicitudes_idempotentes`): `\d solicitudes_idempotentes` en psql.
- [ ] **Step 3:** `cd backend && npm run test:e2e -- --testPathPatterns=idempotencia`.
  Expected: todo verde.
- [ ] **Step 4: Mutantes** (revertir, no solo romper; cada uno mata **su** test; después de
  revertir, verificar en los logs la hora del restart del watcher):
  - En `IdempotenciaService.ejecutar`, llamar `operar()` sin reclamar (revertir al código de
    antes) → tienen que fallar los casos 1 y 6 de la venta y el 1 del abono.
  - En `cerrarCuenta`, mover el reclamo **después** del chequeo de estado → tiene que fallar el
    caso 1 del salón (vuelve *"La cuenta no está abierta"*).
  - En `huellaDe`, sacar `ordenar` → **no** tiene que fallar ningún e2e (el mismo cliente manda
    el mismo orden). Lo mata el unitario de la huella. Anotarlo como superviviente del e2e con
    el motivo medido.
- [ ] **Step 5:** `./scripts/reset-db.sh` y `npm run test:e2e` **completo**. Expected: exit 0.
- [ ] **Step 6:** `./scripts/reset-db.sh --verificar`. Soltar el stack y avisar a la
  orquestadora **con la hora**.

---

## Frontend

### Task 6: `useIntentoCobro` y el trato de la respuesta

**Files:**
- Create: `frontend/app/composables/useIntentoCobro.ts`
- Create: `frontend/app/composables/useIntentoCobro.spec.ts`

**Interfaces — Produces:**
```ts
export const AVISO_COBRO_REPETIDO = 'Este cobro ya había entrado, no se registró dos veces'
export const HEADER_IDEMPOTENCIA = 'Idempotency-Key'
/** Estado por pestaña, a nivel de módulo: sobrevive al cierre y la reapertura de un modal. */
export function useIntentoCobro(ambito: string): {
  clave: () => string            // la del intento vigente; la crea en el primer llamado
  cabecera: () => Record<string, string>  // { 'Idempotency-Key': clave() }
  terminar: () => void           // el intento murió (éxito o vaciado)
}
/** El body trae `repetida: true` → toast warning con AVISO_COBRO_REPETIDO. */
export function avisarSiRepetido(res: { repetida?: boolean }, toast: ReturnType<typeof useToast>): void
/** Si el error es el 422 de otros datos, devuelve el ventaId; si no, null. */
export function ventaDeCobroConOtrosDatos(e: unknown): string | null
```
Ámbitos: `'pos'`, `'tienda'`, `` `cuenta:${cuentaId}` ``, `` `abono:${ventaId}` ``.

- [ ] **Step 1: Tests (fallan)** — `clave()` es estable entre llamados; `terminar()` hace que
  el próximo `clave()` sea otra; dos ámbitos no comparten clave; dos `useIntentoCobro` del
  **mismo** ámbito sí (simula cerrar y reabrir el modal); `ventaDeCobroConOtrosDatos` devuelve
  el `ventaId` para un error `{ status: 422, data: { ventaId: 'v1' } }` y `null` para un 422
  sin `ventaId` o un 400; `avisarSiRepetido` llama a `toast.add` solo con `repetida: true`.
- [ ] **Step 2: Implementación** — `Map<string, string>` a nivel de módulo;
  `crypto.randomUUID()`. Mirar cómo `apiErrorMsg` (`utils/api-error.ts`) lee `status`/`data`
  del error de `$fetch` y leerlo igual.
- [ ] **Step 3:** `cd frontend && npx vitest run app/composables/useIntentoCobro.spec.ts` → PASS.

### Task 7: POS y pasarela de la tienda

**Files:**
- Modify: `frontend/app/pages/ventas/pos.vue` (`confirmarCobro`, y donde el carrito queda vacío)
- Modify: `frontend/app/pages/ventas/pos.nuxt.spec.ts`
- Modify: `frontend/app/pages/tienda/pasarela.vue` (`aprobar`, desmontaje)
- Modify: `frontend/app/pages/tienda/pasarela.nuxt.spec.ts`

- [ ] **Step 1: Tests del POS (fallan)** — con el mock de `useApiFetch` (ojo: contesta 200 a
  cualquier body; afirmar que el body mandado es uno que el DTO acepta, memoria
  *mock-de-useapifetch-contesta-200*):
  1. Un primer `POST /ventas` que falla por red y un segundo *Confirmar* mandan **la misma**
     `Idempotency-Key`, aunque entre los dos se cambie el método de pago.
  2. Después de un cobro exitoso, el siguiente cobro manda **otra** clave.
  3. Vaciar el carrito entre dos intentos → otra clave.
  4. Respuesta con `repetida: true` → toast con `AVISO_COBRO_REPETIDO`, boleta impresa y
     carrito limpio (el flujo de éxito entero).
  5. 422 con `ventaId` → toast con acción *Ver venta* que navega a `/ventas?venta=<id>`, y el
     carrito **no** se limpia.
- [ ] **Step 2: `pos.vue`** — `const intento = useIntentoCobro('pos')`; `headers:
  intento.cabecera()` en el `POST`; `intento.terminar()` en el camino de éxito (junto a
  `limpiar()`) y en un `watch` sobre el carrito cuando queda vacío (cubre *Vaciar* y quitar la
  última línea); `avisarSiRepetido(venta, toast)` después del toast de estado. En el `catch`,
  **antes** de `mostrarRechazoPorStock`: si `ventaDeCobroConOtrosDatos(e)` devuelve un id,
  mostrar el toast con la acción *Ver venta* y salir.
- [ ] **Step 3: Tests de la pasarela (fallan)** — misma clave entre dos *Aprobar* con error en
  el medio; con `repetida: true` queda `aprobada` y se ve el aviso; al desmontar la página, la
  próxima visita usa otra clave.
- [ ] **Step 4: `pasarela.vue`** — `useIntentoCobro('tienda')`; `terminar()` en el éxito y en
  `onUnmounted`; mismo trato de `repetida` y del 422.
- [ ] **Step 5:** correr los dos specs → PASS.

### Task 8: Salón

**Files:**
- Modify: `frontend/app/composables/useSalones.ts` (`cerrarCuenta` recibe la clave)
- Modify: `frontend/app/pages/salones/index.vue` (flujo *Cerrar y cobrar*, ~`cerrarCuentaConPin`)
- Modify: `frontend/app/pages/salones/index.nuxt.spec.ts`, `frontend/app/composables/useSalones.spec.ts`

⚠️ Esta pantalla tiene una historia larga de carreras (ver la fila de Salones en
`docs/ESTADO.md`). El modal de cobro **se lleva su cuenta**: la clave sale del `cuentaId`
**congelado** en el modal, nunca de la cuenta activa en pantalla. Leer el flujo entero antes
de tocarlo, y no mover ninguna línea de orden: en este flujo el orden **es** la lógica
(memoria *mover-una-linea-arriba-reabre-el-bug*).

- [ ] **Step 1: Tests (fallan)**
  1. Dos *Confirmar* sobre la misma cuenta con un error de red en el medio mandan la misma
     clave.
  2. Cobrar la cuenta A y después la B → claves distintas.
  3. `repetida: true` → el flujo de éxito del cierre (boleta impresa) más el aviso.
  4. Cancelar o fusionar la cuenta → su clave muere (`terminar()` sobre `cuenta:<id>`).
- [ ] **Step 2:** `useSalones.cerrarCuenta(cuentaId, body, clave)` manda la cabecera. En
  `index.vue`, `useIntentoCobro(\`cuenta:${cuentaCerrada.id}\`)` con el id congelado;
  `terminar()` en el éxito y donde la pantalla ya se entera de que la cuenta dejó de estar
  abierta (cancelar, fusión). Trato de `repetida` y del 422 igual que en el POS.
- [ ] **Step 3:** correr los specs → PASS.

### Task 9: Abono

**Files:**
- Modify: `frontend/app/components/pagos/AbonoModal.vue` (`confirmar`)
- Create: `frontend/app/components/pagos/AbonoModal.nuxt.spec.ts` (patrón de
  `docs/patterns/frontend.md` § 15)

- [ ] **Step 1: Tests (fallan)** — misma clave entre dos *Confirmar* con error en el medio,
  **también cerrando y reabriendo el modal** para la misma venta; otra venta → otra clave;
  éxito → la próxima clave es otra; `repetida: true` → aviso y `emit('success')`; 422 → acción
  *Ver venta*.
- [ ] **Step 2:** `useIntentoCobro(\`abono:${props.ventaId}\`)`, cabecera, `terminar()` en el
  éxito, trato de `repetida` y del 422.
- [ ] **Step 3:** correr el spec → PASS.

### Task 10: Smoke de navegador (Playwright)

**Files:**
- Create: `frontend/e2e/ventas/cobro-repetido.spec.ts`

La única forma honesta de probar "la venta entró pero la respuesta se perdió" es dejar pasar
el request y cortarle la respuesta al navegador:
```ts
await page.route('**/api/ventas', async (route) => {
  if (route.request().method() !== 'POST' || yaCortado) return route.continue()
  yaCortado = true
  await route.fetch()   // llega al backend y crea la venta
  await route.abort()   // el navegador ve un error de red
})
```
- [ ] **Step 1:** Spec del POS: armar carrito, *Cobrar*, confirmar → error visible; confirmar
  de nuevo → toast `AVISO_COBRO_REPETIDO`; en `/ventas` hay **una** venta nueva, no dos. Login
  por `e2e/auth.setup.ts` (memoria *smoke-con-login-via-playwright*).
- [ ] **Step 2:** Mismo patrón sobre *Cerrar y cobrar* del salón, con un garzón y una mesa
  propios del spec.
- [ ] **Step 3:** Se corre en el turno de la Task 11 (necesita el stack).

---

## Verification

### Task 11: Docs, gate completo, revisión y commit

**Files (docs, en el mismo commit que el código):**
- Create: `docs/adr/026-idempotencia-de-cobros.md` + fila en `docs/adr/README.md`
- Modify: `docs/features/ventas.md` (§ `POST /api/ventas`: cabecera, reproducción, 422),
  `docs/features/pagos.md`, `docs/features/salones-mesas.md`, `docs/features/tienda-online.md`
- Modify: `docs/patterns/backend.md` (sección nueva *Operación idempotente*: cuándo usar
  `ejecutar`, que el reclamo va **primero**, que la huella se arma a mano) y
  `docs/patterns/frontend.md` (`useIntentoCobro`: cuándo nace y cuándo muere la clave)
- Modify: `docs/ESTADO.md` (fila nueva) y `docs/agent/pendientes.md` → mover la entrada a
  `docs/agent/resueltos.md` con el detalle del cierre (memoria *pendientes-solo-lo-abierto*).
  La de la nota de crédito **queda** en `pendientes.md` § 6.
- Delete (en el mismo commit): este plan y su spec, según `docs/superpowers/README.md`. El
  conocimiento durable queda en el ADR y en `features/`.
  ⚠️ Antes de borrar, **redirigir al ADR-026 todo link al spec**: la entrada de la nota de
  crédito en `pendientes.md` § 6 lo cita, y el pre-commit rechaza links rotos
  (`grep -rn "2026-09-19-idempotencia-venta" docs`).

- [ ] **Step 1:** Docs. Sin superlativos ni conteos que envejecen (memoria
  *no-escribir-el-superlativo*); los números que queden, medidos al final, con el comando.
- [ ] **Step 2: Pedir turno** a la orquestadora. Con el OK: `./scripts/reset-db.sh`.
- [ ] **Step 3: Gate completo** (exit code de cada uno, no la última línea):
```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
cd frontend && npm run e2e
```
- [ ] **Step 4:** `./scripts/reset-db.sh --verificar`. Soltar el stack y avisar con la hora.
- [ ] **Step 5: Stagear por ruta explícita** (nunca `git add -A`) y revisar
  `git -C <worktree> diff --cached --stat`: no puede haber nada de otra sesión.
- [ ] **Step 6: Revisión independiente** (skill `verify-feature`, paso 7) con
  `domain-reviewer` **y** `api-security-reviewer`: el diff toca controllers, DTO/cabecera y una
  tabla nueva. Pedirle al de seguridad, puntualmente: que la clave de otro usuario no
  reproduce, que el 422 no filtra la venta de otro, que la huella no guarda el PIN y que el 400
  de la cabecera sale **después** de los guards. **No** correr la revisión con el e2e en curso.
  Si bloquea: corregir, **re-stagear** y volver a pedirla.
- [ ] **Step 7: Commit** (sin `--no-verify`), con el trailer de co-autoría.
- [ ] **Step 8: No mergear ni pushear.** Mandarle a la orquestadora: rama, hash (copiado de
  `git log`), gate con conteos por comando, veredicto de las dos revisiones y lo abierto.

## Decisions / Open questions

**Decididas por el owner (2026-09-19):** las seis del spec § 2.

**Decididas en el diseño** (spec § 4–7; se pueden reabrir con evidencia):
- Cabecera obligatoria, no opcional.
- `usuario_id` en la unicidad.
- La respuesta reproducida es la de entonces, no el estado de hoy.
- La credencial del garzón se valida antes del reclamo.

**Abiertas, para medir durante la ejecución (no para preguntar):**
- El nivel de aislamiento real de `db.transaccion` (Task 2, caso 7). Si no es
  `read committed`, **parar**: cambia la mecánica del duplicado concurrente.
- Si `Db` necesita import explícito en `IdempotenciaModule` (Task 1, Step 6).
