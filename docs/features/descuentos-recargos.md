# Feature: Descuentos y Recargos — Formularios dinámicos por tipo

**Status**: Implemented
**Owner**: Cesar Matheus
**Last Updated**: 2026-08-23

---

## Overview

### What is it?

Las pantallas de gestión de descuentos y recargos adaptan dinámicamente sus formularios
según el `tipo_regla` seleccionado. Cada uno de los 10 tipos muestra únicamente los campos
relevantes: tabla de tramos, multi-select de métodos de pago, días de vencimiento, fechas
de vigencia, o un valor fijo simple.

### Why does it exist?

Los formularios previos eran estáticos y mostraban todos los campos sin importar el tipo,
generando confusión y datos incompletos. El spec de descuentos/recargos requiere que cada tipo
capture exactamente los datos que necesita para que el motor de precios pueda evaluarlos.

### Scope

- Incluido en esta versión:
  - 10 `tipos_regla` en seeder (PORCENTAJE, MONTO_FIJO, POR_MAYOR, POR_MONTO_VENTA, METODO_PAGO, PRONTO_PAGO, MORA, RECARGO_METODO_PAGO, RECARGO_FIJO, RECARGO_PORCENTAJE)
  - Almacenamiento relacional de tramos y bridges de métodos de pago
  - Formularios dinámicos en frontend (descuentos y recargos)
  - Endpoint `nombre-disponible` para validación en tiempo real
  - 122 tests TDD (unitarios + integración)

- NOT included (future):
  - UI para gestión de la tabla `tipos_regla` (es solo seed por ahora — verificado el
    2026-08-23: `tipos-regla.controller.ts` es solo `GET`)

⚠️ **Esta lista decía dos cosas más que dejaron de ser ciertas, y la corrección importa
más que el dato** (2026-08-23). Decía que la *"evaluación de condiciones en el motor"* y la
*"aplicación de tramos y métodos a ventas"* eran futuro. **Las dos están construidas**: el
motor evalúa tramos por cantidad y por monto y filtra por método de pago
(`calculo-precios.engine.ts` → `evaluarRegla`), y `calculo-precios.service.ts` carga las
reglas de cada ítem y las aplica al vender.

El costo de no haberlo corregido antes está medido: el análisis del motor de promociones
(`docs/superpowers/specs/2026-07-22-motor-promociones-analisis.md`) **citó estas líneas** y
arrancó de la premisa de que los descuentos estaban *"definidos pero NO aplicados al vender"*.
Quien retomara ese frente iba a diseñar contra un sistema que no existe.

**Qué se evalúa hoy, sin adornos** (verificado el 2026-08-23):

| Se aplica bien | Se aplica MAL | No se aplica |
|---|---|---|
| `directo`, `general`, `por_mayor`, `por_monto_venta`, `recargo_por_monto_venta`, `metodo_pago` y `recargo_metodo_pago` (los dos leen sus escalones desde el 2026-08-25) | `interes_simple` e `interes_compuesto` (cobran la tasa una sola vez y sin mirar plazo — y son idénticos entre sí) | `mora`, `pronto_pago` (en `DIFERIDAS`) |

⚠️ **`promocional` se eliminó del catálogo (2026-08-23):** su caso —un descuento con
vigencia obligatoria— se mudó al futuro módulo de promociones. La capacidad de expresar
*"10% del 15 al 20 de septiembre"* no desapareció: `directo` ganó `fechaInicio`/`fechaFin`
opcionales. Detalle: `docs/superpowers/specs/2026-08-23-vigencia-por-fecha-design.md`.

El detalle de cada hueco y qué hace falta para cerrarlo está en
[`pendientes.md`](../agent/pendientes.md), en *"Los tipos de regla por TIEMPO, que siguen
esperando el vencimiento de venta"*.

⚠️ **Esta cita apuntaba a un título renombrado** —*"Cinco tipos de regla no hacen lo que la
pantalla promete"*—, que hoy solo existe en [`resueltos.md`](../agent/resueltos.md) marcado
como **cerrado**. Quien siguiera el puntero concluía que el tema ya salió.

---

## Pausar no es eliminar (2026-08-03)

`activo` es un interruptor de **pausa**, no un borrado. Son dos operaciones distintas y
no hay que confundirlas:

| | Qué significa | Cómo se deshace |
|---|---|---|
| **Pausar** (`activo = false`) | La regla deja de aplicarse pero sigue existiendo, **con todas sus asociaciones intactas** | Reactivar: vuelve exactamente como estaba |
| **Eliminar** (`eliminado_el`) | La regla se va del catálogo | Restaurar desde la papelera |

Reglas de la pausa:

- **No se aplica y avisa.** El motor descarta la regla pausada al resolver la línea y emite
  una `AdvertenciaPrecio` (`titulo: Descuento "X"`, `detalle: está en pausa y no se aplicó`).
  La venta sale igual, con el monto correcto: sigue el precedente del tope de descuento, que
  tampoco frena la venta.
