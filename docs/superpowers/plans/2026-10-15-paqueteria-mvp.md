# Paquetería (MVP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft · **Date:** 2026-10-15 · **Owner:** Cesar Matheus

**Goal:** Un módulo de paquetería admin-only: repartidores, paquetes (código de Mercado Libre),
escaneo con pistola que crea y asigna a la hoja de ruta del repartidor, marcar entregado / no
entregado, rendir la hoja y KPIs por rango de fechas.

**Architecture:** Módulo NestJS nuevo `backend/src/modules/paqueteria/` con cinco tablas
(configuración, repartidores, paquetes, hojas de ruta y sus líneas). El estado del paquete se
**deriva** de sus líneas; los totales de una hoja salen de **una sola consulta SQL** (lista,
detalle, escaneo, rendición y KPIs la comparten), y la rendición los congela en la cabecera.
Frontend Nuxt: un grupo "Paquetería" en el menú lateral (admin), cuatro pantallas operativas y
dos de configuración.

**Tech Stack:** NestJS + TypeORM (migraciones, ADR-030) + PostgreSQL 18 · Nuxt 4 + `@nuxt/ui` v4 ·
Jest (unit + e2e de API) · Vitest · Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-15-paqueteria-mvp-design.md`](../specs/2026-10-15-paqueteria-mvp-design.md)

## Global Constraints

- Todo el módulo con `@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)` a nivel de controller; `tenantId` **solo** de `req.user` (invariante 1 y 6).
- Plata: `numeric(18,4)` en la moneda oficial; en el DTO `@IsNumberString() @IsDecimalNoNegativo() @IsMontoPersistible() @EsMontoCobrado()` y el handler con `@Body(EscalaMonedaPipe)`; el módulo importa `MonedasModule`. Ninguna cuenta de plata en `number`: las sumas las hace Postgres (`numeric`) y viajan como `string`.
- Soft delete en todo; toda lectura y todo `JOIN` filtra `eliminado_el IS NULL`. Nunca `DELETE`.
- PK y FK con `type: 'uuid'` explícito (ADR-004, lo fuerza un test).
- Repos con `RepositoriosModule.forFeature`, nunca `TypeOrmModule.forFeature`; SQL por `this.db.query`, transacciones por `this.db.transaccion`, `RETURNING` por `unwrap()`.
- Todo `@Param` UUID con `ParseUUIDPipe`; todo `*Id` de DTO con `@IsUUID()`; todo array con `@ArrayMaxSize` (y su fila en `backend/test/topes-dto.e2e-spec.ts`); todo `varchar` con su `@MaxLength`.
- `PATCH` con `@ValidateIf((_o, v) => v !== undefined)` en columnas NOT NULL; `@IsOptional()` solo en las nullable. `PUT` de configuración: los dos campos obligatorios.
- Sin N+1: el dato derivado por fila sale en la misma consulta (`LEFT JOIN LATERAL` / `GROUP BY` / `= ANY($1)`).
- Orden de bloqueo: **hoja → paquetes** (por `paquete_id` ascendente). Toda escritura sobre líneas toma primero la hoja `FOR UPDATE`.
- Frontend: `useApiFetch`, tokens semánticos de Nuxt UI, montos con `MoneyInput oficial` y `useCurrency`, fechas con `AppDateInput`/`AppRangoFechas`, `USelectMenu` para elegir repartidor. Antes de escribir front: skill `nuxt-ui`; antes de back: skill `nestjs-best-practices`.
- Mensajes de error en español, para quien atiende el local.
- Seed: IDs fijos `550e8400-e29b-41d4-a716-446655440XXX`, rango medido con el procedimiento de `docs/patterns/backend.md` § 8 (el piso por grep al 2026-10-15 es `…457`; **no** es el máximo real).
- Trabajo directo sobre `main` (CLAUDE.md). Cada commit que toca services o `.vue` exige el recibo de la revisión independiente de `verify-feature` (paso 7): el implementador **stagea por ruta**, el controlador corre la revisión y commitea. Nunca `--no-verify`, nunca `git add -A`.

## Review Focus

1. **Pistola más rápida que la red**: diez Enter en 300 ms → diez llamadas en orden, ninguna perdida, ninguna duplicada; el contador termina en 10. (Test en Task 10: `useColaEscaneo.spec.ts`.)
2. **El mismo código nuevo escaneado dos veces a la vez** (dos pistolas, o rebote de la pistola) → un paquete, una línea, respuestas `asignado_nuevo` + `ya_escaneado`, ningún 500. (Test en Task 5: carrera con `correrCarrera`.)
3. **El QR de Mercado Libre trae un JSON** (`{"id":"46…","sender_id":…}`) y el admin después busca el paquete tipeando `46…` → lo encuentra: escaneo, alta manual y búsqueda normalizan igual. (Tests en Task 1 y Task 4.)
4. **Rendir con doble clic** o desde dos pestañas → una sola rendición; la segunda recibe 400 "ya está rendida" y los totales congelados no cambian. (Test en Task 6: carrera sobre `rendir`.)
5. **Un paquete no entregado ayer sale hoy con otro repartidor**: la hoja de ayer conserva su línea `no_entregado` (no suma) y la de hoy lo cobra; los KPIs del rango cuentan una sola entrega. (Test en Task 6.)

---

## File Structure

**Backend — `backend/src/modules/paqueteria/`**

| Archivo | Responsabilidad |
|---|---|
| `entities/paquete-configuracion.entity.ts` | Defaults por tenant |
| `entities/repartidor.entity.ts` | Ficha del repartidor |
| `entities/paquete.entity.ts` | El paquete y sus montos |
| `entities/hoja-ruta.entity.ts` | Repartidor + día, estado y totales congelados |
| `entities/hoja-ruta-paquete.entity.ts` | Un paquete dentro de una hoja |
| `codigo-paquete.ts` (+ `.spec.ts`) | `normalizarCodigoPaquete`: QR / tipeado → código |
| `paqueteria.types.ts` | Tipos de respuesta compartidos por los services |
| `paquete-configuracion.service.ts` / `.controller.ts` (+ spec) | `GET|PUT /paquetes/configuracion` |
| `repartidores.service.ts` / `.controller.ts` (+ spec) | CRUD `/repartidores` |
| `paquetes.service.ts` / `.controller.ts` (+ spec) | CRUD `/paquetes`, estado derivado |
| `hojas-ruta.service.ts` / `.controller.ts` (+ spec) | escanear, asignar, marcar, quitar, rendir, lista, detalle, KPIs |
| `dto/*.dto.ts` | Un archivo por DTO |
| `paqueteria.module.ts` | Registro |

Modificados: `backend/src/database/typeorm.config.ts` (`ENTIDADES`), `backend/src/app.module.ts`,
`backend/src/modules/rbac/rbac.service.ts` (solo el comentario, Task 8),
`backend/src/database/migrations/<ts>-Paqueteria.ts` (generada), `startup-pos.sql`,
`backend/src/modules/seeder/seeder.service.ts` + `seeder.module.ts`,
`backend/test/topes-dto.e2e-spec.ts`. Nuevo: `backend/test/paqueteria.e2e-spec.ts`.

**Frontend — `frontend/app/`**

| Archivo | Responsabilidad |
|---|---|
| `types/paqueteria.ts` | Tipos espejo de `paqueteria.types.ts` |
| `composables/useColaEscaneo.ts` (+ `.spec.ts`) | Cola en orden de escaneos (pura, sin Vue de por medio salvo `ref`) |
| `composables/usePaqueteria.ts` | Rótulos y colores de estados, texto del neto |
| `pages/configuracion/repartidores.vue` | CRUD repartidores |
| `pages/configuracion/paqueteria.vue` | Valores por defecto |
| `pages/paquetes/escanear.vue` | Pantalla principal del día |
| `pages/paquetes/index.vue` | Lista, alta/edición, asignación masiva |
| `pages/paquetes/rutas/index.vue` | KPIs + hojas del rango |
| `pages/paquetes/rutas/[id].vue` | Detalle, marcar, quitar, rendir |

Modificados: `composables/useMenuLateral.ts` (+ su `.nuxt.spec.ts`), `pages/configuracion.vue`
(+ su `.nuxt.spec.ts`). Nuevo: `frontend/e2e/paqueteria/paqueteria.spec.ts`.

**Docs:** `docs/features/paqueteria.md`, `docs/README.md`, `docs/ESTADO.md`,
`docs/reference/modulos-y-configuraciones.md`, `docs/agent/desarrollo-nuevo.md`.

---

## Contratos (los usan varias tareas)

```ts
// backend/src/modules/paqueteria/paqueteria.types.ts  (frontend/app/types/paqueteria.ts es su espejo)
export type EstadoPaquete = 'disponible' | 'en_ruta' | 'entregado';
export type EstadoLinea = 'en_ruta' | 'entregado' | 'no_entregado';
export type EstadoHoja = 'abierta' | 'rendida';
export type ResultadoEscaneo = 'asignado_nuevo' | 'asignado' | 'ya_escaneado';

export interface PaqueteConfiguracionRespuesta {
  configurada: boolean;            // false = nunca se guardó: escanear y crear sin montos dan 400
  precioEnvioDefecto: string;
  pagoRepartidorDefecto: string;
}

export interface RepartidorFila {
  id: string;
  nombre: string;
  telefono: string | null;
  activo: boolean;
}

export interface PaqueteFila {
  id: string;
  codigo: string;
  destinatarioNombre: string | null;
  destinatarioTelefono: string | null;
  direccion: string | null;
  comuna: string | null;
  nota: string | null;
  remitenteTerceroId: string | null;
  remitenteNombre: string | null;
  cobroEnDestino: boolean;
  precioEnvio: string;
  pagoRepartidor: string;
  estado: EstadoPaquete;            // derivado de las líneas (spec § 3 regla 2)
  hojaRutaId: string | null;        // la hoja de la línea en_ruta / entregado
  repartidorNombre: string | null;
  bloqueado: boolean;               // entregado en una hoja rendida (regla 7)
}

export interface TotalesHoja {
  asignados: number;
  enRuta: number;
  entregados: number;
  cobroDestino: number;             // cantidad de entregados con cobro en destino
  montoCobradoDestino: string;
  montoPagoRepartidor: string;
  montoTotalGeneral: string;        // Σ precio_envio de todos los entregados
  netoARendir: string;              // cobrado − pago (puede ser negativo)
}

export interface HojaRutaFila extends TotalesHoja {
  id: string;
  repartidorId: string;
  repartidorNombre: string;
  fecha: string;                    // YYYY-MM-DD
  estado: EstadoHoja;
  rendidaEl: string | null;
}

export interface LineaHoja {
  paqueteId: string;
  codigo: string;
  destinatarioNombre: string | null;
  direccion: string | null;
  comuna: string | null;
  cobroEnDestino: boolean;
  precioEnvio: string;
  pagoRepartidor: string;
  estado: EstadoLinea;
}

export interface HojaRutaDetalle extends HojaRutaFila {
  lineas: LineaHoja[];              // la más reciente primero
}

export interface RespuestaEscaneo {
  resultado: ResultadoEscaneo;
  codigo: string;                   // ya normalizado
  hoja: HojaRutaDetalle;
}

export interface ResumenPaqueteria {
  asignados: number;
  entregados: number;
  cobroDestino: number;
  montoCobradoDestino: string;
  montoTotalGeneral: string;
  montoPagoRepartidor: string;
}
```

Errores: `400` regla de negocio, `404` no existe en el tenant, `409` conflicto de estado
(escaneo rechazado, código duplicado, línea que choca con otra hoja). Todos con `message` en
español.

---

### Task 1: Normalización del código

**Files:**
- Create: `backend/src/modules/paqueteria/codigo-paquete.ts`
- Test: `backend/src/modules/paqueteria/codigo-paquete.spec.ts`

**Interfaces:**
- Produces: `normalizarCodigoPaquete(entrada: string): string` (lanza `BadRequestException` si queda vacío o supera `MAX_CODIGO`); `MAX_CODIGO = 100`; `MAX_ENTRADA_CODIGO = 500` (lo que el DTO deja entrar crudo: un QR con JSON es más largo que el código).

- [ ] **Step 1: Write the failing test**

```ts
import { BadRequestException } from '@nestjs/common';
import { normalizarCodigoPaquete, MAX_CODIGO } from './codigo-paquete';

describe('normalizarCodigoPaquete', () => {
  it('texto plano: recorta los bordes', () => {
    expect(normalizarCodigoPaquete('  46123456789 \n')).toBe('46123456789');
  });

  it('JSON con id (QR de Mercado Libre): el código es el id', () => {
    const qr = '{"id":"46123456789","sender_id":123,"hash_code":"abc","security_digit":"0"}';
    expect(normalizarCodigoPaquete(qr)).toBe('46123456789');
  });

  it('JSON con id numérico: lo pasa a texto', () => {
    expect(normalizarCodigoPaquete('{"id":46123456789}')).toBe('46123456789');
  });

  it('JSON sin id: el código es el texto entero, recortado', () => {
    expect(normalizarCodigoPaquete(' {"otro":1} ')).toBe('{"otro":1}');
  });

  it('JSON con id vacío o no escalar: el texto entero', () => {
    expect(normalizarCodigoPaquete('{"id":""}')).toBe('{"id":""}');
    expect(normalizarCodigoPaquete('{"id":{"a":1}}')).toBe('{"id":{"a":1}}');
  });

  it('JSON inválido que empieza con llave: el texto entero', () => {
    expect(normalizarCodigoPaquete('{no es json')).toBe('{no es json');
  });

  it('vacío o solo espacios: 400', () => {
    expect(() => normalizarCodigoPaquete('   ')).toThrow(BadRequestException);
  });

  it(`más de ${MAX_CODIGO} caracteres después de normalizar: 400`, () => {
    expect(() => normalizarCodigoPaquete('x'.repeat(MAX_CODIGO + 1))).toThrow(
      BadRequestException,
    );
    expect(normalizarCodigoPaquete('x'.repeat(MAX_CODIGO))).toHaveLength(MAX_CODIGO);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/modules/paqueteria/codigo-paquete.spec.ts`
Expected: FAIL — `Cannot find module './codigo-paquete'`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { BadRequestException } from '@nestjs/common';

/** Largo de la columna `paquetes.codigo`. */
export const MAX_CODIGO = 100;
/** Lo que el DTO deja entrar crudo: el QR de Mercado Libre trae un JSON más largo que el código. */
export const MAX_ENTRADA_CODIGO = 500;

