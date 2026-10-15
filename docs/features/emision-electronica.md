# Feature: Emisión electrónica — el motor de la boleta, el perfil fiscal del emisor y la cola de envío al SII

**Status**: In Development — el motor, el perfil fiscal y la cola de envío están terminados; **todavía no se emite nada al SII**: ninguna venta llama a la cola (subproyecto 4)
**Owner**: Cesar Matheus
**Last Updated**: 2026-10-14

Este documento tiene tres partes: **el motor** (subproyecto 2, funciones puras) y, más abajo,
[**el perfil fiscal del emisor**](#perfil-fiscal-del-emisor) (subproyecto 1: certificado, CAF y
folios, con su pantalla) y [**el envío al SII**](#envío-al-sii) (subproyecto 3: la cola, el cliente
de la API de boleta y los dos jobs).

Decisión y razones: [ADR-033](../adr/033-emisor-dte-propio.md). Diseño:
[`2026-10-14-motor-boleta-electronica-design.md`](../superpowers/specs/2026-10-14-motor-boleta-electronica-design.md).
Investigación de mercado y norma: [`2026-10-13-emision-electronica-sii.md`](../agent/investigaciones/2026-10-13-emision-electronica-sii.md).
**Fiscal: frente propio** (`CLAUDE.md`, [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md)).

---

## Overview

### What is it?

Un conjunto de **funciones puras** (`backend/src/modules/dte/`) que reciben los datos de una
boleta (39 afecta, 41 exenta), un CAF y un certificado, y devuelven el `<DTE>` con su timbre
(TED) y su firma, y el sobre `EnvioBOLETA` firmado que agrupa de 1 a 500 boletas. No lee la base,
el reloj ni la red. Las funciones siguen siendo puras aunque el módulo `dte` ya existe (nació con
el perfil fiscal): el perfil usa `leerCaf` y `leerCertificado` al subir y al descifrar, y el job de
envío llama a `armarEnvioBoleta`; nadie llama todavía a `emitirBoleta` (lo hará la venta, en el
subproyecto 4).

### Why does it exist?

ADR-010 congela el hecho fiscal en la venta y difiere el documento. Este es el documento: lo que
el SII recibe, construido sobre lo ya congelado. Se hizo primero como motor puro porque no hay
RUT piloto: se prueba contra los XSD y contra la firma del ejemplo oficial, sin red.

### Scope

