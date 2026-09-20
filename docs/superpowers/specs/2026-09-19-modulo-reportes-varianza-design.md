# El módulo de reportes, estrenado con la varianza (AVT)

**Fecha:** 2026-09-19 · **Tipo:** spec de diseño
**Frente:** *"Reporte de varianza (AVT) — después de compras"*, en
[`docs/agent/pendientes.md`](../../agent/pendientes.md) § 3, más la arquitectura del módulo que lo
aloja. El owner lo pidió el 2026-09-19, al cerrar la pieza 1 de compras.
**Decisiones del owner:** todas del 2026-09-19, en § 2.

---

## 1. El problema que cierra

Son dos, y el orden importa: primero no hay dónde poner un reporte, y recién después falta el
reporte.

**No hay módulo de reportes.** Hay **quince endpoints** que agregan o listan para analizar,
repartidos en **nueve módulos**, cada uno con el criterio de quien lo escribió. La spec de
anulaciones ya lo decía con todas las letras el 2026-09-18: *"la app no tiene reportes"*. El mapa
completo, medido el 2026-09-19:

| Endpoint | Módulo | Permiso | Cómo resuelve "el día" | Pagina |
|---|---|---|---|---|
| `GET /resumen-negocio/hoy` | `resumen-negocio` | `Resumen del negocio:Leer` | `diaNegocioDeSql('NOW()')`, sin params | no |
| `GET /propinas/reportes/resumen` · `/trabajadores` | `propinas` | `Propinas:Leer` | `desde`/`hasta` obligatorios, borde superior **exclusivo compensado por el llamador**, tope 366 d | no |
| `GET /caja/tendencia` | `caja` | `Cajas:Leer` | `bordeFechaSql`/`bordeHastaSql` | no |
| `GET /caja/resumen-descuadres-dia` | `caja` | `Cajas:Leer` | hoy, sin params | no |
| `GET /caja/intentos-rechazados` · `/pendientes-revision` | `caja` | `Cajas:Leer` | — | no |
| `GET /salones/anulaciones` · `/anulaciones/resumen` | `salones` | `Salones:Ver todas` | opcional en el listado, **obligatorio + tope** en el resumen | sí / no |
| `GET /ventas/resumen` | `ventas` | `Ventas:Leer` + alcance derivado de caja | sin params | no |
| `GET /pagos` · `/pagos/resumen` | `pagos` | `Pagos:Leer` | **sin filtro de fecha** | sí |
| `GET /mermas` | `mermas` | `Inventario:Leer` | `bordeFechaSql`/`bordeHastaSql` | sí |
| `GET /inventario/movimientos` | `inventario` | `Inventario:Leer` | **sin filtro de fecha** | sí |
| `GET /desfases` | `items` | `Items:Leer` | — | no |

**Y falta la varianza.** *"Según tus recetas debías usar 40 kilos y usaste 47."* El insumo está
completo desde que cerró compras pieza 1 (2026-09-19): el recuento da los bordes (2026-07-26) y
`motivo='compra'` da las entradas.

## 2. Las decisiones que la sostienen

Todas del owner, 2026-09-19.

