# El motor de la boleta electrónica: datos → XML timbrado y firmado

**Fecha:** 2026-10-14 · **Tipo:** spec de diseño · **Fiscal: frente propio** (`CLAUDE.md`, ADR-010)
**Subproyecto 2 de 6** del emisor de DTE propio. **Status:** Draft, a revisión del owner.
**Insumo:** [`investigaciones/2026-10-13-emision-electronica-sii.md`](../../agent/investigaciones/2026-10-13-emision-electronica-sii.md).

---

## 0. Cómo se decidió

El owner eligió cada punto de esta tabla el 2026-10-14, en la sesión de brainstorming. Se le presentaron opciones con el costo de cada una (AskUserQuestion) o secciones de diseño que aprobó en el chat.

| Decisión | Elegida | Descartada, y por qué |
|---|---|---|
| Construir o comprar | **Construir el emisor propio** | Proveedor con API de partner (SimpleFactura, Folyo) o "traiga su cuenta" (OpenFactura) |
| Primer documento | **Boleta (39/41)** | Factura + NC + ND: la certificación exige las tres juntas y la ND no existe en el sistema |
| RUT piloto | **No hay todavía** | Se prueba contra los XSD; la certificación espera a tener un RUT |
| Librería | **Código propio sobre `node-forge` + `xml-crypto`** | `@devlas/dte-sii`: repo de marzo 2026 que implementa el RCOF derogado. LibreDTE: AGPL |
| Certificado del dueño | **Se guarda cifrado; la consulta legal o al SII va en paralelo** | Frenar el diseño hasta tener la respuesta |
| Orden | **Motor primero** | Perfil fiscal primero, o los dos juntos |
| Validación XSD en pruebas | **`xmllint-wasm`, dependencia solo de desarrollo** | `xmllint` del sistema: no está en el contenedor Alpine |
| Nombre del ítem fuera de norma | **Se limita el catálogo**; el motor rechaza | Adaptar en el motor (cambiar caracteres y cortar), o rechazar sin tocar el catálogo |

### Los seis subproyectos

1. **Perfil fiscal:** datos del emisor, certificado cifrado, CAF y folios usados.
2. **Motor (esta spec).**
3. **Cliente del SII y cola de envío.**
4. **Conexión con la venta y la nota de crédito.**
5. **Certificación.**
6. **Intercambio de factura.**

Cada uno lleva su propia spec, su plan y su verificación.

## 1. Qué es y qué no es

El motor es una **función pura**:

- **Entra:** los datos de una boleta, un CAF y un certificado.
- **Sale:** el `<DTE>` con su timbre (TED) y firmado, más el sobre `EnvioBOLETA` firmado, que agrupa una o más boletas.
- **No:** lee la base, guarda, lee el reloj ni se conecta a nada.

Sigue el molde de `calculo-precios.engine.ts`, que separa el cálculo del servicio.

**No entra:**

- Guardar documentos ni llevar la cuenta de los folios usados → subproyecto 1.
- Pantallas.
- Enviar al SII → subproyecto 3.
- Traducir `venta_documentos` al contrato → subproyecto 4.
- Factura y nota de crédito.
- Impuestos adicionales (§ 7).
- Verificar la firma del SII sobre el CAF → subproyecto 1.

## 2. Dónde vive

Va en el módulo nuevo `backend/src/modules/dte/`, sin controller ni entidades por ahora. Tiene cinco unidades:

| Unidad | Responsabilidad |
|---|---|
| Boleta | Arma `<Documento>` (encabezado, detalle, descuentos y recargos globales, totales) y aplica las verificaciones de § 4 |
| TED | Arma `<DD>` y lo firma con la llave del CAF |
| Firma | XMLDSig de un nodo con el certificado |
| Envío | Arma `EnvioBOLETA` (carátula y `SetDTE`) y lo firma |
| CAF | Lee un CAF: RUT, tipo, rango y llave privada |

Los nombres de archivo y las firmas de las funciones los fija el plan, **después de la tarea 1** (§ 8).

## 3. El contrato de entrada

El contrato **no conoce nuestras tablas**: lo llena el subproyecto 4. Por intención, trae:

- **Emisor:**
  - RUT, razón social, giro, dirección, comuna y código de sucursal (`CdgSIISucur`, opcional).
  - RUT y razón social del proveedor de software (`RutProvSW`/`RznSocProvSW`, formato v4.2), es decir, nosotros.
