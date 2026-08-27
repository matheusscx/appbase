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
| 5. Carreras de concurrencia | Un análisis de orden de locks, común a las cinco |
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
también en [`resueltos.md`](resueltos.md). **Ese grupo quedó cerrado**; lo que hay abajo llegó
después y no tiene que ver con el redondeo.

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

✅ **Vuelve a estar vacía el 2026-08-26.** Su última entrada —el tope de nombres del mensaje
del cambio de nivel— salió a [`resueltos.md`](resueltos.md). Que esté vacía no significa que
no haya trabajo chico: significa que el trabajo chico que queda **no es mecánico**, o sea que
tiene una decisión adentro por más que el diff sea de tres líneas.

### Los residuos que dejó el frente de promociones (2026-08-27)

Ninguno es un bug de promo mal calculada: el fix de cada uno ya está identificado y no
requiere preguntarle nada al owner. Se juntaron en una entrada por la misma razón que los
minors del redondeo — se resuelven en una sola pasada.

- [ ] **`nivelRedondeo: 'documento'` + promo puede dejar el total del documento a ±1 peso,
  sin test que lo cubra** (backend, `calculo-precios.engine.ts:1710` y `:1884`) — con
  `nivelRedondeo === 'documento'` las líneas quedan finas y solo el cierre del documento
  cuantiza; una promo participa de ese mismo camino, así que hereda la misma holgura de
  redondeo que ya tenían `descuentos`/`recargos` de nivel venta antes de que existiera este
  módulo. **No es una regresión**: se midió durante la review de T6+7 (barrido de 11.604
  casos, 0 fallos en el camino `nivelRedondeo: 'linea'`, que es el default de todos los
  tenants) que la promo no empeora el caso `'documento'` respecto de lo que ya pasaba con
  descuentos de venta. Lo que falta es un test que fije esa cota (`nivelRedondeo:
  'documento'` + una promo + un descuento de venta, verificando que el total nunca se
  desvía más de 1 unidad de la escala) para que quede protegido y no solo medido a mano una
  vez.
- [ ] **`PromocionesAplicadas.vue` no filtra el monto `'0'` donde el ticket sí**
  (`frontend/app/components/PromocionesAplicadas.vue`) — el ticket
  (`ticket-builder.ts:284`) omite una promo con `monto <= 0` (la familia perdedora del
  interruptor, que llega con traza pero sin plata). Este componente —el desglose del
  carrito, no del ticket impreso— dibuja todas las filas de `promociones` sin ese filtro:
  inconsistencia cosmética entre las dos superficies, no un cálculo mal hecho (el monto que
  se ve, cuando aparece, es correcto). Cierre: agregar el mismo `.filter(p => new
  Decimal(p.monto).gt(0))` antes del `v-for`.
- [ ] **`VentaDetalleDrawer.vue` sigue sin spec propio** (frontend,
  `frontend/app/components/ventas/VentaDetalleDrawer.vue`) — no es nuevo de este frente
  (`docs/features/descuentos-recargos.md` ya lo señalaba para la regla de nivel), pero
  promociones le agregó `filaDePromocion` y la familia `'Promoción'` sin agregar cobertura:
  la regla de qué rótulo lleva el total y cómo se agrupa una aplicación cross-línea por
  `aplicacion` queda sin test automatizado, solo con la revisión manual que aprobó T12.
  Cierre: un spec de render (mismo molde que `promociones.nuxt.spec.ts`) que monte el drawer
  con una venta congelada de ejemplo (incluida una aplicación cross-línea) y afirme las
  filas y el total.
- [ ] **`suscripciones.service.ts` calcula sin pasar `canal`, así que cae al default
  `'fisico'`** (backend, `backend/src/modules/suscripciones/suscripciones.service.ts:112`) —
  la llamada a `calculoPreciosService.calcular` no manda `canal`, y `CalcularVentaDto` lo
  completa a `'fisico'` cuando falta. Una suscripción es intrínsecamente el canal online (no
  hay caja física de por medio); `online.service.ts:348` ya pasa `canal: 'online' as const`
  explícito en su propia llamada a `calcular` — mismo molde, una línea. **Hoy es benigno**
  (el seed no tiene ninguna promo con `canal` fijado sobre el ítem de suscripción demo, así
  que no hay ningún caso real donde esto cobre distinto), pero una promo futura scoped a
  `canal: 'fisico'` aplicaría por error a una suscripción, y una scoped a `'online'` nunca
  le aplicaría. Cierre: agregar `canal: 'online' as const` al DTO de esa llamada.

## 2. Medir primero — no es una pregunta para el owner

