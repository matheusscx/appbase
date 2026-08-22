# Plan: `ventas` y `pagos` dejan de mostrarle a cada cajero la facturación entera del local

**Status:** Draft
**Date:** 2026-08-22
**Owner:** Cesar Matheus

## Context

Auditoría de fugas del modo ciego (2026-08-22). El hallazgo que reencuadró el frente **no es
del modo ciego**: `ventas` y `pagos` no tienen **ningún** eje de visibilidad por usuario —
`listar(tenantId, query)`, `findOne(tenantId, ventaId)` y `resumen(tenantId)` no reciben
`usuarioId` ni lo consultan. Un cajero con `Ventas:Leer` ve **todas** las ventas del tenant;
con `Pagos:Leer`, **todos** los pagos.

El modo ciego solo lo hizo visible: **demostrado contra el stack real**, con el ciego activo el
cajero pidió `GET /pagos?cajaId=<la suya>&metodoPagoId=<efectivo>`, sumó, y dedujo **25.355**
cuando el esperado real era **25.355** — en un request, con la API devolviéndole
`esperado: null` por el otro camino.

**Decisión del owner (2026-08-22):** darles el eje "mío/todos", igual que `caja`.

Diseño y el porqué de cada decisión:
[`specs/2026-08-22-visibilidad-ventas-pagos-design.md`](../specs/2026-08-22-visibilidad-ventas-pagos-design.md).

⛔ **Este frente NO cierra los dos oráculos** (el 422 de retiro y el de la NC). Esos van por
rastro, no por ocultamiento, y son un frente aparte. Si una tarea de acá parece tocarlos,
parar y reportar.

## Scope / Out of scope

**In scope:** el eje "mío/todos" en `ventas` y `pagos` (listados, detalle y resumen), reusando
`resolverLecturaCompartida`; el ajuste del rol `Vendedor` del seed si sobra un permiso; docs.

**Out of scope:** los oráculos; el predicado del modo ciego; bloquear el historial de cajas del
cajero; agregar una columna `creado_por` (la spec explica por qué no).

## Tareas

- [x] **1. Medir antes de escribir — HECHO el 2026-08-22.** Los dos datos, medidos:
  - **No existen ventas ni pagos sin caja.** Las dos columnas son `nullable`, pero **ningún
    camino del código las deja en NULL**: `ventas.service.ts` resuelve la caja por canal y
    lanza `400` si no hay (física con `findActiva`, virtual con `findVirtual`), y las tres
    creaciones de `Pago` viven **solo** en `pagos.service.ts`, las tres con un `cajaId`
    resuelto (el parámetro del método compartido está tipado `cajaId: string`, sin `| null`).
    La pasarela no crea `Pago` por su cuenta.
    ⚠️ **Aun así el filtro tiene que ser explícito con el NULL**, porque la columna lo permite
    y un camino futuro podría introducirlo: una fila sin caja **no es de nadie**, así que no
    debe caer en "lo mío" por omisión.
  - **El único consumidor de `Pagos:Leer` en el frontend es la pantalla `/pagos`.** El POS solo
    llama `items`, `metodos-pago`, `tipos-documento` y `POST /ventas`; el `AbonoModal` (que usa
    el detalle de venta) hace `POST /pagos`, o sea `Pagos:Crear`. Sacarle `Pagos:Leer` al rol
    `Vendedor` le cuesta exactamente esa pantalla y nada más.
- [ ] **2. Extraer el resolvedor del eje.** `resolverLecturaCompartida` vive hoy privado en
  `caja.controller.ts`. Lo van a usar tres controllers. **Decidir al implementar** si se mueve
  a un helper compartido o se inyecta el `RbacService` en cada uno — seguir lo que el proyecto
  ya haga con lógica compartida entre controllers, no inventar.
