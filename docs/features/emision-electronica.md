# Feature: Emisión electrónica — el motor de la boleta (sin envío)

**Status**: In Development — el motor está terminado; **todavía no se emite nada al SII**
**Owner**: Cesar Matheus
**Last Updated**: 2026-10-14

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
el reloj ni la red. No es un módulo de Nest todavía: sin controller, entity ni provider, nadie lo
importa.

### Why does it exist?

ADR-010 congela el hecho fiscal en la venta y difiere el documento. Este es el documento: lo que
el SII recibe, construido sobre lo ya congelado. Se hizo primero como motor puro porque no hay
RUT piloto: se prueba contra los XSD y contra la firma del ejemplo oficial, sin red.

### Scope

- Incluido: armar y firmar la boleta y el sobre; leer un CAF y un `.pfx`; verificar los montos;
  rechazar con código lo que el SII rechazaría.
- **No incluido** (cada cosa tiene su dueño):
  - guardar el documento ni llevar la cuenta de los folios usados (subproyecto 1);
  - enviar al SII y reintentar (subproyecto 3);
  - leer `venta_documentos` o armar el contrato desde una venta (subproyecto 4);
  - verificar la firma `FRMA` del SII sobre el CAF (subproyecto 1);
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
- **XSD**: el SII no publica un esquema posterior al `EnvioBOLETA_v11` (2007). Las pruebas
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
verdad es `CodigoDteError` en `dte.types.ts`.

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
| `MONTO_INVALIDO` | No es un número; cantidad ≤ 0, precio negativo, o cualquiera de los dos con más de 6 decimales; descuento o recargo no entero o negativo; un ajuste global en 0 |
| `DEMASIADAS_LINEAS` | Más de 1.000 líneas o más de 20 descuentos/recargos globales |

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

## Pendiente de decisión

El tratamiento de **ILA y otros impuestos adicionales** en la boleta no está decidido (la
boleta no tiene campo para ellos); el motor rechaza con `IMPUESTO_ADICIONAL_NO_SOPORTADO`. Es un
frente aparte (`docs/agent/desarrollo-nuevo.md`).

---

## Related Features

- [ADR-033](../adr/033-emisor-dte-propio.md) — por qué se construye y qué falta.
- [`impuestos.md`](./impuestos.md) — el IVA congelado y la deuda del peso de la góndola.
- [`ventas.md`](./ventas.md) — `venta_documentos` (lo que el subproyecto 4 traducirá al contrato)
  y la identidad sobre 135 UF.
- [`reembolsos-nota-credito.md`](./reembolsos-nota-credito.md) — la nota de crédito, fuera del
  alcance de este motor.
