# Plan: el perfil fiscal del emisor (subproyecto 1 del emisor DTE)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft · **Date:** 2026-10-14 · **Owner:** Cesar Matheus

**Goal:** que cada tenant tenga un emisor completo, con certificado y CAF guardados cifrados, y que los folios se tomen sin repetirse ni dejar huecos, todo listo para que el subproyecto 4 emita.

**Architecture:**
- **Datos.** El emisor es la razón social preferida y habilitada. Suma giro, comuna, ambiente y resolución.
- **Tablas nuevas.**
  - `dte_certificados`: la llave y el certificado, cifrados con `DTE_ENCRYPTION_KEY`.
  - `dte_cafs`: el XML cifrado y un contador `siguiente_folio`.
- **Folio.** Se toma con un UPDATE sobre la fila del CAF, dentro de la transacción de quien lo pide.
- **HTTP.** Admin del tenant. La pantalla aparece en el menú solo para el superadmin hasta el subproyecto 4.

**Tech Stack:** NestJS + TypeORM (migraciones, ADR-030), `Db`/`TxContext` (ADR-020), AES-256-GCM (formato de ADR-008), el motor `backend/src/modules/dte/` (ADR-033), Nuxt 4 + Nuxt UI, Jest, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-14-perfil-fiscal-emisor-design.md`](../specs/2026-10-14-perfil-fiscal-emisor-design.md), aprobada por el owner el 2026-10-14.

## Context

- El motor (subproyecto 2) está en `main` desde `fd2670bd`. Su API pública está en [`features/emision-electronica.md`](../../features/emision-electronica.md):
  - `leerCaf(xml): CafLeido`;
  - `leerCertificado(pfx, clave): CertificadoLeido`;
  - `emitirBoleta`;
  - `armarEnvioBoleta(…, caratula: CaratulaEnvio, …)`.
- `razones_sociales` ya existe (`backend/src/modules/tenants/entities/razon-social.entity.ts`) con `nombre`, `rut`, `direccion`, `habilitado` y `preferida`. **Ninguna del seed es preferida**, y el RUT sembrado `76.123.456-7` **no es válido** (su DV es 0).
- El cifrado de la pasarela es `backend/src/modules/pasarela/services/credenciales.service.ts`. Este plan copia sus dos funciones a un servicio propio, con otra clave (spec § 2.4).

## Decisions / Open questions

Decisiones del controlador al escribir el plan, sobre lo que la spec dejó abierto:

- **El ambiente del CAF no se deduce del `IDK`.**
  - Lo que se midió el 2026-10-14: el instructivo técnico del SII (sección A.1, letra h) define `IDK` como "identificación de la llave pública del SII que permite verificar la firma del SII sobre el CAF". Es el id de una llave, no un ambiente.
  - El único CAF real a mano, el ejemplo del SII, trae 100. Eso no prueba que producción traiga otro valor.
  - Según la spec § 3, si no se puede confirmar, la regla no se escribe. Entonces:
    - **el CAF toma el ambiente que tiene la razón social al subirlo**;
    - el `IDK` se guarda solo para mostrarlo;
    - un CAF de producción subido con la empresa en certificación **no se detecta**: queda en "Lo que queda abierto".
  - La tarea 1 corrige la spec en § 2.3, § 3 y § 8.
- **El CAF viaja en base64, no como texto** (`{xmlBase64}`; la spec decía `{xml}`).
  - El archivo del SII es ISO-8859-1.
  - En el navegador, `TextDecoder('iso-8859-1')` es windows-1252: los bytes 0x80–0x9F salen como otros caracteres, y `leerCaf` rechazaría el CAF.
  - El backend decodifica `Buffer.from(b64, 'base64').toString('latin1')`. La tarea 1 corrige la spec.
- **`tomarFolio` no recibe `EntityManager`.** Usa `db.query`, que resuelve la transacción del contexto (ADR-020, `docs/patterns/backend.md` § 9). Exige que haya una (`TxContext.managerActivo()`): fuera de una transacción, el folio se consumiría aunque la venta falle.
- **`tomarFolio` reintenta una vez si no encuentra fila.**
  - Es una consulta `ORDER BY … LIMIT 1 FOR UPDATE` en READ COMMITTED. Si otra transacción agota el CAF mientras esta espera el bloqueo, la fila deja de cumplir el WHERE al re-evaluarse y el LIMIT ya la contó, así que sale **vacío** aunque haya otro CAF con folios.
  - La segunda sentencia toma una foto nueva y ve el CAF siguiente.
  - Lo fija una prueba determinística en la tarea 7.
- **Las subidas bloquean la fila de la razón social** (`FOR UPDATE`) antes de mirar solapes y de reemplazar el certificado.
  - Un doble clic en "subir" no deja entrar el mismo CAF dos veces.
  - La protección de la tarea 8 toma el mismo bloqueo, así que un cambio de RUT no se cruza con una subida.
  - `tomarFolio` no bloquea `razones_sociales`: no hay ciclo.
- **Folios en `integer`.** El XSD admite 10 dígitos, que no caben en int4. Un CAF con `hasta` > 2.147.483.646 se rechaza con 400. Ningún comercio llega ahí.
- **`DTE_ENCRYPTION_KEY` hace falta antes del push.** Se suma a:
  - `.env.example`;
  - `docker-compose.yml`, con un default igual al de la pasarela;
  - los dos jobs del CI;
  - `backend/test/setup-env.ts`, con `??=`, para que el `.env` viejo de un worktree no deje caer el e2e.
  - En Railway la carga el owner antes del push (tarea 10). **No se pushea nada de este plan hasta esa tarea.**

## Global Constraints

- Español en código, mensajes y docs. Mensajes de error para el dueño del local, sin jerga.
- `tenant_id` siempre del token. Toda lectura filtra `eliminado_el IS NULL`, en cada join. Nunca `DELETE`: borrar es soft delete o poner un blob en null.
- Nada cifrado ni descifrado sale en una respuesta HTTP. La clave del `.pfx` no se guarda ni se loguea.
- Todas las rutas `/dte/*` llevan `@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)`.
- Umbrales: `UMBRAL_FOLIOS = 100` y `DIAS_AVISO_CERTIFICADO = 30`.
- Límites del XSD: `RznSocEmisor` 100, `GiroEmisor` 80, `DirOrigen` 70 y `CmnaOrigen` 20. Texto ISO-8859-1, validado con `validarTexto` del motor.
- Tipos aceptados: 39 y 41. Ambientes: `'certificacion'` y `'produccion'`.
- Repos con `RepositoriosModule.forFeature`, acceso crudo con `Db` y `RETURNING` por `unwrap()`. Entity nueva en `ENTIDADES` más su migración generada y leída (`docs/patterns/backend.md` § 1, 5, 9 y 22).
- Subagentes con `model: 'sonnet'`. Commit y recibo de revisión los hace el controlador. Nunca `--no-verify`. Stage por ruta, nunca `.claude/settings.local.json`.
- No escribir en un archivo el literal de cabecera PEM de llave privada (el repo es público): las llaves de prueba se generan en tiempo de ejecución.

## Review Focus

1. **Doble clic al subir el mismo CAF:** dos POST simultáneos con el mismo archivo. Entra uno y el otro recibe 400 "Esos folios ya están cargados" (tarea 6).
2. **CAF del SII con tildes y Ñ en `RS`**, guardado por Windows en ISO-8859-1 con CRLF: se sube y se lee igual (tarea 6).
3. **El CAF se agota mientras otra caja espera su folio:** la segunda saca el primer folio del CAF siguiente, no `SIN_FOLIOS` (tarea 7).
4. **Cambiar la preferida a otra razón social:** los CAF de la anterior no se toman ni aparecen en el perfil (tarea 7).
5. **Un 400 del certificado no repite la clave:** el body de error no contiene la clave enviada (tarea 5).

## Scope / Out of scope

Lo de la spec § 1. Además, fuera de este plan:
- el aviso en el POS (subproyecto 4);
- abrir el menú a todo admin (subproyecto 4, una línea en `configuracion.vue`).

---

### Task 1: el motor devuelve lo que el perfil guarda

**Files:**
- Modify: `backend/src/modules/dte/caf.ts` (`CafLeido`, `leerCaf`)
- Modify: `backend/src/modules/dte/firma.ts` (`CertificadoLeido`, `leerCertificado`)
- Modify: `backend/src/modules/dte/dte.types.ts` (`CodigoDteError`)
- Modify: `backend/src/modules/dte/__fixtures__/credenciales-prueba.ts` (`certificadoDePrueba`)
- Test: `backend/src/modules/dte/caf.spec.ts`, `backend/src/modules/dte/firma.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-14-perfil-fiscal-emisor-design.md` (§ 2.3, § 3 y § 8: las dos primeras decisiones de arriba)

**Interfaces:**
- Produces:
  - `CafLeido` suma `idk: number` y `fechaAutorizacion: string` (`FA`, AAAA-MM-DD).
  - `CertificadoLeido` suma `nombre: string` (el `commonName` del sujeto, o `''` si no trae) y `venceEl: Date` (`validity.notAfter`).
  - `CodigoDteError` suma `'SIN_FOLIOS' | 'SIN_CERTIFICADO' | 'CERTIFICADO_VENCIDO' | 'PERFIL_INCOMPLETO'`.
  - `certificadoDePrueba({ rut?, venceEl?: Date, nombre?: string })`. Por defecto vence en 2036 y se llama `'Firmante de Prueba'`.

- [ ] **Step 1: Tests que fallan.** En `caf.spec.ts`:

```ts
it('devuelve el IDK y la fecha de autorización', () => {
  const caf = leerCaf(cafDePrueba({ rut: '76543210-3', tipo: 39, desde: 7, hasta: 19 }));
  expect(caf.idk).toBe(100);
  expect(caf.fechaAutorizacion).toBe('2026-10-01');
});
it('rechaza un FA que no es fecha', () => {
  const xml = cafDePrueba({ rut: '76543210-3', tipo: 39, desde: 7, hasta: 19 })
    .split('<FA>2026-10-01</FA>').join('<FA>ayer</FA>');
  expect(() => leerCaf(xml)).toThrow(expect.objectContaining({ codigo: 'CAF_INVALIDO' }));
});
```

En `firma.spec.ts`:

```ts
it('devuelve el nombre del firmante y el vencimiento', () => {
  const venceEl = new Date('2027-03-15T12:00:00Z');
  const { pfx, clave } = certificadoDePrueba({ venceEl, nombre: 'Ana Pérez' });
  const cert = leerCertificado(pfx, clave);
  expect(cert.nombre).toBe('Ana Pérez');
  expect(cert.venceEl.toISOString()).toBe(venceEl.toISOString());
});
```

- [ ] **Step 2:** `cd backend && npx jest src/modules/dte/caf.spec.ts src/modules/dte/firma.spec.ts`. Esperado: FAIL (`idk` undefined, la opción `venceEl` no existe).
- [ ] **Step 3: Implementación.**
  - En `leerCaf`:
    - `const idk = entero(da, 'IDK');`
    - `const fechaAutorizacion = texto(da, 'FA');`, que se valida con `validarFecha('FA', …)` de `texto.ts`; si tira, se convierte en `invalido('FA no es una fecha AAAA-MM-DD')`;
    - las dos se devuelven.
  - En `leerCertificado`:
    - `nombre: (cert.subject.getField({ name: 'commonName' }) as { value: string } | null)?.value ?? ''`;
    - `venceEl: cert.validity.notAfter`.
  - En el fixture: las opciones `venceEl` y `nombre`. El `notBefore` queda en 2026-01-01, salvo que `venceEl` sea anterior; en ese caso es `venceEl` menos un año.
  - Sumar los cuatro códigos a la unión, cada uno con un comentario de una línea sobre quién lo usa (tarea 7).
- [ ] **Step 4:** `cd backend && npx jest src/modules/dte`. Esperado: PASS, toda la carpeta (el `firma-sii.spec.ts` sigue verde).
- [ ] **Step 5: Corregir la spec.**
  - § 2.3: `ambiente` es "el de la razón social al subirlo".
  - § 3: borrar el párrafo del `IDK` = 100 y el mensaje "Es un CAF de certificación…", y poner que el CAF viaja como `{xmlBase64}`.
  - § 8: reemplazar el punto del `IDK` por "un CAF de producción subido en certificación no se detecta", con la cita del instructivo (sección A.1 h).
- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/dte/caf.ts backend/src/modules/dte/firma.ts backend/src/modules/dte/dte.types.ts backend/src/modules/dte/__fixtures__/credenciales-prueba.ts backend/src/modules/dte/caf.spec.ts backend/src/modules/dte/firma.spec.ts docs/superpowers/specs/2026-10-14-perfil-fiscal-emisor-design.md
git commit -m "feat(dte): leerCaf y leerCertificado devuelven lo que guarda el perfil fiscal"
```

### Task 2: el esquema

**Files:**
- Modify: `backend/src/modules/tenants/entities/razon-social.entity.ts`
- Create: `backend/src/modules/dte/entities/dte-certificado.entity.ts`
- Create: `backend/src/modules/dte/entities/dte-caf.entity.ts`
- Modify: `backend/src/database/typeorm.config.ts` (`ENTIDADES`)
- Create: `backend/src/database/migrations/<timestamp>-PerfilFiscalEmisor.ts` (generada)
- Modify: `startup-pos.sql`

**Interfaces:**
- Produces:
  - `type AmbienteSii = 'certificacion' | 'produccion'`, exportado desde `dte-caf.entity.ts`.
  - Las entities `DteCertificado` y `DteCaf`, y las columnas nuevas de `RazonSocial`, con los nombres de abajo. Las usan las tareas 5 a 8.

- [ ] **Step 1: `RazonSocial` suma columnas**, todas nulas. Los `type` van explícitos: con una unión de TS, `design:type` queda en `Object` y TypeORM no arranca (comentario de `tenant.entity.ts`).

```ts
@Column({ type: 'varchar', length: 80, nullable: true })
giro: string | null;

@Column({ type: 'varchar', length: 20, nullable: true })
comuna: string | null;

/** Ambiente del SII en que emite: decide qué CAF sirven (perfil fiscal, spec § 2.1). */
@Column({ name: 'ambiente_sii', type: 'text', nullable: true })
ambienteSii: AmbienteSii | null;

