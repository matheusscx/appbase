# Orden de bloqueo de filas en ítems compuestos — Design Spec

**Fecha:** 2026-08-19
**Estado:** 📐 Aprobado por el owner — listo para plan de implementación
**Backlog:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) — sección 🔴 "tanda propia",
entrada *"Dos ciclos de orden de lock en la bandeja de desfases de combos…"*
**Pieza siguiente de:** [ADR-020](../../adr/020-contexto-transaccional-als.md), que cerró el
agotamiento del pool de conexiones. **Mecanismo distinto**: aquello eran conexiones al
servidor, esto son filas. ADR-020 no lo toca ni lo arregla.

---

## Contexto

Cuando una transacción escribe una fila, Postgres se la **reserva** hasta que la transacción
termina; cualquier otra que la quiera espera. `FOR UPDATE` es pedir esa reserva por
adelantado sobre una fila que solo se lee. Si dos transacciones piden las mismas dos filas
**en orden inverso**, cada una se queda esperando a la otra: Postgres lo detecta, mata una
con `40P01` y esa persona ve un 500 y pierde la operación.

El caso concreto, con dos usuarios del mismo tenant:

> Ana edita el combo "Promo Pizza" (nombre + componentes). Beto, en la bandeja de desfases,
> aplica el desfase de **ese mismo combo** con "actualizar precio".

| paso | Ana — `update()` | Beto — `aplicarDesfases` |
|---|---|---|
| 1 | escribe `items` → reserva esa fila | |
| 2 | | reserva `item_combo` (`FOR UPDATE`) |
| 3 | quiere `item_combo` → **espera** | |
| 4 | | quiere `items` (precio) → **espera** |

**Verificado contra el código el 2026-08-19** (no deducido):

- `update()` toma `item_receta FOR UPDATE` solo bajo el guard de
  `items.service.ts:1336` (`tipo === 'receta' && dto.ingredientes !== undefined`). El guard
  gemelo para combos —`items.service.ts:1662`— **no toma ningún lock**, así que un PATCH de
  combo va `UPDATE items` → `UPDATE item_combo` (`:1699`).
- `aplicarDesfases` va al revés: `item_combo FOR UPDATE` (`:4133`) → `UPDATE items SET
  precio_base` en el loop de combos.
- `descartarDesfases` (`:4284`) no toma **ningún** lock y recorre `itemIds` en el orden que
  manda el cliente, mientras `aplicarDesfases` ordena siempre receta → combo.
- Los dos `FOR UPDATE` de `aplicarDesfases` (`:4128-4137`) se toman **antes** de
  `cabecerasCompuestas` (`:4139`), que es quien filtra `tenant_id`.
- El test de lecturas constantes existe solo para recetas
  (`items.service.spec.ts:4962`); la rama de combos se ejercita con **un** combo.

**Dos hechos que la entrada del backlog no registraba, medidos en la misma pasada:**

1. **El único escritor de `item_receta` / `item_combo` es `items.service.ts`.** El otro es el
   seeder, que corre al boot sin concurrencia. No hay gemelos en otros módulos: el radio de
   explosión está contenido en un archivo.
2. **El repo ya sabe pinchar orden de locks sin concurrencia real.**
   `items.service.spec.ts:1925` fija el ciclo de recetas afirmando posiciones relativas de
   SQL sobre el mock del manager. Determinista y barato.

**Por qué ahora:** ninguno de los cuatro lo ve un test, y el e2e corre con `maxWorkers: 1`
(`test/jest-e2e.json`) — la misma razón por la que el agotamiento del pool pasó
desapercibido hasta esta tanda.

## Alcance

**Entra** (decisión del owner 2026-08-19: los cuatro juntos, porque el sub-punto 3 mueve el
*lugar* donde se toman los locks y partirlo obliga a volver dos veces sobre las mismas
líneas):

1. El ciclo `items` ↔ `item_combo`.
2. El ciclo `item_receta` ↔ `item_combo`.
3. Los `FOR UPDATE` tomados antes de validar el tenant.
4. El test de lecturas constantes para N combos.

**No entra:**

- **La carrera lectura→escritura de `descartarDesfases`** (decisión del owner 2026-08-19).
  El método lee cabeceras, ingredientes y componentes, calcula el costo propuesto y recién
  ahí escribe `costo_propuesto_omitido`, sin lock: un `aplicar` concurrente puede mover el
  costo en el medio y descartar archivaría como "omitido" un número que ya no es el
  propuesto. Se anota en `pendientes.md` con lo medido. Reordenar cierra el deadlock; esto
  es una carrera distinta y se decide con datos.
- El resto de la tanda 🔴: rendimiento (N+1) y redondeo de plata.

---

## Arquitectura

### 1. Un solo orden de bloqueo, declarado

Los cuatro sub-puntos son la misma falla: no existe un orden declarado entre las tres tablas
del ítem compuesto. Los cuatro caminos que las tocan son **compatibles con un único orden**:

```
item_receta  →  item_combo  →  items
```

| camino | adquiere hoy | ¿respeta? |
|---|---|---|
| `aplicarDesfases` | `item_receta` FU, `item_combo` FU, después `items` | ✅ ya |
| `update()` de receta | `item_receta` FU, después `items` | ✅ ya |
| `update()` de combo | `items`, después `item_combo` | ❌ invertido |
| `descartarDesfases` | `item_receta` / `item_combo` en orden del cliente | ❌ indefinido |

Un camino puede **saltear** tablas (una receta nunca toca `item_combo`); lo que no puede es
tomarlas en otro orden. Con la regla respetada por todos, el ciclo es imposible por
construcción: el que llega primero se queda con las dos y el otro espera milisegundos.

