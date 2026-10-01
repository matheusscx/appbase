# ¿Un reembolso por pasarela sin nota de crédito es un patrón del mercado, o un agujero? — investigación (2026-10-01)

Insumo para la entrada de [`pendientes.md`](../pendientes.md) § 6 ("Un reembolso por
pasarela sin nota de crédito no queda en ningún documento ni en el saldo"), **en pausa**
porque el owner contestó "no sé qué hacer con esto". No es decisión — la trae un agente con
WebSearch/WebFetch, a pedido de la propia entrada ("cabe ofrecerle una pasada de
investigación de mercado"). Contexto completo: la spec
[`2026-10-01-vendido-neto-de-notas-credito-design.md`](../../superpowers/specs/2026-10-01-vendido-neto-de-notas-credito-design.md)
(D10, D12, § 6).

## Qué hace hoy el sistema (cruzado contra el código)

- El evento de reembolso trae `generarNotaCredito` (booleano) y una lista de
  `devoluciones` de stock. Cuando es `false`, `VentasReembolsoHandler.onReembolsoAprobado`
  (`backend/src/modules/ventas/reembolso-callback.handler.ts:41-65`) **no crea ninguna fila
  en `ventas`**: si hay `devoluciones`, llama `registrarDevolucionesPorReembolso` (solo
  stock); si no, devuelve `{}`. No existe ningún camino que fuerce una NC — el flujo
  "reembolso sin documento" es una rama explícita, no un bug accidental de un `if` que
  faltó.
- **No toda venta tiene documento tributario, y la que se reembolsa por pasarela casi nunca lo
  tiene** (medido por la orquestadora el 2026-10-01, a partir de "no facturamos todo", dicho por el
  owner). `ventas.tipo_documento_id` es nullable (`venta.entity.ts:45`). La venta online, que es la
  que se cobra y se reembolsa por Webpay, nace **sin** tipo de documento: `online-callback.handler.ts`
  arma el `CreateVentaDto` sin `tipoDocumentoId`. El POS y salones mandan por defecto el primero de
  la lista, en Chile la Boleta (`pos.vue:174`, `salones/index.vue:2780`). Consecuencias:
  - El argumento del SII de abajo vale solo cuando la venta tiene boleta o factura. Sobre una venta
    sin documento no hay débito fiscal que corregir, y una NC (tipo 61) corregiría un documento
    que no existe.
  - Lo único que hoy baja el vendido y el saldo es la NC. Una venta sin documento que se devuelve
    queda, en el sistema, sin forma de bajarlos sin emitir un documento fiscal.
  - Las opciones del final se leen distinto. "Exigir NC siempre que haya venta" obligaría a emitir
    un documento fiscal sobre ventas que nunca lo tuvieron. La pregunta pasa a ser si la NC depende
    de que la venta tenga documento, y qué registra la devolución cuando no lo tiene.
- **El camino sin NC es el que viene marcado.** En `frontend/app/components/ordenes/ReembolsoModal.vue:36`
  el modal arranca con `generarNotaCredito = ref(false)`: para que el reembolso emita NC, el
  operador tiene que tildarla. Agregado por la orquestadora al revisar el informe.
- La plata ya salió antes de que este handler corra: es un hook *post-commit* de
  `CobrosService.aplicarPostReembolso` (`backend/src/modules/pasarela/services/cobros.service.ts:429-471`),
  invocado después de que el `REFUND` contra Transbank ya quedó committeado. Un fallo acá
  nunca revierte el reembolso (comentario explícito en el handler, línea 22-23).
- `pasarela_transacciones` (`backend/src/modules/pasarela/entities/pasarela-transaccion.entity.ts`)
  no tiene columna para el id de la NC. Cuando sí se genera una NC, el id **solo viaja en
  la respuesta HTTP** del endpoint de reembolso
  (`cobros.service.ts:469-471`: `return resultado?.notaCreditoId ? {...publico, notaCreditoId} : publico`)
  y no se persiste en la fila de la transacción. Si nadie leyó esa respuesta (webhook async,
  reintento, UI que no la mostró), el vínculo `REFUND → NC` se pierde.
- Consecuencia ya registrada en la spec D10/D12: el saldo de una venta
  (`total − NC de esa venta − (pagado − devuelto)`) solo resta lo "devuelto" cuando es
  efectivo con una NC detrás (`movimientos_caja` con `venta_id` de esa NC). Un `REFUND` de
  pasarela sin NC no aparece en esa fórmula. Una venta de $100.000 pagada entera y reembolsada en
  $20.000 sin nota queda con saldo 0: el reembolso no se ve. Eso eligió el owner mientras tanto
  (D12). Si la fórmula contara el `REFUND`, mostraría $20.000 por cobrar, y lo mismo daría si
  alguien se los volviera a cobrar al cliente. (Corregido por la orquestadora: el borrador decía
  "de más".)
- Ni el vendido del dashboard ni "Total facturado" de `/ventas` bajan (ya verificado en la
  investigación previa, [`2026-09-30-vendido-y-notas-credito.md`](2026-09-30-vendido-y-notas-credito.md)):
  ambos leen `ventas`/NC, y sin NC no hay fila que restar. Tampoco baja el débito fiscal
  (IVA), porque no hay documento que lo corrija ante el SII.
- **El cobrado hoy no ve el `REFUND`.** El cobrado de `resumen-negocio.service.ts` suma
  `pago_aplicaciones` por fecha de pago, y el camino de reembolso de pasarela no escribe ni ahí
  ni en `movimientos_caja`. Que el cobrado reste los `REFUND` aprobados, con o sin NC, es la
  decisión D6 del frente del vendido neto, todavía sin construir. La entrada de `pendientes.md`
  lo decía en presente y se corrigió.

## Qué hace el mercado

| POS | ¿Existe refund sin vínculo a una venta? | Cómo se ve / se reconcilia | Fuente |
|---|---|---|---|
| Square (Retail) | Sí — **"unlinked refund"**, nombre oficial del producto: *"Use unlinked refunds to issue refunds for customers without a receipt or payments processed through another payment processor or channel"* | Sí deja registro: aparece en Transactions y en el Dashboard, "adjust gross sales and net sales for the reporting period"; pero **las excepciones no entran a reportes contables**: *"Exchanges won't reflect on your Square Transfer Summary or on accounting software like Quickbooks"*. Riesgo explícito a cargo del comercio: habilitarlo implica *"accept all risks associated with unlinked refunds, including any potential loss due to scams, fraud, error, employee misconduct"* | [Process a return, exchange, or unlinked refund](https://squareup.com/help/us/en/article/6350-process-a-return-or-exchange-with-square-for-retail) (verificado) |
| Shopify POS | Sí — **"unverified return"**, solo para planes POS Pro: *"Sometimes you need to process a return when there's no reference to an order"* | Muy acotado: *"You can process an unverified return only to a gift card. You can't refund to other payment methods, such as card payments, cash, or store credit"* — no se devuelve plata real, solo saldo en gift card | [Unverified returns](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/order-management/unverified-returns) (verificado) |
| Toast | La función existe en el producto pero está **deshabilitada por política propia**: *"The Issue Unlinked Refund option in Toast Web is currently disabled"* | Para un caso sin check original (ej. tarjeta vencida, migración de otro POS) hay que llamar a Customer Care — **no hay autoservicio** | [Refunds FAQ](https://support.toasttab.com/en/article/Refunds-FAQ) (verificado) |
| Lightspeed Retail | Sí — **"unreferenced refund"**, pero apagado por defecto: hay que ir a *Settings > General Options* y desactivar *"Without Receipt Refund Credit Only"* | Documentación no explica cómo aparece en reportes; aparte, reembolsos hechos desde la pestaña *Financial services* (fuera del flujo normal) **no aparecen en ningún reporte salvo ahí mismo**: *"refunds completed through the Financial services page aren't reflected on any reports outside of Financial services"* — la propia doc recomienda usarlo solo cuando es imprescindible | [Refunding and exchanging](https://retail-support.lightspeedhq.com/hc/en-us/articles/229130768-Refunding-and-exchanging) (verificado) |
| Clover | Sin verificar en esta pasada (no se abrió clover.com) | — | — |

**Patrón que emerge:** ningún POS llama a esto "normal". Los cuatro que sí lo tienen lo
tratan como **excepción con fricción deliberada** — un nombre distinto ("unlinked"/
"unverified"/"unreferenced"), apagado por defecto o requiere contactar soporte, con
advertencia de riesgo/fraude explícita, y con huecos de reporting reconocidos por el propio
vendor (no entra a Quickbooks, no entra a reportes fuera de una pantalla aislada). El caso
de este sistema es distinto en un punto importante: no es "no sé a qué venta pertenece"
(que es el problema que resuelven Square/Shopify/Toast/Lightspeed) sino **"sé exactamente
a qué venta pertenece, pero elijo no emitir el documento que la corrige"** — el `ventaId`
siempre está, es `generarNotaCredito` lo que decide no corregir el documento.

## Chile

- **La norma (SII, oficial):** una boleta o factura electrónica se anula o corrige
  **exclusivamente con una nota de crédito electrónica**: *"Una boleta electrónica se anula
  con una nota de crédito electrónica"* ([¿Cómo se anula una boleta electrónica?](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7812.htm), verificado).
  No hay un mecanismo alternativo de "anulación simple" para un documento ya aceptado por el
  SII — ya lo había confirmado la investigación previa
  [`2026-07-27-anulacion-y-notas-credito.md`](2026-07-27-anulacion-y-notas-credito.md) § 4
  y § 7.
- **El caso específico de este sistema no es "anular la boleta"**, es "devolver la plata y
  dejar la boleta como está". La norma SII que se encontró habla de **corregir/anular el
  documento**, no directamente de "¿puedo devolver dinero sin tocar el documento?" — es un
  salto que esta pasada no encontró resuelto en una página oficial del SII. La inferencia
  (no verificada contra una fuente que lo diga explícito) sale de cómo funciona el IVA: el
  débito fiscal se calcula sobre el documento emitido, y la única forma de bajarlo es una NC
  que lo referencie dentro del plazo. Fuentes contables (no SII, pero coincidentes entre sí)
  son explícitas en que **sin NC el IVA sigue entero**: *"el IVA debe quedar indicado de igual
  forma en el documento, el SII no permitirá rebajar el débito tributario en el Formulario 29,
  y el IVA queda contabilizado como una menor venta, pero no como crédito fiscal"*
  ([Laudus — Recuperación del IVA en las Notas de Crédito de Ventas](https://laudus.cl/contenidos/contabilidad-sii/recuperacion-del-iva-en-las-notas-de-credito-de-ventas/),
  fuente secundaria/contable, no SII). Traducido al caso: si Webpay reembolsa sin NC, el
  comercio **igual le debe el IVA al Fisco** sobre el monto devuelto — el agujero no es solo
  de reporting interno, es plata que puede salir dos veces (al cliente y al Fisco).
- **Transbank: anulación/reversa vs reembolso.** El método `refund()` de Webpay Plus decide
  internamente si ejecuta una **reversa** (dentro de ~3 horas de confirmada la venta, antes
  del cierre de lote) o una **anulación** (después de esa ventana): *"dependiendo de algunas
  condiciones corresponderá a una Reversa o Anulación"*
  ([Webpay Plus — documentación](https://www.transbankdevelopers.cl/documentacion/webpay-plus), verificado).
  **Esto es un detalle del adquirente, no un concepto tributario**: ni esa página ni la
  investigación previa (§6, tabla de "tres relojes") encontraron que Transbank exija ni
  prohíba una NC — esa obligación viene del SII, no de Transbank. Transbank solo informa
  `REVERSED` o `NULLIFIED`.
- **Casos donde devolver plata sin NC sí tiene lógica fiscal:**
  - **Cobro duplicado / pago que no correspondía a ninguna venta:** si nunca se emitió una
    boleta por esa transacción específica (p. ej. el cliente fue cobrado dos veces y solo una
    de las dos boletas existe), no hay documento que corregir — la reversa de Transbank
    devuelve la plata de un cargo que nunca tuvo DTE asociado. Esto coincide con cómo ya
    maneja el código el caso "orden sin venta vinculada"
    (`cobros.service.ts:439-444`: si `ctx.orden.ventaId` es `null`, el reembolso se procesa
    con un `warning` de que no hay NC ni devoluciones posibles) — es un caso **legítimo** de
    reembolso sin NC, pero es distinto del que preocupa a la entrada de `pendientes.md`
    (ahí el `ventaId` **sí existe**).
  - **Contracargo (chargeback):** no se encontró una fuente SII ni contable chilena que
    describa el tratamiento tributario específico de un contracargo iniciado por el banco
    emisor (no por el comercio). Queda sin verificar — ver abajo.
- **Propina:** no es hecho gravado y va fuera del documento tributario (ya confirmado por la
  investigación previa, § "Lo que ya estaba bien"); una propina reembolsada no debería
  arrastrar IVA en ningún escenario porque nunca lo tuvo. No se encontró una fuente que hable
  de "propina reembolsada" específicamente — es una extensión lógica del hecho ya verificado
  de que la propina no es gravada, no un hallazgo nuevo con fuente propia.

## Casos borde — qué encontró esta pasada

1. **Cobro duplicado:** sin fuente chilena oficial dedicada; la lógica fiscal (sin boleta
   asociada a la transacción duplicada, no hay nada que corregir) es inferencia, no cita.
2. **Contracargo (chargeback):** **sin verificar** — ninguna búsqueda devolvió una página
   SII o contable chilena que lo trate de forma específica. Los resultados de búsqueda que
   aparecieron eran sobre Colombia (Ley 1480) o genéricos de reconciliación de pagos, no
   Chile.
3. **Reembolso parcial:** no cambia el análisis — el riesgo fiscal (IVA que sigue de pie sin
   NC) es proporcional al monto, no depende de si es parcial o total. No se encontró una
   regla especial para parciales.
4. **Propina reembolsada:** ver arriba — extensión lógica, no hallazgo con fuente dedicada.

## Opciones que aparecen, con su costo

1. **Todo reembolso de pasarela que tenga `ventaId` exige NC (eliminar el booleano
   `generarNotaCredito` para ese caso).** Es lo más cercano a lo que impone el SII para
   boletas/facturas ya emitidas, y cierra el agujero de IVA. Costo: hoy el booleano existe
   porque alguien lo pidió para algún flujo (no investigado en esta pasada *por qué* se
   diseñó así); sacarlo sin saber qué caso cubría puede romper ese flujo. Ningún POS
   encontrado fuerza esto de forma rígida — todos dejan la puerta de "sin documento" abierta,
   aunque con fricción.
2. **Mantener el booleano, pero solo para el caso sin `ventaId` o con evidencia de
   duplicado/no-venta** (como ya hace el código cuando `ctx.orden.ventaId` es `null`).
   Para el caso con `ventaId`, forzar NC. Es el patrón más parecido al mercado: todos los POS
   que permiten el refund "sin vínculo" lo hacen justamente cuando no hay venta que
   referenciar, no cuando sí la hay y se elige no corregirla.
3. **Dejarlo como está, pero cerrar el otro agujero medido** (guardar el `notaCreditoId` en
   `pasarela_transacciones` cuando sí se genera, para que el saldo al menos pueda contarlo
   en ese caso). No resuelve el caso "reembolso sin NC con venta existente", pero reduce la
   superficie del bug a solo ese caso en vez de a "cualquier REFUND que no devolvió bien su
   respuesta".
4. **Replicar el patrón Square/Toast: fricción explícita** (permiso separado, advertencia de
   riesgo, auditoría obligatoria) en vez de un booleano silencioso en el payload del evento.
   No resuelve el problema fiscal de fondo si de todas formas se permite para ventas con
   documento — solo lo hace más difícil de disparar por accidente.

Ninguna opción es la recomendada acá — la decide el owner.

## Sin verificar

- Clover: no se abrió clover.com ni docs.clover.com para esta pregunta.
- Qué métrica interna (si alguna) es "el cobrado" que, según `pendientes.md`, baja con el
  reembolso de pasarela — no se encontró la escritura en el código del camino de reembolso.
- Tratamiento tributario chileno específico de un contracargo (chargeback) iniciado por el
  emisor de la tarjeta.
- Si Shopify/Square/Lightspeed/Clover declaran a qué **día** se imputa un refund sin vínculo
  en sus reportes (la investigación previa ya deja esto abierto para los refunds normales;
  para los "unlinked" no se buscó de nuevo).
- Por qué se diseñó el booleano `generarNotaCredito` en el evento de reembolso — qué caso de
  uso original lo pedía. No es parte del alcance de mercado, pero condiciona la Opción 1.
- Confirmación directa del SII (más allá de la inferencia vía IVA/Laudus) de que devolver
  dinero sin emitir NC deja el débito fiscal vigente — no se encontró una página SII que lo
  diga en esos términos exactos, solo fuentes contables coincidentes.
