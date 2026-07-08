# Pasarela de Pagos Multi-proveedor (v1 Oneclick) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Approved
**Date:** 2026-07-07
**Owner:** Cesar Matheus
**Spec:** `docs/superpowers/specs/2026-07-07-pasarela-pagos-design.md` (fuente de verdad del diseño)

**Goal:** Módulo `pasarela` independiente en el backend (Transbank Oneclick real + API keys m2m por tenant) + pantalla de administración del tenant.

**Architecture:** Módulo NestJS con el patrón del repo (controller/service/entity/dto) y **regla de frontera**: `modules/pasarela/` solo importa de `common/` y `auth/`; nunca de módulos de negocio. Selección de proveedor vía `ProviderFactory` + interfaz `PaymentProvider`. Tres controllers: admin (JWT+RBAC), api (ApiKeyGuard) y retorno (público).

**Tech Stack:** NestJS + TypeORM + PostgreSQL, Decimal.js, `fetch` nativo (Node 18+, sin axios), crypto nativo (AES-256-GCM, SHA-256), Nuxt 4 + @nuxt/ui v4.

## Global Constraints

- Toda tabla: PK UUID con `type: 'uuid'` explícito (ADR-004), `@CreateDateColumn({ name: 'creado_el' })`, `@UpdateDateColumn({ name: 'actualizado_el' })`, `@DeleteDateColumn({ name: 'eliminado_el' })`; toda lectura filtra soft delete.
- `tenant_id` SIEMPRE del token (JWT o API key), nunca del body.
- Dinero: `numeric` en BD ↦ `string` en JS, Decimal.js para operar, `@IsNumberString()` en DTOs. Nunca `number` nativo.
- Prefijo global de rutas: `/api` (main.ts) — los paths de este plan se escriben SIN el prefijo (Nest lo agrega).
- Errores de negocio: `BadRequestException`/`NotFoundException` con mensaje en español (el frontend los muestra tal cual).
- Frontend: tokens semánticos (`text-muted`, `bg-default`…), nunca Tailwind hardcoded; iconos `i-lucide-*`; llamadas API vía `useApiFetch`.
- Commits directo a `main` (etapa de desarrollo, sin ramas).
- Regla de frontera: nada dentro de `modules/pasarela/` importa de `modules/ventas|pagos|suscripciones|items|...`.
- Verificar cada tarea con: `cd backend && npm test` y `npm run lint` (backend), `cd frontend && npm run build` cuando toque frontend.

---

### Task 1: Entidades + registro + variable de entorno

**Files:**
- Create: `backend/src/modules/pasarela/entities/pasarela.entity.ts`
- Create: `backend/src/modules/pasarela/entities/tenant-pasarela.entity.ts`
- Create: `backend/src/modules/pasarela/entities/pasarela-api-key.entity.ts`
- Create: `backend/src/modules/pasarela/entities/pasarela-inscripcion.entity.ts`
- Create: `backend/src/modules/pasarela/entities/pasarela-medio-pago.entity.ts`
- Create: `backend/src/modules/pasarela/entities/pasarela-orden.entity.ts`
- Create: `backend/src/modules/pasarela/entities/pasarela-transaccion.entity.ts`
- Modify: `backend/src/app.module.ts` (agregar las 7 entities al array `entities`)
- Modify: `.env.example` (agregar `PASARELA_ENCRYPTION_KEY` y `API_PUBLIC_URL`)
- Modify: `startup-pos.sql` (DDL de las 7 tablas al final del archivo)

**Interfaces:**
- Produces: las 7 clases entity con las propiedades exactas listadas abajo. Los services de las tareas siguientes las inyectan vía `@InjectRepository(...)`.
- Nota de diseño: las columnas de credenciales cifradas son `text` (guardan el blob `v1:iv:tag:data`), no `jsonb` — el spec dice "jsonb cifrado" conceptualmente; físicamente un blob cifrado es un string.

- [ ] **Step 1: Crear las 7 entities**

`pasarela.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarelas')
export class Pasarela {
  @PrimaryColumn({ name: 'pasarela_id', type: 'uuid' })
  pasarelaId: string;

  @Column({ unique: true })
  codigo: string; // 'oneclick', 'webpay_plus', ...

  @Column()
  nombre: string;

  @Column({ name: 'soporta_tokenizacion', default: false })
  soportaTokenizacion: boolean;

  @Column({ name: 'soporta_cobro_recurrente', default: false })
  soportaCobroRecurrente: boolean;

  @Column({ name: 'soporta_mall', default: false })
  soportaMall: boolean;

  @Column({ name: 'url_produccion' })
  urlProduccion: string;

  @Column({ name: 'url_pruebas' })
  urlPruebas: string;

  // Blobs cifrados AES-256-GCM ('v1:iv:tag:data') — credenciales mall de la plataforma
  @Column({ name: 'configuracion_produccion', type: 'text', nullable: true })
  configuracionProduccion: string | null;

  @Column({ name: 'configuracion_pruebas', type: 'text', nullable: true })
  configuracionPruebas: string | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
```

`tenant-pasarela.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tenant_pasarela')
export class TenantPasarela {
  @PrimaryGeneratedColumn('uuid', { name: 'tenant_pasarela_id' })
  tenantPasarelaId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'pasarela_id', type: 'uuid' })
  pasarelaId: string;

  @Column()
  ambiente: string; // 'pruebas' | 'produccion'

  @Column({ name: 'modo_integracion' })
  modoIntegracion: string; // 'mall' | 'individual'

  // Blob cifrado — INDIVIDUAL: credenciales completas; MALL: { "commerceCodeHijo": "..." }
  @Column({ type: 'text', nullable: true })
  configuracion: string | null;

  @Column({ default: true })
  activo: boolean;

  @Column({ default: 1 })
  prioridad: number;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
```

`pasarela-api-key.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_api_keys')
export class PasarelaApiKey {
  @PrimaryGeneratedColumn('uuid', { name: 'api_key_id' })
  apiKeyId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column()
  nombre: string; // descriptivo: "app móvil bodega"

  @Column()
  prefijo: string; // visible en UI: 'pk_a1b2c3…'

  @Index({ unique: true })
  @Column({ name: 'key_hash' })
  keyHash: string; // SHA-256 hex de la key completa

  @Column({ name: 'ultimo_uso_el', type: 'timestamptz', nullable: true })
  ultimoUsoEl: Date | null;

  @Column({ name: 'revocada_el', type: 'timestamptz', nullable: true })
  revocadaEl: Date | null;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
```

`pasarela-inscripcion.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_inscripciones')
@Index(['tenantId', 'pagadorRef'])
export class PasarelaInscripcion {
  @PrimaryGeneratedColumn('uuid', { name: 'inscripcion_id' })
  inscripcionId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'tenant_pasarela_id', type: 'uuid' })
  tenantPasarelaId: string;

  @Column({ name: 'pagador_ref', length: 100 })
  pagadorRef: string; // opaco, lo aporta la app consumidora

  // tbkUser cifrado ('v1:iv:tag:data') — con él + commerce code se puede cobrar
  @Column({ name: 'identificador_externo', type: 'text', nullable: true })
  identificadorExterno: string | null;

  // username generado por nosotros ('insc-<uuid sin guiones>'), NUNCA el pagador_ref crudo
  @Column({ name: 'identificador_usuario_externo' })
  identificadorUsuarioExterno: string;

  @Column({ default: 'pendiente' })
  estado: string; // 'pendiente' | 'activa' | 'fallida' | 'eliminada'

  // token temporal del start (correlación del retorno de Webpay)
  @Index()
  @Column({ name: 'token_proveedor', type: 'varchar', nullable: true })
  tokenProveedor: string | null;

  @Column({ name: 'url_retorno_app' })
  urlRetornoApp: string;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
```

`pasarela-medio-pago.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_medios_pago')
export class PasarelaMedioPago {
  @PrimaryGeneratedColumn('uuid', { name: 'medio_pago_id' })
  medioPagoId: string;

  @Column({ name: 'inscripcion_id', type: 'uuid' })
  inscripcionId: string;

  @Column()
  tipo: string; // 'TARJETA_CREDITO' | 'TARJETA_DEBITO' | 'TARJETA' | ...

  @Column({ type: 'varchar', nullable: true })
  marca: string | null; // Visa, Mastercard...

  @Column({ name: 'ultimos_4', length: 4 })
  ultimos4: string;

  @Column({ name: 'fecha_expiracion', type: 'varchar', nullable: true })
  fechaExpiracion: string | null;

  // token por tarjeta cifrado (proveedores tipo Stripe); Oneclick no lo usa
  @Column({ name: 'token_externo', type: 'text', nullable: true })
  tokenExterno: string | null;

  @Column({ default: 'activo' })
  estado: string; // 'activo' | 'eliminado'

  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
```

`pasarela-orden.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_ordenes')
export class PasarelaOrden {
  @PrimaryGeneratedColumn('uuid', { name: 'orden_id' })
  ordenId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'pagador_ref', type: 'varchar', length: 100, nullable: true })
  pagadorRef: string | null;

  @Column({ name: 'referencia_externa', type: 'varchar', nullable: true })
  referenciaExterna: string | null; // correlación de la app: venta_id interno, folio externo...

  @Index({ unique: true })
  @Column({ name: 'codigo_orden' })
  codigoOrden: string; // buyOrder generado por nosotros, ≤26 chars

  @Column()
  descripcion: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  monto: string; // numeric ↦ string, Decimal.js para operar

  @Column({ length: 3 })
  moneda: string; // 'CLP' en v1

  @Column({ default: 'creada' })
  estado: string; // 'creada' | 'en_proceso' | 'pagada' | 'fallida' | 'expirada' | 'reembolsada'

  @Column({ name: 'fecha_expiracion', type: 'timestamptz', nullable: true })
  fechaExpiracion: Date | null;

  @Column()
  origen: string; // 'interno' | 'api'

  @Column({ name: 'api_key_id', type: 'uuid', nullable: true })
  apiKeyId: string | null; // qué llave la creó (trazabilidad)

  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
```

`pasarela-transaccion.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_transacciones')
@Index(['tenantPasarelaId', 'identificadorTransaccionExterno'], {
  unique: true,
  where: '"identificador_transaccion_externo" IS NOT NULL',
})
export class PasarelaTransaccion {
  @PrimaryGeneratedColumn('uuid', { name: 'transaccion_id' })
  transaccionId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'orden_id', type: 'uuid', nullable: true })
  ordenId: string | null; // null para INSCRIPTION

  @Column({ name: 'tenant_pasarela_id', type: 'uuid' })
  tenantPasarelaId: string;

  @Column({ name: 'inscripcion_id', type: 'uuid', nullable: true })
  inscripcionId: string | null;

  @Column({ name: 'medio_pago_id', type: 'uuid', nullable: true })
  medioPagoId: string | null;

  @Column({ name: 'transaccion_padre_id', type: 'uuid', nullable: true })
  transaccionPadreId: string | null; // liga REFUND/REVERSAL a su AUTHORIZATION

  @Column()
  tipo: string; // 'INSCRIPTION' | 'AUTHORIZATION' | 'CAPTURE' | 'REVERSAL' | 'REFUND' | 'RECURRENT_PAYMENT'

  @Column()
  estado: string; // 'iniciada' | 'aprobada' | 'rechazada' | 'error' — inmutable una vez terminal

  @Column({ type: 'numeric', precision: 18, scale: 6, nullable: true })
  monto: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  moneda: string | null;

  @Column({ name: 'codigo_orden', type: 'varchar', nullable: true })
  codigoOrden: string | null;

  @Column({ name: 'codigo_autorizacion', type: 'varchar', nullable: true })
  codigoAutorizacion: string | null;

  @Column({ name: 'identificador_transaccion_externo', type: 'varchar', nullable: true })
  identificadorTransaccionExterno: string | null;

  @Column({ name: 'codigo_respuesta', type: 'varchar', nullable: true })
  codigoRespuesta: string | null;

  @Column({ name: 'tipo_pago', type: 'varchar', nullable: true })
  tipoPago: string | null; // VN, VC, SI... (payment_type_code)

  @Column({ name: 'numero_cuotas', type: 'int', nullable: true })
  numeroCuotas: number | null;

  @Column({ name: 'monto_cuota', type: 'numeric', precision: 18, scale: 6, nullable: true })
  montoCuota: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  request: Record<string, unknown>; // REDACTADO antes de persistir

  @Column({ type: 'jsonb', default: () => `'{}'` })
  response: Record<string, unknown>; // REDACTADO antes de persistir

  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: Record<string, unknown>;

  @Column({ name: 'fecha_transaccion', type: 'timestamptz' })
  fechaTransaccion: Date;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
```

- [ ] **Step 2: Registrar entities en `app.module.ts`**

Agregar los 7 imports junto a los existentes y las 7 clases al final del array `entities` del `TypeOrmModule.forRootAsync` (después de `Suscripcion`):

```typescript
import { Pasarela } from './modules/pasarela/entities/pasarela.entity';
import { TenantPasarela } from './modules/pasarela/entities/tenant-pasarela.entity';
import { PasarelaApiKey } from './modules/pasarela/entities/pasarela-api-key.entity';
import { PasarelaInscripcion } from './modules/pasarela/entities/pasarela-inscripcion.entity';
import { PasarelaMedioPago } from './modules/pasarela/entities/pasarela-medio-pago.entity';
import { PasarelaOrden } from './modules/pasarela/entities/pasarela-orden.entity';
import { PasarelaTransaccion } from './modules/pasarela/entities/pasarela-transaccion.entity';
```

(El `PasarelaModule` se registra en la Task 9, cuando exista.)

- [ ] **Step 3: Variables de entorno**

En `.env.example` agregar al final:

```bash
# Pasarela de pagos
# Clave maestra de cifrado de credenciales (32 bytes base64). Generar con: openssl rand -base64 32
PASARELA_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
# URL pública del backend (para el response_url de Transbank)
API_PUBLIC_URL=http://localhost:3000
```

Copiar esas dos líneas también al `.env` local (avisar al usuario si `.env` no existe).

- [ ] **Step 4: DDL en `startup-pos.sql`**

Agregar al final del archivo:

```sql
-- ============================================================
-- Pasarela de pagos (módulo pasarela)
-- ============================================================

CREATE TABLE pasarelas (
    pasarela_id UUID PRIMARY KEY,
    codigo VARCHAR NOT NULL UNIQUE,
    nombre VARCHAR NOT NULL,
    soporta_tokenizacion BOOLEAN NOT NULL DEFAULT FALSE,
    soporta_cobro_recurrente BOOLEAN NOT NULL DEFAULT FALSE,
    soporta_mall BOOLEAN NOT NULL DEFAULT FALSE,
    url_produccion VARCHAR NOT NULL,
    url_pruebas VARCHAR NOT NULL,
    configuracion_produccion TEXT, -- blob cifrado AES-256-GCM 'v1:iv:tag:data'
    configuracion_pruebas TEXT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);

CREATE TABLE tenant_pasarela (
    tenant_pasarela_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    pasarela_id UUID NOT NULL REFERENCES pasarelas(pasarela_id),
    ambiente VARCHAR NOT NULL, -- 'pruebas' | 'produccion'
    modo_integracion VARCHAR NOT NULL, -- 'mall' | 'individual'
    configuracion TEXT, -- blob cifrado
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    prioridad INTEGER NOT NULL DEFAULT 1,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);

CREATE TABLE pasarela_api_keys (
    api_key_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    nombre VARCHAR NOT NULL,
    prefijo VARCHAR NOT NULL,
    key_hash VARCHAR NOT NULL UNIQUE, -- SHA-256 hex; la key nunca se persiste
    ultimo_uso_el TIMESTAMPTZ,
    revocada_el TIMESTAMPTZ,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);

CREATE TABLE pasarela_inscripciones (
    inscripcion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    tenant_pasarela_id UUID NOT NULL REFERENCES tenant_pasarela(tenant_pasarela_id),
    pagador_ref VARCHAR(100) NOT NULL, -- opaco, lo aporta la app consumidora
    identificador_externo TEXT, -- tbkUser cifrado
    identificador_usuario_externo VARCHAR NOT NULL, -- username generado ('insc-…')
    estado VARCHAR NOT NULL DEFAULT 'pendiente', -- pendiente|activa|fallida|eliminada
    token_proveedor VARCHAR, -- token temporal del start (un solo uso)
    url_retorno_app VARCHAR NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
CREATE INDEX idx_pasarela_inscripciones_pagador ON pasarela_inscripciones (tenant_id, pagador_ref);
CREATE INDEX idx_pasarela_inscripciones_token ON pasarela_inscripciones (token_proveedor);

CREATE TABLE pasarela_medios_pago (
    medio_pago_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inscripcion_id UUID NOT NULL REFERENCES pasarela_inscripciones(inscripcion_id),
    tipo VARCHAR NOT NULL, -- TARJETA_CREDITO | TARJETA_DEBITO | TARJETA | ...
    marca VARCHAR,
    ultimos_4 VARCHAR(4) NOT NULL,
    fecha_expiracion VARCHAR,
    token_externo TEXT, -- cifrado (proveedores con token por tarjeta)
    estado VARCHAR NOT NULL DEFAULT 'activo', -- activo | eliminado
    metadata JSONB NOT NULL DEFAULT '{}',
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);

CREATE TABLE pasarela_ordenes (
    orden_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    pagador_ref VARCHAR(100),
    referencia_externa VARCHAR, -- correlación de la app (venta_id, folio externo…)
    codigo_orden VARCHAR NOT NULL UNIQUE, -- buyOrder generado, ≤26 chars
    descripcion VARCHAR NOT NULL,
    monto NUMERIC(18,6) NOT NULL,
    moneda VARCHAR(3) NOT NULL,
    estado VARCHAR NOT NULL DEFAULT 'creada', -- creada|en_proceso|pagada|fallida|expirada|reembolsada
    fecha_expiracion TIMESTAMPTZ,
    origen VARCHAR NOT NULL, -- 'interno' | 'api'
    api_key_id UUID REFERENCES pasarela_api_keys(api_key_id),
    metadata JSONB NOT NULL DEFAULT '{}',
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);

CREATE TABLE pasarela_transacciones (
    transaccion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
    orden_id UUID REFERENCES pasarela_ordenes(orden_id), -- NULL para INSCRIPTION
    tenant_pasarela_id UUID NOT NULL REFERENCES tenant_pasarela(tenant_pasarela_id),
    inscripcion_id UUID REFERENCES pasarela_inscripciones(inscripcion_id),
    medio_pago_id UUID REFERENCES pasarela_medios_pago(medio_pago_id),
    transaccion_padre_id UUID REFERENCES pasarela_transacciones(transaccion_id),
    tipo VARCHAR NOT NULL, -- INSCRIPTION|AUTHORIZATION|CAPTURE|REVERSAL|REFUND|RECURRENT_PAYMENT
    estado VARCHAR NOT NULL, -- iniciada|aprobada|rechazada|error (inmutable una vez terminal)
    monto NUMERIC(18,6),
    moneda VARCHAR(3),
    codigo_orden VARCHAR,
    codigo_autorizacion VARCHAR,
    identificador_transaccion_externo VARCHAR,
    codigo_respuesta VARCHAR,
    tipo_pago VARCHAR,
    numero_cuotas INTEGER,
    monto_cuota NUMERIC(18,6),
    request JSONB NOT NULL DEFAULT '{}', -- redactado: nunca credenciales/tokens en claro
    response JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    fecha_transaccion TIMESTAMPTZ NOT NULL,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eliminado_el TIMESTAMPTZ
);
-- Idempotencia: una transacción externa no puede registrarse dos veces
CREATE UNIQUE INDEX idx_pasarela_tx_externo
    ON pasarela_transacciones (tenant_pasarela_id, identificador_transaccion_externo)
    WHERE identificador_transaccion_externo IS NOT NULL;
```

