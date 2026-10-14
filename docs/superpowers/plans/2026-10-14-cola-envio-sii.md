# Plan: la cola de envío de la boleta al SII (subproyecto 3 del emisor DTE)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft · **Date:** 2026-10-14 · **Owner:** Cesar Matheus

**Goal:** que cada boleta que el subproyecto 4 encole llegue al SII dentro de la hora, sin que la venta espere, y quede con el estado y el motivo que devuelve el SII.

**Architecture:**
- **Datos.** `dte_documentos` (una fila por boleta, con el `<DTE>` firmado y su estado) y `dte_envios` (un sobre mandado, con su `trackid`).
- **Entrada.** `ColaDteService.encolar`, dentro de la transacción de la venta.
- **Salida.** Dos jobs del módulo `cron`: uno arma lotes y envía, otro consulta el resultado.
- **SII.** `SiiBoletaCliente` habla con la API REST de boleta (`fetch` de Node, sin dependencias nuevas), con el token cacheado por certificado.

**Tech Stack:** NestJS + TypeORM (migraciones, ADR-030), `Db`/`TxContext` (ADR-020), `@nestjs/schedule` vía `CronRunnerService`, `fetch`/`FormData` nativos de Node 22, el motor `backend/src/modules/dte/` (ADR-033), `xml-crypto`, Jest, `xmllint-wasm` (solo pruebas).

**Spec:** [`docs/superpowers/specs/2026-10-14-cola-envio-sii-design.md`](../specs/2026-10-14-cola-envio-sii-design.md), aprobada por el owner el 2026-10-14.

## Context

- Lo que ya existe y este plan consume (API pública en [`features/emision-electronica.md`](../../features/emision-electronica.md)):
  - `emitirBoleta(...) → BoletaEmitida { xml, rutEmisor, folio, tipo, diferenciaIvaRedondeo }` y `armarEnvioBoleta(boletas, caratula, certificado, ahora): string` (`envio-boleta.ts`). El sobre sale como texto; **los bytes al SII salen de `aLatin1(sobre)`** (`texto.ts`), nunca de `Buffer.from(sobre)`.
  - `firmarNodo(xml, id, cert)` en `firma.ts`: XMLDSig RSA-SHA1, C14N inclusivo, sin reserializar.
  - `FoliosService.credencialesParaFirmar(tenantId, cafId, ahora) → { caf, certificado, emisor, caratula }` (`folios.service.ts`). Rechaza con `DteError` (`SIN_CERTIFICADO`, `CERTIFICADO_VENCIDO`, `PERFIL_INCOMPLETO`, `AMBIENTE_DISTINTO`).
  - `CronRunnerService.ejecutar(job, fn)` y el patrón de `backend/src/modules/cron/jobs/expirar-ordenes.job.ts`. **El runner escribe una fila en `cron_ejecuciones` por corrida.**
  - `backend/test/helpers/carrera.ts` (`pg_blocking_pids`) para pruebas de concurrencia determinísticas.
- La API del SII está medida en la spec § 2 (OpenAPI 1.0.5). Hay una copia en el scratchpad de la sesión que escribió el plan, pero la fuente es la URL de la spec.

## Decisions / Open questions

Decisiones del controlador al escribir el plan, sobre lo que la spec dejó abierto:

- **Las credenciales del lote salen de `credencialesParaFirmar`**, con el `caf_id` de la boleta más antigua del lote. Ya trae el certificado y la carátula, y ya rechaza si la empresa cambió de ambiente, si el certificado venció o si falta un dato. Un `DteError` ahí **no rechaza las boletas**: vuelven a `pendiente` con el error y la espera creciente, y quedan atrasadas a la vista hasta que el dueño suba un certificado vigente o vuelva al ambiente. El CAF que también descifra no se usa: es una lectura de más por lote, no por boleta.
- **Un tick sin trabajo no escribe en `cron_ejecuciones`.**
  - Cada tick mira primero con un `EXISTS` barato si hay algo que hacer. Solo si hay entra en `runner.ejecutar`.
  - Con ticks cada 30 s y cada minuto, registrar cada corrida serían ~4.300 filas por día.
- **Los jobs se apagan en los e2e** con `DTE_COLA_AUTOMATICA=false`.
  - Va en `backend/test/setup-env.ts` con `??=`, y en el default de docker-compose para dev.
  - Las pruebas llaman a los métodos del job a mano.
  - Sin eso, un tick automático podría tomar boletas a mitad de un test, y pegarle al SII real: las URLs por defecto son las del SII.
  - En producción el default es encendido, pero hoy no hay boletas, así que no sale nada.
- **El token se cachea por `(ambiente, sha256(certificadoB64))`**: el token es del firmante y del servidor.
- **La pausa por límite del SII** es un `pausadoHasta: number` en memoria del cliente, compartido por los dos jobs del proceso.
- **`firmarDocumento`** va en `firma.ts`, al lado de `firmarNodo`, y comparte sus constantes.

## Global Constraints

