# Papelera — restaurar entidades eliminadas: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un admin pueda ver lo que borró y restaurarlo, en 16 entidades de catálogo y config, sabiendo quién lo borró.

**Architecture:** No hay papelera central ni tabla paralela: cada listado existente acepta incluir los eliminados y cada recurso gana `POST /<recurso>/:id/restaurar` con el mismo guard que su `DELETE`. Se lee la tabla real, así que nada puede desincronizarse. Se agrega `eliminado_por` para el "quién".

**Tech Stack:** NestJS + TypeORM (Postgres 15), Nuxt 4 + Nuxt UI. Jest (unit + e2e supertest), Vitest + Playwright en frontend.

**Spec:** `docs/superpowers/specs/2026-07-31-papelera-restaurar-eliminados-design.md`

## Global Constraints

- `tenant_id` sale **siempre** del token, nunca del body/query/param.
- Soft delete en todo: nunca `DELETE` físico. Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`.
- Guards con enforcement real en backend. **El guard de `restaurar` es el mismo que el del `DELETE` del mismo recurso** — propio o heredado del `@Controller`. Nunca el del `GET`.
- Nunca una query por iteración (N+1): el nombre de quien borró sale por `JOIN` en la misma query.
- `type: 'uuid'` explícito en toda PK/FK (ADR-004, lo fuerza `uuid-columns.invariant.spec.ts`).
- Se trabaja y commitea **directo sobre `main`**. Sin ramas, sin PRs.
- Gate obligatorio antes de cada commit: `cd backend && npm run lint:check && npm run typecheck && npm test`; `./scripts/reset-db.sh` **inmediatamente** antes de `npm run test:e2e` completo; `cd frontend && npm run build && npx vitest run && npm run typecheck:ratchet && npm run design:check`.
- Cierre de cada task: sub-agente `domain-reviewer` sobre el diff staged + recibo `git diff --cached | git hash-object --stdin > .git/verify-feature.receipt`.
- Todo fix lleva test, y el test lleva **mutante verificado revirtiendo al código anterior** (nunca un `throw`).
- El proyecto **no tiene datos productivos**: se cambia el esquema, se actualiza el seeder y se resetea. No se diseñan backfills ni migraciones incrementales.
- `synchronize: true` sigue activo: el esquema real lo generan las entities. `startup-pos.sql` es documentación y se actualiza igual, en el mismo commit.

---

## Las 16 entidades del alcance

Medido el 2026-07-31. La columna **Familia** decide cómo se escribe `eliminado_por`; la columna **Colateral** marca las dos que borran hijos.

| Módulo | Entity | Tabla | Familia de borrado | Colateral | Nombre único |
|---|---|---|---|---|---|
| categorias | `Categoria` | `categorias` | `softDelete()` | — | no |
| descuentos | `Descuento` | `descuentos` | `softDelete()` | — | no |
| recargos | `Recargo` | `recargos` | `softDelete()` | — | no |
| impuestos | `Impuesto` | `impuestos` | `softDelete()` | — | no |
| terceros | `Tercero` | `terceros` | `softDelete()` | — | no |
| cajones | `Cajon` | `cajones` | `softDelete()` | — | sí |
| garzones | `Garzon` | `garzones` | `softDelete()` | — | no |
| turnos | `Turno` | `turnos` | `softDelete()` | — | no |
| impresoras | `Impresora` | `impresoras` | `softDelete()` | — | no |
| salones | `Salon` | `salones` | `softDelete()` | **mesas** | no |
| salones | `Mesa` | `mesas` | `softDelete()` | — | no |
| grupos-modificadores | `GrupoModificador` | `grupos_modificadores` | SQL crudo | — | sí |
| mermas | `CausaMerma` | `causas_merma` | SQL crudo | — | sí |
| motivos-diferencia | `MotivoDiferenciaCaja` | `motivo_diferencia_caja` | SQL crudo | — | sí |
| motivos-diferencia-inventario | `MotivoDiferenciaInventario` | `motivo_diferencia_inventario` | SQL crudo | — | sí |
| items | `Item` | `items` | SQL crudo | **receta_extras_permitidos** | no |

**`items` es además la única que hace `activo = false` al borrar** (`items.service.ts:1774`), y por eso la única que se restaura inactiva.

---

## Estructura de archivos

- `src/common/dto/query-incluir-eliminados.dto.ts` — **crear**. DTO compartido del query param. Un solo lugar para el nombre y la coerción del booleano; si estuviera duplicado en 16 controllers, 16 lugares podrían discrepar.
- `src/common/invariants/eliminado-por.invariant.spec.ts` — **crear**. Fija que las 16 entities del alcance declaren la columna.
- `src/modules/<módulo>/entities/*.entity.ts` — **modificar**. Columna `eliminadoPor`.
- `src/modules/<módulo>/<módulo>.service.ts` — **modificar**. `remove()` escribe `eliminado_por`; se agrega `restaurar()`; `findAll()` acepta incluir eliminados.
- `src/modules/<módulo>/<módulo>.controller.ts` — **modificar**. Endpoint `POST :id/restaurar`.
- `frontend/app/composables/usePapelera.ts` — **crear** (Task 7). Estado del toggle y la llamada a restaurar, compartidos por los listados.
- `startup-pos.sql` — **modificar**. Documentación del esquema.

---

### Task 1: La columna `eliminado_por` en las 16 entities

Sin conducta todavía: que la columna exista y esté fijada por un test. Separada porque es un cambio mecánico y uniforme que un reviewer puede aprobar o rechazar entero, sin mezclarlo con la lógica de restaurar.

**Files:**
- Modify: las 16 `*.entity.ts` de la tabla de arriba
- Modify: `startup-pos.sql`
- Create: `backend/src/common/invariants/eliminado-por.invariant.spec.ts`

**Interfaces:**
- Produces: propiedad `eliminadoPor: string | null` en las 16 entities, mapeada a la columna `eliminado_por`.

- [ ] **Step 1: Escribir el test que falla**

Crear `backend/src/common/invariants/eliminado-por.invariant.spec.ts`. Sigue el patrón de `uuid-columns.invariant.spec.ts`: importar las entities registra sus columnas en el storage global de TypeORM, sin conexión a BD.

```ts
import { getMetadataArgsStorage } from 'typeorm';

// Invariante de la papelera: toda entidad restaurable declara quién la borró.
// Sin `eliminado_por` la papelera muestra el "quién" vacío y degrada en silencio
// — no falla nada, simplemente deja de informar. Ver la spec del 2026-07-31.
import { Categoria } from '../../modules/categorias/entities/categoria.entity';
import { Descuento } from '../../modules/descuentos/entities/descuento.entity';
import { Recargo } from '../../modules/recargos/entities/recargo.entity';
import { Impuesto } from '../../modules/impuestos/entities/impuesto.entity';
import { Tercero } from '../../modules/terceros/entities/tercero.entity';
import { Cajon } from '../../modules/cajones/entities/cajon.entity';
import { Garzon } from '../../modules/garzones/entities/garzon.entity';
import { Turno } from '../../modules/turnos/entities/turno.entity';
import { Impresora } from '../../modules/impresoras/entities/impresora.entity';
import { Salon } from '../../modules/salones/entities/salon.entity';
import { Mesa } from '../../modules/salones/entities/mesa.entity';
import { GrupoModificador } from '../../modules/grupos-modificadores/entities/grupo-modificador.entity';
import { CausaMerma } from '../../modules/mermas/entities/causa-merma.entity';
import { MotivoDiferenciaCaja } from '../../modules/motivos-diferencia/entities/motivo-diferencia-caja.entity';
import { MotivoDiferenciaInventario } from '../../modules/motivos-diferencia-inventario/entities/motivo-diferencia-inventario.entity';
import { Item } from '../../modules/items/entities/item.entity';

const RESTAURABLES = [
  Categoria, Descuento, Recargo, Impuesto, Tercero, Cajon, Garzon, Turno,
  Impresora, Salon, Mesa, GrupoModificador, CausaMerma,
  MotivoDiferenciaCaja, MotivoDiferenciaInventario, Item,
];

describe('Invariante papelera: eliminado_por en toda entidad restaurable', () => {
  it('las 16 entidades del alcance declaran eliminado_por como uuid nullable', () => {
    const faltantes = RESTAURABLES.filter((target) => {
      const col = getMetadataArgsStorage().columns.find(
        (c) =>
          c.target === target &&
          ((c.options as { name?: string }).name ?? c.propertyName) ===
            'eliminado_por',
      );
      if (!col) return true;
      const o = col.options as { type?: unknown; nullable?: boolean };
      return o.type !== 'uuid' || o.nullable !== true;
    }).map((t) => t.name);

    expect(faltantes).toEqual([]);
  });

  it('el alcance es de 16 entidades', () => {
    // Si este número cambia, la spec cambió: actualizar ambos a la vez.
    expect(RESTAURABLES).toHaveLength(16);
  });
});
```

Los paths exactos de import se confirman con `ls src/modules/<módulo>/entities/`.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx jest src/common/invariants/eliminado-por.invariant.spec.ts`
Expected: FAIL — `faltantes` lista las 16.

- [ ] **Step 3: Agregar la columna a las 16 entities**

En cada una, junto a `eliminadoEl`:

```ts
  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
```

Sin `@ManyToOne` a `Usuario`: la papelera necesita el nombre, y ese `JOIN` se resuelve en la query del listado. Una relación acá invitaría a cargar el usuario por fila (N+1).

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npx jest src/common/invariants/eliminado-por.invariant.spec.ts`
Expected: PASS

- [ ] **Step 5: Verificar el mutante**

Quitar la columna de UNA entity (por ejemplo `Turno`), correr el test: debe fallar nombrando `Turno`. Restaurarla.

- [ ] **Step 6: Documentar la columna en `startup-pos.sql`**

En las 16 tablas, junto a `"eliminado_el"`:

```sql
  "eliminado_por"          UUID          REFERENCES usuarios("usuario_id"),
```

- [ ] **Step 7: Gate + revisión + commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
cd .. && ./scripts/reset-db.sh && cd backend && npm run test:e2e
```

Revisión con `domain-reviewer` sobre el diff staged, recibo, y:

```bash
git add -A && git commit -m "feat(papelera): columna eliminado_por en las 16 entidades restaurables"
```

---

### Task 2: Categorías end-to-end — el patrón de la familia `softDelete()`

La entidad de referencia: familia TypeORM, sin nombre único, sin colaterales. Lo que salga de acá se replica.

**Files:**
- Create: `backend/src/common/dto/query-incluir-eliminados.dto.ts`
- Modify: `backend/src/modules/categorias/categorias.service.ts`
- Modify: `backend/src/modules/categorias/categorias.controller.ts`
- Test: `backend/src/modules/categorias/categorias.service.spec.ts`

**Interfaces:**
- Consumes: `Categoria.eliminadoPor` (Task 1).
- Produces: el contrato que replican las tasks 3-6 —
  - `remove(tenantId: string, usuarioId: string, id: string): Promise<void>`
  - `restaurar(tenantId: string, id: string): Promise<Categoria>`
  - `findAll(tenantId: string, incluirEliminados?: boolean): Promise<CategoriaConAuditoria[]>`
  - `QueryIncluirEliminadosDto` con la propiedad `incluirEliminados?: boolean`.

  `eliminadoPorNombre` es **opcional** en el tipo de retorno, no requerido: la ruta sin
  el flag devuelve el array de `find()` tal cual, sin tocarlo, para que ninguna pantalla
  actual cambie de comportamiento ni de identidad de referencia.

- [ ] **Step 1: Crear el DTO compartido del query param**

```ts
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Query param compartido por todos los listados de la papelera. Vive en
 * `common/` y no en cada módulo porque el nombre del param es contrato: si
 * cada controller lo escribiera por su cuenta, dos podrían discrepar y la
 * pantalla llamaría a uno con el nombre del otro, sin error visible.
 */