- [ ] **Step 5: Verificar compilación y arranque**

Run: `cd backend && npx tsc --noEmit && npm run lint`
Expected: sin errores.

Run: `docker-compose up -d && sleep 20 && docker-compose logs backend | tail -20`
Expected: backend arranca, TypeORM sincroniza las 7 tablas nuevas sin error.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/pasarela/entities backend/src/app.module.ts .env.example startup-pos.sql
git commit -m "feat(pasarela): add gateway entities (7 tables) and encryption env vars"
```

---

### Task 2: CredencialesService (cifrado AES-256-GCM + resolución MALL/INDIVIDUAL)

**Files:**
- Create: `backend/src/modules/pasarela/services/credenciales.service.ts`
- Test: `backend/src/modules/pasarela/services/credenciales.service.spec.ts`

**Interfaces:**
- Consumes: entities de Task 1 (`Pasarela`, `TenantPasarela`).
- Produces:
  - `cifrarTexto(texto: string): string` / `descifrarTexto(blob: string): string`
  - `cifrarJson(obj: Record<string, unknown>): string` / `descifrarJson<T>(blob: string): T`
  - `resolver(tenantPasarela: TenantPasarela, pasarela: Pasarela): Record<string, string>` — credenciales descifradas y mezcladas según modo+ambiente, con `baseUrl` incluida.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// credenciales.service.spec.ts
import { ConfigService } from '@nestjs/config';
import { CredencialesService } from './credenciales.service';
import { Pasarela } from '../entities/pasarela.entity';
import { TenantPasarela } from '../entities/tenant-pasarela.entity';

// 32 bytes en base64 para tests
const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');

function makeService(): CredencialesService {
  const config = { get: jest.fn().mockReturnValue(TEST_KEY) } as unknown as ConfigService;
  return new CredencialesService(config);
}

describe('CredencialesService', () => {
  it('cifra y descifra texto (round-trip)', () => {
    const svc = makeService();
    const blob = svc.cifrarTexto('tbk-user-secreto');
    expect(blob).toMatch(/^v1:/);
    expect(blob).not.toContain('tbk-user-secreto');
    expect(svc.descifrarTexto(blob)).toBe('tbk-user-secreto');
  });

  it('dos cifrados del mismo texto producen blobs distintos (IV aleatorio)', () => {
    const svc = makeService();
    expect(svc.cifrarTexto('x')).not.toBe(svc.cifrarTexto('x'));
  });

  it('rechaza un blob adulterado (auth tag)', () => {
    const svc = makeService();
    const blob = svc.cifrarTexto('secreto');
    const partes = blob.split(':');
    partes[3] = Buffer.from('adulterado!!').toString('base64');
    expect(() => svc.descifrarTexto(partes.join(':'))).toThrow();
  });

  it('lanza si PASARELA_ENCRYPTION_KEY falta o no mide 32 bytes', () => {
    const sinKey = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    expect(() => new CredencialesService(sinKey)).toThrow('PASARELA_ENCRYPTION_KEY');
    const corta = { get: jest.fn().mockReturnValue(Buffer.from('corta').toString('base64')) } as unknown as ConfigService;
    expect(() => new CredencialesService(corta)).toThrow('32 bytes');
  });

  describe('resolver', () => {
    const pasarela = {
      urlPruebas: 'https://webpay3gint.transbank.cl',
      urlProduccion: 'https://webpay3g.transbank.cl',
    } as Pasarela;

    it('MALL: mezcla credenciales de plataforma + commerce code hijo del tenant', () => {
      const svc = makeService();
      const p = {
        ...pasarela,
        configuracionPruebas: svc.cifrarJson({ mallCommerceCode: '597055555541', apiKeySecret: 'S3CR3T' }),
      } as Pasarela;
      const tp = {
        ambiente: 'pruebas',
        modoIntegracion: 'mall',
        configuracion: svc.cifrarJson({ commerceCodeHijo: '597055555542' }),
      } as TenantPasarela;
      expect(svc.resolver(tp, p)).toEqual({
        baseUrl: 'https://webpay3gint.transbank.cl',
        mallCommerceCode: '597055555541',
        apiKeySecret: 'S3CR3T',
        commerceCodeHijo: '597055555542',
      });
    });

    it('INDIVIDUAL: usa solo la configuración del tenant + baseUrl según ambiente', () => {
      const svc = makeService();
      const tp = {
        ambiente: 'produccion',
        modoIntegracion: 'individual',
        configuracion: svc.cifrarJson({
          mallCommerceCode: 'M-TENANT', apiKeySecret: 'K-TENANT', commerceCodeHijo: 'H-TENANT',
        }),
      } as TenantPasarela;
      const resultado = svc.resolver(tp, pasarela);
      expect(resultado.baseUrl).toBe('https://webpay3g.transbank.cl');
      expect(resultado.mallCommerceCode).toBe('M-TENANT');
    });

    it('lanza BadRequest si faltan credenciales', () => {
      const svc = makeService();
      const tp = { ambiente: 'pruebas', modoIntegracion: 'mall', configuracion: null } as TenantPasarela;
      const p = { ...pasarela, configuracionPruebas: null } as Pasarela;
      expect(() => svc.resolver(tp, p)).toThrow('credenciales');
    });
  });
});
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `cd backend && npm test -- credenciales.service`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementación**

```typescript
// credenciales.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Pasarela } from '../entities/pasarela.entity';
import { TenantPasarela } from '../entities/tenant-pasarela.entity';

/**
 * Único punto del módulo que toca cifrado y jsonb de credenciales.
 * Formato del blob: 'v1:<iv b64>:<authTag b64>:<data b64>' (AES-256-GCM).
 */
@Injectable()
export class CredencialesService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('PASARELA_ENCRYPTION_KEY');
    if (!raw) throw new Error('PASARELA_ENCRYPTION_KEY no configurada');
    this.key = Buffer.from(raw, 'base64');
    if (this.key.length !== 32)
      throw new Error('PASARELA_ENCRYPTION_KEY debe ser 32 bytes en base64');
  }

  cifrarTexto(texto: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
  }

  descifrarTexto(blob: string): string {
    const [version, ivB64, tagB64, dataB64] = blob.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64)
      throw new Error('Formato de blob cifrado desconocido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  cifrarJson(obj: Record<string, unknown>): string {
    return this.cifrarTexto(JSON.stringify(obj));
  }

  descifrarJson<T = Record<string, string>>(blob: string): T {
    return JSON.parse(this.descifrarTexto(blob)) as T;
  }

  /**
   * Credenciales listas para el provider según modo + ambiente.
   * MALL: credenciales de la plataforma (pasarelas.configuracion_*) + config del tenant (commerce code hijo).
   * INDIVIDUAL: solo la configuración del tenant.
   */
  resolver(tenantPasarela: TenantPasarela, pasarela: Pasarela): Record<string, string> {
    const baseUrl =
      tenantPasarela.ambiente === 'produccion' ? pasarela.urlProduccion : pasarela.urlPruebas;

    const configTenant = tenantPasarela.configuracion
      ? this.descifrarJson<Record<string, string>>(tenantPasarela.configuracion)
      : {};

    if (tenantPasarela.modoIntegracion === 'individual') {
      if (!tenantPasarela.configuracion)
        throw new BadRequestException('La pasarela no tiene credenciales configuradas');
      return { baseUrl, ...configTenant };
    }

    const blobPlataforma =
      tenantPasarela.ambiente === 'produccion'
        ? pasarela.configuracionProduccion
        : pasarela.configuracionPruebas;
    if (!blobPlataforma)
      throw new BadRequestException(
        'La plataforma no tiene credenciales configuradas para esta pasarela y ambiente',
      );
    const configPlataforma = this.descifrarJson<Record<string, string>>(blobPlataforma);
    return { baseUrl, ...configPlataforma, ...configTenant };
  }
}
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `cd backend && npm test -- credenciales.service`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/pasarela/services/credenciales.service.ts backend/src/modules/pasarela/services/credenciales.service.spec.ts
git commit -m "feat(pasarela): add CredencialesService (AES-256-GCM + resolucion mall/individual)"
```

---

### Task 3: ApiKeysService + ApiKeyGuard

**Files:**
- Create: `backend/src/modules/pasarela/services/api-keys.service.ts`
- Create: `backend/src/modules/pasarela/guards/api-key.guard.ts`
- Test: `backend/src/modules/pasarela/services/api-keys.service.spec.ts`

**Interfaces:**
- Consumes: `PasarelaApiKey` (Task 1).
- Produces:
  - `ApiKeysService.crear(tenantId: string, nombre: string): Promise<{ apiKeyId; nombre; prefijo; apiKey: string }>` — `apiKey` completa SOLO aquí.
  - `ApiKeysService.listar(tenantId: string)` — sin hash ni key.
  - `ApiKeysService.revocar(tenantId: string, apiKeyId: string)`.
  - `ApiKeysService.validar(key: string): Promise<{ tenantId: string; apiKeyId: string } | null>`.
  - `ApiKeyGuard` — pobla `req.pasarelaAuth = { tenantId, apiKeyId }`.
  - Interfaz `PasarelaAuth { tenantId: string; apiKeyId: string }` exportada desde el guard.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// api-keys.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { ApiKeysService } from './api-keys.service';
import { PasarelaApiKey } from '../entities/pasarela-api-key.entity';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  const repo = {
    create: jest.fn((x: Partial<PasarelaApiKey>) => x),
    save: jest.fn((x: Partial<PasarelaApiKey>) =>
      Promise.resolve({ ...x, apiKeyId: 'key-uuid-1' }),
    ),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        { provide: getRepositoryToken(PasarelaApiKey), useValue: repo },
      ],
    }).compile();
    service = module.get(ApiKeysService);
  });

  it('crear: genera key pk_..., guarda solo el hash y expone la key una vez', async () => {
    const res = await service.crear('tenant-1', 'app móvil');
    expect(res.apiKey).toMatch(/^pk_[A-Za-z0-9_-]{40}$/);
    expect(res.prefijo).toBe(res.apiKey.slice(0, 10) + '…');
    const guardado = repo.save.mock.calls[0][0] as Partial<PasarelaApiKey>;
    expect(guardado.keyHash).toBe(createHash('sha256').update(res.apiKey).digest('hex'));
    expect(JSON.stringify(guardado)).not.toContain(res.apiKey);
  });

  it('validar: devuelve tenant para una key activa', async () => {
    repo.findOne.mockResolvedValue({
      apiKeyId: 'key-uuid-1', tenantId: 'tenant-1', revocadaEl: null,
    });
    const res = await service.validar('pk_' + 'a'.repeat(40));
    expect(res).toEqual({ tenantId: 'tenant-1', apiKeyId: 'key-uuid-1' });
    expect(repo.update).toHaveBeenCalled(); // ultimo_uso_el
  });

  it('validar: null para key revocada o inexistente', async () => {
    repo.findOne.mockResolvedValue(null);
    expect(await service.validar('pk_' + 'b'.repeat(40))).toBeNull();
    repo.findOne.mockResolvedValue({ apiKeyId: 'k', tenantId: 't', revocadaEl: new Date() });
    expect(await service.validar('pk_' + 'c'.repeat(40))).toBeNull();
  });

  it('revocar: setea revocada_el; rechaza si no es del tenant', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.revocar('tenant-1', 'ajena')).rejects.toThrow('no encontrada');
  });
});
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `cd backend && npm test -- api-keys.service`
Expected: FAIL.

- [ ] **Step 3: Implementación**

```typescript
// api-keys.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { PasarelaApiKey } from '../entities/pasarela-api-key.entity';

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(PasarelaApiKey)
    private readonly repo: Repository<PasarelaApiKey>,
  ) {}

  async crear(tenantId: string, nombre: string) {
    const apiKey = `pk_${randomBytes(30).toString('base64url')}`; // 'pk_' + 40 chars
    const guardada = await this.repo.save(
      this.repo.create({
        tenantId,
        nombre,
        prefijo: apiKey.slice(0, 10) + '…',
        keyHash: createHash('sha256').update(apiKey).digest('hex'),
      }),
    );
    // La key completa se devuelve SOLO aquí — no vuelve a ser recuperable.
    return { apiKeyId: guardada.apiKeyId, nombre, prefijo: guardada.prefijo, apiKey };
  }

  listar(tenantId: string) {
    return this.repo.find({
      where: { tenantId },
      select: ['apiKeyId', 'nombre', 'prefijo', 'ultimoUsoEl', 'revocadaEl', 'creadoEl'],
      order: { creadoEl: 'DESC' },
    });
  }

  async revocar(tenantId: string, apiKeyId: string) {
    const key = await this.repo.findOne({ where: { apiKeyId, tenantId, revocadaEl: IsNull() } });
    if (!key) throw new NotFoundException('API key no encontrada');
    key.revocadaEl = new Date();
    await this.repo.save(key);
    return { apiKeyId, revocadaEl: key.revocadaEl };
  }

  async validar(key: string): Promise<{ tenantId: string; apiKeyId: string } | null> {
    if (!key.startsWith('pk_')) return null;
    const keyHash = createHash('sha256').update(key).digest('hex');
    const encontrada = await this.repo.findOne({ where: { keyHash } });
    if (!encontrada || encontrada.revocadaEl) return null;
    // fire-and-forget: no bloquear la request por el tracking de uso
    void this.repo.update(encontrada.apiKeyId, { ultimoUsoEl: new Date() });
    return { tenantId: encontrada.tenantId, apiKeyId: encontrada.apiKeyId };
  }
}
```

```typescript
// api-key.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from '../services/api-keys.service';

export interface PasarelaAuth {
  tenantId: string;
  apiKeyId: string;
}

