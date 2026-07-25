# Motivos de diferencia + cierre en dos fases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El cierre de caja pasa a dos fases (enviar conteo → justificar y finalizar) con un estado intermedio `en_conciliacion`; cada descuadre exige un motivo categorizado; el admin gestiona el catálogo y puede finalizar/corregir.

**Architecture:** Sub-proyecto C del refactor de arqueo (sobre A multi-medio y B ciego, en `main`). Fase 1 (`POST /caja/:id/conteo`, cajero) **congela** esperado/contado/diferencia y, si algo descuadra, deja la caja en `en_conciliacion` revelando la diferencia (si todo cuadra, cierra directo). Fase 2 (`POST /caja/:id/cerrar`, cajero-o-admin) exige motivo por descuadre y finaliza a `cerrada`. Un `PATCH` admin-only corrige motivos sobre cajas ya `cerradas`. El conteo es inmutable desde la fase 1 (anti-fraude: se congela antes de revelar).

**Tech Stack:** NestJS + TypeORM + PostgreSQL 15 (`synchronize` en dev/CI, sin migraciones); Nuxt 4 + Vue 3 + Pinia + Nuxt UI; Decimal.js.

**Spec:** `docs/superpowers/specs/2026-07-24-motivos-diferencia-design.md`

## Base ya implementada en `main` (NO rehacer)

Commits previos de C que se reusan tal cual:
- **Catálogo `motivos-diferencia`** (entidad `MotivoDiferenciaCaja`, módulo CRUD admin-only + lectura abierta, `es_fijo` togglable en `activo`/`requiere_comentario`, helpers `assertMotivoValido`/`hayMotivosActivos`) — registrado en `app.module.ts`.
- **Seed** de los 7 motivos (seeder + `tenants.create`).
- **Columnas** `motivo_diferencia_id` + `comentario_diferencia` en `caja_arqueo_medio`.
- **`obtenerArqueo`** ya trae el motivo por línea (JOIN a `motivo_diferencia_caja`); `LineaArqueo` ya tiene `motivoDiferenciaId?`/`motivoNombre?`/`comentarioDiferencia?`.
- **`justificarDiferencias(tenantId, cajaId, lineas)`** + endpoint **`PATCH /caja/:id/arqueo/motivos`** (`TenantAdminGuard`) — hoy exige caja `cerrada`. Se **reusa como el override del admin**; su lógica de "aplicar motivos a descuadres" se **extrae a un helper** (Task 3).
- **`cerrar`** (tras la reversión FIX-A) hoy: lockea `abierta` → congela el arqueo → fija agregados + `estado='cerrada'` + `fechaCierre`, **sin** motivo. Es la base de la **fase 1**.

## Global Constraints

- **`tenant_id`/`usuario_id` SIEMPRE del token JWT**, nunca del body/query/ruta.
- **Soft delete en todo**: toda SELECT/UPDATE/INSERT nueva respeta `eliminado_el IS NULL`.
- **Dinero con Decimal.js**: una línea descuadra si `!new Decimal(diferencia).isZero()`; nunca `number`.
- **No tocar el sistema JWT, el motor de precios ni `movimientos_inventario`.** La fase 2/override **no** recomputa esperado/contado/diferencia (el hecho congelado en fase 1 es inmutable).
- **Estado `en_conciliacion`** es intermedio: `abierta → en_conciliacion → cerrada` (o `abierta → cerrada` si cuadra). Una caja `en_conciliacion` está **ocupada** (bloquea abrir/ventas/movimientos) pero **congelada**.
- **Autorización:** fase 1 (`/conteo`) owner (`MiCaja:Actualizar`); fase 2 (`/cerrar`) owner **o** admin del tenant; override (`PATCH /arqueo/motivos`) admin-only (`TenantAdminGuard`). El catálogo: escritura `TenantAdminGuard`, lectura abierta.
- **TypeORM+pg:** `INSERT/UPDATE ... RETURNING` vía `dataSource.query` llega como `[rows, rowCount]` — desenvolver (patrón `liquidacion-propinas.service.ts:854`).
- **Trabajo directo sobre `main`** (sin ramas/PR). Commits frecuentes por tarea.

---

## Estructura de archivos

**Backend:**
- Modify: `backend/src/modules/caja/caja.service.ts` — `enviarConteo` (fase 1, ex-`cerrar`); `cerrar` (fase 2, finalize); helper `aplicarMotivosADescuadres`; ajustes de `findActiva`/`abrir`/`cajonesDisponibles`/`cajonesEstado`/lock por `en_conciliacion`.
- Modify: `backend/src/modules/caja/caja.controller.ts` — `POST /:id/conteo`, cambio de `POST /:id/cerrar` (owner-o-admin), el `PATCH` override queda.
- Create: `backend/src/modules/caja/dto/finalizar-cierre.dto.ts` — body de la fase 2 (motivos por línea).
- Modify: `backend/src/modules/caja/dto/cerrar-caja.dto.ts` → renombrar/reusar para la fase 1 (`EnviarConteoDto`), o mantener `CerrarCajaDto` como el del `/conteo`.
- Modify: `backend/src/modules/motivos-diferencia/motivos-diferencia.service.ts` — desenvolver `RETURNING` (create/update).
- Tests: `caja.service.spec.ts`, `caja.controller.spec.ts`, `motivos-diferencia.service.spec.ts`, `backend/test/caja.e2e-spec.ts`, `backend/test/motivos-diferencia.e2e-spec.ts`.

