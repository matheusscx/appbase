# Feature: Reporte de varianza (AVT)

> **Estado:** implementado — backend, tabla y gráfica (2026-09-21).
> Spec de diseño: [`docs/superpowers/specs/2026-09-19-modulo-reportes-varianza-design.md`](../superpowers/specs/2026-09-19-modulo-reportes-varianza-design.md).

## Qué contesta

*"Según tus recetas debías usar 40 kilos y usaste 47."* Compara el consumo **teórico** —lo que el
sistema descontó al vender— contra el consumo **real** entre dos conteos físicos, por
(producto, ubicación).

⛔ **El teórico NO se recalcula desde las recetas: ya está escrito en el kardex.** Vender una
receta descuenta sus ingredientes con la receta vigente **en ese momento**
(`ItemsService.venderIngredientesReceta`), así que el teórico **es** el conjunto de salidas
`motivo='venta'`. Recalcularlo desde `receta_ingredientes` mentiría cada vez que alguien edita una
receta, y el repo ya depende de esto para reponer stock al cancelar una venta.

## La ventana de cada fila

Entre los **dos recuentos aplicados** que caen en el rango: el más viejo y el más nuevo de ese
(producto, ubicación). Intervalo `(desde, hasta]` — abierto al inicio, porque los movimientos del
conteo inicial son la varianza que **ese** conteo descubrió y contarlos los contaría dos veces.

⛔ **El filtro se ancla en `secuencia`, no en la fecha.** `creado_el` es la hora en que *empezó* la
transacción: dos movimientos que compiten por el lock del mismo producto pueden aplicarse en orden
inverso al de su fecha. La `secuencia` exacta la da `recuento_inventario_linea.movimiento_id`.

⚠️ **Un recuento que dio JUSTO no escribe movimiento**, así que no tiene `secuencia` y el borde cae
en `aplicado_el`. Ahí vuelve el riesgo de orden, y lo detecta la columna «Otros».

Una fila con **menos de dos** conteos viaja con `medible: false` y los números en `null`: *"no se
perdió nada"* y *"todavía no se puede medir"* son respuestas distintas, y el reporte las distingue
en todos lados.

## Los cuatro números, y el detector

| Columna | Qué es |
|---|---|
| **Teórico** | Σ salidas `venta`, **menos** entradas `anulacion`/`devolucion` **que vienen de una venta** (`venta_id IS NOT NULL`) |
| **Merma** | salidas `motivo='merma'` cuyo `motivo_baja.tipo` es `merma` |
| **Cortesía** | las mismas salidas, con `motivo_baja.tipo = 'cortesia'` |
| **Sin explicación** | Σ `recuento` con signo (salidas − entradas). Un **sobrante resta** |
| **Otros** | el **residuo** entre las dos formas de calcular el mismo consumo real |

⛔ **«Otros» es un detector, no un balde.** Vale cero por construcción cuando la cuenta cierra:

```
porSaldos  = saldoDesde + abastecimiento − saldoHasta
porBuckets = teórico + merma + cortesía + sin explicación
otros      = porSaldos − porBuckets
```

⚠️ **Lo que el residuo NO puede ver:** cualquier movimiento que caiga en **algún** balde se cancela
contra los saldos, aunque esté mal atribuido. Solo caza lo que no cae en ninguno — hoy,
`ajuste_manual` (`PATCH /items/:id/stock`). Todo tenant que use "Ajustar stock" dentro de una
ventana va a ver «Otros» distinto de cero, y esa es la conducta correcta.

⚠️ **El saldo del borde es el `stock_resultante` del movimiento del recuento, NO `cantidad_contada`**
— confundirlos es el error natural. El recuento aplica un **delta** sobre el stock vigente al
aplicar: si se contaron 11.800 a las 10:00 y se vendieron 500 antes de aplicar a las 14:00, el
saldo al cerrar es 11.300.

## La plata

`cantidad × costo_unitario` del propio movimiento, agrupado por `items.moneda_id`.