/** Autenticación m2m para /pasarela/api/*: resuelve el tenant desde la API key. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { pasarelaAuth?: PasarelaAuth }>();
    const auth = req.headers.authorization ?? '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!key) throw new UnauthorizedException('API key requerida');
    const resultado = await this.apiKeysService.validar(key);
    if (!resultado) throw new UnauthorizedException('API key inválida o revocada');
    req.pasarelaAuth = resultado;
    return true;
  }
}
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `cd backend && npm test -- api-keys.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/pasarela/services/api-keys.service.ts backend/src/modules/pasarela/services/api-keys.service.spec.ts backend/src/modules/pasarela/guards/api-key.guard.ts
git commit -m "feat(pasarela): add tenant API keys (hashed) and ApiKeyGuard"
```

---

### Task 4: Interfaz PaymentProvider + OneclickProvider + ProviderFactory

**Files:**
- Create: `backend/src/modules/pasarela/providers/payment-provider.interface.ts`
- Create: `backend/src/modules/pasarela/providers/provider.factory.ts`
- Create: `backend/src/modules/pasarela/providers/oneclick/oneclick.provider.ts`
- Test: `backend/src/modules/pasarela/providers/oneclick/oneclick.provider.spec.ts`

**Interfaces:**
- Produces (consumido por Tasks 6–8):

```typescript
// payment-provider.interface.ts — contenido completo
export type CredencialesResueltas = Record<string, string>; // siempre incluye baseUrl

export interface ResultadoProvider {
  aprobada: boolean;
  codigoRespuesta: string | null;
  request: Record<string, unknown>;  // crudo — TransaccionesService lo redacta
  response: Record<string, unknown>;
}

export interface ResultadoInscripcion extends ResultadoProvider {
  identificadorExterno: string | null; // tbkUser en claro (el service lo cifra)
  codigoAutorizacion: string | null;
  tarjeta: { tipo: string; marca: string | null; ultimos4: string } | null;
}

export interface ResultadoCobro extends ResultadoProvider {
  codigoAutorizacion: string | null;
  identificadorTransaccionExterno: string | null;
  tipoPago: string | null;
  numeroCuotas: number | null;
  montoCuota: string | null;
}

export interface ResultadoEstado {
  estado: 'pagada' | 'fallida' | 'desconocido';
  response: Record<string, unknown>;
}

/** Error de red/HTTP contra el proveedor — NO significa rechazo del cobro. */
export class ProviderComunicacionError extends Error {
  constructor(
    message: string,
    public readonly request: Record<string, unknown>,
    public readonly response: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface PaymentProvider {
  iniciarInscripcion(
    cred: CredencialesResueltas,
    p: { username: string; email: string; responseUrl: string },
  ): Promise<{ tokenExterno: string; urlRedireccion: string } & ResultadoProvider>;
  confirmarInscripcion(cred: CredencialesResueltas, token: string): Promise<ResultadoInscripcion>;
  eliminarInscripcion(
    cred: CredencialesResueltas,
    p: { identificadorExterno: string; username: string },
  ): Promise<void>;
  autorizarCobro(
    cred: CredencialesResueltas,
    p: { username: string; identificadorExterno: string; codigoOrden: string; monto: string; moneda: string; cuotas: number },
  ): Promise<ResultadoCobro>;
  reembolsar(
    cred: CredencialesResueltas,
    p: { codigoOrden: string; monto: string },
  ): Promise<ResultadoCobro>;
  consultarEstado(cred: CredencialesResueltas, codigoOrden: string): Promise<ResultadoEstado>;
}
```

- `ProviderFactory.get(codigo: string): PaymentProvider` — lanza `BadRequestException` si el código no está soportado.

- [ ] **Step 1: Escribir el test que falla** (mock de `global.fetch`)

```typescript
// oneclick.provider.spec.ts
import { OneclickProvider } from './oneclick.provider';
import { ProviderComunicacionError } from '../payment-provider.interface';

const cred = {
  baseUrl: 'https://webpay3gint.transbank.cl',
  mallCommerceCode: '597055555541',
  apiKeySecret: 'SECRET',
  commerceCodeHijo: '597055555542',
};

function mockFetch(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe('OneclickProvider', () => {
  const provider = new OneclickProvider();

  it('iniciarInscripcion llama al endpoint con headers Tbk y devuelve token+url', async () => {
    mockFetch(200, { token: 'tok-1', url_webpay: 'https://webpay/init' });
    const res = await provider.iniciarInscripcion(cred, {
      username: 'insc-abc', email: 'a@b.cl', responseUrl: 'http://localhost:3000/api/pasarela/retorno/inscripcion',
    });
    expect(res.tokenExterno).toBe('tok-1');
    expect(res.urlRedireccion).toBe('https://webpay/init');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://webpay3gint.transbank.cl/rswebpaytransaction/api/oneclick/v1.2/inscriptions');
    expect(init.headers['Tbk-Api-Key-Id']).toBe('597055555541');
    expect(init.headers['Tbk-Api-Key-Secret']).toBe('SECRET');
  });

  it('confirmarInscripcion aprobada mapea tbk_user y tarjeta', async () => {
    mockFetch(200, {
      response_code: 0, tbk_user: 'tbk-u-1', authorization_code: '1213',
      card_type: 'Visa', card_number: 'XXXXXXXXXXXX6623',
    });
    const res = await provider.confirmarInscripcion(cred, 'tok-1');
    expect(res.aprobada).toBe(true);
    expect(res.identificadorExterno).toBe('tbk-u-1');
    expect(res.tarjeta).toEqual({ tipo: 'TARJETA', marca: 'Visa', ultimos4: '6623' });
  });

  it('autorizarCobro rechazado (response_code != 0) NO lanza: aprobada=false', async () => {
    mockFetch(200, {
      details: [{ response_code: -1, status: 'FAILED', amount: 5000,
        authorization_code: null, payment_type_code: 'VN', installments_number: 0 }],
    });
    const res = await provider.autorizarCobro(cred, {
      username: 'insc-abc', identificadorExterno: 'tbk-u-1',
      codigoOrden: 'O-1', monto: '5000', moneda: 'CLP', cuotas: 0,
    });
    expect(res.aprobada).toBe(false);
    expect(res.codigoRespuesta).toBe('-1');
  });

  it('autorizarCobro rechaza montos CLP con decimales', async () => {
    await expect(
      provider.autorizarCobro(cred, {
        username: 'u', identificadorExterno: 't', codigoOrden: 'O-2',
        monto: '5000.50', moneda: 'CLP', cuotas: 0,
      }),
    ).rejects.toThrow('CLP no admite decimales');
  });

  it('error de red lanza ProviderComunicacionError (no rechazo)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;
    await expect(
      provider.autorizarCobro(cred, {
        username: 'u', identificadorExterno: 't', codigoOrden: 'O-3',
        monto: '5000', moneda: 'CLP', cuotas: 0,
      }),
    ).rejects.toThrow(ProviderComunicacionError);
  });
});
```

- [ ] **Step 2: Correr el test — debe fallar**

Run: `cd backend && npm test -- oneclick.provider`
Expected: FAIL.

- [ ] **Step 3: Implementación**

Crear `payment-provider.interface.ts` con el contenido exacto del bloque **Interfaces** de esta task, y:

```typescript
// oneclick/oneclick.provider.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  CredencialesResueltas,
  PaymentProvider,
  ProviderComunicacionError,
  ResultadoCobro,
  ResultadoEstado,
  ResultadoInscripcion,
  ResultadoProvider,
} from '../payment-provider.interface';

const BASE_PATH = '/rswebpaytransaction/api/oneclick/v1.2';

@Injectable()
export class OneclickProvider implements PaymentProvider {
  private async request(
    cred: CredencialesResueltas,
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; json: Record<string, unknown>; requestInfo: Record<string, unknown> }> {
    const requestInfo = { method, url: `${cred.baseUrl}${BASE_PATH}${path}`, body: body ?? null };
    let res: Response;
    try {
      res = await fetch(`${cred.baseUrl}${BASE_PATH}${path}`, {
        method,
        headers: {
          'Tbk-Api-Key-Id': cred.mallCommerceCode,
          'Tbk-Api-Key-Secret': cred.apiKeySecret,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new ProviderComunicacionError(
        `Error de comunicación con Transbank: ${(e as Error).message}`,
        requestInfo,
      );
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status >= 500) {
      throw new ProviderComunicacionError(
        `Transbank respondió ${res.status}`, requestInfo, json,
      );
    }
    return { status: res.status, json, requestInfo };
  }

  /** Transbank cobra CLP en enteros: validar y convertir en el borde. */
  private montoEntero(monto: string, moneda: string): number {
    const d = new Decimal(monto);
    if (moneda === 'CLP' && !d.isInteger())
      throw new BadRequestException('CLP no admite decimales en el monto');
    return d.toNumber();
  }

  async iniciarInscripcion(
    cred: CredencialesResueltas,
    p: { username: string; email: string; responseUrl: string },
  ): Promise<{ tokenExterno: string; urlRedireccion: string } & ResultadoProvider> {
    const body = { username: p.username, email: p.email, response_url: p.responseUrl };
    const { json, requestInfo } = await this.request(cred, 'POST', '/inscriptions', body);
    if (!json.token || !json.url_webpay)
      throw new ProviderComunicacionError('Respuesta de inscripción inválida', requestInfo, json);
    return {
      tokenExterno: String(json.token),
      urlRedireccion: String(json.url_webpay),
      aprobada: true,
      codigoRespuesta: null,
      request: requestInfo,
      response: json,
    };
  }

  async confirmarInscripcion(
    cred: CredencialesResueltas,
    token: string,
  ): Promise<ResultadoInscripcion> {
    const { json, requestInfo } = await this.request(
      cred, 'PUT', `/inscriptions/${encodeURIComponent(token)}`,
    );
    const responseCode = json.response_code as number | undefined;
    const aprobada = responseCode === 0 && !!json.tbk_user;
    const cardNumber = typeof json.card_number === 'string' ? json.card_number : '';
    return {
      aprobada,
      codigoRespuesta: responseCode != null ? String(responseCode) : null,
      identificadorExterno: aprobada ? String(json.tbk_user) : null,
      codigoAutorizacion: json.authorization_code ? String(json.authorization_code) : null,
      tarjeta: aprobada
        ? {
            tipo: 'TARJETA',
            marca: json.card_type ? String(json.card_type) : null,
            ultimos4: cardNumber.slice(-4),
          }
        : null,
      request: requestInfo,
      response: json,
    };
  }

  async eliminarInscripcion(
    cred: CredencialesResueltas,
    p: { identificadorExterno: string; username: string },
  ): Promise<void> {
    await this.request(cred, 'DELETE', '/inscriptions', {
      tbk_user: p.identificadorExterno,
      username: p.username,
    });
  }

  async autorizarCobro(
    cred: CredencialesResueltas,
    p: { username: string; identificadorExterno: string; codigoOrden: string; monto: string; moneda: string; cuotas: number },
  ): Promise<ResultadoCobro> {
    const amount = this.montoEntero(p.monto, p.moneda);
    const body = {
      username: p.username,
      tbk_user: p.identificadorExterno,
      buy_order: p.codigoOrden,
      details: [
        {
          commerce_code: cred.commerceCodeHijo,
          buy_order: `${p.codigoOrden}-1`,
          amount,
          installments_number: p.cuotas,
        },
      ],
    };
    const { json, requestInfo } = await this.request(cred, 'POST', '/transactions', body);
    const detalle = (json.details as Record<string, unknown>[] | undefined)?.[0] ?? {};
    const aprobada = detalle.response_code === 0 && detalle.status === 'AUTHORIZED';
    return {
      aprobada,
      codigoRespuesta: detalle.response_code != null ? String(detalle.response_code) : null,
      codigoAutorizacion: detalle.authorization_code ? String(detalle.authorization_code) : null,
      identificadorTransaccionExterno: p.codigoOrden, // Oneclick identifica por buy_order
      tipoPago: detalle.payment_type_code ? String(detalle.payment_type_code) : null,
      numeroCuotas: typeof detalle.installments_number === 'number' ? detalle.installments_number : null,
      montoCuota: detalle.installments_amount != null ? String(detalle.installments_amount) : null,
      request: requestInfo,
      response: json,
    };
  }

  async reembolsar(
    cred: CredencialesResueltas,
    p: { codigoOrden: string; monto: string },
  ): Promise<ResultadoCobro> {
    const body = {
      commerce_code: cred.commerceCodeHijo,
      detail_buy_order: `${p.codigoOrden}-1`,
      amount: this.montoEntero(p.monto, 'CLP'),
    };
    const { json, requestInfo } = await this.request(
      cred, 'POST', `/transactions/${encodeURIComponent(p.codigoOrden)}/refunds`, body,
    );
    // Respuesta OK trae 'type' (REVERSED | NULLIFIED); si viene response_code != 0 es rechazo
    const aprobada = !!json.type;
    return {
      aprobada,
      codigoRespuesta: json.response_code != null ? String(json.response_code) : (aprobada ? '0' : null),
      codigoAutorizacion: json.authorization_code ? String(json.authorization_code) : null,
      identificadorTransaccionExterno: null,
      tipoPago: json.type ? String(json.type) : null,
      numeroCuotas: null,
      montoCuota: null,
      request: requestInfo,
      response: json,
    };
  }

  async consultarEstado(
    cred: CredencialesResueltas,
    codigoOrden: string,
  ): Promise<ResultadoEstado> {
    const { status, json } = await this.request(
      cred, 'GET', `/transactions/${encodeURIComponent(codigoOrden)}`,
    );
    if (status === 404) return { estado: 'fallida', response: json };
    const detalle = (json.details as Record<string, unknown>[] | undefined)?.[0];
    if (!detalle) return { estado: 'desconocido', response: json };
    if (detalle.status === 'AUTHORIZED' || detalle.status === 'CAPTURED')
      return { estado: 'pagada', response: json };
    if (detalle.status === 'FAILED' || detalle.status === 'REVERSED' || detalle.status === 'NULLIFIED')
      return { estado: 'fallida', response: json };
    return { estado: 'desconocido', response: json };
  }
}
```

```typescript
// provider.factory.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface';
import { OneclickProvider } from './oneclick/oneclick.provider';

@Injectable()
export class ProviderFactory {
  constructor(private readonly oneclick: OneclickProvider) {}

  get(codigo: string): PaymentProvider {
    switch (codigo) {
      case 'oneclick':
        return this.oneclick;
      default:
        throw new BadRequestException(`Pasarela no soportada: ${codigo}`);
    }
  }
}
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `cd backend && npm test -- oneclick.provider`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/pasarela/providers
git commit -m "feat(pasarela): add PaymentProvider contract, OneclickProvider and factory"
```

---

### Task 5: TenantPasarelaService (configuración por tenant)

**Files:**
- Create: `backend/src/modules/pasarela/services/tenant-pasarela.service.ts`
- Create: `backend/src/modules/pasarela/dto/create-tenant-pasarela.dto.ts`
- Create: `backend/src/modules/pasarela/dto/update-tenant-pasarela.dto.ts`
- Test: `backend/src/modules/pasarela/services/tenant-pasarela.service.spec.ts`

**Interfaces:**
- Consumes: `CredencialesService.cifrarJson` (Task 2), entities Task 1.
- Produces:
  - `listar(tenantId)` — join con `pasarelas`, expone `tieneCredenciales: boolean`, NUNCA la configuración.
  - `crear(tenantId, dto: CreateTenantPasarelaDto)`
  - `actualizar(tenantId, tenantPasarelaId, dto: UpdateTenantPasarelaDto)` — write-only: re-cifra `configuracion` solo si viene en el dto.
  - `eliminar(tenantId, tenantPasarelaId)` — soft delete.
  - `resolverConfiguracionActiva(tenantId, codigoPasarela): Promise<{ tenantPasarela; pasarela; cred }>` — usado por Inscripciones/Cobros (Tasks 7–8): busca el `tenant_pasarela` activo del tenant para esa pasarela (menor `prioridad` primero), y resuelve credenciales con `CredencialesService.resolver`.

- [ ] **Step 1: DTOs**

```typescript
// dto/create-tenant-pasarela.dto.ts
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateTenantPasarelaDto {
  @IsUUID()
  pasarelaId: string;

  @IsIn(['pruebas', 'produccion'])
  ambiente: string;

  @IsIn(['mall', 'individual'])
  modoIntegracion: string;

  // MALL: { commerceCodeHijo } — INDIVIDUAL: credenciales completas del proveedor
  @IsOptional() @IsObject()
  configuracion?: Record<string, string>;

  @IsOptional() @IsBoolean()
  activo?: boolean;

  @IsOptional() @IsInt() @Min(1)
  prioridad?: number;
}
```

```typescript
// dto/update-tenant-pasarela.dto.ts
import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateTenantPasarelaDto } from './create-tenant-pasarela.dto';

export class UpdateTenantPasarelaDto extends PartialType(
  OmitType(CreateTenantPasarelaDto, ['pasarelaId'] as const),
) {}
```

- [ ] **Step 2: Escribir el test que falla**

```typescript
// tenant-pasarela.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { CredencialesService } from './credenciales.service';
import { TenantPasarela } from '../entities/tenant-pasarela.entity';
import { Pasarela } from '../entities/pasarela.entity';

describe('TenantPasarelaService', () => {
  let service: TenantPasarelaService;
  const tpRepo = {
    create: jest.fn((x) => x), save: jest.fn((x) => Promise.resolve({ tenantPasarelaId: 'tp-1', ...x })),
    findOne: jest.fn(), softRemove: jest.fn(),
  };
  const pasarelaRepo = { findOne: jest.fn() };
  const dataSource = { query: jest.fn().mockResolvedValue([]) };
  const credenciales = {
    cifrarJson: jest.fn().mockReturnValue('v1:blob'),
    resolver: jest.fn().mockReturnValue({ baseUrl: 'x' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TenantPasarelaService,
        { provide: getRepositoryToken(TenantPasarela), useValue: tpRepo },
        { provide: getRepositoryToken(Pasarela), useValue: pasarelaRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: CredencialesService, useValue: credenciales },
      ],
    }).compile();
    service = module.get(TenantPasarelaService);
  });

  it('crear: cifra la configuración y no la devuelve', async () => {
    pasarelaRepo.findOne.mockResolvedValue({ pasarelaId: 'p-1', activo: true, soportaMall: true });
    const res = await service.crear('t-1', {
      pasarelaId: 'p-1', ambiente: 'pruebas', modoIntegracion: 'mall',
      configuracion: { commerceCodeHijo: '5970...' },
    });
    expect(credenciales.cifrarJson).toHaveBeenCalledWith({ commerceCodeHijo: '5970...' });
    expect(JSON.stringify(res)).not.toContain('5970...');
  });

  it('crear: rechaza pasarela global inexistente o inactiva', async () => {
    pasarelaRepo.findOne.mockResolvedValue(null);
    await expect(
      service.crear('t-1', { pasarelaId: 'nope', ambiente: 'pruebas', modoIntegracion: 'mall' }),
    ).rejects.toThrow('Pasarela no disponible');
  });

  it('actualizar: NO toca configuracion si el dto no la trae (write-only)', async () => {
    tpRepo.findOne.mockResolvedValue({
      tenantPasarelaId: 'tp-1', tenantId: 't-1', configuracion: 'v1:anterior', activo: true,
    });
    await service.actualizar('t-1', 'tp-1', { activo: false });
    const guardado = tpRepo.save.mock.calls[0][0];
    expect(guardado.configuracion).toBe('v1:anterior');
    expect(guardado.activo).toBe(false);
  });

  it('resolverConfiguracionActiva: rechaza si el tenant no tiene la pasarela activa', async () => {
    tpRepo.findOne.mockResolvedValue(null);
    dataSource.query.mockResolvedValue([]);
    await expect(service.resolverConfiguracionActiva('t-1', 'oneclick'))
      .rejects.toThrow('no tiene configurada');
  });
});
```

- [ ] **Step 3: Correr — FAIL. Implementar:**

```typescript
// tenant-pasarela.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CredencialesService } from './credenciales.service';
import { Pasarela } from '../entities/pasarela.entity';
import { TenantPasarela } from '../entities/tenant-pasarela.entity';
import { CreateTenantPasarelaDto } from '../dto/create-tenant-pasarela.dto';
import { UpdateTenantPasarelaDto } from '../dto/update-tenant-pasarela.dto';

@Injectable()
export class TenantPasarelaService {
  constructor(
    @InjectRepository(TenantPasarela)
    private readonly tpRepo: Repository<TenantPasarela>,
    @InjectRepository(Pasarela)
    private readonly pasarelaRepo: Repository<Pasarela>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly credenciales: CredencialesService,
  ) {}

