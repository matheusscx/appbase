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
- [ ] **`LineaVentaDto.precioUnitario` — ¿debe permitir `0`? (parcialmente cerrado)**
  (backend, `ventas/dto/create-venta.dto.ts`) — el rechazo de negativos ya se cerró
  (jul-2026): tiene `@IsDecimalNoNegativo()`, que además permite `0`. Lo que sigue
  abierto es si el `0` debería seguir siendo válido o si el owner quiere prohibirlo
  también (podría representar un ítem promocional/gratis, o podría ser una laguna para
  vaciar el `totalFinal` de una línea sin tocar el resto). Decidir `>= 0` (estado
  actual) vs `> 0` (`IsDecimalPositivo`) es una regla de negocio del owner, no algo a
  inferir. Requiere confirmación antes de endurecer más.
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
---

## Suite E2E de navegador (fundación lista, flujos por escribir)

Scaffold Playwright ya funciona (`frontend/e2e/`, auth vía storageState, 1 smoke verde).
Escribir los flujos críticos, cada uno con aserciones derivadas de `docs/features/`
(NUNCA del output del código), `@smoke` en el subconjunto barato, cero esperas fijas:

- [ ] Venta completa hasta documento (afecto + exento; total contra `docs/features/ventas.md`).
- [ ] Pago mixto (múltiples métodos; vuelto solo si `permite_vuelto`).
- [ ] Nota de crédito (referencia a la venta original).
- [ ] Apertura/cierre de caja (reloj congelado; `diferencia` calculada por el sistema).
- [ ] Descuento de stock en una venta (movimiento + saldo materializado).
- [ ] **Cambio de tenant sin fuga de datos** (el más valioso — ninguna prueba unitaria
  lo cubre; login como usuario multi-tenant, verificar aislamiento de catálogo/ventas).
- [ ] Integrar `@smoke` al CI cuando haya masa crítica (hoy el CI no levanta el stack
  de navegador).

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

**De la feature de pausa (2026-08-03)**, dos que quedaron abiertos a conciencia y no por
olvido:

- **E2E de salones: cobrar una cuenta con un ítem que se pausó después de cargarlo.** El plan
  lo pedía. No existe ningún `salones.e2e-spec.ts` del que partir, y montar mesa + cuenta +
  cierre a ciegas —sin poder ejecutarlo en el momento— era escribir algo que parece cobertura
  sin serlo. El comportamiento **no** se tocó (`getItemVendibleOrThrow` sigue igual), así que
  el riesgo es de regresión futura, no de bug presente.
- **No hay E2E de que una regla pausada no quede congelada en `ventas_descuentos`.** El plan
  lo pedía. El comportamiento es correcto por construcción —el congelado sale de las trazas y
  una regla pausada no deja traza—, pero eso lo sostiene un razonamiento, no un test.
- **El filtro de ítems pausados en los tres catálogos de venta no tiene test.** `pos.vue`,
  `tienda/index.vue` y `salones/index.vue` no tienen `.nuxt.spec.ts` y montarlas exige stores
  de caja, unidades e impresoras. Es una línea por pantalla y hoy nada la sostiene.
- ℹ️ **Caveat preexistente, no introducido por esa feature:** los tres catálogos piden
  `pageSize=100` y el filtro corre **después**, así que un ítem pausado sigue ocupando un lugar
  de esos 100. El tope ya truncaba antes; esto no lo empeora ni lo arregla.

**Ramas sin cobertura alguna**, para decidir si entran: `HORAS_TRABAJADAS`;
`advertenciasSesionesAbiertas` con `fin_el = null`; las guardas `fechaHasta <= fechaDesde`,
`gruposConfig.length === 0` y moneda oficial ausente; `aplicarCambioParticipante` (alta
manual); `actualizar` con `recalcular: false`; los endpoints HTTP `confirmar`/`anular`;
el rechazo de `peso <= 0` en `MANUAL/PESOS`; el spillover de propina entre pagos en
`asignacion-propina.ts`; toda la capa SQL de `propina-reportes` (cero e2e);
`registrarMovimientoEnTransaccion`; el backstop 23505 de `abrir()`; y el aislamiento
multi-tenant de caja.

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
- [ ] **`categorias` y `terceros` pausados: el front los esconde, el backend acepta la
  asignación** (backend, medido 2026-08-03) — hermano menor de la entrada de reglas pausadas
  que se cerró ese mismo día (ver [`resueltos.md`](resueltos.md)), pero sobre entidades que se
  **referencian**, no que se aplican: no cambian ningún monto, por eso quedó fuera de aquel
  alcance.
  Medido: `ClienteForm.vue:34` filtra `terceros` por `activo` y `items.vue:798` filtra
  `categorias`, pero ningún service del backend lee el campo, así que un POST/PATCH directo
  puede asignar una categoría o un tercero pausado.
  ⚠️ Acá "ignorar" **no** puede significar romper el vínculo existente: un ítem no pierde su
  categoría porque la categoría se haya pausado. Lo que corresponde es **rechazar la
  asignación nueva**, y dejar en paz las que ya existen.
  Sin decidir: si el rechazo es 400 o si se ignora en silencio.
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

