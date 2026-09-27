# Plan: Compras — pre-llenar la compra con el XML de la factura electrónica (DTE)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft · **Date:** 2026-09-27 · **Owner:** César (aprueba antes de codear)

**Goal:** el encargado sube el XML del DTE en *Nueva compra* y el borrador de siempre queda
pre-llenado; el código del proveedor se aprende al guardar y la próxima factura calza sola.

**Architecture:** el navegador lee el XML (`DOMParser`, sin dependencia nueva) y manda solo lo
necesario a `POST /compras/dte/lectura`, que resuelve proveedor, tipo, folio repetido,
receptor y las claves ya aprendidas. Guardar el borrador (`POST`/`PATCH /compras`, sin
cambios de forma más allá de campos opcionales) aprende en `codigos_proveedor` dentro de la
misma transacción. Confirmar, kardex y CPP no se tocan.

**Tech Stack:** NestJS + SQL crudo vía `Db` (`this.db.query` dentro de `this.db.transaccion`),
TypeORM solo para el esquema, class-validator; Nuxt 4 + Nuxt UI v4, Decimal.js, Vitest
(happy-dom), Playwright.

**Spec:** [`docs/superpowers/specs/2026-09-27-compras-xml-dte-design.md`](../specs/2026-09-27-compras-xml-dte-design.md)
(aprobada por el owner el 2026-09-27). Leerla entera antes de cada tarea: el plan argumenta
desde ella.

## Global Constraints

- `tenant_id` sale del token, nunca del body (CLAUDE.md invariante 1).
- Plata y cantidades con **Decimal.js**, nunca `number`: precio a escala de costo (4
  decimales, `ROUND_HALF_UP`), descuento a los decimales de la moneda oficial.
