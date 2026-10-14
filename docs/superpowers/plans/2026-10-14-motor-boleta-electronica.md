# Plan: el motor de la boleta electrónica (subproyecto 2 del emisor propio)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Status:** Done (2026-10-14)
- **Date:** 2026-10-14
- **Owner:** Cesar Matheus

**Goal:** el motor es una función pura. Recibe los datos de una boleta (39/41), un CAF y un certificado, y devuelve el `<DTE>` con su timbre y firmado, y el sobre `EnvioBOLETA` firmado. Valida contra el XSD y no toca la base, la red ni el reloj.

**Architecture:** módulo nuevo `backend/src/modules/dte/`, sin controller ni entidades. Sigue el molde de `calculo-precios.engine.ts`: funciones puras, probadas con unitarias. Tiene una unidad por responsabilidad:

- texto ISO-8859-1;
- montos;
- CAF;
- documento;
- TED;
- firma;
- envío.

**Tech Stack:** TypeScript, Decimal.js, `node-forge` (lee el `.pfx`), `xml-crypto` (XMLDSig), `@xmldom/xmldom` (parser, ver la Task 1), `xmllint-wasm` (solo en desarrollo, para el XSD) y Jest.

**Spec:** [`docs/superpowers/specs/2026-10-14-motor-boleta-electronica-design.md`](../specs/2026-10-14-motor-boleta-electronica-design.md)

## Global Constraints

**Regla de plan:** las Tasks 6 a 8 dependen de lo que mida la Task 1, y por eso llevan **intención, contrato y casos**, no código. Lo que pasó: la Task 1 dejó su hallazgo en este archivo, y las Tasks 6 a 8 **conservaron solo el contrato**; sus implementadores las escribieron con TDD desde ese contrato, sin código completo en el plan (memoria *plan no fijar código antes del spike*). Para el estado final del código manda `backend/src/modules/dte/`, no los bloques de este archivo.

**Plata y montos:**
- Plata con Decimal.js. `MntNeto`, `MntExe`, `IVA` y `MntTotal` en **pesos enteros**. Cantidad y precio unitario, hasta 6 decimales.
- El detalle va **con IVA incluido** (sin `IndMntNeto`).
- El motor **verifica, no calcula**: si una igualdad de la spec § 4 no cierra, lanza `DteError` y no arma nada.
- El IVA congelado se manda tal cual. El motor devuelve el **aviso** `diferenciaIvaRedondeo` (en pesos), que no frena la boleta.

**Texto:**
- XML en **ISO-8859-1**.
- `NmbItem` ≤ 80. Un carácter fuera de ISO-8859-1 o un largo por encima del máximo del formato v4.2 es **error**: el motor no corrige ni corta.

**Formato SII:**
- Sin cliente, el receptor es el RUT genérico `66666666-6`.
- Sobre 135 UF son obligatorios RUT válido, nombre y medio de pago. El que llama dice si se supera: el motor no sabe de UF.
- Impuesto adicional > 0 → `DteError('IMPUESTO_ADICIONAL_NO_SOPORTADO')`.
- Timbre y firma con SHA1withRSA, RSA-SHA1, digest SHA1 y C14N inclusivo `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`.
- No se construye el RCOF/RVD (Res. 53/2022) ni el PDF417.

**Pruebas:**
- No escribir **nunca** el literal de una cabecera PEM de clave privada en el código ni en los fixtures: el pre-commit (`check-secretos.mjs`) lo bloquea y el repo es público. Las llaves de prueba se generan en el test.

**Entorno:**
- Prefijo de cada comando: `export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"`. Los `npm`/`npx` corren en `backend/`; los `git`, en la raíz del repo (`git -C ..` si el cwd quedó en `backend/`; memoria *cwd se resetea*).
- No tocar un `.ts` del backend con un e2e corriendo (`CLAUDE.md`). Este plan no necesita e2e: no hay endpoint ni entidad.

## Review Focus

1. **Tildes y eñes del emisor y del receptor** ("Panadería Ñuñoa", "Peñalolén"). El XML tiene que salir en bytes ISO-8859-1 (no UTF-8 declarado como ISO), validar el XSD y la firma tiene que verificar después de releerlo. Lo fija la Task 8.
2. **Venta a granel**: 0,375 kg × $2.990 = 1.121,25 y el `MontoItem` congelado es 1.121. La línea no cierra al peso exacto y la boleta **tiene que salir**: la igualdad por línea admite menos de un peso de diferencia. Lo fija la Task 4.
3. **Folio en el borde del CAF**: el primero y el último del rango salen, y el último + 1 da `FOLIO_FUERA_DE_RANGO`. Lo fija la Task 3.
4. **Venta de $0 o con una línea negativa** (descuento del 100%, línea de ajuste): el formato pide `MntTotal` > 0 y montos no negativos, así que da error con código, no un XML que el SII rechaza. Lo fija la Task 4.
5. **Sobre con 501 boletas** o vacío: error con código, no un sobre que el SII rechaza. Lo fija la Task 8.

---

## Mapa de archivos

Todo vive en `backend/src/modules/dte/`.

| Archivo | Responsabilidad | Task |
|---|---|---|
| `__fixtures__/sii/F60T33-ejemplo.xml` | Ejemplo firmado oficial del SII (`ejemplo_xml.zip`) | 1 |
| `esquemas/EnvioBOLETA_v11.xsd`, `esquemas/xmldsignature_v10.xsd` | XSD oficiales (`schema_envio_bol.zip`) | 1 |
| `esquemas/EnvioDTE_v10.xsd`, `DTE_v10.xsd`, `SiiTypes_v10.xsd` | XSD oficiales (`schema_dte.zip`), para validar el ejemplo | 1 |
| `firma-sii.spec.ts` | Regresión contra el ejemplo del SII: firmas, `FRMT` y SHA1 de 512 bits en Node 22 (nació como el spike de la Task 1) | 1 |
| `dte.types.ts` | Contrato de entrada, resultado y `DteError` | 2 |
| `texto.ts` | Validar texto ISO-8859-1 y largos, escapar XML, codificar a latin1 | 2 |
| `montos.ts` | Las igualdades de la spec § 4, el aviso de IVA y los montos no negativos | 4 |
| `caf.ts` | Leer y validar un CAF | 3 |
| `esquemas/EnvioBOLETA_v11_formato42.xsd` | Copia del v11 con los campos del formato v4.2 | 5 |
| `boleta-documento.ts` | Armar `<Documento>` | 5 |
| `ted.ts` | Armar y firmar `<TED>` | 6 |
| `firma.ts` | XMLDSig de un nodo por `ID` | 7 |
| `envio-boleta.ts` | Sobre `EnvioBOLETA` y la API pública `emitirBoleta` / `armarEnvioBoleta` | 8 |
| `__fixtures__/credenciales-prueba.ts` | Generar en el test el certificado `.pfx` y el CAF de prueba | 3 |
| `__fixtures__/xsd.ts` | Validar un XML contra un XSD con `xmllint-wasm` | 1 |

Cada `.ts` tiene su `.spec.ts` al lado.

---

### Task 1: Spike — ¿verificamos la firma real del SII y firmamos SHA1 en Node 22?

**Por qué va primero:** firma, timbre y canonicalización son el riesgo técnico. Si esto no funciona, las Tasks 6 a 8 cambian.

**Files:**
- Create: los fixtures y los esquemas del mapa marcados "1".
- Create: `backend/src/modules/dte/__fixtures__/xsd.ts`.
- Create: `backend/src/modules/dte/firma-sii.spec.ts`.
- Modify: `backend/package.json` y `backend/package-lock.json`.

