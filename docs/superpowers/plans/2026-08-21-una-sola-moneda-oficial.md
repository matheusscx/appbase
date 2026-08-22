# Plan: una sola noción de moneda oficial — se elimina `tenant_moneda.es_default`

**Status:** Done — 2026-08-21
**Date:** 2026-08-21
**Owner:** Cesar Matheus

## Context

"Oficial" nombraba dos cosas: `pais.moneda_oficial_id` (ADR-005: la del país, el tenant no la
elige) y `tenant_moneda.es_default`. **Decisión del owner (2026-08-21): la única noción es la
del país, y el campo `es_default` se elimina.**

Lo que el barrido completo encontró y motivó eliminarlo en vez de acotarlo:

- **`es_default` no ordena ningún selector.** La lista sale de `ORDER BY es_oficial DESC` en
  `findMonedas`; nadie en el frontend ordena por él. No hacía el trabajo que su nombre sugiere.
- **Sí decide plata**, en el camino de mayor riesgo: `ventas.service.ts:283` resuelve con él la
  escala de la venta real, la moneda estampada en la cabecera y la moneda del pago.
- **Ya costó código defensivo**: `CobroModal.vue` y `salones/index.vue` redondean la propina al
  `Math.min` de las dos escalas, con un comentario que dice que unificarlas es decisión del owner.
- Nacen coincidiendo (`tenants.service.ts:318-333` siembra la del país como default), así que
  divergen solo si un admin llama `PATCH /monedas/:id/default`.

⛔ Toca persistencia de venta y de pagos: va solo, con el sistema quieto.

## Scope / Out of scope

**In scope:** eliminar la columna, su endpoint y todos sus consumidores; alinear `ventas` con
`pais.moneda_oficial_id`; sacar los dos `Math.min` defensivos; docs.

**Out of scope:** el resto de la sección 4 del backlog. No se toca el motor puro
(`calculo-precios.engine.ts`): el cambio es de qué escala/moneda se le pasan.

## Backend

- [x] `decimalesOficiales` resuelve por `pais.moneda_oficial_id` (ya hecho, staged)
- [x] `ventas.service.ts:270-289` — resolver moneda y escala por país, no por `es_default`
- [x] `ventas.service.ts:293` — el `tasaMap` fuerza `1` a la moneda del país, como `findMonedas`
- [x] `tenant-moneda.entity.ts` — eliminar la columna `esDefault`
- [x] `monedas.service.ts` — sacar `esDefault` de `MonedaTenant`, de `findMonedas` y de
      `upsertRow`; eliminar `setDefault`; sacar el guard de `habilitada === false && esDefault`
      (la oficial ya está protegida aparte, `:222`)
- [x] `monedas.controller.ts` — eliminar `PATCH /:monedaId/default`
- [x] `tenants.service.ts:330` — el INSERT del alta deja de nombrar la columna
- [x] `seeder.service.ts:389,396,403` — idem
- [x] `suscripciones.service.ts:104-113` — el comentario dice lo contrario de lo que queda
- [x] `startup-pos.sql:355` — sacar la columna (es documentación; el esquema lo aplica `synchronize`)
- [x] Tests: `ventas.service.spec`, `monedas.service.spec`, `calculo-precios.service.spec`

## Frontend

- [x] `types/moneda.ts` — sacar `esDefault` (2 declaraciones + el mapeo)
- [x] `stores/monedas.ts` — eliminar `monedaDefault`, el patch optimista y la acción `setDefault`
- [x] `CobroModal.vue` y `salones/index.vue` — el `Math.min` pasa a ser la escala de la oficial
- [x] `items.vue:803` — el formulario preselecciona la oficial
- [x] `configuracion/monedas.vue` — sacar la columna y la acción "marcar como predeterminada"
- [x] Tests del frontend que nombran `esDefault`/`monedaDefault`

## Verification

- [x] Gate backend completo + `reset-db.sh` + **e2e COMPLETO** (cambia el esquema: la columna
      desaparece por `synchronize`) + `--verificar`
- [x] Gate frontend completo
- [x] **Mutante**: devolver `ventas.service` a `es_default` tiene que romper un test
- [x] Revisión independiente sobre el diff, recibo, commit

## Documentación

- [x] **ADR nuevo**: una sola noción de moneda oficial, y por qué se elimina la columna en vez
      de acotarla. Enlazado desde ADR-005 y desde el índice.
- [x] `docs/features/configuracion-monedas.md`
- [x] `docs/agent/resueltos.md` + sacar la entrada de `pendientes.md`

## Decisions

- **La única noción de moneda oficial es `pais.moneda_oficial_id`** (owner, 2026-08-21).
- **El campo se elimina, no se acota.** No hacía ningún trabajo de presentación y su única
  conducta real era decidir plata por un camino distinto al del resto del sistema.
- El proyecto **no tiene datos productivos**, así que eliminar la columna es cambiar el esquema
  y resembrar; no hay backfill ni deprecación.