- **Vale igual si la piden a mano.** Da lo mismo que la regla venga heredada del ítem o
  explícita en el request (`descuentosVentaIds`, `descuentoIds` de línea): pausada no aplica.
- **Nunca se tocan las tablas puente.** `item_descuentos` / `item_recargos` / `item_impuestos`
  quedan intactas. Borrar esas filas y no poder devolverlas sería *eliminar* las asociaciones
  con otro nombre.
- **La regla pausada sigue en el mapa del motor**, aunque no se aplique. Sacarla de la carga
  haría que `requerir()` tirara 400 por id ausente en cada ítem asociado, y el POS dejaría de
  vender.
- **El selector no la ofrece**, pero la pantalla de administración sí la sigue mostrando: si
  desapareciera de la lista, el toggle para reactivarla se iría con ella.

En la UI, pausar abre un modal que dice a cuántos ítems afecta (`GET /api/descuentos/:id/uso`)
y promete la reversibilidad. Con cero ítems asociados no hay modal. Reactivar no pregunta.
**Excepción: una regla de nivel venta siempre pregunta**, aunque su conteo sea 0 — no tiene
tabla puente con ítems, así que ese 0 no significa "nadie la usa"; ver la sección siguiente.
El flujo vive en `usePausaRegla()` + `CrudPausarModal.vue`, compartidos por las tres
pantallas (descuentos, recargos, impuestos). Lo que **no** vive ahí es el guard del
catálogo oficial de impuestos (`origen === 'sistema'`): es regla de impuestos, no de
pausar, y se queda en su pantalla.

**El IVA queda fuera de todo esto**: no se pausa, se es afecto o exento. Ver
[impuestos.md](./impuestos.md).

## El nivel de la regla: por línea o por venta (2026-08-25)

Una regla declara **dónde se aplica**, en la columna `nivel` (`'linea' | 'venta'`, default
`'linea'`):

| Nivel | Cómo se usa | Contra qué se mide |
|---|---|---|
| `linea` | se asocia a ítems (`item_descuentos` / `item_recargos`) o viaja en `descuentoIds` de una línea | el subtotal de esa línea |
| `venta` | se elige al cobrar y viaja en `descuentosVentaIds` / `recargosVentaIds` | el acumulado de la venta |

**Por qué hace falta la columna:** hasta el 2026-08-25 la misma fila servía para las dos
cosas, así que *"20% sobre compras de $50.000"* se podía colgar de un ítem y dispararse con
una línea de $50.000 dentro de una venta de $60.000. Es otra plata, y nada lo decía.

⚠️ **La columna NO deriva del tipo de regla, y eso es a propósito pero tiene filo.** Un
`por_monto_venta` a nivel línea mide sus tramos contra la línea, así que el caso del párrafo
anterior sigue siendo **construible a mano**. Es un uso legítimo —*"llevando $50.000 de este
vino, 10% en el vino"*— y por eso no se fuerza; lo que la columna garantiza es que la MISMA
regla no sirva para las dos cosas.

✅ **Pero el default sí lo empuja el tipo, desde el 2026-08-25** (decisión del owner). Elegir un
tipo por escalones de monto deja el radio en *Al total de la venta*; los demás tipos lo dejan en
*A cada ítem*. Cuál sugiere cada uno vive en `nivelSugerido`, en
`frontend/app/utils/reglas-form-config.ts`.

📌 **Empuja un DEFAULT, no impone**, y esa distinción es la mitad de la decisión: el tipo mueve
el radio **solo mientras nadie lo tocó a mano**; en cuanto el usuario elige, cambiar de tipo ya
no lo pisa. Es lo contrario de lo que hace `onTipoChange` con los demás campos —que los limpia
siempre, porque dependen del tipo— y por eso lleva su propio testigo (`nivelTocado`). Sin esa
mitad, el caso del vino dejaría de ser expresable.

**Es binario a propósito** (decisión del owner, 2026-08-15). Un negocio que quiera la misma
promo en los dos lugares crea dos reglas — el seed tiene el par: *"Promo fija $5.000"* (línea)
y *"Promo del total $5.000"* (venta). El tercer estado costaría explicarlo en cada pantalla y
respetarlo en cada puerta, contra duplicar una fila una vez.

**Dos puertas lo hacen cumplir, y hacen falta las dos:**

| Puerta | Rechaza |
|---|---|
| `ItemsService.validarReglas` | asociar a un ítem una regla de nivel venta (`POST`/`PATCH /items`) |
| `CalculoPreciosService.resolverReglas` | una regla de venta en `descuentoIds` de una línea, y una de línea en `descuentosVentaIds` |

La segunda no es redundante: una línea puede mandar sus propios `descuentoIds` y pisar los del
ítem, camino que nunca pasa por el catálogo.