**Frontend:**
- Modify: `frontend/app/stores/caja.ts` — `enviarConteo`, `cerrar` (motivos), `justificarDiferencias`, `motivos`/`cargarMotivos`; tipos.
- Create: `frontend/app/pages/configuracion/motivos-diferencia.vue` + nav.
- Modify: `frontend/app/components/caja/CajaCierreDrawer.vue` — dos fases.
- Modify: `frontend/app/components/caja/CajaArqueoTable.vue` — columna Motivo + override admin.
- Modify: `frontend/app/pages/mi-caja/[id].vue`, `cajas/[id].vue`, `CajaActivaDashboard.vue` — retomar conciliación / estado `en_conciliacion`.

**Docs:** `docs/features/gestion-cajas.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/investigaciones/2026-07-23-gestion-caja.md`, `startup-pos.sql`.

---

### Task 1: Fix del `RETURNING` en el catálogo de motivos

`motivos-diferencia.service` hace `rows[0]` sobre `INSERT/UPDATE ... RETURNING`, que en TypeORM+pg llega como `[rows, rowCount]` → `create`/`update` devuelven campos `undefined`. Desenvolver defensivamente.

**Files:**
- Modify: `backend/src/modules/motivos-diferencia/motivos-diferencia.service.ts` (`create`, `update`)
- Test: `backend/src/modules/motivos-diferencia/motivos-diferencia.service.spec.ts`

- [ ] **Step 1: Test que reproduce el shape `[rows, rowCount]` (falla)**

Agregar en el spec (el mock de `dataSource.query` ya existe):

```ts
  it('create desenvuelve el shape [rows, rowCount] de RETURNING', async () => {
    query.mockResolvedValueOnce([]); // assertNombreUnico
    query.mockResolvedValueOnce([
      [{ motivo_diferencia_id: 'm1', nombre: 'x', activo: true, requiere_comentario: false, es_fijo: false }],
      1,
    ]); // INSERT ... RETURNING → [rows, rowCount]
    const res = await service.create(TENANT, { nombre: 'x' });
    expect(res).toMatchObject({ id: 'm1', nombre: 'x' });
  });

  it('update desenvuelve el shape [rows, rowCount] de RETURNING', async () => {
    query.mockResolvedValueOnce([
      { motivo_diferencia_id: 'm1', nombre: 'x', activo: true, requiere_comentario: false, es_fijo: false },
    ]); // findOneOrFail
    query.mockResolvedValueOnce([
      [{ motivo_diferencia_id: 'm1', nombre: 'x', activo: false, requiere_comentario: false, es_fijo: false }],
      1,
    ]); // UPDATE ... RETURNING → [rows, rowCount]
    const res = await service.update(TENANT, 'm1', { activo: false });
    expect(res).toMatchObject({ id: 'm1', activo: false });
  });
```

- [ ] **Step 2: Ejecutar → fallan**

Run: `cd backend && npm test -- motivos-diferencia.service`
Expected: FAIL (el código toma `rows[0]` = el array interno → campos undefined).

- [ ] **Step 3: Helper de desenvuelto + usarlo en create/update**

En `motivos-diferencia.service.ts`, agregar un helper y aplicarlo a los resultados de los `RETURNING`:

```ts
// TypeORM + pg: INSERT/UPDATE ... RETURNING llega como [rows, rowCount], no como rows.
function unwrap<T>(raw: unknown): T[] {
  return Array.isArray((raw as unknown[])[0])
    ? ((raw as T[][])[0] ?? [])
    : ((raw as T[]) ?? []);
}
```

En `create`: `const rows = unwrap<Row>(await this.dataSource.query(\`INSERT ... RETURNING ${COLS}\`, [...]));` y usar `rows[0]`.
En `update`: `const rows = unwrap<Row>(await this.dataSource.query(\`UPDATE ... RETURNING ${COLS}\`, params));` antes del `if (!rows.length)`.

- [ ] **Step 4: Ejecutar → pasan + gate**

Run: `cd backend && npm run lint:check && npm run typecheck && npm test -- motivos-diferencia`
Expected: verde.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/motivos-diferencia/motivos-diferencia.service.ts \
        backend/src/modules/motivos-diferencia/motivos-diferencia.service.spec.ts
git commit -m "fix(motivos): desenvolver INSERT/UPDATE RETURNING ([rows, rowCount]) en create/update"
```

---

### Task 2: Backend fase 1 (`enviarConteo`) + estado `en_conciliacion` + máquina de estados

Renombra la lógica actual de `cerrar` a **`enviarConteo`** (congela) y agrega la bifurcación auto-cierre / `en_conciliacion`. Hace que la máquina de estados trate `en_conciliacion` como ocupada.

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts` (`cerrar`→base de `enviarConteo`; `findActiva`, `cajonesDisponibles`, `cajonesEstado`, `bloquearCajaAbierta`; `obtenerArqueo` ya cubre `en_conciliacion` por la rama no-`abierta`)
- Modify: `backend/src/modules/caja/caja.controller.ts` (`POST /:id/conteo`)
- Test: `caja.service.spec.ts`, `caja.controller.spec.ts`

