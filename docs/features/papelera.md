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

Response (201): la entidad restaurada. (No hay `@HttpCode(200)` en ninguno
                  de los 16 — Nest devuelve 201 por default en un POST, y
                  ninguno lo pisa.)
Response (404): "<recurso> no está en la papelera" — no existe, existe y
                  está vivo, o existe borrada pero por el SISTEMA (no por
                  una persona: ver "Solo lo que borró una persona" abajo).
                  Una sola regla (WHERE ... AND eliminado_el IS NOT NULL AND
                  eliminado_por IS NOT NULL), sin rama que distinga los tres
                  casos.
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
- `salones.eliminarSalon()` soft-deletea todas las `mesas` del salón antes de borrarlo.
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

La unicidad de nombre por tenant no es una propiedad de familia de borrado (SQL
cruda vs. `softDelete()`): hay que medirla recurso por recurso, por índice **o**
por código. Medido para los 16:

- **Por índice único parcial** (`WHERE eliminado_el IS NULL`) — cinco recursos:
  `grupos-modificadores`, `causas-merma`, `motivos-diferencia`,
  `motivos-diferencia-inventario`, `cajones`. Si alguien ocupó el nombre mientras
  la fila estaba en la papelera, `restaurar()` capta el `23505` (unique_violation)
  de Postgres y responde 400 pidiendo renombrar el vivo o el restaurado — no
  sobrescribe en silencio ni intenta un nombre alternativo.
- **Solo por código** (sin índice en la base) — tres recursos: `descuentos`
  (`validarNombreUnico`), `recargos` (`validarNombreUnico`), `turnos`
  (`assertNombreUnico`). Los tres reusan en `create()`/`update()` una función que
  filtra `eliminado_el IS NULL` (o, en `turnos`, un `findOne` que TypeORM ya
  filtra solo por el `@DeleteDateColumn`) — sin índice de por medio, Postgres no
  tira `23505`, así que `restaurar()` llama a esa MISMA función antes de revivir
  la fila y traduce el resultado al mismo 400 accionable. Antes de esta
  corrección, ninguno de los tres la llamaba: se podía crear "Black Friday",
  borrarlo, crear otro "Black Friday", y restaurar el viejo dejaba dos vivos con
  el mismo nombre — un estado que `create()`/`update()` nunca dejan alcanzar.
- **Sin unicidad de ningún tipo** — siete recursos: `items`, `categorias`,
  `impuestos`, `terceros` (catálogo del negocio), `salones`, `mesas`, `impresoras`
  (config operativa). Ahí la colisión no puede ocurrir porque no hay regla que
  colisionar.

Total: 5 (índice) + 3 (código) + 7 (sin unicidad) = 15. El recurso 16,
`garzones`, tiene índice único parcial pero NO de nombre — es un caso aparte,
documentado abajo.

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

### Solo lo que borró una persona

> ⚠️ **La regla de abajo está implementada a medias. No confíes en ella todavía.**
> Verificado contra Postgres el 2026-08-01, con dos agujeros abiertos:
>
> 1. **El listado de `impuestos` no filtra** — el `OR` de tenant/país no está
>    parentizado y `AND` liga más fuerte, así que las filas del tenant se saltan la
>    condición entera. Es el recurso que motivó la decisión.
> 2. **`restaurar()` no limpia `eliminado_por` en ninguno de los 16**, así que
>    borrar → restaurar → que el sistema lo borre deja un `eliminado_por` viejo que
>    disfraza el borrado del sistema como borrado de persona.
>
> Los dos están en [`pendientes.md`](../agent/pendientes.md) con la evidencia y la
> secuencia para reproducirlos. **La pantalla de impuestos no debe cablearse hasta
> que se cierren**, porque el segundo camino reabre la doble tributación de
> [ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md).