- ⛔ **Nunca se convierte entre monedas.** Los totales salen separados por moneda.
- ⛔ **`Σ ROUND(...)`, nunca `ROUND(Σ ...)`**: el costo lo tiene cada movimiento, no la suma.
- ⛔ **Si algún movimiento del grupo no tiene costo, la fila va SIN cifra** y con `faltaCosto` —
  nunca una suma parcial que se lea como completa. Mismo criterio que el reporte de anulaciones.

📌 El costo de un movimiento de recuento es el **CPP congelado en el momento**: lo que valía ese
kilo cuando se descubrió que faltaba.

## API

`GET /api/reportes/varianza` — listado paginado. `desde`/`hasta` opcionales (fecha pura → día del
negocio del tenant, `hasta` inclusivo), `ubicacionId`, `itemId`, `soloConVarianza`, `soloSinCosto`.

**Orden: por plata perdida desc**, y cierra con los dos ids de la clave del grupo. El desempate no
puede ser el nombre: `items.nombre` no es único por tenant, así que dos homónimos con el mismo
monto pueden repetirse o saltearse entre páginas.

⚠️ **Una fila sin costo se ordena por una suma que no muestra**: `SUM` ignora los `NULL`, así que
si ningún recuento tenía costo el monto es `0` y la fila se hunde entre las que no perdieron nada.
**El orden no se cambia** (owner, 2026-09-27): subirlas arriba le quitaba el primer lugar al que
más plata perdió. Las rescata el aviso de `perdiendoSinCosto`.

⛔ **`soloConVarianza` esconde dos cosas** (decisión del owner, 2026-09-20): las filas que cerraron
justas **y** las que no se pueden medir. El costo, que no se paga en ningún otro lado: un producto
contado una sola vez, con el filtro tildado, no aparece en ninguna parte.

⛔ **`soloSinCosto` trae exactamente las filas que cuenta `perdiendoSinCosto`**: sin costo en sus
recuentos **y** con faltante (`sin explicación > 0`). Un predicado, sobre el mismo `LATERAL` de la
fila, en los dos lados. Queda afuera el **sobrante** sin costo —no está perdiendo plata, y no se
hunde: queda en `0`, arriba de los sobrantes con costo— y la fila que **se compensó** (faltaron 2
y después aparecieron): cerró justa. Por eso el conjunto cae dentro del de `soloConVarianza`, y
esa llave no cambia ni el número ni las filas.

`GET /api/reportes/varianza/resumen` — agregados y datos de la gráfica. `desde`/`hasta`
**obligatorios**, con tope de 366 días de diferencia: corre sin `LIMIT` sobre todo el rango.
Trae totales por moneda de los cinco números, el top 10 por plata perdida, `fueraDelTop`,
`faltaCosto`, `perdiendoSinCosto` y el **faltante de conteo**.

⚠️ **`faltaCosto` y `perdiendoSinCosto` contestan cosas distintas.** El primero mira **todos** los
movimientos del rango: dice que los totales en plata están cortos. El segundo mira la misma
bandera que la fila —solo los recuentos, la plata de "sin explicación"— y cuenta **filas**
(producto, ubicación), no productos, porque es el total que el link va a mostrar. Un ajuste sin
costo dentro de la ventana prende el primero y no el segundo.

⛔ **El faltante va abierto en dos** (owner, 2026-09-20): `nuncaContado` y `contadoUnaSolaVez`. Al
primero le falta **empezar** a contarse, al segundo le falta **cerrar**. Universo: ítems con
`activo = true` — si un producto ya no se vende, lo correcto es archivarlo, no inventar una regla
en el reporte para esconderlo.

⚠️ **Se cuenta por (ítem, ubicación) y se toma el máximo**, no se suma el ítem entero: la tabla
mide por ubicación, y sumando, un producto contado una vez en el local y una vez en la bodega daba
"2 conteos", se daba por medido y **desaparecía de las dos vistas**.

⚠️ **Un conteo hecho en una ubicación después borrada no cuenta**, porque el listado tampoco lo
muestra.

**Permiso:** módulo propio `Varianza`, permiso `Leer`, en las dos rutas. Un módulo sin su fila en
`tenant_modulos` da 403 **hasta al admin del tenant**.