- Español en código, mensajes y docs.
- `tenant_id` siempre del token o de la fila, nunca de un parámetro externo. Toda lectura filtra `eliminado_el IS NULL`, en cada join. Nunca `DELETE`.
- **Sin dependencias nuevas**: `fetch`, `FormData`, `Blob` y `http` nativos de Node 22.
- **Los bytes que van al SII salen de `aLatin1(texto)`**, nunca de `Buffer.from(texto)`.
- **Ninguna llamada HTTP con una transacción abierta.**
- Constantes: `LOTE_MAXIMO = 50`, `ESPERA_LOTE_MS = 5 * 60_000`, `RESERVA_MS = 5 * 60_000`, `ESPERA_CONSULTA_MS = 10 * 60_000`, `REPITE_CONSULTA_MS = 5 * 60_000`, `PLAZO_404_MS = 24 * 3_600_000`, `TOKEN_VIGENCIA_MS = 50 * 60_000`, y la escala de reintentos `[30_000, 60_000, 120_000, 300_000]` seguida de `600_000` sin tope.
- URLs por configuración, con estos defaults:
  - `SII_BOLETA_API_CERTIFICACION=https://apicert.sii.cl/recursos/v1`;
  - `SII_BOLETA_ENVIO_CERTIFICACION=https://pangal.sii.cl/recursos/v1`;
  - `SII_BOLETA_API_PRODUCCION=https://api.sii.cl/recursos/v1`;
  - `SII_BOLETA_ENVIO_PRODUCCION=https://rahue.sii.cl/recursos/v1`.
- Estados de `dte_documentos`: `'pendiente' | 'enviado' | 'aceptado' | 'reparos' | 'rechazado'`.
- Repos con `RepositoriosModule.forFeature`, acceso crudo con `Db`, `RETURNING` por `unwrap()`, entity en `ENTIDADES` más su migración generada y leída (`docs/patterns/backend.md` § 1, 5, 9 y 22).
- Subagentes con `model: 'sonnet'`. El implementador **stagea por ruta y no commitea**; commit y recibo de revisión los hace el controlador. Nunca `--no-verify`. Nunca stagear `.claude/settings.local.json`.
- Repo público: sin secretos, y sin el literal de cabecera PEM de llave privada en un archivo.

## Review Focus

1. **El proceso se cae con un sobre en vuelo.** La reserva vence y las boletas vuelven a la cola. Ninguna queda `enviado` sin `envio_id` con `trackid` ni se pierde (tarea 6).
2. **Dos instancias del backend** corren el tick de envío a la vez: ninguna boleta sale en dos sobres (tarea 6).
3. **Certificado vencido entre la venta y el envío.** Las boletas no se rechazan: quedan pendientes con el error y reintentan (tarea 6).
4. **Un sobre con una boleta rechazada, otra con reparos y el resto aceptadas.** Cada una queda con su estado y sus errores, y un error con `folio` null alcanza a todas (tarea 7).
5. **El SII contesta 405 o `X-RateLimit-Remaining: 0`.** Los dos jobs se pausan hasta el reset, sin quemar reintentos (tareas 4 y 6).

## Scope / Out of scope

Lo de la spec § 1. Fuera de este plan: quién llama a `encolar` (subproyecto 4), la consulta por boleta individual, pantalla y avisos.

---

### Task 1: el esquema del sobre que publica el SII hoy

**Files:**
- Modify: `backend/src/modules/dte/esquemas/EnvioBOLETA_v11.xsd` (reemplazo por el del zip 720)
- Modify: `backend/src/modules/dte/esquemas/EnvioBOLETA_v11_formato42.xsd` (rehecho sobre el 720)
- Test: `backend/src/modules/dte/boleta-documento.spec.ts`, `envio-boleta.spec.ts`, `ted.spec.ts` (sin cambios esperados)

**Interfaces:** ninguna nueva. El motor no emite `Referencia` ni `TpoTiket` (verificado con grep), así que los cambios del 720 no deberían romperlo.

- [ ] **Step 1: Bajar el zip 720** del SII a un directorio propio del scratchpad: `curl -sSL -o s.zip http://www.sii.cl/factura_electronica/factura_mercado/schema_envio_bol_720.zip && unzip s.zip`. Trae `EnvioBOLETA_v11.xsd` y `xmldsignature_v10.xsd`.
- [ ] **Step 2: Comparar** con `iconv -f latin1 -t utf8` + `diff` contra los dos archivos del repo. Anotar en el reporte cada diferencia. Las esperadas:
  - `DTE maxOccurs="500"`;
  - `Detalle minOccurs="0"`;
  - `TpoDocRef` y `FolioRef` en `Referencia`;
  - `TpoTicket`;
  - `OrdenSTI` opcional.

  Si el `xmldsignature_v10.xsd` difiere, también se reemplaza.
- [ ] **Step 3:**
  - Copiar el `EnvioBOLETA_v11.xsd` del zip **byte a byte** sobre el del repo (ISO-8859-1, sin reformatear).
  - Rehacer `EnvioBOLETA_v11_formato42.xsd`: partir de la copia nueva y volver a sumar los cinco campos del formato 4.2 (`MedioPago`, `CorreoRecep`, `TelefonoRecep`, `RutProvSW`, `RznSocProvSW`), en el mismo lugar y con el mismo comentario de procedencia que tienen hoy.
  - Actualizar el comentario de cabecera, que hoy dice que el SII no publica un esquema posterior al v11: ahora dice que la copia parte del zip `schema_envio_bol_720.zip` (2026-10-14).
