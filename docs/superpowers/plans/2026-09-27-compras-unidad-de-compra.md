# Plan: Compras, pieza 2 — la unidad de compra por proveedor ("caja de 12")

> **Para agentes:** sub-skill obligatoria: `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans`, tarea por tarea. Los pasos usan checkboxes (`- [ ]`).

- **Status:** Done
- **Date:** 2026-09-27
- **Owner:** César (owner) · redacta la sesión del frente, en el worktree `awesome-faraday-e413a9`
  (rama `claude/silly-wu-dd82b1`)

**Goal:** Que el encargado tipee "10 cajas a $9.600" de Andina y entren 120 unidades a $800,
guardando la primera vez que a ese proveedor ese producto le viene en caja de 12.

**Architecture:** Una tabla nueva, `presentaciones_compra`, por (proveedor, producto), con su
CRUD en `PresentacionesCompraService`, dentro del módulo `compras`. La línea del borrador
referencia una presentación **o** una unidad del catálogo, nunca las dos. Al confirmar congela el
nombre y el contenido en unidad base. Un único helper calcula la cantidad base de una línea en los
tres sitios que hoy convierten. La cuenta del costo, el kardex y el CPP no cambian.

**Tech Stack:** NestJS + TypeORM (`synchronize`) + SQL crudo vía `Db`, Decimal.js · Nuxt 4 +
Nuxt UI v4 · Jest + supertest (e2e de la API) · Vitest (`@nuxt/test-utils`) · Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-27-compras-unidad-de-compra-design.md`](../specs/2026-09-27-compras-unidad-de-compra-design.md).
Se lee junto con este plan.

## Global Constraints

- `tenant_id` **siempre del token** (`req.user.tenantId`), nunca del body, la query ni la ruta.
- Cantidades y plata con **Decimal.js**; ninguna cuenta en `number`.
- **Soft delete:** retirar es `UPDATE … SET eliminado_el = NOW()`; toda lectura nueva filtra
  `eliminado_el IS NULL`. El pre-commit bloquea un `DELETE FROM`.
- **Nunca una query por línea (N+1):** presentaciones de un borrador en **una** consulta
  (`= ANY($1::uuid[])`), el conversor del catálogo **una** vez por request.
- Permiso **`Compras · Crear`** en los cuatro endpoints nuevos, bajo
  `JwtAuthGuard + TenantGuard + PermisosGuard`.
- Entidad nueva → `RepositoriosModule.forFeature` de `compras.module.ts` **y** el array
  `entities` de `app.module.ts`.
- El índice único sobre `lower(nombre)` va en el **seeder**, con SQL cruda: TypeORM no expresa una
  función en `@Index` (`docs/patterns/backend.md`, "Entity o seeder").
- Nombre repetido → **409** (mismo código que el folio repetido y los nombres de cajones).
- Sin backfill: no hay datos productivos. Se cambia el esquema y se resetea.
- Todo subagente con `model: 'sonnet'` explícito.
- ⛔ No mergear ni pushear. Stagear por ruta explícita. Nunca `--no-verify` sin permiso.

---

## Context

La pieza 1 ([`features/compras.md`](../../features/compras.md)) carga líneas en unidades del
catálogo global (kg, g, l, unidad). La decisión 4b del owner (2026-09-18) pide una unidad de
compra por (proveedor, producto), y la investigación del 2026-09-27 la marca como la dependencia
más dura de la lectura del XML del DTE. Las cuatro decisiones de producto del owner del
2026-09-27 y las del diseño están en la spec § 2.

**Lo que ya existe y se reusa sin cambios:** `costearLineas` / `costearCompra` (el costo por
unidad base es `cantidad × precio ÷ cantidadBase`), `InventarioService.registrarMovimiento`,
`recostear` (trabaja sobre la `cantidad_base` congelada) y el reparto del descuento (por
`cantidad × precio`, igual en cajas que en unidades).

**Dónde se convierte hoy la unidad**, en `backend/src/modules/compras/compras.service.ts` (los
tres pasan al helper nuevo):

| Sitio | Línea hoy | Qué hace |
|---|---|---|
| `validarLineas` | `:1990-2001` | Valida que la unidad sea convertible; rechaza otra unidad en serie o lote |
| `confirmarEnTransaccion` | `:818-829` | `bases[i]`, la cantidad que entra al kardex |
| corrección de cantidad | `:1084-1090` | `nuevaBase` al corregir una confirmada |

⚠️ Los números de línea son del commit `04c7dde1`; se mueven con cada tarea. Se buscan por el
código citado, no por el número.

## Scope / Out of scope

**Scope:** la tabla y su CRUD; la línea con presentación en el borrador, al confirmar y al
corregir la cantidad; la pantalla (selector, modal, lápiz, la cuenta a la vista, la confirmada, la
anulación); el seed; los docs.

**Out of scope** (spec § 9): el código del proveedor y la lectura del XML; una lista de
presentaciones por proveedor; presentaciones para productos por serie o en `PATCH
/items/:id/stock`; todo lo fiscal.

---

## Estructura de archivos

| Archivo | Tarea | Responsabilidad |
|---|---|---|
| `backend/src/modules/compras/entities/presentacion-compra.entity.ts` | 1 (crear) | La tabla |
| `backend/src/modules/compras/dto/presentacion-compra.dto.ts` | 1 (crear) | Bodies de crear y editar, query de listar |
| `backend/src/modules/compras/presentaciones-compra.service.ts` | 1 (crear) | CRUD y `vivasPorIds` para el borrador. Archivo propio porque `compras.service.ts` ya pasa las 2.100 líneas y esto es otra responsabilidad |
| `backend/src/modules/compras/compras.controller.ts` | 1 | Las cuatro rutas, antes de `:id` |
| `backend/src/modules/compras/compras.module.ts`, `backend/src/app.module.ts` | 1 | Registro |
| `backend/src/modules/seeder/seeder.service.ts` | 1 | Índice único + dos presentaciones de Andina |
| `startup-pos.sql` | 1, 2 | Documentación del esquema |
| `backend/test/compras-presentaciones.e2e-spec.ts` | 1 (crear), 2 | E2E de esta pieza |
| `backend/src/modules/compras/entities/compra-linea.entity.ts` | 2 | Tres columnas nuevas, `unidad_codigo` null, CHECK |
| `backend/src/modules/compras/dto/compra-borrador.dto.ts` | 2 | `presentacionId?` en la línea |
| `backend/src/modules/compras/compras.service.ts` | 2 | Helper `cantidadEnBase`, validación, confirmar, corregir, detalle |
| `backend/src/modules/compras/compras.service.spec.ts` | 2 | Unitarios del helper y de la validación |
| `frontend/app/composables/useCompras.ts` (+ `.spec.ts`) | 3 | Etiqueta, unidad de una línea, la cuenta a la vista |
| `frontend/app/components/compras/PresentacionModal.vue` (+ `.nuxt.spec.ts`) | 3 (crear) | Crear, editar y retirar |
| `frontend/app/pages/compras/[id].vue` (+ `compras-carga.nuxt.spec.ts`) | 3 | Selector, lápiz, cuenta, cambio de proveedor |
| `frontend/app/components/compras/{CompraConfirmada,CorregirLineaModal,AnularCompraModal}.vue` | 3 | Los tres consumidores de `unidadCodigo` |
| `frontend/e2e/compras/compras-presentacion.spec.ts` | 3 (crear) | Navegador como `encargado.compras` |
| `docs/features/compras.md`, `docs/ESTADO.md`, `docs/PRODUCTO.md`, `docs/agent/pendientes.md`, `docs/agent/resueltos.md` | 1–3 | Docs vivos |

---

## Backend

### Task 1: Las presentaciones — tabla, CRUD y seed

**Files:**
- Create: `backend/src/modules/compras/entities/presentacion-compra.entity.ts`
- Create: `backend/src/modules/compras/dto/presentacion-compra.dto.ts`
- Create: `backend/src/modules/compras/presentaciones-compra.service.ts`
- Create: `backend/test/compras-presentaciones.e2e-spec.ts`
- Modify: `backend/src/modules/compras/compras.controller.ts` (rutas antes de `@Get()`)
- Modify: `backend/src/modules/compras/compras.module.ts`, `backend/src/app.module.ts` (~`:168-171`, `:311-314`)
- Modify: `backend/src/modules/seeder/seeder.service.ts` (método nuevo, llamado después de `seedIngredientesBase`)
- Modify: `startup-pos.sql`, `docs/features/compras.md`, `docs/ESTADO.md`

**Interfaces:**
- Produces (lo usa la Task 2):
  ```ts
  // presentaciones-compra.service.ts
  export interface PresentacionCompraVista {
    id: string; proveedorId: string; itemId: string;
    nombre: string; contenido: string; unidadCodigo: string;
  }
  /** Lo que el borrador necesita de una presentación viva. */
  export interface PresentacionViva {
    id: string; proveedorId: string; itemId: string;
    nombre: string; contenido: string; unidadCodigo: string;
  }
  class PresentacionesCompraService {
    listar(tenantId: string, proveedorId: string): Promise<PresentacionCompraVista[]>;
    crear(tenantId: string, dto: CrearPresentacionCompraDto): Promise<PresentacionCompraVista>;
    editar(tenantId: string, id: string, dto: EditarPresentacionCompraDto): Promise<PresentacionCompraVista>;
    retirar(tenantId: string, id: string): Promise<void>;
    /** Las vivas del tenant entre `ids`, en UNA consulta. Las que faltan no están en el mapa. */
    vivasPorIds(tenantId: string, ids: string[]): Promise<Map<string, PresentacionViva>>;
  }
  ```
- Rutas: `GET /compras/presentaciones?proveedorId=` · `POST /compras/presentaciones` ·
  `PATCH /compras/presentaciones/:id` · `DELETE /compras/presentaciones/:id` (204).

- [ ] **Step 1: Entorno propio y base limpia**

```bash
./scripts/entorno.sh db
./scripts/reset-db.sh
```

Expected: `entorno.sh estado` muestra el offset del worktree; el reset termina con el seed completo.

- [ ] **Step 2: E2E que falla — crear, listar y los 400/409**

Crear `backend/test/compras-presentaciones.e2e-spec.ts`. El `beforeAll`, `login`, `post`, `get` e
`intentar` se copian de `backend/test/compras.e2e-spec.ts:86-250` (dos copias de un helper son
aceptables por CLAUDE.md; la tercera se extrae). Fixtures propios con `nombreUnico`: un proveedor,
otro proveedor, y cuatro productos creados por `POST /api/items`:
`latas` (`unidadMedida: 'unidad'`), `harinaG` (`unidadMedida: 'g'`), `yogurt`
(`unidadMedida: 'unidad', modoInventario: 'lote'`) y `celular`
(`unidadMedida: 'unidad', modoInventario: 'serie'`).

```ts
describe('presentaciones de compra (spec pieza 2 § 5)', () => {
  const crear = (body: Record<string, unknown>, esperado = 201, conToken = token) =>
    post<PresentacionVista>('/api/compras/presentaciones', body, esperado, conToken);

  it('crea "Caja (12)" y la lista con el proveedor', async () => {
    const caja = await crear({ proveedorId, itemId: latas, nombre: ' Caja ', contenido: '12', unidadCodigo: 'unidad' });
    expect(caja).toMatchObject({ proveedorId, itemId: latas, nombre: 'Caja', contenido: '12.0000', unidadCodigo: 'unidad' });
    const lista = await get<PresentacionVista[]>(`/api/compras/presentaciones?proveedorId=${proveedorId}`);
    expect(lista.map((p) => p.id)).toContain(caja.id);
    const deOtro = await get<PresentacionVista[]>(`/api/compras/presentaciones?proveedorId=${otroProveedorId}`);
    expect(deOtro.map((p) => p.id)).not.toContain(caja.id);
  });

  it('"Saco (25 kg)" de un producto en gramos se acepta: la unidad es compatible', async () => {
    await crear({ proveedorId, itemId: harinaG, nombre: 'Saco', contenido: '25', unidadCodigo: 'kg' });
  });

  it('unidad incompatible, producto por serie o contenido 0 son 400', async () => {
    expect((await intentar('post', '/api/compras/presentaciones',
      { proveedorId, itemId: latas, nombre: 'Caja', contenido: '12', unidadCodigo: 'kg' })).status).toBe(400);
    const serie = await intentar('post', '/api/compras/presentaciones',
      { proveedorId, itemId: celular, nombre: 'Caja', contenido: '10', unidadCodigo: 'unidad' });
    expect(serie.status).toBe(400);
    expect(serie.message).toContain('serie');
    expect((await intentar('post', '/api/compras/presentaciones',
      { proveedorId, itemId: latas, nombre: 'Caja', contenido: '0', unidadCodigo: 'unidad' })).status).toBe(400);
  });

  it('nombre de solo espacios o un tercero que no es proveedor son 400', async () => {
    expect((await intentar('post', '/api/compras/presentaciones',
      { proveedorId, itemId: latas, nombre: '   ', contenido: '12', unidadCodigo: 'unidad' })).status).toBe(400);
    expect((await intentar('post', '/api/compras/presentaciones',
      { proveedorId: empresaId, itemId: latas, nombre: 'Caja', contenido: '12', unidadCodigo: 'unidad' })).status).toBe(400);
  });

  it('el mismo nombre vivo del mismo par es 409 (sin distinguir mayúsculas); retirada, se puede repetir', async () => {
    const item = await productoNuevo('unidad');
    const a = await crear({ proveedorId, itemId: item, nombre: 'Pack', contenido: '6', unidadCodigo: 'unidad' });
    const r = await intentar('post', '/api/compras/presentaciones',
      { proveedorId, itemId: item, nombre: 'PACK', contenido: '12', unidadCodigo: 'unidad' });
    expect(r.status).toBe(409);
    await intentar('delete', `/api/compras/presentaciones/${a.id}`);
    await crear({ proveedorId, itemId: item, nombre: 'Pack', contenido: '12', unidadCodigo: 'unidad' });
  });
});
```

`productoNuevo(unidad, extra?)` es un helper del archivo que crea un ítem con `nombreUnico`. `PresentacionVista` es la interfaz local del spec, espejo de `PresentacionCompraVista`.

- [ ] **Step 3: Correr y ver que falla**

```bash
cd backend && npx jest --config ./test/jest-e2e.json compras-presentaciones
```

Expected: FAIL, con 404 en `POST /api/compras/presentaciones`.

⚠️ El nombre del worktree (`awesome-faraday-…`) no contiene "compras", así que el filtro de
archivo sí filtra. Verificar en la salida que corrió **un** archivo.

- [ ] **Step 4: Entidad**

```ts
// backend/src/modules/compras/entities/presentacion-compra.entity.ts
import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Cómo le viene un producto a un proveedor: "Caja" de 12 unidad, "Saco" de 25
 * kg (spec compras-unidad-de-compra § 3.1). Por (proveedor, producto), no por
 * producto: otro proveedor puede traerlo en pack de 6 (owner, decisión 4b).
 *
 * El contenido se guarda como se tipeó, no convertido: la conversión a la
 * unidad base la hace quien la usa, con el conversor del catálogo.
 *
 * ⚠️ `uq_presentaciones_compra_nombre` NO se declara acá: es sobre
 * `lower(nombre)` y TypeORM no sabe expresar una función en `@Index`. Lo crea
 * `seeder.service.ts` → `seedPresentacionesCompra()` con SQL cruda.
 */