| Decisión | Por qué importa |
|---|---|
| **El módulo nace solo con los reportes nuevos. No se muda nada ahora.** | Mudar cuesta rutas, pantallas y riesgo sobre código que hoy funciona, y el patrón se puede fijar igual copiando el de anulaciones. El criterio se aplica **hacia adelante** |
| **La línea es quién lo mira y para qué.** *"El módulo reporte es más de negocio que de operación"* (palabras del owner). **Operación:** lo mira quien está haciendo la tarea ahora, para actuar; listado filtrable, vive en su módulo. **Negocio:** lo mira el dueño o el encargado para entender cómo va el local y decidir; mira hacia atrás, agrega y compara períodos | Es el criterio que decide dónde nace cada reporte futuro, sin volver a discutirlo. La clasificación de los que ya existen está en § 3.3 |
| **Cada reporte es su propio `modulo_app` con permiso `Leer`**, agrupados bajo "Reportes" en el menú | El guard solo sabe hacer **O**, nunca **Y** (`requires-permiso.decorator.ts`), así que cada ruta elige un par. Un solo `Reportes:Leer` haría que el reporte de márgenes que se agregue en seis meses le aparezca solo al encargado de bodega que hoy ve la varianza. Es el precedente exacto de `Resumen del negocio`, sacado de Ventas el 2026-09-18 por este mismo motivo |
| **Período: el usuario elige un rango como en todo el resto, pero cada fila se mide entre el PRIMER y el ÚLTIMO recuento aplicado dentro de ese rango**, y declara cuál ventana usó. Sin dos recuentos, la fila dice "falta contarlo" en vez de un número | La varianza vive entre conteos, no entre fechas. Con bordes de libro —lo que el sistema *creía*— la diferencia del período anterior se suma adentro de la de este sin avisar, y el reporte imprimiría 7 kilos con la misma cara con la que imprimiría 70. Es además lo que hacen Toast y xtraCHEF |
| **Cuatro números por fila: Teórico · Merma · Cortesía · Sin explicación**, y el reporte ordena y pinta fuerte el último | Es el único sobre el que se puede actuar mañana. Sin separar, cada salto manda a investigar el saco mojado que el propio dueño cargó. Separar cortesía de merma es lo que el repo ya decidió el 2026-09-18 para Anulaciones: cocina tirando comida y salón regalando platos son dos problemas de dueños distintos |
| **Una fila por (producto, ubicación)**, el reporte abre filtrado en el local | Dice **dónde** se pierde, que es la mitad de la respuesta. Y cada lugar se mide con su propio conteo: contar la cocina no obliga a contar la bodega el mismo día. Sumar todo exigiría haber contado en los dos lados dentro del rango, y una sola falta convertiría la fila entera en "falta contarlo" |
| **Aviso arriba cuando el teórico está incompleto**, con la lista de platos sin receta y de ingredientes sin ficha de stock | El número falso no se lee nunca sin el contexto que lo desarma, y el aviso lleva a la acción que lo arregla. Mismo criterio con el que el dashboard trata lo "sin valorizar" |
| **Cantidad y plata en cada fila, ordenado por plata** | La cantidad dice qué revisar en la cocina (*"¿por qué se van cuatro kilos de harina?"*); la plata dice por dónde empezar (medio kilo de lomo cuesta el triple). Con 80 productos, sin orden por plata el que más cuesta queda en la fila 40 |
| **Los reportes llevan gráfica, con Unovis** (`@unovis/vue` + `@unovis/ts`) — textual: *"vamos con unovis"*. Es la **única** dependencia nueva aprobada | La gráfica **acompaña** a la tabla, no la reemplaza: la tabla es lo que se lee con precisión y lo que algún día se exporta; la gráfica muestra de un vistazo dónde está el desvío |
| **La gráfica de varianza son barras apiladas de la varianza**, no teórico-contra-real | Medible: la varianza *es* la diferencia chica entre dos números grandes, y 51 contra 58 en dos barras se ven iguales. Apiladas muestran tamaño y composición a la vez (§ 8.2) |
| **Va la columna "Otros"** | Un número que normalmente es cero y grita cuando no lo es. Sin ella, la identidad de § 5.4 solo se verifica en el test, y en producción una diferencia no tendría dónde aparecer |
| **`Varianza:Leer` va al rol `Inventario · Aprobación`, no al de conteo** *(owner, 2026-09-20 — textual: "deja el permiso en aprobación")* | El reporte mide si lo contado cierra contra lo que dicen las recetas: **revisa el trabajo de quien cuenta**. Dárselo al contador lo dejaría revisándose a sí mismo, que es la misma asimetría que el recuento ya sostiene al separar contar de aplicar (`docs/features/recuento-inventario.md`) |
| **El reporte lista solo lo contado, y arriba muestra el faltante: *"N productos activos sin conteo en este período"*** *(owner, 2026-09-20)* | Ver § 5.7. El universo son los ítems **activos**, no el catálogo: si un producto ya no se vende **se archiva**, no se esconde con una regla del reporte |

## 3. El módulo de reportes

### 3.1 Qué es un reporte, y qué no

Un reporte es **de negocio**: mira hacia atrás sobre un rango, **agrega** (no lista hechos sueltos)
y existe para decidir, no para operar. Un listado filtrable que alguien usa mientras hace la
tarea —buscar una boleta, ver qué se movió, aprobar un cierre— **no es un reporte** y se queda en
su módulo, aunque tenga filtro de fecha.

⚠️ **El dashboard de inicio no es un reporte:** es la portada con la foto de hoy. Lo que sí
corresponde es que sus tarjetas enlacen al reporte que profundiza cada número, cuando exista.

### 3.2 Dónde vive un reporte nuevo

```
backend/src/modules/reportes/
  reportes.module.ts              registra el controller y el service de cada reporte
  varianza/
    varianza.controller.ts
    varianza.service.ts
    dto/query-varianza.dto.ts
```

⚠️ **No hay un DTO base compartido de rango, y la primera versión de esta spec decía que sí**
(corregido el 2026-09-19, al implementarlo). Con un solo reporte no tendría consumidores:
`QueryVarianzaDto` no puede extenderlo —el `extends` ya lo ocupa `PaginationQueryDto`— y el
`/resumen` no existe todavía. Un `extends` que nadie usa es código muerto, que el checklist de
cierre prohíbe. `desde`/`hasta` suben a `reportes/dto/` cuando exista el **segundo** consumidor;
hasta entonces cada reporte los declara, con las reglas de la tabla de abajo.

| Aspecto | La regla que el próximo reporte copia | De dónde sale |
|---|---|---|
| Rutas | `GET /reportes/<slug>` (listado paginado) y `GET /reportes/<slug>/resumen` (agregados, sin paginar). Rutas **estáticas antes** de cualquier ruta con param | `docs/patterns/backend.md` § 10 |
| Permiso | un `modulo_app` propio (`nombre`, `url: '/reportes/<slug>'`, `tieneConfiguracion: false`), permiso `Leer`, **y su fila en `tenant_modulos`** | `Resumen del negocio` |
| El día | `diaNegocioTenant` → `requiereDiaNegocio` → `empujarDiaNegocio` → `bordeFechaSql` / **`bordeHastaSql`** | `docs/patterns/backend.md` § 10b |
| Rango | **opcional** en el listado (pagina, así que un rango abierto no trae todo a memoria); **obligatorio con tope de 366 días** en el resumen, que corre sin `LIMIT` | `FindAnulacionesDto` vs `ResumenAnulacionesDto` |
| Paginación | `PaginationQueryDto` → `resolvePagination` → `COUNT(*)` → `SELECT … LIMIT/OFFSET` → `buildPaginationMeta` → `PaginatedResponse<T>` | `docs/patterns/backend.md` § 10 |
| Plata | `cantidad × costo_unitario` agrupado por `items.moneda_id`, **nunca convertida entre monedas**, con una bandera cuando falta el costo | `anulaciones-reporte.service.ts` |
| Consultas | agregadas, nunca una por fila | `docs/agent/anti-patterns.md` |

