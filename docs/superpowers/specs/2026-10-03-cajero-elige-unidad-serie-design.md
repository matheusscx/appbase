# En productos con número de serie, quien vende elige qué unidad sale

**Fecha:** 2026-10-03 · **Tipo:** spec de diseño
**Frente:** *"En productos con número de serie, el cajero elige qué unidad sale"*, en
[`docs/agent/pendientes.md`](../../agent/pendientes.md) § 3, "Qué lote o unidad sale de stock".
Escribe en `movimientos_inventario` y toca la trazabilidad
([ADR-007](../../adr/007-inventario-serie-lote.md)), así que va como frente propio.
**Cruza con:** la entrada de la § 6 *"Serie y lote están a medias"* (este frente cierra la
mitad barata de su punto 1: la merma deja de dar de baja una unidad equivocada) y con el
frente FEFO (mismo `inventario.service.ts`, pero en `moverLote`; este frente toca
solo la salida de `moverSerie`).
**Decisiones:** § 2. Cada una dice quién la tomó y cómo.

---

## 1. El problema

En una misma compra entran un equipo **nuevo** y uno **usado** del mismo producto. Al
venderlo, el sistema elige uno cualquiera: la salida de modo serie, cuando no le dicen qué
unidades salen, toma las más viejas del local (`InventarioService.moverSerie`, rama
"salida serie", `ORDER BY creado_el ASC LIMIT n FOR UPDATE`). La selección nunca mira la
condición, y **ninguna pantalla de venta manda qué unidad**: `CreateVentaLineaDto.unidadIds`
existe pero el POS no lo llena, y el cierre de cuenta del salón tampoco.

No es solo la venta. Hoy caen en la misma elección automática:

| Camino | Hoy |
|---|---|
| Cobro del POS (`POST /ventas`) | sin `unidadIds` → FIFO |
| Cierre de cuenta del salón | arma la venta sin `unidadIds` → FIFO |
| Componente de combo / opción de grupo de tipo producto | `moverConsumoOSaltear` sin `unidadIds` → FIFO |
| Anular una línea despachada con merma o cortesía (salón) | `consumirLineaAnulada` sin `unidadIds` → FIFO |
| Merma (`POST /mermas`) | el DTO no tiene `unidadIds` → FIFO |
| Ajuste de stock y traslado | la pantalla manda las unidades; la API sin ellas → FIFO |
| Tienda online y suscripciones | la venta sin `unidadIds` → FIFO (suscripción no vende productos) |

Ya rechazan modo serie y no cambian: recuento, cancelar venta con reposición, nota de
crédito con devolución. Ya mandan las unidades siempre: corrección y anulación de compra.

**Ingrediente de receta en modo serie: no existe.** El brief del frente lo dejaba abierto,
pero un ingrediente solo admite modo `cantidad` (`ItemsService`, al crear y editar el
ingrediente, al validar los insumos de una receta y sus extras; y en las opciones
ingrediente de un grupo). La pregunta real estaba en los **combos y opciones de grupo de
tipo producto**, que sí aceptan un producto en modo serie (§ 2, decisión 3).

## 2. Decisiones

1. **Elige quien vende, nunca el sistema.** Owner, 2026-09-28, "vamos A", en el selector de
   la orquestadora: *A: elige el cajero* (recomendada), *B: el sistema prefiere una
   condición*, *C: da lo mismo*.
2. **Sin compatibilidad: la API exige la unidad.** Owner, 2026-09-29: *"no tenemos pantallas
   mas viejas ni tenemos datos productivos"*.
3. **Combos y grupos: no pueden incluir un producto con serie.** Owner, 2026-10-03, por
   AskUserQuestion en esta sesión. Eligió *"Prohibirlo al armar"* (recomendada) entre eso,
   *"Preguntar la unidad también ahí"* y *"Dejarlo automático"*. Costo aceptado: "Celular +
   funda" se vende como dos líneas, y el precio de pack se arma con una promoción.
4. **Salón: la elige el garzón, al pedir.** Owner, 2026-10-03, AskUserQuestion. Eligió *"Al
   pedir, el garzón"* (recomendada) sobre *"Al cobrar, el cajero"*. El porqué: la elige quien
   entrega el producto, y si otra mesa pide la misma unidad, el rechazo llega al pedir y no
   al cobrar. Es la regla que el salón ya sigue con el stock (spec
   `2026-09-01-reserva-de-stock-al-pedir-design.md`).
5. **Tienda online: no vende productos con serie.** Owner, 2026-10-03, AskUserQuestion.
   Eligió *"No se venden online"* (recomendada) sobre *"Online sale automática"*. El porqué:
   sin cajero no hay quién elija, y una venta que la API rechaza después de Webpay deja un
   cobro sin venta.
