# Feature: Gestión de Inventario (Kardex de Movimientos de Stock)

**Status**: Complete  
**Owner**: SDD Team  
**Last Updated**: 2026-07-26

---

## Overview

### What is it?

Un sistema de trazabilidad auditable para todos los cambios de stock en items de tipo **producto**. Cada movimiento de inventario (entrada, salida, ajuste) queda registrado en un kardex (`movimientos_inventario`) con su tipo, motivo, cantidad, usuario y saldo resultante. El stock materializado (`item_producto.stock`) se mantiene sincronizado con el kardex mediante transacciones DB, garantizando consistencia.

### Why does it exist?

El stock de productos es un activo crítico: cambios sin trazabilidad generan mermas ocultas, complicaciones en auditorías fiscales y dificultades para localizar discrepancias. El kardex es la fuente de verdad auditable; el saldo en `item_producto` es un cache materializado para lectura rápida y alertas.

### Scope

**Included in this version:**
- Registro de movimientos `entrada`/`salida` con motivos (`compra`, `venta`, `devolucion`, `anulacion`, `merma`, `ajuste_manual`, `inventario_inicial`, `recuento`)
- Endpoint `GET /inventario/movimientos` con filtros por item, motivo y rango de fechas
- Endpoint `PATCH /items/:id/stock` actualizado para registrar motivo + comentario
- Creación automática de movimiento `inventario_inicial` al crear un producto con stock > 0
- Integración con ventas: cada línea vendida genera `salida`/`motivo='venta'` de forma automática (transacción única)
- **`anulacion` vs `devolucion`** — anular una venta mal ingresada (`POST /ventas/:id/anular`)
  repone con `entrada`/`motivo='anulacion'`; que un cliente devuelva mercadería genera
  `motivo='devolucion'`. Son eventos distintos y el kardex los separa: confundirlos ensucia
  el análisis de mermas y no se recupera después.
- Integración con recuento de inventario: `POST /recuentos/:id/aplicar` genera un movimiento
  `entrada`/`salida` con `motivo='recuento'` por cada línea contada con diferencia — ver
  "Regla del recuento: delta, no absoluto" más abajo
- Vistas: modal "Historial" en `/configuracion/items` + página global `/inventario`
- Validación: `salida` rechaza movimientos que resultarían en stock negativo

**NOT included (future):**
- Bodegas / almacenes y stock por bodega
- Traspasos entre bodegas
- Integración con proveedores externos de inventario

Nota: el costeo por promedio ponderado móvil (CPP) de `item_producto.costo_actual` en la compra sí está implementado (ver "Regla de costo" más abajo); FIFO/LIFO no.

---

## API Endpoints

### GET /inventario/movimientos

Lista todos los movimientos de inventario del tenant actual, con opciones de filtro.

**`desde`/`hasta` aceptan fecha pura o timestamp, y no significan lo mismo.** Una fecha pura
(`2026-08-01`) se expande a la **medianoche de la zona horaria del tenant** —la que sale de
su **provincia**—, que es lo que espera quien mira el reporte; un timestamp completo
(`2026-08-01T15:30:00Z`) se respeta tal cual, al segundo. La lógica es compartida
(`src/common/utils/rango-fecha.util.ts`) con el listado de mermas y el de órdenes de
pasarela. Nunca castear el valor con `::date` para "normalizarlo": descarta la hora en
silencio y ensancha el filtro de cualquier llamador que sí la mande.

```
GET /api/inventario/movimientos?itemId=<uuid>&motivo=<string>&desde=<ISO-8601>&hasta=<ISO-8601>&skip=0&take=50

Authorization: Bearer <token>

Response (200):
{
  "data": [
    {
      "movimiento_id": "uuid",
      "item_id": "uuid",
      "item_nombre": "Smartphone XYZ",
      "tipo": "entrada",
      "motivo": "compra",
      "cantidad": 10,
      "stock_anterior": 15,
      "stock_resultante": 25,
      "usuario_nombre": "Juan Admin",
      "comentario": "Reorden semanal",
      "venta_id": null,
      "creado_el": "2026-06-23T14:30:00Z",
      "actualizado_el": "2026-06-23T14:30:00Z"
    },
    {
      "movimiento_id": "uuid",
      "item_id": "uuid",
      "item_nombre": "Smartphone XYZ",
      "tipo": "salida",
      "motivo": "venta",
      "cantidad": 1,
      "stock_anterior": 25,
      "stock_resultante": 24,
      "usuario_nombre": "Vendedor Carlos",
      "comentario": null,
      "venta_id": "uuid-venta",
      "creado_el": "2026-06-23T14:35:00Z",
      "actualizado_el": "2026-06-23T14:35:00Z"
    }
  ],
  "total": 45,
  "skip": 0,
  "take": 50
}
```

**Query Parameters:**
- `itemId` (optional): Filtrar por item UUID
- `motivo` (optional): Filtrar por motivo exacto (`compra`, `venta`, `devolucion`, `merma`, `ajuste_manual`, `ajuste_costo`, `inventario_inicial`, `recuento`)
- `desde` (optional): ISO-8601, filtrar movimientos a partir de esta fecha
- `hasta` (optional): ISO-8601, filtrar movimientos hasta esta fecha
- `skip` (optional, default 0): Paginación
- `take` (optional, default 50): Cantidad por página

Cada item de `data` incluye `costoAnterior: string | null` — el `costo_actual`
vigente antes del movimiento. Solo se popula cuando `motivo='ajuste_costo'`
(ver "Regla de costo" más abajo); `null` en el resto. El frontend lo usa para
mostrar "anterior → nuevo" en el historial de un ajuste de costo.

También incluye `monedaId: string` — la moneda del **ítem**, que es en la que
está expresado su costo. El kardex global mezcla productos de distintas
monedas, así que sin este campo la UI formatearía todo costo con la moneda
oficial del tenant y mostraría un costo en USD con símbolo y decimales de CLP.

---

### PATCH /items/:id/stock

Ajusta manualmente el stock de un producto, generando un movimiento de `entrada` o `salida` según corresponda.

```
PATCH /api/items/:id/stock

Authorization: Bearer <token>

Request:
{
  "tipo": "entrada",
  "cantidad": 5,
  "motivo": "ajuste_manual",
  "comentario": "Ajuste tras recuento físico"
}

Response (200):
{
  "id": "uuid",
  "nombre": "Smartphone XYZ",
  "stock_anterior": 20,
  "stock_nuevo": 25,
  "movimiento_id": "uuid",
  "mensaje": "Stock ajustado exitosamente"
}

Response (400 — Stock insuficiente):
{
  "statusCode": 400,
  "message": "Stock insuficiente para la salida: disponible 10, solicitado 15",
  "error": "Bad Request"
}
```

**Request Body (`AjusteStockDto`):**
- `tipo` (required): `'entrada'` | `'salida'`
- `cantidad` (required): Número positivo (siempre; el signo lo define `tipo`)
- `motivo` (required): `'compra'` | `'venta'` | `'devolucion'` | `'merma'` | `'ajuste_manual'` | `'inventario_inicial'`
- `comentario` (optional): Texto libre (máx 500 caracteres)

**Constraints:**
- Solo para items con `tipo = 'producto'`
- `cantidad > 0`
- Si `tipo = 'salida'`, valida que `item_producto.stock >= cantidad`

La respuesta real (`{ stock, costoActual }`) siempre incluye `costoActual`: el
`costo_actual` vigente después del movimiento (el promedio recién recalculado
si fue una compra con `costoUnitario`, o el que ya tenía en cualquier otro
caso). El frontend lo usa para reflejar en la lista el promedio que quedó, no
el precio pagado en la compra puntual.

---

### POST /inventario/ajustes-costo

Corrige `item_producto.costo_actual` directamente (no un promedio, no una compra):
para arreglar un costo mal cargado. Registra un movimiento `tipo='ajuste'`,
`motivo='ajuste_costo'`, `cantidad=0` en el kardex — no mueve stock.

```
POST /api/inventario/ajustes-costo

Authorization: Bearer <token>

Request:
{
  "itemId": "uuid",
  "costoNuevo": "5050",
  "unidadCodigo": "kg",
  "comentario": "Corrección de costo mal cargado en la carga inicial"
}

Response (201):
{
  "movimientoId": "uuid",
  "costoAnterior": "4.0000",
  "costoNuevo": "5.0500"
}
```

⚠️ **El `costoNuevo` de la respuesta está siempre en unidad base**, aunque el request
haya venido en otra: sobre un producto en gramos, `5050` por `kg` se persiste como
`5.0500`/g.

**Permiso:** `Inventario/Actualizar` (RBAC estándar — admin del tenant lo tiene
por short-circuit).

Se rechaza con 400 si el costo nuevo es **igual al vigente**, y la comparación
va sobre el valor ya redondeado a 4 decimales: `costo_actual` es
`NUMERIC(18,4)`, así que un costo que solo difiere en el 5º decimal se
persistiría idéntico y dejaría en el kardex un ajuste que no cambió nada.

**Request Body (`AjusteCostoDto`):**
- `itemId` (required): UUID del item.
- `costoNuevo` (required): string numérico, costo nuevo. Debe ser `> 0`. Se interpreta
  **por `unidadCodigo`**, no por la unidad base.
- `unidadCodigo` (optional, desde el **2026-08-28**): unidad en la que la persona tipeó el
  costo. Ausente o igual a la base ⇒ comportamiento histórico, el número se toma tal cual.
  Existe para que la precisión venga de **elegir la unidad** y no de teclear decimales que
  la moneda del ítem no admite: en un insumo por gramo se carga `5050` por `kg`, no
  `5,0500` por `g`. Ver
  [`specs/2026-08-28-costo-por-unidad-elegida-design.md`](../superpowers/specs/2026-08-28-costo-por-unidad-elegida-design.md).
  ⚠️ **La conversión acá es de TASA, no de operación.** El ajuste mueve cantidad `0`, así
  que el camino de las mermas —`convertirCostoUnitario(cantidadIngresada, costo,
  cantidadBase)`, que divide por la cantidad convertida— sería una división por cero. Se
  reusa el **mismo** util con `cantidadIngresada = '1'` y como divisor el factor
  `convertirUnidad('1', unidadElegida, unidadBase)`; no hay aritmética nueva.
  ⚠️ La comparación "igual al vigente" corre sobre el costo **ya convertido**: cargar
  `5050`/kg en un producto que ya vale `5.0500`/g rebota con 400, igual que si lo hubieran
  tipeado en gramos.
- `comentario` (required): texto libre, no vacío. Un ajuste de costo es una
  corrección y tiene que quedar explicada; a diferencia de las mermas, no lleva
  causa tipificada (es un evento puntual, no un fenómeno recurrente que se
  reporte por categoría).

**Validaciones / errores:**
- `400` si `costoNuevo <= 0` o no es numérico.
- `404` si el item no existe en el tenant (o está soft-deleted).
- `400` si el item no es de `tipo='producto'` ni `'ingrediente'` (solo esos
  tienen costo propio en `item_producto`).
- `400` si `costoNuevo` (ya convertido a unidad base) es igual al `costo_actual`
  vigente (no hay nada que ajustar).
- `400` si `unidadCodigo` no existe o su magnitud es incompatible con la unidad base
  del producto — lo lanza `CatalogService.convertirUnidad`, no una validación propia.

Delega en `InventarioService.registrarMovimiento` (ver "Regla de costo" arriba)
dentro de una transacción: no repite sus validaciones ni escribe
`costo_actual` directamente — ese `UPDATE` está centralizado ahí.

---

## Producto eliminado: lo que está en el kardex queda en el kardex

Dar de baja un producto **no se bloquea** aunque tenga movimientos: impedir
discontinuar lo que alguna vez se movió equivale a no poder discontinuar casi
nada. Lo que se conserva es el rastro.

**Lectura — la baja no borra ni descuenta.** Nada en el backend escribe
`movimientos_inventario.eliminado_el`, así que los movimientos nunca se pierden.
Las consultas de las pantallas de auditoría (kardex y mermas) **no filtran
`items.eliminado_el`**, ni en el listado ni en el `COUNT(*)`, y devuelven
`itemEliminado: true` para que la fila se muestre marcada. El filtro tiene que
estar ausente en **las dos** consultas de cada pantalla: cuando estaba solo en el
listado, el total seguía bajando y la pantalla informaba menos movimientos de los
que hay sin decir que ocultaba nada.

**Escritura — solo lo que deshace algo.** Sobre un ítem eliminado,
`registrarMovimiento` acepta únicamente `motivo='anulacion'` y
`motivo='devolucion'`: esas ventas existieron y su plata ya se movió, así que hay
que poder cerrarlas. Todo el resto —compra, merma, ajuste de costo, recuento,
venta— se rechaza con un mensaje que **nombra el producto** y dice que está
eliminado, y no con el genérico `El item no tiene control de stock`, que es
deliberadamente opaco porque protege el acote por tenant y significa otra cosa.

Es una allowlist (`MOTIVOS_SOBRE_ITEM_ELIMINADO`) y no una lista de rechazos: un
motivo nuevo nace rechazado sobre un eliminado, que es el lado seguro del
default.

⚠️ **Hoy el guard es defensa en profundidad, no un agujero que se tapa.** Se midió
llamador por llamador: los seis caminos que no son anulación/devolución ya filtran
`eliminado_el IS NULL` aguas arriba —`items.ajustarStock`, `items.create`/`update`
e `inventario.registrarAjusteCosto` y `mermas.registrar` cortan con `404`;
`recuentos.aplicar` descarta la línea; recetas y combos excluyen al ingrediente
borrado de la expansión—. La regla vive en el chokepoint para el llamador que se
agregue mañana sin ese filtro.

---

## Backend

### Module & Services

- **Module**: `src/modules/inventario/inventario.module.ts`
- **Controller**: `src/modules/inventario/inventario.controller.ts`
- **Service**: `src/modules/inventario/inventario.service.ts`

### Entity & Database

**Table**: `movimientos_inventario`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `movimiento_id` | UUID | PK | |
| `tenant_id` | UUID | FK `tenants`, NOT NULL | Garantiza isolamiento multi-tenant |
| `item_id` | UUID | FK `items`, NOT NULL | Producto del que se mueve stock |
| `tipo` | enum | `'entrada'` \| `'salida'` \| `'ajuste'` | Define dirección del movimiento |
| `motivo` | varchar | `'compra'` \| `'venta'` \| `'devolucion'` \| `'merma'` \| `'ajuste_manual'` \| `'inventario_inicial'` \| `'ajuste_costo'` \| `'recuento'` | Razón del movimiento |
| `cantidad` | integer | NOT NULL, `> 0` excepto `ajuste_costo` (siempre `0`) | Siempre positiva; `tipo` define signo |
| `stock_anterior` | integer | NOT NULL | Saldo antes del movimiento (snapshot) |
| `stock_resultante` | integer | NOT NULL | Saldo después del movimiento (snapshot); en `ajuste_costo` es igual a `stock_anterior` |
| `usuario_id` | UUID | FK `usuarios`, NOT NULL | Quién registró el movimiento |
| `venta_id` | UUID | FK `ventas`, nullable | Si es `motivo = 'venta'`, referencia a la venta |
| `comentario` | text | nullable | Observaciones del usuario |
| `costo_unitario` | NUMERIC(18,4) | nullable | Congela el costo del momento del movimiento (en `ajuste_costo`, el costo nuevo) |
| `costo_anterior` | NUMERIC(18,4) | nullable | Solo poblado en `motivo='ajuste_costo'`: el `costo_actual` vigente antes del ajuste |
| `motivo_diferencia_id` | UUID | FK `motivo_diferencia_inventario`, nullable | Solo poblado en `motivo='recuento'`: la causa tipificada de la diferencia (línea o default de la sesión) |
| `creado_el` | TIMESTAMPTZ | NOT NULL, default NOW | Marca de tiempo |
| `actualizado_el` | TIMESTAMPTZ | NOT NULL, default NOW | Marca de tiempo |
| `eliminado_el` | TIMESTAMPTZ | nullable | Soft delete (aunque movimientos raramente se borren) |

**Regla de costo:**
- **`item_producto.costo_actual` es un promedio ponderado móvil (CPP), no el último costo.** Lo recalculan la entrada por **compra** y —desde el 2026-08-22— las entradas que **revierten** una salida (`anulacion`, `devolucion`), con la misma fórmula: `(stock_anterior × costo_actual_previo + cantidad × costo_compra) / (stock_anterior + cantidad)`, redondeado a 4 decimales. Sin stock previo o sin costo previo (no hay masa que promediar, y evita dividir por cero), el costo de compra manda tal cual. Implementado en `InventarioService.calcularCostoPromedio` (privado) y cableado en `registrarMovimiento` vía la variable `costoActualNuevo` (`string | null`; `null` = no se toca `item_producto`).
- **Otras entradas con `costoUnitario`:** congelan el valor en el kardex **sin** pisar `costo_actual`.
- **Cualquier otro movimiento (sin costoUnitario):** congela el `costo_actual` vigente del momento en `costo_unitario` (snapshot del costo).
- **El kardex (`costo_unitario` del movimiento) siempre congela lo que se PAGÓ en ese movimiento, nunca el promedio** — el promedio solo vive en `item_producto.costo_actual`. Las salidas nunca lo recalculan.
- **La mercadería que vuelve reingresa al costo con el que salió** (decisión del owner
  2026-08-15, construido el 2026-08-22). Anular una venta o recibir una devolución leen del
  kardex el `costo_unitario` que la salida original congeló —ligado a la `venta_id`— y lo
  pasan como costo del reingreso, así que el promedio se recalcula incluyéndolo.
  **Por qué importa:** antes el reingreso no traía costo y caía en el CPP vigente *el día de
  revertir*, sumando unidades sin aportar valor. Vender 1 a $50, comprar 5 a $70 (CPP
  $57,1429) y anular la venta dejaba el inventario valorizado en **$857,14** en vez de
  **$850**: $7,14 que no entraron por ninguna compra, y que contaminaban cada CPP posterior.
  Una devolución **parcial** usa el mismo costo sin prorratear nada: dentro de una venta
  todas las salidas de un ítem congelan el mismo costo, porque la venta tiene el ítem
  bloqueado hasta que commitea. Sin costo congelado (un producto que nunca tuvo costo) no se
  inventa uno: el promedio queda como estaba.
- **`ajuste_costo` (`tipo='ajuste'`):** corrige `item_producto.costo_actual` directamente, sin
  pasar por el promedio ponderado — es para arreglar un costo mal cargado, no una compra.
  No mueve cantidad (`cantidad` debe ser `0`, `stock_resultante = stock_anterior`, no toca
  `item_producto.stock` ni genera filas en `movimiento_inventario_detalle`) y requiere
  `costoUnitario` (el costo nuevo). El kardex guarda ambos lados del ajuste: `costo_anterior`
  (el `costo_actual` vigente antes) y `costo_unitario` (el nuevo, que también pasa a ser el
  `costo_actual` de `item_producto`). Desde el **2026-08-28** el costo puede llegar en otra
  unidad (`unidadCodigo`), y como acá la cantidad es `0` la conversión es de **tasa**, no de
  operación — ver `POST /inventario/ajustes-costo` arriba.
- Costos `<= 0` se rechazan.
- En `ajustarStock`, la fila `item_producto` se bloquea con `FOR UPDATE` antes de convertir unidades.
- **`costoUnitario` se ingresa "por la unidad elegida" (`unidadCodigo`), nunca por la unidad
  base.** Si hubo conversión de cantidad (`unidadCodigo` distinto de la base del producto), el
  costo se convierte junto con ella preservando el valor total de la operación
  (`cantidadIngresada × costoUnitario == cantidadBase × costoBase`); función pura
  `convertirCostoUnitario` en `backend/src/common/utils/costo-conversion-unidad.util.ts`. En
  mermas, esto **solo** aplica al `costoUnitario` explícito del DTO — cuando no se envía y se usa
  `costo_actual` del producto (ya en unidad base), no hay conversión. Detalle y ejemplo:
  [Conversión de Unidades — Conversión de Costo](./conversion-unidades.md#conversión-de-costo-junto-con-la-cantidad).

**Regla del recuento: delta, no absoluto (`motivo='recuento'`):**
- Al crear un recuento (`POST /recuentos`), cada línea congela `stock_sistema` = el stock
  vigente en ese momento. Al cargar el conteo (`PATCH /recuentos/:id/lineas/:lineaId`), la
  diferencia mostrada es `cantidad_contada − stock_sistema` — informativa, no lo que se aplica.
- Al aplicar (`POST /recuentos/:id/aplicar`), lo que se mueve es
  `delta = cantidad_contada − stock_sistema` sobre el **stock vigente en ese momento**, no
  sobre `cantidad_contada` como si fuera un absoluto. `RecuentosService.aplicar` calcula el
  `delta` y llama a `InventarioService.registrarMovimiento` con `cantidad = |delta|` y
  `tipo = 'entrada'` (delta positivo) o `'salida'` (delta negativo); `registrarMovimiento` ya
  aplica ese delta sobre el stock que lee bajo `FOR UPDATE`, así que nunca hay que calcular el
  stock final a mano.
- **Ejemplo (por qué importa):** un producto tiene 1000 unidades. Se cuenta 900 a las 10:00
  (delta −100, congelado). Antes de aplicar, se vende/ajusta 200 fuera del recuento → stock
  vigente 800. Al aplicar a las 14:00: `800 + (−100) = 700`. Si el recuento hubiera seteado el
  stock al valor contado (900), habría pisado la venta intermedia; el faltante de 100 que
  descubrió el conteo es real sin importar lo que se vendió después.
- Requiere causa tipificada (`motivo_diferencia_id`, catálogo `motivo_diferencia_inventario`):
  la línea puede traer su propio override; si no, se usa el `motivo_diferencia_default_id` de
  la sesión. Si ninguno de los dos existe y hay una diferencia distinta de cero, `aplicar`
  rechaza toda la sesión antes de mover cualquier stock (`400 Falta la causa de la
  diferencia...`) — la transacción no deja líneas parcialmente aplicadas.
- Líneas sin conteo cargado (`cantidad_contada IS NULL`) o con delta cero se ignoran, sin
  generar movimiento. Líneas cuyo item fue eliminado se descartan con `razon: 'El producto
  fue eliminado'` en la respuesta, en vez de fallar toda la sesión.
- La sesión de recuento (`recuento_inventario`) tiene estados `borrador → aplicado |
  cancelado` (ambos terminales); `aplicar` requiere permiso `Inventario/Actualizar`,
  distinto del `Inventario/Crear` que usan crear la sesión y cargar conteos — separa quien
  cuenta de quien aprueba. Detalle funcional completo (catálogo de causas, permisos por
  ruta): [`recuento-inventario.md`](./recuento-inventario.md).

**Índices (para performance):**
- `(tenant_id, item_id)` — consultas por producto del tenant
- `(tenant_id, motivo)` — filtrado por motivo
- `(tenant_id, creado_el)` — ordenamiento temporal

### DTOs

- `AjusteStockDto` — Request para `PATCH /items/:id/stock`
  ```typescript
  export class AjusteStockDto {
    @IsIn(['entrada', 'salida'])
    tipo: 'entrada' | 'salida';

    @IsNumber()
    @Min(1)
    cantidad: number;

    @IsIn(['compra', 'venta', 'devolucion', 'merma', 'ajuste_manual', 'inventario_inicial'])
    motivo: 'compra' | 'venta' | 'devolucion' | 'merma' | 'ajuste_manual' | 'inventario_inicial';

    @IsOptional()
    @IsString()
    @MaxLength(500)
    comentario?: string;
  }
  ```

- `MovimientoInventarioDto` — Response
  ```typescript
  export class MovimientoInventarioDto {
    movimiento_id: string;
    item_id: string;
    item_nombre: string;
    tipo: 'entrada' | 'salida' | 'ajuste';
    motivo: string;
    cantidad: number;
    stock_anterior: number;
    stock_resultante: number;
    usuario_nombre: string;
    comentario?: string;
    venta_id?: string;
    creado_el: Date;
    actualizado_el: Date;
  }
  ```

- `AjusteStockResponseDto` — Respuesta de PATCH
  ```typescript
  export class AjusteStockResponseDto {
    id: string;
    nombre: string;
    stock_anterior: number;
    stock_nuevo: number;
    movimiento_id: string;
    mensaje: string;
  }
  ```

### Key Methods

**InventarioService**

- `async registrarMovimiento(manager: EntityManager, params: { tenant_id, item_id, tipo, motivo, cantidad, usuario_id, venta_id?, comentario? }): Promise<MovimientoInventario>`
  
  Registra un movimiento y actualiza el saldo del item **en una sola transacción**. Usa `EntityManager` para que pueda ser reutilizado por otras transacciones (ventas, devoluciones).
  
  - Valida que el item exista y sea de `tipo = 'producto'`
  - Si `tipo = 'salida'`, valida stock suficiente; si no, lanza error sin modificar
  - Obtiene el stock actual con `FOR UPDATE` (evita carreras)
  - Inserta en `movimientos_inventario` con snapshots `stock_anterior` / `stock_resultante`
  - Actualiza `item_producto.stock` en la misma transacción
  - Retorna la entidad persistida

- `async ajustarStock(itemId: string, tenantId: string, usuarioId: string, dto: AjusteStockDto): Promise<AjusteStockResponseDto>`
  
  Endpoint handler para `PATCH /items/:id/stock`. Abre su propia transacción y llama a `registrarMovimiento`.

- `async findMovimientos(tenantId: string, filtros?: { itemId?, motivo?, desde?, hasta?, skip?, take? }): Promise<{ data: MovimientoInventarioDto[], total: number, skip, take }>`
  
  Consulta el kardex del tenant con JOINs a `items` y `usuarios` para enriquecer nombres. Retorna movimientos paginados, ordenados por `creado_el DESC`.

---

## Frontend

### Pages

⚠️ Los sub-bullets en imperativo ("agregar…", "opcional") son del **diseño original**, no un
inventario de lo que existe hoy. Lo que sí está fechado describe estado real.

- `pages/inventario/index.vue` — Vista global del kardex (era `pages/inventario.vue` en el
  diseño original)
  - Tabla de movimientos con columnas: Item, Tipo, Motivo, Cantidad, Stock Anterior, Stock Resultante, Usuario, Fecha
  - Cantidad y Stock Resultante formateados por magnitud vía `formatStock`
    (`useFormatters`) — `MovimientoListItem.unidadMedida` (viene de
    `item_producto.unidad_medida` vía `LEFT JOIN` en `findMovimientos`)
  - Filtros laterales: por item (select/search), por motivo (select multi), por rango de fechas
  - Paginación
  - Botón "Exportar a CSV" (opcional)
  - Drawer "Ajustar costo": desde el **2026-08-28** lleva selector de unidad (misma
    forma que `mermas.vue`: solo si `modoInventario === 'cantidad'` y la magnitud tiene
    más de una unidad) y la etiqueta dice *"Costo nuevo (por {unidad})"*. El
    `unidadCodigo` viaja en el body **solo si difiere de la base** — el DTO lo valida con
    `@IsNotEmpty()`, así que una cadena vacía sería un 400. El `MoneyInput` va atado a
    `:moneda-id` y **sin** prop `decimales`: la precisión la da la unidad
    ([`patterns/frontend.md`](../patterns/frontend.md) §8)

- `pages/configuracion/items.vue` — Modificación: agregar modal "Historial"
  - En la fila de cada producto, agregar botón/enlace "Historial"
  - Modal `InventarioHistorialModal.vue` que muestra los últimos 20 movimientos del producto
  - Dentro del modal, resumen de saldo actual y últimas transacciones

### Components

- `components/InventarioTable.vue` — Tabla reutilizable de movimientos
  - Props: `movimientos[]`, `loading`, `total`, `skip`, `take`
  - Eventos: `@update:skip`, `@update:take`, `@filter`
  - Estilos: filas alternadas, resaltado de salidas/entradas por color

- `components/InventarioHistorialModal.vue` — Modal de historial de producto
  - Props: `itemId`, `itemNombre`, `isOpen`
  - Eventos: `@close`
  - Muestra últimos 20 movimientos + saldo actual del producto
  - Botón "Ver completo" que abre la página global `/inventario` pre-filtrada por item

- `components/AjusteStockModal.vue` — Modal para ajustar stock manualmente
  - Props: `itemId`, `itemNombre`, `stockActual`, `isOpen`
  - Eventos: `@close`, `@success`
  - Campos: tipo (radio), cantidad (input numérico), motivo (select), comentario (textarea)
  - Validación: cantidad > 0, si salida entonces cantidad <= stockActual
  - Toast "Stock ajustado exitosamente" o error si falla

### Pinia Store

**File**: `stores/inventario.ts`

**State**:
```typescript
interface InventarioState {
  movimientos: MovimientoInventarioDto[];
  total: number;
  skip: number;
  take: number;
  filtros: {
    itemId?: string;
    motivo?: string;
    desde?: Date;
    hasta?: Date;
  };
  loading: boolean;
  error: string | null;
}
```

**Actions**:
- `async fetchMovimientos(filtros?: any)` — GET `/api/inventario/movimientos` con filtros
- `async ajustarStock(itemId: string, dto: AjusteStockDto)` — PATCH `/api/items/:id/stock`
- `setFiltros(filtros: any)` — Actualiza filtros locales y re-fetch
- `resetFiltros()` — Limpia filtros
- `setPaginacion(skip: number, take: number)` — Cambia paginación

---

## Data Flow

### Crear Producto con Stock Inicial

```
[Usuario abre formulario de nuevo producto]
  ↓
[Completa: nombre, precio, stock inicial = 25]
  ↓ POST /api/items
[Backend: Controller valida DTO]
  ↓
[Service inicia transacción]
  ├→ Inserta en `items`
  ├→ Inserta en `item_producto` (stock = 25)
  ├→ Si stock > 0, llama a InventarioService.registrarMovimiento(
  │   tipo='entrada', motivo='inventario_inicial', cantidad=25
  │ )
  │ ├→ Inserta en `movimientos_inventario` (stock_anterior=0, stock_resultante=25)
  │ └→ Confirma `item_producto.stock = 25`
  └→ Retorna item creado
  ↓
[Frontend: recibe item, muestra toast "Producto creado"]
  ↓
[Usuario navega a /configuracion/items, ve el producto con Stock 25]
  ↓
[Usuario hace clic en "Historial" → modal muestra 1 movimiento: inventario_inicial, 25 unidades]
```

### Ajustar Stock Manualmente

```
[Usuario en /configuracion/items hace clic en "Ajustar stock" de un producto]
  ↓
[Se abre AjusteStockModal]
  ↓
[Usuario elige tipo=entrada, cantidad=10, motivo=compra, comentario="Reorden"]
  ↓ Click "Guardar"
[PATCH /api/items/:id/stock con AjusteStockDto]
  ↓
[Backend: Controller valida DTO]
  ↓
[InventarioService.ajustarStock inicia transacción]
  ├→ Obtiene stock actual con FOR UPDATE
  ├→ Llama a registrarMovimiento(
  │   tipo='entrada', motivo='compra', cantidad=10, usuario_id=<del token>,
  │   comentario="Reorden"
  │ )
  │ ├→ Calcula stock_resultante = stock_anterior + 10
  │ ├→ Inserta movimiento en `movimientos_inventario`
  │ └→ Actualiza `item_producto.stock`
  └→ Retorna AjusteStockResponseDto
  ↓
[Frontend: recibe respuesta, muestra toast "Stock ajustado exitosamente"]
  ↓
[Store se actualiza: refetch movimientos del item → modal "Historial" muestra el movimiento nuevo]
```

### Salida de Stock (Insuficiente)

```
[Usuario intenta salida: cantidad 15, pero stock actual es 10]
  ↓ PATCH /api/items/:id/stock { tipo='salida', cantidad=15 }
  ↓
[InventarioService.registrarMovimiento]
  ├→ Obtiene stock con FOR UPDATE: 10
  ├→ Valida: 10 >= 15? → NO
  └→ Lanza BadRequestException("Stock insuficiente para la salida: disponible 10, solicitado 15")
  ↓
[Transacción revierte, no se crea movimiento]
  ↓
[Frontend: captura error 400, muestra toast rojo "Stock insuficiente para la salida…"]
```

### Venta Genera Movimiento Automático

```
[Usuario en /ventas crea una venta con 1 unidad de Smartphone]
  ↓ POST /api/ventas
  ↓
[Backend: VentasService inicia transacción]
  ├→ Inserta en `ventas`, `venta_detalle`, `venta_impuesto`, etc.
  ├→ Por cada línea del detalle:
  │ ├→ Obtiene el item
  │ └→ Llama a InventarioService.registrarMovimiento(
  │     manager, {
  │       tipo='salida',
  │       motivo='venta',
  │       cantidad=1,
  │       venta_id=<id de la venta>,
  │       usuario_id=<del token>
  │     }
  │   )
  │ ├→ Valida stock: si no hay suficiente, lanza error
  │ └→ Registra movimiento e inserta en `movimientos_inventario`
  └→ Transacción se confirma (venta + movimientos en una sola unidad atómica)
  ↓
[Frontend: toast "Venta registrada"]
  ↓
[Usuario navega a `/inventario`, filtra por motivo='venta', ve la salida registrada automáticamente]
```

---

## Testing

### Unit Tests (Backend)

```bash
npm test -- modules/inventario/inventario.service.spec.ts
npm test -- modules/inventario/inventario.controller.spec.ts
npm test -- modules/items/items.service.spec.ts  # Tests de creación con stock inicial
```

**Test Coverage:**
- ✅ `registrarMovimiento` con entrada, salida, inventario_inicial
- ✅ Validación de stock insuficiente en `salida`
- ✅ Transacción atómica: rollback al fallar
- ✅ Creación automática de movimiento al crear producto con stock > 0
- ✅ `findMovimientos` con filtros (itemId, motivo, fechas)
- ✅ Paginación correcta

### E2E Tests

```bash
npm run test:e2e -- inventario.e2e.spec.ts
```

**Escenarios:**
1. Crear producto con stock inicial 25 → verificar movimiento `inventario_inicial` automático
2. Ajustar stock (entrada): +10 unidades, motivo=compra → verificar nuevo saldo, movimiento visible en historial
3. Ajustar stock (salida): -5 unidades, stock actual=8 → éxito, saldo=3, movimiento registrado
4. Intentar salida con cantidad > stock → error 400, no se crea movimiento, stock sin cambios
5. Crear venta con 1 unidad de producto → movimiento `salida`/`motivo='venta'` registrado automáticamente
6. Filtrar kardex por motivo='venta' → solo movimientos de ventas
7. Filtrar kardex por rango de fechas → movimientos dentro del rango

### Manual Testing (Swagger + Frontend)

1. Swagger: http://localhost:3000/api/docs
   - POST `/items` con stock_inicial=25
   - PATCH `/items/:id/stock` con tipo/cantidad/motivo
   - GET `/inventario/movimientos?motivo=entrada&skip=0&take=10`

2. Frontend: `docker-compose up`
   - Login → Configuración → Items
   - Crear producto con stock inicial
   - Hacer clic en "Historial" → ver movimiento inicial
   - Ajustar stock (entrada/salida) → ver cambios
   - Navegar a Configuración → Inventario
   - Probar filtros (item, motivo, fechas)

---

## Acceptance Criteria

- [x] Entity `MovimientoInventario` creada con columnas correctas
- [x] Endpoint `GET /inventario/movimientos` implementado y testado
- [x] Endpoint `PATCH /items/:id/stock` actualizado para registrar motivo+comentario
- [x] `InventarioService.registrarMovimiento` implementado con manager-awareness
- [x] Movimiento `inventario_inicial` automático al crear producto con stock > 0
- [x] Validación de stock insuficiente en `salida`
- [x] Transacción atómica: movimiento + actualización de saldo juntos
- [x] Integración con ventas: cada línea genera `salida`/`motivo='venta'` automáticamente
- [x] Frontend: modal "Historial" en `/configuracion/items`
- [x] Frontend: página `/inventario` con filtros
- [x] Unit tests: ✅
- [x] E2E tests: ✅
- [x] API docs: Swagger decorators
- [x] Feature docs: esta file

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Carreras de actualización en saldo materializado | Inconsistencia stock | `FOR UPDATE` en query de stock antes de operar |
| Movimiento registrado pero venta falla → stock cambia sin venta | Inconsistencia | Una sola transacción DB para venta + movimiento |
| Usuarios olvidan ajustar stock manualmente | Discrepancias | Alertas de "próximo vencimiento" y "stock bajo"; recordatorios periódicos |
| Auditoría: quién cambió qué y cuándo | Compliance | `usuario_id` y `creado_el` en cada movimiento; soft delete para trazabilidad |

---

## Related Features

- [Procesamiento de ventas](./ventas.md) — Integración automática: cada venta genera salida
- [Gestión de cajas](./gestion-cajas.md) — Ventas se asocian a cajas (futuro: movimientos de caja)

---

## Notes

- **Reutilización de `InventarioService.registrarMovimiento(manager, ...)`:** El servicio está diseñado para recibir un `EntityManager`, permitiendo que el módulo de ventas (o futuras integraciones) use la misma lógica dentro de su propia transacción sin duplicar código.
- **Tipo `'ajuste'`:** solo se usa con `motivo='ajuste_costo'` (corrige valor, no cantidad; `cantidad` siempre `0`). El recuento de inventario sí mueve cantidad, pero usa `tipo='entrada'`/`'salida'` como cualquier otro movimiento que mueve stock — respeta la convención de que `tipo='ajuste'` es exclusivo de lo que **no** mueve cantidad. Ver "Regla del recuento" arriba y [`recuento-inventario.md`](./recuento-inventario.md).
- **Confirmación en BD:** el nombre real de la columna de usuario en `usuarios` se usa en JOINs (`usuarios.nombre AS usuario_nombre`). Ajustar si la columna tiene otro nombre o alias.
