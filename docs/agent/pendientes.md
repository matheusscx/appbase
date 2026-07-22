# Pendientes — a corregir al terminar el harness

Backlog de correcciones que se **difirieron a propósito** mientras trabajamos en el
harness, para no mezclar el meta-trabajo (reglas, gates, docs) con cambios de código de
producto. Cada entrada dice qué, dónde, por qué se difirió y cómo se cierra.

Regla de este archivo: una entrada sale cuando se corrige (marcar `[x]` y, en el commit
que la cierra, borrarla o moverla a un changelog). No es un TODO genérico: solo va lo que
ya identificamos con ubicación concreta.

---

## Deuda de código (surgió durante el harness)

- [ ] **N+1 real en `items.service.findAll`** (backend)
  `backend/src/modules/items/items.service.ts` — el listado paginado llama
  `calcularDisponibleReceta`/`calcularDisponibleCombo` por cada fila; cada una consulta
  la BD. Listar N items = N+ queries.
  **Fix:** resolver disponibilidad de todas las filas en una query batch
  (`WHERE item_id = ANY($1)` + agregación) y mapear en memoria. Con test.
  **Verificar:** el endpoint hace un nº constante de queries sin importar el nº de filas.
  Ancla el anti-patrón N+1 de `anti-patterns.md`.

- [ ] **Burndown de typecheck del frontend — 122 errores** (frontend)
  Bajo ratchet en `frontend/typecheck-baseline.json`. Quemar por tandas (por archivo).
  `items.vue` es el peor (38) → primera tanda natural.
  **Fix:** TS2322 → extraer `@click` a funciones nombradas en `<script setup>`;
  TS2532 → aserción no-nula `arr[idx]!.campo` sobre índice de `v-for`.
  Ejemplos en `anti-patterns.md`. Tras cada tanda: `npm run typecheck:ratchet -- --update`
  y commitear la baseline en el mismo commit.
  **Verificar:** total de la baseline baja; ratchet en verde.

---

## Suite E2E de navegador (fundación lista, flujos por escribir)

Scaffold Playwright ya funciona (`frontend/e2e/`, auth vía storageState, 1 smoke verde).
Escribir los flujos críticos, cada uno con aserciones derivadas de `docs/features/`
(NUNCA del output del código), `@smoke` en el subconjunto barato, cero esperas fijas:

- [ ] Venta completa hasta documento (afecto + exento; total contra `docs/features/ventas.md`).
- [ ] Pago mixto (múltiples métodos; vuelto solo si `permite_vuelto`).
- [ ] Nota de crédito (referencia a la venta original).
- [ ] Apertura/cierre de caja (reloj congelado; `diferencia` calculada por el sistema).
- [ ] Descuento de stock en una venta (movimiento + saldo materializado).
- [ ] **Cambio de tenant sin fuga de datos** (el más valioso — ninguna prueba unitaria
  lo cubre; login como usuario multi-tenant, verificar aislamiento de catálogo/ventas).
- [ ] Integrar `@smoke` al CI cuando haya masa crítica (hoy el CI no levanta el stack
  de navegador).

## Limpiezas menores (opcionales, no bloqueantes)

- [ ] `items.vue:81` — campo `esPendiente` en `GrupoOpcionOverrideRow` se setea pero
  nunca se lee (el badge re-deriva la condición inline). O wirear el badge a este campo,
  o quitarlo del tipo.
- [ ] DTOs de override — normalizar `@IsUUID('4')` vs `@IsUUID()` (inconsistencia de
  estrictez, inofensiva con seed v4).
- [ ] `backend/src/modules/users/user.entity.ts` (clase `User`) parece **código muerto**:
  duplicado legacy de `Usuario` (`usuario.entity.ts`), sin referencias ni `forFeature`.
  Confirmar y eliminar. (Detectado al automatizar la invariante uuid — ambos tenían el
  mismo `googleId`.)
