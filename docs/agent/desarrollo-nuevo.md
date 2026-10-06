# Desarrollo nuevo — lo que todavía no existe

Lo que **agrega algo que hoy no existe**: features de producto, proyectos con spec propia y
refactors. Se separó de [`pendientes.md`](pendientes.md) el 2026-10-06 por decisión del owner
(en el selector interactivo de la orquestadora eligió *archivo propio* por sobre una sección
aparte en el mismo archivo), para que la lista de arreglos y correcciones no se mezcle con la
cola de trabajo nuevo.

Las mismas reglas que en `pendientes.md`: **acá solo vive lo que falta hacer**, y cuando una
entrada se construye, en el mismo commit se muda —con el texto de su cierre— a
[`resueltos.md`](resueltos.md), y la feature entra en [`ESTADO.md`](../ESTADO.md) y en
`docs/features/`. Cada entrada abre su propio frente: brainstorm → spec → plan, nunca de
arrastre dentro de otra tarea.

Las entradas se mudaron tal cual estaban, con su historia. Donde el texto dice "§ 3", "§ 4" o
"§ 6" sin otro archivo, habla de las secciones de `pendientes.md` en las que vivía.

## Cómo está ordenado

| Sección | Qué es |
|---|---|
| 1. Ya decidido, falta construir | El owner ya contestó lo que había que contestar: es trabajo con diseño adentro |
| 2. Proyectos con spec propia | Funcionalidad que necesita spec antes de escribir código; alguna espera una pregunta como primer paso |
| 3. Refactors | Cambian nombres o lugares, no agregan funciones. Hoy nada falla por ellos |
| ⏸ En pausa | Lo de otros países, hasta terminar Chile |

---

## 1. Ya decidido, falta construir

El owner ya contestó. **No es una tanda que se "termine"**: es la cola de trabajo, y cada
entrada abre su propio frente con su spec.