- Soft delete: toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`; "reaprender" marca
  `eliminado_el`, nunca `DELETE` ni `UPDATE` del destino.
- Ninguna consulta por línea (N+1): claves con `= ANY($n)`, escrituras en lote con `unnest`.
- Permiso de todo lo nuevo: **Compras · Crear**.
- **El front manda exactamente lo que el DTO declara** (se prende `forbidNonWhitelisted`):
  nunca esparcir el documento leído en un body.
- Los e2e nuevos usan `validacionGlobal()` de `src/common/pipes/validacion-global.pipe`.
- ⛔ No tocar: `confirmar`, `costearCompra`, `recostear`, `registrarMovimiento`, el motor de
  precios, nada fiscal. Si una tarea parece pedirlo, **parar y preguntar**.
- Todo subagente con `model: 'sonnet'` explícito.
- No mergear ni pushear. Stagear por ruta explícita. Nunca `--no-verify`.

---

## Context

Viene de la pieza 2 (presentaciones por proveedor, en producción desde el 2026-09-27). El
formulario que se pre-llena es `frontend/app/pages/compras/[id].vue`; el guardado es
`ComprasService.crearBorrador` / `actualizarBorrador`
(`backend/src/modules/compras/compras.service.ts`). No existe ningún upload de archivos en la
app, y no se agrega uno: el archivo nunca sale del navegador.

**Hechos medidos al planificar (2026-09-27), para no redescubrirlos:**

- happy-dom (el entorno de `npm test`) parsea el XML del SII con su `xmlns` por
  `getElementsByTagName`, pero `getElementsByTagNameNS('*', …)` devuelve 0, y un `<!DOCTYPE>`
  con entidades internas da `parsererror`. El lector busca **por nombre de tag** y rechaza
  `<!DOCTYPE`/`<!ENTITY` antes de parsear.
- `onSeleccionarItem` (`[id].vue`) pone la unidad base por defecto al elegir producto. Para una
  línea del XML eso leería **"3 CJ" como 3 unidades**: en las líneas del XML la unidad queda
  vacía hasta que el encargado la elige (salvo serie/lote, que solo admiten la base).
- `lineasCargadas` (`[id].vue`) **descarta en silencio** las líneas sin producto. Una línea del
  XML por asociar no puede llegar ahí: `puedeGuardar` exige que estén todas completas.
- `persistirBorrador` hace `router.replace('/compras/:id')` tras el primer POST: el guard de
  "salir sin guardar" se apaga **antes** de ese replace.
- El seed le da a Distribuidora Andina (`tercero` 440…, `seeder.service.ts` ~línea 3523) el
  RUT `76.123.456-7`, **el mismo** que la razón social del tenant París (`Demo Restaurante
  S.A.`): hay que darle uno propio (`76.543.210-3`, dígito verificador calculado).
- Rutas y guards útiles para los tests: `POST /api/terceros` (permiso `Terceros:Crear`, admin
  lo tiene), `POST /api/tenants/razones-sociales` (`TenantAdminGuard`).

## Scope / Out of scope

**Dentro:** spec § 3–§ 8. **Fuera:** spec § 10 (completar precios de una confirmada con el
XML, pantalla de códigos por proveedor, traer el XML desde el SII, aceptar/reclamar, verificar
la firma, notas 56/61, todo lo fiscal).

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `backend/src/modules/compras/entities/codigo-proveedor.entity.ts` (nuevo) | Esquema de `codigos_proveedor` (CHECK + único parcial) | 1 |
| `backend/src/modules/compras/lectura-dte.service.ts` (nuevo) | `leer` (la lectura), `aprender`, `completarRutProveedor`, y las funciones puras `normalizarRut`, `normalizarClave`, `planAprendizaje` | 1 y 2 |
| `backend/src/modules/compras/lectura-dte.service.spec.ts` (nuevo) | Unitarios de las funciones puras | 1 y 2 |
| `backend/src/modules/compras/dto/lectura-dte.dto.ts` (nuevo) | Body de la lectura | 1 |
| `backend/src/modules/compras/dto/compra-borrador.dto.ts` | `claveProveedor`, `descripcionProveedor`, `apartadas`, `rutProveedor` | 2 |
| `backend/src/modules/compras/compras.controller.ts` | `POST /compras/dte/lectura` | 1 |
| `backend/src/modules/compras/compras.service.ts` | Llamar a `aprender` / `completarRutProveedor` al guardar | 2 |
| `backend/src/modules/compras/compras.module.ts`, `backend/src/app.module.ts` | Registrar entidad y servicio | 1 |
| `backend/src/modules/seeder/seeder.service.ts` | RUT propio de Andina | 1 |
| `backend/test/compras-dte.e2e-spec.ts` (nuevo) | e2e de la lectura y del aprendizaje | 1 y 2 |
| `startup-pos.sql` | Documentar la tabla | 1 |
| `frontend/app/composables/useDte.ts` (nuevo) | Lector puro + armado de bodies + reparto de líneas | 3 |
| `frontend/app/composables/useDte.spec.ts` (nuevo) | Unitarios del lector | 3 |
| `frontend/app/composables/__fixtures__/dte/*.xml` (nuevos) | XML de prueba | 3 |
| `frontend/app/components/compras/CargarDteModal.vue` (+ `.nuxt.spec.ts`) | Elegir archivo, documento y proveedor; bloqueos | 4 |
| `frontend/app/pages/compras/[id].vue` (+ `compras-carga.nuxt.spec.ts`) | Cablear el pre-llenado, líneas por asociar/apartadas, guard de salida | 4 |
| `frontend/e2e/compras/compras-dte.spec.ts` + `frontend/e2e/compras/fixtures/*.xml` (nuevos) | Navegador como `encargado.compras` | 4 |

## Cierre de cada tarea (se repite en las cuatro — no se saltea ninguna parte)

1. Entorno propio del worktree: `./scripts/entorno.sh db` (tareas 1–3) o
   `./scripts/entorno.sh stack` (tarea 4). Si el worktree no tiene `node_modules`,
   `npm ci` en `backend/` y `frontend/`.
2. Gate completo, con **exit code** (no `| tail`):
   ```bash
   cd backend && npm run lint:check && npm run typecheck && npm test
   ./scripts/reset-db.sh && (cd backend && npm run test:e2e); echo "e2e exit $?"
   ./scripts/reset-db.sh --verificar
   cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
   ```
   No tocar un `.ts` del backend con el e2e corriendo.
3. Skill `verify-feature` con revisión independiente: `domain-reviewer` siempre, y
   `api-security-reviewer` en las tareas 1 y 2 (controller, DTO, entidad). `model: 'sonnet'`.
   Delegarle al revisor **la duda concreta** que quedó sin resolver en la tarea (cada tarea la
   nombra abajo). El revisor lee lo staged: `git add` antes de pedirlo.
4. Commit con los docs de la tarea, stageando por ruta. Rebase sobre `main` con el árbol
   limpio (sin stash).
5. Aviso a la sesión orquestadora ("Listado de sesiones activas"): rama, hash copiado de
   `git log`, gate con conteos y veredictos.

---

### Task 1: Backend — `codigos_proveedor` y `POST /compras/dte/lectura`

**Files:**
- Create: `backend/src/modules/compras/entities/codigo-proveedor.entity.ts`
- Create: `backend/src/modules/compras/lectura-dte.service.ts`
- Create: `backend/src/modules/compras/lectura-dte.service.spec.ts`
- Create: `backend/src/modules/compras/dto/lectura-dte.dto.ts`
- Create: `backend/test/compras-dte.e2e-spec.ts`
- Modify: `backend/src/modules/compras/compras.controller.ts` (ruta nueva, antes de `@Get(':id')`)
- Modify: `backend/src/modules/compras/compras.module.ts`, `backend/src/app.module.ts` (entidad en `forFeature` **y** en el array `entities`)
- Modify: `backend/src/modules/seeder/seeder.service.ts` (RUT de Andina)
- Modify: `startup-pos.sql`, `docs/features/compras.md`

**Interfaces:**
- Produces:
  - `normalizarRut(rut: string): string` — sin puntos ni espacios, `K` mayúscula, guion antes del DV: `'76.543.210-3'` → `'76543210-3'`, `'765432103'` → `'76543210-3'`.
  - `normalizarClave(clave: string): string` — `trim`, mayúsculas, espacios internos colapsados.
  - `LecturaDteService.leer(tenantId: string, dto: LecturaDteDto): Promise<LecturaDteRespuesta>`
  - `interface LecturaDteRespuesta { receptorEsDelTenant: boolean; proveedor: { id: string; nombre: string } | null; candidatos: { id: string; nombre: string }[]; tipoDocumento: { id: string; nombre: string } | null; compraExistente: { id: string; estado: 'borrador' | 'confirmada'; confirmadoEl: string | null } | null; asociaciones: AsociacionDte[] }`
  - `type DestinoCodigo = { itemId: string; presentacionId: string } | { itemId: string; unidadCodigo: string } | 'no_mercaderia'`
  - `interface AsociacionDte { clave: string; destino: DestinoCodigo | null; nota?: string }`
  - `LecturaDteService.assertRutDelProveedor(tenantId, proveedorId, rutEmisor): Promise<void>` (400 si tiene otro RUT; lo reusa la tarea 2)

**Duda para el revisor:** ¿la comparación de RUT normalizada en SQL
(`upper(replace(replace(coalesce(rut,''),'.',''),' ',''))`) puede calzar un RUT distinto por un
formato raro (sin guion vs con guion)? Pedirle que barra los formatos del seed y de
`terceros.vue`.

- [ ] **Step 1: Unitarios de las funciones puras (fallan)**

```ts
// backend/src/modules/compras/lectura-dte.service.spec.ts
import { normalizarClave, normalizarRut } from './lectura-dte.service';

describe('normalizarRut', () => {
  it.each([
    ['76.543.210-3', '76543210-3'],
    ['76543210-3', '76543210-3'],
    ['765432103', '76543210-3'],
    [' 9.876.543-k ', '9876543-K'],
  ])('%s → %s', (entrada, salida) => {
    expect(normalizarRut(entrada)).toBe(salida);
  });
});

describe('normalizarClave', () => {
  it('mayúsculas, sin bordes, espacios colapsados', () => {
    expect(normalizarClave('  codigo:int1:cc350-12 ')).toBe('CODIGO:INT1:CC350-12');
    expect(normalizarClave('NOMBRE:Fanta   350ml  CJ12')).toBe('NOMBRE:FANTA 350ML CJ12');
  });
});
```

Run: `cd backend && npx jest src/modules/compras/lectura-dte.service.spec.ts` → FAIL (módulo no existe).

- [ ] **Step 2: La entidad**

```ts
// backend/src/modules/compras/entities/codigo-proveedor.entity.ts
import {
  Check, Column, CreateDateColumn, DeleteDateColumn, Entity, Index,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

/**
 * Lo que el sistema aprendió de la factura de un proveedor: "su código
 * CC350-12 es la Coca-Cola en Caja (12)", o "su FLETE no es mercadería"
 * (spec compras-xml-dte § 5.1). Tabla propia y no una columna de la
 * presentación: un código también apunta a un producto en su unidad base y a
 * "no es mercadería", que no tienen presentación.
 *
 * Reaprender NO pisa: marca la fila vieja con `eliminado_el` e inserta otra
 * (el owner pide reversibilidad). Por eso el único es parcial.
 */
