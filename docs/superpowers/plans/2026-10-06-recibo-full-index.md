# Plan: el recibo de revisión hashea el diff con `--full-index`

- **Status:** Done
- **Date:** 2026-10-06
- **Owner:** sí al arreglo el 2026-10-06, al pedir la tanda (`--full-index` en los dos lados)

## Context

`docs/agent/pendientes.md` § 2, "El pre-commit rechaza un recibo de revisión escrito sobre el
mismo diff". El recibo y el hook hashean `git diff --cached`, cuyas líneas `index` llevan el hash
abreviado de cada blob; git elige el largo de la abreviatura según el estado del repo, y salta
entre 8 y 9 caracteres de un momento a otro. Con el mismo contenido staged, el recibo y el hook
hashean bytes distintos. `--full-index` escribe los 40 caracteres y saca esa variable.

## Scope / Out of scope

- **Scope:** las dos puntas del hash con `--full-index`, iguales: el veredicto del hook, el
  `hook.diff` de la evidencia, el comando que imprime el hook y el del skill `verify-feature`.
  Una pista en la evidencia para el recibo escrito con el comando viejo (los worktrees creados
  antes de integrar traen el skill viejo).
- **Out of scope:** los planes viejos de `docs/superpowers/plans/` que citan el comando: son
  registro de lo que se ejecutó entonces y ya citaban formas obsoletas (`.git/` literal, sin
  guardar el diff). Los guards que usan `--name-only` no imprimen hashes.

## Tareas

- [x] Medir antes: con un cambio staged, `-c core.abbrev=8` y `=12` dan hashes distintos sin
      `--full-index` e iguales con él.
- [x] `.githooks/pre-commit`: veredicto, `hook.diff` y comando impreso con `--full-index`; pista
      en `info.txt` y en el aviso si `recibo.diff` trae líneas `index` abreviadas.
- [x] `.claude/skills/verify-feature/SKILL.md`: el comando del recibo con `--full-index`.
- [x] Prueba a mano del script (`sh .githooks/pre-commit; echo $?`): recibo sin `--full-index`
      → rechazo; con → pasa; recibo de otro diff → rechazo; hash igual con `core.abbrev` 8 y 12.
- [x] Entrada de `pendientes.md` → `resueltos.md`, con lo medido.
- [x] Gate completo de CLAUDE.md + `verify-feature`; commit en la rama del worktree, sin push.

## Verification

La integración con git (`core.hooksPath` absoluto al `.githooks` de `main`) no se puede probar
desde un worktree: se prueba el script a mano y la orquestadora comprueba en `main`, después del
merge, un commit real que pase por el hook con un recibo escrito con el comando nuevo.

## Decisions / Open questions

- Ninguna abierta: la causa está medida y el owner aprobó el arreglo.