@Entity('presentaciones_compra')
@Index('idx_presentaciones_compra_proveedor', ['tenantId', 'proveedorId'])
export class PresentacionCompra {
  @PrimaryGeneratedColumn('uuid', { name: 'presentacion_compra_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'proveedor_id', type: 'uuid' })
  proveedorId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'varchar', length: 40 })
  nombre: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  contenido: string;

  @Column({ name: 'unidad_codigo', type: 'text' })
  unidadCodigo: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

Registrar `PresentacionCompra` en `RepositoriosModule.forFeature([...])` de `compras.module.ts` y
en el array `entities` de `app.module.ts`, junto a `CompraLineaCambio`.

- [ ] **Step 5: DTOs**

```ts
// backend/src/modules/compras/dto/presentacion-compra.dto.ts
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsNumberString, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { IsDecimalPositivo } from '../../../common/decorators/decimal-signo.decorator';

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Body de `POST /compras/presentaciones`. ⚠️ Sin `tenantId`: sale del token. */
export class CrearPresentacionCompraDto {
  @IsUUID()
  proveedorId: string;

  @IsUUID()
  itemId: string;

  @Transform(recortar)
  @IsString()
  @Matches(/\S/, { message: 'El nombre no puede quedar vacío' })
  @MaxLength(40)
  nombre: string;

  /** Cuánto trae, en `unidadCodigo`. String + Decimal.js, como toda cantidad de kardex. */
  @IsNumberString()
  @IsDecimalPositivo()
  contenido: string;

  @IsString()
  @IsNotEmpty()
  unidadCodigo: string;
}

/**
 * Body de `PATCH /compras/presentaciones/:id`. Ausente es "no se toca"; `null`
 * es 400 (`@ValidateIf` sobre `undefined`, no `@IsOptional`, que deja pasar el
 * null). Mismo idioma que `CorregirLineaDto`.
 */
export class EditarPresentacionCompraDto {
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(recortar)
  @IsString()
  @Matches(/\S/, { message: 'El nombre no puede quedar vacío' })
  @MaxLength(40)
  nombre?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsNumberString()
  @IsDecimalPositivo()
  contenido?: string;

  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;
}

export class ListarPresentacionesCompraDto {
  @IsUUID()
  proveedorId: string;
}
```

Antes de copiar el `@Transform(recortar)`: `grep -rn "Transform(" backend/src/modules/*/dto | head`
para ver si el repo ya tiene un recortador compartido. Si existe, usarlo en vez de definir otro.

- [ ] **Step 6: Service**

```ts
// backend/src/modules/compras/presentaciones-compra.service.ts
@Injectable()
export class PresentacionesCompraService {
  constructor(
    private readonly db: Db,
    private readonly catalogService: CatalogService,
  ) {}

  async listar(tenantId: string, proveedorId: string): Promise<PresentacionCompraVista[]> {
    const rows: PresentacionRow[] = await this.db.query(
      `SELECT ${COLUMNAS} FROM presentaciones_compra
        WHERE tenant_id = $1 AND proveedor_id = $2 AND eliminado_el IS NULL
        ORDER BY item_id, lower(nombre)`,
      [tenantId, proveedorId],
    );
    return rows.map(vista);
  }

  async crear(tenantId: string, dto: CrearPresentacionCompraDto): Promise<PresentacionCompraVista> {
    await this.assertProveedor(tenantId, dto.proveedorId);
    await this.assertProductoYContenido(tenantId, dto.itemId, dto.contenido, dto.unidadCodigo);
    const rows: PresentacionRow[] = await this.conNombreUnico(() =>
      this.db.query(
        `INSERT INTO presentaciones_compra (tenant_id, proveedor_id, item_id, nombre, contenido, unidad_codigo)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNAS}`,
        [tenantId, dto.proveedorId, dto.itemId, dto.nombre, dto.contenido, dto.unidadCodigo],
      ),
    );
    return vista(rows[0]);
  }

  async editar(tenantId: string, id: string, dto: EditarPresentacionCompraDto): Promise<PresentacionCompraVista> {
    const actual = await this.vivaOrFail(tenantId, id);
    const nueva = {
      nombre: dto.nombre ?? actual.nombre,
      contenido: dto.contenido ?? actual.contenido,
      unidadCodigo: dto.unidadCodigo ?? actual.unidad_codigo,
    };
    await this.assertProductoYContenido(tenantId, actual.item_id, nueva.contenido, nueva.unidadCodigo);
    const rows: PresentacionRow[] = await this.conNombreUnico(() =>
      this.db.query(
        `UPDATE presentaciones_compra
            SET nombre = $3, contenido = $4, unidad_codigo = $5, actualizado_el = NOW()
          WHERE tenant_id = $1 AND presentacion_compra_id = $2 AND eliminado_el IS NULL
          RETURNING ${COLUMNAS}`,
        [tenantId, id, nueva.nombre, nueva.contenido, nueva.unidadCodigo],
      ),
    );
    return vista(rows[0]);
  }

  /** Retirar es marcar: las compras confirmadas ya congelaron su contenido. */
  async retirar(tenantId: string, id: string): Promise<void> {
    const rows: unknown[] = await this.db.query(
      `UPDATE presentaciones_compra SET eliminado_el = NOW(), actualizado_el = NOW()
        WHERE tenant_id = $1 AND presentacion_compra_id = $2 AND eliminado_el IS NULL
        RETURNING presentacion_compra_id`,
      [tenantId, id],
    );
    if (!rows.length) throw new NotFoundException('Presentación no encontrada');
  }

  async vivasPorIds(tenantId: string, ids: string[]): Promise<Map<string, PresentacionViva>> {
    if (!ids.length) return new Map();
    const rows: PresentacionRow[] = await this.db.query(
      `SELECT ${COLUMNAS} FROM presentaciones_compra
        WHERE tenant_id = $1 AND presentacion_compra_id = ANY($2::uuid[]) AND eliminado_el IS NULL`,
      [tenantId, ids],
    );
    return new Map(rows.map((r) => [r.presentacion_compra_id, vista(r)]));
  }
}
```

