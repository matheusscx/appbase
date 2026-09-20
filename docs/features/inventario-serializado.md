# Feature: Inventario serializado y por lote

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-06-28

---

## Overview

### What is it?

Extiende el kardex de inventario con dos modos adicionales por producto:

- **`serie`** — cada unidad tiene identidad propia (IMEI, número de serie). El stock = conteo de unidades en estado `disponible`.
- **`lote`** — las unidades se agrupan por lote con fecha de vencimiento. El stock = suma de `cantidad_disponible` en todos los lotes.
- **`cantidad`** — modo anterior (fungible), sin cambios.

### Why does it exist?

El modelo original con un único número por ítem (`item_producto.stock`, columna que se borró en 2026-09-06 cuando el saldo pasó a `stock_ubicacion`) no permitía:
- Rastrear celulares por IMEI (devoluciones, garantías, robo).
- Controlar vencimiento de productos farmacéuticos o alimenticios por lote.

### Scope

Incluido:
- Eje `modo_inventario` en `item_producto`.
- Tablas `item_unidad`, `item_lote`, `movimiento_inventario_detalle`.
- Lógica completa en `registrarMovimiento` (entrada/salida por modo).
- Endpoints `GET /items/:id/unidades` y `GET /items/:id/lotes`.
- Frontend: selector de modo, captura de series/lotes en el form y en el modal de ajuste, modal "Ver unidades / lotes".
- Seeder con producto serie (iPhone, 3 IMEIs) y producto lote (Paracetamol).

No incluido (futuro):
- Estado `reservado` producido por ventas (el modelo lo soporta, el productor aún no existe).
- FEFO automático en salida de lotes (el usuario elige el lote).
- Pegado masivo/CSV de series.
- Costeo/valoración de stock por unidad.

---

## API Endpoints

### GET /items/:id/unidades

Retorna las unidades del item (modo `serie`). Acepta `?estado=disponible|reservado|vendido|baja`.

```
GET /items/550e8400.../unidades?estado=disponible
Authorization: Bearer <token>

Response (200):
[
  {
    "id": "uuid",
    "serie": "359999112345678",
    "estado": "disponible",
    "condicion": "nuevo",
    "garantiaHasta": "2026-12-31T00:00:00.000Z",
    "loteId": null,
    "codigoLote": null,
    "creadoEl": "2026-06-28T..."
  }
]
```

### GET /items/:id/lotes

Retorna los lotes del item (modo `lote`).

```
GET /items/550e8400.../lotes
Authorization: Bearer <token>

Response (200):
[
  {
    "id": "uuid",
    "codigoLote": "LOT-20260101",
    "fechaElaboracion": "2026-01-01T00:00:00.000Z",
    "fechaVencimiento": "2027-01-01T00:00:00.000Z",
    "cantidadInicial": "500.0000",
    "cantidadDisponible": "450.0000",
    "creadoEl": "2026-06-28T..."
  }
]
```

### PATCH /items/:id/stock — modo serie entrada

```json
{
  "tipo": "entrada",
  "motivo": "compra",
  "cantidad": "3",
  "series": [
    { "serie": "359999112345678", "condicion": "nuevo", "garantiaHasta": "2026-12-31" },
    { "serie": "359999112345679", "condicion": "nuevo" }
  ]
}
```

### PATCH /items/:id/stock — modo serie salida

```json
{
  "tipo": "salida",
  "motivo": "ajuste_manual",
  "cantidad": "1",
  "unidadIds": ["uuid-de-la-unidad"]
}
```

### PATCH /items/:id/stock — modo lote entrada

```json
{
  "tipo": "entrada",
  "motivo": "compra",
  "cantidad": "100",
  "lote": {
    "codigoLote": "LOT-20260101",
    "fechaElaboracion": "2026-01-01",
    "fechaVencimiento": "2027-01-01"
  }
}
```

### PATCH /items/:id/stock — modo lote salida

```json
{
  "tipo": "salida",
  "motivo": "merma",
  "cantidad": "10",
  "loteId": "uuid-del-lote"
}
```

---

## Backend

### Module & Services

- **Items module**: `src/modules/items/items.module.ts`
- **Inventario service** (movimientos): `src/modules/inventario/inventario.service.ts`

### Entities

**`item_producto`** — nueva columna: `modo_inventario TEXT NOT NULL DEFAULT 'cantidad'`

**`item_unidad`** — una fila por unidad física

