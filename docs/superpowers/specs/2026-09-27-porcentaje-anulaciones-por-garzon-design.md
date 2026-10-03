# % de anulaciones y cortesías sobre lo pedido, por garzón

**Fecha:** 2026-09-27 · **Tipo:** spec de diseño
**Frente:** *"% de anulaciones y cortesías sobre lo vendido por garzón"*, en
[`docs/agent/pendientes.md`](../../agent/pendientes.md) § 3. Lo dejó fuera el reporte de anulaciones
([spec](2026-09-18-reporte-anulaciones-design.md), § 7).
**Decisiones del owner:** el reparto de la venta (2026-09-20) y las tres del 2026-09-27, en § 2.

---

## 1. El problema

El resumen del reporte de anulaciones (`GET /salones/anulaciones/resumen`) dice cuánto anuló o regaló
cada garzón (`platos`, `precioCarta`, `costo`), pero no contra qué compararlo: un garzón que regaló
$12.000 puede estar regalando mucho o nada según cuánto atendió. El mercado lo resuelve con un
porcentaje por empleado (Toast, *Void %*; ver § 8 de la spec del reporte), y la app no lo puede
calcular por dos razones:

- **No sabe cuánto atendió cada garzón.** `cuentas.garzon_responsable_id` guarda solo el responsable
  **vigente**, y la transferencia (`POST /cuentas/:id/transferir`) lo pisa. Después de una transferencia
  no queda rastro de qué pidió la mesa mientras la tenía el anterior.
- **No hay regla de qué es "la venta" de un garzón.** La definió el owner (§ 2).

## 2. Las decisiones que lo sostienen

| Decisión (owner) | Por qué importa |
|---|---|
| **La venta se reparte entre los garzones que atendieron la mesa** (2026-09-20). Ana abre, sirve $40.000 y termina turno; Beto sirve $20.000 y cobra → $40.000 a Ana y $20.000 a Beto | *Del que abrió* deja a Beto con venta cero y su % se dispara; *del que cerró* le borra a Ana lo que vendió. El costo aceptado: guardar quién tenía la mesa por cada cosa pedida |
| **La venta se mide a precio de carta** (2026-09-27): lo que dice `cuenta_lineas.precio_unitario`, antes de descuentos, recargos, impuestos y propina | Es el mismo metro que ya usa el numerador (`precioCarta` de cada anulación, congelado igual). Sale de lo que la cuenta guarda: **no toca ventas, ni el motor, ni lo fiscal**. Costo asumido: no ve los descuentos, y en happy hour el % de todos sale un poco más bajo |
| **El % es sobre lo pedido** (2026-09-27): lo anulado ÷ (lo vendido + lo anulado). Beto: $20.000 anulados de $100.000 pedidos = 20%, no 25% | Nunca pasa de 100% y nunca divide por cero: una mesa cancelada entera da 100%, no un número imposible |
| **La tabla "Por garzón" muestra a todos los que atendieron**, también a los que no anularon nada, con 0% (2026-09-27) | El 0% de Carla es el punto de comparación que hace sospechoso el 15% de Beto. Costo asumido: la lista es más larga, y el filtro de garzón (que sale de esa lista) ofrece también a los que no anularon |
| **La anulación sigue siendo del garzón que tenía la mesa al anular** (2026-09-18, spec del reporte § 2) | No cambia. Si Ana pide el lomo, transfiere y Beto anula el lomo quemado, el lomo cuenta en lo anulado **y** en lo pedido de Beto, y sale de lo vendido de Ana: cada peso del total pedido cuenta una sola vez (§ 4.3) |

## 3. Modelo de datos: el reparto de cada línea

### 3.1 Por qué una tabla y no una columna en la línea

El pedido del owner fue *"guardar qué garzón tenía la mesa en cada línea"*. Una columna
`cuenta_lineas.garzon_id` no alcanza por la forma en que el salón edita las cantidades:

- **Sumar desde el catálogo** (`POST /cuentas/:id/lineas`) **junta** el pedido con una línea igual que ya
  estaba (mismo ítem, personalización, precio y reglas; `salones-mesas.md`).
- **El stepper "+"** de la pantalla hace `PATCH /cuentas/:id/lineas/:lineaId` con la cantidad
  **absoluta**, sobre la misma línea.