  async listar(tenantId: string) {
    const rows: {
      tenant_pasarela_id: string; pasarela_id: string; codigo: string; nombre: string;
      ambiente: string; modo_integracion: string; activo: boolean; prioridad: number;
      tiene_credenciales: boolean; creado_el: Date;
    }[] = await this.dataSource.query(
      `SELECT tp.tenant_pasarela_id, tp.pasarela_id, p.codigo, p.nombre,
              tp.ambiente, tp.modo_integracion, tp.activo, tp.prioridad,
              (tp.configuracion IS NOT NULL) AS tiene_credenciales, tp.creado_el
       FROM tenant_pasarela tp
       JOIN pasarelas p ON p.pasarela_id = tp.pasarela_id AND p.eliminado_el IS NULL
       WHERE tp.tenant_id = $1 AND tp.eliminado_el IS NULL
       ORDER BY tp.prioridad ASC, tp.creado_el ASC`,
      [tenantId],
    );
    return rows.map((r) => ({
      tenantPasarelaId: r.tenant_pasarela_id,
      pasarelaId: r.pasarela_id,
      codigo: r.codigo,
      nombre: r.nombre,
      ambiente: r.ambiente,
      modoIntegracion: r.modo_integracion,
      activo: r.activo,
      prioridad: r.prioridad,
      tieneCredenciales: r.tiene_credenciales,
      creadoEl: r.creado_el,
    }));
  }

  /** Catálogo global para el selector del drawer (sin configuración). */
  listarPasarelasGlobales() {
    return this.pasarelaRepo.find({
      where: { activo: true },
      select: ['pasarelaId', 'codigo', 'nombre', 'soportaTokenizacion', 'soportaCobroRecurrente', 'soportaMall'],
      order: { nombre: 'ASC' },
    });
  }

  async crear(tenantId: string, dto: CreateTenantPasarelaDto) {
    const pasarela = await this.pasarelaRepo.findOne({
      where: { pasarelaId: dto.pasarelaId, activo: true },
    });
    if (!pasarela) throw new BadRequestException('Pasarela no disponible');
    if (dto.modoIntegracion === 'mall' && !pasarela.soportaMall)
      throw new BadRequestException('Esta pasarela no soporta modo mall');

    const guardada = await this.tpRepo.save(
      this.tpRepo.create({
        tenantId,
        pasarelaId: dto.pasarelaId,
        ambiente: dto.ambiente,
        modoIntegracion: dto.modoIntegracion,
        configuracion: dto.configuracion ? this.credenciales.cifrarJson(dto.configuracion) : null,
        activo: dto.activo ?? true,
        prioridad: dto.prioridad ?? 1,
      }),
    );
    return { tenantPasarelaId: guardada.tenantPasarelaId };
  }

  async actualizar(tenantId: string, tenantPasarelaId: string, dto: UpdateTenantPasarelaDto) {
    const tp = await this.tpRepo.findOne({ where: { tenantPasarelaId, tenantId } });
    if (!tp) throw new NotFoundException('Configuración de pasarela no encontrada');
    if (dto.ambiente !== undefined) tp.ambiente = dto.ambiente;
    if (dto.modoIntegracion !== undefined) tp.modoIntegracion = dto.modoIntegracion;
    if (dto.activo !== undefined) tp.activo = dto.activo;
    if (dto.prioridad !== undefined) tp.prioridad = dto.prioridad;
    // Write-only: solo re-cifrar si mandaron credenciales nuevas
    if (dto.configuracion !== undefined)
      tp.configuracion = this.credenciales.cifrarJson(dto.configuracion);
    await this.tpRepo.save(tp);
    return { tenantPasarelaId };
  }

  async eliminar(tenantId: string, tenantPasarelaId: string) {
    const tp = await this.tpRepo.findOne({ where: { tenantPasarelaId, tenantId } });
    if (!tp) throw new NotFoundException('Configuración de pasarela no encontrada');
    await this.tpRepo.softRemove(tp);
    return { tenantPasarelaId };
  }

  /** Config activa del tenant para una pasarela por código + credenciales resueltas. */
  async resolverConfiguracionActiva(tenantId: string, codigoPasarela: string) {
    const rows: { tenant_pasarela_id: string }[] = await this.dataSource.query(
      `SELECT tp.tenant_pasarela_id
       FROM tenant_pasarela tp
       JOIN pasarelas p ON p.pasarela_id = tp.pasarela_id
            AND p.codigo = $2 AND p.activo = true AND p.eliminado_el IS NULL
       WHERE tp.tenant_id = $1 AND tp.activo = true AND tp.eliminado_el IS NULL
       ORDER BY tp.prioridad ASC LIMIT 1`,
      [tenantId, codigoPasarela],
    );
    const tenantPasarela = rows[0]
      ? await this.tpRepo.findOne({ where: { tenantPasarelaId: rows[0].tenant_pasarela_id } })
      : null;
    if (!tenantPasarela)
      throw new BadRequestException(`El tenant no tiene configurada la pasarela ${codigoPasarela}`);
    const pasarela = await this.pasarelaRepo.findOne({
      where: { pasarelaId: tenantPasarela.pasarelaId },
    });
    if (!pasarela) throw new NotFoundException('Pasarela no encontrada');
    const cred = this.credenciales.resolver(tenantPasarela, pasarela);
    return { tenantPasarela, pasarela, cred };
  }
}
```

- [ ] **Step 4: Correr el test — debe pasar**

Run: `cd backend && npm test -- tenant-pasarela.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/pasarela/services/tenant-pasarela.service.ts backend/src/modules/pasarela/services/tenant-pasarela.service.spec.ts backend/src/modules/pasarela/dto/create-tenant-pasarela.dto.ts backend/src/modules/pasarela/dto/update-tenant-pasarela.dto.ts
git commit -m "feat(pasarela): add tenant gateway config service (write-only credentials)"
```

---

### Task 6: TransaccionesService (historial inmutable + redacción)

**Files:**
- Create: `backend/src/modules/pasarela/services/transacciones.service.ts`
- Test: `backend/src/modules/pasarela/services/transacciones.service.spec.ts`

**Interfaces:**
- Consumes: `PasarelaTransaccion` (Task 1), `ResultadoProvider` (Task 4).
- Produces:
  - `registrar(datos: Partial<PasarelaTransaccion>): Promise<PasarelaTransaccion>` — redacta `request`/`response` antes de guardar.
  - `listarPorOrden(tenantId, ordenId): Promise<PasarelaTransaccion[]>`
  - `redactar(obj: Record<string, unknown>): Record<string, unknown>` (público para tests).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// transacciones.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TransaccionesService } from './transacciones.service';
import { PasarelaTransaccion } from '../entities/pasarela-transaccion.entity';

describe('TransaccionesService', () => {
  let service: TransaccionesService;
  const repo = {
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ transaccionId: 'tx-1', ...x })),
    find: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TransaccionesService,
        { provide: getRepositoryToken(PasarelaTransaccion), useValue: repo },
      ],
    }).compile();
    service = module.get(TransaccionesService);
  });

  it('redactar: enmascara claves sensibles en cualquier nivel', () => {
    const sucio = {
      headers: { 'Tbk-Api-Key-Secret': 'S3CR3T', 'Content-Type': 'application/json' },
      body: { tbk_user: 'tbk-abc', username: 'insc-1', amount: 5000, nested: { token: 'tok' } },
    };
    const limpio = service.redactar(sucio);
    expect(JSON.stringify(limpio)).not.toContain('S3CR3T');
    expect(JSON.stringify(limpio)).not.toContain('tbk-abc');
    expect(JSON.stringify(limpio)).not.toContain('"tok"');
    expect((limpio.body as Record<string, unknown>).amount).toBe(5000);
  });

  it('registrar: redacta request/response y setea fechaTransaccion', async () => {
    await service.registrar({
      tenantId: 't-1', tenantPasarelaId: 'tp-1', tipo: 'AUTHORIZATION', estado: 'aprobada',
      request: { body: { tbk_user: 'secreto' } }, response: { ok: true },
    });
    const guardado = repo.save.mock.calls[0][0];
    expect(JSON.stringify(guardado.request)).not.toContain('secreto');
    expect(guardado.fechaTransaccion).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Correr — FAIL. Implementar:**

```typescript
// transacciones.service.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PasarelaTransaccion } from '../entities/pasarela-transaccion.entity';

const CLAVES_SENSIBLES = new Set([
  'tbk-api-key-secret', 'tbk-api-key-id', 'authorization',
  'tbk_user', 'token', 'apikeysecret', 'api_key_secret',
]);

@Injectable()
export class TransaccionesService {
  constructor(
    @InjectRepository(PasarelaTransaccion)
    private readonly repo: Repository<PasarelaTransaccion>,
  ) {}

  /** Enmascara recursivamente credenciales y tokens — nunca persisten en claro. */
  redactar(obj: Record<string, unknown>): Record<string, unknown> {
    const limpiar = (valor: unknown): unknown => {
      if (Array.isArray(valor)) return valor.map(limpiar);
      if (valor && typeof valor === 'object') {
        return Object.fromEntries(
          Object.entries(valor as Record<string, unknown>).map(([k, v]) =>
            CLAVES_SENSIBLES.has(k.toLowerCase()) ? [k, '[REDACTADO]'] : [k, limpiar(v)],
          ),
        );
      }
      return valor;
    };
    return limpiar(obj) as Record<string, unknown>;
  }

  registrar(datos: Partial<PasarelaTransaccion>): Promise<PasarelaTransaccion> {
    return this.repo.save(
      this.repo.create({
        ...datos,
        request: this.redactar(datos.request ?? {}),
        response: this.redactar(datos.response ?? {}),
        fechaTransaccion: datos.fechaTransaccion ?? new Date(),
      }),
    );
  }

  listarPorOrden(tenantId: string, ordenId: string): Promise<PasarelaTransaccion[]> {
    return this.repo.find({
      where: { tenantId, ordenId },
      order: { fechaTransaccion: 'ASC' },
    });
  }
}
```

- [ ] **Step 3: Correr el test — debe pasar**

Run: `cd backend && npm test -- transacciones.service`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/pasarela/services/transacciones.service.ts backend/src/modules/pasarela/services/transacciones.service.spec.ts
git commit -m "feat(pasarela): add immutable transaction log with credential redaction"
```

---

### Task 7: InscripcionesService + retorno de Webpay

**Files:**
- Create: `backend/src/modules/pasarela/services/inscripciones.service.ts`
- Create: `backend/src/modules/pasarela/dto/create-inscripcion.dto.ts`
- Test: `backend/src/modules/pasarela/services/inscripciones.service.spec.ts`

**Interfaces:**
- Consumes: `TenantPasarelaService.resolverConfiguracionActiva` (Task 5), `ProviderFactory` (Task 4), `TransaccionesService.registrar` (Task 6), `CredencialesService.cifrarTexto/descifrarTexto` (Task 2), `ConfigService` (`API_PUBLIC_URL`).
- Produces:
  - `iniciar(tenantId, dto: CreateInscripcionDto): Promise<{ inscripcionId; urlWebpay; token }>`
  - `confirmarRetorno(tbkToken: string): Promise<{ urlRedireccion: string }>` — para el controller de retorno.
  - `obtener(tenantId, inscripcionId)` / `listarPorPagador(tenantId, pagadorRef)` — sin tbkUser.
  - `eliminar(tenantId, inscripcionId)`.
  - `resolverParaCobro(tenantId, inscripcionId?: string, pagadorRef?: string): Promise<PasarelaInscripcion>` — inscripción activa (para Task 8); lanza `BadRequestException` si no hay.

```typescript
// dto/create-inscripcion.dto.ts
import { IsEmail, IsString, IsUrl, Length, Matches } from 'class-validator';

export class CreateInscripcionDto {
  @IsString() @Length(1, 100) @Matches(/^\S+$/, { message: 'pagadorRef no admite espacios' })
  pagadorRef: string;

  @IsEmail()
  email: string;

  @IsUrl({ require_tld: false }) // permite http://localhost en dev
  urlRetorno: string;
}
```

- [ ] **Step 1: Escribir el test que falla**

```typescript
// inscripciones.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { InscripcionesService } from './inscripciones.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CredencialesService } from './credenciales.service';
import { ProviderFactory } from '../providers/provider.factory';
import { PasarelaInscripcion } from '../entities/pasarela-inscripcion.entity';
import { PasarelaMedioPago } from '../entities/pasarela-medio-pago.entity';

describe('InscripcionesService', () => {
  let service: InscripcionesService;
  const inscripcionRepo = {
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ inscripcionId: 'insc-uuid-1', ...x })),
    findOne: jest.fn(), find: jest.fn().mockResolvedValue([]),
  };
  const medioRepo = { create: jest.fn((x) => x), save: jest.fn((x) => Promise.resolve(x)), update: jest.fn() };
  const provider = {
    iniciarInscripcion: jest.fn().mockResolvedValue({
      tokenExterno: 'tok-1', urlRedireccion: 'https://webpay/init',
      aprobada: true, codigoRespuesta: null, request: {}, response: {},
    }),
    confirmarInscripcion: jest.fn(),
    eliminarInscripcion: jest.fn().mockResolvedValue(undefined),
  };
  const tenantPasarela = {
    resolverConfiguracionActiva: jest.fn().mockResolvedValue({
      tenantPasarela: { tenantPasarelaId: 'tp-1' },
      pasarela: { codigo: 'oneclick' },
      cred: { baseUrl: 'x' },
    }),
  };
  const transacciones = { registrar: jest.fn().mockResolvedValue({ transaccionId: 'tx-1' }) };
  const credenciales = {
    cifrarTexto: jest.fn((t: string) => `v1:cifrado(${t})`),
    descifrarTexto: jest.fn((b: string) => b.replace(/^v1:cifrado\((.*)\)$/, '$1')),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        InscripcionesService,
        { provide: getRepositoryToken(PasarelaInscripcion), useValue: inscripcionRepo },
        { provide: getRepositoryToken(PasarelaMedioPago), useValue: medioRepo },
        { provide: TenantPasarelaService, useValue: tenantPasarela },
        { provide: TransaccionesService, useValue: transacciones },
        { provide: CredencialesService, useValue: credenciales },
        { provide: ProviderFactory, useValue: { get: jest.fn().mockReturnValue(provider) } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') } },
      ],
    }).compile();
    service = module.get(InscripcionesService);
  });

  it('iniciar: genera username insc-<uuid> (nunca el pagadorRef) y guarda el token', async () => {
    const res = await service.iniciar('t-1', {
      pagadorRef: 'rut-123', email: 'a@b.cl', urlRetorno: 'https://app/vuelta',
    });
    expect(res.urlWebpay).toBe('https://webpay/init');
    const llamada = provider.iniciarInscripcion.mock.calls[0][1];
    expect(llamada.username).toMatch(/^insc-[a-f0-9]{32}$/);
    expect(llamada.username).not.toContain('rut-123');
    expect(llamada.responseUrl).toBe('http://localhost:3000/api/pasarela/retorno/inscripcion');
  });

  it('confirmarRetorno aprobado: activa, cifra tbkUser, crea medio y transacción INSCRIPTION', async () => {
    inscripcionRepo.findOne.mockResolvedValue({
      inscripcionId: 'insc-uuid-1', tenantId: 't-1', tenantPasarelaId: 'tp-1',
      estado: 'pendiente', urlRetornoApp: 'https://app/vuelta', tokenProveedor: 'tok-1',
    });
    provider.confirmarInscripcion.mockResolvedValue({
      aprobada: true, codigoRespuesta: '0', identificadorExterno: 'tbk-u-1',
      codigoAutorizacion: '1213', tarjeta: { tipo: 'TARJETA', marca: 'Visa', ultimos4: '6623' },
      request: {}, response: {},
    });
    const res = await service.confirmarRetorno('tok-1');
    expect(res.urlRedireccion).toBe('https://app/vuelta?inscripcionId=insc-uuid-1&estado=activa');
    const inscripcionGuardada = inscripcionRepo.save.mock.calls[0][0];
    expect(inscripcionGuardada.estado).toBe('activa');
    expect(inscripcionGuardada.identificadorExterno).toBe('v1:cifrado(tbk-u-1)');
    expect(medioRepo.save).toHaveBeenCalled();
    expect(transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'INSCRIPTION', estado: 'aprobada' }),
    );
  });

  it('confirmarRetorno rechazado: fallida + transacción rechazada, sin medio de pago', async () => {
    inscripcionRepo.findOne.mockResolvedValue({
      inscripcionId: 'insc-uuid-1', tenantId: 't-1', tenantPasarelaId: 'tp-1',
      estado: 'pendiente', urlRetornoApp: 'https://app/vuelta', tokenProveedor: 'tok-1',
    });
    provider.confirmarInscripcion.mockResolvedValue({
      aprobada: false, codigoRespuesta: '-96', identificadorExterno: null,
      codigoAutorizacion: null, tarjeta: null, request: {}, response: {},
    });
    const res = await service.confirmarRetorno('tok-1');
    expect(res.urlRedireccion).toContain('estado=fallida');
    expect(medioRepo.save).not.toHaveBeenCalled();
  });

  it('confirmarRetorno con token desconocido lanza NotFound', async () => {
    inscripcionRepo.findOne.mockResolvedValue(null);
    await expect(service.confirmarRetorno('tok-x')).rejects.toThrow('Inscripción no encontrada');
  });

  it('resolverParaCobro exige inscripción activa', async () => {
    inscripcionRepo.findOne.mockResolvedValue(null);
    await expect(service.resolverParaCobro('t-1', undefined, 'rut-123'))
      .rejects.toThrow('inscripción activa');
  });
});
```

- [ ] **Step 2: Correr — FAIL. Implementar:**

```typescript
// inscripciones.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { PasarelaInscripcion } from '../entities/pasarela-inscripcion.entity';
import { PasarelaMedioPago } from '../entities/pasarela-medio-pago.entity';
import { CreateInscripcionDto } from '../dto/create-inscripcion.dto';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CredencialesService } from './credenciales.service';
import { ProviderFactory } from '../providers/provider.factory';

const PASARELA_V1 = 'oneclick'; // v1: única pasarela con tokenización

@Injectable()
export class InscripcionesService {
  constructor(
    @InjectRepository(PasarelaInscripcion)
    private readonly inscripcionRepo: Repository<PasarelaInscripcion>,
    @InjectRepository(PasarelaMedioPago)
    private readonly medioRepo: Repository<PasarelaMedioPago>,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly transacciones: TransaccionesService,
    private readonly credenciales: CredencialesService,
    private readonly providerFactory: ProviderFactory,
    private readonly config: ConfigService,
  ) {}

  private toPublico(i: PasarelaInscripcion, medios: PasarelaMedioPago[] = []) {
    // Nunca exponer identificadorExterno (tbkUser) ni tokenProveedor
    return {
      inscripcionId: i.inscripcionId,
      pagadorRef: i.pagadorRef,
      estado: i.estado,
      creadoEl: i.creadoEl,
      mediosPago: medios.map((m) => ({
        medioPagoId: m.medioPagoId, tipo: m.tipo, marca: m.marca,
        ultimos4: m.ultimos4, estado: m.estado,
      })),
    };
  }

  async iniciar(tenantId: string, dto: CreateInscripcionDto) {
    const { tenantPasarela, pasarela, cred } =
      await this.tenantPasarelaService.resolverConfiguracionActiva(tenantId, PASARELA_V1);

    // username propio (formato del proveedor, sin filtrar identificadores del tenant)
    const username = `insc-${randomUUID().replace(/-/g, '')}`;
    const responseUrl = `${this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3000'}/api/pasarela/retorno/inscripcion`;

    const provider = this.providerFactory.get(pasarela.codigo);
    const inicio = await provider.iniciarInscripcion(cred, {
      username, email: dto.email, responseUrl,
    });

    const inscripcion = await this.inscripcionRepo.save(
      this.inscripcionRepo.create({
        tenantId,
        tenantPasarelaId: tenantPasarela.tenantPasarelaId,
        pagadorRef: dto.pagadorRef,
        identificadorUsuarioExterno: username,
        estado: 'pendiente',
        tokenProveedor: inicio.tokenExterno,
        urlRetornoApp: dto.urlRetorno,
      }),
    );

    return {
      inscripcionId: inscripcion.inscripcionId,
      urlWebpay: inicio.urlRedireccion,
      token: inicio.tokenExterno,
    };
  }