**Interfaces:**
- Produces: `enviarConteo(tenantId, usuarioId, cajaId, dto): Promise<{ estado: 'cerrada' | 'en_conciliacion'; arqueo: LineaArqueo[] }>`. Endpoint `POST /caja/:id/conteo`.

- [ ] **Step 1: Tests de `enviarConteo` (fallan)**

En `caja.service.spec.ts`, reemplazar el `describe('cerrar', ...)` actual por `describe('enviarConteo', ...)` con:

```ts
  describe('enviarConteo', () => {
    beforeEach(() => {
      jest.spyOn(service, 'calcularArqueo').mockResolvedValue([
        { metodoPagoId: null, nombre: 'Efectivo', esEfectivo: true, esperado: '1000.0000', requiereConteo: true },
      ]);
    });

    it('todo cuadra → estado cerrada (auto-cierre) + fechaCierre', async () => {
      managerMock.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, usuarioId: USUARIO_ID });
      const res = await service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, {
        lineas: [{ metodoPagoId: null, montoContado: '1000' }],
      } as any);
      expect(res.estado).toBe('cerrada');
      const savedCaja = managerMock.save.mock.calls.find((c) => c[0] === Caja || c[1]?.estado)?.[1] ?? managerMock.save.mock.calls.at(-1)[0];
      expect(savedCaja.estado).toBe('cerrada');
      expect(savedCaja.fechaCierre).toBeInstanceOf(Date);
    });

    it('hay descuadre → estado en_conciliacion, sin fechaCierre', async () => {
      managerMock.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, usuarioId: USUARIO_ID });
      const res = await service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, {
        lineas: [{ metodoPagoId: null, montoContado: '900' }],
      } as any);
      expect(res.estado).toBe('en_conciliacion');
      const savedCaja = managerMock.save.mock.calls.at(-1)[0];
      expect(savedCaja.estado).toBe('en_conciliacion');
      expect(savedCaja.fechaCierre).toBeNull();
    });

    it('la caja debe estar abierta', async () => {
      managerMock.findOne.mockResolvedValueOnce(null);
      await expect(
        service.enviarConteo(TENANT_ID, USUARIO_ID, CAJA_ID, { lineas: [{ metodoPagoId: null, montoContado: '900' }] } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
```

- [ ] **Step 2: Ejecutar → fallan**

Run: `cd backend && npm test -- caja.service`
Expected: FAIL (`enviarConteo` no existe).

- [ ] **Step 3: Renombrar `cerrar`→`enviarConteo` con la bifurcación**

En `caja.service.ts`: renombrar el método `cerrar` (líneas ~571-657) a `enviarConteo`, cambiar su retorno a `Promise<{ estado: 'cerrada' | 'en_conciliacion'; arqueo: LineaArqueo[] }>`, y reemplazar el bloque final de agregados por la bifurcación:

```ts
      // Agregados de cajas = línea de efectivo (cuadre del cajón físico).
      const efectivo = lineasResueltas.find((l) => l.metodoPagoId === null)!;
      caja.saldoFinal = efectivo.esperado;
      caja.montoContado = contadoPorClave.get('EFECTIVO')!;
      caja.diferencia = efectivo.diferencia;
      caja.comentario = dto.comentario ?? null;

      const hayDescuadre = lineasResueltas.some(
        (l) => l.diferencia !== null && !new Decimal(l.diferencia).isZero(),
      );
      if (hayDescuadre) {
        caja.estado = 'en_conciliacion';
        caja.fechaCierre = null;
      } else {
        caja.estado = 'cerrada';
        caja.fechaCierre = new Date();
      }
      await manager.save(Caja, caja);

      return { estado: caja.estado, arqueo: lineasResueltas };
```

(El `dto` sigue siendo `CerrarCajaDto` — el body del conteo: `{ lineas: [{metodoPagoId, montoContado}], comentario? }`. El `bloquearCajaAbierta` y el `estado: 'abierta'` del `findOne` quedan: la fase 1 parte de `abierta`.)

- [ ] **Step 4: `findActiva` incluye `en_conciliacion`**

En `findActiva` (línea ~109), el `where` usa `estado: 'abierta'`. Cambiarlo para incluir `en_conciliacion` (una conciliación pendiente sigue "ocupando" al cajero):

```ts
import { In } from 'typeorm'; // agregar a los imports de typeorm
// ...
    return this.cajaRepo.findOne({
      where: {
        tenantId,
        usuarioId,
        tipo: 'fisica',
        estado: In(['abierta', 'en_conciliacion']),
        eliminadoEl: IsNull(),
      },
    });
```

- [ ] **Step 5: `cajonesDisponibles` y `cajonesEstado` tratan `en_conciliacion` como ocupado**

En `cajonesDisponibles` (la subquery "libre", línea ~159): cambiar `c.estado = 'abierta'` por `c.estado IN ('abierta','en_conciliacion')`. En `cajonesEstado` (LEFT JOIN, línea ~905): cambiar `c.estado = 'abierta'` por `c.estado IN ('abierta','en_conciliacion')`. (El `abrir` usa `findActiva`/la subquery de ocupación con `estado = 'abierta'` en su lock — cambiar también ese `estado = 'abierta'` de la línea ~215 a `IN ('abierta','en_conciliacion')` para que dos aperturas o una conciliación pendiente bloqueen.)

