# Plan: el arranque en frío del stack de un worktree

**Status**: Done · **Date**: 2026-10-09 · **Owner**: frente lanzado por la orquestadora

Spec: [`2026-10-09-arranque-en-frio-del-stack-design.md`](../specs/2026-10-09-arranque-en-frio-del-stack-design.md).
Lo medido, con los números: [`resueltos.md`](../../agent/resueltos.md) (cerrada 2026-10-09).

## Context

Dos entradas de `pendientes.md` § 2 que comparten causa probable: el primer arranque de
`nuxt dev` dentro del stack completo de un worktree.

## Scope / Out of scope

- **Adentro:** medir las dos; el arreglo mecánico de cada una; la regla de lectura de
  `verify-feature` paso 1.
- **Afuera:** el mecanismo interno de la VM de Docker Desktop; la presión de memoria, que con
  3,83 GiB arriesgaba los contenedores de otras sesiones; la suite entera de Playwright con
  carga.

## Tareas

- [x] Medir el `ENOENT`: orden secuencial, orden paralelo y paralelo sin el `prepare` del host,
  con un vigía de `.nuxt` en el host. Mirar el checkout principal.
- [x] Arreglo: volumen anónimo `/app/.nuxt` en `docker-compose.yml`. Correr el revert intercalado.
- [x] Medir el primer `/login` en frío con 0, 2 y 12 quemadores de CPU en la VM, y la 2ª corrida
  sola.
- [x] Arreglo: `setup.setTimeout(120_000)` en `auth.setup.ts`. Correr el revert con la misma
  carga, y `e2e:smoke` entero.
- [x] `verify-feature` paso 1. Mudar las dos entradas a `resueltos.md`.
- [x] Gate de cierre completo, con `test:e2e` y Playwright entero en el stack propio (en turno de
  la orquestadora), y RC del frontend en el `up`.

## Verification

Ver "Qué lo fija" en `resueltos.md`.