/** `FchResol` de la carátula, AAAA-MM-DD. */
@Column({ name: 'fecha_resolucion', type: 'date', nullable: true })
fechaResolucion: string | null;

/** `NroResol` de la carátula; 0 en certificación. */
@Column({ name: 'numero_resolucion', type: 'integer', nullable: true })
numeroResolucion: number | null;
```

más `@Check('chk_razones_sociales_ambiente_sii', `"ambiente_sii" IN ('certificacion','produccion')`)` y `@Check('chk_razones_sociales_numero_resolucion', '"numero_resolucion" >= 0')` sobre la clase.

- [ ] **Step 2: `DteCertificado`**

```ts
/**
 * Certificado del firmante de la razón social emisora (spec perfil fiscal § 2.2). Vigente hay
 * uno por razón social; al reemplazarlo, el anterior queda con `reemplazado_el` y el blob en
 * null: no se guarda la llave de un certificado que ya no firma.
 */
@Entity('dte_certificados')
@Index('idx_dte_certificados_razon_social', ['razonSocialId'])
@Index('uq_dte_certificados_vigente', ['razonSocialId'], {
  unique: true,
  where: '"reemplazado_el" IS NULL AND "eliminado_el" IS NULL',
})
export class DteCertificado {
  @PrimaryGeneratedColumn('uuid', { name: 'certificado_id' }) id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'razon_social_id', type: 'uuid' }) razonSocialId: string;
  /** `CertificadoLeido` en JSON, cifrado con `CifradoDteService`. Null = reemplazado. */
  @Column({ name: 'credencial_cifrada', type: 'text', nullable: true }) credencialCifrada: string | null;
  @Column({ name: 'rut_firmante', type: 'varchar', length: 12 }) rutFirmante: string;
  @Column({ name: 'nombre_firmante', type: 'text' }) nombreFirmante: string;
  @Column({ name: 'vence_el', type: 'timestamptz' }) venceEl: Date;
  @Column({ name: 'reemplazado_el', type: 'timestamptz', nullable: true }) reemplazadoEl: Date | null;
  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' }) eliminadoEl: Date | null;
}
```

- [ ] **Step 3: `DteCaf`**

```ts
export type AmbienteSii = 'certificacion' | 'produccion';

