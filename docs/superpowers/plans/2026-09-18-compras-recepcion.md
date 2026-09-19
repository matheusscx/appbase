# Plan: Compras, pieza 1 — recibir mercadería

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** In Progress · **Date:** 2026-09-18 · **Owner:** Cesar Matheus
**Worktree:** `.claude/worktrees/compras-recepcion`, rama `compras-recepcion` (sale de `main` en `dfba1818`).

**Goal:** Una compra con encabezado (proveedor, documento, folio, ubicación) y líneas, que pasa de
borrador a confirmada, mete stock y costo, y se puede completar, corregir y anular con el costo
rehecho desde la recepción.

**Architecture:** Un módulo nuevo `compras` en el backend, con el molde de `recuentos` para el
documento (encabezado + líneas en tablas propias) y el de `traslados` para la transacción de
confirmar (locks ordenados por `item_id`, reintento de deadlock). Todo lo que toca el kardex y el
costo pasa por `InventarioService`, que sigue siendo el único que escribe `movimientos_inventario`
y `costo_actual`. En el frontend, una página propia de carga (no un drawer) y un listado.

**Tech Stack:** NestJS + TypeORM (`synchronize`) + PostgreSQL 15, Decimal.js, class-validator;
Nuxt 4 + Nuxt UI v4; Jest + supertest; Vitest.

**Spec:** [`docs/superpowers/specs/2026-09-18-compras-recepcion-design.md`](../specs/2026-09-18-compras-recepcion-design.md).
Decisiones del owner: [`docs/agent/investigaciones/2026-09-18-compras.md`](../../agent/investigaciones/2026-09-18-compras.md) § 5 y § 5b.

## Estado de las tareas 5 a 10: desbloqueadas, todavía sin código fijado

El frente del CPP con stock total **cerró en `6f5a1821`** (2026-09-18) y esta rama ya está
rebasada encima. Lo que cambió en `inventario.service.ts`, revisado contra el diff:

- Solo en las entradas que recalculan con costo (`compra`, `anulacion`, `devolucion`),
  `registrarMovimiento` lee `SUM(stock)` de `stock_ubicacion` con `JOIN ubicaciones … AND
  u.eliminado_el IS NULL`, **después** del `FOR UPDATE OF ip` y **antes** del upsert del saldo, y
  se lo pasa a `calcularCostoPromedio` (el parámetro pasó a llamarse `stockPrevio`).
- **No cambiaron** la firma pública de `registrarMovimiento`
  (`RegistrarMovimientoParams` y su retorno), el lock (`FOR UPDATE OF ip`) ni la regla de
  reinicio (`stockPrevio <= 0` o sin costo previo → manda el costo de compra).
- **Lo que este frente no resolvió:** el kardex sigue guardando el saldo **por ubicación**. El
  stock total histórico no está escrito en ningún lado, y "rehacer la cuenta" (T7) lo reconstruye
  desde `stock_total_anterior`, congelado en la línea, más las cantidades posteriores (spec § 4.3).

Por eso:

- **Tareas 1 a 4:** se hacen primero; no tocan `inventario.service.ts`.
- **Tareas 5 a 10:** ya no esperan nada externo, pero siguen con **intención y contrato**. El código
  se escribe al ejecutarlas, contra el `inventario.service.ts` de ese momento, porque la tarea 5
  cambia el chokepoint y todo lo demás depende de cómo quede.
- **La rama no se integra a `main` hasta la tarea 11.** El estado intermedio (borradores que no se
  pueden confirmar) no llega a nadie.

### Ejecución (2026-09-18)

Los hashes son los de la rama **después** del rebase sobre `8dadb792`. Cada rebase los reescribe,
así que la tarea 11 los vuelve a copiar de `git log` después del rebase final.

| Tarea | Commit | Lo que cambió respecto del plan |
|---|---|---|
| 1 | `3f6d6aa7` | La revisión independiente encontró que al usuario fixture le faltaba la fila en `usuarios_tenants` (sin ella no entra a Paris) |
| 2 | `3e66706d` | Sin cambios |
| 3 | `0bd439e6` | Se compran `producto` **e** `ingrediente` (owner). Un fixture más, `compras.lectura` (ids …441/…442, del bloque 441–445): sin él, un `POST` guardado con `Leer` pasaba la suite. La revisión agregó `EscalaMonedaPipe` al body (el `@EsCosto()` solo no valida) y cambió la validación de unidades a `crearConversor` |
| 4 | `4d2c06b3` | `useCompras()` devuelve funciones, como `useEstadoVenta`. El precio usa `MoneyInput` en vez de un `UInput` |
| 5 | `8b0027e6` | Sin `registrarCorreccionCosto`: `correccion_compra` es un ajuste de valor como `ajuste_costo` (ver la tarea 5). El e2e de la secuencia usa 5 concurrentes, no 10, porque con 10 el pool de conexiones se agotaba |
| 6 | `69a0127a` | Va **antes** que la 7 (OK del owner). Toma `bloquearContraBorrado` por su cuenta, **antes** del lock de productos, aunque `registrarMovimiento` lo repita: bloquea todos los productos en un solo statement antes de mover nada (para leer el stock total con los locks tomados), y el orden tiene que ser ubicación → productos. El front guarda lo que está en pantalla y después confirma, detrás de un modal con el resumen |
| 5, seguimiento | `650f2edf`, `1a2725d9` | `stockTotalPorProducto` recibe el tenant y lo acota por la ubicación (hallazgo MEDIO de la revisión de seguridad). **`compras` pierde `eliminado_por`**: la suite completa mostró que el test de la papelera exige decidir si toda tabla con esa columna va a la papelera, y el owner decidió que un borrador descartado **no** va (2026-09-18). El bloque de código de la tarea 1 muestra la entidad como se escribió entonces |

## Global Constraints

- `tenant_id` sale **siempre del token** (`req.user.tenantId`), nunca del body, la query ni la ruta.
- Plata y cantidades con **Decimal.js**, nunca `number`. En la API viajan como **string**
  (`@IsNumberString`).
- `precioUnitario`: `@EsCosto()` (escala 4). `descuentoTotal`: `@EsMontoCobrado()` más
  `@Body(EscalaMonedaPipe)` en el handler (escala de la moneda oficial).
- **Soft delete en todo.** Toda lectura nueva filtra `eliminado_el IS NULL` en cada join, salvo
  excepción **escrita en la propia consulta**.
- PK/FK con `type: 'uuid'` explícito. Toda entidad nueva va **también** en el array `entities` de
  `app.module.ts`: no hay `autoLoadEntities`.
- Repos con `RepositoriosModule.forFeature`, nunca `TypeOrmModule.forFeature`. Transacciones con
  `db.transaccion`. Nunca `DataSource` directo fuera del seeder.
- **Sin N+1:** lo derivado por fila va en una sola query (`JOIN`/agregación o
  `WHERE id = ANY($1)`).
- Errores de negocio en español (`BadRequestException`, `ConflictException`,
  `NotFoundException`).
- Frontend: `useApiFetch`/`$fetch`, nunca axios. Tokens semánticos de Nuxt UI, nunca colores
  Tailwind hardcodeados. Utilidades de presentación en `app/composables/`, nunca locales a un
  `.vue`. Montos en `UInput` con `inputmode="decimal"` y **string**, nunca `type="number"`.
- **Ids fijos del seed: rango reservado `…420`–`…440`** por la sesión coordinadora
  (2026-09-18). En `main` el máximo es `…406`, pero la rama `claude/dashboard-inicio` (KPIs) ya
  siembra `…407`–`…409` y puede sumar más; el hueco `…410`–`…419` es su margen. Al ejecutar la
  tarea 1 se vuelve a medir, con el método de `docs/patterns/backend.md` § 8, contra `main`
  **y contra las ramas vivas**.
- **Stack compartido:** antes de cualquier `reset-db.sh` o `test:e2e`, **pedir turno** a la sesión
  coordinadora. No tocar un `.ts` del backend con el e2e corriendo. Después del e2e,
  `./scripts/reset-db.sh --verificar`.
- **Commits:** stagear **por ruta explícita**, nunca `git add -A`. Revisar
  `git diff --cached --stat` antes de cada commit. Sin push. Sin `--no-verify`.

## File Structure

**Backend — nuevo `backend/src/modules/compras/`:**

| Archivo | Responsabilidad |
|---|---|
| `entities/tipo-documento-compra.entity.ts` | Catálogo por país (§ 3.3) |
| `entities/compra.entity.ts` | Encabezado (§ 3.1) |
| `entities/compra-linea.entity.ts` | Líneas (§ 3.2) |
| `entities/compra-linea-cambio.entity.ts` | Historial (§ 3.5) |
| `dto/compra-borrador.dto.ts` | Body de `POST` y `PATCH /compras` |
| `dto/find-compras.dto.ts` | Query del listado |
| `reparto-descuento.ts` + `.spec.ts` | Función pura: descuento → costo por unidad base |
| `compras.service.ts` + `.spec.ts` | Borrador, lecturas; más tarde confirmar, corregir y anular |
| `compras.controller.ts` | Rutas y permisos |
| `compras.module.ts` | Wiring |

