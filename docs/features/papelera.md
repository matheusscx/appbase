# Feature: Papelera (restaurar eliminados)

**Status**: Backend completo, frontend parcial (2/15 pantallas)
**Owner**: Cesar Matheus
**Last Updated**: 2026-08-01

---

## Overview

### What is it?

Un `GET ...?incluirEliminados=true` en cada listado del alcance trae también las filas
borradas (con quién las borró y cuándo), y un `POST /<recurso>/:id/restaurar` las
revive. No hay tabla ni pantalla de "papelera" separada: es el mismo dato ya soft-
deleteado (invariante 3), con una puerta para volver a leerlo y un botón para
devolverlo a la vista normal.

### Why does it exist?

Caso de uso del owner: *"siempre hay usuarios que borran las cosas y después están
llorando para que se las repongan"*. Antes de esta feature no había forma de
recuperar nada — el dato ya estaba en la base (soft delete transversal), pero no
existía ningún endpoint de restaurar de cara al usuario.

Decisión de diseño completa, investigación de mercado y el porqué de cada corte de
alcance: [`docs/superpowers/specs/2026-07-31-papelera-restaurar-eliminados-design.md`](../superpowers/specs/2026-07-31-papelera-restaurar-eliminados-design.md).

### Scope

**Incluido — 16 entidades:**

- **Catálogo del negocio (7):** `items`, `categorias`, `descuentos`, `recargos`,
  `impuestos`, `grupos-modificadores`, `terceros`.
- **Config operativa (9):** `cajones`, `garzones`, `turnos`, `salones`, `mesas`,
  `impresoras`, `causas-merma`, `motivos-diferencia` (caja), `motivos-diferencia-inventario`.

**NO incluido, y por qué:**

- **Seguridad y acceso** (roles, membresías del tenant, api-keys de pasarela) —
  restaurar un rol devuelve permisos que alguien quitó a propósito; no es una
  comodidad, es una operación con consecuencia de seguridad.
- **Suscripciones e inscripciones de pasarela** — restaurar puede reactivar un
  cobro recurrente que el usuario canceló a propósito.
- **`medios-pago-online/:id`** — pese al nombre no es config del tenant: es el
  medio de pago **tokenizado de un usuario** (su tarjeta guardada). Reponer una
  tarjeta que alguien eliminó es un problema de privacidad, no de comodidad. Mismo
  grupo que las inscripciones de pasarela.
- **`cuentas`/`cuenta_lineas`** — es transaccional (una línea de una cuenta de
  salón abierta), no catálogo.
- **`tenants/:id`, `tenants/members/:userId`, `tenants/razones-sociales/:id`** —
  borrar el tenant entero y sus miembros queda fuera; razones sociales es la
  identidad del emisor fiscal, y CLAUDE.md manda detenerse antes de tocar lo
  fiscal — es una línea para sumar si el owner la pide, no entra por default.
- **Kardex (`movimientos_inventario`)** — nunca entra. [ADR-007](../adr/007-inventario-serie-lote.md)
  declara el kardex inmutable: un movimiento no se revierte, se compensa con un
  movimiento contrario. Papelera y kardex son dos modelos distintos a propósito.

