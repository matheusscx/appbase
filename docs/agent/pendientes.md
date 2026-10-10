# Pendientes — arreglos y correcciones

Backlog de correcciones que se **difirieron a propósito** mientras trabajamos en el
harness, para no mezclar el meta-trabajo (reglas, gates, docs) con cambios de código de
producto. Cada entrada dice qué, dónde, por qué se difirió y cómo se cierra.

Regla de este archivo: **acá solo vive lo que falta hacer.** Cuando una entrada se cierra,
en el mismo commit se muda —con el texto de su cierre— a
[`resueltos.md`](resueltos.md). Nada de `[x]` acumulándose: una lista de trabajo con más
entradas tachadas que vivas deja de leerse. No es un TODO genérico: solo va lo que ya
identificamos con ubicación concreta.

**Desde el 2026-10-06 acá van solo arreglos y correcciones**: algo que ya existe y anda mal, o
le falta un resguardo. Lo que todavía no existe —features, proyectos con spec propia y
refactors— vive en [`desarrollo-nuevo.md`](desarrollo-nuevo.md) (owner, 2026-10-06, en el
selector interactivo de la orquestadora). El endurecimiento para producción se quedó acá, en su
sección de siempre, también por decisión del owner ese día.

## Cómo está ordenado (reordenado el 2026-08-15)

**Por lo que hace falta para poder tomar la entrada, no por de qué pasada salió.** El orden
anterior agrupaba por origen —cuál auditoría la encontró—, que sirve para entender el
contexto y **no sirve para elegir qué hacer ahora**: había que leer las 60 entradas para
saber cuáles se podían tomar sin preguntar nada.

| Sección | Qué hace falta para tomarla |
|---|---|
| 1. Mecánico | Nada: el arreglo ya está decidido y escrito en la entrada |
| 2. Medir primero | Abrir un archivo o correr algo. No es una pregunta para el owner |
| 3. Ya decidido, falta construir | Nada del owner: ya contestó. Es trabajo con diseño adentro |
| 4. Necesita que el owner conteste | Una respuesta, que está al frente de cada entrada |
| 5. Carreras de concurrencia | Un análisis de orden de locks, común a todas |
| 6. Proyectos que van solos | Spec propia. No entran de arrastre en otra tarea |
| 7. Acción del owner fuera del código | Algo que no se resuelve programando |
| Endurecimiento para producción | Nada hoy: se abre al encarar el paso a prod |
| Vigilancia | **No es trabajo.** Evaluado y descartado; se anota para no redescubrirlo |
| Contexto de las pasadas de auditoría | Nada: es memoria de qué se auditó y con qué resultado |

El contexto de origen no se perdió: el encabezado de cada pasada —con sus números, lo que
salió limpio y los hilos que cerró— vive al final del archivo.

---

## ⏸ En pausa: otros países hasta terminar Chile (owner, 2026-10-03)

**Decisión del owner, en sesión, al pedir la § 2:** no se toma nada de Argentina, Colombia ni
México hasta terminar Chile. No es un "no": es un orden. Las entradas que dependen de otro país
se quedan escritas y no se toman; cuando Chile esté terminado, se reabren desde acá.

Hoy son tres:

- La de abajo, que estaba en la § 2.
- **Los 6 decimales del Anexo 20** (México), en la § 3, bajo "Los tres que dejó el frente del
  redondeo por país".
- **El frente fiscal de Argentina, Colombia y México**, que es desarrollo nuevo y vive en
  [`desarrollo-nuevo.md`](desarrollo-nuevo.md).

- [ ] **El POS de un tenant AR/CO/MX no puede cobrar: su catálogo de tipos de documento llega
  vacío** (frontend + catálogo; **leído, no corrido**: anotado 2026-10-02 al cerrar el tipo por
  defecto = boleta, ver [`resueltos.md`](resueltos.md)). De AR/CO/MX el seed solo trae la nota de
  crédito interna, con `activo = false`, así que `GET /tipos-documento` les devuelve `[]`. La
  pantalla arranca sin tipo —igual que el servidor, que sin boleta deja la venta sin tipo—, pero
  `puedeCobrar` (`useVenta.ts`) devuelve `false` sin `tipoDocumentoId`: el botón Cobrar nunca se
  habilita. Salones no pasa por `puedeCobrar` y sí cierra. Esto no lo causó el arreglo de la boleta:
  antes, `[0]` de una lista vacía también daba `undefined`. **Medir:** reproducirlo con un tenant de
  uno de esos países (`POST /admin/tenants` con una provincia AR/CO/MX, caja abierta, un ítem en el
  carrito). **Si se confirma**, no se arregla de oficio: la pregunta para el owner es **si esos
  países se soportan hoy** (hoy se opera solo en Chile). Lo fiscal va solo (`CLAUDE.md`).
  **Lo que alcanzó a medirse antes de la pausa (2026-10-03):** por lectura, `puedeCobrar`
  (`frontend/app/composables/useVenta.ts`) devuelve `false` sin `tipoDocumentoId`. El
  `GET /tipos-documento` vacío del tenant nuevo **no se corrió**.

---

## 1. Mecánico — no hay nada que preguntar ni diseñar

## 2. Medir primero — no es una pregunta para el owner

Lo que va acá es lo que se resuelve abriendo un archivo, corriendo algo o mirando la base:
sale de esta sección hacia la 1 (si el arreglo resulta obvio) o hacia la 4 (si lo medido
destapa una decisión que no es mía).

- [ ] **Anular como cortesía una línea de varias unidades con precio cerca del techo da 500 en
  `cuenta_linea_anulaciones`** (backend, `SalonesService.escribirAnulacionEnLinea` con los baldes
  de `baldesDeCortesia` en `salones/cortesia-retiro.ts`; lo vio el domain-reviewer del frente
  `aa8d2d53` el 2026-10-09, **leído, no corrido**). Los baldes `monto_afecto`, `monto_exento` y
  `monto_impuestos` son `NUMERIC(18,4)` y se calculan como `carta = cantidad × precioUnitario`.
  Solo se llenan con motivo `cortesia` y un bien retirable, en `anularLinea` y
  `cancelarConMotivo`. Ese camino no tiene ningún `cabeEnColumnaDePlata`. Ejemplo: precio
  99.999.999.999.999 × 2 unidades ya enviadas, anuladas como cortesía, da un neto de
  199.999.999.999.998, que es `numeric field overflow` en el `INSERT`. Con 1 unidad cabe. **No lo
  introdujo `aa8d2d53`**, que solo cierra el alta de la línea: 5e13 × 3 ya lo disparaba antes.
  **Medir:** correr la ruta y confirmar el 500. **Arreglo probable:** el mismo guard sobre `carta`
  y los baldes antes del `INSERT`, con 400. Toca el cálculo de la cortesía, así que va como
  frente aparte.

- [ ] **Lo que dejó el frente del tope del esperado de caja (`ce3ab9d8`)** (backend, `caja` +
  `pagos`; 2026-10-09; lo vieron el autor y el domain-reviewer, **leído, no corrido** salvo donde
  se dice). Son cuatro residuos y ninguno traba una caja:
  1. **Oráculo sin rastro.** El 400 del tope deja averiguar el esperado en modo ciego por
     bisección. Solo los intentos que fallan salen gratis: cada acierto escribe una entrada real
     de un monto cercano al techo, que queda a la vista. La salida que no alcanza (422) deja rastro
     con `IntentoRechazadoError`, y este 400 no. Hay que decidir si lleva un motivo nuevo en el
     rastro.
  2. **Un `monto` suelto que no cabe en la columna**, de un movimiento o de un pago, ¿sigue dando
     500 en el `INSERT`? El guard mira la suma, no el monto solo. **Medir:** ¿el DTO ya lo rechaza
     con el 400 del redondeo de plata?
  3. **Salida manual enorme:** sin cobertura. Medir qué devuelve.
  4. **Texto.** Cuando el 400 sale de la reversa del pago a un proveedor
     (`compras.service.ts`, ~3329), el mensaje dice "cobrá con otro medio de pago", que ahí no tiene
     sentido. Además, `docs/features/gestion-cajas.md` nombra como consecuencia aceptada solo el
     caso de las ventas, no el de anular un pago a proveedor, que se destraba con una salida.

- [ ] **La tienda calcula el total dos veces, con dos "ahora": lo que cambia entre el pago y el callback deja un cargo sin venta** (backend; lo vio la revisión de seguridad del frente "reglas de línea salen del ítem", 2026-10-06; **leído en el código, no corrido**; las citas de línea son contra `54bc8f6e`). `POST /online/pagar` calcula el total con `calcular()` y ese número es el que se autoriza en Webpay. Cuando el comprador vuelve del formulario de Transbank, el callback (`online-callback.handler.ts`) crea la venta con `VentasService.crear`, que **vuelve a calcular desde cero** con el snapshot de la orden (solo `itemId`, `cantidad` y presentación) y el pago fijado en el total autorizado. Si los dos cálculos no dan lo mismo, la venta no se crea:
  - **total del callback mayor** → `ventas.service.ts:1019` *"Las ventas online requieren el pago completo"*;
  - **total del callback menor** → el pago sobra, y sin `permite_vuelto` en el método de tarjeta (el seed solo lo tiene en efectivo) `pagos.service.ts:270` da *"El pago supera el total pero ningún método de pago permite vuelto"*. Con `permite_vuelto`, la venta se guarda con vuelto sobre una tarjeta.
  - **Dónde sale cada "ahora".** Los dos pasan por `calcular()` sin `cuentaId` (la tienda lo pisa en `prepararLineasCheckout`), así que `instanteDeVigencia` devuelve `new Date()` (`calculo-precios.service.ts:566-567`) **en el momento de cada llamada**: uno al iniciar el pago, el otro al volver de Webpay, minutos después. Además del instante, los dos leen vivo el catálogo: precio del ítem, `valor_del_dia` de la moneda (`:260-262`, un ítem en USD), reglas y su pausa, promos.
  - **La escena.** Promo "Happy hour 20%" de 18:00 a 19:59 (`hora_inicio`/`hora_fin` de `promociones`). El comprador paga un carrito de $10.000 a las 19:59:30: Webpay autoriza $8.000. Tarda un minuto en el formulario y el callback corre a las 20:00:30 sin la promo: total $10.000 contra $8.000 pagados → 400 → **$8.000 cobrados y ninguna venta**. Lo mismo con una promo que empieza, una regla con `fechaFin` que vence a medianoche, un cambio de precio o de tasa del día mientras alguien paga.
  - **Qué cubre hoy "la orden reconciliable".** El dispatcher (`callback-dispatcher.service.ts:52-61`) atrapa el error y deja la orden en `pagada` sin `ventaId` (no `conciliada`), con un `logger.error`. El admin la ve en Ventas ▸ Órdenes (filtro por estado) y la puede **reembolsar** entera: "una orden sin venta se reembolsa sin corrección" (`pasarela-pagos.md`).
  - **Qué no cubre.** (1) **No hay forma de crear la venta después**: no existe un "reintentar el callback". `POST /pasarela/ordenes/:id/verificar` solo acepta `en_proceso`/`expirada` (`cobros.service.ts:1393`), y aunque existiera, recalcularía con un tercer "ahora". (2) **Nadie se entera**: no hay aviso al admin, solo el log. (3) **El comprador ve "Pago aprobado. Tu compra fue registrada correctamente."** (`tienda/retorno.vue:88-91`): `urlRetornoApp` (`pagos-redirect.service.ts:75-76`) manda `estado=pagada` igual con la orden sin venta, y la pantalla solo esconde el botón "Ver detalle de la venta".
  - **Lo que hay que decidir** (diseño aparte, no de arrastre): congelar en el snapshot de la orden lo que el checkout cobró (el total, o las líneas resueltas, como `reglasCongeladas` del salón) y que el callback lo respete, o calcular el callback con el instante del checkout. Y por separado, que una orden pagada sin venta avise y no le diga al comprador que su compra quedó registrada.

