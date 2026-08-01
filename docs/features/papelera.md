# Feature: Papelera (restaurar eliminados)

**Status**: Backend completo, frontend parcial (6/15 pantallas)
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
Body (opcional):  { "nombre": "Black Friday 2" }
                  Solo en los recursos con unicidad de nombre, y solo cuando
                  el usuario resolvió una colisión desde el modal. SIN body el
                  comportamiento es el de siempre: revive con el nombre que la
                  fila ya tenía. Lo aceptan los 8 recursos con unicidad de
                  nombre. `garzones` NO: su colisión no es de nombre.

Response (201): la entidad restaurada. (No hay `@HttpCode(200)` en ninguno
                  de los 16 — Nest devuelve 201 por default en un POST, y
                  ninguno lo pisa.)
Response (404): "<recurso> no está en la papelera" — no existe, existe y
                  está vivo, o existe borrada pero por el SISTEMA (no por
                  una persona: ver "Solo lo que borró una persona" abajo).
                  Una sola regla (WHERE ... AND eliminado_el IS NOT NULL AND
                  eliminado_por IS NOT NULL), sin rama que distinga los tres
                  casos.
Response (400): en 9 de los 16 — las 5 con índice único parcial de nombre
                  (grupos-modificadores, causas-merma, motivos-diferencia,
                  motivos-diferencia-inventario, cajones), las 3 que enforcean
                  la unicidad solo por código (descuentos, recargos, turnos), y
                  `garzones`, por una restricción distinta que no es de nombre.
                  El reparto completo y por qué no se deduce de la familia de
                  borrado: "Colisión al restaurar" abajo.
                  En los 8 con unicidad de nombre el 400 trae además
                  `nombreSugerido` — un nombre libre para reintentar, ver
                  "Salida de la colisión" abajo. En `garzones` no, y en la
                  colisión de OPCIÓN de `grupos-modificadores` tampoco:
                  renombrar no resuelve ninguna de las dos.
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

