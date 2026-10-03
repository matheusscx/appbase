# El catálogo se pagina en el servidor y el buscador consulta al servidor

**Fecha:** 2026-10-03 · **Tipo:** spec de diseño
**Frente:** 🔺 *"las pantallas de venta cargan solo los primeros 100 ítems de cada tipo, y un
producto 101 no se puede vender"* ([`pendientes.md`](../../agent/pendientes.md) § 3). Absorbe la
entrada hermana *"El refresco del catálogo del salón baja ~133 KB…"* (misma § 3).
**Decisiones:** § 2. Cada una dice quién la tomó y cómo.

---

## 1. El problema

`MAX_PAGE_SIZE = 100` (`backend/src/common/utils/pagination.util.ts`) y 22 llamadas en 11
pantallas piden `GET /items?pageSize=100` **sin paginar**: el ítem 101 no llega y nada lo avisa.
Así queda cada grupo de pantallas:

- **Las que venden.** POS (`pages/ventas/pos.vue`) y salón (`pages/salones/index.vue`) piden tres
  tipos por separado (producto, receta, combo; hasta 100 de cada uno) y los juntan en
  `VentasCatalogoGrid`. La tienda (`pages/tienda/index.vue`) usa la misma grilla con
  `tipo=producto`. El buscador de la grilla (`CatalogoGrid.vue`, `filtrados`) filtra **en el
  navegador** sobre lo que llegó, así que el producto 101 no se encuentra nunca. El orden de la
  grilla (pedibles primero, después por nombre: `compararCatalogo`) también se calcula en el
  navegador.
- **El salón además refresca de más.** Cada toque sobre la cuenta abierta vuelve a pedir los tres
  `GET /items` (~133 KB sin comprimir con 100 + 60 + 20 ítems), y de todo eso solo cambian tres
  campos.
- **Selectores.** Usan la lista cargada como opciones de un `USelectMenu` y, en varias pantallas,
  como mapa `id → ítem` para leer campos del elegido:
  - `mermas.vue`, `inventario/index.vue`, `inventario/recuentos/index.vue`,
    `inventario/traslados.vue`, `tienda/suscripciones.vue`;
  - en configuración: `items.vue` (componentes de combo, ingredientes, extras),
    `promociones.vue` (alcance), `grupos-modificadores.vue` (opciones).

  Hoy ningún selector del proyecto busca en el servidor.

**Bugs que hoy esconde el tope** (relevados el 2026-10-03). Con un ítem fuera de los 100:

- `configuracion/items.vue` calcula de menos, en silencio, el costo del combo
  (`costoComboPreview`: `it?.costoActual ?? '0'`) y el de la receta (`costoRecetaCalculado`:
  `if (!prod) continue`).
- `grupos-modificadores.vue` saltea la validación por familia de esa fila.
- `promociones.vue` muestra los ids del alcance sin nombre.
- El link directo de `traslados.vue` (`?itemId=`, que sale del toast de rechazo por stock) cae a
  `modoInventario = 'cantidad'`, aunque el ítem vaya por serie o por lote.
- `recuentos` filtra `modoInventario === 'cantidad'` **después** del tope.

**Medido (2026-10-03, Postgres propio del worktree).** Datos sintéticos: 45.000 productos de otro
tenant de relleno y, en el tenant medido, 5.002 productos, 305 ingredientes, 601 recetas con 4
ingredientes cada una y 101 combos de 3 componentes; ~30 % sin stock.

- **`items` no tiene ningún índice por `tenant_id`**: solo la PK y el único parcial del ítem de
  ajuste. Cada `GET /items` hace seq scan de la tabla entera, con todos los tenants.
- **Leer todos los vendibles del tenant con su stock del local:** 13,9 ms hoy; 2,0 ms con índice
  `(tenant_id, tipo) WHERE eliminado_el IS NULL` y `LEFT JOIN stock_ubicacion` en vez de
  subconsulta.
- **`nombre ILIKE '%leche%' OR descripcion ILIKE '%leche%'`:** 7,3 ms hoy, 3,1 ms con el índice
  (el filtro recorre las ~5.700 filas del tenant).