- [ ] **3. `pagos`: el eje en `listar` y `resumen`.** Cuando NO tiene el eje completo, el SQL
  filtra por `JOIN cajas c ON c.caja_id = p.caja_id AND c.usuario_id = $yo`. Incluye las cajas
  **cerradas** del usuario, no solo la abierta.
  ⚠️ `resumen` (`montoHoy`) hoy no acepta ningún parámetro y agrega todo el tenant: con el eje
  puesto tiene que agregar solo lo del usuario.
  ⚠️ **No alcanza con filtrar `cajaId` del query**: cada fila devuelve `cajaId`, así que sin
  filtro real se agrupa del lado del cliente.
- [ ] **4. `ventas`: el eje en `listar`, `findOne` y `resumen`.** Misma regla. La venta
  **online** (canal `'online'`, siempre contra la caja virtual) la ve cualquiera con
  `Ventas:Leer` — ver la spec para por qué eso no reabre la fuga.
  ⚠️ `findOne` devuelve `caja_id`, `monto` y `vuelto` por pago: es la fuga 3. Un cajero no debe
  poder pedir el detalle de una venta que no es suya.
- [ ] **5. Unit specs de los tres services**, con el filtro fijado como cláusula (no un
  `toContain` que pase igual si el predicado se mueve de sitio). **Mutante por aserción**, que
  revierta al código anterior y falle.
- [ ] **6. e2e que ejerza la fuga demostrada.** El caso exacto: cajero A cobra en efectivo en su
  caja; cajero B (o el mismo, con otra caja) NO puede verlo por `/pagos` ni por `/ventas/:id`;
  el supervisor con `Cajas:Leer` sí. **Este test es el que prueba que el frente sirvió.**
  ⚠️ Crear usuarios propios: no reusar al vendedor del seed, que seis specs comparten.
- [ ] **7. Frontend.** `/pagos` y `/ventas` no declaran `permiso` en `definePageMeta` (solo
  `middleware: 'auth'`), así que el gate real ya es el backend y **no hay que esconder links**:
  verificar que las pantallas se comporten bien cuando la lista viene acotada, sin romper.
- [ ] **8. Seed.** Si la tarea 1 confirma que el cajero no necesita `Pagos:Leer`, sacarlo del
  rol `Vendedor` — es defensa en profundidad, no el arreglo (el arreglo es el eje).

## Verification

- [ ] **9. Gate completo, ejecutado y en verde** (`reset-db.sh` antes del e2e, `--verificar`
  después; ojo con el exit code: un `| tail` descarta el status).
- [ ] **10. Reproducir a mano las dos fugas demostradas** y ver que la 1 ya no da el número.
  El script vive en el scratchpad de la sesión del 2026-08-22; si no está, se rehace: es
  login cajero → abrir caja → venta en efectivo → `GET /pagos?cajaId=…&metodoPagoId=…`.
- [ ] **11. Revisión independiente** (`domain-reviewer`) sobre el diff staged. **Nunca
  `--no-verify`.**

## Documentación (mismo commit)

- [ ] **12.** `docs/features/` de ventas y pagos: el eje nuevo y la regla de la venta online.
- [ ] **13.** `docs/ESTADO.md`; actualizar la entrada de fugas en
  [`pendientes.md`](../../agent/pendientes.md) tachando 1, 3 y 4 y dejando vivos los oráculos.
- [ ] **14.** Si el eje reusado (`Cajas:Leer` decide también ventas y pagos) es una convención
  nueva, va a `docs/patterns/backend.md`.

## Decisions / Open questions

**Decidido (owner, 2026-08-22):** el eje va; los oráculos se resuelven con rastro aparte.

**Decidido (diseño, ver spec):** "lo mío" se deriva por la caja y **no** se agrega columna
`creado_por`; el eje **reusa** `Cajas:Leer` en vez de crear módulos `MisVentas`/`MisPagos`; la
venta online la ve cualquiera con `Ventas:Leer`.

**Abierto, no bloqueante:** qué hacer con ventas/pagos de `caja_id` NULL, si es que existen
(tarea 1). Y el costo aceptado: un tenant no va a poder tener a alguien que supervise ventas
sin supervisar caja.