Lo que falta escribir en el mismo archivo:

- `COLUMNAS`: `presentacion_compra_id, proveedor_id, item_id, nombre, contenido, unidad_codigo`. `PresentacionRow` con esos nombres, y `vista(r)` que los pasa a camelCase.
- `assertProveedor`: una query a `terceros` (`tercero_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`). Si no existe, 400 `'Proveedor no encontrado'`, el mismo mensaje que `validarEncabezado` (`compras.service.ts:~1881`) para que un id ajeno no se distinga de uno inexistente. Si `tipo !== 'proveedor'`, 400 `'"<nombre>" no es un proveedor'`.
- `assertProductoYContenido`: una query a `items` + `item_producto` con `eliminado_el IS NULL`. Da 400 si no existe o no es `producto`/`ingrediente` (`TIPOS_CON_STOCK`: exportarla desde `compras.service.ts` en vez de copiarla), 400 `'"<nombre>" va por serie: no admite presentación'` si `modo_inventario === 'serie'`, y después `(await this.catalogService.crearConversor())(contenido, unidadCodigo, unidadBase)`. Esa última llamada ya tira 400 si la unidad no existe, es de otra magnitud o cae bajo la precisión de stock. Sin conversión si `unidadCodigo === unidadBase`.
- `vivaOrFail`: SELECT por id + tenant + `eliminado_el IS NULL`. Si no está, 404 `'Presentación no encontrada'`.
- `conNombreUnico(fn)`: captura `code === '23505' && constraint === 'uq_presentaciones_compra_nombre'` y lanza `ConflictException('Ya hay una presentación con ese nombre para este producto y proveedor')`. Es el patrón de `insertarSinChoqueDeFolio` (`compras.service.ts:~2118`).

Registrar `PresentacionesCompraService` en `providers` y `exports` de `compras.module.ts`.

- [ ] **Step 7: Controller**

En `compras.controller.ts`, **después** de `@Get('productos')` y **antes** de `@Get()`:

```ts
  /**
   * Cómo le viene cada producto a un proveedor (spec compras-unidad-de-compra
   * § 5). `Crear`: se crean, corrigen y retiran en plena carga del borrador
   * (owner, 2026-09-27), es operación del módulo y no configuración del admin.
   */
  @Get('presentaciones')
  @RequiresPermiso('Compras', 'Crear')
  presentaciones(@Req() req: Request, @Query() query: ListarPresentacionesCompraDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.presentacionesService.listar(tenantId, query.proveedorId);
  }

  @Post('presentaciones')
  @RequiresPermiso('Compras', 'Crear')
  crearPresentacion(@Req() req: Request, @Body() dto: CrearPresentacionCompraDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.presentacionesService.crear(tenantId, dto);
  }

  @Patch('presentaciones/:id')
  @RequiresPermiso('Compras', 'Crear')
  editarPresentacion(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditarPresentacionCompraDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.presentacionesService.editar(tenantId, id, dto);
  }

  @Delete('presentaciones/:id')
  @HttpCode(204)
  @RequiresPermiso('Compras', 'Crear')
  retirarPresentacion(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    const { tenantId } = req.user as { tenantId: string };
    return this.presentacionesService.retirar(tenantId, id);
  }
```

Inyectar `private readonly presentacionesService: PresentacionesCompraService` en el constructor.
Antes de fijar el 204: mirar qué devuelve hoy `@Delete(':id')` del mismo controller
(`:193`) y usar lo mismo.

- [ ] **Step 8: Seed — índice y dos presentaciones de Andina**

```ts
  /**
   * Presentaciones de compra (spec compras-unidad-de-compra § 3.1). El índice
   * va acá y no en la entity: es sobre `lower(nombre)`. Se crea siempre, antes
   * del early-return, porque `synchronize` no lo conoce.
   */
  private async seedPresentacionesCompra(): Promise<void> {
    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_presentaciones_compra_nombre
      ON presentaciones_compra (tenant_id, proveedor_id, item_id, lower(nombre))
      WHERE eliminado_el IS NULL
    `);
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const ANDINA = '550e8400-e29b-41d4-a716-446655440147';
    const PAN_ID = uuid(256);   // Pan de hamburguesa, en unidad
    const CARNE_ID = uuid(257); // Carne molida, en kg
    await this.dataSource.query(
      `INSERT INTO presentaciones_compra
         (presentacion_compra_id, tenant_id, proveedor_id, item_id, nombre, contenido, unidad_codigo)
       VALUES ($1, $2, $3, $4, 'Bolsa', '24', 'unidad'),
              ($5, $2, $3, $6, 'Caja', '10', 'kg')
       ON CONFLICT (presentacion_compra_id) DO NOTHING`,
      [uuid(450), PARIS, ANDINA, PAN_ID, uuid(451), CARNE_ID],
    );
  }