Escena: Ana sirve 2 cervezas; transfiere; la mesa pide otra ronda y Beto aprieta "+". Con una columna,
la tercera cerveza es de Ana. La única forma de que sea de Beto con una columna es **partir la línea en
dos** a la vista ("Cerveza ×2" y "Cerveza ×1"), lo que cambia lo que ve el garzón y pelea con la edición
optimista con debounce de `salones/index.vue`, que identifica la línea por su id y escribe absoluto
(ahí el orden de pintado y envío es la lógica, y una línea que aparece en la respuesta sin que el garzón
la haya creado es un caso que esa pantalla no conoce). El reparto hace que la tercera
cerveza sea de Beto **sin que la pantalla del salón cambie**.

### 3.2 `cuenta_linea_reparto` (nueva)

| Columna | Tipo | Nota |
|---|---|---|
| `cuenta_linea_reparto_id` | `uuid` PK | |
| `tenant_id` | `uuid` NOT NULL | |
| `cuenta_linea_id` | `uuid` NOT NULL | La línea |
| `garzon_id` | `uuid` NULL | El responsable vigente de la cuenta cuando esas unidades entraron. Null solo si la cuenta no tenía responsable |
| `cantidad` | `numeric(18,4)` NOT NULL | En la unidad canónica, igual que `cuenta_lineas.cantidad` |
| `creado_el` / `actualizado_el` / `eliminado_el` | `timestamptz` | Soft delete estándar |

- **A lo sumo una fila viva por `(cuenta_linea_id, garzon_id)`**: índice único parcial
  `WHERE eliminado_el IS NULL`. Con `garzon_id` null el índice no la cubre (Postgres trata los null como
  distintos); lo sostiene el código.
- **La invariante: para toda línea viva, Σ `cantidad` del reparto vivo = `cuenta_lineas.cantidad`.** La
  fijan los tests (§ 7), no una restricción de la base.
- Una fila que baja a 0 **no se borra**: queda en 0. Nada la lee distinto de una fila que no existe.
- **Sin backfill:** no hay datos productivos. Entidad nueva, registrada en `app.module.ts` (también en
  `entities`), `startup-pos.sql` como documentación, y se resetea.

### 3.3 Quién escribe el reparto

Toda escritura va **dentro de la transacción que ya tiene la cuenta con `FOR UPDATE`**
(`getCuentaAbiertaConLock` o el lock de la fusión/anulación): el reparto de una línea solo se toca bajo
el lock de su cuenta, así que **no agrega un orden de bloqueo nuevo**. El responsable se lee de la
cuenta ya bloqueada (`cuenta.garzonResponsableId`), nunca del body.

| Camino | Qué le pasa al reparto |
|---|---|
| `agregarLinea`, línea nueva | Una fila: responsable vigente × cantidad |
| `agregarLinea`, se junta con una existente | La cantidad agregada suma a la fila del responsable vigente en esa línea (la crea si no tiene) |
| `actualizarLinea`, **sube** | La diferencia suma a la fila del responsable vigente |
| `actualizarLinea`, **baja** | La diferencia **se descuenta** (regla de abajo) |
| `anularLinea` (vía `escribirAnulacionDeLinea`) | La cantidad anulada se descuenta (regla de abajo) |
| `cancelarConMotivo` | **No** descuenta: corre por N líneas despachadas y `escribirAnulacionEnLinea` se llama una vez por línea, así que descontar ahí adentro sería un SELECT + UPDATE de más por línea (N+1); la cuenta queda cancelada y todas sus líneas se borran en la misma operación, y nadie vuelve a leer el reparto de una línea de una cuenta cancelada (ronda de fix 1, domain review) |
| `quitarLinea` | Nada: la línea se borra y su reparto deja de leerse con ella |
| `fusionarCuentas`, la línea se **mueve** a la cuenta destino | Nada: el reparto cuelga de la línea, no de la cuenta |
| `fusionarCuentas`, la línea **se junta** con una del destino | Cada fila del origen suma a la fila del mismo garzón en la línea destino, o se re-apunta a la línea destino si no tiene; las filas absorbidas se marcan borradas. Por lotes, no una consulta por fila |
| `cerrarCuenta` | Nada: la cuenta cerrada ya no se edita, el reparto queda congelado |

