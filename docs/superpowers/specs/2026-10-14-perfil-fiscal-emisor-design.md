# El perfil fiscal del emisor: datos, certificado, CAF y folios

**Fecha:** 2026-10-14 · **Tipo:** spec de diseño · **Fiscal: frente propio** (`CLAUDE.md`, ADR-010)
**Subproyecto 1 de 6** del emisor de DTE propio. **Status:** Draft, a revisión del owner.
**Antecede:** el motor de la boleta (subproyecto 2), hecho y desplegado en `fd2670bd`:
[`features/emision-electronica.md`](../../features/emision-electronica.md), ADR-033.

---

## 0. Cómo se decidió

El owner eligió cada punto el 2026-10-14. Las cuatro primeras filas las decidió por AskUserQuestion, con el costo de cada opción. Las demás las aprobó en el chat como secciones de diseño.

| Decisión | Elegida | Descartada, y por qué |
|---|---|---|
| RUT emisores por tenant | **Uno solo** | Varios, con elección por caja: más pantallas, y el cajero puede equivocarse de sociedad |
| Quién carga certificado y CAF | **El admin del tenant**, en una pantalla | Nosotros en el onboarding: la clave del certificado pasaría por una persona nuestra, y eso la consulta legal sobre custodia no lo tiene cubierto |
| Avisos | **Pantalla + aviso al cajero** (menos de 100 folios, o certificado que vence en menos de 30 días) | Solo pantalla: el local se entera en pleno servicio. Más correo: suma un cron sin necesidad todavía |
| Qué se guarda del certificado | **Solo la llave y el certificado, cifrados**; el `.pfx` y su clave se descartan | Guardar el `.pfx` y la clave: guardaríamos una clave del dueño que no hace falta para firmar |
| Dónde viven los datos | **Sobre `razones_sociales` + dos tablas nuevas** | Tabla `perfil_fiscal` aparte: dos fuentes del RUT emisor. Columnas en `tenants`: el CAF es de un RUT, no del tenant |
| Cuál razón social emite | **La preferida y habilitada**, la misma que ya imprime el ticket | Un flag nuevo: ticket y boleta podrían mostrar RUT distintos |
| Aviso al cajero | **Con el subproyecto 4.** Este deja la pantalla y el dato que el aviso va a leer | Ahora: avisaría de folios que todavía nada consume |

## 1. Qué es y qué no es

**Es:**
- lo que el motor necesita y hoy no tiene en ningún lado: los datos completos del emisor, su certificado, sus CAF y quién lleva la cuenta de los folios;
- la pantalla para que el admin cargue todo eso.

**No entra:**
- Enviar al SII → subproyecto 3.
- Usar el folio en una venta, y el aviso en el POS → subproyecto 4.
- Verificar la firma del SII sobre el CAF (`FRMA`). Hace falta la llave pública del SII y una investigación aparte. Un CAF adulterado lo rechaza el SII al recibir el envío.
- Dirección y código SII por local (`CdgSIISucur`). Los locales (`ubicaciones`) no tienen dirección: la boleta sale con la de la razón social.
- Más de un RUT emisor por tenant.
- Anular ante el SII los folios que no se usan.
- Factura (33) y nota de crédito (61): este subproyecto acepta CAF de tipo 39 y 41 nada más.

## 2. El modelo

### 2.1 `razones_sociales` suma columnas

Todas nulas: una razón social sin emisión electrónica las deja vacías.

| Columna | Para qué | Límite |
|---|---|---|
| `giro` | `GiroEmisor` | 80, ISO-8859-1 |
| `comuna` | `CmnaOrigen` | 20, ISO-8859-1 |
| `ambiente_sii` | `'certificacion'` o `'produccion'`. Decide qué CAF sirven | CHECK |
| `fecha_resolucion` | `FchResol` de la carátula | `date` |
| `numero_resolucion` | `NroResol` de la carátula. En certificación es 0 | entero ≥ 0 |

**Lo que ya existe y el motor también exige:**
- `nombre` va a `RznSocEmisor`, con un máximo de 100;
- `direccion` va a `DirOrigen`, con un máximo de 70 en el XSD, aunque la columna admite 255.

Esos límites se validan **cuando se pide el estado del perfil** y aparecen como "falta" o "es demasiado largo". No se cambia el CRUD de razones sociales: una razón social que no emite sigue aceptando 255.