**Interfaces:**
- Produces: `validarContraXsd(xml: string, xsdPrincipal: string, xsdDependencias: string[]): Promise<{ valido: boolean; errores: string[] }>`, en `__fixtures__/xsd.ts`.
- Produces: el **hallazgo escrito** en este plan, que define las Tasks 6 a 8. Cubre:
  - si el ejemplo del SII verifica con `xml-crypto`;
  - la regla de serialización del `<DD>` que hace verificar el `FRMT`;
  - si Node 22 firma SHA1 con una llave RSA de 512 bits, el tamaño de las llaves del CAF.

- [x] **Step 1: Instalar las dependencias con versión exacta**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
cd backend
npm install --save-exact node-forge@1.4.0 xml-crypto@6.3.3 @xmldom/xmldom@0.8.15
npm install --save-dev --save-exact xmllint-wasm@5.3.0 @types/node-forge
```

`@xmldom/xmldom` ya viene como dependencia de `xml-crypto`. Se declara directa porque la usamos para parsear: importar una dependencia transitiva deja el código atado a la versión que otro eligió.

Después: `docker-compose up --build backend` en el entorno propio, para que la imagen tenga los paquetes (`CLAUDE.md`, Comandos).

- [x] **Step 2: Copiar los fixtures oficiales**

```bash
mkdir -p src/modules/dte/__fixtures__/sii src/modules/dte/esquemas
D=$(mktemp -d)
curl -sSL -o $D/ej.zip  https://www.sii.cl/servicios_online/docs/xml/ejemplo_xml.zip
curl -sSL -o $D/bol.zip https://www.sii.cl/servicios_online/docs/xml/schema_envio_bol.zip
curl -sSL -o $D/dte.zip https://www.sii.cl/servicios_online/docs/xml/schema_dte.zip
unzip -o -q $D/ej.zip  -d $D/ej  && cp $D/ej/F60T33-ejemplo.xml src/modules/dte/__fixtures__/sii/
unzip -o -q $D/bol.zip -d $D/bol && cp $D/bol/*.xsd src/modules/dte/esquemas/
unzip -o -q $D/dte.zip -d $D/dte && cp $D/dte/*.xsd src/modules/dte/esquemas/
ls src/modules/dte/esquemas
```

Expected: `DTE_v10.xsd EnvioBOLETA_v11.xsd EnvioDTE_v10.xsd SiiTypes_v10.xsd xmldsignature_v10.xsd`. Las dos copias de `xmldsignature_v10.xsd` tienen que ser idénticas; si no lo son, para y avisá. Los archivos se guardan **sin reencodear**: son ISO-8859-1.

- [x] **Step 3: El validador de XSD de las pruebas**

`src/modules/dte/__fixtures__/xsd.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateXML } from 'xmllint-wasm';

const DIR = join(__dirname, '..', 'esquemas');

/** Lee un XSD del SII como latin1: viene en ISO-8859-1 y xmllint recibe texto. */
const leer = (nombre: string) => ({
  fileName: nombre,
  contents: readFileSync(join(DIR, nombre), 'latin1'),
});

/**
 * Valida un XML contra un XSD de `esquemas/`. Solo para pruebas
 * (`xmllint-wasm` es dependencia de desarrollo).
 */
export async function validarContraXsd(
  xml: string,
  xsdPrincipal: string,
  xsdDependencias: string[],
): Promise<{ valido: boolean; errores: string[] }> {
  const r = await validateXML({
    xml: [{ fileName: 'documento.xml', contents: xml }],
    schema: [leer(xsdPrincipal)],
    preload: xsdDependencias.map(leer),
  });
  return { valido: r.valid, errores: r.errors.map((e) => e.message) };
}
```

- [x] **Step 4: El spike como prueba**

`src/modules/dte/firma-sii.spec.ts` (el código vive ahí, no se repite en el plan). Seis casos: el XSD, el defecto de las llaves del ejemplo, la firma del `Documento` sobre el `<DTE>` aislado, la firma del `SetDTE` sobre el sobre completo, el `FRMT` y SHA1 con 512 bits. La versión que se escribió primero verificaba con la llave del `X509Certificate` y fallaba: ver el hallazgo.

- [x] **Step 5: Correrlo y registrar lo que pasa**

Run: `npx jest src/modules/dte/firma-sii.spec.ts`

Por cada caso se anota el resultado **literal**, con el mensaje de error si falla.

- **Los cuatro en verde:** la Task 7 firma con `xml-crypto` y la Task 6 usa "DD aplanado en latin1".
- **Falla la verificación de una firma del ejemplo:** se prueba en orden, y se registra cuál funcionó:
  1. `idAttribute: 'ID'`.
  2. Verificar sobre el documento reparseado del `<DTE>` aislado.
  3. Mirar si el ejemplo de 2003 fue editado después de firmado: compararlo con otro ejemplo real, por ejemplo uno de la certificación que publique LibreDTE (solo leerlo, es AGPL).

  Si después de **dos** intentos no verifica: **parar y reportar al owner** con lo medido, sin seguir a la Task 2 de firma.
- **Falla el FRMT con la candidata 1:** probar a canonicalizar el `<DD>` con C14N antes de aplanar. Si tampoco, parar y reportar.
- **Falla SHA1 con 512 bits:** parar y reportar. Es la llave que el SII entrega en el CAF y no la elegimos nosotros.
- **Falla el XSD por el schemaLocation u otro detalle de carga:** arreglar el `preload` y registrar.

- [x] **Step 6: Escribir el hallazgo en este plan y completar las Tasks 6 a 8**

- En la sección "Hallazgo de la Task 1" de abajo: qué verificó, qué ajustes hicieron falta y la regla de serialización del DD.
- Ajustar la intención y el contrato de las Tasks 6, 7 y 8 a lo medido. Su código lo escribe quien las implementa, con TDD, a partir de ese contrato.
- El spike se queda como prueba de regresión, renombrado a `firma-sii.spec.ts`: es la única prueba que compara contra una firma real del SII.

- [x] **Step 7: Gate y commit**

```bash
npm run lint:check && npm run typecheck && npm test
git add backend/package.json backend/package-lock.json backend/src/modules/dte/ docs/superpowers/plans/2026-10-14-motor-boleta-electronica.md
git diff --cached --stat
git commit -m "test(dte): la firma del SII verifica con xml-crypto y SHA1 firma en Node 22"
```

`npm test` entero, no solo el spec (memoria *gate e2e y unit completos*). El pre-commit no pide el recibo de revisión, porque el diff no toca services ni `.vue`.

#### Hallazgo de la Task 1

Medido el 2026-10-14 con `xml-crypto@6.3.3`, `@xmldom/xmldom@0.8.15` y Node 22.23.3 sobre el ejemplo oficial `F60T33-ejemplo.xml` (una factura 33 de 2003, dentro de `EnvioDTE`; trae CRLF).

**Primera corrida del spike tal como estaba escrito** (verificar con la llave del `X509Certificate`):

| Caso | Resultado |
|---|---|
| El ejemplo valida contra `EnvioDTE_v10.xsd` (con `DTE_v10`, `SiiTypes_v10` y `xmldsignature_v10` en el `preload`) | Pasa, `errores = []`. No hizo falta tocar el `preload`. |
| Firma 0 (`#F60T33`, el `Documento`) | Falla: `checkSignature` devuelve `false`. |
| Firma 1 (`#SetDoc`) | Falla: `invalid signature: the signature value sBnr8Yq14vVAcrN/pKLD/BrqUFczKMW3y1t3JOrdsxhhq6IxvS13SgyMXbIN/T9ciRaFgNabs3pi732XhcpeiSmD1ktzbRctEbSIszYkFJY49k0eB+TVzq3eVaQr4INrymfuOnWj78BZcwKuXvDy4iAcx6/TBbAAkPFwMP9ql2s= is incorrect`. |
| `FRMT` con "DD aplanado en latin1" | Pasa a la primera. No hizo falta C14N. |
| SHA1 con una llave RSA de 512 bits en Node 22 | Pasa. |

