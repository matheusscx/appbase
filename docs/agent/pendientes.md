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

- [ ] **`LineaVentaDto.precioUnitario` — ¿debe permitir `0`? (parcialmente cerrado)**
  (backend, `ventas/dto/create-venta.dto.ts`) — el rechazo de negativos ya se cerró
  (jul-2026): tiene `@IsDecimalNoNegativo()`, que además permite `0`. Lo que sigue
  abierto es si el `0` debería seguir siendo válido o si el owner quiere prohibirlo
  también (podría representar un ítem promocional/gratis, o podría ser una laguna para
  vaciar el `totalFinal` de una línea sin tocar el resto). Decidir `>= 0` (estado
  actual) vs `> 0` (`IsDecimalPositivo`) es una regla de negocio del owner, no algo a
  inferir. Requiere confirmación antes de endurecer más.
- [ ] **El país del tenant se deriva con el mismo JOIN en 11 queries** (backend, ocho
  módulos: `impuestos`, `monedas` ×2, `metodos-pago` ×2, `ventas`, `items` ×2, `propinas`
  ×2, `seeder`) — todas hacen `tenants.provincia_id → provincia.pais_id`. **Idea del owner
  (2026-07-30):** una columna `tenants.pais_id` para buscarlo directo. **Evaluada y
  descartada por ahora**, con dos hechos medidos: (a) `provinciaId` es **mutable**
  (`update-my-tenant.dto.ts:21`), así que la columna copiada se desincroniza en cuanto
  alguien cambie de provincia y olvide actualizarla — y desincroniza justo el país que
  determina el IVA, que es el trade que la spec del IVA derivado rechaza explícitamente;
  (b) **los once JOIN filtran `eliminado_el` de `provincia`**, o sea que el boilerplate es
  correcto: molesta a la vista, no está produciendo bugs. Se reabre si aparece evidencia
  de que duele (una query caliente, o un módulo nuevo que olvide el filtro); el cierre sin
  divergencia sería una **vista `tenant_pais`**, no una columna.
- [ ] **El e2e da fallos masivos falsos si se corre justo después de editar un fuente**
  (harness) — visto **dos veces el 2026-07-28**, con la misma firma: 42 y 46 fallos
  repartidos por media suite, y verde inmediato al repetir. La causa probable —hipótesis,
  no verificada— es que `docker-compose up` corre el backend en **watch mode**: al tocar un
  archivo recompila, re-arranca y **vuelve a correr el seeder**, encima de la suite que ya
  está andando. `reset-db.sh` espera el `Seed complete` de ese arranque, no del siguiente.
  Mitigación que funcionó las dos veces: correr `reset-db.sh` **inmediatamente antes** del
  e2e, sin lint/typecheck/unit en el medio. Cierre posible: que el script espere a que el
  backend quede estable, o correr el e2e contra un stack sin watch.
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

Y dos hallazgos que la feature dejó medidos y no son suyos:

- [ ] **El esquema mezcla `TIMESTAMPTZ` y `TIMESTAMP` sin zona en la misma columna
  lógica, y compararlas depende del `TimeZone` de sesión** (backend, transversal) —
  medido con `information_schema.columns` sobre Postgres real: de las 87 tablas que
  tienen `eliminado_el`, **22 la tienen como `timestamptz` y 65 como `timestamp` sin
  zona** (default de `@DeleteDateColumn()` de TypeORM cuando la entity no fija `type`
  explícito; `receta_extras_permitidos` y sus hermanas con datos propios sí lo fijan y
  quedaron en `timestamptz`). No es un detalle cosmético: un `WHERE` que compara una
  columna de cada tipo sin cast deja que Postgres castee el `timestamp` sin zona
  usando el **`TimeZone` de la sesión que corre la comparación**, no el que estaba
  activo cuando se escribió el valor.
  **Le costó una ronda de revisión a `items.restaurar()`** (`items.service.ts`): la
  primera versión comparaba `items.eliminado_el` (`timestamp` sin zona) contra
  `receta_extras_permitidos.eliminado_el` (`timestamptz`) sin cast. Verificado contra
  Postgres real con `SET TimeZone` en sesiones separadas de escritura y lectura —
  combinaciones UTC↔UTC, `America/Santiago`↔UTC, `America/Santiago`↔`America/Santiago`—:
  **matchea 1 de 3 combinaciones** (solo cuando ambas sesiones comparten `TimeZone`,
  que hoy es siempre porque nada en la app cambia el `TimeZone` de sesión y el default
  del server es UTC). El fix fue anclar los dos lados a UTC explícito
  (`NOW() AT TIME ZONE 'UTC'` al escribir, `... AT TIME ZONE 'UTC'` al leer) en vez de
  confiar en que las sesiones coincidan por casualidad — ver el comentario largo en
  `items.service.ts` (`remove()` y `restaurar()`) para el detalle completo, incluida la
  otra mitad del mismo bug con `timestamptz` de microsegundos perdiendo precisión al
  pasar por un `Date` de JS.
  **Cierre posible:** una migración que uniforme las 65 a `timestamptz` (fuera de
  alcance de esta feature — el proyecto no tiene datos productivos, así que es cambiar
  el esquema y resetear, no un backfill), o dejar el patrón "cast explícito a UTC en
  cualquier comparación cross-tabla" documentado como regla y confiar en revisión.
  ⚠️ **Corregido (Ronda de fixes 1):** la entrada original decía "ningún otro de los
  16 recursos compara timestamps entre tablas" — falso. `salones.restaurar()`
  (`salones↔mesas`) y `grupos-modificadores.restaurar()`
  (`grupos_modificadores↔grupo_modificador_opciones`) también comparan un
  `eliminado_el` contra otro para acotar su colateral. **La razón correcta de por qué
  no sufren el bug no es "no comparan", es que en cada uno de esos dos pares los DOS
  lados comparten tipo** (verificado con `information_schema.columns`): `salones` y
  `mesas` son las dos `timestamp` sin zona; `grupos_modificadores` y
  `grupo_modificador_opciones` son las dos `timestamptz` (así lo documenta el
  comentario de `grupos-modificadores.service.ts` → `restaurar()`). El riesgo real no
  es "comparar timestamps entre tablas" en general — es comparar timestamps **de
  tipos distintos**, que hoy solo pasa en el par `items`/`receta_extras_permitidos`
  de los tres recursos con colateral.