- [ ] **Step 6: Endpoint `POST /:id/conteo`**

En `caja.controller.ts`, cambiar el handler `cerrar` actual (que hoy es `POST /:id/cerrar` y llama `cajaService.cerrar`) por un handler nuevo de conteo, dejando `/cerrar` para la Task 3:

```ts
  @Post(':id/conteo')
  @RequiresPermiso('MiCaja', 'Actualizar')
  enviarConteo(
    @Req() req: Request,
    @Param('id') cajaId: string,
    @Body() dto: CerrarCajaDto,
  ) {
    const u = req.user as JwtUser;
    return this.cajaService.enviarConteo(u.tenantId!, u.id, cajaId, dto);
  }
```

(El handler viejo de `POST /:id/cerrar` se reemplaza en la Task 3. Por ahora podés dejar el de `/cerrar` apuntando temporalmente a `enviarConteo` para que compile, o quitarlo — la Task 3 lo define bien.)

- [ ] **Step 7: Controller spec**

En `caja.controller.spec.ts`: renombrar el mock/uso de `cerrar` a `enviarConteo` donde corresponda al conteo; test de delegación `enviarConteo` con tenant/usuario del token.

- [ ] **Step 8: Ejecutar + gate**

Run: `cd backend && npm run lint:check && npm run typecheck && npm test -- caja`
Expected: verde. (Nota: `justificarDiferencias` y `obtenerArqueo` no se tocan aquí; `obtenerArqueo` ya revela para `en_conciliacion` porque no es `'abierta'`.)

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/caja/caja.service.ts backend/src/modules/caja/caja.controller.ts \
        backend/src/modules/caja/caja.service.spec.ts backend/src/modules/caja/caja.controller.spec.ts
git commit -m "feat(caja): fase 1 enviarConteo (congela + revela) + estado en_conciliacion en la máquina de estados"
```

---

### Task 3: Backend fase 2 (`cerrar` = finalizar) + helper compartido + override

`cerrar` pasa a **finalizar** desde `en_conciliacion` con motivos (owner-o-admin). Extrae el enforcement de motivos de `justificarDiferencias` a un helper compartido por ambos.

**Files:**
- Modify: `backend/src/modules/caja/caja.service.ts` (`cerrar` nuevo; `justificarDiferencias` usa el helper; `bloquearCajaEnConciliacion`)
- Create: `backend/src/modules/caja/dto/finalizar-cierre.dto.ts`
- Modify: `backend/src/modules/caja/caja.controller.ts` (`POST /:id/cerrar` owner-o-admin)
- Test: `caja.service.spec.ts`, `caja.controller.spec.ts`

**Interfaces:**
- Consumes: `assertMotivoValido`/`hayMotivosActivos`.
- Produces: `cerrar(tenantId, usuarioId, cajaId, esAdmin, dto): Promise<{ caja: Caja; arqueo: LineaArqueo[] }>`; private `aplicarMotivosADescuadres(manager, tenantId, cajaId, lineas)`.

- [ ] **Step 1: Extraer el helper `aplicarMotivosADescuadres`**

En `caja.service.ts`, extraer el cuerpo del `for (const l of lineas) { ... }` de `justificarDiferencias` (líneas ~507-563: carga de filas, `difPorClave`, `hayMotivos`, el loop de validación + UPDATE) a un método privado:

```ts
  private async aplicarMotivosADescuadres(
    manager: EntityManager,
    tenantId: string,
    cajaId: string,
    lineas: { metodoPagoId: string | null; motivoDiferenciaId?: string; comentarioDiferencia?: string }[],
  ): Promise<void> {
    const filas: { metodo_pago_id: string | null; diferencia: string | null }[] =
      await manager.query(
        `SELECT metodo_pago_id, diferencia FROM caja_arqueo_medio
         WHERE caja_id = $1 AND eliminado_el IS NULL`,
        [cajaId],
      );
    const claveDe = (id: string | null) => id ?? 'EFECTIVO';
    const difPorClave = new Map(filas.map((f) => [claveDe(f.metodo_pago_id), f.diferencia]));
    const hayMotivos = await this.motivosService.hayMotivosActivos(manager, tenantId);
    for (const l of lineas) {
      const clave = claveDe(l.metodoPagoId);
      const dif = difPorClave.get(clave);
      if (dif == null || new Decimal(dif).isZero()) continue;
      const comentario = l.comentarioDiferencia?.trim() || null;
      let motivoId: string | null = null;
      let comentarioFinal: string | null = null;
      if (hayMotivos) {
        if (!l.motivoDiferenciaId) throw new BadRequestException('Falta el motivo de la diferencia');
        const motivo = await this.motivosService.assertMotivoValido(manager, tenantId, l.motivoDiferenciaId);
        if (motivo.requiereComentario && !comentario) {
          throw new BadRequestException(`El motivo "${motivo.nombre}" exige un comentario`);
        }
        motivoId = motivo.id;
        comentarioFinal = comentario;
      } else {
        if (!comentario) throw new BadRequestException('Falta justificar la diferencia');
        comentarioFinal = comentario;
      }
      await manager.query(
        `UPDATE caja_arqueo_medio SET motivo_diferencia_id = $1, comentario_diferencia = $2
         WHERE caja_id = $3 AND tenant_id = $4
           AND ${l.metodoPagoId === null ? 'metodo_pago_id IS NULL' : 'metodo_pago_id = $5'}
           AND eliminado_el IS NULL`,
        l.metodoPagoId === null
          ? [motivoId, comentarioFinal, cajaId, tenantId]
          : [motivoId, comentarioFinal, cajaId, tenantId, l.metodoPagoId],
      );
    }
  }