**Los dos fallbacks del Step 5, en orden, y por qué no sirvieron:**
1. `idAttribute: 'ID'`: peor. El default de xml-crypto ya busca `Id`, `ID` e `id`; pasarlo duplica el atributo y rompe con `Cannot validate a document which contains multiple elements with the same value for the ID / Id / Id attributes, in order to prevent signature wrapping attack.` (las dos firmas, con CRLF y con LF).
2. Verificar sobre el `<DTE>` aislado y reparseado, con la llave del certificado: `invalid signature: the signature value JG1Ig0pvSIH85kIKGRZUjkyX6CNaY08Y94j4UegTgDe8+wl61Gz…` (la firma 0).

Con dos intentos fallidos se paró y se reportó. La causa salió de medir, no de un tercer intento a ciegas:

**1. Las llaves del ejemplo están cruzadas.** En las dos firmas, el módulo del `X509Certificate` es distinto del `Modulus` del `RSAKeyValue` del mismo `KeyInfo` (128 bytes los dos). Las firmas son de la llave del `RSAKeyValue`. Verificar con el certificado falla siempre, y no dice nada de xml-crypto. Un caso del spec lo fija.

**2. La firma del `Documento` solo verifica con el `<DTE>` suelto.** Con la llave del `RSAKeyValue`:

| Qué se verifica | Resultado |
|---|---|
| Firma 0 sobre el `<DTE>` aislado y reparseado (sin namespace) | `true` |
| Firma 0 dentro del sobre completo | `false` (digest calculado `4GXbxCc2Fhaiol1WYeMzcwRKnT4=`, el declarado es `hlmQtu/AyjUjTDhM3852wvRCr8w=`) |
| Firma 1 sobre el sobre completo | `true`, con CRLF y con LF |

El digest declarado de la firma 0 se reproduce solo con el `<Documento>` canonicalizado **sin** `xmlns`. El ejemplo de 2003 firmó el `Documento` antes de meterlo al sobre. Dentro del sobre hereda `xmlns="http://www.sii.cl/SiiDte"` y `xmlns:xsi`, y la canonicalización inclusiva los mete en el digest. Los CRLF no cambian nada: xml-crypto da el mismo digest con CRLF y con LF.

**3. Lo que sí queda fijado** (spec en verde, 6 de 6):
- xml-crypto verifica las firmas del SII con la llave del `RSAKeyValue`: el `Documento` sobre el `<DTE>` aislado, el `SetDTE` sobre el sobre completo.
- El `FRMT` del `TED` verifica con la regla "`<DD>` aplanado en latin1": el texto del `<DD>` sin los blancos entre tags y los bytes en ISO-8859-1. Los blancos **dentro** de un texto se conservan (el ejemplo tiene `RSR` = `EMPRESA  LTDA`, con dos espacios).
- Node 22 firma y verifica SHA1 con RSA de 512 bits.
- La `Reference` del ejemplo usa **un solo** `Transform`: C14N inclusivo `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`, sin `enveloped-signature` (la `Signature` es hermana del nodo firmado, no hija). Digest SHA1, firma `rsa-sha1`, `CanonicalizationMethod` C14N inclusivo.
- El ejemplo no es una boleta y no trae un `RSR` por defecto (el receptor es una empresa con nombre): el texto cuando el receptor no tiene nombre sigue sin salir de acá.

**Regla de diseño (decisión de la orquestadora, 2026-10-14):** el `<DTE>` declara los mismos namespaces que la raíz del sobre (`xmlns="http://www.sii.cl/SiiDte"` y `xmlns:xsi`). Por qué: así la forma canónica inclusiva del `<Documento>` es la misma suelta y dentro del sobre, y la firma verifica en los dos contextos. **No verificado todavía:** qué hace el verificador propio del SII con esto. Se comprueba en la certificación (subproyecto 5).

---

### Task 2: El contrato y el texto ISO-8859-1

**Files:**
- Create: `backend/src/modules/dte/dte.types.ts`
- Create: `backend/src/modules/dte/texto.ts`
- Test: `backend/src/modules/dte/texto.spec.ts`

**Interfaces:**
- Produces: todos los tipos de `dte.types.ts`, más `validarTexto(campo: string, valor: string, max: number): string`, `escaparXml(valor: string): string` y `aLatin1(xml: string): Buffer`.

- [ ] **Step 1: El contrato**

`dte.types.ts`:

```ts
/** Tipos de boleta que emite el motor (SII, Formato Boletas v4.2, campo 2). */
export type TipoBoleta = 39 | 41;

/** Campo 10 del formato: 1 efectivo, 2 electrónico, 3 transferencia, 4 cheque, 5 otro. */
export type MedioPagoSii = 1 | 2 | 3 | 4 | 5;

export interface EmisorBoleta {
  rut: string;
  razonSocial: string;
  giro: string;
  direccion: string;
  comuna: string;
  /** Código de sucursal del SII; se omite si el emisor no tiene sucursales. */
  cdgSiiSucur?: string;
}

/** Nosotros: `RutProvSW` / `RznSocProvSW` (formato v4.2). */
export interface ProveedorSoftware {
  rut: string;
  razonSocial: string;
}

export interface ReceptorBoleta {
  rut: string;
  nombre?: string;
  correo?: string;
  telefono?: string;
}

/** Una línea del detalle. Los montos van CON IVA incluido (sin IndMntNeto). */
export interface LineaBoleta {
  nombre: string;
  cantidad?: string;
  precioUnitario?: string;
  descuentoMonto?: string;
  recargoMonto?: string;
  /** `MontoItem`: lo congelado de la línea, en pesos enteros. */
  monto: string;
  exenta: boolean;
}

/** `DscRcgGlobal` en pesos: D descuento, R recargo. */
export interface AjusteGlobal {
  tipo: 'D' | 'R';
  glosa: string;
  monto: string;
  exento: boolean;
}

/** Lo congelado en la venta (ADR-010): el motor lo verifica, no lo recalcula. */
export interface MontosBoleta {
  neto: string;
  exento: string;
  iva: string;
  total: string;
  /** Suma de impuestos adicionales congelados (ILA…). > 0 hoy es error. */
  adicionales: string;
}

export interface DatosBoleta {
  tipo: TipoBoleta;
  folio: number;
  /** AAAA-MM-DD, en la hora de Chile; la decide quien llama. */
  fechaEmision: string;
  emisor: EmisorBoleta;
  proveedorSoftware: ProveedorSoftware;
  receptor?: ReceptorBoleta;
  medioPago?: MedioPagoSii;
  /** La venta supera 135 UF (Res. Ex. SII 44/2025): lo calcula quien llama. */
  superaUmbralIdentificacion: boolean;
  lineas: LineaBoleta[];
  ajustesGlobales: AjusteGlobal[];
  montos: MontosBoleta;
}

// Así era la unión al escribir el plan. La final (26 códigos, con los de las rondas de arreglos)
// vive en `backend/src/modules/dte/dte.types.ts`, que es la fuente de verdad.
export type CodigoDteError =
  | 'TOTALES_NO_CIERRAN'
  | 'LINEA_NO_CIERRA'
  | 'MONTO_NO_ENTERO'
  | 'MONTO_NEGATIVO'
  | 'TOTAL_NO_POSITIVO'
  | 'SIN_LINEAS'
  | 'BOLETA_EXENTA_CON_AFECTO'
  | 'FOLIO_FUERA_DE_RANGO'
  | 'CAF_OTRO_RUT'
  | 'CAF_OTRO_TIPO'
  | 'CAF_INVALIDO'
  | 'CERTIFICADO_INVALIDO'
  | 'TEXTO_NO_ISO_8859_1'
  | 'TEXTO_DEMASIADO_LARGO'
  | 'RUT_INVALIDO'
  | 'CDG_SUCURSAL_INVALIDO'
  | 'FALTA_IDENTIFICACION_135_UF'
  | 'IMPUESTO_ADICIONAL_NO_SOPORTADO'
  | 'ENVIO_VACIO'
  | 'ENVIO_DEMASIADAS_BOLETAS'
  | 'ENVIO_FOLIO_REPETIDO'
  | 'ENVIO_OTRO_EMISOR'
  | 'NRO_RESOL_INVALIDO'
  | 'FECHA_INVALIDA'
  | 'MONTO_INVALIDO'
  | 'DEMASIADAS_LINEAS';

/** Error del motor con un código por motivo, para que el que llama sepa qué pasó. */
export class DteError extends Error {
  constructor(
    readonly codigo: CodigoDteError,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'DteError';
  }
}
```

