# Firmado de peticiones QZ Tray (elimina el diálogo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Firmar cada petición a QZ Tray con un certificado autofirmado para que deje de mostrar el diálogo de confianza en cada impresión.

**Architecture:** Un `QzFirmaService` en el backend guarda la llave privada + certificado (env vars PEM base64) y firma con RSA-SHA512; dos endpoints exponen el certificado y la firma. El frontend configura los promises de seguridad de QZ Tray una sola vez (cert cacheado, firma por-llamada vía backend). Si las env vars no están, todo degrada al modo no-firmado actual (diálogos), sin romper nada.

**Tech Stack:** NestJS + Node `crypto` (backend), Nuxt 4 + Vue 3 + `qz-tray` (frontend), Jest.

## Global Constraints

- `tenant_id` siempre del token (`req.user`), nunca del body.
- Secretos en env vars leídas por `ConfigService` (patrón de `CredencialesService`), PEM en **base64**.
- `ConfigModule` es global (`isGlobal: true`) — `ConfigService` se inyecta sin importar nada.
- `PermisosGuard` deja pasar rutas sin `@RequiresPermiso` (`permisos.guard.ts:24`) — los endpoints QZ no llevan permiso, solo `JwtAuthGuard + TenantGuard` (aplicados a nivel de clase en `ImpresorasController`).
- Algoritmo de firma: **RSA-SHA512** (backend) ↔ `setSignatureAlgorithm('SHA512')` (frontend). El default de qz-tray es SHA1 (débil) — hay que subirlo.
- DTOs con `class-validator` (ValidationPipe global).

Spec de referencia: `docs/superpowers/specs/2026-07-13-impresion-termica-firmado-design.md`.

---

### Task 1: Backend — `QzFirmaService` + endpoints de certificado y firma

**Files:**
- Create: `backend/src/modules/impresoras/qz-firma.service.ts`
- Create: `backend/src/modules/impresoras/qz-firma.service.spec.ts`
- Create: `backend/src/modules/impresoras/dto/firmar-qz.dto.ts`
- Modify: `backend/src/modules/impresoras/impresoras.module.ts`
- Modify: `backend/src/modules/impresoras/impresoras.controller.ts`

**Interfaces:**
- Produces: `QzFirmaService.getCertificado(): string | null` y `QzFirmaService.firmar(data: string): string` (base64). Rutas `GET /impresoras/qz/certificado` → `{ certificado: string | null }` y `POST /impresoras/qz/firmar` (body `{ data: string }`) → `{ firma: string }`. Consumido por el frontend en Task 2.

- [ ] **Step 1: Escribir el test del service (falla — no existe)**

```typescript
// backend/src/modules/impresoras/qz-firma.service.spec.ts
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import {
  generateKeyPairSync,
  createVerify,
} from 'crypto';
import { QzFirmaService } from './qz-firma.service';

// Par RSA de prueba: la llave privada firma, la pública verifica.
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const CERT_PEM = '-----BEGIN CERTIFICATE-----\nMIIB-fake-cert\n-----END CERTIFICATE-----';

function buildService(env: Record<string, string | undefined>): QzFirmaService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new QzFirmaService(config);
}

describe('QzFirmaService', () => {
  const configuredEnv = {
    QZ_PRIVATE_KEY: Buffer.from(privateKey).toString('base64'),
    QZ_CERTIFICATE: Buffer.from(CERT_PEM).toString('base64'),
  };

  describe('getCertificado', () => {
    it('devuelve el certificado PEM decodificado cuando está configurado', () => {
      const service = buildService(configuredEnv);
      expect(service.getCertificado()).toBe(CERT_PEM);
    });

    it('devuelve null cuando QZ_CERTIFICATE no está', () => {
      const service = buildService({});
      expect(service.getCertificado()).toBeNull();
    });
  });

  describe('firmar', () => {
    it('firma con RSA-SHA512 y la firma verifica con la llave pública', () => {
      const service = buildService(configuredEnv);
      const data = 'contenido-a-firmar-123';

      const firma = service.firmar(data);

      const verifier = createVerify('RSA-SHA512');
      verifier.update(data);
      verifier.end();
      expect(verifier.verify(publicKey, firma, 'base64')).toBe(true);
    });

    it('lanza BadRequest si la llave privada no está configurada', () => {
      const service = buildService({});
      expect(() => service.firmar('x')).toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 2: Ejecutar el test y confirmar que falla**

Run: `cd backend && npx jest qz-firma.service`
Expected: FAIL — no se puede resolver `./qz-firma.service`.

- [ ] **Step 3: Implementar `QzFirmaService`**

```typescript
// backend/src/modules/impresoras/qz-firma.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'crypto';

