# Lo que una cuenta abierta ya pidió no se saca del catálogo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que ninguna acción de catálogo pueda dejar una mesa **incobrable**. Hoy tres
caminos distintos sacan del catálogo algo que una cuenta abierta ya pidió dentro de su
personalización, y el cobro de esa mesa pasa a fallar con un 400 del que nadie se entera
hasta que el garzón intenta cobrar.

**Architecture:** La regla ya existe y ya tiene forma: `ItemsService.obtenerUsoItem`
pregunta *"¿este ítem está pedido en una cuenta abierta?"* y `remove()` bloquea con
*"No se puede eliminar: está pedido en Mesa 4 · cuenta 1"*. El problema es que esa
pregunta mira **`cuenta_lineas.item_id`** —el ítem de la línea, la hamburguesa— y no lo
que hay **adentro** de `cuenta_lineas.personalizacion`, que es un `jsonb` con tres
niveles: `extras[].ingredienteItemId`, `grupos[].opciones[].itemId` y
`componentes[].grupos[].opciones[].itemId`.

El plan agrega un primitivo en `ItemsService` —al lado de `obtenerUsoItem`, que ya lee
`cuenta_lineas` para exactamente esta regla— y lo consulta desde las tres puertas
abiertas. No es arquitectura nueva: es la misma pregunta, hecha sobre el campo que
faltaba.

**Tech Stack:** NestJS + TypeORM + Postgres 15 (`jsonb`), Jest + supertest (e2e de API).

**Spec:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) § 2, entrada *"Si una
opción del menú desaparece con la mesa sentada, la precuenta entera queda en guiones"*,
**con su alcance corregido por este plan** (ver "Lo que la entrada no sabía"). Decisión
del owner del 2026-08-30: *no se deja borrar*.

## Global Constraints

- La regla, en una línea: **lo que una cuenta abierta ya pidió no se saca del catálogo**,
  esté en `cuenta_lineas.item_id` o adentro de su `personalizacion`.
- Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`, y en la rama de cuentas
  además `c.estado = 'abierta'` — sin eso una cuenta ya cerrada volvería el ítem
  inborrable para siempre (el porqué ya está escrito en el docblock de `obtenerUsoItem`).
- Sin query por iteración: el chequeo de N extras/opciones que se sacan a la vez se
  resuelve en **una** consulta con `= ANY($1)`, no una por elemento.
- Nada de esto toca el motor de cálculo ni lo fiscal.
- **No hay datos productivos** (memoria del proyecto): no se diseñan backfills ni
  migraciones incrementales. Si hace falta un índice, se declara en la entidad.

---

## Lo que la entrada no sabía (medido el 2026-08-30)

La § 2 dice que hay que medir *"si el soft-delete de un ítem usado en una cuenta abierta
ya está bloqueado"*. Medido: **el 400 es alcanzable, y por tres puertas, no una.**

| Puerta | Qué hace | ¿Frena hoy? |
|---|---|---|
| `DELETE /items/:id` del ítem **de la línea** | borra la receta/combo pedido | ✅ `clase='cuenta'` en `obtenerUsoItem` |
| `DELETE /items/:id` de un ingrediente usado **como extra** | borra el ingrediente **y** soft-borra sus filas de `receta_extras_permitidos` | ❌ el uso como extra cae en `advertencias`, y `remove()` solo bloquea por `bloqueos` |
| `PATCH /items/:id` con `extrasPermitidos` | soft-borra la lista entera y reinserta la nueva | ❌ no consulta cuentas |
| `PATCH /grupos-modificadores/:id` sacando una opción | soft-borra la opción y sus overrides | ❌ ese módulo **nunca** consulta cuentas abiertas |

Después de cualquiera de las tres últimas, `resolverPersonalizacionReceta` tira
`400 "Extra no permitido para esta receta"` (o el equivalente de grupos) **tanto en la
previsualización como en `cerrarCuenta`**: la mesa queda incobrable.

⚠️ **Dos cosas que conviene no confundir:**

1. **Esto es anterior a la tanda del override** (`1970ccbd`). El cobro re-tasa contra el
   catálogo vivo desde antes; lo único que aquella tanda cambió es que ahora la
   **previsualización** también, así que el síntoma aparece antes y de otra forma (la
   cuenta entera en guiones en vez de un 400 al cobrar). El agujero es el mismo.
2. **Borrar un ítem que es opción de grupo hoy está bloqueado, pero por otra regla**: es
   opción de un grupo del catálogo (`clase='opcion'`), haya mesas o no. Esa puerta está
   cerrada de casualidad — sacar la opción **del grupo** por `PATCH` la abre igual, y es
   la Task 4.

---

## Task 1: El primitivo — qué cuentas abiertas pidieron esto

**Files:**
- Modify: `backend/src/modules/items/items.service.ts`
- Test: `backend/src/modules/items/items.service.spec.ts`
- Test: `backend/test/salones.e2e-spec.ts` (o el spec de items que corresponda — ver paso 5)

**Interfaces:**
- Produce: un método público de `ItemsService` que contesta **qué cuentas abiertas
  tienen pedido un ítem dentro de la personalización de alguna línea**, devolviendo los
  nombres ya formateados como los usa `obtenerUsoItem`
  (`mesa · nombre-de-cuenta`), para que el mensaje de error salga igual por las cuatro
  puertas.
- La forma exacta de la firma la decide el paso 1. Lo que **no** es negociable: (a) acepta
  **varios** ids y contesta en una sola consulta —las Tasks 3 y 4 sacan N elementos de una—;
  (b) sabe acotar por el ítem contenedor cuando el llamador lo conoce (la receta en la
  Task 3, el grupo en la Task 4), para no bloquear de más; (c) filtra
  `c.estado = 'abierta'` y los tres `eliminado_el`.

- [x] **Paso 1 — Spike: decidido. Containment (`@>`), no `jsonb_array_elements`.**
      Verificado contra el Postgres real del compose (los seis casos, en una consulta):
      matchea `extras`, matchea `grupos` y `componentes[].grupos`, **respeta el
      mismo objeto** (opción X en el grupo G1 NO matchea el pedido "X dentro de G2"
      → `false`), y con la clave ausente devuelve `false` **sin tirar** — que es
      exactamente el riesgo por el que este paso existía. El guard `jsonb_typeof`
      resulta innecesario: era una defensa contra la expansión, no contra la
      containment. `jsonb_build_object('…', $n::uuid)` serializa el uuid como string
      y matchea el snapshot.

      **Firma: son DOS métodos, no uno, y cada uno nace con su puerta.** El nivel y
      el alcance están correlacionados —un alcance de receta solo tiene sentido
      sobre `extras`, uno de grupo solo sobre `opciones`— y **ningún llamador
      necesita los dos niveles a la vez**: borrar un ítem que es opción de grupo ya
      lo frena la rama `'opcion'` de `obtenerUsoItem`, haya mesas o no (nota 2 de
      arriba). Un método único sería un `switch` de dos ramas sin código compartido.
      Lo que sí se comparte —el encabezado que define "cuenta abierta" y formatea el
      nombre de la mesa— sale a una constante SQL del archivo.

      ```ts
      cuentasAbiertasConExtra(manager, tenantId, ingredienteItemIds: string[], recetaItemId?: string): Promise<string[]>
      cuentasAbiertasConOpcionDeGrupo(manager, tenantId, opcionItemIds: string[], grupoId: string): Promise<string[]>
      ```

- [x] **Desviación al plan: cada primitivo viaja con la puerta que lo consume.** El
      Paso 5 de la Task 1 pedía un e2e que probara el JSONB —la única prueba real— pero
      la Task 1 sola no abre ninguna puerta por donde la API pueda observarlo: el
      primitivo sería código muerto con un test de SQL mockeado.

      Y para la puerta del `DELETE` (Task 2) **no hizo falta ningún primitivo**: la
      pregunta entró como una **sexta rama del `UNION`** que `obtenerUsoItem` ya hacía.
      Sale más barato (cero consultas nuevas), el `UNION` dedupea sola la cuenta que
      pidió el ítem como línea *y* como extra, y no toca el conteo de consultas que
      decenas de unitarios de `remove()` fijan con mocks en secuencia.

      Así que el reparto real es:
      - **Tasks 1+2** → rama del `UNION` en `obtenerUsoItem`. Sin primitivo.
      - **Task 3** → nace `cuentasAbiertasConExtra(…, recetaItemId)`, con su puerta.
      - **Task 4** → nace `cuentasAbiertasConOpcionDeGrupo(…, grupoId)`, con su puerta.

- [ ] ~~**Paso 1 (original) — Spike: decidir la firma y la forma de la consulta JSONB.**~~
      Los tres niveles del snapshot (`PersonalizacionRecetaSnapshot` en
      `common/dto/personalizacion-receta.dto.ts`):
      `extras[].ingredienteItemId`, `grupos[].opciones[].itemId`,
      `componentes[].grupos[].opciones[].itemId`.
      Elegir entre containment (`personalizacion @> '{"extras":[{"ingredienteItemId":…}]}'`,
      que aprovecha un GIN) y `jsonb_array_elements` + `EXISTS` (más legible, y el conjunto
      ya viene chico porque el `JOIN` a `cuentas` lo acota a las abiertas).
      ⚠️ Con `jsonb_array_elements`, blindar contra `grupos`/`componentes` ausentes:
      `jsonb_typeof(...) = 'array'` antes de expandir, o la consulta tira en una línea sin
      grupos. Anotar la decisión acá antes de escribir código.

- [x] **Paso 2 — Test unitario.** Los dos que ya existían sobre la forma del SQL
      **fallaron solos** al aparecer la rama nueva (`toHaveLength(5)` → 6), que es la
      señal de que pinchan de verdad. Quedaron actualizados a seis ramas, y el de los
      filtros pasó de un `find` —que miraba solo la primera rama con `cuenta_lineas`—
      a un `filter` que exige los cuatro filtros en **las dos**.

- [x] ~~**Paso 2 (original) — Test unitario que falla.**~~ En `items.service.spec.ts`, con
      `managerMock.query` devolviendo una fila, afirmar que el método pide **una sola**
      consulta para varios ids y que el SQL lleva `estado = 'abierta'`.
      📌 Un unitario sobre SQL mockeado **no prueba que el JSONB matchee** — eso es el
      paso 5. Acá se fija la forma (un viaje, no N) y el filtro de estado.

- [x] **Paso 3 — Corrido y visto fallar.**

- [x] **Paso 4 — Implementado** como rama del `UNION` (ver la desviación).
      Containment `@>`, no `= ANY` sobre expansión.

- [ ] ~~**Paso 4 (original) — Implementar.**~~ Una consulta, los tres niveles, `= ANY($1::uuid[])` para
      los ids. El `SELECT` devuelve el mismo `m.nombre || ' · ' || COALESCE(c.nombre,
      'cuenta ' || c.numero)` que ya arma la rama `'cuenta'` de `obtenerUsoItem`.

- [x] **Paso 5 — E2E hecho** (`recetas.e2e-spec.ts`, test 15), con garzón Bruno y
      Mesa 4, más un **control**: un extra permitido de la misma receta que la línea NO
      eligió, que no debe bloquear. Rojo antes, verde después.

- [ ] ~~**Paso 5 (original) — E2E, que es la única prueba real del JSONB.**~~ Sembrar por API una cuenta
      abierta con una línea personalizada con extra pago (el molde está en
      `recetas.e2e-spec.ts`, test *"la cuenta de salón devuelve el extra convertido"*), y
      afirmar que el método lo encuentra por los tres niveles. Correr
      `./scripts/reset-db.sh` antes.
      ⚠️ Garzón propio, no Ana: la sesión es única por garzón y seis specs la comparten.

- [x] **Paso 6 — Dos mutantes, los dos muertos**, cada uno por una aserción distinta:
      aflojar la containment a `personalizacion IS NOT NULL` muere en el control
      (`:1088`), y `estado = 'abierta' OR TRUE` muere en la mitad de después de cancelar
      (`:1108`). Revertidos, y verificado en los logs que el watcher re-arrancó limpio.

- [ ] ~~**Paso 6 (original) — Mutante.**~~ Sacar el filtro `c.estado = 'abierta'` y confirmar que un test
      falla (una cuenta **cerrada** no puede bloquear nada). Revertirlo y verificar en los
      logs del backend que el watcher re-arrancó con el fuente limpio.

- [x] **Paso 7 — Gate entero en verde** (lint 0, typecheck 0, 2391 unitarios, 666 e2e,
      `--verificar` sin re-siembra) + revisión independiente (**BLOQUEÓ**, ver abajo).

---

## Task 2: La puerta del borrado

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`obtenerUsoItem`)
- Test: `backend/src/modules/items/items.service.spec.ts`
- Test: `backend/test/recetas.e2e-spec.ts`

**Interfaces:**
- Consume: el primitivo de la Task 1.
- Produce: `DELETE /items/:id` de un ingrediente pedido como extra en una cuenta abierta
  responde `400 "No se puede eliminar: está pedido en Mesa 4 · cuenta 1"` — **el mismo
  texto** que ya sale cuando el ítem es el de la línea. Hay e2e que afirman ese texto: no
  se inventa uno nuevo.

- [x] **Paso 1 — Test e2e que falla.** Cuenta abierta con una hamburguesa con queso extra
      → `DELETE /items/:quesoId` responde 400 y nombra la mesa. Hoy responde 200.
- [x] **Paso 2 — Corrido y visto fallar** (con `reset-db.sh` antes).
- [x] **Paso 3 — Implementado.** La rama `'cuenta'` de `obtenerUsoItem` pasa a contemplar
      también la personalización. El e2e 9 (borrar un extra sin mesas) siguió verde: el
      bloqueo es por mesa viva, no un endurecimiento del catálogo.
      ⚠️ **`extra` sigue siendo advertencia cuando NO hay cuenta abierta.** Borrar un
      ingrediente que es extra permitido de una receta, sin mesas pidiéndolo, es legítimo y
      hay un e2e que lo fija (*"permite borrar un ingrediente usado solo como extra y
      soft-deletea la fila"*). Lo que se agrega es un **bloqueo por cuenta**, no un
      endurecimiento del catálogo. Si ese e2e se pone rojo, el cambio se pasó de largo.
- [x] **Paso 4 — Verificado, sale gratis.** `items.vue:194` ya tiene
      `ETIQUETA_USO.cuenta = 'Está pedido en'` y `'cuenta'` ya está en
      `UsoItemTipoBloqueante`: el modal renderiza el motivo **sin tocar el frontend**.

- [ ] ~~**Paso 4 (original) — `GET /items/:id/uso` sale gratis**~~: el frontend dispara ese endpoint antes
      de abrir el modal de confirmación y lee `bloqueos`, así que el modal explica el
      motivo sin tocar el frontend. **Verificarlo**, no asumirlo: mirar qué renderiza el
      modal con un `bloqueo` de tipo `cuenta`.
- [x] **Paso 5 — El índice: medido, y la nota del plan era optimista.** El `JOIN` a
      cuentas abiertas **no** acota nada — el planificador filtra `cuenta_lineas` primero.
      Con 60.315 líneas: **369 ms y 21.823 buffers**, escaneando las 60.000 una vez por
      mesa. Con un GIN sobre `personalizacion`: **0,16 ms y 24 buffers**. Va declarado en
      la entidad con `@Index(…, { type: 'gin' })`.
      📌 Se descartó un btree sobre `cuenta_lineas(cuenta_id)` que también servía (0,6 ms):
      resolvía la consulta de rebote y arreglaba de paso un hueco viejo que **nadie pidió**
      arreglar. Ese hueco —leer las líneas de una cuenta es hoy un seq scan— va al backlog.

- [ ] ~~**Paso 5 (original) — El índice.**~~ `idx_cuenta_lineas_item` está sobre `item_id` y la búsqueda
      nueva no lo usa. El conjunto queda acotado por el `JOIN` a cuentas abiertas, que es
      chico, pero **medir el plan** (`EXPLAIN`) con la base sembrada y dejar el número
      escrito. Si hace falta un GIN sobre `personalizacion`, va en la entidad con su
      docblock, como el índice que ya está.
- [x] **Paso 6 — Gate + revisión.** Gate corrido **entero dos veces**: una antes de la
      revisión y otra **después** de aplicar sus correcciones (btree→GIN, docs,
      renumeración), las dos en verde — lint 0 errores, typecheck 0, 2391 unitarios, 666
      e2e, y `reset-db.sh --verificar` confirmando que la base no se re-sembró bajo la
      suite. El commit va al final de este paso, no antes.

### Lo que la revisión independiente bloqueó (y tenía razón)

1. **`IndexOptions` de TypeORM SÍ expresa el método del índice** (`type?: TableIndexTypes`,
   con `'gin'`). Mi docblock decía lo contrario y usaba esa falsedad para justificar el
   btree. Verificado en el `node_modules` del contenedor: el GIN se declara en una línea.
   **Cambió la decisión**, no solo el texto.
2. El docblock afirmaba en **presente** un cierre (`grupos-modificadores`) que es la Task 4
   y todavía no existe.
3. `docs/features/recetas.md` seguía diciendo que ser extra permitido *no bloquea* —o sea,
   respaldo escrito para revertir el 400 nuevo—. Actualizado en el mismo commit.
4. El e2e nuevo se numeró `13.`, número ya tomado. Es `15.`.

---

## Task 3: La puerta de editar la receta

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (la rama `dto.extrasPermitidos !== undefined` del update)
- Test: `backend/src/modules/items/items.service.spec.ts`
- Test: `backend/test/recetas.e2e-spec.ts`

**Interfaces:**
- Consume: el primitivo de la Task 1, acotado a **esta receta**.

- [ ] **Paso 1 — Test e2e que falla.** Cuenta abierta con hamburguesa + queso →
      `PATCH /items/:hamburguesaId` con `extrasPermitidos` **sin** el queso responde 400 y
      nombra la mesa. Hoy responde 200 y deja la mesa incobrable.
- [ ] **Paso 2 — Correrlo y verlo fallar.**
- [ ] **Paso 3 — Implementar.** Antes del `UPDATE … SET eliminado_el` que borra la lista:
      calcular qué extras **se sacan** (los vivos que no están en el dto) y preguntar por
      esos ids acotando a esta receta. Si hay cuentas, 400 con el nombre de la mesa.
      ⚠️ **Solo los que se sacan.** Reordenar la lista, cambiarle el precio a un extra o
      agregar uno nuevo no rompe ninguna cuenta y tiene que seguir pasando. Un test por
      cada uno de esos tres casos, o el guard va a bloquear ediciones legítimas.
- [ ] **Paso 4 — Gate + revisión + commit.**

---

## Task 4: La puerta de editar el grupo

**Files:**
- Modify: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.ts`
- Modify: `backend/src/modules/grupos-modificadores/grupos-modificadores.module.ts`
- Test: `backend/src/modules/grupos-modificadores/grupos-modificadores.service.spec.ts`
- Test: `backend/test/combos.e2e-spec.ts` (o el spec de grupos que corresponda)

