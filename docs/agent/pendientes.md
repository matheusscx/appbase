# Pendientes — a corregir al terminar el harness

Backlog de correcciones que se **difirieron a propósito** mientras trabajamos en el
harness, para no mezclar el meta-trabajo (reglas, gates, docs) con cambios de código de
producto. Cada entrada dice qué, dónde, por qué se difirió y cómo se cierra.

Regla de este archivo: una entrada sale cuando se corrige (marcar `[x]` y, en el commit
que la cierra, borrarla o moverla a un changelog). No es un TODO genérico: solo va lo que
ya identificamos con ubicación concreta.

---

## Deuda de código (surgió durante el harness)

- [ ] **Component tests del gateo de permisos — medido y viable, falta decidir si se adopta**
  (frontend) — el bug de jul-2026 que dejó al rol aprobador sin el botón "Aplicar" fue de
  **anidamiento en el template**: los computeds eran correctos por separado, así que
  ningún unit test de la lógica lo habría visto. Solo lo caza algo que renderice.
  **Medido con un spike, no estimado:**
  - El entorno se activa **por archivo** con el docblock `// @vitest-environment nuxt` —
    cero cambios de config y cero riesgo para los 275 tests existentes (mi afirmación
    previa de que "toca los 275" era falsa).
  - **Caza el bug real**: monté `recuentos/[id].vue` como el rol aprobador; con el bug
    reintroducido el test **falla**, con el código arreglado **pasa**. Verificado en las
    dos direcciones.
  - Costo de correr: 275 tests en 2,98s → 277 (2 archivos nuxt) en 6,23s, ~1,5s por
    archivo. Costo de escribir: ~30 líneas de andamiaje y 3 iteraciones.
  - **Trampa que va a volver a morder:** Nuxt instala su propia instancia de Pinia, así
    que espiar un store creado con `setActivePinia` no funciona — hay que mockear el
    auto-import con `mockNuxtImport('usePermissionsStore', …)`.
  Contras reales: los mocks se desincronizan del contrato (prueba el render, no la
  respuesta real) y las aserciones por texto se rompen con el copy. **Decisión abierta:**
  adoptarlo acotado a las pantallas que gatean escrituras por permiso (4 hoy, 23 al
  cerrar el barrido de abajo), o esperar a cerrar ese barrido y hacerlo de una. No sirve
  como política general de "testear componentes".
- [ ] **Barrido de botones de escritura sin gatear por permiso (19 pantallas)**
  (frontend) — un control de escritura que se renderiza sin el permiso que exige su
  endpoint deja al usuario llenar el formulario para recibir un 403. No es hueco de
  seguridad (el backend enforcea), es un callejón sin salida de UX. La convención está
  en `docs/patterns/frontend.md` §1.1; ya se aplicó a inventario, recuentos y
  `mermas.vue` (jul-2026). Falta el resto, en dos grupos:
  - **16 de `configuracion/*`** (`categorias`, `causas-merma`, `descuentos`, `empresa`,
    `grupos-modificadores`, `impuestos`, `items`, `metodos-pago`, `monedas`,
    `motivos-diferencia-inventario`, `motivos-diferencia`, `preferencias-financieras`,
    `razones-sociales`, `recargos`, `roles/index`, `usuarios/index`) — sus escrituras
    van con `TenantAdminGuard` y la lectura es abierta, así que un usuario no-admin
    carga la lista y ve botones que siempre fallan. El gate es uniforme:
    `permissionsStore.esAdmin`.
  - **3 con permiso de módulo** (`ventas/pos.vue` → `Ventas/Crear`, `terceros.vue`,
    `recetas-desfases.vue`) — cada una con el permiso de su endpoint, no un
    `esAdmin` genérico.
  Se difiere porque son 19 archivos: merece su propia pasada con verificación, no
  colgarse de un fix de inventario.
- [ ] **`LineaVentaDto.precioUnitario` — ¿debe permitir `0`? (parcialmente cerrado)**
  (backend, `ventas/dto/create-venta.dto.ts`) — el rechazo de negativos ya se cerró
  (jul-2026): tiene `@IsDecimalNoNegativo()`, que además permite `0`. Lo que sigue
  abierto es si el `0` debería seguir siendo válido o si el owner quiere prohibirlo
  también (podría representar un ítem promocional/gratis, o podría ser una laguna para
  vaciar el `totalFinal` de una línea sin tocar el resto). Decidir `>= 0` (estado
  actual) vs `> 0` (`IsDecimalPositivo`) es una regla de negocio del owner, no algo a
  inferir. Requiere confirmación antes de endurecer más.