**La validación NO vive en el motor.** El motor recibe las dos listas ya separadas y calcula
plata; el nivel es una regla de catálogo sobre dónde se puede usar cada regla, del mismo orden
que "el ítem está pausado" —que por la misma razón se resuelve en el service—.

**Cambiar el nivel de línea a venta con ítems asociados se rechaza** (400 con el conteo). Las
dos salidas automáticas eran peores: dejar las asociaciones vivas produce justo el estado que
la primera puerta prohíbe, y borrarlas en silencio tira trabajo del catálogo por un cambio
hecho en otra pantalla.

⚠️ **Ese conteo incluye los ítems en la papelera, y tiene que incluirlos**: `ItemsService.remove`
es un soft delete que **no toca las tablas puente**, así que la fila de `item_descuentos` sigue
viva. Contando solo los vivos, el cambio de nivel pasaba y al restaurar el ítem su descuento
resultaba de nivel venta: el ítem quedaba **invendible**.

✅ **Y desde el 2026-08-25 el admin puede ver cuáles son.** `GET /:id/uso` devuelve también los
borrados, **marcados** (`eliminado: true`), y el drawer los nombra en el error al fallar el
cambio de nivel: *"Lo tienen: Café, Torta vieja (en la papelera)"*. Antes se leía *"1 ítem
todavía lo tiene"* sin forma de saber cuál, y la salida era restaurar a ciegas, editar y volver
a borrar.

⚠️ **Ese endpoint tiene DOS consumidores que piden cosas distintas, y no se puede "simplificar"
a una sola lista sin romper uno en silencio:**

| Consumidor | Qué hace con los borrados |
|---|---|
| El modal de pausa (`usePausaRegla`) | los **descarta** — para pausar, un ítem en la papelera es ruido, y contarlo infla el número sobre el que el admin decide |
| El error del cambio de nivel (drawer) | los **necesita** — son justamente los que no puede ver por ningún otro lado |

Por eso la marca viaja **por fila** en vez de decidirse en el service. El `/uso` de **impuestos**
quedó como estaba —sigue filtrando— porque los impuestos no tienen nivel y nadie cuenta sus
borrados.

📌 **Por qué no se usó `?incluirEliminados=true`, que el repo ya tiene** (`QueryIncluirEliminadosDto`,
el mismo que usa el `findAll` de estas dos pantallas): con el parámetro, el default del endpoint
quedaría del lado seguro y cada consumidor pediría lo que necesita. Se eligió igual la marca por
fila porque es la forma que decidió el owner y porque los dos consumidores conviven en la misma
pantalla, así que el filtro del cliente es una línea. **El costo queda dicho para quien agregue
un tercero:** el default de este endpoint devuelve los borrados, y un consumidor nuevo los recibe
salvo que se acuerde de filtrarlos.

⚠️ **Hoy el productor de reglas de venta no existe en el frontend.** `descuentosVentaIds` /
`recargosVentaIds` están declarados en `useCalculoPrecios.ts` y consumidos por el backend, pero
ninguna pantalla los llena todavía. El campo se construyó **antes** que el productor a
propósito: al revés, el productor habría nacido pudiendo mandar cualquier regla.

## Recargo por escalones de monto (2026-08-22)

Hasta esta fecha **ningún tipo de recargo pedía tramos**, pero la plomería estaba: el
service los persistía y el motor los evaluaba. O sea que un recargo por escalones era
alcanzable por API y no existía en ninguna pantalla. El owner decidió **construirlo en vez
de borrarlo**: `recargo_por_monto_venta`, espejo del `por_monto_venta` de descuentos.

- **No lleva `valor` único**: el monto lo dicen los tramos, y pedir las dos cosas sería
  pedir dos veces lo mismo. `TIPOS_CON_TRAMOS` en `recargos.service.ts` lo exige al crear y
  también **al cambiar el tipo por `PATCH`** — sin eso, mover una regla a este tipo la
  dejaba sin ningún escalón y el motor no le cobraba nada.
- **El motor no necesitó cambios**, y eso se midió antes de escribir: `evaluarRegla`
  ramifica por `tramos.length > 0` sin mirar la clase, y un código que no está en
  `DIFERIDAS` ni en `METODO_PAGO_CODIGOS` llega a esa rama con la magnitud del monto.

### El cero: lo admite el tramo, no el valor plano (2026-08-24)

Los tramos son **abiertos hacia arriba** —solo el mínimo, sin `maximo`— y esa parte no
cambió. Lo que cambió es el piso del importe:

| Dónde | Piso | Por qué |
|---|---|---|
| Cada **tramo** | `>= 0` | Es la única forma de expresar el escalón que deja de cobrar |
| El **valor plano** de la regla | `> 0` | Apagar una regla ya se dice pausándola, y pausada **avisa** |

Sin el cero, **"envío gratis sobre $30.000" no era expresable**: el recargo podía *bajar*
por escalones ($2.000 bajo $30.000 → $500 arriba) pero nunca **llegar a cero**, que es la
forma del caso más común. Con los tramos abiertos hacia arriba, el escalón que no cobra
solo se puede escribir poniéndolo en 0.