- [ ] **¿Con qué criterio se ordenan los descuentos de un ítem?** (backend,
  `items.service.ts` → `cargarReglasPorIds`, y `calculo-precios.engine.ts:239`) — en modo
  `compuesto` cada regla se aplica sobre el acumulado de la anterior, así que el orden
  cambia el total. Donde más se nota es al mezclar `monto_fijo` con porcentaje: un ítem de
  1.000 con un 20% y un fijo de 100 da 700 si el % va primero y 720 si va primero el fijo.
  Entre porcentajes la composición es multiplicativa (`acc × (1-v)`), así que con **dos**
  reglas el resultado es idéntico; con **tres o más**, el redondeo por paso
  (`calculo-precios.engine.ts:237`) puede mover el último decimal de `escala_calculo`
  — verificado con contraejemplo, no deducido: neto `4869.7278` con `0.441 / 0.1205 /
  0.3833` da `3393.252159` en un orden y `3393.252158` en otro. Es 1e-6, muy por debajo del
  centavo, pero no es cero: no asumir que un carrito solo-porcentajes es insensible al orden. Hoy ese orden
  no está definido en ninguna query y **la tabla puente no tiene timestamp** (solo la PK
  compuesta), así que "el orden en que el usuario los agregó" no existe ni se puede
  recuperar. El batch de 2026-07-28 fijó `ORDER BY` por id solo para que sea
  **determinista**, no porque sea el criterio correcto — y verificado con `EXPLAIN`, ese
  orden **no** es el que las queries por ítem devolvían antes (`Bitmap Heap Scan` → orden de
  inserción). Hoy da igual porque ambos tenants del seed están en `base` y ningún ítem tiene
  dos reglas de la misma clase; la decisión sigue pendiente.
  **Insumo de mercado que aportó el owner (2026-07-28) — a cruzar, no a copiar** (regla en
  [`investigacion-mercado.md`](investigacion-mercado.md)): los e-commerce suelen darle a
  cada descuento una **prioridad configurable** y aplicarlo sobre el subtotal resultante del
  anterior, con un escalonado típico de ítem → cliente (VIP, convenio) → cupón → medio de
  pago → cashback/puntos. La alternativa "primero el menor" no aporta para porcentajes;
  donde sí es regla de negocio es al separar por **tipo** (obligatorios → promociones →
  cupones). El owner se inclina por prioridad explícita por ser lo más flexible para una
  pasarela/cobranza. **Encararlo es brainstorm → spec → plan:** agrega un campo a las reglas,
  toca el motor y necesita decidir qué pasa con las reglas existentes sin prioridad.
  **Decisión del owner (2026-08-08): investigación de mercado ANTES de diseñar.** Cómo
  resuelven el apilado de descuentos los POS maduros (Toast, Square, Lightspeed): si definen
  un orden, si lo hacen configurable por comercio, o si directamente prohíben apilar. Es
  **insumo para cruzar y adaptar, no verdad a copiar** — regla del cruce en
  [`investigacion-mercado.md`](investigacion-mercado.md). Recién con eso sobre la mesa se
  elige entre las tres formas que ya están sobre la mesa: columna `orden` en la tabla puente
  con reordenamiento en la UI del ítem, regla fija en el motor (p. ej. porcentajes antes que
  fijos), o dejarlo y documentar que el orden no significa nada.
  ⛔ Sigue tocando el motor de precios: no se avanza sin volver a confirmar con el owner
  después de la investigación.