6. **La serie vendida se ve en el detalle de la venta.** Owner, 2026-10-03,
   AskUserQuestion, *"En el detalle de la venta"* (recomendada). **La boleta impresa no
   cambia**: es materia fiscal y va en su propio frente.
7. **La merma rechaza productos con serie hasta que llegue su soporte.** Owner, 2026-10-03,
   AskUserQuestion, *"La merma lo rechaza"* (recomendada). Mientras tanto, la baja de una
   unidad se hace desde Ajuste de stock, que ya pide la unidad con casillas.
8. **Cancelar con motivo una cuenta con una línea con serie despachada a medias se frena**
   y pide anular esa línea primero, eligiendo la unidad. Owner, 2026-10-03, AskUserQuestion,
   *"Pedir anular primero"* (recomendada) sobre *"Dar de baja todas"*.

## 3. La regla vive en el chokepoint

**`moverSerie` deja de elegir.** Toda salida de modo serie tiene que traer `unidadIds`.
Sin ellas responde 400: *"Elegí qué unidades salen: «Nombre» tiene número de serie"*. La
entrada de un traslado ya exigía las suyas y sigue igual. La auto-selección FIFO se borra,
junto con el test que la fijaba.

Va en el chokepoint, y no en cada llamador, porque es el único lugar por el que pasan todas
las salidas: así un camino olvidado, o uno que se agregue después, rechaza en vez de elegir.
Es el mismo criterio por el que `moverSerie` es el único que inserta en `item_unidad`.

**Una unidad en una cuenta abierta está apartada.** Solo puede salir por esa misma cuenta.
`RegistrarMovimientoParams` gana un `cuentaId` opcional, que es la cuenta dueña de la salida
(la que se está cerrando o la que anula su línea). Cualquier otra salida de una unidad
apartada (otra venta, un ajuste, un traslado) responde 400 nombrando la serie y la mesa.

**La validación de unidades es UNA, compartida.** Hay un método de `InventarioService` que
valida un conjunto de unidades para un ítem: que sean de este tenant y de este ítem, que no
estén eliminadas ni repetidas, que estén `disponible`, en esta ubicación y no apartadas por
otra cuenta. Lo usan la salida de `moverSerie` y el salón al pedir (§ 5), así que las
reglas no se duplican.

### 3.1 Orden de bloqueo

- El ancla sigue siendo `item_producto FOR UPDATE OF ip`, que ya toman `registrarMovimiento`
  (venta, ajuste, traslado, anulación) y `validarStockAlPedir` (pedir en el salón). El
  método compartido **toma ese mismo lock** antes de leer las unidades, para no depender de
  que el llamador lo haya tomado: un PATCH del salón que cambia una unidad por otra sin cambiar
  la cantidad no pasa por `validarStockAlPedir` con neto > 0. Re-lockear la misma fila
  en la misma transacción no cuesta nada.
- Bajo ese lock, las unidades se lockean en **una** consulta con `unidad_id = ANY($1)
  ORDER BY unidad_id FOR UPDATE`. El orden es fijo y se elimina el `SELECT … FOR UPDATE` por
  unidad del loop actual, que era un N+1 en el camino que desde ahora usa toda venta de un
  producto con serie. La escritura (`vendido`/`baja`/cambio de ubicación) también es una
  sola sentencia.
- Orden global que no cambia: cuenta → `item_producto` (por `item_id`, ya ordenado en la
  venta) → `item_unidad` (por `unidad_id`).
- El chequeo "apartada por otra cuenta" se lee con el lock de `item_producto` ya tomado.
  Pedir en el salón y vender en el POS se serializan ahí, así que no hace falta un índice
  único sobre la unidad apartada. Un índice además no podría expresarlo, porque "apartada"
  depende de `cuentas.estado`.

## 4. Venta (`POST /ventas` y el cierre del salón)

- **Producto en modo serie:** `unidadIds` es obligatorio, con tantas como `cantidad` (que
  tiene que ser entera) y sin repetir dentro del carrito. Si una línea trae `unidadIds` y el
  producto no es de serie, responde 400. Se valida en `ventas.service` al resolver las líneas,
  con el `modo_inventario` que ya carga, antes de tocar stock. El chokepoint vuelve a validar
  pertenencia, estado, ubicación y apartado.
- **Presentación:** una línea con serie no admite `cantidadPresentacion`/`unidadCodigo`
  distinta de la base. Es la misma regla que ya tiene la merma.
