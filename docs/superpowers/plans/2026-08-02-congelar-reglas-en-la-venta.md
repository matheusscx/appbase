# Congelar las reglas aplicadas en la venta: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poder decir "este descuento era 10% cuando se hizo la venta, aunque hoy sea 20%", y lo mismo para recargos e impuestos. Auditoría, no operación diaria.

**Architecture:** Columnas, no snapshot JSON — termina un patrón que ya existe a medias (`porcentaje_aplicado` ya está en las tres tablas y los impuestos la pueblan) y sigue el idioma del repo (`venta_detalles` ya congela `item.nombre` y `clasificacion_tributaria` como columnas). El motor propaga por la traza lo que hoy descarta; la persistencia lo escribe. Un `jsonb` chico solo para la config del cálculo, que es un objeto que se lee entero.

**Tech Stack:** NestJS + TypeORM (Postgres 15), Nuxt 4 + Nuxt UI. Jest (unit + e2e supertest), Vitest en frontend.

**Spec:** `docs/superpowers/specs/2026-08-02-congelar-reglas-en-la-venta-design.md`

## Global Constraints

- ⛔ **Toca el motor de cálculo de precios.** Ningún cambio de aritmética: solo se propaga información que ya existe en el punto de evaluación. Si una tarea necesita mover un número, **detenerse y preguntar**.
- Dinero y porcentajes con Decimal.js, nunca `number` nativo. Porcentajes en decimal (`0.19` = 19%).
- `tenant_id` sale **siempre** del token, nunca del body/query/param.
- Soft delete en todo. Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`.
- `type: 'uuid'` explícito en toda PK/FK (ADR-004, lo fuerza `uuid-columns.invariant.spec.ts`).
- **Un N+1 no se difiere, se saca en el momento** (regla del owner, 2026-08-02). Distinguir las tres formas: N+1 de lectura (sale siempre), escritura de N filas (se batchea), escritura con orden de lock deliberado (no se toca sin analizar dónde se decide el lock).
- Se trabaja y commitea **directo sobre `main`**. Sin ramas, sin PRs.
- Gate obligatorio antes de cada commit: `cd backend && npm run lint:check && npm run typecheck && npm test`; `./scripts/reset-db.sh` **inmediatamente** antes de `npm run test:e2e` completo; `cd frontend && npm run build && npx vitest run && npm run typecheck:ratchet && npm run design:check`.
- Cierre de cada task: sub-agente `domain-reviewer` sobre el diff staged + recibo `git diff --cached | git hash-object --stdin > .git/verify-feature.receipt`.
- Todo fix lleva test, y el test lleva **mutante verificado revirtiendo al código anterior** (nunca un `throw`).
- El proyecto **no tiene datos productivos**: se cambia el esquema, se actualiza el seeder y se resetea. No se diseñan backfills ni migraciones incrementales.
- `synchronize: true` sigue activo: el esquema real lo generan las entities. `startup-pos.sql` es documentación y se actualiza igual, en el mismo commit.
- **Entidad o columna nueva → registrarla también en el array `entities` de `app.module.ts`** si corresponde; no hay `autoLoadEntities` y ni unit ni typecheck lo cazan.

---

## Lo que se congela, por familia

Medido el 2026-08-02 sobre `ventas.service.ts:426-486`. La asimetría es intencional, no un olvido.

| Columna | `ventas_descuentos` | `ventas_recargos` | `ventas_impuestos` | Por qué |
|---|---|---|---|---|
| `detalle_id` | nueva | nueva | nueva | `uuid` **nullable**: las filas `aplicado_en = 'venta'` no pertenecen a ninguna línea |
| `porcentaje_aplicado` | **poblar** | **poblar** | ya poblada | La columna ya existe en las tres; hoy solo impuestos la escribe |
| `modo` | nueva | nueva | — | Los impuestos son siempre porcentaje |
| `nombre_regla` | nueva | nueva | nueva | El motor ya lo lleva en la traza; la persistencia lo tira |
| `valor_solicitado` | nueva | — | — | Solo los descuentos los topea el piso en cero |

Y `config_calculo jsonb` en `ventas`: `formula`, `calculoDescuentos`, `calculoRecargos`, `escalaCalculo`, `modoRedondeo`. Sin ella el congelado no es interpretable — el mismo 10% da distinto según el orden de la fórmula y el modo base/cascada, ambos editables desde Preferencias.

---

## Estructura de archivos

- `src/modules/calculo-precios/calculo-precios.engine.ts` — **modificar**. `TrazaRegla` gana campos; `seleccionarTramo()` expone el tramo elegido.
- `src/modules/ventas/entities/venta-descuento.entity.ts`, `venta-recargo.entity.ts`, `venta-impuesto.entity.ts` — **modificar**. Columnas nuevas.
- `src/modules/ventas/entities/venta.entity.ts` — **modificar**. `config_calculo`.
- `src/modules/ventas/ventas.service.ts` — **modificar**. Batch de escrituras + poblar columnas.
- `src/modules/seeder/seeder.service.ts` — **modificar** si el seed necesita una regla por tramos para los tests.
- `startup-pos.sql` — **modificar**. Documentación del esquema.
- `docs/features/motor-calculo-precios.md` — **modificar** (Task 5).

---

### Task 1: El motor propaga lo que hoy descarta

Es el spike que fija el contrato: **hasta que esta task no cierre, las siguientes llevan intención, no código exacto.** Sin persistencia todavía.

- [x] `TrazaRegla` gana `modo`, `valorEfectivo` y `valorSolicitado` (este último solo se puebla en descuentos; en recargos queda igual a `monto`).
- [x] ~~`seleccionarTramo()` pasa a devolver **cuál** tramo eligió~~ → **corregido al medir:** `seleccionarTramo()` **ya devolvía** el tramo entero; quien lo tiraba era `evaluarRegla()`, que retornaba solo un `Decimal`. El cambio real es que `evaluarRegla()` pasa a devolver `{ monto, valorEfectivo }`. Mismo efecto, otro lugar.
- [x] `valorSolicitado` se captura **antes** del tope al disponible, y después del guard de "ninguna regla aporta un monto negativo" (documentado en el tipo: una regla que evaluó negativo reporta `0` en los dos campos).
- [x] Unit tests del motor: regla plana `porcentaje`, regla plana `monto_fijo`, regla por **tramos** (que el valor reportado sea el del tramo que aplicó, no `null` ni el primero), descuento topeado (`valorSolicitado` ≠ `monto`), y `valorEfectivo` `null` en los tres casos de "no aplicó".
- [x] **Mutante:** revertida la propagación del tramo a `regla.valor` → cae exactamente el test de tramos (`Expected "0.10", Received null`). Restaurado.

**Cerrada en `536febef`.** Gate completo en verde (incluye `test:e2e` sobre BD reseteada) y `domain-reviewer` LIMPIO. Un hallazgo cosmético del revisor aplicado antes del commit: el docstring de `valorSolicitado` nombraba solo el tope como fuente de divergencia y omitía el clamp de negativos. `TrazaImpuesto` dejó de extender `TrazaRegla` (misma forma exacta) para no arrastrar campos que a un impuesto no le aplican; verificado en el repo entero que nada dependía de esa herencia.

⚠️ Ningún total puede moverse en esta task. Si un test de cálculo existente cambia de resultado, hay un bug: detenerse.

### Task 2: Batchear las escrituras de la venta

Refactor puro, **sin columnas nuevas**, para que el test de no-regresión sea limpio: si se batchea después de agregar columnas, no se puede distinguir qué rompió qué.

- [x] Las tres tablas de reglas (`ventas.service.ts:426-486`): acumular las filas y hacer un `save` por entidad con el array completo, en vez de un `await save()` por traza. Hoy son N round-trips **en serie**.
- [x] `venta_detalles` (`:387-423`): mismo tratamiento. Hoy es `Promise.all` + `save` por línea — N round-trips concurrentes. Se toca igual porque Task 4 necesita los ids generados.
- [x] **No tocar** el bucle de movimientos de inventario (`for (const i of ordenLocks)`): escribe en orden de lock determinista y batchear cambiaría la semántica de deadlock.
- [x] Test de no-regresión: una venta con varias líneas y varias reglas por línea produce **exactamente las mismas filas** que antes — misma cantidad, mismos montos, misma atribución. Es un cambio de rendimiento; si mueve un número, está mal.

**Verificado para Task 4:** `manager.save(Entity, array)` devuelve **las mismas instancias en el mismo orden** que recibió — confirmado contra el fuente de TypeORM instalado (`EntityManager.js` resuelve con `.then(() => entity)`, y el chunking solo agrupa las queries de escritura). El repo no tiene `@BeforeInsert`/`@AfterInsert`/subscribers que muten el array. Sobre eso se apoya el cruce `detalles[i]` ↔ `resultado.lineas[i]` de Task 4.

El test nuevo usa `toEqual` sobre el array completo, que compara **posición por posición**: una permutación de las filas lo hace fallar, no solo una fila faltante. Mutante verificado: vaciar el push de las reglas a nivel venta → `-5 +0`.

### Task 3: El esquema

Inerte: las columnas existen y nada las puebla todavía. Separada porque es mecánica y un reviewer la aprueba o rechaza entera.

- [ ] Columnas nuevas en las tres entities, según la tabla de arriba. `detalle_id` con `type: 'uuid'` explícito y **nullable**.
- [ ] `config_calculo jsonb` en `Venta`.
- [ ] `startup-pos.sql` actualizado.
- [ ] Verificar que `uuid-columns.invariant.spec.ts` siga en verde con las FK nuevas.

### Task 4: Poblar el congelado

- [ ] Escribir `modo`, `nombre_regla`, `porcentaje_aplicado` y `valor_solicitado` desde la traza, en las tres familias según la tabla.
- [ ] `porcentaje_aplicado` se puebla solo en reglas `porcentaje`; en `monto_fijo` queda `null` **explícito** — que no se cuele un `0` que después se lea como "0%".
- [ ] `detalle_id`: mapear línea↔detalle **por índice** contra `resultado.lineas`, **nunca por `itemId`** — el mismo ítem puede aparecer en dos líneas con personalizaciones distintas. Mismo criterio que ya usa el frontend para cruzar advertencias.
- [ ] `config_calculo` desde la `ConfigCalculo` con la que se calculó.
- [ ] Agregar los campos nuevos al `SELECT` del detalle de venta (`ventas.service.ts:1463-1476`) y al armado de la respuesta (`:1625-1639`), para que viajen solos a quien ya consume ese endpoint.
- [ ] e2e **el que importa**: crear una venta con una regla de 10%, **editar la regla a 20%**, y verificar que la venta sigue diciendo 10%. Y su gemelo con la regla **borrada**.
- [ ] e2e de `detalle_id`: una venta con la **misma regla en dos líneas** distintas, verificando que las filas quedan atribuidas a líneas distintas. Es el caso que hoy produce filas indistinguibles.
- [ ] e2e del tope: `valor_solicitado` ≠ `valor_aplicado`, con el caso ya reproducido a mano (regla fija $5.000 sobre línea de $1.500 → aplicado $1.500, solicitado $5.000).
- [ ] **Mutante:** quitar `detalle_id` del insert y confirmar que cae el test de las dos líneas.

### Task 5: Documentación

- [ ] `docs/features/motor-calculo-precios.md`: qué congela la venta y por qué, con la tabla por familia y la asimetría explicada.
- [ ] `docs/ESTADO.md`: fila de la funcionalidad.
- [ ] Cerrar en `docs/agent/pendientes.md` la entrada del recorte de descuentos, y mover el detalle a `resueltos.md`.
- [ ] Evaluar si el batch de Task 2 merece entrada en `docs/patterns/backend.md` — el repo ya prohíbe el N+1 de lectura, pero no dice nada sobre escrituras de N filas, y la distinción ya causó dos falsos positivos en auditoría.

---

## Decisions / Open questions

**Decidido por el owner (2026-08-02):**
- Columnas y no snapshot JSON (revirtiendo la decisión de JSON del mismo día, al medir que el patrón de columnas ya existe con consumidor).
- Un N+1 se saca en el momento, no se difiere al backlog.

**Resueltas por el owner (2026-08-02), confirmando las dos asunciones del plan:**
- **Las reglas a nivel venta** (`aplicado_en = 'venta'`) **entran al congelado.** Por eso `detalle_id` va nullable: esas filas no pertenecen a ninguna línea.
- **`nombre_regla` también para impuestos**, para dejar las tres familias parejas.