**Revertir ediciones, versionado o bitácora de "quién cambió qué" tampoco entran** —
alcance explícitamente acotado a **borrados**. Detalle de esa decisión y su cierre:
[`docs/agent/resueltos.md`](../agent/resueltos.md) (entrada "Log de cambios
reversible").

---

## API Endpoints

Por cada uno de los 16 recursos, dos cambios sobre el CRUD ya existente — nada nuevo
en la superficie, mismo guard que ya protegía el `DELETE`/`GET` de ese recurso:

```
GET /<recurso>?incluirEliminados=true

Authorization: Bearer <token>   (mismo guard que el GET normal)

Response (200): igual forma que siempre, pero incluye las filas con
eliminado_el != null, cada una con:
{
  ...campos normales...,
  "eliminadoEl": "2026-07-31T12:00:00.000Z",
  "eliminadoPorNombre": "Nombre Apellido" | null
}
```

Sin el query param (o en `false`), el comportamiento es el de siempre: solo filas
vivas. Ninguna pantalla existente cambia sin pedirlo.

```
POST /<recurso>/:id/restaurar

Authorization: Bearer <token>   (mismo guard que el DELETE de ese recurso)

Response (200): la entidad restaurada.
Response (404): "<recurso> no está en la papelera" — no existe, o existe y
                  está vivo. Una sola regla (WHERE ... AND eliminado_el IS
                  NOT NULL), sin rama que distinga los dos casos.
Response (400): en las 5 entidades con nombre único por tenant
                  (grupos-modificadores, causas-merma, motivos-diferencia,
                  motivos-diferencia-inventario, cajones) y también en
                  `garzones`, por una restricción distinta (no nombre único) —
                  ver "Colisión al restaurar" abajo.
```

`salones` tiene además `mesas` bajo `@Controller('mesas')`, con su propio
`POST /mesas/:id/restaurar` (`salones.controller.ts`).

---

## Backend

### Esquema

`eliminado_por UUID REFERENCES usuarios(usuario_id)`, **nullable**, agregada en las
16 tablas del alcance (no en las 88 que ya tenían `eliminado_el` — una columna en
tablas cuyo borrado nadie puede deshacer es peso muerto). Nullable porque las filas
ya borradas antes de esta feature no lo tienen, y porque el seeder borra sin usuario.

Cada fila eliminada trae el **nombre** de quien la borró vía un JOIN a `usuarios` en
la misma query de listado (nunca una consulta por fila). Ese JOIN **no** filtra
`eliminado_el` de `usuarios` a propósito — excepción ya documentada en
[`docs/patterns/backend.md`](../patterns/backend.md) (sección de convenciones
transversales): el autor de un borrado es un hecho histórico que no debe
desaparecer solo porque ese usuario se dio de baja después.

### Las tres conductas

**a) Restaurar deja inactivo SOLO a `items`.** De los 16 recursos, `items.remove()`
es el único que pisa `activo = false` junto con `eliminado_el` — el valor previo de
`activo` se pierde de verdad. Por eso `items.restaurar()` nunca vuelve a poner
`activo: true`: reactivarlo es un segundo gesto deliberado, no algo que restaurar
pueda inferir. En los otros 15 recursos `remove()` no toca ninguna columna de
estado equivalente, así que restaurar no tiene nada que decidir ahí.

**b) El colateral revive acotado por el timestamp exacto de ese borrado.** Tres
recursos arrastran filas colaterales al borrar, y son los tres únicos que necesitan
esta regla:

- `items.remove()` soft-deletea `receta_extras_permitidos` en las dos direcciones
  (como ingrediente y como receta que ofrece el extra).
- `salones.remove()` soft-deletea todas las `mesas` del salón antes de borrarlo.
- `grupos-modificadores.remove()` soft-deletea las `grupo_modificador_opciones` del
  grupo antes de borrarlo.

Restaurar el padre revive esas filas — pero **solo** las que ese borrado se llevó:
la comparación es contra el `eliminado_el` exacto que quedó en el padre, no contra
"cualquier fila borrada". Una mesa (u opción) que ya estaba borrada por otro motivo
antes de borrar el padre sigue borrada después de restaurarlo.

**c) Huérfano tolerado, sin cascada hacia arriba.** Restaurar un ítem cuya
categoría sigue borrada lo deja sin categoría visible; no se restaura la categoría
ni se bloquea la operación. Mismo patrón que Square, Toast y Clover.

### Colisión al restaurar → 400

Cinco de los 16 recursos tienen **nombre único por tenant** vía índice parcial
(`WHERE eliminado_el IS NULL`): `grupos-modificadores`, `causas-merma`,
`motivos-diferencia`, `motivos-diferencia-inventario`, `cajones`. Si alguien ocupó
el nombre mientras la fila estaba en la papelera, `restaurar()` capta el
`23505` (unique_violation) de Postgres y responde 400 pidiendo renombrar el vivo o
el restaurado — no sobrescribe en silencio ni intenta un nombre alternativo. De las
7 entidades de catálogo del negocio, **seis** (`items`, `categorias`, `descuentos`,
`recargos`, `impuestos`, `terceros`) no tienen esa unicidad; la séptima,
`grupos-modificadores`, sí (ya está en la lista de arriba) — medido, no supuesto.

