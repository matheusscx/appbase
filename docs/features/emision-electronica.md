# Feature: Emisión electrónica — el motor de la boleta, el perfil fiscal del emisor, la cola de envío al SII y la venta que emite

**Status**: In Development — el motor, el perfil fiscal, la cola de envío, la venta que emite (subproyecto 4, frente 1) y las boletas con problemas (frente 3: verlas y avisar) están terminados; con el interruptor del tenant prendido cada venta emite su boleta. **Falta** la nota de crédito electrónica (frente 2, en pausa hasta consultar al SII), **reemitir una boleta rechazada** (espera dos respuestas del SII) y la certificación ante el SII (subproyecto 5): nada de lo emitido tiene validez hasta entonces
**Owner**: Cesar Matheus
**Last Updated**: 2026-10-15

Este documento tiene cinco partes: **el motor** (subproyecto 2, funciones puras) y, más abajo,
[**el perfil fiscal del emisor**](#perfil-fiscal-del-emisor) (subproyecto 1: certificado, CAF y
folios, con su pantalla) y [**el envío al SII**](#envío-al-sii) (subproyecto 3: la cola, el cliente
de la API de boleta y los dos jobs) y [**la venta emite la boleta**](#la-venta-emite-la-boleta)
(subproyecto 4, frente 1: el interruptor, la emisión dentro de la venta, el botón de las pendientes y
el aviso al cajero) y [**boletas con problemas**](#boletas-con-problemas) (subproyecto 4, frente 3:
la lista del admin, la franja del cajero y el panel de soporte).

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
envío llama a `armarEnvioBoleta`; `emitirBoleta` lo llama `EmisionBoletaService` (la venta, subproyecto 4).

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
  - emitir la boleta desde una venta y armar el contrato desde `venta_documentos`: lo hace el
    módulo `venta-documentos` ([La venta emite la boleta](#la-venta-emite-la-boleta)), no el motor,
    que sigue sin leer la base;
  - verificar la firma `FRMA` del SII sobre el CAF (sigue abierto, ver el perfil fiscal);
  - impuestos adicionales (ILA): el motor los rechaza con código (ver más abajo);
  - factura, nota de crédito y nota de débito;
  - el resumen diario RCOF/RVD, derogado desde el 2022-08-01 (Res. 53/2022);
  - el PDF417 del timbre impreso, opcional desde el 2026-01-01;
  - validar contra el XSD: lo hace el job de envío antes de mandar el sobre, no el motor (ver
    [Antes de enviar: el esquema](#antes-de-enviar-el-esquema)).

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
   las exentas = `MntExe`; `MntTotal = MntNeto + IVA + MntExe`. Ningún monto puede ser
   negativo. El `MntTotal` es mayor que cero, **o cero si un descuento lo explica**: la suma de
   los `DescuentoMonto` de línea más los descuentos globales (`D`) tiene que ser mayor que cero
   (Res. Ex. SII 60/2023: la venta que un descuento deja en $0 igual se informa, y el XSD
   admite `MntTotal` 0). Con el **descuento de línea** la línea sale a precio de lista con su
   `DescuentoMonto` y `MontoItem` 0; con un **descuento global** (`D`) la línea conserva su monto y
   el `MntTotal` 0 sale de restarle el descuento. Ninguna es la línea gratis de la regla 8, que sale
   sin `PrcItem`. Un recargo no explica un $0.
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

- **El motor no valida contra el XSD; lo valida el job de envío.** El motor rechaza con códigos las
  entradas que el XSD rechazaría, y las pruebas lo validan contra el XSD con el mismo
  `validarContraXsd` que usa producción (`esquema-sii.ts`). Si el XSD y los códigos se desfasan,
  lo ve una prueba, no el cajero; y si algo se escapa, el job lo atrapa antes de enviar (ver
  [Antes de enviar: el esquema](#antes-de-enviar-el-esquema)).
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

`DteError.codigo` existe para que la venta (subproyecto 4) diga qué pasó: se guarda en `emision_error_codigo` y `grupoDelError` lo parte entre lo que arregla el admin y lo que es de esa boleta. La fuente de
verdad es `CodigoDteError` en `dte.types.ts`. Los cinco últimos antes de `LINEA_SIN_NOMBRE` los
lanza el perfil fiscal y `LINEA_SIN_NOMBRE`, el armado desde la venta; ninguno es del motor.

| Código | Cuándo |
|---|---|
| `TOTALES_NO_CIERRAN` | Neto + IVA + exento ≠ total, o las líneas (con los ajustes globales) no suman neto + IVA / exento |
| `LINEA_NO_CIERRA` | `precio × cantidad − descuento + recargo` se aparta del `MontoItem` en un peso o más |
| `MONTO_NO_ENTERO` | Un monto en pesos trae decimales |
| `MONTO_NEGATIVO` | Neto, exento, IVA o `MontoItem` negativo |
| `TOTAL_NO_POSITIVO` | `MntTotal` negativo, o 0 sin un descuento (de línea o global) que lo explique (una cortesía sola) |
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
| `IMPUESTO_ADICIONAL_NO_SOPORTADO` | `adicionales` > 0: la boleta no informa el ILA (es costo para el local que vende al público); se quita del producto |
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
| `LINEA_SIN_NOMBRE` | Del armado desde la venta (no del motor): una línea de la venta no tiene descripción; el motor la emitiría con `NmbItem` vacío y el SII la rechazaría al recibirla |

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
para que el admin lo cargue. Desde el subproyecto 4 la venta toma de aquí su folio, si el
interruptor del tenant está prendido ([La venta emite la boleta](#la-venta-emite-la-boleta)). Código: `backend/src/modules/dte/` (`perfil-fiscal.service.ts`, `folios.service.ts`,
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
dentro de la transacción de quien lo pide** (falla si no hay una activa): la venta lo llama **al
final** de la suya, respetando el orden de bloqueo de filas del proyecto
(`docs/patterns/backend.md`; ver "Bloqueos" en la sección de la venta). Este método bloquea una sola fila, la del CAF.

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
necesitar. La ruta es solo del admin del tenant: un cajero recibe 403, así que ese aviso lo trae
`GET /dte/estado-emision` (ver "El estado para el cajero"), con su propio guard.
Son cuatro consultas fijas (emisor, certificado vigente, CAF e interruptor del tenant), sin importar
cuántos CAF haya.

- **Emisor** (`null` si no hay una preferida y habilitada), **certificado vigente** (firmante, RUT,
  `venceEl`) y **CAF** (tipo, rango, usados, restantes, ambiente, fecha, y `borrable`).
- `faltantes`, lo que impide emitir (`evaluarPerfil`, pura): sin emisor, RUT inválido, sin giro,
  comuna, dirección, ambiente o resolución, texto fuera de ISO-8859-1 o más largo de lo que admite
  el SII (nombre 100, giro 80, comuna 20, dirección 70), sin certificado o vencido, y sin folios
  de boleta (39) **del ambiente vigente**, y sin **proveedor de software** (`SIN_PROVEEDOR_SOFTWARE`,
  abajo). Esos límites se validan acá y no en el CRUD de razones
  sociales: una que no emite sigue aceptando 255.
- `avisos`, lo que conviene mirar ya: menos de **100** folios de un tipo (se suman todos sus CAF
  del ambiente vigente) o certificado que vence en menos de **30** días. Son constantes del
  módulo (`UMBRAL_FOLIOS`, `DIAS_AVISO_CERTIFICADO`); que sean configurables se decide cuando
  alguien lo pida.
- **Cambiar de ambiente** con CAF cargados no los borra: dejan de servir (el `tomarFolio` los
  ignora) y la pantalla los muestra como de otro ambiente. Es el paso normal al terminar la
  certificación.

### El interruptor y el proveedor de software

- **`emisionActiva`** (en `GET /dte/perfil`) es `tenants.emite_boleta_electronica`: con él encendido,
  cada venta con documento del sistema emite su boleta. `PATCH /dte/emision { activa }`
  (`TenantAdminGuard`) lo cambia; **encender** exige un perfil sin faltantes (400 con *"Para emitir
  falta: …"* y la lista `faltantes`), **apagar** no pregunta nada. Nace apagado.
- **El proveedor de software** (`RutProvSW` / `RznSocProvSW` de cada boleta) es la empresa dueña del
  SaaS, una sola para todos los tenants: no está en la base sino en `DTE_PROVEEDOR_RUT` y
  `DTE_PROVEEDOR_RAZON_SOCIAL`. `PerfilFiscalService.proveedorSoftware()` las lee en cada llamada
  (el RUT normalizado) y devuelve `null` si falta alguna o el RUT no es válido; entonces el perfil
  trae `SIN_PROVEEDOR_SOFTWARE`. En `.env.example`, compose y e2e valen datos de prueba; **en
  producción el dueño carga los reales en Railway**.
- **Medio de pago:** `metodos_pago.medio_pago_sii` (campo 10 del formato: efectivo 1, tarjetas 2,
  transferencia 3) lo siembra el seeder, también en las bases que ya tenían los métodos.

### Permisos y pantalla

- Las rutas de `/dte` que usa la pantalla (`perfil`, `emision`, `certificado`, `cafs`,
  `boletas-sin-emitir`, `emitir-pendientes`) llevan `TenantAdminGuard` (configuración del tenant, no
  un módulo RBAC) y el `tenant_id` sale del token.
- **La ve todo admin del tenant**, en el menú de Configuración y en la ruta (spec `2026-10-14-boleta-desde-la-venta` § 8.3):
  desde que la venta emite su boleta, prender la emisión y emitir las pendientes es del dueño del
  local. Hasta entonces el ítem era solo del superadmin.
- `/configuracion/boleta-electronica`, de arriba abajo:
  - **Interruptor "Emitir boletas electrónicas"** (`PATCH /dte/emision`). Con faltantes y apagado
    queda deshabilitado, con el texto `Para emitir falta: …` (el mismo del 400 del servidor); ya
    prendido se puede apagar siempre, aunque falte algo. Prender confirma (*"Desde ahora cada venta
    emite una boleta ante el SII."*); apagar no. El 400 del servidor se muestra tal cual.
  - Lo que falta para emitir, y tres tarjetas: emisor (giro, comuna, ambiente y resolución se editan
    acá; nombre, RUT y dirección, de solo lectura con link a Razones sociales), certificado (firmante,
    vencimiento, subir o reemplazar; nunca muestra la clave) y folios (tabla de CAF, subir, y borrar
    solo en los sin folios usados).
  - **"Boletas sin emitir"**: fecha, monto, el motivo tal como lo manda el servidor (con una pista:
    *"Se arregla en el perfil (o con soporte, si el motivo lo dice)…"* si es del perfil, *"No se puede emitir."* si es de esa boleta) y
    link a la venta (`/ventas?venta=…`). El botón **"Emitir pendientes"** (`POST /dte/emitir-pendientes`)
    corre una sola tanda a la vez —queda deshabilitado mientras corre—, muestra `N emitidas`, cuántas
    siguen sin emitir y los errores con link a su venta, y vuelve a pedir la lista y el perfil.
    Con la lista vacía: *"No hay boletas sin emitir."*

### Pruebas

Unitarias (`perfil-fiscal.spec.ts`, `perfil-fiscal.service.spec.ts`, `folios.service.spec.ts`,
`cifrado-dte.service.spec.ts`), e2e contra Postgres real (`backend/test/dte-perfil.e2e-spec.ts`,
`dte-folios.e2e-spec.ts`: 20 `tomarFolio` en paralelo dan 20 folios distintos y consecutivos,
rollback que devuelve el folio, paso al CAF siguiente, ambientes y tenants cruzados, ninguna
respuesta con un blob) y Playwright de la pantalla (`frontend/e2e/configuracion/boleta-electronica.spec.ts`,
y `emision-boletas.spec.ts` para el interruptor y la lista, como `admin.paris`: admin del tenant,
no superadmin).
Las reglas de subida y de `evaluarPerfil` se revisaron con mutantes: los fixtures evitan el 1 y los
rangos que empiezan igual.

### Decidido por el owner (2026-10-14, por AskUserQuestion)

- **Una razón social que ya emitió queda fija** y no hay ruta para quitar el certificado vigente
  ni un CAF usado. Un RUT distinto es otro contribuyente ante el SII: para cambiar de RUT se crea
  otra razón social y se la marca preferida, y lo emitido conserva su rastro.
- **Nombre del ítem:** el catálogo valida al crear y al editar (80 caracteres en ISO-8859-1). Los
  ítems que ya no cumplen no se corrigen solos: el motor los rechaza al emitir y la boleta queda
  `sin_emitir` con el motivo, que ve el cajero al cobrar y el admin en "Boletas sin emitir". Con un
  carácter inválido el motivo trae el nombre del producto (`NmbItem de la línea N tiene un carácter
  que la boleta no admite …: "nombre"`); con un nombre demasiado largo dice solo `NmbItem de la
  línea N admite 80 caracteres y trae M`, sin el nombre.
- **ILA y adicionales (2026-10-14, por AskUserQuestion, después de leer la
  [investigación](../agent/investigaciones/2026-10-14-ila-en-boleta-electronica.md)):** para el
  local que vende al público **el ILA es costo, no un impuesto de su venta** (DL 825 art. 43 inciso
  final; Circular 26/2021 § 12: la boleta del minorista no da cuenta separada del ILA). El ítem no
  lleva adicional y la boleta sale con neto = total / 1,19. El rechazo
  `IMPUESTO_ADICIONAL_NO_SOPORTADO` deja de ser "falta definir" y pasa a ser la regla. Se eligió
  frente a "solo documentarlo" (sin aviso), "consultar al contador primero" y "soportar también al
  afecto". Lo que viene después está en pausa: el ILA en el catálogo del sistema, habilitable por tenant
  (`docs/agent/desarrollo-nuevo.md`). Lo que no cubre:
  el contribuyente **afecto** que vende al público (productor, importador, brewpub) no puede emitir
  boleta con ILA; su salida es la factura, que es otro frente.

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
  lectura no bloquea nada. Lo decidió el subproyecto 4 (ver "La venta emite la boleta"): no se
  agrega un bloqueo de la razón social en cada venta; `AMBIENTE_DISTINTO` deja la boleta
  `sin_emitir` y las credenciales salen de la razón social del CAF, así que emisor, CAF y
  certificado son siempre del mismo RUT.
- **El aviso al cajero** (pocos folios, certificado por vencer) lo resolvió el subproyecto 4: ruta
  propia, `GET /dte/estado-emision` ("El estado para el cajero").
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

Subproyecto 3 de 6 (hecho el 2026-10-14). Lleva al SII cada boleta que la venta emite,
**sin que la venta espere al SII**, y guarda qué contestó (aceptada, con reparos o rechazada, con
el motivo). `encolar` lo llama la venta desde el 2026-10-15 (subproyecto 4); con el interruptor de
cada tenant apagado, que es el default, las dos tablas siguen vacías. Código en `backend/src/modules/dte/`:
`cola-dte.service.ts`, `sii-boleta.cliente.ts`, `resultado-sii.ts` y los dos jobs de `jobs/`.
**Fiscal: frente propio** (ADR-010). La spec y el plan se borraron al terminar (la historia queda
en git); lo durable está acá. Desde el 2026-10-15 el job de envío valida el sobre contra el
esquema antes de mandarlo y el de consulta lee los cuatro estados por boleta del SII (subproyecto
4, frente 3; ver [Boletas con problemas](#boletas-con-problemas)).

- **No incluido** (cada cosa tiene su dueño):
  - reemitir una boleta rechazada: espera dos respuestas del SII (ver [Boletas con
    problemas](#boletas-con-problemas));
  - la consulta de una boleta individual (`/boleta.electronica/{rut}-{dv}-{tipo}-{folio}/estado`);
  - el envío al cliente por correo o QR;
  - la certificación ante el SII (subproyecto 5).
- **Plazo legal:** la boleta se envía "inmediato, máximo 1 hora". Sin conexión se genera igual, y
  la hora corre desde que vuelve (Res. 74, F.6).

### Decidido por el owner (2026-10-14, por AskUserQuestion)

- **Quién se entera de un rechazo:** queda registrado en la boleta; la pantalla y el aviso los hizo
  el frente 3 del subproyecto 4 ([Boletas con problemas](#boletas-con-problemas)). Se descartó una
  lista desde el primer día: habría estado siempre vacía, porque nadie emitía.
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
`eliminado_el IS NULL`). La condición vive en un solo lugar, `problemas-sii.ts`, y la fijan
`problemas-sii.spec.ts` y el bloque *boletas con problemas* de
`backend/test/boleta-desde-la-venta.e2e-spec.ts` (una boleta de hace 61 minutos entra, una de hace
10 no). El e2e de `dte-cola.e2e-spec.ts` trae su propia copia del SQL. Incluye a la boleta que quedó `enviado` sin resultado (un 404 de 24 horas, un código que no se entendió, una caída entre
el `ok` y el trackid): se ve atrasada y alguien la revisa.

### Encolar

`ColaDteService.encolar(tenantId, boleta, cafId) → { documentoId }` es lo único que el módulo
expone para la venta. **Exige una transacción activa** (`TxContext.managerActivo()`), igual
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
   arma el sobre con `armarEnvioBoleta`, **lo valida contra el esquema del SII** (ver [Antes de
   enviar: el esquema](#antes-de-enviar-el-esquema)) y lo manda con `SiiBoletaCliente`.
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
| El sobre no cumple el esquema | No se envía: la boleta mala pasa a `rechazado` y las demás vuelven a la cola sin espera (ver [Antes de enviar: el esquema](#antes-de-enviar-el-esquema)) |
| El proceso se cae a mitad | La reserva vence y el paso 1 del siguiente tick devuelve las boletas a `pendiente` |

**La espera creciente es por boleta, sin tope de intentos:** tras el intento que falló, 30 s, 1,
2 y 5 minutos, y de ahí **cada 10 minutos** (`espera(n)` en el job es la única fuente de la escala).
La boleta que choca con el límite del SII cuenta ese intento: no se agrega una espera aparte.

### Antes de enviar: el esquema

Según una fuente secundaria (ver la
[investigación](../agent/investigaciones/2026-10-15-boleta-rechazada-o-atrasada.md) § 7), una boleta
mal formada hace que el SII rechace el sobre entero (`RSC`), y eso dejaría `rechazado` a las otras
que iban con ella. Por eso el job valida el sobre firmado contra el esquema del SII
**antes** de `cliente.enviar`, y la boleta mala no sale. El esquema es el mismo que usan las
pruebas del motor (`esquemas/EnvioBOLETA_v11_formato42.xsd` con `xmldsignature_v10.xsd`, con la
única corrección en memoria del `PctType`). Código: `esquema-sii.ts` (`revisarSobreBoleta`) y
`descartarPorEsquema` en `enviar-boletas.job.ts`.

1. Se valida el sobre. Si pasa, sigue como siempre.
2. Si no pasa, se valida el sobre **sin ningún `<DTE>`**: con la carátula buena libxml solo dice que
   falta un `<DTE>`. Si dice otra cosa, el error es de la carátula, que viaja con cada boleta, y
   ninguna se puede señalar. Esto depende del texto de libxml: por eso `xmllint-wasm` va fijo en
   5.3.0 y un test (`esquema-sii.spec.ts`) cae si el texto cambia.
3. Con la carátula buena se valida cada `<DTE>` envuelto en el mismo sobre (la carátula y la firma
   del sobre real: el XSD mira la forma de la firma, no la verifica).
4. Las que fallan solas pasan a `rechazado` con `detalle_sii = { origen: 'esquema', errores }`
   (hasta 5 mensajes de hasta 300 caracteres) y sin `envio_id`. Las demás vuelven a `pendiente`
   **sin espera y sin sumar intento**: no hicieron nada. El sobre se da de baja, porque para el SII
   nunca existió, y el SII no se llama.
5. **Se rechazan todas** siempre que no se pueda señalar ninguna boleta: el error es del sobre (la
   carátula, la firma del sobre) o una boleta inválida no calza, por `(tipo, folio)`, con ninguna
   fila del lote. Volver a la cola armaría el mismo sobre para siempre.
   Es un error nuestro, como el 400 del envío.

- **Orden en la transacción:** primero el envío (`DAR_DE_BAJA_ENVIO`), después las boletas. Es el
  mismo orden que `devolver()`, `rechazar()` y `DEVOLVER_RESERVAS_VENCIDAS`; al revés, la barrida
  de reservas vencidas de otra instancia se cruzaría con esta transacción y habría un ciclo de
  bloqueo.
- **Costo medido:** ~33 ms por validación, casi todo compilar el esquema. Un sobre que pasa cuesta
  una validación; uno que falla, la del sobre, la de la carátula y una por boleta. Lo medido son los
  ~33 ms por validación; para un lote de 50 son 52 validaciones, ~1,7 s por cálculo (52 × ~33 ms),
  contra los 5 minutos de la reserva. Es del job, no de la venta.
- **Memoria:** `xmllint-wasm` tiene 32 MiB; un sobre de ~10 MB rechaza la promesa. Llegar ahí con
  el lote máximo de 50 boletas es improbable: haría falta ~200 KB por boleta, y el motor no limita
  las líneas. Un error del validador que no es un resultado (el wasm se
  cae) se propaga como error de programación y la reserva vence sola.
- **Producción:** `Dockerfile.prod` copia solo `dist/` e instala con `npm ci --omit=dev`. Por eso
  `xmllint-wasm` está en `dependencies` (owner: sí, en el job de envío) y `nest-cli.json` copia
  `modules/dte/esquemas/*.xsd` en `assets`. Sin cualquiera de las dos el job revienta en
  producción y no en desarrollo.
- **Riesgo:** se valida contra **nuestra** copia del esquema, con los cinco campos del formato
  v4.2 que el v11 del SII no trae. Si la copia está mal, rechazaríamos boletas que el SII
  aceptaría. Es la misma copia contra la que pasan todas las pruebas del motor; solo la
  certificación lo confirma.

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

- El SII define **cuatro estados por boleta** (OpenAPI v1.0.5, `detalle_rep_rech.estado`, y se
  leen los cuatro desde el 2026-10-15):

| Estado por boleta | La boleta queda |
|---|---|
| `DOK` (aceptada) | `aceptado`, con `detalle_sii` null |
| `RPR` (aceptada con reparos) | `reparos`, con la entrada en `detalle_sii` |
| `RLV` (aceptada con reparos leves) | `reparos`, igual que `RPR` |
| `RCH` (rechazada) | `rechazado`, con la entrada en `detalle_sii` |

- Si una boleta trae varias entradas manda la peor: `RCH` > `RPR`/`RLV` > `DOK`. Antes, `RLV` y
  `DOK` contaban como código desconocido: la boleta quedaba `enviado` para siempre y se habría visto
  atrasada aunque el SII la aceptó.
- **El `DOK` es una aceptación explícita de esa boleta, no silencio.** Un `DOK` con folio propio la
  deja `aceptado` aunque otra entrada del sobre no se entienda, **salvo** que alguna entrada de esa
  misma boleta (un comodín sin folio incluido) traiga un estado fuera de los cuatro: lo desconocido
  cuenta como lo peor. Un `DOK` sin folio no acepta a nadie: es una observación (aviso en el envío),
  no un comodín de aceptación. Consecuencia: un código desconocido sin folio bloquea el `DOK` de
  todas las boletas del sobre, que quedan `enviado` con el aviso. Un `estado` que no es texto
  (`['RCH']`) no se lee como `RCH`: es una observación.
- Sin entrada propia, la boleta queda `aceptado` **solo si el SII no dejó observaciones**
  (ninguna entrada sin boleta, ningún código desconocido, ningún `DOK` sin folio, ninguna lista
  ilegible); si las dejó, queda `enviado` con el aviso en `ultimo_error` del envío. Un `DOK` sin
  folio cuenta como observación porque no nombra a qué boleta se refiere: aceptar por él sería
  aceptar a ciegas.
- Un envío sin boletas vivas (todas borradas o reasignadas) sale de la consulta con
  `ultimo_error` "El envío no tiene boletas vivas que consultar" y sin reintento: sin boletas no
  hay certificado con qué descifrar, así que reintentar no lo arregla.
- Una entrada con `folio` ausente o null (error de esquema o de firma) alcanza a **todas** las
  boletas del sobre.
- El detalle completo del SII queda en `respuesta_sii` del envío; en la boleta, la entrada que le
  tocó.

#### Decidido por el owner (2026-10-14): lo que no entendemos no se acepta

El agente las tomó como provisionales al construir la cola, porque se apartan de la spec ("ausente →
aceptado"), y **el owner las confirmó el 2026-10-14** por AskUserQuestion, eligiéndolas frente a
"aceptarlas como decía la spec" y "el código raro cuenta como reparos". La razón: nunca aceptar por
ausencia cuando el SII habló de algo que no entendimos; el costo es que, en el caso raro, alguien
revisa esas boletas a mano.

- **Entrada con un código desconocido:** una entrada de `detalle_rep_rech` cuyo código no es
  `DOK`, `RPR`, `RLV` ni `RCH` **no es un reparo** (`reparos` es "aceptada con observaciones"). La
  boleta queda `enviado` (atrasada a la vista) y el envío lleva `ultimo_error` para revisión. Una
  entrada de uno de esos cuatro estados que no calza con ninguna boleta del sobre también deja
  `ultimo_error`. (El 2026-10-15 `DOK` y `RLV` salieron de los desconocidos: el owner decidió leerlos
  según el OpenAPI; ver [Boletas con problemas](#boletas-con-problemas).)
- **Boletas sin entrada cuando el SII dejó observaciones:** si hay una entrada de los cuatro
  estados sin boleta que calce, o un `detalle_rep_rech` presente que no es una lista, las boletas **sin entrada
  propia no pasan a `aceptado`**: quedan `enviado` con el aviso. Las que sí tienen entrada se
  reparten igual. Un código de sobre fuera de los conocidos deja `ultimo_error` y se consulta sin
  plazo.

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
  iguales; los cuatro estados por boleta, la prioridad y el `DOK` explícito en
  `resultado-sii.spec.ts`), del cliente y de los dos jobs. La validación previa:
  `esquema-sii.spec.ts` (un sobre bueno pasa, un `<DTE>` roto se aísla envuelto solo, un error de
  carátula deja `invalidos` vacío, los errores se recortan) y `enviar-boletas.job.spec.ts` (la
  rota queda `rechazado` con origen `esquema`, las buenas vuelven sin espera ni intento sumado y el
  cliente del SII no se llama).
- **e2e con base real** (`backend/test/dte-cola.e2e-spec.ts`): encolar sin transacción tira; encolar
  y hacer rollback no deja nada; dos `enviarLotes` a la vez no mandan la misma boleta (`SKIP
  LOCKED`); la reserva vencida vuelve las boletas a `pendiente`; el lote sale a las 50 o a los 5
  minutos y no antes; un 405 pausa; una boleta con más de 1 hora se lee atrasada; una boleta que
  no cumple el esquema queda rechazada sola y las buenas salen en el sobre siguiente; de punta a punta
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
- **Boletas que quedan `enviado` por observaciones (la decisión del owner de arriba) o por un 404 de 24 horas requieren
  revisión de una persona.** El motivo está en `ultimo_error` del envío y en `respuesta_sii`. Pasada
  la hora, la boleta sale como atrasada en la lista del admin y en el panel de soporte ([Boletas con
  problemas](#boletas-con-problemas)), pero el aviso del envío queda solo en `dte_envios.ultimo_error`:
  ninguna de las dos pantallas lo muestra.
- **Un código de sobre desconocido se consulta sin plazo**, con el aviso en `ultimo_error`. Si el
  SII nunca lo cambia, el envío se consulta cada 5 minutos para siempre.
- **Un `DteError` al armar el sobre** (por ejemplo un XML que el motor ya no acepta) reintenta cada
  10 minutos sin alerta. Pasada la hora la boleta sale atrasada en la lista del admin y en el panel
  de soporte, con el mensaje del error como motivo.
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

## La venta emite la boleta

Subproyecto 4, frente 1 (spec `2026-10-14-boleta-desde-la-venta`, borrada al terminar; la historia queda en git).
Con el interruptor del tenant encendido (`PATCH /dte/emision`), cada venta cuyo documento del
sistema es una boleta sale con folio, timbrada, firmada y en la cola de envío. Con el interruptor
apagado (el default) no cambia nada.

### Quién emite y cuándo

`EmisionBoletaService.emitir(tenantId, ventaDocumentoId, ahora)` (módulo `venta-documentos`, que
ahora importa `DteModule`; `dte` no importa nada de ventas, así que no hay ciclo). Una sola función
emite: la venta al crearse y el botón de las pendientes (abajo). La llama
`crearEnTransaccion` **al final**, después de stock, caja, pagos y `documentarVenta`, si
`tenants.emite_boleta_electronica` y `documentoAEmitir(docs, tipoEsBoleta)` devuelve un documento
(el del emisor `sistema`, de tipo boleta, vigente y que no sea un duplicado; a lo sumo uno, ADR-028).
Como todos los caminos que crean ventas pasan por `crearEnTransaccion`, un solo lugar cubre el POS,
el cierre de mesa, el callback de la tienda y el alta de suscripción.

Los pasos, todos en la transacción de la venta y detrás de `Db.conSavepoint('emision_boleta', …)`:

1. Lee en consultas fijas (ninguna por línea ni por pago): el documento (`FOR UPDATE`), la venta
   con el umbral de identidad **del año de la venta**, las líneas con su tasa de IVA, los
   adicionales, el receptor y los pagos que cubre ese documento (`pagos.documento_id`) con su
   `medio_pago_sii`. Si el documento no existe, ya no está `armado`/`sin_emitir` o tiene descarte,
   devuelve `{ estado: 'omitido' }` y no toca nada (lo usa el botón): `omitido` es solo "ya no
   está por emitir". Que el documento sí esté por emitir pero no sea una boleta del sistema, o
   le falte la venta, el comercio o el país, **lanza `Error`** (un bug de quien lo pidió, no un dato
   del local): disfrazarlo de `omitido` haría que el botón lo diera por "ya emitida".
2. `tomarFolio` → `credencialesParaFirmar` → `emitirBoleta` (con `datosBoletaDeVenta`, que arma los
   datos desde lo congelado) → `encolar`. La fecha de la boleta es la de la venta en la hora de
   Chile, aunque se emita después; el `ahora` de la firma es el del momento.
3. Marca el documento `emitido` con su `dte_documento_id`.

### Qué hace un error

- **Un `DteError`** (sin folios, sin certificado, certificado vencido, un dato que el motor
  rechaza) vuelve al savepoint —el folio que ya se había tomado vuelve— y **recién después** marca
  el documento `sin_emitir` con `emision_error_codigo` y `emision_error`. La venta entra igual
  (decisión del owner). Se escribe fuera del savepoint porque lo escrito dentro se deshace con él.
- **Cualquier otro error se propaga** y la venta se cae con su folio (regla R9 de la cola): un
  fallo de la base o de la cola no es un dato de la boleta, y tragarlo dejaría una venta sin
  boleta que nadie ve.
- **Una venta que se cae después de emitir** (cualquier cosa posterior en la misma transacción)
  deshace también el folio y la fila de la cola: nunca queda un hueco que anular ante el SII.

### Bloqueos

El bloqueo del CAF que toma `tomarFolio` dura hasta el commit. Por eso la emisión va **al final**:
ningún camino bloquea el CAF y después otra fila, así que no se forma un ciclo con el orden de
filas de la venta ni con el de las tablas del catálogo. Las ventas con boleta de un mismo local se
serializan en ese último tramo (ver "Lo que queda abierto"). Un deadlock (`40P01`) lo reintenta `crear`, y el folio volvió con
el rollback.

### La respuesta y el ticket

`BoletaVenta` (la respuesta de `POST /ventas`, del cierre de mesa y de `GET /ventas/:id/boleta`)
suma, leídos de la base por `armarBoleta` en **una** consulta:

- `boletaElectronica`: `{ tipo, folio, monto, cubreTodo, ambiente, resolucion: { numero, fecha },
  emisor: { rut, razonSocial, giro, direccion, comuna } }`, o `null`. El emisor es el de la
  boleta (la razón social de su CAF), no la preferida de hoy, y se lee aunque esa razón social se
  haya dado de baja después. `monto` es el del documento: con `cubreTodo = false` (pago mixto con
  la máquina) es el saldo.
- `boletaSinEmitir`: `{ mensaje }` si debía emitirse y no se pudo, o `null`.

La respuesta se guarda con la `Idempotency-Key` **después** de emitir: el reintento devuelve el
mismo folio.

**El ticket** (detalle en [`impresion-termica.md`](./impresion-termica.md)) imprime `BOLETA
ELECTRÓNICA N° folio`, el emisor de la boleta y `Res. N° X de AAAA`; en certificación agrega
`CERTIFICACIÓN - SIN VALIDEZ`. Dos lecturas que conviene saber: el **emisor** es la razón social del
CAF con que se tomó el folio (no la preferida de hoy), y la **resolución** se lee de esa razón
social **al imprimir**, no se congela en la boleta. Si la empresa pasa de certificación a producción,
reimprimir una boleta de certificación mostraría la resolución nueva: se acepta, esas boletas no
tienen validez.

### Emitir después: el botón

`POST /dte/emitir-pendientes` y `GET /dte/boletas-sin-emitir` (`TenantAdminGuard`; el `tenant_id`
sale del token, ninguna recibe body). Viven en `EmisionBoletaController`, del módulo
`venta-documentos` y no en `DteController`: ese es del módulo `dte`, que no puede importar a
`venta-documentos`, y lleva el guard de admin a nivel de clase. Comparten el prefijo `/dte`.

- **La lista** (`GET`): `{ ventaId, fecha, monto, codigo, mensaje, grupo }[]`, del documento más
  viejo al más nuevo, hasta 200, en **una** consulta (el predicado del índice parcial
  `idx_venta_documentos_sin_emitir` más la venta viva). `mensaje` es el del `DteError`, tal cual:
  lo lee el admin. `grupo` es `grupoDelError(codigo)`: `perfil` (lo arregla el admin: sube un CAF,
  renueva el certificado) o `boleta` (un dato de esa venta).
- **El botón** (`POST`): lee la misma lista y procesa **de a una**, cada una en su propia
  transacción: primero el bloqueo de su venta (`SELECT … FOR UPDATE`, el mismo de
  `VentasService.lockVentaOriginal` que usan anular y la nota de crédito; es un SQL duplicado a
  propósito porque este módulo no puede importar a `VentasService`) y después `emitir`, que vuelve
  a mirar el documento con `FOR UPDATE`. El orden es venta → CAF, igual que al vender. Una
  anulación en paralelo o espera al botón o ya ganó: el documento quedó descartado y `emitir` lo
  omite (`omitido` no suma ni es un error).
- **Un error del grupo `perfil` corta, salvo `SIN_FOLIOS`** (`SIN_CERTIFICADO`,
  `CERTIFICADO_VENCIDO`, `PERFIL_INCOMPLETO`, `AMBIENTE_DISTINTO`): las que siguen fallarían igual.
  `SIN_FOLIOS` se anota y sigue, porque los folios son por tipo y la siguiente puede ser de otro
  (una exenta pide CAF 41, una afecta CAF 39). **Uno del grupo `boleta` también se anota y sigue**
  (un impuesto adicional, un texto que no cabe).
- Responde `{ emitidas, pendientes, errores: [{ ventaId, codigo, mensaje }] }`; `pendientes` es un
  `count` de lo que sigue `sin_emitir` al terminar. Un error que no es un `DteError` se propaga (R9):
  las que ya salieron quedaron confirmadas. Procesar de a una es escritura de N filas, no una
  lectura N+1.
- La fecha de cada boleta es la de su venta (`FchEmis`), no la de hoy.

### El estado para el cajero

`GET /dte/estado-emision` lo lee quien vende: `JwtAuthGuard, TenantGuard, PermisosGuard` y
`@RequiresPermiso('Ventas', 'Crear')`, **sin** `TenantAdminGuard` (`GET /dte/perfil` es de admin y
el cajero recibe 403 ahí). Devuelve `{ activa, avisos: [{ codigo: 'POCOS_FOLIOS' |
'CERTIFICADO_POR_VENCER', mensaje }], sinEmitir, conProblemas }` (`conProblemas`: ver [Boletas con
problemas](#boletas-con-problemas)). Los avisos son los que calcula el perfil
(`UMBRAL_FOLIOS` 100, `DIAS_AVISO_CERTIFICADO` 30), solo código y mensaje: nada del emisor ni del
certificado. Con la emisión apagada responde `activa: false`, `avisos: []`, `sinEmitir: 0` y
`conProblemas: 0` (un local que no emite no ve la franja). Con la emisión apagada es una sola consulta (el interruptor, sin armar el perfil: el POS lo lee tras cada cobro). Prendida son consultas fijas: el interruptor, el perfil (cuatro) y una consulta con las dos cuentas (`sinEmitir` y `conProblemas`).

### Lo que ve el detalle de la venta

`documentos[]` del `GET /ventas/:id` suma, desde la misma consulta (dos `LEFT JOIN`, sin una
consulta por documento): `folio` y `estadoSii` (el `estado` de su fila en `dte_documentos`),
`emisionError` (el motivo de un `sin_emitir`) y `ncElectronicaPendiente` (una corrección `sistema`
cuyo `documento_corregido_id` apunta a una boleta `emitido`; ver
[`reembolsos-nota-credito.md`](./reembolsos-nota-credito.md)). Anular una `sin_emitir` se permite y
la descarta como a una `armado`; una `emitido` da 400 (*"La boleta ya se emitió: se revierte con
una nota de crédito, no se anula."*).

### Pruebas

Unitarias: `Db.conSavepoint` (`db.spec.ts`), `documentoAEmitir` y `emitir` con las sentencias
reales del savepoint (`emision-boleta.service.spec.ts`), y el cableado en la venta
(`ventas.service.spec.ts`: interruptor, orden, `armarBoleta`). e2e contra Postgres
(`backend/test/boleta-desde-la-venta.e2e-spec.ts`): POS, idempotencia, interruptor apagado, factura
y facturador externo, exenta (41), sin folios, sin certificado (el folio tomado vuelve), la cola
que se cae, una venta que se cae después de emitir, 10 en paralelo, la venta de $0 por descuento,
descuento de línea + de venta + granel, pago mixto con la máquina, cierre de mesa (con folios, con
el CAF agotado y con deuda), callback de la tienda, alta de suscripción, la reimpresión y, de
emitir después: la lista y el botón con el CAF agotado (anota las 3 y no corta) y con uno nuevo
(emite las 3 con la fecha de su venta), la exenta sin CAF 41 más vieja que dos afectas (el botón
emite las dos y deja la exenta con `SIN_FOLIOS`), el error de una boleta que no corta, la **anulación en paralelo** (un query
runner retiene la fila de la venta, el botón queda esperando según `pg_blocking_pids`, la
anulación gana y el botón no emite: se usa SQL y no la ruta de anular porque esa pide el mismo
bloqueo desde otra conexión), anular una `sin_emitir` y una `emitido`, la nota de crédito sobre
una venta emitida y sobre una que no, el aviso del cajero (200, `POCOS_FOLIOS`, apagado) y los 403.
Playwright: `frontend/e2e/configuracion/emision-boletas.spec.ts` (el interruptor, la lista y el
botón, como admin de un local) y `frontend/e2e/ventas/boleta-electronica-pos.spec.ts` (el cobro del
POS con la emisión prendida, el folio en la boleta y la franja); el papel se verifica en los
unitarios porque QZ Tray no corre en CI.
Antes de cada caso del botón se descartan por SQL las `sin_emitir` que dejaron otros tests: el
botón emite todas las del tenant.
Mutantes (revertidos con `cp` y `cmp`): sin savepoint, atrapar cualquier error, el umbral con
`now()`, el IVA mal leído de `ventas_impuestos`, `conSavepoint` sin `ROLLBACK TO` y la factura
emitida como boleta; del botón: sin el `FOR UPDATE` de la venta, cortar también con el grupo
`boleta`, volver a cortar con `SIN_FOLIOS` y `estado-emision` con `TenantAdminGuard` (los cuatro caen). El umbral del año de la venta solo lo ve un test unitario: el e2e emite en el
mismo año de la venta, y la diferencia aparece recién al emitir después (el botón).

### Lo que queda abierto

- **La nota de crédito electrónica (tipo 61)** y su envío por el canal de facturas son el frente 2,
  **en pausa** (owner, 2026-10-15) hasta que el SII o un contador digan si un local que solo emite
  boletas puede emitirla con software propio: el SII lo manda a su portal y reserva el software al
  facturador ([investigación](../agent/investigaciones/2026-10-15-nota-credito-sobre-boleta.md)).
  Mientras tanto la nota ante el SII se hace en el portal, y el detalle de la venta marca la
  corrección con *NC electrónica pendiente*.
- **Documento parcial sobre 135 UF** (pago mixto con la máquina): sale con la línea de saldo, y el
  SII pide ahí la descripción de los productos. No se resolvió.
- **El plazo del SII para recibir una boleta con fecha pasada** no se investigó. La que se emite
  después (el botón) lleva la fecha de su venta, por decisión del owner.
- **Contención del CAF por tenant.** El bloqueo del CAF dura hasta el commit, así que las ventas con
  boleta de un mismo local se serializan en el último tramo de la transacción. En un cierre de
  mesa el tramo es más largo (cierra el tramo vigente y guarda después de emitir). Se mide si
  aparece en producción.
- **Dos fuentes de zona horaria.** El umbral de identidad de 135 UF usa la zona de la provincia del
  local (`zona_horaria`) para el año de la venta; `FchEmis` usa `America/Santiago` fijo. Si no
  coinciden, una venta cerca de la medianoche de fin de año se mide contra el umbral de un año y
  se fecha en otro.
- **El documento "veneno" del botón.** Un error que no es `DteError` en el primer documento de la
  lista da 500 en cada clic y frena a los que siguen: no se traga un bug (R9), pero una boleta mala
  bloquea todas las pendientes hasta que se arregle. Parecido: 200 documentos del grupo `boleta` que
  fallan siempre cubren a los posteriores, porque la lista es de hasta 200 y ese error no corta.
- **La resolución del ticket se lee al imprimir** (ver "La respuesta y el ticket"): un cambio de
  certificación a producción cambia las reimpresiones de las boletas de certificación.
- **El emisor del ticket sale de la razón social del CAF**, no de la preferida: si el local cambió de
  razón social, las reimpresiones siguen mostrando la del folio, que es la correcta ante el SII.
- **Prender/apagar no deja quién lo hizo** (ninguna ruta de `/dte` audita) ni bloquea la fila
  mientras valida; la emisión revalida el perfil al emitir, así que no emite sin lo necesario.
- **Certificación (subproyecto 5):** hasta que el SII reciba boletas de verdad, nada de lo emitido
  tiene validez.
- **`SIN_FOLIOS` ya no corta el botón.** El costo: con los CAF de los dos tipos agotados, el botón
  hace hasta 200 intentos rápidos que fallan, en vez de uno.
- **Una `sin_emitir` del grupo `boleta` no tiene salida** salvo anular la venta, y la franja del
  cajero no baja mientras exista. El frente 3 no lo cambió.
- **El toast del cajero muestra el mensaje crudo del motor**, que puede ser técnico.
- **Una NC sobre una venta `sin_emitir` que se emite después** sale por el total original, y la marca
  *NC electrónica pendiente* aparece en la corrección.
- **Varios `POST` del botón en paralelo cargan el pool**: el front lo deshabilita mientras corre, el
  backend no lo impide.
- **`.env.example` y `docker-compose` traen valores de prueba de `DTE_PROVEEDOR_*`**; Railway necesita
  los reales antes de prender el interruptor.
- **La confirmación del interruptor no avisa que en certificación nada tiene validez.**
- **Un hueco heredado de la regla 2 del motor:** una línea sin cantidad ni precio con
  `DescuentoMonto` explicaría un total de $0. El armado desde la venta nunca la arma así.
- **Residuos de Playwright en la base local** (razones sociales 'Emisor e2e POS', 'Emisor e2e
  pantalla' y 'Emisor e2e interruptor', con CAF usados): no se limpian solas.

---

## Boletas con problemas

Subproyecto 4, frente 3 (hecho el 2026-10-15; spec `2026-10-15-boletas-con-problemas-design`,
borrada al terminar; la historia queda en git). **Fiscal: frente propio** (ADR-010). Antes, una
boleta que el SII rechazó, que llevaba más de una hora sin llegar o que volvió con reparos **solo
quedaba en la base**: nadie se enteraba. Ahora la ve el admin del local, el cajero recibe un aviso
y soporte (el superadmin) ve las de todos los locales. El frente arregla además dos fallas de la
cola que habrían hecho mentir a esas pantallas: los cuatro estados por boleta del SII y el sobre
que se rechaza entero por una boleta mala (ver [Envío al SII](#envío-al-sii)).

### Decidido por el owner (2026-10-15, por AskUserQuestion, tras la [investigación](../agent/investigaciones/2026-10-15-boleta-rechazada-o-atrasada.md))

- **Alcance:** la parte visible ahora; reemitir después (se descartó reemitir con supuestos y pausar
  el frente).
- **`RLV` y `DOK` por boleta:** leerlos según el OpenAPI (se descartó dejarlos como desconocidos).
- **El sobre que el SII rechaza entero por una boleta mala:** revisar cada boleta contra el esquema
  antes de enviar (se descartó reenviar las buenas de a una y dejarlo como estaba).
- **El validador (`xmllint-wasm` 5.3.0) a producción, y en el job de envío** (se descartó la venta,
  los dos lugares y no llevarlo).
- **Dónde avisar, además de la pantalla del admin:** la franja del cajero y el panel del superadmin.
- **Los reparos en la lista:** sí, los de los últimos 30 días.

### Qué es cada grupo

Se calcula al leer, nunca se guarda. Las condiciones viven en un solo lugar, `problemas-sii.ts`,
para que la lista, la franja y soporte cuenten lo mismo; cada consulta pone su
`eliminado_el IS NULL` en `dte_documentos`, `venta_documentos` y `ventas`.

| Grupo | Condición en `dte_documentos` |
|---|---|
| **Atrasada** | `estado IN ('pendiente','enviado') AND emitido_el < now() - interval '1 hour'` |
| **Rechazada** | `estado = 'rechazado'` |
| **Con reparos** | `estado = 'reparos' AND emitido_el >= now() - interval '30 days'` |

"Con problemas", lo que cuentan la franja del cajero y el panel de soporte, es **atrasada o
rechazada**. Con reparos es válida y no avisa.

### Las tres rutas

| Ruta | Guard | Qué devuelve |
|---|---|---|
| `GET /dte/boletas-con-problemas` | `TenantAdminGuard`: es configuración del módulo, no caja | `{ atrasadas, rechazadas, conReparos }`, hasta 200 por grupo |
| `GET /dte/estado-emision` (suma `conProblemas`) | `Ventas:Crear` | el conteo de atrasadas y rechazadas del tenant |
| `GET /admin/dte/boletas-con-problemas` | `JwtAuthGuard` + `SuperadminGuard`, como `/admin/tenants` | hasta 200 atrasadas y rechazadas de **todos** los tenants |

- **Lista del admin:** las atrasadas y las rechazadas van de la más vieja a la más nueva (lo que más
  urge, primero); las con reparos, de la más nueva a la más vieja. Cada fila: `documentoId`,
  `ventaId`, `tipo`, `folio`, `emitidaEl`, `monto` (string: `venta_documentos.monto`, lo que cubre la
  boleta, nunca pasa por `number`) y `motivo`. Son **tres consultas fijas**, una por grupo, con
  `LEFT JOIN` a `venta_documentos` y `ventas`. El `LEFT JOIN` es a propósito: una boleta del SII sin
  su documento de venta (no debería pasar) igual se muestra, con `ventaId` y `monto` en null, en vez
  de desaparecer justo cuando algo anda mal.
- **Franja del cajero:** `conProblemas` sale **en la misma consulta** que ya contaba las
  `sin_emitir` (dos subselects), así que no suma una ida a la base. Con la emisión apagada sigue
  siendo una sola consulta, la del interruptor, y devuelve 0. Los reparos no cuentan.
- **Panel de soporte:** es la única lectura del frente que cruza tenants, y la consulta lo dice. No
  recibe `tenant_id` de ningún lado. Una consulta, con `JOIN` a tenants vivos y `LEFT JOIN` a la
  razón social (la boleta se ve aunque la razón social esté dada de baja). Cada fila trae `tenantId`,
  nombre del local, razón social, ambiente, tipo, folio, `emitidaEl`, `grupo`, `intentos`,
  `ultimoError` y `detalleSii` **completo**: soporte necesita lo técnico.

### El motivo, en palabras del local

`motivoDe` (en `problemas-sii.ts`) lo arma desde `detalle_sii` y `ultimo_error`. Nunca lanza: el
detalle llega del SII sin validar. **El origen manda sobre el estado**: el rechazo del sobre entero
trae `estado: 'RCH'`, pero quien falló fue el sistema.

| Origen | Texto |
|---|---|
| `origen: 'esquema'`, `'sobre'` o `'envio'` | *"Error del sistema al enviarla al SII."* |
| Entrada `RCH` del SII | *"El SII la rechazó: {descripción del primer error}."* (sin error, la descripción de la entrada; sin ninguna, *"El SII la rechazó."*) |
| Entrada `RPR` o `RLV` | *"El SII avisa: {descripción del primer error}."* (sin ninguna, *"El SII la aceptó con reparos."*) |
| Atrasada | El `ultimo_error` de la boleta, o null |

### Las pantallas

- **Admin** (`configuracion/boleta-electronica`): la tarjeta *"Boletas con observaciones del SII"*,
  debajo de la de las sin emitir. Los grupos vacíos no se muestran; con los tres vacíos dice *"No hay
  boletas con observaciones."*. Cada fila: fecha, folio, tipo, monto, motivo y enlace a la venta. Un
  texto fijo por grupo: *"El sistema la sigue enviando; no tienes que hacer nada. Si pasa de un día,
  escribe a soporte con el folio."* (atrasadas), *"No la vuelvas a emitir: escribe a soporte con el
  folio."* (rechazadas) y *"Es válida. Revisa el aviso del SII para corregirlo en las próximas
  boletas."* (con reparos).
- **Cajero** (`FranjaEmision.vue`, la del POS y la de salones): con `conProblemas > 0`, *"Hay 1 boleta con
  problemas en el SII: avisa al encargado"* o *"Hay N boletas con problemas en el SII: avisa al
  encargado"*, sin punto final.
- **Soporte** (`pages/admin.vue`): la tarjeta *"Boletas con problemas en el SII"* con la tabla de
  todos los locales; el último error y el detalle del SII se despliegan por fila. Sin ninguna: *"Ningún
  local tiene boletas con problemas."*.
- **Si la lectura falla, ninguna de las dos tarjetas dice el vacío**: muestran *"No se pudo leer el
  estado de las boletas en el SII."* además del toast, porque "no hay problemas" sería mentira.
  Monto o motivo en null se muestran "—".

### Los índices

La migración `1792098507237-BoletasConProblemas.ts` (ADR-030; también en `startup-pos.sql`) agrega
dos índices parciales, porque el conteo del cajero corre después de cada cobro y el cruce de la
boleta con su venta no tenía ninguno:

- `idx_dte_documentos_problemas`: `dte_documentos (tenant_id, emitido_el)` donde
  `estado IN ('pendiente','enviado','rechazado') AND eliminado_el IS NULL`. **No cubre los
  reparos**: la lista de reparos no usa este índice, y no hace falta porque es una lectura del admin
  y no corre después de cada cobro.
- `idx_venta_documentos_dte`: `venta_documentos (dte_documento_id)` donde `dte_documento_id IS NOT
  NULL`.

Medido con `EXPLAIN`, con los índices competidores fuera y en una transacción revertida: el segundo
se usa en el `LEFT JOIN` y el primero es elegible para el conteo del cajero (un `BitmapOr` sobre el
`OR`). Con el seed chico el planner elige otro índice por empate de costo.

### Pruebas

- **Unitarias:** `resultado-sii.spec.ts` (los cuatro estados, la prioridad, el `DOK` explícito y el
  desconocido que no acepta), `esquema-sii.spec.ts` y `enviar-boletas.job.spec.ts` (la validación
  previa, ver [Antes de enviar: el esquema](#antes-de-enviar-el-esquema)), `problemas-sii.spec.ts`
  (las condiciones y una fila de `motivoDe` por origen), `emision-boleta.service.spec.ts` (la lista
  y el conteo del cajero) y `cola-dte.service.spec.ts` (la consulta de soporte). Frontend:
  `boleta-electronica.nuxt.spec.ts`, `FranjaEmision.nuxt.spec.ts` y `admin.nuxt.spec.ts`.
- **e2e contra Postgres** (`backend/test/boleta-desde-la-venta.e2e-spec.ts`, bloque *boletas con
  problemas*): cada grupo con su venta, monto y motivo; una con reparos de hace 31 días y una dada
  de baja que no aparecen; el admin de otro comercio ve las tres listas vacías; `conProblemas` cuenta
  atrasadas y rechazadas y no reparos ni recientes, y vale 0 con la emisión apagada; el panel de
  el superadmin, en otro tenant, ve las boletas de Paris, y un admin común recibe 403; el cajero recibe 403 en la lista del admin y la
  lista del admin da 401 sin sesión. El envío con una boleta que no cumple el esquema, de punta a
  punta, en `backend/test/dte-cola.e2e-spec.ts`.
- **Playwright:** `frontend/e2e/configuracion/boletas-con-problemas.spec.ts` (la tarjeta del admin),
  `frontend/e2e/ventas/boleta-electronica-pos.spec.ts` (la franja) y
  `frontend/e2e/tenants/soporte-boletas.spec.ts` (el panel, como superadmin). Playwright no llega a la
  base y no hay SII de verdad, así que las respuestas de las rutas se simulan con `page.route`; el
  contrato real lo fijan los e2e de la API.

```bash
cd backend && npm test -- modules/dte modules/venta-documentos
cd backend && npx jest --config ./test/jest-e2e.json test/boleta-desde-la-venta.e2e-spec.ts test/dte-cola.e2e-spec.ts
```

### Lo que queda abierto

- **Reemitir una rechazada** espera la respuesta del SII a las preguntas 1 y 2 de la
  [investigación](../agent/investigaciones/2026-10-15-boleta-rechazada-o-atrasada.md): si el folio de
  una rechazada se consume o se reutiliza, y con qué `FchEmis` sale el reemplazo. Hasta entonces la
  pantalla dice *"no la vuelvas a emitir: escribe a soporte"*.
- **Una rechazada no tiene salida**, así que mantiene la franja del cajero prendida hasta que exista
  reemitir: es el costo de avisar sin poder resolver.
- **Una `sin_emitir` del grupo `boleta`** sigue sin salida salvo anular la venta.
- **El panel de soporte ordena por fecha ascendente con tope de 200**: las rechazadas viejas (que no
  tienen salida) pueden tapar a las atrasadas nuevas pasadas las 200.
- **Un tenant dado de baja** no sale en el panel de soporte (el `JOIN` a tenants es a los vivos), y
  los jobs de envío no miran si el tenant está vivo, así que sus boletas se siguen enviando. Es una
  decisión de producto del owner, pendiente.
- **`venta_documentos.dte_documento_id` no es único.** Hoy es 1:1 por construcción; si dos documentos
  de venta apuntaran a la misma boleta, la lista del admin la mostraría dos veces.
- **La copia del esquema** (formato v4.2) es nuestra: si está mal, la validación previa rechazaría
  boletas buenas. Solo lo confirma la certificación.
- **Cómo declara el IVA** el local con una boleta rechazada o atrasada es pregunta para el contador
  (pregunta 9 de la investigación).
- **El aviso por correo** de una boleta con problemas no se hizo.

---

## Pendiente de decisión

Nada del motor. El ILA quedó decidido el 2026-10-14 (ver "Decidido por el owner" arriba): costo
para el minorista, rechazo del adicional en la boleta como regla. Queda abierto solo el
contribuyente afecto (factura, otro frente) y las preguntas para el contador de la
[investigación](../agent/investigaciones/2026-10-14-ila-en-boleta-electronica.md) § 6, que no
cambian la regla del local típico.

---

## Related Features

- [ADR-033](../adr/033-emisor-dte-propio.md) — por qué se construye y qué falta.
- [`cron.md`](./cron.md) — el runner de los dos jobs de la cola (`cron_ejecuciones`).
- [`tenants-razones-sociales.md`](./tenants-razones-sociales.md) — las columnas del emisor y la
  protección del RUT.
- [`impuestos.md`](./impuestos.md) — el IVA congelado y la deuda del peso de la góndola.
- [`ventas.md`](./ventas.md) — `venta_documentos` (de donde sale la boleta de cada venta) y la
  identidad sobre 135 UF.
- [`reembolsos-nota-credito.md`](./reembolsos-nota-credito.md) — la nota de crédito, fuera del
  alcance de este motor.
