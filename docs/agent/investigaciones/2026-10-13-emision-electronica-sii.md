# Conectarse al SII: qué exige la norma, quién vende la emisión y cómo lo hacen los POS chilenos — investigación (2026-10-13)

Pedido del owner: *"que nos hace falta para conectarnos al sii"*, y después la pasada de
investigación antes de diseñar. **No es decisión ni diseño.** Es insumo para la pregunta que
[ADR-010](../../adr/010-preparacion-sii-datos-fiscales.md) dejó abierta a propósito: la
emisión electrónica (XML, timbre, firma, CAF, envío) está diferida y "se documentará en un
ADR posterior". Frente fiscal: va solo y decide el owner (`CLAUDE.md`).

La trajeron tres agentes con WebSearch/WebFetch (norma, proveedores, POS). Marcas:
**[P]** fuente primaria (sii.cl, ley, resolución), **[S]** secundaria (proveedor, blog),
**[?]** no confirmado. Lo que la orquestadora volvió a abrir en la fuente dice
**verificado**. Precios y conteos son una foto de esta fecha: revalidar antes de decidir.

No repite lo que ya trajo
[`2026-10-01-emision-por-venta-y-boleta-del-terminal.md`](2026-10-01-emision-por-venta-y-boleta-del-terminal.md):
el voucher de la máquina como boleta, el "modelo de emisión" que declara el RUT y qué
devuelve cada terminal.

## Lo que ya tenemos (el lado del dato)

ADR-010 se cumplió en la parte de "capturar ahora": cada venta congela neto afecto, exento e
impuestos (`ventas_impuestos`, `venta_documentos` con sus baldes y sin folio, ADR-028), el
tipo de documento por país, el receptor de factura con los largos del Formato DTE v2.5, el
receptor de la nota de crédito, el retiro gravado de la cortesía y la identidad del pagador
sobre 135 UF. **Del lado del envío no existe nada**: ni XML, ni TED, ni firma, ni CAF, ni
cliente del SII, ni folio.

## 1. Qué exige la norma