- [ ] **11 de 15 pantallas de la papelera sin cablear en el frontend** (frontend) —
  ⚠️ **Corregido (Ronda de fixes 1):** son 16 recursos backend, pero **15
  pantallas** — `mesas` no tiene página propia, vive dentro de
  `configuracion/salones.vue`, así que no cuenta aparte.
  `configuracion/items.vue`, `configuracion/categorias.vue` y —desde el
  2026-08-01— `configuracion/impuestos.vue` y `configuracion/descuentos.vue`
  tienen el toggle "ver eliminados" y el botón restaurar; las otras 11
  (`recargos`, `grupos-modificadores`, `terceros`, `cajones`, `garzones`,
  `turnos`, `salones` [con sus `mesas`], `impresoras`, `causas-merma`,
  `motivos-diferencia`, `motivos-diferencia-inventario`) quedan sin UI. El molde
  ya está probado en las cuatro pantallas hechas: `usePapelera(recurso)`
  (`app/composables/usePapelera.ts`) da el toggle, `restaurar(id, nombre?)` y
  `formatearBorradoPor(fila)`.
  📐 **Usar `configuracion/descuentos.vue` + `descuentos.nuxt.spec.ts` como
  molde** (antes era `impuestos`): es el más reciente, el único con la salida de
  colisión, y el único cuyos 11 tests se verificaron uno por uno contra el
  mutante que cada uno debería cazar. Para una pantalla SIN unicidad de nombre,
  copiar todo menos el modal de colisión y sus 4 tests. Lo que las rondas de
  revisión corrigieron, y que conviene no volver a romper:
  - **Guard de reentrancia en `restaurar`, y aplica a las 11.** El `CrudModal`
    no se cierra solo al confirmar —lo cierran las funciones de la página—, así
    que mientras el `POST` viaja el segundo click manda un segundo
    `POST .../restaurar` sobre una fila que el primero ya revivió, el backend
    contesta 404 y el usuario ve un toast de **error inmediatamente después de
    un restore exitoso**. Reproducido en la re-revisión.
    ⚠️ **Corregido el 2026-08-01 (medido con mutantes sobre `descuentos`):** una
    versión anterior de esta entrada decía "el `ref` es la protección, el
    `:loading` solo el feedback". **Es falso**: `:loading` deshabilita el botón,
    así que las dos capas se tapan mutuamente y sacar cualquiera por separado
    deja el test en verde — solo sacando las dos se rompe. No es motivo para
    borrar ninguna (el `ref` cubre la función, que en `descuentos` entra también
    por el botón del modal de colisión), pero sí para no creerle a un test que
    "prueba el guard": prueba la conducta, un solo POST.
  - **El fixture del test tiene que estar ELIMINADO** para que una aserción
    negativa (`not.toContain('Restaurar')`, etc.) pruebe algo. Con todas las
    filas vivas esa rama no se renderiza para ninguna y la aserción pasa por
    construcción — pasó en la primera versión de este spec. Regla general:
    toda aserción negativa necesita un ancla positiva al lado.
  - **El badge "Eliminado" se asserta por elemento, no por subcadena.** Un
    `toContain('Eliminado')` sobre el texto de la página queda subsumido por
    "Eliminado por &lt;autor&gt;" y no caza que borren el badge. En
    `categorias.vue` esa línea funciona solo por el género ("Eliminada" vs
    "Eliminado por"): **no copiarla a las pantallas masculinas**, que son casi
    todas las que faltan. ℹ️ `items.nuxt.spec.ts` ya tiene una de esas
    subsumidas, preexistente: cerrarla cuando se toque ese spec.
  ⛔ **Lo que NO hay que copiar de `impuestos`: el guard de `origen`.** Esa
  pantalla tiene filas que el listado de la papelera devuelve pero que **no se
  pueden restaurar** (el catálogo oficial del país). **Medido el 2026-08-01: el
  caso es exclusivo de `impuestos`** y no se repite en ningún otro de los 16 —
  es el único listado que devuelve filas ajenas al tenant (entran por la rama
  `pais_id` del `OR`, `impuestos.service.ts`, mientras `restaurar()` busca por
  `{ id, tenantId }`).
  ⚠️ **Una versión anterior de esta entrada decía lo contrario** —que el caso se
  repetía "en cada recurso con filas `es_fijo`", nombrando `causas-merma`,
  `motivos-diferencia` y `motivos-diferencia-inventario`—. **Es falso**: los tres
  tienen `es_fijo`, pero su `remove()` rechaza la fila fija con 400 antes de
  borrarla, así que **una fila fija nunca puede entrar a la papelera**. Copiar el
  guard ahí produce una condición muerta en el template y un test que no puede
  fallar. La afirmación se había generalizado desde un solo ejemplo sin contar
  los casos, que es el error que esta misma entrada advierte más arriba.
  **Cada pantalla nueva necesita el mismo fix que `items.vue` ya tiene en su
  `eliminar()`:** con el toggle "ver eliminados" activo, el `DELETE` no puede
  quitar la fila del array local — tiene que **recargar el listado**, porque el
  `DELETE` no devuelve `eliminadoEl`/`eliminadoPorNombre` (esos datos solo llegan en
  el próximo `GET ...?incluirEliminados=true`). Sin el fix, la fila desaparece en vez
  de pasar a "eliminada" y el usuario no puede restaurarla sin refrescar la página a
  mano. Ni el build ni el typecheck ven este bug — es un comportamiento de runtime
  del composable `eliminar()` de cada página, no un error de tipos.
  **Y cada pantalla necesita su propio test de página** (el proyecto no testea
  páginas por default, pero el bug de arriba es exactamente la clase de regresión que
  solo un test de página cazaría — build/typecheck/reviews no lo ven, como ya pasó
  una vez con el guard de reentrancia de `items.vue`, ver "Revisión final
  `borrado-ingrediente-extra`" más abajo).
  ⚠️ **Corregido (revisión final `papelera-restaurar-eliminados`):** falta un
  segundo fix, aparte del de `eliminar()` — la **carrera del toggle**. Dos
  toggles rápidos de "ver eliminados" disparan dos `GET` en vuelo; sin
  protección, gana el que responda último y no el que se disparó último (el
  listado final puede quedar desincronizado del switch). `categorias.vue` ya
  la tenía resuelta con una cola serial local (`cargaEnCurso` en `cargar()`);
  `items.vue` NO la tenía — el refetch lo dispara el `watch` de filtros de
  `usePaginatedList`, sin ninguna protección. El fix quedó en el composable
  (`usePaginatedList.ts` → `fetch()`, misma cola serial), porque ahí lo hereda
  cualquier pantalla que ya lo use, sin nada que replicar.
  ⚠️ **Corregido el 2026-08-01, y es el dato que decide el trabajo:** la
  versión anterior de esta entrada decía que `grupos-modificadores.vue` era la
  única de las 13 que usa `usePaginatedList` y que por eso "ya hereda el fix,
  nada que hacer". **Es falso, y de la peor forma**: mandaba a saltear justo la
  pantalla que necesita el arreglo. Medido —`grep` de las llamadas, no del
  import—: `grupos-modificadores.vue` **solo importa el tipo**
  `PaginatedResponse` y tiene su propio `cargar()` (`:309`) sin `cargaEnCurso`.
  **Ninguna de las pendientes usa el composable** (eran 13 cuando se midió; hoy
  quedan 11, las mismas menos `impuestos` y `descuentos`, que ya la tienen), así
  que **todas** necesitan la cola serial local. Los 10 consumidores reales de
  `usePaginatedList` (8 páginas + 2 componentes: `CajaHistorial`,
  `CajaMovimientosTable`, `sesiones-garzon`, `mermas`, `ordenes`,
  `ventas/index`, `configuracion/items`, `pagos/index`, `inventario/index`,
  `inventario/recuentos/index`) no son ninguna de ellas.
  **Las 11 necesitan la MISMA cola serial local que `categorias.vue` ya tiene**
  (`cargaEnCurso` en su `cargar()`): copiar ese patrón, no reinventar uno nuevo.
  Test determinístico por pantalla: promesas controladas que resuelven en orden
  inverso al de los dos toggles, como `descuentos.nuxt.spec.ts` → "papelera: la
  carrera de `cargar()` bajo toggles rápidos". El equivalente de `items.vue`
  ("la carrera del toggle vía usePaginatedList") **no** sirve de molde acá: ese
  ejercita el `watch` del composable, que ninguna de las 11 tiene.

- [ ] **Salida de la colisión: falta replicarla a 7 recursos** (backend) — el 400
  al restaurar dice qué pasa pero, salvo en `descuentos`, no da salida: el usuario
  tiene que ir a renombrar a mano la fila viva. La decisión del owner (2026-08-01,
  documentada en [`papelera.md`](../features/papelera.md) → "Salida de la
  colisión") es que el backend proponga un nombre libre y la pantalla lo ofrezca
  editable. Implementado end-to-end **solo en `descuentos`**; faltan los otros 7
  con unicidad de nombre: `recargos`, `turnos`, `cajones`, `causas-merma`,
  `motivos-diferencia`, `motivos-diferencia-inventario`, `grupos-modificadores`.
  Lo que se replica: `restaurar(tenantId, id, nombreNuevo?)` con
  `@Body() dto: RestaurarDto` en el controller, y un `errorDeColision()` que
  devuelve `{ message, nombreSugerido }`. La aritmética del sufijo **no** se
  reescribe: está en `common/utils/nombre-sugerido.util.ts` y los 8 la comparten.
  Lo que **sí** cambia por recurso es de dónde salen los nombres tomados:
  `descuentos` los lee con un `createQueryBuilder` propio porque no tiene índice;
  los 5 con índice único parcial hoy detectan la colisión capturando el `23505`,
  o sea que **recién sabrían el nombre después de fallar el INSERT** — hay que
  decidir si se consulta antes o se calcula la sugerencia dentro del `catch`.
  ⛔ **`garzones` queda fuera**: su colisión es `uq_garzones_mostrador_tenant`
  (un solo placeholder "Mostrador" vivo por tenant), y renombrar no la resuelve.

- [ ] **`DESCUENTO_CONFIG` no tiene entrada para `directo`** (frontend) — el tipo
  de descuento más básico ("Descuento directo", `codigo: 'directo'` en el seeder)
  no está en el mapa de `app/utils/reglas-form-config.ts`, que solo cubre
  `metodo_pago`, `pronto_pago`, `por_mayor`, `por_monto_venta` y `promocional`.
  Consecuencia: al elegir ese tipo en el drawer de `configuracion/descuentos.vue`,
  `config` queda `null` y **no se renderiza ni modo ni valor** — el form deja
  crear el descuento sin importe, o falla en el backend sin que el usuario vea
  por qué. Encontrado el 2026-08-01 haciendo el smoke de la papelera, no por un
  test: `config` es `null` sin error, así que ni el build ni el typecheck lo ven.
  Fuera del alcance de esa tarea, no se tocó. Verificar de paso si `RECARGO_CONFIG`
  tiene el mismo hueco (sus claves son otras: `general`, `mora`, etc.).

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
  `propinas/liquidacion-propinas.service.ts:1153`) — es la copia hermana de
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

- [ ] **Un descuento, recargo o impuesto desactivado sigue aplicándose** (backend +
  frontend, `calculo-precios.service.ts:50-62` + `items.service.ts:408-419`) —
  `descuentos.findAll` e `impuestos.findAll` no filtran `activo`, `indexarReglas` ni
  siquiera mapea el campo, y al desactivar la regla nadie toca `item_descuentos`.
  **Refutada la mitad peor del hallazgo:** las entidades usan `@DeleteDateColumn`, así que
  una regla **borrada** sí queda excluida por TypeORM — es solo `activo`. Lo que lo vuelve
  bug y no decisión: `items.vue:685` ya filtra por `activo` al ofrecer asociaciones nuevas,
  así que el front la esconde y el back la sigue cobrando.
  ℹ️ **Alcance confirmado el 2026-07-31** (revisión final de ADR-018): también aplica a
  `item_impuestos`. El IVA **no** está afectado —desde ADR-018 ya no pasa por esa tabla,
  se deriva de `clasificacion_tributaria`—, pero los `tipo='otro'` sí: el tenant los
  desactiva desde `/configuracion/impuestos`, el front los esconde del selector y el
  motor los sigue cobrando.
  **Forma decidida por el owner (2026-07-30):** desactivar la regla **advierte** —diciendo a
  cuántos ítems está asociada— y, **al confirmar, limpia las asociaciones**. O sea el cierre
  no es filtrar `activo` en la lectura del motor: es que desactivar sea una operación con
  efecto sobre `item_descuentos` / `item_recargos` / `item_impuestos`, y que el motor deje de
  verla porque la fila puente ya no está. Mismo patrón de UX que el borrado de ítem
  (`GET /items/:id/uso` → modal con el impacto → confirmar), en espejo.
  Lo que la implementación tiene que resolver antes de escribir código:
  - **Contar el impacto** exige la consulta inversa a la de `obtenerUsoItem`: dada una regla,
    qué ítems la usan. Hoy no existe.
  - **Reactivar no revierte**: si el admin vuelve a activar la regla, las asociaciones
    borradas no vuelven solas. Hay que decirlo en la advertencia, no descubrirlo después.
  - ℹ️ **Ya no bloqueado.** La entrada esperaba la decisión transversal del "log de cambios
    reversible" (owner, 2026-07-30) para no comprometerse tabla por tabla. Esa decisión se
    cerró 2026-07-31 como **papelera + restaurar** (ver
    [`resueltos.md`](resueltos.md) § Features diferidas) con alcance acotado a
    **borrados**, y midió que `items.remove()` **no toca**
    `item_descuentos`/`item_recargos`/`item_impuestos` — por eso la papelera no necesitó
    uniformar estas tres puentes. Esta entrada no es un borrado de `items`, es **desactivar
    una regla**, así que la papelera no la resuelve por transitividad, pero sí destraba
    encararla sin esperar nada más grande.
    Lo único que sigue abierto acá, y sigue siendo decisión del owner: ¿el "limpiar" que
    dispara desactivar es `DELETE` físico o soft delete? Medido: las tres puentes
    (`item_descuentos`, `item_recargos`, `item_impuestos`) son puras —2 columnas, PK
    compuesta, sin `eliminado_el`, sin `tenant_id`— y hoy el código ya las borra duro y
    reinserta (`items.service.ts:1670,1682,1694`), a diferencia de sus cuatro hermanas con
    datos propios, que sí tienen `eliminado_el`.
    Detalle a no olvidar cuando se retome: si se agrega `eliminado_el`, la PK
    `(item_id, regla_id)` hace que una fila borrada blando **bloquee reinsertar el mismo
    par** — el patrón actual "borro todo y reinserto" tiene que pasar a revivir o upsert.
  - **Alcance**: además de las tres puentes por ítem, están las reglas a nivel venta
    (`descuentosVentaIds` / `recargosVentaIds`, que llegan por DTO y no tienen fila puente).
    El IVA queda **fuera**: se deriva de `clasificacion_tributaria` y no tiene fila puente
    que limpiar ([ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)).
  - Las ventas ya emitidas **no se tocan**: el hecho fiscal está congelado en
    `ventas_descuentos` / `ventas_recargos` / `ventas_impuestos`.
  ⛔ Toca el motor de cálculo de precios: va con spec antes de código.
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
- [ ] **El recorte de un descuento no queda auditado en ninguna parte** (backend) — cuando
  el piso topea un descuento de 500 a 100, en BD queda un descuento de 100 sin ningún rastro
  de que la regla valía 500; el motivo vive solo en un toast que el cajero puede no leer.
  Para un sistema con ambición fiscal/auditable el **hecho** del tope debería quedar en la
  transacción. Cierre posible: una columna o flag en el detalle de venta.
- [ ] **`online.service.ts` y `suscripciones.service.ts` siguen descartando las
  advertencias del motor de precios** (backend + frontend) — resto de "Las
  advertencias del motor de precios llegan a un solo consumidor", cerrado
  **parcialmente** el 2026-07-28 (ver [`resueltos.md`](resueltos.md)): la
  previsualización de los tres carritos (POS, Salones, Tienda) ya muestra
  `resultado.lineas[].advertencias` y `resultado.advertenciasVenta` antes de
  cobrar. Lo que sigue abierto es la otra mitad de la cadena: `online.service.ts`
  y `suscripciones.service.ts` descartan `resultado.advertencias` al crear el
  pedido/la suscripción (no la persisten ni la devuelven), y `pasarela.vue` no
  lee el campo. Mismo consumidor que el resto de la entrada original: el que más
  lo necesita, porque ahí el cobro ya es irreversible.

## Revisión final `borrado-ingrediente-extra` (2026-07-28)

Hallazgos de la revisión que cerró la oleada de fixes de `GET /items/:id/uso` +
`remove()`. Ninguno bloqueaba el cierre; se difieren por alcance acotado a esa oleada.

- [ ] **El guard de reentrancia de `items.vue` no tiene regresión automatizada**
  (frontend) — el fix de `verificandoEliminarId` ("se borra el item equivocado" si
  una respuesta de `/uso` obsoleta pisa `usoItem`/`confirmDeleteId` de un click
  posterior sobre otra fila) está verificado solo a mano; el proyecto no testea
  páginas. Escenario de reproducción: demorar la respuesta de `/uso` de un item y
  clickear "Eliminar" en otra fila antes de que llegue.
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

## Revisión final `advertencias-previsualizacion` (2026-07-29)

Hallazgos de la revisión que cerró las advertencias del motor de precios en los tres
carritos. Ninguno bloqueaba; el veredicto fue limpio. Se difieren por alcance.

- [ ] **`resultado` y `lineas` se desfasan: el aviso puede quedar bajo la línea
  equivocada** (frontend, los tres carritos) — el cruce línea↔resultado es por índice,
  que es lo correcto, pero **nadie invalida `resultado` cuando cambia el carrito**.
  Es el modo de falla que la regla "nunca cruzar por `itemId`" busca evitar, entrando por
  la puerta de atrás: el índice es estable, lo que no lo es es la pareja. **Preexistente**
  — ya afectaba a `resultado.totales`, que se muestra hace rato; la feature solo lo hizo
  visible porque ahora hay algo atribuido a una línea concreta.
  - POS y Tienda (`useVenta.ts:384-406`, `useTiendaCarrito.ts:45-67`): el `watch` recalcula
    con 300 ms de debounce y `resultado` conserva la respuesta anterior. Reproducción:
    carrito `[A con descuento topeado, B]`, borrar A → el template rinde `[B]` de inmediato
    pero `resultado.lineas[0]` sigue siendo el de A, así que **el aviso de A se dibuja bajo
    B** durante el debounce más el round-trip. Misma ventana al cambiar cantidades.
  - Salones (`salones/index.vue:361-373`): `recalcular()` **no secuencia requests** y se
    dispara desde `syncCuenta` y `patchLineaOptimista`. Reproducción: dos cambios rápidos de
    cantidad generan dos `calcular` solapados; si el viejo resuelve último, `resultado` queda
    apuntando a un set de líneas anterior **hasta la próxima mutación** — ahí la mala
    atribución deja de ser transitoria.

  Encararlo es invalidación + secuenciación en los tres carritos (descartar respuestas
  obsoletas por token de request, y limpiar `resultado` al cambiar de cuenta), no un parche
  en el componente de advertencias.

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

