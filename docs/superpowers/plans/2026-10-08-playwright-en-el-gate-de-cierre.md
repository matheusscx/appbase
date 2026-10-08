# Plan: Playwright entra al gate de cierre

- **Status:** Done
- **Date:** 2026-10-08
- **Owner:** sesión "Harness: Playwright local en el gate de cierre" (lanzada por la orquestadora)

## Context

Entrada de `docs/agent/pendientes.md` § 3, "Playwright entra al gate de cierre": el owner eligió A
(correr Playwright en local antes de integrar). Solo docs y harness.

## Scope / Out of scope

- Dentro: el paso en el checklist de `CLAUDE.md` y en `verify-feature` paso 1; el criterio de cuándo
  aplica; cómo leer la corrida; por qué en local si CI ya lo corre. Mover la entrada a `resueltos.md`.
- Fuera: scripts (salvo que un comando escrito no funcione tal cual: se avisa), el portón de CI (C).

## Tareas

- [x] Criterio desde los casos reales: la entrada (`f34eb6bf`, la regla del total vivía en el
      service, no solo en el DTO), `d08aef16` (un spec de Playwright nuevo, rojo en CI) y los
      commits desde el 2026-10-01 clasificados por ruta.
- [x] Correr tal cual, con turno: `entorno.sh stack` → `reset-db.sh` → RestartCount →
      `npm run e2e:smoke` (la orquestadora acotó a smoke) → RestartCount → `entorno.sh borrar`.
- [x] Escribir `CLAUDE.md` (checklist) y `verify-feature` paso 1.
- [x] Mover la entrada a `resueltos.md`.
- [x] `check-docs-links.mjs`, `check-md-tables.mjs`, `domain-reviewer` con la duda de si el criterio
      se aplica sin preguntar.

## Verification

Los comandos escritos se corrieron tal cual en este worktree, con `npm run e2e:smoke` en vez de la
suite entera (turno de la orquestadora). Checks de docs en verde. Sin gate de suites: no hay código.
Lo medido está en `resueltos.md` (la entrada cerrada) y la entrada nueva de `pendientes.md` § 2.

## Decisions / Open questions

- El criterio va por rutas del diff, no por "¿consume esto el front?": esa pregunta es juicio, y en
  el caso real se contestó mal sin que nadie la formulara.