```

Llamarlo justo después de `await this.seedIngredientesBase();` (`seeder.service.ts:~4104`).
Verificar antes que `uuid(450)` y `uuid(451)` siguen libres
(`grep -c "uuid(45[01])\|446655440450\|446655440451" backend/src/modules/seeder/seeder.service.ts`
→ `0`), y que `uuid` se llama así en el alcance del método (en otros métodos es una función local:
copiar su definición si hace falta). Las dos formas de la seed son a propósito: una en `unidad` y
otra en `kg`.

- [ ] **Step 9: E2E de editar, retirar, permisos y aislamiento (sumar al archivo del Step 2)**

```ts
  it('editar corrige 24 → 12; null es 400; ausente no toca', async () => {
    const item = await productoNuevo('unidad');
    const c = await crear({ proveedorId, itemId: item, nombre: 'Caja', contenido: '24', unidadCodigo: 'unidad' });
    const r = await request(app.getHttpServer()).patch(`/api/compras/presentaciones/${c.id}`)
      .set('Authorization', `Bearer ${token}`).send({ contenido: '12' });
    expect(r.status).toBe(200);
    expect((r.body as PresentacionVista)).toMatchObject({ nombre: 'Caja', contenido: '12.0000' });
    expect((await intentar('patch', `/api/compras/presentaciones/${c.id}`, { contenido: null })).status).toBe(400);
  });

  it('retirar la saca del listado; retirar dos veces es 404', async () => {
    const item = await productoNuevo('unidad');
    const c = await crear({ proveedorId, itemId: item, nombre: 'Caja', contenido: '12', unidadCodigo: 'unidad' });
    expect((await intentar('delete', `/api/compras/presentaciones/${c.id}`)).status).toBe(204);
    const lista = await get<PresentacionVista[]>(`/api/compras/presentaciones?proveedorId=${proveedorId}`);
    expect(lista.map((p) => p.id)).not.toContain(c.id);
    expect((await intentar('delete', `/api/compras/presentaciones/${c.id}`)).status).toBe(404);
  });

  it('solo Compras:Leer es 403 en los cuatro; el encargado de compras crea', async () => {
    const lectura = await login(COMPRAS_LECTURA_EMAIL);
    const c = await crear({ proveedorId, itemId: latas, nombre: `Pack ${Date.now()}`, contenido: '6', unidadCodigo: 'unidad' },
      201, await login(ENCARGADO_COMPRAS_EMAIL));
    expect((await intentar('get', `/api/compras/presentaciones?proveedorId=${proveedorId}`, {}, lectura)).status).toBe(403);
    expect((await intentar('post', '/api/compras/presentaciones', {}, lectura)).status).toBe(403);
    expect((await intentar('patch', `/api/compras/presentaciones/${c.id}`, { contenido: '8' }, lectura)).status).toBe(403);
    expect((await intentar('delete', `/api/compras/presentaciones/${c.id}`, {}, lectura)).status).toBe(403);
  });

  it('otro tenant: no la lista, editarla o retirarla es 404, y no crea una para el proveedor de Paris', async () => {
    const c = await crear({ proveedorId, itemId: latas, nombre: `Six ${Date.now()}`, contenido: '6', unidadCodigo: 'unidad' });
    const otro = await loginSegundoTenant(app);
    const lista = await get<PresentacionVista[]>(`/api/compras/presentaciones?proveedorId=${proveedorId}`, 200, otro);
    expect(lista).toEqual([]);
    expect((await intentar('patch', `/api/compras/presentaciones/${c.id}`, { contenido: '8' }, otro)).status).toBe(404);
    expect((await intentar('delete', `/api/compras/presentaciones/${c.id}`, {}, otro)).status).toBe(404);
    const r = await intentar('post', '/api/compras/presentaciones',
      { proveedorId, itemId: latas, nombre: 'Caja', contenido: '12', unidadCodigo: 'unidad' }, otro);
    expect(r).toEqual({ status: 400, message: 'Proveedor no encontrado' });
  });

  it('el seed deja "Bolsa (24)" y "Caja (10 kg)" de Distribuidora Andina', async () => {
    const lista = await get<PresentacionVista[]>(
      '/api/compras/presentaciones?proveedorId=550e8400-e29b-41d4-a716-446655440147');
    expect(lista.map((p) => [p.nombre, p.contenido, p.unidadCodigo]))
      .toEqual(expect.arrayContaining([['Bolsa', '24.0000', 'unidad'], ['Caja', '10.0000', 'kg']]));
  });
```

- [ ] **Step 10: Correr el e2e nuevo hasta verde**

```bash
./scripts/reset-db.sh && cd backend && npx jest --config ./test/jest-e2e.json compras-presentaciones
```

Expected: PASS, todos los tests. Si el índice no existe, el 409 sale como 201. Chequear con
`\d presentaciones_compra` que `uq_presentaciones_compra_nombre` está.

- [ ] **Step 11: Mutantes (revertir, no solo romper)**

Uno por vez, correr el e2e, ver que **cae el test nombrado**, y revertir. Mirar la hora del
restart del watcher: el revert tiene que haber recargado.

| Mutante | Debe caer |
|---|---|
| Quitar `AND eliminado_el IS NULL` de `listar` | *retirar la saca del listado* |
| Quitar el `modo_inventario === 'serie'` | *unidad incompatible, producto por serie…* |
| `WHERE eliminado_el IS NULL` fuera del `CREATE UNIQUE INDEX` | *…retirada, se puede repetir* |
| `tenant_id = $1` fuera de `vivaOrFail` | *otro tenant…* |

- [ ] **Step 12: Docs**

- `startup-pos.sql`: la tabla `presentaciones_compra` con el índice único parcial y el de
  `(tenant_id, proveedor_id)`, junto a `compra_lineas`.
- `docs/features/compras.md`: "Pieza 2 (en construcción)" en Scope, y las cuatro rutas en la
  tabla de API.
- `docs/ESTADO.md`: la fila de compras con la pieza 2 🔲 en curso.

- [ ] **Step 13: Gate completo, revisión y commit**

Checklist de CLAUDE.md entero (`lint:check`, `typecheck`, `npm test`, `reset-db.sh` → `test:e2e`
→ `reset-db.sh --verificar`; frontend `build`, `test`, `typecheck:ratchet`, `design:check`), con
**exit code**, sin `| tail`. Después, `verify-feature` con `domain-reviewer` **y**
`api-security-reviewer` (controller, DTO y entidad nuevos), los dos con `model: 'sonnet'`. Duda
concreta para el revisor: *"¿Hay algún camino por el que un `proveedorId` o `itemId` de otro
tenant termine en una fila de `presentaciones_compra`? ¿Y el 409 del índice podría salir como
500 en `editar`?"*

```bash
git add backend/src/modules/compras/entities/presentacion-compra.entity.ts \
  backend/src/modules/compras/dto/presentacion-compra.dto.ts \
  backend/src/modules/compras/presentaciones-compra.service.ts \
  backend/src/modules/compras/compras.controller.ts backend/src/modules/compras/compras.module.ts \
  backend/src/app.module.ts backend/src/modules/seeder/seeder.service.ts \
  backend/test/compras-presentaciones.e2e-spec.ts startup-pos.sql \
  docs/features/compras.md docs/ESTADO.md
git diff --cached --stat
git commit -m "feat(compras): presentaciones de compra por proveedor y producto (pieza 2, tarea 1)"
```

Avisar a la sesión orquestadora: rama, hash de `git log -1`, gate con conteos y veredictos.

---

### Task 2: La línea con presentación — borrador, confirmar, corregir y detalle

**Files:**
- Modify: `backend/src/modules/compras/entities/compra-linea.entity.ts`
- Modify: `backend/src/modules/compras/dto/compra-borrador.dto.ts` (`LineaCompraDto`)
- Modify: `backend/src/modules/compras/compras.service.ts`: tipos (`CompraLineaDetalle`, `LineaRow`, `LineaConfirmada`), `validarLineas`, `insertarLineas`, `confirmarEnTransaccion`, corrección de cantidad, `lineasConfirmadas`, `findOne`
- Modify: `backend/src/modules/compras/compras.module.ts` (sin cambios si la Task 1 ya exporta el service; `ComprasService` lo inyecta)
- Modify: `backend/src/modules/compras/compras.service.spec.ts`
- Modify: `backend/test/compras-presentaciones.e2e-spec.ts`
- Modify: `startup-pos.sql`, `docs/features/compras.md`, `docs/PRODUCTO.md`

**Interfaces:**
- Consumes: `PresentacionesCompraService.vivasPorIds(tenantId, ids)` → `Map<string, PresentacionViva>` (Task 1).
- Produces (lo usa la Task 3), en el detalle `GET /compras/:id`:
  ```ts
  export interface PresentacionLinea {
    id: string;
    nombre: string;
    /** Borrador: como está hoy, en `unidadCodigo`. Confirmada: el congelado, en la unidad base. */
    contenido: string;
    unidadCodigo: string;
  }
  export interface CompraLineaDetalle {
    // …lo de hoy, con:
    unidadCodigo: string | null;          // null si va en presentación
    presentacion: PresentacionLinea | null;
  }
  ```
  Body de la línea: `{ itemId, cantidad, precioUnitario?, series?, lote?, unidadCodigo? , presentacionId? }`,
  con **exactamente una** de `unidadCodigo` / `presentacionId`.

- [ ] **Step 1: Unitario que falla — el helper**

En `compras.service.spec.ts`, un `describe('cantidadEnBase')` sobre la función **exportada** de
`compras.service.ts`. Es pura, como `costearLineas` en `reparto-descuento.ts`, pero es de unidades
y no de descuento, así que vive junto a sus tres llamadores:

```ts
describe('cantidadEnBase (spec pieza 2 § 4.2)', () => {
  const conversor = async () => (c: string, desde: string, hacia: string) => {
    if (desde === 'kg' && hacia === 'g') return new Decimal(c).times(1000).toString();
    throw new BadRequestException(`No se puede convertir de ${desde} a ${hacia}`);
  };
  it('con presentación multiplica por el contenido en base', async () => {
    expect(await cantidadEnBase('10', { contenidoBase: '12' }, 'unidad', conversor)).toBe('120');
    expect(await cantidadEnBase('3', { contenidoBase: '12' }, 'unidad', conversor)).toBe('36');
    expect(await cantidadEnBase('2', { contenidoBase: '25000' }, 'g', conversor)).toBe('50000');
  });
  it('cuantiza a 4 decimales y rechaza lo que cae a 0', async () => {
    expect(await cantidadEnBase('1.5', { contenidoBase: '0.3333' }, 'kg', conversor)).toBe('0.5');
    await expect(cantidadEnBase('0.0001', { contenidoBase: '0.0001' }, 'kg', conversor)).rejects.toThrow(BadRequestException);
  });
  it('sin presentación convierte con el catálogo, y en la base no convierte', async () => {
    expect(await cantidadEnBase('3', { unidadCodigo: 'kg' }, 'g', conversor)).toBe('3000');
    expect(await cantidadEnBase('7', { unidadCodigo: 'g' }, 'g', conversor)).toBe('7');
  });
});
```

`1.5 × 0.3333 = 0.49995` → `0.5` a 4 decimales con `ROUND_HALF_UP`: es el valor que discrimina
entre cuantizar y no cuantizar.

- [ ] **Step 2: Correr y ver que falla** — `cd backend && npx jest compras.service.spec -t cantidadEnBase` → FAIL (no existe).

- [ ] **Step 3: El helper**

En `compras.service.ts`, a nivel de módulo:

```ts
type Conversor = (cantidad: string, desde: string, hacia: string) => string;