- **Ingredientes bloqueantes de las 601 recetas** (la consulta 2 de
  `calcularDisponibilidadBatch`): 6,5 ms, 2.401 filas.

## 2. Decisiones

| # | Decisión | Quién y cómo |
|---|---|---|
| 1 | La grilla se pagina en el backend (nada de traer todas las páginas) y el buscador consulta al servidor. | Owner, 2026-09-28, contestando a la orquestadora (citado en la entrada). |
| 2 | **Páginas numeradas**, no scroll infinito: `UPagination` abajo de la grilla, 48 ítems por página. | Owner, 2026-10-03, por pregunta con las dos opciones y su costo (con scroll infinito, el refresco del salón vuelve a pedir todo lo ya cargado, y un cambio de stock entre dos cargas puede repetir o saltear ítems). |
| 3 | Diseño aprobado: el orden "pedibles primero" se calcula en el servidor, el refresco del salón entra en este frente, los selectores buscan en el servidor y la entrega va en dos commits. | Owner, 2026-10-03, por pregunta sobre el diseño presentado en el chat. |
| 4 | Se **conserva** el orden de hoy (pedibles primero, después por nombre) y pasa al servidor, en vez de ordenar solo por nombre. | Técnica (agente). Es la conducta vigente (`CatalogoGrid.nuxt.spec.ts` la fija), y cambiarla sería una decisión de producto que nadie pidió. |
| 5 | Sin `pg_trgm`. Índice btree parcial `(tenant_id, tipo)`. | Técnica (agente), medido en § 1: 3 ms por búsqueda con 5.700 ítems en el tenant. Una extensión es una dependencia nueva (`CLAUDE.md`). Se reconsidera si un tenant real supera ~50.000 ítems o si la búsqueda pasa de 20 ms en producción. |
| 6 | El refresco del salón vuelve a pedir **la página visible**. Se descarta el pedido liviano de solo disponibilidad que proponía la entrada de los 133 KB. | Técnica (agente): con el orden en el servidor, la posición de un ítem depende de su disponibilidad, y refrescar solo los números dejaría el orden viejo en pantalla. |

## 3. Backend — `GET /items`

Todo lo nuevo es opcional: sin los parámetros nuevos, la respuesta es exactamente la de hoy.

### 3.1 Parámetros nuevos o ampliados (`QueryItemsDto`)

- **`tipo`** acepta una lista separada por comas (`tipo=producto,receta,combo`), y cada valor se
  valida contra los seis tipos. Un valor solo sigue funcionando igual. El SQL pasa a
  `i.tipo = ANY($n)`. Precedente de parseo: `parseTurnoIds` en
  `propinas/dto/query-propina-reporte.dto.ts`.
- **`ids`**: lista de UUIDs separados por comas, con un máximo de 100 (`ArrayMaxSize`). Filtra
  `i.item_id = ANY($n)` y respeta el resto de los filtros, también el de borrado. Lo usan los
  selectores para mostrar el nombre de un valor ya elegido. Un ítem borrado no vuelve; es la
  conducta de hoy.
- **`modoInventario`**: `cantidad`, `lote` o `serie`. Va con `EXISTS (SELECT 1 FROM item_producto
  …)` y no con alias del `JOIN`, porque el mismo `where` alimenta el `COUNT` sin joins (mismo
  motivo que `sinCosto`).
- **`orden`**: `nombre` (el default, el de hoy) o `disponibilidad`.

### 3.2 `orden=disponibilidad`

Es el orden de `compararCatalogo`, ahora calculado en el servidor:

1. **Primero lo pedible**:
   - producto o ingrediente con `stockDisponible > 0`;
   - receta o combo con `disponible ?? 1 > 0`;
   - cualquier otro tipo cuenta como no pedible, igual que hoy en el cliente.
2. **Después por nombre**, con `Intl.Collator('es')`, el mismo criterio que el `localeCompare(…, 'es')`
   de hoy.
3. **Desempate por `item_id`**, para que el orden sea total y no cambie entre una página y la
   siguiente.