/**
 * Firma las peticiones que el frontend envía a QZ Tray, para que deje de mostrar
 * el diálogo de confianza. Llave privada + certificado autofirmado en env vars
 * (PEM base64). Si no están configuradas, getCertificado devuelve null y el
 * frontend degrada al modo no-firmado. Ver docs/features/impresion-termica.md.
 */
@Injectable()
export class QzFirmaService {
  private readonly privateKey: string | null;
  private readonly certificate: string | null;

  constructor(config: ConfigService) {
    const key = config.get<string>('QZ_PRIVATE_KEY');
    const cert = config.get<string>('QZ_CERTIFICATE');
    this.privateKey = key ? Buffer.from(key, 'base64').toString('utf8') : null;
    this.certificate = cert ? Buffer.from(cert, 'base64').toString('utf8') : null;
  }

  getCertificado(): string | null {
    return this.certificate;
  }

  firmar(data: string): string {
    if (!this.privateKey) {
      throw new BadRequestException(
        'Firmado QZ no configurado (falta QZ_PRIVATE_KEY)',
      );
    }
    const sign = createSign('RSA-SHA512');
    sign.update(data);
    sign.end();
    return sign.sign(this.privateKey, 'base64');
  }
}
```

- [ ] **Step 4: Ejecutar el test y confirmar que pasa**

Run: `cd backend && npx jest qz-firma.service`
Expected: PASS (4 tests)

- [ ] **Step 5: Crear el DTO del body de firma**

```typescript
// backend/src/modules/impresoras/dto/firmar-qz.dto.ts
import { IsString } from 'class-validator';

export class FirmarQzDto {
  @IsString()
  data: string;
}
```

- [ ] **Step 6: Registrar `QzFirmaService` como provider**

```typescript
// backend/src/modules/impresoras/impresoras.module.ts
// Agregar el import:
import { QzFirmaService } from './qz-firma.service';

// Agregar QzFirmaService al array providers (después de ImpresorasService):
  providers: [ImpresorasService, QzFirmaService],
```

- [ ] **Step 7: Agregar los endpoints al controller**

```typescript
// backend/src/modules/impresoras/impresoras.controller.ts
// Agregar imports (junto a los existentes):
import { QzFirmaService } from './qz-firma.service';
import { FirmarQzDto } from './dto/firmar-qz.dto';

// Inyectar el service en el constructor:
  constructor(
    private readonly impresorasService: ImpresorasService,
    private readonly qzFirmaService: QzFirmaService,
  ) {}

// Agregar los dos endpoints ANTES del @Patch(':id') (para que 'qz' no se
// interprete como un :id). Sin @RequiresPermiso: cert público + firma solo
// requiere estar autenticado (PermisosGuard deja pasar rutas sin decorador).
  @Get('qz/certificado')
  qzCertificado() {
    return { certificado: this.qzFirmaService.getCertificado() };
  }

  @Post('qz/firmar')
  qzFirmar(@Body() dto: FirmarQzDto) {
    return { firma: this.qzFirmaService.firmar(dto.data) };
  }