| Column | Type | Notes |
|--------|------|-------|
| `unidad_id` | UUID PK | |
| `tenant_id` | UUID | |
| `item_id` | UUID FK → items | |
| `lote_id` | UUID FK → item_lote, nullable | metadato opcional |
| `serie` | TEXT | IMEI u otro código; único por producto, comparado sin bordes ni mayúsculas. Se guarda tal como se tipeó |
| `estado` | TEXT | `disponible / reservado / vendido / baja` |
| `condicion` | TEXT | `nuevo / usado / reacondicionado` |
| `garantia_hasta` | TIMESTAMPTZ nullable | |
| `venta_id` | UUID nullable | FK futuro a ventas |

Índice único: `uq_unidad_item_serie` sobre
`(item_id, lower(btrim(serie, <blancos>))) WHERE eliminado_el IS NULL`, donde `<blancos>` es la
lista explícita de `serieNormalizadaSql` (`item-unidad.entity.ts`).

**Por producto, no por tenant** (owner, 2026-09-19): cada proveedor numera como quiere y no
hay estándar global, así que dos productos distintos del mismo tenant **sí** pueden repetir
número. `tenant_id` no entra en la clave porque `item_id` ya lo determina.

**Se compara normalizada; se guarda literal** (owner, 2026-09-20). Textual: *"«ABC123» y
«abc123 » sí son iguales, guardemos en la base de datos tal como tipea el usuario y la
validación la hacemos con upper o lower case"*. O sea:

- Para decidir si una serie ya existe, no cuentan **los blancos de los bordes** ni **las
  mayúsculas**: `ABC123`, `abc123` y `abc123 ` son la misma serie.
- **Blanco de borde** es espacio, tab, LF, CR, form feed, tab vertical y NBSP, enumerados uno
  por uno en `serieNormalizadaSql`. ⚠️ No es cosmético: **`btrim(serie)` sin lista recorta solo
  el espacio ASCII**, así que la primera versión de esta regla dejaba entrar `\tABC123\t` como
  una segunda unidad junto a `ABC123` — el mismo duplicado silencioso, por otro borde. Lo
  levantó la revisión de seguridad y lo fija una tabla de casos en el e2e. Los espacios Unicode
  exóticos (U+2000–U+200A, U+3000…) quedan **fuera a propósito**: no salen de un teclado ni de
  un lector, y una serie que sea solo blancos igual rebota porque el `\S` de JS los cubre.
- Lo que se **guarda** es el texto tal como lo tipeó el operador, con sus mayúsculas y sus
  espacios. Normalizar es para comparar, nunca para escribir.
- El espacio **de adentro** sí distingue: `ABC 123` y `ABC123` son dos series distintas. La
  normalización recorta los bordes, no el contenido.
- Una serie que queda vacía al normalizar —solo blancos— se rechaza con 400. La piden las
  tres DTO con `@Matches(/\S/)` (`@IsNotEmpty` no distingue `"   "` de contenido real), y el
  chokepoint la vuelve a rechazar para cualquier llamador que no venga de HTTP.
- La serie tiene tope de **100 caracteres** (`@MaxLength`) y la tanda de **200 series**
  (`@ArrayMaxSize`, el mismo que ya usaba compras). El de largo no es cosmético: la serie
  participa de un índice por expresión y btree corta en ~2,7 KB por entrada, así que sin tope
  una serie enorme rebota con un error de Postgres sin mapear —un 500— en el mismo chokepoint
  que da 400 para todo lo demás.

⚠️ **El índice lo crea el seeder, no la entity** (`SeederService.seedItemUnidadSerieIndex()`).
No es un detalle de estilo: **TypeORM no sabe expresar una función en `@Index`**, así que
declarado en la entity `synchronize` crea uno sobre la columna pelada —que acepta `ABC123` y
`abc123` como dos series distintas—, o sea la regla equivocada. Es el mismo molde que los
índices de `lower(nombre)` (`seedPromocionesIndices()`, `seedGruposModificadores()`), con su
misma contrapartida: en dev `synchronize` puede dejar la tabla sin el índice hasta que el
seeder lo recree, así que la red de la base depende de que el seeder corra y no falle.
Detalle del criterio entity-vs-seeder: [`../patterns/backend.md`](../patterns/backend.md).

Los cuatro caminos que crean unidades —alta de producto en modo serie con stock inicial,
ajuste/entrada manual de stock, confirmación de compra y corrección de cantidad de una
compra— pasan todos por `InventarioService.moverSerie`, el único lugar que inserta en
`item_unidad`. Ahí se rechaza con **400 nombrando la serie** repetida —la mandada y, si
difieren, también la que ya está guardada: *"«abc123 » ya existe como «ABC123»"*—, tanto para
la que ya está viva como para dos que normalizan igual en la misma tanda. El índice es la red
de la base, no el mensaje que ve el operador.