- [ ] **Step 4:** `cd backend && npx jest src/modules/dte`. Esperado: PASS, con el mismo número de tests que antes.
  - Si un test que validaba contra `EnvioBOLETA_v11.xsd` (sin los campos 4.2) cambia de resultado, se lee por qué antes de tocarlo.
  - Si `libxml2` no compila el esquema nuevo, revisar la corrección de `PctType` de `__fixtures__/xsd.ts`.
- [ ] **Step 5:** stagear los dos `.xsd`.

### Task 2: firmar el pedido del token

**Files:**
- Modify: `backend/src/modules/dte/firma.ts` (`firmarDocumento`)
- Test: `backend/src/modules/dte/firma.spec.ts`

**Interfaces:**
- Produces: `firmarDocumento(xml: string, cert: CertificadoLeido): string`.
  - Firma enveloped del documento entero: `Reference URI=""`, transforms `enveloped-signature` + C14N inclusivo, RSA-SHA1, SHA1, `KeyInfo` con `RSAKeyValue` + `X509Certificate`, como `firmarNodo`.
  - La `<Signature>` queda como **último hijo de la raíz**, insertada como texto antes del cierre de la raíz, sin reserializar.

- [ ] **Step 1: Tests que fallan.**

```ts
const SEMILLA_SII = '030530912644';
const getToken = (semilla: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<getToken><item><Semilla>${semilla}</Semilla></item></getToken>`;

