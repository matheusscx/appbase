# Costeo por promedio ponderado móvil (CPP)

**Fecha:** 2026-07-26
**Estado:** diseño aprobado, pendiente de plan
**Alcance:** reemplazar el "último costo" de `item_producto.costo_actual` por un **promedio
ponderado móvil**, y cerrar todo camino que escriba el costo sin dejar rastro en el kardex.
Toca backend (inventario, items) y frontend (form de items, nueva operación). **No** toca el
motor de precios, ni impuestos, ni ventas.
**Investigación de origen:** [`docs/agent/investigaciones/2026-07-26-inventario.md`](../../agent/investigaciones/2026-07-26-inventario.md) §1

---

## 1. Contexto y problema

`item_producto.costo_actual` es hoy el **último costo**: lo pisa una entrada con
`motivo='compra'` que traiga `costoUnitario` (`inventario.service.ts:113-120, 173-178`), y
nada más. Eso tiene dos problemas distintos:

**(a) El último costo no es un método de valorización.** Ningún POS maduro lo usa como base
—usan promedio ponderado o capas FIFO— y en Chile el **art. 30 de la Ley de la Renta** solo
admite FIFO o Costo Promedio Ponderado (SII Ord. N° 3190/2015). Pero antes que fiscal, es un
**bug de gestión**: una compra puntual a precio atípico corrompe el margen de todo el stock
remanente comprado a otro precio. Eso ensucia el food-cost, el precio sugerido del simulador
y la valorización de mermas — tres features ya construidas.

**(b) Hay una puerta trasera.** `PATCH /items/:id` acepta `dto.costo` y escribe `costo_actual`
directo (`items.service.ts:1183-1190`), **sin movimiento de inventario**. Es peor que (a): ahí
el número no viene ni siquiera de una compra real, y no queda rastro de quién lo cambió ni por
qué. Ese campo se agregó como parche cuando no existía flujo de compras ni costeo; no responde
a una necesidad de negocio.

Arreglar (a) sin cerrar (b) no sirve: el promedio calculado se pisaría igual.

---

## 2. Decisiones de diseño

1. **CPP, no FIFO.** FIFO exige capas de costo con consumo registrado, y en modo `cantidad`
   —donde cae la mayoría de los productos— no hay capas naturales. Además rompe el supuesto de
   "un costo por producto" del que dependen `item_receta.costo_actual`, `item_combo.costo_actual`
   y el simulador de impacto de costos. CPP es un escalar: encaja en la columna que ya existe.
2. **Método fijo, no configurable por tenant.** Sin datos productivos, si más adelante hace
   falta FIFO se agrega la columna y el branch sin migrar a nadie.
3. **El costo es de gestión, deliberadamente compatible con lo tributario.** Decisión del owner
   (2026-07-26), cierra la pregunta §6.1 de la investigación. El costo existe para margen,
   food-cost y valorización de mermas; **el número tributario lo produce el contador**, no
   nosotros. La compatibilidad consiste en usar un método que el SII admite (CPP, art. 30 LIR)
   para que el kardex le sirva de punto de partida.

   Lo que lo sostiene: el **art. 41 N°3 LIR** obliga a corregir las existencias a **costo de
   reposición** al cierre del balance. O sea, un reporte de existencias valorizadas que
   construyéramos **no sería el número tributario final de todos modos** — sería un insumo del
   contador. Construirlo como si fuera la respuesta sería falsa precisión. Es la misma forma
   del **ADR-010**: congelar el hecho en la transacción, diferir lo que solo formatea o
   transmite.
4. **Una sola regla, verificable en CI:** `item_producto.costo_actual` **nunca cambia salvo
   como consecuencia de un movimiento en `movimientos_inventario`**. Tres productores, ninguno
   más.
5. **El costo sale del form de edición del item.** No es un atributo que se tipea junto al
   nombre y el SKU: es una consecuencia de mover mercadería. Se mantiene en la **creación**
   (es el costo de apertura, y va acompañado del movimiento `inventario_inicial`).
