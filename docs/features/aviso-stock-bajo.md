# Feature: Aviso de stock bajo (punto de reorden)

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-09-21

Diseño: [spec](../superpowers/specs/2026-09-21-aviso-stock-bajo-design.md) ·
[plan](../superpowers/plans/2026-09-21-aviso-stock-bajo.md). Decisiones del owner (2026-09-20)
con el caso que justifica cada una: `docs/agent/resueltos.md`, entrada "Aviso de stock bajo".
Investigación de mercado cruzada:
[`2026-09-20-aviso-stock-bajo-punto-reorden.md`](../agent/investigaciones/2026-09-20-aviso-stock-bajo-punto-reorden.md).

---

## Overview

### What is it?

Un **mínimo por producto y ubicación**. Cuando el saldo de ese lugar queda por debajo, el sistema
avisa en dos lugares con trabajos distintos:

- **El bloque "Stock bajo" del inicio** contesta *"¿tengo que hacer algo antes de abrir?"*: un
  número y las hasta 4 ubicaciones más afectadas. **No es una lista y no crece**: 40 productos
  abajo ocupan lo mismo que 6.
- **La pantalla `Inventario → Stock mínimo`** es la lista completa —el usuario vino a buscarla—
  con la marca por fila, y es donde se carga el mínimo.

Cuando hay stock del mismo producto en otra ubicación, la fila ofrece el **traslado precargado** a
quien puede crearlo, y a quien no, le dice dónde está la mercadería sin darle el botón.

### Why does it exist?

El caso que decide que sea por lugar y no por producto: 3 cajas de cerveza en la bodega y 0 en
el local es stock bajo, porque el barman no tiene qué servir. Un mínimo por producto suma los dos
lugares y no avisa nada.

### Scope

- Incluido: mínimo manual por (producto, ubicación), las dos lecturas, el traslado precargado, y
  "lo ya pedido deja de urgir".
- **Fuera**: el mínimo sugerido o calculado (el esquema deja lugar, nada lo calcula), la orden de
  compra a proveedor, cualquier "silenciar por N días" o "descartar este aviso" (descartado
  explícitamente por el owner), y el vencimiento como señal — *¿me estoy quedando sin esto?* y
  *¿se me está por vencer?* son dos preguntas distintas.

---

## Reglas

- **Nace vacío.** Sin mínimo cargado no hay aviso: no hay que llenar 400 números el primer día.
  *Sin fila* en `stock_minimo` es "nunca se cargó"; una fila con `0` es un cero puesto a propósito
  y se distingue.
- **Cuenta unidades del saldo** (`stock_ubicacion`), igual para los modos `cantidad`, `serie` y
  `lote`. Bajo el mínimo es **estrictamente menor**: igual no avisa. Un producto que nunca se movió
  en esa ubicación cuenta 0.
- **Producto e ingrediente**: los dos tipos con stock (fila en `item_producto`). Un ingrediente es
  justo lo que se acaba en una cocina.
- **Lo ya pedido deja de urgir.** Una compra en **borrador** con ese producto para esa ubicación lo
  saca del número del inicio, y en la lista lo marca *"bajo el mínimo · en camino"*. Una compra
  **confirmada** ya movió el stock: si igual quedó abajo, lo que llegó no alcanzó y **vuelve a
  urgir**. Una **anulada** no trae nada. Se evalúa en vivo: sacar la línea del borrador o
  descartarlo lo devuelve. ⚠️ Una compra acá es "cargar lo que llegó" (`compras.md`), no una orden
  a proveedor: el borrador es lo más parecido a "en camino" que el sistema tiene hoy.
- **El mínimo nunca se borra por cascada; lo que cambia es si se evalúa.** Un producto en la
  papelera o una bodega eliminada dejan de avisar por los filtros de borrado de las lecturas, y al
  restaurar vuelven con el mínimo que tenían. Una **bodega desactivada** tampoco avisa ni se lista
  —desactivarla dice "acá ya no repongo"—, pero acepta y guarda el mínimo. La asimetría: una
  bodega desactivada **sigue siendo origen** del traslado sugerido, como en traslados.