  /** Retorno de Webpay: confirma contra el proveedor y redirige a la app. */
  async confirmarRetorno(tbkToken: string): Promise<{ urlRedireccion: string }> {
    const inscripcion = await this.inscripcionRepo.findOne({
      where: { tokenProveedor: tbkToken, estado: 'pendiente' },
    });
    if (!inscripcion) throw new NotFoundException('Inscripción no encontrada para el token');

    const tp = await this.tenantPasarelaService.resolverConfiguracionActiva(
      inscripcion.tenantId, PASARELA_V1,
    );
    const provider = this.providerFactory.get(tp.pasarela.codigo);
    const resultado = await provider.confirmarInscripcion(tp.cred, tbkToken);

    inscripcion.estado = resultado.aprobada ? 'activa' : 'fallida';
    inscripcion.identificadorExterno = resultado.identificadorExterno
      ? this.credenciales.cifrarTexto(resultado.identificadorExterno)
      : null;
    inscripcion.tokenProveedor = null; // token de un solo uso
    await this.inscripcionRepo.save(inscripcion);

    let medioPagoId: string | null = null;
    if (resultado.aprobada && resultado.tarjeta) {
      const medio = await this.medioRepo.save(
        this.medioRepo.create({
          inscripcionId: inscripcion.inscripcionId,
          tipo: resultado.tarjeta.tipo,
          marca: resultado.tarjeta.marca,
          ultimos4: resultado.tarjeta.ultimos4,
          estado: 'activo',
        }),
      );
      medioPagoId = medio.medioPagoId;
    }

    await this.transacciones.registrar({
      tenantId: inscripcion.tenantId,
      tenantPasarelaId: inscripcion.tenantPasarelaId,
      inscripcionId: inscripcion.inscripcionId,
      medioPagoId,
      tipo: 'INSCRIPTION',
      estado: resultado.aprobada ? 'aprobada' : 'rechazada',
      codigoRespuesta: resultado.codigoRespuesta,
      codigoAutorizacion: resultado.codigoAutorizacion,
      request: resultado.request,
      response: resultado.response,
    });

    const sep = inscripcion.urlRetornoApp.includes('?') ? '&' : '?';
    return {
      urlRedireccion: `${inscripcion.urlRetornoApp}${sep}inscripcionId=${inscripcion.inscripcionId}&estado=${inscripcion.estado}`,
    };
  }

  async obtener(tenantId: string, inscripcionId: string) {
    const inscripcion = await this.inscripcionRepo.findOne({
      where: { inscripcionId, tenantId },
    });
    if (!inscripcion) throw new NotFoundException('Inscripción no encontrada');
    const medios = await this.medioRepo.find({ where: { inscripcionId } });
    return this.toPublico(inscripcion, medios);
  }

  async listarPorPagador(tenantId: string, pagadorRef: string) {
    const lista = await this.inscripcionRepo.find({
      where: { tenantId, pagadorRef },
      order: { creadoEl: 'DESC' },
    });
    return Promise.all(
      lista.map(async (i) =>
        this.toPublico(i, await this.medioRepo.find({ where: { inscripcionId: i.inscripcionId } })),
      ),
    );
  }

  async eliminar(tenantId: string, inscripcionId: string) {
    const inscripcion = await this.inscripcionRepo.findOne({
      where: { inscripcionId, tenantId, estado: 'activa' },
    });
    if (!inscripcion) throw new NotFoundException('Inscripción activa no encontrada');
    if (!inscripcion.identificadorExterno)
      throw new BadRequestException('La inscripción no tiene identificador del proveedor');

    const tp = await this.tenantPasarelaService.resolverConfiguracionActiva(tenantId, PASARELA_V1);
    const provider = this.providerFactory.get(tp.pasarela.codigo);
    await provider.eliminarInscripcion(tp.cred, {
      identificadorExterno: this.credenciales.descifrarTexto(inscripcion.identificadorExterno),
      username: inscripcion.identificadorUsuarioExterno,
    });

    inscripcion.estado = 'eliminada';
    await this.inscripcionRepo.save(inscripcion);
    await this.medioRepo.update({ inscripcionId }, { estado: 'eliminado' });
    await this.inscripcionRepo.softRemove(inscripcion);
    return { inscripcionId };
  }

  /** Inscripción activa para cobrar: por id explícito o la más reciente del pagador. */
  async resolverParaCobro(tenantId: string, inscripcionId?: string, pagadorRef?: string) {
    if (!inscripcionId && !pagadorRef)
      throw new BadRequestException('Debe indicar inscripcionId o pagadorRef');
    const inscripcion = await this.inscripcionRepo.findOne({
      where: inscripcionId
        ? { inscripcionId, tenantId, estado: 'activa' }
        : { tenantId, pagadorRef, estado: 'activa' },
      order: { creadoEl: 'DESC' },
    });
    if (!inscripcion)
      throw new BadRequestException('El pagador no tiene una inscripción activa');
    return inscripcion;
  }
}
```

- [ ] **Step 3: Correr el test — debe pasar**

Run: `cd backend && npm test -- inscripciones.service`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/pasarela/services/inscripciones.service.ts backend/src/modules/pasarela/services/inscripciones.service.spec.ts backend/src/modules/pasarela/dto/create-inscripcion.dto.ts
git commit -m "feat(pasarela): add Oneclick inscription flow (start/finish/delete)"
```

---

### Task 8: CobrosService (orden → authorize → estados, reembolso, verificar)

**Files:**
- Create: `backend/src/modules/pasarela/services/cobros.service.ts`
- Create: `backend/src/modules/pasarela/dto/create-cobro.dto.ts`
- Create: `backend/src/modules/pasarela/dto/create-reembolso.dto.ts`
- Test: `backend/src/modules/pasarela/services/cobros.service.spec.ts`

**Interfaces:**
- Consumes: `InscripcionesService.resolverParaCobro` (Task 7), `TenantPasarelaService.resolverConfiguracionActiva` (Task 5), `ProviderFactory` (Task 4), `TransaccionesService` (Task 6), `CredencialesService.descifrarTexto` (Task 2).
- Produces:
  - `cobrar(tenantId, dto: CreateCobroDto, origen: 'interno' | 'api', apiKeyId?: string)`
  - `reembolsar(tenantId, ordenId, dto: CreateReembolsoDto)`
  - `verificar(tenantId, ordenId)`
  - `obtenerOrden(tenantId, ordenId)` (aplica expiración perezosa)
  - `listarOrdenes(tenantId, page, pageSize)` — para el admin.

```typescript
// dto/create-cobro.dto.ts
import {
  IsInt, IsNumberString, IsOptional, IsString, IsUUID, Length, Matches, Max, Min,
} from 'class-validator';

export class CreateCobroDto {
  @IsOptional() @IsUUID()
  inscripcionId?: string;

  @IsOptional() @IsString() @Length(1, 100) @Matches(/^\S+$/)
  pagadorRef?: string;

  @IsOptional() @IsString() @Length(1, 255)
  referenciaExterna?: string;

  @IsNumberString()
  monto: string;

  @IsString() @Length(1, 255)
  descripcion: string;

  @IsOptional() @IsInt() @Min(0) @Max(48)
  cuotas?: number;
}
```

```typescript
// dto/create-reembolso.dto.ts
import { IsNumberString } from 'class-validator';

export class CreateReembolsoDto {
  @IsNumberString()
  monto: string;
}
```

- [ ] **Step 1: Escribir el test que falla**

```typescript
// cobros.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CobrosService } from './cobros.service';
import { InscripcionesService } from './inscripciones.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CredencialesService } from './credenciales.service';
import { ProviderFactory } from '../providers/provider.factory';
import { PasarelaOrden } from '../entities/pasarela-orden.entity';
import { ProviderComunicacionError } from '../providers/payment-provider.interface';

const inscripcionActiva = {
  inscripcionId: 'insc-1', tenantPasarelaId: 'tp-1', pagadorRef: 'rut-123',
  identificadorUsuarioExterno: 'insc-abc', identificadorExterno: 'v1:blob-tbk',
};

describe('CobrosService', () => {
  let service: CobrosService;
  const ordenRepo = {
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ ordenId: 'orden-1', ...x })),
    findOne: jest.fn(),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
  };
  const provider = { autorizarCobro: jest.fn(), reembolsar: jest.fn(), consultarEstado: jest.fn() };
  const deps = {
    inscripciones: { resolverParaCobro: jest.fn().mockResolvedValue(inscripcionActiva) },
    tenantPasarela: {
      resolverConfiguracionActiva: jest.fn().mockResolvedValue({
        tenantPasarela: { tenantPasarelaId: 'tp-1' }, pasarela: { codigo: 'oneclick' }, cred: {},
      }),
    },
    transacciones: {
      registrar: jest.fn().mockResolvedValue({ transaccionId: 'tx-1' }),
      listarPorOrden: jest.fn().mockResolvedValue([]),
    },
    credenciales: { descifrarTexto: jest.fn().mockReturnValue('tbk-u-1') },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        CobrosService,
        { provide: getRepositoryToken(PasarelaOrden), useValue: ordenRepo },
        { provide: InscripcionesService, useValue: deps.inscripciones },
        { provide: TenantPasarelaService, useValue: deps.tenantPasarela },
        { provide: TransaccionesService, useValue: deps.transacciones },
        { provide: CredencialesService, useValue: deps.credenciales },
        { provide: ProviderFactory, useValue: { get: () => provider } },
      ],
    }).compile();
    service = module.get(CobrosService);
  });

  it('cobro aprobado: orden pagada + transacción AUTHORIZATION aprobada', async () => {
    provider.autorizarCobro.mockResolvedValue({
      aprobada: true, codigoRespuesta: '0', codigoAutorizacion: '1213',
      identificadorTransaccionExterno: 'O-x', tipoPago: 'VN', numeroCuotas: 0,
      montoCuota: null, request: {}, response: {},
    });
    const res = await service.cobrar('t-1', {
      pagadorRef: 'rut-123', monto: '5000', descripcion: 'Cobro test',
    }, 'api', 'key-1');
    expect(res.estado).toBe('pagada');
    // la orden se guardó con codigoOrden ≤ 26 chars (límite Oneclick)
    const ordenCreada = ordenRepo.save.mock.calls[0][0];
    expect(ordenCreada.codigoOrden.length).toBeLessThanOrEqual(26);
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'AUTHORIZATION', estado: 'aprobada' }),
    );
  });

  it('cobro rechazado: orden fallida, respuesta 200 con detalle (no lanza)', async () => {
    provider.autorizarCobro.mockResolvedValue({
      aprobada: false, codigoRespuesta: '-1', codigoAutorizacion: null,
      identificadorTransaccionExterno: 'O-y', tipoPago: 'VN', numeroCuotas: 0,
      montoCuota: null, request: {}, response: {},
    });
    const res = await service.cobrar('t-1', {
      pagadorRef: 'rut-123', monto: '5000', descripcion: 'x',
    }, 'interno');
    expect(res.estado).toBe('fallida');
    expect(res.codigoRespuesta).toBe('-1');
  });

  it('timeout: transacción error, orden QUEDA en_proceso y lanza BadGateway', async () => {
    provider.autorizarCobro.mockRejectedValue(new ProviderComunicacionError('timeout', {}));
    await expect(
      service.cobrar('t-1', { pagadorRef: 'rut-123', monto: '5000', descripcion: 'x' }, 'api'),
    ).rejects.toThrow('verifique el estado');
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'AUTHORIZATION', estado: 'error' }),
    );
    // ningún save posterior cambió el estado a fallida/pagada
    const estadosGuardados = ordenRepo.save.mock.calls.map((c) => c[0].estado);
    expect(estadosGuardados).not.toContain('fallida');
    expect(estadosGuardados).not.toContain('pagada');
  });

  it('reembolso total: transacción REFUND hija + orden reembolsada', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1', tenantId: 't-1', estado: 'pagada', monto: '5000',
      moneda: 'CLP', codigoOrden: 'O-1',
    });
    deps.transacciones.listarPorOrden.mockResolvedValue([
      { transaccionId: 'tx-auth', tipo: 'AUTHORIZATION', estado: 'aprobada',
        tenantPasarelaId: 'tp-1', inscripcionId: 'insc-1', monto: '5000' },
    ]);
    provider.reembolsar.mockResolvedValue({
      aprobada: true, codigoRespuesta: '0', codigoAutorizacion: null,
      identificadorTransaccionExterno: null, tipoPago: 'REVERSED',
      numeroCuotas: null, montoCuota: null, request: {}, response: {},
    });
    const res = await service.reembolsar('t-1', 'orden-1', { monto: '5000' });
    expect(res.estado).toBe('reembolsada');
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'REFUND', transaccionPadreId: 'tx-auth' }),
    );
  });

  it('reembolso mayor al saldo disponible es rechazado', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1', tenantId: 't-1', estado: 'pagada', monto: '5000',
      moneda: 'CLP', codigoOrden: 'O-1',
    });
    deps.transacciones.listarPorOrden.mockResolvedValue([
      { transaccionId: 'tx-auth', tipo: 'AUTHORIZATION', estado: 'aprobada',
        tenantPasarelaId: 'tp-1', inscripcionId: null, monto: '5000' },
      { transaccionId: 'tx-r1', tipo: 'REFUND', estado: 'aprobada', monto: '4000' },
    ]);
    await expect(service.reembolsar('t-1', 'orden-1', { monto: '2000' }))
      .rejects.toThrow('excede');
  });

  it('verificar cierra una orden en_proceso según el proveedor', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1', tenantId: 't-1', estado: 'en_proceso',
      codigoOrden: 'O-1', metadata: {}, fechaExpiracion: null,
    });
    provider.consultarEstado.mockResolvedValue({ estado: 'pagada', response: {} });
    const res = await service.verificar('t-1', 'orden-1');
    expect(res.estado).toBe('pagada');
  });

  it('obtenerOrden aplica expiración perezosa', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1', tenantId: 't-1', estado: 'en_proceso',
      fechaExpiracion: new Date(Date.now() - 60_000), metadata: {},
    });
    const res = await service.obtenerOrden('t-1', 'orden-1');
    expect(res.estado).toBe('expirada');
  });
});
```