La asimetría con el valor plano es deliberada (decisión del owner). Una regla plana en 0
queda **prendida**, se aplica en cada venta y no cobra nada, sin decirle nada a nadie —
mientras que la regla pausada hace lo mismo y el POS le avisa al cajero *"está en pausa y
no se aplicó"*. Permitir las dos dejaría dos maneras de apagar una regla, una silenciosa y
a simple vista idéntica a una rota. Quien intente guardar una regla plana en 0 recibe un
400 que le dice que la pause.

⚠️ **Que un tramo pueda valer 0 no lo vuelve indistinguible de un tramo SIN importe.** El
backlog afirmaba que sí y **se midió que no**: los dos campos son `string` —`@IsNumberString`
rechaza un número de JSON, y TypeORM devuelve `numeric` como string— y `'0'` es *truthy*,
así que el chequeo de presencia de `validarTramo` sigue separando los dos casos sin una
línea de más.

**Lo que NO hubo que tocar, y se midió antes de tocarlo:** el motor ya aplicaba un `'0'`
bien (`aplicarValor` corta por `== null`, no por falsy) y la boleta ya omite el recargo en
cero (`ticket-builder.ts` imprime la línea solo con `.gt(0)`, y muestra el agregado, no una
línea por regla). El drawer de auditoría **sí** lo muestra, atenuado (`sinEfecto`), que es
lo correcto: son dos superficies distintas —el documento del cliente y la pantalla de quien
explica un descuadre— y el cero es información en la segunda.

### Método de pago: valor único **o** escalones (2026-08-25)

`metodo_pago` y `recargo_metodo_pago` son los primeros tipos que **admiten las dos formas de
expresar el importe y tienen que elegir una**. El caso de local es "3% con tarjeta, y 1,5%
arriba de $100.000".

Por qué estos y no otros: el método de pago es la **condición** de la regla —con qué se
paga—, no su forma de importe, así que se combina con cualquiera de las dos. Los demás tipos
siguen teniendo una sola forma: `directo` cobra un valor, `por_monto_venta` cobra por
escalones, y ninguno elige nada.

| Dónde | Qué garantiza |
|---|---|
| `evaluarRegla` (motor) | la rama de método de pago **filtra y sigue**: el importe lo resuelven las mismas dos ramas que para el resto, tramos primero |
| `validarFormaDeImporte` (service) | **exactamente una** de las dos: las dos juntas es 400, ninguna también |
| `reglas-form-config.ts` (drawer) | `campoValor` y `campoTramos` los dos en `true` = el drawer hace **elegir** con un radio, no dibuja los dos campos |

⚠️ **Que las dos juntas no sean expresables es lo que sostiene al motor**, no un capricho de
formulario: `evaluarRegla` ramifica por `tramos.length > 0` antes de mirar el valor plano, así
que una fila con las dos llenas cobraría por escalones y dejaría el valor único **muerto sin
aviso** — exactamente el bug que este frente cerró, dado vuelta.

📌 Sus escalones miden **monto** y no cantidad, o sea que el umbral va en `minimoMonto`.
`por_mayor` sigue siendo el único que mide cantidad, y eso lo decide
`CODIGOS_MINIMO_POR_CANTIDAD` en el util.

⚠️ **"Monto" es el de la puerta por la que entra la regla, no siempre el de la venta**, igual
que en `por_monto_venta`: el motor compara contra `ctx.monto`, que en una regla de **nivel
línea** es el neto de esa línea y en una de **nivel venta** es el subtotal de la venta. Un
*"1,5% con tarjeta arriba de $100.000"* pensado sobre el total tiene que ser de **nivel
venta**; colgado de un ítem se dispara con una línea de $100.000 dentro de una venta mayor. Es
exactamente el caso que motivó el campo `nivel` (2026-08-25), y el drawer lo pregunta primero.

📌 **La vuelta del interruptor tiene su propia regla:** `tramos: []` es 400 para los tipos que
exigen escalones, pero estos dos lo aceptan — es la única manera de volver a valor único.
Quien mande ese PATCH tiene que mandar el valor en el mismo body, o el estado resultante no
dice cuánto cobra y sale 400.

### Y los demás **no eligen** — desde el 2026-08-26 eso se enforcea

La frase de arriba —*"los demás tipos siguen teniendo una sola forma"*— era una descripción,
no una regla: hasta el 2026-08-26 **los nueve códigos que no eligen** aceptaban las dos formas
juntas con **201**. Los nueve se ejecutaron uno por uno contra los services, antes y después
del arreglo:

| Tipo | Forma que le toca | Qué aceptaba de más | Qué pasaba al cobrar |
|---|---|---|---|
| `directo`, `general`, `interes_simple`, `interes_compuesto` | valor único | escalones | el motor los **prefiere**: la tasa quedaba muerta **sin aviso** |
| `pronto_pago`, `mora` | valor único | escalones | nada: cortan en `DIFERIDAS` antes de mirar el importe |
| `por_mayor`, `por_monto_venta`, `recargo_por_monto_venta` | escalones | un valor plano | nada: no lo lee nadie |

⚠️ **El número se escribe medido, y el primer intento estuvo mal.** La primera versión de
este párrafo decía *"seis"* —los que se habían sondeado hasta ese momento— arriba de una tabla
que nombraba **siete**. Nueve es la lista completa: `TIPOS_CON_VALOR_UNICO` (6) +
`TIPOS_CON_TRAMOS` (3), sumando los dos services. Los que faltaban en esa tabla eran
`pronto_pago` y `mora`, y no son un detalle de conteo: **aceptaban la escritura igual que el
resto**, aunque no lleguen a cobrarla.

Lo enforcean `validarValorUnico` y `validarSoloEscalones`, hermanos de `validarFormaDeImporte`
y en el mismo archivo. Los tres existen por la misma razón, que es del **motor**: `evaluarRegla`
ramifica por `tramos.length > 0` antes de mirar el valor plano, así que una fila con las dos
llenas cobra una forma y deja la otra muerta sin avisar. El orden del motor no es la garantía;
la escritura sí.

⚠️ **Las tres filas no pesan igual, y conviene no venderlas juntas.** Solo la primera —cuatro
de los nueve— cobraba distinto: el usuario cree estar cobrando la tasa que escribió y se le
cobra el escalón. En las otras dos lo que entraba era un número decorativo que nadie leía
(cuando ningún escalón alcanza, el motor devuelve `SIN_VALOR`; no cae al valor plano). Lo que
se compra en las tres es lo mismo: que la fila no pueda decir dos cosas.

✅ **Decisión del owner (2026-08-25): CERRAR, no abrir** — y es lo contrario de lo que decidió
**el mismo día** para método de pago, así que el precedente no la resolvía. Ganó cerrar porque
**en ninguno de los nueve la forma sobrante es alcanzable desde la pantalla**: hoy nadie cobra
mal, y lo único que existía era un agujero de escritura. Son **dos banderas distintas** según
el grupo, y conviene no colapsarlas —`campoTramos: false` en los seis de valor único, y
`campoValor: false` en los tres por escalones, donde los escalones son justamente lo único que
sí se ve—. Abrirlos habría sido
una feature nueva —una pantalla por tipo, y decidir qué mide un escalón en un interés
compuesto— sin ningún caso de local que la pida. Si ese caso aparece, el interruptor es el
mismo que el de método de pago y está a una línea.

### La salida: cambiar de tipo borra la forma vieja, y avisa antes

Cerrar el estado prohibido dejó al descubierto que **no había forma de salir de él**, y no
por la puerta rara: por la de todos los días.

**La escena.** Tenés *"Por mayor"*: 5% llevando 10 o más. Decidís que ya no va por escalones
y lo cambiás a **Directo, 25%**. Hasta el 2026-08-26 eso guardaba con 200, la grilla decía
*25%* y el motor cobraba **5%** — los escalones viejos seguían vivos porque `update` solo
reemplaza los hijos que vienen en el body, y `evaluarRegla` los mira antes que el valor plano.
Es el mismo bug de esta sección entrando por otra puerta, y se llegaba **desde la pantalla**.

**Y va en las dos direcciones**, que es lo que la primera versión de este arreglo pasó por
alto: al revés —de un tipo de valor único a uno por escalones— el huérfano es el **valor
plano**, que `importeResultante` lee de la fila cuando el body no manda la columna. Ninguno de
los dos campos está en pantalla en el tipo de destino, así que el usuario no puede limpiarlos a
mano.

Con el guardia puesto eso pasó a ser 400, que es honesto pero dejaba al usuario trabado: la
única salida —mandar `tramos: []`— chocaba contra otro 400, *"Este tipo requiere al menos un
tramo"*, sobre un tipo que no admite ninguno. Ese segundo era un bug viejo e independiente:
la condición preguntaba por `!TIPOS_CON_TRAMOS_OPCIONALES` cuando tenía que preguntar por
`TIPOS_CON_TRAMOS`, o sea *"¿este tipo EXIGE escalones?"*.

| Dónde | Qué hace ahora |
|---|---|
| `validarSegunTipoUpdate` (service) | `tramos: []` lo rechaza **solo** el tipo que exige escalones. Para los demás es el vaciado explícito |
| el drawer, hacia escalones → valor único | manda `tramos: []`, **después de preguntar** |
| el drawer, hacia valor único → escalones | manda la columna del importe en `null`, **después de preguntar** |