**Backend — modificados:** `app.module.ts` (entities + import),
`seeder/seeder.service.ts` (catálogo, módulo, permisos, rol y usuario fixture).
Desde la tarea 5: `inventario/entities/movimiento-inventario.entity.ts`,
`inventario/inventario.service.ts`.

**Backend — tests:** `test/compras.e2e-spec.ts`.

**Frontend:**

| Archivo | Responsabilidad |
|---|---|
| `app/composables/useCompras.ts` + `.spec.ts` | Total de línea mostrado, subtotal, insignia de estado |
| `app/pages/compras/index.vue` | Listado con filtros |
| `app/pages/compras/[id].vue` | Carga del borrador (`nueva` o id) y, más tarde, el detalle de una confirmada |
| `app/pages/compras/compras-carga.nuxt.spec.ts` | Spec de componente de la página de carga |
| `app/layouts/dashboard.vue` | Entrada "Compras" en el menú |

**Docs (tarea 11):** `docs/features/compras.md`, `docs/README.md`, `docs/ESTADO.md`,
`startup-pos.sql`, `docs/agent/pendientes.md`.

---

### Task 1: Esquema, catálogo de documentos y módulo `Compras` en el seed

**Files:**
- Create: `backend/src/modules/compras/entities/tipo-documento-compra.entity.ts`
- Create: `backend/src/modules/compras/entities/compra.entity.ts`
- Create: `backend/src/modules/compras/entities/compra-linea.entity.ts`
- Create: `backend/src/modules/compras/entities/compra-linea-cambio.entity.ts`
- Create: `backend/src/modules/compras/compras.module.ts` (sin controller todavía)
- Modify: `backend/src/app.module.ts` (array `entities` + `imports`)
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Modify: `backend/src/modules/seeder/seeder.module.ts` (si el seeder inyecta el repo del catálogo)
- Test: `backend/test/esquema.e2e-spec.ts` (ya existe: verifica `uuid` explícito en PK/FK), corrido en la tarea 3 junto al e2e del módulo

**Interfaces:**
- Produces: las clases `TipoDocumentoCompra`, `Compra`, `CompraLinea`, `CompraLineaCambio` con los
  nombres de propiedad de abajo. El módulo `Compras` con acciones `Leer`, `Crear`, `Actualizar` y
  `Anular`. El usuario fixture `encargado.compras@paris.cl` (pass del seed `admin`).

- [x] **Step 1: Verificar que el rango reservado `…420`–`…440` sigue libre**, con el método de
  `docs/patterns/backend.md` § 8 (literales, `const uuid = ` y los loops `let id =`), contra
  `main` **y** contra cada rama viva que toque el seeder:

```bash
git worktree list
git diff main...claude/dashboard-inicio -- backend/src/modules/seeder/seeder.service.ts | grep -o "446655440[0-9]\{3\}" | sort -u
```

  Si algo del rango ya está tomado, **parar y pedirle un rango nuevo a la sesión coordinadora**.
  No correrlo por cuenta propia.

- [x] **Step 2: `tipo-documento-compra.entity.ts`**

```ts
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Los documentos que un local RECIBE de un proveedor, por país. Tabla y no
 * enum, por la misma regla que los de venta. Va aparte de
 * `tipos_documento_tributario` porque esa alimenta el selector del POS
 * (spec compras-recepcion § 3.3).
 */
@Entity('tipos_documento_compra')
export class TipoDocumentoCompra {
  @PrimaryGeneratedColumn('uuid', { name: 'tipo_documento_compra_id' })
  id: string;

  @Column({ name: 'pais_id', type: 'uuid' })
  paisId: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  /** Código tributario (33, 34, 46, 52, 39). Null si no es tributario. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  codigo: string | null;

  /** "Sin documento" es el único que no lo pide. */
  @Column({ name: 'requiere_folio', type: 'boolean', default: true })
  requiereFolio: boolean;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

- [x] **Step 3: `compra.entity.ts`**

```ts
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type EstadoCompra = 'borrador' | 'confirmada' | 'anulada';

/**
 * Encabezado de una compra (spec compras-recepcion § 3.1).
 *
 * El índice único es la red contra el folio repetido: por ley el folio es
 * único por emisor y tipo de documento, así que un repetido es siempre un
 * error (owner, 2026-09-18). "Sin documento" no tiene folio y queda fuera; una
 * compra anulada libera el suyo para cargarla bien.
 */
