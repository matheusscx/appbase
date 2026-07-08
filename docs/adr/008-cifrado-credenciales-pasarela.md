# ADR-008: Cifrado de credenciales de la pasarela de pagos (AES-256-GCM app-level)

**Status**: Accepted

**Date**: 2026-07-08

## Context

El módulo de pasarela de pagos almacena secretos de alto valor:

- Credenciales de comercio de los proveedores (Transbank api key secret,
  commerce codes) por tenant en modo INDIVIDUAL, y de la plataforma en modo
  MALL.
- El `tbkUser` de cada inscripción Oneclick: con él + el commerce code se
  puede **cobrar** a la tarjeta del usuario, así que es tan sensible como la
  tarjeta misma.
- Los tokens de proveedor por medio de pago (proveedores tipo Stripe).

La investigación previa modelaba estas credenciales como `jsonb` en texto
plano. Eso deja secretos que permiten mover dinero legibles para cualquiera
con acceso de lectura a la BD (backups, dumps, réplicas, un DBA, una fuga).

Además, las **API keys** que los tenants generan para sus apps externas son
secretos de autenticación: guardarlas recuperables permitiría suplantar al
tenant.

## Decision

**Cifrado a nivel de aplicación con AES-256-GCM**, no texto plano ni (por
ahora) un secrets manager externo.

- Clave maestra única `PASARELA_ENCRYPTION_KEY` (32 bytes en base64) provista
  por entorno (`.env` / `docker-compose`), leída una vez en el constructor de
  `CredencialesService`, que valida que mida exactamente 32 bytes.
- Formato del blob persistido: `v1:<iv b64>:<authTag b64>:<data b64>`. IV
  aleatorio de 12 bytes por registro (dos cifrados del mismo texto dan blobs
  distintos). El prefijo `v1:` deja la puerta abierta a rotación de esquema.
- GCM aporta **autenticación**: un ciphertext adulterado falla al descifrar
  (no se descifra basura silenciosamente).
- `CredencialesService` es el **único** punto del módulo que toca cifrado.
  Cifra: `pasarelas.configuracion_{ambiente}`, `tenant_pasarela.configuracion`,
  `pasarela_inscripciones.identificador_externo` (tbkUser) y
  `pasarela_medios_pago.token_externo`.

**Las API keys de tenant NO se cifran: se hashean** con SHA-256 (secreto de
alta entropía, no necesita bcrypt). La key completa se muestra una sola vez al
crearla; en BD queda solo `key_hash` + un `prefijo` visible para
identificarla. No son recuperables ni por un atacante con acceso a la BD ni
por el propio tenant.

**Redacción de logs**: `request`/`response` de cada transacción se enmascaran
(claves `tbk_user`, `Tbk-Api-Key-Secret`, `authorization`, `token`, …) antes
de persistir, para que el historial auditable no reintroduzca secretos en
claro.

## Alternatives considered

- **Texto plano (deuda conocida)**: descartado — el `tbkUser` y los api key
  secret permiten mover dinero; no es aceptable ni en un entorno de
  desarrollo compartido.
- **Secrets manager externo (Vault / KMS / Railway secrets por tenant)**: más
  robusto (rotación, auditoría, HSM), pero agrega infraestructura que el
  proyecto no tiene hoy y complica el arranque `docker-compose up`. Se puede
  migrar después: el `CredencialesService` centraliza el cifrado, así que el
  cambio queda contenido.

## Consequences

**Beneficios**

- Secretos que mueven dinero no son legibles desde la BD (backups, réplicas,
  dumps, DBA).
- Un único punto de cifrado facilita auditoría y una futura migración a un
  secrets manager.
- API keys irrecuperables incluso con acceso total a la BD.

**Trade-offs / límites**

- La seguridad depende de proteger `PASARELA_ENCRYPTION_KEY`: si se filtra la
  clave maestra **y** la BD, los secretos caen. La clave vive en el entorno,
  no en la BD, así que un dump de BD por sí solo no basta.
- **Sin rotación automática de la clave** en v1: rotarla exige re-cifrar todos
  los blobs (descifrar con la vieja, cifrar con la nueva). El prefijo `v1:`
  deja el mecanismo preparado, pero el proceso es manual por ahora.
- El default de dev en `docker-compose.yml` coincide con la clave de test:
  aceptable en local (mismo patrón que `JWT_SECRET`), **debe** sobreescribirse
  en cualquier ambiente real.
