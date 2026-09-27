# Plan: % de anulaciones y cortesías sobre lo pedido, por garzón

> **Para agentes:** sub-skill obligatoria: `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans`, tarea por tarea. Los pasos usan checkboxes (`- [ ]`).

- **Status:** Draft
- **Date:** 2026-09-27
- **Owner:** César (owner) · redacta la sesión del frente, en el worktree `agitated-shtern-e2ca3d`
  (rama `claude/agitated-shtern-e2ca3d`)

**Goal:** Que el reporte de anulaciones diga, por garzón, qué porcentaje de lo que pidieron sus mesas
anuló o regaló, repartiendo la venta de una mesa transferida entre los garzones que la atendieron.

**Architecture:** Una tabla nueva, `cuenta_linea_reparto`, guarda por cada línea de la cuenta cuántas
unidades entraron con cada responsable vigente. La escriben los seis caminos de `SalonesService` que
mueven la cantidad de una línea, siempre bajo el `FOR UPDATE` de la cuenta. La lógica de reparto vive en
un módulo puro (`reparto-linea.ts`), y el resumen del reporte suma dos agregaciones (lo vendido desde el
reparto y lo anulado sin filtros de tipo) para calcular `pedido` y `porcentaje`. La pantalla suma una
columna.

**Tech Stack:** NestJS + TypeORM (`synchronize`) + SQL crudo vía `Db`/`manager.query`, Decimal.js ·
Nuxt 4 + Nuxt UI v4 · Jest + supertest (e2e de la API) · Vitest (`@nuxt/test-utils`) · Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-27-porcentaje-anulaciones-por-garzon-design.md`](../specs/2026-09-27-porcentaje-anulaciones-por-garzon-design.md).
Se lee junto con este plan: las decisiones del owner y su porqué están ahí (§ 2), no se repiten acá.

## Global Constraints

- `tenant_id` **siempre del token**. El responsable del reparto sale de la **cuenta ya bloqueada**
  (`cuenta.garzonResponsableId`), nunca del body.
- Cantidades y plata con **Decimal.js**. Porcentaje como **fracción decimal** a `ESCALA_COSTO` (`0.0500`
  = 5%), nunca `5`.
- **Soft delete:** nunca `DELETE`. Toda lectura nueva filtra `eliminado_el IS NULL`, salvo las
  excepciones deliberadas de la spec § 4.2 (cuenta y garzón), con el porqué escrito en la consulta.
- **Nunca una query por fila:** el reparto de una fusión se escribe por lotes; lo vendido por garzón sale
  de un `GROUP BY`.
- **No se toca:** el motor de precios, `ventas.service`, `venta_detalles`, notas de crédito,
  `movimientos_inventario`. Si una tarea parece exigirlo, **parar y preguntar**.
- **La pantalla del salón (`frontend/app/pages/salones/index.vue`) no cambia.**
- Entidad nueva → `RepositoriosModule.forFeature` de `salones.module.ts` **y** el array `entities` de
  `app.module.ts` (sin `autoLoadEntities`; solo lo caza el e2e).
- Sin backfill: no hay datos productivos. Se cambia el esquema y se resetea.
- E2E: pipe con `validacionGlobal()` (`docs/patterns/backend.md` § 7); garzones, salón, mesa, ítems y
  caja **propios del spec**, **nunca Ana del seed**; todo `.body` leído lleva su `expect(status)`.
- Gate completo por tarea (`CLAUDE.md`): `./scripts/entorno.sh db`, `./scripts/reset-db.sh` **antes**
  de `test:e2e` y `./scripts/reset-db.sh --verificar` **después**. No tocar un `.ts` del backend con el
  e2e corriendo.
- Todo subagente con `model: 'sonnet'` explícito. `verify-feature` con `domain-reviewer` por tarea, y
  `api-security-reviewer` si la tarea toca controller, DTO o entidad.
- ⛔ No mergear ni pushear. Stagear por ruta explícita (nunca `git add -A`). Nunca `--no-verify` sin
  permiso. Rebase sobre `main` con el árbol limpio antes de avisar a la orquestadora.

---

## Context

`cuentas.garzon_responsable_id` guarda solo el responsable vigente; la transferencia lo pisa. El
reporte de anulaciones (`AnulacionesReporteService.resumen`, `backend/src/modules/salones/anulaciones-reporte.service.ts`)
ya agrupa lo anulado por el garzón que tenía la mesa al anular (`cuenta_linea_anulaciones.garzon_id`),
a precio de carta (`precioCartaDeFila`: `cantidad × precio_unitario`, `toFixed(ESCALA_COSTO)`).

**Los caminos que mueven la cantidad de una línea** (todos en `backend/src/modules/salones/salones.service.ts`,
medido 2026-09-27 con `grep -n "save(CuentaLinea\|softDelete(CuentaLinea"`; nadie más escribe
`cuenta_lineas`, salvo dos e2e que insertan por SQL una línea de otro tenant para probar un 404):

| Método | Qué hace con la línea |
|---|---|
| `agregarLinea` | crea una línea o suma a una igual (`match`) |
| `actualizarLinea` | escribe la cantidad **absoluta** (el stepper) |
| `quitarLinea` | borra la línea (solo si nada se despachó) |
| `escribirAnulacionEnLinea` | resta lo anulado; la borra si llega a 0. La usan `anularLinea` y `escribirCancelacionConMotivo`, y ambas le pasan `cuenta.garzonResponsableId` como `garzonId` |
| `fusionarCuentas` | mueve la línea de origen al destino, o la **junta** con una igual del destino y borra la de origen |
| `cerrarCuenta` | lee las líneas; no las cambia |

## Scope / Out of scope

**Adentro:** tabla y escritura del reparto; `pedido` y `porcentaje` en `porGarzon`; garzones sin
anulaciones en `porGarzon`; columna *"% de lo pedido"*; docs.

**Afuera (spec § 6):** notas de crédito (no restan; entrada nueva en `pendientes.md`), umbrales,
exportar, lo cobrado en vez de la carta, el día comercial.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `backend/src/modules/salones/entities/cuenta-linea-reparto.entity.ts` (nuevo) | La tabla |
| `backend/src/modules/salones/reparto-linea.ts` (nuevo) | Funciones puras: descontar y fusionar repartos. Precedente: `compras/reparto-descuento.ts` |
| `backend/src/modules/salones/reparto-linea.spec.ts` (nuevo) | Sus unitarios |
| `backend/src/modules/salones/salones.service.ts` | Escribe el reparto en los caminos de la tabla de arriba |
| `backend/src/modules/salones/anulaciones-reporte.service.ts` | `pedido`, `porcentaje`, filas sin anulaciones |
| `backend/test/salones-reparto-linea.e2e-spec.ts` (nuevo) | El reparto, contra la base |
| `backend/test/salones-anulaciones-porcentaje.e2e-spec.ts` (nuevo) | El % en el resumen |
| `frontend/app/pages/salones/anulaciones.vue` + `anulaciones.nuxt.spec.ts` | La columna |

---

## Backend

### Task 1: El reparto de cada línea

**Files:**
- Create: `backend/src/modules/salones/entities/cuenta-linea-reparto.entity.ts`
- Create: `backend/src/modules/salones/reparto-linea.ts`, `backend/src/modules/salones/reparto-linea.spec.ts`
- Create: `backend/test/salones-reparto-linea.e2e-spec.ts`
- Modify: `backend/src/modules/salones/salones.service.ts` (`agregarLinea`, `actualizarLinea`,
  `escribirAnulacionEnLinea`, `fusionarCuentas`, más dos helpers privados)
- Modify: `backend/src/modules/salones/salones.module.ts`, `backend/src/app.module.ts`
- Modify: `backend/src/modules/salones/salones.service.spec.ts` (los mocks de `manager` que ahora ven
  consultas nuevas)
- Modify: `startup-pos.sql`, `docs/features/salones-mesas.md`

**Interfaces:**
- Produces: tabla `cuenta_linea_reparto (cuenta_linea_reparto_id, tenant_id, cuenta_linea_id,
  garzon_id NULL, cantidad numeric(18,4), creado_el, actualizado_el, eliminado_el)`, con la invariante
  *Σ cantidad viva = `cuenta_lineas.cantidad`* para toda línea viva. La Task 2 la lee por SQL.
- Produces: `descontarReparto(filas: FilaReparto[], responsableId: string | null, cantidad: string):
  { id: string; cantidad: string }[]` y `fusionarRepartos(...)` en `reparto-linea.ts`.

- [ ] **Step 1: Unitarios de las funciones puras (fallan)**

`backend/src/modules/salones/reparto-linea.spec.ts`:

```ts
import { descontarReparto, fusionarRepartos, type FilaReparto } from './reparto-linea';

