# ADR-010: Preparación para SII — capturar y congelar el dato fiscal ahora, diferir la integración

**Status**: Accepted

**Date**: 2026-07-14

## Context

El sistema emitirá documentos tributarios electrónicos al SII (Chile) **en el futuro, no
ahora**. Aún no se conoce el detalle: qué documentos exactos, proceso de certificación,
timing. Hoy la impresión es física vía QZ Tray, sin DTE.

Existe la tentación de dos extremos, ambos malos:
- **No pensar en SII**: modelar el dato fiscal de forma laxa (p. ej. "exento = no asignar
  impuesto") y descubrir después que la información necesaria para el DTE nunca se capturó.
  Un hecho fiscal no registrado en el momento de la venta **se pierde para siempre**.
- **Sobre-construir**: crear tablas DTE, esquemas XML y gestión de CAF/folios a medias
  ahora, sin conocer la certificación. Es re-trabajo casi seguro (YAGNI).

## Decision

Se adopta como **regla transversal**: **capturar y congelar todo hecho fiscal en el momento
de la transacción; diferir todo lo que solo transmite o formatea esos hechos.** Se diseña
todo compatible con SII, sin integrarlo.

### Hacer ahora (invariantes fiscales — barato, evita migraciones)
- **Naturaleza del impuesto explícita**: `impuestos` lleva una clase (`afecto_iva` |
  `exento` | `adicional`). "Exento" es un estado explícito, **no la ausencia de fila** en
  `item_impuestos` (que hoy es ambigua entre "exento por ley" y "afecto sin IVA asignado").
- **Snapshot fiscal inmutable por venta**: congelar en la venta los baldes `neto afecto /
  monto exento / IVA / adicionales`. Una venta emitida no se recalcula (mismo criterio que
  el kardex inmutable, [ADR-007] y punto 2.2 del análisis food-service).

  ⚠️ **Actualización 2026-09-04 — la nota de crédito también es un documento, y hasta ese día
  no tenía snapshot.** Guardaba `total_bruto = total_final = el monto` con impuestos en cero y
  sin una fila de desglose: un documento fiscal que no declaraba ni su neto ni su IVA. Ahora se
  compone —líneas, neto e IVA— **derivando de los importes congelados de la venta que corrige**,
  no del catálogo vigente: `item_impuestos` es por ítem, así que dos líneas afectas de la misma
  venta pueden llevar impuestos distintos y no existe "la tasa" que leer. Es el mismo principio
  de este ADR aplicado un nivel más abajo: la NC hereda el criterio de aquel documento, no el de
  hoy. Detalle en [`features/reembolsos-nota-credito.md`](../features/reembolsos-nota-credito.md).

  ✅ **La FORMA del rechazo se revirtió el mismo día y ya está construida** (owner, 2026-09-04).
  Una investigación sobre el Formato DTE v2.5 y la Res. Ex. SII N°45/2003 mostró que **la norma
  no lo respalda**: en la Zona Detalle de una nota de crédito solo `NroLinDet`, `NmbItem` y
  `MontoItem` son obligatorios —**cantidad y precio unitario son condicionales**— y el SII **no
  valida el contenido** (cinco causales cerradas de rechazo, ninguna sobre el detalle). Una NC
  por monto que no enumere la mercadería es un DTE válidamente formado. Devolver mercadería que
  vale más que la nota **se acepta**: las líneas se escalan a prorrata y el motivo pasa a ser
  obligatorio. Cerrado en [`resueltos.md`](../agent/resueltos.md).
  📌 **El tope por porción, en cambio, sigue vigente, y por otra razón: es invariante fiscal, no
  preferencia de producto.**

  **Dos decisiones que salieron de construirlo, las dos fiscales:**
  - **Ninguna porción se acredita dos veces.** El tope de reembolso mira el bruto y no ve la
    porción, así que una nota por monto libre se comía capacidad afecta y la devolución
    siguiente la volvía a usar: cada documento cerraba bien y la **serie** acreditaba más IVA
    del que la venta cobró (medido: 1.447 contra 1.330). Hay un segundo tope, por porción.
  - **Queda un residuo de cuantización de hasta 2 minor units de IVA** en series de varias
    notas, porque cada documento cierra a la escala de la moneda. **Se acepta** (owner,
    2026-10-02, con la escena de varias boletas de una venta; la orquestadora lo extendió a la
    serie de notas por la misma razón): cada documento calcula su IVA sobre su propio monto, y
    el SII suma documentos, no ventas. Sacarlo exigiría derivar el neto de cada nota contra el
    remanente de la serie; no se hace. Detalle en `docs/agent/resueltos.md`.
- **Tipo de documento tributario por venta**: ya existe `tipos_documento_tributario` por
  país (33 factura, 39 boleta, 61 NC); la venta debe guardar cuál fue.

  ⚠️ **Actualización 2026-09-03 — "por país" no alcanzaba si el código lo ignora.** La tabla
  era por país desde el principio, pero el flujo de reembolso resolvía la nota de crédito con
  una **constante** apuntando a la fila chilena, así que un tenant argentino congelaba un
  documento de otro país: la regla estaba en el esquema y rota en el código. Ahora la fila la
  marca el propio catálogo (`es_nota_credito`) y se resuelve por el país del tenant.
  **La lección generaliza:** un dato fiscal "gobernado por el país" hay que verificarlo en el
  camino que lo escribe, no solo en la tabla que lo guarda.
- **Datos de emisor/receptor disponibles**: RUT + giro del receptor para factura; el modelo
  `customer`/`terceros` debe poder alojarlos.

  ✅ **Actualización 2026-10-03 — la Factura congela el receptor completo.** La norma (Formato
  DTE v2.5, zona Receptor) pide más que RUT y giro: también razón social, dirección y **comuna**,
  con largos máximos. `venta_customer` y `terceros` ganan `giro` y `comuna`; en Chile la Factura
  no se crea sin los cinco, el RUT se valida (DV) y se congela normalizado, y los largos del SII
  se imponen al capturar —el sistema no trunca, porque lo emitido tiene que ser igual a lo
  congelado—. Otros países, en pausa. Detalle en [`features/ventas.md`](../features/ventas.md).

  ⚠️ **Actualización 2026-10-02 — la venta también registra qué documentos tiene y quién los
  emitió.** Hasta ese día la venta llevaba solo una etiqueta (`tipo_documento_id`). Ahora cada
  venta deja, al crearse, una fila por documento en `venta_documentos` —del sistema, de la
  máquina de tarjeta, del otro facturador del comercio o la constancia de que nadie lo
  emite—, con sus baldes congelados a prorrata y **sin folio** (el número es un dato externo).
  Es el mismo principio de este ADR aplicado al documento: congelar el hecho en la
  transacción, diferir el envío. Un matiz sobre los baldes de arriba: el documento congela
  `neto afecto`, `exento` y **un solo** monto de impuestos (la venta no guarda IVA y adicionales
  por separado). Decisión y razones en
  [ADR-028](./028-emision-registrada-por-venta.md).

  ⚠️ **Actualización 2026-10-03 — un hecho fiscal fuera de una venta: la cortesía.** Regalar un
  plato es un retiro gravado (DL 825 art. 8 d) y hasta ese día no dejaba nada. Ahora la
  anulación con motivo cortesía congela los mismos tres baldes que ADR-028
  (`cuenta_linea_anulaciones.monto_afecto/monto_exento/monto_impuestos`, solo el IVA), con base
  en el precio de carta. Es esta regla aplicada a algo que no es una venta: se congela el hecho
  al retirar y **se difiere el documento** (owner: *"Guardar el IVA ya"*). El emisor del retiro
  tiene que leer esos baldes, igual que los de una venta. Detalle:
  [`features/salones-mesas.md`](../features/salones-mesas.md#la-cortesía-como-retiro-gravado-2026-10-03).

### Diferir explícitamente (NO construir ahora)
- Generación del XML del DTE y web service del SII.
- Folios / CAF (el SII asigna rangos). **Regla de diseño: la PK interna ≠ folio; mantener
  "folio" como concepto separable del ID interno.**
- Certificado digital y firma del DTE.
- Reglas exactas de redondeo del IVA del SII (el motor ya usa Decimal.js con redondeo
  configurable; se afina en la certificación).

  ⚠️ **Actualización 2026-08-21 — este diferimiento dejó de ser neutro.** El cierre del
  redondeo de plata tuvo que decidir *una* regla ahora, y decidió que con precio de
  góndola el total cierra a la etiqueta y **el IVA absorbe el residuo**. Consecuencia:
  `ventas_impuestos.valor_aplicado` puede diferir de `porcentaje_aplicado × base` en un
  peso. **El emisor del DTE tiene que leer el balde congelado, nunca recalcularlo desde la
  tasa.** Si la certificación exige `IVA = tasa × base` por línea, esa decisión se
  revierte: queda registrada como **deuda de revisión conocida**, con el detalle y el
  segundo motivo —independiente— en
  [`features/impuestos.md`](../features/impuestos.md).

## Consequences

### Positive
- Los datos históricos quedan completos y no ambiguos: cuando la integración entre, se
  emite sobre datos correctos sin migración retroactiva imposible.
- El bucketizado neto/exento/IVA/adicionales queda listo para poblar `MntNeto`/`MntExe`/
  `IVA` del DTE.
- Se evita construir infraestructura DTE especulativa antes de conocer la certificación.

### Negative
- Hay que modelar la naturaleza del impuesto y el snapshot fiscal aunque hoy no se emita —
  costo de diseño sin beneficio inmediato visible para el usuario.

### Neutral
- El detalle fino (redondeo SII, estructura exacta del DTE, gestión de CAF) queda
  deliberadamente abierto hasta que la emisión electrónica entre al alcance; se documentará
  en un ADR posterior en ese momento.