**Cuál emite:** la que es `preferida` y está `habilitado`. Sin una que cumpla las dos, no hay emisor y el perfil lo dice. La regla del frontend (`elegirEmisor`) tiene además un fallback a "la primera habilitada" para el ticket. **La emisión no lo usa:** el RUT con que se emite tiene que estar elegido, no deducido por orden alfabético.

**Protección:** una razón social con un certificado o un CAF vigente **no puede cambiar su RUT ni borrarse**: el CRUD responde 400. Si cambiara el RUT, los CAF quedarían de otro RUT, y la próxima boleta saldría con folios ajenos.

### 2.2 `dte_certificados`

Una fila por certificado subido. **Vigente hay uno por razón social**, con un índice único parcial.

| Columna | Qué es |
|---|---|
| `tenant_id`, `razon_social_id` | Dueño |
| `credencial_cifrada` | JSON `{llavePrivadaPem, certificadoB64}` cifrado. Nulo cuando se reemplazó |
| `rut_firmante`, `nombre_firmante` | Del sujeto del certificado, en claro, para mostrar. El RUT va a `RutEnvia` |
| `vence_el` | `notAfter` del certificado, en claro, para el aviso |
| `reemplazado_el` | Cuándo dejó de ser el vigente |

**Reemplazar** marca el anterior con `reemplazado_el` y le **pone en null `credencial_cifrada`**. Es un UPDATE, no un DELETE. No guardamos la llave de un certificado que ya no se usa. La fila queda como registro de quién firmó y hasta cuándo.

### 2.3 `dte_cafs`

Una fila por CAF subido.

| Columna | Qué es |
|---|---|
| `tenant_id`, `razon_social_id` | Dueño |
| `tipo` | 39 o 41 (CHECK) |
| `rut_emisor` | Leído del CAF al subirlo |
| `ambiente` | El de la razón social al subirlo. No se lee del CAF (§ 3) |
| `desde`, `hasta` | El rango (`RNG`) |
| `siguiente_folio` | El próximo a entregar. Nace en `desde`. El CAF está agotado cuando `siguiente_folio > hasta` (CHECK: `desde ≤ siguiente_folio ≤ hasta + 1`) |
| `fecha_autorizacion` | `FA` del CAF, para mostrar |
| `xml_cifrado` | El `<AUTORIZACION>` completo, cifrado: trae la llave privada del rango (`RSASK`) |

Los folios usados se derivan: `siguiente_folio − desde`. No hay una tabla de folios: el folio de cada documento lo guarda el documento (subproyecto 4).

### 2.4 El cifrado

- **Clave propia, `DTE_ENCRYPTION_KEY`** (32 bytes en base64), separada de `PASARELA_ENCRYPTION_KEY`. Si se filtra una, la otra no cae, y cada una se rota por separado.
- **Mismo formato** que ADR-008: `v1:<iv>:<tag>:<data>`, AES-256-GCM.
- El servicio de cifrado del módulo `dte` es el único punto que cifra y descifra estos blobs. Copia las dos funciones de `CredencialesService`: el repo acepta el duplicado hasta la tercera vez.
- **Sin la variable, el backend no arranca**, igual que con la de la pasarela. Por eso **hay que cargarla en Railway antes del push** que la exige, o el deploy cae. Va en `.env.example` con un valor de desarrollo.

## 3. Lo que se valida al subir

**Certificado:** `POST /dte/certificado` recibe `{pfxBase64, clave}`.
- Se abre con `leerCertificado` del motor.
- **Clave incorrecta**, archivo que no es `.pfx`, o certificado **vencido** según la hora del servidor → 400.
- La clave y el `.pfx` **no se guardan ni se loguean**. El body de esta ruta queda fuera de cualquier log de request.
- El RUT del firmante **no** se compara con el del emisor: es una persona (el representante), no la empresa. Que esté autorizado ante el SII no se puede verificar desde acá.