6. **Existe una salida legítima para corregir un costo**, pero auditada: la nueva operación
   `ajuste_costo`. Sin ella, quien tipeó mal un costo y ya tiene stock inventaría una compra
   falsa para corregirlo, ensuciando stock *y* costo. Es el mismo movimiento que ya se hizo con
   las mermas: de ajuste anónimo a operación con motivo explícito.
7. **`ajuste_costo` estrena `tipo='ajuste'`**, valor ya reservado en el enum del kardex y nunca
   implementado. El recuento de inventario (eje 4 de la investigación) entrará después por la
   misma puerta con `motivo='recuento'`. No se inventa un eje nuevo.

---

## 3. Modelo de datos

### `movimientos_inventario` — columna nueva

| Columna | Tipo | Notas |
|---|---|---|
| `costo_anterior` | `NUMERIC(18,4)` NULL | Costo vigente **antes** del movimiento. Solo se puebla en `motivo='ajuste_costo'`; NULL en el resto. |

Es simétrica al par `stock_anterior` / `stock_resultante` que la tabla ya tiene: el ajuste de
costo mueve valor igual que los otros mueven cantidad, y el kardex debe poder mostrar
`anterior → nuevo` **sin una query por fila** (evita el N+1 al listar movimientos).

`costo_unitario` (ya existente) sigue congelando el costo vigente en **todos** los movimientos;
en `ajuste_costo` guarda el costo **nuevo**.

### Motivo nuevo

`movimientos_inventario.motivo` suma `'ajuste_costo'`, usado siempre con `tipo='ajuste'`.

### Permiso nuevo (seeder)

El módulo Inventario hoy solo tiene sembrados `Leer`, `Crear` y `Ver todas`
(`seeder.service.ts:714-729`). **Falta `Actualizar`** — hay que sembrarlo como
`modulo_app_permiso` con el siguiente ID libre: `550e8400-e29b-41d4-a716-446655440291`.

`item_producto.costo_actual` **no cambia de tipo ni de nombre** — cambia su semántica. Se
documenta en el comentario del esquema y en la feature doc.

---

## 4. Backend

### 4.1 La fórmula

En `registrarMovimiento`, entrada con `motivo='compra'` y `costoUnitario` presente:

```
costoNuevo = (stockAnterior × costoActual + cantidad × costoCompra) / (stockAnterior + cantidad)
```

Todo con **Decimal.js** (invariante 2). Se persiste redondeado a 4 decimales
(`NUMERIC(18,4)`), con el redondeo half-up por defecto de Decimal.js; el cálculo intermedio va
a precisión completa.

Dos bordes colapsan al mismo caso — **si `stockAnterior` es 0 o `costoActual` es NULL,
`costoNuevo = costoCompra`**: no hay masa que promediar, y de paso no se divide por cero.
(`stockAnterior` nunca es negativo: la salida que dejaría stock negativo ya se rechaza en
`moverCantidad`.)

La fórmula es **por item**, no por lote ni por unidad serializada. En modos `lote` y `serie` el
promedio se calcula igual sobre el stock total del item; los lotes y unidades no llevan costo
propio.

### 4.2 Qué mueve el promedio

| `tipo` | `motivo` | ¿recalcula `costo_actual`? | `costo_unitario` congelado |
|---|---|---|---|
| entrada | `compra` | **Sí — fórmula CPP** | costo de compra |
| entrada | `inventario_inicial` | No recalcula: el costo ya viene del INSERT de creación | costo vigente |
| entrada | `devolucion` | No | costo vigente |
| entrada | `ajuste_manual` | No | costo vigente |
| salida | cualquiera | No — por definición de CPP | costo vigente |
| **ajuste** | **`ajuste_costo`** | **Sí — override directo** | costo nuevo |

**Por qué la devolución de venta no recalcula:** la unidad que vuelve ya salió con un costo
congelado; re-promediarla metería costo de venta dentro del costo de compra. Es el
comportamiento actual y se mantiene deliberadamente.

