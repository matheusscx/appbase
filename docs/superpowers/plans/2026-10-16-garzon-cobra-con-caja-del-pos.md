# Plan: el garzón cobra la mesa con la caja abierta del local

**Status:** Implementado 2026-10-17 (ver «Respuestas del owner y qué se construyó»)
**Date:** 2026-10-16
**Owner:** owner (hallazgo 02.2 de la auditoría UX; decisión en `docs/agent/auditoria-ux/2026-10-16/decisiones.md`, fila 02.2)

Regla del owner: *"1 local con 1 caja y 2 garzones, el cajero abre la caja, el garzón debería poder cobrar, sería a la caja del POS; el garzón va, busca la máquina y cobra en la mesa."* Hoy no puede y es un error.

## Respuestas del owner y qué se construyó (2026-10-17)

Fuente: `docs/agent/auditoria-ux/2026-10-16/decisiones.md` § Segunda tanda. Las respuestas **reemplazan** las recomendadas de P1-P8 donde difieren:

- **Caja principal** (nueva, no estaba en el plan): `cajones.principal` (una por tenant, índice único parcial; la marca el admin en Configuración → Cajas). Un cobro de mesa entra en su sesión abierta.
- **P1/P2 (varias o ninguna abierta):** sin principal abierta, entra en otra caja abierta; con más de una **elige el garzón** (`cajaId` validado por el servidor); con ninguna no se cobra: «No hay ninguna caja abierta en el local. Avísale a la cajera.»
- **P8:** quien cobra y tiene caja propia **abierta** cobra en la suya (la principal es para quien no tiene). Una caja propia `en_conciliacion` no cuenta como abierta: cae en las reglas del local.
- **P3:** el efectivo cuenta en el esperado de esa caja y el arqueo lo detalla («de eso, $X los cobró Ana»).
- **P4/P5/P6/P7:** sin cambios (propina como hoy; quien cobró = `cuentas.garzon_cierre_id`, sin columna nueva; `Salones:Operar`, sin permiso nuevo; cerrar la caja con mesas abiertas no se bloquea, la mesa espera otra caja).
- **Tareas:** T1 `cajasParaCobroDeMesa`/`resolverCajaDeCobroDeMesa` + `cajaDestinoId` interno ✓; T2 `cerrarCuenta` + huella con `cajaId` ✓; T3 `GET /salones/caja-del-local` ✓; T4 desglose en el arqueo ✓ (**sin** «Cobró: …» en la boleta: la boleta es fiscal-adjacente y el owner pidió el detalle en el cierre/arqueo); T5 N/A (sin permiso nuevo); T6 frontend ✓ (selector fuera de `CobroModal`, en el panel de la cuenta); T7 docs ✓.
- **Consumidores revisados:** ver `docs/features/gestion-cajas.md` § «El garzón cobra con la caja del local».

---

## Context — lo medido hoy

**Cómo se cobra una mesa**
- `POST /cuentas/:id/cerrar` (`backend/src/modules/salones/salones.controller.ts:329-351`) exige solo `@RequiresPermiso('Salones','Operar')` y `Idempotency-Key`. El permiso **no** es el problema: el rol Salón del seed ya tiene `Salones:Leer` + `Operar` (`seeder.service.ts:5261-5300`).
- `SalonesService.cerrarCuenta` (`salones.service.ts:2695-2910`) arma un `CreateVentaDto` con `canal: 'fisico'` y llama `ventasService.crearEnTransaccion(manager, tenantId, usuarioId, …)`, con el `usuarioId` **del JWT** (`controller:346`).
- `crearEnTransaccion` (`ventas/ventas.service.ts:749-777`) resuelve la caja con `cajaService.findActiva(tenantId, usuarioId)` y, si no hay, lanza `400 "No tienes una caja abierta"`. Después toma `bloquearCajaAbierta` (lock pesimista) y exige `estado='abierta'`. **Ese es el único punto que bloquea al garzón.**
- `CajaService.findActiva` (`caja/caja.service.ts:384-396`) busca por `(tenantId, usuarioId, tipo='fisica', estado IN ('abierta','en_conciliacion'))`. La caja es **del usuario que la abrió**.
- Abrir caja exige `MiCaja:Crear` (`caja.controller.ts:286-287`); leer la propia exige `MiCaja:Leer` (`:133-134`). El garzón no tiene `MiCaja`, así que ni abre caja ni puede leerla.