@Entity('codigos_proveedor')
@Index('uq_codigos_proveedor_clave', ['tenantId', 'proveedorId', 'clave'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
@Check(
  'chk_codigos_proveedor_destino',
  `("no_mercaderia" AND "item_id" IS NULL AND "presentacion_compra_id" IS NULL AND "unidad_codigo" IS NULL)
   OR (NOT "no_mercaderia" AND "item_id" IS NOT NULL
       AND ("presentacion_compra_id" IS NULL) <> ("unidad_codigo" IS NULL))`,
)
export class CodigoProveedor {
  @PrimaryGeneratedColumn('uuid', { name: 'codigo_proveedor_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'proveedor_id', type: 'uuid' })
  proveedorId: string;

  @Column({ type: 'varchar', length: 160 })
  clave: string;

  @Column({ type: 'varchar', length: 80 })
  descripcion: string;

  @Column({ name: 'no_mercaderia', type: 'boolean', default: false })
  noMercaderia: boolean;

  @Column({ name: 'item_id', type: 'uuid', nullable: true })
  itemId: string | null;

  @Column({ name: 'presentacion_compra_id', type: 'uuid', nullable: true })
  presentacionCompraId: string | null;

  @Column({ name: 'unidad_codigo', type: 'text', nullable: true })
  unidadCodigo: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
```

Registrarla en `compras.module.ts` (`TypeOrmModule.forFeature([...])`) **y** en el array
`entities` de `app.module.ts` junto a `PresentacionCompra` (memoria: sin `autoLoadEntities`,
solo `forFeature` no crea la tabla y solo lo caza el e2e).

- [ ] **Step 3: El DTO de la lectura**

```ts
// backend/src/modules/compras/dto/lectura-dte.dto.ts
import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/** RUT chileno con o sin puntos, con o sin guion; el DV puede ser K. */
export const PATRON_RUT = /^[0-9.\s]{1,12}-?[0-9kK]\s*$/;

/**
 * Body de `POST /compras/dte/lectura` (spec compras-xml-dte § 7). Lo arma el
 * navegador con lo que leyó del XML; **solo** estos campos (forbidNonWhitelisted).
 * ⚠️ `tenantId` no está y no puede estar: sale del token.
 */
export class LecturaDteDto {
  @IsString() @Matches(PATRON_RUT) emisorRut: string;
  @IsString() @Matches(PATRON_RUT) receptorRut: string;
  /** Código SII del tipo (33, 34, 52…). */
  @IsString() @Matches(/^\d{1,3}$/) tipoDte: string;
  @IsString() @MaxLength(40) @Matches(/\S/) folio: string;
  /** Cuando el encargado eligió el proveedor a mano (el RUT no calzó). */
  @IsOptional() @IsUUID() proveedorId?: string;
  @IsArray() @ArrayMaxSize(60)
  @IsString({ each: true }) @MaxLength(160, { each: true })
  claves: string[];
}
```

- [ ] **Step 4: El servicio (`leer`)**

`LecturaDteService` (`@Injectable`, constructor `(private readonly db: Db)`), con
`normalizarRut` y `normalizarClave` exportadas. `leer` hace **consultas fijas, ninguna por
clave**:

1. **Receptor** — `SELECT 1 FROM razones_sociales WHERE tenant_id = $1 AND eliminado_el IS NULL AND <rut normalizado> = $2 LIMIT 1`.
2. **Proveedor** — si viene `proveedorId`: `assertRutDelProveedor` (abajo) y leer ese
   proveedor (`tipo = 'proveedor' AND activo AND eliminado_el IS NULL`; si no existe → 400
   "Proveedor no encontrado", mismo mensaje para ajeno e inexistente). Si no viene:
   ```sql
   SELECT tercero_id, nombre FROM terceros
    WHERE tenant_id = $1 AND tipo = 'proveedor' AND activo AND eliminado_el IS NULL
      AND $2 IN (upper(replace(replace(coalesce(rut, ''), '.', ''), ' ', '')),
                 upper(replace(replace(coalesce(rut_fiscal, ''), '.', ''), ' ', '')))
    ORDER BY nombre
   ```
   con `$2 = normalizarRut(dto.emisorRut)`. ⚠️ La columna puede estar guardada sin guion
   (`765432103`): comparar también contra el RUT normalizado **sin** guion
   (`replace($2, '-', '')`) para que `76.543.210-3` y `765432103` calcen. Una fila →
   `proveedor`; varias → `proveedor: null` y `candidatos`; ninguna → los dos vacíos.
3. **Tipo** — si `tipoDte` es `'56'` o `'61'`, `tipoDocumento: null` **sin consultar** (spec §
   3.1: las notas no se cargan acá aunque alguien agregue la fila). Si no, la misma consulta
   de país que `ComprasService.tiposDocumento` más `AND td.codigo = $2`.
4. **Compra existente** — solo con proveedor y tipo resueltos: la condición de
   `assertFolioLibre` (`estado <> 'anulada' AND eliminado_el IS NULL`), devolviendo
   `compra_id, estado, confirmado_el`.
5. **Asociaciones** — solo con proveedor resuelto; claves normalizadas y sin repetir:
   ```sql
   SELECT cp.clave, cp.no_mercaderia, cp.item_id, cp.presentacion_compra_id, cp.unidad_codigo,
          (i.item_id IS NOT NULL) AS item_vivo,
          (cp.presentacion_compra_id IS NULL OR pc.presentacion_compra_id IS NOT NULL) AS presentacion_viva
     FROM codigos_proveedor cp
     LEFT JOIN items i ON i.item_id = cp.item_id AND i.tenant_id = cp.tenant_id
          AND i.tipo = ANY($4::text[]) AND i.eliminado_el IS NULL
     LEFT JOIN presentaciones_compra pc ON pc.presentacion_compra_id = cp.presentacion_compra_id
          AND pc.tenant_id = cp.tenant_id AND pc.eliminado_el IS NULL
    WHERE cp.tenant_id = $1 AND cp.proveedor_id = $2 AND cp.clave = ANY($3::text[])
      AND cp.eliminado_el IS NULL
   ```
   (`$4 = TIPOS_CON_STOCK` de `presentaciones-compra.service.ts`). `no_mercaderia` →
   `'no_mercaderia'`; producto no vivo → `destino: null, nota: 'el producto al que apuntaba ya
   no está'`; presentación no viva → `destino: null, nota: 'la presentación a la que apuntaba
   fue retirada'`. **La nota no nombra la presentación** (spec § 5.3: nombrarla sería leer una
   fila borrada). Toda clave pedida sin fila sale con `destino: null`.

`assertRutDelProveedor(tenantId, proveedorId, rutEmisor)`: lee `rut, rut_fiscal` del proveedor;
si alguno no vacío y **ninguno** normaliza igual al del emisor → `BadRequestException(
`"${nombre}" tiene el RUT ${rutGuardado}; esta factura es del RUT ${rutEmisor}`)`. Vacíos los
dos → pasa (la tarea 2 lo completa al guardar).

- [ ] **Step 5: La ruta**

En `ComprasController`, **antes** de `@Get(':id')` (junto a las de `presentaciones`), e
inyectar `LecturaDteService` (proveedor en `compras.module.ts`):

```ts
  /**
   * Lo que el sistema sabe de una factura leída en el navegador (spec
   * compras-xml-dte § 7). POST por el tamaño del body; no escribe nada.
   * `Crear`: es el primer paso de cargar una compra.
   */
  @Post('dte/lectura')
  @HttpCode(200)
  @RequiresPermiso('Compras', 'Crear')
  leerDte(@Req() req: Request, @Body() dto: LecturaDteDto) {
    const { tenantId } = req.user as { tenantId: string };
    return this.lecturaDteService.leer(tenantId, dto);
  }
```

- [ ] **Step 6: RUT propio de Andina en el seed**

En `seeder.service.ts` (~3525), `rut` y `rutFiscal` de Distribuidora Andina pasan a
`'76.543.210-3'`. Antes: `grep -rn "76.123.456-7\|76123456" backend frontend --include='*.ts' --include='*.vue'`
y confirmar que ningún test depende de que **Andina** tenga ese RUT (los usos conocidos son la
razón social del tenant, que no cambia).

- [ ] **Step 7: e2e de la lectura (fallan antes del servicio, pasan después)**

`backend/test/compras-dte.e2e-spec.ts`, con el mismo arranque que `compras-presentaciones.e2e-spec.ts`
(`validacionGlobal()`, `cookieParser`, `login(email)` con `switch-tenant` a París). Datos
**propios**: un RUT aleatorio con DV válido por test.

```ts
/** RUT válido aleatorio: 8 dígitos + DV módulo 11. */
function rutAleatorio(): string {
  const cuerpo = String(10_000_000 + Math.floor(Math.random() * 89_999_999));
  let suma = 0;
  let mult = 2;
  for (const d of [...cuerpo].reverse()) {
    suma += Number(d) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const r = 11 - (suma % 11);
  const dv = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  return `${cuerpo.slice(0, -6)}.${cuerpo.slice(-6, -3)}.${cuerpo.slice(-3)}-${dv}`;
}
const RUT_PARIS = '76.123.456-7'; // razón social "Demo Restaurante S.A." del tenant París
```

Tests (cada uno con su `it`):
- proveedor creado con `rut` = `rutAleatorio()` → la lectura con el RUT **sin puntos** lo
  resuelve; otro creado solo con `rutFiscal` → también.
- dos proveedores con el mismo RUT → `proveedor: null`, `candidatos` con los dos.
- RUT desconocido → `proveedor: null`, `candidatos: []`, `asociaciones: []`.
- receptor `rutAleatorio()` → `receptorEsDelTenant: false`; receptor de una **segunda razón
  social** de París creada con `POST /api/tenants/razones-sociales` → `true`.
- `tipoDte: '61'` → `tipoDocumento: null`; `'33'` → la factura del seed.
- folio en un borrador (creado por `POST /api/compras`) → `compraExistente.estado ===
  'borrador'`; confirmado → `'confirmada'` con `confirmadoEl`; anulado → `null`.
- asociaciones: insertar una fila de `codigos_proveedor` **no se puede por API todavía** (la
  escritura es la tarea 2). En esta tarea: toda clave sale con `destino: null`. Los casos
  "calza", "presentación retirada → nota" y "producto borrado → nota" van en la tarea 2, por
  API, sin SQL directo (memoria: si el test necesita SQL para montar el escenario, sospechar).
- `proveedorId` de un proveedor con otro RUT → 400 con el mensaje; `proveedorId` de otro
  tenant (`loginSegundoTenant`) → 400 "Proveedor no encontrado".
- **Aislamiento:** con el token del segundo tenant, el RUT del proveedor de París →
  `proveedor: null`.
- **Permisos:** `compras.lectura@paris.cl` → 403; `encargado.compras@paris.cl` → 200.
- **DTO:** `tipoDte: 'abc'` → 400; 61 claves → 400; una clave de 161 caracteres → 400.
  (El campo de más no se testea acá: hoy `validacionGlobal()` es `whitelist` sin
  `forbidNonWhitelisted`, y el prendido es de la orquestadora con su invariante. Lo que este
  frente garantiza es que el front no mande campos de más: tarea 3, `bodyLectura`.)

- [ ] **Step 8: Correr, `startup-pos.sql` y docs**

`startup-pos.sql`: la tabla con sus columnas, el CHECK y el índice (documentación: el esquema
sale de la entidad). `docs/features/compras.md`: sección nueva "La lectura del XML (en
construcción)" con la ruta en la tabla de endpoints. `docs/ESTADO.md`: fila de la feature 🔲
en construcción.

- [ ] **Step 9: Cierre** (ver "Cierre de cada tarea"). Commit: `feat(compras): la lectura del XML del DTE (tarea 1)`.

---

### Task 2: Backend — aprender al guardar el borrador

**Files:**
- Modify: `backend/src/modules/compras/dto/compra-borrador.dto.ts`
- Modify: `backend/src/modules/compras/lectura-dte.service.ts` (`planAprendizaje`, `aprender`, `completarRutProveedor`)
- Modify: `backend/src/modules/compras/lectura-dte.service.spec.ts`
- Modify: `backend/src/modules/compras/compras.service.ts` (`crearBorrador`, `actualizarBorrador`; inyectar `LecturaDteService`)
- Modify: `backend/test/compras-dte.e2e-spec.ts`
- Modify: `docs/features/compras.md`

**Interfaces:**
- Consumes (tarea 1): `normalizarClave`, `normalizarRut`, `assertRutDelProveedor`, `DestinoCodigo`, la tabla.
- Produces (la usa la tarea 4, el front):
  - en `LineaCompraDto`: `claveProveedor?: string` (≤ 160), `descripcionProveedor?: string` (≤ 80, solo con clave)
  - en `CompraBorradorDto`: `apartadas?: { clave: string; descripcion: string }[]` (≤ 60), `rutProveedor?: string` (`PATRON_RUT`)
  - `planAprendizaje(entradas: EntradaAprendizaje[], vivas: CodigoVivo[]): { marcar: string[]; insertar: EntradaAprendizaje[] }`

**Duda para el revisor:** dos borradores que aprenden la misma clave a la vez — el `INSERT …
ON CONFLICT … DO NOTHING` deja ganar al primero y el segundo no escribe nada **sin error**.
¿Es aceptable (el segundo verá su asociación "perdida" recién en la próxima factura) o debe
reintentar? Pedirle que lo razone contra el orden de bloqueo de `docs/patterns/backend.md` §15.

- [ ] **Step 1: DTO**

```ts
// en LineaCompraDto
  /** La clave de la línea del XML (spec compras-xml-dte § 3.2). Solo las que vinieron del XML. */
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160)
  claveProveedor?: string;

  @ValidateIf((o: LineaCompraDto) => o.claveProveedor !== undefined)
  @IsString() @IsNotEmpty() @MaxLength(80)
  descripcionProveedor?: string;
```

```ts
export class ApartadaDteDto {
  @IsString() @IsNotEmpty() @MaxLength(160) clave: string;
  @IsString() @IsNotEmpty() @MaxLength(80) descripcion: string;
}

// en CompraBorradorDto
  /** Líneas del XML marcadas "no es mercadería": se aprenden, no se cargan. */
  @IsOptional() @IsArray() @ArrayMaxSize(60)
  @ValidateNested({ each: true }) @Type(() => ApartadaDteDto)
  apartadas?: ApartadaDteDto[];

  /** El RUT del emisor, cuando el proveedor se eligió a mano (decisión 3). */
  @IsOptional() @IsString() @Matches(PATRON_RUT)
  rutProveedor?: string;
```

Las dos viajan juntas, y lo resuelve el DTO sin código en el service: `claveProveedor` se
valida también cuando llega **solo** la descripción, así que una descripción sin clave es 400
(`claveProveedor` undefined no pasa `@IsString`):

```ts
  @ValidateIf((o: LineaCompraDto) => o.claveProveedor !== undefined || o.descripcionProveedor !== undefined)
  @IsString() @IsNotEmpty() @MaxLength(160)
  claveProveedor?: string;
```

(reemplaza el `@IsOptional()` del bloque de arriba).

- [ ] **Step 2: `planAprendizaje` puro (tests primero)**

```ts
export interface EntradaAprendizaje {
  clave: string;          // ya normalizada
  descripcion: string;
  destino: DestinoCodigo;
}
export interface CodigoVivo extends EntradaAprendizaje {
  id: string;
}
```

Reglas (unitarios en `lectura-dte.service.spec.ts`, uno por regla):
- clave sin viva → `insertar`.
- viva con el **mismo** destino → nada (ni marcar ni insertar; la descripción no se toca).
- viva con otro destino → `marcar: [id]` + `insertar`.
- la misma clave dos veces con el mismo destino (la línea bonificada a $0 repite el código) →
  una sola entrada.
- la misma clave con destinos distintos → `BadRequestException` que nombra la clave y dice que
  la factura la usa para dos cosas.
- mercadería y `no_mercaderia` para la misma clave → la misma excepción.

Destino "igual": `no_mercaderia` con `no_mercaderia`; o mismo `itemId` **y** misma
`presentacionId`/`unidadCodigo`.

- [ ] **Step 3: `aprender` y `completarRutProveedor`**

`aprender(tenantId, proveedorId, lineas: LineaCompraDto[], apartadas: ApartadaDteDto[])`:
entradas de las líneas con `claveProveedor` (destino = su `presentacionId` o su
`unidadCodigo`) y de `apartadas` (`'no_mercaderia'`), claves con `normalizarClave`. Luego, **en
la transacción ambiente** (`this.db.query`):

```sql
SELECT codigo_proveedor_id, clave, descripcion, no_mercaderia, item_id, presentacion_compra_id, unidad_codigo
  FROM codigos_proveedor
 WHERE tenant_id = $1 AND proveedor_id = $2 AND clave = ANY($3::text[]) AND eliminado_el IS NULL
 FOR UPDATE
```
```sql
UPDATE codigos_proveedor SET eliminado_el = NOW(), actualizado_el = NOW()
 WHERE tenant_id = $1 AND codigo_proveedor_id = ANY($2::uuid[]) AND eliminado_el IS NULL
```
```sql
INSERT INTO codigos_proveedor
  (tenant_id, proveedor_id, clave, descripcion, no_mercaderia, item_id, presentacion_compra_id, unidad_codigo)
SELECT $1, $2, x.clave, x.descripcion, x.no_mercaderia, x.item_id, x.presentacion_compra_id, x.unidad_codigo
  FROM unnest($3::text[], $4::text[], $5::boolean[], $6::uuid[], $7::uuid[], $8::text[])
       AS x(clave, descripcion, no_mercaderia, item_id, presentacion_compra_id, unidad_codigo)
ON CONFLICT (tenant_id, proveedor_id, clave) WHERE eliminado_el IS NULL DO NOTHING
```
Sin entradas → no consulta nada. Tres statements fijos por guardado, nunca uno por línea.

`completarRutProveedor(tenantId, proveedorId, rutEmisor)`: `SELECT nombre, rut, rut_fiscal …
FOR UPDATE`; si alguno normaliza igual → nada; los dos vacíos → `UPDATE terceros SET
rut_fiscal = $3, actualizado_el = NOW() WHERE tenant_id = $1 AND tercero_id = $2 AND
eliminado_el IS NULL` con el RUT **tal como vino en el XML**; si no → el mismo 400 que
`assertRutDelProveedor` (reusarlo).

- [ ] **Step 4: Cablearlo en el guardado**

En `crearBorrador` y `actualizarBorrador`, **después** de `validarLineas` (los destinos ya están
validados como del proveedor y del producto) y antes del `INSERT`/`UPDATE` de la compra:

```ts
      if (dto.rutProveedor) {
        await this.lecturaDteService.completarRutProveedor(tenantId, dto.proveedorId, dto.rutProveedor);
      }
      await this.lecturaDteService.aprender(tenantId, dto.proveedorId, dto.lineas, dto.apartadas ?? []);
```

`insertarLineas` **no** guarda la clave (la compra no recuerda que vino del XML, spec § 6).
Nada más de `ComprasService` cambia.

- [ ] **Step 5: e2e del aprendizaje (en `compras-dte.e2e-spec.ts`)**

Todo por API, con proveedor, producto (por cantidad, base `unidad`) y presentación "Caja
(12)" propios:
- guardar un borrador con una línea `claveProveedor: 'CODIGO:INT1:CC350-12'` en la Caja →
  la lectura con esa clave devuelve `{ itemId, presentacionId }`.
- reaprender: otro borrador con la misma clave en `unidadCodigo: 'unidad'` → la lectura
  devuelve la unidad; **y** hay dos filas para la clave, una con `eliminado_el` (verificar con
  `ds.query` de **lectura**, que sí es legítimo para afirmar que no se pisó).
- `apartadas: [{ clave: 'NOMBRE:FLETE', … }]` → la lectura devuelve `'no_mercaderia'`.
- misma clave en una línea y en `apartadas` → 400.
- retirar la presentación (`DELETE /compras/presentaciones/:id`) → la lectura da `destino:
  null` y la nota de retirada; borrar el producto por la API de ítems como admin → la nota del
  producto.
- una línea sin `claveProveedor` no crea filas (contar antes/después con `ds.query` de lectura).
- `rutProveedor` con el proveedor sin RUT → queda en `rut_fiscal` y la lectura siguiente lo
  resuelve **sin** `proveedorId`; con otro RUT guardado → 400 y la compra **no** se creó.
- `descripcionProveedor` sin clave → 400; `apartadas` con 61 → 400.
- aislamiento: la clave aprendida en París no calza para el mismo RUT en el segundo tenant.

- [ ] **Step 6: Mutantes que revierten** (anotar cada uno en el commit con su test que lo mata)
  1. `aprender` hace `UPDATE … SET item_id = …` sobre la viva en vez de marcar e insertar →
     cae "reaprender deja dos filas".
  2. La consulta de asociaciones sin `AND cp.eliminado_el IS NULL` → cae "reaprender devuelve
     la unidad" (devolvería dos destinos).
  3. La búsqueda de proveedor solo por `rut` → cae "resuelve por `rutFiscal`".
  4. `completarRutProveedor` que pisa un RUT existente → cae "otro RUT → 400".

  Revertir cada mutante y **mirar la hora del restart del watcher** si el stack está arriba
  (memoria: el watcher se come el revert).

- [ ] **Step 7: Docs** — `docs/features/compras.md`: qué se aprende y cuándo, los campos nuevos
  del body.

- [ ] **Step 8: Cierre.** Commit: `feat(compras): el borrador aprende los códigos del proveedor (tarea 2)`.

---

### Task 3: Frontend — el lector del XML (`useDte.ts`)

**Files:**
- Create: `frontend/app/composables/useDte.ts`
- Create: `frontend/app/composables/useDte.spec.ts`
- Create: `frontend/app/composables/__fixtures__/dte/` — `andina-33.xml`, `envio-3-docs.xml`,
  `dte-suelto.xml`, `precios-brutos.xml`, `con-doctype.xml`, `no-es-dte.xml`,
  `descuentos-globales.xml`, `cantidad-6-decimales.xml` (todos en ISO-8859-1, con `CAFÉ` en
  algún `NmbItem`)

**Interfaces:**
- Consumes (tarea 1–2, por contrato HTTP): `LecturaDteDto`, `LecturaDteRespuesta`, los campos nuevos del borrador.
- Produces (la usa la tarea 4):

```ts
export const TAMANO_MAXIMO_DTE = 2 * 1024 * 1024
export interface LineaDte {
  clave: string                    // 'CODIGO:<TpoCodigo>:<VlrCodigo>' o 'NOMBRE:<NmbItem>', normalizada
  descripcion: string              // NmbItem, ≤ 80
  cantidad: string | null          // QtyItem; null si falta o tiene > 4 decimales
  unidadFactura: string | null     // UnmdItem ("CJ")
  precioListado: string | null     // PrcItem, para mostrar
  precioUnitario: string | null    // MontoItem ÷ QtyItem a 4 decimales; null si precios brutos o sin cantidad
  conDescuentoDeLinea: boolean
  montoItem: string | null
  indExe: string | null
}
export interface DescuentoGlobalDte { tipoMov: 'D' | 'R', tipoValor: '$' | '%', valor: string, indExeDR: string | null }
export interface DocumentoDte {
  tipoDte: string, folio: string, fechaEmision: string,
  emisorRut: string, emisorRazonSocial: string, receptorRut: string,
  montoTotal: string | null, preciosConIva: boolean,
  lineas: LineaDte[], descuentosGlobales: DescuentoGlobalDte[]
}
export type ResultadoLecturaDte = { ok: true, documentos: DocumentoDte[] } | { ok: false, error: string }
export type DestinoCodigo = { itemId: string, presentacionId: string } | { itemId: string, unidadCodigo: string } | 'no_mercaderia'
export interface AsociacionDte { clave: string, destino: DestinoCodigo | null, nota?: string }
export interface LecturaDteRespuesta {   // espejo de la tarea 1
  receptorEsDelTenant: boolean
  proveedor: { id: string, nombre: string } | null
  candidatos: { id: string, nombre: string }[]
  tipoDocumento: { id: string, nombre: string } | null
  compraExistente: { id: string, estado: 'borrador' | 'confirmada', confirmadoEl: string | null } | null
  asociaciones: AsociacionDte[]
}

export function leerDte(bytes: ArrayBuffer): ResultadoLecturaDte
export function bodyLectura(doc: DocumentoDte, proveedorId?: string): Record<string, unknown>
export function descuentoDeFactura(doc: DocumentoDte, decimalesMoneda: number): { monto: string | null, avisos: string[] }
/** "COCA COLA 350ML CJ12 · 10 CJ · $9.600": lo que la línea muestra de la factura. */
export function textoLinea(linea: LineaDte, formatMonto: (v: string) => string): string
export function repartirLineas(doc: DocumentoDte, asociaciones: AsociacionDte[]):
  { lineas: { linea: LineaDte, destino: Exclude<DestinoCodigo, 'no_mercaderia'> | null, nota: string | null }[], apartadas: LineaDte[] }
```

**Duda para el revisor:** en `leerDte`, ¿hay alguna forma de meter una entidad o un
`<!DOCTYPE>` que la regex `/<!DOCTYPE|<!ENTITY/i` no vea (otro encoding, un BOM, UTF-16)? Si
el decodificado cambia los bytes, la regex corre sobre el **texto decodificado**, que es lo que
ve `DOMParser`: pedirle que lo confirme.

- [ ] **Step 1: Fixtures.** `andina-33.xml` es la escena de la spec: `EnvioDTE` con un DTE 33,
  emisor `76.543.210-3`, receptor `76123456-7`, tres `Detalle`:
  1. `CdgItem` `INT1`/`CC350-12`, `COCA COLA 350ML CJ12`, `QtyItem 10`, `UnmdItem CJ`,
     `PrcItem 9600`, `DescuentoMonto 4800`, `MontoItem 91200`;
  2. `CdgItem` `INT1`/`FA350-12`, `FANTA 350ML CJ12`, 1 CJ, `PrcItem 8800`, `MontoItem 8800`;
  3. sin `CdgItem`, `FLETE`, sin `QtyItem`, `MontoItem 5000`;

  y un `DscRcgGlobal` `D` `%` `2` (sin `IndExeDR`). Guardar los archivos **en ISO-8859-1**
  (`iconv -f utf-8 -t iso-8859-1`) y verificar con `file` que no quedaron en UTF-8.

- [ ] **Step 2: Tests que fallan** (`useDte.spec.ts`, leyendo con `readFileSync` a `ArrayBuffer`):
  - `andina-33.xml` → un documento; `lineas[0].precioUnitario === '9120'` (no `'9600'`),
    `conDescuentoDeLinea: true`, `clave === 'CODIGO:INT1:CC350-12'`;
    `lineas[1].precioUnitario === '8800'`; `lineas[2]` con `clave === 'NOMBRE:FLETE'`,
    `cantidad: null`, `precioUnitario: null`, `montoItem: '5000'`.
  - un `NmbItem` con `CAFÉ` se lee `CAFÉ` (el encoding).
  - `envio-3-docs.xml` → 3 documentos; `dte-suelto.xml` (raíz `DTE`) → 1.
  - `con-doctype.xml` y `no-es-dte.xml` → `ok: false`, `'Este archivo no es una factura electrónica del SII'`.
  - un `ArrayBuffer` de `TAMANO_MAXIMO_DTE + 1` → `ok: false` con el mensaje de tamaño.
  - `precios-brutos.xml` (`MntBruto` 1) → `preciosConIva: true` y todo `precioUnitario: null`.
  - `cantidad-6-decimales.xml` (`QtyItem 1.123456`) → `cantidad: null`; `QtyItem 3` y `MontoItem 10000` → `'3333.3333'`.
  - `descuentoDeFactura(andina, 0)` → `{ monto: '2100', avisos: [] }`: 2% de (91.200 + 8.800 +
    5.000) = 2% de 105.000, el número de la spec § 8, con el flete dentro de la base. Dejar la
    cuenta escrita en el test.
  - `descuentos-globales.xml`: uno `D $ 1500` + uno `D % 10` con `IndExeDR 1` sobre una línea
    exenta de 20.000 → `'3500'`; un `R $ 800` → `avisos` con `$800`.
  - `bodyLectura(doc)` tiene **exactamente** las claves `emisorRut, receptorRut, tipoDte, folio,
    claves` (`Object.keys(...).sort()`), `claves` sin repetidos; con proveedor, además `proveedorId`.
  - `repartirLineas`: con `{ clave: 'CODIGO:INT1:CC350-12', destino: { itemId, presentacionId } }`
    y `{ clave: 'NOMBRE:FLETE', destino: 'no_mercaderia' }` → dos líneas (la Coca con destino,
    la Fanta con `null`) y una apartada.

Run: `cd frontend && npx vitest run app/composables/useDte.spec.ts` → FAIL.

- [ ] **Step 3: Implementación.** Esqueleto que el test fuerza (completar sin cambiar firmas):

```ts
import Decimal from 'decimal.js'

const NO_ES_DTE = 'Este archivo no es una factura electrónica del SII'

function decodificar(bytes: Uint8Array): string {
  // La cabecera es ASCII en cualquier encoding que use el SII.
  const cabecera = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const encoding = /encoding\s*=\s*["']([^"']+)["']/i.exec(cabecera)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(encoding).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** Primer descendiente por nombre de tag (no NS: happy-dom no lo soporta con el xmlns del SII). */
function texto(el: Element, tag: string): string | null {
  const t = el.getElementsByTagName(tag)[0]?.textContent?.trim()
  return t ? t : null
}

export function normalizarClave(clave: string): string {
  return clave.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function leerDte(bytes: ArrayBuffer): ResultadoLecturaDte {
  if (bytes.byteLength > TAMANO_MAXIMO_DTE) {
    return { ok: false, error: 'El archivo pesa más de 2 MB: una factura electrónica no llega a eso' }
  }
  const xml = decodificar(new Uint8Array(bytes))
  // XXE y "billion laughs" entran solo por el DOCTYPE, que un DTE no lleva (spec § 4.1).
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { ok: false, error: NO_ES_DTE }
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return { ok: false, error: NO_ES_DTE }
  const raiz = doc.documentElement.localName
  if (raiz !== 'EnvioDTE' && raiz !== 'DTE') return { ok: false, error: NO_ES_DTE }
  const documentos = [...doc.getElementsByTagName('Documento')]
    .map(leerDocumento)
    .filter((d): d is DocumentoDte => d !== null)
  return documentos.length ? { ok: true, documentos } : { ok: false, error: NO_ES_DTE }
}
```

`leerDocumento` exige `Encabezado/IdDoc/TipoDTE`, `Folio`, `RUTEmisor`, `RUTRecep` (si falta
alguno → `null`); lee `Folio` y `FchEmis` **desde `IdDoc`** (no desde el documento entero),
`MntBruto === '1'` → `preciosConIva`, `MntTotal`, los `Detalle` y los `DscRcgGlobal`
(`TpoMov`, `TpoValor`, `ValorDR`, `IndExeDR`). Cada `LineaDte`: la clave con el **primer**
`CdgItem` (`CODIGO:<Tpo>:<Vlr>`) o `NOMBRE:<NmbItem>`; `descripcion` recortada a 80; cantidad
con `Decimal`, `null` si `dp() > 4` o `<= 0`; `precioUnitario =
montoItem.div(cantidad).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed()` salvo
`preciosConIva`. `descuentoDeFactura`: base de un `%` = suma de `montoItem` de las líneas con
`indExe` igual a `indExeDR` (ausente ↔ ausente), `ROUND_HALF_UP` a `decimalesMoneda`; recargos
solo a `avisos`. `bodyLectura` arma el objeto **campo por campo**, nunca con spread.

- [ ] **Step 4: Verde** (`npx vitest run app/composables/useDte.spec.ts`), luego el gate.
- [ ] **Step 5: Cierre.** Sin cambio de pantalla, sin docs de feature (la tarea 4 los cierra);
  sí `docs/patterns/frontend.md` si el lector deja un patrón nuevo (leer un archivo local sin
  subirlo). Commit: `feat(compras): el lector del XML del DTE (tarea 3)`.

---

### Task 4: Frontend — la pantalla, Playwright y el cierre del frente

**Files:**
- Create: `frontend/app/components/compras/CargarDteModal.vue` + `CargarDteModal.nuxt.spec.ts`
- Modify: `frontend/app/pages/compras/[id].vue` + `frontend/app/pages/compras/compras-carga.nuxt.spec.ts`
- Create: `frontend/e2e/compras/compras-dte.spec.ts`, `frontend/e2e/compras/fixtures/andina-*.xml`
- Modify: `docs/features/compras.md`, `docs/ESTADO.md`, `docs/PRODUCTO.md`,
  `docs/DIFERENCIADORES.md` (📐 → ✅), `docs/agent/pendientes.md` → `docs/agent/resueltos.md`
  (la parte de esta pieza; lo de spec § 10 queda en pendientes)

**Interfaces:**
- Consumes: todo lo de la tarea 3; `POST /compras/dte/lectura`; los campos nuevos del borrador.
- `CargarDteModal`: props `open` (v-model), `proveedores: { id: string, nombre: string, rut: string | null }[]`;
  emite `cargar({ documento: DocumentoDte, lectura: LecturaDteRespuesta, proveedorId: string, rutProveedor: string | null })`.

**Antes de escribir:** invocar el skill `nuxt-ui` (memoria del owner) y confirmar con el MCP de
Nuxt UI el componente de archivo (`UFileUpload` en v4, o `<input type="file">` dentro de
`UFormField` si no calza) y `UModal`. Molde de modal: `DescuentoModal.vue`.

**Duda para el revisor:** el `onBeforeRouteLeave` y el `router.replace` de `persistirBorrador`
— ¿queda algún camino (confirmar directo sin guardar antes, un 409 de folio) donde el guard
bloquee una navegación legítima o deje salir con el XML sin guardar?

- [ ] **Step 1: El modal (spec § 6), con su spec de componente primero.** Estados: *archivo*
  → (*elegir documento* si hay más de uno) → lectura → *elegir proveedor* si `proveedor` es
  null (lista = `candidatos` si hay, si no todos) → lectura de nuevo con `proveedorId` →
  *bloqueado* o `emit('cargar')`. Mensajes exactos:
  - receptor: `Esta factura es para el RUT ${doc.receptorRut}, que no es una razón social de tu empresa`
  - 56/61: `Las notas de crédito y débito no se cargan acá`; otro tipo sin fila: `Este tipo de documento no se carga como compra`
  - ya cargada: `Esta factura ya está cargada (${estado} …)` + botón **Abrir** (`navigateTo('/compras/<id>')`)
  - proveedor inexistente: `No encontramos el RUT ${rut}. Si el proveedor no existe, pedile a quien tenga el módulo Terceros que lo cree`
  - el 400 de "otro RUT" se muestra tal cual (`apiErrorMsg`).

  `rutProveedor` del emit = `doc.emisorRut` **solo** si el proveedor se eligió a mano.
  Tests: el body de cada `POST /compras/dte/lectura` es exactamente `bodyLectura(...)` (el mock
  de `useApiFetch` contesta 200 a todo: afirmar el body, no la respuesta); cada bloqueo no emite.

- [ ] **Step 2: La página.** Cambios en `[id].vue`, cada uno con su test en
  `compras-carga.nuxt.spec.ts` **escrito antes**:
  - `LineaForm` suma `dte: { clave: string, descripcion: string, texto: string, calzo: boolean, nota: string | null, conDescuentoDeLinea: boolean } | null` (`texto` = `textoLinea(linea, formatMonto)` de `useDte.ts`, no armado en el `.vue`).
  - refs `origenDte: { documento: DocumentoDte, proveedorNombre: string, rutProveedor: string | null, avisos: string[] } | null` y `apartadas: LineaDte[]`.
  - botón **"Cargar desde la factura (XML)"** en el encabezado, solo con `esNueva && editable`;
    si el formulario ya tiene proveedor o alguna línea con producto, confirma "reemplaza lo cargado".
  - al recibir `cargar`: encabezado (proveedor, tipo, folio, `fechaDocumento = fechaEmision`),
    líneas desde `repartirLineas` (con destino → producto, `modoInventario`/`unidadMedida` de
    `productos`, y `presentacionId` o `unidadCodigo`; sin destino → producto y **unidad vacíos**,
    cantidad y precio del XML), `apartadas`, y el descuento de `descuentoDeFactura` **solo si**
    ninguna línea quedó sin precio y el documento no es de precios brutos (si no, aviso).
    Un destino cuyo `itemId` no está en `productos` → por asociar.
  - `onSeleccionarItem` en una línea con `dte`: **no** pone la unidad base (salvo serie/lote).
    Test: elegir "Fanta" en la línea "3 CJ" deja la unidad vacía y Guardar deshabilitado.
  - **"No es mercadería"** mueve a `apartadas` **todas** las líneas con esa clave; **"Traer de
    vuelta"** las devuelve por asociar.
  - `puedeGuardar` exige además que toda línea con `dte` tenga producto, unidad o presentación, y
    cantidad; el pie dice `Faltan N líneas por asociar`.
  - `armarBody`: en líneas con `dte`, `claveProveedor` y `descripcionProveedor`; en el body,
    `apartadas` (clave + descripción) y `rutProveedor` **solo si** existen. Test: el body
    completo de la escena Andina, comparado con `toEqual` contra el objeto esperado.
  - guard de salida: `onBeforeRouteLeave` (precedente `pages/salones/index.vue:1079`) +
    `beforeunload`, activos solo con `origenDte`; `persistirBorrador` pone `origenDte = null`
    y `apartadas = []` **antes** del `router.replace`.
  - la franja superior con `Aceptar o reclamar esta factura se sigue haciendo en el SII` y los
    avisos; insignias `calzó por código` (neutra) / `por asociar` (warning) con tokens semánticos
    de Nuxt UI (`design:check`).

- [ ] **Step 3: Playwright como `encargado.compras`** (`compras-dte.spec.ts`, patrón de
  `compras-por-pantalla.spec.ts`: descarta la sesión de admin, datos propios por API como
  admin). Fixtures con **RUT del proveedor y folio generados** por el test (reescribir el XML
  en memoria antes de `setInputFiles` con `{ name, mimeType, buffer }`), así no dependen del
  seed ni de corridas anteriores:
  1. Factura 1 (Coca en Caja (12) ya creada por API, Fanta nueva, FLETE): la Coca llega "por
     asociar" (primera vez), se asocia; la Fanta se asocia a su producto y a una Caja (12)
     creada desde la línea; el FLETE va a "No es mercadería"; Guardar → Confirmar → por API,
     stock de la Coca **+120**.
  2. Factura 2, otro folio: las dos llegan **"calzó por código"** con su caja, el FLETE ya
     apartado, Guardar habilitado sin tocar nada.
  3. Subir otra vez la factura 1 → "ya está cargada" con **Abrir**.
  4. Salir con el XML leído sin guardar → pide confirmación.

  Correr con `./scripts/entorno.sh stack` arriba y `./scripts/reset-db.sh` antes.

- [ ] **Step 4: Docs del cierre** (en este commit): `features/compras.md` (sección completa de
  la lectura: flujo, endpoint, qué se aprende, la tabla, la pantalla, testing y el smoke),
  `ESTADO.md` ✅, `PRODUCTO.md` (la regla de negocio: el XML pre-llena, no confirma; qué se
  aprende), `DIFERENCIADORES.md` → mover la entrada a ✅ con fecha, y en `pendientes.md` dejar
  **solo** lo de spec § 10 (completar precios de una confirmada con el XML, pantalla de
  códigos) y mudar lo cerrado a `resueltos.md`. Borrar este plan y la spec si ya están
  implementados (`docs/superpowers/README.md`), dejando el conocimiento en `features/`.

- [ ] **Step 5: Cierre** con **revisión de la rama entera** además de la de la tarea
  (memoria: la revisión de rama ve el orden entre tareas). Commit: `feat(compras): cargar la
  compra desde el XML de la factura (tarea 4)`.

---

## Verification

- Gate completo en cada tarea (arriba), e2e después de `reset-db.sh` y `--verificar` después.
- Playwright de la tarea 4 como `encargado.compras`.
- Revisión independiente por tarea (`domain-reviewer`; `api-security-reviewer` en 1 y 2) y de
  la rama al final. Todo con `model: 'sonnet'`.

## Decisions / Open questions

- **Decididas:** las de la spec § 2 (owner, 2026-09-27, en selector y sección por sección).
- **Corregidas al planificar (2026-09-27), ya reflejadas en la spec:** la nota de un destino
  retirado es genérica (no lee una fila borrada); `descripcion` es la de cuando se aprendió;
  la razón social del emisor no viaja al servidor.
- **Abierta, para el revisor de la tarea 2:** el `ON CONFLICT DO NOTHING` ante dos borradores
  que aprenden la misma clave a la vez (ver la tarea).
- **La Fanta del fixture es 1 caja a $8.800**, no las "3 a $9.000" de la escena de la pregunta
  al owner: así la base del 2% es 105.000 y el test afirma el $2.100 de la spec § 8. Es un
  fixture, no una regla.