`combo_componentes` queda **fuera** del orden a propósito: solo `update()` la escribe y
`aplicarDesfases` únicamente la lee, así que no participa de ningún ciclo.

### 2. Los tres cambios de código

| # | Cambio | Forma |
|---|---|---|
| 1 | `update()` de combo toma `item_combo FOR UPDATE` antes del `UPDATE items` | Gemelo exacto del lock de recetas de `:1336-1339`, bajo el guard que ya existe en `:1662` |
| 2 | `descartarDesfases` procesa recetas antes que combos | Dos pasadas sobre el lote en vez de una; sin locks nuevos y sin tocar ningún camino preexistente |
| 3 | `aplicarDesfases` valida el tenant antes de lockear | `cabecerasCompuestas` sube **antes** de los dos `FOR UPDATE`, y se lockea solo los ids que la validación devolvió |

Sobre el 3: el invariante del comentario de `:4116-4118` —los locks van antes de leer los
ingredientes, para que otra transacción no cambie la receta entre la lectura y el lock— **se
mantiene**, porque la lectura que necesitaba protección (`ingredientesPorReceta`,
`componentesPorCombo`) sigue después de los locks. `cabecerasCompuestas` lee `items` sin
lock, que es lo que hace que pueda subir.

Se descartó meter el tenant en la propia query de lock con un `JOIN`: sin `FOR UPDATE OF`
explícito, el `JOIN` reservaría **también** la fila de `items`, y reservar `items` antes que
`item_combo` crea exactamente el ciclo que este trabajo cierra.

**Divergencia contra lo implementado:** el filtro "solo los ids que la validación devolvió"
(`idsValidados = ids.filter(...)`) salió del código en el commit `437c467c`. Los dos
`FOR UPDATE` bloquean `ids` directamente. No es un cambio de conducta: el loop de validación
tira `NotFoundException` ante el primer id ausente en `cabPorId`, así que llegar a la línea
del filtro ya implica que `ids` y `idsValidados` son el mismo conjunto — filtrar era la
identidad, y `CLAUDE.md` pide no dejar código muerto. El comentario que queda en
`items.service.ts` (junto a la declaración de `ids`) deja escrito el acoplamiento: si la
validación alguna vez pasa de tirar a saltear ids ajenos, hay que reintroducir el filtro antes
de lockear.

### 3. Cambios de comportamiento asumidos

- **Precedencia de errores de `descartarDesfases`** en lotes mixtos: pasa de orden-del-cliente
  a receta-antes-que-combo. No inventa una precedencia — la alinea con `aplicarDesfases`,
  que ya falla así.
- **Los tests posicionales de `update`/`remove` de combo se mueven**: el lock nuevo cambia la
  secuencia de queries que esos tests afirman por índice.

---

## Tests

Decisión del owner (2026-08-19): **unit de orden para los cuatro, más UN reproductor real.**

1. **Cuatro unit tests de orden**, con el patrón de `items.service.spec.ts:1925` (posiciones
   relativas de SQL sobre el mock del manager):
   - `update()` de combo toma `item_combo` antes del `UPDATE items`;
   - `descartarDesfases` escribe `item_receta` antes que `item_combo` en un lote mixto
     mandado al revés;
   - `aplicarDesfases` valida el tenant (lee `items`) antes del primer `FOR UPDATE`;
   - lecturas **constantes** para N combos, gemelo del de recetas de `:4962`.
2. **Un reproductor de concurrencia real**, sobre el ciclo `item_receta` ↔ `item_combo` de
   `descartarDesfases` — el más alcanzable: se dispara con dos personas resolviendo la misma
   bandeja, sin necesidad de un PATCH simultáneo.

   ⚠️ **El mecanismo del reproductor NO se fija en este spec.** Un interleaving determinista
   que además ejercite el camino real del service es la parte con riesgo técnico, y fijar
   código antes del spike ya salió caro. Lo decide la tarea 1 del plan, contra este criterio
   de aceptación:
   - da **rojo** contra el código de hoy y verde después del fix;
   - ejercita el service de verdad, no una réplica a mano de su SQL;
   - si el spike demuestra que las dos cosas juntas no son factibles, lo dice **con
     evidencia** y cae a la réplica, declarando explícitamente qué prueba y qué no.
3. **Mutante que revierte, no solo rompe**: volver cada camino a su orden viejo y verificar
   que el test lo caza. Después de revertir, comprobar la hora del restart del contenedor en
   los logs antes de dar el veredicto.
4. **Gate completo** con `reset-db.sh` antes del e2e y `--verificar` después. El e2e corre
   **entero** y **solo** — nada de gate de frontend ni subagentes con mutantes en paralelo.

## Documentación (mismo commit que el código)

| Doc | Qué |
|---|---|
| `docs/patterns/backend.md` | La regla del orden `item_receta → item_combo → items`, con el porqué en dos líneas y el puntero al test que la fija |
| Comentarios en los dos caminos | Como el de `:1330-1338`, que ya explica el gemelo de recetas |
| `docs/agent/pendientes.md` → `resueltos.md` | La entrada se cierra; la carrera lectura→escritura de descartar se abre como entrada propia con lo medido |
| `docs/agent/anti-patterns.md` | Solo si el reproductor descubre una forma que no está en la regla |

## Criterio de éxito

- El reproductor da rojo antes y verde después, con su veredicto sobre qué prueba.
- Los cuatro unit tests cazan su mutante de reversión.
- Ningún camino del repo adquiere las tres tablas en un orden distinto al declarado —
  verificado por grep sobre los escritores, que son un solo archivo.
- Gate completo en verde, con el e2e corriendo solo.