**CAF:** `POST /dte/cafs` recibe `{ xmlBase64 }`: el archivo del SII es ISO-8859-1 y el `TextDecoder('iso-8859-1')` del navegador en realidad decodifica windows-1252 (los bytes 0x80–0x9F cambian), así que `leerCaf` lo rechazaría; el navegador manda los bytes en base64 y el backend los decodifica con `Buffer.from(b64, 'base64').toString('latin1')`. Se lee con `leerCaf` del motor, que ya comprueba que la llave privada sea par de la pública. Además:
- tipo 39 o 41;
- RUT del CAF = RUT de la razón social emisora, normalizado;
- el CAF toma como ambiente el `ambiente_sii` de la razón social al subirlo; no se deduce del `IDK` (§ 8);
- el rango no se pisa con otro CAF del mismo RUT y tipo que no esté borrado. Esto rechaza también subir dos veces el mismo archivo.

`leerCaf` devuelve además `idk` y `fechaAutorizacion` (`FA`), y `leerCertificado` devuelve `nombre` y `venceEl`; el plan los agregó al motor, con su prueba.

**Borrar un CAF:** `DELETE /dte/cafs/:id` hace un soft delete **solo si no se tomó ningún folio** (`siguiente_folio = desde`). Sirve para arreglar un CAF subido por error. Uno usado no se borra: sus folios ya están en documentos.

Todo rechazo es un 400 con un mensaje para el dueño del local. Por ejemplo:
- "Este archivo de folios es de otro RUT (76.xxx.xxx-x)";
- "Esos folios ya están cargados".

## 4. Tomar un folio

Es el corazón de este subproyecto, aunque lo llame el 4. Es un método del service, sin ruta, que corre **dentro de la transacción de quien lo pide** (recibe su `EntityManager`):

```
tomarFolio(manager, tenantId, tipo) → { cafId, folio }
```

1. Busca la razón social emisora del tenant (§ 2.1).
2. Toma, **con `FOR UPDATE`**, el CAF de esa razón social, del tipo y del ambiente de la razón social, sin borrar, con `siguiente_folio ≤ hasta`, de **menor `desde`**.
3. Le suma 1 a `siguiente_folio` y devuelve el valor anterior.
4. Si no hay CAF con folios, sale un error con código (`SIN_FOLIOS`) que el subproyecto 4 traduce para el cajero.

**Por qué así:**
- **Dos cajas a la vez:** la segunda espera el bloqueo de la fila, unos milisegundos, y sale con el folio siguiente. Nunca repite.
- **Si la venta se cae:** el rollback deshace la suma y el folio vuelve. Una secuencia de Postgres no vuelve, y cada hueco es un folio que hay que anular en el SII.
- **CAF agotado:** el paso 2 ya no lo ve y toma el siguiente rango. Si el siguiente está en un rango posterior, no hay hueco: el folio que se saltea es uno que no se pidió.

**Orden de bloqueo:** el subproyecto 4 decide en qué punto de su transacción pide el folio, respetando el orden de bloqueo de filas del proyecto (`docs/patterns/backend.md`, § del orden de bloqueo). Este subproyecto bloquea **una sola fila**, la del CAF, y nada más.

**Las credenciales para firmar** salen de un segundo método, también sin ruta:

```
credencialesParaFirmar(tenantId, cafId, ahora) → { caf, certificado, emisor, caratula }
```

- Descifra el CAF y el certificado vigente.
- Arma `EmisorBoleta` y los datos de resolución de la carátula, con los tipos del motor.
- Falla con código si el certificado venció (`CERTIFICADO_VENCIDO`) o si no hay certificado (`SIN_CERTIFICADO`).
- **No se expone por HTTP:** el JSON descifrado nunca sale del proceso.

## 5. El estado del perfil

`GET /dte/perfil` devuelve todo lo que la pantalla muestra y lo que el aviso del subproyecto 4 va a leer. **Nunca devuelve un blob cifrado ni descifrado.**

- **Emisor:** razón social preferida con nombre, RUT, dirección, giro, comuna, ambiente y resolución. Si no hay una preferida y habilitada, viene `null`.
- **Certificado vigente:** firmante, RUT y `vence_el`.
- **CAF:** tipo, rango, usados, restantes, fecha de autorización y ambiente, más los agotados.
- **Lo que falta para emitir** (`faltantes`), una lista de códigos con su texto. Por ejemplo:
  - sin razón social preferida;
  - giro, comuna o resolución vacíos;
  - nombre o dirección más largos que lo que admite el SII;
  - texto fuera de ISO-8859-1;
  - sin certificado, o con el certificado vencido;
  - sin CAF de tipo 39.
- **Los avisos** (`avisos`):
  - menos de **100** folios restantes de un tipo, sumando todos sus CAF del ambiente vigente;
  - certificado que vence en menos de **30** días.

Los umbrales son constantes del módulo. Que sean configurables se decide cuando alguien lo pida.

`PATCH /dte/perfil` edita giro, comuna, ambiente y resolución **de la razón social emisora**. Nombre, RUT y dirección se siguen editando en Razones sociales, y la pantalla lleva un link.

**Cambiar de ambiente** con CAF cargados no los borra: dejan de servir (§ 4, paso 2) y la pantalla los muestra como "de otro ambiente". Es el paso normal al terminar la certificación: se cambia a producción y se suben CAF de producción.

Todas las rutas llevan `TenantAdminGuard`, como el resto de la configuración, y el `tenant_id` sale del token.

## 6. La pantalla

Está en `/configuracion/boleta-electronica` y la ve solo el admin. Tiene tres tarjetas y, arriba, lo que falta:

1. **Emisor.** Nombre, RUT y dirección, de solo lectura con un link a Razones sociales. Giro, comuna, ambiente, fecha y número de resolución se editan acá.
2. **Certificado.** Firmante, RUT y vencimiento. Un botón para subir o reemplazar, que pide el archivo y la clave. Nunca muestra la clave ni deja bajar nada.
3. **Folios.** Una tabla de CAF con tipo, rango, usados, restantes, ambiente y fecha. Un botón para subir el XML del CAF. Borrar aparece solo en los que no tienen folios usados.

Los avisos de § 5 se muestran en la tarjeta que corresponde. Tokens del design system, con un composable para la presentación (`docs/patterns/frontend.md`).

## 7. Pruebas

**Unitarias:**
- Validaciones de subida con el CAF y el certificado de prueba de los fixtures del motor (`cafDePrueba`, `certificadoDePrueba`). Se suma un certificado vencido.
- El cálculo de `faltantes` y `avisos`.
- Ida y vuelta del cifrado.
- **Mutantes:** cada regla de § 3 y § 5 se revierte de a una, y algún caso tiene que caer. Los fixtures no usan el 1 ni rangos que empiecen igual.

**E2e con Postgres real** (`backend/test/`):
- **20 `tomarFolio` en paralelo**, en transacciones distintas: salen 20 folios distintos y consecutivos;
- un rollback devuelve el folio: el próximo es ese mismo;
- un CAF agotado pasa al siguiente rango;
- sin folios → `SIN_FOLIOS`;
- un CAF de otro tenant no se ve ni se toma;
- un CAF de otro ambiente no se toma;
- ninguna respuesta de las rutas contiene `credencial_cifrada`, `xml_cifrado`, el PEM ni la clave;
- borrar un CAF con folios usados → 400;
- cambiar el RUT o borrar una razón social con CAF → 400;
- reemplazar el certificado deja el anterior con el blob en null.

**Playwright:** la pantalla, cargando un certificado y un CAF de prueba, con el rol admin y con un rol que no lo es.

## 8. Lo que queda abierto

- **Un CAF de producción subido mientras la razón social está en certificación no se detecta.** El CAF toma el ambiente de la razón social al subirlo. El `IDK` no sirve para deducirlo: el instructivo técnico del SII (sección A.1, letra h) lo define como la identificación de la llave pública del SII que verifica la firma del CAF, o sea un id de llave y no un ambiente. Se guarda solo para mostrarlo.
- **¿Vencen los CAF de boleta?** La investigación no lo encontró. Se guarda `FA` y no se valida un vencimiento.
- **Custodia del certificado:** la consulta legal o al SII sigue en paralelo. Este diseño guarda lo mínimo para firmar.
- **`DTE_ENCRYPTION_KEY` en Railway:** la carga el owner antes del push, o la cargo yo con su permiso.

## 9. Documentación al implementar

- `docs/features/emision-electronica.md`: una sección del perfil fiscal con las reglas de § 2–5.
- `docs/features/tenants-razones-sociales.md`: las columnas nuevas y la protección de § 2.1.
- Una fila en `docs/ESTADO.md`.
- ADR-033: la clave propia de cifrado y por qué está separada de la pasarela.
- `.env.example`, `startup-pos.sql` y la migración.