**Regla de descuento** (bajar la cantidad o anular): primero sale de la fila del **responsable
vigente**; si no alcanza, de las demás filas en orden de **`creado_el` descendente** (la más reciente
primero; desempate por id). Es una regla técnica, no de negocio: bajar la cantidad solo se puede sobre
lo no despachado (el guard de cocina), que en la práctica es la corrección de quien tiene la mesa; y una
anulación no mueve el total pedido de nadie de forma que se cuente dos veces (§ 4.3).

## 4. El cálculo

### 4.1 Las tres cifras por garzón

Todo con Decimal.js, a `ESCALA_COSTO`, como proyección de lectura (no se persiste ni se redondea con la
configuración del tenant, igual que `precioCarta` del reporte):

- **Vendido** = Σ `ROUND(reparto.cantidad × cuenta_lineas.precio_unitario, 4)` de las líneas vivas de
  las cuentas **cerradas** con `cerrada_el` en el rango, cuya venta **no está cancelada**.
- **Anulado** = Σ `precioCarta` de **todas** sus anulaciones del rango (`cuenta_linea_anulaciones.creado_el`),
  **sin mirar los filtros de tipo ni de motivo**.
- **Pedido** = Vendido + Anulado.
- **Porcentaje** = `precioCarta` del grupo (las anulaciones **que pasan los filtros**) ÷ Pedido, como
  fracción decimal a `ESCALA_COSTO` (`0.0500` = 5%), igual que las variaciones de `resumen-negocio`.
  `null` si Pedido es 0 (solo pasa con ítems de precio 0; la pantalla muestra `—`).

El denominador no depende del filtro de tipo a propósito: con *Tipo = Cortesía*, el % pasa a ser
**cortesías sobre todo lo pedido**, no cortesías sobre (vendido + cortesías). Así los % de los tres tipos
suman el % total.

### 4.2 Qué entra y qué no

| Caso | Vendido | Anulado |
|---|---|---|
| Cuenta cerrada en el rango | ✅ | Sus anulaciones, por su fecha |
| Cuenta **abierta** | ❌ hasta que se cierra | ✅ sus anulaciones ya hechas |
| Cuenta cancelada (con o sin motivo) | ❌ no vendió nada | ✅ sus anulaciones |
| Cuenta cerrada cuya venta se **canceló** | ❌ | ✅ |
| Nota de crédito posterior | **No resta** (§ 6; decidido el 2026-10-03) | — |
| Cuenta, mesa o salón borrados después | ✅ ya pasó | ✅ (ya era así) |
| Garzón dado de baja después | ✅ ya pasó | ✅ (ya era así) |

Las dos últimas filas son **excepciones deliberadas** al filtro de borrado, con su porqué escrito en la
consulta, igual que las del reporte (spec del reporte § 5.1). El reparto, la línea y la venta sí filtran
`eliminado_el IS NULL`.

### 4.3 Nada se cuenta dos veces

Σ Pedido de todos los garzones = (precio de carta de lo cobrado) + (precio de carta de todo lo anulado)
en el rango. Una anulación descuenta del reparto de la línea (y por eso sale de lo vendido de alguien)
y entra en lo anulado del garzón que tenía la mesa al anular. El test de la escena de § 7 lo afirma.

## 5. API y pantalla

### 5.1 `GET /api/salones/anulaciones/resumen` (cambia)

Mismo permiso (`Salones:Ver todas`), mismos filtros, mismo tope de rango. Cambia solo `porGarzon`:

```
porGarzon: [{
  garzonId | null, garzonNombre | null,
  platos, precioCarta, costo, sinValorizar,   // como hoy
  pedido,                                      // nuevo: Vendido + Anulado, ESCALA_COSTO
  porcentaje | null                            // nuevo: fracción decimal, ESCALA_COSTO
}]
```

- **Filas:** todo garzón con algo vendido en el rango, o con anulaciones en el rango (pasen o no los
  filtros). Un garzón sin anulaciones que pasen los filtros va con `platos` y `precioCarta` en 0 (`'0.0000'`),
  `costo: []`, `sinValorizar: 0` y `porcentaje` en 0. Con `garzonId`, solo esa fila.
- **Orden:** por nombre, *Sin garzón* al final (hoy el orden no está definido).
- **Consultas:** un número fijo. Se suman **dos agregaciones con `GROUP BY garzon_id`** —lo vendido
  desde el reparto, lo anulado sin los filtros de tipo/motivo—, o una sola si el plan lo resuelve así;
  nunca una por garzón ni por línea.