**`garzones` tiene una restricción única parcial distinta — no es nombre único.**
`uq_garzones_mostrador_tenant` (`(tenant_id) WHERE es_placeholder = true AND
eliminado_el IS NULL`) permite un solo garzón placeholder "Mostrador" vivo por
tenant (lo crea `asegurarMostrador()` al procesar la primera propina directa del
POS de cada tenant; ver `docs/features/pagos.md`). `garzones` no indexa `nombre` —
dos garzones con el mismo nombre conviven sin problema —, así que esto no es el
mismo caso que los cinco de arriba. Colisiona por un camino angosto: si el
Mostrador se borra y otra venta con propina directa crea uno nuevo mientras el
viejo sigue en la papelera, restaurar el viejo choca contra el nuevo — mismo 400,
capturando el mismo `23505`.

Encontrado corrigiendo un error de planificación (2026-08-01): el manejo de esta
colisión se había asignado por **familia de borrado** (SQL cruda vs. `softDelete()`
de TypeORM) en vez de por la propiedad que importa —tener un índice único
parcial—, y `cajones`/`garzones` (familia `softDelete()`) quedaron sin el `catch`
del `23505`: devolvían 500 donde esta doc prometía 400. Ya corregido; los dos
capturan el error igual que los otros cuatro.

---

## Frontend

**Estado real: 2 de 15 pantallas cableadas** (`configuracion/items.vue`,
`configuracion/categorias.vue`). 16 recursos backend, pero **15 páginas**:
`mesas` no tiene página propia, vive dentro de `configuracion/salones.vue`. Las
otras 13 (`descuentos`, `recargos`, `impuestos`, `grupos-modificadores`,
`terceros`, `cajones`, `garzones`, `turnos`, `salones` [con sus `mesas`],
`impresoras`, `causas-merma`, `motivos-diferencia`,
`motivos-diferencia-inventario`) todavía **no** tienen el toggle "ver eliminados"
ni el botón restaurar — el backend ya soporta los 16 recursos, el molde de
pantalla está probado en las dos hechas, pero replicarlo a las 13 restantes
queda pendiente. Backlog: [`docs/agent/pendientes.md`](../agent/pendientes.md).

El composable `usePapelera(recurso)` (`app/composables/usePapelera.ts`) encapsula lo
común a cada pantalla: el toggle `verEliminados`, `restaurar(id)` (`POST
.../:id/restaurar`) y `formatearBorradoPor(fila)` ("Eliminado por X el fecha").

Un detalle que **no** es obvio del composable y hay que repetir en cada pantalla: al
`DELETE` con `verEliminados` activo, la fila no debe borrarse localmente del
array — tiene que **recargar la lista** (`fetchItems()`/equivalente), porque el
`DELETE` no devuelve `eliminadoEl`/`eliminadoPorNombre` (solo el próximo `GET` los
trae). Ver `eliminar()` en `configuracion/items.vue`.

---

## Testing

- **Unit por service**: `restaurar()` devuelve la entidad y (solo en `items`) deja
  `activo: false`. Restaurar algo que no está en la papelera es 404 con el mismo
  mensaje sin importar si no existe o si existe y está vivo.
- **Colisión**: con un vivo ocupando el nombre (o, en `garzones`, con el Mostrador
  nuevo ya creado), `restaurar()` da 400 y no modifica ninguna de las dos filas.
- **Colateral acotado**: borrar `items`/`salones`/`grupos-modificadores` revive
  solo lo que ESE borrado se llevó; una fila borrada antes por otro motivo sigue
  borrada después de restaurar.
- **E2E**: borrar → listar con `incluirEliminados=true` → restaurar → aparece en el
  listado normal (inactivo si es `items`), con sus reglas de precio intactas.

---

## Related Features

- [ADR-007](../adr/007-inventario-serie-lote.md) — por qué el kardex queda fuera
  (inmutable, se compensa, nunca se revierte).
- [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md) — por qué lo fiscal
  (razones sociales) queda fuera.
- [`docs/patterns/backend.md`](../patterns/backend.md) — excepción del JOIN a
  `usuarios` sin filtrar `eliminado_el`.

---

## Notes

`docs/agent/pendientes.md` trae, cerrada al mismo tiempo que esta feature, la
entrada "Un descuento, recargo o impuesto desactivado sigue aplicándose": el
bloqueo que tenía sobre "esperar al log de cambios reversible" se levantó porque se
midió que `items.remove()` no toca `item_impuestos`/`item_descuentos`/
`item_recargos` — la papelera no necesitó uniformar esas tres tablas puente para
funcionar. Lo único que sigue abierto ahí es si el "limpiar asociaciones" de
desactivar una regla debe ser `DELETE` físico o soft delete.
