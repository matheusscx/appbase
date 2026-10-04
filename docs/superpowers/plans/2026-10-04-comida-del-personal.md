# Plan: la comida del personal, con motivo propio y sin IVA

**Status:** Done · **Date:** 2026-10-04 · **Owner:** sesión "Fiscal: la comida del personal"
**Spec:** [`2026-10-04-comida-del-personal-design.md`](../specs/2026-10-04-comida-del-personal-design.md)

## Context

Entrada de `pendientes.md` § 6. Las decisiones (tipo nuevo, mesa + Mermas, sin documento ni IVA,
dueño y lo que se lleva el empleado como cortesía, balde de varianza) están en la entrada, con su
procedencia. Se ejecuta sin esperar revisión (encargo del owner).

## Scope / Out of scope

Dentro: spec § 3. Fuera: spec § 4 (el "costo perdido" del kardex va a una entrada nueva).

## Backend

- [x] **1. Enum, predicado y motivo fijo.** `CONSUMO_PERSONAL` en `tipo-motivo-baja.enum.ts`, más
  `tipoMotivoBajaDescuenta(tipo)` junto al enum (con su spec). Octavo fijo en
  `motivos-baja.defaults.ts`. Seeder: `NUEVOS` con 460/461. Arreglar los tests que cuentan siete
  fijos.
- [x] **2. Mesa.** `salones.service.ts`: los tres `tipoDescuenta` pasan a usar el predicado. Los
  baldes siguen colgando solo de `CORTESIA`. Unit en `salones.service.spec.ts`: anular y cancelar
  con personal descuentan y no consultan baldes.
- [x] **3. Mermas.** `POST` acepta `merma | consumo_personal`. `FindMermasDto.tipo` (IsIn de los
  dos, por defecto `merma`). El filtro de tipo en COUNT y en la página va bindeado. `resumen` sigue
  fijo en `merma`. Unit + e2e (`mermas.e2e-spec.ts`).
- [x] **4. Varianza.** `P.PERSONAL`, columna `personal` en `BucketRow`, la fila, el residuo y el
  resumen (cantidades y plata), fuera de "plata perdida". Unit + e2e
  (`reportes-varianza-buckets.e2e-spec.ts`).
- [x] **5. E2E de la mesa.** `salones-anular-linea.e2e-spec.ts`: un plato con receta anulado como
  personal descuenta los ingredientes y deja `monto_*` en `NULL`.
  `salones-anulaciones-reporte.e2e-spec.ts`: el grupo `consumo_personal` con `fiscal: null`.

## Frontend

- [x] **6. Tipo y ayuda.** `useSalones.ts`: `TipoMotivoBaja`, la etiqueta *"Comida del personal"* y
  `AYUDA_CONSUMO_PERSONAL`. Las copias locales (`motivos-baja.vue`, `anulaciones.vue`, `varianza.vue`)
  también.
- [x] **7. Modal de anulación y precuenta.** `AnularLineaModal.vue` muestra la ayuda cuando el
  motivo elegido es de personal. `salones/index.vue` → `anuladasParaTicket` incluye personal.
- [x] **8. Anulaciones.** Cuarta tarjeta, opción de filtro y etiqueta (grid de 4).
- [x] **9. Mermas.** El selector *Mermas / Comida del personal*, según la spec § 3.3.
- [x] **10. Configuración de motivos.** Opción nueva y su ayuda.
- [x] **11. Varianza.** Columna y total *"Personal"*.
- [x] **12. Specs de componentes** (`*.nuxt.spec.ts`) de cada pantalla tocada, y Playwright: un
  caso de Mermas para personal.

## Verification

- [x] Arranque medido (con `node dist/main` sobre el dump de `main`): base sembrada por `main` (con anulaciones y mermas de los tres tipos), y
  arranque de este código encima: sin error, filas con su tipo, y el enum con cuatro valores.
- [x] Mutantes de la spec § 5, revertidos.
- [ ] Gate entero (`verify-feature`), con turno de la orquestadora: lint, typecheck, unit, e2e,
  build, test de front, ratchet, design:check y Playwright entero.
- [x] Docs en el mismo commit: `PRODUCTO.md`, `impuestos.md`, `salones-mesas.md`,
  `mermas-valorizadas.md`, `reporte-varianza.md`, `ESTADO.md`. La entrada se mueve a `resueltos.md` y
  se suma la entrada nueva del "costo perdido" del kardex.

## Decisions / Open questions

Todas resueltas (entrada de `pendientes.md`). Si algo exige escribir el kardex de otra forma que un
motivo nuevo: parar y preguntar.