/**
 * La cantidad de una línea en la unidad base del producto: el ÚNICO lugar que
 * la calcula (spec compras-unidad-de-compra § 4.2). Lo llaman la validación del
 * borrador, confirmar y la corrección de cantidad. Si alguno convirtiera por su
 * cuenta, ese sería el camino que lee "10 cajas" como 10 unidades.
 *
 * `conversor` es perezoso: una factura toda en la unidad base, o toda en
 * presentaciones con contenido ya en base, no consulta el catálogo.
 */
export async function cantidadEnBase(
  cantidad: string,
  unidad: { contenidoBase: string } | { unidadCodigo: string },
  unidadBase: string,
  conversor: () => Promise<Conversor>,
): Promise<string> {
  if ('contenidoBase' in unidad) {
    const base = new Decimal(cantidad)
      .times(unidad.contenidoBase)
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    if (base.isZero()) {
      throw new BadRequestException(
        `La cantidad (${cantidad} × ${unidad.contenidoBase}) es menor a la precisión de stock (4 decimales)`,
      );
    }
    return base.toString();
  }
  if (unidad.unidadCodigo === unidadBase) return cantidad;
  return (await conversor())(cantidad, unidad.unidadCodigo, unidadBase);
}
```

Y en `ComprasService`, un generador del conversor memoizado por request:

```ts
  /** El conversor del catálogo, cargado la primera vez que se pide y no antes. */
  private conversorPerezoso(): () => Promise<Conversor> {
    let cargado: Promise<Conversor> | null = null;
    return () => (cargado ??= this.catalogService.crearConversor());
  }
```

- [ ] **Step 4: Correr el unitario** → PASS.

- [ ] **Step 5: E2E que falla — el borrador y confirmar con presentación**

Sumar a `compras-presentaciones.e2e-spec.ts` un `describe('la línea con presentación')`, con los
helpers `stockEn`, `costoActual` y `confirmar` copiados de `compras.e2e-spec.ts:447-493` y un
`borrador(lineas)` propio (factura con `folioUnico()`, bodega propia):

```ts
  it('10 cajas de 12 a $9.600 → 120 unidades a $800; el detalle congela "Caja" y 12', async () => {
    const item = await productoNuevo('unidad');
    const caja = await crear({ proveedorId, itemId: item, nombre: 'Caja', contenido: '12', unidadCodigo: 'unidad' });
    const compra = await post<CompraDetalle>('/api/compras', borrador([
      { itemId: item, cantidad: '10', presentacionId: caja.id, precioUnitario: '9600' },
    ]));
    expect(compra.lineas[0]).toMatchObject({ unidadCodigo: null, presentacion: { id: caja.id, nombre: 'Caja', contenido: '12.0000', unidadCodigo: 'unidad' } });
    await confirmar(compra.id);
    expect(await stockEn(item, bodegaId)).toBe(120);
    expect(await costoActual(item)).toBe('800.0000');
    const [linea] = await ds.query(
      `SELECT cantidad_base, costo_unitario_base, presentacion_nombre, contenido_base FROM compra_lineas WHERE compra_id = $1`, [compra.id]);
    expect(linea).toEqual({ cantidad_base: '120.0000', costo_unitario_base: '800.0000', presentacion_nombre: 'Caja', contenido_base: '12.0000' });
  });

  it('3 cajas de 12 a $10.000 → 36 unidades a $833,3333 (no da exacto)', async () => { /* mismo molde, costoActual '833.3333' */ });

  it('2 "Saco (25 kg)" de un producto en gramos → 50.000 g', async () => { /* stockEn 50000 */ });

  it('lote: 10 cajas de 12 del lote L123 → 120 en ese lote', async () => {
    /* producto modoInventario 'lote'; línea con lote { codigoLote }; afirmar con GET /api/items/:id/lotes
       como compras.e2e-spec.ts:634-665, cantidad 120 en bodegaId */
  });

  it('el borrador toma la caja del día: creada con 24, editada a 12 antes de confirmar → 120', async () => { /* … */ });

  it('retirada entre el borrador y confirmar: 400 que la nombra, y no entra nada', async () => {
    /* crear borrador con la caja, DELETE la presentación, confirmar → 400 con message que contiene el
       nombre del producto y 'retirada'; stockEn 0; estado sigue 'borrador' */
  });

  it('presentación de otro proveedor o de otro producto: 400 al guardar', async () => { /* … */ });

  it('las dos (unidadCodigo y presentacionId) o ninguna: 400', async () => { /* … */ });

  it('presentación de otro tenant en la línea: 400, igual que una que no existe', async () => {
    /* crear la presentación con loginSegundoTenant sobre un proveedor e ítem del otro tenant
       (fixtures por API con ese token); usarla en un borrador de Paris → 400, el mismo mensaje que una retirada ('ya no existe o fue retirada') */
  });
```

Los cuerpos marcados `/* … */` siguen el molde del primero: crear producto y presentación,
`post` del borrador, `confirmar`, y afirmar `stockEn`/`costoActual`/estado. El implementador los
escribe enteros. El número esperado de cada uno ya está en su título.

- [ ] **Step 6: Correr y ver que falla** → FAIL (`presentacionId` rebota en el `whitelist` o
  `unidadCodigo` falta).

- [ ] **Step 7: Entidad y DTO**

`compra-linea.entity.ts`:

```ts
@Check('chk_compra_lineas_unidad_o_presentacion',
  `("unidad_codigo" IS NULL) <> ("presentacion_compra_id" IS NULL)`)
// …
  /** Null cuando la línea va en una presentación: exactamente una de las dos (CHECK). */
  @Column({ name: 'unidad_codigo', type: 'text', nullable: true })
  unidadCodigo: string | null;

  /** La presentación elegida en el borrador (spec pieza 2 § 3.2). */
  @Column({ name: 'presentacion_compra_id', type: 'uuid', nullable: true })
  presentacionCompraId: string | null;

  // ── Congelado al confirmar ──
  /** El nombre de la presentación al confirmar: el detalle no lee una retirada. */
  @Column({ name: 'presentacion_nombre', type: 'varchar', length: 40, nullable: true })
  presentacionNombre: string | null;

  /** Cuántas unidades base trae UNA presentación, al confirmar. Corregir la cantidad usa este, no el vivo. */
  @Column({ name: 'contenido_base', type: 'numeric', precision: 18, scale: 4, nullable: true })
  contenidoBase: string | null;
```

⚠️ Tipo explícito en cada `@Column` (memoria: `design:type` con `import type`). `@Check` en la
entidad tiene precedente (`recargos/entities/recargo.entity.ts:17`): lo crea `synchronize`. Después
del reset, confirmarlo con `\d compra_lineas`.

`LineaCompraDto`:

```ts
  /** En una unidad del catálogo. Exactamente una de `unidadCodigo` o `presentacionId` (lo exige el service). */
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @IsNotEmpty()
  unidadCodigo?: string;

  /** Una presentación del proveedor de la compra para este producto (spec pieza 2 § 4.1). */
  @ValidateIf((_o, v) => v !== undefined)
  @IsUUID()
  presentacionId?: string;
```

- [ ] **Step 8: `validarLineas` resuelve la unidad de cada línea**

Nueva firma, con todos sus llamadores ajustados. Antes de tocarla:
`grep -n "validarLineas(" backend/src/modules/compras/compras.service.ts` (crear, actualizar y
confirmar):

```ts
// A nivel de módulo:
/** Por índice de línea: con qué se convierte a la unidad base. */
interface UnidadResuelta {
  unidadBase: string;
  /** Null si la línea va en una unidad del catálogo. */
  presentacion: { id: string; nombre: string; contenidoBase: string } | null;
}