- [ ] **Step 2: Correr — FAIL. Implementar:**

```typescript
// cobros.service.ts
import {
  BadGatewayException, BadRequestException, Injectable, NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { randomBytes } from 'crypto';
import { PasarelaOrden } from '../entities/pasarela-orden.entity';
import { CreateCobroDto } from '../dto/create-cobro.dto';
import { CreateReembolsoDto } from '../dto/create-reembolso.dto';
import { InscripcionesService } from './inscripciones.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CredencialesService } from './credenciales.service';
import { ProviderFactory } from '../providers/provider.factory';
import { ProviderComunicacionError } from '../providers/payment-provider.interface';

const PASARELA_V1 = 'oneclick';
const EXPIRACION_ORDEN_MS = 2 * 60 * 60 * 1000; // 2 horas

@Injectable()
export class CobrosService {
  constructor(
    @InjectRepository(PasarelaOrden)
    private readonly ordenRepo: Repository<PasarelaOrden>,
    private readonly inscripciones: InscripcionesService,
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly transacciones: TransaccionesService,
    private readonly credenciales: CredencialesService,
    private readonly providerFactory: ProviderFactory,
  ) {}

  /** buyOrder ≤26 chars alfanumérico (límite Oneclick): 'O' + timestamp36 + 8 random. */
  private generarCodigoOrden(): string {
    return `O${Date.now().toString(36)}${randomBytes(4).toString('hex')}`.toUpperCase();
  }

  private toPublico(orden: PasarelaOrden, extra: Record<string, unknown> = {}) {
    return {
      ordenId: orden.ordenId,
      codigoOrden: orden.codigoOrden,
      pagadorRef: orden.pagadorRef,
      referenciaExterna: orden.referenciaExterna,
      descripcion: orden.descripcion,
      monto: orden.monto,
      moneda: orden.moneda,
      estado: orden.estado,
      creadoEl: orden.creadoEl,
      ...extra,
    };
  }

  async cobrar(
    tenantId: string,
    dto: CreateCobroDto,
    origen: 'interno' | 'api',
    apiKeyId?: string,
  ) {
    if (new Decimal(dto.monto).lte(0))
      throw new BadRequestException('El monto debe ser mayor a cero');

    const inscripcion = await this.inscripciones.resolverParaCobro(
      tenantId, dto.inscripcionId, dto.pagadorRef,
    );
    const { tenantPasarela, pasarela, cred } =
      await this.tenantPasarelaService.resolverConfiguracionActiva(tenantId, PASARELA_V1);
    const provider = this.providerFactory.get(pasarela.codigo);

    const orden = await this.ordenRepo.save(
      this.ordenRepo.create({
        tenantId,
        pagadorRef: inscripcion.pagadorRef,
        referenciaExterna: dto.referenciaExterna ?? null,
        codigoOrden: this.generarCodigoOrden(),
        descripcion: dto.descripcion,
        monto: dto.monto,
        moneda: 'CLP',
        estado: 'en_proceso',
        fechaExpiracion: new Date(Date.now() + EXPIRACION_ORDEN_MS),
        origen,
        apiKeyId: apiKeyId ?? null,
      }),
    );

    let resultado;
    try {
      resultado = await provider.autorizarCobro(cred, {
        username: inscripcion.identificadorUsuarioExterno,
        identificadorExterno: this.credenciales.descifrarTexto(inscripcion.identificadorExterno!),
        codigoOrden: orden.codigoOrden,
        monto: dto.monto,
        moneda: 'CLP',
        cuotas: dto.cuotas ?? 0,
      });
    } catch (e) {
      if (e instanceof ProviderComunicacionError) {
        // No sabemos si el cobro pasó: la orden QUEDA en_proceso (nunca asumir rechazo).
        await this.transacciones.registrar({
          tenantId, ordenId: orden.ordenId,
          tenantPasarelaId: tenantPasarela.tenantPasarelaId,
          inscripcionId: inscripcion.inscripcionId,
          tipo: 'AUTHORIZATION', estado: 'error',
          monto: dto.monto, moneda: 'CLP', codigoOrden: orden.codigoOrden,
          request: e.request, response: e.response,
        });
        throw new BadGatewayException(
          `No se pudo confirmar el cobro (orden ${orden.ordenId}); verifique el estado con POST /pasarela/api/ordenes/${orden.ordenId}/verificar`,
        );
      }
      throw e;
    }

    await this.transacciones.registrar({
      tenantId, ordenId: orden.ordenId,
      tenantPasarelaId: tenantPasarela.tenantPasarelaId,
      inscripcionId: inscripcion.inscripcionId,
      tipo: 'AUTHORIZATION',
      estado: resultado.aprobada ? 'aprobada' : 'rechazada',
      monto: dto.monto, moneda: 'CLP', codigoOrden: orden.codigoOrden,
      codigoAutorizacion: resultado.codigoAutorizacion,
      identificadorTransaccionExterno: resultado.identificadorTransaccionExterno,
      codigoRespuesta: resultado.codigoRespuesta,
      tipoPago: resultado.tipoPago,
      numeroCuotas: resultado.numeroCuotas,
      montoCuota: resultado.montoCuota,
      request: resultado.request, response: resultado.response,
    });

    orden.estado = resultado.aprobada ? 'pagada' : 'fallida';
    await this.ordenRepo.save(orden);

    return this.toPublico(orden, {
      codigoRespuesta: resultado.codigoRespuesta,
      codigoAutorizacion: resultado.codigoAutorizacion,
      tipoPago: resultado.tipoPago,
    });
  }

  async reembolsar(tenantId: string, ordenId: string, dto: CreateReembolsoDto) {
    const orden = await this.ordenRepo.findOne({ where: { ordenId, tenantId } });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    if (orden.estado !== 'pagada' && orden.estado !== 'reembolsada')
      throw new BadRequestException(`No se puede reembolsar una orden ${orden.estado}`);

    const historial = await this.transacciones.listarPorOrden(tenantId, ordenId);
    const autorizacion = historial.find(
      (t) => t.tipo === 'AUTHORIZATION' && t.estado === 'aprobada',
    );
    if (!autorizacion) throw new BadRequestException('La orden no tiene una autorización aprobada');

    const yaReembolsado = historial
      .filter((t) => t.tipo === 'REFUND' && t.estado === 'aprobada')
      .reduce((acc, t) => acc.plus(t.monto ?? '0'), new Decimal(0));
    const disponible = new Decimal(orden.monto).minus(yaReembolsado);
    if (new Decimal(dto.monto).gt(disponible))
      throw new BadRequestException(
        `El monto excede lo disponible para reembolso (${disponible.toString()})`,
      );

    const { pasarela, cred } =
      await this.tenantPasarelaService.resolverConfiguracionActiva(tenantId, PASARELA_V1);
    const resultado = await this.providerFactory
      .get(pasarela.codigo)
      .reembolsar(cred, { codigoOrden: orden.codigoOrden, monto: dto.monto });

    await this.transacciones.registrar({
      tenantId, ordenId,
      tenantPasarelaId: autorizacion.tenantPasarelaId,
      inscripcionId: autorizacion.inscripcionId,
      transaccionPadreId: autorizacion.transaccionId,
      tipo: 'REFUND',
      estado: resultado.aprobada ? 'aprobada' : 'rechazada',
      monto: dto.monto, moneda: orden.moneda, codigoOrden: orden.codigoOrden,
      codigoRespuesta: resultado.codigoRespuesta,
      tipoPago: resultado.tipoPago,
      request: resultado.request, response: resultado.response,
    });

    if (resultado.aprobada && yaReembolsado.plus(dto.monto).gte(orden.monto)) {
      orden.estado = 'reembolsada';
      await this.ordenRepo.save(orden);
    }
    return this.toPublico(orden, { reembolsoAprobado: resultado.aprobada });
  }

  /** Cierra una orden en_proceso consultando el estado real al proveedor. */
  async verificar(tenantId: string, ordenId: string) {
    const orden = await this.ordenRepo.findOne({ where: { ordenId, tenantId } });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    if (orden.estado !== 'en_proceso')
      throw new BadRequestException(`La orden ya está resuelta (${orden.estado})`);

    const { pasarela, cred } =
      await this.tenantPasarelaService.resolverConfiguracionActiva(tenantId, PASARELA_V1);
    const consulta = await this.providerFactory
      .get(pasarela.codigo)
      .consultarEstado(cred, orden.codigoOrden);

    if (consulta.estado !== 'desconocido') {
      orden.estado = consulta.estado;
      orden.metadata = { ...orden.metadata, verificacion: consulta.response };
      await this.ordenRepo.save(orden);
    }
    return this.toPublico(orden);
  }

  async obtenerOrden(tenantId: string, ordenId: string) {
    const orden = await this.ordenRepo.findOne({ where: { ordenId, tenantId } });
    if (!orden) throw new NotFoundException('Orden no encontrada');
    // Expiración perezosa: sin job en v1
    if (
      orden.estado === 'en_proceso' &&
      orden.fechaExpiracion && orden.fechaExpiracion < new Date()
    ) {
      orden.estado = 'expirada';
      await this.ordenRepo.save(orden);
    }
    const transacciones = await this.transacciones.listarPorOrden(tenantId, ordenId);
    return this.toPublico(orden, {
      transacciones: transacciones.map((t) => ({
        transaccionId: t.transaccionId, tipo: t.tipo, estado: t.estado,
        monto: t.monto, codigoAutorizacion: t.codigoAutorizacion,
        codigoRespuesta: t.codigoRespuesta, fechaTransaccion: t.fechaTransaccion,
      })),
    });
  }

  async listarOrdenes(tenantId: string, page = 1, pageSize = 15) {
    const [data, total] = await this.ordenRepo.findAndCount({
      where: { tenantId },
      order: { creadoEl: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      data: data.map((o) => this.toPublico(o, { origen: o.origen })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }
}
```

- [ ] **Step 3: Correr el test — debe pasar**

Run: `cd backend && npm test -- cobros.service`
Expected: PASS (7 tests).

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/pasarela/services/cobros.service.ts backend/src/modules/pasarela/services/cobros.service.spec.ts backend/src/modules/pasarela/dto/create-cobro.dto.ts backend/src/modules/pasarela/dto/create-reembolso.dto.ts
git commit -m "feat(pasarela): add charge/refund/verify flow with safe timeout handling"
```

---

### Task 9: Controllers + PasarelaModule + registro + seed

**Files:**
- Create: `backend/src/modules/pasarela/controllers/pasarela-admin.controller.ts`
- Create: `backend/src/modules/pasarela/controllers/pasarela-api.controller.ts`
- Create: `backend/src/modules/pasarela/controllers/pasarela-retorno.controller.ts`
- Create: `backend/src/modules/pasarela/dto/create-api-key.dto.ts`
- Create: `backend/src/modules/pasarela/pasarela.module.ts`
- Modify: `backend/src/app.module.ts` (import `PasarelaModule`)
- Modify: `backend/src/modules/seeder/seeder.service.ts` y `backend/src/modules/seeder/seeder.module.ts`

**Interfaces:**
- Consumes: todos los services (Tasks 2–8), guards del repo (`JwtAuthGuard`, `TenantGuard`, `PermisosGuard`, `@RequiresPermiso`), `ApiKeyGuard` (Task 3).
- Produces: rutas `/pasarela/admin/*`, `/pasarela/api/*`, `/pasarela/retorno/inscripcion`; módulo RBAC "Pasarelas" sembrado; pasarela `oneclick` sembrada con credenciales de integración cifradas.

- [ ] **Step 1: DTO de API key + controllers**

```typescript
// dto/create-api-key.dto.ts
import { IsString, Length } from 'class-validator';

export class CreateApiKeyDto {
  @IsString() @Length(1, 100)
  nombre: string;
}
```

```typescript
// controllers/pasarela-admin.controller.ts
import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { PermisosGuard } from '../../../common/guards/permisos.guard';
import { RequiresPermiso } from '../../../common/decorators/requires-permiso.decorator';
import type { JwtUser } from '../../../common/interfaces/jwt-user.interface';
import { TenantPasarelaService } from '../services/tenant-pasarela.service';
import { ApiKeysService } from '../services/api-keys.service';
import { CobrosService } from '../services/cobros.service';
import { CreateTenantPasarelaDto } from '../dto/create-tenant-pasarela.dto';
import { UpdateTenantPasarelaDto } from '../dto/update-tenant-pasarela.dto';
import { CreateApiKeyDto } from '../dto/create-api-key.dto';

@ApiTags('pasarela')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, PermisosGuard)
@Controller('pasarela/admin')
export class PasarelaAdminController {
  constructor(
    private readonly tenantPasarelaService: TenantPasarelaService,
    private readonly apiKeysService: ApiKeysService,
    private readonly cobrosService: CobrosService,
  ) {}

  private tenantId(req: Request): string {
    return (req.user as JwtUser).tenantId ?? '';
  }

  @Get('pasarelas-disponibles')
  @RequiresPermiso('Pasarelas', 'Leer')
  pasarelasDisponibles() {
    return this.tenantPasarelaService.listarPasarelasGlobales();
  }

  @Get('config')
  @RequiresPermiso('Pasarelas', 'Leer')
  listarConfig(@Req() req: Request) {
    return this.tenantPasarelaService.listar(this.tenantId(req));
  }

  @Post('config')
  @RequiresPermiso('Pasarelas', 'Crear')
  crearConfig(@Req() req: Request, @Body() dto: CreateTenantPasarelaDto) {
    return this.tenantPasarelaService.crear(this.tenantId(req), dto);
  }

  @Patch('config/:id')
  @RequiresPermiso('Pasarelas', 'Actualizar')
  actualizarConfig(
    @Req() req: Request, @Param('id') id: string, @Body() dto: UpdateTenantPasarelaDto,
  ) {
    return this.tenantPasarelaService.actualizar(this.tenantId(req), id, dto);
  }

  @Delete('config/:id')
  @RequiresPermiso('Pasarelas', 'Eliminar')
  eliminarConfig(@Req() req: Request, @Param('id') id: string) {
    return this.tenantPasarelaService.eliminar(this.tenantId(req), id);
  }

  @Get('api-keys')
  @RequiresPermiso('Pasarelas', 'Leer')
  listarApiKeys(@Req() req: Request) {
    return this.apiKeysService.listar(this.tenantId(req));
  }

  @Post('api-keys')
  @RequiresPermiso('Pasarelas', 'Crear')
  crearApiKey(@Req() req: Request, @Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.crear(this.tenantId(req), dto.nombre);
  }

  @Delete('api-keys/:id')
  @RequiresPermiso('Pasarelas', 'Eliminar')
  revocarApiKey(@Req() req: Request, @Param('id') id: string) {
    return this.apiKeysService.revocar(this.tenantId(req), id);
  }

  @Get('ordenes')
  @RequiresPermiso('Pasarelas', 'Leer')
  listarOrdenes(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.cobrosService.listarOrdenes(
      this.tenantId(req), Number(page ?? 1), Number(pageSize ?? 15),
    );
  }

  @Get('ordenes/:id')
  @RequiresPermiso('Pasarelas', 'Leer')
  obtenerOrden(@Req() req: Request, @Param('id') id: string) {
    return this.cobrosService.obtenerOrden(this.tenantId(req), id);
  }
}
```

```typescript
// controllers/pasarela-api.controller.ts
import {
  Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiKeyGuard, PasarelaAuth } from '../guards/api-key.guard';
import { InscripcionesService } from '../services/inscripciones.service';
import { CobrosService } from '../services/cobros.service';
import { CreateInscripcionDto } from '../dto/create-inscripcion.dto';
import { CreateCobroDto } from '../dto/create-cobro.dto';
import { CreateReembolsoDto } from '../dto/create-reembolso.dto';

type ApiRequest = Request & { pasarelaAuth: PasarelaAuth };

@ApiTags('pasarela')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('pasarela/api')
export class PasarelaApiController {
  constructor(
    private readonly inscripciones: InscripcionesService,
    private readonly cobros: CobrosService,
  ) {}

  @Post('inscripciones')
  iniciarInscripcion(@Req() req: ApiRequest, @Body() dto: CreateInscripcionDto) {
    return this.inscripciones.iniciar(req.pasarelaAuth.tenantId, dto);
  }

  @Get('inscripciones')
  listarInscripciones(@Req() req: ApiRequest, @Query('pagadorRef') pagadorRef: string) {
    return this.inscripciones.listarPorPagador(req.pasarelaAuth.tenantId, pagadorRef);
  }

  @Get('inscripciones/:id')
  obtenerInscripcion(@Req() req: ApiRequest, @Param('id') id: string) {
    return this.inscripciones.obtener(req.pasarelaAuth.tenantId, id);
  }

  @Delete('inscripciones/:id')
  eliminarInscripcion(@Req() req: ApiRequest, @Param('id') id: string) {
    return this.inscripciones.eliminar(req.pasarelaAuth.tenantId, id);
  }

  @Post('cobros')
  cobrar(@Req() req: ApiRequest, @Body() dto: CreateCobroDto) {
    return this.cobros.cobrar(req.pasarelaAuth.tenantId, dto, 'api', req.pasarelaAuth.apiKeyId);
  }

  @Post('cobros/:ordenId/reembolsos')
  reembolsar(
    @Req() req: ApiRequest, @Param('ordenId') ordenId: string, @Body() dto: CreateReembolsoDto,
  ) {
    return this.cobros.reembolsar(req.pasarelaAuth.tenantId, ordenId, dto);
  }

  @Post('ordenes/:id/verificar')
  verificar(@Req() req: ApiRequest, @Param('id') id: string) {
    return this.cobros.verificar(req.pasarelaAuth.tenantId, id);
  }

  @Get('ordenes/:id')
  obtenerOrden(@Req() req: ApiRequest, @Param('id') id: string) {
    return this.cobros.obtenerOrden(req.pasarelaAuth.tenantId, id);
  }
}
```

```typescript
// controllers/pasarela-retorno.controller.ts
import { BadRequestException, Controller, Get, Post, Query, Body, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InscripcionesService } from '../services/inscripciones.service';

/**
 * Retorno de Webpay tras la inscripción. Público: la credencial es el
 * TBK_TOKEN de un solo uso emitido por Transbank. Redirige (302) a la
 * url_retorno de la app consumidora con inscripcionId + estado.
 * Transbank puede volver por GET o por POST según el flujo.
 */