**Por qué `inventario_inicial` no necesita cambios:** al crear un producto con costo,
`items.service` hace el INSERT de `item_producto` con `costo_actual` y recién después registra
el movimiento, que congela ese valor vía `costoActualPrevio`. Ya funciona; no se toca.

### 4.3 Cambios en `registrarMovimiento`

`inventario.service.ts`:

- La validación `cantidad <= 0 → BadRequest` se levanta **solo** para `motivo='ajuste_costo'`,
  que registra `cantidad = 0`.
- Con `tipo='ajuste'` se saltea el branch de modo (`moverCantidad` / `moverSerie` / `moverLote`):
  no hay movimiento de stock. `stock_resultante = stock_anterior`, y no se hace `UPDATE` de
  `item_producto.stock`.
- `costo_anterior` se puebla con `costoActualPrevio` cuando el motivo es `ajuste_costo`.
- El bloque `aplicaCostoNuevo` (hoy `entrada` + `compra`) pasa a un helper que decide el valor:
  CPP para la compra, override para el ajuste de costo, sin cambio para el resto.
- El `SELECT ... FOR UPDATE` sobre `item_producto` ya existente cubre la concurrencia del
  promedio: dos compras simultáneas del mismo producto se serializan.

### 4.4 Endpoint nuevo

`POST /api/inventario/ajustes-costo` en el controller de inventario ya existente (no se crea
módulo nuevo).

```
Body: { itemId: uuid, costoNuevo: numeric-string, comentario: string (requerido, no vacío) }
Guard: @RequiresPermiso('Inventario', 'Actualizar')
```

`tenant_id` y `usuario_id` salen del token (invariante 1). Valida que el item exista, sea
`tipo='producto'` y no esté eliminado; que `costoNuevo > 0`; y que `comentario` no venga vacío.
El comentario es obligatorio porque un ajuste de costo es una **corrección** y tiene que quedar
explicada — pero **no** lleva causa tipificada como las mermas: es un evento puntual, no un
fenómeno recurrente que se quiera reportar por categoría.

### 4.5 Qué se elimina

- La rama de `costo` en `items.service.ts:1183-1190` se elimina: `PATCH /items/:id` deja de
  escribir `costo_actual`.
- **`costo` NO se borra de `UpdateItemDto`** — se convierte en un campo que siempre rechaza,
  con mensaje explícito: *"El costo se ajusta desde Inventario → Ajuste de costo"*.

  Razón: el `ValidationPipe` global usa `whitelist: true` **sin** `forbidNonWhitelisted`
  (`main.ts:19`). Si simplemente se borra el campo del DTO, la propiedad se **descarta en
  silencio** y el request devuelve 200 sin haber cambiado nada — un fallo callado, peor que el
  bug que estamos arreglando. Un validador que siempre falla da un 400 con mensaje útil, es
  local al DTO, y **no** cambia el comportamiento global del pipe (activar
  `forbidNonWhitelisted` afectaría todos los endpoints y está fuera de alcance).
- `costo` **se mantiene funcional** en `CreateItemDto` (`create-item.dto.ts:202`).

---

## 5. Frontend

- **Form de items** (`configuracion/items.vue`): el campo costo sale del modo **edición** y
  queda solo en **creación**.
- **Simulador de impacto de costos — se muda, no se pierde.** Hoy `costoProductoCambio()`
  (`items.vue:818`) detecta el cambio de costo en el form y dispara el modal de desfases de
  recetas. Ese disparo pasa a las dos operaciones que ahora mueven el costo: la entrada por
  **compra** (modal de ajuste de stock) y el **ajuste de costo**. La bandeja
  `/recetas-desfases` no cambia.
- **Nueva operación de ajuste de costo**: drawer en el módulo de inventario, con el costo
  vigente visible, el nuevo, y comentario obligatorio. Sigue el patrón del drawer de mermas.
- **Kardex** (`/inventario`): la fila de un `ajuste_costo` muestra `costo_anterior → costo_unitario`
  en vez de cantidad.
- Tokens semánticos de Nuxt UI (los colores financieros de Caja no aplican acá).