**Quién emite.** Factura electrónica obligatoria para todos desde el 2018-02-01 (Ley 20.727)
y boleta electrónica desde 2021 (Ley 21.210) **[P]**
([SII 2018](https://www.sii.cl/noticias/2018/010218noti01er.htm),
[FAQ boleta](https://www.sii.cl/preguntas_frecuentes/bol_electr_vtas_serv/001_380_7666.htm)).
Tres vías: el sistema gratuito del SII, software de mercado o software propio **[P]**
([elegir sistema](https://www.sii.cl/factura_electronica/factura_mercado/elegir_sistema_fe.htm)).
Al integrarse con un software de mercado, el gratuito deja de emitir esos documentos **[S]**
(lo advierten Bsale y Fudo).

**Certificado digital.** De una **persona natural**, intransferible, emitido por una entidad
acreditada (Acepta, E-CertChile, Firma.cl, Certinet, Sovos, IDOK, TSP, ABANCERT) **[P]**
([FAQ](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_0539.htm),
Res. 74/2020). Costo ~$30.000–$80.000 según vigencia **[S]**. Que el proveedor de software
firme o custodie el certificado por el cliente: **[?]**, no hay norma que lo respalde. Para
boleta, la Res. 74 letra J deja al proveedor autorizado actuar "en representación del
contribuyente" **[P]**. La firma centralizada nueva (Res. 2/2026) es solo para el sistema
gratuito **[P]**.

**CAF (folios).** Se piden **por el portal**, con certificado de un firmante autorizado; el
instructivo no lista un web service para pedirlos **[P]**
([instructivo](https://www.sii.cl/factura_electronica/factura_mercado/instructivo_emision.pdf)).
Los CAF de documentos con crédito fiscal (33, 61, 56) vencen a los **6 meses** **[P]**
([Res. 58/2017](https://www.sii.cl/documentos/resoluciones/2017/reso58.pdf)). Para boletas no
se encontró vencimiento **[?]**. Los folios que no se usan se anulan **[P]**.
⚠️ SimpleFactura publica un endpoint `/folios/solicitar`
([docs](https://documentacion.simplefactura.cl)) **[S]**: o el SII tiene una vía que el
instructivo no lista, o el proveedor automatiza el portal. Sin resolver.
⚠️ **Corregido el 2026-10-15:** la Res. 58/2017 no enumera tipos (dice "documentos que otorgan
derecho a crédito fiscal"); que la 61 esté dentro lo dicen terceros
([investigación de la NC](2026-10-15-nota-credito-sobre-boleta.md) § 8).

**Certificación.** Es **por contribuyente, no por software**: "se efectúa una vez por
contribuyente" **[P]**
([FAQ](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_6529.htm)). Para
factura son seis etapas: set de pruebas, simulación, intercambio, muestras impresas,
declaración de cumplimiento y resolución
([condiciones](https://maullin.sii.cl/cvc/dte/pe_condiciones.html)) **[P]**. Ambientes:
maullin (certificación) y palena (producción). La boleta tiene certificación aparte; el set
tarda 10–15 días hábiles en revisarse
([guía](https://www.sii.cl/factura_electronica/guia_emitir_boleta_servicio.htm)) **[P]**.
**Cada tenant pasa la suya**: lo que cambia entre construir y comprar es quién la hace.

**Proveedor autorizado de boleta.** El SII publica un listado de ~83 proveedores
([listado](https://www.sii.cl/servicios_online/3785-proveedores_autorizados_be.html)). Con
uno de ellos el cliente solo "solicita habilitación" (certificación automática). Para
entrar a esa lista hacen falta **≥10 contribuyentes habilitados y ≥6 meses emitiendo**
([requisitos](https://www.sii.cl/servicios_online/3785-.html)) **[P]**. Un emisor propio
nuevo empieza por el camino lento con cada cliente.

**Envío.** Factura, NC y ND por SOAP/upload con semilla y token, hasta 2.000 DTE por envío.
Boleta por **API REST** en otros servidores, hasta 500 por envío **[P]**
([instructivo boleta](https://www.sii.cl/factura_electronica/factura_mercado/Instructivo_Emision_Boleta_Elect.pdf)).
Plazo de la boleta: **inmediato, máximo 1 hora**. Sin conexión se genera igual y la hora
corre desde que vuelve (Res. 74 F.6) **[P]**. Factura: antes del traslado o la entrega
**[P]**. Factura con el SII caído: se emite después con la fecha real de la operación **[P]**
([FAQ](https://www.sii.cl/preguntas_frecuentes/factura_electronica/001_003_0891.htm)).

**El resumen diario (RCOF / RVD) ya no existe.** Eliminado para todos los emisores de
boleta desde el **2022-08-01**; el SII arma solo el Registro de Ventas con las boletas que
recibe. **Verificado** en el resolutivo
([Res. 53/2022](https://www.sii.cl/normativa_legislacion/resoluciones/2022/reso53.pdf)).
⚠️ El agente de POS lo dio por vigente, citando la Res. 74 sin su modificación. Una librería
npm que "cubre RCOF" está cubriendo algo derogado.

**Ticket.** Desde el **2026-01-01 imprimir el timbre en la boleta es opcional**; el timbre
sigue obligatorio en el XML. **Verificado**
([Res. 207/2025](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso207.pdf)).
Papel mínimo de 5,7 cm **[P]**. En venta presencial hay que entregar copia impresa (efectivo
y transferencia), o impresa y/o voucher según el modelo de emisión (tarjeta), o virtual si no
hay impresora (correo, QR) **[P]**
([Res. 12/2025](https://www.sii.cl/normativa_legislacion/resoluciones/2025/reso12.pdf)).

**Intercambio de factura.** El emisor mantiene una casilla registrada en el SII y responde
los XML de acuse. El comprador tiene 8 días corridos desde la recepción en el SII para
reclamar **[P]** ([Ley 19.983](https://www.sii.cl/factura_electronica/ley19983.pdf)).

**Validaciones nuevas.** La Res. 121/2026 crea tres estados: Aceptado, **Aceptado con
reparos** ("inconsistencias menores… por ejemplo, inconsistencia en decimales") y Rechazado
(schema, firma, TED, emisor, folio). Las fases se publican aparte. **Verificado**
([Res. 121/2026](https://www.sii.cl/normativa_legislacion/resoluciones/2026/reso121.pdf)).

## 2. Quién vende la emisión con API

| Proveedor | Una cuenta, N empresas | Certificado y CAF | Precio publicado (+IVA) | Lo que pesa |
|---|---|---|---|---|
| **SimpleFactura** | **Sí**, API de partner con alta de empresa por API | El cliente compra el certificado; se sube y se piden folios por API | $15.000–$100.000/mes por empresa según volumen; partner sin precio publicado | Rate limit 2 req/s **por IP**: todos los tenants salen por la nuestra |
| **Folyo** | **Sí**, cuota compartida entre empresas | Certificado del cliente cifrado; certificación hecha por ellos | Pyme $29.990/mes (3 empresas), Business $59.990 (10); empresa extra $9.990 | SDK npm de jul-2026 (v0.2): muy nuevo |
| **OpenFactura** (Haulmer) | **No**: una API key por contribuyente, y los T&C **prohíben revender** | Haulmer gestiona los folios; el cliente aporta el certificado | $360.000/año pyme, emisión y API ilimitadas, certificación incluida | Docs más maduras e idempotencia; serviría como "traiga su cuenta" |
| **SimpleAPI** | Una key, varios RUT | **Nuestros**: es un motor sin estado | 5–12 UF/año por volumen; sets de certificación 2–3 UF | Tercerizamos el XML y la firma, nos quedamos con custodia y onboarding |
| **LibreDTE** | Varias empresas, pero cada una paga su plan | Se cargan por la web, no por API | $40.000–$310.000 por empresa | Onboarding manual; la librería es AGPL |
| Bsale, relBase, Nubox, Lioren | Son ERP/POS: la API es para sus propios clientes | La emite el ERP | Por suscripción del cliente | Cada tenant sería cliente de un competidor |

Fuentes: [SimpleFactura](https://www.simplefactura.cl) ·
[Folyo](https://folyo.cl) · [OpenFactura](https://www.openfactura.cl) y
[T&C](https://www.haulmer.com/legal/terminos-y-condiciones-openfactura/) ·
[SimpleAPI](https://www.simpleapi.cl/precios) · [LibreDTE](https://www.libredte.cl/plus) —
todas **[S]**. Ninguno publica SLA. Ninguno documenta emisión offline: la cola local es
nuestra igual.

**Construir propio:** existen [`@devlas/dte-sii`](https://www.npmjs.com/package/@devlas/dte-sii)
(MIT, TS, repo de marzo 2026, poca historia en producción) y
[`libredte-lib-core`](https://github.com/LibreDTE/libredte-lib-core) (PHP, AGPL, desde 2014).
El esfuerzo que dio el agente —2–3 meses-persona para emitir, más onboarding y custodia de
certificados— es **estimación suya, sin fuente**.

## 3. Cómo lo hacen los POS que operan en Chile

| POS | Emisor | Onboarding | Boleta en el plan |
|---|---|---|---|
| **Bsale** | Propio, en el listado del SII | El cliente compra el certificado; Bsale lo enrola; el cliente baja y sube los CAF; 2–4 semanas | Incluida, con 1.000 DTE |
| **Toteat** | Propio, en el listado | No público | Incluida, "sin cargos extra" |
| **Fudo** | "Integración directa con el SII"; **no está en el listado** | El cliente trae su .pfx; Fudo postula y carga CAF; ejecutivo + reunión de 60 min | Incluida, ilimitada |
| **TUU** (Haulmer) | Propio (Haulmer en el listado) | Firma electrónica; "viene conectada al SII" | Ilimitada con ≥15% de ventas por TUU |
| Relbase, Lioren, Nubox | Propio, en el listado | Certificación a cargo del proveedor | Varía |
| Justo, Defontana, Getnet | **[?]** | **[?]** | **[?]** |

Fuentes: [Bsale](https://www.bsale.cl/sheet/proceso-activacion-bsale) ·
[Toteat](https://toteat.com/productos/boletas-electronicas) ·
[Fudo](https://soporte.fu.do/es/articles/11731418-integracion-con-el-sii-como-integrar-boletas-y-o-facturas-en-mi-cuenta) ·
[TUU](https://www.tuu.cl/boleta-electronica/) — **[S]**.

**Patrón:** los POS chilenos con boleta incluida tienen **motor propio y están en el
listado del SII**. Afuera, Lightspeed México integra un PAC (Ambit) y en Colombia la DIAN
deja elegir entre software propio y proveedor tecnológico **[S]**. El onboarding es casi
idéntico en todos: certificado del representante legal → el proveedor enrola en el SII →
CAF → primera boleta. Ninguno lo hace en menos de una o dos semanas.

Lo que no salió: cuenta dividida, propina en la boleta y voucher frente a boleta en los POS
de restaurante. Fudo **no avisa** el vencimiento del certificado ni de los folios, y no
emite exentos ni más de un giro (lo dice su propia ayuda).

## 4. El cruce con lo nuestro

1. **La pregunta de fondo no es técnica, es de modelo de negocio.** Construir propio
   significa certificar a cada tenant por el camino lento hasta tener 10 habilitados y 6
   meses de experiencia, y recién ahí entrar al listado. Comprar significa elegir entre
   proveedores con API de partner (SimpleFactura, Folyo) y "traiga su cuenta"
   (OpenFactura). Es la decisión que ADR-010 dejó abierta, y le toca al owner.
2. **Lo que es nuestro en cualquiera de los dos caminos:**
   - **El folio separado del ID interno.** ADR-010 ya lo exige y `venta_documentos` nace
     sin folio.
   - **Una cola de envío con reintentos.** La venta no puede esperar al SII, la boleta
     tiene 1 hora y ningún proveedor documenta modo offline.
   - **El estado de cada documento** (enviado, aceptado, con reparos, rechazado),
     siguiendo la Res. 121/2026.
   - **El onboarding fiscal del tenant**, y el aviso de que vencen el certificado o los
     CAF.
   - **Copia impresa o virtual.** Desde 2026 el timbre en el ticket es opcional, así que la
     impresión por QZ Tray no necesita PDF417 para la boleta.
3. **La deuda de redondeo del IVA ([`impuestos.md`](../../features/impuestos.md)) queda
   así:**
   - El Formato DTE define el IVA como `MntNeto × tasa`.
   - Ese mismo formato dice que el SII no rechaza un documento por errores de contenido.
   - La Res. 121/2026 crea "aceptado con reparos", y su ejemplo es "inconsistencia en
     decimales".
   - El peso que hoy absorbe el IVA para cerrar a precio de góndola probablemente no rechace
     el documento, pero **podría salir con reparo** cuando se publiquen las fases.
   - El DTE declara el IVA **por documento**, no por línea: el residuo de cada línea se suma.
   - No hay tolerancia publicada. Se resuelve en la certificación, como ya preveía ADR-010.
4. **Para elegir proveedor, hay que preguntarle a cada uno por escrito:**
   - el precio partner y el rate limit por IP;
   - si tienen SLA;
   - quién certifica la boleta de cada tenant y en cuánto tiempo;
   - qué hacen cuando el SII está caído;
   - cuánto cuestan ~10.000 boletas al mes por restaurante;
   - a Haulmer, si la prohibición de reventa alcanza a un integrador.