- El precio no depende de la condición: el motor de precios no cambia.
- `POST /ventas/calcular` (la vista previa) no recibe unidades, igual que hoy.

## 5. Salón: la unidad viaja en la línea de la cuenta

`cuenta_lineas` gana `unidad_ids uuid[] NOT NULL DEFAULT '{}'`, con tipo explícito en la
entity; ya hay precedente de columna array en `promocion.entity.ts`. **Invariante:** en una
línea de un producto con serie, `cantidad = cardinalidad(unidad_ids)`. En cualquier otra
línea, `unidad_ids` está vacío. Cada puerta la mantiene:

| Puerta | Con serie |
|---|---|
| `agregarLinea` | `unidadIds` obligatorio, validado con el método compartido (§ 3), sin las ya apartadas por esta u otra cuenta. Si la línea se fusiona con una igual, las unidades se suman |
| `actualizarLinea` | Se manda el conjunto nuevo (`unidadIds`), no una `cantidad`. La cantidad se deriva. Bajar de `cantidad_enviada` sigue rechazado. Las que salen se liberan y las que entran se validan |
| `quitarLinea` | Sin cambios: solo es posible sin nada despachado, y libera las unidades |
| `anularLinea` | `unidadIds` obligatorio, tantas como `cantidad` y un subconjunto de las de la línea. Salen de la línea. Con merma o cortesía van a `baja` por el chokepoint (`consumirLineaAnulada` las pasa, con `cuentaId`). Con "no elaborado" se liberan |
| `cancelarConMotivo` | Si la línea está despachada entera, se anulan todas sus unidades. Si no se despachó nada, se liberan. Si se despachó a medias, 400: *"Anulá primero «Nombre» eligiendo cuál salió"* (§ 2, decisión 8) |
| `cancelarCuenta` (sin motivo) | Sin cambios: la cuenta deja de estar abierta y las unidades quedan libres solas |
| `fusionarCuentas` | Las unidades se mueven con la línea, o se suman al fusionarse con una igual |
| `cerrarCuenta` | Arma la venta con las `unidadIds` de cada línea y le pasa la cuenta. El chokepoint acepta las unidades apartadas por ella |

Una unidad nunca queda "reservada" en `item_unidad.estado`. El estado `reservado` cambiaría
el saldo (`COUNT(disponible)`) sin un movimiento en el kardex. Mientras está en una cuenta
abierta, la unidad sigue `disponible`, y el apartado se deriva de la cuenta, como ya pasa con
lo comprometido en modo cantidad.

## 6. Lo que se cierra en la configuración

- **Combo:** guardar un combo con un componente producto en modo serie responde 400.
- **Grupo de modificadores:** guardar una opción vendible que sea un producto en modo serie
  responde 400.
- **Producto:** pasar a modo serie un producto que es componente u opción viva responde 400.
  Hoy el cambio de modo solo se bloquea si hay movimientos, así que este hueco es nuevo.
- La expansión de combos y grupos en la venta no cambia. Si igual llegara un producto con
  serie, el chokepoint lo rechaza (§ 3) en vez de elegir.

## 7. Tienda online

- `GET /items` acepta **`vendibleOnline=true`**, que deja afuera los productos en modo serie.
  El nombre dice la regla y no el mecanismo. Va en `ItemsService.buildFindAllFilters`, no en
  el SELECT del listado: el orden por disponibilidad del frente de paginación arma la página
  en dos pasos reusando ese `where`, y un filtro puesto en otro lado no lo vería (condición
  de ese frente). La tienda lo manda por los
  `filtros` de `useCatalogoVenta`, que el frente de paginación ya integró (8b6a8faf).
- El checkout online (`OnlineService.checkout`) rechaza una línea de un producto con serie
  **antes** de iniciar el pago: *"«Nombre» se vende solo en el local"*.

## 8. Merma

`POST /mermas` de un producto en modo serie responde 400: *"«Nombre» tiene número de
serie: dalo de baja desde Ajuste de stock, eligiendo la unidad"*. La pantalla de Mermas deja
de ofrecer esos productos. Cuando el frente de la § 6 construya la merma con selector, esto
se reemplaza.

## 9. Unidades que se pueden vender

`GET /items/:id/unidades?vendibles=true` devuelve solo las `disponible` **del local** y no
apartadas por ninguna cuenta abierta. Ordena por condición (nuevo primero) y después por
serie. Sin `vendibles`, el endpoint sigue igual (lo usa "Ver unidades" de Inventario). El
permiso no cambia (`Items:Leer`), y tanto la cajera como el garzón del seed lo tienen.

