# Pendientes — a corregir al terminar el harness

Backlog de correcciones que se **difirieron a propósito** mientras trabajamos en el
harness, para no mezclar el meta-trabajo (reglas, gates, docs) con cambios de código de
producto. Cada entrada dice qué, dónde, por qué se difirió y cómo se cierra.

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
| 5. Carreras de concurrencia | Un análisis de orden de locks, común a todas |
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

## 2. Medir primero — no es una pregunta para el owner

Lo que falta acá es abrir un archivo, correr algo o mirar la base. Cada una sale de esta
sección hacia la 1 (si el arreglo resulta obvio) o hacia la 4 (si lo medido destapa una
decisión que no es mía).

⚠️ **De la familia de "lo que la pantalla lee y escribe después del `await`" hay funciones con
la forma y sin el bug**, y estas tres están nombradas porque ya se levantaron una vez:
`abrirHistorial` congela la cuenta y abre el modal **antes** del `await`;
`cargarPendientesTestigo` y `abrirEntrarTurno` no están atadas a una cuenta. Lo **cerrado** de
esa familia está en [`resueltos.md`](resueltos.md); lo que **falta** son las entradas de este
archivo, que es donde hay que contarlas — no acá, en un párrafo que envejece.

- [ ] **La venta que se cierra sin cálculo queda sin boleta, y la caja se proyecta inflada por
  el vuelto** (frontend; **medido el 2026-09-05** por la revisión del cierre de la quinta
  puerta) — es el residuo **conocido y aceptado** de ese cierre, anotado para que no se
  redescubra como bug.

  Cuando `cerrarCuentaConPin` no puede tomar el cálculo —el garzón se fue de la cuenta durante
  el flush, o el cálculo falla— la venta se genera igual y el aviso lo dice. Dos costos:

  - **esa venta se queda sin boleta para siempre**: ningún camino reimprime una venta pasada,
    el ticket siempre se arma contra estado vivo (medido y escrito en
    [`resueltos.md`](resueltos.md), en el cierre de *"la moneda del extra en el ticket"*);
  - `targetCobro` cae en `bruto`, así que `neto = bruto` y `cajaStore.aplicarCobroLocal` mueve
    el `saldoEsperado` **incluyendo el vuelto**. Es proyección local, se corrige al recargar,
    pero el comentario del código enumeraba el costo como "el papel" y esto no estaba.

  **La salida buena para lo primero es recalcular la cuenta cobrada** en vez de resignar el
  ticket. Pide llamar al motor por fuera de la maquinaria de vigencia de
  `useResultadoCalculado` —que es la que garantiza que un resultado corresponda al carrito que
  se está viendo—, o hacer que el flush devuelva la cuenta fresca que ya recibe de cada
  `PATCH`. **Lo segundo se arregla con el `vuelto`, que ya es parámetro**, pero es plata en un
  camino degradado: no se tocó de arrastre.

  ⚠️ **Ojo con el alcance:** decidir que una venta puede quedar sin su boleta es materia del
  owner y del documento (ADR-010). Lo que este frente hizo fue **no empeorarlo** —ese camino ya
  existía para el cálculo fallado—; ampliarlo o cerrarlo es otra conversación.

- [ ] **La cuenta de plata del modal de nota de crédito es aproximada, y queda una ventana de un
  minor unit** (frontend; **medido el 2026-09-04**, reescrita dos veces ese mismo día) — la
  entrada nació pidiendo anticipar el 400 de *"la mercadería vale más que la nota"*. **Ese 400 ya
  no existe** —el frente de la devolución con crédito parcial lo sacó, ver
  [`resueltos.md`](resueltos.md)— y en su lugar el backend exige el `comentario` cuando la nota
  acredita menos que lo devuelto. El aviso cambió de signo, de *"no podés"* a *"contame por
  qué"*, y **ya está construido** (`7fe7046b`): el modal muestra el label "Motivo" con su
  explicación cuando lo marcado vale `≥` el monto.

  **Lo que queda abierto es la exactitud, y es medido.** El navegador **no puede calcular ese
  umbral con precisión**: valuar cada línea a `Σ total_linea / Σ cantidad` y cuantizarla a la
  escala de la moneda con el `modo_redondeo` **congelado de esa venta** es replicar el
  cuantizador del motor acá. Se escribió sin cuantizar y **quedaba peor que no tenerlo**: con 3
  unidades de 1.000, `333,3333 > 333` deshabilitaba el botón para una nota que el backend
  acepta, y el mensaje —pasado por `formatMonto`, que trunca— decía *"vale $333, más que los
  $333"*. Por eso `valorAproximadoDevuelto` **solo pide** el motivo y **nunca deshabilita el
  botón**: el único guard es el del backend.

  ⚠️ **El `≥` cubre el empate, no la ventana entera.** Cuando la cuantización del backend sube
  —1.001/3 → 334 × 3 = 1.002 contra los 1.001 de acá— queda hasta **un minor unit por línea**
  donde el modal no pide el motivo y el POST igual responde 400. Es la red del backend
  funcionando; se anota porque es la única parte de la entrada que sigue viva.

  **Para cerrarla del todo:** si alguna vez hace falta una cuenta EXACTA en el navegador, decidir
  cómo viaja el criterio de redondeo congelado hasta el modal. ⚠️ **El tipo de `configCalculo`
  en el drawer declara cinco campos y NO `decimalesMoneda`**, que es justamente el que
  `cuantizar` usa: el JSON congelado sí lo trae, así que es agregarlo al tipo —no ir a buscarlo
  al store de monedas, que daría la escala de HOY y no la congelada—. Emparentada con la deuda
  de `unidadBaseItem` / `resolverUnidadBaseDeItem`, que es la misma clase de gemelo sin enlace
  de compilación.

