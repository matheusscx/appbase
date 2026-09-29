# Investigación de mercado — Devolución por medio de pago + plazos

**Fecha:** 2026-09-29 · **Corrida por:** agente (WebSearch/WebFetch), inline.
**Feature:** `docs/agent/pendientes.md` → "Devolución por medio de pago + configuración
de plazos". Extiende `docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`
§6-7, que ya cerró la mitad de este terreno (no se repite lo que esa investigación ya
encontró; se referencia).

> ⛔ Esto **informa, no decide**. Cruzar contra el código (`docs/features/pagos.md`,
> `docs/features/ventas.md`, `docs/features/reembolsos-nota-credito.md`) y contra la
> decisión del owner antes de diseñar. [PRIMARIA] = fuente oficial (ley, SII, doc de API
> del proveedor). [SECUNDARIA] = todo lo demás (foros, blogs, integradores terceros).

---

## Resumen (10 líneas)

1. El mercado internacional tiene **consenso fuerte**: devolver al medio de pago
   original, nunca a uno distinto (Square, Clover, Lightspeed lo bloquean a nivel de
   producto). Ya estaba en la investigación previa; se confirma de nuevo acá.
2. **Split tender (pagado con 2+ medios) sí tiene patrón**: la devolución se reparte
   proporcional entre los medios originales, en el mismo ratio que el pago. Ningún POS
   documenta explícitamente "primero efectivo" o "primero tarjeta" como regla — el reparto
   proporcional es lo que aparece, no un orden de prioridad.
3. Square **no permite** elegir store credit/gift card como salida cuando el pago
   original fue split tender — solo permite volver a los medios originales. Es la señal
   más concreta de que "componer las dos patas" (tarjeta + efectivo) es sensible incluso
   para un líder de mercado.
4. **Plazos de Transbank, con cifras concretas y primarias**: POS físico integrado — solo
   el mismo día, antes del cierre de caja/terminal, y solo tarjetas de **crédito**
   (débito no se anula en el terminal); pasado eso, portal de clientes con anulación
   individual, mínimo 72 horas hábiles para gatillarse. Webpay Plus/Oneclick vía API no
   tienen un tope de días documentado públicamente — el abono demora 24h hábiles (débito)
   o 48h hábiles (crédito) una vez aprobado.
5. **Getnet, Mercado Pago Point y SumUp** sí publican ventanas más largas: Getnet permite
   devolución del día anterior; Mercado Pago Point declara 90 días (con excepciones:
   Edenred mismo día, Pluxee 5 días hábiles); SumUp Chile prohíbe anular pagos con
   tarjetas de **débito** de plano.
6. **El retracto (Ley 19.496) es 10 días para venta a distancia**, con una trampa: si el
   comercio no informa explícitamente que NO se adhiere al retracto, el plazo se
   **extiende a 90 días** — el silencio del tenant sale caro. La garantía legal (3x3, en
   realidad "6 meses" según el texto vigente citado) da 6 meses para cambio/devolución/
   reparación, y coexiste con el plazo fiscal de 6 meses del SII que ya tenías mapeado.
7. **Fraude en efectivo por compra con tarjeta es un tema con literatura propia**: la
   industria de loss-prevention lo llama vector principal de fraude interno, y la
   respuesta estándar es aprobación de supervisor + tope + trazabilidad por cajero (no
   bloqueo absoluto — el mercado no dice "nunca", dice "con control").
8. **Tarjeta vencida/cerrada**: el banco emisor redirige el abono a la cuenta o
   tarjeta de reemplazo asociada a la misma cuenta — nunca a una tarjeta distinta elegida
   por el comercio. Si el emisor no puede, cae de vuelta al procesador, que entonces paga
   por cheque/transferencia. Esto **no es algo que Transbank exponga como estado**: es
   comportamiento del banco emisor, fuera de la vista del comercio.
9. **Toast liga el refund en efectivo al cash drawer del dispositivo** — si no hay cajón
   asociado, el refund en efectivo no queda en ningún reporte. Es un paralelo directo a
   "caja cerrada" en nuestro modelo.
10. **Chile (Bsale/Toteat/Defontana) sigue casi en silencio sobre el mecanismo** (ya lo
    decía la investigación previa): Bsale documenta 4 *tipos* de devolución a nivel de
    API (dinero / medio de pago de próxima venta / abono a línea de crédito / otro), pero
    no dice cómo decide el medio cuando el pago original fue split. Toteat y Defontana no
    publican nada específico sobre split-tender ni sobre plazos propios más allá de lo ya
    hallado el 2026-07-27.