✅ **El aviso lo eligió el owner (2026-08-26)** sobre la alternativa de borrar callado. La
razón que lo decidió: al elegir el tipo nuevo el campo donde eso se veía **ya desapareció del
formulario**, así que borrarlo sin decir nada es borrar algo que dejó de estar a la vista en el
mismo gesto. El modal nombra qué se pierde —*"2 escalones"* o *"un valor único cargado"*—
porque las dos direcciones pasan por él.

### Los cuatro caminos avisan, no uno

✅ **Decisión del owner, 2026-08-29.** Hasta esa fecha avisaba solo el cambio de tipo: la
misma pérdida preguntaba por un camino y no por los otros, y una pantalla que a veces
pregunta y a veces no enseña a no leer el modal.

| Camino | Gesto | Qué dice el aviso |
|---|---|---|
| cambiar el tipo | el tipo nuevo no usa esa forma, en las dos direcciones | *"El tipo que elegiste no lo usa, así que al guardar se borra"* |
| mover el radio de forma | en los tipos que **eligen** —método de pago—, en las dos direcciones | *"La forma de importe que quedó elegida no lo usa…"* |
| cambiar entre dos tipos que los dos usan escalones | el formulario se vacía, pero la sección queda a la vista | *"…y el formulario quedó sin ninguno. Cargalos de nuevo"* |
| cambiar a un tipo que **elige** forma | nadie mueve el radio: `onTipoChange` lo deja en "un valor único" y la sección desaparece | *"La forma de importe que quedó elegida no lo usa…"* |

Es **un** modal, no cuatro: lo que cambia es quién dejó de usar el importe, el tipo o la
forma. Y el conteo que nombra —*"2 escalones"*— sale de la fila, no de una constante.

📌 **Dice "la forma que quedó elegida" y no "que elegiste" a propósito:** en el cuarto camino
el usuario no eligió nada.

El tercero es el único que **no promete un borrado**, porque no lo hay: ahí el tipo nuevo sí
usa escalones, el backend rechaza el guardado vacío con *"Este tipo requiere al menos un
tramo"* y la fila queda como estaba. Por eso su botón dice *"Guardar igual"* y no *"Guardar y
borrar"*. Ese 400 **no se tocó**: lo único que cambió es que el usuario se entera antes de
llegar a él.

⚠️ **La condición pregunta por la PANTALLA, no por el tipo, y esa es la parte que hay que
conservar.** Los escalones se pierden cuando la sección no está a la vista —venga eso del tipo
nuevo, del radio, o de un cambio de tipo que movió el radio solo—, más el caso de la sección
visible que quedó sin ninguno. Esta enumeración salió corta **tres veces seguidas**: nació con
dos caminos, una revisión levantó el tercero, y el cuarto apareció al implementar los otros.
Preguntar por la pantalla es lo que hace que un gesto nuevo quede cubierto sin que nadie lo
tenga que ver venir.

### Lo que sigue sin salir

`mora` **no** es candidato a tramos, y no por falta de configuración: está en `DIFERIDAS`, así
que `evaluarRegla` corta antes de mirar nada y con tramos **cobraría cero**. Su problema no es
de escalones sino de **tiempo** — vive en `docs/agent/pendientes.md`, en *"Los tipos de regla
por TIEMPO, que siguen esperando el vencimiento de venta"*.

⚠️ Este párrafo nombraba también a `recargo_metodo_pago`, y llegó a decir que los dos
*"cobran cero en silencio"*. Lo primero se resolvió el 2026-08-25 (sección de arriba); lo
segundo nunca fue cierto del recargo, que cobraba el valor plano. Fue la tercera copia del
mismo dato viejo que sobrevivió a su corrección en `pendientes.md`.

---

## API Endpoints

### Descuentos

```
GET /api/descuentos
Authorization: Bearer <token>
Response (200): Descuento[] — incluye tramos[] y metodosPago[]

POST /api/descuentos
Authorization: Bearer <token>
Body: CreateDescuentoDto
Response (201): Descuento

PATCH /api/descuentos/:id
Authorization: Bearer <token>
Body: UpdateDescuentoDto
Response (200): Descuento

DELETE /api/descuentos/:id
Authorization: Bearer <token>
Response (200): { message: 'Descuento eliminado' }

GET /api/descuentos/nombre-disponible?nombre=<str>&excludeId=<uuid>
Authorization: Bearer <token>
Response (200): { disponible: boolean }
```

### Recargos

Mismos endpoints bajo `/api/recargos`.

---

## Backend

### Modules & Services

- **Módulo descuentos**: `src/modules/descuentos/`
- **Módulo recargos**: `src/modules/recargos/`
- **Módulo tipos-regla**: `src/modules/tipos-regla/`

### Entities & Database

**Tablas principales (preexistentes, extendidas):**

| Tabla | Cambio |
|-------|--------|
| `descuentos` | el importe vive en `valor_monto` / `valor_porcentaje`, las dos nullable; `nivel` (`nivel_regla`, default `'linea'`) dice si se aplica por línea o por venta |
| `recargos` | ídem |