- [x] **Burndown de typecheck del frontend — COMPLETO (0 errores)** (frontend) — jul-2026
  Los 84 errores de vue-tsc estricto se quemaron por tandas. `typecheck-baseline.json`
  quedó vacío: el `typecheck:ratchet` ahora es un gate totalmente estricto (cualquier
  error nuevo bloquea CI). Todos los patrones y sus fixes solo-de-tipo quedaron en
  `anti-patterns.md` (`@click`→arrow inline; spread/índice guardado→`!`; `string|null`→prop
  con `?? undefined`/tipar form; mismatches Nuxt UI·reka; tipado de unit tests vitest).
- [ ] **Cinco suites e2e dejan la caja abierta al terminar** (backend, `test/combos`,
  `liquidacion-propinas`, `grupos-modificadores`, `grupos-modificadores-overrides` y
  `recetas.e2e-spec.ts`) — el cierre de caja es en **dos fases** (`POST /:id/conteo`
  congela el arqueo y auto-cierra si cuadra; si descuadra pasa a `en_conciliacion` y hay
  que resolver con `POST /:id/cerrar`). Las cinco llaman solo a la segunda **e ignoran el
  status**, así que no cierran nada y el cajón queda ocupado. Hoy la suite pasa porque
  sobran cajones, no porque esté bien: al agregar tests cambia el orden en que jest
  ordena las suites y la fuga aparece como un `409` críptico en `caja.e2e-spec.ts`, a
  varios archivos de distancia de la causa. Ya pasó (jul-2026) y costó media hora
  diagnosticarlo. `ventas.e2e-spec.ts` ya está corregido (commit `c8e3abe`): copiar ese
  helper `cerrarCaja`, que además **asevera** el cierre en vez de tragarse el error.
  El patrón bueno de referencia es `cerrarEnDosFases` en `caja.e2e-spec.ts:105`.

---

## Harness / tooling (CodeGraph)

- [x] **Sync de CodeGraph en un git hook + niveles de búsqueda — HECHO** (harness) — jul-2026
  `.githooks/pre-push` corre `codegraph sync --quiet` (red de seguridad no-bloqueante:
  nunca frena el push, no-op si CodeGraph ausente; nunca `index`). Validado empíricamente:
  el daemon estaba caído y el índice tenía 44 archivos viejos; el sync los reconcilió en
  <1s. Niveles de búsqueda (`--max-files`: rápido=default / normal=3-5 / profundo=10+)
  documentados en el "Orden de búsqueda" de `CLAUDE.md`.

---

## Suite E2E de navegador (fundación lista, flujos por escribir)

Scaffold Playwright ya funciona (`frontend/e2e/`, auth vía storageState, 1 smoke verde).
Escribir los flujos críticos, cada uno con aserciones derivadas de `docs/features/`
(NUNCA del output del código), `@smoke` en el subconjunto barato, cero esperas fijas:

- [ ] Venta completa hasta documento (afecto + exento; total contra `docs/features/ventas.md`).
- [ ] Pago mixto (múltiples métodos; vuelto solo si `permite_vuelto`).
- [ ] Nota de crédito (referencia a la venta original).
- [ ] Apertura/cierre de caja (reloj congelado; `diferencia` calculada por el sistema).
- [ ] Descuento de stock en una venta (movimiento + saldo materializado).
- [ ] **Cambio de tenant sin fuga de datos** (el más valioso — ninguna prueba unitaria
  lo cubre; login como usuario multi-tenant, verificar aislamiento de catálogo/ventas).
- [ ] Integrar `@smoke` al CI cuando haya masa crítica (hoy el CI no levanta el stack
  de navegador).

## Propinas en POS (notas de la revisión final, severidad baja — no bloqueantes)

- [ ] **`propinaDirecta`/`propinaCierreMesa` no se restringen al canal `fisico`**
  (backend) — `ventas.service.ts` solo gatea la propina con `habilitadoPos`/
  `habilitadoSalones`, no con `canal`; una venta `online` podría en teoría enviar
  `propinaDirecta`/`propinaCierreMesa`. El signo ya no es el problema (barrido de
  positividad jul-2026, ambos DTOs ahora exigen `>= 0` vía `IsDecimalNoNegativo` —
  ver `backend/src/common/decorators/decimal-signo.decorator.ts`): queda solo la
  restricción de canal, sin regresión respecto al comportamiento previo.

## Auditoría `ventas` + `pagos` (2026-07-27) — hallazgos confirmados

Pasada de 7 lentes según `docs/agent/auditoria-codigo.md`. 20 hallazgos crudos → 15
confirmados tras refutación (3 eran el mismo bug visto por lentes distintas, 3 pasaron a
decisión de owner, abajo). **Ninguno se corrigió en la pasada**: la auditoría produce
información, no diffs. Orden = severidad.

