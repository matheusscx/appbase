# Pendientes — a corregir al terminar el harness

Backlog de correcciones que se **difirieron a propósito** mientras trabajamos en el
harness, para no mezclar el meta-trabajo (reglas, gates, docs) con cambios de código de
producto. Cada entrada dice qué, dónde, por qué se difirió y cómo se cierra.

Regla de este archivo: una entrada sale cuando se corrige (marcar `[x]` y, en el commit
que la cierra, borrarla o moverla a un changelog). No es un TODO genérico: solo va lo que
ya identificamos con ubicación concreta.

---

## Deuda de código (surgió durante el harness)

- [ ] **Burndown de typecheck del frontend — 122 errores** (frontend)
  Bajo ratchet en `frontend/typecheck-baseline.json`. Quemar por tandas (por archivo).
  `items.vue` es el peor (38) → primera tanda natural.
  **Fix:** TS2322 → extraer `@click` a funciones nombradas en `<script setup>`;
  TS2532 → aserción no-nula `arr[idx]!.campo` sobre índice de `v-for`.
  Ejemplos en `anti-patterns.md`. Tras cada tanda: `npm run typecheck:ratchet -- --update`
  y commitear la baseline en el mismo commit.
  **Verificar:** total de la baseline baja; ratchet en verde.

---

## Harness / tooling (CodeGraph)

- [ ] **Sync de CodeGraph en un git hook + niveles de búsqueda** (harness)
  El índice `.codegraph/codegraph.db` (gitignoreado, local por clone — no se versiona) lo
  mantiene al día un daemon con file-watcher (`.codegraph/daemon.sock`, ~1s de lag). Si el
  daemon no corre (recién clonado, otra terminal, tras un rebase/checkout grande), el
  índice queda viejo y `codegraph explore` devuelve call-paths desactualizados sin avisar.
  **Fix hook:** agregar `codegraph sync --quiet` (el flag existe literalmente "for git
  hooks") como guard **no-bloqueante**. Preferir un `pre-push` nuevo antes que
  `.githooks/pre-commit`: correr en cada commit es redundante con el daemon, en push es una
  garantía barata antes de cambiar de contexto. Nunca `codegraph index` en un hook
  (reconstruye todo el índice, caro); `sync` es incremental. Si falla (daemon/CLI ausente),
  no bloquear el push — es red de seguridad, no un gate.
  **Definir niveles de búsqueda:** estandarizar el `--max-files` de `codegraph explore`
  como convención (p.ej. *rápido* = default para "¿dónde está X?"; *profundo* =
  `--max-files` alto para entender un módulo o su arquitectura) y documentarlo en el
  "Orden de búsqueda" de `CLAUDE.md`, para no re-decidir la profundidad en cada consulta.
  **Verificar:** con el daemon apagado, tocar un símbolo, pushear, y confirmar que
  `codegraph status` refleja el cambio sin haber corrido `index` a mano.

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