## Pantalla

`/reportes/varianza`, detrás de `middleware: ['auth', 'permiso']` con `Varianza:Leer`, y
alcanzable por la entrada "Reportes" del menú (catálogo en `composables/useReportes.ts`).

- Arranca en **este mes** y, si el tenant tiene bodegas, **en el local**: es donde se vende y de
  donde sale el teórico. Sin bodegas el selector de ubicación no se dibuja.
- **«Solo con diferencia» arranca prendido.** ⚠️ El owner decidió qué esconde (2026-09-20), no
  el default: el default lo eligió el agente al implementar, a partir de esa misma preferencia por
  la lista corta. Si el owner lo quiere apagado, es cambiar un `ref`. Va solo al listado: el
  resumen no lo declara y el pipe global lo borraría callado (`whitelist` sin
  `forbidNonWhitelisted`, medido: 200), así que mandarlo haría creer que los totales lo siguen.
- Una fila no medible dice *"falta contarlo"* y **no muestra ningún número**: un cero ahí se
  leería como "cerró perfecto".
- «Otros» se pinta apagado en cero y en alerta, con explicación, cuando no; **la columna no se
  esconde nunca**.
- El faltante de conteo sale en una línea con los dos números, y cada uno abre su lista.
- Debajo, en el mismo formato, *"3 productos no tienen costo y pueden estar perdiendo plata"* con
  un link que filtra la tabla (`soloSinCosto`) y, puesto, dice «Ver todos». Solo filtra con rango
  completo: la línea vive en el resumen, y sin ella nada en pantalla diría que la tabla está
  recortada. Por lo mismo, con el filtro puesto **la línea queda aunque el número baje a cero**.
- **La gráfica** son barras apiladas del top 10 por plata perdida —sin explicación, merma,
  cortesía—, con *"y N productos más"* al pie. Sale del mismo `/resumen`, sin ruta aparte.
  ⛔ **«Otros» no entra**: es un detector de que la cuenta no cerró, no una parte de la pérdida.
  ⚠️ **Grafica solo la moneda oficial.** El top viene ordenado por magnitud cruda y puede mezclar
  monedas, y una barra en pesos al lado de otra en dólares no se compara por largo; los de otra
  moneda se cuentan al pie y están en la tabla. **Un sobrante no se dibuja**: llega con
  `sinExplicacion` negativo, no es plata perdida, y apilado se superpondría con la merma; se
  grafica en cero y el pie lo cuenta. Mientras no cargó la moneda oficial, la gráfica espera; si la carga falló, lo dice como fallo.
  Detalle de la gráfica: ADR-027.

## Rendimiento (medido 2026-09-21)

**Lleva un índice nuevo, `(item_id, ubicacion_id, secuencia)`, y lo que más gana no es la
lectura: es que el JIT de Postgres deja de dispararse.**

Base de medición: copia de la base del worktree con **92.381 movimientos** (92.378 del tenant
medido; `count(*)` sobre la base, no el estimado de un plan) —80 productos en el
local **y** en la bodega, un año de ventas diarias, compras y traslados semanales, merma y
cortesía cada ~10 días, y recuentos cada 14 días en el local y cada 30 en la bodega, **todos con
movimiento escrito** (la medición de la Tarea 5 tenía 17 de 30 grupos por la rama de respaldo
`aplicado_el`; esta ejercita la de `secuencia`)—, 106 recuentos aplicados, 192 grupos. Endpoint
entero, app en proceso contra Postgres 15.18 local, mediana de 5 corridas después de calentar, en
ms:

| Escenario | Sin índice, JIT prendido (default) | Sin índice, JIT apagado | Con índice, JIT apagado | **Con índice, JIT prendido** |
|---|---|---|---|---|
| Listado, 30 días | 177 | 140 | 81 | **75** |
| Listado, 30 días, «solo con diferencia» | 288 | 234 | 127 | **128** |
| Listado, 365 días | 587 | 159 | 116 | **140** |
| Listado, sin rango | 570 | 159 | 117 | **131** |
| Resumen, 30 días | 179 | 118 | 69 | **66** |
| Resumen, 365 días | 688 | 196 | 136 | **119** |