- [x] ~~**El vuelto se asigna íntegro a un pago sin acotarlo a su propio monto**~~ —
  cerrado 2026-07-27: el excedente se reparte entre los pagos con `permite_vuelto`,
  acotado al monto de cada uno y en orden determinista por `metodoPagoId`; si supera lo
  devolvible (es decir, si los métodos sin vuelto superan el target) se rechaza con 400.
  Se acabaron los movimientos de caja `entrada` con monto negativo. Era el hallazgo que
  detectaron 3 lentes independientes.
- [x] ~~**`registrarAbono` calcula el saldo con la suma bruta de pagos**~~ — cerrado
  2026-07-27: `registrarAbono` lee `pago_aplicaciones` con `tipo='venta'`, igual que
  `listar()`/`resumen()`. La fórmula documentada en `docs/features/ventas.md` y
  `pagos.md` también se corrigió (estaba escrita antes de las propinas). Cubierto por
  e2e, no por unit: el mock del unit devuelve la fila igual con cualquier query.
- [x] ~~**`metodoPagoId` se persiste sin validar que esté habilitado para el tenant**~~
  — cerrado 2026-07-27: `registrar()` rechaza con 400 cualquier `metodoPagoId` ausente
  del mapa tenant-scoped, antes de escribir nada.
- [x] ~~**`garzonId` de propina no se valida contra el tenant y el JOIN de lectura lo
  expone**~~ — cerrado 2026-07-27: `propinaCierreMesa` valida con
  `GarzonesService.obtenerActivoPorId(tenantId, garzonId)` antes de persistir, y el JOIN
  de `findOne` lleva `AND g.tenant_id = vp.tenant_id`. Se sembró un garzón de Falabella
  (`…440332`) **solo** para que el e2e pueda ejercer el cruce: es activo y válido, así que
  el único motivo de rechazo posible es el tenant.
  ⚠️ Ese garzón **aparece en el listado de garzones de Falabella** (es `activo: true` a
  propósito: con `activo: false` el test pasaría por "inactivo" sin tocar el chequeo de
  tenant). Hoy ningún test cuenta garzones de ese tenant. Si algún día uno lo hace y da
  uno de más, la causa está acá — no lo desactives, ajustá el conteo.
- [ ] **Otros tres `LEFT JOIN garzones` sin filtro de `tenant_id`** (backend,
  `turnos/sesiones-garzon.service.ts:181` y `:239`, `salones/cuenta-asignaciones.service.ts:131`
  y `:133`) — mismo patrón que el hallazgo de arriba: la tabla principal filtra por tenant
  y la unida solo por `eliminado_el`. Hoy **no son explotables por sí solos** (el
  `garzon_id` de esas filas se escribe por caminos tenant-scoped), pero son la misma
  defensa faltante y quedan a un bug de distancia de convertirse en fuga. Fuera del
  alcance auditado (`ventas`+`pagos`); entran cuando se audite `turnos` y `salones`.
- [x] ~~**La caja se verifica sin lock y el movimiento se escribe después sin
  re-chequear**~~ — cerrado 2026-07-27: la creación de venta (canal físico) y el abono
  toman `bloquearCajaAbierta` dentro de la transacción, el mismo patrón que ya usaba la
  nota de crédito. Los tres caminos que escriben en `movimientos_caja` sostienen ahora el
  lock hasta el commit. La caja virtual queda deliberadamente fuera: nunca se cierra y
  bloquearla serializaría todas las ventas online del tenant.
- [ ] **N+1 al crear una venta: un `itemsService.findOne` por línea del carrito**
  (backend, `ventas/ventas.service.ts:119-121`) — `Promise.all(dto.lineas.map(l =>
  findOne(...)))` en el camino caliente del POS; cada `findOne` abre varias queries
  propias (impuestos, recargos, descuentos, y receta/combo). Un ticket de 10 líneas
  dispara decenas de queries para resolver ítems que ya se conocen por `itemId`. Es el
  anti-patrón "N+1 indirecto" de `docs/agent/anti-patterns.md`. Cierre: batch
  `WHERE item_id = ANY($1)` + `Map` en memoria.
- [ ] **`registrarAbono` sin `FOR UPDATE` sobre la venta ni sobre la suma de pagos**
  (backend, `pagos/pagos.service.ts:275-320`) — dos abonos concurrentes sobre la misma
  venta leen el mismo saldo y ambos lo aplican: sobre-pago que ninguno de los dos ve.
  El repo ya tiene el patrón (`lockVentaOriginal`, `bloquearCajaAbierta`). Distinto del
  bug de fuente de datos de arriba: ese es *qué* se lee, este es *sin qué garantía*.
- [ ] **N+1 al resolver personalización de recetas/combos**
  (backend, `ventas/ventas.service.ts:197-218`) — mismo patrón que el anterior, una
  resolución independiente por línea `receta`/`combo`. Mismo camino caliente.