/**
 * Un CAF subido (spec perfil fiscal § 2.3). `siguiente_folio` es el próximo a entregar; el CAF
 * está agotado cuando pasa `hasta`. Los usados se derivan (`siguiente_folio - desde`): el folio
 * de cada documento lo guarda el documento. El XML va cifrado porque trae `RSASK`.
 */
@Entity('dte_cafs')
@Check('chk_dte_cafs_tipo', '"tipo" IN (39, 41)')
@Check('chk_dte_cafs_ambiente', `"ambiente" IN ('certificacion','produccion')`)
@Check('chk_dte_cafs_rango', '"desde" >= 1 AND "desde" <= "hasta"')
@Check('chk_dte_cafs_siguiente', '"siguiente_folio" >= "desde" AND "siguiente_folio" <= "hasta" + 1')
@Index('idx_dte_cafs_razon_social', ['razonSocialId'])
@Index('uq_dte_cafs_desde', ['razonSocialId', 'tipo', 'desde'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class DteCaf {
  @PrimaryGeneratedColumn('uuid', { name: 'caf_id' }) id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'razon_social_id', type: 'uuid' }) razonSocialId: string;
  @Column({ type: 'smallint' }) tipo: TipoBoleta;
  @Column({ name: 'rut_emisor', type: 'varchar', length: 12 }) rutEmisor: string;
  @Column({ type: 'text' }) ambiente: AmbienteSii;
  @Column({ type: 'integer' }) desde: number;
  @Column({ type: 'integer' }) hasta: number;
  @Column({ name: 'siguiente_folio', type: 'integer' }) siguienteFolio: number;
  @Column({ type: 'integer' }) idk: number;
  @Column({ name: 'fecha_autorizacion', type: 'date' }) fechaAutorizacion: string;
  @Column({ name: 'xml_cifrado', type: 'text' }) xmlCifrado: string;
  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' }) eliminadoEl: Date | null;
}
```

- [ ] **Step 4:** registrar `DteCertificado` y `DteCaf` en `ENTIDADES`. Con la base al día (`./scripts/entorno.sh db`, y la app arrancada una vez), correr `cd backend && npm run migration:generate -- PerfilFiscalEmisor`.
- [ ] **Step 5: Leer la migración.**
  - Esperado: 5 `ADD COLUMN` nulos en `razones_sociales` y sus dos `CHECK`.
  - Dos `CREATE TABLE`, con los `CHECK` y los índices, incluidos los dos `WHERE` parciales.
  - Ningún `DROP`.
  - Si `uq_*` sale sin su `WHERE`, va a mano (§ 22: TypeORM no compara el `where`).
  - `down` deshace todo.
  - Copiar el DDL a `startup-pos.sql`.
- [ ] **Step 6:**
  - `cd backend && npm run migration:run && npm run migration:check` (esperado: exit 0);
  - `npm run typecheck`;
  - `npx jest --config ./test/jest-e2e.json test/esquema.e2e-spec.ts` (esperado: PASS).
- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/tenants/entities/razon-social.entity.ts backend/src/modules/dte/entities backend/src/database/typeorm.config.ts backend/src/database/migrations startup-pos.sql
git commit -m "feat(dte): esquema del perfil fiscal (razón social emisora, certificados, CAF)"
```

### Task 3: el cifrado propio

**Files:**
- Create: `backend/src/modules/dte/cifrado-dte.service.ts`
- Test: `backend/src/modules/dte/cifrado-dte.service.spec.ts`
- Modify: `.env.example`, `docker-compose.yml` (env del backend), `.github/workflows/ci.yml` (jobs `gate` y `e2e-navegador`), `backend/test/setup-env.ts`

**Interfaces:**
- Produces: `CifradoDteService` con `cifrar(texto: string): string` y `descifrar(blob: string): string`, en formato `v1:<iv>:<tag>:<data>`.

- [ ] **Step 1: Test que falla**

```ts
const clave = Buffer.alloc(32, 7).toString('base64');
const servicio = (valor?: string) =>
  new CifradoDteService({ get: () => valor } as unknown as ConfigService);

it('ida y vuelta, con un texto latin1 como el de un CAF', () => {
  const s = servicio(clave);
  const texto = '<RS>PANADERÍA ÑUÑOA</RS>';
  const blob = s.cifrar(texto);
  expect(blob.startsWith('v1:')).toBe(true);
  expect(blob).not.toContain('PANADER');
  expect(s.descifrar(blob)).toBe(texto);
});
it('dos cifrados del mismo texto no se parecen (IV aleatorio)', () => {
  const s = servicio(clave);
  expect(s.cifrar('x')).not.toBe(s.cifrar('x'));
});
it('un blob adulterado no se descifra', () => {
  const s = servicio(clave);
  const [v, iv, tag, data] = s.cifrar('secreto').split(':');
  const otro = Buffer.from(data, 'base64');
  otro[0] ^= 1;
  expect(() => s.descifrar([v, iv, tag, otro.toString('base64')].join(':'))).toThrow();
});
it('sin clave o con una que no mide 32 bytes, no construye', () => {
  expect(() => servicio(undefined)).toThrow('DTE_ENCRYPTION_KEY');
  expect(() => servicio(Buffer.alloc(16).toString('base64'))).toThrow('32 bytes');
});
```

- [ ] **Step 2:** `cd backend && npx jest src/modules/dte/cifrado-dte.service.spec.ts`. Esperado: FAIL (el módulo no existe).
- [ ] **Step 3: Implementación.** Es una copia de `cifrarTexto` y `descifrarTexto` de `credenciales.service.ts`, con estos cambios:
  - lee `DTE_ENCRYPTION_KEY`;
  - el error al construir dice `'DTE_ENCRYPTION_KEY no configurada'` y `'DTE_ENCRYPTION_KEY debe ser 32 bytes en base64'`;
  - docblock: es el único punto que cifra los blobs del módulo `dte`, y la clave está separada de la pasarela para que una filtración no exponga la otra (spec § 2.4).
- [ ] **Step 4: Variable en todos los entornos.**
  - `.env.example`: debajo de la de la pasarela, con su comentario y un valor de desarrollo distinto, por ejemplo `openssl rand -base64 32`.
  - `docker-compose.yml`: `DTE_ENCRYPTION_KEY: ${DTE_ENCRYPTION_KEY:-<el mismo valor>}`.
  - `ci.yml`: en los dos jobs, con el comentario de por qué está ahí, igual que la de la pasarela.
  - `backend/test/setup-env.ts`: `process.env.DTE_ENCRYPTION_KEY ??= '<el mismo valor>';`, comentando que los `.env` de worktrees creados antes de esta fecha no la tienen.
- [ ] **Step 5:** `cd backend && npx jest src/modules/dte/cifrado-dte.service.spec.ts && npm run lint:check && npm run typecheck`. Esperado: PASS.
- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/dte/cifrado-dte.service.ts backend/src/modules/dte/cifrado-dte.service.spec.ts .env.example docker-compose.yml .github/workflows/ci.yml backend/test/setup-env.ts
git commit -m "feat(dte): cifrado propio del certificado y los CAF (DTE_ENCRYPTION_KEY)"
```

### Task 4: qué le falta al perfil (función pura)

**Files:**
- Create: `backend/src/modules/dte/perfil-fiscal.ts`
- Test: `backend/src/modules/dte/perfil-fiscal.spec.ts`

**Interfaces:**
- Consumes: `validarTexto` y `rutValido`; `AmbienteSii` (tarea 2); `TipoBoleta`.
- Produces:

```ts
export const UMBRAL_FOLIOS = 100;
export const DIAS_AVISO_CERTIFICADO = 30;