No se puede hacer en SQL: lo comprometido por las cuentas abiertas (`comprometidoPorItem`) se
calcula en TypeScript, con conversión de unidades. Una copia en SQL sería una segunda verdad que
deriva de la primera. Entonces el servicio trabaja en dos pasos:

- **Paso 1:** una consulta liviana trae `item_id`, `tipo`, `nombre` y el stock del local
  (`LEFT JOIN stock_ubicacion`) de **todos** los ítems que pasan el filtro. Con esas filas se
  llama a `calcularDisponibilidadBatch`, con la misma cantidad fija de consultas que hoy, se
  ordena y se corta la página.
- **Paso 2:** `baseQuery … WHERE i.item_id = ANY($ids)` completa solo esas filas, y se devuelven
  en el orden del paso 1, reusando los mapas de disponibilidad ya calculados (no se recalculan).

El total es el largo del paso 1, sin un `COUNT` aparte. La cantidad de consultas no depende del
tamaño de la página ni del catálogo; lo que crece con el catálogo es la cantidad de filas del
paso 1.

⚠️ **Lo que falta medir** es el tiempo total del servicio con el catálogo sintético de § 1. Es
la primera tarea del plan: si con 5.000 vendibles pasa de 100 ms, se para y se vuelve a decidir.

### 3.3 Índice

`@Index` en `Item` sobre `(tenant_id, tipo)` con `WHERE eliminado_el IS NULL`. Va en la entity,
no en el `.sql`: el esquema sale de las entities, y `startup-pos.sql` se actualiza a la par como
referencia.

## 4. Frontend — la grilla de venta (POS, salón, tienda)

- **`useCatalogoVenta({ tipos })`** (composable nuevo en `app/composables/`):
  - Expone `items`, `total`, `page`, `busqueda`, `loading` y `refrescar()`.
  - Pide `GET /items?tipo=<tipos>&activo=true&orden=disponibilidad&search=…&page=…&pageSize=48`.
  - Espera 300 ms después de la última tecla (precedente: `configuracion/items.vue`). Cambiar la
    búsqueda vuelve a la página 1.
  - Usa un contador de turno (precedente: `secuenciaItems` del salón): una respuesta vieja que
    llega tarde no pisa a la nueva.
  - **Una llamada que falla no borra lo que ya está en pantalla**, la regla vigente del salón.
    Avisar o no lo decide la pantalla: el POS y la tienda muestran toast en la carga inicial; el
    salón sigue en silencio por el 403 del garzón.
  - Si `page` queda más allá de la última página (por ejemplo, otro usuario pausó ítems), vuelve
    a la última y pide de nuevo.
- **`CatalogoGrid.vue`** deja de filtrar y de ordenar:
  - Recibe `v-model:busqueda`, `v-model:page`, `total` y `pageSize`, y muestra `UPagination`
    cuando `total > pageSize`.
  - Sigue atenuando (`sinStockVisual`) y sigue bloqueando el clic de lo que no tiene stock
    (`puedeAgregar`).
  - `compararCatalogo` y `filtrados` desaparecen. Sus tests de orden pasan al backend.
- **POS y tienda.** `descontarStockCatalogo(items, lineas)` queda igual, con la misma firma, y se
  aplica sobre la página visible. Un ítem que el carrito deja en 0 **se atenúa en su lugar y no
  salta al final**: el orden lo pone el servidor, que no ve el carrito. Después de cobrar, el POS
  conserva el descuento local de hoy y no pide de nuevo.
- **Salón.** El `watch` de la firma de la cuenta y el debounce de 250 ms quedan como están;
  `refrescarItems()` pasa a ser `refrescar()` del composable.
  - Por toque: 1 request en vez de 3, y bytes proporcionales a la página (~48 × 740 B ≈ 35 KB en
    vez de ~133 KB).
  - Un ítem que se queda sin stock puede pasar a otra página, igual que hoy pasaba al final de
    la lista.
- **Sin cambios** en `onCatalogoAdd`, en la forma de `ItemCatalogo` ni en el carrito. Así quedó
  coordinado con el frente de serie, que toca el carrito y el cobro de esas mismas pantallas.

## 5. Frontend — selectores con búsqueda en el servidor