- [ ] **Step 2: Los tests del texto, que fallan**

`texto.spec.ts`:

```ts
import { DteError } from './dte.types';
import { aLatin1, escaparXml, validarTexto } from './texto';

describe('validarTexto', () => {
  it('acepta tildes y eñes, que están en ISO-8859-1', () => {
    expect(validarTexto('RznSocEmisor', 'Panadería Ñuñoa', 100)).toBe('Panadería Ñuñoa');
  });

  it.each(['Pizza 🍕', 'Café – especial', 'Té “verde”'])(
    'rechaza %s: tiene un carácter fuera de ISO-8859-1',
    (valor) => {
      expect(() => validarTexto('NmbItem', valor, 80)).toThrow(
        expect.objectContaining({ codigo: 'TEXTO_NO_ISO_8859_1' }),
      );
    },
  );

  it('acepta exactamente el máximo y rechaza uno más, sin cortar', () => {
    expect(validarTexto('NmbItem', 'a'.repeat(80), 80)).toHaveLength(80);
    expect(() => validarTexto('NmbItem', 'a'.repeat(81), 80)).toThrow(
      expect.objectContaining({ codigo: 'TEXTO_DEMASIADO_LARGO' }),
    );
  });

  it('el mensaje nombra el campo', () => {
    expect(() => validarTexto('GiroEmisor', 'x'.repeat(81), 80)).toThrow(/GiroEmisor/);
  });

  it('es DteError', () => {
    expect(() => validarTexto('NmbItem', '🍕', 80)).toThrow(DteError);
  });
});

describe('escaparXml', () => {
  it('escapa los cinco caracteres reservados', () => {
    expect(escaparXml(`A&B <C> "D" 'E'`)).toBe('A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos;');
  });
});

describe('aLatin1', () => {
  it('codifica la ñ como un byte (0xF1), no como dos de UTF-8', () => {
    expect([...aLatin1('ñ')]).toEqual([0xf1]);
  });
});
```

- [ ] **Step 3: Correr y ver que falla**

Run: `npx jest src/modules/dte/texto.spec.ts`
Expected: FAIL, `Cannot find module './texto'`.

- [ ] **Step 4: La implementación**

`texto.ts`:

```ts
import { DteError } from './dte.types';

/** ISO-8859-1: U+0000–U+00FF. Los de control salvo tab y saltos no entran en un XML. */
const FUERA_DE_LATIN1 = /[^\t\n\r\u0020-\u007E\u00A0-\u00FF]/u;

/**
 * Devuelve el valor si cabe en el campo del SII. No corrige ni corta (spec § 5):
 * lo emitido tiene que ser igual a lo congelado. La garantía de origen la da la
 * captura (el catálogo, el perfil fiscal).
 */
export function validarTexto(campo: string, valor: string, max: number): string {
  if (FUERA_DE_LATIN1.test(valor)) {
    throw new DteError('TEXTO_NO_ISO_8859_1', `${campo} tiene un carácter que la boleta no admite: "${valor}"`);
  }
  if (valor.length > max) {
    throw new DteError('TEXTO_DEMASIADO_LARGO', `${campo} admite ${max} caracteres y trae ${valor.length}`);
  }
  return valor;
}

export function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Los bytes que viajan al SII: el XML declara ISO-8859-1. */
export function aLatin1(xml: string): Buffer {
  return Buffer.from(xml, 'latin1');
}
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npx jest src/modules/dte/texto.spec.ts`
Expected: PASS.

- [ ] **Step 6: Mutante**

1. En `FUERA_DE_LATIN1`, cambiar `\u00A0-\u00FF` por `\u00A0-\u00F0`. Tiene que caer "acepta tildes y eñes": la `ñ` es U+00F1 y queda afuera.
2. Cambiar `>` por `>=` en el largo. Tiene que caer "acepta exactamente el máximo".
3. Revertir los dos y anotar el resultado en el commit.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/dte/dte.types.ts backend/src/modules/dte/texto.ts backend/src/modules/dte/texto.spec.ts
git commit -m "feat(dte): contrato de la boleta y texto ISO-8859-1 sin cortar"
```

---

### Task 3: El CAF

**Files:**
- Create: `backend/src/modules/dte/caf.ts`
- Create: `backend/src/modules/dte/__fixtures__/credenciales-prueba.ts`
- Test: `backend/src/modules/dte/caf.spec.ts`

**Interfaces:**
- Consumes: `DteError`, `TipoBoleta` (Task 2) y `rutValido`/`normalizarRut` (`src/common/utils/rut.util.ts`).
- Produces:

```ts
export interface CafLeido {
  rutEmisor: string;          // normalizado
  tipo: number;               // TD
  desde: number;              // RNG/D
  hasta: number;              // RNG/H
  /** El nodo <CAF> tal cual, para copiarlo adentro del TED sin reserializar. */
  xmlCaf: string;
  llavePrivada: KeyObject;    // RSASK
  llavePublica: KeyObject;    // RSAPK (M, E)
}
export function leerCaf(xmlAutorizacion: string): CafLeido;
export function validarFolio(caf: CafLeido, rutEmisor: string, tipo: TipoBoleta, folio: number): void;
```

Y en `__fixtures__/credenciales-prueba.ts`:

```ts
export function cafDePrueba(opts: { rut: string; tipo: number; desde: number; hasta: number }): string; // XML <AUTORIZACION>
export function certificadoDePrueba(): { pfx: Buffer; clave: string; rut: string };
```

**Intención:**
- `leerCaf` parsea el `<AUTORIZACION>` del SII con `@xmldom/xmldom`. Extrae `RE`, `TD`, `RNG`, la llave pública de `RSAPK` (M/E, como en el spike) y la privada de `RSASK` (PEM, `createPrivateKey`).
  - `xmlCaf` es la **subcadena literal** del `<CAF>…</CAF>` del original: el timbre lo copia sin tocarlo.
  - Cualquier pieza faltante, o una privada que no corresponde a la pública (firmar y verificar un texto fijo), da `CAF_INVALIDO`.
- `validarFolio` da `CAF_OTRO_RUT`, `CAF_OTRO_TIPO` o `FOLIO_FUERA_DE_RANGO`. El rango es **inclusive** en los dos bordes.
- No verifica la `FRMA` del SII (spec § 6) ni lleva la cuenta de folios usados.
- **Fixtures:**
  - `cafDePrueba` genera una llave RSA de **512 bits** con `generateKeyPairSync`, igual que la del SII, y arma el XML con `FRMA` falsa. La cabecera PEM sale del `export` de la llave, nunca de un literal en el archivo.
  - `certificadoDePrueba` arma un X.509 autofirmado RSA 2048 y su `.pfx` con `node-forge`.

**Casos (`caf.spec.ts`), con valores que discriminan:**
- CAF tipo 39, RUT `76543210-3`, rango 101–150 → `desde = 101`, `hasta = 150`, `rutEmisor = '76543210-3'`, y `xmlCaf` es igual a la subcadena del original.
- Folios 101 y 150 pasan; 100 y 151 → `FOLIO_FUERA_DE_RANGO` (**Review Focus 3**).
- CAF tipo 41 usado para un 39 → `CAF_OTRO_TIPO`.
- CAF de `76543210-3` con un emisor `11111111-1` → `CAF_OTRO_RUT`.
- Sin `RSASK` → `CAF_INVALIDO`. Con `RSASK` de otra llave → `CAF_INVALIDO`.
- **Mutante:** cambiar `<=` por `<` en el borde superior. Tiene que caer el caso del folio 150. Revertir.

**Gate y commit:**

```bash
npx jest src/modules/dte/caf.spec.ts && npm run lint:check && npm run typecheck
git add backend/src/modules/dte/caf.ts backend/src/modules/dte/caf.spec.ts backend/src/modules/dte/__fixtures__/credenciales-prueba.ts
git commit -m "feat(dte): leer y validar el CAF, rango inclusive"
```

Si la Task 1 cambió algo de cómo se arma la llave pública desde `RSAPK`, se aplica acá igual.

---

### Task 4: Los montos — verificar, no calcular

**Files:**
- Create: `backend/src/modules/dte/montos.ts`
- Test: `backend/src/modules/dte/montos.spec.ts`

**Interfaces:**
- Consumes: `DatosBoleta`, `DteError` (Task 2).
- Produces: `verificarMontos(datos: DatosBoleta): { diferenciaIvaRedondeo: string }`. La diferencia es `iva − round_half_up(0,19 × neto)`, en pesos, como string. En la boleta 41 es `'0'`.

- [ ] **Step 1: Los tests, que fallan**

`montos.spec.ts`:

```ts
import type { DatosBoleta, LineaBoleta } from './dte.types';
import { verificarMontos } from './montos';

