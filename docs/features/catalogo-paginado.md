# Feature: Catálogo paginado en el servidor

**Status**: Fase A completa (grilla de venta: POS, salón, tienda). Fase B (selectores) pendiente.
**Owner**: —
**Last Updated**: 2026-10-03

El diseño y las decisiones (quién las tomó y cómo) están en la spec
[`2026-10-03-catalogo-paginado-design.md`](../superpowers/specs/2026-10-03-catalogo-paginado-design.md).
Esta página es la regla viva: el porqué y lo que no se puede deshacer sin romper algo.

---

## Overview

### What is it?

La grilla donde se elige qué vender (POS, salón, tienda) muestra **páginas numeradas de 48
ítems**, y el buscador consulta al servidor. El orden (lo pedible primero, después por nombre) lo
pone el servidor.

### Why does it exist?

`MAX_PAGE_SIZE` es 100 y las pantallas pedían `GET /items?pageSize=100` sin paginar: el ítem 101
no llegaba y nada lo avisaba, así que **no se podía vender**. El buscador filtraba en el navegador
sobre lo que había llegado, por lo que tampoco lo encontraba. El salón, además, volvía a pedir
tres listados completos en cada toque sobre la cuenta abierta.

### Scope

- Incluido (fase A): `GET /items` con `tipo` como lista, `ids`, `modoInventario` y
  `orden=disponibilidad`; índice por tenant; `useCatalogoVenta` y `CatalogoGrid` paginado;
  refresco del salón en un solo pedido.
- Pendiente (fase B): los selectores de configuración e inventario (componentes de combo,
  promociones, grupos de modificadores, mermas, traslados, recuentos, suscripciones) siguen
  leyendo una lista de 100. Pasan a buscar en el servidor.
- Fuera: `GET /compras/productos`, que no pagina (el problema contrario).

---

## API — `GET /items`

Todo lo nuevo es opcional: sin los parámetros nuevos la respuesta es la de siempre (orden por
nombre, un solo `tipo`).

| Parámetro | Qué hace |
|---|---|
| `tipo` | Acepta una lista separada por comas (`tipo=producto,receta,combo`). Cada valor se valida contra los tipos; uno inválido o la lista vacía dan 400. |
| `ids` | Lista de UUID separados por comas, máximo 100. Respeta el resto de los filtros, también el de borrado: un ítem borrado no vuelve. |
| `modoInventario` | `cantidad`, `lote` o `serie`. |
| `orden` | `nombre` (default) o `disponibilidad`. |

`pageSize` sigue topado en 100. La grilla pide 48.

### El orden `disponibilidad`

1. Primero lo **pedible**: producto o ingrediente con `stockDisponible > 0`; receta o combo con
   `disponible ?? 1 > 0`. Cualquier otro tipo cuenta como no pedible.
2. Después el nombre, con `Intl.Collator('es')`.
3. Después `item_id`, para que el orden sea total y no cambie de una página a la otra.