- **Un caché por pantalla** (composable nuevo): un `Map` reactivo `id → ítem` con dos funciones.
  `buscar(termino, filtros)` guarda los resultados en el `Map` y devuelve sus ids.
  `resolver(ids, filtros)` pide `ids=…` solo de los que faltan, con un máximo de 100 por request.
  Es la única fuente de la que leen tanto el selector como las cuentas de la pantalla.
- **`AppItemSelect.vue`** (componente nuevo), un `USelectMenu` con estas propiedades:
  - `ignore-filter` y `v-model:search-term`, esperando 300 ms entre teclas, con `pageSize=20`;
  - `multiple`;
  - filtros fijos (`tipo`, `activo`, `modoInventario`) y una lista de ids a excluir (filas
    hermanas, el propio ítem);
  - una función de etiqueta (`nombre (tipo)`, `nombre (categoría)`, precio y frecuencia en
    suscripciones).

  Sus opciones son la **unión** de los resultados de la búsqueda con los ítems elegidos: sin eso,
  un valor elegido que no está en la página de resultados se ve sin nombre, por cómo funciona
  `valueKey`. En los selectores de filtro (`mermas`, `inventario`), el "Todos" pasa a ser el
  vacío, con botón para limpiar.
- **Al editar,** la pantalla llama a `resolver(ids)` con todos los ids que trae el registro antes
  de mostrar el formulario:
  - en `items.vue`, los componentes, los ingredientes y los extras;
  - en `promociones.vue`, los `itemIds` de cada alcance;
  - en `grupos-modificadores.vue`, las opciones;
  - en `traslados.vue`, el `?itemId=`.

  Así las cuentas (`costoComboPreview`, `costoRecetaCalculado`, `familiaDeItem`,
  `onSeleccionarItem`) leen el ítem verdadero, sin depender de que esté en los primeros 100.

  Lo único que `resolver` no trae es un ítem borrado (`ids` respeta el filtro de borrado). Ese
  caso conserva la conducta de hoy y no es parte de este frente.
- `recuentos` usa `modoInventario=cantidad` en el servidor, y suscripciones conserva su filtro
  `frecuencia`.

Las 11 pantallas comparten un solo patrón. La forma exacta del componente y del caché la fija la
primera pantalla del plan (`promociones.vue`: multiple + edición); las demás la copian.

## 6. Entrega

Son dos commits; el estado intermedio no es peor que el de hoy.

1. **Backend, grilla y salón:** § 3 y § 4.
2. **Selectores:** § 5. En este commit la entrada se muda a `resueltos.md`, junto con la de los
   133 KB, y se actualiza `docs/ESTADO.md`.

**Fuera de alcance:** `GET /compras/productos` (`pages/compras/[id].vue`) no pagina, es decir,
trae todo de una vez: el problema contrario. Queda anotado en el backlog.

## 7. Verificación

- **Backend unitario:** el orden de § 3.2 (los casos de `CatalogoGrid.nuxt.spec.ts` se mudan,
  incluido el disponible negativo), el desempate por id, la lista en `tipo`, `ids` y
  `modoInventario`.
- **Backend e2e:** paginar sin repetir ni saltear entre la página 1 y la 2 con
  `orden=disponibilidad`; el **producto 101 se encuentra por búsqueda y se vende**; `tipo` con un
  valor inválido en la lista da 400; `ids` con más de 100 da 400; aislamiento de tenant.
- **Frontend:** specs de `useCatalogoVenta` (turnos, el fallo no borra, cambiar la búsqueda
  vuelve a la página 1, la página fuera de rango vuelve a la última) y de `AppItemSelect` (unión
  con los elegidos, `resolver` al editar). Los specs de cada pantalla ajustan sus mocks.
- **Playwright** (gate de cierre), con un tenant de más de 100 productos: encontrar y vender el
  101 en el POS y en el salón; elegirlo en un selector de configuración. Se corre como el rol de
  cada módulo, no como admin.
- **Medición final:** el tiempo del servicio con `orden=disponibilidad` sobre el catálogo
  sintético, y los bytes del refresco del salón, publicados con el comando que los midió.