- **Documento:**
  - Tipo (39 o 41), folio y fecha de emisión (`AAAA-MM-DD`, la decide quien llama).
  - Medio de pago (códigos 1–5, opcional).
  - Si la venta supera el umbral de 135 UF. Lo calcula quien llama, porque el motor no sabe de UF.
- **Receptor (opcional):** RUT, nombre, correo y teléfono.
- **Líneas:** nombre, cantidad, precio unitario, monto de la línea con IVA incluido, descuento y recargo de línea, y si es exenta.
- **Descuentos y recargos globales.**
- **Montos congelados:** neto, exento, IVA y total.
- **Fecha y hora** del timbre y de la firma.
- **CAF** (el XML tal cual) y **certificado** (`.pfx` y clave).
- **Datos del envío:** RUT de quien envía, fecha y número de la resolución del SII.

## 4. Los montos: el motor verifica, no calcula

Fuente: SII, *Formato Boletas Electrónicas* v4.2 (2025-09-08): campos 32–35 del Encabezado y 21–26 del Detalle.

1. **Decimal.js en todo**, como cualquier cálculo de plata del proyecto. `MntNeto`, `MntExe`, `IVA` y `MntTotal` van en **pesos enteros**. Un total con decimales es error. Cantidad y precio unitario admiten hasta 6 decimales.
2. **El detalle va con IVA incluido** (sin `IndMntNeto`), que es el modo por defecto de la boleta. Con eso:
   - `MontoItem = PrcItem × QtyItem − DescuentoMonto + RecargoMonto`, por línea.
   - Suma de líneas afectas − descuentos globales + recargos globales = `MntNeto + IVA`.
   - Suma de líneas exentas = `MntExe`.
   - `MntTotal = MntNeto + IVA + MntExe`.
3. **Si una igualdad no cierra, se lanza un error y no se arma nada.** El motor no corrige montos.
4. **El IVA congelado se manda tal cual** (ADR-010, `features/impuestos.md`).
   - Con precio de góndola $993 el neto es 834 y el IVA 159, pero `0,19 × 834 = 158`. Ningún par de enteros cumple a la vez el total y la fórmula del formato.
   - El motor devuelve un **aviso** con la diferencia en pesos entre el IVA mandado y `round(tasa × MntNeto)`.
   - El aviso sirve para medir cuántas boletas saldrían "aceptadas con reparos" cuando se publiquen las fases de la Res. 121/2026. **No frena la boleta.**
5. **Boleta exenta (41):** todas las líneas exentas, sin `MntNeto` ni `IVA`.
6. **Receptor:**
   - Sin cliente, va el RUT genérico `66666666-6`, que el formato permite.
   - Sobre 135 UF (Res. Ex. SII 44/2025, campos 10, 18 y 20) son obligatorios RUT válido, nombre y medio de pago. Si falta alguno, es error.
   - El subproyecto 4 ya lo exige antes de cobrar. El motor lo repite porque el XML no puede salir sin esos datos.

## 5. Texto

- **Codificación:** el XML va en ISO-8859-1, que fija el XSD.
- **Nombre del ítem:** un `NmbItem` con más de 80 caracteres o con un carácter fuera de ISO-8859-1 es **error**. El motor no corrige ni corta.
  - La garantía la da el catálogo, que va a limitar el nombre a 80 caracteres del alfabeto latino básico. **Es un cambio aparte** (§ 9).
- **Resto de campos:** la misma regla vale para la razón social, el giro, la dirección y la comuna del emisor (subproyecto 1) y para los datos del receptor. Cada largo es el máximo que fija el formato v4.2 para ese campo.

## 6. Timbre, firma y CAF

- **TED.** `<DD>` lleva:
  - RUT del emisor, tipo, folio, fecha y RUT del receptor.
  - Nombre del receptor (40 caracteres) y total.
  - Primer ítem (40 caracteres).
  - El `<CAF>` copiado tal cual y `TSTED`.
  - `<FRMT>` es SHA1withRSA sobre `<DD>` con la llave privada del CAF. `EnvioBOLETA_v11.xsd` fija ese algoritmo.
- **Firma.** XMLDSig del `<Documento>` y del `<SetDTE>`:
  - Referencia al `ID` del nodo.
  - C14N, digest SHA1 y RSA-SHA1.
  - `KeyInfo` con `RSAKeyValue` y `X509Certificate`.
  - El certificado sale del `.pfx` con `node-forge`.
- **CAF.**
  - Antes de timbrar se valida que el RUT del CAF sea el del emisor, que el tipo sea el del documento y que el folio esté en `RNG`.
  - No se verifica la firma del SII sobre el CAF (`FRMA`).
