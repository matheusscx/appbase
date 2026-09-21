# Feature: Reporte de varianza (AVT)

> **Estado:** backend y pantalla (tabla) listos; la gráfica es la tarea 8 del plan.
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
negocio del tenant, `hasta` inclusivo), `ubicacionId`, `itemId`, `soloConVarianza`.

**Orden: por plata perdida desc**, y cierra con los dos ids de la clave del grupo. El desempate no
puede ser el nombre: `items.nombre` no es único por tenant, así que dos homónimos con el mismo
monto pueden repetirse o saltearse entre páginas.

⛔ **`soloConVarianza` esconde dos cosas** (decisión del owner, 2026-09-20): las filas que cerraron
justas **y** las que no se pueden medir. El costo, que no se paga en ningún otro lado: un producto
contado una sola vez, con el filtro tildado, no aparece en ninguna parte.

`GET /api/reportes/varianza/resumen` — agregados y datos de la gráfica. `desde`/`hasta`
**obligatorios**, con tope de 366 días de diferencia: corre sin `LIMIT` sobre todo el rango.
Trae totales por moneda de los cinco números, el top 10 por plata perdida, `fueraDelTop`,
`faltaCosto` y el **faltante de conteo**.

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
plata y resumen—. Pantalla: `varianza.nuxt.spec.ts` (render) y el Playwright
`frontend/e2e/reportes/varianza.spec.ts`, que entra **como el aprobador de inventario** y falla si
cualquier llamada de la carga le devuelve un error.