it('el digest del getToken de la semilla de ejemplo es el que publica el SII', () => {
  const { pfx, clave } = certificadoDePrueba();
  const firmado = firmarDocumento(getToken(SEMILLA_SII), leerCertificado(pfx, clave));
  expect(firmado).toContain('<DigestValue>l2s9BqLppHaWo+w1Al1J5SsYScs=</DigestValue>');
  expect(firmado).toContain('<Reference URI="">');
  expect(firmado.endsWith('</Signature></getToken>')).toBe(true);
});
it('la firma verifica y quitar la Signature devuelve el documento original', () => {
  // verificar con SignedXml de xml-crypto (como firma-sii.spec.ts) y comparar el texto sin <Signature>…</Signature>
});
it('otra semilla da otro digest', () => {
  // '030530912645' → DigestValue distinto de l2s9…
});
```

  El tercer caso existe para que un digest hardcodeado no pase. El segundo se escribe completo, siguiendo cómo `firma-sii.spec.ts` verifica una firma.
- [ ] **Step 2:** `cd backend && npx jest src/modules/dte/firma.spec.ts`. Esperado: FAIL (`firmarDocumento` no existe).
- [ ] **Step 3: Implementación.**
  - `SignedXml` con las constantes de `firma.ts`.
  - `addReference({ xpath: '/*', uri: '', transforms: [ENVELOPED, C14N], digestAlgorithm: SHA1, isEmptyUri: true })`. Revisar la API de la versión instalada de `xml-crypto`: el nombre de la opción para `URI=""` cambia entre versiones.
  - `computeSignature(xml)` y luego **insertar `sig.getSignatureXml()` como texto** antes del último `</raíz>`, igual que `firmarNodo` evita `getSignedXml()`.
- [ ] **Step 4:** `npx jest src/modules/dte`. Esperado: PASS.
- [ ] **Step 5: Mutante.** Con la transform `enveloped-signature` sacada, el primer caso tiene que caer. Revertir con `cp` y comprobar con `cmp`. Stagear.

### Task 3: el esquema de la cola

**Files:**
- Create: `backend/src/modules/dte/entities/dte-documento.entity.ts`, `backend/src/modules/dte/entities/dte-envio.entity.ts`
- Modify: `backend/src/database/typeorm.config.ts` (`ENTIDADES`), `backend/src/modules/dte/dte.module.ts` (`forFeature`)
- Create: `backend/src/database/migrations/<timestamp>-ColaEnvioSii.ts` (generada)
- Modify: `startup-pos.sql`

**Interfaces:**
- Produces: `EstadoDocumentoDte = 'pendiente' | 'enviado' | 'aceptado' | 'reparos' | 'rechazado'`, exportado desde `dte-documento.entity.ts`, y las entities de abajo. Las usan las tareas 5 a 7.

- [ ] **Step 1: `DteDocumento`** (`dte_documentos`). Los `type` van explícitos en toda unión de TS.

```ts
@Entity('dte_documentos')
@Check('chk_dte_documentos_tipo', '"tipo" IN (39, 41)')
@Check('chk_dte_documentos_estado', `"estado" IN ('pendiente','enviado','aceptado','reparos','rechazado')`)
@Check('chk_dte_documentos_ambiente', `"ambiente" IN ('certificacion','produccion')`)
@Index('uq_dte_documentos_folio', ['razonSocialId', 'tipo', 'ambiente', 'folio'], { unique: true, where: '"eliminado_el" IS NULL' })
@Index('idx_dte_documentos_cola', ['razonSocialId', 'emitidoEl'], { where: `"estado" = 'pendiente' AND "eliminado_el" IS NULL` })
@Index('idx_dte_documentos_envio', ['envioId'])
export class DteDocumento {
  @PrimaryGeneratedColumn('uuid', { name: 'documento_id' }) id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'razon_social_id', type: 'uuid' }) razonSocialId: string;
  @Column({ name: 'caf_id', type: 'uuid' }) cafId: string;
  @Column({ type: 'smallint' }) tipo: TipoBoleta;
  @Column({ type: 'integer' }) folio: number;
  @Column({ type: 'text' }) ambiente: AmbienteSii;
  @Column({ name: 'rut_emisor', type: 'varchar', length: 12 }) rutEmisor: string;
  /** El <DTE> firmado, tal como lo devolvió emitirBoleta. Es el documento legal. */
  @Column({ type: 'text' }) xml: string;
  @Column({ type: 'text' }) estado: EstadoDocumentoDte;
  @Column({ name: 'envio_id', type: 'uuid', nullable: true }) envioId: string | null;
  /** Errores del SII para esta boleta, o el motivo del rechazo del sobre. */
  @Column({ name: 'detalle_sii', type: 'jsonb', nullable: true }) detalleSii: unknown;
  @Column({ name: 'emitido_el', type: 'timestamptz' }) emitidoEl: Date;
  @Column({ name: 'proximo_intento_el', type: 'timestamptz' }) proximoIntentoEl: Date;
  @Column({ type: 'integer', default: 0 }) intentos: number;
  @Column({ name: 'ultimo_error', type: 'text', nullable: true }) ultimoError: string | null;
  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' }) eliminadoEl: Date | null;
}
```

  `intentos` y `ultimo_error` van en el documento porque la espera creciente es por boleta (spec § 6): un sobre que falla deja de existir como unidad.
- [ ] **Step 2: `DteEnvio`** (`dte_envios`):
  - `envio_id` uuid;
  - `tenant_id`, `razon_social_id`, `ambiente` (con CHECK);
  - `trackid` `bigint` nullable. Con `transformer` a `string`, porque cabe en 15 dígitos pero `pg` devuelve bigint como string: el tipo TS es `string | null`;
  - `estado_sii` `varchar(3)` nullable;
  - `enviado_el` `timestamptz` nullable;
  - `consultar_desde` `timestamptz` nullable;
  - `reservado_hasta` `timestamptz` nullable;
  - `intentos_consulta` `integer` default 0;
  - `ultimo_error` `text` nullable;
  - `respuesta_sii` `jsonb` nullable;
  - timestamps y `eliminado_el`;
  - índice parcial `idx_dte_envios_consulta (consultar_desde) WHERE "trackid" IS NOT NULL AND "eliminado_el" IS NULL`.

  Docblock: un sobre mandado al SII. El estado de cada boleta vive en `dte_documentos`; acá queda lo del envío.
- [ ] **Step 3:**
  - registrar las dos en `ENTIDADES` y en `RepositoriosModule.forFeature` de `DteModule`;
  - con la base al día, `cd backend && npm run migration:generate -- ColaEnvioSii`;
  - **leer la migración**: dos `CREATE TABLE` con los CHECK (migration:generate no siempre ve los CHECK: verificar que estén) y los índices parciales con su `WHERE`, sin ningún `DROP`;
  - copiar el DDL a `startup-pos.sql` con el comentario "sin FK en la base real" como `dte_cafs`.
- [ ] **Step 4:** `npm run migration:run && npm run migration:check` (exit 0), `npm run typecheck`, `npx jest --config ./test/jest-e2e.json test/esquema.e2e-spec.ts`.
- [ ] **Step 5:** stagear.

### Task 4: el cliente de la API del SII

**Files:**
- Create: `backend/src/modules/dte/sii-boleta.cliente.ts`, `backend/src/modules/dte/sii-boleta.cliente.spec.ts`
- Create: `backend/src/modules/dte/__fixtures__/sii-falso.ts` (servidor HTTP de prueba, lo usan también las tareas 6 y 7)
- Modify: `backend/src/modules/dte/dte.module.ts` (provider), `.env.example` (las cuatro URLs comentadas)

**Interfaces:**
- Consumes: `firmarDocumento` (tarea 2), `CertificadoLeido`, `AmbienteSii`, `aLatin1`.
- Produces:

```ts
export type RespuestaSii<T> =
  | { tipo: 'ok'; datos: T; reintentarEnMs: number | null }   // reintentarEnMs = X-Retry-After en ms
  | { tipo: 'no_autorizado' }                                   // 401 (ya reintentó con token nuevo)
  | { tipo: 'peticion_invalida'; mensaje: string }              // 400
  | { tipo: 'no_encontrado' }                                   // 404
  | { tipo: 'transitorio'; mensaje: string };                   // red, timeout, 5xx, 405, pausa

export interface ResultadoEnvio { trackid: string; estado: string }
export interface EstadoEnvioSii {
  estado: string;
  detalle_rep_rech?: { tipo: number | null; folio: number | null; estado: string;
    descripcion?: string; error?: unknown[] }[];
}

