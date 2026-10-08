# Plan: el plano saca la mesa que otro admin borró al guardar la distribución

**Status**: Done
**Date**: 2026-10-08
**Owner**: orquestadora (encargo y dudas técnicas)

## Context

`docs/agent/pendientes.md` § 2, "El plano sigue dibujando una mesa que otro admin borró, hasta
recargar". Desde 2fa71b75 `PATCH /salones/:salonId/layout` saltea la mesa borrada y responde
vacío; `guardarDistribucion` (`pages/configuracion/salones.vue`) repone todas las de
`localMesas` como vivas.

**Medido en navegador** (Playwright, dos sesiones del admin, 2026-10-08): la sesión 2 borra
una mesa; la sesión 1 arrastra otra y suelta. El `PATCH` sale con las dos, responde 200 con
body vacío, la sesión 1 muestra "Distribución guardada" y sigue dibujando la borrada.
Arrastrar la borrada también da 200 y "Distribución guardada", sin escribir nada.

## Diseño (aprobado por la orquestadora, 2026-10-08)

Patrón de `docs/patterns/frontend.md` §5 (update → patch mergeable con `RETURNING`):

- El `PATCH` devuelve las mesas que **escribió**: `[{ id, posX, posY }]`, vía `RETURNING`.
- La pantalla saca del plano las que mandó y no volvieron, y avisa con un toast cuál.
- **No** repinta posiciones desde la respuesta: la local puede ser más nueva (el guardado no se
  serializa; un arrastre posterior puede estar en vuelo) y la mesa saltaría para atrás.
- **No** agrega mesas que otro admin creó: no es este bug, y sin polling sería medio arreglo.
- Sacar es monótono: una respuesta que llega fuera de orden no puede revivir nada.

## Backend

- [x] `guardarLayout` escribe con `UPDATE … RETURNING` y devuelve lo escrito.
- [x] e2e (`salones-entrada.e2e-spec.ts`): el 200 devuelve solo la viva, con id en minúsculas
  aunque se mande en mayúsculas. Mutante: volver a `Promise<void>`.

## Frontend

- [x] `guardarLayout` tipado con la respuesta; `guardarDistribucion` saca las que no volvieron
  y avisa.
- [x] Spec de página: la que no vuelve sale del plano y hay aviso; dos respuestas fuera de
  orden no reviven la sacada; la posición local no se pisa con la de la respuesta.
- [x] Playwright de las dos sesiones (`e2e/salones/plano-mesa-borrada.spec.ts`). Mutante:
  volver a reponer `localMesas` entero.

## Cierre

- [x] Doc de la feature, entrada a `resueltos.md`, pendiente nuevo del `.dockerignore`
  (pedido de la orquestadora).
- [x] Gate completo, Playwright entero, `verify-feature` con recibo.