@Entity('compras')
@Index(
  'uq_compra_folio',
  ['tenantId', 'proveedorId', 'tipoDocumentoCompraId', 'folio'],
  {
    unique: true,
    where: `"folio" IS NOT NULL AND "estado" <> 'anulada' AND "eliminado_el" IS NULL`,
  },
)
export class Compra {
  @PrimaryGeneratedColumn('uuid', { name: 'compra_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'proveedor_id', type: 'uuid' })
  proveedorId: string;

  @Column({ name: 'tipo_documento_compra_id', type: 'uuid' })
  tipoDocumentoCompraId: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  folio: string | null;

  @Column({ name: 'fecha_documento', type: 'date' })
  fechaDocumento: string;

  @Column({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

  // `text` explícito: una unión estrecha importada con `import type` deja
  // `design:type` en Object y rompe el arranque (docs/agent: typeorm tipo de
  // columna explícito).
  @Column({ type: 'text', default: 'borrador' })
  estado: EstadoCompra;

  /** Monto a la escala de la moneda oficial. Solo con todas las líneas con precio. */
  @Column({ name: 'descuento_total', type: 'numeric', precision: 18, scale: 4, nullable: true })
  descuentoTotal: string | null;

  @Column({ type: 'text', nullable: true })
  observacion: string | null;

  @Column({ name: 'creado_por', type: 'uuid' })
  creadoPor: string;

  @Column({ name: 'confirmado_por', type: 'uuid', nullable: true })
  confirmadoPor: string | null;

  @Column({ name: 'confirmado_el', type: 'timestamptz', nullable: true })
  confirmadoEl: Date | null;

  @Column({ name: 'anulado_por', type: 'uuid', nullable: true })
  anuladoPor: string | null;

  @Column({ name: 'anulado_el', type: 'timestamptz', nullable: true })
  anuladoEl: Date | null;

  @Column({ name: 'motivo_anulacion', type: 'text', nullable: true })
  motivoAnulacion: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  /** Solo un BORRADOR descartado se borra. Una confirmada se anula, nunca se borra. */
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
```

- [x] **Step 4: `compra-linea.entity.ts`**

```ts
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface SerieCompraInput {
  serie: string;
  condicion?: 'nuevo' | 'usado' | 'reacondicionado';
  garantiaHasta?: string;
}

export interface LoteCompraInput {
  codigoLote: string;
  fechaElaboracion?: string;
  fechaVencimiento?: string;
}

/**
 * Línea de una compra (spec compras-recepcion § 3.2). Lo que el encargado
 * tipea (`cantidad`, `unidadCodigo`, `precioUnitario`) se guarda tal cual; lo
 * de "Congelado al confirmar" lo escribe la confirmación y no se edita.
 */
@Entity('compra_lineas')
@Index('idx_compra_lineas_compra', ['compraId'])
export class CompraLinea {
  @PrimaryGeneratedColumn('uuid', { name: 'compra_linea_id' })
  id: string;

  @Column({ name: 'compra_id', type: 'uuid' })
  compraId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'int' })
  orden: number;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({ name: 'unidad_codigo', type: 'text' })
  unidadCodigo: string;

  /** Por unidad TIPEADA. Null = falta costo. `>= 0`: el 0 es el regalo. */
  @Column({ name: 'precio_unitario', type: 'numeric', precision: 18, scale: 4, nullable: true })
  precioUnitario: string | null;

  @Column({ type: 'jsonb', nullable: true })
  series: SerieCompraInput[] | null;

  @Column({ type: 'jsonb', nullable: true })
  lote: LoteCompraInput | null;

  // ── Congelado al confirmar ────────────────────────────────────────────
  @Column({ name: 'cantidad_base', type: 'numeric', precision: 18, scale: 4, nullable: true })
  cantidadBase: string | null;

  @Column({ name: 'costo_unitario_base', type: 'numeric', precision: 18, scale: 4, nullable: true })
  costoUnitarioBase: string | null;

  @Column({ name: 'movimiento_id', type: 'uuid', nullable: true })
  movimientoId: string | null;

  @Column({ name: 'stock_total_anterior', type: 'numeric', precision: 18, scale: 4, nullable: true })
  stockTotalAnterior: string | null;

  @Column({ name: 'costo_producto_anterior', type: 'numeric', precision: 18, scale: 4, nullable: true })
  costoProductoAnterior: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

- [x] **Step 5: `compra-linea-cambio.entity.ts`**

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Historial de correcciones de una línea confirmada (spec § 3.5). Append-only. */
@Entity('compra_linea_cambios')
@Index('idx_compra_linea_cambios_linea', ['compraLineaId'])
export class CompraLineaCambio {
  @PrimaryGeneratedColumn('uuid', { name: 'compra_linea_cambio_id' })
  id: string;

  @Column({ name: 'compra_linea_id', type: 'uuid' })
  compraLineaId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  campo: 'precio' | 'cantidad' | 'descuento';

  @Column({ name: 'valor_anterior', type: 'text', nullable: true })
  valorAnterior: string | null;

  @Column({ name: 'valor_nuevo', type: 'text', nullable: true })
  valorNuevo: string | null;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  /** La diferencia de stock o la `correccion_compra` que generó. */
  @Column({ name: 'movimiento_id', type: 'uuid', nullable: true })
  movimientoId: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;
}
```

> Append-only: sin `eliminado_el`, igual que el kardex. Si el test de esquema exige la columna a
> toda tabla, se agrega nullable y se deja escrito el porqué en el docblock.

- [x] **Step 6: `compras.module.ts` y `app.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Compra } from './entities/compra.entity';
import { CompraLinea } from './entities/compra-linea.entity';
import { CompraLineaCambio } from './entities/compra-linea-cambio.entity';
import { TipoDocumentoCompra } from './entities/tipo-documento-compra.entity';

@Module({
  imports: [
    RepositoriosModule.forFeature([Compra, CompraLinea, CompraLineaCambio, TipoDocumentoCompra]),
  ],
})
export class ComprasModule {}
```

En `app.module.ts`: sumar las cuatro clases al array `entities` del `TypeOrmModule.forRoot` y
`ComprasModule` a `imports`.

- [x] **Step 7: Seed.** En `seeder.service.ts`, siguiendo los moldes que se citan:

  1. **Catálogo:** `seedTiposDocumentoCompra()`, llamado después de `seedTiposDocumentoTributario()`
     (línea ~201 de `onApplicationBootstrap`), con `INSERT … ON CONFLICT DO NOTHING` y los países
     de `seedTiposDocumentoTributario` (`CHILE …000`, `ARGENTINA …372`, `COLOMBIA …373`,
     `MEXICO …374`):

     | id | país | nombre | codigo | requiere_folio |
     |---|---|---|---|---|
     | 420 | CL | Factura | 33 | true |
     | 421 | CL | Factura exenta | 34 | true |
     | 422 | CL | Factura de compra | 46 | true |
     | 423 | CL | Guía de despacho | 52 | true |
     | 424 | CL | Boleta | 39 | true |
     | 425 | CL | Sin documento | null | false |
     | 426 / 427 | AR | Factura / Sin documento | null | true / false |
     | 428 / 429 | CO | Factura / Sin documento | null | true / false |
     | 430 / 431 | MX | Factura / Sin documento | null | true / false |

  2. **Módulo:** en el array `modulos` (`seedModulosApp`, ~línea 624), `{ moduloAppId: …432,
     nombre: 'Compras', … }` con los mismos campos que la fila de `Inventario`.
  3. **Permisos del módulo** en `seedModuloAppPermisos` (~línea 783), con las constantes que ya
     existen (`LEER`, `CREAR`, `ACTUALIZAR`, `ANULAR …333`): `…433` Leer, `…434` Crear, `…435`
     Actualizar, `…436` Anular.
  4. **Contratado** en `seedTenantModulo` (~línea 1772): Paris `…437` y Falabella `…438`, con el
     mismo `estado` y `expiraEn` que Inventario.
  5. **Rol fixture** `seedRolEncargadoCompras()`, copiando la forma de `seedRolEncargadoSalon`
     (~línea 2824): rol `…439` "Compras · Encargado" en Paris, con las cuatro acciones sobre el
     `moduloTenantId` `…437`; usuario `…440` `encargado.compras` / `encargado.compras@paris.cl`,
     agregado a `seedUsuariosAdicionales` con el mismo `HASH`. Se llama junto a
     `seedRolEncargadoSalon()` (~línea 214).
     > **Desvío de la spec, a confirmar con el owner al revisar el plan:** la spec dice "el rol
     > Encargado recibe las cuatro acciones", pero en el seed no hay un único "Encargado", sino
     > `Encargado Cajas`, `Salones · Encargado` e `Inventario · …`. Se crea un rol propio para no
     > darle compras de arrastre a un rol de otro módulo, y porque las suites de ese rol no
     > deberían cambiar de conducta.
  6. Un comentario arriba del rango: *"Rango 420–440, reservado por la sesión coordinadora el
     2026-09-18: en main el máximo era 406, y la rama de KPIs (`claude/dashboard-inicio`) toma
     407–409 con margen hasta 419. Medido con § 8 contra main y las ramas vivas."*

- [x] **Step 8: Verificar que compila y arranca.**

Run: `cd backend && npm run typecheck && npm run lint:check`
Expected: sin errores.
El arranque real (synchronize + seed) se mide en la tarea 3, con turno de stack.

- [x] **Step 9: Commit**

```bash
git add backend/src/modules/compras/entities backend/src/modules/compras/compras.module.ts backend/src/app.module.ts backend/src/modules/seeder/seeder.service.ts
git diff --cached --stat
git commit -m "feat(compras): esquema, catálogo de documentos y módulo Compras en el seed"
```

---

### Task 2: Reparto del descuento al total

Función pura, sin base ni Nest. Reusa `repartirProporcional` del motor, la misma regla de residuo
que ya usan la nota de crédito y los combos (*"no se inventa una cuarta regla de residuo"*,
`ventas/nota-credito-composicion.ts`). Esa es la medición que pide la spec § 4.2: la regla existe,
está probada y es la del repo.

**Files:**
- Create: `backend/src/modules/compras/reparto-descuento.ts`
- Test: `backend/src/modules/compras/reparto-descuento.spec.ts`

**Interfaces:**
- Consumes: `repartirProporcional`, `cuantizar`, `ConfigCalculo` de
  `calculo-precios/calculo-precios.engine.ts`; `convertirCostoUnitario` (el mismo import que
  `items.service.ts`).
- Produces:

```ts
export interface LineaParaCostear {
  cantidad: string;       // tipeada
  precioUnitario: string; // por unidad tipeada
  cantidadBase: string;   // ya convertida a la unidad base
}
/** Costo por unidad base de cada línea, a escala 4, en el mismo orden. */
export function costearLineas(
  lineas: LineaParaCostear[],
  descuentoTotal: string | null,
  cfg: ConfigCalculo,
): string[];
```

- [x] **Step 1: Test que falla**

```ts
import Decimal from 'decimal.js';
import { costearLineas } from './reparto-descuento';
import type { ConfigCalculo } from '../calculo-precios/calculo-precios.engine';

const cfgCLP = {
  formula: ['descuentos', 'recargos', 'impuestos'],
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  escalaCalculo: 4,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  promosAcumulanDescuentos: false,
  decimalesMoneda: 0,
} as unknown as ConfigCalculo;

describe('costearLineas', () => {
  it('sin descuento, el costo base es el precio convertido', () => {
    // 10 cajas a $9.600, 120 latas base
    expect(
      costearLineas([{ cantidad: '10', precioUnitario: '9600', cantidadBase: '120' }], null, cfgCLP),
    ).toEqual(['800.0000']);
  });

  it('reparte el 5% al total según el valor: la lata queda a $760 (spec § 2)', () => {
    const r = costearLineas(
      [
        { cantidad: '10', precioUnitario: '9600', cantidadBase: '120' }, // $96.000
        { cantidad: '5', precioUnitario: '6000', cantidadBase: '60' },   // $30.000
      ],
      '6300',
      cfgCLP,
    );
    expect(r).toEqual(['760.0000', '475.0000']);
  });

  it('la suma de lo descontado calza al peso con un descuento que no divide exacto', () => {
    const lineas = [
      { cantidad: '3', precioUnitario: '1000', cantidadBase: '3' },
      { cantidad: '3', precioUnitario: '1000', cantidadBase: '3' },
      { cantidad: '3', precioUnitario: '1000', cantidadBase: '3' },
    ];
    const r = costearLineas(lineas, '100', cfgCLP);
    const valorFinal = r.reduce(
      (acc, c, i) => acc.plus(new Decimal(c).times(lineas[i].cantidadBase)),
      new Decimal(0),
    );
    // 9.000 − 100 = 8.900, y no 8.899,99 ni 8.900,01
    expect(valorFinal.toDecimalPlaces(0).toString()).toBe('8900');
  });

  it('una línea a $0 (regalo) no recibe descuento', () => {
    const r = costearLineas(
      [
        { cantidad: '12', precioUnitario: '9600', cantidadBase: '144' },
        { cantidad: '1', precioUnitario: '0', cantidadBase: '12' },
      ],
      '1152',
      cfgCLP,
    );
    expect(r[1]).toBe('0.0000');
    expect(r[0]).toBe('792.0000'); // (115.200 − 1.152) / 144
  });
});
```

- [x] **Step 2: Correrlo y ver que falla**

Run: `cd backend && npx jest src/modules/compras/reparto-descuento.spec.ts`
Expected: FAIL, *"Cannot find module './reparto-descuento'"*.

- [x] **Step 3: Implementación**

```ts
import Decimal from 'decimal.js';
import {
  cuantizar,
  repartirProporcional,
  type ConfigCalculo,
} from '../calculo-precios/calculo-precios.engine';

export interface LineaParaCostear {
  cantidad: string;
  precioUnitario: string;
  cantidadBase: string;
}

/** Escala del costo (`ESCALA_COSTO`): es una tasa interna, no plata cobrada. */
const ESCALA_COSTO = 4;

/**
 * Costo por unidad base de cada línea de una compra, con el descuento al
 * total repartido según el valor de cada línea (spec compras-recepcion § 4.2).
 *
 * El descuento se reparte con `repartirProporcional`, la regla de residuo
 * del repo (resto más grande, desempate por posición): así lo descontado
 * suma exacto el descuento. Una línea a $0 pesa 0 y no recibe nada. El costo
 * por unidad sale a escala 4 con HALF_UP fijo, el mismo criterio que el CPP:
 * no es plata cobrada y no mira `modo_redondeo`.
 */
export function costearLineas(
  lineas: LineaParaCostear[],
  descuentoTotal: string | null,
  cfg: ConfigCalculo,
): string[] {
  const valores = lineas.map((l) => new Decimal(l.cantidad).times(l.precioUnitario));
  const descuento = new Decimal(descuentoTotal ?? 0);
  const partes = descuento.isZero()
    ? valores.map(() => new Decimal(0))
    : repartirProporcional(descuento, valores, cfg, (d) => cuantizar(d, cfg));
  return lineas.map((l, i) =>
    valores[i]
      .minus(partes[i])
      .dividedBy(l.cantidadBase)
      .toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP)
      .toFixed(ESCALA_COSTO),
  );
}
```

> ⚠️ **Antes de dar por buenos los números del test, medir.** Si `repartirProporcional` con
> `nivelRedondeo: 'linea'` deja `valorFinal` a 8.899 o 8.901 en el tercer caso, el que está mal es
> el test o la elección del `cfg`, no la función del motor. Leer su docblock (tabla de tramos)
> antes de cambiar nada.

- [x] **Step 4: Correrlo y ver que pasa**

Run: `cd backend && npx jest src/modules/compras/reparto-descuento.spec.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Mutante que revierte.** Cambiar la llamada a `repartirProporcional` por un reparto
  línea por línea (`descuento.times(valor).dividedBy(total)` sin residuo). El tercer test tiene que
  quedar en **rojo**. Restaurar.

- [x] **Step 6: Commit**

```bash
git add backend/src/modules/compras/reparto-descuento.ts backend/src/modules/compras/reparto-descuento.spec.ts
git diff --cached --stat
git commit -m "feat(compras): el descuento al total se reparte en el costo de las líneas"
```

---

### Task 3: Borrador por API, listado y detalle

**Files:**
- Create: `backend/src/modules/compras/dto/compra-borrador.dto.ts`
- Create: `backend/src/modules/compras/dto/find-compras.dto.ts`
- Create: `backend/src/modules/compras/compras.service.ts`
- Create: `backend/src/modules/compras/compras.service.spec.ts`
- Create: `backend/src/modules/compras/compras.controller.ts`
- Modify: `backend/src/modules/compras/compras.module.ts`
- Test: `backend/test/compras.e2e-spec.ts`

**Interfaces:**
- Consumes: entidades de la tarea 1. `CatalogService.convertirUnidad` (valida la unidad
  compatible, el mismo que usa `ItemsService.ajustarStock`).
- Produces, para las tareas 4, 6, 8 y 9:

```ts
export interface CompraListItem {
  id: string;
  estado: EstadoCompra;
  faltaCosto: boolean;           // confirmada con alguna línea sin precio
  fechaDocumento: string;
  proveedorId: string;
  proveedorNombre: string;
  tipoDocumentoNombre: string;
  folio: string | null;
  ubicacionId: string;
  ubicacionNombre: string;
  lineas: number;
  total: string | null;          // Σ cantidad × precio − descuento; null si falta algún precio
}
export interface CompraLineaDetalle {
  id: string; orden: number; itemId: string; itemNombre: string; modoInventario: string;
  cantidad: string; unidadCodigo: string; precioUnitario: string | null;
  series: SerieCompraInput[] | null; lote: LoteCompraInput | null;
}
export interface CompraDetalle extends CompraListItem {
  tipoDocumentoCompraId: string; observacion: string | null; descuentoTotal: string | null;
  lineas: CompraLineaDetalle[];  // reemplaza el conteo del listado
  cambios: { compraLineaId: string; campo: string; valorAnterior: string | null;
             valorNuevo: string | null; usuarioNombre: string | null; creadoEl: Date }[];
}
```

Rutas de esta tarea (spec § 5):

| Ruta | Permiso | Servicio |
|---|---|---|
| `GET /compras` | `Compras:Leer` | `findAll(tenantId, query: FindComprasDto)` → `PaginatedResponse<CompraListItem>` |
| `GET /compras/tipos-documento` | `Compras:Leer` | `tiposDocumento(tenantId)` → los activos del país del tenant |
| `GET /compras/proveedores` | `Compras:Leer` | `proveedores(tenantId)` → `{ id, nombre, rut }[]` de terceros activos `tipo='proveedor'` |
| `GET /compras/:id` | `Compras:Leer` | `findOne(tenantId, id)` → `CompraDetalle` |
| `POST /compras` | `Compras:Crear` | `crearBorrador(tenantId, usuarioId, dto)` |
| `PATCH /compras/:id` | `Compras:Crear` | `actualizarBorrador(tenantId, usuarioId, id, dto)`, con reemplazo completo de líneas |
| `DELETE /compras/:id` | `Compras:Crear` | `descartarBorrador(tenantId, usuarioId, id)`, soft delete |

> ⚠️ Las rutas fijas (`/tipos-documento`, `/proveedores`) van **antes** de `/:id` en el
> controller, o Nest las captura como id. `/:id` lleva `ParseUUIDPipe`.

- [x] **Step 1: DTOs**

```ts
// dto/compra-borrador.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsNotEmpty, IsNumberString, IsOptional,
  IsString, IsUUID, MaxLength, ValidateNested,
} from 'class-validator';
import { IsDecimalNoNegativo, IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';
import { EsCosto } from '../../../common/decorators/escala-moneda.decorator';

export class SerieCompraDto {
  @IsString() @IsNotEmpty() serie: string;
  @IsOptional() @IsIn(['nuevo', 'usado', 'reacondicionado']) condicion?: 'nuevo' | 'usado' | 'reacondicionado';
  @IsOptional() @IsDateString() garantiaHasta?: string;
}

export class LoteCompraDto {
  @IsString() @IsNotEmpty() codigoLote: string;
  @IsOptional() @IsDateString() fechaElaboracion?: string;
  @IsOptional() @IsDateString() fechaVencimiento?: string;
}

export class LineaCompraDto {
  @IsUUID() itemId: string;
  @IsNumberString() @IsDecimalPositivo() cantidad: string;
  @IsString() @IsNotEmpty() unidadCodigo: string;
  /** Opcional: ausente o null = falta costo. `>= 0`: el 0 es el regalo. */
  @IsOptional() @IsNumberString() @IsDecimalNoNegativo() @EsCosto() precioUnitario?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SerieCompraDto)
  series?: SerieCompraDto[];
  @IsOptional() @ValidateNested() @Type(() => LoteCompraDto) lote?: LoteCompraDto;
}

/** ⚠️ `tenantId` no está y no puede estar: sale del token. */
export class CompraBorradorDto {
  @IsUUID() proveedorId: string;
  @IsUUID() tipoDocumentoCompraId: string;
  @IsOptional() @IsString() @MaxLength(40) folio?: string | null;
  @IsDateString() fechaDocumento: string;
  @IsUUID() ubicacionId: string;
  @IsOptional() @IsString() @MaxLength(500) observacion?: string | null;
  // Un borrador puede estar vacío; confirmar exige al menos una línea.
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => LineaCompraDto)
  lineas: LineaCompraDto[];
}
```

```ts
// dto/find-compras.dto.ts
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FindComprasDto extends PaginationQueryDto {
  @IsOptional() @IsIn(['borrador', 'confirmada', 'anulada']) estado?: 'borrador' | 'confirmada' | 'anulada';
  @IsOptional() @IsUUID() proveedorId?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() faltaCosto?: boolean;
  @IsOptional() @IsDateString() desde?: string;
  @IsOptional() @IsDateString() hasta?: string;
}
```

> Los bordes `desde`/`hasta` van con la regla de `docs/patterns/backend.md` § 10b (día local del
> tenant). Sobre `fecha_documento`, que es `date`, se compara directo: no hay zona que convertir.

- [x] **Step 2: Tests unitarios del service que fallan.** En `compras.service.spec.ts`, con
  `dbMock` según `docs/patterns/backend.md` § 7. Una prueba por regla:

  1. Rechaza un proveedor que no es del tenant, con 400 *"Proveedor no encontrado"* (el mismo
     mensaje que uno inexistente).
  2. Rechaza un tercero de tipo `empresa`, con 400 *"… no es un proveedor"*.
  3. Rechaza un proveedor pausado (`activo = false`), con 400 *"… está pausado"*. Es la regla de
     "se referencia" de § 2 de backend.md.
  4. Rechaza un tipo de documento de **otro país**, con 400.
  5. Con `requiereFolio = true`, un folio vacío es 400 *"Este documento necesita folio"*.
  6. Con "Sin documento", el folio se guarda `null` aunque llegue uno.
  7. Un folio repetido (misma tripleta, compra no anulada) es **409**, y el mensaje nombra la
     compra existente: *"Ya cargaste la factura 4521 de Distribuidora X el 2026-09-15"*.
  8. Una ubicación inactiva es 400.
  9. Un ítem sin stock (un servicio) es 400 *"… no lleva stock"*. Un **ingrediente sí se compra**:
     se aceptan `producto` e `ingrediente`, los dos con `item_producto` (decisión del owner,
     2026-09-18, al ejecutar esta tarea; la versión anterior del plan decía solo `producto`).
  10. Una unidad incompatible es 400. El mensaje es el de `convertirUnidad`, sin reescribirlo.
  11. En serie, `series.length` distinto de `cantidad` es 400. En lote, falta `lote` y es 400. En
      serie o lote, una unidad distinta de la base es 400 (la regla de `ajustarStock`).
  12. `actualizarBorrador` y `descartarBorrador` sobre una confirmada son **409** *"La compra ya
      está confirmada"*.

Run: `cd backend && npx jest src/modules/compras/compras.service.spec.ts`
Expected: FAIL, los 12.

- [x] **Step 3: Implementar el service.** Estas son las piezas; ninguna toca el kardex:

  - Una sola función privada `validarEncabezado(manager, tenantId, dto)` que usan `crearBorrador`
    y `actualizarBorrador`. Resuelve proveedor, tipo de documento y ubicación con **una query por
    tabla**. El país del tenant sale por `tenants → provincias → pais` con `eliminado_el IS NULL`
    en cada join.
  - `validarLineas(manager, tenantId, lineas)`: **una** query `WHERE i.item_id = ANY($1)` que
    trae `tipo`, `eliminado_el`, `modo_inventario` y `unidad_medida` de todos los ítems. Nada de
    una query por línea. La compatibilidad de unidad se valida con `catalogService.convertirUnidad`
    solo para las líneas cuya unidad difiere de la base. Es una llamada por **par de unidades
    distinto**, no por línea: memoizar por `unidadCodigo → unidadBase` dentro del método.
  - Folio: `assertFolioLibre(manager, tenantId, proveedorId, tipoId, folio, excluirCompraId?)`.
    Si hay fila, `ConflictException` con el mensaje del test 7. La tarea 6 la vuelve a llamar al
    confirmar.
  - Líneas: reemplazo completo en `actualizarBorrador` (soft delete de las viejas + insert de las
    nuevas en un `INSERT … SELECT unnest(...)` o `manager.save` en lote), dentro de
    `db.transaccion`, tomando `SELECT … FOR UPDATE` sobre la fila de `compras` primero (molde:
    `recuentos.service.ts`, bloqueo del encabezado antes de tocar líneas).
  - `findAll`: una query con `COUNT(*) OVER()` o el par count + page de `traslados.findAll`. Las
    líneas, el `faltaCosto` y el `total` salen de un `LEFT JOIN LATERAL` o de un
    `GROUP BY` sobre `compra_lineas` (filtrando `cl.eliminado_el IS NULL`), **no** de una query por
    fila.
  - `findOne`: encabezado, líneas (con `items` por join) e historial, con **tres queries fijas**,
    sin importar cuántas líneas tenga.
  - Respuesta de POST/PATCH: `findOne` al final de la transacción (el molde de `traslados`, que
    explica por qué releer en vez de armar a mano).

- [x] **Step 4: Controller** con `@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)` a nivel de
  clase y `@RequiresPermiso('Compras', …)` por handler, según la tabla de arriba. El molde es
  `traslados.controller.ts`.

- [x] **Step 5: Correr los unitarios**

Run: `cd backend && npx jest src/modules/compras`
Expected: PASS.

- [x] **Step 6: e2e.** `test/compras.e2e-spec.ts`, con el bootstrap de `traslados.e2e-spec.ts`
  (líneas 175–248: `setGlobalPrefix`, `cookieParser`, `ValidationPipe`, login en dos pasos con
  `switch-tenant`). Reglas del spec:
  - **Todo `.body` del que se saca un valor lleva su `expect(status)` al lado.**
  - Proveedor, productos y bodega **propios del spec**, con `nombreUnico(...)`. No se reusan los del
    seed.
  - Un folio único por corrida (`'E2E-' + Date.now()`).

  Casos:
  1. `POST /compras` con dos líneas (una sin precio) → 201, `estado='borrador'`.
  2. `GET /compras/:id` → las dos líneas, `precioUnitario` null en la segunda.
  3. `PATCH /compras/:id` con una línea menos → 200, y el detalle trae una.
  4. Folio repetido en otro borrador del mismo proveedor y tipo → 409 con el mensaje que nombra la
     compra.
  5. Mismo folio con **otro proveedor** → 201.
  6. "Sin documento" sin folio → 201.
  7. `GET /compras?estado=borrador` → contiene los creados. `GET /compras/tipos-documento` → los 6
     de Chile. `GET /compras/proveedores` → incluye el del spec y **no** incluye un tercero
     `empresa`.
  8. `DELETE /compras/:id` → 200, y el `GET` siguiente → 404.
  9. **Permisos:** `encargado.salon@paris.cl` (sin `Compras`) → 403 en `GET /compras` y en
     `POST /compras`. `encargado.compras@paris.cl` → 200/201.
  10. **Aislamiento:** con el token del segundo tenant (`helpers/segundo-tenant.ts`), el
      `GET /compras/:id` de una compra de Paris → 404, y usar el proveedor de Paris → 400.

- [x] **Step 7: Pedir turno de stack** a la sesión coordinadora. Con el turno:

```bash
./scripts/reset-db.sh
cd backend && npx jest --config test/jest-e2e.json test/compras.e2e-spec.ts test/esquema.e2e-spec.ts
cd .. && ./scripts/reset-db.sh --verificar
```

Expected: PASS, y `--verificar` sin movimiento. Si el arranque falla con un error de esquema, la
causa más probable es el tipo de columna de alguna unión (`estado`, `campo`): ver la memoria
*typeorm tipo de columna explícito*.

- [x] **Step 8: Mutantes que revierten** (uno por vez, restaurar después, y verificar la hora de
  restart del watcher antes de volver a correr):
  - Sacar `AND c.estado <> 'anulada'` del pre-check de folio → no mata nada todavía, porque la
    anulación es de la tarea 9. Se anota para la tarea 9.
  - Sacar `AND tipo = 'proveedor'` de `proveedores()` → el caso 7 tiene que quedar en rojo.
  - Cambiar `@RequiresPermiso('Compras','Crear')` por `('Compras','Leer')` en `POST` → el caso 9
    tiene que quedar en rojo.

- [x] **Step 9: Commit**

```bash
git add backend/src/modules/compras backend/test/compras.e2e-spec.ts
git diff --cached --stat
git commit -m "feat(compras): el borrador de una compra por API, con folio único por proveedor"
```

---

### Task 4: Frontend — listado y carga del borrador

**Files:**
- Create: `frontend/app/composables/useCompras.ts`
- Test: `frontend/app/composables/useCompras.spec.ts`
- Create: `frontend/app/pages/compras/index.vue`
- Create: `frontend/app/pages/compras/[id].vue`
- Test: `frontend/app/pages/compras/compras-carga.nuxt.spec.ts`
- Modify: `frontend/app/layouts/dashboard.vue` (bloque de menú de la línea ~126)

**Interfaces:**
- Consumes: las rutas de la tarea 3 y las interfaces `CompraListItem` y `CompraDetalle`, copiadas
  al front como tipos locales de la página.
- Produces:

```ts
// useCompras.ts
export function totalLinea(cantidad: string, precioUnitario: string | null): string | null
export function subtotal(lineas: { cantidad: string; precioUnitario: string | null }[]): string | null
export function faltaAlgunPrecio(lineas: { precioUnitario: string | null }[]): boolean
export function insigniaEstado(c: { estado: string; faltaCosto: boolean }):
  { label: string; color: 'neutral' | 'success' | 'error' | 'warning' }[]
```

- [x] **Step 0: Invocar el skill `nuxt-ui`** antes de escribir la página. Es regla de la memoria
  del proyecto.

- [x] **Step 1: Test del composable que falla**

```ts
import { describe, expect, it } from 'vitest'
import { faltaAlgunPrecio, insigniaEstado, subtotal, totalLinea } from './useCompras'

describe('useCompras', () => {
  it('total de línea: 20,35 kg a $1.490 da 30321.5 (solo para comparar con el papel)', () => {
    expect(totalLinea('20.35', '1490')).toBe('30321.5')
  })
  it('sin precio no hay total de línea', () => {
    expect(totalLinea('3', null)).toBeNull()
  })
  it('el subtotal es null si falta algún precio', () => {
    expect(subtotal([{ cantidad: '1', precioUnitario: '10' }, { cantidad: '1', precioUnitario: null }])).toBeNull()
    expect(subtotal([{ cantidad: '2', precioUnitario: '10' }, { cantidad: '1', precioUnitario: '0' }])).toBe('20')
  })
  it('faltaAlgunPrecio', () => {
    expect(faltaAlgunPrecio([{ precioUnitario: '0' }])).toBe(false)
    expect(faltaAlgunPrecio([{ precioUnitario: null }])).toBe(true)
  })
  it('una confirmada sin costo lleva dos insignias', () => {
    expect(insigniaEstado({ estado: 'confirmada', faltaCosto: true }).map(i => i.label))
      .toEqual(['Confirmada', 'Falta costo'])
  })
})
```

Run: `cd frontend && npx vitest run app/composables/useCompras.spec.ts`
Expected: FAIL.

- [x] **Step 2: Implementar `useCompras.ts`** con Decimal.js (ya es dependencia del front; si no,
  **parar**: una dependencia nueva se pregunta). `totalLinea` y `subtotal` **no redondean**: son
  para comparar con el papel, y el costo lo calcula el servidor.

- [x] **Step 3: Correrlo y ver que pasa.** Mismo comando. Expected: PASS.

- [x] **Step 4: Menú.** En `dashboard.vue`, un bloque propio:

```ts
if (permissionsStore.esAdmin || permissionsStore.can('Compras', 'Leer')) {
  base.push({ label: 'Compras', icon: 'i-lucide-truck', to: '/compras' })
}
```

- [x] **Step 5: `pages/compras/index.vue`.** Es el molde del listado de `inventario/traslados.vue`
  (líneas 1–140: `definePageMeta`, `usePaginatedList`, `usePermisosCrud`), pero **sin drawer**:
  - Columnas: fecha del documento, proveedor, documento (`tipoDocumentoNombre` + `folio`),
    ubicación, líneas, total y estado. El estado va con `insigniaEstado` en `UBadge`, y la fila
    anulada con `line-through` vía una clase del design system (ver
    `frontend/docs/DESIGN-SYSTEM.md`).
  - Filtros por estado, proveedor, fechas y un `USwitch` "Solo las que les falta costo"
    (`faltaCosto=true`).
  - Botón *Nueva compra* → `/compras/nueva`, visible con `usePermisosCrud('Compras').puedeCrear`.

- [x] **Step 6: `pages/compras/[id].vue`, en modo carga** (`id === 'nueva'` o una compra en
  `borrador`):
  - **Arriba:** proveedor (`/compras/proveedores`), tipo (`/compras/tipos-documento`), folio
    (oculto si `requiereFolio` es false), fecha y ubicación (`useUbicaciones`, solo activas).
  - **Líneas:** producto (el mismo selector que traslados: `items?tipo=producto` más
    `items?tipo=ingrediente`), cantidad,
    unidad (las compatibles, con `useUnidadConversion`) y precio unitario (`UInput`
    `inputmode="decimal"`, string). Al lado, `totalLinea` como texto. Según el modo del producto,
    series (una por unidad) o lote.
  - **Pie:** `subtotal` y total. El campo del descuento se **muestra deshabilitado** con el texto
    *"Se carga cuando todas las líneas tienen precio"*. Su guardado es de la tarea 8.
  - **Botones:** *Guardar borrador* (`POST` si es nueva, `PATCH` si no; al crear, `router.replace`
    a `/compras/:id`) y *Descartar* (con un modal que frena). *Confirmar recepción* se muestra
    **deshabilitado**, con el tooltip *"Disponible cuando se habilite la recepción"*: lo conecta
    la tarea 6.
  - **Errores:** el `message` del backend tal cual (`e.data.message`). El 409 del folio se muestra
    **al lado del campo folio**.
  - **Sin guardado automático.**
  - Una compra `confirmada` o `anulada` abierta acá muestra, por ahora, el detalle en solo
    lectura. Las acciones son de la tarea 10.

- [x] **Step 7: Spec de componente** `compras-carga.nuxt.spec.ts`, con el mock de `useApiFetch` que
  usan los otros `.nuxt.spec.ts`:
  1. Tipear 20,35 y $1.490 muestra *"30.321,5"* al lado.
  2. Con una línea sin precio, el descuento está deshabilitado y dice por qué.
  3. Elegir "Sin documento" oculta el folio.
  4. *Guardar borrador* manda un body que **pasa el DTO del backend**: `precioUnitario` como
     string o `null`, `cantidad` como string y **sin** `tenantId`. Es la memoria *el mock de
     useApiFetch contesta 200*: el body afirmado tiene que ser uno que el pipe acepte.

Run: `cd frontend && npx vitest run app/pages/compras app/composables/useCompras.spec.ts`
Expected: PASS.

- [x] **Step 8: Gate del front**

Run: `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`
Expected: todo verde (exit code 0 de cada uno, no la última línea: memoria *exit code, no la última
línea*).

- [x] **Step 9: Commit**

```bash
git add frontend/app/composables/useCompras.ts frontend/app/composables/useCompras.spec.ts frontend/app/pages/compras frontend/app/layouts/dashboard.vue
git diff --cached --stat
git commit -m "feat(compras): el listado y la carga del borrador"
```

---

### Task 5: Kardex: la línea de compra, la secuencia, `correccion_compra` y el stock total

Después de las tareas 1 a 4. Toca `registrarMovimiento`, así que el código se escribe contra el
`inventario.service.ts` de ese momento.

✅ **OK del owner para esta tarea (2026-09-18):** *"Dale con la 5"*. Escribe en
`movimientos_inventario`, lo que `CLAUDE.md` pide consultar antes. Se le explicó el alcance antes
de pedir el OK: `compra_linea_id`, la secuencia, el motivo `correccion_compra` y la extracción de
`stockTotalPorProducto`.

**Intención (spec § 3.4):**
- **Un solo dueño para el "stock total del producto".** Hoy la query vive en línea dentro de
  `registrarMovimiento` (`6f5a1821`). Compras la necesita también: T6 para congelar
  `stock_total_anterior`, incluso en las líneas **sin precio**, donde `registrarMovimiento` no la
  corre, y T7 como definición del peso. Se extrae a un método de `InventarioService`, **en lote**
  para no hacer N+1 al confirmar, y `registrarMovimiento` pasa a llamarlo con un solo id. Es la
  misma SQL (con el `JOIN ubicaciones … eliminado_el IS NULL`), movida, no reescrita. Copiarla en
  compras dejaría dos definiciones del peso que se separan con el primer cambio.
- `movimientos_inventario.compra_linea_id uuid NULL`, con índice. Llega como
  `RegistrarMovimientoParams.compraLineaId?` y se inserta como `trasladoId`.
- `movimientos_inventario.secuencia bigserial NOT NULL`, **tomada al insertar bajo el lock del
  producto**. Es el orden real que usa la tarea 7. Verificar que el `INSERT` de
  `registrarMovimiento` corre después del `FOR UPDATE OF ip`: si es así, dos transacciones sobre el
  mismo producto no pueden intercalar sus `nextval`.
- Motivo `correccion_compra` (tipo `ajuste`, cantidad 0). **No** va en
  `MOTIVOS_QUE_RECALCULAN_CPP` ni en `MOTIVOS_SOBRE_ITEM_ELIMINADO`. Se documenta en el comentario
  de la columna `motivo` de la entidad y se agrega al filtro de motivos de
  `frontend/app/pages/inventario/index.vue`.

**Contrato:**

```ts
// El peso del CPP, con un solo dueño. Sin fila → '0' para ese id.
stockTotalPorProducto(manager: EntityManager, itemIds: string[]): Promise<Map<string, string>>;
// RegistrarMovimientoParams gana:
compraLineaId?: string | null;
// La corrección de costo es un ajuste de VALOR, como `ajuste_costo`
// (`MOTIVOS_DE_VALOR`): se escribe con registrarMovimiento, sin método propio.
registrarMovimiento(manager, {
  tipo: 'ajuste', motivo: 'correccion_compra', cantidad: '0',
  costoUnitario: costoNuevo, compraLineaId, /* tenantId, itemId, ubicacionId, usuarioId */
});
```

> **Cambio al ejecutar (2026-09-18):** el contrato original tenía un método aparte,
> `registrarCorreccionCosto`. No hizo falta: la mecánica es idéntica a la de `ajuste_costo`
> (cantidad 0, pisa `costo_actual`, deja `costo_anterior`), así que `correccion_compra` entró en
> la misma lista de motivos de valor. El motivo exige `compraLineaId`, y `compraLineaId` solo se
> acepta con `compra` o `correccion_compra`. Entró también `correccion_compra` en el `@IsIn` del
> filtro del kardex (`find-movimientos.dto.ts`) y en su gemelo del front, y las dos tablas de
> kardex (`inventario/index.vue` y el historial de `configuracion/items.vue`) dibujan los dos
> motivos de valor con `esAjusteDeValor` de `useFormatters`.

**Qué tiene que probar:**
- que la secuencia sale ordenada con dos transacciones concurrentes sobre el mismo producto (el
  caso cruzado de `traslados.e2e-spec.ts` es el molde);
- que una `correccion_compra` no mueve stock y deja `costo_anterior`;
- que `test/costeo-cpp-multiubicacion.e2e-spec.ts` sigue verde después de extraer
  `stockTotalPorProducto`: es la red del frente del CPP, y el mutante que revierte al peso de la
  ubicación la tiene que seguir matando.

---

### Task 6: Confirmar

Depende de la tarea 5. **Va antes que la 7** (cambio de orden al ejecutar): confirmar solo
registra las entradas y congela el punto de partida en cada línea; no rehace ninguna cuenta.
"Rehacer la cuenta" la necesitan corregir y anular (tareas 8 y 9), no confirmar.

✅ **OK del owner para esta tarea y para el cambio de orden (2026-09-18):** *"dale luz verde"*.
Escribe en `movimientos_inventario`: una entrada `compra` por línea vía `registrarMovimiento`,
que mueve stock y el CPP.

**Intención (spec § 4.2):** `POST /compras/:id/confirmar` (`Compras:Crear`) en una sola
transacción, con el reintento de deadlock de `traslados.crear`:

1. `SELECT … FOR UPDATE` de la compra; si no es `borrador`, 409.
2. `validarEncabezado` + `validarLineas` (tarea 3), `assertFolioLibre` otra vez, y al menos una
   línea. **El `FOR SHARE` sobre la ubicación ya no se toma acá:** desde `8dadb792`
   `registrarMovimiento` lo toma para cada movimiento (`bloquearContraBorrado`). Si igual hace
   falta tomarlo antes, por ejemplo para validar la ubicación bajo lock, va **antes** del lock de
   productos: el orden es ubicaciones → `item_producto` (`docs/patterns/backend.md` §15).
3. Lock de los productos en **un** statement ordenado por `item_id` (`FOR UPDATE OF ip`, el molde
   de `traslados`, líneas 262–310).
4. Stock total **antes** de cada línea: `stockTotalPorProducto` (T5), una sola llamada con todos
   los ítems, después del lock. Dos líneas del mismo producto: la segunda parte de la primera más
   su `cantidadBase`. Tiene que dar **el mismo número** que el peso que usa `registrarMovimiento`
   para una línea con precio; si no, T7 rehace la cuenta desde otro punto de partida.
5. Convertir a unidad base (`convertirUnidad` + `convertirCostoUnitario`, como `ajustarStock`) y
   costear con `costearLineas` (tarea 2) las líneas con precio. `cfg` con
   `calculoPreciosService.cargarConfig(tenantId, decimalesMonedaOficial)`.
6. Una entrada `compra` por línea vía `registrarMovimiento`, con `compraLineaId`,
   `costoUnitario` = el costo base (o null) y las series o el lote.
7. Congelar en la línea `cantidadBase`, `costoUnitarioBase`, `movimientoId`,
   `stockTotalAnterior` y `costoProductoAnterior` (este último es el `costoActualPrevio` que
   devuelve `registrarMovimiento`).
8. `estado='confirmada'`, `confirmado_por`, `confirmado_el`.

**Qué tiene que probar (e2e, con turno):**
- borrador → confirmar mueve stock en la ubicación de la compra;
- una línea sin precio no mueve el CPP;
- el regalo da $738 (spec § 4.2);
- confirmar dos veces es 409;
- folio duplicado al confirmar es 409;
- sin `Compras:Crear` es 403;
- **una compra a la bodega con stock en el local deja el CPP ponderado con el total**. Es el caso
  de `6f5a1821`, repetido por el camino de compras.

En el front, habilitar *Confirmar recepción* con su modal de resumen.

---

### Task 7: Rehacer la cuenta

✅ **OK del owner para esta tarea (2026-09-19):** *"si"*. Escribe en `movimientos_inventario`:
recalcula el CPP del producto desde la compra hacia adelante, por `secuencia`, y deja una
`correccion_compra` (ajuste de valor, sin mover stock) si el costo cambia.

✅ **Y una columna más, también del owner (2026-09-19):** *"dale con A"*. El kardex no guardaba si
una entrada trajo costo: sin costo, `costo_unitario` congela el CPP de ese momento. Sin ese dato,
la cuenta rehecha promediaba 10 kg que entraron sin costo como si hubieran costado $1.000
($1.285,71 en vez de $1.400). `movimientos_inventario.costo_informado` (boolean NOT NULL, default
false) lo escribe `registrarMovimiento`. Guarda el hecho y la regla queda en el código (spec § 3.4 y
§ 4.3). Como cambia a **todo** escritor del kardex, el cierre de esta tarea lleva el e2e completo.

Depende de la tarea 5. Es la tarea con más riesgo del plan. Usa la **misma** regla de reinicio
que `calcularCostoPromedio` (es privado de la misma clase: se llama, no se copia) y el **mismo**
peso: el punto de partida sale de `stockTotalPorProducto` (vía `stock_total_anterior`), y a partir
de ahí se suman las cantidades con signo.

**Intención (spec § 4.3):** un método nuevo de `InventarioService`, porque es el único dueño de
`costo_actual`. Por producto y bajo su lock:

1. Parte del `stockTotalAnterior` y el `costoProductoAnterior` de la primera línea de la compra con
   ese producto.
2. Recorre los movimientos del producto en **todas** las ubicaciones, desde esa entrada, por
   `secuencia`, filtrando `eliminado_el IS NULL` **del movimiento** y **sin** filtrar la ubicación
   eliminada (spec § 4.3: mientras tuvo stock, ese stock entró en el peso). Es **una** query, con
   join a `compra_lineas` y `compras` para traer la cantidad y el costo vigentes de cada línea y el
   estado de su compra. Las reglas de cada tipo de movimiento son las de la spec § 4.3, **sin
   reinterpretarlas**.
   ✅ **La dependencia está cerrada desde `8dadb792`** (main, 2026-09-18): `registrarMovimiento`
   empieza por `UbicacionesService.bloquearContraBorrado`, un `FOR SHARE` sobre la ubicación,
   el par del `FOR UPDATE` de `remove()`. Un borrado espera a quien escribe stock en esa
   ubicación, así que una ubicación se borra vacía. `stockTotalPorProducto` excluye las
   ubicaciones eliminadas **hoy** y la reconstrucción suma movimientos de todas: con esa
   garantía, los dos números coinciden. El test fija el caso: una bodega con movimientos en la
   ventana, vaciada y borrada antes de completar el precio.

   ⚠️ **Borde que abre ese mismo lock:** `bloquearContraBorrado` da **404** sobre una ubicación
   ya borrada, y la `correccion_compra` se escribe con una `ubicacionId`, aunque no mueva
   stock. Si la bodega de la compra se vació y se borró antes de que llegue la factura,
   completar el precio fallaría. La corrección va a la ubicación de la compra si sigue viva, y
   si no, al local (`UbicacionesService.localDe`, que no se borra). El test lo fija.
3. Si el costo resultante difiere del `costo_actual`, una `correccion_compra` vía `registrarMovimiento` (tarea 5).

**Contrato:**

```ts
recalcularCostoDesdeCompra(manager, p: {
  tenantId: string; itemId: string; compraId: string; usuarioId: string; comentario: string;
}): Promise<{ costoAnterior: string | null; costoNuevo: string | null; movimientoId: string | null }>;
```

**Qué tiene que probar (unitarias, con valores que discriminen):**

| Caso | Esperado |
|---|---|
| 5 kg a $1.000; entran 20 sin precio; se venden 8; se completan a $1.500 | $1.400; las ventas siguen en $1.000 |
| Igual, con 10 kg a $1.200 el martes | $1.326 |
| Un `ajuste_costo` en medio | Reinicia al suyo |
| La cantidad sube de 10 a 12 | La línea cuenta 12 **en su lugar original** |
| Una anulación | Como si la compra no hubiera existido |
| El stock pasa por cero | La entrada siguiente reinicia |
| Dos compras corregidas del mismo producto | No se pisan |
| Una entrada `compra` del atajo | Promedia con su costo congelado |
| El atajo **sin** costo (owner, 2026-09-19) | $1.400, no $1.285,71: no mueve el promedio |

**Al ejecutarla (2026-09-19):**
- Además de las unitarias, un e2e contra la base real en `compras.e2e-spec.ts`. El recorrido, sus
  JOIN y `costo_informado` son SQL, y el unitario los mockea. Como la tarea no tiene endpoint,
  llama al service directo y completa el precio de la línea con SQL. El e2e de la tarea 8 repite
  el tomate por HTTP.
- El mutante de `creado_el` lo mata el e2e con los `creado_el` invertidos a mano: el mismo
  desorden que produce la concurrencia (medido en `kardex-secuencia`), pero determinista. En el
  unitario lo mata la aserción sobre la cláusula `ORDER BY`.
- `correccion_compra` no tiene rama propia en el recorrido: es un ajuste sin cantidad y no es
  entrada, así que ya no toca nada. Lo que el test fija es que no reinicie como `ajuste_costo`.
- ⚠️ **Queda para la tarea 9:** si la compra anulada era la única entrada con costo de un producto
  que antes no tenía, la cuenta da "sin costo", y eso no se puede escribir, porque un ajuste de
  valor exige costo. El método devuelve `costoNuevo: null` sin escribir. La tarea 9 decide qué
  hace (preguntar al owner).

**Mutantes:** cambiar el orden por `creado_el` en vez de `secuencia` tiene que romper el test
concurrente, y usar el costo del movimiento en vez del de la línea tiene que romper el de "dos
compras corregidas".

---

### Task 8: Corregir precio, cantidad y descuento

Depende de las tareas 6 y 7.

✅ **OK del owner para esta tarea (2026-09-19):** *"dale con la 8"*. Escribe en
`movimientos_inventario`: la diferencia de cantidad (entrada o salida `compra` colgada de la línea)
y la `correccion_compra` que deja `recalcularCostoDesdeCompra`.

**Intención (spec § 4.4):**
- `PATCH /compras/:id/lineas/:lineaId` (`Compras:Actualizar`):
  - **Precio:** actualiza, historial y `recalcularCostoDesdeCompra`.
  - **Cantidad:** mueve la diferencia en la ubicación de la compra (`compra`, entrada o salida, con
    `compraLineaId`), historial y recálculo. Si baja y no alcanza, 400 con el producto, la
    ubicación y cuánto queda. En serie, subir pide `series` y bajar pide `unidadIds`, que tienen
    que estar en esa ubicación. En lote, la diferencia va al mismo lote.
- `PATCH /compras/:id/descuento` (`Compras:Actualizar`, con `@Body(EscalaMonedaPipe)`): 400 si
  falta algún precio. Si no, reparte de nuevo (`costearLineas`), actualiza `costoUnitarioBase`,
  deja el historial por línea que cambió y recalcula cada producto afectado.
- Toda corrección sobre una compra no confirmada es 409, y sobre un producto en la papelera es 400.

**Al ejecutarla (2026-09-19): en dos commits.** 8a = precio y descuento; 8b = cantidad, que sola
arrastra serie y lote. La rama no se integra hasta la tarea 11, así que el estado entre los dos no
llega a nadie.
- **Confirmar y corregir costean con la misma función** (`costearCompra`). Si costearan distinto,
  la cuenta rehecha partiría de otro número.
- **El chequeo de colapso mira solo la conversión de unidad, sin descuento.** Un descuento igual al
  total deja la mercadería a $0, y ese 0 alguien lo eligió.
- **El descuento no puede superar el total:** `costearLineas` no lo chequea y dejaría costos
  negativos. Un 0 se guarda como sin descuento.
- ⚠️ **Hueco de las tareas 3 y 4, encontrado acá:** la spec (§ 6, pie de la pantalla de carga) pide
  cargar el descuento en el borrador cuando todas las líneas tienen precio, porque la factura ya lo
  trae. Pero el DTO del borrador no lo acepta y la pantalla lo deja deshabilitado siempre.
  Arreglado en un commit propio, después de 8a. Borrador, confirmación y PATCH validan con la
  misma `validarDescuento`. La pantalla habilita el campo cuando no falta ningún precio, lo vacía
  si se borra uno y muestra el total en el pie.
- **Un precio corregido rehace la cuenta de cada producto cuyo costo cambió.** Con descuento al total
  pueden ser varios, en orden de `item_id`. El historial es de la línea corregida. El descuento deja
  historial en cada línea cuyo costo cambió.
- **La papelera frena la corrección de la línea aunque su costo base no cambie.** También frena si el
  reparto le mueve el costo a otro producto que está en la papelera.
- **Fixture `compras.carga`** (rol 443, usuario 444): `Leer` y `Crear`, sin `Actualizar`. Sin él, un
  guard con `Crear` donde va `Actualizar` pasaba la suite.

**Qué tiene que probar:** completar el precio del tomate llega a $1.400 por HTTP; bajar una
cantidad ya vendida da 400; cargar el descuento con una línea sin precio da 400; sin
`Compras:Actualizar` es 403; y el historial registra antes, después y quién.

---

### Task 9: Anular

Depende de las tareas 6 y 7.

**Intención (spec § 4.5):** `POST /compras/:id/anular` con `{ motivo }` (`Compras:Anular`). Una
salida `compra` por línea en la ubicación de la compra. Si **alguna** no alcanza, no anula nada y
el 400 dice cuál. Después, el recálculo por producto, `estado='anulada'` y la auditoría.

**Qué tiene que probar:** el stock vuelve; el CPP queda como si la compra no hubiera existido; el
folio se libera (acá entra el mutante pendiente de la tarea 3: sacar `estado <> 'anulada'` del
pre-check tiene que romper el caso de recargar la factura bien); anular algo ya vendido da 400; y
sin `Compras:Anular` es 403.

---

### Task 10: Frontend — detalle de una confirmada

Depende de las tareas 8 y 9.

**Intención (spec § 6):** en `pages/compras/[id].vue`, modo confirmada:
- *Completar* en las líneas sin precio y *Corregir* por línea, cada uno con un modal que muestra el
  valor actual y el nuevo.
- El descuento pasa a ser editable si todas tienen precio.
- El historial a la vista.
- *Anular*, con un modal que **frena**, pide motivo y dice cuánto stock sale de dónde (memoria
  *confirmación explícita sobre aviso pasivo*).
- Cada acción aparece solo con su permiso (`usePermisosCrud('Compras')` + `can('Compras','Anular')`).

**Qué tiene que probar:** specs de componente de los tres modales, con bodies que pasen el DTO.

---

### Task 11: Documentación, gate y cierre

**Después de las tareas 1 a 10.**

- [ ] **Step 1: Docs**, en el mismo commit que el último código:
  - `docs/features/compras.md`, desde `TEMPLATE.md`;
  - su link en `docs/README.md`;
  - la fila en `docs/ESTADO.md`;
  - `startup-pos.sql`, con las tablas y columnas nuevas;
  - `docs/agent/pendientes.md`: la entrada de compras pasa a "pieza 1 hecha" y quedan anotadas las
    piezas 2 a 4;
  - `docs/patterns/backend.md`, si la secuencia del kardex se vuelve patrón.
- [ ] **Step 2: Gate completo**, con turno de stack y la base reseteada **antes**:

```bash
./scripts/reset-db.sh
cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd ../frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
cd .. && ./scripts/reset-db.sh --verificar
```

  Expected: exit 0 en cada comando. Es el e2e **entero**, no un subset (memoria *gate e2e y
  unit completos*).
- [ ] **Step 3: Smoke test en el navegador**, en el Chrome del owner vía devtools: nueva compra,
  confirmar con una línea sin precio, completarla, corregir una cantidad y anular otra.
- [ ] **Step 4: Skill `verify-feature`**, incluida la revisión independiente (`domain-reviewer`)
  sobre el diff staged. **No correr la revisión y el e2e a la vez**: el revisor muta el working
  tree.
- [ ] **Step 5: Integrar a `main`** solo con el visto bueno de la sesión coordinadora y el main
  limpio, sin push.

---

## Self-review

- **Cobertura de la spec:**

  | Spec | Tarea |
  |---|---|
  | § 3.1–3.3, 3.5 | T1 |
  | § 3.4 | T5 |
  | § 4.1 | T3 |
  | § 4.2 | T2 + T6 |
  | § 4.3 | T7 |
  | § 4.4 | T8 |
  | § 4.5 | T9 |
  | § 5 | T3, T6, T8, T9 |
  | § 6 | T4 + T10 |
  | § 7 | cada tarea + T11 |
  | § 8 | T11 |

- **Desvío declarado:** el rol del seed es propio ("Compras · Encargado"), no uno "Encargado"
  genérico, que no existe (T1, paso 7.5).
- **Nombres cruzados:** `costearLineas` (T2 → T6, T8); `assertFolioLibre`, `validarEncabezado` y
  `validarLineas` (T3 → T6); `compraLineaId` y el motivo `correccion_compra` (T5 → T7, T8);
  `recalcularCostoDesdeCompra` (T7 → T8, T9).
