# Lo que una mesa pide queda apartado

**Fecha:** 2026-09-01 · **Tipo:** spec de diseño
**Medición de origen:** entrada *"Dos mesas pueden pedir la MISMA última unidad"* en
[`docs/agent/pendientes.md`](../../agent/pendientes.md) § 4 (reproducida end-to-end, commit `54b659ae`)
**Decisiones del owner:** 2026-09-01, en la conversación que siguió a esa medición.

---

## 1. El problema, medido

Hoy pedir una línea en una mesa **no mira el stock ni lo retiene**. El stock sale recién
cuando la cuenta se cierra en venta (`ventas.service.ts:840`, y `venderIngredientesReceta`
para una receta); entre pedir y cobrar no hay nada. `salones.service.ts` **no menciona
`stock` ni una sola vez** y en el backend no existe ningún concepto de reserva.

La corrida que lo reprodujo, con un producto de `stock = 1` y dos mesas del mismo salón:

| Paso | Resultado |
|---|---|
| mesa A pide 1 | `201` |
| mesa B pide 1 | `201` — y el stock sigue en `1.0000` |
| las dos comandas a cocina | `201` y `201`, `cantidad_enviada` avanza a 1 en las dos |
| mesa A cobra | `201`, stock en `0.0000` |
| mesa B cobra | **`400` "Stock insuficiente para la salida"** |
| mesa B saca la línea | **`400` "ya se despachó a cocina…"** |

La mesa B queda **trabada**: no se puede cobrar y no se puede sacar la línea. La única
salida hoy es un ajuste de inventario a mano.

## 2. La decisión

> **Lo que una mesa pide queda apartado desde que lo pide.** La segunda mesa que quiera lo
> mismo lo ve como no disponible, y se entera **al pedir**, no al cobrar.

Cuatro decisiones del owner la completan:

| # | Pregunta | Decisión |
|---|---|---|
| 1 | ¿Qué hace el sistema con la segunda mesa? | **Apartarla**: la mesa 8 ya no la ve |
| 2 | ¿Hasta cuándo dura lo apartado? | **Mientras viva la cuenta**. Sin vencimiento por tiempo |
| 3 | ¿Qué se aparta de un plato con receta? | **Los ingredientes**, expandiendo la receta igual que la venta |
| 4 | ¿También los ingredientes no bloqueantes? | **Sí, todos.** Lo no bloqueante puede quedar en negativo |

La 2 es la que decide la arquitectura entera: *"vive exactamente mientras vive la cuenta"*
**no es un estado que haya que mantener, es una derivación.**

## 3. Enfoque: la reserva no se guarda, se deduce

Se evaluaron tres y el owner eligió el primero.

| | Enfoque | Por qué no |
|---|---|---|
| **A** ✅ | `disponible = stock − comprometido`, calculado sobre las líneas de cuentas abiertas | — |
| B | Tabla `reservas_stock` o columna `stock_reservado` | Es **otro saldo materializado que puede derivar** —el proyecto ya tiene uno, `item_producto.stock` sobre `movimientos_inventario`— y cada camino que toca una línea tiene que acordarse de liberar. Olvidarse de uno deja stock apartado para siempre, que es justo el modo de falla que la decisión 2 quiso evitar |
| C | Un movimiento en `movimientos_inventario` con motivo `reserva` y su reverso | Mezcla lo **comprometido** con lo que **salió físicamente** en el kardex, y ensucia la valorización del costo |

**Lo que A compra, y es el argumento entero:** cerrar la cuenta, cancelarla, quitar la
línea, bajarle la cantidad y fusionar dos cuentas **no necesitan una sola línea de código
nueva**. La reserva no existe como fila; existe como consecuencia de que la línea esté
viva en una cuenta abierta. Los estados ya juegan a favor: el comprometido se calcula sobre
`cuentas.estado = 'abierta'`, así que una cuenta `cerrada` o `cancelada` sale sola.

**Lo que A cuesta:** la consulta es más pesada (hay que expandir las cuentas abiertas), y
dos garzones pidiendo en el mismo instante tienen que serializarse.

## 4. Qué se construye

### 4.1 El número: `disponible` pasa a descontar lo comprometido

`ItemsService.calcularDisponibilidadBatch` ya es el lugar donde ese número se arma —hoy lee
`ip.stock` directo— y ahí se engancha el descuento. **Una sola consulta agregada** para todo
el listado, nunca una por ítem (`docs/agent/anti-patterns.md`, N+1).

El comprometido de un ingrediente es la suma, sobre las líneas vivas de cuentas **abiertas**
del tenant, de lo que cada línea consume de él: directo si la línea es un `producto`,
expandido por receta o por componentes de combo si no. Es la misma expansión que ya hace la
venta, con la misma conversión de unidades.

De paso, un `producto` suelto —que hoy devuelve `disponible: null`— pasa a tener número.

### 4.1b El contrato con el frontend cambia, y hay que tocarlo

⚠️ Salió de la auto-revisión de esta spec, no del diseño: **que `disponible` deje de ser
`null` para un `producto` no es sumar un campo, es cambiar qué significa el que ya está.**

Hoy el POS muestra dos cosas distintas según el tipo: `stock` para un producto y
`disponible` (porciones) para una receta. `descontarStockCatalogo`
(`useVenta.ts:240-275`) descuenta localmente **los dos campos**, cada uno con su guard, y
`useVenta.ts:267` ramifica justamente por `disponible !== null`.