```

`justificarDiferencias` (override, sobre `cerrada`) queda: validar `estado === 'cerrada'`, llamar `await this.aplicarMotivosADescuadres(manager, tenantId, cajaId, lineas)`, y devolver `this.obtenerArqueo(...)` como hoy.

- [ ] **Step 2: DTO de la fase 2**

`backend/src/modules/caja/dto/finalizar-cierre.dto.ts` (misma forma que el body de `justificarDiferencias`, reusa `LineaJustificacionDto`):

```ts
import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { LineaJustificacionDto } from './justificar-diferencias.dto';

export class FinalizarCierreDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineaJustificacionDto)
  lineas: LineaJustificacionDto[];
}
```

- [ ] **Step 3: Tests de `cerrar` (fase 2) — fallan**

En `caja.service.spec.ts`, `describe('cerrar (finalizar)', ...)`:

```ts
  describe('cerrar (finalizar desde en_conciliacion)', () => {
    it('400 si la caja no está en_conciliacion', async () => {
      managerMock.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, estado: 'abierta', usuarioId: USUARIO_ID });
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, { lineas: [] } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('un no-owner que no es admin → 403', async () => {
      managerMock.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, estado: 'en_conciliacion', usuarioId: 'otro' });
      await expect(
        service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, { lineas: [] } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('owner finaliza: aplica motivos y pasa a cerrada + fechaCierre', async () => {
      managerMock.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, estado: 'en_conciliacion', usuarioId: USUARIO_ID });
      managerMock.query.mockResolvedValueOnce([{ metodo_pago_id: null, diferencia: '-100.0000' }]); // filas
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      motivosService.assertMotivoValido.mockResolvedValueOnce({ id: 'm1', nombre: 'falta de efectivo', requiereComentario: false });
      managerMock.query.mockResolvedValueOnce(undefined); // UPDATE
      const res = await service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, false, {
        lineas: [{ metodoPagoId: null, motivoDiferenciaId: 'm1' }],
      } as any);
      const savedCaja = managerMock.save.mock.calls.at(-1)[0];
      expect(savedCaja.estado).toBe('cerrada');
      expect(savedCaja.fechaCierre).toBeInstanceOf(Date);
      expect(res.caja.estado).toBe('cerrada');
    });

    it('admin (no owner) puede finalizar', async () => {
      managerMock.findOne.mockResolvedValueOnce({ ...mockCajaAbierta, estado: 'en_conciliacion', usuarioId: 'otro' });
      managerMock.query.mockResolvedValueOnce([{ metodo_pago_id: null, diferencia: '0.0000' }]);
      motivosService.hayMotivosActivos.mockResolvedValueOnce(true);
      const res = await service.cerrar(TENANT_ID, USUARIO_ID, CAJA_ID, true, { lineas: [] } as any);
      expect(res.caja.estado).toBe('cerrada');
    });
  });
```

- [ ] **Step 4: Ejecutar → fallan**

Run: `cd backend && npm test -- caja.service`
Expected: FAIL.

- [ ] **Step 5: `cerrar` (fase 2) + lock de `en_conciliacion`**

Agregar un lock para `en_conciliacion` (variante de `bloquearCajaAbierta`):

```ts
  private async bloquearCajaEnConciliacion(
    manager: EntityManager,
    cajaId: string,
    tenantId: string,
  ): Promise<void> {
    const rows: { caja_id: string }[] = await manager.query(
      `SELECT caja_id FROM cajas
        WHERE caja_id = $1 AND tenant_id = $2
          AND estado = 'en_conciliacion' AND eliminado_el IS NULL
        FOR UPDATE`,
      [cajaId, tenantId],
    );
    if (!rows.length) {
      throw new BadRequestException('La caja no está en conciliación');
    }
  }
```

Nuevo `cerrar`:

```ts
  async cerrar(
    tenantId: string,
    usuarioId: string,
    cajaId: string,
    esAdmin: boolean,
    dto: FinalizarCierreDto,
  ): Promise<{ caja: Caja; arqueo: LineaArqueo[] }> {
    const caja = await this.dataSource.transaction(async (manager) => {
      await this.bloquearCajaEnConciliacion(manager, cajaId, tenantId);
      const caja = await manager.findOne(Caja, {
        where: { id: cajaId, tenantId, estado: 'en_conciliacion', eliminadoEl: IsNull() },
      });
      if (!caja) throw new BadRequestException('La caja no está en conciliación');
      if (caja.usuarioId !== usuarioId && !esAdmin) {
        throw new ForbiddenException('No tienes acceso a esta caja');
      }
      await this.aplicarMotivosADescuadres(manager, tenantId, cajaId, dto.lineas);
      caja.estado = 'cerrada';
      caja.fechaCierre = new Date();
      await manager.save(Caja, caja);
      return caja;
    });
    const { lineas } = await this.obtenerArqueo(tenantId, usuarioId, cajaId, true);
    return { caja, arqueo: lineas };
  }