**Dónde nace el aviso "abrir caja" (frontend)**
- `frontend/app/pages/salones/index.vue:944` `tieneCaja = cajaStore.activa !== null`; `cajaStore.cargarActiva()` pega a `GET /caja/activa` (`stores/caja.ts:264-276`), que da 403 al garzón y se traga con `.catch(() => null)` (`index.vue:1311`). Resultado: `tieneCaja=false` siempre.
- `UAlert "Sin caja abierta / Necesitas una caja física abierta para cobrar."` (`index.vue:3763-3770`) y el botón cobrar deshabilitado con `!tieneCaja` (`index.vue:3813`); `v-if="tieneCaja"` en `:3282`.
- Tras cobrar, `cajaStore.aplicarCobroLocal(neto, n)` (`index.vue:3260`) actualiza la proyección local de **la caja propia**: con la regla nueva no hay caja propia que actualizar.

**El modelo de cajas** (`docs/features/gestion-cajas.md`)
- Física: una abierta por `(tenant, usuario)` (`ux_cajas_activa_por_usuario`) y una por cajón (`ux_cajas_cajon_abierta`). Hay N cajones por tenant (tabla `cajones`, sin vínculo a ubicación). Virtual: una por tenant, siempre abierta, `usuario_id` NULL (online).
- `en_conciliacion` sigue "ocupando" al cajero (`findActiva` la devuelve) pero **no admite ventas** (`ventas.service.ts:761`).
- El esperado de efectivo se calcula **por `caja_id`**: `saldo_inicial + entradas efectivo − salidas` sobre `movimientos_caja` (`caja.service.ts:601-640`). No mira quién registró. Cualquier cobro en efectivo en esa caja sube el esperado del cajero, que responde por él al contar.
- **Autoría = dueño de la caja.** `ventas` y `pagos` no guardan quién los hizo (`ventas.service.ts:4369-4412`, `filtroDeMisCajas`; `pagos.service.ts:611`): "la caja *es* el registro de autoría". `movimientos_caja` tampoco tiene usuario. Si el garzón cobra en la caja del cajero, esa derivación **miente** para esas ventas (aparecen como del cajero).
- Lo que sí queda del cobrador: `cuentas.garzon_cierre_id` (`cuenta.entity.ts:125`, escrito en `salones.service.ts:2885`) y `cuentas.venta_id`. Es decir, quién cobró cada venta de mesa **ya está** y se une por `venta_id`, sin cambio de esquema.
- Visibilidad: el cajero ve esas ventas (son de su caja). El garzón no ve el listado de ventas (sin `Ventas`), pero `cerrarCuenta` arma la boleta con `verTodas:true` (`salones.service.ts:2886-2896`), así que su recibo sale bien. Reimprimir luego exige "caja propia abierta" (`ventas.service.ts:5476-5493`): el garzón no podría; queda para el encargado.
- Otros consumidores de `findActiva` que **no** se tocan en este frente: abono a deuda (`pagos.service.ts:508`), devolución de NC en efectivo (`ventas.service.ts:3401`), movimientos manuales (owner-only, `caja.service.ts:1653`). El garzón sigue sin poder usarlos.
- Single-local: el stock se descuenta de `ubicacionesService.localDe(tenantId)` (`ventas.service.ts:1503`); las cajas no tienen ubicación. **Multi-local no existe hoy**, así que no hay pregunta de "qué local".
- Identidad en tótem compartido: `resolverGarzonActuante` (`salones.service.ts:2717`) puede dar un garzón por PIN mientras el JWT es la cuenta del tótem. La caja a usar **no** puede salir del JWT del tótem; sale del tenant (token) y el que cobra queda en `garzon_cierre_id`.

---

## Scope / Out of scope

**Dentro:** que `POST /cuentas/:id/cerrar` cobre contra la caja física abierta del local cuando quien cobra no tiene una propia; que la pantalla de salones lo sepa y lo diga; que el arqueo del cajero pueda desglosar lo cobrado por garzones.
**Fuera:** abonos a deuda, devoluciones de NC en efectivo, movimientos manuales y reimpresión por parte del garzón; multi-local; tocar el motor de cálculo de precios o lo fiscal (el documento sale igual que hoy); cobros online; tocar JWT.

---

## Decisions / Open questions — para el owner (lenguaje de local)

Cada una con opciones; **la recomendada va primero**. Sin respuesta, el contrato de las tareas queda abierto donde se indica.

**P1. Hay dos cajas abiertas (dos cajeros, o barra y terraza). ¿En cuál cae lo que cobra el garzón?**
Escena: Marta abre la caja 1 a las 10; Pedro abre la caja 2 a las 12; Ana cobra la mesa 7 con $18.500 en efectivo.
- **A (recomendada). Si hay una sola abierta, esa; si hay más de una, Ana elige cuál al cobrar** (lista corta "Caja de Marta / Caja de Pedro"). Es lo que pasa en el local: la plata la deja en una mano concreta. Con una sola caja (el caso que describió el owner) no pregunta nada.
- B. La que se abrió primero, sin preguntar. Simple, pero puede caer en el cajón que Ana no tiene a mano y descuadrar a Pedro.
- C. Bloquear si hay más de una ("pedile a un encargado"). Seguro, pero frena el cobro en el turno más cargado.

**P2. No hay ninguna caja abierta. ¿Qué pasa?**
Escena: son las 9:50, el cajero aún no abrió; una mesa de desayuno quiere pagar.
- **A (recomendada). No se cobra; el aviso cambia a "No hay caja abierta en el local. Avisale al cajero".** Hoy dice "Necesitas una caja abierta" y el garzón no puede abrirla; el texto nuevo le dice qué hacer. El garzón **no abre** cajas.
- B. Cobrar a la caja virtual. Rompe el esperado (la virtual es del canal online y nunca se cuenta) y esconde efectivo: no recomendado.

**P3. El efectivo que cobra el garzón, ¿cuenta en lo que el cajero debe tener en el cajón?**
Escena: Ana cobra $18.500 en efectivo en la mesa y se lo entrega a Marta al volver.
- **A (recomendada). Sí: entra al esperado de la caja de Marta como cualquier cobro**, y el arqueo muestra "de eso, $18.500 los cobró Ana". Marta cuenta lo que hay en el cajón; si Ana aún no le entregó la plata, el descuadre es real y se ve de quién es.
- B. Entra a un "esperado de garzón" separado, que cada garzón rinde por su lado. Más fiel al efectivo en mano, pero es un concepto nuevo (rendición del garzón) y toca el cierre ciego: construirlo es otro frente.

**P4. La propina.**
Escena: cuenta de $18.500 + propina $1.850 con tarjeta; otra con propina en efectivo.
- **A (recomendada). Sin cambios: la propina sigue yendo al turno del garzón responsable** (como hoy, `propinaCierreMesa`) y el cobro, propina incluida, entra a la caja del local como cualquier pago. La propina en efectivo queda dentro del cajón hasta liquidarla (igual que hoy cuando cobra un cajero).
- B. Sacar la propina en efectivo del esperado. Cambia el motor de pagos: frente aparte.

**P5. ¿Quién figura como el que cobró?**
- **A (recomendada). El garzón queda en la cuenta (`garzon_cierre_id`, ya existe) y la caja sigue siendo la del cajero.** Se agrega a la boleta, al detalle de la caja y al arqueo el nombre "Cobró: Ana", usando ese dato (sin columna nueva). El cajero sigue siendo el responsable del cajón.
- B. Agregar `cobrado_por` a `ventas`/`pagos`/`movimientos_caja`. Auditoría más pareja (también servirá cuando el cajero de otros canales cobre en caja ajena), pero es migración + contrato y no hace falta para el caso de mesas. Se puede hacer después sin perder nada.

**P6. ¿Qué permiso habilita cobrar?**
- **A (recomendada). El mismo `Salones:Operar`**: quien puede atender una mesa puede cobrarla; es lo que el owner describió y no exige cambiar roles ya armados. El control sigue siendo el guard de la ruta.
- B. Un permiso nuevo `Salones:Cobrar`, para tenants donde algunos garzones solo toman pedidos y otro cobra. Más fino; hay que sembrar el permiso (siguiente id libre) y dárselo al rol Salón/encargado. Si el owner lo quiere, entra como tarea 5.

**P7. Si Marta cierra su caja con mesas abiertas, ¿qué pasa?**
Escena: Marta cierra a las 23:00 y Ana todavía tiene la mesa 3 abierta.
- **A (recomendada). La mesa no se puede cobrar hasta que haya otra caja abierta** (cae en P2). No se bloquea el cierre de Marta: hoy tampoco se bloquea por cuentas abiertas, y ese cambio es otra decisión.
- B. Avisarle a Marta al contar que hay N mesas abiertas. Mejora de aviso, fuera de este frente.

**P8. El cajero que también atiende mesas** (admin o cajero con `Salones:Operar` y caja propia).
- **A (recomendada). Si tiene caja propia abierta, cobra en la suya** (comportamiento de hoy, intacto); la caja del local solo se usa cuando no tiene una.
- B. Siempre la del local. Cambia lo que hoy anda y no lo pidió nadie.

