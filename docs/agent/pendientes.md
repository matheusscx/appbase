# Pendientes — a corregir al terminar el harness

Backlog de correcciones que se **difirieron a propósito** mientras trabajamos en el
harness, para no mezclar el meta-trabajo (reglas, gates, docs) con cambios de código de
producto. Cada entrada dice qué, dónde, por qué se difirió y cómo se cierra.

> 🔴 **Antes de tomar cualquier entrada de este archivo, leé la sección
> ([🧱 tanda propia](#-prioridad-máxima--tanda-propia-conexiones-rendimiento-y-redondeo-de-plata)).**
> Es prioridad máxima y agrupa tres temas que solo se pueden resolver juntos y aislados.

Regla de este archivo: **acá solo vive lo que falta hacer.** Cuando una entrada se cierra,
en el mismo commit se muda —con el texto de su cierre— a
[`resueltos.md`](resueltos.md). Nada de `[x]` acumulándose: una lista de trabajo con más
entradas tachadas que vivas deja de leerse. No es un TODO genérico: solo va lo que ya
identificamos con ubicación concreta.

## Cómo está ordenado (reordenado el 2026-08-15)

**Por lo que hace falta para poder tomar la entrada, no por de qué pasada salió.** El orden
anterior agrupaba por origen —cuál auditoría la encontró—, que sirve para entender el
contexto y **no sirve para elegir qué hacer ahora**: había que leer las 60 entradas para
saber cuáles se podían tomar sin preguntar nada.

| Sección | Qué hace falta para tomarla |
|---|---|
| 🔴 Tanda propia | Nada, pero van las tres juntas y con el sistema quieto |
| 1. Mecánico | Nada: el arreglo ya está decidido y escrito en la entrada |
| 2. Medir primero | Abrir un archivo o correr algo. No es una pregunta para el owner |
| 3. Ya decidido, falta construir | Nada del owner: ya contestó. Es trabajo con diseño adentro |
| 4. Necesita que el owner conteste | Una respuesta, que está al frente de cada entrada |
| 5. Carreras de concurrencia | Un análisis de orden de locks, común a las tres |
| 6. Proyectos que van solos | Spec propia. No entran de arrastre en otra tarea |
| 7. Acción del owner fuera del código | Algo que no se resuelve programando |
| Endurecimiento para producción | Nada hoy: se abre al encarar el paso a prod |
| Vigilancia | **No es trabajo.** Evaluado y descartado; se anota para no redescubrirlo |
| Contexto de las pasadas de auditoría | Nada: es memoria de qué se auditó y con qué resultado |

El contexto de origen no se perdió: el encabezado de cada pasada —con sus números, lo que
salió limpio y los hilos que cerró— vive al final del archivo.

---

## 🧱🔴 PRIORIDAD MÁXIMA — tanda propia: conexiones, rendimiento y redondeo de plata

> 🔴 **Lo más importante que hay abierto en este backlog.** Decisión del owner
> (2026-08-11). Está primero en el archivo a propósito: **cuando se retome el backlog, esto
> va antes que cualquier otra entrada**, incluidas las 🚩 de producción de más abajo. Una de
> las tres —el deadlock de conexiones— es la única entrada del repo que puede dejar la API
> muerta con diez operaciones simultáneas.

**Estas tres NO se tocan de a pedazos ni de arrastre dentro de otra tarea. Van juntas, en
una pasada dedicada, con el sistema quieto.**

Qué agrupa:

| Tema | Entrada |
|---|---|
| Conexiones / deadlock | 🚩 *"Diez ventas simultáneas cuelgan la API para siempre"* (más abajo) |
| Rendimiento | *"N+1 al resolver personalización de recetas/combos"* `[~]`, y lo que aparezca al medir |
| Redondeo de plata | *"Cuatro redondeos de plata más que siguen en HALF_UP fijo"* (abajo), con su sub-punto de `subtotal`/`total_linea` entrando a `NUMERIC(18,4)` |

**Por qué juntas, y no cada una cuando toque.** Las tres viven en la misma superficie —el
camino caliente de la venta y el motor de precios— y las tres se miden de la misma forma:
con carga real, no leyendo código. El deadlock **se descubrió midiendo el N+1**, no
buscándolo. Y decidir el redondeo de un total exige saber antes en qué orden y con qué
escala se acumulan las líneas, que es la misma pregunta que responde el análisis de
rendimiento.

**Por qué en aislamiento, con evidencia de este mismo día:**
- El arreglo del redondeo se hizo **por partes** y hubo que revertirlo: cubría el precio que
  se muestra y no el que se guarda, y de paso abría una divergencia entre lo cobrado a la
  tarjeta y lo persistido que antes no existía (ver [`resueltos.md`](resueltos.md)).
- La tabla de sitios del deadlock quedó **stale dos veces en el mismo día**, las dos porque
  una tarea de feature corrió las líneas de `ventas.service.ts` por encima.

Mientras tanto: si una tarea de producto **necesita** tocar algo de esta lista, se anota acá
y se consulta — no se resuelve de paso. Un N+1 nuevo que se introduzca sí se saca en el
momento; lo que se difiere es abrir estos tres frentes.

### Las tres entradas, íntegras

Estaban repartidas por el archivo con punteros cruzados entre sí. Acá están las tres, en
el orden de la tabla de arriba.

- [ ] 🚩 **Diez ventas simultáneas cuelgan la API para siempre** (backend, medido
  2026-08-11) — **el hallazgo más grave abierto hoy.**
  🧱 Va con las otras dos de esta sección: rendimiento y redondeo.
  No es lentitud: las requests no vuelven nunca y el proceso queda envenenado (las
  siguientes también cuelgan, aunque el cliente corte). Se descubrió midiendo otra cosa
  —el N+1 de recetas, la entrada de más abajo— y no lo veía ningún test porque el e2e
  corre con `maxWorkers: 1`.
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
  | `ventas.service.ts` | 310 | `calculoPreciosService.cargarConfig` |
  | `ventas.service.ts` | 379 | `calculoPreciosService.calcular` |
  | `ventas.service.ts` | 649, 663 | `catalogService.crearConversor` |
  | `ventas.service.ts` | 714 | `garzonesService.obtenerActivoPorId` |
  | `ventas.service.ts` | 1020 | `cajaService.findActiva` (otra transacción) |
  | `items.service.ts` | 1477, 2044 | `catalogService.convertirUnidad` |
  | `items.service.ts` | 3823, 3879, 4117 | `catalogService.crearConversor` |
  | `salones.service.ts` | 1013 | `sesionesGarzonService.buscarSesionAbierta` |
  | `pagos.service.ts` | 356 | `cajaService.findActiva` |
  | `mermas.service.ts` | 124 | `catalogService.convertirUnidad` |
  | `grupos-modificadores.service.ts` | 910 | `catalogService.convertirUnidad` |
  | `cobros.service.ts` (pasarela) | 289 | `tenantPasarelaService.resolverPorId` — **pide dos** |

  ⚠️ **Las líneas de `ventas.service.ts` se corrigieron el 2026-08-11** (el arreglo del
  redondeo de moneda las corrió) y se sumó `cargarConfig`, que es una toma más pero **no
  sube el pico**: reemplaza a la que `calcular` hacía por dentro. Son 21 sitios.
  Se corrigieron **dos veces ese mismo día**: la primera tanda quedó stale enseguida porque
  el arreglo siguiente agregó comentarios encima. Si tocás `ventas.service.ts`, revisá esta
  tabla al final, no al principio — una cita stale que además se anuncia como verificada es
  peor que una stale a secas.

  Los 21 se verificaron uno por uno contra el destino: todos terminan en un
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

- [~] 🧱 **N+1 al resolver personalización de recetas/combos** (la segunda de esta
  sección) — parcialmente cerrado
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
  deadlock de diez ventas simultáneas, acá arriba en esta misma sección. Batchear no lo
  arregla.

- [ ] **Cuatro redondeos de plata más que siguen en HALF_UP fijo, sin `modo_redondeo`**
  (backend, **medido 2026-08-11 por la revisión del cierre de la conversión de moneda**)
  — 🧱 **la tercera de esta sección: no se toca suelta.**
  se abre esta entrada justo porque la que se cerró ese día, leída de más, los tapaba: el
  arreglo alcanzó la cuenta `precio × tasa` y **nada más**.
  - `inventario.service.ts` → **CPP** (`valorPrevio + valorEntrante` ÷ stock). Es una
    **división**, así que redondea de verdad, y el resultado se persiste en
    `item_producto.costo_actual`.
  - `items.service.ts` → `costoPropuesto` de una receta (`ROUND_HALF_UP` explícito).
  - `propinas/utils/mayores-restos.ts` → el reparto de propina entre garzones.
  - `mermas.service.ts` (dos sitios) → costo × cantidad.
  - `inventario.service.ts:818-821` → `cantidad × costoUnitario` del kardex. **Agregado el
    2026-08-15 por la lente de dinero de la auditoría de `inventario`**, que lo encontró
    buscando otra cosa. Es el mismo mecanismo sin consecuencia nueva, así que no abre entrada
    propia — pero el título de arriba dice "cuatro" y **son cinco**: quien tome esta entrada
    tiene que barrer, no ir a la lista.

  Antes de replicar el arreglo: **el criterio no es obvio y puede no ser el mismo**. El de
  la conversión se decidió porque el valor se persiste en `NUMERIC(18,4)`; el reparto de
  propinas usa mayores restos justamente para que la suma de las partes dé el total, y ahí
  cambiar el modo puede romper esa propiedad. Cada uno pide su análisis.

  ➕ **En la misma familia, y más incómodo:** `subtotal`, `descuento_aplicado`,
  `total_linea` y los totales de cabecera llegan del motor con `escala_calculo` decimales
  (6 por default) y entran a columnas `NUMERIC(18,4)`. **Hoy ese recorte lo hace Postgres**
  — que es exactamente el escenario que el docblock de `convertirAMonedaOficial` describe
  como "lo que hay que evitar". Que ahí sea así y en la conversión no, es una inconsistencia
  real; no se tocó porque queda fuera de lo que el owner pidió ("las conversiones a moneda
  oficial") y porque cambiarlo mueve importes ya persistidos de forma.

---

## 1. Mecánico — no hay nada que preguntar ni diseñar

El arreglo ya está decidido y escrito dentro de la propia entrada: **ninguna necesita una
respuesta del owner.** Ordenadas de más barata a más cara — las dos primeras son una
edición de texto; **las dos últimas no son teclear**, son escribir tests que hoy no existen
(un e2e con un ítem en otra moneda, y el arnés de tres specs de página). El material para
una tanda de una sentada empieza arriba, y **va después de la 🔴**.

- [ ] **`mermas` nunca recibió el fix de moneda que su gemelo `inventario` sí tiene: el mismo
  monto se lee distinto según la pantalla** (backend + frontend, auditoría `inventario`
  2026-08-15) — `inventario.service.ts:752` trae `i.moneda_id` en el `SELECT` del kardex, con un
  comentario que explica el porqué (*"el kardex global mezcla ítems de distintas monedas: sin
  esto la UI formatea todo costo con la moneda oficial del tenant"*), y `inventario/index.vue`
  lo consume pasando `row.original.monedaId` como segundo argumento de `formatMonto`.
  `mermas.service.ts` tiene **cero ocurrencias** de `moneda_id` (medido) y `mermas.vue:336,338`
  llama `formatMonto(...)` con un solo argumento, así que cae en la moneda oficial del tenant.
  **Lo mismo, medido:** `inventario/index.vue:273` formatea `costoPerdido` —un campo de merma—
  **con** la moneda del ítem; `/mermas` formatea **ese mismo campo** sin ella. Un ítem importado
  en USD muestra su merma como si fueran pesos en una pantalla y no en la otra.
  Es mecánica porque **el fix ya está escrito en el módulo gemelo**: agregar `i.moneda_id` a los
  dos `SELECT`, el campo a `MermaListItem`, y el segundo argumento en las tres llamadas del
  `.vue`. Sin decisión de por medio.

- [ ] **Se puede dejar sin nombre una causa de merma o un motivo de diferencia editándolos**
  (backend, auditoría `inventario` 2026-08-15) — `update-causa-merma.dto.ts` y
  `update-motivo-diferencia-inventario.dto.ts` declaran `@IsString() @IsOptional()
  @MaxLength(120)` **sin `@IsNotEmpty()`**, que sus DTOs de creación hermanos sí tienen. Los
  services solo hacen `if (dto.nombre !== undefined)` —verdadero para `''`— y persisten el
  `.trim()`. El `required` del `UFormField` en las dos pantallas es cosmético: el `UForm` no
  recibe `:schema` ni `:validate`, así que no bloquea el submit. Resultado: la fila queda con
  nombre vacío y aparece como una opción sin etiqueta en el selector de causa de `mermas.vue` y
  en el override de línea de `recuentos/[id].vue`. Dos DTOs gemelos, un decorador cada uno.

- [ ] **El e2e del simulador de costos acepta cualquier precio con tal de que no sea el viejo**
  (backend/tests, auditoría `inventario` 2026-08-15) —
  `simulador-costos.e2e-spec.ts:150-151` cierra con `expect(body.costoActual).not.toBe('1200.0000')`
  y `expect(body.precioBase).not.toBe('3500.0000')`. Un precio recalculado mal pasa igual: la
  única forma de fallar es que el valor no haya cambiado en absoluto. El test ya tiene a mano el
  valor esperado; falta compararlo contra él en vez de contra el anterior.

- [ ] **El e2e de mermas nunca comprueba que el stock haya bajado** (backend/tests, auditoría
  `inventario` 2026-08-15) — `mermas.e2e-spec.ts:116-135` afirma `causaNombre`, `costoUnitario` y
  `costoPerdido > 0` sobre la respuesta del `POST`, y ningún `GET` posterior vuelve a leer el
  stock. Es la única capa que corre contra Postgres real, así que el efecto de una merma sobre el
  saldo no está fijado por nada de extremo a extremo. **El arreglo es un `expect`, no un
  escenario nuevo:** la respuesta ya trae `stockResultante` (está en el tipo `MermaResponse` del
  propio spec, línea 24) y el test no lo mira.

- [ ] **El reintento por deadlock de `RecuentosService.aplicar` no lo ejercita ningún test**
  (backend/tests, auditoría `inventario` 2026-08-15) — `recuentos.service.ts:478-489` atrapa
  `QueryFailedError` con `code === '40P01'` y reintenta una vez. Medido: **cero** ocurrencias de
  `40P01`, `QueryFailedError` o `deadlock` en las 754 líneas de `recuentos.service.spec.ts`, así
  que borrar el `try/catch` entero deja la suite en verde. A diferencia de casi todo lo demás de
  concurrencia, este **no necesita concurrencia real** para cubrirse: alcanza con mockear
  `aplicarEnTransaccion` para que lance un `QueryFailedError` con ese code en la primera llamada.

- [ ] **La única barrera de tenant de las salidas por serie y lote no tiene ningún test**
  (backend/tests, auditoría `inventario` 2026-08-15) — `inventario.service.ts:463-468` rechaza una
  unidad que no pertenece al tenant o al ítem, y `:611-613` hace lo propio con el lote. Los
  `unidadIds`/`loteId` llegan del body del cliente, así que esos `if` son la defensa, no una
  redundancia. `inventario.service.spec.ts` ejercita el camino de serie (FIFO automático,
  disponibilidad insuficiente) pero **ninguna de las dos validaciones de pertenencia**.
  ℹ️ No contradice a la lente de multi-tenant, que salió limpia: ahí se verificó que los 16
  llamadores de `registrarMovimiento` validan el ítem antes. Esto es el escalón de adentro, que
  existe justamente porque el `unidadId` no pasa por esa validación.

- [ ] **El paso 4 de la prueba manual de `garzones.md` salta el requisito de entrar a turno: el
  selector sale vacío si se sigue al pie de la letra** (docs + frontend, **medido 2026-08-15,
  hueco preexistente a esta feature**) — el paso 4 de
  [`garzones.md` → Testing → Manual](../features/garzones.md#manual-frontend) dice "Salones →
  abrir cuenta: PIN correcto abre la cuenta" sin mencionar antes "entrar a turno". Pero
  `GarzonPinModal` pide el selector con `garzonesApi.paraSelector(props.enTurno)`, y "abrir
  cuenta" usa el default `enTurno: true` (`GarzonPinModal.vue:19`) — o sea que solo lista
  garzones **con sesión de turno abierta**. Si nadie entró a turno todavía (el seed no abre
  sesiones), el selector sale vacío y el paso no se puede completar tal como está escrito. **No
  hay mitigación:** `toastErrorOperativo` (`salones/index.vue:308-325`) solo reacciona a un
  request que vuelve con el error "sesión de trabajo" — y con el selector vacío no hay garzón
  que elegir, así que no se dispara ningún request y ese fallback nunca corre. El paso 4 queda
  bloqueado sin salida hasta que alguien edite el manual (agregar "entrar a turno" antes) o
  entre a turno por su cuenta antes de seguirlo.

- [ ] **La spec del testigo promete un conteo a ciegas sin excepciones, y el producto tiene una**
  — cola de la entrada cerrada por la task 6b (ver `resueltos.md`). El admin del tenant sigue
  exento del ciego incluso forzando el cierre de una caja ajena (decisión explícita del owner
  2026-08-13), pero
  [`2026-08-11-testigo-cierre-forzado-design.md`](../superpowers/specs/2026-08-11-testigo-cierre-forzado-design.md)
  sigue diciendo *"cuenta a ciegas: sin ver lo esperado"* a secas. Es un ajuste de texto, no de
  código: la spec tiene que decir *"salvo el admin del tenant, que nunca es el objetivo del
  anti-fraude"*. Se abre como entrada propia porque la entrada que lo detectó se cerró y el
  arreglo quedaba huérfano.

- [ ] **Ningún e2e asierta el efecto de invalidar al vincular** (backend, **medido 2026-08-15**)
  — el mutante que quita `garzon.pinHash = PIN_INUTILIZABLE` de la rama `vincular` de
  `actualizar()` **no pone nada en rojo en el e2e**. La transición sí se recorre —
  `caja-testigo.e2e-spec.ts:383-387` vincula al garzón B por `PATCH` después de abrirle sesión
  con su PIN vivo, y `:771` hace lo mismo con D — así que **falta la aserción, no el escenario**:
  alcanza con un `expect` sobre ese PIN después del PATCH. En unit sí está cubierto.

- [ ] **`miPin` hace cuatro consultas donde alcanzan tres** (backend, **medido 2026-08-15**) —
  `GarzonesService.miPin()` (`garzones.service.ts:688-697`) llama `miGarzonOrThrow()`, que ya
  hace dos consultas (`garzonPersonalDe` para resolver el `garzonId` + `findOneOrFail` para
  traer la fila completa del garzón, con su `pinHash`). Después llama
  `listarEventosPin(tenantId, garzon.id)`, que **vuelve a buscar el mismo garzón**
  (`getOrThrow`, `garzones.service.ts:1037-1043`) antes de traer los eventos. La cuarta consulta
  es redundante: el garzón que `getOrThrow` re-busca es el mismo que `miGarzonOrThrow` ya tiene
  en memoria. No es el N+1 que preocupa la tanda 🔴 (es una sola llamada, no una por fila), pero
  es una consulta de más en una ruta que golpea cada carga del perfil y de `/salones` en modo
  personal.

- [ ] **El garzón que abre `/salones` ve un toast rojo de permiso que no le corresponde**
  (frontend, **medido en el smoke del 2026-08-15**) — con la cuenta `garzon.pin@paris.cl`, la
  carga inicial de la pantalla del salón dispara cinco 403 (`/caja/activa`, `/items` ×3,
  `/tipos-documento`: datos del POS que el rol de garzón no ve) y al menos uno sale como
  *"No tienes permiso para esta acción"* en rojo, arriba a la derecha. **Preexistente**, no lo
  introdujo el PIN propio: `/garzones/mi-pin` devolvió 200 en la misma corrida. Es la misma
  familia que el `.catch(() => null)` que ya lleva `cargarActiva`, aplicada a medias.

- [ ] **`listarEventosPin` no tiene `LIMIT`: una tabla que solo crece, leída entera cada vez**
  (backend, **medido 2026-08-15**) — `garzones.service.ts:631-649` arma el historial completo
  de `garzon_pin_evento` para un garzón con un solo `SELECT ... ORDER BY e.creado_el DESC`, sin
  `LIMIT`/paginación. Hoy con pocos eventos por garzón no se nota, pero es una tabla que solo
  crece —el diseño explícitamente decidió guardar todo, no solo el último cambio— y la alimentan
  dos pantallas (`GET /garzones/:id/pin-eventos` en la ficha del encargado, `GET
  /garzones/mi-pin` en el perfil del garzón). Con años de regeneraciones/invalidaciones para un
  garzón activo, la consulta y el payload crecen sin techo.

- [ ] **`ventas/pos.vue`, `tienda/index.vue` y `tienda/suscripciones.vue` no tienen
  `.nuxt.spec.ts`.** El filtro de pausados que vivía en esas tres pantallas se movió a la
  query el 2026-08-09 (`activo=true`, ver [`resueltos.md`](resueltos.md)), y el endpoint sí
  quedó cubierto por e2e; lo que **no** sostiene nada es que cada pantalla lo pida — borrar
  `&activo=true` de una URL deja la suite en verde. En `salones/index.vue` eso ya tiene test,
  porque ahí el spec existe. Montar las otras tres exige stores de caja, unidades e
  impresoras: es el arnés, no el `it`.

- [ ] **Una venta con un ítem en moneda extranjera no está cubierta en ningún nivel**
  (backend/tests, medido 2026-08-11) — `ventas.service.spec.ts` tiene una sola moneda con
  `valor_del_dia = '1'`, así que multiplicar o dividir por la tasa da lo mismo y el test no
  distingue; el e2e tampoco lo ejercita. **Ya era ciego antes** del arreglo del redondeo (con
  la conversión inline pasaba igual), pero ahora esa ceguera es permanente desde ventas: el
  spec mockea `convertirAMonedaOficial`, así que un fixture en moneda extranjera ejercitaría
  el mock y no el código. La cobertura tiene que venir de un e2e con un ítem en otra moneda.

---

## 2. Medir primero — no es una pregunta para el owner

Lo que falta acá es abrir un archivo, correr algo o mirar la base. Cada una sale de esta
sección hacia la 1 (si el arreglo resulta obvio) o hacia la 4 (si lo medido destapa una
decisión que no es mía).

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

- [ ] **¿Se puede desvincular una cuenta desde el formulario?** (frontend, **duda medida en el
  smoke del 2026-08-15, sin resolver**) — el `USelectMenu` de "Cuenta vinculada" muestra
  `Sin vincular (usa PIN)` como *placeholder*, pero **con una cuenta ya elegida no se vio una
  opción para volver a ese estado**: la lista solo trae cuentas. Si no se puede, el `null`
  explícito de `UpdateGarzonDto` solo es alcanzable por API. Importa porque el estado
  *"desvinculado y sin PIN usable"* —que la ficha ahora señala en rojo— se produce justamente
  por ese camino. **Verificar antes de asumir cualquiera de las dos cosas.**

- [ ] **`impuestos` no tiene índice único de nombre por tenant, y sus hermanas sí**
  (backend/BD, encontrado 2026-08-11 por la revisión del cierre de las advertencias
  repetidas) — `descuentos` y `recargos` tienen `uq_descuentos_tenant_nombre_vivo` y
  `uq_recargos_tenant_nombre_vivo` (`startup-pos.sql:442,471`), que además cubren las filas
  pausadas porque solo excluyen `eliminado_el IS NULL`. `impuestos` no tiene el equivalente,
  así que un tenant puede tener dos impuestos distintos con el mismo nombre.
  **Consecuencia medida:** la deduplicación de advertencias (2026-08-11) los colapsa en un
  solo aviso. No se pierde nada accionable —los dos mensajes serían idénticos y el lector
  tampoco podría distinguirlos— pero el aviso deja de contar cuántos hay, y la causa de
  fondo es la unicidad que falta, no la deduplicación.
  Antes de agregar el índice hay que mirar dos cosas: si hay filas del catálogo del país
  (`tenant_id` nulo) que romperían un índice por tenant, y si la unicidad debe incluir o no
  al IVA, que es del país y no del tenant (ADR-018).

- [ ] **El scoping por tenant del camino de ESCRITURA de caja no está fijado por ningún
  test** (backend) — el e2e nuevo prueba que la escritura ajena no prospera y que la caja
  queda intacta, pero no aísla cuál de las tres defensas la frena
  (`bloquearCajaAbierta` + `findOne` acotado + chequeo de dueño). Medido: sacando la de
  tenant, la request del otro tenant llega al `FOR UPDATE` y la corrida **se cuelga**, así
  que no hay aserción posible sobre el resultado. Encararlo probablemente pida un timeout
  explícito en la query o mirar el lock, no un `expect` de status.

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

  ✅ **La mitad legible se cerró el 2026-08-11** (ver [`resueltos.md`](resueltos.md)): las
  lecturas de `/tenants/members` afirman el status antes de castear, así que la próxima vez
  que esto pase el test va a decir qué contestó el servidor. **El flaky sigue abierto**: su
  causa sigue sin determinarse, y lo que se cerró es la mudez, no el bug.

  Contexto que puede o no ser relevante, anotado para no perderlo: `GET /tenants/members`
  es **admin-only** desde el 2026-08-09 (`TenantAdminGuard`). El token que usa el test es
  el del admin, así que un 403 liso no es la explicación obvia — pero es justo la clase de
  hipótesis que la aserción de status confirmaría o descartaría de una.

  🆕 **Segundo avistaje, y le da forma a la hipótesis (2026-08-11).** En una corrida de la
  suite completa, `ventas.e2e-spec.ts` → *"anula, repone el stock y persiste quién y por
  qué"* falló con **`401 Unauthorized` en `POST /ventas`**. Mismo patrón: un solo test, la
  corrida siguiente (misma suite, mismo `reset-db.sh`) verde, y `--verificar` confirmó una
  sola siembra. Es otro spec y otra ruta, así que **no es "el flaky de caja"**: es un
  intermitente de **autenticación**, que es la familia a la que los dos pertenecen.

  Por qué importa para el de caja: un `401` devuelve un **objeto** (`{statusCode, message}`),
  no un array — que es exactamente `resMiembros.body.find is not a function`. Los dos
  síntomas se explican con la misma causa. **Sigue siendo hipótesis, no medición**: nadie
  vio todavía el status de la respuesta que rompió el de caja; eso lo va a decir la
  aserción que se agregó el 2026-08-11 la próxima vez que ocurra. Lo que cambió es que ahora
  hay dónde mirar primero: por qué un token válido a mitad de suite se rechaza.

  🆕 **Tercer avistaje (2026-08-12), y ya no puede ser casualidad.** `recetas.e2e-spec.ts` →
  *"12. un ítem pedido en una cuenta abierta no se puede borrar…"* falló con **401** en
  `GET /items/:id/uso`. Corrida siguiente, misma suite y mismo `reset-db.sh`: verde, 400/400.
  **Son tres specs distintos, tres rutas distintas, y las tres veces un 401**
  (`caja` → `TypeError` sobre un body que no era array, o sea un 401 disfrazado; `ventas` →
  `POST /ventas`; `recetas` → `GET /items/:id/uso`). Un solo test por corrida, siempre
  distinto, siempre auth.
  Eso descarta que sea de un spec: es **un intermitente del camino de autenticación** bajo la
  suite completa (que corre con `maxWorkers: 1`, así que tampoco es paralelismo). Sospechas a
  medir, en este orden: expiración del access token a mitad de suite (¿cuánto dura?), y el
  pool de conexiones bajo la consulta de sesión/permisos.
  ⚠️ **Importa más de lo que parece:** hace que **cualquier** corrida de CI pueda fallar sin
  regresión, y entrena a leer un rojo como ruido — que es exactamente cómo pasa desapercibida
  una regresión real.

  🔗 **Cuarto avistaje (2026-08-12) y la conexión que faltaba.** `garzon-modo-personal.e2e-spec.ts`
  falló con **400** en `POST /sesiones-garzon/iniciar` — *"ya tiene una sesión abierta"*. No
  reprodujo: solo pasa 14/14, y la suite completa siguiente dio 400/402 verde.
  **No es un intermitente nuevo: es la CONSECUENCIA del 401.** Si el 401 pega sobre un `cerrar`
  de limpieza —y las limpiezas de `afterAll` **no afirman su status**—, la sesión queda abierta
  en silencio y el siguiente spec que use ese garzón recibe un 400 que no tiene nada que ver.
  Por eso el síntoma cambia de spec en spec y parece aleatorio.
  ➡️ **Acción concreta que se puede tomar YA, sin resolver la causa:** que **toda** limpieza de
  `afterAll` afirme su status. No arregla el 401, pero convierte una cascada silenciosa en un
  fallo que apunta a su origen. Es el mismo hallazgo que la revisión ya había marcado sobre
  `caja.e2e-spec.ts` ("la higiene final no verifica status... contamina los describes siguientes
  en silencio").

  ⚠️ **Precisión medida el 2026-08-13: "que afirme su status" es correcto pero incompleto, y
  aplicado a secas hace daño.** Si el `expect` corre **antes** de `app.close()`, el primer fallo
  de limpieza tira la excepción, la app de Nest queda viva con su pool abierto y **jest imprime
  el resultado y no termina nunca** (medido: 7 minutos, 0% CPU, `pg_stat_activity` sin una sola
  query). Un mutante que hace exactamente lo que debe se vuelve indistinguible de un entorno
  colgado — costó el veredicto de un mutante entero.
  ➡️ La forma correcta, ya aplicada en `caja-testigo.e2e-spec.ts`: **acumular** los fallos de
  limpieza, cerrar la app en un `finally`, y afirmar **después**. Mismo diagnóstico, 4,4 s en
  vez de colgarse. Los `afterAll` de los otros specs siguen con la forma vieja.

---

## 3. Ya decidido, falta construir

El owner ya contestó lo que había que contestar. **No son mecánicas** —tienen diseño
adentro, y alguna quedó a medias a propósito— pero nadie está esperando una respuesta para
empezarlas.

- [ ] **El kardex conserva todo pero las pantallas lo esconden, y hasta el total miente**
  (backend + frontend, auditoría `inventario` 2026-08-15; **decidido por el owner el mismo
  día**) — **lo medido, que es mejor de lo que la entrada original decía por un lado y peor
  por el otro.**
  **Mejor:** los datos nunca se pierden. `movimientos_inventario` tiene columna
  `eliminado_el`, pero **nada en todo el backend la escribe** (medido: cero `softDelete`,
  cero `UPDATE`, cero `DELETE` físico sobre esa tabla). Borrar un ítem hace soft delete sobre
  `items` y no toca un solo movimiento.
  **Peor:** las cuatro consultas de las dos pantallas de auditoría unen con
  `JOIN items … AND i.eliminado_el IS NULL` —`inventario.service.ts:752` y `:777`,
  `mermas.service.ts:213` y `:233`— y **el filtro está también en el `COUNT(*)`**, no solo en
  el listado. O sea que las filas no aparecen tachadas ni vacías: **el total baja**. La
  pantalla no dice "hay N movimientos ocultos"; informa menos movimientos de los que hay. Y
  el guard de borrado (`items.service.ts:1834-1849`) bloquea por cuenta, ingrediente, combo y
  opción, pero **no** por tener kardex, así que discontinuar un producto es trivial.
  ✅ **Decisión del owner (2026-08-15): lo que está en el kardex queda en el kardex.** Las
  pantallas pasan a `LEFT JOIN` en las **cuatro** consultas —listado y `COUNT` de kardex, y
  listado y `COUNT` de mermas— y la fila se muestra con el ítem **marcado como eliminado**.
  **No se bloquea el borrado**: impedir discontinuar un producto que alguna vez se movió
  equivale a no poder discontinuar casi ninguno.
  ⚠️ Al construirlo: el `LEFT JOIN` deja el nombre del ítem en `null`, así que el frontend
  necesita qué mostrar en esa celda además del marcador. Y el mutante que fija esto tiene que
  atacar el **`COUNT`**, no solo el listado — si solo se corrige el listado, el total sigue
  mintiendo y ningún test que cuente filas de la tabla lo nota.

- [ ] **Un ítem eliminado sigue aceptando cualquier movimiento nuevo, no solo los que
  deshacen algo** (backend, medido 2026-08-15; **decidido por el owner el mismo día**) —
  hoy `registrarMovimiento` no mira `items.eliminado_el`, así que sobre un producto
  discontinuado se puede registrar una **compra**, una **merma** o un **ajuste de costo**
  igual que antes de borrarlo. Es la otra mitad de la decisión de arriba: *"lo que está queda"*
  habla de los movimientos viejos y no dice nada de los nuevos.
  ✅ **Decisión del owner (2026-08-15): solo los movimientos que deshacen algo.** Anulación y
  devolución **sí** —esa venta existió y su plata ya se movió, hay que poder cerrarla—;
  compra, merma, ajuste de costo y recuento **se rechazan** sobre un ítem eliminado, porque no
  hay operación real detrás.
  **Dónde va, y por qué ahí:** en `registrarMovimiento`, que ya es el chokepoint por el que
  pasa todo movimiento y que desde el 2026-08-15 ya trae `items` en su consulta de lock
  (`inventario.service.ts:106-113`) — el dato de si está eliminado **ya está a mano**, falta
  ramificar por `motivo`. Hoy esa consulta **no** filtra `eliminado_el` justamente para no
  romper las reposiciones; esta entrada es la que convierte esa ausencia en una regla
  explícita en vez de una omisión.
  ⚠️ El rechazo tiene que nombrar el producto y decir que está eliminado, no caer en el
  genérico *"El item no tiene control de stock"* — que es el mensaje deliberadamente opaco
  del acote por tenant y significa otra cosa.

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

- [ ] **Ocultar el resultado post-cierre al cajero** (backend + frontend) — en el cierre
  ciego (sub-proyecto B) el cajero **sí** ve su propia diferencia al enviar el conteo (la
  revelación es inmediata, vía el detalle), aunque la caja quede `en_conciliacion`. El
  sub-proyecto C resolvió la conciliación operador→supervisor de §6, pero no
  condicionó la revelación a que solo el supervisor la vea de inmediato — sigue diferido.
  ✅ **Decidido por el owner (2026-08-11): la diferencia la ve solo el supervisor.**
  ⚠️ **No alcanza con tocar el detalle del arqueo.** El ocultamiento de hoy es **parcial**:
  el **panel de resumen del turno sigue mostrando lo esperado**, así que un cajero que abra
  esa pantalla deshace la decisión por otra puerta. Las dos superficies se cierran juntas o
  la decisión no existe.
  ⚠️ Costo aceptado explícitamente: un error de conteo de buena fe ya no se corrige en el
  momento — hay que volver a llamar a la persona.

- [ ] **Verificación de correo del auto-registro público** (backend) — lo único que
  quedó abierto de la entrada de mail, que se cerró el 2026-08-09 (ver
  `resueltos.md`). La invitación resuelve la verificación **del invitado**: si hizo
  clic en el link, la dirección existe y alguien la lee. Falta el otro camino:
  `POST /auth/register` sigue creando cuentas con un correo que nadie probó.

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

---

## 4. Necesita que el owner conteste

Cada una lleva su pregunta concreta adentro. Mientras no se conteste **no se empiezan**:
elegir por cuenta propia una regla de negocio no documentada es justo lo que `CLAUDE.md`
prohíbe.

- [ ] 🚩 **Dos recuentos abiertos sobre el mismo producto descuentan el faltante dos veces**
  (backend + producto, auditoría `inventario` 2026-08-15) — **el hallazgo más caro de la pasada.**
  `RecuentosService.create()` hace un `INSERT INTO recuento_inventario` sin mirar si el tenant ya
  tiene una sesión en `borrador` que incluya esos ítems (verificado abriendo el método: no hay
  guard, y el único índice único es `(recuento_id, item_id)`, o sea **dentro** de una sesión).
  Cada línea congela su `stock_sistema` al crearse y el ajuste se aplica como **delta relativo**
  sobre el stock vigente.
  **Escenario:** stock de sistema 10. Dos personas abren su propia sesión y las dos cuentan 8.
  Cada sesión guarda delta −2. Aplicadas las dos, el stock queda en **6**, no en 8. El faltante
  real se descuenta dos veces y se genera un faltante que no existió.
  ⚠️ **La doc anticipó este riesgo y lo descartó con un razonamiento que no cierra.**
  [`recuento-inventario.md`](../features/recuento-inventario.md) lo lista en su tabla de riesgos
  y lo da por mitigado: *"cada línea congela su propio `stock_sistema`; el delta se calcula contra
  ese congelado, así que aplicar ambas en cualquier orden da el mismo resultado final"*. Es cierto
  y es irrelevante — la independencia del orden no es corrección: da el mismo resultado
  equivocado. **Eso es peor que un hueco no considerado**, porque el próximo que lo mire va a
  encontrar la fila de la tabla y creer que está resuelto.
  **La pregunta para el owner:** ¿la segunda sesión sobre un ítem ya en borrador se **bloquea**
  (400 nombrando la sesión abierta), se **avisa** y se deja seguir, o el ajuste se recalcula
  contra el stock del momento de aplicar en vez del congelado? Las tres son defendibles y
  cambian el modelo. La tercera además contradice el comentario que llama al delta *"el corazón
  del diseño"*.

- [ ] 🚩 **Cambiar la unidad de un ingrediente puede tirar abajo el listado entero del catálogo**
  (backend, auditoría `inventario` 2026-08-15) — el guard que bloquea cambiar `unidadMedida`
  (`items.service.ts:1391-1418`) solo mira si el ítem tiene **movimientos propios**; no mira si
  una `receta_ingredientes` o una opción de grupo ya lo referencia con una unidad fijada. Un
  ingrediente sin costo ni movimientos puede pasar de `kg` a `l` sin fricción.
  **Verificado el mecanismo del daño:** `catalog.service.ts` → `convertirUnidades` hace
  `conversiones.map(c => this.convertirConMapa(...))` **sin aislar fila por fila**, así que una
  sola conversión imposible hace fallar el lote completo. Como `calcularDisponibilidadBatch` lo
  usa desde `findAll` y ni el service ni el controller lo atrapan, **`GET /items` deja de
  responder para todo el tenant** —el menú del POS incluido— hasta arreglar la fila a mano.
  **La decisión:** ¿el guard se amplía para bloquear el cambio cuando hay referencias (y el
  usuario tiene que desarmar la receta primero), o el batch se vuelve tolerante fila por fila
  (devolviendo la que no se puede convertir marcada, en vez de tirar todo)? No son excluyentes,
  y la segunda protege también contra el resto de las filas corruptas que ya puedan existir.

- [ ] 🚩 **Anular una venta reingresa la mercadería al costo de hoy, no al que salió — y el
  inventario se infla solo** (backend + contabilidad, auditoría `inventario` 2026-08-15) —
  **lo encontraron dos lentes ciegas entre sí** (costeo CPP y devoluciones), por caminos
  distintos; se cuenta una vez.
  Medido en el código: `registrarMovimiento` recalcula el promedio ponderado **solo** cuando
  `tipo='entrada' && motivo='compra'`, y los tres call sites de reversión
  (`ventas.service.ts:862` anulación, `:1006` y `:1153` devolución) **no pasan `costoUnitario`**.
  Con eso, `costoUnitarioCongelado` cae en la rama `: costoActualPrevio` —el CPP vigente al
  momento del reingreso— y `costo_actual` queda intacto.
  **La aritmética, con números concretos:** vender 1 unidad a costo $50, comprar 5 a $70 (el CPP
  pasa a $57,1429), y anular la venta original deja el inventario valorizado en **$857,14** en
  vez de **$850,00**. Son $7,14 que no entraron por ninguna compra, y que además contaminan cada
  CPP posterior.
  ℹ️ El costo real de esa salida **existe y no se lee**: el kardex lo congeló ligado a la
  `venta_id` del movimiento original.
  ⛔ **La pregunta es contable y no me corresponde:** ¿una devolución reingresa al costo con el
  que la unidad salió (y entonces hay que recalcular el promedio incluyéndola), o al costo
  vigente (y el desfase se asume)? Los dos criterios existen en el mercado. Lo que hoy hay no es
  ninguno de los dos elegido: es la ausencia de decisión.
  **Ningún test lo cubre:** `ventas.service.spec.ts` mockea `registrarMovimiento` entero en el
  bloque de anulación.

- [ ] 🚩 **Anular una venta con recetas o combos no repone los ingredientes, y responde que sí
  repuso** (backend, auditoría `inventario` 2026-08-15) — `cancelar` arma la lista a reponer con
  `JOIN item_producto ip ON ip.item_id = d.item_id` (`ventas.service.ts:848`, **INNER**). Una
  línea de receta o de combo **no tiene fila en `item_producto`** —la tienen sus ingredientes—,
  así que la línea desaparece del `SELECT` sin error y sin aviso, y la respuesta igual dice
  `stockRepuesto: true` (el frontend muestra *"Venta anulada y stock repuesto"*).
  **La asimetría está medida:** el camino de la nota de crédito usa `LEFT JOIN` en la misma
  consulta (`:1280`) y cae en la rama de `modo_inventario === null`, que responde *"no maneja
  stock (servicio): no admite devolución a inventario"* (`:1314`) — un mensaje que para una
  receta es falso.
  **Escenario:** se vende una pizza, la venta se anula reponiendo stock, y el queso y la harina
  que salieron del inventario al venderla **no vuelven nunca**. No hay ningún camino que los
  reponga: ni la anulación, ni la NC, ni un endpoint manual de entrada.
  **La decisión:** ¿la anulación expande la receta y repone los ingredientes (simétrico con lo
  que hace la venta), o rechaza explícitamente las ventas con recetas/combos como ya rechaza
  serie y lote? Lo que no puede seguir es la tercera opción actual: no reponer y decir que sí.

- [ ] **Serie y lote están a medias, y cada camino decide por su cuenta si rechazar o aceptar y
  corromper** (backend + BD, auditoría `inventario` 2026-08-15) — tres caras del mismo hueco,
  agrupadas porque se deciden juntas:
  1. **La merma acepta y descuenta la unidad equivocada.** `CreateMermaDto` no tiene
     `unidadIds`/`loteId` y `mermas.service.ts` no chequea `modo_inventario`, a diferencia de
     `recuentos.service.ts:566-569` y `ventas.service.ts:856-858,1316-1318`, que **sí rechazan
     limpio**. Como `moverSerie` auto-selecciona FIFO cuando no le pasan unidades (hay un test
     que lo fija), mermar un producto serializado da de baja **la unidad más vieja, no la que se
     rompió**: se destruye la trazabilidad por IMEI que es la razón de ser de ADR-007. El
     selector de `mermas.vue:161-165` tampoco filtra esos productos.
  2. **Los índices únicos que la doc promete no existen en ninguna parte.**
     `inventario-serializado.md` documenta únicos parciales `(tenant_id, serie)` y
     `(item_id, codigo_lote)`; `item-unidad.entity.ts` e `item-lote.entity.ts` no declaran
     `@Index`. **Busqué la refutación donde este proyecto suele esconderla** —los únicos
     parciales los crea el seeder, no `synchronize`— y no está: el seeder crea once índices y
     ninguno es de esas dos tablas (medido). Sin chequeo en código tampoco: `moverSerie` inserta
     sin buscar duplicados y `moverLote` tiene un check-then-insert. Se puede cargar el mismo
     IMEI dos veces.
  3. **`fecha_vencimiento` se guarda, se expone y no se compara con nada.** Cero comparaciones
     contra `NOW()` en todo `backend/src` (medido). La salida automática es FIFO por `creado_el`,
     no FEFO por vencimiento.
  **Lo que hay que decidir antes de tocar nada:** ¿se cierra la puerta (rechazar serie/lote en
  merma, como ya hacen venta y recuento) o se construye el soporte? La primera mitad es barata y
  para la sangría; la segunda es una feature. Y aparte: **¿un lote vencido se puede vender y
  mermar, o se bloquea?** Eso es regla de negocio y no está en `PRODUCTO.md`.

- [ ] **El detalle de un recuento esconde una línea que el listado sigue contando** (backend,
  auditoría `inventario` 2026-08-15) — `findOne` arma el detalle con `INNER JOIN items` filtrando
  `eliminado_el`, así que si un ítem se borra mientras la sesión sigue en `borrador` su línea
  desaparece del detalle sin aviso; `findAll` sigue incluyéndola en `cantidadLineas`. El listado
  dice 12 líneas y el detalle muestra 11, hasta que al aplicar aparece en `lineasDescartadas`.
  **La decisión es cuál de las dos vistas está bien:** que el detalle muestre la línea marcada
  como descartada (coherente con lo que hace `aplicar`) o que el listado deje de contarla.

- [ ] **El costo de un combo se queda viejo y nadie avisa, a diferencia de las recetas**
  (backend, auditoría `inventario` 2026-08-15) — `item_combo.costo_actual`
  (`items.service.ts:1610-1646`) solo se recalcula si el `PATCH /items/:id` reenvía
  explícitamente `componentes`. No hay disparador cuando cambia el costo de un componente, ni un
  equivalente de la bandeja `recetas/desfases` para combos. El costo obsoleto se sigue exponiendo
  en cada listado igual que el de un producto o una receta, así que el margen que muestra la
  pantalla es incorrecto por tiempo indefinido.
  ⚠️ `simulador-impacto-costos.md` **no declara esta exclusión** en su lista de lo que no cubre,
  así que hoy no es una limitación conocida sino un hueco silencioso.
  **La decisión:** ¿los combos entran a la misma bandeja de desfases que las recetas, o se
  documenta explícitamente que su costo es manual?

- [ ] **El aviso al vincular una cuenta dice "hasta que se lo des", pero el encargado
  puede no poder dárselo** (backend, **medido 2026-08-15 al cerrar el plan
  `pin-propio-garzon`**) — `garzones.service.ts` advierte, en tres sitios (`crear()` línea
  232, `actualizar()` líneas 341 y 396), cuando la cuenta vinculada todavía no puede operar
  el salón. El texto es idéntico en dos de los tres (`crear()` línea 232 y `actualizar()`
  línea 341): *"...no va a poder entrar en modo personal (sin PIN, desde su propia cuenta)
  hasta que se lo des"*. El tercero (`actualizar()` línea 396, la rama con sesión abierta) dice
  lo mismo sin el paréntesis: *"...no va a poder entrar en modo personal hasta que se lo des,
  pero puede seguir operando desde el tótem si fija un PIN propio nuevo"*. Pero otorgar
  `Salones:Operar` significa editar un rol (`PATCH /roles/:id`), y esa ruta exige
  `TenantAdminGuard` (`roles.controller.ts:49-50`). Un encargado sin rol admin —alguien con
  `Salones:Actualizar` pero sin permisos de `Roles`, que es exactamente a quién se le muestra
  este aviso al dar de alta o vincular un garzón— lee una instrucción que no está en su mano
  ejecutar, en los tres sitios. El texto necesita, o bien decir "pedile al admin que se lo dé",
  o el flujo de otorgar el permiso necesita abrirse a un rol no-admin con `Salones:Actualizar`.

- [ ] 🚩 **El alta de una suscripción muestra un precio y cobra otro** (frontend + producto,
  **medido** 2026-08-11 al cerrar el descarte de advertencias) — el drawer "Nueva
  suscripción" (`tienda/suscripciones.vue`) rotula **"Precio del período"** con
  `item.precioBase`, que es el precio **neto** del catálogo. El backend, en cambio, le
  autoriza a la tarjeta `resultado.totales.totalFinal`, que sale del motor con impuestos,
  descuentos y recargos aplicados.
  **La medición, contra el stack real (tenant Paris, ítem de suscripción a $30.000):** el
  drawer dice `30000` y a Transbank se le cobran **`35700`** — los $5.700 son el IVA al 19%
  (`550e8400-…-440280`). El cliente confirma un número y se le cobra otro un 19% mayor, sin
  ningún paso intermedio que se lo muestre.
  Ojo con reproducirlo: **el seed no trae ningún ítem `tipo='suscripcion'`**, así que la
  pantalla se ve vacía a menos que se cree uno (así se midió esto).
  Por qué no se arregló junto con las advertencias: ahí lo que faltaba era devolver un campo;
  esto es una **previsualización de precio antes de cobrar** —qué se muestra, si frena el
  alta, si reusa `AdvertenciasPrecio` como ya hacen el carrito y la pasarela— y eso es
  decisión de producto, no una corrección. Las advertencias que ahora sí llegan
  (`POST /suscripciones` → `advertencias`) explican el monto **después** del cobro; no lo
  reemplazan.

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
  ⛔ **Corrección al "cierre posible" (2026-08-11): ese molde NO es copiable tal cual, y
  copiarlo introduce un bug peor que el que arregla.** Medido en Postgres:
  `'2026-08-01T15:30:00Z'::date` devuelve `2026-08-01` — **el `::date` descarta la hora en
  silencio**. El molde funciona en `propina-reportes` porque ahí el rango llega ya
  normalizado a fechas puras (`RangoReporteNormalizado`); estos tres DTOs validan con
  `@IsDateString()`, que **acepta las dos formas**, así que un llamador que hoy manda
  `?desde=2026-08-01T15:30:00Z` pasaría a filtrar desde la medianoche de ese día. Un
  filtro que se ensancha sin avisar es peor que uno con la zona ambigua.
  Lo que el cierre necesita entonces, además del cast: decidir si estos endpoints aceptan
  timestamp o solo fecha pura, y si aceptan las dos, normalizar en el service —expandir la
  fecha pura a medianoche del tenant y dejar pasar el timestamp tal cual— en vez de castear
  en el SQL. Eso ya no son "tres servicios copiando un molde".
  (Verificado también el lado bueno del molde: `'2026-08-01'::date::timestamp AT TIME ZONE
  'America/Santiago'` da `2026-08-01 04:00:00+00`, que es la medianoche local correcta.)

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

- [ ] **Aprobación de cierre por umbral de diferencia** (backend + config) — patrón Toast:
  si el over/short del cierre supera un umbral configurable, el cierre del cajero requiere
  aprobación del encargado. Agrega config de umbral por tenant + flujo de aprobación. Más
  fiel al mercado; mayor alcance. Ya no depende de resolver el modelo del esperado (§3,
  **resuelto** por el sub-proyecto A) — el umbral se evaluaría sobre la
  diferencia de cada línea del arqueo multi-medio, ya no sobre un total mezclado que
  inflaba cualquier diferencia.
  ✅ **Decidido por el owner (2026-08-11): sí, con umbral configurable por tenant, y el
  cierre queda esperando aprobación.** Bloqueante, no aviso.
  ⚠️ **Cruce sin resolver con el cierre forzado**, que ya se entregó (2026-08-13, ver
  [`resueltos.md`](resueltos.md)) — así que este cruce dejó de ser hipotético: si el encargado
  cierra la caja de otro y esa diferencia supera el umbral, **¿quién aprueba?** Que se apruebe a sí
  mismo anula el control; que lo apruebe un tercero puede no haber a esa hora. Hay que
  contestarlo antes de escribir el flujo, no durante.
  🔶 **Pieza que aportó la investigación (§10.6) y todavía no está decidida:** el precedente
  bancario no es binario — bajo el umbral se ajusta sin avisar; **sobre** el umbral, dos
  personas reverifican **y se le avisa al dueño de la plata**. Ese aviso al cajero no estaba
  en la decisión del umbral y encaja con que la diferencia sea un incidente, no su faltante.

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

- [ ] **El hook de pre-commit valida enlaces de markdown pero no que una tabla siga siendo
  tabla** (tooling, **medido 2026-08-15, pasó de verdad en esta entrega**) —
  `.githooks/pre-commit` (Guard 5) corre `check-docs-links.mjs` sobre `.md` staged, pero no hay
  ningún guard que valide la sintaxis de una tabla GFM. Insertar un párrafo entre dos filas de
  una tabla markdown (falta una línea en blanco antes/después, o el párrafo no empieza con `|`)
  hace que **todo lo que sigue** deje de renderizarse como tabla — visualmente desaparece — y ni
  el hook ni el CI lo detectan, porque ninguno de los dos parsea markdown como markdown, solo
  greppean texto y valida links. No hay un fix mecánico obvio (un linter de markdown-tables es
  una dependencia nueva, a evaluar), pero vale la entrada para no repetir el mismo susto.

---

## 5. Carreras de concurrencia

Van juntas porque el arreglo pide **un solo análisis de orden de locks** —qué fila se
bloquea y en qué orden en cada camino—, no cuatro parches. Son **dos moldes distintos**, y
conviene no confundirlos:

- **Tres del molde "no toma lock"** (las tres primeras, y las tres entradas ya lo dicen por
  su cuenta): un `SELECT` de validación sin lock, y otra transacción que escribe entre el
  chequeo y el commit.
- **Una del molde "lockea en orden no determinista"** (la última, de la auditoría de
  `inventario`): el lock sí se toma, pero el orden lo decide el cliente. El arreglo es el
  contrario —no agregar un lock sino fijar un orden—, y las piezas ya existen en el repo.

⚠️ Ninguno de estos moldes es el de la 🔴 del principio del archivo, que es **agotamiento
del pool de conexiones**, no locks de fila. Son tres cosas distintas que se llaman igual.

- [ ] **Los tres caminos que revierten stock no tienen la protección de deadlock que su gemelo
  `crear()` sí tiene** (backend, auditoría `inventario` 2026-08-15) — es otro molde que los tres
  de arriba: acá el lock **sí** se toma, lo que no es determinista es **el orden**.
  `registrarMovimiento` toma un `FOR UPDATE` sobre `item_producto` **por ítem**, o sea N
  statements separados. `crear()` lo sabe y lo resuelve con dos capas —orden determinista por
  `itemId` (`ventas.service.ts:618-626`) y reintento ante `40P01`
  (`MAX_REINTENTOS_DEADLOCK`)—, y su propio comentario explica que el deadlock era real.
  Los tres caminos inversos no tienen ninguna de las dos: `cancelar` (`:845`) hace un `SELECT`
  **sin `ORDER BY`** y recorre lo que devuelva Postgres; `crearNotaCredito` (`:984`) y
  `registrarDevolucionesPorReembolso` (`:1152`) iteran el resultado de
  `validarDevolucionesReembolso`, que es un `devoluciones.map(...)` — **el orden del array del
  cliente**.
  ℹ️ La refutación que mató el deadlock de `fusionarCuentas` en la pasada de `turnos`+`salones`
  (un solo `SELECT … IN (…) FOR UPDATE` lockea en orden de plan, igual para las dos
  transacciones) **acá no aplica**: son statements separados.
  ⚠️ **Severidad bajada de alta a media al refutar.** La lente cerraba con "stock desincronizado
  permanentemente" y esa mitad no se sostiene *como consecuencia del deadlock*: el `40P01` aborta
  la transacción y revierte todo, así que en `cancelar` y en la NC directa el daño es un error
  opaco sin corrupción. La divergencia real solo existe por el camino del reembolso, y ahí ya
  está **asumida por diseño**: `reembolso-callback.registry.ts` dice que los errores del handler
  los captura el caller y *"el reembolso nunca se revierte"*. Ese agujero lo abre cualquier
  error; el deadlock solo agrega una forma evitable más de caer en él.
  **El arreglo es barato:** las dos piezas ya existen en el mismo archivo (el `sort` por `itemId`
  y el wrapper `esDeadlock`). `RecuentosService.aplicar` ya hace exactamente esto.

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

- [ ] **La carrera entre borrar un ítem y agregarlo a una cuenta sigue viva** (backend) —
  el bloqueo nuevo de `obtenerUsoItem` lee `cuenta_lineas` **sin lock** mientras
  `agregarLinea` resuelve el ítem en otra transacción, así que bajo READ COMMITTED las dos
  commitean. Ya no es catastrófico (la línea se muestra marcada, el cobro corta con un 400
  que la nombra y la comanda la incluye), pero el estado se sigue produciendo hacia
  adelante, no solo en datos viejos.

- [ ] **Carrera teórica entre `PATCH /items/:id` y `DELETE`** (backend,
  `items.service.ts`) — bajo READ COMMITTED, un `DELETE` que commitea entre la
  validación de un ingrediente en `PATCH` (edición de receta) y el `INSERT` de su
  fila de `receta_extras_permitidos` deja una fila viva apuntando a un item ya
  muerto. Ventana de milisegundos entre dos escrituras de admin; es la misma clase de
  carrera que ya tienen los tres bloqueos preexistentes (ingrediente, combo, opción).

---

## 6. Proyectos que van solos

No entran de arrastre dentro de otra tarea: o son un barrido masivo, o necesitan spec
propia antes de escribir código. Encararlas es brainstorm → spec → plan, nunca "un rato".

Las cuatro últimas **no son correcciones ni deuda**: son funcionalidad que todavía no
existe. Se listan acá, y no en la 4, porque la pregunta del owner es solo el primer paso
—después queda la spec entera—; el contexto de dónde salió cada una es parte del enunciado
y viaja con ella.

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

  ⚠️ **El día que se haga el rename completo, va solo.** Un rename es mecánico pero se
  contamina fácil: mezclado con una feature, cualquier bug queda escondido entre 3.000 líneas
  cambiadas y la revisión del diff deja de servir.

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

---

## 7. Acción del owner fuera del código

No se resuelve programando. Está acá para que tenga quién la reclame.

- [ ] 🇨🇱 **Validar con un abogado el ángulo legal chileno del testigo** — quedó huérfano al
  cerrar la entrada del cierre forzado (2026-08-13): la fuente es doctrina de la DT **leída
  por un agente**, no asesoría legal, y de ella salieron dos afirmaciones que el producto usa
  como justificación: (a) que la responsabilidad del cajero exige acceso exclusivo **y**
  oportunidad de estar presente en el conteo, así que contar sin él cae la imputación; (b)
  que sin asignación de pérdida de caja pactada **no se puede descontar** un faltante del
  sueldo (ORD. N°4229). `docs/DIFERENCIADORES.md` lo marca "sin validar por un abogado" y
  **no se puede comunicar el ángulo legal hasta que lo esté** — esta entrada existe para que
  esa validación tenga quién la reclame, ahora que la entrada que la contenía se archivó.

---

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

---

## Vigilancia — evaluado y descartado, no es trabajo

**Nada de esta sección hay que hacer.** Son cosas que se miraron y se decidió no arreglar,
hallazgos refutados, y ramas de test que se descartaron con su motivo. Viven acá para no
volver a descubrirlas desde cero, y **no cuentan** cuando se mide el tamaño del backlog.
La que tiene condición de reapertura la dice adentro.

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

- ℹ️ **El tope de 100 sigue vivo, y ahora es el único truncamiento que queda** (frontend).
  Las cuatro superficies de venta piden `pageSize=100` y no paginan, con
  `MAX_PAGE_SIZE = 100` en `common/utils/pagination.util.ts`. Mover el filtro de pausados a
  la query sacó una causa de pérdida —el pausado ya no le roba el lugar a un vendible— pero
  un tenant con más de 100 ítems vendibles sigue sin verlos todos en el POS. Preexistente y
  sin caso reportado; se anota para no perderlo, porque la nota anterior vivía pegada a la
  entrada del filtro que se cerró.

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
2026-08-15: los specs que faltan en tres pantallas, en la sección 1; el tope de 100, en
Vigilancia.

**Ramas sin cobertura alguna.** La lista se triageó el 2026-08-09 y se cubrieron **cuatro
ramas nuevas**: el spillover de propina entre pagos, el aislamiento multi-tenant **de
lectura** de caja, la capa SQL de `propina-reportes` y `HORAS_TRABAJADAS`; más el rechazo de
`peso <= 0`. Se escribieron además dos tests de guardas (`fechaHasta <= fechaDesde` y Σ de
porcentajes) que **no** agregan cobertura de rama: los mataban tests unitarios preexistentes.
Detalle, mutantes y lo que quedó sin fijar en [`resueltos.md`](resueltos.md).

Lo que la tanda dejó abierto y antes no estaba anotado —el scoping por tenant del camino
de **escritura** de caja, que ningún test fija— está en la sección 2: cerrarlo empieza por
medir, no por escribir el `expect`.

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
