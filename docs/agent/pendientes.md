# Pendientes — a corregir al terminar el harness

Backlog de correcciones que se **difirieron a propósito** mientras trabajamos en el
harness, para no mezclar el meta-trabajo (reglas, gates, docs) con cambios de código de
producto. Cada entrada dice qué, dónde, por qué se difirió y cómo se cierra.

> ✅ **La tanda 🔴 se terminó el 2026-08-21.** Era la sección de prioridad máxima que
> encabezaba este archivo y sus tres temas están cerrados: conexiones/deadlock y
> rendimiento el 2026-08-20, **redondeo de plata el 2026-08-21**. Todo el detalle está en
> [`resueltos.md`](resueltos.md). **Ya no hay una sección que leer antes que las demás**:
> las entradas se toman por lo que hace falta para tomarlas, según la tabla de abajo.
>
> ⚠️ Este aviso reemplaza al que apuntaba a una sección que ya no existe. Es la **cuarta
> vez** que hay que corregir un puntero a un frente cerrado de esta tanda —una doc que
> nombra un frente que ya no está hace frenar al próximo agente por algo que no existe—,
> así que esta vez se corrigieron en el mismo commit los tres lugares: este aviso, la tabla
> de orden de abajo y la lista *"🛑 Detenerse y preguntar"* de `CLAUDE.md`.

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

## 1. Mecánico — no hay nada que preguntar ni diseñar

El arreglo ya está decidido y escrito dentro de la propia entrada: **ninguna necesita una
respuesta del owner.**

✅ **Estuvo vacía del 2026-08-15 al 2026-08-21.** Tenía **22 entradas** y salieron en dos
tandas paralelizadas: **21 arregladas** y **1 elevada a la sección 4**, porque al abrirla
resultó ser una decisión de producto y no una mecánica (el `LIMIT` del historial de PIN). El
detalle de las dos tandas, con los errores que se cometieron en el camino, está en
[`resueltos.md`](resueltos.md). Volvió a poblarse con los minors del frente de redondeo, que
son de una sola pasada y están agrupados abajo.

### Los minors que dejó el frente de redondeo de plata (2026-08-21)

Ninguno es de plata mal calculada: son comentarios que quedaron desmentidos, tests que no
discriminan lo que dicen fijar, y tipos flojos. Se juntaron en una entrada porque se hacen
en una sola pasada y ninguno vale una entrada propia. **Citas verificadas el 2026-08-21.**

✅ **Las tres entradas de este grupo están cerradas.** Dos el 2026-08-21, en cinco commits
agrupados por naturaleza (tests / comentarios / tipos / duplicación / conducta). El detalle
—incluida la regresión que el e2e cazó y que ni el typecheck ni dos revisiones
independientes vieron— está en [`resueltos.md`](resueltos.md). La tercera —el tope del
cuaderno de anti-patrones, la única que pedía juzgar bugs ajenos— salió el **2026-08-22**,
también en [`resueltos.md`](resueltos.md). **La sección vuelve a quedar vacía.**

⚠️ **Antes de repartir la próxima tanda, leer la regla que salió de éstas** (misma entrada de
`resueltos.md`), porque no es la que uno esperaría:

- **Se reparte por dueño de archivo y por recurso compartido, no por cantidad.** Hay **un
  solo Postgres** y `reset-db.sh` hace `docker-compose down -v`: un agente que lo corra le
  vuela la base a todos los demás. Y el backend bind-montea el fuente, así que editar un
  `.ts` re-siembra el contenedor de todos.
- **Los worktrees no lo arreglan, lo empeoran**: compose no ve sus archivos, así que un e2e
  ahí corre contra el código viejo y vuelve **verde sin haber probado nada**.
- **Los agentes escriben y corren solo su propio spec**; el gate completo lo corre el
  principal, en serie, al final. Dos `nuxt build` concurrentes se pisan el `.nuxt/`.

📌 **Y lo que las dos tandas dejaron como lección de fondo:** de las 22 entradas, **cuatro
subcontaban o describían mal el hueco** —decía "tres consultas" y eran cinco, "dos DTOs" y
eran tres, "los dos SELECT" y el que faltaba era otro—. Ninguna se detectó leyendo: se
detectaron **abriendo el código** y **grepeando el repo entero por conducta**, no por nombre
de archivo. Una entrada de este backlog es un punto de partida, no un enunciado verificado.

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

