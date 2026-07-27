# Anulación de ventas y topes de nota de crédito — mercado vs. implementación

**Fecha:** 2026-07-27 (dos pasadas en paralelo: anulación/ciclo de vida del ticket, y topes de NC/devolución)
**Estado:** ✅ **Decisiones tomadas por el owner** — pendiente de implementar. No se tocó código en esta pasada.
**Origen:** las tres "decisiones de owner" que salieron de la auditoría de `ventas`+`pagos` (`bec299b`).
**Features relacionadas:** [`ventas.md`](../../features/ventas.md), [`reembolsos-nota-credito.md`](../../features/reembolsos-nota-credito.md), [`pagos.md`](../../features/pagos.md)

> ⚠️ Método (`docs/agent/investigacion-mercado.md`): lo que trae el mercado es **insumo
> para cruzar, no verdad a copiar**. Abajo se marca qué sobrevive al cruce contra el
> código y qué fue decisión del owner.

---

## 0. Lo que se decidió (resumen)

| Tema | Decisión | Por qué |
|---|---|---|
| Tope del dinero devuelto por una NC | Acotar contra **lo cobrado en efectivo en esa venta** | Un solo tope cierra el agujero del monto y el del medio de devolución |
| Tope documental de la NC | **Sin cambios** (`total_final − Σ NCs previas`) | Coincide con la regla dura del SII; ya estaba bien |
| `cancelada` | Implementar el **subconjunto seguro**: venta `pendiente`, sin pagos, sin documento emitido, con motivo obligatorio | Es lo inequívocamente anulable hoy y lo seguirá siendo tras integrar el SII |
| `borrador` | **Sacarlo del enum y de la doc** | `cuenta`/`cuenta_lineas` de salones ya son el ticket abierto |
| Idempotencia en creación de venta | Al **endurecimiento pre-producción**, con el diseño escrito | Hoy no hay usuarios; es feature con superficie propia, no un fix |

---

## 1. Lo que ya estaba bien (sobrevivió el cruce sin cambios)

No todo hallazgo obliga a tocar algo. Tres cosas se verificaron y quedan como están:

- **El tope documental de la NC.** El SII **rechaza** un DTE de nota de crédito cuyo monto
  exceda el documento de referencia — regla dura, no criterio. `total_final − Σ NCs
  previas` es exactamente eso.
- **La propina fuera de `total_final`.** En Chile la propina sugerida **no es hecho
  gravado** y va en campo separado del DTE. Como `total_final` sale del motor de precios y
  la propina vive en `venta_propina` con su split en `pago_aplicaciones`, la NC ya se acota
  contra el monto gravado y no contra el gravado + propina.
- **La NC no cambia el estado de la venta original.** Es literalmente lo que hacen Bsale,
  Nubox y Defontana: el documento original no se toca nunca, se compensa.

## 2. Lo que el mercado encontró y la auditoría no

**El medio de devolución.** Consenso fuerte y explícito: se devuelve **al medio de pago
original**. Clover no permite invocar un tender distinto al original; Lightspeed solo
reembolsa a la tarjeta usada; Toast no tiene flujo estándar para dar efectivo por una
compra con tarjeta. La literatura de prevención de pérdidas lo nombra como el vector de
fraude interno principal del cajero.

**Cruce:** `crearNotaCredito` con `devolverDinero: true` genera **siempre** una salida de
efectivo, sin mirar con qué pagó el cliente, validando solo el saldo global de la caja.
Una venta cobrada íntegra con tarjeta admite hoy una devolución en billetes.

Ninguna de las 7 lentes de la auditoría miraba "medio de devolución" — salió del mercado.
Es el argumento concreto de por qué la investigación no es redundante con auditar.

## 3. Dónde el mercado NO tiene respuesta

Vale registrarlo para no volver a buscarlo:

- **El tope del dinero devuelto contra lo cobrado no está documentado por nadie** — ni
  Toast/Square/Clover/Lightspeed ni Bsale/Toteat/Defontana. La señal es indirecta: Toast y
  Lightspeed acotan el refund contra el **pago**, no contra el ticket. La decisión de
  acotarlo contra el efectivo cobrado es **nuestra**, no copiada.
- **Anular una venta cuyo stock ya se revendió**: silencio total.
- **Anulación concurrente** (dos cajeros sobre la misma venta): silencio total.
- **Acumulación exacta de NCs parciales** (por monto, por línea, o ambas): ningún POS
  chileno lo documenta públicamente.

## 4. Anulación — la frontera real

El mercado no separa por "¿hubo pago?" sino por **"¿ya se consolidó?"**:

- **Void** — deshacer algo que no liquidó. No aparece en el estado de cuenta, no genera
  comisión. Ventana: 25 min en Clover (después convierte solo a refund), cierre de batch
  en Toast, 7 días configurables en Toteat.
- **Refund / nota de crédito** — compensar algo ya liquidado con un movimiento inverso que
  deja rastro.

En Chile esa frontera se traduce 1:1 a **"documento emitido y aceptado por el SII"**.
Antes: se puede anular libre (una "nota de venta" no es DTE, no tiene folio ni validez
tributaria). Después: solo NC electrónica que referencia el folio original, nunca borrado.

**Cruce con ADR-010:** como la emisión al SII está diferida, hoy ninguna venta tiene
documento transmitido. El subconjunto que es seguro **decidas lo que decidas después** es
la venta `pendiente`, sin pagos y sin documento: no hay hecho fiscal que compensar ni
dinero que devolver. Todo lo demás ya tiene camino por la NC. Por eso la decisión fue ese
subconjunto y no la anulación general.

**Lo que NO se construye:** el plazo de 6 meses de la Ley 21.398 se cuenta **desde la
entrega del bien**, no desde la fecha del documento. Modelar eso hoy es infraestructura DTE
especulativa — justo lo que ADR-010 prohíbe. Queda anotado, no implementado.

## 5. `borrador` — el cruce dio vuelta la conclusión dos veces

Vale dejar el recorrido escrito porque es el ejemplo de por qué el cruce no es opcional:

1. **Hipótesis inicial:** `borrador` es redundante con salones/mesas.
2. **El mercado la desmintió:** Square y Toast tratan el *open ticket* como venta en
   construcción, entidad **separada** de la mesa (que es la entidad física de servicio).
   Existen por separado: ticket de mostrador sin mesa, mesa abierta con ticket vacío.
3. **El código la volvió a dar vuelta:** ya existen `cuenta`, `cuenta_lineas` y
   `cuenta_asignaciones` en `modules/salones/`. Eso **es** el open ticket del mercado, ya
   implementado. Un `borrador` de venta en paralelo sería una segunda forma de resolver lo
   mismo.

El hueco que quedaría es parquear un ticket en **mostrador**, fuera de salones (minimarket,
retail). Nadie lo pidió: se diseña si aparece la necesidad, no antes.

## 6. Devolución por medio de pago y plazos — tema abierto (aporte del owner)

El owner aportó experiencia de dominio que confirma el hallazgo del mercado y lo extiende.
Se registra acá porque **es un tema propio, no parte de los fixes de la auditoría**.

**Lo verificado en el código:** las devoluciones de Transbank **ya están implementadas**
(`reembolsar()` en los providers de Webpay Plus y Oneclick, contra
`/transactions/{token}/refunds`). Transbank responde `type: REVERSED | NULLIFIED`, que es
literalmente la frontera void↔refund de §4: el adquirente ya modela la distinción que
nosotros no. **No hay ninguna validación de plazo** en los providers ni en
`cobros.service`: se llama y el límite se descubre como un rechazo en runtime.

**Lo estructural:** hoy existen **dos caminos de devolución que no se conocen entre sí**.
El de tarjeta arranca en la pasarela y *termina* creando una nota de crédito; el de
efectivo arranca en la NC y sale por la caja. Nada compone las patas ni impide pagar con
tarjeta y recibir efectivo. El tope "efectivo devuelto ≤ efectivo cobrado" (§0) es
correcto, pero es **la pata en efectivo** de una regla más general —una devolución tiene
una pata por medio de pago—, no la regla completa.

**Los plazos son tres relojes distintos, y confundirlos es el error caro:**

| Reloj | Quién lo fija | ¿Configurable por el tenant? |
|---|---|---|
| Fiscal (SII) | Ley 21.398: 6 meses desde la **entrega** para rebajar débito fiscal | **No** — sale del país |
| Adquirente (Transbank) | La integración y el medio de pago | **No** — es propiedad del proveedor |
| Política comercial ("30 días con boleta") | El tenant | **Sí — la única que lo es** |

El canal importa, pero al revés de lo intuitivo: en Chile la Ley 19.496 da **derecho a
retracto de 10 días en venta a distancia**, inexistente en tienda física. Para `online` el
plazo no es un máximo configurable sino un **piso que el tenant no puede bajar**.

De ahí el modelo que se propone si esto se encara: la política comercial es lo
configurable, con el plazo fiscal y el del adquirente como **techos** que la config no
puede exceder, y el retracto como **piso** en online.