Lo que falta acá es abrir un archivo, correr algo o mirar la base. Cada una sale de esta
sección hacia la 1 (si el arreglo resulta obvio) o hacia la 4 (si lo medido destapa una
decisión que no es mía).

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

  🔬 **Pasada del 2026-08-25: se instrumentó el pool, y el descarte de "no es agotamiento"
  quedó REFUTADO por medir la magnitud equivocada.**

  ⛔ **El descarte estaba mal planteado, no mal medido.** La tabla de arriba concluye que no
  hay agotamiento porque `pg_stat_activity` picó en **16 contra `max_connections = 100``**.
  Ese número mide **el servidor**, y el agotamiento acá es **por pool**: cada spec levanta su
  propia app con su propio pool de 10 (`app.module.ts:161`), así que un pool completamente
  saturado se ve como ~10 conexiones en Postgres y contra 100 parece holgura. La pregunta
  correcta no se podía contestar desde ahí.

  **Lo que ahora existe: `backend/test/setup-pool.ts`**, que parchea `Pool.prototype.connect`
  y registra cada adquisición con el estado del pool (`total`, `idle`, `esperando`, `max`).
  Distingue las dos causas que comparten síntoma: `esperando > 0` con `total === max` es
  saturación; `total < max` con `ms` alto es un `connect()` lento.

  ✅ **Medido sobre 10 corridas completas de la suite, todas verdes (~21 min):**

  | | |
  |---|---|
  | Adquisiciones pedidas con alguien **ya en cola** | ~400 por corrida |
  | Pedidas con el pool **lleno** (10/10) | ~164 por corrida |
  | Espera máxima | **10-18 ms**, un caso de 53 ms |
  | Cola máxima | **5**, en las 10 corridas |
  | Timeouts | **0** |

  **La saturación con cola es rutinaria y DELIBERADA**, y la hacen dos specs, no uno: el
  conocido `concurrencia-pool` (ráfaga de exactamente 10 = el pool) y **`rbac-y-contrasena`,
  que esta entrada no nombraba** — su test *"una ráfaga de 15 refresh simultáneos no traba el
  pool"* dispara **15 contra un pool de 10**, así que 5 se encolan siempre. Es exactamente la
  cola máxima medida.

  ➡️ **Dónde queda el frente:** la cola drena en ~13 ms contra un timeout de 5 s, o sea un
  margen de ~**94×**. El fallo sería uno de esos encolados pasándose de 5 s porque algo en
  vuelo se demoró. **No reprodujo en 10 corridas**, así que la causa de la demora sigue sin
  identificarse — pero la próxima vez la sonda va a decir si el pool estaba saturado o si el
  `connect()` fue lento, que es lo que nadie pudo contestar hasta ahora.

  ⛔ **REFUTADO — agotamiento de puertos efímeros.** Hipótesis razonable: supertest abre una
  conexión por request y el server contesta `Connection: close`, así que no hay reuso y cada
  una quema un par de puertos. **Medido durante una corrida completa a 200 ms**: TIME_WAIT
  pica en 991 y los puertos efímeros en uso en **1071 de 16384 (6,5%)**. No hay presión.

  🎯 **REPRODUJO EL MISMO DÍA, Y LA SONDA CONTESTÓ LA PREGUNTA (2026-08-25, 19:56).** Undécima
  corrida de la suite, un solo fallo: `caja.e2e-spec.ts` → *"caja abierta ajena en tenant ciego:
  el supervisor la ve pero sin el esperado"*, `500` donde esperaba `200`. La captura, verbatim:

```json
{"t":"2026-08-25T19:56:51.082Z","ms":5002,
 "error":"timeout exceeded when trying to connect",
 "antes":{"total":1,"idle":1,"esperando":1,"max":10},
 "despues":{"total":3,"idle":2,"esperando":0,"max":10}}