- [ ] **Un `timeout exceeded when trying to connect` intermitente en el e2e local: la firma
  reproduce entera y quedan tres explicaciones de por qué esa conexión no volvió** (backend/tests, visto y medido el 2026-08-18 en el cierre del
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

  ✅ **El dato que "no encajaba" quedó EXPLICADO el 2026-08-27, y no era una anomalía.** Esta
  entrada decía de `idle: 1` con `esperando: 1`: *"con un cliente libre, `pg-pool` debería
  haberlo entregado… no lo sé, y no lo invento"*. Leyendo `node_modules/pg-pool/index.js`:
  `connect()` con `_idle.length > 0` **encola** en vez de crear cliente, y `_pulseQueue` le
  entrega el idle al **primero** de la cola. Como `esperando` ya era 1 cuando pedimos, **el idle
  no era nuestro**: nuestro pedido salió por `newClient` → `client.connect()` → una conexión TCP
  nueva.

  ⛔ **Ojo con lo que esto NO dice, porque la primera redacción lo dijo mal:** armar ese estado
  **no reproduce el fallo**. Medido con el mismo script y el bloqueo puesto en 0: sale `ok` en
  **8 ms**. La mecánica de cola explica **por qué `idle: 1` no nos servía**; no explica los 5 s.

  ➕ **Y hay un discriminador gratis en el propio mensaje, medido el 2026-08-27:** un pedido que
  entra con el pool sin idles y sin llenar se va **derecho** a `newClient`, y ahí vence el timer
  del `Client`, con otro texto — `Connection terminated due to connection timeout` (verificado
  contra un servidor que acepta y no contesta). El texto de las dos capturas es
  `timeout exceeded when trying to connect`, o sea **el de la cola**. ⚠️ Prueba que el pedido
  estaba encolado —cosa que `esperando: 1` ya decía— y **no** dónde se fueron los segundos: un
  encolado al que `_pulseQueue` después le da un cliente nuevo lento muere igual con el mensaje de
  la cola, porque ese timer arrancó antes.

  ➕ **SEGUNDA CAPTURA, 2026-08-27T14:19:24Z** — `tendencia-descuadres.e2e-spec.ts`, *"un cierre
  con faltante suma un cierre, resta plata y cuenta el faltante"*. `ms 5001`,
  `antes {total:1, idle:1, esperando:1, max:10}`, `despues {total:3, idle:2, esperando:0}`.
  **`antes` y `despues` son idénticos a los de la primera**; `ms` difiere en 1 ms (5001 contra
  5002) y `t`/`test` obviamente también. Lo que hace de esto una *firma* es que dos capturas
  separadas por dos días compartan el **estado** exacto, no que sean el mismo registro.
  ⚠️ Y dejó una lección aparte: los rojos visibles de esa corrida fueron tres `409` (caja/cajón
  ocupado) y **se atribuyeron a la contaminación de estado entre suites sin mirar la caja
  negra**. Era el arrastre —el primer test se cayó por el timeout y dejó la caja abierta—, no la
  causa. La sonda ya tenía la respuesta.

  🎯 **LA FIRMA DE LAS DOS CAPTURAS SE REPRODUCE ENTERA, Y DICE POR QUÉ CAMINO SALIÓ EL
  PEDIDO (2026-08-27).** Lo que faltaba era el `despues {total:3, idle:2}` —dos clientes
  creados y ociosos mientras el nuestro caducaba—, que ninguna hipótesis explicaba. Sale
  determinista con un proxy TCP que demora **una** conexión elegida
  (`backend/test/control-sonda-pool.e2e-spec.ts`, apagado salvo `CONTROL_SONDA=1`):

  1. el pool queda en `total 1, idle 1`;
  2. dos pedidos entran **en el mismo tick**: el primero se encola porque hay un idle, y el
     segundo ve `antes {total:1, idle:1, esperando:1, max:10}` — la firma capturada;
  3. **cada uno de los dos agenda su propio `process.nextTick(_pulseQueue)`**
     (`node_modules/pg-pool/index.js:198-203`), y ahí está la mecánica: el primer pulso le da el
     idle al primero, y el **segundo** encuentra la cola con el nuestro, sin idles y el pool no
     lleno, así que le crea un **cliente propio** (`:165-167`). Devolver el primero **con error**
     no es lo que crea ese cliente —eso ya pasó—: es lo que saca del pool al cliente reusado para
     que el `total` final dé 3 y no 4;
  4. ese `connect()` es el demorado por el proxy, y **dos pedidos posteriores saltean la cola**
     (el caveat de abajo), se crean clientes y quedan idle → `despues {total:3, idle:2,
     esperando:0}` con el mensaje **de la cola**, porque su timer arrancó antes.

  Del control, **recortando `t`, `test` y `loopPicos: []`** (van en toda línea y acá no aportan);
  el resto es literal:

```json
{"ms":1502,"error":"timeout exceeded when trying to connect","pedido":3,"via":"nuevo",
 "clienteMs":null,
 "antes":{"total":1,"idle":1,"esperando":1,"max":10,"conectando":0},
 "despues":{"total":3,"idle":2,"esperando":0,"max":10,"conectando":1},"loopMax":2}
{"capa":"client.connect","pedido":3,"ms":1516,"error":"Connection terminated unexpectedly",
 "loopMax":2}
```

  📌 **El `clienteMs: null` de la primera línea es el campo que más dice**, y por eso no se
  recorta: al vencer el pedido, la conexión que le habían creado **todavía no había vuelto**. La
  segunda línea es esa misma conexión settleando 14 ms después, cuando el timer del propio
  `newClient` la mata — mismo `pedido`, que es la correlación entera en dos líneas.

  ➡️ **La rama "el pedido se quedó esperando el pulso de la cola" queda descartada para estas
  dos capturas** — y conviene ser exacto sobre en qué se apoya, porque **no** es la lectura del
  campo en el fallo real (`via` no existía en agosto 25 ni 27). Se apoya en tres cosas medidas:

  1. el control reproduce `antes` **y** `despues` por el camino "cliente nuevo para el encolado";
  2. un `release` con alguien en cola lo **desencola en el mismo frame** (tercer caso del control:
     `waitingCount` pasa de 1 a 0 sin ceder el loop), así que no pueden convivir clientes idle con
     un encolado sin atender — y todo camino que produce un idle pulsa la cola en el acto
     (el único `_idle.push` es `index.js:427-428`; los `_remove` pasan `_pulseQueue` de callback,
     `:397`; y el camino de error de `newClient` pulsa en `:280`);
  3. el otro camino, medido y aserto en el control, sale con `via: null` y
     `despues {total:1, idle:0}` — que **no** es la firma.

  O sea: **mecanismo + repro sintético**, no observación directa. Es lo más fuerte que se puede
  decir hasta que el intermitente vuelva a caer con la sonda nueva puesta, y alcanza para sacar la
  rama de la tabla porque lo que la sostenía era justamente no poder distinguirla.

  ⚠️ **Y una salvedad sobre el punto 3, para no estirarlo:** el control demuestra que en **esa**
  configuración el otro camino da otra firma; la imposibilidad general de que dé la firma
  capturada viene del mecanismo del punto 2, no del control. El `connectionTimeoutMillis` del
  control es 1500 ms y no 5000, para que tarde 30 s y no dos minutos: cambia los números, no la
  mecánica.

  🎯 **EL EVENT LOOP TAPADO ES LA ÚNICA HIPÓTESIS QUE ALGUIEN REPRODUJO — y estuvo un rato
  marcada acá como refutada, por un argumento que parecía cerrado y no lo era.** El argumento
  era: si el loop estuviera bloqueado más de 5 s, el timer del `connectionTimeoutMillis` correría
  tarde y el `ms` registrado sería **el del bloqueo** y no ~5000; las capturas dicen 5001 y 5002,
  luego el loop estaba libre. Lo verificado, bloqueando a propósito contra la base sana:

  | bloqueo del loop | resultado |
  |---|---|
  | 6000 ms (cruza el vencimiento) | `ms=6000` — **esto sí queda descartado** |
  | 4995 ms (termina justo antes) | `ms=5000` + `antes {total:1, idle:1, esperando:1, max:10}` |
  | 4900 ms | pasa: `ok` a los 4907 ms |

  O sea que el argumento **solo descarta un bloqueo que CRUCE el vencimiento**. Un bloqueo que
  termine en la ventana de los últimos milisegundos da el `antes` capturado y el mismo error, con
  Postgres y Docker perfectamente sanos. La conclusión correcta es la de la primera fila, no "el
  loop estaba libre".

  ⚠️ **El bloqueo del loop, solo, no reproduce la firma entera** —deja `despues {total:2,
  idle:0}`—, y eso **ya no es un hueco**: el `despues {total:3, idle:2}` lo explica el control de
  arriba, que es de dónde salen los dos clientes ociosos. Las dos cosas encajan sin competir: el
  control dice **qué** pasó (a nuestro pedido encolado le crearon un cliente y su `connect()` no
  volvió a tiempo) y el loop tapado sigue siendo una de las tres explicaciones posibles de **por
  qué** ese `connect()` no volvió — la única, además, que se reprodujo con Postgres y Docker
  sanos.
  ⚠️ Lo levantó la revisión independiente corriendo el experimento; acá estaba escrito ⛔
  REFUTADO, que es lo que habría mandado al próximo a peritar Docker con la única pista viva
  tachada.

  📊 **Lo que sí se midió del loop, y lo que esa medición NO alcanza a decir:** sampler de 100 ms
  adentro del proceso de jest, durante una suite **verde** (15:07-15:10Z). Máximo dentro de un
  test: **1095 ms**, y **2330 ms fuera de todo test** (bootstrap de jest). ⚠️ La primera
  corrección de este párrafo descartó ese 2330 como "offset de arranque del `setInterval`, no un
  bloqueo", y **es falso**: un `setInterval` de 100 ms no tiene offset de 2,3 s, así que el loop
  estuvo tapado ~2,4 s ahí. Lo correcto es "ocurrió fuera de todo test" — y es el bloqueo **más
  grande** medido en ese proceso, justo de la magnitud que la hipótesis viva necesita.
  Y sobre todo: esa corrida **no es ninguna de las dos que fallaron**, así que no restringe el
  loop en el momento del fallo. Para eso hay que muestrear en la corrida que falle.

  ⛔ **REFUTADO — una demora de base en llegar a Postgres.** Sonda de 1500 conexiones TCP crudas
  por cada ruta, con la máquina en reposo:

  | destino | p50 | p95 | p99 | máx | outliers ≥100 ms |
  |---|---|---|---|---|---|
  | `localhost:5432` (lo que usa el e2e) | 0,3 ms | 0,5 ms | 0,7 ms | 22,6 ms | 0 |
  | `127.0.0.1:5432` | 0,0 ms | 0,1 ms | 0,2 ms | 0,4 ms | 0 |
  | `[::1]:5432` | 0,0 ms | 0,1 ms | 0,2 ms | 2,1 ms | 0 |

  No hay un problema de línea base ni un desbalance entre familias de direcciones: el fallo pasa
  **bajo carga**, no porque el camino sea lento de por sí.

  ➡️ **El mapa se achicó de cuatro ramas paralelas a una pregunta con tres respuestas
  posibles.** Eran cuatro mientras no se podía distinguir si al pedido le habían dado cliente; con
  el control y el mecanismo de arriba, la única lectura compatible con la firma es que **sí**, y
  las tres que quedan son explicaciones de **por qué ese `connect()` no volvió en 5 s**:

  | rama | dónde vive | cómo se distingue en el próximo fallo |
  |---|---|---|
  | El **event loop** tapado terminando justo antes del vencimiento | adentro | `loopMax` / `loopPicos`, que ahora van en **todos** los registros; única parcialmente reproducida |
  | El **TCP** hacia el puerto publicado de Docker | afuera | `capa: 'client.connect'` **con el mismo `pedido`** y `ms` alto, y el log de Postgres SIN esa conexión a esa hora |
  | El arranque del **backend de Postgres** | afuera | ídem, pero el log del servidor SÍ la registra tarde |

  ⛔ **Descartada, y por eso ya no está en la tabla:** *el pedido esperando el pulso de la cola*.
  Ver el control de arriba — es la rama que se leía por ausencia y ahora se lee por el campo.

  ⚠️ **Un caveat que sigue valiendo para leer cualquier captura**, y que era el que volvía
  indistinguibles a dos de las ramas: en `pg-pool` un encolado solo se atiende vía `_pulseQueue`,
  mientras que un `connect()` **posterior** que llegue con la cola vacía de idles y el pool no
  lleno se va directo a `newClient` y **saltea la cola**. Por eso el `despues {total:3}` no prueba
  por sí solo que esos clientes sean nuestros — lo que lo prueba es el `pedido`, y antes de que
  existiera no había con qué.

  ✅ **Lo que la sonda agregó (2026-08-27):** `setup-pool.ts` parchea también
  `Client.prototype.connect` —registra con `capa: 'client.connect'` lo que pase de `LENTO_MS` o
  falle— y lleva un contador `conectando` de conexiones en vuelo que va en cada registro del pool.
  Verificado que engancha bajando el umbral a 0 antes de creerle a un archivo vacío.

  ✅ **Y lo que agregó la del 2026-08-27:** el `pedido` correlativo con su `via`, el muestreo del
  atraso del **event loop** en todos los registros (`loopMax`, y `loopPicos` en los de error), y el
  control positivo `backend/test/control-sonda-pool.e2e-spec.ts`. El control **no corre en el
  gate**: es `describe.skip` salvo `CONTROL_SONDA=1`, porque tarda ~30 s, levanta un proxy TCP y
  bloquea el loop a propósito.

  ```bash
  CONTROL_SONDA=1 npx jest --config ./test/jest-e2e.json \
    --runTestsByPath test/control-sonda-pool.e2e-spec.ts
  ```

  📌 **El control se verificó con un mutante, no solo por estar verde:** sacándole el etiquetado
  del ítem encolado —o sea el código anterior a esta pasada— el fallo sale con `via: null`, que es
  exactamente lo que la sonda vieja podía decir, y el control se pone rojo.

  ✅ **El id de correlación existe desde el 2026-08-27, y con él se cerró el "leer por
  ausencia".** Se puede correlacionar porque `pool.connect()` decide **sincrónicamente**
  (`node_modules/pg-pool/index.js:190-237`): o empuja su `PendingItem` a la cola, o llama a
  `newClient()`, que construye el `Client` y lo conecta en el mismo frame (`:240-266`). Entonces
  cada `pool.connect()` lleva un `pedido` correlativo; si encoló, la etiqueta viaja **colgada del
  ítem**, que es como se lo sigue cuando `_pulseQueue` lo atiende mucho después; y `newClient`
  publica el pedido para que el parche de `Client.prototype.connect` lo levante. Cada registro
  ahora dice `pedido`, `via` (`'idle'` / `'nuevo'` / `null` = nunca le asignaron cliente) y
  `clienteMs`.

  ⚠️ **`conectando` sigue siendo lo que era** —contexto, no regla— y ya **no** es lo que sostiene
  ninguna atribución: eso ahora lo hace `pedido`. Se deja porque es gratis y porque en el `despues`
  de un fallo dice cuántas conexiones había en vuelo en ese instante.

  📊 **La línea base que la correlación destapó, medida en la corrida verde del 2026-08-27**
  (652 tests, 541 registros): el estado `antes {total:1, idle:1, esperando:1}` con `via: 'nuevo'`
  —la configuración exacta de las dos capturas— ocurre **27 veces por corrida** y resuelve en
  **6 ms de mediana, 12 ms el peor**. Establecer la conexión, sobre los 52 pedidos que crearon
  cliente: **p50 6 ms, p95 11 ms, máximo 13 ms**.

  ➡️ **Eso cambia la forma de la pregunta**, con la atribución de arriba puesta: lo que en 27
  casos por corrida tarda 6 ms se fue a **más de 5000**, un outlier de ~400×. No es un margen
  apretado que a veces se pasa, así que no se lee como saturación ni como carga: algo **detiene**
  esa conexión, no la enlentece. ⚠️ Si la atribución cayera, cae también esta lectura — es la
  misma inferencia, no una segunda evidencia.

  🔍 **Primera cacería con la sonda correlacionada: 20 corridas limpias (2026-08-27, ~13.000
  tests, 1 h).** Cero timeouts. El loop de caza está en
  `docs/agent/caza-timeout-pool.sh`; frena al primer positivo y **no resetea**, porque el
  `down -v` de `reset-db.sh` se lleva el contenedor y con él el log de Postgres — que es lo que
  impidió peritar el fallo original.

  ✅ **Y el detector tiene control positivo**, que es lo que hace que "20 limpias" signifique
  algo: corriendo el control (`CONTROL_SONDA=1`), que fabrica timeouts, el mismo detector los
  cuenta (3 de 3). Sin eso, 20 vueltas limpias no distinguen "no pasó" de "no lo habría visto" —
  el error exacto que costó una tarde en el frente del `401`.

  📊 **La distribución de esas 20 corridas** (10.842 registros; 1.038 pedidos que crearon cliente,
  9.804 servidos con un idle):

  | | p50 | p95 | p99 | máx |
  |---|---|---|---|---|
  | Establecer la conexión (`clienteMs`) | 6 ms | 10 ms | 14 ms | **74 ms** |
  | Atraso del event loop (`loopMax`) | 178 ms | — | 531 ms | **946 ms** |

  ⚠️ **Lo que esto NO dice**, porque es la misma trampa que ya se cayó una vez en esta entrada:
  son corridas **verdes**, así que no restringen el instante del fallo. Que el loop no haya pasado
  de 946 ms acá **no** refuta el bloqueo de ~4900 ms que la hipótesis necesita — en estas 20 no
  falló nada. Lo que sí dice es que el fallo no es la cola de estas distribuciones: entre 74 ms y
  5000 ms no hay nada, así que es una discontinuidad, no un margen que a veces se pasa.

  ➡️ **Lo que falta: una sola cosa, que vuelva a pasar con las sondas puestas.** Ya no hay nada que
  construir. Cuando caiga, el registro del timeout va a traer su `pedido` y su `via`, el
  `capa: 'client.connect'` del **mismo** `pedido` va a decir cuánto tardó esa conexión, `loopMax` y
  `loopPicos` van a decir si el loop estaba tapado en esos 10 s, y el `t` contra el log de Postgres
  parte lo que quede entre Docker y el servidor. Es la primera vez que las tres ramas se distinguen
  con una sola captura.

  ⚠️ **`conectando` es una ayuda, NO una regla de decisión.** Es un contador **global del
  proceso** leído en **un instante**: medido en una suite entera llega a 8 en las ráfagas, así que
  `conectando > 0` **no atribuye** ese connect a nuestro pedido, y `conectando === 0` **no
  descarta** una conexión que arrancó y terminó dentro de los 5 s — que es justo lo que sugiere el
  `total` 1 → 3 de las capturas.

  ✅ **`log_connections` quedó durable**, en el `command:` del servicio `postgres` de
  `docker-compose.yml`. Por `ALTER SYSTEM` no sirve: se lo lleva el `down -v` de `reset-db.sh`, y
  un paso manual después de cada reset es un paso que no va a estar puesto justo el día que el
  intermitente caiga. ⚠️ **Lo que cuesta, para poder decidir sacarlo:** el healthcheck corre cada
  10 s y mete ~6 conexiones por minuto (medido: 50 de 209 en 8,4 min), así que el ruido tapa lo
  que se busca. ⚠️ **Y no se filtra como uno esperaría:** `connection received` —la línea que trae
  el instante de aceptación, que es la mitad de servidor por la que se hizo este cambio— **no
  lleva `application_name`**; sólo lo lleva la línea siguiente, `connection authorized`. Hay que
  correlacionar **por PID** (el `[595]` del prefijo) y descartar las del `pg_isready`; es un cambio permanente a infra compartida por un diagnóstico
  local, y se saca cuando esta entrada se cierre. ⛔ **Y CI no lo tiene**: `.github/workflows/ci.yml`
  levanta su propio servicio `postgres:15`, no usa compose, así que si el intermitente cae allá el
  lado del servidor no existe.

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

**Efecto medido de los dos arreglos** —`app.close()` en un `finally` y no tratar como error el `400`
de la fase 2 de cierre, los dos en [`resueltos.md`](resueltos.md)—: de **3 de 5** corridas completas en rojo a **1 de 10**, y
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

### Un `400` latente en un campo precargado, si el tenant pudiera bajarle los decimales a su oficial (2026-09-08)

- [ ] **Salió del cierre del ×10** ([`resueltos.md`](resueltos.md)) y es la que queda de la entrada
  *"Tres formas en que la pantalla puede quedarse con plata que la moneda no expresa"* —las otras
  dos se cerraron el 2026-09-11, también en [`resueltos.md`](resueltos.md)—. Vive acá porque es
  riesgo de plata, no relato; comparte la causa de aquellas —el campo muestra lo que puede y el
  modelo conserva lo que le llegó— y no es regresión de ese commit.
  **Vía nueva de 400 en un campo precargado, hoy sin puerta de entrada.** No aplica a los
  seis campos de `items.vue` (`@EsCosto()`, escala 4); aplicaría a la familia
  `MoneyInput oficial` contra un `@EsMontoCobrado()` **si** el tenant pudiera cambiar su
  oficial por una de menos decimales — y **no puede**: el único `PATCH` de moneda del tenant
  acepta `habilitada` y `valorDelDia`, y el país no es editable. O sea que hoy es latente y
  lo que lo reabre es que aparezca esa vía. 📌 Y no confundirlo con el round-trip del crudo
  (`'50000.0000'`), que **no** da 400: el pipe compara el valor con `decimalPlaces()` de
  Decimal, que normaliza los ceros a la derecha.
- [ ] **Guardar una receta o un combo parece dejar como precio propio de ese ítem el del
  catálogo en TODAS sus opciones** (frontend + backend; **leído en el código el 2026-09-12 al
  cerrar el vaciado de opciones por cambio de moneda, no medido**) — `guardar`
  (`configuracion/items.vue`) manda `precioExtra: o.precioExtra || undefined` por cada opción, y
  `o.precioExtra` es el **efectivo**: el que trajo `GET /items/:id`, o el del catálogo que
  prellena `onSelectGrupo`. El service lo persiste como override en
  `item_grupo_modificador_opciones.precio_extra` (`items.service.ts`, el `INSERT`/`UPDATE` de
  overrides). Si es así, después del primer guardado ninguna opción de ese ítem hereda, y un
  cambio de precio en `grupos-modificadores.vue` ya no le llega.
  **Qué medir:** guardar una receta sin tocar sus opciones y leer la tabla. ⚠️ **Puede ser
  deliberado:** el docblock de `onSelectGrupo` dice que *"pre-llena la tabla de overrides con el
  default"*. Si la medición lo confirma, la pregunta para el owner es si un precio de catálogo que
  cambia tiene que llegar a las recetas ya guardadas.
  **Por qué pesa sobre el vaciado por cambio de moneda** ([`resueltos.md`](resueltos.md)): esas
  opciones son overrides iguales al default, que el vaciado no distingue de un heredado y deja
  quietas. Y la otra cara, levantada por la revisión del cierre: si después el catálogo cambia
  ese precio, la copia vieja deja de coincidir con el default y el vaciado la cuenta como precio
  propio —el aviso la nombra como monto a vaciar— aunque nadie la tipeó en este ítem. Vaciada,
  al guardar hereda el precio nuevo.


### Irse de `/salones` durante una edición a medio guardar (2026-09-12)

- [ ] **Irse de `/salones` espera lo pendiente con la pantalla tocable, y un tap en esa espera
  puede salir con la pantalla ya desmontada** (frontend; **leído en el código el 2026-09-12** por
  la revisión del cierre del flush de la comanda, no medido) — `onBeforeRouteLeave` hace
  `await flushPendientes()` sin cuenta, así que un tap durante esa espera arma un timer que el
  flush no atiende, y `onBeforeUnmount` solo limpia `refrescoItemsPendiente`, no los timers de
  `pendingByLinea`. **Pasa si el flush termina antes de que ese timer de 300 ms dispare**: la
  navegación ocurre, el `PATCH` sale después con la pantalla desmontada y un rechazo muestra su
  aviso en otra pantalla — justo lo que ese guard dice cerrar. Si la espera dura más, el timer
  dispara con la pantalla montada, la espera final del flush (`inflight`) lo espera y no pasa.
  **Qué medir:** reproducirlo en `salones/index.nuxt.spec.ts` con el `PATCH` anterior retenido,
  un tap durante la espera y la retención **soltada antes de que pasen los 300 ms del tap**.
  Soltándola después, el test sale verde por la rama que no tiene el bug. **La salida probable**
  no es la de cancelar y fusionar: acá la cuenta sigue viva y no hay nada que descartar, así que
  lo coherente sería vaciar **todo** lo pendiente antes de dejar ir, y eso pide que
  `flushPendientes` sepa vaciar sin acotar a una cuenta.

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


- [ ] **La nota de crédito miente distinto sobre la misma línea de receta** (backend,
  medido 2026-08-22 al cerrar la anulación; el owner decidió que **va aparte**, no de
  arrastre) — el camino de la NC usa `LEFT JOIN item_producto` (en
  `validarDevolucionesReembolso`, y el gemelo en la lectura del detalle de `findOne`; las citas
  de línea se sacaron el 2026-09-04 porque ya apuntaban a otra cosa), así que la línea de receta
  **no** desaparece como
  desaparecía en `cancelar`: cae en la rama `modo_inventario === null` y responde *"no
  maneja stock (servicio): no admite devolución a inventario"*. Para una receta ese
  mensaje es **falso** — no es un servicio, tiene ingredientes que sí salieron del
  inventario y que hoy no vuelven por ningún camino.

  ⚠️ **Actualizado el 2026-09-04:** ese mensaje **ya no dispara por nombrar la receta**. Desde
  el frente de la devolución con crédito parcial ([`resueltos.md`](resueltos.md)) la receta **sí
  se acredita por línea** —con su nombre en el documento, no como "Ajuste"— y el mensaje solo
  aparece si alguien pide explícitamente que reponga. **Lo que esta entrada pide sigue vivo y no
  se achica:** los ingredientes de esa receta siguen sin volver al inventario por ningún camino,
  y eso es lo que la decisión del owner de más abajo viene a resolver.
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

  **Hoy el bloqueo ya existe:** `quitarLinea` rechaza si hay algo despachado y `actualizarLinea`
  no deja bajar por debajo de lo despachado; la pantalla deshabilita el tacho con el motivo
  → [`resueltos.md`](resueltos.md). **Lo que falta es el camino con motivo.**

  🔗 **Cruza con la reserva de stock al pedir, que se CONSTRUYÓ el 2026-09-01**
  ([`resueltos.md`](resueltos.md); spec:
  [`specs/2026-09-01-reserva-de-stock-al-pedir-design.md`](../superpowers/specs/2026-09-01-reserva-de-stock-al-pedir-design.md)).
  **Esa feature no cierra ésta, y hay que decirlo porque ahora que existe es fácil creer que
  sí**: achica el caso, no lo borra —una merma, un recuento o un ajuste manual siguen pudiendo
  dejar el stock por debajo de lo ya comprometido, y esa mesa vuelve a quedar sin poder cobrar
  y sin poder sacar la línea—. Y su § 5 dice cómo componen: sacar la línea con motivo baja el
  comprometido y baja el stock a la vez, **neto cero y automático**, sin que nadie tenga que
  acordarse de liberar nada. ⚠️ **Salvo que este frente decida conservar la línea marcada como
  anulada** en vez de sacarla o bajarle la cantidad: en ese caso la consulta del comprometido
  —`ItemsService.comprometidoPorItem`, que hoy suma toda línea viva de una cuenta `abierta`—
  necesita una condición más para dejar de contarla. Una línea de SQL, pero hay que acordarse.

  ⏳ **Lo que sigue abierto es lo que esta entrada siempre dijo que faltaba: el camino con
  motivo.** Bloquear evita la pérdida silenciosa; **no da la salida legítima**. Un plato que
  se quemó o que se regala tiene que poder salir de la cuenta **con motivo** (merma o
  cortesía). Sin eso, hoy el garzón que se equivocó de plato después de mandar la comanda no
  tiene ninguna salida.

  ✅ **LAS SEIS REGLAS DECIDIDAS POR EL OWNER (2026-09-03).** La investigación de mercado
  ([`investigaciones/2026-09-01-anular-linea-despachada.md`](investigaciones/2026-09-01-anular-linea-despachada.md))
  dejó tres preguntas que el mercado no contesta; se preguntaron esas más tres que salieron
  del diseño. **Con esto se puede escribir la spec.**

  | Qué | Decisión | Lo que se descartó, y por qué importa |
  |---|---|---|
  | **La cortesía y el stock** | **Descuenta**, y se reporta **aparte** de la merma | No descontar deja el stock mintiendo —la carne salió— y reabre la mesa trabada. Mezclarlo con merma arruina el costo de comida: *"se me cayó al piso"* y *"se lo regalé"* dejan de ser distinguibles |
  | **Dónde viven los motivos** | **Un catálogo único con tipo**: se renombra el actual a algo neutro y cada motivo dice si es merma o cortesía | Reusar `causas_merma` tal cual deja una tabla cuyo nombre miente. Dos catálogos separados son dos pantallas casi idénticas para una diferencia de una palabra |
  | **Quién puede** | **Permiso propio**, que nace en el rol de encargado y el admin reparte | Que lo haga cualquier garzón deja el control a posteriori y permite tapar el propio error. Solo el admin deja la mesa trabada en un turno sin el dueño, o sea no resuelve el caso |
  | **Parcial** | **Sí**: se despacharon 3, se saca 1 | Nuestro modelo ya lo permite (`cantidad_enviada` es una cantidad, no un flag) y **ningún POS relevado lo documenta**. Sacar la línea entera obliga a anular 3 y re-pedir 2, ensuciando comanda, reporte y kardex con movimientos que no pasaron |
  | **La línea** | **Queda marcada como anulada**, con motivo y quién autorizó | Que desaparezca deja la cuenta sin rastro del plato regalado. ⚠️ El costo está medido y hay que acordarse: `ItemsService.comprometidoPorItem` suma toda línea viva de una cuenta `abierta`, así que **necesita una condición más** para dejar de contar la anulada — si no, la mesa sigue apartando stock de un plato que ya no está |
  | **La precuenta** | **Muestra el plato en $0 con la palabra "cortesía"** | Que no aparezca pierde el gesto comercial: regalaste un plato y el cliente no se entera |

  ⛔ **Lo que NO se decidió y no se pregunta acá: qué muestra la BOLETA.** El documento
  tributario es fiscal y abre su propio frente (`CLAUDE.md`, ADR-010). La precuenta no es un
  documento tributario, por eso sí se decidió.

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

- [ ] **Regla 6 de la spec del costo sin tipear: cuando exista un reporte de mermas, tiene
  que decir cuántas quedaron sin valorizar** (backend + producto, decisión del owner
  2026-08-28, [`2026-08-28-merma-sin-costo-tipeado-design.md`](../superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md)
  §2 regla 6 y §4) — **hoy no existe ningún reporte de mermas.**
  `mermas.controller.ts` tiene solo el `GET` de listado (paginado, sin agregación) y el
  `POST`; no hay nada que arreglar todavía.
  ⚠️ **Ojo con cómo se lee el hueco: `costoPerdido` no es una columna.** Se deriva en la
  lectura (`mermas.service.ts` → `mapRow`, `cantidad × costo_unitario` a la escala de
  costo cuando `costo_unitario` no es `null`; `null` si no hay costo) — verificado
  2026-08-28. El camino de lectura de hoy funciona sin cambios: esto no es "falta un
  `SUM`", porque no hay ningún `SUM` roto. Es una cuenta futura que va a nacer mal si nadie
  la avisa: el día que se construya un reporte que agregue `costoPerdido`, cualquier
  `SUM`/promedio que simplemente ignore las filas con `costoUnitario: null` va a informar
  **menos pérdida que la real, sin decirlo** — exactamente lo que hace posible el congelado de
  la regla 2 de
  [`2026-08-28-merma-sin-costo-tipeado-design.md`](../superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md).
  **Al construir el reporte:** contar esas filas aparte (cuántas mermas
  quedaron sin valorizar, no solo omitirlas del total).

- [ ] **Re-tasar una línea ya pedida tiene que re-preciar, no re-validar** (backend, motor
  de cálculo — **frente propio, decidido por el owner el 2026-08-30**; los cinco caminos
  que *sacan* algo ya están cerrados y lo que queda es otra familia, medida el mismo día)
  — la causa de fondo es una sola: `resolverPersonalizacionReceta` /
  `resolverPersonalizacionCombo` vuelven a validar el snapshot congelado contra el catálogo
  de hoy. Si algo ya no cuadra, la cuenta entera responde 400 al cerrar y la mesa queda
  **incobrable**.

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

  ⚠️ **Lo que la decisión NO contesta, y es lo primero que tiene que resolver la spec:**
  el `precioBase` del ítem. La pregunta se hizo sobre el extra; la misma lógica aplicada al
  plato diría que una hamburguesa pedida a $5.000 se cobra a $5.000 aunque la carta ya diga
  $6.000, pero `cuenta_lineas` **no** guardaba hasta hoy el precio base congelado, así que
  no es "leer la foto" sino agregarle un campo. Preguntar antes de asumir.

  ⚠️ **Y va solo, con el sistema quieto** (`CLAUDE.md`, primer punto de "Detenerse y
  preguntar"): toca `resolverPersonalizacionReceta` / `resolverPersonalizacionCombo`, que
  son motor de cálculo.

  📌 **Los cinco guards no se tiran cuando esto se construya.** Siguen siendo la respuesta
  correcta a *"¿podés sacar de la carta algo que una mesa está esperando?"* —un dato de
  operación, no de tasación— y el mensaje que nombra la mesa es lo único que hoy le dice al
  admin que hay alguien sentado esperando eso.

  ⚠️ **Dos trampas medidas que el que tome esto se va a encontrar:**
  1. **La precuenta no valida todo lo que valida el cierre.** `puedeCostar()`
     (`calculo-precios.service.ts`) saltea el resolver cuando la línea no tiene extras,
     grupos ni componentes, así que una línea con **solo** `omitidos` rotos muestra precio
     normal en la precuenta y explota recién al cobrar. Reproducir por la precuenta y
     concluir "no pasa nada" es el error fácil.
  2. **No todo lo que rompe grita.** Si un componente de combo se queda sin **ningún**
     grupo asociado, `resolverPersonalizacionCombo` hace
     `if (!catalogo.asociados.length) continue` y la opción elegida **desaparece del
     precio en silencio** (medido: 4500 → 4300). Hoy no es alcanzable por acción de
     catálogo, pero solo porque lo tapan tres guards distintos —la desasociación, el
     borrado del grupo y el borrado del componente—; si alguno se afloja, vuelve, y vuelve
     callado.

  ⚠️ **El e2e de todo esto tiene una trampa conocida**: el fixture no puede usar grupos ni
  recetas del seed, porque sacarles una pieza los rompe para las demás suites. Los cuatro
  tests ya escritos (`grupos-modificadores.e2e-spec.ts` ×2, `recetas.e2e-spec.ts` tests 16
  y 17) arman su propio catálogo — copiar de ahí.

  ❓ **Y lo de siempre, aparte:** `useCalculoPrecios` se traga el 400 a propósito y
  `lineaSubtotal` dibuja `—` en todas las líneas sin decir por qué. Que el composable diga
  **qué línea** lo causó es una decisión chica y barata, independiente de todo lo de
  arriba.

### Los tres que dejó el frente del redondeo por país (2026-09-03)

Los tres salen del frente que hizo que el redondeo del tenant tenga su default puesto por su
país y quede bloqueado donde la norma lo fija ([spec](../superpowers/specs/2026-09-03-redondeo-por-pais-design.md)).
Ninguno rompía nada hoy — los tres eran **alcanzables mañana con una edición del seeder**, que
es exactamente lo que ese frente acababa de hacer.

Los dos primeros ya están en [`resueltos.md`](resueltos.md). **Sigue abierto el tercero**, que es
fiscal y va solo:

- [ ] **Los 6 decimales del Anexo 20 no entran en las columnas.** El tenant mexicano nace con
  `escalaCalculo: 4` porque toda columna de plata de `venta_detalles` es `NUMERIC(18,4)` y con
  `'documento'` las líneas se persisten **sin cuantizar**: con escala 6 el recorte lo
  terminaría decidiendo el cast de Postgres, fuera del modo de redondeo del tenant. El SAT
  habla de hasta **6** decimales por línea. El costo de la diferencia está medido —cada
  `redondear()` mete a lo sumo 5e-5 y una línea pasa por uno por paso de la fórmula, o sea
  ~1,5e-4 a 2,5e-4 por línea: medio centavo a las 20-35 líneas— así que solo movería un total
  en un empate exacto. **Es decisión del owner y es fiscal**: llevar el sistema a 6 decimales
  de verdad es cambiar la escala de todas las columnas de plata de `venta_detalles` — motor de
  cálculo + fiscal, frente propio (ADR-010).

### Los cuatro que dejó el frente de la reserva de stock (2026-09-01)

Los cuatro salieron de ese frente, pero **no todos son ajenos a él, y eso hay que decirlo
bien**: la 1 y la 4 son **preexistentes** (julio, y de siempre); la 2 es un hueco viejo que
**este frente volvió sub-descuento** —hasta el 2026-09-01 no existía ningún número descontado,
así que el drawer no mostraba de más—; y la 3 **la introdujo este frente**, medido con
`git log -L` sobre `salones/index.vue`: `refrescarItems` y `programarRefrescoItems` nacen en
`c6489ecd` (Tarea 8) y antes los tres `GET /items` salían **solo en la carga inicial**.
⚠️ Se escribe así porque la primera versión de este párrafo decía *"ninguno lo introduce"*, que
es **el mismo error que este frente ya cometió y corrigió una vez** —atribuir a deuda heredada
una regresión propia, ver el doble descuento en [`resueltos.md`](resueltos.md)—. La atribución
se cruza con la fecha del commit, no se recuerda.

Están acá y no en la § 1 porque ninguno es mecánico: **queda uno solo abierto** —el refresco
del catálogo, que es frontend + backend y **pide medir antes de tomarse**—, y los tres ya
cerrados estaban acá porque uno encendía un camino muerto, otro era contrato de otro endpoint
y el tercero movía un rechazo de puerta. Y no
en la § 4 porque **ninguno espera una respuesta del owner**: la decisión que los gobierna ya está tomada (*lo que la mesa pide queda apartado, y la
pantalla muestra lo que se puede pedir*). Contexto del frente:
[`resueltos.md`](resueltos.md).

- [ ] **El refresco del catálogo del salón cuesta tres `GET /items` y podría costar cero**
  (backend + frontend; **lo introdujo este frente**, `c6489ecd` / Tarea 8, y lo señaló su propia
  revisión) — hoy cada mutación de una cuenta agenda `refrescarItems()`, que vuelve a pedir el
  catálogo entero **tres veces** (uno por tipo: producto, receta, combo), con un debounce de
  250 ms y un guard de secuencia que descarta la respuesta que llega tarde
  (`frontend/app/pages/salones/index.vue`). **Antes de `c6489ecd` esos tres GET salían solo en
  la carga inicial de la pantalla**: lo que la Tarea 8 agregó es colgarlos de cada mutación,
  porque el número pasó a calcularlo el servidor.
  **Eso es el estado de esa tarea, no el diseño final**, y conviene que quede escrito para que
  el próximo no lo lea como la forma elegida. **El destino:** las respuestas de mutación de
  salones ya devuelven `CuentaDetalle`; si además cargaran la disponibilidad **del ítem
  afectado**, el refresco costaría **0 GET** y el número sería exacto en vez de eventual.
  ⚠️ Antes de tomarlo hay que medir si el problema existe: el debounce ya colapsa la ráfaga
  —tres ítems seguidos son una sola tanda— y el costo por `GET /items` está medido en 0,36 ms
  del lado del comprometido gracias a los índices de este frente. Lo que sí cambia es la
  latencia percibida y el tráfico de una tablet con wifi de restaurante.

### Tres que el owner decidió el 2026-09-03: acumulación de descuentos, compras y reporte de varianza

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

- [ ] **Compras: carga manual, y el DTE del SII como atajo encima** ✅ *(tres decisiones del
  owner el 2026-09-03: la varianza va **después** de compras; la recepción **puede leer la
  factura del proveedor desde el SII**; y esa lectura **no puede ser el único camino**. Antes
  eran las preguntas 3 y 4 de la § 4)* —
  ⛔ **Es la primera integración con el SII del sistema, y es de ENTRADA.** [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md)
  difirió la **emisión**; leer documentos recibidos es otro eje. Queda registrado que el orden
  se invierte respecto de lo que cualquiera supondría: **vamos a leer DTE antes de emitir uno**.
  **Hoy no existe nada**: no hay módulo, ni entidad, ni directorio de compras (verificado
  2026-09-03). Lo que sí existe es el motivo `compra` en `movimientos_inventario`, o sea el
  lugar donde la recepción va a aterrizar.

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

  ✅ **Y esto reordena la construcción a favor:** compras **manual se construye sin ninguna
  integración**, así que la lectura del DTE queda como **segunda fase**. La varianza —que espera
  a compras— deja de esperar además a que funcione una integración con el SII.

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

- [ ] **Reporte de varianza (AVT) — después de compras** ✅ *(owner, 2026-09-03)* —
  *"Según tus recetas debías usar 40 kilos y usaste 47"*: consumo **teórico** (lo que las
  recetas dicen que se consumió, dado lo vendido) contra consumo **real**
  (`inicial + compras − final`).
  📌 **El repo ya lo declaraba como el próximo sub-proyecto desde julio**: la fila del recuento
  en [`../ESTADO.md`](../ESTADO.md) dice *"Insumo que faltaba para el reporte de varianza (AVT),
  sub-proyecto siguiente"*.
  **Las piezas existen**: recuento implementado el 2026-07-26 (da inicial y final) y el motivo
  `compra` en `movimientos_inventario` (da las entradas). **Técnicamente se podría hacer ya** —
  el owner decidió esperar a compras **para que el insumo sea confiable**, no porque falte
  maquinaria.

### Un descuento o recargo de monto fijo declara su propia moneda (owner, 2026-09-09)

- [ ] **Darle `moneda_id` a `descuentos` y `recargos`, y convertir ese importe antes de
  aplicarlo** —como ya se hace con el precio— para que un recargo legítimo en UF o en dólares sea
  expresable (backend + BD + frontend, decidido por el owner el 2026-09-09).

**El caso que lo motiva, con las tasas sembradas (1 UF = 38.000):** un arriendo de salón con un
recargo de `+0,2 UF` de gastos, sobre ítems de precios distintos. **No se puede escribir como
porcentaje** —es plano, no proporcional al precio— y hoy tampoco como monto fijo: tipear `0,2`
**se guarda mal en silencio**. Lo único expresable hoy es `+7600`, o sea la conversión hecha a
mano y congelada a la tasa del día en que alguien la tipeó.

⛔ **Cómo falla hoy ese `0,2`, porque NO es un rechazo.** Por API directa sí hay 400 —el importe
se valida contra los decimales de la oficial, y CLP tiene **cero**—, pero **por la pantalla nunca
llega a salir**: el campo es un `<MoneyInput oficial>` y con `fraction: 0` maska no deja abrir
parte decimal, así que lo tecleado queda en `2` —dos pesos— y se guarda con **201**. ✅ **Medido
el 2026-09-09**, no deducido del docblock: montando el componente con `monedaId: 'clp-1'` y
tecleando `0,2` —y también `0.2`—, el modelo queda en `"2"` en los dos casos, y **cada uno quedó fijado con su propio test** en
`MoneyInput.spec.ts`, en el describe de las limitaciones conocidas.
➕ **Pegarlo es una tercera conducta, y la buena**: `currency-format.ts` lo marca `rechazado`, el
componente hace `preventDefault` y el campo queda como estaba — sin request y sin plata mal
guardada. ⚠️ Vale **solo para el pegado que reemplaza el campo entero**: uno parcial ni se juzga
y cae al camino de tecleo (`MoneyInput.vue:224`, `reemplazaTodo`). Misma
familia que el ×10 del separador, que el propio `MoneyInput.vue:157-175` tiene anotado, con el
mismo aviso: *un entero es válido en cualquier escala, así que ningún validador **de escala** lo puede ver*.
📌 Con eso la motivación de esta entrada es más fuerte que *"no se puede escribir"*: hoy se
escribe otra cosa y nadie se entera.

**Los escalones, contestado en la misma ronda:** el **mínimo** de un tramo sigue midiendo en
**moneda oficial** y el **importe** va en la moneda de la regla.

⚠️ **Contra qué mide el mínimo lo decide el NIVEL de la regla, y los dos niveles miden NETO** —
`neto: subtotalNeto` en `calculo-precios.engine.ts:1166` (línea) y `:1849` / `:1864` (venta)—. Lo que
cambia entre ellos es el **alcance**: una regla de línea mide su propia línea (`neto unitario ×
cantidad`, `:1100`) y una de venta la **suma de los netos** de todas (`:1798`), que **no** es el
total cobrado. Así que *"+0,5 UF cuando supere $50.000"* mide 50.000 **de neto**: con IVA 19%,
eso es 59.500 de total. Un recargo por tramos mide el neto **sin descontar** —el acumulado viaja
aparte, y solo como base de los porcentajes (`:812-819`)—. Y el recargo plano en UF que motiva
esta entrada es de **línea**, porque va asociado a ítems: lo hacen cumplir dos puertas
(`items.service.ts` al asociar, `calculo-precios.service.ts` al resolver) y **no** un constraint
de la base, según advierte el docblock de la segunda.

⚠️ Lo que **no** queda expresable es la mitad simétrica —*"cuando supere 2 UF"*—: un mínimo
medido en otra moneda. Si algún día hace falta, es otra decisión, no un olvido de ésta.

⚠️ **Antes de tocarlo, lo que el sistema hace HOY, medido el 2026-09-09** — porque una revisión
independiente ya lo leyó al revés una vez y la entrada que salió de eso decía lo contrario: el
motor convierte el precio de la línea a moneda oficial **antes** de aplicar las reglas
(`calculo-precios.service.ts:869`, o `:405` si la línea es una receta o un combo personalizado),
así que un `-1000` sobre una langosta en dólares saca **mil pesos**, no mil dólares. El monto
fijo hoy **ya está denominado**, en la oficial y de punta a punta: lo que la decisión cambia no
es un descuido, es cuál de dos diseños coherentes queremos.

📌 **Al cerrar el frente hay que borrar la afirmación en futuro de TODO lugar que la repita**, no
solo de acá — el criterio es *"dice que el monto pasará a tener moneda propia"*, y se vuelven a
encontrar con:

```bash
grep -rn "moneda propia\|moneda de la regla" docs frontend/app backend/src
```

Al escribir esto eran, además de esta entrada: `docs/patterns/frontend.md` (fila del monto fijo
en § 8), `docs/agent/resueltos.md` (el cierre del vaciado por cambio de moneda) y el docblock de
`monedaPendiente` en `frontend/app/pages/configuracion/items.vue` —el que enumera qué se vacía y
qué frena el gesto—. ⚠️ **No está en `elegirMoneda`**, que es donde el reflejo lo busca porque es
la función del gesto y el template la nombra: ahí no hay docblock, solo comentarios sueltos. Va el comando y no el número
porque el número envejece solo, y porque cerrar en un consumidor no es cerrar.

📌 **Este párrafo vence cuando el frente se construya, y se borra en el mismo commit** — salvo la
refutación del `-1000`, que es lo único que sigue sirviendo después: es lo que evita que la
próxima revisión vuelva a levantar el mismo falso positivo. El inventario de lo que hay que tocar
vive en la tabla de abajo y **no se duplica acá**.

**Lo que cuesta, contado antes de empezar:**

| | |
|---|---|
| Esquema | `moneda_id` en `descuentos` y `recargos`. Sin datos productivos: entities + seeder + reset |
| Escala | ⚠️ **Más grande que "tocar el decorador".** `EscalaMonedaPipe` resuelve **una** moneda por request —la oficial, desde el contexto— y la aplica a todo campo `@EsMontoCobrado`. Con el diseño nuevo, en el **mismo body** conviven `minimoMonto` (oficial) y `valorMonto` + cada `tramos[].valorMonto` (moneda de la regla): el pipe no sabe expresar escala **por campo**, ni tomarla del body en vez del contexto. Y es un borde compartido con muchos otros DTOs |
| Motor — y **dónde** cuantiza | ⚠️ **La decisión de diseño del frente, y esta entrada no la toma.** Convertir **dentro** del motor le agrega una dependencia de tasas y lo deja de ser puro (`calculo-precios.engine.ts:1-14`: sin BD, sin Nest, único import `decimal.js`). Convertir **en el service** —donde vive hoy toda conversión, `calculo-precios.service.ts:1019`, alcanzada desde cinco sitios— le suma **un** redondeo nuevo: el `toDecimalPlaces(4)` de la conversión, con el `modo_redondeo` del tenant. ⚠️ Los otros dos de la cadena (`escalaCalculo` y el `q()` del minor unit) ya corren hoy sobre cualquier `monto_fijo` y correrían igual por el otro camino: el delta entre las dos opciones es **uno**, no tres. Pesa igual, porque `aplicarValor` aplica el `monto_fijo` **plano** (`engine.ts:493`) y entonces el número convertido **es** lo que el documento declara: es un sitio de cuantización de plata **nuevo**, encima de la invariante que se cerró el 2026-08-21 |
| Pantallas | Selector de moneda en `descuentos.vue` y `recargos.vue`. ⚠️ Y la grilla **ya muestra el importe crudo, sin símbolo** (`descuentos.vue:876`, `recargos.vue:878`): con moneda propia ese `0,2` suelto pasa a ser ambiguo |
| Congelado | Al **pedir** una línea, la cuenta congela sus reglas ya resueltas (`salones.service.ts:725`, dentro de `agregarLinea`) y `ReglaCongelada` es `ReglaResuelta` (`common/dto/reglas-congeladas.dto.ts:38`), cuyo `valorMonto` (`calculo-precios.engine.ts:31`) no lleva **moneda ni tasa**: un importe congelado en UF se convertiría recién al cobrar, con la tasa de ese momento. La línea ya congela su `tasaCambio` (`:717`), pero **no es el mismo gesto**: la línea tiene una sola moneda y las reglas son un array donde cada una —y cada tramo— podría traer la suya. ⚠️ Y `hashReglasCongeladas` decide si un pedido nuevo **se fusiona** con una línea existente (`salones.service.ts:793`): meter la tasa adentro de la regla cambia ese hash, así que el mismo ítem pedido antes y después de un cambio de tasa dejaría de fusionarse y saldrían dos líneas |

📌 **Va solo y con el sistema quieto** — y el motivo es de **conducta**, no de qué archivo se
toca: el frente **cambia lo que un `monto_fijo` cobra** y **abre un sitio de cuantización de
plata nuevo**. Es el porqué que da `CLAUDE.md` para el motor y para lo fiscal: *el error no se ve
al escribirlo, se ve en un documento ya emitido*. ⚠️ La justificación *"toca el motor de
cálculo"* NO se sostiene sola: si la conversión se resuelve en el service, `calculo-precios.engine.ts`
puede no cambiar ni una línea.

### La moneda de un ítem y la de sus partes: "se puede, pero sin mezclar" (owner, 2026-09-09)

- [ ] **Enforcear "sin mezclar" en las cuatro superficies donde la moneda de un ítem se cruza
  con la de otro** (backend + frontend, decidido por el owner el 2026-09-09) — la tabla de
  decisiones, lo medido y las trampas son todo lo que sigue en esta sección.

**Cuatro respuestas de una ronda**, sobre las tres entradas que la § 4 tenía abiertas del frente
del vaciado por cambio de moneda. Van en **una sola entrada** porque las respuestas resultaron
ser **una misma regla** aplicada a cuatro superficies: construirlas por separado deja el sistema
incoherente a mitad de camino.

⚠️ **Lo primero, porque cambia el planteo de todo lo demás:** el catálogo multi-moneda
**funciona hoy de punta a punta**. Un tenant chileno tiene CLP, UF y USD habilitadas
(`seeder.service.ts:533`, `seedTenantMonedas`) y una venta de un ítem en dólares se convierte a
pesos con la tasa del día, **congelando esa tasa en la línea** (`ventas.service.ts:515`). No es
una capacidad a medio hacer que se pueda apagar sin costo — por eso la salida elegida no fue
"todo el catálogo en la moneda oficial".

**La decisión: se pueden tener precios en otra moneda que la oficial, y el sistema rechaza
mezclar.** Las cuatro caras, con lo que hay que construir en cada una:

| Caso | Decisión del owner | Dónde se enforcea |
|---|---|---|
| Receta o combo con partes en otra moneda que la suya | **Rechazar al guardar** | `items.service.ts`, alta y `PATCH` |
| Cambiarle la moneda a un ítem que ya es ingrediente o componente | **Rechazar mientras esté en uso**, y el mensaje dice en cuántas recetas está | ídem |
| `PATCH /items/:id { monedaId }` sin los precios nuevos | **400**: cambiar de moneda exige mandar precio base y los precios de extras y opciones ya en la moneda nueva | `update-item.dto.ts` + service |
| Un grupo de modificadores del catálogo pegado a ítems de monedas distintas | **Se deja pegar, pero exige precio propio del ítem** para cada opción: no hereda el `precio_extra` del catálogo | asociación de grupos |

📌 **Con esa regla, las sumas de costo pasan a ser correctas por invariante, no por
aritmética.** Hoy `items.vue:817` (receta) y `:849` (combo) suman `costoActual × cantidad` sin
mirar la moneda, y el backend hace lo mismo y además **lo persiste** (`items.service.ts:5661`
receta, `:5740` combo). "Sin mezclar" las vuelve válidas **porque todas las partes comparten
moneda** — así que el comentario que las acompañe tiene que decir eso, o el próximo que las lea
va a "arreglar" la conversión que falta.

⚠️ **Que el costo no se convierta nunca no es un olvido de esas cuatro sumas:** no hay un solo
`× tasa` en todo el camino del costo (medido el 2026-09-09). El único del backend es
`calculo-precios.service.ts:1019` (`convertirAMonedaOficial`) y es **del precio**. La regla del
owner es justamente lo que evita meter una tasa del día adentro de un costo, que lo volvería
variable — y el costo se usa para márgenes.

⚠️ **Lo que la cuarta cara arrastra y NO está construido:** el override por ítem existe en la
tabla (`item_grupo_modificador_opciones.precio_extra`) pero **la pantalla donde tipearlo no**.
Exigir precio propio sin dónde escribirlo bloquea la asociación entera. Lo que sí existe desde el
2026-09-11 es poder **leerlo**: `GET /items/:id` y `GET /grupos-modificadores/:id/items` mandan
`precioExtraDefault` al lado del efectivo, así que la pantalla ya distingue el override del
heredado ([`resueltos.md`](resueltos.md)).

📌 **Va en su propio frente.** Toca DTO y service de items, dos pantallas y una regla de qué es
un cambio de moneda válido. El gesto del formulario —vaciar y avisar— ya está construido
(2026-09-09) y es el que la API tiene que espejar, no contradecir.

## 4. Necesita que el owner conteste

Cada entrada lleva su pregunta concreta adentro y mientras no se conteste **no se empieza**:
elegir por cuenta propia una regla de negocio no documentada es justo lo que `CLAUDE.md`
prohíbe.

- [ ] **¿Qué pasa con una cantidad que el garzón cambia después de confirmar el cobro?**
  (frontend + producto, salones; **leído en el código el 2026-09-12** por la revisión del cierre
  del flush de la comanda, no medido).

  **La pregunta:** *la mesa 3 confirma el cobro de $12.000 con tarjeta. Mientras el sistema
  termina de cerrar, el garzón —la pantalla sigue tocable— sube de 1 a 2 una bebida de $2.000.
  Hoy, según cuánto tarde el cierre, puede pasar cualquiera de estas cosas: se cobran los $12.000
  y la segunda bebida queda afuera; la cuenta se cierra con las dos bebidas ($14.000) contra los
  $12.000 pagados y la venta queda pagada a medias, sin ningún aviso; o la venta se cierra con una
  bebida y la boleta sale impresa con las dos. ¿Qué tiene que pasar?*
  - **Cobrar lo confirmado, siempre:** la cantidad que cambia después de confirmar no entra a
    esa venta. Falta decidir qué ve el garzón con la bebida que quedó afuera.
  - **Frenar el cobro:** el cobro espera ese cambio y, si la cuenta ya no suma lo mismo, no
    cierra: el garzón vuelve a confirmar con el total nuevo. Pide diseñar ese aviso.

  **Lo leído:** `confirmarCobro` hace `await flushPendientes()` **sin cuenta**, así que un tap
  posterior no se espera. Pero después `cerrarCuentaConPin` todavía espera `asegurarVigente()`
  antes del `POST` de cierre, y el timer de 300 ms del tap corre desde el tap: el `PATCH` puede
  salir antes del `POST` o junto con él —cuál llega primero lo decide el servidor, y la espera de
  `asegurarVigente()` puede ser cero si el cálculo ya estaba vigente—. Si llega primero, el
  servidor cierra con la cantidad nueva contra los pagos del total viejo, y —lo dice el propio
  comentario de ese camino en `salones/index.vue`— nadie valida que los pagos cubran el total:
  queda `pagada_parcial`. Y el tercer resultado sale del cálculo: corre sobre el carrito en
  pantalla, que ya tiene la cantidad nueva apenas se toca, así que si el tap cae antes de
  `asegurarVigente()` la boleta puede imprimir las dos bebidas aunque la venta se cierre con una. *Enviar a cocina* sí
  espera lo de su cuenta desde el 2026-09-12 ([`resueltos.md`](resueltos.md)).

- [ ] **En cascada, el orden en que se aplican dos o más reglas en % mueve el total** (motor
  de precios; **medido el 2026-09-12**; reemplaza a la entrada de la § 2 *"Con tres o más
  porcentajes, el orden entre ellos puede mover el último decimal"*, que lo daba por hipótesis).

  **La pregunta, con un caso medido:** *un recargo de 0,74% y otro de 25,18%, en cascada, sobre
  dos unidades de $43.680: el cliente paga $131.097 o $131.098 según cuál de los dos quedó
  primero, y hoy "primero" lo decide el id interno de la regla. ¿Tiene que haber un orden que
  se pueda explicar (por ejemplo, el mayor primero), o el total tiene que dar lo mismo en
  cualquier orden?*
  - **Un orden con criterio:** cambio chico en cómo se ordenan las reglas. El total sigue
    dependiendo del orden, pero de uno que el ticket puede explicar.
  - **Mismo total en cualquier orden:** cerrar el paso entero y repartir el redondeo entre las
    reglas en vez de redondear cada una por su cuenta. Es rediseñar cómo cierra un paso del
    motor: frente propio, a diseñar.

  **Lo medido** con `docs/agent/medir-orden-porcentajes.ts` —el motor real, todas las
  permutaciones de 2, 3 y 4 porcentajes, 400 casos al azar por combinación de nivel (línea /
  venta), paso, modo de cálculo, nivel de redondeo, decimales de la moneda (0 y 2) y modo de
  redondeo—:

  | modo | cambia el total | desvío máximo |
  |---|---|---|
  | `base` | nunca | — |
  | `compuesto`, redondeo por línea | ≈33% de los casos con 2 reglas, ≈82% con 3, ≈99% con 4 | N−1 minor units a nivel venta; a nivel línea una más, porque el IVA lo arrastra |
  | `compuesto`, redondeo por documento | menos del 3% | 1 minor unit |

  **Por qué:** cada regla cierra cuantizada (`montoQ` en `procesarReglas`) y en cascada la base
  de la siguiente depende de la anterior, así que la suma de los redondeados no conmuta. ⚠️ **El
  docblock de `ordenarReglas` se queda corto dos veces:** dice que dos porcentajes conmutan
  —con dos ya pasa en un tercio de los casos— y que con tres "puede mover el último decimal"
  —mueve hasta N−1—. Se corrige con el frente y no antes: tocar el motor obliga a parar.

  **Alcance:** es alcanzable. "En cascada" se elige en Preferencias financieras (el tenant nace
  en `base`) y un ítem puede tener varios descuentos. Es determinista —mismo carrito, mismo
  total—, así que no es una carrera: es un desvío estable pero arbitrario.
  ⛔ **Toca el motor de cálculo de precios:** va solo y con el sistema quieto.

- [ ] **Un tenant que no es de Chile puede cobrar online con Webpay, y la orden guarda como
  pesos chilenos el total en su propia moneda** (pasarela + online, multi-moneda; **leído en
  el código el 2026-09-12, no corrido**; reemplaza a la entrada de la § 2 *"El modal de
  reembolso formatea con la moneda del tenant una orden que siempre es CLP"*).

  **La pregunta:** *una tienda de México vende online un pedido de $250 pesos mexicanos, y
  Webpay cobra en pesos chilenos. ¿Webpay online se ofrece solo a locales de Chile, o se
  convierte al peso chileno con la tasa del día —y el cliente ve el cobro en otra moneda—?*

  **Lo leído:** `online.service.ts` manda `resultado.totales.totalFinal` —en la moneda oficial
  del tenant— como `monto` a `pagosRedirect.iniciar`, que valida la escala contra
  `MONEDA_ORDEN_V1` (CLP) y guarda la orden con esa moneda (`pagos-redirect.service.ts`). No hay
  conversión en el medio. Si el total trae decimales, el checkout debería contestar 400; si es
  entero, se cobraría ese número en pesos chilenos (USD 10 → $10). Es alcanzable: el seed
  siembra provincias de AR, CO y MX, así que se puede dar de alta un tenant con oficial ≠ CLP,
  y `pasarela` no restringe nada por país.

  **Qué cambia de lo que decía la entrada anterior:** temía que la nota de crédito del
  reembolso acreditara pesos chilenos contra una venta en otra moneda. La nota **no convierte**
  —`reembolso-callback.handler.ts` le pasa el monto de la orden, solo cuantizado a la escala de
  la venta—, pero tampoco tendría qué convertir: en las órdenes del checkout online ese número
  nunca fue CLP. Por lo mismo, el `MoneyInput` con `oficial` del `ReembolsoModal` muestra hoy la
  moneda real del número; qué moneda tiene que mostrar depende de la respuesta.
  `NotaCreditoModal` no tiene el problema: acredita una venta, y la venta se persiste en la
  oficial.
  ⛔ Cuando se arregle, la nota de crédito del reembolso es fiscal: va aparte (`CLAUDE.md`,
  *"Lo fiscal va solo"*).

## 5. Carreras de concurrencia

Van juntas porque el arreglo pide **un solo análisis de orden de locks** —qué fila se
bloquea y en qué orden en cada camino—, no un parche por entrada. Son **dos moldes distintos**, y
conviene no confundirlos:

- **Tres del molde "no toma lock"** —`remove()` de ítems, borrar un ítem contra agregarlo a
  una cuenta, y `PATCH /items/:id` contra `DELETE`—: un `SELECT` de validación sin lock, y
  otra transacción que escribe entre el chequeo y el commit. Cada entrada lo dice por su
  cuenta. El orden que las tres necesitan ya está escrito:
  [`../patterns/backend.md`](../patterns/backend.md) § 15, *"Las reglas van antes que todo eso"*.
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
de las de acá **no es la familia de bug — es la tabla y el disparador**: acá es
caja/inventario/stock; ahí es `items`/`item_receta`/`item_combo` en la bandeja de desfases.
(Los otros dos puntos de esa entrada residual —el `FOR UPDATE` antes de validar tenant, y el
hueco de test de N combos— no son de ninguno de los dos moldes.)

ℹ️ **2026-08-20:** esa entrada residual **se cerró** y vive en
[`resueltos.md`](resueltos.md) § "El orden de bloqueo de filas de la bandeja de
desfases". Lo de arriba se conserva porque la clasificación por moldes sigue siendo cierta
y es la que hay que aplicarle a las de acá. Cómo quedó el "no toma lock" del molde
2: `descartarDesfases` sigue sin tomar un solo `FOR UPDATE` —el arreglo no fue agregar
locks sino **fijar el orden en que sus `UPDATE` los toman solos**—, y el orden canónico del
proyecto está escrito en [`../patterns/backend.md`](../patterns/backend.md) § "Orden de
bloqueo de filas en ítems compuestos". Es el precedente más cercano que tienen las
entradas de esta sección.

- [ ] **Dos de los tres caminos que revierten stock no tienen la protección de deadlock que su gemelo
  `crear()` sí tiene** (backend, auditoría `inventario` 2026-08-15) — es el otro molde: acá el
  lock **sí** se toma, lo que no es determinista es **el orden**. (Decía "los tres de arriba",
  y era falso desde antes de que existiera esta nota: es la única de su molde, y las otras
  cuatro no están todas arriba.)
  `registrarMovimiento` toma un `FOR UPDATE` sobre `item_producto` **por ítem**, o sea N
  statements separados. `crear()` lo sabe y lo resuelve con dos capas —orden determinista por
  `itemId` (`ventas.service.ts:618-626`) y reintento ante `40P01`
  (`MAX_REINTENTOS_DEADLOCK`)—, y su propio comentario explica que el deadlock era real.
  **Falta en `crearNotaCredito` y `registrarDevolucionesPorReembolso`**, y el arreglo es el
  que ya tiene `cancelar`: ordenar por `itemId` con `localeCompare` —el mismo comparador que
  `crear()`— y reintentar ante `40P01`.
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
  tanda 🔴 (*"redondeo de plata"*), acá con el alcance completo y medido. **Una de sus dos
  decisiones reabiertas —el redondeo por país— ya se construyó el 2026-09-03; la otra —la
  UF— es la que mantiene el tema abierto.**

  > 🛑 **PAUSADO OTRA VEZ POR EL OWNER, PARA UNA SESIÓN PROPIA (2026-09-03).** Contestó las
  > cinco preguntas de la §9 esa mañana y **reabrió dos de ellas esa misma tarde**, al ofrecerle
  > la medición que faltaba: *"quedé super confundido, creo que dejemos esto para una sesión
  > sola"*. **De esas dos, la del país ya está construida** (ver [`resueltos.md`](resueltos.md)); **la UF sigue
  > sin decidir y es la que pesa.**
  >
  > **Al retomar, arrancar por [ADR-024](../adr/024-decimales-redondeo-y-unidades-de-cuenta.md)**,
  > que en su encabezado dice qué quedó firme, qué se cerró y qué sigue abierto. En una línea:
  > firmes el criterio único, el congelado en el documento y la columna única; **cerrado y
  > construido el redondeo por país**; **abierta la UF**, que es lo que más lo frenó y lo único
  > que queda por decidir acá.
  >
  > ⚠️ **El escenario de la UF que el owner describió, textual, porque no está contestado por la
  > decisión como está escrita:** *"pueden llevar toda su operación en UF, pero esas UF al final
  > se convierten a pesos para poder pagar"*. Suena compatible con *"la UF solo cotiza"*, y ahí
  > está la trampa: **nadie midió qué implica**. Qué pasa con los reportes históricos, con la
  > lista de precios y con la contabilidad si el negocio piensa en UF todo el día y el sistema le
  > guarda pesos. Eso es lo que hay que traerle resuelto, no una pregunta más.
  >
  > 📌 **La medición pendiente NO se corrió, a propósito**: afina una prohibición que cuelga de
  > las decisiones reabiertas.
  >
  > ⚠️ Lo que sigue abierto es la **decisión 3, la UF** —
  > que es la que más frenó al owner— y con ella el tema entero sigue pausado para una
  > sesión propia. Lo que el frente dejó de deuda propia está en la § 3 de este archivo,
  > *"Los tres que dejó el frente del redondeo por país"*, y uno de esos tres (los 6
  > decimales del Anexo 20 contra columnas `NUMERIC(18,4)`) **es fiscal y lo decide el
  > owner**.
  >
  > 📊 **Los pros y contras ya están hechos**, a pedido del owner el mismo día:
  > [`investigaciones/2026-09-03-uf-y-nivel-por-pais-analisis.md`](investigaciones/2026-09-03-uf-y-nivel-por-pais-analisis.md).
  > Su hallazgo principal cambia la pregunta: **cuatro de los cinco huecos del escenario de la UF
  > no se resuelven haciéndola moneda oficial** —se resuelven con un reporte y con historial de
  > tasas—, y el monto en UF **ya está persistido por línea**, así que el costo que el ADR daba
  > por aceptado era falso.
  >
  > ✅ Lo que **sí** quedó y no se toca: [ADR-025](../adr/025-decimales-estado-actual.md), el
  > estado actual medido contra el código. Es lo único del tema que se puede leer sin riesgo, y
  > vale igual pase lo que pase con las decisiones.
  >
  > **Lo primero que apareció al retomar es que la pregunta estaba peor planteada que el
  > sistema.** El owner describió tres capas —cálculo, presentación y redondeo al final— y las
  > tres **ya estaban construidas con esos mismos nombres** (`escala_calculo`,
  > `moneda.decimales`, `nivelRedondeo`). Tres de las cinco preguntas se cerraron sin construir
  > nada. Corolario para el próximo: **antes de llevarle al owner las preguntas de una
  > investigación, cruzarlas contra lo que el código ya resuelve** — varias pueden estar
  > contestadas.
  >
  > **Lo que sí queda, y es una MEDICIÓN, no una decisión:** `nivelRedondeo = documento` se
  > rechaza con 400 si la moneda oficial tiene 0 decimales, y esa prohibición hay que volver a
  > medirla — lo medido apunta al revés (con descuento de nivel venta, `documento` se queda
  > plano y `linea` crece con el carrito) y **su premisa es falsa**: lo señaló el owner, un
  > tenant chileno puede cotizar en **UF** y otro puede llegar a decimales por **conversión
  > desde dólar**, así que *"moneda sin decimales ⇒ nada tiene decimales"* no se sostiene. Los
  > tres casos que la medición tiene que cubrir están listados en el ADR.
  >
  > 🛑 **Sigue valiendo lo de siempre:** esto es el motor de precios e impuestos. Con el ADR
  > escrito se puede hacer la medición y redactar la spec; **tocar el motor no**, hasta que la
  > spec esté aprobada.
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
  ⚠️ **Las cinco preguntas de la §9 se contestaron el 2026-09-03 y DOS se reabrieron ese mismo
  día** → [ADR-024](../adr/024-decimales-redondeo-y-unidades-de-cuenta.md).
  En una línea cada una: un solo **criterio** con el número puesto por la moneda; el **nivel de
  redondeo lo fija el país** y el tenant no lo toca; la **UF solo cotiza**, nunca es moneda
  oficial; se **congelan los decimales en el documento** pero el reparto por mayores restos no
  se generaliza; y **una sola columna de decimales por moneda** (YAGNI explícito del owner:
  *"estamos muy lejos de tener casos como el afgani"*), con su costo anotado.

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

### El frente fiscal de Argentina, Colombia y México — documentos tributarios e impuestos de sistema (agendado 2026-09-03)

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
