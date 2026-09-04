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

  ⛔ **La FORMA del rechazo quedó reabierta el mismo día** (owner, 2026-09-04): los dos caminos
  —mostrador y pasarela— hacen cosas distintas con el mismo hecho, porque por la pasarela el
  chequeo llega después de que la plata salió. Lo que sigue vale como invariante fiscal; **cómo
  se le presenta al operador está sin decidir**, en `pendientes.md` § 4.

  **Dos decisiones que salieron de construirlo, las dos fiscales:**
  - **Ninguna porción se acredita dos veces.** El tope de reembolso mira el bruto y no ve la
    porción, así que una nota por monto libre se comía capacidad afecta y la devolución
    siguiente la volvía a usar: cada documento cerraba bien y la **serie** acreditaba más IVA
    del que la venta cobró (medido: 1.447 contra 1.330). Hay un segundo tope, por porción.
  - **Queda un residuo de cuantización de hasta 2 minor units de IVA** en series de varias
    notas, porque cada documento cierra a la escala de la moneda. **Sacarlo es decisión del
    owner y no está tomada**: exigiría derivar el neto de cada nota contra el remanente de la
    serie en vez de contra su propio bruto.
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