// En la clase:
  private async validarLineas(
    tenantId: string,
    proveedorId: string,
    lineas: LineaCompraDto[],
  ): Promise<{ items: Map<string, { unidadBase: string }>; unidades: UnidadResuelta[] }>
```

Dentro:
1. La query de ítems, igual.
2. **Una** llamada a `presentacionesService.vivasPorIds(tenantId, idsDeLineasConPresentacion)`.
3. En el loop, en este orden de 400: producto no encontrado · no lleva stock · **exactamente
   una de `unidadCodigo`/`presentacionId`** (`'"<nombre>": elegí una unidad o una presentación, no las dos'` /
   `'"<nombre>": falta la unidad'`). Con presentación:
   - si no está en el mapa (no existe, es de otro tenant o fue retirada) → 400
     **`'La presentación de "<nombre>" ya no existe o fue retirada: elegí otra unidad'`**. Un solo
     mensaje para los tres casos: distinguir "retirada" obligaría a leer una fila borrada, y un
     id ajeno no tiene que distinguirse de uno inexistente;
   - `p.proveedorId !== proveedorId` → `'La presentación de "<nombre>" es de otro proveedor'`;
   - `p.itemId !== linea.itemId` → `'La presentación elegida no es de "<nombre>"'`;
   - `modo_inventario === 'serie'` → `'"<nombre>" va por serie: no admite presentación'`;
   - `contenidoBase = await cantidadEnBase(p.contenido, { unidadCodigo: p.unidadCodigo }, base, conversor)`.
   Sin presentación, lo de hoy (`:1990-2001`) pero con `cantidadEnBase(linea.cantidad, { unidadCodigo }, base, conversor)`
   en vez de `convertir(...)` suelto. El guard *"serie o lote solo admiten su unidad base"* sigue
   solo para el camino sin presentación.
4. `validarTrazabilidad` igual.

⚠️ Mismo orden de errores que hoy para las líneas sin presentación: el primer 400 del loop
no cambia (el e2e de la pieza 1 lo afirma).

- [ ] **Step 9: `insertarLineas`**: `COLUMNAS = 10`, y las columnas `unidad_codigo` y
  `presentacion_compra_id` con `l.unidadCodigo ?? null` y `l.presentacionId ?? null`.

- [ ] **Step 10: Confirmar**

En `confirmarEnTransaccion`:
- El SELECT de líneas (`:~742`) suma `presentacion_compra_id`. El `dto` que se arma
  (`:~757-775`) pasa `unidadCodigo: l.unidad_codigo ?? undefined` y
  `presentacionId: l.presentacion_compra_id ?? undefined`.
- `validarLineas(tenantId, c.proveedor_id, dto.lineas)` devuelve `unidades`.
- `bases` (`:~818-829`) pasa a:
  ```ts
  const conversor = this.conversorPerezoso();
  const bases = await Promise.all(lineas.map((l, i) =>
    cantidadEnBase(
      l.cantidad,
      unidades[i].presentacion ? { contenidoBase: unidades[i].presentacion!.contenidoBase } : { unidadCodigo: l.unidad_codigo! },
      unidades[i].unidadBase,
      conversor,
    )));
  ```
  (`Promise.all` sobre funciones que solo esperan el conversor memoizado: **una** carga del
  catálogo, ninguna query por línea.)
- El UPDATE de congelados (`:~897`) suma `presentacion_nombre` y `contenido_base`
  (`COLUMNAS = 8`, `::varchar` y `::numeric`).

**Sin lock sobre la presentación, a propósito:** si alguien la edita mientras se confirma, la
compra entra con el valor que leyó y la edición vale para las siguientes. Es el mismo resultado que
si la edición hubiera llegado un segundo después. Queda escrito en un comentario en el paso 1 de
confirmar.

- [ ] **Step 11: Corregir la cantidad con lo congelado**

`LineaConfirmada` y `lineasConfirmadas` (`:~1607`) suman `cl.contenido_base` y
`cl.presentacion_nombre`; `unidad_codigo` pasa a `string | null`. En la corrección
(`:~1084`):

```ts
    const nuevaBase = await cantidadEnBase(
      dto.cantidad!,
      linea.contenido_base != null
        ? { contenidoBase: linea.contenido_base }   // el congelado, nunca el vivo
        : { unidadCodigo: linea.unidad_codigo! },
      linea.unidad_base,
      this.conversorPerezoso(),
    );
```

Buscar cualquier otro uso de `linea.unidad_codigo` / `l.unidad_codigo` en el archivo y decidir
uno por uno. `grep -n "unidad_codigo" compras.service.ts` al final del paso tiene que mostrar solo
SELECTs, el INSERT y el mapeo del detalle.

- [ ] **Step 12: El detalle**

`findOne` (`:~513`): el SELECT de líneas suma
`cl.presentacion_compra_id, cl.presentacion_nombre, cl.contenido_base, pc.nombre AS pc_nombre, pc.contenido AS pc_contenido, pc.unidad_codigo AS pc_unidad`
con
`LEFT JOIN presentaciones_compra pc ON pc.presentacion_compra_id = cl.presentacion_compra_id AND pc.eliminado_el IS NULL`.
Mapeo:

```ts
presentacion:
  l.contenido_base != null
    ? { id: l.presentacion_compra_id!, nombre: l.presentacion_nombre!, contenido: l.contenido_base, unidadCodigo: l.unidad_medida ?? 'unidad' }
    : l.pc_nombre != null
      ? { id: l.presentacion_compra_id!, nombre: l.pc_nombre, contenido: l.pc_contenido!, unidadCodigo: l.pc_unidad! }
      : null,
```

Un borrador cuya presentación fue retirada devuelve `unidadCodigo: null` y `presentacion: null`.
La pantalla lo muestra sin unidad y pide elegir (Task 3). No se lee la fila retirada.

- [ ] **Step 13: E2E de la confirmada (sumar)**

```ts
  it('confirmada con 12, la caja pasa a 6, bajar a 8 cajas saca 24 unidades (usa el congelado)', async () => {
    const item = await productoNuevo('unidad');
    const caja = await crear({ proveedorId, itemId: item, nombre: 'Caja', contenido: '12', unidadCodigo: 'unidad' });
    const compra = await post<CompraDetalle>('/api/compras', borrador([
      { itemId: item, cantidad: '10', presentacionId: caja.id, precioUnitario: '9600' }]));
    await confirmar(compra.id);
    await request(app.getHttpServer()).patch(`/api/compras/presentaciones/${caja.id}`)
      .set('Authorization', `Bearer ${token}`).send({ contenido: '6' }).expect(200);
    const lineaId = (await get<CompraDetalle>(`/api/compras/${compra.id}`)).lineas[0].id;
    const r = await intentar('patch', `/api/compras/${compra.id}/lineas/${lineaId}`, { cantidad: '8' });
    expect(r.status).toBe(200);
    expect(await stockEn(item, bodegaId)).toBe(96);   // 120 − 2 × 12, no 120 − 2 × 6
    const detalle = await get<CompraDetalle>(`/api/compras/${compra.id}`);
    expect(detalle.lineas[0].presentacion).toMatchObject({ nombre: 'Caja', contenido: '12.0000' });
    expect(detalle.cambios.map((c) => [c.campo, c.valorAnterior, c.valorNuevo])).toEqual([['cantidad', '10', '8']]);
  });

  it('retirar la presentación no cambia el detalle de una confirmada', async () => { /* DELETE, GET → presentacion.nombre 'Caja' */ });
```

Antes de fijar `valorAnterior`/`valorNuevo`: mirar qué escribe hoy el historial para una cantidad
(`'10'` o `'10.0000'`) en `compras.e2e-spec.ts:1216-1220` y usar ese formato.

- [ ] **Step 14: Correr los e2e de compras** (los dos archivos)

```bash
./scripts/reset-db.sh && cd backend && npx jest --config ./test/jest-e2e.json compras
```

Expected: PASS en los dos. **Los de la pieza 1 sin tocar**: si alguno cae, el cambio rompió el
camino sin presentación.

- [ ] **Step 15: Mutantes que revierten al código anterior**

| Mutante | Debe caer |
|---|---|
| En confirmar, `bases` como antes: `l.unidad_codigo === base ? l.cantidad : convertir(...)` | *10 cajas de 12…* (con el CHECK, revienta en el conversor con `null`: **anotar el mensaje real**) |
| En corregir, leer el contenido vivo de `presentaciones_compra` en vez de `contenido_base` | *confirmada con 12, la caja pasa a 6…* (96 vs 108) |
| Quitar `.toDecimalPlaces(4, …)` del helper | unitario *cuantiza a 4 decimales* |
| Quitar el chequeo `p.proveedorId !== proveedorId` | *presentación de otro proveedor…* |

Para el primero: si sobrevive porque el CHECK o el `!` lo tapan antes, el test no discrimina.
Escribir **por qué** con la salida medida, no con una suposición.

- [ ] **Step 16: Docs**

- `startup-pos.sql`: las tres columnas nuevas de `compra_lineas`, `unidad_codigo` null y el CHECK.
- `docs/features/compras.md`: sección nueva *"La unidad de compra por proveedor (pieza 2)"* con
  qué se congela y por qué, la tabla de bordes (retirada, otro proveedor, serie) y el body de la
  línea.
- `docs/PRODUCTO.md`: la regla de negocio (por proveedor y producto; varias; se congela al
  confirmar; serie no), con un enlace a la spec.

- [ ] **Step 17: Gate completo, revisión y commit**

El mismo gate de la Task 1. `verify-feature` con `domain-reviewer` + `api-security-reviewer`,
`model: 'sonnet'`. Duda concreta: *"¿Queda algún camino en `compras.service.ts` que convierta la
cantidad de una línea sin pasar por `cantidadEnBase`, o que lea `unidad_codigo` asumiendo que no es
null? Barré los usos, no solo los tres sitios del plan."* ⚠️ El revisor muta el working tree: no
correr la revisión y el e2e a la vez, y `reset-db.sh --verificar` después.

```bash
git add backend/src/modules/compras/entities/compra-linea.entity.ts \
  backend/src/modules/compras/dto/compra-borrador.dto.ts \
  backend/src/modules/compras/compras.service.ts backend/src/modules/compras/compras.service.spec.ts \
  backend/test/compras-presentaciones.e2e-spec.ts startup-pos.sql \
  docs/features/compras.md docs/PRODUCTO.md