const t = (min: number) => new Date(Date.UTC(2026, 8, 27, 12, min));
const fila = (id: string, garzonId: string | null, cantidad: string, min: number): FilaReparto => ({
  id, garzonId, cantidad, creadoEl: t(min),
});

describe('descontarReparto (spec § 3.3)', () => {
  it('sale primero del responsable vigente, aunque su fila sea la más vieja', () => {
    const filas = [fila('a', 'ana', '2', 0), fila('b', 'beto', '1', 5)];
    expect(descontarReparto(filas, 'ana', '1')).toEqual([{ id: 'a', cantidad: '1.0000' }]);
  });

  it('si el responsable no alcanza, sigue por la fila más reciente', () => {
    const filas = [fila('a', 'ana', '2', 0), fila('c', 'carla', '1', 3), fila('b', 'beto', '1', 5)];
    expect(descontarReparto(filas, 'beto', '2')).toEqual([
      { id: 'b', cantidad: '0.0000' },
      { id: 'c', cantidad: '0.0000' },
    ]);
  });

  it('el responsable sin fila en la línea no frena: descuenta de las demás', () => {
    const filas = [fila('a', 'ana', '3', 0)];
    expect(descontarReparto(filas, 'beto', '2')).toEqual([{ id: 'a', cantidad: '1.0000' }]);
  });

  it('con el mismo creado_el desempata por id ascendente', () => {
    const filas = [fila('z', 'ana', '1', 0), fila('m', 'carla', '1', 0)];
    expect(descontarReparto(filas, 'beto', '1')).toEqual([{ id: 'm', cantidad: '0.0000' }]);
  });

  it('las filas en 0 se saltean', () => {
    const filas = [fila('b', 'beto', '0', 9), fila('a', 'ana', '1', 0)];
    expect(descontarReparto(filas, 'beto', '1')).toEqual([{ id: 'a', cantidad: '0.0000' }]);
  });

  it('cantidades con decimales, sin number nativo', () => {
    const filas = [fila('a', 'ana', '0.3', 0), fila('b', 'beto', '0.2', 5)];
    expect(descontarReparto(filas, 'beto', '0.35')).toEqual([
      { id: 'b', cantidad: '0.0000' },
      { id: 'a', cantidad: '0.1500' },
    ]);
  });

  it('si el reparto no alcanza, es un error: la invariante se rompió antes', () => {
    expect(() => descontarReparto([fila('a', 'ana', '1', 0)], 'ana', '2')).toThrow();
  });

  it('el responsable null matchea la fila null', () => {
    const filas = [fila('a', 'ana', '1', 5), fila('n', null, '1', 0)];
    expect(descontarReparto(filas, null, '1')).toEqual([{ id: 'n', cantidad: '0.0000' }]);
  });
});

describe('fusionarRepartos (spec § 3.3, la línea que se junta)', () => {
  it('suma a la fila del mismo garzón en el destino, y la de origen se borra', () => {
    const r = fusionarRepartos(
      [{ ...fila('o1', 'ana', '2', 0), cuentaLineaId: 'LO' }],
      [{ ...fila('d1', 'ana', '1', 0), cuentaLineaId: 'LD' }],
      new Map([['LO', 'LD']]),
    );
    expect(r).toEqual({
      actualizar: [{ id: 'd1', cantidad: '3.0000' }],
      reapuntar: [],
      borrar: ['o1'],
    });
  });

  it('sin fila del mismo garzón en el destino, la de origen se re-apunta', () => {
    const r = fusionarRepartos(
      [{ ...fila('o1', 'beto', '2', 0), cuentaLineaId: 'LO' }],
      [{ ...fila('d1', 'ana', '1', 0), cuentaLineaId: 'LD' }],
      new Map([['LO', 'LD']]),
    );
    expect(r).toEqual({ actualizar: [], reapuntar: [{ id: 'o1', cuentaLineaId: 'LD' }], borrar: [] });
  });

  it('dos orígenes del mismo garzón hacia un destino que no lo tiene: uno se re-apunta, el otro suma sobre él', () => {
    const r = fusionarRepartos(
      [
        { ...fila('o1', 'beto', '2', 0), cuentaLineaId: 'LO1' },
        { ...fila('o2', 'beto', '1', 1), cuentaLineaId: 'LO2' },
      ],
      [{ ...fila('d1', 'ana', '1', 0), cuentaLineaId: 'LD' }],
      new Map([['LO1', 'LD'], ['LO2', 'LD']]),
    );
    expect(r).toEqual({
      actualizar: [{ id: 'o1', cantidad: '3.0000' }],
      reapuntar: [{ id: 'o1', cuentaLineaId: 'LD' }],
      borrar: ['o2'],
    });
  });
});
```

- [ ] **Step 2: Correrlos y verlos fallar**

Run: `cd backend && npx jest src/modules/salones/reparto-linea.spec.ts`
Expected: FAIL, `Cannot find module './reparto-linea'`.

- [ ] **Step 3: Las funciones puras**

`backend/src/modules/salones/reparto-linea.ts`:

```ts
import Decimal from 'decimal.js';
import { ESCALA_COSTO } from '../../common/constants/escalas';

/**
 * Una fila de `cuenta_linea_reparto`: cuántas unidades de una línea entraron
 * con cada responsable vigente de la cuenta (spec
 * `2026-09-27-porcentaje-anulaciones-por-garzon-design.md` § 3).
 */
export interface FilaReparto {
  id: string;
  garzonId: string | null;
  cantidad: string;
  creadoEl: Date;
}