- **Quién puso el número** queda en `origen` (`'manual'`/`'sistema'`). Hoy todo es `'manual'`:
  ningún endpoint acepta `origen` en el body. La columna existe para que un mínimo sugerido no
  pise lo que alguien decidió a mano, sin migrar el esquema ese día.

### Permisos

| Acción | Permiso | Por qué |
|---|---|---|
| Ver el bloque y la pantalla | `Inventario:Leer` | la pantalla entera va por el middleware `permiso` |
| Cargar o limpiar el mínimo | `Inventario:Actualizar` | política de reabastecimiento, como `ajustes-costo`: quien edita el catálogo no es necesariamente quien decide cuánto stock hace falta |
| Trasladar desde la fila | `Inventario:Crear` | el de traslados; sin él, la fila informa sin botón |

El bloque del inicio tiene ruta propia y no viaja en `/resumen-negocio/hoy`, que pide otro permiso.
Los roles del seed que separan las dos escrituras son `aprobador@paris.cl` (Leer + Actualizar) y
`contador@paris.cl` (Leer + Crear); el e2e de navegador corre con ellos.

### La palanca contra el ruido que no se ve en la pantalla

**Desactivar una bodega de temporada apaga todos sus avisos sin perder un solo mínimo**:
reactivarla la vuelve a vigilar con los números de antes.

---

## API Endpoints

Todos con `JwtAuthGuard + TenantGuard + PermisosGuard`; el tenant sale del token.

```
GET /api/inventario/stock-minimo?page=&pageSize=&soloBajoMinimo=true&ubicacionId=&search=
  Inventario:Leer — cada producto × ubicación activa, con o sin mínimo. Orden: bajo el mínimo
  primero, las "en camino" después de las urgentes, luego por nombre.
  { data: StockMinimoFila[], meta }

PUT /api/inventario/stock-minimo/:itemId/:ubicacionId      { "minimo": "6" | null }
  Inventario:Actualizar — null limpia (soft-delete); volver a cargar revive la fila.
  400 si el ítem no tiene stock ("El item no tiene control de stock") o el mínimo no es un
  decimal sin signo de hasta 14 enteros y 4 decimales; 404 si la ubicación no es del tenant.
  200 con la fila recalculada, o vacío si el par no se lista (bodega desactivada).

GET /api/inventario/stock-bajo/resumen
  Inventario:Leer — { total, porUbicacion: [{ ubicacionId, ubicacionNombre, cantidad }] } (≤ 4)
```

`StockMinimoFila`: `itemId`, `itemNombre`, `ubicacionId`, `ubicacionNombre`, `unidadMedida`,
`minimo` (`null` si no se cargó), `origen`, `stock`, `bajoMinimo`, `enCamino`, `origenSugerido`
(la otra ubicación con más stock, solo en filas bajo el mínimo; `null` si no hay).

---

## Backend

- **Tabla** `stock_minimo` (`inventario/entities/stock-minimo.entity.ts`): PK `(item_id,
  ubicacion_id)`, `minimo numeric(18,4)` con CHECK `>= 0`, `origen` con CHECK, timestamps y
  `eliminado_el`. Sin `tenant_id` propio: se acota por `JOIN` a `items` y `ubicaciones`. Tabla
  propia y no columna de `stock_ubicacion`, cuyo único escritor es el chokepoint de movimientos y
  cuya fila puede no existir todavía.
- **`InventarioService`**: `upsertMinimo` (valida ítem con stock y ubicación contra el tenant en
  una consulta, upsert que revive — `docs/patterns/backend.md` § 14b), `findStockMinimo` /
  `setMinimo` (comparten `fromStockMinimo`: `COUNT`, página, y el origen sugerido en batch para
  toda la página), `resumenStockBajo` (una consulta: agrupa por ubicación y el total sale de una
  ventana sobre todos los grupos, evaluada antes del `LIMIT 4`). Las condiciones "bajo el mínimo"
  y "en camino" viven una sola vez (`BAJO_MINIMO_SQL`, `EN_CAMINO_SQL`) y las usan las dos lecturas.