⛔ **Un `modulo_app` sin su fila en `tenant_modulos` da 403 hasta al admin del tenant**
(`rbac.service.ts`, `userHasPermiso`): el borde es comercial y también aplica al rol fijo. Es el
paso que más fácil se olvida al agregar un reporte, y el síntoma —*"no me deja entrar a mí, que soy
el dueño"*— no apunta al seed.

**Las dos convenciones que el módulo elige, y por qué.** Las dos conviven hoy en el repo y el
módulo nuevo toma una de cada par, **sin arreglar de arrastre las pantallas viejas**:

1. **Borde superior: `bordeHastaSql`, inclusivo del día.** Es el que tiene una invariante que
   barre `src/modules` y lo hace cumplir (`common/invariants/dia-negocio.invariant.spec.ts`). La
   otra convención —exclusivo compensado por el llamador, en propinas— funciona, pero exige que
   backend y pantalla se muevan juntos: `docs/patterns/backend.md` § 10b explica por qué no se
   unificaron.
2. **Gate de pantalla: `middleware: ['auth','permiso']` declarativo.** El chequeo manual en
   `onMounted` de propinas es justo lo que ese middleware vino a reemplazar, según su propio
   docblock (`frontend/app/middleware/permiso.ts`): el manual parpadeaba antes de rebotar.

### 3.3 Clasificación de los que ya existen

Ninguno se muda ahora. La lista es para que el criterio no se vuelva a discutir, y la entrada de
candidatos vive en [`docs/agent/pendientes.md`](../../agent/pendientes.md).

- **Operación — se quedan donde están:** `GET /pagos` y `/pagos/resumen`,
  `/inventario/movimientos`, `/mermas`, `/caja/intentos-rechazados`, `/caja/pendientes-revision`,
  `/salones/anulaciones` (el listado) y `/desfases`.
- **Negocio — candidatos a mudarse más adelante:** `/propinas/reportes/resumen` y
  `/trabajadores`, `/caja/tendencia`, `/salones/anulaciones/resumen` y `/ventas/resumen`. Se mudan
  **de a uno y con una razón concreta** —que alguien pida compararlos, exportarlos o verlos juntos
  en el menú—, nunca en una tanda.
- **Ni una cosa ni la otra — la portada:** `GET /resumen-negocio/hoy` y
  `GET /caja/resumen-descuadres-dia`. Los dos alimentan tarjetas del dashboard de inicio y
  contestan *"¿cómo va hoy?"*, no *"¿cómo viene el mes?"*. No se mudan; lo que sí corresponde es
  que enlacen al reporte que profundiza su número, cuando exista.

⚠️ Los tres grupos cubren los quince de § 1: ocho de operación, cinco de negocio y dos de
portada.

## 4. Lo compartido, y dónde vive

📌 **Va en un lugar común desde el primer día, no adentro de `reportes/`** (decisión del owner):
una pantalla vieja tiene que poder usarlo sin mudarse de módulo. El lugar de-facto de los
compartidos del frontend es la **raíz de `app/components/`**, con prefijo `App*` —ahí ya viven
`AppDateInput`, `AppCard`, `AppDrawer`, `DiaNegocioNota`—, así que no hace falta inventar una
convención.

| Componente | Contrato | Qué cierra |
|---|---|---|
| `app/components/AppRangoFechas.vue` | `v-model:desde` / `v-model:hasta`, los dos `YYYY-MM-DD \| null`; prop `qa`; incluye `DiaNegocioNota` | Hoy **cada pantalla arma dos `AppDateInput` sueltos** y `CajaTendencia.vue` **duplica `hoyLocal()`** en vez de importarlo de `useVigenciaRegla`. `DiaNegocioNota` ya se cuelga debajo del selector en cuatro pantallas, siempre a mano |
| `app/components/AppGrafica.vue` | `series`, `categorias`, `formato` (función de presentación), `cargando`, `vacio`; envuelve Unovis | No existe ninguna gráfica en la app |

**Reglas de `AppGrafica.vue`**, que son el patrón que el próximo reporte copia:

- **Colores y tipografía de los tokens semánticos de Nuxt UI**, nunca Tailwind hardcodeado
  (`design:check` lo bloquea). Unovis dibuja **SVG**, así que los colores se resuelven con
  **variables CSS**, no con literales en JS — y así el modo oscuro sale solo.
- **El formato de dinero y de cantidades lo pone el llamador**, con los composables que ya
  existen (`useFormatters.formatMonto`, `formatStock(cantidad, unidad)`), no la gráfica.
- **Estado de carga y estado vacío propios**, como los tres que ya distingue `CajaTendencia.vue`
  (fallo de red / cargando / vacío real).
- **`ssr: false`** (ADR-017) y **la pantalla tiene que andar si la gráfica no monta**: el número
  vive en la tabla.
- **Los datos salen del mismo endpoint del reporte**, nunca de una ruta aparte.

**La exportación no existe todavía** (§ 9) y por eso no tiene componente. Cuando exista, va acá
mismo y no adentro de `reportes/`, por la misma razón.

## 5. La varianza: el modelo

