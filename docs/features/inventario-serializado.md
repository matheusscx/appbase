# Feature: Inventario serializado y por lote

**Status**: Complete  
**Owner**: Cesar Matheus  
**Last Updated**: 2026-10-03 (quien vende elige qué unidad con serie sale)

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
- Qué lote sale cuando nadie lo elige (FEFO, 2026-10-03) — ver [Qué lote sale](#qué-lote-sale).
- Qué unidad con serie sale: la elige quien vende, nunca el sistema (2026-10-03) — ver
  [Quién elige qué unidad sale](#quién-elige-qué-unidad-con-serie-sale).

El seeder no siembra productos de serie ni de lote: los e2e arman el suyo, con nombre propio.

No incluido (futuro):
- Estado `reservado` producido por ventas (el modelo lo soporta, el productor aún no existe y
  no hace falta: lo apartado por una mesa se deriva de la cuenta abierta, ver
  [Lo apartado](#lo-apartado-por-una-cuenta-abierta)).
- La merma de un producto con serie: hoy se rechaza (se da de baja desde Ajuste de stock); que
  la merma pregunte qué unidad es un frente propio.
- Pegado masivo/CSV de series.
- Costeo/valoración de stock por unidad.

---

## API Endpoints

### GET /items/:id/unidades

Retorna las unidades del item (modo `serie`). Acepta `?estado=disponible|reservado|vendido|baja`
y `?vendibles=true` (la lista del selector de la pantalla de venta, ver
[abajo](#qué-unidades-se-ofrecen-vendibles)). El query es un DTO estricto
(`QueryUnidadesDto`): `vendibles` solo acepta `true` o `false` y un parámetro desconocido es 400.

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

`unidadIds` es **obligatorio** y trae tantas como `cantidad`, hasta 200 (el mismo techo que la venta, el salón y los traslados): el sistema no elige.

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

### Qué lote sale

La venta del POS y la de salones nunca mandan `loteId`, y la merma no lo acepta: el lote lo
elige el chokepoint (`moverLote`). La regla es del owner (2026-09-28): **sale primero el que
vence antes**, porque en comida es lo que evita tirar mercadería.

- Orden: `fecha_vencimiento` (el día), los lotes **sin vencimiento al final**; dentro del mismo
  día, la **llegada** (`creado_el`); dos lotes de la misma factura llegan juntos, así que
  desempata **`codigo_lote`** —lo que el usuario ve en la caja— y la PK cierra un orden total.
  Ese orden es también el de los `FOR UPDATE` sobre `item_lote`, y por eso tiene que ser total.
- **Vencido** es el lote cuyo día ya pasó en el calendario del local (zona de la provincia):
  el día del vencimiento todavía se vende, y vence a **medianoche**, no a la hora de corte del
  negocio (owner, 2026-10-03: la fecha de la etiqueta es de calendario). Por eso
  `inventario.service.ts` está en la allowlist de reloj de `dia-negocio.invariant.spec.ts`. El día se lee con `::date` en la sesión de la base,
  el mismo cast con que se guardó la fecha pura que manda la pantalla. ⚠️ El DTO también acepta
  un timestamp con hora y huso: un cliente de API que mande `2027-01-15T22:00:00-03:00` queda
  con el día 16 en una sesión UTC, y ese lote se vende un día de más. La pantalla no lo hace.
- **La venta salta los vencidos** y saca del siguiente (owner, 2026-09-28: un vencido se merma,
  no se vende); vale para los ingredientes de una receta, que salen con motivo `venta`. Si sin
  ellos no alcanza, el 400 dice cuánto hay vencido. Un vencido **elegido a mano** en una venta
  también es 400.
- **El traslado sin lote elegido también los salta** (owner, 2026-10-03): se quedan donde están
  para mermarlos ahí. Elegido a mano, sí viaja.
- **La merma, el ajuste, el recuento y la compra no los saltan.** La merma sin lote elegido se
  lleva primero el vencido, que es justo lo que hay que hacer con él.
- Costo aceptado: el stock cuenta los vencidos hasta que alguien los merme, así que puede
  mostrar más de lo que se puede vender.

Medido contra la API real en `test/lote-fefo.e2e-spec.ts` (el yogur de enero y junio en la
misma factura, desempate, sin fecha, y los vencidos en venta, traslado y merma).

### Quién elige qué unidad con serie sale

**La regla:** en un producto con número de serie, **nadie elige por quien vende**. La escena
que lo motivó: en una misma compra entran un celular **nuevo** y uno **usado** del mismo
producto; la salida vieja tomaba "las más antiguas" sin mirar la condición, y ninguna pantalla
de venta mandaba qué unidad, así que se podía cobrar el usado como nuevo. Desde el 2026-10-03
la salida de modo serie **siempre nombra sus unidades**: `moverSerie` ya no auto-selecciona, y
sin `unidadIds` responde 400 (*"Elegí qué unidades salen: «Nombre» tiene número de serie"*).
Quien elige es el cajero en el POS (al tocar el producto) o el garzón en el salón (al pedir).
Va en el chokepoint y no en cada llamador porque es el único lugar por el que pasan todas las
salidas: un camino olvidado, o uno que se agregue mañana, rechaza en vez de elegir.

**Cómo se decidió** (spec del frente, borrada al integrar y recuperable de git; cada una con su
procedencia, porque "owner, fecha" a secas se lee como congelada):

| Decisión | Quién y cómo |
|---|---|
| Elige quien vende, nunca el sistema | Owner, 2026-09-28, "vamos A" en el selector interactivo de la orquestadora (*A: elige el cajero*, recomendada; *B: el sistema prefiere una condición*; *C: da lo mismo*) |
| Sin compatibilidad: la API exige la unidad | Owner, 2026-09-29, en el selector de la orquestadora: *"no tenemos pantallas mas viejas ni tenemos datos productivos"* |
| Combos y grupos no pueden incluir un producto con serie | Owner, 2026-10-03, AskUserQuestion de la sesión del frente: *"Prohibirlo al armar"* (recomendada) sobre *"Preguntar la unidad también ahí"* y *"Dejarlo automático"*. Costo aceptado: "celular + funda" se vende como dos líneas, y el precio de pack se arma con una promoción |
| En el salón la elige el garzón, al pedir | Owner, 2026-10-03, AskUserQuestion: *"Al pedir, el garzón"* (recomendada) sobre *"Al cobrar, el cajero"*. Quien entrega es quien elige, y si otra mesa pidió la misma unidad el rechazo llega al pedir, no al cobrar |
| La tienda online no vende productos con serie | Owner, 2026-10-03, AskUserQuestion: *"No se venden online"* (recomendada) sobre *"Online sale automática"*. Sin cajero no hay quién elija, y rechazar después de Webpay deja un cobro sin venta |
| La serie vendida se ve en el detalle de la venta | Owner, 2026-10-03, AskUserQuestion: *"En el detalle de la venta"* (recomendada). La boleta impresa no cambia (es materia fiscal, frente propio) |
| La merma rechaza el producto con serie por ahora | Owner, 2026-10-03, AskUserQuestion: *"La merma lo rechaza"* (recomendada) |
| Cancelar con motivo una cuenta con una línea con serie despachada a medias se frena, salvo con "no elaborado" | Owner, 2026-10-03, AskUserQuestion: *"Pedir anular primero"* (recomendada) sobre *"Dar de baja todas"*. La excepción del "no elaborado" (ninguna unidad sale de inventario, no hay cuál elegir) la tomó el controlador del frente al implementar: [`salones-mesas.md`](./salones-mesas.md) |
| En una línea del salón con algo despachado, las unidades que tiene no se cambian ni se sacan: solo se agregan | Owner, 2026-10-03, *"No se cambia"* (recomendada) sobre *"Se cambia, con registro"* y *"Dejarlo como está"*, en una AskUserQuestion de la Sesión de esfuerzo máximo que le llegó a la orquestadora. La unidad despachada está en la mesa: sacarla de la línea la volvía a ofrecer, el POS la vendía y al cobrar el kardex registraba la otra. Para sacar una, Anular |

**Los caminos, cada uno con lo que hace:**

| Camino | Con un producto con serie |
|---|---|
| `POST /ventas` (POS) | `unidadIds` obligatorio, tantas como `cantidad`. Contrato: [`ventas.md`](./ventas.md) |
| Salón (pedir, cambiar, anular, cancelar con motivo, fusionar, cobrar) | La unidad viaja en la línea de la cuenta. Contrato: [`salones-mesas.md`](./salones-mesas.md) |
| Componente de combo / opción de grupo | No se puede configurar (400 al guardar el combo o el grupo) |
| Pasar a modo serie un producto que ya es componente u opción viva | 400: antes el cambio de modo solo se bloqueaba con movimientos, y este hueco era nuevo |
| Tienda online | `GET /items?vendibleOnline=true` los deja afuera del catálogo y `OnlineService.checkout` rechaza la línea **antes** de iniciar el pago |
| Merma (`POST /mermas`) | 400; la pantalla muestra el aviso y deshabilita Registrar (no esconde el producto: quien busca el celular roto no entendería por qué no aparece). La baja se hace desde Ajuste de stock |
| Ajuste de stock y traslado por API | Sin unidades, 400; la pantalla ya las mandaba |
| Recuento, cancelar venta con reposición, nota de crédito con devolución | Ya rechazaban serie; no cambian |

**El ingrediente de una receta en modo serie no existe**: un ingrediente solo admite modo
`cantidad`, así que ahí nunca hubo nada que elegir.

#### Lo apartado por una cuenta abierta

Una unidad que está en una línea de una **cuenta abierta** está apartada: solo puede salir por
esa misma cuenta. Cualquier otra salida (otra venta, un ajuste, un traslado) responde 400
nombrando la serie y la mesa. `RegistrarMovimientoParams.cuentaId` es la cuenta dueña de la
salida (la que se cobra o la que anula su línea).

**El apartado se deriva, no se escribe.** Mientras está en una cuenta abierta la unidad sigue
`disponible`. No se usó el estado `reservado` porque cambiaría el saldo (`COUNT(disponible)`)
sin un movimiento en el kardex, que es la fuente de verdad auditable. Es la misma idea que lo
apartado en modo cantidad ([`salones-mesas.md`](./salones-mesas.md)): ningún camino que toca la
línea necesitó código nuevo para liberar, porque una cuenta que deja de estar `abierta` suelta
sola sus unidades.

#### La validación es una sola

`InventarioService.bloquearUnidadesParaSalida` valida un conjunto de unidades para un ítem y las
lockea. Lo usan la salida de `moverSerie` y el salón al pedir (así las reglas no se duplican).
Comprueba: que no vengan repetidas, que sean de este tenant y de este ítem (una ajena o borrada
da el mismo mensaje que una de otro producto, para no ser un oráculo entre tenants), que estén en
esta ubicación (el local: una bodega guarda stock y nunca vende), `disponible` y no apartadas por
otra cuenta.

Orden de bloqueo: `item_producto` primero (`FOR UPDATE`, lo toma el método por su cuenta porque un
`PATCH` del salón que cambia una unidad por otra sin cambiar la cantidad no pasa por la reserva
de stock), y después las unidades en **una** consulta con `ORDER BY unidad_id FOR UPDATE`.
Pedir en el salón y vender en el POS se serializan en el lock de `item_producto`, por eso no
hace falta un índice único sobre lo apartado (y no podría expresarlo: "apartada" depende de
`cuentas.estado`). Orden global: cuenta → `item_producto` → `item_unidad`.

#### Qué unidades se ofrecen: `vendibles`

`GET /items/:id/unidades?vendibles=true` devuelve solo las `disponible` **del local** y no
apartadas por ninguna cuenta abierta, ordenadas por condición (nuevo, reacondicionado, usado) y
después por serie. Mismo permiso que el endpoint (`Items:Leer`). **Es una ayuda para la pantalla,
no la regla:** entre que el selector lista y el cobro, otra caja puede vender la misma unidad, y
el 400 de la API es el que manda.

#### Qué se ve

- **Detalle de venta:** `GET /ventas/:id` trae `unidades: [{ serie, condicion }]` en la línea de un
  producto con serie, leídas del kardex en una consulta por venta. Se agrupan **por ítem**, no por
  línea (el kardex no guarda a qué línea pertenece cada salida): con dos líneas del mismo producto
  con serie —solo pasa en el salón, con el precio o las reglas cambiados entre pedidos; el POS las fusiona— cada
  una muestra todas las unidades de ese producto en la venta. Se arregla guardando las unidades en
  `venta_detalles`; nadie lo pidió.
- **Selector** (`UnidadesSerieModal`): serie, condición como badge, garantía, buscador por serie
  (sirve para pegar o escanear el IMEI) y selección múltiple; la cantidad es cuántas se eligieron.
  En una línea del salón ya despachada, las unidades que tiene se ven marcadas y no se desmarcan
  (prop `fijas`), con un aviso que manda a Anular.

#### Lo que sigue abierto

- Que la merma pregunte qué unidad o lote es: frente propio ([`pendientes.md`](../agent/pendientes.md) § 6, "Serie y lote están a medias").
- Restaurar desde la papelera un combo o grupo cuyo producto pasó a serie mientras estaba borrado
  no se cubre: queda configurado y la venta lo rechaza con 400 sin elegir unidad (entrada nueva en
  [`pendientes.md`](../agent/pendientes.md) § 2).
- Devolver una unidad al stock al cancelar una venta o emitir una nota de crédito sigue siendo a
  mano desde Inventario.
- Precio distinto según la condición, y la serie en la boleta impresa (fiscal): fuera.

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
- `moverSerie()` — crea/consume `item_unidad`; la salida exige `unidadIds` y valida con `bloquearUnidadesParaSalida()`
- `bloquearUnidadesParaSalida()` — la validación y el lock de unidades de una salida, compartida con el salón ([arriba](#la-validación-es-una-sola))
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
- Venta (POS y salón): al tocar un producto con serie se abre el selector de unidades (`UnidadesSerieModal`); la línea guarda sus unidades, las muestra y no deja editar la cantidad a mano ("Cambiar unidades" reabre el selector; en una línea del salón ya despachada, las que tiene no se desmarcan). Anular una línea con serie pide con casillas cuáles se anulan. Mermas muestra el aviso y no deja registrar.
- Modo `lote` entrada: código de lote + fechas + cantidad.
- Modo `lote` salida: ID del lote + cantidad a retirar.

**Modal "Ver unidades / lotes"** (botón en la lista para productos `serie` o `lote`):
- Modo `serie`: tabla con serie, estado, condición, garantía, lote asociado.
- Modo `lote`: tabla con código, cantidad inicial, disponible, fechas, ID (select-all para copiar).

---

## Testing

```bash
cd backend && npm test -- --no-coverage
# inventario.service.spec.ts: entrada/salida por modo, y la validación de unidades de la salida serie
# items.service.spec.ts: tests de create con modo, bloqueo de cambio de modo, vendibles, vendibleOnline
npm run test:e2e -- venta-serie salon-serie tienda-merma-serie inventario-serie-ubicacion traslados
cd ../frontend && npm run e2e -- e2e/ventas/venta-serie.spec.ts e2e/salones/salon-serie.spec.ts
```

Los e2e de serie arman su propio producto (el seed no trae ninguno). Los de navegador cargan las
dos unidades en **entradas separadas**: en una sola entrada comparten `creado_el` y el FIFO viejo
(`creado_el ASC`) quedaba en un empate que no distinguía nada.

---

## Related Features

- [Inventario kardex](./inventario-kardex.md) — modelo base que este feature extiende
- [ADR-007](../adr/007-inventario-serie-lote.md) — decisión de arquitectura del eje `modo_inventario`