```

- [ ] **Step 8: Compilar y correr toda la suite de backend**

Run: `cd backend && npm run build && npm test`
Expected: build limpio; PASS (todos los tests, incluidos los 4 nuevos de `qz-firma`).

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/impresoras
git commit -m "$(cat <<'EOF'
feat(impresoras): agrega firmado QZ Tray (cert + firma RSA-SHA512)

QzFirmaService firma las peticiones con la llave privada del tenant-app
(env vars PEM base64) y expone GET /impresoras/qz/certificado y
POST /impresoras/qz/firmar. Sin config, el cert es null y el frontend
degrada al modo no-firmado.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Frontend — configurar la seguridad de QZ Tray en `useImpresoras`

**Files:**
- Modify: `frontend/app/composables/useImpresoras.ts`
- Modify: `frontend/app/types/qz-tray.d.ts`

**Interfaces:**
- Consumes: `GET /impresoras/qz/certificado` → `{ certificado: string | null }` y `POST /impresoras/qz/firmar` → `{ firma: string }` (Task 1).
- Produces: efecto secundario — QZ Tray firma sus peticiones; sin cambios en la firma pública de `useImpresoras`.

- [ ] **Step 1: Agregar el helper `asegurarSeguridadQz` y llamarlo en `imprimirEn`**

En `frontend/app/composables/useImpresoras.ts`, reemplazar el bloque del cargador
perezoso de qz (`let qzPromise ... function getQz()`) y toda la función `imprimirEn`
por lo siguiente. El helper es idempotente (flag `seguridadLista`): pide el
certificado una vez y, si existe, configura los promises de seguridad; si es `null`,
no configura nada y QZ opera en modo no-firmado (comportamiento actual). `apiUrl` se
pasa como parámetro (no se llama `useRuntimeConfig()` fuera de `useImpresoras()`, que
es contexto de composable — igual que hoy).

```typescript
// qz-tray es solo-navegador (usa WebSocket/window). Cargarlo de forma perezosa
// evita que se evalúe durante el SSR (habilitado por defecto) y rompa el render.
let qzPromise: Promise<(typeof import('qz-tray'))['default']> | null = null
function getQz() {
  if (!qzPromise) qzPromise = import('qz-tray').then(m => m.default)
  return qzPromise
}

// Configura el firmado de QZ Tray una sola vez: pide el certificado al backend y,
// si está configurado, setea los promises de seguridad (cert cacheado, firma por
// llamada vía POST /impresoras/qz/firmar). Si el cert es null (firmado no
// configurado), no setea nada → QZ opera en modo no-firmado (diálogo por impresión).
let seguridadLista = false
async function asegurarSeguridadQz(
  qz: (typeof import('qz-tray'))['default'],
  apiUrl: string,
): Promise<void> {
  if (seguridadLista) return
  const { certificado } = await useApiFetch<{ certificado: string | null }>(
    `${apiUrl}/impresoras/qz/certificado`,
  )
  if (!certificado) {
    seguridadLista = true
    return
  }
  qz.security.setCertificatePromise((resolve: (c: string) => void) => resolve(certificado))
  qz.security.setSignatureAlgorithm('SHA512')
  qz.security.setSignaturePromise((dataToSign: string) =>
    (resolve: (s: string) => void, reject: (e: unknown) => void) => {
      useApiFetch<{ firma: string }>(`${apiUrl}/impresoras/qz/firmar`, {
        method: 'POST',
        body: { data: dataToSign },
      })
        .then(({ firma }) => resolve(firma))
        .catch(reject)
    })
  seguridadLista = true
}