### 5.1 El teórico no se recalcula — ya está escrito

**Vender una receta descuenta sus ingredientes del kardex** (`ventas.service.ts` →
`ItemsService.venderIngredientesReceta`), con la receta **vigente en el momento de vender** y con
la personalización de esa línea ya aplicada. O sea: el consumo teórico **es** el conjunto de
salidas `motivo='venta'`.

⚠️ **Recalcularlo desde `receta_ingredientes` mentiría cada vez que alguien edita una receta.** El
repo ya depende de esto en otro lado: reponer stock al cancelar una venta **lee el kardex** y no
las recetas, y el comentario que lo explica (`ventas.service.ts`, `cancelarUnaVez`) dice
exactamente por qué —una receta editada después de la venta no cambia lo que hay que devolver—.

### 5.2 La ventana de cada fila

Por cada (producto, ubicación) con **dos o más** recuentos `aplicado` dentro del rango pedido:

```
A = el PRIMER  recuento_inventario aplicado en el rango, para ese (item, ubicación)
B = el ÚLTIMO  recuento_inventario aplicado en el rango, para ese (item, ubicación)
ventana = (A.aplicado_el , B.aplicado_el]      ← abierta al inicio, cerrada al final
```

⚠️ **Abierta al inicio a propósito:** los movimientos que escribió el recuento A pertenecen a la
ventana **anterior** —son la varianza que A descubrió—. Incluirlos la contaría dos veces.

⛔ **El borde se ancla en `secuencia`, no en `aplicado_el`.** El kardex documenta que `creado_el`
**no sirve para ordenar**: es la hora en que *empezó* la transacción, y dos que compiten por el
lock del mismo producto pueden aplicarse en orden inverso (docblock de `secuencia` en
`movimiento-inventario.entity.ts`). El ancla exacta la da
`recuento_inventario_linea.movimiento_id` → la `secuencia` de ese movimiento, y entonces la
ventana es `secuencia > ancla_A AND secuencia <= ancla_B`.

📌 **Salvo cuando el recuento del borde dio justo**, que no escribió movimiento y por lo tanto no
tiene `movimiento_id` del cual sacar la `secuencia`. Ahí el ancla cae de nuevo en `aplicado_el`, y
con eso vuelve el riesgo de orden: una transacción concurrente sobre el mismo producto que cruce
ese instante queda del lado equivocado. **Es el único caso en que la ventana puede correrse, y lo
detecta la columna «Otros»** (§ 5.4) — el residuo sale distinto de cero. Vale la pena escribirlo
acá porque el detector cubre su propio borde frágil, que no es obvio.

⚠️ Por qué `creado_el <= aplicado_el` igual funciona para el caso con movimiento, y por qué no
alcanza: `creado_el` no va en el `INSERT` del kardex —cae en el `DEFAULT now()` de la columna— y
`aplicado_el` también es `NOW()`, así que **dentro de la transacción del aplicar los dos son el
mismo instante** y el intervalo semiabierto separa bien. Es correcto y a la vez frágil: depende de
un default de columna y de que `NOW()` sea constante en la transacción. Por eso manda `secuencia`
y `creado_el` queda solo como respaldo del caso sin movimiento.

Con menos de dos recuentos, la fila **no muestra números**: muestra *"falta contarlo"*. La columna
de ventana muestra las dos fechas reales (*"del 1 al 20 de septiembre"*), que pueden ser más
angostas que el rango pedido y distintas entre filas.

⚠️ **`aplicado_el`, no `creado_el`:** una sesión puede tardar horas o cruzar turnos, y el delta se
aplica sobre el stock vigente al aplicar, no sobre el del conteo
(`docs/features/recuento-inventario.md`, "Por qué la diferencia es un delta, no un absoluto").

⚠️ **Un recuento que da justo no deja rastro en el kardex** (`recuentos.service.ts`: se saltea la
línea sin contar y la de delta cero). Por eso los bordes de la ventana **se buscan en
`recuento_inventario` / `recuento_inventario_linea`**, nunca en `movimientos_inventario`: por el
kardex, el conteo que salió perfecto es invisible — y es justamente el que confirma que el número
es confiable.

### 5.3 Las columnas: cuatro números y un detector

Todo sale de `movimientos_inventario` dentro de la ventana, en consultas agregadas:

| Columna | Cómo se calcula |
|---|---|
| **Teórico** | Σ salidas `motivo='venta'` **menos** entradas `motivo='anulacion'` y `motivo='devolucion'` — cancelar una venta repone los ingredientes, así que el teórico es **neto** |
| **Merma** | Σ salidas `motivo='merma'` cuyo `motivo_baja.tipo = 'merma'` |
| **Cortesía** | Σ salidas `motivo='merma'` cuyo `motivo_baja.tipo = 'cortesia'` |
| **Sin explicación** | Σ `motivo='recuento'`, **con signo**: salidas menos entradas. Un sobrante resta |
| **Otros** | El **residuo** entre las dos formas de calcular el consumo real (§ 5.4). Estructuralmente **cero**; es un detector, no un bucket |

📌 **Merma y cortesía escriben el mismo `motivo='merma'` en el kardex** (`items.service.ts`,
`resolverContexto`) y se distinguen solo por `motivo_baja.tipo`. El listado de `/mermas` ya
excluye la cortesía a propósito desde el 2026-09-18 (`mermas.service.ts`, `filtroTipoMerma`).