/**
 * Qué filas bajan, y a cuánto, al descontar `cantidad` de una línea (bajar la
 * cantidad o anular). Primero sale del responsable vigente; si no alcanza, de
 * las demás, la más reciente primero, desempate por id. Es regla técnica, no
 * de negocio: el porqué está en la spec § 3.3.
 *
 * Que no alcance es un error y no un caso: significa que la invariante
 * *Σ reparto = cantidad de la línea* ya se había roto antes.
 */
export function descontarReparto(
  filas: FilaReparto[],
  responsableId: string | null,
  cantidad: string,
): { id: string; cantidad: string }[] {
  const orden = [...filas].sort((a, b) => {
    const ra = a.garzonId === responsableId ? 0 : 1;
    const rb = b.garzonId === responsableId ? 0 : 1;
    if (ra !== rb) return ra - rb;
    const porFecha = b.creadoEl.getTime() - a.creadoEl.getTime();
    if (porFecha !== 0) return porFecha;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  let resta = new Decimal(cantidad);
  const cambios: { id: string; cantidad: string }[] = [];
  for (const f of orden) {
    if (resta.lte(0)) break;
    const tiene = new Decimal(f.cantidad);
    if (tiene.lte(0)) continue;
    const saca = Decimal.min(tiene, resta);
    cambios.push({ id: f.id, cantidad: tiene.minus(saca).toFixed(ESCALA_COSTO) });
    resta = resta.minus(saca);
  }
  if (resta.gt(0)) {
    throw new Error(
      `El reparto de la línea no alcanza para descontar ${cantidad}: ` +
        'la suma del reparto ya no era la cantidad de la línea',
    );
  }
  return cambios;
}

/**
 * La fusión de cuentas junta una línea de origen con una igual del destino
 * (`fusionarCuentas`). Su reparto se va con ella: cada fila de origen suma a
 * la fila del mismo garzón en la línea destino, o se re-apunta a esa línea si
 * no tiene; la fila absorbida se borra. Todo en memoria: el llamador escribe
 * el resultado por lotes, no una consulta por fila.
 *
 * `destinoDe` mapea línea de origen → línea destino, SOLO para las que se
 * juntaron (las que se movieron enteras se llevan su reparto solas).
 */
export function fusionarRepartos(
  origen: (FilaReparto & { cuentaLineaId: string })[],
  destino: (FilaReparto & { cuentaLineaId: string })[],
  destinoDe: Map<string, string>,
): {
  actualizar: { id: string; cantidad: string }[];
  reapuntar: { id: string; cuentaLineaId: string }[];
  borrar: string[];
} {
  const clave = (lineaId: string, garzonId: string | null) => `${lineaId}|${garzonId ?? ''}`;
  const vivas = new Map<string, { id: string; cantidad: Decimal }>();
  for (const d of destino) vivas.set(clave(d.cuentaLineaId, d.garzonId), { id: d.id, cantidad: new Decimal(d.cantidad) });

  const tocadas = new Set<string>();
  const reapuntar: { id: string; cuentaLineaId: string }[] = [];
  const borrar: string[] = [];
  for (const o of origen) {
    const lineaDestino = destinoDe.get(o.cuentaLineaId);
    if (!lineaDestino) continue;
    const k = clave(lineaDestino, o.garzonId);
    const existente = vivas.get(k);
    if (existente) {
      existente.cantidad = existente.cantidad.plus(o.cantidad);
      tocadas.add(existente.id);
      borrar.push(o.id);
    } else {
      vivas.set(k, { id: o.id, cantidad: new Decimal(o.cantidad) });
      reapuntar.push({ id: o.id, cuentaLineaId: lineaDestino });
    }
  }
  const actualizar = [...vivas.values()]
    .filter((v) => tocadas.has(v.id))
    .map((v) => ({ id: v.id, cantidad: v.cantidad.toFixed(ESCALA_COSTO) }));
  return { actualizar, reapuntar, borrar };
}
```

- [ ] **Step 4: Correrlos y verlos pasar**

Run: `cd backend && npx jest src/modules/salones/reparto-linea.spec.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: La entidad, registrada**

`backend/src/modules/salones/entities/cuenta-linea-reparto.entity.ts`, con el molde de
`cuenta-linea-anulacion.entity.ts` (UUID explícito, `timestamptz` explícito: los dos los fuerza un test):

```ts
import { Entity, Index, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';

/**
 * Cuántas unidades de una línea de la cuenta entraron con cada responsable
 * vigente (spec `2026-09-27-porcentaje-anulaciones-por-garzon-design.md` § 3).
 * Es lo que permite repartir la venta de una mesa transferida entre los
 * garzones que la atendieron (owner, 2026-09-20).
 *
 * Invariante: para toda línea viva, Σ `cantidad` de sus filas vivas =
 * `cuenta_lineas.cantidad`. La sostiene `SalonesService`, que es el único que
 * escribe esta tabla y siempre bajo el `FOR UPDATE` de la cuenta.
 *
 * `uq_cuenta_linea_reparto_garzon`: a lo sumo una fila viva por (línea,
 * garzón). Con `garzon_id` null no cubre (Postgres trata los null como
 * distintos); ahí lo sostiene el código. También es el índice por el que se
 * leen las filas de una línea.
 */
@Index('uq_cuenta_linea_reparto_garzon', ['cuentaLineaId', 'garzonId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
@Entity('cuenta_linea_reparto')
export class CuentaLineaReparto {
  @PrimaryGeneratedColumn('uuid', { name: 'cuenta_linea_reparto_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'cuenta_linea_id', type: 'uuid' })
  cuentaLineaId: string;

  @Column({ name: 'garzon_id', type: 'uuid', nullable: true })
  garzonId: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
```

Registrarla en `RepositoriosModule.forFeature([...])` de `salones.module.ts` **y** en el array
`entities` de `app.module.ts` (al lado de `CuentaLineaAnulacion`, línea ~291). Agregar la tabla a
`startup-pos.sql` junto a `cuenta_linea_anulaciones`.

- [ ] **Step 6: E2E del reparto (falla)**

`backend/test/salones-reparto-linea.e2e-spec.ts`. Esqueleto: el `beforeAll`/`afterAll` de
`salones-anulaciones-reporte.e2e-spec.ts` (login admin + encargado, impresora y categoría de cocina para
que `reclamar` avance `cantidadEnviada`, **dos garzones propios** con sesión, salón y mesa propios,
cierre de sesiones en `afterAll` con `limpiar`). No cierra cuentas: no necesita caja.

Helper de lectura contra la base (leer para afirmar es legítimo; no se monta estado por SQL):

```ts
async function reparto(cuentaId: string): Promise<{ item_id: string; garzon_id: string | null; cantidad: string }[]> {
  return ds.query(
    `SELECT cl.item_id, r.garzon_id, r.cantidad::text AS cantidad
       FROM cuenta_linea_reparto r
       JOIN cuenta_lineas cl ON cl.cuenta_linea_id = r.cuenta_linea_id AND cl.eliminado_el IS NULL
      WHERE cl.cuenta_id = $1 AND r.eliminado_el IS NULL AND r.cantidad > 0
      ORDER BY cl.item_id, r.garzon_id`,
    [cuentaId],
  );
}

/** Σ reparto vivo = cantidad, para toda línea viva de la cuenta (spec § 3.2). */
async function assertInvariante(cuentaId: string): Promise<void> {
  const rotas: unknown[] = await ds.query(
    `SELECT cl.cuenta_linea_id, cl.cantidad, COALESCE(SUM(r.cantidad), 0) AS suma
       FROM cuenta_lineas cl
       LEFT JOIN cuenta_linea_reparto r ON r.cuenta_linea_id = cl.cuenta_linea_id AND r.eliminado_el IS NULL
      WHERE cl.cuenta_id = $1 AND cl.eliminado_el IS NULL
      GROUP BY cl.cuenta_linea_id, cl.cantidad
     HAVING cl.cantidad <> COALESCE(SUM(r.cantidad), 0)`,
    [cuentaId],
  );
  expect(rotas).toEqual([]);
}

async function transferir(cuentaId: string, a: GarzonCreado): Promise<void> {
  const res = await request(app.getHttpServer())
    .post(`/api/cuentas/${cuentaId}/transferir`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ garzonId: a.id, pin: a.pin });
  expect(res.status).toBe(201);
}

async function patchCantidad(cuentaId: string, lineaId: string, cantidad: string): Promise<void> {
  const res = await request(app.getHttpServer())
    .patch(`/api/cuentas/${cuentaId}/lineas/${lineaId}`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({ cantidad });
  expect(res.status).toBe(200);
}
```

Tests (cada uno con un ítem propio de `precioBase` redondo y `stock: '1000'`, y `assertInvariante` al
final de cada paso):

1. **Línea nueva** → una fila, del responsable (G1), con la cantidad pedida.
2. **El "+" después de transferir:** G1 pide 2 cervezas, transferir a G2, `PATCH` a 3 → reparto
   `[G1: 2, G2: 1]`. *(Es el test que mata el mutante "al creador de la línea".)*
3. **Sumar desde el catálogo después de transferir:** G1 pide 1, transferir a G2, `POST /lineas` del mismo
   ítem con cantidad 1 → **una sola línea** de cantidad 2 y reparto `[G1: 1, G2: 1]`.
4. **Bajar la cantidad:** G1 pide 3, transferir a G2, G2 sube a 4, baja a 2 → `[G1: 2]` (sale primero
   del responsable G2, después del más reciente).
5. **Anular después de transferir:** G1 pide 2, despachar, transferir a G2, anular 1 (cortesía, token del
   encargado) → `[G1: 1]`; la anulación queda con `garzon_id` = G2 (lo que ya hacía).
6. **Anular la línea entera:** la línea se borra y `reparto()` no la devuelve.
7. **Fusión:** cuenta A de G1 con 2 del ítem X; cuenta B de G2 con 1 del ítem X y 1 del ítem Y;
   `POST /mesas/:id/cuentas/fusionar` con las dos → en la cuenta destino, X tiene `[G1: 2, G2: 1]` e
   Y `[G2: 1]`; ninguna fila viva cuelga de una línea borrada:

```ts
const colgadas: unknown[] = await ds.query(
  `SELECT r.cuenta_linea_reparto_id FROM cuenta_linea_reparto r
     JOIN cuenta_lineas cl ON cl.cuenta_linea_id = r.cuenta_linea_id
    WHERE cl.eliminado_el IS NOT NULL AND r.eliminado_el IS NULL AND r.cantidad > 0
      AND cl.cuenta_id = ANY($1)`,
  [[cuentaA.id, cuentaB.id]],
);
expect(colgadas).toEqual([]);
```

⚠️ Los tests 2–5 y 7 dejan cuentas abiertas: cancelarlas al final de cada test
(`POST /api/cuentas/:id/cancelar`, o `cancelar-con-motivo` si hay algo despachado) para no dejar stock
apartado ni la mesa ocupada.

- [ ] **Step 7: Correrlo y verlo fallar**

Run: `./scripts/entorno.sh db && ./scripts/reset-db.sh && cd backend && npx jest --config ./test/jest-e2e.json test/salones-reparto-linea.e2e-spec.ts`
Expected: FAIL — la tabla existe (la entidad está registrada) pero `reparto()` vuelve vacío.
⚠️ Si el worktree se llama como el frente, el filtro puede matchear todas las rutas
(`docs/patterns/backend.md` § 7): pasar la ruta completa como arriba.

- [ ] **Step 8: Escribir el reparto en `SalonesService`**

Dos helpers privados en `salones.service.ts`, al lado de `escribirAnulacionEnLinea`. Los dos reciben el
`manager` de la transacción que **ya** tiene la cuenta bloqueada:

```ts
/**
 * Suma `delta` a la fila de `garzonId` en la línea, creándola si no tiene
 * (spec § 3.3). Solo bajo el `FOR UPDATE` de la cuenta: por eso no bloquea
 * nada propio y no agrega un orden de bloqueo.
 */
private async sumarAlReparto(
  manager: EntityManager,
  tenantId: string,
  cuentaLineaId: string,
  garzonId: string | null,
  delta: string,
): Promise<void> {
  const actualizadas: unknown[] = await manager.query(
    `UPDATE cuenta_linea_reparto SET cantidad = cantidad + $4, actualizado_el = NOW()
      WHERE tenant_id = $1 AND cuenta_linea_id = $2
        AND garzon_id IS NOT DISTINCT FROM $3 AND eliminado_el IS NULL
      RETURNING cuenta_linea_reparto_id`,
    [tenantId, cuentaLineaId, garzonId, delta],
  );
  if (actualizadas.length === 0) {
    await manager.save(
      CuentaLineaReparto,
      manager.create(CuentaLineaReparto, { tenantId, cuentaLineaId, garzonId, cantidad: delta }),
    );
  }
}

/** Descuenta `cantidad` del reparto de la línea con `descontarReparto` (spec § 3.3). */
private async descontarDelReparto(
  manager: EntityManager,
  tenantId: string,
  cuentaLineaId: string,
  responsableId: string | null,
  cantidad: string,
): Promise<void> {
  const filas: { id: string; garzon_id: string | null; cantidad: string; creado_el: Date }[] =
    await manager.query(
      `SELECT cuenta_linea_reparto_id AS id, garzon_id, cantidad::text AS cantidad, creado_el
         FROM cuenta_linea_reparto
        WHERE tenant_id = $1 AND cuenta_linea_id = $2 AND eliminado_el IS NULL`,
      [tenantId, cuentaLineaId],
    );
  const cambios = descontarReparto(
    filas.map((f) => ({ id: f.id, garzonId: f.garzon_id, cantidad: f.cantidad, creadoEl: new Date(f.creado_el) })),
    responsableId,
    cantidad,
  );
  if (cambios.length === 0) return;
  // Una sola escritura para todas las filas que bajan, no una por fila.
  await manager.query(
    `UPDATE cuenta_linea_reparto r SET cantidad = c.cantidad::numeric, actualizado_el = NOW()
       FROM unnest($2::uuid[], $3::text[]) AS c(id, cantidad)
      WHERE r.cuenta_linea_reparto_id = c.id AND r.tenant_id = $1`,
    [tenantId, cambios.map((c) => c.id), cambios.map((c) => c.cantidad)],
  );
}
```

Dónde se llaman (el `cuenta` de cada método es el que devolvió `getCuentaAbiertaConLock`):

| Método | Llamada |
|---|---|
| `agregarLinea`, rama `match` | después del `save`: `sumarAlReparto(manager, tenantId, match.id, cuenta.garzonResponsableId, resuelta.cantidadCanonica)` |
| `agregarLinea`, línea nueva | tomar el resultado del `save` (`const nueva = await manager.save(...)`) y `sumarAlReparto(manager, tenantId, nueva.id, cuenta.garzonResponsableId, resuelta.cantidadCanonica)` |
| `actualizarLinea` | **antes** de pisar `linea.cantidad`: `const delta = new Decimal(resuelta.cantidadCanonica).minus(linea.cantidad)`; si `delta > 0` → `sumarAlReparto(..., cuenta.garzonResponsableId, delta.toFixed(ESCALA_COSTO))`; si `delta < 0` → `descontarDelReparto(..., cuenta.garzonResponsableId, delta.abs().toFixed(ESCALA_COSTO))`; si es 0, nada |
| `escribirAnulacionEnLinea` | después de escribir la anulación, **en las dos ramas** (la que borra la línea y la que la baja): `descontarDelReparto(manager, tenantId, linea.id, garzonId, cantidad.toString())`. El `garzonId` que ya recibe es el responsable vigente |
| `fusionarCuentas` | ver abajo |

`quitarLinea`, `cerrarCuenta` y `escribirCancelacionConMotivo` (fuera de lo que ya hace por
`escribirAnulacionEnLinea`) **no cambian**.

**`fusionarCuentas`:** dentro del bucle, en la rama `existente` (la línea de origen se junta), anotar el
par en un `Map<string, string>` declarado antes del bucle: `destinoDe.set(linea.id, existente.id)`.
**Después** del bucle de orígenes, si `destinoDe.size > 0`:

```ts
// El reparto de las líneas que se juntaron (spec § 3.3): una lectura y tres
// escrituras por lotes, sin importar cuántas líneas. Las que se movieron
// enteras se llevan su reparto solas: cuelga de la línea, no de la cuenta.
const filasReparto: { id: string; cuenta_linea_id: string; garzon_id: string | null; cantidad: string; creado_el: Date }[] =
  await manager.query(
    `SELECT cuenta_linea_reparto_id AS id, cuenta_linea_id, garzon_id, cantidad::text AS cantidad, creado_el
       FROM cuenta_linea_reparto
      WHERE tenant_id = $1 AND eliminado_el IS NULL AND cuenta_linea_id = ANY($2::uuid[])`,
    [tenantId, [...destinoDe.keys(), ...destinoDe.values()]],
  );
const aFila = (f: (typeof filasReparto)[number]) => ({
  id: f.id, cuentaLineaId: f.cuenta_linea_id, garzonId: f.garzon_id, cantidad: f.cantidad, creadoEl: new Date(f.creado_el),
});
const { actualizar, reapuntar, borrar } = fusionarRepartos(
  filasReparto.filter((f) => destinoDe.has(f.cuenta_linea_id)).map(aFila),
  filasReparto.filter((f) => !destinoDe.has(f.cuenta_linea_id)).map(aFila),
  destinoDe,
);
if (borrar.length) {
  await manager.query(
    `UPDATE cuenta_linea_reparto SET eliminado_el = NOW()
      WHERE tenant_id = $1 AND cuenta_linea_reparto_id = ANY($2::uuid[])`,
    [tenantId, borrar],
  );
}
if (reapuntar.length) {
  await manager.query(
    `UPDATE cuenta_linea_reparto r SET cuenta_linea_id = c.linea, actualizado_el = NOW()
       FROM unnest($2::uuid[], $3::uuid[]) AS c(id, linea)
      WHERE r.cuenta_linea_reparto_id = c.id AND r.tenant_id = $1`,
    [tenantId, reapuntar.map((r) => r.id), reapuntar.map((r) => r.cuentaLineaId)],
  );
}
if (actualizar.length) {
  await manager.query(
    `UPDATE cuenta_linea_reparto r SET cantidad = c.cantidad::numeric, actualizado_el = NOW()
       FROM unnest($2::uuid[], $3::text[]) AS c(id, cantidad)
      WHERE r.cuenta_linea_reparto_id = c.id AND r.tenant_id = $1`,
    [tenantId, actualizar.map((a) => a.id), actualizar.map((a) => a.cantidad)],
  );
}
```

El orden de las tres escrituras no importa para el índice único: `fusionarRepartos` nunca re-apunta
una fila a un (línea, garzón) que ya tenga fila viva en el destino — en ese caso suma y borra.

⚠️ Revisar que `fusionarCuentas` no haga ya alguna lectura por línea dentro del bucle que esto duplique;
el bucle existente escribe N líneas (escritura, permitida) y este bloque va **afuera**.

- [ ] **Step 9: Unitarios existentes de `salones.service.spec.ts`**

Correr `cd backend && npx jest src/modules/salones/salones.service.spec.ts`. Los tests que mockean
`manager.query`/`manager.save` por orden de llamada van a ver las consultas nuevas: ajustar los mocks
**sin debilitar lo que afirman** (agregar el `mockResolvedValueOnce` que falta, no cambiar un
`toHaveBeenCalledTimes` por un `toHaveBeenCalled`). Si alguno afirma "una sola escritura" y ahora hay dos,
decir en el reporte cuál y por qué el número cambió.

- [ ] **Step 10: El e2e pasa**

Run: `./scripts/reset-db.sh && cd backend && npx jest --config ./test/jest-e2e.json test/salones-reparto-linea.e2e-spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 11: Mutantes que revierten, medidos fila por fila**

Uno a la vez, correr la suite de arriba, anotar qué test muere, revertir y **mirar la hora del restart
del watcher** si hay stack levantado:

| Mutante | Debe matar |
|---|---|
| `actualizarLinea` suma el delta al garzón de la **primera fila** de la línea (el creador) en vez de `cuenta.garzonResponsableId` | test 2 |
| `agregarLinea` rama `match` no llama a `sumarAlReparto` | tests 3 y la invariante |
| `descontarReparto` sin la prioridad del responsable (solo por fecha) | test 4 **y** su unitario |
| `escribirAnulacionEnLinea` no descuenta | test 5 (invariante) |
| `fusionarCuentas` sin el bloque del reparto | test 7 |

- [ ] **Step 12: Docs**

`docs/features/salones-mesas.md`: en **Tablas**, la tabla nueva; una sección *"Quién sirvió cada
unidad: el reparto de la línea (2026-09-27)"* con el porqué (el "+" sobre la línea de otro), la tabla de
quién escribe (spec § 3.3), la regla de descuento y la invariante. Actualizar `Last Updated`. **Reescribir**,
no anexar: si la sección de "Responsable vigente y transferencias" dice que el responsable se pierde al
transferir, corregirla ahí.

- [ ] **Step 13: Gate completo y cierre**

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Con `./scripts/reset-db.sh` antes del `test:e2e` y `./scripts/reset-db.sh --verificar` después.
`verify-feature` con `domain-reviewer` (duda concreta a delegar: *¿algún camino que mueva la cantidad de
una línea quedó sin escribir el reparto, y la fusión puede violar el índice único?*) y
`api-security-reviewer` (entidad nueva). Stagear por ruta, commit
`feat(salones): el reparto de cada línea entre los garzones que la sirvieron (tarea 1)`.

---

### Task 2: `pedido` y `porcentaje` en el resumen

**Files:**
- Modify: `backend/src/modules/salones/anulaciones-reporte.service.ts` (`resumen`, tipos
  `ResumenAnulaciones`, `cerrarGrupo` o un paso después)
- Modify: `backend/src/modules/salones/anulaciones-reporte.service.spec.ts`
- Create: `backend/test/salones-anulaciones-porcentaje.e2e-spec.ts`
- Modify: `docs/features/salones-mesas.md`, `docs/PRODUCTO.md` (§ del reporte, ~línea 502),
  `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/resueltos.md`,
  `docs/superpowers/specs/2026-09-18-reporte-anulaciones-design.md` (§ 7: el % ya no está fuera)

**Interfaces:**
- Consumes: tabla `cuenta_linea_reparto` de la Task 1.
- Produces: en `GET /api/salones/anulaciones/resumen`, cada `porGarzon[i]` suma
  `pedido: string` (ESCALA_COSTO) y `porcentaje: string | null` (fracción, ESCALA_COSTO). Filas también
  para garzones sin anulaciones que pasen los filtros. Orden: `garzonNombre` ascendente, `null` al final.
  La Task 3 los lee con esos nombres.

- [ ] **Step 1: Unitarios del armado (fallan)**

En `anulaciones-reporte.service.spec.ts`, un `describe('resumen — pedido y porcentaje')`. El `resumen`
pasa a hacer **cuatro** consultas en este orden: base (existente), costos (existente, solo si hay ids con
costo), **vendido por garzón**, **anulado sin filtros de tipo/motivo por garzón**. Mocks:

```ts
it('pedido = vendido + anulado total; porcentaje = precioCarta filtrado / pedido, a 4 decimales', async () => {
  dbQueryMock
    .mockResolvedValueOnce([resumenRow({ garzon_id: 'g1', garzon_nombre: 'Ana', cantidad: '1', precio_unitario: '5000', tipo: TipoMotivoBaja.CORTESIA })])
    .mockResolvedValueOnce([]) // costos
    .mockResolvedValueOnce([{ garzon_id: 'g1', garzon_nombre: 'Ana', vendido: '95000.0000' }])
    .mockResolvedValueOnce([{ garzon_id: 'g1', garzon_nombre: 'Ana', anulado: '5000.0000' }]);
  const r = await service.resumen(TENANT, { desde: '2026-09-27', hasta: '2026-09-27' });
  expect(r.porGarzon).toEqual([
    expect.objectContaining({ garzonId: 'g1', precioCarta: '5000.0000', pedido: '100000.0000', porcentaje: '0.0500' }),
  ]);
});

it('un garzón que vendió sin anular aparece con 0 y porcentaje 0', async () => { /* base [] ; vendido [{g3,'Carla','90000'}] ; anulado [] */
  // expect porGarzon = [{ garzonId:'g3', garzonNombre:'Carla', platos:'0.0000', precioCarta:'0.0000', costo:[], sinValorizar:0, pedido:'90000.0000', porcentaje:'0.0000' }]
});

it('con filtro de tipo, el numerador baja y el pedido no', async () => {
  // base: solo la cortesía (el filtro ya actuó en SQL); anulado total: 5000 cortesía + 12000 merma = 17000; vendido 83000
  // pedido 100000, porcentaje 0.0500 — no 5000/88000
});

it('pedido 0 → porcentaje null', async () => { /* anulado total 0 (ítem precio 0), vendido [] */ });

it('orden por nombre, Sin garzón al final', async () => { /* g 'Beto', null, 'Ana' → Ana, Beto, null */ });
```

Escribir los cuatro cuerpos comentados como tests completos con el mismo molde que el primero (no dejar
comentarios en el archivo final). `resumenRow` es un helper del spec (si el archivo ya tiene uno para
las filas del resumen, usar ese) con los campos de
`ResumenBaseRow` (`id`, `cantidad`, `precio_unitario`, `tipo`, `garzon_id`, `garzon_nombre`,
`usuario_id`, `usuario_nombre`).

Y un test de que la consulta de **anulado** no lleva el filtro de tipo: con `{ tipo: 'cortesia' }`, el
SQL del cuarto `dbQueryMock.mock.calls` **no** contiene `mb.tipo =` y sus params no incluyen
`'cortesia'`. ⚠️ Acotar la aserción a la cláusula, no a un `toContain('tipo')` que matchee un comentario.

- [ ] **Step 2: Correrlos y verlos fallar**

Run: `cd backend && npx jest src/modules/salones/anulaciones-reporte.service.spec.ts`
Expected: FAIL (`pedido` undefined).

- [ ] **Step 3: Las dos consultas y el armado**

En `resumen`, después de `costosPorAnulacion`:

```ts
// Lo VENDIDO por garzón (spec § 4.1): el reparto de las líneas vivas de las
// cuentas cerradas en el rango, a precio de carta congelado. Filtra por
// `cerrada_el`, no por la fecha de la anulación: es otra cosa que pasó.
const vendidoParams: unknown[] = [tenantId];
const idxDiaV = dia ? empujarDiaNegocio(vendidoParams, dia) : null;
let vendidoFiltros = '';
if (query.garzonId) {
  vendidoParams.push(query.garzonId);
  vendidoFiltros += ` AND r.garzon_id = $${vendidoParams.length}`;
}
vendidoParams.push(query.desde);
vendidoFiltros += bordeFechaSql('c.cerrada_el', '>=', query.desde, vendidoParams.length, idxDiaV);
vendidoParams.push(query.hasta);
vendidoFiltros += bordeHastaSql('c.cerrada_el', query.hasta, vendidoParams.length, idxDiaV);

const vendidoRows: { garzon_id: string | null; garzon_nombre: string | null; vendido: string }[] =
  await this.db.query(
    `SELECT r.garzon_id, g.nombre AS garzon_nombre,
            SUM(ROUND(r.cantidad * cl.precio_unitario, 4)) AS vendido
       FROM cuenta_linea_reparto r
       JOIN cuenta_lineas cl ON cl.cuenta_linea_id = r.cuenta_linea_id AND cl.eliminado_el IS NULL
       -- Cuenta SIN filtro de borrado: la venta ya pasó, y borrar la cuenta
       -- después no puede bajar lo vendido sin avisar (mismo porqué que JOINS_BASE).
       JOIN cuentas c ON c.cuenta_id = cl.cuenta_id AND c.estado = 'cerrada'
       -- Una venta cancelada no vendió (spec § 4.2).
       JOIN ventas v ON v.venta_id = c.venta_id AND v.estado <> 'cancelada' AND v.eliminado_el IS NULL
       -- Garzón SIN filtro de borrado: mismo porqué que JOINS_BASE.
       LEFT JOIN garzones g ON g.garzon_id = r.garzon_id
      WHERE r.tenant_id = $1 AND r.eliminado_el IS NULL
        ${vendidoFiltros}
      GROUP BY r.garzon_id, g.nombre`,
    vendidoParams,
  );

// Lo ANULADO por garzón SIN los filtros de tipo y motivo (spec § 4.1): el
// denominador no puede moverse con el filtro, o el % de cortesías dejaría de
// ser "sobre lo pedido". Mismos JOINS_BASE y mismo `buildFilters`, con solo
// rango y garzón.
const { filters: filtrosTotal, params: paramsTotal } = this.buildFilters(
  tenantId,
  { desde: query.desde, hasta: query.hasta, garzonId: query.garzonId },
  dia,
);
const anuladoRows: { garzon_id: string | null; garzon_nombre: string | null; anulado: string }[] =
  await this.db.query(
    `SELECT cla.garzon_id, g.nombre AS garzon_nombre,
            SUM(ROUND(cla.cantidad * cla.precio_unitario, 4)) AS anulado
       ${JOINS_BASE}
         ${filtrosTotal}
      GROUP BY cla.garzon_id, g.nombre`,
    paramsTotal,
  );
```

Verificar contra `rango-fecha.util.ts` la firma real de `empujarDiaNegocio`, `bordeFechaSql` y
`bordeHastaSql` (se usan así en `buildFilters`) y que `FiltrosAnulacionesQuery` acepte el objeto sin
`tipo`/`motivoBajaId`.

Armado de `porGarzon`: la unión de claves (`garzon_id ?? SIN_GARZON`) de `porGarzon` (el mapa ya
acumulado), `vendidoRows` y `anuladoRows`. Para cada clave: el grupo existente, o uno vacío con
`meta: { garzonId, garzonNombre }` sacado de la fila que lo trajo; `pedido = vendido + anulado`
(Decimal, 0 si falta); `porcentaje = pedido.isZero() ? null : precioCarta.div(pedido).toFixed(ESCALA_COSTO)`.
Ordenar por `garzonNombre` con `localeCompare('es')`, `null` al final. `porTipo` y `porAutorizo` no cambian.
Extender el tipo `ResumenAnulaciones['porGarzon']` con `pedido: string; porcentaje: string | null`.

- [ ] **Step 4: Unitarios pasan**

Run: `cd backend && npx jest src/modules/salones/anulaciones-reporte.service.spec.ts`
Expected: PASS, incluidos los tests viejos del resumen (ajustar sus mocks sumando las dos consultas nuevas).

- [ ] **Step 5: E2E del % (falla primero, contra el código de la Task 1 sin el Step 3)**

`backend/test/salones-anulaciones-porcentaje.e2e-spec.ts`. Esqueleto: el de
`salones-anulaciones-reporte.e2e-spec.ts` (login admin + encargado, cocina, garzones propios con sesión,
salón y mesa) **más la caja propia** de `cuenta-precio-congelado.e2e-spec.ts` (abrir en `beforeAll`,
conteo y cierre en `afterAll`) y su `cerrar(cuentaId, garzon)` con `Idempotency-Key` y `pagos: []`.
**Tres garzones propios** (G1, G2, G3). Todas las aserciones filtran `porGarzon` por los ids propios:
el tenant tiene datos de otras suites del día.

Ítems propios en CLP con precio redondo: `ENTRADA` $10.000, `POSTRE` $5.000, `VINO` $20.000.

```ts
function fila(r: ResumenAnulaciones, g: GarzonCreado) {
  const f = r.porGarzon.find((x) => x.garzonId === g.id);
  expect(f).toBeDefined();
  return f!;
}
```

Tests:

1. **La escena del owner:** G1 abre, pide 4 × ENTRADA ($40.000); transferir a G2; G2 pide 1 × VINO
   ($20.000); cerrar con G2 → `fila(G1).pedido === '40000.0000'`, `fila(G2).pedido === '20000.0000'`,
   los dos con `porcentaje === '0.0000'` y `platos === '0.0000'`.
2. **El % sobre lo pedido:** G3 abre, pide 20 × POSTRE ($100.000), despachar, anular 1 como cortesía
   ($5.000), cerrar → vendido 95.000 + anulado 5.000: `pedido === '100000.0000'`,
   `precioCarta === '5000.0000'`, `porcentaje === '0.0500'`.
3. **El filtro de tipo mueve el numerador y no el denominador:** G3 abre otra cuenta, pide 2 × POSTRE,
   despachar, anular 1 como **merma**, cerrar (con una sola línea anulada entera, la cuenta se cancelaría:
   por eso 2) → pedido 110.000. Sin filtro: `precioCarta === '10000.0000'`, `porcentaje === '0.0909'`.
   Con `tipo=cortesia`: `precioCarta === '5000.0000'`, **el mismo** `pedido === '110000.0000'`,
   `porcentaje === '0.0455'`.
4. **Una cuenta abierta no suma a lo vendido:** G1 abre otra cuenta, pide 1 × VINO y no la cierra → el
   `pedido` de G1 no cambia. Cancelarla al final.
5. **Cancelar con motivo suma solo a lo anulado:** G2 abre, pide 1 × ENTRADA, despachar,
   `cancelar-con-motivo` (cortesía) → el `pedido` de G2 sube 10.000 y su `precioCarta` también.
6. **Σ pedido = carta cobrada + carta anulada (spec § 4.3)** para los tres garzones propios: calcularlo a
   mano desde los tests anteriores (dejarlo como constante del archivo, con el cálculo en un comentario
   de una línea), y además contra la base:

```ts
const cobrada: { total: string }[] = await ds.query(
  `SELECT COALESCE(SUM(ROUND(cl.cantidad * cl.precio_unitario, 4)), 0)::text AS total
     FROM cuenta_lineas cl JOIN cuentas c ON c.cuenta_id = cl.cuenta_id
    WHERE c.mesa_id = $1 AND c.estado = 'cerrada' AND cl.eliminado_el IS NULL`,
  [mesaId],
);
```

7. **Venta cancelada:** si `POST /api/ventas/:id/anular` deja la venta de una cuenta de mesa en
   `estado = 'cancelada'` (verificarlo leyendo `ventas.controller.ts`/`ventas.service.ts`, sin tocarlos),
   cerrar una cuenta de G1 con 1 × POSTRE, anular su venta → el `pedido` de G1 no suma esos 5.000. **Si
   anular una venta de mesa no es posible o exige algo fiscal, sacar el test y decirlo en el reporte**: el
   filtro `v.estado <> 'cancelada'` queda cubierto solo por el unitario de la forma del SQL, y eso se
   anota.

⚠️ El orden de los tests importa (van acumulando sobre los mismos garzones): no usar `it.only` ni
reordenar sin recalcular las constantes.

- [ ] **Step 6: E2E pasa**

Run: `./scripts/reset-db.sh && cd backend && npx jest --config ./test/jest-e2e.json test/salones-anulaciones-porcentaje.e2e-spec.ts test/salones-anulaciones-reporte.e2e-spec.ts`
Expected: PASS los dos archivos (el viejo también, con las filas nuevas en `porGarzon`).

- [ ] **Step 7: ¿Hace falta un índice?**

Con el stack del worktree y datos bien repartidos (muchas cuentas cerradas en días distintos, no todas
hoy: si hace falta, sembrarlas en la base del worktree con un script en el scratchpad, **nunca** en el
seeder), correr `EXPLAIN (ANALYZE, BUFFERS)` de la consulta de lo vendido con un rango de un día. Si el
plan barre `cuentas` entera, probar `@Index('idx_cuentas_cerrada', ['tenantId', 'cerradaEl'])` en
`cuenta.entity.ts` y medir las dos filas (sin / con) como el docblock de `idx_cuentas_estado`. Solo se
agrega si cambia el plan; los números van en el docblock. Si no se agrega, decir en el reporte qué se
midió.

- [ ] **Step 8: Mutantes que revierten, medidos fila por fila**

| Mutante | Debe matar |
|---|---|
| `pedido = vendido` (sin lo anulado) — revierte "sobre lo pedido" | e2e 2 y 5, unitario 1 |
| la consulta de anulado usa `filters` (con tipo) en vez de `filtrosTotal` | e2e 3, unitario "filtro de tipo" |
| se descartan las claves que solo vienen de `vendidoRows` — revierte "Carla con 0%" | e2e 1, unitario 2 |
| `vendido` lee `cuentas.garzon_responsable_id` en vez del reparto — revierte el reparto | e2e 1 |
| sin `c.estado = 'cerrada'` | e2e 4 |
| sin `v.estado <> 'cancelada'` | e2e 7 (o anotado como superviviente, con el porqué medido) |

- [ ] **Step 9: Docs**

- `docs/features/salones-mesas.md`, sección del reporte de anulaciones: el `%`, sus tres cifras, qué
  entra y qué no (spec § 4.2), y que los garzones sin anulaciones aparecen.
- `docs/PRODUCTO.md` (§ del reporte, ~línea 502): la regla del owner en una frase (reparto, carta, sobre
  lo pedido).
- `docs/ESTADO.md`: la fila del reporte de anulaciones, con la fecha.
- `docs/agent/pendientes.md`: la entrada *"% de anulaciones y cortesías…"* sale a `resueltos.md` con el
  detalle; entra en la sección que corresponda *"Las notas de crédito no restan de lo vendido en el % de
  anulaciones por garzón"* (fiscal, va solo). **Nada queda marcado ✅ en `pendientes.md`.**
- `docs/superpowers/specs/2026-09-18-reporte-anulaciones-design.md` § 7: el ítem del % apunta a la spec
  nueva en vez de decir que está fuera.

- [ ] **Step 10: Gate completo y cierre**

Mismo gate que la Task 1 (con `reset-db.sh` antes y `--verificar` después). `verify-feature` con
`domain-reviewer` (duda concreta: *¿alguna lectura nueva sin `eliminado_el IS NULL` sin su porqué, y el
denominador puede contar dos veces una anulación?*). No toca controller ni DTO: sin
`api-security-reviewer`, salvo que el Step 3 haya obligado a tocar el DTO. Commit
`feat(salones): el % de anulaciones y cortesías sobre lo pedido, por garzón (tarea 2)`.

---

## Frontend

### Task 3: La columna "% de lo pedido"

**Files:**
- Modify: `frontend/app/pages/salones/anulaciones.vue` (tipo `GrupoPorGarzon`, `columnasGarzon`, slot
  de la celda)
- Modify: `frontend/app/pages/salones/anulaciones.nuxt.spec.ts`
- Create or modify: el spec de Playwright del reporte, si existe (`frontend/e2e/`); si no, un smoke con
  un spec nuevo que entre con `auth.setup.ts`
- Modify: `docs/ESTADO.md` si la Task 2 no la dejó al día

**Interfaces:**
- Consumes: `porGarzon[i].pedido: string`, `porGarzon[i].porcentaje: string | null` (Task 2).

- [ ] **Step 1: Spec de la página (falla)**

En `anulaciones.nuxt.spec.ts`, con el mock de `useApiFetch` que ya usa el archivo: un resumen con dos
filas en `porGarzon`, una con `porcentaje: '0.0500'` y otra con `porcentaje: null` → la tabla muestra
el encabezado `% de lo pedido`, `5,00%` en la primera y `—` en la segunda.

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `cd frontend && npx vitest run app/pages/salones/anulaciones.nuxt.spec.ts`
Expected: FAIL (no existe la columna).

- [ ] **Step 3: La columna**

En `anulaciones.vue`: sumar `pedido: string` y `porcentaje: string | null` a `GrupoPorGarzon`; en
`columnasGarzon`, después de `precioCarta`:

```ts
{ accessorKey: 'porcentaje', header: '% de lo pedido', meta: { class: { th: 'text-right', td: 'text-right' } } },
```

y el slot, al lado de los otros de esa tabla:

```vue
<template #porcentaje-cell="{ row }">
  {{ formatPorcentaje(row.original.porcentaje) }}
</template>
```

`formatPorcentaje` sale de `useFormatters` (ya devuelve `—` con null): sumarlo a la desestructuración
existente de `useFormatters()` en la página. Nada de lógica en la página.

- [ ] **Step 4: Spec pasa; build, typecheck, design**

Run: `cd frontend && npx vitest run app/pages/salones/anulaciones.nuxt.spec.ts && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: PASS.

- [ ] **Step 5: Smoke en navegador**

`./scripts/entorno.sh stack`, `./scripts/reset-db.sh`. Con un spec de Playwright (entra por
`auth.setup.ts`, no se tipean credenciales): como **encargado del salón** (el rol real con
`Salones:Ver todas`, no admin), abrir una cuenta con un garzón propio, pedir, despachar, anular una
cortesía, cerrar, ir a `/salones/anulaciones` → la fila del garzón muestra el `%` esperado, y a ancho de
teléfono (375 px) la tabla no rompe el layout. Si el spec queda útil, se conserva con `@smoke`; si no, se
dice que fue desechable.

- [ ] **Step 6: Gate completo y cierre**

Gate completo, `verify-feature` con `domain-reviewer`. Commit
`feat(salones): la columna % de lo pedido en el reporte de anulaciones (tarea 3)`.

---

## Verification

Por tarea: el gate del `CLAUDE.md` entero (no un subset), `reset-db.sh` antes del e2e y `--verificar`
después, `verify-feature` con su recibo, mutantes medidos fila por fila. Al final: **revisión de la rama
entera** (`domain-reviewer`, `model: 'sonnet'`, sobre `main...HEAD`), con la duda concreta *¿la Task 2
lee el reparto como la Task 1 lo escribe, incluida la fusión, y hay alguna contradicción entre las dos?*
Después, rebase sobre `main` con el árbol limpio y aviso a la orquestadora con rama, hash, conteos del
gate y veredictos.

## Decisions / Open questions

- **Decididas por el owner:** spec § 2 (reparto 2026-09-20; carta, sobre lo pedido y Carla con 0%
  2026-09-27).
- **Decididas en el diseño (técnicas):** tabla y no columna (spec § 3.1); la regla de descuento (§ 3.3);
  el denominador ignora los filtros de tipo y motivo (§ 4.1); orden por nombre.
- **Abiertas:** ninguna. Si la Task 2, Step 5, test 7 muestra que anular una venta de mesa toca lo
  fiscal, el test sale y se anota; no se pregunta ni se construye nada para resolverlo.