**Riesgo aceptado: restaurar un garzón puede duplicar un PIN.** Es la otra
unicidad de `garzones`, y esta **no** se protege al restaurar. `generarPinUnico()`
compara el PIN candidato contra los garzones **no eliminados** del tenant
(`pinYaUsado()` usa un `find` que TypeORM ya filtra por `@DeleteDateColumn`), y lo
hace así a propósito: los PIN se guardan con bcrypt, o sea que la única forma de
saber si uno está tomado es compararlo contra cada fila, y ampliar esa comparación
a los borrados haría que la papelera reserve PINs de gente que ya no trabaja.
La consecuencia: mientras un garzón está en la papelera su PIN queda libre, otro
puede recibirlo, y al restaurar el viejo quedan **dos garzones vivos con el mismo
PIN** — justo lo que `generarPinUnico` existe para evitar ("que la identificación
solo por PIN no sea ambigua", `garzones.service.ts`). No se arregla porque
`restaurar()` **no puede** comparar: no tiene el PIN en claro, solo su hash. La
probabilidad es 1 en 10⁶ por creación, y la salida —regenerar el PIN del
restaurado, cambiándoselo sin avisar— es peor que el problema. Si alguna vez
molesta, el cierre es que `restaurar()` devuelva una advertencia y deje que un
humano decida, no que reasigne en silencio.

### Salida de la colisión — nombre sugerido (decisión del owner, 2026-08-01)

El 400 dice qué pasa pero no da salida: para restaurar, el usuario tenía que ir a
renombrar **a mano** la fila viva que le ocupa el nombre. Decisión del owner: el
backend propone un nombre libre y la pantalla lo ofrece **editable** —sugerir y
dejar editar, no renombrar solo—, con el número al final empezando en 2
(«Black Friday 2»), porque el "1" implícito es la fila viva.

El cuerpo del 400 pasa a ser `{ message, nombreSugerido }`. El cálculo vive en
`backend/src/common/utils/nombre-sugerido.util.ts` (compartido por los 8 recursos
con unicidad de nombre: en los 8 la aritmética es la misma aunque la query no lo
sea) y trae **una sola query** con todos los nombres que compiten — no un `SELECT`
por candidato, que sería un N+1 disfrazado de bucle.

**La regla no es "sacar el número final".** Hay nombres donde el número es parte
del nombre ("Descuento 50", "Turno 2"): numerar sobre la base pelada daría
"Descuento 2", que pierde el significado y además compite contra otra familia de
nombres. El número final se trata como sufijo **solo si existe una fila viva
llamada exactamente como la base pelada** — la única señal de que ese sufijo lo
pusimos nosotros, porque no podríamos haber generado "X 2" sin un "X". Lo encontró
el e2e contra Postgres real, no el diseño: la fixture terminaba en un timestamp y
la primera versión le arrancó los dígitos.

**El reintento también valida.** Si el usuario edita el campo y manda un nombre
que también está tomado, vuelve el 400 con la sugerencia **siguiente** (nunca
encadena "… 2 2"). La alternativa —que el frontend confíe en que la sugerencia
sigue libre cuando la manda— apuesta a que nada pasó entre que la vio y confirmó.

**Implementado en los 8**, en dos formas distintas según cómo la tabla enforcea
la unicidad — y la diferencia no es de estilo:

- **Los 3 sin índice** (`descuentos`, `recargos`, `turnos`): la unicidad vive
  solo en código, así que `restaurar()` consulta los nombres tomados ANTES de
  intentar y arma el 400 sin haber escrito nada.
- **Los 5 con índice único parcial** (`cajones`, `causas-merma`,
  `motivos-diferencia`, `motivos-diferencia-inventario`,
  `grupos-modificadores`): la sugerencia se calcula **dentro del `catch` del
  `23505`**. Se evaluó consultar antes y se descartó con un argumento, no por
  gusto: con un índice el `catch` hace falta igual —entre consultar y escribir,
  otra transacción puede tomar el nombre—, así que pre-consultar agrega una
  query en TODOS los restaurar y no permite sacar el bloque. Queda dominada.
  El `UPDATE` corre en autocommit, así que su fallo no deja una transacción
  abortada y las queries del `catch` funcionan (verificado: ninguno de los 5
  envuelve el restaurar en una transacción explícita).

La query compartida vive en `errorDeColisionNombre()` (por repositorio) y
`errorDeColisionNombreSQL()` (por `DataSource`, para los cuatro services que
hablan SQL cruda y no tienen repo), en
`common/utils/nombre-sugerido.util.ts`. Sirve para los 8 porque las 8 tablas
comparten exactamente `tenant_id`, `nombre` y `eliminado_el` (verificado contra
`information_schema`, no asumido por parecido de nombre).

**⚠️ Cuatro comparan sin mayúsculas y cuatro no**, y eso cambia la sugerencia:
`causas_merma`, `motivo_diferencia_caja` y `motivo_diferencia_inventario`
indexan por `lower(nombre)`; `grupos_modificadores` indexa por `nombre` pelado
pero su `assertNombreLibre` de `create()`/`update()` compara con `LOWER`, así
que la regla que el usuario percibe es la case-insensitive (la más estricta) —
ver la entrada de ese desacuerdo en
[`docs/agent/pendientes.md`](../agent/pendientes.md). En esos cuatro la
sugerencia usa `ignorarMayusculas`, porque si no devolvería un nombre que la
base considera tomado y el usuario recibiría **el mismo 400 después de
confirmar el modal**.

⛔ **Dos colisiones NO llevan sugerencia**, porque renombrar no las resuelve:
`garzones` (su índice único es el del placeholder Mostrador, no de nombre) y la
rama `uq_grupo_opcion_item_vivo` de `grupos-modificadores` (una opción viva bajo
el mismo item). En las dos, ofrecer un nombre mandaría al usuario a arreglar
algo que no es la causa.

### Solo lo que borró una persona

> ✅ **Implementada entera y verificada contra Postgres el 2026-08-01**, en las dos
> puertas y en los 16 recursos. Se llegó acá cerrando dos agujeros que la primera
> entrega dejó abiertos, los dos anotados por si vuelven a aparecer en código nuevo:
>
> 1. **El listado de `impuestos` no filtraba** — el `OR` de tenant/país no estaba
>    parentizado y `AND` liga más fuerte, así que las filas del tenant se saltaban
>    la condición entera. TypeORM no parentiza los `where`/`andWhere` por su cuenta.
> 2. **`restaurar()` dejaba el `eliminado_por` viejo** — con la fila ya viva, ese
>    autor sobreviviente disfrazaba el siguiente borrado del sistema como borrado de
>    persona, y volvía a hacerlo restaurable. En `impuestos` eso reabría la doble
>    tributación de [ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md).
>
> El e2e de esta regla pasó de cubrir 2 recursos a cubrir los **16**, con un test
> que falla si la lista deja de nombrarlos a todos.

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
- **`restaurar()` limpia las DOS columnas**, no solo `eliminado_el`. Es la mitad
  que se olvida: como la regla se decide mirando `eliminado_por`, un autor que
  sobreviva al restore hace que el **siguiente** borrado del sistema sobre esa
  misma fila parezca borrado de persona, y vuelva a ser visible y restaurable.
  Por eso ninguno de los 9 recursos de la familia TypeORM usa `restore()`, que
  solo nulea la `@DeleteDateColumn`: todos hacen
  `update({ id, tenantId }, { eliminadoEl: null, eliminadoPor: null })`.

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

**Estado real: 6 de 15 pantallas cableadas** (`configuracion/items.vue`,
`configuracion/categorias.vue`, `configuracion/impuestos.vue`,
`configuracion/descuentos.vue`, `configuracion/recargos.vue`,
`configuracion/turnos.vue`). 16 recursos backend, pero **15 páginas**:
`mesas` no tiene página propia, vive dentro de `configuracion/salones.vue`. Las
otras 9 (`grupos-modificadores`, `terceros`, `cajones`, `garzones`,
`salones` [con sus `mesas`], `impresoras`, `causas-merma`,
`motivos-diferencia`, `motivos-diferencia-inventario`) todavía **no** tienen el
toggle "ver eliminados" ni el botón restaurar — el backend ya soporta los 16
recursos, el molde de pantalla está probado en las seis hechas, pero replicarlo
a las 9 restantes queda pendiente. Backlog:
[`docs/agent/pendientes.md`](../agent/pendientes.md).

El composable `usePapelera(recurso)` (`app/composables/usePapelera.ts`) encapsula lo
común a cada pantalla: el toggle `verEliminados`, `restaurar(id, nombre?)` (`POST
.../:id/restaurar`) y `formatearBorradoPor(fila)` ("Eliminado por X el fecha").
El `nombre` es opcional y solo viaja al resolver una colisión — sin él el body no
se manda, así que las pantallas sin unicidad de nombre no cambian en nada.

**La colisión es un segundo modal, no un toast rojo.** `descuentos.vue` es el
molde: el `catch` de `restaurar()` distingue con `nombreSugeridoDe(e)`
(`app/utils/api-error.ts`) entre un error terminal —404, red: toast y cerrar— y
un 400 de colisión, que abre un modal con el mensaje del backend y el nombre
libre **precargado y editable**. Confirmar reintenta con ese nombre; si también
está tomado, el modal se queda abierto con la sugerencia siguiente. Al restaurar
renombrando, la fila local se parchea con ese nombre y el listado se reordena
(viene ordenado por nombre).

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
replicar. Backlog de las 9 pantallas restantes con el detalle de cuál de las dos
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
- **Salida de la colisión** (los 8 con unicidad de nombre): el 400 trae un
  `nombreSugerido` libre y restaurar con él revive y renombra en una sola
  escritura; reintentar con un nombre también tomado da la sugerencia siguiente
  sin encadenar sufijos. La aritmética del sufijo tiene su unit propio
  (`nombre-sugerido.util.spec.ts`), incluido el caso que el e2e destapó: un
  número que es parte del nombre no se pela.
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