- [ ] **El scoping por tenant del camino de ESCRITURA de caja no está fijado por ningún
  test** (backend) — el e2e prueba que la escritura ajena no prospera y que la caja queda
  intacta, pero no aísla cuál de las tres defensas la frena (`bloquearCajaAbierta` +
  `findOne` acotado + chequeo de dueño).

  ⛔ **CORRECCIÓN medida el 2026-08-16: esta entrada afirmaba algo falso.** Decía que
  sacando el filtro de tenant *"la corrida se cuelga"*. **No se cuelga.** Con el
  `AND tenant_id = $2` sacado de `bloquearCajaAbierta`, el test solo corre en **3,7 s y
  pasa**, y el spec entero da **35/35 en 8,5 s**. Nunca hubo cuelgue que esquivar.

  ✅ **Lo que pasa de verdad, y es más ordinario:** el mutante **sobrevive**. Las tres
  defensas son redundantes en la dimensión del tenant, así que sacar la primera deja que el
  `findOne` acotado produzca el mismo no-201 y ninguna aserción se mueve. No es que no se
  pueda medir el resultado: es que el resultado no cambia.

  🔴 **Y por eso lo que queda ES el frente prohibido.** Lo único que el filtro de la primera
  defensa aporta por su cuenta es **no tomar un `FOR UPDATE` sobre la fila de otro tenant
  antes de rechazar**. No es un agujero de datos —el `findOne` frena igual— pero deja que un
  tenant bloquee la caja de otro mientras dura la transacción. Fijarlo con un test pide
  mirar `pg_locks`, o sea abrir **conexiones/deadlock**, que va aislado y nunca de arrastre.
  ➡️ **No se toca hasta que se abra esa tanda.** El docblock de `caja.e2e-spec.ts` ya quedó
  corregido para que nadie vuelva a planificar sobre el cuelgue que no existe.
  ℹ️ **2026-08-20: la tanda que estaba esperando se cerró** (ver `resueltos.md` § "El orden
  de bloqueo de filas de la bandeja de desfases"), así que **el motivo del diferimiento ya
  no existe**. Lo que sigue en pie es todo lo demás: sigue haciendo falta `pg_locks` para
  fijarlo, por lo que esta misma entrada explica arriba (el mutante sobrevive: las otras
  defensas son redundantes en el resultado).
  ⚠️ **Y NO es la misma forma que el sub-punto de tenant que se cerró en esa tanda**, aunque
  se parezcan de lejos — la comparación estaba escrita al revés en la primera versión de
  esta nota. En `aplicarDesfases` el `FOR UPDATE` era `WHERE item_id = ANY($1)` **sin filtro
  de tenant**, con la validación en un `SELECT` aparte que corría después: había algo que
  subir. Acá el `SELECT … FOR UPDATE` de `bloquearCajaAbierta` (`caja.service.ts`) ya lleva
  `AND tenant_id = $2` **dentro de la misma sentencia que toma el lock**, y Postgres no
  bloquea una fila que no matchea el `WHERE`. No hay validación separada que mover: el
  arreglo de allá no se transfiere. Quién retome esto decide si lo toma; lo único que
  cambió es que ya no hay tanda cerrada que esperar.

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

  ✅ **CAUSA MEJOR SOSTENIDA, medida el 2026-08-15 por la auditoría de RBAC/auth:** los helpers
  `login()` de 23 de los 32 specs leen el `access_token` **sin afirmar el status**, así que un
  login fallido deja el token en `undefined` y el `describe` entero manda `Bearer undefined` →
  401 en la ruta siguiente. Ver la entrada de la sección 1. ⚠️ Explica **la forma** del síntoma,
  no el disparador: sigue sin saberse por qué el login falla esa vez, y por eso esta entrada
  queda abierta. Lo que cambia es que el próximo rojo va a caer donde corresponde.
  ⛔ **Y descarta la sospecha que esta entrada anotaba**: "el pool agotado disfrazado de 401" es
  falso. `jwt.strategy.ts` → `validate()` **no toca la base** (verificado abriendo el archivo:
  recibe el payload firmado y mapea cuatro campos), y ningún guard tiene `try/catch` que
  traduzca un error a 401. Un fallo de base ahí da 500, no 401.

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

- [ ] **Un `timeout exceeded when trying to connect` intermitente en el e2e local, con cinco
  causas ya descartadas** (backend/tests, visto y medido el 2026-08-18 en el cierre del
  contexto transaccional ALS) — en una corrida del e2e completo, `items-pausados.e2e-spec.ts`
  reportó 10 tests en rojo. **Los 10 son un solo fallo**: la aserción está en un `beforeAll`
  (`items-pausados.e2e-spec.ts:224`, un `POST /calculo-precios/calcular` que devolvió 500), y
  jest lo imputa a cada test del `describe`. El `Error: timeout exceeded when trying to connect`
  de `pg-pool` aparece **una sola vez** en todo el log.

  **No reproduce.** Tres suites completas posteriores, todas en verde (511/513).

  ✅ **Lo descartado, con evidencia y no con argumentos:**

  | Causa candidata | Cómo se descartó |
  |---|---|
  | Agotamiento de conexiones en Postgres | Pico medido de **16** sobre `max_connections = 100` |
  | Fuga de conexiones entre specs | Serie plana de punta a punta, sin crecer a lo largo de la suite |
  | Postgres rechazando conexiones | **Cero** `FATAL` / `too many connections` en su log; los únicos errores son violaciones de unique de los casos negativos de los propios tests |
  | Re-seed a mitad de suite | `reset-db.sh --verificar` limpio dos veces |
  | El contexto transaccional ALS (ADR-020) | `calcular` corre **fuera** de transacción —el controller llama al service directo—, así que ese camino no cambió con esa tanda |

  **Lo que queda en pie:** una demora transitoria **del lado del cliente** al establecer la
  conexión, que el `connectTimeoutMillis` de 5 s (ADR-020) convierte en error en vez de en
  espera. Es familia de causas, **no causa raíz confirmada**. No se pudo peritar el fallo
  original porque `reset-db.sh` hace `down -v` y el contenedor y sus logs ya no existían.

  ⚠️ **Dos notas de método, que valen más que la entrada:**
  - **Un muestreo de 1 segundo NO alcanza.** Dio pico 9; a 200 ms el mismo escenario dio **16**.
    Una medición de conexiones con resolución de segundo lleva a conclusiones equivocadas sobre
    cuánto margen hay. El comando, para repetirlo:
    ```bash
    while :; do docker exec tecnica_postgres psql -U dev_user -d tecnica_db -t -A -F'|' \
      -c "SELECT now()::time(3), count(*), count(*) FILTER (WHERE state='active') FROM pg_stat_activity;"; sleep 0.2; done
    ```
  - **`concurrencia-pool.e2e-spec.ts` corre al límite exacto del pool, por diseño** (N = tamaño
    del pool). Un test que se sienta en 10/10 está a un hipo de un rojo falso. Es propiedad
    conocida, no regresión.

  ⛔ **Lo que NO hay que hacer: subir el `connectTimeoutMillis`.** Haría desaparecer el síntoma
  y debilitaría la defensa que ADR-020 puso a propósito — que un agotamiento futuro del pool
  falle ruidoso en vez de dejar la API muerta hasta reiniciar.

  🔗 Puede ser pariente del intermitente de autenticación de la entrada de arriba (cuatro
  avistajes): los dos son intermitentes del e2e local, un solo test por corrida, verde al
  repetir. Nada lo prueba todavía.

- [ ] **`descartarDesfases` calcula el costo propuesto con lecturas sin lock, y lo archiva
  como "omitido" cuando ya puede no ser el propuesto** (backend,
  `items.service.ts` → `ItemsService.descartarDesfases`, visto el 2026-08-19 mientras se
  cerraba el orden de locks de esa misma bandeja). El método lee las cabeceras
  (`cabecerasCompuestas`), los ingredientes (`ingredientesPorReceta`) y los componentes
  (`componentesPorCombo`) **sin ningún `FOR UPDATE`**, calcula el propuesto
  (`costoPropuesto` / `costoPropuestoCombo`) y recién entonces escribe
  `costo_propuesto_omitido`. Entre la lectura y el `UPDATE`, un `aplicarDesfases`
  concurrente —o cualquier ajuste de costo de un insumo— puede mover el número, y el
  descarte archiva un propuesto que ya no lo es.
  ℹ️ **Es del molde "no toma lock" de la [sección 5](#5-carreras-de-concurrencia)**, y no
  es lo mismo que el ciclo de orden de locks que sí se arregló: aquel era un deadlock
  (`40P01`); este no abraza a nadie, escribe tranquilo un valor viejo.
  ✅ **Decisión del owner (2026-08-19): se anota, no se arregla en esa pasada.** Poner un
  lock acá es meterse otra vez con el orden de bloqueo de la bandeja, que es justo el
  frente que la tanda 🔴 mandaba aislar.
  **Por qué está en esta sección y no en la 1:** falta medir **qué se ve**. De leer
  `filasDesfaseRecetas` / `filasDesfaseCombos` —que ocultan la fila solo si el propuesto
  recalculado coincide (`eq4`) con `costo_propuesto_omitido`— sale que un omitido viejo
  hace que el ítem **reaparezca** en la bandeja, no que un desfase real quede silenciado.
  O sea: el síntoma probable es "el descarte no pega", que es molesto y no peligroso. Eso
  está **deducido del código, no medido**: montar las dos transacciones y mirar qué queda
  en `costo_propuesto_omitido` es lo primero. Si el síntoma es ese, el arreglo puede ser
  tan barato como releer bajo lock; si aparece un caso donde el desfase se silencia, sube
  de sección y de prioridad.

---

### Las suites del e2e se pisan entre sí por el estado del seed (2026-08-22)

⚠️ **Encuadre, porque la primera versión de esta entrada se llamaba "el `401` fantasma" y eso
mandó a buscar en `auth` durante horas.** El `401` era **un síntoma, no el problema**. El
problema es que las suites del e2e comparten usuarios, ítems y cajas del seed, y una que deja
estado a medias rompe a otra **lejos de donde estaba la causa**.

**Síntomas vistos, todos intermitentes y en suites distintas cada corrida:**

| Suite | Síntoma |
|---|---|
| `costeo-cpp` | `401` en `POST /api/items` con token recién emitido; y `409` al abrir caja |
| `alta-usuarios-tenant` | `401` en `POST /api/auth/register` — **endpoint público, sin ninguna rama que tire 401** |
| `papelera` | `401` en `POST /api/auth/login` con credenciales del seed — 20 tests detrás |
| `rbac-y-contrasena` | `401` al loguear un usuario **recién verificado** (el `verificar` dio 200 en la línea anterior) |
| `reglas-valor` | `401` en un `PATCH` con un Bearer que la misma suite venía usando |
| `inventario` | `costoActual` en `undefined` — **no es un 401**, y es lo que muestra que la familia es más ancha |

**Dos causas ya encontradas y arregladas** (las dos en `visibilidad-ventas-pagos.e2e-spec.ts`,
las dos aplican a cualquier spec nuevo — por eso quedan acá y no solo en el commit):

1. **`app.close()` fuera del `finally`.** Si la limpieza tiraba, la app **no se cerraba**, y
   `AppModule` registra un `@Cron` (`expirar-ordenes`, cada 10 min) que **sobrevive al teardown
   de Jest** y sigue pegándole a la base desde un módulo desmontado, mientras corren OTRAS
   suites. Medido: `"You are trying to require a file after the Jest environment has been torn
   down"`, con el cron disparando a las 22:20:00 y 22:30:00. **Regla: en todo e2e, el
   `app.close()` va en un `finally`.**
2. **Tratar como error el `400` de la fase 2 de cierre.** `POST /:id/conteo` **auto-cierra si
   el arqueo cuadra**; solo deja `en_conciliacion` si algo descuadra. Un `cerrar` incondicional
   después pega contra una caja ya cerrada y responde `400 "La caja no está en conciliación"`,
   que es **inofensivo**. Tratarlo como falla abortaba la higiene y dejaba la caja del OTRO
   usuario abierta → `409` en la suite siguiente. El helper que sí lo hace bien, y que conviene
   copiar, es `liberarCajeroSiQuedoOcupado` en `caja.e2e-spec.ts` (best-effort en los pasos
   intermedios, y maneja descuadres con motivo).

**Efecto medido de los dos arreglos:** de **3 de 5** corridas completas en rojo a **1 de 10**, y
**el `401` no volvió a aparecer**. ⚠️ **No está probado que la fuga de la app lo causara**: nunca
se explicó el mecanismo —`JwtStrategy` es *stateless*, y con sondas puestas en `validateUser` y
en el `JwtAuthGuard` no se logró atrapar ninguno— y el cron no toca nada de auth: lee
`pasarela_ordenes` y `pasarela_transacciones`, y escribe una fila en `cron_ejecucion` en **cada**
tick. Es más de lo que parece —el módulo desmontado seguía escribiendo—, pero ninguna de las
tres tablas tiene camino a una falla de auth. **Dejó de reproducirse, que no es lo mismo que resuelto.**

**Lo que queda abierto:** la falla de `inventario` (`costoActual: undefined`), que **pasa sola**
y no la toca ningún diff reciente. Y la pregunta de fondo: hoy 42 archivos de test comparten
`admin.paris@paris.cl` y 13 `vendedor@paris.cl` (12 de ellos ajenos a este frente), con `maxWorkers: 1` como única red. Mientras
siga así, cualquier spec nuevo puede destapar esto de nuevo.

**Descartado con evidencia, para no rehacerlo:** no es re-siembra (`reset-db.sh --verificar`
justo después de una corrida roja: *"1 solo 'Seed complete'"*); no es estado corrupto (los dos
usuarios del seed quedaron con `correo_verificado_el` puesto, `eliminado_el` nulo y el hash
intacto); no es vencimiento ni firma (`JWT_EXPIRATION=15m` contra corridas de ~115s, y ningún
spec toca `process.env`); no hay throttler; y el `DeprecationWarning` de `pg` que aparece ~45
veces por corrida **no es evidencia de nada**: sale del `Promise.all` interno de TypeORM en
`DataSource.synchronize`, una vez por app de test (ya medido el 2026-08-21), y su conteo es
casi idéntico con y sin el spec nuevo (45 vs 44).

## 3. Ya decidido, falta construir

El owner ya contestó lo que había que contestar. **No son mecánicas** —tienen diseño
adentro, y alguna quedó a medias a propósito— pero nadie está esperando una respuesta para
empezarlas.

- [ ] **Dos mensajes de las reglas dicen algo que no siempre es cierto** (backend, medidos
  contra la API viva el 2026-08-23 al cerrar el corte de `valor` en dos columnas → ver
  [`resueltos.md`](resueltos.md)) — ninguno es fuga ni persistencia mala: los dos caminos
  rechazan bien con 400. Es diagnosticabilidad, y salen los dos en una pasada.

  1. **El `create` y el `update` validan en orden inverso, y el comentario del `create`
     declara un principio que su gemelo no cumple.** En `validarSegunTipoCreate` se puso
     `validarMontosDeRegla` **antes** del chequeo de "el valor es requerido", justamente para
     que quien manda la columna equivocada no reciba *"el valor es requerido"* habiendo
     mandado un valor. En `validarEstadoResultante` quedó al revés
     (`descuentos.service.ts:617` antes de `:638`, gemelo en `recargos.service.ts:574`
     vs `:590`), así que `PATCH {"valorPorcentaje": null, "valorMonto": "5000"}` sobre una
     regla de porcentaje contesta *"El valor es requerido para este tipo"*. El frontend no
     manda esa forma —arma una sola columna—, así que muerde a clientes de API.
  2. **El mensaje del tramo habla de un `PATCH` y de "tramos guardados" también en un
     `POST`** (`common/utils/monto-regla.util.ts:76,83`), donde no hay nada guardado y el
     cliente acaba de mandar el tramo en el body. La frase es un condicional, así que no
     afirma algo falso, pero la segunda mitad es ruido en el POST y **ningún test la
     cubre**: el e2e ancla solo la primera mitad. `validarExpresion` ya recibe un
     discriminador `donde` (regla/tramo); le falta el equivalente de POST/PATCH, o cortar la
     frase.

  ⚠️ **Por qué está acá y no se arregló en el momento:** el diff ya tenía el LIMPIO de la
  revisión independiente atado por hash, y tocarlo lo invalidaba. Son de mensaje, no de
  conducta.

- [ ] **La nota de crédito miente distinto sobre la misma línea de receta** (backend,
  medido 2026-08-22 al cerrar la anulación; el owner decidió que **va aparte**, no de
  arrastre) — el camino de la NC usa `LEFT JOIN item_producto` (`ventas.service.ts:1390`,
  y el gemelo del reembolso en `:1676`), así que la línea de receta **no** desaparece como
  desaparecía en `cancelar`: cae en la rama `modo_inventario === null` y responde *"no
  maneja stock (servicio): no admite devolución a inventario"*. Para una receta ese
  mensaje es **falso** — no es un servicio, tiene ingredientes que sí salieron del
  inventario y que hoy no vuelven por ningún camino.
  **El arreglo ya existe del otro lado y está probado:** `cancelar` revierte leyendo las
  salidas del kardex por `venta_id`, que cubre recetas, combos y opciones de grupo sin
  casos especiales. La NC podría usar la misma fuente, acotada a las líneas devueltas.
  **La pregunta para el owner:** la NC devuelve **por línea elegida** (`devoluciones`),
  no la venta entera. Para un producto la correspondencia línea→stock es directa; para una
  receta hay que decidir si devolver una unidad de "Hamburguesa" repone sus ingredientes
  —simétrico con la venta— o si se rechaza explícito.
  ✅ **DECIDIDO (owner, 2026-08-23): ni una cosa ni la otra — se pregunta.** Al hacer la nota
  de crédito, el sistema pregunta **si el producto se recupera o se pierde**. Si se recupera,
  repone; si no, **sale como merma**. Es lo fiel a un local de comida: una hamburguesa ya
  armada no vuelve a ser pan y carne, pero una que nunca salió de la cocina sí.
  ✅ **La pregunta aparece SIEMPRE que haya stock de por medio**, no solo en recetas y combos:
  también en el producto suelto, porque la botella puede volver rota. Una sola regla, sin
  excepción que explicar.
  ⚠️ **Al construir:** la merma ya existe y **pide causa**, así que hay que definir con qué
  causa entra la que nace de una devolución —o si se crea una— antes de escribir el flujo.
  Y sigue en pie que toca `movimientos_inventario` y el camino del reembolso de pasarela.

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
  ✅ **DECIDIDO (owner, 2026-08-15): el modelo distingue el nivel de la regla** — si aplica por
  línea o por venta— y el modal dice lo que corresponde en cada caso, en vez de "afecta 0 ítems".
  ⚠️ **Es un campo nuevo en `descuentos`/`recargos`, así que arrastra más de lo que parece:** el
  motor tiene que respetarlo (una regla de venta no debería poder asociarse a un ítem, ni al
  revés), el seeder tiene que declararlo en cada fila, y las pantallas de administración tienen
  que ofrecerlo. **Hoy es teórico** —ninguna pantalla manda reglas a nivel venta, medido— así que
  se puede planificar sin apuro; lo que no conviene es construir el productor antes que el campo.

- [ ] **Lo que quedó del frente del modo ciego, ya cerrado** (backend + producto; la entrada
  madre —seis fugas, el eje mío/todos y el rastro de los oráculos— se mudó entera a
  [`resueltos.md`](resueltos.md) § *"El modo ciego deja de prometer lo que no sostiene, y los
  oráculos dejan rastro"* el 2026-08-23) — dos residuos, ninguno urgente:
  1. **El `400` *"Método de pago no pertenece al arqueo"* sigue siendo un oráculo de presencia
     por medio de pago**, pero cada sondeo exitoso **cierra la caja**: es de un solo uso y no se
     tocó. Se anota para que nadie lo redescubra como fuga nueva.
  2. **El historial de cajas del cajero** (pedido del owner el 2026-08-22: bloquearlo): ya no
     está ordenado detrás de ninguna decisión —la salida (c) para la caja propia y el rastro
     para los oráculos ya están—. Lo que falta es solo decidir si se construye; hoy el cajero
     con `MiCaja` ve el acumulado de sus propios turnos, que es su propia plata.

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
  ✅ **DECIDIDO (owner, 2026-08-15): sin cobro real, la venta queda `pendiente`, no `pagada`.**
  Es el punto 2 de esta entrada —el defecto que existe se configure o no la pasarela— y se
  arregla ya: el estado `pendiente` ya lo soporta el modelo.
  ℹ️ **No se saca el camino simulado** (dejaría sin tienda a cualquier tenant que todavía no
  configuró nada) ni se encara todavía la configuración de medios online, que sigue siendo
  feature con spec propia.
  ⚠️ Al hacerlo, mirar el `metodoTarjeta()` que hoy elige método buscando "crédito" en el nombre
  y **agarra `metodos[0]` si no encuentra**: con la venta en `pendiente` puede que ni corresponda
  registrar un método. Y la pregunta de cobertura e2e de esta entrada sigue abierta: la pantalla
  no la alcanza nada automático.
  ⛔ **BLOQUEADA al intentar construirla (2026-08-16): la decisión choca con un invariante que
  ya existe, y hay que resolver el choque antes de escribir nada.** `ventas.service.ts:387-395`
  rechaza con `400` *"Las ventas online requieren el pago completo"* cualquier venta
  `canal='online'` cuyos pagos no cubran el `totalFinal`. O sea que **una venta online no puede
  quedar `pendiente` hoy, por diseño** — el comentario de la línea 385 lo dice con todas las
  letras: *"online no admite cuenta por cobrar"*.
  Se implementó la pantalla mandando la venta sin pagos, y **todo checkout simulado pasó a
  fallar con ese 400** (medido, no deducido). Se revirtió.
  **Lo que hay que decidir antes de retomarla:** ¿se afloja la regla para que una venta online
  pueda nacer `pendiente`? Aflojarla de plano habilita crear ventas online impagas **por
  cualquier camino**, incluido el de la pasarela real — que es justo lo que la regla protege.
  Las alternativas que se ven: (a) un estado/flag propio para "pedido sin pasarela conectada",
  (b) que el backend distinga el caso por config del tenant en vez de que lo decida el
  frontend, o (c) asumir que sin pasarela conectada la tienda online no debería estar
  disponible. Ninguna es una corrección: las tres son producto.
  ℹ️ **Lo único de esta entrada que sí se cerró** (2026-08-16, con la entrada de la venta de
  total $0): el carrito de $0 ya no manda `monto: '0'` contra `@IsDecimalPositivo`. Ese caso
  pasa el guard de arriba sin tocarlo, porque `0 ≥ 0`.

- [ ] **Los dos tipos "por método de pago" ignoran los tramos y cobran el valor único** (backend,
  parte 2 de *"la plomería de tramos en `recargos`"*; la **parte 1 salió el 2026-08-22** →
  [`resueltos.md`](resueltos.md)) — el tipo por escalones ya existe
  (`recargo_por_monto_venta`) y salió **sin tocar el motor**, como estaba medido. Lo que
  queda son los dos tipos que el motor **no** lleva a la rama de tramos:

  | Tipo | Clase | Con tramos hoy |
  |---|---|---|
  | `recargo_metodo_pago` | recargo | **ignora los tramos y cobra el `valor`** |
  | `metodo_pago` | descuento | **ídem** — es el gemelo, los dos están en `METODO_PAGO_CODIGOS` |

  ⚠️ **Corregido el 2026-08-23 contra el código, y el dato viejo llegó a estar en tres
  archivos:** esto decía *"cobran cero en silencio"* y que el `valor` era null. **Las dos son
  falsas.** Los dos tipos están en `TIPOS_CON_VALOR_UNICO`, así que el backend les **exige**
  `valor` y el motor cobra ese; para llegar a cero habría que sacarlos también de esa lista. Lo
  que pasa con escalones es que se configuran, se muestran y **el cálculo no los mira**.
  📌 Y son **dos**, no uno: hasta esa fecha la entrada nombraba solo el recargo. Habilitar
  tramos en uno y no en el otro deja la mitad del bug.
  📌 **`mora` salió de esta entrada:** no era un caso de tramos sino de **tiempo**. Vive en
  *"Cinco tipos de regla no hacen lo que la pantalla promete"*, más abajo.
  Lo que necesitan los dos: que su rama siga hasta los tramos en vez de retornar.
  ⛔ **Toca el motor de precios: se confirma con el owner antes de escribir.**

- [ ] **Un tramo no puede valer cero, y no hay `maximo`: "gratis sobre $X" no se expresa**
  (backend + producto, medido el 2026-08-22 al construir el recargo por escalones) — los
  tramos son **abiertos hacia arriba** (solo `minimo`) y `validarMontosDeRegla` exige
  `valor > 0`. Con eso un recargo escalonado puede **bajar** ($2.000 bajo $20.000 → $500
  arriba) pero no **llegar a cero**, que es justo la forma del caso más común —envío gratis
  sobre cierto monto, recargo por pedido chico que desaparece—.
  ℹ️ Este documento afirmaba que los tramos tenían `maximo` nullable: **nunca existió**, ni
  en las entidades ni en `startup-pos.sql`. Ya se corrigió en
  [`features/descuentos-recargos.md`](../features/descuentos-recargos.md).
  **Las dos salidas son de producto, no correcciones:** (a) permitir `valor = 0` en un
  tramo, o (b) agregarle `maximo` al tramo. Las dos afectan **también a descuentos**, que
  comparten la validación y el modelo.
  ✅ **DECIDIDO (owner, 2026-08-23): la (a) — un tramo puede valer cero.** No se agrega
  `maximo`: los tramos siguen abiertos hacia arriba. Con eso "envío gratis sobre $30.000" se
  expresa como un tramo de valor 0, que es la forma del caso más común.
  ✅ **Y cómo se ve, decidido en la misma pasada: un recargo que quedó en cero NO aparece en
  la boleta.** Nada de líneas en `$0` ni de la palabra "gratis" — el documento queda limpio.
  ⚠️ Ojo al construir: `validarMontosDeRegla` exige `> 0` y la comparte con descuentos, así
  que aflojarla toca los dos. Un descuento de cero es inocuo, pero conviene que sea una
  decisión y no un efecto secundario.
  🔄 **La validación cambió de forma el 2026-08-23** y esta entrada hay que leerla con eso:
  ya no recibe un `valor` suelto sino `{ valorMonto, valorPorcentaje }`, el `> 0` vive en
  `validarMonto(unidad, valor)`, y **hay una segunda función, `validarTramo`, que además
  exige que el tramo traiga exactamente una de las dos columnas**. Permitir el cero toca las
  dos: aflojar el `> 0` sin mirar `validarTramo` deja "sin importe" y "importe cero"
  indistinguibles, que no es lo que se decidió. Ver
  [`resueltos.md`](resueltos.md) § *"El importe de una regla deja de ser ambiguo"*.

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

  ✅ **PIEZAS A y B CONSTRUIDAS el 2026-08-16.** `CuentaLineaDetalle` ya expone
  `cantidadEnviada`, y los dos caminos están bloqueados con `400`: `quitarLinea` rechaza si
  `cantidad_enviada > 0` —antes hacía `softDelete` por criterio, sin leer la fila— y
  `actualizarLinea` rechaza bajar por debajo de lo despachado. Subir sigue libre, y bajar
  hasta lo despachado también. En la pantalla el tacho queda deshabilitado con el motivo.
  Detalle en [`features/salones-mesas.md`](../features/salones-mesas.md).

  ⏳ **Lo que sigue abierto es lo que esta entrada siempre dijo que faltaba: el camino con
  motivo.** Bloquear evita la pérdida silenciosa; **no da la salida legítima**. Un plato que
  se quemó o que se regala tiene que poder salir de la cuenta **con motivo** (merma o
  cortesía), y eso es lo que falta diseñar — ahí sí entra la investigación de mercado
  (Toast, Square y Lightspeed manejan *voids* de ítems despachados). Sin eso, hoy el garzón
  que se equivocó de plato después de mandar la comanda no tiene ninguna salida.

  🔗 La pieza **C** de la partición (el default destildado del modal de anulación) se
  **construyó el 2026-08-23** — ver [`resueltos.md`](resueltos.md) § *"El checkbox de
  anulación nace destildado si algo ya salió a cocina"*. Lo que sigue abierto acá es solo la
  salida con motivo: son cosas distintas, la C decide qué llega tildado a la pantalla de
  anulación y esta le da al garzón una forma legítima de sacar un plato ya despachado.

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

- [ ] **La nota de crédito no es un documento todavía: es un monto libre con líneas
  informativas** (backend, decisión g) — lo medido, no una impresión: la cabecera toma el
  monto que manda el cliente, `totalImpuestos: '0'` fijo (`ventas.service.ts:1023`), y las
  líneas no tienen relación exigida con ese monto. Falta el **desglose de IVA** y el
  **cuadre cabecera↔líneas**.
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

- [ ] **Los ~30 DTOs con `@IsNumberString` sin trazar hasta su punto de persistencia**
  (backend, decisión d) — medidos: **66 usos, 29 evidentemente plata**. `@IsNumberString`
  dice que es un número, no que quepa en la moneda; la misma auditoría que destapó este
  frente podría encontrar más sitios donde el redondeo real lo sigue haciendo Postgres.
  **Es un barrido, no un arreglo puntual**, y por eso no entró: el criterio para cada campo
  es *monto cobrado* vs *tasa*, que es exactamente donde la spec de este frente se
  contradijo a sí misma y hubo que corregirla al ejecutar.
  ⚠️ **Buscar por conducta, no por decorador**: un campo puede estar sin marcar y aun así
  cubierto porque su handler no lo persiste, y otro marcado puede no tener el pipe colgado.
  El estado de partida está en [`patterns/backend.md` §3.1](../patterns/backend.md).

- [ ] **`grupos-modificadores` sigue sin `MoneyInput`, y es el único que no se puede
  resolver solo** (frontend + producto; `mermas` y los campos de `items` **salieron el
  2026-08-22** → [`resueltos.md`](resueltos.md)) — `MoneyInput` necesita una moneda para
  resolver separadores y locale, y esta pantalla **no menciona moneda en ningún lado**: sus
  opciones aplican a ítems que pueden estar en monedas distintas (`precioExtra`,
  `lotePrecio`).
  Usar la oficial del tenant daría los **separadores equivocados** para un ítem en moneda
  extranjera, o sea cambiar un campo sin ayuda visual por uno con ayuda visual **mal**.
  **La pregunta para el owner:** una opción de grupo que se aplica a ítems en monedas
  distintas, ¿tiene moneda propia, hereda la del ítem al que se aplica (y entonces el campo
  no puede tener una sola máscara), o se asume la oficial del tenant asumiendo el error en el
  caso multi-moneda? Las tres cambian el modelo, no la pantalla.
  ℹ️ **No bloquea nada:** la escala la sigue validando el backend con `@EsCosto()` (escala 4).
  Lo que falta es ayuda visual, no control.
  ⚠️ Quien lo tome: el campo va con el prop `decimales` en **4**, no con los decimales de la
  moneda, porque `@EsCosto()` es escala fija.

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
  ✅ **La otra mitad ya está cerrada (2026-08-15, ver `resueltos.md`):**
  `POST /auth/switch-tenant` exige ahora también la cookie de refresh, y de una sesión viva
  del mismo usuario, así que un access token filtrado —venga de Google o no— dejó de poder
  convertirse en sesión renovable.
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

---

## 4. Necesita que el owner conteste

Cada una lleva su pregunta concreta adentro. Mientras no se conteste **no se empiezan**:
elegir por cuenta propia una regla de negocio no documentada es justo lo que `CLAUDE.md`
prohíbe.

✅ **La sección pasó de 29 entradas a 1 el 2026-08-15**, en una tanda de decisiones del owner;
volvió a poblarse con lo que fueron destapando las tandas siguientes (identidad el 2026-08-16,
redondeo de plata el 2026-08-21) y con dos entradas que **subieron desde la sección 2** al
medirlas y caer del lado que exige respuesta.

✅ **Segunda tanda completa el 2026-08-22: las 7 entradas abiertas se contestaron de una.**
Ninguna se quedó sin destino, y cada una se mudó **con su decisión escrita y con las trampas
que el que la tome se va a encontrar**:

| Entrada | Decisión | Dónde quedó |
|---|---|---|
| `ItemsController` y el `Scope.REQUEST` | Spike de contexto en ALS primero; partir el controller es el plan B | **Resuelto el 2026-08-22**: el spike salió, se migró y el plan B no hizo falta ([`resueltos.md`](resueltos.md)) |
| El `valor` de descuentos y recargos | Se parte en `valor_monto` / `valor_porcentaje` | **Construido el 2026-08-23** ([`resueltos.md`](resueltos.md)) |
| El garzón "Mostrador" | Cuelga de `Propinas`, no de `Salones` | **Sección 3** |
| El borde `hasta` de los filtros de fecha | Inclusivo del día, resuelto en el backend | **Construido el 2026-08-22** ([`resueltos.md`](resueltos.md)) |
| La pasada de auditoría de las dos lentes | Las dos, tope 500k, sin arreglar nada | **Corrida el 2026-08-22** → 0 hallazgos ([`resueltos.md`](resueltos.md)) |
| Los roles de un alta pendiente | Siguen sin ser editables, y eso pasa a ser regla escrita | **Cerrada** → [`resueltos.md`](resueltos.md) |

ℹ️ **Dos entradas cambiaron de premisa al contestarlas, y la corrección viaja con ellas:** la
del `Scope.REQUEST` daba por conocido que bastaba con no colgar el pipe del handler de lectura
—no aplica, el contagio es del controller y alcanza a **once**—, y la de la auditoría decía
que lo pendiente del pool era el frente 🔴, **cerrado el 2026-08-20**.

**Queda 1 entrada**, y no espera una respuesta sino la **investigación de mercado que la
destraba, lanzada el 2026-08-22**.

- [ ] **Una nota de crédito no descompone su monto: registra `total_impuestos = 0`**
  (backend, medido 2026-08-02, **cruzado contra el código el 2026-08-22** sobre
  `ventas.service.ts:982` `crearNotaCredito` — la cita vieja decía `:854`, que hoy es otra
  cosa) —
  **⛔ Toca materia fiscal: no avanzar sin decisión del owner** (`CLAUDE.md` → detenerse
  ante impuestos y documentos tributarios; ver **ADR-010**).
  **Lo medido, sin interpretar:** la NC construye su fila de `ventas` **directo**, no por
  `crearEnTransaccion`, y hardcodea `totalDescuentos: '0'`, `totalRecargos: '0'` y
  `totalImpuestos: '0'`, con `totalBruto = totalFinal = params.monto`. Consecuencias
  encadenadas: (a) cero filas en `ventas_descuentos`/`ventas_recargos`/`ventas_impuestos`,
  así que la NC no dice qué reglas revierte —se llega por la venta que referencia—;
  (b) ~~`config_calculo` queda `null` en toda NC~~ — **falso desde el 2026-08-21**: la NC
  **hereda** el criterio del documento que corrige (`cfgOriginal = original.config_calculo`,
  `:1035`), y el camino manual falla ruidoso si falta (decisiones P4/P5 del frente de
  redondeo). Verificado el 2026-08-22, se corrige acá porque este archivo es texto vivo;
  (c) `base_ventas_sin_impuestos` **sigue** quedándose en el default de la columna —se llena
  solo en `crearEnTransaccion` (`:472`, `:491`), que la NC no usa—, y ese campo lo consume
  `liquidacion-propinas.service.ts`.
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
  🔎 **El owner pidió una investigación de mercado antes de decidir (2026-08-15).** Es materia
  fiscal, no es obvia, y el owner no es experto del dominio — el caso exacto que
  [`investigacion-mercado.md`](investigacion-mercado.md) contempla. ✅ **Corrida y cerrada el 2026-08-22**:
  [`investigaciones/2026-08-22-descomposicion-nota-credito.md`](investigaciones/2026-08-22-descomposicion-nota-credito.md),
  con el Formato DTE v2.5 leído completo como fuente primaria.

  **Lo que trajo, y que mueve la pregunta de lugar** (insumo, no decisión — la regla del cruce
  sigue en pie: si el mercado dice A y el owner dice B, gana B):
  - **El SII no obliga a descomponer, pero tampoco valida.** En un DTE 61 solo `MntTotal` es
    obligatorio incondicional; `MntNeto`/`MntExe`/`IVA` son **condicionales**, y el validador
    del SII *"no rechaza documentos por errores de contenido… como que el IVA no sea igual a
    la tasa por el monto neto"*. O sea: el argumento a favor de descomponer **no puede ser
    "si no, el SII lo rechaza"** — sería declarar un documento descuadrado que se acepta igual.
  - **Nadie en el mercado resuelve nuestro caso.** Ninguno de los 7 productos relevados
    documenta prorrateo de un monto libre: Square y Toast lo excluyen del desglose fiscal,
    Clover lo prohíbe por API y obliga a itemizar, Bsale se lo deja a un humano por
    transacción. Anotado en [`DIFERENCIADORES.md`](../DIFERENCIADORES.md) como hallazgo, no
    como logro: hoy es un hueco que compartimos.
  - 🆕 **Un hueco que esta entrada no tenía:** la zona **Detalle es obligatoria en los diez
    tipos de documento del DTE, NC incluida** — y hoy, con `devoluciones` vacío,
    `crearNotaCredito` inserta **cero filas** en `venta_detalles` (verificado: las líneas
    salen de `validarDevolucionesReembolso(..., params.devoluciones ?? [])`, `:1053`). Una NC
    por monto puro no tendría con qué armar la zona Detalle el día que se integre el SII.

  **Las 6 preguntas abiertas quedan en la §8 de la investigación** y no se copian acá para no
  duplicar la fuente. La que las destraba a todas es la primera: **¿la NC por monto pasa a
  declarar neto/exento/IVA, o se mantiene fuera del motor como hoy?** Las otras cinco
  —prorrateo vs. exigir líneas, qué hacer con la zona Detalle vacía, sobre qué base prorratear,
  quién decide si lleva IVA, y si conviene partir "NC itemizada" de "NC por monto libre"—
  dependen de esa respuesta.
  ⚠️ **Sigue sin decidirse, y sigue sin empezarse:** es materia fiscal y `CLAUDE.md` obliga a
  parar. Lo que cambió es que ahora la decisión tiene material abajo.

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

⚠️ **Corregido el 2026-08-18** (la versión anterior de esta nota se contradecía sola —
decía "ninguno de estos moldes" y dos líneas después describía uno de ellos): los dos
ciclos de la entrada residual que entonces vivía al principio del archivo ("Dos ciclos de
orden de lock en la bandeja de desfases de combos…", hoy cerrada y mudada a
[`resueltos.md`](resueltos.md)) **son estos mismos dos moldes**, no uno nuevo — el
ciclo `item_receta` ↔ `item_combo` es "no toma lock" (`descartarDesfases` no bloquea nada) y
el ciclo `items` ↔ `item_combo` es "lockea en orden no determinista" (`aplicarDesfases` y
`update()` de un combo toman los mismos locks en orden inverso). Lo que separa a esa entrada
de las cuatro de acá **no es la familia de bug — es la tabla y el disparador**: acá es
caja/inventario/stock; ahí es `items`/`item_receta`/`item_combo` en la bandeja de desfases.
(Los otros dos puntos de esa entrada residual —el `FOR UPDATE` antes de validar tenant, y el
hueco de test de N combos— no son de ninguno de los dos moldes.)

ℹ️ **2026-08-20:** esa entrada residual **se cerró** y vive en
[`resueltos.md`](resueltos.md) § "El orden de bloqueo de filas de la bandeja de
desfases". Lo de arriba se conserva porque la clasificación por moldes sigue siendo cierta
y es la que hay que aplicarle a las cuatro de acá. Cómo quedó el "no toma lock" del molde
2: `descartarDesfases` sigue sin tomar un solo `FOR UPDATE` —el arreglo no fue agregar
locks sino **fijar el orden en que sus `UPDATE` los toman solos**—, y el orden canónico del
proyecto está escrito en [`../patterns/backend.md`](../patterns/backend.md) § "Orden de
bloqueo de filas en ítems compuestos". Es el precedente más cercano que tienen las cuatro
entradas de esta sección.

- [ ] **Los tres caminos que revierten stock no tienen la protección de deadlock que su gemelo
  `crear()` sí tiene** (backend, auditoría `inventario` 2026-08-15) — es otro molde que los tres
  de arriba: acá el lock **sí** se toma, lo que no es determinista es **el orden**.
  `registrarMovimiento` toma un `FOR UPDATE` sobre `item_producto` **por ítem**, o sea N
  statements separados. `crear()` lo sabe y lo resuelve con dos capas —orden determinista por
  `itemId` (`ventas.service.ts:618-626`) y reintento ante `40P01`
  (`MAX_REINTENTOS_DEADLOCK`)—, y su propio comentario explica que el deadlock era real.
  ✅ **`cancelar` salió el 2026-08-22**, dentro del frente de la reposición de recetas: son
  las mismas líneas, y dejarlo para después significaba volver a tocarlas. Ordena por
  `itemId` con `localeCompare` —el mismo comparador que `crear()`— y reintenta ante
  `40P01`. Detalle en [`resueltos.md`](resueltos.md). **Quedan los otros dos**, y el
  arreglo es el mismo.
  Los caminos inversos no tenían ninguna de las dos: `cancelar` (`:845`) hacía un `SELECT`
  **sin `ORDER BY`** y recorría lo que devolviera Postgres; `crearNotaCredito` (`:984`) y
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
  y el wrapper `esDeadlock`). `RecuentosService.aplicar` ya hace exactamente esto, y desde el
  2026-08-22 `cancelar` también — hay de dónde copiar, con sus tests al lado.
  ⚠️ **Al copiarlo, copiar el comparador:** `localeCompare`, no un `ORDER BY` de Postgres.
  Si los caminos ordenan distinto entre sí, el cruce que el orden fijo evita vuelve a existir.

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

ℹ️ Si algún día se evalúa cambiar el ORM, el candidato es MikroORM (resuelve el contexto
transaccional nativo, con ALS — [ADR-020](../adr/020-contexto-transaccional-als.md));
Prisma y Drizzle tienen el mismo modelo manual de transacciones que TypeORM. No es un
pendiente de este trabajo, es la nota que ADR-020 deja para no repetir la evaluación.

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
  ✅ **DECIDIDO (owner, 2026-08-15): se construye el soporte, no se cierra la puerta.** La merma
  pasa a pedir **qué unidad o qué lote** se da de baja, igual que ya hacen la venta y el
  recuento con lo suyo. Por eso esta entrada **se mudó a "proyectos que van solos"**: dejó de ser
  una corrección y pasó a ser feature con pantalla, DTO y spec propia.
  **Lo que la spec tiene que resolver, y que no hace falta contestar ahora:**
  - El **selector** en la pantalla de mermas: qué se muestra para elegir una serie entre muchas.
  - Los **índices únicos** que la doc promete y no existen en ningún lado (ni entidad, ni seeder)
    — sin ellos se puede cargar el mismo IMEI dos veces, y eso hay que cerrarlo antes de que la
    merma dependa de elegir una serie concreta.
  - **`fecha_vencimiento`**: hoy se guarda, se expone y no se compara con nada; la salida
    automática es FIFO por antigüedad, no FEFO por vencimiento. **¿Un lote vencido se puede
    vender y mermar, o se bloquea?** Es regla de negocio y no está en `PRODUCTO.md` — la spec la
    plantea, no la asume.
  ⚠️ Y queda igual la corrección barata que da la mitad del beneficio si esto se demora: que la
  merma **rechace** serie/lote en vez de aceptar y descontar la unidad equivocada en silencio.

- [ ] 🔵 **Decimales, redondeo y unidades de cuenta — tema propio, EN CURSO** (backend + BD +
  producto, abierto por el owner el 2026-08-15) — **el tema activo.** Es la tercera pata de la
  tanda 🔴 (*"redondeo de plata"*), acá con el alcance completo y medido.

  > 🛑 **DÓNDE QUEDÓ (2026-08-15).** La investigación está **corrida, cerrada y commiteada**;
  > el cruce contra el código también. **El owner la pausó acá para analizarla mejor antes de
  > decidir** — no es un bloqueo del trabajo, es una pausa pedida.
  > **Al retomar:** leer
  > [`investigaciones/2026-08-15-decimales-y-redondeo.md`](investigaciones/2026-08-15-decimales-y-redondeo.md)
  > entero y arrancar por **las cinco preguntas de su §9**. Hasta que estén contestadas **no
  > se escribe spec ni se toca código**: esto es el motor de precios e impuestos, y `CLAUDE.md`
  > obliga a consultar. La primera pregunta destraba a las otras cuatro.
  > Lo de abajo es el material que la investigación usó como punto de partida; lo que la
  > investigación **corrigió o agregó** está más abajo, en el bloque ✅ de resultados.

  **El criterio del owner:** *"los redondeos son para montos; hay cosas que no se deben redondear
  con la configuración"*, y **tiene que ser un solo criterio para todo el sistema**, contemplando
  que es multi-país y multi-moneda.

  **Los TRES momentos donde un número se recorta, medidos:**

  | Momento | Quién lo gobierna hoy | Estado |
  |---|---|---|
  | Cálculo intermedio | `tenants.escala_calculo` (smallint, hoy **6**) | ✅ Definido: el esquema lo llama *"decimales para cálculos intermedios"* — el borrador con el que el motor arrastra reglas sin acumular error |
  | Lo que se persiste | `ESCALA_PERSISTIDA = 4` + `tenants.modo_redondeo` | ⚠️ Aplicado **solo** en `convertirAMonedaOficial`. `subtotal` y `total_linea` salen del motor con 6 decimales y entran a `NUMERIC(18,4)`: **lo recorta Postgres**, con su regla, fuera de la config del tenant |
  | **Lo cobrable** | **nadie** | ❌ `moneda.decimales` existe y solo lo usa propinas. Webpay y Oneclick **rechazan** (*"CLP no admite decimales en el monto"*) en vez de que el sistema redondee |

  ✅ **Lo que ya está bien y no hay que tocar:** `redondear()` se usa **exactamente 3 veces** en el
  motor (`calculo-precios.engine.ts:453, 520, 581`) y las tres son **montos** —el monto de una
  regla, el subtotal neto, el monto de un impuesto—. No toca porcentajes, ni tasas, ni cantidades.
  El criterio del owner **ya se respeta ahí**; lo que falta es el tercer momento.

  ✅ **Y el argumento que hay que conservar** (docblock de `convertirAMonedaOficial`): redondear a
  `escalaCalculo` en vez de a la escala persistida **no evita el recorte, lo mueve al `INSERT`**,
  donde lo hace Postgres sin que ningún test lo vea. Vale para `subtotal`/`total_linea` igual que
  para `precio × tasa`, y ahí no se aplicó.

  **Lo que el catálogo tiene hoy** (medido contra la base): tres monedas, **`CLP` 0 decimales,
  `USD` 2, `UF` 4**, las tres mapeadas a Chile. Un solo país sembrado.

  ⚠️ **La UF abre un problema de modelo, no de redondeo.** Está en la misma tabla que CLP y USD,
  **sin nada que la distinga** — pero no son la misma clase de cosa: en UF se **cotiza**, en pesos
  se **cobra**, y nadie paga en UF. Hoy nada impide ponerla como moneda oficial de un tenant, y
  ahí los totales se persistirían en una unidad en la que la pasarela no puede cobrar.

  ⚠️ **Y `tenant_moneda` no puede representar "la tasa de hoy".** La tabla es PK
  `(tenant_id, moneda_id)` + `valor_del_dia numeric(18,6)`, **sin ninguna columna de fecha**
  (verificado con `\d`): una sola tasa por moneda, que se pisa. La UF cambia **todos los días** y
  la publica el Banco Central, así que un tenant que cotice en UF tendría que actualizarla a mano
  cada mañana sin nada que le avise que quedó vieja.
  ✅ **Lo que sí está a salvo:** la venta **congela `tasa_cambio` por línea**, así que una venta
  vieja sabe con qué tasa se hizo. Lo que no se puede contestar es *"cuánto valía la UF el 1 de
  agosto"* para algo que no sea una venta ya registrada — un reporte, una nota de crédito, la
  renovación de una suscripción.

  ⛔ **NO es una investigación del mercado de restaurantes — es financiera en general**
  (corrección del owner, 2026-08-15). Cómo lo hace un POS es **un insumo más, no la fuente**.
  Representar plata, redondearla y manejar unidades indexadas son problemas **ya resueltos y
  estandarizados** fuera de este dominio, y ahí hay que ir primero:
  - **ISO 4217** define, junto con el código de cada moneda, su **minor unit** — cuántos decimales
    tiene. Es la respuesta autoritativa a "¿cuántos decimales tiene esta moneda?", y hoy el
    proyecto la tiene copiada a mano en `moneda.decimales` para tres monedas.
  - **Las redes de pago** (ISO 8583 y las APIs de tarjetas) expresan los montos **en unidades
    mínimas** —centavos, no pesos— y eso no es negociable: es la restricción dura del momento
    "cobrable". Explica por qué Webpay rechaza un CLP con decimales en vez de redondearlo.
  - **El patrón `Money`** de la literatura de diseño: monto + moneda como un tipo, el monto en
    unidades mínimas, y el **problema de la asignación** (repartir un total en N partes sin que
    la suma se despegue). ℹ️ El proyecto **ya resolvió ese último** con mayores restos para el
    reparto de propinas — o sea que una pieza del enfoque financiero ya está adentro, sin nombre.
  - **Las autoridades tributarias** de cada país tienen reglas sobre en qué momento se redondea
    una factura y con qué criterio. Eso es norma, no preferencia, y varía por país — que es
    exactamente lo que un sistema multi-país tiene que poder expresar.
  - **Los ERP** (SAP, Oracle, Odoo) modelan moneda de cuenta vs moneda de transacción vs moneda
    de presentación hace décadas. La UF entra ahí, no en "una moneda rara de Chile".

  ✅ **INVESTIGACIÓN CORRIDA Y CERRADA (2026-08-15) →
  [`docs/agent/investigaciones/2026-08-15-decimales-y-redondeo.md`](investigaciones/2026-08-15-decimales-y-redondeo.md).**
  Seis lentes ciegas entre sí (ISO 4217 · redes de pago · patrón Money · autoridades
  tributarias · unidades indexadas · ERP), cada hallazgo etiquetado NORMA / PRÁCTICA /
  INFERENCIA. **Leer ese documento antes de escribir una línea de spec.** Lo que cambió
  respecto de lo que esta entrada asumía:
  - ⭐ **No hay "cuántos decimales tiene una moneda": hay CUATRO respuestas y no coinciden**
    (minor unit ISO / CLDR para mostrar / la del gateway para cobrar / la de la tasa
    publicada). Convergencia de tres lentes ciegas. `moneda.decimales` es una sola columna.
  - ⭐ **El SII SÍ permite emitir un DTE en UF**, con el total en pesos enteros y el bloque
    `<OtraMoneda>`. El documento fiscal lleva **dos montos**. La pregunta ya no es si se
    prohíbe la UF: es cómo se representan denominación y liquidación por separado.
  - ⭐ **La UF tiene código ISO 4217: `CLF` (990)** — y el seed ya lo sabe a medias
    (`codigoNumero: '990'` correcto, `codigoIso: 'UF'` no es ISO). Tiene hermanas (COU, UYI,
    MXV) con **minor units distintos entre sí**: no vale "unidad indexada ⇒ 4 decimales".
  - ⭐ **No existe respuesta universal a "¿por línea o por total?"** — el TJUE lo declaró
    discreción nacional (C‑484/06), y UK (por línea) y México (solo al total) son opuestos.
    Tiene que ser configurable por país.
  - **La UTM no va en la misma tabla**: mensual, para multas y tramos, sin código ISO.
  - **El redondeo de efectivo nunca toca el impuesto** — norma en Chile, Canadá y Argentina.
  - ✅ Ya tienen respaldo normativo y no se tocan: moneda oficial derivada del país (IAS 21),
    congelar la tasa por línea (política de SAP y Odoo), `modo_redondeo` configurable
    (las normas que fijan modo exigen half-up, no half-even), y `Decimal.js` sobre `NUMERIC`
    (el argumento del entero es contra el binario, no contra el decimal exacto).
  - ⭐ **Propinas ya tiene el enfoque completo, sin nombre**: unidades mínimas enteras
    (`mayores-restos.ts:41`), reparto por mayores restos (= método Hamilton), y
    **`decimales_moneda` congelado en el documento** (`liquidacion-propinas.entity.ts:57`).
    La decisión pendiente es si se generaliza a ventas y pagos.
  - **Medido en el código:** la escala 4 está escrita a mano en **97 sitios de 17 archivos**;
    `ESCALA_PERSISTIDA` tiene **3 usos**, los tres en un solo archivo; y `moneda.decimales`
    **no tiene ningún consumidor fuera de propinas**.
  ❓ **Cinco preguntas abiertas para el owner en §9 del documento** — la primera es si
  *"un solo criterio"* significa un solo criterio o un solo número (ningún ERP relevado tiene
  redondeo global: SAP lo pone por empresa+moneda, Odoo por moneda). **No resolverlas solo:**
  esto es el motor de precios e impuestos, y `CLAUDE.md` obliga a consultar.

  <details><summary>Lo que se le pidió a la investigación (histórico)</summary>

  Lo que tenía que traer: (a) **redondeo** — en qué momento exacto los POS maduros llevan un monto
  a la unidad de la moneda, si redondean por línea o solo el total, y qué hacen los países sin
  decimales (hay reglas fiscales, no es solo criterio); (b) **unidades de cuenta** — cómo modelan
  una unidad indexada (UF chilena, UVR colombiana, UI uruguaya) separada de la moneda de cobro, y
  en qué momento se congela la tasa: al cotizar, al emitir o al cobrar; (c) **tasas con fecha** —
  si guardan historial con vigencia y de dónde las toman.
  ⚠️ Regla del cruce: insumo para adaptar, **no verdad a copiar**. Con un matiz que este tema
  tiene y otros no: **una norma tributaria o una restricción de una red de pago no se "adapta"** —
  se cumple o se incumple. Lo adaptable es el diseño alrededor, no el número de decimales que
  ISO 4217 le asigna al peso.
  ✅ **Alcance acordado (owner, 2026-08-15): se abre a varios países.** El objetivo que fijó el
  owner es que **funcione con todas las monedas y con las conversiones tipo UF y USD**, no que
  resuelva el caso chileno. Entonces la investigación tiene que cubrir, como mínimo:
  - **Monedas sin decimales** (CLP, PYG, JPY) — donde el total tiene que ser entero sí o sí.
  - **Monedas con 2** (USD, MXN, y la mayoría).
  - **Monedas con 3** (KWD, BHD, TND). Van a propósito: son las que rompen cualquier diseño que
    asuma "0 o 2" y hoy el sistema no tiene ninguna.
  - **Unidades de cuenta indexadas**: UF chilena, UVR colombiana, UI uruguaya.
  - **Operación multi-moneda de verdad**: cotizar en una moneda y cobrar en otra, que es el caso
    que la UF y el USD tienen en común y el que el sistema ya intenta con `convertirAMonedaOficial`.

  </details>

  ⚠️ **Consecuencia de diseño que ya se puede anticipar, y que la investigación agravó:** con
  0, 2, 3 y 4 decimales en juego, la cantidad de decimales **no puede quedar hardcodeada en
  ningún lado** —ni en un `toFixed(4)`, ni en `ESCALA_PERSISTIDA`— sin decidir antes qué pasa
  cuando la moneda tiene más decimales que la columna. `NUMERIC(18,4)` alcanza para UF (4) y
  sobra para CLP (0), pero es una restricción que hoy nadie eligió a conciencia: quedó. Y ahora
  se sabe que son **97 sitios en 17 archivos** los que repiten el 4 a mano, no un par.

- [ ] 🔵 **Manejo de fechas y zonas horarias — tema propio, EN COLA detrás de decimales**
  (backend, medido el 2026-08-15) — **el owner lo puso explícitamente después de decimales.**
  No es un bug suelto: es que **no existe un solo lugar que conteste "qué significa *desde el 1 de
  agosto* para esta empresa"**.

  **Lo medido:**
  - **La zona horaria no está en el tenant.** Vive en `provincia.zona_horaria`, con
    `pais.zona_horaria_principal` de respaldo — se **deriva** igual que la moneda oficial y el IVA.
  - **El almacenamiento está resuelto:** [ADR-019](../adr/019-timestamptz-en-toda-columna-de-fecha.md)
    dejó toda columna de fecha en `timestamptz`.
  - **La entrada no.** **11 DTOs** usan `@IsDateString()`, que acepta tanto `2026-08-01` como un
    timestamp completo. Y **solo 3 archivos** en todo el backend usan la zona del tenant
    (`sesiones-garzon.service.ts`, `propina-reportes.service.ts`, el seeder).
  - Los filtros que no normalizan heredan la zona de la sesión de Postgres — hoy UTC, **porque
    nadie la fija**: ni el compose ni la config del pool.

  🔗 **La decisión ya tomada dispara la reapertura de una entrada archivada.** El owner decidió el
  2026-08-15 que *"desde el 1 de agosto"* es la **medianoche del local** para los tres filtros de
  mermas, inventario y cobros (ver esa entrada en "Ya decidido"). Pero la entrada del JOIN del país
  —hoy en Vigilancia— dice textual: *"si aparece una tercera copia del helper de zona, ahí sí
  conviene la vista"*. **Hoy hay dos copias; aplicar la decisión crea tres más.** O sea que ese
  trabajo no son "tres servicios copiando un molde": es el momento de decidir dónde vive el helper.

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

### Cinco tipos de regla no hacen lo que la pantalla promete — arreglarlos (2026-08-23)

**Qué es esto:** el 2026-08-23 se midió que cinco de los doce tipos de regla no se comportan
como su formulario dice. Se evaluó **sacarlos** y el owner lo descartó: **no se sacan, se
arreglan**. Esta entrada es el inventario de qué está mal en cada uno y qué hay que decidir
antes de tocar nada.

⚠️ **La causa de fondo es una sola, y es del motor:** `calculo-precios.engine.ts` conoce
**montos y cantidades**, no tiempo. Su magnitud es literalmente
`codigo === 'por_mayor' ? ctx.cantidad : ctx.monto` — no hay una tercera. Ni plazos, ni días de
atraso, ni rangos de fecha. Todo lo que dependa del tiempo, entonces, o no se evalúa o se
evalúa mal.

#### Los que NO hacen nada

Están en `DIFERIDAS` (`calculo-precios.engine.ts:270`), o sea que el motor los saltea y
devuelve "sin valor". Se configuran, se guardan, y no pasa nada al vender.

| Tipo | Lo que la pantalla pide | Lo que hay que decidir para arreglarlo |
|---|---|---|
| `promocional` | fecha desde / hasta | **El más común y el más barato.** Solo necesita saber si *hoy* cae en el rango — no precisa plazos ni intereses. ¿La fecha que manda es siempre la de la venta? ¿Y una venta creada un día y pagada al otro? ¿Y una devolución sobre una promo ya vencida? |
| `pronto_pago` | *"Días antes del vencimiento"* | Necesita que la venta tenga un **vencimiento**, que hoy no existe como concepto. Va con el frente de crédito. |
| `mora` | días de atraso | Necesita vencimiento **y** un evento que dispare el atraso. ¿Se calcula al cobrar? ¿Un job la devenga? Va con el frente de crédito. |

#### Los que SÍ hacen algo, pero mal

⚠️ **Este matiz importa y en una versión anterior de esta nota estaba mal dicho:** estos dos
**no** están diferidos. Cobran — cobran distinto de lo que prometen.

| Tipo | Lo que la pantalla pide | Lo que hace |
|---|---|---|
| `interes_simple` | *"Tasa mensual"* | cobra ese porcentaje **una sola vez**, sobre la base, sin preguntar plazo: una venta a 1 mes y otra a 6 cobran lo mismo |
| `interes_compuesto` | *"Tasa mensual"* | **exactamente lo mismo que el simple** — ninguna rama del motor los distingue, así que la diferencia entre los dos tipos hoy es solo el nombre |

**Lo que hay que decidir:** de dónde sale el plazo de una venta a crédito, y si el interés se
calcula al vender (queda congelado en el documento) o al cobrar. Recién con eso simple y
compuesto pueden dar distinto.

#### Y un sexto, de otra familia, que aparece al mirar esto

`metodo_pago` (descuento) y `recargo_metodo_pago` (recargo) **ignoran los tramos**: su rama en
el motor retorna antes del `if` de tramos. No cobran cero —los dos están en
`TIPOS_CON_VALOR_UNICO`, así que el backend les exige `valor` y el motor cobra ese— pero los
escalones que se configuren se descartan. Hoy no muerde porque la pantalla no ofrece el campo
(`campoTramos: false` en los dos), y está **diferido** hasta que un tenant lo pida. Ver su
entrada propia más arriba.

#### Dos huecos de plomería que se midieron en el camino

Los dos son independientes de la decisión de producto y valen por sí solos:

1. **La pausa de un tipo no se hace valer.** `TiposReglaService.findAll` filtra `activo: true`,
   así que un tipo pausado desaparece del selector — pero `validarTipoRegla` (en
   `recargos.service.ts` **y** en `descuentos.service.ts`) **no mira `activo`**, así que un
   `POST` directo con ese id crea la regla igual. Es *"un `activo` que solo se escribe"*, que el
   propio playbook nombra como bug. Enforcement de una línea en cada service, con el cuidado de
   validar **solo cuando el tipo cambia**: el frontend reenvía `tipoReglaId` en todo PATCH, así
   que validarlo por venir en el DTO deja las reglas existentes de ese tipo imposibles de editar.
2. **El seed no repone estado sobre una base ya sembrada.** Los loops de descuentos y recargos
   son `if (!exists) save`, así que cualquier cambio de `activo` en el seed solo tiene efecto en
   una base fresca — en el demo de Railway, que persiste entre deploys, no pasa nada.
   ⛔ **Y una trampa medida:** reponer también el `nombre` en ese UPDATE **tumba el arranque del
   backend** si otra regla viva del tenant tomó el nombre viejo (choca con
   `uq_..._tenant_nombre_vivo` dentro de `onApplicationBootstrap`). Si se toca, solo `activo`.

📌 **Si alguna vez se evalúa pausarlos de nuevo, medido el 2026-08-23:** pausar el tipo deja la
columna "Tipo" en blanco en la tabla y el drawer de edición **sin ningún campo**, porque su
`config` sale del selector, que filtra los pausados. Renombrar y despausar siguen andando. La
salida sería mostrar el tipo pausado marcado como tal, no filtrarlo en el backend.

⛔ **Toca el motor de precios: va solo y con el sistema quieto** (`CLAUDE.md`). Y `promocional`
**puede salir antes y por separado** — no necesita nada de la aritmética del crédito.

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