- **Timbre impreso:** la Res. 207/2025 hizo opcional imprimirlo desde el 2026-01-01, pero sigue obligatorio en el XML. El motor no genera PDF417.

## 7. Errores y lo que queda abierto

**`DteError`** lleva un código por motivo:

- totales que no cierran;
- total en pesos con decimales;
- folio fuera del rango del CAF;
- CAF de otro RUT u otro tipo;
- texto fuera de ISO-8859-1 o demasiado largo;
- falta la identificación sobre 135 UF;
- impuesto adicional no soportado.

El código existe para que el subproyecto 4 le diga al cajero qué pasó.

**Lo que hay que resolver antes del subproyecto 4:**

- **ILA y otros impuestos adicionales.**
  - La boleta no tiene campo para ellos (el XSD no tiene `ImptoReten`), y `venta_documentos.monto_impuestos` suma IVA y adicionales.
  - Si el contrato trae un adicional, el motor rechaza con el código "no soportado".
  - Hace falta una investigación del tratamiento del SII. Un restaurante que vende tragos lo necesita desde el primer día.
- **El XSD está desactualizado.**
  - `EnvioBOLETA_v11.xsd` (2007, el que publica el SII en `schema_envio_bol.zip`) no trae `MedioPago`, `CorreoRecep`, `TelefonoRecep` ni `RutProvSW`/`RznSocProvSW`, que el formato agregó entre 2023 y 2025.
  - **Regla:** si al ejecutar el plan el SII publica un XSD nuevo, se usa ese. Si no, las pruebas validan contra una copia versionada del v11 con esos campos agregados, cada uno citando su fila del formato v4.2.
  - El esquema real del SII se mide en la certificación (subproyecto 5).
- **El PDF del formato v4.2 sigue exigiendo el "Reporte de Consumo de Folios"** en su introducción. Está derogado desde el 2022-08-01 (Res. 53/2022, verificado en el resolutivo) y **no se construye**.
- **Custodia del certificado:** la consulta legal o al SII va en paralelo, y no frena este subproyecto (el motor recibe el certificado, no lo guarda).

## 8. Pruebas

**Tarea 1 del plan: prueba de concepto de la firma, antes de escribir el resto.**

- Hay que verificar con nuestro código la firma del XML de ejemplo que publica el SII (`F60T33-ejemplo.xml`, en `ejemplo_xml.zip`) y firmar con SHA1 en Node 22 con `xml-crypto`.
- Si la verificación acepta la firma real del SII, la canonicalización está bien.
- Si no la acepta, o si Node u OpenSSL 3 no firman SHA1, **se para y se replantea** antes de seguir.
- El plan lleva la intención de las tareas siguientes, no su código, hasta que la tarea 1 decida.

**Pruebas unitarias**, sin red ni base:

- Certificado autofirmado y CAF de prueba generados con `node-forge` en los fixtures.
- Cada XML generado se valida contra el XSD (§ 7) con `xmllint-wasm`.
- Se verifica la firma del documento y del sobre, y el `FRMT` del timbre con la llave pública del CAF.
- Casos:
  - boleta afecta, boleta exenta y boleta mixta;
  - descuento y recargo, de línea y global;
  - precio de góndola con la diferencia de un peso: sale la boleta con su aviso;
  - sobre 135 UF con identificación (sale) y sin ella (error);
  - cada código de `DteError`;
  - sobre con varias boletas;
  - límite de 500 boletas por sobre (formato v4.2, § 2).
- **Mutantes:** cada igualdad de § 4 se revierte una a la vez y algún caso tiene que caer. Los fixtures no pueden usar el 1 ni factores iguales, que no discriminan.

## 9. Lo que esta spec dispara fuera del motor

- **Límite del nombre en el catálogo** (decisión del owner, § 0).
  - Va como frente aparte y tiene que estar antes del subproyecto 4.
  - Afecta a los ítems que ya existen. El proyecto no tiene datos productivos, pero el demo sí.
  - El nombre que la venta ya congeló en `venta_detalle` también tiene que cumplir, o el subproyecto 4 define qué hacer con las ventas viejas.
- **Dependencias nuevas** (aprobadas por el owner): `node-forge` y `xml-crypto` en producción, y `xmllint-wasm` solo en desarrollo.
- **Documentación** al implementar:
  - `docs/features/emision-electronica.md`, a partir de la plantilla;
  - una fila en `ESTADO.md`;
  - un ADR nuevo que cierre el diferimiento de ADR-010 (construir el emisor propio y por qué).