@ApiTags('pasarela')
@Controller('pasarela/retorno')
export class PasarelaRetornoController {
  constructor(private readonly inscripciones: InscripcionesService) {}

  private async procesar(token: string | undefined, res: Response) {
    if (!token) throw new BadRequestException('TBK_TOKEN requerido');
    const { urlRedireccion } = await this.inscripciones.confirmarRetorno(token);
    res.redirect(302, urlRedireccion);
  }

  @Get('inscripcion')
  retornoGet(@Query('TBK_TOKEN') token: string | undefined, @Res() res: Response) {
    return this.procesar(token, res);
  }

  @Post('inscripcion')
  retornoPost(@Body('TBK_TOKEN') token: string | undefined, @Res() res: Response) {
    return this.procesar(token, res);
  }
}
```

- [ ] **Step 2: PasarelaModule + registro en app.module.ts**

```typescript
// pasarela.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pasarela } from './entities/pasarela.entity';
import { TenantPasarela } from './entities/tenant-pasarela.entity';
import { PasarelaApiKey } from './entities/pasarela-api-key.entity';
import { PasarelaInscripcion } from './entities/pasarela-inscripcion.entity';
import { PasarelaMedioPago } from './entities/pasarela-medio-pago.entity';
import { PasarelaOrden } from './entities/pasarela-orden.entity';
import { PasarelaTransaccion } from './entities/pasarela-transaccion.entity';
import { CredencialesService } from './services/credenciales.service';
import { ApiKeysService } from './services/api-keys.service';
import { TenantPasarelaService } from './services/tenant-pasarela.service';
import { TransaccionesService } from './services/transacciones.service';
import { InscripcionesService } from './services/inscripciones.service';
import { CobrosService } from './services/cobros.service';
import { OneclickProvider } from './providers/oneclick/oneclick.provider';
import { ProviderFactory } from './providers/provider.factory';
import { ApiKeyGuard } from './guards/api-key.guard';
import { PasarelaAdminController } from './controllers/pasarela-admin.controller';
import { PasarelaApiController } from './controllers/pasarela-api.controller';
import { PasarelaRetornoController } from './controllers/pasarela-retorno.controller';