- **Sin el índice, el JIT se come la mayor parte**: en el listado de un año, de 562 ms de
  ejecución, **431 son compilación JIT**. Se dispara porque el costo *estimado* (682 mil) supera
  `jit_above_cost` (100 mil): el `LATERAL` se estima a ~1.087 por grupo sobre 626 grupos
  estimados, contra 192 reales. **Con el índice** la misma consulta se estima en 54 mil, el JIT no
  se dispara y corre en 79 ms.
- **Con el JIT apagado el índice igual gana**, por los bloques que lee: 174.875 → 89.692 en el
  listado de un año. Los bordes de la ventana siguen dentro de un `CASE` que ningún índice sirve
  como `Index Cond` —eso no cambió desde la Tarea 5—; lo que el índice agrega es la ubicación en el
  `Index Cond` (`item_id = … AND ubicacion_id = …`).
- **No reemplaza al índice `(item_id, secuencia)`**: "rehacer la cuenta" recorre un producto en
  todas sus ubicaciones ordenado por `secuencia`, y en el índice nuevo esa secuencia solo está
  ordenada dentro de cada ubicación.
- **Escribir no cuesta más**: 20.000 inserts de a uno, como los escribe una venta, mediana 355 ms
  sin el índice y 342 ms con él — ruido. Pesa 12 MB a 92 mil filas.
- **«Solo con diferencia» sigue costando dos barridos**, como estaba previsto: el `COUNT` también
  necesita el `LATERAL` para saber qué filas sobreviven.

⚠️ **Por qué la Tarea 5 había medido "no sirve".** Su seed tenía cada producto en una sola
ubicación, y así la ubicación no filtra nada. Acá el mismo producto se mueve en local y bodega, que
es el caso que el reporte mira. La distribución es parte de la medición.

⚠️ **Y la primera corrida de esta medición también mintió**, por otra causa: el índice se creó
con SQL antes de levantar la app, y **`synchronize` lo borró al arrancar** —borra todo índice que
las entities no declaran—. La columna "con índice" de esa corrida era una segunda medición sin
índice. Lo encontró la revisión; las columnas de arriba son de la corrida con el índice creado
después del arranque y verificado en `pg_indexes` al terminar.

## Aristas aceptadas a sabiendas

- **Pausar un ítem que todavía tiene stock** lo saca del reporte con existencias adentro. Pausar es
  *"no lo vendo más"*, no *"no lo tengo más"*.
- **El aviso de "teórico incompleto" NO existe**, y no por olvido: los dos casos que iba a nombrar
  no los deja producir la API (una receta exige un ingrediente; un ingrediente de receta siempre
  tiene ficha de stock). ⚠️ **Si alguna vez se afloja cualquiera de esas dos guardas, este reporte
  deja de avisar que sus números están cortos y nada lo va a señalar** — spec § 5.6.
- **El caso que sí ocurre** —se vendió sin un insumo no bloqueante— no se persiste: el aviso viaja
  en la respuesta HTTP y se pierde. Frente propio.

## Cómo se prueba

⛔ **Con `Db` mockeado la consulta no se ejecuta**: el tipo de `JOIN`, los `FILTER`, el `GROUP BY` y
el orden **solo** los cubre el e2e contra Postgres. Medido tres veces en este frente, con los
números y la regla de los dos controles: [`anti-patterns.md`](../agent/anti-patterns.md).

Specs: `varianza.service.spec.ts` (mapeo, validación del rango) y cuatro e2e —ventana, baldes,
plata y resumen—. Que el número del aviso y las filas del link coincidan lo fija un e2e de la
plata con un producto por lectura del criterio que se descarta. Pantalla: `varianza.nuxt.spec.ts`
(render) y el Playwright `frontend/e2e/reportes/varianza.spec.ts`, que entra **como el aprobador
de inventario**, falla si cualquier llamada de la carga le devuelve un error, y hace clic en el
link del aviso: el listado filtrado tiene que venir solo con filas sin costo y con el total que
dijo el resumen.