Es el orden que la grilla calculaba en el navegador. Se **conservó** (no se pasó a "solo por
nombre") porque es la conducta vigente y cambiarla era una decisión de producto que nadie pidió.

### Por qué se pagina en dos pasos y no en SQL

La disponibilidad de una receta o un combo, y lo comprometido por las cuentas abiertas (con
conversión de unidades), se calcula en TypeScript. Copiarlo a SQL sería una segunda verdad que
deriva de la primera, así que el orden no puede ser un `ORDER BY`. Entonces
(`findAllPorDisponibilidad`, con el orden en `catalogo-orden.ts`):

1. **Paso 1:** una consulta liviana trae `item_id`, `tipo`, `nombre` y el stock del local de
   **todos** los ítems que pasan el filtro. Con eso se calcula la disponibilidad, se ordena y se
   corta la página. El total es el largo de esa lista, sin un `COUNT` aparte.
2. **Paso 2:** `baseQuery` + `mapRow` completa solo las filas de la página (los mismos campos que
   el listado de siempre, `modoInventario` incluido), en el orden del paso 1 y reusando la
   disponibilidad ya calculada. Repite el criterio de borrado del paso 1 (vivos; con
   `incluirEliminados`, también los que borró una persona).

La cantidad de consultas no crece con la página ni con el catálogo; lo que crece con el catálogo
es la cantidad de filas del paso 1. El patrón general está en
[`patterns/backend.md`](../patterns/backend.md) § 10.

### Índice

`idx_items_tenant_tipo_vivo` sobre `(tenant_id, tipo) WHERE eliminado_el IS NULL`, en la entity.
Hasta esta fase `items` no tenía ningún índice por tenant y cada listado hacía seq scan de la
tabla entera, con todos los tenants.

### Sin `pg_trgm`

La búsqueda (`nombre ILIKE` o `descripcion ILIKE`) usa ese índice y recorre las filas del tenant.
Medido con 5.454 vendibles en el tenant y 45.000 de otro: 3,1 ms. Una extensión es una dependencia
nueva y hoy no hace falta. **Reconsiderar** si un tenant real supera ~50.000 ítems o si la
búsqueda pasa de 20 ms en producción.

### Medido (2026-10-03, Postgres propio del worktree, catálogo sintético)

| Pedido | Mediana |
|---|---|
| `orden=disponibilidad`, página de 48 | 68,9 ms |
| `orden=disponibilidad&search=leche` | 11,2 ms |
| el listado viejo `tipo=producto&pageSize=100` | 30,7 ms |

---

## Frontend

- **`useCatalogoVenta({ tipos, filtros?, onError? })`** (`app/composables/useCatalogoVenta.ts`):
  expone `items`, `total`, `page`, `busqueda`, `loading`, `cargar()` y `refrescar()`.
  - 48 por página; espera 300 ms después de la última tecla; cambiar la búsqueda vuelve a la
    página 1; si la página queda más allá de la última, vuelve a la última y pide de nuevo.
  - **Un contador de turno** descarta la respuesta vieja que llega tarde.
  - **Una carga que falla no borra la grilla** que ya estaba en pantalla. Avisar lo decide la
    pantalla con `onError`: POS y tienda muestran toast; el salón no (el 403 del garzón sin
    `Items:Leer` no es un error para él).
  - `filtros` es el query fijo de cada pantalla (hoy ninguna lo usa: queda reservado para el filtro que agregue el frente de números de serie, que tiene que vivir en `buildFindAllFilters`).
- **`CatalogoGrid.vue`** es presentacional: ya no filtra ni ordena. Recibe `v-model:busqueda`,
  `v-model:page`, `total` y `pageSize`, y muestra `UPagination` cuando hay más de una página.
- **El stock local** (`descontarStockCatalogo`, sin cambios de firma) se aplica sobre la página
  visible. Un ítem que el carrito deja en 0 **se atenúa en su lugar y no salta al final**: el
  orden lo pone el servidor, que no ve el carrito. Tras cobrar, el POS conserva ese descuento y
  no pide de nuevo.
- **No cambian** `onCatalogoAdd`, la forma de `ItemCatalogo` ni el carrito (coordinado con el
  frente de serie, que toca el carrito y el cobro de las mismas pantallas).

### Refresco del salón

Cada toque sobre la cuenta abierta refresca la disponibilidad (el `watch` de la firma de la
cuenta, con su debounce de 250 ms). Antes eran tres `GET /items` (producto, receta, combo) de
hasta 100 cada uno; ahora es **uno, de la página visible**. Medido con el mismo catálogo sintético:
32.559 B contra 200.707 B (la suma de los tres viejos).

Se pide la página entera y no solo los números de disponibilidad porque, con el orden en el
servidor, la posición de un ítem depende de su disponibilidad: refrescar solo los números dejaría
el orden viejo en pantalla. Un ítem que se queda sin stock puede pasar a otra página, igual que
antes pasaba al final de la lista.

---

## Selectores de configuración e inventario (fase B — pendiente)

Siguen cargando una lista de 100 como opciones y como mapa `id → ítem`. Cuando se haga, esta
sección se completa con la forma real; el problema que resuelven (costos de combo y receta que se
calculan de menos, ids sin nombre en promociones, el link de traslados que cae a modo `cantidad`)
está en la spec § 1 y § 5.

---

## Testing

- Backend unitario: `catalogo-orden.spec.ts` (el orden, incluido el disponible negativo y el
  desempate), `query-items.dto.spec.ts`, `items.service.spec.ts`.
- Backend e2e: `npm run test:e2e -- catalogo-paginado` (105 productos: recorre las páginas sin
  repetir ni saltear; el 101 se encuentra por búsqueda y se vende).
- Frontend: `useCatalogoVenta.nuxt.spec.ts` (turnos, el fallo no borra, página fuera de rango) y
  los specs de `CatalogoGrid` y de cada pantalla.
- Playwright: `frontend/e2e/ventas/catalogo-paginado.spec.ts` (POS como cajera, página 3, 375 px,
  salón).

---

## Related Features

- [ventas.md](./ventas.md) — POS
- [salones-mesas.md](./salones-mesas.md) — el salón y su refresco
- [tienda-online.md](./tienda-online.md) — la tienda
- [recetas.md](./recetas.md) — de dónde sale `disponible`
