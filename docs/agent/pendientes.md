# Pendientes — a corregir al terminar el harness

Backlog de correcciones que se **difirieron a propósito** mientras trabajamos en el
harness, para no mezclar el meta-trabajo (reglas, gates, docs) con cambios de código de
producto. Cada entrada dice qué, dónde, por qué se difirió y cómo se cierra.

Regla de este archivo: **acá solo vive lo que falta hacer.** Cuando una entrada se cierra,
en el mismo commit se muda —con el texto de su cierre— a
[`resueltos.md`](resueltos.md). Nada de `[x]` acumulándose: una lista de trabajo con más
entradas tachadas que vivas deja de leerse. No es un TODO genérico: solo va lo que ya
identificamos con ubicación concreta.

---

## Deuda de código (surgió durante el harness)

- [ ] 🚩 **Diez ventas simultáneas cuelgan la API para siempre** (backend, medido
  2026-08-11) — **el hallazgo más grave abierto hoy.** No es lentitud: las requests no
  vuelven nunca y el proceso queda envenenado (las siguientes también cuelgan, aunque el
  cliente corte). Se descubrió midiendo otra cosa —el N+1 de recetas, la entrada de más
  abajo— y no lo veía ningún test porque el e2e corre con `maxWorkers: 1`.
  **Causa, confirmada por experimento y no por lectura:** `crearEnTransaccion` abre la
  transacción y **adentro llama a servicios que piden una conexión NUEVA al pool** en vez
  de usar el `manager`. O sea que **cada venta necesita dos conexiones a la vez**. El pool
  de `pg` no está configurado (`app.module.ts`), así que son 10 — con N ventas simultáneas
  y N = tamaño del pool, las N transacciones toman una conexión cada una y las N esperan
  una segunda que no existe. Deadlock permanente, no un timeout.
  Los cuatro llamadores sin `manager`, cualquiera de ellos suficiente:
  `cajaService.findActiva`/`findVirtual` (paso 1), `itemsService.cargarBasePorIds`,
  `catalogService.findAllUnidadesMedida` y `calculoPreciosService.calcular`.
  **Cómo se probó** (no se dedujo): (a) umbral exacto en 9 ok / 10 cuelga con producto
  simple, sin recetas; (b) `pg_stat_activity` durante el cuelgue muestra 4 conexiones
  `idle in transaction` esperando `ClientRead` —transacción abierta y el JS esperando otra
  conexión— más 5 en `Lock: tuple`; (c) **se subió el pool a 20 y el umbral se movió a 19
  ok / 20 cuelga**, o sea que el número de conexiones ES la variable. El cambio de pool se
  revirtió.
  ⚠️ **Subir el pool NO lo arregla**: solo mueve el umbral.
  ⚠️ **Batchear el N+1 tampoco lo arregla:** son conexiones, no queries.

  **⚠️ No es un bug de ventas: el patrón está en 7 módulos.** Barrido del 2026-08-11 sobre
  todo `backend/src`. Y como **el pool es uno solo para toda la app**, no hacen falta diez
  ventas: diez operaciones cualesquiera de esta lista se traban igual entre sí —tres
  ventas, dos mermas, un cobro y cuatro ediciones de ítem alcanzan—.

  | Archivo | Línea | Llamada sin `manager` |
  |---|---|---|
  | `ventas.service.ts` | 156, 157 | `cajaService.findVirtual` / `findActiva` |
  | `ventas.service.ts` | 186 | `itemsService.cargarBasePorIds` |
  | `ventas.service.ts` | 212 | `catalogService.findAllUnidadesMedida` |
  | `ventas.service.ts` | 260 | `this.dataSource.query` (directo) |
  | `ventas.service.ts` | 349 | `calculoPreciosService.calcular` |
  | `ventas.service.ts` | 615, 629 | `catalogService.crearConversor` |
  | `ventas.service.ts` | 680 | `garzonesService.obtenerActivoPorId` |
  | `ventas.service.ts` | 986 | `cajaService.findActiva` (otra transacción) |
  | `items.service.ts` | 1477, 2044 | `catalogService.convertirUnidad` |
  | `items.service.ts` | 3823, 3879, 4117 | `catalogService.crearConversor` |
  | `salones.service.ts` | 1013 | `sesionesGarzonService.buscarSesionAbierta` |
  | `pagos.service.ts` | 356 | `cajaService.findActiva` |
  | `mermas.service.ts` | 124 | `catalogService.convertirUnidad` |
  | `grupos-modificadores.service.ts` | 910 | `catalogService.convertirUnidad` |
  | `cobros.service.ts` (pasarela) | 289 | `tenantPasarelaService.resolverPorId` — **pide dos** |

  Los 20 se verificaron uno por uno contra el destino: todos terminan en un
  `repo.findOne/find` o un `dataSource.query`. Ninguno es un service puro.

  **Cómo se detectó, para poder repetirlo después del fix.** Un script recorre
  `backend/src` y, dentro de cada bloque que corre en transacción —métodos con
  `manager: EntityManager` en la firma, y callbacks de `.transaction(…)`—, marca tres
  cosas: `this.dataSource.*`, `this.<x>Repo.*`, y `this.<x>Service.<m>(…)` **cuyos
  argumentos no incluyan el manager**. Ese último chequeo tiene que mirar la lista
  **completa** de argumentos: la primera versión miraba solo el primero y marcó como falso
  positivo `cajaService.calcularEsperadoEfectivo(cajaId, manager)`, que recibe el manager
  segundo y es correcto.

  **Dos formas de arreglarlo, y no son excluyentes** (owner 2026-08-11: *"esto hay que
  verlo con más calma"*, queda sin decidir):
  1. **Pasar el `manager`** a las llamadas: cada service que hoy usa su repo pasa a aceptar
     un `manager?: EntityManager` opcional y elige `manager.getRepository(X)` o el repo
     propio. Uniforme para los 20, pero toca las firmas de ~6 services.
  2. **Para el catálogo de unidades, cargarlo en memoria una sola vez** — cubre **7 de los
     20** (`convertirUnidad` ×3, `crearConversor` ×3, `findAllUnidadesMedida`). Medido: la
     tabla `unidad_medida` **solo la escribe el seeder al arrancar**, no hay ningún camino
     de API que la modifique, así que no hay invalidación que diseñar. De paso saca una
     query de cada venta, merma y edición de ítem — hoy se lee varias veces dentro de la
     misma venta.

  **Ningún test lo veía y hay que arreglar eso también:** el e2e corre con
  `maxWorkers: 1` (`test/jest-e2e.json`), así que nunca hay dos transacciones a la vez. El
  fix necesita un test de concurrencia que dispare N operaciones simultáneas con N ≥ tamaño
  del pool — sin él, el bug vuelve sin que nadie se entere.

- [ ] **El override de precio de línea se filtra con un truthy sobre un string, y hay dos
  criterios distintos para "esta personalización cambia el precio"** (frontend, medido
  2026-08-11 al cerrar la entrada de `precioUnitario`) — `useVenta.ts:146` y `:197` deciden
  si guardan y si mandan `precioUnitarioOverride` con `if (precioOverride)`. Es un
  **string**, así que `'0'` es truthy y el cero viaja igual: el filtro no filtra lo único
  que podría querer filtrar. Hoy no rompe nada —`calcular` acepta el 0 a propósito, ver
  `calcular.dto.ts`— pero es la clase de chequeo que se cae sola cuando alguien endurece
  el DTO, que es exactamente lo que casi pasa.
  Al lado: **el POS y salones no coinciden en cuándo hay recargo.** `personalizacionVacia`
  (`useRecetaPersonalizacion.ts:154`) es falso con solo `omitidos` —un "sin cebolla" ya
  cuenta—, mientras que `tienePersonalizacionConRecargo` (`useSalones.ts:182`) exige
  `extras`/`grupos`/`componentes` e ignora `omitidos`. Los dos alimentan el mismo
  endpoint con el mismo campo. Ninguno de los dos es obviamente el correcto, y esa es la
  entrada: decidir cuál es el criterio y dejar uno solo.

- [ ] **Tres filtros de rango por fecha pura quedaron dependiendo del `TimeZone` de sesión**
  (backend, 2026-08-06) — efecto lateral medido de [ADR-019](../adr/019-timestamptz-en-toda-columna-de-fecha.md).
  `mermas.service.ts:268,272`, `inventario.service.ts:788,792` y
  `pasarela/services/cobros.service.ts:593,597` (este último sobre `pasarela_ordenes`, alias `o`) filtran `creado_el >= $N` / `<= $N` con
  valores que vienen de DTOs validados con `@IsDateString()`, **que acepta una fecha pura**
  (`2026-08-01`) además de un timestamp completo. Con la columna sin zona, Postgres tomaba
  los dígitos literales; con `timestamptz` interpreta esa fecha en el `TimeZone` de la
  sesión antes de convertir. Hoy no cambia nada —`SHOW TimeZone` da `UTC`, medido— pero es
  una dependencia que antes no existía, y el default del server no lo fija nadie
  explícitamente (ni el compose ni la config del pool).
  **Cierre posible:** el patrón ya resuelto está en `propina-reportes.service.ts:264-266`,
  que castea explícito con la zona del tenant (`$2::date::timestamp AT TIME ZONE $4`). Son
  tres servicios copiando ese molde. **No entró en ADR-019** porque cambiar la semántica de
  un filtro de reportes es una decisión de producto (¿el "desde" es medianoche UTC o
  medianoche del local?), no una migración de tipos.

- [ ] **El job de CI del frontend necesita timeout propio** (2026-08-06) — con
  `hookTimeout` en 60s y `testTimeout` en 20s (ver [`resueltos.md`](resueltos.md)), un
  entorno Nuxt realmente colgado tarda hasta un minuto por archivo en reportarse, y hay 22
  `.nuxt.spec.ts`. Hoy no hay un `timeout-minutes` en `.github/workflows/ci.yml`. Prioridad
  baja: es el peor caso de una falla que además sería visible por otros lados.

- [ ] **De `configCalculo` faltan `escalaCalculo` y `modoRedondeo`** (frontend, 2026-08-02)
  — el desglose por línea ya usa `formula` para ordenarse y muestra el orden **con el modo
  de cada familia** (`Descuento (base) → Recargo (cascada) → Impuesto`), que es lo que
  explicaba los montos. Quedan los dos campos de redondeo, que solo importan cuando un
  centavo no cuadra: son los que explican una diferencia de $1 entre lo que el lector calcula
  a mano y lo que muestra la fila. Cierre posible: una línea plegable en la tarjeta de
  Totales. **Prioridad baja** — no hay un caso reportado de descuadre.
  ⚠️ Va con una decisión de permisos: hoy el desglose lo ve **cualquiera con `Ventas:Leer`**
  (`ventas.controller.ts:89`), que es el mismo permiso del resto del drawer. Si la config del
  tenant se considera información de administración, hay que separar el guard.

- [ ] **Una nota de crédito no descompone su monto: registra `total_impuestos = 0`**
  (backend, medido 2026-08-02 leyendo `ventas.service.ts:854` `crearNotaCredito`) —
  **⛔ Toca materia fiscal: no avanzar sin decisión del owner** (`CLAUDE.md` → detenerse
  ante impuestos y documentos tributarios; ver **ADR-010**).
  **Lo medido, sin interpretar:** la NC construye su fila de `ventas` **directo**, no por
  `crearEnTransaccion`, y hardcodea `totalDescuentos: '0'`, `totalRecargos: '0'` y
  `totalImpuestos: '0'`, con `totalBruto = totalFinal = params.monto`. Consecuencias
  encadenadas: (a) cero filas en `ventas_descuentos`/`ventas_recargos`/`ventas_impuestos`,
  así que la NC no dice qué reglas revierte —se llega por la venta que referencia—;
  (b) `config_calculo` queda `null` en toda NC; (c) `base_ventas_sin_impuestos` se queda en
  el default de la columna, y ese campo lo consume `liquidacion-propinas.service.ts`.
  Los dos puntos de entrada (`crearNotaCreditoDesdeVenta`) desembocan en el mismo método.
  Lo que la NC **sí** congela es `descripcion` y `clasificacion_tributaria` por línea en
  `venta_detalles`, copiadas de la línea original.
  **La pregunta para el owner, que NO me corresponde responder:** una NC sobre una venta con
  IVA 19%, ¿tiene que declarar su propio IVA? Un DTE 61 lleva `MntNeto`/`IVA`/`MntTotal`
  propios, y ADR-010 dice congelar el **hecho fiscal** en la transacción y diferir solo lo
  que transmite o formatea — el corte neto/impuesto de una NC parece hecho fiscal, no
  formato. Si lo es, hoy falta y no es solo un tema de auditoría.
  **Contraargumento honesto a considerar:** la NC se emite **por monto** (`params.monto`,
  con devoluciones de línea opcionales y sueltas del monto), así que "descomponer" exige
  primero definir contra qué —¿prorrateo sobre el total original? ¿solo sobre las líneas
  devueltas?—, y eso es regla de negocio, no implementación.

- [ ] **Una venta online 100% descontada no tiene ningún camino a venta** (backend +
  frontend, encontrado en el smoke del 2026-08-02) — con el carrito de la tienda en
  total `$0` el cobro se cae por los **dos** caminos, no solo por Webpay: la rama webpay
  corta en `pagos-redirect.service.ts:86` ("El monto debe ser mayor a cero"), y el flujo
  simulado tampoco puede porque `pasarela.vue:68` manda siempre
  `monto: totales.totalFinal` y `PagoVentaDto.monto` lleva `@IsDecimalPositivo()`
  (`create-venta.dto.ts:73-76`), así que `POST /ventas` lo rechaza más tarde.
  ⚠️ **No hay asimetría con el POS** — la primera redacción de esta entrada decía que el
  POS sí cerraba estas ventas "porque omite la línea de pago", y es falso:
  `CobroModal.vue:99-101` exige `pagosValidos.length > 0` y el botón queda `:disabled`
  (`:189`), así que con total `0` el POS tampoco confirma. El comentario de
  `create-venta.dto.ts:73` ("el POS ya los omite al confirmar") habla de descartar las
  líneas en `$0` dentro de un pago **dividido** que sí tiene alguna con monto
  (`CobroModal.vue:95-97`), no de confirmar sin ninguna. **No hay un comportamiento del POS
  que copiar.**
  **Lo que la restricción realmente es:** de **UI en los dos lados**. La API sí acepta una
  venta sin pagos —`CreateVentaDto.pagos` es `@IsOptional()` (`create-venta.dto.ts:130-134`),
  por eso existen las ventas `pendiente`—, pero `ventas.service.ts:676` solo llama a
  `calcularEstadoVenta` `if (saved.pagos.length > 0)`, así que una venta de `$0` sin pagos
  quedaría **`pendiente` con saldo `$0`**, arrastrándose en los listados de deuda. O sea que
  "crearla sin pago" tampoco es un modelo limpio: es una segunda decisión.
  **La pregunta para el owner:** ¿una venta de total `$0` es una venta **pagada**, una venta
  **pendiente**, o algo que se prohíbe antes de llegar al cobro? Es un caso real de
  promociones, no un borde teórico. Relacionado con la entrada de `precioUnitario` de abajo:
  es la misma pregunta de si el `0` es un monto válido, en otra capa.
- [ ] **`/tienda/pasarela` es inalcanzable en el tenant principal del seed** (frontend,
  medido 2026-08-02) — la pantalla solo existe en el fallback **simulado**: si el tenant
  tiene Webpay Plus activa, `pagar()` toma la rama webpay y la SPA sale por redirect a
  Transbank. El seed activa Webpay Plus **solo en `Demo Restaurante`**
  (`seeder.service.ts:1742-1762`), que es donde entra todo el mundo; `Demo Bodega` no tiene
  fila en `tenant_pasarela`, así que **según el seed** cae al flujo simulado y alcanzaría la
  pantalla — derivado del código, no observado en una corrida, y sin verificar que ese tenant
  tenga catálogo `tipo=producto` ni el módulo de tienda contratado. Consecuencia práctica: **nada
  automático abre este archivo** —no tiene spec, y el e2e de layout no lo alcanza porque
  la guarda de `checkoutRef` (`pasarela.vue:34`) lo hace inaccesible por `goto` pelado—,
  así que el próximo que quiera verlo va a perder tiempo antes de descubrir que hay que
  desactivar la pasarela o cambiar de tenant. Decidir si se cubre con e2e (sembrando el
  `checkoutRef`) o si se documenta como pantalla de fallback y se deja sin cobertura.
  ⚠️ **La pregunta de cobertura es la menor. Medido el 2026-08-11, mirando el código:**
  1. **El tenant no elige nada.** `online.service.ts` → `pagar()` decide por **ausencia**:
     `if (!tieneWebpay) return { modo: 'simulado' }`, con el comentario *"Fallback: sin
     Webpay Plus activo, mantener la pasarela simulada actual"*. No hay configuración de
     medios de pago online; hay una pasarela real y lo que sobra cuando falta.
  2. **La pantalla simulada registra la venta como PAGADA sin que nadie cobre.**
     `pasarela.vue` → `aprobar()` postea `POST /ventas` con `pagos: [...]` por el
     `totalFinal`, y elige el método con `metodoTarjeta()`: busca uno cuyo nombre
     contenga "crédito"/"credito" y **si no encuentra agarra `metodos[0]`**. Cualquier
     tenant que entre sin pasarela conectada tiene una tienda online que entrega
     mercadería y la anota cobrada. El estado `pendiente` —que el modelo ya soporta— es
     donde debería quedar.
  **Owner (2026-08-11): la salteó, con la función que quiere ya nombrada** — que el
  tenant **configure** qué acepta online (tarjeta por pasarela, transferencia, pago al
  retirar…), en vez de heredar el simulado por descarte. Eso es feature con spec propia:
  toca configuración, tienda, registro de la venta y estado resultante. El punto 2 es un
  defecto que existe igual, se configure o no.
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

- [ ] **Un flaky del e2e de caja, y seis lecturas de `/tenants/members` que esconden su
  causa** (backend/tests, visto el 2026-08-11) — son dos cosas y la segunda es la que se
  puede arreglar hoy.

  **El flaky:** `caja.e2e-spec.ts` → *"un usuario fuera del allow-list del cajón recibe 403
  al abrir"* falló con `TypeError: resMiembros.body.find is not a function`. La corrida
  siguiente, verde. **Las dos** partieron de `reset-db.sh` y las dos pasaron
  `reset-db.sh --verificar` (un solo `Seed complete`, mismo contenedor), así que no es la
  contaminación acumulativa de siempre. Y `test/jest-e2e.json` tiene `maxWorkers: 1`, así
  que tampoco es interferencia entre specs en paralelo. **Causa no determinada:** lo único
  medido es que el body no era un array.

  **Lo que sí se puede cerrar sin saber la causa:** el helper `usuarioIdDe`
  (`caja.e2e-spec.ts:145-151`) hace `(res.body as Member[]).find(...)` **sin mirar el
  status**, así que cuando la respuesta no es la lista el test muere con un `TypeError`
  sobre `.find` en vez de decir qué contestó el servidor. Eso convierte un diagnóstico de
  un minuto en una sesión de forense. Agregarle una aserción de status **no arregla el
  flaky: lo hace legible la próxima vez**, que es lo que falta para poder atacarlo.

  ⚠️ **No es un caso aislado, se grepeó el repo:** el mismo casteo sin chequear status está
  en `cajones.e2e-spec.ts:178` (`.map`) y en seis lugares de
  `alta-usuarios-tenant.e2e-spec.ts` (`.get` en 127, 168, 180, 190, 205, 249). Van juntos o
  el próximo flaky vuelve a salir mudo por otra puerta.

  Contexto que puede o no ser relevante, anotado para no perderlo: `GET /tenants/members`
  es **admin-only** desde el 2026-08-09 (`TenantAdminGuard`). El token que usa el test es
  el del admin, así que un 403 liso no es la explicación obvia — pero es justo la clase de
  hipótesis que la aserción de status confirmaría o descartaría de una.
---

## Detector de desborde de layout (`e2e/layout/desborde.spec.ts`, 2026-07-29)

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

## Papelera — restaurar eliminados (2026-07-31)

Backend completo en los 16 recursos; doc operativa [`docs/features/papelera.md`](../features/papelera.md).

✅ **La decisión del owner "solo lo que borró una persona" quedó implementada entera el
2026-08-01.** Los dos agujeros —el `OR` sin parentizar del listado de `impuestos` y el
`eliminado_por` que `restaurar()` no limpiaba— están cerrados, con el e2e de la regla
corriendo sobre los **16** recursos en vez de sobre 2. Se levanta el ⛔ que impedía
cablear la pantalla de impuestos. Detalle y mutantes: [`resueltos.md`](resueltos.md).

Y un hallazgo que la feature dejó medido y no es suyo (el otro, el del esquema partido
entre `TIMESTAMPTZ` y `TIMESTAMP` sin zona, se cerró el 2026-08-06 — ver
[`resueltos.md`](resueltos.md)):

- [ ] **La plomería de tramos en `recargos` es alcanzable y no significa nada**
  (backend) — `create()`/`update()` persisten `dto.tramos` y
  `validarSegunTipoUpdate` valida que no venga vacío, pero **ningún código de
  recargo usa tramos**: `RECARGO_CONFIG` (frontend) no declara `campoTramos: true`
  en ninguno de los 5, así que la UI nunca los manda. La lista muerta de
  `validarSegunTipoCreate` —que comparaba contra `por_mayor`/`por_monto_venta`,
  códigos de DESCUENTO— ya se sacó (2026-08-01); esto es el resto. Sacarlo toca
  persistencia, así que va aparte: hay que confirmar primero que no haya filas en
  `recargo_tramos` y decidir si la tabla se va con él.
  **Decisión del owner (2026-08-11): NO se borra — se construye.** Recargos por escalones
  configurables, igual que los descuentos. Cambia el encuadre de la entrada: deja de ser
  limpieza y pasa a ser feature a medias.
  **Medido el 2026-08-11, y es menos de lo que decía la entrada:** el motor **ya los
  aplica**. `evaluarRegla` (`calculo-precios.engine.ts:290`) ramifica por
  `regla.tramos.length > 0` sin mirar si es descuento o recargo, y `procesarReglas` es
  la misma función para ambos. Lo que falta es (a) un tipo de recargo con
  `campoTramos: true` en `RECARGO_CONFIG` (`frontend/app/utils/reglas-form-config.ts`),
  hoy ninguno de los 5 lo tiene; (b) el equivalente de `TIPOS_CON_TRAMOS` en
  `recargos.service.ts`, que hoy no existe; (c) las filas del tipo nuevo en el seeder.
  ✅ **Análisis por tipo, hecho el 2026-08-11 — medido contra el motor, tipo por tipo, no
  deducido del `if`.** Se corrió el mismo recargo con tramos por monto (3% desde 0, 7%
  desde 500) sobre un neto de 1000, cambiando solo el `codigo`:

  | Tipo | Resultado hoy | Por qué |
  |---|---|---|
  | `general` | ✅ **70** | cae al camino de tramos; magnitud = monto |
  | `interes_simple` / `interes_compuesto` | ✅ **70** | mismo camino que `general` |
  | `recargo_metodo_pago` | ⚠️ **0** | la rama de `METODO_PAGO_CODIGOS` retorna **antes** del `if` de tramos, y `valor` es null |
  | `mora` | ⚠️ **0** | está en `DIFERIDAS`: el motor no la evalúa |

  **Los dos ceros son trampas, no limitaciones:** no "ignoran" el tramo, **cobran cero en
  silencio**. Habilitarles `campoTramos` sin tocar el motor produciría recargos que el
  admin configura, la UI muestra y la venta no cobra.

  **Conclusión — el trabajo se parte en dos, y la primera mitad es barata:**
  1. **`general` (y los dos de interés) salen sin tocar el motor.** Solo falta
     `campoTramos: true` en `RECARGO_CONFIG` (`frontend/app/utils/reglas-form-config.ts`),
     el equivalente de `TIPOS_CON_TRAMOS` en `recargos.service.ts`, y las filas del seed.
     Cubre el caso típico: **recargo por pedido chico o por envío que baja según el monto**.
     A nivel venta la magnitud es el neto agregado (`subtotalNeto`, línea 616), que es
     justo el que ese caso necesita.
  2. **`mora` y `recargo_metodo_pago` NO salen sin motor**, y cada una por su razón
     distinta: la primera hay que des-diferirla, la segunda necesita que la rama de método
     de pago siga hasta los tramos en vez de retornar.
  ⚠️ **La magnitud "días de atraso" o "plazo" no existe en el motor** (`línea 291`: o
  cantidad si el código es `por_mayor`, o monto). Escalonar `mora` por días o los intereses
  por plazo es una magnitud nueva, no un tipo nuevo. Y los intereses tienen un tema previo:
  hoy el motor los aplica como **porcentaje plano de la base**, sin ninguna dimensión
  temporal, aunque la UI los etiquete "Tasa mensual".
  ⛔ La parte 2 **toca el motor de precios**: se vuelve a confirmar con el owner antes de
  escribir. La parte 1 no lo toca.

## Auditoría `ventas` + `pagos` (2026-07-27) — hallazgos confirmados

Pasada de 7 lentes según `docs/agent/auditoria-codigo.md`: 20 hallazgos crudos → 15
confirmados tras refutación. El detalle de cada fix está en
[`resueltos.md`](resueltos.md); acá quedan **3 entradas abiertas** (contadas, no estimadas).

ℹ️ Los números de arriba **no cuadran** con la suma de entradas y no se fuerzan para que
cuadren: `resueltos.md` acumula 18 cerradas de esta pasada contra "15 confirmados", porque
varias se cerraron en mitades (una cerrada, una diferida como entrada nueva) y algunas
decisiones de owner entraron después de la pasada. La lista de entradas es la fuente de
verdad; el conteo del encabezado describe la auditoría original.

- [~] **N+1 al resolver personalización de recetas/combos** — parcialmente cerrado
  2026-07-27. Al abrirlo apareció un N+1 **más caro que el reportado y anidado adentro**:
  `resolverGruposDeItem` disparaba una query **por cada grupo de modificadores** del ítem.
  Ese se cerró (`unnest` de pares grupo↔item_grupo en una sola query) y beneficia a los
  **tres** llamadores —ventas, salones y combos— sin cambiar ninguna firma.
  **Queda abierto lo reportado originalmente:** batchear *entre líneas*, es decir precargar
  los catálogos de las recetas/combos distintos del carrito en vez de resolver cada línea
  por su cuenta. Hoy cada línea `receta`/`combo` cuesta 3 queries fijas (ingredientes,
  extras, grupos+opciones). Batchearlo exige pasar los catálogos precargados por parámetro
  a `resolverPersonalizacionReceta`/`Combo` y `resolverGruposDeItem`, que tienen 3
  llamadores incluido `salones.service.ts` — más riesgo y menos ganancia que lo ya hecho.
  **Es decisión de owner si se encara**, con este número sobre la mesa: un carrito de 5
  líneas de receta pasó de 5×(3+G) queries a 15 fijas; batchear entre líneas lo llevaría
  a ~3.
  **Decisión del owner (2026-08-11): medir antes de decidir.** El conteo de queries no es
  tiempo: falta el número en milisegundos de un carrito cargado —el caso real es varias
  cajas concurrentes, no una— y recién con eso se elige entre encararlo y cerrar la
  entrada. La medición va primero **porque el arreglo toca `resolverPersonalizacion*` y
  `resolverGruposDeItem`, con tres llamadores** (ventas, salones, combos): hoy tiene más
  riesgo que ganancia demostrada.

  ✅ **Medido el 2026-08-11** contra el stack de docker-compose con la base recién
  sembrada, ingredientes propios con stock alto (los del seed se agotan y la medición se
  vuelve una carrera contra el stock), 30 repeticiones tras 3 de calentamiento:

  | Carrito (`POST /ventas`) | p50 | p95 |
  |---|---|---|
  | 1 producto simple | 10.7 ms | 12.7 ms |
  | 5 productos simples | 12.1 ms | 15.7 ms |
  | 1 receta | 11.2 ms | 13.0 ms |
  | 3 recetas distintas | 15.0 ms | 16.6 ms |
  | 5 recetas distintas | 19.2 ms | 34.7 ms |
  | 8 recetas distintas | 23.6 ms | 37.3 ms |

  **Lectura: ~1,8 ms por línea de receta.** Un carrito de 5 recetas cuesta 19,2 ms contra
  12,1 ms de 5 productos simples: **~7 ms atribuibles** a resolver recetas, que es lo que
  batchear recuperaría. Sobre una venta que el cajero dispara una vez, 19 ms contra 12 ms
  no se percibe.
  ⚠️ **Dos correcciones a la entrada original, medidas:**
  - **El N+1 no está en `/calculo-precios/calcular`** —ahí el tiempo es plano entre 1 y 8
    recetas— sino en `POST /ventas` (`ventas.service.ts:280`). La primera pasada de
    medición apuntó al endpoint equivocado y dio 6 ms constantes.
  - **Las llamadas por línea corren dentro de un `Promise.all`**, o sea **en paralelo**.
    "15 queries" no son 15 viajes en serie, que es lo que la cifra sugería.
  **Recomendación: no encararlo.** 7 ms de ganancia contra un refactor que toca tres
  llamadores. Se reabre si aparece un carrito mucho más grande o si el endpoint sale en
  una traza lenta.
  ⛔ **Lo que sí salió de esta medición y hay que mirar es otra cosa:** ver la entrada del
  deadlock de diez ventas simultáneas, al principio de "Deuda de código". Batchear no lo
  arregla.

### Decidido por el owner tras investigación de mercado (2026-07-27)

Cuatro decisiones de owner sobre reglas de negocio no documentadas; tres ya se
implementaron ([`resueltos.md`](resueltos.md)). Método, cruce contra el código y fuentes:
**`docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`**. Lo que queda es
**trabajo pendiente con la forma ya definida**, no una pregunta abierta.

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

## Auditoría `caja` + `propinas` (2026-07-27) — hallazgos confirmados

Pasada de 8 lentes según [`auditoria-codigo.md`](auditoria-codigo.md): 25 hallazgos crudos →
22 únicos (3 los vieron dos lentes por separado) → **20 sobreviven** tras refutación.
**Los 20 se cerraron el 2026-07-27**; el detalle de cada fix, con sus mutantes, está en
[`resueltos.md`](resueltos.md). Acá queda lo que esos cierres dejaron abierto: la mitad de
la reconciliación de propinas que exige spec propia, un hallazgo que trajo la revisión
independiente, y las ramas que ningún test toca.

### Huecos de test

**De la feature de pausa (2026-08-03)**, los dos que habían quedado abiertos a conciencia
—cobrar una cuenta de salón con un ítem pausado después de cargarlo, y que una regla pausada
no quede congelada en `ventas_descuentos`— **se cerraron el 2026-08-09**; ver
[`resueltos.md`](resueltos.md). Lo que sigue abierto de esa feature:
- **`ventas/pos.vue`, `tienda/index.vue` y `tienda/suscripciones.vue` no tienen
  `.nuxt.spec.ts`.** El filtro de pausados que vivía en esas tres pantallas se movió a la
  query el 2026-08-09 (`activo=true`, ver [`resueltos.md`](resueltos.md)), y el endpoint sí
  quedó cubierto por e2e; lo que **no** sostiene nada es que cada pantalla lo pida — borrar
  `&activo=true` de una URL deja la suite en verde. En `salones/index.vue` eso ya tiene test,
  porque ahí el spec existe. Montar las otras tres exige stores de caja, unidades e
  impresoras: es el arnés, no el `it`.
- ℹ️ **El tope de 100 sigue vivo, y ahora es el único truncamiento que queda** (frontend).
  Las cuatro superficies de venta piden `pageSize=100` y no paginan, con
  `MAX_PAGE_SIZE = 100` en `common/utils/pagination.util.ts`. Mover el filtro de pausados a
  la query sacó una causa de pérdida —el pausado ya no le roba el lugar a un vendible— pero
  un tenant con más de 100 ítems vendibles sigue sin verlos todos en el POS. Preexistente y
  sin caso reportado; se anota para no perderlo, porque la nota anterior vivía pegada a la
  entrada del filtro que se cerró.

**Ramas sin cobertura alguna.** La lista se triageó el 2026-08-09 y se cubrieron **cuatro
ramas nuevas**: el spillover de propina entre pagos, el aislamiento multi-tenant **de
lectura** de caja, la capa SQL de `propina-reportes` y `HORAS_TRABAJADAS`; más el rechazo de
`peso <= 0`. Se escribieron además dos tests de guardas (`fechaHasta <= fechaDesde` y Σ de
porcentajes) que **no** agregan cobertura de rama: los mataban tests unitarios preexistentes.
Detalle, mutantes y lo que quedó sin fijar en [`resueltos.md`](resueltos.md).

Lo que la tanda dejó abierto y antes no estaba anotado:

- [ ] **El scoping por tenant del camino de ESCRITURA de caja no está fijado por ningún
  test** (backend) — el e2e nuevo prueba que la escritura ajena no prospera y que la caja
  queda intacta, pero no aísla cuál de las tres defensas la frena
  (`bloquearCajaAbierta` + `findOne` acotado + chequeo de dueño). Medido: sacando la de
  tenant, la request del otro tenant llega al `FOR UPDATE` y la corrida **se cuelga**, así
  que no hay aserción posible sobre el resultado. Encararlo probablemente pida un timeout
  explícito en la query o mirar el lock, no un `expect` de status.

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

### Decidido por el owner (2026-07-27)

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
- [ ] **`buscarTipsPorFuentes` no filtra la venta anulada** (backend,
  `propinas/liquidacion-propinas.service.ts` → `buscarTipsPorFuentes`) — es la copia hermana de
  `buscarTipsElegibles` que usa `actualizarConfig` para recalcular pesos sobre las fuentes
  ya fijadas de un borrador. Si la venta se anula **con el borrador abierto**, un
  `actualizarConfig` posterior sigue usando sus datos para el peso (`VENTAS_NETAS`,
  `CANTIDAD_CUENTAS`). Lo encontró la revisión independiente del 2026-07-27.
  ⛔ **No es copiar la línea del hermano.** El `poolTotal` se congela al crear el borrador e
  **incluye** esa propina: filtrar solo acá le saca el peso al garzón pero deja su plata en
  el pool, o sea la redistribuye entre los demás. Decidir eso es la misma pregunta de
  reconciliación del ítem de abajo (¿la plata de una venta anulada sale del pool, se
  redistribuye, o queda como saldo?), así que va con esa spec y no antes.
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

## Auditoría `items` + `calculo-precios` (2026-07-28) — hallazgos confirmados

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

### Alta

Los tres hallazgos de severidad alta se cerraron el 2026-07-28.
Ver [`resueltos.md`](resueltos.md).

### Media

- [ ] **El modal de pausa cuenta asociaciones por ítem, y una regla usada solo a nivel venta
  no tiene ninguna** (frontend + backend, medido 2026-08-03 en la revisión de cierre) —
  `GET /:id/uso` cuenta filas de `item_descuentos`, pero las reglas que se aplican por
  `descuentosVentaIds` / `recargosVentaIds` **no tienen tabla puente** (no hay columna `nivel`
  en `descuentos`/`recargos`), así que devuelven `items: []` y la pantalla las pausa directo,
  sin confirmación. El texto "Deja de aplicarse en N ítems" también queda incompleto ahí.
  Hoy es teórico —ninguna pantalla manda esos campos, medido el 2026-08-03—, pero deja de
  serlo en cuanto exista un productor.
  Decisión del owner pendiente: si el modelo necesita distinguir el **nivel** de una regla
  (línea vs venta), que hoy no distingue.
- [ ] **`suscripciones.service.ts:87-90` descarta `resultado.advertencias`** (backend, medido
  2026-08-03) — la justificación escrita ("hoy ningún ítem de suscripción tiene descuentos") es
  más angosta que la superficie nueva: ahora ese descarte también se traga los avisos de regla
  o impuesto pausado sobre el primer período.
- [ ] **El aviso de ítem pausado se emite por línea** (backend,
  `calculo-precios.service.ts`, 2026-08-03) — el mismo ítem en 3 líneas (recetas
  personalizadas, salones) da 3 toasts idénticos en el POS. Mismo ruido que el de impuestos de
  la entrada de abajo.
- [ ] **Una advertencia de impuesto pausado se repite por línea, y se emite aunque la fórmula
  del tenant no incluya el paso `impuestos`** (backend, `calculo-precios.engine.ts`, medido
  2026-08-03) — un carrito de 10 líneas con el mismo impuesto pausado produce 10 advertencias
  idénticas, que el POS aplana a 10 toasts. Puede ser deliberado (las advertencias de línea
  son por línea por naturaleza), pero para una regla global al catálogo el ruido es real. Lo
  segundo sí es un borde claro: se arman antes del recorrido de la fórmula, así que un tenant
  cuya fórmula no aplique impuestos igual ve el aviso.
- [ ] **`remove()` valida el uso del ítem con una lectura sin lock** (backend,
  `items.service.ts`, `remove()`) — última de las "tres carreras del mismo molde"; las otras
  dos se cerraron el 2026-07-30 ([`resueltos.md`](resueltos.md)).
  ⚠️ **La entrada original decía que `remove()` "no es transaccional" y eso era falso**: abre
  `this.dataSource.transaction()` y `obtenerUsoItem` corre adentro. Lo que sí es cierto es
  otra cosa: ese `SELECT` **no toma lock**, así que entre el chequeo y el commit otra
  transacción puede insertar una fila que referencie al ítem. Es un phantom, no falta de
  atomicidad — y por eso el arreglo no es "envolver en transacción".
  Consecuencia real: el ítem queda borrado blando y con una `receta_ingredientes` viva
  apuntándolo. Como las lecturas filtran por el JOIN a `items`, el ingrediente **desaparece
  en silencio de la receta** y su costo cambia sin que nadie lo pida.
  Por qué no se cerró junto con las otras dos: no hay una fila única que bloquear —el guard
  lee cuatro tablas hijas—. El arreglo es bloquear la fila de `items` referenciada, y hacerlo
  **en `remove()` y en cada camino que crea una referencia** (asociar ingrediente, componente
  de combo, opción de grupo, extra permitido). Eso es varios sitios de escritura y su propio
  análisis de orden de locks: es una tarea, no un `FOR UPDATE` más.

### Baja

- [ ] **`convertirAMonedaOficial` redondea a 4 fijo** (backend,
  `calculo-precios.service.ts:188`) — **hallazgo del refutador, ninguna lente lo vio**: el
  `.toFixed(4)` ignora `escalaCalculo` y `modoRedondeo` del tenant, y ocurre justo antes de
  entregarle el precio al motor que sí los respeta. Un paso de redondeo fuera de la config.

### Decidido por el owner (pendiente de respuesta)

Vacía desde el 2026-08-11: las dos que tenía —el orden de los descuentos de un ítem y el
tope del descuento contra un recargo posterior— se decidieron y se cerraron en la ronda de
ese día (ver [`resueltos.md`](resueltos.md)).

## Auditoría `turnos` + `salones` + `garzones` (2026-08-06) — hallazgos confirmados

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

### El hilo que venía abierto: cerrado con matiz

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

### Media


### Huecos de test (medidos, con el mutante que sobrevive)

Los de `actualizarLinea` y `quitarLinea` se cerraron con el fix de la línea que se cuela; el
de `fusionarCuentas` el 2026-08-09 con `test/salones-fusion.e2e-spec.ts` —que además fue el
primer e2e de esa ruta—; y el del computed `cuentaConItemEliminado` el mismo día, con dos
tests en `pages/salones/index.nuxt.spec.ts` (los tres en [`resueltos.md`](resueltos.md)).
Quedan:

- [ ] **Con el seed no se puede ver una comanda a mano** (backend, `seeder.service.ts`) —
  **la mitad de test de esta entrada se cerró el 2026-08-09**: el camino a cocina ya tiene
  e2e (`test/salones-comanda.e2e-spec.ts`, ver [`resueltos.md`](resueltos.md)), que se monta
  sus propias impresoras, categorías e ítems por API en vez de depender del seed.
  Lo que queda es el **smoke manual**, que es de donde salió la entrada el 2026-08-06: con
  el seed a secas `agruparEstacionesComanda` devuelve `[]`, así que hubo que cablear una
  categoría por SQL para ver una comanda en pantalla. Medido contra la BD sembrada: la
  categoría **existe y tiene impresora** —"Ropa y accesorios" → "Cocina", puesta a propósito
  con ese comentario en el seeder—, pero **no tiene ningún ítem adentro**, y el único ítem
  con categoría del seed está en "Electrónica", que no tiene impresora. El arreglo es
  asignarle `categoriaId` a un ítem vendible del seed, no crear categoría ni impresora.
  ⚠️ Al hacerlo, verificar que ningún e2e afirme sobre la categoría de ese ítem: el seed es
  el escenario inicial de los 30 specs.

### Lo que dejaron las revisiones independientes del cierre

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

- [ ] **Un correo de usuario soft-borrado hace explotar el alta con un 500** (backend,
  `tenants.service.ts` → `crearUsuario`) — medido por la revisión del 2026-08-08 contra la
  base viva: la búsqueda de `usuarioPrevio` corre con el filtro de soft delete, pero la
  unique de `usuarios.correo` **no es parcial**, así que el `INSERT` choca y sale un
  `500 Internal server error` en vez de un 409 o un 400 accionable. **Hoy es inalcanzable**:
  nada en `backend/src` soft-borra un `Usuario` (`removeMember` solo da de baja la
  membresía). Se anota y no se arregla porque el fix depende de una decisión que no está
  tomada — si algún día se pueden dar de baja usuarios, ¿el alta los revive, los rechaza, o
  el correo queda quemado?
  **Decisión del owner (2026-08-11): el alta REVIVE la cuenta, avisando.** La persona
  vuelve con su historial —sus ventas, turnos y propinas siguen siendo suyas— y el alta
  responde que está reactivando una cuenta, no creando una.
  ⚠️ **Revivir la cuenta no es revivir los permisos.** El alta tiene que declarar los
  roles de nuevo, igual que hace hoy `POST /tenants/usuarios`; heredar en silencio los
  viejos es exactamente el agujero que la entrada de `addMember` de acá arriba describe.
  Sigue sin implementarse por lo mismo de antes: **nada soft-borra un `Usuario`**, así que
  el escenario es inalcanzable. Lo que la decisión fija es la forma del fix el día que
  exista la baja — y que la unique de `usuarios.correo` va a tener que ser parcial.

- [ ] **Verificación de correo del auto-registro público** (backend) — lo único que
  quedó abierto de la entrada de mail, que se cerró el 2026-08-09 (ver
  `resueltos.md`). La invitación resuelve la verificación **del invitado**: si hizo
  clic en el link, la dirección existe y alguien la lee. Falta el otro camino:
  `POST /auth/register` sigue creando cuentas con un correo que nadie probó.

- [ ] **Modo personal: el garzón con su propia tablet no debería teclear el PIN** (backend +
  frontend) — **Fase 2 del plan `2026-08-08-elegir-garzon-antes-del-pin.md`, diseñada y
  diferida el 2026-08-08.** El vínculo opcional `garzones.usuario_id` + `usuarios_tenants.
  es_totem` como marcador **explícito** del modo (no inferido: una cuenta marcada como tótem
  no puede volverse personal aunque alguien la vincule por error). Todo el diseño está en el
  plan, incluidas las cuatro preguntas ya resueltas.
  ⚠️ **DESBLOQUEADA el 2026-08-08.** Estaba frenada porque el alta de usuarios del tenant no
  existía —`POST /tenants/members` recibía un `usuarioId` ya existente y el único camino a
  una cuenta era el registro público—, así que habilitar un garzón personal costaba 4 pasos
  en 3 pantallas. Ahora `POST /tenants/usuarios` lo hace en uno
  (`docs/features/roles-permisos.md`). Lo que queda de esta entrada es el vínculo
  `garzones.usuario_id` + `usuarios_tenants.es_totem` y la resolución del garzón actuante,
  todo diseñado en el plan.

- [ ] **`anti-patterns.md` pasó su propio tope de 20 entradas y nadie podó** (docs,
  `docs/agent/anti-patterns.md:14`) — la regla 3 del archivo dice *"Tope: 20 entradas. Si se
  llena, la más antigua sin reincidencia se elimina"*. Medido el 2026-08-07: **25** entradas
  `### ❌`. Ya estaba en 23 antes de esa tanda, así que no lo rompió un commit puntual: el
  tope nunca se aplicó. Decidir si se poda —y con qué criterio de "sin reincidencia", que
  hoy no está registrado en ningún lado— o si la regla se cambia por otra cosa.
  **Decisión del owner (2026-08-11): la delega en el agente.** Es herramienta del harness,
  no producto. Se poda y se reporta en una línea qué salió.
- [ ] **La carrera entre borrar un ítem y agregarlo a una cuenta sigue viva** (backend) —
  el bloqueo nuevo de `obtenerUsoItem` lee `cuenta_lineas` **sin lock** mientras
  `agregarLinea` resuelve el ítem en otra transacción, así que bajo READ COMMITTED las dos
  commitean. Ya no es catastrófico (la línea se muestra marcada, el cobro corta con un 400
  que la nombra y la comanda la incluye), pero el estado se sigue produciendo hacia
  adelante, no solo en datos viejos.

### Decisión de owner (pendiente de implementar)

- [ ] **Anular o reducir una línea ya enviada a cocina** (backend + frontend) — **decidido
  el 2026-08-06: al backlog.** Lo medido, sin interpretar: `quitarLinea` hace `softDelete`
  sin mirar `cantidadEnviada`, y `actualizarLinea` reemplaza la cantidad por un valor
  absoluto sin validar que no baje de lo ya enviado. Ninguno bloquea ni advierte, y el
  frontend **ni siquiera conoce el campo** `cantidadEnviada` (cero ocurrencias en
  `frontend/app`): el botón de tacho está siempre habilitado y sin confirmación. Se
  sirvieron 2 platos, se cobra 1, y no queda rastro de que había comanda despachada.
  Encararlo es definir la regla (¿motivo obligatorio? ¿qué rol aprueba? ¿queda registro?),
  que es terreno donde el mercado ya tiene respuestas (Toast, Square, Lightspeed manejan
  *voids* de ítems despachados) — con la regla del cruce de
  [`investigacion-mercado.md`](investigacion-mercado.md).
  **Decisión del owner (2026-08-08): bloquear por debajo de lo ya enviado.** `quitarLinea`
  rechaza si `cantidadEnviada > 0`; `actualizarLinea` no deja bajar la cantidad por debajo de
  `cantidadEnviada`. El razonamiento: la comida ya se hizo, así que reducirla en el sistema
  la regala **sin registro**. Para anular de verdad tiene que existir un camino con motivo
  (merma o cortesía), no un borrado silencioso — ese camino es lo que falta diseñar, y ahí
  sí entra la investigación de mercado. **No es simétrico con las advertencias de
  `garzones`**: allá el costo era un aviso tardío, acá es plata que sale sin rastro.
- [ ] **El layout de mesas no valida solapamiento** (backend,
  `salones/dto/update-layout.dto.ts`) — dos mesas del mismo salón pueden guardarse en la
  misma posición. No corrompe datos ni bloquea nada: cada mesa sigue siendo direccionable
  por su id, solo queda un plano confuso. No está documentado como regla en
  `docs/features/salones-mesas.md` ni en `docs/PRODUCTO.md`, y definirla exige decidir
  tolerancia o tamaño de mesa. **Prioridad baja.**
  ⚠️ **Corrección al encuadre (medido 2026-08-08): el backend NO puede evaluarlo.** La
  posición se guarda como fracción 0..1 de un contenedor responsivo
  (`salones/entities/mesa.entity.ts` → `posX`/`posY`, `numeric(6,5)`), pero el tamaño se
  dibuja en **píxeles fijos** en el front (`components/salones/MesaNode.vue` → `TAMANO_PX`:
  64/80/96/112, ×1,5 de ancho si es rectangular). El servidor no tiene dimensiones, y el
  solapamiento depende del ancho real del plano: dos mesas que no se pisan en 1920 px sí se
  pisan en 1024. El alto además lo redimensiona el usuario y se persiste en `localStorage`.
  Por eso la entrada apuntaba al DTO (`update-layout.dto.ts`), que es el único lugar donde
  **no** se puede resolver.
  **Decisión del owner (2026-08-08): validar en el frontend, al arrastrar.** Es el único
  lugar donde los píxeles existen. Al soltar una mesa sobre otra, avisar o impedir. Sin
  cambio de esquema ni de contrato. **Limitación asumida:** sigue dependiendo del tamaño de
  pantalla de quien acomodó el plano. La alternativa que la sacaría —guardar el tamaño
  también en fracciones del plano— se evaluó y se descartó por costo (toca esquema, render y
  editor).

### Refutados (no entran al backlog, se anotan para no redescubrirlos)

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

## Revisión final `borrado-ingrediente-extra` (2026-07-28)

Hallazgos de la revisión que cerró la oleada de fixes de `GET /items/:id/uso` +
`remove()`. Ninguno bloqueaba el cierre; se difieren por alcance acotado a esa oleada.

- [ ] **Asimetría de guard entre rutas hermanas** (backend) — `GET /items/:id/uso`
  exige `Items:Eliminar`; la ruta hermana `GET /items/:id/recetas-afectadas`
  (`items.controller.ts:36`) exige solo `Items:Leer`. Es una decisión deliberada (solo
  quien puede borrar necesita ver el impacto del borrado), no un descuido — se anota
  por si el frontend en algún momento quiere el dato de uso fuera del flujo de
  borrado, donde el guard más estricto no aplicaría.
- [ ] **Carrera teórica entre `PATCH /items/:id` y `DELETE`** (backend,
  `items.service.ts`) — bajo READ COMMITTED, un `DELETE` que commitea entre la
  validación de un ingrediente en `PATCH` (edición de receta) y el `INSERT` de su
  fila de `receta_extras_permitidos` deja una fila viva apuntando a un item ya
  muerto. Ventana de milisegundos entre dos escrituras de admin; es la misma clase de
  carrera que ya tienen los tres bloqueos preexistentes (ingrediente, combo, opción).

## Refactor Caja → "Mi caja" / "Cajas" (diferido del brainstorm 2026-07-23)

El refactor separa la operación del cajero (**"Mi caja"**) de la supervisión del encargado
(**"Cajas"**). Se decidió que **"Cajas" arranca solo-lectura**; los poderes de escritura del
encargado se difieren a propósito para no acoplar el refactor de IA/permisos a un cambio de
modelo con implicancias de auditoría. Investigación y cruce de mercado:
[`investigaciones/2026-07-23-gestion-caja.md §6`](investigaciones/2026-07-23-gestion-caja.md).
El refactor de IA/permisos y los sub-proyectos A (arqueo multi-medio), B (cierre ciego) y
C (cierre en dos fases) **ya se entregaron** — ver [`resueltos.md`](resueltos.md). Lo que
sigue son los poderes del encargado que se difirieron a propósito:

- [ ] **Cierre forzado de caja ajena por el encargado** (backend + modelo) — habilitar que
  un usuario con permiso `Cajas` cierre la caja de un cajero que dejó el turno abierto
  (escenario: cajero que se fue de urgencia). Requiere agregar **`cerrada_por`** a la tabla
  `cajas` (quién contó/cerró), distinto de `usuario_id` (de quién es el turno): sin ese
  campo el cierre mentiría sobre quién respondió por el efectivo. Rompe el owner-only del
  cierre bajo permiso `Cajas:Actualizar`. Mercado: la separación de funciones favorece que
  un segundo intervenga en el cuadre.
- [ ] **Aprobación de cierre por umbral de diferencia** (backend + config) — patrón Toast:
  si el over/short del cierre supera un umbral configurable, el cierre del cajero requiere
  aprobación del encargado. Agrega config de umbral por tenant + flujo de aprobación. Más
  fiel al mercado; mayor alcance. Ya no depende de resolver el modelo del esperado (§3,
  **resuelto** por el sub-proyecto A) — el umbral se evaluaría sobre la
  diferencia de cada línea del arqueo multi-medio, ya no sobre un total mezclado que
  inflaba cualquier diferencia.
- [ ] **Ocultar el resultado post-cierre al cajero** (backend + frontend) — en el cierre
  ciego (sub-proyecto B) el cajero **sí** ve su propia diferencia al enviar el conteo (la
  revelación es inmediata, vía el detalle), aunque la caja quede `en_conciliacion`. El
  sub-proyecto C resolvió la conciliación operador→supervisor de §6, pero no
  condicionó la revelación a que solo el supervisor la vea de inmediato — sigue diferido.
- [ ] **Conteo por denominación** (§5/§8.3 de la investigación) — los motivos categorizados
  de diferencia de §5 quedaron **resueltos** por el sub-proyecto C; lo que sigue
  pendiente de §5 es exclusivamente el conteo por denominación de billetes/monedas, sin
  tracking más detallado que [`investigaciones/2026-07-23-gestion-caja.md
  §9`](investigaciones/2026-07-23-gestion-caja.md).

## Endurecimiento para producción (pre-lanzamiento — hoy no hay prod)

El proyecto está en desarrollo y `main` no se despliega, así que nada de esto corre hoy.
Pero el flujo actual (push directo a `main`; CI que corre **después** del push como
detector, no como portón; sin ramas/PRs por decisión de la etapa de dev) **no es seguro
para producción**: un CI rojo hoy es inofensivo porque `main` no despliega, pero el día
que `main` auto-despliegue significaría subir código roto a prod y enterarse tarde. Esta
sección se abre al encarar el paso a producción. Orden = prioridad.

- [ ] **Idempotencia en la creación de venta** (backend + frontend) — decidido 2026-07-27:
  va acá y no antes, porque hoy no hay usuarios que puedan sufrir el doble cobro y es una
  feature con superficie propia (contrato HTTP, tabla, cliente), no un fix. **El problema:**
  no existe clave de idempotencia en ningún endpoint; un doble clic en "cobrar" o un
  reintento del cliente tras un timeout crea **dos ventas completas** — doble descuento de
  stock y doble cobro. El `FOR UPDATE` de inventario evita stock negativo, no la venta
  duplicada, y deshabilitar el botón en el frontend no sobrevive a un timeout de red.
  **Forma:** `Idempotency-Key` generada por el cliente **por intento de cobro** (no por
  carrito), tabla que guarda clave → respuesta, y reproducción de la respuesta original en
  el reintento en vez de recrear.
  ⛔ **La opción barata es la incorrecta:** deduplicar por hash del carrito en una ventana
  de segundos rompe el caso real de dos clientes comprando lo mismo con segundos de
  diferencia — cotidiano en un minimarket o una cafetería. No es un atajo aceptable.
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

## Features diferidas (necesitan spec y decisión de negocio)

No son correcciones ni deuda: son funcionalidad que todavía no existe y que **no se puede
empezar sin una decisión del owner**. Se listan acá para no perderlas, con la pregunta que
hay que responder antes de diseñar. Encararlas es brainstorm → spec → plan, nunca "un rato".

Los otros tres temas de esta clase viven donde los dejó su procedencia, porque el contexto
de dónde salieron es parte del enunciado: **saldo en contra por propina ya liquidada**,
**una persona cobrando en dos grupos** y **devolución por medio de pago con plazos**, los
tres en la sección de auditorías de arriba.

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

