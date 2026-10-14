# La cola de envío de la boleta al SII

**Fecha:** 2026-10-14 · **Tipo:** spec de diseño · **Fiscal: frente propio** (`CLAUDE.md`, ADR-010)
**Subproyecto 3 de 6** del emisor de DTE propio. **Status:** Draft, a revisión del owner.
**Depende de:** el motor (subproyecto 2) y el perfil fiscal (subproyecto 1), los dos en `main`. Lo que exponen está en [`features/emision-electronica.md`](../../features/emision-electronica.md).
**Fuente técnica:** la API REST de boleta del SII, OpenAPI 1.0.5 (`https://www4c.sii.cl/bolcoreinternetui/api/openapi.yaml`, bajada el 2026-10-14), y el [instructivo de boleta](https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf) (28/10/2021).

---

## 0. Cómo se decidió

El owner aprobó el 2026-10-14, en la sesión de brainstorming, las dos partes del diseño (datos y flujo; fallas y pruebas). También eligió estos dos puntos por AskUserQuestion, con el costo de cada opción:

| Decisión | Elegida | Descartada, y por qué |
|---|---|---|
| Quién se entera de un rechazo | **Queda registrado; la pantalla y el aviso llegan con el subproyecto 4** | Una lista en la pantalla desde ya: hoy estaría siempre vacía, porque nadie emite |
| Boleta con más de 1 hora sin llegar | **Se sigue reintentando sin tope y queda "atrasada"** | Frenar las ventas: un SII caído dejaría al local sin vender |

## 1. Qué es y qué no es

**Es:**
- la cola que lleva al SII cada boleta que el subproyecto 4 emita, sin que la venta espere al SII;
- el cliente de la API de boleta: semilla, token, envío y consulta del envío;
- el estado de cada boleta (Res. 121/2026: aceptada, con reparos o rechazada) con el motivo que da el SII.

**No es:**
- quién llama a `encolar`: lo hace la venta, en el subproyecto 4;
- reemitir una boleta rechazada, avisar al dueño o mostrar una pantalla: también subproyecto 4;
- la consulta de una boleta individual (`/boleta.electronica/{rut}-{dv}-{tipo}-{folio}/estado`);
- el envío al cliente por correo o QR;
- la certificación ante el SII (subproyecto 5).

**Plazo legal:** la boleta se envía "inmediato, máximo 1 hora". Sin conexión se genera igual, y la hora corre desde que vuelve (Res. 74, F.6).

## 2. Lo que dice la API del SII (medido en el OpenAPI 1.0.5)

| Recurso | Servidor certificación | Servidor producción |
|---|---|---|
| `GET /boleta.electronica.semilla` | `apicert.sii.cl/recursos/v1` | `api.sii.cl/recursos/v1` |
| `POST /boleta.electronica.token` | ídem | ídem |
| `POST /boleta.electronica.envio` | `pangal.sii.cl/recursos/v1` | `rahue.sii.cl/recursos/v1` |
| `GET /boleta.electronica.envio/{rut}-{dv}-{trackid}` | `apicert.sii.cl/recursos/v1` | `api.sii.cl/recursos/v1` |

- **Semilla:** dura 2 minutos.
- **Token:**
  - Se arma `<getToken><item><Semilla>…</Semilla></item></getToken>` en dos líneas, con la declaración UTF-8 y sin salto final.
  - Se firma con XMLDSig enveloped: `Reference URI=""`, C14N inclusivo, RSA-SHA1, SHA1 y `RSAKeyValue`. La `Signature` va dentro de `getToken`, justo después de `item`.
  - El SII publica un oráculo: para la semilla `030530912644`, el `DigestValue` es `l2s9BqLppHaWo+w1Al1J5SsYScs=`.
  - El token dura 1 hora, se renueva con cada uso, y el SII pide reusarlo.
  - Viaja como `Cookie: TOKEN=<token>`.
- **Envío:**
  - Es `multipart/form-data` con `rutSender`, `dvSender` (el firmante), `rutCompany`, `dvCompany` (el emisor) y `archivo`, más un header `User-Agent` obligatorio.
  - Admite hasta 500 boletas, y el SII **recomienda 50**.
  - Un 200 trae `trackid` (hasta 15 dígitos) y `estado: REC`, más los headers `X-Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` y `X-RateLimit-Reset`.
  - Los errores son: 400 (datos mal), 401 (token), 405 (límite excedido) y 500.
  - El límite de pedidos es **por IP y por hora**. Todos los tenants salen por la misma IP de Railway.
- **Consulta del envío:**
  - El SII recomienda esperar **10 minutos** después de enviar, y respetar `X-Retry-After`.
  - `estado` puede ser `REC`, `SOK`, `FOK`, `CRT`, `PRD` (en proceso), `EPR` (procesado), `RPR` (con reparos), `RCH`, `RCO`, `RFR`, `RSC`, `RCT`, `VOF` (rechazos del sobre) o `RPT` (envío repetido).
  - `detalle_rep_rech` lista las boletas con reparos (`RPR`) o rechazadas (`RCH`), cada una con sus errores (`seccion`, `linea`, `nivel`, `codigo`, `descripcion`, `detalle`).
  - El `folio` y el `tipo` vienen en null cuando el error es de esquema o de firma.

## 3. Datos

Dos tablas nuevas, con migración generada y leída (ADR-030):

**`dte_documentos`**: una fila por boleta emitida.
- `documento_id`, `tenant_id`, `razon_social_id`, `caf_id`, `tipo` (39/41), `folio`, `ambiente`, `rut_emisor`.
- `xml`: el `<DTE>` firmado tal como lo devolvió `emitirBoleta`, como texto. Es el documento legal; no se cifra porque no trae secretos (el `RSASK` del CAF no viaja en el DTE).
- `estado`: `pendiente`, `enviado`, `aceptado`, `reparos` o `rechazado`, con CHECK.
- `envio_id` (null hasta que entra a un sobre), `detalle_sii` (jsonb con los errores que devolvió el SII para esa boleta, o el motivo del rechazo del sobre).
- `emitido_el`: la hora de emisión, que fija el plazo de 1 hora.
- `proximo_intento_el`: cuándo puede volver a salir una boleta pendiente.
- Índice único `(razon_social_id, tipo, ambiente, folio) WHERE eliminado_el IS NULL`: un folio no se encola dos veces.
- Un índice parcial para la cola: `(razon_social_id, emitido_el) WHERE estado = 'pendiente' AND eliminado_el IS NULL`.

**Atrasada** no es una columna. Es `estado IN ('pendiente','enviado') AND emitido_el < now() - 1 hora`, y se calcula al leer.

**`dte_envios`**: un sobre mandado al SII.
- `envio_id`, `tenant_id`, `razon_social_id`, `ambiente`, `trackid` (bigint, null hasta el 200), `estado_sii` (el código del SII, texto), `enviado_el`.
- `consultar_desde`: cuándo puede consultarse, que es `enviado_el + max(10 min, X-Retry-After)`.
- `intentos_consulta`, `ultimo_error` y `respuesta_sii` (jsonb, la última respuesta de la consulta).
- `reservado_hasta`: la reserva mientras el sobre está en vuelo (§ 4).

Ninguna fila se borra: las dos tablas llevan `eliminado_el` por la convención, pero nada lo escribe.

## 4. Flujo

**`ColaDteService.encolar(tenantId, boleta: BoletaEmitida, cafId): Promise<{ documentoId }>`** es lo único que expone para el subproyecto 4.
- Exige una transacción activa (`TxContext.managerActivo()`), igual que `tomarFolio`: si la venta hace rollback, la boleta no queda en la cola.
- Lee del CAF la razón social y el ambiente, e inserta la fila `pendiente` con `emitido_el = now()` y `proximo_intento_el = now()`.

**Job de envío** (módulo `cron`, mismo patrón que `expirar-ordenes.job.ts`, cada 30 segundos):