**Decisión del owner (2026-08):** la papelera solo expone y restaura filas con
`eliminado_por` **no nulo**. Aplica a los 16 recursos, en las dos puertas —el
listado con `incluirEliminados` y `restaurar()`— con una sola regla, sin casos
especiales por recurso:

- **Listado**: una fila aparece si está viva (`eliminado_el IS NULL`) **o** si la
  borró una persona (`eliminado_por IS NOT NULL`). Nunca si está borrada y
  `eliminado_por` es nulo.
- **`restaurar()`**: el `WHERE` de "está en la papelera" exige `eliminado_el IS
  NOT NULL AND eliminado_por IS NOT NULL`. Si falta cualquiera de los dos, es el
  mismo 404 "no está en la papelera" que da un id inexistente — una sola regla,
  sin rama que distinga "no existe" de "lo borró el sistema".

**Por qué:** el seeder soft-deletea filas como corrección del sistema —
`remapImpuestosOficialesDuplicados` (`seeder.service.ts`) borra impuestos
duplicados de IVA para evitar la doble tributación del 38% (ver
[ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md))— sin
`eliminado_por`. Antes de esta corrección esas filas eran visibles y
restaurables desde la papelera, lo que reabría el agujero fiscal que
`remapImpuestosOficialesDuplicados` existe para cerrar; y se restauraban
**incompletas**, porque el seeder además borra sus asociaciones (`item_impuestos`)
con `DELETE` físico, que la papelera no revive.

**Consecuencia medida, no un efecto colateral que se descubrió después:** las
filas borradas **antes** de que existiera esta feature tampoco tienen
`eliminado_por` (la columna es nueva y nullable — no hubo backfill, ver
"Esquema" arriba), así que **tampoco aparecen** en la papelera. Es coherente con
la decisión del owner: una fila borrada antes de esta feature es indistinguible
de una borrada por el sistema — en ninguno de los dos casos hay una persona
identificable a quien devolverle el "click" de restaurar.

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

Otro detalle no obvio: dos toggles rápidos de "ver eliminados" disparan dos `GET`
en vuelo, y sin protección gana el que responda último, no el último click. Las
pantallas con `cargar()` propio (como `categorias.vue`) necesitan su propia cola
serial local (`cargaEnCurso`); las que usan `usePaginatedList` (como `items.vue`)
ya la heredan del composable (`usePaginatedList.ts` → `fetch()`), sin nada que
replicar. Backlog de las 13 pantallas restantes con el detalle de cuál de las dos
formas les toca: [`docs/agent/pendientes.md`](../agent/pendientes.md).

---

## Testing

- **Unit por service**: `restaurar()` devuelve la entidad y (solo en `items`) deja
  `activo: false`. Restaurar algo que no está en la papelera es 404 con el mismo
  mensaje sin importar si no existe, si existe y está vivo, o si existe borrada
  pero sin `eliminado_por` (la borró el sistema).
- **Colisión**: con un vivo ocupando el nombre (o, en `garzones`, con el Mostrador
  nuevo ya creado), `restaurar()` da 400 y no modifica ninguna de las dos filas.
  Cubre las dos formas de garantizar unicidad — índice único parcial
  (`grupos-modificadores`, `causas-merma`, `motivos-diferencia`,
  `motivos-diferencia-inventario`, `cajones`, `garzones`) y solo por código
  (`descuentos`, `recargos`, `turnos`).
- **Solo lo que borró una persona**: una fila con `eliminado_el` seteado pero
  `eliminado_por` nulo (simulando un borrado del sistema) no aparece en
  `GET ...?incluirEliminados=true` ni se puede restaurar (404). Probado contra
  las dos familias de borrado (`categorias`: softDelete() de TypeORM; `items`:
  SQL crudo) en `test/papelera.e2e-spec.ts`.
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
- [ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md) — por qué el seeder
  soft-deletea impuestos duplicados sin `eliminado_por`, y por qué esas filas no
  deben ser visibles ni restaurables desde la papelera (ver "Solo lo que borró
  una persona" arriba).
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