@Injectable()
export class SiiBoletaCliente {
  enviar(ambiente: AmbienteSii, cert: CertificadoLeido, rutEmisor: string, sobre: string)
    : Promise<RespuestaSii<ResultadoEnvio>>;
  consultarEnvio(ambiente: AmbienteSii, cert: CertificadoLeido, rutEmisor: string, trackid: string)
    : Promise<RespuestaSii<EstadoEnvioSii>>;
  /** ms epoch hasta el que no se le pega al SII (405 o X-RateLimit-Remaining 0). */
  pausadoHasta(): number;
}
```

  **Reglas del cliente:**
  - **Token:**
    - `GET {api}/boleta.electronica.semilla`, leer `<SEMILLA>` del XML de respuesta.
    - Armar el `getToken` de dos líneas de la tarea 2, `firmarDocumento` y `POST {api}/boleta.electronica.token` (`Content-Type: application/xml`).
    - Leer `<TOKEN>` y cachear por `${ambiente}:${sha256(cert.certificadoB64)}` con la hora de uso. Se renueva el uso en cada llamada exitosa y vence a los `TOKEN_VIGENCIA_MS` sin uso.
    - Un 401 en envío o consulta borra el token, pide otro y reintenta **una vez**.
  - **Envío:**
    - `POST {envio}/boleta.electronica.envio`, con `FormData`: `rutSender` y `dvSender` del `cert.rut`, `rutCompany` y `dvCompany` del `rutEmisor`, y `archivo` = `new Blob([aLatin1(sobre)], { type: 'text/xml' })`, nombre `envio.xml`.
    - Headers `Cookie: TOKEN=…` y `User-Agent: Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)` (el del ejemplo del OpenAPI).
    - Lee `trackid` y `estado` del JSON.
  - **Consulta:** `GET {api}/boleta.electronica.envio/{rut}-{dv}-{trackid}`, con la cookie.
  - **Timeout** de 20 s por pedido (`AbortSignal.timeout`). Red caída o timeout → `transitorio`.
  - **Límite:**
    - un 405 pone `pausadoHasta = now + (X-RateLimit-Reset ?? 60) s` y devuelve `transitorio`;
    - una respuesta con `X-RateLimit-Remaining: 0` pone la pausa igual pero devuelve su resultado;
    - con `now < pausadoHasta`, el cliente no llama y devuelve `transitorio`.
  - **URLs** de `ConfigService` con los defaults de Global Constraints.
- [ ] **Step 1: El SII falso** (`__fixtures__/sii-falso.ts`): `http.createServer` en un puerto libre (`listen(0)`), con un guion configurable por test (`siiFalso.responder('envio', { status: 405, headers: {...} })`) y el registro de cada pedido recibido (método, ruta, headers, cuerpo crudo como `Buffer`). Default:
  - semilla `<?xml…><SII:RESPUESTA …><SII:RESP_BODY><SEMILLA>030530912644</SEMILLA></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>`;
  - token `<TOKEN>P7VQKYLDNHJGP</TOKEN>` en la misma forma;
  - envío `200 {"rut_emisor":…,"trackid":1014,"estado":"REC",…}`;
  - consulta `200 {"estado":"EPR",…}`.

  Con la forma del OpenAPI (spec § 2). Si el XML real de la semilla no se puede confirmar, el parser del cliente busca `<SEMILLA>` y `<TOKEN>` sin depender del prefijo, y se dice en el reporte.
- [ ] **Step 2: Tests que fallan** (`sii-boleta.cliente.spec.ts`, contra el falso):
  - el primer envío pide semilla y token, y el segundo reusa el token (dos pedidos de token contados en el falso → 1);
  - el cuerpo del token verifica como firma y contiene la semilla que dio el falso;
  - el `archivo` del multipart llega con los bytes latin1: un sobre con `Ñ` llega como `0xD1`, no como `0xC3 0x91`;
  - `rutSender` es el del certificado y `rutCompany` el del emisor;
  - 401 → token nuevo y reintento; dos 401 seguidos → `no_autorizado`;
  - 400 → `peticion_invalida` con el texto;
  - 500 y timeout → `transitorio`;
  - 405 con `X-RateLimit-Reset: 37` → `transitorio`, `pausadoHasta` ≈ now + 37 s, y el pedido siguiente no llega al falso;
  - `X-Retry-After: 23` en un 200 → `reintentarEnMs: 23000`;
  - el token vence a los 50 min sin uso (`jest.useFakeTimers` o un reloj inyectado), y se pide otro;
  - certificación y producción usan sus servidores (el falso registra el host, o se configuran cuatro URLs distintas al mismo falso con prefijos de ruta distintos).
- [ ] **Step 3:** `npx jest src/modules/dte/sii-boleta.cliente.spec.ts`. Esperado: FAIL.
- [ ] **Step 4:** implementar. El reloj entra por un `ahora: () => number` del constructor con default `Date.now`, para testear vencimientos sin timers reales.
- [ ] **Step 5:** PASS más `npm run lint:check && npm run typecheck`. Stagear.

### Task 5: encolar

**Files:**
- Create: `backend/src/modules/dte/cola-dte.service.ts`, `backend/src/modules/dte/cola-dte.service.spec.ts`
- Modify: `backend/src/modules/dte/dte.module.ts` (provider y export)
- Create: `backend/test/dte-cola.e2e-spec.ts`

**Interfaces:**
- Consumes: `BoletaEmitida`, `TxContext`, `Db`, las entities de la tarea 3.
- Produces: `ColaDteService.encolar(tenantId: string, boleta: BoletaEmitida, cafId: string): Promise<{ documentoId: string }>`. Lo usa el subproyecto 4.

- [ ] **Step 1: Implementación.**
  - Exige `this.tx.managerActivo()`, con el mismo mensaje de `tomarFolio` adaptado.
  - Un `INSERT … SELECT` desde `dte_cafs` (`caf_id = $cafId AND tenant_id = $tenantId AND eliminado_el IS NULL`) que toma `razon_social_id` y `ambiente` del CAF. Inserta `estado 'pendiente'`, `emitido_el = now()`, `proximo_intento_el = now()` y el `xml`, `tipo`, `folio` y `rut_emisor` de la boleta, con `RETURNING documento_id`.
  - Sin fila → `DteError('SIN_FOLIOS', …)`.
  - `boleta.rutEmisor` distinto del `rut_emisor` del CAF → `DteError` (`ENVIO_OTRO_EMISOR`, ya existe).
- [ ] **Step 2: Tests:**
  - unit: sin transacción tira; el SQL filtra `tenant_id` y `eliminado_el`;
  - e2e:
    - con razón social, certificado y CAF propios cargados por la API, con el arranque de `backend/test/dte-folios.e2e-spec.ts` (RUT `76.555.444-6`, nombre `'Emisor e2e cola'`, con la misma limpieza `beforeAll`/`afterAll` por `UPDATE`);
    - `tomarFolio` + `credencialesParaFirmar` + `emitirBoleta` + `encolar` dentro de una `db.transaccion` → hay una fila `pendiente`;
    - lo mismo con un `throw` al final → no hay fila;
    - el mismo folio dos veces → error de unicidad (`uq_dte_documentos_folio`), sin fila duplicada.
- [ ] **Step 3:** el e2e en primer plano, `npm test`, `lint:check`, `typecheck`. Stagear.

### Task 6: el job de envío

**Files:**
- Create: `backend/src/modules/dte/jobs/enviar-boletas.job.ts`, `backend/src/modules/dte/jobs/enviar-boletas.job.spec.ts`
- Modify: `backend/src/modules/dte/dte.module.ts` (importa `CronModule`; provider), `backend/test/setup-env.ts` (`DTE_COLA_AUTOMATICA ??= 'false'`), `docker-compose.yml` (`DTE_COLA_AUTOMATICA: ${DTE_COLA_AUTOMATICA:-false}`), `.env.example`
- Modify: `backend/test/dte-cola.e2e-spec.ts`

**Interfaces:**
- Consumes: `SiiBoletaCliente` (tarea 4), `FoliosService.credencialesParaFirmar`, `armarEnvioBoleta`, `CronRunnerService`.
- Produces: `EnviarBoletasJob.enviarLotes(ahora = new Date()): Promise<string>` (pública, para las pruebas) y el tick `@Cron('*/30 * * * * *')`.

**El tick:**
- Si `DTE_COLA_AUTOMATICA === 'false'` o `cliente.pausadoHasta() > Date.now()`, no hace nada.
- Si no, un `SELECT EXISTS(…)` de pendientes o de reservas vencidas. Solo si hay algo entra en `runner.ejecutar('enviar-boletas', () => this.enviarLotes())`.

**`enviarLotes`:**
1. **Devolver las reservas vencidas:** `UPDATE dte_documentos d SET estado='pendiente', envio_id=NULL FROM dte_envios e WHERE d.envio_id = e.envio_id AND d.estado='enviado' AND e.trackid IS NULL AND e.reservado_hasta < now() AND e.eliminado_el IS NULL AND d.eliminado_el IS NULL`.
2. **Elegir razones sociales listas**, por orden de su pendiente más antigua, en una consulta:

```sql
SELECT razon_social_id, tenant_id, ambiente, min(emitido_el) AS mas_antigua, count(*) AS cuantas
  FROM dte_documentos
 WHERE estado = 'pendiente' AND eliminado_el IS NULL AND proximo_intento_el <= now()
 GROUP BY razon_social_id, tenant_id, ambiente
