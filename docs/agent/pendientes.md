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
- [ ] **Los mapas de estado de venta están duplicados en 4 `.vue`** (frontend,
  `pages/ventas/index.vue`, `components/ventas/VentaDetalleDrawer.vue`,
  `pages/pagos/index.vue`, `components/pagos/PagoDetalleDrawer.vue`) — cada uno con su
  copia de `estadoColor`/`estadoLabel`, contra la convención de `CLAUDE.md` ("utilidades
  de presentación en composables de `app/composables/`, nunca locales a un `.vue`").
  **Ya causó una regresión real** (jul-2026): al sacar `borrador` del enum se limpiaron
  las dos copias de ventas y no las de pagos, y el filtro de `/pagos` quedó ofreciendo un
  estado que el backend ahora rechaza con 400 vía `@IsEnum(EstadoVenta)` — la tabla
  dejaba de cargar. Lo cazó la revisión independiente, no el gate: build, typecheck,
  design y 275 unit pasaron con la regresión adentro, porque ningún test renderiza ese
  filtro. Cierre: un `useEstadoVenta()` con ambos mapas, consumido por los cuatro.
  **Lección del incidente:** al sacar un valor de un enum compartido, grepear el repo
  entero — el grep acotado a la carpeta del módulo fue exactamente lo que falló.
- [ ] **Tres suites e2e dejan la caja abierta al terminar** (backend, `test/combos`,
  `grupos-modificadores`, `grupos-modificadores-overrides` y `recetas.e2e-spec.ts`)
  — ✅ `liquidacion-propinas` corregida 2026-07-27: al agregarle un test cambió el orden en
  que jest ordena los archivos, pasó a correr antes que `caja.e2e-spec.ts` y su fuga
  apareció como **11 fallos con 409 al abrir**, exactamente el escenario que esta entrada
  predecía. `ventas.e2e-spec.ts` también quedó corregida el mismo día (su `cerrar` mandaba
  `lineas: []` sobre una caja que siempre descuadra). El cierre de caja es en **dos fases**
  (`POST /:id/conteo`
  congela el arqueo y auto-cierra si cuadra; si descuadra pasa a `en_conciliacion` y hay
  que resolver con `POST /:id/cerrar`). Las que quedan llaman solo a la segunda **e ignoran el
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
- [x] ~~**N+1 al crear una venta: un `itemsService.findOne` por línea del carrito**~~ —
  cerrado 2026-07-27 con `ItemsService.cargarBasePorIds`: **una** query para todo el
  carrito. Resultó peor de lo reportado: la venta usa solo campos del row base, así que
  las 3-6 queries extra que `findOne` hacía por ítem (impuestos, recargos, descuentos,
  ingredientes, componentes, grupos) construían colecciones que se descartaban enteras.
- [x] ~~**`registrarAbono` sin `FOR UPDATE` sobre la venta**~~ — cerrado 2026-07-27: la
  carga de la venta toma `FOR UPDATE`, así que los abonos sobre la misma venta se
  serializan hasta el commit y la suma de `pago_aplicaciones` queda bajo ese lock.
- [~] **N+1 al resolver personalización de recetas/combos** — parcialmente cerrado
  2026-07-27. Al abrirlo apareció un N+1 **más caro que el reportado y anidado adentro**:
  `resolverGruposDeItem` disparaba una query **por cada grupo de modificadores** del ítem.
  Ese se cerró (`unnest` de pares grupo↔item_grupo en una sola query) y beneficia a los
  **tres** llamadores —ventas, salones y combos— sin cambiar ninguna firma.
  **Queda abierto lo reportado originalmente:** batchear *entre líneas*, es decir precargar
  los catálogos de las recetas/combos distintos del carrito en vez de resolver cada línea
  por su cuenta. Hoy cada línea `receta`/`combo` cuesta 3 queries fijas (ingredientes,
  extras, grupos+opciones). Batchearlo exige pasar los catálogos precargados por parámetro
  a `resolverPersonalizacionReceta`/`Combo` y `resolverGruposDeItem`, que tienen 3
  llamadores incluido `salones.service.ts` — más riesgo y menos ganancia que lo ya hecho.
  **Es decisión de owner si se encara**, con este número sobre la mesa: un carrito de 5
  líneas de receta pasó de 5×(3+G) queries a 15 fijas; batchear entre líneas lo llevaría
  a ~3.
- [x] ~~**Orden de locks de `item_producto` decidido por el cliente → deadlock**~~ —
  cerrado 2026-07-27: los movimientos de inventario se recorren en orden determinista por
  `itemId` (desempate por posición), no en el del carrito. Un orden global fijo hace
  imposible el bloqueo en cruz entre dos ventas con los mismos productos.
- [x] ~~**`esNotaCredito` se recalcula en el drawer con un código hardcodeado**~~ —
  cerrado 2026-07-27: `findOne()` lo emite con el mismo criterio que `listar()` (el id del
  tipo de documento) y el drawer lo consume. Hay un test con una NC de código `'9999'`:
  comparar por código daría `false` y el test falla.
- [x] ~~**`tasa_cambio` se calcula con 6 decimales y se persiste en escala 4**~~ —
  cerrado 2026-07-27: la columna pasa a `NUMERIC(18,6)`, la misma escala que
  `tenant_moneda.valor_del_dia` de donde sale la tasa. El campo vuelve a reproducir
  `precioUnitario`, que es para lo que existe.
- [x] ~~**`pos.vue` y `AbonoModal.vue` no usan `apiErrorMsg`**~~ — cerrado 2026-07-27
  (las dos ocurrencias de `pos.vue`, no solo la del hallazgo).
- [ ] **Otros 14 `.vue`/composables arman el mensaje de error a mano** (frontend,
  `components/caja/*` ×5, `components/configuracion/*` ×2, `composables/usePaginatedList`,
  `useTarjetas`, `useUserPreferences`, `pages/tienda/*` ×3, `pages/ventas/index.vue`,
  `pages/pagos/index.vue`) — mismo patrón que se acaba de cerrar en ventas/pagos: tipan
  `data.message` como `string` y el `ValidationPipe` global devuelve `string[]` en errores
  de validación, así que el toast muestra el array interpolado. Degrada, no rompe. Quedan
  fuera porque no son del alcance auditado (`ventas`+`pagos`); es un barrido de una línea
  por archivo usando `apiErrorMsg`, que ya existe y está testeado.
- [x] ~~**La rama "caja en conciliación" no la ejerce ningún test**~~ — cerrado
  2026-07-27: un test por service verifica que una caja presente-pero-no-abierta se
  rechaza, y que corta **antes** de escribir (sin lock, sin cargar ítems, sin `save`).
- [x] ~~**Nadie ejerce a cuál pago se le asigna el vuelto con métodos mixtos**~~ —
  cerrado 2026-07-27, en **dos** intentos, los dos fallidos por la misma causa. La 1ª
  versión ponía el método con vuelto primero en el array y primero por id: "elegir por
  permiso", "elegir el primero" y "elegir por id" coincidían. La 2ª agregó un método sin
  vuelto delante… pero con **solo dos pagos el ganador es a la vez el último, el de id
  mayor y el de monto mayor**, así que seguía sin descartar esas tres. Lo cazó la
  revisión independiente, no yo. La versión final usa **tres** pagos con el efectivo en
  el medio en posición, id y monto; se verificó contra cuatro implementaciones erróneas
  (primero, último, mayor monto, id mayor) y las cuatro lo hacen fallar.
- [x] ~~**La nota de crédito sobre `pagada_parcial` no se prueba nunca en éxito**~~ —
  cerrado 2026-07-27: camino feliz sobre `pagada_parcial`, no solo su ausencia de la
  lista de rechazo.

Los cuatro se validaron con mutantes sobre el código de producción: borrar cada guard o
sacar `pagada_parcial` de la whitelist hace fallar exactamente el test que lo cubre.

### Decidido por el owner tras investigación de mercado (2026-07-27)

Las tres salieron de la auditoría como reglas de negocio no documentadas. Se corrió una
pasada de investigación sobre dos de ellas y el owner decidió las tres. Método, cruce
contra el código y fuentes: **`docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`**.
Lo de abajo es **trabajo pendiente con la forma ya definida**, no preguntas abiertas.

- [ ] **Devolución por medio de pago + configuración de plazos** (backend, tema propio con
  spec) — surgido del aporte del owner el 2026-07-27, **no es parte de los fixes de la
  auditoría**. Hoy hay dos caminos de devolución que no se conocen entre sí: el de tarjeta
  arranca en la pasarela (`reembolsar()` de Webpay/Oneclick, ya implementado) y termina en
  una NC; el de efectivo arranca en la NC y sale por la caja. Nada compone las patas ni
  impide pagar con tarjeta y recibir efectivo. Además **no hay validación de plazo en
  ningún lado**: el límite de Transbank se descubre como rechazo en runtime. La
  configuración de plazos que se proponga debe separar **tres relojes** —fiscal (SII, sale
  del país), adquirente (propiedad de la integración) y política comercial (lo único
  configurable por el tenant)—, con los dos primeros como techos y el retracto de venta a
  distancia como piso en `online`. Construirlo plano permite que un tenant configure 12
  meses y la empresa se coma el IVA. Análisis completo y fuentes:
  `docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md` §6.
- [x] ~~**Acotar el dinero devuelto por una NC a lo cobrado EN EFECTIVO en esa venta**~~ —
  cerrado 2026-07-27. El tope es `Σ(efectivo aplicado a la venta) − Σ(ya devuelto en
  efectivo)`; excederlo da 422. Acota el **dinero, no el documento**: la NC sigue
  emitiéndose por el total (regla dura del SII). La pata de tarjeta ya existe en
  `pasarela` y no pasa por acá — componer ambas es el tema abierto de arriba.
- [x] ~~**Implementar `cancelada` en su subconjunto seguro**~~ — cerrado 2026-07-27:
  `POST /ventas/:id/anular` con permiso propio `Ventas/Anular`, motivo obligatorio (10
  caracteres) y auditoría (`cancelada_el`, `cancelada_por_usuario_id`,
  `motivo_cancelacion`). Repone stock por default con motivo **`anulacion`** —distinto de
  `devolucion`— y admite `reponerStock: false` para mercadería no vendible. Reponer exige
  `modo_inventario='cantidad'` en todas las líneas: serie y lote se rechazan con el mismo
  mensaje que la devolución de una NC. No se modeló el plazo de 6 meses de la Ley 21.398
  (infraestructura DTE especulativa, prohibida por ADR-010).
- [x] ~~**Sacar `borrador` del enum y de la doc**~~ — cerrado 2026-07-27: fuera del enum
  de TypeScript, del tipo `estado_venta` de Postgres, de los mapas de color/etiqueta y del
  filtro del frontend, y de `ventas.md`/`PRODUCTO.md`. Si algún día hace falta parquear un
  ticket en **mostrador** (fuera de salones), se diseña ahí — nadie lo pidió.

## Auditoría `caja` + `propinas` (2026-07-27) — hallazgos confirmados

Pasada de 8 lentes según [`auditoria-codigo.md`](auditoria-codigo.md). 25 hallazgos crudos →
22 únicos (3 los vieron dos lentes por separado) → **20 sobreviven** tras refutación: 19
defectos y 1 decisión de owner (al final). **Ninguno se corrigió en la pasada**: la
auditoría produce información, no diffs. Orden = severidad.

### Alta

- [x] ~~**`POST /caja/:id/cerrar` con `lineas: []` cierra una caja descuadrada sin
  justificar**~~ — cerrado 2026-07-27: `aplicarMotivosADescuadres` ahora **recorre las filas
  descuadradas de `caja_arqueo_medio`**, no `dto.lineas`; una línea que descuadra y que el
  payload omite cae en el mismo 400 (y con el mismo mensaje) que una que llega vacía. Las
  que cuadran se siguen ignorando, así que un cierre sin descuadres sigue aceptando
  `lineas: []` — hay un test por cada lado, para que "arreglarlo" exigiendo siempre un array
  no vacío también falle. Cubierto por unit (línea omitida, y dos descuadres con una sola
  justificada) y por un e2e real contra la BD. El override admin
  (`PATCH /:id/arqueo/motivos`) comparte el helper y hereda la misma completitud, que es lo
  que ya prometía su docblock.
- [x] ~~**`GET /caja/cajones-estado` revela el esperado de una caja abierta en modo
  ciego**~~ — cerrado 2026-07-27: `cajonesEstado` recibe `esAdmin` y retiene
  `saldoEsperado: null` con la misma regla que los otros tres caminos
  (`!esAdmin && arqueoCiego && estado === 'abierta'`); en `en_conciliacion` revela, porque
  el conteo ya se congeló. `saldoInicial` sigue visible: no es secreto, lo declaró el propio
  cajero al abrir. El front muestra "—". Seis mutantes verificados (quitar cada una de las
  tres condiciones, retener siempre, revelar siempre, y que el controller no pase `esAdmin`)
  y cada uno mata exactamente el test que le toca.
  ⚠️ **Sin cobertura e2e a propósito**: el caso que importa es un supervisor con `Cajas:Leer`
  que **no** sea admin, y ese usuario no existe en el seed — es el ítem ya abierto en
  "Limpiezas menores". Hoy lo cubren el unit del service y el del controller.
- [x] ~~**Un monto manual de propina se aplica en cualquier criterio y no conserva el total
  del grupo**~~ — cerrado 2026-07-27: `validarManualMontos` pasó a ser
  `validarConservacionPorGrupo` y corre sobre **todos** los criterios, no solo
  `MANUAL`+`MONTOS`. Al confirmar, lo repartido en cada grupo tiene que dar exactamente su
  `montoGrupo`; el 400 nombra el grupo y los dos números. **No prohíbe el ajuste manual**:
  exige que la plata cuadre, así que un ajuste compensado entre dos personas del mismo grupo
  se confirma sin problema (hay un test por cada lado). El mutante que devuelve el `continue`
  para los grupos no-`MANUAL` mata el test.
- [x] ~~**Anular una venta no reconcilia `venta_propina`: la propina se paga igual**~~ —
  cerrado 2026-07-27 **en su mitad**: `buscarTipsElegibles` ahora filtra
  `v.estado <> 'cancelada'`, así que la propina de una venta anulada no entra nunca a una
  liquidación nueva. Cubierto por e2e real: se crea la venta con propina, se verifica que el
  pool sube (control, si no el test pasaría aunque nunca hubiera entrado), se anula y se
  verifica que el pool vuelve al valor previo.
  ⚠️ **La otra mitad quedó abierta y decidida** — ver abajo.

### Media

- [ ] **`garzonId` de participante manual no se resuelve contra el tenant** (backend,
  `propinas/liquidacion-propinas.service.ts:980`, `propinas/propina-distribucion.service.ts:193`)
  — se inserta `garzonId: cambio.garzonId` sin validar; el DTO solo pide `@IsUUID()`. Las
  entidades no tienen FK a `garzones`, así que tampoco hay backstop de integridad. El caso
  más probable no es el cross-tenant sino un **uuid inexistente**: entra como participante
  fantasma con `incluido: true` y diluye el reparto de todos. La defensa correcta ya existe:
  `GarzonesService.obtenerActivoPorId(tenantId, garzonId)`, del fix de ventas de jul-2026.
- [ ] **Excluir a un participante le deja el `monto` viejo persistido** (backend,
  `propinas/liquidacion-propinas.service.ts:996-1009` y `:1026`) — `redistribuirGrupo`
  devuelve `omitidos` sin tocar `monto` y `recalcularParticipantesExistentes` solo re-guarda
  `activos`. Hoy no paga de más (reportes e impresión filtran `incluido = true`), pero el
  dato en reposo miente; y si se excluye a **todos** los de un grupo, el `montoGrupo` no
  queda en ninguna fila con `incluido = true` y desaparece sin que nada lo señale.
- [x] ~~**Dos cajas abiertas del mismo usuario bajo concurrencia**~~ — cerrado 2026-07-27
  con el índice único parcial `ux_cajas_activa_por_usuario` sobre `(tenant_id, usuario_id)`
  con `WHERE tipo='fisica' AND estado IN ('abierta','en_conciliacion')`, declarado en la
  **entidad** (que es lo que `synchronize` crea de verdad) y replicado en `startup-pos.sql`.
  Incluye `en_conciliacion`, así que también cubre el hueco que el comentario del índice de
  cajón dejaba explícitamente a cargo del service. El `catch` del 23505 ahora distingue por
  `constraint` y devuelve el mensaje que corresponde: "ya tenés una caja" y "el cajón está
  ocupado" mandan al usuario a hacer cosas distintas.
  Tests: un e2e que assevera que el índice **existe con su forma** (leyendo `pg_indexes`;
  borrarlo del entity lo hace fallar) y un unit parametrizado del mapeo de cada constraint a
  su mensaje.
- [x] ~~**"Diferencia" significa dos números distintos según la pantalla**~~ — cerrado
  2026-07-27: el listado del historial emite `diferenciaTotal`, la suma de **todas** las
  líneas del arqueo congelado, y la columna pasa a mostrar ese campo. `cajas.diferencia` se
  queda como está —es deliberadamente el cuadre del **cajón físico**— y ahora ambos campos
  dicen en el tipo cuál es cuál. El total sale por `LEFT JOIN LATERAL` con un `SUM` en la
  **misma** query del listado: una sola consulta para todas las filas, sin N+1 y sin agrupar
  por las 13 columnas. Una caja abierta todavía no tiene arqueo congelado → `null` → "—".
  El e2e cierra una caja con el efectivo cuadrado y -500 en tarjeta y verifica los dos
  campos por separado (`diferencia` = 0, `diferenciaTotal` = -500), que es exactamente el
  caso que el historial mostraba como "+0".
- [ ] **`etiquetasGarzones` no filtra `eliminado_el IS NULL`** (backend,
  `propinas/propina-reportes.service.ts:643-651`) — contra la invariante de soft delete y
  contra sus tres queries hermanas del mismo archivo, que sí filtran. La prueba de la
  intención: deja **inalcanzable** el fallback `'Trabajador eliminado'` (`:203`). **Al
  cerrarlo hay una decisión chica:** filtrar (y el fallback revive) **o** documentar la
  excepción deliberada, como ya se hizo con `metodos_pago` en `caja/caja.service.ts:322`,
  donde el nombre histórico es intrínseco al movimiento.
- [ ] **Un garzón en dos grupos revienta la liquidación con un 23505 crudo** (backend + BD,
  `startup-pos.sql:1606`, `propinas/liquidacion-propinas.service.ts:1216-1236`) —
  `uq_liquidacion_propinas_participante_garzon` es único por `(liquidacion_id, garzon_id)`,
  **sin `grupo_id`**, y `buildParticipantesData` itera por grupo sin deduplicar. Un garzón
  reclasificado a mitad de período (`UpdateGarzonDto.tipo` es editable) genera tips con dos
  `tipo_garzon`, la liquidación arma dos participantes con el mismo `garzonId`, el segundo
  `INSERT` viola el índice y **nadie del período puede liquidarse**. Tensión con la doc: el
  motor documenta la pertenencia por el snapshot `tipo_garzon` del tip y no por
  `garzon.tipo`, lo que hace el caso alcanzable por diseño; el esquema no lo soporta.

### Baja

- [ ] **`registrarMovimientoEnTransaccion` no valida signo ni estado de la caja** (backend,
  `caja/caja.service.ts:785-809`) — recibe un objeto plano y lo inserta tal cual: sin
  `@IsDecimalPositivo` (que solo cubre el camino HTTP vía `CrearMovimientoDto`) y sin
  verificar el estado. `startup-pos.sql:886` tampoco tiene `CHECK` sobre `monto`. Hoy **no
  es explotable**: sus dos llamadores (`ventas.service.ts`, `pagos.service.ts`) toman
  `bloquearCajaAbierta` antes y ya no producen montos negativos desde el fix del vuelto. Es
  endurecimiento del chokepoint por donde entró ese bug, no un bug activo. Cierra el hilo
  que la auditoría de ventas mandó acá: defendido en el endpoint, no en el método compartido.
- [ ] **`asegurarDefault` de propinas devuelve 500 en el primer uso concurrente** (backend,
  `propinas/propina-distribucion.service.ts:68`) — el `lock: pessimistic_write` sobre una
  fila que **todavía no existe** no bloquea nada; dos requests insertan y el segundo viola
  `uq_propina_config_tenant` (`startup-pos.sql:1457`) sin `catch`. No corrompe (el índice
  hace su trabajo) y se cura tras el primer insert. El patrón correcto está tres módulos más
  allá, en `caja/caja.service.ts:241`.
- [ ] **El monto manual de propina no valida signo en el DTO** (backend,
  `propinas/dto/ajustes-reparto.dto.ts:14`, `propinas/dto/update-liquidacion.dto.ts:34`) —
  `@IsNumberString()` a secas acepta `'-5000'`; son los dos campos que quedaron fuera del
  barrido de signo de `74f3f35`. **No llega a persistir**: `chk_liquidacion_participante_metricas`
  (`startup-pos.sql:1595`) exige `monto >= 0`. Queda un 500 crudo donde correspondía un 400,
  y el **preview** (que no persiste) devolviendo una propina negativa en pantalla.
- [ ] **`crearFuentes` inserta fila por fila sobre un conjunto sin tope** (backend,
  `propinas/liquidacion-propinas.service.ts:1187-1195`) — dentro de la transacción de
  `liquidar()`, y `buscarTipsElegibles` no tiene `LIMIT`, así que N = ventas con propina del
  período. Al cerrarlo, **verificar de verdad** que `save(array)` colapsa a un INSERT
  multi-fila y no a N inserts igual.

### Huecos de test (el gate verde no los ve)

- [ ] **El guard de estado de la caja no lo ejercita ningún test real** (test,
  `caja/caja.service.spec.ts:209`, `:460`, `:827`) — los tres mockean
  `managerMock.query.mockResolvedValueOnce([])` sin relación con el SQL emitido: el
  resultado lo decide el mock, no el `WHERE estado='abierta'`. Y `test/caja.e2e-spec.ts`
  nunca intenta escribir contra una caja `cerrada`/`en_conciliacion`. Relajar el filtro a
  `estado IN ('abierta','en_conciliacion')` no rompe nada. Es justamente la defensa que dos
  lentes dieron por buena leyendo el código.
- [ ] **El criterio `MANUAL` (`PESOS` y `MONTOS`) no tiene ningún test de reparto** (test) —
  el único `criterio` ejercido en `liquidacion-propinas.service.spec.ts` y en el e2e es
  `PARTES_IGUALES`/`VENTAS_NETAS`. `validarManualMontos` se puede borrar entera sin que
  falle nada. (`propina-distribucion.service.spec.ts` sí prueba `MANUAL`, pero solo a nivel
  **config**, no de reparto.)
- [ ] **El test de partes iguales no discrimina `PARTES_IGUALES` de `CANTIDAD_CUENTAS`**
  (test, `propinas/liquidacion-propinas.service.spec.ts:151-186`) — el fixture da
  exactamente 1 tip a cada garzón, así que `cuentas = 1` para ambos y las dos fórmulas dan
  `75.0000`/`75.0000`. `CANTIDAD_CUENTAS` no aparece en ningún test. Es el mismo error del
  test del vuelto (ver [`anti-patterns.md`](anti-patterns.md)): el escenario tiene que
  descartar las implementaciones incorrectas, no coincidir con ellas.
- [ ] **`actualizarConfig` no assertea `result.participantes`** (test,
  `propinas/liquidacion-propinas.service.spec.ts:348-389`) — si `crearParticipantes`
  devolviera siempre `[]` el test sigue verde, porque el fixture monta `tips = []`.
- [ ] **El e2e de historial por `cajonId` no discrimina** (test,
  `test/caja.e2e-spec.ts:331-339`) — quien consulta es el mismo usuario que abrió la caja,
  así que borrar la rama `cajonId && tieneVerTodas` (`caja/caja.service.ts:949`) sigue dando
  200 con array no vacío. Solo assertea `status` y `Array.isArray`.

**Ramas sin cobertura alguna**, para decidir si entran: `HORAS_TRABAJADAS`;
`advertenciasSesionesAbiertas` con `fin_el = null`; las guardas `fechaHasta <= fechaDesde`,
`gruposConfig.length === 0` y moneda oficial ausente; `aplicarCambioParticipante` (alta
manual); `actualizar` con `recalcular: false`; los endpoints HTTP `confirmar`/`anular`;
el rechazo de `peso <= 0` en `MANUAL/PESOS`; el spillover de propina entre pagos en
`asignacion-propina.ts`; toda la capa SQL de `propina-reportes` (cero e2e);
`registrarMovimientoEnTransaccion`; el backstop 23505 de `abrir()`; y el aislamiento
multi-tenant de caja.

### Decidido por el owner (2026-07-27)

- [x] ~~**Un grupo sin peso agregado aborta la liquidación entera**~~ — cerrado 2026-07-27.
  **Decisión del owner: el pool se reparte siempre entero.** Un grupo del que nadie puede
  cobrar no reserva su porcentaje; su parte se redistribuye entre los que sí pueden. Al
  implementarlo apareció que la misma situación tenía **dos comportamientos opuestos** según
  hubiera o no una fila de sesión: con participantes en peso 0 reventaba la liquidación
  entera, y con cero participantes el `montoGrupo` **desaparecía en silencio** (la suma
  repartida daba menos que el pool). Ahora `montosPorGrupo` reparte solo entre los grupos
  elegibles y `repartirGrupo` deja en 0 a los que no pueden, sin lanzar. Si **ningún** grupo
  puede recibir y hay pool, corta con un 400 que dice qué revisar; un período sin propinas
  sigue siendo válido con todos en cero. Regla escrita en
  [`liquidacion-propinas-motor.md`](../features/liquidacion-propinas-motor.md).
- [ ] **`buscarTipsPorFuentes` no filtra la venta anulada** (backend,
  `propinas/liquidacion-propinas.service.ts:1153`) — es la copia hermana de
  `buscarTipsElegibles` que usa `actualizarConfig` para recalcular pesos sobre las fuentes
  ya fijadas de un borrador. Si la venta se anula **con el borrador abierto**, un
  `actualizarConfig` posterior sigue usando sus datos para el peso (`VENTAS_NETAS`,
  `CANTIDAD_CUENTAS`). Lo encontró la revisión independiente del 2026-07-27.
  ⛔ **No es copiar la línea del hermano.** El `poolTotal` se congela al crear el borrador e
  **incluye** esa propina: filtrar solo acá le saca el peso al garzón pero deja su plata en
  el pool, o sea la redistribuye entre los demás. Decidir eso es la misma pregunta de
  reconciliación del ítem de abajo (¿la plata de una venta anulada sale del pool, se
  redistribuye, o queda como saldo?), así que va con esa spec y no antes.
- [ ] **Saldo en contra cuando se anula una venta cuya propina YA se liquidó** (backend,
  tema propio con spec) — decidido 2026-07-27, **no implementado**: es una entidad nueva y
  toca el motor de reparto, así que no entra como fix de auditoría.
  **El caso:** la propina se liquidó el lunes y se le pagó al garzón; el miércoles anulan
  esa venta (sigue `pendiente` y sin pagos, así que `POST /ventas/:id/anular` la acepta). La
  plata ya salió. **La forma decidida:** permitir la anulación y dejar el monto ya pagado
  como **saldo en contra del garzón**, que se descuenta de su próxima liquidación.
  Preguntas que la spec tiene que responder antes de escribir código: qué pasa si el garzón
  no vuelve a liquidar nunca (¿el saldo caduca? ¿se pierde?); qué pasa si su próxima
  liquidación es **menor** que el saldo (¿queda saldo remanente? ¿se le descuenta hasta
  0?); si el saldo es por garzón y por tenant, o también por período/turno; si el descuento
  se muestra en la impresión y el reporte; y cómo se audita (evento propio, como el resto de
  la liquidación). La mitad barata —que la propina de una venta anulada no entre a
  liquidaciones **futuras**— ya está cerrada arriba.

### Refutados (no entran)

- **Tres "N+1" de escritura** (`liquidacion-propinas.service.ts:1026`, `:365-374`, `:961`),
  uno reportado como alta — no son el N+1 que prohíbe la invariante, que habla del **dato
  derivado por fila en una lectura**. Escribir N filas con valores distintos exige N
  `UPDATE`, y `save(array)` no los colapsa. Queda el punto real (tiempo con el lock tomado),
  pero eso es contención, no N+1, y hoy no tiene escenario de daño.
- **`UPDATE` de `anular()` sin `eliminado_el IS NULL` sobre `venta_propina`** — no existe
  ningún `softDelete` sobre esa tabla, así que no hay fila borrada que tocar. Sin escenario
  reproducible no entra.
- **`porcentaje` de grupo sin validar signo** — un grupo negativo compensado por otro >100%
  pasa la config, pero falla en el reparto antes de persistir dinero. Guard tardío, no
  dinero mal calculado.

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