1. **Elige qué sale.** Por razón social con boletas pendientes y `proximo_intento_el <= now()`, empezando por la de la pendiente más antigua, arma un lote cuando:
   - hay **50 o más**; o
   - la más antigua lleva **5 minutos** esperando.

   Así un local con poco movimiento no hace un envío por boleta. El límite del SII es por IP y lo comparten todos los tenants. Con 5 minutos de espera, la boleta llega muy dentro de la hora.
2. **Reserva**, en una transacción corta:
   - `SELECT … FOR UPDATE SKIP LOCKED LIMIT 50` sobre las pendientes de esa razón social;
   - crea el `dte_envios` con `reservado_hasta = now() + 5 min`;
   - pasa las boletas a `enviado` con su `envio_id`;
   - hace commit.

   Dos instancias del backend nunca toman la misma boleta.
3. **Envía**, fuera de la transacción:
   - descifra el certificado vigente;
   - arma el sobre con `armarEnvioBoleta` (carátula de `credencialesParaFirmar`);
   - obtiene el token (§ 5) y hace el POST.

   La llamada HTTP no tiene una conexión de la base tomada.
4. **Anota el resultado** (§ 6).

**Job de consulta** (cada minuto):
- Toma los envíos con `trackid`, un `estado_sii` que no sea final y `consultar_desde <= now()`, también con `SKIP LOCKED`.
- Consulta y reparte el resultado entre sus boletas.
- Si el SII sigue procesando, la próxima consulta es en 5 minutos, o en lo que diga `X-Retry-After` si es más.

**Respeto del límite del SII:** si una respuesta trae `X-RateLimit-Remaining: 0` o un 405, los dos jobs se pausan hasta `X-RateLimit-Reset`. La pausa es en memoria y por proceso: con más de una instancia, cada una aprende la pausa al chocar.

## 5. El token

- Se cachea **en memoria, por certificado** (`certificado_id`), con la hora del último uso.
- Se considera vencido a los **50 minutos** sin uso, con margen sobre la hora del SII.
- Con un 401, se descarta, se pide otro y se reintenta **una vez**.
- Firmar el `getToken` es una función nueva del motor, `firmarDocumento(xml, certificado)`: enveloped, `URI=""`, con la `Signature` como último hijo de la raíz y sin reserializar. Va al lado de `firmarNodo` en `firma.ts`.
- El oráculo del SII (la semilla `030530912644` da el digest `l2s9BqLppHaWo+w1Al1J5SsYScs=`) es su prueba.

## 6. Qué pasa con cada respuesta

**Al enviar:**

| Respuesta | Qué hace |
|---|---|
| 200 con `trackid` | El envío queda con `trackid`, `estado_sii = 'REC'` y `consultar_desde`; las boletas siguen `enviado` |
| Red caída, timeout, 500 o 405 | Las boletas vuelven a `pendiente` con `envio_id` null y `proximo_intento_el` creciente según sus intentos: 30 s, 1, 2 y 5 min, y de ahí cada 10 min, **sin tope**. El envío queda con `ultimo_error` |
| 401 | Token nuevo y un reintento; si vuelve a dar 401, como red caída |
| 400 | El sobre está mal armado y es un error nuestro: las boletas pasan a `rechazado` con `detalle_sii = { origen: 'envio', mensaje }`. No se reintenta solo, porque repetiría el error |
| El proceso se cae a mitad | La reserva vence (`reservado_hasta`) y el siguiente tick devuelve las boletas a `pendiente` |

**Al consultar:**

| `estado` del SII | Qué hace |
|---|---|
| `EPR` | Cada boleta según `detalle_rep_rech`: `RCH` → `rechazado`, `RPR` → `reparos`, ausente → `aceptado` |
| `RPR` en el envío | Igual que `EPR` |
| `RCH`, `RCO`, `RFR`, `RSC`, `RCT`, `VOF` | Todas las boletas del sobre → `rechazado`, con el código y la descripción del sobre |
| `RPT` | Se anota en el envío y no se reenvía: el SII ya tenía ese sobre (ver § 8) |
| `REC`, `SOK`, `FOK`, `CRT`, `PRD` | Se vuelve a consultar más tarde |
| 404 | Se vuelve a consultar; si sigue a las 24 h de `enviado_el`, el envío queda con `ultimo_error` para revisión y sus boletas siguen `enviado` (atrasadas a la vista) |
| Red, 500, 405, 401 | Como al enviar: se reintenta sin tocar el estado |