export class QueryIncluirEliminadosDto {
  // El query string trae 'true'/'false' como texto: sin este Transform,
  // @IsBoolean rechaza siempre y el param queda inutilizable.
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  incluirEliminados?: boolean;
}
```

- [ ] **Step 2: Escribir los tests que fallan**

En `categorias.service.spec.ts` (crear el archivo si no existe, siguiendo el patrón de `descuentos.service.spec.ts`):

```ts
  it('remove() registra quién borró', async () => {
    await service.remove(TENANT_ID, USUARIO_ID, CATEGORIA_ID);

    // Una sola escritura: eliminado_por y eliminado_el no pueden quedar a medias.
    expect(repo.update).toHaveBeenCalledWith(
      { id: CATEGORIA_ID, tenantId: TENANT_ID },
      expect.objectContaining({ eliminadoPor: USUARIO_ID }),
    );
  });

  it('restaurar() devuelve la categoría y no toca `activo`', async () => {
    // `categorias.remove()` nunca pisó `activo`, así que el valor previo
    // sobrevivió: forzarlo destruiría información que el borrado respetó.
    const restaurada = await service.restaurar(TENANT_ID, CATEGORIA_ID);

    expect(repo.restore).toHaveBeenCalledWith({
      id: CATEGORIA_ID,
      tenantId: TENANT_ID,
    });
    expect(restaurada.activo).toBe(false);
  });

  it('restaurar() algo que no existe es 404', async () => {
    repo.findOne.mockResolvedValueOnce(null);

    await expect(service.restaurar(TENANT_ID, CATEGORIA_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.restore).not.toHaveBeenCalled();
  });

  it('restaurar() una categoría VIVA (no eliminada) es 404', async () => {
    repo.findOne.mockResolvedValueOnce({
      id: CATEGORIA_ID,
      tenantId: TENANT_ID,
      eliminadoEl: null,
    });

    await expect(service.restaurar(TENANT_ID, CATEGORIA_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.restore).not.toHaveBeenCalled();
  });

  it('findAll() sin el flag no devuelve eliminados', async () => {
    await service.findAll(TENANT_ID);

    expect(repo.find).toHaveBeenCalledWith(
      expect.not.objectContaining({ withDeleted: true }),
    );
  });
```

**Los dos últimos tests parecen el mismo y no lo son** — corregido el 2026-07-31 después de que la Task 2 lo descubriera. La versión original de este plan tenía solo el de `findOne → null`, y **no cazaba su propio mutante**: con `findOne` devolviendo `null`, el `|| !categoria.eliminadoEl` nunca se ejecuta, así que sacarlo no rompía nada y el test pasaba igual. El caso de la fila **viva** es el único que ejercita esa rama. Copiarlos los dos a los recursos de la Task 6, no uno.

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `cd backend && npx jest src/modules/categorias/categorias.service.spec.ts`
Expected: FAIL — `restaurar is not a function`, y `remove` recibe 2 args, no 3.

- [ ] **Step 4: Implementar en el service**

```ts
  async findAll(
    tenantId: string,
    incluirEliminados = false,
  ): Promise<Categoria[]> {
    if (!incluirEliminados) {
      return this.categoriaRepo.find({
        where: { tenantId },
        order: { nombre: 'ASC' },
      });
    }
    // El nombre de quien borró sale por JOIN en la misma query: una consulta
    // por fila sería N+1 sobre un listado que puede tener cientos.
    // `getMany()` descarta los `addSelect` que no mapean a una columna de la
    // entity, así que hay que usar `getRawAndEntities()` y fusionar a mano.
    const { entities, raw } = await this.categoriaRepo
      .createQueryBuilder('c')
      .leftJoin('usuarios', 'u', 'u.usuario_id = c.eliminado_por')
      .addSelect('u.nombre_usuario', 'c_eliminado_por_nombre')
      .where('c.tenant_id = :tenantId', { tenantId })
      .withDeleted()
      .orderBy('c.nombre', 'ASC')
      .getRawAndEntities<{ c_eliminado_por_nombre: string | null }>();

    return entities.map((categoria, i) => ({
      ...categoria,
      eliminadoPorNombre: raw[i].c_eliminado_por_nombre,
    }));
  }

  async remove(
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
    const categoria = await this.categoriaRepo.findOne({
      where: { id, tenantId },
    });
    if (!categoria) {
      throw new NotFoundException(`Categoría ${id} no encontrada`);
    }
    // Una sola escritura en vez de `update` + `softDelete`: dos sentencias
    // sueltas pueden quedar a medias y dejar una fila borrada sin autor.
    await this.categoriaRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  async restaurar(tenantId: string, id: string): Promise<Categoria> {
    // Una sola regla para los dos casos —no existe, o existe y está viva—:
    // `eliminadoEl` no nulo es lo que define "está en la papelera".
    const categoria = await this.categoriaRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!categoria || !categoria.eliminadoEl) {
      throw new NotFoundException(`Categoría ${id} no está en la papelera`);
    }
    await this.categoriaRepo.restore({ id, tenantId });
    return this.categoriaRepo.findOneOrFail({ where: { id, tenantId } });
  }
```

`restore()` limpia `eliminado_el`. `eliminado_por` se deja como está: es el registro de quién la borró aquella vez, no un campo de estado.

- [ ] **Step 5: Implementar el endpoint**

En `categorias.controller.ts`. El `DELETE` tiene `@UseGuards(TenantAdminGuard)` propio, así que `restaurar` lleva el mismo.

```ts
  @Get()
  findAll(@Req() req: Request, @Query() query: QueryIncluirEliminadosDto) {
    const user = req.user as JwtUser;
    return this.categoriasService.findAll(
      user.tenantId!,
      query.incluirEliminados,
    );
  }

  @UseGuards(TenantAdminGuard)
  @Delete(':id')
  remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.categoriasService.remove(user.tenantId!, user.id, id);
  }

  @UseGuards(TenantAdminGuard)
  @Post(':id/restaurar')
  restaurar(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as JwtUser;
    return this.categoriasService.restaurar(user.tenantId!, id);
  }
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `cd backend && npx jest src/modules/categorias/categorias.service.spec.ts`
Expected: PASS

- [ ] **Step 7: Verificar el mutante**

Revertir `remove()` a `this.categoriaRepo.softDelete({ id, tenantId })`. El test de "registra quién borró" debe fallar. Restaurar.

Segundo mutante: en `restaurar()`, sacar `|| !categoria.eliminadoEl`. El test del 404 debe fallar (una categoría viva se "restauraría" con 200).

- [ ] **Step 8: E2E**

En `backend/test/` (archivo nuevo `papelera.e2e-spec.ts`, patrón de `test/motivos-diferencia.e2e-spec.ts`): crear categoría → borrar → el `GET` normal no la trae → el `GET` con el flag sí, con el nombre de quien borró → restaurar → vuelve al listado normal → restaurar de nuevo da 404.

- [ ] **Step 9: Gate + revisión + commit**

Gate completo (backend + `reset-db.sh` + e2e). Revisión `domain-reviewer`, recibo, commit.

---

### Task 3: Causas de merma — familia SQL cruda y colisión de nombre

Segunda referencia: escribe `eliminado_por` en SQL, y tiene nombre único por tenant, así que introduce el 400 de colisión.

**Files:**
- Modify: `backend/src/modules/mermas/causas-merma.service.ts`
- Modify: `backend/src/modules/mermas/causas-merma.controller.ts`
- Test: `backend/src/modules/mermas/causas-merma.service.spec.ts`

**Interfaces:**
- Consumes: `QueryIncluirEliminadosDto` y el contrato de Task 2.
- Produces: el manejo de `23505` que replican las otras tres con nombre único.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
  it('remove() registra quién borró en la misma sentencia', async () => {
    await service.remove(TENANT_ID, USUARIO_ID, CAUSA_ID);

    const sql = dataSource.query.mock.calls.at(-1)![0] as string;
    expect(sql).toMatch(/eliminado_por\s*=\s*\$/);
    expect(sql).toMatch(/eliminado_el\s*=\s*NOW\(\)/);
  });

  it('restaurar() con el nombre ya ocupado devuelve 400 y no toca ninguna fila', async () => {
    // El índice único es parcial (WHERE eliminado_el IS NULL): mientras la
    // causa estaba borrada nadie chocaba con ella, pero al revivirla vuelve
    // a competir por el nombre.
    dataSource.query.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );

    await expect(service.restaurar(TENANT_ID, CAUSA_ID)).rejects.toThrow(
      BadRequestException,
    );
  });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && npx jest src/modules/mermas/causas-merma.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
  async remove(
    tenantId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
    // … las validaciones existentes (esFijo, uso en movimientos) no cambian …
    await this.dataSource.query(
      `UPDATE causas_merma
          SET eliminado_el = NOW(), eliminado_por = $3, actualizado_el = NOW()
        WHERE causa_merma_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [id, tenantId, usuarioId],
    );
  }

  async restaurar(tenantId: string, id: string): Promise<CausaMerma> {
    try {
      const rows: { causa_merma_id: string }[] = await this.dataSource.query(
        `UPDATE causas_merma
            SET eliminado_el = NULL, actualizado_el = NOW()
          WHERE causa_merma_id = $1 AND tenant_id = $2
            AND eliminado_el IS NOT NULL
        RETURNING causa_merma_id`,
        [id, tenantId],
      );
      if (!rows.length) {
        throw new NotFoundException(`Causa ${id} no está en la papelera`);
      }
      return this.findOneOrFail(tenantId, id);
    } catch (e) {
      // 23505 = unique_violation. Se traduce en vez de dejar salir un 500:
      // el índice único es parcial, así que el conflicto solo aparece al
      // revivir la fila. Se capta el código de Postgres y no una lista de
      // índices a mano, para que valga también donde no lo enumeramos.
      if ((e as { code?: string }).code === '23505') {
        throw new BadRequestException(
          `Ya existe una causa de merma activa con ese nombre. Renombrá la actual o la restaurada antes de continuar.`,
        );
      }
      throw e;
    }
  }
```

El `UPDATE … WHERE eliminado_el IS NOT NULL … RETURNING` resuelve búsqueda y escritura en una sentencia: no hay ventana entre leer y escribir.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && npx jest src/modules/mermas/causas-merma.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Verificar el mutante**

Sacar el `catch` del `23505` y dejar propagar. El test de colisión debe fallar (esperaba 400, recibe el error crudo). Restaurar.

- [ ] **Step 6: E2E de la colisión**

Agregar a `papelera.e2e-spec.ts`: crear causa "Vencimiento" → borrarla → crear otra "Vencimiento" → restaurar la primera devuelve **400**, y un `GET` posterior confirma que la viva sigue intacta y la borrada sigue borrada.

Este es el caso que la prueba real vale más que el mock: el `23505` lo tira Postgres, no nuestro código.

- [ ] **Step 7: Endpoint + gate + revisión + commit**

Endpoint `POST :id/restaurar` con el guard del `DELETE` (`TenantAdminGuard`). Gate completo, revisión, recibo, commit.

---

### Task 4: Items — restaurar inactivo y revivir el colateral

La entidad que motivó la feature y la más delicada: es la única que se restaura inactiva y una de las dos con colateral.

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`remove()` ~1723-1779, agregar `restaurar()`)
- Modify: `backend/src/modules/items/items.controller.ts`
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: el contrato de Task 2.
- Produces: `restaurar(tenantId: string, id: string): Promise<ItemDetalle>` — mismo tipo que devuelve hoy `findOne`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
  it('restaurar() deja el item inactivo', async () => {
    // `items.remove()` es el único de los 16 que pisa `activo = false`, así
    // que el valor previo se perdió. Revivirlo activo lo devolvería a la
    // venta sin que nadie lo pidiera.
    const item = await service.restaurar(TENANT_ID, ITEM_ID);
    expect(item.activo).toBe(false);
  });

  it('restaurar() revive los extras que ese mismo borrado se llevó', async () => {
    const sql = capturarSql(manager.query.mock.calls);
    const revive = sql.find((s) => s.includes('receta_extras_permitidos'));

    expect(revive).toMatch(/eliminado_el\s*=\s*NULL/);
    // Acotado al timestamp del ítem: lo borrado antes por otro motivo no revive.
    expect(revive).toMatch(/eliminado_el\s*=\s*\$/);
  });

  it('restaurar() NO revive extras borrados antes, con otro timestamp', async () => {
    // El caso que distingue "deshacer este borrado" de "revivir todo lo que
    // esté borrado y se parezca".
    const params = manager.query.mock.calls.find(([s]) =>
      (s as string).includes('receta_extras_permitidos'),
    )![1] as unknown[];

    expect(params).toContain(ELIMINADO_EL_DEL_ITEM);
  });
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `cd backend && npx jest src/modules/items/items.service.spec.ts -t restaurar`
Expected: FAIL — `restaurar is not a function`

- [ ] **Step 3: Implementar**

```ts
  async restaurar(tenantId: string, itemId: string): Promise<ItemDetalle> {
    return this.dataSource.transaction(async (manager) => {
      // El timestamp del borrado es lo que define qué filas se llevó ESTE
      // delete: al correr en una sola transacción, NOW() fue idéntico para
      // el ítem y sus colaterales.
      const rows: { eliminado_el: Date }[] = await manager.query(
        `UPDATE items
            SET eliminado_el = NULL, actualizado_el = NOW()
          WHERE item_id = $1 AND tenant_id = $2 AND eliminado_el IS NOT NULL
        RETURNING (SELECT eliminado_el FROM items WHERE item_id = $1) AS eliminado_el`,
        [itemId, tenantId],
      );
      if (!rows.length) {
        throw new NotFoundException(`Item ${itemId} no está en la papelera`);
      }
      const borradoEl = rows[0].eliminado_el;

      // `activo` queda en false: `remove()` lo pisó y el valor previo se
      // perdió. Reactivar es un segundo gesto deliberado del usuario.

      // Revive solo lo que este mismo borrado se llevó. Las filas con otro
      // timestamp fueron borradas por otro motivo y siguen borradas.
      await manager.query(
        `UPDATE receta_extras_permitidos
            SET eliminado_el = NULL, actualizado_el = NOW()
          WHERE tenant_id = $2 AND eliminado_el = $3
            AND (ingrediente_item_id = $1 OR receta_item_id = $1)`,
        [itemId, tenantId, borradoEl],
      );

      return this.findOne(tenantId, itemId);
    });
  }
```

**Nota para quien implemente:** el `RETURNING` de arriba necesita leer `eliminado_el` **antes** de pisarlo. Si el subquery no lo resuelve como se espera, la alternativa es un `SELECT … FOR UPDATE` del ítem dentro de la misma transacción antes del `UPDATE`, guardando el valor. Elegir la que funcione y dejar el porqué en un comentario; lo que no se puede es leer el timestamp **después** de haberlo puesto en `NULL`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `cd backend && npx jest src/modules/items/items.service.spec.ts -t restaurar`
Expected: PASS

- [ ] **Step 5: Verificar los mutantes**

1. Sacar el `activo` de la conducta (dejar que `restore` lo devuelva como esté): el primer test debe fallar.
2. Cambiar el `WHERE eliminado_el = $3` por `WHERE eliminado_el IS NOT NULL`: el tercer test debe fallar — es el mutante que prueba que el acotamiento por timestamp hace algo.

- [ ] **Step 6: E2E — el caso que motivó la feature**

Crear ítem afecto con impuestos, descuentos y recargos asociados → venderlo una vez para dejar rastro → borrarlo → restaurarlo → **sus reglas de precio siguen asociadas** y el ítem está inactivo. Es la promesa de la spec: `remove()` no toca las tres puentes.

- [ ] **Step 7: Endpoint + gate + revisión + commit**

`POST /items/:id/restaurar` con el guard del `DELETE` de items (heredado del `@Controller` — **verificarlo en el archivo**, no asumirlo). Gate completo, revisión, recibo, commit.

---

### Task 5: Salones — el colateral en cascada

`salones.remove()` soft-deletea todas las mesas del salón (`salones.service.ts:231`) antes de borrarlo. Misma regla que items, distinta forma.

**Files:**
- Modify: `backend/src/modules/salones/salones.service.ts`
- Modify: `backend/src/modules/salones/salones.controller.ts`
- Test: `backend/src/modules/salones/salones.service.spec.ts`

**Interfaces:**
- Consumes: el contrato de Task 2 y el patrón de acotamiento por timestamp de Task 4.
- Produces: `restaurar(tenantId, id)` para `Salon` y para `Mesa` (dos endpoints: `salones/:id/restaurar` y `mesas/:id/restaurar`).

- [ ] **Step 1: Escribir los tests que fallan**

```ts
  it('restaurar un salón revive las mesas que ese borrado se llevó', async () => {
    await service.restaurarSalon(TENANT_ID, SALON_ID);

    expect(manager.update).toHaveBeenCalledWith(
      Mesa,
      expect.objectContaining({ salonId: SALON_ID, eliminadoEl: BORRADO_EL }),
      expect.objectContaining({ eliminadoEl: null }),
    );
  });

  it('una mesa borrada ANTES que el salón sigue borrada al restaurarlo', async () => {
    // Si el usuario borró la mesa 3 el martes y el salón entero el viernes,
    // restaurar el salón no debe devolver la mesa 3: no era parte de ese acto.
    const criterio = (manager.update.mock.calls.at(-1) as unknown[])[1];
    expect(criterio).toHaveProperty('eliminadoEl', BORRADO_EL);
  });
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && npx jest src/modules/salones/salones.service.spec.ts -t restaurar`
Expected: FAIL

- [ ] **Step 3: Implementar**

Mismo patrón que Task 4: leer el `eliminado_el` del salón dentro de la transacción **antes** de limpiarlo, restaurar el salón, y restaurar solo las `mesas` con `salonId` y ese mismo timestamp. Restaurar una mesa suelta (`mesas/:id/restaurar`) no toca el salón: si el salón sigue borrado, la mesa queda huérfana y visible en el listado con eliminados — huérfano tolerado, decisión (c) de la spec.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `cd backend && npx jest src/modules/salones/salones.service.spec.ts -t restaurar`
Expected: PASS

- [ ] **Step 5: Verificar el mutante**

Cambiar el criterio de las mesas por `{ salonId: SALON_ID }` sin el timestamp: el segundo test debe fallar.

- [ ] **Step 6: Endpoints + gate + revisión + commit**

---

### Task 6: Replicar a los 11 recursos restantes

`descuentos`, `recargos`, `impuestos`, `terceros`, `cajones`, `garzones`, `turnos`, `impresoras` (familia `softDelete()`, patrón de Task 2); `grupos_modificadores`, `motivo_diferencia_caja`, `motivo_diferencia_inventario` (familia SQL cruda, patrón de Task 3).

Se hace **después** de las cuatro anteriores a propósito: el riesgo de esta feature no es el volumen sino el drift, y replicar antes de tener el patrón estable es cómo se produce.

**Files:** por cada recurso, su `*.service.ts`, su `*.controller.ts` y su `*.service.spec.ts`.

**Interfaces:**
- Consumes: el contrato completo de Task 2 (`remove` con `usuarioId`, `restaurar`, `findAll` con el flag, `QueryIncluirEliminadosDto`) y el manejo de `23505` de Task 3.
- Produces: nada nuevo. Si un recurso necesita inventar algo que no está en Tasks 2-3, **parar y reportar** en vez de resolverlo por su cuenta: significa que el patrón no cubría un caso y hay que decidirlo, no improvisarlo.

Por cada uno de los 11:

- [ ] **Step 1:** Escribir los tests del recurso, calcados de Task 2 (o Task 3 si tiene nombre único), con sus nombres y tabla.
- [ ] **Step 2:** Correr y verificar que fallan.
- [ ] **Step 3:** Implementar `remove()` con `usuarioId`, `restaurar()` y el flag en `findAll()`.
- [ ] **Step 4:** Correr y verificar que pasan.
- [ ] **Step 5:** Endpoint `POST :id/restaurar` **con el guard del `DELETE` de ese controller** — leerlo, no asumirlo: `cajones` usa `@RequiresPermiso('Cajas', 'Eliminar')` y no `TenantAdminGuard`; `terceros`, `garzones`, `turnos`, `impresoras` y `grupos-modificadores` heredan el suyo del `@Controller`.
- [ ] **Step 6:** Verificar el mutante del recurso (revertir `remove()` a la forma anterior sin `eliminado_por`).

- [ ] **Step 7: Un e2e que barre los 11**

Un solo spec parametrizado sobre la lista de recursos: por cada uno, crear → borrar → listar con el flag → restaurar → verificar. Un e2e por recurso sería once copias del mismo cuerpo.

- [ ] **Step 8: Gate + revisión + commit**

Commit por familia (uno para los 8 de `softDelete()`, otro para los 3 de SQL crudo), no once commits ni uno solo: cada familia es una unidad que un reviewer puede juzgar entera.

---

### Task 7: Frontend — ver eliminados y restaurar

**Files:**
- Create: `frontend/app/composables/usePapelera.ts`
- Create: `frontend/app/composables/usePapelera.spec.ts`
- Modify: los listados de los 16 recursos en `frontend/app/pages/`

**Interfaces:**
- Consumes: `GET /<recurso>?incluirEliminados=true` y `POST /<recurso>/:id/restaurar`.
- Produces: `usePapelera(recurso: string)` → `{ verEliminados: Ref<boolean>, restaurar: (id: string) => Promise<void>, formatearBorradoPor: (fila) => string }`.

- [ ] **Step 1: Escribir el test del composable**

Cubrir: el toggle arranca en `false`; `restaurar` llama al endpoint correcto; un error 400 de colisión se propaga con su mensaje para que la pantalla lo muestre tal cual (es el texto que le dice al usuario qué renombrar).

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd frontend && npx vitest run app/composables/usePapelera.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implementar el composable**

`useApiFetch`, nunca axios. La lógica de presentación va acá, no en los `.vue`.

- [ ] **Step 4: Correr y verificar que pasa**

- [ ] **Step 5: Cablear los listados**

Un control para ver eliminados y, en esas filas, botón Restaurar con confirmación. Las filas eliminadas se distinguen y muestran quién y cuándo. **Tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado** — `npm run design:check` lo verifica.

Empezar por `items` y `categorias`; recién con esas dos estables, el resto.

- [ ] **Step 6: Smoke test en navegador**

Obligatorio, no opcional: estos controles viven en listados y drawers, y ni el build ni el typecheck ven lo que pasa ahí. Con el stack levantado: activar el toggle, ver una fila eliminada con su autor, restaurar, verificar que vuelve al listado normal, y revisar que la consola quede limpia.

- [ ] **Step 7: Gate + revisión + commit**

---

### Task 8: Documentación

**Files:**
- Create: `docs/features/papelera.md` (desde `docs/features/TEMPLATE.md`)
- Modify: `docs/README.md` (link), `docs/ESTADO.md` (fila), `docs/PRODUCTO.md`
- Modify: `docs/agent/pendientes.md` → `docs/agent/resueltos.md`

- [ ] **Step 1: Escribir `docs/features/papelera.md`**

El porqué y las reglas, no el código: qué entra y qué no y **por qué** (restaurar un rol devuelve permisos; una tarjeta guardada es privacidad), las tres conductas (inactivo solo en items, colateral acotado por timestamp, huérfano tolerado), y el 400 de colisión.

- [ ] **Step 2: Cerrar el backlog**

Mover a `resueltos.md` la entrada **"Log de cambios reversible"** (`pendientes.md:545`) con el texto de cierre: qué se construyó, qué quedó fuera y por qué.

Y **desbloquear** la entrada de "desactivar una regla limpia sus asociaciones": ya no depende de esto. La spec midió que `items.remove()` no toca las tres puentes, así que la papelera funciona sin uniformarlas. Reescribir el `⛔ Bloqueado por una decisión más grande` con lo que ahora sí está decidido, y dejar anotado lo único que queda abierto ahí: si el `limpiar` del desactivar es físico o blando.

- [ ] **Step 3: Gate + revisión + commit**

---

## Self-review de este plan

- **Cobertura de la spec:** alcance de 16 → tabla y Task 6; `eliminado_por` → Task 1; API → Tasks 2-6; conducta (a) → Task 4; (b) → Tasks 4 y 5; (c) → Task 5 step 3 y `docs/features/papelera.md`; (d) colisión → Task 3; frontend → Task 7; testing → los steps de mutante de cada task; riesgo de drift → orden de Task 6; riesgo del guard equivocado → Global Constraints y Task 6 step 5.
- **Sin placeholders:** el único "elegir la que funcione" es el `RETURNING` de Task 4 step 3, y está acotado con la restricción que importa (no leer el timestamp después de pisarlo) y dos alternativas concretas.
- **Consistencia de tipos:** `remove(tenantId, usuarioId, id)` en Tasks 2, 3, 4, 6; `restaurar(tenantId, id)` en todas; `QueryIncluirEliminadosDto.incluirEliminados` en Tasks 2, 6, 7.