HAVING count(*) >= 50 OR min(emitido_el) <= now() - interval '5 minutes'
 ORDER BY min(emitido_el)
```

3. **Por cada una (un lote por razón social y por tick):**
   1. **Reserva**, en `db.transaccion`:
      - `SELECT documento_id, caf_id, xml, folio, tipo, rut_emisor FROM dte_documentos WHERE razon_social_id=$1 AND ambiente=$2 AND estado='pendiente' AND proximo_intento_el <= now() AND eliminado_el IS NULL ORDER BY emitido_el LIMIT 50 FOR UPDATE SKIP LOCKED`;
      - sin filas → sigue con la próxima razón social;
      - `INSERT dte_envios (… reservado_hasta = now() + 5 min) RETURNING envio_id`;
      - `UPDATE dte_documentos SET estado='enviado', envio_id=$1 WHERE documento_id = ANY($2)`;
      - commit.
   2. **Credenciales**, fuera de la transacción: `credencialesParaFirmar(tenantId, cafIdDeLaMasAntigua, ahora)`. Un `DteError` → **devolver** (ver abajo) con `ultimo_error = e.message`, y seguir con la próxima razón social.
   3. **Sobre:** `armarEnvioBoleta(lote.map(aBoletaEmitida), caratula, certificado, ahoraChile)`. `ahoraChile` es la hora de Chile AAAA-MM-DDTHH:MM:SS: usar el formateador que ya use el motor o sus pruebas; no inventar otro.
   4. **`cliente.enviar(...)`** y anotar según la tabla:

| Resultado | Envío | Boletas |
|---|---|---|
| `ok` | `trackid`, `estado_sii`, `enviado_el = now()`, `consultar_desde = now() + max(10 min, reintentarEnMs)`, `reservado_hasta = NULL` | siguen `enviado` |
| `transitorio`, `no_autorizado` o `DteError` de credenciales | `ultimo_error`, `reservado_hasta = NULL`, `eliminado_el = now()`: el sobre no existió para el SII. Es soft delete, con el porqué en el comentario | **devolver**: `estado='pendiente'`, `envio_id=NULL`, `intentos = intentos + 1`, `ultimo_error`, `proximo_intento_el = now() + espera(intentos)` |
| `peticion_invalida` | `ultimo_error`, `reservado_hasta = NULL` | `estado='rechazado'`, `detalle_sii = { origen: 'envio', mensaje }` |

   `espera(n)` = `[30s, 1m, 2m, 5m][n-1] ?? 10m`, una función pura exportada y testeada.

   Las tres anotaciones de cada fila van en una `db.transaccion`, con un `UPDATE … WHERE documento_id = ANY($1)`. Sin una query por boleta.

- [ ] **Step 1: Tests unitarios:**
  - `espera(1..6)`;
  - el reparto de la tabla con `Db` y cliente mockeados: `ok` no toca boletas; `transitorio` devuelve con `intentos+1`; `peticion_invalida` rechaza.
- [ ] **Step 2: e2e** (en `dte-cola.e2e-spec.ts`, cliente contra el SII falso apuntando las URLs por `ConfigService`, o con `overrideProvider` de las URLs):
  - **la regla del lote:** 3 boletas recién emitidas → `enviarLotes` no manda nada. Con `emitido_el` corrido 6 minutos atrás por SQL (con comentario) → manda un sobre con las 3. 50 recién emitidas → sale sin esperar;
  - **ok:** el envío queda con `trackid` 1014 y `consultar_desde` ≈ +10 min; las boletas `enviado`;
  - **transitorio (500):** vuelven a `pendiente`, `intentos 1`, `proximo_intento_el` ≈ +30 s, y el envío queda soft-deleted;
  - **400:** `rechazado` con `detalle_sii.origen = 'envio'`;
  - **certificado vencido** (Review Focus 3): con el certificado anulado por SQL (como hace la limpieza), las boletas quedan `pendiente` con `ultimo_error` de `SIN_CERTIFICADO`, no `rechazado`;
  - **reserva vencida** (Review Focus 1): un envío con `reservado_hasta` en el pasado y `trackid` null → el siguiente `enviarLotes` devuelve sus boletas y las vuelve a mandar;
  - **dos instancias** (Review Focus 2): dos `enviarLotes` concurrentes con un lote de 4 boletas. Uno de ellos se frena en la reserva: retener la primera fila con un query runner propio (`FOR UPDATE`), confirmar con `pg_blocking_pids` que el otro espera, soltar. Resultado: cada boleta está en un solo `dte_envios` y el SII falso recibió las 4 una sola vez en total;
  - **405** (Review Focus 5): el primer envío recibe 405 con `X-RateLimit-Reset: 120` → las boletas vuelven y un segundo `enviarLotes` no llega al falso;
  - **el tick apagado:** con `DTE_COLA_AUTOMATICA=false`, `tick()` no llama a `enviarLotes`, y con trabajo pendiente no escribe en `cron_ejecuciones`. Sin trabajo y encendido, tampoco escribe.
- [ ] **Step 3: Mutantes**, revertidos con `cp` y comprobados con `cmp`. Anotar cuál cae:
  - sin `SKIP LOCKED`;
  - sin el paso 1 (reservas vencidas);
  - `HAVING` con `>= 5` en vez de 50;
  - `transitorio` que rechaza en vez de devolver.
- [ ] **Step 4:** el e2e dos veces seguidas, `npm test`, `lint:check`, `typecheck`. Stagear.

### Task 7: el job de consulta

**Files:**
- Create: `backend/src/modules/dte/jobs/consultar-envios.job.ts`, `backend/src/modules/dte/jobs/consultar-envios.job.spec.ts`
- Create: `backend/src/modules/dte/resultado-sii.ts`, `backend/src/modules/dte/resultado-sii.spec.ts` (el reparto puro)
- Modify: `backend/src/modules/dte/dte.module.ts`, `backend/test/dte-cola.e2e-spec.ts`

**Interfaces:**
- Produces:
  - `repartirResultado(estado: EstadoEnvioSii, boletas: { documentoId: string; tipo: number; folio: number }[]) → { final: boolean; cambios: { documentoId; estado: EstadoDocumentoDte; detalleSii: unknown }[] }`, una función pura.
  - `ConsultarEnviosJob.consultar(ahora = new Date()): Promise<string>`.
  - El tick `@Cron(CronExpression.EVERY_MINUTE)`, con la misma regla de apagado, pausa y `EXISTS` previo de la tarea 6.

**Reparto** (spec § 6):
- `EPR` o `RPR` → final. Por boleta:
  - en `detalle_rep_rech` con su `tipo` y `folio` y `estado: 'RCH'` → `rechazado`;
  - con `'RPR'` → `reparos`;
  - ausente → `aceptado`;
  - `detalle_sii` = la entrada del SII.
  - Una entrada con `folio` null se aplica a **todas** las boletas del sobre: si es `RCH`, todas `rechazado`.
- `RCH`, `RCO`, `RFR`, `RSC`, `RCT`, `VOF` → final. Todas `rechazado`, con `detalle_sii = { origen: 'sobre', estado, descripcion }`.
- `RPT` → final para el envío, **sin cambios** en las boletas (quedan `enviado`). En el envío queda `ultimo_error = 'El SII ya tenía este envío (RPT)'`.
- `REC`, `SOK`, `FOK`, `CRT`, `PRD` y cualquier código desconocido → no final.

**`consultar`:**
- toma con `FOR UPDATE SKIP LOCKED` hasta 20 envíos con `trackid IS NOT NULL`, `estado_sii` no final, `consultar_desde <= now()` y `eliminado_el IS NULL`;
- descifra el certificado con `credencialesParaFirmar` (caf de una boleta del envío) y consulta.

| Resultado | Qué anota |
|---|---|
| `ok` | `estado_sii`, `respuesta_sii`, `intentos_consulta+1`. Si es final, aplica los cambios en un `UPDATE` por estado (no por boleta). Si no, `consultar_desde = now() + max(5 min, reintentarEnMs)` |
| `no_encontrado` | Si `enviado_el` tiene menos de 24 h, `consultar_desde = now() + 5 min`. Si tiene más, `ultimo_error` "El SII no encuentra el envío" y `consultar_desde = NULL`, que lo saca de la consulta |
| `transitorio`, `no_autorizado`, `peticion_invalida` o `DteError` | `ultimo_error` y `consultar_desde = now() + 5 min` |

- [ ] **Step 1: Tests de `repartirResultado`**, uno por fila de arriba más:
  - **un sobre mixto** (Review Focus 4): 4 boletas, una `RCH` con dos errores, una `RPR`, dos aceptadas;
  - una entrada con `folio` null;
  - un código desconocido (`'XYZ'`) → no final.

  Fixtures con folios no consecutivos (2041, 2053, 2077, 2090). Una boleta 39 y una 41 con el **mismo folio** tienen que repartirse por `(tipo, folio)`, no solo por folio.
- [ ] **Step 2:** FAIL, implementar, PASS.
- [ ] **Step 3: e2e:**
  - de punta a punta contra el SII falso: encolar 4 → `enviarLotes` → con `consultar_desde` corrido al pasado por SQL → `consultar` con el falso devolviendo el sobre mixto → los cuatro estados y `detalle_sii`;
  - `PRD` → sigue `enviado` y `consultar_desde` ≈ +5 min;
  - 404 a las 25 h → `consultar_desde` null;
  - una boleta con `emitido_el` de hace 61 min y `estado 'enviado'` se lee atrasada con la condición de la spec § 3. Es una consulta de prueba que fija la definición para el subproyecto 4.
- [ ] **Step 4: Mutantes**, revertidos con `cp` y comprobados con `cmp`:
  - repartir por folio sin tipo;
  - `RPT` que rechaza;
  - `folio` null que no alcanza a todas.

  Después, el e2e dos veces, `npm test`, `lint:check`, `typecheck`. Stagear.

### Task 8: documentación y cierre

**Files:**
- Modify: `docs/features/emision-electronica.md` (sección "Envío al SII": la cola, los estados, "atrasada", las reglas de § 6 y lo abierto de § 8), `docs/ESTADO.md` (fila de la cola de envío), `docs/agent/desarrollo-nuevo.md` (subproyecto 3 hecho; lo que sigue), `docs/ARCHITECTURE.md` (los dos jobs del módulo `dte`)
- Delete: este plan y su spec (`docs/superpowers/README.md`)

- [ ] **Step 1:** escribir los docs, verificando cada regla contra el código.
- [ ] **Step 2: Gate:**
  - `cd backend && npm run lint:check && npm run typecheck && npm test`;
  - `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`. El frontend no se toca, pero el gate es entero;
  - los e2e `dte-cola`, `dte-folios` y `dte-perfil`.
- [ ] **Step 3:** stagear docs. El controlador hace la revisión final de rama, el commit y el push.
  - No hace falta ninguna variable nueva en Railway: las URLs tienen default y `DTE_COLA_AUTOMATICA` es encendido por defecto.
  - Después, el CI por SHA y el deploy.