export type CodigoFaltante =
  | 'SIN_EMISOR' | 'RUT_INVALIDO' | 'SIN_GIRO' | 'SIN_COMUNA' | 'SIN_DIRECCION'
  | 'SIN_AMBIENTE' | 'SIN_RESOLUCION' | 'TEXTO_INVALIDO'
  | 'SIN_CERTIFICADO' | 'CERTIFICADO_VENCIDO' | 'SIN_FOLIOS_39';
export type CodigoAviso = 'POCOS_FOLIOS' | 'CERTIFICADO_POR_VENCER';

export interface EmisorPerfil {
  razonSocialId: string; nombre: string; rut: string; direccion: string | null;
  giro: string | null; comuna: string | null; ambiente: AmbienteSii | null;
  fechaResolucion: string | null; numeroResolucion: number | null;
}
export interface CafPerfil { tipo: TipoBoleta; ambiente: AmbienteSii; restantes: number }
export interface Observacion<C> { codigo: C; mensaje: string }

export function evaluarPerfil(
  emisor: EmisorPerfil | null,
  certificado: { venceEl: Date } | null,
  cafs: CafPerfil[],
  ahora: Date,
): { faltantes: Observacion<CodigoFaltante>[]; avisos: Observacion<CodigoAviso>[] };
```

**Reglas:**
- `emisor` null → solo `SIN_EMISOR`; certificado y CAF se evalúan igual.
- `RUT_INVALIDO` si `!rutValido(rut)`.
- `SIN_GIRO`, `SIN_COMUNA` y `SIN_DIRECCION` si el campo está vacío o es solo espacios.
- `TEXTO_INVALIDO`, uno por campo presente que `validarTexto` rechace:
  - nombre (100), giro (80), dirección (70) y comuna (20);
  - el `mensaje` es el del `DteError`.
- `SIN_AMBIENTE` si `ambiente` es null.
- `SIN_RESOLUCION` si falta la fecha o el número.
- `SIN_CERTIFICADO` si no hay certificado. `CERTIFICADO_VENCIDO` si `venceEl <= ahora`.
- `CERTIFICADO_POR_VENCER` si el certificado vence después de `ahora` pero antes de `ahora + 30 días`.
- Los folios se suman por tipo, **solo con los CAF del ambiente del emisor**. Con el ambiente null no cuenta ninguno.
  - Para el 39 la suma es 0 → `SIN_FOLIOS_39`.
  - Un tipo que tiene CAF en ese ambiente y suma menos de 100 → `POCOS_FOLIOS`, con el tipo y la cantidad en el mensaje.
  - El 39 con 0 sale solo como faltante, no además como aviso.

- [ ] **Step 1: Tests que fallan.** Un caso por regla, más:
  - el perfil completo, que da `[]` y `[]`;
  - el borde de 100 folios: 100 restantes → sin aviso; 99 → aviso;
  - el borde de 30 días: `ahora + 30 días` exacto → sin aviso; un segundo menos → aviso;
  - un CAF de otro ambiente con 500 folios, que no evita `SIN_FOLIOS_39`;
  - un 41 con 0 restantes y CAF cargados → `POCOS_FOLIOS`, y no es faltante.
  - **Fixtures sin el 1 ni restantes iguales**: por ejemplo restantes 37 y 412, y fechas con minutos distintos.
- [ ] **Step 2:** `cd backend && npx jest src/modules/dte/perfil-fiscal.spec.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar `evaluarPerfil`, sin reloj ni base: `ahora` viene de afuera. Los mensajes son en lenguaje de local, por ejemplo:
  - "Falta el giro de la empresa";
  - "No hay folios de boleta (39) cargados";
  - "Quedan 37 folios de boleta exenta (41)";
  - "El certificado vence el 15-03-2027".
- [ ] **Step 4:** correr el spec. Esperado: PASS.
- [ ] **Step 5: Mutantes.** Revertir uno por vez y confirmar que algún caso cae. Volver con `git checkout -- backend/src/modules/dte/perfil-fiscal.ts` y comparar con `cmp` contra una copia previa. Los mutantes:
  - `< UMBRAL_FOLIOS` → `<=`;
  - `<= ahora` → `< ahora`;
  - sacar el filtro por ambiente;
  - sacar el "no además como aviso" del 39.

  Anotar cuál cae en el reporte.
- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/dte/perfil-fiscal.ts backend/src/modules/dte/perfil-fiscal.spec.ts
git commit -m "feat(dte): evaluarPerfil dice qué le falta al emisor para emitir"
```

### Task 5: el módulo HTTP con el perfil y el certificado

**Files:**
- Create: `backend/src/modules/dte/perfil-fiscal.service.ts`, `backend/src/modules/dte/perfil-fiscal.service.spec.ts`
- Create: `backend/src/modules/dte/dte.controller.ts`, `backend/src/modules/dte/dte.module.ts`
- Create: `backend/src/modules/dte/dto/actualizar-perfil.dto.ts`, `backend/src/modules/dte/dto/subir-certificado.dto.ts`
- Modify: `backend/src/app.module.ts` (`DteModule` en `imports`)
- Test: `backend/test/dte-perfil.e2e-spec.ts`

**Interfaces:**
- Consumes:
  - `CifradoDteService` (tarea 3);
  - `evaluarPerfil`, `EmisorPerfil` y `CafPerfil` (tarea 4);
  - `leerCertificado` y `CertificadoLeido` (tarea 1);
  - las entities de la tarea 2.
- Produces:
  - `PerfilFiscalService.emisora(tenantId): Promise<EmisorPerfil | null>`. Es la razón social `preferida AND habilitado AND eliminado_el IS NULL` del tenant. La usan las tareas 6 y 7.
  - `PerfilFiscalService.obtener(tenantId, ahora: Date): Promise<PerfilFiscal>`.
  - `PerfilFiscalService.actualizar(tenantId, dto)`.
  - `PerfilFiscalService.subirCertificado(tenantId, dto, ahora)`.
  - `DteModule` exporta `PerfilFiscalService` y `CifradoDteService`.

```ts
export interface PerfilFiscal {
  emisor: EmisorPerfil | null;
  certificado: { id: string; rutFirmante: string; nombreFirmante: string; venceEl: string } | null;
  cafs: {
    id: string; tipo: TipoBoleta; ambiente: AmbienteSii; desde: number; hasta: number;
    usados: number; restantes: number; fechaAutorizacion: string; idk: number; borrable: boolean;
  }[];
  faltantes: Observacion<CodigoFaltante>[];
  avisos: Observacion<CodigoAviso>[];
}
```

**Rutas.** Todas en un controller `@Controller('dte')` con `@UseGuards(JwtAuthGuard, TenantGuard, TenantAdminGuard)` en la clase, y `tenantId` sacado de `req.user`:
- `GET /dte/perfil`;
- `PATCH /dte/perfil`;
- `POST /dte/certificado`, que devuelve el objeto `certificado` de arriba.

**DTOs:**
- `ActualizarPerfilDto`. Todos sus campos son opcionales y **ninguno acepta null** (`@ValidateIf((_o, v) => v !== undefined)`):
  - `giro`: string, `@MaxLength(80)`;
  - `comuna`: string, `@MaxLength(20)`;
  - `ambienteSii`: `@IsIn(['certificacion','produccion'])`;
  - `fechaResolucion`: `@Matches(/^\d{4}-\d{2}-\d{2}$/)`;
  - `numeroResolucion`: `@IsInt() @Min(0) @Max(2147483647)`.
- `SubirCertificadoDto`:
  - `pfxBase64`: `@IsBase64() @MaxLength(100_000)`;
  - `clave`: `@IsString() @MaxLength(200)`; puede ser vacía.

**Service:**
- `obtener` lee en **tres consultas fijas**, sin N+1:
  - la emisora;
  - el certificado vigente (`reemplazado_el IS NULL AND eliminado_el IS NULL`) de esa razón social;
  - sus CAF no borrados, `ORDER BY tipo, desde`.

  Después llama a `evaluarPerfil(emisor, certificado, cafs, ahora)`. Sin emisora, `cafs` y `certificado` vienen vacíos.
- `actualizar`:
  - sin emisora → 400 "Primero hay que marcar una razón social como preferida en Razones sociales";
  - `giro` y `comuna` pasan por `validarTexto`: un `DteError` se convierte en 400 con su mensaje;
  - `fechaResolucion` pasa por `validarFecha`;
  - escribe en la razón social emisora y devuelve `{ ...camposTocados }`, sin refetch (§ 6).
- `subirCertificado`, dentro de `db.transaccion`:
  1. Toma la emisora con `SELECT … FOR UPDATE` sobre su fila de `razones_sociales`. Sin emisora → 400.
  2. `leerCertificado(Buffer.from(dto.pfxBase64, 'base64'), dto.clave)`. Un `DteError` se convierte en 400 con `e.message`. **No se concatena la clave en ningún mensaje.**
  3. `venceEl <= ahora` → 400 "El certificado venció el DD-MM-AAAA; sube uno vigente".
  4. `UPDATE dte_certificados SET reemplazado_el = now(), credencial_cifrada = NULL WHERE razon_social_id = $1 AND reemplazado_el IS NULL AND eliminado_el IS NULL`.
  5. INSERT con `credencialCifrada = cifrado.cifrar(JSON.stringify({ ...leido, venceEl: leido.venceEl.toISOString() }))`.

  `ahora` es `new Date()` del controller, y el service lo recibe para poder testearlo.

- [ ] **Step 1: Tests unitarios que fallan** (`perfil-fiscal.service.spec.ts`, con `Db` y repos mockeados, `docs/patterns/backend.md` § 7):
  - `subirCertificado` sin emisora → 400;
  - con un `.pfx` y la clave equivocada → 400, y el mensaje no contiene la clave;
  - con un certificado vencido (`certificadoDePrueba({ venceEl: new Date('2026-05-04T10:17:00Z') })`, `ahora` = 2026-10-14) → 400;
  - el OK cifra el JSON (el mock de `CifradoDteService` recibe un texto con `llavePrivadaPem`) y anula el anterior.
  - `actualizar` sin emisora → 400; un giro con `'\t'` → 400.
- [ ] **Step 2:** `cd backend && npx jest src/modules/dte/perfil-fiscal.service.spec.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar el service, los DTOs, el controller y el module (`RepositoriosModule.forFeature([DteCertificado, DteCaf, RazonSocial])`, `providers: [PerfilFiscalService, CifradoDteService]`), y registrarlo en `app.module.ts`.
- [ ] **Step 4: e2e** (`backend/test/dte-perfil.e2e-spec.ts`). Mismo arranque que `borrado-mesa-concurrente.e2e-spec.ts`: `validacionGlobal()` y login de `admin.paris@paris.cl` en el tenant `…440007`.
  - **Fixture propia:**
    - en `beforeAll`, buscar o crear vía API la razón social `'Emisor e2e perfil fiscal'`, RUT `77.777.777-7` (DV válido), dirección `'Av. Prueba 123'`, habilitada;
    - marcarla preferida con `PATCH /tenants/razones-sociales/:id/preferida`;
    - por SQL, soft-delete de los CAF que quedaron de una corrida anterior y `credencial_cifrada = NULL, reemplazado_el = now()` sobre sus certificados.
  - **En `afterAll`, por SQL:**
    - esa misma limpieza;
    - `UPDATE razones_sociales SET preferida = false WHERE razon_social_id = $1`, comentando que no hay una ruta que des-marque la preferida y que las otras suites no esperan una.
    - Acumular los fallos y afirmar después de `app.close()`.
  - **Casos:**
    - `GET /dte/perfil` → 200, `emisor.rut` y los faltantes (`SIN_GIRO`, `SIN_COMUNA`, `SIN_AMBIENTE`, `SIN_RESOLUCION`, `SIN_CERTIFICADO`, `SIN_FOLIOS_39`);
    - `PATCH` con giro, comuna `'Ñuñoa'`, `ambienteSii: 'certificacion'`, `fechaResolucion: '2026-09-30'` y `numeroResolucion: 0` → 200, y el GET ya no trae esos faltantes;
    - `PATCH` con `giro: null` → 400;
    - `POST /dte/certificado` con `certificadoDePrueba({ nombre: 'Ana Pérez' })` (importado de `../src/modules/dte/__fixtures__/credenciales-prueba`) → 201, con `rutFirmante` y `nombreFirmante`;
    - una segunda subida → 201, y por SQL hay una fila con `reemplazado_el` no nulo y `credencial_cifrada IS NULL`;
    - **un 400 de clave equivocada no contiene la clave enviada** (`JSON.stringify(res.body)` no incluye `'clave-que-no-es-9137'`);
    - **ninguna respuesta** contiene `credencial_cifrada`, `credencialCifrada`, `llavePrivadaPem` ni `'PRIVATE KEY'` (se revisa el `JSON.stringify` de cada respuesta);
    - un usuario no admin (`encargado.salon@paris.cl`, mismo login de dos pasos) → 403 en las tres rutas;
    - otro tenant (helper `segundo-tenant.ts`) → `GET /dte/perfil` con `emisor: null`, o su propia razón social, y nunca el RUT `77777777-7`.
- [ ] **Step 5:**
  - `./scripts/reset-db.sh` o `./scripts/entorno.sh db`;
  - `cd backend && npx jest --config ./test/jest-e2e.json test/dte-perfil.e2e-spec.ts` (esperado: PASS);
  - `npm test && npm run lint:check && npm run typecheck`.
- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/dte/perfil-fiscal.service.ts backend/src/modules/dte/perfil-fiscal.service.spec.ts backend/src/modules/dte/dte.controller.ts backend/src/modules/dte/dte.module.ts backend/src/modules/dte/dto backend/src/app.module.ts backend/test/dte-perfil.e2e-spec.ts
git commit -m "feat(dte): perfil fiscal y certificado del emisor por API"
```

### Task 6: subir y borrar CAF

**Files:**
- Modify: `backend/src/modules/dte/perfil-fiscal.service.ts`, `backend/src/modules/dte/perfil-fiscal.service.spec.ts`, `backend/src/modules/dte/dte.controller.ts`
- Create: `backend/src/modules/dte/dto/subir-caf.dto.ts`
- Modify: `backend/test/dte-perfil.e2e-spec.ts`

**Interfaces:**
- Consumes: `leerCaf` (tarea 1), `emisora` y `PerfilFiscal['cafs'][number]` (tarea 5).
- Produces:
  - `POST /dte/cafs` `{ xmlBase64 }` → 201 con el CAF en la forma de `PerfilFiscal['cafs'][number]`;
  - `DELETE /dte/cafs/:id` (`ParseUUIDPipe`) → 200 sin body.

**`subirCaf(tenantId, dto)`, dentro de `db.transaccion`:**
1. Emisora con `FOR UPDATE`. Sin emisora → 400. Con `ambienteSii` null → 400 "Primero hay que elegir el ambiente (certificación o producción)".
2. `xml = Buffer.from(dto.xmlBase64, 'base64').toString('latin1')` y `leerCaf(xml)`. Un `DteError` se convierte en 400 con su mensaje.
3. Tipo distinto de 39 o 41 → 400 "Este CAF es de documentos tipo N; por ahora solo se cargan boletas (39 y 41)".
4. `caf.rutEmisor !== normalizarRut(emisora.rut)` → 400 "Este archivo de folios es del RUT X, no de la empresa (Y)".
5. `caf.hasta > 2_147_483_646` → 400.
6. Solape: `SELECT 1 FROM dte_cafs WHERE razon_social_id = $1 AND tipo = $2 AND eliminado_el IS NULL AND desde <= $4 AND hasta >= $3 LIMIT 1` → 400 "Esos folios ya están cargados".
7. INSERT con:
   - `siguienteFolio = desde`;
   - `ambiente = emisora.ambiente`;
   - `rutEmisor`, `idk` y `fechaAutorizacion` del CAF;
   - `xmlCifrado = cifrado.cifrar(xml)`.

**`borrarCaf(tenantId, id)`:**
- `UPDATE dte_cafs SET eliminado_el = now() WHERE caf_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL AND siguiente_folio = desde RETURNING caf_id`.
- Si no devuelve fila, distinguir con una lectura: si no existe en el tenant → 404; si tiene folios usados → 400 "Este CAF ya entregó folios y no se puede borrar".

- [ ] **Step 1: Tests unitarios que fallan.** Cada rechazo de 1 a 6, y el OK, que guarda cifrado y con `siguienteFolio = desde`.
- [ ] **Step 2:** correr el spec. Esperado: FAIL.
- [ ] **Step 3:** implementar el service, el DTO (`xmlBase64`: `@IsBase64() @MaxLength(50_000)`) y las dos rutas.
- [ ] **Step 4: e2e** (mismo archivo; el perfil ya está con ambiente `certificacion` desde la tarea 5). Los CAF salen de `cafDePrueba({ rut: '77777777-7', tipo, desde, hasta })`, en base64 con `Buffer.from(xml, 'latin1').toString('base64')`.
  - un 39 de 2041 a 2077 → 201, `restantes: 37`, `borrable: true`; el GET ya no tiene `SIN_FOLIOS_39`;
  - **CAF con tildes y Ñ al estilo Windows**: `cafDePrueba({ …, tipo: 41, desde: 3011, hasta: 3412, razonSocial: 'PANADERÍA ÑUÑOA', windows: true })` → 201;
  - otro RUT (`cafDePrueba({ rut: '76543210-3', … })`) → 400 con "del RUT";
  - tipo 33 → 400;
  - un rango que se solapa (2070–2090) → 400 "ya están cargados";
  - **doble clic**: el mismo XML nuevo (5003–5104) en dos `POST` disparados con `Promise.all` → un 201 y un 400 "ya están cargados", y por SQL una sola fila;
  - un base64 que no es CAF → 400;
  - `DELETE` de uno sin usar → 200, y ya no aparece;
  - `DELETE` de un id de otro tenant → 404;
  - `DELETE` de un CAF con un folio usado → 400. Para usarlo, `UPDATE siguiente_folio = desde + 1` por SQL, comentando que tomar folios es la tarea 7 y acá solo se prueba la regla del borrado;
  - ninguna respuesta contiene `xml_cifrado`, `xmlCifrado`, `RSASK` ni `'PRIVATE KEY'`.
- [ ] **Step 5:**
  - `cd backend && npx jest --config ./test/jest-e2e.json test/dte-perfil.e2e-spec.ts` (esperado: PASS);
  - `npm test && npm run lint:check && npm run typecheck`.
- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/dte/perfil-fiscal.service.ts backend/src/modules/dte/perfil-fiscal.service.spec.ts backend/src/modules/dte/dte.controller.ts backend/src/modules/dte/dto/subir-caf.dto.ts backend/test/dte-perfil.e2e-spec.ts
git commit -m "feat(dte): carga y borrado de CAF del emisor"
```

### Task 7: tomar un folio y las credenciales para firmar

**Files:**
- Create: `backend/src/modules/dte/folios.service.ts`, `backend/src/modules/dte/folios.service.spec.ts`
- Modify: `backend/src/modules/dte/dte.module.ts` (provider y export)
- Create: `backend/test/dte-folios.e2e-spec.ts`

**Interfaces:**
- Consumes: `Db`, `TxContext` (global de `CommonModule`), `CifradoDteService`, `leerCaf`, `CafLeido`, `CertificadoLeido`, `EmisorBoleta`, `CaratulaEnvio` (de `envio-boleta.ts`), `TipoBoleta` y `DteError`.
- Produces (los usa el subproyecto 4):

```ts
tomarFolio(tenantId: string, tipo: TipoBoleta): Promise<{ cafId: string; folio: number }>;
credencialesParaFirmar(tenantId: string, cafId: string, ahora: Date): Promise<{
  caf: CafLeido; certificado: CertificadoLeido; emisor: EmisorBoleta; caratula: CaratulaEnvio;
}>;
```

- [ ] **Step 1: Implementar `tomarFolio`**

```ts
// El CAF de menor rango que todavía tiene folios, de la razón social emisora y su ambiente.
// Corre en la transacción de quien lo pide: si la venta se cae, el rollback devuelve el folio
// (una secuencia de Postgres no lo devuelve, y cada hueco es un folio que se anula ante el SII).
const TOMAR_FOLIO = `
  UPDATE dte_cafs c
     SET siguiente_folio = c.siguiente_folio + 1, actualizado_el = now()
   WHERE c.caf_id = (
     SELECT f.caf_id
       FROM dte_cafs f
       JOIN razones_sociales rs
         ON rs.razon_social_id = f.razon_social_id AND rs.eliminado_el IS NULL
      WHERE f.tenant_id = $1 AND f.tipo = $2 AND f.eliminado_el IS NULL
        AND rs.preferida AND rs.habilitado
        AND f.ambiente = rs.ambiente_sii
        AND f.siguiente_folio <= f.hasta
      ORDER BY f.desde
      LIMIT 1
      FOR UPDATE OF f)
  RETURNING c.caf_id, c.siguiente_folio - 1 AS folio`;

async tomarFolio(tenantId: string, tipo: TipoBoleta) {
  if (!this.tx.managerActivo()) {
    throw new Error('tomarFolio corre dentro de db.transaccion: fuera de una, el folio se consume aunque la venta falle');
  }
  // Dos intentos: si otra caja agotó este CAF mientras esperábamos su bloqueo, la fila deja de
  // cumplir el WHERE al re-evaluarse y el LIMIT ya la contó, así que sale vacío aunque haya
  // otro CAF. La segunda sentencia toma una foto nueva y ve el siguiente.
  for (let intento = 0; intento < 2; intento++) {
    const [fila] = unwrap<{ caf_id: string; folio: number }>(
      await this.db.query(TOMAR_FOLIO, [tenantId, tipo]),
    );
    if (fila) return { cafId: fila.caf_id, folio: fila.folio };
  }
  throw new DteError('SIN_FOLIOS', `No quedan folios de tipo ${tipo.toString()} cargados`);
}
```

- [ ] **Step 2: Implementar `credencialesParaFirmar`**
  - Una consulta: el CAF (`caf_id = $2 AND tenant_id = $1 AND eliminado_el IS NULL`), unido a su razón social viva.
  - Otra: el certificado vigente de esa razón social.
  - Sin CAF → `DteError('SIN_FOLIOS', …)`.
  - Sin certificado → `SIN_CERTIFICADO`. `venceEl <= ahora` → `CERTIFICADO_VENCIDO`.
  - Giro, comuna, dirección, ambiente, fecha o número de resolución nulos → `PERFIL_INCOMPLETO`, con el campo en el mensaje.
  - Devuelve:
    - `caf`: `leerCaf(cifrado.descifrar(xml_cifrado))`;
    - `certificado`: el JSON descifrado, con `venceEl: new Date(…)`;
    - `emisor`: `{ rut: normalizarRut(rs.rut), razonSocial: rs.nombre, giro, direccion, comuna }`, sin `cdgSiiSucur`;
    - `caratula`: `{ rutEmisor, rutReceptor: '60803000-K', fchResol, nroResol }`.
- [ ] **Step 3: Tests unitarios** (`folios.service.spec.ts`, con mocks):
  - `tomarFolio` sin transacción activa → tira;
  - primer intento vacío y segundo con fila → devuelve la fila, y `db.query` se llamó 2 veces;
  - dos vacíos → `SIN_FOLIOS`;
  - `credencialesParaFirmar` con cada código de error.