- [ ] **¿Un descuento debe topearse aunque un recargo posterior levante el total?**
  (backend, `calculo-precios.engine.ts`) — el piso en cero (2026-07-28) topea **regla por
  regla** contra el acumulado en ese punto de la fórmula. Con fórmula `descuentos →
  recargos`, neto 1000, descuento fijo 1200 y recargo fijo 2000: sin tope el total daba
  1800 (positivo); con tope da 2000, o sea el cliente paga 200 más en una venta que nunca
  fue negativa. La regla que decidiste habla del **total**, no del acumulado intermedio, así
  que topear por regla es más estricto que lo pedido. La alternativa —topear recién al
  final— rompe la coherencia de la traza, que es lo que el diseño actual protege.
  Lo detectó la revisión independiente con un fuzz de 20.000 ventas. Es raro (exige un
  descuento fijo mayor al neto **y** un recargo posterior que lo levante), por eso no se
  resolvió sobre la marcha.

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

Los de `actualizarLinea` y `quitarLinea` se cerraron con el fix de la línea que se cuela
([`resueltos.md`](resueltos.md)). Quedan:

- [ ] **`fusionarCuentas` no tiene NINGÚN e2e, y su SQL solo se ejercita mockeado**
  (backend) — medido: `grep -rn "fusionar" backend/test/` no devuelve nada, y el único test
  que recorre ese camino mockea `manager.query`, así que **no llega SQL a Postgres**.
  No es teórico: el 2026-08-07 un `SELECT` nuevo de esa ruta filtraba `eliminado_el` sobre
  `item_producto`, que no tiene esa columna. Habría reventado la fusión con un 500
  sosteniendo el `pessimistic_write` de todas las cuentas de la mesa, y el gate entero
  —1490 unit, 321 e2e, lint, typecheck— pasó en verde igual. Lo cazó la revisión
  independiente corriendo la query contra la BD.
  El caso mínimo: dos cuentas con líneas del mismo ítem, con presentación, fusionar y
  verificar la cantidad y la presentación resultantes.
- [ ] **El agrupado por estación de la comanda no lo ejercita ningún dato real, y el seed
  no lo permite** (backend) — descubierto al hacer el smoke del 2026-08-06:
  `agruparEstacionesComanda` siempre devuelve `[]` con el seed, así que hubo que cablear
  una categoría a mano por SQL para poder verificar la comanda. Sin fixture no hay e2e
  posible del camino que manda a cocina.
  **Corregido el 2026-08-07 con lo medido contra la BD sembrada** (la entrada culpaba a la
  causa equivocada): la categoría **sí existe y sí tiene impresora** — "Ropa y accesorios"
  → impresora "Cocina", puesta a propósito en `seeder.service.ts` con ese comentario. Lo
  que falta es que **algún ítem vendible esté en ella**: hoy tiene 0 ítems, y el único
  ítem con categoría del seed está en "Electrónica", que no tiene impresora. El arreglo es
  entonces asignar `categoriaId` a un ítem del seed, no crear categoría ni impresora.
  Lo que hace valiosa la entrada es que **hoy no hay nada** cubriendo ese camino: los
  únicos tests que afirman sobre `estaciones` son unitarios con el SQL mockeado
  (`salones.service.spec.ts`), así que no ven el fixture. Medido: `grep` de `comanda` y
  `estaciones` sobre `backend/test/` y `frontend/e2e/` no devuelve nada.
- [ ] **El computed `cuentaConItemEliminado` no tiene cobertura** (frontend,
  `pages/salones/index.vue`) — mutante que pasa: `computed(() => false)`, con el frontend
  entero en verde. Verificado a mano en el navegador el 2026-08-06.
  **2026-08-07: la mitad cara de esta entrada ya no aplica.** Decía "las páginas no tienen
  unit tests"; ahora existe `pages/salones/index.nuxt.spec.ts` (creado para el guard de
  reentrancia), con el arnés de montaje ya resuelto —mock de `useApiFetch`, selección de
  mesa, teclado de PIN real— así que cubrir esto es agregar un `it`, no montar la página.
  Lo que sigue faltando y es propio de este computed: un fixture de cuenta **con una línea
  de ítem eliminado**, que el mock actual no produce. `frontend/e2e` sigue sin cubrir
  salones.

### Lo que dejaron las revisiones independientes del cierre