⚠️ **Costo de construirlo plano** (un solo "plazo por método y canal" editable): un tenant
configura 12 meses, el cajero acepta la devolución al mes 8, y la empresa **se come el
IVA** porque la NC ya no puede rebajar débito fiscal. Un error de configuración se vuelve
pérdida de plata sin que nadie lo note.

**Sin investigar:** plazos reales de Transbank para Webpay y Oneclick (y si difieren entre
sí), y el alcance exacto del retracto. Es lo único que falta para poder diseñar.

## 7. Contradicción de fuentes que hay que respetar

Un proveedor de pagos (TUU, secundaria) afirma que el SII solo permite anular boletas
**del mismo día**. Las FAQ oficiales del SII **no dicen eso**: el único plazo que fijan es
que pasados 6 meses ya no se puede rebajar el débito fiscal. Tratarlo como práctica
comercial de ese proveedor, no como regla legal. Si alguien vuelve sobre el tema, gana el
texto del SII.

---

## Fuentes

**SII (oficial):**
- [¿Cómo se anula una boleta electrónica?](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7812.htm) — la anulación es vía NC; sin plazo estricto.
- [¿Es posible anular DTE ya aceptados?](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_2167.htm) — plazo de NC sobre facturas: mismo período tributario o el siguiente.
- [¿Qué documento debe emitirse para anular una boleta electrónica?](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_5352.htm)
- [Nota de crédito que corrige monto de una factura](https://www.sii.cl/destacados/factura_electronica/guias_ayuda/nota_credito_corrige_monto_fe.htm)

**POS internacionales (documentación oficial):**
- [Toast — void vs. refund](https://support.toasttab.com/en/article/Understand-when-to-void-vs-refund) — la frontera es el cierre de batch.
- [Toast — Refund permissions and limitations](https://doc.toasttab.com/doc/platformguide/adminRefundPermissionsLimitations.html) — permisos separados, refund de efectivo ligado a un cash drawer.
- [Clover — Voids and refunds](https://docs.clover.com/dev/docs/voids-and-refunds) — ventana de 25 min; no se puede usar un tender distinto al original.
- [Lightspeed R-Series — Refunding and exchanging](https://retail-support.lightspeedhq.com/hc/en-us/articles/229130768-Refunding-and-exchanging) — solo a la tarjeta original.
- [Lightspeed X-Series — Returning a sale](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534237536411-Returning-a-sale-in-Retail-POS-X-Series) — return solo sobre venta 100% pagada.
- [Square — Open tickets best practices](https://squareup.com/help/us/en/article/6108-open-tickets-best-practices) — el ticket abierto es entidad separada de la orden.

**Mercado chileno:**
- [Bsale Dev Docs — Devoluciones](https://docs.bsale.dev/MX/devoluciones/) — cuatro tipos de devolución (efectivo, pago de nueva venta, abono a línea de crédito, otra); confirma que la NC sin devolver dinero es un flujo válido.
- [Toteat — Anular / eliminar órdenes cerradas](https://toteat.com/ayuda/operacion-en-restaurante/articulo-ayuda/anular-eliminar-ordenes-cerradas) — por defecto solo el dueño anula; motivo obligatorio de 10 caracteres; reverso de stock configurable por transacción; anular reversa pagos y propina.
- [Nubox — ¿Puedo anular una factura electrónica?](https://help.nubox.com/es/articles/4811879-puedo-anular-una-factura-electronica) · [Nubox — Plazo para NC](https://blog.nubox.com/contadores/plazo-para-emitir-notas-de-credito) — Ley 21.398, 6 meses desde la entrega.
- [Bsale — Anular boleta desde el POS](https://bsalehelp.zendesk.com/hc/es/articles/218970997) · [Defontana — Anular boleta](https://intercom.help/defontanaerp/es/articles/3972390-anular-boleta-electronica)
- [Chipax — tipos de DTE en Chile](https://www.chipax.com/blog/que-tipos-de-documentos-tributarios-se-manejan-en-chile) — la "nota de venta" no es DTE: respalda la distinción borrador/documento fiscal.

**Secundarias (usar con cautela):**
- [TUU — anular boleta electrónica](https://blog.tuu.cl/como-anular-una-boleta-electronica-correctamente-con-y-sin-pos) — afirma "solo mismo día", **no respaldado por el SII** (ver §6).
- [Loss Prevention Media — internal refund fraud](https://losspreventionmedia.com/stopping-the-snowball-how-policies-and-technology-can-prevent-internal-refund-fraud/) — el refund en efectivo sin vínculo al pago original como vector principal.

**Sin fuente encontrada:** anulación concurrente en cualquier POS; stock ya revendido tras
un void; documentación pública de Rocket/GestioPolis sobre anulación o NC.