- [ ] **Orden de locks de `item_producto` decidido por el cliente → deadlock**
  (backend, `ventas/ventas.service.ts:434-478` + `inventario/inventario.service.ts:91`)
  — el `SELECT … FOR UPDATE` por ítem se toma en el orden de `dto.lineas`. Dos ventas
  simultáneas con los mismos dos productos en orden inverso se bloquean en cruz;
  Postgres aborta una. No corrompe datos (la transacción se revierte entera), pero
  tumba una venta con un error opaco. Cierre barato: ordenar las líneas por `itemId`
  antes de iterar.
- [ ] **`esNotaCredito` se recalcula en el drawer con un código hardcodeado**
  (backend `ventas/ventas.service.ts:1110` vs frontend
  `components/ventas/VentaDetalleDrawer.vue:144`) — el listado recibe el booleano ya
  calculado por el backend (`tipo_documento_id === TIPO_DOCUMENTO_NC_ID`), pero
  `findOne()` no lo emite y el drawer lo reconstruye con `tipoDocumento?.codigo === '61'`.
  `codigo` es nullable y por país; si no es `'61'`, el drawer ofrece "Nota de crédito"
  sobre una NC (el backend la rechaza recién al confirmar) mientras el listado sí la
  marca. Cierre: emitir `esNotaCredito` en `findOne()` y consumirlo.
- [ ] **`tasa_cambio` se calcula con 6 decimales y se persiste en escala 4**
  (backend, `ventas/ventas.service.ts:242` vs
  `ventas/entities/venta-detalle.entity.ts:34-41`) — `tasa.toFixed(6)` entra en una
  columna `NUMERIC(18,4)` y Postgres la redondea. Los totales son correctos
  (`precioConvertido` se calcula con la tasa completa antes de redondear); lo que se
  pierde es la **reproducibilidad del campo de auditoría**: recalcular
  `precioUnitarioOrigen × tasaCambio` ya no da `precioUnitario`. Severidad baja, sin
  impacto en plata cobrada.
- [ ] **`pos.vue` y `AbonoModal.vue` no usan `apiErrorMsg`**
  (frontend, `pages/ventas/pos.vue:274-276`, `components/pagos/AbonoModal.vue:98-100`)
  — tipan `data.message` como `string`, pero el `ValidationPipe` global (`main.ts:19`,
  sin `exceptionFactory`) devuelve `string[]` en errores de validación → el toast
  muestra el array interpolado. El helper ya existe, está testeado para ambos casos
  (`utils/api-error.spec.ts`) y lo usan `NotaCreditoModal.vue` y `VentaDetalleDrawer.vue`
  del mismo módulo. Severidad baja.
- [ ] **La rama "caja en conciliación" no la ejerce ningún test** (backend,
  `ventas/ventas.service.spec.ts:32,40` y `pagos/pagos.service.spec.ts:22`) — los mocks
  de caja solo existen con `estado: 'abierta'`; `en_conciliacion` no aparece en ninguno
  de los dos specs. Borrar los `if (caja.estado !== 'abierta')` de
  `ventas.service.ts:112-115` y `pagos.service.ts:306-309` no rompe ningún test. Es el
  caso §2c de `verify-feature`: distinción real en el código, cero cobertura — el mismo
  molde del bug de permisos de recuentos.
- [ ] **Nadie ejerce a cuál pago se le asigna el vuelto con métodos mixtos** (backend,
  `pagos/pagos.service.spec.ts:238`) — el único test con excedente usa **un solo**
  método (índice 0 = siempre "correcto"), y el único test con dos métodos no tiene
  excedente. Es la razón por la que el bug del vuelto (primer ítem de esta lista) pasó
  todos los gates. Cierre: el test que lo cubra es el mismo que verifica ese fix.
- [ ] **La nota de crédito sobre `pagada_parcial` no se prueba nunca en éxito**
  (backend, `ventas/ventas.service.spec.ts`) — `pagada_parcial` **no aparece en el
  spec**; el camino feliz usa siempre `'pagada'` (`:766`) y el `it.each` solo cubre los
  estados que deben rechazarse (`:1242-1252`). Sacar `'pagada_parcial'` de la whitelist
  de `ventas.service.ts:619` no rompe ningún test.

### Decidido por el owner tras investigación de mercado (2026-07-27)

Las tres salieron de la auditoría como reglas de negocio no documentadas. Se corrió una
pasada de investigación sobre dos de ellas y el owner decidió las tres. Método, cruce
contra el código y fuentes: **`docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`**.
Lo de abajo es **trabajo pendiente con la forma ya definida**, no preguntas abiertas.

