# ADR-033: Emisor de DTE propio — el motor de la boleta se construye en el repo, sin proveedor

**Status**: Accepted

**Date**: 2026-10-14

## Context

[ADR-010](./010-preparacion-sii-datos-fiscales.md) difirió la generación del XML del DTE, los
folios/CAF y la firma "hasta que la emisión electrónica entre al alcance", y dijo que el detalle
se documentaría en un ADR posterior. Hoy entra: la boleta (39/41) es el documento que un
restaurante o un almacén emite todo el día, y sin ella el sistema registra el hecho fiscal
([ADR-028](./028-emision-registrada-por-venta.md)) pero no lo emite.

Había dos caminos, y la [investigación del 2026-10-13](../agent/investigaciones/2026-10-13-emision-electronica-sii.md)
los midió:

- **Comprar**: un proveedor con API de partner (SimpleFactura, Folyo) o "traiga su cuenta"
  (OpenFactura). OpenFactura exige una API key por contribuyente y sus términos prohíben
  revender; Folyo es un SDK de julio de 2026 (v0.2).
- **Construir**: XML, timbre (TED), firma y sobre propios.

Lo que pesó, de lo medido:

- **La certificación es por contribuyente, no por software** (FAQ del SII). Cada tenant pasa la
  suya, se compre o se construya; lo que cambia es quién la hace.
- **El atajo del proveedor autorizado de boleta no existe todavía**: el SII lo da con 10
  contribuyentes habilitados y 6 meses emitiendo. Un emisor propio nuevo entra por el camino lento
  con cada cliente.
- **La boleta es más chica de lo que parece**: el resumen diario (RCOF/RVD) está derogado desde
  el 2022-08-01 (Res. 53/2022) y el timbre impreso es opcional desde el 2026-01-01.
- **Las librerías abiertas no sirven tal cual**: `@devlas/dte-sii` implementa el RCOF derogado y
  es de marzo de 2026; LibreDTE es AGPL.

## Decision

**Se construye el emisor propio, empezando por la boleta y por el motor** (owner, 2026-10-14, por
AskUserQuestion con el costo de cada opción). Seis subproyectos, cada uno con su spec, plan y
verificación (`docs/agent/desarrollo-nuevo.md`): perfil fiscal, **motor**, cliente del SII y cola
de envío, conexión con la venta y la nota de crédito, certificación, intercambio de factura.

Este ADR cierra el diferimiento de ADR-010 para **el XML, el timbre y la firma de la boleta**. El
resto del diferimiento sigue abierto (ver Consequences).

Las decisiones que lo moldean, todas del owner el 2026-10-14:

| Decisión | Elegida | Descartada |
|---|---|---|
| Primer documento | Boleta (39/41) | Factura + NC + ND: la certificación exige las tres juntas y la ND no existe en el sistema |
| Orden | Motor primero, como función pura | Perfil fiscal primero, o los dos juntos |
| Librería | Código propio sobre `node-forge` + `xml-crypto` (+ `@xmldom/xmldom` como parser) | `@devlas/dte-sii`, LibreDTE |
| RUT piloto | No hay: se prueba contra los XSD y la certificación espera | Frenar hasta tenerlo |
| Validación XSD | En las pruebas, con `xmllint-wasm` (solo desarrollo) | `xmllint` del sistema, que no está en el contenedor Alpine |
| Nombre del ítem fuera de norma | El motor **rechaza**; se limita el catálogo | Cortar o reemplazar caracteres en el motor |
| Certificado del dueño | Se guarda cifrado; la consulta legal o al SII va en paralelo | Frenar el diseño |

**Nota (2026-10-15):** la fila "Validación XSD" ya no vale tal cual. `xmllint-wasm` pasa a
`dependencies` (versión fija 5.3.0, aprobado por el owner) porque el job de envío valida el sobre
contra el esquema antes de mandarlo (subproyecto 4, frente 3; ver
[`emision-electronica.md`](../features/emision-electronica.md) § Antes de enviar: el esquema). La
decisión original queda como se escribió.

El motor vive en `backend/src/modules/dte/` como **funciones puras**: no lee la base, el reloj ni
la red. El módulo de Nest nació con el primer service, el del perfil fiscal (subproyecto 1, hecho
el 2026-10-14), que guarda el certificado, los CAF y la cuenta de folios; el motor sigue siendo
puro. Detalle y reglas: [`features/emision-electronica.md`](../features/emision-electronica.md).