- [ ] **El envío diario del resumen de descuadres** (backend + producto; residuo del umbral
  de descuadre, construido el 2026-08-23 → [`resueltos.md`](resueltos.md) § *"El umbral de
  descuadre al cierre: dos niveles, ninguno bloquea, y una bandeja que llama a revisar"*) —
  el owner pidió bandeja **más un resumen diario**. La bandeja y el dato del resumen
  (`GET /caja/resumen-descuadres-dia`) existen; lo que no existe es el **envío**. ⚠️ La
  plomería sí está —`MailService` y `CronRunnerService` con `@Cron` (molde:
  `cron/jobs/expirar-ordenes.job.ts`)—, así que es un job más una política, no
  infraestructura. Es frente propio porque abre preguntas que no estaban contestadas: a quién
  llega, a qué hora del tenant, qué pasa si falla, y si un tenant sin descuadres recibe un
  correo vacío. Mientras tanto el control es rastro, no alarma — asumido explícitamente.
  ✅ **Las cuatro, decididas (owner, 2026-09-29, en el selector interactivo de la orquestadora,
  las cuatro con la opción recomendada):**
  - **A quién:** a todos los usuarios con el permiso de supervisar cajas, no solo al admin ni a
    una lista que el local escribe.
  - **A qué hora:** 8:00 del día siguiente, en la zona del tenant. Cubre los cierres de madrugada.
  - **Si falla el envío:** queda anotado y la bandeja de descuadres muestra que el resumen de ayer
    no salió. Sin reintento automático (regla del owner).
  - **Día sin descuadres:** sale igual, con "sin descuadres ayer", para que un día sin correo
    signifique que el envío falló.
  ⚠️ "Día" y "8:00" dependen de la zona del tenant, que es el tema de fechas de la § 6: el job
  tiene que usar la regla que ese frente deje, no una copia más del helper.

- [ ] **Conteo por denominación** (§5/§8.3 de la investigación) — los motivos categorizados
  de diferencia de §5 quedaron **resueltos** por el sub-proyecto C; lo que sigue
  pendiente de §5 es exclusivamente el conteo por denominación de billetes/monedas, sin
  tracking más detallado que [`investigaciones/2026-07-23-gestion-caja.md
  §9`](investigaciones/2026-07-23-gestion-caja.md).
  ✅ **Decidido por el owner (2026-08-11): configurable por tenant** — un negocio chico carga
  un total, uno grande el desglose.
  ⚠️ Lo que compra la config es lo que hay que sostener: **dos caminos en la pantalla de
  arqueo**, y los dos tienen que producir el mismo dato para el umbral de arriba. Antes de
  implementarlo hay que definir si el desglose se **persiste** (y entonces es una tabla
  nueva) o si solo asiste la suma en pantalla y se guarda el total — no es lo mismo para
  auditoría, y la decisión de arriba (revelación solo al supervisor) sugiere que el
  desglose es evidencia, no una calculadora.
  ✅ **DECIDIDO (owner, 2026-08-15): el desglose se GUARDA**, no solo asiste la suma. Es
  evidencia del arqueo, no una calculadora — coherente con que la diferencia la vea solo el
  supervisor.
  ⚠️ **Es una tabla nueva, y con eso se resuelve la duda que la entrada dejaba abierta.** Al
  diseñarla: tiene que producir el mismo total que el camino sin desglose, porque los dos
  alimentan el umbral de descuadre (construido el 2026-08-23, ver `resueltos.md`) — si divergen, el umbral se dispara
  distinto según cómo contó el cajero.

- [ ] **Configurar qué acepta la tienda online** (backend + frontend, feature con spec
  propia) — que el tenant elija sus medios de cobro online (tarjeta por pasarela,
  **transferencia**, **pago al retirar**…) en vez de tener solo lo que haya conectado. La
  nombró el owner el 2026-08-11 y sigue sin empezar; toca configuración, tienda, registro
  de la venta y el estado resultante.
  ⛔ **Antes de diseñarla, mirar el choque que ya frenó una vez** (2026-08-16): `pago al
  retirar` es una venta online que nace impaga, y `ventas.service.ts` la rechaza con `400`
  *"Las ventas online requieren el pago completo"* — el comentario de esa línea dice *"online
  no admite cuenta por cobrar"*. Aflojarlo de plano habilita ventas online impagas **por
  cualquier camino**, incluido el de la pasarela real. Y el costo no termina ahí: el docblock
  de `filtroDeMisCajas` avisa que la venta online se le muestra a cualquier cajero
  **porque hoy no puede tener pagos en una caja física**; si el pedido se cobra después en el
  mostrador, ese pago cae en el cajón de un cajero y queda a la vista de todos — hay que
  filtrar **dos** lugares más (la lista de pagos de `findOne` y `GET /pagos`). Sumado a que
  el pedido descuenta stock aunque nadie haya pagado (la salida de inventario se registra en
  `crear`, sin mirar el estado), las salidas siguen siendo las tres de 2026-08-16: (a) un
  estado propio para el pedido sin cobrar, (b) que el backend distinga el caso por config del
  tenant, o (c) que ese medio no se ofrezca. Ninguna es una corrección: las tres son producto.
  ✅ **DECIDIDO (owner, 2026-09-29): (a), un estado propio "por retirar".** Cómo se decidió: en el selector interactivo de la orquestadora
  eligió *A* (recomendada, la de más trabajo) por sobre *B: cada local lo activa en su
  configuración* y *C: no ofrecerlo*. El pedido aparta el stock, no cuenta como venta hasta que
  se cobra en la caja, y el pago online con pasarela sigue exigiendo pago completo. Con eso no se
  afloja el `400` de `ventas.service.ts:697` para ningún otro camino.

- [ ] **La nota de crédito no es un documento todavía: es un monto libre con líneas
  informativas** (backend, decisión g) — lo medido, no una impresión: la cabecera toma el
  monto que manda el cliente, `totalImpuestos: '0'` fijo (`ventas.service.ts:1023`), y las
  líneas no tienen relación exigida con ese monto. Falta el **desglose de IVA** y el
  **cuadre cabecera↔líneas**.
  ⚠️ **Re-medir antes de tomarla (2026-10-01):** el cuadre cabecera↔líneas ya existe.
  `crearNotaCredito` valoriza las líneas al precio de la venta, las escala al monto y deja el
  resto en la línea de ajuste (`ajusteTotal`), y reparte por clasificación tributaria. Lo que
  queda de esta entrada, si queda algo, sale de medir de nuevo.
  ⚠️ Quien lo tome tiene que contemplar que el camino **se dispara también por el webhook de
  reembolso** (`reembolso-callback.handler.ts`), no solo por un humano — y ahí rige la
  excepción del hecho consumado (no se rechaza, se cuantiza y se registra). Un guard nuevo
  que no distinga los dos caminos pierde eventos de plata: ya pasó una vez durante este
  frente y se cazó a tiempo.
  El redondeo de la NC **sí** se cerró: hereda el criterio congelado de la venta que corrige
  y congela el suyo.

- [ ] **Denominación mínima de efectivo (`cashRounding`)** (backend + producto, decisión h)
  — `moneda.decimales = 0` dice que el peso chileno existe; la **moneda física más chica es
  \$10** (Ley 20.956 + Decreto 1.266). Son dos datos distintos y CLDR los modela separados
  (`digits` + `cashRounding`).
  **Lo que ya está hecho: nombrar el dato** para que `moneda.decimales` no quedara siendo
  "el número que sirve para todo" (ver [`features/configuracion-monedas.md`](../features/configuracion-monedas.md)).
  **Lo que falta: la columna y su consumidor** — deliberadamente juntos, porque una columna
  sin consumidor repetiría el patrón que este mismo frente documentó como problema.
  ⚠️ Ese redondeo **no toca el documento tributario ni el impuesto**: es una diferencia de
  caja aparte, así que su lugar en el modelo no es el mismo y hay que decidir dónde se
  contabiliza.
  ✅ **DECIDIDO (owner, 2026-09-29, en el selector interactivo de la orquestadora): la diferencia queda como "redondeo" en la
  caja.** Escena: cuenta de $12.347 pagada en efectivo, redondeada por ley a $12.350. Eligió *A*
  (recomendada) por sobre *B: como ajuste dentro de la venta*, que cambiaba el documento y lo
  volvía fiscal, y *C: no hacerlo todavía*. La venta y la boleta no cambian; el arqueo espera la
  diferencia y la muestra como redondeo, así que la caja cuadra. ⚠️ La regla exacta de la ley
  (1 a 5 baja, 6 a 9 sube, solo el pago en efectivo) se verifica contra la fuente al construir,
  no contra este párrafo.

- [ ] **La UF como moneda oficial de un tenant** (backend + producto, hueco declarado desde
  la investigación del 2026-08-15) — hoy nada lo impide y el seed ya trae UF con 4
  decimales. Se persistirían totales en una unidad en la que **ninguna pasarela cobra**.
  ⚠️ **No es un problema de redondeo**, y por eso no entró: es *unidad de cuenta vs medio de
  pago*. La cuantización haría lo suyo correctamente y el resultado seguiría sin poder
  cobrarse.
  ➕ **El cruce que esta entrada tenía anotado ya no aplica:** apuntaba al punto fijo de
  `MoneyInput`, que con 4 decimales rompía todas las pantallas de plata. Se arregló el
  2026-08-21 y se verificó tecla por tecla justo con UF (`5,0500` tipeado, `5.0500`
  persistido). O sea que la UF como oficial ya **no** arrastra ese problema de pantalla:
  lo que queda de esta entrada es lo suyo propio —unidad de cuenta vs medio de pago—.

### Dos que el owner decidió el 2026-09-03: acumulación de descuentos y compras

Eran tres: la tercera —el reporte de varianza— se construyó y está en [`resueltos.md`](resueltos.md) (2026-09-21).

- [ ] **Descuentos: un flag de acumulación por regla** ✅ *(decidido por el owner el
  2026-09-03; antes era "¿en qué orden se apilan?" en la § 4)* —
  **La decisión:** cada descuento lleva un flag que dice **si se combina con otros**. Se eligió
  el flag por sobre un número máximo (*"hasta 2 descuentos"*) porque un número contesta
  *cuántos* y el flag contesta **cuáles**: con un número no se puede expresar *"el cupón de
  bienvenida no se combina con nada, pero fidelidad y happy hour sí entre ellos"*. Es además lo
  que hace el mercado — los cupones de Bsale son **exclusivos**, no limitados por cantidad.
  **Hoy no existe nada de esto**: la entidad `descuento` tiene nivel, vigencia, modo, tramos y
  valores, pero **ni acumulación ni orden** (verificado 2026-09-03).

  ✅ **Y la pregunta del orden ya estaba contestada por el código, no hacía falta decidirla.**
  El motor **impone su propio orden** y explícitamente **no lo hereda del `ORDER BY`** de la
  base: `ordenarReglas` pone **los porcentajes antes que los montos fijos**, con tres razones
  escritas. La que más pesa es la tercera: **el último es el que se recorta** cuando entra el
  piso en cero, y un fijo recortado se explica en el ticket (*"el descuento de 1200 aplicó
  1000"*) mientras que un porcentaje recortado no. Es, además, exactamente la lectura de Square.
  **La columna `orden` configurable queda diferida**: solo serviría para que un tenant
  contradiga un criterio que ya tiene tres razones detrás, y ningún POS del relevamiento la
  ofrece.

  ⚠️ **Dos cosas que hay que decidir al construirlo, y no son obvias:**
  1. **¿El flag cruza niveles?** Un descuento de línea y uno de venta conviven hoy. Si el de
     línea dice "no se combina", ¿bloquea también al de venta, o solo a otros de su nivel?
  2. **¿Y bloquea promociones?** Las promos son **familia propia del motor**
     ([ADR-023](../adr/023-promociones-familia-propia-del-motor.md)), no descuentos. Un
     descuento exclusivo sobre una línea que ya trae promo es un caso real —"2x1 más cupón"— y
     hoy nada lo impide.

  ✅ **Las dos, decididas (owner, 2026-09-29, en el selector interactivo de la orquestadora):**
  1. **Cruza niveles.** "No se combina" bloquea cualquier otro descuento, sea de la venta o de una
     línea. Escena: un cupón de bienvenida del 10% sobre la venta, marcado "no se combina", y un
     happy hour sobre la cerveza. Eligió *A: sí, bloquea todos* (recomendada) por sobre *B: solo
     los de su mismo nivel*.
  2. **Bloquea también las promociones.** Escena: 2x1 de cerveza los martes y un cupón que no se
     combina. Eligió *A: sí, tampoco va con promos* (recomendada) por sobre *B: las promos van
     siempre*. El cliente se queda con uno de los dos, y el sistema tiene que avisar cuál se
     aplicó. ⚠️ Cuál gana cuando chocan (¿el que más descuenta?) no se preguntó: es lo primero
     que tiene que resolver la spec, y si no sale del mercado, se le pregunta al owner.

- [ ] **Compras: carga manual, y el DTE del SII como atajo encima** ✅ *(tres decisiones del
  owner el 2026-09-03: la varianza va **después** de compras; la recepción **puede leer la
  factura del proveedor desde el SII**; y esa lectura **no puede ser el único camino**. Antes
  eran las preguntas 3 y 4 de la § 4)* —
  ⛔ **Es la primera integración con el SII del sistema, y es de ENTRADA.** [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md)
  difirió la **emisión**; leer documentos recibidos es otro eje. Queda registrado que el orden
  se invierte respecto de lo que cualquiera supondría: **vamos a leer DTE antes de emitir uno**.
  **De la lectura del DTE no existe nada** (verificado 2026-09-19): ni credenciales, ni
  cliente del SII, ni mapeo proveedor→ítem. Lo que sí existe desde el 2026-09-19 es el
  módulo de compras con la **carga manual**, o sea el formulario que el DTE va a pre-llenar
  ([`features/compras.md`](../features/compras.md), pieza 1 en [`resueltos.md`](resueltos.md)).
  📌 **Investigación de la lectura (2026-09-27, un cliente la pidió):**
  [`investigaciones/2026-09-27-carga-stock-por-factura.md`](investigaciones/2026-09-27-carga-stock-por-factura.md).
  Lo que más pesa: el Registro de Compras del SII trae **una línea por documento**, sin productos
  (formato IECV del SII), así que las líneas salen solo del **XML** del DTE; y sin la pieza 2 el
  XML pre-llena "3 CJ" donde el stock cuenta unidades.

  ⛔ **La carga manual NO es un plan B: es el camino base** (owner, 2026-09-03, agregado el
  mismo día que la decisión de leer del SII). Leer la factura **no puede ser el único camino**.

  **Por qué, con los casos que lo fuerzan:**

  - **Hay compras sin DTE.** El proveedor que no es emisor electrónico, la feria mayorista, el
    productor chico que le vende la verdura al restorán. Existen y hoy quedarían inexpresables.
  - **Y las que tienen DTE no lo tienen a tiempo.** La mercadería llega el lunes y el documento
    aparece en el SII el miércoles. Si la recepción depende del documento, **el stock queda mal
    dos días** — y el stock mal es una mesa trabada, no un problema contable.
  - **Una caída del SII bloquearía recibir mercadería.** Es meter una dependencia externa en un
    flujo diario del local.

  📌 **La regla de diseño que se sigue, y es la que más importa:** hay **una sola recepción**,
  con **dos formas de llenarla**. El DTE **pre-llena el mismo formulario** que alguien podría
  tipear — no es un segundo flujo con su propia forma. Dos caminos que produzcan registros
  distintos es exactamente lo que `CLAUDE.md` prohíbe, y acá se notaría enseguida: la varianza
  y el CPP leen de un solo lugar.

  ✅ **Alcance de la primera fase, decidido por el owner el 2026-09-18** tras una
  investigación de mercado ([`investigaciones/2026-09-18-compras.md`](investigaciones/2026-09-18-compras.md) §5):
  recepción sin orden de compra; tipo de documento siempre, con "sin documento" como
  opción; proveedor siempre; el costo puede faltar al recibir y se completa con la
  factura, sin tocar lo que ya salió; deuda con el proveedor y pagos desde el inicio, con
  la salida de caja automática; unidad de compra por proveedor ("caja de 12"); gastos sin
  stock con categoría; descuento global y bonificados repartidos en el costo. Quedan
  fuera: orden de compra, devolución al proveedor, moneda extranjera y flete. ⛔ Falta
  la pregunta fiscal (IVA no recuperable e ILA en el costo), que es frente propio.

  ✅ **Y esto reordena la construcción a favor:** compras **manual se construye sin ninguna
  integración**, así que la lectura del DTE queda como **segunda fase**. La varianza —que espera
  a compras— deja de esperar además a que funcione una integración con el SII.

  📌 **La pieza 1 —recibir mercadería— salió el 2026-09-19, y la pieza 2 —la unidad de compra
  por proveedor— el 2026-09-27**; el detalle de las dos está en [`resueltos.md`](resueltos.md).
  Lo que sigue abierto de este frente:

  **Las piezas que faltan, cada una con su spec y en este orden:**
  - **Pieza 3: hecha (2026-09-29).** La deuda con el proveedor y sus pagos, con la salida de
    caja automática. Detalle: [`features/compras.md`](../features/compras.md) § "La deuda con
    el proveedor"; spec
    [`2026-09-28-compras-deuda-proveedor-design.md`](../superpowers/specs/2026-09-28-compras-deuda-proveedor-design.md);
    plan [`2026-09-28-compras-deuda-proveedor.md`](../superpowers/plans/2026-09-28-compras-deuda-proveedor.md).
    Lo fiscal y la factura que agrupa varias guías quedaron fuera a propósito (spec § 13): sus
    entradas están más abajo en esta misma sección.
  - **Pieza 4:** los gastos sin stock, con la categoría que define el tenant.
  - **La lectura del XML del DTE: hecha (2026-09-27).** El encargado sube el XML y el borrador de
    siempre queda pre-llenado; el código del proveedor se aprende en una tabla propia
    (`codigos_proveedor`, no en la presentación como anticipaba la pieza 2 § 9), y la próxima
    factura del mismo proveedor calza sola. Detalle:
    [`features/compras.md`](../features/compras.md) § "La lectura del XML y el aprendizaje";
    cierre en [`resueltos.md`](resueltos.md). Spec con las seis decisiones del owner:
    [`2026-09-27-compras-xml-dte-design.md`](../superpowers/specs/2026-09-27-compras-xml-dte-design.md).
    Lo que quedó **fuera** por decisión del owner (spec § 10):
    - **Completar los precios de una compra ya confirmada con el XML** — la escena del lunes
      sin factura y el XML del miércoles. Hoy el XML solo llena una compra nueva; si el folio
      existe, ofrece abrirla y el precio se completa a mano. Costo de tomarlo: emparejar las
      líneas del XML con las ya cargadas (la factura dice 20, llegaron 17) y pasar por el
      recálculo del CPP.
    - **Una pantalla de códigos por proveedor** (qué código apunta a qué producto, y cuáles son
      "no es mercadería"). Hoy una asociación mala se ve y se corrige en la línea cuando llega
      una factura con ese código.
    - **Traer el XML desde el SII** (Portal MIPYME, casilla de intercambio) en vez de que el
      encargado lo suba a mano.
    - ⛔ **Aceptar o reclamar el DTE** (Ley 19.983) y **verificar su firma digital**: leer el XML
      para pre-llenar no es tomar posición fiscal sobre el documento — la pantalla lo dice
      ("Aceptar o reclamar esta factura se sigue haciendo en el SII").
    - **Notas de crédito y débito del proveedor** (56, 61): fiscal y deuda, van en su propio
      frente; hoy se rechazan con "Las notas de crédito y débito no se cargan acá".

  **Bordes de la pieza 1 que quedaron abiertos** (los tres verificados contra el código el
  2026-09-19):
  - `UbicacionesService.remove` no mira los borradores de compra: se puede borrar la bodega de un
    borrador, y después guardarlo o confirmarlo da 400 "Ubicación no encontrada"
    (`ComprasService.validarEncabezado`). No se pierde nada, porque el borrador no movió stock,
    pero el mensaje no dice que la borraron.
  - En la carga del borrador, una línea en lote sin código o en serie sin series llega al backend y
    vuelve como 400 en un toast, en vez de marcarse en el formulario.
  - **El pie muestra un total negativo mientras se tipea un descuento mayor al subtotal.**
    `totalConDescuento` (`frontend/app/composables/useCompras.ts:116`) resta sin piso y
    `puedeGuardar` (`frontend/app/pages/compras/[id].vue:237`) no mira el total, así que el
    rebote llega recién al guardar, como toast del 400 de `validarDescuento`. ✅ **Decidido
    (owner, 2026-09-29): el campo se marca en rojo al tipear**, y no se puede guardar hasta
    corregirlo. Cómo se decidió: en el selector interactivo de la orquestadora, con la escena de
    una compra de $50.000 y un descuento de $60.000 tipeado por error. Eligió *A: marcar el campo
    en rojo al tipear* (recomendada) por sobre *B: el pie se queda en $0*. El backend sigue siendo
    la red.

  ⚠️ **Cuatro cosas que hay que tener presentes, y la primera no es técnica:**

  1. ⛔ **Leer facturas arrastra un reloj legal.** Por la **Ley 19.983** el comprador tiene
     **8 días corridos** para reclamar una factura electrónica, y **el silencio es aceptación
     tácita** **[SECUNDARIA]**. Mostrarle al tenant sus facturas recibidas lo deja **al lado**
     de una decisión con plazo legal. **El alcance tiene que decir explícitamente si acepta y
     reclama o solo lee** — y si solo lee, la pantalla tiene que dejar claro que aceptar o
     reclamar se sigue haciendo en el portal del SII. Mismo riesgo que la guía de despacho:
     *tenerlo a la vista no es haberlo hecho*.
  2. **Lo caro NO es la integración: es el mapeo de ítems.** La factura dice
     *"HARINA 25KG SACO"* y nosotros tenemos *"Harina"* medida en kilos. Hay que resolver
     **qué ítem es** y **cuántas unidades base entran**, proveedor por proveedor. La conversión
     de unidades ya existe como feature; el mapeo proveedor→ítem, no.
  3. **La recepción no es solo stock: es la fuente del costo.** Una entrada con
     `motivo='compra'` alimenta el **CPP** ([ADR-016](../adr/016-costeo-promedio-ponderado-movil.md)),
     y de ahí salen márgenes, food-cost, mermas valorizadas y el simulador de impacto. Un costo
     mal mapeado **no se queda en compras**.
  4. **Credenciales fiscales por tenant.** Hay precedente de cómo guardarlas cifradas:
     [ADR-008](../adr/008-cifrado-credenciales-pasarela.md), de la pasarela de pagos.

  🔁 **Pendiente de revisar ahora que compras existe: el atajo del ajuste de stock.**
  `AjusteStockDto` acepta `motivo='compra'`, así que una compra se puede seguir cargando por
  Inventario sin proveedor ni documento —y entonces no aparece en el listado de compras ni,
  cuando exista, en la deuda—. El owner decidió el 2026-09-18 **mantenerlo**, como Bsale y
  Square, y **revisarlo cuando Compras esté en uso real**
  ([`investigaciones/2026-09-18-compras.md`](investigaciones/2026-09-18-compras.md) §5). La
  pieza 1 puso el flujo en pie, pero "en uso real" es el smoke del owner y lo que venga
  después, no el merge: la revisión sigue esperando.

---

## 2. Proyectos con spec propia

No entran de arrastre dentro de otra tarea. Las que llevan una pregunta para el owner la
tienen como primer paso: después queda la spec entera. El contexto de dónde salió cada una
es parte del enunciado y viaja con ella.

- [ ] **La caja elige descuentos y recargos de nivel venta: pantalla y permiso** (anotado
  2026-10-06 al cerrar "Los ids de reglas que manda el cliente salen del ítem", ver
  [`resueltos.md`](resueltos.md)). Las reglas de nivel venta (*"Promo del total $5.000"*,
  *"Recargo por pedido chico"* del seed) entran **solo** por `descuentosVentaIds` /
  `recargosVentaIds` de `POST /ventas` y `/calculo-precios/calcular`, y ninguna pantalla los
  manda: el admin las puede crear y nadie las puede aplicar. Por decisión del owner (2026-10-06):
  *"si un día la caja necesita elegir descuentos a mano, se diseña con su pantalla y su permiso"*.
  La Sesión de esfuerzo máximo revisó ese mismo día su decisión derivada, con la medición del frente:
  los dos campos **quedan abiertos en la caja** porque son la única puerta de una feature diseñada,
  y se cerraron en la tienda. ⚠️ **Hoy esa puerta no pide permiso propio**: alcanza `Ventas:Crear`,
  así que quien vende puede aplicar por la API cualquier regla de venta del tenant. El permiso entra
  con la pantalla. **Lo que hay que decidir:** quién elige (cajero o supervisor), con qué permiso, y
  si un descuento de venta elegido a mano pide autorización o motivo.

- [ ] **La tienda online y la suscripción no piden RUT: una compra de más de 135 UF se rechaza**
  (anotado 2026-10-04 al cerrar "Una venta de más de 135 UF…", ver [`resueltos.md`](resueltos.md)).
  Sobre el umbral de la Res. Ex. SII 44/2025 la boleta lleva nombre y RUT de quien paga, y ni el
  checkout de la tienda ni el alta de una suscripción los piden. Por decisión del owner
  (2026-10-04, AskUserQuestion de la Sesión de esfuerzo máximo) esas compras dan **400 antes del
  cobro** (`VentasService.exigirCompraOnlineBajoUmbral`, en `OnlineService.pagar` y en
  `SuscripcionesService.crear`) y la pantalla nueva queda para acá. **Lo que hay que decidir:**
  si la tienda pide nombre y RUT cuando el carrito pasa el umbral (y cómo viajan en la orden hasta
  el callback de Webpay, que hoy congela solo el nombre del usuario), o si el rechazo alcanza.
  En un restaurante es raro; en retail online (electrónica, muebles), no.

- [ ] **El registro interno de la Res. Ex. SII 44/2025 no tiene export** (fiscal, **frente
  propio**; anotado 2026-10-04 al cerrar "Una venta de más de 135 UF…"). La resolución
  (resolutivo 5°) pide desde el 1-jun-2025 mantener a disposición del SII un registro de las
  ventas sobre el umbral *"mientras su sistema de emisión de boletas se ajusta para identificar
  al comprador"*, con las columnas del Anexo I: RUT del comprador, fecha, detalle de los
  productos, monto total y folio de la boleta. Los datos ya quedan congelados en cada venta
  (`venta_customer`, `venta_detalles`, `venta_documentos`); el export es formato y se difirió
  (la Sesión de esfuerzo máximo, 2026-10-04; ADR-010). **Lo que hay que decidir:** si hace
  falta mientras el sistema no emita al SII. Ojo: el folio de una boleta del sistema no existe
  todavía (ADR-010); el detalle sale de `venta_detalles.descripcion`, que congela el nombre del
  ítem al vender.

- [ ] **Devolución por medio de pago + configuración de plazos** (backend, tema propio con
  spec) — surgido del aporte del owner el 2026-07-27, **no es parte de los fixes de la
  auditoría**. Hoy hay dos caminos de devolución que no se conocen entre sí: el de tarjeta
  arranca en la pasarela (`reembolsar()` de Webpay/Oneclick, ya implementado) y termina en
  una NC; el de efectivo arranca en la NC y sale por la caja. Nada compone las patas ni
  impide pagar con tarjeta y recibir efectivo. Además **no hay validación de plazo en
  ningún lado**: el límite de Transbank se descubre como rechazo en runtime. La
  configuración de plazos que se proponga debe separar **tres relojes** —fiscal (SII, sale
  del país), adquirente (propiedad de la integración) y política comercial (lo único
  configurable por el tenant)—, con los dos primeros como techos y el retracto de venta a
  distancia como piso en `online`. Construirlo plano permite que un tenant configure 12
  meses y la empresa se coma el IVA. Análisis completo y fuentes:
  `docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md` §6.
  ✅ **Tres decisiones del owner (2026-09-29)**, después de una segunda pasada de investigación
  que él eligió hacer primero
  ([`investigaciones/2026-09-29-devolucion-por-medio-de-pago.md`](investigaciones/2026-09-29-devolucion-por-medio-de-pago.md)).
  Las tres las contestó en el selector interactivo de la orquestadora, con la opción recomendada:
  1. **Pago mixto: la devolución se reparte en proporción a cómo pagó**, en una sola operación.
     Escena: $15.000 pagados con $10.000 de tarjeta y $5.000 en efectivo; vuelven $10.000 a la
     tarjeta y $5.000 de la caja. Descartado: *como hoy, el cajero reparte*. Es lo que compone
     las dos patas que esta entrada dice que no se conocen.
  2. **Efectivo por una venta con tarjeta: solo si Transbank rechazó el reembolso** (por ejemplo,
     tarjeta cerrada). El cajero no lo elige por comodidad. Descartadas: *con aprobación de
     supervisor y un tope* (lo que hacen Toast y otros) y *nunca*. Hay que distinguir el rechazo
     de Transbank, y el tope de hoy (efectivo devuelto ≤ efectivo cobrado en la venta, que no se
     publica por el modo ciego) tiene que ceder solo en ese caso.
  3. **Retracto online: el local declara su política antes de vender online**, sin valor por
     defecto. Según la investigación [PRIMARIA: sernac.cl], la ley da 10 días, pero si el
     comercio no informa que no acepta retracto el plazo sube a 90. Descartadas: *90 días por
     defecto* y *10 días fijos por ahora*. ⛔ No está validado por un abogado: se suma a la
     entrada del abogado de la § 7.
  ⚠️ **Lo que sigue sin decidir:** el techo fiscal (plazo del SII para la NC) es fiscal y va en
  su propia sesión. Webpay Plus y Oneclick no publican un tope de días para reembolsar (la
  investigación no lo encontró): hay que pedírselo a Transbank, no suponerlo.

- [ ] **Una persona cobrando en dos grupos de la misma liquidación** (backend + frontend,
  tema propio) — hoy el conflicto se corta con un 400 accionable que sugiere la fecha de
  corte (cerrado el 2026-07-27, ver [`resueltos.md`](resueltos.md)); **soportarlo de
  verdad es un cambio de modelo** que el owner difirió hasta que el caso aparezca:
  índice `(liquidacion_id, grupo_id, garzon_id)` **más** re-keyear los ajustes, que hoy se
  identifican solo por `garzonId` —excluir la sacaría de los dos grupos, y un monto manual
  escribiría el mismo número en sus dos filas rompiendo la conservación de ambos—. Toca
  DTO, service, composable, la página y la impresión por persona: **medio día a un día**,
  con la decisión de cómo se imprime adentro.
  Dos cosas chicas que quedaron de la salida acotada: la fecha de corte sugerida sale solo
  de los tips, así que una sesión del primer rol que se extienda más allá del corte hace
  reaparecer el conflicto en el segundo intento (vuelve a cortar con el mismo 400, no
  genera datos malos, pero un corte no alcanza y hay que acotar turnos); y falta un test
  dedicado del conflicto por el camino de `actualizarConfig` —hoy solo se ejerce por
  `crear`, aunque ambos comparten la misma función.

- [ ] **Saldo en contra cuando se anula una venta cuya propina YA se liquidó** (backend,
  tema propio con spec) — decidido 2026-07-27, **no implementado**: es una entidad nueva y
  toca el motor de reparto, así que no entra como fix de auditoría.
  **El caso:** la propina se liquidó el lunes y se le pagó al garzón; el miércoles anulan
  esa venta (sigue `pendiente` y sin pagos, así que `POST /ventas/:id/anular` la acepta). La
  plata ya salió. **La forma decidida:** permitir la anulación y dejar el monto ya pagado
  como **saldo en contra del garzón**, que se descuenta de su próxima liquidación.
  Preguntas que la spec tiene que responder antes de escribir código: qué pasa si el garzón
  no vuelve a liquidar nunca (¿el saldo caduca? ¿se pierde?); qué pasa si su próxima
  liquidación es **menor** que el saldo (¿queda saldo remanente? ¿se le descuenta hasta
  0?); si el saldo es por garzón y por tenant, o también por período/turno; si el descuento
  se muestra en la impresión y el reporte; y cómo se audita (evento propio, como el resto de
  la liquidación). La mitad barata —que la propina de una venta anulada no entre a
  liquidaciones **futuras**— ya está cerrada ([`resueltos.md`](resueltos.md)).
  ✅ **Dos de esas preguntas, decididas (owner, 2026-09-29, en el selector interactivo de la orquestadora, las dos con la
  recomendada):** el saldo **no vence** (queda a la vista del supervisor hasta descontarse, o
  hasta que alguien lo perdone a mano, con registro de quién), y si la próxima liquidación es
  menor, **se descuenta todo lo que alcance** y el resto pasa a la siguiente. ⛔ **Antes de
  construirlo:** descontarle a un trabajador tiene un ángulo legal chileno sin validar, el mismo
  de la entrada del abogado en la § 7 (ORD. N°4229). Se le avisó al owner en la pregunta. Esto se
  suma a lo que tiene que validar el abogado.

- [ ] **Recuento de inventario en modos `serie` y `lote`** (backend + frontend) — el recuento
  (`docs/features/recuento-inventario.md`) cubre solo `modo_inventario='cantidad'`; los
  productos por serie o lote quedan fuera del listado y agregarlos a una sesión devuelve 400.
  No es una extensión trivial del mismo formulario:
  - **`lote`**: es un número **por lote vivo** (una fila por lote con su vencimiento). El delta
    y el movimiento se resuelven por lote, no por producto. Es el más cercano a lo ya hecho.
  - **`serie`**: no es una cantidad sino una **diferencia de conjuntos** — qué identificadores
    esperaba el sistema, cuáles se escanearon, cuáles faltan (→ salida de esas unidades) y
    cuáles aparecieron sin estar registrados. Ese último caso **no tiene respuesta obvia**
    (¿entrada de una unidad desconocida? ¿error a corregir aparte?) y es una decisión de
    negocio del owner antes de diseñar.

  Cerrar cuando aparezca la necesidad real: hoy el caso que motiva el recuento es food-service,
  donde insumos e ingredientes son todos `cantidad`.

- [ ] **Persistir que una venta salió sin un insumo** — el teórico de la varianza queda corto sin
  que nada lo registre. Cuando un ingrediente **no bloqueante** no tiene stock, la venta sale igual,
  el movimiento de kardex **no se escribe** (`ItemsService.moverConsumoOSaltear`) y el aviso *"se
  vendió sin ese insumo"* viaja solo en la respuesta HTTP. Después no hay forma de saber que pasó:
  el reporte de varianza calcula el teórico desde el kardex, así que ese consumo aparece como
  "sin explicación" y ningún aviso lo puede desarmar (spec de la varianza § 5.6, caso 3). Va
  **solo**: toca el camino caliente de la venta.

- [ ] **Lo fiscal de la deuda con el proveedor: calcular IVA/ILA, validar el total contra el
  neto, y la factura de compra (código 46) con retención** (fiscal — **frente propio, con su
  propia sesión**: `CLAUDE.md` invariante 5 y ADR-010, § 13 de la spec de la pieza 3 de
  compras). La pieza 3 (`2026-09-28-compras-deuda-proveedor-design.md`, decisión 10) dejó la
  deuda de una compra con documento como el **total transcrito**, sin calcularlo ni validarlo
  contra el neto de las líneas — "el sistema no lo calcula, no calcula impuestos y no lo valida
  contra el neto de las líneas (la diferencia es el impuesto, y decidirlo es del frente fiscal)".
  Lo que queda por decidir ahí, junto: si el sistema calcula el IVA (o el ILA, para bebidas
  alcohólicas) sobre el neto de las líneas y lo compara con el total transcrito para avisar un
  desajuste; y la factura de compra (DTE 46, con retención), que hoy ni se distingue de una
  factura normal en el catálogo de tipos de documento del proveedor. Ninguna de las dos se
  resuelve como parte de otra tarea: la regla la pone el owner.

- [ ] **Una factura que agrupa varias guías de despacho, en compras** (spec § 13 de
  `2026-09-28-compras-deuda-proveedor-design.md`). La pieza 3 dejó `total_documento`
  `opcional` en la guía de despacho (decisión 11: se recibe sin total y se completa cuando
  llega la factura) pero cada compra sigue con su propio total — si una factura cubre tres
  guías, hoy su total se reparte **a mano** entre las tres compras, una por una. Una pantalla
  que sepa "estas N compras corresponden a una sola factura" y reparta el total ella misma (por
  ejemplo, proporcional a lo recibido en cada guía) queda para cuando aparezca el caso real: no
  hay owner que lo haya pedido todavía, y repartir a mano las pocas veces que pasa es más barato
  que construir el reparto automático de arrastre.

- [ ] **Pagar desde la caja de otra persona, en compras** (spec § 2 decisión 3 y § 13 de
  `2026-09-28-compras-deuda-proveedor-design.md`) — **posible suma futura, no decidida**. Hoy
  el efectivo de un pago a proveedor sale **solo** de la caja física abierta de quien registra
  el pago (`CajaService.findActiva`); si el dueño no atiende caja, no puede pagar en efectivo sin
  abrir una. La opción descartada al diseñar la pieza 3 (elegir cualquier caja abierta, limitado
  a quien supervisa cajas) metía el descuadre de un error del que paga en el cierre de otra
  persona, así que quedó fuera. **Se retoma si se ve que el dueño nunca abre caja** (la condición
  que la spec deja escrita) — no antes, y no como parte de otra tarea.

- [ ] **Integración con un facturador externo (emitir de verdad)** (backend; **fiscal: frente
  propio**, ADR-010). El frente de emisión por venta construye el facturador externo **sin
  integración**: el comercio hace el documento en su facturador, acá se anota el número a mano, y
  al anular se le pregunta si ya lo hizo (`PRODUCTO.md` § 10). Con integración, el sistema le manda
  la venta al facturador (Bsale, OpenFactura u otro) y recibe el número solo; la pregunta al anular
  deja de hacer falta porque el sistema sabe si el documento existe. Es la misma pieza que la
  emisión real del "emite el sistema", así que van juntas. El diseño de hoy deja el lugar: el
  número que hoy se tipea, mañana lo llena la integración. Decidido por el owner el 2026-10-01
  (AskUserQuestion: "anotado para después"); sin fecha.

### Los tipos de regla por TIEMPO, que siguen esperando el vencimiento de venta (2026-08-24)

**Lo que queda, y es un frente propio:** `mora`, `pronto_pago`, `interes_simple` e
`interes_compuesto`. Los cuatro dependen de que una venta tenga **vencimiento**, que no
existe como concepto en el sistema, así que van con el frente de crédito y **no antes**.

⚠️ **Los dos intereses no están diferidos: cobran, y cobran mal.** `interes_simple` aplica su
"tasa mensual" **una sola vez** sobre la base, sin mirar plazo —una venta a 1 mes y otra a 6
cobran lo mismo— e `interes_compuesto` hace **exactamente lo mismo**: ninguna rama del motor
los distingue, así que hoy la diferencia entre los dos tipos es solo el nombre. `mora` y
`pronto_pago` sí están en `DIFERIDAS` y no hacen nada.

🔨 **Hay que DESARROLLARLOS, no esconderlos** (owner, 2026-08-23, al descartar la pausa).
Las tres preguntas que hay que contestar antes de escribir una línea:
- **De dónde sale el plazo de una venta a crédito.** Es el prerequisito que comparten los
  cuatro; conviene decidirlo una sola vez.
- **Si el interés se calcula al vender o al cobrar.** Al vender queda congelado en el
  documento —lo que pide ADR-010 para el hecho fiscal— pero un pago adelantado no lo baja. Al
  cobrar sigue la realidad, pero el total del documento deja de ser el total.
- **Con qué periodicidad capitaliza el compuesto**, que es lo único que lo distingue del
  simple.

✅ **Dos de las tres, decididas (owner, 2026-09-29)**, después de una pasada de investigación
de mercado que él eligió hacer primero
([`investigaciones/2026-09-29-venta-a-credito.md`](investigaciones/2026-09-29-venta-a-credito.md)).
Las dos las contestó en el selector interactivo de la orquestadora, con la opción recomendada:
- **El plazo es del cliente, y cada venta lo puede cambiar**, igual que el plazo del proveedor en
  compras (`terceros.plazo_pago_dias`, 30 días por defecto por la Ley 19.983, más el vencimiento
  por compra). Escena: un catering de $300.000 a una empresa que paga a 30 días. Descartadas:
  *un plazo único del local* y *se tipea en cada venta*.
- **`interes_compuesto` se saca**: quedan el simple y la mora fija. La investigación no encontró
  ningún POS ni ERP que capitalice interés por mora; es "no se encontró", no "el mercado lo
  evita". Si un cliente lo pide, se reabre.
⛔ **La tercera (al vender o al cobrar) queda para el frente fiscal**, porque es cómo se
documenta la mora. Según la investigación [SECUNDARIA, sin verificar en sii.cl], el SII dejó de
pedir factura o nota de débito por la mora de la Ley 19.983 en 2020 (Oficio N° 2011): se
verifica contra la fuente primaria en esa sesión, no se da por cierto acá. La investigación
también dice que el interés pactado sobre la TMC (CMF) anula el cobro entero: es techo legal,
y un tenant no debería poder configurar una tasa por encima.

⚠️ **El motor sigue sin saber de tiempo, y ése es el trabajo de verdad.** La vigencia por
fecha NO se lo enseñó: se resolvió en la capa de servicio, que le pasa un booleano ya
calculado. Su magnitud sigue siendo `codigo === 'por_mayor' ? ctx.cantidad : ctx.monto`. Darle
plazo es agregarle una dimensión, no una rama.

⛔ **Toca el motor de precios: va solo y con el sistema quieto** (`CLAUDE.md`).

---

## 3. Refactors — cambian nombres o lugares, no agregan funciones

Van acá y no con los arreglos (owner, 2026-10-06, en el mismo selector): hoy nada falla por
ellos, así que se hacen cuando el owner los pida, cada uno como frente propio.

De la deuda chica que quedaba, el **2026-08-24 salieron tres**: la escala de la pasarela, el
`minimo` de un tramo y el tramo en cero (las tres en [`resueltos.md`](resueltos.md)). **La
única que sigue es el renombre de `moneda.decimales`** — y ojo, su entrada subestima el
tamaño. Medido ese día:

```bash
grep -rn 'decimales' backend/src backend/test frontend/app frontend/server frontend/e2e | wc -l
```

**394 ocurrencias en código y tests** (155 backend sin specs · 115 specs de backend · 31 e2e ·
93 frontend), más las de `docs/`. No son 394 renombres —el grep incluye la palabra suelta en
comentarios— pero sí muestra que el nombre se **propagó a métodos y campos**
(`decimalesOficiales`, `decimalesDeLaVenta`, `decimalesMoneda`, `ctx.decimales`), que es lo
que lo convierte en un frente propio y no en un remate.

⚠️ El comando va escrito porque la primera vez este dato se anotó como "459 ocurrencias en 5
superficies" sumando conteos de código con un conteo de docs hecho con **otro patrón**. La
revisión independiente no lo pudo reproducir, con razón.

- [ ] **Renombrar `moneda.decimales`** (backend + frontend, decisión explícita de dejarlo
  afuera, 2026-08-21) — el nombre es ambiguo: **es lo que causó que el propio owner leyera
  la spec al revés**, entendiéndolo como dato de formato de UI. Es el minor unit de la
  moneda. Un nombre como `minor_unit` o `decimales_minor_unit` cierra la duda en el punto de
  lectura, que es donde se produce.
  **Por qué no entró:** toca frontend, propinas y seeder, y meterlo en el frente de redondeo
  habría sido exactamente el arrastre que el aislamiento de la tanda 🔴 impedía.
  **Mientras tanto el significado está escrito** en
  [`features/configuracion-monedas.md`](../features/configuracion-monedas.md), que es el
  documento que inducía la lectura equivocada.

- [ ] **"Garzones" es el nombre equivocado: el modelo ya es de personal con PIN** (backend +
  frontend + BD, **idea del owner 2026-08-11, medida ese día**) — la tabla `garzones` ya
  admite `tipo IN ('garzon','cocina','barra')`: gente que **no atiende mesas**, con PIN,
  sesión de turno y reparto de propinas. O sea, "staff" **ya existe conceptualmente**; se
  llama garzón por herencia del primer caso de uso. El disparador fue el testigo del cierre
  de caja: un minimarket no tiene garzones, así que hoy no puede tener testigos.

  **Costo medido:** ~2.974 menciones en **104 archivos** (columnas de BD, entidades,
  endpoints, composables del front, tests) y toca la tabla de terminología de `CLAUDE.md`,
  que es crítica. Lo que **no** cuesta: no hay datos productivos, así que no hay migración —
  se cambia el esquema, se actualiza el seeder y se resetea (ver la sección *"Endurecimiento
  para producción"* más abajo: hoy `main` no despliega y no hay nada en uso real). El costo
  es el barrido, no el riesgo.

  **Atajo que da el beneficio sin pagar el rename** (evaluado, no implementado): separar la
  **etiqueta que ve el usuario** del nombre en el código —la pantalla dice "Personal", la
  base sigue diciendo garzones— más un `tipo` nuevo para el personal que no es de salón. Con
  eso un minimarket ya puede tener testigos y la limitación de la
  [spec del testigo](../superpowers/specs/2026-08-11-testigo-cierre-forzado-design.md)
  desaparece.
  ✅ **DECIDIDO (owner, 2026-09-29, en el selector interactivo de la orquestadora): el atajo, no el rename.** Eligió *B: cambiar
  solo lo que ve el usuario* (recomendada) por sobre *A: renombrar todo*. La pantalla dice
  "Personal" y se agrega un `tipo` para el personal que no es de salón. El rename completo queda
  sin fecha: si algún día se hace, sigue yendo solo.

  ⚠️ **El día que se haga el rename completo, va solo.** Un rename es mecánico pero se
  contamina fácil: mezclado con una feature, cualquier bug queda escondido entre 3.000 líneas
  cambiadas y la revisión del diff deja de servir.

- [ ] **Candidatos a mudarse al módulo de reportes** (spec
  [`2026-09-19-modulo-reportes-varianza-design.md`](../superpowers/specs/2026-09-19-modulo-reportes-varianza-design.md)
  § 3.3, owner 2026-09-19). Los cinco de **negocio** que hoy viven en su módulo:
  `/propinas/reportes/resumen` y `/trabajadores`, `/caja/tendencia`,
  `/salones/anulaciones/resumen` y `/ventas/resumen`. ⛔ **Se mudan de a uno y con una razón
  concreta** —que alguien pida compararlos, exportarlos o verlos juntos en el menú—, **nunca en una
  tanda**: mudar cuesta rutas, pantallas y riesgo sobre código que funciona. Al mudar uno, se
  agrega al catálogo de `frontend/app/composables/useReportes.ts` con su propio `modulo_app`
  (`docs/features/modulo-reportes.md`).

---

## ⏸ En pausa: otros países hasta terminar Chile

La decisión (owner, 2026-10-03) está en [`pendientes.md`](pendientes.md), en la sección del
principio: no se toma nada de Argentina, Colombia ni México hasta terminar Chile. Lo que de eso
es desarrollo nuevo vive acá.

### El frente fiscal de Argentina, Colombia y México — documentos tributarios e impuestos de sistema (agendado 2026-09-03)

⏸ **En pausa hasta terminar Chile** (owner, 2026-10-03; ver la sección del principio).

ℹ️ **Vino de la § 4**, donde entró el 2026-09-03 como pregunta al owner y salió el mismo día:
el owner contestó que **los tres países van a emitir de verdad, progresivamente**, y el
relevamiento de las tasas mostró que lo que falta no es una respuesta suya sino **modelo**. Se
conserva el texto con el que se tomó, porque explica por qué existe.

**Los dos frentes que quedan, uno por país:** los **documentos tributarios** de verdad
(factura A/B/C en Argentina, documento equivalente electrónico en Colombia, CFDI en México) y
los **impuestos de sistema**, que no son un porcentaje sino tres decisiones de modelo
distintas —ver el punto 🟡 más abajo y la
[investigación § 3](investigaciones/2026-09-03-facturacion-electronica-latam.md).

Lo destapó la **revisión de rama** del frente del redondeo por país, que es la única que
podía verlo: la tarea que siembra una provincia por país nuevo y la que da de alta el tenant
son correctas por separado.

**El receptor de la factura de cada país** (sumado 2026-10-03, al cerrar el de Chile, ver
[`resueltos.md`](resueltos.md)): `VentasService.receptorDeLaVenta` solo tiene escrita la regla
chilena (receptor completo de la Factura, RUT con DV módulo 11). Para AR/CO/MX,
`customer_requerido` exige solo el nombre y el identificador fiscal no se valida (un CUIT, un
NIT o un RFC tienen su propio dígito o formato). Cuando se tome cada país: qué receptor exige su
documento y cómo se valida su identificador.

**Qué pasa:** sembrar la provincia volvió alcanzable `POST /admin/tenants` con un
`provinciaId` de AR/CO/MX. El país gobierna **tres** catálogos, y hasta este frente los tres
tenían solo Chile. Los métodos de pago ya se sembraron → [`resueltos.md`](resueltos.md); quedan
los otros dos:

- **Impuestos de sistema** — 🟡 **no arreglado, y la pregunta estaba mal planteada.** El seed
  solo trae el IVA chileno (`seedImpuestos`, `paisId: CHILE`) y los ítems resuelven con
  `i.tenant_id = $2 OR i.pais_id = <país del tenant>`, así que un tenant AR/CO/MX nace sin
  ningún impuesto de sistema. **Sí puede crearse los suyos** desde la pantalla de impuestos
  (`TenantAdminGuard`), así que no queda trabado.

  ⛔ **Corregido el 2026-09-03: esto NO es "falta que el owner diga el porcentaje".** El owner
  preguntó cuáles serían, se relevaron, y lo que apareció fue que **el porcentaje es lo fácil**
  — sembrarlo destapa tres decisiones de modelo, distintas en cada país
  ([investigación § 3](investigaciones/2026-09-03-facturacion-electronica-latam.md)):

  1. **"El IVA del país" deja de ser un número.** [ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)
     deriva el IVA de la clasificación del ítem. Con una tasa sola cierra; con dos o tres
     —AR 21/10,5 · CO 19/5/excluido · MX 16/0— `afecto | exento` ya no alcanza para saber
     **qué tasa** le toca a **ese** ítem.
  2. **Colombia rompe el significado de la clasificación.** Un restaurante colombiano no cobra
     IVA: cobra **INC 8%** (impoconsumo). Eso cae como `tipo: 'otro'` y **no pasa por el
     mecanismo derivado**, así que `afecto` significa una cosa en Chile y otra en Colombia
     dentro del mismo motor. Y si el tenant es franquicia, vuelve a IVA 19%.
  3. **México pide el impuesto colgado de la LÍNEA, no del ítem.** Por el art. 2-A, la misma
     comida va a 0% empaquetada para llevar y a 16% servida en el local: el criterio es el
     contexto de la venta, no el producto.

  📌 Así que esto **no se destraba con una respuesta del owner**: es frente fiscal propio, uno
  por país, del mismo modo que los documentos tributarios. Las tasas relevadas están en la
  investigación, **sin verificar contra la norma** — antes de sembrar cualquiera va la cita al
  lado del valor, mismo criterio que el frente de redondeo.
- **Tipos de documento tributario** — 🟡 **no se sembraron los documentos tributarios de
  verdad de AR/CO/MX**: eso entra con el frente fiscal de cada país, que el owner decidió que
  va a ser **progresivo**. La nota de crédito interna de cada país ya está →
  [`resueltos.md`](resueltos.md).

**Y lo que queda como proyecto agendado, ya sin pregunta para el owner:** los documentos
tributarios de verdad de cada país **y los impuestos de sistema** — el punto 🟡 de arriba dejó
de ser una pregunta el 2026-09-03, cuando se relevaron las tasas y resultó que lo que falta es
modelo, no un número.
Qué documentos emite un local en Argentina (factura A/B/C, ticket fiscal), en Colombia
(factura electrónica, documento soporte) o en México (CFDI con su uso y su régimen) **no es
algo que un agente deba inventar desde un seeder**: [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md)
y el punto *"Lo fiscal va solo"* de `CLAUDE.md` dicen que abre su propio frente, con su propia
sesión, y que la regla la pone el owner.

✅ **Se corrió la investigación de las cuatro autoridades el 2026-09-03** (owner: *"la
facturación la dejamos para después, pero la estructura tiene que ser escalable"*) →
[`investigaciones/2026-09-03-facturacion-electronica-latam.md`](investigaciones/2026-09-03-facturacion-electronica-latam.md).
**No contesta esta entrada** —sigue siendo decisión del owner— pero sí acota la pregunta: lo
único irrecuperable es **qué datos fiscales del receptor se congelan en la venta** (la
condición frente al IVA en Argentina, el régimen + CP + uso del CFDI en México), y eso
depende de una respuesta previa: **si AR/CO/MX van a emitir de verdad o son catálogo demo.**

✅ **Contestada esa mitad el 2026-09-03** (owner): *"van a emitir de verdad, los tres, pero
será progresivo"*. Lo que cambia:

- **No son catálogo demo.** Los campos fiscales del receptor (eje D de la investigación) hay
  que capturarlos; no es opcional. Lo que hoy los hace **no urgentes** es otra cosa, y
  conviene decirla con nombre: **no hay datos productivos** — no se está perdiendo ningún
  hecho fiscal todavía. El reloj arranca con el **primer tenant real vendiendo en cada país**,
  no con esta respuesta.
- **"Progresivo" agrega un requisito que la investigación no tenía:** en todo momento va a
  haber países emitiendo y países que todavía no. O sea que **"emite / no emite" es estado por
  país, no un interruptor global del sistema** — y el país que entra segundo **no puede obligar
  a migrar el historial del primero**. Eso descarta de entrada la solución barata de
  "agregamos las columnas de Chile ahora y ya veremos": las columnas de Chile son las de Chile.

📌 **El alta en esos países no está prohibida** y no va a estarlo: bloquearla rompería la
propia feature del redondeo por país, y el tenant vende, cobra y ahora también reembolsa con el
documento de su país. Lo que **no** se puede decir es que "ya emite": lo que tiene es un
marcador interno, no un documento tributario.
