# Descomposición fiscal (neto/IVA/total) de una nota de crédito por monto — investigación

**Fecha:** 2026-08-22
**Estado:** 🔎 Investigación cerrada — **insumo, no diseño**. No se tocó código ni ningún otro
`.md` del repo.
**Dispara esta pasada:** medido en `ventas.service.ts` → `crearNotaCredito` hardcodea
`totalDescuentos/totalRecargos/totalImpuestos = '0'` y `totalBruto = totalFinal =
params.monto`; cero filas en `ventas_descuentos/ventas_recargos/ventas_impuestos`;
`config_calculo` queda `null`.
**Investigaciones relacionadas (no se repite lo que ya cerraron):**
[`2026-07-27-anulacion-y-notas-credito.md`](2026-07-27-anulacion-y-notas-credito.md) (medio
de devolución, tope documental, void vs. refund) ·
[`2026-08-15-decimales-y-redondeo.md`](2026-08-15-decimales-y-redondeo.md) (por-línea vs.
por-total, `PayableRoundingAmount`) ·
[`2026-08-21-descuento-global-vs-base-del-iva.md`](2026-08-21-descuento-global-vs-base-del-iva.md)
(prorrateo a líneas, `IndExeDR`, residuo con `elegirAbsorbente`).

> ⛔ **Método** (`docs/agent/investigacion-mercado.md`): lo que trae esta pasada es **insumo
> para cruzar y adaptar, nunca verdad a copiar**. Si el mercado dice A y nuestro modelo (o el
> owner) dice B, **gana B**. Nada de lo de acá es diseño ni decisión.

---

## 1. Qué se preguntó y por qué

`crearNotaCredito` emite una NC **por monto** (`params.monto`), con `devoluciones` de línea
**opcionales y sueltas** del monto — o sea, el monto de la NC puede no corresponder a un
conjunto limpio de líneas de la venta original. Hoy esa NC no pasa por el motor de precios:
copia el monto entero a `totalFinal` y pone en cero descuentos, recargos e impuestos. La
pregunta de mercado: **¿cómo resuelven otros la descomposición neto/IVA/total cuando el
reembolso es por un monto que no está atado 1:1 a líneas?**

---

## 2. SII / DTE 61

Fuente primaria leída completa: **Formato DTE v2.5 (2026-02)**, el PDF oficial del SII
(`sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf`), extraído con
`pdftotext -layout` porque el fetch HTML no renderiza el binario. Y la guía paso a paso del
portal gratuito del SII para "Nota de Crédito Electrónica Corrige Monto".

### 2.1 Base legal y códigos de referencia — [NORMA], texto literal

La guía oficial del SII cita la base: *"La emisión de Notas de Créditos Electrónicas se
encuentra normada por la regla general de emisión de Notas de Crédito y Débito, establecida
en el Art. 57 del D.L. N° 825 y en el Art. 71 del Reglamento de la Ley sobre Impuesto a las
Ventas y Servicios."*
→ [Guía SII — Corrige monto de una Factura](https://www.sii.cl/destacados/factura_electronica/guias_ayuda/nota_credito_corrige_monto_fe.pdf)

El campo `<CodRef>` (Formato DTE, sección E, campo 8) tiene tres valores, texto literal:

> *"1: Anula Documento de Referencia · 2: Corrige Texto Documento de Referencia · 3: Corrige
> montos"*

Con una distinción que no suele citarse: los casos **a) NC que elimina el documento completo**,
**b) NC que corrige un texto** y **c) ND que elimina una NC completa** *"DEBEN TENER UN ÚNICO
DOCUMENTO DE REFERENCIA"* — el texto no repite esa restricción para el caso **d) "Notas de
crédito o débito que corrigen montos de otro documento"**. ⚠️ No verificado si eso implica que
una NC tipo "corrige montos" *puede* referenciar más de un documento; el texto simplemente no
lo prohíbe donde sí lo hace para los otros tres casos.

### 2.2 La zona Detalle es obligatoria SIEMPRE — incluida la NC — [NORMA]

La tabla oficial "OBLIGATORIEDAD DE LA ZONA SEGÚN TIPO DE DOCUMENTO" (Formato DTE, secc. 2.1)
marca **Detalle = 1 (obligatorio)** para los diez tipos de documento, Nota de Crédito
incluida, sin excepción. **No existe un DTE 61 sin al menos una línea de detalle** — la norma
no contempla "una NC que sea solo un total sin ninguna línea".

Lo que el formato no dice es si esa línea tiene que corresponder a un ítem real de la venta
original o si alcanza con una línea genérica de ajuste (ver §4, donde el mercado chileno sí
resuelve esto en la práctica).

### 2.3 Neto/Exento/IVA son "condicionales"; solo el Total es incondicional — [NORMA]

Tabla de campos, zona Totales (secc. 2.2), columna de obligatoriedad para **NOTA CRED**:

| Campo | Obligatoriedad en NOTA CRED | Significado |
|---|---|---|
| `<MntNeto>` (monto neto) | **2** — condicional | no siempre; se vuelve obligatorio "en determinadas operaciones" |
| `<MntExe>` (monto exento) | **2** — condicional | ídem |
| `<TasaIVA>` | **2** — condicional | ídem |
| `<IVA>` | **2** — condicional | ídem |
| `<MntTotal>` | **1** — obligatorio, y además marcado con `*` | rechazo si falta, en **todos** los tipos de documento sin excepción |
| `<CodRef>` | **1** — obligatorio | |
| `<FolioRef>` (folio del documento referenciado) | **1** — obligatorio | |
| Zona "Información de Referencia" completa | **1** — obligatorio | a diferencia de Factura, donde es **2** (condicional) |

Fuente: Formato DTE v2.5, tablas de las secciones 2.1 y 2.2 (campos 4, 8, 107, 108, 111, 112,
124). La leyenda oficial de los códigos, texto literal:

> *"0: No corresponde... 1: Dato obligatorio... 2: Dato condicional. El dato no es obligatorio
> en todos los documentos, pero pasa a ser obligatorio en determinadas operaciones si se
> cumple una cierta condición. Por ejemplo, si hay descuentos o recargos, éstos deben estar
> registrados porque en caso contrario el documento estará descuadrado en cuanto a los montos
> de neto, IVA y Total... 3: Opcional."*

**Lectura directa de la pregunta del brief — "¿puede un DTE 61 declarar solo un total sin
descomponer?":** estructuralmente, sí puede — Neto/Exento/IVA no son obligatorios
incondicionalmente, solo el Monto Total lo es. La "condición" que los vuelve obligatorios es
**consistencia interna** ("que no quede descuadrado"), no una regla que diga "toda NC declara
neto e IVA siempre".

### 2.4 El SII no valida la aritmética al recibir el documento — [NORMA], matiz importante

Texto literal, sección 2.1: *"No se rechazan documentos por errores de contenido por ejemplo
errores como que el IVA no sea igual a la tasa del IVA por el Monto neto; las correcciones a
este tipo de errores deberán ser hechas vía Nota de Crédito o Nota de Débito."*

O sea: el validador de esquema del SII comprueba estructura (campos presentes, tipos, largos),
no que `IVA = MntNeto × TasaIVA` ni que `MntTotal = MntNeto + IVA + MntExe`. Si esa cuenta no
cierra, el documento **se acepta igual** y el error se arrastra hasta que alguien lo corrija
con otra NC/ND. Esto ya lo había encontrado (como hueco sin resolver, con fuentes
contradictorias) la investigación del 2026-08-21 — acá quedó **confirmado contra la fuente
primaria completa**, no solo el fragmento.

### 2.5 NC parcial sobre boleta afecta — ⚠️ no verificado contra fuente primaria

Una búsqueda encontró que el campo `<TpoDocRef>` identificaría boleta afecta con el código
`39` y `<FolioRef>` el folio original — consistente con la tabla de `<TpoDocRef>` que sí leí
completa en el Formato DTE (que además lista `39: Boleta Electrónica`, `41: Boleta Exenta
Electrónica`). Pero esa lectura específica salió de un resumen de búsqueda, no de haber
abierto yo la fuente primaria que la sustenta. **Marcar como no verificado directamente**,
aunque es coherente con lo que sí verifiqué en la tabla de `<TpoDocRef>`.

---

## 3. POS internacionales

**El eje que separa a los cuatro no es el algoritmo de prorrateo — es itemizado vs. por
monto**, y ninguno de los cuatro documenta un prorrateo automático del segundo caso.

### Square — el "custom/partial refund" queda fuera del ledger de impuestos [documentado oficialmente]

> *"The amount you are debited will be proportional to the partial refund amount requested."*
> Pero: *"partial refunds will not include tax and tips in reporting."*
> En cambio, un reembolso **itemizado**: *"the amount being refunded will reflect any
> applicable taxes (like a sales tax) and discounts for the selected items."*
→ [Square — Manage customer refunds](https://squareup.com/help/us/en/article/6116-process-refunds)

El objeto `Refund` de la API sí tiene campos separados de impuesto (`additive_tax_money`,
`inclusive_tax_money` aparecen referenciados en foros de desarrolladores de Square), pero no
pude confirmar contra la referencia oficial **cuándo esos campos vienen poblados y cuándo
vacíos** para un refund no-itemizado — queda como hueco, no como hallazgo.

### Toast — "Custom amount" explícitamente NO desglosa neto/impuesto [documentado oficialmente]

Toast ofrece cuatro tipos de reembolso: *By item, Entire check, Tax only, Custom amount.*
Texto literal sobre el cuarto: *"Custom amount refunds are not tied to specific items, so they
affect top-level net sales and tips figures only — they do not break down by sales
category..."*
→ [Toast — Issuing a Refund (platform guide)](https://doc.toasttab.com/doc/platformguide/adminIssuingARefund.html)
· [Toast — Refunds FAQ](https://support.toasttab.com/en/article/Refunds-FAQ)

### Clover — el reembolso parcial con impuesto está estructuralmente prohibido fuera del camino itemizado [documentado oficialmente]

> *"The /v1/refunds endpoint does not support partial refunds for charges that include taxes
> or tips or charges that have more than one line item."*

Para reembolsar parcialmente **con** impuesto hay que usar `/v1/orders/{orderId}/returns`, que
es el camino **itemizado** (devuelve por línea). Clover no ofrece —documentado— un tercer
camino de "monto libre con impuesto prorrateado".
→ [Clover — Refund payments and void transactions](https://docs.clover.com/dev/docs/ecommerce-refunding-payments)

### Lightspeed — sin mecanismo de prorrateo documentado

Lo único encontrado: un *miscellaneous charge* con un monto, que si está marcado como
`taxed` suma impuesto "según cómo estén configuradas las tasas". No hay documentación
oficial sobre cómo se descompone ese impuesto contra la mezcla de tasas de la venta original.
→ [Lightspeed Retail (R-Series) — Refunding and exchanging](https://retail-support.lightspeedhq.com/hc/en-us/articles/229130768-Refunding-and-exchanging)

### Síntesis de esta sección

Ninguno de los cuatro documenta un algoritmo que tome un monto libre y lo prorratee
automáticamente contra la mezcla de tasas/exenciones de la venta original. Los tres que sí
documentan algo (Square, Toast, Clover) **evitan el problema**: excluyen el monto del
desglose fiscal, o fuerzan el camino itemizado.

---

## 4. Mercado chileno

Como anticipa la plantilla del método (`investigacion-mercado.md`, medido 2026-08-02): los
POS chilenos documentan la UI, no el motor. Acá se confirma **con precisión adicional**: el
mecanismo de UI que Bsale documenta contesta directamente parte de la pregunta de fondo.

### Bsale — la decisión "¿esta NC lleva IVA o no?" la toma un humano, transacción por transacción [documentado oficialmente]

Procedimiento textual para "nota de crédito por un monto en específico": crear una **glosa
libre** (no ligada a ninguna línea real de la venta) con el texto sugerido *"Descuento por
ajuste de precio. **Verificar si lleva o no lleva IVA** esta devolución"*, cargar el monto en
el campo `$dif/unidad`, y confirmar. No hay mención de un cálculo automático de prorrateo:
el operador decide manualmente, por cada NC, si ese monto se trata como afecto o exento.
→ [Bsale — ¿Cómo realizar nota de crédito por un monto en específico?](https://ayuda.bsale.io/support/solutions/articles/151000212255--c%C3%B3mo-realizar-nota-de-cr%C3%A9dito-por-un-monto-en-espec%C3%ADfico-)

### Defontana y Nubox — el camino documentado es editar las LÍNEAS del documento original, no declarar un monto suelto

Defontana ("Nota de crédito corrige monto"): el sistema **carga automáticamente** los datos
del documento original y el usuario *"editará los precios por los correctos"* — trabaja sobre
las líneas existentes, no sobre un monto desconectado.
→ [Defontana — ¿Cómo emitir una Nota de Crédito corrige montos?](https://intercom.help/defontanaerp/es/articles/4092681-nota-de-credito-corrige-monto)

Nubox: para una NC parcial se abre el documento original y se **modifica el monto del
servicio o producto** en sus propias líneas (ejemplo: factura de $50.000, se edita la línea
para que la NC resultante sea de $25.000), con motivo "Corrige Monto" en la referencia.
→ [Nubox — ¿Cómo emitir una nota de crédito?](https://help.nubox.com/es/articles/8156785-como-emitir-una-nota-de-credito)

**No se pudo confirmar** el mecanismo interno de cálculo de neto/IVA en ninguno de los dos —
solo el flujo de UI.

### Toteat — sin nada público, confirmado otra vez

Ninguna búsqueda dirigida a Toteat + nota de crédito devolvió documentación propia. Coincide
con lo ya anotado en la investigación del 2026-07-27.

### Patrón chileno, sintetizado

Los tres que sí documentan algo (Bsale, Defontana, Nubox) construyen la NC **editando líneas**
— reales, del documento original, o una glosa libre agregada a mano — nunca tipeando un total
suelto que el sistema descomponga solo. Bsale es el único que hace explícito que la
clasificación fiscal de esa línea (afecto/exento) es una decisión humana por transacción, no
un cálculo derivado.

---

## 5. Casos borde

- **Descuento global mezclado con afecto/exento**: ya resuelto con fuente primaria en
  [`2026-08-21-descuento-global-vs-base-del-iva.md`](2026-08-21-descuento-global-vs-base-del-iva.md) —
  la fórmula del SII segrega `MntNeto` (solo `IndExe=0`) de `MntExe` (solo `IndExe=1`), y el
  emisor **declara**, no deriva, a qué base pega cada descuento (`IndExeDR`). No se repite acá;
  aplica igual a una NC que tuviera que reconstruir esa segregación.
- **Propina**: ya resuelto en
  [`2026-07-27-anulacion-y-notas-credito.md`](2026-07-27-anulacion-y-notas-credito.md) — no es
  hecho gravado, vive fuera de `total_final`, no participa del tope de la NC. No se repite.
- **Múltiples tasas de impuesto**: en Chile el IVA es una tasa única (19%); "múltiples tasas"
  en este sistema solo puede darse por impuestos adicionales (`tipo='otro'`, ej. ILA), que hoy
  el motor ya modela por línea con sus propias tasas — pero **la NC no pasa por el motor**, así
  que cualquier adicional de la venta original queda simplemente sin representar en la NC hoy
  (hallazgo del código, no del mercado — ver hallazgo en §7).
- **NC que suma más que la venta original**: el SII lo prohíbe — *"una NC no puede rebajar más
  de lo que el documento original contenía"* (confirmado en la investigación del 07-27, con
  fuentes SII citadas ahí). Nuestro código ya lo enforcea (`disponible = total_final − Σ
  previas`, bajo lock).
- **NC sobre venta ya parcialmente acreditada**: silencio total del mercado (ya confirmado en
  07-27: "ningún POS chileno documenta públicamente la acumulación exacta de NCs parciales").
  Nuestro código lo maneja con lock + suma de NCs previas contra el mismo `venta_referencia_id`.

---

## 6. Prorrateo y redondeo

Lo que ya está investigado con fuentes primarias en
[`2026-08-21-descuento-global-vs-base-del-iva.md`](2026-08-21-descuento-global-vs-base-del-iva.md)
y [`2026-08-15-decimales-y-redondeo.md`](2026-08-15-decimales-y-redondeo.md) **no se repite**
acá: el patrón de la industria cuando SÍ prorratea es a nivel de **línea**, no de documento
(Square `OrderLineItemAppliedDiscount`, Clover por línea, ejemplo numérico de Sage 300 con
afecto/exento mezclado); no hay estándar único sobre quién absorbe el resto del prorrateo
(Shopify lo asigna a la primera línea; UBL define `PayableRoundingAmount` pero el DTE chileno
no parece tenerlo); y el motor propio ya tiene precedente de un residuo determinista
(`elegirAbsorbente`).

**Lo que esta pasada agrega, específico de notas de crédito por monto:** el prorrateo
automático solo aparece documentado en el mercado cuando el reembolso está **itemizado** —
ligado a líneas concretas de la venta original. Para el caso "monto libre, sin líneas", ningún
actor relevado documenta un prorrateo — lo evitan (§3, §4). El problema de redondeo del
prorrateo (§6 de las investigaciones previas) **presupone que hay prorrateo**; y esta pasada
no encontró a nadie que prorratee un monto libre sin atarlo primero a líneas.

---

## 7. Lo que el mercado NO resuelve

**Ningún actor relevado — Square, Toast, Clover, Lightspeed, Bsale, Defontana, Nubox —
documenta un algoritmo que tome un monto de nota de crédito/reembolso libre, sin ligar a
líneas de la venta original, y lo descomponga automáticamente en neto/exento/IVA prorrateando
sobre la mezcla de tasas y exenciones de esa venta.** La industria resuelve el problema
evitándolo, por tres caminos distintos y ninguno es "prorratear un total suelto":

1. **Excluir el monto del desglose fiscal** (Square "partial refund", Toast "custom amount"):
   el monto sale de caja pero no se declara con impuesto propio.
2. **Prohibir el camino y forzar itemizar** (Clover: `/v1/refunds` rechaza reembolsos
   parciales con impuesto; hay que ir por `/returns`, que es por línea).
3. **Delegar la clasificación fiscal a un humano, por transacción** (Bsale: el operador
   marca a mano si la glosa libre "lleva o no lleva IVA").

Esto es candidato directo para `docs/DIFERENCIADORES.md` **si el sistema termina resolviendo
esto con un mecanismo propio** — no se agregó ahí en esta pasada porque la instrucción de esta
tarea fue no tocar ningún archivo fuera de este. Queda anotado acá para que no se pierda.

---

## 7 bis. Las otras tres autoridades — ARCA, DIAN y SAT (agregado 2026-09-03)

**Por qué se agregó.** Esta investigación se corrió cuando el producto se pensaba solo para
Chile, y la conclusión de la § 2 —*"el SII no valida la aritmética, así que emitir una NC sin
descomponer se acepta igual"*— **no sobrevive** al mirar los otros tres países. El owner pidió
relevarlos el 2026-09-03, después de que el frente de la nota de crédito por país dejara claro
que AR/CO/MX **van a emitir de verdad, progresivamente**.

### Argentina (ARCA / WSFEv1) — el espejo exacto de Chile · **[PRIMARIA]**

Manual del desarrollador RG 4291, v4.7, extraído completo con `pdftotext -layout` y leído acá.

**1. No existe zona Detalle.** La estructura `FECAEDetRequest` **no tiene ningún array de
líneas**: lleva `Concepto`, documento del receptor, numeración (`CbteDesde`/`CbteHasta`),
fechas, los importes, `CbtesAsoc`, `Tributos`, `Iva` y `Opcionales`. Nada más. El propio ARCA
describe el servicio como para comprobantes *"sin detalle de ítem"*.

**2. Los importes desagregados son obligatorios.** `ImpTotal`, `ImpTotConc`, `ImpNeto`,
`ImpOpEx`, `ImpTrib` e `ImpIVA` están **todos** marcados `S` en la columna *Obligatorio*.

**3. La aritmética SÍ se valida, y con rechazo.** Código de error **10048**, texto literal:

> *"El campo 'Importe Total' `<ImpTotal>`, debe ser igual a la suma de ImpTotConc + ImpNeto +
> ImpOpEx + ImpTrib + ImpIVA"*

**4. Y el IVA va desagregado por alícuota.** Código **10018**:

> *"Si `<ImpIVA>` es mayor a 0 el objeto `<IVA>` y `<AlicIva>` son obligatorios"*

`AlicIva` lleva `Id` (alícuota del catálogo `FEParamGetTiposIva`), `BaseImp` e `Importe`.

⛔ **Consecuencia directa sobre la pregunta 1 de la § 8.** En Chile se puede emitir una NC
descuadrada porque el SII no revisa la cuenta (§ 2.4). **En Argentina no se obtiene el CAE**:
sin `ImpNeto` e `ImpIVA` que sumen, ARCA rechaza y no hay comprobante. Y como ahí **no hay
líneas donde apoyarse**, la única manera de llenar esos campos en una devolución por monto es
**calcular el neto y el IVA de ese monto**. El prorrateo deja de ser una regla que inventamos
—lo que la § 7 daba como hueco sin precedente— y pasa a ser **el requisito de una autoridad**.

### México (SAT) — al menos un concepto, pero puede ser genérico · **[SECUNDARIA]**

La nota de crédito es un **CFDI de Egreso**, exige al menos un `Concepto`, y la práctica
documentada acepta uno **genérico**: clave de producto/servicio **84111506** *"Servicios de
facturación"*, unidad **ACT**, con **UsoCFDI G02** *"Devoluciones, descuentos o
bonificaciones"*. Ojo: es materia donde la regla cambió entre versiones del CFDI — verificar
contra el Anexo 20 vigente antes de construir.

### Colombia (DIAN) — `CreditNoteLine` en el UBL · **[SECUNDARIA]**

La nota crédito es uno de los cinco documentos UBL del sistema (`Invoice`, **`CreditNote`**,
`DebitNote`, `ApplicationResponse`, `AttachedDocument`), y el anexo técnico especifica la
*"Línea de Nota Crédito: `CreditNoteLine`"*. **No se abrió el anexo**: queda por verificar si
exige al menos una línea y si admite una genérica.

### La pinza, que es lo que aclara el panorama

| | ¿Exige líneas? | ¿Exige descomponer el impuesto? | ¿Valida la aritmética? |
|---|---|---|---|
| **Chile** (SII) | **Sí** — Detalle obligatoria en los 10 tipos | No — condicional | **No** (§ 2.4) |
| **Argentina** (ARCA) | **No** — no existe la zona | **Sí** — obligatorio, por alícuota | **Sí** — error 10048 |
| **México** (SAT) | Sí, ≥1 concepto — admite genérico | Sí | no relevado |
| **Colombia** (DIAN) | `CreditNoteLine` — sin verificar | sin verificar | sin verificar |

📌 **Los dos extremos se cubren mutuamente: Chile obliga a las líneas, Argentina obliga a la
descomposición.** No es "uno o el otro" — un sistema que sirva a los dos necesita las dos
cosas. Y muere el argumento *"la autoridad no lo revisa"*: **ARCA lo revisa y bloquea.**

---

## 8. Qué queda para decidir — preguntas abiertas, no resueltas acá

1. ~~**¿La NC por monto pasa a declarar neto/exento/IVA, o se mantiene fuera del motor como
   hoy?**~~ El SII no rechaza automáticamente si no cuadra (§2.4), pero "condicional" (§2.3)
   significa que se vuelve obligatorio *"si se cumple una cierta condición"*.
   ✅ **Contestada por la norma el 2026-09-03, y no por el SII: por ARCA** (§ 7 bis). En
   Argentina `ImpNeto` e `ImpIVA` son **obligatorios**, la suma **se valida** (error 10048) y
   **no hay líneas donde apoyarse**. O sea que para servir a Argentina la NC por monto
   **tiene** que declarar su descomposición — no es una opción de diseño. Lo que queda abierto
   ya no es *si*, sino *sobre qué base* (pregunta 4).
2. **Si se decide declarar, ¿el criterio es prorratear o exigir que toda NC esté ligada a
   líneas reales** (las `devoluciones` que ya existen como parámetro opcional), eliminando la
   posibilidad de "monto suelto sin ninguna línea"? El mercado que sí documenta algo (Bsale,
   Defontana, Nubox) trabaja siempre sobre líneas, reales o agregadas a mano — ninguno declara
   un total puro y deja que el sistema lo descomponga solo.
3. **Hoy, cuando `devoluciones` viene vacío, `venta_detalles` de la NC queda con cero filas.**
   El SII marca la zona Detalle como obligatoria (1) en absolutamente todos los tipos de
   documento, NC incluida (§2.2). ¿Es una brecha a cerrar, o el criterio es que como hoy no se
   integra el SII (ADR-010), no aplica todavía?
4. **Si se prorratea, ¿sobre qué base?** ¿la mezcla de tasas de la venta original completa, o
   solo de las líneas efectivamente devueltas (`devoluciones`)? El mercado no da precedente:
   evita el problema en vez de resolverlo (§7).
5. **¿Quién decide "esta NC lleva IVA o no" cuando es puramente por monto, sin líneas?** Bsale
   se lo deja al humano por transacción. ¿Es ese el camino acá, o el sistema lo deriva de
   `config_calculo` heredada — como ya hace hoy con el criterio de redondeo (`cfgOriginal`)?
6. **¿Vale separar "NC itemizada" (ligada a `devoluciones`/líneas reales) de "NC por monto
   libre" como dos flujos con reglas fiscales distintas**, en vez de un único
   `crearNotaCredito`? Es lo que hacen Toast y Square al nombrar tipos de refund distintos.

---

## 9. Fuentes

**SII — oficial, leído completo (PDF vía `pdftotext -layout`):**
- [Formato DTE v2.5 (2026-02)](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf)
  — secciones 2.1 (obligatoriedad de zona por tipo de documento), 2.2 (campos, incl. `CodRef`,
  `FolioRef`, `MntNeto`, `MntExe`, `TasaIVA`, `IVA`, `MntTotal`), leyenda de códigos de
  obligatoriedad, nota sobre no-rechazo por descuadre aritmético.
- [Guía SII — Nota de crédito electrónica que corrige monto de una Factura](https://www.sii.cl/destacados/factura_electronica/guias_ayuda/nota_credito_corrige_monto_fe.pdf)
  — guía paso a paso del portal gratuito; base legal (Art. 57 D.L. 825, Art. 71 Reglamento);
  confirma que el flujo edita montos sobre el documento seleccionado, no un total suelto.

**POS internacionales — oficial:**
- [Square — Manage customer refunds](https://squareup.com/help/us/en/article/6116-process-refunds)
- [Toast — Issuing a Refund (platform guide)](https://doc.toasttab.com/doc/platformguide/adminIssuingARefund.html)
- [Toast — Refunds FAQ](https://support.toasttab.com/en/article/Refunds-FAQ)
- [Clover — Refund payments and void transactions](https://docs.clover.com/dev/docs/ecommerce-refunding-payments)
- [Lightspeed Retail (R-Series) — Refunding and exchanging](https://retail-support.lightspeedhq.com/hc/en-us/articles/229130768-Refunding-and-exchanging)

**Mercado chileno — oficial:**
- [Bsale — ¿Cómo realizar nota de crédito por un monto en específico?](https://ayuda.bsale.io/support/solutions/articles/151000212255--c%C3%B3mo-realizar-nota-de-cr%C3%A9dito-por-un-monto-en-espec%C3%ADfico-)
- [Defontana — ¿Cómo emitir una Nota de Crédito corrige montos?](https://intercom.help/defontanaerp/es/articles/4092681-nota-de-credito-corrige-monto)
- [Nubox — ¿Cómo emitir una nota de crédito?](https://help.nubox.com/es/articles/8156785-como-emitir-una-nota-de-credito)

**ARCA (Argentina) — oficial, leído completo (PDF vía `pdftotext -layout`, 2026-09-03):**
- [Manual para el desarrollador — Facturación RG 4291, WSFEv1 v4.7](https://www.afip.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf)
  — estructura `FECAEDetRequest` (sin array de líneas), tabla de obligatoriedad de importes,
  códigos de error 10018 y 10048, estructura `AlicIva`.
- [Webservices de factura electrónica — documentación](https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp)

**SAT (México) y DIAN (Colombia) — secundarias, sin abrir el anexo:**
- [Clave SAT 84111506 en notas de crédito](https://aluadn.com/insight/clave-sat-84111506-como-usarla/)
- [Anexo técnico de la factura electrónica de venta v1.9 (DIAN)](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf)

**Estándar de facturación electrónica (contexto, no chileno):**
- [UBL 2.1 — `cac:CreditNoteLine` / `cac:TaxSubtotal`](https://www.datypic.com/sc/ubl21/e-cac_CreditNoteLine.html)
  — soporta múltiples `TaxSubtotal` por línea, con `CalculationSequenceNumeric` para el orden
  de aplicación cuando hay más de una tasa.

**Secundarias / no verificadas contra fuente primaria — usar con cautela:**
- El detalle de `<TpoDocRef>`=39 (boleta afecta) aplicado específicamente al caso "NC parcial
  sobre boleta" (§2.5): consistente con la tabla de `<TpoDocRef>` que sí leí completa, pero la
  afirmación puntual salió de un resumen de búsqueda, no de abrir yo la fuente que la sustenta.
- Los campos `additive_tax_money`/`inclusive_tax_money` del objeto `Refund` de Square: existen
  (mencionados en foros de desarrolladores), pero no pude confirmar contra la referencia
  oficial cuándo vienen poblados en un refund no-itemizado.
- Xero: *"each line's tax is calculated and rounded separately"* y las notas de crédito se
  construyen siempre como líneas (no un total suelto) — coherente con el patrón de §4, pero no
  se investigó a fondo por no ser parte del universo pedido (POS internacionales + mercado
  chileno); se cita como dato de contexto, no como parte del relevamiento principal.

**Sin fuente encontrada:** algoritmo de prorrateo documentado por cualquier actor para un
reembolso/NC por monto libre no ligado a líneas (§7); mecanismo interno de cálculo neto/IVA en
Defontana o Nubox más allá del flujo de UI; documentación pública de Toteat sobre notas de
crédito.