---

## 1. ¿Devolver por el mismo medio? ¿Y el split (tarjeta + efectivo)? ¿En qué orden?

**Mismo medio — patrón confirmado, no nuevo.** Ya estaba cerrado en la investigación
previa (§2 de `2026-07-27-...md`): Clover, Lightspeed y Toast fuerzan el medio original.
Se repite acá solo como base.

**Split tender — sí hay patrón, con una fuente débil.** La búsqueda no encontró
documentación oficial de ningún proveedor que declare un *orden* explícito ("primero
efectivo, luego tarjeta" o viceversa). Lo que aparece es:

- **Reparto proporcional al pago original** es la descripción que dan las guías
  genéricas de "split tender" (WineDirect, Commerce7, ShopKeep/Lightspeed S-Series) — la
  devolución se distribuye entre los medios usados, en la misma proporción [SECUNDARIA,
  son doc de producto de nicho, no líderes de mercado].
  [Split Tenders — WineDirect](https://docs.winedirect.com/docs/split-tenders-1) ·
  [Split tender transactions — Lightspeed S-Series](https://shopkeep-support.lightspeedhq.com/hc/en-us/articles/47480028156315-Split-tender-transactions) ·
  [Paying with Multiple Tenders — Commerce7](https://documentation.commerce7.com/how-to-create-a-split-tender-payment-in-the-pos)
- **Square explícitamente restringe** el split tender en el refund: si el pago original
  fue split, **solo** puede volver a los medios originales — no permite gift
  card/store credit como salida alternativa en ese caso [SECUNDARIA — hilo de foro de
  Square, no doc oficial, pero corrobora un límite real de producto].
  [Square Community — refunds in split tender transactions](https://community.squareup.com/t5/Archived-Discussions-Read-Only/Help-with-refunds-in-split-tender-transactions-to-MC-V-Gift/m-p/140626)

**Patrón dominante:** proporcional al pago original, sin discreción de orden — no es
"primero uno, después el otro", es "cada medio recibe su proporción". **Trade-off:** un
reparto proporcional es matemáticamente limpio pero puede generar centavos que no cuadran
con la escala de la moneda (el mismo problema de redondeo que ya resolviste en el motor de
precios — ver `docs/agent/resueltos.md` redondeo de plata). Ningún proveedor documenta
cómo resuelve ese residuo en un split refund.

**No cierra del brief:** el brief pregunta "en qué orden se devuelve" asumiendo que hay
una decisión de secuencia. La evidencia de mercado no sostiene esa pregunta tal como está
planteada — no hay orden, hay proporción. Vale la pena decírselo al owner en vez de forzar
una respuesta que el mercado no tiene.

---

## 2. ¿Efectivo por algo pagado con tarjeta? ¿Control? ¿Riesgo de fraude?

**Se permite, pero con control — el mercado no lo prohíbe de plano.** Ningún líder revisado
(Toast, Square, Clover, Lightspeed) documenta una prohibición dura de dar efectivo por una
compra con tarjeta; lo que documentan es *permisos separados y aprobación*:

- Toast: refund y void requieren permisos de manager habilitados explícitamente
  (`Void/Refund Payments`, `Find Checks`) por empleado, no es automático para cualquier
  cajero [PRIMARIA — doc de producto de Toast].
  [Toast — Refund permissions and limitations](https://doc.toasttab.com/doc/platformguide/adminRefundPermissionsLimitations.html)
- Patrón de industria (loss-prevention): refund en efectivo sin vínculo trazable al pago
  original es el **vector de fraude interno #1** citado; la mitigación estándar es PIN/
  aprobación de supervisor sobre umbral, más reporte de voids/refunds por cajero para
  detectar patrones anómalos [SECUNDARIA — blogs de la industria de pérdidas, coincide
  con lo que ya había citado la investigación previa (Loss Prevention Media)].
  [FraudNet — POS fraud](https://www.fraud.net/glossary/point-of-sale-pos-fraud) ·
  [Pitney Bowes — Return fraud guide](https://www.pitneybowes.com/us/blog/return-refund-fraud-guide.html)
- Alternativa que reduce el riesgo sin prohibir: emitir **store credit/gift card** en vez
  de efectivo para reducir el atractivo del fraude (cash-out inmediato), citado como
  práctica común, especialmente en ítems de alto valor [SECUNDARIA].

**Patrón dominante:** permitir con fricción — permiso separado + trazabilidad por
cajón/cajero, no bloqueo absoluto. **Trade-off:** bloquear de plano (lo que hoy hace tu
tope de "efectivo devuelto ≤ efectivo cobrado en esa venta", que ya es más estricto que
lo que el mercado exige) es más seguro contra fraude pero menos flexible operativamente
—un local puede querer dar efectivo excepcionalmente con autorización, no nunca—.

---

## 3. Plazos — Transbank, otros adquirentes en Chile, SII, retracto y garantía legal

### Transbank — POS físico integrado [PRIMARIA, publico.transbank.cl]

- **Mismo día, antes del cierre de caja/terminal, solo tarjetas de crédito**: "Solo es
  posible anular ventas realizadas con tarjetas de crédito, en la misma Maquinita donde
  se realizó la venta y debe realizarse antes del cierre de caja o terminal." Débito
  **no** tiene ruta de anulación documentada a nivel de terminal.
  [Transbank — Anulación de transacciones (POS)](https://publico.transbank.cl/guias-de-uso/pos/anulacion-de-transacciones)
- **Después del cierre**: portal de clientes, módulo "Anulaciones individuales", hasta 15
  ventas por solicitud, total o parcial, **mínimo 72 horas hábiles** para que Transbank
  gatille la anulación si es aprobada; si la venta ya fue abonada, la anulación genera una
  **retención** en el próximo abono, no una reversa instantánea.
  [Transbank — Anulaciones individuales](https://publico.transbank.cl/portal-de-clientes/modulos-y-reportes/anulaciones-individuales)

### Transbank — Webpay Plus / Oneclick (API) [PRIMARIA con hueco]

- La documentación de developers **no publica un tope de días** para pedir un
  refund/anulación vía API (a diferencia del POS físico, que sí tiene el corte de "mismo
  día"). Lo que sí está documentado: los abonos al comercio, una vez aprobada la
  anulación, demoran **24 horas hábiles** con débito/prepago y **48 horas hábiles** con
  crédito.
  [Transbank Developers — Webpay Plus](https://www.transbankdevelopers.cl/documentacion/webpay-plus) ·
  [Transbank Developers — Oneclick](https://www.transbankdevelopers.cl/documentacion/oneclick)
- **Esto es exactamente el hueco que ya habías anotado** en la investigación previa §6
  ("sin investigar: plazos reales de Transbank para Webpay y Oneclick") — sigue sin
  cerrar. El límite real hoy solo se conoce como **rechazo en runtime** (lo que ya sabías,
  confirmado, no una novedad). La distinción documental que sí aparece es
  reversa-antes-de-liquidar vs. anulación-después, pero sin un número de días para la
  segunda.

### Otros adquirentes en Chile [mixto PRIMARIA/SECUNDARIA]

| Adquirente | Ventana declarada | Nota | Fuente |
|---|---|---|---|
| **Getnet** (Santander) | e-commerce: sin regla de tiempo definida para anular; POS físico: antes del cierre, mismo equipo; devolución (`refund`) de "venta del día anterior" (total o parcial), online al emisor | Distingue anulación (mismo día terminal) de devolución (día siguiente ya liquidado) — mismo patrón void/refund que Transbank y el resto del mercado | [SECUNDARIA] [Getnet — FAQ ventas y comprobantes](https://www.getnet.cl/preguntas-frecuentes/clientes-getnet/ventas-y-comprobantes-de-pago/detalles) |
| **Mercado Pago Point** | **90 días** para reembolso desde la máquina Point (sección "Actividad") | Excepciones por medio de pago: Edenred solo mismo día (hasta 23:59:59), Pluxee 5 días hábiles | [SECUNDARIA, ayuda al cliente] [Mercado Pago — plazo de devolución](https://www.mercadopago.cl/ayuda/31508) · [Devolución de Point](https://www.mercadopago.cl/ayuda/28577) |
| **SumUp** | Prohíbe anular transacciones con tarjetas de **débito** o "provisión de fondos" de plano; la anulación debe ser por el valor íntegro (no dice número de días) | El artículo específico de "reembolsar transacciones" no cargó contenido completo — dato no confirmado con la profundidad de los otros | [SECUNDARIA, términos y condiciones] [SumUp Chile — Términos y condiciones](https://sumup.cl/terminos-y-condiciones/) |

**Patrón dominante:** todos distinguen dos relojes de adquirente (no solo Transbank) —
uno corto y estricto atado al **terminal físico y su cierre de caja** (mismo día), y uno
más largo atado a **portal/API después de liquidado** (días a meses, según proveedor).
Es la misma frontera void↔refund que ya tenías mapeada, y se confirma que **no es
particular de Transbank**, es un patrón de todo el rubro de adquirencia. **Trade-off para
tu modelo:** el "reloj del adquirente" de tu tabla de tres relojes no es un solo número —
varía por adquirente **y por canal dentro del mismo adquirente** (terminal vs. API).
Si el sistema soporta más de un proveedor de pago (hoy Transbank), ese reloj tiene que ser
configurable por proveedor, no una constante.

### SII — nota de crédito [PRIMARIA, ya citado en la investigación previa, se confirma]

No se re-investigó a fondo porque ya está cerrado en `2026-07-27-...md` §0 y §6: 6 meses
desde la **entrega del bien** (Ley 21.398) para poder rebajar débito fiscal con la NC; sin
plazo estricto de días para *emitir* la NC en sí (distinto de la ventana para que sirva
fiscalmente). Fuentes ya citadas ahí, no se repiten acá.

### Derecho a retracto y garantía legal — Ley 19.496 [PRIMARIA, SERNAC]

- **Retracto (venta a distancia/online): 10 días** desde la contratación o recepción,
  siempre que el producto no haya sido usado. **Trampa relevante para el diseño:** si el
  proveedor **no informa expresamente** que no se adhiere al derecho a retracto, el plazo
  se **extiende a 90 días**. Es decir: el "piso" para `online` que ya habías identificado
  no es un número fijo de 10 días — depende de si el tenant declaró explícitamente su
  política. Devolver el dinero del retracto: máximo **45 días** desde la comunicación del
  arrepentimiento.
  [SERNAC — Derecho a retracto](https://www.sernac.cl/portal/617/w3-propertyvalue-64530.html) ·
  [SERNAC — Ley 19.496 art. 3 bis](https://www.sernac.cl/portal/609/w3-propertyvalue-58897.html)
- **Garantía legal: 6 meses** desde la compra (o recepción, en compras online) para elegir
  entre cambio, devolución del dinero o reparación gratuita, a elección del **consumidor**
  (no del comercio). El "3x3" que se nombra en el brief es terminología de mercado —el
  texto vigente que se encontró habla de 6 meses, no de dos tramos de 3.
  [SERNAC — Garantía legal](https://www.sernac.cl/garantialegal/)
- **Condición**: el producto debe devolverse en buen estado con su embalaje original
  (etiquetas, manuales, cajas) o su valor equivalente informado previamente.

**Patrón dominante:** el retracto es el único de los tres relojes (fiscal/adquirente/
retracto) que **depende de una decisión de comunicación del propio tenant** — no es un
número fijo como el SII o Transbank. Un POS que quiera modelarlo bien necesita un campo
"el tenant declaró que NO se adhiere al retracto" (booleano), no solo un número de días,
porque ese booleano es lo que decide si el piso es 10 o 90.

---

## 4. Cómo lo modelan Square, Toast, Lightspeed, Shopify POS

| Sistema | Refund to original tender | Store credit | Gift card | Fuente |
|---|---|---|---|---|
| **Square** | Default y preferido; con split tender **solo** permite volver a los medios originales | Disponible como alternativa **solo si el pago original fue un único medio** (no split) | Sí, sin fee de carga, se acredita al instante | [SECUNDARIA] [Manage customer refunds](https://squareup.com/help/us/en/article/6116-process-refunds) · [Issue refunds to gift cards](https://squareup.com/help/us/en/article/6168-refund-to-gift-card-in-the-square-point-of-sale-app) |
| **Toast** | Default; permisos separados (`Void/Refund Payments`) por empleado; refund de tip **selectivo** (by item, entire check, tip only, tax only, custom) | No es el foco de la doc revisada | No es el foco de la doc revisada | [PRIMARIA, doc oficial] [Refund permissions and limitations](https://doc.toasttab.com/doc/platformguide/adminRefundPermissionsLimitations.html) |
| **Lightspeed (R/X-Series)** | Solo a la tarjeta original; tip solo se puede refundear **junto con** otro cargo, no aislado, salvo que sea el refund completo con "Include original tip" marcado | — | — | [SECUNDARIA] [Refunding and exchanging (R-Series)](https://retail-support.lightspeedhq.com/hc/en-us/articles/229130768-Refunding-and-exchanging) |
| **Shopify POS** | Sí, y es **elegible explícitamente**: original / store credit / ambos combinados | **Nativo**, no es un workaround de gift card — opción propia en el flujo de refund | Sí, con la restricción de que si el return se inició en el admin web, no se puede completar a gift card desde POS (tiene que iniciar y terminar en el mismo canal) | [SECUNDARIA] [Refunding orders](https://help.shopify.com/en/manual/fulfillment/managing-orders/refunding-orders) · [Store credit](https://help.shopify.com/en/manual/customers/store-credit) |

**Patrón dominante:** original tender es el default universal; store credit/gift card son
la salida secundaria explícita, pero **se apaga cuando el pago original fue split** en al
menos dos de los cuatro (Square lo dice explícito; Lightspeed no lo documenta para split
pero tampoco lo ofrece). **Trade-off:** Shopify es el único que trata store credit como
ciudadano de primera clase del refund (no un truco de gift card) — es la señal más fuerte
de que "abono a próxima venta" (que Bsale también modela como tipo 1) es un patrón real,
no un capricho de un solo proveedor.

---

## 5. Casos borde

| Caso | Qué encontró el mercado | Fuente | Nota |
|---|---|---|---|
| **Tarjeta vencida/cerrada** | El emisor redirige el abono a la cuenta o tarjeta de reemplazo asociada a la misma cuenta bancaria; nunca a una tarjeta distinta que el comercio elija. Si el emisor no puede, el dinero rebota al procesador, que paga por cheque/transferencia | [SECUNDARIA, consenso entre 5+ centros de ayuda de distintos procesadores] [Helcim — refunds to canceled/expired cards](https://learn.helcim.com/docs/refunds-canceled-expired-cards) | Es comportamiento del **banco emisor**, no algo que Transbank exponga como estado consultable — tu sistema no puede "saber" de antemano si va a rebotar |
| **Devolución parcial** | Ampliamente soportada en todos; algunas APIs (Stripe-like) restringen partial refund cuando hay impuestos/tips/múltiples líneas en un solo endpoint simple, requiriendo el endpoint de "orders" en vez del de "charges" | [SECUNDARIA] [Clover — refunding a charge](https://docs.clover.com/dev/docs/refunding-a-charge) | Ya lo resolviste vía el escalado de líneas en `crearNotaCredito` — el mercado no aporta nada nuevo acá |
| **Propina incluida en el pago** | Toast permite refund de "tip only" separado; Clover/Lightspeed **NO** permiten refundear la propina aislada — solo junto con otro cargo, o si se marca explícitamente al hacer el refund completo | [PRIMARIA Toast, SECUNDARIA Clover/Lightspeed] [Toast — Issue a refund](https://support.toasttab.com/en/article/Issuing-a-Refund) · [Clover — refunds with tips](https://community.clover.com/questions/28231/partial-refunds-with-tips.html) | Ya tenías resuelto que la propina vive fuera de `total_final` — esto no cambia esa decisión, pero confirma que "devolver la propina sola" es un caso real que al menos un líder soporta explícitamente |
| **Vuelto** | No se encontró tratamiento específico de "vuelto ya entregado" en ningún proveedor — no es un concepto que el mercado documente como parte del refund (el vuelto ocurre en el momento de pago, no en la devolución) | — | Nada que citar; confirma que es terreno propio, no copiado |
| **Venta de otro día / otra caja** | Reconciliación de cajón: el refund en efectivo se cuenta en el **día en que se emite el refund**, no en el día de la venta original — es un movimiento de caja independiente | [SECUNDARIA, guías genéricas de reconciliación] [Cointab — cash drawer reconciliation](https://www.cointab.net/us/a-guide-to-cash-drawer-reconciliation-for-retailers-simplify-your-process) | Coincide con cómo ya modelas `POST /ventas/:id/notas-credito` — el movimiento de caja es de la caja **abierta del usuario que hace la devolución**, no de la caja original |
| **Caja cerrada** | Toast: el refund en efectivo **requiere** un dispositivo con cash drawer asociado; sin cajón, no queda registro en ningún reporte — el refund "sucede" pero es invisible para la reconciliación | [PRIMARIA] [Toast — cash drawer operations](https://doc.toasttab.com/doc/platformguide/adminCashDrawerPOSOperations.html) | Es el paralelo de mercado más directo a tu regla actual ("sin caja física abierta → 422"): el mercado no lo bloquea, lo **deja huérfano**, que es peor. Tu 422 es más seguro que lo que hace Toast |

---

## 6. Realidad chilena — Bsale, Toteat, Defontana, más allá de lo ya hallado el 2026-07-27

**Sigue el mismo patrón que la investigación previa documentó** (§0 de esa investigación:
"la señal está en la norma, no en la competencia" para Chile): lo nuevo que se encontró
esta vez es acotado.

- **Bsale** modela 4 *tipos* de devolución a nivel de API/documento: `0` dinero, `1` forma
  de pago de una **próxima venta** (equivalente a "store credit" pero atado a la próxima
  transacción, no a un saldo abierto), `2` abono a línea de crédito, `3` otro. **No
  documenta** cómo decide el medio de pago del tipo `0` cuando la venta original fue split
  — el mismo hueco que tienen Square y Lightspeed, pero sin decirlo explícitamente.
  [Bsale Dev Docs — Devoluciones](https://docs.bsale.dev/MX/devoluciones/) (ya citado en
  la investigación previa, se confirma que sigue siendo el único detalle público).
- **Toteat**: nada nuevo encontrado sobre split-tender o plazos propios de devolución más
  allá de lo que ya tenías (permisos de anulación, motivo obligatorio, reverso de stock
  configurable). Su portal de developers (`developers.toteat.com`) no expone
  documentación pública indexada sobre el mecanismo de reembolso.
- **Defontana**: silencio total sobre el mecanismo — solo se confirma que Defontana Pay
  cobra distinto según el medio de pago del cliente, y que un ticket split
  tarjeta+efectivo **no emite boleta manual** por la porción con tarjeta (dato tributario,
  no de devolución). No hay fuente sobre cómo resuelve el refund por medio.

**Confirmación, no hallazgo nuevo:** la tesis de la investigación previa — que en Chile
la señal útil está en el SII y la ley, no en la competencia — se sostiene también para
esta pasada más específica de split-tender y plazos por adquirente. Ningún POS chileno
publica su mecanismo interno.

---

## Para cruzar con el código

Puntos donde lo encontrado choca o confirma algo del repo — **no son decisiones, son
lo que hay que decidir con esto en la mesa**:

1. **El reloj "adquirente" no es un solo número, ni siquiera dentro de Transbank.** El POS
   físico (mismo día, antes de cierre) y el API de Webpay/Oneclick (sin tope documentado,
   solo tiempos de abono) son dos ventanas distintas. Si algún día se agrega Getnet o
   Mercado Pago Point (hoy no está en el código, ver `docs/features/pagos.md`), cada uno
   trae su propia ventana — Getnet un día, MP Point 90 días con sub-excepciones por medio.
   La tabla de "tres relojes" de la investigación previa necesita que el reloj de
   adquirente sea **por proveedor y por canal**, no una constante.
2. **El piso del retracto (`online`) depende de una declaración del tenant, no es fijo.**
   10 días si el tenant declaró explícitamente que no se adhiere al retracto; 90 si no lo
   declaró. Hoy no existe ese campo en ningún lado del catálogo de tenant que se haya
   visto en `docs/features/`. Sin él, el sistema no puede saber si el piso real es 10 o
   90 — y equivocarse hacia 10 cuando el tenant nunca declaró nada es, según SERNAC, un
   incumplimiento.
3. **El split de la devolución (tarjeta + efectivo en la misma venta) no tiene un "orden"
   que copiar del mercado** — lo que hay es reparto proporcional. Esto afecta directamente
   la frase del §6 de la investigación previa ("una devolución tiene una pata por medio de
   pago, no es la regla completa") — el mercado confirma que es pata-por-medio, y agrega
   que el reparto es proporcional al monto pagado por cada medio, no una prioridad.
4. **El control de "efectivo por algo pagado con tarjeta" que ya implementaste (tope
   contra lo cobrado en efectivo de esa venta, `docs/features/reembolsos-nota-credito.md`
   línea ~393-404) es más estricto que lo que el mercado exige** — el mercado permite con
   aprobación de supervisor, vos ya lo bloqueás con un tope duro. Vale nombrarlo si se
   revisita esa regla: no hace falta aflojarla para "seguir al mercado", el mercado es
   menos estricto que tu implementación actual, no más.
5. **Tarjeta vencida/cerrada no es un estado que Transbank exponga** — es el banco emisor
   quien decide a dónde rebota la plata. Si se diseña el flujo de "reembolso rechazado
   porque la tarjeta ya no existe", el sistema solo puede reaccionar al **rechazo que
   ya recibís de la pasarela** (como hoy con el plazo), no anticiparlo.

---

## Preguntas para el owner

En lenguaje de local — cada una con la escena y el costo de cada opción, una por vez.

**1. Un cliente pagó $15.000: $10.000 con tarjeta y $5.000 en efectivo. Quiere que le
devuelvan todo.**
¿Cómo se reparte la devolución?
- **(a) Proporcional al pago** — vuelven $10.000 a la tarjeta (vía Transbank) y $5.000 en
  billetes de la caja. Es lo que hace el mercado cuando lo documenta, pero exige que el
  sistema sepa componer las dos patas en una sola operación — hoy no lo hace (dos caminos
  separados, según `docs/agent/investigaciones/2026-07-27-...md` §6).
- **(b) Todo por el medio "más fácil" de anular** — por ejemplo, todo en efectivo si la
  caja tiene saldo, aunque $10.000 hayan entrado por tarjeta. Es más simple de construir,
  pero es exactamente el patrón que la literatura de fraude interno señala como riesgo
  —y hoy tu propio tope de "efectivo devuelto ≤ efectivo cobrado en esa venta" ya lo
  bloquearía en este ejemplo, porque solo entraron $5.000 en efectivo—.
- **(c) Dejar como está** — cada devolución elige un solo medio y el cajero prorratea a
  mano, sin que el sistema imponga el reparto. Costo: el sistema no puede avisar cuando el
  prorrateo del cajero se equivoca (ni a favor ni en contra del cliente).

**2. Un cliente quiere devolver algo comprado con tarjeta, pero pide que se lo den en
efectivo porque "es más rápido" o porque la tarjeta ya no existe.**
- **(a) Nunca**, ni con autorización — el efectivo solo sale si entró efectivo. Es lo más
  duro, cero excepciones, cero fraude por esa vía, pero deja al cliente sin devolución
  cuando la tarjeta está vencida o cancelada (un caso real, no hipotético — el mercado
  confirma que el emisor puede rebotar el reembolso).
- **(b) Con aprobación de supervisor y tope diario/por transacción** — es el patrón que
  siguen Toast/el resto: permitir con fricción, no bloquear. Costo: hay que construir el
  permiso de supervisor y el tope, y decidir si ese efectivo entra al mismo cálculo que
  ya existe (`efectivo devuelto ≤ efectivo cobrado`) o a uno nuevo separado.
- **(c) Solo cuando Transbank ya rechazó el reembolso** (p. ej. tarjeta cerrada) — el
  efectivo es la salida de último recurso, no una opción del cajero. Más angosto que (b),
  pero exige que el sistema distinga "el cajero prefiere efectivo" de "Transbank no puede
  devolver".

**3. Un tenant que vende `online` nunca escribió en su política si acepta o no el
derecho a retracto.**
- **(a) El sistema asume el piso legal por defecto (90 días)** hasta que el tenant declare
  lo contrario — es lo que dice SERNAC que pasa si el comercio no informa nada. Más seguro
  legalmente, pero un tenant que no se dio cuenta de esto puede terminar aceptando
  devoluciones 3 meses después sin saber por qué el sistema se lo permite.
- **(b) El sistema fuerza que el tenant declare su política de retracto antes de vender
  `online`** — no hay default, hay un campo obligatorio en la configuración. Más trabajo
  de onboarding, pero nadie se sorprende con el plazo real.
- **(c) No modelar el booleano todavía** — dejar el retracto en 10 días fijos, como estaba
  pensado, aceptando que un tenant que no declaró nada está técnicamente mal contra la
  ley (SERNAC diría que le corresponden 90, no 10). Es la opción más barata de construir y
  la más expuesta si alguna vez hay un reclamo.