const linea = (over: Partial<LineaBoleta> = {}): LineaBoleta => ({
  nombre: 'Café', cantidad: '3', precioUnitario: '1490', monto: '4470', exenta: false, ...over,
});

const boleta = (over: Partial<DatosBoleta> = {}): DatosBoleta => ({
  tipo: 39,
  folio: 101,
  fechaEmision: '2026-10-14',
  emisor: { rut: '76543210-3', razonSocial: 'Panadería Ñuñoa SpA', giro: 'Panadería', direccion: 'Irarrázaval 2401', comuna: 'Ñuñoa' },
  proveedorSoftware: { rut: '77777777-7', razonSocial: 'Venka SpA' },
  superaUmbralIdentificacion: false,
  lineas: [linea()],
  ajustesGlobales: [],
  // 4470 / 1,19 = 3756,30 → neto 3756; IVA 714 (0,19 × 3756 = 713,64 → 714). Cierra sin aviso.
  montos: { neto: '3756', exento: '0', iva: '714', total: '4470', adicionales: '0' },
  ...over,
});

const codigo = (fn: () => unknown) => {
  try { fn(); } catch (e) { return (e as { codigo?: string }).codigo; }
  return 'NO_LANZO';
};

describe('verificarMontos', () => {
  it('una boleta afecta que cierra no avisa nada', () => {
    expect(verificarMontos(boleta())).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('góndola $993: sale con el IVA congelado y avisa un peso (spec § 4.4)', () => {
    const d = boleta({
      lineas: [linea({ cantidad: '1', precioUnitario: '993', monto: '993' })],
      montos: { neto: '834', exento: '0', iva: '159', total: '993', adicionales: '0' },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '1' });
  });

  it('total distinto de neto + IVA + exento → TOTALES_NO_CIERRAN', () => {
    expect(codigo(() => verificarMontos(boleta({
      montos: { neto: '3756', exento: '0', iva: '714', total: '4471', adicionales: '0' },
    })))).toBe('TOTALES_NO_CIERRAN');
  });

  it('líneas afectas que no suman neto + IVA → TOTALES_NO_CIERRAN', () => {
    expect(codigo(() => verificarMontos(boleta({
      lineas: [linea({ monto: '4480', precioUnitario: '1493.333333' })],
    })))).toBe('TOTALES_NO_CIERRAN');
  });

  it('boleta mixta: las exentas suman MntExe y las afectas neto + IVA', () => {
    const d = boleta({
      lineas: [linea(), linea({ nombre: 'Libro', cantidad: '2', precioUnitario: '7350', monto: '14700', exenta: true })],
      montos: { neto: '3756', exento: '14700', iva: '714', total: '19170', adicionales: '0' },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('exentas que no suman MntExe → TOTALES_NO_CIERRAN', () => {
    const d = boleta({
      lineas: [linea(), linea({ nombre: 'Libro', cantidad: '2', precioUnitario: '7350', monto: '14700', exenta: true })],
      montos: { neto: '3756', exento: '14600', iva: '714', total: '19070', adicionales: '0' },
    });
    expect(codigo(() => verificarMontos(d))).toBe('TOTALES_NO_CIERRAN');
  });

  it('descuento global afecto: líneas − descuento = neto + IVA', () => {
    // 4470 − 470 = 4000 → 4000/1,19 = 3361,34 → neto 3361; IVA 639 (0,19 × 3361 = 638,59 → 639).
    const d = boleta({
      ajustesGlobales: [{ tipo: 'D', glosa: 'Descuento', monto: '470', exento: false }],
      montos: { neto: '3361', exento: '0', iva: '639', total: '4000', adicionales: '0' },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('recargo global afecto suma a la base', () => {
    // 4470 + 530 = 5000 → neto 4202 (4201,68); IVA 798 (0,19 × 4202 = 798,38 → 798).
    const d = boleta({
      ajustesGlobales: [{ tipo: 'R', glosa: 'Recargo', monto: '530', exento: false }],
      montos: { neto: '4202', exento: '0', iva: '798', total: '5000', adicionales: '0' },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('granel: 0,375 × 2990 = 1121,25 y MontoItem 1121 cierra (menos de un peso)', () => {
    // 1121 / 1,19 = 942,02 → neto 942; IVA 179 (0,19 × 942 = 178,98 → 179).
    const d = boleta({
      lineas: [linea({ nombre: 'Queso', cantidad: '0.375', precioUnitario: '2990', monto: '1121' })],
      montos: { neto: '942', exento: '0', iva: '179', total: '1121', adicionales: '0' },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it('una línea que se aparta un peso o más de precio × cantidad − desc + rec → LINEA_NO_CIERRA', () => {
    const d = boleta({
      lineas: [linea({ cantidad: '3', precioUnitario: '1490', descuentoMonto: '20', monto: '4470' })],
    });
    expect(codigo(() => verificarMontos(d))).toBe('LINEA_NO_CIERRA');
  });

  it('una línea sin cantidad ni precio (servicio) solo aporta su monto', () => {
    const d = boleta({ lineas: [linea({ cantidad: undefined, precioUnitario: undefined })] });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });

  it.each([
    ['neto con decimales', { neto: '3756.5' }],
    ['total con decimales', { total: '4470.5' }],
  ])('%s → MONTO_NO_ENTERO', (_, m) => {
    const d = boleta();
    expect(codigo(() => verificarMontos({ ...d, montos: { ...d.montos, ...m } }))).toBe('MONTO_NO_ENTERO');
  });

  it('total $0 → TOTAL_NO_POSITIVO (Review Focus 4)', () => {
    const d = boleta({
      lineas: [linea({ monto: '0', precioUnitario: '0' })],
      montos: { neto: '0', exento: '0', iva: '0', total: '0', adicionales: '0' },
    });
    expect(codigo(() => verificarMontos(d))).toBe('TOTAL_NO_POSITIVO');
  });

  it('línea negativa → MONTO_NEGATIVO (Review Focus 4)', () => {
    const d = boleta({ lineas: [linea(), linea({ nombre: 'Ajuste', cantidad: undefined, precioUnitario: undefined, monto: '-100' })] });
    expect(codigo(() => verificarMontos(d))).toBe('MONTO_NEGATIVO');
  });

  it('impuesto adicional > 0 → IMPUESTO_ADICIONAL_NO_SOPORTADO', () => {
    const d = boleta();
    expect(codigo(() => verificarMontos({ ...d, montos: { ...d.montos, adicionales: '250' } }))).toBe('IMPUESTO_ADICIONAL_NO_SOPORTADO');
  });

  it('boleta 41 con una línea afecta o con neto → BOLETA_EXENTA_CON_AFECTO', () => {
    expect(codigo(() => verificarMontos(boleta({ tipo: 41 })))).toBe('BOLETA_EXENTA_CON_AFECTO');
  });

  it('boleta 41 toda exenta cierra y no avisa', () => {
    const d = boleta({
      tipo: 41,
      lineas: [linea({ nombre: 'Libro', cantidad: '2', precioUnitario: '7350', monto: '14700', exenta: true })],
      montos: { neto: '0', exento: '14700', iva: '0', total: '14700', adicionales: '0' },
    });
    expect(verificarMontos(d)).toEqual({ diferenciaIvaRedondeo: '0' });
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx jest src/modules/dte/montos.spec.ts`
Expected: FAIL, `Cannot find module './montos'`.

- [ ] **Step 3: La implementación**

`montos.ts`:

```ts
import Decimal from 'decimal.js';
import { type DatosBoleta, DteError } from './dte.types';

/** IVA de Chile. El motor solo emite boletas chilenas (otros países en pausa). */
const TASA_IVA = new Decimal('0.19');

const d = (v: string | undefined) => new Decimal(v ?? '0');

function entero(campo: string, v: Decimal): Decimal {
  if (!v.isInteger()) throw new DteError('MONTO_NO_ENTERO', `${campo} tiene que ir en pesos enteros y vale ${v.toString()}`);
  return v;
}

function noNegativo(campo: string, v: Decimal): Decimal {
  if (v.isNegative()) throw new DteError('MONTO_NEGATIVO', `${campo} no puede ser negativo: ${v.toString()}`);
  return v;
}

/**
 * Verifica las igualdades del Formato Boletas v4.2 (campos 32–35 y 21–26) sobre lo
 * congelado. No recalcula: el IVA congelado manda (ADR-010), y lo que se aparta de
 * `tasa × neto` vuelve como aviso, no como error (spec § 4.4).
 */
export function verificarMontos(datos: DatosBoleta): { diferenciaIvaRedondeo: string } {
  const m = datos.montos;
  if (d(m.adicionales).gt(0)) {
    throw new DteError('IMPUESTO_ADICIONAL_NO_SOPORTADO', 'La boleta no informa impuestos adicionales; falta definir cómo los trata el SII');
  }
  const neto = noNegativo('MntNeto', entero('MntNeto', d(m.neto)));
  const exento = noNegativo('MntExe', entero('MntExe', d(m.exento)));
  const iva = noNegativo('IVA', entero('IVA', d(m.iva)));
  const total = entero('MntTotal', d(m.total));
  if (!total.gt(0)) throw new DteError('TOTAL_NO_POSITIVO', `MntTotal tiene que ser mayor que cero y vale ${total.toString()}`);

  let afectas = new Decimal(0);
  let exentas = new Decimal(0);
  datos.lineas.forEach((l, i) => {
    const monto = noNegativo(`MontoItem de la línea ${i + 1}`, entero(`MontoItem de la línea ${i + 1}`, d(l.monto)));
    if (l.cantidad !== undefined && l.precioUnitario !== undefined) {
      const esperado = d(l.precioUnitario).mul(d(l.cantidad)).minus(d(l.descuentoMonto)).plus(d(l.recargoMonto));
      if (esperado.minus(monto).abs().gte(1)) {
        throw new DteError('LINEA_NO_CIERRA', `La línea ${i + 1} vale ${monto.toString()} y precio × cantidad − descuento + recargo da ${esperado.toString()}`);
      }
    }
    if (l.exenta) exentas = exentas.plus(monto);
    else afectas = afectas.plus(monto);
  });
  for (const a of datos.ajustesGlobales) {
    const v = noNegativo(`ValorDR "${a.glosa}"`, entero(`ValorDR "${a.glosa}"`, d(a.monto)));
    const signo = a.tipo === 'D' ? v.neg() : v;
    if (a.exento) exentas = exentas.plus(signo);
    else afectas = afectas.plus(signo);
  }

  if (datos.tipo === 41) {
    if (!afectas.isZero() || !neto.isZero() || !iva.isZero()) {
      throw new DteError('BOLETA_EXENTA_CON_AFECTO', 'Una boleta exenta (41) no lleva líneas afectas, neto ni IVA');
    }
  }
  if (!neto.plus(iva).plus(exento).eq(total) || !afectas.eq(neto.plus(iva)) || !exentas.eq(exento)) {
    throw new DteError(
      'TOTALES_NO_CIERRAN',
      `Neto ${neto} + IVA ${iva} + exento ${exento} = total ${total}; líneas afectas ${afectas}; exentas ${exentas}`,
    );
  }
  const ivaFormula = neto.mul(TASA_IVA).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { diferenciaIvaRedondeo: datos.tipo === 41 ? '0' : iva.minus(ivaFormula).toString() };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx jest src/modules/dte/montos.spec.ts`
Expected: PASS, todos.

- [ ] **Step 5: Mutantes (spec § 8: cada igualdad de § 4, una a la vez)**

Cada mutante se aplica, se corre el spec, se anota qué test cae y **se revierte** antes del siguiente:

| Mutante | Tiene que caer |
|---|---|
| Quitar `neto.plus(iva).plus(exento).eq(total)` | "total distinto de neto + IVA + exento" |
| Quitar `afectas.eq(neto.plus(iva))` | "líneas afectas que no suman neto + IVA" |
| Quitar `exentas.eq(exento)` | "exentas que no suman MntExe" |
| `a.tipo === 'D' ? v.neg() : v` → `v` | "descuento global afecto" |
| `.gte(1)` → `.gt(0)` | "granel" |
| `ROUND_HALF_UP` → `ROUND_DOWN` | "una boleta afecta que cierra" (713,64 → 713) |

Si un mutante sobrevive, el fixture no discrimina: cambiar el valor, no el código (memoria *el valor del fixture decide si el mutante vive*).

- [ ] **Step 6: Commit**

```bash
npm run lint:check && npm run typecheck
git add backend/src/modules/dte/montos.ts backend/src/modules/dte/montos.spec.ts
git commit -m "feat(dte): la boleta verifica lo congelado y avisa el peso de la góndola"
```

---

### Task 5: El `<Documento>` y el XSD con el formato v4.2

**Files:**
- Create: `backend/src/modules/dte/esquemas/EnvioBOLETA_v11_formato42.xsd`
- Create: `backend/src/modules/dte/boleta-documento.ts`
- Test: `backend/src/modules/dte/boleta-documento.spec.ts`

**Interfaces:**
- Consumes: `DatosBoleta`, `validarTexto`, `escaparXml` (Task 2), `verificarMontos` (Task 4) y `rutValido`/`normalizarRut`.
- Produces: `armarDocumento(datos: DatosBoleta, tedXml: string, tmstFirma: string): { xml: string; id: string; diferenciaIvaRedondeo: string }`.
  - `id` = `B${tipo}F${folio}`, el `ID` del `<Documento>` que firma la Task 7.
  - `tedXml` lo produce la Task 6. Hasta entonces, los tests pasan un TED armado a mano que cumple el XSD.

**Intención:**

1. **El XSD primero.**
   - Antes de copiar, buscar en `https://www.sii.cl/servicios_online/1039-formato_xml-1184.html` si el SII publica un `EnvioBOLETA` más nuevo que el v11. Si lo hay, se usa ese y se anota en el commit.
   - Si no lo hay, `EnvioBOLETA_v11_formato42.xsd` es el v11 **más** cinco elementos:
     - `MedioPago` en `IdDoc`;
     - `CorreoRecep` y `TelefonoRecep` en `Receptor`;
     - `RutProvSW` y `RznSocProvSW` en `Emisor`.
   - El orden y los largos salen de las filas del formato v4.2. Cada uno lleva un comentario XML con su fila: "formato Boletas v4.2, campo N".
   - **Tests del XSD:** el v11 original rechaza una boleta con `MedioPago`, y la copia la acepta. Así la diferencia queda medida y no supuesta.
2. **Antes de escribir una línea de XML**, `armarDocumento` llama a `verificarMontos` y valida con `validarTexto`:
   - del emisor: razón social (100), giro (80), dirección (70) y comuna (20);
   - por línea: `NmbItem` (80);
   - del receptor: nombre (100), correo (80) y teléfono (20);
   - de los ajustes: glosa (45).

   Los largos salen del formato v4.2, campos 12–17, 20–22 y del detalle. Antes de fijarlos, **se verifica cada uno contra el PDF** (memoria *cita de línea se verifica*).
3. **RUTs:** se validan con `rutValido` y se emiten normalizados. Un RUT inválido da `RUT_INVALIDO`. Sin receptor, va `66666666-6`.
4. **Sobre 135 UF:** `superaUmbralIdentificacion` con receptor sin RUT válido, o sin nombre, o sin `medioPago` → `FALTA_IDENTIFICACION_135_UF`.
5. **Orden de los elementos:** exactamente el del XSD.
   - `IdDoc`: `TipoDTE`, `Folio`, `FchEmis`, `IndServicio` = 3, `MedioPago`.
   - `Emisor`, luego `Receptor`.
   - `Totales`: sin `MntNeto` ni `IVA` en la 41.
   - `Detalle`: `NroLinDet`, `IndExe` = 1 solo si es exenta, `NmbItem`, `QtyItem`, `PrcItem`, `DescuentoMonto`, `RecargoMonto`, `MontoItem`.
   - `DscRcgGlobal`: `NroLinDR`, `TpoMov`, `GlosaDR`, `TpoValor` = `$`, `ValorDR`, `IndExeDR` = 1 si es exento.
   - Después, el TED y `TmstFirma`.
   - Los números van sin ceros de relleno, y la cantidad y el precio sin ceros finales: `Decimal.toString()`.

**Casos (`boleta-documento.spec.ts`), validando cada XML contra el XSD con `validarContraXsd`:**
- Boleta afecta (fixture de la Task 4): válida, con `ID="B39F101"`, `RUTRecep` = `66666666-6` y sin `IndMntNeto`.
- Boleta 41 toda exenta: válida, sin `MntNeto` ni `IVA`, con `IndExe` en cada línea.
- Boleta mixta con descuento global: válida, con `DscRcgGlobal` y `TpoValor` `$`.
- Sobre 135 UF con receptor, nombre y medio de pago 1: válida contra la copia v4.2, con `MedioPago` 1.
- Sobre 135 UF sin nombre → `FALTA_IDENTIFICACION_135_UF`; sin medio de pago → el mismo código.
- Emisor con RUT `76543210-4` (DV malo) → `RUT_INVALIDO`.
- `NmbItem` de 81 caracteres → `TEXTO_DEMASIADO_LARGO`, sin XML.
- Razón social `Panadería Ñuñoa SpA`: el `xml` contiene `Panadería Ñuñoa SpA` sin escapar a entidades numéricas.
- **Mutante:** omitir `MedioPago` aunque venga. Tiene que caer el caso de 135 UF (el texto ya no trae `<MedioPago>1</MedioPago>`). Revertir.

**Gate y commit:**

```bash
npx jest src/modules/dte && npm run lint:check && npm run typecheck
git add backend/src/modules/dte/esquemas/EnvioBOLETA_v11_formato42.xsd backend/src/modules/dte/boleta-documento.ts backend/src/modules/dte/boleta-documento.spec.ts
git commit -m "feat(dte): el Documento de la boleta valida contra el XSD con los campos del formato v4.2"
```

---

### Task 6: El timbre (TED)

> La Task 1 ya tiene su hallazgo escrito. Esta task se implementa con TDD a partir de este contrato.

**Files:**
- Create: `backend/src/modules/dte/ted.ts`
- Test: `backend/src/modules/dte/ted.spec.ts`

**Interfaces:**
- Consumes: `CafLeido`/`validarFolio` (Task 3), `DatosBoleta`, `validarTexto`, `escaparXml` (Task 2).
- Produces: `armarTed(datos: DatosBoleta, caf: CafLeido, tsted: string): string`, que devuelve el `<TED version="1.0">…</TED>`.

**Intención:**
- Llama a `validarFolio`.
- Arma `<DD>` con:
  - `RE` (RUT del emisor), `TD`, `F`, `FE`;
  - `RR` (RUT del receptor o `66666666-6`);
  - `RSR`: el nombre del receptor, o el texto que fije la Task 1 cuando no hay nombre. Se corta a 40, **es la única truncación permitida**: el campo del timbre es un extracto y el formato fija 40 caracteres. Verificar este punto en el formato v4.2 sección G antes de escribirlo;
  - `MNT` (total);
  - `IT1`: el primer `NmbItem`, a 40 caracteres, con la misma verificación;
  - el `xmlCaf` copiado literal, y `TSTED`.
- Firma con `createSign('RSA-SHA1')` sobre el `<DD>` aplanado y codificado a latin1 (la Task 1 lo confirmó contra el `FRMT` del ejemplo del SII) y la llave privada del CAF. "Aplanado" quiere decir sin los blancos **entre** tags; los blancos dentro de un texto se conservan.

**Casos:**
- El `FRMT` verifica con `caf.llavePublica` sobre el `<DD>` del resultado, con la misma regla.
- El `<CAF>` dentro del TED es **byte a byte** el del archivo.
- Cambiar un dígito de `MNT` después de firmar hace fallar la verificación.
- El `FRMT` también verifica con ese mismo `<DD>` después de pasar por `aLatin1` y releer como latin1 (tildes del receptor).
- Un nombre de receptor de 60 caracteres sale con `RSR` de 40.
- Folio fuera del rango → `FOLIO_FUERA_DE_RANGO`, sin TED.

---

### Task 7: La firma XMLDSig

> La Task 1 ya tiene su hallazgo escrito.

**Files:**
- Create: `backend/src/modules/dte/firma.ts`
- Test: `backend/src/modules/dte/firma.spec.ts`

**Interfaces:**
- Produces:
  - `leerCertificado(pfx: Buffer, clave: string): { llavePrivadaPem: string; certificadoB64: string; rut: string }`. Con `node-forge`; una clave mala o un pfx sin certificado → `CERTIFICADO_INVALIDO`. El RUT sale del certificado y la Task 8 lo usa como `RutEnvia`.
  - `firmarNodo(xml: string, id: string, cert: ReturnType<typeof leerCertificado>): string`. Devuelve el XML con `<Signature>` como hermano siguiente del nodo con ese `ID`, que es donde la pone el ejemplo del SII.

**Intención:** usa `xml-crypto` con:
- `canonicalizationAlgorithm` = C14N inclusivo;
- `signatureAlgorithm` = `rsa-sha1`;
- una referencia a `#id` con digest SHA1 y **una sola** transformación, C14N inclusivo (`http://www.w3.org/TR/2001/REC-xml-c14n-20010315`), que es la que usa el ejemplo del SII; sin `enveloped-signature`, porque la `Signature` es hermana del nodo firmado;
- `idAttribute` se deja en el default de xml-crypto, que ya busca `ID`: pasarlo de nuevo rompe con "multiple elements with the same value" (Task 1);
- `KeyInfo` con `KeyValue/RSAKeyValue` (módulo y exponente) **y** `X509Data/X509Certificate`, en ese orden, como el ejemplo del SII.

Si `xml-crypto` no emite `RSAKeyValue` por defecto, se arma con `getKeyInfoContent`. El `RSAKeyValue` y el certificado salen de la **misma** llave: el ejemplo del SII las trae cruzadas y por eso el verificador no se puede fiar del `KeyInfo`.

**El verificador de las pruebas** toma la llave del `RSAKeyValue` o de nuestro propio certificado, nunca de lo que diga el `KeyInfo` del XML que está verificando (la Task 1 verifica el ejemplo con el `RSAKeyValue`, porque su certificado es de otra llave).

**Casos:**
- Firmar un nodo y verificarlo con el mismo verificador que `firma-sii.spec.ts`: `true`.
- El `<Documento>` firmado verifica **suelto** (en su `<DTE>` aislado) y **dentro de un sobre** que declara los mismos namespaces que el `<DTE>` (regla de la Task 1).
- El `KeyInfo` resultante tiene `RSAKeyValue` y `X509Certificate`.
- Alterar un carácter del nodo firmado hace fallar la verificación.
- Un pfx con clave equivocada → `CERTIFICADO_INVALIDO`.
- **Verificación cruzada:** la forma del `<Signature>` generado, ignorando los valores, es la misma que la del ejemplo del SII: mismos elementos, en el mismo orden y con los mismos `Algorithm`.

---

### Task 8: El sobre `EnvioBOLETA` y la API pública

> ⛔ **No empezar hasta que las Tasks 6 y 7 estén cerradas.**

**Files:**
- Create: `backend/src/modules/dte/envio-boleta.ts`
- Create: `backend/src/modules/dte/dte.module.ts`, vacío de providers; registrar en `app.module.ts` solo si el patrón del repo lo pide para un módulo sin controller. Mirar cómo está `calculo-precios`.
- Test: `backend/src/modules/dte/envio-boleta.spec.ts`

**Interfaces (la API que va a usar el subproyecto 4):**

```ts
export interface BoletaEmitida {
  /** El <DTE> firmado, como texto; los bytes al SII salen de aLatin1. */
  xml: string;
  folio: number;
  diferenciaIvaRedondeo: string;
}
export function emitirBoleta(
  datos: DatosBoleta,
  credenciales: { caf: CafLeido; certificado: ReturnType<typeof leerCertificado> },
  ahora: string, // ISO local de Chile: TSTED y TmstFirma
): BoletaEmitida;
export function armarEnvioBoleta(
  boletas: BoletaEmitida[],
  caratula: { rutEmisor: string; rutReceptor: '60803000-K'; fchResol: string; nroResol: number },
  certificado: ReturnType<typeof leerCertificado>,
  ahora: string,
): string; // EnvioBOLETA firmado
```

**Intención:**
- `emitirBoleta` arma el TED (Task 6), el `<Documento>` (Task 5), el `<DTE version="1.0">` con las mismas declaraciones de namespace que la raíz del sobre (regla de la Task 1) y firma el `Documento` (Task 7).
- `armarEnvioBoleta`:
  - valida el tamaño: 0 → `ENVIO_VACIO`, más de 500 → `ENVIO_DEMASIADAS_BOLETAS`;
  - arma la `Caratula`: `RutEmisor`, `RutEnvia` = RUT del certificado, `RutReceptor` = `60803000-K` (el SII), `FchResol`, `NroResol`, `TmstFirmaEnv` y `SubTotDTE` por tipo;
  - mete los `<DTE>` en el `SetDTE ID="SetDoc"`, lo firma y antepone `<?xml version="1.0" encoding="ISO-8859-1"?>`.

**Casos:**
- Boleta afecta, exenta y mixta, de punta a punta. Cada una:
  - valida contra el XSD (la copia v4.2);
  - verifica la firma del `Documento` y del `SetDTE`, y el `FRMT`;
  - se vuelve a verificar **después de pasar por `aLatin1` y releer como latin1** (**Review Focus 1**: emisor "Panadería Ñuñoa SpA", comuna "Peñalolén");
  - la firma del `Documento` verifica **las dos veces**: sobre el `<DTE>` aislado y dentro del `EnvioBOLETA` ya armado. El `<DTE>` lleva las mismas declaraciones de namespace que la raíz del sobre (`xmlns="http://www.sii.cl/SiiDte"` y `xmlns:xsi`), regla de la Task 1; sin ella, la verificación dentro del sobre falla como falla la del ejemplo de 2003.
- Sobre con tres boletas (39, 39, 41): `SubTotDTE` da 2 de tipo 39 y 1 de tipo 41.
- Sobre con 500 boletas: sale. Con 501, o vacío: error con su código (**Review Focus 5**). Las 500 se generan con un mismo CAF de rango 1–600; si tarda más de 10 s, se arman los `<DTE>` sin firmar para ese caso y se anota el porqué.
- Góndola $993: la boleta sale con `diferenciaIvaRedondeo` = `'1'`.
- Todo `DteError` de las tasks anteriores sale por `emitirBoleta` sin envolverse: el código llega intacto.
- **Mutante:** firmar el `SetDTE` antes de meter los `<DTE>`. Tiene que caer la verificación del sobre. Revertir.

---

### Task 9: Documentación y cierre

**Files:**
- Create: `docs/adr/0NN-emisor-dte-propio.md` con el siguiente número libre (hoy sería el 033; otra sesión puede haberlo tomado) y su fila en `docs/adr/README.md`.
- Create: `docs/features/emision-electronica.md` (desde `TEMPLATE.md`) y su link en `docs/README.md`.
- Modify: `docs/ESTADO.md`, que gana una fila.
- Modify: `docs/agent/desarrollo-nuevo.md`: la entrada del emisor marca el subproyecto 2 como hecho, con fecha y SHA, y los otros siguen abiertos.
- Modify: `docs/superpowers/plans/2026-10-14-motor-boleta-electronica.md`, que pasa a `Status: Done`.

**Contenido:**
- **El ADR nuevo** cierra el diferimiento de ADR-010 para la boleta: construir el emisor propio, por qué (la investigación y las decisiones del owner del 2026-10-14) y las consecuencias (certificación por contribuyente, sin atajo de proveedor autorizado hasta tener 10 contribuyentes habilitados y 6 meses emitiendo). ADR-010 gana un puntero en "Diferir explícitamente".
- **`emision-electronica.md`:**
  - qué hace el motor;
  - las reglas de montos ("verifica, no calcula", el aviso del peso de la góndola);
  - texto ISO-8859-1 sin cortar;
  - lo que **no** hace: guardar, folios usados, envío, ILA, factura;
  - el hallazgo de la Task 1, en una línea.
- **`ESTADO.md`:** "Motor de la boleta electrónica (sin envío)", ✅ con la fecha. Aclara que **todavía no se emite nada al SII**.

**Gate (checklist de `CLAUDE.md`):**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```

- No hay e2e relacionados: no hay endpoint, entidad ni service tocados.
- Playwright **no aplica** solo si el diff cae entero en la lista de 🎭. `backend/src/` no está en esa lista, así que **sí aplica la regla**. Como el módulo no lo importa nadie, los specs "relacionados" son cero: se dice explícitamente en el cierre y CI corre la suite entera.
- Revisión independiente con el skill `verify-feature`. El revisor (`domain-reviewer`) corre con `model: 'sonnet'`, sin mutantes y sin tocar la base (memorias *modelo explícito en subagentes* y *el revisor muta el working tree*).
- Commit de docs en `main`, push, y mirar el CI por SHA (memoria *CI: el run se elige por SHA*).
