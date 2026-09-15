# Feature: Mermas tipificadas y valorizadas

**Status**: Complete  
**Last Updated**: 2026-08-28

---

## Overview

### What is it?

Registro dedicado de mermas de stock en productos (`tipo='producto'`) con **motivo tipificado por tenant**, conversión de unidad opcional y **costo congelado en el kardex**. **El costo no se tipea: sale de `item_producto.costo_actual`.** El formulario de merma solo pide cantidad y motivo; el sistema valoriza con el costo vigente del ítem al momento de mermar. Si el ítem no tiene costo cargado, la merma **se registra igual, sin valorizar, y queda así para siempre** — no existe un ajuste posterior que le ponga costo a una merma vieja, mismo criterio que el precio congelado de una venta y que [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md) con el hecho fiscal. El impacto financiero (`costoPerdido = cantidad × costo_unitario`) se calcula al leer el movimiento, y es `null` cuando no hay costo. La merma **nunca** actualiza `item_producto.costo_actual`.

Decisión y porqué: [`docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md`](../superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md).

Motivos fijos del sistema (`es_fijo=true`): son **siete**, cada uno con su `tipo` (tabla completa
en *Modelo de datos*, § `motivo_baja`). Cinco son `tipo='merma'` — **Vencimiento**, **Deterioro**,
**Robo**, **Error operativo**, **Otro**. Los otros dos, **Cortesía de la casa** (`cortesia`) y
**No se llegó a hacer** (`no_elaborado`), **no son de merma**: por eso `POST /api/mermas` los
rechaza con 400 (ver más abajo). Ninguno de los siete se edita ni se elimina. El administrador
puede crear motivos custom adicionales.

El ajuste genérico de stock (`PATCH /items/:id/stock`) **ya no acepta** `motivo='merma'`; toda merma pasa por el flujo dedicado con motivo obligatorio.

### Why does it exist?

Food-service necesita saber *por qué* se perdió stock y cuánto costó, no solo un movimiento anónimo. Cierra la pieza 4 del cluster recetas/costos, reutilizando costo por producto (pieza 1) y conversión de unidades (pieza 2).

### Scope

**Included:**
- Tabla `motivo_baja` por tenant + columna `motivo_baja_id` en `movimientos_inventario`.
- Semilla de 7 motivos fijos al crear tenant y en el seeder de desarrollo.
- CRUD `/api/motivos-baja` y registro/listado `/api/mermas`.
- UI: configuración de motivos, operación de mermas (drawer sin campo de costo; cartel no bloqueante cuando el producto no tiene costo cargado), kardex con motivo y costo perdido.
- Quitar opción Merma del modal de ajuste de stock en items.
- Mismo cartel no bloqueante en la entrada por compra (`configuracion/items.vue`), porque el dato de costo se carga ahí, no al mermar.
- Marca **Sin costo** y filtro `sinCosto` en el listado de ítems (ver [`inventario-kardex.md`](./inventario-kardex.md) § *"Ítems sin costo"*).

**NOT included (future):**
- Reporte fiscal/DTE de mermas.
- Merma automática por rendimientos de recetas.
- **Reporte de mermas** (agregación, ej. "cuánto se perdió este mes"): no existe hoy. Cuando se construya, tiene que mostrar cuántas mermas quedaron sin valorizar — ver `docs/agent/pendientes.md`.
- **Valorización manual posterior**: descartada a propósito, no diferida — es la misma razón que congela el precio de una venta ya emitida.

---

## Modelo de datos

### `motivo_baja`

| Column | Type | Notes |
|--------|------|-------|
| `motivo_baja_id` | UUID PK | |
| `tenant_id` | UUID FK | Del token |
| `nombre` | TEXT | Único vivo por tenant, **entre todos los tipos** |
| `activo` | BOOLEAN | Default `true` |
| `es_fijo` | BOOLEAN | Defaults del sistema |
| `tipo` | ENUM `tipo_motivo_baja` | `merma` \| `cortesia` \| `no_elaborado`. Obligatorio, sin default. |
| `creado_el` / `actualizado_el` / `eliminado_el` | TIMESTAMPTZ | Soft delete |

