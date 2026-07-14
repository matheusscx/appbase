# Firmado de peticiones QZ Tray (elimina el diálogo de confianza) — Design

**Status**: Approved
**Date**: 2026-07-13
**Owner**: Cesar Matheus

---

## Context

La impresión térmica vía QZ Tray (ver
`2026-07-13-impresion-termica-design.md` y `docs/features/impresion-termica.md`)
funciona en **modo no-firmado**: QZ Tray muestra un diálogo *"¿Confías en este
sitio?"* en **cada** impresión. Esto ya se documentó como mejora futura.

Este diseño elimina el diálogo firmando cada petición con un certificado. QZ Tray
solo confía automáticamente en certificados emitidos por la CA de pago de QZ
Industries; un certificado **autofirmado** (gratis) también elimina el diálogo pero
requiere marcarlo como confiable **una vez por dispositivo**. Elegimos el camino
autofirmado (kioscos en LAN controlados por el operador).

## Decisiones tomadas

1. **Certificado autofirmado** + confiar una vez por dispositivo (gratis). No se usa
   el certificado de pago de QZ.
2. **Firmado en el backend**: la llave privada nunca sale del servidor (patrón de
   `CredencialesService`). El frontend pide la firma por HTTP en cada petición.
3. **Un solo par llave/certificado a nivel app** (no por-tenant): QZ Tray confía
   por-dispositivo, el tenant es irrelevante para la confianza.
4. **Llave/cert en env vars** (PEM base64), patrón idéntico a
   `PASARELA_ENCRYPTION_KEY`. Generación con un comando `openssl` documentado.
5. **Degradación elegante**: si las env vars no están configuradas, el sistema sigue
   en modo no-firmado (diálogos) sin romper la impresión.

## Non-goals (YAGNI)

- Rotación de llaves.
- Certificado por-tenant.
- UI para gestionar el certificado.
- Usar el certificado de pago de QZ Industries.

---

## Architecture

### Backend

**Env vars** (leídas por `ConfigService`):

| Var | Contenido |
|---|---|
| `QZ_PRIVATE_KEY` | Llave privada RSA 2048, PEM, en base64 |
| `QZ_CERTIFICATE` | Certificado autofirmado, PEM, en base64 |

**`QzFirmaService`** (nuevo, en `src/modules/impresoras/`, propósito único):

- `getCertificado(): string | null` — devuelve el PEM del certificado decodificado,
  o `null` si `QZ_CERTIFICATE` no está configurada.
- `firmar(data: string): string` — `crypto.createSign('RSA-SHA512')` sobre `data` con
  `QZ_PRIVATE_KEY`, devuelve la firma en base64. Lanza `BadRequestException`/error
  claro si la llave no está configurada.

A diferencia de `CredencialesService` (que lanza en el constructor si falta la env),
`QzFirmaService` **no lanza en construcción**: la ausencia de config es un estado
válido (degradación a no-firmado). Solo `firmar` lanza si se lo invoca sin llave.

**Endpoints** en `ImpresorasController` (`@UseGuards(JwtAuthGuard, TenantGuard)` — el
certificado es información pública; la firma solo requiere autenticación, sin permiso
RBAC específico porque cualquier operador que imprime la necesita):

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| GET | `/impresoras/qz/certificado` | — | `{ certificado: string \| null }` |
| POST | `/impresoras/qz/firmar` | `{ data: string }` | `{ firma: string }` |

> Nota de rutas: `qz/certificado` y `qz/firmar` deben declararse en el controller
> **antes** que cualquier ruta `:id` para que Nest no interprete `qz` como un id.
> (El controller actual solo tiene `:id` en PATCH/DELETE, así que basta con ubicarlas
> junto a los GET/POST de colección.)

### Frontend

En `useImpresoras.ts`, un helper **idempotente** `asegurarSeguridadQz(qz)` que corre
una sola vez (flag de módulo `seguridadLista`), invocado al inicio de `imprimirEn`
**antes** de `qz.websocket.connect()`:

```ts
let seguridadLista = false
async function asegurarSeguridadQz(qz): Promise<void> {
  if (seguridadLista) return
  const apiUrl = useRuntimeConfig().public.apiUrl
  const { certificado } = await useApiFetch<{ certificado: string | null }>(
    `${apiUrl}/impresoras/qz/certificado`,
  )
  if (!certificado) { seguridadLista = true; return } // no configurado → no-firmado

  qz.security.setCertificatePromise((resolve: (c: string) => void) => resolve(certificado))
  qz.security.setSignatureAlgorithm('SHA512')
  qz.security.setSignaturePromise((dataToSign: string) =>
    (resolve: (s: string) => void, reject: (e: unknown) => void) => {
      useApiFetch<{ firma: string }>(`${apiUrl}/impresoras/qz/firmar`, {
        method: 'POST', body: { data: dataToSign },
      }).then(({ firma }) => resolve(firma)).catch(reject)
    })
  seguridadLista = true
}
```

- El certificado se pide **una sola vez** (no cambia); la firma es **por-llamada**
  (cada `connect`/`print` dispara `setSignaturePromise`).
- **Degradación**: `certificado === null` → no se setean los promises → QZ Tray opera
  en modo no-firmado (diálogos). Cero regresión.

### Data flow (impresión firmada)

1. `imprimirEn` → `asegurarSeguridadQz` (cert cacheado tras la 1ª vez).
2. `qz.websocket.connect()` → QZ valida que el cert está confiado en el dispositivo →
   sin diálogo.
3. `qz.print(...)` → QZ pide firma del hash → composable firma vía
   `POST /impresoras/qz/firmar` → QZ verifica con la llave pública del cert → imprime
   en silencio.

### Setup por dispositivo (manual, una vez)

Copiar `qz-cert.pem` a la carpeta de QZ Tray y en `qz-tray.properties` setear
`authcert.override=<ruta>/qz-cert.pem` (o importar vía QZ Tray → Advanced → Site
Manager). Reiniciar QZ Tray.

---

## Generación de llaves (una vez)

```bash
openssl req -x509 -newkey rsa:2048 -keyout qz-private-key.pem -out qz-cert.pem \
  -days 3650 -nodes -subj "/CN=Startup POS QZ"
base64 -i qz-private-key.pem   # → QZ_PRIVATE_KEY
base64 -i qz-cert.pem          # → QZ_CERTIFICATE
```

`.env.example` gana ambas vars con el comando en comentario; `docker-compose.yml` las
pasa al servicio `backend`; `backend/.env` real (gitignored) con los valores.

---

## Error handling

- **Env vars ausentes** → `getCertificado()` devuelve `null`, el frontend degrada a
  no-firmado. `firmar()` lanza si se lo invoca sin llave (no debería ocurrir: si el
  cert es `null` el frontend nunca llama a firmar).
- **Fallo de firma en pleno print** → `setSignaturePromise` hace `reject` → `qz.print`
  rechaza → el `catch` existente en `imprimirEn` loguea y el toast informa el error.
- **Cert no confiado en el dispositivo** → QZ Tray vuelve a mostrar el diálogo (no es
  un error de la app; es el paso de setup por dispositivo pendiente).

---

## Testing

- **Backend (unit, Jest)**: `QzFirmaService`
  - Genera un par llave/cert de prueba en `beforeAll` (`crypto.generateKeyPairSync`
    con un cert autofirmado, o una llave RSA y su SPKI pública para verificar).
  - `firmar(data)` produce una firma que `crypto.verify('RSA-SHA512', ...)` valida con
    la llave pública.
  - `getCertificado()` devuelve el cert configurado; devuelve `null` sin env.
  - Endpoints: cubiertos indirectamente (thin controllers); opcionalmente un test del
    controller que mockea el service.
- **Frontend**: sin test nuevo (integración con QZ Tray real → verificación manual,
  igual que el resto de la impresión). `ticket-builder.spec.ts` no se toca.
- **Manual**: con el cert confiado en el dispositivo y las env configuradas, imprimir
  una comanda → **no aparece diálogo**. Sin env configuradas → sigue apareciendo
  (degradación).

---

## Componentes y límites

| Componente | Propósito único | Depende de |
|---|---|---|
| `QzFirmaService` (back) | Proveer cert PEM + firmar data (RSA-SHA512) | `ConfigService` |
| Endpoints `qz/certificado`, `qz/firmar` | Exponer cert + firma vía HTTP autenticado | `QzFirmaService` |
| `asegurarSeguridadQz` (front) | Configurar los promises de seguridad de QZ una vez | endpoints, `qz-tray` |

---

## Related

- `docs/superpowers/specs/2026-07-13-impresion-termica-design.md`
- `docs/features/impresion-termica.md`
- Patrón de secreto/crypto: `backend/src/modules/pasarela/services/credenciales.service.ts`