async function imprimirEn(
  impresora: Impresora,
  lineas: string[],
  apiUrl: string,
): Promise<void> {
  const qz = await getQz()
  await asegurarSeguridadQz(qz, apiUrl)
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect()
  }
  // "Red": QZ abre un socket raw a host:puerto (ESC/POS TCP 9100) y escribe los
  // bytes directamente, sin pasar por una cola del SO. Las líneas lógicas se unen
  // con '\n' (0x0A = avance de línea) para que el printer no las imprima pegadas.
  const config = impresora.tipoConexion === 'sistema'
    ? qz.configs.create(impresora.nombreCola as string)
    : qz.configs.create({ host: impresora.host as string, port: Number(impresora.puerto) })
  try {
    // ESC/POS al final del ticket: avanza 4 líneas (ESC d 4) y corta total
    // (GS V 0). Las impresoras sin cutter ignoran el comando sin efecto.
    const CORTE = '\x1B\x64\x04\x1D\x56\x00'
    await qz.print(config, [lineas.join('\n') + '\n', CORTE])
  }
  catch (err) {
    // Log del motivo real del rechazo de QZ Tray (apiErrorMsg lo resume a un
    // fallback genérico en el toast); útil para diagnosticar la impresora.
    const destino = impresora.tipoConexion === 'red'
      ? `${impresora.host}:${impresora.puerto}`
      : impresora.nombreCola
    console.error(`[qz] print falló → ${destino}`, err)
    throw err
  }
}
```

- [ ] **Step 2: Pasar `apiUrl` en los 3 call sites de `imprimirEn`**

Los tres llamados están dentro de `useImpresoras()`, donde `apiUrl` ya existe
(`const apiUrl = useRuntimeConfig().public.apiUrl`). Actualizar cada uno:

- En `imprimirComanda`: `await imprimirEn(impresora, lineas)` → `await imprimirEn(impresora, lineas, apiUrl)`
- En `imprimirPrecuenta`: `await imprimirEn(impresora, lineas)` → `await imprimirEn(impresora, lineas, apiUrl)`
- En `imprimirBoleta`: `await imprimirEn(impresora, lineas)` → `await imprimirEn(impresora, lineas, apiUrl)`

- [ ] **Step 3: Actualizar el shim de tipos de qz-tray con la API de seguridad**

En `frontend/app/types/qz-tray.d.ts`, agregar `security` a la interfaz `Qz`:

```typescript
  interface QzSecurity {
    setCertificatePromise(handler: (resolve: (cert: string) => void, reject: (err: unknown) => void) => void): void
    setSignaturePromise(factory: (dataToSign: string) => (resolve: (sig: string) => void, reject: (err: unknown) => void) => void): void
    setSignatureAlgorithm(algorithm: 'SHA1' | 'SHA256' | 'SHA512'): void
  }

  interface Qz {
    websocket: QzWebsocket
    configs: QzConfigs
    security: QzSecurity
    print(config: unknown, data: unknown[]): Promise<void>
  }
```

- [ ] **Step 4: Verificar que el frontend compila (sin errores nuevos en los archivos tocados)**

Run: `cd frontend && ./node_modules/.bin/nuxi typecheck 2>&1 | grep -E "useImpresoras|qz-tray" || echo "sin errores en los archivos tocados"`
Expected: `sin errores en los archivos tocados` (los errores pre-existentes del baseline no cuentan).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useImpresoras.ts frontend/app/types/qz-tray.d.ts
git commit -m "$(cat <<'EOF'
feat(impresoras): firma las peticiones a QZ Tray para evitar el diálogo

useImpresoras configura una sola vez los promises de seguridad de QZ
(cert del backend cacheado, firma por-llamada vía /impresoras/qz/firmar,
algoritmo SHA512). Si el backend no tiene cert configurado, degrada al
modo no-firmado sin romper la impresión.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Config, generación de llaves y documentación

**Files:**
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `backend/.env` (local, gitignored — no se commitea)
- Modify: `docs/features/impresion-termica.md`

**Interfaces:** ninguna nueva — cablea las env vars que Task 1 consume y documenta el setup.

- [ ] **Step 1: Generar el par llave/certificado de desarrollo**

```bash
cd /tmp
openssl req -x509 -newkey rsa:2048 -keyout qz-private-key.pem -out qz-cert.pem \
  -days 3650 -nodes -subj "/CN=Startup POS QZ"
echo "QZ_PRIVATE_KEY=$(base64 -i qz-private-key.pem | tr -d '\n')"
echo "QZ_CERTIFICATE=$(base64 -i qz-cert.pem | tr -d '\n')"
```

Guardar `qz-cert.pem` para el paso de confianza por dispositivo (Step 5).

- [ ] **Step 2: Agregar las env vars reales a `backend/.env`**

Pegar en `backend/.env` (gitignored) las dos líneas `QZ_PRIVATE_KEY=...` y
`QZ_CERTIFICATE=...` que imprimió el Step 1.

- [ ] **Step 3: Agregar placeholders + instrucciones a `.env.example`**

```bash
# Al final de la sección "Pasarela de pagos" / backend de .env.example, agregar:

# Firmado de QZ Tray (impresión térmica sin diálogo de confianza).
# Generar con:
#   openssl req -x509 -newkey rsa:2048 -keyout qz-private-key.pem -out qz-cert.pem \
#     -days 3650 -nodes -subj "/CN=Startup POS QZ"
#   base64 -i qz-private-key.pem   # QZ_PRIVATE_KEY
#   base64 -i qz-cert.pem          # QZ_CERTIFICATE
# Si se dejan vacías, la impresión funciona igual pero en modo no-firmado (diálogo).
QZ_PRIVATE_KEY=
QZ_CERTIFICATE=
```

- [ ] **Step 4: Pasar las env vars al backend en `docker-compose.yml`**

```yaml
# En el bloque environment: del servicio backend, después de PASARELA_ENCRYPTION_KEY:
      QZ_PRIVATE_KEY: ${QZ_PRIVATE_KEY:-}
      QZ_CERTIFICATE: ${QZ_CERTIFICATE:-}
```

- [ ] **Step 5: Confiar el certificado en QZ Tray (por dispositivo, manual)**

Copiar `qz-cert.pem` a la carpeta de QZ Tray y en `qz-tray.properties` setear
`authcert.override=<ruta>/qz-cert.pem` (o importarlo vía QZ Tray → Advanced → Site
Manager). Reiniciar QZ Tray.

- [ ] **Step 6: Documentar en el doc de la feature**

En `docs/features/impresion-termica.md`, reemplazar el párrafo de "Diálogo de
confianza" (el que dice que en v1 usa modo no-firmado) por:

```markdown
**Firmado (elimina el diálogo):** las peticiones a QZ Tray se firman en el backend
con RSA-SHA512 usando un certificado autofirmado a nivel app (env vars
`QZ_PRIVATE_KEY` + `QZ_CERTIFICATE`, PEM base64 — ver `.env.example` para el comando
`openssl`). El frontend configura los promises de seguridad de QZ una sola vez
(`GET /impresoras/qz/certificado` para el cert, `POST /impresoras/qz/firmar` por
llamada). **Setup por dispositivo (una vez):** copiar el `.crt` a QZ Tray y setear
`authcert.override` en `qz-tray.properties` (o importarlo vía Site Manager) para que
QZ confíe en el certificado. Si las env vars no están configuradas, el cert es `null`
y la impresión degrada al modo **no-firmado** (QZ pide confirmación en cada
impresión) sin romperse.
```

- [ ] **Step 7: Verificación manual end-to-end**

Con `QZ_PRIVATE_KEY`/`QZ_CERTIFICATE` en `backend/.env`, el cert confiado en QZ Tray,
y `docker-compose up`: en `/salones`, imprimir una comanda → **NO aparece el diálogo**
de QZ Tray. Vaciar temporalmente las env vars y reiniciar el backend → el diálogo
vuelve a aparecer (degradación). Confirmar ambos comportamientos.

- [ ] **Step 8: Commit**

```bash
git add .env.example docker-compose.yml docs/features/impresion-termica.md
git commit -m "$(cat <<'EOF'
chore(impresoras): cablea env vars de firmado QZ y documenta el setup

QZ_PRIVATE_KEY/QZ_CERTIFICATE en .env.example y docker-compose (backend);
doc de la feature con el comando openssl y el paso de confianza por
dispositivo. Los valores reales viven en backend/.env (gitignored).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verification

- Backend: `cd backend && npm test` (incluye `qz-firma.service` — 4 tests) y `npm run build` limpio.
- Frontend: `./node_modules/.bin/nuxi typecheck` sin errores nuevos en `useImpresoras.ts` / `qz-tray.d.ts`.
- Manual: comanda imprime **sin diálogo** con firmado configurado + cert confiado; **con diálogo** sin firmado (degradación). Ver Task 3 Step 7.

## Decisions

Ver `docs/superpowers/specs/2026-07-13-impresion-termica-firmado-design.md`: cert autofirmado + confianza por dispositivo (gratis), firmado en backend (llave privada server-side), un solo par a nivel app por env vars, degradación a no-firmado.