**El tipo decide si la baja descuenta stock** (lo consume la parte 2 del frente "anular un
plato enviado a cocina", fuera de esta feature): `merma` y `cortesia` descuentan; `no_elaborado`
no. No hay un flag aparte a propósito — permitiría una merma que no descuenta, que no significa
nada.

Los siete fijos que siembra el sistema (seeder y alta de tenant, `MOTIVOS_BAJA_FIJOS`):

| Nombre | Tipo |
|--------|------|
| Vencimiento | `merma` |
| Deterioro | `merma` |
| Robo | `merma` |
| Error operativo | `merma` |
| Otro | `merma` |
| Cortesía de la casa | `cortesia` |
| No se llegó a hacer | `no_elaborado` |

**El tipo de un motivo propio se puede cambiar solo mientras no se usó.** "Usado" es lo mismo
que ya bloquea el borrado: algún movimiento de inventario vivo con ese motivo. `PATCH
/api/motivos-baja/:id` con `tipo` devuelve `400` si el motivo ya tiene movimientos —
cambiarlo después reescribiría la historia: un *"Se quemó"* pasado a `no_elaborado` haría que
un plato que salió de la cocina figure como que nunca gastó stock. Los fijos siguen sin poder
editarse ni borrarse (mismo 400 de siempre, no depende del campo que se mande).

### `movimientos_inventario` (extensión)

| Column | Type | Notes |
|--------|------|-------|
| `motivo_baja_id` | UUID NULL FK | Obligatoria iff `motivo='merma'` |

---

## API

### CRUD `/api/motivos-baja`

- `GET` — cualquier usuario del tenant; query `?soloActivas=true` filtra activas, `?tipo=merma|cortesia|no_elaborado` filtra por tipo. Cada fila trae `enUso: boolean` — sale de la MISMA consulta del listado (un `EXISTS` sobre `movimientos_inventario`), nunca de una consulta por motivo.
- `POST` — `TenantAdminGuard`; `tipo` es obligatorio, sin default (el admin lo elige).
- `PATCH /:id` — `TenantAdminGuard`; rechaza editar `es_fijo=true`. Cambiar `tipo` de un motivo ya usado en movimientos da `400` (ver arriba); el resto de los campos no cambia de regla.
- `DELETE /:id` — `TenantAdminGuard`; rechaza borrar `es_fijo=true`; soft-delete bloqueado si hay movimientos con ese motivo.

### `POST /api/mermas`

Permiso: **Inventario:Crear**.

```
POST /api/mermas
Authorization: Bearer <token>

Request (CreateMermaDto):
{
  "itemId": "<uuid>",
  "ubicacionId": "<uuid>",
  "cantidad": "250",
  "motivoBajaId": "<uuid>",
  "unidadCodigo": "g",
  "comentario": "Lote vencido"
}
```

**`ubicacionId` es obligatorio** (desde [bodegas y traslados](./bodegas-y-traslados.md)): se
merma lo que se pudrió **ahí**, y sin default silencioso — uno metería la salida en el local
cada vez que la pantalla se olvide de mandarlo. `400` si falta o es de otro tenant.

`POST /api/mermas` rechaza con 400 un motivo que no sea de tipo `merma` — la pantalla de
Mermas ya filtra su selector con `tipo=merma`, pero el filtro de pantalla no alcanza: el
servidor es el que manda.

**Reglas de costo:**
- **El costo no se tipea ni se acepta en el request** — `CreateMermaDto` no tiene ningún campo de costo. El endpoint valoriza con `item_producto.costo_actual` vigente al momento de mermar.
- Con `costo_actual` → lo congela en `costo_unitario` del movimiento y calcula `costoPerdido`.
- Sin `costo_actual` → la merma se registra igual; `costoUnitario` y `costoPerdido` viajan en `null`. **No hay 400, no hay override por movimiento.** El ítem queda sin valorizar para siempre — cargarle costo después no revalúa las mermas ya registradas.
- La merma **nunca** actualiza `item_producto.costo_actual`.

**Response (201) — con costo:**
```json
{
  "movimientoId": "<uuid>",
  "stockResultante": "1.7500",
  "costoUnitario": "8000",
  "costoPerdido": "2000000",
  "motivoBajaNombre": "Vencimiento"
}
```

**Response (201) — sin costo:**
```json
{
  "movimientoId": "<uuid>",
  "stockResultante": "1.7500",
  "costoUnitario": null,
  "costoPerdido": null,
  "motivoBajaNombre": "Vencimiento"
}
```

### `GET /api/mermas`

Permiso: **Inventario:Leer**. Paginado; filtros `itemId`, `motivoBajaId`, `desde`, `hasta`. Cada fila incluye `motivoBajaNombre` y `costoPerdido`.

**El listado sobrevive a la baja del producto.** Una merma registrada es plata
perdida que ya ocurrió, así que dar de baja el producto después no la saca del
informe: la consulta no filtra `items.eliminado_el` —ni en el listado ni en el
`COUNT(*)`, o el total bajaría sin avisar— y la fila viaja con
`itemEliminado: true` para mostrarse marcada. Mismo criterio y misma razón que el
kardex: ver [`inventario-kardex.md`](./inventario-kardex.md) §"Producto eliminado".

Registrar una merma **nueva** sobre un producto eliminado sí se rechaza (`404`,
desde el propio `POST`): no hay operación real detrás.

`desde`/`hasta` siguen el criterio compartido de rangos por fecha: la fecha pura se expande a
la medianoche de la zona del tenant, el timestamp se respeta al segundo. Ver
[`inventario-kardex.md`](./inventario-kardex.md) §`GET /inventario/movimientos`.

---

## Backend

- **Módulos**: `src/modules/motivos-baja/` (catálogo) y `src/modules/mermas/` (registro), como feature modules separados.
- Reusa `InventarioService.registrarMovimiento` (`tipo='salida'`, `motivo='merma'`, `motivoBajaId`) y `CatalogService.convertirUnidad`.
- `AjusteStockDto`: enum de motivos sin `'merma'`.
- `registrarMovimiento`: exige `motivoBajaId` si `motivo='merma'`; rechaza `motivoBajaId` en otros motivos.

---

## Frontend

- `/configuracion/motivos-baja` — CRUD con badge **Fija** en motivos `es_fijo`. Columna **Tipo**
  (badge con el label de los tres valores de `motivo_baja.tipo`, ver *Modelo de datos* arriba)
  y campo Tipo en el formulario (`USelect` con las tres opciones); en un motivo `enUso` el
  campo se muestra deshabilitado, con la ayuda que explica por qué — el 400 del servidor
  sigue siendo la regla, esto es solo UX.
- `/mermas` — listado filtrable + drawer registrar (solo cantidad, unidad y motivo; **sin campo de costo**). El selector de motivo pide `GET /api/motivos-baja?soloActivas=true&tipo=merma`: *Cortesía de la casa* y *No se llegó a hacer* no aparecen ahí, aunque el filtro de pantalla no reemplaza el 400 de `POST /api/mermas`. Cartel no bloqueante cuando el producto no tiene `costo_actual`: avisa que la merma se va a registrar igual pero sin valorizar, y que no se puede corregir después. Columna Cantidad formateada por magnitud vía `formatStock` (`useFormatters`) — `MermaListItem.unidadMedida` (viene de `item_producto.unidad_medida`).
- Kardex / historial de movimientos: `Merma · {motivoBajaNombre}` y costo perdido formateado (`formatMonto`), o `—` cuando es `null`.
- Modal de ajuste de stock en items: opción Merma eliminada.
- `configuracion/items.vue` — mismo cartel no bloqueante en el drawer de entrada por compra cuando el producto no tiene costo; badge **Sin costo** y checkbox **Solo sin costo** en el listado (filtro `sinCosto`, ver [`inventario-kardex.md`](./inventario-kardex.md)).

---

## Testing

```bash
cd backend && npm test -- motivos-baja.service.spec.ts mermas.service.spec.ts
cd backend && npm test -- inventario.service.spec.ts  # casos motivo baja
cd backend && npm run test:e2e -- mermas.e2e-spec.ts
```

---

## Acceptance Criteria

- [x] CRUD motivos custom; fijos inmutables
- [x] `POST /mermas` tipifica, descuenta stock y congela costo
- [x] El costo sale de `item_producto.costo_actual`, nunca se tipea; sin costo, la merma se registra sin valorizar y queda así para siempre — sin override por movimiento
- [x] Listado y kardex muestran valorizado (o `—` sin costo) y motivo
- [x] Cartel no bloqueante en la merma y en la entrada por compra cuando el ítem no tiene costo; marca y filtro `sinCosto` en el listado de ítems
- [x] Ajuste genérico sin `merma`
- [x] Unit + E2E
- [x] Docs (este archivo) + ESTADO

---

## Related Features

- [inventario-kardex.md](./inventario-kardex.md) — movimientos de salida y `costo_unitario` congelado
- [conversion-unidades.md](./conversion-unidades.md) — conversión antes del movimiento
- [recetas.md](./recetas.md) — pieza 3 del cluster food-service
- Spec original: [`docs/superpowers/specs/2026-07-15-mermas-valorizadas-design.md`](../superpowers/specs/2026-07-15-mermas-valorizadas-design.md)
- Spec del costo sin tipear: [`docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md`](../superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md)