- [ ] **Acotar el dinero devuelto por una NC a lo cobrado EN EFECTIVO en esa venta**
  (backend, `ventas/ventas.service.ts:699-728`) — hoy `devolverDinero` genera **siempre**
  una salida de efectivo sin mirar con qué pagó el cliente, validada solo contra el saldo
  **global** de la caja. Dos agujeros en uno: se puede devolver más de lo que esa venta
  ingresó, y se puede dar efectivo por una compra con tarjeta — el vector de fraude
  interno que la investigación identifica como principal (Clover, Lightspeed y Toast lo
  bloquean por diseño). Un solo tope cierra los dos: `Σ(pago_aplicaciones tipo='venta' de
  pagos con método es_efectivo) − Σ(ya devuelto en efectivo)`. Los datos ya están.
  **El tope documental de la NC (`total_final − Σ NCs previas`) NO se toca**: coincide con
  la regla dura del SII, que rechaza una NC que exceda el documento de referencia.
- [ ] **Implementar `cancelada` en su subconjunto seguro** (backend + frontend) — anular
  solo una venta `pendiente`, **sin pagos** y **sin documento emitido**, con motivo
  obligatorio (Toteat exige 10 caracteres mínimo). Es lo inequívocamente anulable hoy y lo
  seguirá siendo tras integrar el SII: no hay hecho fiscal que compensar ni dinero que
  devolver. Todo lo demás ya tiene camino por la nota de crédito. Cierra el agujero real:
  hoy una venta mal ingresada obliga a emitir un documento tributario para deshacer un
  tipeo. **No** modelar el plazo de 6 meses de la Ley 21.398 (se cuenta desde la entrega
  del bien): es infraestructura DTE especulativa, prohibida por ADR-010.
- [ ] **Sacar `borrador` del enum y de la doc** (`ventas/entities/venta.entity.ts:10-16`,
  `docs/features/ventas.md`, `docs/PRODUCTO.md:426`) — `cuenta`, `cuenta_lineas` y
  `cuenta_asignaciones` de `modules/salones/` ya son el *open ticket* que describe el
  mercado; un `borrador` de venta en paralelo sería una segunda forma de resolver lo
  mismo. El único hueco que quedaría es parquear un ticket en **mostrador**, fuera de
  salones — nadie lo pidió, se diseña si aparece. Sin datos productivos, cambiar el enum
  es cambiar el esquema y resembrar.

## Refactor Caja → "Mi caja" / "Cajas" (diferido del brainstorm 2026-07-23)

El refactor separa la operación del cajero (**"Mi caja"**) de la supervisión del encargado
(**"Cajas"**). Se decidió que **"Cajas" arranca solo-lectura**; los poderes de escritura del
encargado se difieren a propósito para no acoplar el refactor de IA/permisos a un cambio de
modelo con implicancias de auditoría. Investigación y cruce de mercado:
[`investigaciones/2026-07-23-gestion-caja.md §6`](investigaciones/2026-07-23-gestion-caja.md).

- [x] **Refactor de IA/permisos — HECHO** (2026-07-23) — módulo `Caja` renombrado a
  `MiCaja` (mismo id, `Leer`/`Crear`/`Actualizar`/`Eliminar`); módulo nuevo `Cajas`
  (solo `Leer`); `Ver todas` dejó de asociarse a caja; guards remapeados por endpoint en
  `caja.controller.ts` (mismo controller/service, rutas `/caja/*` sin cambio); dos
  superficies frontend `/mi-caja*` y `/cajas*` (`/caja` redirige a `/mi-caja`);
  escrituras siguen owner-only aun con `Cajas:Leer`. Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#modelo-de-acceso-por-permiso).
- [x] **Sub-proyecto A — Arqueo de caja multi-medio — HECHO** (2026-07-24) — resuelve el
  §3 de la investigación (faltante fantasma / esperado mezclado): el cierre pasa de un
  número a una línea esperado-vs-contado por método (`es_efectivo` global +
  `requiere_conteo` por tenant, tabla `caja_arqueo_medio` congelada, `GET
  /caja/:id/arqueo`, `POST /caja/:id/cerrar` multi-línea). Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#arqueo-de-caja-multi-medio-sub-proyecto-de-negocio-a-post-estructura).