**`compra`, `traslado`, `inventario_inicial`, `correccion_compra` y `ajuste_costo` no aparecen en
ninguna columna.** Son abastecimiento (o, el último, ni siquiera mueve stock), y los dos conteos
que cierran la ventana ya los absorben. Un traslado de bodega a local es **entrada del local**, y
por eso medir por ubicación no ensucia ninguna de las dos cuentas.

### 5.4 La identidad, que es el test — y la columna "Otros"

No es una aproximación. Con los dos bordes apoyados en conteos aplicados —donde libro y realidad
coinciden por construcción— vale, **sin residuo**:

```
consumo_real = Teórico + Merma + Cortesía + Sin explicación
```

Se demuestra desarrollando la ecuación de libro sobre la ventana: los términos de
abastecimiento (`compra`, `correccion_compra`, `inventario_inicial`, `traslado`) se cancelan
contra los saldos de los bordes, y lo que queda son exactamente esos cuatro.

y `consumo_real` se puede calcular **por el otro lado**, por saldos en vez de por buckets:

```
consumo_real = saldo_al_cerrar_A  +  abastecimiento de la ventana  −  saldo_al_cerrar_B

donde  abastecimiento = entradas `compra`, `correccion_compra`, `inventario_inicial`
                        y `traslado`  −  salidas `traslado`
```

⚠️ **El saldo de cada borde NO es `cantidad_contada`, y confundirlos es el error natural.** El
recuento aplica un **delta** sobre el stock vigente **al aplicar**, no setea el valor contado
(`docs/features/recuento-inventario.md`, "Por qué la diferencia es un delta, no un absoluto"): si
contaste 11.800 a las 10:00 y se vendieron 500 antes de aplicar a las 14:00, el saldo al cerrar es
11.300, no 11.800. El saldo correcto es el **`stock_resultante` del propio movimiento del
recuento** —el que apunta `recuento_inventario_linea.movimiento_id`—, que es el ancla de § 5.2 y
el recorrido que el índice `idx_movimientos_inventario_item_secuencia` ya sirve.

⚠️ **Y si el recuento dio justo, no hay movimiento propio del cual partir** (§ 5.2): el saldo se
toma del último movimiento anterior a `aplicado_el`, que es correcto porque un delta cero no movió
nada — con la salvedad de orden que § 5.2 explica y que «Otros» detecta.

**Las dos cuentas tienen que dar idéntico.** Si difieren, hay un movimiento que el reporte no
clasificó: es un bug, no un redondeo.

📌 **Y esa diferencia es la columna "Otros"** (decisión del owner, 2026-09-19):

```
Otros = consumo_real_por_saldos  −  (Teórico + Merma + Cortesía + Sin explicación)
```

⛔ **Qué caza y qué NO — corregido el 2026-09-20, la primera versión de esta spec decía de más.**
Afirmaba que el residuo caza además "un motivo **conocido** que empiece a comportarse distinto,
como una `devolucion` que empiece a reponer ingredientes de receta". **Es falso por álgebra**, y lo
levantó la revisión independiente midiéndolo con un test: todo movimiento que cae en un bucket
existente mueve el consumo por saldos **y** el consumo por buckets en la misma cantidad, así que el
residuo queda en cero **por construcción**. El residuo no puede ver nada que ya esté clasificado.

**Lo que sí caza:** un movimiento que **mueve stock y no cae en ningún bucket ni en la lista de
abastecimiento**. Hoy eso es `ajuste_manual`, que la API escribe por `PATCH /items/:id/stock`;
mañana, cualquier `motivo` nuevo que alguien agregue sin leer esto. Sigue siendo mejor que un
bucket por lista de motivos desconocidos —esa hay que acordarse de actualizarla— pero el alcance
es ése y no más.

📌 **Ese hallazgo destapó un bug real en el teórico, ya corregido.** El mismo endpoint acepta
`motivo: 'devolucion'` **sin venta detrás**, y el teórico restaba toda entrada
`devolucion`/`anulacion` sin mirar el origen: una devolución manual bajaba el consumo teórico —o lo
ponía negativo— como si hubiera revertido una venta inexistente. La resta ahora exige
`venta_id IS NOT NULL`; las tres escrituras que vienen de una venta lo llevan y el ajuste manual
no. Con el filtro, esa devolución cae en «Otros», que es donde el reporte dice *"no sé explicar
esto"*.

Normalmente es **cero** y se muestra apagado; cuando no lo es, grita. Lo que cuesta: obliga a
traer el saldo de los dos bordes (§ 5.4, `stock_resultante`), que sin esta columna se podría
ahorrar. Es el precio de que la identidad corra **en producción y no solo en el test de e2e**
(§ 10), que sigue existiendo para cazarlo antes de que llegue a una pantalla.

### 5.5 Rendimiento: hay que medirlo, no suponerlo

Los índices que hoy tiene `movimientos_inventario` son por `venta_id`, `traslado_id`,
`compra_linea_id` y `(item_id, secuencia)`. **Ninguno sirve para "todos los movimientos de este
tenant en este rango de fechas"**, que es exactamente el recorrido del reporte; y
`recuento_inventario` no tiene índice propio para "los aplicados de este tenant en el rango".

⚠️ **No se agrega un índice a ciegas.** Se mide con `EXPLAIN (ANALYZE, BUFFERS)` sobre un seed
con **distribución realista**, y esa distribución es parte de la medición: con el 99 % de las
filas en el mismo valor, un índice parcial "no sirve" y la conclusión es falsa —ya pasó en este
repo, y el comentario que lo cuenta está en el docblock de
`idx_movimientos_inventario_venta`—. Si hace falta índice, entra con su medición escrita al lado,
como el resto de los de esta tabla.