#### El importe se expresa en dos columnas (2026-08-23)

`valor` se partió en **`valor_monto`** (`numeric(18,4)`, plata) y **`valor_porcentaje`**
(`numeric(7,4)`, decimal: `0.10` = 10%). El `(7,4)` no es cosmético: dice por sí solo que
ahí no entra plata.

**Por qué**, y no es preferencia de estilo: el borde de escala valida la plata con un
decorador **por campo** (`@EsMontoCobrado`) que un pipe lee del metadata, y un campo que es
monto **o** porcentaje según el hermano `modo` no se puede marcar — ni el decorador ni el
pipe leen campos hermanos. Con el campo partido, `valor_monto` sí se marca, y el borde
rechaza con 400 la plata que no cabe en la moneda del tenant.

`modo` **sobrevive** y no es redundante: es la clave de orden del motor (los `monto_fijo` se
aplican después de los porcentajes) y es lo que se congela en la venta.

**La invariante, y dónde vive cada mitad** —se dice separada porque no tienen la misma
fuerza—:

| Regla | Quién la garantiza |
|---|---|
| En la regla: la columna llena es la que dice `modo`, la otra NULL (las dos NULL = usa tramos) | `CHECK` de tabla |
| En el tramo: exactamente una de las dos | `CHECK` de tabla |
| Que todos los tramos usen la columna que dice el `modo` de **su regla** | el service (`validarMontosDeRegla`) — es entre tablas y un CHECK no lo puede expresar |

**Consecuencia buscada:** cambiar solo el `modo` por `PATCH` ya no reinterpreta lo guardado
—un tramo de `5000` legítimo como monto fijo no puede pasar a leerse como 500.000%—, porque
el importe vive en una columna que el modo nuevo deja fuera de juego. Ese `PATCH` **falla con
400** en vez de reinterpretar.

**Nuevas tablas:**

| Tabla | Descripción |
|-------|-------------|
| `descuento_tramos` | Tramos de descuento (`minimo_cantidad` \| `minimo_monto`, `valor_monto` \| `valor_porcentaje`, `orden`). PK UUID, FK descuento_id. Dos CHECK: exactamente un mínimo y exactamente un importe |
| `recargo_tramos` | Tramos de recargo. Misma estructura |
| `descuento_metodo_pago` | Bridge descuento ↔ metodo_pago. PK compuesta |
| `recargo_metodo_pago` | Bridge recargo ↔ metodo_pago. PK compuesta |

Todas con soft delete (`eliminado_el`) y timestamps.

⚠️ **Las dos puentes se REVIVEN, no se reinsertan.** Un `PATCH { metodoPagoIds }`
reemplaza la lista entera, pero como la PK es el par `(regla, método)`, un método que
ya estuvo asociado no tiene fila nueva que insertar: tiene una apagada que hay que
volver a prender (`ON CONFLICT … DO UPDATE SET eliminado_el = NULL`). Hasta el
2026-09-01 se hacía con `manager.save()`, que resolvía esas filas como `UPDATE` sin
limpiar `eliminado_el` y las dejaba muertas: agregarle un método a una regla le sacaba
el que ya tenía, y achicar la lista la dejaba **sin ninguno** —o sea, sin aplicarse—
con 200 en la respuesta. El mecanismo y el molde correcto están en
`docs/patterns/backend.md` §14b.

### DTOs (extendidos)

- `CreateDescuentoDto` / `UpdateDescuentoDto`: nuevos campos `metodoPagoIds?: string[]`
  (con `@ArrayUnique()`: un id repetido es 400 en los dos verbos, porque la puente se
  guarda con `ON CONFLICT DO UPDATE` y Postgres no deja tocar la misma fila dos veces),
  `tramos?: TramoDto[]`, `diasVencimiento?: number`, `fechaInicio?: string`, `fechaFin?: string`
- `TramoDto`: `{ minimoCantidad?, minimoMonto?, valorMonto?, valorPorcentaje? }` (strings
  para `@IsNumberString`). Los cuatro son opcionales **en el DTO** porque cuál corresponde
  depende de un hermano que un decorador no puede leer; que llegue exactamente uno de cada
  par lo exige el service.
  ⚠️ Esa opcionalidad se llevó puesto el guardia que daba el `valor` obligatorio: sin la
  validación propia del service, un tramo sin importe llegaba al CHECK de tabla y salía un
  **500** en vez de un 400.
  **No hay `maximo`** —este documento lo afirmaba y nunca existió, ni en las entidades ni en
  el esquema (verificado 2026-08-22)—: los tramos son **abiertos hacia arriba** y gana el de
  mínimo más alto que la magnitud alcance.

### El mínimo de un tramo: dos columnas, dos ejes (2026-08-24)