**Interfaces:**
- Consume: el primitivo de la Task 1, acotado a **este grupo**.
- ✅ **Sin ciclo, verificado:** `GruposModificadoresModule` no importa `ItemsModule` y
  `ItemsModule` no importa grupos, así que agregar el import va en una sola dirección.

- [ ] **Paso 1 — Test e2e que falla.** Cuenta abierta con un combo que eligió la opción
      "Chuleta" → `PATCH /grupos-modificadores/:id` sin esa opción responde 400 y nombra la
      mesa.
- [ ] **Paso 2 — Correrlo y verlo fallar.**
- [ ] **Paso 3 — Implementar.** El service ya calcula `eliminadas` (las opciones que
      desaparecieron) justo antes de soft-borrarlas: ahí va la pregunta, con los ids de
      esas opciones y el `grupoId`.
      ⚠️ **`ItemsService` en el constructor rompe el unitario de este service**: arma el
      provider a mano. Abrir su `.spec.ts` en el mismo momento y agregar el mock — y que el
      mock devuelva lista vacía por default, no `undefined`.
- [ ] **Paso 4 — Gate + revisión + commit.**

---

## Task 5: Documentación y cierre

**Files:**
- Modify: `docs/features/salones-cuentas.md` (o el que documente el ciclo de la cuenta —
  confirmar cuál con `docs/README.md`)
- Modify: `docs/features/personalizacion-recetas.md`
- Modify: `docs/agent/pendientes.md` (sacar la entrada de § 2)
- Modify: `docs/agent/resueltos.md`

- [ ] **Paso 1 — La regla, en una línea citable:** *lo que una cuenta abierta ya pidió no
      se saca del catálogo*, con las cuatro puertas donde está puesta y el porqué (dejar
      una mesa incobrable no es una decisión que nadie tomó).
- [ ] **Paso 2 — El cierre en `resueltos.md`**, con lo que la entrada no sabía: que eran
      tres puertas y no una, que el agujero es anterior a la tanda del override, y que la
      opción de grupo estaba cerrada por otra regla.
- [ ] **Paso 3 — ¿Queda algo?** La entrada original proponía además que el composable deje
      de tragarse el error del preview. Con las cuatro puertas cerradas, el 400 deja de ser
      alcanzable **por acción de catálogo** — pero no es lo mismo que "imposible". Decidir
      con evidencia si queda una entrada residual (¿hay otro camino que invalide una
      personalización ya pedida?) o si se cierra entera.
- [ ] **Paso 4 — Commit.**