📌 **La normalización la hace Postgres, de los dos lados de la comparación.** El guard no
normaliza en JavaScript: le pasa las series crudas y deja que la base calcule
`lower(btrim(...))` tanto para la columna como para lo que entra. El motivo es que
`toLowerCase()` de JS y `lower()` de Postgres **no coinciden fuera de ASCII** (`lower()`
depende de la collation), y una discrepancia ahí devuelve el 500 del índice que el guard
existe para evitar.

📌 **Qué NO cambió con la normalización, y hay un test que lo fija:** `corregirCantidad` cruza
las series guardadas en el JSON de `compra_lineas.series` contra las de `item_unidad` **por
texto exacto**, y sigue funcionando porque los dos lados guardan literal lo tipeado — nacen
del mismo string. Si alguien normalizara al escribir en un solo lado, ese cruce dejaría de
matchear en silencio; lo cubre *"bajar la cantidad sigue cruzando bien una serie guardada con
espacios"* en `compras.e2e-spec.ts`.

**`item_lote`** — un fila por lote

| Column | Type | Notes |
|--------|------|-------|
| `lote_id` | UUID PK | |
| `tenant_id` | UUID | |
| `item_id` | UUID FK → items | |
| `codigo_lote` | TEXT | |
| `fecha_elaboracion` | TIMESTAMPTZ nullable | |
| `fecha_vencimiento` | TIMESTAMPTZ nullable | |
| `cantidad_inicial` | NUMERIC(18,4) | |
| `cantidad_disponible` | NUMERIC(18,4) | saldo (decrementado en salidas) |

Índice único: `(item_id, codigo_lote) WHERE eliminado_el IS NULL`

**`movimiento_inventario_detalle`** — liga movimiento con unidades/lotes

| Column | Type | Notes |
|--------|------|-------|
| `detalle_id` | UUID PK | |
| `movimiento_id` | UUID FK | |
| `unidad_id` | UUID nullable | modo serie |
| `lote_id` | UUID nullable | modo lote |
| `cantidad` | NUMERIC(18,4) | 1 por unidad, N por lote |

### Key Methods (inventario.service.ts)

- `registrarMovimiento(manager, params)` — dispatcher por modo
- `moverCantidad()` — comportamiento original
- `moverSerie()` — crea/consume `item_unidad`
- `moverLote()` — crea/actualiza `item_lote`
- `recalcularStockSerie()` / `recalcularStockLote()` — actualiza el saldo de `stock_ubicacion` para la ubicación del movimiento, dentro de la transacción

---

## Frontend

### Pages

`pages/configuracion/items.vue` — todo en esta página, sin páginas nuevas.

### UI por modo

**Form crear producto:**
- `USelectMenu` para `modoInventario` (solo en creación, inmutable si hay movimientos).
- Modo `cantidad`: stock inicial + unidad de medida + fechas genéricas.
- Modo `serie`: lista inline de series (serie + condición + garantía). El count = stock inicial.
- Modo `lote`: campos de lote inicial opcionales (código, fechas, cantidad).

**Modal ajuste de stock:**
- Modo `cantidad`: igual que antes (cantidad numérica).
- Modo `serie` entrada: agregar N series.
- Modo `serie` salida: checkboxes sobre unidades disponibles (cargadas desde `GET /items/:id/unidades?estado=disponible`).
- Modo `lote` entrada: código de lote + fechas + cantidad.
- Modo `lote` salida: ID del lote + cantidad a retirar.

**Modal "Ver unidades / lotes"** (botón en la lista para productos `serie` o `lote`):
- Modo `serie`: tabla con serie, estado, condición, garantía, lote asociado.
- Modo `lote`: tabla con código, cantidad inicial, disponible, fechas, ID (select-all para copiar).

---

## Testing

```bash
cd backend && npm test -- --no-coverage
# inventario.service.spec.ts: 13 tests de entrada/salida por modo
# items.service.spec.ts: tests de create con modo, bloqueo de cambio de modo
```

---

## Related Features

- [Inventario kardex](./inventario-kardex.md) — modelo base que este feature extiende
- [ADR-007](../adr/007-inventario-serie-lote.md) — decisión de arquitectura del eje `modo_inventario`