```

  ⛔ **NO es agotamiento del pool, y ahora con la magnitud correcta.** El pool tenía **1 cliente
  de 10**, y ese cliente estaba **idle**. La tabla de esta entrada distinguía "saturado"
  (`esperando > 0` **y** `total === max`) de "connect lento" (`total < max`, `ms` alto): esto es
  inequívocamente lo segundo. Cinco segundos esperando para abrir una conexión con el pool casi
  vacío.

  ⚠️ **Y hay un dato que no encaja del todo, que conviene no alisar:** `idle: 1` con
  `esperando: 1` es raro — con un cliente libre, `pg-pool` debería haberlo entregado. O el
  snapshot cae en un instante transitorio (el `antes` se lee sincrónico, y el otro encolado pudo
  entrar en el mismo tick), o el cliente idle no era usable. **No lo sé, y no lo invento.**

  ➡️ **Adónde apunta esto:** afuera del proyecto. Con el pool en 1/10, ni nuestra concurrencia ni
  el orden de locks explican una demora de 5 s para establecer una conexión; queda Postgres o
  Docker tardando en aceptarla en ese instante. El próximo paso ya no es instrumentar el pool
  —está contestado— sino mirar del lado del servidor **en el mismo instante**: log de Postgres y
  estado del contenedor, con la hora de la captura.

  📌 **Y una advertencia para el que lo tome:** `reset-db.sh` hace `down -v`, así que el
  contenedor y sus logs desaparecen. Peritar esto exige NO resetear entre el fallo y la
  inspección — que es exactamente lo que impidió peritar el fallo original.

  📌 **Dos notas de método de esta pasada:**
  - **No hace falta atrapar el fallo para caracterizarlo.** Medir la distribución de lo que
    pasa *siempre* mostró la saturación deliberada y el margen real; esperar al intermitente
    habría costado corridas sin datos.
  - **Una sonda muda se ve igual que una sonda sin nada que reportar.** La primera versión de
    ésta dejaba pasar sin instrumentar la forma con **callback** de `connect()`, que —medido
    en `node_modules/typeorm/driver/postgres/PostgresDriver.js:1085,1106,1401`— es la
    **única** que TypeORM usa: el archivo salía vacío. Se verifica que engancha bajando el
    umbral a 0 **antes** de creerle a un archivo vacío.

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

  ⛔ **El parentesco con el `401` intermitente queda REFUTADO (2026-08-25).** Esta entrada
  anotaba que "puede ser pariente… nada lo prueba todavía". Ya se sabe: **el `401` era otro
  proceso de la máquina ocupando un puerto efímero** y contestando por la app (ver
  [`resueltos.md`](resueltos.md) § *"El `401` fantasma no era nuestro"*). Eso es HTTP y del
  lado del cliente; esto es `pg-pool` conectándose a Postgres. No comparten nada más que ser
  intermitentes del e2e local, que es lo que hacía verosímil el parentesco y no alcanza.
  ➡️ Lo que **sí** se hereda es el método: la caja negra que resolvió aquél
  (`backend/test/setup-supertest.ts`) muestra que a un intermitente que no reproduce se lo
  agarra **instrumentando y corriendo en loop**, no leyendo el código. Acá haría falta el
  equivalente del lado de `pg`.

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

### El ticket imprime el precio extra con la moneda oficial, sobre un monto que no lo está (2026-08-26)

- [ ] **El extra de una personalización se imprime con la moneda equivocada, y el ticket no
  suma** (frontend + backend; **medido el 2026-08-26**, leyendo el código de las tres capas) —
  `ticket-builder.ts:102` imprime cada extra con `formatMonto(d.monto)`, y ese `formatMonto`
  se lo inyectan las páginas **sin moneda** (`pos.vue:276`, `salones/index.vue:1158` y
  `:1249`), o sea con la **oficial del tenant**. El número que formatea sale de
  `backend/src/common/utils/personalizacion-receta.util.ts:99` como `precioExtra × unidades`
  **sin convertir**, o sea en la moneda del ítem. Mientras tanto, en el mismo ticket, el
  precio de la línea **sí** viaja convertido (`ventas.service.ts:436-447`:
  `precioBase + precioExtraTotal` → `convertirAMonedaOficial`).
  Consecuencia para una receta en USD: el ticket muestra `+ Extra Queso $1.000` —símbolo y
  separadores de peso sobre un número en dólares— **al lado de un total que sí está en
  pesos**. Ni la moneda es la del ítem (que es lo que decidió el owner el 2026-08-25 para el
  `precioExtra`), ni las dos cifras del ticket pertenecen a la misma escala.
  **Es preexistente**: no lo introdujo el frente del 2026-08-26, que arregló la otra
  superficie (el drawer de configuración). Lo encontró la revisión independiente de ese
  diff, al pedirle explícitamente que buscara un consumidor que el diff no tocara.
  **Lo que falta decidir, y por eso no salió de arrastre:** el arreglo puede ir por dos
  lados —convertir el `monto` en el backend, como ya hace la línea, o hacer viajar el
  `monedaId` hasta el ticket y formatear con él— y la primera opción toca la **conversión de
  plata**, que es territorio del motor de cálculo (⚠️ `CLAUDE.md`: va sola y con el sistema
  quieto). La segunda es de presentación y no toca el motor, pero hay que ver qué pasa con un
  ticket que mezcla dos monedas en la misma columna.
  ⚠️ **Antes de tomarla, verificar si el detalle de personalización tiene el `monedaId` a
  mano** en las tres páginas que arman el ticket: la entrada no lo midió.

### El `.` que multiplica por 10 no lo ataja ningún 400: la red que la doc promete no existe (2026-08-26)

- [ ] **`MoneyInput` en una moneda con separador de miles `.` convierte `800.5` en `8005`, y
  eso se persiste** (frontend; **medido el 2026-08-26** montando el componente con el molde de
  `MoneyInput.spec.ts`) — en CLP, tecla por tecla: `8`,`0`,`0`,`.`,`5` emite **`8005`** (display
  `8.005`); con `,` emite `800.5`, bien. maska lee el punto como agrupador, y esto ya estaba
  documentado como **limitación conocida** en `MoneyInput.vue` y en `docs/patterns/frontend.md`.
  **Lo que estaba mal escrito es la mitigación**, y por eso esta entrada existe: las dos docs
  decían que el monto ×10 *"no se persiste: el backend valida la escala y lo rechaza con 400"*.
  **Falso, y no solo para los campos de escala fija:** el resultado del error es un **entero**
  (`8005`), y un entero es válido en **cualquier** escala —los 0 decimales del peso incluidos—,
  así que ningún validador de escala lo puede ver. Con `@EsCosto()` (escala 4) pasa igual.
  Las dos afirmaciones se corrigieron el 2026-08-26; lo que queda es el riesgo.
  **Exposición contada ese día** (`grep -rn ':decimales' frontend/app --include='*.vue'`):
  **7 campos con escala fija de costo** — `mermas.vue:468`, `items.vue:1620`, `:1691`,
  `:1823`, `:1969`, `:2121`, `:2344`—. ⚠️ **Ése es el piso, no el total:** la familia
  `MoneyInput oficial` —caja (apertura/cierre/movimiento), `CobroModal`, `AbonoModal`,
  `NotaCreditoModal`, `ReembolsoModal`, el `valorMonto` y el `minimo` de tramo de
  `descuentos`/`recargos`, `preferencias-financieras`, `DesfasesPanel`— corre **el mismo
  riesgo**, porque la oficial de todos los tenants del seed es el peso: mismo `.` como
  agrupador, mismo entero que ningún validador ve. Y hay dos más atados a un `:moneda-id`
  dinámico y sin prop `decimales`, que tampoco están en la cuenta de los 7:
  `inventario/index.vue:347` (`costoNuevo` del ajuste) y `propinas/index.vue:330` (el monto
  manual del reparto). Se contaron aparte los de escala fija
  porque ahí el decimal es *legítimo* (un costo de `5,0500`/g) y el error es más fácil de
  cometer; en un campo de 0 decimales teclear un separador ya es un tecleo sin sentido. En
  todos, teclear el separador equivocado guarda ×10 en silencio.
  ⛔ **NO intentar taparlo desde el input.** Ya se probó un `preProcess` con memoria de la
  última tecla y salió **peor**: rompía el caso chileno normal (`1.500` = mil quinientos emitía
  `1`), o sea montos válidos y **menores** guardados en silencio. Revertido. El contrato está
  fijado en `MoneyInput.spec.ts`, describe *"limitación conocida"*.
  **Por dónde se puede atacar, sin decidir todavía:** (a) mostrar el monto formateado como
  confirmación antes de guardar, que no depende de maska; (b) rechazar en el backend un salto
  de magnitud sospechoso contra el valor anterior del campo, que es una regla de negocio y va
  al owner; (c) aceptar el riesgo y decirlo en las docs, que es lo único hecho hoy.
  📌 **Consecuencia ya aplicada, para que no se relea como teoría:** por esto el campo
  "precio extra" del **aplicar en lote** de `grupos-modificadores.vue` se quedó con `UInput`
  pelado el 2026-08-26 en vez de estrenar `MoneyInput` — ahí el mismo número se aplica a **N
  recetas de una sola vez**, así que el ×10 se multiplica por N. Está escrito en el template.

### Con una request frenada en un lock, otra que ni lo toca tampoco vuelve (2026-08-26)

- [ ] **Reproducible, con cuatro hipótesis medidas y descartadas —una, la del ALS, solo en
  sentido estricto— y ninguna confirmada** (harness de test
  y/o runtime; medido con una sonda dedicada el 2026-08-26) — con una compuerta reteniendo
  `FOR UPDATE` sobre una caja, se disparan **dos requests a la vez**: la del dueño (que sí se
  encola en ese lock) y la de **otro tenant**, que por el filtro de tenant no toca esa fila.
  **Ninguna de las dos vuelve hasta que se suelta la compuerta**, y resuelven con 1 ms de
  diferencia (`403 @3112ms` / `201 @3113ms`).

  **Lo que la medición descartó, cada uno con su evidencia:**

  | Hipótesis | Qué se midió | Veredicto |
  |---|---|---|
  | La request se queda esperando **conexión** del pool | `setup-pool.ts` engancha `Pool.prototype.connect` y registra en cuatro casos: error, `ms >= 250`, pedida con `esperando > 0`, o pool lleno. Corre en todos los e2e y **no escribió ni una línea** en la ventana de la sonda | descartada, y por medición continua: una espera de ~3 s se habría anotado al resolverse |
  | **Contexto transaccional compartido** (ALS, ADR-020) | log en `db.transaccion`: las dos entran con `reusa=false`, a los 19 y 24 ms | descartada **en su sentido estricto**: ninguna reusó el manager de la otra |
  | La request **no llega** al server | middleware de sonda: las dos llegan a los 2 y 5 ms | descartada |
  | El **event loop** está tapado | las 12 muestras de `pg_stat_activity` las tomó **el propio test, en el mismo proceso**, durante el cuelgue: con el loop tapado de forma sostenida no habría muestras. Y en la sesión anterior una `GET` disparada en esa ventana contestó `200` al toque | descartada |

  ⚠️ **El piso del descarte del pool es `LENTO_MS = 250`**: una espera menor a eso, con la cola
  vacía y el pool no lleno, es invisible para esa sonda. Criterio exacto del chequeo: **cero
  líneas** con `test` = *"SONDA concurrencia mide dónde se queda la request ajena"* **en todo
  el archivo** —que es append-only y nadie lo limpia, así que cubre cualquier ventana— y la
  única línea `"(fuera de un test)"` que existe es del `2026-08-26T00:36`, anterior a la sonda.
  ⚠️ `backend/test/tmp-pool.jsonl` es **local y está gitignoreado**: en otro clone no existe, y
  ahí la ausencia de líneas no prueba nada. Repetir el chequeo pide volver a correr la sonda.

  **Lo que queda sin explicar:** la request ajena **no aparece como backend de Postgres** en
  ninguna de las 12 muestras —solo se ven la compuerta (`idle in transaction`) y la del dueño
  (`active`/`Lock`)—. ⚠️ Pero **12 muestras no son exhaustivas**: un backend que vivió entre
  dos muestras no aparece. Y con `reusa=false` sabemos que **no reusó** contexto ajeno; si
  llegó a abrir la suya en la base, eso **no se midió**.

  **La principal candidata** —no "la única que queda", que sería afirmar una exhaustividad que
  la medición no da— es `createQueryRunner()` y la emisión del `BEGIN`: la otra mitad de esa
  capa, el `connect()`, la excluye la fila 1. Tampoco se miró lo que pasa **después** de que
  `dataSource.transaction()` retorna —interceptores, serialización de la respuesta—: una
  request que abrió y cerró su transacción entre dos muestras y se colgó en la salida daría
  este mismo cuadro.

  ⚠️ **El descarte del pool NO habilita a razonar "había una conexión idle, así que pg-pool no
  podía encolar".** Este mismo archivo, en la entrada del `timeout exceeded when trying to
  connect`, registra el estado `idle: 1` con `esperando: 1` y lo deja marcado como *"no lo sé,
  y no lo invento"*. Lo que descarta esta fila es la **medición continua**, no ese argumento.

  **El discriminador, y es por dónde hay que empezar: solo pasa si las dos están en vuelo
  desde el principio.** Disparando la ajena **después** de que el dueño ya se encoló, contestó
  en **53 ms** con la compuerta cerrada. ⚠️ Ese número sale de la **sonda**, no de un test:
  **ese escenario no lo cubre ninguno**. Lo más parecido que sí corre es el paso 1 de
  `caja.e2e-spec.ts` (describe "aislamiento multi-tenant"), y es **otro caso** —ahí la ajena
  va sola, con la compuerta cerrada pero con el dueño todavía sin disparar—; además ese test
  afirma *"volvió antes de que soltáramos"* y *"la cola quedó en 0"*, con presupuesto de 3 s:
  **no mira latencia**, así que no fija ningún milisegundo. El 5 ms que citan ese test y
  [`resueltos.md`](resueltos.md) es de **su** escenario, no de éste.

  ⚠️ **Cuidado con desescalarlo por el encuadre.** Lo que se trabó no fue una segunda escritura
  a la misma caja: fue una request **de otro tenant, sobre datos de otro tenant**. Si la causa
  vive en el runtime y no en el harness, el radio es **cualquier request detrás de cualquier
  request frenada** —cruza tenants y cruza pantallas— y eso es disponibilidad de producción.
  ℹ️ **El test que lo destapó no depende de esto**: dispara en secuencia y suelta la compuerta
  antes de esperar nada, así que nadie tiene que sospechar del e2e ya shippeado.

  ℹ️ La sonda era un spec temporal y no quedó en el repo. Reconstruirla es media hora:
  compuerta con `QueryRunner`, dos disparos sin `await`, un `app.use()` de sonda para saber
  cuándo llega cada request, y muestreo de `pg_stat_activity` **por el pool** —no por la
  compuerta: esa vista se cachea por transacción, ver el cierre del test en
  [`resueltos.md`](resueltos.md)—. Para el pool **no hace falta inventar nada**: `setup-pool.ts`
  ya corre en todos los e2e y escribe `tmp-pool.jsonl`; lo que ahí falta es la otra mitad, el
  tiempo entre `createQueryRunner()` y el `BEGIN`.

## 3. Ya decidido, falta construir

El owner ya contestó lo que había que contestar. **No son mecánicas** —tienen diseño
adentro, y alguna quedó a medias a propósito— pero nadie está esperando una respuesta para
empezarlas.

⚠️ **Esta sección no es una tanda que se "termine", y leerla como tal hace tomar malas
decisiones.** **Siete de sus entradas son features de producto con su propia spec** —el
motor de promociones, la NC como documento, la UF como moneda oficial, `cashRounding`, el
conteo por denominación, anular o reducir una línea ya enviada a cocina, y el envío diario del
resumen de descuadres—. Están acá porque se decidieron, no porque sean deuda: **son la cola de
trabajo, y cada una abre su propio frente.**

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

➕ **Y una llegó de la § 4 el 2026-08-25 y salió el 2026-08-26**: los tipos de valor único, que
el owner decidió **cerrar** → [`resueltos.md`](resueltos.md).

➕ **Cinco llegaron de la § 4 el 2026-08-25**, en una ronda de decisiones del owner, y **las
cinco están construidas**: cuatro el mismo día —el descarte de desfases, los dos tipos por
método de pago, y las dos que dejó el frente del nivel de la regla (el empujón del default y
los ítems de la papelera en el uso)— y la quinta —la moneda de las opciones de
modificadores— el **2026-08-26**. Todas en [`resueltos.md`](resueltos.md); se nombran así y
no en la lista para que nadie las busque acá.

📌 Lo que dejaron como lección: cada una llevaba su decisión escrita adentro **y las trampas
que el que la tome se va a encontrar**, y eso es lo que las hizo construibles. Pero la
última mostró el límite: **una entrada describe el hueco desde donde se lo miró.** La de
modificadores decía que faltaba un input y lo que estaba roto era un número **mostrado** con
la moneda equivocada, en una tercera pantalla que la entrada no nombraba. El mapa se hace
abriendo las superficies, no leyendo la entrada.

- [ ] **El motor de promociones: alcance cerrado desde julio, sin arquitectura y sin dueño**
  (backend + producto; análisis del 2026-07-22, **rescatado de la orfandad el 2026-08-23**) —

  ✅ **ACTUALIZACIÓN 2026-08-27: diseñado E implementado.** El título de esta entrada ya no
  describe el estado real y se deja sin reescribir a propósito —mismo criterio que
  `descuentos-recargos.md` usa con sus citas vencidas— porque el texto de abajo (lo ya
  decidido, la premisa corregida, el requisito heredado) sigue siendo el contexto correcto
  para quien retome el frente. Lo que cambió: arquitectura diseñada
  ([`2026-08-27-motor-promociones-design.md`](../superpowers/specs/2026-08-27-motor-promociones-design.md)),
  plan ejecutado (13 tareas, [`2026-08-27-motor-promociones.md`](../superpowers/plans/2026-08-27-motor-promociones.md)),
  backend + frontend construidos y documentados
  ([`docs/features/motor-promociones.md`](../features/motor-promociones.md),
  [ADR-023](../adr/023-promociones-familia-propia-del-motor.md)). **Lo único que falta es el
  gate con stack** —`test:e2e` completo, `--verificar`, smoke de navegador,
  `verify-feature` final— porque el desarrollo corrió con Docker ocupado por otra sesión
  (orden del owner). Esta entrada se muda a `resueltos.md` recién cuando ese gate corra en
  verde, no antes — no la des por cerrada leyendo solo hasta acá.

  El documento completo del análisis original es
  [`specs/2026-07-22-motor-promociones-analisis.md`](../superpowers/specs/2026-07-22-motor-promociones-analisis.md)
  y está **más avanzado de lo que nadie recuerda**: alcance de Fase 1 **cerrado**, las cuatro
  preguntas abiertas resueltas, e investigación de mercado (Toast/Square/Lightspeed) hecha.
  ⚠️ *Esta frase decía "lo único que falta es diseñar la arquitectura" — dejó de ser cierto
  el 2026-08-27, ver la actualización arriba: la arquitectura ya está diseñada Y
  construida.*

  ⚠️ **Por qué está acá y no se acordaba nadie: no lo nombraba ningún backlog.** Su único
  puntero era desde `investigacion-mercado.md`, como *ejemplo* de investigación. Esta entrada
  existe para que tenga quién lo reclame; **si vuelve a quedar sin ella, se pierde otra vez.**

  **Lo que ya está decidido** (no re-preguntarlo): solo la familia que descuenta líneas ya
  pedidas —2x1/NxM, happy hour %, precio fijo de combo—, activación solo automática, sin
  acumulación (gana la de mayor descuento), scope declarado por cada promo (lista de ítems /
  categoría / todo el pedido), y todo beneficio expresado como **descuento portable** para no
  inventar concepto fiscal de ningún país (ADR-010).

  ⛔ **Y una premisa suya que ya se corrigió, porque invalidaba el diseño:** citaba que los
  descuentos estaban *"definidos pero NO aplicados al vender"*. **Es falso** — lo sacaba de una
  lista desactualizada de `descuentos-recargos.md`, corregida el 2026-08-23 en los dos lados.
  El motor **sí** aplica valor plano, tramos y método de pago. Quien retome esto tiene que
  releer la § 6 de este archivo antes de diseñar: el punto de integración cambió de forma.

  ✅ **DECIDIDO (owner, 2026-08-23): el tipo de regla `promocional` se ELIMINA y su caso pasa a
  este módulo.** No fue por el choque de nombres sino por duplicación: la Fase 1 de este
  documento ya incluye *"happy hour %"*, que es un descuento porcentual acotado a una ventana —
  o sea `promocional` con granularidad más fina. Mantener los dos era construir la misma
  capacidad dos veces y hacer que el local adivine cuál usar. Se ejecuta dentro del frente de
  vigencia por fecha
  ([spec](../superpowers/specs/2026-08-23-vigencia-por-fecha-design.md)), donde `directo` gana
  fechas opcionales para que la capacidad no desaparezca.

  ⚠️ **REQUISITO QUE ESTE MÓDULO HEREDA, y no es opcional:** al eliminar `promocional` se pierde
  su guardarraíl —era el único tipo que **obligaba** a poner las dos fechas—, y eso es lo que
  previene el *"20% de aniversario"* corriendo tres años. **Una campaña sin fecha de fin no
  debería aceptarse acá.** Entre la eliminación del tipo y la existencia de este módulo hay una
  ventana sin ese control: es un costo aceptado a sabiendas, no un olvido.

  ⛔ **Toca el motor de precios: va solo y con el sistema quieto** (`CLAUDE.md`). Y el propio
  análisis lo dice: el evaluador es **una etapa nueva sobre el carrito entero**, no una rama más
  en `evaluarRegla`.

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

- [ ] **Configurar qué acepta la tienda online** (backend + frontend, feature con spec
  propia) — que el tenant elija sus medios de cobro online (tarjeta por pasarela,
  **transferencia**, **pago al retirar**…) en vez de tener solo lo que haya conectado. La
  nombró el owner el 2026-08-11 y sigue sin empezar; toca configuración, tienda, registro
  de la venta y el estado resultante.
  ℹ️ **Lo que ya no forma parte de esto** (cerrado el 2026-08-26, →
  [`resueltos.md`](resueltos.md)): que la tienda entregara sin cobrar por el solo hecho de
  no tener Webpay. La pasarela demo se prende a propósito y sin ninguna configurada
  **`POST /online/pagar`** responde 400 — la guarda vive ahí y **solo ahí**:
  `POST /online/checkout` sigue calculando y devolviendo su `checkoutUrl` sin mirar
  pasarelas, hoy inocuo porque el frontend no lo llama y la pantalla exige un
  `checkoutRef` salido de `pagar`. Lo que esta feature agrega es **qué más se puede aceptar**, no
  tapar un agujero.
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

✅ **Tercera tanda completa el 2026-08-25: las 6 preguntas no fiscales se contestaron de una**, y
cada entrada se mudó con su decisión escrita y con las trampas que el que la tome se va a
encontrar. Cinco fueron a la § 3 (descarte de desfases, los dos tipos por método de pago, la
moneda de las opciones de modificadores, y las dos del frente del nivel de la regla) y una a
**Vigilancia** (revivir una cuenta soft-borrada: el owner decidió que la baja de usuarios no entra
al roadmap todavía, así que la entrada no tiene disparador). ℹ️ De esas cinco, **cuatro se construyeron el mismo día** —el
descarte de desfases, los dos tipos por método de pago, y las dos del frente del nivel— y ya no
están en la § 3 → [`resueltos.md`](resueltos.md).

✅ **Cuarta tanda, 2026-08-25: las dos entradas que habían llegado ese mismo día se
contestaron ese mismo día.** Los tipos de valor único → **cerrar**, y se mudó a la § 3 con el
porqué de que el precedente de su gemela **no** haya ganado. La redacción de la invariante 3
de `CLAUDE.md` → **pasa a criterio**, ya escrita en el archivo → [`resueltos.md`](resueltos.md).

**Quedan dos.** La de la nota de crédito **no espera una respuesta** sino la investigación de
mercado que la destraba —lanzada el 2026-08-15, corrida y cerrada el 2026-08-22— y después una
decisión fiscal, que por `CLAUDE.md` abre su propio frente con su propia sesión. La otra sí
espera al owner, es chica, y llegó el 2026-08-26 de rebote del frente que cerró los tipos de
valor único: hay tres maneras de que una regla pierda la forma de importe que tenía guardada,
y solo una avisa.

📌 **Esa entrada nació en la § 3 y se movió acá el mismo día**, que es la tercera vez en tres
días que pasa lo mismo: el reflejo al escribirla es ponerla junto a sus parientes temáticos
—habla de escalones, como media § 3— en vez de archivarla por **lo que hace falta para
tomarla**, que es una respuesta tuya.

⛔ **La fiscal quedó afuera de la ronda a propósito, no por olvido.** `CLAUDE.md` lo dice: *"una
pregunta fiscal no se cuelga al final de una ronda de preguntas de producto"*. Impuestos y
documentos tributarios abren su propio frente, con su propia sesión.
(La del login del demo entró y salió el mismo día: el owner eligió el proxy →
[`resueltos.md`](resueltos.md).)

➕ **Y tres llegaron el 2026-08-24 desde la § 3**, al revisar cuáles de sus entradas decían
adentro que esperaban al owner. **Tres lo decían y nadie las había movido**, así que la § 3
aparentaba 19 frentes construibles cuando eran 16. ⚠️ Al revisar salió también un falso
positivo que conviene dejar dicho: *"el modal de pausa"* abre con *"Decisión del owner
pendiente"* y **dos líneas más abajo tiene su `✅ DECIDIDO (owner, 2026-08-15)`**. Se la dio
por bloqueada una vez leyendo solo la primera línea. Está bien en la § 3.

➕ **Y dos más el 2026-08-25, por el mismo motivo y con un día de diferencia.** Las dos
nacieron al cerrar el frente del nivel de la regla y se escribieron en la § 3 aunque las dos
terminan en una pregunta al owner. Es exactamente el error que el párrafo de arriba acababa de
corregir: **una entrada se archiva por lo que hace falta para tomarla, no por el tema del que
habla**. Que haya vuelto a pasar en un día dice que el reflejo al escribir una entrada es
ponerla junto a sus parientes temáticos, así que conviene releer el destino antes de guardar.

- [ ] **Dos carteles más que prometen una tarjeta que ese flujo no usa** (frontend, chico;
  los levantó la revisión independiente del 2026-08-26 al cerrar el de la pantalla demo, →
  [`resueltos.md`](resueltos.md)) — son la misma clase de afirmación que se acaba de sacar de
  la pasarela simulada, en dos superficies que ese diff no tocó. **Verificados abriendo el
  código el mismo día:**
  1. **La pantalla de éxito de la pasarela demo** (`tienda/pasarela.vue:112-114`) dice *"Pago
     aprobado"* / *"Tu compra fue registrada correctamente"* sin ninguna marca de simulación.
     Se salva a medias porque el encabezado *"Pasarela de pago (simulada)"* (`:106`) está
     fuera del `v-if` y sigue visible en ese estado. Sin test.
  2. **`tienda/medios-pago.vue:109`** describe las tarjetas como *"inscritas en Webpay
     Oneclick **para pagar en la tienda online**"*, y **el checkout del carrito nunca las
     usa**: `CobrosService.cobrar` lo llaman solo `suscripciones.service.ts:123` y el
     controller de la API externa; la compra normal sale por redirect a Webpay Plus (donde la
     tarjeta se vuelve a tipear) o por la demo. Es defendible si "tienda online" se lee como
     el módulo entero —las suscripciones viven ahí—, pero es exactamente la promesa que se
     acaba de sacar de la otra pantalla.
  ❓ **Lo que hace falta del owner, y por eso está en esta sección y no en la 3:** si el (2)
  se reescribe ("para tus suscripciones") o se deja como está, y si el (1) lleva marca de
  simulación. Ninguno toca datos: los dos son texto de pantalla.
  📌 Vino de la § 3, donde la entrada madre vivía con un "Decidir…" idéntico. El criterio de
  orden del archivo es **qué hace falta para tomarla**, y acá hace falta una respuesta.

- [ ] **Perder la forma de importe avisa por un camino y no por los otros** (frontend + producto;
  2026-08-26, salió del frente del guardia de forma de importe →
  [`resueltos.md`](resueltos.md)) — hay **tres** maneras de que una regla pierda la forma de
  importe que tenía guardada, y las tres se comportan distinto:
  1. **Cambiar el tipo** a uno que no usa esa forma —en las **dos** direcciones: escalones →
     valor único, y valor único → escalones— → desde el 2026-08-26 el drawer **avisa**
     (*"«X» tiene 2 escalones. El tipo que elegiste no lo usa…"*) y recién después manda el
     vaciado.
  2. **Mover el radio a "valor único"** en los tipos por método de pago, que ELIGEN forma →
     los borra **sin preguntar**, como se decidió el 2026-08-25.
  3. **Cambiar entre dos tipos que los dos usan escalones** → el formulario se vacía y el
     backend contesta *"requiere al menos un tramo"*, sin aviso previo. Es el caso más benigno
     —la sección queda a la vista, vacía, así que el usuario ve lo que pasó— pero es una
     tercera conducta para la misma familia de pérdida, y lo levantó la revisión independiente
     al notar que esta entrada enumeraba dos.
  **El argumento para dejarlo así:** en el caso 2 el usuario está mirando los escalones cuando
  mueve el radio, y en el 3 ve el formulario vacío; en el 1 el campo ya desapareció de la
  pantalla en el mismo gesto que dispara el borrado. O sea que la asimetría **no es un olvido**,
  responde a que en un caso no queda nada a la vista y en los otros sí.
  **El argumento para unificarlo:** es la misma pérdida, y una pantalla que a veces pregunta y
  a veces no enseña a no leer el modal.
  ❓ **La pregunta al owner, chica:** ¿los casos 2 y 3 también avisan, o se quedan como están?
  Si avisan, es la misma condición del caso 1 con `eligeForma` adentro y los tests espejados;
  si no, esta entrada se cierra escribiendo el porqué donde hoy está el comentario.

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
bloquea y en qué orden en cada camino—, no cinco parches. Son **dos moldes distintos**, y
conviene no confundirlos:

- **Cuatro del molde "no toma lock"** —el guard del nivel de una regla, `remove()` de ítems,
  borrar un ítem contra agregarlo a una cuenta, y `PATCH /items/:id` contra `DELETE`—: un
  `SELECT` de validación sin lock, y otra transacción que escribe entre el chequeo y el
  commit. Cada entrada lo dice por su cuenta.
- **Una del molde "lockea en orden no determinista"** —la de la auditoría de `inventario`,
  los tres caminos que revierten stock—: el lock sí se toma, pero el orden lo decide el
  cliente. El arreglo es el contrario —no agregar un lock sino fijar un orden—, y las piezas
  ya existen en el repo.

⚠️ **Las dos listas de arriba nombran las entradas, no su posición**, y la razón es peor que
"se desactualizaron". Decían "las tres primeras" y "la última"; medido contra el archivo antes
de este cambio (`git show HEAD:docs/agent/pendientes.md`, 2026-08-25), el orden real era
`[stock, remove(), cuenta, PATCH]` — o sea que la del molde raro era la **primera** y las tres
del molde común eran las **últimas**: **las dos frases ya estaban dadas vuelta**, y lo único
que hizo agregar una entrada fue que alguien las mirara. Un conteo posicional no se rompe el
día que insertás algo; se rompe callado y ningún gate lo va a ver nunca. Por eso acá se nombra,
no se enumera.

⚠️ **Corregido el 2026-08-18** (la versión anterior de esta nota se contradecía sola —
decía "ninguno de estos moldes" y dos líneas después describía uno de ellos): los dos
ciclos de la entrada residual que entonces vivía al principio del archivo ("Dos ciclos de
orden de lock en la bandeja de desfases de combos…", hoy cerrada y mudada a
[`resueltos.md`](resueltos.md)) **son estos mismos dos moldes**, no uno nuevo — el
ciclo `item_receta` ↔ `item_combo` es "no toma lock" (`descartarDesfases` no bloquea nada) y
el ciclo `items` ↔ `item_combo` es "lockea en orden no determinista" (`aplicarDesfases` y
`update()` de un combo toman los mismos locks en orden inverso). Lo que separa a esa entrada
de las cinco de acá **no es la familia de bug — es la tabla y el disparador**: acá es
caja/inventario/stock; ahí es `items`/`item_receta`/`item_combo` en la bandeja de desfases.
(Los otros dos puntos de esa entrada residual —el `FOR UPDATE` antes de validar tenant, y el
hueco de test de N combos— no son de ninguno de los dos moldes.)

ℹ️ **2026-08-20:** esa entrada residual **se cerró** y vive en
[`resueltos.md`](resueltos.md) § "El orden de bloqueo de filas de la bandeja de
desfases". Lo de arriba se conserva porque la clasificación por moldes sigue siendo cierta
y es la que hay que aplicarle a las cinco de acá. Cómo quedó el "no toma lock" del molde
2: `descartarDesfases` sigue sin tomar un solo `FOR UPDATE` —el arreglo no fue agregar
locks sino **fijar el orden en que sus `UPDATE` los toman solos**—, y el orden canónico del
proyecto está escrito en [`../patterns/backend.md`](../patterns/backend.md) § "Orden de
bloqueo de filas en ítems compuestos". Es el precedente más cercano que tienen las cinco
entradas de esta sección.

- [ ] **El guard del nivel de una regla valida sin lock y fuera de la transacción**
  (backend; anotado 2026-08-25 al cerrar el frente del nivel, → [`resueltos.md`](resueltos.md)
  § *"Una regla dice dónde se aplica"*) — **del molde "no toma lock"**, y por eso vive
  acá y no como frente propio. `validarCambioDeNivel` (`descuentos.service.ts`,
  `recargos.service.ts`) hace un `COUNT` sobre la tabla puente **antes** de `db.transaccion`;
  un `PATCH /items` que asocie esa misma regla entre el `COUNT` y el `save` deja una regla de
  nivel venta colgada de un ítem — el estado que las dos puertas existen para impedir.
  Síntoma: el ítem no se puede vender (400 de `resolverReglas`). Salida: quitar la asociación.
  ⚠️ **No se parchea suelto**: cerrarla pide un `FOR UPDATE` sobre la fila de la regla dentro
  de la transacción, y agregar un lock cambia el orden de bloqueo — materia de
  [`../patterns/backend.md`](../patterns/backend.md) § 15 y del precedente de
  `ventas.service.ts → crear()`, que es exactamente lo que el encabezado de esta sección dice
  no querer hacer de a uno. (**No** citar ADR-020 acá: su deadlock es de agotamiento del pool
  y lo dice con todas las letras, *"no de locks de fila"*; peor, bajo ADR-020 mover el `COUNT`
  adentro de la transacción **no cuesta una conexión extra**, así que leído entero argumenta a
  favor de hacerlo.) El docblock de `resolverReglas` acota la inalcanzabilidad con esta misma
  ventana.

- [ ] **Los tres caminos que revierten stock no tienen la protección de deadlock que su gemelo
  `crear()` sí tiene** (backend, auditoría `inventario` 2026-08-15) — es el otro molde: acá el
  lock **sí** se toma, lo que no es determinista es **el orden**. (Decía "los tres de arriba",
  y era falso desde antes de que existiera esta nota: es la única de su molde, y las otras
  cuatro no están todas arriba.)
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

### Los tipos de regla por TIEMPO, que siguen esperando el vencimiento de venta (2026-08-24)

De los cinco tipos que no hacían lo que la pantalla promete, **la vigencia por fecha se
construyó el 2026-08-24** y `promocional` **se eliminó** (su caso se mudó al motor de
promociones). El detalle está en [`resueltos.md`](resueltos.md) § *"La vigencia por fecha se
evalúa"*.

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

⚠️ **El motor sigue sin saber de tiempo, y ése es el trabajo de verdad.** La vigencia por
fecha NO se lo enseñó: se resolvió en la capa de servicio, que le pasa un booleano ya
calculado. Su magnitud sigue siendo `codigo === 'por_mayor' ? ctx.cantidad : ctx.monto`. Darle
plazo es agregarle una dimensión, no una rama.

⛔ **Toca el motor de precios: va solo y con el sistema quieto** (`CLAUDE.md`).

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