**Multi-local (ubicaciones):** no aplica hoy; hay un solo local por tenant (`localDe`). Se deja escrito para cuando exista: ahí habrá que ligar caja/cajón a ubicación y la pregunta P1 se hace dentro del local.

---

## Backend

Diseño (a confirmar con P1-P3 y P8, **no fijar más hasta que el owner conteste**):

- `CajaService.cajasDelLocal(tenantId)`: las cajas `tipo='fisica'`, `estado='abierta'`, `eliminado_el IS NULL` del tenant, **una sola query**, con `JOIN usuarios` para el nombre del dueño y el nombre del cajón (sin N+1). `tenantId` del token.
- `crearEnTransaccion` hoy recibe `usuarioId` y busca la caja del usuario. Cambio mínimo: un parámetro interno opcional `cajaDestinoId` (canal interno, **no** campo del DTO ni del body) que `cerrarCuenta` resuelve y pasa; con él se salta `findActiva` y sigue el mismo `bloquearCajaAbierta` + `estado='abierta'`. Sin él, comportamiento idéntico al actual (el resto de callers no cambia).
- `cerrarCuenta`: resolver caja así (con P8-A): si el actuante tiene caja propia abierta, la propia; si no, `cajasDelLocal`: 0 → `400` con texto "No hay caja abierta en el local. Avisale al cajero."; 1 → esa; ≥2 → según P1 (A: el body trae `cajaId` opcional, validado contra `cajasDelLocal` del tenant; sin él y con ≥2, `400` que pide elegir). El `cajaId` del body se valida contra el tenant, nunca se confía.
- `GET /salones/caja-del-local` (nuevo, `Salones:Operar`): devuelve `{ cajas: [{ cajaId, cajero, cajon }] }` para que la pantalla sepa si puede cobrar y a cuál. No expone esperado ni saldos (el cierre ciego los retiene al cajero; menos aún al garzón).
- Idempotencia: la huella de `cuenta.cerrar` (`salones.service.ts:2740-2749`) suma `cajaId` elegido. Un reintento con otra caja es otra operación.
- Arqueo / detalle de caja (P3-A, P5-A): en `calcularArqueo`/detalle, una sola agregación `movimientos_caja → ventas → cuentas.venta_id → garzones` para "cobrado por garzones" por medio. Lectura, sin escritura nueva. Respeta el modo ciego (no revela el esperado a quien hoy no lo ve).

Tareas (checkboxes):

- [x] **T1 (backend, depende de P2/P8): `cajasDelLocal` + `cajaDestinoId` interno en `crearEnTransaccion`.** Contrato: sin `cajaDestinoId`, igual que hoy; con él, misma validación de estado y mismo lock. Tests unitarios del service (caja inexistente, en conciliación, de otro tenant) y e2e.
- [x] **T2 (backend, depende de P1): `cerrarCuenta` resuelve la caja** según P8/P1/P2, huella con `cajaId`. e2e en `backend/test/` (partir de un `salones-*.e2e-spec.ts` existente; garzón propio creado en el spec, **no** usar a Ana, memoria `e2e-garzon-del-seed-se-pisa`): (a) garzón sin caja propia y una caja abierta del cajero → cobra, `pagos.caja_id` = caja del cajero, esperado del cajero sube, `garzon_cierre_id` = garzón; (b) ninguna caja → 400 con el texto nuevo; (c) dos cajas sin `cajaId` → 400 / con `cajaId` ajeno al tenant → 404/400; (d) caja del local `en_conciliacion` → no se ofrece; (e) cajero con caja propia sigue cobrando en la suya; (f) reintento con la misma `Idempotency-Key` reproduce.
- [x] **T3 (backend): `GET /salones/caja-del-local`** con `@RequiresPermiso('Salones','Operar')`, `TenantGuard`, sin esperado. e2e de 403 con un usuario sin `Salones:Operar` y de aislamiento por tenant.
- [x] **T4 (backend, depende de P3/P5): desglose "cobrado por garzones" en el arqueo y la boleta ("Cobró: …").** Una query agregada; test que afirma sobre la forma del SQL con DB real, no mockeada (memoria `mock-de-db-no-ve-la-forma-del-sql`), y que el modo ciego no filtra el esperado.
- [x] **T5 (solo si P6-B): permiso `Salones:Cobrar`.** Sembrar `moduloAppPermiso` con el siguiente id libre, asignarlo al rol Salón y encargado; guard en `/cerrar`. Sin backfill (sin datos productivos).
- [x] **T6 (frontend, depende de T3):** en `pages/salones/index.vue` reemplazar `tieneCaja` por la respuesta de `caja-del-local` (o por la caja propia). Aviso nuevo: "No hay caja abierta en el local. Avisale al cajero para poder cobrar." Con ≥2 cajas y P1-A, selector de caja en el modal de cobro. No llamar `aplicarCobroLocal` cuando se cobró en caja ajena (la proyección local es de la caja propia). Antes de escribir: skills `nuxt-ui` y `frontend-design`; tokens semánticos; botones de 44 px. Specs unitarios del flujo y Playwright de salones con el rol real de garzón (memoria `probar-pantallas-con-el-rol-real`).
- [x] **T7 (docs, mismo commit que cada tarea):** `docs/features/gestion-cajas.md` (regla nueva y el "la caja es el registro de autoría" matizado para ventas de mesa), `docs/features/salones-mesas.md` (líneas 47 y 208: "requiere caja física abierta"), `docs/PRODUCTO.md`, `docs/ESTADO.md`, y `ventas.md` si cambia la lectura de autoría.

