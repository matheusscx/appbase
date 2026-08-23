# Plan: `ventas` y `pagos` dejan de mostrarle a cada cajero la facturación entera del local

**Status:** Done — 2026-08-22
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

⛔ **Lo que este frente resultó NO poder hacer** (descubierto al verificar, tarea 10): cerrar la
fuga contra la **caja propia**. El eje acota **de quién** ves, no **qué** — y el esperado de tu
propia caja se deriva de tu propia actividad. Ver la tarea 10.

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
- [x] **2. Extraer el resolvedor del eje — resuelto: vive en `RbacService`.** No hacía falta un
  helper nuevo ni un archivo nuevo: `RbacModule` es `@Global()` y `RbacService` ya se inyectaba
  en seis lugares, así que `resolverAlcanceCaja(usuarioId, tenantId)` es un método más de su
  casa natural —es una pregunta de RBAC—. `caja.controller` conserva
  `resolverLecturaCompartida` como el nombre local, delegando en una línea.
- [x] **3. `pagos`: el eje en `listar` y `resumen`.** Cuando NO tiene el eje completo, el SQL
  filtra por `JOIN cajas c ON c.caja_id = p.caja_id AND c.usuario_id = $yo`. Incluye las cajas
  **cerradas** del usuario, no solo la abierta.
  ⚠️ `resumen` (`montoHoy`) hoy no acepta ningún parámetro y agrega todo el tenant: con el eje
  puesto tiene que agregar solo lo del usuario.
  ⚠️ **No alcanza con filtrar `cajaId` del query**: cada fila devuelve `cajaId`, así que sin
  filtro real se agrupa del lado del cliente.
- [x] **4. `ventas`: el eje en `listar`, `findOne` y `resumen`.** Misma regla. La venta
  **online** (canal `'online'`, siempre contra la caja virtual) la ve cualquiera con
  `Ventas:Leer` — ver la spec para por qué eso no reabre la fuga.
  ⚠️ `findOne` devuelve `caja_id`, `monto` y `vuelto` por pago: es la fuga 3. Un cajero no debe
  poder pedir el detalle de una venta que no es suya.
- [x] **5. Unit specs de los tres services**, con el filtro fijado como cláusula (no un
  `toContain` que pase igual si el predicado se mueve de sitio). **Mutante por aserción**, que
  revierta al código anterior y falle.
- [x] **6. e2e que ejerza la fuga demostrada.** El caso exacto: cajero A cobra en efectivo en su
  caja; cajero B (o el mismo, con otra caja) NO puede verlo por `/pagos` ni por `/ventas/:id`;
  el supervisor con `Cajas:Leer` sí. **Este test es el que prueba que el frente sirvió.**
  ⚠️ **Desviación consciente:** la suite **sí** usa `vendedor@paris.cl`, que comparten 12 specs.
  El motivo: el caso que hay que ejercer es exactamente el del rol `Vendedor` del seed —`MiCaja`
  + `Ventas:Leer` + `Pagos:Leer` sin `Cajas`—, y montarlo con un usuario nuevo obliga a crear
  rol y asignar permisos dentro del e2e, que es más superficie de la que el test prueba.
  Mitigantes: `maxWorkers: 1` (nada corre en paralelo) y la suite libera la caja del vendedor en
  `beforeAll` **y** en `afterAll`. Riesgo asumido: el `afterAll` mueve estado compartido. Si
  aparece un flake acá, esta es la primera sospecha.
- [x] **7. Frontend.** `/pagos` y `/ventas` no declaran `permiso` en `definePageMeta` (solo
  `middleware: 'auth'`), así que el gate real ya es el backend y **no hay que esconder links**:
  verificar que las pantallas se comporten bien cuando la lista viene acotada, sin romper.
- [x] **8. Seed — SE DECIDIÓ NO HACERLO, y el porqué importa.** El plan lo pedía como defensa
  en profundidad. Pero **con el eje puesto, `Pagos:Leer` dejó de ser peligroso**: el cajero ve
  solo sus propios pagos, así que `/pagos` pasó a ser un ledger legítimo de "lo mío". Sacarle
  el permiso ahora le cuesta una pantalla útil a cambio de **cero** seguridad. La defensa en
  profundidad tenía sentido cuando el permiso implicaba ver todo el tenant; ya no lo implica.

## Verification

- [x] **9. Gate completo, ejecutado.** Backend `lint:check`, `typecheck` y `test` (2072) en
  verde; las cuatro del frontend también. E2E: **9 de 10** corridas completas en verde
  (`reset-db.sh` antes, `--verificar` después; ojo con el exit code, un `| tail` descarta el
  status). Las dos fallas residuales caen en suites que este diff no toca y **pasan solas**;
  el frente de suites que se pisan queda abierto en
  [`agent/pendientes.md`](../../agent/pendientes.md).
  📌 **En el camino se arreglaron dos defectos de este mismo spec**, los dos encontrados por la
  caza y no por el gate: la app quedaba **sin cerrar** cuando la limpieza tiraba (y su `@Cron`
  seguía disparando desde un entorno de Jest desmontado, contra otras suites), y la higiene de
  caja trataba como error el `400` de cerrar una caja que la **fase 1 ya había auto-cerrado**,
  abortando la limpieza del otro usuario.
- [x] **10. Reproducir a mano las dos fugas — HECHO, y el resultado corrige al plan.** La
  tarea daba por sentado que la fuga 1 dejaría de dar el número. **No es así, y no puede
  serlo:** se corrió el mismo script con el eje puesto y el cajero volvió a deducir el esperado
  exacto de **su propia** caja (20.357 contra 20.357). Sus pagos son suyos; los cobró él.
  Lo que sí cambió, medido en la misma corrida: el admin ve 87 pagos de 18 cajas y el cajero 3,
  de las 2 suyas — la fuga contra cajas **ajenas** está cerrada.
  🔴 **Conclusión del frente:** el eje cierra la dimensión **cruzada**, no la propia. El modo
  ciego no es sostenible como *"el cajero no puede saber el esperado"*; contra la cuenta propia
  es fricción, no barrera. Escribir eso en la doc del ciego quedó pendiente.
- [x] **11. Revisión independiente** (`domain-reviewer`) sobre el diff staged. **Nunca
  `--no-verify`.**

## Documentación (mismo commit)

- [x] **12.** `docs/features/` de ventas y pagos: el eje nuevo y la regla de la venta online.
- [x] **13.** `docs/ESTADO.md`; actualizar la entrada de fugas en
  [`pendientes.md`](../../agent/pendientes.md) tachando 1, 3 y 4 y dejando vivos los oráculos.
- [x] **14.** Si el eje reusado (`Cajas:Leer` decide también ventas y pagos) es una convención
  nueva, va a `docs/patterns/backend.md`.

## Decisions / Open questions

**Decidido (owner, 2026-08-22):** el eje va; los oráculos se resuelven con rastro aparte.

**Decidido (diseño, ver spec):** "lo mío" se deriva por la caja y **no** se agrega columna
`creado_por`; el eje **reusa** `Cajas:Leer` en vez de crear módulos `MisVentas`/`MisPagos`; la
venta online la ve cualquiera con `Ventas:Leer`.

**Abierto, no bloqueante:** qué hacer con ventas/pagos de `caja_id` NULL, si es que existen
(tarea 1). Y el costo aceptado: un tenant no va a poder tener a alguien que supervise ventas
sin supervisar caja.
