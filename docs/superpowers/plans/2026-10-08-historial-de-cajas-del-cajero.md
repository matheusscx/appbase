# Plan: el cajero deja de ver su historial de cajas

- **Status**: Done
- **Date**: 2026-10-08
- **Owner**: decisión del owner del 2026-09-29 (opción A, selector de la orquestadora)

## Context

`pendientes.md` § 3, residuo 2 del frente del modo ciego. Hoy un cajero con `MiCaja:Leer` y sin
`Cajas:Leer` lista y abre todos sus turnos cerrados. El owner decidió que eso pasa a ser de
supervisión. El permiso de supervisión ya existe: `Cajas:Leer`.

Mapa medido:

| Ruta | Hoy, cajero | Después, cajero | Supervisor (`Cajas:Leer`) |
|---|---|---|---|
| `GET /caja` | 200, lo propio | **403** | 200, sin cambios |
| `GET /caja/:id` | 200 si es propia | 200 solo si es propia **y activa** | sin cambios |
| `GET /caja/:id/arqueo` | ídem | ídem | sin cambios |
| `GET /caja/:id/movimientos` | ídem | ídem | sin cambios |
| `GET /caja/:id/movimientos/resumen` | ídem | ídem | sin cambios |

"Activa" = `abierta` o `en_conciliacion`, el mismo conjunto que `findActiva`: sin la segunda el
cajero no termina la fase 2 de su propio cierre. Las rutas de supervisión (`tendencia`,
`pendientes-revision`, `resumen-descuadres-dia`, `intentos-rechazados`, `cajones-estado`,
`/:id/testigos`) ya piden `Cajas:Leer`.

## Scope / Out of scope

- Dentro: el 403 en el backend, ocultar en la pantalla lo que ya no se puede ver, y mover la
  revelación del cierre ciego del detalle al drawer.
- Fuera: las ventas y los pagos propios de turnos pasados (eje mío/todos, otra decisión);
  residuo 1 (el 400 "no pertenece al arqueo") pasa a Vigilancia sin código.

## Backend

- [x] `CajaController.historial`: sin `Cajas:Leer` → 403.
- [x] `verificarAccesoCaja`: sin `Cajas:Leer`, la caja propia tiene que estar activa; `findOne`
      pasa a usar el mismo chequeo (un solo lugar para las cuatro rutas de detalle).
- [x] Unit del service y del controller.
- [x] e2e por ruta: cajero 403 / supervisor 200; el cajero sigue operando su caja abierta y la
      conciliación propia.
- [x] Un mutante por guard (controller y `verificarAccesoCaja`).

## Frontend

- [x] `CajaCierreDrawer`: el cierre propio en modo ciego deja el resultado en el store y vuelve
      a `/mi-caja`, que lo muestra en una tarjeta (resumen + `CajaArqueoTable`) con *Listo*. No
      pudo ir dentro del drawer: su padre lo desmonta al cerrar (desvío aprobado por la
      orquestadora). Logout y cambio de tenant la limpian (`watch` de la sesión en el store).
- [x] "Ver historial" de `/mi-caja` y del header del turno, solo con `Cajas:Leer`.
- [x] `/mi-caja/historial` gateada con `Cajas:Leer`.
- [x] Specs de render + Playwright como `vendedor@paris.cl` y `supervisor@paris.cl`.

## Verification

Gate completo de `CLAUDE.md`, Playwright entero sobre base reseteada, `verify-feature` con su
recibo y `api-security-reviewer`.

## Decisions / Open questions

- Revelación: en una tarjeta de `/mi-caja`, no en el drawer (orquestadora, 2026-10-08).
- Residuo 1: el "de un solo uso" resultó falso (medido); queda en Vigilancia con la salida anotada.
- Tenant con `MiCaja` sin `Cajas`: nadie ve el historial; se anota en la doc.