- [ ] **Step 4: e2e** (`backend/test/dte-folios.e2e-spec.ts`). Tiene su propia razón social preferida, `'Emisor e2e folios'`, RUT `78.787.878-4`, con la misma limpieza `beforeAll`/`afterAll` de la tarea 5, más perfil completo, certificado y CAF subidos **por la API**. Al service se llega con `app.get(FoliosService)` y `app.get(Db)`.
  - **20 en paralelo:** CAF 39 de 4007 a 4031. Disparar `Promise.all` de 20 `db.transaccion(() => folios.tomarFolio(TENANT, 39))` → 20 folios distintos, y ordenados son 4007…4026.
  - **Rollback:** `db.transaccion(async () => { await folios.tomarFolio(…); throw new Error('venta caída'); })` rechazada; el siguiente `tomarFolio` devuelve el mismo folio que salió adentro.
  - **Agotado pasa al siguiente:** con el CAF 4007–4031 agotado y otro 39 de 6013–6040, el próximo es 6013.
  - **Agotamiento concurrente (determinístico, Review Focus 3):**
    1. Con un CAF A al que le queda un folio y un CAF B (`desde` mayor), una transacción propia (`ds.createQueryRunner()`) hace `UPDATE dte_cafs SET siguiente_folio = hasta + 1 WHERE caf_id = A` y **no commitea**.
    2. Disparar `db.transaccion(() => folios.tomarFolio(…))` sin `await`.
    3. Esperar 800 ms y confirmar con `pg_blocking_pids` que hay una sesión esperando al pid del query runner (mismo patrón que `helpers/carrera.ts`).
    4. Commitear el query runner.
    5. El `tomarFolio` devuelve `B.desde`.
    6. **Mutante:** con el `for` reducido a un solo intento, el caso da `SIN_FOLIOS`. Revertir y comparar con `cmp`.
  - **Otro tenant:** el segundo tenant (`segundo-tenant.ts`) con su razón social preferida `79.797.979-1` y un CAF 41 propio. `tomarFolio(PARIS, 41)`, sin CAF 41 en PARIS, → `SIN_FOLIOS`. El GET del perfil de PARIS no lista el CAF del otro.
  - **Otro ambiente:** cambiar PARIS a `produccion` por `PATCH` → `tomarFolio(…, 39)` da `SIN_FOLIOS`, y volver a `certificacion`.
  - **Otra preferida (Review Focus 4):** marcar preferida la razón social `'Emisor e2e perfil fiscal'` de la tarea 5, o una creada acá → `tomarFolio` no toma los CAF de `'Emisor e2e folios'`. Volver a marcar la de este archivo.
  - **Sin transacción:** `folios.tomarFolio(…)` directo → rechaza con el mensaje de la transacción.
  - **`credencialesParaFirmar`:** con el `cafId` de un folio tomado, usar el resultado en `emitirBoleta` + `armarEnvioBoleta` del motor con una línea de 4.990 y `ahora = '2026-10-14T13:07:00'`. El XML sale sin tirar y contiene `<RUTEmisor>78787878-4</RUTEmisor>`. **Es la prueba de que el perfil alcanza para emitir.**
- [ ] **Step 5:**
  - `cd backend && npx jest --config ./test/jest-e2e.json test/dte-folios.e2e-spec.ts test/dte-perfil.e2e-spec.ts` (esperado: PASS);
  - `npm test && npm run lint:check && npm run typecheck`.
- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/dte/folios.service.ts backend/src/modules/dte/folios.service.spec.ts backend/src/modules/dte/dte.module.ts backend/test/dte-folios.e2e-spec.ts
git commit -m "feat(dte): tomarFolio sin repetir ni saltear, y credenciales para firmar"
```

### Task 8: una razón social con CAF o certificado no cambia de RUT ni se borra

**Files:**
- Modify: `backend/src/modules/tenants/tenants.service.ts` (`updateRazonSocial`, `removeRazonSocial`)
- Test: `backend/src/modules/tenants/tenants.service.spec.ts` (si ya cubre razones sociales; si no, el e2e alcanza)
- Modify: `backend/test/dte-perfil.e2e-spec.ts`
- Modify: `docs/features/tenants-razones-sociales.md`

**Interfaces:**
- Consumes: las tablas `dte_cafs` y `dte_certificados` por SQL, sin importar el módulo `dte` (mismo criterio que `lectura-dte.service.ts` leyendo `razones_sociales`).

- [ ] **Step 1: e2e que falla**, sobre la razón social `'Emisor e2e perfil fiscal'`, que ya tiene certificado y CAF:
  - `PATCH /tenants/razones-sociales/:id` con `rut: '76.543.210-3'` → 400 "tiene folios o certificado de boleta electrónica cargados";
  - `PATCH` con el mismo RUT escrito con puntos (`'77.777.777-7'`) → 200, porque normalizado no cambia;
  - `PATCH` de `telefono` → 200;
  - `DELETE` → 400;
  - una razón social nueva, sin nada cargado → `PATCH` del RUT 200 y `DELETE` 200.
- [ ] **Step 2:** correr el e2e. Esperado: FAIL (hoy da 200).
- [ ] **Step 3: Implementación.** `updateRazonSocial` y `removeRazonSocial` pasan a correr en `this.db.transaccion`:
  - toman la fila con `SELECT … FROM razones_sociales WHERE razon_social_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL FOR UPDATE` (el mismo bloqueo que las subidas de las tareas 5 y 6: un cambio de RUT no se cruza con una subida);
  - si el RUT cambia (`normalizarRut(dto.rut) !== normalizarRut(rs.rut)`) o es un borrado, se pregunta:

```sql
SELECT EXISTS (SELECT 1 FROM dte_cafs WHERE razon_social_id = $1 AND eliminado_el IS NULL)
    OR EXISTS (SELECT 1 FROM dte_certificados WHERE razon_social_id = $1
                AND reemplazado_el IS NULL AND eliminado_el IS NULL) AS cargado
```

  - `true` → 400 "Esta razón social tiene folios o certificado de boleta electrónica cargados: no se puede cambiar su RUT ni borrarla".
  - El resto del método queda igual, incluido el chequeo de "no se puede deshabilitar la preferida".
- [ ] **Step 4:**
  - `cd backend && npx jest --config ./test/jest-e2e.json test/dte-perfil.e2e-spec.ts test/null-en-actualizaciones.e2e-spec.ts` (el segundo también ejercita el PATCH de razones sociales). Esperado: PASS.
  - `npm test && npm run lint:check && npm run typecheck`.
  - **Mutante:** sacar el `OR EXISTS` del certificado → algún caso tiene que caer. Si no cae ninguno, agregar el caso de una razón social con solo certificado.
- [ ] **Step 5:** en `docs/features/tenants-razones-sociales.md`, las columnas nuevas (giro, comuna, ambiente y resolución, que se editan en `/configuracion/boleta-electronica`) y la protección, con el porqué en una línea.
- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/tenants/tenants.service.ts backend/test/dte-perfil.e2e-spec.ts docs/features/tenants-razones-sociales.md
git commit -m "feat(tenants): la razón social emisora no cambia de RUT ni se borra con folios cargados"
```

### Task 9: la pantalla

Antes de escribir, el implementador invoca las skills `nuxt-ui` (memoria del owner) y lee `docs/patterns/frontend.md` y `frontend/docs/DESIGN-SYSTEM.md`.

**Files:**
- Create: `frontend/app/composables/usePerfilFiscal.ts`, `frontend/app/composables/usePerfilFiscal.spec.ts`
- Create: `frontend/app/pages/configuracion/boleta-electronica.vue`, `frontend/app/pages/configuracion/boleta-electronica.nuxt.spec.ts`
- Modify: `frontend/app/pages/configuracion.vue` (entrada del menú), `frontend/app/pages/configuracion.nuxt.spec.ts`
- Modify: `frontend/e2e/configuracion/menu-configuracion.spec.ts` (de 27 a 28 links para el admin del e2e, que es superadmin)
- Create: `frontend/e2e/configuracion/boleta-electronica.spec.ts`

**Interfaces:**
- Consumes: `GET`/`PATCH /dte/perfil`, `POST /dte/certificado`, `POST /dte/cafs` y `DELETE /dte/cafs/:id`, con las formas de las tareas 5 y 6.
- Produces (el composable):
  - los tipos `PerfilFiscal`, `CafPerfil` y `Observacion` (copiados de la respuesta);
  - `etiquetaTipo(39) = 'Boleta (39)'` y `etiquetaTipo(41) = 'Boleta exenta (41)'`;
  - `etiquetaAmbiente`;
  - `formatoFecha('2027-03-15T…') = '15-03-2027'`;
  - `archivoABase64(file: File): Promise<string>`, que lee `arrayBuffer` y arma el base64 de los bytes **sin decodificar texto**, porque el CAF es ISO-8859-1.