- [ ] **Medir la ventana de consulta de Webpay Plus con un pago de más de 7 días** (queda del
  cierre de "Probar en el sandbox de Transbank el saldo…", 2026-10-04, [`resueltos.md`](resueltos.md#el-saldo-con-el-que-se-aclara-un-reembolso-medido-en-el-sandbox-de-transbank-cerrada-2026-10-04)).
  La documentación de Webpay Plus dice que el estado se consulta hasta 7 días; la referencia, "en
  cualquier momento". Si vence, el aclarado de un reembolso sin confirmar más viejo cae al 409 y
  a la marca manual del admin ([ADR-029](../adr/029-reembolso-con-efecto-externo.md)), que no se
  rompe. **Desde el 2026-10-12**, repetir el `GET` del pago de integración de la medición (creado
  2026-10-04 18:23 UTC, anulado entero, `balance` 0):
  `RUN_TRANSBANK_SANDBOX=1 TBK_API_KEY_SECRET=<el de integración del seed> TBK_WEBPAY_MALL=597055555535 node scripts/qa/transbank-saldo-sandbox.mjs --reconsultar 01abe0ccb73419df9944e395fa2396743e230bb3eeb7f1cb003d1285f27209bf`.
  Si sigue contestando 200 con el detalle, la ventana no aplica a la consulta y el ADR se corrige;
  si no, el ADR ya lo dice.

- [ ] **La configuración de la pasarela puede quedar incompleta para su modo, y el cobro da 500** — ⬇️ **prioridad baja** (owner, 2026-10-08: la pasarela va después del resto de los arreglos)
  (backend, `pasarela/dto/create-tenant-pasarela.dto.ts` y `tenant-pasarela.service.ts`
  `crear`/`actualizar`; queda del cierre de "la configuración de la pasarela no se valida",
  2026-10-08, [`resueltos.md`](resueltos.md)). `ConfiguracionPasarelaDto` valida tipo y tope de cada
  clave, pero las tres son opcionales. **Medido ese día:** `configuracion: {}` en MALL da 200 y el
  cobro siguiente da **500** (Transbank: *"details[0].commerce_code is required!"*, que sale como
  `ProviderComunicacionError` sin mapear desde `PagosRedirectService.iniciar`). **Leído, no medido:**
  también pasan MALL sin `commerceCodeHijo`, INDIVIDUAL con una o dos de sus tres claves, y un
  `PATCH` que cambia `modoIntegracion` sin mandar credenciales nuevas, que deja guardada la config
  del otro modo (de MALL a INDIVIDUAL queda solo `commerceCodeHijo`). **Medir:** los tres casos por
  HTTP y qué contesta el cobro en cada uno. **Arreglo probable:** validar la completitud con el modo
  efectivo (`dto.modoIntegracion ?? tp.modoIntegracion`) en el service. MALL exige `commerceCodeHijo`
  e INDIVIDUAL las tres. Hay que decidir qué pasa al cambiar de modo sin credenciales: un 400, o
  limpiar la config. La pantalla ya exige las tres en INDIVIDUAL y el código hijo en MALL, pero solo
  cuando se tocó la credencial.

- [ ] **El `urlCallback` de un pago por API es un SSRF ciego desde el backend** — ⬇️ **prioridad baja** (owner, 2026-10-08: la pasarela va después del resto de los arreglos) (backend,
  `pasarela/dto/create-pago.dto.ts` (`urlCallback`, solo `@IsUrl({ require_tld: false })`) y
  `callback-dispatcher.service.ts` (el `fetch` del callback HTTP); visto el 2026-10-08 por el
  api-security-reviewer del frente "configuración de la pasarela", **leído, no medido**). Quien tenga
  una API key de un tenant crea un pago con `urlCallback` a `http://169.254.169.254/…`, a `localhost` o
  a un host interno del compose, y cuando la orden queda `pagada` el backend le hace un `POST
  {ordenId}`. En el ambiente `pruebas` se llega a `pagada` con las tarjetas de prueba de Transbank. Es
  ciego (el body es fijo y la respuesta no se refleja; solo el `res.ok` concilia la orden), pero el
  `fetch` no tiene timeout y sigue redirects. Las credenciales de la plataforma no viajan.
  **Medir:** con un receptor local y un pago aprobado con el proveedor falso, mandar `urlCallback` a
  `127.0.0.1`, ver si sale el POST, y ver qué pasa con un host que no contesta y con un 302.
  **Arreglo probable:** rechazar los rangos privados, loopback y link-local del host resuelto, más
  `redirect: 'manual'` y `AbortSignal.timeout`. Un callback a `localhost` en desarrollo es legítimo
  hoy: cómo distinguirlo es parte del diseño.

- [ ] **Cualquiera que conozca el código de una orden la puede marcar `fallida`** — ⬇️ **prioridad baja** (owner, 2026-10-08: la pasarela va después del resto de los arreglos) (backend,
  `pagos-redirect.service.ts`, `abortarRetorno` con solo `TBK_ORDEN_COMPRA`; visto el 2026-10-08 por el
  mismo revisor, **leído, no medido**). El retorno de timeout de Transbank trae solo
  `TBK_ORDEN_COMPRA`, y con eso la orden abierta pasa a `fallida`, sin prueba de que la mande
  Transbank. El código (`W` + timestamp + 32 bits aleatorios) lo ve el comprador. **Medir:** si un
  comprador que vuelve a pagar después de eso queda trabado, o si la verificación contra Transbank
  (`POST …/verificar`) la recupera. Si la recupera, va a Vigilancia.

- [ ] **`pasarela_orden.monto` es `NUMERIC(18,6)`: una orden de más de 10^12 no cabe** — ⬇️
  **prioridad baja** (owner, 2026-10-08: la pasarela va después del resto de los arreglos) (backend,
  `pasarela/entities/pasarela-orden.entity.ts`; visto el 2026-10-08 por el frente del guard del motor,
  **leído, no medido**). El guard de `calcular` deja pasar totales de hasta 10^14, que es el techo
  del libro de ventas; la orden de pasarela tiene dos decimales más y por eso dos enteros menos. Hoy
  no se alcanza en Chile —la tienda y la suscripción rechazan antes todo total sobre el umbral SII
  (`exigirCompraOnlineBajoUmbral`)—, pero un pago por API (`POST /pasarela/api/pagos`) lleva su
  propio monto, y lo que se le valida es el formato (DTO) y la escala (service), no el tamaño. **Medir:** si ese
  camino llega al `INSERT` con más de 10^12 y da 500.

## 3. Ya decidido, falta construir

El owner ya contestó lo que había que contestar. **No son mecánicas** —tienen diseño
adentro, y alguna quedó a medias a propósito— pero nadie está esperando una respuesta para
empezarlas.

Las features de producto que también se decidieron —la NC como documento, la UF como moneda
oficial, `cashRounding`, el conteo por denominación, el envío diario del resumen de descuadres,
la acumulación de descuentos y compras— y el renombre de `moneda.decimales` se mudaron a
[`desarrollo-nuevo.md`](desarrollo-nuevo.md) el 2026-10-06. Acá quedan las correcciones.


- [ ] **El token de Google viaja por la URL** — ⬇️ **prioridad muy baja, reconfirmada por el
  owner el 2026-08-22** (backend + frontend, auditoría RBAC/auth 2026-08-15; **dos lentes
  ciegas entre sí lo vieron**).
  ℹ️ **Perdió el 🚩 en esa misma reconfirmación, y conviene decir por qué**: la marca decía
  "severidad alta" y convivía con una prioridad que el owner ya había puesto en baja el
  2026-08-15 — se contradecían, y la que quedaba a la vista al leer la lista era la marca.
  Lo que la justificaba era la mitad que convertía el token en sesión renovable, **y esa está
  cerrada**. No se toca hasta habilitar Google.
  **Lo medido:** `auth.controller.ts` → `googleCallback` redirige a
  `/auth/callback?token=...` con el **access token en la query string**, a diferencia del resto
  del sistema que usa cookie `httpOnly` para el refresh. Queda en el historial del navegador y
  en los logs de acceso del hosting del frontend; `callback.vue` ni siquiera hace
  `replace: true`.
  **Lo que lo agrava, y es la mitad que una sola lente no vio:** con ese access token filtrado
  se puede llamar `POST /auth/switch-tenant`, que solo exige `JwtAuthGuard`, y la respuesta trae
  un `refresh_token` nuevo por `Set-Cookie` — legible por cualquier cliente HTTP, no solo por un
  navegador. Una filtración de 15 minutos se vuelve una sesión renovable.
  **Antes de decidir el arreglo hay que contestar algo previo: ¿el login con Google está
  habilitado en producción?** Si no lo está, esto baja de prioridad sin dejar de ser deuda.
  ✅ **Prioridad decidida (owner, 2026-08-15) y bajada otra vez el 2026-08-22: muy baja,
  porque el login con Google no está en uso.** No cambia que sea deuda —el token en la query
  string queda en historial y logs— pero sí cuándo se paga: **antes de habilitar Google**, no
  ahora. El disparador es habilitar Google, **no** el paso a producción: por eso la entrada
  sigue en esta sección y no en la de endurecimiento.
  **Lo que queda abierto acá es sólo el token en la query string**, con su prioridad baja: el
  redirect a `/auth/callback?token=…` sigue dejándolo en el historial del navegador y en los
  logs de acceso del frontend, y `callback.vue` sigue sin `replace: true`. Se paga **antes de
  habilitar Google**.
  ➕ **Y con él se paga otra cosa que el mismo día dejó a medias (2026-08-16):** al cortar la
  vinculación por coincidencia de correo, entrar con Google teniendo ya una cuenta local
  devuelve `409` y manda a usar la contraseña — **pero no existe ningún camino para vincular
  Google a esa cuenta después**. Es deliberado: hacerlo implícito en el login era el agujero,
  y la acción correcta —vincular desde adentro de la sesión, en el perfil— es una feature que
  nadie construyó. Hoy no molesta a nadie porque Google no está habilitado; el día que se
  habilite, sin esto la gente con cuenta local queda sin poder usar el botón nunca.

- [ ] **Re-tasar una línea ya pedida tiene que re-preciar, no re-validar** (backend, motor
  de cálculo — **frente propio, decidido por el owner el 2026-08-30**; los caminos
  que *sacan* algo se cerraron con guards —cuatro se sacaron el 2026-09-14, ya innecesarios— y la
  otra familia, medida el 2026-08-30, se cerró con el congelado del 2026-08-31)
  — la causa de fondo era una sola: `resolverPersonalizacionReceta` /
  `resolverPersonalizacionCombo` volvían a validar el snapshot congelado contra el catálogo
  de hoy, y si algo ya no cuadraba la cuenta entera respondía 400 al cerrar. Eso se cerró el
  2026-08-31 —el cierre usa la foto—. ⚠️ Esta entrada no se reescribió al cerrarse: varias notas
  de abajo describen como pendiente lo que ya se construyó. Lo abierto de verdad es el caso de la
  promo de un día y la pregunta de `useCalculoPrecios`.

  🔲 **Lo que queda abierto del frente es angosto, y más angosto de lo que se creyó.**

  **La escena del 2x1 de los martes NO es la grieta, y la corrección importa.** El día de la
  semana y la hora de una promo se evalúan **por línea**, contra el instante en que se pidió
  (`promociones.evaluator.ts`, `instanteEnVentana`: mira `fecha`, `diaIso` y `hora` del
  instante de la línea). O sea que la cerveza pedida el martes 00:30 **sí** recibe el 2x1 de
  los martes aunque la mesa se haya sentado el lunes — siempre que la promo esté cargada.
  
  **Lo que sí sale de `cuentas.abierta_el` es el filtro de PRECARGA**: `cargarVigentes` trae
  solo las promos cuyo **rango de fechas** contiene ese día (`fecha_inicio <= $2 <= fecha_fin`).
  Si el rango no cubre el día en que se abrió la cuenta, la promo no se carga y su ventana
  nunca se mira, por más que la línea caiga adentro.
  
  Queda entonces un caso, más angosto que el que el plan describía: **una promo cuyo rango de
  fechas empieza o termina entre la apertura de la cuenta y el pedido de la línea.** Una promo
  de un solo día es el ejemplo puro: mesa abierta el 30 a las 23:30, cerveza pedida el 31 a
  las 00:30, promo válida solo el 31 → no se carga. Al revés no hay problema: si se carga de
  más, `instanteEnVentana` la descarta por línea.
  
  ⚠️ **Leído en el código, no medido con una sonda.** Medirlo pide un fixture propio (promoción
  con rango de un día + cuenta de salón + control del reloj por SQL) que todavía no existe.
  Antes de arreglarlo, montarlo y confirmar que falla así.
  
  📌 **Y la primera versión de esta nota estaba mal**: decía que el 2x1 de los martes no se
  cargaba. La escribí leyendo `fechaLocal` y sin abrir el evaluador, que es donde el día de la
  semana sí se mira por línea. La corrección salió de ir a medirla.

  El arreglo, si se toma: `cargarVigentes` tiene que cargar las promos cuyo rango toque
  **cualquiera** de los días de las líneas de la cuenta, no solo el de la apertura. Es la
  misma regla del owner, así que no necesita preguntarle nada — pero es un caso de borde,
  no el agujero que el frente vino a cerrar.

  ✅ **DECIDIDO (owner, 2026-08-30), en dos respuestas que juntas definen el frente:**

  1. **Al cobrar manda lo que la mesa ya pidió, no la carta de hoy.** Re-tasar una línea
     de una cuenta abierta deja de **re-validar**: la personalización congelada es un
     hecho, no una entrada del cliente que haya que volver a aprobar. Eso cierra de una
     todas las filas de la tabla de arriba —las medidas y las que falten—, en vez de un
     guard por forma.
  2. **El precio es el de cuando pidió.** Mesa 4 pidió el extra de queso a $700; si el
     queso pasa a $1.200 mientras comen, esa mesa paga **$700**. El snapshot ya guarda
     `precioExtra` por extra y por opción de grupo (`PersonalizacionRecetaSnapshot`), así
     que la plata para tasar la línea **ya está congelada**: el resolver no necesita el
     catálogo vivo para nada de la personalización.

  📌 **Esto no reabre `1970ccbd`** (*"el precio de una línea lo calcula el servidor, no el
  cliente"*): el servidor sigue calculando y el cliente sigue sin poder mandar un precio.
  Lo que cambia es de dónde lee el servidor —de la foto que él mismo congeló, no de la
  carta de hoy—.

  ✅ **El precio del plato también está congelado, y ya está construido:**
  `cuenta_lineas.precio_unitario` guarda `precioBase + Σ precioExtra` al pedir la línea
  (`dd54f81d`, con la cita del owner del 2026-08-30 en el docblock de
  `cuenta-linea.entity.ts`). Esta nota decía que era la pregunta pendiente, y ya no lo era: la
  orquestadora se la volvió a hacer al owner el 2026-09-29 sin verificar, y contestó lo mismo que
  ya estaba hecho (*A: $5.000, el precio de cuando pidió*). Queda anotado para que no se
  pregunte una tercera vez.

  ⚠️ **Y va solo, con el sistema quieto** (`CLAUDE.md`, primer punto de "Detenerse y
  preguntar"): toca `resolverPersonalizacionReceta` / `resolverPersonalizacionCombo`, que
  son motor de cálculo.

  📌 **Esta nota decía que los cinco guards no se tiraban**, por el dato de operación que le
  daban al admin (el mensaje que nombra la mesa). El owner decidió lo contrario para las cuatro
  ediciones el 2026-09-14 ([`resueltos.md`](resueltos.md)); el del borrado del ítem sigue, con su
  porqué por medir en § 2.

  ⚠️ **Dos trampas medidas que el que tome esto se va a encontrar:**
  1. **La precuenta validaba menos que el cierre** (antes del 2026-08-31). `puedeCostar()`
     (`calculo-precios.service.ts`) saltea el resolver cuando la línea no tiene extras,
     grupos ni componentes, así que una línea con **solo** `omitidos` rotos mostraba precio
     normal en la precuenta y explotaba recién al cobrar. Hoy ninguno de los dos re-resuelve
     la línea de una cuenta, pero si algo vuelve a hacerlo, reproducir por la precuenta y
     concluir "no pasa nada" sigue siendo el error fácil.
  2. **No todo lo que rompe grita.** Si un componente de combo se queda sin **ningún**
     grupo asociado, `resolverPersonalizacionCombo` hace
     `if (!catalogo.asociados.length) continue` y la opción elegida **desaparecía del
     precio en silencio** (medido el 2026-08-30: 4500 → 4300). Desde el 2026-09-14 la
     desasociación es alcanzable por acción de catálogo —su guard se sacó—, pero no llega al
     cobro: el cierre usa la foto y no re-resuelve. Si algo vuelve a re-resolver, vuelve
     callado y en otro lugar: el precio ya está congelado, así que lo que se pierde es el
     stock que no se descuenta. El test 23 de `cuenta-precio-congelado.e2e-spec.ts` lo caza
     por el stock (ver su comentario).

  ⚠️ **El e2e de todo esto tiene una trampa conocida**: el fixture no puede usar grupos ni
  recetas del seed, porque sacarles una pieza los rompe para las demás suites. Los tests 20 a 23
  de `cuenta-precio-congelado.e2e-spec.ts` arman su propio catálogo — copiar de ahí.

  ✅ **Y aparte, decidido (owner, 2026-09-29):** `useCalculoPrecios` se traga el 400 a
  propósito y `lineaSubtotal` dibuja `—` en todas las líneas sin decir por qué. **La pantalla
  tiene que marcar la línea que falló.** Cómo se decidió: en el selector interactivo de la
  orquestadora eligió *A: que marque la línea que falló* (recomendada) por sobre *B: dejarlo
  como está*. Es chico e independiente del resto de esta entrada.

- [ ] **Dos `POST /suscripciones` iguales cobran dos veces: el alta no lleva `Idempotency-Key`**
  (backend + front, `suscripciones.service.ts` `crear`; anotado el 2026-10-09 por el frente del
  guard de reentrada de la pantalla; **medido el 2026-10-09** con
  `backend/test/suscripcion-alta-doble.e2e-spec.ts`, que sobrescribe `CobrosService`,
  `InscripcionesService` y `TenantPasarelaService`, sin Transbank). **Lo medido:** dos POST
  iguales y secuenciales, **con la misma `Idempotency-Key`**, dan dos 201, dos llamadas a `cobrar`
  ($35.700 cada una), dos ventas y dos suscripciones del mismo usuario al mismo ítem. Ninguna
  respuesta avisa que ya existía otra. Control: un POST solo da 1/1/1. El e2e afirma **el bug tal
  como está hoy** y se pone rojo cuando se arregle; ese día se invierte la afirmación.
  - **La escena.** Es la de ADR-026: el alta entra, la respuesta se corta, el cliente ve *"No se
    pudo activar la suscripción"* y vuelve a confirmar. **Leído, no medido:** hay una segunda
    escena que la clave de ADR-026 no cubre. Si Transbank no contesta, `cobrar` deja la orden
    `en_proceso` y devuelve 502. No se crea ninguna suscripción, pero el cobro pudo haber salido, y
    el reintento cobra otra vez.
  - **Por qué no es mecánico.** El cobro (paso 7) es HTTP y ocurre **antes** de la transacción
    de la venta (paso 9). **ADR-026 tal cual no sirve**, por dos razones (leído). Si se envuelve
    solo el paso 9, el reintento cobra en el paso 7 y recién después choca con la clave: reproduce
    la respuesta, pero el segundo cargo ya salió. Si se envuelve todo `crear`, la `pasarela_orden`
    se escribe con el repo inyectado, que usa la transacción activa (ADR-020). Así, un fallo
    después de que Transbank aprobó **revierte también la orden `pagada`**, y queda un cargo sin
    ningún rastro, peor que hoy.
  - **Gemelo, leído:** `POST /pasarela/api/cobros`, el cobro Oneclick de un integrador por llave de
    API, tampoco pide la clave. Es pasarela, de prioridad baja (owner, 2026-10-08), y va aparte.
  - ✅ **Decidido (owner, 2026-10-09, por AskUserQuestion de la orquestadora, en lenguaje de
    local y con el costo de cada opción):**
    1. **Se frena como el reembolso (ADR-029)**, por `ejecutarConEfectoExterno`. La clave se
       reclama y la orden se escribe y se commitea **antes** de cobrar. Si el reintento llega con
       el primero en curso, espera y responde *"ya estaba activa"*. Si el primero murió, se
       consulta en Transbank si el cargo salió. Si salió, se termina el alta sin cobrar de nuevo.
       Si no salió, se avisa *"no se cobró, podés intentar de nuevo"*. Si no se puede aclarar, va
       al portal. Cubre también el 502. **Costo de la opción elegida:** parte `cobrar` en
       preparar y efecto, la pantalla pasa a mandar la cabecera, el backend da 400 si falta, y hay
       ventana de deploy como en ADR-026.
    2. **Dos suscripciones de la misma persona al mismo ítem son legítimas** (dos cajas de vino al
       mes). Por eso el owner descartó la red de "una sola viva por persona e ítem". La otra
       opción, que no se eligió, era reclamar la clave antes de cobrar y responder 409 sin
       consultar a Transbank. Su costo era dejar frenada a la persona cuyo primer cobro no salió.
  - **Cuando se construya:** el e2e de la medición se pone rojo, y ese día se invierte su
    afirmación (un alta, un cobro). La construcción la lanza la orquestadora como un frente
    propio.
  - **Queda afuera, fiscal y en su propio frente:** el cargo que ya salió dos veces. Hoy solo
    vuelve con un reembolso de la orden desde Pasarela, y eso es una nota de crédito (ADR-010).

### Los tres que dejó el frente del redondeo por país (2026-09-03)

Los tres salen del frente que hizo que el redondeo del tenant tenga su default puesto por su
país y quede bloqueado donde la norma lo fija ([spec](../superpowers/specs/2026-09-03-redondeo-por-pais-design.md)).
Ninguno rompía nada hoy — los tres eran **alcanzables mañana con una edición del seeder**, que
es exactamente lo que ese frente acababa de hacer.

Los dos primeros ya están en [`resueltos.md`](resueltos.md). **Sigue abierto el tercero**, que es
fiscal y va solo:

- [ ] **Los 6 decimales del Anexo 20 no entran en las columnas.** ⏸ *En pausa hasta terminar Chile (ver arriba).* El tenant mexicano nace con
  `escalaCalculo: 4` porque toda columna de plata de `venta_detalles` es `NUMERIC(18,4)` y con
  `'documento'` las líneas se persisten **sin cuantizar**: con escala 6 el recorte lo
  terminaría decidiendo el cast de Postgres, fuera del modo de redondeo del tenant. El SAT
  habla de hasta **6** decimales por línea. El costo de la diferencia está medido —cada
  `redondear()` mete a lo sumo 5e-5 y una línea pasa por uno por paso de la fórmula, o sea
  ~1,5e-4 a 2,5e-4 por línea: medio centavo a las 20-35 líneas— así que solo movería un total
  en un empate exacto. **Es decisión del owner y es fiscal**: llevar el sistema a 6 decimales
  de verdad es cambiar la escala de todas las columnas de plata de `venta_detalles` — motor de
  cálculo + fiscal, frente propio (ADR-010).

### Qué lote o unidad sale de stock (owner, 2026-09-28)

### Anular un plato devuelve lo que se consumió al venderlo (owner, 2026-09-29)

- [ ] **Lo que se consume al anular un plato sale de lo que HOY dice el catálogo, no de lo que se
  pidió: un extra, una opción o un componente que ya no está se saltea sin movimiento, y el costo de
  la anulación queda bajo sin marca** (backend; heredado del frente *"Anular un plato ya enviado a
  cocina"*, [`2026-09-18-reporte-anulaciones-design.md`](../superpowers/specs/2026-09-18-reporte-anulaciones-design.md)
  § 4 y § 7). **Re-medido el 2026-09-28** (sub-agente Sonnet; la orquestadora verificó contra el
  código lo que la corrige): la versión anterior de esta entrada decía que llegar al hueco
  necesitaba dos pasos y era muy raro. **Es más fácil de alcanzar:**
  - **Un extra se borra en un paso.** `obtenerUsoItem` (`items.service.ts`, ~:2627) pone
    `receta_extras_permitidos` en **advertencias**, no en bloqueos: `DELETE /items/:id` del
    champiñón funciona directo, y `remove()` además da de baja sus filas de extras. Al anular, el
    extra congelado en la línea no encuentra su ingrediente y se saltea — con una advertencia en la
    respuesta HTTP que **no se guarda en ningún lado**.
  - **Una opción de grupo** necesita dos pasos (la opción sí bloquea el borrado: primero `PATCH
    /grupos-modificadores/:id` sin esa opción, después el `DELETE`), y se saltea **sin ninguna
    advertencia** (`venderOpcionesGrupos`).
  - **Receta o combo editados, sin borrar nada:** `receta_ingredientes` y `combo_componentes` se
    leen **en vivo** al anular (`obtenerIngredientesRecetaPorIds`, `venderComponentesCombo`). Si
    entre la venta y la anulación alguien edita la receta o el combo (`PATCH /items/:id`), la
    anulación consume la receta **nueva**, no la que se cocinó. Sin aviso.
  - **Vender y anular comparten el hueco** (mismo código; lo dice el docblock de
    `consumirLineaAnulada`). Pausar un ítem (en vez de borrarlo) **no** lo dispara: las consultas
    filtran solo `eliminado_el`.
  **Qué ve el usuario:** el reporte de anulaciones marca `sin_valorizar` solo si **ningún**
  movimiento tuvo costo; si una parte se movió y otra se salteó, la fila sale `valorizado` con la
  suma parcial — **más baja que la real y sin marca**, indistinguible de un plato barato
  (`anulaciones-reporte.service.ts`, `resolverCosto`). Mermas hereda el mismo sesgo.
  **La pregunta para el owner, en lenguaje de local** (escena real, medida): *un mesero pide un
  risotto con extra de champiñones; el encargado borra "champiñones" del catálogo; más tarde
  se anula ese risotto. Los champiñones no se descuentan del inventario, y el costo de esa
  anulación aparece completo cuando no lo es. Lo mismo si el que cambió fue la receta.*
  - **A — no bloquear, pero marcar el costo como incompleto** en el reporte y en mermas. Trabajo
    medio: la advertencia hoy es transitoria y hay que guardarla para que el reporte la lea.
    (Era la candidata de la orquestadora el 2026-09-20.)
  - **B — congelar al vender** lo que el plato consumió (la receta y los extras de ese momento) y
    anular contra eso: la anulación siempre devuelve lo que se pidió, aunque el catálogo haya
    cambiado. Más trabajo; arregla la causa en vez de marcarla.
  - **C — aceptarlo** y escribirlo en `docs/features/` como límite conocido. Cero trabajo; el
    número sigue saliendo bajo sin aviso.
  ✅ **DECIDIDO (owner, 2026-09-29): B, congelar al vender.** Cómo se decidió: en el selector
  interactivo de la orquestadora, con la escena del risotto, eligió *B* (recomendada) por sobre A
  y C. Al vender se guarda lo que el plato consumió (la receta, los extras y las opciones de ese
  momento), y anular devuelve eso aunque el catálogo haya cambiado. Es la misma idea que el
  precio congelado de la línea (`dd54f81d`). El motor de precios y lo fiscal no se tocan.
  Escribe en `movimientos_inventario`: va en su propio frente.

- [ ] **Un componente de combo con cantidad fraccionaria no valida su personalización** (backend +
  producto, `ComboComponenteInputDto.cantidad` y `items.service.ts`, el loop por unidad de la
  personalización del combo; medido por HTTP el 2026-10-08 por el frente de los DTOs sin cota). Hoy
  `cantidad: "0.5"` en un componente da 201. Al resolver la personalización, el loop
  `for (u = 1; u <= unidades; u++)` corre **0 veces**, así que un grupo obligatorio de ese componente
  nunca se exige y lo que elija el cliente no se valida. (`-1` y `0` ya dan 400 en el service.)
  **La pregunta para el owner:** ¿un componente de combo puede ser fraccionario (medio kilo de algo
  dentro de un combo)? Si puede, hay que decidir cómo se valida su personalización; si no, va un 400.

  ✅ **Contestado por el owner (2026-10-08, AskUserQuestion de la orquestadora): sí, un componente
  de combo puede ser fraccionario.** Lo que falta es el diseño de cómo se valida su personalización
  (por ejemplo, si un componente de 0,5 cuenta como 1 para exigir sus grupos obligatorios, y cómo se
  cobran sus extras). Eso es diseño, no mecánica: brainstorm → spec → plan. Si toca cómo se cobran los
  extras, toca el motor y va solo.

- [ ] **En una pasarela modo Mall, el código de comercio hijo lo escribe el propio local y nadie
  verifica que sea suyo** (producto + proceso de alta; anotado el 2026-10-08 al cerrar "la
  configuración de la pasarela no se valida", [`resueltos.md`](resueltos.md)). En Configuración ▸
  Pasarelas, el admin del local elige "Mall (comercio de la plataforma)" y tipea el "Código de
  comercio hijo". La plataforma lo guarda sin comprobar que Transbank se lo asignó a **ese** local.
  **La escena:** la Panadería Sur copia mal el código y pone el de la Cafetería Norte, otro local del
  mismo mall. Durante el fin de semana vende $500.000 por la tienda online: Transbank le cobra al
  comprador, pero la plata se liquida a la Cafetería Norte. La Panadería ve las ventas pagadas y no
  ve el dinero, y recuperarlo es un trámite entre los dos locales y la plataforma. Un reembolso
  desde la Panadería sale contra el comercio de la Cafetería. Lo mismo, a propósito, es un local
  que se lleva las ventas de otro.
  **La pregunta para el owner:** ¿quién pone el código hijo?
  1. **(Recomendada) Lo asigna la plataforma al dar de alta el local en el mall, y el local no lo
     puede escribir.** Costo: el alta de Webpay Mall pasa por la plataforma (superadmin), no es
     autoservicio.
  2. **Lo escribe el local, pero no cobra hasta que la plataforma lo aprueba.** Costo: un paso de
     aprobación y alguien que lo revise contra lo que dio Transbank.
  3. **Se deja como está**, confiando en el local. Costo: el error de la escena solo se nota cuando
     falta la plata.

  ✅ **Contestado por el owner (2026-10-08, AskUserQuestion de la orquestadora): opción 1, lo asigna la
  plataforma.** El superadmin lo carga al dar de alta el local en el mall, y el admin del local no lo
  puede escribir. Falta construirlo. Va con la prioridad baja que el owner le dio a la pasarela el
  mismo día.

## 4. Necesita que el owner conteste

Cada entrada lleva su pregunta concreta adentro y mientras no se conteste **no se empieza**:
elegir por cuenta propia una regla de negocio no documentada es justo lo que `CLAUDE.md`
prohíbe.

- [ ] **Un `REFUND` marcado "Sin nota de crédito" cuya venta ya está corregida entera por otras
  notas no tiene salida** (backend + producto; anotado el 2026-10-04 al cerrar "Generar nota",
  [`resueltos.md`](resueltos.md); **solo si aparece en uso real** — hoy no se construye, lo decidió
  la Sesión de esfuerzo máximo). Escena: una venta online de $100.000 pagada con dos tarjetas, un
  reembolso de $70.000 cuya nota falló, y después dos notas del POS "por el pago" que acreditan los
  $100.000. "Generar nota" da 400 *"La venta ya está corregida entera…"* cada vez y el `REFUND`
  sigue marcado para siempre. **La pregunta para el owner:** ¿se liga el `REFUND` a una de las
  notas que ya existen (¿cuál, si son dos?), o se descarta la marca con un motivo escrito? Ninguna
  de las dos existe hoy, y las dos tocan el vínculo `correccion_venta_id`, que se escribe una vez.

## 5. Carreras de concurrencia

- [ ] **Borrar y restaurar la misma mesa mientras viaja el guardado del plano la saca del plano
  estando viva, hasta recargar** (frontend, `pages/configuracion/salones.vue`,
  `sacarMesasNoEscritas`; **leída, no medida**: la vio la revisión independiente del frente que hizo
  que el plano saque la mesa que otra sesión borró, 2026-10-08,
  [`resueltos.md`](resueltos.md#el-plano-saca-la-mesa-que-otra-sesión-borró-en-vez-de-seguir-dibujándola-cerrada-2026-10-08)).
  El guardado sale con la mesa viva; antes de que vuelva, esta misma pantalla la borra y la restaura
  (con «Ver eliminados» prendido). Si el `UPDATE` del guardado corrió con la mesa borrada, no vuelve
  en la respuesta, y la pantalla la saca aunque en el servidor ya esté viva otra vez. Hacen falta dos
  acciones con modal durante la latencia de un `PATCH`. **Cierre posible:** serializar el guardado
  del plano con el borrado y la restauración de mesas (que esos dos esperen al guardado en vuelo), o
  no sacar las mesas que esta pantalla borró o restauró durante el vuelo, anotadas en un set de ids
  mientras el guardado viaja. Comparar el estado al enviar con el de la respuesta no alcanza: borrar y
  restaurar deja `eliminadoEl` en `null` en las dos puntas. Tampoco alcanza encolar los `PATCH` entre
  sí: la carrera es del guardado contra el borrado y la restauración.

---

## 6. Proyectos que van solos

No entran de arrastre dentro de otra tarea: o son un barrido masivo, o necesitan spec
propia antes de escribir código. Encararlas es brainstorm → spec → plan, nunca "un rato".

Los proyectos de funcionalidad nueva se mudaron a [`desarrollo-nuevo.md`](desarrollo-nuevo.md)
el 2026-10-06. Acá quedan los que corrigen algo que ya existe.

ℹ️ Si algún día se evalúa cambiar el ORM, el candidato es MikroORM (resuelve el contexto
transaccional nativo, con ALS — [ADR-020](../adr/020-contexto-transaccional-als.md));
Prisma y Drizzle tienen el mismo modelo manual de transacciones que TypeORM. No es un
pendiente de este trabajo, es la nota que ADR-020 deja para no repetir la evaluación.

- [ ] **El descuento global en % de una factura deja afuera de su base las líneas con `IndExe`
  3, 4 o 5** (garantía de depósito por envases, entre otras) — hallazgo de la lectura del XML del
  DTE (tarea 4, 2026-09-27), fuera de esa pieza porque decidir el tratamiento tributario de una
  línea es materia fiscal (⛔ ADR-010, primer punto de "Detenerse y preguntar" de `CLAUDE.md`).
  **Qué pasa hoy** (`descuentoDeFactura`,
  `frontend/app/composables/useDte.ts:254`): un `DscRcgGlobal` con `TpoValor '%'` calcula su base
  sumando el `MontoItem` de las líneas cuyo `IndExe` **calza exactamente** con el `IndExeDR` del
  descuento — ausente con ausente (afectas), `'1'` (exentas), `'2'` (no facturables). Una línea con
  `IndExe` `'3'` (garantía de envases), `'4'` o `'5'` **nunca entra en ninguna base**, porque
  ningún `IndExeDR` vale eso: no hay descuento (ausente, exentas o no facturables) que la sume.
  **Ejemplo con montos:** bebidas afectas por $50.000 + una línea de garantía de envases de
  $6.000 con `IndExe='3'`, y un descuento del 2% sin `IndExeDR` (afectas) → la base es **$50.000**
  (los envases quedan fuera) → **$1.000** de descuento, no $1.120 si el 2% también tomara los
  $6.000. **Cómo lo ve el encargado hoy:** el monto del descuento llega precargado en el
  formulario (ya con esa base acotada) y la línea de envases llega como una línea más del XML —
  por asociar a un producto o apartada con "No es mercadería" — sin que la pantalla explique por
  qué esa línea no pesó en el descuento. **Por qué va solo:** el estado fiscal por línea (qué es
  "exento", qué es "no facturable", qué es una garantía que no tributa) es un invariante del
  sistema — `CLAUDE.md` invariante 5, "exento es un estado fiscal explícito, nunca la ausencia de
  impuesto", que sale de [ADR-011](../adr/011-catalogo-impuestos-sistema.md) — y una decisión con
  implicancia tributaria que ADR-010 saca de cualquier tarea de arrastre: no se resuelve como
  efecto colateral de leer un XML.

---

## 7. Acción del owner fuera del código

No se resuelve programando. Está acá para que tenga quién la reclame.

- [ ] 🛒 **El smoke de compras, en el navegador del owner** — la pieza 1 salió el 2026-09-19
  con el gate entero en verde, pero **nadie la usó a mano todavía**, y eso sigue pendiente
  aunque desde el 2026-09-20 los cinco pasos corran solos en
  [`compras-por-pantalla.spec.ts`](../../frontend/e2e/compras/compras-por-pantalla.spec.ts)
  (qué cubre cada uno: [`features/compras.md`](../features/compras.md) § "El smoke,
  automatizado"). **Automatizar no cierra esta entrada**: Playwright asevera lo que alguien
  pensó en aseverar, y lo que falta acá es el ojo del owner sobre la pantalla real —que se
  entienda, que no haya nada raro al lado de lo que el test mira—. Se entra como
  `encargado.compras` (contraseña `admin`), no como admin, porque el rol es justamente lo que
  el gate no mira igual —ya pasó una vez que el encargado no podía cargar una compra y todas
  las suites pasaban—. Si algo salta, vuelve como entrada acá.

- [ ] 🧹 **La basura de Docker de los worktrees: el mecanismo está cerrado; lo que queda es de otro
  proyecto** (anotado 2026-09-20 al cerrar "un stack por worktree"). Lo que acumulaba ya está
  atendido: `entorno.sh borrar --purgar` saca las imágenes del proyecto, que `down -v` **no** borra
  (medido: 2,83 GB por stack — eran las que quedaron colgadas de `intelligent-taussig-880ae6`, un
  worktree que ya no existe), y `entorno.sh estado` las reporta mientras estén.

  ⚠️ **Lo que sigue apareciendo como recuperable NO es nuestro, y confundirlo es caro.** Al medirlo
  el 2026-09-20 quedaban ~55 GB de volúmenes sin usar, y **`webapp_dbdata` es 55,15 GB de eso**: un
  volumen con 0 links, creado el 2025-09-04, de **otro proyecto del owner** (`colegium`, MySQL).
  Un `docker volume prune` lo borra. O sea que el número grande que Docker ofrece recuperar es la
  base de otro proyecto, no basura de este: eso lo decide el owner sobre ese proyecto, y lo sano ahí
  es respaldo comprimido antes de borrar. **Este frente no lo toca.**

  📌 **Y no copiar un número de acá: medirlo.** Un conteo de basura envejece por definición, y éste
  ya envejeció dos veces el mismo día —141,2 GB ocupados al escribir la spec; ~70 GB después de una
  limpieza de la sesión orquestadora—. El del día sale de:

  ```bash
  docker system df                                  # el total, por tipo
  docker system df -v | sed -n '/VOLUME NAME/,$p'   # volumen por volumen, con LINKS y tamaño
  ```

  El segundo comando es el que importa: distingue **de quién** es cada volumen, que es justo lo que
  el total esconde. Y ojo con `docker builder prune`: es recuperable sin pérdida de datos, pero
  **la caché vacía encarece el primer `entorno.sh stack` de cada worktree** — medido, 40 s de build
  con caché caliente contra pagar el `npm ci` entero sin ella.

- [ ] 🚢 **Primer deploy con `Idempotency-Key` obligatoria: la ventana entre los dos servicios**
  (anotado 2026-09-19 al cerrar la idempotencia de cobros,
  [ADR-026](../adr/026-idempotencia-de-cobros.md); mudado acá desde la § 1 el 2026-09-20).
  **Estaba en "Mecánico" y no es código**: esa sección promete que el arreglo está escrito en la
  entrada, y acá no hay arreglo que escribir —la cabecera es obligatoria a propósito—. La regla
  ya vive en ADR-026 § Consequences; lo que falta es **que alguien ejecute el paso el día del
  deploy**, que es para lo que existe esta sección.

  Railway despliega **backend y frontend como servicios separados**
  (`railway deployment list --service backend`, ver la entrada del smoke post-deploy más
  abajo), así que entre los dos deploys hay un rato con el backend nuevo y el bundle viejo
  servido —o simplemente con una pestaña abierta de antes—. Ese bundle manda el cobro **sin
  la cabecera** y el backend lo rechaza con `400 "Falta la cabecera Idempotency-Key, o no es
  un UUID"`: el cajero no puede cobrar hasta recargar la pantalla. **El paso:** desplegar
  frontend y backend juntos y recargar las pantallas abiertas. Desde el 2026-10-03 la ventana
  también toca la **nota de crédito**: un modal abierto de antes emite sin la cabecera y recibe
  400 hasta recargar. Lo mismo vale para el alta de
  la tabla `solicitudes_idempotentes`, que hoy la crea `synchronize` al arrancar (ligado a la
  entrada CRÍTICA de migraciones, más abajo).

- [ ] 🇨🇱 **Validar con un abogado el ángulo legal chileno del testigo** — quedó huérfano al
  cerrar la entrada del cierre forzado (2026-08-13): la fuente es doctrina de la DT **leída
  por un agente**, no asesoría legal, y de ella salieron dos afirmaciones que el producto usa
  como justificación: (a) que la responsabilidad del cajero exige acceso exclusivo **y**
  oportunidad de estar presente en el conteo, así que contar sin él cae la imputación; (b)
  que sin asignación de pérdida de caja pactada **no se puede descontar** un faltante del
  sueldo (ORD. N°4229). `docs/DIFERENCIADORES.md` lo marca "sin validar por un abogado" y
  **no se puede comunicar el ángulo legal hasta que lo esté** — esta entrada existe para que
  esa validación tenga quién la reclame, ahora que la entrada que la contenía se archivó.
  ➕ **Una tercera afirmación para la misma consulta (2026-09-29):** descontarle al garzón, de su
  próxima liquidación de propinas, lo ya pagado de una venta anulada. El owner lo decidió así
  (§ 6, *"Saldo en contra cuando se anula una venta cuya propina YA se liquidó"*), y choca con
  la (b) de arriba.
  ➕ **Una cuarta (2026-09-29):** que un comercio que vende online sin informar que no acepta el
  retracto queda con 90 días en vez de 10 (Ley 19.496, según sernac.cl). El owner decidió que el
  local declare su política antes de vender online (§ 6, *"Devolución por medio de pago"*).

---

## Endurecimiento para producción (pre-lanzamiento — hoy no hay prod)

El proyecto está en desarrollo y no hay producción. ⚠️ **`main` sí despliega**: cada push
despliega el demo de Railway, sin esperar al CI (corregido el 2026-09-29; antes este párrafo
decía que `main` no se desplegaba). El flujo actual (push directo a `main`, CI que corre
**después** del push como detector y no como portón, sin ramas ni PRs por decisión de la
etapa de dev) **no es seguro para producción**. Hoy un CI rojo rompe solo el demo, que no
tiene datos reales: el 2026-09-29 un push con CI rojo llegó al demo, y un cambio de entidad lo
dejó en FAILED hasta resetear su base. Con producción, eso sería subir código roto y
enterarse tarde. Esta sección se abre al encarar el paso a producción. Orden = prioridad.

📌 **Cuándo se abre (owner, 2026-10-08, AskUserQuestion de la orquestadora):** cuando se cierren
los arreglos de las secciones 1 a 4. Los cuatro proyectos que esperan una sesión del owner (UF y
decimales, fechas y zonas horarias, serie y lote, moneda de los descuentos fijos y "sin
mezclar") se mudaron a [`desarrollo-nuevo.md`](desarrollo-nuevo.md) § 2 y no bloquean esta sección.

- [ ] **`synchronize: true` → migraciones (CRÍTICO, bloqueante de prod)** (backend) —
  hoy el esquema lo crea `synchronize` al bootstrap (dev + CI, porque `NODE_ENV != production`).
  En prod `synchronize` **puede dropear columnas y perder datos** al arrancar tras un cambio
  de entidad. Antes de cualquier deploy real: apagar `synchronize` en prod, adoptar
  migraciones TypeORM (generar desde el estado actual, versionar), y que el deploy corra
  `migration:run`. `startup-pos.sql` deja de ser solo referencia y pasa a ser el baseline
  de la primera migración. Es dinero y multi-tenant: sin esto un deploy puede corromper datos.
- [ ] **CI como portón de deploy + branch protection** (harness/infra) — hoy
  `.github/workflows/ci.yml` dispara `on: push: [main]` → corre DESPUÉS del push (detector),
  y `main` **no está protegida**. Para prod: (1) el job de deploy declara `needs: [gate]`
  (`if: success()`) → CI rojo = **no hay deploy**, prod queda en la última versión buena;
  (2) reactivar PRs + `required status checks` sobre `main` (revierte la regla de dev
  "trabajar directo sobre `main`") → el código roto ni toca la rama que despliega. Cierra el
  agujero del post-mortem del 2026-07-23 (push a `main` con e2e rojo).
- [ ] **Smoke post-deploy automático en el CI** (harness/infra, anotado 2026-08-11) — hoy
  `./scripts/smoke-produccion.sh` existe y funciona, pero **se corre a mano**, así que la
  única red que corre sola tras un push es el `healthcheckPath`, y ése prueba el arranque,
  no que el demo siga sirviendo. Es el escalón **barato y previo** al portón de arriba: no
  impide el deploy roto —Railway ya promovió—, pero avisa en minutos en vez de cuando
  alguien abre el demo.

  **Lo que lo hace no trivial es la carrera:** Railway despliega en paralelo al CI (la
  conexión vive en el dashboard, no en `.github/`), así que un job que pegue a producción
  apenas arranca mide el deployment **anterior** y da un verde que no corresponde al commit
  que se acaba de subir. El ancla que la mata está verificada: el JSON de
  `railway deployment list --service backend --json` trae `meta.commitHash`. El job tiene
  que **polear hasta que el deployment de `${{ github.sha }}` llegue a estado terminal** y
  recién ahí correr el script.

  **Forma:** job nuevo en `.github/workflows/ci.yml`, **sin `needs:`** —si el `gate` sale
  rojo pero Railway desplegó igual, es justo cuando más importa saber si prod quedó en
  pie—, con `timeout-minutes` holgado (el `healthcheckTimeout` del backend ya es de 300 s
  sobre una base fría). Instala el CLI, polea por SHA, corre `./scripts/smoke-produccion.sh`.

  ⛔ **Bloqueado por una acción del owner, no por trabajo de código:** hace falta un token
  de Railway en los secrets del repo. Verificado con `--help`: `railway deployment list`
  acepta `--project`/`--service`/`--environment`, así que **no** hace falta `railway link`
  en CI. **Sin verificar** —confirmarlo al implementar, no asumirlo—: con qué variable se
  autentica el CLI en un runner (token de proyecto vs. token de cuenta) y si un token de
  proyecto alcanza para leer `deployment list`.

  ⚠️ Y lo que este job **no** resuelve, para no venderlo de más: sigue siendo un detector
  post-hoc. El deployment roto ya reemplazó al bueno cuando el smoke se pone rojo; lo que
  evita que eso pase es el `healthcheckPath` (ya hecho) y, para el resto, el portón de
  arriba.
- [ ] 🚩 **Rate limiting — BLOQUEANTE PARA PRODUCCIÓN** (backend) — decisión del owner,
  2026-08-09: no se construye ahora, pero **no se sale a producción sin esto**. Hoy el
  proyecto **no tiene throttler de ningún tipo**; se anotó tres veces por separado y son el
  mismo trabajo, así que van juntas para decidir la infraestructura **una vez**.

  Los cinco, ordenados por lo que cuesta el abuso:

  1. **`POST /auth/recuperar`** — el peor, y el más nuevo (2026-08-09). Es público, sin
     auth, y **dispara un envío saliente a una dirección que elige quien llama**. `login`
     también es público pero no manda nada afuera. Con un loop, cualquiera bombardea una
     casilla ajena y quema la reputación del remitente —que con SMTP propio es la cuenta
     del owner—. La respuesta es idéntica exista o no el correo, así que no filtra cuentas:
     el problema es el **volumen**.
  2. **`POST /auth/login` y `/auth/refresh`** — brute-forceables sin límite de intentos.
  3. **`POST /garzones/verificar-pin`** — oráculo de PIN: dice si un PIN pertenece a **un
     garzón concreto**, sin ejecutar nada. El fix del selector (2026-08-08) lo abarató 20×:
     agotar 10⁶ contra un garzón concreto pasó de ~14 días de CPU a **~17 h**. Comprometer a
     *alguno* cuesta casi lo mismo que antes —no es una regresión— pero la cifra de "no es
     un vector práctico" archivada en [`resueltos.md`](resueltos.md) **ya no aplica al caso
     dirigido**. Decidir si `Salones:Operar` —que ya es un permiso de confianza— alcanza
     como barrera, o si hace falta límite por garzón.
  4. **`POST /auth/invitacion/:token` y `/auth/recuperar/:token`** — públicos por diseño.
     Adivinar un token de 256 bits no es un vector, pero sin límite son superficie gratis.
  5. **`pasarela/retorno/inscripcion` y `pasarela/retorno/pago`** (GET y POST cada uno:
     Webpay vuelve por uno u otro según el desenlace) — agregado el 2026-08-11 al revisar
     el healthcheck. Va último porque **el costo del abuso es de otra naturaleza**: no es
     adivinar una credencial —el token de un solo uso de Transbank no se adivina— sino
     **agotar el pool**. Son anónimos por diseño (la credencial es ese token, no un guard:
     `pasarela-retorno.controller.ts` no tiene `@UseGuards`) y cada request va a la base
     —`pagos-redirect.service.ts:152,255,279` hace `ordenRepo.findOne`, e
     `inscripciones.service.ts` inyecta `DataSource` y repositorios—. Con el pool de `pg` en
     su default (~10 conexiones, `app.module.ts` no lo sube) y sin throttler, un flood
     anónimo compite con el tráfico autenticado real.
     ⚠️ **Esta lista decía cuatro y estaba incompleta**: la revisión independiente del
     healthcheck lo encontró porque yo había afirmado que `/api/health` era la única ruta
     anónima que tocaba la base, y era falso. `/api/health` **no** entra en esta lista: se
     defiende solo, con ventana de 2 s + single-flight (`app.service.ts`). Estos dos son la
     misma forma sin esa defensa — y cuando se encare el throttler global, ese mecanismo
     casero se puede tirar.

  **Al encararlo:** `@nestjs/throttler`, límite global por IP + límites estrictos por
  endpoint. ⚠️ **La key no puede filtrar entre tenants** ni dejar que un tenant agote la
  cuota de otro. Y con varias instancias detrás de un load balancer el límite en memoria no
  sirve: hace falta store compartido (Redis) — que es dependencia nueva y necesita
  confirmación del owner.
  🚨 **«Límite por IP» dejó de significar «por usuario» — leer antes de escribir la key.**
  Desde ADR-022 (2026-08-23) el navegador no llega al backend: llega el **servidor del
  frontend**, que hace de proxy de `/api`. El par TCP que ve el backend es siempre el mismo,
  así que `req.ip` es **una sola IP para todos los usuarios**: un límite por IP se convierte
  en un balde compartido y el local que venda más rápido deja afuera a los demás. Es una
  falla que además se ve como «el rate limiting funciona» en cualquier prueba de un solo
  cliente.
  **Lo que hay que hacer al tomarla:** `app.set('trust proxy', …)` en el backend y derivar la
  key de `X-Forwarded-For`, **después de medir qué llega**. Lo que está verificado hoy es que
  el proxy reenvía las cabeceras entrantes tal cual —`x-forwarded-for` no está en la lista de
  ignoradas de h3, sí lo está `host`—; lo que **no** está medido es si el borde de Railway
  puebla esa cabecera en la entrada al frontend. Se mide con un request real antes de elegir
  la key, no se supone.
  📌 Y ojo con el cruce: una key mal derivada de una cabecera que el cliente puede escribir es
  peor que no tener límite, porque se saltea poniendo un valor distinto en cada request.
- [ ] **El proxy de `/api` cambió tres supuestos de producción** (infra + backend, anotado
  2026-08-23 al desplegar ADR-022) — no es trabajo pendiente por sí solo: es lo que hay que
  saber **antes** de tomar otras entradas de esta sección, porque cada punto muerde durante
  una tarea distinta.

  1. **El backend NO se puede cerrar a internet.** Es lo primero que uno piensa al ver un
     proxy delante, y es falso acá: el retorno de la pasarela entra **directo al backend** por
     `API_PUBLIC_URL` (`pasarela/services/pagos-redirect.service.ts:97` y el gemelo de
     inscripciones en `:66`) — Transbank redirige el navegador ahí, no pasa por el frontend.
     El callback de Google (`GOOGLE_CALLBACK_URL`) es igual. Hacerlo privado rompe los pagos,
     y se rompe en el retorno: con la plata ya cobrada del otro lado.
  2. **El servidor del frontend pasa a dimensionarse por tráfico de API, y es camino crítico.**
     Antes servía estáticos; ahora cada llamada de cada caja pasa por su event loop, que es un
     solo proceso Node. Dos consecuencias para la entrada de deploy/escala: hay que sizear ese
     servicio por requests de negocio y no por visitas, y **una caída del frontend deja la API
     inalcanzable para la app** aunque el backend esté sano — antes eran dos caídas
     independientes.
  3. **La red privada de Railway ahorraría el salto público, pero tiene un prerequisito.**
     Hoy el proxy sale a internet y vuelve a entrar (latencia + egress por request). Pasarlo a
     `*.railway.internal` exige antes que el backend escuche en IPv6: `main.ts:33` hace
     `app.listen(process.env.PORT ?? 3000)`, que bindea `0.0.0.0`, y la red privada de Railway
     es IPv6-only. Sin `listen(port, '::')` el cambio de URL falla y parece un problema de DNS.

  📌 Los dos que **hoy no aplican** y llegan con features previsibles están en las
  consecuencias de [ADR-022](../adr/022-navegador-un-solo-origen.md): el proxy bufferea el
  cuerpo entero en memoria (importa el día que haya subida de imágenes de producto) y no
  upgradea WebSockets (importa el día que haya comandas en vivo). Verificado el 2026-08-23:
  hoy no hay ni un `multipart` ni un gateway de WS en el backend.

- [ ] **Deploy seguro: rollback + feature flags + canary** (infra) — el portón de CI evita
  el error *conocido* (que los tests detectan), no el desconocido (bug que ningún test cubre y
  pasa en verde). Para acotar ese: rollback rápido a la versión anterior (deploy inmutable),
  canary/gradual (soltar al % del tráfico y mirar métricas antes del 100%), y feature flags
  para apagar una feature sin re-desplegar.
- [ ] **Secrets fuera del repo + rotación** (infra) — `JWT_SECRET`, `JWT_REFRESH_SECRET`,
  `PASARELA_ENCRYPTION_KEY` hoy salen de `.env`. En prod deben venir de un secret manager
  (no del repo, no de variables de entorno en texto plano en el CI), con rotación. Auditar que
  ningún secreto real quedó commiteado. La `PASARELA_ENCRYPTION_KEY` es especialmente sensible:
  cifra credenciales de pasarela de pago.
- [ ] **Cabeceras de seguridad + CORS whitelist + HTTPS** (backend) — `main.ts`: `helmet`,
  forzar HTTPS, y **CORS por whitelist env-driven**. Hoy `enableCors` permite un solo origen
  (`FRONTEND_URL ?? http://localhost:5173`, `credentials: true`); generalizar a lista blanca:
  `CORS_ORIGINS` (coma-separado) → `.split(',').map(trim).filter(Boolean)` → array a `origin`
  (el paquete `cors` lo refleja si está, rechaza si no). Con `credentials: true` **no** se puede
  usar `'*'`; la lista debe ser explícita. Documentar la var en `.env.example`. Prod define
  `CORS_ORIGINS=https://app.tudominio.com[,...]`; dev queda con el default localhost.
  **Nota de alcance:** CORS solo guarda al **navegador** (evita que la web de otro origen use la
  sesión/cookie del usuario contra la API); no frena curl/Postman/servidor-a-servidor. El control
  de acceso real es el JWT ya implementado — la whitelist es defensa en profundidad, no el candado.
  📌 **Desde ADR-022 (2026-08-23) CORS ya no está en el camino real de la app.** El navegador
  habla solo con el origen del frontend, que hace de proxy de `/api`; lo que sostiene la
  sesión es que la llamada es **same-origin**, no una cabecera. La whitelist sigue valiendo y
  sigue habiendo que hacerla, pero como defensa en profundidad para lo que pegue **directo** a
  la API (curl, un cliente móvil futuro) — no como lo que hace andar la pantalla.

  ⚠️ **Si al tomar esta entrada aparece la idea de revertir el proxy «ahora que CORS está
  bien»: tener CORS bien NO es la condición, y esto está medido.** El 2026-08-23 el demo
  respondía `access-control-allow-credentials: true` con el `allow-origin` correcto —CORS
  impecable— y el login **igual** no completaba. Lo que no viajaba era la **cookie**, y eso lo
  decide `SameSite`, no CORS. Son dos mecanismos distintos que se confunden por vecindad: CORS
  gobierna si el JS puede **leer la respuesta**; `SameSite` gobierna si la cookie **se manda**.
  Arreglar uno no toca al otro.

  **Lo que sí habilitaría revertir**, si alguna vez se quisiera: que frontend y backend
  compartan **dominio registrable** (`app.` y `api.` del mismo dominio propio), con lo que
  pasan a ser same-site y `Lax` alcanza; **o** pasar la cookie a `SameSite=None; Secure`, que
  roza la invariante 4 de `CLAUDE.md` y deja la sesión más expuesta.

  📌 **Y aun cumpliéndose, revertir es opcional y no se recomienda.** El proxy no molesta con
  dominio propio, y es lo que hace **imposible** que el bug vuelva el día que alguien despliegue
  en dos dominios distintos. Revertirlo exige devolverle al navegador una URL de backend
  configurable — justo la perilla que ADR-022 sacó a propósito, porque mientras exista el bug
  puede volver por configuración y nada avisa.
- [ ] **Observabilidad: logs estructurados + error tracking + alertas** (backend/infra) —
  logging estructurado que **no filtre PII ni `tenant_id` cruzado**, captura de errores
  (Sentry/equivalente), y alertas de error-rate/latencia para enterarse en minutos, no cuando
  se queja un cliente. Es la contraparte del "bug que pasó el CI verde".
- [ ] **Backups automáticos + restore probado (Postgres)** (infra) — datos financieros
  multi-tenant: backups automáticos + point-in-time recovery, y **restore probado** (un backup
  que nunca se restauró no es un backup). Tópico aparte del deploy de la app.
- [ ] **Graceful shutdown** (backend) — cierre ordenado de conexiones al recibir SIGTERM,
  para no cortar requests en vuelo durante un deploy. Verificado el 2026-08-11: `main.ts`
  no llama a `enableShutdownHooks()` y no hay ningún `onApplicationShutdown` en el proyecto.
  **La otra mitad de esta entrada ya está hecha** (`75b253d3`): el endpoint de readiness con
  chequeo real de BD es `GET /api/health` (`app.service.ts`), y es el `healthcheckPath` del
  backend en Railway. Queda solo el apagado.
- [ ] **Escaneo de dependencias en CI** (harness) — `npm audit` / Dependabot como paso del
  gate, para no arrastrar CVEs conocidos a prod.
- [ ] **Pre-push que corre el gate completo local (todas las suites)** (harness) — hoy
  `.githooks/pre-push` solo hace `codegraph sync` (no-bloqueante); el gate real corre en CI
  DESPUÉS del push (fue lo que dejó `main` en rojo el 2026-07-23). Mover ese gate a un pre-push
  BLOQUEANTE para atajarlo antes de subir. Diseño acordado:
  (1) **Gate determinista primero** (rápido, sin infra, cero falsos rojos): backend `lint:check`
  + `typecheck` + `test` (unit); frontend `test` (vitest) + `typecheck:ratchet` + `design:check`
  + `build`. Si algo falla, corta acá sin tocar Docker.
  (2) **e2e con DB fresca**: `./scripts/reset-db.sh` → `npm run test:e2e`. El script ya existe
  (jul-2026) y resuelve esta parte: borra el volumen, levanta y **espera el `Seed complete`** —
  no alcanza con esperar a Postgres healthy, porque el contenedor levanta antes de que el seed
  termine y una suite que arranca a mitad falla con errores que no son regresiones. La DB limpia
  es imprescindible: contra la DB de dev acumulada da **falsos rojos** por polución de seed
  ([[e2e-cumulative-stock-pollution]]) → entrena `--no-verify` y mata el hook. NO usar `--build`:
  el e2e levanta su Nest en el host y solo necesita Postgres fresco.
  (3) **Solo el bloque pesado (Docker + e2e) si el rango a pushear tocó `backend/`**; el gate
  determinista corre siempre. Evita 4 min de stack+e2e en un push de solo-docs.
  (4) Bloqueante; escape `git push --no-verify`. Es el enforcement de [[rigor-sobre-velocidad]].
  Complementa (no reemplaza) el CI, que sigue siendo la verdad con DB fresca de verdad.

---

## Vigilancia — evaluado y descartado, no es trabajo

- [ ] **El cajero ya no ve sus cajas cerradas, pero con sus pagos rearma lo que cobró en cada
  turno** (backend + producto; anotado el 2026-10-08 al cerrar "el historial de cajas es de
  supervisión", [`resueltos.md`](resueltos.md)). **Escena:** desde hoy Bruno, el cajero, abre
  "Mi caja" y ve solo su turno de hoy; los turnos de la semana pasada los ve el encargado. Pero en
  "Pagos" Bruno sigue viendo todos los cobros que hizo, con la caja de cada uno: si filtra por la
  caja del martes y suma, sabe que ese día cobró $412.000 en efectivo y $95.000 con tarjeta. Lo que
  **no** puede rearmar es la diferencia del cierre (le falta lo que contó): esa la vio una vez,
  al cerrar. **La pregunta para el owner:** ¿también se le esconden los cobros de turnos ya
  cerrados?
  - **Dejarlo así (recomendada):** Bruno sigue buscando una venta vieja para cobrar un saldo
    pendiente, reimprimir o hacer una nota de crédito, que es trabajo de todos los días. El costo:
    con paciencia, rearma lo que cobró en cada turno.
  - **Esconderle los cobros de cajas cerradas:** ya no puede sumar turnos viejos, pero tampoco
    encuentra la venta de ayer cuando el cliente vuelve a pagar el saldo o a devolver algo; eso
    tendría que hacerlo el encargado. Es lo mismo que hizo descartar el ocultamiento en agosto
    (§11.3 de la investigación de caja).

  ✅ **Contestado por el owner (2026-10-08, AskUserQuestion de la orquestadora): se deja así.**
  Primero pidió bloquearlo; al ver el costo (Bruno deja de encontrar la venta de ayer para cobrar un
  saldo, reimprimir o devolver) eligió dejarlo, la misma razón que en agosto. Queda en Vigilancia
  para que nadie lo vuelva a plantear como fuga.

- [ ] **El `400` *"Método de pago no pertenece al arqueo"* dice qué medios se usaron en el turno,
  y se deja así** (backend, caja; residuo 1 del frente del modo ciego, que se cerró el 2026-08-23 —
  [`resueltos.md`](resueltos.md) § *"El modo ciego deja de prometer lo que no sostiene"*—; pasado
  a Vigilancia el 2026-10-08 por la orquestadora).
  ❌ **Refutado: "es de un solo uso, cada sondeo exitoso cierra la caja".** Así lo decía la entrada
  desde agosto, y es falso. Medido por HTTP el 2026-10-08 —cajero `vendedor@paris.cl`, tenant en
  modo ciego, una venta con tarjeta débito en su caja—, `POST /caja/:id/conteo` **sin la línea de
  efectivo**:
  - con la tarjeta (usada) → 400 *"Falta el conteo de un medio de pago obligatorio"*;
  - con un medio no usado → 400 *"Método de pago no pertenece al arqueo"*;
  - con la tarjeta otra vez → lo mismo que la primera.

  La caja siguió `abierta` en los tres: el sondeo se repite cuantas veces se quiera. Pasa porque
  `CajaService.enviarConteo` mira "no pertenece" **antes** que las líneas obligatorias, y el
  efectivo siempre lo es. `dc5f3a72` (ids en minúsculas, una línea por medio) no cambió ese orden:
  tocó el DTO, no el service.
  **Por qué se deja igual:** entrega solo **presencia por medio**, nunca montos, y eso el cajero ya
  lo ve en sus propios pagos del turno (`GET /pagos`, eje mío/todos). No es una fuga nueva.
  **La salida, si algún día se quiere cerrar** (no se construye ahora): invertir el orden de los dos
  chequeos en `enviarConteo` —las obligatorias primero—, dos líneas. Sin la línea de efectivo,
  cualquier medio da el mismo 400 genérico, y con ella un medio usado cierra la caja: recién ahí
  sería de un solo uso.

- [ ] **Una promo con muchas aplicaciones iguales guarda una fila por aplicación, y se deja así**
  (motor de promociones + congelado; Sesión de esfuerzo máximo, 2026-10-06, al cerrar "una
  `cantidad` grande con promo", ver [`resueltos.md`](resueltos.md)). Un 2x1 sobre 99.999 unidades
  son 49.999 aplicaciones: 49.999 trazas en el motor y 49.999 filas de `ventas_promociones`, y la
  venta tarda 2,2 s para quien la cobra. Agregarlas en una aplicación con multiplicidad **no
  cambiaría la plata** (k × q(m) da el total de hoy), pero sí las filas, el ticket y el congelado.
  Sería un frente de motor y congelado. **Se abre solo si el tope de 99.999 resulta corto para
  algún negocio.**

- [ ] **Lo que lee el navegador de la API viaja sin comprimir, y hoy se deja así** (proxy de
  Nuxt + borde de Railway; medido el 2026-10-06, sacado de la § 2). La abrió el 2026-10-03 el
  cierre de la paginación de `GET /compras/productos`, que entera pesaba 691.257 B. En local ni
  Nest ni el proxy comprimen. **Railway comprime en el
  borde, pero no el camino del navegador:** directo al backend, `GET /api/docs-json` baja
  100.662 B sin `gzip` y 7.740 B con `gzip`. A través del proxy (`frontend-…/api/docs-json`, el
  camino que usa el navegador según ADR-022) baja **100.662 B pida lo que pida**, incluido el
  `Accept-Encoding` de un navegador. Los assets del frontend sí salen comprimidos (un chunk de
  `/_nuxt/` pasa de 429.272 B a 148.971 B), así que lo pesado de la app ya viaja comprimido.
  **Por qué no sirve comprimir en Nest:** `proxyRequest` de h3 no reenvía el `Accept-Encoding`
  del navegador (`ignoredHeaders`), y el `fetch` de Node que lo reemplaza con el suyo
  descomprime solo y h3 descarta el `Content-Encoding`. Medido además: con el pedido por defecto
  de ese `fetch`, el borde le entrega el backend **sin** comprimir. **Por qué el borde de afuera no
  comprime lo que sale del proxy: sin medir.** La respuesta del proxy lleva copiadas cabeceras del
  salto interno (`vary: Origin, accept-encoding`, dos `x-railway-request-id`, `x-hikari-trace`
  con dos saltos) y no lleva `content-length`. La última queda descartada: el `/` del frontend
  tampoco lo lleva y se comprime. Entre las otras no se puede elegir sin desplegar.
  **Por qué no duele hoy (seed, admin de Paris):** de los 105 `GET` sin parámetro de ruta del
  Swagger, el JSON más grande pesa 10.080 B (`/inventario/movimientos`, paginado). El más grande
  sin paginar pesa 8.315 B (`/roles/modulos-disponibles`, tamaño fijo) y en gzip, ~1 KB. El peor
  reporte es `GET /propinas/reportes/resumen`: con el rango máximo (366 días) pesa 25.681 B vacío,
  porque trae una serie por día, y 1.440 B en gzip. Lo que crece con los datos del tenant sin
  paginar es `/descuentos` y `/recargos`, a ~1 KB por fila, y `/terceros`, a ~500 B por fila.
  Medido con el seed solo, que no trae ventas: los listados de ventas, pagos y caja vienen
  paginados y vacíos. **Se reabre** cuando una respuesta del camino del navegador pase de ~100 KB
  (`/terceros` llega con ~200 terceros) o cuando un cliente se queje de una red lenta. **El
  lugar es el proxy** (`frontend/server/api/[...].ts`), sin dependencia nueva. Hay dos salidas.
  La primera es comprimir ahí con `node:zlib` según el `Accept-Encoding` del navegador; se
  verifica en local. La segunda es dejar de copiar las cabeceras del borde interno para que el
  borde de afuera comprima solo; es una hipótesis que solo se prueba desplegando. Antes de las
  dos, primero hay que paginar lo que crece.

  **Para medirlo de nuevo** (dos pasos). El primero son lecturas públicas, sin credenciales, y
  mide el borde: si los dos números se igualan, el camino del navegador ya se comprime.

  ```bash
  for u in https://backend-production-8635.up.railway.app https://frontend-production-c0db.up.railway.app; do
    curl -s -H 'Accept-Encoding: gzip, deflate, br, zstd' -o /dev/null -w "$u %{size_download}\n" "$u/api/docs-json"
  done
  ```

  El segundo mide los tamaños con el seed. Primero se levanta el backend del worktree
  (`./scripts/entorno.sh db`, `npm run build`, `.env` exportado, `PORT=3003 node dist/main`).
  Después corre este script, que recorre cada `GET` sin parámetro de ruta del Swagger con el
  admin de Paris e imprime el estado, los bytes enteros, los bytes en gzip y la ruta, de mayor a
  menor:

  ```bash
  node --input-type=module -e '
  import { gzipSync } from "node:zlib"
  const B = "http://localhost:3003", j = { "content-type": "application/json" }
  const l = await fetch(`${B}/api/auth/login`, { method: "POST", headers: j, body: JSON.stringify({ email: "admin@sistema.com", password: "admin" }) })
  const cookie = l.headers.getSetCookie().map(c => c.split(";")[0]).join("; ")
  const s = await fetch(`${B}/api/auth/switch-tenant`, { method: "POST", headers: { ...j, cookie, authorization: `Bearer ${(await l.json()).access_token}` }, body: JSON.stringify({ tenantId: "550e8400-e29b-41d4-a716-446655440007" }) })
  const auth = { authorization: `Bearer ${(await s.json()).access_token}` }
  const rutas = Object.entries((await (await fetch(`${B}/api/docs-json`)).json()).paths).filter(([p, o]) => o.get && !p.includes("{")).map(([p]) => p)
  const filas = []
  for (const p of rutas) { const r = await fetch(B + p, { headers: auth, redirect: "manual" }); const b = Buffer.from(await r.arrayBuffer()); filas.push([r.status, b.length, gzipSync(b).length, p]) }
  for (const f of filas.sort((a, b) => b[1] - a[1])) console.log(f.join("\t"))'
  ```

  Los cuatro reportes que piden rango dan 400 en esa lista. Se miden aparte con
  `?desde=2026-01-01&hasta=2026-12-31`.

- [ ] **`e2e/configuracion/items-moneda.spec.ts:103` salió flaky una vez en local y no se
  reprodujo en 32 corridas** (frontend, Playwright; visto el 2026-10-06 en el worktree del filtro de
  bajas del kardex, medido el mismo día por el frente de Playwright). En una corrida entera, *"cambiar
  la moneda frena y avisa…"* dio `locator.click: Test timeout of 30000ms exceeded` sobre la opción
  *"Dólar Estadounidense (USD)"*: resolvía, pero *"element is not stable"* y después *"detached from
  the DOM"*. **Medido sin un rojo:** 15/15 con `--repeat-each` solo; 10/10 con la CPU del navegador
  estrangulada 6× (CDP `setCPUThrottlingRate`); 7/7 dentro de Playwright entero (4 corridas enteras
  y una `--repeat-each 3`, base reseteada y 0 reinicios de contenedor). A 20× el spec sí falla, pero
  por lentitud general y en pasos distintos, sin esa firma: no cuenta como reproducción. **No es la
  misma causa que `anular-plato`**, como suponía la entrada: aquél no era un menú de reka sino un
  toast que tapaba el botón ([`resueltos.md`](resueltos.md)). **Si vuelve a pasar:** en local no se
  guarda traza (`retries` 0), así que correr con `--trace retain-on-failure` y mirar en la traza si
  la lista se cerró —el foco saltó a otro control o el drawer se re-renderizó— o si se re-montaron
  las opciones (`monedasOpts` se reemplaza entero cuando vuelve `cargarCatalogos`).

- [ ] **La salida de un lote elegido a mano busca el lote sin `tenant_id` en el SQL, y se deja
  así** (backend, `InventarioService.moverLote`, la rama con `loteId` explícito; lo marcó el frente
  "loteId de otro tenant", 2026-10-03, y lo leyó la orquestadora). La consulta filtra
  `lote_id + item_id + eliminado_el` y el tenant se compara **después**, en JS (*"El lote no
  pertenece al tenant"*). Esa rama es inalcanzable por la API: el ítem ya llega validado como del
  tenant, y un lote de ese ítem no puede ser de otro tenant desde que la entrada valida el
  `loteId` (`fb76972d`). Sumar `tenant_id` al `WHERE` no cambia ninguna respuesta. **Se reabre**
  si aparece un camino que llame a `moverLote` con un `itemId` que no pasó por la validación del
  tenant.

- [ ] **El arqueo de `caja/apertura-cierre.spec.ts:107` mostró `-$10.000` una vez: se sacó
  del backlog** (frontend, e2e de navegador; visto el 2026-09-29, medido el mismo día, **sacado
  por el owner el 2026-09-30** porque salió una sola vez). El test abre con `$10.000`, cuenta
  `$9.000` y espera `-$1.000` en la diferencia que calcula la pantalla (paso 5). Para ver
  `-$10.000`, lo contado tiene que valer 0: la lectura es que se perdió el primer `9` de
  `pressSequentially('9000')`. El candidato es el de `elegirEnSelector` (`e2e/support/ui.ts`):
  al cerrarse un popup de Reka el foco vuelve a su trigger y se come teclas. El ×10 del
  separador está descartado (daría `+$80.000`). **Medido sin un rojo:** 25/25 con
  `--repeat-each` tranquila, 25/25 con load 14–23, y 4 suites enteras en frío con 66/66; 54
  pasadas contra 1 rojo. **Si vuelve a pasar:** en local no se guarda traza (`retries` 0 y
  `trace: 'on-first-retry'`), así que correr con `--trace retain-on-failure` y leer el foco en
  cada tecla del paso 5. Si el foco estaba en otro lado, el arreglo es el de
  `elegirEnSelector`: esperar a que el menú desaparezca antes de `escribirMonto`. Ahí vuelve a
  la § 2.

- [ ] **Tres tests de pantalla cortaron por timeout de 20 s una vez: se sacó del backlog**
  (frontend; visto el 2026-09-28, medido el 2026-09-29, **sacado por el owner el 2026-09-30**
  porque salió una sola vez). En 2 de 10 corridas de vitest con otras sesiones levantando stacks
  de Docker, cortaron `compras-carga` (*"con todos los precios el descuento se habilita…"*),
  `items` (*"volver a elegir la moneda…"*) y `salones/index` (*"el tap sobre una línea que no
  estaba pendiente…"*). **La CPU está descartada:** cada test suelto, 10 vueltas con la máquina
  tranquila y 10 con load 14–23, pasó 60 de 60 con el peor en 1,7 s. **La memoria quedó sin
  medir:** forzar la presión de memoria lo bloquea el control de permisos, y el owner prefirió
  no insistir. **Si vuelve a pasar:** en el momento del rojo anotar `sysctl vm.swapusage`,
  `memory_pressure | tail -1` y `docker stats --no-stream`. Swap lleno = memoria, y la salida
  es el turno de suites pesadas; si no, es un cuelgue del test y se corre en loop con
  `--reporter=verbose`. Ahí vuelve a la § 2.

- [ ] **El filtro de tipo de `GET /compras/productos` es redundante con su `JOIN`, y se deja a
  propósito** (backend, medido el 2026-09-19 al cerrar la pieza 1 de compras) — sacar
  `i.tipo = ANY($2::text[])` de la consulta (`ComprasService.productos`) **no rompe ningún
  test**, y el motivo no es un hueco de cobertura: el `JOIN item_producto` ya deja afuera
  todo lo demás. Quien escribe esa fila es `ItemsService.create`, **dentro de un
  `if (dto.tipo === 'producto' || dto.tipo === 'ingrediente')`**
  (`items.service.ts`), que son exactamente los dos tipos que el filtro nombra. O sea
  que hoy el filtro no puede cambiar ninguna fila del resultado.
  **Por qué se deja igual:** es el espejo de `validarLineas`, que valida contra la misma
  constante `TIPOS_CON_STOCK` (`ComprasService.validarLineas`). Si mañana un tercer tipo llegara a
  tener `item_producto`, la lista que se ofrece y la validación que acepta siguen diciendo lo
  mismo; sin el filtro, la pantalla ofrecería algo que el backend después rechaza. **No es un
  test que falte:** matarlo pediría un tipo con `item_producto` que hoy no se puede crear por
  ninguna ruta. Se anota para no redescubrirlo como "mutante vivo" en la próxima pasada.

- [ ] **Las suites del e2e se pisaban entre sí por el estado del seed: no reprodujo en 150
  corridas completas** (backend/tests; anotado 2026-08-22, **medido y pasado a vigilancia el
  2026-09-18**) — ⚠️ la primera versión se llamaba *"el `401` fantasma"* y mandó a buscar en `auth`
  durante horas: el `401` era un síntoma. El problema es que las suites comparten usuarios, ítems y
  cajas del seed, y una que deja estado a medias rompe a otra lejos de la causa.
  **Lo que se vio, intermitente y en suites distintas cada corrida:** `401` con token recién
  emitido (`costeo-cpp`, `reglas-valor`), en `register` —público, sin rama que tire 401—
  (`alta-usuarios-tenant`), en `login` con credenciales del seed (`papelera`) y tras un `verificar`
  en 200 (`rbac-y-contrasena`); `409` al abrir caja (`costeo-cpp`); y `costoActual: undefined` en
  `inventario`, que no es 401 y muestra que la familia es más ancha.
  **Lo medido:** con `app.close()` en un `finally` y el `400` de la fase 2 de cierre ya no tratado
  como error (los dos en [`resueltos.md`](resueltos.md)) pasó de 3 rojas en 5 a 1 en 10. Después,
  **0 rojas en 150 corridas completas con `reset-db.sh` por vuelta**: 140 de la caza del timeout
  del pool (2026-08-27 y 2026-09-13, todas `e2e=0`) y 10 sobre `main` `31697b0c` el 2026-09-18
  (922 tests por vuelta). `docs/agent/caza-timeout-pool.sh` frena ante **cualquier** e2e rojo, no
  solo el timeout, así que sirve para esto tal cual.
  **No se explicó el mecanismo** —`JwtStrategy` es *stateless*, y con sondas en `validateUser` y en
  el `JwtAuthGuard` no se atrapó ninguno—: dejó de reproducirse, que no es lo mismo que resuelto.
  **Descartado con evidencia, para no rehacerlo:** re-siembra (`--verificar` tras una corrida roja:
  un solo `Seed complete`); estado corrupto de los usuarios del seed; vencimiento o firma del JWT
  (`JWT_EXPIRATION=15m`, ningún spec toca `process.env`); throttler (no hay); y el
  `DeprecationWarning` de `pg` (~45 por corrida), que sale del `Promise.all` de TypeORM en
  `DataSource.synchronize`, uno por app de test.
  **Lo que sigue igual y es el riesgo de fondo:** las suites comparten los usuarios del seed con
  `maxWorkers: 1` como única red —
  `grep -rl 'admin.paris@paris.cl' backend/test --include='*.e2e-spec.ts' | wc -l`—. Un spec nuevo
  que deje estado a medias sobre ellos puede destapar esto de nuevo. Cómo evitarlo quedó como
  convención en [`patterns/backend.md` § 7](../patterns/backend.md#e2e-de-api-el-estado-que-es-único-por-definición-el-spec-se-lo-crea-2026-09-18).
  **Qué lo reabre:** un rojo intermitente en una suite que el diff no toca. Antes de buscar en el
  módulo que falló, `./scripts/reset-db.sh --verificar` y el loop de arriba.

- [ ] **Un `400` en un campo precargado si un tenant terminara con una oficial de menos
  decimales: sin puerta de entrada** (frontend + backend; anotado 2026-09-08 al cerrar el ×10,
  **medido y pasado a vigilancia el 2026-09-18**) — es la que quedaba de *"Tres formas en que la
  pantalla puede quedarse con plata que la moneda no expresa"* (las otras dos, en
  [`resueltos.md`](resueltos.md)). Misma causa que aquellas: el campo muestra lo que puede y el
  modelo conserva lo que le llegó. Aplicaría a la familia `MoneyInput oficial` contra un
  `@EsMontoCobrado()`, no a los seis campos de `items.vue` (`@EsCosto()`, escala 4).
  **Por qué hoy no es alcanzable — las tres puertas, leídas en el service y no en el DTO:**
  - `PATCH /monedas/:monedaId` (`UpdateTenantMonedaDto`) solo acepta `habilitada` y `valorDelDia`.
  - El país sale de la provincia, y los dos caminos que la cambian —`PATCH /tenants/me`
    (`updateMine`) y el `PATCH /tenants/:id` del superadmin— pasan por
    `TenantsService.assertMismoPais`, que rechaza una provincia de otro país.
  - `catalog` no tiene ninguna ruta de escritura: `moneda.decimales` y `pais.moneda_oficial_id`
    solo los escribe el seeder.
  **Qué lo reabre:** cualquier camino nuevo que cambie `moneda.decimales`, `pais.moneda_oficial_id`
  o el país de un tenant (aflojar `assertMismoPais`, un ABM de monedas o países en `/admin`).
  📌 No confundirlo con el round-trip del crudo (`'50000.0000'`): **no** da 400, porque el pipe
  compara con `decimalPlaces()` de Decimal, que normaliza los ceros a la derecha.

- [ ] **El `timeout exceeded when trying to connect` intermitente del e2e local: no reprodujo en
  140 corridas con la sonda puesta** (backend/tests; **pasado a vigilancia por el owner el
  2026-09-13**; el historial entero, con lo medido y lo descartado, está en
  [`resueltos.md`](resueltos.md)) — cayó dos veces, el 2026-08-25 y el 2026-08-27, con la misma
  firma: un pedido de `pg-pool` encolado al que le crearon un cliente y cuyo `connect()` no volvió
  en 5 s, con el pool casi vacío. Quedaron tres explicaciones sin distinguir —el event loop trabado
  hasta justo antes del vencimiento, el TCP hacia el puerto publicado de Docker, o el arranque del
  backend de Postgres— y después **140 corridas completas sin reproducir** (20 el 2026-08-27 y 120
  el 2026-09-13).
  **Lo que queda puesto, para que la próxima caída se pueda leer:** `backend/test/setup-pool.ts`
  corre en todo e2e y escribe `backend/test/tmp-pool.jsonl` (local y gitignoreado); el control
  `backend/test/control-sonda-pool.e2e-spec.ts` (solo con `CONTROL_SONDA=1`); y el loop
  `docs/agent/caza-timeout-pool.sh`.
  **Qué lo reabre:** un `timeout exceeded when trying to connect` en cualquier corrida.
  ⚠️ **No resetear antes de mirar**: `reset-db.sh` hace `down -v` y se lleva el contenedor y su log.
  ⚠️ **La mitad de servidor ya no está puesta**: `log_connections` se sacó del `docker-compose.yml`
  el 2026-09-13 porque metía ruido en el log. Para partir Docker de Postgres en una caída nueva hay
  que volver a ponerlo (`command: postgres -c log_connections=on` en el servicio `postgres`) y
  esperar la siguiente.
  ⛔ **No subir el `connectTimeoutMillis`** (ADR-020): taparía el síntoma y debilitaría la defensa
  que hace fallar ruidoso a un pool agotado.

- [ ] **El alta tiene que revivir una cuenta soft-borrada — inerte hasta que exista la baja
  de usuarios** (backend + BD, decisión del owner 2026-08-11; **reescrita el 2026-08-22 al
  medirla, porque la mitad de lo que decía ya no era cierto**) —
  ⚠️ **Lo que esta entrada afirmaba y HOY ES FALSO:** decía que un correo de usuario
  soft-borrado *"hace explotar el alta con un 500"* en `tenants.service.ts` → `crearUsuario`.
  **Ese camino ya traduce el `23505`** desde el 2026-08-11 (`:861-877`): devuelve **409**, no
  500, y su comentario nombra las dos causas posibles. No hay nada que arreglar ahí.
  ✅ **El segundo llamador, que era el que seguía vivo, se arregló el 2026-08-22:**
  `auth.service.ts` → `register` no capturaba su `23505` y salía un 500 — alcanzable **sin
  ninguna baja de usuario**, por una carrera entre dos registros del mismo correo libre. Y ahí
  dolía porque ese endpoint responde siempre lo mismo para no ser un enumerador de cuentas: el
  500 volvía a distinguir un correo tomado de uno libre. Ver `resueltos.md`.
  **Lo que queda pendiente, y sigue sin poder construirse:** la decisión del owner
  (2026-08-11) es que **el alta REVIVA la cuenta, avisando** —la persona vuelve con su
  historial, y el alta declara los roles de nuevo, sin heredarlos en silencio—, y que la
  unique de `usuarios.correo` pase a ser **parcial**. Sigue **inalcanzable**: verificado otra
  vez el 2026-08-22, **nada en `backend/src` soft-borra un `Usuario`** (`removeMember` solo da
  de baja la membresía). Construirlo hoy sería infraestructura para un estado que no existe.
  ➕ **Dos huecos menores que aparecieron al medir, anotados y NO arreglados** (ninguno vale
  un frente propio, los dos son de la misma carrera):
  1. El 409 de `crearUsuario` dice *"Ese correo ya es miembro de este tenant"*, que es cierto
     cuando la carrera es dentro del mismo tenant y **falso** cuando dos tenants distintos dan
     de alta el mismo correo nuevo a la vez. Distinguirlo exige mirar el nombre de la
     constraint, que en TypeORM es un hash (`UQ_1a7a36f3…`) y cambia con el esquema.
  2. `usuarios` tiene **dos** uniques —`correo` y `nombre_usuario`— y `RegisterDto` acepta las
     dos. Una carrera por `nombre_usuario` **sigue dando 500**: es el statu quo, no una
     regresión, y el arreglo del 2026-08-22 la deja pasar a propósito en vez de tragársela
     (tragarla le diría "revisá tu correo" a alguien que no quedó registrado).
  3. **La rama perdedora de la carrera responde más rápido que las otras tres**, porque se
     saltea `invalidarAnteriores` + `emitir` + `mail.enviar` (lo levantó la revisión
     independiente del 2026-08-22, sin bloquear). Es un canal de **tiempo** en un endpoint
     cuyo sentido es responder siempre lo mismo. ⚠️ Antes de tomarlo, tener presente el
     alcance real: **solo lo puede observar quien induce la carrera él mismo**, con dos
     requests concurrentes al mismo correo — no es un oráculo de una consulta suelta, que es
     la amenaza que el endpoint dice cerrar. Cerrarlo sería igualar el trabajo de las cuatro
     ramas, y eso cuesta más de lo que parece: implica hacer trabajo inútil a propósito.
  ➕ **Movida desde la § 3 el 2026-08-24**, pero no por una pregunta de negocio: **no se puede
  construir**. Verificado dos veces (2026-08-22 y hoy) que nada en `backend/src` soft-borra un
  `Usuario`, así que revivir cuentas es infraestructura para un estado inalcanzable. **Lo que el
  owner tiene que contestar es si la baja de usuarios entra al roadmap** — hasta entonces esta
  entrada no tiene disparador. Los tres huecos menores de adentro sí son reales y siguen abiertos.
  ✅ **CONTESTADO (owner, 2026-08-25): la baja de usuarios NO entra al roadmap por ahora.** Queda
  **inerte a propósito**: sacar la membresía ya resuelve el caso real del local —que la persona
  deje de entrar—, y el día que la baja haga falta se construyen las dos juntas, la baja y el
  revivir-avisando. La decisión del 2026-08-11 **se conserva**: no hay que rediscutirla, hay que
  esperarla.
  ⛔ **Lo que esto NO habilita:** construir el revivir por su cuenta. Sigue siendo infraestructura
  para un estado inalcanzable, y ahora además está dicho que se queda así.
  ➡️ **Movida acá desde la § 4 el 2026-08-25**, al contestarse: no espera diseño ni respuesta,
  espera un disparador que el owner decidió no crear todavía. Vive en Vigilancia para que nadie la
  redescubra como hueco nuevo — el hueco es real, y la decisión de no taparlo también.

- [ ] **En modo `cantidad` nada compara el saldo contra la suma del kardex, y no hay forma de
  saber si alguna vez divergieron** (backend, auditoría `inventario` 2026-08-15) — la invariante
  del proyecto dice que `movimientos_inventario` es la fuente de verdad y `item_producto.stock`
  un saldo materializado. En modo `serie`/`lote` eso se autocorrige: `recalcularStockSerie/Lote`
  (`inventario.service.ts:640-675`) recalcula el saldo desde `item_unidad`/`item_lote` en cada
  movimiento. En modo `cantidad` —el default— solo hay un `UPDATE` incremental, y no existe
  función ni endpoint que sume el kardex y lo compare.
  ⚠️ **Severidad baja a propósito, y el reencuadre importa**: la lente lo reportó como alta, pero
  **no hay ninguna divergencia medida**. El chokepoint (`registrarMovimiento`) se verificó sólido
  por dos lentes independientes: todo camino de producción pasa por ahí y escribe movimiento y
  saldo en la misma transacción. El escenario que ofrecía era un bug futuro hipotético, que no
  es un escenario reproducible.
  **Por eso está acá y no en 1:** lo primero es una query que compare las dos cosas sobre la base
  de dev y diga si el drift existe. Si da cero, esto es defensa en profundidad y puede quedar
  anotado; si da distinto de cero, cambia de sección y de prioridad. Construir un reconciliador
  antes de esa medición es construir sin evidencia.

  ✅ **MEDIDO el 2026-08-16: el drift es CERO, por tres caminos independientes.** Sobre la base de
  dev **después de una suite e2e completa** —o sea con tráfico de escritura de todos los caminos
  de producción—, 87 productos en modo `cantidad` y 175 movimientos:

  | Medición | Resultado |
  |---|---|
  | `SUM(stock_resultante - stock_anterior)` vs `item_producto.stock` | 0 ítems con drift |
  | `stock_resultante` del último movimiento vs el saldo | 0 ítems con drift |
  | Cortes de cadena (`stock_anterior` de N ≠ `stock_resultante` de N-1) | 0 |

  ⚠️ **La primera pasada dio 28 falsos positivos** y vale anotarlo: sumaba `cantidad` sin signo.
  Las `salida` se guardan **positivas** (`tipo` es la que lleva el signo), y las `ajuste` guardan
  `cantidad = 0` con el delta en `stock_anterior`/`stock_resultante`. Cualquier consulta futura
  sobre el kardex tiene que sumar el **delta**, nunca `cantidad`.

  ➡️ **Por su propio criterio, esto NO escala**: queda como defensa en profundidad anotada. Que
  el drift no exista hoy no dice que un bug futuro no lo produzca — dice que **construir un
  reconciliador ahora sería construir sin evidencia**, que es justo lo que la entrada quería
  evitar. Si alguna vez se quiere igual, es una decisión nueva del owner y no un arreglo.

  ➡️ **Mudada acá desde la § 2 el 2026-08-24**: la medición ya está hecha y su propio
  criterio dice que no escala. Vivía en «medir primero» sin nada que medir.

- [ ] **Pausar un tipo de regla: la ruta se descartó, y con ella sus dos huecos**
  (backend, medido 2026-08-23) — apareció como salida para esconder los cinco tipos que no
  hacen lo que prometen; **el owner la descartó: se desarrollan, no se pausan**. Queda acá lo
  medido, para que quien lo re-descubra no lo vuelva a investigar ni lo tome como bug vivo.
  **Por qué no es trabajo hoy:** no existe forma de pausar un tipo. `tipos-regla.controller.ts`
  es **solo `GET`** —catálogo global read-only, sin `PATCH` ni pantalla de admin— y los doce
  tipos del seed están en `activo: true`. Para que exista un tipo pausado hay que escribir SQL
  a mano, así que ninguno de los dos huecos de abajo es alcanzable.
  **Los dos huecos, por si la ruta vuelve:**
  1. **El `activo` de `tipos_regla` no se hace valer.** `TiposReglaService.findAll` lo filtra
     —el tipo desaparece del selector— pero `validarTipoRegla`, en `descuentos.service.ts`
     **y** en `recargos.service.ts`, no lo mira: un `POST` directo con ese id crea la regla
     igual. Enforcement de una línea por service, ⚠️ **con el cuidado de exigirlo solo cuando
     el tipo CAMBIA**: la pantalla reenvía `tipoReglaId` en todo PATCH (mismo `body` que el
     alta), así que exigirlo por venir el campo dejaría las reglas existentes de un tipo
     pausado imposibles de editar, renombrar o despausar. Verificado el 2026-08-23.
  2. **El seed no repone `activo` sobre una base ya sembrada** (`if (!exists) save`). ⛔ Y una
     trampa medida: reponer también el `nombre` en ese UPDATE **tumba el arranque del backend**
     si otra regla viva del tenant tomó el nombre viejo (choca con `uq_..._tenant_nombre_vivo`
     dentro de `onApplicationBootstrap`). Si se toca, solo `activo`.
  📌 **Y la funcionalidad no está terminada por ningún lado:** medido el 2026-08-23, pausar un
  tipo a mano deja la columna "Tipo" en blanco en la tabla y el drawer de edición **sin ningún
  campo**, porque su `config` sale del selector, que filtra los pausados. O sea que «pausar un
  tipo» no es una línea de enforcement: es una feature con backend, pantalla y decisión de
  producto. Si alguna vez se quiere, la salida sería **marcar** el tipo pausado, no filtrarlo.

**Nada de esta sección hay que hacer.** Son cosas que se miraron y se decidió no arreglar,
hallazgos refutados, y ramas de test que se descartaron con su motivo. Viven acá para no
volver a descubrirlas desde cero, y **no cuentan** cuando se mide el tamaño del backlog.
La que tiene condición de reapertura la dice adentro.

- [ ] **Un refresh token robado y replayado dentro de los 30 s de la rotación obtiene la
  sesión sin disparar la detección de reuso** (backend, `auth.service.ts` →
  `resolverCanjePerdido`, 2026-08-16) — **es el residuo inherente a la ventana de gracia, no
  un descuido.** Adentro de esa ventana el sistema no puede distinguir al atacante del
  perdedor legítimo de una carrera: son el mismo hecho visto a la misma distancia temporal.
  Y el ping-pong se puede sostener —si el atacante rota, la víctima cae en la gracia y recibe
  la del atacante, y así— sin que la detección corte nunca.
  **Por qué se acepta:** la alternativa es no tener gracia, y eso deslogueaba de todos sus
  dispositivos a cualquiera con dos pestañas abiertas o un reintento de red. Se eligió el
  residuo chico sobre el daño rutinario, con el owner decidiéndolo (ver `resueltos.md`).
  No se acumula solo: el `usado_el` de la fila es fijo, no deslizante, así que la ventana no
  se extiende sola. Verificado que pasados los 30 s la detección sí corta todo.
  🔓 **Condición de reapertura:** si algún día hay datos productivos y el modelo de amenaza
  sube, la salida conocida es acortar la ventana o mover la detección a familias de tokens.
  Hoy sería complejidad sin beneficio.

- [ ] **El país del tenant se deriva con el mismo JOIN en 12 queries** (backend, ocho
  módulos: `impuestos`, `monedas` ×2, `metodos-pago` ×2, `ventas`, `items` ×2, `propinas`
  ×2, `seeder`, `turnos`) — todas hacen `tenants.provincia_id → provincia.pais_id`. **Idea del owner
  (2026-07-30):** una columna `tenants.pais_id` para buscarlo directo. **Evaluada y
  descartada por ahora**, con dos hechos medidos: (a) `provinciaId` es **mutable**
  (`update-my-tenant.dto.ts:21`), así que la columna copiada se desincroniza en cuanto
  alguien cambie de provincia y olvide actualizarla — y desincroniza justo el país que
  determina el IVA, que es el trade que la spec del IVA derivado rechaza explícitamente;
  (b) **los once JOIN filtran `eliminado_el` de `provincia`**, o sea que el boilerplate es
  correcto: molesta a la vista, no está produciendo bugs. Se reabre si aparece evidencia
  de que duele (una query caliente, o un módulo nuevo que olvide el filtro); el cierre sin
  divergencia sería una **vista `tenant_pais`**, no una columna.
  **2026-08-07: llegó la doceava** (`sesiones-garzon.service.ts` → `zonaHoraria`, para el
  filtro de fecha del historial). Se duplicó a conciencia —es la segunda copia de ese
  helper, y la convención acepta duplicar dos veces— **con** el filtro `eliminado_el`, que
  es la condición de reapertura que esta entrada anota. Si aparece una tercera copia del
  helper de zona, ahí sí conviene la vista.

- [ ] **`addMember` devuelve roles viejos en silencio, y la asimetría con el alta es
  deliberada** (backend, `tenants.service.ts` → `addMember`) — `removeMember` da de baja la
  membresía pero **deja vivas** las filas de `roles_usuarios`, así que sacar a alguien para
  revocarle el acceso y volver a sumarlo desde la tabla le devuelve sus permisos previos,
  `Administrador` incluido. **`POST /tenants/usuarios` ya no hace esto**: ahí el admin
  declara un conjunto de roles y lo que no viene se da de baja. En `addMember` no hay roles
  en el body, así que no hay conjunto declarado y "restaurar lo que había" es una lectura
  defendible — por eso se dejó como está y no se unificó. Se anota para que quien toque
  `addMember` mañana sepa que la diferencia es una decisión y no un olvido; si algún día
  recibe roles, tiene que dar de baja los que no vengan igual que el alta.

- [ ] **`Cajas:Actualizar` es un permiso grueso para lo que ahora habilita** — lo levantó la
  revisión independiente de la task 6b (2026-08-13). El mismo permiso gobierna el **CRUD de
  cajones** (`cajones.controller.ts`), **pedir la firma** y, desde la 6b, **forzar el cierre de
  la caja de otro cajero**. O sea: a alguien a quien se le dio el permiso para renombrar un
  cajón, se le dio también congelar el arqueo ajeno. El owner eligió a conciencia el permiso
  existente por sobre uno nuevo (menos permisos que configurar), así que **esto no es un bug**:
  queda anotado para cuando el catálogo de permisos se revise en conjunto, no como pendiente
  suelto de caja.
  ⚠️ Efecto colateral medido y sin documentar: al sacar `@RequiresPermiso` de las dos rutas de
  escritura, el chequeo pasó a correr **después** de los pipes. Un usuario sin ningún permiso y
  con body inválido recibía 403 y ahora recibe **400**. No filtra nada (el DTO está en Swagger),
  pero es un cambio de contrato.

- ℹ️ **`mermas.controller.ts` sigue aplicando `@Body(EscalaMonedaPipe)` sobre un
  `CreateMermaDto` que ya no tiene ningún campo `@EsCosto()`** (backend, residuo del
  frente `merma-sin-costo-tipeado`, 2026-08-28) — `CreateMermaDto` perdió su único
  candidato (`costoUnitario`) al sacarle el campo de costo al formulario de merma (regla 3
  de la spec del costo sin tipear, ver la entrada de la regla 6 más arriba en § 3). El pipe
  solo dispara su consulta de escala cuando el DTO tiene algún campo marcado con
  `@EsCosto()`/`@EsMontoCobrado`: sin ninguno, es un no-op. **Verificado 2026-08-28: es
  inocuo, no rompe nada y no hace nada.** No se tocó a propósito —es cambio de código y el
  frente que lo dejó así era de documentación—; se anota para que quien lo redescubra no lo
  lea como bug nuevo. Se limpia solo, sin urgencia, la próxima vez que alguien toque ese
  controller.

### Detector de desborde de layout (`e2e/layout/desborde.spec.ts`, 2026-07-29)

- [ ] **El detector solo ve el mecanismo min-content dentro de un contexto flex/grid**
  (frontend, `e2e/layout/desborde.spec.ts`) — sube desde un bloque truncado hasta su ítem
  flex/grid ancestro más cercano; fuera de ese contexto el mismo mecanismo (min-content =
  ancho completo del texto cuando hay `white-space: nowrap`) puede desbordar igual y el
  detector no lo ve:
  - Celda de `<table>` con `table-layout: auto`, `inline-block`, `float`,
    `position: absolute`, `width: fit-content` — todos dimensionan por min-content igual
    que un ítem flex, así que un truncado adentro desborda por el mismo mecanismo y el
    detector devuelve `[]`.
  - `white-space: nowrap` **sin** `overflow: hidden` (p. ej. solo `whitespace-nowrap`) es
    el caso **peor** — mismo min-content de texto completo y encima sin recorte visual —
    pero el criterio exige `overflow-x: hidden`, así que lo descarta. No es regresión (el
    detector anterior, por clase `.truncate`, tampoco lo veía), pero matiza la afirmación
    del comentario del spec de que se detecta "el efecto" de `truncate`: en rigor exige
    `nowrap` **y** `hidden` a la vez, no cualquiera de los dos solo.
  - `overflow: clip` (Tailwind `overflow-clip`) computa `overflowX: 'clip'`, no
    `'hidden'`, y tampoco pasa el filtro.
  **Medido el 2026-07-30 (el spike que esta entrada pedía, resuelto):** el tema resuelto de
  `UTable` (`.nuxt/ui/table.ts`, sin override en `app.config.ts` ni `:ui` en
  `CrudTable.vue`) da los **tres** casos ciegos a la vez, así que el detector no ve **nada**
  adentro de ninguna tabla del proyecto:
  - `base` (el `<table>`) es `min-w-full overflow-clip` → **sin `table-fixed`, o sea
    `table-layout: auto`**, y encima `overflow-clip` computa `'clip'`, no `'hidden'`.
  - `td` es `whitespace-nowrap` **sin** `overflow: hidden` → el caso peor del criterio.
  - No hay contexto flex/grid: el ancestro es el `<table>`.
  **Pero el arquetipo resultó ser el lugar equivocado para buscar**, que es el hallazgo útil:
  el slot `root` es `relative overflow-auto`, así que una tabla ancha **scrollea dentro de su
  propio contenedor** en vez de empujar la página — exactamente lo que el desborde sería. Lo
  que sí puede desbordar es contenido dentro de una celda que a su vez esté en un contexto
  flex, y **eso el detector ya lo ve**. Conclusión: la cobertura perdida en `/inventario` es
  menor de lo que esta entrada suponía; ampliar el detector a `table-layout: auto` no es la
  prioridad, y si se retoma conviene apuntar a los otros mecanismos de la lista
  (`inline-block`, `float`, `absolute`, `fit-content`), no a las tablas.

### Ramas de test que se decidió no cubrir (pasada `caja` + `propinas`)

Lo que **no** entró, con el motivo, para no volver a evaluarlo de cero:

- 🚫 **`gruposConfig.length === 0`** — se intentó y resultó **inalcanzable por la API**: el
  PUT de distribución exige que los grupos activos sumen 100%, así que no se puede dejar al
  tenant sin ninguno. Montarlo pediría SQL directo, o sea un test de un escenario que en
  producción no existe. Lo que sí quedó cubierto es la puerta de entrada. La guarda del
  servicio es defensa en profundidad, no código muerto.
- ⏸️ **El backstop 23505 de `abrir()`** — es una carrera. Reproducirla exige montar el estado
  por SQL; mismo criterio que arriba.
- ⏸️ **`registrarMovimientoEnTransaccion`** — se ejercita indirectamente en cada venta que
  mueve stock; cubrirlo aparte agrega poco.
- ⏸️ **`advertenciasSesionesAbiertas` con `fin_el = null`**, **`aplicarCambioParticipante`**
  (alta manual), **`actualizar` con `recalcular: false`**, los endpoints HTTP
  **`confirmar`/`anular`** y la guarda de **moneda oficial ausente** — riesgo menor y ninguno
  toca plata sin pasar antes por algo ya cubierto. Entran si aparece un caso real.

### Refutados de la pasada `turnos` + `salones` + `garzones` (2026-08-06)

- **Fuerza bruta del PIN de garzón** — refutada por aritmética medida, no por un guard: 14
  días de CPU saturada para agotar el espacio. Lo que sobrevive es la amplificación de
  carga, que es otro bug y está arriba.
- **Deadlock en `fusionarCuentas`** — refutado: un solo `SELECT … FOR UPDATE` lockea en
  orden de plan, igual para las dos transacciones. Queda como "seguro gratis" en Baja.
- **Colisión de PIN al restaurar de la papelera** — hallazgo propio del refutador que
  resultó **ya documentado** como riesgo aceptado en [`resueltos.md`](resueltos.md), con
  la misma cifra de 1 en 10⁶ y la misma razón para no arreglarlo (`restaurar()` no puede
  comparar un bcrypt sin el valor en claro). La carrera TOCTOU de dos altas concurrentes
  que reportó una lente es la misma puerta con otra llave, y es aún menos probable.
- **Transferir una cuenta a otra mesa** — el brief le pidió a una lente probar esa
  transición; no existe. `transferir*` solo reasigna el garzón responsable, y mover cuentas
  entre mesas está explícitamente fuera de alcance en `docs/features/salones-mesas.md`.
  La lente lo reportó como corrección del brief en vez de forzar un hallazgo.

---

## Contexto de las pasadas de auditoría

De qué pasada salió cada hallazgo, con sus números, lo que salió limpio y los hilos que
cerró. **Es memoria, no trabajo.** Estaba intercalado con las entradas, y era la mitad de
la razón por la que el archivo no se podía leer de arriba a abajo para elegir qué tomar.
El mapa de qué se auditó y qué falta vive en
[`auditoria-codigo.md`](auditoria-codigo.md).

### Papelera — restaurar eliminados (2026-07-31)

Backend completo en los 16 recursos; doc operativa [`docs/features/papelera.md`](../features/papelera.md).

✅ **La decisión del owner "solo lo que borró una persona" quedó implementada entera el
2026-08-01.** Los dos agujeros —el `OR` sin parentizar del listado de `impuestos` y el
`eliminado_por` que `restaurar()` no limpiaba— están cerrados, con el e2e de la regla
corriendo sobre los **16** recursos en vez de sobre 2. Se levanta el ⛔ que impedía
cablear la pantalla de impuestos. Detalle y mutantes: [`resueltos.md`](resueltos.md).

Y un hallazgo que la feature dejó medido y no es suyo (el otro, el del esquema partido
entre `TIMESTAMPTZ` y `TIMESTAMP` sin zona, se cerró el 2026-08-06 — ver
[`resueltos.md`](resueltos.md)): **la plomería de tramos en `recargos`**, que desde el
reordenamiento del 2026-08-15 vive en la sección 3 (el owner ya decidió construirla).

### Auditoría `ventas` + `pagos` (2026-07-27) — hallazgos confirmados

Pasada de 7 lentes según `docs/agent/auditoria-codigo.md`: 20 hallazgos crudos → 15
confirmados tras refutación. El detalle de cada fix está en
[`resueltos.md`](resueltos.md). De esta pasada quedaban **3 entradas abiertas** (contadas,
no estimadas) cuando el archivo se ordenaba por origen; desde el reordenamiento del
2026-08-15 viven donde les toca por lo que hace falta para tomarlas — el N+1 de recetas en
la 🔴, la devolución por medio de pago en la 6.

ℹ️ Los números de arriba **no cuadran** con la suma de entradas y no se fuerzan para que
cuadren: `resueltos.md` acumula 18 cerradas de esta pasada contra "15 confirmados", porque
varias se cerraron en mitades (una cerrada, una diferida como entrada nueva) y algunas
decisiones de owner entraron después de la pasada. La lista de entradas es la fuente de
verdad; el conteo del encabezado describe la auditoría original.

#### Decidido por el owner tras investigación de mercado (2026-07-27)

Cuatro decisiones de owner sobre reglas de negocio no documentadas; tres ya se
implementaron ([`resueltos.md`](resueltos.md)). Método, cruce contra el código y fuentes:
**`docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`**. Lo que queda es
**trabajo pendiente con la forma ya definida**, no una pregunta abierta.

### Auditoría `caja` + `propinas` (2026-07-27) — hallazgos confirmados

Pasada de 8 lentes según [`auditoria-codigo.md`](auditoria-codigo.md): 25 hallazgos crudos →
22 únicos (3 los vieron dos lentes por separado) → **20 sobreviven** tras refutación.
**Los 20 se cerraron el 2026-07-27**; el detalle de cada fix, con sus mutantes, está en
[`resueltos.md`](resueltos.md). Lo que esos cierres dejaron abierto —la mitad de la
reconciliación de propinas que exige spec propia, un hallazgo que trajo la revisión
independiente— se repartió por sección el 2026-08-15; acá quedan las ramas que ningún test
toca, que son contexto de la pasada y no trabajo tomable.

#### Huecos de test

**De la feature de pausa (2026-08-03)**, los dos que habían quedado abiertos a conciencia
—cobrar una cuenta de salón con un ítem pausado después de cargarlo, y que una regla pausada
no quede congelada en `ventas_descuentos`— **se cerraron el 2026-08-09**; ver
[`resueltos.md`](resueltos.md). Lo que sigue abierto de esa feature está repartido desde el
2026-08-15: los specs que faltan en tres pantallas, en la sección 1. (El tope de 100 de los
selectores ya no vive acá: se cerró con el catálogo paginado, ver [`resueltos.md`](resueltos.md).)

**Ramas sin cobertura alguna.** La lista se triageó el 2026-08-09 y se cubrieron **cuatro
ramas nuevas**: el spillover de propina entre pagos, el aislamiento multi-tenant **de
lectura** de caja, la capa SQL de `propina-reportes` y `HORAS_TRABAJADAS`; más el rechazo de
`peso <= 0`. Se escribieron además dos tests de guardas (`fechaHasta <= fechaDesde` y Σ de
porcentajes) que **no** agregan cobertura de rama: los mataban tests unitarios preexistentes.
Detalle, mutantes y lo que quedó sin fijar en [`resueltos.md`](resueltos.md).

✅ Lo que la tanda dejó abierto y antes no estaba anotado —el scoping por tenant del camino
de **escritura** de caja, que ningún test fijaba— **se cerró el 2026-08-26** con un test de
compuerta ([`resueltos.md`](resueltos.md)). Y confirmó lo que decía esta nota: empezaba por
medir. El `expect` que faltaba no era sobre el 403 —ése no cambia con o sin el filtro— sino
sobre el **lock**.

### Auditoría `items` + `calculo-precios` (2026-07-28) — hallazgos confirmados

Pasada de 8 lentes según [`auditoria-codigo.md`](auditoria-codigo.md): 21 hallazgos crudos
→ **21 sobreviven, ninguno se cayó entero**. El trabajo del refutador fue el documentado:
**6 bajaron de severidad**, 2 se reclasificaron como decisión de owner, y tres afirmaciones
perdieron la mitad que no aguantaba (ver cada entrada). Se suma 1 hallazgo del refutador
que ninguna lente vio.

**Lo que salió limpio, que es lo que la pasada vino a producir:** soft delete **0 hallazgos
sobre 98 queries** revisadas una por una (cruzadas contra `startup-pos.sql` para no reportar
filtro faltante donde la tabla no tiene la columna); **multi-tenant limpio en los 63 JOIN** y
en cada id que llega del cliente; y la suite de `items.service.spec.ts` (4.136 líneas) resultó
inusualmente rigurosa — trae la derivación aritmética comentada, así que mata mutantes.

#### Alta

Los tres hallazgos de severidad alta se cerraron el 2026-07-28.
Ver [`resueltos.md`](resueltos.md).

#### Decidido por el owner (pendiente de respuesta)

Vacía desde el 2026-08-11: las dos que tenía —el orden de los descuentos de un ítem y el
tope del descuento contra un recargo posterior— se decidieron y se cerraron en la ronda de
ese día (ver [`resueltos.md`](resueltos.md)).

### Auditoría `turnos` + `salones` + `garzones` (2026-08-06) — hallazgos confirmados

Pasada de 8 lentes según [`auditoria-codigo.md`](auditoria-codigo.md): 24 hallazgos crudos
→ **23 únicos** (dos lentes independientes cayeron por separado sobre el mismo bug de la
línea que se cuela durante el cierre; se cuenta una vez) → **22 sobreviven**. El único que
se cayó entero fue un deadlock en `fusionarCuentas` (ver "Refutados" abajo). El refutador
sumó 1 hallazgo que ninguna lente vio —la comanda seguía escondiendo el ítem borrado— y
que resultó ser la mitad que faltaba de un fix ya en curso.

**Lo que salió limpio, que es lo que la pasada vino a producir:** los 4 controllers
(incluidas las 3 clases dentro de `salones.controller.ts`) llevan
`JwtAuthGuard + TenantGuard + PermisosGuard` con el permiso correcto por verbo; ningún DTO
del alcance declara `tenantId`; los tres puntos donde un `:id` anidado podría ser IDOR
—`guardarLayout`, `fusionarCuentas`, `transferirCuentaAdmin`— resuelven contra el tenant
del token antes de usar el id; **0 violaciones de soft delete sobre ~65 queries** revisadas
una por una; y ningún `DELETE` físico en el alcance.

**Tres hallazgos se cerraron en la misma pasada** (los dos de severidad alta y el que sumó
el refutador), y el 2026-08-06 se cerró además el **fin de turno con mesas abiertas**, la
única decisión de owner que había quedado tomada sin construir: ver
[`resueltos.md`](resueltos.md).

#### El hilo que venía abierto: cerrado con matiz

La pasada de `caja`+`propinas` (2026-07-27) dejó anotado que `tipo_garzon` se congela al
abrir la sesión mientras `garzones.tipo` es editable. **Confirmado el congelado**
(`sesiones-garzon.service.ts:87`, y ni `cerrarPorPin` ni `cerrarAdmin` lo vuelven a tocar)
**y confirmado que `tipo` es editable sin gate** (`garzones.service.ts` → `actualizar()`;
la cita por número de línea se sacó porque el propio cierre las corrió). Pero el
impacto ya está contenido río abajo: `assertGarzonEnUnSoloGrupo` bloquea la liquidación con
un 400 accionable si una persona generó tips con dos `tipo_garzon` distintos en el período.
**La plata está a salvo.** El aviso en el momento de editar —lo único que faltaba— se cerró
el **2026-08-07**: el owner eligió advertir en vez de bloquear, y la advertencia nombra
además el bloqueo de liquidación que el cambio puede programar. Ver
[`resueltos.md`](resueltos.md) § "Ronda de decisiones del owner (2026-08-07)". **Este hilo
queda cerrado.**

#### Huecos de test (medidos, con el mutante que sobrevive)

Los de `actualizarLinea` y `quitarLinea` se cerraron con el fix de la línea que se cuela; el
de `fusionarCuentas` el 2026-08-09 con `test/salones-fusion.e2e-spec.ts` —que además fue el
primer e2e de esa ruta—; y el del computed `cuentaConItemEliminado` el mismo día, con dos
tests en `pages/salones/index.nuxt.spec.ts` (los tres en [`resueltos.md`](resueltos.md)).
De los huecos que esta pasada dejó medidos no queda ninguno abierto: los enumerados
arriba se cerraron.

### Revisión final `borrado-ingrediente-extra` (2026-07-28)

Hallazgos de la revisión que cerró la oleada de fixes de `GET /items/:id/uso` +
`remove()`. Ninguno bloqueaba el cierre; se difieren por alcance acotado a esa oleada.

### Refactor Caja → "Mi caja" / "Cajas" (diferido del brainstorm 2026-07-23)

El refactor separa la operación del cajero (**"Mi caja"**) de la supervisión del encargado
(**"Cajas"**). Se decidió que **"Cajas" arranca solo-lectura**; los poderes de escritura del
encargado se difieren a propósito para no acoplar el refactor de IA/permisos a un cambio de
modelo con implicancias de auditoría. Investigación y cruce de mercado:
[`investigaciones/2026-07-23-gestion-caja.md §6`](investigaciones/2026-07-23-gestion-caja.md).
El refactor de IA/permisos y los sub-proyectos A (arqueo multi-medio), B (cierre ciego) y
C (cierre en dos fases) **ya se entregaron** — ver [`resueltos.md`](resueltos.md). Lo que
sigue son los poderes del encargado que se difirieron a propósito:
