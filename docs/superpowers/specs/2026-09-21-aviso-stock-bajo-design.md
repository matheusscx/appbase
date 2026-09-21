# Spec: Aviso de stock bajo (punto de reorden)

**Status**: Draft
**Date**: 2026-09-21
**Owner**: Cesar Matheus

**Fuente de verdad de las decisiones de negocio**: `docs/agent/pendientes.md` § 4, entrada
"Aviso de stock bajo" (owner, 2026-09-20). Esta spec no repite esas seis decisiones, las **mide
contra el código** y resuelve lo que la entrada dejó para "quien tome esta entrada".

**Insumo cruzado, no copiado**: `docs/agent/investigaciones/2026-09-20-aviso-stock-bajo-punto-reorden.md`.

---

## 1. Dónde vive el mínimo

**Decisión: tabla propia `stock_minimo`, no una columna en `stock_ubicacion`.**

Medido, no preferido:

- `stock_ubicacion` (`backend/src/modules/items/entities/stock-ubicacion.entity.ts`) declara en su
  propio docblock que es el **"Único dueño del saldo de stock del sistema"**, poblado por el
  chokepoint de escritura `InventarioService.registrarMovimiento`.
- El mismo docblock dice que la fila **puede no existir todavía** "para un ítem que nunca se movió
  en esa ubicación", y por eso el lock de stock ancla en `item_producto` y nunca en
  `stock_ubicacion` (`docs/patterns/backend.md` § 15).
- El mínimo, por decisión ya tomada, **nace vacío y se carga donde importa** — incluyendo una
  ubicación donde el producto **todavía no tiene una sola unidad** (una bodega nueva, antes de la
  primera entrega). Si el mínimo viviera en `stock_ubicacion`, cargarlo obligaría a crear una fila
  de saldo (`stock=0`) por una vía que **no es el chokepoint de movimientos** — el patrón que
  `docs/agent/anti-patterns.md` documenta como bug ya cometido, aplicado a una tabla cuyo contrato
  entero es "solo el chokepoint escribe acá".

**Forma de la tabla** (nueva, `backend/src/modules/inventario/entities/stock-minimo.entity.ts` —
en `inventario/`, porque es política de inventario y no una extensión de `items`):

```
stock_minimo
  item_id        uuid  (FK items, parte de la PK)
  ubicacion_id   uuid  (FK ubicaciones, parte de la PK)
  minimo         numeric(18,4) NOT NULL          -- misma escala que stock_ubicacion.stock
  origen         text NOT NULL DEFAULT 'manual'  CHECK (origen IN ('manual','sistema'))
  creado_el      timestamptz
  actualizado_el timestamptz
  eliminado_el   timestamptz NULL
```

- **PK compuesta `(item_id, ubicacion_id)`** — mismo par que ya es la PK de `stock_ubicacion`, por
  la primera decisión del owner (mínimo por producto Y lugar).
- **Sin columna `tenant_id` propia**: el tenant se acota por `JOIN` a `items`, que sí lo declara.
  Toda consulta nueva valida `items.tenant_id = $tenant` en el mismo `JOIN`, nunca yendo directo a
  `stock_minimo` por PK.
- **`origen`** existe para la decisión de "distinguir quién puso el número", **sin construir el
  cálculo**. Todo endpoint de escritura de este frente fija `origen = 'manual'` siempre, y el DTO
  **no acepta** `origen` en el body: no hay forma de que un cliente lo declare `'sistema'`. La
  columna queda lista para que una feature futura escriba `'sistema'` sin migrar el esquema ese día.
- **`eliminado_el`**: la invariante 3 de `CLAUDE.md` aplica igual acá. Limpiar un mínimo es un
  soft-delete; volver a cargarlo es un **upsert que revive la fila**, no un insert:
  `INSERT ... ON CONFLICT (item_id, ubicacion_id) DO UPDATE SET minimo = EXCLUDED.minimo,
  origen = 'manual', eliminado_el = NULL, actualizado_el = NOW()`. Sin ese molde, borrar y volver a
  cargar el mismo par deja la fila muerta sin que nada avise
  (`docs/patterns/backend.md` § 14b — "la puente con PK compuesta se revive, no se reinserta").
- **NULL vs 0, resuelto por la forma del esquema y no por una regla nueva**: la investigación dejó
  esto abierto. Con esta tabla se resuelve solo — **ausencia de fila** = nunca se cargó mínimo para
  ese par = sin aviso posible; **fila con `minimo = 0`** = un mínimo explícito de cero, cargado a
  propósito, que en la práctica no dispara porque el stock nunca es negativo, pero que **es
  distinguible de "nunca se cargó"**. No hace falta un booleano extra: "nace vacío" se lee
  literalmente como "sin fila".

---

## 2. Compras: qué cuenta como "en camino"

`EstadoCompra = 'borrador' | 'confirmada' | 'anulada'`
(`backend/src/modules/compras/entities/compra.entity.ts`). El módulo de compras hoy es "cargar lo
que **ya llegó**", no una orden de compra a proveedor (`docs/features/compras.md` § Scope deja la
orden de compra fuera), y la investigación de mercado lo señala.

**Decisión: solo `estado = 'borrador'` cuenta como "en camino"**, uniendo `compra_lineas.item_id`
con `compras.ubicacion_id` y filtrando `compras.eliminado_el IS NULL`.

- **`borrador`**: no movió stock todavía — `registrarMovimiento` corre al confirmar. Es el estado
  equivalente al "inbound" que Lightspeed resta, con el matiz honesto de que acá no es una orden a
  proveedor sino un borrador de recepción. Eso va escrito en el código, no presentado como si
  fueran lo mismo.
- **`confirmada`**: **ya** movió stock. Si el ítem sigue bajo el mínimo después de eso, es una
  urgencia real (lo que llegó no alcanzó), y excluirlo esconde el caso que más le importa a quien
  repone. No necesita exclusión explícita: al filtrar por `borrador`, una confirmada no entra.
- **`anulada`**: no cuenta por construcción, sin regla aparte.
- **"Corregida a la baja"**: la consulta se evalúa **en vivo** en cada request contra el estado
  actual, sin snapshot que invalidar. Si un borrador se reemplaza sacando la línea, la siguiente
  lectura ya no la excluye. Si una confirmada se corrige a la baja, esa corrección ya escribió en
  `stock_ubicacion` y el aviso lee el stock resultante, no la compra. En ningún caso hay algo que
  guardar aparte: es literalmente "el estado del pedido es la señal".

⚠️ **Lectura elegida entre dos, con su argumento** (no es una regla de negocio nueva): "baja de
urgencia **o** sale del bloque" se implementa como **exclusión completa** del par del cómputo, no
como un tercer nivel de severidad. Construir una escala intermedia es complejidad que nadie pidió
y que el propio texto no distingue de la opción más simple.

---

## 3. Las dos lecturas, sin N+1

### 3.1 Bloque del dashboard de inicio

**Un número + hasta 4 grupos por ubicación**, nunca la lista completa. La propiedad a sostener es
que **no crezca**: si un día hay 40 productos bajo el mínimo, el bloque ocupa lo mismo.

Forma de las consultas (no el SQL final): una base compartida sobre la que corren **dos
agregaciones fijas**, igual que `resumen-negocio.service.ts` corre consultas fijas por request sin
importar cuántas ventas haya.

```
base:
  stock_minimo sm
  JOIN items i        ON i.item_id = sm.item_id AND i.tenant_id = $tenant AND i.eliminado_el IS NULL
  JOIN ubicaciones u  ON u.ubicacion_id = sm.ubicacion_id AND u.tenant_id = $tenant AND u.eliminado_el IS NULL
  LEFT JOIN stock_ubicacion su ON su.item_id = sm.item_id AND su.ubicacion_id = sm.ubicacion_id
  WHERE sm.eliminado_el IS NULL
    AND COALESCE(su.stock, 0) < sm.minimo
    AND NOT EXISTS ( ... compra_lineas x compras estado='borrador' del § 2 ... )

total:        SELECT COUNT(*) FROM base
porUbicacion: SELECT ubicacion_id, ubicacion_nombre, COUNT(*) cantidad
              FROM base GROUP BY ubicacion_id, ubicacion_nombre
              ORDER BY cantidad DESC LIMIT 4
```

`total` cuenta **todas** las ubicaciones afectadas, no solo las 4 que se listan — así "6 bajo el
mínimo" sigue siendo verdad aunque se detallen 4 grupos. Dos consultas fijas, cero por fila.

**Endpoint**: `GET /inventario/stock-bajo/resumen` → `{ total, porUbicacion: [{ ubicacionId,
ubicacionNombre, cantidad }] }` (máximo 4 filas). Permiso `Inventario:Leer`.

**Por qué es un endpoint propio y no un campo más de `GET /resumen-negocio/hoy`**: ese endpoint
está gateado por `Resumen del negocio:Leer`, un permiso **distinto** de `Inventario:Leer`
(`docs/features/dashboard-inicio.md` explica por qué ese permiso es propio). Empaquetarlo junto
mezclaría dos permisos en una respuesta: le daría el dato a quien no debe verlo, o se lo
esconderá a quien sí.

**Frontend**: `InicioStockBajo.vue`, un bloque más en la zona **"Ahora"** de `pages/index.vue` y no
en "Hoy" — el stock cambia todo el turno con cada venta, el mismo motivo por el que Salón y Cajas
están en "Ahora". Usa `useRefrescoPeriodico` como `InicioCajas`/`InicioSalon`, montado con
`esAdmin || can('Inventario', 'Leer')`.

### 3.2 Marca en el listado de inventario

**No existe hoy una pantalla que liste stock por (ítem, ubicación)** fuera del desglose de solo
lectura dentro del formulario de edición de un ítem (`frontend/app/pages/configuracion/items.vue`,
gateado por `Items:Leer`). Las tres pantallas bajo `/inventario/` son kardex, traslados y
recuentos: ninguna lista stock actual por producto y ubicación.

**Decisión: crear `pages/inventario/stock-minimo.vue`, gateada enteramente por permisos de
`Inventario`.** Es "el listado de inventario" al que se refiere la entrada, y no el catálogo de
Items. El argumento:

- Embebida en `configuracion/items.vue` (gateado `Items:Leer`), la marca necesitaría su **propio**
  `v-if` de `Inventario:Leer` anidado bajo el de `Items:Leer` — el anti-patrón de "control con
  permiso propio anidado bajo el `v-if` de otro" que este repo ya documenta como bug cometido. Y
  el dato tendría que salir de una llamada separada: si viajara en la misma respuesta, cualquiera
  con `Items:Leer` vería el aviso sin tener `Inventario:Leer`.
- Una pantalla nueva bajo `/inventario/` es consistente con que cada feature de ese módulo ya viva
  en su propia página bajo el mismo permiso.
- Resuelve dos cosas a la vez: la marca por fila **y** dónde se carga el mínimo (§ 4).

**Listado paginado** (patrón § 10 de `docs/patterns/backend.md`: `WHERE` compartido → `COUNT(*)` →
`SELECT ... LIMIT/OFFSET`), con las columnas de la base de § 3.1 sin agregar, más `sm.minimo`,
`sm.origen` y el flag `enCamino`. Ordenado por bajo-el-mínimo primero y después por nombre, con
filtro opcional `?soloBajoMinimo=true`. Es la lista **completa** para quien la pide, coherente con
"el usuario fue a buscarla".

**Endpoint**: `GET /inventario/stock-minimo` (paginado). Permiso `Inventario:Leer`.

---

## 4. Cargar y limpiar el mínimo

`PUT /inventario/stock-minimo/:itemId/:ubicacionId` con `{ minimo: string | null }` — `null`
limpia (soft-delete). Validaciones en el service:

- `itemId` pertenece al tenant del token y es `tipo='producto'`. **Reusar el mensaje existente**
  *"El item no tiene control de stock"*, que ya usan `InventarioService`, `RecuentosService` y
  `TrasladosService`; no redactar uno nuevo.
- `ubicacionId` pertenece al mismo tenant, con el criterio que `TrasladosService` ya aplica a
  origen y destino.
- `minimo >= 0`.

**Permiso: `Inventario:Actualizar`**, no `Items:Actualizar`. Precedente medido en el propio código:
`PATCH /items/:id/stock` (ajustar la cantidad de **un** ítem) es `Items:Actualizar`, mientras
`POST /inventario/ajustes-costo` —una corrección de política de inventario, transversal— es
`Inventario:Actualizar` (`inventario.controller.ts:32-33`). El mínimo es política de
reabastecimiento: alimenta el aviso y, a futuro, un traslado o una compra. Quien edita el catálogo
no es necesariamente quien decide cuánto stock hace falta.

⚠️ **Esta asignación de permiso NO es una de las seis decisiones del owner** — esas hablan de
`Leer` para ver el aviso y `Crear` para el traslado, no de quién carga el mínimo. Sale de un
precedente del código, no de inventar una regla. Si el owner prefiere otra cosa, es un cambio de
una línea en el decorador.

---

## 5. Traslado precargado

**Reusar, no inventar**: `frontend/app/composables/useRechazoPorStock.ts` ya resuelve esta UX para
el rechazo de venta por falta de stock, navegando a
`/inventario/traslados?itemId=&origenId=&cantidad=`. El matiz de permiso **no es opcional**:
trasladar es `Inventario:Crear`, y a quien no lo tiene se le informa **sin botón**, nunca se le
ofrece una acción que va a rebotar con 403 (`docs/features/bodegas-y-traslados.md`).

**Lo que el reuso literal NO cubre, medido**: `destinoId` **no viaja hoy en la URL**.
`frontend/app/pages/inventario/traslados.vue` lee solo `{ itemId, origenId, cantidad }` de la query
y fija `form.value.destinoId = local.value?.id ?? ''` a ciegas. Ese default es correcto **para el
caso que lo originó** —una venta siempre rechaza en el local— pero el aviso de stock bajo puede
disparar sobre **una bodega**: el mínimo es por (ítem, ubicación) cualquiera.

**Extensión mínima y retrocompatible**: la lectura de la query acepta un `destinoId` **opcional**;
si viene, lo usa, y si no, cae al default actual. El caller existente no lo manda y no cambia de
conducta. El aviso sí lo manda:
`?itemId=&origenId=<ubicación con stock>&destinoId=<ubicación bajo el mínimo>&cantidad=<mínimo − stock>`.

**Gate del botón**: `usePermisosCrud('Inventario').puedeCrear`, que ya resuelve el bypass de admin
— no repetir `esAdmin || can(...)` a mano.

---

## 6. Permisos — resumen

| Acción | Permiso | Precedente |
|---|---|---|
| Ver el bloque del dashboard | `Inventario:Leer` | candidato del owner, confirmado |
| Ver el listado y la marca | `Inventario:Leer` | ídem |
| Cargar o limpiar el mínimo | `Inventario:Actualizar` | análogo a `ajustes-costo` (§ 4) |
| Ofrecer el traslado precargado | `Inventario:Crear` | `useRechazoPorStock.ts`, traslados |

Ningún endpoint nuevo mezcla Items e Inventario en una sola respuesta (§ 3.2).

---

## 7. Matriz de test — qué distinción ejerce qué test

| Distinción | Test |
|---|---|
| Con mínimo cargado / sin fila en `stock_minimo` | e2e: aparece / no aparece en los dos endpoints |
| `minimo = 0` explícito / ausencia de fila | unit: la fila en 0 se lee como cargada, la ausencia no compara |
| `stock_ubicacion` sin fila (nunca se movió ahí) + mínimo cargado | e2e: `COALESCE(su.stock,0)` dispara igual que un stock real en 0 |
| Compra `borrador` con línea del par | e2e: el par sale del bloque y de la marca |
| Compra `confirmada` que no alcanza el mínimo | e2e de regresión: **sigue** contando |
| Compra `anulada` | e2e de regresión: vuelve a contar |
| Corrección de un borrador que saca la línea | e2e: la siguiente lectura ya no la excluye |
| Modo `cantidad` / `serie` / `lote` | unit parametrizado: los tres comparan igual contra el saldo |
| `Inventario:Leer` presente / ausente | e2e con **rol real**: 200 / 403 en los endpoints nuevos |
| `Inventario:Crear` presente / ausente | e2e de navegador con **rol real**: con botón / informativo sin botón |
| `Inventario:Actualizar` presente / ausente | e2e: 200 / 403 en el `PUT`, con rol real |
| Traslado con destino distinto del local | e2e de navegador: el drawer abre con el destino correcto |
| El "no crece" del bloque | § 8 |

Todos los tests de permiso usan un rol construido con el permiso exacto que falta, **nunca el
admin del seed**: con admin el 403 ajeno se tapa.

---

## 8. La prueba del ruido

Paso explícito, no opcional. En el e2e de navegador, sembrar por API suficientes pares bajo el
mínimo para superar largamente 4 grupos, y afirmar que el bloque sigue mostrando **un número y
≤4 filas** — nunca una lista que crece con los datos.

La palanca que sostiene esa propiedad (agrupar por ubicación, como Square y Bsale en sus
resúmenes) está en la investigación § 3: no hace falta reinvestigarla, solo verificar que la
implementación la respeta.

---

## 9. Preguntas abiertas para el owner

Ninguna de las seis decisiones resultó no-implementable: las seis cruzan limpio contra el código
medido acá. Lo que sigue **no está decidido** ni en la entrada ni en la investigación:

1. **Ítem eliminado (papelera) con un mínimo cargado** — ¿el aviso se apaga solo, o el mínimo sigue
   vivo? El soft-delete filtra la mayoría de las lecturas, pero el kardex es una excepción
   deliberada, así que no hay un precedente que decida por analogía.
2. **Ubicación (bodega) eliminada con un mínimo cargado ahí** — ¿el mínimo se soft-borra con la
   ubicación, o queda huérfano? El local del tenant nunca se elimina, así que solo aplica a bodegas.
3. **Ubicación desactivada (`activo=false`, no eliminada) con un mínimo cargado** — una bodega
   desactivada sigue sirviendo de **origen** de traslado pero deja de ser destino válido. ¿El aviso
   sigue avisando sobre ella, o eso implica que ya no se repone ahí?

---

## Related Features

- [bodegas-y-traslados.md](../../features/bodegas-y-traslados.md)
- [compras.md](../../features/compras.md)
- [dashboard-inicio.md](../../features/dashboard-inicio.md)
- [inventario-serializado.md](../../features/inventario-serializado.md)