### 5.6 Cuando el teórico está incompleto

Hay **tres** formas de que el teórico quede corto. Dos son medibles después y las avisa el
reporte; la tercera no lo es, y es un límite conocido:

| # | Caso | ¿Medible después? |
|---|---|---|
| 1 | **Receta sin ingredientes cargados.** Se vende en silencio, cero movimientos (`items.service.ts`, `obtenerIngredientesRecetaPorIds` devuelve lista vacía) | **Sí** — se cuentan las ventas de ítems `tipo='receta'` sin filas en `receta_ingredientes` |
| 2 | **Ingrediente sin ficha de stock.** El `JOIN item_producto` lo deja afuera y nunca entra a la lista a descontar | **Sí** — está en `receta_ingredientes` y no en `item_producto` |
| 3 | **Ingrediente no bloqueante sin stock.** Se vende sin él, el movimiento **no se escribe**, y el aviso *"se vendió sin ese insumo"* viaja en la respuesta HTTP y **no se persiste** (`items.service.ts`, `moverConsumoOSaltear`) | **No.** El dato se perdió |

El aviso de la pantalla nombra los casos 1 y 2. ⚠️ **En el caso 1 no se puede marcar la fila del
ingrediente afectado**: si la receta no existe, el sistema no sabe que la hamburguesa lleva pan.
Solo se puede nombrar el **plato**. En el caso 2 sí se nombra el ingrediente.

El caso 3 va al backlog como frente propio (§ 9).

### 5.7 Lo que NO se contó, que también es una respuesta

El reporte lista una fila por (producto, ubicación) con **al menos un** recuento aplicado en el
rango. Un producto que nadie contó no genera fila — pero **sí se cuenta**, en una línea arriba de
la tabla: *"43 productos activos sin conteo en este período"*, con cómo ver cuáles son.

⛔ **El universo son los ítems `activo = true`, no el catálogo entero.** La razón la puso el owner
y es de producto, no técnica: si un producto ya no se vende, **lo correcto es archivarlo**, no
inventar una regla en el reporte para esconderlo. El ruido lo saca el dueño pausando; el reporte
no lo disimula.

Se apoya en algo que ya existe (verificado 2026-09-20): `items.activo` con default `true`
(`item.entity.ts`), editable por `PATCH /items/:id`, y las cuatro pantallas de venta ya piden
`activo=true` (`items.service.ts`). La pantalla que lo maneja —`configuracion/items.vue`— ya
separa activos de pausados.

Por qué no las dos alternativas obvias:

| Alternativa | Por qué no |
|---|---|
| Contar el **catálogo entero** | Da un número que nunca baja y mezcla lo que el local ya no vende. Se vuelve paisaje y se deja de mirar |
| Contar **solo lo que tuvo movimiento** | Deja invisible al producto **activo sin un solo movimiento** — que es exactamente el caso del robo completo, el que más importa ver |

⚠️ **Arista aceptada a sabiendas** (owner, 2026-09-20): pausar un ítem que **todavía tiene stock**
lo saca del reporte con existencias adentro. Pausar significa *"no lo vendo más"*, no *"no lo
tengo más"*. Queda anotado, no arreglado: no bloquea nada y resolverlo es otro frente.

📌 **El número tiene que ser falsable:** si la línea dice 43, que 43 sea lo que aparece al pedir el
detalle. El owner lo va a leer como tarea pendiente, y un total que no cierra con su propia lista
es peor que no mostrarlo. Y sale de una **agregación**, nunca de traer el catálogo y restar en
memoria.

## 6. La plata

Mismo molde exacto que el reporte de anulaciones (`anulaciones-reporte.service.ts`), que ya lo
resolvió el 2026-09-18:

- **`cantidad × costo_unitario`** del propio movimiento, agrupado por `items.moneda_id`.
- **Nunca se convierte entre monedas.** Los totales salen separados por moneda.
- **`faltaCosto`** cuando algún movimiento del grupo tiene `costo_unitario IS NULL`: se muestra
  ese estado, nunca un `$0` mentiroso.

📌 **El costo del bucket "sin explicación" existe sin trabajo extra:** un movimiento de recuento
no trae costo propio, así que el kardex le **congela el CPP del momento**
(`inventario.service.ts`, `costoUnitarioCongelado` cae en `costoActualPrevio`). Es el costo
correcto: lo que valía ese kilo cuando se descubrió que faltaba.

**Decimal.js de punta a punta**, nunca `number`, y la suma se hace sobre valores ya redondeados
—`Σ ROUND(...)`, nunca `ROUND(Σ ...)`—, igual que en anulaciones.

## 7. API

### 7.1 `GET /api/reportes/varianza`

Listado paginado, una fila por (producto, ubicación).

| Query | Tipo | Nota |
|---|---|---|
| `desde` / `hasta` | `YYYY-MM-DD` o timestamp, **opcionales** | `@IsDateString()`. Fecha pura → día del negocio del tenant, `hasta` **inclusivo del día** |
| `ubicacionId` | uuid, opcional | La pantalla lo manda con el local por defecto |
| `itemId` | uuid, opcional | |
| `soloConVarianza` | booleano, opcional | Esconde las filas cuyo "sin explicación" es cero **y también las que no se pueden medir** (decisión del owner, 2026-09-20) |
| `page` / `pageSize` | `PaginationQueryDto` | 1-based, default 15, máx 100 |