### El certificado y los CAF se cifran con una clave propia

**Se cifran con `DTE_ENCRYPTION_KEY`**, no con `PASARELA_ENCRYPTION_KEY` (owner, 2026-10-14). El
formato es el de [ADR-008](./008-cifrado-credenciales-pasarela.md) (`v1:<iv>:<tag>:<data>`,
AES-256-GCM, 32 bytes en base64) y el único punto que lo usa es `CifradoDteService`. Por qué
separada:

- la llave privada del certificado firma en nombre de la empresa y la del CAF timbra sus folios:
  si se filtra la clave de la pasarela, esas no deben caer con ella, ni al revés;
- cada clave se rota por separado.

Operación:

- **Sin la variable el backend no arranca**, igual que con la de la pasarela. En Railway hay que
  cargarla **antes** del push que la exige, con `openssl rand -base64 32` y un valor distinto del
  de `.env.example` (ese es de desarrollo y de CI).
- **Rotarla es manual, como en ADR-008, y no hay script**: descifrar con la clave vieja
  `dte_certificados.credencial_cifrada` y `dte_cafs.xml_cifrado` (las dos columnas que cifra este
  módulo; la primera es nula en los certificados reemplazados) y volver a cifrar con la nueva, en una
  sola transacción, antes de cambiar la variable. Perder la clave sin respaldo deja el
  certificado y los CAF ilegibles.

## Consequences

### Positive

- El hecho fiscal congelado por ADR-010 y ADR-028 tiene destino: el motor lo verifica y lo
  emite tal cual, sin recalcularlo (el IVA absorbe el residuo de la góndola, [`features/impuestos.md`](../features/impuestos.md)).
- Sin dependencia de un proveedor ni de su precio por documento; la custodia del certificado y de
  los folios es nuestra.
- El motor se prueba entero sin red ni RUT: XSD, firmas y timbre se verifican en pruebas.

### Negative

- **Cada tenant pasa su propia certificación** (set de pruebas de boleta, 10–15 días hábiles de
  revisión), y la hace quien opere el sistema. No hay atajo hasta cumplir 10 contribuyentes
  habilitados y 6 meses emitiendo.
- **Varias reglas de forma se infirieron, no se leyeron**, porque el ejemplo oficial es de 2003
  y el XSD publicado (v11) es anterior al formato v4.2. Hay riesgos abiertos que solo la
  certificación confirma (lista en la doc de la feature). Si el SII exige otra forma, el arreglo
  está acotado a una constante o a un par de elementos del XSD, pero se descubre tarde.
- Se asume la mantención del formato: entre 2023 y 2025 el SII agregó campos a la boleta
  (`MedioPago`, `CorreoRecep`, `TelefonoRecep`, `RutProvSW`, `RznSocProvSW`) sin publicar un XSD
  nuevo.

### Neutral

- **La venta ya emite la boleta (2026-10-15, subproyecto 4, frente 1), pero nada de lo emitido tiene
  validez ante el SII** hasta la certificación (subproyecto 5). Con el interruptor del tenant
  prendido, la venta toma el folio del perfil (1), arma y firma con el motor (2) y encola para la
  cola y el cliente del web service del SII (3). Faltan la nota de crédito electrónica (frente 2, en pausa
  hasta consultar al SII) y reemitir una rechazada (espera las preguntas 1 y 2 de la
  [investigación](../agent/investigaciones/2026-10-15-boleta-rechazada-o-atrasada.md)); la pantalla
  de atrasadas y rechazadas (frente 3) se hizo el 2026-10-15.
- **El ILA no se informa en la boleta, y eso es la regla, no un diferimiento** (decisión del owner,
  2026-10-14): para el local que vende al público el ILA es costo, no un impuesto de su venta, así
  que el motor rechaza con código (`IMPUESTO_ADICIONAL_NO_SOPORTADO`) un ítem con adicional. Lo que
  sigue en pausa es el ILA en el catálogo, habilitable por tenant, y la factura del contribuyente
  afecto (`docs/features/emision-electronica.md` § Decidido por el owner).
- Dependencias nuevas, aprobadas por el owner: `node-forge`, `xml-crypto` y `@xmldom/xmldom` en
  producción; `xmllint-wasm` solo en desarrollo. **Nota (2026-10-15):** `xmllint-wasm` 5.3.0 pasó
  a producción, aprobado por el owner, para que el job de envío valide el sobre antes de mandarlo.