/**
 * Módulo pasarela — "junto pero no revuelto":
 * NO importa módulos de negocio (ventas/pagos/suscripciones/...).
 * Los módulos de negocio que quieran cobrar importan PasarelaModule e
 * inyectan InscripcionesService / CobrosService.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Pasarela, TenantPasarela, PasarelaApiKey, PasarelaInscripcion,
      PasarelaMedioPago, PasarelaOrden, PasarelaTransaccion,
    ]),
  ],
  controllers: [PasarelaAdminController, PasarelaApiController, PasarelaRetornoController],
  providers: [
    CredencialesService, ApiKeysService, TenantPasarelaService,
    TransaccionesService, InscripcionesService, CobrosService,
    OneclickProvider, ProviderFactory, ApiKeyGuard,
  ],
  exports: [CredencialesService, InscripcionesService, CobrosService],
})
export class PasarelaModule {}
```

En `app.module.ts`: `import { PasarelaModule } from './modules/pasarela/pasarela.module';` y agregar `PasarelaModule` al array `imports` (después de `SuscripcionesModule`).

- [ ] **Step 3: Seed (módulo RBAC + pasarela oneclick + tenant de dev)**

En `seeder.module.ts`: agregar `Pasarela` y `TenantPasarela` al `TypeOrmModule.forFeature([...])`, y `PasarelaModule` al array `imports` del módulo (para inyectar `CredencialesService`).

En `seeder.service.ts`:

1. Inyectar:

```typescript
@InjectRepository(Pasarela)
private readonly pasarelaRepo: Repository<Pasarela>,
@InjectRepository(TenantPasarela)
private readonly tenantPasarelaRepo: Repository<TenantPasarela>,
private readonly credencialesService: CredencialesService,
```

2. En `seedModulosApp()`, agregar al array `modulos`:

```typescript
{
  moduloAppId: '550e8400-e29b-41d4-a716-446655440208',
  nombre: 'Pasarelas',
  url: '/pasarelas',
  icono: 'mdi-credit-card-settings-outline',
  tieneConfiguracion: false,
},
```

3. En `seedModuloAppPermisos()`, agregar al array `entries` (IDs de permisos ya definidos en el método: LEER `...440012`, CREAR `...440013`, ACTUALIZAR `...440014`, ELIMINAR `...440015`):

```typescript
{
  moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440209',
  moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Pasarelas
  permisoId: LEER,
},
{
  moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440210',
  moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Pasarelas
  permisoId: CREAR,
},
{
  moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440211',
  moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Pasarelas
  permisoId: ACTUALIZAR,
},
{
  moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440212',
  moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Pasarelas
  permisoId: ELIMINAR,
},
```

4. En `seedTenantModulo()`, agregar:

```typescript
{
  moduloTenantId: '550e8400-e29b-41d4-a716-446655440213',
  tenantId: '550e8400-e29b-41d4-a716-446655440007',
  moduloAppId: '550e8400-e29b-41d4-a716-446655440208', // Paris → Pasarelas
  estado: 'activo',
  expiraEn: new Date('2026-12-31T23:59:59Z'),
},
```

5. Nuevo método `seedPasarelas()` (llamarlo en `onApplicationBootstrap` después de `seedTenantModulo()`), con las credenciales públicas del ambiente de integración de Transbank Oneclick Mall:

```typescript
private async seedPasarelas(): Promise<void> {
  const ONECLICK_ID = '550e8400-e29b-41d4-a716-446655440214';
  const existsPasarela = await this.pasarelaRepo.findOne({
    where: { pasarelaId: ONECLICK_ID },
  });
  if (!existsPasarela) {
    await this.pasarelaRepo.save(
      this.pasarelaRepo.create({
        pasarelaId: ONECLICK_ID,
        codigo: 'oneclick',
        nombre: 'Transbank Oneclick',
        soportaTokenizacion: true,
        soportaCobroRecurrente: true,
        soportaMall: true,
        urlProduccion: 'https://webpay3g.transbank.cl',
        urlPruebas: 'https://webpay3gint.transbank.cl',
        // Credenciales PÚBLICAS del ambiente de integración de Transbank (no son secretas)
        configuracionPruebas: this.credencialesService.cifrarJson({
          mallCommerceCode: '597055555541',
          apiKeySecret:
            '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
        }),
        configuracionProduccion: null,
        activo: true,
      }),
    );
  }

  // Paris → Oneclick modo MALL, ambiente pruebas (comercio hijo de integración)
  const TP_PARIS_ID = '550e8400-e29b-41d4-a716-446655440215';
  const existsTp = await this.tenantPasarelaRepo.findOne({
    where: { tenantPasarelaId: TP_PARIS_ID },
    withDeleted: true,
  });
  if (!existsTp) {
    await this.tenantPasarelaRepo.save(
      this.tenantPasarelaRepo.create({
        tenantPasarelaId: TP_PARIS_ID,
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        pasarelaId: ONECLICK_ID,
        ambiente: 'pruebas',
        modoIntegracion: 'mall',
        configuracion: this.credencialesService.cifrarJson({
          commerceCodeHijo: '597055555542',
        }),
        activo: true,
        prioridad: 1,
      }),
    );
  }
}
```

Nota: `tenantPasarelaId` es `@PrimaryGeneratedColumn` — al pasar el ID explícito TypeORM lo respeta (mismo patrón que otros seeds con `PrimaryGeneratedColumn`; verificar que la fila quede con ese UUID).

- [ ] **Step 4: Verificar arranque + smoke test HTTP**

Run: `cd backend && npm test && npm run lint && npx tsc --noEmit`
Expected: todo PASS.

Run: `docker-compose up -d --build && sleep 25 && docker-compose logs backend | grep -i -E "error|pasarela" | tail -5`
Expected: sin errores; seeder corrió.

Smoke test con curl (login como admin de Paris → crear API key → usarla):

```bash
# Login del seed dev (admin.paris / password 'admin') y selección del tenant Paris
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin.paris@paris.cl","password":"admin"}' | jq -r '.access_token')
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/switch-tenant \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"tenantId":"550e8400-e29b-41d4-a716-446655440007"}' | jq -r '.access_token')
curl -s http://localhost:3000/api/pasarela/admin/config -H "Authorization: Bearer $TOKEN" | jq
KEY=$(curl -s -X POST http://localhost:3000/api/pasarela/admin/api-keys \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"nombre":"smoke test"}' | jq -r '.apiKey')
curl -s "http://localhost:3000/api/pasarela/api/inscripciones?pagadorRef=nadie" \
  -H "Authorization: Bearer $KEY" | jq
```

Expected: config lista el tenant_pasarela sembrado; la key se crea con formato `pk_...`; el GET con API key responde `[]` (no 401).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/pasarela backend/src/app.module.ts backend/src/modules/seeder
git commit -m "feat(pasarela): wire controllers, module, RBAC seed and Transbank integration seed"
```

---

### Task 10: E2E opt-in contra el ambiente de integración de Transbank

**Files:**
- Create: `backend/test/pasarela-oneclick.e2e-spec.ts`

**Interfaces:**
- Consumes: `OneclickProvider` (Task 4) directamente (sin app Nest).
- No corre en `npm test` normal: solo con `RUN_TRANSBANK_E2E=1`.

- [ ] **Step 1: Escribir el e2e**

```typescript
// backend/test/pasarela-oneclick.e2e-spec.ts
import { OneclickProvider } from '../src/modules/pasarela/providers/oneclick/oneclick.provider';

const cred = {
  baseUrl: 'https://webpay3gint.transbank.cl',
  mallCommerceCode: '597055555541',
  apiKeySecret: '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
  commerceCodeHijo: '597055555542',
};

const correr = process.env.RUN_TRANSBANK_E2E === '1' ? describe : describe.skip;

correr('OneclickProvider e2e (integración Transbank real)', () => {
  const provider = new OneclickProvider();

  it('inicia una inscripción real y recibe token + url_webpay', async () => {
    const res = await provider.iniciarInscripcion(cred, {
      username: `insc-e2e${Date.now().toString(36)}`,
      email: 'e2e@test.cl',
      responseUrl: 'http://localhost:3000/api/pasarela/retorno/inscripcion',
    });
    expect(res.tokenExterno).toBeTruthy();
    expect(res.urlRedireccion).toContain('transbank');
  }, 15000);

  it('consultar una orden inexistente responde fallida/desconocido (no explota)', async () => {
    const res = await provider.consultarEstado(cred, `ONOEXISTE${Date.now().toString(36)}`.toUpperCase());
    expect(['fallida', 'desconocido']).toContain(res.estado);
  }, 15000);
});
```

(La confirmación de inscripción y el cobro real requieren ingresar la tarjeta de prueba en el formulario de Webpay — eso se cubre en la verificación manual de la Task 12.)

- [ ] **Step 2: Correr**

Run: `cd backend && RUN_TRANSBANK_E2E=1 npx jest --config ./test/jest-e2e.json pasarela-oneclick`
Expected: PASS (2 tests). Sin la env var: SKIPPED.

Run: `cd backend && npm test`
Expected: la suite normal no ejecuta el e2e.

- [ ] **Step 3: Commit**

```bash
git add backend/test/pasarela-oneclick.e2e-spec.ts
git commit -m "test(pasarela): add opt-in e2e against Transbank integration environment"
```

---

### Task 11: Frontend — página de administración `/pasarelas`

**Files:**
- Create: `frontend/app/pages/pasarelas.vue`
- Modify: `frontend/app/layouts/dashboard.vue` (link del sidebar)

**Interfaces:**
- Consumes: endpoints de Task 9 (`/pasarela/admin/*`), componentes CRUD del repo (`CrudPageHeader`, `CrudTable`, `CrudModal`), `AppNavbar`, `useApiFetch`, `useFormatters().formatFecha`, `permissionsStore.can`.
- Antes de escribir código de esta task: **invocar la skill `nuxt-ui`** (regla de memoria del proyecto).

- [ ] **Step 1: Link del sidebar**

En `frontend/app/layouts/dashboard.vue`, después del bloque de `Terceros`, agregar:

```typescript
if (permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Leer')) {
  base.push({
    label: 'Pasarelas',
    icon: 'i-lucide-plug-zap',
    to: '/pasarelas',
  })
}
```

- [ ] **Step 2: Página**

`frontend/app/pages/pasarelas.vue` — página suelta con `layout: 'dashboard'` (esqueleto §2 de `docs/patterns/frontend.md`), tres tabs con `UTabs`:

```vue
<script setup lang="ts">
definePageMeta({ middleware: 'auth', layout: 'dashboard' })

interface PasarelaGlobal {
  pasarelaId: string; codigo: string; nombre: string
  soportaTokenizacion: boolean; soportaCobroRecurrente: boolean; soportaMall: boolean
}
interface TenantPasarelaRow {
  tenantPasarelaId: string; pasarelaId: string; codigo: string; nombre: string
  ambiente: string; modoIntegracion: string; activo: boolean; prioridad: number
  tieneCredenciales: boolean; creadoEl: string
}
interface ApiKeyRow {
  apiKeyId: string; nombre: string; prefijo: string
  ultimoUsoEl: string | null; revocadaEl: string | null; creadoEl: string
}
interface OrdenRow {
  ordenId: string; codigoOrden: string; pagadorRef: string | null
  referenciaExterna: string | null; descripcion: string; monto: string
  moneda: string; estado: string; origen: string; creadoEl: string
}

const config = useRuntimeConfig()
const apiUrl = config.public.apiUrl
const toast = useToast()
const { formatFecha, formatMonto } = useFormatters()
const permissionsStore = usePermissionsStore()

const tab = ref('config')
const tabs = [
  { label: 'Mis pasarelas', value: 'config', icon: 'i-lucide-plug-zap' },
  { label: 'API Keys', value: 'keys', icon: 'i-lucide-key-round' },
  { label: 'Órdenes', value: 'ordenes', icon: 'i-lucide-receipt' },
]

// ---------- Tab 1: Mis pasarelas ----------
const configs = ref<TenantPasarelaRow[]>([])
const globales = ref<PasarelaGlobal[]>([])
const loadingConfig = ref(false)
const drawerOpen = ref(false)
const editingId = ref<string | null>(null)

function emptyForm() {
  return {
    pasarelaId: '',
    ambiente: 'pruebas',
    modoIntegracion: 'mall',
    commerceCodeHijo: '',
    credencialesIndividual: { mallCommerceCode: '', apiKeySecret: '', commerceCodeHijo: '' },
    activo: true,
    prioridad: '1',
  }
}
const form = ref(emptyForm())
const tocoCredenciales = ref(false) // write-only: solo mandar si se tipeó algo

async function cargarConfig() {
  loadingConfig.value = true
  try {
    const [cfg, glob] = await Promise.all([
      useApiFetch<TenantPasarelaRow[]>(`${apiUrl}/pasarela/admin/config`),
      useApiFetch<PasarelaGlobal[]>(`${apiUrl}/pasarela/admin/pasarelas-disponibles`),
    ])
    configs.value = cfg
    globales.value = glob
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar pasarelas', color: 'error' })
  } finally {
    loadingConfig.value = false
  }
}

function abrirCrear() {
  editingId.value = null
  form.value = emptyForm()
  tocoCredenciales.value = false
  drawerOpen.value = true
}

function abrirEditar(row: TenantPasarelaRow) {
  editingId.value = row.tenantPasarelaId
  form.value = {
    ...emptyForm(),
    pasarelaId: row.pasarelaId,
    ambiente: row.ambiente,
    modoIntegracion: row.modoIntegracion,
    activo: row.activo,
    prioridad: String(row.prioridad),
  }
  tocoCredenciales.value = false
  drawerOpen.value = true
}

async function guardarConfig() {
  const payload: Record<string, unknown> = {
    ambiente: form.value.ambiente,
    modoIntegracion: form.value.modoIntegracion,
    activo: form.value.activo,
    prioridad: Number(form.value.prioridad),
  }
  if (!editingId.value) payload.pasarelaId = form.value.pasarelaId
  // Write-only: la configuración solo viaja si el usuario la tipeó
  if (tocoCredenciales.value) {
    payload.configuracion =
      form.value.modoIntegracion === 'mall'
        ? { commerceCodeHijo: form.value.commerceCodeHijo }
        : { ...form.value.credencialesIndividual }
  }
  try {
    if (editingId.value) {
      await useApiFetch(`${apiUrl}/pasarela/admin/config/${editingId.value}`, {
        method: 'PATCH', body: payload,
      })
    } else {
      await useApiFetch(`${apiUrl}/pasarela/admin/config`, { method: 'POST', body: payload })
    }
    toast.add({ title: 'Pasarela guardada', color: 'success' })
    drawerOpen.value = false
    await cargarConfig()
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al guardar', color: 'error' })
  }
}

const eliminandoConfig = ref<TenantPasarelaRow | null>(null)
const eliminarConfigOpen = ref(false)
async function confirmarEliminarConfig() {
  if (!eliminandoConfig.value) return
  try {
    await useApiFetch(
      `${apiUrl}/pasarela/admin/config/${eliminandoConfig.value.tenantPasarelaId}`,
      { method: 'DELETE' },
    )
    toast.add({ title: 'Pasarela eliminada', color: 'success' })
    await cargarConfig()
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al eliminar', color: 'error' })
  } finally {
    eliminarConfigOpen.value = false
  }
}

// ---------- Tab 2: API Keys ----------
const keys = ref<ApiKeyRow[]>([])
const loadingKeys = ref(false)
const nuevaKeyNombre = ref('')
const keyCreadaModal = ref(false)
const keyCreada = ref('')
const crearKeyOpen = ref(false)

async function cargarKeys() {
  loadingKeys.value = true
  try {
    keys.value = await useApiFetch<ApiKeyRow[]>(`${apiUrl}/pasarela/admin/api-keys`)
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar API keys', color: 'error' })
  } finally {
    loadingKeys.value = false
  }
}

async function crearKey() {
  try {
    const res = await useApiFetch<{ apiKey: string }>(`${apiUrl}/pasarela/admin/api-keys`, {
      method: 'POST', body: { nombre: nuevaKeyNombre.value },
    })
    keyCreada.value = res.apiKey
    crearKeyOpen.value = false
    keyCreadaModal.value = true
    nuevaKeyNombre.value = ''
    await cargarKeys()
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al crear la key', color: 'error' })
  }
}

async function copiarKey() {
  await navigator.clipboard.writeText(keyCreada.value)
  toast.add({ title: 'Key copiada al portapapeles', color: 'success' })
}

const revocando = ref<ApiKeyRow | null>(null)
const revocarOpen = ref(false)
async function confirmarRevocar() {
  if (!revocando.value) return
  try {
    await useApiFetch(`${apiUrl}/pasarela/admin/api-keys/${revocando.value.apiKeyId}`, {
      method: 'DELETE',
    })
    toast.add({ title: 'API key revocada', color: 'success' })
    await cargarKeys()
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al revocar', color: 'error' })
  } finally {
    revocarOpen.value = false
  }
}

// ---------- Tab 3: Órdenes ----------
const ordenes = ref<OrdenRow[]>([])
const ordenesMeta = ref({ page: 1, pageSize: 15, total: 0, totalPages: 0 })
const ordenesPage = ref(1)
const loadingOrdenes = ref(false)

async function cargarOrdenes() {
  loadingOrdenes.value = true
  try {
    const res = await useApiFetch<{ data: OrdenRow[]; meta: typeof ordenesMeta.value }>(
      `${apiUrl}/pasarela/admin/ordenes?page=${ordenesPage.value}&pageSize=15`,
    )
    ordenes.value = res.data
    ordenesMeta.value = res.meta
  } catch (e: unknown) {
    const msg = (e as { data?: { message?: string } })?.data?.message
    toast.add({ title: msg ?? 'Error al cargar órdenes', color: 'error' })
  } finally {
    loadingOrdenes.value = false
  }
}
watch(ordenesPage, cargarOrdenes)

const estadoColor: Record<string, string> = {
  pagada: 'success', fallida: 'error', en_proceso: 'warning',
  expirada: 'neutral', reembolsada: 'info', creada: 'neutral',
}

onMounted(() => {
  cargarConfig()
  cargarKeys()
  cargarOrdenes()
})
</script>

<template>
  <UDashboardPanel>
    <template #header>
      <AppNavbar title="Pasarelas de pago">
        <template #right>
          <UserMenu />
        </template>
      </AppNavbar>
    </template>

    <template #body>
      <div class="max-w-5xl mx-auto space-y-6 py-6">
        <CrudPageHeader
          title="Pasarelas de pago"
          description="Configura tus proveedores de pago (Oneclick, Webpay…) y genera las API keys para tus aplicaciones externas."
        />

        <UTabs v-model="tab" :items="tabs" />

        <!-- Tab 1: Mis pasarelas -->
        <template v-if="tab === 'config'">
          <div class="flex justify-end">
            <UButton
              v-if="permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Crear')"
              icon="i-lucide-plus" label="Agregar pasarela" @click="abrirCrear"
            />
          </div>
          <div v-if="loadingConfig" class="text-center text-muted py-8">Cargando…</div>
          <div v-else-if="!configs.length" class="text-center text-muted py-8">
            Aún no tienes pasarelas configuradas.
          </div>
          <ul v-else class="divide-y divide-default">
            <li
              v-for="c in configs" :key="c.tenantPasarelaId"
              class="flex items-center justify-between gap-4 py-3"
            >
              <div>
                <p class="font-medium text-default">{{ c.nombre }}</p>
                <p class="text-sm text-muted">
                  {{ c.modoIntegracion === 'mall' ? 'Mall' : 'Individual' }} ·
                  {{ c.ambiente === 'pruebas' ? 'Pruebas' : 'Producción' }} ·
                  prioridad {{ c.prioridad }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge v-if="!c.tieneCredenciales" color="warning" variant="subtle">
                  Sin credenciales
                </UBadge>
                <UBadge :color="c.activo ? 'success' : 'neutral'" variant="subtle">
                  {{ c.activo ? 'Activa' : 'Inactiva' }}
                </UBadge>
                <UButton
                  icon="i-lucide-pencil" variant="ghost" size="xs"
                  @click="abrirEditar(c)"
                />
                <UButton
                  icon="i-lucide-trash-2" color="error" variant="ghost" size="xs"
                  @click="eliminandoConfig = c; eliminarConfigOpen = true"
                />
              </div>
            </li>
          </ul>
        </template>

        <!-- Tab 2: API Keys -->
        <template v-else-if="tab === 'keys'">
          <div class="flex justify-end">
            <UButton
              v-if="permissionsStore.esAdmin || permissionsStore.can('Pasarelas', 'Crear')"
              icon="i-lucide-plus" label="Nueva API key" @click="crearKeyOpen = true"
            />
          </div>
          <div v-if="loadingKeys" class="text-center text-muted py-8">Cargando…</div>
          <div v-else-if="!keys.length" class="text-center text-muted py-8">
            Sin API keys. Crea una para conectar tus apps externas.
          </div>
          <ul v-else class="divide-y divide-default">
            <li v-for="k in keys" :key="k.apiKeyId" class="flex items-center justify-between gap-4 py-3">
              <div>
                <p class="font-medium text-default">{{ k.nombre }}</p>
                <p class="text-sm text-muted font-mono">{{ k.prefijo }}</p>
              </div>
              <div class="flex items-center gap-2 text-sm text-muted">
                <span>Último uso: {{ k.ultimoUsoEl ? formatFecha(k.ultimoUsoEl) : 'nunca' }}</span>
                <UBadge :color="k.revocadaEl ? 'neutral' : 'success'" variant="subtle">
                  {{ k.revocadaEl ? 'Revocada' : 'Activa' }}
                </UBadge>
                <UButton
                  v-if="!k.revocadaEl"
                  icon="i-lucide-ban" color="error" variant="ghost" size="xs"
                  @click="revocando = k; revocarOpen = true"
                />
              </div>
            </li>
          </ul>
        </template>

        <!-- Tab 3: Órdenes -->
        <template v-else>
          <div v-if="loadingOrdenes" class="text-center text-muted py-8">Cargando…</div>
          <div v-else-if="!ordenes.length" class="text-center text-muted py-8">
            Sin órdenes de cobro todavía.
          </div>
          <template v-else>
            <ul class="divide-y divide-default">
              <li v-for="o in ordenes" :key="o.ordenId" class="flex items-center justify-between gap-4 py-3">
                <div>
                  <p class="font-medium text-default">{{ o.descripcion }}</p>
                  <p class="text-sm text-muted font-mono">
                    {{ o.codigoOrden }}
                    <span v-if="o.referenciaExterna"> · ref {{ o.referenciaExterna }}</span>
                    <span v-if="o.pagadorRef"> · {{ o.pagadorRef }}</span>
                  </p>
                </div>
                <div class="flex items-center gap-3">
                  <span class="font-medium text-default">{{ formatMonto(o.monto) }}</span>
                  <UBadge :color="estadoColor[o.estado] ?? 'neutral'" variant="subtle">
                    {{ o.estado }}
                  </UBadge>
                  <span class="text-sm text-muted">{{ formatFecha(o.creadoEl) }}</span>
                </div>
              </li>
            </ul>
            <div v-if="ordenesMeta.total > 15" class="flex justify-end pt-4">
              <UPagination v-model:page="ordenesPage" :items-per-page="15" :total="ordenesMeta.total" />
            </div>
          </template>
        </template>

        <!-- Drawer alta/edición de pasarela -->
        <AppDrawer v-model:open="drawerOpen" width="40%">
          <template #header>
            <span class="font-semibold text-default">
              {{ editingId ? 'Editar pasarela' : 'Agregar pasarela' }}
            </span>
          </template>
          <div class="space-y-4 p-4">
            <UFormField v-if="!editingId" label="Pasarela">
              <USelectMenu
                v-model="form.pasarelaId" value-key="pasarelaId" label-key="nombre"
                :items="globales" placeholder="Selecciona un proveedor"
              />
            </UFormField>
            <UFormField label="Ambiente">
              <USelect
                v-model="form.ambiente"
                :items="[{ label: 'Pruebas', value: 'pruebas' }, { label: 'Producción', value: 'produccion' }]"
              />
            </UFormField>
            <UFormField label="Modo de integración">
              <USelect
                v-model="form.modoIntegracion"
                :items="[{ label: 'Mall (comercio de la plataforma)', value: 'mall' }, { label: 'Individual (credenciales propias)', value: 'individual' }]"
              />
            </UFormField>

            <template v-if="form.modoIntegracion === 'mall'">
              <UFormField label="Código de comercio hijo" help="Asignado por la plataforma dentro de su mall">
                <UInput
                  v-model="form.commerceCodeHijo"
                  :placeholder="editingId ? '•••• (escribe para reemplazar)' : '597055555542'"
                  @input="tocoCredenciales = true"
                />
              </UFormField>
            </template>
            <template v-else>
              <UFormField label="Código de comercio mall">
                <UInput
                  v-model="form.credencialesIndividual.mallCommerceCode"
                  :placeholder="editingId ? '•••• (escribe para reemplazar)' : ''"
                  @input="tocoCredenciales = true"
                />
              </UFormField>
              <UFormField label="API key secret">
                <UInput
                  v-model="form.credencialesIndividual.apiKeySecret" type="password"
                  :placeholder="editingId ? '•••• (escribe para reemplazar)' : ''"
                  @input="tocoCredenciales = true"
                />
              </UFormField>
              <UFormField label="Código de comercio hijo">
                <UInput
                  v-model="form.credencialesIndividual.commerceCodeHijo"
                  :placeholder="editingId ? '•••• (escribe para reemplazar)' : ''"
                  @input="tocoCredenciales = true"
                />
              </UFormField>
            </template>

            <UFormField label="Prioridad">
              <UInput v-model="form.prioridad" inputmode="numeric" />
            </UFormField>
            <UFormField label="Activa">
              <USwitch v-model="form.activo" />
            </UFormField>
            <div class="flex justify-end gap-2 pt-2">
              <UButton variant="ghost" label="Cancelar" @click="drawerOpen = false" />
              <UButton label="Guardar" @click="guardarConfig" />
            </div>
          </div>
        </AppDrawer>

        <!-- Modales -->
        <CrudModal
          v-model:open="eliminarConfigOpen"
          title="Eliminar pasarela"
          :message="`¿Eliminar la configuración de ${eliminandoConfig?.nombre ?? ''}? Las apps que la usen dejarán de poder cobrar.`"
          @confirm="confirmarEliminarConfig"
        />
        <CrudModal
          v-model:open="revocarOpen"
          title="Revocar API key"
          :message="`¿Revocar la key '${revocando?.nombre ?? ''}'? Las apps que la usen recibirán 401 inmediatamente.`"
          @confirm="confirmarRevocar"
        />

        <UModal v-model:open="crearKeyOpen" title="Nueva API key">
          <template #body>
            <UFormField label="Nombre descriptivo" help="Ej: app móvil bodega">
              <UInput v-model="nuevaKeyNombre" placeholder="Nombre de la key" />
            </UFormField>
          </template>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton variant="ghost" label="Cancelar" @click="crearKeyOpen = false" />
              <UButton label="Crear" :disabled="!nuevaKeyNombre.trim()" @click="crearKey" />
            </div>
          </template>
        </UModal>

        <UModal v-model:open="keyCreadaModal" title="API key creada">
          <template #body>
            <div class="space-y-3">
              <p class="text-sm text-muted">
                Copia la key ahora — <strong>no volverás a verla</strong>. Guárdala en un lugar seguro.
              </p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-sm bg-elevated rounded px-3 py-2 break-all">{{ keyCreada }}</code>
                <UButton icon="i-lucide-copy" variant="ghost" @click="copiarKey" />
              </div>
            </div>
          </template>
          <template #footer>
            <div class="flex justify-end">
              <UButton label="Entendido" @click="keyCreadaModal = false" />
            </div>
          </template>
        </UModal>
      </div>
    </template>
  </UDashboardPanel>
</template>
```

- [ ] **Step 3: Verificar build**

Run: `cd frontend && npm run build`
Expected: build OK sin errores de tipos.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/pasarelas.vue frontend/app/layouts/dashboard.vue
git commit -m "feat(pasarela): add tenant gateway admin page (config, API keys, orders)"
```

---

### Task 12: Verificación manual de punta a punta + docs vivas

**Files:**
- Create: `docs/features/pasarela-pagos.md` (desde `docs/features/TEMPLATE.md`)
- Create: `docs/adr/005-cifrado-credenciales-pasarela.md`
- Modify: `docs/adr/README.md` (índice), `docs/README.md` (link a la feature), `CLAUDE.md` (tabla "Estado actual")

- [ ] **Step 1: Verificación manual del flujo completo** (con el stack corriendo: `docker-compose up -d --build`)

1. Login como admin del tenant Paris → sidebar muestra "Pasarelas".
2. Tab "Mis pasarelas": aparece Transbank Oneclick (Mall · Pruebas, sembrada). Probar editar (los campos de credenciales muestran placeholder `••••` y solo se reemplazan si se tipea).
3. Tab "API Keys": crear key "prueba manual" → modal muestra `pk_…` completa una sola vez → copiar.
4. Inscripción vía API key (`$KEY` = la key copiada):
   ```bash
   curl -s -X POST http://localhost:3000/api/pasarela/api/inscripciones \
     -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
     -d '{"pagadorRef":"cliente-demo-1","email":"demo@test.cl","urlRetorno":"http://localhost:5173/retorno-demo"}' | jq
   ```
   → abrir `urlWebpay` en el navegador, ingresar la tarjeta de prueba VISA `4051 8856 0044 6623` (CVV `123`, cualquier fecha futura; RUT `11.111.111-1`, clave `123`) → Transbank redirige al backend → el backend redirige a `http://localhost:5173/retorno-demo?inscripcionId=…&estado=activa`.
5. Cobro:
   ```bash
   curl -s -X POST http://localhost:3000/api/pasarela/api/cobros \
     -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
     -d '{"pagadorRef":"cliente-demo-1","referenciaExterna":"venta-demo-42","monto":"5990","descripcion":"Cobro de prueba"}' | jq
   ```
   Expected: `estado: "pagada"`, con `codigoAutorizacion`.
6. Reembolso parcial y total:
   ```bash
   curl -s -X POST http://localhost:3000/api/pasarela/api/cobros/<ordenId>/reembolsos \
     -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{"monto":"5990"}' | jq
   ```
   Expected: `estado: "reembolsada"`.
7. Tab "Órdenes" en la UI: la orden aparece con su estado y monto formateado.
8. Revocar la API key → repetir el curl del cobro → 401.
9. Verificar en BD que nada sensible quedó en claro:
   ```bash
   docker-compose exec db psql -U postgres -d startup -c \
     "SELECT identificador_externo FROM pasarela_inscripciones LIMIT 1;"
   ```
   Expected: blob `v1:…`, no un tbkUser legible. Ídem `request/response` de `pasarela_transacciones` sin `Tbk-Api-Key-Secret` ni `tbk_user` en claro.

- [ ] **Step 2: Docs vivas**

1. `docs/features/pasarela-pagos.md` desde el TEMPLATE: qué es, modelo de datos (7 tablas), flujos (inscripción/cobro/reembolso/verificar), endpoints de los 3 controllers, seguridad (API keys, cifrado, redacción), cómo probar (resumen del Step 1). Link en `docs/README.md`.
2. `docs/adr/005-cifrado-credenciales-pasarela.md`: decisión de cifrado app-level AES-256-GCM con clave maestra en env (vs texto plano vs secrets manager), formato `v1:iv:tag:data`, API keys hasheadas SHA-256, redacción de request/response. Registrar en `docs/adr/README.md`.
3. `CLAUDE.md` tabla "Estado actual": agregar fila `| Pasarela de pagos (Oneclick real, API keys m2m, admin UI) | ✅ Implementado (2026-07-07) |`.

- [ ] **Step 3: Suite completa final**

Run: `cd backend && npm test && npm run lint && npx tsc --noEmit && cd ../frontend && npm run build`
Expected: todo PASS.

- [ ] **Step 4: Commit final**

```bash
git add docs CLAUDE.md
git commit -m "docs(pasarela): add feature doc, ADR-005 (credential encryption) and status update"
```

---

## Fuera de alcance (recordatorio del spec)

Reconectar suscripciones/tienda a la pasarela real, job de cobro recurrente, Webpay Plus/Stripe/MercadoPago, webhooks entrantes, failover por `prioridad`, rotación de clave de cifrado.