---

## Riesgos

- **Invariante 1 (tenant del token):** `cajasDelLocal` y la validación del `cajaId` del body usan solo `tenantId` del JWT; un `cajaId` ajeno se rechaza. **Invariante 6 (guards reales):** el permiso lo hace cumplir el guard de la ruta; la pantalla solo informa.
- **Invariante 2 (Decimal):** no hay aritmética nueva; el desglose de T4 suma en SQL/Decimal y sale como string.
- **Invariante 3 (soft delete):** todas las lecturas nuevas con `eliminado_el IS NULL`; la lectura de cajas, además, `estado='abierta'` (no `en_conciliacion`).
- **Auditoría:** el cambio rompe el supuesto "caja = autor" para ventas de mesa. Mitigado con `garzon_cierre_id` + desglose (P5-A); `filtroDeMisCajas` y los reportes por cajero pasan a contar esas ventas como del dueño de la caja. Hay que revisar los consumidores de esa derivación (`ventas.service.ts:4369+`, `pagos.service.ts:611+`, tendencia de descuadres por cajero) y decir cuáles cambian de lectura. Es la parte que más conviene que mire la revisión independiente.
- **Cuadratura del cajero:** si el garzón no entrega el efectivo, el descuadre cae al cajero (P3-A lo hace visible, no lo evita). El umbral de descuadre y el cierre ciego se aplican como siempre; la "tendencia de descuadres por cajero" podría penalizar al cajero por plata de un garzón: revisar si el desglose debe restarse ahí.
- **Concurrencia:** `bloquearCajaAbierta` serializa todos los cobros sobre una caja; con varios garzones cobrando en la misma caja la contención sube. El lock ya es corto y existe hoy; medir con 2 cobros simultáneos en el e2e.
- **N+1:** `cajasDelLocal` y el desglose van en una sola query cada una; nada por iteración. **Esperado que no cabe** (`assertEntradasCaben`) y su rastro (`{usuarioId, tipo:'cobro'}`) quedan atribuidos al garzón que intentó cobrar, no al dueño: está bien (es quien lo intentó), pero el mensaje debe decir de qué caja habla.
- **Cierres ya hechos:** no se reescribe nada. Las ventas de mesa anteriores están en cajas de quien las cobró y siguen cuadrando; no hay backfill (sin datos productivos). El `cajaId` nuevo solo afecta cobros futuros. Una caja cerrada o en conciliación nunca recibe cobros (lock + estado).
- **Fiscal / motor de precios:** no se tocan. El documento tributario sale como hoy; si el owner quiere que el garzón figure en el documento, eso abre un frente fiscal propio.
- **Tótem compartido:** la identidad de quien cobra es el garzón por PIN, no el JWT; la caja se resuelve por tenant y la elección explícita, nunca por el usuario del tótem.

## Verification

Checklist de cierre del repo (`CLAUDE.md`): `lint:check`, `typecheck`, `npm test` del back y front, `jest-e2e` de los specs relacionados (salones-*, ventas, caja, pagos), `npm run build`, `design:check`, y Playwright de las pantallas de salones con rol de garzón (el cobro de punta a punta: cajero abre → garzón cobra → cajero cuenta). Revisión independiente de `verify-feature` (toca services de backend y `.vue`). Smoke con login vía Playwright.