**Medido, a vigilar si el volumen crece** (ninguno es N+1 ni afecta el resultado):

- El "en camino" del listado es un `SubPlan` **hasheado**, construido una vez por request, no por
  fila (9.072 filas cruzadas, 10,6 ms). Se construye con seq scan porque `compra_lineas.item_id`
  y `compras (tenant_id, estado, ubicacion_id)` no tienen índice.
- El resumen recorre `stock_minimo` entero antes de filtrar por tenant (la tabla no tiene esa
  columna). Hoy es submilisegundo y es una tabla de configuración, no transaccional.

## Frontend

- **`pages/inventario/stock-minimo.vue`** + `composables/useStockMinimo.ts` (guardar, detectar "sin
  cambio" con `Decimal`, y armar la ruta del traslado). El mínimo se edita en la fila y se guarda
  al salir del campo o con Enter; la fila se reemplaza por la que devuelve el `PUT`, sin recargar
  la página ni derivar la marca en el cliente. Si el guardado falla, el campo vuelve al valor
  guardado y no se reintenta solo (el usuario lo vuelve a tipear); si la respuesta llega después
  de cambiar de página o de filtro, se descarta. Link en el menú, dentro del bloque de Inventario.
- **`components/inicio/InicioStockBajo.vue`**, en la zona **"Ahora"** del inicio —el stock cambia
  con cada venta, igual que salón y cajas— con `useRefrescoPeriodico`. Lleva a la pantalla con
  `?soloBajoMinimo=true`.
- **Traslado precargado**: reusa el de `useRechazoPorStock`, con una extensión retrocompatible:
  `traslados.vue` acepta un `destinoId` opcional en la query, porque la ubicación baja puede ser
  una bodega. Sin él sigue cayendo al local, que es lo correcto para el rechazo de venta. La
  cantidad precargada es lo que falta para el mínimo, sin pasarse de lo que hay en el origen.

## Tests

- `backend/test/stock-minimo.e2e-spec.ts` — listado y `PUT`: cada distinción (con/sin mínimo, sin
  fila de saldo, borrador/confirmada/editada/descartada, los tres modos, bodega desactivada,
  papelera, aislamiento por tenant, permisos con rol real) tiene un caso que mata su mutante.
- `backend/test/stock-bajo-resumen.e2e-spec.ts` — corre en el **segundo tenant sembrado**, porque
  el resumen cuenta todo el tenant y la suite del listado deja pares abajo en Paris. Incluye la
  prueba del ruido: 6 ubicaciones afectadas → 4 filas, total 21 contra 18 detallados.
- `frontend/app/pages/inventario/stock-minimo.nuxt.spec.ts`,
  `components/inicio/InicioStockBajo.nuxt.spec.ts`, `pages/inventario/traslados.nuxt.spec.ts`.
- `frontend/e2e/inventario/stock-minimo.spec.ts` — navegador, con `aprobador` y `contador`.

---

## Lo que queda por medir después de construido: que el bloque no sea ruido

Es la única decisión del owner que **no tiene precedente**: los POS relevados bajan el ruido sobre
avisos que llegan y se pueden ignorar (digest diario de Square y Bsale, colchón de Toast), y
ninguno documenta cómo hacerlo sobre una marca fija y siempre visible como esta.

**La prueba:** si el primer día de uso real el bloque dice *"40 bajo el mínimo"*, es ruido y hay
que ajustar. La propiedad que el código ya sostiene es que el bloque no crece; lo que no puede
sostener es que el número sea chico, porque eso depende de qué mínimos cargue la gente.

**Las palancas que ya sabemos que existen**, para no reinvestigarlas:

1. **Agrupar por ubicación** (Square y Bsale en sus resúmenes) — ya construida: el bloque muestra
   ubicaciones, no productos.
2. **Desactivar la bodega que no se repone** — ya construida, sin costo (ver arriba).
3. Si con eso no alcanza, lo que sigue es de producto y se le pregunta al owner: un colchón sobre
   el mínimo antes de avisar (Toast), o un corte por criticidad. No un botón de descartar.
