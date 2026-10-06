# Plan: Playwright — la sesión que cae a los 15 min y dos intermitentes

- **Status:** Done
- **Date:** 2026-10-06
- **Owner:** sesión "Playwright: el login a los 15 min y los dos intermitentes" (lanzada por la orquestadora)

## Context

Tres entradas de `docs/agent/pendientes.md` § 2, todas de infraestructura de test de Playwright:

1. *Playwright entero que dura más de 15 minutos cae al login a partir de ahí.*
2. *`e2e/salones/anular-plato.spec.ts:188` salió flaky en CI.*
3. *`e2e/configuracion/items-moneda.spec.ts:103` salió flaky en local.*

Lo leído antes de medir (no es diagnóstico todavía):

- La sesión del navegador sale **una sola vez** del `auth.setup.ts` y todos los specs cargan la misma
  foto (`e2e/.auth/paris.json`): un refresh token de un solo uso y la cookie `access_token`, que el
  store (`app/stores/auth.ts`) crea con `maxAge` de 15 min **del lado del cliente**, sea cual sea
  `JWT_EXPIRATION`. Pasados 15 min desde el setup la cookie ya no se carga y el middleware intenta
  `tryRefresh` con el refresh de la foto, que cualquier `tokenDe` (switch-tenant del mismo admin) ya
  revocó. Aunque nadie lo revocara, el primer test que lo canjee lo rota, y el siguiente que cargue
  la misma foto lo reusa fuera de la gracia de 30 s: también cae.
- `anular-plato` en CI (run 37465150509): el click colgado es el de **Anular** de la línea (spec
  :241-243), no un menú de reka-ui. El call log dice que lo intercepta el viewport de los toasts
  (`data-expanded="true"`), y la captura muestra dos toasts arriba a la derecha ("Error al enviar la
  comanda…" de QZ y "Cuenta abierta por…") encima de la columna de acciones.

## Scope / Out of scope

- **Scope:** soporte de Playwright (`frontend/e2e/`), docs de pendientes/resueltos.
- **Out of scope:** el sistema de tokens del backend (invariante 4), el `maxAge` de la cookie del
  store, la posición del toaster en la app.

## Frontend (tests)

- [x] **T1 — Medir la caída de los 15 min.** Stack propio con `JWT_EXPIRATION=2m`; Playwright
  entero; anotar en qué test y a qué minuto empieza el login, y qué dice el log del backend
  (401 de `refresh` sin fila = revocada; `Reuso de refresh token` = rotada y reusada).
- [x] **T2 — Sesión fresca por test.** Fixture que reemplaza el `storageState` por defecto con una
  sesión recién hecha por API (login + switch-tenant al restaurante), usando la foto del setup solo
  como plantilla de forma (atributos de cookie, `origins`). Que un spec que se olvide del fixture
  **falle fuerte** en vez de andar 15 min y caer.
- [x] **T3 — Prueba de T2:** Playwright entero con `JWT_EXPIRATION=2m`, sin caídas al login.
- [x] **T4 — `anular-plato`.** Reproducir determinísticamente el tapado (esperar el toast de QZ y
  clickear Anular); arreglar que el test espere a que el envío a cocina termine y no clickee a
  través de un toast. Loop con `--repeat-each`.
- [x] **T5 — `items-moneda`.** `--repeat-each` dentro de la suite y bajo carga de CPU emulada; buscar
  qué remonta o cierra la lista. Si no se reproduce en un loop razonable, anotar lo medido y mover a
  Vigilancia con el número de corridas.

## Verification

Gate completo de `CLAUDE.md` (Playwright entero incluido), corrida con `JWT_EXPIRATION=2m`, skill
`verify-feature` con su recibo. Suites pesadas y `stack` con turno de la orquestadora.

## Decisions / Open questions

- **T1, medido:** contra el código de antes, con `JWT_EXPIRATION=2m`, 44 de 107 rojos desde el test
  31 (minuto 2,1), todos los que usan la sesión del admin; 0 reusos en el log del backend → la
  revocación del `switch-tenant` de `tokenDe`.
- **Sesión por test y no por archivo:** el login + switch mide ~81 ms; la suite pasó de 313 s a
  327 s. Por archivo seguiría expuesto a la revocación de un `tokenDe` entre tests del mismo archivo.
- **Centinela en el config** en vez de cambiar el import de todos los specs: solo cambiaron los que
  usan la sesión del admin (18 + `sin-qz-tray`); el resto, si algún día la usa, falla con ENOENT.
- **T4:** la causa no era reka sino el viewport de toasts (y=212 contra el centro del botón en
  y=211) más el hover que los pausa. La parte de UX quedó como pregunta al owner en `pendientes.md` § 4.
- **T5:** 32 corridas sin un rojo (15 solo, 10 con CPU 6×, 7 dentro de la suite) → Vigilancia.