- Incluido: armar y firmar la boleta y el sobre; leer un CAF y un `.pfx`; verificar los montos;
  rechazar con código lo que el SII rechazaría. Lo que guarda el emisor y la cuenta de folios
  está en el [perfil fiscal](#perfil-fiscal-del-emisor); la cola que lleva las boletas al SII y
  trae su resultado, en [Envío al SII](#envío-al-sii).
- **No incluido** (cada cosa tiene su dueño):
  - emitir la boleta desde una venta y guardarla en la transacción de la venta (subproyecto 4; la
    cuenta de folios ya la lleva el perfil fiscal, y la cola ya la espera: ver
    [Envío al SII](#envío-al-sii));
  - leer `venta_documentos` o armar el contrato desde una venta (subproyecto 4);
  - verificar la firma `FRMA` del SII sobre el CAF (sigue abierto, ver el perfil fiscal);
  - impuestos adicionales (ILA): el motor los rechaza con código (ver más abajo);
  - factura, nota de crédito y nota de débito;
  - el resumen diario RCOF/RVD, derogado desde el 2022-08-01 (Res. 53/2022);
  - el PDF417 del timbre impreso, opcional desde el 2026-01-01;
  - validar contra el XSD en producción (ver "Pruebas").

---

## API pública

Son cuatro funciones. **Las demás exportaciones del módulo son internas y no se llaman solas**:
`armarTed` suelta timbraría una boleta cuyos montos nadie verificó, `armarDocumento` no firma y
`firmarNodo` firma lo que le den.

| Función | Archivo | Qué hace |
|---|---|---|
| `leerCaf(xml)` | `caf.ts` | Parsea el `<AUTORIZACION>`: RUT, tipo, rango de folios, llaves. Comprueba que la privada sea par de la pública. |
| `leerCertificado(pfx, clave)` | `firma.ts` | Abre el `.pfx` y saca la llave, el certificado y el RUT del firmante (`serialNumber` del sujeto). |
| `emitirBoleta(datos, {caf, certificado}, ahora)` | `envio-boleta.ts` | Timbre + `<Documento>` + `<DTE>` con el `Documento` firmado. Devuelve el XML y `diferenciaIvaRedondeo`. |
| `armarEnvioBoleta(boletas, caratula, certificado, ahora)` | `envio-boleta.ts` | Carátula con un subtotal por tipo, los `<DTE>` dentro del `SetDTE` y la firma del `SetDTE`. |

Reglas de uso:

- **`ahora` y las fechas las decide quien llama** (hora de Chile, `AAAA-MM-DDTHH:MM:SS` y
  `AAAA-MM-DD`). El motor no lee el reloj.
- **Los bytes que van al SII salen de `aLatin1(xml)`, nunca de `Buffer.from(xml)`.** El XML
  declara ISO-8859-1 y la firma se calculó sobre esos bytes; en UTF-8, la `ñ` viaja en dos bytes
  y nada verifica.
- **Un CAF se lee como `latin1`**, no como UTF-8: un CAF con caracteres fuera de ISO-8859-1 da
  `CAF_INVALIDO` en vez de firmar bytes distintos de los del SII.
- Todo error del motor es un `DteError` con un `codigo`; el motor no envuelve ni traga los
  errores que no son suyos.
- El tipo, el folio y el emisor de cada boleta del sobre tienen que cuadrar con la Carátula
  (ver los códigos `ENVIO_*`).

---

## Los montos: el motor verifica, no calcula

Lo congelado en la venta manda (ADR-010). Si una igualdad no cierra, no se arma nada.

1. **Decimal.js en todo.** `MntNeto`, `MntExe`, `IVA` y `MntTotal` van en **pesos enteros**; un
   decimal es error. Cantidad y precio unitario admiten hasta 6 decimales; la cantidad
   tiene que ser mayor que cero y el precio, cero o más (regla 8).
2. **El detalle va con IVA incluido** (sin `IndMntNeto`). Por línea,
   `MontoItem ≈ PrcItem × QtyItem − DescuentoMonto + RecargoMonto`, con tolerancia de **menos de
   un peso**: la venta a granel (0,375 kg × $2.990 = 1.121,25) congela 1.121 y tiene que salir.
   Una línea con solo cantidad o solo precio no se verifica.
3. **Suma de líneas afectas − descuentos globales + recargos globales = `MntNeto + IVA`**; la de
   las exentas = `MntExe`; `MntTotal = MntNeto + IVA + MntExe`. El `MntTotal` tiene que ser
   mayor que cero y ningún monto puede ser negativo.
4. **El IVA congelado se manda tal cual. El peso de la góndola no frena la boleta**: con precio
   de góndola $993 el neto es 834 y el IVA 159, pero `0,19 × 834 = 158`; ningún par de enteros
   cumple a la vez el total y la fórmula. El motor devuelve `diferenciaIvaRedondeo` (el IVA
   mandado menos `round(0,19 × neto)`, en pesos; `'0'` en la 41) como **aviso**. Sirve para
   medir cuántas boletas saldrían "aceptadas con reparos" si el SII exige `tasa × base`, y es
   la deuda de revisión de [`impuestos.md`](./impuestos.md).
5. **Boleta exenta (41)**: todo exento; sin líneas afectas, neto ni IVA (`MntNeto` e `IVA` no
   salen en el XML).
6. **Receptor**: sin cliente va el RUT genérico `66666666-6`. Sobre 135 UF (Res. Ex. SII 44/2025)
   son obligatorios RUT válido y no genérico, nombre y medio de pago. La resolución
   (resolutivo 1° y Anexo III) pide nombres y apellidos, RUT, forma de pago y la descripción
   clara de los productos (`RUTRecep` real, `RznSocRecep`, `MedioPago`, `NmbItem`); teléfono y
   correo son opcionales (`TelefonoRecep`, `CorreoRecep`). **`CdgIntRecep` no se envía**
   (owner, 2026-10-14), aunque el campo 19 del formato v4.2 dice *"Dato obligatorio si
   Indicador Servicio = 3 y RUT = 0, o Monto Total > 135 UF (Ley 21.713)"*: el Anexo III no lo
   lista, y el campo sirve para identificar al cliente que viene con `RUTRecep` = 0, cosa que
   sobre 135 UF no puede pasar. Es un riesgo abierto (ver "Riesgos abiertos"). Quien llama dice si se superó el umbral: el
   motor no sabe de UF. La captura ya lo exige antes de cobrar ([`ventas.md`](./ventas.md)); el
   motor lo repite porque el XML no puede salir sin eso.
7. **Topes del XSD**: 1.000 líneas y 20 descuentos o recargos globales por boleta; 500 boletas por
   sobre.
8. **Línea gratis** (cortesía, producto regalado; owner, 2026-10-14): una línea con precio 0
   sale con `QtyItem`, **sin `PrcItem`** y con `MontoItem` 0. El XSD pide `PrcItem` mayor que
   cero (`Dec5Type`) y el formato v4.2 lo marca condicional, así que no se emite; `MontoItem`
   admite 0. La igualdad de la regla 2 no cambia (`0 × cantidad − descuento + recargo`), de modo
   que un precio 0 con descuento en pesos da `LINEA_NO_CIERRA`. Una **cantidad** 0 se sigue
   rechazando con `MONTO_INVALIDO`: no describe una venta.

## Texto ISO-8859-1, sin cortar

El XML sale en ISO-8859-1. Cada texto pasa por `validarTexto`: un carácter fuera de
U+0020–U+007E y U+00A0–U+00FF (incluidos tab y saltos de línea, que ningún campo admite), o un
largo por encima del máximo del formato v4.2, es **error**. **El motor no corrige ni corta**: lo
emitido tiene que ser igual a lo congelado; la garantía la da la captura (el catálogo limita el
nombre del ítem a 80 caracteres latinos, frente aparte, ver `desarrollo-nuevo.md`).

La **única truncación** es el extracto del timbre (`RSR` e `IT1`, 40 caracteres, lo fija el XSD):
se valida el texto completo, se corta y recién después se escapa, para no partir un `&amp;`.

`escaparXml` escapa solo `&`, `<` y `>`: la forma que tiene el texto de un elemento al
canonicalizarse, para que el `FRMT` verifique tanto con un verificador que lee el texto crudo
como con uno que canonicaliza. Ningún atributo del motor lleva texto libre.

## Timbre, firma y sobre

- **TED**: `<DD>` con el `<CAF>` copiado tal cual y `TSTED`; `FRMT` es RSA-SHA1 con la llave del
  CAF sobre el `<DD>` **aplanado** (sin los blancos entre tags) en bytes latin1.
- **Firma** (XMLDSig): del `<Documento>` (`ID="B{tipo}F{folio}"`) y del `<SetDTE>`
  (`ID="SetDoc"`), C14N inclusivo, digest SHA1, RSA-SHA1, `KeyInfo` con `RSAKeyValue` y
  `X509Certificate`. La `<Signature>` se **empalma en el texto original** justo tras el cierre
  del nodo firmado: no se reserializa, porque `<RSR></RSR>` pasaría a `<RSR/>` y cambiaría los
  bytes que firmó el `FRMT`.
- **`<DTE>` declara los mismos namespaces que la raíz del sobre**, así el `<Documento>` se
  canonicaliza igual suelto y dentro del sobre, y su firma verifica en los dos contextos.
- **Sobre**: se firma el `SetDTE` ya con los `<DTE>` adentro (firmarlo antes los dejaría fuera de
  lo firmado).
- **XSD**: `esquemas/EnvioBOLETA_v11.xsd` es el que publica el SII en `schema_envio_bol_720.zip`
  (bajado el 2026-10-14: tope de 500 `DTE` por sobre, `Detalle` opcional). Las pruebas
  validan contra una copia en `esquemas/` con los cinco campos del formato v4.2 que v11 no trae
  (`MedioPago`, `CorreoRecep`, `TelefonoRecep`, `RutProvSW`, `RznSocProvSW`), cada uno citando su
  fila del formato.

**El hallazgo del spike de la firma**, en una línea: las dos firmas del ejemplo oficial del SII
(2003) verifican con la llave de su `RSAKeyValue` y **no** con la de su `X509Certificate` (los
módulos no coinciden), y la del `Documento` solo verifica con el `<DTE>` suelto, no dentro del
sobre; el motor se apoya en eso y la certificación lo confirma.

## Pruebas

Unitarias, sin red ni base (`backend/src/modules/dte/*.spec.ts`). Certificado autofirmado y CAF
generados con `node-forge` en los fixtures.

- **El XSD se valida solo en las pruebas.** `xmllint-wasm` es una `devDependency`: en producción
  el motor **no valida contra el XSD**, rechaza con códigos las entradas que el XSD rechazaría.
  Si el XSD y los códigos se desfasan, lo ve una prueba, no el cajero.
- Se verifican la firma del `Documento`, la del sobre y el `FRMT` con la llave pública del CAF.
- Se prueba el ejemplo oficial del SII: sus firmas verifican con `xml-crypto`.
- Casos: afecta, exenta, mixta; descuento y recargo de línea y global; góndola con el peso de
  diferencia; sobre 135 UF con y sin identificación; sobre de 3 y de 500 boletas; un CAF de
  Windows (CRLF y declaración ISO-8859-1); `Ñuñoa` y `Peñalolén` de punta a punta.
- Los fixtures de montos evitan el 1 y los factores iguales, que no discriminan; las
  igualdades se revisaron con mutantes durante la construcción.

```bash
cd backend && npm test -- modules/dte
```

---

## Códigos de error

`DteError.codigo` existe para que el subproyecto 4 le diga al cajero qué pasó. La fuente de
verdad es `CodigoDteError` en `dte.types.ts`. Los cinco últimos los lanza el perfil fiscal, no el
motor.

| Código | Cuándo |
|---|---|
| `TOTALES_NO_CIERRAN` | Neto + IVA + exento ≠ total, o las líneas (con los ajustes globales) no suman neto + IVA / exento |
| `LINEA_NO_CIERRA` | `precio × cantidad − descuento + recargo` se aparta del `MontoItem` en un peso o más |
| `MONTO_NO_ENTERO` | Un monto en pesos trae decimales |
| `MONTO_NEGATIVO` | Neto, exento, IVA o `MontoItem` negativo |
| `TOTAL_NO_POSITIVO` | `MntTotal` ≤ 0 (venta de $0 o descuento del 100 %) |
| `SIN_LINEAS` | La boleta no tiene líneas de detalle |
| `BOLETA_EXENTA_CON_AFECTO` | La 41 trae líneas afectas, neto o IVA |
| `FOLIO_FUERA_DE_RANGO` | El folio no es entero o cae fuera de `RNG` del CAF (los dos bordes son válidos) |
| `CAF_OTRO_RUT` | El RUT del CAF no es el del emisor (o el del emisor es malformado) |
| `CAF_OTRO_TIPO` | El tipo del CAF no es el del documento |
| `CAF_INVALIDO` | No es una `AUTORIZACION`, falta un dato, el rango está al revés, las llaves no son un par RSA o trae caracteres fuera de ISO-8859-1 |
| `CERTIFICADO_INVALIDO` | El `.pfx` no abre, no trae llave, ni su certificado, ni un RUT válido |
| `TEXTO_NO_ISO_8859_1` | Un carácter fuera del rango admitido (incluye tab y saltos de línea) |
| `TEXTO_DEMASIADO_LARGO` | Un texto pasa el máximo del formato v4.2 |
| `RUT_INVALIDO` | Un RUT no pasa el dígito verificador |
| `CDG_SUCURSAL_INVALIDO` | `CdgSIISucur` no es un entero de 1 a 9 dígitos sin ceros a la izquierda |
| `FALTA_IDENTIFICACION_135_UF` | Sobre el umbral falta RUT (válido y no genérico), nombre o medio de pago |
| `IMPUESTO_ADICIONAL_NO_SOPORTADO` | `adicionales` > 0: la boleta no tiene dónde informarlos |
| `ENVIO_VACIO` | El sobre no tiene boletas |
| `ENVIO_DEMASIADAS_BOLETAS` | Más de 500 boletas en un sobre |
| `ENVIO_FOLIO_REPETIDO` | El mismo (tipo, folio) dos veces en un sobre |
| `ENVIO_OTRO_EMISOR` | Una boleta del sobre es de un RUT distinto del de la Carátula |
| `NRO_RESOL_INVALIDO` | `NroResol` no es un entero de 0 a 999.999 |
| `FECHA_INVALIDA` | Una fecha no es `AAAA-MM-DD` / `AAAA-MM-DDTHH:MM:SS` o no existe en el calendario |
| `MONTO_INVALIDO` | No es un número; cantidad ≤ 0, precio negativo, precio 0 sin cantidad, o cualquiera de los dos con más de 6 decimales; descuento o recargo no entero o negativo; un ajuste global en 0 |
| `DEMASIADAS_LINEAS` | Más de 1.000 líneas o más de 20 descuentos/recargos globales |
| `SIN_FOLIOS` | Del perfil fiscal: no queda un folio libre del tipo, o no se encuentra el CAF con que se tomó el folio |
| `SIN_CERTIFICADO` | Del perfil fiscal: la razón social emisora no tiene certificado vigente |
| `CERTIFICADO_VENCIDO` | Del perfil fiscal: el certificado vigente ya venció |
| `PERFIL_INCOMPLETO` | Del perfil fiscal: falta giro, comuna, dirección, ambiente o resolución |
| `AMBIENTE_DISTINTO` | Del perfil fiscal: la razón social cambió de ambiente entre tomar el folio y firmar con su CAF |

---

## Riesgos abiertos: solo la certificación (subproyecto 5) los confirma

Son decisiones de forma que el motor tomó con lo que hay publicado. Se escriben acá como lo que
son, riesgos, no hechos. Cada una tiene un arreglo acotado si el SII exige otra cosa.

| Riesgo | Qué asume el motor | Si está mal |
|---|---|---|
| **Aplanado del `<DD>`** | El `FRMT` se calcula sobre el `<DD>` sin los blancos entre tags, en latin1. Es la regla que reproduce el ejemplo oficial; el helper de las pruebas repite la misma regex, así que no la confirma por su cuenta | Cambia la función que arma lo firmado, y con ella el `FRMT` |
| **Namespaces del `<DTE>`** | Declara los de la raíz del sobre (`xmlns` y `xmlns:xsi`) para que la firma del `Documento` verifique suelto y dentro del sobre | Si el SII extrae el `<DTE>` con otro contexto, la firma no le verifica; se ve al certificar |
| **`RutProvSW` / `RznSocProvSW`** | Hijos de `Encabezado` entre `Receptor` y `Totales`: el formato v4.2 los numera 30–31, entre `CiudadPostal` y `MntNeto`, y el SII no publica el padre | El SII rechaza por esquema; son dos elementos del XSD y dos líneas |
| **`<RSR></RSR>` vacío** | Sin nombre de receptor el `RSR` del timbre va como par de tags vacío (forma C14N); el formato no fija un texto y el XSD solo pone `maxLength 40` | El SII exige un texto; se cambia una constante |
| **`CdgIntRecep` sobre 135 UF** | No se envía: el Anexo III de la Res. 44/2025 no lo lista y la boleta sobre el umbral lleva `RUTRecep` real. El formato v4.2, campo 19, lo marca obligatorio si el monto pasa 135 UF | El validador del SII lo exige; es un campo opcional de hasta 20 caracteres en el receptor (y el contrato gana qué escribir en él) |
| **Escape de `& < >` solamente** | Los bytes emitidos son la forma C14N; ningún parser distingue `&apos;` de `'` | Que el SII exigiera `&apos;`/`&quot;` literales: riesgo bajo |

Además: el esquema real del SII (el que valida su servidor, no el v11 de 2007) se mide en la
certificación; y el ejemplo oficial no es una boleta ni trae `RSR` por defecto.

## Perfil fiscal del emisor

Subproyecto 1 de 6 (hecho el 2026-10-14). Guarda lo que el motor necesita y no tenía: los datos
completos del emisor, su certificado digital, sus CAF y la cuenta de los folios. Más una pantalla
para que el admin lo cargue. **Todavía no se emite nada**: ninguna venta toma un folio (subproyecto
4). Código: `backend/src/modules/dte/` (`perfil-fiscal.service.ts`, `folios.service.ts`,
`perfil-fiscal.ts`) y `frontend/app/pages/configuracion/boleta-electronica.vue`.

### Quién emite y dónde viven los datos

- **Un solo RUT emisor por tenant** (owner): el de la razón social **preferida y habilitada**, la
  que ya imprime el ticket. Sin una que cumpla las dos no hay emisor y el perfil lo dice. La
  emisión **no** usa el fallback "la primera habilitada" del frontend: el RUT con que se emite se
  elige, no se deduce por orden alfabético.
- `razones_sociales` suma `giro`, `comuna`, `ambiente_sii` (`certificacion` o `produccion`),
  `fecha_resolucion` y `numero_resolucion` (en certificación es 0, por eso se pregunta por `null`).
  Todas nulas: una razón social que no emite las deja vacías. Se editan en
  `/configuracion/boleta-electronica` (`PATCH /dte/perfil`), no en Razones sociales
  ([`tenants-razones-sociales.md`](./tenants-razones-sociales.md)).
- `dte_certificados`: una fila por certificado subido, **uno vigente por razón social** (índice
  único parcial). Guarda en claro lo que se muestra (`rut_firmante`, `nombre_firmante`, `vence_el`)
  y cifrada la llave y el certificado (`credencial_cifrada`).
- `dte_cafs`: una fila por CAF. El `<AUTORIZACION>` entero va cifrado (`xml_cifrado`) porque trae
  la llave privada del rango. `siguiente_folio` es el próximo a entregar (nace en `desde`); el CAF
  está agotado cuando pasa de `hasta` (CHECK: `desde ≤ siguiente_folio ≤ hasta + 1`). Los usados se
  derivan (`siguiente_folio − desde`): no hay tabla de folios, el folio de cada documento lo guarda
  el documento.
- **El ambiente es parte de la clave del CAF** (índice único `razon_social_id, tipo, ambiente,
  desde` y el chequeo de rangos que se pisan). Por qué: al terminar la certificación la empresa
  pasa a producción y sube CAF de producción, que el SII numera aparte; sin el ambiente en la
  clave chocarían con los de certificación ya usados. El CAF toma el `ambiente_sii` de la razón
  social **al subirlo**.

### Cifrado

- Clave propia, `DTE_ENCRYPTION_KEY` (32 bytes en base64), separada de la de la pasarela. Mismo
  formato `v1:<iv>:<tag>:<data>` (AES-256-GCM). Detalle y rotación en
  [ADR-033](../adr/033-emisor-dte-propio.md).
- `CifradoDteService` es el único punto que cifra y descifra estos blobs. Copia las dos funciones
  de `CredencialesService` (el repo acepta un duplicado; se extrae a la tercera).
- **Sin la variable el backend no arranca.** En Railway hay que cargarla antes del push que la
  exige, o el deploy cae.
- **Ninguna ruta devuelve un blob**, cifrado ni descifrado, ni el PEM ni la clave del `.pfx`.

### Lo que se valida al subir

Todo rechazo es un 400 con un mensaje para el dueño del local.

- **Certificado** (`POST /dte/certificado`, `{pfxBase64, clave}`): se abre con `leerCertificado`.
  Clave incorrecta, archivo que no es `.pfx` o certificado vencido (hora del servidor) → 400. **El
  `.pfx` y la clave se descartan**: se guardan solo la llave y el certificado, porque guardar la
  clave del dueño no hace falta para firmar. El RUT del firmante **no** se compara con el del
  emisor: es una persona (el representante), no la empresa. **Reemplazar** marca el anterior con
  `reemplazado_el` y le pone en null `credencial_cifrada` (un `UPDATE`, no un `DELETE`): no se
  guarda la llave de un certificado que ya no se usa.
- **CAF** (`POST /dte/cafs`, `{xmlBase64}`): el archivo del SII es ISO-8859-1 y el
  `TextDecoder('iso-8859-1')` del navegador en realidad decodifica windows-1252 (los bytes
  0x80–0x9F cambian), así que `leerCaf` lo rechazaría. El navegador manda los bytes en base64 y el
  backend los decodifica como `latin1`. Se rechaza si:
  - la razón social no tiene ambiente elegido;
  - el tipo no es 39 ni 41 (factura y nota de crédito no entran);
  - el RUT del CAF no es el de la razón social emisora;
  - el rango empieza antes del folio 1, o `hasta` o `idk` no caben en un `integer` de Postgres;
  - el rango se pisa con otro CAF del mismo tipo y ambiente sin borrar (rechaza también subir dos
    veces el mismo archivo).
  Además `leerCaf` ya comprueba que la llave privada sea par de la pública.
- **Borrar un CAF** (`DELETE /dte/cafs/:id`): soft delete **solo si no entregó ningún folio**
  (`siguiente_folio = desde`); sirve para arreglar un CAF subido por error. Uno usado no se
  borra (400): sus folios ya están en documentos. Uno que no existe es 404.
- **Concurrencia:** las subidas toman con `FOR UPDATE` la fila de la razón social, y lo mismo hacen
  su edición y su borrado (`TenantsService`). Así un doble clic no mete el mismo rango dos veces ni
  el índice del certificado vigente choca, y un cambio de RUT no se cruza con una subida.
- **Una razón social con certificado vigente o un CAF no borrado no cambia de RUT ni se borra**
  (400): si cambiara, los folios quedarían de otro RUT. Reescribir el mismo RUT con otro formato
  no es un cambio.

### Tomar un folio

`FoliosService.tomarFolio(tenantId, tipo) → { cafId, folio }`. Es un método sin ruta que **corre
dentro de la transacción de quien lo pide** (falla si no hay una activa): el subproyecto 4 decide en
qué punto de la suya lo llama, respetando el orden de bloqueo de filas del proyecto
(`docs/patterns/backend.md`). Este método bloquea una sola fila, la del CAF.

- Un `UPDATE … WHERE caf_id = (SELECT … ORDER BY desde LIMIT 1 FOR UPDATE)` toma el CAF de la
  razón social emisora, del tipo y del ambiente de la razón social, con folios y de menor `desde`,
  le suma 1 a `siguiente_folio` y devuelve el valor anterior.
- **Dos cajas a la vez:** la segunda espera el bloqueo y sale con el folio siguiente. Nunca
  repite. **Si la venta se cae**, el rollback deshace la suma y el folio vuelve; una secuencia de
  Postgres no vuelve, y cada hueco es un folio que hay que anular ante el SII.
- **Reintenta una vez, y el porqué se midió.** En READ COMMITTED, si el CAF bloqueado se agota
  mientras se espera su bloqueo y ya existía otro, Postgres salta al siguiente dentro de la misma
  sentencia. Lo que da vacío es otro caso: **que se confirme un CAF nuevo mientras la sentencia
  espera el bloqueo**, porque no estaba en su foto. La segunda sentencia toma una foto nueva y lo
  ve. Sin folios tras los dos intentos → `SIN_FOLIOS`.

### Las credenciales para firmar

`FoliosService.credencialesParaFirmar(tenantId, cafId, ahora) → { caf, certificado, emisor,
caratula }`. También sin ruta: el JSON descifrado no sale del proceso. Descifra el CAF y el
certificado vigente y arma `EmisorBoleta` y la carátula (el receptor del envío es el SII,
`60803000-K`). Falla con código si:

- falta el giro, la comuna, la dirección, el ambiente o la resolución → `PERFIL_INCOMPLETO`;
- no hay certificado vigente → `SIN_CERTIFICADO`; venció → `CERTIFICADO_VENCIDO`;
- el CAF no existe o es de otro tenant → `SIN_FOLIOS`;
- **el ambiente del CAF no es el actual de la razón social → `AMBIENTE_DISTINTO`.** `tomarFolio`
  bloquea solo el CAF, y en READ COMMITTED un `PATCH` del ambiente puede confirmarse entre
  `tomarFolio` y esta lectura; firmar con el CAF del otro ambiente quemaría el folio.

### El estado del perfil

`GET /dte/perfil` devuelve todo lo que la pantalla muestra y el dato que el aviso al cajero va a
necesitar. La ruta es solo del admin del tenant: un cajero recibe 403, así que ese aviso (subproyecto 4)
necesita su propia ruta o su propio guard.
Son tres consultas fijas (emisor, certificado vigente, CAF), sin importar cuántos CAF haya.

- **Emisor** (`null` si no hay una preferida y habilitada), **certificado vigente** (firmante, RUT,
  `venceEl`) y **CAF** (tipo, rango, usados, restantes, ambiente, fecha, y `borrable`).
- `faltantes`, lo que impide emitir (`evaluarPerfil`, pura): sin emisor, RUT inválido, sin giro,
  comuna, dirección, ambiente o resolución, texto fuera de ISO-8859-1 o más largo de lo que admite
  el SII (nombre 100, giro 80, comuna 20, dirección 70), sin certificado o vencido, y sin folios
  de boleta (39) **del ambiente vigente**. Esos límites se validan acá y no en el CRUD de razones
  sociales: una que no emite sigue aceptando 255.
- `avisos`, lo que conviene mirar ya: menos de **100** folios de un tipo (se suman todos sus CAF
  del ambiente vigente) o certificado que vence en menos de **30** días. Son constantes del
  módulo (`UMBRAL_FOLIOS`, `DIAS_AVISO_CERTIFICADO`); que sean configurables se decide cuando
  alguien lo pida.
- **Cambiar de ambiente** con CAF cargados no los borra: dejan de servir (el `tomarFolio` los
  ignora) y la pantalla los muestra como de otro ambiente. Es el paso normal al terminar la
  certificación.

### Permisos y pantalla

- Las cinco rutas llevan `TenantAdminGuard` (configuración del tenant, no un módulo RBAC) y el
  `tenant_id` sale del token.
- `/configuracion/boleta-electronica`: arriba lo que falta para emitir, y tres tarjetas: emisor
  (giro, comuna, ambiente y resolución se editan acá; nombre, RUT y dirección, de solo lectura con
  link a Razones sociales), certificado (firmante, vencimiento, subir o reemplazar; nunca muestra
  la clave) y folios (tabla de CAF, subir, y borrar solo en los sin folios usados).
- **El menú de Configuración la muestra solo al superadmin** (owner, 2026-10-14): un comercio no ve
  una pantalla que promete boletas que todavía no salen. La **ruta** sigue siendo del admin del
  tenant; abrirla a todos es quitar `auth.isSuperadmin` de `configuracion.vue`, y toca decidirlo
  con el subproyecto 4.

### Pruebas

Unitarias (`perfil-fiscal.spec.ts`, `perfil-fiscal.service.spec.ts`, `folios.service.spec.ts`,
`cifrado-dte.service.spec.ts`), e2e contra Postgres real (`backend/test/dte-perfil.e2e-spec.ts`,
`dte-folios.e2e-spec.ts`: 20 `tomarFolio` en paralelo dan 20 folios distintos y consecutivos,
rollback que devuelve el folio, paso al CAF siguiente, ambientes y tenants cruzados, ninguna
respuesta con un blob) y Playwright de la pantalla (`frontend/e2e/configuracion/boleta-electronica.spec.ts`).
Las reglas de subida y de `evaluarPerfil` se revisaron con mutantes: los fixtures evitan el 1 y los
rangos que empiezan igual.

### Decidido por el owner (2026-10-14, por AskUserQuestion)

- **Una razón social que ya emitió queda fija** y no hay ruta para quitar el certificado vigente
  ni un CAF usado. Un RUT distinto es otro contribuyente ante el SII: para cambiar de RUT se crea
  otra razón social y se la marca preferida, y lo emitido conserva su rastro.
- **Nombre del ítem:** el catálogo valida al crear y al editar (80 caracteres en ISO-8859-1). Los
  ítems que ya no cumplen no se corrigen solos: el motor los rechaza al emitir (texto inválido), y
  el subproyecto 4 le dice al cajero qué producto renombrar. El seed no tiene ninguno (medido: 12 ítems, máximo 28 caracteres).
- **ILA y adicionales:** primero una investigación con fuentes del SII; la decisión sale de ahí.

### Lo que queda abierto

- **Un CAF de producción subido mientras la razón social está en certificación no se detecta.** El
  CAF toma el ambiente de la razón social al subirlo. El `IDK` no sirve para deducirlo: según el
  instructivo técnico del SII (A.1, letra h) identifica la llave pública del SII que verifica la
  firma del CAF, no un ambiente. Se guarda solo para mostrarlo.
- **La firma del SII sobre el CAF (`FRMA`) no se verifica.** Hace falta la llave pública del SII y
  una investigación aparte. Un CAF adulterado lo rechaza el SII al recibir el envío.
- **¿Vencen los CAF de boleta?** La investigación no lo encontró. Se guarda `FA` y no se valida
  un vencimiento.
- **Custodia del certificado:** la consulta legal o al SII sigue en paralelo. El diseño guarda lo
  mínimo para firmar.
- **`CdgSIISucur` por local:** los locales (`ubicaciones`) no tienen dirección ni código SII; la
  boleta sale con la dirección de la razón social.
- **Cambio de ambiente o de razón social preferida después de `credencialesParaFirmar`:** esa
  lectura no bloquea nada, así que el subproyecto 4 tiene que decidir en qué punto de su
  transacción la hace para que no se cruce con un `PATCH` (hoy solo `AMBIENTE_DISTINTO` lo cubre,
  y solo entre `tomarFolio` y ella).
- **El aviso al cajero** (pocos folios, certificado por vencer) llega con el subproyecto 4. Este
  deja la pantalla y el dato que ese aviso va a necesitar (la ruta es de admin: el aviso, que lo ve el
  cajero, tiene que traer la suya).
- **Los CAF de una ex emisora no se ven en ninguna parte.** El perfil lista solo los CAF de la
  razón social preferida de hoy. Una razón social que dejó de ser preferida sigue protegida (no
  cambia de RUT ni se borra mientras tenga folios o certificado), pero sus CAF no aparecen en la
  pantalla, así que no se pueden quitar desde ahí: el camino es volver a marcarla preferida.
- **`setPreferida` no toma el bloqueo de la razón social.** Una subida de CAF o de certificado que
  espera ese bloqueo puede dar un 400 "marca una preferida" que no corresponde, o dejar el CAF en
  una razón social que acaba de dejar de ser preferida. No hay interbloqueo y los datos quedan
  consistentes; el costo es un rechazo o un CAF en la razón social anterior.
- **No hay script de rotación** de `DTE_ENCRYPTION_KEY` (ver ADR-033).

---

## Envío al SII

Subproyecto 3 de 6 (hecho el 2026-10-14). Lleva al SII cada boleta que el subproyecto 4 emita,
**sin que la venta espere al SII**, y guarda qué contestó (aceptada, con reparos o rechazada, con
el motivo). **Todavía no se emite nada**: nadie llama a `encolar` (lo hará la venta, en el
subproyecto 4), así que las dos tablas están vacías. Código en `backend/src/modules/dte/`:
`cola-dte.service.ts`, `sii-boleta.cliente.ts`, `resultado-sii.ts` y los dos jobs de `jobs/`.
**Fiscal: frente propio** (ADR-010). La spec y el plan se borraron al terminar (la historia queda
en git); lo durable está acá.

- **No incluido** (cada cosa tiene su dueño):
  - quién llama a `encolar`, reemitir una boleta rechazada, avisar al dueño o mostrar una pantalla
    (subproyecto 4);
  - la consulta de una boleta individual (`/boleta.electronica/{rut}-{dv}-{tipo}-{folio}/estado`);
  - el envío al cliente por correo o QR;
  - la certificación ante el SII (subproyecto 5).
- **Plazo legal:** la boleta se envía "inmediato, máximo 1 hora". Sin conexión se genera igual, y
  la hora corre desde que vuelve (Res. 74, F.6).

### Decidido por el owner (2026-10-14, por AskUserQuestion)

- **Quién se entera de un rechazo:** queda registrado en la boleta; la pantalla y el aviso llegan
  con el subproyecto 4. Se descartó una lista desde ya: hoy estaría siempre vacía, porque nadie
  emite.
- **Boleta con más de 1 hora sin llegar:** se sigue reintentando **sin tope** y queda "atrasada"
  (ver más abajo). Se descartó frenar las ventas: un SII caído dejaría al local sin vender.

### Los datos

Dos tablas, con la migración `1792019884107-ColaEnvioSii.ts` (ADR-030). Ninguna fila se borra de
verdad; el único `eliminado_el` que se escribe es el de un sobre que **nunca existió para el SII**
(ver "Qué pasa al enviar").

- **`dte_documentos`**: una fila por boleta. `xml` es el `<DTE>` firmado tal como lo devolvió
  `emitirBoleta` (el documento legal; no se cifra porque no trae secretos, el `RSASK` del CAF no
  viaja en el DTE). Lleva `tipo` (39/41), `folio`, `ambiente`, `rut_emisor`, `caf_id`,
  `razon_social_id`, `emitido_el` (fija el plazo de 1 hora), `proximo_intento_el`, `intentos` y
  `ultimo_error` (por boleta, porque la espera creciente es por boleta: un sobre que falla deja de
  existir como unidad), `envio_id` (null hasta que entra a un sobre) y `detalle_sii` (jsonb: los
  errores que el SII devolvió para esa boleta, o el motivo del rechazo del sobre). Índice único
  `(razon_social_id, tipo, ambiente, folio)` entre las no borradas: un folio no se encola dos veces.
- **`dte_envios`**: un sobre. `trackid` (bigint, null hasta el 200 del SII; `pg` lo devuelve como
  texto), `estado_sii` (el código del SII, 3 letras), `enviado_el`, `consultar_desde` (cuándo
  puede consultarse; null saca el envío de la consulta), `reservado_hasta` (la reserva mientras el
  sobre está en vuelo; un índice parcial la sirve para encontrar las reservas vencidas),
  `intentos_consulta`, `ultimo_error` y `respuesta_sii` (jsonb, la última
  respuesta de la consulta).

Los estados de `dte_documentos` (CHECK en la base):

| Estado | Significa |
|---|---|
| `pendiente` | Está en la cola: nunca salió, o salió y volvió porque el envío falló |
| `enviado` | Va en un sobre. Sale de aquí cuando el SII da su resultado |
| `aceptado` | El SII la aceptó sin comentarios (`detalle_sii` null) |
| `reparos` | El SII la aceptó **con reparos** (Res. 121/2026); el detalle queda en `detalle_sii` |
| `rechazado` | El SII la rechazó, o el pedido de envío estaba mal formado. El motivo queda siempre en `detalle_sii`; `ultimo_error` de la boleta lo lleva solo cuando el rechazo fue el 400 del envío |

**"Atrasada" no es una columna**: se calcula al leer, y es
`estado IN ('pendiente','enviado') AND emitido_el < now() - interval '1 hour'` (con
`eliminado_el IS NULL`). Un test e2e fija esa consulta para el subproyecto 4. Incluye a la boleta
que quedó `enviado` sin resultado (un 404 de 24 horas, un código que no se entendió, una caída entre
el `ok` y el trackid): se ve atrasada y alguien la revisa.

### Encolar

`ColaDteService.encolar(tenantId, boleta, cafId) → { documentoId }` es lo único que el módulo
expone para el subproyecto 4. **Exige una transacción activa** (`TxContext.managerActivo()`), igual
que `tomarFolio`: si la venta hace rollback, la boleta no queda en la cola, y el folio, la boleta y
la venta se confirman juntos o ninguno (una boleta sin venta es un folio perdido ante el SII). Fuera
de una transacción tira un `Error` de programación.

- La razón social y el ambiente salen **del CAF con que se tomó el folio**, no de quien llama. Una
  sola sentencia inserta la fila `pendiente` (`emitido_el` y `proximo_intento_el` en `now()`) solo si
  el RUT del CAF es el de la boleta.
- Sin CAF (o de otro tenant) → `SIN_FOLIOS`. RUT de la boleta distinto del del CAF →
  `ENVIO_OTRO_EMISOR`.

### El job de envío

`EnviarBoletasJob` (`jobs/enviar-boletas.job.ts`), cada **30 segundos**, mismo patrón de
`expirar-ordenes` ([`cron.md`](./cron.md)). Un tick sin trabajo no entra al runner (serían ~2.900
filas diarias en `cron_ejecuciones` para no decir nada). Cada corrida:

1. **Devuelve las reservas vencidas.** Un sobre sin `trackid` cuya `reservado_hasta` venció es un
   proceso que se cayó con el sobre en vuelo: el sobre se **da de baja** (soft delete: para el SII
   nunca existió, y sin eso la reserva vencida contaría como trabajo en cada tick) y sus boletas
   vuelven a `pendiente`, sin sumar intento.
2. **Elige qué sale: la regla del lote.** Por razón social (y ambiente) arma un sobre cuando hay
   **50 o más** boletas listas, o cuando **la más antigua lleva 5 minutos** esperando (medido
   desde su `emitido_el`). Una boleta está lista cuando es `pendiente` y su `proximo_intento_el`
   llegó: la que volvió a la cola con su espera sin cumplir no cuenta ni para las 50 ni para la más
   antigua. Así un local con poco movimiento no hace un envío por boleta (el límite del SII es por
   IP y lo comparten todos los tenants), y la boleta sigue llegando muy dentro de la hora. El SII
   recomienda 50 por sobre; admite hasta 500.
3. **Reserva**, en una transacción corta: `SELECT … FOR UPDATE SKIP LOCKED LIMIT 50` sobre las
   pendientes de la razón social (por `emitido_el`, `folio`), crea el `dte_envios` con
   `reservado_hasta = now() + 5 min`, pasa las boletas a `enviado` con su `envio_id` y confirma.
   `SKIP LOCKED` hace que dos instancias del backend tomen lotes distintos en vez de esperarse. Con
   varias instancias, la segunda puede mandar un sobre chico (la regla del lote del paso 2 se
   evalúa antes del lock): es aceptado, el sobre es válido y las boletas no se duplican.
4. **Envía, fuera de la transacción.** Nunca hay una llamada HTTP con una conexión de la base
   tomada. Con el `caf_id` de la boleta más antigua pide `credencialesParaFirmar` (certificado,
   carátula; rechaza si la empresa cambió de ambiente, si el certificado venció o si falta un dato),
   arma el sobre con `armarEnvioBoleta` y lo manda con `SiiBoletaCliente`.
5. **Anota el resultado.**

Un error de programación en una razón social no le quita el turno a las demás: se registra, se
sigue, y al final se vuelve a tirar (el runner lo deja en `cron_ejecuciones` y la reserva vence
sola).

### Qué pasa al enviar

| Respuesta | Qué hace |
|---|---|
| 200 con `trackid` | El envío guarda `trackid`, `estado_sii` (`REC`) y `consultar_desde = enviado_el + max(10 min, X-Retry-After)`; las boletas siguen `enviado`. `X-Retry-After` se topa a 1 hora (como la pausa por límite); uno no numérico o negativo se ignora |
| 200 con un `trackid` que no son hasta 15 dígitos (ausente, vacío, con letras o decimales) | No es un envío hecho: falla transitoria con "El SII respondió sin un número de envío válido". Las boletas vuelven a la cola y se reenvían; el SII contestará que ya tenía el sobre (`RPT`), el hueco de lo abierto |
| 200 con un `estado` del POST que ya es final (o no se conoce) | El `estado_sii` **no se guarda** (quedaría fuera de la consulta antes de que nadie la haga): queda sin código, con `ultimo_error` "El SII respondió el envío con el código X; se consulta igual" (X recortado a 20), y el job de consulta lo toma igual. Solo se guarda un estado que sigue en proceso (`REC`, `SOK`, `FOK`, `CRT`, `PRD`) |
| Red caída, timeout, 500, 405, pausa por el límite, RUT inválido | Las boletas vuelven a `pendiente` con `envio_id` null, `intentos + 1` y `ultimo_error`; el sobre se da de baja con el mismo motivo |
| 401 | El cliente descarta el token, pide otro y reintenta **una vez**. Si vuelve a dar 401 (o la semilla/token dan 400, 401 o 403), se trata como falla: las boletas vuelven a la cola, **nunca** se rechazan por esto |
| 404 | Como falla: vuelven a la cola con "no encontró el servicio de recepción" |
| 400 | El pedido está mal armado y es un error nuestro: las boletas pasan a `rechazado` con `detalle_sii = { origen: 'envio', mensaje }`. No se reintenta solo, porque repetiría el error. El envío queda con `ultimo_error` |
| `DteError` del perfil (certificado vencido, perfil incompleto, ambiente distinto) o del armado | Vuelven a la cola con el mensaje a la vista, hasta que el dueño lo arregle |
| El proceso se cae a mitad | La reserva vence y el paso 1 del siguiente tick devuelve las boletas a `pendiente` |

**La espera creciente es por boleta, sin tope de intentos:** tras el intento que falló, 30 s, 1,
2 y 5 minutos, y de ahí **cada 10 minutos** (`espera(n)` en el job es la única fuente de la escala).
La boleta que choca con el límite del SII cuenta ese intento: no se agrega una espera aparte.

### El límite de pedidos del SII

El SII limita los pedidos **por IP y por hora**, y todos los tenants salen por la misma IP. Una
respuesta 405, o con `X-RateLimit-Remaining: 0`, **pausa al cliente** hasta `X-RateLimit-Reset`:

- La pausa es **en memoria y por proceso**: con más de una instancia, cada una aprende al chocar.
- **Tope de 1 hora** (el límite es por hora); sin un valor útil, 60 s.
- `X-RateLimit-Reset` se lee como **segundos de espera**; un valor mayor que 1e9 se toma como hora
  epoch en segundos. **La unidad no está confirmada** hasta la certificación (ver lo abierto).
- Los dos jobs miran `pausadoHasta()` antes de cada reserva y cortan sin reservar si está pausado:
  no se reserva nada que después no se pueda mandar.

### El cliente del SII y el token

`SiiBoletaCliente` (provider de `DteModule`, sin exportar) habla con la API REST de boleta del SII
(OpenAPI 1.0.5): semilla, token, envío del sobre y consulta del envío.

- **Token:** semilla → `<getToken>` firmado con `firmarDocumento` (XMLDSig enveloped, `URI=""`,
  RSA-SHA1; su oráculo es la semilla `030530912644`, cuyo `DigestValue` publica el SII) → `Cookie:
  TOKEN=…`. Se cachea **en memoria por certificado y ambiente**, se considera vencido a los **50
  minutos sin uso** (el SII lo da por 1 hora y renueva con cada uso), y dos pedidos a la vez
  comparten uno. Se pierde en cada deploy: el primer envío después cuesta dos pedidos extra, no es
  un riesgo.
- Cada pedido lleva `User-Agent` (el SII lo exige), un timeout de 20 s, no sigue redirects (la
  cookie con el token no debe viajar a otro lado) y lee como máximo 1 MiB de respuesta.
- Devuelve un `RespuestaSii` (`ok`, `no_autorizado`, `peticion_invalida`, `no_encontrado` o
  `transitorio`) para todo lo que viene del SII, de la red o del certificado; el job decide. Un error
  de programación sí tira. **Ningún mensaje, resultado ni log lleva el token ni la llave.**
- Las URLs salen de configuración, con los servidores del SII por defecto:

| Variable | Default |
|---|---|
| `SII_BOLETA_API_CERTIFICACION` | `https://apicert.sii.cl/recursos/v1` (semilla, token y consulta) |
| `SII_BOLETA_ENVIO_CERTIFICACION` | `https://pangal.sii.cl/recursos/v1` (envío) |
| `SII_BOLETA_API_PRODUCCION` | `https://api.sii.cl/recursos/v1` |
| `SII_BOLETA_ENVIO_PRODUCCION` | `https://rahue.sii.cl/recursos/v1` |

### El job de consulta

`ConsultarEnviosJob` (`jobs/consultar-envios.job.ts`), cada **minuto**. Toma hasta **20** envíos
con `trackid`, sin resultado final y con `consultar_desde` vencido (el SII recomienda esperar 10
minutos tras enviar y respetar `X-Retry-After`), y reparte el resultado entre sus boletas.

- **Reserva con lease:** una transacción corta hace `SELECT … FOR UPDATE SKIP LOCKED` y mueve
  `consultar_desde` 5 minutos adelante; la llamada al SII va fuera de ella. El `FOR UPDATE` muere
  con el commit, así que lo que protege el resto del tiempo es ese movimiento: si el proceso se cae,
  la consulta se repite sola cuando vence. Si otra instancia retoma un envío que esta todavía no
  anotó, el reparto es inocuo (solo escribe boletas `enviado`).
- **El reparto es en un solo `UPDATE`** para todas las boletas del sobre (estado y detalle de cada
  una en arreglos, nunca una consulta por boleta). Solo escribe boletas que siguen `enviado`: una
  con estado final no se pisa. Las credenciales se piden una vez por razón social, no por envío.

| `estado` del SII | Qué hace |
|---|---|
| `EPR` o `RPR` | Cada boleta según `detalle_rep_rech` (la lista de más abajo); el envío queda final |
| `RCH`, `RCO`, `RFR`, `RSC`, `RCT`, `VOF` (rechazo del sobre) | Todas las boletas del sobre pasan a `rechazado`, con `detalle_sii = { origen: 'sobre', estado, descripcion }` |
| `RPT` | El SII ya tenía ese sobre. El envío queda final con `ultimo_error` "El SII ya tenía este envío (RPT)" y **las boletas no cambian de estado** ni se reenvían (ver lo abierto) |
| `REC`, `SOK`, `FOK`, `CRT`, `PRD` | En proceso: se vuelve a consultar en `max(5 min, X-Retry-After)` |
| Un código que no conocemos | Igual que en proceso, pero con `ultimo_error` "El SII devolvió el código X; se sigue consultando", **sin plazo**. Nunca da por aceptada ni rechazada una boleta |
| 404 | Se vuelve a consultar cada 5 minutos con `ultimo_error` "todavía no encuentra el envío". Si sigue a las **24 horas** de `enviado_el`, el envío sale de la consulta con "no encuentra el envío" y sus boletas siguen `enviado` (atrasadas a la vista) |
| Red, 500, 405, 401, 400, o `DteError` de credenciales | Se anota en `ultimo_error` y se reintenta en 5 minutos, sin tocar las boletas |

**El reparto por boleta** (`repartirResultado`, función pura en `resultado-sii.ts`) se hace por
**`(tipo, folio)`**, nunca solo por folio: una 39 y una 41 pueden llevar el mismo folio. La
respuesta llega sin validar, así que `tipo` y `folio` pueden venir ausentes o como texto, y se
comparan como número.

- Una entrada `RCH` deja la boleta `rechazado` (gana sobre cualquier otra), una `RPR` la deja
  `reparos`, y sin entrada propia queda `aceptado` **solo si el SII no dejó observaciones**
  (ninguna entrada sin boleta, ningún código desconocido, ninguna lista ilegible); si las dejó,
  queda `enviado` con el aviso en `ultimo_error` del envío.
- Un envío sin boletas vivas (todas borradas o reasignadas) sale de la consulta con
  `ultimo_error` "El envío no tiene boletas vivas que consultar" y sin reintento: sin boletas no
  hay certificado con qué descifrar, así que reintentar no lo arregla.
- Una entrada con `folio` ausente o null (error de esquema o de firma) alcanza a **todas** las
  boletas del sobre.
- El detalle completo del SII queda en `respuesta_sii` del envío; en la boleta, la entrada que le
  tocó.

#### Decisiones provisionales, pendientes del owner (2026-10-14)

Estas dos reglas las tomó el agente al construir la cola, **no el owner**, y quedan pendientes de
su confirmación. La razón común: nunca aceptar por ausencia cuando el SII habló de algo que no
entendimos.

- **Entrada con un código desconocido:** una entrada de `detalle_rep_rech` cuyo código no es
  `RCH` ni `RPR` **no es un reparo** (`reparos` es "aceptada con observaciones"). La boleta queda
  `enviado` (atrasada a la vista) y el envío lleva `ultimo_error` para revisión. Una entrada
  `RCH`/`RPR` que no calza con ninguna boleta del sobre también deja `ultimo_error`.
- **Boletas sin entrada cuando el SII dejó observaciones:** si hay una entrada `RCH`/`RPR` sin
  boleta que calce, o un `detalle_rep_rech` presente que no es una lista, las boletas **sin entrada
  propia no pasan a `aceptado`**: quedan `enviado` con el aviso. Las que sí tienen entrada se
  reparten igual. Un código de sobre fuera de los conocidos deja `ultimo_error` y se consulta sin
  plazo.
- **Si está mal:** el owner elige `reparos` o `rechazado` para esas entradas, o `aceptado` por
  ausencia; es una línea en `resultado-sii.ts`. El costo mientras tanto es boletas atrasadas a la
  vista que alguien revisa.

### Configuración: `DTE_COLA_AUTOMATICA`

Los dos jobs salen sin hacer nada si `DTE_COLA_AUTOMATICA` vale `'false'`. **Sin definir (Railway,
producción) están encendidos**; no hace falta ninguna variable nueva. `docker-compose.yml` y los e2e
(`backend/test/setup-env.ts`) la apagan: en desarrollo y en las pruebas los jobs no deben mandar a
nadie nada por su cuenta, y los tests llaman a `enviarLotes()` y `consultar()` a mano. Las
`SII_BOLETA_*` y esta variable están comentadas en `.env.example`.

### Pruebas

Sin RUT piloto no se le pega al SII de verdad.

- **Un SII falso** (`__fixtures__/sii-falso.ts`, un `http.createServer` de Node, sin dependencias
  nuevas) con las rutas, headers y respuestas del OpenAPI 1.0.5; el cliente toma sus URLs de
  configuración y el test las apunta al falso.
- **El oráculo del token:** la firma del `getToken` de la semilla `030530912644` da exactamente el
  `DigestValue` del SII.
- **Unitarios** del reparto (cada fila de la tabla, con fixtures que no usan el 1 ni cantidades
  iguales), del cliente y de los dos jobs.
- **e2e con base real** (`backend/test/dte-cola.e2e-spec.ts`): encolar sin transacción tira; encolar
  y hacer rollback no deja nada; dos `enviarLotes` a la vez no mandan la misma boleta (`SKIP
  LOCKED`); la reserva vencida vuelve las boletas a `pendiente`; el lote sale a las 50 o a los 5
  minutos y no antes; un 405 pausa; una boleta con más de 1 hora se lee atrasada; de punta a punta
  contra el SII falso (encolar → enviar → consultar → `aceptado`, `reparos` y `rechazado` en el
  mismo sobre); el tick apagado no escribe en `cron_ejecuciones`.

```bash
cd backend && npm test -- modules/dte
cd backend && npx jest --config ./test/jest-e2e.json test/dte-cola.e2e-spec.ts
```

### Lo que queda abierto

- **Caída entre el `ok` del SII y anotar el `trackid`.** Si el proceso se cae (o la reserva vence
  mientras el SII contesta) después de que el SII recibió el sobre, las boletas vuelven a la cola y
  se reenvían. El SII contesta `RPT` y **el `trackid` del primer envío se pierde**: esas boletas
  quedan `enviado` sin resultado, atrasadas a la vista. Lo resuelve la consulta por boleta
  individual, que queda fuera de este subproyecto.
- **Boletas que quedan `enviado` por observaciones (las decisiones provisionales de arriba) o por un 404 de 24 horas requieren
  revisión de una persona.** Hoy el motivo está en `ultimo_error` del envío y en `respuesta_sii`; la
  pantalla y el aviso son del subproyecto 4.
- **Un código de sobre desconocido se consulta sin plazo**, con el aviso en `ultimo_error`. Si el
  SII nunca lo cambia, el envío se consulta cada 5 minutos para siempre.
- **Un `DteError` al armar el sobre** (por ejemplo un XML que el motor ya no acepta) reintenta cada
  10 minutos sin alerta. La pantalla del subproyecto 4 es la que lo muestra.
- **`encolar` no verifica el tipo ni el folio de la boleta contra el tipo y el rango del CAF**:
  depende de que quien llama pase el `cafId` que le dio `tomarFolio`.
- **`X-RateLimit-Reset`: la unidad no está confirmada.** Se lee como segundos (o epoch si pasa de
  1e9), con tope de 1 hora. Si está mal, la pausa es de hasta 1 hora de más o de menos. Lo confirma
  la certificación.
- **El límite por IP lo comparten todos los tenants.** El lote de 50 o 5 minutos lo achica, pero con
  muchos tenants activos puede no alcanzar. Se mide en producción (subproyecto 5).
- **Lo que solo confirma la certificación:** el `User-Agent` exacto que acepta el SII, el formato
  real del 400 y del 405, y si `pangal`/`rahue` siguen siendo los servidores de envío (el OpenAPI
  los llama "temporales").
- **El esquema de envío ya está adoptado:** el `esquemas/EnvioBOLETA_v11.xsd` del motor es el del
  zip 720 del SII (ver "Timbre, firma y sobre"); ya no es un punto abierto.

---

## Pendiente de decisión

El tratamiento de **ILA y otros impuestos adicionales** en la boleta no está decidido (la
boleta no tiene campo para ellos); el motor rechaza con `IMPUESTO_ADICIONAL_NO_SOPORTADO`. Es un
frente aparte (`docs/agent/desarrollo-nuevo.md`).

---

## Related Features

- [ADR-033](../adr/033-emisor-dte-propio.md) — por qué se construye y qué falta.
- [`cron.md`](./cron.md) — el runner de los dos jobs de la cola (`cron_ejecuciones`).
- [`tenants-razones-sociales.md`](./tenants-razones-sociales.md) — las columnas del emisor y la
  protección del RUT.
- [`impuestos.md`](./impuestos.md) — el IVA congelado y la deuda del peso de la góndola.
- [`ventas.md`](./ventas.md) — `venta_documentos` (lo que el subproyecto 4 traducirá al contrato)
  y la identidad sobre 135 UF.
- [`reembolsos-nota-credito.md`](./reembolsos-nota-credito.md) — la nota de crédito, fuera del
  alcance de este motor.