**La decisión, y su porqué:** `stock` sigue significando **lo que hay físicamente** —es el
saldo materializado de `movimientos_inventario` y cambiarle el sentido sería mucho peor— y
`disponible` pasa a ser, **para todos los tipos**, *lo que todavía se puede pedir*. La
pantalla muestra `disponible` cuando existe y cae a `stock` cuando no.

Lo que eso obliga a tocar, y va en el plan como trabajo, no como efecto colateral:

- `useVenta.ts` — la rama de `disponible !== null` deja de distinguir producto de receta.
- `descontarStockCatalogo` — hoy descuenta `stock` y `disponible` por separado; con
  `disponible` presente en productos hay que revisar que la pantalla no muestre un número
  descontado dos veces.
- Los specs de pantalla que fijan hoy el `disponible: null` de un producto.

### 4.2 El enforcement: un solo punto

Solo dos caminos crean compromiso, y los dos viven en `SalonesService`:

- `agregarLinea`
- `actualizarLinea`, **únicamente cuando sube la cantidad** (bajarla solo libera)

Antes de escribir, y **bajo el mismo lock ordenado que la venta ya toma** al descontar
(`docs/patterns/backend.md` §15 — el orden de bloqueo de filas en ítems compuestos existe
justo para esto), se verifica que `comprometido + lo nuevo <= stock` para los ingredientes
**bloqueantes**. Si no alcanza, `400` **nombrando el ingrediente que faltó**, no un "no hay
stock" genérico.

Los **no bloqueantes** suman al comprometido pero **no frenan** (decisión 4): su disponible
puede quedar negativo, y es correcto que se vea.

### 4.3 Lo que NO cambia

- La venta sigue descontando al cerrar, igual que hoy.
- La reserva **no escribe** en `movimientos_inventario`. No hay entidad nueva, no hay
  columna nueva, no hay migración.
- Los guards de agosto sobre líneas despachadas (`cantidad_enviada`) quedan como están.

## 5. Cómo compone con el frente de la anulación con motivo

⚠️ **Esto va escrito acá porque es lo que se pierde si no se escribe.**

El frente *"Anular o reducir una línea ya enviada a cocina"* (`pendientes.md` § 3) va a
permitir sacar una línea despachada registrando merma o cortesía. Cuando aterrice, ese
camino hace dos cosas a la vez:

1. la línea deja de contar como comprometido (desaparece, o le baja la cantidad),
2. la merma o la cortesía registra una salida real, así que **baja el `stock`**.

Como el número es `stock − comprometido`, **un lado baja y el otro sube lo mismo: neto
cero, automático.** Nadie tiene que acordarse de liberar nada. Con el enfoque B habría que
soltar la reserva *y* registrar la salida en la misma transacción, y equivocarse en el orden
descuenta dos veces.

📌 **Lo único que hay que mirar, y es un `WHERE`:** si ese frente decide **conservar la
línea** marcada como anulada en vez de sacarla o bajarle la cantidad, la consulta del
comprometido necesita una condición más para dejar de contarla. Una línea de SQL, no un
rediseño.

## 6. Lo que esto NO arregla

**No elimina el choque.** Una merma, un recuento o un ajuste manual pueden dejar el stock
por debajo de lo ya comprometido, y esa mesa vuelve a quedar sin poder cobrar y sin poder
sacar la línea. **La salida con motivo sigue haciendo falta**: este frente achica el caso,
no lo borra. Decirlo importa porque el bloqueo de agosto ya prometió una salida —*"registralo
como merma o cortesía"*— que todavía no existe.

**Fuera de alcance, anotado:** la tienda online tiene el mismo hueco por otro camino —el
carrito vive en el navegador, no hay tabla, y entre la orden de pasarela y el callback de
pago nadie retiene nada—. No se toca acá; se anota para cuando se encare.

## 7. Cómo se prueba

- **E2E que reproduce la sonda tal cual**, y ese es el test que vale: dos mesas del mismo
  salón sobre un producto con `stock = 1`. La segunda ahora rebota **al pedir** (`400`
  nombrando el ingrediente), no al cobrar. Antes del fix el mismo test da `201` y el choque
  aparece recién al cerrar: es un mutante que **revierte**.
- **E2E de receta**: pedir el plato aparta el ingrediente, y otra mesa no puede pedir el
  mismo plato aunque el plato en sí no tenga stock propio.
- **E2E de que soltar funciona**: quitar la línea (sin despachar) devuelve la disponibilidad,
  y cancelar la cuenta también. Sin código nuevo — el test prueba justamente eso.
- **E2E del no bloqueante**: con el ingrediente no bloqueante en cero, pedir el plato
  **entra igual** y el disponible de ese ingrediente queda negativo.
- **Unitarios** del cálculo del comprometido, incluida la conversión de unidades.
- ⚠️ El e2e del choque necesita **categoría con impresora** para que la comanda salga de
  verdad; sin eso `cantidad_enviada` no avanza y el caso parece no reproducir. Costó una
  corrida descubrirlo.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| La consulta del comprometido se vuelve cara con muchas cuentas abiertas | Una sola query agregada por listado, nunca una por ítem. Si aparece un problema real, se mide antes de optimizar |
| Dos garzones piden el último en el mismo instante | El lock ordenado que la venta ya toma. Un e2e concurrente lo fija |
| Una cuenta olvidada inmoviliza stock | **Aceptado explícitamente por el owner** (decisión 2). La salida es cerrar o cancelar la cuenta, que ya existen |
| `disponible` deja de ser `null` en productos y el POS ramifica por eso | § 4.1b: es cambio de contrato, va en el plan como tarea propia con sus specs de pantalla, no como efecto colateral |