- [ ] **Step 1: Tests del composable que fallan**
  - `archivoABase64` de un `File` con los bytes `[0x3C, 0xD1, 0x9F]` → `'PNGf'` (base64 exacto de esos bytes): un decodificador de texto cambiaría el 0x9F;
  - las etiquetas;
  - `formatoFecha`.
- [ ] **Step 2:** `cd frontend && npx vitest run app/composables/usePerfilFiscal.spec.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar el composable y la página.**
  - **Página:** `definePageMeta({ middleware: 'admin' })`; carga con `useApiFetch`; todo dato de presentación sale del composable.
  - **Arriba**, la lista de `faltantes` en un `UAlert` de color warning, o "Lista para emitir" si está vacía.
  - **Tarjeta Emisor:**
    - nombre, RUT y dirección en solo lectura, con un link a `/configuracion/razones-sociales`;
    - un formulario con giro, comuna, ambiente (`USelect`, certificación o producción), fecha y número de resolución;
    - guardar hace `PATCH` y refresca el perfil;
    - sin emisor, la tarjeta dice "Marca una razón social como preferida" con el link.
  - **Tarjeta Certificado:**
    - firmante, RUT y vencimiento;
    - el aviso `CERTIFICADO_POR_VENCER` si viene;
    - el botón "Subir certificado" abre un modal con `UFileUpload` o `UInput type=file` (`.pfx`, `.p12`) y la clave (`type="password"`), y hace `POST`;
    - el error del 400 se muestra tal cual (`e.data.message`);
    - la clave se limpia al cerrar el modal.
  - **Tarjeta Folios:**
    - `UTable` con tipo, rango, usados, restantes, ambiente y fecha de autorización;
    - "otro ambiente" se marca si `caf.ambiente !== emisor.ambiente`;
    - el aviso `POCOS_FOLIOS`;
    - el botón "Subir CAF" (`.xml`) hace `POST`;
    - "Borrar" solo cuando `borrable`, con un modal de confirmación.
  - Tokens semánticos de Nuxt UI, sin colores de Tailwind sueltos (`npm run design:check`).
- [ ] **Step 4: Menú.** En el grupo Organización de `configuracion.vue`, después de Razones sociales:

```ts
// Hasta que el sistema emita (subproyecto 4) la ve solo el superadmin: un comercio no ve una
// pantalla que promete boletas que todavía no salen (owner, 2026-10-14). La ruta sigue siendo
// admin del tenant; abrirla a todos es cambiar esta condición.
auth.isSuperadmin && { label: 'Boleta electrónica', icon: 'i-lucide-receipt-text', to: '/configuracion/boleta-electronica' },
```

con `const auth = useAuthStore()`. Actualizar `configuracion.nuxt.spec.ts`: un admin no superadmin **no** ve la entrada, y uno superadmin sí.
- [ ] **Step 5: Spec de la página** (`boleta-electronica.nuxt.spec.ts`, con `useApiFetch` mockeado):
  - con faltantes, muestra cada mensaje;
  - sin emisor, muestra el link a Razones sociales;
  - "Borrar" aparece solo en el CAF con `borrable: true`.

  Ojo: el mock de `useApiFetch` contesta 200 a todo, así que estos specs no prueban el 400 real; eso lo cubre Playwright.
- [ ] **Step 6: Playwright** (`frontend/e2e/configuracion/boleta-electronica.spec.ts`).
  - **Precondición vía `api()`:** buscar o crear la razón social `'Emisor e2e pantalla'`, RUT `12.345.678-5` (distinto de los de los e2e de API, para que en local, con la misma base, no se confundan) y marcarla preferida.
  - El CAF se genera en el spec con `generateKeyPairSync` de `node:crypto`. Es una copia corta de `cafDePrueba`, en `frontend/e2e/support/dte.ts`, **sin literales PEM**.
  - El rango depende de la hora (`const base = (Math.floor(Date.now() / 1000) % 1_000_000) * 1000`), para no chocar con una corrida anterior en la misma base.
  - **Casos:**
    - editar giro y comuna, elegir certificación, guardar → desaparecen esos faltantes;
    - subir el CAF → aparece en la tabla con sus restantes;
    - subir un certificado con un archivo que no es `.pfx` → se ve el mensaje del 400.

  El camino feliz del certificado queda en el e2e de API: Playwright no tiene `node-forge` para armar un `.pfx`, y se dice en el reporte.
- [ ] **Step 7:**
  - `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`;
  - con el stack propio (`./scripts/entorno.sh stack`, en el turno de la orquestadora si hay varias sesiones), `npx playwright test e2e/configuracion/boleta-electronica.spec.ts e2e/configuracion/menu-configuracion.spec.ts`. Esperado: PASS.
- [ ] **Step 8: Commit**

```bash
git add frontend/app/composables/usePerfilFiscal.ts frontend/app/composables/usePerfilFiscal.spec.ts frontend/app/pages/configuracion/boleta-electronica.vue frontend/app/pages/configuracion/boleta-electronica.nuxt.spec.ts frontend/app/pages/configuracion.vue frontend/app/pages/configuracion.nuxt.spec.ts frontend/e2e/configuracion/menu-configuracion.spec.ts frontend/e2e/configuracion/boleta-electronica.spec.ts frontend/e2e/support/dte.ts
git commit -m "feat(dte): pantalla de boleta electrónica (solo superadmin hasta emitir)"
```

### Task 10: documentación, Railway y cierre

**Files:**
- Modify: `docs/features/emision-electronica.md` (sección nueva "Perfil fiscal", con las reglas de la spec § 2–5, la API de `FoliosService` y los códigos nuevos)
- Modify: `docs/adr/033-emisor-dte-propio.md` (la clave propia y por qué está separada; pasos para rotarla)
- Modify: `docs/ESTADO.md` (fila "Perfil fiscal del emisor", ✅ 2026-10-14, "solo superadmin la ve; no se emite nada al SII")
- Modify: `docs/agent/desarrollo-nuevo.md` (subproyecto 1 hecho; lo que sigue)
- Delete: `docs/superpowers/plans/2026-10-14-perfil-fiscal-emisor.md` y su spec, según `docs/superpowers/README.md` (lo durable queda en `features/` y el ADR)

- [ ] **Step 1:** escribir los docs. En español, cortos, con el porqué. Lo que queda abierto:
  - un CAF de producción subido en certificación no se detecta;
  - la firma del SII sobre el CAF no se verifica;
  - el vencimiento del CAF de boleta;
  - la custodia del certificado;
  - `CdgSIISucur` por local.
- [ ] **Step 2: Gate completo**, sin cortar la salida con `| tail`, que descarta el exit code:
  - `cd backend && npm run lint:check && npm run typecheck && npm test`;
  - `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`.
- [ ] **Step 3: Commit de docs**

```bash
git add docs/features/emision-electronica.md docs/adr/033-emisor-dte-propio.md docs/ESTADO.md docs/agent/desarrollo-nuevo.md docs/superpowers/plans/2026-10-14-perfil-fiscal-emisor.md docs/superpowers/specs/2026-10-14-perfil-fiscal-emisor-design.md
git commit -m "docs(dte): perfil fiscal del emisor (subproyecto 1)"
```

- [ ] **Step 4: Railway.**
  - Pedirle al owner que cargue `DTE_ENCRYPTION_KEY` en el servicio `backend` de Railway, con un valor generado por `openssl rand -base64 32` que **no** sea el de `.env.example`.
  - Alternativa: cargarla con el MCP de Railway, con su permiso explícito.
  - Confirmar que está antes de seguir.
- [ ] **Step 5: Push y CI.**
  - `git push origin main`;
  - buscar el run por SHA (`gh run list --commit <sha>`) y esperarlo;
  - con el CI en verde, confirmar que el deployment del backend quedó en SUCCESS y que el arranque no se cayó por la variable.