git diff --cached --stat
git commit -m "feat(compras): la línea en presentación, congelada al confirmar (pieza 2, tarea 2)"
```

Avisar a la orquestadora.

---

## Frontend

### Task 3: La pantalla, el navegador y el cierre de la pieza

**Files:**
- Modify: `frontend/app/composables/useCompras.ts`, `frontend/app/composables/useCompras.spec.ts`
- Create: `frontend/app/components/compras/PresentacionModal.vue`, `PresentacionModal.nuxt.spec.ts`
- Modify: `frontend/app/pages/compras/[id].vue`, `frontend/app/pages/compras/compras-carga.nuxt.spec.ts`
- Modify: `frontend/app/components/compras/CompraConfirmada.vue` (`:59`, `:94`), `CorregirLineaModal.vue` (`:135`), `AnularCompraModal.vue` (`:63`) y sus specs
- Create: `frontend/e2e/compras/compras-presentacion.spec.ts`
- Modify: `docs/features/compras.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/resueltos.md`

**Interfaces:**
- Consumes: las rutas de la Task 1 y el detalle de la Task 2 (`unidadCodigo: string | null`, `presentacion: PresentacionLinea | null`).
- Produces, en `useCompras()`:
  ```ts
  export interface PresentacionCompra { id: string, itemId: string, nombre: string, contenido: string, unidadCodigo: string }
  etiquetaPresentacion(p: { nombre: string, contenido: string, unidadCodigo: string }): string
  // "Caja (12)" si unidad === 'unidad'; "Saco (25 kg)" si no. Contenido sin ceros de más, con coma.
  unidadDeLinea(l: { unidadCodigo: string | null, presentacion: {…} | null }): string
  // La etiqueta de la presentación, o la unidad. '' si no tiene ninguna (borrador con una retirada).
  cuentaPresentacion(cantidad: string, contenido: string, unidad: string, precio: string | null): string | null
  // "= 120 unidad · $800 c/u" (la cantidad y "Caja (12)" ya están en los inputs de la línea):
  // null si la cantidad no es un número.
  ```

Antes de escribir código: `nuxt-ui` skill y `docs/patterns/frontend.md` (memoria del owner).

- [ ] **Step 1: Unitarios del composable que fallan**

En `useCompras.spec.ts`:

```ts
describe('presentaciones (spec pieza 2 § 6)', () => {
  const { etiquetaPresentacion, unidadDeLinea, cuentaPresentacion } = useCompras()
  it('etiqueta: en unidad sin la unidad, en otra con la unidad, sin ceros de más', () => {
    expect(etiquetaPresentacion({ nombre: 'Caja', contenido: '12.0000', unidadCodigo: 'unidad' })).toBe('Caja (12)')
    expect(etiquetaPresentacion({ nombre: 'Saco', contenido: '25.0000', unidadCodigo: 'kg' })).toBe('Saco (25 kg)')
    expect(etiquetaPresentacion({ nombre: 'Bolsa', contenido: '1.5000', unidadCodigo: 'kg' })).toBe('Bolsa (1,5 kg)')
  })
  it('unidad de la línea: presentación, unidad o vacío', () => {
    expect(unidadDeLinea({ unidadCodigo: null, presentacion: { nombre: 'Caja', contenido: '12', unidadCodigo: 'unidad' } })).toBe('Caja (12)')
    expect(unidadDeLinea({ unidadCodigo: 'kg', presentacion: null })).toBe('kg')
    expect(unidadDeLinea({ unidadCodigo: null, presentacion: null })).toBe('')
  })
  it('la cuenta a la vista: 10 × Caja (12) = 120 unidad, y el costo por unidad con el precio', () => {
    expect(cuentaPresentacion('10', '12', 'unidad', '9600')).toBe('= 120 unidad · $800 c/u')
    expect(cuentaPresentacion('3', '12', 'unidad', '10000')).toBe('= 36 unidad · $833,33 c/u')
    expect(cuentaPresentacion('10', '12', 'unidad', null)).toBe('= 120 unidad')
    expect(cuentaPresentacion('', '12', 'unidad', null)).toBeNull()
  })
})
```

⚠️ El formato exacto del monto (`$800`, `$833,33`) sale de `useFormatters().formatMonto` con la
moneda del store. Antes de fijarlo, leer cómo `useCompras.spec.ts` prueba hoy un monto (o si no lo
prueba) y afirmar con el mismo helper, no con un string adivinado. La cuenta de la pantalla **no es
el costo** (lo calcula el servidor), por eso la división se muestra y no se cuantiza a 4.

- [ ] **Step 2: Correr y ver que falla** — `cd frontend && npx vitest run app/composables/useCompras.spec.ts` → FAIL.

- [ ] **Step 3: Implementar en `useCompras.ts`**. `etiquetaPresentacion` usa
  `formatStockCantidad(contenido, true)` (el mismo de `cantidadConUnidad`). `unidadDeLinea` y
  `cuentaPresentacion` con `comoDecimal`. Ampliar `LineaCompra` con
  `unidadCodigo: string | null` y `presentacion: PresentacionLinea | null`.

- [ ] **Step 4: Correr** → PASS.

- [ ] **Step 5: Los tres consumidores de `unidadCodigo`**

`CompraConfirmada.vue:59` y `:94`, `CorregirLineaModal.vue:135` y `AnularCompraModal.vue:63`
pasan a `unidadDeLinea(linea)` en vez de `linea.unidadCodigo`. En la confirmada, además, la
cantidad base al lado: *"10 Caja (12) · 120 unidades"*
(`cantidadConUnidad(l.cantidad, unidadDeLinea(l))` + `· ${cantidad × contenido} ${unidadMedidaBase}`
cuando hay presentación, calculado en el composable). En cada `.nuxt.spec.ts` existente, un caso con
una línea en presentación que afirme el texto *"Caja (12)"*.

`grep -rn "unidadCodigo" frontend/app` al final del paso: solo quedan el composable, la página de
carga y los tipos.

- [ ] **Step 6: `PresentacionModal.vue` — spec primero**

Props: `proveedorId`, `item: { id, nombre, unidadMedida }`, `presentacion: PresentacionCompra | null`
(null = crear). Emits: `guardada: [PresentacionCompra]`, `retirada: [string]`. `v-model:open`.
Molde: `DescuentoModal.vue`. Campos: *Nombre* (`UInput`, placeholder "Caja"), *Trae*
(`UInput inputmode="decimal"`) y *Unidad* (`USelect` con las compatibles del store de unidades
según `magnitudDe(item.unidadMedida)`; fija si la base es `unidad`). Botones: *Cancelar*,
*Retirar* (solo al editar; pide confirmar en el mismo modal, con un segundo botón *Sí, retirar*) y
*Guardar*.

Spec (`PresentacionModal.nuxt.spec.ts`, con el molde de `DescuentoModal.nuxt.spec.ts`):
- crear manda `POST /compras/presentaciones` con `{ proveedorId, itemId, nombre: 'Caja', contenido: '12', unidadCodigo: 'unidad' }`: strings, sin `tenantId`;
- editar manda `PATCH` **solo con lo que cambió** (`{ contenido: '12' }`), nunca `null`: omitir no es mandar null;
- retirar manda `DELETE` recién después de *Sí, retirar*, y emite `retirada`;
- contenido vacío o `0` deja *Guardar* deshabilitado.

- [ ] **Step 7: Implementar el modal** → spec en verde.

- [ ] **Step 8: La página de carga — spec primero** (en `compras-carga.nuxt.spec.ts`)

Ampliar el mock de `useApiFetch` con `GET /compras/presentaciones?proveedorId=prov-1` →
`[{ id: 'pres-caja', itemId: LATAS.id, nombre: 'Caja', contenido: '12.0000', unidadCodigo: 'unidad' }]`,
con `LATAS = { id: 'item-latas', nombre: 'Coca-Cola lata', modoInventario: 'cantidad', unidadMedida: 'unidad' }`
en los productos. Casos:
- con proveedor y producto elegidos, el selector de unidad ofrece `unidad` y `Caja (12)`;
- elegida la caja, con cantidad 10 y precio 9600, la línea muestra `= 120 unidad · $800 c/u`;
- guardar manda la línea con `presentacionId: 'pres-caja'` y **sin la clave** `unidadCodigo` (y al revés con `kg`);
- cambiar de proveedor deja la línea en `unidad` y muestra el aviso *"1 línea volvió a la unidad base"*;
- un producto por serie no ofrece *"+ Nueva presentación…"*;
- un borrador que llega con `unidadCodigo: null, presentacion: null` muestra la unidad vacía y *Guardar* deshabilitado.

Afirmar el body contra el DTO a mano (memoria: el mock de `useApiFetch` contesta 200 a cualquier
cosa): **una sola** de las dos claves por línea, ninguna en `null`.

- [ ] **Step 9: Implementar en `[id].vue`**

- `LineaForm` gana `presentacionId: string` (`''` = ninguna). El `USelect` de unidad pasa a
  `:model-value="valorUnidad(linea)"` con valores `u:<codigo>` / `p:<id>` / `nueva`, y
  `@update:model-value` que despacha: `u:` → `unidadCodigo`, `p:` → `presentacionId`, `nueva` →
  abre el modal sin cambiar la selección. La traducción `u:`/`p:` vive en el composable si se usa
  en más de un lugar. Si solo la usa la página, en la página: es presentación, no negocio.
- `presentaciones = ref<PresentacionCompra[]>([])`, cargadas por `watch(() => form.value.proveedorId)`
  (una llamada por proveedor, nunca por línea). Al cambiar de proveedor, las líneas con
  `presentacionId` vuelven a `unidadCodigo = unidadMedida`, con un toast que dice cuántas.
- El lápiz (`UButton icon="i-lucide-pencil" variant="ghost" size="sm"`) aparece cuando
  `linea.presentacionId` y abre el modal con esa presentación. `@guardada` reemplaza en
  `presentaciones` y elige la nueva en la línea. `@retirada` la saca y pasa a la unidad base
  **toda línea** que la usaba.
- Debajo de la línea, `cuentaPresentacion(...)` si hay presentación (`data-qa="compra-cuenta-presentacion"`).
- `armarBody`: una sola clave por línea (`presentacionId` **o** `unidadCodigo`), nunca las dos ni `null`.
- `lineaDesdeDetalle`: `presentacionId: l.presentacion?.id ?? ''`, `unidadCodigo: l.unidadCodigo ?? ''`.
- `puedeGuardar` exige que cada línea cargada tenga unidad o presentación.
- El resumen de confirmar muestra la cantidad en unidad base para las líneas en presentación.
- Solo tokens semánticos de Nuxt UI (`design:check`).

- [ ] **Step 10: Specs de front en verde** — `cd frontend && npm test` → PASS.

- [ ] **Step 11: Navegador como `encargado.compras`**

```bash
./scripts/entorno.sh stack && ./scripts/reset-db.sh
```

`frontend/e2e/compras/compras-presentacion.spec.ts`, con el molde de
`compras-por-pantalla.spec.ts` (sin la sesión de admin; datos por API como admin con
`crearProducto`, proveedor propio que se borra en `afterEach`):

```ts
test('crear "Caja (12)" desde la línea, confirmar 10 cajas y corregir en cajas', async ({ page, request }) => {
  // 1. Como encargado: nueva compra, proveedor propio, producto "lata" en unidad.
  // 2. Unidad → "+ Nueva presentación…" → Caja / 12 → Guardar. El selector queda en "Caja (12)".
  // 3. Cantidad 10, precio 9600: la línea dice "= 120 unidad".
  // 4. Confirmar: el resumen dice 120. Confirmar.
  // 5. La confirmada dice "10 Caja (12) · 120 unidades".
  // 6. Corregir la línea: el campo dice "Cantidad (Caja (12))"; bajar a 8. El historial: "10 → 8 Caja (12)".
  // 7. Por API como admin: stock del producto en la ubicación = 96, costo 800.
});