/**
 * Lo que entrega la pistola (el contenido del QR) o lo que se tipea → el código del paquete.
 * La etiqueta de Mercado Libre se supone un JSON con `id` (spec § 3.1 y § 9, sin confirmar con
 * una etiqueta real): si lo es, el código es ese `id`; si no, el texto entero. La misma función
 * corre en el escaneo, el alta y la búsqueda, para que el código tipeado y el escaneado sean el
 * mismo paquete.
 */
export function normalizarCodigoPaquete(entrada: string): string {
  const texto = entrada.trim();
  const codigo = idDelJson(texto) ?? texto;
  if (!codigo) throw new BadRequestException('El código del paquete está vacío.');
  if (codigo.length > MAX_CODIGO) {
    throw new BadRequestException(
      `El código del paquete tiene más de ${MAX_CODIGO} caracteres.`,
    );
  }
  return codigo;
}

function idDelJson(texto: string): string | null {
  if (!texto.startsWith('{')) return null;
  try {
    const id: unknown = (JSON.parse(texto) as { id?: unknown }).id;
    if (typeof id === 'number' && Number.isFinite(id)) return String(id);
    if (typeof id === 'string' && id.trim()) return id.trim();
    return null;
  } catch {
    return null;
  }
}
```

⚠️ `JSON.parse` de un `id` numérico de más de 15 dígitos pierde precisión. Los envíos de ML hoy
tienen 11; si la etiqueta real (spec § 9) trae ids más largos sin comillas, esta función cambia.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/modules/paqueteria/codigo-paquete.spec.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Stage** (sin service ni `.vue`: el pre-commit no pide recibo)

```bash
git add backend/src/modules/paqueteria/codigo-paquete.ts backend/src/modules/paqueteria/codigo-paquete.spec.ts
git commit -m "feat(paqueteria): normalizar el código del paquete escaneado o tipeado"
```

---

### Task 2: Esquema — entities, migración y módulo vacío

**Files:**
- Create: los cinco `entities/*.entity.ts`, `paqueteria.types.ts` (el bloque de **Contratos**, copiado tal cual), `paqueteria.module.ts`
- Create: `backend/src/database/migrations/<timestamp>-Paqueteria.ts` (generada)
- Modify: `backend/src/database/typeorm.config.ts` (`ENTIDADES` + imports), `backend/src/app.module.ts` (`imports`), `startup-pos.sql`

**Interfaces:**
- Produces: clases `PaqueteConfiguracion`, `Repartidor`, `Paquete`, `HojaRuta`, `HojaRutaPaquete`; `PaqueteriaModule`.

Antes de escribir: leer `docs/patterns/backend.md` § 2 y § 22, y `propinas/entities/propina-configuracion.entity.ts` (el `default: () => '0'` de un `numeric`).

- [ ] **Step 1: Entities**

`entities/paquete-configuracion.entity.ts`:

```ts
import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('paquete_configuracion')
@Index('uq_paquete_config_tenant', ['tenantId'], { unique: true, where: '"eliminado_el" IS NULL' })
export class PaqueteConfiguracion {
  @PrimaryGeneratedColumn('uuid', { name: 'paquete_configuracion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'precio_envio_defecto', type: 'numeric', precision: 18, scale: 4 })
  precioEnvioDefecto: string;

  @Column({ name: 'pago_repartidor_defecto', type: 'numeric', precision: 18, scale: 4 })
  pagoRepartidorDefecto: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
```

`entities/repartidor.entity.ts`:

```ts
@Entity('repartidores')
@Index('idx_repartidores_tenant', ['tenantId'])
export class Repartidor {
  @PrimaryGeneratedColumn('uuid', { name: 'repartidor_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 150 })
  nombre: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  telefono: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  // creado_el / actualizado_el / eliminado_el: iguales a PaqueteConfiguracion
}
```

`entities/paquete.entity.ts`:

```ts
@Entity('paquetes')
@Index('uq_paquetes_tenant_codigo', ['tenantId', 'codigo'], { unique: true, where: '"eliminado_el" IS NULL' })
@Index('idx_paquetes_remitente', ['remitenteTerceroId'])
export class Paquete {
  @PrimaryGeneratedColumn('uuid', { name: 'paquete_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  codigo: string;

  @Column({ name: 'destinatario_nombre', type: 'varchar', length: 150, nullable: true })
  destinatarioNombre: string | null;

  @Column({ name: 'destinatario_telefono', type: 'varchar', length: 30, nullable: true })
  destinatarioTelefono: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  direccion: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  comuna: string | null;

  @Column({ type: 'text', nullable: true })
  nota: string | null;

  @Column({ name: 'remitente_tercero_id', type: 'uuid', nullable: true })
  remitenteTerceroId: string | null;

  @ManyToOne(() => Tercero, { nullable: true })
  @JoinColumn({ name: 'remitente_tercero_id' })
  remitente?: Tercero;

  @Column({ name: 'cobro_en_destino', type: 'boolean', default: false })
  cobroEnDestino: boolean;

  @Column({ name: 'precio_envio', type: 'numeric', precision: 18, scale: 4 })
  precioEnvio: string;

  @Column({ name: 'pago_repartidor', type: 'numeric', precision: 18, scale: 4 })
  pagoRepartidor: string;

  // creado_el / actualizado_el / eliminado_el
}
```

`entities/hoja-ruta.entity.ts`:

```ts
@Entity('hojas_ruta')
@Index('uq_hojas_ruta_repartidor_fecha', ['tenantId', 'repartidorId', 'fecha'], { unique: true, where: '"eliminado_el" IS NULL' })
@Index('idx_hojas_ruta_tenant_fecha', ['tenantId', 'fecha'])
export class HojaRuta {
  @PrimaryGeneratedColumn('uuid', { name: 'hoja_ruta_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'repartidor_id', type: 'uuid' })
  repartidorId: string;

  @ManyToOne(() => Repartidor)
  @JoinColumn({ name: 'repartidor_id' })
  repartidor?: Repartidor;

  /** Día de la ruta, elegido en pantalla (por defecto el día del negocio). Columna `date`: no pasa por rango-fecha.util. */
  @Column({ type: 'date' })
  fecha: string;

  @Column({ type: 'varchar', length: 20, default: 'abierta' })
  estado: 'abierta' | 'rendida';

  @Column({ name: 'rendida_por', type: 'uuid', nullable: true })
  rendidaPor: string | null;

  @Column({ name: 'rendida_el', type: 'timestamptz', nullable: true })
  rendidaEl: Date | null;

  // Totales congelados al rendir; null mientras está abierta (spec § 2).
  @Column({ name: 'total_asignados', type: 'int', nullable: true }) totalAsignados: number | null;
  @Column({ name: 'total_entregados', type: 'int', nullable: true }) totalEntregados: number | null;
  @Column({ name: 'total_cobro_destino', type: 'int', nullable: true }) totalCobroDestino: number | null;
  @Column({ name: 'monto_cobrado_destino', type: 'numeric', precision: 18, scale: 4, nullable: true }) montoCobradoDestino: string | null;
  @Column({ name: 'monto_pago_repartidor', type: 'numeric', precision: 18, scale: 4, nullable: true }) montoPagoRepartidor: string | null;
  @Column({ name: 'monto_total_general', type: 'numeric', precision: 18, scale: 4, nullable: true }) montoTotalGeneral: string | null;
  @Column({ name: 'neto_a_rendir', type: 'numeric', precision: 18, scale: 4, nullable: true }) netoARendir: string | null;

  // creado_el / actualizado_el / eliminado_el
}
```

`entities/hoja-ruta-paquete.entity.ts`:

```ts
@Entity('hoja_ruta_paquetes')
@Index('uq_hoja_ruta_paquetes_en_ruta', ['paqueteId'], { unique: true, where: `"estado" = 'en_ruta' AND "eliminado_el" IS NULL` })
@Index('idx_hoja_ruta_paquetes_hoja', ['hojaRutaId'])
@Index('idx_hoja_ruta_paquetes_paquete', ['paqueteId'])
export class HojaRutaPaquete {
  @PrimaryGeneratedColumn('uuid', { name: 'hoja_ruta_paquete_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'hoja_ruta_id', type: 'uuid' })
  hojaRutaId: string;

  @ManyToOne(() => HojaRuta)
  @JoinColumn({ name: 'hoja_ruta_id' })
  hoja?: HojaRuta;

  @Column({ name: 'paquete_id', type: 'uuid' })
  paqueteId: string;

  @ManyToOne(() => Paquete)
  @JoinColumn({ name: 'paquete_id' })
  paquete?: Paquete;

  @Column({ type: 'varchar', length: 20, default: 'en_ruta' })
  estado: 'en_ruta' | 'entregado' | 'no_entregado';

  // creado_el / actualizado_el / eliminado_el
}
```

- [ ] **Step 2: Registrar**

`paqueteria.module.ts` (por ahora sin providers; las tareas siguientes los suman):

```ts
import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db';
import { MonedasModule } from '../monedas/monedas.module';
import { PaqueteConfiguracion } from './entities/paquete-configuracion.entity';
import { Repartidor } from './entities/repartidor.entity';
import { Paquete } from './entities/paquete.entity';
import { HojaRuta } from './entities/hoja-ruta.entity';
import { HojaRutaPaquete } from './entities/hoja-ruta-paquete.entity';

@Module({
  imports: [
    RepositoriosModule.forFeature([PaqueteConfiguracion, Repartidor, Paquete, HojaRuta, HojaRutaPaquete]),
    // `@Body(EscalaMonedaPipe)` resuelve por `moduleRef.injectables`: sin esto el arranque se cae (backend.md § 3.1).
    MonedasModule,
  ],
  controllers: [],
  providers: [],
})
export class PaqueteriaModule {}
```

Verificar la ruta exacta de `RepositoriosModule` y `MonedasModule` con `grep -rn "RepositoriosModule.forFeature" backend/src/modules/cajones/*.module.ts`.
Sumar las cinco entities a `ENTIDADES` en `typeorm.config.ts` y `PaqueteriaModule` a los `imports` de `app.module.ts`.

- [ ] **Step 3: Generar la migración**

```bash
./scripts/entorno.sh db           # en un worktree; en main ya está el compose
cd backend && npm run start:dev   # una vez, para que la base quede al día con main; cortar
npm run migration:generate -- Paqueteria
```

Leer la migración generada (backend.md § 22): cinco `CREATE TABLE`, los índices de arriba con su
`WHERE`, las FK a `terceros`, `repartidores`, `hojas_ruta` y `paquetes`, **ningún** `DROP` ajeno.
`down` en orden inverso.

- [ ] **Step 4: `startup-pos.sql`** — agregar las cinco tablas con los mismos nombres, tipos e índices.

- [ ] **Step 5: Verificar**

```bash
cd backend && npm run migration:check && npm run typecheck && npm test -- --testPathPattern 'invariant'
cd backend && npm run test:e2e -- esquema.e2e-spec
```

Expected: `migration:check` exit 0; los invariant specs (uuid en PK/FK incluido) en verde; `esquema.e2e-spec` en verde.

- [ ] **Step 6: Stage** las rutas tocadas (`git add` por ruta) y `git diff --cached --stat`. Commit: `feat(paqueteria): esquema de repartidores, paquetes y hojas de ruta`.

---

### Task 3: Configuración y repartidores (backend)

**Files:**
- Create: `paquete-configuracion.service.ts` (+ `.spec.ts`), `paquete-configuracion.controller.ts`, `dto/put-paquete-configuracion.dto.ts`
- Create: `repartidores.service.ts` (+ `.spec.ts`), `repartidores.controller.ts`, `dto/create-repartidor.dto.ts`, `dto/update-repartidor.dto.ts`
- Modify: `paqueteria.module.ts`
- Test (e2e): `backend/test/paqueteria.e2e-spec.ts` (se crea acá; las tareas 4–6 le suman `describe`)

**Interfaces:**
- Produces: `PaqueteConfiguracionService.obtener(tenantId): Promise<PaqueteConfiguracionRespuesta>`; `.exigirDefaults(tenantId): Promise<{ precioEnvio: string; pagoRepartidor: string }>` (400 si no está configurada); `RepartidoresService.exigirActivo(tenantId, repartidorId): Promise<RepartidorFila>` (404 / 400 "inactivo").

- [ ] **Step 1: DTOs**

```ts
// dto/put-paquete-configuracion.dto.ts — PUT reemplaza: los dos obligatorios (backend.md § 3)
export class PutPaqueteConfiguracionDto {
  @IsNumberString() @IsDecimalNoNegativo() @IsMontoPersistible() @EsMontoCobrado()
  precioEnvioDefecto: string;

  @IsNumberString() @IsDecimalNoNegativo() @IsMontoPersistible() @EsMontoCobrado()
  pagoRepartidorDefecto: string;
}

// dto/create-repartidor.dto.ts
export class CreateRepartidorDto {
  @IsString() @IsNotEmpty() @MaxLength(150)
  nombre: string;

  @IsOptional() @IsString() @MaxLength(30)
  telefono?: string | null;
}

// dto/update-repartidor.dto.ts
export class UpdateRepartidorDto {
  @ValidateIf((_o, v) => v !== undefined) @IsString() @IsNotEmpty() @MaxLength(150)
  nombre?: string;

  @IsOptional() @IsString() @MaxLength(30)
  telefono?: string | null;

  @ValidateIf((_o, v) => v !== undefined) @IsBoolean()
  activo?: boolean;
}
```

- [ ] **Step 2: Failing unit tests** (`repartidores.service.spec.ts`, con `Db` mockeado como en backend.md § 7)

```ts
describe('RepartidoresService', () => {
  it('exigirActivo: 404 si no existe en el tenant', async () => {
    dbMock.query.mockResolvedValueOnce([]);
    await expect(service.exigirActivo(TENANT, ID)).rejects.toThrow(NotFoundException);
  });

  it('exigirActivo: 400 si está inactivo', async () => {
    dbMock.query.mockResolvedValueOnce([{ id: ID, nombre: 'Juan', telefono: null, activo: false }]);
    await expect(service.exigirActivo(TENANT, ID)).rejects.toThrow('Juan está inactivo');
  });

  it('remove: 400 si tiene hojas de ruta (se desactiva, no se borra)', async () => {
    dbMock.query
      .mockResolvedValueOnce([{ id: ID }])          // existe
      .mockResolvedValueOnce([{ tiene: true }]);    // EXISTS hojas_ruta
    await expect(service.remove(TENANT, ID)).rejects.toThrow('tiene hojas de ruta');
  });
});
```

Y en `paquete-configuracion.service.spec.ts`: `obtener` sin fila → `{ configurada: false, precioEnvioDefecto: '0', pagoRepartidorDefecto: '0' }`; `exigirDefaults` sin fila → `BadRequestException('Configurá los valores por defecto de Paquetería antes de cargar paquetes.')`.

Run: `cd backend && npx jest src/modules/paqueteria` → FAIL (no existen los services).

- [ ] **Step 3: Implementación**

- `PaqueteConfiguracionService.guardar(tenantId, dto)`: upsert por `tenant_id` dentro de `db.transaccion` — `INSERT … ON CONFLICT (tenant_id) WHERE eliminado_el IS NULL DO UPDATE SET precio_envio_defecto = EXCLUDED…, actualizado_el = now() RETURNING …` (por `unwrap`). Devuelve `{ configurada: true, … }`.
- `RepartidoresService`: `findAll(tenantId)` (todos, activos e inactivos, `ORDER BY nombre`: la pantalla de administración necesita ver al inactivo para reactivarlo — backend.md § 2 "Si la entidad lleva activo"); `create`; `update` (patch mergeable, sin refetch); `remove` (soft, 400 si `EXISTS (SELECT 1 FROM hojas_ruta WHERE repartidor_id = $1 AND eliminado_el IS NULL)` — así una hoja nunca apunta a un repartidor borrado y ninguna lectura necesita la excepción del filtro); `exigirActivo` (lee `activo` aparte del `WHERE`, para que "no es de este tenant" y "está inactivo" sean errores distintos).
- Controllers: `@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)` en la clase; `@Controller('paquetes/configuracion')` con `@Get()` y `@Put() guardar(@Req() req, @Body(EscalaMonedaPipe) dto)`; `@Controller('repartidores')` con `@Get() @Post() @Patch(':id') @Delete(':id')`, `ParseUUIDPipe` en `:id`. Patrón: `cajones.controller.ts`.
- Registrar los dos controllers y services en `PaqueteriaModule` (el de configuración **antes** que el de paquetes en `controllers`).

Run: `npx jest src/modules/paqueteria` → PASS.

- [ ] **Step 4: E2E** — crear `backend/test/paqueteria.e2e-spec.ts` con el armado de `cajones.e2e-spec.ts` (mismo `login`, `validacionGlobal()`, `cookieParser`). Usuarios: `ADMIN_PARIS` (`admin.paris@paris.cl`), `VENDEDOR_PARIS` (`vendedor@paris.cl`, no admin) y el segundo tenant con `loginSegundoTenant` de `test/helpers/segundo-tenant.ts`. Cada `describe` crea **sus propios** repartidores (`E2E ${Date.now()}`): nunca los del seed.

```ts
describe('Paquetería — configuración y repartidores', () => {
  it('el vendedor (no admin) recibe 403 en todas las rutas del módulo', async () => {
    for (const [metodo, ruta] of [
      ['get', '/api/paquetes/configuracion'], ['get', '/api/repartidores'],
      ['get', '/api/paquetes'], ['get', '/api/hojas-ruta?desde=2026-10-01&hasta=2026-10-31'],
    ] as const) {
      const res = await request(app.getHttpServer())[metodo](ruta).set('Authorization', `Bearer ${tokenVendedor}`);
      expect(res.status).toBe(403);
    }
  });

  it('PUT configuración: guarda, y un monto con decimales en CLP es 400', async () => {
    const ok = await put('/api/paquetes/configuracion', { precioEnvioDefecto: '10000', pagoRepartidorDefecto: '5000' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ configurada: true, precioEnvioDefecto: '10000.0000' });
    const malo = await put('/api/paquetes/configuracion', { precioEnvioDefecto: '10000.5', pagoRepartidorDefecto: '5000' });
    expect(malo.status).toBe(400);
  });

  it('PUT configuración sin uno de los campos: 400', async () => {
    const res = await put('/api/paquetes/configuracion', { precioEnvioDefecto: '10000' });
    expect(res.status).toBe(400);
  });

  it('repartidor: alta y desactivar; el listado lo sigue mostrando, inactivo', async () => {
    const r = await post('/api/repartidores', { nombre: `E2E ${Date.now()}`, telefono: '+56911112222' });
    expect(r.status).toBe(201);
    const id = (r.body as RepartidorFila).id;
    const off = await patch(`/api/repartidores/${id}`, { activo: false });
    expect(off.status).toBe(200);
    const lista = await get('/api/repartidores');
    expect(lista.status).toBe(200);
    expect((lista.body as RepartidorFila[]).find((x) => x.id === id)).toMatchObject({ activo: false });
  });

  it('aislamiento: el repartidor de un tenant no existe para el otro (404)', async () => {
    const r = await post('/api/repartidores', { nombre: `E2E ${Date.now()}` });
    expect(r.status).toBe(201);
    const ajeno = await request(app.getHttpServer())
      .patch(`/api/repartidores/${(r.body as RepartidorFila).id}`)
      .set('Authorization', `Bearer ${tokenSegundoTenant}`)
      .send({ nombre: 'x' });
    expect(ajeno.status).toBe(404);
  });

  it('id con forma no UUID: 400, no 500', async () => {
    const res = await patch('/api/repartidores/no-es-uuid', { nombre: 'x' });
    expect(res.status).toBe(400);
  });
});
```

⚠️ El `PUT` de configuración cambia estado **único del tenant** Paris (backend.md § "el estado
que es único por definición"): este spec deja siempre `10000` / `5000`, los mismos valores del
seed (Task 7), así ningún otro spec ve otra cosa.

Run (ciclo corto): `cd backend && npm run test:e2e -- paqueteria.e2e-spec` → PASS.

- [ ] **Step 5: Stage + revisión + commit** (el controlador corre `verify-feature` paso 7 sobre lo staged). Commit: `feat(paqueteria): configuración de defaults y repartidores`.

---

### Task 4: Paquetes — alta, edición, borrado y listado con estado derivado

**Files:**
- Create: `paquetes.service.ts` (+ `.spec.ts`), `paquetes.controller.ts`, `dto/create-paquete.dto.ts`, `dto/update-paquete.dto.ts`, `dto/query-paquetes.dto.ts`
- Modify: `paqueteria.module.ts`, `backend/test/paqueteria.e2e-spec.ts`

**Interfaces:**
- Consumes: `normalizarCodigoPaquete`, `MAX_ENTRADA_CODIGO` (Task 1); `PaqueteConfiguracionService.exigirDefaults` (Task 3).
- Produces: `PaquetesService.filaPorId(tenantId, id): Promise<PaqueteFila>`; `PaquetesService.SELECT_FILA` (fragmento SQL compartido con Task 5 — ver Step 3); `PaquetesService.validarTercero(tenantId, terceroId)`.

- [ ] **Step 1: DTOs**

```ts
export class CreatePaqueteDto {
  @IsString() @IsNotEmpty() @MaxLength(MAX_ENTRADA_CODIGO)
  codigo: string;

  @IsOptional() @IsString() @MaxLength(150) destinatarioNombre?: string | null;
  @IsOptional() @IsString() @MaxLength(30)  destinatarioTelefono?: string | null;
  @IsOptional() @IsString() @MaxLength(255) direccion?: string | null;
  @IsOptional() @IsString() @MaxLength(100) comuna?: string | null;
  @IsOptional() @IsString()                 nota?: string | null;
  @IsOptional() @IsUUID()                   remitenteTerceroId?: string | null;

  @IsBoolean()
  cobroEnDestino: boolean;

  // Ausentes = los defaults de la configuración, copiados (spec § 3 regla 1).
  @IsOptional() @IsNumberString() @IsDecimalNoNegativo() @IsMontoPersistible() @EsMontoCobrado()
  precioEnvio?: string;
  @IsOptional() @IsNumberString() @IsDecimalNoNegativo() @IsMontoPersistible() @EsMontoCobrado()
  pagoRepartidor?: string;
}

export class UpdatePaqueteDto {
  @ValidateIf((_o, v) => v !== undefined) @IsString() @IsNotEmpty() @MaxLength(MAX_ENTRADA_CODIGO)
  codigo?: string;
  // los seis opcionales nullable: igual que en Create, con @IsOptional()
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean()
  cobroEnDestino?: boolean;
  @ValidateIf((_o, v) => v !== undefined) @IsNumberString() @IsDecimalNoNegativo() @IsMontoPersistible() @EsMontoCobrado()
  precioEnvio?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsNumberString() @IsDecimalNoNegativo() @IsMontoPersistible() @EsMontoCobrado()
  pagoRepartidor?: string;
}

export class QueryPaquetesDto extends PaginationQueryDto {
  @IsOptional() @IsIn(['disponible', 'en_ruta', 'entregado']) estado?: EstadoPaquete;
  @IsOptional() @IsIn(['true', 'false']) cobroEnDestino?: 'true' | 'false';
  @IsOptional() @IsIn(['true']) porCompletar?: 'true';   // sin dirección o sin destinatario
  @IsOptional() @IsString() @MaxLength(MAX_ENTRADA_CODIGO) q?: string;
}
```

- [ ] **Step 2: Failing unit tests** (`paquetes.service.spec.ts`)

```ts
it('create sin montos copia los defaults de la configuración', async () => {
  configMock.exigirDefaults.mockResolvedValue({ precioEnvio: '10000', pagoRepartidor: '5000' });
  dbMock.query.mockResolvedValueOnce([[{ paquete_id: ID }], 1]);        // INSERT … RETURNING
  dbMock.query.mockResolvedValueOnce([filaSql({ precio_envio: '10000.0000' })]); // filaPorId
  await service.create(TENANT, { codigo: ' {"id":"461"} ', cobroEnDestino: false });
  const [, params] = dbMock.query.mock.calls[0];
  expect(params).toEqual(expect.arrayContaining(['461', '10000', '5000']));
});

it('create con montos explícitos no exige la configuración', async () => {
  await service.create(TENANT, { codigo: '461', cobroEnDestino: true, precioEnvio: '8000', pagoRepartidor: '4000' });
  expect(configMock.exigirDefaults).not.toHaveBeenCalled();
});

it('update de un paquete entregado en hoja rendida: 400 al tocar montos o cobro en destino', async () => {
  dbMock.query.mockResolvedValueOnce([filaSql({ bloqueado: true })]);
  await expect(service.update(TENANT, ID, { precioEnvio: '1' })).rejects.toThrow('ya se rindió');
});

it('update de un paquete rendido sí deja completar la dirección', async () => {
  dbMock.query.mockResolvedValueOnce([filaSql({ bloqueado: true })]);
  await expect(service.update(TENANT, ID, { direccion: 'Av. Siempreviva 742' })).resolves.toBeDefined();
});

it('remove de un paquete que alguna vez salió en una hoja: 400', async () => {
  dbMock.query.mockResolvedValueOnce([{ id: ID, tiene_lineas: true }]);
  await expect(service.remove(TENANT, ID)).rejects.toThrow('ya salió en una hoja de ruta');
});
```

Run → FAIL.

- [ ] **Step 3: Implementación**

El estado derivado vive en un fragmento SQL **único**, exportado, que usan `findAll`, `filaPorId` y
el escaneo (Task 5):

```ts
/** Estado del paquete derivado de sus líneas (spec § 3 regla 2). Sin N+1: un LATERAL por fila,
 *  apoyado en idx_hoja_ruta_paquetes_paquete. Una línea en_ruta o entregado como mucho por
 *  paquete: el índice único y las reglas de asignar/marcar lo garantizan. */
export const SELECT_PAQUETE_FILA = `
  SELECT p.paquete_id AS id, p.codigo, p.destinatario_nombre, p.destinatario_telefono,
         p.direccion, p.comuna, p.nota, p.remitente_tercero_id, t.nombre AS remitente_nombre,
         p.cobro_en_destino, p.precio_envio, p.pago_repartidor,
         COALESCE(ruta.estado, 'disponible') AS estado,
         ruta.hoja_ruta_id, ruta.repartidor_nombre,
         (ruta.estado = 'entregado' AND ruta.hoja_estado = 'rendida') IS TRUE AS bloqueado
    FROM paquetes p
    LEFT JOIN terceros t ON t.tercero_id = p.remitente_tercero_id AND t.eliminado_el IS NULL
    LEFT JOIN LATERAL (
      SELECT l.estado, l.hoja_ruta_id, h.estado AS hoja_estado, r.nombre AS repartidor_nombre
        FROM hoja_ruta_paquetes l
        JOIN hojas_ruta h   ON h.hoja_ruta_id = l.hoja_ruta_id AND h.eliminado_el IS NULL
        JOIN repartidores r ON r.repartidor_id = h.repartidor_id AND r.eliminado_el IS NULL
       WHERE l.paquete_id = p.paquete_id AND l.eliminado_el IS NULL
         AND l.estado IN ('en_ruta', 'entregado')
       LIMIT 1
    ) ruta ON TRUE`;
```

- `findAll(tenantId, query)`: `WHERE p.tenant_id = $1 AND p.eliminado_el IS NULL` + filtros
  (`COALESCE(ruta.estado,'disponible') = $n`; `p.cobro_en_destino = $n`; `porCompletar` →
  `(p.direccion IS NULL OR p.destinatario_nombre IS NULL)`; `q` → normalizar con
  `normalizarCodigoPaquete` **y** buscar `p.codigo = $n OR p.codigo ILIKE $m OR
  p.destinatario_nombre ILIKE $m` con `$m = '%' || q || '%'`; si la normalización lanza (vacío),
  sin filtro). `COUNT(*)` + `ORDER BY p.creado_el DESC LIMIT/OFFSET` con `resolvePagination` /
  `buildPaginationMeta` (backend.md § 10). Mapeo snake → camel en una función local `aFila(row)`.
- `create`: normaliza el código; `validarTercero` si viene remitente (404 si no es del tenant,
  400 si está inactivo — mismo criterio que `ventas.service.ts → validarTercero`); montos =
  los del DTO o `exigirDefaults`; `INSERT … ON CONFLICT (tenant_id, codigo) WHERE eliminado_el IS NULL
  DO NOTHING RETURNING paquete_id`; sin fila devuelta → `ConflictException('Ya existe un paquete con el código X.')`.
  Respuesta: `filaPorId` (es un alta, el `RETURNING` no trae el `LATERAL`; una sola lectura,
  no un refetch por fila).
- `update`: `filaPorId` → si `bloqueado` y el DTO trae `precioEnvio`, `pagoRepartidor` o
  `cobroEnDestino` → `BadRequestException('El paquete X ya se rindió: sus montos no se pueden cambiar.')`;
  código nuevo normalizado y con el mismo `ON CONFLICT`/409 (un `UPDATE` que choca con el índice:
  atrapar `23505` y traducir a 409); `UPDATE … RETURNING`; respuesta `{ ...filaAnterior, ...camposTocados }`.
- `remove`: 400 si `EXISTS` alguna línea viva del paquete (`'El paquete X ya salió en una hoja de ruta: no se puede borrar.'`); si no, `UPDATE paquetes SET eliminado_el = now()`.
- Controller `@Controller('paquetes')`: `@Get() findAll(@Query() q)`, `@Post() create(@Body(EscalaMonedaPipe) dto)`, `@Patch(':id')` (con `EscalaMonedaPipe`), `@Delete(':id')`.

Run unit → PASS.

- [ ] **Step 4: E2E** (sumar `describe('Paquetería — paquetes')`)

- alta con solo código → nace con `10000` / `5000` y `estado: 'disponible'`;
- alta con el QR en JSON `{"id":"E2E-<ts>"}` y búsqueda `q=E2E-<ts>` → lo encuentra (Review Focus 3);
- mismo código dos veces → 409;
- `porCompletar=true` lo lista; tras `PATCH { direccion }` ya no;
- `PATCH { precioEnvio: '10000.5' }` → 400 (escala CLP);
- `PATCH { cobroEnDestino: null }` → 400 (columna NOT NULL);
- paquete del segundo tenant → 404 en `PATCH` y `DELETE`;
- `DELETE` de uno que nunca salió → 200 y desaparece del listado.

Run: `npm run test:e2e -- paqueteria.e2e-spec` → PASS.

- [ ] **Step 5: Stage + revisión + commit**: `feat(paqueteria): alta, edición y listado de paquetes con estado derivado`.

---

### Task 5: Hojas de ruta — escanear y asignar

**Files:**
- Create: `hojas-ruta.service.ts` (+ `.spec.ts`), `hojas-ruta.controller.ts`, `dto/escanear.dto.ts`, `dto/asignar.dto.ts`
- Modify: `paqueteria.module.ts`, `backend/test/paqueteria.e2e-spec.ts`, `backend/test/topes-dto.e2e-spec.ts`

**Interfaces:**
- Consumes: `normalizarCodigoPaquete`; `RepartidoresService.exigirActivo`; `PaqueteConfiguracionService.exigirDefaults`; `SELECT_PAQUETE_FILA`.
- Produces: `HojasRutaService.detalle(tenantId, hojaId): Promise<HojaRutaDetalle>`; `HojasRutaService.totales(tenantId, hojaIds: string[]): Promise<Map<string, TotalesHoja>>` (la **única** fuente de totales; la usan Task 6 y la lista); privado `abrirOTomarHoja(tenantId, repartidorId, fecha): Promise<{ id: string; estado: EstadoHoja }>` (crea o toma, con la hoja `FOR UPDATE`).

- [ ] **Step 1: DTOs**

```ts
export class EscanearDto {
  @IsUUID() repartidorId: string;
  @EsFechaPura() fecha: string;                       // columna `date`: molde exacto, sin hora
  @IsString() @IsNotEmpty() @MaxLength(MAX_ENTRADA_CODIGO) codigo: string;
  @IsBoolean() cobroEnDestino: boolean;
}

export class AsignarDto {
  @IsUUID() repartidorId: string;
  @EsFechaPura() fecha: string;
  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsUUID('all', { each: true })
  // 200: por encima de una ruta de reparto real (un repartidor de Flex lleva del orden de 100
  // por día); el service bloquea las filas con un solo `= ANY($1)`, así que el costo es plano.
  @ArrayMaxSize(200)
  paqueteIds: string[];
}
```

Sumar a `TOPES` de `topes-dto.e2e-spec.ts`:

```ts
  // paquetería
  {
    campo: 'paqueteIds',
    tope: 200,
    metodo: 'post',
    ruta: 'hojas-ruta/asignar',
    cuerpo: (n) => ({ repartidorId: ID, fecha: '2026-10-15', paqueteIds: uuids(n) }),
  },
```

- [ ] **Step 2: La consulta de totales** (privada del service; **la única** — spec § 7, ajuste de este plan)

```ts
private async totales(tenantId: string, hojaIds: string[]): Promise<Map<string, TotalesHoja>> {
  const filas = await this.db.query<FilaTotales[]>(
    `SELECT h.hoja_ruta_id,
            h.estado,
            COUNT(l.*)::int                                                            AS asignados,
            COUNT(*) FILTER (WHERE l.estado = 'en_ruta')::int                          AS en_ruta,
            COUNT(*) FILTER (WHERE l.estado = 'entregado')::int                        AS entregados,
            COUNT(*) FILTER (WHERE l.estado = 'entregado' AND p.cobro_en_destino)::int AS cobro_destino,
            COALESCE(SUM(p.precio_envio)    FILTER (WHERE l.estado = 'entregado' AND p.cobro_en_destino), 0) AS monto_cobrado_destino,
            COALESCE(SUM(p.pago_repartidor) FILTER (WHERE l.estado = 'entregado'), 0) AS monto_pago_repartidor,
            COALESCE(SUM(p.precio_envio)    FILTER (WHERE l.estado = 'entregado'), 0) AS monto_total_general
       FROM hojas_ruta h
       LEFT JOIN hoja_ruta_paquetes l ON l.hoja_ruta_id = h.hoja_ruta_id AND l.eliminado_el IS NULL
       LEFT JOIN paquetes p           ON p.paquete_id = l.paquete_id     AND p.eliminado_el IS NULL
      WHERE h.tenant_id = $1 AND h.hoja_ruta_id = ANY($2) AND h.eliminado_el IS NULL
      GROUP BY h.hoja_ruta_id, h.estado`,
    [tenantId, hojaIds],
  );
  // neto = cobrado − pago con Decimal (strings de numeric; nunca Number)
  return new Map(filas.map((f) => [f.hoja_ruta_id, aTotales(f)]));
}
```

`aTotales` arma `netoARendir = new Decimal(f.monto_cobrado_destino).minus(f.monto_pago_repartidor).toFixed(4)`.
Para una hoja **rendida**, `detalle` y la lista leen los totales **congelados** de la cabecera
(Task 6); esta consulta es la que los produce al rendir.

- [ ] **Step 3: Failing unit tests** (`hojas-ruta.service.spec.ts`) — reglas, no SQL (el mock de `Db` no ve la forma del SQL; la forma la cubre el e2e)

```ts
it('escanear: hoja rendida → 400', …);
it('escanear: repartidor inactivo → 400 (lo dice exigirActivo)', …);
it('escanear: sin configuración y código nuevo → 400 "Configurá los valores por defecto…"', …);
it('escanear: paquete entregado → 409 "entregado el 12-10"', …);
it('escanear: paquete en ruta con otro repartidor → 409 "está con Pedro"', …);
it('asignar: si uno no está disponible no asigna ninguno y nombra los códigos', …);
```

Run → FAIL.

- [ ] **Step 4: Implementación**

`abrirOTomarHoja` (dentro de la transacción del llamador):

```ts
await this.db.query(
  `INSERT INTO hojas_ruta (tenant_id, repartidor_id, fecha)
   VALUES ($1, $2, $3)
   ON CONFLICT (tenant_id, repartidor_id, fecha) WHERE eliminado_el IS NULL DO NOTHING`,
  [tenantId, repartidorId, fecha],
);
const [hoja] = await this.db.query<{ id: string; estado: EstadoHoja }[]>(
  `SELECT hoja_ruta_id AS id, estado FROM hojas_ruta
    WHERE tenant_id = $1 AND repartidor_id = $2 AND fecha = $3 AND eliminado_el IS NULL
    FOR UPDATE`,
  [tenantId, repartidorId, fecha],
);
if (hoja.estado === 'rendida') {
  throw new BadRequestException('La hoja de ruta de ese día ya está rendida: elegí otra fecha.');
}
return hoja;
```

`escanear(tenantId, dto)` — `db.transaccion`:
1. `codigo = normalizarCodigoPaquete(dto.codigo)`; `repartidor = exigirActivo(...)`; `hoja = abrirOTomarHoja(...)` (orden: hoja primero).
2. Buscar el paquete por código `FOR UPDATE`. Si no existe: `defaults = exigirDefaults(tenantId)`;
   `INSERT INTO paquetes (…, codigo, cobro_en_destino, precio_envio, pago_repartidor) … ON CONFLICT (tenant_id, codigo) WHERE eliminado_el IS NULL DO NOTHING RETURNING paquete_id`.
   Sin fila devuelta → lo creó un escaneo concurrente: releer `FOR UPDATE` y seguir como "existía".
   Con fila → `resultado = 'asignado_nuevo'`.
3. Leer sus líneas vivas (`l.estado`, `l.hoja_ruta_id`, `h.fecha`, `r.nombre`):
   - línea `en_ruta` en **esta** hoja → `resultado = 'ya_escaneado'`, no escribe;
   - línea `en_ruta` en otra hoja → `ConflictException(\`El paquete ${codigo} está con ${r.nombre} (hoja del ${dd-mm}).\`)`;
   - línea `entregado` → `ConflictException(\`El paquete ${codigo} ya se entregó el ${dd-mm}.\`)`;
   - línea `no_entregado` en **esta** hoja → `UPDATE … SET estado = 'en_ruta'` (reintento del mismo día: no se duplica la línea); `resultado = 'asignado'`;
   - si no → `INSERT INTO hoja_ruta_paquetes (tenant_id, hoja_ruta_id, paquete_id)`; `resultado = 'asignado'` (o `'asignado_nuevo'` si se creó en el paso 2).
   El `cobro_en_destino` de un paquete existente **no** se toca (spec regla 5b).
4. Respuesta `{ resultado, codigo, hoja: await this.detalle(tenantId, hoja.id) }`.

`dd-mm` se arma desde el `date` (`'2026-10-12'` → `'12-10'`) con `split('-')`, sin `Date`.

`asignar(tenantId, dto)` — `db.transaccion`: `exigirActivo`, `abrirOTomarHoja`, luego
`SELECT … FROM paquetes WHERE tenant_id = $1 AND paquete_id = ANY($2) AND eliminado_el IS NULL ORDER BY paquete_id FOR UPDATE`
(404 si falta alguno); una consulta trae las líneas vivas `en_ruta|entregado` de todos (`= ANY`);
si alguno no está disponible → `BadRequestException('No se asignó ninguno: ' + códigos y motivo)`;
los `no_entregado` de esta misma hoja se reactivan con un `UPDATE … WHERE hoja_ruta_paquete_id = ANY`,
el resto entra con **un** `INSERT … SELECT unnest($3::uuid[])`. Respuesta `detalle(hoja.id)`.

`detalle(tenantId, hojaId)`: cabecera (`JOIN repartidores`, filtros de borrado) + líneas
(`JOIN paquetes`, `ORDER BY l.creado_el DESC`) + totales (congelados si `rendida`, si no
`this.totales`). 404 si no es del tenant.

Controller `@Controller('hojas-ruta')`: `@Post('escanear') escanear(@Req() req, @Body() dto: EscanearDto)`
y `@Post('asignar')`, **los dos** con `@HttpCode(200)` (no crean un recurso con su propia URL: devuelven la hoja).

Run unit → PASS.

- [ ] **Step 5: E2E** (sumar `describe('Paquetería — escaneo y asignación')`)

```ts
it('código nuevo: asignado_nuevo, nace con el cobro en destino del interruptor', …);
it('código existente disponible con cobro_en_destino=false, escaneado con el interruptor prendido: asignado, y sigue en false', …);
it('el mismo código otra vez en la misma hoja: ya_escaneado, sin línea nueva (asignados no cambia)', …);
it('en ruta con otro repartidor: 409 que nombra al repartidor', …);
it('QR en JSON: el código guardado es el id', …);
it('asignar con uno no disponible: 400 y ninguno asignado', …);
it('repartidor con hojas: DELETE /repartidores/:id da 400 (cierra el pendiente de Task 3)', …);

it('el mismo código nuevo escaneado dos veces a la vez: un paquete, una línea, ningún 500', async () => {
  const codigo = `E2E-CARRERA-${Date.now()}`;
  const ds = app.get(DataSource);
  // compuerta: retener la fila de la hoja (se crea antes con un escaneo de otro código)
  const { respuestas, esperando } = await correrCarrera(
    ds,
    ['SELECT 1 FROM hojas_ruta WHERE hoja_ruta_id = $1 FOR UPDATE', [hojaId]],
    [() => escanear({ codigo }), () => escanear({ codigo })],
  );
  expect(esperando).toBe(2);
  expect(respuestas.map((r) => r.status).sort()).toEqual([200, 200]);
  expect(respuestas.map((r) => (r.body as RespuestaEscaneo).resultado).sort())
    .toEqual(['asignado_nuevo', 'ya_escaneado']);
  const [{ n }] = await ds.query(`SELECT COUNT(*)::int AS n FROM paquetes WHERE codigo = $1`, [codigo]);
  expect(n).toBe(1);
});
```

Si el `esperando` no llega a 2 (la carrera no ocurrió), revisar que ambos escaneos peguen en la
misma hoja (mismo repartidor y fecha): sin eso no esperan en la compuerta (memoria
"control debe ejercitar la línea mutada").

**Mutante obligatorio** (memoria "mutante debe revertir"): cambiar el `ON CONFLICT … DO NOTHING` del
paso 2 por un `INSERT` plano → el test de carrera tiene que ponerse rojo (500 por `23505`).
Revertir y anotar la hora del restart del watcher.

Run: `npm run test:e2e -- paqueteria.e2e-spec` y `npm run test:e2e -- topes-dto.e2e-spec` → PASS.

- [ ] **Step 6: Stage + revisión + commit**: `feat(paqueteria): escanear y asignar paquetes a la hoja de ruta`.

---

### Task 6: Hojas de ruta — marcar, quitar, rendir, lista y KPIs

**Files:**
- Modify: `hojas-ruta.service.ts` (+ spec), `hojas-ruta.controller.ts`, `backend/test/paqueteria.e2e-spec.ts`
- Create: `dto/marcar-linea.dto.ts`, `dto/query-hojas-ruta.dto.ts`

**Interfaces:**
- Consumes: `totales`, `detalle`, `abrirOTomarHoja` (Task 5).
- Produces: rutas `GET /hojas-ruta`, `GET /hojas-ruta/resumen`, `GET /hojas-ruta/:id`, `PATCH /hojas-ruta/:id/paquetes/:paqueteId`, `POST /hojas-ruta/:id/entregar-todos`, `DELETE /hojas-ruta/:id/paquetes/:paqueteId`, `POST /hojas-ruta/:id/rendir`.

- [ ] **Step 1: DTOs**

```ts
export class MarcarLineaDto {
  // en_ruta = deshacer un marcado por error, mientras la hoja está abierta
  @IsIn(['en_ruta', 'entregado', 'no_entregado'])
  estado: EstadoLinea;
}

export class QueryHojasRutaDto {
  @EsFechaPura() desde: string;
  @EsFechaPura() hasta: string;
  @IsOptional() @IsUUID() repartidorId?: string;
}
```

`desde > hasta` → 400 en el service (`'El rango de fechas está invertido.'`).

- [ ] **Step 2: Failing unit tests**

```ts
it('marcar en una hoja rendida: 400', …);
it('marcar entregado un paquete que tiene otra línea viva en_ruta/entregado en otra hoja: 409', …);
it('quitar una línea entregada: 400 (solo se quita lo que está en ruta)', …);
it('rendir con líneas en ruta: 400 que dice cuántas', …);
it('rendir una hoja vacía: 400', …);
it('rendir una hoja ya rendida: 400 "ya está rendida"', …);
it('rendir congela los totales de this.totales y anota rendida_por con el usuario del token', …);
```

Run → FAIL.

- [ ] **Step 3: Implementación**

Toda escritura: `db.transaccion` → hoja `FOR UPDATE` (404 si no es del tenant; 400
`'La hoja ya está rendida: no se puede modificar.'` si `rendida`) → recién ahí las líneas.

- `marcar(tenantId, hojaId, paqueteId, estado)`: la línea viva de ese paquete en esa hoja (404 si no está); si el estado nuevo es `en_ruta` o `entregado`, `SELECT … FROM paquetes WHERE paquete_id = $1 FOR UPDATE` y verificar que **no** haya otra línea viva `en_ruta|entregado` del paquete en otra hoja → si la hay, `ConflictException('El paquete X ya salió con Y: no se puede marcar acá.')`; `UPDATE`. El `23505` del índice único (dos `en_ruta`) se traduce también a 409. Respuesta: `detalle`.
- `entregarTodos`: `UPDATE hoja_ruta_paquetes SET estado = 'entregado' WHERE hoja_ruta_id = $1 AND estado = 'en_ruta' AND eliminado_el IS NULL`; respuesta `detalle`.
- `quitar`: solo con la línea `en_ruta` (si no, 400 `'Solo se quita un paquete que sigue en ruta.'`); `UPDATE … SET eliminado_el = now()`; respuesta `detalle`.
- `rendir(tenantId, hojaId, usuarioId)`: hoja `FOR UPDATE`; `t = (await this.totales(...)).get(hojaId)`; `t.asignados === 0` → 400 `'La hoja no tiene paquetes.'`; `t.enRuta > 0` → 400 `` `Quedan ${t.enRuta} paquetes en ruta: marcalos entregados o no entregados antes de rendir.` ``; `UPDATE hojas_ruta SET estado='rendida', rendida_por=$, rendida_el=now(), total_asignados=…, total_entregados=…, total_cobro_destino=…, monto_cobrado_destino=…, monto_pago_repartidor=…, monto_total_general=…, neto_a_rendir=… WHERE hoja_ruta_id = $1`. Respuesta `detalle`.
- `lista(tenantId, q)`: hojas del rango (`h.fecha BETWEEN $2 AND $3`, `fecha` es `date`: comparación directa, sin `rango-fecha.util` ni `CURRENT_DATE`), `JOIN repartidores`, `ORDER BY h.fecha DESC, r.nombre`; totales: congelados para las rendidas y `this.totales(tenantId, idsAbiertas)` para las abiertas — **dos** consultas en total, nunca una por hoja.
- `resumen(tenantId, q)`: la suma de lo anterior sobre el rango (`Decimal` sobre los strings) → `ResumenPaqueteria`.
- Controller: rutas estáticas (`resumen`, `escanear`, `asignar`) **antes** de `:id`; `@Get(':id')` con `ParseUUIDPipe`; `@Patch(':id/paquetes/:paqueteId')` con `ParseUUIDPipe` en los dos; `rendir` toma `usuarioId` de `(req.user as JwtUser).id`; `@HttpCode(200)` en los `POST` que no crean.

Run unit → PASS.

- [ ] **Step 4: E2E** — el flujo del ejemplo del owner, entero, con montos que discriminan (memoria "el valor del fixture decide"):

```ts
it('10 con cobro en destino a 10.000 y pago 5.000: el repartidor entrega 50.000', async () => {
  // repartidor propio; 10 escaneos con cobroEnDestino: true; 2 pagados (sin cobro) a 7.000 / 3.000
  // marcar: los 10 + 1 pagado entregados, 1 pagado no_entregado
  // totales esperados:
  //   asignados 12 · entregados 11 · cobroDestino 10
  //   montoCobradoDestino 100000 · montoPagoRepartidor 53000 (10×5000 + 3000)
  //   montoTotalGeneral 107000 (10×10000 + 7000) · netoARendir 47000
});

it('rendir: congela; GET /hojas-ruta y GET /:id devuelven lo mismo; editar el monto de un entregado da 400', …);
it('rendir dos veces a la vez: una 200 y otra 400, totales sin cambio', async () => { /* correrCarrera sobre la hoja, Review Focus 4 */ });
it('neto negativo: 1 entregado sin cobro en destino → netoARendir = -5000', …);
it('no entregado ayer, entregado hoy con otro repartidor: la hoja de ayer no lo suma, el resumen cuenta 1 entrega', …); // Review Focus 5
it('marcar en hoja rendida: 400; quitar un entregado: 400; asignar a la fecha rendida: 400', …);
it('resumen: el rango invertido es 400; fecha 2026-02-31 es 400', …);
```

**Mutante obligatorio**: sacar `AND p.cobro_en_destino` de `monto_cobrado_destino` → el test del
ejemplo del owner se pone rojo (el cobrado pasa a 107000). Revertir.

Run: `npm run test:e2e -- paqueteria.e2e-spec` → PASS.

- [ ] **Step 5: Stage + revisión + commit**: `feat(paqueteria): marcar, rendir y KPIs de las hojas de ruta`.

---

### Task 7: Tenant demo "Demo Gestión de Paquetes" y el módulo como contrato

**Files:**
- Modify: `backend/src/modules/seeder/seeder.service.ts`, `backend/src/modules/seeder/seeder.module.ts`
- Modify (si el conteo cambia): los e2e que afirman cuántos tenants hay (ver Step 5)

**Interfaces:**
- Produces: `modulos_app` **"Paquetería"** con un único permiso `Leer` (es la **marca de contratado**
  que lee el menú, Task 8; el backend sigue con `TenantAdminGuard` y no lo consulta); tenant
  **Demo Gestión de Paquetes** que contrata **solo** Paquetería; usuario `admin@paquetes.cl` /
  `admin`, admin (rol fijo) de ese tenant y de ningún otro, **no superadmin**. *Demo Restaurante*
  también contrata Paquetería (ahí corren los e2e y el Playwright).

Decisión del owner (2026-10-15): el cliente entra con un admin propio a un tenant que tiene solo
este módulo; sin permisos por rol.

- [ ] **Step 1: Medir el rango de IDs** con los cuatro pasos de `docs/patterns/backend.md` § 8
  (grep de literales **y** de generadores `const uuid = `, contra el código, no contra `docs/`).
  Hacen falta: tenant, provincia no (se usa la de Santiago `…440001`), usuario, rol admin, módulo,
  su `modulo_app_permiso`, dos `tenant_modulos`, local, caja virtual, fórmula de precio,
  `tenant_moneda`, configuración, 3 repartidores, ~30 paquetes, 3 hojas y sus líneas. Anotar el
  rango elegido en un comentario arriba de `seedPaqueteria()`.

- [ ] **Step 2: El tenant y su admin.** El tenant del seed no pasa por `TenantsService.create`
  (se inserta directo), así que se le siembra **a mano lo mismo que ese `create` le da a todo
  tenant nuevo** — leer `tenants.service.ts → create()` y replicar cada pieza en el método del
  seeder donde ya la reciben los otros dos tenants:
  - `seedTenants`: `{ nombre: 'Demo Gestión de Paquetes', provinciaId: '…440001', correo: 'contacto@paquetes.cl', … }`;
  - `seedTenantMonedas` (CLP), `seedUbicaciones` (el local), `seedCajasVirtuales`, `seedTenantFormulaPrecio`;
  - `seedUsuariosAdicionales`: `admin@paquetes.cl`, contraseña `admin` hasheada igual que los demás, `esSuperadmin: false`;
  - `seedUsuariosTenants`: el par `[ADMIN_PAQUETES, PAQUETES]` — **`admin@sistema.com` no entra** a este tenant (no cambia la cantidad de tenants que ven sus suites);
  - `seedRolesUsuarios`: rol `Administrador` (`es_fijo`) del tenant y su asignación.
  Si `create()` siembra algo más que no esté en esa lista, se suma igual; si alguna pieza no
  aplica a un tenant sin ventas, se deja escrito el porqué al lado.

- [ ] **Step 3: El módulo como contrato.**
  - `seedModulosApp`: `{ nombre: 'Paquetería', url: '/paquetes', icono: 'mdi-package-variant', tieneConfiguracion: true }`;
  - `seedModuloAppPermisos`: solo `Leer`;
  - `seedTenantModulo`: Paquetería para **Demo Gestión de Paquetes** (único módulo) y para **Demo
    Restaurante**, con el mismo `estado`/`expiraEn` que las filas vecinas. *Demo Bodega* **no**:
    queda como el tenant donde el menú no lo muestra (lo usa el spec de Task 8).

- [ ] **Step 4: `seedPaqueteria()`** idempotente (upsert por ID fijo), en el tenant **Demo Gestión
  de Paquetes**, llamado en `onApplicationBootstrap` después de los métodos de arriba:
  - configuración `10000` / `5000`;
  - 3 repartidores ("Juan Pérez", "María Soto", "Pedro Rojas");
  - 30 paquetes con códigos de 11 dígitos que empiezan con `46`, ~⅓ con cobro en destino, la
    mitad con dirección y comuna;
  - dos hojas rendidas en días anteriores y una abierta en el día del negocio de hoy con 5
    paquetes en ruta. Los totales congelados de las rendidas se escriben con un
    `UPDATE hojas_ruta … FROM (<la consulta de totales de Task 5>)`, no a mano.
  - El "hoy" sale del mismo cálculo que `GET /tenants/me` usa para `diaNegocioHoy`
    (`grep -n "diaNegocioHoy" backend/src/modules/tenants/tenants.service.ts`); las fechas
    anteriores se restan sobre ese string. **Nada de `CURRENT_DATE`** (lo rechaza
    `dia-negocio.invariant.spec.ts`).
  - En *Demo Restaurante* solo la configuración `10000` / `5000` (la que el e2e de Task 3 deja
    igual): sin paquetes ni repartidores, los specs crean los suyos.
  - Registrar las entities en `seeder.module.ts` si el seeder usa repos.

- [ ] **Step 5: Lo que el tenant nuevo puede romper.** Buscar los e2e que cuentan tenants o
  iteran todos (`grep -rn "admin/tenants" backend/test frontend/e2e`, y los que afirman un
  `toHaveLength` sobre tenants o usuarios). Medir cuáles cambian corriendo esas suites; ajustar el
  número esperado **con el porqué** al lado (un tenant demo más), nunca relajar la aserción.

- [ ] **Step 6: Verificar**: `./scripts/reset-db.sh` → `Seed complete` una vez; login de
  `admin@paquetes.cl` → `switch-tenant` al tenant nuevo → `GET /rbac/mis-permisos` devuelve
  **exactamente** `["Paquetería:Leer"]`; `GET /hojas-ruta?desde=<hace 7 días>&hasta=<hoy>`
  devuelve 3 hojas; reiniciar el backend no duplica filas (contar antes y después). Después
  `npm run test:e2e` **entero** (el seed toca lo que leen todas las suites).

- [ ] **Step 7: Stage + revisión + commit**: `feat(paqueteria): tenant demo de gestión de paquetes`.

---

### Task 8: Frontend — menú, tipos y configuración

**Files:**
- Create: `frontend/app/types/paqueteria.ts` (el bloque de **Contratos**, con `export`), `frontend/app/composables/usePaqueteria.ts`, `frontend/app/pages/configuracion/repartidores.vue`, `frontend/app/pages/configuracion/paqueteria.vue`
- Modify: `frontend/app/composables/useMenuLateral.ts` (+ `useMenuLateral.nuxt.spec.ts`), `frontend/app/pages/configuracion.vue` (+ `configuracion.nuxt.spec.ts`)

Antes de escribir: skill `nuxt-ui`; leer `docs/patterns/frontend.md` § 1, 2, 5, 7, 8 y `pages/configuracion/categorias.vue` (CRUD con `components/crud/`).

**Interfaces:**
- Produces: `usePaqueteria()` → `{ rotuloEstadoPaquete(e: EstadoPaquete): string, colorEstadoPaquete(e): 'neutral'|'info'|'success', rotuloEstadoLinea(e: EstadoLinea): string, colorEstadoLinea(e): 'info'|'success'|'warning', textoNeto(nombre: string, neto: string): string }`. `textoNeto('Juan', '50000')` → `'Juan entrega $50.000'`; con neto negativo → `'Se le pagan $5.000 a Juan'`; con `'0'` → `'Juan no entrega ni recibe plata'`. Formatea con `useCurrency().formatMonto` (oficial) y compara con `Decimal`, nunca `Number`.

- [ ] **Step 1: Failing tests**
  - `useMenuLateral.nuxt.spec.ts`: con `permisos: ['Paquetería:Leer']` y `esAdmin: true` el menú es **Inicio + Paquetería** (*Escanear* `/paquetes/escanear`, *Paquetes* `/paquetes`, *Rutas* `/paquetes/rutas`, en ese orden) y nada más; un admin **sin** `Paquetería:Leer` en sus permisos no ve el grupo (ni ningún módulo que no esté en sus permisos: es el caso que cambia); el superadmin ve todo. Ajustar los casos existentes del spec que daban por hecho el cortocircuito de `esAdmin` —cada uno con el porqué—, sin borrar la aserción.
  - `configuracion.nuxt.spec.ts`: grupo **Paquetería** con *Repartidores* y *Valores por defecto*, solo admin.
  - `usePaqueteria.spec.ts`: los tres casos de `textoNeto` con montos en CLP.

Run: `cd frontend && npx vitest run app/composables/useMenuLateral.nuxt.spec.ts app/pages/configuracion.nuxt.spec.ts app/composables/usePaqueteria.spec.ts` → FAIL.

- [ ] **Step 2: Implementación**

`useMenuLateral.ts` — dos cambios:

1. **El admin ve solo los módulos contratados** (decisión del owner, 2026-10-15). Para el admin,
   `GET /rbac/mis-permisos` ya devuelve todos los permisos de los módulos que el tenant contrató
   (`rbac.service.ts → getMisPermisos`, rama del rol fijo), así que alcanza con dejar de
   cortocircuitar por `esAdmin`:

   ```ts
   function puede(modulo: string, permiso: string) {
     // El admin ve lo que su tenant contrató: `mis-permisos` ya le trae todos los permisos de esos
     // módulos. Antes se cortocircuitaba con `esAdmin` y el menú le mostraba módulos que el backend
     // le contesta con 403 (`userHasPermiso` mira `tenant_modulos` también para el admin).
     return permissionsStore.can(modulo, permiso)
   }
   ```

   El superadmin sigue viendo todo (`can` le da `true`). Antes de cambiarlo, medir qué módulos
   contrata *Demo Restaurante* (`SELECT ma.nombre FROM tenant_modulos tm JOIN modulos_app ma …`)
   y listar qué links pierde `admin.paris@paris.cl`: si pierde alguno, es porque hoy lo lleva a un
   403. Anotarlo en el commit.

2. Grupo nuevo, después de Compras:

   ```ts
   menu.push(...grupo('paqueteria', 'Paquetería', 'i-lucide-package', [
     // El backend es admin-only (TenantAdminGuard); `Paquetería:Leer` es solo la marca de que el
     // tenant lo contrató, y en `mis-permisos` solo la tiene el admin.
     puede('Paquetería', 'Leer') && { label: 'Escanear', icon: 'i-lucide-scan-barcode', to: '/paquetes/escanear' },
     puede('Paquetería', 'Leer') && { label: 'Paquetes', icon: 'i-lucide-package', to: '/paquetes' },
     puede('Paquetería', 'Leer') && { label: 'Rutas', icon: 'i-lucide-route', to: '/paquetes/rutas' },
   ]))
   ```

Corregir de paso el comentario de `rbac.service.ts` que afirma que el frontend ya filtraba por
`getMisPermisos`: con este cambio pasa a ser cierto; dejarlo describiendo el estado real.

`configuracion.vue`, grupo nuevo después de "Restaurante":

```ts
{
  label: 'Paquetería',
  items: [
    admin && { label: 'Repartidores', icon: 'i-lucide-bike', to: '/configuracion/repartidores' },
    admin && { label: 'Valores por defecto', icon: 'i-lucide-badge-dollar-sign', to: '/configuracion/paqueteria' },
  ],
},
```

`configuracion/paqueteria.vue`: formulario con dos `MoneyInput oficial` (`form.precioEnvioDefecto`,
`form.pagoRepartidorDefecto`, strings), carga con `GET /paquetes/configuracion`, guarda con `PUT`
(los dos campos siempre), toast de éxito o el `e.data.message`. Un `UAlert` informativo si
`configurada === false`: *"Hasta que guardes estos valores no se pueden escanear paquetes nuevos."*

`configuracion/repartidores.vue`: CRUD con `CrudPageHeader` + lista; drawer con nombre y
teléfono; `USwitch` de activo con el patrón optimista + revert (frontend.md § 3); eliminar con
modal de confirmación que muestra el 400 del backend si tiene hojas (*"tiene hojas de ruta;
desactivalo"*). Respuestas mergeadas en la lista, sin refetch (frontend.md § 5).

Run → PASS. Además `cd frontend && npm run typecheck:ratchet && npm run design:check`.

- [ ] **Step 3: Stage + revisión + commit**: `feat(paqueteria): menú y configuración de repartidores y defaults`.

---

### Task 9: Frontend — Paquetes

**Files:**
- Create: `frontend/app/pages/paquetes/index.vue` (+ `index.nuxt.spec.ts`)

**Interfaces:**
- Consumes: `usePaginatedList` (frontend.md § 12), `usePaqueteria`, tipos de `types/paqueteria.ts`, `hoyLocal` (`composables/useVigenciaRegla.ts`), `useDiaNegocio`.

- [ ] **Step 1: Failing spec** (`index.nuxt.spec.ts`, mockeando `useApiFetch` como los specs de página vecinos):
  - con `configurada: false` el botón *Nuevo paquete* abre el drawer con los montos vacíos y el aviso;
  - tildar dos paquetes **disponibles** habilita *Asignar a repartidor*; uno `en_ruta` no se puede tildar;
  - el modal de asignar manda `POST /hojas-ruta/asignar` con `{ repartidorId, fecha, paqueteIds }` y la fecha por defecto es `diaNegocioHoy` (o `hoyLocal()` si no cargó);
  - el selector de repartidor solo ofrece activos.

- [ ] **Step 2: Implementación**
  - `definePageMeta({ middleware: ['auth', 'admin'], layout: 'dashboard' })`, `UDashboardPanel` + `AppNavbar title="Paquetes"`.
  - Filtros: búsqueda (`q`, con debounce), `USelectMenu` de estado, `USelectMenu` de cobro en destino (Todos / Sí / No), `UCheckbox` *Datos por completar* → `listFilters` computado.
  - `UTable` paginada: selección, código, destinatario + dirección (o el badge *Por completar*), cobro en destino, precio envío, pago repartidor, estado (`UBadge` con `colorEstadoPaquete`) y repartidor, acciones (editar; borrar solo si `estado === 'disponible'`).
  - Drawer alta/edición: código, destinatario, teléfono, dirección, comuna, nota, remitente (`USelectMenu` de terceros activos, `GET /terceros` como ya hace la pantalla de compras), `USwitch` cobro en destino, dos `MoneyInput oficial` precargados con los defaults en el alta. Con `bloqueado`, los montos y el switch van `disabled` con la nota *"Ya se rindió: los montos no se pueden cambiar."* (el backend igual lo rechaza).
  - Modal *Asignar a repartidor*: repartidor (activos), `AppDateInput` (default día del negocio), resumen *"Vas a asignar N paquetes a Juan para el 15-10"*. Tras el 200, `toast` + refetch del listado (cambian N estados a la vez: acá el refetch es lo correcto).

Run spec → PASS; `npm run typecheck:ratchet && npm run design:check`.

- [ ] **Step 3: Stage + revisión + commit**: `feat(paqueteria): pantalla de paquetes con alta y asignación masiva`.

---

### Task 10: Frontend — Escanear

**Files:**
- Create: `frontend/app/composables/useColaEscaneo.ts` (+ `useColaEscaneo.spec.ts`), `frontend/app/pages/paquetes/escanear.vue` (+ `escanear.nuxt.spec.ts`)

**Interfaces:**
- Produces: `useColaEscaneo(enviar: (codigo: string) => Promise<void>)` → `{ encolar(codigo: string): void, pendientes: Ref<number>, procesando: Ref<boolean> }`. Procesa **de a uno, en el orden de llegada**; un fallo de `enviar` no frena la cola (el que falló ya mostró su error y se sigue con el próximo). Sin reintento automático (memoria del owner).

- [ ] **Step 1: Failing test** (`useColaEscaneo.spec.ts`, Review Focus 1)

```ts
import { describe, it, expect } from 'vitest'
import { useColaEscaneo } from './useColaEscaneo'

describe('useColaEscaneo', () => {
  it('diez códigos encolados de golpe se envían en orden, uno a la vez', async () => {
    const enviados: string[] = []
    let enVuelo = 0
    let maxEnVuelo = 0
    const cola = useColaEscaneo(async (c) => {
      enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo)
      await new Promise((r) => setTimeout(r, 5))
      enviados.push(c); enVuelo--
    })
    const codigos = Array.from({ length: 10 }, (_, i) => `C${i}`)
    codigos.forEach((c) => cola.encolar(c))
    await vi.waitFor(() => expect(enviados).toHaveLength(10))
    expect(enviados).toEqual(codigos)
    expect(maxEnVuelo).toBe(1)
    expect(cola.pendientes.value).toBe(0)
  })

  it('un envío que falla no frena a los siguientes', async () => {
    const enviados: string[] = []
    const cola = useColaEscaneo(async (c) => {
      if (c === 'B') throw new Error('409')
      enviados.push(c)
    })
    ;['A', 'B', 'C'].forEach((c) => cola.encolar(c))
    await vi.waitFor(() => expect(enviados).toEqual(['A', 'C']))
  })

  it('un código vacío o de solo espacios no se encola', () => {
    const cola = useColaEscaneo(async () => {})
    cola.encolar('   ')
    expect(cola.pendientes.value).toBe(0)
  })
})
```

Run: `cd frontend && npx vitest run app/composables/useColaEscaneo.spec.ts` → FAIL.

- [ ] **Step 2: Implementación de la cola**

```ts
export function useColaEscaneo(enviar: (codigo: string) => Promise<void>) {
  const cola: string[] = []
  const pendientes = ref(0)
  const procesando = ref(false)

  async function drenar() {
    if (procesando.value) return
    procesando.value = true
    try {
      while (cola.length) {
        const codigo = cola.shift()!
        pendientes.value = cola.length
        try {
          await enviar(codigo)
        } catch {
          // El que falló ya mostró su error en `enviar`; la pistola sigue (sin reintento automático).
        }
      }
    } finally {
      procesando.value = false
      pendientes.value = 0
    }
  }

  function encolar(codigo: string) {
    if (!codigo.trim()) return
    cola.push(codigo)
    pendientes.value = cola.length
    void drenar()
  }

  return { encolar, pendientes, procesando }
}
```

Run → PASS.

- [ ] **Step 3: Failing spec de la página** (`escanear.nuxt.spec.ts`):
  - sin repartidor elegido, el campo está deshabilitado y dice *"Elegí un repartidor"*;
  - escribir `461` + Enter manda `POST /hojas-ruta/escanear` con `{ repartidorId, fecha, codigo: '461', cobroEnDestino: false }` y limpia el campo;
  - respuesta `asignado_nuevo` → banner verde *"461 · nuevo, asignado"*; `ya_escaneado` → amarillo; un 409 → rojo con el `message`;
  - con el interruptor prendido el body lleva `cobroEnDestino: true`;
  - el campo recupera el foco después de cada respuesta y después de un clic en el interruptor.

- [ ] **Step 4: Implementación de la página**
  - `definePageMeta({ middleware: ['auth', 'admin'], layout: 'dashboard' })`; `AppNavbar title="Escanear"`.
  - Arriba: `USelectMenu` de repartidores activos, `AppDateInput` (default `diaNegocioHoy ?? hoyLocal()`), `USwitch` *Cobro en destino* (`cobroEnDestino` ref, persiste entre escaneos).
  - El campo: `UInput` con `ref="campo"`, `autofocus`, `@keydown.enter.prevent="alEnter"`; `alEnter` toma el valor, lo limpia y `cola.encolar(valor)`. Recuperar el foco con `nextTick(() => campo.value?.inputRef?.focus())` tras cada respuesta y en un `@click` del contenedor (salvo que el clic sea dentro de otro control).
  - `enviar(codigo)`: `useApiFetch<RespuestaEscaneo>(…/hojas-ruta/escanear, { method: 'POST', body })` → `ultimo = { tipo, texto }` y `hoja = r.hoja`. En el `catch`, `ultimo = { tipo: 'error', texto: e.data.message }` y **relanza** (para que la cola lo cuente como fallido).
  - Banner grande (`UAlert` con `color` success / warning / error y `size` grande) con el último resultado; debajo `pendientes > 0` → *"Procesando N…"*.
  - Totales en vivo de `hoja` (asignados, cobro en destino, neto con `textoNeto`) y la lista de `hoja.lineas` con su interruptor de cobro en destino (`PATCH /paquetes/:id { cobroEnDestino }`, optimista + revert, frontend.md § 3; deshabilitado si la línea no está en ruta) y *Quitar* (`DELETE /hojas-ruta/:id/paquetes/:paqueteId`, respuesta = hoja nueva).
  - Al cambiar repartidor o fecha: si ya existe la hoja de ese día, cargarla (`GET /hojas-ruta?desde=f&hasta=f&repartidorId=r` → id → `GET /hojas-ruta/:id`); si no, lista vacía.

Run → PASS; `npm run typecheck:ratchet && npm run design:check`.

**Textos que fija el Playwright (Task 12)** — si cambian, cambian los dos en el mismo commit:
placeholder del selector de repartidor `Elegí un repartidor`; placeholder del campo
`Escaneá o tipeá el código`; label del switch `Cobro en destino`; contador `N asignados`.

- [ ] **Step 5: Stage + revisión + commit**: `feat(paqueteria): pantalla de escaneo con pistola`.

---

### Task 11: Frontend — Rutas y detalle de hoja

**Files:**
- Create: `frontend/app/pages/paquetes/rutas/index.vue` (+ spec), `frontend/app/pages/paquetes/rutas/[id].vue` (+ spec)

- [ ] **Step 1: Failing specs**
  - Rutas: el rango por defecto son los últimos 7 días terminando en el día del negocio; las cuatro tarjetas muestran `entregados` (con `asignados` de referencia), cobro en destino (cantidad y monto), total general y total a pagar; cada fila linkea a `/paquetes/rutas/:id`; cambiar el rango recarga `GET /hojas-ruta` y `GET /hojas-ruta/resumen`.
  - Detalle: con líneas en ruta, *Rendir* está deshabilitado con el texto *"Quedan N en ruta"*; *Marcar todos entregados* manda `POST …/entregar-todos`; el modal de rendir dice `textoNeto(...)`; una hoja rendida no muestra acciones y sí *"Rendida el …"*.

- [ ] **Step 2: Implementación**
  - `rutas/index.vue`: `AppRangoFechas v-model:desde v-model:hasta qa="rutas-rango"`; cuatro `UCard` de KPI (montos con `formatMonto`); `UTable` con repartidor, fecha (`dd-mm`), asignados, entregados, cobro en destino, neto (en rojo/`error` si es negativo: *"Se le pagan"*), estado (`UBadge`).
  - `rutas/[id].vue`: cabecera con los totales y el **neto destacado**; lista de líneas con `UButtonGroup` *Entregado* / *No entregado* (y *En ruta* para deshacer) → `PATCH`; *Quitar* solo en `en_ruta`; *Marcar todos entregados*; *Rendir* → `UModal` de confirmación con `textoNeto` → `POST …/rendir`. Cada respuesta del backend es la hoja entera: se reemplaza `hoja.value` sin otro GET.

Run → PASS; `npm run typecheck:ratchet && npm run design:check`.

**Textos que fija el Playwright (Task 12):** link de la fila = nombre del repartidor; botones
`Marcar todos entregados` y `Rendir` (el de la cabecera y el del modal); en la hoja rendida,
`Rendida el <fecha>`.

- [ ] **Step 3: Stage + revisión + commit**: `feat(paqueteria): rutas con KPIs y rendición de la hoja`.

---

### Task 12: Playwright — el flujo en el navegador

**Files:**
- Create: `frontend/e2e/paqueteria/paqueteria.spec.ts`

Leer antes: `frontend/e2e/inicio/dashboard.spec.ts` (forma de un spec con la sesión del admin
del seed y helpers de `support/api.ts`). `USelectMenu` es un **button**, no un combobox (memoria
"USelectMenu en Playwright es button"); textos exactos con `getByText`, nunca un RegExp armado
con texto de la UI.

- [ ] **Step 1: El spec**

```ts
import { test, expect } from '../support/sesion'
import { TENANTS, api, tokenDe } from '../support/api'
// `entrarComo`: copiar el de `inicio/dashboard.spec.ts` (segunda copia; se extrae a la tercera)

test.describe('Paquetería', () => {
  test('escanear con la pistola, marcar y rendir: el repartidor entrega lo cobrado menos su pago', async ({ page, request }) => {
    const token = await tokenDe(request, TENANTS.restaurante)
    const nombre = `E2E Repartidor ${Date.now()}`
    await api(request, 'post', '/repartidores', { token, data: { nombre } })

    await page.goto('/paquetes/escanear')
    await page.getByRole('button', { name: 'Elegí un repartidor' }).click()
    await page.getByRole('option', { name: nombre }).click()
    await page.getByLabel('Cobro en destino').check()

    const campo = page.getByPlaceholder('Escaneá o tipeá el código')
    const base = Date.now()
    for (let i = 0; i < 3; i++) {
      // La pistola es un teclado: tipea el contenido del QR y aprieta Enter.
      await campo.fill(`{"id":"E2E${base}${i}","sender_id":1}`)
      await campo.press('Enter')
    }
    await expect(page.getByText('3 asignados')).toBeVisible()

    await page.goto('/paquetes/rutas')
    await page.getByRole('link', { name: nombre }).click()
    await page.getByRole('button', { name: 'Marcar todos entregados' }).click()
    await page.getByRole('button', { name: 'Rendir' }).click()
    // 3 × 10.000 cobrados − 3 × 5.000 de pago (defaults del seed)
    await expect(page.getByRole('dialog').getByText(`${nombre} entrega $15.000`)).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Rendir' }).click()
    await expect(page.getByText('Rendida el')).toBeVisible()
  })

  test('el admin del tenant demo ve solo Paquetería en el menú', async ({ browser }) => {
    // Contexto limpio y login por la app con el usuario del seed (Task 7), como `entrarComo` de
    // `inicio/dashboard.spec.ts`. No es superadmin: es el caso real que verá el cliente.
    const page = await entrarComo(browser, 'admin@paquetes.cl')
    const menu = page.getByRole('navigation')
    await expect(menu.getByRole('button', { name: 'Paquetería' })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Punto de venta' })).toHaveCount(0)
    await expect(menu.getByRole('link', { name: 'Mi caja' })).toHaveCount(0)
    await page.goto('/paquetes/rutas')
    await expect(page.getByText('Juan Pérez').first()).toBeVisible()   // hojas del seed
  })
})
```

Ajustar los textos a los que efectivamente quedaron en las pantallas (Tasks 10–11); si alguno
difiere, cambia el spec, no la pantalla.

- [ ] **Step 2: Correrlo** (bloque 🎭 del CLAUDE.md, **con turno** de la orquestadora si hay varias sesiones):

```bash
./scripts/entorno.sh stack
./scripts/reset-db.sh
cd frontend && npx playwright test e2e/paqueteria
```

Expected: PASS.

- [ ] **Step 3: Stage + commit** (spec de `frontend/e2e/`, sin `.vue`): `test(paqueteria): el flujo de escaneo y rendición en el navegador`.

---

### Task 13: Documentación viva y gate de cierre

**Files:**
- Create: `docs/features/paqueteria.md` (desde `docs/features/TEMPLATE.md`)
- Modify: `docs/README.md` (link), `docs/ESTADO.md` (fila ✅ con fecha), `docs/reference/modulos-y-configuraciones.md` (menú lateral y Configuración → Paquetería), `docs/agent/desarrollo-nuevo.md` (fase 2: permisos propios como módulo contratable, login del repartidor, precio por comuna o por repartidor, importar CSV, API de Mercado Libre, contrarreembolso del producto, rendición a una Caja, documento tributario), spec `Status: Implementada` o eliminarla según `docs/superpowers/README.md`.

- [ ] **Step 1: `docs/features/paqueteria.md`**: el porqué y las reglas (spec § 3 resumida), la decisión admin-only y por qué, el supuesto del QR de ML (§ 9) y dónde cambiarlo (`codigo-paquete.ts`), y la regla de que los totales salen de **una** consulta.

- [ ] **Step 2: Gate completo** (CLAUDE.md, ejecutar, no afirmar; cada comando en su propia llamada, mirando el exit code — memoria "exit code, no la última línea"):

```bash
cd backend && npm run lint:check
cd backend && npm run typecheck
cd backend && npm test
cd backend && npm run test:e2e        # entero, ~580 s, en background
cd frontend && npm run build
cd frontend && npm test
cd frontend && npm run typecheck:ratchet
cd frontend && npm run design:check
cd frontend && npm run e2e            # Playwright entero (el diff toca pantallas y API), con turno
```

- [ ] **Step 3: `verify-feature`** completo (incluye la revisión independiente de contexto fresco del diff entero del frente).

- [ ] **Step 4: Stage + commit** de docs: `docs(paqueteria): feature, estado y fase 2`. Push solo con el OK del owner (memoria "push a main despliega en Railway": tras el push, mirar el deployment, porque hay migración nueva).

---

## Decisions / Open questions

- **Ajustes a la spec que hace este plan** (se aplican a la spec en el mismo commit que el plan):
  1. Los totales salen de **una** consulta SQL (no de una función TS más una SQL): se verifican en el e2e de API, no en unitarios, porque el mock de `Db` no ve el SQL.
  2. `hojas_ruta` congela también `monto_total_general` (lo necesita el KPI del rango para las hojas rendidas).
  3. Borrar un paquete: solo si **nunca salió** en una hoja (no "si nunca fue entregado"): un `no_entregado` también es historia de una hoja.
  4. Borrar un repartidor con hojas: 400, se desactiva. Así ninguna lectura necesita la excepción al filtro de borrado.
  5. Reescanear en la misma hoja un paquete `no_entregado` reactiva su línea en vez de crear otra.
  6. `fecha` es `date` elegida en pantalla (default: día del negocio); el filtro es comparación directa, sin `rango-fecha.util`.
  7. Sin configuración guardada, escanear un código nuevo o dar de alta sin montos es 400 (no se crean paquetes a $0).
- **Tenant demo (owner, 2026-10-15):** *Demo Gestión de Paquetes*, con `admin@paquetes.cl` y Paquetería como único módulo contratado (Task 7). El menú del admin pasa a mostrar solo lo contratado (Task 8). El backend **no** exige el contrato (sigue `TenantAdminGuard`): otro tenant podría usar la API sin haberlo contratado; es un borde comercial, anotado para fase 2.
- **Pendiente externo:** confirmar con una etiqueta real qué trae el QR (spec § 9); si no es JSON con `id`, cambia solo `codigo-paquete.ts` y su spec.