Un error con `folio` null en `detalle_rep_rech` (error de esquema o de firma) se aplica a todas las boletas del sobre.

## 7. Pruebas

Sin RUT piloto no se le pega al SII de verdad. Las pruebas usan:

- **Un SII falso** levantado en el propio test (un `http.createServer` de Node, sin dependencias nuevas), con las rutas, los headers y las respuestas del OpenAPI 1.0.5. El cliente toma sus URLs base de configuración (`SII_BOLETA_URL_*`, con los servidores del SII por defecto), y el test las apunta al falso.
- **El oráculo del token:** la firma del `getToken` de la semilla `030530912644` da exactamente el `DigestValue` del SII.
- **Unitarios del reparto del resultado:** cada fila de las tablas de § 6, con fixtures que no usen el 1 ni cantidades iguales.
- **e2e con base real:**
  - encolar sin transacción tira;
  - encolar y hacer rollback no deja nada;
  - dos ticks de envío a la vez no mandan la misma boleta (`SKIP LOCKED`, de forma determinística con `pg_blocking_pids`);
  - la reserva vencida vuelve las boletas a `pendiente`;
  - el lote sale a las 50 o a los 5 minutos, y no antes;
  - un 405 pausa hasta el reset;
  - una boleta con más de 1 hora sin aceptar se lee atrasada;
  - de punta a punta contra el SII falso: encolar → enviar → consultar → `aceptado`, `reparos` y `rechazado` en el mismo sobre.
- **El sobre valida contra el esquema vigente** (§ 8, primer punto).

## 8. Lo que queda abierto

- **El esquema de envío cambió.**
  - El OpenAPI apunta a `schema_envio_bol_720.zip` (bajado el 2026-10-14). Trae una revisión de `EnvioBOLETA_v11.xsd` distinta de la que usa el motor:
    - `DTE` con `maxOccurs="500"`;
    - `Detalle` opcional;
    - `TpoDocRef` y `FolioRef` en `Referencia`;
    - `TpoTicket` en vez de `TpoTiket`.
  - Tampoco trae `MedioPago`, `CorreoRecep`, `TelefonoRecep` ni `RutProvSW`, que el motor valida con su copia `EnvioBOLETA_v11_formato42.xsd`.
  - **Regla de la spec del motor:** si el SII publica un XSD nuevo, se usa ese. La primera tarea del plan reemplaza el v11 por el del zip 720, le vuelve a sumar los campos del formato 4.2 (cada uno citando su fila) y corre las pruebas del motor contra él.
- **`RPT` tras una caída.** Si el proceso se cae después de que el SII recibió el sobre y antes de guardar el `trackid`, la reserva vence y las boletas se reenvían. El SII contesta `RPT` y el `trackid` del primer envío se pierde: esas boletas quedan `enviado` sin resultado. Lo resuelve la consulta por boleta individual, que queda fuera de este subproyecto.
- **El token en memoria** se pierde en cada deploy: el primer envío después pide uno nuevo. Es un costo de dos pedidos, no un riesgo.
- **El límite por IP** lo comparten todos los tenants. El lote de 50 o 5 minutos lo achica, pero con muchos tenants activos puede no alcanzar. Se mide en producción (subproyecto 5).
- **Lo que solo confirma la certificación:** el `User-Agent` exacto que acepta el SII, el formato real del 400 y del 405, y si `pangal`/`rahue` siguen siendo los servidores de envío (el OpenAPI los llama "temporales").

## 9. Documentación al implementar

- `docs/features/emision-electronica.md`: una sección "Envío al SII" con la cola, los estados y lo que queda abierto.
- `docs/ESTADO.md` y `docs/agent/desarrollo-nuevo.md`: el subproyecto 3, hecho.
- `docs/ARCHITECTURE.md`: los dos jobs del módulo `dte`.
- `.env.example`: las `SII_BOLETA_URL_*` comentadas, con los servidores del SII por defecto.