`minimo` era **una** columna que significaba dos cosas: en un `por_mayor` son unidades, en un
`por_monto_venta` es plata. Quién decidía cuál era un `if` con el string del tipo adentro del
motor, y la consecuencia práctica es que **ninguna de las dos unidades se podía validar en el
borde**: marcarla como plata habría rechazado un "2,5 kg" legítimo de un local que vende al
peso.

Partido en `minimo_cantidad` / `minimo_monto`:

- **El tramo dice qué mide.** El motor elige la magnitud por la columna que está llena, no
  por el código de la regla — ese `if` con el string ya no existe.
- **El umbral en plata pasa por el borde de escala** (`@EsMontoCobrado()`): en un tenant CLP,
  `20.000,50` es 400. El de cantidad conserva sus decimales.
- **Son dos ejes independientes:** el importe lo decide `modo` (monto fijo vs porcentaje) y
  el mínimo lo decide el `codigo` del tipo. Un `por_mayor` puede descontar un porcentaje.

⚠️ **Quien agregue un tipo con tramos tiene que decidir cuál mide**, y el único lugar donde
se declara es `CODIGOS_MINIMO_POR_CANTIDAD` en `monto-regla.util.ts`. Se usa **solo al
escribir**: al leer, el dato ya lo dice.

📌 **Un caso que la validación tiene que dejar pasar, y por qué:** un `PATCH` que cambia el
tipo a uno **sin tramos** deja huérfanos los guardados. Se pasa `codigo: null` para eso, y ahí
se valida **toda la forma y solo la forma**: un solo mínimo por tramo, no negativo, y **todos
los tramos de la regla midiendo lo mismo**. Lo único que NO se exige es la correspondencia con
el tipo, que no significa nada cuando el tipo no mide.

⚠️ **La tercera de esas tres no es decorativa** y se agregó el 2026-08-24 al levantarla la
revisión independiente: sin ella, un `POST` a un tipo sin tramos podía mandar uno en cantidad y
otro en monto —medido, entraba con 201— y el motor comparaba *"500 unidades"* contra *"$100"*
para decidir cuál tramo gana. Es regla de **forma**, no de negocio: no dice cuál columna, dice
que no se mezclen.

### Key Methods

- `service.create(dto, tenantId)` — crea descuento/recargo + hijos (tramos, bridges) en transacción
- `service.update(id, dto, tenantId)` — reemplaza hijos completos (delete all → insert new)
- `service.findAll(tenantId)` — trae entidades con relaciones `tramos` y `metodosPago`
- `service.nombreDisponible(nombre, tenantId, excludeId?)` — check unicidad de nombre

---

## Frontend

### Pages

- `app/pages/configuracion/descuentos.vue` — lista + formulario dinámico inline
- `app/pages/configuracion/recargos.vue` — igual estructura

### Utilities

- `app/utils/reglas-form-config.ts` — configuración declarativa por tipo de regla:
  qué campos mostrar, labels, validaciones. Consultar este archivo para agregar nuevos tipos.

### Data Flow

```
[Usuario abre modal crear/editar]
  ↓
[Selecciona tipo_regla]
  ↓
[reglas-form-config.ts devuelve { campos: [...] } para ese tipo]
  ↓
[Template renderiza campos condicionalmente con v-if]
  ↓
[guardar() arma payload con { tipoReglaId, valorMonto? | valorPorcentaje?, tramos?, metodoPagoIds?, diasVencimiento? }]
  ↓
[POST/PATCH /api/descuentos|recargos]
  ↓
[Backend valida, persiste transaccionalmente, devuelve entidad enriquecida]
  ↓
[cargar() re-fetch → lista actualizada]
```

---

## Testing

### Unit Tests (Backend)

```bash
cd backend
npm test -- --testPathPattern=descuentos
npm test -- --testPathPattern=recargos
```

122 tests passing (service + controller, descuentos + recargos).

### Manual Testing

1. `docker-compose up`
2. Login como admin → `/configuracion/descuentos`
3. Crear descuento con tipo POR_MAYOR → debe mostrar tabla de tramos
4. Crear descuento con tipo METODO_PAGO → debe mostrar multi-select de métodos
5. Editar → los campos pre-cargan correctamente
6. Verificar en Swagger: `GET /api/descuentos` retorna `tramos` y `metodosPago`

---

## Acceptance Criteria

- [x] 10 tipos_regla en seeder
- [x] 4 nuevas tablas relacionales
- [x] valor nullable en descuentos y recargos
- [x] DTOs extendidos con validación class-validator
- [x] Servicio transaccional (create/update con reemplazo de hijos)
- [x] Endpoint nombre-disponible
- [x] 122 tests TDD passing
- [x] Formularios dinámicos en frontend
- [x] reglas-form-config.ts como fuente de verdad de la lógica de campos

---

## Related

- [ADR-006: Modelado relacional de tramos y métodos de pago](../adr/006-relational-tramos-and-metodos-pago.md)
- [Preferencias financieras](./preferencias-financieras.md) — fórmula de precios que consume estas reglas
