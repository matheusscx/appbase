# Plan: `.dockerignore` para que la imagen no hornee los `node_modules` del host

- **Status:** Done
- **Date:** 2026-10-08
- **Owner:** sesión "Entorno" (lanzada por la orquestadora)

## Context

Entrada de `docs/agent/pendientes.md` § 1: `backend/` y `frontend/` no tienen `.dockerignore`, así
que el `COPY . .` de los Dockerfiles copia los `node_modules` del host (macOS) encima de los que
instaló `RUN npm ci` en la imagen. El volumen anónimo `/app/node_modules` del compose se puebla
desde esa imagen rota → restart loop.

## Scope / Out of scope

- Dentro: `.dockerignore` en `backend/` y `frontend/`; doc del flujo de entornos si cambia algo;
  chequeo automático si es chico y sigue un patrón existente.
- Fuera: `backend.Dockerfile`/`frontend.Dockerfile` de la raíz (nadie los referencia), el
  `npm install` del `frontend/Dockerfile`, el volumen anónimo de un stack ya roto.

## Tareas

- [x] Repro A (paralelo): `npm ci` en back y front del host mientras corre el primer
      `entorno.sh stack`. Anotar RestartCount y logs.
- [x] Repro B (secuencial, no medido en la entrada): `npm ci` terminado, `borrar --purgar`, después
      `entorno.sh stack`.
- [x] `.dockerignore` en los dos paquetes. Criterio: excluir lo que ni el `Dockerfile` (dev) ni el
      `Dockerfile.prod` (Railway, `railway.json` → `dockerfilePath: Dockerfile.prod`, contexto =
      carpeta del paquete) leen. El dev monta `./backend:/app` y `./frontend:/app` encima de la
      imagen, así que en dev solo importa lo que puebla `/app/node_modules`.
- [x] Verificar A y B con el arreglo: backend RC 0 con `Seed complete`. El frontend da RC 1 en el
      primer `up` también sin el arreglo: es previo, va a `pendientes.md` § 2.
- [x] Build de los dos `Dockerfile.prod` con el arreglo (lo que hace Railway).
- [x] Chequeo automático si cabe en `check-aislamiento.mjs`.
- [x] Gate completo + Playwright entero + verify-feature; mover la entrada a `resueltos.md`.

## Verification

`docker inspect -f '{{.RestartCount}}'` de `wt-<slug>_backend` en 0 con `Seed complete` en el log, en
los dos órdenes; el frontend, sin restart loop (su RC 1 del primer `up` es previo: `pendientes.md` § 2).
`docker build -f Dockerfile.prod` de los dos paquetes en verde.

## Decisions / Open questions

- Turnos de Docker: los da la orquestadora.
- El RC 1 del frontend en el primer `up` no es de este frente (orquestadora, 2026-10-08, tras medir
  2 `up` con el arreglo y 2 sin).
