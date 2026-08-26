# Resueltos — archivo de pendientes cerrados

Entradas que salieron de [`pendientes.md`](pendientes.md) al corregirse. Cada una queda
con el texto con el que se cerró: **qué se hizo, por qué, y qué mutante o test lo fija**.

Existe porque `pendientes.md` es una lista de trabajo, y una lista de trabajo con más
entradas tachadas que vivas deja de leerse. Acá el detalle sigue disponible —las auditorías
de jul-2026 se explican solas desde este archivo— sin competir con lo que falta hacer.

Agrupadas por su procedencia en `pendientes.md`. El texto se muda **verbatim**: si una
entrada afirma algo que después resultó falso, se corrige donde se descubre, no acá.

Corolario de "verbatim": las **citas de línea de una entrada mudada quedan como estaban**,
aunque el propio cierre las haya corrido — describen el código en el momento en que se
midió el problema, que es lo que este archivo registra. En `pendientes.md`, que es texto
vivo, la regla es la contraria: ahí una cita que apunta a otra cosa se corrige o se saca.

---

## El tope de nombres se cuenta por grupo: ni esconde el borrado ni arma un toast de 50 (2026-08-26)

**Venía de la sección 1**, la única mecánica que quedaba. Texto verbatim:

> - [ ] **Los nombres de ítems borrados no tienen tope en el mensaje del cambio de nivel**
>   (frontend, mecánico; lo dejó ver la revisión independiente del 2026-08-25) —
>   `itemsQueLoTienen` en `useNivelRegla.ts` acota los **vivos** con `MAX_NOMBRES` pero a los de
>   la papelera los agrega todos: una regla con 50 asociaciones borradas arma un toast con 50
>   nombres.
>
>   📌 **La asimetría en sí es correcta y hay que conservarla** —los borrados son los que el admin
>   no puede ver por ningún otro lado, y recortarlos fue justamente el bug que esa revisión cazó—.
>   Lo que falta es un techo para ellos también: mismo tratamiento, *"y N más (en la papelera)"*.

**Lo que se hizo:** `MAX_NOMBRES` pasó de ser un tope sobre los vivos a un **presupuesto por
grupo** — hasta cinco vivos y hasta cinco de la papelera, cada uno con su propia cola
(*"y 2 más"*, *"y 3 más en la papelera"*).

**Por qué por grupo y no un tope único**, que es lo que hay que entender antes de
"simplificarlo": las dos formas simples fallan en direcciones opuestas, y las dos ya se
probaron acá.

| Forma | Cómo falla |
|---|---|
| tope sobre la lista entera (la 1.ª versión) | el backend devuelve los borrados **al final**, así que 5 vivos + 1 borrado decía *"y 1 más"* y el invisible seguía invisible — tapaba justo lo que el mensaje existe para mostrar |
| sin tope para los borrados (la 2.ª) | 50 asociaciones en la papelera = un toast de 50 nombres, ilegible; o sea igual de inútil que esconderlos |

El presupuesto por grupo cubre las dos: el borrado nunca se esconde detrás de los vivos, y su
cola dice cuántos faltan.

⚙️ **Cómo se sabe que muerde.** Un mutante que revierte al código anterior —los borrados sin
tope y sin cola— tira **exactamente los dos** tests nuevos y deja los nueve viejos en verde. El
segundo test existe justamente porque el primero no alcanza: con 8 borrados y ningún vivo,
recortar por grupo y recortar en total dan el mismo resultado, así que hace falta un caso con
los DOS grupos pasados de largo para distinguirlos.
---

## Una regla dice su importe de una sola forma: los nueve tipos que no eligen (2026-08-26)

**Venía de la sección 3**, adonde había bajado el 2026-08-25 con la decisión del owner escrita
adentro. Texto verbatim de la entrada:

> ### Los tipos de valor único: el hueco se cierra, no se abre (decidido 2026-08-25)
>
> - [ ] **Cuatro tipos de valor único aceptan `tramos` por API, y el motor los prefiere: la
>   tasa queda muerta sin aviso** (backend) — lo dejó ver la revisión independiente del frente
>   de método de pago, y es **el mismo bug que ese frente cerró**, en los tipos que quedaron
>   afuera. Nada en `validarSegunTipoCreate` prohíbe mandar valor **y** tramos, y `evaluarRegla`
>   ramifica por `tramos.length > 0` antes de mirar el valor plano.
>
>   **Medido** ejecutando el motor con una regla al 50% más un tramo al 3% sobre un neto de 100
>   (revisión independiente, 2026-08-25):
>
>   | Tipo | Qué cobra | ¿Tiene el hueco? |
>   |---|---|---|
>   | `directo` | el tramo (3) | **sí** |
>   | `general` | el tramo (3) | **sí** |
>   | `interes_simple` | el tramo (3) | **sí** |
>   | `interes_compuesto` | el tramo (3) | **sí** |
>   | `pronto_pago` | cero | no — corta en `DIFERIDAS` |
>   | `mora` | cero | no — corta en `DIFERIDAS` |
>
>   ⚠️ **La primera redacción de esta entrada nombraba `pronto_pago` y omitía los dos de
>   interés**, y la bloqueó la revisión por eso. Las dos mitades del error importan: mandaba a
>   buscar en `pronto_pago` un mecanismo que ahí **no ocurre** —está en `DIFERIDAS`
>   (`calculo-precios.engine.ts:297`) y retorna antes de la rama de tramos—, y dejaba afuera
>   **dos tipos que sí cobran mal**. Es exactamente la falla que este frente vino a cerrar,
>   cometida al escribir su propio remate.
>
>   ✅ **DECIDIDO (owner, 2026-08-25): CERRAR.** Los cuatro tipos cobran un valor y punto: la API
>   rechaza con **400** al que mande valor **y** tramos. La apertura queda a una línea de
>   distancia, pero **no se construye hasta que un caso de local la pida**.
>
>   **Por qué no ganó el precedente** — esto es lo que quien la tome tiene que entender antes de
>   tocar nada, porque la gemela se decidió al revés el mismo día. Cuando el owner abrió los de
>   método de pago, esos tipos **ya estaban en la pantalla** y sus escalones a medio construir:
>   el local podía crear la regla y el motor le cobraba mal. Acá `campoTramos: false` en los
>   seis, así que **hoy nadie cobra mal** y lo único que existe es un agujero de escritura.
>   Abrir sería una feature nueva —cuatro pantallas, y decidir qué mide un escalón en un
>   interés compuesto, que no es obvio— sin ningún caso que la pida.
>
>   **El trabajo, entonces:** negar tramos no vacíos cuando el código está en
>   `TIPOS_CON_VALOR_UNICO`, en los dos services. `validarFormaDeImporte` ya existe en
>   `common/utils/monto-regla.util.ts` y sirve tal cual, sin tocarla. Esa lista cubre los cuatro
>   con hueco **y** los dos diferidos, así que no hay que enumerar nada a mano.
>
>   📌 **No es alcanzable desde la pantalla** (`campoTramos: false` en los seis), igual que no lo
>   era para método de pago hasta que se construyó. O sea: hoy no cobra mal, y lo único que lo
>   impide es que nadie pegue a la API a mano.
>
>   ⚠️ **Toca el motor solo para leerlo, no para cambiarlo**: la conducta —gana el escalón— se
>   deja como está y lo que se agrega es el guardia de escritura. Quien la tome mide primero si
>   `por_mayor`/`por_monto_venta`/`recargo_por_monto_venta` tienen el hueco espejo (aceptar un
>   valor plano además de sus tramos), porque es la misma familia y esta entrada **no lo
>   verificó**.

**Lo que se hizo:** dos hermanos de `validarFormaDeImporte`, en el mismo archivo —
`validarValorUnico` (exige el valor único y **prohíbe** escalones) y `validarSoloEscalones`
(prohíbe el valor plano)— cableados en los **cuatro** puntos de escritura: `create` y el
estado resultante del `PATCH`, en los dos services. El motor **no se tocó**, que era la
condición de la entrada.

**Lo que la entrada NO sabía, y lo cambió el hecho de medir.** La entrada mandaba verificar si
`por_mayor`/`por_monto_venta`/`recargo_por_monto_venta` tenían el hueco espejo, y decía que
`mora` y `pronto_pago` no lo tenían. Sondeando los NUEVE códigos uno por uno, antes y después:

| Tipo | Forma que le toca | Antes | Qué pasaba al cobrar |
|---|---|---|---|
| `directo`, `general`, `interes_simple`, `interes_compuesto` | valor único | 201 con las dos | el motor prefiere el escalón: la tasa quedaba muerta sin aviso |
| `pronto_pago`, `mora` | valor único | **201 con las dos** | nada: cortan en `DIFERIDAS` |
| `por_mayor`, `por_monto_venta`, `recargo_por_monto_venta` | escalones | **201 con las dos** | nada: el valor plano no lo lee nadie |

O sea: el hueco espejo **existía**, y además `mora`/`pronto_pago` sí aceptaban la escritura —lo
que no tenían era consecuencia al cobrar, que es distinto—. Nueve códigos, no seis: la primera
redacción de la doc de la feature dijo "seis" contando los sondeados hasta ese momento, y se
corrigió antes de commitear.

**Cómo se sabe que los tests muerden.** Ocho mutantes, cada uno revirtiendo al código
anterior —no rompiéndolo de cualquier forma—, con lo que cae **contado corriendo las suites**,
no estimado:

| Mutante | Qué revierte | Cuántos caen |
|---|---|---|
| A | la rama de valor único en los dos services, a la condición vieja | **4** |
| B | sacar la rama de solo-escalones en los dos services | **6** |
| C | sacar el `throw` de `validarValorUnico` | **6** |
| D | sacar el `throw` de `validarSoloEscalones` | **7** |
| E | la condición vieja del `tramos: []` (`!TIPOS_CON_TRAMOS_OPCIONALES`) | **2** |
| F | sacar el freno del drawer | **8** |
| G | el body del drawer vuelve a limpiar los escalones solo para los tipos que eligen | **2** |
| H | ídem con el valor único: la rama gemela, que es la que se olvidó | **2** |

⚠️ **Los números son de las suites UNITARIAS** —`jest` de backend para A–E, `vitest` de las dos
pantallas para F–H—. El e2e **no se corrió por mutante**: caería también en varios, pero eso no
se midió y por eso no se cuenta acá. Y son de la ÚLTIMA corrida: los tests crecieron dos veces
durante el frente, así que un número escrito antes de la última tanda ya no valía. Es el motivo
por el que la tabla se volvió a medir entera en vez de sumarle filas.

📌 Dos correcciones que la revisión independiente cazó midiendo, y que valen como método: C y D
se habían anotado como *"2 unit del util"* y *"1 unit del util"*, tratándolas como mutantes de
capa —pero los services **llaman** al util, así que sacarle el `throw` tira también los de
service—; y F se había anotado en 4 cuando los tests del espejo lo llevaron a 8.

A, B, E y H son el revert exacto al código anterior: prueban que el test caza **el bug que
había**, no solo que la línea nueva existe.

**Dónde vive la conducta:** `backend/src/common/utils/monto-regla.util.ts`, con sus tests
unitarios; los service specs cubren los cuatro puntos de escritura; y `reglas-valor.e2e-spec.ts`
suma un caso por dirección, que es el único lugar donde se ejercita el `ValidationPipe` — los
dos campos son `@IsOptional()`, así que el pipe deja pasar el body con las dos formas y el
service es el ÚNICO enforcement.

📌 **La asimetría con método de pago es deliberada y está escrita en el código**, no solo acá:
la gemela se ABRIÓ el 2026-08-25 y ésta se CERRÓ. La diferencia que decidió: allá los escalones
ya eran visibles en la pantalla y el local cobraba mal; acá **la forma sobrante no es
alcanzable desde la pantalla en ninguno de los nueve**, así que no había nadie cobrando mal —
solo un agujero de escritura. Medido en `reglas-form-config.ts`, y son dos banderas distintas
según el grupo: `campoTramos: false` en los seis de valor único, `campoValor: false` en los
tres por escalones.

⚠️ Esa medida llegó a estar escrita como *"`campoTramos: false` en los nueve"*, que es falso
para los tres por escalones —ahí esa bandera está en `true`—. No es un detalle de redacción:
**ésta es la razón registrada de por qué el owner cerró acá y abrió en método de pago**, así
que quien la verifique tiene que poder reproducirla. La cazó la revisión independiente.

**Y lo que el guardia destapó, que fue la mitad más cara del frente.** Cerrar el estado
prohibido dejó sin salida a un camino de todos los días: cambiar el tipo de una regla de
escalones a uno de valor único. Los escalones del tipo viejo quedan vivos —`update` solo
reemplaza los hijos que vengan en el DTO—, así que el `PATCH` pegaba contra el guardia nuevo;
y la única forma de limpiarlos, `tramos: []`, chocaba contra un 400 **preexistente** que decía
*"Este tipo requiere al menos un tramo"* sobre un tipo que no admite ninguno. La condición
preguntaba `!TIPOS_CON_TRAMOS_OPCIONALES` donde tenía que preguntar `TIPOS_CON_TRAMOS`.

⚠️ **Sin arreglar eso, el commit habría dejado la pantalla peor que antes**: hasta acá el
cambio de tipo guardaba con 200 y cobraba mal en silencio; con el guardia solo, guardaría 400
sin ninguna salida. Lo cazó el e2e `cambiar el tipo MANDANDO lo que el nuevo exige`, que estaba
en verde desde antes y es una **ancla positiva** — o sea que el frente rompió justo el test que
existe para avisar que se rompió algo legítimo.

⚠️ **Y la primera versión del arreglo lo hizo en UNA sola dirección**, que es la parte que más
vale contar. Se agregó el vaciado de escalones y se dejó intacta la rama gemela —la que apaga
el valor único—, así que el camino **valor único → escalones** quedó con el mismo callejón:
`importeResultante` lee la columna PERSISTIDA cuando el body no la manda, y el 400 nombraba un
campo que en ese tipo **no está en pantalla** (`campoValor: false`). Lo cazó la revisión
independiente **midiendo contra la API corriendo**, no leyendo: el gate estaba entero en verde
porque el e2e cubría la dirección arreglada y no la espejo.

Las dos direcciones tienen ahora su caso que **falla** y su **ancla positiva**, pero el reparto
entre capas no es simétrico y conviene decirlo en vez de sugerir que lo es:

| Capa | escalones → valor único | valor único → escalones |
|---|---|---|
| unit de service | la salida `tramos: []`, y el ancla de que el tipo que EXIGE escalones lo sigue rechazando | el par completo: sin apagar la columna es 400, apagándola pasa |
| e2e | sin limpiar es 400 · limpiando es 200 | sin apagar es 400 · apagando es 200 |
| las dos pantallas | frena y avisa · al confirmar manda `tramos: []` | frena y avisa · al confirmar manda la columna en `null` |

El cambio de tipo **sin** limpiar se fija en e2e y no en unit a propósito: ahí participan el
`ValidationPipe` y el estado realmente persistido, que es de donde salía el huérfano.

✅ **Decisión del owner (2026-08-26): avisar antes de borrarlos**, no borrarlos callado. La
razón que la definió: al elegir el tipo nuevo la sección de escalones **ya desapareció del
formulario**, así que borrarlos sin decir nada es borrar algo que dejó de estar a la vista en
el mismo gesto. El drawer frena con un `CrudModal` que dice cuántos son y recién después manda
`tramos: []`.

📌 **La asimetría que queda está anotada, no escondida:** el interruptor de los tipos que
ELIGEN forma —método de pago— sigue borrando los escalones sin preguntar, como se decidió el
2026-08-25. Unificarlas es del owner → [`pendientes.md`](pendientes.md).

---

## La invariante 3 de `CLAUDE.md` pasa a criterio: la excepción vale si el porqué está en la consulta (2026-08-25)

**Venía de la sección 4** y la contestó el owner el mismo día en que se escribió. Texto
verbatim:

> - [ ] **La invariante 3 de `CLAUDE.md` se reescribió en un commit de feature, y eso lo
>   confirmás vos** (documentación; 2026-08-25) — decía *"Toda lectura filtra `eliminado_el IS
>   NULL`"*, en absoluto. **El absoluto ya era falso antes de tocarlo**: hay al menos seis
>   lecturas que no filtran a propósito, todas anteriores a este frente (kardex ×2, mermas,
>   líneas de comanda, la autoría del borrado, la papelera). Se reescribió como **criterio** —
>   *lo que distingue una excepción de un olvido es que el porqué esté escrito en la propia
>   consulta*— porque el enunciado absoluto es justamente lo que hace que el próximo agente
>   "arregle" una excepción medida.
>
>   ❓ **Lo que hay que confirmar no es el dato sino la potestad.** Tu decisión del 2026-08-25
>   autorizaba **la excepción del endpoint** (`GET /:id/uso` devuelve los borrados marcados), no
>   cambiar el enunciado de una invariante del proyecto. Lo señaló la revisión independiente y
>   tiene razón: la invariante es la regla que aplican el próximo agente, la revisión y en parte
>   el pre-commit, así que ablandarla de arrastre amplía una decisión puntual a una regla general.
>
>   ⛔ **`CLAUDE.md` quedó SIN TOCAR, a propósito.** La reescritura llegó a estar en el diff y se
>   revirtió antes de commitear: el preámbulo de ese mismo archivo dice *"detenerse, reportar el
>   conflicto y esperar confirmación. Nunca resolverlo por cuenta propia"*, y editar el enunciado
>   de la invariante que uno está excepcionando es resolverlo por cuenta propia — encima
>   auto-legalizándolo. Lo señaló la revisión independiente **dos veces**.
>
>   Así que hoy la invariante 3 sigue diciendo *"Toda lectura filtra"*, en absoluto y falso. Lo
>   que sí se escribió, porque ahí sí corresponde, es el criterio en
>   [`docs/agent/anti-patterns.md`](anti-patterns.md) —con la tabla de formas que toman— y en
>   [`docs/patterns/backend.md`](../patterns/backend.md), que es el paso 1 del orden de búsqueda.
>
>   Tres salidas, y **ninguna corre sin vos**: **(a)** llevar ese criterio a `CLAUDE.md`,
>   **(b)** dejar el absoluto y aceptar que las seis excepciones se relean como bugs cada vez
>   —el costo es real: ya pasó que una revisión marcara una de ellas—, o **(c)** una redacción
>   tuya.

**Lo que se hizo:** el enunciado de la invariante 3 dejó de ser absoluto. Ahora dice que toda
lectura filtra `eliminado_el IS NULL` **salvo excepción deliberada**, y que lo que distingue
una excepción de un olvido es que **el porqué esté escrito en la propia consulta** — con la
instrucción operativa de buscar ese comentario antes de "arreglar" una lectura sin filtro:
si no está, es un bug; si está, restaurar el filtro rompe algo que alguien ya midió.

**Por qué ganó el criterio sobre el absoluto** (decisión del owner, 2026-08-25): el absoluto
**ya era falso** —seis lecturas deliberadas, todas anteriores a este frente— y un enunciado
falso no es neutro: manda al próximo agente a "arreglar" excepciones medidas, que es
exactamente lo que pasó una vez. El costo aceptado, dicho sin maquillar: ablanda una de las
seis reglas que frenan al agente, y alguien podría leer "le puse un comentario" como permiso.
Lo que lo acota es que el criterio exige el porqué **en el SQL**, que la revisión ve de un
vistazo.

⚙️ **Nada que testear: es texto de rulebook.** Lo que sí queda fijado en código es la última
excepción de la tabla —`obtenerUso` de descuentos y recargos—, con un test que afirma sobre
la cláusula exacta y no sobre la palabra `eliminado_el` suelta.

📌 **El detalle de las formas que toma sigue en
[`anti-patterns.md`](anti-patterns.md)**, con la tabla que **no** se presenta como inventario,
y en [`patterns/backend.md`](../patterns/backend.md), que es el paso 1 del orden de búsqueda.
---

## El bucle del nivel de la regla, cerrado: el tipo empuja el default y el uso muestra la papelera (2026-08-25)

**Las dos venían de la sección 3**, y las dos las dejó abierta el propio frente del nivel al
cerrarse el mismo día. Textos verbatim:

> - [ ] **El tipo de regla no empuja el nivel, y el default puede desmentir al tipo**
>   (frontend + producto; medido 2026-08-25 al cerrar el frente del nivel —
>   [`resueltos.md`](resueltos.md) § *"Una regla dice dónde se aplica"*) — el radio "Se aplica"
>   nace en **"A cada ítem"** para todos los tipos, incluidos `por_monto_venta` y
>   `recargo_por_monto_venta`, cuyos tramos se llaman *"por monto de la venta"*. Quien cree uno
>   y no toque el radio se lleva una regla que la pantalla nombra por el total y el motor mide
>   contra la línea. Nada falla: cobra otra cosa.
>   **No se fuerza el nivel desde el tipo a propósito** —*"llevando $50.000 de este vino, 10% en
>   el vino"* es un uso legítimo del mismo tipo a nivel línea, medido contra la línea— así que
>   la pregunta es del owner y es chica: ¿el tipo **empuja el default** del radio (sin
>   bloquearlo), o el radio se queda neutro y la responsabilidad es de quien crea la regla?
>   ✅ **DECIDIDO (owner, 2026-08-25): el tipo EMPUJA el default del radio, sin bloquearlo.** Elegir
>   un tipo "por monto de venta" deja el radio en *Al total de la venta*; quien quiera el caso del
>   vino —*"llevando $50.000 de este vino, 10% en el vino"*— lo mueve a mano y se respeta.
>   📌 **La sub-pregunta que quedaba —qué pasa al cambiar de tipo con el radio ya tocado— se resuelve
>   por derivación, no se vuelve a preguntar:** "empujar sin bloquear" describe un **default**, y un
>   default solo aplica mientras el usuario no eligió. Entonces el tipo mueve el radio **solo
>   mientras nadie lo haya tocado**; en cuanto se toca a mano, cambiar de tipo ya no lo pisa. Es lo
>   contrario de lo que hace hoy `onTipoChange` con los otros campos, así que quien lo construya
>   necesita un testigo de "tocado" y no puede colgarse de ese mismo camino.
>   ⚠️ Si al construirlo ese testigo resulta más caro de lo que vale, **eso sí vuelve al owner**: la
>   alternativa (pisar siempre) es decisión de producto, no una simplificación.
>   El seeder ya tuvo que corregir sus dos filas a mano, que es la señal de que el default engaña más
>   seguido de lo que parece.

> - [ ] **El 400 que frena el cambio de nivel nombra un conteo que la pantalla no puede
>   desglosar** (backend + frontend; medido 2026-08-25, mismo cierre) — el guard cuenta las
>   filas puente **incluidos los ítems en la papelera** (tiene que hacerlo: el soft delete no
>   las borra, ver `resueltos.md`), pero `GET /:id/uso` solo lista los vivos. Un admin que
>   intenta pasar una regla a nivel venta y cuya única asociación está en un ítem borrado lee
>   *"1 ítem todavía lo tiene"* y **no tiene forma desde la UI de saber cuál**: hoy la salida es
>   restaurar a ciegas, editar y volver a borrar. Es chico y tiene dos formas: que `/uso`
>   devuelva también los borrados marcados como tales (y el modal de pausa siga mostrando solo
>   los vivos), o que el 400 los nombre.
>   ✅ **DECIDIDO (owner, 2026-08-25): `GET /:id/uso` devuelve también los borrados, marcados.** El
>   modal de pausa **sigue mostrando solo los vivos** — ahí un ítem en la papelera es ruido.
>   ⚠️ **Con eso el endpoint queda con dos consumidores que piden cosas distintas, y eso hay que
>   dejarlo escrito o se desincroniza**: el modal (`usePausaRegla`) filtra los borrados y el 400 del
>   cambio de nivel los necesita. Un cambio futuro que "simplifique" devolviendo una sola lista rompe
>   uno de los dos en silencio.

### Qué se hizo — el empujón del default

Cada tipo declara su `nivelSugerido` en `reglas-form-config.ts`, y `onTipoChange` lo aplica
**solo mientras nadie tocó el radio**. Los dos tipos por escalones de monto sugieren `'venta'`;
los otros nueve, `'linea'`.

⛔ **La mitad importante es la que NO se hizo: no se fuerza.** *"Llevando $50.000 de este vino,
10% en el vino"* es un `por_monto_venta` a nivel línea, legítimo, y forzar el nivel desde el
tipo lo volvería inexpresable. Por eso hay un testigo (`nivelTocado`) y no un `watch`.

📌 **Ese testigo no podía colgarse de `onTipoChange`**, que es lo que uno haría por reflejo: esa
función **pisa siempre** los demás campos, y tiene razón —dependen del tipo, un `general` no
tiene métodos de pago que conservar—. El nivel no depende del tipo: las dos opciones valen para
cualquiera. Arranca en `true` al **editar**, porque una regla que ya existe tomó su decisión
cuando se creó.

### Qué se hizo — los ítems de la papelera

`GET /:id/uso` de descuentos y recargos dejó de filtrar `eliminado_el` y devuelve la marca por
fila (`eliminado`). El drawer los nombra al fallar el cambio de nivel: *"Lo tienen: Café, Torta
vieja (en la papelera)"*.

⚠️ **Es la excepción documentada al invariante de soft delete**, y está escrita en la propia
consulta. La razón es que el guard **cuenta** esas filas —tiene que contarlas: `remove` no toca
las tablas puente, y sin contarlas el ítem quedaba invendible al restaurarlo— así que un
endpoint que solo listara vivos dejaba al admin sin forma de saber cuál.

📌 **El endpoint quedó con dos consumidores que piden lo contrario, y eso se escribió en los
tres lugares donde se puede "simplificar" mal:** el modal de pausa los **descarta** (ahí un ítem
borrado infla el número sobre el que el admin decide) y el error del cambio de nivel los
**necesita**. Por eso la marca viaja por fila en vez de decidirse en el service. El `/uso` de
**impuestos** no cambió: no tienen nivel, nadie cuenta sus borrados.

⚠️ **El filtro del modal hubo que ponerlo en DOS lecturas, no en una**: el conteo que muestra y
el `if` de salida temprana. Con solo la primera, una regla cuya única asociación está en la
papelera dejaba de pausarse en silencio para abrir un modal que anuncia "0 ítems".

### Qué lo fija

- **Backend** (los dos service specs, gemelos): la marca pasa por fila, y un test sobre la
  consulta que afirma la **cláusula exacta** —`not.toContain('i.eliminado_el IS NULL')` más
  `toContain('(i.eliminado_el IS NOT NULL) AS eliminado')`—, porque `eliminado_el` a secas
  aparece también en el `SELECT` de la marca y un `toContain` suelto pasaría con las dos
  versiones.
  🧪 **Mutante:** restaurado el `AND i.eliminado_el IS NULL` del JOIN, **cae**.
- **De punta a punta** (`uso-reglas.e2e-spec.ts`): se borra el ítem de verdad y se vuelve a
  consultar. Descuentos y recargos lo siguen listando con `eliminado: true`; impuestos no. Y el
  400 del cambio de nivel sigue saliendo, ahora con el uso nombrando la fila.
  ⚠️ **Dos tests de ese archivo afirmaban la conducta vieja** —que el borrado dejaba de
  contarse— y se reescribieron con la nueva; el porqué del cambio quedó en el docblock, no
  borrado.
- **Frontend** (`descuentos.nuxt.spec.ts`): el ítem en la papelera no abre modal, y el modal
  cuenta solo los vivos.
  🧪 **Mutante:** quitado el filtro, caen 7 tests (los 2 propios y 5 que se contaminan con el
  modal que no debía abrirse).
- **Frontend** (`descuentos.nuxt.spec.ts`, el empujón): elegir el tipo mueve el radio; con el
  radio ya tocado, **no** lo mueve; y **editar** una regla existente y cambiarle el tipo tampoco
  se lo da vuelta.
  🧪 **Cuatro tests del empujón; tres tienen un mutante que los mata solo a ellos:**

  | Mutante | Qué cae |
  |---|---|
  | `onNivelChange` no registra el toque | *ya eligió el nivel a mano* — solo él |
  | `abrirEditar` no prende el testigo | *editar … NO le da vuelta el nivel* — solo él |
  | `resetDrawer` no apaga el testigo | *arrancar una regla nueva después de editar* — solo él |
  | quitar el empujón entero | **DOS**: *mueve el radio* y el de `resetDrawer` |

  📌 **El cuarto test no es estrictamente necesario y se dice en vez de disimularlo:** todo
  mutante que mata a *"mueve el radio"* mata también al de `resetDrawer`, que hace
  `crear → elegir tipo` por dentro. Se conserva porque es la expresión **más corta** de la
  conducta —el ancla que se lee primero—; borrarlo no bajaría la cobertura, bajaría la
  legibilidad.

  ⛔ **Esta tabla estuvo mal DOS veces, las dos por la misma causa, y las dos las cazó la
  revisión independiente.** Primero decía que "empujar siempre" mataba solo un test (mata dos).
  Corregido eso, se agregó el test de `resetDrawer` **y no se volvió a medir**, así que la
  tabla nueva volvió a sobreafirmar con la columna *"y solo a él"*. La lección no es sobre esta
  tabla: **una tabla de mutantes envejece cuando se agrega un test**, y agregar una fila no es
  volver a medirla.
  ⚠️ **El de editar lo pidió la revisión independiente, y es el que más caro sale**: es el único
  que toca una regla YA EN USO, donde darle vuelta el nivel cambia en silencio contra qué se
  mide, o sea cuánta plata cobra. El de `resetDrawer` también salió de una revisión, y es el más
  silencioso: sin esa línea, el camino *editar → arrancar una nueva* deja el testigo prendido y
  el bug original vuelve **sin que nada falle**.
- **Frontend** (`descuentos.nuxt.spec.ts`, el uso): que la pantalla **consulte** el uso en la
  transición que produce el 400, y que **no** lo consulte fuera de ella.
  ⚠️ **Alcance real, para no sobrevenderlo:** estos dos NO afirman el texto del toast —
  `mountSuspended` monta la página sin `UApp`, así que los toasts no tienen dónde renderizar—.
  El texto lo fija `useNivelRegla.nuxt.spec.ts`. Entre los dos archivos queda el camino entero:
  acá el CUÁNDO, allá el QUÉ.
- **Frontend** (`recargos.nuxt.spec.ts`): el bloque espejado — los cuatro del empujón y los dos
  del *cuándo* se consulta el uso. **Existen porque las dos
  pantallas son copias y el empujón está duplicado en cada una** (`nivelTocado` vive por página,
  no en un composable): con tests en una sola, `recargos` podía quedarse sin el empujón y la
  suite seguía en verde.
  ⚠️ **La primera versión espejó solo TRES**, y le faltaba justo el de `resetDrawer` —la línea
  más silenciosa— mientras el docblock de ese archivo afirmaba cubrir "el testigo mal". Lo midió
  la revisión independiente: el mutante sobre `recargos.vue` dejaba la suite entera en verde.
  Y después este mismo párrafo quedó diciendo "los tres" con cuatro ya escritos, que es la
  tercera vez que un conteo envejece por agregar un test sin remedir el texto.

  📌 **La regla no es "descuentos vs recargos" sino DÓNDE VIVE EL CÓDIGO:** lo duplicado se
  prueba dos veces, lo compartido una. Por eso `descripcionDeUso` —que vive por página, porque
  el *cuándo* es propio de cada pantalla— tiene sus dos tests en las dos, mientras que el filtro
  del modal (`usePausaRegla`) y el armado del mensaje (`useNivelRegla`) se prueban una sola vez.
  ⚠️ Esa frase llegó a decir que lo único compartido era el filtro del modal —también lo es el
  mensaje— y a omitir que `descripcionDeUso` estaba duplicado **y sin test en recargos**:
  borrarlo de `recargos.vue` dejaba la suite entera en verde. Lo midió la revisión
  independiente, y es la MISMA deriva entre gemelos que este bloque decía cubrir.
- **Frontend** (`useNivelRegla.nuxt.spec.ts`, nuevo): la cadena *"Lo tienen: Café, Torta vieja
  (en la papelera)"*, que es el **pago visible** de la excepción al soft delete — sin ella, el
  cambio del backend no lo nota nadie. Cubre: los ítems vivos · el sufijo de papelera · el
  recurso y el id que pega · el caso sin ítems · el tope de nombres y su borde exacto · **que el
  tope recorte vivos y nunca borrados** · y **las dos defensas que el docblock llama
  load-bearing**, que un GET fallido no tire y que uno colgado corte por tiempo.

  ⚠️ **La asimetría del tope es el caso que más fácil se pierde de vista**: los borrados vienen
  últimos por el `ORDER BY`, así que un tope que recortara la lista entera dejaría *"y 1 más"*
  justo sobre el único ítem que el admin no puede ver — el tope tapando lo que la feature vino a
  mostrar. Lo encontró la revisión independiente después de que el tope se agregara.

  📌 Las dos defensas cubren fallas distintas y por eso van las dos: `itemsQueLoTienen` corre
  dentro del `catch` del guardado, así que **tirar** taparía el error que el usuario vino a leer,
  y **colgarse** lo dejaría sin ningún error con el botón trabado. El `catch` no cubre colgarse.
  ⚠️ **Existe porque la revisión independiente encontró que esa función estaba duplicada en las
  dos `.vue` y sin ningún test.** Se movió a `useNivelRegla` —regla de `CLAUDE.md` sobre
  utilidades de presentación— y en las pantallas quedó solo el **cuándo**, que sí es propio de
  cada una.
- **Frontend** (`reglas-form-config.spec.ts`): solo los dos tipos por monto de venta sugieren
  `'venta'`, y **todos** declaran su nivel sugerido — la segunda aserción caza al tipo nuevo que
  se agregue sin la clave, que el `Record<string, TipoConfig>` no ve.

### Lo que costó, y no era el código

**El test del empujón mató al worker de vitest.** Manejar el popup del `USelectMenu` por DOM en
jsdom da `Maximum call stack size exceeded` y el proceso se cae — no es el código de la
pantalla, es el render del listbox. Se resolvió emitiendo `update:modelValue` en el componente,
que es **el mismo contrato que usa el template**: lo único que queda sin cubrir es el render del
popup, que no es de esta feature.

**Y después falló solo en la suite completa, pasando aislado.** Esa es la firma de la
contaminación, no del código: `UModal` teletransporta al `body` y **desmontar el wrapper no lo
saca**, así que el helper `dialogo()` —que devuelve el primero— entregaba el drawer de *"Editar
descuento"* de otro describe. El bloque nuevo limpia los diálogos viejos en su `beforeEach`.

---

## Los dos tipos por método de pago leen sus escalones (2026-08-25)

**Venía de la sección 3.** Texto de la entrada, verbatim:

> - [ ] **Los dos tipos "por método de pago" ignoran los tramos y cobran el valor único** (backend,
>   parte 2 de *"la plomería de tramos en `recargos`"*; la **parte 1 salió el 2026-08-22** →
>   [`resueltos.md`](resueltos.md)) — el tipo por escalones ya existe
>   (`recargo_por_monto_venta`) y salió **sin tocar el motor**, como estaba medido. Lo que
>   queda son los dos tipos que el motor **no** lleva a la rama de tramos:
>
>   | Tipo | Clase | Con tramos hoy |
>   |---|---|---|
>   | `recargo_metodo_pago` | recargo | **ignora los tramos y cobra el `valor`** |
>   | `metodo_pago` | descuento | **ídem** — es el gemelo, los dos están en `METODO_PAGO_CODIGOS` |
>
>   ⚠️ **Corregido el 2026-08-23 contra el código, y el dato viejo llegó a estar en tres
>   archivos:** esto decía *"cobran cero en silencio"* y que el `valor` era null. **Las dos son
>   falsas.** Los dos tipos están en `TIPOS_CON_VALOR_UNICO`, así que el backend les **exige**
>   `valor` y el motor cobra ese; para llegar a cero habría que sacarlos también de esa lista. Lo
>   que pasa con escalones es que se configuran, se muestran y **el cálculo no los mira**.
>   📌 Y son **dos**, no uno: hasta esa fecha la entrada nombraba solo el recargo. Habilitar
>   tramos en uno y no en el otro deja la mitad del bug.
>   📌 **`mora` salió de esta entrada:** no era un caso de tramos sino de **tiempo**. Vive en
>   *"Cinco tipos de regla no hacen lo que la pantalla promete"*, más abajo.
>   Lo que necesitan los dos: que su rama siga hasta los tramos en vez de retornar.
>   ⛔ **Toca el motor de precios: se confirma con el owner antes de escribir.**
>   ➕ **Movida desde la § 3 el 2026-08-24.** Estaba en "ya decidido, falta construir" y su
>   propio texto pide lo contrario: *"se confirma con el owner antes de escribir"*.
>   ✅ **DECIDIDO (owner, 2026-08-25): los dos pasan a leer los tramos**, como el de monto de venta.
>   La pantalla no promete de más — el motor promete de menos.
>   ⛔ **Y por eso este frente VA SOLO, con el sistema quieto**: toca el motor de precios, primer
>   punto de "Detenerse y preguntar" de `CLAUDE.md`. Nada de arrastre, nada colgado al final de otra
>   tarea. La razón está medida: el arreglo anterior del redondeo se hizo por partes y hubo que
>   revertirlo.
>   📌 **Los DOS o ninguno**: habilitar tramos en el recargo y no en su gemelo de descuento deja la
>   mitad del bug, con el agravante de que la mitad arreglada hace que nadie vuelva a mirar.

### Qué se hizo

**El motor:** `evaluarRegla` cortaba con un `return` en la rama de
`METODO_PAGO_CODIGOS` y nunca llegaba a la de tramos, 15 líneas más abajo. Ahora esa rama
**filtra y sigue**: el método de pago es la *condición* de la regla —decide **si** aplica—,
no su forma de importe. El importe lo resuelven las mismas dos ramas que para el resto de
los tipos, tramos primero. Es un `return` menos, y es todo el cambio del motor.

**La escritura**, que no estaba en la entrada y es la mitad del frente: los dos códigos
salieron de `TIPOS_CON_VALOR_UNICO` —donde el valor era obligatorio *siempre*— y pasaron a
una lista nueva, `TIPOS_CON_TRAMOS_OPCIONALES`. Ahí rige `validarFormaDeImporte`:
**exactamente una** de las dos formas, las dos juntas es 400 y ninguna también.

⛔ **Sin ese guardia el arreglo se daba vuelta.** El motor ramifica por `tramos.length > 0`
antes de mirar el valor plano, así que una fila con las dos llenas cobraría por escalones y
dejaría el valor único **muerto sin aviso** — el mismo bug que este frente cerró, del otro
lado. Lo decidió el owner el 2026-08-25: *o valor único, o escalones*.

**El frontend**, que la entrada daba por hecho y no lo estaba. La entrada decía que los
escalones *"se configuran, se muestran"*: lo segundo sí (la grilla muestra "N tramos"), **lo
primero no**. Los dos tipos tenían `campoTramos: false` en `reglas-form-config.ts`, así que
los escalones solo eran alcanzables **por API**. Arreglar únicamente el motor habría dejado
una función que ningún local podía usar. Ahora los dos tipos llevan `campoValor` y
`campoTramos` en `true`, y eso **no dibuja los dos campos**: significa que el tipo admite las
dos formas y el drawer hace elegir con un radio (`eligeForma`).

📌 **La vuelta del interruptor tuvo su propio hueco.** `tramos: []` era 400 para cualquier
tipo (*"Este tipo requiere al menos un tramo"*), así que una regla de tarjeta no podía volver
de escalones a valor único. Se exceptúa a los dos tipos que eligen forma; no quedan sin red,
porque `validarEstadoResultante` corre después con los tramos finales vacíos y exige que la
fila diga cuánto cobra de la otra forma. El frontend además **apaga explícitamente** la forma
abandonada (`valorMonto: null` al pasar a escalones, `tramos: []` al volver), porque omitir
la key deja el dato viejo y el 400 le llega a un usuario que no sabe cuál es la otra forma.

### Qué lo fija

- **Motor** (`calculo-precios.engine.spec.ts`, 6 casos nuevos): cobra el escalón alcanzado,
  el de arriba cuando la línea lo alcanza, a nivel venta contra el subtotal, el filtro de
  método sigue mandando, sin escalón alcanzado no cobra, y —si por SQL directo quedaran las
  dos formas— gana el escalón.
  🧪 **Mutante:** restaurado el `return` viejo en la rama de método de pago, **4 de los 6
  caen**. Los otros dos son los guardias que esperan cero y dan cero en las dos versiones.
- **Escritura** (`monto-regla.util.spec.ts` + los dos service specs, gemelos): las dos formas
  juntas, ninguna, el umbral en la columna equivocada (`minimoCantidad` en una regla de
  tarjeta), el `PATCH` que agrega escalones sin apagar el valor, y las dos caras del vaciado
  con `tramos: []`.
- **De punta a punta** (`calculo-precios.e2e-spec.ts`): el recargo de tarjeta por escalones
  se crea, vuelve del `GET` con sus tramos, cobra 3% con $1.000 y 1,5% con $3.000, no cobra
  con efectivo ni sin método, la API rechaza las dos formas juntas y el `PATCH` de vuelta a
  valor único cambia lo que la venta cobra.
  ⚠️ **Por qué hacía falta el e2e y no alcanzaba el unit del motor:** los tramos de estos dos
  tipos **ya se guardaban y se leían bien**; lo que fallaba era el último tramo del recorrido.
  Un test que le arma el `ReglaResuelta` al motor a mano no prueba que el dato sobreviva el
  viaje, y ese viaje es el que ya rompió antes en otros campos.
- **Frontend** (`reglas-form-config.spec.ts`): los dos tipos admiten las dos formas, y
  **ningún otro tipo las admite** — esa segunda aserción es la que caza a quien prenda las dos
  banderas en un tipo donde el drawer no sabría qué preguntar.

### Lo que la entrada afirmaba y no era

*"Se configuran, se muestran y el cálculo no los mira"*: la primera mitad era falsa —la
pantalla no ofrecía escalones para estos tipos—, y eso **cambió el tamaño del frente**, no su
dirección. Es el mismo patrón que dominó el 2026-08-24: la afirmación no se cayó por releerla
sino por volver a medirla.

---

## El descarte de un desfase deja de silenciarlo: archiva lo que el usuario vio (2026-08-25)

**Venía de la sección 4**, adonde había subido desde la 2 al medirla. Texto de la entrada,
verbatim:

> - [ ] **`descartarDesfases` calcula el costo propuesto con lecturas sin lock, y lo archiva
>   como "omitido" cuando ya puede no ser el propuesto** (backend,
>   `items.service.ts` → `ItemsService.descartarDesfases`, visto el 2026-08-19 mientras se
>   cerraba el orden de locks de esa misma bandeja). El método lee las cabeceras
>   (`cabecerasCompuestas`), los ingredientes (`ingredientesPorReceta`) y los componentes
>   (`componentesPorCombo`) **sin ningún `FOR UPDATE`**, calcula el propuesto
>   (`costoPropuesto` / `costoPropuestoCombo`) y recién entonces escribe
>   `costo_propuesto_omitido`. Entre la lectura y el `UPDATE`, un `aplicarDesfases`
>   concurrente —o cualquier ajuste de costo de un insumo— puede mover el número, y el
>   descarte archiva un propuesto que ya no lo es.
>   ℹ️ **Es del molde "no toma lock" de la [sección 5](#5-carreras-de-concurrencia)**, y no
>   es lo mismo que el ciclo de orden de locks que sí se arregló: aquel era un deadlock
>   (`40P01`); este no abraza a nadie, escribe tranquilo un valor viejo.
>   ✅ **Decisión del owner (2026-08-19): se anota, no se arregla en esa pasada.** Poner un
>   lock acá es meterse otra vez con el orden de bloqueo de la bandeja, que es justo el
>   frente que la tanda 🔴 mandaba aislar.
>   ⛔ **MEDIDO el 2026-08-24 contra la API viva, y la deducción de esta entrada era FALSA en
>   la dirección que importa.** Decía que el síntoma probable era *"el descarte no pega"* —
>   molesto y no peligroso—. **Es al revés: el descarte SILENCIA un desfase que el usuario
>   nunca vio.**
>
>   La medición, paso por paso sobre `Hamburguesa Especial`:
>
>   | Paso | Resultado |
>   |---|---|
>   | El usuario ve en la bandeja | propuesto **1120** |
>   | Cambia el costo de un ingrediente (la concurrencia) | el propuesto real pasa a **1019,98** |
>   | El usuario hace clic en Descartar, sobre lo que vio | `{"descartados":1}` |
>   | Lo que quedó en `costo_propuesto_omitido` | **1019,98** — un valor que nunca estuvo en pantalla |
>   | La bandeja después | **0 filas** |
>
>   **La causa es que `descartarDesfases` RECALCULA el propuesto** desde los ingredientes que
>   leyó sin lock (`this.costoPropuesto(convertir!, ingsPorReceta.get(itemId)!)`) y archiva
>   **ese**, no el que el usuario tenía delante. Con el predicado de la bandeja —que oculta si
>   el propuesto coincide con el omitido— el resultado es que el desfase nuevo queda oculto.
>
>   ✅ **La otra mitad también se midió, y sí se comporta como la entrada deducía:** con un
>   omitido que NO coincide con el propuesto actual, la fila **reaparece** en la bandeja. Las
>   dos conductas conviven; cuál toca depende de si el cambio concurrente cae antes o después
>   de la lectura del descarte, y la peligrosa es la de "antes".
>
>   ➡️ **Por su propio criterio, esta entrada SUBE de sección y de prioridad**: decía *"si
>   aparece un caso donde el desfase se silencia, sube"*. Apareció.
>
>   💡 **Y el arreglo puede no necesitar el lock**, que es lo que la mandaba a esperar el frente
>   de orden de bloqueo: si el cliente manda **el propuesto que vio** y el servidor archiva ese
>   —o rechaza cuando no coincide con el recalculado, como un control optimista de
>   concurrencia—, el problema desaparece sin tocar el orden de locks de la bandeja. Es una
>   opción a evaluar al tomarla, no una decisión tomada.
>
>   ❓ **LA PREGUNTA, que es lo que la trae a esta sección (2026-08-24):** el 2026-08-19 decidiste
>   *"se anota, no se arregla en esta pasada"*, y era razonable **con la premisa de entonces** —que
>   el síntoma fuera "el descarte no pega", molesto y no peligroso—. Esa premisa resultó falsa: lo
>   medido es que **silencia un desfase que nadie vio**. Y el motivo del diferimiento —que arreglarlo
>   obligaba a meterse con el orden de bloqueo de la bandeja— **puede no aplicar**: si el cliente
>   manda el propuesto que vio y el servidor archiva ese (o rechaza si no coincide), no hace falta
>   ningún lock nuevo.
>   ✅ **DECIDIDO (owner, 2026-08-25): se arregla AHORA, por la vía sin lock.** El cliente manda el
>   propuesto que vio y el servidor archiva **ese**, o rechaza si no coincide con el recalculado —
>   control optimista de concurrencia. Reabre la decisión del 2026-08-19, y la reabre la evidencia:
>   aquella se tomó con la premisa de que el síntoma era "el descarte no pega", y lo medido es que
>   **silencia un desfase que nadie vio**.
>   ⚠️ **Al construirlo:** lo que habilita tomarlo ya es justamente que **no lleva ningún `FOR
>   UPDATE` nuevo**. Si al escribirlo aparece la tentación de agregar uno, eso deja de ser este
>   frente y pasa a ser el de la § 5 — frenar y consultar, no resolverlo de paso. Y el contrato del
>   endpoint cambia (el descarte pasa a recibir el propuesto visto), así que la pantalla de la
>   bandeja entra en el mismo commit.

### Qué se hizo

El descarte **recibe el costo propuesto que el usuario tenía en pantalla** y archiva ése, en
vez de recalcularlo.

| Pieza | Qué cambió |
|---|---|
| `DescartarDesfasesDto` | de `itemIds: string[]` a `items: [{ itemId, costoPropuestoVisto }]`, con `@EsCosto()` (escala 4, es un costo unitario = tasa, mismo criterio que `precioBase` en el DTO de aplicar) |
| `DesfasesController` | suma `EscalaMonedaPipe`, igual que `aplicar`: desde que el body lleva plata, el borde de escala tiene que verla o el `@EsCosto()` es metadata que nadie lee |
| `ItemsService.descartarDesfases` | compara con `eq4` —el mismo que usa el predicado de la bandeja, para que "coincide" signifique lo mismo de los dos lados— y devuelve `{ descartados, cambiados }` |
| `DesfasesPanel.vue` | emite pares en vez de ids: manda el `costoPropuesto` **tal como se está mostrando** |
| `desfases.vue` y `useSimuladorDesfases.ts` | los dos consumidores del panel; el drawer del simulador **ya no se cierra** cuando algo cambió, y la bandeja se recarga |

### La decisión, y por qué no fue un lock

**El motivo por el que se había diferido no aplicaba.** La entrada mandaba esperar el frente de
orden de bloqueo porque arreglarlo "obligaba a meterse con los locks". Medido al tomarlo: **un
`FOR UPDATE` nunca hubiera arreglado esto.** El descarte recalcula desde cero, así que la
ventana no es la carrera de milisegundos entre dos transacciones — es todo el tiempo que la
pantalla del usuario está abierta. No hace falta ni un segundo usuario: alcanza con cambiar el
costo de un ingrediente en otra pestaña. Un lock cubre milisegundos; lo que cierra la ventana
es que el dato viaje desde el cliente.

**Cuando el propuesto cambió, esa fila no se descarta y se informa** (decisión del owner,
2026-08-25), en vez de fallar el lote entero: una fila que cambió no bloquea las otras nueve.
Vuelve a la bandeja con su número nuevo y el usuario la decide otra vez, viéndolo. El status es
`201`, no un `4xx`: no es un error del cliente, es información.

### Qué lo fija

| Mutante (revierte al código anterior) | Test que cae |
|---|---|
| El service vuelve a archivar el recalculado, siempre | *si el propuesto cambió, esa fila NO se descarta y vuelve en `cambiados`* + *una fila que cambió no bloquea a las demás del lote* |
| `DesfasesPanel.vue` vuelve a emitir solo los ids | *emite el `costoPropuesto` de cada fila seleccionada, no solo su id* |

Más un e2e de punta a punta en `simulador-costos.e2e-spec.ts` que reproduce la secuencia
medida —bandeja, cambio de costo, descarte sobre lo visto— y afirma lo que importa: **la fila
sigue en la bandeja**, con el número nuevo. Antes del arreglo ahí había cero filas.

### Una trampa que dejó puesta el cambio

`orden-locks-desfases.e2e-spec.ts` mide deadlocks haciendo correr dos descartes en paralelo. Si
el `costoPropuestoVisto` que manda no coincide, **el service no escribe nada y no toma un solo
lock**: el spec quedaría midiendo una compuerta vacía. Lo caza su propia aserción
(`esperandoLockEnLaCompuerta` exige 2 y vería 0), pero el spec ahora lee los propuestos del
`GET /desfases` de su setup y la razón quedó escrita al lado.

---

## Una regla dice dónde se aplica: `nivel` línea/venta (2026-08-25)

**Venía de la sección 3.** Texto de la entrada, verbatim:

> - [ ] **El modal de pausa cuenta asociaciones por ítem, y una regla usada solo a nivel venta
>   no tiene ninguna** (frontend + backend, medido 2026-08-03 en la revisión de cierre) —
>   `GET /:id/uso` cuenta filas de `item_descuentos`, pero las reglas que se aplican por
>   `descuentosVentaIds` / `recargosVentaIds` **no tienen tabla puente** (no hay columna `nivel`
>   en `descuentos`/`recargos`), así que devuelven `items: []` y la pantalla las pausa directo,
>   sin confirmación. El texto "Deja de aplicarse en N ítems" también queda incompleto ahí.
>   Hoy es teórico —ninguna pantalla manda esos campos, medido el 2026-08-03—, pero deja de
>   serlo en cuanto exista un productor.
>   Decisión del owner pendiente: si el modelo necesita distinguir el **nivel** de una regla
>   (línea vs venta), que hoy no distingue.
>   ✅ **DECIDIDO (owner, 2026-08-15): el modelo distingue el nivel de la regla** — si aplica por
>   línea o por venta— y el modal dice lo que corresponde en cada caso, en vez de "afecta 0 ítems".
>   ⚠️ **Es un campo nuevo en `descuentos`/`recargos`, así que arrastra más de lo que parece:** el
>   motor tiene que respetarlo (una regla de venta no debería poder asociarse a un ítem, ni al
>   revés), el seeder tiene que declararlo en cada fila, y las pantallas de administración tienen
>   que ofrecerlo. **Hoy es teórico** —ninguna pantalla manda reglas a nivel venta, medido— así que
>   se puede planificar sin apuro; lo que no conviene es construir el productor antes que el campo.
>

### Qué se hizo

Columna **`nivel`** (`nivel_regla`: `'linea' | 'venta'`, `NOT NULL DEFAULT 'linea'`) en
`descuentos` y `recargos`, más las dos puertas que la hacen cumplir y las pantallas que la
ofrecen.

| Pieza | Qué cambió |
|---|---|
| Entities + enum | `NivelRegla` en `common/enums/reglas.enums.ts`; la columna en las dos entities |
| DTOs | `nivel?` opcional (`@IsEnum`); el service resuelve el default |
| `ItemsService.validarReglas` | rechaza asociar a un ítem una regla de nivel venta. **Sigue siendo una sola query**: `nivel` viaja en el `SELECT` que ya validaba pertenencia |
| `CalculoPreciosService.resolverReglas` | exige el nivel de la puerta por la que entraron los ids: línea para `descuentoIds`, venta para `descuentosVentaIds` |
| `update` de las dos reglas | 400 al pasar a nivel venta con ítems asociados, con el conteo en el mensaje |
| `obtenerUso` | devuelve `{ nivel, items }` |
| Seeder | `nivel` declarado en **las 12 filas**, no solo en las que no son el default. Dos pasan a `venta` —"Descuento compra grande" y "Recargo por pedido chico", cuyos tramos se miden contra el total— y se suma **"Promo del total $5.000"**, gemela de nivel venta de "Promo fija $5.000" |
| Frontend | `useNivelRegla()`, radio "Se aplica" en las dos pantallas, badge *Por venta* en la tabla, y `usePausaRegla` + `CrudPausarModal` con el copy que corresponde |

⚠️ **Los dos que "pasan a `venta`" solo pasan en base virgen.** El seeder inserta si el id no
existe, así que sobre una base ya sembrada —el demo de Railway, o un local sin `reset-db.sh`—
esas dos filas se quedan en `'linea'` por el default de la columna. La fila nueva (`…440360`)
sí entra en las dos, y por eso el e2e pasa igual en los dos mundos y nada señala la
divergencia. Se corrige con el volcado de `railway-sync-db` **después** de un reset local.

### Tres decisiones, con su porqué

**El default no es comodidad: es lo que salva el deploy.** Una columna `NOT NULL` sin default
sobre las filas viejas del demo es el `23502` que dejó Railway en CRASHED el **2026-08-09**
(`e163dbb7`). El 2026-08-23 el mismo demo tumbó otro deploy con un `23514` de `@Check` —otro
código, misma causa—, y eso **no está registrado en este repo**: vive en el troubleshooting de
la skill `railway-sync-db`, que es donde hay que ir a buscarlo. Y `'linea'` es el valor **verdadero** para esas filas: hasta hoy
la única forma de usar una regla era asociarla a un ítem.

**La validación NO entró al motor**, y por eso este frente no abrió el frente del motor. El
motor recibe las dos listas ya separadas y calcula plata; el nivel es una regla de catálogo
sobre dónde se puede usar cada regla — mismo orden que "el ítem está pausado", que por la
misma razón vive en el service. `ReglaResuelta` quedó intacta: el mapa del service usa
`ReglaResuelta & { nivel }`.

**Una regla de venta siempre pregunta al pausarla**, aunque su conteo sea 0. No es excepción
a "solo pregunta cuando hay algo que perder de vista" sino su aplicación: sin tabla puente,
ese 0 es estructural y no significa "nadie la usa".

### Lo que el cierre encontró y la entrada no decía

**Hay una tercera puerta.** La entrada nombraba dos —asociar al ítem y `descuentosVentaIds`—
pero una línea puede mandar sus propios `descuentoIds` y **pisar** los del ítem
(`resolverLinea`), camino que nunca pasa por el catálogo. Por eso la validación vive en
`resolverReglas` y no solo en `ItemsService`.

**Cuatro llamadas del e2e mandaban una regla de línea por `descuentosVentaIds`** (una en
`calculo-precios.e2e-spec.ts`, tres en `ventas.e2e-spec.ts`), todas con "Promo fija $5.000".
No era un descuido de los tests: era exactamente el agujero que esta columna cierra. Se
apuntaron a la gemela sembrada de nivel venta.

### Qué lo fija

Mutantes que **revierten al código anterior**, no que rompen:

| Mutante | Test que cae |
|---|---|
| `create` sin `nivel` explícito | *sin `nivel` en el DTO guarda `linea`* + *`nivel: venta` se persiste* |
| `obtenerUso` vuelve a devolver solo `items` | *obtenerUso devuelve el nivel* |
| Sin la llamada a `validarCambioDeNivel` | *pasar a nivel venta con ítems asociados es 400* |
| El guard consulta siempre (sin los early returns) | *un PATCH que no toca el nivel no consulta los ítems* |
| `usePausaRegla` vuelve a `if (uso.items.length === 0)` | *una regla de nivel venta pregunta aunque no tenga ningún ítem* |
| Sin el badge en `descuentos.vue` | *la tabla marca la regla de venta, y no marca la de línea* |
| El guard vuelve a reusar `obtenerUso` (que filtra el borrado) | *el guard cuenta también los ítems en la papelera* — afirma sobre el SQL: `not.toContain('eliminado_el')` |
| `configuracion/items.vue` vuelve a listar sin mirar el nivel | *las reglas de nivel venta no figuran en ningún selector* |

Más 8 casos e2e en `uso-reglas.e2e-spec.ts` que recorren las tres puertas en los dos sentidos,
con **ancla positiva**: la regla de venta SÍ se aplica por `descuentosVentaIds` y baja el
total. Sin ella, los cinco 400 también pasarían con una puerta tapiada de los dos lados. El
octavo es el de la papelera, y va **después** del test que borra el ítem porque necesita justo
el estado que los demás evitan.

### Lo que sigue abierto, a propósito

**El productor no existe.** Ninguna pantalla manda todavía `descuentosVentaIds` /
`recargosVentaIds` — están declarados en `useCalculoPrecios.ts` y consumidos por el backend,
nada más. El campo se construyó **antes** que el productor porque al revés el productor habría
nacido pudiendo mandar cualquier regla, que es el bug que esto cierra.

---

## La limpieza del e2e ya no se lleva puesto el cierre de la app (2026-08-25)

**Venía de la sección 1.** En **18 archivos** de e2e, el `app.close()` corría *después* de la
limpieza y fuera de un `finally`: si un paso de limpieza tiraba, la app de Nest **no se
cerraba**, y `AppModule` registra un `@Cron` (`expirar-ordenes`, cada 10 min) que sobrevive
al teardown de Jest y le sigue escribiendo a la base desde un módulo desmontado **mientras
corren otras suites**.

### Qué se hizo, por forma y no por archivo

| Forma | Cuántos | Tratamiento |
|---|---|---|
| Un solo paso, y ese paso **ya afirma** adentro (`cerrarCaja`) | 7 | `try { … } finally { await app.close() }`. Nada más: la aserción ya existía, lo único roto era que su fallo se llevaba el cierre |
| Un solo paso **sin afirmar** | 3 | Igual, más el status afirmado **después** del cierre |
| Varios pasos | 6 | Acumulador `limpiar()` + `finally` + `expect(fallos).toEqual([])` al final, molde de `caja-testigo.e2e-spec.ts` |
| Bloques largos de `caja` y `papelera` | 8 bloques | Envueltos en `try/finally` sin tocar la semántica de sus aserciones |

Total: **33 bloques `afterAll`** quedan hoy con el `close` en un `finally`. Suite completa en
verde, 610 pasados.

### Tres cosas que valen más que el cambio

📌 **El acumulador NO se puso en los 18.** Solo 6 tienen varios pasos; en los demás un
`try/finally` alcanza y el acumulador habría sido arquitectura de más para un problema chico.
Y **no se extrajo a un helper compartido**: los 50 specs de e2e no importan nada entre sí
—cada uno define su propio `cerrarCaja`— y `caja-testigo` ya tenía el suyo local. Meter el
primer import cruzado de la suite por 6 copias no valía el cambio de forma.

⚠️ **`404` es un status legítimo en varias de estas limpiezas, y afirmarlo mal habría creado
rojos falsos.** Medido: `cajones.e2e-spec.ts` mete un id en `creados` (`:113`) y lo borra
dentro del mismo test (`:131`), y `uso-reglas` hace lo mismo con su ítem (`:294`). El borrado
de la limpieza contesta `404` —`NotFoundException`, verificado en `cajones.service.ts:107`—
que significa *"un test ya lo borró"*, no un problema. La aserción acepta `[200, 404]`.

⛔ **El tamaño publicado estaba mal, y por la misma causa tres veces en el día.** La entrada
decía **15 specs**: eran **18 archivos**. La medición original solo miraba el **primer**
`afterAll` de cada archivo, así que `caja.e2e-spec.ts` —que tiene **7** bloques, y es el
archivo que la propia entrada citaba— aparecía como si tuviera uno, y `ventas` y `papelera`
no aparecían. Un `awk` acotado por un terminador frágil **parece exhaustivo y no lo es**.

### Lo que quedó protegido de arrastre

Cuatro bloques de `caja` restauran `arqueo_ciego = false` del tenant y uno de
`monto-tolerancia` restaura las preferencias financieras. Son estado **compartido por todas
las suites**: si no vuelven a su valor, las que corren después calculan con la configuración
de ese spec y fallan lejos de la causa. Ahora el cierre corre igual y el fallo queda dicho.

⚠️ La trampa que esto NO repitió, y que ya había costado el veredicto de un mutante entero:
si el `expect` corre **antes** del `close`, jest imprime el resultado y **no termina nunca**
(medido: 7 minutos, 0% CPU). `caja.e2e-spec.ts` tenía exactamente eso en uno de sus bloques.

### El texto con el que estaba anotada

> - [ ] **15 specs del e2e cierran la app fuera de un `finally`, y una limpieza que falla deja
>   un cron vivo pegándole a la base** (backend/tests, medido el 2026-08-24) — es mecánico: hay
>   molde funcionando y el daño está medido, no supuesto.
>
>   **Qué pasa hoy.** Si la limpieza del `afterAll` tira antes del `app.close()`, la app **no
>   se cierra**, y `AppModule` registra un `@Cron` (`expirar-ordenes`, cada 10 min) que
>   **sobrevive al teardown de Jest** y le sigue escribiendo a la base desde un módulo
>   desmontado **mientras corren otras suites**. Medido en su momento:
>   `"You are trying to require a file after the Jest environment has been torn down"`, con el
>   cron disparando a las 22:20 y 22:30.
>
>   **El tamaño, medido y no estimado:** de los 50 specs, **15** tienen limpieza que corre
>   antes del `app.close()` y fuera de un `finally`. Otros 20 no tienen `finally` pero su
>   `afterAll` **solo cierra la app**, así que no hay nada que pueda fallar antes — contarlos
>   daba 35 e inflaba el trabajo al doble. Los 15:
>   `cajones`, `combos`, `costeo-cpp`, `grupos-modificadores-overrides`, `grupos-modificadores`,
>   `items-pausados`, `liquidacion-propinas`, `monto-tolerancia`, `recetas`, `salones-comanda`,
>   `salones-fusion`, `tendencia-descuadres`, `unidad-ingrediente-referenciado`, `uso-reglas`,
>   `vigencia-cuenta`.
>
>   ⚠️ **La trampa, que ya costó el veredicto de un mutante entero:** *"que el `afterAll` afirme
>   su status"* aplicado a secas **hace daño**. Si el `expect` corre **antes** del
>   `app.close()`, el primer fallo de limpieza tira la excepción, la app de Nest queda viva con
>   su pool abierto y **jest imprime el resultado y no termina nunca** (medido: 7 minutos, 0%
>   CPU, `pg_stat_activity` sin una sola query). Un mutante que hace exactamente lo que debe se
>   vuelve indistinguible de un entorno colgado.
>   ➡️ **La forma correcta, ya aplicada en `caja-testigo.e2e-spec.ts`** —copiar de ahí—:
>   acumular los fallos de limpieza, cerrar la app en un `finally`, y afirmar **después**.
>   Mismo diagnóstico, 4,4 s en vez de colgarse. Y para los pasos intermedios que pueden
>   responder un 400 inofensivo, el molde es `liberarCajeroSiQuedoOcupado` en
>   `caja.e2e-spec.ts`: best-effort, sin abortar la higiene.
>
>   ℹ️ **Por qué está suelta acá y no adentro de otra entrada:** venía anidada en la del `401`
>   fantasma, y cuando ésa se cerró el 2026-08-25 esta acción **quedó huérfana en
>   `resueltos.md`** —cero menciones en este archivo— hasta que se notó. No depende de aquel
>   bug: el `401` era otro proceso ocupando un puerto, y esto es una fuga real y aparte.

---

## El `401` fantasma no era nuestro: otro proceso ocupaba el puerto (2026-08-25)

**Venía de la sección 2.** Siete avistajes en cinco specs distintos entre el 2026-08-11 y el
2026-08-25, y **ninguna de las causas que la entrada persiguió era la correcta** — porque el
problema no estaba en el proyecto.

### La causa

`supertest` **bindea una dirección y le habla a otra**
(`node_modules/supertest/lib/test.js:60-70`):

```js
if (!addr) this._server = app.listen(0);          // bindea el WILDCARD (::)
return protocol + '://127.0.0.1:' + port + path;  // pero direcciona 127.0.0.1
```

En macOS eso abre un hueco, y está medido con un experimento propio, no deducido:

| Experimento | Resultado |
|---|---|
| Bind al **wildcard** sobre un puerto que otro proceso tiene en `127.0.0.1` | **Entra sin `EADDRINUSE`** |
| Conexión a `127.0.0.1:<ese puerto>` | **Se la lleva el bind más específico**, o sea el ajeno |
| Bind a **`127.0.0.1`** sobre ese mismo puerto | `EADDRINUSE` |

Como `listen(0)` saca puertos del rango efímero —acá 49152-65535— alcanza con que cualquier
programa escuche ahí adentro. En esta máquina era el **agente de Battle.net** en
`127.0.0.1:56561`, y su respuesta a cualquier request es, textual:

```
HTTP/1.1 401 Unauthorized
Content-Length: 0
Connection: close
```

Idéntica, byte por byte, a lo capturado en el e2e.

### Por qué explica lo que ninguna hipótesis explicaba

- **El `401` en `POST /auth/register`**, ruta sin guard ni rama de 401: el request **nunca
  llegó a la app**.
- **Un token válido rechazado**: la app nunca lo vio.
- **Spec y ruta distintos cada vez**: el que pidiera algo justo después de que `listen(0)`
  entregara ese puerto.
- **Verde al repetir**: otro puerto.
- **El `TypeError: resMiembros.body.find is not a function`** del primer avistaje: un body
  vacío no es un array.
- **Y por qué CI casi no lo veía**: allá no hay un Battle.net escuchando.

### El arreglo

Que el bind coincida con la dirección a la que se habla: `listen(0, '127.0.0.1')`. Ahí el
puerto ocupado **sí** da conflicto y el sistema entrega otro libre. Se parchea
`serverAddress` una vez, en `backend/test/setup-supertest.ts`: son 50 specs y ninguno tiene
por qué saber esto.

⚠️ **No se arregla cerrando Battle.net.** Hoy es ése; mañana es cualquier programa que
escuche en el rango efímero, y el síntoma vuelve sin relación aparente con nada.

### Cómo se agarró, que es lo que vale para el próximo

**No se resolvió leyendo código: se resolvió instrumentando y corriendo en loop.** Cinco
avistajes en dos semanas no habían alcanzado porque **todos registraron el status y ninguno
el body**. La caja negra (en el mismo archivo del arreglo, y **queda puesta** como red)
engancha por `setupFilesAfterEnv` —sin tocar un solo spec— y escribe todo 401 con su body,
sus headers y el test que lo produjo.

La secuencia, cada paso decidido por el anterior:

| Medición | Qué descartó |
|---|---|
| `body: {}` vacío | Nest **siempre** serializa la excepción a JSON → no salió de la capa de excepciones |
| `content-type` ausente, `content-length: 0` | no es JSON; el 401 legítimo del mismo guard trae `content-length: 43` |
| **`x-powered-by` ausente** | Express lo pone en TODA respuesta suya → **no pasó por Express** |
| `socketReciclado: false` | no era reuso de socket del pool de keep-alive |
| El puerto: `56561` en las 3 capturas, y **distinto en cada 401 legítimo** | dejó de ser "un 401 raro" y pasó a ser "hay algo en ese puerto" |
| `lsof -nP -i :56561` | el nombre y el PID del culpable |

📌 **Tres notas de método**, que valen más que el bug:
1. **La tasa real era 1 en 4, no 1 en 10.** La entrada la estimaba por avistajes casuales;
   medida en loop, cayó en la corrida 4, después en la 3, después en la 3.
2. **La caja negra tuvo su propio bug y por poco arruina la cacería:** borraba el log al
   empezar **cada spec**, porque el flag vivía en `globalThis` y jest le da a cada archivo su
   propio sandbox (`process.env` tampoco sirve: también es por archivo). Dos corridas
   completas dejaron **cero** capturas. No se vio al estrenarla porque se verificó con **un**
   spec, donde el bug es invisible por construcción.
3. **Un discriminador anotado a priori puede no servir.** Se instrumentó `www-authenticate`
   pensando que separaría Passport del resto: resultó **ausente también en el 401 legítimo**.
   El que decidió fue `x-powered-by`, que se agregó después.

### La red que queda

`app.e2e-spec.ts` afirma que el server de los tests se ata a `127.0.0.1`. Afirma sobre la
**llamada a `listen`** y no sobre `address()`, porque supertest cierra el server al terminar
el request. Mutante: sacar el parche → el test cae. Sin esa red el arreglo es invisible y su
ausencia no se ve hasta el próximo fantasma.

### El texto con el que estaba anotada

> - [ ] **Un flaky del e2e de caja, y seis lecturas de `/tenants/members` que esconden su
>   causa** (backend/tests, visto el 2026-08-11) — son dos cosas y la segunda es la que se
>   puede arreglar hoy.
>
>   **El flaky:** `caja.e2e-spec.ts` → *"un usuario fuera del allow-list del cajón recibe 403
>   al abrir"* falló con `TypeError: resMiembros.body.find is not a function`. La corrida
>   siguiente, verde. **Las dos** partieron de `reset-db.sh` y las dos pasaron
>   `reset-db.sh --verificar` (un solo `Seed complete`, mismo contenedor), así que no es la
>   contaminación acumulativa de siempre. Y `test/jest-e2e.json` tiene `maxWorkers: 1`, así
>   que tampoco es interferencia entre specs en paralelo. **Causa no determinada:** lo único
>   medido es que el body no era un array.
>
>   ✅ **La mitad legible se cerró el 2026-08-11** (ver [`resueltos.md`](resueltos.md)): las
>   lecturas de `/tenants/members` afirman el status antes de castear, así que la próxima vez
>   que esto pase el test va a decir qué contestó el servidor. **El flaky sigue abierto**: su
>   causa sigue sin determinarse, y lo que se cerró es la mudez, no el bug.
>
>   Contexto que puede o no ser relevante, anotado para no perderlo: `GET /tenants/members`
>   es **admin-only** desde el 2026-08-09 (`TenantAdminGuard`). El token que usa el test es
>   el del admin, así que un 403 liso no es la explicación obvia — pero es justo la clase de
>   hipótesis que la aserción de status confirmaría o descartaría de una.
>
>   🆕 **Segundo avistaje, y le da forma a la hipótesis (2026-08-11).** En una corrida de la
>   suite completa, `ventas.e2e-spec.ts` → *"anula, repone el stock y persiste quién y por
>   qué"* falló con **`401 Unauthorized` en `POST /ventas`**. Mismo patrón: un solo test, la
>   corrida siguiente (misma suite, mismo `reset-db.sh`) verde, y `--verificar` confirmó una
>   sola siembra. Es otro spec y otra ruta, así que **no es "el flaky de caja"**: es un
>   intermitente de **autenticación**, que es la familia a la que los dos pertenecen.
>
>   🆕 **Tercer avistaje (2026-08-23), y el patrón se sostiene.** `papelera.e2e-spec.ts` →
>   *"items: una fila borrada sin `eliminado_por` no aparece en la papelera ni se puede
>   restaurar"* falló con **`401` en `POST /items`**. Idéntica forma: **un solo** test de 601,
>   `--verificar` confirmó una sola siembra, el spec pasa **83/83 corrido solo**, y la suite
>   entera vuelve verde en la corrida siguiente desde base limpia. Tercer spec y tercera ruta
>   distintos: ya son `caja`, `ventas` y `papelera`, lo que aleja cualquier causa local a un
>   módulo. ⚠️ El "definitivamente" que decía acá se sacó el 2026-08-24: el cuarto avistaje cayó
>   en **este mismo spec**.
>   ⚠️ **Y sirve de aviso operativo, porque cuesta tiempo cada vez:** este rojo aparece a mitad
>   del gate de una tarea que no tiene nada que ver, y la primera reacción es sospechar del
>   cambio propio. El descarte son cuatro cosas y en ese orden: `--verificar`, correr el spec
>   solo, comprobar que el módulo del cambio no está en el camino del test, y **re-correr la
>   suite entera** —no un subconjunto—.
>
>   🆕 **Cuarto avistaje (2026-08-24, durante el corte de `minimo`), y trae un dato que
>   DEBILITA el argumento de arriba.** `papelera.e2e-spec.ts` → *"garzones: restaurar deja
>   `eliminado_por` en NULL…"*, **401** en `POST /restaurar`. Misma forma en todo lo demás: un
>   solo test de 609, `--verificar` con una sola siembra, el spec **83/83 corrido solo**, y la
>   suite completa re-corrida **verde**. Nada del cambio en curso tocaba auth, guards ni tokens.
>   ⚠️ **Lo nuevo:** es el **mismo spec que el tercer avistaje**, en otro test. La entrada venía
>   argumentando "tres specs distintos, lo que aleja definitivamente cualquier causa local a un
>   módulo" — con dos de los cuatro en `papelera.e2e-spec.ts`, **ese argumento se debilita**.
>   Sigue sin ser prueba de causa local (los otros dos son `caja` y `ventas`), pero quien retome
>   esto debería mirar qué tiene `papelera` que lo hace aparecer el doble: es el spec con más
>   tests del repo (83) y el que más recursos distintos recorre.
>
>   ⛔ **LA "CAUSA MEJOR SOSTENIDA" YA NO EXISTE — re-medida el 2026-08-24, y hay que dejar de
>   mandar gente hacia allá.** Decía que *"los helpers `login()` de 23 de los 32 specs leen el
>   `access_token` sin afirmar el status"*, así que un login fallido dejaba el token en `undefined`
>   y el `describe` entero mandaba `Bearer undefined`. **Medido hoy sobre los 47 specs: los 47
>   afirman el status del login antes de leer el token.** Cero excepciones.
>
>   ⚠️ **Y eso hace más grave lo que queda, no menos.** El avistaje de hoy en `papelera.e2e-spec.ts`
>   ocurrió **con el assert puesto** (`test/papelera.e2e-spec.ts:71`): el login devolvió 200 y el
>   token era real. O sea que **un token válido recibió un 401 en una ruta posterior**, que es un
>   mecanismo distinto del que esta entrada describía y sigue sin explicación.
>
>   📌 **Dos cosas que la re-medición deja como método**, porque cada una costó una pasada en falso:
>   - La afirmación vieja no se puede verificar con un grep ingenuo. Un primer intento marcó **46 de
>     47 como culpables** —contaba la declaración `access_token: string` de la interfaz como una
>     lectura— y un segundo dejó **uno**, que resultó falso positivo: afirmaba los dos status juntos
>     con `toEqual([200, 200])`, forma que el regex no cubría. **Medir mal en la dirección alarmante
>     es tan caro como no medir.**
>   - Descartes ya hechos para el próximo: no es la base moviéndose (`--verificar` verde), no es el
>     spec (pasa solo), no es el módulo del cambio en curso, y no es el pool disfrazado de 401
>     —`jwt.strategy.ts` → `validate()` no toca la base—.
>   ⛔ **Y descarta la sospecha que esta entrada anotaba**: "el pool agotado disfrazado de 401" es
>   falso. `jwt.strategy.ts` → `validate()` **no toca la base** (verificado abriendo el archivo:
>   recibe el payload firmado y mapea cuatro campos), y ningún guard tiene `try/catch` que
>   traduzca un error a 401. Un fallo de base ahí da 500, no 401.
>
>   🎯 **SEXTO AVISTAJE (2026-08-25), el primero ATRAPADO CON LA CAJA NEGRA — y trae el dato
>   que cambia el problema.** Se corrió la suite completa en loop; cayó en la **corrida 4**
>   (tres verdes antes, ~130 s cada una), o sea que la tasa medida es del orden de 1 en 4, no
>   de 1 en 10.
>
>   - **Spec y test:** `items-pausados.e2e-spec.ts` → *"crear un ítem con la categoría pausada
>     devuelve 400 y la nombra"* (`:614`). Esperaba **400**, recibió **401**.
>   - **Ruta:** `POST /api/items`, que sí tiene `JwtAuthGuard` a nivel de `@Controller`, así
>     que un 401 ahí **sería legítimo**… salvo por lo de abajo.
>   - **El token viajaba:** `Authorization` presente, 334 caracteres. **No es
>     `Bearer undefined`**, que era la causa que esta entrada dio por buena y ya estaba
>     refutada.
>
>   ⛔ **EL BODY VINO VACÍO (`{}`), y eso no lo explica ninguna de las dos formas conocidas.**
>   Nest **siempre** serializa una excepción a JSON: un guard da
>   `{ message: 'Unauthorized', statusCode: 401 }` y el código propio da
>   `{ message: '<texto>', error: 'Unauthorized', statusCode: 401 }`. **Un 401 con body vacío
>   no salió de la capa de excepciones de Nest.** Es la primera pista dura en seis avistajes, y
>   reorienta el frente: **deja de ser un bug de auth** y pasa a ser "quién escribe una
>   respuesta que la app no escribió".
>
>   🔗 **Y conecta con la entrada de abajo**, la del `timeout exceeded when trying to connect`:
>   ese intermitente también cayó en **`items-pausados.e2e-spec.ts`**. La entrada de allá
>   anotaba *"puede ser pariente… nada lo prueba todavía"*; que los dos aparezcan en el mismo
>   spec no lo prueba tampoco, pero es la primera coincidencia concreta entre los dos.
>
>   ➡️ **Siguiente paso, ya instrumentado:** la caja negra ahora captura además
>   `content-type`, `content-length`, `www-authenticate` y `connection`, más los primeros 300
>   caracteres del texto crudo. Con eso el próximo se cierra: **sin `content-type` es un
>   `res.end()` pelado; con `www-authenticate` es Passport**; y un `content-length` que no
>   cuadra apuntaría a una respuesta cortada.
>
>   🔬 **Pasada del 2026-08-24: se instrumentó, y se refutaron dos hipótesis con evidencia.**
>
>   **Lo que ahora existe y antes no: `backend/test/diagnostico-401.ts`, una caja negra.** Se
>   engancha por `setupFilesAfterEnv` —no hay que tocar ningún spec— y parchea el `end` de
>   supertest, por donde pasan también los `await`. Escribe **todo** 401 de la corrida a
>   `test/tmp-401.jsonl` (gitignored, se borra al empezar cada corrida) con la ruta, el body,
>   si viajaba `Authorization` y de qué largo, y el nombre del test. Marca `sospechoso: true`
>   al que cae en una ruta que no espera 401.
>
>   **Por qué el body y no el status, que es lo único que registraron los cinco avistajes:**
>   el body dice **quién** tiró el 401, y es un discriminador que nadie usó todavía.
>
>   | Body | Quién lo tiró |
>   |---|---|
>   | `{ message: 'Unauthorized', statusCode: 401 }` — **sin** `error` | Passport, o sea un guard, sin pasar por código propio |
>   | `{ message: '<texto>', error: 'Unauthorized', statusCode: 401 }` | código de la app |
>
>   ✅ **CONFIRMADO, y es lo más raro de esta entrada: el 401 de `POST /auth/register` es
>   imposible desde la app.** Se midió entero, no por encima: no hay guard global (`APP_GUARD`
>   no aparece en el repo), `AuthController` **no tiene guard de clase** —solo `@ApiTags` y
>   `@Controller('auth')`—, la ruta no tiene `@UseGuards`, y `AuthService.register`
>   (`auth.service.ts:143`) **no tiene rama de 401**: devuelve 200 fijo. El único
>   `UnauthorizedException` cerca es el de `validateUser` (`:113`), que es el camino del
>   **login**. Y la atribución del avistaje también se verificó: `alta-usuarios-tenant`
>   efectivamente llama a `register` (líneas 330, 356 y 363). O sea que hay que explicar una
>   respuesta que la app no puede producir.
>
>   ⛔ **REFUTADO — supertest concurrente.** Hipótesis razonable: dos requests en `Promise.all`
>   sobre un server que todavía no escucha hacen que las dos llamen a `listen(0)`, y una
>   respuesta cruzada explicaría un 401 en una ruta sin guard. **Medido: no aplica.** De los 50
>   specs, **uno solo** usa supertest dentro de un `Promise.all` (`rbac-y-contrasena`), y
>   **ninguno de los cinco specs con avistajes** lo hace (`caja`, `ventas`, `papelera`,
>   `recetas`, `alta-usuarios-tenant`: cero).
>
>   ⛔ **REFUTADO — una spec le rompe la contraseña a un usuario compartido.** Encajaba con el
>   401 al loguear con credenciales del seed, y con que 42 archivos compartan
>   `admin.paris@paris.cl`. **Medido: el único spec que cambia contraseñas es
>   `rbac-y-contrasena`, y registra una cuenta nueva por test justamente para no hacer eso**
>   (está escrito en su propio docblock, `:188-191`). Tampoco es el seeder anulando la
>   verificación: es idempotente —`findOne` y crea solo si falta, con `correoVerificadoEl`
>   sellado (`seeder.service.ts:1083-1092`)—, así que re-correrlo no toca a un usuario que ya
>   existe.
>
>   📌 **Y la acción concreta que esta entrada propone —que toda limpieza de `afterAll` afirme
>   su status— quedó dimensionada:** de los 50 specs, **15** tienen limpieza que corre antes
>   del `app.close()` y **fuera de un `finally`**. Otros 20 no tienen `finally` pero su
>   `afterAll` **solo cierra la app**, así que no hay nada que pueda fallar antes: contarlos
>   daba 35 y habría inflado el trabajo al doble.
>
>   Por qué importa para el de caja: un `401` devuelve un **objeto** (`{statusCode, message}`),
>   no un array — que es exactamente `resMiembros.body.find is not a function`. Los dos
>   síntomas se explican con la misma causa. **Sigue siendo hipótesis, no medición**: nadie
>   vio todavía el status de la respuesta que rompió el de caja; eso lo va a decir la
>   aserción que se agregó el 2026-08-11 la próxima vez que ocurra. Lo que cambió es que ahora
>   hay dónde mirar primero: por qué un token válido a mitad de suite se rechaza.
>
>   🆕 **Tercer avistaje (2026-08-12), y ya no puede ser casualidad.** `recetas.e2e-spec.ts` →
>   *"12. un ítem pedido en una cuenta abierta no se puede borrar…"* falló con **401** en
>   `GET /items/:id/uso`. Corrida siguiente, misma suite y mismo `reset-db.sh`: verde, 400/400.
>   **Son tres specs distintos, tres rutas distintas, y las tres veces un 401**
>   (`caja` → `TypeError` sobre un body que no era array, o sea un 401 disfrazado; `ventas` →
>   `POST /ventas`; `recetas` → `GET /items/:id/uso`). Un solo test por corrida, siempre
>   distinto, siempre auth.
>   Eso descarta que sea de un spec: es **un intermitente del camino de autenticación** bajo la
>   suite completa (que corre con `maxWorkers: 1`, así que tampoco es paralelismo). Sospechas a
>   medir, en este orden: expiración del access token a mitad de suite (¿cuánto dura?), y el
>   pool de conexiones bajo la consulta de sesión/permisos.
>   ⚠️ **Importa más de lo que parece:** hace que **cualquier** corrida de CI pueda fallar sin
>   regresión, y entrena a leer un rojo como ruido — que es exactamente cómo pasa desapercibida
>   una regresión real.
>
>   🔗 **Cuarto avistaje (2026-08-12) y la conexión que faltaba.** `garzon-modo-personal.e2e-spec.ts`
>   falló con **400** en `POST /sesiones-garzon/iniciar` — *"ya tiene una sesión abierta"*. No
>   reprodujo: solo pasa 14/14, y la suite completa siguiente dio 400/402 verde.
>   **No es un intermitente nuevo: es la CONSECUENCIA del 401.** Si el 401 pega sobre un `cerrar`
>   de limpieza —y las limpiezas de `afterAll` **no afirman su status**—, la sesión queda abierta
>   en silencio y el siguiente spec que use ese garzón recibe un 400 que no tiene nada que ver.
>   Por eso el síntoma cambia de spec en spec y parece aleatorio.
>   ➡️ **Acción concreta que se puede tomar YA, sin resolver la causa:** que **toda** limpieza de
>   `afterAll` afirme su status. No arregla el 401, pero convierte una cascada silenciosa en un
>   fallo que apunta a su origen. Es el mismo hallazgo que la revisión ya había marcado sobre
>   `caja.e2e-spec.ts` ("la higiene final no verifica status... contamina los describes siguientes
>   en silencio").
>
>   ⚠️ **Precisión medida el 2026-08-13: "que afirme su status" es correcto pero incompleto, y
>   aplicado a secas hace daño.** Si el `expect` corre **antes** de `app.close()`, el primer fallo
>   de limpieza tira la excepción, la app de Nest queda viva con su pool abierto y **jest imprime
>   el resultado y no termina nunca** (medido: 7 minutos, 0% CPU, `pg_stat_activity` sin una sola
>   query). Un mutante que hace exactamente lo que debe se vuelve indistinguible de un entorno
>   colgado — costó el veredicto de un mutante entero.
>   ➡️ La forma correcta, ya aplicada en `caja-testigo.e2e-spec.ts`: **acumular** los fallos de
>   limpieza, cerrar la app en un `finally`, y afirmar **después**. Mismo diagnóstico, 4,4 s en
>   vez de colgarse. Los `afterAll` de los otros specs siguen con la forma vieja.

---

## Un tramo puede valer cero: "envío gratis sobre $30.000" (2026-08-24)

**Venía de la sección 3.** Texto con el que estaba anotada:

> - [ ] **Un tramo no puede valer cero, y no hay `maximo`: "gratis sobre $X" no se expresa**
>   (backend + producto, medido el 2026-08-22 al construir el recargo por escalones) — los
>   tramos son **abiertos hacia arriba** (solo `minimo`) y `validarMontosDeRegla` exige
>   `valor > 0`. Con eso un recargo escalonado puede **bajar** ($2.000 bajo $20.000 → $500
>   arriba) pero no **llegar a cero**, que es justo la forma del caso más común —envío gratis
>   sobre cierto monto, recargo por pedido chico que desaparece—.
>   ℹ️ Este documento afirmaba que los tramos tenían `maximo` nullable: **nunca existió**, ni
>   en las entidades ni en `startup-pos.sql`. Ya se corrigió en
>   [`features/descuentos-recargos.md`](../features/descuentos-recargos.md).
>   **Las dos salidas son de producto, no correcciones:** (a) permitir `valor = 0` en un
>   tramo, o (b) agregarle `maximo` al tramo. Las dos afectan **también a descuentos**, que
>   comparten la validación y el modelo.
>   ✅ **DECIDIDO (owner, 2026-08-23): la (a) — un tramo puede valer cero.** No se agrega
>   `maximo`: los tramos siguen abiertos hacia arriba. Con eso "envío gratis sobre $30.000" se
>   expresa como un tramo de valor 0, que es la forma del caso más común.
>   ✅ **Y cómo se ve, decidido en la misma pasada: un recargo que quedó en cero NO aparece en
>   la boleta.** Nada de líneas en `$0` ni de la palabra "gratis" — el documento queda limpio.
>   ⚠️ Ojo al construir: `validarMontosDeRegla` exige `> 0` y la comparte con descuentos, así
>   que aflojarla toca los dos. Un descuento de cero es inocuo, pero conviene que sea una
>   decisión y no un efecto secundario.
>   🔄 **La validación cambió de forma el 2026-08-23** y esta entrada hay que leerla con eso:
>   ya no recibe un `valor` suelto sino `{ valorMonto, valorPorcentaje }`, el `> 0` vive en
>   `validarMonto(unidad, valor)`, y **hay una segunda función, `validarTramo`, que además
>   exige que el tramo traiga exactamente una de las dos columnas**. Permitir el cero toca las
>   dos: aflojar el `> 0` sin mirar `validarTramo` deja "sin importe" y "importe cero"
>   indistinguibles, que no es lo que se decidió. Ver
>   [`resueltos.md`](resueltos.md) § *"El importe de una regla deja de ser ambiguo"*.

### La advertencia de la entrada era FALSA, y se midió antes de escribir nada

La entrada avisaba que aflojar el `> 0` sin mirar `validarTramo` dejaría *"sin importe"* e
*"importe cero"* indistinguibles. **No es así, y ya no lo era cuando se escribió:**
`validarTramo` pregunta `!tramo.valorMonto && !tramo.valorPorcentaje`, los dos campos son
`string` —`@IsNumberString` rechaza un número de JSON, y TypeORM devuelve `numeric` como
string— y **`'0'` es truthy**. Los dos casos ya estaban separados sin tocar una línea.

Es exactamente el mismo error que se había corregido cuatro días antes en
`validarMinimosDeTramos`, donde un mutante mostró que la forma larga contra
`null`/`undefined`/`''` era equivalente a `!!` para strings. Corregido en el docblock de
`validarTramo`, que es donde el próximo lo va a buscar.

### La mitad más grande estaba HECHA, y la entrada no lo sabía

La otra decisión del owner —*un recargo que quedó en cero no aparece en la boleta*— no
necesitó una línea de código:

- **La boleta ya lo omite.** `ticket-builder.ts` imprime la línea de recargo solo con
  `.gt(0)`, y muestra el **agregado** `totalRecargos`, no una línea por regla: una regla en
  cero nunca tuvo línea propia.
- **El motor ya aplicaba el `'0'` bien.** `aplicarValor` corta con `valor == null`, no con
  falsy, así que un tramo en `'0'` produce un monto 0 y no un "sin valor".
- **El drawer de auditoría sí lo muestra**, atenuado (`sinEfecto`), y eso es lo correcto:
  son dos superficies distintas —el documento del cliente y la pantalla de quien explica un
  descuadre—. Filtrar el cero en el motor habría borrado la fila de `venta_recargos` sin
  ganar nada.

⚠️ **Corrección a esta entrada, de la revisión independiente:** acá se había escrito que las
trazas *"son las dos cosas a la vez: la línea del comprobante y el registro auditable"*, y
**para descuentos y recargos es falso**. La boleta no imprime una línea por regla de esas dos
familias —imprime los agregados `totalDescuentos`/`totalRecargos`—, y el único consumidor
traza por traza es `agregarImpuestosVenta`, que es de impuestos. O sea que filtrar el cero en
el motor **no habría cambiado la boleta en absoluto** (sumarle 0 a un agregado no la mueve):
habría costado *solo* la fila auditable. La decisión de no filtrar no cambia; el argumento con
el que quedó escrita, sí.

### Lo que sí se decidió: el cero lo admite el tramo, no el valor plano

Lo que la entrada marcó sin resolver —*"conviene que sea una decisión y no un efecto
secundario"*— es que el `> 0` vive en `validarMonto`, compartida por el valor plano de la
regla y el de cada tramo. **Decisión del owner (2026-08-24): solo el tramo.**

Un tramo en 0 significa algo: con los tramos abiertos hacia arriba, es la única forma de
escribir el escalón que deja de cobrar. Una regla **plana** en 0 no: queda prendida, se
aplica en cada venta, no cobra nada y no le dice nada a nadie — mientras que pausarla hace
lo mismo y el POS **avisa** al cajero (*"está en pausa y no se aplicó"*, el `continue` de
`procesarReglas`). Dos maneras de apagar una regla, una silenciosa y a simple vista idéntica
a una rota, es lo que la asimetría evita.

`validarMonto` aprende cuál de los dos está validando por el mismo `donde` que
`validarExpresion` ya enhebraba para elegir el texto del error. No hizo falta un parámetro
nuevo.

### Los tests, y qué mutante mata a cada uno

Unit en `monto-regla.util.spec.ts` y en `descuentos.service.spec.ts` —la función y el
camino del service, que es donde se la invoca de verdad—, dos e2e en
`reglas-valor.e2e-spec.ts`, y uno de `MoneyInput` en el frontend.

| Mutante | Qué mata |
|---|---|
| Revertir a `numero <= 0` (el código anterior) | **3** — los dos tramos en cero y el ancla del service |
| `const admiteCero = true` (aflojar para los dos) | 1 — el valor plano en 0, que es la decisión |
| Sacar `numero < 0` | **3** — el tramo negativo, el `-1` del valor plano y el del service |
| Tratar el cero como campo vacío en `MoneyInput` | 1 — el `'0'` tecleado no llegaría nunca |

⚠️ **Esta tabla decía 2 / 1 / 2, y estaba mal por medir en el momento equivocado:** los
mutantes se corrieron *antes* de agregar los tests de `descuentos.service.spec.ts`, y la
tabla no se volvió a medir después. Lo cazó la revisión independiente, que sí los corrió
sobre el diff entero. Es el mismo error que este archivo registra en otras entradas: una
afirmación comparable se mide, y **se vuelve a medir cuando cambia lo comparado**.

El primero es un **revert**, no un "romper": prueba que el test habría cazado el bug, no
solo que toca la línea nueva.

⚠️ Un test viejo **sobreafirmaba**: se llamaba *"rechaza un tramo en 0 o negativo"* y solo
probaba `-5`. Se separó, y el `'0'` del valor plano salió del `it.each` que compartía con
`-1` y `abc`: los tres se rechazan, pero por razones distintas, y `0` ahora es el único que
guarda una decisión de producto.

El e2e va por la API entera a propósito: que un `'0'` sobreviva depende del DTO, del CHECK
de tabla y de `aplicarValor`, y un test sobre la función sola no ve nada de eso. Prueba el
caso de la entrada con el mismo ítem: **$2.000 de recargo con cantidad 1** ($1.000) y
**$0 con cantidad 40** ($40.000, tramo de $30.000 que vale cero), afirmando además que el
neto queda pelado — si el tramo en cero no se eligiera, ahí seguiría aplicando el de abajo.

---

## El mínimo de un tramo dice qué mide: `minimo` se parte en cantidad y monto (2026-08-24)

**Venía de la sección 3.** Es la misma FORMA que el corte de `valor` del 2026-08-23, un campo
al lado, y el owner eligió resolverla igual: partir la columna.

### Qué estaba mal

`minimo` era **una** columna que significaba dos cosas según un hermano que estaba en otra
tabla: en un `por_mayor` son unidades, en un `por_monto_venta` es plata. Quién decidía era un
`if` con el string del tipo adentro del motor:

```ts
const magnitud = codigo === 'por_mayor' ? ctx.cantidad : ctx.monto;
```

La consecuencia práctica no es que el motor calculara mal —no lo hacía— sino que **ninguna de
las dos unidades se podía validar en el borde**. Marcar la columna como plata habría rechazado
un `2,5` legítimo de un local que vende al peso; no marcarla dejaba pasar un umbral de
`$20.000,50` en un tenant CLP, que es un dato inexpresable en esa moneda.

📌 **La prueba de que la ambigüedad era real estaba en los tests, y nadie la había leído así:**
el spec del motor tenía **un solo `const tramos` compartido** entre el caso `por_mayor` y el
caso `por_monto_venta`. Funcionaba justamente porque el significado no estaba en el dato.

### Qué se hizo

- `minimo` → `minimo_cantidad` / `minimo_monto` en `descuento_tramos` y `recargo_tramos`, con
  un CHECK de exactamente uno, igual que el de `valor`.
- **El motor pasó a leer el dato:** `seleccionarTramo` recibe las dos magnitudes y cada tramo
  se compara contra la suya. El `if` con el string **ya no existe**.
- `minimoMonto` lleva `@EsMontoCobrado()`, así que el umbral en plata pasa por
  `EscalaMonedaPipe` como cualquier otro monto. `minimoCantidad` no lo lleva, a propósito.
- `validarMinimosDeTramos(codigo, tramos)` en `monto-regla.util.ts` —donde ya vive la regla
  gemela del importe— exige que el tramo llene la columna del tipo de su regla.
- Seeder, DTOs, services y las dos pantallas de configuración.

### El bug de frontend que el cambio destapó

`recargos.vue` elegía el `MoneyInput` del umbral con `codigo === 'por_monto_venta'`, y el tipo
de recargo se llama **`recargo_por_monto_venta`**: la condición nunca daba `true`. Su
comentario decía *"hoy ningún recargo seedeado usa campoTramos"*, cierto cuando se escribió y
falso desde el 2026-08-22.

Pasaba desapercibido porque el backend aceptaba cualquier escala en el umbral. **Este cambio lo
volvió visible**: desde que `minimoMonto` se valida, un `20.000,50` es 400, y el campo tenía
que impedir tipearlo en vez de dejar que rebotara. En `descuentos.vue` la condición se cambió
a la MISMA expresión que elige la columna al guardar, para que no puedan separarse.

### Qué lo fija

El que carga el peso es `'la magnitud la dice el TRAMO, no el código de la regla'`: monta una
regla con código `por_monto_venta` y tramos que llenan `minimoCantidad`, y afirma que se mide
contra la cantidad. **Con el `if` viejo puesto, ese test da 120 en vez de 60** — verificado
revirtiendo la línea. Es un estado que el service no deja escribir, y está a propósito: el
motor es una función pura y su contrato es *"mido lo que el tramo dice"*.

Más: 8 tests sobre `validarMinimosDeTramos` —verificados con el mutante que invierte
`CODIGOS_MINIMO_POR_CANTIDAD`, que voltea 6 tests entre el util y los services— y 3 e2e que
recorren el camino de la app: el umbral en plata con centavos es 400, el `2,5` de cantidad es
201, y el mínimo en la columna cruzada es 400.

⚠️ **Un mutante SOBREVIVIÓ y por eso el código quedó más corto:** la presencia del mínimo se
había escrito contra `null`/`undefined`/`''` "porque `!valor` trataría el 0 como ausente".
**Es falso para strings** —`!!'0'` es `true`— y el mutante que lo simplificaba pasaba en verde.
Se dejó la forma corta y el test dice explícitamente que fija la conducta, no la forma.

### Lo que levantó la revisión independiente

Bloqueó, y las tres tenían razón:

1. **`startup-pos.sql` seguía declarando `minimo NOT NULL`** en las dos tablas. No era
   opinable: el corte de `valor` —que es **el último commit que tocó ese archivo**, `43d35250`—
   **sí** lo había actualizado, y sobre estas dos tablas.
2. **`motor-calculo-precios.md` describía el despacho que este cambio eliminó** —*"tramos
   (`por_mayor` por cantidad, `por_monto_venta` por monto)"*—, y es el documento que
   `CLAUDE.md` manda leer ANTES de tocar el motor.
3. **Y la buena de verdad: el docblock del motor prometía una homogeneidad que el código no
   garantizaba.** Decía que todos los tramos de una regla miden lo mismo "porque lo exige
   `validarMinimosDeTramos`", y con `codigo: null` solo se validaba la forma. **Medido: un
   `POST /descuentos` de tipo `directo` con un tramo en cantidad y otro en monto entraba con
   201**, y entonces `seleccionarTramo` comparaba *"500 unidades"* contra *"$100"* para
   decidir cuál gana. Esa comparación cruzada **es nueva de este cambio**: antes todos los
   tramos se medían contra una sola magnitud, así que `mejorMin` era homogéneo por
   construcción.

   Se cerró exigiendo que **todos los tramos de una regla midan lo mismo, también cuando el
   tipo no usa tramos**. No es una regla de negocio —no dice cuál columna, eso lo decide el
   tipo— sino de forma: mezclar unidades no significa nada en ninguna lectura. Con eso el
   docblock pasó a ser cierto.

También levantó, y se aplicó, que `porCantidad` usaba `!== null` estricto mientras la
respuesta de un `POST` **omite la key** (los campos del DTO son opcionales): con `undefined`
caía en la rama de cantidad y hacía `new Decimal(undefined)`. Ahora es `!= null`.

### Lo que la primera versión rompió, y lo cazó el e2e

Un `PATCH` que cambia el tipo a uno **sin tramos** deja huérfanos los guardados, y la
validación les exigía la columna del tipo nuevo — que no mide nada. Rechazaba un `PATCH`
legítimo (`ancla positiva`). Se corrigió pasando `codigo: null` en ese caso: se valida la
**forma** —un solo mínimo, no negativo, que es lo que evita el 500 del CHECK— y no la
correspondencia con el tipo.

📌 Lo interesante es de dónde salió: **ni el unit ni el typecheck lo vieron**; lo vio el e2e
completo, y el test que lo vio era un "ancla positiva" —de los que afirman que algo que DEBE
funcionar sigue funcionando—, no uno de los que buscan el error.

---

## La escala del monto de la pasarela sale de la moneda de la ORDEN, no del tenant (2026-08-24)

**Venía de la sección 3.** Se cerró en el mismo movimiento en que se descubrió que su
diagnóstico estaba **invertido**.

### Lo que la entrada decía, y por qué era al revés

Decía que faltaba colgar `EscalaMonedaPipe` en `PasarelaApiController`, y que lo bloqueaba
una pregunta de diseño: *"exige decidir de dónde saca el tenant un controller que no tiene
JWT"*.

**Las dos mitades resultaron falsas al medirlas:**

1. **La pregunta ya estaba contestada en el código.** `ApiKeyGuard` resuelve el tenant desde
   la API key y lo deja en `req.pasarelaAuth = { tenantId, apiKeyId }`. No había nada que
   decidir.
2. **Y colgar el pipe habría sido el arreglo EQUIVOCADO**, que es lo que importa. El pipe
   valida contra la moneda **oficial del tenant**; una orden de pasarela va en la moneda de
   la pasarela (`pasarela_ordenes.moneda`, hoy CLP siempre, hardcodeada en 6 lugares). Un
   tenant con oficial USD habría pasado a aceptar `1000.50` en una orden CLP. La entrada leía
   `montoEntero` como *"una segunda noción de escala compitiendo con el borde"*; medido, era
   **la noción correcta**, en el lugar equivocado.

⚠️ **La lección no es sobre la pasarela.** La entrada se escribió desde un inventario que
recorría DTOs buscando marcas de escala, y desde esa lente "falta la marca" es la única forma
que puede tener el problema. Un campo de plata **sin** marca puede ser correcto: la marca dice
*"la moneda es la del tenant"*, y eso es una afirmación de dominio, no un checkbox.

### El defecto que apareció al medir, y que nadie había anotado

En `CobrosService.cobrar` la orden se **persiste antes** de llamar al proveedor, y el proveedor
(`montoEntero`) era el único que miraba la escala. Además el `catch` de ahí solo atrapa
`ProviderComunicacionError`. Resultado, con `POST /pasarela/api/cobros` y `monto: "1000.50"`:

- la orden queda guardada en `en_proceso`,
- sin ninguna transacción asociada y **sin que se enviara nada a Transbank**,
- el cliente recibe un 400 que nombra a Transbank en vez de a su monto,
- y la fila queda colgada hasta `fechaExpiracion`.

O sea: un error de **formato del cliente** ensuciaba la tabla de órdenes.

### Qué se hizo

- `MonedasService.validarEscalaDeMoneda(monto, codigoIso)` — la misma regla y la misma fuente
  que `EscalaMonedaPipe` (`moneda.decimales`) por otra puerta: el pipe resuelve la moneda desde
  el token, este método la **recibe**. No son dos nociones de escala.
- `MONEDA_ORDEN_V1` en `pasarela-orden.entity.ts`, reemplazando los 6 literales `'CLP'` de los
  dos services, para que la moneda de la orden tenga un solo lugar del que salir.
- La validación corre **en el borde**, junto al `lte(0)` que ya estaba, en `cobrar`,
  `reembolsar` e `iniciar` — antes de persistir o de llamar al proveedor.
- Los tres DTOs de plata llevan escrito al lado del campo **por qué NO llevan
  `@EsMontoCobrado()`**, que es la parte que evita que el próximo lo "arregle" al revés.
- `montoEntero` **se dejó como estaba**: es el guardia de formato de la API de Transbank (el
  `amount` viaja entero), que es otra cosa que la escala de una moneda.

### Qué lo fija

Cuatro tests sobre `validarEscalaDeMoneda` (rechazo por escala, resolución **por código y no
por tenant** con un `not.toContain('tenants')`, ceros a la derecha aceptados, moneda
inexistente) y tres sobre dónde se aplica.

El que carga el peso es `'cobro con monto fuera de la escala: NO queda orden creada'`: **no
afirma el throw** —el proveedor también tiraba, así que un test del throw pasaba en verde con
el bug puesto— sino que `ordenRepo.save`, `provider.autorizarCobro` y `transacciones.registrar`
**no se llamaron**. Verificado con mutante: quitando la línea nueva de `cobrar`, ese test es el
que cae; el equivalente en `pagos-redirect` también.

### Lo que levantó la revisión independiente, y cómo se cerró

Veredicto **LIMPIO** con dos advertencias, las dos accionadas:

1. **Los tests no fijaban la MONEDA del call site.** Afirmaban que nada se persistió, pero
   ninguno miraba el segundo argumento: un mutante que pasara la moneda oficial del tenant en
   vez de la de la orden —**la regresión exacta que este cambio existe para evitar**— pasaba
   en verde. Se agregó el `toHaveBeenCalledWith(monto, MONEDA_ORDEN_V1)` en los dos services y
   se verificó con ese mutante (`'USD'` en el call site → el test cae).
2. **`reembolsar` valida contra la constante, no contra `orden.moneda`**, aunque ahí la orden
   ya existe y su moneda es legible. Es deliberado: la moneda de una orden la escribe ese
   mismo código desde la constante, así que hoy no pueden diferir, y validar antes de abrir la
   transacción da un 400 sin abrirla, sin tomar el `FOR UPDATE` y sin escribir nada (leer, lee:
   el chequeo hace su propio `SELECT` sobre `moneda`). El día que la moneda deje de salir de la
   constante, el chequeo **se mueve adentro** y lee `orden.moneda`.

   ⛔ **Y acá el cierre se equivocó primero, lo que vale más que el dato:** el comentario que
   se escribió justificaba dejarlo afuera diciendo que meterlo en la transacción *"pediría una
   segunda conexión sosteniendo el lock, el auto-bloqueo de ADR-020"*. **Es falso.** `Db.query`
   resuelve el manager de la transacción activa (`db.service.ts`, "manager del contexto si hay
   transacción en curso; pool si no"): correrlo adentro usa **la misma** conexión. Lo único que
   toma una segunda es `db.sinTransaccion`, la salida explícita. La revisión independiente lo
   bloqueó por esto —no por el código, que estaba bien— y tenía razón: un comentario que enseña
   lo contrario del invariante de conexiones empuja al próximo a "arreglarlo" con
   `sinTransaccion`, que **sí** reabre el patrón del deadlock.

Y una corrección de dato: la tabla es `pasarela_ordenes`, no `pasarela_orden`.

📌 **Lo que este cierre NO tocó**, y queda dicho: `montoEntero` está **duplicado byte a byte**
en `webpay-plus.provider.ts` y `oneclick.provider.ts`. Es el patrón de las tres copias de la
zona horaria, pero es formato de proveedor y no escala de moneda, así que se dejó fuera de
alcance en vez de arrastrarlo. Si entra un tercer proveedor, se extrae.

---

## El demo vuelve a dejar entrar: el navegador pasa a hablar con un solo origen (2026-08-23)

**Venía de la sección 4** («necesita que el owner conteste»), y fue la entrada más corta de
este archivo: se escribió y se cerró el mismo día. El owner eligió **A —el proxy en el
frontend—** sobre B (dominio propio). Mudada verbatim:

---

- [ ] **El demo de Railway no deja entrar: la cookie de refresh es cross-site y el navegador
  no la lleva** (infra + frontend, medido contra el demo vivo el 2026-08-23) — el backend
  está **sano**: con `curl` y un cookie jar el flujo `login → switch-tenant` completa. Lo que
  falla es el navegador, y `POST /auth/switch-tenant` contesta **401 «No refresh token»**.

  **Lo medido, sin interpretar** (headers reales del demo, 2026-08-23):

  ```
  set-cookie: refresh_token=…; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax
  access-control-allow-credentials: true
  access-control-allow-origin: https://frontend-production-c0db.up.railway.app
  ```

  - **CORS está bien.** El `allow-credentials` y el `allow-origin` son los correctos. Quien
    llegue acá buscando un problema de CORS va a perder el día: no es eso.
  - **El cliente está bien.** `useApiFetch` pone `credentials: 'include'` en todas las
    llamadas (`composables/useApiFetch.ts:12`) y `switchTenant` pasa por ahí
    (`stores/tenant.ts:45`). Hay hasta un test que lo fija (`stores/auth.spec.ts:179`).
  - **`up.railway.app` está en la Public Suffix List** (verificado el 2026-08-23 contra
    `publicsuffix.org`, entrada de Railway Corporation). O sea que
    `frontend-production-c0db.up.railway.app` y `backend-production-8635.up.railway.app`
    tienen **dominios registrables distintos**: para el navegador son **cross-site**, no solo
    cross-origin. Una cookie `SameSite=Lax` no viaja ahí. No distinguí si el navegador falla
    al guardarla o al mandarla; el resultado es el mismo.
  - **Por eso nadie lo vio en desarrollo:** `localhost:5173` y `localhost:3000` se
    diferencian **solo en el puerto**, y el puerto no cuenta para «sitio». En local son
    same-site y la cookie viaja. El bug **solo existe desplegado**.

  ⚠️ **No se arregla con variables de entorno.** `sameSite: 'lax'` está **hardcodeado** en
  `auth.controller.ts:41` —única ocurrencia en todo el backend— y no lo lee ninguna config.

  ℹ️ **De paso, medido por el mismo header:** falta el atributo `Secure`, que sale de
  `NODE_ENV === 'production'` (`auth.controller.ts:42`), así que **en Railway `NODE_ENV` no
  es `production`**. No es lo que rompe el login (sobre HTTPS la cookie viaja igual sin
  `Secure`), pero es endurecimiento pendiente y **puede tener otras consecuencias sin medir**:
  `nuxt.config.ts` ramifica su lista de módulos con ese mismo `NODE_ENV` y `Dockerfile.prod`
  no lo fija, así que la imagen del demo podría estar construida con `@nuxt/test-utils`
  adentro. **Sin verificar** — se mira antes de tocar nada.

  **La pregunta para el owner: A o B.** Las dos arreglan el login; ninguna toca el sistema de
  tokens.

  - **A — el frontend hace de proxy de `/api`.** El frontend **no** es estático: `Dockerfile.prod`
    corre `node .output/server/index.mjs`, un servidor Nitro de verdad, así que admite rutas
    `server/api/**` aunque `ssr: false` (hoy no existe el directorio `server/`). Con eso el
    navegador habla **solo** con el frontend: same-origin, la cookie viaja, y **CORS
    desaparece del problema**. Toda la app sale por `useRuntimeConfig().public.apiUrl`, un
    solo lugar. ⚠️ **Trampa:** `VITE_API_URL` entra como **ARG de build** y se hornea en la
    imagen (`Dockerfile.prod`), así que esto es un **rebuild**, no un cambio de variable.
  - **B — dominio propio, `app.` y `api.` bajo el mismo dominio registrable.** Comparten
    eTLD+1, así que pasan a ser same-site y `Lax` alcanza: **cero código**. Cuesta un dominio
    y su configuración en Railway.

  🔶 **La tercera, que es la tentadora, y por qué no la propongo sola:** cambiar la cookie a
  `SameSite=None; Secure` es **una línea** en `auth.controller.ts:41` más `NODE_ENV`. Toca la
  cookie de refresh del sistema de autenticación ya implementado, así que roza la
  **invariante 4** de `CLAUDE.md` («no modificar el sistema de tokens JWT»). Si eso cuenta o
  no como «modificar el sistema» lo decide el owner, no el agente — por eso está escrita acá
  y no ejecutada. Y aunque se decida que sí vale, deja la sesión más expuesta que A, que
  elimina el problema en vez de permitirlo.

  📌 **El owner se inclinó por A** al verlo el 2026-08-23, pero no lo cerró. Falta el sí.

---

### Qué se hizo

El navegador dejó de tener URL de backend. `runtimeConfig.public.apiUrl` es **`/api`,
relativa y constante** —ya no es una variable de entorno—, y un catch-all de Nitro
(`frontend/server/api/[...].ts`) reenvía cada `/api/**` al backend con `proxyRequest` de h3.
`API_PROXY_TARGET` sustituye a `VITE_API_URL` en `docker-compose.yml`, `.env.example`, CI y
Railway, y desaparece el `ARG VITE_API_URL` de `Dockerfile.prod`.

La decisión completa, con las dos alternativas descartadas y sus motivos, en
**[ADR-022](../adr/022-navegador-un-solo-origen.md)**. Tres cosas que vale repetir acá:

- **El destino se lee de `process.env` en cada request, no de `runtimeConfig`.**
  `nuxt.config.ts` se evalúa en el BUILD, así que cualquier cosa que se resuelva ahí queda
  horneada en la imagen — que es exactamente la trampa que teníamos. Ahora cambiar de backend
  es una variable y un reinicio.
- **`apiUrl` dejó de ser configurable a propósito.** Apuntar el navegador a otro host tiene
  que ser **imposible**, no desaconsejado: si sigue siendo una variable, el bug puede volver
  el día que alguien la ponga mal, y no hay nada que avise.
- **Dev y prod usan el mismo camino.** La causa de este bug fue que dev y prod tenían formas
  distintas; un proxy que solo existiera desplegado sería el mismo error con otro disfraz.

### Qué lo fija

- **Un e2e de navegador nuevo, `e2e/smoke/mismo-origen.smoke.spec.ts`** (`@smoke`): hace el
  login por la UI —sin reusar `storageState`, porque el tramo a observar es justo donde nace
  y se usa la cookie— y afirma que **ninguna llamada a `/api` sale del origen del frontend**.
  **Mutante corrido:** devolver `apiUrl` a `http://localhost:3000/api` —el código anterior—
  lo pone rojo. Y el detalle que justifica que este test exista: bajo el mutante **el login
  sigue funcionando** (el test llega a ver «Bienvenido» y recién después falla en la
  aserción). Un test que solo mire *«¿entró?»* pasa en local antes y después del arreglo; el
  que discrimina es el que mira **adónde se habla**.
- **La suite de navegador entera pasa a través del proxy**, así que toda la app ejercita el
  camino nuevo, no solo el login.
- **`e2e/smoke/proxy-api.smoke.spec.ts`**, que mira el proxy *como proxy*: que una
  redirección del backend llegue al navegador en vez de que la siga el servidor, y que una
  ruta que se sale de `/api` la corte el proxy y no el backend. Cada uno con su mutante, y
  cada mutante mata solo su test.

### Lo que encontró la revisión, y por qué importa cómo

El primer intento pasaba el gate entero en verde —suite de navegador incluida— y **tenía dos
bugs**: el proxy seguía los 3xx del backend en vez de transportarlos (medido: `/api/auth/google`
pasaba de **302 a 200**, o sea el login con Google roto), y no anclaba la ruta al prefijo
(medido: `/api/../algo` llegaba al backend como `/algo`). Los encontró la revisión
independiente del diff; ninguna prueba existente los podía ver, porque **ninguna ejercitaba
un redirect ni una ruta cruda**. La lección no es «revisar más»: es que al meter una pieza de
transporte nueva, lo que hay que probar no es que las llamadas de siempre sigan andando —eso
pasa igual— sino las propiedades que la pieza promete.

### Qué NO arregla, y sigue anotado

`NODE_ENV` en Railway no es `production` —lo prueba el `Secure` ausente en la cookie—. No es
lo que rompía el login y no se tocó acá. Con esta decisión además **importa menos**: la
cookie ya no depende de atributos cross-site para viajar. Sigue siendo endurecimiento
pendiente, con su consecuencia sin verificar sobre el build del frontend.

---

## La vigencia por fecha se evalúa, y `promocional` deja de existir (2026-08-24)

**Venía de la sección 6.** Lo que se abrió como *"hacer andar `promocional`"* terminó siendo
otra cosa dos veces: primero al medir que la vigencia no es de ese tipo sino de **cualquier
regla con fechas**, y después al decidir el owner que ese tipo **se elimina**. El frente
entregado es más chico que el que se abrió, y el diagnóstico más grande.

Spec: [`2026-08-23-vigencia-por-fecha-design.md`](../superpowers/specs/2026-08-23-vigencia-por-fecha-design.md) ·
Plan: [`2026-08-23-vigencia-por-fecha.md`](../superpowers/plans/2026-08-23-vigencia-por-fecha.md)

**Lo que queda abierto de esa sección** —`mora`, `pronto_pago` y los dos intereses, que
esperan el vencimiento de venta— sigue en `pendientes.md` § 6. Texto de la entrada, mudado
verbatim:

---

### Cinco tipos de regla no hacen lo que la pantalla promete — construirlos (2026-08-23)

**Qué es esto:** el 2026-08-23 se midió que cinco de los doce tipos de regla no se comportan
como su formulario dice. Se evaluó **sacarlos** y después **pausarlos**; el owner descartó las
dos: **se construyen**. No es «arreglar un bug» en la mayoría de los casos — cuatro de los
cinco dependen de algo que el sistema todavía no tiene, así que el trabajo es desarrollarlos.
Esta entrada es el inventario de qué falta en cada uno y qué hay que decidir antes de tocar
nada.

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
| `promocional` | fecha desde / hasta | **El más común y el más barato, y el único listo para empezar:** solo necesita saber si *hoy* cae en el rango, sin plazos ni intereses. ✅ **Sus cuatro decisiones están tomadas** — ver el bloque de abajo. |
| `pronto_pago` | *"Días antes del vencimiento"* | Necesita que la venta tenga un **vencimiento**, que hoy no existe como concepto. Va con el frente de crédito. |
| `mora` | días de atraso | Necesita vencimiento **y** un evento que dispare el atraso. ¿Se calcula al cobrar? ¿Un job la devenga? Va con el frente de crédito. |

#### ✅ `promocional`: decidido y listo para abrir frente (owner, 2026-08-23)

Es el único de los cinco que no espera nada: no necesita vencimiento de venta ni aritmética
de crédito. Las cuatro decisiones, con lo que se midió al tomarlas:

1. **El momento que decide es cuándo se ABRIÓ la cuenta, no cuándo se cobra.** La escena que
   se resolvió: una mesa que se sienta 23:50 con la promo vigente y paga 00:10 **sí** lleva el
   descuento — se le prometió al sentarse.
   ⚠️ **Lo que eso cuesta, medido:** el motor corre en `ventas.service.ts` →
   `crearEnTransaccion`, y en salones eso ocurre **al cerrar la cuenta**
   (`salones.service.ts:1022`), o sea al cobrar. Hay que llevarle al motor un instante que hoy
   no recibe: `ReglaResuelta` **no tiene ningún campo de fecha** — `fechaInicio`/`fechaFin` ni
   siquiera llegan. La regla completa es *"el momento en que se abrió la cuenta, o el de la
   venta si no hubo cuenta"*: en POS directo y en online los dos instantes son el mismo.
2. **«Hoy» es el día del local, y sale de la ZONA DE LA PROVINCIA.**
   ✅ **HECHO el 2026-08-23, antes de abrir este frente** → [`resueltos.md`](resueltos.md)
   § «Una sola noción de zona horaria, y sale de la provincia». Salió aparte a propósito: es
   transversal y de bajo riesgo, así que separarlo deja `promocional` como puro motor +
   pantalla. Lo que se encontró al hacerlo y esta entrada no sabía: no era «una línea en el
   helper» sino **tres copias byte a byte** de la misma consulta.
   👉 **Para quien tome `promocional`:** la zona ya se pide con
   `zonaHorariaTenant(db, tenantId)` y ya devuelve la de la provincia. No hay nada que decidir
   ni que agregar.

3. **El borde `hasta` es inclusivo del día**, sin decisión nueva: se reusa el criterio ya
   tomado el 2026-08-22 para los filtros de fecha, que vive en el mismo
   `rango-fecha.util.ts` (`bordeHastaSql` expande a `< fecha+1`). Seguir lo existente, no
   inventar un segundo criterio.
4. **Una promo vencida se muestra como «vencida» en la pantalla**, no desaparece ni se calla.
   El riesgo que evita es concreto: hoy una regla vencida se ve idéntica a una vigente, así que
   el local puede pasar semanas creyendo que da un descuento que no da. Sale de datos que ya
   están —el backend **exige** ambas fechas para `promocional`
   (`descuentos.service.ts:570` y `:706`)—, así que es presentación: ninguna columna nueva.

⛔ **Una pregunta que la entrada traía y NO existe:** *"¿y una devolución sobre una promo ya
vencida?"*. Medido el 2026-08-23: el motor corre **una sola vez, al crear la venta**, y nada
re-evalúa una venta existente —la nota de crédito arma su fila directo—. Una devolución nunca
vuelve a pasar por las reglas, así que no hay nada que decidir ahí.

#### Los que SÍ hacen algo, pero mal

⚠️ **Este matiz importa y en una versión anterior de esta nota estaba mal dicho:** estos dos
**no** están diferidos. Cobran — cobran distinto de lo que prometen.

| Tipo | Lo que la pantalla pide | Lo que hace |
|---|---|---|
| `interes_simple` | *"Tasa mensual"* | cobra ese porcentaje **una sola vez**, sobre la base, sin preguntar plazo: una venta a 1 mes y otra a 6 cobran lo mismo |
| `interes_compuesto` | *"Tasa mensual"* | **exactamente lo mismo que el simple** — ninguna rama del motor los distingue, así que la diferencia entre los dos tipos hoy es solo el nombre |

🔨 **Los dos hay que DESARROLLARLOS, no esconderlos** (owner, 2026-08-23, dicho al descartar
la pausa). Hoy no sirven: cobrar una tasa *mensual* una sola vez y sin mirar el plazo no es
interés simple, es un recargo porcentual con otro nombre — y compuesto es literalmente el
mismo código. Mientras sigan así, un local que financie a 6 meses cobra lo mismo que uno que
financia a 1.

**Lo que hay que decidir antes de escribir una línea:**
- **De dónde sale el plazo de una venta a crédito.** Hoy la venta no tiene vencimiento: es el
  mismo concepto que les falta a `pronto_pago` y `mora`, así que los cuatro comparten
  prerequisito y conviene decidirlo una sola vez.
- **Cuándo se calcula el interés: al vender o al cobrar.** Al vender queda congelado en el
  documento —lo que pide ADR-010 para el hecho fiscal— pero entonces un pago adelantado no lo
  baja. Al cobrar sigue la realidad, pero el total del documento deja de ser el total.
- **Con qué periodicidad capitaliza el compuesto** (mensual, diaria), que es lo único que lo
  hace distinto del simple.

⚠️ **El motor no sabe de tiempo, y ése es el trabajo de verdad.** Su magnitud es
`codigo === 'por_mayor' ? ctx.cantidad : ctx.monto`: no hay una tercera. Darle plazo no es
agregar una rama a `evaluarRegla`, es agregarle una dimensión — por eso esto es un frente con
diseño propio y no un arreglo.

#### Y un sexto, de otra familia, que aparece al mirar esto

`metodo_pago` (descuento) y `recargo_metodo_pago` (recargo) **ignoran los tramos**: su rama en
el motor retorna antes del `if` de tramos. No cobran cero —los dos están en
`TIPOS_CON_VALOR_UNICO`, así que el backend les exige `valor` y el motor cobra ese— pero los
escalones que se configuren se descartan. Hoy no muerde porque la pantalla no ofrece el campo
(`campoTramos: false` en los dos), y está **diferido** hasta que un tenant lo pida. Ver su
entrada propia más arriba.

#### Pausarlos quedó descartado como ruta

Al medir esto la primera salida que apareció fue **pausar** los cinco tipos para que nadie
pudiera configurar algo que no funciona. **El owner la descartó dos veces** (2026-08-23): no
se esconden, **se desarrollan**. Lo que se midió mientras se evaluaba esa ruta —el `activo`
de `tipos_regla` que no se hace valer, y el seed que no lo repone— dejó de ser trabajo por
eso, y está archivado en «Vigilancia» al final de este archivo por si la ruta vuelve.

⛔ **Toca el motor de precios: va solo y con el sistema quieto** (`CLAUDE.md`). Y `promocional`
**puede salir antes y por separado** — no necesita nada de la aritmética del crédito.

---

### Qué se construyó

Seis tareas, seis commits, cada una con su revisión independiente de contexto fresco:

| Commit | Qué dejó |
|---|---|
| `2511887` | El motor descarta la regla no vigente. Guard al lado del de la pausada, **sin avisar** |
| `e98dc0b` | `fechaLocalTenant` — el instante al día del local, con `Intl` y sin dependencia |
| `4ec6629` | El servicio calcula `vigente` contra ese día, bordes inclusivos |
| `f10cec9` | El instante sale de `cuentas.abierta_el` cuando la venta nace de una cuenta |
| `2494601` | `promocional` eliminado; `directo` gana fechas opcionales |
| `a549deb` | La pantalla marca *Vencida* y *Programada* |

**Las cuatro decisiones de producto** (owner, 2026-08-23) están en la spec. La que da sentido
al frente: **manda el momento en que se ABRIÓ la cuenta**, no el del cobro — la mesa que se
sienta 23:50 con la promo vigente y paga 00:10 lleva el descuento, porque se le prometió al
sentarse.

**Dos hallazgos que cambiaron el alcance sobre la marcha:**
- **No era `promocional`: eran tres tipos con fechas, y dos de ellos COBRABAN fuera de su
  ventana.** Los escalones por monto no estaban diferidos, así que sus fechas se ignoraban en
  silencio. Ese era el problema peor —`promocional` al menos no cobraba de más— y quedó
  arreglado de arrastre, sin trabajo extra.
- **`promocional` salió también del `Set` `DIFERIDAS`.** Dejarlo era un comentario que miente
  sobre un tipo que ya no existe, y una trampa latente: si alguien recreara ese código,
  quedaría descartado en silencio — el bug exacto que este frente cierra.

### Qué se decidió y por qué el motor no aprendió de fechas

El motor recibe un `vigente: boolean` **requerido**; toda la aritmética de fechas y husos vive
en la capa de servicio. Se descartó que el motor comparara fechas: es una función **pura y
sincrónica sin I/O**, y en este repo la aritmética de husos la hace Postgres — comparar ahí
adentro exigiría una **librería de zonas horarias**, o sea una dependencia nueva, que obliga a
frenar y preguntar. El requisito de que el campo sea obligatorio no es estilo: si fuera
opcional, olvidarse de mapearlo dejaría una regla vencida cobrando en silencio.

El instante viaja por **id de cuenta**, nunca como fecha del cliente, y **`CreateVentaDto` no
lo expone**: llega a `crearEnTransaccion` como parámetro del método, que solo salones pasa. El
abuso que eso cierra es concreto — dejar una cuenta abierta en diciembre y mandar su id en un
`POST /ventas` de marzo para cobrar con la promo de verano, que el acotado por tenant no
frena porque la cuenta es propia.

### La lección, que es sobre los tests y no sobre las fechas

**Tres veces en este mismo plan un borde quedó sin red**, y las tres el código estaba bien:
lo que faltaba era el test.
- El esqueleto de la Task 3 solo probaba los días de **adentro** del rango; un `vigente: true`
  fijo los dejaba pasar. El implementador lo detectó y lo reforzó.
- La revisión corrió un mutante que nadie pidió —`<=` por `<`— para comprobar que los bordes
  inclusivos estuvieran cubiertos de verdad.
- En la pantalla, el docblock afirmaba "bordes inclusivos" sin que nada lo verificara.

Y una cuarta, distinta y peor: **un mutante que se dio por bueno resultó EQUIVALENTE.** El
reporte afirmaba que reordenar dos condiciones mataba un test; reproducido, pasaban los 27.
Las dos condiciones miran campos mutuamente excluyentes, así que el orden nunca cambia el
resultado. **Una verificación mal descrita es peor que ninguna**, porque la siguiente lectura
la da por hecha.

📌 El patrón que las cuatro comparten: **preguntarse qué mutante mataría a este test, y si la
respuesta es "ninguno", el test no cubre lo que dice cubrir.**

### Dos cosas que se cubrieron por decisión del coordinador, no por el plan

- **El filtro por tenant de la consulta de la cuenta no lo cubría ningún test** — la revisión
  lo comprobó sacándolo y viendo la suite entera en verde. Por el rubro era "Menor"; se
  arregló igual, porque el aislamiento por tenant es la invariante 1 de `CLAUDE.md` y un guard
  sin test es como desaparece en un refactor.
- **El badge de la pantalla se verificó en el navegador**, no solo por unit: *"Promo verano
  2026-27"* sale **Programada**, la promo de e2e ya vencida sale **Vencida**, y el resto de las
  filas sin badge.

---

## Una sola noción de zona horaria, y sale de la provincia (2026-08-23)

**Salió de la sección 6**, como prerequisito separado del frente de `promocional`: el owner
eligió sacarlo aparte porque es transversal y de bajo riesgo, y así el frente del motor queda
solo con motor y pantalla.

### Qué estaba mal

`provincia.zona_horaria` existe, es `NOT NULL` y está sembrada con dos valores distintos
—`America/Santiago` para Región Metropolitana, `Pacific/Easter` para Isla de Pascua—. **Nadie
la leía.** La consulta que resuelve la zona de un tenant hacía `tenants → provincia → pais` y
devolvía `pais.zona_horaria_principal`: pasaba *por* la provincia y se salteaba su columna. El
propio nombre «principal» del país decía que la provincia manda.

⚠️ **Y no era un lugar: eran tres copias byte a byte de la misma consulta.** El diagnóstico
inicial —«es una línea en el helper»— salió de grepear por el nombre del helper; buscando por
**conducta** aparecieron `common/utils/rango-fecha.util.ts`, más un `private zonaHoraria()`
propio en `turnos/sesiones-garzon.service.ts` y otro en `propinas/propina-reportes.service.ts`.
Corregir una sola habría dejado dos módulos leyendo la del país y uno la de la provincia: **dos
nociones compitiendo, peor que el bug original.**

### Qué se hizo

La consulta pasa a seleccionar `pr.zona_horaria`, y los dos privados se colapsaron contra
`zonaHorariaTenant` en el mismo commit, para que quede **una sola definición** y la próxima no
nazca duplicada. El `JOIN pais` se queda aunque ya no se lea su columna: es lo que impide
resolver la zona de un tenant cuyo país está dado de baja, y hay un test que lo exige —nació
porque el mutante que borraba esos filtros pasaba la suite entera—.

`pais.zona_horaria_principal` **se queda sin lectores en runtime**, y eso está dicho en el
docblock a propósito: su sentido pasa a ser el default del país al **crear** una provincia, no
la zona con la que se calcula. Sin decirlo, alguien la vuelve a leer «porque estaba ahí».

### Qué se midió

📊 **Hoy no cambia ningún resultado**: los seis tenants están en Región Metropolitana, donde
provincia y país coinciden. Lo que cambia es el futuro — el primer local de Isla de Pascua iba
a tener dos horas de corrimiento en sus mermas, sus cobros de pasarela, sus sesiones de garzón
y sus reportes de propina. Era un bug **latente**, no vivo, y se dice así para que nadie lo
lea como un incendio apagado.

### Qué lo fija

`rango-fecha.util.spec.ts` estrena un `describe('zonaHorariaTenant')` —la función no tenía
ninguno—: que la zona sale de la provincia, que los dos filtros de borrado siguen, y que sin
fila es 404. **Mutante corrido:** devolver la consulta a `p.zona_horaria_principal` —el código
anterior— pone rojo exactamente ese test y ningún otro.
⚠️ La aserción va sobre la cláusula que **selecciona** (`/SELECT\s+pr\.zona_horaria\s+AS/`),
no sobre una mención suelta: un `toContain('pr.zona_horaria')` lo satisface hasta un
comentario, que es un error ya cometido en este repo.

### Y una aserción ajena que este cambio dejó HUECA

Lo encontró la revisión independiente, y es la parte que no se ve sola. En
`sesiones-garzon.service.spec.ts` había un test —*"sin filtro de fecha no sale a buscar la
zona horaria"*— que lo afirmaba con `includes('zona_horaria_principal')`. Al pasar la zona a
salir de la provincia, **ninguna consulta contiene ya ese string**: la aserción quedó
verdadera por vacío, sin distinguir *"no fue a buscar la zona"* de *"fue a buscarla con la
consulta nueva"*. Seguía verde y ya no probaba nada.

Se reancló sobre el `JOIN provincia`, que es la **forma** de esa consulta y no aparece en la
del historial, así que sigue discriminando aunque la columna vuelva a cambiar de nombre.
**Mutante corrido:** forzar al service a pedir la zona siempre lo pone rojo.

📌 **La lección, que es más general que este arreglo:** una aserción negativa
(`expect(...).toBe(false)`) escrita sobre un nombre concreto **se vuelve inofensiva sola** en
cuanto ese nombre cambia, y no hay nada que avise — el test sigue verde. Al renombrar una
columna o un símbolo, los `not`/`toBe(false)` que lo mencionan hay que revisarlos uno por uno:
son los únicos que se rompen quedándose en verde.

---

## Los dos mensajes de las reglas: el `update` pregunta en el orden del `create`, y el del tramo dice la verdad en los dos caminos (2026-08-23)

**Venía de la sección 3** («ya decidido, falta construir»). Es el remate del corte de
`valor` en dos columnas —ver [«El importe de una regla deja de ser ambiguo»](#el-importe-de-una-regla-deja-de-ser-ambiguo-dos-columnas-en-vez-de-una-cerrado-2026-08-23)—:
lo que ese cierre dejó anotado porque su diff ya tenía el LIMPIO atado por hash.
Mudada verbatim:

---

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

---

### Qué se hizo

**1. El orden.** El chequeo de *"El valor es requerido para este tipo"* se movió a
**después** de `validarMontosDeRegla` en `validarEstadoResultante`, en los dos services.
Ahora los cuatro caminos —`create` y `update` × descuentos y recargos— preguntan lo mismo
en el mismo orden: primero si lo que mandó el cliente cuadra, después si falta algo.

El caso que se medía mal no era el que decía la entrada. Un `PATCH { valorMonto: '5000' }`
a secas sobre una regla de porcentaje **ya contestaba bien**, porque `importeResultante`
cae de vuelta al `valorPorcentaje` guardado y la fila resultante sí tiene importe. La forma
que muerde es la que manda **las dos** columnas —`{ valorPorcentaje: null, valorMonto:
'5000' }`—, que es lo que arma cualquier cliente que serialice el formulario entero: ese
`null` explícito deja la fila sin importe, y el chequeo de requerido contestaba antes de que
nadie mirara el `5000` que sí vino. El arreglo es el mismo; el test que lo fija tuvo que
apuntar a esa forma y no a la de la entrada.

**Costo asumido, dicho explícito:** la lectura de los tramos guardados ahora corre **antes**
del chequeo de requerido, así que un `PATCH` destinado a morir por falta de importe hace una
query que antes se ahorraba. Es una query puntual por request, nunca una por fila. La
alternativa —partir `validarMontosDeRegla` en dos llamadas para colar el requerido en el
medio— se descartó: convierte una función con una responsabilidad en dos mitades que hay que
acordar entre cuatro llamadores, que es exactamente el acuerdo entre copias que este archivo
existió para eliminar.

**2. El mensaje del tramo.** `common/utils/monto-regla.util.ts` ya no habla de un `PATCH`
ni de "los tramos guardados" cuando puede no haber ninguno:

> Esta regla es un porcentaje: hay un tramo con su importe en `valorMonto`. Los tramos —los
> que mandes, o los que ya estén guardados si no los mandás— tienen que expresarlo en
> `valorPorcentaje`.

Nombra las dos procedencias en vez de afirmar una, así que es cierto en el `POST` (el tramo
vino en el body) y en el `PATCH` (puede ser uno guardado que el cliente ni sabe que existe).
Se descartó enhebrar un discriminador POST/PATCH por los dos services **solo para elegir un
texto**, y se descartó cortar la segunda mitad: es la única parte accionable del mensaje.

### Qué lo fija

- **Unit, uno por service** (`descuentos.service.spec.ts`, `recargos.service.spec.ts`):
  *"lo dice igual cuando el PATCH apaga de paso la columna correcta"*.
  **Mutante corrido:** revertir el bloque de requerido a su posición anterior —el código tal
  cual estaba— pone rojos exactamente esos dos y ningún otro. No basta con romperlo: el
  mutante es el código viejo, así que prueba que el test **habría cazado el bug**.
- **E2E** (`reglas-valor.e2e-spec.ts`, de 21 a 23 tests): el `PATCH` con las dos columnas
  contra la API viva, y la frase del tramo por el camino del **`POST`**, que era el que no
  estaba cubierto —el e2e viejo anclaba solo la primera mitad, la que no cambia—. Las dos
  aserciones del tramo ahora anclan las dos mitades.

### Lo que no se tocó

Ninguna conducta de cálculo, ningún `CHECK`, ninguna columna, ningún DTO. Los dos caminos ya
rechazaban con 400 antes y siguen rechazando con 400: cambió **qué dicen** y **en qué orden
preguntan**.

---

## El umbral de descuadre al cierre: dos niveles, ninguno bloquea, y una bandeja que llama a revisar (2026-08-23)

**Venían de la sección 3** («ya decidido, falta construir»): dos entradas que se construyeron
juntas porque eran las dos mitades del mismo control. Mudadas verbatim con su cierre; el
residuo (el envío diario) quedó como entrada corta en `pendientes.md` §3.

### La entrada del umbral

**Aprobación de cierre por umbral de diferencia** (backend + config) — patrón Toast:
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
✅ **DECIDIDO (owner, 2026-08-15) el cruce que faltaba: quien cerró PUEDE aprobar su propio
cierre, y queda registrado quién aprobó qué.** El razonamiento del owner: el control existe
para auditoría, no para impedir — frenar un cierre a las 2 de la mañana porque no hay un
tercero disponible detiene la operación.
⚠️ **Cómo convive con la decisión del 2026-08-11, que sigue vigente:** el cierre por umbral
**sigue siendo bloqueante** en el caso normal (el cajero cierra su caja y espera al encargado).
Lo que esta decisión resuelve es solo el cruce con el **cierre forzado**: cuando el encargado
ya cerró la caja de otro, es él quien aprueba, y el registro es el control. **No son
contradictorias, pero quien lo construya tiene que ver las dos** o va a implementar un bloqueo
que en ese camino nunca se puede levantar.
⚠️ **Costo asumido, dicho explícito:** en el camino del cierre forzado el umbral deja de ser un
control preventivo y pasa a ser un rastro. Que el registro exista y sea legible **es** el
control ahí; si el evento no queda o nadie lo mira, no queda nada.
➕ **Lo que aportó la 5ª pasada de la investigación (2026-08-22), y precisa el patrón:**
Toast no tiene un umbral sino **dos niveles** — `Closeout Over/Short Max` bloquea y exige
*managerial override*, y `Closeout Over/Short Warning` solo pide confirmación del empleado
**sin** bloquear. El chileno **mySYSTEM** también tiene tope configurable que impide cerrar.
Los nombres van acá para no volver a relevarlos.
🔄 **REVISADO POR EL OWNER (2026-08-23) — esto reemplaza el "bloqueante" del 2026-08-11.**
Son **dos niveles y NINGUNO frena el cierre**:
- **Nivel de aviso:** el cajero ve la advertencia, confirma y cierra.
- **Nivel alto:** avisa más fuerte y le llega al encargado, pero el cajero igual cierra y se
  va. No se detiene la operación en ningún caso.
⚠️ **Es una reversión, no un matiz:** la decisión del 2026-08-11 decía "bloqueante, no aviso"
y la del 2026-08-15 resolvía solo el cruce con el cierre forzado. Quien construya esto se
guía por **esta** entrada; las dos anteriores quedan como historia del porqué.
⛔ **Consecuencia asumida, que antes valía solo para el cierre forzado y ahora vale para
todos:** el umbral deja de ser un control preventivo y es **enteramente rastro**. Si el
evento no queda o nadie lo mira, no queda nada. Por eso lo que sigue no es adorno:
✅ **Cómo se entera el encargado (owner, 2026-08-23):** el cierre le queda en una **bandeja
de "pendientes de revisar"** hasta que alguien lo abre y lo marca visto, **más un resumen
diario** con los descuadres de la jornada. Nada de notificación en el momento: a las 2 de la
mañana se vuelve ruido y un control que se vuelve ruido se muere.
✅ **El cajero SÍ se entera, y puede dejar su explicación (owner, 2026-08-23):** al cerrar ve
que la diferencia pasó el límite y que su cierre va a revisarse, y puede escribir qué pasó
("le di vuelto de más", "faltó registrar una compra de insumos"). El encargado revisa con esa
explicación al lado en vez de con un número pelado. Cierra el 🔶 del precedente bancario
—avisarle al dueño de la plata— que estaba sin decidir.
🔗 **Y esta entrada resultó ser la forma concreta de tapar el agujero que dejó el cierre
ciego**: el descuadre lo justifica hoy la misma persona que lo produjo y no lo revisa nadie
(ver la entrada de abajo). El umbral es el control **agudo** de ese agujero.
⚠️ **Secuencia, no orden de gusto: la tendencia por cajero va ANTES que esta entrada.** El
umbral necesita un número, y hoy nadie sabe si un descuadre típico de esta operación es de
\$200 o de \$8.000. Elegirlo a ojo falla de las dos maneras: bajo, y cada turno espera a un
encargado que no está; alto, y no atrapa nada. La distribución real la da la entrada de
abajo, que además **no toca el flujo de cierre** — a diferencia de esta.
✅ **Esa tendencia ya existe (2026-08-22): `/cajas/tendencia`.** O sea que **el bloqueo de
secuencia se levantó** — el número del umbral ya se puede elegir mirando la distribución
real en vez de a ojo. Lo que sigue faltando para tomar esta entrada es lo de siempre: el
cruce con el cierre forzado ya está decidido, y falta el aviso al cajero (🔶 arriba).
✅ **CONSTRUIDO 2026-08-23.** **Qué quedó:** dos umbrales por tenant
(`tenants.umbral_descuadre_aviso` / `umbral_descuadre_alto`, en Preferencias financieras,
Decimal.js y cuantizados a la moneda oficial, `'0'` = **apagado** — al revés que
`montoTolerancia`, y con validación de que el alto no baje del aviso). El nivel se mide
sobre la **|diferencia| de cada línea** del arqueo (nunca sobre el total, que deja que
−5.000 en efectivo y +5.000 en tarjeta se cancelen), "supera" es **estrictamente mayor**,
y se **congela** en la fase 1 del cierre (`cajas.nivel_descuadre`) sin recomputarse al
leer. **Ningún nivel bloquea**, ni siquiera el alto. El cajero deja su explicación libre
(`cajas.explicacion_descuadre`, distinta del motivo categorizado por línea) en la fase 2.
Bandeja `GET /caja/pendientes-revision` + `POST /caja/:id/revisar` (registra quién y
cuándo, rechaza el re-marcado con 400) + resumen `GET /caja/resumen-descuadres-dia`, todo
bajo `Cajas` y no `MiCaja`; pantalla `/cajas/pendientes-revision`. El cierre forzado pasa
por el mismo umbral, entra en la bandeja marcado como tal, y quien lo forzó puede marcarlo
visto quedando registrado. Doc:
[`features/gestion-cajas.md`](../features/gestion-cajas.md#umbral-de-descuadre-al-cierre--dos-niveles-ninguno-bloquea).
🔲 **Qué NO quedó:** el **envío diario** del resumen. No se construyó el envío —mailer y cron runner ya existen en el repo; el
dato se expone y la bandeja lo muestra al abrirla—; el envío programado es frente propio
(a quién, con qué frecuencia, qué pasa si falla). Tampoco quedó ninguna notificación en el
momento, que es lo que el owner explícitamente descartó. Y los umbrales de un tenant nuevo
nacen en `'0'` (apagados): **elegir el número sigue siendo del owner**, mirando
`/cajas/tendencia`; el seed los deja activos solo para que el demo muestre la feature.

### La entrada de "nadie lo revisa"

**El descuadre lo justifica quien lo produjo, y no lo revisa nadie** (producto +
backend) — **abierta el 2026-08-22**, al cerrar por descarte *"Ocultar el resultado
post-cierre al cajero"* (ver [`resueltos.md`](resueltos.md)). Es lo que sobrevivió de esa
preocupación una vez descartado el ocultamiento, y **es el agujero de verdad**: hoy el
cajero cuenta, se entera de su diferencia, elige él mismo el motivo, escribe él mismo la
explicación y cierra él mismo su caja. Queda registrado — pero **registrado no es
revisado**: alguien tiene que ir a buscarlo al historial, y nada le avisa que vaya. Un
cajero que descuadra \$3.000 por turno, siempre para el mismo lado y siempre con el mismo
motivo, atraviesa el flujo entero sin encender nada.
📌 **Precedente medido:** es exactamente lo que cubre la **"Conciliación de Caja"** de Fudo
—*esquema de doble control entre operador y supervisor*— y lo que cubre el umbral de Toast.
Ninguno de los dos exige que el cajero esté a ciegas
([§11.2](investigaciones/2026-07-23-gestion-caja.md#112-fudo-es-el-único-precedente-de-la-opción-solo-el-supervisor)).
✅ **La tendencia por cajero SE CONSTRUYÓ el 2026-08-22** — `GET /caja/tendencia` +
`/cajas/tendencia`, solo supervisión. Con eso el supervisor ya puede **ver** el sesgo:
suma con signo del efectivo, otros medios aparte, y conteos de faltante/sobrante/cuadrado,
ordenado por el faltante más grande arriba. Detalle en
[`features/gestion-cajas.md`](../features/gestion-cajas.md#tendencia-de-descuadres-por-cajero).
✅ **La otra mitad —que alguien REVISE— quedó decidida el 2026-08-23**, y con eso esta
entrada ya no tiene pregunta propia: se construye junto con el umbral, que es la entrada de
arriba. Lo que la cierra es que el cierre descuadrado **le queda al encargado en una bandeja
de pendientes de revisar, más un resumen diario** — o sea, algo que lo llama, en vez de
depender de que abra la pantalla de tendencia y sospeche primero. Y el cajero deja **su
explicación al cerrar**, así que la revisión llega con el contexto y no con un número pelado.
📌 Lo que sobrevive de esta entrada es el **porqué**, no trabajo aparte: sirve para no
construir el umbral como un número suelto. Ver el sesgo (la tendencia, ya construida) y que
algo llame a mirarlo (la bandeja) son las dos mitades del mismo control.
✅ **Las tres preguntas que quedaron anotadas al construir la tendencia, contestadas
(owner, 2026-08-23) — y las tres confirman lo que ya existe, así que no hay trabajo:**
la **ventana de 30 días** queda (un mes de turnos: alcanza para que un sesgo chico se note y
es corto para no arrastrar gente que ya no está); **una fila por cajero**, sin abrir por
cajón (la pregunta que importa es quién descuadra, y la lista se mantiene corta); y el
**promedio con signo sigue afuera**, que no era pregunta de producto sino consecuencia de que
un promedio de dinero es una división de dinero y arrastra la cuantización por moneda.
⚠️ El costo de "una fila por cajero", asumido: si un cajón tiene un problema propio —un
vuelto mal configurado, dos personas compartiéndolo— queda diluido entre los turnos buenos de
esa persona en otros cajones. Si algún día aparece esa sospecha, la salida es abrir por cajón,
no cambiar el default.
✅ **CONSTRUIDO 2026-08-23, junto con el umbral de arriba** (era su otra mitad, no trabajo
aparte). **Qué quedó:** el cierre descuadrado grande ya no depende de que alguien sospeche
y abra la pantalla de tendencia — le queda al encargado en la bandeja de pendientes de
revisar hasta que la marque visto, con la **explicación del cajero al lado** en vez de un
número pelado, y con el resumen del día arriba. Las dos mitades del control quedaron
cerradas: ver el sesgo (`/cajas/tendencia`, crónico) y que algo llame a mirarlo
(`/cajas/pendientes-revision`, agudo).
🔲 **Qué NO quedó:** nada llama al encargado **fuera de la app** — el envío diario sigue
siendo trabajo futuro (ver arriba). Mientras tanto, el control depende de que alguien abra
la bandeja: es rastro, no alarma, y eso fue asumido explícitamente.

---

## El modo ciego deja de prometer lo que no sostiene, y los oráculos dejan rastro (2026-08-23)

**Venía de la sección 3** («ya decidido, falta construir»). Mudada verbatim con su cierre;
los dos residuos que deja quedaron como entrada corta en `pendientes.md` §3.

🚩 **El modo ciego se evade desde afuera del módulo `caja`: seis fugas, dos demostradas
corriendo** (backend + producto) — **abierta el 2026-08-22** por una auditoría dirigida, el
mismo día en que el cierre de *"ocultar el resultado post-cierre"* afirmó —**mal**— que no
quedaba ninguna fuga antes del conteo (corregido en [`resueltos.md`](resueltos.md)).

**La causa raíz, que es lo que hay que decidir, no cada agujero suelto:** el predicado del
ciego (`!esAdmin && estado === 'abierta' && arqueoCiego`) **existe solo dentro de
`caja.service.ts`**. Ningún otro módulo sabe que el modo ciego existe, y `pagos` y `ventas`
sirven la misma plata por otro camino. El rasgo común de las seis es **no** nombrar al ciego,
así que grepear `getArqueoCiego` da una lista que parece exhaustiva y las deja a todas afuera.

**Demostradas contra el stack real** (no leídas):
1. 🔴 **`GET /pagos?cajaId=<la propia>&metodoPagoId=<efectivo>` da el esperado completo en UN
   request.** Medido: con el ciego activo y `esperado: null` en el arqueo, el cajero sumó
   `monto − vuelto` + el fondo y obtuvo **25.355**; el real era **25.355**. `listar` recibe
   solo `tenantId` (`pagos.service.ts`), **no valida propiedad de la caja**, y el rol
   `Vendedor` del seed tiene `Pagos:Leer` junto con `MiCaja` — es literalmente el cajero.
   ⚠️ Quitar el filtro `cajaId` **no alcanza**: cada fila devuelve `cajaId`, así que se agrupa
   del lado del cliente. Hay que decidir sobre el dato, no sobre el parámetro.
2. 🔴 **El 422 `"Saldo insuficiente en caja"` de `POST /caja/:id/movimientos` es un oráculo
   exacto.** Medido: **73.450 recuperados en 20 requests** por búsqueda binaria con retiros
   rechazados. Pide `MiCaja:Crear`, exige que la caja sea **suya** y esté **`abierta`** —la
   ventana exacta que el ciego protege— y el rechazo aborta la transacción, así que **no deja
   rastro**. Los intentos aceptados se compensan con una entrada del mismo monto.

**Encontradas por lectura, sin correr:**
3. `GET /ventas` + `GET /ventas/:id` (`Ventas:Leer`, también del rol Vendedor): el detalle
   trae `caja_id`, `monto` y `vuelto` de cada pago. **Mismo número, más requests** — tapar
   `/pagos` sin esto no cierra nada.
4. `GET /pagos/resumen` devuelve `montoHoy` de todo el tenant **sin ningún parámetro**. Ojo con
   qué es: `SUM(monto − vuelto)` **de todos los medios**, no solo efectivo. Con un cajón y un
   turno —el caso común— es el **cobrado total** de esa caja; para llegar al efectivo hay que
   restarle las líneas no-efectivo, que el punto 1 entrega.
5. **La NC en efectivo NO es un oráculo caro: imprime el número.** El 422 de
   `ventas.service.ts` interpola el monto en el mensaje —*"(disponible: 1234.5600)"*—, así que
   **un solo request rechazado** (monto = 1 sobre el techo) entrega el efectivo cobrado de esa
   venta **sin emitir ninguna NC y sin dejar rastro**. No hace falta búsqueda binaria.
   ⚠️ Lo que sí acota: es el efectivo de **esa venta**, no el esperado del turno — el chequeo
   de `devolvibleEfectivo` corre **antes** del `Saldo insuficiente en caja`, así que este
   camino no sirve para binarizar la caja entera. (Corregido el 2026-08-22 por la revisión
   independiente: la primera redacción de esta entrada le atribuía un costo de explotación
   mucho más alto del real, y eso la habría dejado abajo en la lista sin merecerlo.)
6. Los `400` de `POST /caja/:id/conteo` enumeran **qué medios** participaron (no montos). Es
   la misma lista que el ciego filtra, saliendo por otra puerta. Menor.

➕ **Anotado al pasar, para quien tome el frente** (no vale un frente propio): en
`caja.service.ts`, la fila cruda de la tendencia tipa `usuario_id: string` cuando
`Caja.usuarioId` es `nullable: true` y su vecino `historial` lo tipa `string | null`. Hoy es
inalcanzable porque el filtro `tipo = 'fisica'` lo impide, pero si entrara un NULL la fila
navegaría a `/cajas/historial?usuarioId=null` sin error visible. Una línea.

📌 **Reencuadre medido el 2026-08-22, y es lo que hay que mirar antes de decidir: esto no es
un problema del modo ciego, es que `ventas` y `pagos` NO TIENEN NINGÚN NIVEL DE VISIBILIDAD
POR USUARIO.** `caja` sí tiene el modelo de dos niveles —`MiCaja` (la mía) contra `Cajas`
(todas), resuelto en `resolverLecturaCompartida` y con chequeos de `usuarioId` explícitos en
`historial`, `listarMovimientos` y `verificarAccesoCaja`—. En `ventas` y `pagos` **no existe
el eje**: `listar(tenantId, query)`, `findOne(tenantId, ventaId)` y `resumen(tenantId)` no
reciben `usuarioId` ni lo consultan. Un cajero con `Ventas:Leer` ve **todas** las ventas del
tenant; con `Pagos:Leer`, **todos** los pagos. El modo ciego solo hizo visible esa asimetría.
⚠️ Corolario práctico: tapar el modo ciego endpoint por endpoint es tratar el síntoma. La
pregunta de fondo es si `ventas`/`pagos` deben tener el mismo eje "mío/todos" que `caja`.

➕ **Dato que achica una parte del problema sin código: el POS no usa `Pagos:Leer`.**
`ventas/pos.vue` solo llama a `items`, `metodos-pago`, `tipos-documento` y `POST /ventas` —
cero llamadas a `/pagos`. O sea que `Pagos:Leer` en el rol Vendedor del seed **parece
incidental**, y sacarlo cerraría las fugas 1 y 4 sin tocar una línea de lógica. ⚠️ **No
cierra la 3**, que va por `Ventas:Leer` — permiso que el cajero sí necesita para cobrar una
venta pendiente. Verificar antes de sacarlo si algún otro flujo del cajero lo usa.

ℹ️ Nota sobre el frontend: `ventas/index.vue`, `ventas/pos.vue` y `pagos/index.vue` **no
declaran `permiso` en `definePageMeta`** —solo `middleware: 'auth'`—, así que el único gate
real es el guard del backend. Correcto según la invariante 6, pero significa que cualquier
cambio de alcance hay que hacerlo en el backend: esconder el link del nav no hace nada.

🛑 **La pregunta para el owner, antes de tocar nada — y no es "arreglemos las seis":**
el esperado **no es un secreto guardable**, es una cuenta que el sistema tiene que hacer para
operar, y toda validación o listado que toque la plata del turno lo filtra. Taparlas de a una
es whack-a-mole. Hay que elegir qué promete el ciego:
- **(a) "el cajero no puede ver el número"** — exige tocar `pagos`, `ventas`, el resumen y los
  dos oráculos. Y el oráculo del retiro **no se puede cerrar sin romper el chequeo de saldo
  insuficiente**, que existe por una razón legítima: hoy impide retirar plata que no está.
- **(b) "el cajero no puede verlo sin dejar rastro"** — se resuelve con **auditoría** en vez
  de ocultamiento: registrar quién consultó qué del turno en curso, y que el supervisor lo
  vea. Cambia el control de preventivo a detectivo, que es lo mismo que ya se eligió para el
  cierre forzado.
- **(c) aceptar que el ciego es fricción y no barrera**, y decirlo en la doc en vez de
  prometer un control que no se sostiene.

✅ **EL EJE SE CONSTRUYÓ el 2026-08-22**, y cierra la **dimensión cruzada** de las fugas 1, 3
y 4: un cajero sin `Cajas:Leer` ya no ve la actividad de **otros**. Medido después de
construirlo: el admin ve 87 pagos de 18 cajas, el cajero ve 3, de las 2 suyas. El detalle de
una venta ajena responde 404. Lo fija `visibilidad-ventas-pagos.e2e-spec.ts`, y el mutante
que devuelve alcance completo hace fallar los cuatro tests que codifican la fuga. Ver
[`features/pagos.md`](../features/pagos.md) y [`patterns/backend.md` §16](../patterns/backend.md).

⛔ **PERO NO CIERRA LA FUGA 1 CONTRA LA CAJA PROPIA, Y NO PUEDE.** Se verificó corriendo el
mismo script de la demostración **después** de construir el eje: el cajero sumó sus propios
pagos en efectivo y volvió a deducir el esperado exacto de su caja (20.357 contra 20.357).
Y está bien que pueda: **esos pagos son suyos, los cobró él**. Cerrarlo exigiría quitarle su
propio historial de ventas, que es exactamente la aritmética que hizo descartar el
ocultamiento en
[§11.3](investigaciones/2026-07-23-gestion-caja.md#113-cruce-contra-nuestro-código--dos-hechos-que-el-mercado-no-podía-darnos).
Lo mismo vale para la 4: `montoHoy` acotado a sus cajas sigue siendo su propio cobrado.

🔴 **Consecuencia, y es la conclusión del frente entero: el modo ciego NO es sostenible como
"el cajero no puede saber el esperado".** Contra la cuenta propia es **fricción, no barrera** —
la salida (c) de las tres que se ofrecieron el 2026-08-22 resultó ser la verdad para esa
dimensión, se eligiera lo que se eligiera para el resto. Lo que el ciego **sí** sostiene, y
ahora es cierto donde antes no lo era, es *"el cajero no ve la plata de otros"*.
⏳ **Sigue sin hacerse:** el rastro de los oráculos (fugas 2 y 5, decisión 2 de abajo), la
enumeración de medios (6), y **decidir qué dice la doc del modo ciego** ahora que se sabe que
contra la caja propia no promete lo que parecía prometer.

✅ **DECIDIDO POR EL OWNER (2026-08-22), las dos:**
1. **`ventas` y `pagos` reciben el eje "mío/todos", igual que `caja`.** El cajero ve solo lo
   suyo; el listado completo pasa a ser de supervisión. Cierra de raíz las fugas 1, 3 y 4, y
   arregla algo más grande que el modo ciego: hoy cualquier cajero ve la facturación entera
   del local.
2. **Los dos oráculos se resuelven con RASTRO, no con ocultamiento.** Se registra el intento
   rechazado —quién, cuándo, con qué monto— y el supervisor lo ve; el chequeo de saldo
   insuficiente queda intacto, porque existe para impedir retirar plata que no está. El
   control pasa de preventivo a detectivo, igual que lo ya elegido para el cierre forzado.
   Veinte retiros rechazados en dos minutos es una firma inconfundible.

⚠️ **Restricción medida que condiciona el diseño del punto 1: ni `ventas` ni `pagos` guardan
quién los hizo.** `venta` tiene `caja_id` y `canal`, pero **no** un `usuario_id`/`creado_por`
(solo `cancelada_por_usuario_id`); `pago` tiene `caja_id` y nada más. Así que "lo mío" **se
deriva por la caja** (`venta.caja_id → cajas.usuario_id`), que para una venta física es
exacto —la caja está abierta para un solo usuario—. Lo que queda sin regla es la venta
**online**, que va contra la caja virtual del tenant y por lo tanto **no tiene dueño**: hay
que decidir si el cajero las ve, no las ve, o las ve solo quien tenga supervisión. Diseño en
[`specs/2026-08-22-visibilidad-ventas-pagos-design.md`](../superpowers/specs/2026-08-22-visibilidad-ventas-pagos-design.md).

⚠️ **Ordena el frente del historial:** bloquear el historial de cajas del cajero (pedido el
2026-08-22) **no compra nada mientras estas estén abiertas**. El historial es el acumulado de
turnos pasados; esto es el esperado del turno **en curso**, que es lo que el ciego existe para
proteger. Va después de decidir (a)/(b)/(c), no antes.

✅ **CONSTRUIDO 2026-08-23 — la decisión 2 (rastro) y las fugas 6 y la nota menor. Lo que
quedó:**
- **Fuga 2 y fuga 5 → `caja_intentos_rechazados`.** Se registra el intento rechazado —quién,
  cuándo, qué caja, cuánto pidió, y la venta en el caso de la NC— en los tres bordes que
  rechazan por falta de plata: el retiro con saldo insuficiente
  (`caja.service.ts` → `registrarMovimiento`) y los dos de la NC en efectivo
  (`ventas.service.ts`, el tope de `devolvibleEfectivo` y el saldo de caja). **No guarda el
  disponible**, que era justo el dato que filtraba. Los chequeos quedaron **intactos**.
- **El mensaje de la fuga 5 perdió el número.** El `422` ya no interpola
  `(disponible: 1234.5600)` — era un oráculo de UN request. El tope, el monto de la NC y la
  semántica del documento no se tocaron.
- **Cómo sobrevive al rollback, que es lo que costaba decidir:** `catch` en el BORDE, por
  fuera de `db.transaccion` (`CajaService.conRastroDeRechazo`). Cuando corre, TypeORM ya
  deshizo y ya devolvió la conexión al pool: no se toma una segunda conexión simultánea, que
  es el deadlock de **ADR-020**. `db.sinTransaccion` envuelve la escritura igual, como red
  por si un llamador envuelve la operación en una transacción propia (ahí `db.transaccion`
  la reusa y el rollback no ocurre en ese nivel). ⚠️ Y por lo mismo la tabla **no declara
  FKs**: un FK pide `FOR KEY SHARE` sobre la fila que la transacción moribunda retiene con
  `FOR UPDATE`, y se esperan mutuamente. Es el primer uso real de `sinTransaccion`
  (`patterns/backend.md` §9 actualizado).
- **Fuga 6 cerrada:** el `400` de `POST /caja/:id/conteo` ya no nombra el medio cuando el
  ciego aplica al usuario (mismo predicado: no admin + abierta + `arqueo_ciego`).
- **Lectura del supervisor:** `GET /caja/intentos-rechazados?cajaId=&usuarioId=`
  (`Cajas:Leer` a secas, **sin** versión "los míos" — el vigilado no ve su propio ruido) y
  `CajaIntentosRechazados.vue` en `/cajas/:id`.
- **La nota menor:** `usuario_id` de la fila cruda de la tendencia pasó a `string | null`, y
  con eso `CajaTendencia.vue` dejó de poder navegar a `?usuarioId=null`.
- **La doc del modo ciego quedó reescrita** con la conclusión del frente
  ([`features/gestion-cajas.md` → *Qué promete el modo ciego, y qué NO*](../features/gestion-cajas.md#qué-promete-el-modo-ciego-y-qué-no-revisado-2026-08-23)):
  *"el cajero no ve la plata de otros"* se sostiene; *"el cajero no puede saber su propio
  esperado"* es **fricción, no barrera**; el control sobre los oráculos es **detectivo**.
- Lo fija `rastro-intentos-rechazados.e2e-spec.ts` (el rollback real: el movimiento no queda
  y el intento sí) más los unit de `caja.service.spec.ts` / `ventas.service.spec.ts`. Dos
  mutantes verificados: sin el envoltorio caen 2 tests; sin `sinTransaccion` cae el que fija
  el orden rollback→rastro.

⏳ **Lo que esta entrada deja abierto:** el frente del historial de cajas del cajero (párrafo
de arriba) ya no está bloqueado por "decidir (a)/(b)/(c)" — la salida (c) para la caja propia
y el rastro para los oráculos ya están. Y el `400` *"Método de pago no pertenece al arqueo"*
sigue siendo un oráculo de presencia por medio, pero **cada sondeo exitoso cierra la caja**,
así que es de un solo uso y no se tocó.

---

## El checkbox de anulación nace destildado si algo ya salió a cocina (2026-08-23)

**Venía de la sección 3** («ya decidido, falta construir»). Mudada verbatim con su cierre.

**El default del checkbox de anulación cuando la línea ya se despachó a cocina**
(backend + frontend, decisión 2 del owner del 2026-08-15; **pieza C** de la entrada
*"anular una venta con recetas no repone"*, cerrada el 2026-08-22 →
[`resueltos.md`](resueltos.md)) — el checkbox *"Reponer el stock que la venta descontó"*
nace **siempre tildado** (`AnularVentaModal.vue:19`, y `:27` lo re-tilda al abrir). La
decisión: si la línea **ya se despachó a cocina** el plato se hizo, así que nace
**destildado**; si no se envió nada, sigue tildado. El aporte del owner que lo motivó:
reponer comida servida mete stock que físicamente no existe, y eso es peor que no
reponer.
⚠️ **La partición de la entrada madre decía *"C quedó barata: es solo el default del
checkbox"*, y al abrirla el 2026-08-22 resultó falso.** El modal recibe **únicamente
`ventaId`** —no conoce ninguna línea— y `cantidad_enviada` existe **solo** en
`cuenta_lineas` (`cuenta-linea.entity.ts:55`), nunca en `venta_detalles`: grep del
backend entero, la única otra aparición es el DTO de comanda. Se llega por
`cuenta.venta_id` (`cuenta.entity.ts:40`), así que la pieza es **una lectura nueva de
backend + exponerla en el payload de la venta**, acoplando ventas→salones. No es un
`ref(false)`.
**Lo que falta decidir al construirla, y no está contestado:** una venta de POS no viene
de ninguna cuenta (no hay comanda que consultar), y una venta de salón puede tener unas
líneas despachadas y otras no. ¿El default es "destildado si **alguna** línea se
despachó", o el checkbox deja de ser uno solo para toda la venta?

✅ **CONSTRUIDO 2026-08-23.** La pregunta la contestó el owner el mismo día: **un solo
checkbox para toda la venta, destildado si ALGUNA línea se despachó**; el cajero lo tilda
igual si la mercadería sigue vendible (es un default, no un bloqueo), y la venta de POS
—que no viene de ninguna cuenta— sigue naciendo tildada. Partirlo por línea sería más fino
y menos usable: se está anulando la venta entera, no reconciliando el inventario plato por
plato.
**Cómo quedó:** `GET /ventas/:id` expone `tieneLineasDespachadas`, resuelto con un `EXISTS`
**dentro de la misma consulta de la cabecera** (`cuentas` → `cuenta_lineas` con
`cantidad_enviada > 0`, filtrando `eliminado_el` en las dos y correlacionando por
`cuentas.venta_id`), así que no agrega ni una ida a la base ni toca el alcance "mío/todos"
que ya aplicaba `findOne`. El modal lo recibe como prop **del detalle que la pantalla ya
carga** —sin segunda llamada— y muestra al lado por qué. Esa consulta es el primer lector
de `cuentas.venta_id`, así que la columna estrenó índice (`idx_cuentas_venta`).
📌 **El backend de la anulación no cambió:** sigue haciendo lo que `reponerStock` diga. Lo
que se movió es qué llega marcado por default a la pantalla.
Regla en [`features/ventas.md`](../features/ventas.md) y
[`PRODUCTO.md`](../PRODUCTO.md); el puente desde salones, en
[`features/salones-mesas.md`](../features/salones-mesas.md).

---

## El tenant `MiCaja`-only: descartado, son el mismo módulo partido por audiencia (2026-08-22)

**Lo levantó la revisión independiente** del diff del eje de visibilidad: la rama 2 de
`resolverAlcanceDerivadoDeCaja` pregunta solo por el módulo `Cajas`, así que un tenant con
`MiCaja` y sin `Cajas` —que sí tiene cajones físicos y puede tener varios cajeros— se queda sin
eje, y ahí todos ven la facturación de todos.

**La respuesta del owner mueve la pregunta de lugar:** `MiCaja` y `Cajas` **no son dos
productos**. Son el mismo módulo partido por audiencia —uno es el cajero operando su turno, el
otro la supervisión de las cajas ajenas— y **se venden juntos, con `Ventas` presencial**;
sueltos no sirven. Con eso, el único tenant que cae en la rama 2 es el que no tiene ninguno de
los dos: la tienda **solo online**, que es literalmente la justificación con la que la rama se
escribió. El caso que levantó la revisión es **hipotético**.

**Por qué el split en dos módulos se queda igual:** no está haciendo trabajo comercial, está
haciendo trabajo de **permisos**. Es lo que hace expresable el eje — `Cajas:Leer` sirve de señal
de supervisión precisamente porque `Cajas` es un módulo que el tenant puede tener o no. Unirlos
obligaría a mover esa distinción entera adentro de un módulo y a que el eje pregunte otra cosa:
arquitectura nueva para un problema que no existe.

**Dos datos que se midieron en el camino y corrigen la entrada original:**

1. **No hay downgrade silencioso.** La entrada decía que dar de baja el contrato de `Cajas`
   concede visibilidad total. Hay `POST /admin/tenants/:id/modules` para agregar (y el
   listado vive aparte, en `GET /api/tenants/modules`, del lado del tenant activo), pero
   **no hay ninguna baja**: `tenantModuloRepo` solo tiene `create`/`save` y `find` en todo `src/`: solo pasaría tocando la base a mano.
2. **El alta de tenant no contrata ningún módulo.** Crea el rol admin, la fórmula de precio y la
   caja virtual, y `tenant_modulos` arranca vacío. O sea que "se venden juntos" es una
   **convención comercial que nada en el código sostiene**, y el riesgo real que queda es el
   descuido al aprovisionar, no un paquete que exista.

**Qué se hizo, decidido por el owner:** dejar la regla como está, y cerrar el hueco de
verificación en vez del hipotético.

- **`backend/test/visibilidad-tenant-sin-cajas.e2e-spec.ts`** (nuevo): los dos tenants del seed
  contratan `Cajas`, así que **la rama 2 no la ejercía nadie**. El test crea el tenant con
  `Ventas` y `Pagos` y ningún módulo de caja, y fija que su admin **no queda bloqueado** —que es
  la regresión que de verdad se cometió: la primera versión del eje lanzaba `403` y ahí le
  pegaba a todo el mundo, sin arreglo posible por configuración—. El segundo `it` comprueba, en
  vez de asumir, que `Cajas:Leer` es inobtenible en ese tenant.
  ⚠️ **Verificado con mutante**, no solo "pasa": volviendo el controller a la variante que lanza
  (`resolverAlcanceCaja`, el código anterior al arreglo) el test se pone rojo con
  `["/api/ventas", 403]` contra `200`. Lo que **no** puede fijar, y está dicho en el archivo:
  que "ve todo" en vez de "ve lo suyo" — con un solo usuario las dos ramas devuelven lo mismo, y
  un segundo usuario exige el flujo de invitación. Esa distinción ya vive en `rbac.service.spec.ts`.
- **`docs/features/ventas.md`**: queda escrita la convención (van juntos, y con `Ventas`), por
  qué el split es de permisos y no comercial, y el aviso de que nada en el código la sostiene.
  Se decidió **no** codificar la dependencia entre módulos: el catálogo hoy no la tiene.

---

## Ocultarle el resultado al cajero se descarta: pelea contra la aritmética, y contra el propio cierre (2026-08-22)

Cierra la entrada *"Ocultar el resultado post-cierre al cajero"*. **Se cierra por descarte,
no por implementación** — es la primera de este archivo que sale así, y por eso el
razonamiento va completo: sin él, dentro de seis meses esto vuelve como idea nueva.

### De qué venía

Estaba **decidido al revés**. El 2026-08-11 el owner resolvió *"la diferencia la ve solo el
supervisor"*, aceptando explícitamente el costo de que un error de conteo de buena fe ya no
se corrija en el momento. Se intentó el **2026-08-16**, el gate quedó en verde, y la
revisión independiente encontró que faltaba justo la superficie principal. **Se revirtió.**
El intento dejó medida esta tabla, que sigue siendo el mapa correcto de por dónde se filtra:

| Superficie | Qué revela | ¿La entrada la nombraba? |
|---|---|---|
| `obtenerArqueo` | `esperado` y `diferencia` por línea | sí |
| `resumenMovimientos` | `saldoEsperado` del turno | sí |
| `listarMovimientos` | las filas con las que se **reconstruye** el esperado sumando | no |
| `enviarConteo` | devuelve `arqueo` con `esperado`/`diferencia` reales | no |
| `cerrar` | llama a `obtenerArqueo` **hardcodeando `tieneVerTodas: true`** | no |

Y quedó bloqueada en una pregunta de producto: la fase 2 exige un motivo por línea
descuadrada, y el selector solo se renderiza `if (l.diferencia != null && !isZero())`. Si al
cajero se le oculta la diferencia, **no puede completar el cierre de su propia caja**.

### Qué cambió desde entonces

**Una corrección de hecho:** la entrada afirmaba que el panel de resumen del turno seguía
mostrando el esperado. Ya no — lo cerró `8571b8b3`. Hoy las cuatro superficies de lectura
comparten **el mismo predicado**, `!esAdmin && estado === 'abierta' && arqueoCiego`. Lo único
abierto **dentro del módulo `caja`** era la revelación **después** del conteo, que es
exactamente lo que esta entrada pedía tapar.

⛔ **Corrección del 2026-08-22, el mismo día: esta entrada decía "no queda ninguna fuga antes
del conteo" y ERA FALSO.** Una auditoría dirigida encontró seis fugas fuera del módulo `caja`,
dos de ellas demostradas corriendo: `GET /pagos?cajaId=…&metodoPagoId=…` devuelve el esperado
completo en **un** request al cajero (que tiene `Pagos:Leer` por el rol Vendedor del seed), y
el 422 *"Saldo insuficiente en caja"* de `POST /caja/:id/movimientos` es un **oráculo** que lo
entrega en 20 requests por búsqueda binaria, sin dejar rastro. La causa de que la afirmación
saliera mal vale más que el dato: **el predicado del ciego existe solo dentro de
`caja.service.ts`**, y el rasgo que define a esas seis fugas es justamente **no** mencionarlo
—`pagos` y `ventas` sirven la misma plata sin enterarse de que el modo ciego existe—. Verificar
"las cuatro superficies" era verificar el mecanismo, no la conducta. Frente propio en
[`pendientes.md`](pendientes.md).

**Y una pasada de investigación** ([§11](investigaciones/2026-07-23-gestion-caja.md#11-cuándo-se-revela-el-descuadre-y-a-quién-2026-08-22-5ª-pasada),
doce productos relevados, internacional + CL/LatAm).

### Las dos razones del descarte

**1. Ocultar el resultado solo funciona si se oculta para siempre.** El esperado no es un
secreto: es `saldo inicial + ventas en efectivo − retiros`. Cerrada la caja, el cajero lista
los movimientos de su propio turno y **los suma** — la tercera fila de la tabla de arriba.
Así que "solo el supervisor" no es tapar un número: es *"el cajero nunca más ve el historial
de movimientos de su propio turno"*, mucho más grande de lo que la entrada planteó, y rompe
algo legítimo. Y aun así, quien trabajó el turno entero puede llevar la cuenta aparte.
**El control es evadible por aritmética.**

**2. Revelar y poder cerrar son el mismo dato.** La carga que revela es la que la fase 2
necesita para existir: sin `diferencia`, el `descuadres` del drawer queda vacío, no hay línea
que justificar, el botón no se habilita y la caja se queda en `en_conciliacion` para siempre.
No es un detalle de implementación — es el diseño.

**El mercado converge:** Toast (`3.17 Cash Drawers (Blind)`) oculta el *expected* pero muestra
`Cash over`/`Cash short` en el mismo Shift Review; Simphony deja que el propio operador elija
el motivo; Square, Defontana y mySYSTEM revelan al mismo cajero. **mySYSTEM es el más
explícito**: lo ciego es no ver el esperado **antes** de contar, no ocultar la diferencia
después. El único precedente contrario es **Fudo**, y ahí lo distinto no es el ocultamiento
sino el **paso de revisión** (§11.2).

⚠️ **Y la teoría que sostenía la decisión del 2026-08-11 no está documentada por nadie.** El
argumento de calibración —*"si no sabe si zafó, no puede calibrar cuánto robar"*— aparece
**solo en marketing** (blogs de Toast y Clover), en ninguna doc de configuración de los siete
productos con documentación accesible.

### Qué sobrevive, y dónde quedó

**El agujero real no era que el cajero viera su diferencia: es que su justificación no la
revisa nadie.** Cuenta, se entera, elige el motivo, escribe la explicación y cierra — el
descuadre queda justificado por la misma persona que lo produjo. Eso quedó como **entrada
propia** en [`pendientes.md`](pendientes.md), con la tendencia por cajero como primer paso
(barata, no toca el flujo de cierre, y es lo que permite elegir el número del umbral con
fundamento en vez de a ojo).

**Sin código.** El comportamiento actual ya era el correcto; lo que faltaba era saberlo.

---

## El cuaderno de anti-patrones vuelve a su tope, con dos fusiones y ningún borrado (2026-08-22)

Cierra la entrada *"El cuaderno de anti-patrones excede su propio tope"*. `anti-patterns.md`
tenía **22** entradas `### ❌` y su propia regla 3 fija el tope en **20**. La entrada estaba
diferida porque aplicar esa regla pide juzgar bugs ajenos, y hacerlo de arrastre dentro de
otra tarea era el atajo equivocado.

### Lo que la regla manda, en orden, y qué dio cada paso

1. **Pasar a `✅` lo automatizado** — no dio nada, y ese fue el hallazgo. El candidato obvio
   era *"campo que escribe estado derivado sin pasar por su choke point"*, que tiene un test
   de invariante corriendo en el gate y en CI. Pero **la propia entrada documenta el hueco**:
   ese test es una heurística de texto sobre SQL crudo y no vería una escritura hecha vía el
   `Repository<ItemProducto>` con la propiedad camelCase. Marcarla automatizada sería
   sobreafirmar justo en un archivo cuyo propósito es no mentirle al que lo lee.
   Mismo razonamiento para *"borrado físico de filas"*: el hook ataja el `DELETE FROM`, pero
   la otra mitad —que toda lectura filtre `eliminado_el IS NULL`— es juicio, y `CLAUDE.md` ya
   dice que un hook no la puede evaluar.
2. **Fusionar caras del mismo error** — dio las dos que faltaban:
   - **Las dos caras del repo proxy de ADR-020**: congelar una referencia de método (se queda
     con el pool creyendo estar en la transacción) y omitir el `manager?` opcional (se queda
     en la transacción creyendo estar afuera). Es el mismo malentendido —qué conexión
     resuelve el proxy, y cuándo— en direcciones opuestas.
   - ***"Aserción que no puede fallar"*** pasó a ser el caso **(d)** de *"test verde que no
     ejerce lo que dice probar"*, que ya coleccionaba tres caras.
3. **Borrar la más antigua sin reincidencia** — no hizo falta.

Quedó en **20 exactas, sin perder una línea**: los cuatro ejemplos se mudaron verbatim. Es el
mismo resultado que la primera aplicación de la regla (2026-08-11, de 25 a 20), y la nota de
la regla 3 quedó actualizada con las dos pasadas y con el porqué de la conversión que no se
hizo.

---

## Los campos de costo dejan de mentir sobre cuántos decimales admiten (2026-08-22)

Cierra dos de las tres mitades de la entrada *"`mermas` y `grupos-modificadores` siguen sin
`MoneyInput`, y re-migrarlos no es mecánico"*. La tercera —`grupos-modificadores`— sigue
abierta y por una razón que no es de implementación: esa pantalla no tiene ninguna moneda a
mano y sus opciones aplican a ítems en monedas distintas. Quedó reescrita en
[`pendientes.md`](pendientes.md) con la pregunta que la destraba.

### Lo que la entrada decía y no era

Decía que para `mermas` *"hay que agregar `monedaId` al endpoint que alimenta el selector de
productos"*. **El endpoint ya lo devuelve** (`items.service.ts:220`, `GET /items`): lo que
faltaba era declararlo en la interfaz `ProductoOpt` del frontend. Cero backend.

### Y lo que la entrada no decía, que era lo importante

Nombraba como daño colateral *"los campos de costo de `items.vue` (`form.costo`,
`precioExtra`)"*. Al medirlo son **los seis** `MoneyInput` de esa pantalla, `precioBase`
incluido: el DTO lo valida con `@EsCosto()` y no con `@EsMontoCobrado()`, porque el precio de
lista es dinero **por unidad** —una tasa— y la frontera tasa→monto se cruza al multiplicar
por la cantidad. O sea que en un ítem CLP la pantalla entera admitía 0 decimales mientras el
backend admitía 4: un costo de `5,0500`/g era válido y no se podía tipear.

### Un cambio de conducta que hay que saber

En `mermas`, el campo de costo queda **deshabilitado hasta elegir un producto**: `MoneyInput`
se deshabilita solo cuando no puede resolver la moneda (`:disabled="disabled || !cfg"`), y la
moneda sale del producto seleccionado. No es una trampa —`items.moneda_id` es `NOT NULL`, así
que ningún producto puede dejarlo deshabilitado para siempre— y en el flujo real no se pierde
nada: elegir el producto **prefillea** el costo, así que lo tecleado antes se perdía igual.

### El guard es sobre el fuente, a propósito

El test nuevo lee `items.vue` y exige que **todo** `<MoneyInput` de esa pantalla lleve
`:decimales="4"`. Un test que monta la pantalla solo vería los campos ya dibujados, y lo que
hay que evitar es que el **próximo** campo de dinero nazca sin el prop. Cuenta aperturas de
tag para no contar de más si alguien lo menciona en un comentario.
**Validado revirtiendo**: sin el fix falla listando los 6 tags.

---

## La gestión de garzones la habilitan Salones **o** Propinas (2026-08-22)

Cierra la entrada *"El garzón «Mostrador» pasa a colgar del módulo `Propinas`"* (medida el
2026-08-16, decidida el 2026-08-22). **La decisión se ejecutó con una corrección**, y el
owner la confirmó antes de escribir código.

### Por qué no se mudó a `Propinas`, que era lo decidido

Mudarlo rompía el caso espejo: un tenant con mesas y **sin** el módulo de propinas dejaba de
poder crear garzones y asignarles PIN, y el rol sembrado `Salones · Encargado` —descrito
literalmente como *"administra garzones y salones"*— perdía la mitad. **El e2e no lo habría
cazado**: Paris tiene los dos módulos contratados, así que la suite quedaba verde por el
motivo equivocado, que es exactamente lo que la entrada pedía evitar con el parche del seed.

El garzón no es una entidad de salones que las propinas usan de prestado: lo crea el alta de
**todo** tenant (`asegurarMostrador`), atiende mesas y cobra propinas. Colgarlo de un solo
módulo es lo que produjo el problema; elegir el otro lo produce al revés.

### El síntoma real era peor que el de la entrada

La entrada decía que el tenant no podía administrar la fila que el sistema le creó. Medido:
`frontend/app/pages/propinas/index.vue` —la pantalla de liquidación, del módulo `Propinas`—
llama a `GET /garzones`, que pedía `Salones:Leer`. Un tenant con Propinas y sin Salones **no
podía abrir su propia pantalla de propinas**.

### Lo construido

- **`@RequiresAlgunPermiso(...)`**: alternativas, alcanza con una. La metadata de
  `@RequiresPermiso` pasó a ser **siempre una lista** (aunque 152 de 153 rutas tengan un solo
  par) para que el guard tenga una sola forma que leer en vez de ramificar por el shape de su
  propia metadata. El guard corta en la primera alternativa que da.
- **Las 10 rutas eran dos grupos, no uno.** Las 8 de administración aceptan los dos módulos;
  `verificar-pin`, `mi-vinculo` y `para-selector` **siguen pidiendo `Salones:Operar`**: son el
  teclado de PIN de la pantalla del salón. El POS no las usa —la propina directa no toca
  ninguna ruta de garzones, el backend resuelve el Mostrador dentro de la venta—.
- **`Propinas:Crear/Actualizar/Eliminar`**, que no existían: el módulo solo tenía `Leer`,
  `Configurar` y `Liquidar`. Sin esas filas un rol no-admin no puede recibir el permiso (al
  admin le alcanza con el módulo contratado, por el short-circuit de `es_fijo`).
- **El parche del seed, revertido en el mismo commit**, como pedía la entrada: Demo Bodega
  deja de contratar `Salones` —una bodega sin mesas— y pasa a contratar `Propinas`, que es lo
  que de verdad usa.
- **Frontend**: `usePermisosCrud` acepta una lista de módulos, con la misma semántica de
  "alcanza con uno", y la pantalla de garzones pasa `['Salones', 'Propinas']`.

### El detalle del seed que la entrada contaba mal

Decía que el parche se le había puesto *"a **Demo Bodega** y a **Falabella**"*. Es **un solo
tenant**: `550e8400-…-440040` se llama "Demo Bodega", su correo es `@falabella.cl` y la
constante del seeder se llama `FALABELLA`. Un solo contrato que revertir, no dos.

### Los tests, y el que hubo que dar vuelta

- Spec nueva de `PermisosGuard` (6 casos), que **no tenía spec propia**: el guard que sostiene
  la invariante 6 se probaba solo de rebote por e2e.
- Dos e2e en `modulo-contratado-borde-duro.e2e-spec.ts`: el tenant con Propinas y sin Salones
  gestiona su garzón, y —la otra mitad— el rol `Salones · Encargado`, que no tiene ningún
  permiso de Propinas, sigue pudiendo. **Validado con mutante**: revirtiendo solo el decorador
  de `GET /garzones` el primero falla.
- ⚠️ **Esa suite estaba construida sobre "Demo Bodega NO tiene Propinas"**, que es justo lo
  que este cambio da vuelta. Se le cambió el módulo de ejemplo a `Salones`, que ahora es el que
  Demo Bodega no tiene. La propiedad que fija no cambió; cambió cuál de los dos módulos la
  ilustra.
- ⚠️ **Y tres asserts de `caja.controller.spec.ts` comparaban la metadata contra un objeto
  pelado.** Con la metadata vuelta lista, el `not.toEqual({...})` de uno de ellos pasaba
  **siempre** —una lista nunca es igual a un objeto— y dejaba de proteger nada. Se pasó a
  `not.toContainEqual`.

---

## Los recargos por escalones de monto existen (2026-08-22)

Cierra la **parte 1** de la entrada *"La plomería de tramos en `recargos` es alcanzable y no
significa nada"*. La parte 2 (`mora` y `recargo_metodo_pago`) sigue en
[`pendientes.md`](pendientes.md), reescrita para ser solo eso.

La entrada nació como limpieza —sacar plomería muerta— y el owner la dio vuelta el
2026-08-11: **no se borra, se construye.** Recargos por escalones, igual que los descuentos.

### Lo construido

- **`recargo_por_monto_venta`**, tipo nuevo en `seedTiposRegla`
  (`550e8400-e29b-41d4-a716-446655440353`), espejo del `por_monto_venta` de descuentos.
- **`TIPOS_CON_TRAMOS` en `recargos.service.ts`**, donde antes había un comentario
  explicando que a propósito no existía. Exige tramos al crear **y al cambiar el tipo por
  `PATCH`**: sin lo segundo, mover una regla a este tipo la dejaba sin ningún escalón y el
  motor no le cobraba nada. El tipo **no** entra en `TIPOS_CON_VALOR_UNICO` — el monto lo
  dicen los tramos.
- **`RECARGO_CONFIG`** en el frontend + la lista espejo de `reglas-form-config.spec.ts`, que
  es lo único que caza que un código del seed se quede sin entrada en el mapa.
- **Seed demo**: "Recargo por pedido chico" con dos tramos ($2.000 bajo $20.000, $500
  arriba), sin asociar a ningún ítem para no mover ninguna venta del seed.

### El motor no se tocó, y eso estaba medido antes de escribir

`evaluarRegla` ramifica por `tramos.length > 0` sin mirar la clase, y un código que no está
en `DIFERIDAS` ni en `METODO_PAGO_CODIGOS` llega a esa rama con la magnitud del monto. El
e2e lo prueba por el camino de la app y no leyendo el `if`: el mismo ítem calcula **$2.000
de recargo con cantidad 1** ($1.000 de monto) y **$500 con cantidad 30** ($30.000).

### Lo que apareció al construirlo

Dos límites de forma que la entrada no nombraba, y que juntos dejan afuera el caso más
típico: los tramos son **abiertos hacia arriba** (solo `minimo`) y su `valor` tiene que ser
**mayor a cero**. O sea que un recargo escalonado puede bajar pero **no llegar a cero**:
*"envío gratis sobre $20.000"* no se puede expresar. No se tocó ninguna de las dos reglas
—las comparte descuentos y son decisión de producto—; quedó como entrada propia.

Además, `features/descuentos-recargos.md` afirmaba que los tramos tenían `maximo` nullable.
**Nunca existió**, ni en las entidades ni en `startup-pos.sql`. Corregido.

### Los tests

Tres unit en `recargos.service.spec.ts` y dos e2e en `reglas-valor.e2e-spec.ts`.
⚠️ Uno de los unit **pasaba antes de escribir el código**, y se reescribió por eso: probaba
un `PATCH` con `tramos: []`, que la plomería vieja ya rechazaba **para cualquier tipo**. El
que discrimina es el que cambia el `tipoReglaId` sin mandar tramos, con la fila sin tramos
guardados.

---

## El signo del abono en `POST /pagos`: el negativo estaba contenido, el cero no (2026-08-22)

Cierra la entrada *"El signo del abono en `POST /pagos`"* (2026-08-21), que se declaraba a sí
misma **"un puntero, no un enunciado verificado"** y mandaba medir antes de escribir. Bien
que lo dijera: lo medido no era lo que sugería el título.

### Lo que pasaba de verdad

`PagoItemDto.monto` llevaba `@IsNumberString` + `@EsMontoCobrado`, pero **no**
`@IsDecimalPositivo`, que su gemelo `PagoVentaDto.monto` (la línea de pago de una venta)
tiene desde siempre. De ahí salen dos conductas distintas, no una:

| Monto | Qué hacía | Por qué |
|---|---|---|
| Negativo | **422**, y no persistía nada | `registrarMovimientoEnTransaccion` rechaza un movimiento de caja negativo y revierte la transacción entera |
| Cero | **201**, y persistía | nadie lo frenaba: ese guard rechaza negativos, **no** el cero, y a propósito (un pago devuelto íntegro como vuelto deja neto 0 y es legítimo) |

O sea que el agujero de plata que el título insinuaba —un abono negativo sacando dinero de la
caja por la puerta de una `entrada`— **no existía**: ya estaba tapado aguas abajo. Lo que sí
existía era un 422 que hablaba de un movimiento de caja cuando el problema era el monto que
mandó el cliente, y un cero que dejaba pago + aplicación + movimiento de caja en cero.

### El arreglo

Un decorador en el DTO, que es donde corresponde: el guard de caja protege la caja, no valida
la entrada del endpoint de pagos. Dos e2e (`it.each` con `-1000` y `0`) exigen 400 y que no
quede ninguna fila en `pagos`. **Validados revirtiendo**: sin el decorador dan 422 y 201.

⚠️ El test es e2e y no un unit del DTO a propósito: `plainToInstance` + `validate` no ejerce
el pipe, así que un unit habría pasado sin probar el camino real del request.

---

## Los tres guards de elegibilidad de la NC: el que estaba en duda no es alcanzable (2026-08-22)

Cierra la entrada *"Los tres guards de elegibilidad de la NC no corren por el webhook, y uno
de ellos probablemente debería"* (2026-08-21). **Sin código**: la propia entrada mandaba
medir primero —*"antes de tocar nada: ¿es alcanzable? … si no lo es, esto se anota y se
cierra"*— y la respuesta es que no.

### La pregunta

Los tres chequeos viven dentro de `if (params.validarVentaElegible)`, flag que solo manda el
camino manual. Dos están así a propósito (un hecho ya consumado no se rechaza por
configuración faltante). El que quedaba en duda era **NC-sobre-NC**: por el webhook no corre,
y si una orden de pasarela pudiera apuntar a una venta que ya es NC, el reembolso registraría
en silencio un documento sobre el documento equivocado.

### Lo medido, con las citas

Una venta es NC **solo** si la creó `crearNotaCredito`: es el único lugar del repo que
escribe `tipoDocumentoId: TIPO_DOCUMENTO_NC_ID` y `ventaReferenciaId`
(`ventas.service.ts:1176-1177`, grep de `ventaReferenciaId:` sobre `src` — los otros dos hits
son la entidad y un mapeo de lectura).

`orden.ventaId` tiene exactamente **dos** escritores (grep de `.ventaId = ` sobre `src`,
descartando specs):

| Escritor | Qué venta asigna |
|---|---|
| `cobros.service.ts:222` (`vincularVenta`) | `ventaInicialId` de una suscripción, creada por `ventasService.crearEnTransaccion` (`suscripciones.service.ts:182`) |
| `online-callback.handler.ts:93` | la venta del checkout online, creada por `ventasService.crear` |

Ninguno de los dos caminos de creación asigna `tipoDocumentoId`, así que **ninguna orden
puede quedar vinculada a una NC**. `vincularVenta` además no está expuesto en ningún
controller (un solo llamador en todo el repo) y exige orden `pagada`, dejándola `conciliada`:
tampoco se puede re-vincular una orden ya conciliada a otra venta.

### Lo que haría falta para que vuelva a importar

Que aparezca un tercer escritor de `orden.ventaId`, o que `vincularVenta` se exponga a un
cliente. Si eso pasa, el guard es barato y **fallar ruidoso ahí es seguro**: el hook corre en
`aplicarPostReembolso`, que ya captura cualquier error y lo degrada a `warning` sin revertir
el reembolso (`cobros.service.ts:443-452`). O sea que el reparo que dejó a los otros dos
guards condicionales —*"perder el evento"*— no aplicaría a éste.

**No se agregó el guard** porque hoy sería código muerto, y esta entrada decía explícitamente
que si no es alcanzable se anota y se cierra.

---

## La mercadería que vuelve reingresa al costo con el que salió (2026-08-22)

Cierra la entrada 🚩 *"Anular una venta reingresa la mercadería al costo de hoy, no al que
salió — y el inventario se infla solo"* (auditoría `inventario` 2026-08-15, encontrada por
dos lentes ciegas entre sí). Decisión del owner del 2026-08-15, construida entera: **los
tres** call sites de reversión, no solo la anulación.

### El dato ya existía y no se leía

`registrarMovimiento` recalculaba el promedio **solo** en `tipo='entrada' && motivo='compra'`,
y los tres reingresos no pasaban `costoUnitario`. El costo real de esa salida estaba
congelado en el kardex desde el día de la venta, ligado a la `venta_id`. Ahora se lee:

- `costosDeSalidaPorItem(manager, ventaId)` — **una** query por venta, los llamadores
  resuelven por ítem contra un `Map` (nada de una consulta por línea).
- `MIN(costo_unitario)` y no un promedio, con el porqué medido: dentro de una venta todas
  las salidas de un ítem congelan el **mismo** costo, porque `costo_actual` solo lo mueven
  `compra` y `ajuste_costo` y ninguno puede ocurrir en el medio — la venta toma `FOR UPDATE`
  sobre el ítem en su primera salida y no lo suelta hasta commitear. **De ahí sale la
  respuesta al reparo de la entrada sobre la devolución parcial:** si de 5 vuelve 1, el costo
  unitario es el mismo, no hay nada que prorratear.
- `MOTIVOS_QUE_RECALCULAN_CPP = ['compra', 'anulacion', 'devolucion']` en
  `inventario.service.ts`. Sin costo congelado —un producto que nunca tuvo costo— no se
  inventa uno: el promedio queda como estaba.

### El comentario del código decía lo contrario, y por qué igual está bien

`calcularCostoPromedio` documentaba que la devolución **no** debe recalcular *"porque
re-promediarla metería costo de venta dentro del costo de compra"*. Ese argumento valía
mientras el reingreso llegaba **sin costo propio**. Con el costo congelado de la salida —que
es costo de compra, el mismo con el que la unidad había entrado— promediarlo devuelve
exactamente la valorización previa a la venta. Lo que el comentario temía sigue prohibido:
ningún camino pasa ahí un precio de venta. El comentario quedó reescrito con esa historia
adentro, y `ADR-016` lleva la fila nueva más un addendum fechado.

### El test es el caso numérico de la entrada, no un mutante

`costeo-cpp.e2e-spec.ts`: 10 a $50 → vende 1 → compra 5 a $70 (CPP $57,1429) → anula.
Exige `stock 15` y `costoActual 56,6667` = (14 × 57,1429 + 50) / 15. **Validado revirtiendo:
con el código anterior devuelve `57.1429`** — el CPP intacto, las 15 unidades valorizadas
$857,14. Además exige que el kardex congele `50.0000` en el movimiento de anulación, que es
el dato que antes no se leía.

Seis unit nuevos: los dos motivos de reversión recalculan (`it.each`), la entrada sin costo
no toca el promedio, la anulación pasa el costo del kardex, la NC y el reembolso sin NC
hacen lo mismo, y la devolución parcial usa el costo de la salida.

⚠️ **Esta suite no abría caja**, y la venta `pendiente` que el test necesita es del canal
físico. `online` no sirve como atajo: rechaza con *"las ventas online requieren el pago
completo"*, y una venta pagada no es anulable. Se le agregó apertura + cierre en dos fases
(el mismo patrón de `recetas.e2e-spec.ts`), porque cerrar mal deja el cajón ocupado y la fuga
reaparece como un `409` críptico en otra suite.

---

## Anular una venta con recetas o combos ya repone los ingredientes, y deja de mentir (2026-08-22)

Cierra la entrada 🚩 *"Anular una venta con recetas o combos no repone los ingredientes, y
responde que sí repuso"* (auditoría `inventario` 2026-08-15), en el alcance que el owner
eligió: **pieza D + el orden de locks de la sección 5**. Las piezas A y B se habían
construido el 2026-08-16; **C —el default destildado cuando la línea ya se despachó— sigue
abierta** y se midió que no es lo barato que la entrada decía (ver abajo).

### La entrada apuntaba a `venta_detalles`, y el arreglo no fue por ahí

La entrada proponía *"expandir la receta o el combo y devolver los ingredientes"*. Al
implementarlo se vio que re-expandir la receta responde la pregunta equivocada: la receta
dice **qué lleva el plato hoy**, no **qué salió del inventario cuando se vendió**. Se
separan en tres casos reales:

- un ingrediente **no bloqueante que se vendió sin stock** nunca salió (la venta lo omite
  con advertencia), y re-expandir lo repondría — metiendo stock que jamás existió;
- una receta **editada después de la venta** devolvería la composición nueva;
- un **grupo modificador** (la proteína elegida) sale por otro camino todavía.

La fuente que responde la pregunta correcta ya existía y no se leía: `movimientos_inventario`
registra cada salida con su `venta_id`. La reposición ahora agrupa esas salidas por ítem y
las revierte. Cubre **sin un caso especial por tipo**, porque a esa altura ya no hay tipos:
hay ítems que movieron stock.
El alcance se verificó por grep, no por deducción: los **cuatro** escritores del kardex en
el camino de la venta —producto (`ventas.service.ts:711`), ingredientes de receta
(`items.service.ts:2856`), componentes de combo (`:3020`) y opciones de grupo (`:3165`)—
usan los tres `tipo='salida'`, `motivo='venta'` y estampan `ventaId`. Los tests cubren
producto y receta; combo y opción de grupo quedan cubiertos por esa construcción, no por
un test propio.

### Lo construido

- `cancelar` arma la lista con `SUM(cantidad)` sobre `movimientos_inventario`
  (`tipo='salida' AND motivo='venta'`, `eliminado_el IS NULL`) en vez del
  `venta_detalles JOIN item_producto` **INNER** que perdía la línea de receta en silencio.
- **No filtra `eliminado_el` de `items` ni de `item_producto`**, con la misma regla
  explícita que `InventarioService.registrarMovimiento`: filtrarlo haría que anular una
  venta de un producto discontinuado después dejara de reponer. `anulacion` está en la
  allowlist de motivos sobre un ítem eliminado.
- `stockRepuesto` pasa a reportar **lo que pasó** (`salidas.length > 0`) y no lo que se
  pidió: una venta de puros servicios ya no dice "stock repuesto" sobre un inventario que
  nadie tocó.
- **Orden de locks + reintento** (entrada de la sección 5, en el mismo commit porque son
  las mismas líneas): ordena por `itemId` con `localeCompare` —el **mismo comparador que
  `crear()`**, no el `ORDER BY` de Postgres, cuya collation puede ordenar distinto y
  reabriría el cruce— y envuelve la transacción en el loop de `MAX_REINTENTOS_DEADLOCK`.
  La precondición de `crear()` se verificó para este camino: el único llamador es
  `VentasController.anular`, sin transacción envolvente.

### Los tests, y cuál discrimina

Dos e2e nuevos en `recetas.e2e-spec.ts`, que crean sus propios ingredientes (no dependen
del stock del seed):

- **13** vende una receta de 2 unidades, anula reponiendo y exige que pan y carne vuelvan
  al valor previo. **Validado revirtiendo**: con el código anterior falla con
  `Expected "10.0000", Received "8.0000"` — la venta descontó y la anulación respondió
  `201` con `stockRepuesto: true` sin devolver nada.
- **14** es el que discrimina las dos soluciones posibles: un ingrediente no bloqueante con
  stock 0 se vende con advertencia, y tras anular **sigue en 0**. Una implementación que
  re-expanda la receta lo pone en 20 g y este test la mata.

Cinco unit nuevos en `ventas.service.spec.ts` (ingredientes que no son líneas, orden
ascendente, `stockRepuesto=false` sin salidas, reintento ante `40P01`, no-reintento de un
error de negocio). El mock de `venta_detalles` quedó devolviendo **algo distinto** a
propósito: si el código volviera a armar la lista desde ahí, los tests lo cazan.

### Lo que NO entró, por decisión del owner

- **La nota de crédito**, que miente distinto sobre lo mismo: usa `LEFT JOIN`, cae en la
  rama `modo_inventario === null` y responde *"no maneja stock (servicio)"* sobre una
  receta. Queda como entrada propia en `pendientes.md`.
- **La pieza C** (default destildado si la línea se despachó). Medido al abrirla: la
  entrada decía *"es solo el default del checkbox"* y **es falso** — `AnularVentaModal`
  recibe únicamente `ventaId` y no conoce ninguna línea, y `cantidad_enviada` existe solo
  en `cuenta_lineas`, nunca en `venta_detalles`. Se llega por `cuenta.venta_id`, así que es
  una lectura nueva de backend + exponerla en el payload de la venta, acoplando
  ventas→salones. Es la quinta entrada de este backlog que subcuenta su propio hueco.

---

## `register` deja de responder 500 cuando dos personas toman el mismo correo a la vez (2026-08-22)

Cierra la mitad viva de la entrada *"Un correo de usuario soft-borrado hace explotar el alta
con un 500"*. La otra mitad **no se cerró: se corrigió**, porque afirmaba algo que ya no era
cierto — queda reescrita en [`pendientes.md`](pendientes.md).

### Lo que la entrada decía, y lo que se midió

Decía que el 500 salía en `tenants.service.ts` → `crearUsuario`. **Ese camino ya traducía su
`23505` a un 409** desde el 2026-08-11, con un comentario que nombra las dos causas posibles.
Lo que seguía vivo era el segundo llamador —`auth.service.ts` → `register`, anotado el
2026-08-15—, y ahí el escenario **no necesita ninguna baja de usuario**: dos registros
simultáneos del mismo correo libre ven los dos `findByEmail` en `null`, los dos insertan, y el
perdedor se come la unique. **Alcanzable hoy, por API.**

Duele más de lo que parece porque ese endpoint responde **siempre lo mismo** para no ser un
enumerador público de cuentas: un 500 vuelve a distinguir desde afuera un correo tomado de uno
libre, que es justo lo que se había sacado.

### El arreglo, y el hueco que tenía la primera versión

Traducir el `23505` y devolver la misma respuesta uniforme. Sin reintentar ni releer para
seguir: el ganador de la carrera manda el mail de verificación, y continuar emitiría un
segundo token que le quemaría el link al ganador — dos mails y un solo link válido.

⚠️ **La primera versión del fix se tragaba cualquier `23505`, y eso era peor que el 500.**
`usuarios` tiene **dos** uniques —`correo` y `nombre_usuario`— y `RegisterDto` acepta las dos:
una colisión de nombre de usuario habría respondido *"revisá tu correo"* a alguien cuya cuenta
**no se creó**. Se distingue **por conducta, no por el texto del error**: si después del
choque el correo ya está tomado, la carrera fue por el correo; si sigue libre, el error sube
tal cual. Los nombres de constraint no sirven para esto — TypeORM los genera como hashes
(`UQ_1a7a36f3…`) y cambian con el esquema.

### Los tests

El RED corrió **contra el código de producción sin tocar**, que es la forma más fuerte del
mutante: el test de la carrera fallaba con el `duplicate key` crudo antes del fix. Y hay uno
por rama, porque la rama peligrosa es la que no rechaza: *"NO se traga la colisión de
`nombre_usuario`, que no creó ninguna cuenta"*.

**Gate:** lint 0, typecheck limpio, 2016 unitarios, e2e completo sobre base reseteada.

---

## El pipe de escala deja de arrastrar a once controllers a `Scope.REQUEST` (2026-08-22)

Cierra la entrada *"El contagio de `Scope.REQUEST` de `EscalaMonedaPipe` — el spike de
contexto en ALS, antes que partir ningún controller"*. **El spike salió, se migró, y el
plan B —partir `ItemsController`— no hizo falta.**

### El spike, que era lo que la entrada pedía

La duda concreta era el **orden de ejecución**: los pipes resuelven los argumentos cuando
alguien se suscribe al observable de `next.handle()`, que podía caer **fuera** del
`als.run` del interceptor. Se montó un experimento con un pipe singleton y dos formas de
siembra:

| Medición | `als.run` | `enterWith` |
|---|---|---|
| El pipe singleton ve el contexto | ✅ | ✅ |
| 20 concurrentes de tenants distintos | **0 de 20 cruzados** | **0 de 20 cruzados** |
| Request sin siembra hereda el anterior | No | No |
| Instancias del controller para N requests | **1** | **1** |

Se eligió `run`: `enterWith` también funcionó, pero no cierra el contexto al volver.

### Lo construido

`RequestContext` (`common/context/request-context.ts`) + un interceptor global que lo
siembra con `req.user`. `EscalaMonedaPipe` pasó a **singleton** y su memo de decimales se
mudó al **store del request** — un memo de instancia en un singleton le serviría los
decimales del primer tenant a todos los demás, que es exactamente lo que el docblock viejo
advertía que pasaría *"al que le saque el `Scope.REQUEST`"*. Hoy **no queda ningún provider
request-scoped en `backend/src`**. Patrón documentado en
[`patterns/backend.md`](../patterns/backend.md) §9b.

### ⚠️ El 7% no se reproduce, y eso corrige a la entrada que motivó todo

La entrada justificaba el trabajo con *"~7% menos req/s y ~13% más p95, **sin solapamiento
entre brazos**"*, medido con **dos rondas por brazo** el 2026-08-21. Al migrar se rehízo el
A/B en la misma máquina y con el mismo arnés, **seis rondas por brazo**:

| Brazo | Rondas 3-6 (req/s) |
|---|---|
| Singleton, 1ª pasada | 597 · 597 · 576 · 548 |
| Singleton, 2ª pasada | 534 · 556 · 591 · 603 |
| Request-scoped (revertido a propósito) | 542 · 539 · 591 · 571 |

**Los tres tramos se superponen.** Lo que domina la serie es el **calentamiento**: la ronda
1 arranca en ~420-460 req/s en los tres brazos y sube hasta ~600. La diferencia de scope
queda dentro del ruido que dos rondas no alcanzaban a ver.

**No se revirtió la migración por eso**, y el porqué está escrito en el docblock del pipe:
lo que queda en pie es el motivo **estructural** —un provider request-scoped contagia a
quien lo hospede, el costo es invisible y crece solo, y la disciplina que lo contenía no se
puede verificar en una revisión—. Pero el número no se puede seguir citando.

### El test se validó revirtiendo — y la primera versión de este párrafo era falsa

**Lo que decía:** *"el mutante es el diseño anterior —memo de vuelta en la instancia— y con
él fallan dos tests"*. **La revisión independiente lo refutó reconstruyendo el mutante**, y
tenía razón: yo había mutado el memo **sacándole la clave del tenant**, que es otra cosa. El
mutante fiel al diseño anterior —memo en la instancia **conservando** la clave— **pasaba los
dos tests**.

**Por qué los pasaba, que es lo que importa:** `decimalesDelTenant()` es síncrona hasta el
`return` —compara, asigna y devuelve la promesa sin ningún `await` en el medio—, así que dos
requests no pueden entrelazarse ahí: cada uno se lleva la promesa que él mismo creó. Un memo
de instancia **con** clave de tenant no produce fuga cruzada, y ningún test de concurrencia
lo iba a cazar, porque no hay nada que cazar.

**El peligro real de ese diseño es otro: quedarse pegado.** Con el pipe singleton, un memo
de instancia cachea **para siempre**; un tenant que cambia su moneda oficial seguiría
validando con la escala vieja hasta que alguien reinicie el proceso. Sobre plata.

De ahí el test que faltaba y ahora existe — *"el memo no sobrevive al request: el siguiente
vuelve a preguntar"*: dos requests del mismo tenant tienen que preguntar dos veces. Con el
mutante de la revisión **falla**, y es el único de los tres que lo caza.

Los otros dos siguen valiendo por lo suyo: *"vuelve a preguntar los decimales si cambia el
tenant"* (ya existía, y anticipaba esta migración) y el de dos requests concurrentes con
distinta escala — que cubren el memo **sin** clave, no el memo de instancia.

**Gate:** lint 0, typecheck limpio, 2013 unitarios, **e2e completo 43 suites / 530 tests**
sobre base reseteada.

---

## "Hasta el 16" ya muestra el 16 (2026-08-22)

Cierra la entrada *"El borde `hasta` de los filtros de fecha pasa a ser inclusivo del
día"*. **Construido el mismo día que se decidió.**

**Qué se hizo:** `bordeHastaSql` nuevo en `common/utils/rango-fecha.util.ts` — con fecha
pura emite `< (($n::date + 1)::timestamp AT TIME ZONE $z)`, y con un timestamp explícito
deja `<= $n` intacto. Lo usan los tres filtros que estaban rotos: **mermas**, **kardex** y
**órdenes de pasarela**. La convención quedó escrita en
[`patterns/backend.md`](../patterns/backend.md) §10b, con la tabla de los dos bordes, que
**no son simétricos**.

### La entrada afirmaba tres cosas y dos eran falsas

Se midió antes de escribir código, y por eso el alcance cambió **antes** y no después:

1. ❌ *"`finDiaExclusivoIso` tiene cero llamadores (medido)"* — **tiene dos, vivos**:
   `propinas/index.vue:115` y `:145`, en el preview y en la liquidación del reparto.
   Borrarlo, como la entrada mandaba, **rompía las propinas**. No se tocó.
2. ❌ *"alinear `propina-reportes`, que ya usa `< hasta` exclusivo"* — su llamador **ya
   compensa**: `rangoMesActual()` manda el **1° del mes siguiente**. Hacer el backend
   inclusivo sin tocar la pantalla habría metido el 1° de septiembre en el resumen de
   agosto. Quedó fuera de alcance por decisión del owner, con el porqué escrito en
   `patterns/backend.md` §10b.
3. ✅ *"los tres filtros comparan `creado_el <= $hasta`"* — cierto, y era el bug.

**Y apareció algo que la entrada no sabía:** `sesiones-garzon` **ya tenía el arreglo
hecho**, con el mismo SQL, por el mismo motivo (*"Desde hoy / Hasta hoy" no devolvía
ninguna sesión*). O sea que el precedente bueno del repo no era el que la entrada nombraba.
De paso se corrigió su docblock, que decía seguir *"el patrón que `propina-reportes` ya
usa"* — `propina-reportes` no suma el día; la cita era falsa.

### El test se validó revirtiendo, no rompiendo

Tres casos nuevos en `test/filtros-fecha-zona.e2e-spec.ts`, que cubría `desde` en cuatro
casos y **`hasta` en ninguno**. Con la implementación revertida al `<=` viejo —el mutante
es el código anterior, no una rotura cualquiera— fallan dos: *"hasta hoy"* devuelve **0**
en vez de 1, y el kardex **0** en vez de 2.
ℹ️ El tercero (un timestamp corta en el instante, no al final del día) **pasa igual con el
mutante**, y se deja igual: no cubre este bug sino el arreglo equivocado de sumarle un día
a todo, que es el ensanche mudo que el helper hermano ya evita.

⚠️ **Lo que NO cubre el e2e:** las órdenes de pasarela. El tercer llamador comparte el
helper y su SQL está fijado por unit test, pero montar una orden en el e2e es fixture de
pasarela; se dejó afuera a propósito y se dice acá para que no se lea como cobertura
completa.

**Gate:** lint 0, typecheck limpio, 2012 unitarios, **e2e completo 43 suites / 530 tests**
sobre base reseteada.

---

## La pasada de auditoría de las dos lentes: 3 lentes, 0 hallazgos (2026-08-22)

Cierra la entrada *"Disparar la pasada de auditoría de las dos lentes"* de la sección 7.
Corrida el mismo día en que el owner fijó el presupuesto. **~437k tokens de buscadores**,
bajo el tope de 500k. El plan queda como registro en
[`2026-08-15-auditoria-cross-tenant-y-pool.md`](../superpowers/plans/2026-08-15-auditoria-cross-tenant-y-pool.md);
el resultado, con qué se verificó limpio, en la fila del 2026-08-22 del mapa de cobertura de
[`auditoria-codigo.md`](auditoria-codigo.md).

**Tres buscadores Sonnet ciegos entre sí, refutación por el principal**, como manda el
método: (A1) recursos indexados por `usuario_id` sin `tenant_id`, en las tres formas de
acceso; (A2) los barridos totales por usuario, buscados por verbo y no por tabla; (B) la
**sucesora** de la lente del pool —referencia a método de repo guardada y llamada fuera del
contexto donde se resolvió—, en modo delta.

### El resultado es cero, y no por no haber buscado

- **Lente A:** pisa la superficie que el barrido de identidad del 2026-08-15 ya recorrió con
  22 hallazgos y revisión independiente encima. Lo que quedaba era residuo.
- **Lente B:** ADR-020 la cerró **por construcción** el 2026-08-18. Revalidado con dos
  búsquedas independientes (una del buscador, otra del refutador con otra formulación) y con
  **93 commits** posteriores al cierre revisados en busca del vector de la reincidencia.
- **Las dos lentes A convergieron en el mismo candidato y las dos lo refutaron solas**:
  `invalidarTodos` sin `tenantId`. Al abrirlo, el código ya tenía la respuesta escrita —
  `tokens-acceso.service.ts:159` **excluye `CONFIRMACION`** con el comentario que dice que
  incluirlo *"mataba en silencio un alta pendiente: la persona quedaba fuera del tenant y el
  admin la veía desaparecer del roster sin ninguna señal"*, que es exactamente el bug de
  agosto.

### Lo que la pasada dejó, además del cero

- **Dos datos falsos del plan, corregidos en el propio plan:** la "tabla de sitios" que
  mandaba pasarle al buscador **no existe** en ningún doc vivo, y `garzon_pin_evento` no es
  candidato de la lente A porque ya tiene `tenant_id` propio.
- **Una corrección de dato de un buscador:** `refresh_tokens` **sí** tiene columna de tenant
  (`active_tenant_id`), contra lo que afirmó su reporte.
- **Una pregunta de producto que ninguna lente reportó** porque con su lente puesta no era un
  bug: una persona en dos tenants tiene **una sola vida de sesión** —cambiar de tenant o la
  contraseña revoca los refresh de todos—. ✅ **Contestada el mismo día: el owner decidió que
  las sesiones paralelas por tenant no hacen falta.** La regla quedó escrita en `PRODUCTO.md`
  §2 (*"la sesión es de la cuenta, no del tenant"*) y **no abrió entrada**: se documenta
  justamente para que no se vuelva a levantar como hallazgo. De paso se corrigió en
  `PRODUCTO.md` §1 una línea que decía *"Stateless: no se persisten sesiones"* —falso, los
  refresh se persisten, rotan y dejan lápida— y se contestó el `[ PENDIENTE ]` sobre
  revocación real, que existe desde hace rato.
- **Una regla de método nueva**, escrita en `auditoria-codigo.md`: *una pasada en cero se
  audita a sí misma preguntando de qué afirmación depende ese cero*. Si esa afirmación no se
  abrió y se leyó, el cero está aceptado, no verificado.

### La predicción del plan no se cumplió, y conviene decirlo

El plan avisaba —dos veces— que *"el backlog va a subir, no bajar"*, porque se decidió
reportar sin arreglar. **No subió: quedó igual.** No invalida el aviso (era el resultado
esperado dado el método), pero sí muestra que el valor de esta pasada fue **confirmar
confianza** en dos superficies, que es literalmente para lo que el método dice que existe el
mapa de cobertura.

---

## Un alta pendiente no es editable, y eso dejó de ser efecto lateral (2026-08-22)

Cierra la entrada *"¿El admin puede editar los roles de un alta pendiente antes de que la
persona confirme?"* de la sección 4. **El owner eligió el camino que ya regía de hecho** —no
se construye el endpoint— y la respuesta se escribió como **regla de producto** en
`PRODUCTO.md` § *Control de acceso (RBAC)*, que es lo que faltaba: el comportamiento existía,
la regla no.

### El texto de la entrada, como estaba

- [ ] **¿El admin puede editar los roles de un alta pendiente antes de que la persona
  confirme?** (producto + backend, 2026-08-16) — hoy **no**, y la pantalla lo refleja: las
  acciones de fila están deshabilitadas para los pendientes, con el motivo escrito. No es una
  omisión de UI: los roles quedan **congelados en el token** (`tokens_acceso.datos`) hasta que
  se confirma, y la persona todavía no tiene fila en `usuarios_tenants`, así que
  `roles.service.ts` → `assignUser` la rechaza con *"El usuario no pertenece a este tenant"*.
  El admin que se equivocó de roles hoy tiene una sola salida: repetir el alta, que emite un
  token nuevo y quema el anterior.
  **La pregunta:** ¿alcanza con eso, o el alta pendiente tiene que ser editable? Lo segundo
  necesita un endpoint que reescriba `datos.rolIds` del token vivo, y es decisión de producto
  —no un ajuste de pantalla—. Lo levantó el agente de frontend al construirlo, y se dejó en el
  camino barato a propósito.

### Las tres afirmaciones de la entrada se verificaron antes de escribirlas como regla

No se dio por buena la entrada: se abrió el código, porque una entrada de backlog puede
sobreafirmar.

1. **Roles congelados en el token** — `auth/entities/token-acceso.entity.ts:92-97`: el
   docblock lo dice y `datos` es `{ tenantId, rolIds } | null`.
2. **`assignUser` rechaza a quien no es miembro** — `roles/roles.service.ts:101-108`: un
   `SELECT 1 FROM usuarios_tenants` y `BadRequestException('El usuario no pertenece a este
   tenant')`.
3. **Repetir el alta quema el link anterior** — `tenants/tenants.service.ts:774-795`: llama a
   `invalidarAnteriores(...)` **antes** de `emitir(...)`, acotado al tenant, con el comentario
   que explica por qué (*"dar de alta dos veces tiene que dejar **un** link válido, el
   último. Si no, el mail viejo —con los roles viejos congelados adentro— sigue sirviendo"*).

Esa tercera fue la que inclinó la decisión: **reemitir no es solo el camino barato, es el
seguro.** Un endpoint que reescriba `datos.rolIds` del token vivo mantendría en circulación un
mail cuyo contenido ya no describe lo que va a pasar.

### Qué NO se construyó, a propósito

El endpoint de edición del alta pendiente. Si algún día se pide, la entrada vuelve a abrirse
como feature con su spec —no como ajuste de pantalla—, y tiene que resolver qué hace con el
link ya enviado.

---

## La etiqueta manda cuando el cliente paga la etiqueta (2026-08-21)

Cierra la entrada *"Un descuento y un recargo que se compensan cobran \$1 menos que la misma
línea sin reglas"*. **El owner eligió la opción (1)**: la rama de cierre a góndola pregunta
por lo que el cliente **pagó** —`baseSinAjuste.eq(subtotalNeto)`— y no por *cómo* llegó ahí
—`descuentoAplicado.isZero() && recargoAplicado.isZero()`—.

### La entrada se quedaba corta en dos cosas, y las dos se midieron antes de decidir

**No era "\$1 menos", era ±1.** Con góndola 103 el par que se compensa cobraba **104**: neto
87, IVA por fórmula 16,53 → 17. La entrada solo había visto el lado que baja.

**No era raro por construcción.** Barriendo góndolas 100..3000 con IVA 19% en CLP, **463 de
2901 precios (16,0%)** declaraban distinto que la misma línea sin reglas. Y no hacía falta
que dos montos fijos se cancelaran a mano: alcanza **un descuento y un recargo del mismo
porcentaje**, porque con `calculo_descuentos = 'base'` —el default de todo tenant— los dos
aplican sobre el neto. En `compuesto` no pasa (el recargo corre sobre el acumulado: 83 y 75,
no se compensan).

### El contraargumento contra la opción (1) no se sostuvo, y también está medido

La objeción natural era que anclar a la etiqueta crea un salto de dos pesos en el borde. El
salto **ya existía**, una muesca más a la derecha — con descuento 50 y recargos 48→52:

| rec | 48 | 49 | **50** | 51 | 52 |
|---|---|---|---|---|---|
| antes | 990 | 991 | **992** | 994 | 995 |
| ahora | 990 | 991 | **993** | 994 | 995 |

Es el escalón de la cuantización del IVA (158 → 159), no una consecuencia de la decisión.
Elegir la regla de la etiqueta no agrega discontinuidades: elige **cuál** de las dos vecinas
cae del lado de la góndola.

### Qué costó y qué lo fija

Una condición. El guard de `hayReglasDespuesDelImpuesto` sigue haciendo falta —con los
impuestos primero lo aplicado todavía no se conoce— y queda; el guard viejo lo **subsume** la
comparación de bases, porque la línea con un 10% de descuento real tiene la base corrida y se
excluye sola. Ningún test existente fijaba la conducta vieja: los 2003 unitarios pasaron sin
tocar uno.

Cinco tests nuevos en `calculo-precios.engine.spec.ts`. **El mutante —revertir la condición al
`isZero() && isZero()` anterior— mata cuatro**: el par de montos fijos que se anulan (993), el
par de porcentajes sobre la base (el caso alcanzable de verdad), el que cobraba de más (103) y
la composición con el ancla móvil del descuento de nivel venta (893). El quinto —*"si el
recargo no compensa exacto, la línea vuelve a la fórmula"*— pasa con y sin mutante a propósito:
fija que la regla **no se ensanchó** a "cualquier par de reglas cierra".

---

## Una sola moneda oficial: se eliminó `tenant_moneda.es_default` (2026-08-21)

Cierra la entrada *"'Oficial' nombra DOS monedas distintas y ya divergen tres caminos de
plata"*. **No era una decisión de producto pendiente en el sentido que la entrada suponía**: la
decisión ya estaba tomada en **ADR-005** desde junio —la moneda oficial sale del país y el
tenant no la elige— y lo que había era código que no la respetaba. Lo nuevo que decidió el owner
fue **eliminar el campo**, no acotarlo. El porqué completo está en **ADR-021**.

**El efecto medido:** un tenant chileno que marcaba UF como predeterminada seguía cobrando en
pesos —la conversión multiplica por `valor_del_dia` y a la del país se le fuerza `1`— pero
cuantizados a 4 decimales. Un ítem de 4,5674 UF a 40.860,60:

| escala que gobierna | neto | IVA 19% | total |
|---|---|---|---|
| CLP, la del país ✅ | 186.627 | 35.459 | **222.086** |
| UF, la del selector ❌ | 186.626,7044 | 35.459,0738 | 222.085,7822 |

### Lo que costó llegar al diagnóstico, que es la parte que enseña

Este frente lo diagnostiqué **mal tres veces seguidas**, y las tres me corrigió la revisión
independiente o el owner. Las tres veces por lo mismo: concluir desde un grep parcial.

1. **"Hay que hacer que `setDefault` rechace lo que no sea la oficial."** Falso: eso le sacaba
   al tenant una función legítima para tapar un bug que vivía en otro lado. Lo corrigió el owner
   diciendo para qué servía el campo.
2. **"Es un cambio de una query."** Falso: `ventas.service.ts` tenía **su propia** consulta por
   `es_default`, que decidía la escala de la venta real, la moneda estampada y la del pago. Yo
   había arreglado solo la previsualización. Lo cazó la revisión.
3. Y recién al barrer **todos** los consumidores apareció que el campo **no ordenaba ningún
   selector** —eso sale de `ORDER BY es_oficial DESC`— y que ya había costado dos `Math.min`
   defensivos en el frontend, con un comentario que pedía justamente esta decisión.

**La lección:** cuando dos nombres compiten, el mapa completo de consumidores **es** el
diagnóstico. Cualquier conclusión antes de tenerlo es una hipótesis con tono de hallazgo. Las
tres veces creí estar mirando el problema y estaba mirando un pedazo.

### Lo que lo fija

- El unit de `decimalesOficiales` afirma que la consulta nombra `p.moneda_oficial_id` **y que no
  nombra `es_default`** — la negativa es la que caza el revert.
- Un unit nuevo en `ventas.service` afirma **qué moneda queda escrita en la venta** y con qué
  escala se llama al motor, sobre un fixture que trae una moneda no oficial **primera** a
  propósito. Antes nada lo afirmaba: el mutante "elegir por posición" pasaba en verde, que es
  justo cómo la segunda noción sobrevivió meses en el camino de persistencia.
- **No hay e2e de esto, a propósito.** Llegué a escribir uno que montaba el escenario divergente
  con `PATCH /monedas/:id/default` y lo descarté antes de commitear, porque al eliminar el
  endpoint ese estado dejó de ser alcanzable: un test que necesita una ruta que no existe no
  protege nada. Lo que protege ahora es estructural —no hay forma de producir dos monedas
  oficiales— más los dos unit de arriba. (En la historia del repo ese archivo nunca existió;
  este párrafo decía "se eliminó", que era falso, y lo cazó la revisión.)

---

## El `Promise.all` del motor sobre el cliente transaccional (2026-08-21)

Cierra la entrada del backlog, **con su alcance original**: los **dos** `Promise.all` de
`calculo-precios.service.ts` pasan a `await` secuenciales.

**El mecanismo:** `calcular()` corre dentro de `crearEnTransaccion` → `db.transaccion(...)` en
toda venta real, y ahí las cinco consultas resuelven contra el `EntityManager` del contexto ALS
—**un único `pg.Client`**—. Concurrentes sobre ese cliente, node-postgres las encola; en `pg@9`
la segunda tira en vez de esperar. Secuencial no cambia el orden real de ejecución en ese
camino —ya era serie— ni ningún resultado: cambia la vía, de una anunciada como removida a una
soportada.

**El gemelo se cerró el mismo día.** `ventas.service.ts:296` tenía el mismo defecto un frame
más arriba del mismo `POST /ventas`: un `Promise.all` sobre `dto.lineas` que resuelve la
personalización de recetas y combos con el `manager` de la transacción. Con dos o más líneas de
receta o combo, consultas concurrentes sobre el mismo cliente. Lo encontró la revisión al
pedirle que buscara **por conducta y no por mecanismo**, y no era hallazgo nuevo: el propio
proyecto ya lo había medido el 2026-08-20 al cerrar el N+1 de la personalización —*"el
`Promise.all` corre sobre el manager de la transacción, o sea una sola conexión, y `pg` las
encola. Son viajes en serie"*— y había dejado el `Promise.all` tal cual porque esa tanda
perseguía el conteo de consultas, no la vía. Costo cero por esa misma medición, y el conteo por
venta no se movió.

**El costo, declarado:** hay un camino sin transacción —la previsualización de
`POST /calculo-precios/calcular`— donde estas consultas sí corrían en paralelo real sobre
conexiones distintas del pool. Ese camino lo pierde. Se acepta: son cinco consultas y no es el
camino caliente.

### Dos cosas que la ejecución desmintió, y las dos son de método

**1. La evidencia que la entrada citaba era de otra cosa.** Decía que la salida de
`test:e2e -- concurrencia-pool` *"no está limpia por este mismo motivo"*. Medido con
`--trace-deprecation`: el `DeprecationWarning` sale del `Promise.all` **interno de TypeORM**, en
`DataSource.synchronize` → `getTables`, al arrancar cada app de test. Y **Node emite cada
deprecación una sola vez por proceso**, así que ese warning —que ocurre al arrancar— tapa
cualquier otro que venga después: el caso real nunca se iba a poder observar ahí. Los 43 de la
suite completa son ~uno por proceso de test, no 43 colisiones nuestras, y **siguen siendo 43
después del arreglo**. Por eso el mecanismo se verificó por el código y no por el warning.

**2. La primera medición mía fue peor que la de la entrada.** Concluí que solo una de las tres
ramas del primer `Promise.all` tocaba el cliente compartido, y dejé ese sitio concurrente. Era
falso: `descuentos` y `recargos` consultan por `@InjectRepository`, que en este proyecto **no es
el repo del pool** — `RepositoriosModule` (ADR-020) inyecta un **Proxy** que resuelve
`TxContext.managerActivo()` en cada acceso. El ADR ya lo decía, *"motor de precios incluido"*, y
además ya había anotado el warning en **los dos** sitios.

El error fue grepear `this.db.query` literal y tomar el resultado por exhaustivo: **el proxy no
aparece en ese grep**. Es exactamente el modo de fallar que el repo ya tenía anotado —buscar por
mecanismo en vez de por conducta— y esta vez habría dejado el riesgo vivo en el motor con la
entrada del backlog borrada. Lo cazó la revisión independiente.

---

## Un descuento de nivel venta ya baja la base del IVA (2026-08-21)

Cierra la entrada 🔴 del backlog y la decisión **(f)** de
[redondeo de plata](../superpowers/specs/2026-08-20-redondeo-de-plata-decisiones.md), que
documentó el defecto y dejó el criterio sin decidir.

**El problema, con número:** dos líneas afectas de neto 1.000 con un descuento global del 10%
declaraban `totalImpuestos = 380` sobre una base cobrada de 1.800, cuyo IVA es 342. En su forma
extrema —un descuento fijo de 2.000 sobre una venta de 1.190— la venta cobraba **cero** y
declaraba **190 de IVA**.

### Lo que decidió el owner, y lo que la investigación aportó

Antes de diseñar se hizo la pasada de investigación que pide `CLAUDE.md`
([2026-08-21](investigaciones/2026-08-21-descuento-global-vs-base-del-iva.md)). En Chile la
respuesta está en la norma y no en la competencia: el formato de la boleta define
`MntNeto = Σ MontoItem − Descuentos`, **solo con items `IndExe = 0`**, y `IVA = MntNeto * 19%`.
O sea que el descuento entra en la base y la base está segregada por estado fiscal.

Las seis decisiones están en su
[spec](../superpowers/specs/2026-08-21-descuento-global-vs-iva-decisiones.md). El cruce contra
el código corrigió la entrada del backlog en cuatro puntos, y dos cambiaron el trabajo:

- **El motor no recibía el estado fiscal de la línea.** Se entregó aparte (Paso 0), y resultó
  más chico de lo escrito: el dato ya viajaba del ítem a `venta_detalles` y `resolverLinea` ya
  lo leía para derivar el IVA (ADR-018). Faltaba que entrara al motor.
- **"Correr el paso `impuestos` a nivel venta" no era implementable**: las líneas llevan tasas
  distintas (IVA + ILA) y no existe una tasa única para el neto agregado.

### Lo que el spike desmintió de la propia spec

La decisión (e) decía que un descuento global *"apaga el cierre a góndola"*, y afirmaba —**desde
un solo ejemplo**— que eso no contradecía la decisión (a). Un barrido de 11.604 casos: derivar
por resta y aplicar `tasa × base` **difieren en 1.815 (15,6%)**, y en esos casos `tasa × base`
rompe que `base + impuesto` sea el total (`87 + 17 = 104` sobre 103). Se paró, se consultó, y
el owner enmendó (e): **el ancla se mueve, no se apaga.**

Es la tercera vez en este frente que una afirmación generalizada desde un ejemplo resulta falsa
al contarla. El spike existía justamente para eso.

### El arreglo

Dos pasadas sobre las líneas: la primera da los pesos, la segunda recalcula con el ajuste
prorrateado. El residuo del reparto va al resto más grande —cuantizar cada tercio de 10.000 da
9.999— con desempate por posición. Cada línea decide cuánto de su parte es neto y cuánto
impuesto según sus propias tasas, así que la prorrata entre base afecta y exenta **cae sola**:
medido, 1 afecta + 1 exenta con 200 de descuento da neto 908 + IVA 173 + exento 909 = 1.990, y
el cliente paga exactamente 200 menos.

Las reglas de documento se evalúan en plata cobrada —decisión (a)— y se declaran en neto, que
es lo que `MntNeto` resta.

### Lo que lo fija

Seis tests de motor con los casos numéricos exactos (incluido el de monto fijo, que es el único
que prueba la decisión (a): con `%` las dos lecturas coinciden y un test con `%` no probaría
nada) y **la red de regresión que no existía**: un e2e que afirma la identidad **tres veces** —en la
cabecera persistida, en cada fila de `venta_detalles`, y en la respuesta de
`GET /api/ventas/:id`— porque las tres se rompen distinto. Hasta ahora ninguna prueba leía los
totales guardados, solo la respuesta del endpoint.

⚠️ **Las dos últimas las agregó la revisión independiente, bloqueando dos veces.** La primera
versión de este arreglo dejaba la cabecera perfecta y **rompía la fila de la línea**, que antes
cerraba siempre: el componente nuevo no se persistía y el dato se perdía en el `INSERT`, en la
tabla que lee una reimpresión o una nota de crédito. Arreglado eso, el mismo defecto seguía un
nivel más arriba: el `SELECT` explícito de `findOne` no traía la columna, así que la pantalla
mostraba partes que no sumaban su propio total. **Es la lección de este frente:** una identidad
aditiva se rompe en cada capa por separado, y verificar una no dice nada de las otras.

---

## El punto fijo de `MoneyInput`: el catálogo vuelve a ser editable en USD y UF (2026-08-21)

Cierra la parte 🔴 de la entrada *"El punto fijo de `MoneyInput` con `v-model` y monedas de
más de 0 decimales"*. Lo que quedó abierto —re-migrar `mermas` y `grupos-modificadores`—
sigue en `pendientes.md` **con otro motivo**, que apareció al ir a hacerlo.

**El problema, en una frase:** el precio del catálogo **no se podía editar** para un ítem en
USD o UF. El campo quedaba muerto tras la primera tecla, en siete `MoneyInput` de
`items.vue` e `inventario/index.vue`.

### La causa

`display` lo escribían dos fuentes —`syncFromMaska` y el `watch` de `props.modelValue`— sin
árbitro. Con `v-model`, el valor que el componente emitía volvía por `modelValue`, el watch
lo reformateaba con `formatMontoDisplay` → `toFixed(decimales)` **rellenando la escala
completa** (`"1"` → `"1.00"`), y la tecla siguiente caía al final, donde `number.fraction`
la truncaba de vuelta. Punto fijo.

Con `decimals: 0` no pasaba, porque `toFixed(0)` es idempotente. Como la moneda oficial del
seed es CLP, el bug vivió meses sin que nadie lo viera en las pantallas de todos los días.

**El arreglo es una línea**: el watch no reformatea el **eco** del propio `emit`. Un cambio
que viene de afuera —abrir un formulario, un reset del padre— sí, que es cuando el relleno a
la escala completa es lo que se quiere. La comparación incluye la moneda, porque cambiar de
moneda invalida el eco.

### Lo que lo fija

- Los dos tests que **afirmaban el bug** (`describe` *"limitación conocida … punto fijo"*)
  se reescribieron como la conducta deseada y se los vio **fallar con el código viejo**
  —`'1.00'` en vez de `'12.50'`, `'5.0000'` en vez de `'5.0500'`— antes de tocar el
  componente. Después, mutante: sacando **solo** el guard del eco, esos dos vuelven a
  fallar con los mismos números y los otros 16 quedan verdes.
- La otra limitación conocida —el separador leído como agrupador de miles en monedas de 0
  decimales— **sigue intacta y sigue documentada**: sus cuatro tests pasan sin tocarse. Era
  el riesgo real de este arreglo, porque el intento anterior de este frente rompió justo
  eso (`1.500` en CLP emitía `1`, un monto válido y menor, guardado en silencio).
- **Smoke en el navegador real, tecla por tecla**, que es la única forma de reproducirlo:
  USD `1,2,.,5,0` → `12.50`; UF `5,,,0,5,0,0` → `5,0500`, guardado y leído de la base como
  `5.0500`; CLP `1,.,5,0,0` → `1.500`, que sigue siendo mil quinientos.

### Lo que la ejecución desmintió del registro

La entrada decía que al arreglar el punto fijo había que *"re-migrar los campos de costo que
se revirtieron a `UInput`"*, como si fuera mecánico. No lo es: `MoneyInput` **necesita una
moneda** para resolver separadores y locale, y ninguna de las dos pantallas tiene una a mano
—`ProductoOpt` de `mermas` no trae `monedaId`, y `grupos-modificadores.vue` no menciona
moneda en ningún lado—. Usar la oficial daría los separadores equivocados para un ítem en
moneda extranjera. Se dejó sin hacer, con el motivo nuevo escrito en la entrada.

Y midiendo eso apareció otra cosa que la entrada no nombraba: los campos de costo de
`items.vue` usan `:moneda-id` **sin** el prop `decimales`, así que para un ítem en CLP la
pantalla admite 0 decimales mientras `@EsCosto()` admite 4.

### Los punteros que quedaron mintiendo

Tres lugares afirmaban el bug en presente y se corrigieron **en el mismo commit**:
`patterns/frontend.md §8`, el aviso de `features/configuracion-monedas.md` (*"antes de que
un tenant tenga una moneda de más de 0 decimales como oficial…"*) y el cruce ➕ de la entrada
de la UF en `pendientes.md`. Es la regla de `CLAUDE.md`: un frente cerrado que sigue nombrado
hace frenar al próximo agente por algo que ya no existe.

---

## Los minors del redondeo de plata: los tests que no podían fallar, y una regresión que solo vio el e2e (2026-08-21)

Cierra **dos de las tres** entradas del grupo *"Los minors que dejó el frente de redondeo de
plata"* (sección 1) y **las dos** de la sección 2 que pedían medir. Queda abierta la tercera
del grupo —el cuaderno de anti-patrones sobre su propio tope—, que es la única que pide
juzgar bugs ajenos.

Cinco commits agrupados **por naturaleza y no por hallazgo**: tests / comentarios /
tipos / duplicación / conducta. Los de conducta llevan test; los de comentarios y tipos se
verificaron por lo contrario —que **ningún** valor esperado se moviera—.

### Lo que más valía: cinco tests que pasaban sin poder fallar

Cada uno se validó **mutando el código que el test dice proteger**, y el mutante es la
reversión al comportamiento anterior, no una rotura cualquiera:

- *Σ trazas de descuento = descuento aplicado* usaba **una sola** regla, o sea afirmaba
  `Σ{a} = a`. Con dos del 12,5% sobre 100 en CLP discrimina: 13+13 = 26 contra `Q(25) = 25`.
- La **cuantización de `valorSolicitado`** no la sostenía nada: revertirla dejaba la suite
  entera en verde. El caso que faltaba es el topeado en CLP —el segundo fijo pide 51 y
  aplica 49—; sin cuantizar, la traza declara 50,5.
- **Dos `expect` tautológicos.** Sus coordenadas del ledger ya no apuntaban a ellos (las
  tareas 12-14 corrieron el archivo) y se resolvieron **pidiéndole a git el spec del commit
  de la Task 5**, no buscando a ojo.
- *"Acepta nivel documento en una moneda con decimales"* prometía persistencia en el nombre
  y solo afirmaba el objeto de retorno, que se arma con el DTO sin ir a la base.
- `recargos.vue` tenía el mismo `onModoChange` que `descuentos.vue` **sin test análogo**.

Y `montoTolerancia` —el único monto sobre `NUMERIC(18,6)`— pasó a tener e2e propio. Es la
ruta donde el `EscalaMonedaPipe` cuelga como `@Body(...)`: un test de DTO con
`plainToInstance` + `validate()` **no lo ejecuta**, así que mandarle `'1.5'` pasaba en verde
sin probar nada. El mutante (sacar el pipe de la ruta) lo mata con 200 donde espera 400.

### La regresión: un cambio "solo de tipos" que rompió el esquema

Estrechar `Tenant.modoRedondeo` de `string` a la unión `ModoRedondeo` **rompió el arranque
de TypeORM**: `DataTypeNotSupportedError: Data type "Object" in "Tenant.modoRedondeo"`.
TypeORM infiere el tipo de columna del metadato `design:type`, y la unión entra por
`import type` —la referencia se borra al compilar—, así que el metadato queda en `Object`.
`nivel_redondeo` se salvó **por casualidad**: ya tenía su `type` declarado.

Lo que hay que llevarse no es el bug sino quién lo vio. **No lo vieron** el `typecheck`, el
`lint`, las 1996 pruebas unitarias, ni **dos revisiones independientes** —una de ellas
afirmó explícitamente *"cambio realmente sin conducta en runtime, confirmado"*, y era
razonable: los alias de tipo se borran en compilación—. Lo vio el **e2e**, en la primera
línea de la primera suite. Un decorador que lee metadatos de tipo convierte un cambio de
tipos en un cambio de runtime, y ahí la intuición de "esto no puede romper nada" falla.
El `type: 'varchar'` quedó con esa explicación al lado, porque es una línea que parece
redundante y no lo es.

### Las dos mediciones

- **`Scope.REQUEST` sobre `GET /items`.** Secuencial no se nota (los brazos se solapan);
  con 20 concurrentes sí, y en la cola: ~7% menos req/s y ~13% más p95. La tabla está en el
  docblock de `escala-moneda.pipe.ts`. **Subió a la sección 4** en vez de cerrarse: la
  salida que la entrada daba por conocida —"no colgar el pipe del handler de lectura"— no
  aplica, porque ya no cuelga de ahí; la única salida es partir el controller, y eso se
  pregunta.
- **"Moneda oficial" por dos criterios.** La pregunta era *"¿pueden divergir hoy?"*.
  Pueden: `setDefault` acepta cualquier moneda disponible en el país. Y **son tres caminos,
  no dos**: la entrada no nombraba a `LiquidacionPropinasService.resolverMonedaOficial`,
  que es el que decide con qué escala se reparte la propina. También subió a la sección 4.

### Lo que la ejecución desmintió del registro

- **Un minor ya estaba arreglado.** El ledger pedía corregir
  `motor-calculo-precios.md:231` (*"Impuestos sobre la base ya descontada/recargada"*, cierto
  en una sola rama). El caveat *"salvo la rama de góndola de arriba"* lo había agregado
  `a9892993`, el commit de cierre del frente, **posterior a la entrada**. No se tocó.
- **Un minor tenía un gemelo sin nombrar.** `usePropina.ts` no era el único sitio que
  redondeaba la propina a 0 decimales: `salones/index.vue` repetía la cuenta a mano para el
  ticket de precuenta. Apareció grepeando por **conducta** (total × porcentaje redondeado),
  no por el nombre de la función.
- **Un minor no se puede cerrar con una sola fuente.** De dónde saca la escala la propina
  sugerida costó **tres intentos, y la revisión independiente bloqueó los dos primeros**:
  con `monedaOficial` (la del país) el backend la rechaza con 400, porque valida contra
  `es_default`; con `es_default` el `MoneyInput` de al lado la trunca al mostrarla y se come
  los centavos al editarla. Quedó la **menor de las dos**, que cabe en ambas por
  construcción. Las dos fuentes estaban mal, en direcciones opuestas.

### La lección de proceso

La revisión independiente **bloqueó dos veces sobre el mismo punto** y las dos veces tenía
razón; la segunda desarmó un arreglo que yo ya había aceptado como bueno. Pero también
firmó LIMPIO el diff que rompía el esquema. Sirve para lo que puede ver —el diff— y no
sustituye a correr el sistema: **el e2e completo no es un trámite de cierre, es el único
que ejecuta el arranque real.**

---

## El redondeo de plata: el último decimal deja de decidirlo Postgres, y con eso cierra la tanda 🔴 (2026-08-21)

Cierra la entrada *"Cuatro redondeos de plata más que siguen en HALF_UP fijo"* con su
sub-punto ➕, que era la **última** de la sección de prioridad máxima y la que llevaba más
tiempo abierta (owner, 2026-08-11). Con ella **la tanda 🔴 queda vacía**: conexiones/deadlock
y rendimiento se habían cerrado el 2026-08-20.

**El problema, en una frase:** el sistema persistía **medio peso chileno** en ventas y
vueltos —una moneda que no tiene centavos— porque el último redondeo lo decidía el cast de
Postgres al entrar a `NUMERIC(18,4)`, fuera de la configuración del tenant. Consecuencias
medidas: `pagos.vuelto = 994942.5000` en la base de dev, y `FLOOR`, `CEIL` y `HALF_UP`
produciendo **el mismo total** sobre el mismo carrito, porque el cast los igualaba después.

Se hizo en un plan de 15 tareas con el sistema quieto, que es como la entrada exigía que se
hiciera. El aislamiento se ganó: **la tarea 14 destapó tres bugs de plata en el frontend
que el gate en verde no veía**, y uno de ellos lo introdujo el propio fix.

### Qué cubrió

- **El motor cuantiza a la escala de la moneda** (`moneda.decimales`, el minor unit) con el
  `modo_redondeo` del tenant, **al cerrar cada paso** de la fórmula y no dentro del bucle de
  reglas. `nivel_redondeo` (`linea` | `documento`) elige dónde cierra, con una matriz que
  rechaza con 400 las dos combinaciones sin sentido.
- **Los totales se derivan de sus componentes**, nunca se cuantizan aparte:
  `Σ totalLinea − dv + rv = totalFinal` exacto. Cuantizar cada total por su cuenta rompía
  `MntTotal = MntNeto − Desc + Rec + IVA` en **3.965 de 10.000** casos.
- **Con precio de góndola el total cierra a la etiqueta y el IVA absorbe el residuo**:
  993 → 834 + 159 = 993 (antes 992). Con descuentos o recargos aplicados vuelve
  `tasa × base`, que es lo correcto cuando el cliente ya no paga la etiqueta.
- **El borde HTTP rechaza con 400** la plata que no cabe en la moneda: decoradores
  `@EsMontoCobrado` / `@EsCosto` + `EscalaMonedaPipe`. Contado sobre el árbol final:
  **27 campos marcados** (15 monto cobrado / 12 tasa) en 20 DTOs, con el pipe colgado en
  **20 handlers de 11 controllers**.
- **La pantalla no la deja tipear** (máscara, no recorte al enviar).
- **La nota de crédito hereda el criterio congelado** en la venta que corrige y congela el
  suyo; el **callback de la pasarela** cuantiza y registra el valor original en vez de
  rechazar, porque informa un hecho consumado.
- **`ESCALA_COSTO = 4` pasa a ser un concepto nombrado** en vez de un `toFixed(4)` repetido
  a mano en 106 líneas de 17 archivos.
- **`CHECK (decimales BETWEEN 0 AND 4)`** en `moneda`: el único freno que impide que el
  cast vuelva a decidir en silencio.

**Lo que hereda por construcción, y era el argumento de cierre:** el vuelto quedó entero
**sin tocar `pagos.service.ts`**. Lo que no pasa por el motor no se cuantiza solo — o se
rechaza en el borde, o se deriva de algo que el motor ya cerró.

### Qué quedó afuera, y por qué

**Los cinco sitios en HALF_UP fijo de la entrada original NO cambiaron de modo, y es la
resolución correcta.** La entrada advertía que *"el criterio no es obvio y puede no ser el
mismo"*, y al abrirlos resultó que no lo es: el CPP de inventario, el `costoPropuesto` de
una receta y los de mermas son **tasas internas** —dinero por unidad, con costos por gramo
de menos de \$1—, no montos cobrables, así que la perilla del tenant (que es política de lo
que se le cobra al cliente) sesgaría la valorización en cada compra. El reparto de propinas
usa mayores restos justamente para que Σ partes = total, y ahí no hay "modo" que elegir,
solo un desempate determinista. **Lo que sí se arregló es el silencio**, que era la mitad
del problema: los cinco quedaron con el porqué escrito en el sitio, en vez de un `HALF_UP`
mudo que el próximo lector tuviera que interpretar como descuido. (El reparto de propinas
ya recibía los decimales de la moneda antes del frente: lo único que cambió ahí es el
comentario.)

Con entrada propia en [`pendientes.md`](pendientes.md), porque cada uno pesa por su cuenta:
el IVA vs el descuento de nivel venta (pesa más que todo esto y ninguna cuantización lo
arregla), la NC como documento, la denominación mínima de efectivo, los ~30 DTOs con
`@IsNumberString` sin trazar, el punto fijo de `MoneyInput` con monedas de más de 0
decimales, el punto ciego del `valor` de descuentos/recargos, el rename de
`moneda.decimales` y la UF como moneda oficial.

**Abierto y no bloqueante:** si `nivel = documento` + moneda de 0 decimales debe ser 400
duro (lo implementado) o un aviso que el admin pueda aceptar.

### Lo que lo fija

Los cuatro mutantes del plan mueren: `totalLinea` cuantizado por su cuenta, el impuesto del
desbruteo de vuelta a `Q(tasa × base)`, `cuantizar()` fuera del cierre de línea, y la NC
leyendo el modo vigente en vez del congelado.

### Las tres cosas que solo aparecieron ejecutando

1. **Un conteo del backlog que era falso, y de forma estructural.** La decisión (d) decía
   "8 tests de aceptación rompen": rompen **3**. Los specs de DTO usan `plainToInstance` +
   `validate()`, que **no ejerce el pipe** — la arquitectura movió la validación al borde
   HTTP y el conteo asumía que viviría en el decorador. Consecuencia medida, no supuesta:
   **la validación de escala no existe fuera del borde HTTP**.
2. **La spec se contradecía a sí misma** y solo se vio al correr: marcar `precioBase` como
   monto cobrado hacía que **la API rechazara su propia sugerencia de precio**. Un precio de
   lista es una **tasa**; cruza a monto cobrado recién en la multiplicación.
3. **El fix del frontend introdujo un bug peor que el que arreglaba**: tipear `1` `.` `5`
   `0` `0` en CLP guardaba **1** en vez de 1500, en silencio. El bug original al menos lo
   rechazaba el backend con 400. Se revirtió la máquina de estados y las tres migraciones a
   `decimales: 4`.

### La lección de proceso

**Los tests montaban `MoneyInput` sin `v-model` real**, así que ninguno de los tres bugs de
plata del frontend era visible para el gate — build, typecheck y las revisiones de código
pasaban en verde. Lo que los encontró fue reproducir **tecla por tecla** contra el
componente montado. Un componente de entrada de plata sin un test que simule tipeo real no
está probado, está compilado.

### La entrada, verbatim

Con la advertencia de siempre: **las citas de línea quedan como estaban** — describen el
código en el momento en que se midió el problema, no el de hoy.

> - [ ] **Cuatro redondeos de plata más que siguen en HALF_UP fijo, sin `modo_redondeo`**
>   (backend, **medido 2026-08-11 por la revisión del cierre de la conversión de moneda**)
>   — 🧱 **la segunda de las dos que quedan en esta sección: no se toca suelta.**
>   se abre esta entrada justo porque la que se cerró ese día, leída de más, los tapaba: el
>   arreglo alcanzó la cuenta `precio × tasa` y **nada más**.
>   - `inventario.service.ts` → **CPP** (`valorPrevio + valorEntrante` ÷ stock). Es una
>     **división**, así que redondea de verdad, y el resultado se persiste en
>     `item_producto.costo_actual`.
>   - `items.service.ts` → `costoPropuesto` de una receta (`ROUND_HALF_UP` explícito).
>   - `propinas/utils/mayores-restos.ts` → el reparto de propina entre garzones.
>   - `mermas.service.ts` (dos sitios) → costo × cantidad.
>   - `inventario.service.ts:818-821` → `cantidad × costoUnitario` del kardex. **Agregado el
>     2026-08-15 por la lente de dinero de la auditoría de `inventario`**, que lo encontró
>     buscando otra cosa. Es el mismo mecanismo sin consecuencia nueva, así que no abre
>     entrada propia — pero el título de arriba dice "cuatro" y **son cinco**: quien tome
>     esta entrada tiene que barrer, no ir a la lista.
>
>   Antes de replicar el arreglo: **el criterio no es obvio y puede no ser el mismo**. El de
>   la conversión se decidió porque el valor se persiste en `NUMERIC(18,4)`; el reparto de
>   propinas usa mayores restos justamente para que la suma de las partes dé el total, y ahí
>   cambiar el modo puede romper esa propiedad. Cada uno pide su análisis.
>
>   ➕ **En la misma familia, y más incómodo:** `subtotal`, `descuento_aplicado`,
>   `total_linea` y los totales de cabecera llegan del motor con `escala_calculo` decimales
>   (6 por default) y entran a columnas `NUMERIC(18,4)`. **Hoy ese recorte lo hace Postgres**
>   — que es exactamente el escenario que el docblock de `convertirAMonedaOficial` describe
>   como "lo que hay que evitar". Que ahí sea así y en la conversión no, es una
>   inconsistencia real; no se tocó porque queda fuera de lo que el owner pidió ("las
>   conversiones a moneda oficial") y porque cambiarlo mueve importes ya persistidos de forma.

📌 **La entrada tenía razón en la advertencia y se equivocaba en el título, otra vez.**
Decía "cuatro" y eran cinco —ya corregido en su propio texto el 2026-08-15— pero además
**el sub-punto ➕, que estaba escrito como apéndice, era el problema grande**: los cinco
sitios nombrados en el título terminaron sin cambiar de modo, y lo que rompía plata de
verdad era el recorte que hacía Postgres. Es la tercera vez que este backlog confirma lo
mismo: *una entrada es un punto de partida, no un enunciado verificado*.

---

## El N+1 de la personalización de recetas y combos: medido en las cuatro formas, y el que faltaba (2026-08-20)

Cierra la entrada *"N+1 al resolver personalización de recetas/combos"*, que estaba `[~]`
desde el 2026-07-27 y era la segunda de las tres de la tanda 🔴. **Se cerró midiendo**, que
es lo que la entrada pedía; el arreglo que salió de la medición no es el que la entrada
proponía.

**La medición** (stack de docker-compose, base recién sembrada, 30 repeticiones tras 3 de
calentamiento, fixtures propias por cliente concurrente para que la concurrencia no midiera
contención de stock):

| Carrito de 5 líneas | 1 cliente (p50) | 10 en paralelo (p50 / p95) | throughput |
|---|---|---|---|
| producto simple | 13.8 ms | 38.4 / 45.7 ms | 236 ventas/s |
| receta sin grupos | 16.9 ms | 47.5 / 52.7 ms | 197 ventas/s |
| receta con 2 grupos | 25.4 ms | 65.1 / 72.0 ms | 145 ventas/s |
| combo (1 receta ×2 unidades, 2 grupos c/u) | 34.0 ms | 84.2 / 91.3 ms | 112 ventas/s |

Y el conteo real de consultas por venta, leído del log de Postgres (`log_statement='all'`,
cada venta acotada entre dos `SELECT` de marca disparados por `psql`), 1 línea / 5 líneas:
simple 35/47, receta 40/68, receta con grupos 49/113, combo 61/173.

**Veredicto sobre lo que la entrada dejaba abierto —batchear *entre* líneas— : no se
encara.** Con diez cajas en paralelo y carritos de cinco combos, el peor caso realista, la
venta responde en 84 ms p50 y el sistema sostiene 112 ventas/s. Batchear entre líneas toca
~4 de las ~13 consultas extra por línea (el resto son escrituras de inventario, que no son
N+1), o sea ~11 ms de los 46 que separan ese carrito del de cinco productos simples — a
cambio de cambiar la firma de tres llamadores.

**Las tres afirmaciones de la entrada que la medición contradijo.** Van acá porque son el
rastro del error, no para reescribir la historia:

1. *"Las llamadas por línea corren dentro de un `Promise.all`, o sea en paralelo"* —
   **falso**. Las 68 sentencias de una venta de 5 recetas salieron **todas por el mismo
   backend de Postgres** (un único PID en el log): el `Promise.all` corre sobre el manager de
   la transacción, o sea una sola conexión, y `pg` las encola. Son viajes en serie. El propio
   driver lo dice en el e2e: *"Calling client.query() when the client is already executing a
   query is deprecated"*. ⚠️ Y lo más incómodo: esto **ya estaba escrito** en
   [`anti-patterns.md`](anti-patterns.md) § N+1 desde ADR-020 (*"dentro de una transacción,
   `Promise.all` de lecturas deja de paralelizar"*). La entrada del backlog siguió afirmando
   lo contrario nueve días — dos docs vivas con la misma afirmación en sentidos opuestos, y
   ningún gate que las cruce.
2. *"Hoy cada línea receta/combo cuesta 3 queries fijas"* — es el **piso**. Son 3 solo si el
   ítem no tiene grupos de modificadores asociados; con grupos son 4. La medición del
   2026-08-11 usó justamente la forma más barata.
3. **El combo nunca se midió**, y tenía un N+1 propio que la entrada no nombra: el que se
   cierra acá.

**Lo que sí se arregló** (`55c1cd5a`): `resolverPersonalizacionCombo` llamaba a
`resolverGruposDeItem` una vez por **(componente con grupos × unidad)**, y cada llamada
releía el catálogo entero — las mismas dos consultas con los mismos parámetros, tantas veces
como unidades tuviera el combo—, más una tercera consulta (`SELECT DISTINCT`) solo para
saber qué componentes tenían grupos. Ahora un helper carga el catálogo de N items en dos
consultas fijas y la resolución por unidad ocurre en memoria; el `SELECT DISTINCT`
desapareció porque el lote ya dice quién tiene grupos. `resolverGruposDeItem` recibe el
catálogo por un parámetro **opcional al final**, así ventas y salones no se tocaron — que era
exactamente el riesgo por el que la entrada se había frenado.

Medido después del cambio, con el mismo instrumento: un combo de una línea pasó de **61 a
57** consultas y uno de cinco líneas de **173 a 153**; las otras tres formas quedaron en el
mismo número al dígito, que es la prueba de que el cambio tocó solo el camino del combo. En
tiempo: 5×combo de 34.0 a 30.9 ms secuencial, y de 84.2 a 78.3 ms p50 con diez en paralelo
(112 → 119 ventas/s). La ganancia crece con las unidades del combo: el costo pasó de
`3 + 2 × Σunidades` consultas a **3 fijas**.

**Qué lo fija:** `items.service.spec.ts` → *"el catálogo de grupos se lee por lote: el conteo
no crece ni con las unidades ni con los componentes"*, sobre un combo de dos componentes con
tres unidades cada uno. El mutante que revierte el cuerpo del bucle al código anterior lo
pone rojo con **15 consultas contra 3**. El mock de ese test contesta **por el SQL y no por
el orden de llamada** a propósito: con una cadena de `mockResolvedValueOnce`, el regreso al
N+1 reventaba con un mock agotado y el error no decía nada de lo que el test protege.

**Frentes medidos y NO tomados**, con su número, para que el próximo no tenga que volver a
medirlos:

- **La configuración del tenant se relee entera en cada venta: ~17 consultas fijas**
  (unidades de medida, monedas, tenant, fórmula de precio, país, descuentos, recargos,
  impuestos, sus tramos, métodos de pago, tipos de regla). En una venta de una línea de
  producto simple son 17 de 35: **más de la mitad**, y no dependen del carrito. Es el lever
  más grande que apareció, y también el más caro: cachear config de tenant es diseño nuevo
  (invalidación, staleness) y va con spec propia, no de arrastre.
- **`SELECT Tenant` sale dos veces con el mismo parámetro en cada venta**: `TenantGuard`
  valida que el tenant existe y `getPreferenciasFinancieras` lo relee para las preferencias.
  Se dejó: sacarlo exige que el guard le pase la fila al service, o sea acoplar el servicio al
  estado del request para ahorrar dos consultas.
- ⚠️ **Lo que NO es un duplicado, para no volver a reportarlo:** los dos `SELECT TipoRegla`
  que salen seguidos. Se verificaron los parámetros y son conjuntos de ids distintos
  (descuentos por un lado, recargos e impuestos por el otro).

## El orden de bloqueo de filas de la bandeja de desfases: los dos ciclos, los `FOR UPDATE` antes de validar el tenant, el test de N combos y el orden intra-tabla (2026-08-20)

Cierra el ⚠️ *"Lo que este cierre NO incluye"* de la entrada de acá abajo (*"Diez ventas
simultáneas cuelgan la API para siempre"*): los cuatro puntos que ADR-020 no tocaba, más
un quinto que apareció revisando el arreglo del segundo.

**Cerrado el 2026-08-20, en seis tareas** (spec
[`2026-08-19-orden-de-locks-desfases-design.md`](../superpowers/specs/2026-08-19-orden-de-locks-desfases-design.md),
plan homónimo en `docs/superpowers/plans/`).

**Lo que quedó escrito como regla, y es lo que hay que leer antes de volver a tocar estas
tablas:** el orden de bloqueo es `item_receta` → `item_combo` → `items`, y **dentro de cada
tabla las filas se piden ordenadas por `item_id`**. Un camino puede saltear tablas; no puede
invertirlas. Vive en [`../patterns/backend.md`](../patterns/backend.md) § "Orden de bloqueo
de filas en ítems compuestos", con la tabla de qué test fija cada camino.

- **`items` ↔ `item_combo`** (`32297901`) — `update()` de un combo toma
  `SELECT item_id FROM item_combo … FOR UPDATE` **antes** del `UPDATE items`, bajo el guard
  idéntico al del branch que después escribe `item_combo`
  (`tipo === 'combo' && dto.componentes !== undefined`). Es el gemelo exacto del lock de
  receta que ya existía. **Qué lo fija:** `items.service.spec.ts` → *"toma `item_combo`
  ANTES del UPDATE items — orden de locks contra aplicarDesfases"*, y tres mutantes del
  revisor: sacar el lock (archivo byte-idéntico al commit anterior, o sea revert real y no
  "romper algo"), moverlo **después** del `UPDATE items` (typecheck limpio, test rojo → el
  test fija la dirección, no la mera presencia) y ensanchar el guard a `tipo === 'combo'`
  (dos tests rojos → el ancho tampoco puede derivar en silencio).
- **`item_receta` ↔ `item_combo`** (`ecf7332e` + `27323a25`) — `descartarDesfases` pasó de
  un loop único en el orden del cliente a **dos pasadas, recetas primero**, y **cada pasada
  ordenada por `item_id`**. No toma ni un `FOR UPDATE`: el arreglo no fue agregar locks sino
  fijar el orden en que sus `UPDATE` los toman solos.
  ⚠️ **El `.sort()` no estaba en el plan.** Salió de la revisión de esa tarea: alinear el
  orden **entre** tablas dejaba vivo el ciclo **dentro** de una tabla —dos recetas, sin
  ningún combo de por medio, en lotes con sentidos opuestos—, que el reproductor e2e no
  cubre porque usa exactamente una receta y un combo. Decisión del owner (2026-08-19):
  cerrarlo ahí mismo, contra la línea del brief que pedía conservar el orden de `itemIds`.
  **Qué lo fija:** los dos `it` de `items.service.spec.ts` —*"descartar escribe
  `item_receta` ANTES que `item_combo`…"* y *"descartar ordena por `item_id` DENTRO de la
  pasada de recetas…"*— más los dos `it` del reproductor e2e. **Efecto observable
  deliberado:** en un lote mixto con errores en los dos tipos ahora falla primero el de la
  receta, y dentro de una pasada sale primero el error del `item_id` menor, no el del que
  vino primero en el lote.
- **Los `FOR UPDATE` antes de validar el tenant** (`15a557cf`) — `cabecerasCompuestas`, que
  es quien filtra `tenant_id`, subió **arriba** de los dos locks de `aplicarDesfases`. Lee
  `items` sin lock, así que subirla no toma nada por adelantado. Un id de otro tenant deja
  de bloquear filas ajenas hasta el rollback del 404. **Qué lo fija:** *"valida el tenant
  ANTES de tomar los locks"*, y el mutante del revisor (volver el service a la versión
  anterior) que lo pone rojo.
- **El test de lecturas constantes para N combos** (`4895ec78`) — la rama de combos se
  ejercitaba con **un** combo. Ahora *"aplicar sobre N combos hace lecturas CONSTANTES, no
  por combo"* fija **4 SELECT** para un lote de 3 combos (cabeceras, los dos locks y los
  componentes), el gemelo del de recetas que fija 5. El revisor contó las queries por su
  cuenta, escribió un mutante N+1 distinto al del reporte (7 vs 4) y verificó que el loop de
  combos **se ejecuta** —`aplicados = 3` y tres `UPDATE item_combo`—, o sea que el test no
  pasa en verde por abortar antes.

**El reproductor, y qué reportó el spike que lo eligió** (`b49b4fe1` rojo, `08926ffe` y
`cbc5fc45` las dos rondas de revisión —
`backend/test/orden-locks-desfases.e2e-spec.ts`, 4 `it`):

- **El mecanismo elegido es determinista, no una ráfaga.** Una compuerta (un `QueryRunner`
  propio con un `FOR UPDATE` sobre la fila del combo) retiene esa fila mientras entran las
  dos requests y recién después la suelta. Las dos puntas del abrazo son transacciones
  reales del service por HTTP, ninguna es una réplica a mano de su SQL. Medido: 10 de 10
  corridas, exactamente 1 deadlock y 1 víctima. La alternativa —ráfaga de 8 requests en
  órdenes alternados— también reproducía 10/10, pero con 4 a 6 víctimas por corrida y sin
  distinguir "se abrazaron por orden opuesto" de contención bruta; quedó descartada con su
  medición.
- **El spike refutó la hipótesis con la que se escribió el plan:** la cola FIFO de Postgres
  no impide el ciclo — **lo construye**, si se la usa para ordenar la **entrada** de las dos
  requests en vez de su salida.
- **Y corrigió un dato falso del brief:** no hace falta un desfase pendiente para que el
  lock se tome. `descartarDesfases` escribe `costo_propuesto_omitido` de forma
  **incondicional**; solo exige que la receta tenga ingredientes y el combo componentes.
- **Dos hallazgos de revisión que cambiaron el spec, no el código.** (a) `{statuses:[201,201],
  deadlocksNuevos:0}` es también la salida exacta de una compuerta que no engancha, así que
  el verde no era falsable: se agregó `esperandoLockEnLaCompuerta`, que cuenta los esperadores
  en `pg_stat_activity` justo antes de soltar la compuerta y afirma **2**. (b) El spec no
  fijaba la **dirección** del orden: un fix que bloqueara `item_combo` antes que
  `item_receta` lo ponía entero en verde. Se agregó el `it` **cruzado** —`descartar([combo,
  receta])` contra `aplicar` del mismo par—, que solo se apaga con el orden canónico porque
  el `FOR UPDATE` de `aplicarDesfases` no depende del orden del cliente.
- **Su alcance es angosto y el encabezado lo declara:** cubre `descartar` contra `descartar`
  y `descartar` contra `aplicar`, con una receta y un combo. No dice nada del alta ni de la
  edición de ítems compuestos, ni del orden intra-tabla. Leerlo antes de citarlo como
  evidencia de algo más ancho.

⚠️ **Lo que este cierre NO incluye:** `descartarDesfases` calcula el costo propuesto con
lecturas **sin lock** y recién después escribe `costo_propuesto_omitido`, así que un
`aplicar` concurrente puede mover el número en el medio. No es un deadlock —no abraza a
nadie, escribe tranquilo un valor viejo—; por decisión del owner (2026-08-19) se anota y no
se arregla en esta pasada. Queda abierto en [`pendientes.md`](pendientes.md) § 2, "Medir
primero".

### La entrada, verbatim

- [ ] 🧱 **Dos ciclos de orden de lock en la bandeja de desfases de combos, los `FOR
  UPDATE` que se toman antes de validar el tenant, y el test de lecturas constantes que
  falta para N combos** (backend, visto el 2026-08-18 al meter los combos en la bandeja de
  desfases — pieza residual de "Diez ventas simultáneas cuelgan la API para siempre", cuyo
  agotamiento de pool **se cerró** el mismo día con contexto transaccional ALS: ver
  [`resueltos.md`](resueltos.md) y [ADR-020](../adr/020-contexto-transaccional-als.md)).
  Va con las otras dos de esta sección: rendimiento y redondeo. **Mecanismo distinto al
  deadlock ya cerrado**: esto es orden de locks de fila entre dos tablas, no agotamiento del
  pool de conexiones — ADR-020 no lo toca ni lo arregla.

  1. **`items` ↔ `item_combo`.** Los dos son el gemelo exacto del ciclo que el comentario de
     `items.service.ts:1330-1338` dice haber neutralizado para recetas, y ninguno existía
     antes del commit del 2026-08-18 — hasta entonces ningún camino de desfases tocaba
     `item_combo`. `aplicarDesfases` toma `item_combo … FOR UPDATE` y después
     `UPDATE items SET precio_base`; `update()` de un combo con `dto.componentes` hace lo
     inverso —`UPDATE items` y después `UPDATE item_combo`— porque su lock previo está
     guardado por `tipo === 'receta'`. **Disparo:** un `PATCH` de combo (nombre +
     componentes) concurrente con un "aplicar desfase de ese combo" con `actualizarPrecio`.
     **Fix identificado:** extender ese guard para que un `PATCH` de combo tome
     `item_combo FOR UPDATE` antes del `UPDATE items`. Mueve la secuencia de queries de
     `update()`, así que arrastra los tests posicionales de `update`/`remove` de combo.
  2. **`item_receta` ↔ `item_combo`.** `descartarDesfases` no toma ningún lock y escribe las
     dos tablas en el orden que manda el cliente, mientras `aplicarDesfases` las ordena
     siempre receta → combo. **Disparo:** `descartar([combo, receta])` contra
     `aplicar([receta, combo])`, o dos `descartar` con las mismas filas en orden distinto.
     Es el más alcanzable de los dos: se dispara entre dos operaciones de la propia bandeja,
     o sea con dos personas resolviéndola a la vez. **Fix identificado:** que el loop de
     `descartarDesfases` procese las recetas antes que los combos, igual que aplicar. No
     necesita locks nuevos ni toca ningún camino preexistente.
  3. **Los locks de `aplicarDesfases` se toman antes de validar el tenant** (visto el
     2026-08-18, en la revisión final de esa misma tarea). `cabecerasCompuestas` valida
     `tenant_id` **después** de los dos `FOR UPDATE`, así que un usuario autenticado que
     mande ids de otro tenant bloquea esas filas hasta el rollback del 404. No hay fuga de
     datos: el 404 sale igual y no devuelve nada del otro tenant. Es forma **preexistente**
     para `item_receta` que ese día se extendió a `item_combo`. Va acá y no suelto porque el
     fix —validar el tenant antes de tomar el lock— mueve el lugar de los locks, que es el
     mismo frente que esta tanda difiere.
  4. **No hay test de lecturas constantes para N combos** (visto el 2026-08-18, misma
     revisión). El gemelo de recetas existe y es fuerte (`items.service.spec.ts`, caso
     "aplicar sobre N recetas hace lecturas CONSTANTES", 5 SELECT fijos), pero la rama de
     combos solo se ejercita con **un** combo: un N+1 futuro ahí no lo caza nadie.

  **Ninguno de los cuatro lo ve un test**: el e2e corre con `maxWorkers: 1`
  (`test/jest-e2e.json`), la misma razón por la que el deadlock de conexiones pasó
  desapercibido antes de esta tanda.

---

## Diez ventas simultáneas cuelgan la API para siempre: el pool de conexiones deja de agotarse (2026-08-18)

**Diez ventas simultáneas cuelgan la API para siempre** (backend, medido 2026-08-11) —
dentro de una transacción abierta, `crearEnTransaccion` y otros 20 sitios llamaban a
services que tomaban una conexión **nueva** del pool en vez de usar el `manager` de esa
transacción. Cada operación necesitaba dos conexiones a la vez; con N operaciones
simultáneas y N = tamaño del pool, deadlock **permanente** — no un timeout, las requests no
vuelven nunca y el proceso queda envenenado hasta reiniciar. Medido por experimento: 9 ok /
10 cuelga con el pool en 10; subiendo el pool a 20, 19 ok / 20 cuelga — el número de
conexiones ES la variable, subir el pool solo mueve el umbral. **REINCIDIÓ el 2026-08-15**,
en código nuevo (`auth.service.ts → refresh`), cuatro días después de documentarse la causa
acá: la vía fue envolver código viejo en una transacción nueva, invisible a cualquier grep
de "llamada agregada". Documentar la causa no bastó para evitar la reincidencia.

**Cerrado el 2026-08-18, en diez tareas** (spec
[`2026-08-18-contexto-transaccional-als-design.md`](../superpowers/specs/2026-08-18-contexto-transaccional-als-design.md),
plan homónimo en `docs/superpowers/plans/`). El fix elimina el patrón **por construcción**,
no por disciplina — el detalle completo, con las alternativas descartadas y sus porqués, en
[ADR-020](../adr/020-contexto-transaccional-als.md):

- **`TxContext`** (`backend/src/common/db/tx-context.ts`): un
  `AsyncLocalStorage<EntityManager>` que ata el manager de la transacción activa a la
  operación en vuelo — al árbol async de esa request, no a un campo compartido.
- **`Db`** (`db.service.ts`): única puerta al acceso a datos fuera de repos —
  `transaccion(fn)` (abre la transacción la primera vez, **reusa** el manager si ya hay una
  activa), `query(sql, params)`, `sinTransaccion(fn)` (salida explícita para lo que necesite
  deliberadamente una conexión propia).
- **Repos como proxies context-aware** (`repositorios.module.ts`, reemplazo drop-in de
  `TypeOrmModule.forFeature`): bajo el **mismo token** de `@InjectRepository`, resuelven el
  manager del contexto en cada acceso a propiedad. Los ~441 accesos a repos en 38 services
  **no se editaron** — motor de precios incluido.
- **Barrido mecánico** sobre todo `backend/src`: 76 `dataSource.transaction(...)` →
  `db.transaccion`, 134 `dataSource.query(...)` → `db.query` (el seeder, con 99 más, quedó
  afuera a propósito: corre al boot, sin concurrencia). Los **21 sitios** de la tabla
  original quedaron cubiertos sin tocarlos: en cuanto la transacción que los envuelve
  registra su manager, cada uno lo resuelve solo.
- **Defensa en profundidad**: pool explícito + `connectTimeoutMS` en `app.module.ts` (un
  fallo futuro da 500 ruidoso con stack trace, no cuelgue silencioso) y una familia de
  **cuatro** selectores de lint (`no-restricted-syntax`, `eslint.config.mjs`) sobre
  `src/**/*.ts`, con `src/common/db/**`, el seeder y `*.spec.ts` afuera: acceder a
  `dataSource.query`/`.transaction`/`.manager`/`.createQueryRunner`, inyectar con
  `@InjectDataSource()`, declarar un parámetro de constructor tipado `DataSource`, y
  **registrar un módulo con `TypeOrmModule.forFeature`** en vez de
  `RepositoriosModule.forFeature`. Este último llegó último y es el que más pesa: es la
  precondición del mecanismo —sin ese registro el proxy no aplica y no hay nada que el
  resto de la regla proteja—, y fue el hallazgo Critical de la revisión independiente de la
  Task 9. Vive en `lint:check`: gate local, pre-commit y CI.
- **Test de ráfaga** (`test/concurrencia-pool.e2e-spec.ts`, N=10=tamaño del pool contra
  `POST /ventas` por HTTP real, no `supertest` sin listener): RED antes del fix (colgaba
  indefinido), GREEN después. **Mutante que lo fija** (revertir el proxy a ignorar el
  `TxContext`, sin commit — no deja rastro en el árbol): la ráfaga dio **10/10 en 500 en
  ~6.87 s** — el pool timeout de la defensa en profundidad convierte el deadlock en un fallo
  rápido y ruidoso, no en un cuelgue indefinido; revertido el mutante, verde en 1.9 s.

⚠️ **Lo que este cierre NO incluye** (decía además "y sigue abierto en `pendientes.md` § 🔴"
hasta el 2026-08-20, cuando se cerró — está arriba en este mismo archivo, § "El orden de
bloqueo de filas de la bandeja de desfases")**:** los dos ciclos
de orden de lock de la bandeja de desfases de combos (`items` ↔ `item_combo`, `item_receta`
↔ `item_combo`), los `FOR UPDATE` de `aplicarDesfases` que se toman antes de validar el
tenant, y el hueco de test de lecturas constantes para N combos — mecanismo distinto (orden
de locks de fila entre tablas, no agotamiento del pool de conexiones), que este trabajo no
toca ni arregla. Ver más abajo en este mismo archivo § "El orden de bloqueo de filas de la
bandeja de desfases", que es donde se cerró.

**Límites conocidos del mecanismo** (declarados en el ADR desde el cierre, no descubiertos
después — detalle completo en ADR-020 § Consequences): el proxy de repos no cubre
`getTreeRepository`/`autoLoadEntities`/`targetEntitySchema`/un segundo `dataSource`; la
regla de lint es *name-based* (un alias de importación la esquiva) y ataca el chokepoint de
**inyección**, no cada uso (una función libre que recibe `DataSource` por parámetro, como
`nombre-sugerido.util.ts`, queda fuera por diseño); ningún e2e ejercita `suscripciones` ni
`pasarela` contra el camino ALS, solo los unit tests de esos services; y los `Promise.all` de
lecturas dentro de una transacción se serializan sobre un único `pg.Client` y emiten un
`DeprecationWarning` de `pg` (`calculo-precios.service.ts`, dos sitios) — anotado como
pendiente propio en `pendientes.md` § "Necesita que el owner conteste", porque tocar el
motor de cálculo de precios exige autorización explícita del owner y no se resolvió en esta
tanda.

Commits principales: `ba9e08d8` (pool explícito + `connectTimeoutMS`), `6f2e5238` (burst
e2e RED), `6b12e09d` (`TxContext` + `Db`), `270391c2` (proxy de repos), `33d3a7b3` (camino
de la venta, burst GREEN), `ec2e3d7b`/`9f025fb6` (barrido del resto del backend),
`6f26016f`/`19fc8d00`/`b06dbfdd` (regla de lint, endurecida en dos rondas) y `440c3364`
(el cuarto selector: `TypeOrmModule.forFeature`, que reabría el chokepoint de registro).

---

## El costo de un combo se queda viejo y nadie avisa, a diferencia de las recetas (2026-08-18)

**El costo de un combo se queda viejo y nadie avisa, a diferencia de las recetas**
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
✅ **DECIDIDO (owner, 2026-08-15): los combos entran a la misma bandeja de desfases que las
recetas.** Un solo lugar donde mirar, y el margen que muestra el listado deja de mentir.
ℹ️ Con esto **no** hay que tocar `simulador-impacto-costos.md` para declarar una exclusión: la
exclusión desaparece.

**Construido el 2026-08-18, en cuatro commits.** Primero un renombre sin cambio de
comportamiento —la bandeja de recetas pasó a hablar de "items compuestos" (`/desfases`,
`DesfaseItemDto` con `itemId`/`tipo`/`afectados`, `itemsAfectadosPorInsumo`)— y recién
sobre esa base entró el combo:

- **El costo propuesto de un combo es `Σ(costo_actual CACHEADO del componente × cantidad)`**,
  la misma fórmula del alta/edición. **No** se expande la receta hasta sus ingredientes.
  Consecuencia deliberada: si sube un ingrediente de una receta que el combo contiene, la
  receta aparece desfasada y **el combo no**, hasta que se aplique el desfase de esa receta —
  dos pasadas, no un bug. A diferencia de una receta, un combo **nunca** tiene el caso "sin
  costo proponible": no hay conversión de unidades en la fórmula.
- **Segunda pasada resuelta por el propio endpoint:** `POST /desfases/aplicar` devuelve
  `{ aplicados, omitidos, afectados }`. `afectados` son los combos que quedaron desfasados por
  las recetas de ese mismo lote, leídos con el `EntityManager` de la transacción (ven la
  escritura antes del commit). El panel no se cierra: los muestra como filas nuevas.
- **Lote mixto:** si un lote trae una receta y el combo que la contiene, el combo se omite
  (no se aplica con el costo viejo de la receta) y vuelve en `afectados` con el número
  correcto para que el usuario lo confirme.

**Hallazgo que esta entrada no nombraba, y que bloqueaba el modal para cualquier combo:**
`itemsAfectadosPorInsumo` (entonces `recetasAfectadasPorIngrediente`) exigía
`tipo='ingrediente'` en el item consultado. Comprar un **producto** —el tipo que sí puede ser
componente de un combo— devolvía `404`, y `useSimuladorDesfases.maybeAbrirDesfases` se lo
tragaba en un `catch` vacío ("no bloquear el flujo que disparó el chequeo"). Resultado: ningún
modal se abría nunca para un componente de combo, en ningún escenario, y nada lo hacía
visible porque el error no llegaba a ningún toast. Ahora el guard acepta
`tipo IN ('ingrediente', 'producto')`.

**Costo aislado del riesgo de concurrencia que esto introdujo:** un lote mixto obliga a
bloquear `item_receta` y `item_combo` en el mismo `aplicarDesfases`, y eso abre dos ciclos de
orden de lock nuevos. Por decisión del owner (2026-08-18) **no se arreglaron acá**: quedaron
documentados dentro de *"Diez ventas simultáneas cuelgan la API para siempre"* en
[`pendientes.md`](pendientes.md) (buscar "Dos ciclos de orden de lock"), con la tanda 🔴 de
prioridad máxima — conexiones, rendimiento y redondeo de plata — juntas y aisladas.

**Qué lo fija:** `items.service.spec.ts` — `costoPropuestoCombo` con componente `servicio`
(aporta 0), el ejemplo numérico del efecto cascada (Hamburguesa `1200→1350`, combo
`1700→1850`), el lote mixto que omite el combo y lo devuelve en `afectados`, y
`itemsAfectadosPorInsumo` aceptando un `producto`. E2E en `simulador-costos.e2e-spec.ts`.
Documentación: [`simulador-impacto-costos.md`](../features/simulador-impacto-costos.md) §
"Reglas de desfase de un combo", y [`combos.md`](../features/combos.md) ya no lista el
recálculo silencioso como exclusión.

---

## El PIN que no servía y el guardado de roles a medias (2026-08-16)

Dos entradas de *"Medir primero"*. Una tercera —el scoping de escritura de caja— se midió en
la misma pasada y **no se construyó**: sigue abierta y reescrita, ver más abajo.

### La baja "sigue" avisa cuando el PIN que entrega no va a funcionar

`aplicarBajaDeCuenta` desvinculaba y escribía el PIN sin mirar `garzon.activo`. Si el garzón
ya estaba desactivado, la respuesta decía `accion: 'desvinculado'` con un PIN de 6 dígitos en
claro —la única vez que ese PIN existe fuera de la base— que **no opera**, porque
`verificarPin` filtra `activo: true`. Nadie se enteraba hasta que la persona lo tecleaba.

**Medido: es alcanzable sin que nadie haga nada raro.** `PATCH /garzones/:id` deja desactivar
un garzón vinculado, sin ningún guard que lo impida, y quien da de baja la cuenta no
necesariamente sabe en qué estado quedó el garzón.

Ahora `aplicarBajaDeCuenta` devuelve `{ aplicado, garzonActivo }` y la respuesta de la baja
suma `advertencias`. **Advierte y no bloquea**, mismo criterio que las de `actualizar()`:
quien da la baja puede querer el PIN igual porque va a reactivar al garzón después, y
negárselo lo dejaría sin ninguna credencial que entregar.

`garzonActivo` se lee **antes** de escribir, y ese orden es la conducta: la rama `no-sigue`
pone `activo = false` como su efecto, así que leyéndolo después toda baja `no-sigue` se
reportaría como "desactivado" y el aviso perdería el significado. Hay un test dedicado a eso.

⚠️ **Anotado porque cambia cómo leer esto: `DELETE /tenants/members/:userId` no tiene
pantalla.** El único `DELETE` de `configuracion/usuarios/index.vue` es el de roles. El flujo
entero de la baja —incluido el PIN en claro "una sola vez"— es API pura hoy. El arreglo va
igual en la respuesta, que es el contrato y donde lo va a leer la pantalla cuando exista,
pero **no hay usuario que vea esta advertencia todavía**.

### El editor de roles ya no deja el backend y la pantalla diciendo cosas distintas

`configuracion/usuarios/index.vue` agregaba los roles nuevos en un loop y quitaba los sacados
en otro, y desde el 2026-08-16 `DELETE /roles/:id/users/:userId` puede responder 400 (dejaría
al tenant sin ningún administrador). **Medido: ese 400 es alcanzable desde esa misma
pantalla** — el único admin se edita a sí mismo y se destilda "Administrador".

Se arreglaron las dos mitades:

- **Quitar corre primero.** El camino que puede fallar es el primero que sale, así que lo
  normal es que un guardado rechazado **no deje nada aplicado**. Antes, agregando primero,
  los agregados quedaban escritos y el quitado no.
- **El estado local sale de lo APLICADO, no de lo pedido**, y se recalcula en el `finally`.
  Eso cubre lo que el orden solo no arregla —dos bajas donde la segunda falla— y de paso hace
  correcto el reintento: `guardar()` recalcula el diff desde `member.roles`, así que apretar
  Guardar de nuevo manda lo que falta y no lo que ya se aplicó.

**No se construyó el endpoint transaccional** que la entrada dejaba como opción. Son N
requests que no se pueden agrupar desde el cliente, sí, pero inventar una ruta nueva para
esto es la arquitectura nueva para un problema chico que `CLAUDE.md` descarta. Lo que el
usuario necesita —que la pantalla no mienta y que reintentar funcione— se resuelve sin ella.

### Los mutantes

| Mutante | Qué cae |
|---|---|
| `garzonActivo` leído después de escribir | 1 unit: `no-sigue` reportaría "desactivado" siempre |
| Agregar antes que quitar (el orden viejo) | 2 tests del editor de roles |
| Estado local desde `seleccion` en vez de lo aplicado | 1 test: el de la baja parcial |

### Lo que NO se construyó, y por qué

La entrada del **scoping por tenant de la escritura de caja** afirmaba que sacar el filtro
*"cuelga la corrida"*. Se midió y **es falso**: el spec da 35/35 en 8,5 s con el filtro
sacado. Lo que pasa es que **el mutante sobrevive**, porque las tres defensas son redundantes
en la dimensión del tenant. Lo único que la primera aporta sola es no tomar un `FOR UPDATE`
sobre la fila de otro tenant antes de rechazar — y fijar eso pide mirar `pg_locks`, o sea el
frente 🔴 de conexiones/deadlock, que va aislado. La entrada quedó **reescrita, no cerrada**,
y el docblock de `caja.e2e-spec.ts` corregido para que nadie vuelva a planificar sobre un
cuelgue que no existe.


## `impuestos` entra a la familia de la unicidad de nombre, y eran cinco piezas (2026-08-16)

Era la única de los nueve catálogos sin índice único de nombre por tenant. Ahora lo tiene,
con la misma forma que sus ocho hermanas: `ON (tenant_id, lower(nombre)) WHERE eliminado_el
IS NULL`.

**Lo que la entrada subcontaba, y por eso vale anotarlo.** La entrada pedía un índice y
dejaba abiertas dos preguntas. Las dos se contestaron y ninguna era el problema:

- *¿Las filas del catálogo del país romperían un índice por tenant?* **No.**
  `CHK_impuestos_scope` fuerza `tenant_id` XOR `pais_id`, las de país tienen `tenant_id`
  nulo, y en Postgres dos NULL nunca colisionan en un índice único.
- *¿La unicidad debe incluir al IVA?* **No puede**, por ese mismo CHECK: el IVA es de país.

Lo que sí era el problema no estaba en la entrada: **`impuestos.service.ts` no tenía nada
de lo que las hermanas sí**. Ni pre-chequeo de nombre en `create`/`update`, ni `catch` del
`23505` en `restaurar()`, ni `GET /nombre-disponible`, ni frontend que lo consuma. El
índice solo —que era lo que la entrada pedía— **convertía tres caminos silenciosos en tres
500 crudos**. Se construyeron las cinco piezas.

**La consecuencia que justificaba la entrada, verificada y no solo citada.** El motor de
precios emite un aviso por impuesto pausado con el nombre en el título (`Impuesto
"<nombre>"`, `calculo-precios.engine.ts`), y `sinRepetidas()` deduplica por
`JSON.stringify([titulo, detalle])`. Dos impuestos pausados distintos con el mismo nombre
colapsaban en un solo aviso. El mismo archivo ya deduplica el aviso de *ítem* pausado por
`itemId` y no por texto, con el comentario *"dos ítems distintos pueden llamarse igual, y
acá el id está a mano"* — o sea que el codebase ya sabía que deduplicar por texto está mal
donde podía evitarlo.

**Una decisión que no hizo falta llevarle al owner, porque medirla la cerró.** El índice no
cruza tenant y país: un tenant puede llamar "IVA" a un impuesto propio. Antes de tratarlo
como regla de negocio pendiente se midió la pantalla: `impuestos.vue` ya rinde un badge
**Sistema / Personalizado** por fila (`origen`), así que las dos filas homónimas no son
indistinguibles — que era el problema que esta entrada venía a cerrar. El aviso de doble
tributación de ADR-018 sigue siendo aviso y no bloqueo, como el owner decidió.

**El orden del índice en el seeder no es cosmético.** Va **después** de
`remapImpuestosOficialesDuplicados()`, no al principio de la función como en las hermanas:
ese barrido soft-deletea los duplicados de IVA del tenant, y el índice es parcial. Creándolo
antes, una base con un duplicado vivo haría fallar el `CREATE UNIQUE INDEX` y **el backend
no arrancaría**.

**Los mutantes.** Tres, todos revirtiendo al código anterior:

| Mutante | Qué cae |
|---|---|
| Sin el índice (seeder + `DROP INDEX`) | 2 e2e: la forma del índice y el restaurar con colisión |
| Sin el `catch` del `23505` en `restaurar()` | 1 e2e: el 400 con `nombreSugerido` |
| Sin el pre-chequeo en `create()` | 1 unit y 1 e2e — y este es el que **demuestra el punto de la tanda**: el e2e recibe **500 en vez de 400**, que es exactamente lo que habría pasado agregando el índice solo |


## La ficha del garzón deja de mentir sobre lo que la cuenta puede (2026-08-16)

Dos entradas de la sección *"Medir primero"*, cerradas juntas porque la propia entrada ya lo
decía: *"las dos son 'la ficha no sabe algo que necesita para no mentir', y probablemente se
resuelvan con la misma consulta"*. Lo eran.

**Lo que la medición contradijo.** Las dos entradas proponían colgar el dato *"al abrir la
ficha (una consulta, no N)"*, y descartaban el listado porque *"serían N subqueries de RBAC en
una ruta caliente"*. Las dos premisas resultaron falsas, cada una por su lado:

- **No hay dónde colgarlo al abrir la ficha:** `GET /garzones/:id` **no existe**. El drawer se
  alimenta de la lista ya cargada (`garzonEnEdicion` es un `computed` sobre ella), así que
  abrirlo no hace ninguna request.
- **El listado no es un N+1.** Medido con `EXPLAIN (ANALYZE, BUFFERS)` sobre los 22 garzones
  del tenant más grande: Postgres resuelve los `EXISTS` como subplanes correlacionados dentro
  de **una** ida y vuelta — **2,05 ms** contra **0,118 ms** del listado pelado, todo index scan
  y todo shared hit. Son N subplanes, sí; no son N round-trips, que es lo que el proyecto llama
  N+1.

Lo que **sí** resultó cierto, y es la razón real del diseño elegido: `GET /garzones` lo cargan
**seis** pantallas (`salones/index.vue`, `sesiones-garzon`, dos de propinas,
`propinas-distribucion` y esta), y **solo esta** usa los campos. Por eso son **opt-in**
(`?conPermisos=true`) y no default: no por N+1, sino por no cobrarle ~1,9 ms de RBAC a la
operación del salón para nada.

**El rótulo que mentía no era teórico.** La salida `no-sigue` de la baja de membresía produce
**a propósito** un garzón `activo = false` vinculado a una cuenta que ya no es miembro. Esa
persona no puede entrar a fijarse el PIN —`fijarMiPin` resuelve por `garzonPersonalDe`, que
filtra la membresía viva → 404— y el badge le decía al encargado *"Sin PIN todavía"*, cuyo
significado documentado es *"la persona lo resuelve desde su perfil"*. Contado sobre la base de
dev: **3 de 13** garzones vinculados estaban en ese estado, los tres con el rótulo de la espera
normal. Ahora dicen *"Sin PIN: su cuenta ya no es miembro"* (`error`).

**El botón que se iba solo.** El único afordance para dar `Salones:Operar` vivía en un toast
con temporizador. Sigue existiendo —es la respuesta a lo que se acaba de guardar— pero la ficha
ahora tiene una fila *"Modo personal"* con el estado y el mismo botón, sin temporizador, que
además se actualiza en el acto sin recargar el listado.

**Qué se construyó.** `GarzonPublico` suma `cuentaEsMiembro` y `puedeOperarSalon`, los dos
`null` cuando no hay cuenta (la convención que ya usaba `GarzonConAdvertencias`: `null` es *"la
pregunta no se hizo"*, distinto de *"se hizo y da que no"*). Los resuelve `factsDeCuentas()` en
**una** query con `unnest($2::uuid[])`. `esMiembro` se pregunta con un `EXISTS` y no con un
`JOIN` desde `usuarios_tenants` a propósito: si la cuenta dejó de ser miembro no hay fila que
traer, y un `JOIN` la haría desaparecer del resultado en vez de devolver `false` — que es
exactamente el caso a detectar.

De paso, el criterio de `Salones:Operar` quedó en **un solo lugar** (`sqlPuedeOperarSalon()`).
Era una copia de `RbacService.userHasPermiso` que ya se había desincronizado una vez, y este
cambio iba a agregar una tercera; ahora hay un único sitio donde traerla al día.

**Los mutantes.** Tres, todos revirtiendo al código anterior, no rompiéndolo:

| Mutante | Qué cae |
|---|---|
| `badgePin` sin el chequeo de `cuentaEsMiembro` | 1 test: *"cuenta que ya NO es miembro…"* |
| La fila *"Modo personal"* fuera de la ficha | 3 tests de la ficha |
| `listar()` ignorando `conPermisos` | 4 de los 5 e2e nuevos — y **no** el que afirma que sin el flag los campos no viajan, que es lo correcto |


## El alta de suscripción muestra lo que cobra, y un producto no entra en dos recuentos (2026-08-16)

**El precio de la suscripción.** El drawer rotulaba *"Precio del período"* con
`item.precioBase` —el neto del catálogo— mientras el backend le autorizaba a la tarjeta
`resultado.totales.totalFinal`. Medido: decía `30.000` y se cobraban `35.700`. Ahora el monto
grande es el `totalFinal`, con el neto y el impuesto debajo, y reusa el mismo motor
(`useResultadoCalculado`) y el mismo `AdvertenciasPrecio` que el carrito y la pasarela — no se
inventó una previsualización propia.

⚠️ **Se sembró el ítem de suscripción que faltaba.** Sin él la pantalla se ve **vacía** —no
hay a qué suscribirse—, así que no se podía mirar ni testear, y el bug original hubo que
medirlo creando el ítem a mano. `Plan mensual demo`, afecto y con
`precio_incluye_impuesto = false`: justo la combinación que hace visible la diferencia.

**Dos recuentos sobre el mismo producto.** `create` ahora bloquea con `400` nombrando la
sesión abierta. El escenario que lo justifica, con números: stock 10, dos personas cuentan 8
cada una en su sesión, cada una guarda delta −2, y aplicadas las dos el stock queda en **6**.

⚠️ **La doc daba este riesgo por mitigado con un razonamiento que no cierra**, y eso es peor
que un hueco no considerado: decía que *"aplicar ambas en cualquier orden da el mismo
resultado final"*. Es cierto y es irrelevante — la independencia del orden no es corrección,
da el mismo resultado **equivocado**. Esa fila de la tabla de riesgos se reescribió, con la
explicación completa debajo para que nadie vuelva a leerla como resuelta.

⚠️ **El delta congelado no se tocó** (recalcular al aplicar se descartó), y **el guard es
check-then-act sin índice que lo respalde**: dos `create()` simultáneos lo pasan los dos. El
único índice único es `(recuento_id, item_id)`, o sea dentro de una sesión. Queda dicho en el
código y en la doc, y es trabajo de la §5.

**Un test existente cambió de fixture, no de intención.** `GET /recuentos?estado` creaba dos
borradores sobre el mismo ítem solo para tener uno de cada estado; ahora la sesión que se
cancela usa un ítem propio. El caso prueba el filtro por estado, no la regla nueva.

**Qué fija cada una.** Suscripciones: un e2e que pide el cálculo del ítem sembrado y fija los
dos números de la medición (`30.000` neto → `35.700` cobrado), más una aserción de que **no
son iguales** — si el ítem del seed dejara de ser afecto, el spec pasaría en verde sin probar
nada. Recuentos: la segunda sesión da `400` nombrando la primera, la segunda no queda creada a
medias, y cancelada la primera el producto vuelve a estar disponible (el bloqueo es por sesión
abierta, no un veto permanente).

---

## La propina de una venta anulada sale del pool, y el plano avisa el solapamiento (2026-08-16)

Dos entradas independientes, chicas y de módulos distintos, cerradas juntas.

**Propina de una venta anulada (`buscarTipsPorFuentes`).** La entrada estaba frenada por una
pregunta que el owner ya había contestado: *"la propina de una venta anulada sale del pool Y
del peso"*. Filtrar solo el peso —que es lo que la entrada original proponía— **le saca el
peso al garzón y deja su plata en el `poolTotal` congelado, o sea que la redistribuye entre
los demás**, que es exactamente lo que la decisión rechaza. Por eso van las dos mitades:
`buscarTipsPorFuentes` filtra `estado <> 'cancelada'` como su hermana `buscarTipsElegibles`, y
`actualizarConfig` **recalcula** el pool sobre las fuentes vivas en vez de reusar el
congelado.

El recálculo es idempotente en el caso normal —las fuentes son las mismas filas que se
congelaron, así que la suma da igual— y solo baja cuando una de esas ventas se anuló con el
borrador abierto. La fila de `fuentes` no se borra: queda como registro de lo congelado; lo
que cambia es cuánto aporta.

ℹ️ El caso hermano que **sigue abierto** es otro: la venta anulada *después* de liquidar y
pagar, que el owner decidió resolver con un saldo en contra y necesita spec propia.

**Solapamiento de mesas.** Se valida en el frontend al soltar, que es el único lugar donde los
píxeles existen: la posición se guarda como fracción `0..1` y el tamaño se dibuja en px fijos,
así que el mismo par de mesas se pisa en un plano de 1024 y no en uno de 1920 — el `PATCH
:id/layout`, al que apuntaba la entrada, es justamente donde **no** se puede resolver.
**Avisa, no impide:** el plano solapado no corrompe nada, solo se lee mal, y frenar el
arrastre en un lienzo libre pelea con el usuario.

⚠️ **La tabla de tamaños se extrajo a `app/utils/mesa-dimensiones.ts`.** Estaba dentro de
`MesaNode.vue` y el plano la necesitaba para medir: dos tablas de píxeles que tienen que
coincidir y viven en archivos distintos divergen, y el aviso marcaría una cosa mientras el ojo
ve otra. Es el mismo patrón que la tanda anterior corrigió con el criterio de personalización.

**Qué fija cada una.** Propinas: un e2e que crea el borrador, anula la venta por SQL y
verifica que el pool baja **exactamente** esa propina y que lo repartido sigue cuadrando con
el pool nuevo (si solo se filtrara el peso, el pool no bajaría y la plata se repartiría entre
los demás). El mutante que revierte las dos mitades lo pasa de `9000` a `0`. Mesas: nueve
casos de geometría, incluidos el borde exacto —dos mesas pegadas lado a lado **no** avisan,
o el aviso se vuelve ruido— y el par que se pisa en un plano angosto y no en uno ancho, que
es la razón por la que esto no puede vivir en el backend.

---

## La unidad de un ingrediente referenciado se congela, y el batch deja de tirar el lote (2026-08-16)

**Decisión del owner (2026-08-15): las dos mitades.** (a) El guard se amplía para bloquear el
cambio si alguna receta u opción de grupo ya referencia el ítem; (b) el batch de conversión
tolera la fila que no puede convertir en vez de tirar el lote entero.

**Lo que salió distinto al medir**

1. **Son CUATRO tablas que fijan una unidad contra un ítem, no las dos que nombraba la
   entrada.** Además de `receta_ingredientes` y `grupo_modificador_opciones` están
   `receta_extras_permitidos` y `item_grupo_modificador_opciones`. Se buscaron por conducta
   —*"¿qué tabla tiene un `unidad_codigo` apuntando a un `item_id`?"*— y no por el nombre de
   las dos conocidas. Una sola query con `UNION ALL … LIMIT 1`, que además nombra cuál lo
   referencia.
2. **Son DOS sitios con la misma fragilidad, no uno.** La entrada medía
   `catalog.service.ts → convertirUnidades` (que cuelga de `GET /items`). Al correr la suite
   apareció el segundo: `ItemsService.costoPropuesto` convierte con otro conversor y
   `construirFilasDesfase` lo llama para **todas** las recetas del tenant, así que una sola
   fila rota hacía responder `400` a `GET /recetas/desfases` entero. Se endureció igual: esa
   receta se omite de la bandeja en vez de tumbar la respuesta.
   ℹ️ **Cómo apareció, que vale más que el hallazgo:** el e2e nuevo dejaba la fila rota en la
   base y la suite del simulador —otra— empezó a fallar. El spec ahora limpia lo que ensucia.
   ⛔ **Y ese arreglo estaba a medias: lo cazó la revisión independiente.** `costoPropuesto`
   tiene **tres** llamadores, no uno. Hacerlo devolver `null` blindó la lectura
   (`construirFilasDesfase`) y dejó los dos de **escritura** —`aplicarDesfases` y
   `descartarDesfases`— pasando ese `null` directo a un `UPDATE` sobre columnas de dinero
   nullables: donde antes había un `400` ruidoso quedaba un `200` que persistía
   `costo_actual = NULL` en silencio, y ese null se lee después como **costo 0** al costear un
   combo que use la receta. Los dos endpoints reciben el `recetaItemId` por body, sin pasar
   por la bandeja, así que la fila rota les es alcanzable aunque el listado la omita.
   **Leer tolerante y escribir tolerante no son lo mismo:** los dos caminos de escritura ahora
   fallan con `400` nombrando la receta y la causa, y hay un caso e2e que además verifica que
   `costo_actual` no quedó en `null`.
3. **La receta con unidad rota queda en `disponible: 0`, no en `null`.** `null` significa "sin
   límite" en este contrato, así que habría mostrado como disponible algo que no se puede
   preparar.

⚠️ **Costo asumido, dicho explícito:** el guard bloquea ante **cualquier** referencia, incluso
si la unidad nueva es convertible (`kg` → `g`). Es lo que decidió el owner; permitir solo los
cambios compatibles exige razonar la magnitud fila por fila y deja al usuario sin señal de qué
recetas dependen del ítem. Hay un test que fija esa estrictez a propósito, para que no se
"arregle" sin decidirlo.

**Qué lo fija.** `unidad-ingrediente-referenciado.e2e-spec.ts`: el ingrediente sin referencias
sigue pudiendo cambiar (contrapunto), el referenciado no puede ni con una unidad compatible, y
con una fila ya rota —montada por SQL porque el guard la hace inalcanzable por API— tanto
`GET /items` como `GET /recetas/desfases` siguen respondiendo `200`. Más tres casos unitarios
del batch, con la fila rota **en el medio** para probar que no corta las que la siguen.

---

## La venta de $0, el criterio único de personalización y el redondeo en el drawer (2026-08-16)

Tres entradas chicas de ventas/precios, cerradas juntas. Una cuarta de la misma tanda —la
pasarela simulada— **quedó bloqueada** y sigue en `pendientes.md`; el porqué está abajo.

**Venta de total $0 = PAGADA, sin línea de pago.** El estado se deriva siempre de lo
aplicado: se sacó el `if (saved.pagos.length > 0)` que envolvía a `calcularEstadoVenta`, que
ya devolvía `pagada` para `('0','0')` — lo que faltaba era llamarla. Los tres sitios que la
entrada tenía medidos: backend, el `puedeConfirmar` del `CobroModal` (que además muestra *"no
hay nada que cobrar"* en vez de una línea de pago en $0), y la tienda, que ahora **omite**
`pagos` en vez de mandar `monto: '0'` contra `@IsDecimalPositivo`.

**Criterio único de personalización: "sacar no cobra, agregar sí".** Vivía duplicado y
divergente: `personalizacionVacia` (POS) contaba un "sin cebolla" como personalización a
efectos de precio, `tienePersonalizacionConRecargo` (salones) lo ignoraba, y los dos
alimentaban el mismo campo del mismo endpoint. Ganó el segundo, y ahora hay una sola función
(`personalizacionAfectaPrecio`) que usan los dos.
⚠️ **No se aplanaron las dos preguntas**, que era el riesgo: qué se **registra** y qué se
**cobra** siguen separadas. El *sin cebolla* sigue viajando a la comanda de cocina — eso lo
decide `personalizacionVacia`, que no se tocó. Hay un test por cada mitad.
ℹ️ La otra mitad de la entrada era mecánica: `if (precioOverride)` sobre un **string**, donde
`'0'` es truthy y el filtro no filtraba lo único que podría querer filtrar. Ahora dice lo que
quiere decir (`!= null && !== ''`), con su test.

**`escalaCalculo` y `modoRedondeo` en el drawer.** Plegable al pie de Totales, con el mismo
permiso que el resto (`Ventas:Leer`): la configuración de cálculo no se trata como
información de administración. Medido de paso: el backend **ya los congelaba** —
`configCalculo: resultado.config` guarda el `ConfigCalculo` entero y `findOne` lo devuelve
verbatim—, así que era un hueco de presentación, no de datos.

**Lo que bloqueó a la cuarta, y por qué se revirtió.** La decisión era *"sin cobro real, la
venta queda `pendiente`, no `pagada`"*. Se implementó, y **todo checkout simulado empezó a
fallar con 400**: `ventas.service.ts:387-395` rechaza cualquier venta `online` cuyos pagos no
cubran el total (*"online no admite cuenta por cobrar"*, dice el comentario). O sea que una
venta online no puede quedar `pendiente` hoy **por diseño**. Aflojar esa regla habilitaría
ventas online impagas por cualquier camino, incluido el de la pasarela real. Es producto, no
corrección: se revirtió la pantalla y la entrada quedó abierta con las alternativas medidas.

---

## El módulo contratado pasa a ser un borde duro, también para el admin (2026-08-16)

**Decisión del owner (2026-08-15):** el admin del tenant también respeta los módulos
contratados. Se arregla el motor, no la documentación — `PRODUCTO.md:127` ya decía lo
correcto.

**Lo que se construyó** es más chico que lo que la entrada anticipaba: el short-circuit de
`es_fijo` en `RbacService.userHasPermiso` ahora une `tenant_modulos` + `modulos_app` y recibe
el módulo como `$3`. Nada más. `userIsTenantAdmin` no se toca: responde otra pregunta (si es
admin), no si puede entrar a un módulo.

**La segunda pieza que la entrada daba por necesaria NO se construyó, y por qué.** Decía:
*"el fix probablemente son dos piezas: sembrar los módulos al crear el tenant, y recién
después cerrar el short-circuit"*. Medido:

1. `POST /admin/tenants` es **superadmin-only**, y ya existe `POST /admin/tenants/:id/modules`
   (`TenantsService.addModule`). O sea que el camino para contratar ya está construido.
2. `PRODUCTO.md:112` dice explícitamente: *"Superadmin del SaaS — contrata/desactiva módulos
   por tenant. **El tenant no puede gestionar sus propios módulos**"*. Sembrar un set por
   defecto al crear contradiría eso, y **cuál** sería ese set es una decisión comercial que
   nadie tomó.
3. Un tenant recién creado sin módulos no queda inutilizable: las rutas admin-only pasan por
   `TenantAdminGuard`, no por el motor de módulos, así que su admin puede configurarlo. Lo que
   no puede es operar módulos que no compró, que es exactamente la decisión.

Inventar el set por defecto habría sido elegir una regla de negocio no documentada.

**Dos cosas que apareció al correr el e2e, y que el short-circuit venía tapando**

- **Demo Bodega no tenía `Ventas` contratado.** Un tenant con MiCaja, Cajas, Pagos y Tienda
  Online que no puede registrar una venta no es un tenant que compró menos: es un seed
  incoherente. Se sembró.
- **El garzón "Mostrador" está acoplado al módulo `Salones`.** `TenantsService.create` le crea
  uno a **todo** tenant, pero las 10 rutas de `garzones.controller.ts` piden
  `@RequiresPermiso('Salones', …)`, así que un tenant sin salones no puede administrar la fila
  que el sistema le creó. Se parcheó en el seed para que la suite corra y **se abrió entrada
  propia**: qué módulo debería gatear el Mostrador es decisión del owner, no un efecto lateral.

**Qué lo fija.** `modulo-contratado-borde-duro.e2e-spec.ts` usa el **mismo usuario con el
mismo rol** (`admin@sistema.com`, `es_fijo` en los dos tenants del seed) contra los dos
tenants: lo único que cambia es qué contrató la empresa. Con `Propinas`, 200; sin `Propinas`,
403; y el tercer caso verifica que lo negado es el módulo y no la condición de admin
(`/api/roles` y `/api/items` le siguen respondiendo 200). El mutante —volver el short-circuit
a como estaba— pasa ese 403 a 200 y tumba dos unit tests.

---

## Los filtros de fecha ya no dependen del `TimeZone` de sesión, y el hook mira las tablas (2026-08-16)

Dos entradas mecánicas de la sección 3, cerradas juntas por tamaño.

**Tablas GFM en el pre-commit (Guard 6).** `scripts/check-md-tables.mjs`, una sola regla y
sin dependencia nueva: toda línea que empieza con `|` va precedida por otra fila, una línea
en blanco o el principio del archivo.
⚠️ **La entrada decía que el script "ya existe como script suelto" y hay que "moverlo al
hook". No existía en el repo** —se buscó en `scripts/`— así que se escribió de cero.
Al correrlo sobre los 252 `.md` apareció **un falso positivo** que obligó a afinar la regla:
`docs/features/garzones.md:169` es un renglón de continuación de un ítem de lista que
arranca con `|` porque un inline code (`` `garzon` | `cocina` | `barra` ``) quedó partido al
envolver. Por eso una fila exige **dos** `|`, no uno. Verificado con un mutante: un párrafo
insertado entre dos filas se detecta; el archivo de garzones pasa.
ℹ️ De paso, sacar la entrada del backlog eliminó el `---` suelto que la partía en dos —la
misma clase de rotura de markdown que la entrada describe.

**Los tres filtros de fecha.** `mermas`, `inventario` y `pasarela/cobros` filtraban
`creado_el >= $N` con valores de DTOs validados con `@IsDateString()`, que acepta fecha pura
**y** timestamp. Ahora la decisión de qué forma tiene el valor vive en el service
(`src/common/utils/rango-fecha.util.ts`): la fecha pura se expande a la medianoche **local
del tenant**, el timestamp pasa tal cual.
⚠️ **No se copió el molde de `propina-reportes`**, y esa es la parte que hacía a esto más que
un find-and-replace: `'2026-08-01T15:30:00Z'::date` devuelve `2026-08-01` —el `::date`
descarta la hora en silencio—, así que aplicarlo a ciegas habría ensanchado el filtro de
cualquier llamador que mande hora. La aritmética de la zona sí la sigue haciendo Postgres:
es DST-correcta sin traer una librería.

**Un bug que el e2e encontró en el propio arreglo.** La primera versión resolvía la zona
apenas hubiera algún borde de fecha y la pasaba como parámetro siempre. Con los dos bordes
en timestamp el SQL no la nombra, y **Postgres rechaza el bind con un parámetro de más**:
500. De ahí salió `requiereZonaTenant`, que la pide solo si algún borde es fecha pura. No es
una optimización, es corrección — y está dicho así en el código para que nadie lo "simplifique".

**Lo que se midió y NO se tocó:** `hasta` es un off-by-one propio, anterior y distinto del
huso — `creado_el <= medianoche` deja fuera el día entero que el usuario eligió. Se verificó
contra la base (`now() <= ('2026-08-16'::date::timestamp AT TIME ZONE 'America/Santiago')`
da `f`) y se abrió como entrada nueva en la sección 4: inclusivo vs exclusivo es decisión de
producto, no parte de la corrección del huso.

---

## El ítem eliminado deja de esconder su kardex y de aceptar movimientos nuevos (2026-08-16)

Las tres entradas de la sección 3 que eran la misma idea —qué pasa con un producto dado de
baja— cerradas juntas porque separarlas dejaba el criterio partido en tres archivos.

**Lectura: el filtro se saca de las CINCO consultas, no de las cuatro anunciadas.** Kardex
(listado + `COUNT`), mermas (listado + `COUNT`) y el detalle del recuento. Las cuatro
primeras pasan a `LEFT JOIN items` sin condición de borrado y exponen
`(i.eliminado_el IS NOT NULL) AS item_eliminado`; el detalle del recuento pasa a espejar
**exactamente** la consulta que `aplicar` ya usaba en el mismo archivo —`LEFT JOIN` con
condición de tenant— en vez de inventar una forma nueva. En pantalla, badge `Eliminado`
junto al nombre, con el mismo `UBadge neutral/subtle` que ya usa `terceros`; en el recuento
suma *"Se va a descartar al aplicar"*.

**Escritura:** allowlist `MOTIVOS_SOBRE_ITEM_ELIMINADO = ['anulacion', 'devolucion']` en
`registrarMovimiento`, justo después del lock. Allowlist y no lista de rechazos: un motivo
nuevo nace rechazado, que es el lado seguro. El mensaje nombra el producto y dice que está
eliminado, sin caer en el genérico del acote por tenant.

**Las tres cosas que salieron de medir, y que las entradas decían distinto**

1. **El guard NO tapa un agujero alcanzable: es defensa en profundidad.** La entrada
   afirmaba que *"sobre un producto discontinuado se puede registrar una compra, una merma o
   un ajuste de costo igual que antes de borrarlo"*, y es **falso**. Se recorrieron los 19
   call sites: `items.ajustarStock`, `items.create`/`update`,
   `inventario.registrarAjusteCosto` y `mermas.registrar` filtran `eliminado_el IS NULL` y
   cortan con `404`; `recuentos.aplicar` descarta la línea antes de llamar; y
   `venderIngredientesReceta` / `venderComponentesCombo` / `venderOpcionesGrupos` excluyen al
   ingrediente borrado en la expansión. Por eso el guard se cubre con **unit tests** y no con
   un e2e: montar el escenario por API es imposible, y un e2e que lo fabricara con SQL
   directo probaría un estado inalcanzable.
2. **El `LEFT JOIN` NO deja el nombre en `null`.** La entrada avisaba que el frontend
   necesitaba "qué mostrar en esa celda además del marcador". No hace falta: el soft delete
   deja la fila en `items`, así que sacar el filtro del `ON` devuelve el nombre igual. El
   único `null` posible es el del detalle del recuento, y solo si el ítem fuera de otro
   tenant —que el modelo no permite—; se tipó nullable con `?? '—'` por espejar `aplicar`.
3. **La consulta de lock traía `items` pero no la columna.** La entrada decía que el dato
   *"ya está a mano"*. El `JOIN` estaba; `i.eliminado_el` y `i.nombre` había que agregarlos
   al `SELECT`.

**Qué lo fija.** El e2e `kardex-item-eliminado.e2e-spec.ts` compara `meta.total` antes y
después de eliminar el producto —no `data.length`—, que es el mutante que la entrada pedía:
corregir solo el listado deja el total mintiendo y ningún test que cuente filas lo nota. Más
el caso de que el detalle del recuento y `cantidadLineas` del listado coincidan, que era
justo la discrepancia 12-vs-11. En unit, la allowlist con los dos lados: cinco motivos
rechazados sin llegar a tocar el kardex, y anulación/devolución pasando.

---

## El encargado ya puede dar el permiso que el aviso le pedía dar (2026-08-16)

La tercera entrada del cluster de membresía, separada de las otras dos porque **no tenía
vehículo**: la decisión decía *"se abre el permiso"* y al abrir el código apareció que el
motor concede permisos **por rol** (`roles_permisos_modulos`), no por usuario, y que
`TenantsService.create` siembra **un solo rol** por tenant (`Administrador`, `es_fijo`). No
existía ningún rol de operador al que enganchar nada.

**Decisión del owner (2026-08-16), sobre tres opciones: rol de sistema no editable.** Las
otras dos eran un rol común sembrado —más barato, pero si el admin le agrega permisos el
encargado pasa a repartir eso también sin enterarse: una trampa para el admin, no una
escalada contra él— y una tabla de permisos directos por usuario, que toca las cinco
consultas de `RbacService`.

**Lo que se construyó**

- `roles.es_sistema`, **eje distinto de `es_fijo`**: aquel es "admin, acceso total"; éste es
  "lo puede repartir alguien que no es admin, así que su alcance está fijado por
  construcción". Con unique parcial `uq_roles_sistema_tenant_nombre`, que solo alcanza a los
  roles de sistema y por eso no puede chocar con nada existente.
- `RolesService.otorgarOperarSalon(manager, tenantId, usuarioId)` — encuentra-o-crea
  `Operador de salón` con exactamente `Salones:Operar` y se lo asigna a la cuenta.
- `POST /garzones/:id/permiso-operar` con `@RequiresPermiso('Salones','Actualizar')`.
- Los tres bloqueos de `RolesService` (`update`, `remove`, **`setPermissions`**).
- En pantalla: badge *"De la aplicación"* y edición cerrada en la pantalla de roles; y el
  aviso *"…hasta que se lo des"* pasa a traer el botón que lo da.

**Las tres cosas que salieron de medir, y que la entrada no decía**

1. **Los permisos son por rol.** Ver arriba — es lo que obligó a preguntarle al owner con
   qué se concede, en vez de "abrir la ruta".
2. **El rol no se puede sembrar al crear el tenant.** El permiso solo existe colgado del
   módulo contratado, y `TenantsService.create` no siembra ningún `tenant_modulos` (la
   entrada abierta de *"contratar un módulo, ¿es un borde duro?"*). Al nacer el tenant no
   hay a qué colgarlo, así que el rol se crea en el primer otorgamiento y, sin `Salones`
   contratado, el otorgamiento corta con 400.
3. **No había fixture con la que probarlo.** Ningún usuario sembrado tenía
   `Salones:Actualizar` sin ser admin: `admin.paris` short-circuita todo por `es_fijo` y
   `ana.torres` tiene `Operar` pero no `Actualizar`. Se sembró
   `encargado.salon@paris.cl` + rol `Salones · Encargado`
   (`Leer`+`Crear`+`Actualizar`) — con `Crear` porque la decisión describe a *"quien puede
   dar de alta y vincular garzones"*, y sin él la mitad del caso no se puede ejercer
   (medido: el e2e daba 403 al crear el garzón).

**Qué fija el acotamiento, que es la parte que el ⚠️ de la entrada exigía**

`permiso-operar-salon.e2e-spec.ts` prueba las dos mitades: que el encargado **puede** —y que
el permiso **rige de verdad**, afirmado sobre `puedeOperarSalon`, que sale de la consulta de
RBAC completa y no de las filas escritas: un cableado a medias dejaría las filas y seguiría
en `false`— y que lo que puede está **acotado**: ni el admin puede agregarle permisos al rol
(mutante verificado sobre ese bloqueo), ni renombrarlo, ni borrarlo, y el encargado sigue
comiendo 403 en `PATCH /roles/:id`.

En el frontend, el botón del aviso se decide por `puedeOperarSalon` y **no** buscando el
texto de la advertencia — matchear substrings ata la pantalla a una redacción que cambia
sola. El `null` ("la pregunta no se hizo") se distingue de `false` a propósito: tratarlos
igual ofrecería dar un permiso que la cuenta quizá ya tiene. Mutante verificado.

### La entrada, verbatim

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
  ✅ **DECIDIDO (owner, 2026-08-15): se abre el permiso, no se corrige el texto.** Quien puede
  dar de alta y vincular garzones (`Salones:Actualizar`) pasa a poder otorgar `Salones:Operar` a
  esa cuenta, sin necesidad de ser admin del tenant.
  ℹ️ **Con eso el texto actual pasa a ser verdadero**, así que los tres avisos quedan como están:
  el trabajo es de permisos, no de redacción.
  ⚠️ **Toca el modelo de permisos y hay que acotarlo bien:** no es "el encargado puede editar
  roles" —eso sigue siendo admin— sino un camino puntual para conceder **ese** permiso **a esa
  cuenta**. Si se implementa como acceso a `PATCH /roles/:id`, el encargado queda pudiendo editar
  cualquier rol del tenant, que es escalada de privilegios y no es lo que se decidió.

### ⚠️ El mensaje del commit `a351b5f7` tiene un aviso de despliegue FALSO

Ese commit cierra con *"`synchronize` está apagado en producción. Hasta que se resetee la
base de Railway, cualquier lectura de `roles` por TypeORM revienta"*. **No es cierto, y no
hay que actuar sobre eso.** Se corrige acá y no reescribiendo el mensaje porque el commit
ya está en `main`, y reescribir la historia compartida es peor que el error.

Lo que pasó: se leyó `synchronize: config.get('NODE_ENV') !== 'production'`
(`app.module.ts:263`) y se dio por hecho que en Railway `NODE_ENV=production`. **Nadie lo
midió.** El propio `docs/ARCHITECTURE.md` decía lo contrario —*"hoy eso está tapado por
`synchronize` + reset"*— y también la skill `railway-sync-db`, que arranca con *"el backend
corre con `synchronize` activo"*.

**Medido, esta vez de verdad:** el deployment de `a351b5f7` quedó en `SUCCESS` con
`roles.es_sistema` en la entidad, y el smoke de producción pasó las tres verificaciones. Si
la columna no se hubiera creado, el healthcheck —que consulta la base— no habría promovido
el deploy.

La lección no es sobre Railway: **una condición leída en el código no dice qué valor tiene
la variable en el entorno**, y este backlog tiene una regla escrita para exactamente eso
("buscar por conducta, no por mecanismo"). El costo fue pedirle al owner un paso urgente
que no lo era, sobre una premisa que dos archivos del propio repo desmentían.

---

## El cluster de membresía: la baja deja de romper dos cosas en silencio (2026-08-16)

Tres entradas que eran la misma transición mirada desde tres lados: **nadie mira lo que
"dar de baja a alguien" deja atrás.** Dos de la sección 3 y una de la sección 2, que iba
primero porque la salida "sigue trabajando" de la segunda dependía de que desvincular
fuera alcanzable por pantalla.

**Lo que se construyó**

- `RbacService.administradoresDe(manager, tenantId, lock)` — criterio único de "quién
  administra el tenant". `RolesService.removeUser` y `TenantsService.removeMember`
  **borran, cuentan cómo quedó el tenant, y el `throw` deshace el borrado**.
- `DELETE /tenants/members/:userId?garzon=sigue|no-sigue`, con la decisión **obligatoria
  cuando hay vínculo**, y `200` con cuerpo (antes `204`) para poder entregar el PIN nuevo.
- `clear` en el `USelectMenu` de "Cuenta vinculada".

**Las cuatro cosas que la entrada no decía y salieron de abrir el código**

1. **El conteo tenía fantasmas.** `userIsTenantAdmin` no une `usuarios_tenants`, y
   `removeMember` deja vivas las filas de `roles_usuarios` (a propósito, ver
   `fijarRolesExactos`). Un bloqueo apoyado en esa query contaba a ex-miembros: con dos
   admins, dar de baja a uno y volver a contar daba 2, y el tenant quedaba huérfano igual.
   El `JOIN` a `usuarios_tenants` es la diferencia entre el bloqueo y el teatro.
2. **No se podía desvincular desde el formulario, y un comentario del propio `.vue`
   afirmaba que sí.** El prop `clear` de `USelectMenu` viene en `false` por defecto y nadie
   lo pasaba; el `null` de `UpdateGarzonDto` quedaba alcanzable solo por API. El resto del
   camino ya estaba (`ValidateIf` en el DTO, el `null` crudo en el PATCH de `guardar()`).
3. **No existe pantalla de baja de membresía.** La entrada estaba tageada "backend +
   frontend" y la decisión decía *"el sistema pregunta en el momento"*, pero no hay
   momento: `DELETE /tenants/members/:userId` no lo llama ninguna pantalla y su único uso
   vivo era un teardown de e2e. Decisión del owner (2026-08-16): **solo el contrato de
   backend**; la pantalla, cuando se construya.
4. **Los permisos son por rol, no por usuario** — eso salió mirando la tercera entrada del
   cluster (`Salones:Operar`), que por eso no entró acá: necesitaba decidir con qué se
   concede. Queda en la sección 3 con la medición escrita.

**Qué fija cada cosa**

- El lock: `membresia-ultimo-admin.e2e-spec.ts` → *"el conteo de admins TOMA LOCK"*.
  ⚠️ **Dos versiones anteriores de ese test no probaban nada y por eso el test final mide
  otra cosa.** Dos bajas por HTTP en `Promise.all` (con supertest y con `fetch` real contra
  un puerto) dan `[200, 403]`: la segunda request empieza cuando la primera ya commiteó y
  su `TenantGuard` corta antes del service. Y dos llamadas concurrentes al service tampoco
  alcanzan: **el mutante que saca el `FOR UPDATE` sobrevive**, porque sin lock las dos
  transacciones igual se serializan de hecho y la ventana real del bug es de microsegundos.
  El test que quedó retiene el lock desde afuera sobre las filas de un admin que la baja
  **no** toca —acotarlo es lo que lo hace concluyente— y afirma que la baja queda esperando.
  Ese sí muere con el mutante.
- El `clear`: `garzones.nuxt.spec.ts` afirma sobre el **prop**, no sobre el modelo: el test
  de al lado emite el `null` a mano y pasaría en verde aunque el encargado no tuviera con
  qué emitirlo. Mutante verificado. Y smoke en el navegador: el PATCH sale con
  `{"usuarioId":null}` y la respuesta vuelve desvinculada.

**Lo que encontró la revisión independiente, y se arregló en el mismo commit**

- 🔴 `aplicarBajaDeCuenta` releía el garzón dentro de la transacción pero **no comparaba
  contra la cuenta que se estaba dando de baja**, y el `usuarioId` ni siquiera le llegaba.
  Si entre la lectura previa y el `BEGIN` alguien re-vinculaba el garzón a otra persona
  —camino normal de `actualizar()`—, la baja le rompía el vínculo a un tercero y le
  entregaba su PIN en claro a quien pidió otra cosa. Cubierto por un e2e propio.
- `removeMember` no verificaba membresía viva. `softDelete` de TypeORM **no** agrega
  `eliminado_el IS NULL` al `WHERE`, así que repetir el `DELETE` respondía 200 y volvía a
  ejecutar la decisión del garzón: una baja `no-sigue` se podía convertir después en
  `sigue`, desvinculando y emitiendo un PIN sin ninguna membresía que dar de baja. Ahora
  404.
- Dos unit se llamaban *"tira y no commitea"* sobre un `transaction` mockeado que no
  modela rollback. Renombrados a lo que afirman; el rollback lo cubre el e2e.
- El test del lock no soltaba el lock si su `expect` fallaba: un rojo puntual trababa el
  gate entero. Va en `finally`.

---

### Las tres entradas, verbatim

- [ ] **¿Se puede desvincular una cuenta desde el formulario?** (frontend, **duda medida en el
  smoke del 2026-08-15, sin resolver**) — el `USelectMenu` de "Cuenta vinculada" muestra
  `Sin vincular (usa PIN)` como *placeholder*, pero **con una cuenta ya elegida no se vio una
  opción para volver a ese estado**: la lista solo trae cuentas. Si no se puede, el `null`
  explícito de `UpdateGarzonDto` solo es alcanzable por API. Importa porque el estado
  *"desvinculado y sin PIN usable"* —que la ficha ahora señala en rojo— se produce justamente
  por ese camino. **Verificar antes de asumir cualquiera de las dos cosas.**

- [ ] **El último admin puede dejarse afuera, y el tenant no se recupera por ninguna API**
  (backend, auditoría RBAC/auth 2026-08-15) — `roles.service.ts` → `removeUser` desasigna a una
  persona de un rol sin mirar si es el último `es_fijo` del tenant, y `tenants.service.ts` →
  `removeMember` deja auto-eliminarse. `TenantAdminGuard` solo verifica que quien llama **sea**
  admin en ese instante, nunca que la acción deje al tenant con alguno. (`RolesService.remove`
  —borrar el rol— sí bloquea `esFijo`; desasignar a la persona, no.)
  ⚠️ **Verificado lo que decide la severidad:** `/admin/tenants` con `SuperadminGuard` expone
  crear, listar, ver, editar, borrar y agregar módulos — **ninguna ruta para asignar un rol ni
  sumar un miembro**. Un tenant que se queda sin admin **solo se arregla con SQL directo**.
  **La decisión:** ¿se bloquea la acción cuando dejaría el tenant sin admin, o se agrega una
  ruta de recuperación del superadmin? La primera es más barata; la segunda cubre también los
  casos que la validación no anticipe.
  ✅ **DECIDIDO (owner, 2026-08-15): se bloquea la acción.** Ni `removeUser` ni `removeMember`
  dejan hacer el cambio si dejaría al tenant sin ningún rol `es_fijo` asignado. Sin ruta de
  recuperación del superadmin por ahora — la decisión fue el bloqueo, que es lo que ataja el
  caso común.
  ⚠️ **El bloqueo tiene una carrera adentro y hay que resolverla en el mismo trabajo:** dos
  requests simultáneos que sacan a los dos últimos admins pueden pasar los dos chequeos y dejar
  el tenant huérfano igual. El conteo tiene que tomar lock, o la validación no vale bajo
  concurrencia. Va con la sección 5.
  ℹ️ Queda anotado, sin decidir, lo que el bloqueo no cubre: **hoy un tenant sin admin solo se
  arregla con SQL directo**, porque `/admin/tenants` no tiene ruta para asignar roles ni sumar
  miembros (verificado). Si alguna vez pasa por otro camino, no hay salida por pantalla.

- [ ] **Dar de baja una membresía deja al garzón vinculado sin ninguna credencial, y en
  silencio** (backend + frontend, auditoría RBAC/auth 2026-08-15) — **lo creó la entrega del PIN
  propio del 2026-08-15**, y por eso ninguna revisión de aquel diff podía verlo: nadie mira la
  transición "dar de baja a alguien" mientras revisa la feature del PIN.
  Medido: `removeMember` son **dos líneas** (`softDelete({ tenantId, usuarioId })`) y no toca
  `garzones`. Un garzón dado de alta con cuenta nace con `pinHash = PIN_INUTILIZABLE` — vincular
  mata el PIN a propósito, porque la cuenta pasa a ser la credencial. Al bajar la membresía,
  `garzonPersonalDe` deja de resolver el modo personal (filtra la membresía viva) **y el PIN
  sigue muerto**: el garzón se queda sin ninguna forma de operar, y `toPublico` no muestra
  ninguna señal de que su cuenta ya no es miembro.
  🔗 **Engancha con un cabo ya abierto:** la recuperación sería *desvincular + regenerar PIN*,
  pero **no sabemos si desvincular es posible desde el formulario** — esa es la entrada de la
  sección 2. Si no se puede, el garzón queda muerto sin salida por UI. Las dos se resuelven
  juntas, y esa medición ahora tiene una razón concreta para ir primero.
  **La decisión:** ¿la baja de membresía **desvincula** el garzón automáticamente (y le devuelve
  un PIN usable), **avisa** al admin de que va a dejar a alguien sin operar, o **bloquea** hasta
  que se resuelva? La primera es la más amable y la que menos estados raros deja.
  ✅ **DECIDIDO (owner, 2026-08-15): el sistema pregunta en el momento.** Al dar de baja a
  alguien con garzón vinculado, un paso dice que existe ese vínculo y ofrece las dos salidas:
  **sigue trabajando** → se desvincula y se le genera un PIN usable; **no sigue** → el garzón
  queda `activo = false`.
  ⚠️ **Descartada la salida automática que se había propuesto primero** (desvincular y dar PIN
  siempre), y vale escribir por qué: asume que el garzón debe seguir operando, y el motivo más
  común de una baja es que **la persona se fue** — darle un PIN funcional a alguien que se fue le
  deja abrir mesas y tomar comandas desde el tótem. **El sistema no puede adivinar la intención**,
  porque dar de baja la cuenta y "ya no trabaja acá" no son lo mismo: un garzón normal existe sin
  cuenta y se identifica por PIN.
  ℹ️ Las dos salidas son reversibles: `activo` se vuelve a prender y el vínculo se puede rehacer.

---

## "El correo coincide" deja de ser prueba de identidad: seis entradas de la sección 3, más una que apareció haciéndolas (2026-08-15)

Primera tanda de la sección 3 (*"Ya decidido, falta construir"*). Se eligió el **cluster de
identidad** y no las entradas sueltas más baratas, porque las seis son **la misma decisión
del owner** aplicada en seis lugares: tratar la coincidencia de correo como prueba de que
alguien es quien dice.

**El alcance que se propuso al empezar era más grande que el trabajo real**, y eso se
descubrió abriendo el código, no leyendo el backlog. De las siete entradas que se iban a
tomar, dos salieron: el token de Google en la URL (el propio owner ya le había bajado la
prioridad ese mismo día — se paga antes de habilitar Google) y el 500 con correo
soft-borrado (la entrada dice explícitamente que **no se arregla**: nada en `backend/src`
soft-borra un `Usuario`, y se verificó que `removeMember` sólo da de baja la membresía).

### Lo que se cerró

- **El alta adoptaba la cuenta de quien pre-registrara el correo de un futuro empleado.**
  Ahora una cuenta **con contraseña puesta** no se asocia sin que la persona confirme por
  mail. El estado pendiente vive en `tokens_acceso` (tipo nuevo `CONFIRMACION`, con los
  roles congelados en `datos`) y **no** en `usuarios_tenants`: se midió que la membresía se
  lee en **nueve** lugares del backend, y una columna "pendiente" habría obligado a que las
  nueve la filtraran — un solo olvido deja operar a quien nunca confirmó. Sin fila, no es
  miembro por construcción.
- **Google vinculaba el `googleId` a una cuenta local que coincidía por correo.** Ahora eso
  es un `409`; y se lee `email_verified`, que `passport-google-oauth20` exponía y la
  interfaz `GoogleProfile` **ni siquiera declaraba** — TypeScript no podía avisar de un dato
  que el tipo negaba.
- **`POST /auth/register` distinguía el correo tomado del libre** (`409` vs `201`), o sea
  que era un enumerador público de cuentas. Ahora responde igual en las tres ramas.
- **El auto-registro creaba cuentas con un correo que nadie probó.** Columna
  `usuarios.correo_verificado_el`: sin verificar no se entra, y el corte va **después** de
  comprobar la contraseña — antes habría sido el mismo oráculo que se acababa de cerrar.
- **`refresh` no era atómico y no detectaba reuso.** El canje es
  `UPDATE … WHERE token = $1 AND usado_el IS NULL RETURNING …`, y la fila **se marca, no se
  borra** (patrón `TokensAccesoService.quemar()`, que ya resolvía esto al lado): esa lápida
  convierte un 401 indistinguible en "alguien copió la sesión".
  ⚠️ **Pero el canje atómico no elimina la carrera, sólo elige un perdedor**, y la primera
  versión trataba a ese perdedor como atacante: dos pestañas despertando juntas deslogueaban
  a la persona de todos sus dispositivos. Ver más abajo. Lo cierra `reemplazado_por` + una
  ventana de gracia de 30 s, dentro de la cual el perdedor recibe **el mismo token que ganó
  el otro**.
- **`switch-tenant` emitía un refresh nuevo con sólo el access token.** Ahora exige también
  la cookie, y de una sesión viva **del mismo usuario** — sin el `userId` en el criterio, el
  refresh de otra cuenta servía de segundo factor para el token robado. Cierra la mitad de
  la entrada del token de Google que **no** bajaba de prioridad.

### Las tres consecuencias que el backlog no anotaba

1. **`register` dejó de devolver sesión, y no es un extra.** Para responder igual exista o
   no el correo no puede haber tokens: cuando la dirección es de otra persona no hay cuenta
   propia a la cual entrar. Arrastró el store de auth, `register.vue` y una pantalla nueva.
2. **`switch-tenant` tocó los 30 specs e2e** que hacen login, más `cookieParser` en 29 de
   ellos.
3. **El seed sella `correo_verificado_el` sólo en filas nuevas.** Sobre una base sin
   resetear, ningún login funciona — vale para el Docker local y para Railway.

### La entrada que apareció haciendo las otras, y las tres pifias propias

**`POST /tenants/members` era la misma puerta con otro nombre.** Lo levantó el sub-agente de
`tenants`: `addMember` asocia por `usuarioId` sin confirmación, y el alta **devuelve el
`usuarioId` incluso cuando deja la confirmación pendiente**, así que el camino completo eran
dos requests. Se verificó y se cerró con el mismo criterio (owner). Es literalmente la
lección de *buscar por conducta, no por nombre de método*: nadie la habría encontrado
grepeando "adopción de cuenta".

Al cerrarla apareció un borde que casi se rompe solo: `fijarRolesExactos` da de baja los
roles que no vinieron, y `rol_id <> ALL('{}')` es TRUE para todos, así que llamarlo con el
`rolIds: []` de `addMember` **habría borrado todos los roles de esa persona en el tenant**.
Se saltea, y `datos.rolIds.length === 0` distingue "sin roles por diseño" de "los roles se
murieron" — que no se pueden confundir porque `CrearUsuarioTenantDto` tiene
`@ArrayMinSize(1)`.

Tres errores propios, los tres cazados ejecutando y no leyendo:

1. **El e2e entero se cayó al pedir la cookie en `switch-tenant`.** `cookieParser` vive en
   `main.ts`, que el e2e no ejecuta, y **un solo spec de 30** lo instalaba —con un comentario
   que lo explicaba, escrito para el mismo problema en `/auth/refresh`—. Se leyó el
   comentario recién cuando 114 tests estaban en rojo.
2. **La corrección de eso salió a medias por un `replace` sin `/g`.** Quedaron cuatro specs
   con **varios `beforeAll`** donde sólo el primer `app` recibió el `cookieParser`. Es la
   misma trampa del mutante sin `/g` que ya había costado un falso "test decorativo", ahora
   por el otro lado: no un falso verde, un rojo parcial que parecía otra causa.
3. **Un script de edición masiva se comió su propio texto por el comillado del shell:** las
   comillas simples de `'supertest'` dentro de un `node -e '…'` cerraron la cadena, y la
   inserción del `import` se perdió en la mitad de los archivos. Lo delató el typecheck, no
   la lectura del script.

### La revisión independiente BLOQUEÓ, y tenía razón en lo que más importaba

Siete hallazgos. El que bloqueaba **no lo habría encontrado ningún test de los escritos**,
porque el test estaba escrito desde la misma premisa equivocada:

1. 🔴 **La detección de reuso deslogueaba de todos sus dispositivos a un usuario legítimo.**
   Dos tabs comparten la cookie del navegador y el frontend serializa el refresh **por
   pestaña**: las dos canjean el mismo token, una gana, y la otra llegaba a un token ya
   rotado — la firma exacta de una sesión copiada. Un reintento de red (request que llegó,
   respuesta que se perdió) hace lo mismo. **Es literalmente el falso positivo que la
   entrada del backlog decía que había que evitar**, y el test lo llamaba "corta todas las
   sesiones" como si fuera el ataque. Se cerró con `reemplazado_por` + ventana de gracia
   (decisión del owner).
2. 🔴 **`invalidarAnteriores` de `CONFIRMACION` era por usuario, no por tenant.** El alta del
   tenant B quemaba el alta pendiente del tenant A: el link de A dejaba de servir y la
   persona **desaparecía del roster de A** sin ninguna señal. Accionable: cualquier admin
   podía bloquear indefinidamente las altas pendientes de un correo ajeno.
3. **Un reset de contraseña mataba una confirmación pendiente.** `invalidarTodos` barría
   todos los tipos; ahora sólo los que son una **credencial** (invitación y reset). Un token
   de confirmación no abre ninguna sesión.
4. **`switchTenant` borraba las lápidas** y apagaba la detección de reuso después de cada
   cambio de tenant. Ahora borra sólo las filas vivas.
5. **`confirmarIngreso` escribía sobre `usuarios` sin `eliminado_el IS NULL`.**
   `EntityManager.update` no aplica el filtro de `@DeleteDateColumn` —sólo los `SELECT` lo
   hacen—; funcionaba por el orden de dos sentencias, no por el criterio del `UPDATE`.
6. **Siete líneas de doc mintiendo** en `auth.md` y `patterns/backend.md`, incluidas
   *"Email verification (not implemented)"* y *"`/auth/register` sí devuelve 201"*.
7. **`linkGoogleId` quedó sin llamadores** y era el mecanismo del agujero cerrado. Se borró.

**Lo fija:** 9 mutantes en `auth.service.spec.ts` (canje sin `usado_el IS NULL`, sin el
guard del token vencido, sin el corte por contraseña mala, con el `409` de vuelta, sin el
`userId` en el criterio de la cookie, **gracia en 0 ms**, **sin el puntero
`reemplazado_por`**, **`switchTenant` borrando lápidas**), 1 en `tenants.service.spec.ts`
(`addMember` volviendo a asociar sin confirmar, que mata 3 tests) y 1 en el frontend
(`verificar/[token]` verificando en `onMounted`).

⚠️ Dos de esos mutantes se escribieron **porque el primero sobrevivió**: el arreglo de las
lápidas en `switchTenant` no tenía ningún test hasta que el mutante lo mostró. Todos
verificados fallando **por su aserción**, no por un `TypeError` del mock.

### Y bloqueó una segunda vez, por el arreglo del primer bloqueo

La ventana de gracia cerraba lo grave —la revocación total desapareció, medida contra el
stack real— **pero su camino feliz casi nunca se alcanzaba**: el perdedor recibía 401 en
**7 de cada 8 carreras**, o sea que el caso que justificaba toda la columna nueva era el
excepcional.

La causa es de ordenamiento y no se ve leyendo el código: la rotación eran cuatro viajes en
autocommit, así que el lock de la fila se soltaba en el `UPDATE` de marcado —**al
principio**— y el perdedor leía `reemplazado_por` tres viajes antes de que se escribiera.
Encontraba `NULL` y caía en la rama del 401. Y un 401 de `/auth/refresh` no es inocuo:
`useApiFetch` hace `clearAuth()` + `navigateTo('/login')`.

Se cierra envolviendo **marcar + insertar + apuntar en una transacción**: el lock se suelta
recién en el commit y para entonces el puntero ya está. La poda queda afuera, para no
alargar el lock que el perdedor está esperando.

**Lo que hace esto valioso de recordar no es el bug, es cómo se escondía.** El código, el
docblock de la entidad, la tabla de `auth.md`, la entrada de este archivo **y el nombre del
test** afirmaban que funcionaba — y el unit pasaba porque **fijaba `reemplazado_por` en el
mock**, o sea daba por resuelto exactamente el ordenamiento que fallaba. Testeaba la
intención, no el hecho. Ningún mutante sobre el código lo habría mostrado; hizo falta correr
dos requests concurrentes contra Postgres.

### Y bloqueó una tercera vez: el arreglo del arreglo deadlockeaba el pool

La transacción cerró el ordenamiento —medido, de 1 de 8 a 8 de 8, y 15 de 15 con cuatro
pestañas— **pero metió adentro una llamada que no usaba el `manager`**:
`usersService.findById` va por el repositorio inyectado, o sea que pedía una **segunda
conexión del pool** mientras retenía la primera con la transacción abierta y el lock de la
fila tomado.

Con ~10 refresh en vuelo —el pool son 10— los ganadores quedan `idle in transaction`
esperando una conexión que sólo otro de ellos podría soltar. **La API entera muere, para
todos los tenants, hasta reiniciar el contenedor.** Postgres no lo aborta: el ciclo no es de
locks de base sino del pool, así que `deadlock_timeout` nunca dispara. Es peor que el bug
que la transacción venía a arreglar — aquel deslogueaba una pestaña, éste tira el backend.

El fix es sacar la búsqueda del usuario afuera del bloque: sólo se usa para firmar el access
token y nada adentro depende de ella. La regla que queda escrita en el código es más
general: **adentro de esa transacción no puede ir nada que use el repositorio inyectado en
vez del `manager`.**

⚠️ **El e2e de la carrera no podía cazarlo**: manda 2 requests y repite en serie, así que
nunca pasa de 2 transacciones en vuelo sobre un pool de 10. Hizo falta un test distinto —una
**ráfaga de 15 sesiones refrescando a la vez**, que no es una carrera— y armarlo tuvo dos
vueltas propias: montar las 15 sesiones en paralelo revienta con `ECONNRESET`, y disparar la
ráfaga por supertest también, porque levanta un listener efímero por request. Va con el
server escuchando en un puerto y `fetch` real. Su mutante es concluyente: con el `findById`
adentro, el test pasa de 6 s a **colgarse hasta el timeout de 60 s** y se lleva puestos otros
cuatro tests.

Por eso el arreglo trae **un e2e que corre la carrera de verdad**
(`rbac-y-contrasena.e2e-spec.ts`, cinco rondas de dos `/auth/refresh` simultáneos con la
misma cookie, más el reintento secuencial). Y su mutante tiene un matiz que conviene anotar:
sacar sólo el `update` del puntero fuera de la transacción **NO** lo hace fallar —esa carrera
queda tan ajustada que casi siempre gana—; hay que revertir la transacción entera, que es la
conducta que se midió. El test caza la regresión real, no cualquier variante intermedia.

---

## Cambiar la contraseña desde el perfil ahora sí echa al intruso (2026-08-15)

**Entrada original (verbatim):** *"🚩 **Cambiar la contraseña desde el perfil no cierra las
sesiones vivas** (backend, auditoría RBAC/auth 2026-08-15) — `me.service.ts` →
`updateContrasena` valida la contraseña actual, hashea la nueva, hace `repo.update` y
devuelve. **No toca `refresh_tokens`.** Su flujo hermano sí: `auth.service.ts:134`
(`elegirContrasena`, el reset por link) hace `refreshRepo.delete({ userId })` con comentario
explicando por qué hace falta. **Escenario:** a alguien le roban la sesión, se da cuenta,
entra y cambia su contraseña desde el perfil. El atacante **sigue adentro** hasta que su
refresh token expire, y puede renovarlo indefinidamente. Es exactamente lo que la persona
creyó estar cortando. Mecánica porque **el arreglo ya está escrito en el hermano**: una
línea. Al hacerlo, ojo con cerrar también la sesión propia de quien cambia la contraseña (o
reemitirle tokens), o el usuario se autodeslogea al cambiarla — decidir eso es parte del
fix, no una pregunta aparte."*

**El fix es la línea del hermano**, con `RefreshToken` agregado al `MeModule`:
`await this.refreshRepo.delete({ userId })` después de guardar el hash.

**La decisión que la entrada dejaba abierta: cae también la sesión propia.**

⚠️ **Y acá el primer intento se escudó en una invariante que no aplicaba.** El docblock
decía que *"todos menos el mío"* no era representable sin tocar el sistema de tokens
(`CLAUDE.md` #4). **Es falso, y lo cazó la revisión independiente:** la cookie
`refresh_token` viaja en cada request al mismo origen —`AuthController` ya la lee en
`/auth/refresh` y `/auth/logout`—, así que un `WHERE user_id = $1 AND token <> $2` habría
preservado la pestaña propia sin tocar nada del sistema de tokens.

La decisión **se mantiene**, pero por su razón verdadera: el borrado total no depende de que
la cookie llegue intacta, y ante la duda de si echar al intruso, echa a todos. Simplicidad y
robustez, no imposibilidad. También se corrigió la analogía: la comparación con
`elegirContrasena` no alcanzaba para justificarlo, porque ese flujo es **no autenticado** y
ahí el borrado total es la única opción, no una elección.

**Y por eso el fix tocó también el frontend**, que si no quedaba peor que antes:
`ContrasenaForm.vue` ahora avisa (*"Se cerraron todas las sesiones"*) y llama a
`authStore.logout()` en el momento. Sin eso, `useApiFetch` expulsa **sin explicación** en
cuanto vence el access token —hasta 15 minutos después, en cualquier pantalla—, porque su
rama de refresh fallido hace `clearAuth()` + `navigateTo('/login')` en silencio.

**Lo fija:** `me.service.spec.ts`, que no existía (el módulo `me` no tenía ningún test).
Mutante verificado: sacar el `delete` deja el test rojo **por su aserción**
(`Number of calls: 0`), no por un `TypeError` del mock. Se descartó un segundo test que
afirmaba sobre las claves del criterio: era redundante, porque `toHaveBeenCalledWith` ya
compara el objeto entero, y con el mutante fallaba por `TypeError`.

## El motor de permisos ataba el rol al usuario, pero no al tenant — y eran cinco consultas, no tres (2026-08-15)

**Entrada original (verbatim):** *"🚩 **El motor de permisos y `assignUser` no atan el rol a
su tenant** (backend, auditoría RBAC/auth 2026-08-15; **lo vieron dos lentes ciegas entre
sí**) — dos mitades que van juntas o el arreglo queda a medias: 1. `roles.service.ts` →
`assignUser` valida que el **usuario** sea miembro del tenant, pero nunca que el **`rolId`**
pertenezca a ese tenant. Sus hermanos del mismo archivo (`update`, `remove`,
`findPermissions`, `setPermissions`) sí lo hacen. 2. Peor y más de fondo: **las tres
consultas de `rbac.service.ts` unen `JOIN roles r ON r.rol_id = ru.rol_id` sin
`r.tenant_id = ru.tenant_id`** (verificado abriendo el archivo), y la del permiso completo
tampoco ata `tenant_modulos` al tenant. O sea que una fila cruzada **se evalúa de verdad**:
no es una fila inerte. ⚠️ **Severidad media, no alta, y el encuadre importa:** la ruta exige
`TenantAdminGuard`, así que el actor ya es admin de su tenant; `ru.tenant_id` es siempre el
del token, así que **no hay acceso a datos de otro tenant**; y hace falta conocer el UUID de
un rol ajeno (trivial en el seed, no adivinable en prod). Lo que se cruza es el borde de
módulos contratados — ver la entrada de ese tema en la sección 4. **Arreglar solo
`assignUser` deja el motor confiando** en cualquier fila que entre por otro camino. Es el
patrón de 'fix a medias' que este método ya cobró una vez."*

**La entrada subcontaba: son cinco consultas, no tres.** Medido abriendo el archivo — las
dos de `userHasPermiso`, la de `userIsTenantAdmin` y las dos de `getMisPermisos` unen
`roles` por `rol_id` a secas. Las cinco llevan ahora
`AND r.tenant_id = ru.tenant_id` **en el JOIN**, no en el `WHERE`, para que el invariante se
lea donde se une.

**`tenant_modulos`:** el JOIN de `userHasPermiso` no ataba el tenant; el de `getMisPermisos`
sí, pero por `WHERE tm.tenant_id = $2`. Se unificó: los dos lo atan en el JOIN
(`tm.tenant_id = ru.tenant_id`) y se sacó el `WHERE` duplicado. En un archivo que decide
accesos, que dos consultas gemelas se escriban distinto es peor que la línea de más.

**Lo que hubo que verificar antes de tocar nada: `roles.tenant_id` es nullable**, así que
atar el JOIN dejaría afuera cualquier rol global. Medido: **cero filas con `tenant_id`
NULL** en la base, y los seis `INSERT INTO roles` del seeder más `RolesService.create` lo
setean siempre. La columna nullable es herencia, no una función. Queda anotado en el
docblock: si algún día se quiere un rol global, que conceda permisos en todos los tenants
tiene que ser una decisión de producto, no la herencia de un JOIN sin atar.

**La otra mitad:** `assignUser` ahora busca el rol con `findOne({ where: { id, tenantId } })`
y tira `NotFoundException`, igual que sus cuatro hermanos del mismo archivo. Valida el rol
**antes** de consultar la membresía del usuario.

**Lo fija:** dos specs que no existían — `rbac.service.spec.ts` (10 tests) y
`roles.service.spec.ts` (6). Cubren primero **lo que concede** acceso, no lo que lo niega,
porque un `return true` sin test es peor que un `return false` sin test. Las aserciones de
SQL corren sobre las consultas **efectivamente ejecutadas** (`dataSource.query.mock.calls`),
no sobre el texto del archivo, así que el docblock que menciona la misma cláusula no las
puede satisfacer por accidente. Tres mutantes verificados, los tres rojos por aserción:
quitar la atadura de `roles` en una sola consulta, quitar la de `tenant_modulos`, y quitar
la validación de rol de `assignUser` (mata 3 tests).

**El gemelo que no busqué, y lo encontró la revisión independiente.** Grepeé la carpeta de
cada módulo, no el repo entero — el error que este método ya cobró antes.
`garzones.service.ts` → `assertVinculable` lleva **la misma consulta duplicada a mano**, y su
propio docblock dice que *"replica el criterio de `RbacService.userHasPermiso`"*. Había
quedado desincronizada. Se le aplicaron las mismas tres ataduras (las dos subconsultas de
`roles`, más `tenant_modulos`), y se le agregó al docblock la advertencia de que **por ser
copia se desincroniza sola**, con este caso como precedente. Mitigante que igual conviene
saber: `puede_operar_salon` es dato advisorio, no gatea acceso.

**Y el gate estaba verde sobre líneas que nadie ejecutaba.** Segundo hallazgo de la revisión:
los unit corren con `DataSource`/`Repository` mockeados, y **ningún e2e pegaba a
`/rbac/mis-permisos`, `/rbac/es-admin` ni `PATCH /me/contrasena`**. O sea que el SQL
reescrito nunca había tocado Postgres. Se agregó `test/rbac-y-contrasena.e2e-spec.ts`
(7 tests): el caso 2 de `getMisPermisos` con `vendedor@paris.cl` —el único actor sin rol
fijo—, el contraste admin vs vendedor, y la muerte del refresh token al cambiar la
contraseña **con un control positivo al lado**, para que el 401 no pueda venir de que el
refresh nunca funcione en e2e. Cuenta registrada por test, no del seed: cambiarle la
contraseña a `vendedor@paris.cl` la rompería para las otras seis specs que loguean con ella.
Mutante verificado contra la base real: romper la atadura del caso 2 deja al vendedor con
**cero** permisos y el test rojo — o sea que el e2e ejercita la consulta, no la mira.

⚠️ **Lo que NO cierra:** la cobertura de `roles.service.ts` es solo de `assignUser`.
`setPermissions`, `findPermissions`, `create`, `update` y `remove` siguen sin test — ver la
entrada reducida en `pendientes.md`.
⚠️ **Y lo que el e2e NO prueba:** el aislamiento entre tenants propiamente dicho. Montar una
fila de `roles_usuarios` apuntando a un rol ajeno **ya no es posible por API** —era la mitad
del fix—, y armarla con SQL directo probaría un estado inalcanzable. Esa mitad la fijan los
unit, que afirman sobre la forma del SQL ejecutado.

🚨 **Y lo más importante: este frente NO está cerrado.** Queda vivo un **tercer gemelo** —
`tenants.service.ts:338`, en `findMembers`— con el mismo `JOIN roles` sin atar el tenant. Se
dejó afuera a propósito, porque ahí el JOIN es `LEFT` y la decisión no es un copy-paste; la
entrada está en [`pendientes.md`](pendientes.md). **Si estás leyendo esto para saber si el
criterio de permisos ya ata el tenant en todos lados: todavía no.** La advertencia va acá y
no solo allá porque `resueltos.md` es el archivo que se consulta para dar algo por cerrado, y
el link entre los dos archivos era de una sola dirección.

## Las dos preguntas que abrió el día, contestadas el mismo día (2026-08-15)

Las dos nacieron al cerrar entradas mecánicas: al abrirlas resultó que no lo eran, y se
elevaron en vez de resolverse solas. El owner las contestó y quedan cerradas.

### El historial de PIN: se topea, **con aviso**

**La pregunta:** `garzon_pin_evento` solo crece —el diseño decidió guardar todos los cambios
de PIN, no solo el último— y dos pantallas lo traían entero en cada carga. ¿Alguien necesita
verlo completo, o con los últimos N alcanza?

**La respuesta del owner: topear, pero que se note.** Ni paginar de verdad (nadie pidió
navegar el historial: se mira el final) ni topear a secas, que **recorta la historia en
silencio** — la pantalla muestra menos y nada avisa que hay más.

**Cómo quedó:** `eventosPinDe` devuelve `{ eventos, total }` — los últimos **50** más el
conteo completo, en dos consultas paralelas. El total **no lleva el `LIMIT`**: si lo llevara
toparía en 50 y el aviso diría *"50 de 50"*, o sea mentiría con más pasos.
El aviso vive en `PinEventosLista.vue` y no en cada pantalla, porque ese componente lo montan
**las dos** (la ficha del encargado y el perfil del garzón): *"Mostrando los últimos N de M"*,
y solo cuando efectivamente hay más.

⚠️ **Es un cambio de contrato**, y se llevó puesto lo que tenía que llevarse: el spec de la
ficha, el de `MiPinForm`, y un e2e que trataba la respuesta como array. Los tres se
actualizaron; que se pusieran rojos es exactamente lo que se esperaba de ellos.
**Mutantes:** sacar el `LIMIT` deja el test rojo por su aserción, y sacar el cartel del
componente también.

### Sin `SMTP_HOST` en producción: el sistema **sigue arrancando**

**La pregunta:** el agujero de la fuga ya estaba cerrado (el cuerpo del mail nunca se escribe
en el log). Lo que quedaba era si el arranque debía **negarse a levantar** sin SMTP.

**La respuesta del owner: no.** Se queda como está — arranca y registra un `error` diciendo
que ningún mail va a salir.

**Por qué es la correcta, y no solo la cómoda:** negarse a arrancar deja el **POS entero
caído** porque el mail no está configurado — nadie vende porque nadie puede invitar usuarios.
Y contradice el docblock de `MailService`, que dice explícitamente que este service **nunca
lanza hacia arriba**: un mail que no sale no puede tumbar la operación que lo originó.
**No hubo cambio de código**: la decisión confirma el comportamiento vigente. Lo que cambia
es que deja de ser un default accidental y pasa a ser una decisión registrada.

🔎 **Sigue pendiente el dato que decide la urgencia**, que no se consultó a propósito porque
listar variables de Railway expone credenciales: **¿el deploy de producción tiene `SMTP_HOST`
seteado?** Un clic en el dashboard. Ya no hay fuga en ninguno de los dos casos; lo que cambia
es si hoy los mails llegan o no llegan.

## La sección mecánica queda vacía: segunda tanda, once entradas más (2026-08-15)

Segunda tanda paralelizada, con la regla que salió de la primera: **repartir por dueño de
archivo, no por cantidad**. Los grupos fueron `tenants` (5 entradas, todas sobre
`tenants.service.ts`), `garzones` (2 sobre el mismo archivo), `roles` (2, porque la segunda
tiene que cubrir a la primera) y uno de **cobertura e2e pura** (2). El principal tomó la que
cruzaba módulos.

### Lo que se cerró

- **El tercer gemelo del criterio de permisos** (`findMembers`): atado en el `ON` y no en el
  `WHERE`, porque el JOIN es `LEFT` y ponerlo en el `WHERE` **haría desaparecer del roster** a
  cualquier miembro sin rol.
- **`switchTenant` no miraba si el tenant estaba borrado.** Su hermano `getMyTenants` sí.
  Devolvía 200 y un token para un tenant muerto; `TenantGuard` cortaba en la ruta siguiente,
  así que el usuario se enteraba un request después y con otro error.
- **Re-agregar a alguien le resucitaba `es_totem`**, en los dos caminos de revival.
- **El alta de usuario devolvía un 500 crudo** en la carrera del `23505`, en vez del 409
  accionable que ya tiraba el chequeo deliberado.
- **`setPermissions` no era transaccional** —si el `save` fallaba, el `delete` ya había
  commiteado y el rol quedaba sin permisos— **y su body no lo validaba nadie**: el `@Body()`
  estaba tipado con una interfaz inline, cuyo `metatype` reflejado es `Object`, que
  `ValidationPipe` excluye. Ahora hay una clase DTO.
- **`miPin` hacía cuatro consultas**: `listarEventosPin` volvía a buscar el garzón que el
  llamador ya tenía en memoria. Se partió en el método público (que sigue validando, porque su
  otro llamador recibe el id por URL sin validar) y un privado con solo la query.
- **Dos tests de aislamiento que no aislaban** y **dos coberturas e2e que no existían**: el
  efecto de invalidar el PIN al vincular, y una venta con un ítem en moneda extranjera.
- **`nombre: null` reventaba con 500** en los tres catálogos, más el nombre del **tenant** y el
  del **perfil**.

### Los tres errores que cazó el trabajo, no la lectura

1. **Una trampa del seed que habría hecho pasar un test falso.** Para probar "un `usuarioId`
   ajeno al tenant devuelve 400", el primer intento iba a usar el único miembro de Falabella
   — que es el superadmin, y **también es miembro real de Paris**. Habría devuelto 200 y el
   test habría "pasado" sin probar nada. Se corrigió creando un usuario propio de Falabella,
   siguiendo el patrón que `alta-usuarios-tenant.e2e-spec.ts` ya usa para el mismo problema.
2. **Una entrada del backlog se puso obsoleta a mitad de la tanda.** El agente de `tenants`
   estaba copiando el patrón de `UpdateCausaMermaDto` cuando el principal, en paralelo, le
   agregó un tercer decorador a ese mismo archivo. Lo detectó releyendo y **lo verificó
   empíricamente** —escribió un spec descartable para confirmar que `@IsOptional()` deja pasar
   `null`— en vez de confiar en el texto de la entrada o en su primera lectura.
3. **Un mutante mal aplicado dio un falso "test decorativo".** Al verificar la cobertura de
   moneda extranjera, el primer `perl -0pi -e "s/\.times\(tasa\)/…/"` **sin `/g`** reemplazó
   la primera ocurrencia, que estaba **en el docblock**, no en el código. El test pasó y
   parecía inútil. Repetido sobre la línea real: `Expected "9500.0000", Received "0.0105"`.
   Es la misma trampa que el repo ya tiene anotada para las aserciones sobre SQL, esta vez
   del lado del mutante.

### Y un cuarto error, cazado por la revisión en el archivo del propio fix

`update-my-tenant.dto.ts` blindó `nombre` con el trío de decoradores **y dejó `correo` y
`provinciaId` con `@IsOptional()` puro** — las dos columnas son igual de `NOT NULL`, así que
seguían con el mismo 500 que el cambio decía cerrar. Mismo archivo, mismo commit, misma
motivación escrita arriba. Cerrado con su mutante; `telefono` y `direccion` sí conservan
`@IsOptional()` a propósito, porque sus columnas son nullables y ahí `null` es la forma
legítima de **borrar** el dato.

### Y una que se elevó en vez de cerrarse

El `LIMIT` de `listarEventosPin` **no era mecánica**. Topear recorta la historia sin decirlo;
paginar con el patrón que el repo ya usa en 8+ módulos cambia el shape de la respuesta y toca
las dos pantallas que la consumen. Pasó a la sección 4 con la pregunta concreta.

### La decisión que no se tomó sola

Ante el array vacío en `setPermissions` —¿bug o función?— el agente **buscó precedente en vez
de decidir**: `cajones` tiene el mismo patrón con el comentario *"array vacío es válido: deja
el cajón sin asignados"*, dentro de una transacción. Lo trató como decisión ya tomada por el
proyecto y lo dejó marcado por si ese precedente no aplica a permisos.

## Once entradas mecánicas en paralelo, y los dos huecos que la paralelización destapó (2026-08-15)

Primera tanda corrida con **cinco agentes en paralelo**. Lo que decidió la partición no fue
el conflicto de archivos sino **los recursos compartidos**: hay un solo Postgres y
`reset-db.sh` hace `docker-compose down -v`, así que un agente que lo corra le vuela la base
a los otros cuatro; y el backend bind-montea el fuente, así que editar un `.ts` recompila y
**re-siembra** el contenedor de todos. Los worktrees no lo arreglan, lo empeoran: el stack de
compose no ve los archivos del worktree, así que un e2e ahí correría contra el código viejo y
volvería verde sin probar nada.

**La regla que salió, y que conviene sostener:** los agentes **escriben y corren solo su
propio spec**; el gate completo lo corre el principal, **en serie**, al final. Dos
`nuxt build` concurrentes también se pisan el `.nuxt/`.

### Lo que se cerró

- **La moneda del ítem no llegaba a la pantalla de mermas.** `inventario` ya traía
  `i.moneda_id` en el kardex; `mermas` tenía **cero** ocurrencias, así que un ítem importado
  en USD mostraba su merma como si fueran pesos. ⚠️ La entrada decía *"los dos `SELECT`"* y en
  realidad el `COUNT(*)` no selecciona columnas: los que había que tocar eran **el de `findAll`
  y el del `POST`**, que arma su propia fila y la inserta en el listado sin refetch — sin eso,
  la merma recién creada quedaba con el bug hasta recargar. Ese segundo no estaba en la entrada.
- **Se podía dejar sin nombre una causa de merma o un motivo de diferencia.** Esta entrada se
  equivocó **dos veces** antes de cerrar, y las dos las cazó algo distinto:
  1. ⚠️ **Eran tres DTOs, no dos.** Existen dos módulos vivos con rutas distintas
     —`/motivos-diferencia` y `/motivos-diferencia-inventario`— y la entrada nombraba solo el
     segundo, que **no** es el que sirve la ruta que el test nuevo golpea. Lo cazó el e2e:
     `Expected 400, Received 200` con el DTO "arreglado".
  2. ⚠️⚠️ **Y `@IsNotEmpty()` no cerraba el hueco.** Rechaza `''` exacto, **no `'   '`**; y
     como el service hace su `.trim()` **después** de validar, un nombre de solo espacios
     reproducía el bug entero. Los tres e2e probaban `''` y ninguno `'   '`, así que el gate
     pasaba en verde sobre un arreglo que no arreglaba. Lo cazó la **revisión independiente**,
     que lo verificó corriendo `class-validator` de verdad en vez de razonarlo.
     El arreglo correcto ya existía en el repo y no lo busqué: `RestaurarDto` tiene un
     `@Transform` que trimea **antes** de validar, con un comentario que dice literalmente
     *"`" "` tiene que fallar el `@IsNotEmpty` igual que `""`"*. Se copió a los tres.
  Los tres quedan cubiertos por e2e —`causas-merma`, `motivos-diferencia` y
  `motivos-diferencia-inventario`, este último dentro de `recuentos.e2e-spec.ts`— con los dos
  casos, `''` y `'   '`, porque quien rechaza es el `ValidationPipe` y en unit no corre.
  Mutante verificado: sacar el `@Transform` devuelve 200 y pone el test rojo.
  🔎 Al buscar el resto **por conducta y no por nombre** (campos `string` opcionales con
  `@MaxLength` y sin `@IsNotEmpty()`, en todo `src/**/dto/`) aparecieron **9 sitios**: siete son
  `comentario`/`apellido`/`telefono`, donde vacío es legítimo, y uno es el nombre del **tenant**,
  que quedó como entrada nueva en `pendientes.md`.
- **El e2e del simulador de costos comparaba contra el valor viejo.** `not.toBe('1200.0000')`
  pasaba con cualquier recálculo equivocado. Ahora compara contra `costoPropuesto` y
  `precioSugerido`, que **la propia bandeja devuelve**: sin números hardcodeados que se
  desincronicen si cambia la fórmula del CPP.
- **El e2e de mermas no miraba el stock.** La respuesta ya traía `stockResultante` y nadie lo
  leía. Se afirma contra el stock previo **y** contra la base con un `GET` posterior: un
  `stockResultante` bien calculado y mal persistido pasaba lo primero.
- **El reintento por deadlock de `RecuentosService.aplicar` no lo ejercitaba nada** (cero
  ocurrencias de `40P01` en 754 líneas de spec). Cuatro tests: reintenta y sale bien, no
  reintenta con otro `code`, no reintenta si no es `QueryFailedError`, y si el reintento
  también falla el error que se propaga es **el del segundo intento** (`toBe` por referencia).
- **Las dos barreras de tenant de serie y lote no tenían test.** ⚠️ Las líneas de la entrada
  habían derivado. Y el primer intento cayó justo en la trampa que el brief advertía: con el
  mock incompleto, el mutante fallaba por `TypeError` de una query no mockeada en vez de por la
  aserción; se completó la cadena de mocks hasta el final del camino feliz.
- **`/admin` era la única página sin guard de cliente.** El middleware correcto es `auth`, no
  `admin`: `middleware/auth.ts:27-31` tiene un branch propio para `/admin` que chequea
  `isSuperadmin`, mientras que `admin.ts` chequea `esAdmin` **del tenant** y redirige a
  `/configuracion`. Eran ejes distintos.
- **El garzón veía un toast rojo de permiso en la carga inicial de `/salones`.** Se silenciaron
  las cuatro llamadas de fondo (`/items` ×3 y `/tipos-documento`) **una por una y no en
  bloque**: `cargarCatalogo` incluye `/metodos-pago`, que el garzón **sí** puede leer, y un
  `.catch` en el call-site habría tapado un fallo real de esa. Hay un segundo test de
  contraejemplo que lo prueba.
- **Tres pantallas sin spec** (`ventas/pos.vue`, `tienda/index.vue`,
  `tienda/suscripciones.vue`): borrar `&activo=true` de una URL dejaba la suite en verde. El
  arnés se copió del spec de `salones/index.vue`. La de suscripciones resultó distinta: su
  consulta no sale en `onMounted` sino al abrir el drawer, gateado por permisos.
- **Dos de documentación.** El paso 4 de la prueba manual de `garzones.md` no se podía
  completar al pie de la letra —el selector solo lista garzones **con turno abierto** y el seed
  no abre ninguno, así que salía vacío y sin ningún mensaje que lo explicara—, y la spec del
  testigo prometía conteo a ciegas *"sin excepciones"* cuando el admin del tenant sí ve lo
  esperado (decisión del owner del 2026-08-13).

### Los mutantes

**Once entradas, once verificaciones.** Todos los agentes reportaron el mutante aplicado, el
test que se puso rojo **por su aserción** y el `git diff` vacío del archivo restaurado. Dos
merecen mención: el de `/salones` reprodujo el síntoma exacto del reporte (*"No tienes permiso
para esta acción"* en el array de toasts capturados), y el de serie/lote hubo que rehacerlo
porque el primero moría por `TypeError`.

## El log que reintroducía el token en claro, y el arranque que se dejó como está (2026-08-15)

**Entrada original (verbatim):** *"🚩 **Sin `SMTP_HOST`, los links de reset e invitación
quedan en el log en texto plano — y nada lo impide en producción** (backend, auditoría
RBAC/auth 2026-08-15) — `mail.service.ts` → `enviar()`: si no hay transporte, hace
`logger.log()` con el **cuerpo completo** del mail, que es el que lleva la URL con el token
en claro. **Grep de `NODE_ENV`/`production` en ese archivo: cero** (medido). `.env.example:49`
trae `SMTP_HOST=` vacío por default. ⚠️ **Loguear en vez de mandar es una decisión cerrada y
documentada** (hace falta para no disparar mails reales en cada corrida de CI). Lo que no
existe es el **gate de producción**: el sistema degrada en silencio a 'escribir el secreto en
el log' en vez de fallar fuerte. Tiene su ironía: `TokenAcceso` guarda solo el hash SHA-256
justamente para que el texto plano exista **una sola vez**, en el link del mail. Este log lo
reintroduce en el lugar que más gente puede leer."*

**El fix:** con `NODE_ENV=production` y sin `SMTP_HOST`, `enviar()` registra un `error` con
**destinatario y asunto** —lo necesario para reenviar a mano— y **ni una línea del cuerpo**.
El aviso de arranque también sube de `warn` a `error`. Fuera de producción no cambia nada: el
fallback con el link clickeable en el log es el loop de desarrollo y es deliberado.

**Lo que NO se hizo, y por qué:** negarse a arrancar sin SMTP en producción. Sería *fallar
fuerte* de verdad, pero deja el POS entero caído porque el mail no está configurado, y
contradice el docblock de la clase, que dice explícitamente que **este service nunca lanza
hacia arriba**. Es decisión de producto: quedó como entrada abierta en
[`pendientes.md`](pendientes.md), no resuelta por cuenta propia.

**Lo fija:** `mail.service.spec.ts`, que no existía. Ocho tests, y el que importa es el que
mete un token reconocible en el cuerpo y afirma que **no aparece en ninguno de los tres
niveles de log**. Mutante verificado: quitar el guard de producción deja
`TOKEN-EN-CLARO-abc123` escrito y dos tests en rojo por su aserción.

## El `expect` que faltaba en 29 specs destapó un test que nunca había probado nada (2026-08-15)

**Entrada original (verbatim):** *"🚩 **Los 23 helpers de login del e2e no afirman su status,
y eso fabrica el 401 intermitente** (backend/tests, auditoría RBAC/auth 2026-08-15) — **esto
explica la forma de los cuatro avistajes** de la entrada del flaky. Medido: 23 de los 32
`*.e2e-spec.ts` leen `resLogin.body.access_token` / `resTenant.body.access_token` **sin
verificar `.status`**. Si el login o el `switch-tenant` fallan una vez, `token` queda
`undefined` en silencio y todo el resto del `describe` manda `Authorization: Bearer undefined`
— que `JwtAuthGuard` rechaza con **401 en la siguiente ruta que se pida, no en la que falló**.
Un solo test por corrida, siempre otra ruta, nunca reproduce: la firma exacta."*

**La entrada subcontaba otra vez: son 29 archivos, no 23** — y **71 sitios**, no uno por
archivo (`recuentos` tenía seis, `caja`/`papelera`/`recetas`/`alta-usuarios` cuatro cada uno).
Se midió por **conducta**, no por forma: cualquier `const <var> = await request(...)` cuya
`<var>.body` alimente un `access_token`, sin `expect(<var>.status)` cerca. Las siete formas
distintas de helper que hay en el repo hacían inútil buscar por texto.

⚠️ **Dato que se cobró en el momento: `/auth/login` y `/auth/switch-tenant` devuelven 200, no
201** — los dos llevan `@HttpCode(HttpStatus.OK)`. El primer intento asumió 201 y puso cuatro
specs en rojo.

**Y lo que la barrida destapó, que es el verdadero valor:**
`ventas.e2e-spec.ts` → *"retorna 400 si no hay caja abierta para el usuario"* **estaba verde
sin ejercitar nada**. Logueaba con `password: 'Vendedor1234!'` cuando el seed usa `'admin'`
—como los otros seis specs que usan esa cuenta—, así que el login devolvía 401, el token
quedaba `undefined`, y un `if (!vendedorToken) return` con el comentario *"si el usuario
vendedor no existe en seed, saltear"* **salía del test antes de pedir nada**. El escape existía
para tolerar un seed que sí tiene esa cuenta hace tiempo.
Se corrigió la contraseña, se agregó el `switch-tenant` que faltaba, se borró el escape, y se
apretó la aserción: ahora además del 400 comprueba el mensaje `'No tienes una caja abierta'`,
porque cualquier fallo de validación del body daría 400 igual y el test dice cubrir la caja.

⚠️ **Lo que esto NO resuelve:** por qué el login falla esa vez. La entrada ya lo decía y sigue
siendo cierto — esto explica la **propagación**, no el disparador. Lo que cambia es que el
próximo rojo cae en el login y dice qué contestó, en vez de aparecer dos rutas más tarde.

**El porqué quedó en un solo lugar**, no replicado en 29 archivos: `docs/patterns/backend.md`
§7. No se agregó a `anti-patterns.md` porque ese archivo está en su tope de 20 entradas y su
propia regla 3 pide hacer lugar antes de sumar, que es trabajo aparte.

---

## El redondeo de la conversión de moneda: dos sitios, y el que importaba no era el anotado (2026-08-11)

**Entrada original (verbatim):** *"**`convertirAMonedaOficial` redondea a 4 fijo** (backend,
`calculo-precios.service.ts:188`) — **hallazgo del refutador, ninguna lente lo vio**: el
`.toFixed(4)` ignora `escalaCalculo` y `modoRedondeo` del tenant, y ocurre justo antes de
entregarle el precio al motor que sí los respeta. Un paso de redondeo fuera de la config."*

Los dos hechos que afirma son ciertos. Lo que estaba mal era todo lo demás: **el sitio, y
que fueran un solo problema.**

**Primer intento, revisado y revertido sin commitear.** Se arregló el modo en
`convertirAMonedaOficial` y se documentó el 4. La revisión independiente lo bloqueó midiendo
lo que el docblock afirmaba: **la venta nunca pasa por esa función**. `ventas.service.ts`
hacía su propia conversión (`precioOrigen × tasa`, `.toFixed(4)`) y la pasaba como
`precioUnitario`, así que la rama del `??` nunca se tomaba — y ese era el número que se
persiste en `venta_detalles.precio_unitario`. El arreglo cubría solo la previsualización.
Peor: **creaba una divergencia que no existía**. En el alta de suscripciones el monto que se
le autoriza a la tarjeta sale de `calcular` y el que se guarda lo reconvierte la venta; los
dos eran HALF_UP y coincidían. Con medio arreglo, un tenant en `FLOOR` podía ver los dos
números distintos. Se revirtió el código a HEAD y se reescribió la entrada con lo medido
(commit `eb873e86`).

**Después, con el owner decidiendo "los tres sitios juntos", se midió el tercero y no
existía.** El `.toFixed(4)` de `precioBase + precioExtraTotal` **no puede redondear**:
`precio_extra` es `NUMERIC(18,4)` y `items.service.ts` rechaza unidades fraccionarias en las
dos ramas (extras: *"deben ser un entero mayor o igual a 1"*; grupos: *"Las unidades de la
opción deben ser un entero ≥ 1"*). La revisión lo reforzó: `precioExtraTotal` llega **ya**
con `toFixed(4)` desde los tres resolvers de `items.service.ts`, así que la suma es de dos
strings de 4 decimales pase lo que pase. Son **dos** sitios reales, los dos `precio × tasa`.
Queda un comentario para el día que las unidades admitan fracción — apuntando a
`items.service.ts`, que es donde caería ese redondeo, y no a ventas.

**Qué se hizo.** Los dos sitios pasaron a ser **uno**: `convertirAMonedaOficial` es pública y
la llaman los dos caminos. Esa era la causa de fondo —dos copias de la misma cuenta pueden
arreglarse por separado, y eso fue exactamente lo que casi pasa—. `modoToRounding` se exportó
del motor en vez de duplicar el `switch`. Y `cargarConfig` es pública para que ventas cargue
las preferencias una vez, convierta con ese modo y se las pase a `calcular` por
`configPrecargada`: **no son consultas nuevas**, son las dos de siempre movidas unas líneas
más arriba.

**Lo que no se tocó, y por qué.** La escala sigue en 4. `escala_calculo` es, según el
esquema, "decimales para cálculos intermedios"; este valor no es intermedio, se persiste en
`NUMERIC(18,4)`. Subirlo no evitaría el recorte: lo movería al `INSERT`, donde lo hace
Postgres con su propia regla, fuera de la config y sin que ningún test lo vea. **Cuidado con
cómo se escribe esto**: la primera redacción decía "las otras 74 columnas de plata del
esquema" y la revisión lo refutó —hay 75 `NUMERIC(18,4)` pero ~23 son cantidades y stock, y
hay plata a 6 decimales (`monto_tolerancia`, los montos de la pasarela)—. La afirmación que
se sostiene es acotada: *el libro mayor de ventas* va a 4.

**Lo que este cierre NO cierra, anotado para que no se lea de más.** "Único redondeo de
plata fuera del motor" era falso y la revisión lo refutó con contraejemplos: el CPP de
inventario, el costo propuesto de una receta, el reparto de propinas y dos sitios de mermas
siguen en HALF_UP fijo. Lo que sí se verificó es lo acotado: **un solo `.times(tasa)` en todo
`backend/src`**. Los que quedan abrieron entrada propia en [`pendientes.md`](pendientes.md),
porque la entrada que los habría alcanzado es justo la que este cierre borra.

**Magnitud** (`19.99 × 950.123456 = 18992.96788544`): el modo mueve el precio unitario en
`0.0001` (`FLOOR` → `18992.9678` en vez de `18992.9679`). No es plata que se pierda; es la
configuración del tenant desobedecida, en el número que queda guardado.

**Qué lo fija:** cuatro tests y **tres mutantes, cada uno muerto por el test que le toca**.
En `calculo-precios.service.spec.ts`: el modo (`FLOOR → …9678`, `CEIL`/`HALF_UP → …9679`, con
tasa de 6 decimales a propósito — con la tasa redonda del resto del spec los cuatro modos dan
igual y el test no probaría nada), la escala persistida, y que `configPrecargada` evita la
segunda consulta. En `ventas.service.spec.ts`: que el modo del tenant llega a la conversión
**que se persiste** — el test que faltaba en el primer intento y que habría bloqueado el
arreglo a medias solo. Los mutantes: volver al `.toFixed(4)` en `calculo-precios.service.ts` —el service, no el
`engine`— cae el primero;
devolverle a ventas su conversión propia cae el de ventas; subir `ESCALA_PERSISTIDA` a 6 cae
dos. Ese último existe porque el arreglo **se ve** incompleto e invita a "terminarlo".

## El alta de una suscripción cobraba y se callaba lo que el motor tenía para decir (2026-08-11)

**Entrada original (verbatim):** *"**`suscripciones.service.ts:87-90` descarta
`resultado.advertencias`** (backend, medido 2026-08-03) — la justificación escrita ("hoy
ningún ítem de suscripción tiene descuentos") es más angosta que la superficie nueva: ahora
ese descarte también se traga los avisos de regla o impuesto pausado sobre el primer
período."*

**La entrada apuntaba al descarte equivocado.** El alta llama al motor **dos veces**: en el
paso 5 para saber cuánto autorizarle a la tarjeta, y otra vez adentro de la venta del paso 9.
La entrada nombra el primero; el que perdía información era el segundo.

El criterio para elegir no es de contenido sino de **autoridad**: la venta es el cálculo que
queda persistido, así que sus advertencias explican la fila que existe; las del paso 5
explican un intermedio que no sobrevive. Hoy los dos conjuntos son **idénticos** —argumentos
equivalentes, y las advertencias que la venta agrega por su cuenta son de recetas y combos,
inalcanzables acá porque el paso 1 rechaza todo lo que no sea `tipo='suscripcion'`—. La
primera redacción de este cierre decía "superconjunto" y que la venta "le suma recetas y
combos": **la revisión independiente lo refutó leyendo el código**, y el docblock quedó
reescrito sobre la autoridad, que es el argumento que sí se sostiene si los dos conjuntos
alguna vez divergen (los dos caminos arman su mapa de tasas por consultas distintas).

**Qué se hizo.** `crear()` devuelve `advertencias: string[]` tomadas de `venta.advertencias`
— siempre presente, vacío si no hay nada, misma convención que `garzones.service.ts` (sin eso
el cliente no distingue "no hubo nada que avisar" de "este endpoint no avisa"). El composable
`useSuscripciones` las separa del resto en vez de guardarlas en la fila: describen el cobro
que acaba de ocurrir, no el estado de la suscripción. La página las emite como un toast por
mensaje, igual que `ventas/pos.vue` con una venta. El descarte del paso 5 queda, ahora con el
porqué escrito encima.

**No frenan el alta**, y no es un descuido: para cuando existen, el cobro contra Transbank ya
ocurrió. Son la explicación de por qué el monto autorizado puede no ser el precio de catálogo,
no una confirmación previa. Que la tienda **no muestre un precio calculado antes de cobrar**
es otra cosa, y más grande: quedó anotada aparte en [`pendientes.md`](pendientes.md).

**Qué lo fija:** dos tests en `suscripciones.service.spec.ts`. El happy path exige
`advertencias: []` —vacío, no ausente—; el segundo hace que **las dos** llamadas al motor
avisen cosas distintas y afirma que sale la de la venta. Dos mutantes, los dos muertos:
borrar la línea cae 2 tests; cablearla a `resultado.advertencias` del paso 5 cae **1**, el
segundo.

**Y eso último recién es cierto después de arreglar el mock.** La primera versión de este
cierre afirmaba ese "cae 1" sin haberlo medido; la corrida real decía 2, porque el mock de
`calcular` omitía `advertencias` y el mutante producía `undefined`, que el happy path
rechazaba **por forma, no por procedencia**. Lo encontró la revisión independiente. El mock
ahora devuelve `advertencias: []` como el motor real, y con eso cada test falla por lo suyo y
el segundo es de verdad el único que sostiene la regla. La lección no es la frase mal
contada: es que **un mock infiel le presta cobertura a un test que no la tiene**, y el
recibo escrito acá la habría dado por buena.

## Con el seed a secas ya se puede ver una comanda (2026-08-11)

**Entrada original (mitad restante, verbatim):** *"Con el seed a secas
`agruparEstacionesComanda` devuelve `[]`, así que hubo que cablear una categoría por SQL
para ver una comanda en pantalla. La categoría **existe y tiene impresora** —"Ropa y
accesorios" → "Cocina", puesta a propósito con ese comentario en el seeder—, pero **no
tiene ningún ítem adentro**. El arreglo es asignarle `categoriaId` a un ítem vendible del
seed, no crear categoría ni impresora."* (La mitad de test se había cerrado el 2026-08-09.)

**Un parámetro de más en un `INSERT`:** la receta "Hamburguesa Especial" ahora se siembra
con `categoria_id`. La intención ya estaba escrita en el seeder desde la feature de
impresión —*"Demo: rutea a Cocina para poder probar el flujo de comanda sin configurar
nada manualmente"*— y nunca llegaba a ningún ítem: la categoría ruteada estaba vacía.

**Verificado como pide la entrada —a mano, con el seed y nada más—**, no con un test que se
monta sus fixtures (ese ya existía). Reset, y por API: garzón, turno, salón y mesa del
seed, la hamburguesa a la cuenta, `GET /cuentas/:id/comanda/pendiente` →

```
estaciones: [{ nombre: "Cocina", items: [{ nombre: "Hamburguesa Especial", cantidad: "1" }] }]
```

Antes de esto, `estaciones: []`.

**Se eligió la receta y no un producto** porque una comanda de cocina con una hamburguesa
es el demo que alguien va a querer mirar. Y **no se renombró la categoría**, aunque
"Hamburguesa Especial" bajo "Ropa y accesorios" queda raro: el nombre está referenciado en
[`impresion-termica.md`](../features/impresion-termica.md) y en el plan de esa feature, así
que renombrarlo se ramifica más de lo que la entrada pedía. En la comanda no se ve —agrupa
por impresora, así que el ticket dice "Cocina"—; se ve en la pantalla de ítems.

**El seed es el escenario inicial de los 30 specs**, que era el riesgo que la entrada
marcaba: e2e completo en verde, 398 tests.

---

## Una asimetría de guard que no era un pendiente sino un porqué (2026-08-11)

**Entrada original (verbatim):** *"Asimetría de guard entre rutas hermanas (backend) —
`GET /items/:id/uso` exige `Items:Eliminar`; la ruta hermana
`GET /items/:id/recetas-afectadas` exige solo `Items:Leer`. Es una decisión deliberada
(solo quien puede borrar necesita ver el impacto del borrado), no un descuido — se anota
por si el frontend en algún momento quiere el dato de uso fuera del flujo de borrado."*

**No había nada que hacer, y por eso estaba mal ubicada.** `pendientes.md` es una lista de
trabajo; esto es la explicación de una línea que **parece** un error y no lo es. Vivía
donde nadie lo iba a leer en el momento en que importa: al mirar el guard.

Se movió a un docblock sobre la ruta, con la condición que la reabriría —si el front quiere
el dato de uso fuera del flujo de borrado, este guard no alcanza— escrita ahí mismo.

---

## El e2e no fijaba `testTimeout`, así que cada spec tenía 5 segundos para arrancar (2026-08-11)

**No venía del backlog: apareció en el gate.** Cerrando otra cosa, `garzon-modo-personal`
se puso rojo con 14 tests caídos y un solo motivo: *"Exceeded timeout of 5000 ms for a
hook"* en su `beforeAll`. La re-corrida sobre base fresca dio verde — flaky, no regresión.

**La causa no era de ese spec.** `test/jest-e2e.json` no declaraba `testTimeout`, así que
todos los hooks caían en el **default de Jest: 5 segundos**. Y el `beforeAll` de cada spec
e2e compila el `AppModule` **entero**. Doce de los specs no tenían timeout propio —los
otros lo habían parchado uno por uno con `}, 60000)`— o sea que estaban todos a un arranque
lento del mismo fallo, y el que cayó fue cuestión de suerte.

`"testTimeout": 30000` en la config, que en Jest aplica a tests **y** hooks. Seis veces el
default, y sigue muy por debajo del tope de 25 min que el job de CI tiene desde hoy: un
cuelgue real se sigue reportando, lo que deja de reportarse es un arranque lento.

**Por qué se anota una config de tres palabras:** el flaky costó una re-corrida completa
del gate para descartar que fuera una regresión del cambio que estaba cerrando, que es
exactamente el impuesto que cobra un flaky.

---

## Diez líneas con el mismo impuesto pausado daban diez toasts (2026-08-11)

Dos entradas hermanas de la auditoría de `items` + `calculo-precios`, cerradas juntas
porque son el mismo ruido por dos puertas.

**Las entradas, verbatim:** *"El aviso de ítem pausado se emite por línea — el mismo ítem
en 3 líneas (recetas personalizadas, salones) da 3 toasts idénticos en el POS."* y *"Una
advertencia de impuesto pausado se repite por línea, y se emite aunque la fórmula del
tenant no incluya el paso `impuestos` — un carrito de 10 líneas con el mismo impuesto
pausado produce 10 advertencias idénticas. Puede ser deliberado (las advertencias de línea
son por línea por naturaleza), pero para una regla global al catálogo el ruido es real."*

**Medido antes de tocar nada**, que es lo que convirtió el "puede ser deliberado" en una
pregunta contestable: 10 líneas → 10 avisos; y con la fórmula `['descuentos','recargos']`
—sin el paso de impuestos— el aviso *"está en pausa y no se aplicó"* **igual salía**.

**Decisión del owner (2026-08-11): uno por regla.** El aviso de algo pausado es información
de **catálogo**, no de una línea; repetirla no agrega nada y tapa los avisos que sí son de
una línea.

**Lo que se cambió, y por qué en dos lugares y no en uno:**

- `sinRepetidas` en `calculo-precios.engine.ts`, sobre el aplanado `advertencias`.
- Un `Set` por `itemId` en `advertirItemsPausados` (`calculo-precios.service.ts`). **La
  deduplicación del motor no lo alcanza**: esa advertencia se empuja *después* de que
  `calcularVenta` devolvió. Si aparece una tercera fuente fuera del motor, va a necesitar
  lo mismo — queda escrito en `motor-calculo-precios.md`.
- El aviso de impuesto pausado ahora solo se emite si `cfg.formula.includes('impuestos')`.
  Se armaba antes de recorrer la fórmula: en un tenant sin ese paso, *"no se aplicó"*
  describía la fórmula y lo hacía pasar por consecuencia de la pausa.

**Lo que NO se tocó, y tiene su propio test:** `ResultadoLinea.advertencias` y
`advertenciasVenta`. Ahí la repetición es la que marca **cuáles** líneas están afectadas —
si se dedujeran también, el aviso quedaría arriba sin decir a qué línea mirar. El test
`pero cada línea conserva el suyo` existe para que nadie "termine el trabajo" por error.

**Seis tests nuevos y tres mutantes, uno por cada mitad del cambio:**

| Mutante | Qué murió |
|---|---|
| `sinRepetidas` → identidad | 1: `10 líneas … dan UN aviso` |
| aviso de impuesto sin el guard de `formula` | 1: `sin el paso impuestos … NO avisa` |
| `advertirItemsPausados` sin el `Set` | 1: `el mismo ítem pausado en 3 líneas avisa UNA vez` |

Ninguno tocó los tests de los otros dos, que es lo que confirma que son tres caminos
independientes. Y el control `dos reglas pausadas DISTINTAS siguen dando dos avisos` es el
que evita que la deduplicación se pase de lista.

**Lo que encontró la revisión independiente, y que era serio:**

1. **Un byte NUL crudo dentro del código**, en la clave de deduplicación. El editor y
   `git diff` lo mostraban como un espacio; `file` decía `data`, no texto. Y lo peor no era
   cosmético: el pre-commit usa `git diff --cached | grep` para sus guards de `tenant_id`
   y `DELETE` físico, y **sobre un archivo binario ese grep no devuelve nada**, así que el
   archivo entero quedaba fuera de la única red mecánica del repo. Se reemplazó por
   `JSON.stringify([titulo, detalle])`, que además no depende de ningún separador.
2. **La deduplicación es más ancha que "lo pausado"**: también colapsa el aviso del tope,
   que es por línea. Era un ensanche no declarado del pedido del owner. Se revisó y **se
   mantiene** —dos textos idénticos no le dicen al lector que hubo dos eventos, y el
   `detalle` no nombra montos ni líneas a propósito— pero ahora está escrito como decisión
   y tiene su propio test, en vez de ser un efecto lateral.
3. **La clave del `Set` de ítems iba con el casing crudo.** `@IsUUID('4')` acepta
   mayúsculas y la BD devuelve minúsculas —por eso existe `aliasarCasingDeIds`—, así que el
   mismo ítem con dos casings en el mismo carrito se contaba dos veces: exactamente el bug
   que este cambio venía a cerrar. La clave ahora va en minúsculas.
4. **`impuestos` no tiene índice único de nombre por tenant** y sus hermanas sí. Es lo
   único que hace que el colapso pueda esconder algo. Quedó como entrada nueva en
   [`pendientes.md`](pendientes.md), con las dos preguntas que hay que responder antes de
   agregar el índice.

**Sigue abierta la tercera hermana:** `suscripciones.service.ts` descarta
`resultado.advertencias` enteras, así que sobre el primer período de una suscripción estos
avisos no llegan igual. La deduplicación no cambia eso.

**Gate:** backend 98 suites / 1574 unit, e2e 29 suites / 398, frontend completo.

---

## Los dos jobs de CI dejan de poder colgarse seis horas (2026-08-11)

**Entrada original (verbatim):** *"El job de CI del frontend necesita timeout propio
(2026-08-06) — con `hookTimeout` en 60s y `testTimeout` en 20s, un entorno Nuxt realmente
colgado tarda hasta un minuto por archivo en reportarse, y hay 22 `.nuxt.spec.ts`. Hoy no
hay un `timeout-minutes` en `.github/workflows/ci.yml`. Prioridad baja."*

`timeout-minutes: 25` en `gate` **y también en `e2e-navegador`**, que la entrada no
mencionaba y tiene el mismo agujero: un Playwright que no arranca tampoco puede quedarse
seis horas —el default de GitHub— ocupando un runner.

**El 25 no es al ojo:** las tres corridas más recientes tardaron **4 min 30 s** de punta a
punta (medido con `gh run list`), así que deja ~5× de margen. Un job que toque ese número
no está lento: está colgado, que es exactamente lo que el tope tiene que distinguir.

---

## Ocho lecturas que morían con un `TypeError` en vez de decir qué pasó (2026-08-11)

Mitad de la entrada del flaky de caja, que sigue abierta por su otra mitad (la causa del
flaky, todavía sin determinar).

**El problema, verbatim de la entrada:** *"el helper `usuarioIdDe` hace
`(res.body as Member[]).find(...)` **sin mirar el status**, así que cuando la respuesta no
es la lista el test muere con un `TypeError` sobre `.find` en vez de decir qué contestó el
servidor. Eso convierte un diagnóstico de un minuto en una sesión de forense."*

**Lo que se hizo:** afirmar `status` y `Array.isArray` **antes** del casteo, en los tres
archivos donde el grep encontró el molde. En `alta-usuarios-tenant.e2e-spec.ts` eran
**ocho** repeticiones —la entrada decía seis, el grep del cierre encontró dos más—, así que
ahí no se copió la aserción ocho veces: salió un helper `listarMiembros(app, token)`. En
`caja.e2e-spec.ts` y `cajones.e2e-spec.ts` es un solo uso cada uno y quedó inline, según la
convención del repo (duplicar dos veces se acepta, se extrae a la tercera).

**Verificado que hace lo que promete, no solo que compila:** se apuntó el helper a una ruta
inexistente y el fallo pasó a ser

```
expect(received).toBe(expected)
Expected: 200
Received: 404
```

en vez del `TypeError: .find is not a function` de antes. Después del revert, los 10 tests
del spec en verde.

⚠️ **Esto no arregla el flaky** y no pretende hacerlo: lo saca de mudo. La causa sigue
abierta en [`pendientes.md`](pendientes.md).

**Gate:** backend 1569 unit, e2e 29 suites / 398 tests.

---

## El cuaderno de anti-patrones vuelve a su tope, y sin borrar nada (2026-08-11)

**Entrada original (verbatim):** *"`anti-patterns.md` pasó su propio tope de 20 entradas y
nadie podó (docs, `docs/agent/anti-patterns.md:14`) — la regla 3 del archivo dice 'Tope: 20
entradas. Si se llena, la más antigua sin reincidencia se elimina'. Medido el 2026-08-07:
**25** entradas `### ❌`. Ya estaba en 23 antes de esa tanda, así que no lo rompió un commit
puntual: el tope nunca se aplicó."*

**El owner la delegó en el agente** (2026-08-11): es herramienta del harness, no producto.

**Lo que se hizo, y por qué no fue podar.** La regla mandaba borrar 5 entradas, y borrar
era la peor salida disponible: **cada entrada es un bug que ya se pagó**, y ninguna de las
25 era relleno. Se llegó a 20 por otros dos caminos que no pierden nada:

- **Fusión de 5 en 1.** Las cinco entradas de `vue-tsc` estricto (`@click` que devuelve
  valor, índice sin guard, `string | null` contra Nuxt UI, mismatch con reka, tipado de los
  unit tests) son **la misma lección con distinto código de error**: `vue-tsc` rechaza lo
  que `nuxt build` acepta, y el fix es siempre solo-de-tipo. Quedaron como subsecciones
  `####` de una entrada única, con todo el contenido intacto.
- **Una pasó a `✅ AUTOMATIZADO`** (regla 2 del archivo, que ya existía y tampoco se venía
  aplicando): la de Tailwind hardcodeado, que `check-design-tokens.mjs` enforcea en el gate
  y en el pre-commit. Su propio texto ya decía "AUTOMATIZADO" adentro pero seguía contando
  como entrada activa.

Resultado: **20 exactas**, 3 stubs de automatizadas, 0 líneas de conocimiento perdidas.

**La regla 3 se reescribió** para que la próxima vez no haya que reinventar el criterio:
primero pasar a `✅` lo automatizado, después fusionar caras del mismo error, y **borrar
recién al final**. Con la nota de que esta fue la primera vez que el tope se ejecutó desde
que existe.

---

## El orden de los descuentos deja de decidirlo el azar de una query (2026-08-11)

**La entrada estaba abierta desde el 2026-07-28** y es la más vieja de las que se cerraron
en la ronda. Preguntaba con qué criterio se ordenan los descuentos de un ítem: en modo
`compuesto` cada regla se aplica sobre el acumulado de la anterior, así que el orden cambia
el total —1000 con un 20% y un fijo de 100 da **700 o 720** según cuál vaya primero— y ese
orden no estaba definido en ninguna parte. El batch del 2026-07-28 había puesto un
`ORDER BY` por id **solo para que fuera determinista**, no porque fuera el criterio
correcto, y la tabla puente no tiene timestamp: "el orden en que el usuario los agregó" no
existe ni se puede recuperar.

**Precondición que el owner puso el 2026-08-08:** investigación de mercado antes de
diseñar. Corrida y registrada en
[`investigaciones/2026-08-11-orden-de-descuentos.md`](investigaciones/2026-08-11-orden-de-descuentos.md).
Lo que trajo, y que cambió la conversación:

- **No hay estándar que copiar.** Los cuatro sistemas relevados fijan el orden en el motor
  y ninguno lo hace configurable — y Toast y Square lo fijan **al revés uno del otro**.
- **La prioridad configurable, que era la forma que el owner prefería, no la usa ningún
  POS**: aparece en e-commerce y apps de terceros. El insumo original le atribuía un
  respaldo que no tiene.
- El SII no impone nada: estandariza campos, no algoritmo. La decisión es de producto.

**Decisión del owner (2026-08-11): criterio propio y fijo — porcentajes antes que montos
fijos.** Config por tenant queda **descartada por ahora**, a revisar si un tenant la pide.

**El razonamiento que la sostiene, y que no salió del mercado sino de medir nuestro
motor:** `aplicarValor` ignora la base cuando el modo es `monto_fijo`, así que **un fijo
resta lo mismo vaya donde vaya**. El único que depende de la posición es el porcentaje, y
lo que se está eligiendo es si mira el precio original o el ya rebajado. De ahí las tres
razones: "20% de descuento" significa 20% del precio; le conviene al cliente; y **el último
es el que se recorta** cuando entra el piso en cero — un fijo recortado se explica en el
ticket, un porcentaje recortado no.

**Lo que se cambió: 7 líneas.** Una función `ordenarReglas` en
`calculo-precios.engine.ts` y el `for` que la usa. Va en el motor y no en el `ORDER BY` de
las queries **porque hay tres caminos que arman listas de reglas** (ventas, salones,
combos): una regla que dependa de que los tres se acuerden del mismo `ORDER BY` se rompe
sola. El sort es estable, así que el desempate del llamador se preserva — y puede seguir
siendo arbitrario porque entre reglas del mismo modo el total no cambia.

**Un test existente se puso rojo, y el resultado nuevo es el correcto.** El caso: cuenta de
1190 con IVA, un cupón fijo de 1100 y un 10% de socio, en `compuesto`.

| | Antes | Ahora |
|---|---|---|
| Socio 10% | **se evaporaba** (base negativa → guard a 0) | aplica 100 |
| Cupón 1100 | aplica 1100 | aplica 1090, con su advertencia |
| El cliente paga | 90 | **0** |

Los 90 no eran una regla de negocio: eran un artefacto del orden arbitrario. El cliente
tenía un cupón de 1100 **y** un 10% sobre 1190; que pague 0 es lo que corresponde. El test
se reescribió afirmando lo nuevo, con el porqué adentro para que el próximo que lo lea no
crea que alguien aflojó una garantía.

**Y se verificó que esa garantía siga cubierta:** el guard `Decimal.max(monto, ZERO)`
quedaba con un test menos, así que se mutó a propósito. **Mató exactamente 1**: el del
recargo sobre base negativa — que sigue siendo alcanzable, porque el paso de recargos corre
con el acumulado que dejaron los descuentos. O sea que el guard sigue siendo carga
estructural, ahora por un solo camino, y eso está escrito en el test.

**Tests nuevos:** 6 en `calculo-precios.engine.spec.ts`, entre ellos el que prueba que el
resultado **ya no depende de cómo venga la lista** (700 en los dos órdenes), el control de
que en `base` nada se movió, que la traza refleja el orden aplicado y no el de entrada, y
que la regla vale también para recargos.

**Gate:** backend 98 suites / 1569 unit, e2e 29 suites / 398, frontend completo.

---

## El sobrante de un descuento topeado se pierde, y ahora hay un test que lo dice (2026-08-11)

**Entrada original (verbatim):** *"¿Un descuento debe topearse aunque un recargo posterior
levante el total? (backend, `calculo-precios.engine.ts`) — el piso en cero (2026-07-28)
topea **regla por regla** contra el acumulado en ese punto de la fórmula. Con fórmula
`descuentos → recargos`, neto 1000, descuento fijo 1200 y recargo fijo 2000: sin tope el
total daba 1800 (positivo); con tope da 2000, o sea el cliente paga 200 más en una venta
que nunca fue negativa. La regla que decidiste habla del **total**, no del acumulado
intermedio, así que topear por regla es más estricto que lo pedido. La alternativa —topear
recién al final— rompe la coherencia de la traza, que es lo que el diseño actual protege.
Lo detectó la revisión independiente con un fuzz de 20.000 ventas. Es raro (exige un
descuento fijo mayor al neto **y** un recargo posterior que lo levante), por eso no se
resolvió sobre la marcha."*

**Decisión del owner (2026-08-11): el sobrante se pierde.** El tope sigue siendo regla por
regla, aun sabiendo que en ese borde el cliente paga de más. Gana la coherencia de la
traza: cada paso del cálculo se explica solo y el comprobante cuadra.

**Cero líneas de código de producción.** Es la clase de entrada que se cierra sin tocar
nada y que igual valía la pena: el comportamiento ya era el correcto, lo que faltaba era
que estuviera **elegido** en vez de heredado, y que algo lo defendiera. Sin eso, el
próximo que lea el piso en cero ve un cliente pagando 200 de más y lo "arregla".

**Lo que se agregó:** el test `el sobrante de un descuento topeado NO compensa un recargo
posterior` (`calculo-precios.engine.spec.ts`, en el describe del piso en cero) con los
números exactos de la entrada, y la quinta precisión de la regla en
[`motor-calculo-precios.md`](../features/motor-calculo-precios.md).

El test no se queda en el total: verifica que `descuentoAplicado` sea 1000 y no 1200 —o
sea que el recorte quedó en la traza y no solo en el resultado—, que el comprobante cuadre
(`1000 − 1000 + 2000`), y que la advertencia le llegue al cliente. Un test que solo mirara
`totalFinal` daría verde con una implementación que descuenta 1200 y compensa después.

**Mutante:** sacar `monto = tope` de `procesarReglas` —que es **exactamente la alternativa
que el owner descartó**, topear al final en vez de por regla— dejó 6 tests en rojo, el
nuevo entre ellos. Los otros 5 son los del piso que ya existían: el mutante confirma de
paso que la regla es carga estructural y no un chequeo decorativo. Tras el revert, el
motor quedó **byte-idéntico a `HEAD`** (`git diff --stat` vacío) y los 51 tests del engine
en verde.

---

## `categorias` y `terceros` pausados: el backend deja de aceptar la asignación (2026-08-11)

**Entrada original (verbatim):** *"`categorias` y `terceros` pausados: el front los esconde,
el backend acepta la asignación (backend, medido 2026-08-03) — hermano menor de la entrada
de reglas pausadas que se cerró ese mismo día, pero sobre entidades que se **referencian**,
no que se aplican: no cambian ningún monto, por eso quedó fuera de aquel alcance. Medido:
`ClienteForm.vue:34` filtra `terceros` por `activo` y `items.vue:798` filtra `categorias`,
pero ningún service del backend lee el campo, así que un POST/PATCH directo puede asignar
una categoría o un tercero pausado. ⚠️ Acá "ignorar" **no** puede significar romper el
vínculo existente: un ítem no pierde su categoría porque la categoría se haya pausado. Lo
que corresponde es **rechazar la asignación nueva**, y dejar en paz las que ya existen.
Sin decidir: si el rechazo es 400 o si se ignora en silencio."*

**Decisión del owner (2026-08-11): 400.** Pausar significa "no se usa más", no "las
pantallas lo esconden". Lo notable es que
[`patterns/backend.md`](../patterns/backend.md) ya describía esta regla exacta desde el
2026-08-03 —la fila "se referencia" de su tabla dice *rechazar la asignación nueva; el
vínculo existente no se rompe*— y el código no la cumplía para estas dos entidades: la
doc iba adelante del código.

**Lo que se cambió**, un punto de enforcement por entidad, que es donde tiene que sumarse
quien agregue otro camino de asignación:

- `validarCategoria` (`items.service.ts`) — la usan `create` y `update`, así que los dos
  caminos quedan cubiertos por un solo cambio. Precedente que ya existía al lado y marcó
  la forma: `validarImpresoraComanda` (`categorias.service.ts`) ya exigía `activo = true`.
- `validarTercero` (`ventas.service.ts`) — **nuevo**, ver abajo.

En ambos el `activo` se lee y se evalúa en TypeScript en vez de sumarse al `WHERE`: así
"no es de este tenant" y "está pausada" son dos errores distintos, que es la diferencia
entre un id equivocado y una decisión de negocio.

**Hallazgo que apareció al medir, y que era más grave que la entrada:** el `terceroId` del
customer de una venta **no se validaba en absoluto**. El DTO solo exige formato
(`@IsUUID()`), el service lo persistía tal cual, y la FK de `venta_customer.tercero_id`
(`startup-pos.sql:1154`) referencia `terceros` **sin tenant**. O sea que el id de un
tercero de otro tenant quedaba guardado en tu venta. Hoy no filtra datos —`venta_customer`
denormaliza nombre y RUT, y ninguna lectura hace JOIN a `terceros`— pero es una FK cruzada
entre tenants esperando al primer JOIN que alguien agregue. No se pudo separar del alcance:
para mirar `activo` hay que cargar la fila, y cargarla sin filtrar por tenant habría sido
escribir la mitad mala del arreglo.

**Tests:** 7 en `test/items-pausados.e2e-spec.ts` (mismo archivo y no uno nuevo: es la misma
regla sobre entidades que se referencian en vez de aplicarse). El control con ambos
**activos** va antes de pausar, si no un 400 podría venir de cualquier otra cosa. El del
tenant ajeno
inserta el tercero por SQL a propósito: no existe camino de API para crear datos en un
tenant al que no pertenecés, que es justo el punto.

**Mutantes (los dos revierten al código anterior):**

| Mutante | Qué murió |
|---|---|
| `validarCategoria` sin el chequeo de `activo` | 2 de 17: crear con categoría pausada, y mover un ítem existente a ella |
| sin la llamada a `validarTercero` en `crear()` | 2 de 17: vender con tercero pausado, y el tercero de otro tenant |

Ninguno de los dos tocó los tests del otro, que es lo que confirma que son dos caminos
independientes y no un chequeo que tapa al otro.

**Un test de los 7 no lo mata ningún mutante, y está a propósito:** el que verifica que el
ítem conserva su categoría después de pausarla. Hoy pasa igual sin la feature —ninguna
lectura filtra `activo`, y `categoriaId` sale de la columna de `items`, no del JOIN— así
que no prueba este cambio: **custodia el siguiente**. El arreglo fácil y equivocado de
"ignorar lo pausado" es filtrar en las lecturas, y el día que alguien lo intente el ítem
perdería su categoría en silencio. Lo señaló la revisión independiente y el comentario del
test se corrigió para no prometer más de lo que hace.

**Gate:** backend 98 suites / 1562 unit, e2e 29 suites / **398** tests (eran 391), frontend
build + test + `typecheck:ratchet` + `design:check`.

---

## `precioUnitario` en `0` — la última laguna de la línea de venta (2026-08-11)

**Entrada original (verbatim):** *"`LineaVentaDto.precioUnitario` — ¿debe permitir `0`?
(parcialmente cerrado) (backend, `ventas/dto/create-venta.dto.ts`) — el rechazo de
negativos ya se cerró (jul-2026): tiene `@IsDecimalNoNegativo()`, que además permite `0`.
Lo que sigue abierto es si el `0` debería seguir siendo válido o si el owner quiere
prohibirlo también (podría representar un ítem promocional/gratis, o podría ser una
laguna para vaciar el `totalFinal` de una línea sin tocar el resto). Decidir `>= 0`
(estado actual) vs `> 0` (`IsDecimalPositivo`) es una regla de negocio del owner, no algo
a inferir. Requiere confirmación antes de endurecer más."*

**Decisión del owner (2026-08-11): `> 0`.** El `0` era el único camino para vaciar una
línea **sin rastro de quién la regaló**; un regalo modelado con descuento queda en la
traza del cálculo con su regla y su monto. Y prohibirlo no cierra ningún camino para
regalar: el campo es opcional, y omitirlo hace que el precio salga de `item.precioBase`,
que sí puede ser 0.

**Lo que se cambió:** `@IsDecimalNoNegativo()` → `@IsDecimalPositivo()` en `LineaVentaDto`
(`ventas/dto/create-venta.dto.ts`), **y solo ahí**. Ningún productor manda el campo a ese
endpoint: `toVentaLineasBody` no lo incluye y `online.service.ts:39` lo omite a propósito.

**El mismo cambio en `calcular.dto.ts` se probó, se revisó y se revirtió** — vale más
anotado que escondido, porque el razonamiento que lo justificaba era plausible y falso.
La versión bloqueada endurecía también la previsualización "por simetría, es el mismo
carrito". Lo que la revisión independiente encontró, y se verificó línea por línea:

- **`frontend/app` SÍ manda `precioUnitario` a `calcular`**, desde `useVenta.ts:197` y
  `useSalones.ts:200`. La afirmación contraria —que sostenía toda la decisión— salió de
  un `grep` cuyo `head` se comió los resultados del frontend. El dato falso llegó hasta
  la pregunta que se le hizo al owner.
- Lo que mandan es el precio **ya calculado** de la línea (`precioBase + extras`), que da
  `0` legítimamente cuando el ítem vale 0 —`create-item.dto.ts` documenta que ese 0 es
  legítimo— y la personalización no agrega nada pago (alcanza con un "sin cebolla":
  `personalizacionVacia` ya es falso con `omitidos`).
- El filtro que decide si se manda es `if (precioOverride)` sobre un **string**, y `'0'`
  es truthy en JS: el cero pasa el filtro y viaja.
- El 400 resultante **no se ve**: `useCalculoPrecios` se traga el error a propósito, el
  carrito nunca vuelve a estar vigente y el modal de cobro no abre. Sin toast.
- Y no protegía nada: `ventas.service.ts:315` **ignora el override** cuando la línea tiene
  personalización (recalcula `precioBase + precioExtraTotal`), o sea que el preview
  quedaba **más estricto que la venta** — exactamente al revés del argumento usado.

Queda un test que fija la divergencia en `test/calculo-precios.e2e-spec.ts` (`acepta un
precioUnitario en 0`), para que el próximo que vea los dos DTOs distintos no los "empareje".

**Un test afirmaba lo contrario y se invirtió, no se agregó:** `create-venta.dto.spec.ts`
tenía *"acepta un precioUnitario en 0 (ítem de cortesía)"*. Ese giro es la señal de que el
cambio llega hasta donde importa. Se sumó `acepta una línea sin precioUnitario`, que fija
la premisa de la que cuelga toda la decisión (el campo es opcional), y en
`test/calculo-precios.e2e-spec.ts` el caso `0` contra el endpoint real.

**Mutante (revierte al código anterior, no rompe por romper):** `create-venta.dto.ts` →
`@IsDecimalNoNegativo()` mató 1 de 7, `rechaza un precioUnitario en 0`. `acepta una línea
sin precioUnitario` siguió verde, que es correcto: el mutante no toca la opcionalidad, y
esa opcionalidad es la premisa de la que cuelga toda la decisión.

**Gate:** backend 98 suites / 1562 unit, e2e 29 suites / 391 tests (reset previo, 1 seed),
frontend build + test + `typecheck:ratchet` + `design:check`. Doc de la regla en
`docs/features/ventas.md`.

---

## Suite E2E de navegador (los cinco flujos críticos, escritos)

Playwright corre 19 tests en `frontend/e2e/` (auth vía storageState). Los cinco flujos
que esta lista pedía están escritos; queda solo el ítem de CI, al final.

Reglas que siguen valiendo para cualquier flujo nuevo: aserciones derivadas de
`docs/features/` (NUNCA del output del código), `@smoke` solo en el subconjunto barato,
cero esperas fijas. Y **`workers: 1`**: el tenant tiene un solo cajón y `abrir` rechaza si
el usuario ya tiene caja abierta, así que dos specs de caja en paralelo se pisan siempre.

- [x] **Venta completa hasta documento** (afecto + exento) — hecho el 2026-08-09,
  `e2e/ventas/pos.spec.ts`. El exento es lo que le da filo: sin él, "hay IVA" no
  distingue derivarlo de `clasificacion_tributaria` de derivarlo de "tiene impuestos
  asignados". Se verifica el desglose por línea del lado del servidor, no solo el total.
  **Solo cubre la Boleta** (el default): la Factura exige customer y es su propio flujo.
- [x] **Pago mixto** (múltiples métodos; vuelto solo si `permite_vuelto`) — hecho el
  2026-08-09, `e2e/ventas/pos.spec.ts`. Son dos tests: el reparto exacto entre dos
  métodos —donde la caja espera solo el efectivo, no el total— y el vuelto, que cambia el
  MÉTODO dejando fijo el sobrepago, para que la regla sea la única variable.
- [x] **Nota de crédito** (referencia a la venta original) — hecho el 2026-08-09,
  `e2e/ventas/nota-credito.spec.ts`. Va **parcial** ($500 sobre $1.190) para que el monto
  no pueda confundirse con el total de la venta, y verifica el vínculo desde los dos
  lados: la NC apunta a la venta y la venta la reconoce como hija. Mutante medido
  (`ventaReferenciaId: null` en `ventas.service.ts`): `Expected <uuid> / Received null`.
- [x] **Apertura/cierre de caja** (`diferencia` calculada por el sistema) — hecho el
  2026-08-09, `e2e/caja/apertura-cierre.spec.ts`. Cruza las dos fases del cierre: la
  "Diferencia" del conteo es aritmética de cliente y la de la conciliación viene del
  arqueo del servidor. Mutante medido (invertir el signo en `caja.service.ts`): falla solo
  la segunda, que es la prueba de que son independientes. El **reloj congelado** quedó
  fuera: no hay nada que dependa de la hora en este flujo.
- [x] **Descuento de stock en una venta** (movimiento + saldo materializado) — hecho el
  2026-08-09, `e2e/ventas/pos.spec.ts`. El `Stock: 8` que muestra el catálogo es
  aritmética de cliente y **no prueba nada**: medido con un mutante en el backend
  (`ventas.service.ts`, el `registrarMovimiento` de la venta, `cantidad: '1'` en vez de
  `cantidadCanonica`), la pantalla sigue en verde y lo cazan el saldo (`9.0000`) y el
  movimiento del servidor.
- [x] **Cambio de tenant sin fuga de datos** — hecho el 2026-08-09,
  `e2e/tenants/aislamiento.spec.ts`. Cubre el catálogo; **las ventas siguen sin cubrirse**
  por ese eje. Y cubre **scoping**, no caché: que los stores de Pinia se reseteen al
  cambiar de institución lo cubre `app/stores/tenant.spec.ts`. La primera versión de esa
  spec reclamaba lo segundo y era falso —la segunda visita al catálogo iba por
  `page.goto()`, o sea recarga dura, que borra el estado en memoria antes de aseverar—;
  hoy va por el menú de la app.
- [x] **Salones de punta a punta** (mesa → cuenta → línea → cobro) — hecho el 2026-08-09,
  `e2e/salones/cuenta-hasta-cobro.spec.ts`. **No lleva `@smoke`**: escribe en la base
  (abre caja, cobra una venta) y tarda ~20 s en frío, así que no es del subconjunto barato.
- [x] **Integrar `@smoke` al CI** — cerrado el 2026-08-10 **como decisión, sin
  implementarlo**: la premisa de la entrada ("cuando haya masa crítica", "hoy el CI no
  levanta el stack de navegador") dejó de ser cierta. El job `e2e-navegador` corre
  `npm run e2e` —la suite **entera**— desde el 2026-08-09, y la última corrida sobre
  `e637c0a6` midió **`19 passed (43.3s)`** con un worker. Un subconjunto barato ahorra
  ~40 s sobre un job que ya paga varios minutos de `npm ci` + dos builds + la descarga de
  Chromium: optimiza lo que no domina el costo, y a cambio abre la puerta a que el CI mida
  menos de lo que corre en local. El tag `@smoke` **sigue vivo** para `npm run e2e:smoke`,
  que es una herramienta local para no arrastrar las specs que escriben en la base; lo que
  se descarta es que el CI use el subconjunto en vez del total.

## Salones de punta a punta, en un navegador de verdad (2026-08-09)

Primer flujo de la suite Playwright además del smoke: mesa → cuenta → línea → cobro. Es la
capa que faltaba entre el unit con HTTP mockeado (`pages/salones/index.nuxt.spec.ts`) y los
e2e de API (`salones-fusion`, `salones-comanda`): que la **pantalla encadene** las llamadas
en el orden correcto y muestre lo que el backend devolvió.

**Las precondiciones se montan por API, no clicando** —abrir caja, crear garzón y entrar a
turno son tres flujos con pantalla propia; recorrerlos haría que un cambio en cualquiera de
ellos rompa este test sin que salones tenga nada que ver—. Y los fixtures son propios:
garzón, salón, mesa e ítem creados en el `beforeAll`.

**El monto sale de la regla, no del output:** producto afecto de $1.000 + IVA 19% = **$1.190**
(ADR-018), y el cobro suma la propina sugerida del 10% → **$1.309**. (El 10% es a la vez el
default del cliente y el del tenant sembrado, así que el test **no** distingue uno del otro
— medido por la revisión con un mutante que ignora la respuesta del backend.)

**Lo que el navegador enseñó y ninguna de las otras capas mostraba** —cada uno costó una
corrida y una captura de pantalla—:

- **El PIN se pide DOS veces**, y la segunda **después** de "Confirmar venta", no antes:
  quién cierra la cuenta es un dato del cierre y no se hereda de quien la abrió.
- La mesa con posición por defecto `(0,0)` queda **recortada** contra el borde del plano y el
  click cae fuera; el fixture la crea al centro.
- El teclado del PIN va acotado al diálogo. (La primera redacción decía que chocaba con el
  stepper de cantidad; la revisión lo midió y **es falso** — el fondo queda fuera del árbol de
  accesibilidad con el modal abierto. El acotado queda igual, como defensa, pero sin inventarle
  una medición.)
- El trigger del `USelectMenu` no tiene label propio: Reka UI le pone `Show popup`. El test lo
  usa **y verifica la selección** después, para que un cambio de ese label falle donde se
  produce.
- La primera corrida sobre un stack recién levantado tarda más de los 5 s de plazo por
  defecto en volver al listado tras el cobro. La aserción final lleva plazo propio —no espera
  fija: sigue resolviendo apenas aparece—.

**La revisión independiente bloqueó la primera versión con tres hallazgos, los tres
reproducidos:**

1. La aserción del monto era `getByText('$1.190').first()`, sin anclar. El revisor la volvió
   vacua creando **un ítem de catálogo de $1.190** —y este mismo test le agrega un ítem al
   catálogo por corrida, así que la ambigüedad crecía sola—. Ahora apunta a la fila `Total`
   del panel.
2. El locator del garzón matcheaba **por prefijo** y el cleanup se salteaba si el montaje
   fallaba a la mitad: una sola corrida interrumpida dejaba un garzón en turno y **toda**
   corrida siguiente moría con un strict-mode, sin recuperarse sola. Ahora el nombre va exacto
   y el escenario se llena de a poco para que el `afterAll` cierre lo que sí llegó a existir.
3. **El `afterAll` se tragaba la única verificación server-side.** Con un mutante que cobra
   sin propina, el test quedaba verde —el modal muestra $1.309 porque es matemática de
   cliente, y el toast es un ternario local— mientras en la base quedaba
   `venta_propina.monto_pagado = 0` y la caja descuadrada. Ahora el test **cierra la caja como
   último paso y afirma `estado: 'cerrada'`**, que solo sale si el conteo cuadra con lo que el
   servidor calculó.

**Los tres mutantes, medidos sobre la versión final:** `cantidad: '2'` al agregar la línea →
`Expected "$1.190" / Received "$2.380"`; cobrar con propina `'0'` →
`Expected "cerrada" / Received "en_conciliacion"`; y `credencialGarzon` devolviendo `{}` —la
regresión histórica del `pin: ''`— muere al agregar el producto.

**No lleva `@smoke`**: escribe en la base y tarda ~20 s en frío, así que no entra al
subconjunto barato que corre en cada tarea.

## La guarda de rango estaba duplicada, y el test no sabía a cuál apuntaba (2026-08-09)

**El hallazgo era de la revisión independiente del día anterior**, anotado al cierre de la
tanda de ramas que está más abajo en este mismo archivo: el e2e del rango invertido pasaba en
verde con cualquiera de las dos guardas viva —una en `rangoLiquidacionDesde`, otra
dentro de `computarReparto`, con el mismo mensaje— así que no fijaba ninguna.

**La duplicada era código muerto**, medido siguiendo los llamadores: el único que entra a
`computarReparto` en producción es el `preview` del controller, y construye el período con
`rangoLiquidacionDesde` justo antes de llamarlo. Se borró, y el docblock del método ahora dice que
recibe el período **ya validado** y por qué duplicar la guarda vuelve a romper la señal.

**El test pasó a cubrir los tres puntos de entrada** —`preview`, `crear` y `liquidar`— porque
son tres llamadas distintas a la misma función y nada garantiza que las tres la sigan
llamando. Y se sumó el otro borde que solo cierra ese util: una fecha ISO 8601 **legítima**
que `new Date` no sabe leer (`2026-W32-1`). La guarda de orden no la frena —compara
`NaN <= NaN`, siempre `false`— y antes llegaba a Postgres como un 500.

**Los dos mutantes, medidos sobre la única guarda que queda:**

- sacar la comparación de orden → mueren los **tres** tests de entrada;
- sacar el chequeo de fecha ilegible → `Expected 400 / Received 500`, que es exactamente el
  bug histórico que el docblock del util documenta.

## Seis ramas sin cobertura, elegidas de una lista de catorce (2026-08-09)

La entrada decía *"ramas sin cobertura alguna, **para decidir si entran**"*. Se decidió por
riesgo, y el criterio para descartar fue el mismo en tres casos: si montar el escenario exige
SQL directo, lo que se escribe es un test de un estado que en producción no existe. El detalle
de lo que no entró queda en [`pendientes.md`](pendientes.md) para no reevaluarlo de cero.

### Spillover de propina entre pagos (unit)

La propina que no cabe en el primer medio se derrama al siguiente. Los seis tests que ya
tenía `asignacion-propina.spec.ts` usaban propinas que caben cómodas, así que la rama del
tope no la tocaba ninguno. Se sumaron dos: el derrame y el borde de una propina
mayor que todo lo pagado, que no puede inventar plata que nadie puso. (La aserción de
conservación que acompaña al primero es **redundante**: el `toEqual` de arriba ya fija el
array elemento por elemento, así que no existe mutación que rompa una sin romper el otro. Se
deja como documentación de la propiedad, no como cobertura.) **Mutante:** sacar el `Decimal.min(neto, …)` mata
los dos.

### Aislamiento multi-tenant de caja (e2e) — el más valioso de la tanda

El eje cubierto era el de roles dentro de un tenant (cajero vs supervisor). Este es el otro:
que la caja de Paris sea invisible con un token de Falabella. **Mutante:** sacar `tenantId`
del `where` de `CajaService.findOne` devuelve **200 con la caja de otra empresa** donde el
test espera 404.

**La clave del arnés es que ataca la MISMA PERSONA**: `admin@sistema.com` es miembro de los
dos tenants del seed, así que la caja se abre con su token de Paris y se ataca con el de
Falabella. La primera versión usaba dos personas distintas y la revisión independiente midió
que **sobrevivía a borrar el scoping por tenant de todo el camino**: lo que cortaba era el
chequeo de dueño. Lo mismo con el listado, que hoy se pide con `?todas=true` porque sin el
flag filtra además por `usuario_id` y ese filtro tapaba al de tenant.

⚠️ **La mitad de escritura sigue fijando menos de lo que parece, y está escrito en el test.**
No se pudo construir un mutante que aislara la defensa de tenant: sacándola, la request del
otro tenant llega al `FOR UPDATE` de `bloquearCajaAbierta` y la corrida se cuelga, así que no
hay aserción posible sobre el resultado. Lo que ese test fija es que la escritura **no
prospera** y que la caja queda intacta. Queda anotado en [`pendientes.md`](pendientes.md).

(La primera redacción de esta ficha decía que el rechazo venía del guard de permisos. Es
falso y lo midió la revisión: sale de `bloquearCajaAbierta`, y el usuario es admin en los dos
tenants, así que el guard ni interviene.)

### La capa SQL de `propina-reportes` (e2e)

Dos queries con CTEs, `generate_series` y agregaciones que solo se ejercitaban en unit con el
`dataSource` mockeado — el mismo perfil que ya nos mordió en `fusionarCuentas`.

Se afirma sobre el **delta** contra una fila recién sembrada, no sobre valores absolutos ni
sobre "los totales son la suma de las filas": eso último sería **tautológico**, porque
`totales` se calcula en JS recorriendo `data`. El delta prueba lo que importa — que la query
ve la fila nueva, la suma y se la atribuye a quien corresponde. **Dos mutantes:** uno en la
capa JS (`montoOriginado: '0'`) y otro en el SQL (`SUM(monto_pagado) FILTER (WHERE FALSE)`),
cada uno mata su test.

### `HORAS_TRABAJADAS` (e2e)

Aporte igual al pool y horas 4:2:1 — si el reparto siguiera la plata en vez de las horas, el
test no distinguiría nada. Las sesiones se siembran por SQL **cerradas**, por la misma razón
que el archivo ya inserta los tips directo: no hay forma de que un test haga durar una sesión
tres horas. **Mutante:** que `HORAS_TRABAJADAS` devuelva peso `1` —o sea partes iguales— lo
mata.

⚠️ **Y dejó una lección de orden de limpieza, medida dos veces.** El `afterAll` propio del
test tiene que **drenar el pool antes** de borrar las sesiones: al revés, los tips quedan sin
ningún participante con peso y el test siguiente corta con un 400 que no es suyo. Y borrarlas
hay que borrarlas: si quedan vivas, Carla pertenece a "Garzones" por la sesión y a "Cocina"
por su tip, y el test de dos grupos corta con **otro** 400 ajeno.

### Las guardas de entrada: entró una rama, no tres

Se escribieron tres tests, pero **solo uno cubre una rama que no estaba cubierta**: el
rechazo de `peso <= 0` en `MANUAL/PESOS` (`propina-distribucion.service.ts`), que ningún unit
mataba. Los otros dos —rango invertido y Σ de porcentajes— ya los mataban tests unitarios
preexistentes (`utils/rango-liquidacion.spec.ts`, `query-propina-reporte.dto.spec.ts`,
`propina-distribucion.service.spec.ts`); quedan como cobertura por HTTP, que no es lo mismo
que cobertura nueva. Lo midió la revisión independiente apagando las cuatro guardas y viendo
qué se ponía rojo.

Peor todavía, y anotado para el próximo: el test del rango invertido **no distingue cuál de
las dos guardas con el mismo mensaje está viva** —hay una en `rango-liquidacion.ts` y otra
duplicada en `computarReparto`—, así que apagar una sola lo deja en verde.

La tercera de la lista original, `gruposConfig.length === 0`, resultó inalcanzable; ver
[`pendientes.md`](pendientes.md).

## Los dos E2E que la feature de pausa dejó abiertos (2026-08-09)

Los dos estaban anotados desde el 2026-08-03 con la misma forma: *"el comportamiento es
correcto por construcción, pero eso lo sostiene un razonamiento, no un test"*. Los dos
razonamientos resultaron ciertos —ningún bug— y ahora los sostiene algo que se puede romper.

### Una regla pausada no queda congelada en `ventas_descuentos`

Vive en `ventas.e2e-spec.ts` § *"la venta congela la regla aplicada"*, que es donde ya
estaban el helper de descuentos y la query de las filas: es el **caso negativo** de ese
describe.

Una sola venta cubre los **dos** caminos por los que una regla llega a una línea: heredada
por asociación al ítem (lo que hace el POS, que no manda `descuentoIds`) y pedida explícita
por línea, que es la forma más forzada de intentar aplicarla.

No alcanzaba con mirar el total: una fila con `valor_aplicado = 0` daría el mismo total y
mentiría en el detalle, diciendo que se aplicó una regla que el tenant tenía apagada. Por eso
se afirman las dos cosas — cero filas **y** `totalDescuentos` en cero.

**Mutante:** borrar la guarda `if (!regla.activo)` del motor —o sea volver al comportamiento
anterior a la feature— deja **2** filas donde el test espera 0. Que sean dos y no una es la
prueba de que los dos caminos se ejercitan de verdad.

### Una cuenta de salón con el ítem pausado después de cargarlo se cobra igual

Vive en `items-pausados.e2e-spec.ts`, que es el spec del ítem pausado **por canal** y cuyo
propio docblock listaba Salones como el canal sin cubrir. La razón por la que no se había
escrito —"no existe `salones.e2e-spec.ts` del que partir"— ya no aplica: el arnés de mesa,
cuenta y garzón se resolvió esta semana.

La cuenta se arma en el `beforeAll`, con el ítem **todavía activo**: montarla después sería
imposible —`getItemVendibleOrThrow` rechaza la línea— y probaría el otro caso, el que ya
estaba cubierto. Por eso el test lleva además un **control**: agregar la línea AHORA da 404.
Sin él, un `getItemVendibleOrThrow` que dejara de mirar `activo` haría pasar el cobro por la
razón equivocada.

**Dos mutantes, los dos medidos:** filtrar `i.activo = true` en `cargarBasePorIds` —el
"arreglo" que alguien haría para que lo pausado no se venda— mata este test y otros cuatro
del mismo archivo; y sacar `AND i.activo = true` de `getItemVendibleOrThrow` mata solo el
control, con `Expected 404 / Received 201`.

Es el lado de la regla del owner donde **el consumo ya ocurrió**: el plato está en la mesa.
Que la cuenta no se pudiera cobrar porque el admin pausó el ítem mientras el cliente comía
sería dejar a la mesa sin forma de pagar.

## Los ítems pausados dejan de viajar al cliente (2026-08-09)

**Decisión del owner, y no era el trabajo que había anotado.** El backlog decía que "el
filtro de ítems pausados en los tres catálogos de venta no tiene test". Al plantearlo, el
owner enunció la regla directamente: *"no quiero filtro de ítems pausados en el POS ni en el
salón ni en online, simplemente no salen"*. Medido contra el código, eso era **casi** lo que
pasaba, con dos correcciones al enunciado del backlog:

- Son **cuatro** superficies de venta, no tres: `ventas/pos.vue`, `salones/index.vue`,
  `tienda/index.vue` y `tienda/suscripciones.vue`.
- El pausado **sí salía del backend**; lo descartaba cada pantalla con
  `.filter(i => i.activo)` después de pedir `pageSize=100`. Y eso **no es equivalente** a "no
  salen": el pausado ocupaba uno de esos 100 lugares, así que en un catálogo de más de 100
  ítems cada pausado empujaba fuera de la pantalla a uno vendible — un ítem desaparecía del
  POS sin que nadie lo hubiera pausado. `GET /items` no tenía filtro por `activo`.

**La forma fiel es que no vengan**, y es la que se implementó: `activo` como parámetro de
`GET /items`, las cuatro pantallas piden `activo=true` y ninguna filtra más en el cliente.

**Tres estados, no dos**: ausente no filtra (la pantalla de configuración muestra pausados y
activos juntos, con su badge), `true` deja los vendibles, `false` deja los pausados. La
coerción del booleano no es la de `incluirEliminados`, y la primera redacción de esta ficha
justificaba eso mal —decía que `value === 'true'` convierte el ausente en `false`—. **Es
falso y lo midió la revisión independiente**: `@Transform` no corre sobre una clave que no
vino, así que con esa coerción el ausente sigue sin filtrar. Lo que sí cambia es la basura:
`activo=TRUE` o `activo=1` caerían a `false`, o sea al catálogo **invertido**, en silencio.
Acá dan 400 — medido junto con `activo=`, `?activo` sin valor y `activo=yes`.

**Compatible hacia atrás:** sin el parámetro la respuesta es la de siempre, así que las cinco
pantallas que listan ítems fuera de venta (configuración de ítems, grupos de modificadores,
inventario, recuentos y mermas — siete *call sites*, porque la de ítems hace tres) no se
enteran, y ahí un pausado **tiene** que verse.

**Los mutantes, los tres medidos** en `items-pausados.e2e-spec.ts`:

- **sin el filtro en la query** (o sea, el estado anterior): mueren 3 tests.
- **`if (query.activo)` en vez de `!== undefined`**: mueren 2 — `activo=false` deja de
  filtrar, que es el borde que la coerción de tres estados existe para proteger.
- **sacar `&activo=true` de una URL de `salones/index.vue`**: muere el test nuevo de
  `index.nuxt.spec.ts`, que captura las URLs **completas** con query string. Sin eso el
  parámetro se puede borrar con la suite en verde, que es la misma trampa ya documentada
  para `enTurno` en el selector de garzones.

Lo que el e2e afirma y un filtro de cliente no puede dar: el **`total` de la paginación**
baja al pausar. Esa es exactamente la diferencia entre las dos formas — que el pausado deje
de ocupar un lugar de la página, no solo que no se dibuje.

## El aviso de ítem eliminado se podía borrar sin que nada se pusiera rojo (2026-08-09)

**La entrada:** el computed `cuentaConItemEliminado` (`pages/salones/index.vue`) no tenía
cobertura, con el mutante medido: `computed(() => false)` dejaba el **frontend entero** en
verde. Lo que faltaba no era el arnés —`pages/salones/index.nuxt.spec.ts` ya existía, creado
para el guard de reentrancia— sino el **fixture**: una cuenta que ya venga con una línea
marcada, que el mock del `POST` no produce porque abre cuentas vacías.

**Cómo se cerró:** el mock de `GET /mesas/:id/cuentas` pasó a devolver una lista
configurable (vacía por defecto, así los tests viejos no se enteran) y se agregó el de
`POST /calculo-precios/calcular`, que en este escenario **falla** — que es lo que hace el
backend real: el motor resuelve los ítems contra el catálogo vivo y devuelve 404.

⚠️ **Y el arnés tuvo que aprender a rendir plata**, que fue el bloqueo de la revisión
independiente sobre la primera versión: con el store de monedas vacío `formatMonto` devuelve
`'—'` para **cualquier** monto, así que la fila de Totales se veía igual con y sin el
computed y las dos aserciones que la miraban **no podían fallar bajo ninguna mutación**. El
spec hidrata la moneda del tenant y la aserción de plata va sobre **la fila del Total**, no
sobre el `textContent` del drawer —que rinde `— Cuenta 9` en la cabecera, y por eso un
`toContain('—')` daba verde siempre—. (El cartel sí se busca en el texto del drawer: ahí no
hay ambigüedad y mata los dos mutantes.) Mismo patrón que
[`anti-patterns.md`](anti-patterns.md) registra para el SQL: una aserción que matchea otra
cosa parece cobertura y no lo es.

Dos tests, uno por cada mutante:

- **avisa, tapa el total y deshabilita el cobro.** Mata `computed(() => false)`. Lo que
  importa no es solo el cartel: con el mutante puesto la aserción del total falla con
  `expected '$0' to be '—'`, o sea reproduce el síntoma exacto —una cuenta con productos
  mostrando **Total $0**, que invita a cobrar cero— y no solo la ausencia del cartel.
- **la misma cuenta sin la marca cobra normal.** Mata el mutante espejo,
  `computed(() => true)`, que dejaría toda cuenta sana imposible de cobrar. Sin este, el
  primero pasaría igual.

## El camino a cocina no lo tocaba ningún test (2026-08-09)

**La entrada:** los únicos tests que afirmaban sobre `estaciones` eran unitarios con el SQL
mockeado, y un `grep` de `comanda` sobre `backend/test/` y `frontend/e2e/` no devolvía una
línea. La razón por la que nunca se escribió estaba medida: con el seed
`agruparEstacionesComanda` devuelve siempre `[]` —la categoría con impresora existe pero no
tiene ningún ítem adentro—, así que ver una comanda exigía cablear datos por SQL.

**Cómo se cerró:** `test/salones-comanda.e2e-spec.ts`, que **no espera nada del catálogo del
seed**: crea por API dos impresoras, dos categorías y cuatro ítems. (Del seed sigue saliendo
el escenario base —tenant, moneda, admin, el garzón y su turno—, como en todos los e2e.) Eso
da el escenario que el seed no tiene: **dos** estaciones distintas, **dos** líneas en una
misma estación, y una línea que no rutea a ninguna.

Cada pieza del fixture existe por un mutante concreto, y esto salió de la revisión
independiente, que **bloqueó** la primera versión: con una sola línea por impresora,
"agrupar por impresora" y "emitir una estación por línea" son indistinguibles, y el mutante
que manda tres papeles a cocina para una misma partida pasaba en verde.

Dos tests, y los tres mutantes medidos:

- **agrupa por impresora y saltea la línea sin ruta.** Mutante A: sacar
  `|| !row.impresora_id` de la guarda → aparece una tercera "estación" con
  `impresoraId: null` y nombre vacío, o sea un ticket dirigido a nadie. Mutante B: keyear el
  mapa por `cuenta_linea_id` en vez de `impresora_id` → tres estaciones donde van dos.
- **el claim avanza lo enviado.** Mutante: no ejecutar el `UPDATE` de `cantidad_enviada` →
  el segundo `reclamar` devuelve otra vez lo mismo, que es cocinar dos veces cuando el
  garzón toca "Enviar" de nuevo o el ticket no salió. El test también fija que lo agregado
  **después** sale por la diferencia (1) y no por el total (3).

**Y un hallazgo que dejó la corrida completa, que vale para el próximo e2e de salones:** la
primera versión usaba el garzón del seed (Ana) y volteó `garzon-modo-personal` con un
`400 "El garzón ya tiene una sesión abierta"`. La sesión es **única por garzón** y hoy
**seis** specs comparten a Ana, así que el estado se filtra de un spec al siguiente
—`jest-e2e.json` corre con `maxWorkers: 1`, o sea en serie: el que deja la sesión abierta le
rompe el `iniciar` al que viene—. (La primera redacción de esta ficha decía "en paralelo", y
es falso; lo corrigió la revisión independiente del 2026-08-09.) El spec pasaba aislado y la suite completa fallaba, que es el peor modo de falla.
Los dos specs nuevos de salones crean su propio garzón (`POST /garzones` devuelve el PIN
generado, una sola vez), lo que además hace innecesario el cierre defensivo previo que
copiaban de `combos`. Medido después del cambio: tres corridas completas con base fresca,
371 verdes las tres.

Queda abierta la mitad **de smoke manual** de la entrada original —el seed sigue sin permitir
ver una comanda en pantalla sin tocar SQL—, con el arreglo ya identificado en
[`pendientes.md`](pendientes.md).

## Dos huecos de test que el gate no veía (2026-08-09)

Los dos venían de revisiones independientes, los dos traían el mutante ya medido, y ninguno
se cerraba con "agregar un assert": había que construir el escenario que ningún test montaba.

### La transacción de `crearUsuario` no estaba protegida por ningún test

**La entrada:** reemplazar `this.dataSource.transaction(...)` por `this.dataSource.manager`
dejaba los unit y los e2e **en verde**. La transacción funcionaba —comprobado a mano:
rompiendo el `INSERT` de roles daba 500 y no quedaba ni el usuario ni la membresía— pero una
regresión pasaba sin ruido. El test que parecía cubrirlo, *"sin roles → 400"*, lo corta el
`ValidationPipe` antes de que el service arranque.

**Cómo se cerró:** un `describe('crearUsuario — atomicidad')` en
`tenants.service.spec.ts`. La clave del arnés es que el manager de la transacción y
`dataSource.manager` son **dos objetos distintos**, y lo que se afirma es cuál de los dos
recibió cada escritura — así el mutante falla por lo que hace, no por un `TypeError`.

Tres tests, tres invariantes:

1. **todo se escribe con el manager de la transacción** y `dataSource.manager` no recibe ni
   un `save` ni un `query`;
2. **la invitación se emite dentro** (`emitir(usuarioId, 'invitacion', managerTx)`): si se
   emitiera afuera y el alta fallara después, quedaría un link vivo apuntando a un usuario
   que no existe;
3. **si falla la última sentencia** —la baja de los roles que no vinieron— la promesa
   propaga y **el mail no sale**, porque el envío es post-commit.

**Verificado:** con el mutante puesto (la lambda invocada contra `this.dataSource.manager`)
caen los **tres**. Sin él, los 22 del archivo pasan.

### `fusionarCuentas` no tenía NINGÚN e2e, y su SQL solo corría mockeado

**La entrada:** `grep -rn "fusionar" backend/test/` no devolvía nada, y el único test que
recorría ese camino mockeaba `manager.query`, así que **no llegaba SQL a Postgres**. No era
teórico: el 2026-08-07 un `SELECT` nuevo de esa ruta filtraba `eliminado_el` sobre
`item_producto`, que no tiene esa columna. Habría reventado la fusión con un 500 sosteniendo
el `pessimistic_write` de todas las cuentas de la mesa, y el gate entero —1490 unit, 321
e2e, lint, typecheck— pasó en verde igual.

**Cómo se cerró:** `test/salones-fusion.e2e-spec.ts`, con el caso mínimo que pedía la
entrada. Lo que lo hace ejercitar el SQL en cuestión es la **presentación**: ese `SELECT`
solo se emite si alguna línea la tiene. Un producto con unidad base `kg` cargado en las dos
cuentas con unidades distintas —1 kg en el destino, 500 g en el origen— más un segundo ítem
que no matchea, y la fusión tiene que dejar **dos** líneas: la repetida sumada a 1,5 y
reconvertida a la unidad del destino, y la otra mudada tal cual.

**Los dos mutantes, los dos medidos:**

- **el histórico** — reponer `AND ip.eliminado_el IS NULL` en el JOIN a `item_producto`:
  `500` donde el test espera `201`. Es exactamente el bug que se escapó, y ahora se caza.
- **el de comportamiento** — sacar la llamada a `sincronizarPresentacion` del merge:
  `cantidadPresentacion` se queda en `1` mientras `cantidad` ya vale `1.5`, o sea la línea
  diría "1 kg" pesando kilo y medio.

**Los fixtures que la fusión consume son propios** —salón, mesa, ítems y **el garzón**,
creados en el `beforeAll`— porque una fusión cancela cuentas y borra líneas, y el seeder no
repara lo que una corrida previa dejó movido. Del seed salen el tenant, la moneda, el admin
y el turno. Medido: tres corridas seguidas sobre la misma base, verde las tres.

## `GET /tenants/members` repartía el roster con correos (2026-08-09)

**La entrada, como estaba en `pendientes.md`:** *"`GET /tenants/members` es el único
endpoint de `members/*` SIN `TenantAdminGuard`, y la Fase 2 del garzón lo convirtió en
superficie de UI (backend, `tenants.controller.ts`) — el hueco es **preexistente**: la
lectura estaba abierta a cualquier miembro autenticado del tenant mientras las tres
escrituras van con `TenantAdminGuard`. Lo que cambió el 2026-08-09 es **quién lo alcanza
sin querer**: antes había que armar la request a mano; ahora `configuracion/garzones.vue`
lo llama al montar para poblar el selector de cuenta vinculable, y esa pantalla no tiene
middleware de permiso propio. O sea que el roster completo —nombre, apellido y **correo**
de cada miembro— se renderiza en un dropdown. **No es fuga multi-tenant**: la query está
acotada a `user.tenantId`. Al arreglarlo hay que decidir si la lectura pasa a admin-only (y
entonces el selector de garzones necesita otra fuente, porque quien administra garzones no
es necesariamente admin) o si se expone una lista mínima `{ usuarioId, nombre }` sin
correos, como se hizo con `garzones/para-selector`."*

**Se hicieron las dos cosas, porque la disyuntiva era falsa.** `GET /tenants/members` pasó
a `TenantAdminGuard` con su payload intacto —correo y roles incluidos— y la única pantalla
que lo consume, `configuracion/usuarios`, ya era admin-only por middleware. Los otros dos
consumidores no necesitaban nada de eso: se les dio
**`GET /tenants/members/para-selector`**, que devuelve `{ usuarioId, nombre, apellido,
esTotem }` y nada más.

**Lo que decidió el corte fue medir qué usa cada consumidor**, no elegir entre dos formas:

- `configuracion/usuarios` — admin-only, usa correo y roles. Queda con el roster completo.
- `configuracion/cajas` — su interfaz local `Member` ya declaraba solo
  `{ usuarioId, nombre, apellido }`: **nunca miró el correo**.
- `configuracion/garzones` — usa `esTotem` para filtrar, y tenía el correo únicamente como
  *fallback* del label (`` `${nombre} ${apellido}`.trim() || m.correo ``). `usuarios.nombre`
  es `NOT NULL` —medido contra la base viva—, pero la validación del alta es `@MinLength(1)`
  (`crear-usuario-tenant.dto.ts`), que **acepta un nombre en blanco**: el fallback no era
  inalcanzable, solo improbable (0 filas así hoy). Se reemplazó por `'Sin nombre'`, que
  cubre el mismo caso sin repartir el correo.

**Por qué `para-selector` queda abierta a cualquier miembro autenticado, y es una decisión
y no un olvido:** sus dos consumidores viven en módulos de permiso distintos (`Cajas` y
`Salones`), así que ningún `@RequiresPermiso` único los cubre —y quien opera el salón ve los
nombres de sus compañeros en el selector de garzones igual—. Lo que no puede repartirse es
el correo (PII, y además el identificador de login) y la lista de roles (dice quién es
admin, o sea a quién atacar); ninguno de los dos sale de ahí.

**El mutante que lo fija:** hacer que `findMembersParaSelector` delegue en `findMembers`
—el atajo obvio, y exactamente el comportamiento anterior— pone en rojo
`para-selector: cualquier miembro lo lee, y NO trae correo ni roles`
(`tenants-members.e2e-spec.ts`), que recorre la respuesta campo por campo. El test hermano
del guard tiene su contrapeso: `GET /tenants/members` con admin **exige** que venga el
correo, así que un guard que rechazara a todos no pasaría en verde.

Nota de la migración de los e2e: las **12** llamadas GET a `/tenants/members` repartidas en
**4** specs (`caja`, `cajones`, `garzon-modo-personal`, `alta-usuarios-tenant`) ya usaban
token de admin —incluido `tokenSupervisor` de `caja.e2e-spec.ts`, que pese al nombre loguea
con `ADMIN_EMAIL`, y `tokenFalabella`, que es admin de ese otro tenant—. El único test que
había que reescribir era el que afirmaba que la lectura estaba abierta.

**Decisión del owner (2026-08-09): `para-selector` queda abierta a cualquier miembro
autenticado.** La revisión independiente marcó que el alcance concedido es más ancho que la
unión de sus consumidores —están detrás de `Cajas:Actualizar` y `Salones:Actualizar`, y el
hermano que se cita como patrón (`garzones/para-selector`) sí lleva `@RequiresPermiso`— y lo
dejó a criterio del owner. Respuesta: *"que se vean los nombres de los compañeros, no es
crítico"*. Lo que sí es crítico —correo y roles— ya no sale de ahí. Si algún día cambia, la
salida es **dos rutas**, una por módulo, porque el decorador admite un solo par
`(módulo, permiso)`.

## No había forma de mandar un mail, y eso bloqueaba tres cosas (2026-08-09)

**Cerrado por el servicio de mail + invitación por link + reset.** Se resolvieron los
puntos 2 (invitación) y 3 (reset). El punto 1 —verificación de correo— quedó **medio
cerrado y sigue en `pendientes.md`**: la invitación prueba la dirección **del invitado**
(si hizo clic, existe y alguien la lee), pero el auto-registro público sigue sin verificar.

**Cómo se cerró:** `nodemailer` contra SMTP propio, detrás de una interfaz que con
`SMTP_HOST` vacío **loguea en vez de mandar** —obligatorio, no comodidad: si no, cada
corrida de los e2e dispara mails reales y CI necesitaría credenciales—. Una sola tabla
`tokens_acceso` para los dos flujos, guardando **SHA-256 del token, no el claro**;
determinista a propósito para poder indexarlo, que es lo que evita la amplificación que se
sacó del PIN del garzón.

**Lo que quedó fijado por test:** que un link no sirva dos veces, que uno vencido no sirva,
que un token de invitación no valga como reset, que en la base esté el hash y no el claro,
que `/auth/recuperar` responda idéntico exista o no el correo, y que el entorno de test
**no mande mail**. Dos los encontró la revisión y se sumaron con su mutante: que el link de
invitación viejo **no sobreviva a un reset** (era toma de cuenta: 7 días de ventana para
quien tuviera ese primer mail), y que quemar un token dos veces falle la segunda —el test
por HTTP que creía cubrirlo no se solapaba y pasaba con la guarda borrada—.

⚠️ **La instrucción sobre `refresh()` que traía esta entrada quedó sin objeto**: decía que
al implementar el reset había que mirar `debe_cambiar_contrasena` también en
`AuthService.refresh()`. Esa columna **la borró este mismo cambio** junto con todo el
andamiaje de la contraseña temporal.

<details>
<summary>Texto con el que estaba en <code>pendientes.md</code></summary>

- [ ] **No hay forma de mandar un mail, y eso bloquea tres cosas a la vez** (backend) —
  medido el 2026-08-08: cero rastros de `nodemailer`, `@nestjs-modules/mailer`, SMTP,
  SendGrid o Resend en `package.json` ni en `backend/src`. **No es una feature faltante, es
  infraestructura ausente**, y por eso bloquea:
  1. **Verificación de correo** al dar de alta un usuario del tenant. Diferida
     explícitamente por el owner (2026-08-08) *"porque no hay nada para enviar mail aún"*.
     ⚠️ Mientras no exista, un admin puede sumar **cualquier correo registrado** a su tenant:
     el daño está acotado —sumarte a mi restaurante no me da acceso a tus datos, te da
     acceso a los míos— pero **filtra si ese correo está registrado** (enumeración), y a la
     persona le aparece un tenant que no pidió.
  2. **Invitación por link**, que es lo que reemplazaría a la contraseña temporal del alta
     (ver `docs/superpowers/plans/2026-08-08-alta-de-usuarios-del-tenant.md`). Con
     invitación, el admin deja de conocer una contraseña válida de otra persona.
  3. **Reset de contraseña** ("olvidé la mía"), que **tampoco existe** hoy: no hay ningún
     endpoint que reponga una contraseña. El único de contraseña es `PATCH /me/contrasena`,
     que **exige la actual**.
     ⚠️ **Al implementarlo hay que mirar `debe_cambiar_contrasena` también en
     `AuthService.refresh()`.** Hoy el flag se controla solo en `switchTenant`, y alcanza
     porque únicamente lo llevan cuentas recién creadas, que nunca tuvieron token de tenant.
     Un reset se lo pone a alguien **con sesión viva**: sin el chequeo en `refresh`, esa
     sesión se renueva sola con el tenant que ya tenía y se saltea el cambio. Se probó
     agregarlo por adelantado y se sacó: era una rama inalcanzable y sin test dentro del
     subsistema que la invariante 4 pide no tocar.
  **La dependencia ya está decidida** (owner, 2026-08-08): **`nodemailer`** contra el
  **SMTP propio del owner** (Gmail o corporativo). Las tres se resuelven con la misma
  infraestructura, así que se hace una vez y no tres. Lo que falta es ejecutarlo — el owner
  lo pospuso para después de cerrar la Fase 2 del garzón.

  Lo decidido y lo que se descartó, con su porqué:

  - **`nodemailer` es el cliente, no el proveedor.** Se escribe contra SMTP, así que el
    proveedor real (Resend / SendGrid / SES / el que sea) entra por `.env` el día del
    deploy **sin tocar código**. Es la decisión menos comprometedora disponible.
  - **NO sumar `@nestjs-modules/mailer`.** Trae motor de plantillas y config propia para
    resolver dos mails. `nodemailer` pelado alcanza.
  - **Se descartó Mailpit** (capturador SMTP local en `docker-compose`) porque el fallback
    de abajo da el mismo loop de desarrollo sin sumar un servicio.
  - ⚠️ **Restricción de diseño, no opcional: los tests no pueden mandar mail de verdad.**
    Se corren 342 e2e en cada cierre y en CI; mandando en serio, cada corrida dispara mails
    reales, come el tope diario de Gmail (~500/día) y CI necesitaría las credenciales del
    owner. Por eso el envío va detrás de una interfaz que **con `SMTP_HOST` vacío loguea el
    mail en vez de mandarlo**. Beneficio lateral: el link de invitación aparece en el log
    del backend, que es todo el loop de desarrollo que hace falta.
  - **Credenciales:** claves `SMTP_*` **vacías** en `.env.example` (mismo patrón que
    `GOOGLE_CLIENT_SECRET` y `QZ_PRIVATE_KEY`); el owner completa su `.env`, gitigno­rado.
    Gmail exige 2FA + **App Password**, no la contraseña de la cuenta. Y reescribe el
    remitente a la dirección de la cuenta: no se puede mandar como `no-reply@dominio`.

  **Decisiones que faltan y que el plan tiene que poner sobre la mesa:** cuánto vive una
  invitación y qué pasa al expirar; si invitación y reset comparten tabla de tokens (se
  parecen mucho: token de un solo uso, con vencimiento, que termina en "elegí tu
  contraseña"); y si la verificación de correo entra en la misma tanda.

  ### Lo que ya se decidió sobre esto (charla con el owner, 2026-08-08)

  - **Se manda un link de invitación, NO la contraseña por mail.** La contraseña mandada por
    correo queda en la casilla en texto plano para siempre, es reenviable y pasa por
    servidores intermedios; el link se quema al usarse. Además, con invitación **nadie más
    que la persona conoce jamás una credencial suya** —hoy el admin la dicta, o sea que hay
    un momento en que otro ser humano sabe cómo entrar a esa cuenta— y la verificación de
    correo sale gratis: si hizo clic, la dirección existe y es suya.
  - **Con invitación desaparecen la temporal, `debe_cambiar_contrasena`, el 403 de
    `switchTenant` y la pantalla `/cambiar-contrasena`.** No se suavizan: se borran. Todo
    ese andamiaje existe **solo** porque hay una contraseña que un tercero conoce. El owner
    propuso reemplazar el bloqueo por un modal que insista en cada login; se descartó
    mientras la temporal la dicte el admin, porque un modal que se puede cerrar deja la
    ventana de suplantación abierta indefinidamente en vez de acotarla a un login.
  - **NO se va a construir "reposición por el admin".** Se evaluó como paso previo (cierra
    el callejón de la temporal perdida sin necesitar mail) y **el owner la descartó**: con
    self-service el reset llega siempre al correo de la persona, así que el admin no
    necesita conocer ninguna credencial ajena. Construirla ahora sería trabajo que el mail
    tira, y obligaría a decidir una regla que con mail ni se plantea (ver abajo).
  - ⚠️ **La escalada entre tenants que evita el self-service, anotada para que no se
    redescubra:** la contraseña es del **usuario**, no del tenant — una sola cuenta para
    todos los tenants a los que pertenece. Si un admin del tenant A pudiera reponerla, se
    quedaría con una credencial válida para entrar como esa persona **en el tenant B**. Hoy
    el alta esquiva el problema no tocando nunca la contraseña de un correo que ya existe;
    cualquier reposición por admin que se proponga en el futuro tiene que resolver esto
    primero.
  - **Callejón sin salida que existe mientras tanto, asumido:** la temporal se muestra una
    sola vez. Si se pierde, la cuenta queda muerta —re-dar de alta responde 409, cambiarla
    exige saberla, y no hay reset—. Se asume porque no hay datos productivos ni gente
    usando el sistema: es riesgo de laboratorio, no de operación.

</details>

---

## Lo que está en pausa no se aplica ni se ofrece (2026-08-03)

- [x] **Un descuento, recargo o impuesto desactivado seguía aplicándose** (backend +
  frontend, cerrado 2026-08-03) — `activo` se escribía y no lo leía nadie:
  `indexarReglas` ni siquiera copiaba el campo al mapa del motor. El front escondía la regla
  del selector y el back la seguía cobrando.
  **La forma anotada el 2026-07-30 —desactivar limpia las asociaciones— quedó sustituida.**
  El owner precisó el 2026-08-03 que *desactivar es pausar, no eliminar*: la regla deja de
  aplicarse pero conserva sus asociaciones, y reactivarla la devuelve como estaba. Con eso se
  cayeron el cambio de esquema en las tres tablas puente, el problema de la PK compuesta
  bloqueando la reinserción, y el modal de restauración: nada de eso hizo falta.
  **Cómo se cerró:** `ReglaResuelta` e `ImpuestoResuelto` llevan `activo` **requerido** —si
  fuera opcional, olvidarse de mapearlo revive el bug en silencio—, y el descarte pasa al
  **aplicar**, no al cargar: la regla sigue en el mapa, porque sacarla haría que `requerir()`
  tirara 400 por id ausente en cada ítem asociado y el POS dejaría de vender. Cada descarte
  emite una `AdvertenciaPrecio`, siguiendo el precedente del tope.
  **Lo que fija cada cosa:** el mutante que revierte al comportamiento anterior (aplicar la
  regla pausada) rompe los tests; el control —*la misma regla activa sí descuenta*— impide que
  un motor que ignorara TODOS los descuentos pasara igual; y el test del desbruteo prueba que
  el impuesto pausado sale de la lista **antes** de dividir, no al aplicarlo, que era donde el
  neto se habría calculado mal sin que ningún total lo delatara.
  **Efecto lateral atendido:** la rama de recargos descartaba `r.advertencias` porque el tope
  solo avisa en descuentos y nunca había nada que perder. Con reglas pausadas sí lo hay.
- [x] **El IVA quedó explícitamente fuera del interruptor** (cerrado 2026-08-03) — lo gobierna
  la clasificación tributaria del ítem, nunca `activo` ([ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)).
  `CalculoPreciosService` fuerza `activo: true` al derivar el IVA del país, con un test que lo
  fija: *un ítem afecto paga IVA aunque la fila esté en `activo = false`*. Sin ese blindaje,
  una fila mal sembrada dejaba de cobrar IVA en silencio — problema fiscal, no aritmética.
  Su gemelo con dientes: *un adicional pausado del mismo catálogo sí se descarta*, para que el
  forzado no degenere en un "todo activo" que anule la feature.
- [x] **Un ítem pausado se vendía igual por POS y tienda online** (cerrado 2026-08-03) —
  hallazgo que no estaba en el radar y pegaba más fuerte que el de las reglas: `salones` exigía
  `AND i.activo = true` pero `cargarBasePorIds` —el camino del POS y de la tienda— solo
  filtraba `eliminado_el IS NULL`, y ninguno de los tres catálogos del front lo escondía.
  Cerrado con el comportamiento por canal que decidió el owner: **la tienda online rechaza el
  checkout** nombrando el producto (el carrito vive en el navegador, así que el ítem se puede
  pausar entre que se agrega y se paga, y ese es el único punto donde atajarlo); **el POS
  advierte y deja cobrar**; **salones no se toca** —lo ya cargado se cobra, agregar más se
  sigue rechazando—. La regla de fondo: se bloquea donde todavía no pasó nada, no se bloquea
  donde el consumo ya ocurrió en el mundo físico.
  El filtro **no** se puso en `cargarBasePorIds`: lo comparten los tres canales y cada uno
  necesita algo distinto. Y la advertencia del ítem pausado vive en el service, no en el
  motor: el motor calcula plata y un ítem pausado no cambia ningún monto.
- [x] **Refutado: editar un ítem NO borra la asociación de una regla pausada** (frontend,
  verificado en navegador 2026-08-04) — la revisión de cierre sospechaba que el
  `USelectMenu`, cuya lista de opciones excluye las pausadas, podía recortar del `v-model`
  los ids que no estuvieran en esa lista: editar cualquier campo del ítem habría borrado la
  asociación y la promesa del modal ("las asociaciones se conservan") habría dejado de ser
  cierta. **Se probó por los dos caminos y sobrevive en ambos:** renombrando el ítem sin
  tocar el selector, y abriendo el selector para agregar OTRO descuento —ahí el array quedó
  con los dos, el pausado incluido—. El componente no recorta.
- [x] **Pero el selector mostraba el UUID crudo de la regla pausada** (frontend,
  `items.vue`, cerrado 2026-08-04) — hallazgo colateral de esa misma verificación, y este sí
  era real: al excluir las pausadas de las opciones, el select no podía resolver id → nombre
  para una regla YA asociada y pintaba `3a1a81a4-feeb-41d0-…` donde el admin esperaba un
  nombre. Preexistente, pero casi inalcanzable hasta ahora: nadie pausaba porque pausar no
  hacía nada. **Cierre:** las opciones incluyen también las pausadas **que el ítem ya tiene
  asociadas**, con el sufijo `(en pausa)` —conservando el `(Sistema)` de los impuestos del
  catálogo oficial, que la primera versión se comía—. No contradice "lo pausado no se
  ofrece": aparece para explicar lo que ya está puesto, no para elegirlo de nuevo.
  **Dos lecciones del molde de tests, las dos medidas con mutantes:**
  1. **Un `USelectMenu` cerrado no renderiza sus opciones** —viven en el portal de reka-ui y
     no llegan al `document.body` hasta que se abre—, así que un
     `expect(document.body.textContent).not.toContain(...)` sobre una opción **no observa
     opciones: observa selección**, y pasa con cualquier implementación. La primera versión
     de estos tests afirmaba cubrir "la pausada no asociada no se ofrece" y no cubría nada:
     el mutante que ofrecía TODAS las pausadas pasaba 15/15. Se corrigió afirmando sobre el
     prop `items` de cada select. Hoy los tres mutantes caen: ofrecer todas, revertir el
     arreglo, y revertir un solo gemelo.
  2. El drawer se teletransporta a `document.body`, así que un `unmount()` que no corre por
     una aserción fallida contamina tests **posteriores**. Sin el `finally`, el mutante hacía
     caer además el test del chip de IVA y la señal apuntaba al lugar equivocado.
- [x] **`metodos_pago.activo` era una columna muerta** (cerrado 2026-08-03) — existía en el
  esquema, la entidad y el seed, y no la leía ningún código. El interruptor real es
  `tenant_metodo_pago.habilitada`, que además es por tenant; `activo` habría sido global, y en
  multi-tenant lo global casi nunca es lo que se quiere. Se eliminó de los tres lugares.

---

## Congelado de las reglas aplicadas en la venta (2026-08-02)

- [x] **El valor de un tramo nunca se validaba: un "50%" cargado como `50` pasaba**
  (backend, cerrado 2026-08-02) — `validarValor()` exigía que un porcentaje fuera `< 1`,
  pero **solo se invocaba para `TIPOS_CON_VALOR_UNICO`**. Los tipos por tramos pasaban por
  otra rama que solo verificaba que **hubiera** al menos un tramo; el `valor` de cada uno lo
  tipaba `TramoDto` con un `@IsNumberString()` pelado. La misma regla de negocio se
  enforzaba o no según el tipo, y un tramo `porcentaje` con `50` producía un descuento del
  **5000%**.
  **Al arreglarlo apareció la cara opuesta de la misma falla:** `validarSegunTipoUpdate`
  resolvía el modo como `dto.modo ?? 'porcentaje'`, así que un `PATCH { valor: '5000' }`
  sobre una regla `monto_fijo` que no reenviaba el modo se rechazaba con 400 — una edición
  legítima, imposible desde la API. Las dos son *validar el campo que llegó en vez del
  estado que queda*, que es la lección que este archivo ya tenía escrita de la oleada
  anterior (`validarEstadoResultante`).
  **Cómo se cerró:** `validarMontosDeRegla(modo, valor, tramos)` en
  `common/utils/monto-regla.util.ts` valida el `valor` plano y el de **cada tramo** con el
  **mismo** modo — el modo con el que la fila queda, no el que llegó. Se extrajo a `common/`
  (decisión del owner) en vez de duplicarla en los dos services: el costo de la duplicación
  anterior no fue que las copias divergieran, sino que nadie podía ver de un vistazo si
  todos los caminos la usaban — y en dos de cuatro no. En `update` los tramos se leen de la BD cuando el `PATCH` no los trae, para
  que cambiar solo el `modo` no reinterprete valores ya guardados (un tramo de `5000`
  legítimo como monto fijo pasaría a ser 500.000%). El mismo fix en `recargos`, donde ningún
  tipo pide tramos pero la plomería es alcanzable por API y el motor los evalúa mirando
  `tramos.length` antes que el código del tipo.
  **Qué lo fija:** `reglas-valor.e2e-spec.ts` gana cinco casos —tramo `50` en porcentaje
  (400), el mismo `5000` en monto fijo (201, ancla positiva), `PATCH` de solo el modo que
  revalida los tramos guardados, `PATCH` de valor sobre `monto_fijo` (200) y el gemelo de
  recargos— más siete unit entre los dos services. Los dos bugs se verificaron **abiertos**
  contra la API real antes de cerrarlos y **cerrados** después. Mutantes: quitar la
  validación de tramos mata 4 tests; volver a `dto.modo ?? 'porcentaje'` mata 1.
  ⚠️ La revisión que lo encontró lo reportó como riesgo de *overflow* de `NUMERIC(7,4)`;
  eso estaba mal —esa columna aguanta hasta `999.9999`, un `50` cabe—. El daño era el
  descuento absurdo, no el desborde.

- [x] **El recorte de un descuento no queda auditado en ninguna parte** (backend, cerrado
  2026-08-02) — cuando el piso topea un descuento de 500 a 100, en BD quedaba un descuento
  de 100 sin ningún rastro de que la regla valía 500; el motivo vivía solo en un toast que
  el cajero puede no leer.
  **Cómo se cerró:** la entrada proponía "una columna o flag en el detalle de venta", y al
  medir resultó ser la punta de un hueco más grande: la venta tampoco guardaba **con qué
  valor** aplicó ninguna regla, así que editar un descuento de 10% a 20% reescribía el
  pasado. Se resolvieron juntos. `ventas_descuentos.valor_solicitado` guarda lo que la regla
  pedía —separado de `valor_aplicado`, que sigue siendo lo que entró en el total para que el
  comprobante cuadre—, y las tres tablas congelan además `nombre_regla`, `modo`,
  `porcentaje_aplicado` y `detalle_id`. No es un flag: guardar el **monto pedido** dice
  cuánto se recortó, mientras que un booleano solo diría que algo se recortó.
  **Qué lo fija:** `ventas.e2e-spec.ts` → "guarda lo que el descuento pedía cuando el piso
  en cero lo recortó" (aplicado $2.000 / solicitado $5.000) y el unit gemelo en
  `ventas.service.spec.ts`. Mutantes verificados: revertir al código sin `detalle_id` y
  atribuir todo a `detalles[0]` — los dos matan el test de las dos líneas, en unit y en e2e.
  Detalle completo en `docs/features/motor-calculo-precios.md` → "La venta congela la regla
  que aplicó". Plan: `docs/superpowers/plans/2026-08-02-congelar-reglas-en-la-venta.md`.

---

## Papelera — las 15 pantallas del frontend (2026-08-02)

- [x] **Las 15 pantallas de la papelera cableadas** (frontend, cerrado 2026-08-02) —
  ⚠️ **Corregido (Ronda de fixes 1):** son 16 recursos backend, pero **15
  pantallas** — `mesas` no tiene página propia, vive dentro de
  `configuracion/salones.vue`, así que no cuenta aparte.
  `configuracion/items.vue`, `configuracion/categorias.vue` y —desde el
  2026-08-01— `configuracion/impuestos.vue`, `configuracion/descuentos.vue` y
  `configuracion/recargos.vue` y `configuracion/turnos.vue` tienen el toggle
  "ver eliminados" y el botón restaurar; las otras 9 (`grupos-modificadores`,
  `terceros`, `cajones`, `garzones`, `salones` [con sus `mesas`], `impresoras`,
  `causas-merma`, `motivos-diferencia`, `motivos-diferencia-inventario`) quedan
  sin UI. El molde ya está probado en las seis pantallas hechas:
  `usePapelera(recurso)`
  (`app/composables/usePapelera.ts`) da el toggle, `restaurar(id, nombre?)` y
  `formatearBorradoPor(fila)`.
  📐 **Usar `configuracion/descuentos.vue` + `descuentos.nuxt.spec.ts` como
  molde** (antes era `impuestos`): es el que tiene la salida de colisión y el
  primero cuyos 11 tests se verificaron uno por uno contra el mutante que cada
  uno debería cazar. `recargos.vue` + `recargos.nuxt.spec.ts` son la copia de ese
  molde, también con los mutantes corridos — sirve de referencia de qué cambia y
  qué no al replicarlo (spoiler: solo los nombres). Para una pantalla SIN
  unicidad de nombre, copiar todo menos el modal de colisión y sus 4 tests. Lo que las rondas de
  revisión corrigieron, y que conviene no volver a romper:
  - **Guard de reentrancia en `restaurar`, y aplica a las 9.** El `CrudModal`
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
  quedan 9, las mismas menos `impuestos`, `descuentos`, `recargos` y `turnos`,
  que ya la tienen), así
  que **todas** necesitan la cola serial local. Los 10 consumidores reales de
  `usePaginatedList` (8 páginas + 2 componentes: `CajaHistorial`,
  `CajaMovimientosTable`, `sesiones-garzon`, `mermas`, `ordenes`,
  `ventas/index`, `configuracion/items`, `pagos/index`, `inventario/index`,
  `inventario/recuentos/index`) no son ninguna de ellas.
  **Las 9 necesitan la MISMA cola serial local que `categorias.vue` ya tiene**
  (`cargaEnCurso` en su `cargar()`): copiar ese patrón, no reinventar uno nuevo.
  Test determinístico por pantalla: promesas controladas que resuelven en orden
  inverso al de los dos toggles, como `descuentos.nuxt.spec.ts` → "papelera: la
  carrera de `cargar()` bajo toggles rápidos". El equivalente de `items.vue`
  ("la carrera del toggle vía usePaginatedList") **no** sirve de molde acá: ese
  ejercita el `watch` del composable, que ninguna de las 9 tiene.

  ---

  **CÓMO SE CERRÓ (2026-08-02).** Las 9 pantallas restantes se replicaron en
  paralelo, una por agente, cada uno con el molde y los hechos de SU pantalla
  medidos de antemano y con la instrucción de **parar y reportar BLOCKED si un
  dato del brief no cerraba contra el código**. Ese freno se usó dos veces y las
  dos el brief estaba mal, no el código:

  - `grupos-modificadores`: el brief decía que usaba `usePaginatedList` y que por
    eso heredaba la cola serial. **Falso**: el grep matcheó el import del TIPO
    `PaginatedResponse`, que la pantalla usa para el catálogo de `/items`; los
    grupos cargan con `useApiFetch<Grupo[]>`. De las 15, **solo `items.vue`**
    hereda la cola.
  - `garzones`: el brief pedía agregar un `restaurar(id)` a `useGarzones`. El
    agente no lo hizo porque `usePapelera(recurso)` ya lo provee y duplicarlo
    habría sido código muerto. Tenía razón: `turnos.vue`, que también tiene
    composable propio, hace exactamente eso.

  Los mutantes de esta entrada (A/C/E/F/G, +P donde hay permisos) se corrieron en
  las 9. Dos pantallas las escribió Haiku y sus mutantes se re-corrieron a mano
  antes de creerles — pero con `causas-merma` ya resuelta y validada como molde a
  un paso de distancia, no con el molde original.

  **Mutantes nuevos que salieron de este trabajo y no estaban en la lista:**
  - **I** (`impresoras`): `useImpresoras.listar()` la comparten los caminos de
    impresión (`imprimirComanda`, `obtenerImpresoraBoleta`). Un `incluirEliminados`
    con el default cambiado haría imprimir en impresoras borradas. Lo fija
    `useImpresoras.nuxt.spec.ts` sobre la cadena real, no sobre `listar()` aislada.
  - **M** (`garzones`): que el 400 del placeholder Mostrador se muestre como toast
    y no como modal de renombrado — renombrar no resuelve esa colisión.
  - **S** (`salones`): que el Restaurar de una MESA no pegue al endpoint del
    SALÓN. Son dos controllers distintos y es el error más fácil de cometer ahí.

  **Deriva que dejó el paralelismo, y que hubo que limpiar después:** tres copias
  idénticas de la misma función de orden (`esFijo` primero, después alfabético),
  extraída a `usePapelera.ts` → `ordenarFijosPrimero`; y `terceros` había perdido
  su uso de `CrudListItem` reemplazándolo por markup a mano, contra el precedente
  ya commiteado de `categorias.vue`. Ninguna de las dos la habría visto un agente
  mirando solo su pantalla: las encontró la revisión del diff completo.

---

## Unicidad de nombre — unificada (2026-08-01)

- [x] **La unicidad de nombre estaba partida 4 y 4, sin que nadie lo hubiera
  decidido.** Medido leyendo la cláusula de comparación real y los índices del
  esquema (no grepeando `lower`, que matchea comentarios): `descuentos`,
  `recargos`, `turnos` y `cajones` comparaban case-**sensitive**; `causas_merma`,
  `motivo_diferencia_caja`, `motivo_diferencia_inventario` y
  `grupos_modificadores`, case-**insensitive**. Encima los tres primeros no tenían
  índice ninguno: la unicidad vivía solo en el código, con una ventana de carrera
  entre el `SELECT` y el `INSERT` por la que sí podían quedar dos filas vivas con
  el mismo nombre.

  **Decisión del owner: case-insensitive en los ocho** —"Extras" y "extras" son el
  mismo nombre, porque en una lista que alguien elige a ojo dos entradas que solo
  difieren en mayúsculas son un error de tipeo—, **y con índice en los tres que no
  tenían**. Queda en `docs/PRODUCTO.md` como regla de producto, no como detalle de
  esquema.

  Cerrado con: índice único parcial sobre `(tenant_id, lower(nombre))` con
  `WHERE eliminado_el IS NULL` en `descuentos`, `recargos` y `turnos`; el de
  `cajones` pasó de `nombre` pelado a `lower(nombre)`; comparación con `LOWER` en
  los cuatro services; `{ ignorarMayusculas: true }` en las cuatro llamadas al
  helper de sugerencia; y `restaurar()` de los tres que pre-consultaban pasó a la
  forma del `catch` del `23505`, que ahora es la única de las ocho.

  `cajon.entity.ts` perdió su `@Index`: TypeORM no sabe expresar `LOWER()`, así
  que mientras estuvo declarado ahí `synchronize` creaba en dev un índice
  case-sensitive y la base enforzaba otra regla que el código —exactamente el bug
  que se había corregido en `grupos_modificadores` el mismo día—. Lo crea el
  seeder con SQL cruda, con el mismo `DROP` condicional que repara las bases de
  dev viejas (verificado en vivo: índice CS a mano → restart → queda el de
  `lower()`).

  **Lo fija `test/unicidad-nombre.e2e-spec.ts`** (16 tests): forma del índice de
  las 8 tablas —consultado por tabla, no por nombre de índice, que no es la
  regla— y conducta por las dos puertas, crear y restaurar. Mutantes corridos:
  revertir el `LOWER` de `descuentos` deja el crear en **500** (el índice rechaza
  lo que el código aceptó); hacer que el seeder cree el índice sin `lower()` pone
  en rojo la forma **y** la conducta de restaurar. El de índice-shape **no** se
  cae borrando el índice a mano: el propio e2e arranca el seeder, que lo recrea —
  por eso el mutante válido es sobre el seeder, no sobre la base.

  ⚠️ Efecto de borde a saber: en una base que ya tenga nombres que colisionan solo
  por mayúsculas, el `CREATE INDEX` del seeder **falla y el backend no arranca**.
  Se comprobó (lo provocó un mutante) y no se mitiga: no hay datos productivos, el
  seed sembrado no tiene colisiones —verificado antes de tocar nada— y la salida es
  resetear.

- [x] **`recargos` validaba contra dos códigos que no existen.** La lista local
  `tiposConTramos = ['por_mayor', 'por_monto_venta']` de `validarSegunTipoCreate`
  era de códigos de **descuento**: ningún tipo de recargo usa tramos, así que ese
  `if` no podía matchear nunca. Copy-paste entre los módulos gemelos. Borrada la
  lista y su `if`; verificado que `RECARGO_CONFIG` (frontend) no declara
  `campoTramos: true` en ninguno de los 5 tipos, así que la UI nunca los manda.
  **La plomería que persiste tramos en `create()`/`update()` sigue en pie** y
  quedó como entrada propia en `pendientes.md`: sacarla toca persistencia.

---

## Lote de pendientes mecánicos (2026-08-06)

Entradas de tandas anteriores que no necesitaban ninguna decisión de negocio.

- [x] **El e2e daba fallos masivos falsos si se corría después de editar un fuente**
  (harness, `scripts/reset-db.sh`) — la entrada traía la causa como **hipótesis no
  verificada**. Se verificó, y resultó **más amplia** de lo que decía: no es que
  `reset-db.sh` espere el `Seed complete` equivocado, es que **cada cambio de un `.ts`
  vuelve a sembrar**. Medido el 2026-08-06 sobre el stack real: crear un archivo `.ts`
  llevó el contador de `Seed complete` de **1 a 2**, y borrarlo a **3**. La causa es el
  compose: `command: npm run start:dev` con `./backend:/app` bind-mounteado. Un `touch`
  (solo mtime) **no** alcanza — el watcher mira contenido —, lo que explica por qué el
  síntoma parecía intermitente.
  **Dato que reordena el problema:** el e2e **no usa el backend del contenedor**. Levanta
  su propia app en proceso contra la misma BD, así que ese contenedor no le aporta nada a
  la suite — solo puede contaminarla.
  **Cómo se cerró, en dos mitades:** (1) el script espera a que el backend quede
  **quieto** (log sin crecer 6s, con timeout propio de 60s) y recién ahí devuelve el
  control, para que una recompilación en vuelo aterrice antes y no durante la suite;
  re-asserta 1 seed después de esperar. (2) `./scripts/reset-db.sh --verificar`, que se
  corre **después** del e2e y contesta la pregunta que un e2e con fallos raros deja
  abierta: ¿la base se movió abajo de la suite? Sin eso, la respuesta costaba una sesión
  de forense sobre fallos que no eran regresiones.
  ⚠️ **La revisión independiente bloqueó con tres agujeros, los tres medidos, y uno era
  exactamente el que hace que la herramienta sea peor que no tenerla:**
  - **Verde falso ante un contenedor recreado.** `docker logs` es por **instancia**, no
    por nombre: un `--force-recreate` (o un `--build`, o un cambio de `.env`) re-siembra
    sobre el mismo volumen y deja el log en 1 → el comando decía "la corrida es válida"
    justo en el caso que existe para detectar. Se cerró registrando el `docker inspect
    -f '{{.Id}}'` del contenedor en `.git/reset-db.estado` durante el reset y exigiendo
    que coincida al verificar. Medido: con el log en 1 tras recrear, ahora corta en rojo.
  - **El bucle de quietud no tenía timeout.** El compose declara `restart:
    unless-stopped`: un backend en crash-loop escribe log para siempre y el script
    quedaba colgado **en silencio**, en el paso que el checklist manda correr antes de
    cada e2e. Ahora corta a los 60s mostrando las últimas líneas.
  - **Muerte muda con 0 seeds.** `grep -c` sale 1 sin match y `set -e` mataba el script
    sin imprimir nada (contenedor caído, docker ausente, `NODE_ENV=production` donde el
    seeder retorna antes de loguear). Ahora `seeds()` devuelve 0 y hay un diagnóstico.
  - Y un cuarto, chico pero feo: **cualquier flag mal tipeado caía al camino
    destructivo**. `--verify` en vez de `--verificar`, tipeado *después* del e2e para
    peritar, hacía `down -v` y borraba la evidencia. Ahora hay validación de argumentos.

  ⚠️ **Y la segunda vuelta de revisión encontró que el propio arreglo se apagaba solo en
  un worktree.** `ESTADO=".git/reset-db.estado"` asume que `.git` es un directorio, y en
  un **worktree enlazado es un archivo**: escribir ahí falla con "Not a directory" y, al
  ser la última línea del reset, mataba el script **después** de haber hecho todo bien —
  sin registrar el Id y sin imprimir el verde—. El `--verificar` siguiente caía en la rama
  "no hay registro"… que salía **0**. O sea: dentro de un worktree, la detección de
  recreación que motivó el bloqueo anterior quedaba desactivada en silencio. Y este repo
  tiene un worktree vivo, en el directorio que el propio proyecto usa para verificar sin
  `git stash`. Se cerró con `$(git rev-parse --git-common-dir)` —`--git-common-dir` y no
  `--git-dir`, porque el contenedor es uno solo para todos los worktrees y el registro
  tiene que ser compartido—, medido desde el worktree real.
  De la misma vuelta salió el fail-open: **`--verificar` salía 0 cuando admitía no poder
  responder**. Ahora sale **2** con un mensaje que distingue "no sé" de "sí". Es el mismo
  principio que motivó todo el comando: un verde falso es peor que no tenerlo.
  **Todo verificado midiendo cada rama**: verde legítimo (mismo contenedor, 1 seed),
  contaminación por watcher (2 seeds → rojo), contenedor recreado (1 seed pero otro Id →
  rojo), contenedor inexistente (diagnóstico, no terminal vacía), flag mal tipeado (no
  resetea). `CLAUDE.md` documenta la regla —no tocar un `.ts` del backend con el e2e
  corriendo— y el comando.
  ℹ️ **Lo que `--verificar` NO mide**, dicho en el propio script: el estado que acumula la
  suite. Correr el e2e dos veces seguidas deja cajas abiertas y stock agotado, y eso este
  comando no lo ve.

- [x] **`uq_motivo_diferencia_caja_tenant_nombre` se llamaba distinto en el seeder**
  (backend) — verificado antes de tocar: `startup-pos.sql:962` lo declara con ese nombre,
  el seeder lo creaba como `uq_motivo_diferencia_tenant_nombre`, la definición era
  idéntica y en la BD real existía solo el del seeder. Su **gemelo de inventario**
  (`uq_motivo_dif_inv_tenant_nombre`) sí coincidía en los dos lados: este era el único
  desalineado de los dos.
  Se unificó hacia el nombre de `startup-pos.sql`. ⚠️ **El primer intento copió el `DROP` +
  `CREATE` de `seedCajones()` y la revisión mostró que ese patrón no encaja acá:** allá la
  definición vieja era **distinta** (case-sensitive, sin `lower()`) y había que reconstruir
  el índice; acá es idéntica y solo cambia el nombre. `DROP` + `CREATE` son dos sentencias
  en dos transacciones implícitas, o sea una ventana con la tabla **sin unicidad** — y si
  el arranque muere en el medio la deja sin índice, cosa nada hipotética porque el watcher
  reinicia el backend seguido. Quedó como `ALTER INDEX … RENAME`, que es **atómico** y no
  reconstruye nada, dentro de un `DO $$` condicional a los dos nombres.
  **Los tres caminos verificados contra Postgres real:** base fresca → nombre nuevo; base
  vieja (solo el nombre viejo) → renombrado; y el borde de que existan **los dos** → se
  dropea el viejo y queda uno.
  El e2e de unicidad no se rompe porque afirma la **forma** del índice (UNIQUE + tenant_id
  + `lower(`), no su nombre.

- [x] **El guard de reentrancia de `items.vue` ya tiene regresión automatizada**
  (frontend, `items.nuxt.spec.ts`) — ⚠️ **la entrada decía "el proyecto no testea páginas"
  y eso quedó viejo**: `items.nuxt.spec.ts` existe hace rato (614 líneas) y ya tenía dos
  tests de carrera con promesas retenidas. El hueco era solo este guard.
  **Lo que costó pensar fue qué afirmar.** El observable NO es a qué item apunta el modal
  al final: sin el guard, la respuesta tardía del primero igual termina pisando al segundo,
  así que los dos caminos aterrizan en el mismo item y una aserción sobre eso no falsea
  nada. Lo que distingue es **cuántas verificaciones se disparan** — con el guard, una; sin
  él, dos — y que el modal no llegue a abrirse con el item equivocado en el medio.
  Se instrumentó el mock de `useApiFetch` para registrar cada `GET /items/:id/uso` y poder
  retener la respuesta por id. Tres tests: la carrera; **que el guard se libere** al
  terminar (un guard que no se libera deja la pantalla muerta después del primer borrado,
  que sería peor que el bug original); y la **mitad visual** —que el menú de esa fila quede
  deshabilitado mientras verifica—, que la revisión señaló como mutante sobreviviente: sin
  ese feedback el guard se traga los clicks en silencio.
  **Mutantes medidos:** borrar `if (verificandoEliminarId.value) return` mata 1; vaciar el
  `finally` que libera el guard mata 1; borrar `:loading`/`:disabled` mata 1; y un guard
  que igual abriera el modal con el item equivocado también mata 1.
  ⚠️ La revisión encontró además un `if (cerrar)` **inerte** en uno de los tests: el click
  condicional pasaba igual si el botón no existía, así que el test podía degradar en
  silencio a una versión más débil. Ahora se afirma el botón.

---

## El esquema uniformado a `timestamptz` (2026-08-06)

- [x] **El esquema mezclaba `TIMESTAMPTZ` y `TIMESTAMP` sin zona en la misma columna
  lógica** (backend, transversal) — el default de TypeORM cuando el decorador de fecha no
  fija `type`. Medido sobre Postgres real antes de tocar nada: `eliminado_el` 65 sin zona
  contra 22 con zona, y **el mismo split en las otras dos columnas de auditoría** que la
  entrada original no había mirado: `creado_el` 66/22 y `actualizado_el` 64/22. O sea ~195
  columnas partidas por accidente, no 65 — la entrada subestimaba el alcance 3×.
  **Por qué no es cosmético:** comparar una columna de cada tipo sin cast deja que Postgres
  castee la que no tiene zona usando el `TimeZone` de **la sesión que compara**, no el que
  estaba activo al escribir. Verificado con `SET TimeZone` en sesiones separadas: matchea 1
  de 3 combinaciones. Ya le había costado una ronda de revisión a `items.restaurar()`.
  **Cómo se cerró:** codemod de 4 variantes literales sobre las entities (196 offenders
  medidos, 196 explicados) + `refresh_tokens`, que es aparte (abajo). `startup-pos.sql` **no
  se tocó: ya estaba entero en `TIMESTAMPTZ`** — la deriva era de las entities, y el archivo
  además no lo ejecuta nadie (es referencia; la base la construye `synchronize` + seeder).
  Sin migración incremental: sin datos productivos se cambia el esquema y se resetea.
  **Resultado medido después del reset: CERO columnas `timestamp without time zone` en toda
  la base**, no sólo en las tres de auditoría. Por eso el invariante que quedó escrito es el
  fuerte —ninguna columna del esquema sin zona— en vez del acotado a las tres.
  **Dos redes, porque una sola no alcanza:** un invariante unit
  (`common/invariants/timestamptz-columns.invariant.spec.ts`, junto al de ADR-004) que mira
  la **metadata de TypeORM** y no un grep, porque el grep mide el mecanismo (el decorador) y
  la regla es sobre la conducta (el tipo): 5 entities declaran estas columnas con `@Column` a
  secas y un grep de `@DeleteDateColumn` no las ve. Y un e2e (`test/esquema.e2e-spec.ts`)
  contra `information_schema`, que cubre **todas** las columnas y no sólo las que el unit
  reconoce como de auditoría. Revertir una sola entity mata las dos: el unit nombra la clase (`Turno.eliminado_el`), el e2e la tabla.
  **El invariante encontró su propio límite:** `refresh_tokens.expires_at` estaba sin zona,
  no la miraba ninguna red —no es columna de auditoría— y decide si un token sigue vivo. La
  encontró una persona leyendo la tabla de al lado al migrar `created_at`. Es exactamente el
  caso que justifica que el e2e vaya sobre el esquema entero.
  **Invariante 4 (no tocar el sistema JWT):** `refresh_tokens` cae bajo ella, así que se
  paró y se preguntó en vez de decidir. El owner autorizó migrar las dos columnas
  (2026-08-06), con el radio ya medido: `created_at` no lo lee nadie y la comparación de
  expiración vive en JS (`existing.expiresAt < new Date()`), nunca en SQL. Ninguna lógica de
  tokens cambió.
- [x] **El propio fix de `items.service.ts` se dio vuelta con la migración** (cerrado en la
  misma tanda) — lo encontró el barrido, y es lo más caro que salió de todo esto.
  `remove()` escribía `eliminado_el = NOW() AT TIME ZONE 'UTC'` y `restaurar()` leía con el
  mismo cast, **puesto a propósito** porque `items.eliminado_el` era sin zona y
  `receta_extras_permitidos.eliminado_el` con zona. Con las dos columnas ya en `timestamptz`
  ese cast **reintroduce el bug que arreglaba**: convierte la columna a un `timestamp` sin
  zona que Postgres re-castea con el `TimeZone` de sesión. **Medido contra Postgres real:
  con la sesión en `America/Santiago`, el instante guardado quedaba 4 horas corrido.** Hoy
  no explotaba porque la sesión es UTC — justo la coincidencia de la que ese código decía no
  querer depender. Se sacaron los dos casts y se reescribieron los comentarios que
  documentaban el razonamiento viejo. El test de `items.service.spec.ts` que **exigía** el
  cast ahora asevera lo contrario: que no esté.
  **La moraleja, que vale más que el fix:** un cast de zona horaria es una respuesta al TIPO
  de la columna, no una verdad permanente. Si el tipo cambia, el cast se relee, no se
  conserva. Y ningún test lo habría cazado: el mutante correcto era el propio esquema.

---

## Auditoría `turnos` + `salones` + `garzones` (2026-08-06)

Los hallazgos que se cerraron. Los que quedan y lo refutado están en
[`pendientes.md`](pendientes.md).

- [x] ~~**Dos `describe` viejos de `garzones.nuxt.spec.ts` desmontan al final del test, no
  en `afterEach`**~~ (frontend, cerrado 2026-08-11) — *"papelera: eliminar respeta el
  toggle"* y *"papelera: restaurar"* pasaron al patrón que ya usaba el `describe` de
  advertencias: `let montado` + `afterEach`, seis `wrapper.unmount()` menos.

  **La entrada describía el mecanismo bien y el síntoma mal**, y eso cambió cómo se
  verificó. Decía que un test que falla contamina al siguiente; forzar un fallo *después*
  de cerrar el modal no reprodujo nada (1 test rojo, 12 verdes), porque el diálogo ya no
  estaba abierto. Recién forzando el fallo **con el modal abierto** apareció, y no como
  test rojo: una sonda al entrar al test siguiente midió **`dialogos=1`** en
  `document.body`. Con el `afterEach`, la misma sonda mide **`dialogos=0`**.

  Que no pintara rojo es lo peor del caso, no lo mejor: el test siguiente busca su modal
  con `document.body.querySelector('[role="dialog"]')` —el **primero**—, así que agarraba
  el huérfano del test anterior y **pasaba en verde clickeando la pantalla equivocada**.
  La entrada advertía "cualquier mutante sobre este archivo puede dar señal inflada"; la
  medición muestra que también puede dar señal *falsamente verde*, que no se nota nunca.

- [x] ~~**El filtro "Hasta" del historial de sesiones excluía las sesiones del propio
  día**~~ (backend, cerrado 2026-08-07) — `AppDateInput` emite `YYYY-MM-DD`, `s.inicio_el`
  es `timestamptz`, y comparar una contra otra castea la fecha a **medianoche**: "Desde hoy
  / Hasta hoy" no devolvía **ninguna** sesión del día.
  **Por qué la zona del tenant y no un simple `+ 1 día`.** Medido contra Postgres real con
  una sesión que arranca 21:00 hora Chile del 7 de agosto:

  | variante | sesiones |
  |---|---|
  | `<= '2026-08-07'` (el bug) | **0** |
  | `< fecha + 1`, sin zona (el arreglo "mínimo") | **0** |
  | `< fecha + 1` en zona del tenant | **1** |

  El arreglo barato **no cerraba el bug**: medianoche UTC del 8 son las 20:00 del 7 en
  Chile, o sea justo cuando trabaja un restaurante. No es una decisión nueva: el proyecto ya
  la había tomado en `propina-reportes.service.ts`, que castea igual (`$N::date::timestamp
  AT TIME ZONE $Z`). Lo que sí difiere de ese precedente es que allá `hasta` es
  **exclusivo** y acá es **inclusivo del día completo** (`< hasta + 1`), porque un
  `AppDateInput` rotulado "Hasta" promete incluir ese día.
  **La entrada decía "backend + frontend" y el frontend no necesitó nada**: ya mandaba
  `YYYY-MM-DD`, que es exactamente lo que el backend ahora interpreta bien.
  **Efecto lateral asumido:** es la **doceava** copia del JOIN `tenants → provincia → pais`.
  Se duplicó con su filtro `eliminado_el` —la condición que la entrada de ese JOIN pone para
  reabrirse— y esa entrada quedó actualizada con el conteo real.

- [x] ~~**`garzones.actualizar()` no bloqueaba `activo:false` con una sesión abierta, y
  `eliminar()` sí**~~ (backend, cerrado 2026-08-07) — **solo la mitad `activo`**, que era la
  mecánica. Desactivar a alguien en turno lo dejaba sin poder cerrar su sesión ni operar
  (`resolverGarzonPorPin` filtra `activo: true`) y bloqueaba de rebote la desactivación del
  turno. El chequeo que `eliminar()` ya tenía se extrajo a `assertSinSesionAbierta(tenantId,
  id, accion)` y `actualizar()` lo llama cuando `dto.activo === false && garzon.activo`.
  **La condición es esa y no `dto.activo !== undefined`** a propósito: reactivar a un garzón
  y guardar solo el nombre no consultan sesiones. Los tres casos tienen test, y los mutantes
  discriminan entre sí (ensanchar la condición mata el de reactivar; volverla incondicional
  mata además el de "solo el nombre").
  **La mitad de `tipo` sigue abierta** en [`pendientes.md`](pendientes.md): es decisión de
  producto —bloquear o solo advertir— y no se cierra junto con la mecánica.
  **Limitación heredada, no introducida:** entre el `count` y el `save` hay una ventana de
  carrera que el índice parcial de `sesiones_garzon` no cubre. `eliminar()` ya tenía la
  misma; el diff la copia tal cual.

- [x] ~~**Si se borraba el ítem *y* su categoría, la línea desaparecía del ticket de
  cocina**~~ (backend, cerrado 2026-08-07) — el `LEFT JOIN categorias` de `sqlLineasComanda`
  filtraba `eliminado_el IS NULL`, así que `impresora_id` quedaba `NULL` y
  `agruparEstacionesComanda` hacía `continue` **en silencio**: lo ya pedido no llegaba a
  cocina. Se quitó ese filtro, con el mismo argumento que ya tenía el JOIN de `items`:
  **lo que el cliente pidió se cocina aunque el catálogo lo haya borrado después.**
  **Por qué es seguro:** `c` se usa exclusivamente para `c.impresora_id`, y el JOIN es contra
  la PK, o sea a lo sumo una fila — no puede duplicar ni partir líneas. El filtro del JOIN de
  `impresoras` **sí se conserva**: una impresora dada de baja no es un destino válido.
  Efecto colateral asumido y correcto: esas líneas ahora también avanzan su `cantidad_enviada`.
  Sigue sin cubrirse a nivel de dato por el hueco de fixture del seed que
  [`pendientes.md`](pendientes.md) ya tiene anotado; el test afirma sobre el SQL.

- [x] ~~**"Nueva cuenta" no tenía guard de reentrancia, y sus tres hermanos sí**~~
  (frontend, cerrado 2026-08-07) — `nuevaCuenta`/`abrirCuentaConPin` no usaban el ref "en
  curso" + `:loading` que ya usaban `fusionarSeleccionadas`, `transferirCuentaConPin` y
  `cerrarCuentaConPin`. El modal de PIN cierra apenas emite `confirm`, antes de que resuelva
  el POST, así que quedaba una ventana con la UI interactuable y la petición en vuelo: doble
  tap o lag de red creaban dos cuentas en la mesa. El backend no puede defenderlo —varias
  cuentas abiertas por mesa es intencional—, así que el guard va sí o sí en el cliente.
  `abriendoCuenta.value = true` se setea **antes del primer `await`** y lo chequean los dos
  puntos de entrada.
  **Con regresión automatizada**, que es lo que faltaba: `pages/salones/index.nuxt.spec.ts`
  —el primer spec de esta página— ejercita dos rondas completas de PIN con el POST retenido.
  Dos mutantes medidos, y **cada uno mata exactamente un test**, que es lo que prueba que
  ninguno de los dos es relleno: revertir el guard entero al código anterior hace fallar
  solo el del doble submit, con **2 POST en vez de 1** (las dos cuentas del bug); sacar
  únicamente el `finally` hace fallar solo el que verifica que el flag se libera. Ninguno
  muere por `TypeError`.
  Esa separación limpia costó una corrección: con el `unmount()` al final de cada `it`, el
  primer mutante arrastraba también al segundo test —cascada, no señal: el test que falla
  no llega a desmontar y deja su diálogo teletransportado vivo en el `document.body`
  compartido—. Con el desmontaje en un `afterEach`, que corre pase o falle, desaparece. Ni `vue-tsc` ni `design:check` ven reentrancia, así que sin ese
  test el cambio se apoyaba solo en lectura de código.
  **Del harness, lo único que quedó verificado:** `AppDrawer` y `UModal` teletransportan su
  contenido fuera del wrapper, así que la búsqueda va sobre `document.body` y **acotada a su
  diálogo** — con dos diálogos vivos a la vez, buscar por texto en todo el body puede tomar
  el botón equivocado y el test pasa igual. Es la misma trampa que ya documentaba el spec de
  `configuracion/garzones`, no una nueva.
  ⚠️ **Acá había una regla más ancha que decía que un `HTMLElement.click()` sobre un nodo
  teletransportado no dispara el handler de Vue. Es falsa** — medido: dispara, y el spec
  hermano ya lo venía haciendo. Salió de una observación con dos variables cambiadas a la
  vez y se generalizó sin medir. Queda anotada porque el error no fue de código sino de
  método, y este archivo es el de lo medido.

- [x] ~~**Al fusionar dos líneas del mismo ítem se suma `cantidad` pero no
  `cantidadPresentacion`** (backend, `salones.service.ts`, ramas `match` de `agregarLinea`
  y `existente` de `fusionarCuentas`) — agregar 200 g y después 300 g del mismo ítem deja
  `cantidad = 0.5` (correcto, y el motor cobra sobre eso) pero `cantidadPresentacion`
  sigue en "200 g". El ticket y la pantalla muestran 200 g de algo que se cobra como 500 g:
  el monto es correcto, lo que miente es lo que ve el cliente.~~
  **Cerrado el 2026-08-07.** La regla NO se inventó acá: ya estaba escrita en el spec de
  diseño de presentación (2026-07-16) — *"sumar en canónica y **reescribir** presentación en
  la unidad actualmente visible de esa línea"*. Se implementó eso: la presentación se
  reescribe, nunca se suma, porque la línea puede mostrar `g` y lo que entra venir en `kg`.
  **El frontend ya lo hacía bien**: `desdeCantidadCanonica` (`app/utils/cantidad-presentacion.ts`)
  reescribe al incrementar desde siempre. El desalineado era el backend, que no tenía la
  función inversa. Ahora existe (`presentacionDesdeCanonica`) y las dos se referencian
  mutuamente en sus docblocks, como ya hacía `resolverUnidadBaseDeItem` con su gemela.
  **Difieren a propósito en el fracaso:** el frontend lanza (carrito local, error visible al
  instante); el backend devuelve `null` y deja la presentación como estaba. La razón es **de
  UX, no de integridad**: esto corre dentro de una transacción, así que lanzar haría rollback
  limpio y no dejaría nada a medio escribir. Lo que se evita es que una unidad fuera de
  catálogo o un cruce de magnitudes —estados en los que esa fila ya estaba mal— impidan
  agregar una línea o fusionar una mesa. El precio, asumido: **el fallo es mudo**, queda una
  presentación vieja, que es el bug de esta misma entrada en miniatura.
  (La primera versión de este párrafo decía que abortar "dejaría la venta sin cerrar". Era
  falso —hay transacción— y lo corrigió la revisión.)
  **El N+1 que la fusión invitaba, evitado y con test:** `fusionarCuentas` no tenía los
  ítems a mano, y resolverlos por línea habría sido una query por línea **sosteniendo el
  lock pesimista de la fusión**. Se resuelven en bloque antes del bucle, y solo si alguna
  línea muestra presentación. Mutantes medidos: sacar la reescritura hace que los tests
  fallen mostrando `"200"` —el síntoma literal de la entrada— en las dos puertas; y
  **reemplazar** el batch por una query por línea hace fallar la aserción de "una sola
  query" con 2.
  ⚠️ Dos correcciones de la revisión, las dos por errores de método ya conocidos acá:
  el primer mutante del N+1 **agregaba** una query en vez de revertir al N+1, y el fixture
  tenía **un solo ítem** mergeando —con uno, una query por línea también da 1 y la aserción
  no distingue nada—. El fixture tiene ahora dos ítems distintos.
  Y el `SELECT` que resuelve los ítems **no ejecutaba**: filtraba `eliminado_el` en
  `item_producto`, que no tiene esa columna. Habría roto la fusión entera con un 500
  sosteniendo el lock, en cuanto una línea tuviera presentación. No lo vio el gate porque
  el test mockea `manager.query` y **no hay ningún e2e de `fusionarCuentas`** (anotado en
  `pendientes.md`). Verificado contra la BD viva antes y después del arreglo.
  Nota sobre el texto tachado: dice `cantidad = 0.5`, pero la canónica va en la unidad base
  del ítem (`g`), o sea **500**. Se conserva verbatim y se corrige acá.

- [x] ~~**`grupos-modificadores` convive con un segundo índice único y la red nueva no los
  distingue** (backend, `grupos-modificadores.service.ts`) — `traducirColisionDeNombre`
  revalida **solo el nombre**, pero `uq_grupo_opcion_item_vivo` puede disparar en la misma
  transacción de `create`/`update`. En una doble carrera (uno toma el nombre, otro inserta
  una opción con el mismo `item_id`) el error diría "Ya existe un grupo con el nombre…",
  mandando a renombrar algo que no es la causa. Nunca es peor que el 500 previo, pero el
  propio archivo ya discrimina por `constraint` en `restaurar()`, y `caja.service.ts`
  también: la red nueva introdujo un patrón distinto justo donde había uno.~~
  **Cerrado el 2026-08-07.** El fix es exactamente ese punto: replicar la discriminación por
  `constraint` que `restaurar()` ya hacía, en vez de dejar dos patrones distintos en el
  mismo archivo.
  **Matiz sobre la entrada, razonando sobre el código (no medido con dos clientes reales):**
  la doble carrera que describe necesita **tres** transacciones —una toma el nombre, otra
  inserta la opción, la nuestra pierde contra las dos—, mientras que con el nombre libre
  alcanzan **dos**: ahí `revalidar` no lanzaba y el 23505 se relanzaba tal cual, o sea un
  **500**. El fix cubre los dos caminos; cuál ocurre más seguido en producción no lo sé.
  **Dónde va la distinción, medido y no asumido:** solo en `update()`. Ahí las opciones
  vivas se leen **sin lock** y después se insertan, así que dos updates que agregan el mismo
  item al mismo grupo pasan los dos por el `INSERT`. En `create()` es **inalcanzable**: el
  grupo recién nace y nadie más puede tener una opción bajo ese `grupo_modificador_id`; un
  duplicado dentro del mismo request lo corta antes la validación del service. Ponerlo
  también ahí habría sido código muerto con cara de red.
  `traducirColisionDeNombre` ganó un `soloConstraint` opcional; los otros 7 recursos no lo
  pasan y **su conducta no cambia**, con test propio que lo fija. Mutante medido: quitar la
  distinción hace que el test del service falle mostrando el mensaje real del bug —
  `"Ya existe un grupo con el nombre \"Bebida\""`— en vez del de la opción.

- [x] ~~**Seis mecánicas de contrato y concurrencia**~~ (backend, cerradas 2026-08-07).
  Ninguna necesitaba decisión: se agruparon por eso.
  - **El signo de propina se validaba en uno de tres.** `propinaMonto` cortaba con 400 pero
    `propinaSugerida` y `propinaPorcentajeSugerido` solo tenían `@IsNumberString()`, que
    acepta el menos. No cobran de más —`targetCobro` usa solo el primero— pero se
    persistían en `venta_propina`. Ahora los tres pasan por el mismo chequeo.
  - **`@MaxLength(100)` en `Create`/`UpdateGarzonDto`.** La columna es `VARCHAR(100)` y el
    gemelo `CreateTurnoDto` ya lo tenía: sin él, un nombre largo moría en Postgres con un
    500 en vez de un 400 accionable.
    El `:maxlength="100"` del input **también se puso**. La primera versión de este cierre
    lo omitía argumentando que "ningún input de `configuracion/` lo usa": literal cierto,
    pero la conclusión iba más lejos que el hecho — el repo **sí** tiene el patrón
    (`components/ventas/ItemPersonalizacionDrawer.vue:460`), así que ponerlo es seguirlo,
    no inventarlo. Y la entrada decía "backend + frontend": cerrar solo la mitad y borrar
    el checkbox entero es cómo un pendiente se evapora.
  - **`reclamarComanda` pedía una segunda conexión del pool** con el `FOR UPDATE` tomado.
    Una palabra: pasarle el `manager`. `previewComanda` no está en transacción, así que ahí
    la conexión global sigue siendo inofensiva.
  - **`crear`/`actualizar` de salón y mesa devolvían la entity cruda**, con `tenantId`,
    timestamps y `eliminadoPor`. Ahora tienen `toSalonPublico`/`toMesaPublica`, siguiendo lo
    que `garzones` y `turnos` ya hacían.
    ⚠️ **La entrada decía que "el frontend no lo consume" y es falso**: sí lo consume
    (`configuracion/salones.vue` lee `saved.id`, `saved.nombre` y, en mesa, `posX`, `posY`,
    `forma`, `tamano`). Los campos de la vista curada son exactamente esos, medidos antes de
    tocar; ninguno de los que se sacaron se leía.
  - **`ids.sort()` antes del lock de `fusionarCuentas`.** Seguro barato: **no cierra ningún
    deadlock demostrado** —un solo `SELECT … FOR UPDATE` lockea en orden de plan, igual para
    las dos transacciones— y por eso **no tiene mutante**: no hay conducta observable que
    fijar. Se hizo porque cuesta una línea y saca la pregunta del medio.
  - **El docblock de `traducirColisionDeNombre`** ahora advierte que meter un `await` entre
    `const escritura = …` y el wrapper deja la promesa rechazada sin handler, y Node ≥15
    **mata el proceso**. Es prosa: tampoco tiene mutante.

  **Cuatro mutantes medidos** (los que tienen conducta observable): el signo validado solo
  en `propinaMonto`, `reclamarComanda` por la conexión global, `crearMesa` devolviendo la
  entity cruda, y `CreateGarzonDto` sin `@MaxLength`.
  **Los cuatro mueren por la aserción que el test enuncia, no por un `TypeError`.** No era
  así al principio: los dos primeros morían en un `.map`/`.length` de `undefined` porque el
  mock no devolvía nada, o sea mataban por accidente. El primer arreglo fue poner defaults
  resueltos en el harness, y la revisión midió su **precio**: con `manager.query → []`, el
  mutante que borra `getMesaOrThrow` de `abrirCuenta` pasó de **cazado a sobreviviente**,
  porque el `if (!locked.length) throw` de más abajo tira la misma excepción. Los defaults
  se movieron a los dos tests que los necesitan: los mutantes siguen muriendo por su
  aserción y el de `getMesaOrThrow` vuelve a caer. Quedó en
  [`anti-patterns.md`](anti-patterns.md).

- [x] ~~**Cinco huecos de cobertura del barrido de la auditoría**~~ (backend, cerrados
  2026-08-07). Solo tests: **ningún archivo de producción se tocó**. Los siete mutantes que
  las entradas anotaban pasaban de verdad —los medí antes de escribir una línea— y ahora
  mueren:
  - **`guardarLayout`** no tenía ningún test. Sin el `if (!res.affected) throw`, mover por
    drag&drop una mesa de otro salón actualiza cero filas y la pantalla responde OK.
  - **`GarzonesService.actualizar`** tampoco. Es el único método que mueve `tipo`, que se
    congela en cada sesión y decide el grupo de reparto de propinas.
  - **`buildHistorialFilters`** nunca corría con un filtro puesto: los dos tests llamaban
    con `{}`. Los placeholders arrancan en `$2` porque `$1` es el tenant; con `paramIdx = 1`
    el filtro pisa al tenant y nada explota. Es la misma función donde vive el bug abierto
    del filtro "Hasta".
  - **`activaPorPin`** no se invocaba nunca. Se cubrió además que un PIN inválido **propaga
    el rechazo** en vez de devolver `null`: `null` significa "sin turno abierto", y
    confundirlos hace que la UI ofrezca iniciar turno cuando el PIN está mal.
  - **La personalización de línea** se verificaba con `toHaveBeenCalled()` **sin
    argumentos**, y el mock devuelve un snapshot fijo sin mirarlos: mandar `{}` en vez de lo
    que pidió el mesero pasaba la suite entera. Ahora se afirma con los argumentos.
  - **Tres filtros más** de la entrada de las revisiones: el tenant en el JOIN a `items` del
    detalle, el tenant en la query de ítems eliminados de `cerrarCuenta`, y que
    `loadCatalogoUnidades()` se cargue **fuera** de la transacción (adentro pide una segunda
    conexión del pool con el `FOR UPDATE` tomado).

  **Un matiz que la entrada no distinguía:** hay dos JOIN gemelos a `items` con el mismo
  filtro de tenant. El de la comanda **sí** estaba cubierto; solo el del detalle no. Medido
  mutando cada uno por separado.
  **Los tests sobre SQL van acotados a la cláusula**, no con un `toContain('tenant_id')`
  suelto — ese matchearía el `cl.tenant_id` del `WHERE` y pasaría sin el filtro del JOIN.
  **Un octavo hueco, que ninguna entrada anotaba**, lo encontró la revisión: un test decía
  "lanza NotFound si el garzón no existe **en el tenant**" y solo mockeaba `findOne → null`,
  sin afirmar el `where`. El aislamiento por tenant de `GarzonesService.getOrThrow` —lo que
  decide si se puede editar el garzón de otra empresa— no tenía red. Mutante: `where: { id }`.
  Es la misma clase de defecto que el `toHaveBeenCalled()` pelado: **un título que promete
  más que su aserción**.

- [x] ~~**Los dos N+1 de `salones.service.ts`**~~ (backend, cerrados 2026-08-07 juntos, por
  ser el mismo defecto en el mismo servicio).
  **`listarCuentasDeMesa` — 1 + 3N.** `armarDetalle` disparaba tres consultas y se llamaba
  una vez por cuenta. Ahora existe `armarDetalles(cuentas[])`, que hace las mismas tres para
  N cuentas: las dos auxiliares ya eran batch (`= ANY($1)`), solo faltaba llamarlas una vez
  con las líneas de todas juntas. `armarDetalle` quedó como el caso de una. Es el endpoint
  que el garzón golpea cada vez que abre una mesa.
  **`fusionarCuentas` — M×L, dentro del lock.** Por cada línea de cada origen se consultaba
  el destino. Lo caro no era la latencia sino que corría **sosteniendo el
  `pessimistic_write` sobre todas las cuentas de la mesa**: cada query de más alargaba el
  tiempo en que nadie podía agregar líneas ni cerrar ahí. Ahora son dos lecturas fuera del
  bucle, con el índice del destino **mantenido al día** — la línea que se mueve tiene que
  poder recibir la suma de una igual que venga de un origen posterior; armar el mapa una
  vez y no actualizarlo duplica en vez de acumular.
  **Medido antes de tocar, no estimado:** con 2 orígenes de 1 línea, 4 lecturas de
  `cuenta_lineas`; con 2 orígenes de 10 líneas, **22**. Después: constante en las dos
  dimensiones.
  **Cinco mutantes**, cada uno verificado como aplicado: volver a la tanda por cuenta,
  romper el agrupado por `cuenta_id`, releer las líneas de origen en el bucle, reconsultar
  el destino por línea, y no mantener el índice al día.
  **Un error propio que el mutante encontró:** el primer test medía el costo variando solo
  las líneas, y el mutante "leer las líneas de origen dentro del bucle" **sobrevivía** — el
  N+1 tenía dos dimensiones y el test cubría una. Quedó en
  [`anti-patterns.md`](anti-patterns.md).
  **Una línea que se sacó a conciencia:** preservar "la primera gana" cuando el destino
  trae dos líneas con la misma clave. Ningún mutante la mataba, el estado no lo produce
  `agregarLinea` (mergea), y sumar sobre cualquiera de las dos da el mismo total de cuenta.

- [x] **Fin de turno con mesas abiertas: avisar y ofrecer transferir** (backend +
  frontend, decidido y cerrado el 2026-08-06) — cobrar una cuenta exige que su
  **responsable** tenga sesión abierta, porque la propina se atribuye a esa sesión. Ni
  `cerrarPorPin` ni `cerrarAdmin` miraban si el garzón dejaba cuentas abiertas, así que
  el que marcaba salida con una mesa abierta la dejaba imposible de cobrar hasta que
  alguien la transfiriera. **No hace falta ninguna carrera: es el martes normal de un
  restaurante.** (La lente lo reportó como una carrera entre `assertSesionAbierta` y la
  transacción de `abrirCuenta`; agrandarlo al caso sin carrera fue del refutador.)
  **Forma elegida por el owner:** el cierre **no** se bloquea —el garzón se va igual, y
  bloquearlo solo dejaría la sesión abierta contando horas—; los dos cierres devuelven
  `cuentasPendientes[]` y la UI ofrece transferirlas a alguien en turno. Aceptar es
  opcional: "cuenta sin responsable en turno" es un estado válido y reversible.
  **Cómo se cerró:** `SesionCerrada = SesionPublica + cuentasPendientes`, resuelto con
  **una** query (`LEFT JOIN` a `mesas`/`salones`: una cuenta abierta sobre una mesa
  borrada es la que más urge no perder de vista) que corre en paralelo con `cargarNombres`.
  Va por SQL crudo dentro de `turnos` y no delegada a `SalonesService` porque la
  dependencia entre módulos corre al revés. En el frontend, dos modales gemelos —PIN en
  Salones, select de garzones **en turno** en el backoffice— sobre el composable
  `useTransferenciaPendientes`, que transfiere cuenta por cuenta y **corta en el primer
  error**: los errores de este flujo son del destinatario, no de una cuenta puntual, y
  seguir solo repetiría el mismo mensaje N veces.
  **Lo que salió de paso, y no era cosmético:** al declinar la oferta, cobrar esa mesa
  daba *"El garzón no tiene una sesión de trabajo abierta"* — y Salones usa esa frase
  como señal para abrir el modal de entrar a turno, así que mandaba al **cajero** (que sí
  estaba en turno) a iniciar un turno que ya tenía, y el reintento fallaba igual: un
  callejón sin salida. Ahora `cerrarCuenta` usa `buscarSesionAbierta` (devuelve `null` en
  vez de tirar) y lanza su propio mensaje, que nombra al responsable y dice qué hacer.
  **Lo que fija cada cosa:** el mutante que revierte el mensaje al genérico rompe el test
  —que asevera las dos mitades: que dice "ya no está en turno" y que **no** dice "sesión
  de trabajo"—; sacar `AND c.garzon_responsable_id = $2`, cambiar `LEFT JOIN` por `JOIN` y
  sacar el `eliminado_el IS NULL` de un join matan un test cada uno. En el frontend, sobre
  la pantalla del backoffice: no abrir el modal mata 4. Sobre el composable: no chequear la
  identidad del lote, abrir siempre en `reabrirSiQuedan` y sacar el guard de reentrancia
  matan uno cada uno.
  **Un mutante también delató el propio spec:** dos tests fallaban de más porque los
  modales se teletransportan al `body` y los toasts viven fuera del wrapper, así que
  `dialogo()` podía devolver el modal del test anterior. Se limpia el `body` en cada
  `beforeEach` — sin eso, un verde puede no estar probando nada.
  **La revisión independiente encontró dos defectos de runtime que ningún test veía**, y
  los dos eran del gemelo de Salones, el único sin spec: cancelar el teclado de PIN dejaba
  las cuentas vivas en memoria con la oferta **imposible de reabrir** (un toque accidental
  y el garzón se iba con las mesas a su nombre), y `pendientes.value = restantes` en el
  `finally` podía pisar una oferta más nueva —con el modal cerrado durante el vuelo, la
  pantalla queda operable y se puede cerrar otra sesión— dejando el nombre de un garzón
  con la lista de otro. El arreglo de los dos fue **extraer el bucle al composable**: no
  por deduplicar (dos copias son aceptables acá) sino porque dentro de una pantalla de
  1.400 líneas con cinco stores no había forma de probarlos. `GarzonPinModal` solo avisa
  cuando el PIN es válido, así que el `solicitarPin` de Salones ganó un hook de cancelación
  —un `watch` sobre el cierre del modal, que en el camino feliz ya no encuentra hook porque
  el componente emite `confirm` antes de cerrarse.
  **El camino por PIN se verificó en el navegador** (no tiene spec de página): el modal
  aparece con la cuenta bien etiquetada; transferir a alguien fuera de turno deja el toast
  del backend, reabre la oferta y —esto es lo que se estaba arreglando— **no** abre el modal
  de entrar a turno; y transferir a alguien en turno deja la cuenta a su nombre.
- [x] **El gate del frontend era cara o cruz bajo carga** (cerrado 2026-08-06, salió al
  agregar el spec de arriba) — montar un entorno Nuxt entero pasa de ~300ms a varios
  segundos cuando la máquina está ocupada, y los dos timeouts default de vitest quedaban
  cortos. Se manifestaba de dos formas distintas, y **la primera es la peligrosa**:
  - **`beforeAll` (default 10s)**: al expirar, vitest reporta los tests de ese archivo como
    *skipped*. La corrida sale roja (`Test Files 4 failed`, exit ≠ 0), pero **el contador
    miente**: `566 passed | 25 skipped` con **0 failed**. Cuatro archivos evaporados sin un
    solo test en rojo. Tres de los cuatro eran preexistentes (`useImpresoras`,
    `usePermisosCrud`, `middleware/permiso`).
  - **`testTimeout` (default 5s)**: `mountSuspended` de una página no alcanza a resolver.
    Medido con el compose arriba: 15 tests de 11 archivos en `Test timed out in 5000ms`,
    todos de pantallas que el diff no tocaba, y verdes al correr la suite sola.

  `hookTimeout: 60_000` + `testTimeout: 20_000`. Tres corridas seguidas 591/591 bajo la
  misma carga que antes las volteaba. **Por qué se arregló acá y no se anotó al backlog:**
  un gate que depende de cuán ocupada está la máquina no sirve para decidir si una tarea
  está terminada, que es exactamente para lo que se lo corre.

- [x] **Una línea agregada durante el cierre no se cobraba ni llegaba a cocina**
  (backend, `salones.service.ts`) — **severidad alta, y la vieron dos lentes
  independientes** (dinero/Decimal y concurrencia) por separado, con intercalados
  distintos. `agregarLinea`, `actualizarLinea` y `quitarLinea` validaban el estado de la
  cuenta con un `SELECT` plano y escribían **fuera de toda transacción**. Un `SELECT` sin
  lock no espera al `FOR UPDATE` de `cerrarCuenta`, así que veían la cuenta como abierta
  durante **todo** el cierre —que incluye armar la venta entera, la operación más lenta
  del sistema— y la línea se colaba en una cuenta que quedaba cerrada un instante después.
  Esa línea **no se cobraba** (la venta ya estaba armada sin ella) **y tampoco llegaba a
  cocina**, porque `previewComanda` y `reclamarComanda` exigen `abierta`: quedaba invisible
  para todos.
  **Cómo se cerró:** las tres leen la cuenta con `pessimistic_write` y escriben en la
  misma transacción. `getCuentaAbiertaOrThrow` (sin lock) tenía exactamente esos 3
  llamadores, así que se convirtió en `getCuentaAbiertaConLock` en vez de dejar el viejo
  como código muerto. El catálogo de unidades y la personalización se resuelven **fuera**
  del lock; lo que sí necesita leerse adentro va con el manager de la transacción.
  **Mutantes medidos:** quitar el `lock` mata 3 tests; quitar el `, manager` de
  `armarDetalle` mata 2; quitar `syncPresentacionLegado: true` mata 1; revertir el service
  a `HEAD` mata 7.
  **Cerró de paso dos huecos de test:** `actualizarLinea` y `quitarLinea` no tenían **un
  solo test** —lo encontró la lente de tests con su mutante— y son justo los dos métodos
  donde vive este bug.
  ⚠️ **La revisión independiente bloqueó dos veces, y las dos tenía razón.** Primero: el
  fix **introdujo** un double checkout de conexión —tres lecturas salían por
  `this.dataSource` desde dentro de los callbacks, o sea pidiendo una segunda conexión del
  pool con el `FOR UPDATE` tomado—. Antes no existía porque no había transacción. Se cerró
  pasando el `runner`, y de yapa le sacó el mismo problema a `cancelarCuenta`,
  `fusionarCuentas` y `cerrarCuenta`, que ya pasaban el manager a `armarDetalle`.
  Segundo: un mutante sobreviviente medido —quitar `manager` de `armarDetalle` en dos de
  las tres mutadoras dejaba **65/65 en verde**— porque los tests nuevos no afirmaban nada
  sobre el detalle devuelto y el mock decidía el resultado.
  ⚠️ **Y el propio ciclo de revisión produjo un autogol:** al pedir que el 404 afirmara el
  mensaje, cambié `toThrow(NotFoundException)` por `toThrow(/regex/)` — y `toThrow(regex)`
  **no verifica la clase**, así que dejé de comprobar que el 404 siguiera siendo 404. Lo
  detectó el mismo revisor en la segunda vuelta y lo marcó como "lo introdujo el cambio
  que yo pedí". Ahora los dos afirman clase **y** mensaje.
  Commit `f504c194`.

- [x] **Borrar un ítem del catálogo dejaba la mesa imposible de cobrar, con la línea
  invisible** (backend + frontend, `salones` + `items`) — **severidad alta.**
  `armarDetalle` filtraba `i.eliminado_el IS NULL` en su JOIN, así que la línea
  **desaparecía de la pantalla**; pero `cerrarCuenta` lee las `cuenta_lineas` crudas y se
  las mandaba a `crearEnTransaccion`, que explotaba con "Item no encontrado". El garzón no
  podía cobrar **ni corregir**, porque no tenía el `lineaId` de algo que no se renderizaba.
  Nada impedía el borrado: `obtenerUsoItem` miraba `receta_ingredientes`,
  `combo_componentes`, `grupo_modificador_opciones` y `receta_extras_permitidos` — **nunca
  `cuenta_lineas`**.
  **Las dos mitades, decididas por el owner:** (1) `obtenerUsoItem` suma una rama
  `'cuenta'` que bloquea el borrado y va **primero** en el mensaje, porque los otros cuatro
  usos son de catálogo y el admin los resuelve cuando quiera, pero una cuenta abierta tiene
  a alguien esperando en la mesa; acota por `estado = 'abierta'` —sin eso una cuenta ya
  cerrada volvería el ítem inborrable para siempre— y por el borrado de la línea, la cuenta
  y la mesa. (2) El detalle muestra la línea marcada (`itemEliminado`) y `cerrarCuenta`
  corta con un 400 que **nombra** el ítem.
  **En el frontend**, una cuenta así no se puede cotizar (el motor resuelve contra el
  catálogo vivo y devuelve 404): el total muestra `—` en vez de un `$0` falso, un aviso lo
  explica, y cobrar e imprimir precuenta quedan deshabilitados. ⚠️ Las líneas **no** se
  filtran de la entrada del cálculo a propósito: `AdvertenciasPrecio` indexa
  `resultado.lineas[i]` contra las líneas de la pantalla, así que filtrar la entrada las
  desfasa — que es justo el desfase que ya está anotado en `pendientes.md`. El primer
  intento de fix fue ese y se descartó por eso.
  **Índice `idx_cuenta_lineas_item`:** la rama nueva corre en cada `DELETE /items/:id` y en
  cada `GET /items/:id/uso` —que el frontend dispara antes de abrir el modal— sobre una
  tabla que crece con cada producto pedido en la historia del tenant. Postgres no indexa
  las FK por su cuenta.
  ⚠️ **El test unitario de la rama nueva no probaba lo que decía.** Un `toMatch` sobre un
  string de SQL mide **presencia de un literal, no semántica**, y la revisión midió dos
  mutantes que sobrevivían: sacar `cl.item_id = $1` —que vuelve inborrable **todo** el
  catálogo del tenant— y `estado = 'abierta' OR TRUE`. Se cerró con un **e2e** que monta
  sesión de garzón + cuenta + línea contra Postgres real (`recetas.e2e-spec.ts`, test 12)
  y mata los dos, medido con `reset-db.sh` antes de cada corrida. Ese e2e empieza a cerrar
  el hueco de "no existe ningún e2e de salones".
  ⚠️ **Alcance real del e2e, dicho en su propio comentario:** usa **cancelada** como proxy
  de "ya no está abierta". El caso que la doc describe es la cuenta **cerrada**, que exige
  caja abierta + pagos. Un mutante quirúrgico `OR c.estado = 'cerrada'` sobrevive.
  Commit `853c16b3`.

- [x] **La comanda seguía escondiendo el ítem borrado: el fix anterior estaba a medias**
  (backend, `salones.service.ts` → `sqlLineasComanda`) — **lo encontró la revisión
  independiente, ninguna lente lo vio**, y es el hallazgo más valioso de la pasada porque
  demuestra que el fix de arriba **movía el bug de lugar en vez de matarlo**:
  `armarDetalle` dejó de filtrar pero `sqlLineasComanda` —que alimenta `previewComanda` y
  `reclamarComanda`— seguía con su `INNER JOIN` filtrado. La línea dejaba de ser invisible
  en la pantalla y pasaba a serlo **en el ticket de cocina**: "Enviar a cocina" respondía
  OK, `cantidad_enviada` no avanzaba nunca, y el plato no se cocinaba.
  **La regla, ahora escrita en `docs/features/salones-mesas.md`: un plato ya pedido hay
  que cocinarlo**, lo haya sacado o no el admin de la carta mientras tanto.
  **Mutante medido:** volver a poner el filtro mata 1 test. Y un segundo mutante que la
  revisión midió sobreviviendo —inyectar el filtro **solo** en el string concatenado de
  `reclamarComanda`, que es el que realmente reclama y avanza `cantidad_enviada`— se cerró
  con una aserción propia en el test de ese método.
  ⚠️ **El smoke en navegador destapó algo que ningún test podía:** **ningún ítem del seed
  tiene una categoría con impresora activa**, así que `agruparEstacionesComanda` devuelve
  siempre `[]` y hubo que cablear una a mano por SQL para poder verificar. Queda anotado
  como hueco en `pendientes.md`.
  Commit `853c16b3`.

### Lección de método que dejó esta pasada

**Una medición de mutante puede dar señal falsa.** La primera vez que medí los mutantes del
e2e obtuve "1 failed" con la mutación **no aplicada**: el `perl -pe` no matcheaba a través
de saltos de línea, y lo que fallaba era un test que depende del stock acumulado del seed
en corridas locales repetidas. Estuve a un paso de contar ruido como señal. Desde entonces,
cada medición va con `reset-db.sh` antes y con `-t` acotado al test, y se verifica que la
mutación se aplicó (contando ocurrencias) antes de leer el resultado.

---

## Colisión de nombre en `create()`/`update()` — ya no es un 500 (2026-08-06)

- [x] **`create()`/`update()` de los 8 con nombre único devolvían 500 si perdían
  la carrera** (backend, transversal) — los 8 pre-consultan el nombre y después
  escriben; entre esas dos sentencias otra transacción puede tomarlo, y ahí el
  índice único rechazaba con `23505` que nadie traducía. El índice hacía su trabajo
  —**nunca quedan dos filas vivas con el mismo nombre**— pero quien perdía la
  carrera veía un 500 en vez del 409/400 amable. `restaurar()` ya lo traducía en
  los 8; esto es la misma red para las otras dos puertas.
  **Verificado antes de tocar nada:** los 14 services que mencionan `23505` lo
  traducen **solo** dentro de `restaurar()`. La entrada era exacta.
  **Cómo se cerró:** `traducirColisionDeNombre` en
  `common/utils/nombre-sugerido.util.ts` (16 sitios: la convención dice extraer a
  la tercera), aplicado a create+update de los 8. Dos decisiones que no son
  obvias:
  - **Toma la escritura ya en vuelo, no un thunk.** Con thunk había que
    re-indentar el cuerpo de cada transacción y el diff eran 16 reformateos que
    esconden el cambio real. No hay ventana de unhandled rejection porque el
    wrapper es la sentencia inmediatamente siguiente; si alguien mete un `await`
    en el medio, sí la habría.
  - **En el `catch` re-corre la validación que el módulo ya tiene**, en vez de
    inventar un mensaje. Así el error es exactamente el que el usuario habría
    visto sin la carrera —y cada módulo conserva su propio código: `turnos` tira
    409 y los demás 400—. Si al revalidar el nombre está **libre** (el competidor
    abortó, o el `23505` vino de otro índice único) se relanza el original en vez
    de mandar a renombrar algo que no es la causa.
  **Los 8 resultaron tener tres formas de escribir**, no una: transacción
  (`descuentos`, `recargos`, `grupos-modificadores`, `motivos-diferencia-inventario`
  en update), `repo.save()` (`turnos`, `cajones`) y SQL crudo con `RETURNING`
  (`causas-merma`, `motivos-diferencia`, y el create de `motivos-diferencia-inventario`).
  **Cobertura, decidida explícitamente:** la semántica del helper vive en
  `nombre-sugerido.util.spec.ts` (qué se traduce y qué no), y el **cableado** se
  fija con **una forma por test, no un test por módulo** — `descuentos`
  (transacción), `turnos` (`repo.save`), `causas-merma` (SQL crudo). Las otras 5
  puertas quedan verificadas por revisión, no por test: replicarlas sería 10 tests
  de plomería que vuelven a probar el mismo helper.
  **Mutantes medidos:** borrar el guard `code !== '23505'` mata 3; sacar la red de
  un `update` mata 1; revalidar un nombre fijo mata 1; revalidar con el
  `exceptoId` equivocado mata 1; sacar la red de un `create` de SQL crudo mata 1.
  ⚠️ **Dos aserciones tuvieron que reescribirse porque no podían fallar:** el
  pre-chequeo y la revalidación pasan por la MISMA query, así que
  `toHaveBeenCalledWith({ nombre })` lo satisfacía el pre-chequeo solo y dejaba
  pasar un mutante que revalidara otro nombre. Hay que leer los dos valores en
  orden (`['Black Friday', 'Black Friday']`). Lo mismo con `exceptoId`.
  ⚠️ **Y un test era un recibo falso:** "no toca los errores que no son 23505"
  pasaba con el guard borrado, porque con el nombre libre igual salía el error
  original. Lo delata forzar el nombre **tomado** al revalidar. Lo encontró la
  revisión independiente midiendo el mutante, no la escritura del test.

---

## Papelera — salida de la colisión al restaurar (2026-08-01)

- [x] **Los 8 recursos con unicidad de nombre proponen un nombre libre.** El 400
  decía qué pasaba pero no daba salida: para restaurar, el usuario tenía que ir a
  renombrar a mano la fila viva que le ocupaba el nombre. Decisión del owner:
  el backend sugiere y la pantalla lo ofrece **editable**, con el número al final
  empezando en 2. Cerrado en dos formas según cómo la tabla enforcea la unicidad:
  - **Los 3 sin índice** (`descuentos`, `recargos`, `turnos`) consultan los
    nombres tomados antes de intentar.
  - **Los 5 con índice único parcial** (`cajones`, `causas-merma`,
    `motivos-diferencia`, `motivos-diferencia-inventario`,
    `grupos-modificadores`) la calculan **dentro del `catch` del `23505`**. La
    entrada de backlog planteaba esto como una decisión abierta ("consultar antes
    vs calcular en el catch") y **resultó no serlo**: con un índice el `catch`
    hace falta igual —entre consultar y escribir otra transacción puede tomar el
    nombre—, así que pre-consultar agrega una query en todos los restaurar y no
    permite sacar el bloque. Queda dominada. Se verificó además que ninguno de
    los 5 envuelve el restaurar en una transacción explícita, o sea que el fallo
    no deja una transacción abortada y las queries del `catch` funcionan.
  **Lo que casi se copia mal:** 3 de las 5 tablas indexan por `lower(nombre)` y
  no por `nombre` (medido con `pg_indexes`, no asumido). Sin eso la sugerencia
  habría devuelto un nombre que la base considera tomado, y el usuario habría
  recibido **el mismo 400 después de confirmar el modal**. Lo fija un e2e contra
  Postgres real (`causas-merma: la sugerencia respeta que el índice es
  case-insensitive`), que es el único lugar donde el `ILIKE` se prueba de verdad:
  los unit tests usan mocks sin índices.
  **Y dos colisiones quedaron SIN sugerencia a propósito**, porque renombrar no
  las resuelve: `garzones` (placeholder Mostrador) y la rama
  `uq_grupo_opcion_item_vivo` de `grupos-modificadores`. Esta última tiene test
  propio con ancla positiva: el mensaje habla de la opción y el cuerpo **no**
  trae `nombreSugerido`.

- [x] **`DESCUENTO_CONFIG` no tenía entrada para `directo`** (frontend) — el tipo
  de descuento más básico no mostraba ni modo ni valor en el drawer: `config`
  quedaba `null` y los campos simplemente no se renderizaban. No lo veía nada —
  el mapa es un `Record<string, …>`, así que la clave faltante no es error de
  tipos, y el consumidor la traga con `?? null`. Se encontró **a mano**, haciendo
  el smoke de la papelera de descuentos. Cerrado con la entrada y con
  `reglas-form-config.spec.ts`, que compara las claves de los dos mapas contra la
  lista de códigos del seed; el mutante (borrar la entrada `directo`) lo pone
  rojo. ⚠️ El guard es un **espejo a mano**: caza que se borre una clave, no que
  el seeder gane un código nuevo — backend y frontend son proyectos separados y
  un test de uno no lee archivos del otro. Por eso el seeder lleva ahora un
  comentario que lo recuerda. **Medido de paso: `RECARGO_CONFIG` no tenía el
  mismo hueco** (cubre los 5 códigos de recargo), así que la sospecha que la
  entrada dejaba abierta se cierra en negativo.

---

## Descuentos y recargos — todo expresa su monto (2026-08-01)

- [x] **Decisión del owner: un descuento sin valor no sirve para nada.**
  *"O es un valor en porcentaje o monto fijo"*. Al implementarla aparecieron
  **cuatro** puertas al mismo estado, las cuatro verificadas ABIERTAS contra la
  API real (curl con token de tenant) antes de tocar código:
  1. **`create()` no exigía valor a `directo`** —el tipo de propósito general—
     porque no estaba en ninguna lista del validador. Devolvía 201 con
     `valor: null`. Era el hueco que la entrada de backlog describía.
  2. **`update()` dejaba VACIARLO por `PATCH`**, y esto NO era exclusivo de
     `directo` ni de descuentos: un `{ "valor": null }` respondía **200** y
     dejaba sin monto una promoción del 15% y sin tasa un interés del 5% —
     entrada directa del motor de precios. El validador de update solo miraba
     la forma del valor cuando venía truthy, así que el `null` pasaba de largo.
  3. **Cambiar el `tipoReglaId` por `PATCH` a un tipo que exige valor**, sobre
     una fila que no lo tiene (un `por_mayor` guarda el monto en `tramos` y su
     `valor` es nulo): 200, y quedaba un `directo` sin importe.
  4. **El mismo camino al revés**: cambiar a un tipo por tramos sin mandarlos
     dejaba un `por_mayor` con CERO tramos. También 200.

  La segunda no estaba en el backlog: apareció al preguntarse "¿por dónde más
  se llega a este estado?". La tercera la encontró la revisión independiente, y
  es la que más enseña: **el primer fix tapaba las puertas una por una, y esta
  pasaba igual** porque el guard solo miraba `dto.valor` y ese camino no lo
  manda. La cuarta salió al reproducir la tercera y probar la simétrica.
  **La lección vale más que el fix:** validar EL CAMPO QUE LLEGA es la
  abstracción equivocada. Cambiar el tipo cambia qué campos hacen falta, así que
  hay tantas puertas como pares (tipo viejo, tipo nuevo) — taparlas de a una no
  termina nunca. Lo que se valida ahora es **el estado con el que la fila
  queda** (`validarEstadoResultante`), y con eso las cuatro se cierran de una.
  **Alcance:** la regla del owner era sobre descuentos; en `recargos` se aplicó
  la que ese módulo **ya tenía en `create()`** (los 5 tipos exigen valor), no
  una nueva — era su propio `update()` el que la contradecía.
  Cerrado con las listas a nivel módulo (`TIPOS_CON_VALOR_UNICO`,
  `TIPOS_CON_TRAMOS`, `TIPOS_CON_METODOS`) compartidas por los dos validadores,
  para que no puedan volver a discrepar. Lo fijan 7 unit tests con sus mutantes
  (sacar `directo` de la lista; sacar la llamada a `validarEstadoResultante`,
  que pone rojos 3) y `test/reglas-valor.e2e-spec.ts`, el único que ejercita el
  `ValidationPipe` real — que es justo por donde entraba el `null`.
  Las cuentas de tramos/métodos solo se consultan cuando el tipo resultante las
  exige y el `PATCH` no las trae: una query puntual, nunca una por fila.
  **Lo destapó el e2e existente:** al exigir valor, 6 tests de `papelera`
  empezaron a fallar porque sus fixtures creaban `directo` sin importe. Eso es
  la prueba de que el cambio muerde.

---

## `grupos_modificadores` — el índice de dev enforzaba otra regla (2026-08-01)

- [x] **Mal diagnosticado primero, y esa es la parte que vale.** La entrada de
  backlog decía que "el índice y el código no se ponen de acuerdo": el índice
  case-sensitive, `assertNombreLibre` con `LOWER(...)`. **Falso.**
  `startup-pos.sql:629` ya declaraba el índice sobre `LOWER("nombre")`, de
  acuerdo con el código. Lo que yo había medido con `pg_indexes` era el índice
  **de dev**, que creaba `synchronize` a partir del `@Index` de la entity — y
  TypeORM no sabe expresar una función en `@Index`. La propia entity lo decía
  en un comentario anterior a esta sesión, calificándolo de "discrepancia
  dev/prod menor y aceptada".
  No era menor: **el `restaurar()` de la papelera no pasa por
  `assertNombreLibre`**, así que en dev el único guard del lado del motor era el
  equivocado. Restaurar "Extras" con un "extras" vivo pasaba — verificado con el
  mutante, que pone rojos los dos tests nuevos.
  Cerrado sacando el `@Index` de la entity y creando el índice en el seeder con
  SQL cruda, **mismo patrón que `causas_merma` y los dos `motivos_diferencia`**,
  cuyas entities tampoco lo declaran por esta misma razón. El `DROP` es
  condicional (solo si el existente no es el de `lower()`), así que en una base
  ya correcta no hay churn.
  Lo fijan dos e2e: la **forma** del índice (`pg_indexes`, patrón ya usado en
  `caja.e2e-spec.ts`) y la **conducta** que depende de él (restaurar con
  colisión que solo difiere en mayúsculas → 400 con `nombreSugerido`).
  ⚠️ Dato para el próximo que toque esto: **el seeder es auto-reparador**.
  Volver a poner el `@Index` NO reintroduce el bug, porque `synchronize` corre
  antes que el seeder y el `DROP` condicional lo corrige. La pieza que sostiene
  la regla es el bloque del seeder, no la ausencia del decorador — el primer
  mutante que probé (devolver el `@Index` solo) pasó en verde y por eso hubo que
  buscar el mutante real.
  **Y una lección de método:** la primera medición de "cuáles comparan sin
  mayúsculas" grepeaba `lower(nombre)` sobre el archivo entero y matcheó
  **comentarios** —incluido uno mío—, dando que `cajones` era case-insensitive
  cuando no lo es. Medir el mecanismo en vez de la conducta, otra vez.
  **Contrapartida asumida:** sin el `@Index`, en dev `synchronize` puede dejar
  la tabla sin índice hasta que el seeder lo recree, así que la red del
  constraint pasa a ser que el seeder corra y no falle. Mismo perfil que ya
  tienen los otros tres recursos case-insensitive; no es riesgo nuevo, pero
  ahora aplica a un caso más.

---

## Deuda de código (harness)

- [x] ~~**El bloque de pausa está triplicado verbatim en las tres pantallas de
  configuración**~~ (frontend, cerrado 2026-08-07) — extraído a
  [`usePausaRegla()`](../../frontend/app/composables/usePausaRegla.ts) y al componente
  [`CrudPausarModal.vue`](../../frontend/app/components/crud/CrudPausarModal.vue).
  `descuentos.vue` −86 líneas, `recargos.vue` −86, `impuestos.vue` −78; los dos archivos
  nuevos suman 179.
  **El bloqueo que anotaba la entrada ya no aplicaba.** Decía que no se hizo porque "hoy
  no existe un composable compartido entre esas tres pantallas: extraerlo es introducir un
  patrón nuevo". `useTransferenciaPendientes()` lo introdujo en `15bce45f` y pasó revisión,
  así que esto fue **seguir** un patrón, no inventarlo.
  **Dos cosas que la entrada decía mal**, medidas antes de tocar: son **5 refs** más el
  `Set` de `toggling`, no "4 refs"; y el bloque **no es idéntico en las tres** — `impuestos`
  tiene un guard propio (`origen === 'sistema'`) que descuentos y recargos no tienen. Ese
  guard **se quedó en su pantalla**: es regla de impuestos, no de pausar. El composable no
  lleva un hook `puedePausar` opcional justamente para que no exista la forma de olvidárselo
  en silencio.
  **La red ya existía**: 6 tests de pausa por pantalla, los mismos 18 en las tres, que
  montan la página real. Tres mutantes sobre el composable —reactivar sin atajo, cero ítems
  abriendo modal igual, pausar a ciegas cuando falla el uso— **matan en las tres a la vez**,
  y cambiar el copy del modal compartido también.
  **Un hueco que la extracción reveló y se cerró:** el revert del update optimista cuando
  el `PATCH` falla **no lo cubría ningún test**, en ninguna de las tres. Con el código en un
  solo lugar, cubrirlo costó un test en vez de tres — el cuarto mutante (borrar el revert)
  lo mata **ese test y solo ese**, que vive en `descuentos`.
  **Lo que sigue sin test, declarado:** el guard `origen === 'sistema'` de `impuestos`. El
  switch no se rinde para esas filas (`v-if` en la tabla), así que la línea es inalcanzable
  por UI — defensa en profundidad por si alguien saca ese `v-if`. Ya era así antes; sacarla
  habría sido cambiar conducta fuera del alcance de un refactor.

- [x] ~~**Los mapas de estado de venta están duplicados en 4 `.vue`**~~ (frontend) —
  cerrado 2026-07-30 con [`useEstadoVenta()`](../../frontend/app/composables/useEstadoVenta.ts),
  consumido por `pages/ventas/index.vue`, `components/ventas/VentaDetalleDrawer.vue`,
  `pages/pagos/index.vue` y `components/pagos/PagoDetalleDrawer.vue` (−84 líneas). Las
  cuatro copias de `estadoColor`/`estadoLabel` eran **byte-idénticas**: no había drift que
  reconciliar, la extracción fue mecánica.
  **Lo que arregla de verdad no es la duplicación, es que las opciones del filtro dejaron
  de escribirse a mano.** Ventas y pagos armaban su `estadoOptions` repitiendo la lista de
  estados, y esa lista viaja al backend, donde `@IsEnum(EstadoVenta)` la valida: una opción
  de más no falla al escribirla, falla con un 400 al elegirla en producción —fue lo que
  pasó con `borrador`—. Ahora `estadoOptions` se **deriva** del mapa de etiquetas, así que
  no puede ofrecer un estado que no esté mapeado; y los mapas son `Record<EstadoVenta, …>`
  completos, así que sumar un estado a la unión no compila hasta darle color y etiqueta.
  Verificado contra el backend: las 4 claves son exactamente el enum `EstadoVenta`, y
  `/pagos` filtra por `ventaEstado` validado contra **ese mismo** enum — por eso es un solo
  concepto y el composable se llama `useEstadoVenta`, no `useEstadoPago`.
  **Fuera de alcance a propósito:** órdenes, propinas y suscripciones tienen funciones con
  el mismo nombre en sus pantallas, pero son enums distintos (`creada/en_proceso/…`,
  `borrador/confirmada/anulada`, `activa/pausada/cancelada`), no copias de este.
  Lo fijan 6 tests con **tres mutantes muertos**: (a) volver `estadoOptions` a la lista
  escrita a mano con `borrador` —el bug histórico— pone en rojo el test de opciones;
  (b) rotular las opciones a mano hasta que deriven de las etiquetas (`'Pagada parcial'`
  vs `'Parcial'`) pone en rojo el de consistencia badge↔filtro; (c) colapsar el color de
  `pagada_parcial` al fallback `'neutral'` pone en rojo el de colores —chequeado a
  propósito, porque un test que afirma el valor por defecto queda verde con el bug adentro.
- [x] ~~**Código SSR inalcanzable en `auth.ts` y `tenant.ts`**~~ (frontend) — cerrado
  2026-07-30 **con confirmación explícita del owner**, que hacía falta porque `tryRefresh`
  es el flujo de refresh token y la invariante 4 dice que el sistema JWT no se modifica sin
  ella. Con `ssr: false` ([ADR-017](../adr/017-spa-sin-ssr.md)) `import.meta.server` nunca
  es verdadero, así que se fueron: el par `serverApiUrl`/`resolvedApiUrl` de las dos stores
  —que además leían una `runtimeConfig.apiUrl` privada que ya no existe— y la rama SSR de
  `tryRefresh()`, con su reenvío de cookie (`useRequestHeaders`) y su propagación de
  `Set-Cookie` (`appendResponseHeader`). `resolvedApiUrl` pasó a llamarse `apiUrl`: el
  "resolved" nombraba una resolución entre dos candidatos que ya no existe.
  **Lo único que había que conservar del borrado era `credentials: 'include'`** —sin él el
  navegador no manda la cookie httpOnly del refresh y la sesión muere con un 401 sin
  explicación—, y no lo fijaba ningún test: `$fetch` está mockeado y los options se
  ignoraban. Ahora sí, con mutante (sacarlo pone el test en rojo).
  ⚠️ **El borrado rompió dos tests que no tocaban el tema, y eso destapó algo peor.** Al
  reemplazar `const config = useRuntimeConfig()` quedaron huérfanas cuatro referencias a
  `config` en `login`, `register` y `logout`: el `ReferenceError` caía en el `catch` y
  devolvía el mensaje genérico. Los dos tests que fallaron esperaban el mensaje del
  backend; los dos que verifican "no filtrar la URL del backend" **siguieron pasando por la
  razón equivocada**, porque el genérico es justo lo que esperan. Lección: un test verde
  después de un refactor no prueba que el camino siga vivo si su aserción es "sale el
  mensaje por defecto".
  **Verificado en navegador contra el stack real**, que es lo único que prueba de verdad un
  cambio en el refresh: con la cookie `access_token` borrada a mano, navegar a `/cajas`
  restauró la sesión —token nuevo en la cookie— y la pantalla cargó sin rebotar a `/login`.


- [x] ~~**Dos de las tres carreras "leer para validar, escribir sin lock"**~~ (backend,
  `items.service.ts`) — cerradas 2026-07-30. La tercera (`remove()`) sigue abierta en
  [`pendientes.md`](pendientes.md), re-diagnosticada: la entrada original decía que
  `remove()` "no es transaccional" y **era falso** —abre `dataSource.transaction()` y el
  chequeo corre adentro—; lo real es que ese `SELECT` no toma lock, así que es un phantom
  y el arreglo no es envolver en transacción sino bloquear el ítem referenciado en
  `remove()` **y** en cada camino que crea una referencia. Es una tarea propia.
  Las dos cerradas:
  - **El guard de `modo_inventario` leía `item_producto` sin `FOR UPDATE`** mientras
    `registrarMovimiento` sí lo toma sobre la misma fila (`inventario.service.ts`). No se
    serializaban: el modo podía cambiar con un movimiento recién escrito debajo, quedando
    bajo un modo que nunca lo admitió. Ahora la lectura toma el mismo lock.
  - **`item_receta.costo_actual` tiene dos escritores** —`update()` al reemplazar
    ingredientes y `aplicarDesfases()`— y ninguno bloqueaba. Los dos parten de los mismos
    ingredientes, así que el que commiteaba segundo pisaba el costo del otro con uno
    calculado sobre una lista que ya no era la de la receta.
    El lock va **antes de leer los ingredientes**, no antes de escribir: tomarlo después
    deja la misma ventana entre la lectura y el lock.
    ⚠️ **El primer intento introdujo un deadlock, y lo cazó la revisión independiente, no el
    gate.** El lock estaba puesto junto al costeo, que en `update()` corre **después** del
    `UPDATE items`: quedaba `items → item_receta`, mientras `aplicarDesfases` toma
    `item_receta → items` (el `UPDATE` del precio). Ciclo A→B / B→A alcanzable con un PATCH
    de receta normal —nombre + ingredientes en el mismo payload— contra un "aplicar desfase
    con actualizar precio", y en `items.service.ts` nadie reintenta el `40P01`. El lock se
    movió arriba del `UPDATE items`, así que los dos caminos toman `item_receta` primero.
    **Lección:** agregar un `FOR UPDATE` no es local — hay que mirar qué otros locks toma el
    método **antes**, no solo qué protege la línea nueva.
    En `aplicarDesfases` se toma **uno solo para todo el lote y con `ORDER BY item_id`** —el
    orden lo ponía el cliente, que es exactamente el caso a neutralizar: dos lotes con
    recetas en común se tomarían las filas en órdenes distintos y se abrazarían. Es la misma
    lección del deadlock de ventas cerrado el mismo día.
  Fijan el cierre 3 tests nuevos o ampliados en `items.service.spec.ts`, incluido el
  anti-N+1 de desfases, que pasó de exigir 2 lecturas a 3 **conservando lo que protege**: el
  número sigue siendo fijo con N=3 recetas, así que un lock por receta lo pondría en 9.
  **5 mutantes revirtiendo cada decisión al código anterior** —sacar cada uno de los tres
  `FOR UPDATE`, sacarle el `ORDER BY` al del lote, y devolver el lock de la receta a la
  posición que causaba el deadlock—: los 5 en rojo.

- [x] ~~**Los middlewares de permisos rompen la hidratación del menú lateral**~~ (frontend,
  `nuxt.config.ts`) — cerrado 2026-07-30, el mismo día que se abrió. Decisión del owner:
  **`ssr: false`**, la app es una SPA. Razonamiento completo en
  [ADR-017](../adr/017-spa-sin-ssr.md).
  El mismatch era el síntoma; la causa era que **el servidor no puede renderizar nada real**:
  toda ruta está detrás de `auth` y el token vive en el cliente, así que el SSR pintaba un
  menú vacío. Eso pasaba desapercibido porque el cliente también hidrataba vacío —los dos
  lados coincidían *por casualidad*— y el barrido de permisos rompió la casualidad al hacer
  que los middlewares esperaran `ensureCargado()`.
  Se descartó `routeRules` por ruta: habría que mantener a mano la lista de rutas con
  middleware de permisos y el default seguiría siendo el equivocado, así que la próxima
  pantalla con guard nacería rota.
  Cayeron con la decisión: la `runtimeConfig.apiUrl` privada y su `API_INTERNAL_URL` en
  `docker-compose.yml` y `Dockerfile.prod` (existían para el fetching server-side; las
  leían `stores/auth.ts` y `stores/tenant.ts`, pero **solo** detrás de `import.meta.server`
  y con fallback a la pública, así que ningún camino alcanzable cambia). Se agregó
  `app/spa-loading-template.html` porque sin SSR la carga dura arranca en blanco. De yapa,
  el resumen de build de Nitro bajó de **11,5 MB a 2,1 MB**.
  **Queda abierto** lo que no se puede tocar acá: las ramas `import.meta.server` de
  `auth.ts`/`tenant.ts` son inalcanzables pero viven en el sistema de tokens JWT
  (invariante 4). Entrada propia en [`pendientes.md`](pendientes.md).
  **Verificado en navegador** sobre el stack real, no deducido: las mismas rutas que tiraban
  `Hydration node mismatch` (`/cajas/historial`, `/configuracion/impuestos`) quedaron con la
  consola limpia, y la suite de navegador completa (`npm run e2e`) pasa en verde — que era
  el riesgo real del cambio, porque altera cuándo aparece el contenido.

- [x] ~~**Cuatro pantallas más sin gatear sus controles de escritura**~~ (frontend,
  `configuracion/garzones.vue`, `impresoras.vue`, `salones.vue`, `turnos.vue`) — cerrado
  2026-07-30, resto del barrido de permisos. Cada control quedó con el permiso de **su**
  endpoint, leído del controller ruta por ruta y no de esta entrada.
  Lo que el mapeo real corrigió respecto de lo que la entrada daba por sabido: **garzones,
  salones y turnos no tienen módulo propio** —sus rutas piden `Salones:*`—, y
  **`Salones:Operar` no toca ninguna de las cuatro**: es de la operación (cuentas, comandas,
  `garzones/identificar`, sesiones-garzón), no de estas pantallas. Ningún endpoint apareció
  sin guard: no hubo hallazgo de seguridad.
  Tres controles no eran deducibles mirando la pantalla y salieron del controller:
  **Regenerar PIN** es `PATCH /garzones/:id/pin` → `Actualizar`, no un permiso aparte;
  **Agregar mesa** es `POST /salones/:id/mesas` → `Crear`, aunque viva dentro del editor del
  plano; y el **plano arrastrable es una escritura** —soltar una mesa guarda
  `PATCH :id/layout` y el doble-click abre el drawer de la mesa (`PATCH /mesas/:id`)—, las
  dos `Actualizar`, así que se gatea la prop que habilita la interacción
  (`:editable="puedeActualizar"`) y no un botón. Sin eso el usuario arrastra mesas y descubre
  el 403 recién al soltar. El switch de `activo` de impresoras se **deshabilita** en vez de
  esconderse (además muestra estado), sumando el permiso a la condición `toggling` que ya
  existía.
  Queda una asimetría que es **de la UI y es preexistente, no del gate**: borrar una mesa
  solo se ofrece dentro del drawer de edición, al que únicamente se llega por el doble-click
  que exige `Actualizar`; quien tenga `Eliminar` sin `Actualizar` no puede borrar mesas por
  pantalla. El botón igual se gatea con `Eliminar`, que es el sentido que sí ocurre.
  **Salió del alcance pedido, pero sin esto el gate no servía:** el menú de
  `configuracion.vue` publicaba esas cuatro entradas con `…:Crear` —el resto del menú pide
  `Leer`—, así que quien tenía `Actualizar` o `Eliminar` nunca llegaba a la pantalla donde
  sí podía trabajar, y el botón de editar recién gateado era código muerto para él. Es el
  mismo colapso de permisos, una capa más arriba. Corregido a `Leer` en los dos bloques.
  Fija el cierre `app/pages/configuracion/permisos-escritura.nuxt.spec.ts` (29 tests). Un
  solo archivo tabla-driven para las cuatro porque el modo de falla es uno y es el mismo:
  colapsar los tres permisos, o gatear unos controles y olvidar otros; cuatro specs casi
  idénticos lo esconderían en la duplicación. **19 mutantes, todos revirtiendo al código
  previo al gate** —quitar el `v-if`, devolver `editable` fijo, sacar `|| !puedeActualizar`
  del switch, dejar el borrar-mesa en `v-if="mesaEditingId"`, devolver el menú a `Crear`—:
  los 19 en rojo. La revisión independiente cazó que uno de los tests del menú pasaba igual
  con el gate roto (sin ningún permiso del módulo, `Leer` y `Crear` dan `false` los dos):
  se agregó el caso que sí discrimina —el rol real del bug, `Leer` + `Actualizar` sin
  `Crear`— y el que no discrimina quedó con su razón escrita al lado.

- [x] ~~**Cuatro suites e2e dejan la caja abierta al terminar**~~ (backend, `test/combos`,
  `grupos-modificadores`, `grupos-modificadores-overrides` y `recetas.e2e-spec.ts`) —
  cerrado 2026-07-29. Las cuatro tenían el **mismo** helper `cerrarCaja` de 10 líneas:
  llamaba solo a la fase 2 (`POST /:id/cerrar`) sobre una caja `abierta` —que el service
  rechaza, porque exige `en_conciliacion`— y **no miraba el status**, así que no cerraba
  nada y el cajón quedaba ocupado. La suite pasaba porque sobraban cajones; al agregar
  tests cambia el orden en que jest ordena las suites y la fuga reaparecía como un `409`
  críptico en `caja.e2e-spec.ts`, a varios archivos de la causa (ya pasó en jul-2026 con
  `liquidacion-propinas`: 11 fallos con 409, media hora de diagnóstico).
  Ahora las cuatro cierran por las dos fases reales, con el patrón de `ventas.e2e-spec.ts`
  (commit `c8e3abe`) y **aseverando** las dos: `expect` sobre el status del conteo —que el
  original de ventas no tiene, y sin el cual un 400 en fase 1 volvería a ser silencioso— y
  sobre el de la finalización. La justificación manda **siempre** un comentario, para no
  depender de que el primer motivo activo del tenant no exija `requiereComentario`.
  **Contrafactual medido, no deducido** (es una fuga de estado: que la suite pase no prueba
  nada). Sobre BD reseteada, corriendo solo `combos`: con el helper viejo restaurado quedan
  **1 caja física en `abierta`**; con el nuevo, **0**. Tras la e2e completa (**16 de 17
  suites, 170 tests verdes**; la 17ª es `pasarela-oneclick`, que se saltea sola salvo
  `RUN_TRANSBANK_E2E=1`, y son sus 2 tests los que aparecen como skipped) las únicas cajas
  abiertas son las **2 virtuales** del seed —una por tenant, abiertas por diseño— y las 28
  físicas quedaron `cerrada`.

- [x] **Burndown de typecheck del frontend — COMPLETO (0 errores)** (frontend) — jul-2026
  Los 84 errores de vue-tsc estricto se quemaron por tandas. `typecheck-baseline.json`
  quedó vacío: el `typecheck:ratchet` ahora es un gate totalmente estricto (cualquier
  error nuevo bloquea CI). Todos los patrones y sus fixes solo-de-tipo quedaron en
  `anti-patterns.md` (`@click`→arrow inline; spread/índice guardado→`!`; `string|null`→prop
  con `?? undefined`/tipar form; mismatches Nuxt UI·reka; tipado de unit tests vitest).

- [x] **El cierre de caja pisaba el comentario de la apertura** (backend, cerrado
  2026-08-12 con el plan `testigo-cierre-forzado`, Task 4). **Entrada original
  (verbatim):** *"(backend, `caja.service.ts:246` y `:737`, medido 2026-08-11 al
  planificar el testigo) — las dos operaciones escriben la **misma** columna
  `cajas.comentario`: `abrir()` guarda el de la apertura y `enviarConteo()` lo sobrescribe
  con el del cierre. Nadie lo notó porque el comentario de apertura casi no se usa. Sube de
  prioridad con el testigo del cierre forzado, que **vuelve obligatorio** el comentario en
  más cierres: más cierres con comentario = más comentarios de apertura perdidos. No se
  arregló ahí porque es preexistente y arreglarlo es decidir si el de apertura merece
  columna propia — o si directamente no debería existir."*
  **Cómo se cerró:** columna propia — decisión del owner (2026-08-12), la que la entrada
  original dejaba pendiente. `cajas.comentario_cierre` (TEXT, nullable) es del CIERRE;
  `cajas.comentario` queda exclusivamente de la APERTURA. `enviarConteo` (fase 1) dejó de
  tocar `comentario` y escribe `comentarioCierre`; `cerrar` (fase 2, Task 4 del mismo plan)
  hace lo mismo si trae un comentario nuevo, sin tocar jamás la columna de apertura. La
  regla del testigo (fase 2 exige comentario en el cierre forzado sin firma) mira solo
  `comentarioCierre` — el de esa fase o el que ya haya dejado la fase 1 — así que un
  comentario de apertura ya no puede satisfacerla, por diseño.
  **Primer intento, revisado y corregido antes de cerrar la task.** La primera versión no
  separaba columnas: dejaba `cerrar` escribir en la misma `cajas.comentario` que
  `enviarConteo`, y para no perder la explicación de fase 1 los concatenaba
  (`"Conteo: … | Cierre: …"`). La revisión lo bloqueó: concatenar era parchar la confusión
  entre apertura y cierre, no resolverla — el comentario de apertura y el de cierre no
  tienen nada que ver entre sí. Se descartó la concatenación y se separaron las columnas.
  **Lo que fija el mutante que importa:** un test verifica que abrir una caja con
  comentario y después cerrarla (forzado, sin firma, con un comentario nuevo en la fase 2)
  conserva **los dos por separado** — `caja.comentario` intacto con el texto de la
  apertura, `caja.comentarioCierre` con el del cierre. Revertir la escritura de `cerrar`
  para que vuelva a caer en `caja.comentario` (el bug original) tira ese test.

---

## Barrido de permisos en el frontend (2026-07-30)

- [x] ~~**Barrido de botones de escritura sin gatear por permiso (19 pantallas)**~~ y
  ~~**Component tests del gateo de permisos — falta decidir si se adopta**~~ (frontend +
  backend) — cerradas juntas el 2026-07-30. La entrada pedía `v-if` en 19 archivos; lo que
  se hizo es distinto, y **la mitad de lo que la entrada afirmaba no resistió medirlo**:
  - ⛔ **Apareció un hueco de autorización real, no de UX.** `POST /tenants/members` y
    `DELETE /tenants/members/:userId` no tenían `TenantAdminGuard`: colgaban solo de
    `JwtAuthGuard + TenantGuard`, siendo las **únicas** dos rutas del controller sin él (con
    `PATCH me` al lado que sí lo tenía, y el controller hermano de `roles` guardando todo).
    Cualquier miembro autenticado podía sumar cuentas al tenant y **eliminar al admin del
    suyo**. Se cerró acá, y no en una entrada aparte, por una razón concreta: **el barrido
    tal como estaba planteado lo habría tapado** — esconder botones deja la UI con aspecto
    de permiso resuelto mientras el endpoint sigue abierto a `curl`. Lo fija
    `test/tenants-members.e2e-spec.ts`; el mutante que saca los dos guards **borró un
    miembro de verdad**, que es la demostración práctica de la severidad.
  - **`items` NO es admin-only**, aunque la entrada lo listaba entre las 16: va con
    `@RequiresPermiso('Items', …)`. Gatearlo con `esAdmin` como sus vecinas le habría
    escondido los botones a quien sí puede escribir — el bug **inverso** al que el barrido
    venía a arreglar.
  - **15 de las 16 ya estaban escondidas del menú** bajo `esAdmin` (`configuracion.vue:22`),
    así que el "callejón sin salida" exigía escribir la URL a mano. Real, pero no el
    tropiezo cotidiano que la entrada describía. Y eso habilitó una salida mejor.
  - **`configuracion/recetas-desfases.vue` es un stub de redirección de 6 líneas**; la
    pantalla real vive en `/recetas-desfases`. La entrada apuntaba al archivo equivocado.
  **Lo que se hizo, decidido por el owner con los números arriba de la mesa:**
  - **Middleware `admin`** (`app/middleware/admin.ts`) + `definePageMeta` en las 15
    admin-only, en vez de ~60 `v-if`. Un mecanismo en lugar de quince, **cubre la URL
    escrita a mano** —que el `v-if` no cubre— y se testea como función pura.
    ⚠️ Lo que casi lo rompe: los permisos se cargan en `onMounted`, o sea **después** de la
    navegación. Sin esperar, un admin entrando por URL directa o F5 se lee como no-admin y
    queda expulsado de su propia pantalla. Por eso el store ganó `ensureCargado()`, que
    además dedupe el request en vuelo (middleware y layout montaban a la vez).
  - **Gate por permiso en las 4 que no son admin-only** (`items`, `terceros`, POS,
    `recetas-desfases`), cada control con el permiso de **su** endpoint y sin colapsarlos en
    un `puedeEscribir` único: hay roles con `Actualizar` y sin `Crear`.
    En el POS el permiso se sumó a `puedeCobrar`, que ya era una función pura con spec —la
    convención de "sumar a la condición existente en vez de un `v-if` paralelo"—. En el
    panel de desfases el gate vive en el componente y no en sus tres páginas, para que no se
    desincronice entre call sites.
  - Dos excepciones deliberadas al "esconder": los `USwitch` de `activo` se **deshabilitan**
    en vez de ocultarse, porque además de escribir muestran estado — esconderlos borraría
    información de la tabla.
  **Los component tests se adoptan, acotados a esto** (era la decisión abierta de la otra
  entrada). Confirmado el costo del spike: 3 archivos con `// @vitest-environment nuxt`
  llevan la suite de 3,3s a 6,3s. Y confirmada la trampa que la entrada anticipaba: Nuxt
  instala su propia Pinia, así que hay que mockear el auto-import con `mockNuxtImport`.
  Trampa nueva, no anticipada: **no consultar por la clase del icono** — `UIcon` lo renderiza
  en un hijo y en el entorno de test no siempre resuelve. Se consulta por `title`, lo que de
  paso agregó accesibilidad que faltaba en los botones de fila de `terceros`.
  ➕ **Un modo de falla que encontró la revisión independiente y se cerró en el mismo
  commit:** si `fetchPermisos` fallaba (red, hipo de token), el `catch` solo seteaba `error`
  y el `finally` marcaba `cargado = true` igual — así que `ensureCargado` resolvía con
  `esAdmin` en su default `false` y el middleware **expulsaba a un admin real**. El docblock
  que yo había escrito decía resolver el caso de timing y no cubría el de error. Ahora
  `cargado` solo se marca si de verdad se pobló (la próxima navegación reintenta) y el
  middleware **no redirige cuando no pudo determinar**: se deja pasar, porque esto es UX y el
  candado real es el guard del backend. Redirigir ante la duda se ve como "a veces me tira al
  índice" y nadie lo reporta como bug de permisos.
  **Seis mutantes verificados revirtiendo** ([[mutante-debe-revertir-no-solo-romper]]):
  gatear `items` con `esAdmin` (cae el test del no-admin con `Items:Crear` — el bug que la
  entrada me habría hecho cometer); sacar el `v-if` de "Nuevo item"; colapsar los tres
  permisos de `terceros` en uno; sacar el `v-if` del panel; sacar el `await ensureCargado`
  del middleware; y sacarle la salida temprana del caso "no se pudo determinar".

## Limpiezas menores

- [x] ~~**Falta usuario semilla "supervisor `Cajas:Leer` no-admin" para e2e del ciego**~~ —
  cerrado 2026-07-28: el seed siembra `supervisor@paris.cl` con el rol `Cajas · Supervisión`
  (no fijo, `Cajas:Leer` y **nada más**; sin `MiCaja`, así que no opera ninguna caja propia).
  Es la combinación exacta contra la que se define el ciego —ve cajas ajenas y **no** es
  admin— y no existía: `admin.paris` hacía de "supervisor" pero es admin, y `vendedor.paris`
  no llega a una caja ajena.
  El e2e nuevo assevera lo que ningún mock podía: la sesión de la caja del cajero llega
  **no nula** con `saldoEsperado: null`. Esa aserción es la que separa "no ve el número
  porque es ciego" de "no ve el número porque no llega a la caja" — sin ella un 403 o una
  grilla vacía darían el mismo `null`. En la misma corrida, el admin sobre **el mismo
  cajón** sí ve el esperado, y se verifica que sea el número de verdad (inicial + los 3000
  que acaban de entrar), no un placeholder.
  Tres mutantes verificados, cada uno mata su parte: `esAdminTenant` siempre `true` (el
  supervisor recibe `13000.0000`), el controller que no pasa `esAdmin` (el **admin** queda
  ciego), y `cajonesEstado` sin la retención.
  ⚠️ **Lo que el mutante 2 destapó, y quedó arreglado:** al fallar el test, la caja del
  cajero quedaba abierta y **contaminaba la corrida siguiente** —el mutante 3 dio un falso
  resultado por eso—. El `afterAll` del describe nuevo ahora libera la caja pase lo que
  pase, verificado empíricamente: con el mutante puesto la corrida falla, y la siguiente
  sobre **la misma base** pasa. Es el patrón que [`pendientes.md`](pendientes.md) predice
  para las tres suites que siguen sin cerrarla.

- [x] ~~**`select-tenant.vue` tiene el mismo bug de truncado que se corrigió acá**~~ —
  cerrado 2026-07-29, **reabierto y refutado el mismo día**. Se creyó que
  `pages/select-tenant.vue:84` (`flex-1 truncate` sin `min-w-0`) tenía el mismo defecto que
  `31893f7` "arregló" en `AdvertenciasPrecio.vue`, y se agregó un gate estático
  (`scripts/check-design-tokens.mjs`) que marcaba el elemento hijo flex (`flex-1`,
  `flex-auto`, `basis-*`) **y** trunca en sí mismo, sin `min-w-0`.
  Medido después en navegador real (Chromium): la
  premisa era falsa. Por la spec de Flexbox §4.5, el mínimo automático de un ítem flex es
  **cero** cuando su propio `overflow` computado no es `visible` — y `truncate` incluye
  `overflow: hidden`. Un elemento que **es** el ítem flex y **lleva** `truncate` encima ya
  encoge solo; `min-w-0` ahí es redundante. Barrido pre-fix vs. post-fix de `31893f7`,
  idéntico fila por fila en 9 anchos de contenedor (360px→50px): el commit fue un no-op.
  El defecto real que motivó `31893f7` era *wrapping* vertical a cinco renglones, ya
  resuelto por el commit anterior (`ceba35f`) al introducir `truncate`.
  La forma que **sí** rompe es la opuesta a la que el gate vigilaba: `truncate` en un
  **descendiente** de un ítem flex/grid cuyo propio `overflow` es `visible` (`truncate`
  implica `white-space: nowrap`, así que el min-content del bloque es el ancho completo del
  texto, y el ítem se niega a encoger). Medido: desborda 370px sobre un contenedor de
  300px, con o sin `flex-1` en el wrapper.
  **Qué quedó en su lugar:** el gate estático se borró de `check-design-tokens.mjs` (no
  puede ver una relación ancestro/descendiente entre líneas distintas del template, solo
  detecta la forma segura). El `min-w-0` de `select-tenant.vue:84` se dejó — es inocuo,
  sacarlo es churn sin ganancia — pero **no era necesario**. La regla real (cuándo
  `min-w-0` hace falta y cuándo es ruido, con los números de la medición) quedó
  documentada en `docs/patterns/frontend.md` §16.

- [x] ~~**Cuatro hijos directos de un `.flex` que truncan sin `min-w-0` en ningún
  ancestro — candidatos a verificar, no bugs confirmados**~~ — cerrado 2026-07-29: los
  cuatro son **falsos positivos**. Medido en navegador real pisando el `textContent` con
  texto forzado (46 a 109 caracteres, según candidato) y leyendo `scrollWidth`/`clientWidth`
  del elemento, si el padre desbordó y si la página ganó scroll horizontal:
  - `app/components/caja/CajaAperturaGrid.vue:95` y `CajaCajonesGrid.vue:56` — el span
    que trunca recortó correctamente (`elScrollW`/`elClientW` 356/265 y 356/252); el padre
    no desbordó. Misma forma que `select-tenant.vue:84`: el elemento que trunca **es** el
    ítem flex, así que su propio `overflow: hidden` (parte de `truncate`) ya fija el
    mínimo automático en cero (Flexbox §4.5) — `min-w-0` ahí no aporta nada.
  - `CajaCajonesGrid.vue:71` — reproducción sintética fiel (mismo `[data-slot="body"]`
    real de la `UCard`) con texto de 109 caracteres: recortó (817/232), misma forma segura.
  - `app/layouts/dashboard.vue:184` — con texto de 82 caracteres no truncó porque **no
    tuvo que hacerlo**: el contenedor creció de 439px a 626px en vez de recortar. Ningún
    criterio pedido (recorte, desborde del padre, scroll horizontal de página) indica
    bug; mecanismo distinto a los otros tres (crecimiento del contenedor, no
    truncado-que-falla), anotado como nota aparte, no como bug.
  Ninguno se toca: no había nada que corregir. La regla real —cuándo `min-w-0` hace
  falta— quedó en `docs/patterns/frontend.md`.

---

## Harness / tooling (CodeGraph)

- [x] **Sync de CodeGraph en un git hook + niveles de búsqueda — HECHO** (harness) — jul-2026
  `.githooks/pre-push` corre `codegraph sync --quiet` (red de seguridad no-bloqueante:
  nunca frena el push, no-op si CodeGraph ausente; nunca `index`). Validado empíricamente:
  el daemon estaba caído y el índice tenía 44 archivos viejos; el sync los reconcilió en
  <1s. Niveles de búsqueda (`--max-files`: rápido=default / normal=3-5 / profundo=10+)
  documentados en el "Orden de búsqueda" de `CLAUDE.md`.

---

## Propinas en POS (notas de la revisión final)

- [x] ~~**`propinaDirecta`/`propinaCierreMesa` no se restringen al canal `fisico`**~~
  (backend, `ventas.service.ts`) — cerrado 2026-07-30. Las dos propinas son del canal
  presencial (el POS y el cierre de mesa de salones), pero el gate miraba solo
  `habilitadoPos`/`habilitadoSalones`: una venta `online` podía enviarlas y quedaban
  persistidas como `venta_propina`.
  **Se ignora, no se rechaza** — es la semántica que la feature ya tenía documentada para un
  canal apagado (`docs/features/pagos.md#propina-en-el-pos`), y meter un 400 acá habría hecho
  convivir dos comportamientos para la misma clase de propina inválida. El gate quedó en un
  solo booleano (`traePropina`), que además evita consultar `PropinaConfiguracion` en las
  ventas online.
  **Mutante verificado revirtiendo** ([[mutante-debe-revertir-no-solo-romper]]): sacando
  `canal !== 'online'` el e2e nuevo de `liquidacion-propinas` falla (encuentra la fila de
  propina); con el gate, la venta online se crea con 0 propinas y los dos flags encendidos,
  o sea lo único que la cortó fue el canal. Es el primer e2e del repo que crea una venta
  `canal: 'online'`.

---

## Auditoría `ventas` + `pagos` (2026-07-27)

Pasada de 7 lentes según `docs/agent/auditoria-codigo.md`. 20 hallazgos crudos → 15
confirmados tras refutación (3 eran el mismo bug visto por lentes distintas, 3 pasaron a
decisión de owner, abajo). **Ninguno se corrigió en la pasada**: la auditoría produce
información, no diffs. Orden = severidad.

- [x] ~~**Otros 14 `.vue`/composables arman el mensaje de error a mano**~~ (frontend) —
  cerrado 2026-07-29. **Eran 20 archivos, no 14**: los 15 que listaba la entrada (toasts en
  `components/caja/*` ×5, `components/configuracion/*` ×2, los 3 composables, `tienda/*` ×3,
  `ventas/index.vue`, `pagos/index.vue`) **más 5 stores** que no estaban anotados
  (`auth`, `tenant`, `permissions`, `monedas`, `unidades-medida`), donde el array no iba a un
  toast sino directo a `error.value`. 24 sitios en total, todos con el mismo cast mentiroso
  (`{ message?: string }` sobre algo que el `ValidationPipe` devuelve como `string[]`).
  Cero restos: el grep del cast a mano queda vacío.
  Dos cosas que el barrido destapó:
  - `pages/tienda/medios-pago.vue` tenía su **propia copia local** de `apiErrorMsg`, con el
    bug adentro, sombreando al util compartido. Se borró; el nombre resuelve ahora al
    auto-import.
  - `stores/auth.ts` (registro) ya juntaba el array a mano con `Array.isArray(...).join`.
    Quedó reemplazado por el util: mismo resultado, una lógica menos duplicada.
  ⚠️ **Cambio de comportamiento visible, deliberado:** `apiErrorMsg` **conserva** el motivo
  de un error local detrás del fallback (`"Error al cargar tenants: Network error"`) en vez
  de tragárselo. Antes esos casos mostraban solo el genérico. Es el diseño del util
  compartido —el mismo que ya usan ventas, pagos, órdenes y suscripciones— y por eso el
  barrido lo adopta en vez de replicar el `?? fallback`. Rompió 2 tests que aseveraban el
  genérico exacto; se actualizaron con el porqué al lado, no se aflojaron.
  Lo fija un test RED verificado en `stores/tenant.spec.ts`: con `message: ['a','b']` el
  `error.value` **era el array** (`expected [ 'tenantId debe ser un UUID', …(1) ]`) y ahora es
  el string unido. La resolución del auto-import en los 20 archivos la garantiza `vue-tsc`:
  un `apiErrorMsg` no resuelto sería un error de tipos, y el ratchet quedó en 0.
  ⛔ **Segunda regresión propia del mismo barrido, encontrada por la revisión independiente y
  corregida antes de commitear:** `login` y `register` de `stores/auth.ts` son los **únicos
  dos sitios sin sesión** de los 24, y ahí ese "conservar el motivo local" filtraba
  infraestructura a un visitante anónimo — cuando el backend no responde, el `message` del
  `Error` de ofetch trae el método y la URL completa
  (`[POST] "http://host:3000/api/auth/login": <no response> fetch failed`), así que el toast
  del login pasaba a mostrarla. `apiErrorMsg` acepta ahora `{ detalleLocal: false }`, que
  descarta el mensaje del error local **sin** tocar el del backend (incluido el array de
  validación), y los dos sitios de `auth.ts` lo usan.
  Lo fijan 4 tests en `stores/auth.spec.ts` con los 2 RED verificados
  (`expected 'Error al iniciar sesión: [POST] "http…' to be 'Error al iniciar sesión'`), que
  aseveran las dos mitades: el genérico sin `http` en el fallo de red, y el mensaje del
  backend intacto en credenciales inválidas y en el array de validación del registro.

- [x] ~~**El `LEFT JOIN turnos` tampoco filtra por tenant**~~ (backend,
  `turnos/sesiones-garzon.service.ts`) — cerrado 2026-07-29, el vecino que quedó a la vista
  al cerrar los de `garzones` el mismo día. Los dos JOIN de `turnos` (`listarAbiertas` e
  `historial`) llevan `t.tenant_id = $1`; `turnos` tiene la columna (verificado contra la BD).
  ⚠️ **Hueco de cobertura que esto destapó, y que el gate no ve:** **ningún e2e** toca
  `GET /sesiones-garzon/abiertas` ni `GET /sesiones-garzon` (historial) ni
  `GET /cuentas/:id/asignaciones`, así que un SQL malformado en esas tres queries pasaría
  todo el gate en verde — el unit solo asevera el texto de la query. Se ejercitaron a mano
  contra Postgres real: las tres devuelven **200**, la del historial también con filtros
  dinámicos (`?estado=cerrada&page=1&pageSize=5`), que es donde un `$1` mal numerado
  reventaría. Y lo que importa del filtro: los nombres unidos siguen llegando
  (`garzonNombre: "Ana Torres"`, `turnoNombre: "Mañana"`), o sea el JOIN no quedó sin
  matchear. Vale como e2e futuro.

- [x] ~~**Otros tres `LEFT JOIN garzones` sin filtro de `tenant_id`**~~ (backend,
  `turnos/sesiones-garzon.service.ts`, `salones/cuenta-asignaciones.service.ts`) — cerrado
  2026-07-29. **Eran cuatro, no tres**: dos en `sesiones-garzon` (`listarAbiertas` e
  `historial`) y dos en `cuenta-asignaciones` (`g` y `go`, el garzón y el de origen del
  tramo). Los cuatro llevan ahora `tenant_id = $1`, que ya estaba en scope en las dos
  queries. Defensa en profundidad: no eran explotables por sí solos, el `garzon_id` de esas
  filas se escribe por caminos tenant-scoped.
  **La cobertura es del SQL, no del comportamiento, y es a propósito:** el escenario que
  discriminaría el filtro exige dos tenants compartiendo un `garzon_id`, que es la PK —
  imposible de montar por API o por SQL. Así que el test asevera que la query lleva el
  filtro, en el mismo estilo que las aserciones de `LEFT JOIN` que ese spec ya tenía por el
  bug de soft-delete. Ambos RED verificados antes del fix.
  ⚠️ **Queda a la vista un vecino con el mismo defecto, fuera de alcance:** el
  `LEFT JOIN turnos t` de esas dos mismas queries tampoco filtra por tenant, y `turnos` sí
  tiene la columna (verificado contra la BD). El `LEFT JOIN usuarios u` de
  `cuenta-asignaciones` **no** corresponde filtrarlo: `usuarios` no tiene `tenant_id` porque
  un usuario pertenece a varios tenants.

- [x] ~~**El vuelto se asigna íntegro a un pago sin acotarlo a su propio monto**~~ —
  cerrado 2026-07-27: el excedente se reparte entre los pagos con `permite_vuelto`,
  acotado al monto de cada uno y en orden determinista por `metodoPagoId`; si supera lo
  devolvible (es decir, si los métodos sin vuelto superan el target) se rechaza con 400.
  Se acabaron los movimientos de caja `entrada` con monto negativo. Era el hallazgo que
  detectaron 3 lentes independientes.
- [x] ~~**`registrarAbono` calcula el saldo con la suma bruta de pagos**~~ — cerrado
  2026-07-27: `registrarAbono` lee `pago_aplicaciones` con `tipo='venta'`, igual que
  `listar()`/`resumen()`. La fórmula documentada en `docs/features/ventas.md` y
  `pagos.md` también se corrigió (estaba escrita antes de las propinas). Cubierto por
  e2e, no por unit: el mock del unit devuelve la fila igual con cualquier query.
- [x] ~~**`metodoPagoId` se persiste sin validar que esté habilitado para el tenant**~~
  — cerrado 2026-07-27: `registrar()` rechaza con 400 cualquier `metodoPagoId` ausente
  del mapa tenant-scoped, antes de escribir nada.
- [x] ~~**`garzonId` de propina no se valida contra el tenant y el JOIN de lectura lo
  expone**~~ — cerrado 2026-07-27: `propinaCierreMesa` valida con
  `GarzonesService.obtenerActivoPorId(tenantId, garzonId)` antes de persistir, y el JOIN
  de `findOne` lleva `AND g.tenant_id = vp.tenant_id`. Se sembró un garzón de Falabella
  (`…440332`) **solo** para que el e2e pueda ejercer el cruce: es activo y válido, así que
  el único motivo de rechazo posible es el tenant.
  ⚠️ Ese garzón **aparece en el listado de garzones de Falabella** (es `activo: true` a
  propósito: con `activo: false` el test pasaría por "inactivo" sin tocar el chequeo de
  tenant). Hoy ningún test cuenta garzones de ese tenant. Si algún día uno lo hace y da
  uno de más, la causa está acá — no lo desactives, ajustá el conteo.
- [x] ~~**La caja se verifica sin lock y el movimiento se escribe después sin
  re-chequear**~~ — cerrado 2026-07-27: la creación de venta (canal físico) y el abono
  toman `bloquearCajaAbierta` dentro de la transacción, el mismo patrón que ya usaba la
  nota de crédito. Los tres caminos que escriben en `movimientos_caja` sostienen ahora el
  lock hasta el commit. La caja virtual queda deliberadamente fuera: nunca se cierra y
  bloquearla serializaría todas las ventas online del tenant.
- [x] ~~**N+1 al crear una venta: un `itemsService.findOne` por línea del carrito**~~ —
  cerrado 2026-07-27 con `ItemsService.cargarBasePorIds`: **una** query para todo el
  carrito. Resultó peor de lo reportado: la venta usa solo campos del row base, así que
  las 3-6 queries extra que `findOne` hacía por ítem (impuestos, recargos, descuentos,
  ingredientes, componentes, grupos) construían colecciones que se descartaban enteras.
- [x] ~~**`registrarAbono` sin `FOR UPDATE` sobre la venta**~~ — cerrado 2026-07-27: la
  carga de la venta toma `FOR UPDATE`, así que los abonos sobre la misma venta se
  serializan hasta el commit y la suma de `pago_aplicaciones` queda bajo ese lock.
- [x] ~~**Orden de locks de `item_producto` decidido por el cliente → deadlock**~~ —
  cerrado 2026-07-27: los movimientos de inventario se recorren en orden determinista por
  `itemId` (desempate por posición), no en el del carrito. Un orden global fijo hace
  imposible el bloqueo en cruz entre dos ventas con los mismos productos.
- [x] ~~**`esNotaCredito` se recalcula en el drawer con un código hardcodeado**~~ —
  cerrado 2026-07-27: `findOne()` lo emite con el mismo criterio que `listar()` (el id del
  tipo de documento) y el drawer lo consume. Hay un test con una NC de código `'9999'`:
  comparar por código daría `false` y el test falla.
- [x] ~~**`tasa_cambio` se calcula con 6 decimales y se persiste en escala 4**~~ —
  cerrado 2026-07-27: la columna pasa a `NUMERIC(18,6)`, la misma escala que
  `tenant_moneda.valor_del_dia` de donde sale la tasa. El campo vuelve a reproducir
  `precioUnitario`, que es para lo que existe.
- [x] ~~**`pos.vue` y `AbonoModal.vue` no usan `apiErrorMsg`**~~ — cerrado 2026-07-27
  (las dos ocurrencias de `pos.vue`, no solo la del hallazgo).
- [x] ~~**La rama "caja en conciliación" no la ejerce ningún test**~~ — cerrado
  2026-07-27: un test por service verifica que una caja presente-pero-no-abierta se
  rechaza, y que corta **antes** de escribir (sin lock, sin cargar ítems, sin `save`).
- [x] ~~**Nadie ejerce a cuál pago se le asigna el vuelto con métodos mixtos**~~ —
  cerrado 2026-07-27, en **dos** intentos, los dos fallidos por la misma causa. La 1ª
  versión ponía el método con vuelto primero en el array y primero por id: "elegir por
  permiso", "elegir el primero" y "elegir por id" coincidían. La 2ª agregó un método sin
  vuelto delante… pero con **solo dos pagos el ganador es a la vez el último, el de id
  mayor y el de monto mayor**, así que seguía sin descartar esas tres. Lo cazó la
  revisión independiente, no yo. La versión final usa **tres** pagos con el efectivo en
  el medio en posición, id y monto; se verificó contra cuatro implementaciones erróneas
  (primero, último, mayor monto, id mayor) y las cuatro lo hacen fallar.
- [x] ~~**La nota de crédito sobre `pagada_parcial` no se prueba nunca en éxito**~~ —
  cerrado 2026-07-27: camino feliz sobre `pagada_parcial`, no solo su ausencia de la
  lista de rechazo.

Los cuatro se validaron con mutantes sobre el código de producción: borrar cada guard o
sacar `pagada_parcial` de la whitelist hace fallar exactamente el test que lo cubre.

### Decidido por el owner tras investigación de mercado (2026-07-27)

Salieron de la auditoría como reglas de negocio no documentadas. Se corrió una pasada de
investigación y el owner las decidió. Método, cruce contra el código y fuentes:
**`docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`**. La cuarta
—devolución por medio de pago y plazos— sigue abierta en
[`pendientes.md`](pendientes.md).

- [x] ~~**Acotar el dinero devuelto por una NC a lo cobrado EN EFECTIVO en esa venta**~~ —
  cerrado 2026-07-27. El tope es `Σ(efectivo aplicado a la venta) − Σ(ya devuelto en
  efectivo)`; excederlo da 422. Acota el **dinero, no el documento**: la NC sigue
  emitiéndose por el total (regla dura del SII). La pata de tarjeta ya existe en
  `pasarela` y no pasa por acá — componer ambas es el tema que sigue abierto en
  [`pendientes.md`](pendientes.md).
- [x] ~~**Implementar `cancelada` en su subconjunto seguro**~~ — cerrado 2026-07-27:
  `POST /ventas/:id/anular` con permiso propio `Ventas/Anular`, motivo obligatorio (10
  caracteres) y auditoría (`cancelada_el`, `cancelada_por_usuario_id`,
  `motivo_cancelacion`). Repone stock por default con motivo **`anulacion`** —distinto de
  `devolucion`— y admite `reponerStock: false` para mercadería no vendible. Reponer exige
  `modo_inventario='cantidad'` en todas las líneas: serie y lote se rechazan con el mismo
  mensaje que la devolución de una NC. No se modeló el plazo de 6 meses de la Ley 21.398
  (infraestructura DTE especulativa, prohibida por ADR-010).
- [x] ~~**Sacar `borrador` del enum y de la doc**~~ — cerrado 2026-07-27: fuera del enum
  de TypeScript, del tipo `estado_venta` de Postgres, de los mapas de color/etiqueta y del
  filtro del frontend, y de `ventas.md`/`PRODUCTO.md`. Si algún día hace falta parquear un
  ticket en **mostrador** (fuera de salones), se diseña ahí — nadie lo pidió.

---

## Auditoría `caja` + `propinas` (2026-07-27)

Pasada de 8 lentes según [`auditoria-codigo.md`](auditoria-codigo.md). 25 hallazgos crudos →
22 únicos (3 los vieron dos lentes por separado) → **20 sobreviven** tras refutación: 19
defectos y 1 decisión de owner (al final). **Ninguno se corrigió en la pasada**: la
auditoría produce información, no diffs. Orden = severidad.

### Alta

- [x] ~~**`POST /caja/:id/cerrar` con `lineas: []` cierra una caja descuadrada sin
  justificar**~~ — cerrado 2026-07-27: `aplicarMotivosADescuadres` ahora **recorre las filas
  descuadradas de `caja_arqueo_medio`**, no `dto.lineas`; una línea que descuadra y que el
  payload omite cae en el mismo 400 (y con el mismo mensaje) que una que llega vacía. Las
  que cuadran se siguen ignorando, así que un cierre sin descuadres sigue aceptando
  `lineas: []` — hay un test por cada lado, para que "arreglarlo" exigiendo siempre un array
  no vacío también falle. Cubierto por unit (línea omitida, y dos descuadres con una sola
  justificada) y por un e2e real contra la BD. El override admin
  (`PATCH /:id/arqueo/motivos`) comparte el helper y hereda la misma completitud, que es lo
  que ya prometía su docblock.
- [x] ~~**`GET /caja/cajones-estado` revela el esperado de una caja abierta en modo
  ciego**~~ — cerrado 2026-07-27: `cajonesEstado` recibe `esAdmin` y retiene
  `saldoEsperado: null` con la misma regla que los otros tres caminos
  (`!esAdmin && arqueoCiego && estado === 'abierta'`); en `en_conciliacion` revela, porque
  el conteo ya se congeló. `saldoInicial` sigue visible: no es secreto, lo declaró el propio
  cajero al abrir. El front muestra "—". Seis mutantes verificados (quitar cada una de las
  tres condiciones, retener siempre, revelar siempre, y que el controller no pase `esAdmin`)
  y cada uno mata exactamente el test que le toca.
  ⚠️ **Sin cobertura e2e a propósito**: el caso que importa es un supervisor con `Cajas:Leer`
  que **no** sea admin, y ese usuario no existía en el seed. Hoy lo cubren el unit del
  service y el del controller.
  ✅ **Cerrado el 2026-07-28**: el usuario existe (`supervisor@paris.cl`) y el e2e ejerce el
  caso — ver la entrada de Limpiezas menores en este mismo archivo.
- [x] ~~**Un monto manual de propina se aplica en cualquier criterio y no conserva el total
  del grupo**~~ — cerrado 2026-07-27: `validarManualMontos` pasó a ser
  `validarConservacionPorGrupo` y corre sobre **todos** los criterios, no solo
  `MANUAL`+`MONTOS`. Al confirmar, lo repartido en cada grupo tiene que dar exactamente su
  `montoGrupo`; el 400 nombra el grupo y los dos números. **No prohíbe el ajuste manual**:
  exige que la plata cuadre, así que un ajuste compensado entre dos personas del mismo grupo
  se confirma sin problema (hay un test por cada lado). El mutante que devuelve el `continue`
  para los grupos no-`MANUAL` mata el test.
- [x] ~~**Anular una venta no reconcilia `venta_propina`: la propina se paga igual**~~ —
  cerrado 2026-07-27 **en su mitad**: `buscarTipsElegibles` ahora filtra
  `v.estado <> 'cancelada'`, así que la propina de una venta anulada no entra nunca a una
  liquidación nueva. Cubierto por e2e real: se crea la venta con propina, se verifica que el
  pool sube (control, si no el test pasaría aunque nunca hubiera entrado), se anula y se
  verifica que el pool vuelve al valor previo.
  ⚠️ **La otra mitad quedó abierta y decidida** — el saldo en contra por una propina ya
  liquidada, en [`pendientes.md`](pendientes.md).

### Media

- [x] ~~**`garzonId` de participante manual no se resuelve contra el tenant**~~ — cerrado
  2026-07-27: el alta manual (`aplicarCambioParticipante`) y los pesos manuales de la config
  (`propina-distribucion.service.ts`) resuelven el garzón con
  `GarzonesService.obtenerActivoPorId(tenantId, garzonId)` antes de persistir — el mismo
  guard que ya usaba el cierre de mesa en ventas. `PropinasModule` importa ahora
  `GarzonesModule` (sin ciclo: no importa nada y ya lo usaban otros cuatro módulos).
  Detalle original: (backend,
  `propinas/liquidacion-propinas.service.ts:980`, `propinas/propina-distribucion.service.ts:193`)
  — se inserta `garzonId: cambio.garzonId` sin validar; el DTO solo pide `@IsUUID()`. Las
  entidades no tienen FK a `garzones`, así que tampoco hay backstop de integridad. El caso
  más probable no es el cross-tenant sino un **uuid inexistente**: entra como participante
  fantasma con `incluido: true` y diluye el reparto de todos. La defensa correcta ya existe:
  `GarzonesService.obtenerActivoPorId(tenantId, garzonId)`, del fix de ventas de jul-2026.
- [x] ~~**Excluir a un participante le deja el `monto` viejo persistido**~~ — cerrado
  2026-07-27: `redistribuirGrupo` devuelve los omitidos con `monto: '0.0000'` y
  `recalcularParticipantesExistentes` los persiste junto con los activos. Detalle original:
  (backend,
  `propinas/liquidacion-propinas.service.ts:996-1009` y `:1026`) — `redistribuirGrupo`
  devuelve `omitidos` sin tocar `monto` y `recalcularParticipantesExistentes` solo re-guarda
  `activos`. Hoy no paga de más (reportes e impresión filtran `incluido = true`), pero el
  dato en reposo miente; y si se excluye a **todos** los de un grupo, el `montoGrupo` no
  queda en ninguna fila con `incluido = true` y desaparece sin que nada lo señale.
- [x] ~~**Dos cajas abiertas del mismo usuario bajo concurrencia**~~ — cerrado 2026-07-27
  con el índice único parcial `ux_cajas_activa_por_usuario` sobre `(tenant_id, usuario_id)`
  con `WHERE tipo='fisica' AND estado IN ('abierta','en_conciliacion')`, declarado en la
  **entidad** (que es lo que `synchronize` crea de verdad) y replicado en `startup-pos.sql`.
  Incluye `en_conciliacion`, así que también cubre el hueco que el comentario del índice de
  cajón dejaba explícitamente a cargo del service. El `catch` del 23505 ahora distingue por
  `constraint` y devuelve el mensaje que corresponde: "ya tenés una caja" y "el cajón está
  ocupado" mandan al usuario a hacer cosas distintas.
  Tests: un e2e que assevera que el índice **existe con su forma** (leyendo `pg_indexes`;
  borrarlo del entity lo hace fallar) y un unit parametrizado del mapeo de cada constraint a
  su mensaje.
- [x] ~~**"Diferencia" significa dos números distintos según la pantalla**~~ — cerrado
  2026-07-27: el listado del historial emite `diferenciaTotal`, la suma de **todas** las
  líneas del arqueo congelado, y la columna pasa a mostrar ese campo. `cajas.diferencia` se
  queda como está —es deliberadamente el cuadre del **cajón físico**— y ahora ambos campos
  dicen en el tipo cuál es cuál. El total sale por `LEFT JOIN LATERAL` con un `SUM` en la
  **misma** query del listado: una sola consulta para todas las filas, sin N+1 y sin agrupar
  por las 13 columnas. Una caja abierta todavía no tiene arqueo congelado → `null` → "—".
  El e2e cierra una caja con el efectivo cuadrado y -500 en tarjeta y verifica los dos
  campos por separado (`diferencia` = 0, `diferenciaTotal` = -500), que es exactamente el
  caso que el historial mostraba como "+0".
- [x] ~~**`etiquetasGarzones` no filtra `eliminado_el IS NULL`**~~ — cerrado 2026-07-27
  agregando el filtro, que es lo que manda la invariante de soft delete y lo que hacían ya
  sus tres queries hermanas del mismo archivo. El fallback `'Trabajador eliminado'` deja de
  ser código muerto y el test lo ejerce. Detalle original: (backend,
  `propinas/propina-reportes.service.ts:643-651`) — contra la invariante de soft delete y
  contra sus tres queries hermanas del mismo archivo, que sí filtran. La prueba de la
  intención: deja **inalcanzable** el fallback `'Trabajador eliminado'` (`:203`). **Al
  cerrarlo hay una decisión chica:** filtrar (y el fallback revive) **o** documentar la
  excepción deliberada, como ya se hizo con `metodos_pago` en `caja/caja.service.ts:322`,
  donde el nombre histórico es intrínseco al movimiento.
- [x] ~~**Un garzón en dos grupos revienta la liquidación con un 23505 crudo**~~ — cerrado
  2026-07-27 **con la salida acotada que decidió el owner**: no se cambió el modelo, se
  cambió el crash por un 400 accionable. `assertGarzonEnUnSoloGrupo` corre en los **cuatro**
  puntos de entrada; en crear, liquidar y **el preview** corta antes de escribir nada (así
  que se ve antes de intentar liquidar), y en `actualizarConfig` corre después de rehacer el
  snapshot, dentro de la misma transacción que revierte. El mensaje nombra a la persona, sus dos grupos, y
  la fecha de corte sugerida —el primer tip del rol que arrancó después—, de modo que
  liquidar hasta ahí deja cada rol en su propia liquidación sin tocar la configuración.
  ⚠️ **Queda abierto el cambio de modelo** (que la persona cobre en los dos grupos): es
  índice `(liquidacion_id, grupo_id, garzon_id)` **más** re-keyear los ajustes, que hoy se
  identifican solo por `garzonId` —excluir la sacaría de los dos grupos y un monto manual
  escribiría el mismo número en sus dos filas, rompiendo la conservación de ambos—. Toca
  DTO, service, composable, la página y la impresión por persona: medio día a un día, con
  la decisión de cómo se imprime adentro. Se encara si el caso aparece de verdad.
  ⚠️ **Dos precisiones que dejó la revisión independiente:** la fecha de corte sale solo de
  los tips, así que si la persona tiene una sesión del primer rol que se extiende más allá
  del corte, el conflicto reaparece en el segundo intento (vuelve a cortar con el mismo 400,
  no genera datos malos, pero un solo corte no alcanza y hay que acotar turnos). Y falta un
  test dedicado del conflicto por el camino de `actualizarConfig`: hoy solo se ejerce por
  `crear`, aunque ambos comparten la misma función.
  Detalle original: (backend + BD,
  `startup-pos.sql:1606`, `propinas/liquidacion-propinas.service.ts:1216-1236`) —
  `uq_liquidacion_propinas_participante_garzon` es único por `(liquidacion_id, garzon_id)`,
  **sin `grupo_id`**, y `buildParticipantesData` itera por grupo sin deduplicar. Un garzón
  reclasificado a mitad de período (`UpdateGarzonDto.tipo` es editable) genera tips con dos
  `tipo_garzon`, la liquidación arma dos participantes con el mismo `garzonId`, el segundo
  `INSERT` viola el índice y **nadie del período puede liquidarse**. Tensión con la doc: el
  motor documenta la pertenencia por el snapshot `tipo_garzon` del tip y no por
  `garzon.tipo`, lo que hace el caso alcanzable por diseño; el esquema no lo soporta.


### Baja

- [x] ~~**`registrarMovimientoEnTransaccion` no valida signo ni estado de la caja**~~ —
  cerrado 2026-07-27 en el eje del signo, con **dos** capas: el helper rechaza negativos con
  422, y `movimientos_caja` gana un `CHECK ("monto" >= 0)` declarado en la entidad (lo que
  `synchronize` crea) y replicado en el `.sql`. Ese CHECK cubre cualquier camino, presente o
  futuro, sin depender de que alguien se acuerde del guard.
  ⚠️ **Es `>= 0`, no `> 0`, y el primer intento fue `> 0`.** La revisión independiente lo
  bloqueó reproduciendo contra el backend real una venta legítima que devolvía 422: cuando
  un pago se devuelve **íntegro** como vuelto, su `montoNeto = monto − vuelto` da 0
  (`pagos.service.ts`), y el guard tumbaba la venta entera. El movimiento en cero no altera
  el esperado del arqueo y conserva la traza del pago. Hay un e2e con dos pagos en efectivo
  —uno devuelto entero— que lo fija, y el unit acepta 0 explícitamente.
  **Lección:** endurecer un límite exige enumerar quién lo produce hoy, no suponerlo. Mi
  texto original afirmaba que ningún caller producía `<= 0`: era cierto para negativos y
  falso para el cero, justo el vecino del bug que este mismo hilo venía a cerrar.
  El eje del **estado** queda como está a propósito: el patrón del módulo es "el caller toma
  `bloquearCajaAbierta` y el helper confía", y re-chequear acá sería una query extra por
  venta duplicando el lock que el llamador ya tiene. Detalle original: (backend,
  `caja/caja.service.ts:785-809`) — recibe un objeto plano y lo inserta tal cual: sin
  `@IsDecimalPositivo` (que solo cubre el camino HTTP vía `CrearMovimientoDto`) y sin
  verificar el estado. `startup-pos.sql:886` tampoco tiene `CHECK` sobre `monto`. Hoy **no
  es explotable**: sus dos llamadores (`ventas.service.ts`, `pagos.service.ts`) toman
  `bloquearCajaAbierta` antes y ya no producen montos negativos desde el fix del vuelto. Es
  endurecimiento del chokepoint por donde entró ese bug, no un bug activo. Cierra el hilo
  que la auditoría de ventas mandó acá: defendido en el endpoint, no en el método compartido.
- [x] ~~**`asegurarDefault` de propinas devuelve 500 en el primer uso concurrente**~~ —
  cerrado 2026-07-27: el 23505 se atrapa y se relee la config que ganó la carrera; cualquier
  otro error se propaga (hay un test por cada lado). Mismo patrón que `caja.abrir()`.
  Detalle original: (backend,
  `propinas/propina-distribucion.service.ts:68`) — el `lock: pessimistic_write` sobre una
  fila que **todavía no existe** no bloquea nada; dos requests insertan y el segundo viola
  `uq_propina_config_tenant` (`startup-pos.sql:1457`) sin `catch`. No corrompe (el índice
  hace su trabajo) y se cura tras el primer insert. El patrón correcto está tres módulos más
  allá, en `caja/caja.service.ts:241`.
- [x] ~~**El monto manual de propina no valida signo en el DTO**~~ — cerrado 2026-07-27:
  los dos campos usan `@IsDecimalNoNegativo()`, así que el negativo se rechaza con 400 en
  vez de llegar al `CHECK` de BD como 500 — y el **preview**, que no persiste y por eso no
  tocaba ese CHECK, deja de devolver una propina negativa. Detalle original: (backend,
  `propinas/dto/ajustes-reparto.dto.ts:14`, `propinas/dto/update-liquidacion.dto.ts:34`) —
  `@IsNumberString()` a secas acepta `'-5000'`; son los dos campos que quedaron fuera del
  barrido de signo de `74f3f35`. **No llega a persistir**: `chk_liquidacion_participante_metricas`
  (`startup-pos.sql:1595`) exige `monto >= 0`. Queda un 500 crudo donde correspondía un 400,
  y el **preview** (que no persiste) devolviendo una propina negativa en pantalla.
- [x] ~~**`crearFuentes` inserta fila por fila sobre un conjunto sin tope**~~ — cerrado
  2026-07-27 con un solo `save` del array. **Verificado empíricamente, como pedía esta
  entrada**: con `log_statement='all'` en Postgres, la suite e2e de propinas produce **dos**
  sentencias `INSERT INTO liquidacion_propinas_fuente` —una de 12 filas y otra de 3—, o sea
  un INSERT multi-fila por liquidación y no uno por tip. El test lo fija asserteando que
  hubo un único `save` y que recibió un array. Detalle original: (backend,
  `propinas/liquidacion-propinas.service.ts:1187-1195`) — dentro de la transacción de
  `liquidar()`, y `buscarTipsElegibles` no tiene `LIMIT`, así que N = ventas con propina del
  período. Al cerrarlo, **verificar de verdad** que `save(array)` colapsa a un INSERT
  multi-fila y no a N inserts igual.

### Huecos de test (el gate verde no los ve)

- [x] ~~**Eliminar la rama muerta `MANUAL`+`MONTOS` de `repartirGrupo`**~~ (backend,
  `propinas/liquidacion-propinas.service.ts`) — cerrado 2026-07-29: se borró. Los dos
  caminos se **verificaron leyendo el código antes de tocarlo**, no se tomaron de esta
  entrada: `redistribuirGrupo:1069` chequea el par por su cuenta y se queda con `delGrupo`
  sin llamar a `repartirGrupo`; y por `buildParticipantesData:1458` los borradores entran
  con `monto: '0.0000'` (fijado en `crearParticipanteData:1611`), así que devolverlos tal
  cual daba lo mismo que el camino normal —`pesoParticipante` no puntúa ese par, `sumaPesos`
  queda en 0 y el retorno temprano produce el mismo `'0.0000'`—.
  **Sin test, a propósito y documentado en el código:** la rama era inobservable, así que
  ningún test podía discriminarla; lo que sostiene el cambio son las 76 pruebas de
  `propinas` en verde y un comentario en el lugar donde estaba, para que no la reintroduzca
  quien lea el `if` de `redistribuirGrupo` y lo crea faltante acá.

- [x] ~~**El guard de estado de la caja no lo ejercita ningún test real**~~ — cerrado
  2026-07-27 con tres e2e: una caja **cerrada** y una **en conciliación** rechazan el
  movimiento, y una nota de crédito con devolución no puede sacar plata de una caja en
  conciliación.
  ⚠️ **El detalle que importa:** `registrarMovimiento` chequea el estado **dos veces** (el
  lock y un `findOne` posterior), así que relajar solo `bloquearCajaAbierta` queda tapado
  por el otro — lo comprobé y el mutante sobrevivía. El camino de la **nota de crédito** es
  donde ese lock está solo, y ahí el mutante de una sola capa sí mata el test. Es defensa en
  profundidad real, no debilidad del test, pero conviene saber cuál es el que discrimina.
  Detalle original: (test,
  `caja/caja.service.spec.ts:209`, `:460`, `:827`) — los tres mockean
  `managerMock.query.mockResolvedValueOnce([])` sin relación con el SQL emitido: el
  resultado lo decide el mock, no el `WHERE estado='abierta'`. Y `test/caja.e2e-spec.ts`
  nunca intenta escribir contra una caja `cerrada`/`en_conciliacion`. Relajar el filtro a
  `estado IN ('abierta','en_conciliacion')` no rompe nada. Es justamente la defensa que dos
  lentes dieron por buena leyendo el código.
- [x] ~~**El criterio `MANUAL` (`PESOS` y `MONTOS`) no tiene ningún test de reparto**~~ —
  cerrado 2026-07-27: `MANUAL/PESOS` reparte 3:1 por el peso configurado, y `MANUAL/MONTOS`
  se cubre por donde de verdad importa —**recalcular** una liquidación existente no pisa los
  montos fijados a mano—, no por el preview, donde los ajustes escriben el monto **después**
  del reparto y la rama es irrelevante.
  ⚠️ **La rama `MANUAL+MONTOS` de `repartirGrupo` es código muerto CONFIRMADO, y sigue sin
  test que la discrimine** — a propósito, porque no se puede escribir uno honesto. Está
  muerta por dos caminos: `redistribuirGrupo` tiene su **propio** chequeo de
  `MANUAL+MONTOS` que la saltea antes de llegar, y el único call site que sí la alcanza
  (`buildParticipantesData`) produce el mismo `'0.0000'` que daría el retorno temprano de
  "suma de pesos cero". Borrarla no cambia ningún resultado observable.
  Escribí un test que decía cubrirla y **no la cubría**: pasaba por el mecanismo genérico de
  `ajustes.montosManuales`, que pisa el monto para cualquier criterio después del reparto.
  Lo saqué en vez de dejarlo dando una falsa sensación de cobertura. **Cierre correcto:**
  eliminar la rama, no testearla. Detalle original: (test) —
  el único `criterio` ejercido en `liquidacion-propinas.service.spec.ts` y en el e2e es
  `PARTES_IGUALES`/`VENTAS_NETAS`. `validarManualMontos` se puede borrar entera sin que
  falle nada. (`propina-distribucion.service.spec.ts` sí prueba `MANUAL`, pero solo a nivel
  **config**, no de reparto.)
- [x] ~~**El test de partes iguales no discrimina `PARTES_IGUALES` de `CANTIDAD_CUENTAS`**~~
  — cerrado 2026-07-27 con un fixture **asimétrico** (un garzón cierra dos cuentas y el otro
  una), que es lo que separa las dos fórmulas: 75/75 contra 100/50. Tres mutantes cruzados
  verificados —que partes iguales devuelva cuentas, que cuentas devuelva 1, y que el peso
  manual se ignore— y cada uno mata su propio test. Detalle original:
  (test, `propinas/liquidacion-propinas.service.spec.ts:151-186`) — el fixture da
  exactamente 1 tip a cada garzón, así que `cuentas = 1` para ambos y las dos fórmulas dan
  `75.0000`/`75.0000`. `CANTIDAD_CUENTAS` no aparece en ningún test. Es el mismo error del
  test del vuelto (ver [`anti-patterns.md`](anti-patterns.md)): el escenario tiene que
  descartar las implementaciones incorrectas, no coincidir con ellas.
- [x] ~~**`actualizarConfig` no assertea `result.participantes`**~~ — cerrado 2026-07-27
  junto con el fix de conservación: su fixture tenía pool 150 y **cero tips**, un estado
  imposible, y ahora ejerce el reparto de verdad (VENTAS_NETAS sobre bases 1000 y 500 → 100
  y 50; con el criterio viejo daría 75/75). Detalle original: (test,
  `propinas/liquidacion-propinas.service.spec.ts:348-389`) — si `crearParticipantes`
  devolviera siempre `[]` el test sigue verde, porque el fixture monta `tips = []`.
- [x] ~~**El e2e de historial por `cajonId` no discrimina**~~ — cerrado 2026-07-27: ahora
  abre la caja el **cajero** y consulta el **supervisor**, que es para lo que existe la rama
  `cajonId && tieneVerTodas`. Antes consultaba el mismo usuario que había abierto, así que
  el filtro "solo mis cajas" daba idéntico resultado y borrar la rama no rompía nada.
  Detalle original: (test,
  `test/caja.e2e-spec.ts:331-339`) — quien consulta es el mismo usuario que abrió la caja,
  así que borrar la rama `cajonId && tieneVerTodas` (`caja/caja.service.ts:949`) sigue dando
  200 con array no vacío. Solo assertea `status` y `Array.isArray`.

### Decidido por el owner (2026-07-27)

- [x] ~~**Un grupo sin peso agregado aborta la liquidación entera**~~ — cerrado 2026-07-27.
  **Decisión del owner: el pool se reparte siempre entero.** Un grupo del que nadie puede
  cobrar no reserva su porcentaje; su parte se redistribuye entre los que sí pueden. Al
  implementarlo apareció que la misma situación tenía **dos comportamientos opuestos** según
  hubiera o no una fila de sesión: con participantes en peso 0 reventaba la liquidación
  entera, y con cero participantes el `montoGrupo` **desaparecía en silencio** (la suma
  repartida daba menos que el pool). Ahora `montosPorGrupo` reparte solo entre los grupos
  elegibles y `repartirGrupo` deja en 0 a los que no pueden, sin lanzar. Si **ningún** grupo
  puede recibir y hay pool, corta con un 400 que dice qué revisar; un período sin propinas
  sigue siendo válido con todos en cero. Regla escrita en
  [`liquidacion-propinas-motor.md`](../features/liquidacion-propinas-motor.md).

### Refutados (no entran)

Hallazgos que **no** sobrevivieron a la refutación. Se conservan para que la próxima
pasada no los vuelva a reportar como nuevos.

- **Tres "N+1" de escritura** (`liquidacion-propinas.service.ts:1026`, `:365-374`, `:961`),
  uno reportado como alta — no son el N+1 que prohíbe la invariante, que habla del **dato
  derivado por fila en una lectura**. Escribir N filas con valores distintos exige N
  `UPDATE`, y `save(array)` no los colapsa. Queda el punto real (tiempo con el lock tomado),
  pero eso es contención, no N+1, y hoy no tiene escenario de daño.
- **`UPDATE` de `anular()` sin `eliminado_el IS NULL` sobre `venta_propina`** — no existe
  ningún `softDelete` sobre esa tabla, así que no hay fila borrada que tocar. Sin escenario
  reproducible no entra.
- **`porcentaje` de grupo sin validar signo** — un grupo negativo compensado por otro >100%
  pasa la config, pero falla en el reparto antes de persistir dinero. Guard tardío, no
  dinero mal calculado.

---

## Refactor Caja → "Mi caja" / "Cajas"

Sub-proyectos entregados del brainstorm del 2026-07-23. Los poderes del encargado que
siguen diferidos están en `pendientes.md`.

- [x] **Refactor de IA/permisos — HECHO** (2026-07-23) — módulo `Caja` renombrado a
  `MiCaja` (mismo id, `Leer`/`Crear`/`Actualizar`/`Eliminar`); módulo nuevo `Cajas`
  (solo `Leer`); `Ver todas` dejó de asociarse a caja; guards remapeados por endpoint en
  `caja.controller.ts` (mismo controller/service, rutas `/caja/*` sin cambio); dos
  superficies frontend `/mi-caja*` y `/cajas*` (`/caja` redirige a `/mi-caja`);
  escrituras siguen owner-only aun con `Cajas:Leer`. Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#modelo-de-acceso-por-permiso).
- [x] **Sub-proyecto A — Arqueo de caja multi-medio — HECHO** (2026-07-24) — resuelve el
  §3 de la investigación (faltante fantasma / esperado mezclado): el cierre pasa de un
  número a una línea esperado-vs-contado por método (`es_efectivo` global +
  `requiere_conteo` por tenant, tabla `caja_arqueo_medio` congelada, `GET
  /caja/:id/arqueo`, `POST /caja/:id/cerrar` multi-línea). Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#arqueo-de-caja-multi-medio-sub-proyecto-de-negocio-a-post-estructura).
- [x] **Sub-proyecto B — Cierre ciego — HECHO** (2026-07-24) — resuelve la mitad barata de
  §5/§6 de la investigación (blind count): config por tenant `tenants.arqueo_ciego`
  (default `false`, `GET`/`PUT /caja/arqueo-ciego` con `Cajas:Leer`/`Actualizar`); en modo
  ciego + caja abierta `GET /caja/:id/arqueo` retiene `esperado:null` y filtra a solo
  líneas obligatorias (nadie ve el esperado de una caja abierta, ni dueño ni supervisor);
  respuesta cambia de `LineaArqueo[]` a `{ ciego, lineas }`; caja cerrada siempre revela;
  `cerrar` sin cambios (su respuesta es la revelación); drawer ciego revela por
  redirección al detalle. Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#cierre-ciego-modo-anti-fraude).
  "Ocultar el resultado post-cierre" **sigue** diferido incluso después del sub-proyecto C
  (ver [investigación
  §6](investigaciones/2026-07-23-gestion-caja.md#6-poderes-del-encargado-sobre-la-caja-del-cajero-investigación-2026-07-23)),
  en [`pendientes.md`](pendientes.md).
- [x] **Sub-proyecto C — Cierre en dos fases + motivos de diferencia — HECHO** (2026-07-24)
  — resuelve la conciliación operador→supervisor de §6 y los motivos categorizados de §5:
  fase 1 `POST /caja/:id/conteo` congela el arqueo server-side (inmutable desde ahí) y
  bifurca a auto-cierre (todo cuadró) o `estado='en_conciliacion'` (algún descuadre); fase
  2 `POST /caja/:id/cerrar` (owner-**o**-admin, única escritura no estrictamente
  owner-only del controller) exige un motivo categorizado — o comentario si el tenant no
  tiene motivos activos (red de seguridad) — por línea descuadrada y finaliza sin
  recalcular nada; `en_conciliacion` ocupa igual que `abierta` (bloquea abrir otra caja, el
  cajón, ventas y movimientos); catálogo `motivo_diferencia_caja` admin-only (mismo patrón
  que `causas_merma`); override admin `PATCH /caja/:id/arqueo/motivos` corrige motivos de
  una caja ya cerrada. **No** es el cierre forzado de §6 (el admin solo *finaliza* una
  conciliación que el dueño ya congeló, nunca inicia el conteo de una caja ajena) — ese
  ítem sigue diferido en [`pendientes.md`](pendientes.md). Detalle:
  [`docs/features/gestion-cajas.md` § Cierre en dos fases](../features/gestion-cajas.md#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c).

## Auditoría `items` + `calculo-precios` (2026-07-28)

### Alta

- [x] ~~**Los grupos de un componente-combo se descuentan aunque el componente se haya
  omitido por falta de stock**~~ — cerrado 2026-07-28 (`items.service.ts`). Si un componente
  `receta` no bloqueante no alcanzaba el stock, el pre-chequeo hacía `continue` y lograba
  "cero escrituras" por él, pero después del loop `gruposComponentes` se armaba con **todo**
  `snapshot.componentes`: el combo se vendía sin la hamburguesa y la chuleta elegida para
  esa hamburguesa se descontaba igual. Ahora los componentes omitidos se registran en un
  `Set` y se filtran antes de llamar a `venderOpcionesGrupos`. **La regla la fijó el owner**
  ("se descuenta lo que se sirvió"), y el fix no la inventa: hace consistente una decisión
  que el código ya tomaba dos líneas antes. Cubierto por
  *"componente omitido por falta de stock → tampoco descuenta sus grupos de modificadores"*;
  mutante verificado (sin el filtro, `venderOpcionesGrupos` se llama 2 veces en vez de 1).
- [x] ~~**Vender un extra cuyo catálogo cambió tras congelar el snapshot descuenta 1000× de
  más**~~ — cerrado 2026-07-28 (`items.service.ts`). El fallback
  `cat?.ingredienteUnidadMedida ?? extra.unidadCodigo` sustituía la unidad **de stock** por
  la de la **porción** cuando el extra ya no estaba en `receta_extras_permitidos`, y
  `convertirUnidad` terminaba convirtiendo una unidad a sí misma: 20 g de queso descontados
  como 20 kg. La unidad de stock ahora se resuelve por id contra `items`+`item_producto`,
  que es donde vive, en vez de contra la lista de extras de la receta — eso saca la causa,
  no el síntoma. Si el ingrediente ya no existe en el catálogo, **no se descuenta y se
  advierte** — no se mueve stock de un ítem borrado, mismo criterio que ya usaba
  `venderOpcionesGrupos` con una opción borrada, más la advertencia que aquel no emite.
  **Lo que cubre cada test, sin inflar el recibo** (corregido por la revisión independiente,
  que refutó la primera versión de este párrafo): los **dos unit** son los que discriminan
  fix de pre-fix — uno fija que la búsqueda va por id de ingrediente y tenant en vez de por
  la receta, el otro cubre la rama del ingrediente ausente; los dos con mutante verificado.
  El **e2e nuevo** (`recetas.e2e-spec.ts` §7) **no** distingue el fix del código anterior:
  su extra sigue en la carta, así que la búsqueda vieja también encontraba `kg` y el
  resultado era idéntico. Lo que aporta es real pero es otra cosa: ejecuta el SQL nuevo
  contra Postgres —ningún e2e tocaba `extras`, así que la query no se había ejecutado nunca—
  y deja fija la conversión g→kg.
  **Y el escenario del hallazgo original no es alcanzable hoy.** La auditoría supuso que el
  flujo de Salones cobraba con el snapshot congelado; no lo hace: `cerrarCuenta`
  (`salones.service.ts:653-720`) lo mapea de vuelta a **solo ids** y `ventas.service.ts`
  lo **re-resuelve** contra el catálogo vivo en la misma transacción que descuenta, así que
  un extra fuera de carta muere en el mismo `400` que por `POST /ventas`
  (`items.service.ts:1937`). O sea que este fix es **corrección y defensa en profundidad**,
  no el cierre de un agujero explotable.
  **La invariante que en realidad sostiene esto —y que no estaba escrita en ningún lado—**
  es que *todo snapshot se re-resuelve en la misma transacción que descuenta stock*. El día
  que alguien persista un snapshot y lo reutilice sin re-resolver (que es, conceptualmente,
  para lo que un snapshot existe), este bug y su hermano del combo se vuelven reales. Queda
  registrada acá porque es el supuesto del que cuelgan los dos fixes.

### Alta (continuación)

- [x] ~~**El motor de precios resuelve cada línea con el `findOne` pesado**~~ — cerrado
  2026-07-28. Era el hilo que la pasada de `ventas` dejó anotado, y sobrevivía **del lado
  del precio**: `cargarBasePorIds` había resuelto la persistencia de la venta, no el
  cálculo. Cierre: `ItemsService.cargarReglasPorIds` —una query con `UNION ALL` sobre las
  tres tablas puente— acompaña a `cargarBasePorIds`, y `calcular()` carga el carrito
  entero en **2 queries fijas** antes del loop en vez de 4+ por línea. `resolverLinea`
  dejó de ser `async`: ya no hace I/O. Beneficia **en la capa de precio** a los tres
  llamadores (`ventas`, `suscripciones`, `online`) — pero no cierra el request entero:
  el checkout online sigue con su propio `findOne` por línea antes de llamar al motor,
  anotado como entrada propia en [`pendientes.md`](pendientes.md) para no perderle el
  rastro al cerrar esta.
  **Lo que hizo falta decidir y no se decidió acá:** el orden de las reglas cambia el total
  en modo `compuesto`, y no estaba definido en ninguna query. El `ORDER BY` nuevo lo vuelve
  determinista por id; qué orden *debería* tener quedó abierto como decisión de negocio en
  [`pendientes.md`](pendientes.md), con el insumo de mercado que aportó el owner.
  ⚠️ **Corregido por la revisión independiente, que bloqueó el cierre:** la primera versión
  de este párrafo afirmaba que el `ORDER BY` *reproducía* el orden previo y que por lo tanto
  batchear no podía mover ningún total. **Es falso, y se verificó con `EXPLAIN`:** estas
  tablas resuelven con `Bitmap Heap Scan`, que reordena por página del heap, así que las
  queries por ítem devolvían orden de **inserción**, no de índice. El cambio sí puede dar un
  total distinto en un tenant `compuesto` que mezcle `monto_fijo` con porcentaje en un mismo
  ítem. Que hoy no exista ninguno (ambos tenants del seed en `base`, ningún ítem con dos
  reglas de la misma clase, sin datos productivos) es lo que lo vuelve inocuo — **no** la
  garantía que se había escrito. La lección es la misma de
  [`anti-patterns.md`](anti-patterns.md): una afirmación deducida ("la PK es compuesta,
  luego el orden es el del índice") no es una afirmación verificada.
  **Tests, con mutante verificado cada uno:** uno fija que N líneas producen un número
  **constante** de cargas (el mutante que vuelve a cargar por línea lo mata), otro cubre el
  agrupado de las tres clases en `cargarReglasPorIds`. Y se comprobó **empíricamente que el
  e2e ejecuta la query nueva**, en vez de asumirlo: con la clase de impuesto mal etiquetada,
  `ventas.e2e-spec.ts` pasa de 26 verdes a 15 fallos.
- [x] ~~**La resolución de recargos por id nunca corre con datos**~~ — cerrado 2026-07-28,
  junto con el batch de arriba. El fixture fijaba `recargosIds: []` en los 9 tests, así que
  un mutante que le pasara el mapa de descuentos sobrevivía. Al reescribir el fixture para
  los dos loaders nuevos, dejar la tercera lista sin ejercer habría repetido el mismo hueco
  sobre código recién escrito. Hay un test con un recargo real y el mutante muere. Queda
  abierta la mitad de `ventas.service.spec.ts` (otro archivo, otro alcance).
- [x] ~~**`online.service.ts` sigue con un `findOne` por línea en el checkout**~~ — cerrado
  2026-07-28, resto del N+1 del motor de precios. `prepararLineasCheckout` iteraba
  `dto.lineas` llamando al `findOne` pesado para leer **solo** `tipo` y `unidadMedida`;
  ahora una sola `cargarBasePorIds` para todo el carrito, que ya trae los dos campos y
  lanza el mismo 404. Las validaciones por línea (`assertPresentacionPareada`) se movieron
  **antes** de la carga, para no repetir el cambio de precedencia 400↔404 que la revisión
  independiente había marcado en el fix hermano.
  Lo fija un test con mutante verificado (volver a cargar por línea sube el contador de 1
  a 3). **Sin SQL nuevo**: reutiliza un método que el e2e de ventas ya ejecuta contra
  Postgres — distinto del caso de los extras, donde la query era nueva y hubo que probarla.
  ⚠️ **Hueco de cobertura preexistente, que este fix no cierra:** ningún e2e toca el
  checkout online. Lo cubierto acá es unit.

### Media / Baja — los tres N+1 restantes de la pasada

- [x] ~~**`findOne` de una receta con 5 grupos son 6 queries**~~ — cerrado 2026-07-28: los
  grupos del propio ítem salen de `cargarGruposPorItem`, la función batcheada que ya vivía
  en el mismo archivo y que `findOne` **ya usaba** para los componentes de un combo. 2
  queries fijas en vez de 1 + N, y ~60 líneas menos de duplicación. La discriminación quedó
  demostrada al revés y sirve igual: la aserción que fijaba los parámetros de la query por
  grupo (`['grupo-1', TENANT, 'item-grupo-1']`) **falló** contra la implementación nueva
  (`[['item-grupo-1'], TENANT]`). El test ahora fija esos params batcheados y el total de
  queries.
- [x] ~~**`aplicarDesfases`/`descartarDesfases` hacen 3-4 queries por receta**~~ — cerrado
  2026-07-28. Resultó **peor que lo reportado**: además de las 2 lecturas por receta, el
  costo propuesto llamaba `convertirUnidad` **una vez por ingrediente** — un N+1 anidado, y
  con `convertirUnidades` ya escrito al lado para exactamente esto. Ahora son 2 lecturas
  para todo el lote + 1 carga de unidades para todos los ingredientes de todas las recetas.
  **Beneficia también al camino de lectura**: `listarDesfases` compartía el mismo helper y
  tenía el mismo N+1 anidado. Los `UPDATE` siguen siendo N — son escrituras de N filas, no
  un N+1.
  **El loop por receta se conservó a propósito**, para que el orden en que fallan las
  validaciones no cambie: si la receta B no existe y la A no tiene ingredientes, sigue
  ganando el error de A. Es la precedencia 400↔404 que la revisión independiente ya había
  marcado dos veces ese día. ⚠️ **La primera versión no lo lograba y la revisión lo
  bloqueó:** el cálculo del costo corría *antes* del loop y **también lanza** (unidad no
  reconocida, magnitudes incompatibles), así que adelantaba ese 400 por encima del 404.
  Cerrado con `CatalogService.crearConversor()`: el catálogo se carga una vez —una lectura
  que no lanza— y la conversión vuelve a ocurrir dentro del loop, en su punto original.
  Mutante verificado: crear el conversor dentro del loop en vez de afuera sube
  `crearConversor` de 1 a N.
- [x] ~~**Las tres `validarY…` hacen un `SELECT` por fila del payload**~~ — cerrado
  2026-07-28 con `filasValidacionPorIds`: una query para todos los ids del payload,
  compartida por ingredientes, componentes y extras. Los tres loops quedan intactos, así que
  ninguna validación cambia de orden (la carga no lanza).
  ⚠️ **Lo que el fix destapó en los tests:** al pasar a un lookup por id, varios tests de
  **rechazo** empezaron a pasar por la razón equivocada — su fila mockeada no traía
  `item_id`, así que el lookup no la encontraba y el error saltaba antes de evaluar el tipo
  o el modo de inventario. Se corrigieron esos mocks además de los que fallaban.
  Dos mutantes, cada uno en el nivel que le corresponde: cargar por fila hace que el unit
  cuente 2 SELECT en vez de 1; truncar el lote al primer id no lo ve el unit (el mock ignora
  los parámetros) pero **rompe 6 tests de `recetas`/`combos` e2e** contra Postgres real.
  ⚠️ **Segundo bloqueo de la revisión, también correcto:** la primera versión dejaba el
  `convertirUnidad` por fila de `validarYCostearIngredientes` y `validarExtrasPermitidos`,
  argumentando que batchearlo cambiaría el orden en que fallan dos 400 distintos. Era una
  excusa: ese argumento solo refuta la variante de resolver todas las conversiones antes
  del loop. La tercera variante —cargar el catálogo una vez y convertir en memoria **en el
  mismo punto del loop**— no mueve ningún error, y la pieza pura para hacerlo
  (`convertirConMapa`) ya existía sin exponer. Se agregó `CatalogService.crearConversor()`
  y los dos loops quedaron sin query por iteración.
  El costo por fila **no se había eliminado, se había cambiado de tabla**: el pendiente
  hablaba de 15 `SELECT` para 15 ingredientes, y tras el primer intento eran 1 batch + 15
  lecturas de `unidades_medida`.

### Media / Baja — cerrados el 2026-07-29

- [x] ~~**`precio_base` se puede crear o editar en negativo**~~ (backend,
  `dto/create-item.dto.ts`, `dto/update-item.dto.ts`) — cerrado 2026-07-29 con
  `@IsDecimalNoNegativo()` en los dos DTOs, que es donde estaba el agujero: la columna no
  tiene `CHECK` (`startup-pos.sql`), así que el DTO era la única barrera y solo pedía
  `@IsNumberString()`. Completa el barrido de positividad de jul-2026, que se había detenido
  en el borde de los tres módulos auditados (ventas, caja, propinas) y dejó el catálogo
  afuera.
  **El criterio es `>= 0`, no `> 0`, y no es una preferencia:** el `0` lo genera el sistema
  solo —`items.service.ts` fuerza `'0'` para `tipo === 'ingrediente'` en create y en
  update—, así que exigir positivo estricto tumbaría un caso propio. Lo que no tiene lectura
  posible es el negativo: `precioUnitario: '-100'` sin reglas da `totalFinal: -100` y ninguna
  invariante del motor lo neutraliza (ver la nota de la entrada original).
  Lo fija `dto/dinero-signo.dto.spec.ts` (creado como `precio-base.dto.spec.ts`, renombrado
  al extenderse a los demás campos de dinero del módulo) con 6 casos y **los 2 RED verificados** (los de
  negativo fallaban contra el código anterior; los 4 de aceptación ya pasaban antes, que es
  lo que prueba que el payload es válido y los RED no fallaban por otra razón): 0 y decimales
  aceptados en create, ausencia y 0 aceptados en update —el `@IsOptional()` sigue
  funcionando—, y `-100` / `-0.01` rechazados en cada uno.

- [x] ~~**`remove()` chequea uso sin filtrar por tenant**~~ (backend, `items.service.ts`) —
  **la entrada estaba vieja: ya no aplicaba** (verificado 2026-07-29). Sus tres líneas
  citadas (`:1514`, `:1528`, `:1542`) no existen más; hoy `remove()` delega en
  `obtenerUsoItem`, que filtra por `tenant_id` en las **cuatro** ramas del `UNION` —vía la
  entidad padre de cada una (`items`, `grupos_modificadores`)— y sus `UPDATE` llevan
  `tenant_id = $2`. Lo cerró de paso la oleada de `GET /items/:id/uso`, sin que nadie sacara
  la entrada. Cero cambios de código en este cierre.
- [x] ~~**`precioUnitario` negativo en `/calculo-precios/calcular`**~~ (backend,
  `dto/calcular.dto.ts`) — cerrado 2026-07-29 con `@IsDecimalNoNegativo()`, el mismo
  decorador que ya exige el camino real de venta. RED verificado: antes devolvía **201** con
  `precioUnitario: '-100'` (y `totalFinal: -100`), ahora 400. El `0` sigue siendo válido a
  propósito: prohibirlo es la decisión de owner que sigue abierta para `LineaVentaDto`, y
  este cierre no la adelanta.
- [x] ~~**No se puede vaciar `descripcion` ni `categoriaId` al editar un ítem**~~ (frontend,
  `configuracion/items.vue`) — cerrado 2026-07-29. Tres cosas, no una:
  - El `|| undefined` de `descripcion`/`categoriaId` colapsaba lo falsy y el campo no
    viajaba. Ahora en **edición** se manda `''` y `null` respectivamente; en creación se
    sigue omitiendo, para no escribir `''` donde antes quedaba NULL.
  - `duracionEstimada` pasó a `typeof === 'number'`: el `|| undefined` tapaba el `0`, que el
    DTO acepta (`@IsInt() @Min(0)`).
  - **Faltaba la mitad que la entrada no mencionaba:** sin una opción explícita
    "Sin categoría", un ítem que ya tiene categoría **no se puede desasociar desde la UI** —
    `USelectMenu` no tiene `clearable` en esta versión y el placeholder solo se ve con el
    valor vacío. Sin eso, el `null` del payload era código inalcanzable.
  El contrato del backend se verificó **contra la API andando** antes de tocar el front
  (`PATCH` con `descripcion: ''` + `categoriaId: null` → 200 y los dos campos vacíos; el
  `null` pasa porque `@IsOptional()` corta los validadores antes del `@IsUUID()`), y el
  flujo completo en navegador: elegir "Sin categoría" → el `PATCH` capturado lleva
  `categoriaId: null` → la BD queda en `NULL`.
  ⛔ **Regresión propia, cazada en el navegador y corregida:** la primera versión de la
  opción usaba `value: ''`, y reka-ui descarta el ítem con valor vacío — el select de
  Categoría abría con **0 opciones** (el de Moneda, al lado en el mismo drawer, abría con 3),
  o sea el usuario quedaba sin poder elegir **ninguna** categoría. Peor que el bug original,
  invisible para `build`, `typecheck`, `design:check` y los 293 unit. El valor es ahora un
  centinela (`__sin_categoria__`) que `guardar` traduce a `null`.

- [x] ~~**Un `itemId` en mayúsculas devuelve 404 desde que se batchea**~~ (backend,
  `items.service.ts`) — cerrado 2026-07-29 en un solo lugar, como decía la entrada, pero
  **el alcance que proponía era insuficiente y habría dejado algo peor que el 404**:
  normalizar solo `cargarBasePorIds` encuentra la fila base y deja pasar la línea, pero
  `cargarReglasPorIds` sigue sin match y sus llamadores hacen `?? []` — o sea el ítem se
  cobra **sin sus impuestos ni descuentos, en silencio**. El alias se aplica a los dos mapas
  (`aliasarCasingDeIds`): se consulta y compara en minúsculas, y el mapa queda indexado
  también por la forma que mandó el cliente, así que el `get(linea.itemId)` de los tres
  llamadores (venta, `/calculo-precios/calcular`, checkout online) sigue sirviendo con
  cualquier casing sin normalizar en cada uno.
  Lo fija un e2e que **compara el cálculo en mayúsculas contra el mismo en minúsculas** en
  vez de contra números escritos a mano, con `totalImpuestos > 0` como diente: sin eso, dos
  cálculos igualmente vacíos pasarían el `toEqual`. RED verificado (404 antes del fix) y
  **mutante del segundo mapa verificado**: sin el alias en `cargarReglasPorIds` el mismo
  ítem da `5000` en vez de `5950` —el IVA perdido—, que es exactamente el modo de falla que
  el fix a medias habría introducido.
- [x] ~~**Ingrediente o extra duplicado en una receta devuelve 500, no 400**~~ (backend,
  `items.service.ts`) — cerrado 2026-07-29. El chequeo con `Set` que solo tenía
  `validarYCostearComponentes` pasó a un `assertSinIdsRepetidos` compartido por las tres
  (componentes de combo, ingredientes y extras de receta), que es el **tercer** uso y por eso
  se extrajo en vez de duplicar. Va antes de la primera query en las tres.
  ℹ️ **Cambio de precedencia, deliberado:** el chequeo es en memoria y ahora precede a las
  validaciones por fila, así que un payload con un duplicado **y** una cantidad inválida
  reporta el duplicado. Los dos son 400 accionables, y es la precedencia que el gemelo de
  combos ya tenía.
  Dos tests RED verificados: antes del fix ambos llegaban a `filasValidacionPorIds` (el
  síntoma exacto de "consultó la BD"), y el del gemelo de combos sigue verde a través del
  helper compartido.

### Media — cerrados el 2026-07-30 (tercera tanda)

- [x] ~~**Deadlock en la expansión de recetas y combos**~~ (backend) — cerrado 2026-07-30
  con **`ORDER BY` + reintento ante `40P01`**, decidido por el owner sobre la mesa después
  de medirlo. La entrada proponía "ordenar globalmente los ids a bloquear"; se descartó por
  una razón que la entrada no había considerado (ver abajo).
  **Lo que la medición cambió respecto de lo que decía la entrada:**
  - **El `ordenLocks` que ya existía protege mucho menos de lo que parecía.** Ordena las
    **líneas** por `item.id`, pero los `FOR UPDATE` los toma `registrarMovimiento`
    (`inventario.service.ts:91`) sobre los ids **expandidos** —ingredientes, componentes,
    opciones de grupo—, que `ordenLocks` nunca ve. Sirve para un carrito de puros productos;
    para recetas y combos, no.
  - **Confirmado con contraejemplo que el `ORDER BY` solo no cierra el ciclo**, que era lo
    que la entrada afirmaba sin demostrarlo: A vende `RecetaX(ing3, ing5)` → bloquea 3→5; B
    vende `[RecetaY(ing5), RecetaZ(ing3)]` con `Y.id < Z.id` → bloquea 5→3. El orden global
    es *(orden de línea) × (orden dentro de la línea)*, y eso no es ascendente global por
    más `ORDER BY` que lleve cada query.
  - **Había DOS puntos de bloqueo más que la entrada no nombraba, los dos con el orden
    puesto por el cliente:** `venderOpcionesGrupos` recorría las opciones **en el orden del
    snapshot** (ahora se aplanan los grupos y se ordenan por `itemId` — el orden tiene que ser
    global **entre** grupos, no determinista dentro de cada uno), y `venderIngredientesReceta`
    concatenaba los **extras del snapshot detrás** de la lista de ingredientes ya ordenada,
    devolviendo el orden del cliente a la mitad del bloqueo. El cuarto lo encontró la revisión
    independiente **después** de que yo diera el barrido por completo, mirando justo el patrón
    que el diff decía haber barrido. Se cerró en el mismo commit.
    En los dos casos el efecto lateral aceptado es el mismo: el orden de las advertencias de
    stock pasa a ser por id y no el del snapshot. Determinista, que es lo que se busca.
  **Por qué NO se hizo el pre-lock global**, que era lo que la entrada pedía: para ordenar
  globalmente hay que conocer el conjunto completo antes de escribir, y eso obliga a
  reconstruir el grafo de expansión (receta→ingredientes, combo→componentes→ingredientes,
  grupos→opciones→ingredientes) **en un segundo lugar**. El día que alguien agregue un camino
  de expansión y no toque el pre-lock, el deadlock vuelve en silencio. El reintento, en
  cambio, cubre también los ciclos que nadie enumeró (series, lotes, caja).
  **Reintentar es seguro porque el deadlock aborta la transacción entera**: Postgres revierte
  todo antes de devolver el error, así que no hay venta, ni movimientos, ni pagos, ni
  movimiento de caja a medio hacer. No es idempotencia —eso sigue en `pendientes.md`—: acá no
  hay nada que deduplicar porque no quedó nada. Solo `40P01`; cualquier otro error se propaga
  sin reintentar, para no convertir un fallo de negocio en tres intentos silenciosos.
  ⚠️ El `code` de TypeORM llega **de dos formas** según dónde se lance (`error.code` y
  `error.driverError.code`) y se miran las dos: mirar una sola es no reintentar nunca, con un
  bug invisible —la venta falla igual que antes del fix—. Hay un test por cada forma.
  **Seis mutantes verificados revirtiendo** ([[mutante-debe-revertir-no-solo-romper]]):
  sacar cada uno de los dos `ORDER BY` cae su test; sacar el `.sort()` de las opciones de
  grupo y el de los extras devuelve el orden del snapshot y caen; sacar el reintento cae 3 de
  los 4 tests de deadlock (el que sigue verde es, correctamente, "NO reintenta un error que
  no es deadlock"); y revertir `ordenLocks` al orden del carrito cae el test nuevo.
  El patrón quedó documentado como anti-patrón propio en
  [`anti-patterns.md`](anti-patterns.md) — es el criterio de `CLAUDE.md` para un bug que se
  repite, y este se repitió cuatro veces en el mismo camino.
  ℹ️ **Los dos tests de `ORDER BY` afirman sobre el SQL, no sobre el resultado**, y es a
  propósito: el orden lo aplica Postgres y un mock devuelve lo que se le pida. Es la frontera
  honesta de lo que un unit puede probar acá.
  ➕ **Deuda que este cierre destapó, y se cerró en el mismo commit:** el `ordenLocks` de
  `ventas.service.ts` —el fix hermano del 2026-07-23— **no tenía ningún test**. Ahora sí:
  un carrito con las líneas al revés (`zzz`, `aaa`) tiene que bloquear `aaa` primero.
  Mutante verificado revirtiendo al código anterior a aquel fix (`ordenLocks` = orden del
  carrito): el test cae. Una semana de "está arreglado" apoyada en un `.sort()` que ningún
  test vigilaba.

### Media / Baja — cerrados el 2026-07-30 (segunda tanda)

- [x] ~~**`unidadBase`/`forzarConteo` divergen entre venta y checkout online**~~ (backend) —
  cerrado 2026-07-30 con `resolverUnidadBaseDeItem()` en
  `common/utils/cantidad-presentacion.util.ts`, consumida por los **tres** carritos.
  **La entrada tenía tres cosas mal, medidas antes de tocar código:**
  1. **Eran tres call sites, no dos.** `salones.service.ts` tenía la misma derivación y la
     entrada no la nombraba — apareció al grepear `resolverCantidadDesdePresentacion` en vez
     de abrir los dos archivos que citaba. Cerrar solo venta↔online habría dejado la
     divergencia viva en el tercero.
  2. **`forzarConteo` tampoco difería en efecto.** La entrada decía que `unidadBase`
     "coincide por accidente" pero que `forzarConteo` "sí difiere". No: con la unidad base
     resuelta a `'unidad'`, el resolver ya exige que la presentación sea de la **misma
     magnitud** (`conteo`), y `'unidad'` es la única unidad `conteo` del catálogo — así que
     `validarCantidadConteo` corría igual, con la bandera o sin ella. Las dos mitades
     estaban tapadas por el mismo mecanismo, una capa más abajo.
  3. Por lo tanto **no era un bug con síntoma**: vender un combo por presentación daba
     idéntico por POS y por la tienda. Era duplicación cuya equivalencia dependía de dos
     invariantes de otro archivo (que `receta`/`combo` no tienen fila en `item_producto`, y
     el chequeo de magnitud del resolver).
  Se cierra igual, y por eso: unificarlo convierte esa equivalencia frágil en verdad por
  construcción. Lo fijan 4 casos nuevos en `cantidad-presentacion.util.spec.ts`, uno de
  ellos con `unidadMedida: 'kg'` en un combo — el caso imposible hoy, que es justo el que
  prueba la unificación sin apoyarse en el invariante que la tapaba.

- [x] ~~**Quedan CUATRO `convertirUnidad` dentro de loops, dos en el camino de una venta**~~
  (backend, `items.service.ts`) — cerrado 2026-07-30. Los cuatro (`venderIngredientesReceta`,
  `venderOpcionesGrupos`, `calcularDisponibleReceta`, `upsertOverridesDeGrupo`) pasan a
  recibir el conversor de `CatalogService.crearConversor()` por parámetro, con el tipo
  `ConvertirUnidad` exportado.
  **No alcanzaba con crear el conversor arriba de cada función**, que es como se lee la
  entrada: el clúster `vender*` es mutuamente recursivo —el combo llama a la receta, la
  receta al grupo, el grupo de vuelta a la receta—, así que un `crearConversor()` por
  función seguía dando una lectura del catálogo por componente. El conversor se crea en los
  dos puntos de entrada públicos (`venderIngredientesReceta` y `venderComponentesCombo`, con
  `?? await crearConversor()` para el llamador externo) y **baja por parámetro** por todo el
  árbol. Las dos privadas lo reciben como requerido: así no hay forma de que una rama nueva
  se olvide y vuelva a leer.
  `upsertOverridesDeGrupo` va aparte, con `convertir ??= await …` dentro del loop de grupos:
  se lee una vez para todos, y un item **sin** grupos no paga ninguna query (antes tampoco).
  ⚠️ **Lo que este cambio empeora, para no venderlo mejor de lo que es** (lo midió la
  revisión independiente): la carga pasa a ser *eager*, así que hay casos que antes hacían
  **cero** queries y ahora hacen **una**. Un item con grupos pero sin ninguna opción
  `ingrediente` con cantidad, y una receta cuyos ingredientes ya vienen en su unidad base
  (`desde === hacia`, que `convertirUnidad` cortocircuitaba sin consultar). Se acepta: es
  **una** query fija contra una tabla global chica, contra un costo que antes escalaba con
  el tamaño del loop. Vale saber que el intercambio existe.
  ℹ️ **El alcance de "una vez" era por línea, no por venta** — `ventas.service.ts` llamaba a
  estas dos funciones dentro de su loop de líneas sin pasar el conversor. **Cerrado el mismo
  día**, ver la entrada de abajo.
  **Mutante verificado revirtiendo** ([[mutante-debe-revertir-no-solo-romper]]): sacando el
  `convertir` que el combo le pasa a la receta, el test nuevo pasa de **1 a 3** cargas del
  catálogo y falla. El test vende un combo de 2 componentes-receta de 2 ingredientes cada uno
  y afirma `crearConversor` 1 vez, 4 conversiones, y `convertirUnidad` nunca.
  Efecto colateral en el spec: `crearConversor` ahora devuelve un `conversorMock` espiable
  (con la aritmética real por defecto) en vez de una función anónima, así los tests que
  pisaban `convertirUnidad` pasaron a pisar el conversor. Es lo que hace observable la
  cantidad de cargas.

- [x] ~~**El conversor de unidades no se comparte entre líneas de la misma venta**~~
  (backend, `ventas.service.ts`) — abierto y cerrado el 2026-07-30. Lo detectó la revisión
  independiente del batch de arriba, al notar que el texto de cierre afirmaba "una vez por
  operación" cuando el loop de líneas de la venta seguía creando uno por línea.
  El cierre es `let convertir` antes del loop de `ordenLocks` + `convertir ??= await
  crearConversor()` en las ramas de receta y de combo, aprovechando que el parámetro ya
  estaba puesto como opcional exactamente para esto. `salones.service.ts` entra por
  `crearEnTransaccion`, así que el cierre de cuenta queda cubierto por el mismo loop.
  **El `??=` no es cosmético: es lo que evita repetir el intercambio que el batch anterior
  sí pagó.** Con carga *eager* antes del loop, la venta más común del POS —un carrito de
  puros productos— habría empezado a pagar una query que no usa. Perezosa, la paga la
  primera línea que expande una receta o un combo, y las demás la reusan.
  **Dos mutantes verificados, uno por cada mitad de la regla:** volver a `convertir =` (sin
  `??`) lleva las cargas de 1 a 2 con dos líneas de receta y cae el primer test; cargarlo
  eager antes del loop lleva de 0 a 1 en el carrito de productos y cae el segundo. El primer
  test además afirma que las dos líneas reciben **el mismo** conversor, no solo que se cargó
  una vez: contar cargas sin eso dejaría pasar un segundo conversor creado en otro lado.
  El hueco que marcó la revisión —los dos tests usaban líneas del **mismo** tipo, así que
  compartir *entre* ramas no estaba ejercido— se cerró con un tercer test de carrito mixto
  (receta + combo) que afirma que las dos ramas reciben la misma instancia.
  ⚠️ **Al mutarlo apareció algo que conviene saber para el próximo test de este loop:**
  mutar la rama del combo **no** rompe nada, porque `ordenLocks` ordena por `item.id` y
  `combo-b` corre antes que `receta-a` — la primera rama que corre setea la variable igual
  con `=` que con `??=`. El mutante válido es sobre la rama que corre **segunda**, y ahí sí
  las cargas van de 1 a 2. Un mutante sobre este loop que "no rompe nada" puede estar
  midiendo el orden de `ordenLocks`, no la lógica.

### Media / Baja — cerrados el 2026-07-30

- [x] ~~**`AjusteStockDto.cantidad` es `number` nativo**~~ (backend,
  `dto/ajuste-stock.dto.ts`) — cerrado 2026-07-30: pasa a `string` + `@IsNumberString()` +
  `@IsDecimalPositivo()`, como los otros cinco campos de cantidad del módulo, y se va el
  `@Type(() => Number)`. El service no cambió una línea: ya hacía
  `new Decimal(dto.cantidad).toString()`, que trata igual al string.
  **Es un endurecimiento del contrato, no un cambio interno:** un `cantidad: 10` (número
  JSON) ahora devuelve 400. Se puede hacer sin plan de migración porque el único cliente
  —`configuracion/items.vue`— ya mandaba string en los tres modos (`cantidad`, `serie` con
  `String(series.length)`, `lote`), y el proyecto no tiene datos ni clientes productivos
  ([[proyecto-sin-datos-productivos]]). Quien sí mandaba números era la propia suite e2e:
  **15 llamadas** a `PATCH /items/:id/stock` repartidas en `costeo-cpp`, `inventario`,
  `mermas` y `recuentos`, más 4 en el unit de `items.service.spec.ts` (esas las cazó
  `tsc --noEmit`; las de e2e, no — `.send()` es `any`, así que hubo que contarlas a mano).
  Lo fija un e2e en `inventario.e2e-spec.ts` que manda `cantidad: 10` como número y espera
  400: sin él, volver al `@Type(() => Number)` pasa el gate entero.

- [x] ~~**`ventas.service.spec.ts` fija `recargosIds: []` en sus tres fixtures**~~ (backend) —
  cerrado 2026-07-30 con un test que hace lo que la entrada pedía y **un poco más preciso**:
  el hueco real no era el `recargosIds` del item —la venta ni lo lee, pasa
  `linea.recargoIds` del DTO al motor—, sino que `trazas.recargos` y `trazasVenta.recargos`
  llegaban **siempre vacíos** al service, así que los dos loops que persisten `VentaRecargo`
  (7c por línea y 7d a nivel venta) no los ejercía ningún unit.
  El test nuevo devuelve un resultado con un recargo de línea y uno de venta, y afirma las
  dos filas creadas con su `aplicadoEn` (`'detalle'` y `'venta'`).
  **Mutante verificado revirtiendo, no rompiendo** ([[mutante-debe-revertir-no-solo-romper]]):
  con los dos loops neutralizados el test falla con `Array []`; con el código real, pasa.

### Decidido por el owner y ya implementado

- [x] ~~**¿El descuento debe tener piso en cero?**~~ — **sí**, decidido por el owner el
  2026-07-28 ("si el piso no es 0, terminaría pagando el tenant") e implementado el mismo
  día en `calculo-precios.engine.ts`. Tres precisiones que no estaban en la pregunta y
  hacen a la regla:
  - **Se topea regla por regla, al aplicarla**, no al final sobre el total. Es lo único que
    mantiene coherente el comprobante: topear al final dejaría la traza diciendo "500" con
    un total que solo bajó 100, y `subtotal − descuentos` dejaría de dar el total. Con tres
    descuentos del 40% en modo `base` sobre 100, la traza queda 40 / 40 / 20.
  - **Aplica también a los descuentos a nivel venta.** Sin eso el agujero se mudaba: tres
    líneas con piso propio y un descuento de venta que hunde el total igual.
    ⚠️ **La primera versión lo afirmaba y no lo cumplía; la revisión independiente bloqueó
    el cierre.** El tope de venta medía contra el **neto agregado** en vez del total real
    (`Σ totalLinea`, que ya trae descuentos e impuestos de línea). Con una línea de 1000,
    90% de descuento propio e IVA, un descuento de venta de 500 dejaba `totalFinal: -381`
    **y `advertencias: []`** — el bug exacto que la tarea venía a cerrar, ahora con el
    agravante de estar documentado como resuelto. Y en el sentido inverso recortaba
    descuentos sanos: 1190 de total menos un cupón de 1100 daba 190 en vez de 90, cobrando
    100 de más con un aviso que afirmaba un motivo falso.
    **Por qué no lo vi:** mi test usaba una línea sin descuentos ni impuestos, donde
    `subtotalNeto == totalFinal` — el único escenario en que las dos magnitudes coinciden y
    el bug es invisible. Tercera vez en el día que un test pasa por la razón equivocada.
    Cerrado separando `disponible` (la plata sobre la que se topea) de `acc` (la base de
    los `%`), con dos tests que reproducen los dos sentidos y dos mutantes verificados.
  - **No frena la venta**, decisión explícita del owner entre topear en silencio, rechazar
    con 400 y topear avisando: emite advertencia, igual que un ingrediente no bloqueante sin
    stock. Viaja al POS por el canal que ya existía.
  - **Ninguna regla aporta una magnitud negativa**, invariante que hizo falta agregar tras
    el **segundo bloqueo**: al desacoplar la plata de la base de los `%`, el acumulado de
    venta quedó sin piso, y un `compuesto` sobre esa base negativa devolvía un "recargo" de
    `-19.00` que **restaba** —total negativo otra vez, y sin advertencia— o un segundo
    descuento negativo que le cobraba al cliente. Ambos se imprimían así en la traza. El
    revisor lo encontró con un fuzz de 40.000 ventas de configuración válida: 0,78%. No era
    regresión contra `HEAD`, pero la doc volvía a certificar cerrado un agujero abierto.
  Los recargos no tienen **tope superior** (subir el total no es el problema que el piso
  resuelve), pero sí el piso en cero: un recargo nunca resta.
  Nueve tests en el motor puro y tres mutantes verificados. La identidad del comprobante
  (`subtotal − descuentos + recargos + impuestos == totalFinal`) se verificó con un fuzz de
  60.000 ventas sobre las 4 órdenes de fórmula, `base`/`compuesto`, 3 escalas y los 4 modos
  de redondeo: 0 fallos.
- [x] ~~**¿`remove()` debe bloquear el borrado de un ingrediente usado solo como
  extra?**~~ — **no bloquea, advierte con confirmación informada**, decidido por el
  owner e implementado el 2026-07-28. Ser extra es opcional por definición — sin él la
  receta sigue completa — a diferencia de ser ingrediente fijo, componente de combo u
  opción de grupo, que sí bloquean porque dejan la composición incompleta.
  `GET /items/:id/uso` (guard `Items:Eliminar`) devuelve los cuatro usos ya
  clasificados en una sola query `UNION`: `{ bloqueos: [{tipo, nombre}], advertencias:
  [{tipo:'extra', nombre}] }`. `remove()` reusa esa misma query dentro de su
  transacción para decidir si bloquea, y al confirmar marca `eliminado_el` en las
  filas de `receta_extras_permitidos` del ingrediente en la misma transacción que el
  soft-delete del item. El modal de Configuración → Items la consulta antes de
  abrirse: con bloqueos muestra "No se puede eliminar" + motivos y solo "Entendido";
  con solo advertencias nombra las recetas y deja confirmar; sin usos, el texto
  genérico de siempre. Detalle y regla de negocio:
  [`recetas.md`](../features/recetas.md#delete-itemsid).
  ⚠️ **Corrige una afirmación falsa del ítem original.** Decía que este hueco era "la
  condición habilitante del bug de conversión de unidad" de la sección Alta de esta
  misma auditoría. Es falso desde `51df04c` (el cierre de los tres N+1 restantes de
  `items`): las dos lecturas de extras del catálogo —
  `obtenerExtrasPermitidos` (`items.service.ts:1875`), que corre dentro de la
  transacción de venta al resolver la personalización, y el `findOne` de receta
  (`items.service.ts:577`), que alimenta el detalle del item y el drawer de
  personalización, no la transacción de venta — hacen ambas `JOIN items i ON
  i.item_id = re.ingrediente_item_id AND i.eliminado_el IS NULL` (misma condición en
  ambas, distinto momento en que corre). Un ingrediente borrado
  desaparece del `JOIN`, así que el extra queda **ausente** del catálogo de extras de
  la receta, no con una unidad de medida equivocada: vender ese extra da
  `400 'Extra no permitido para esta receta'` (`items.service.ts:1937`), el mismo
  error que un extra sacado de la carta por cualquier otro motivo — verificado leyendo
  ambas queries antes de escribir esta entrada, no asumido del texto original. El bug
  de conversión de unidad real (fallback de unidad de porción vs. unidad de stock) ya
  está cerrado y documentado en su propia entrada, arriba en esta misma sección de
  auditoría ("Vender un extra cuyo catálogo cambió tras congelar el snapshot descuenta
  1000× de más").
- [x] ~~**`advertenciasReceta` de la venta ya no son solo de receta**~~ — cerrado
  2026-07-28, rename mecánico sin cambio de forma (sigue siendo `string[]` plano).
  `ventas.service.ts` renombra la variable local y la propiedad de la respuesta a
  `advertencias`; tocó las 21 referencias esperadas en 7 archivos (`ventas.service.ts`,
  `ventas.service.spec.ts`, las cuatro suites e2e de `combos`/`recetas`/
  `grupos-modificadores`/`grupos-modificadores-overrides`, y `pos.vue`).
  El rename destapó un shadowing que no estaba en el plan: dentro del `for` de
  movimientos de inventario, los bloques `receta` y `combo` ya declaraban su propio
  `const advertencias` local antes de acumular al array externo — con el externo
  renombrado igual, `advertencias.push(...advertencias)` habría hecho que el array se
  duplicara a sí mismo en vez de sumar los avisos de receta/combo, silencioso porque
  compila y tipa igual. Se renombraron esos dos locales a `advertenciasIngrediente` y
  `advertenciasComponente` para que el externo pueda ocupar `advertencias` sin
  colisión; misma lógica, ningún cambio de comportamiento.
  El riesgo real de un rename de campo no es el gate en rojo: es que el frontend siga
  leyendo el nombre viejo, reciba `undefined`, y el `?? []` de `pos.vue` lo convierta en
  lista vacía sin que ningún test lo note — se verificó con grep de cero resultados
  sobre todo el repo (backend, frontend, docs) después del cambio, no solo con las
  cuatro suites e2e en verde.
- [x] ~~**Las advertencias del motor de precios llegan a un solo consumidor**~~ —
  cerrado en dos mitades, 2026-07-28 y 2026-08-02: el motor gana `ResultadoVenta.advertenciasVenta`
  (solo las advertencias de descuentos a nivel venta, que no pertenecen a ninguna línea),
  sin tocar `advertencias`, que sigue siendo el aplanado de línea + venta. Los tres
  carritos (POS `CarritoPanel.vue`, Salones `salones/index.vue`, Tienda
  `CarritoOnline.vue`) dibujan ambas granularidades con el componente compartido nuevo
  `components/AdvertenciasPrecio.vue`: por línea con `resultado.lineas[index].advertencias`
  (cruce por índice, nunca por `itemId` — el mismo ítem puede repetirse en dos líneas con
  personalizaciones distintas) y junto al total con `resultado.advertenciasVenta`.
  `useCalculoPrecios.ts` incorpora los dos campos al tipo. El seed suma el tipo de regla
  `directo` ("Descuento directo") y el descuento `monto_fijo` "Promo fija $5.000" —ningún
  descuento sembrado antes ejercitaba la rama plana del motor—, más el primer e2e de
  `POST /calculo-precios/calcular`, que confirma que las dos granularidades no se
  mezclan entre sí.
  ✅ **La otra mitad cerró el 2026-08-02** — con una corrección al diagnóstico: la entrada
  decía que `online.service.ts` y `suscripciones.service.ts` "no las persisten ni las
  devuelven", y eso era medio falso. `ventas.service.ts:688` **sí devuelve** `advertencias`
  en todos los canales (por eso `pos.vue:214` las muestra como toast); lo que las pierde no
  es la creación de la venta sino **quién la llama**: en online la invoca
  `online-callback.handler.ts:87`, un callback de Transbank sin usuario adelante, y en
  suscripciones la llamada de `suscripciones.service.ts:147` se queda solo con `venta.id`
  (178 y 197).
  Medido el alcance real, quedaban dos huecos y ninguno era el reportado:
  **(1)** `pasarela.vue` no dibujaba nada antes de "Aprobar pago" pese a tener
  `resumen.resultado` completo → cerrado con `<AdvertenciasPrecio>` sobre `advertencias`
  (el aplanado línea+venta, porque esa pantalla no desglosa líneas y las dos granularidades
  por separado duplicarían las de venta). Con eso online queda a la par de POS
  (`CarritoPanel.vue:202,236`) y Salones (`salones/index.vue:1124,1144`), que ya las
  dibujaban al agregar productos igual que la Tienda (`CarritoOnline.vue:61,95`).
  **(2)** el drawer de suscripciones nunca previsualiza el precio —`suscripciones.vue`
  llama a `crear()` en 229 y en 260, y `crear()` cobra por Oneclick en el mismo request— →
  **decisión del owner (2026-08-02): no muestra nada, la suscripción se cobra
  automáticamente.** ⚠️ La razón **no** es que el caso sea imposible: el motor corre igual
  y `cargarReglasPorIds` no filtra por `tipo`, así que un ítem de suscripción sí puede
  llevar descuentos. Lo que sostiene la decisión es la configuración de hoy, no el código
  — detalle en [`motor-calculo-precios.md`](../features/motor-calculo-precios.md).
  ℹ️ Residual consciente, en dos mitades y no una: en **webpay** el toast post-venta del POS
  no existe porque la venta la crea el callback; en el flujo **simulado** —el único que llega
  a `pasarela.vue`— la venta la crea la propia página (`pasarela.vue:63`), que tipa la
  respuesta como `{ id, estado }` y descarta el `advertencias` que `POST /ventas` sí
  devuelve. Ese array trae una clase que la previsualización de precios no tiene: las de
  receta/combo (`ventas.service.ts:565,579`). Hoy es inocuo porque el catálogo de la tienda
  es `?tipo=producto` (`pages/tienda/index.vue:25`) y esas clases son inalcanzables; deja de
  serlo el día que la tienda venda recetas o combos.
  Y `advertenciasVenta` es hoy superficie sin UI: ningún
  archivo de `frontend/app` arma `descuentosVentaIds`/`recargosVentaIds`, así que el render
  junto al total está construido y correcto pero queda inerte hasta que exista esa pantalla
  — detalle en [`motor-calculo-precios.md`](../features/motor-calculo-precios.md).

## Revisión final `borrado-ingrediente-extra` (2026-07-28)

- [x] ~~**El modal de confirmación nunca nombra el item que se va a borrar**~~ (frontend,
  `configuracion/items.vue`) — cerrado 2026-07-29: los tres mensajes nombran el item
  (bloqueado, con extras y confirmación normal). El nombre se fija y se limpia **siempre
  junto con `confirmDeleteId`** en vez de buscarse en la lista por id: así no puede quedar
  mostrando otra fila si la lista se refiltra o se pagina con el modal abierto.
  `confirmarEliminar` pasó a recibir el `Item` completo en lugar del id, que es lo que
  `menuAcciones` ya tenía a mano.
  Verificado en navegador real (el proyecto no testea páginas, así que build/typecheck no
  ven esto): rama bloqueada → `El item "Papas fritas" está en uso y no se puede eliminar:`
  con su viñeta "Es componente de Combo Especial"; rama normal → `¿Estás seguro de que
  deseas eliminar "Producto demo (unidad · CLP)"?`.
- [x] ~~**`:disabled="!!verificandoEliminarId"` es global en `items.vue`**~~ (frontend) —
  cerrado 2026-07-29: el `disabled` quedó acotado a la fila en verificación
  (`verificandoEliminarId === row.original.id`), la misma condición que su `:loading`.
  Antes, verificar el uso de un item deshabilitaba el menú de **todas** las demás filas,
  incluidas acciones que no tienen nada que ver (ajustar stock, historial).
  ℹ️ **Lo que esto deja como contrapartida chica:** durante la verificación en vuelo, un
  click en "Eliminar" de otra fila es ahora un no-op silencioso (el guard de reentrancia de
  `confirmarEliminar` lo corta) en vez de un botón visiblemente deshabilitado. Se acepta: la
  ventana es la de un request y el precio anterior era bloquear toda la tabla.
  ⚠️ **Este cambio afloja una de las dos capas que cubrían la carrera de "se borra el item
  equivocado"**, así que se verificó con el escenario obligatorio de dos entidades solapadas
  (el que un smoke de un item por vez no ve): con la respuesta de `/uso` demorada 5 s a
  propósito, click en "Eliminar" de la fila A y después en la de B **con A en vuelo**. Se
  disparó **un solo** request —el de A— y el modal abrió nombrando **A**, no B. El guard de
  reentrancia es el que sostiene la invariante; el `disabled` global era redundante.
  Técnica, por si hay que repetirlo: `navigate_page` con un `initScript` que envuelve
  `window.fetch` y demora las URLs que matchean `/uso`.

- [x] ~~**`UsoItemTipo` está duplicado a mano**~~ (backend `items.service.ts` + frontend
  `configuracion/items.vue`) — cerrado 2026-07-30 con la **mitigación mínima que la propia
  entrada pedía**, no con el enlace de compilación: un docblock cruzado en las dos puntas
  (`UsoItemTipo` ↔ `UsoItemTipoBloqueante` + `ETIQUETA_USO`) que dice qué pasa si se toca una
  sola —la viñeta se renderiza con la etiqueta vacía en vez de romper el build— y que la
  partición `'extra'` → `advertencias` es parte del contrato.
  **No cierra el problema de raíz** y no pretende hacerlo: el enlace real es el workspace
  compartido del monorepo, que sigue siendo tema propio por decisión del owner
  ([[workspace-compartido-monorepo-pendiente]]). Acá el patrón acordado para ese caso es
  exactamente este: la copia vive de cada lado y ambos docblocks se referencian.

## Revisión final `advertencias-previsualizacion` (2026-07-29)

- [x] ~~**El e2e de ventas consume stock sembrado compartido**~~ (backend,
  `test/ventas.e2e-spec.ts`) — cerrado 2026-07-29: el test de la advertencia recompuesta usa
  ahora un **servicio** que crea él mismo, no "Papas fritas". Un servicio no tiene
  inventario, así que la venta no consume stock de nadie —antes le gastaba 1 unidad al ítem
  que `combos.e2e-spec.ts` usa como componente, acelerando su agotamiento en corridas
  locales repetidas y aflorando como un fallo opaco en una suite ajena
  ([[e2e-cumulative-stock-pollution]])—.
  **La economía es idéntica**, verificada contra `/calculo-precios/calcular` antes de tocar
  el test: subtotal 1500, "Promo fija $5.000" topeada a 1500, `totalFinal` 0 con los dos
  ítems (ninguno tiene IVA asociado), así que las aserciones no cambiaron.
  Medido, no supuesto: el stock de "Papas fritas" queda en **38.0000 antes y después** de
  correr la suite; antes bajaba 1 por corrida. Efecto lateral: se fue `PAPAS_FRITAS_ID`, una
  de las dos constantes con el mismo literal que confundía a los revisores (la causa sigue
  en el seeder, ver [`pendientes.md`](pendientes.md)).

- [x] ~~**El seed reusa el UUID `…440281` para dos filas sin relación**~~ (backend,
  `seeder.service.ts`) — cerrado 2026-07-30. El que se movió es el **garzón "Mostrador"**, no
  el ítem: `…440281` pertenece al bloque 281-289 que `seedPapasFritas` usa de corrido (papas,
  su movimiento, pollo, chuleta), mientras que el garzón lo tomó fuera de su propio rango
  (los garzones de Paris van en 238-240). Ahora es `…440339`, el siguiente número libre
  medido sobre el repo entero (338 era el máximo; 400/500/600/999 ya estaban tomados más
  arriba). Referencias vivas actualizadas: el seeder y las dos constantes `MOSTRADOR_ID` de
  `ventas.e2e-spec.ts` y `liquidacion-propinas.e2e-spec.ts`. Los planes y specs de
  `docs/superpowers/` **no se tocaron**: son artefactos fechados que describen lo que se hizo
  ese día, no la fuente de verdad del seed.
  El id nuevo lleva un comentario que dice de quién es `…440281`, para que la próxima persona
  no lo reasigne de vuelta. Verificado con la e2e completa sobre BD reseteada (172 verdes):
  si el garzón placeholder no existiera con ese id, la propina de POS del `liquidacion-propinas`
  no repartiría.

- [x] ~~**`resultado` y `lineas` se desfasan: el aviso puede quedar bajo la línea
  equivocada**~~ (frontend, los tres carritos) — cerrado 2026-08-07 con
  `useResultadoCalculado()` en `app/composables/useCalculoPrecios.ts`, un solo lugar
  donde vive el par carrito↔cálculo. Los tres carritos lo consumen; ninguno guarda
  `resultado` por su cuenta.
  **La entrada describía dos formas y había una tercera, más cara:** además del aviso
  mal atribuido, el **modal de cobro pide su `:total` de `resultado`** (POS
  `ventas/pos.vue`, salones `salones/index.vue`) y la precuenta/boleta de salones
  imprime `totales` e `itemsParaTicket()` desde ahí. Agregar un ítem y hacer clic en
  Cobrar dentro de la ventana del debounce abría el modal con el total del carrito
  anterior: no era solo cosmética.
  **Cómo se cerró**, dos mecanismos, uno por cada forma de desfase:
  - **`vigente` es derivado**, no un flag: compara la clave del input actual contra la
    del input que produjo el resultado guardado. Un booleano habría que bajarlo en
    cada sitio que muta el carrito —cuatro en salones más los dos watchers con
    debounce—, y el que se olvide reporta "al día" en silencio; la clave no se puede
    desincronizar del input porque se calcula de él.
  - **token de request**: dos `calcular` solapados no dejan que la vieja pise a la nueva.
  - **un cálculo que falla no toca el resultado guardado.** El primer intento lo
    borraba, y la revisión lo midió: bastaba un error de red para dejar el total en
    cero **con el modal de cobro abierto** (`totalFinal` es un computed vivo, no un
    snapshot), y de paso sin boleta. La vigencia ya dice si el guardado sirve.

  Las advertencias se dibujan solo con `vigente` (los totales conservan el último valor
  para que no parpadeen tecla a tecla); todo lo que mueve plata —abrir el cobro,
  imprimir precuenta, cerrar la cuenta— pasa por `await asegurarVigente()`. Si devuelve
  `null` no se sigue con **lo que dependía del cálculo** (no se abre el cobro, no se
  imprime) y se avisa; lo ya cobrado se registra igual, porque el backend calcula su
  propio total y el cliente ya pagó.
  **Lo fijan 20 tests** —17 en `useResultadoCalculado.nuxt.spec.ts` y 3 de render en
  `CarritoPanel.nuxt.spec.ts`, que son los únicos que ven el cruce índice↔advertencia
  en el template— y **8 mutantes medidos**, cada uno revirtiendo a la conducta anterior
  y verificado como aplicado.
  **Cinco de esos tests salieron de la revisión independiente**, que bloqueó en la
  primera ronda. Lo que encontró, y que el gate no veía:
  - El `catch` que borraba el resultado era **una regresión**: si el cálculo que falla
    es del mismo carrito, el guardado era el bueno.
  - `asegurarVigente()` no cancelaba un debounce pendiente cuando el carrito ya estaba
    vigente —agregar algo y sacarlo antes de los 300 ms— así que el timer sobrevivía y
    recalculaba con el modal de cobro ya abierto. Ahora el callback revalida al
    disparar, y el timer no sobrevive al unmount de la página (`onScopeDispose`).
  - La **tienda** había quedado sin el guard y la **boleta del POS** leía el ref crudo,
    mientras tres documentos afirmaban lo contrario.
  - Con `persistKey` el token era local por instancia, así que el `limpiar()` de una
    página no podía descartar la respuesta en vuelo de otra. Pasó a `useState`.

  Dos hallazgos de la segunda ronda cambiaron decisiones, no solo código: gatear el
  botón por `vigente` **dejaba la tienda trabada** tras un fallo de red (gris, sin
  mensaje, sin reintento) —el POS no tenía el problema justamente porque no lo
  gateaba—, y los cuatro `if (!x) return` mudos del camino del dinero ahora avisan.
  También salió un early-return del watcher que **ningún mutante mataba**: se fue, por
  la misma vara con la que se había ido el `clearTimeout` de `recalcular()`.
  **Sobre el camino que quedó bloqueado en `853c16b3`** (filtrar las líneas de ítems
  eliminados antes de calcular): esto lo acerca pero **no lo destraba solo**. Filtrar el
  input hace que `resultado.lineas` sea más corto que las líneas visibles, y eso es un
  desfase de longitud que la vigencia no resuelve —haría falta un mapeo explícito de
  índices—. Lo que sí cambió es que ahora hay **un único lugar** donde el input se
  arma (el getter que recibe el composable), que es donde ese mapeo iría.

## Revisión final `precio-base-negativo` (2026-07-29)

- [x] ~~**Tres hermanos de dinero del módulo `items` sin validación de signo**~~ (backend) —
  cerrado 2026-07-29 con `@IsDecimalNoNegativo()` en **seis** campos, no en los tres que
  nombraba la entrada ni en los cuatro que se planificaron:
  - `items/dto/create-item.dto.ts` — `costo` (carga inicial; entra a `costo_actual`, base del
    CPP y del margen), `RecetaExtraInputDto.precioExtra` y
    `ItemGrupoOpcionOverrideInputDto.precioExtra` (este último lo reusa `UpdateItemDto` vía
    `gruposModificadores`, así que el PATCH queda cubierto sin tocar el otro archivo).
  - `items/dto/aplicar-desfases.dto.ts` — `AplicarDesfaseItemDto.precioBase`.
  - **Los dos gemelos que la entrada no veía**, aparecidos al grepear el repo entero en vez
    de la carpeta del módulo —el grep acotado es exactamente el que ya falló con el enum de
    estados—: `grupos-modificadores/dto/create-grupo-modificador.dto.ts`
    (`GrupoOpcionInputDto.precioExtra`, mismo dinero y misma columna que el de `items`; lo
    reusa `UpdateGrupoModificadorDto`) y `grupos-modificadores/dto/aplicar-overrides.dto.ts`
    (`precioExtra`, gemelo exacto hasta el `@ValidateIf(!== '')`). Cerrar `precioExtra` solo
    del lado de `items` habría dejado el mismo campo validado a medias en el repo.
  **El criterio es `>= 0` en los seis, y en dos casos no por preferencia sino por contrato:**
  un extra u opción **gratis** es legítimo (el propio e2e manda `precioExtra: '0'` en
  `grupos-modificadores-overrides.e2e-spec.ts`), y en `aplicarDesfases` el `> 0` que exige el
  service **es condicional a `actualizarPrecio`** (`items.service.ts:3443-3455`), así que un
  decorador de campo —que no ve el otro campo— pedir positivo estricto habría empezado a
  rechazar `{ precioBase: '0', actualizarPrecio: false }`, hoy aceptado e ignorado. Ahí el
  decorador mata el negativo y el `> 0` sigue viviendo en el service.
  Lo fijan **16 casos nuevos** en `items/dto/dinero-signo.dto.spec.ts` (renombrado desde
  `precio-base.dto.spec.ts`, que ya no describía su contenido),
  `grupos-modificadores/dto/create-grupo-modificador.dto.spec.ts` y los 2 agregados a
  `aplicar-overrides.dto.spec.ts`, con **los 8 RED verificados**: fallaban los 8 de rechazo y
  **pasaban todos los de aceptación** contra el código anterior, que es lo que prueba que los
  payloads eran válidos por lo demás y los RED no fallaban por un fixture roto.
  Dos regresiones que los tests cubren a propósito: el `precioExtra: ''` de los overrides
  (`@ValidateIf` saltea todos los validadores; es el "no tocar este override" que manda el
  frontend) y el negativo entrando por `UpdateItemDto`/`UpdateGrupoModificadorDto`, que reusan
  los DTO anidados.
  **Lo que la entrada afirmaba de más:** decía que los tres campos de la familia `costo` de
  módulos vecinos eran candidatos del mismo molde. Medidos uno por uno, **ninguno es agujero
  funcional** — ver la entrada que quedó abierta en [`pendientes.md`](pendientes.md), que ya
  cita el `lessThanOrEqualTo(0)` de cada service.

- [x] ~~**Tres campos de la familia `costo` validan el signo en el service, no en el DTO**~~
  (backend) — cerrado 2026-07-30 con `@IsDecimalPositivo()` en los tres
  (`items/dto/ajuste-stock.dto.ts` `costoUnitario`, `inventario/dto/ajuste-costo.dto.ts`
  `costoNuevo`, `mermas/dto/create-merma.dto.ts` `costoUnitario`). Era consistencia, no un
  hueco: los tres services ya rechazaban el `<= 0`.
  **Un dato de la entrada no aguantó al medirlo.** Decía que el de mermas necesitaba
  `@ValidateIf(o => o.costoUnitario !== '')` porque el vacío significa "valorizar con el costo
  actual". Falso hoy: `@IsNumberString()` **ya rechaza la cadena vacía** —`@IsOptional()` solo
  saltea `null`/`undefined`—, así que ese camino ya devolvía 400 antes de este cambio, y
  `mermas.vue:219` nunca manda `''` (solo setea el campo si `.trim()` da algo). Agregar el
  `ValidateIf` habría **aflojado** la validación en vez de preservar un camino vivo: el `''`
  habría empezado a pasar el DTO y a llegar al service. El camino "sin costo" es omitir el
  campo, y así quedó documentado en el DTO.
  **Solo uno de los tres borró la validación del service**, y por una razón concreta:
  `registrarAjusteCosto` tiene un único llamador (su controller), así que el `> 0` vive ahora
  en el DTO y el backstop lo pone `registrarMovimiento` sobre el costo ya redondeado a 4
  decimales. Los otros dos **conservan** el chequeo: el de `registrarMovimiento` es un punto
  de entrada compartido por mermas, ventas y recuentos —no todos pasan por un DTO— y el de
  mermas está entrelazado con la conversión de unidad. Ahí el decorador es fail-fast en el
  borde y documentación en Swagger, no el único candado.
  Lo fija un e2e en `inventario.e2e-spec.ts` que manda `costoNuevo` `-4300` y `0` contra
  `POST /inventario/ajustes-costo` y espera 400 en ambos — sin esa aserción, el decorador que
  reemplazó al chequeo del service se podía borrar sin que fallara nada.

## IVA derivado de la clasificación tributaria (ADR-018)

- [x] ~~**Un ítem `afecto` debe llevar el IVA sí o sí; uno `exento`, no**~~ (backend +
  frontend) — cerrado 2026-07-31 con [ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)
  y spec propia (`docs/superpowers/specs/2026-07-30-iva-automatico-clasificacion-tributaria-design.md`).
  **Qué se hizo:** el IVA dejó de asociarse en `item_impuestos` y pasa a **derivarse** en
  `CalculoPreciosService.resolverLinea` a partir de `items.clasificacion_tributaria`: sobre
  la lista de impuestos ya resuelta de la línea —del ítem o pisada por el payload— se saca
  cualquier `tipo='iva'` (defensa contra datos viejos) y se agrega el IVA del país solo si
  `clasificacionTributaria === 'afecto'` (condición **positiva**, no la negación del filtro
  de exento, porque la columna quedó nullable). `item_impuestos` cambió de significado: ahora
  son solo los impuestos **adicionales** (`tipo='otro'`) que el usuario asoció. El IVA no se
  acepta nunca por payload —ítem ni línea de venta, en ningún endpoint— y eso es 400, no
  normalización silenciosa. `tipo='ingrediente'` quedó sin clasificación tributaria: la
  columna se hizo nullable y el ítem se guarda con `NULL` explícito.
  **Por qué derivar y no materializar:** auto-asociar el IVA al crear/editar el ítem dejaba
  dos fuentes de verdad (la clasificación y la fila puente en `item_impuestos`) que
  sincronizar en cada camino de escritura, presente y futuro. Lo que decidió no fue la
  elegancia sino el modo de fallar: materializando, el olvido queda en la **escritura** y
  produce un ítem que se vende sin IVA, en silencio — plata mal cobrada. Derivando, el olvido
  queda en la **lectura** y produce, como mucho, un formulario que muestra de menos: visible,
  y no toca la plata. Derivar además cierra sola la segunda puerta del agujero original —la
  línea de venta que pisaba los impuestos del ítem con `impuestoIds: []`—, que materializar
  no cerraba.
  **`items.clasificacion_tributaria` quedó nullable pero conservando `DEFAULT 'afecto'`.**
  Son protecciones complementarias, no alternativas: la condición positiva de lectura
  (`=== 'afecto'`) protege que un `NULL` ya existente no derive IVA por accidente; el
  `DEFAULT` protege que omitir la columna en un `INSERT` no produzca un `NULL` sin querer.
  Sacar el default habría invertido el modo de fallar de vuelta a la escritura silenciosa.
  **Corrección sobre el propósito del remapeo de duplicados.** El seeder solo necesitaba
  dejar de **remapear** la asociación del duplicado hacia el impuesto oficial —eso era
  inofensivo (esa fila es `tipo='iva'` y el motor la descarta antes de derivar) pero quedó
  sin sentido, porque el IVA ya no se asocia—, pero **sigue soft-deleteando el duplicado**,
  porque eso es lo que evita la doble tributación (el duplicado es `tipo='otro'`, el motor no
  lo filtra, y sumado al IVA derivado da 38%). El comentario de
  `seeder.service.ts:remapImpuestosOficialesDuplicados` documenta la distinción.
  **Cómo quedó cada pregunta abierta de la entrada original:**
  1. ¿Derivar o materializar? → **Derivar.** Ver arriba.
  2. ¿Qué IVA se toma si hay más de una fila `tipo='iva'` visible? → **Se resolvió sola, no
     hizo falta decidirla:** no puede haber más de una, porque `impuestos.tipo` no está
     expuesto en `CreateImpuestoDto`/`UpdateImpuestoDto` — un tenant no puede crear un
     impuesto `tipo='iva'` por API, y la única fila la siembra el seeder, una por país. Esta
     decisión se **apoya** en esa invariante: si `tipo` se expone alguna vez en la API de
     escritura, ADR-018 se revisa primero.
  3. "No se puede quitar": ¿400 o re-agrega en silencio si falta el IVA en `impuestosIds`? →
     **No aplica: el IVA nunca es parte de `impuestosIds`.** No hay nada que "quitar" porque
     nunca se asigna; omitirlo es el camino normal, y solo es 400 si el payload lo **incluye**
     explícitamente (contradicción, no omisión).
  4. ¿Queda rastro del ida y vuelta `afecto → exento → afecto`? → **No aplica por la misma
     razón:** no hay asociación que crear o destruir en cada cambio de clasificación, así que
     no hay nada que perder ni que registrar. Las ventas ya congeladas siguen sin tocarse
     (`venta_detalles.clasificacion_tributaria` es snapshot).
  5. ¿Aplica a todos los tipos de ítem, incluido `ingrediente`? → **No.** `ingrediente` quedó
     con `clasificacion_tributaria = NULL` explícito ("no aplica", no "afecto"), y la
     condición positiva `=== 'afecto'` del motor es justamente lo que evita derivarle IVA a un
     ingrediente si alguna vez llega a una línea.
  **Qué lo fija:** en `calculo-precios.service.spec.ts`, seis casos con mutante verificado
  revirtiendo al código anterior (no un `throw` agregado): afecto sin impuestos igual lleva
  IVA; afecto con adicionales lleva adicionales **más** IVA; exento con adicionales lleva
  adicionales **sin** IVA; una línea que pisa impuestos con `impuestoIds: []` sobre un ítem
  afecto igual lleva el IVA (la segunda puerta); `clasificacionTributaria: null` no deriva
  nada (fija el `===` contra el `!==`); afecto en un país sin fila `'iva'` revienta nombrando
  el país. En `items.service.spec.ts`: `tipo='iva'` en `impuestosIds` es 400,
  `clasificacionTributaria` junto a `tipo: 'ingrediente'` es 400, un ingrediente se guarda con
  `NULL`. Y un e2e de extremo a extremo: crear un ítem afecto sin tocar impuestos y venderlo
  cobra el 19% igual, con traza en `ventas_impuestos` — el bug de la entrada, por el camino
  por default.
  **Lo que quedó fuera en su momento:** el `?? 'afecto'` de `VentasService` al congelar el
  snapshot fiscal (`ventas.service.ts:396` y `:889`), diferido por el owner el 2026-07-31 por
  ser inalcanzable. Se cerró igual ese mismo día — ver la entrada de acá abajo.

- [x] ~~**`VentasService` rellena el snapshot fiscal con `'afecto'` cuando falta la
  clasificación tributaria, en vez de rechazar**~~ (backend) — cerrado 2026-07-31.
  **Lo que se midió antes de tocar nada: la entrada sobreafirmaba.** Daba `:396` y `:889`
  como el mismo problema y no lo son. En `:396` el dato viene de `items`, donde la columna
  **es** nullable (`string | null`), así que el riesgo era real aunque hoy inalcanzable. En
  `:889` —la nota de crédito— viene de `venta_detalles`, que es `NOT NULL` en el esquema y
  cuyo tipo de retorno en `validarDevolucionesReembolso` ya declara `string`: ahí el
  `?? 'afecto'` era **código muerto**, no un relleno peligroso. Poner un `throw` en `:889`
  habría sido una rama inalcanzable e intesteable.
  **Qué se hizo:** en `:396`, un guard temprano en el mismo loop que ya rechaza
  `tipo='ingrediente'` (paso 2 de `crear()`, antes de calcular precios y antes de escribir
  nada): si `clasificacionTributaria === null`, `BadRequestException`. El write site usa
  `!`, con el guard citado en el comentario. En `:889` se borró el `??` a secas.
  **Por qué rechazar y no rellenar:** el motor decide el IVA **antes**, con la condición
  positiva `=== 'afecto'`, así que un `null` ya cobró IVA cero; escribir `'afecto'` en
  `venta_detalles` deja una línea coherente consigo misma pero falsa respecto de lo que pasó
  — sin excepción ni log, indetectable por auditoría. Y el guard va arriba para que el
  rechazo no dependa del rollback de la transacción.
  **Mutante verificado:** revertido a `?? 'afecto'` (guard borrado), el test nuevo de
  `ventas.service.spec.ts` falla y la salida de Jest muestra el bug literal —
  `"clasificacionTributaria": "afecto"` en el detalle de un ítem cuya clasificación era
  `null`—. El test también asegura `calculoPreciosService.calcular` no llamado, así que
  distingue el guard temprano de un `throw` tardío en el write site.
  **Sigue inalcanzable por API** (el único tipo con clasificación nullable es `'ingrediente'`
  y `ventas.service.ts:191` lo rechaza antes): el test fija la conducta para cuando aparezca
  otro tipo no vendible o se relaje ese guard, y está anotado como tal.

- [x] ~~**Un impuesto propio llamado "IVA" se suma al IVA derivado: 38%**~~ (frontend) —
  cerrado 2026-07-31. **Decisión del owner:** no se puede impedir por código —el tenant es
  dueño de su catálogo de impuestos y una heurística de nombre en `ImpuestosService.create`
  le prohibiría nombrar como quiera, con falsos positivos garantizados—, así que la defensa
  es **explicar, no bloquear**.
  **Qué se hizo:** dos `AppInfoButton` (el patrón de "i" informativa que ya existía en
  `UserPreferencesForm` y `salones.vue`). Uno en el campo **Nombre** de
  `configuracion/impuestos.vue` — ahí es donde se comete el error, no al clasificar el ítem —
  diciendo que el IVA no se crea en esa pantalla y que uno llamado «IVA» se **suma** al
  automático. Otro en **Clasificación tributaria** de `configuracion/items.vue`, que explica
  que `Afecto` ya trae el IVA del país (con el porcentaje real, interpolado desde `ivaLabel`,
  no hardcodeado) y que congela en la venta. Junto con los placeholders que ya se habían
  cambiado (`"IVA"`/`"0.19"` → `"Impuesto verde"`/`"0.05"`), la UI dejó de guiar al error.
  **Lo que NO se tocó, a propósito:** el heurístico del seeder
  (`nombre ILIKE '%iva%'` + porcentaje idéntico). Se evaluó ampliarlo para agarrar
  `"I.V.A. 19"` o `"Impuesto al Valor Agregado"` y se descartó: más cobertura a cambio de más
  falsos positivos sobre impuestos legítimos, en un barrido que igual solo corre al arrancar
  el backend. Con la "i" en la UI, el heurístico dejó de ser la única defensa.
  **Sin test:** son textos. Verificado en navegador (drawer abierto, modal abierto, `ivaLabel`
  interpolando "IVA 19%", consola limpia) porque build y typecheck no ven nada de lo que pasa
  dentro de un drawer.

- [x] ~~**`seeder.service.ts` — el JOIN de detección de duplicados de IVA no filtra
  `eliminado_el`**~~ (backend) — cerrado 2026-07-31 agregando `AND t.eliminado_el IS NULL` y
  `AND p.eliminado_el IS NULL` a los JOIN de `remapImpuestosOficialesDuplicados`, con el
  mismo patrón que `impuestos.service.ts:41-44`.
  **La razón que daba la entrada estaba invertida y se corrigió acá.** Decía que sin los
  filtros "un tenant o provincia soft-eliminados podrían dejar pasar un duplicado sin
  desactivar". Es al revés: un `JOIN` sin filtro matchea **más** filas, así que sacar el
  filtro amplía el barrido, no lo reduce. La razón real para filtrar es la contraria — el
  barrido **soft-deletea impuestos ajenos**, y hacerlo sobre el catálogo de una empresa que
  ya no existe es destruir datos que nadie pidió tocar (invariante 3).
  **Y no pierde cobertura:** un tenant eliminado no vende, y si se restaura, el próximo
  arranque vuelve a alcanzarlo — la ventana es la misma que la ya documentada para cualquier
  duplicado nuevo ("creado a las 10:00, cobra doble hasta el próximo reinicio").
  **Sin test, y dicho de frente:** el seeder no tiene harness de tests, corre en
  `onApplicationBootstrap` y sus métodos son privados; el estado que el cambio distingue
  (tenant o provincia soft-eliminados con impuestos vivos) no se alcanza por API. Se evaluó
  un invariant spec que escanee el SQL del repo —al estilo de
  `uuid-columns.invariant.spec.ts`— y se descartó: distinguir `i.eliminado_el` de
  `t.eliminado_el` pide parsear alias, o sea maquinaria nueva y frágil para una query.

## Papelera — restaurar eliminados (2026-07-31)

- [x] ~~**El listado de `impuestos` no filtra los borrados del sistema — el `OR` sin
  parentizar**~~ (backend, `impuestos.service.ts`) — cerrado 2026-08-01. El `where` del
  listado con `incluirEliminados` ahora va parentizado
  (`'(i.tenant_id = :tenantId OR i.pais_id = :paisId)'`), así que el `andWhere` del filtro
  de borrado-del-sistema alcanza a las dos ramas. Se descartó `isolateWhereStatements`:
  es un flag global de la conexión y habría cambiado el SQL de todos los query builders
  del repo para arreglar una query.
  **Lo que realmente cerró el agujero no fue el paréntesis, fue el test.** El bloque e2e
  "solo lo que borró una persona" cubría **2 de los 16 recursos** —`categorias` e
  `items`— y esa muestra estaba elegida por **familia de borrado** (softDelete de TypeORM
  vs SQL cruda), que es cómo borran, no por la forma del `WHERE`, que es dónde puede
  fallar el filtro. `impuestos` es el **único** listado de los 16 con un `WHERE` de dos
  ramas, y era el único roto. Ahora el bloque está parametrizado sobre los **16**
  (`test/papelera.e2e-spec.ts`), con un guard de cobertura **derivado del esquema**: el
  test cruza la lista contra las tablas que tienen `eliminado_por` en
  `information_schema`, que es la columna que define la regla. Un conteo o una lista de
  nombres escrita al lado solo se compara consigo misma —agregar el recurso 17 sin tocar
  el spec pasaría en silencio—; contra la BD, agregar la columna a una tabla nueva rompe
  el test hasta que alguien decida conscientemente si va a la papelera.
  **Mutantes verificados, los dos:** (a) sacar los paréntesis con el e2e parametrizado
  puesto → rojo **solo en `impuestos`**, verde en los otros 15 (que es la prueba de que
  el diagnóstico era precedencia y no otra cosa); (b) el mismo mutante contra el unit
  spec nuevo (`impuestos.service.spec.ts` → "el filtro de borrado-del-sistema se aplica a
  las DOS ramas del OR") → rojo. Antes de ese unit test, el mutante pasaba en verde toda
  la suite unitaria.
  **Barrido para no repetir el error de medir un solo mecanismo:** los 10 fragmentos con
  ` OR ` en `where`/`andWhere` del repo quedan parentizados, `orWhere()` no se usa en
  ningún archivo, y `isolateWhereStatements` no está seteado en ninguna parte — o sea el
  15/16 que reportaba la entrada era correcto y no quedan gemelos.

- [x] ~~**`restaurar()` no limpia `eliminado_por`, y eso permite burlar la regla por
  API**~~ (backend, los 16 recursos) — cerrado 2026-08-01. Los 16 `restaurar()` ahora
  ponen las **dos** columnas en `NULL`. Dos técnicas, según la familia:
  - **7 de SQL cruda** (`items`, `causas-merma`, `motivos-diferencia`,
    `motivos-diferencia-inventario`, `grupos-modificadores`, `salones` —incluida la
    cascada a `mesas`— y `mesas` suelta): `SET eliminado_el = NULL, eliminado_por = NULL`
    en la sentencia que ya existía. `receta_extras_permitidos` y
    `grupo_modificador_opciones` **no** llevan el cambio: verificado contra
    `startup-pos.sql`, esas dos tablas no tienen columna `eliminado_por`. `mesas` sí la
    tiene, y por eso la cascada de `restaurarSalon()` también la limpia.
  - **9 de la familia `.restore()` de TypeORM** (`categorias`, `descuentos`, `recargos`,
    `impuestos`, `terceros`, `cajones`, `garzones`, `turnos`, `impresoras`): `restore()`
    **no servía** —solo nulea la `@DeleteDateColumn`—, así que pasaron a un
    `update({ id, tenantId }, { eliminadoEl: null, eliminadoPor: null })`: una sola
    sentencia con las dos columnas, no dos que puedan quedar a medias.
  **Verificado contra la fuente antes de elegir el diseño, no supuesto:** TypeORM inyecta
  el `eliminado_el IS NULL` de soft delete **solo** cuando
  `expressionMap.queryType === 'select'` (`node_modules/typeorm/query-builder/QueryBuilder.js`,
  `createWhereExpression()`), así que un `update()` sí alcanza una fila borrada. Si no
  fuera así, el `update()` habría afectado 0 filas **en silencio** — la misma clase de
  fallo mudo que costó una ronda entera en la Task 4.
  **Test y mutantes:** el bloque e2e de la regla suma un segundo `it` por recurso —los
  16— que corre la secuencia completa del backlog: crear → `DELETE` → `restaurar` →
  **asertar contra la BD** que las dos columnas quedaron en `NULL` → borrado del sistema
  sobre la misma fila → no aparece en la papelera y `restaurar` da 404. La aserción va
  contra Postgres y no contra el JSON de la respuesta a propósito: varios de los 16 no
  devuelven `eliminadoPor`, así que un test que mirara solo el cuerpo pasaría con la
  columna sucia. Mutante verificado en **las dos** familias por separado —volver
  `categorias` a `restore()` y sacarle `eliminado_por = NULL` a `causas-merma`—: rojo en
  los dos, verde en los otros 14.
  **Efecto lateral bueno:** las dos pantallas ya cableadas parchean
  `eliminadoEl`/`eliminadoPorNombre` a `null` en local tras restaurar
  (`items.vue`, `categorias.vue`); ese parche optimista pasó de divergir del backend a
  coincidir con él.

- [x] ~~**Los unit tests del listado con `incluirEliminados` no prueban nada**~~
  (backend, 14 de los 16 recursos) — cerrado 2026-08-01. **Los 16 recursos** (15 archivos
  de spec; `salones` cubre salones y mesas) ahora asertan el filtro de borrado-del-sistema
  en su listado. Era el test que faltaba: por esto el gate dio verde con los dos agujeros
  de arriba adentro, y es el octavo test de esta feature que pasaba sin probar lo que su
  nombre decía.
  ⚠️ **Los números de la entrada original estaban mal, los dos.** Decía "12 `qbMock`" y
  "11 restantes"; el conteo se había hecho **por tipo de mock y no por recurso**. Medido
  con `grep -l` sobre la cláusula: eran **14 de 16** sin aserción (`items` e `impuestos`
  ya la tenían). Es el mismo error que la entrada del `OR` — contar por el mecanismo en
  vez de por la conducta.
  **Dos técnicas, porque las dos familias no comparten forma:**
  - **8 con `qbMock` de TypeORM** (`categorias`, `descuentos`, `recargos`, `terceros`,
    `cajones`, `garzones`, `turnos`, `impresoras`): se asserta el argumento de `andWhere`
    **y el orden contra `where`** vía `mock.invocationCallOrder`. El orden no es
    ceremonia: `where()` resetea `expressionMap.wheres`, así que un `andWhere` que quede
    arriba se descarta entero, y `toHaveBeenCalledWith` —agnóstico al orden— no lo ve.
  - **6 con SQL cruda** (`causas-merma`, `motivos-diferencia`,
    `motivos-diferencia-inventario`, `grupos-modificadores`, `salones` + sus `mesas`): se
    asserta la **cláusula exacta con su alias** en el SQL que recibe el `dataSource.query`
    mockeado — no un `eliminado_por` suelto, que puede matchear el `SELECT` del mismo
    template o un comentario `--` (el modo de falla que ya costó una ronda en la Task 4).
  **`salones` no tenía NINGÚN test unitario de `listarSalones`**, así que se escribió: es
  el único de los 16 que aplica la regla en **dos** lugares de la misma query, y el filtro
  de la mesa va en el `JOIN` y no en el `WHERE` a propósito —puesto en el `WHERE` haría
  desaparecer el salón entero cuando alguna de sus mesas la borró el sistema—, así que el
  test fija también esa posición. Fijar posición pide **acotar el tramo** del SQL: un
  `toContain` sobre la query entera daba por bueno el filtro puesto en cualquier otro
  `ON` (medido: movido al JOIN de `usuarios` deja de filtrar mesas y el test seguía
  verde). Se acota al tramo `LEFT JOIN mesas` → siguiente `JOIN`/`WHERE`, y con eso
  mueren los dos desplazamientos, hacia el `WHERE` y hacia otro `ON`. De paso, la rama
  **sin** flag asserta el `m.eliminado_el IS NULL` del mismo JOIN, que tampoco tenía
  nadie: borrarlo devolvía el salón con sus mesas borradas adentro.
  **Mutantes verificados uno por uno, borrando el filtro del service.** Los **16**
  recursos mueren, y ninguno arrastra a otro —lo que importa porque tres alias colisionan
  entre recursos (`c`, `m`, `t`)—. El reparto exacto, que la primera redacción de esta
  entrada sumó mal (decía "7 + 8", que son 15): **8 `andWhere`** y **6 cláusulas de SQL
  cruda** (salón y mesa por separado) son los 14 que este cierre agregó; los otros 2 ya
  asertaban — `impuestos`, mutado en el commit anterior, e `items`, que venía de antes y
  se mutó acá para no afirmar los 16 sin haberlo comprobado.

- [x] ~~**`pendientes.md` clasifica mal a `grupos-modificadores.vue` para el fix de la
  carrera**~~ (doc) — cerrado 2026-08-01. La entrada de las 13 pantallas decía que
  `grupos-modificadores.vue` era la única que usa `usePaginatedList` y que por eso "ya
  hereda el fix, nada que hacer". **Falso, y de la peor forma para una instrucción**:
  mandaba a saltear justo la pantalla que necesita el arreglo. Solo importa el **tipo**
  `PaginatedResponse` y tiene su propio `cargar()` sin `cargaEnCurso`. Corregido a lo
  medido: **ninguna de las 13 pendientes usa el composable**, así que las 13 necesitan la
  cola serial local de `categorias.vue`, y el molde de test de `items.vue` —que ejercita
  el `watch` del composable— no les sirve.
  **La causa del error se puede nombrar, y es la misma de la semana:** el conteo se había
  hecho grepeando el **import**, no la **llamada**. Varias pantallas importan el tipo sin
  usar el composable. Por eso también el "14 consumidores" estaba mal: son **10 call
  sites** (8 páginas + 2 componentes), medidos por la llamada. Mismo número corregido en
  el comentario de `usePaginatedList.ts`.

- [x] ~~**Dos afirmaciones sueltas en `docs/features/papelera.md`**~~ (doc) — cerrado
  2026-08-01.
  - El bloque de contrato de la API decía que el 400 de colisión sale "en las 5 entidades
    con nombre único y también en `garzones`", contradiciendo la sección "Colisión al
    restaurar" 60 líneas más abajo. Medido contando los `restaurar()` que lanzan
    `BadRequestException`: son **9 de 16** — las 5 con índice único parcial, las **3 que
    enforcean por código** (`descuentos`, `recargos`, `turnos`, agregadas en la ola de
    fixes final y nunca reflejadas arriba), más `garzones`.
  - El **riesgo aceptado del PIN de `garzones`** no estaba escrito en ninguna doc. Ahora
    sí: `generarPinUnico()` compara contra los garzones **no eliminados**, así que un PIN
    queda libre mientras su dueño está en la papelera y restaurarlo puede dejar dos
    garzones vivos con el mismo PIN — justo lo que esa función existe para evitar. No se
    arregla porque `restaurar()` no puede compararlo: los PIN son bcrypt y no tiene el
    valor en claro. 1 en 10⁶ por creación, y regenerarle el PIN al restaurado sin avisar
    es peor que el problema. Queda escrito con el cierre posible (advertir y que decida un
    humano) para que la próxima persona no lo re-descubra ni lo "arregle" en silencio.

## Features diferidas

- [x] ~~**Log de cambios reversible ("deshacer") — dirección del owner, sin
  diseñar**~~ (transversal) — cerrado 2026-07-31 como **papelera + restaurar**, la
  segunda fila de la tabla de necesidades que planteaba la entrada original ("Borré
  algo la semana pasada"). Diseño completo:
  [`docs/superpowers/specs/2026-07-31-papelera-restaurar-eliminados-design.md`](../superpowers/specs/2026-07-31-papelera-restaurar-eliminados-design.md);
  doc operativa: [`docs/features/papelera.md`](../features/papelera.md).
  **Qué se construyó:** `eliminado_por` en las 16 tablas de catálogo del negocio y
  config operativa; `GET ...?incluirEliminados=true` en cada listado (mismo guard
  que ya protegía el `GET`); `POST /<recurso>/:id/restaurar` (mismo guard que el
  `DELETE`); colateral acotado por el `eliminado_el` exacto del borrado padre en 3
  recursos (`items`↔`receta_extras_permitidos`, `salones`↔`mesas`,
  `grupos-modificadores`↔`grupo_modificador_opciones`); huérfano tolerado sin
  cascada hacia arriba; 400 de colisión en las 5 entidades con nombre único por
  tenant más `garzones` (restricción propia sobre el placeholder "Mostrador", no
  nombre único). Confirma la observación que abarataba todo: para 16 de las tablas
  del alcance el dato borrado **ya estaba en la base** por la invariante 3 — faltaba
  el endpoint y la pantalla, no un modelo nuevo.
  **Qué se decidió NO construir, y por qué:**
  - **Revertir ediciones (volver un precio a su valor anterior).** La investigación
    de mercado (`docs/agent/investigacion-mercado.md`, corrida 2026-07-31) no
    encontró ni un solo POS que lo haga; el único ejemplo real de versionado con
    revert (Salesforce Field History Tracking) es view-only y de otro rubro.
  - **Bitácora de "quién cambió qué" (auditar ediciones).** `eliminado_por` cubre
    el borrado, que es lo que el caso de uso del owner pedía; auditar ediciones es
    otra feature, sin caso de uso concreto sobre la mesa.
  - **Cascada al restaurar.** El mercado es unánime en el sentido contrario:
    restaurar un ítem en Toast no lo devuelve a su menú, y en Square/Clover borrar
    una categoría deja los productos huérfanos sin bloquear nada. Se adoptó
    "huérfano tolerado + reasignación manual" en vez de intentar reconstruir el
    árbol de relaciones al momento del borrado.
  - **Ventana de retención y purga automática.** Ningún producto relevado (5,
    internacionales y chilenos) la documenta, y el soft delete del proyecto ya es
    permanente — agregar una ventana habría sido inventar una regla que nadie
    pidió.
  **Límite que se mantuvo, sin cambios:** el kardex sigue inmutable (ADR-007, se
  compensa con movimiento contrario) y el hecho fiscal de una venta emitida sigue
  congelado (ADR-010) — ninguno de los dos entra a la papelera. Un "revertir
  cualquier cosa" uniforme seguía sin ser alcanzable, y la papelera no lo intentó.
  **Consecuencia sobre otra entrada de este archivo:** desbloqueó "Un descuento,
  recargo o impuesto desactivado sigue aplicándose" (`pendientes.md`, auditoría
  `items` + `calculo-precios`), que esperaba esta decisión antes de poder
  encararse — ver esa entrada para el detalle de lo que sí quedó abierto ahí.


---

## Ronda de decisiones del owner (2026-08-07)

Las tres salieron de la misma tanda: el owner eligió **advertir** en las dos de garzones y
dio el OK para tocar `propinas`. El texto de cada entrada se muda verbatim; lo que la
entrada afirmaba **de más o de menos** se anota en su bloque de cierre.

- [x] **Los tres DTO de liquidación de propinas aceptan fechas que no existen, y el período
  se corre en silencio** (backend, `propinas/dto/{liquidar,create-liquidacion,preview-liquidacion}.dto.ts`)
  — usan `@IsISO8601()` sin `strict: true`, que valida la FORMA y no el calendario.
  Medido con `validateSync` + `new Date`:

  | valor | `@IsISO8601()` | con `strict: true` | `new Date(valor)` |
  |---|---|---|---|
  | `2026-02-31` | acepta | rechaza | **2026-03-03** |
  | `2026-04-31` | acepta | rechaza | **2026-05-01** |

  El hueco es **exactamente el día que se pasa de mes**: un mes fuera de rango
  (`2026-13-01`) el laxo ya lo rechaza, así que nunca llega a `new Date`.
  Y lo grave no es un error sino el **rollover silencioso**:
  `liquidacion-propinas.service.ts:157` hace `new Date(dto.fechaDesde)` y JS convierte el 31
  de febrero en el 3 de marzo sin avisar. La fecha corrida **llega hasta el SQL** —viaja como
  `$2`/`$3` en el `vp.creado_el >= $2 AND vp.creado_el < $3` de `buscarTipsElegibles`
  (`:1125-1155`)— y además **queda persistida** en la fila de la liquidación (`:814`). La
  guarda `fechaHasta <= fechaDesde` (`:159`) no corta: compara dos `Date` ya corridos.
  Es plata, y no falla: liquida sobre un período distinto al pedido.
  Son **dos** puntos de entrada, no uno: `crear()` (`:157`) y el camino de confirmar
  (`:578-609`), que repite el mismo `new Date` con la misma guarda.
  El arreglo es una palabra (`{ strict: true }`) en seis decoradores. Sale de la revisión
  del cierre del 2026-08-07, al endurecer el DTO gemelo de `turnos` — **queda fuera de ese
  diff porque toca otro módulo**, no porque sea menor.
  **Cómo se cerró (2026-08-07).** Los seis `@IsISO8601({ strict: true })`, más un
  normalizador `rangoLiquidacionDesde` (`propinas/utils/rango-liquidacion.ts`) en los
  **tres** puntos donde se construye el `Date`: `crear()`, `liquidar()` y el `preview` del
  controller — la entrada contaba dos y el del controller (`:45-46`) hacía el mismo
  `new Date` sin ninguna guarda.
  ⚠️ **"El arreglo es una palabra en seis decoradores" era incompleto, y se midió.** `strict`
  cierra el rollover, pero **no** cierra `2026-W32-1` ni `20260807`: son ISO 8601 legítimas,
  así que las acepta, y `new Date` devuelve `Invalid Date`. Ahí la guarda de orden tampoco
  ayuda —compara `NaN <= NaN`, que es siempre `false`—, así que el `Date` inválido llegaba a
  la query. Medido contra el Postgres del compose: `invalid input syntax for type timestamp
  with time zone: "0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN"`, o sea un **500**. Son dos modos de
  falla distintos —el rollover corrompe en silencio, la ilegible revienta— y el decorador
  solo tapa el primero.
  **Lo que NO se copió de `turnos`:** el `@Matches(/^\d{4}-\d{2}-\d{2}$/)` que allá era
  obligatorio (el SQL hace `::date`). Acá el service hace `new Date`, así que un timestamp
  completo es un límite de período legítimo y el regex habría roto a quien mande hora. Hay un
  test que lo fija.
  **Lo que fija cada cosa:** revertir `strict` en un solo DTO mata sus 3 casos de calendario y
  deja vivos los de los otros dos; sacar el chequeo de `Invalid Date` mata **6**
  —los dos casos `2026-W32-1`/`20260807` en cada uno de los tres archivos que lo ejercen:
  el spec del util, el del controller y el del service—; y revertir `crear()` al `new Date` inline mata su test de cableado
  sin tocar el de `liquidar()`. Hay además un test que afirma el **hueco** —que el decorador
  acepta `2026-W32-1`— para que, si algún día `strict` empieza a rechazarlo, la defensa se
  mueva en vez de desaparecer.
  **Refutado de la propia entrada:** decía que el hueco era "exactamente el día que se pasa de
  mes". No: `2026-02-29` (año no bisiesto) también rueda, y `2028-02-29` —bisiesto real— tiene
  que seguir pasando. Los dos están en el spec.
  ⚠️ **`query-propina-reporte.dto.ts` NO se tocó, a propósito:** usa `@Matches` solo, la misma
  forma que causó la regresión en `turnos`, pero `normalizarRangoReporte` ya hace el
  round-trip `toISOString().slice(0,10) !== dto.desde`, que mata la fecha corrida con un 400.
  Está protegido **por conducta, no por decorador**. Grepear el mecanismo habría "arreglado"
  algo que ya funcionaba.
- [x] **`garzones.actualizar()` deja cambiar el `tipo` con una sesión abierta, sin avisar**
  (backend, `garzones.service.ts:139` — el gate que sí existe está en `:134-136`, y solo
  mira `activo`) — **la mitad `activo` de esta entrada se cerró el
  2026-08-07** (más arriba en este mismo archivo); esta es la mitad que sigue abierta
  porque **es decisión de producto, no mecánica**. `sesion_garzon.tipo_garzon` se congela al
  abrir la sesión, así que cambiar `garzones.tipo` a mitad de turno no corrompe el reparto
  —`assertGarzonEnUnSoloGrupo` corta la liquidación con un 400 accionable— pero el admin no
  se entera hasta ese momento. Lo que falta decidir es **qué hacer en el momento de editar**:
  bloquear como hace `activo`, o solo advertir. No es simétrico con `activo`: desactivar
  rompe la operación del garzón ahora mismo; cambiarle el tipo, no.
  **Decisión del owner (2026-08-07): advertir, no bloquear.** Bloquear obligaría a cerrar el
  turno para corregir un tipo mal cargado, y el cambio no rompe nada mientras el turno corre.
  **Cómo se cerró:** `actualizar()` devuelve `advertencias: string[]` —la forma que ya usan
  `ventas` e `items`, no el `{titulo, detalle}` que es exclusivo del motor de precios— con el
  aviso de que el reparto de ese turno sigue usando el tipo congelado y de que el cambio rige
  desde la próxima sesión. El mensaje nombra **los dos** tipos: sin el anterior, el admin no
  sabe qué se sigue usando. La pantalla lo emite como toast `warning` **después** del de
  éxito, porque el cambio sí se guardó.
  **El caso que no estaba en la entrada:** los formularios mandan el objeto entero, así que
  `tipo` viene aunque nadie lo haya tocado. Sin comparar contra el tipo actual, cada cambio de
  nombre con un turno abierto habría disparado una advertencia falsa —y una consulta de
  sesiones al pedo. Hay un test que lo fija, y el mutante que saca la comparación lo mata.
  **Lo que trajo la revisión independiente:** (a) el mensaje decía solo que el cambio "rige
  desde la próxima sesión", que suena inocuo — ahora nombra la consecuencia cara: si la
  persona genera propinas con los dos tipos en un mismo período, la **regla 2b** corta la
  liquidación de ese período con un 400 hasta partirlo en dos; (b) un `PATCH` que desactiva
  **y** cambia el tipo corría la misma consulta de sesiones dos veces, porque el formulario
  manda el objeto entero. Ahora el conteo se hace una sola vez y `assertSinSesionAbierta`
  lo recibe ya hecho. Test propio, con mutante que revierte a las dos consultas.
- [x] **`regenerarPin()` invalida el PIN sin avisar que hay una sesión abierta** (backend,
  `garzones.service.ts:147-153`) — misma familia que la anterior por otra puerta. El PIN
  viejo deja de funcionar de inmediato (documentado y deliberado), pero si el garzón está
  en turno no puede marcar salida ni operar hasta que alguien le pase el nuevo. Es una
  acción de seguridad rutinaria (PIN comprometido) con un efecto que nadie anticipa.
  **Decisión del owner (2026-08-07): advertir, no bloquear.** Rotar una credencial es la
  respuesta correcta a una filtración; trabarla porque hay un turno abierto sería la política
  al revés.
  **Cómo se cerró:** `regenerarPin()` devuelve `advertencias` igual que `actualizar()`, y la
  pantalla las muestra **dentro del modal que revela el PIN**, no como toast: el modal tapa la
  pantalla, el admin está mirando el PIN que tiene que entregar, y de eso habla el aviso. Un
  toast detrás del modal se pierde. Hay un test que afirma esa ubicación y que el aviso **no**
  se duplica como toast.
  **Efecto lateral atendido:** `crear()` también devuelve `GarzonConPin`, así que manda
  `advertencias: []`. Un garzón recién creado no puede tener sesión abierta, pero el array va
  igual para que el que consume no tenga que distinguir este endpoint de los otros.
  ⚠️ **Lo que costó de verdad fue el test de la pantalla, y no por el código de producción.**
  Los dos casos que pasan por el drawer dejaban `vitest run` en **exit 1** con 4
  *unhandled rejections* —2 por cada test que cierra el drawer, y los 13 igual "pasaban"— porque **cerrar** un `UDrawer` real bajo
  happy-dom hace que la transición de salida de `usePresence` (reka-ui) lea `style.display`
  de un nodo ya desprendido. Aislado con una variable: abrir el drawer y desmontar sale
  limpio; abrir, guardar —que hace `drawerOpen = false`— y desmontar da 2 rejections. La
  salida fue stubear `AppDrawer` en el `global.stubs` del propio mount, el mismo recurso que
  `components/AppDrawer.spec.ts` usa un nivel más abajo con `UDrawer`
  (`docs/patterns/frontend.md` §15).
  ⚠️ **Primero lo resolví con `mockComponent` y lo justifiqué diciendo que `global.stubs` no
  intercepta auto-imports. Es falso, y lo midió la cuarta revisión:** `global.stubs` sí los
  intercepta bajo `mountSuspended`, tanto `AppDrawer` (directo) como `UDrawer` (anidado). O
  sea que había elegido la herramienta de alcance de ARCHIVO —capaz de stubear el drawer de
  otros `describe` en silencio— por una limitación inventada. Quedó en `global.stubs`,
  acotado al mount. Lo otro que salió de ahí: el botón es
  `type="submit" form="garzon-form"`, y esa asociación por id la resuelve el **documento**,
  así que ese montaje necesita `attachTo: document.body` —con el `UDrawer` real no se notaba
  porque teletransporta al body—. Sin `attachTo` el submit no dispara y los dos tests mueren.
  ⚠️ **Acá me equivoqué y lo dejo anotado, no borrado.** Cuando los tests fallaban con la
  lista de toasts vacía cambié **dos cosas a la vez** —`trigger('click')` por `.click()`
  nativo, y después `attachTo`— y le atribuí el arreglo al click. Es falso: medido, con
  `trigger('click')` los 13 pasan igual y el mutante que saca el toast de éxito sigue
  matando los dos tests del drawer, o sea que el submit corre por los dos caminos. Lo único
  que hacía falta era `attachTo`. Lo cazó la segunda ronda de revisión independiente —el
  **mismo error, con las mismas dos variables**, que el caso 1 de
  `anti-patterns.md` → *"Rotular «medido» algo que no se midió"* (método de click + opción
  de montaje, atribuido al click). Esa entrada la agregó `f3f65c1c`, dos commits antes.
  O sea: la regla ya estaba escrita, y aun así se repitió — lo que la vuelve a cazar es la
  revisión independiente, no el recuerdo de haberla escrito. Que el stub no vuelva el test vacuo lo prueba el mutante que
  saca el toast de éxito de `guardar()`: mata los dos casos del drawer.
  ⚠️ **Y lo caro de la tanda: yo di el gate del frontend por verde grepeando la línea
  `Tests 619 passed` sin mirar el exit code.** Lo cazó la revisión independiente, no el
  gate. `npm test` puede terminar en 1 con todos los tests en verde.

---

## Selector de garzón antes del PIN (2026-08-08)

- [x] **El PIN de garzón amplifica la carga: cada intento fallido cuesta N bcrypt**
  (backend, `garzones.service.ts` → `resolverGarzonPorPin`) — itera **todos** los garzones
  activos del tenant comparando con bcrypt, porque el hash está salteado y no se puede
  buscar por índice.
  ⚠️ **La fuerza bruta que reportó la lente NO sobrevive, y se midió:** `bcryptjs` a coste
  10 tarda **62,5 ms** por comparación, así que un intento con 20 garzones activos son
  **1,3 s de CPU** y agotar el espacio de 10⁶ son **14 días de CPU saturada** por tenant.
  No es un vector práctico y sería ensordecedor.
  **Lo que sí sobrevive es otra cosa:** medido con 5 intentos concurrentes, **6,3 s** y
  hasta **309 ms de lag del event loop**. Es un solo proceso Node: ese lag lo pagan todos
  los tenants. Cualquiera con `Salones:Operar` puede provocarlo.
  El fix **no es throttling** (la entrada de rate limiting de "Endurecimiento para
  producción" está acotada a `/auth/*` y no cubre esto): es dejar de iterar, y eso exige
  decidir cómo — seleccionar el garzón antes de pedir el PIN cambia la UX; un HMAC con
  secreto de servidor en columna indexada permite buscar y conservar bcrypt para verificar.
  **Decisión de owner sobre el mecanismo de una credencial.**
  **Cómo se cerró (2026-08-08): seleccionar el garzón antes de pedir el PIN.** Decisión del
  owner. `resolverGarzonPorPin(tenantId, pin)` —que traía todos los activos y comparaba uno
  por uno— pasó a `verificarPin(tenantId, garzonId, pin)`: **una fila, un bcrypt**. Migrados
  los 7 llamadores y borrado el viejo, para que no vuelva por copiar-pegar.
  **El HMAC quedó descartado** al tomar la decisión: no hace falta criptografía nueva ni
  columna nueva si la pantalla ya sabe a quién comparar.
  **Dos listas complementarias, no una** (`GET /garzones/para-selector?enTurno=`): los que
  **no** están en turno para *entrar a turno* —quien ya tiene sesión abierta no puede abrir
  otra— y los que **sí** para los otros cinco caminos. La lista **codifica la regla**: el 400
  `El garzón ya tiene una sesión abierta` deja de **ofrecerse**. ⚠️ No de existir: la lista
  se pide al abrir el modal y el mismo garzón puede entrar a turno en **otro tótem** antes
  del submit. El guard sigue siendo el que manda.
  ⚠️ **`enTurno` es obligatorio y sin default, a propósito.** Con default, el llamador que se
  olvide recibe la lista equivocada **sin ningún error**.
  ⚠️ **`Salones:Operar`, no `Leer`.** Medido sobre el modelo, no sobre el seed: los roles son
  configurables por tenant, así que nada impide un rol que opere el salón sin poder leer el
  catálogo — y es exactamente quien necesita el selector. Por eso no se reusó `GET /garzones`.
  **Corrección sobre el plan:** decía eliminar `POST /identificar` porque "pierde su razón de
  ser". Era falso y se detectó al implementar: tenía un segundo trabajo —verificar el PIN
  **sin ejecutar la acción**, para que el modal muestre el error en línea y el usuario
  reintente sin perder lo que estaba haciendo—. Se conservó como `POST /verificar-pin` con
  `garzonId`: mismo trabajo, 1 bcrypt en vez de N.
  **Lo que fija cada cosa:** revertir a la iteración mata el test de "una sola consulta"
  —fixture con **dos** garzones, porque con uno solo iterar y no iterar dan el mismo número—;
  invertir `EXISTS`/`NOT EXISTS` mata 2 tests del e2e; y hacer que el modal ignore la
  elección y mande el primero mata el test de la pantalla, que por eso también tiene dos
  garzones en el fixture.
  ⚠️ **El e2e `garzones-selector` existe por una lección, no por completitud:** el unit
  mockea el query builder, así que puede afirmar `EXISTS`/`NOT EXISTS` pero **no que el SQL
  compile**. Es el mismo agujero por el que el 2026-08-07 se commiteó un `SELECT` con una
  columna inexistente con el gate entero en verde.
  ⚠️ **El fix cambió un número que esta misma entrada da por bueno más arriba.** El texto
  mudado dice que agotar 10⁶ son *"14 días de CPU saturada"* y que "no es un vector
  práctico" — cifra que suponía **N bcrypt por intento**. Con `verificarPin` es **1**:
  10⁶ × 62,5 ms ≈ **17 h de CPU** contra un garzón concreto, 20× más barato. Matiz honesto:
  comprometer a *alguno* cuesta casi lo mismo que antes, porque la iteración vieja probaba
  cada intento contra los N a la vez. Pero `/garzones/verificar-pin` es un oráculo de PIN
  **sin throttling** —el rate limiting sigue acotado a `/auth/*`— y la cifra vieja no debe
  quedar como última palabra. Anotado en `pendientes.md`.
  **Lo que NO se hizo, con fundamento** (detalle en el plan): el modo personal (Fase 2,
  bloqueada por el alta de usuarios), el timeout del tótem con ticket de garzón (el ticket
  cierra la falsificación pero no la presencia, y contra el atacante realista —el que está
  parado al lado— el valor útil del timeout es 0), y cualquier configuración de "modo
  estricto".

---

## El encargado que fuerza un cierre NO cuenta a ciegas (cerrado 2026-08-13)

**Cómo se cerró.**

Decisión de alcance, no bug — lo levantó la revisión independiente de la Task 6 (2026-08-13); **resuelta en su mitad
  operativa por decisión del owner el mismo día** (task 6b, plan `testigo-cierre-forzado`).
  La spec del testigo dice *"cuenta a ciegas: sin ver lo esperado"*, y hasta acá **no era
  así**: forzar el cierre exigía ser admin del tenant (`caja.service.ts` → `enviarConteo`,
  `esForzado && !esAdmin` → 403), y el modo ciego **exime al admin por diseño previo** (§3.4:
  *"el dueño no es el objetivo del anti-fraude"*). Como quien forzaba siempre era admin,
  quien forzaba SIEMPRE veía el esperado mientras contaba la plata de otro — la contradicción
  era de la spec contra una decisión anterior, no de la implementación contra la spec.

  ✅ **Lo que resolvió la task 6b:** forzar dejó de exigir ser admin del tenant y pasó a
  exigir `Cajas:Actualizar` (mismo permiso que ya exigía pedir la firma, `POST
  /caja/:id/testigos` desde la Task 6 — la incoherencia entre las dos mitades del mismo
  camino). Se sembró un usuario nuevo del rol para probarlo: `encargado@paris.cl`
  (`Cajas:Leer` + `Cajas:Actualizar`, no admin). Con eso, **por primera vez existe alguien
  que fuerza y cuenta a ciegas de verdad** — la promesa original de la spec, que hasta acá
  nadie no-admin podía ejercer porque forzar y estar exento del ciego eran la misma
  condición. Cubierto por `caja.e2e-spec.ts` → *el modo ciego SÍ aplica al encargado que
  fuerza (no admin)*.

  📌 **Lo que NO se tocó, por decisión explícita del owner (task 6b, decisión 2):** el admin
  del tenant **sigue exento del ciego incluso forzando** — la misma exención de siempre
  (§3.4), sin condicionarla a si la caja es propia o ajena. Las **cuatro** superficies que la
  aplican (`obtenerArqueo` `caja.service.ts:464-466`, `cajonesEstado` `:1204`,
  `resumenMovimientos` `:1332`, historial) no cambiaron una línea — la task 6b lo verificó
  con test, no lo implementó. De las tres opciones que este ítem dejaba abiertas ((a) corregir
  la spec, (b) eximir al admin solo en caja propia, (c) configurable por tenant), el owner
  eligió en los hechos **(a)**: el producto sigue exceptuando al admin siempre, así que la
  spec del testigo debería decir "cuenta a ciegas — salvo el admin del tenant, que nunca es
  el objetivo del anti-fraude" en vez de una promesa sin excepciones. Ese ajuste de texto de
  la spec queda afuera de esta entrada.
  🔗 Emparentado con el ítem ya conocido de que el ciego tapa el esperado en arqueo/drawer pero
  **no** en el panel de resumen del turno — ese ítem hermano sigue abierto, sin tocar acá: es
  el mismo problema de fondo —el ciego se definió vista por vista y no como una propiedad de
  "quién puede ver qué"—.

---

## Cierre forzado de caja ajena por el encargado, con firma de testigo (cerrado 2026-08-13)

**Entregado completo** por el plan `testigo-cierre-forzado` (tasks 1-8 + la 6b insertada por
decisión del owner). Ciclo de punta a punta, verificado en navegador contra el stack real:
el encargado cierra la caja de un cajero ausente desde `/cajas/:id`, le pide fe a un garzón
en turno, y el garzón firma o rechaza desde `/salones`.

Lo que quedó, además de lo que pedía la entrada original:

- **Forzar es operativo, no del admin del tenant** (`Cajas:Actualizar`) — el owner lo
  corrigió el 2026-08-13: *"el administrador no siempre estará pendiente"*. Efecto que salió
  gratis: como el modo ciego exime solo al admin, **el encargado cuenta a ciegas cuando el
  tenant tiene el modo ciego activo** (`tenants.arqueo_ciego`, opt-in, default `false`) —
  antes de esto, forzar y estar exento del ciego eran la misma condición, así que la promesa
  del diseño no la podía cumplir nadie.
- **Dos vías de firma**, congeladas en el registro (`via_firma`): por cuenta vinculada
  (prueba fuerte) o por PIN (identifica al garzón, no prueba quién lo tecleó).
- **Sin firma hay que explicar**, y el comentario de la fase 1 alcanza. `testigos_disponibles`
  hace verificable el "no había a quién pedirle".
- La solicitud solo se puede pedir con **el conteo ya congelado**, que es lo que hace que la
  firma valga; cubierto por un mutante en e2e.

Detalle funcional: [`gestion-cajas.md`](../features/gestion-cajas.md#ciclo-de-vida-de-una-solicitud-de-testigo).

**Lo que NO cerró y sigue abierto en `pendientes.md`** (no se arrastra acá): la aprobación por
umbral de diferencia, el texto de la spec que promete un ciego sin excepciones, y que
`Cajas:Actualizar` quedó siendo un permiso grueso.

### Texto original de la entrada

- [x] **Cierre forzado de caja ajena por el encargado** (backend + modelo) — ✅ **completo**
  (plan `testigo-cierre-forzado`, backend Tasks 1-5 + frontend Task 6, 2026-08-13): un admin
  del tenant (no cualquiera con permiso `Cajas`) puede cerrar la caja de un cajero que dejó
  el turno abierto. `cerrada_por` quedó registrado en `cajas` (quién contó/cerró, distinto
  de `usuario_id`), rompiendo el owner-only del cierre para el admin del tenant
  (`RbacService.userIsTenantAdmin`). Suma la firma de testigo: el encargado le pide fe a un
  garzón en turno, que firma o rechaza desde su propia sesión (cuenta vinculada o PIN); sin
  firma alguna, la fase 2 exige un comentario que explique qué pasó. Detalle completo:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#modelo-de-acceso-por-permiso).
  ✅ **Decidido por el owner (2026-08-11): sí, con `cerrada_por` registrado, y la diferencia
  queda como INCIDENTE, no como faltante del cajero.**
  El criterio salió de la 4ª pasada de investigación (§10 de
  [`investigaciones/2026-07-23-gestion-caja.md`](investigaciones/2026-07-23-gestion-caja.md)):
  el estándar condiciona la responsabilidad del cajero a **dos** requisitos acumulativos
  —acceso exclusivo **y** oportunidad de estar presente en el conteo—, así que contar sin él
  **cae la imputación**. No pasa a nombre de quien contó: eso no existe como doctrina.
  🇨🇱 Y pesa un dato legal: sin **asignación de pérdida de caja** pactada, en Chile **no se
  puede descontar** un faltante del sueldo (DT, ORD. N°4229). La atribución vale como
  **prueba, no como cobro** — lo que hay que asegurar es la trazabilidad, no el culpable.
  ⚠️ **Validar con abogado antes de escribir la regla**: la fuente es doctrina de la DT
  leída por un agente, no asesoría legal.
  Pesó una consecuencia operativa que no estaba escrita acá: como solo puede haber **una
  caja física abierta por tenant+usuario**, una caja que su dueño no vuelve a cerrar deja a
  esa persona **sin poder abrir caja nunca más**. Sin cierre forzado, ese bloqueo necesita
  otra salida igual.
  Sigue sin migrar a `resueltos.md` por dos motivos: el ítem de abajo (aprobación por umbral)
  todavía referencia el cruce sin resolver contra este, y **falta la pantalla del garzón**
  (Task 7) — hasta que exista, la firma se puede pedir pero no completar desde la UI.

## El PIN del garzón no es suyo: lo emite el encargado y lo ve en claro (cerrado 2026-08-15)

**Entrada original (verbatim):** *"El PIN del garzón no es suyo: lo emite el encargado y lo ve
en claro (backend, medido 2026-08-12 al implementar el testigo del cierre) —
`garzones.service.ts` devuelve el PIN en texto plano al crear y al regenerar un garzón, y no
existe ningún flujo para que el garzón lo cambie. Consecuencia: el PIN identifica pero no
prueba que actuó esa persona — quien lo emitió puede tecleárselo, y en un local la pantalla
del garzón es un tótem compartido, así que ni siquiera hace falta usar la cuenta propia. [...]
Ojo con el orden respecto del testigo: si esto se hace antes, la doble vía de firma (cuenta vs
PIN) puede volverse innecesaria — la vía PIN dejaría de ser 'solo identifica', porque el
encargado ya no conocería el PIN por construcción."*

⚠️ **Corrección al encuadre, medida el 2026-08-14 al diseñar el arreglo** (spec
[`2026-08-14-pin-propio-garzon-design.md`](../superpowers/specs/2026-08-14-pin-propio-garzon-design.md),
sección *"Lo que esta feature gana — y lo que NO"*): la entrada original especulaba que
arreglar el PIN **convertiría la vía `'pin'` del testigo en prueba real**. Medido contra
`CajaTestigoService.resolver` (`caja-testigo.service.ts:351-378`), **no es así**: el garzón
**con cuenta** ya firmaba por la vía fuerte (`via_firma='cuenta'`, exige el JWT de esa cuenta;
el PIN ni se mira) desde que existe el testigo. La vía `'pin'` la usan **por construcción**
los garzones **sin** cuenta —`esVinculacionValida` decide cuál rama toca—, y a esos el
encargado les sigue emitiendo el PIN exactamente igual que antes. **La vía débil del testigo
queda exactamente igual de débil**, y está bien: escribir lo contrario en la documentación
habría sido peor que no escribirlo. Detalle: [`gestion-cajas.md`](../features/gestion-cajas.md#las-dos-vías-de-firma-y-por-qué-no-son-equivalentes).

**Lo que sí gana, que es otra cosa y es más ancho: el tótem compartido.** Antes de esto, una
persona con cuenta que operaba desde el tótem compartido no probaba nada —el encargado conocía
su PIN—. Con el arreglo, el garzón con cuenta fija su propio PIN y el encargado nunca lo ve, así
que operar desde el tótem con ese PIN sí prueba identidad. Eso alcanza **mesas, comandas, inicio
y cierre de turno, y la atribución de propinas** — todo lo que pasa por ese teclado, que es el
alcance que la entrada original ya señalaba correctamente.

**Qué se hizo** (plan `pin-propio-garzon`, 9 tareas, 2026-08-14/15):

- El disparador es **vincular** una cuenta, no el alta: la transición `usuarioId: null → uuid`
  pone `pin_hash` en el centinela `'!'` (medido: `bcrypt.compare` contra ese valor da `false` y
  no tira), así que el encargado nunca llega a ver un PIN de alguien con cuenta. El alta admite
  `usuarioId` directamente, con el mismo efecto.
- `PATCH /garzones/mi-pin` (JWT + tenant, sin permiso de módulo — `PermisosGuard` es
  `return true` sin el decorador) deja al garzón fijar su PIN **sin pedir el anterior**: el caso
  principal es el olvido, y exigirlo habría dejado a la persona sin salida.
- La unicidad se cae **solo para el PIN elegido** — rechazar la colisión lo habría convertido en
  oráculo de PIN ajenos, ya que siempre se elige a la persona antes de teclear — pero se conserva
  donde el sistema genera el PIN (alta sin cuenta, regeneración). Se rechazan PIN obvios
  (repetidos y escaleras de 6 dígitos).
- `PATCH /garzones/:id/pin` (la que ya existía) se parte según el garzón, no según la ruta: con
  cuenta **invalida sin revelar nada** (`pin: null`); sin cuenta **regenera y revela**, como
  siempre. Una sola ruta, porque el encargado no puede elegir mal — manda el estado del garzón.
- Historial completo (no solo el último cambio) en la tabla nueva `garzon_pin_evento`, cinco
  tipos de evento, escrito en la misma transacción que el cambio de `pin_hash`. Nunca guarda el
  PIN, solo el hecho de que cambió. Visible para el encargado (ficha) y el propio garzón (perfil,
  `GET /garzones/mi-pin`). **La ficha lo muestra para todos los garzones, con cuenta o sin ella**
  (decisión del owner, revisión final 2026-08-15): `emitido_en_alta` y
  `regenerado_por_encargado` son los únicos eventos que produce un garzón sin cuenta, y su
  perfil no existe (`miPin` resuelve por `garzonPersonalDe`, que exige `usuario_id` → 404), así
  que la ficha es la única pantalla donde se ven — y es el caso que justifica el log entero,
  porque con cuenta el encargado no regenera, invalida. Sin superficie nueva (el endpoint ya era
  `Salones:Leer`, el mismo de la ficha) y sin N+1 (una llamada por apertura de ficha, nunca una
  por fila; lo fija el test *"cero N+1: el listado no pide ningún historial…"*). El badge tiene
  **tres estados** y se muestra siempre que **no haya PIN usable**, con cuenta o sin ella; el
  único caso que lo esconde es *"sin cuenta y con PIN usable"*, donde *"PIN puesto"* significaría
  *"lo puso la persona"* y eso nunca pasó. Se descartó la regla más simple —esconderlo para todo
  garzón sin cuenta— porque se apoyaba en una premisa **falsa**: que un garzón sin cuenta siempre
  tiene un PIN emitido por el sistema. **Desvincular lo desmiente**, y se llega desde el propio
  formulario vaciando el selector: `actualizar()` pisa `pin_hash` solo en la transición
  `null → uuid` (`vinculaCuenta` exige `dto.usuarioId !== null`), así que un garzón dado de alta
  **con** cuenta y después desvinculado queda `usuario_id: null` **y** `pinFijado: false` — no
  puede operar por ningún lado (el tótem compara contra el centinela, el modo personal necesita
  el vínculo) ni arreglarlo solo (`fijarMiPin` le da 404 sin `usuario_id`). Ese estado lleva
  rótulo propio, *"Sin PIN: no puede operar"* en color `error`, separado de la espera normal
  (*"Sin PIN todavía"*, con cuenta): la salida de uno es que el encargado genere un PIN, la del
  otro es que la persona lo ponga desde su perfil.
- Aviso en `/salones`, modo personal, cuando el garzón no tiene PIN usable. Dos ramas con texto
  distinto según `tipo` (`TEXTO_INVALIDACION`, `index.vue:182-188`) — invalidado por el
  encargado: *"Bruno invalidó tu PIN (10-08-2026, 8:00 a. m.)"*; invalidado por vincular una
  cuenta: *"Tu PIN quedó sin efecto al vincular esta cuenta (Bruno, 10-08-2026, 8:00 a. m.)"* —
  y en las dos, el mismo sufijo que aclara que **no** es un bloqueo de este dispositivo: *"Desde
  este dispositivo trabajás normal; para el tótem compartido, hace falta ponerlo desde tu
  perfil."* Fijado por test (`index.nuxt.spec.ts:998-1020`) y explicado en el docblock de
  `avisoPin` (`index.vue:190-195`).

**Mutantes que fijan el comportamiento** (cada uno revierte al comportamiento anterior, no solo
rompe algo): quitar la invalidación al vincular, devolver el PIN en la rama de invalidación,
saltear la escritura del evento. Dónde cae cada uno, **medido contra los specs** en la revisión
final del 2026-08-15 (la redacción anterior citaba `garzones-selector.e2e-spec.ts`, que **no
asierta nada** sobre invalidación, vínculo ni eventos —sus únicas menciones están en un
comentario— y omitía `garzon-pin.e2e-spec.ts`, que es el spec construido para este ciclo):

| Mutante | Unit (`garzones.service.spec.ts`) | E2E |
|---|---|---|
| Quitar la invalidación al vincular | *"vincular una cuenta invalida el PIN y lo registra"* (+ *"DESVINCULAR no toca el PIN"* como contraste) | **Ninguno.** Ver la nota de abajo |
| Devolver el PIN en la rama de invalidación | *"CON cuenta: invalida, no devuelve PIN, y lo registra"* | `garzon-pin.e2e-spec.ts` → *"el encargado lo invalida sin ver ningún PIN, y el viejo deja de servir"* (`expect(res.body.pin).toBeNull()`) |
| Saltear la escritura del evento | los dos tests de arriba afirman sobre el evento guardado | `garzon-pin.e2e-spec.ts` → *"la historia quedó completa, en orden y con nombre del actor"* |

⚠️ **El primer mutante no tiene red en e2e, y conviene saberlo antes de confiarse — pero el
recorrido ya existe: lo que falta es la aserción.** `caja-testigo.e2e-spec.ts:383-387` vincula
al garzón B por `PATCH /api/garzones/:id` **después** de haberle abierto sesión con su PIN vivo
(`:376`), y `:771-775` hace lo mismo con el garzón D. O sea que la rama `vincular` de
`actualizar()` **sí se ejecuta** en e2e, con un PIN real muriendo en el proceso; simplemente
ningún test comprueba después que ese PIN dejó de servir (a ese spec le interesa otra cosa: el
testigo y `puede_operar_salon`). Cerrar el hueco es **agregar una aserción a un escenario ya
montado**, no construir uno nuevo.

Lo que sí es cierto es que ningún test **afirma** sobre esa transición. En particular
`garzon-modo-personal.e2e-spec.ts` → *"un garzón vinculado sigue en el selector del tótem, pero
su PIN viejo ya no abre la puerta"* prueba el **estado** y no la transición: el PIN de Ana ya
nace muerto en el seeder (`seeder.service.ts`, `pinHash: PIN_INUTILIZABLE`), así que con la
invalidación al vincular revertida ese test seguiría pasando. Sigue valiendo por lo que sí
prueba —que `verificarPin` corre de verdad contra el hash muerto—, pero no es la red de este
mutante; la red es el unit.

Detalle funcional completo: [`garzones.md`](../features/garzones.md). Spec de diseño con las
decisiones del owner y las alternativas descartadas:
[`2026-08-14-pin-propio-garzon-design.md`](../superpowers/specs/2026-08-14-pin-propio-garzon-design.md).

---

## Modo personal: el garzón con su propia tablet no teclea el PIN (cerrado — archivado 2026-08-15)

Entrada de la pasada `turnos` + `salones` + `garzones` (2026-08-06), **Fase 2 del plan
`2026-08-08-elegir-garzon-antes-del-pin.md`**. Se entregó y la entrada quedó viva en
`pendientes.md` por descuido: nadie la mudó al cerrarse. Se archiva al reordenar el backlog
el 2026-08-15, tras verificar que sus **dos** piezas existen:

| Lo que la entrada pedía | Dónde está hoy |
|---|---|
| Vínculo opcional `garzones.usuario_id` | `garzones/entities/garzon.entity.ts:55` |
| `usuarios_tenants.es_totem` como marcador **explícito** | `tenants/dto/marcar-totem.dto.ts`, `tenants.service.ts:612` (`marcarTotem`) |
| Resolución del garzón actuante | `garzones.service.ts` → `garzonPersonalDe`, con el override duro de `es_totem` |
| Que la pantalla no pida PIN en modo personal | `useSesionesGarzon.ts:162` manda `pin: ''`; `useSalones.ts:160,375` |

⚠️ **No se archiva por el texto de un plan sino por el código**: la verificación fue grep
sobre `backend/src` y `frontend/app`, no la lectura del plan que la diseñó. La entrega del
PIN propio del garzón (2026-08-15) se construyó **encima** de este vínculo —`garzonPersonalDe`
es lo que decide de quién es el PIN— así que la Fase 2 estaba en producción antes de que
nadie tachara la entrada.

Texto original de la entrada, verbatim:

> **Modo personal: el garzón con su propia tablet no debería teclear el PIN** (backend +
> frontend) — **Fase 2 del plan `2026-08-08-elegir-garzon-antes-del-pin.md`, diseñada y
> diferida el 2026-08-08.** El vínculo opcional `garzones.usuario_id` + `usuarios_tenants.
> es_totem` como marcador **explícito** del modo (no inferido: una cuenta marcada como tótem
> no puede volverse personal aunque alguien la vincule por error). Todo el diseño está en el
> plan, incluidas las cuatro preguntas ya resueltas.
> ⚠️ **DESBLOQUEADA el 2026-08-08.** Estaba frenada porque el alta de usuarios del tenant no
> existía —`POST /tenants/members` recibía un `usuarioId` ya existente y el único camino a
> una cuenta era el registro público—, así que habilitar un garzón personal costaba 4 pasos
> en 3 pantallas. Ahora `POST /tenants/usuarios` lo hace en uno
> (`docs/features/roles-permisos.md`). Lo que queda de esta entrada es el vínculo
> `garzones.usuario_id` + `usuarios_tenants.es_totem` y la resolución del garzón actuante,
> todo diseñado en el plan.

## El importe de una regla deja de ser ambiguo: dos columnas en vez de una (cerrado 2026-08-23)

Entrada mudada verbatim desde `pendientes.md` § 3:

> - [ ] **El `valor` de descuentos y recargos se parte en dos columnas** (backend + BD +
>   frontend, medido 2026-08-21, **decidido por el owner el 2026-08-22**) — el borde de escala
>   valida la plata con un decorador por campo (`@EsMontoCobrado` / `@EsCosto`) que un pipe lee
>   del metadata, y ese campo **no se puede marcar con ninguno de los dos**: es monto fijo **o**
>   porcentaje según el valor del hermano `modo`, y ni el decorador ni el pipe leen campos
>   hermanos.
>   🔴 El punto ciego cae justo en el módulo donde la confusión valor-vs-porcentaje **ya produjo
>   un bug** (un `19` leído como tasa multiplica el impuesto por cien), y deja a
>   `configuracion/descuentos.vue` y `configuracion/recargos.vue` (`form.valor`, `tramo.valor`)
>   como los únicos inputs de plata del inventario que no pueden apoyarse en el rechazo del
>   backend.
>   ✅ **Decisión: opción (2) — `valor_monto` / `valor_porcentaje`, cada una con su marca.** El
>   owner descartó el validador que lee al hermano **aun siendo el más barato**: partir la
>   columna es lo único que hace que el dato deje de ser ambiguo también para **quien lo lee**,
>   no solo para quien lo escribe.
>   **Lo que toca:** esquema, DTOs, motor de precios, seeder y las dos pantallas. La mitad cara
>   de una migración no aplica —no hay datos productivos: se cambia el esquema, se actualiza el
>   seeder y se resetea—.
>   ⚠️ **Trampas para quien la tome:** (a) toca el **motor de cálculo de precios**, así que va
>   sola y con el sistema quieto (`CLAUDE.md` → detenerse ante el motor); (b) el campo `modo` no
>   desaparece solo — la spec tiene que decidir si sobrevive como discriminador o si manda la
>   columna llena, y **las dos formas no pueden convivir sin una invariante que impida llenar
>   las dos**; (c) `tramo.valor` vive dentro de un DTO anidado, y el pipe **no recorre anidados
>   sin `@Type()` en el padre** (limitación conocida, fijada por el test "LIMITACIÓN CONOCIDA").

### Cómo se cerró

`valor` se partió en `valor_monto` (`numeric(18,4)`) y `valor_porcentaje` (`numeric(7,4)`)
en las **cuatro** tablas —`descuentos`, `recargos` y sus dos de tramos—. Los tipos no se
eligieron: se copiaron de `venta_descuentos.valor_aplicado` / `porcentaje_aplicado`, porque
**el rastro congelado de la venta ya guardaba el dato partido**. El catálogo era el que
había quedado atrás.

**`modo` sobrevive**, que era la pregunta abierta de la trampa (b). No es redundante: tiene
**tres** roles y solo uno se podía reemplazar. Es el discriminador, es la clave de orden del
motor (`calculo-precios.engine.ts` → `ordenarReglas()`: los `monto_fijo` van después de los
porcentajes) y es lo que se congela en la venta. La alternativa —que mandara la columna
llena— se rompía justo donde importa: **una regla por tramos tiene las dos columnas en
NULL**, así que su unidad solo se derivaría leyendo sus tramos, y eso convierte la invariante
en una condición entre filas que un CHECK no puede expresar.

La invariante quedó partida en dos mitades **de distinta fuerza**, y conviene no leerlas
juntas: la de la regla y la del tramo son `CHECK` de tabla; que **todos los tramos usen la
columna que dice el `modo` de su regla** es entre tablas y vive en el service, que es donde
vivía antes. No es mejora ni regresión: es lo mismo, movido.

### Lo que se midió y NO era como la entrada decía

- ⛔ **La trampa (c) no aplicaba.** Decía que `tramo.valor` vive en un DTO anidado y que *"el
  pipe no recorre anidados sin `@Type()` en el padre"*. El padre **ya lo tenía**
  (`create-descuento.dto.ts` → `@Type(() => TramoDto)`), así que los tramos se recorren sin
  trabajo extra. Una entrada de backlog es un punto de partida, no un enunciado verificado.
- 🆕 **Apareció un agujero que la entrada no anticipaba, y lo encontró la revisión
  independiente, no el gate.** Al partir `valor` en dos campos que **por fuerza** son
  opcionales —cuál corresponde depende del hermano `modo`— se perdió el guardia que daba el
  `valor` obligatorio del DTO: un tramo sin ningún importe pasaba la validación y moría contra
  el `CHECK` de tabla, o sea **500 de Postgres en vez del 400 que corresponde**. Peor: el test
  del util que se migró mecánicamente (*"un tramo sin valor no es error"*) **declaraba correcto
  ese camino**. Lo tapa ahora `validarTramo`, con test de unidad y un e2e por el camino real.
  📌 **La lección, que vale más que el fix:** partir un campo obligatorio en dos opcionales
  **borra una validación que nadie escribió** — la daba el `required` del campo viejo. Hay que
  reponerla a mano, y un renombre mecánico de los tests la deja invisible.
- 🆕 **Y una segunda cosa que solo vio la revisión, no el gate:** la línea que apaga la columna
  abandonada al cambiar de modo (`...importeResultante(modo, dto, descuento)`) **sobrevivía a
  su propio borrado con el gate entero en verde**. No había un solo test de un cambio de modo
  **exitoso** — todos los PATCH de la suite esperaban un 400—, y sin esa línea la acción más
  común del drawer (pasar de monto fijo a porcentaje) deja las dos columnas llenas y sale un
  500 del CHECK. Lo fija ahora *"cambiar de modo con su importe APAGA la columna abandonada"*,
  en los dos services, verificado con el mutante.
  📌 **La lección:** una invariante nueva atrae tests de lo que debe RECHAZAR, y deja sin
  cubrir el camino feliz que la ejerce. El mutante sobre la línea, no sobre el rechazo.

### Regalo que salió de arriba, sin trabajo extra

Un `PATCH` que solo cambia el `modo` ya no puede reinterpretar lo guardado. Antes un tramo de
`5000` legítimo como monto fijo pasaba a leerse como 500.000% y lo frenaba la regla del
decimal; ahora ese `5000` vive en `valorMonto`, el modo nuevo no puede leerlo y el `PATCH`
**falla diciendo que la unidad no corresponde**. Sigue siendo 400 y sigue haciendo falta leer
los tramos guardados, pero por otro motivo.

### Qué lo fija

- **Mutante (revierte, no rompe):** el motor vuelve a tomar "el valor que haya" sin mirar el
  modo —la conducta de la columna única— y muere *"la columna que no corresponde al modo se
  ignora"* en `calculo-precios.engine.spec.ts`.
- Unidad **2128**, e2e **597/599 (2 skipped)** —los dos enteros, con `reset-db.sh` antes y
  `--verificar` después—, frontend **804**.
  ⚠️ Este recibo decía "e2e 592" y era falso: el número salió de una corrida anterior a los
  tests que el propio cierre agregó. Lo cazó la segunda revisión independiente comparando
  contra una corrida propia. **Un recibo con un número inventado es peor que no tenerlo**: el
  próximo que compare cree que perdió cuatro tests.
- **Smoke en el navegador**, que es lo único que ve el drawer: crear en monto fijo, editar a
  porcentaje —el campo queda **vacío**, no arrastra el 1000—, guardar 0.10 y verlo como
  `10% (porcentaje)`, y crear una regla por tramos en monto fijo. Verificado en la base que la
  columna abandonada queda en `NULL` y que los dos tramos aterrizan en `valor_monto`.