- `porTipo` y `porAutorizo` no cambian. `GET /salones/anulaciones` (el listado) no cambia.

Si hace falta un índice para la consulta de lo vendido (cuentas cerradas por fecha → líneas → reparto),
el plan lo mide con `EXPLAIN (ANALYZE, BUFFERS)` sobre datos bien repartidos antes de agregarlo, no lo
supone.

### 5.2 Pantalla `/salones/anulaciones`

La tabla **Por garzón** suma la columna **"% de lo pedido"** (`formatPorcentaje`; `—` si viene null).
Nada más cambia: las tarjetas, la tabla por autorizador y el detalle quedan como están. Tokens
semánticos, sin lógica en la página, a ancho de teléfono.

**La pantalla del salón (`salones/index.vue`) no cambia**: el reparto es invisible para el garzón.

## 6. Fuera de alcance

- **Las notas de crédito no restan de lo vendido.** Es lo fiscal, que va solo (`CLAUDE.md`, ADR-010).
  Se anota en `pendientes.md`. **Cerrado el 2026-10-03 como *no corresponde*:** el owner decidió que
  la nota no toca el %, porque mide lo anulado antes del cobro (`resueltos.md`).
- **Umbrales o semáforo por %**, exportar: ya estaban fuera (spec del reporte § 7).
- **Lo cobrado en vez de la carta:** descartado por el owner (§ 2). Si se reabre, exige enlazar
  `venta_detalles` con `cuenta_lineas`, que es el registro fiscal de la venta: un frente propio.
- **El día comercial que cruza la medianoche:** igual que en todos los listados (spec del reporte § 7).

## 7. Cómo se prueba

- **Unitarios:** la regla de descuento (responsable primero, después la más reciente, desempate por id;
  cantidades que cruzan filas); el cálculo del % (fracción a 4 decimales, null con pedido 0, el filtro de
  tipo mueve el numerador y no el denominador); la unión de filas (garzón solo con venta, solo con
  anulaciones filtradas afuera).
- **E2E de backend** (garzones propios del spec, **nunca Ana del seed**; pipe con `validacionGlobal()`):
  - **La escena del owner:** G1 abre y pide $40.000; se transfiere a G2; G2 pide $20.000 → cierra →
    `pedido` G1 = 40.000 y G2 = 20.000;
  - **el "+" después de transferir:** G1 pide 2 cervezas, transfiere, G2 hace `PATCH` a 3 → la tercera es
    de G2;
  - **sumar desde el catálogo después de transferir** junta la línea y la unidad nueva es de G2;
  - bajar la cantidad y anular descuentan según la regla; Σ reparto = cantidad de la línea en cada paso;
  - **fusión** de dos cuentas de garzones distintos con una línea que se junta: cada uno conserva lo suyo;
  - el % exacto con una cortesía; el filtro de tipo cambia el % y no `pedido`; un garzón que vendió sin
    anular aparece con 0%; una cuenta abierta no suma a lo vendido; una cuenta cancelada con motivo suma
    solo a lo anulado; Σ `pedido` = carta cobrada + carta anulada (§ 4.3).
- **Mutantes que revierten cada decisión**, medidos fila por fila: el reparto al creador de la línea en
  vez del responsable vigente (mata el test del "+"); el denominador sin lo anulado (revierte "sobre lo
  pedido"); el denominador con el filtro de tipo; la fusión sin mover el reparto; la regla de descuento
  al revés; la fila del garzón sin anulaciones descartada (revierte el 0% de Carla).
- **Frontend:** spec de la página (la columna, `—` con null) y smoke en navegador antes de cerrar.

## 8. Documentación que cambia

- `docs/features/salones-mesas.md`: el reparto (tabla, quién lo escribe, la regla de descuento) y el %
  del reporte.
- `docs/PRODUCTO.md`: la regla del % (reparto, carta, sobre lo pedido), si el reporte de anulaciones
  está descrito ahí.
- `docs/ESTADO.md`: la fila del reporte.
- `docs/agent/pendientes.md`: la entrada sale a `resueltos.md`; entra la de las notas de crédito (§ 6).
- `startup-pos.sql`: la tabla.