test('el lápiz corrige 24 → 12 antes de confirmar y el borrador toma el 12', async ({ page, request }) => {
  // Presentación creada por API con 24; en la pantalla, lápiz → 12 → Guardar; la cuenta pasa a
  // "= 120 unidad"; confirmar; por API, 120 en stock.
});
```

Los pasos van como aserciones reales sobre `getByRole`/`data-qa`, siguiendo los helpers de
`compras-por-pantalla.spec.ts` (`lineaDe`, login por pantalla). Las cuentas las prueba la API:
acá se afirma lo que solo se rompe en el navegador (el body, lo que dice antes y después de mover
stock, el rol).

```bash
cd frontend && npm run e2e -- e2e/compras/
```

Expected: PASS en los dos archivos de `e2e/compras/`.

- [ ] **Step 12: Docs de cierre**

- `docs/features/compras.md`: *Status* → pieza 2 de 4 completa; sección de pantalla (selector,
  modal, lápiz, la cuenta); fila nueva en *El smoke, automatizado* con el spec de navegador; *Last
  Updated* 2026-09-27.
- `docs/ESTADO.md`: pieza 2 ✅ con fecha.
- `docs/agent/pendientes.md`: en la entrada *"Compras: carga manual, y el DTE…"*, la pieza 2 sale
  (quedan 3 y 4 y la lectura del XML), con un puntero a `resueltos.md`. En `resueltos.md`, la
  entrada de la pieza 2 con los hashes de las tres tareas y lo que el revisor cazó.
- `CLAUDE.md` no cambia (no nombra la pieza 2).
- Spec y plan: `Status: Done`. Se borran después del merge, según `docs/superpowers/README.md`.
  Eso lo decide la orquestadora.

- [ ] **Step 13: Gate completo, revisión y commit**

El gate entero (backend y frontend), `verify-feature` con `domain-reviewer` (la página y
componentes tocan `pages`/`components`: el pre-commit exige el recibo), `model: 'sonnet'`. Duda
concreta: *"¿Puede el body de una línea salir con `unidadCodigo` y `presentacionId` a la vez, o con
alguna de las dos en null, por algún camino de la pantalla: cargar un borrador, cambiar de
proveedor, retirar la presentación elegida en dos líneas?"*

```bash
git add frontend/app/composables/useCompras.ts frontend/app/composables/useCompras.spec.ts \
  frontend/app/components/compras/PresentacionModal.vue frontend/app/components/compras/PresentacionModal.nuxt.spec.ts \
  "frontend/app/pages/compras/[id].vue" frontend/app/pages/compras/compras-carga.nuxt.spec.ts \
  frontend/app/components/compras/CompraConfirmada.vue frontend/app/components/compras/CorregirLineaModal.vue \
  frontend/app/components/compras/AnularCompraModal.vue frontend/app/components/compras/*.nuxt.spec.ts \
  frontend/e2e/compras/compras-presentacion.spec.ts \
  docs/features/compras.md docs/ESTADO.md docs/agent/pendientes.md docs/agent/resueltos.md \
  docs/superpowers/specs/2026-09-27-compras-unidad-de-compra-design.md docs/superpowers/plans/2026-09-27-compras-unidad-de-compra.md
git diff --cached --stat
git commit -m "feat(compras): la presentación en la pantalla de carga (pieza 2, tarea 3)"
```

Avisar a la orquestadora con el cierre de la pieza.

---

## Verification

Por tarea, **ejecutar, no afirmar** (CLAUDE.md § checklist), con el exit code de cada comando:

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh && (cd backend && npm run test:e2e) ; ./scripts/reset-db.sh --verificar
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

Y en la Task 3, además, `npm run e2e -- e2e/compras/` con el stack propio.
Un e2e que falla raro: primero `reset-db.sh --verificar` (el watcher re-siembra si se tocó un
`.ts` en medio de la suite).

## Decisions / Open questions

**Decididas** (spec § 2; owner, 2026-09-27, por selector y aprobando cada sección del diseño):
se crea desde la línea · varias por (proveedor, producto) · el código del proveedor llega con el
XML · se corrige y retira desde la línea · lote sí, serie no · la confirmada congela nombre y
contenido · permiso Compras · Crear.

**Decididas al escribir este plan** (técnicas, corrigen la spec en el mismo commit):
- El índice único sobre `lower(nombre)` lo crea el **seeder**, no la entidad
  (`docs/patterns/backend.md`, "Entity o seeder"). La spec decía "en la entidad".
- Nombre repetido → **409**, no 400: es el código del folio repetido y de los nombres de
  cajones.
- Un borrador cuya presentación fue retirada se devuelve con `unidadCodigo: null` y
  `presentacion: null`. El mensaje del 400 no distingue *retirada* de *inexistente*, y así no
  hace falta leer una fila borrada.
- `PresentacionesCompraService` en archivo propio dentro del módulo `compras`.

**Abiertas para verificar al ejecutar (no para el owner):**
- El formato exacto que el historial guarda para una cantidad (`'10'` o `'10.0000'`) (Task 2,
  Step 13).
- El formato del monto en la cuenta a la vista (Task 3, Step 1).