- [x] **Sub-proyecto B — Cierre ciego — HECHO** (2026-07-24) — resuelve la mitad barata de
  §5/§6 de la investigación (blind count): config por tenant `tenants.arqueo_ciego`
  (default `false`, `GET`/`PUT /caja/arqueo-ciego` con `Cajas:Leer`/`Actualizar`); en modo
  ciego + caja abierta `GET /caja/:id/arqueo` retiene `esperado:null` y filtra a solo
  líneas obligatorias (nadie ve el esperado de una caja abierta, ni dueño ni supervisor);
  respuesta cambia de `LineaArqueo[]` a `{ ciego, lineas }`; caja cerrada siempre revela;
  `cerrar` sin cambios (su respuesta es la revelación); drawer ciego revela por
  redirección al detalle. Detalle:
  [`docs/features/gestion-cajas.md`](../features/gestion-cajas.md#cierre-ciego-modo-anti-fraude).
  Los ítems siguientes quedaron pendientes hasta el sub-proyecto C (abajo); "ocultar el
  resultado post-cierre" **sigue** diferido incluso después de C (ver [investigación
  §6](investigaciones/2026-07-23-gestion-caja.md#6-poderes-del-encargado-sobre-la-caja-del-cajero-investigación-2026-07-23)):
- [x] **Sub-proyecto C — Cierre en dos fases + motivos de diferencia — HECHO** (2026-07-24)
  — resuelve la conciliación operador→supervisor de §6 y los motivos categorizados de §5:
  fase 1 `POST /caja/:id/conteo` congela el arqueo server-side (inmutable desde ahí) y
  bifurca a auto-cierre (todo cuadró) o `estado='en_conciliacion'` (algún descuadre); fase
  2 `POST /caja/:id/cerrar` (owner-**o**-admin, única escritura no estrictamente
  owner-only del controller) exige un motivo categorizado — o comentario si el tenant no
  tiene motivos activos (red de seguridad) — por línea descuadrada y finaliza sin
  recalcular nada; `en_conciliacion` ocupa igual que `abierta` (bloquea abrir otra caja, el
  cajón, ventas y movimientos); catálogo `motivo_diferencia_caja` admin-only (mismo patrón
  que `causas_merma`); override admin `PATCH /caja/:id/arqueo/motivos` corrige motivos de
  una caja ya cerrada. **No** es el cierre forzado de §6 (el admin solo *finaliza* una
  conciliación que el dueño ya congeló, nunca inicia el conteo de una caja ajena) — ese
  ítem sigue diferido más abajo. Detalle:
  [`docs/features/gestion-cajas.md` § Cierre en dos fases](../features/gestion-cajas.md#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c).
- [ ] **Cierre forzado de caja ajena por el encargado** (backend + modelo) — habilitar que
  un usuario con permiso `Cajas` cierre la caja de un cajero que dejó el turno abierto
  (escenario: cajero que se fue de urgencia). Requiere agregar **`cerrada_por`** a la tabla
  `cajas` (quién contó/cerró), distinto de `usuario_id` (de quién es el turno): sin ese
  campo el cierre mentiría sobre quién respondió por el efectivo. Rompe el owner-only del
  cierre bajo permiso `Cajas:Actualizar`. Mercado: la separación de funciones favorece que
  un segundo intervenga en el cuadre.
- [ ] **Aprobación de cierre por umbral de diferencia** (backend + config) — patrón Toast:
  si el over/short del cierre supera un umbral configurable, el cierre del cajero requiere
  aprobación del encargado. Agrega config de umbral por tenant + flujo de aprobación. Más
  fiel al mercado; mayor alcance. Ya no depende de resolver el modelo del esperado (§3,
  **resuelto** por el sub-proyecto A de arriba) — el umbral se evaluaría sobre la
  diferencia de cada línea del arqueo multi-medio, ya no sobre un total mezclado que
  inflaba cualquier diferencia.
- [ ] **Ocultar el resultado post-cierre al cajero** (backend + frontend) — en el cierre
  ciego (sub-proyecto B) el cajero **sí** ve su propia diferencia al enviar el conteo (la
  revelación es inmediata, vía el detalle), aunque la caja quede `en_conciliacion`. El
  sub-proyecto C (arriba) resolvió la conciliación operador→supervisor de §6, pero no
  condicionó la revelación a que solo el supervisor la vea de inmediato — sigue diferido.
- [ ] **Conteo por denominación** (§5/§8.3 de la investigación) — los motivos categorizados
  de diferencia de §5 quedaron **resueltos** por el sub-proyecto C (arriba); lo que sigue
  pendiente de §5 es exclusivamente el conteo por denominación de billetes/monedas, sin
  tracking más detallado que [`investigaciones/2026-07-23-gestion-caja.md
  §9`](investigaciones/2026-07-23-gestion-caja.md).

## Endurecimiento para producción (pre-lanzamiento — hoy no hay prod)

El proyecto está en desarrollo y `main` no se despliega, así que nada de esto corre hoy.
Pero el flujo actual (push directo a `main`; CI que corre **después** del push como
detector, no como portón; sin ramas/PRs por decisión de la etapa de dev) **no es seguro
para producción**: un CI rojo hoy es inofensivo porque `main` no despliega, pero el día
que `main` auto-despliegue significaría subir código roto a prod y enterarse tarde. Esta
sección se abre al encarar el paso a producción. Orden = prioridad.

- [ ] **Idempotencia en la creación de venta** (backend + frontend) — decidido 2026-07-27:
  va acá y no antes, porque hoy no hay usuarios que puedan sufrir el doble cobro y es una
  feature con superficie propia (contrato HTTP, tabla, cliente), no un fix. **El problema:**
  no existe clave de idempotencia en ningún endpoint; un doble clic en "cobrar" o un
  reintento del cliente tras un timeout crea **dos ventas completas** — doble descuento de
  stock y doble cobro. El `FOR UPDATE` de inventario evita stock negativo, no la venta
  duplicada, y deshabilitar el botón en el frontend no sobrevive a un timeout de red.
  **Forma:** `Idempotency-Key` generada por el cliente **por intento de cobro** (no por
  carrito), tabla que guarda clave → respuesta, y reproducción de la respuesta original en
  el reintento en vez de recrear.
  ⛔ **La opción barata es la incorrecta:** deduplicar por hash del carrito en una ventana
  de segundos rompe el caso real de dos clientes comprando lo mismo con segundos de
  diferencia — cotidiano en un minimarket o una cafetería. No es un atajo aceptable.
- [ ] **`synchronize: true` → migraciones (CRÍTICO, bloqueante de prod)** (backend) —
  hoy el esquema lo crea `synchronize` al bootstrap (dev + CI, porque `NODE_ENV != production`).
  En prod `synchronize` **puede dropear columnas y perder datos** al arrancar tras un cambio
  de entidad. Antes de cualquier deploy real: apagar `synchronize` en prod, adoptar
  migraciones TypeORM (generar desde el estado actual, versionar), y que el deploy corra
  `migration:run`. `startup-pos.sql` deja de ser solo referencia y pasa a ser el baseline
  de la primera migración. Es dinero y multi-tenant: sin esto un deploy puede corromper datos.
- [ ] **CI como portón de deploy + branch protection** (harness/infra) — hoy
  `.github/workflows/ci.yml` dispara `on: push: [main]` → corre DESPUÉS del push (detector),
  y `main` **no está protegida**. Para prod: (1) el job de deploy declara `needs: [gate]`
  (`if: success()`) → CI rojo = **no hay deploy**, prod queda en la última versión buena;
  (2) reactivar PRs + `required status checks` sobre `main` (revierte la regla de dev
  "trabajar directo sobre `main`") → el código roto ni toca la rama que despliega. Cierra el
  agujero del post-mortem del 2026-07-23 (push a `main` con e2e rojo).
- [ ] **Rate limiting** (backend) — hoy no hay throttling; los endpoints de auth
  (`POST /auth/login`, `/auth/refresh`) son brute-forceables. Agregar `@nestjs/throttler`:
  límite global por IP + límite estricto en auth. Cuidado multi-tenant: la key de rate limit
  no debe filtrar entre tenants ni permitir que un tenant agote la cuota de otro. Considerar
  store compartido (Redis) si corre en varias instancias — el límite en memoria no sirve tras
  un load balancer.
- [ ] **Deploy seguro: rollback + feature flags + canary** (infra) — el portón de CI evita
  el error *conocido* (que los tests detectan), no el desconocido (bug que ningún test cubre y
  pasa en verde). Para acotar ese: rollback rápido a la versión anterior (deploy inmutable),
  canary/gradual (soltar al % del tráfico y mirar métricas antes del 100%), y feature flags
  para apagar una feature sin re-desplegar.
- [ ] **Secrets fuera del repo + rotación** (infra) — `JWT_SECRET`, `JWT_REFRESH_SECRET`,
  `PASARELA_ENCRYPTION_KEY` hoy salen de `.env`. En prod deben venir de un secret manager
  (no del repo, no de variables de entorno en texto plano en el CI), con rotación. Auditar que
  ningún secreto real quedó commiteado. La `PASARELA_ENCRYPTION_KEY` es especialmente sensible:
  cifra credenciales de pasarela de pago.
- [ ] **Cabeceras de seguridad + CORS whitelist + HTTPS** (backend) — `main.ts`: `helmet`,
  forzar HTTPS, y **CORS por whitelist env-driven**. Hoy `enableCors` permite un solo origen
  (`FRONTEND_URL ?? http://localhost:5173`, `credentials: true`); generalizar a lista blanca:
  `CORS_ORIGINS` (coma-separado) → `.split(',').map(trim).filter(Boolean)` → array a `origin`
  (el paquete `cors` lo refleja si está, rechaza si no). Con `credentials: true` **no** se puede
  usar `'*'`; la lista debe ser explícita. Documentar la var en `.env.example`. Prod define
  `CORS_ORIGINS=https://app.tudominio.com[,...]`; dev queda con el default localhost.
  **Nota de alcance:** CORS solo guarda al **navegador** (evita que la web de otro origen use la
  sesión/cookie del usuario contra la API); no frena curl/Postman/servidor-a-servidor. El control
  de acceso real es el JWT ya implementado — la whitelist es defensa en profundidad, no el candado.
- [ ] **Observabilidad: logs estructurados + error tracking + alertas** (backend/infra) —
  logging estructurado que **no filtre PII ni `tenant_id` cruzado**, captura de errores
  (Sentry/equivalente), y alertas de error-rate/latencia para enterarse en minutos, no cuando
  se queja un cliente. Es la contraparte del "bug que pasó el CI verde".
- [ ] **Backups automáticos + restore probado (Postgres)** (infra) — datos financieros
  multi-tenant: backups automáticos + point-in-time recovery, y **restore probado** (un backup
  que nunca se restauró no es un backup). Tópico aparte del deploy de la app.
- [ ] **Health/readiness + graceful shutdown** (backend) — endpoint `/health` para el
  orquestador (readiness real: chequea la BD), y cierre ordenado de conexiones al recibir
  SIGTERM para no cortar requests en vuelo durante un deploy.
- [ ] **Escaneo de dependencias en CI** (harness) — `npm audit` / Dependabot como paso del
  gate, para no arrastrar CVEs conocidos a prod.
- [ ] **Pre-push que corre el gate completo local (todas las suites)** (harness) — hoy
  `.githooks/pre-push` solo hace `codegraph sync` (no-bloqueante); el gate real corre en CI
  DESPUÉS del push (fue lo que dejó `main` en rojo el 2026-07-23). Mover ese gate a un pre-push
  BLOQUEANTE para atajarlo antes de subir. Diseño acordado:
  (1) **Gate determinista primero** (rápido, sin infra, cero falsos rojos): backend `lint:check`
  + `typecheck` + `test` (unit); frontend `test` (vitest) + `typecheck:ratchet` + `design:check`
  + `build`. Si algo falla, corta acá sin tocar Docker.
  (2) **e2e con DB fresca**: `./scripts/reset-db.sh` → `npm run test:e2e`. El script ya existe
  (jul-2026) y resuelve esta parte: borra el volumen, levanta y **espera el `Seed complete`** —
  no alcanza con esperar a Postgres healthy, porque el contenedor levanta antes de que el seed
  termine y una suite que arranca a mitad falla con errores que no son regresiones. La DB limpia
  es imprescindible: contra la DB de dev acumulada da **falsos rojos** por polución de seed
  ([[e2e-cumulative-stock-pollution]]) → entrena `--no-verify` y mata el hook. NO usar `--build`:
  el e2e levanta su Nest en el host y solo necesita Postgres fresco.
  (3) **Solo el bloque pesado (Docker + e2e) si el rango a pushear tocó `backend/`**; el gate
  determinista corre siempre. Evita 4 min de stack+e2e en un push de solo-docs.
  (4) Bloqueante; escape `git push --no-verify`. Es el enforcement de [[rigor-sobre-velocidad]].
  Complementa (no reemplaza) el CI, que sigue siendo la verdad con DB fresca de verdad.

## Limpiezas menores (opcionales, no bloqueantes)

- [ ] **Falta usuario semilla "supervisor `Cajas:Leer` no-admin" para e2e del ciego** (test) —
  al hacer que el modo ciego NO aplique al admin/superadmin (2026-07-25), el criterio es
  `esAdmin = esSuperadmin || userIsTenantAdmin`; un supervisor con `Cajas:Leer` que **no** sea
  admin debe seguir ciego. Hoy eso lo cubren el unit del controller (`Cajas:Leer=true` +
  `userIsTenantAdmin=false` → `esAdmin=false`) y la lógica del service, pero **no** un e2e real:
  el seed solo tiene admin (admin.paris, que hace de "supervisor") y cajero (vendedor), ninguno
  es supervisor-no-admin. Sembrar un rol `Cajas`-solo-lectura no-fijo + su usuario y agregar un
  e2e que verifique que ve la caja abierta ciega. Cierra el gap que marcó la revisión de seguridad.
- [ ] **Recuento de inventario en modos `serie` y `lote`** (backend + frontend) — el recuento
  (`docs/features/recuento-inventario.md`) cubre solo `modo_inventario='cantidad'`; los
  productos por serie o lote quedan fuera del listado y agregarlos a una sesión devuelve 400.
  No es una extensión trivial del mismo formulario:
  - **`lote`**: es un número **por lote vivo** (una fila por lote con su vencimiento). El delta
    y el movimiento se resuelven por lote, no por producto. Es el más cercano a lo ya hecho.
  - **`serie`**: no es una cantidad sino una **diferencia de conjuntos** — qué identificadores
    esperaba el sistema, cuáles se escanearon, cuáles faltan (→ salida de esas unidades) y
    cuáles aparecieron sin estar registrados. Ese último caso **no tiene respuesta obvia**
    (¿entrada de una unidad desconocida? ¿error a corregir aparte?) y es una decisión de
    negocio del owner antes de diseñar.

  Cerrar cuando aparezca la necesidad real: hoy el caso que motiva el recuento es food-service,
  donde insumos e ingredientes son todos `cantidad`.
