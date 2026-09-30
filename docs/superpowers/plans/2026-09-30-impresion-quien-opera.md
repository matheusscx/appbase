# Plan: imprimir sin leer la configuración, con techo al conectar, y la cajera reimprime lo suyo

> **Para agentes:** se ejecuta con `superpowers:subagent-driven-development`, tarea por tarea. Los pasos
> usan checkboxes (`- [ ]`). El implementador **no commitea**: stagea por ruta; revisión, recibo y
> commit los hace la orquestadora.

- **Status:** Done
- **Date:** 2026-09-30
- **Owner:** César (owner) · redacta la orquestadora, en el worktree `impresion` (rama `impresion`)

**Goal:** Que quien opera (cajera del POS, garzón y encargado de salón) pueda imprimir comanda,
precuenta y boleta sin el permiso de configuración de impresoras; que conectar con QZ Tray tenga el
mismo techo de 5 s que imprimir, sin dejar la conexión colgada; y que la cajera pueda reimprimir la
boleta de las ventas de su propia caja abierta.

**Decisiones del owner (y cómo se tomaron):** están escritas en `docs/agent/pendientes.md` § 3, en
*"Enviar a cocina exige `Impresoras:Leer`"* y *"Conectar con QZ Tray tiene el mismo techo que
imprimir"*. No se repiten acá.

## Global Constraints

- `tenant_id` siempre del token. Toda lectura nueva filtra `eliminado_el IS NULL`.
- Permisos con enforcement en el backend: un botón escondido en la pantalla nunca reemplaza al guard.
- **Sin reintento automático** (regla del owner): si no imprime, se avisa y la persona reimprime.
- **No se toca:** el motor de precios, lo fiscal (el contenido de la boleta), `movimientos_inventario`.
  Si una tarea parece exigirlo, **parar y preguntar**.
- Suites pesadas, de a una: e2e con el script de turno de la orquestadora.

## Tarea 1 — Backend: la impresora para imprimir, sin leer la configuración

- [x] Un endpoint de lectura mínima que devuelve las impresoras activas de un rol (`comanda` o `boleta`)
  con solo los campos que usa el camino de impresión (`id`, `tipoConexion`, `host`, `puerto`,
  `nombreCola`, `activo`). El `GET /impresoras` de configuración no cambia.
- [x] Guard: lo alcanza quien puede llegar a alguno de los caminos que imprimen. **Antes de elegir el
  guard, listar el permiso de cada camino** (boleta del POS, comanda, precuenta, cobro de salón,
  reimpresión) leyendo sus endpoints, y escribir la tabla en el reporte. `RequiresAlgunPermiso`
  advierte en su docblock que no es un OR genérico: si se usa, el porqué va escrito al lado.
- [x] e2e: cada rol del seed que opera (vendedor, garzón, encargado de salón) obtiene 200 y los campos
  justos; un rol sin ninguno de esos permisos obtiene 403; filas de otro tenant y borradas no vienen.

## Tarea 2 — Backend: la cajera reimprime las ventas de su caja abierta

- [x] `GET /ventas/:id/boleta`: quien tiene `Ventas:Anular` sigue igual (con el alcance por caja de
  hoy). Quien no lo tiene puede reimprimir **solo** si la venta es de su propia caja y esa caja está
  abierta; si no, 403 con un mensaje que diga que la reimprime el encargado.
- [x] e2e: la cajera reimprime una venta de su caja abierta (200); una de otra caja (403); una de su
  caja ya cerrada (403); el encargado reimprime cualquiera dentro de su alcance, como hoy.
- [x] Docs: `docs/PRODUCTO.md` (la regla de quién reimprime; hoy dice que alcanza `Ventas:Leer`, y
  `docs/features/dashboard-inicio.md:133` también), y una nota en la spec
  `2026-09-17-boleta-desde-la-venta-design.md` § 2 de que el owner la reabrió el 2026-09-30.

## Tarea 3 — Frontend: imprimir con el endpoint nuevo, techo al conectar y el aviso

- [x] `useImpresoras.ts`: los tres caminos leen la impresora del endpoint de la tarea 1.
- [x] `imprimirEn`: `connect()` con el mismo techo que `qz.print`. Si vence, **soltar la conexión
  colgada** (medido: si no, el siguiente intento falla al instante con un error en inglés de
  qz-tray). Todo mensaje de error que vea la persona, en castellano.
- [x] Boleta que no imprime al cobrar (POS y cobro de salón): la venta queda cobrada, la pantalla se
  limpia, y el aviso dice que no se pudo imprimir y que se reimprime desde la venta.
- [x] `VentaDetalleDrawer.vue`: el botón "Reimprimir boleta" aparece para quien tiene `Ventas:Anular`
  y para la cajera en las ventas de su propia caja abierta (gemelo exacto de la regla de la tarea 2).
- [x] vitest: `qz-tray` mockeado, `connect` que nunca resuelve y timers falsos. Rojo sin el techo; y
  un segundo intento después del vencimiento que vuelve a intentar conectar en vez de fallar al
  instante.

## Tarea 4 — Seed y tests de navegador

- [x] El rol sembrado del garzón (`Salón`) recibe `Items:Leer` (decisión del owner, 2026-09-30).
- [x] `frontend/e2e/salones/anular-plato.spec.ts` corre como el encargado de salón, y su docblock
  deja de explicar por qué corría como admin.
- [x] Playwright: *Enviar a cocina* como garzón (no admin) llama a `reclamar`; la cajera reimprime una
  venta de su caja.
- [x] Gate completo + Playwright entero en el stack del worktree, antes de integrar.

## Cierre

- [x] `docs/features/impresion-termica.md` y `docs/ESTADO.md`.
- [x] Las dos entradas de `pendientes.md` § 3 se mudan a `resueltos.md` con lo que las fija.