Respuesta: `PaginatedResponse<VarianzaFila>`, donde cada fila trae `itemId`, `itemNombre`,
`unidadMedida`, `ubicacionId`, `ubicacionNombre`, la ventana (`desdeEl`, `hastaEl`,
`recuentoInicialId`, `recuentoFinalId`), los **cinco** números (`teorico`, `merma`, `cortesia`,
`sinExplicacion`, `otros`) como string a escala 4, y `costoSinExplicacion: CostoPorMoneda[]` con
su `faltaCosto`. Las filas sin dos recuentos vienen con `medible: false` y los números en `null`.

⚠️ **`otros` viaja siempre, incluso en `'0.0000'`.** Omitirlo cuando es cero haría que el
consumidor no pueda distinguir "cerró perfecto" de "esta versión de la API todavía no lo
calcula" — que es justo la ambigüedad que la columna existe para cerrar.

⛔ **`soloConVarianza` esconde dos cosas distintas, y es deliberado.** Además de las filas que
cerraron justas, esconde las que tienen **un solo recuento** en el rango —las que no se pueden
medir—. El owner lo eligió así el 2026-09-20: prefiere la lista corta que va derecho a lo que
perdió plata. El costo, que no tiene otro lugar donde pagarse: **un producto contado una sola vez,
con el filtro tildado, no aparece en ninguna parte** — el `sinConteo` de § 5.7 cuenta los de cero
recuentos, no los de uno. La pregunta quedó abierta en la Tarea 6 del plan, sobre su campo
`sinConteo`: si molesta, se resuelve abriéndolo en "nunca contado" y "contado una sola vez".

**Orden:** por plata sin explicación desc. El desempate **no puede ser el nombre**: `items.nombre`
no es único por tenant, así que dos homónimos con el mismo monto empatan y la paginación puede
repetir o saltear una fila. Cierra con los dos ids de la clave del grupo —`item_id` y
`ubicacion_id`— detrás del nombre de producto y del de ubicación.

### 7.2 `GET /api/reportes/varianza/resumen`

Los agregados y **los datos de la gráfica**, en una sola llamada. `desde`/`hasta`
**obligatorios**, con tope de 366 días: corre sin `LIMIT` sobre todo el rango.

Trae los totales por moneda de los cinco números (incluido `otros`), el **top 10 de productos por plata perdida**
con su desglose (merma / cortesía / sin explicación) para la gráfica, el conteo de los que quedan
afuera del top, y el **aviso de teórico incompleto**: platos vendidos sin receta (con cuántas
veces se vendieron) e ingredientes sin ficha de stock.

### 7.3 Permiso

Módulo propio **`Varianza`**, `url: '/reportes/varianza'`, permiso `Leer`;
`@RequiresPermiso('Varianza', 'Leer')` en las dos rutas. Seed: `modulos_app` + `tenant_modulos`
para el tenant Paris. **El rango de IDs libre empieza en
`550e8400-e29b-41d4-a716-446655440447`** (compras usa hasta `…446`, verificado el 2026-09-19).

⛔ **`tenant_id` sale del token en las dos rutas**, nunca de la query.

## 8. Pantalla

```
frontend/app/pages/reportes/index.vue      índice: una tarjeta por reporte que el usuario puede ver
frontend/app/pages/reportes/varianza.vue
```

Menú: un grupo **"Reportes"** en `layouts/dashboard.vue`, visible si el usuario puede ver **al
menos uno**. Gate de la pantalla:
`definePageMeta({ middleware: ['auth','permiso'], permiso: 'Varianza:Leer' })`.

Estructura, con los compartidos que ya existen: `CrudPageHeader` → `AppRangoFechas` → aviso de
teórico incompleto (si aplica) → tarjetas de total → `AppGrafica` → `CrudTable` con
`usePaginatedList` + `UPagination`. Cantidades con `useFormatters.formatStock(cantidad, unidad)`;
plata con `formatCostoPorMoneda`.

### 8.1 La columna "Otros" en pantalla

Normalmente vale cero y **no tiene que competir por la atención**: se pinta con el token
apagado (`text-muted`), sin badge ni color de estado. Cuando **no** es cero, pasa a color de
alerta y la fila muestra un `AppInfoButton` que explica qué significa en lenguaje del local —
*"hay movimientos de stock que este reporte no supo clasificar; el número de al lado puede
estar incompleto"*—, no en jerga de kardex.

⛔ **No se esconde la columna cuando todas las filas son cero.** Una columna que aparece y
desaparece entrena a no buscarla, y el día que aparezca va a parecer un error de la pantalla en
vez de un aviso.

### 8.2 Qué gráfica, y por qué

**Barras horizontales apiladas, una por producto, en plata**, cada barra partida en merma /
cortesía / sin explicación. Decisión del owner, 2026-09-19.

⚠️ **Se descartó "teórico contra real por producto", que era la idea de partida.** El motivo es
medible: la varianza *es* la diferencia chica entre dos números grandes, y **51 contra 58 en dos
barras se ven iguales**. Dibujar los dos números esconde exactamente lo que el reporte existe para
mostrar. Las barras apiladas, en cambio, muestran tamaño y composición a la vez — que es la misma
decisión de columnas de § 2.