Es una ayuda para la pantalla, no la regla: entre que el selector lista y el cobro, otra
caja puede vender la misma unidad, y el 400 de la API es lo que manda.

## 10. Detalle de venta

`GET /ventas/:id` agrega `unidades: [{ serie, condicion }]` a cada línea de un producto con
serie. Sale de `movimiento_inventario_detalle` → `movimientos_inventario` (de esa venta) →
`item_unidad`, en **una** consulta por venta, no una por línea. El drawer de detalle lo
muestra bajo la línea: *"Serie A1 · nuevo"*.

## 11. Pantallas

**Selector de unidades (componente compartido).** Lista lo de § 9 con la serie, la
condición como badge (usado y reacondicionado se distinguen a simple vista de nuevo) y la
garantía si la hay. Tiene un buscador por serie, que también sirve para pegar o escanear el
IMEI, y selección múltiple. Confirmar devuelve las unidades elegidas, y la cantidad es
cuántas se eligieron. Las que ya están en el carrito de esta pantalla no se ofrecen.

**POS.** Tocar un producto con serie en la grilla abre el selector. Hace falta que
`ItemCatalogo` traiga `modoInventario`: `GET /items` ya lo devuelve, solo falta en el tipo.
La línea del carrito guarda las unidades, muestra sus series y no deja editar la cantidad a
mano: "Cambiar unidades" reabre el selector. Al cobrar, `toVentaLineasBody` manda las
`unidadIds`.

**Salón.** Agregar abre el selector. La línea muestra sus series y, en lugar del input de
cantidad, tiene el mismo "Cambiar unidades" del POS: reabre el selector con las de la línea
ya marcadas, y confirmar manda el conjunto nuevo (`PATCH`, § 5). Mismo patrón en las dos
pantallas. Anular, sobre una línea con serie, pide con casillas cuáles se anulan en vez de
un número. El detalle de cuenta trae `unidades: [{ id, serie, condicion }]` por línea,
leídas en una consulta por cuenta.

**Detalle de venta.** Ver § 10.

**Mermas.** Sin productos con serie (§ 8).

## 12. Coordinación con los frentes paralelos

- **Paginación de la grilla** (`pos.vue`, `salones/index.vue`, `tienda/index.vue`,
  `CatalogoGrid.vue`): no se toca el bloque de carga del catálogo ni la grilla. Este frente
  entra por `onCatalogoAdd`, por el carrito y por la línea de cuenta. El filtro de la tienda
  se porta como dice § 7.
- **FEFO** (`inventario.service.ts`): ese frente toca `moverLote` y este solo la salida
  de `moverSerie`, más el campo `cuentaId` de `RegistrarMovimientoParams`. Si hace falta la
  fecha local del tenant, se usa su `hoyLocal`.

## 13. Verificación

- **e2e de API** con producto propio, no el iPhone del seed (stock acumulativo entre
  corridas):
  - la escena del nuevo y el usado: se vende el usado y sale el usado;
  - venta sin unidad;
  - unidad de otro producto o de la bodega;
  - unidad repetida en el carrito;
  - `unidadIds` en un producto sin serie;
  - unidad apartada por una mesa vendida desde el POS, o pedida por otra mesa;
  - cierre de cuenta que vende las unidades de la línea;
  - anular con merma (pasa a `baja`) y con "no elaborado" (queda libre);
  - cancelar con motivo con la línea despachada a medias;
  - fusionar;
  - combo, grupo y cambio de modo rechazados;
  - checkout online rechazado y `vendibleOnline`;
  - merma rechazada;
  - ajuste y traslado por API sin unidades;
  - detalle de venta con la serie;
  - `vendibles=true`.
- **Concurrencia:** dos ventas de la misma unidad a la vez. Una pasa y la otra recibe 400, no
  un deadlock. Se arma con el helper de carreras que ya usa el repo.
- **Unit:** las ramas nuevas de `moverSerie` y del método compartido. El test de la
  auto-selección FIFO se reemplaza por el del rechazo.
- **Playwright:** POS (elegir el usado, cobrar, verlo en el detalle) y salón (pedir con
  unidad, cobrar).
- **Smoke** con el rol real del módulo: la cajera en el POS y el garzón en el salón, no admin.

## 14. Fuera de alcance

- Que la merma pregunte qué unidad (§ 6 de pendientes, frente propio).
- Devolver una unidad al stock al cancelar una venta o emitir una NC (hoy se hace a mano
  desde Inventario, y sigue así).
- Precio distinto según la condición.
- La serie en la boleta impresa (fiscal, frente propio).
- FEFO de lotes (frente paralelo).
