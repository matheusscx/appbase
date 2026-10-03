# ¿El vendido del día resta las notas de crédito? — investigación (2026-09-30)

Insumo para la pregunta de [`pendientes.md`](../pendientes.md) § 4, no decisión. La pidió el owner
("no lo tengo claro, podemos investigar"). La corrió un agente con WebSearch; las dos citas que
sostienen el patrón se volvieron a abrir en la fuente (Shopify y Toast, abajo).

## Qué hace hoy el sistema (cruzado contra el código)

- Una nota de crédito es una fila de `ventas` con monto **positivo**, la fecha de **su** emisión y
  `venta_referencia_id` hacia la original. Se reconoce por `tipos_documento_tributario.es_nota_credito`.
  La original no se toca.
- **Vendido, ticket promedio, por canal y lo más vendido** del dashboard
  (`resumen-negocio.service.ts`) la **excluyen**: no la suman ni la restan. Lo mismo hace
  `GET /ventas/resumen` ("Total facturado" en `/ventas`), con otro mecanismo (compara contra el id
  del tipo del país). Solo el vendido del dashboard lleva el rótulo "antes de notas de crédito"; el
  "Total facturado" de `/ventas` no avisa nada.
- **Cobrado** no la ve: la NC nunca escribe `pagos`. Si devuelve efectivo, deja una `salida` en
  `movimientos_caja`, y esa salida **sí** resta en el arqueo de caja. El cobrado y el arqueo del
  mismo día tratan la devolución al revés.
- El **% de anulaciones por garzón** no la trata de ninguna forma: ya está anotado en `pendientes.md`
  § 6 como frente fiscal propio. *(Cerrado el 2026-10-03 como "no corresponde": el owner decidió que
  la nota no toca ese %; ver `resueltos.md`.)*

## Qué hace el mercado

| POS | Titular | ¿Resta devoluciones? | Día al que va la devolución | Fuente |
|---|---|---|---|---|
| Shopify POS | Net sales | Sí: "gross sales - discounts - sales reversals" | El día en que se procesa: "reversals display as a negative value for the day that they were processed" (verificado) | [Sales report](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/sales-report) |
| Toast | Net sales | Sí: bruto menos descuentos y reembolsos | El día del reembolso: "Refunds will decrease all relevant financial reporting figures on the day of the refund" (verificado) | [How Do Refunds Appear in Toast Reporting](https://support.toasttab.com/en/article/How-Do-Refunds-Appear-in-Toast-Reporting) |
| Square | Net sales | Sí: "Gross sales minus returns minus discounts and comps" | No lo declara | [Square Glossary](https://squareup.com/help/us/en/article/5200-square-glossary) |
| Lightspeed Retail | Net sales | Sí: "Sales − Discounts − Returns" | No lo declara | [Reporting glossary](https://shopkeep-support.lightspeedhq.com/support/reporting/reporting-and-analytics-glossary) |
| Clover | Muestra bruto, ajustes y neto lado a lado | Sí, en el neto | No lo declara | fuente secundaria (reseller), sin verificar en clover.com |

Patrón: el titular es el **neto**; el bruto queda como referencia. Donde se documenta, la devolución
resta el día en que se procesa, y el día de la venta original no se corrige después. Ningún POS
encontrado muestra el bruto solo como titular, que es lo que hace hoy el dashboard.

## Chile

- **SII:** la NC rebaja el débito fiscal del F29 del **mes en que se emite**, no del mes de la
  boleta o factura original, y entra al RCV en ese período. Lo dicen de forma coincidente asesorías
  contables ([Laudus](https://laudus.cl/contenidos/contabilidad-sii/recuperacion-del-iva-en-las-notas-de-credito-de-ventas/),
  [Círculo Verde](https://www.circuloverde.cl/consecuencias-de-la-emision-de-una-nota-de-credito-electronica-por-anulacion-de-una-factura/));
  no es una página del SII, y el plazo de 6 meses sí lo es ([SII](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_2167.htm)).
- El SII no tiene concepto de "vendido del día": el Resumen de Ventas Diarias se eliminó en 2022
  (ya en `2026-09-18-hora-de-corte-dia-negocio.md`). La decisión es de pantalla, sin restricción
  normativa directa, pero imputar la NC a su propia fecha es lo mismo que hace el SII por mes.
- POS locales: Bsale, Defontana, Nubox y Toteat no publican esta lógica. El "bruto/neto" de Bsale
  parece ser con o sin IVA, no de devoluciones (sin verificar, el artículo pide login).

## Opciones que aparecen, con su costo

1. **Vendido = neto de NC del día, con el bruto debajo.** Lo del mercado. Costo: un día con una
   devolución grande de una venta vieja baja el vendido, o lo deja negativo, y la comparación con la
   semana pasada lo muestra como caída.
2. **Vendido = bruto (como hoy), con las NC del día aparte.** No se encontró ningún POS que lo haga
   como titular.
3. **Imputar la NC al día de la venta original.** Nadie lo documenta, y hace que un día ya cerrado
   cambie solo después.

Sin verificar: a qué día imputan la devolución Square, Lightspeed y Clover; si el reporte neto de
Lightspeed Restaurant resta reembolsos. Una búsqueda devolvió una respuesta armada sobre un
"dashboard de Toteat" a partir de repositorios de GitHub ajenos: se descartó.