📌 **"Otros" no entra en la gráfica.** Es un detector de que la cuenta no cerró, no una parte de
la pérdida: apilarlo lo haría leer como una categoría más de plata perdida. Su lugar es la
tabla, donde se puede explicar.

- **Horizontal** porque los nombres de producto son largos y se leen enteros.
- **En plata**, igual que el orden de la tabla, para que lo que se ve grande sea lo que duele.
- **Con muchos productos: top 10**, ordenado desc, y debajo *"y N productos más — la tabla los
  tiene todos"*. La gráfica nunca es la fuente de verdad.
- Los datos salen de `/resumen`, no de una ruta propia.

## 9. Fuera de alcance

- **Exportar a CSV/Excel/PDF.** Hoy no existe en **ninguna** pantalla de la app; lo único parecido
  es la página de impresión de liquidaciones de propinas con `window.print()`. Inventarla para el
  primer reporte sería arquitectura nueva para un problema que nadie pidió. El lugar queda dicho:
  `GET /reportes/<slug>/export` sobre la misma query sin `LIMIT`, y el componente compartido en la
  raíz de `app/components/`.
- **Persistir la advertencia "se vendió sin ese insumo"** (§ 5.6, caso 3). Es un agujero
  preexistente del teórico que este reporte no puede tapar ni medir. Va al backlog como frente
  propio: toca el camino caliente de la venta.
- **Mudar los reportes que ya existen** (§ 3.3). La lista de candidatos va al backlog.
- **Modos `serie` y `lote`.** El recuento solo soporta `cantidad` (2026-07-26), así que la
  varianza también.
- **Varianza de recetas anidadas como tal.** Una receta que es ingrediente de otra ya descuenta
  sus propios ingredientes al vender, así que el kardex la resuelve sola; no hay una vista
  "por plato" en esta versión.

## 10. Cómo se prueba

- **Unit (service):** la ventana `(A, B]` —que un movimiento en `A.aplicado_el` exacto **no**
  entra—; el teórico neto de una venta cancelada; merma y cortesía separadas por
  `motivo_baja.tipo`; el signo del sobrante; la fila sin dos recuentos que sale `medible: false`.
- **E2E de API — el test que vale:** montar un producto con dos recuentos, compras, ventas de una
  receta, una merma y una cortesía en el medio, y **verificar que las dos formas de calcular el
  consumo real dan idéntico** — o sea que `otros` sale `'0.0000'` (§ 5.4). Más: 403 sin el módulo
  contratado, `tenant_id` del token (un `ubicacionId` de otro tenant no devuelve nada), y el tope
  de 366 días del resumen.
- **El test que prueba que "Otros" sirve:** un `otros` que siempre da cero porque está cableado a
  cero pasa el test de arriba igual. Hace falta el caso que lo hace **saltar**: insertar en el
  kardex, dentro de la ventana, un movimiento con un `motivo` que el reporte no clasifica, y
  exigir que `otros` valga exactamente esa cantidad. Es el único control que distingue el
  detector del adorno.

  ⚠️ **Este es el caso raro en que montar el escenario con SQL directo es correcto y no un olor.**
  La regla del repo es sospechar del test que necesita SQL para llegar a su estado —suele
  significar que el estado es inalcanzable por API y que el caso real quedó sin cubrir—. Acá el
  estado es inalcanzable **a propósito**: el test simula un `motivo` que el código de mañana va a
  escribir y el de hoy no. Si algún día se pudiera producir por API, el detector ya habría
  fallado en producción.
- **E2E de navegador (Playwright):** la pantalla con el rol real del encargado, **no admin** — un
  módulo nuevo es justo donde un permiso faltante no se nota probando como dueño.
- **Render (vitest):** `AppRangoFechas` emitiendo `YYYY-MM-DD`; `AppGrafica` con sus estados de
  carga y vacío; y que la pantalla muestre la tabla **aunque la gráfica no monte**.

## 11. Documentación que cambia

| Archivo | Qué |
|---|---|
| `docs/features/modulo-reportes.md` (nuevo) | El criterio operación/negocio, dónde vive un reporte, los compartidos y su contrato |
| `docs/features/reporte-varianza.md` (nuevo) | El modelo de § 5, la identidad y los tres agujeros del teórico |
| `docs/adr/027-graficas-con-unovis.md` (nuevo) | La dependencia, por qué SVG + variables CSS y no colores en JS |
| `docs/patterns/frontend.md` | `AppRangoFechas`, `AppGrafica` y la regla de que lo compartido vive en la raíz de `app/components/` |
| `docs/patterns/backend.md` | Dónde vive un reporte y qué convenciones toma (§ 3.2) |
| `docs/agent/pendientes.md` | Candidatos a mudarse (§ 3.3) y persistir la advertencia (§ 9) |
| `docs/ESTADO.md` | Fila del módulo de reportes y fila de la varianza |
| `docs/README.md` | Links a las dos features nuevas |

---

## 12. Los dos puntos que la revisión de esta spec cerró

El owner los contestó el 2026-09-19, y quedan acá porque la razón importa más que el resultado:

1. **La gráfica: barras apiladas** (§ 8.2). Se había propuesto teórico-contra-real; se descartó
   por medida, no por gusto.
2. **Va la columna "Otros"** (§ 5.4). Se implementa como **residuo**, no como suma de motivos
   desconocidos — la diferencia está en § 5.4 y es la que decide si el detector sirve o no.

Sin puntos abiertos.