---

## 6. Casos borde

| Caso | Resolución |
|---|---|
| `stockAnterior = 0` en una compra | `costoNuevo = costoCompra` |
| `costo_actual` NULL (producto creado sin costo) | `costoNuevo = costoCompra` |
| Compra **sin** `costoUnitario` | No toca `costo_actual`; congela el vigente (comportamiento actual) |
| `ajuste_costo` con stock 0 | Permitido — corrige la semilla antes de recibir mercadería |
| `ajuste_costo` con `costoNuevo` igual al vigente | Rechazado (400): no se registra un movimiento que no cambia nada |
| Producto en modo `lote` / `serie` | Idéntico: el promedio es por item, los lotes no llevan costo |
| Item que no es `tipo='producto'` | 400 — recetas y combos derivan su costo, no lo tienen propio |
| Dos compras concurrentes del mismo item | Serializadas por el `SELECT ... FOR UPDATE` ya existente |

---

## 7. Testing

- **Unit** (`inventario.service.spec.ts`): la fórmula CPP con decimales no triviales; los dos
  bordes de `stockAnterior = 0` y `costo_actual` NULL; que salida, devolución y ajuste manual
  **no** mueven el promedio; que `ajuste_costo` pisa el valor y puebla `costo_anterior`.
- **Test de invariante** (nuevo, estilo el de `type: 'uuid'` del ADR-004): ningún
  `UPDATE ... item_producto ... costo_actual` fuera de `inventario.service.ts`. Corre en el
  gate y en CI. Es la garantía de que la puerta trasera no vuelve.
- **E2E** (`test:e2e`): compras sucesivas a distinto precio → promedio esperado;
  `PATCH /items/:id` con `costo` → **400 con mensaje explícito** (no 200 silencioso — ver §4.5);
  `POST /inventario/ajustes-costo` → movimiento en el kardex con `costo_anterior` y
  `costo_unitario`; el permiso `Inventario/Actualizar` se exige.
- **Smoke de navegador** del drawer nuevo antes de cerrar (los drawers no tienen test unit y
  build/typecheck no ven bugs de runtime).

---

## 8. Fuera de alcance

- FIFO, capas de costo y elección de método por tenant — decisiones 2 y 3.
- Módulo de compras / órdenes de compra / recepción parcial (eje 3 de la investigación).
- Recuento de inventario y `motivo='recuento'` (eje 4).
- Bodegas y traslados (eje 2).
- *Landed cost* (flete e impuestos prorrateados al costo unitario).
- Reporte de existencias valorizadas y corrección monetaria — decisión 3: el número tributario
  lo produce el contador. Lo que sí queda pendiente como insumo útil (no en esta spec) es un
  **kardex valorizado exportable**.
- Costo por lote o por unidad serializada.
- Recálculo histórico de movimientos ya registrados: el kardex es inmutable, el cambio rige
  hacia adelante. Sin datos productivos no hay backfill que hacer — se actualiza el seeder y se
  resetea.

---

## 9. Documentación a actualizar (mismo commit)

| Archivo | Qué cambia |
|---|---|
| `docs/features/inventario-kardex.md` | Semántica de `costo_actual`, tabla de motivos, `ajuste_costo`, endpoint nuevo |
| `docs/adr/016-costeo-promedio-ponderado-movil.md` | ADR nuevo: por qué CPP y no FIFO, por qué fijo y no configurable, y por qué el costo es de gestión y no tributario (art. 41 N°3 LIR) |
| `docs/adr/README.md` | Índice |
| `docs/ESTADO.md` | Fila de la funcionalidad |
| `docs/PRODUCTO.md` | Regla de negocio: cómo se determina el costo de un producto |
| `docs/agent/anti-patterns.md` | El patrón "campo que escribe estado derivado sin pasar por su choke point" |
| `startup-pos.sql` | `costo_anterior`, motivo nuevo, comentario de `costo_actual` |
| `backend/src/modules/seeder/seeder.service.ts` | Permiso `Inventario/Actualizar` (…291) + costos coherentes |
