# Pendientes — a corregir al terminar el harness

Backlog de correcciones que se **difirieron a propósito** mientras trabajamos en el
harness, para no mezclar el meta-trabajo (reglas, gates, docs) con cambios de código de
producto. Cada entrada dice qué, dónde, por qué se difirió y cómo se cierra.

Regla de este archivo: una entrada sale cuando se corrige (marcar `[x]` y, en el commit
que la cierra, borrarla o moverla a un changelog). No es un TODO genérico: solo va lo que
ya identificamos con ubicación concreta.

---

## Deuda de código (surgió durante el harness)

- [x] **Burndown de typecheck del frontend — COMPLETO (0 errores)** (frontend) — jul-2026
  Los 84 errores de vue-tsc estricto se quemaron por tandas. `typecheck-baseline.json`
  quedó vacío: el `typecheck:ratchet` ahora es un gate totalmente estricto (cualquier
  error nuevo bloquea CI). Todos los patrones y sus fixes solo-de-tipo quedaron en
  `anti-patterns.md` (`@click`→arrow inline; spread/índice guardado→`!`; `string|null`→prop
  con `?? undefined`/tipar form; mismatches Nuxt UI·reka; tipado de unit tests vitest).

---

## Harness / tooling (CodeGraph)

- [x] **Sync de CodeGraph en un git hook + niveles de búsqueda — HECHO** (harness) — jul-2026
  `.githooks/pre-push` corre `codegraph sync --quiet` (red de seguridad no-bloqueante:
  nunca frena el push, no-op si CodeGraph ausente; nunca `index`). Validado empíricamente:
  el daemon estaba caído y el índice tenía 44 archivos viejos; el sync los reconcilió en
  <1s. Niveles de búsqueda (`--max-files`: rápido=default / normal=3-5 / profundo=10+)
  documentados en el "Orden de búsqueda" de `CLAUDE.md`.

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

## Propinas en POS (notas de la revisión final, severidad baja — no bloqueantes)

- [ ] **Unique index para el garzón placeholder "Mostrador"** (backend) — `asegurarMostrador`
  (`garzones.service.ts`) es find-or-create sin restricción única sobre `(tenant_id,
  es_placeholder)`. En la práctica el placeholder ya existe (se siembra al crear el tenant
  y en el seed), así que el camino on-demand es solo fallback para tenants preexistentes;
  bajo concurrencia, dos "primeras" propinas de POS de un tenant sin placeholder podrían
  insertar dos "Mostrador" (duplicado benigno: ambos neutros y ocultos). Cerrar con un
  índice único parcial `WHERE es_placeholder = true AND eliminado_el IS NULL`.
- [ ] **Validación de `propinaDirecta`** (backend) — `montoPagado` es `@IsNumberString()`
  sin garantía de `> 0`, y no se restringe al canal `fisico`. Es el mismo patrón que
  `propinaCierreMesa` preexistente (no regresión); si se endurece, hacerlo en ambos.

## Refactor Caja → "Mi caja" / "Cajas" (diferido del brainstorm 2026-07-23)

El refactor separa la operación del cajero (**"Mi caja"**) de la supervisión del encargado
(**"Cajas"**). Se decidió que **"Cajas" arranca solo-lectura**; los poderes de escritura del
encargado se difieren a propósito para no acoplar el refactor de IA/permisos a un cambio de
modelo con implicancias de auditoría. Investigación y cruce de mercado:
[`investigaciones/2026-07-23-gestion-caja.md §6`](investigaciones/2026-07-23-gestion-caja.md).

- [ ] **Cierre forzado de caja ajena por el encargado** (backend + modelo) — habilitar que
  un usuario con permiso `Cajas` cierre la caja de un cajero que dejó el turno abierto
  (escenario: cajero que se fue de urgencia). Requiere agregar **`cerrada_por`** a la tabla
  `cajas` (quién contó/cerró), distinto de `usuario_id` (de quién es el turno): sin ese
  campo el cierre mentiría sobre quién respondió por el efectivo. Rompe el owner-only del
  cierre bajo permiso `Cajas:Actualizar`. Mercado: la separación de funciones favorece que
  un segundo intervenga en el cuadre.
- [ ] **Aprobación de cierre por umbral de diferencia** (backend + config) — patrón Toast:
  si el over/short del cierre supera un umbral configurable, el cierre del cajero requiere
  aprobación del encargado. Agrega config de umbral por tenant + flujo de aprobación. Más
  fiel al mercado; mayor alcance. Depende de resolver antes el `saldo_esperado` efectivo vs.
  total (§3 de la investigación), que hoy inflaría toda diferencia.

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