- [ ] **`/garzones/verificar-pin` es un oráculo de PIN sin throttling, y el fix del selector
  lo abarató 20×** (backend, `garzones.controller.ts`) — el endpoint dice si un PIN
  pertenece a **un garzón concreto**, sin ejecutar nada y sin límite de intentos. Antes de
  2026-08-08 un intento costaba N bcrypt y se probaba contra los N garzones a la vez; ahora
  cuesta 1 y apunta a uno solo. Recalculado: agotar 10⁶ contra un garzón concreto pasa de
  ~14 días de CPU a **~17 h**. Comprometer a *alguno* cuesta casi lo mismo que antes, así
  que **no es una regresión**, pero la cifra de "no es un vector práctico" que quedó
  archivada en [`resueltos.md`](resueltos.md) ya no aplica al caso dirigido. El rate
  limiting existente está acotado a `/auth/*` y no cubre esto. Decidir si `Salones:Operar`
  —que ya es un permiso de confianza— alcanza como barrera, o si hace falta límite por
  garzón.

- [ ] **Modo personal: el garzón con su propia tablet no debería teclear el PIN** (backend +
  frontend) — **Fase 2 del plan `2026-08-08-elegir-garzon-antes-del-pin.md`, diseñada y
  diferida el 2026-08-08.** El vínculo opcional `garzones.usuario_id` + `usuarios_tenants.
  es_totem` como marcador **explícito** del modo (no inferido: una cuenta marcada como tótem
  no puede volverse personal aunque alguien la vincule por error). Todo el diseño está en el
  plan, incluidas las cuatro preguntas ya resueltas.
  **Bloqueada por una feature que no existe:** el alta de usuarios del tenant por el admin.
  Medido: `POST /tenants/members` recibe un `usuarioId` **que ya existe**, la pantalla de
  usuarios solo asigna roles, y el único camino a una cuenta es `POST /auth/register`
  **público**. Habilitar un garzón personal hoy cuesta 4 pasos en 3 pantallas y arranca con
  un auto-registro. Por eso se difirió: sería un camino que casi nadie puede recorrer.

- [ ] **`anti-patterns.md` pasó su propio tope de 20 entradas y nadie podó** (docs,
  `docs/agent/anti-patterns.md:14`) — la regla 3 del archivo dice *"Tope: 20 entradas. Si se
  llena, la más antigua sin reincidencia se elimina"*. Medido el 2026-08-07: **25** entradas
  `### ❌`. Ya estaba en 23 antes de esa tanda, así que no lo rompió un commit puntual: el
  tope nunca se aplicó. Decidir si se poda —y con qué criterio de "sin reincidencia", que
  hoy no está registrado en ningún lado— o si la regla se cambia por otra cosa.
- [ ] **Dos `describe` viejos de `garzones.nuxt.spec.ts` desmontan al final del test, no en
  `afterEach`** (frontend, `app/pages/configuracion/garzones.nuxt.spec.ts`) — de los cuatro
  preexistentes, *"papelera: eliminar respeta el toggle"* y *"papelera: restaurar"* leen
  `document.body` (los diálogos se teletransportan), así que un test que falla antes de su
  `unmount()` deja la pantalla montada y contamina al siguiente. Los otros dos solo
  consultan el wrapper y no están afectados. Es exactamente el modo de falla que documenta
  la entrada *"Sacar conclusiones de un mutante
  sin aislar los tests entre sí"* de `anti-patterns.md`, medido el 2026-08-07: un mutante
  que debía matar 1 test mató 2. El `describe` nuevo de advertencias ya usa `afterEach`; los
  viejos quedaron sin convertir porque era refactor fuera del alcance de ese commit. Mientras
  no se conviertan, **cualquier mutante que se corra sobre ese archivo puede dar una señal
  inflada**.
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
- [ ] **Rate limiting** (backend) — hoy no hay throttling; los endpoints de auth
  (`POST /auth/login`, `/auth/refresh`) son brute-forceables. Agregar `@nestjs/throttler`:
  límite global por IP + límite estricto en auth. Cuidado multi-tenant: la key de rate limit
  no debe filtrar entre tenants ni permitir que un tenant agote la cuota de otro. Considerar
  store compartido (Redis) si corre en varias instancias — el límite en memoria no sirve tras
  un load balancer.
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
- [ ] **Health/readiness + graceful shutdown** (backend) — endpoint `/health` para el
  orquestador (readiness real: chequea la BD), y cierre ordenado de conexiones al recibir
  SIGTERM para no cortar requests en vuelo durante un deploy.
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