```

(Si una línea con `diferencia ≠ 0` no trae motivo, `aplicarMotivosADescuadres` lanza 400 y la transacción no finaliza — la caja sigue `en_conciliacion`.)

- [ ] **Step 6: Endpoint `POST /:id/cerrar` owner-o-admin**

En `caja.controller.ts`, el handler `/cerrar` computa `esAdmin` como lo hace `TenantAdminGuard` (leer `backend/src/common/guards/tenant-admin.guard.ts` y espejar su criterio — p. ej. `req.user.esSuperadmin` o el rol admin del tenant vía rbac). Sin `TenantAdminGuard` en la ruta (el owner no-admin también entra); usar `@RequiresPermiso('MiCaja','Actualizar')` para el piso de permiso:

```ts
  @Post(':id/cerrar')
  @RequiresPermiso('MiCaja', 'Actualizar')
  async cerrar(@Req() req: Request, @Param('id') cajaId: string, @Body() dto: FinalizarCierreDto) {
    const u = req.user as JwtUser;
    const esAdmin = await this.rbacService.userEsAdminTenant(u.id, u.tenantId!); // o el criterio de TenantAdminGuard
    return this.cajaService.cerrar(u.tenantId!, u.id, cajaId, esAdmin, dto);
  }
```

Si no existe un método de "es admin del tenant" reutilizable, usar el mismo que `TenantAdminGuard` (mirar el guard); documentar en el reporte cuál se usó.

- [ ] **Step 7: Ejecutar + gate + commit**

Run: `cd backend && npm run lint:check && npm run typecheck && npm test -- caja`
Expected: verde.

```bash
git add backend/src/modules/caja/caja.service.ts backend/src/modules/caja/caja.controller.ts \
        backend/src/modules/caja/dto/finalizar-cierre.dto.ts \
        backend/src/modules/caja/caja.service.spec.ts backend/src/modules/caja/caja.controller.spec.ts
git commit -m "feat(caja): fase 2 cerrar finaliza en_conciliacion con motivos (owner-o-admin) + helper compartido con override"
```

---

### Task 4: E2E — flujo de dos fases + override

**Files:**
- Modify: `backend/test/caja.e2e-spec.ts`, `backend/test/motivos-diferencia.e2e-spec.ts`

- [ ] **Step 1: Migrar los cierres existentes al flujo de dos fases**

En `caja.e2e-spec.ts`, todo lugar que hoy hace `POST /api/caja/:id/cerrar` con `{ lineas: [{metodoPagoId, montoContado}] }` debe: (a) `POST /api/caja/:id/conteo` con ese body; (b) si la respuesta `estado==='en_conciliacion'`, `POST /api/caja/:id/cerrar` con `{ lineas: [{metodoPagoId, motivoDiferenciaId?}] }`. Cuando el conteo cuadra (`montoContado` = esperado), la respuesta viene `estado==='cerrada'` y no hace falta fase 2. Helper local sugerido:

```ts
async function cerrarEnDosFases(cajaId: string, token: string, contadas: any[], justificar?: any[]) {
  const c = await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/conteo`).set('Authorization', `Bearer ${token}`).send({ lineas: contadas });
  if (c.body.estado === 'en_conciliacion') {
    return request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`).set('Authorization', `Bearer ${token}`).send({ lineas: justificar ?? [] });
  }
  return c;
}
```

- [ ] **Step 2: Casos nuevos del flujo dos fases**

- **Auto-cierre:** conteo que cuadra → `estado==='cerrada'` directo.
- **Normal con descuadre:** conteo con contado ≠ esperado → `en_conciliacion`; `POST /cerrar` sin motivo (habiendo motivos activos) → 400; con `motivoDiferenciaId` válido → 201/200 y el `GET /arqueo` muestra `motivoNombre`.
- **Ciego:** `arqueo_ciego=true` (restaurar en `finally`); `POST /conteo` responde sin `esperado` en las líneas obligatorias mientras la caja estaba abierta —pero como el conteo ya se envió y pasa a `en_conciliacion`, el `GET /arqueo` posterior sí revela; finalizar con motivo.
- **Admin finaliza ajena:** cajero A deja una caja en `en_conciliacion`; el admin la finaliza (`POST /cerrar`) → 200.
- **Override:** sobre una caja `cerrada`, `PATCH /api/caja/:id/arqueo/motivos` por no-admin → 403, por admin → 200.

- [ ] **Step 3: E2E del CRUD (si no está)**

`motivos-diferencia.e2e-spec.ts`: `GET` abierto (200), `POST`/`PATCH`/`DELETE` por no-admin → 403, por admin → 201/200/204; fijo: rename→400, activo→200, delete→400.

- [ ] **Step 4: Ejecutar + commit**

Run: `cd backend && npm run test:e2e -- caja motivos-diferencia`
Expected: las suites de caja y motivos verdes (fallos ajenos por polución de stock no son regresión — verdad = CI). Si una caja huérfana `abierta`/`en_conciliacion` bloquea un `abrir`, cerrarla vía la app (conteo cuadrado → cerrar), no por SQL directo.

```bash
git add backend/test/caja.e2e-spec.ts backend/test/motivos-diferencia.e2e-spec.ts
git commit -m "test(caja): e2e del cierre en dos fases + auto-cierre + admin finaliza + override"
```

---

### Task 5: Frontend store — dos fases + motivos

**Files:**
- Modify: `frontend/app/stores/caja.ts`

**Interfaces:**
- Produces: `MotivoDiferencia { id, nombre, activo, requiereComentario, esFijo }`; `motivos`, `cargarMotivos(soloActivas?)`; `enviarConteo(cajaId, payload): Promise<{ estado, arqueo }>`; `cerrar(cajaId, { lineas }): Promise<{ caja, arqueo }>`; `justificarDiferencias(cajaId, lineas)`. `ArqueoLinea` + `motivoDiferenciaId?`/`motivoNombre?`/`comentarioDiferencia?`. `Caja.estado` admite `'en_conciliacion'`.

- [ ] **Step 1: Tipos + acciones**

En `stores/caja.ts`: agregar los campos de motivo a `ArqueoLinea`; el tipo `MotivoDiferencia` + estado `motivos` + `cargarMotivos(soloActivas)`. Reescribir el flujo de cierre:

```ts
  async function enviarConteo(
    cajaId: string,
    payload: { lineas: { metodoPagoId: string | null, montoContado: string }[], comentario?: string },
  ): Promise<{ estado: string, arqueo: ArqueoLinea[] }> {
    const res = await useApiFetch<{ estado: string, arqueo: ArqueoLinea[] }>(
      `${config.public.apiUrl}/caja/${cajaId}/conteo`, { method: 'POST', body: payload },
    )
    arqueo.value = res.arqueo
    if (res.estado === 'cerrada') { resumenTurno.value = null; activa.value = null }
    return res
  }

  async function cerrar(
    cajaId: string,
    payload: { lineas: { metodoPagoId: string | null, motivoDiferenciaId?: string, comentarioDiferencia?: string }[] },
  ): Promise<{ caja: Caja, arqueo: ArqueoLinea[] }> {
    const res = await useApiFetch<{ caja: Caja, arqueo: ArqueoLinea[] }>(
      `${config.public.apiUrl}/caja/${cajaId}/cerrar`, { method: 'POST', body: payload },
    )
    resumenTurno.value = null; activa.value = null
    return res
  }
```

Mantener `justificarDiferencias` (override) apuntando a `PATCH /caja/:id/arqueo/motivos`. Exponer todo en el `return`.

- [ ] **Step 2: Gate + commit**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: verde.

```bash
git add frontend/app/stores/caja.ts
git commit -m "feat(caja): store en dos fases (enviarConteo + cerrar con motivos) + motivos"
```

---

### Task 6: Frontend — página de configuración de motivos

**Files:**
- Create: `frontend/app/pages/configuracion/motivos-diferencia.vue`
- Modify: el nav de Configuración (junto a "Causas de merma")

- [ ] **Step 1: Página** espejando `configuracion/causas-merma.vue`, con: el switch `requiereComentario` (en la tabla y el drawer); un `es_fijo` **permite** togglear `activo`/`requiereComentario` pero **no** renombrar (input `nombre` disabled si fijo) ni eliminar (botón disabled si fijo). Endpoint base `/motivos-diferencia`. Título "Motivos de diferencia", descripción "Tipifica por qué descuadra una caja al cerrar. Los fijos no se renombran ni se eliminan; podés activarlos/desactivarlos."

- [ ] **Step 2: Link en el nav** de Configuración (buscar "Causas de merma", agregar "Motivos de diferencia" análogo).

- [ ] **Step 3: Gate + commit**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`

```bash
git add frontend/app/pages/configuracion/motivos-diferencia.vue frontend/app
git commit -m "feat(motivos): página de configuración de motivos de diferencia"
```

---

### Task 7: Frontend — drawer en dos fases + retomar conciliación + override

**Files:**
- Modify: `frontend/app/components/caja/CajaCierreDrawer.vue`, `CajaArqueoTable.vue`, `CajaActivaDashboard.vue`, `pages/mi-caja/[id].vue`, `pages/cajas/[id].vue`

- [ ] **Step 1: Drawer dos fases**

`CajaCierreDrawer.vue`: estado local `fase: 'conteo' | 'conciliacion'`. En `conteo` (como hoy: contados por línea, ciego respeta B), el botón principal es **"Enviar conteo"** → `cajaStore.enviarConteo`. Si la respuesta `estado==='cerrada'` → toast + cerrar el drawer + (si aplica) redirect como B. Si `estado==='en_conciliacion'` → `cargarMotivos(true)` y pasar a `fase='conciliacion'`: mostrar las líneas reveladas (`cajaStore.arqueo`) y, por cada una con `diferencia ≠ 0`, un `USelect` de motivos + comentario (obligatorio si el motivo `requiereComentario` o no hay motivos). Botón **"Confirmar cierre"** → `cajaStore.cerrar(cajaId, { lineas })` con los motivos. El drawer también acepta **abrir directo en `fase='conciliacion'`** cuando la caja ya está `en_conciliacion` (retomar): en ese caso `cargarArqueo` + `cargarMotivos` y saltear la fase de conteo.

- [ ] **Step 2: Retomar desde el detalle/dashboard**

`CajaActivaDashboard.vue` / `mi-caja/[id].vue`: si `caja.estado==='en_conciliacion'`, en vez de "Cerrar caja" mostrar **"Continuar conciliación"** que abre el drawer en `fase='conciliacion'`. Una caja `en_conciliacion` no permite movimientos (ocultar/deshabilitar "+ Movimiento").

- [ ] **Step 3: Override admin en el detalle (caja cerrada)**

`CajaArqueoTable.vue`: columna "Motivo" (nombre + comentario, o "Sin justificar" si `diferencia ≠ 0` sin motivo). Props `puedeJustificar?: boolean` (= `perms.esAdmin`) + `cajaId?`. Si `puedeJustificar` y la caja está `cerrada` con líneas sin justificar (o para corregir), selector inline de motivo/comentario + "Guardar" → `cajaStore.justificarDiferencias(cajaId, [...])`. Pasar `:puede-justificar="perms.esAdmin"` y `:caja-id` desde `mi-caja/[id].vue` y `cajas/[id].vue`.

- [ ] **Step 4: Gate (+ smoke queda para el cierre) + commit**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`

```bash
git add frontend/app/components/caja/CajaCierreDrawer.vue frontend/app/components/caja/CajaArqueoTable.vue \
        frontend/app/components/caja/CajaActivaDashboard.vue frontend/app/pages/mi-caja/[id].vue frontend/app/pages/cajas/[id].vue
git commit -m "feat(caja): drawer de cierre en dos fases + retomar conciliación + override admin en detalle"
```

---

### Task 8: Docs + `startup-pos.sql`

**Files:** `startup-pos.sql`, `docs/features/gestion-cajas.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/investigaciones/2026-07-23-gestion-caja.md`.

- [ ] **Step 1: SQL** — tabla `motivo_diferencia_caja` (+ índice único) y las 2 columnas en `caja_arqueo_medio` (si no estaban ya); comentar el estado `en_conciliacion` en la tabla `cajas`.
- [ ] **Step 2: `gestion-cajas.md`** — cierre en dos fases + estado `en_conciliacion` (fase 1 congela+revela / fase 2 justifica+finaliza / auto-cierre si cuadra), catálogo de motivos admin-only, override admin, red de seguridad. Diferidos: over/short, umbral.
- [ ] **Step 3: `ESTADO.md` + pendientes + investigación** — marcar C hecho (conciliación en dos fases); §6 diferido; anotar en `pendientes.md` el gotcha de `RETURNING` en `causas-merma.service`.
- [ ] **Step 4: check-docs-links + commit**

```bash
git add startup-pos.sql docs/features/gestion-cajas.md docs/ESTADO.md docs/agent/pendientes.md docs/agent/investigaciones/2026-07-23-gestion-caja.md
git commit -m "docs(caja): cierre en dos fases + motivos de diferencia (sub-proyecto C)"
```

---

## Cierre del sub-proyecto (tras Task 8)

Gate completo:

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

**Smoke navegador** (rebuild): config de motivos; cierre normal en dos pasos (enviar conteo → conciliación con motivo → finalizar); conteo que cuadra → cierre directo; ciego (sin esperado en fase 1, revelado en conciliación); retomar una conciliación pendiente; override admin sobre caja cerrada. Consola sin errores.

## Self-Review (cobertura del plan vs. spec)

- **Estado `en_conciliacion` + ocupación** (findActiva/abrir/cajones): Task 2. ✓
- **Fase 1 `POST /conteo` (congela, auto-cierra o `en_conciliacion`)**: Task 2. ✓
- **Fase 2 `POST /cerrar` (owner-o-admin, motivos, finaliza)** + helper compartido: Task 3. ✓
- **Override `PATCH` admin sobre `cerrada`** (reusa el helper): Task 3 (base ya en main). ✓
- **Catálogo CRUD + `RETURNING` fix**: base en main + Task 1. ✓
- **Columnas + `obtenerArqueo` con motivo**: base en main (revela en `en_conciliacion` por rama no-`abierta`). ✓
- **Frontend dos fases + retomar + override + config**: Tasks 5, 6, 7. ✓
- **Seed**: base en main. ✓
- **Testing** unit + e2e + smoke: Tasks 1-4 + cierre. ✓
- **Docs + SQL**: Task 8. ✓

Consistencia de tipos: `enviarConteo → { estado, arqueo }` (Task 2) ≡ store (Task 5). `cerrar(tenantId, usuarioId, cajaId, esAdmin, FinalizarCierreDto)` (Task 3) ≡ controller (Task 3). `aplicarMotivosADescuadres` compartido por `cerrar` y `justificarDiferencias` (Task 3). `ArqueoLinea`/`MotivoDiferencia` idénticos back↔front.
