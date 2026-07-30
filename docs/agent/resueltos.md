# Resueltos — archivo de pendientes cerrados

Entradas que salieron de [`pendientes.md`](pendientes.md) al corregirse. Cada una queda
con el texto con el que se cerró: **qué se hizo, por qué, y qué mutante o test lo fija**.

Existe porque `pendientes.md` es una lista de trabajo, y una lista de trabajo con más
entradas tachadas que vivas deja de leerse. Acá el detalle sigue disponible —las auditorías
de jul-2026 se explican solas desde este archivo— sin competir con lo que falta hacer.

Agrupadas por su procedencia en `pendientes.md`. El texto se muda **verbatim**: si una
entrada afirma algo que después resultó falso, se corrige donde se descubre, no acá.

---

## Deuda de código (harness)

- [x] ~~**Cuatro suites e2e dejan la caja abierta al terminar**~~ (backend, `test/combos`,
  `grupos-modificadores`, `grupos-modificadores-overrides` y `recetas.e2e-spec.ts`) —
  cerrado 2026-07-29. Las cuatro tenían el **mismo** helper `cerrarCaja` de 10 líneas:
  llamaba solo a la fase 2 (`POST /:id/cerrar`) sobre una caja `abierta` —que el service
  rechaza, porque exige `en_conciliacion`— y **no miraba el status**, así que no cerraba
  nada y el cajón quedaba ocupado. La suite pasaba porque sobraban cajones; al agregar
  tests cambia el orden en que jest ordena las suites y la fuga reaparecía como un `409`
  críptico en `caja.e2e-spec.ts`, a varios archivos de la causa (ya pasó en jul-2026 con
  `liquidacion-propinas`: 11 fallos con 409, media hora de diagnóstico).
  Ahora las cuatro cierran por las dos fases reales, con el patrón de `ventas.e2e-spec.ts`
  (commit `c8e3abe`) y **aseverando** las dos: `expect` sobre el status del conteo —que el
  original de ventas no tiene, y sin el cual un 400 en fase 1 volvería a ser silencioso— y
  sobre el de la finalización. La justificación manda **siempre** un comentario, para no
  depender de que el primer motivo activo del tenant no exija `requiereComentario`.
  **Contrafactual medido, no deducido** (es una fuga de estado: que la suite pase no prueba
  nada). Sobre BD reseteada, corriendo solo `combos`: con el helper viejo restaurado quedan
  **1 caja física en `abierta`**; con el nuevo, **0**. Tras la e2e completa (**16 de 17
  suites, 170 tests verdes**; la 17ª es `pasarela-oneclick`, que se saltea sola salvo
  `RUN_TRANSBANK_E2E=1`, y son sus 2 tests los que aparecen como skipped) las únicas cajas
  abiertas son las **2 virtuales** del seed —una por tenant, abiertas por diseño— y las 28
  físicas quedaron `cerrada`.

- [x] **Burndown de typecheck del frontend — COMPLETO (0 errores)** (frontend) — jul-2026
  Los 84 errores de vue-tsc estricto se quemaron por tandas. `typecheck-baseline.json`
  quedó vacío: el `typecheck:ratchet` ahora es un gate totalmente estricto (cualquier
  error nuevo bloquea CI). Todos los patrones y sus fixes solo-de-tipo quedaron en
  `anti-patterns.md` (`@click`→arrow inline; spread/índice guardado→`!`; `string|null`→prop
  con `?? undefined`/tipar form; mismatches Nuxt UI·reka; tipado de unit tests vitest).

---

## Limpiezas menores

- [x] ~~**Falta usuario semilla "supervisor `Cajas:Leer` no-admin" para e2e del ciego**~~ —
  cerrado 2026-07-28: el seed siembra `supervisor@paris.cl` con el rol `Cajas · Supervisión`
  (no fijo, `Cajas:Leer` y **nada más**; sin `MiCaja`, así que no opera ninguna caja propia).
  Es la combinación exacta contra la que se define el ciego —ve cajas ajenas y **no** es
  admin— y no existía: `admin.paris` hacía de "supervisor" pero es admin, y `vendedor.paris`
  no llega a una caja ajena.
  El e2e nuevo assevera lo que ningún mock podía: la sesión de la caja del cajero llega
  **no nula** con `saldoEsperado: null`. Esa aserción es la que separa "no ve el número
  porque es ciego" de "no ve el número porque no llega a la caja" — sin ella un 403 o una
  grilla vacía darían el mismo `null`. En la misma corrida, el admin sobre **el mismo
  cajón** sí ve el esperado, y se verifica que sea el número de verdad (inicial + los 3000
  que acaban de entrar), no un placeholder.
  Tres mutantes verificados, cada uno mata su parte: `esAdminTenant` siempre `true` (el
  supervisor recibe `13000.0000`), el controller que no pasa `esAdmin` (el **admin** queda
  ciego), y `cajonesEstado` sin la retención.
  ⚠️ **Lo que el mutante 2 destapó, y quedó arreglado:** al fallar el test, la caja del
  cajero quedaba abierta y **contaminaba la corrida siguiente** —el mutante 3 dio un falso
  resultado por eso—. El `afterAll` del describe nuevo ahora libera la caja pase lo que
  pase, verificado empíricamente: con el mutante puesto la corrida falla, y la siguiente
  sobre **la misma base** pasa. Es el patrón que [`pendientes.md`](pendientes.md) predice
  para las tres suites que siguen sin cerrarla.

- [x] ~~**`select-tenant.vue` tiene el mismo bug de truncado que se corrigió acá**~~ —
  cerrado 2026-07-29, **reabierto y refutado el mismo día**. Se creyó que
  `pages/select-tenant.vue:84` (`flex-1 truncate` sin `min-w-0`) tenía el mismo defecto que
  `31893f7` "arregló" en `AdvertenciasPrecio.vue`, y se agregó un gate estático
  (`scripts/check-design-tokens.mjs`) que marcaba el elemento hijo flex (`flex-1`,
  `flex-auto`, `basis-*`) **y** trunca en sí mismo, sin `min-w-0`.
  Medido después en navegador real (Chromium): la
  premisa era falsa. Por la spec de Flexbox §4.5, el mínimo automático de un ítem flex es
  **cero** cuando su propio `overflow` computado no es `visible` — y `truncate` incluye
  `overflow: hidden`. Un elemento que **es** el ítem flex y **lleva** `truncate` encima ya
  encoge solo; `min-w-0` ahí es redundante. Barrido pre-fix vs. post-fix de `31893f7`,
  idéntico fila por fila en 9 anchos de contenedor (360px→50px): el commit fue un no-op.
  El defecto real que motivó `31893f7` era *wrapping* vertical a cinco renglones, ya
  resuelto por el commit anterior (`ceba35f`) al introducir `truncate`.
  La forma que **sí** rompe es la opuesta a la que el gate vigilaba: `truncate` en un
  **descendiente** de un ítem flex/grid cuyo propio `overflow` es `visible` (`truncate`
  implica `white-space: nowrap`, así que el min-content del bloque es el ancho completo del
  texto, y el ítem se niega a encoger). Medido: desborda 370px sobre un contenedor de
  300px, con o sin `flex-1` en el wrapper.
  **Qué quedó en su lugar:** el gate estático se borró de `check-design-tokens.mjs` (no
  puede ver una relación ancestro/descendiente entre líneas distintas del template, solo
  detecta la forma segura). El `min-w-0` de `select-tenant.vue:84` se dejó — es inocuo,
  sacarlo es churn sin ganancia — pero **no era necesario**. La regla real (cuándo
  `min-w-0` hace falta y cuándo es ruido, con los números de la medición) quedó
  documentada en `docs/patterns/frontend.md` §16.

- [x] ~~**Cuatro hijos directos de un `.flex` que truncan sin `min-w-0` en ningún
  ancestro — candidatos a verificar, no bugs confirmados**~~ — cerrado 2026-07-29: los
  cuatro son **falsos positivos**. Medido en navegador real pisando el `textContent` con
  texto forzado (46 a 109 caracteres, según candidato) y leyendo `scrollWidth`/`clientWidth`
  del elemento, si el padre desbordó y si la página ganó scroll horizontal:
  - `app/components/caja/CajaAperturaGrid.vue:95` y `CajaCajonesGrid.vue:56` — el span
    que trunca recortó correctamente (`elScrollW`/`elClientW` 356/265 y 356/252); el padre
    no desbordó. Misma forma que `select-tenant.vue:84`: el elemento que trunca **es** el
    ítem flex, así que su propio `overflow: hidden` (parte de `truncate`) ya fija el
    mínimo automático en cero (Flexbox §4.5) — `min-w-0` ahí no aporta nada.
  - `CajaCajonesGrid.vue:71` — reproducción sintética fiel (mismo `[data-slot="body"]`
    real de la `UCard`) con texto de 109 caracteres: recortó (817/232), misma forma segura.
  - `app/layouts/dashboard.vue:184` — con texto de 82 caracteres no truncó porque **no
    tuvo que hacerlo**: el contenedor creció de 439px a 626px en vez de recortar. Ningún
    criterio pedido (recorte, desborde del padre, scroll horizontal de página) indica
    bug; mecanismo distinto a los otros tres (crecimiento del contenedor, no
    truncado-que-falla), anotado como nota aparte, no como bug.
  Ninguno se toca: no había nada que corregir. La regla real —cuándo `min-w-0` hace
  falta— quedó en `docs/patterns/frontend.md`.

---

## Harness / tooling (CodeGraph)

- [x] **Sync de CodeGraph en un git hook + niveles de búsqueda — HECHO** (harness) — jul-2026
  `.githooks/pre-push` corre `codegraph sync --quiet` (red de seguridad no-bloqueante:
  nunca frena el push, no-op si CodeGraph ausente; nunca `index`). Validado empíricamente:
  el daemon estaba caído y el índice tenía 44 archivos viejos; el sync los reconcilió en
  <1s. Niveles de búsqueda (`--max-files`: rápido=default / normal=3-5 / profundo=10+)
  documentados en el "Orden de búsqueda" de `CLAUDE.md`.

---

## Auditoría `ventas` + `pagos` (2026-07-27)

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

Salieron de la auditoría como reglas de negocio no documentadas. Se corrió una pasada de
investigación y el owner las decidió. Método, cruce contra el código y fuentes:
**`docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`**. La cuarta
—devolución por medio de pago y plazos— sigue abierta en
[`pendientes.md`](pendientes.md).

- [x] ~~**Acotar el dinero devuelto por una NC a lo cobrado EN EFECTIVO en esa venta**~~ —
  cerrado 2026-07-27. El tope es `Σ(efectivo aplicado a la venta) − Σ(ya devuelto en
  efectivo)`; excederlo da 422. Acota el **dinero, no el documento**: la NC sigue
  emitiéndose por el total (regla dura del SII). La pata de tarjeta ya existe en
  `pasarela` y no pasa por acá — componer ambas es el tema que sigue abierto en
  [`pendientes.md`](pendientes.md).
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

---

## Auditoría `caja` + `propinas` (2026-07-27)

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
  que **no** sea admin, y ese usuario no existía en el seed. Hoy lo cubren el unit del
  service y el del controller.
  ✅ **Cerrado el 2026-07-28**: el usuario existe (`supervisor@paris.cl`) y el e2e ejerce el
  caso — ver la entrada de Limpiezas menores en este mismo archivo.
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
  ⚠️ **La otra mitad quedó abierta y decidida** — el saldo en contra por una propina ya
  liquidada, en [`pendientes.md`](pendientes.md).

### Media

- [x] ~~**`garzonId` de participante manual no se resuelve contra el tenant**~~ — cerrado
  2026-07-27: el alta manual (`aplicarCambioParticipante`) y los pesos manuales de la config
  (`propina-distribucion.service.ts`) resuelven el garzón con
  `GarzonesService.obtenerActivoPorId(tenantId, garzonId)` antes de persistir — el mismo
  guard que ya usaba el cierre de mesa en ventas. `PropinasModule` importa ahora
  `GarzonesModule` (sin ciclo: no importa nada y ya lo usaban otros cuatro módulos).
  Detalle original: (backend,
  `propinas/liquidacion-propinas.service.ts:980`, `propinas/propina-distribucion.service.ts:193`)
  — se inserta `garzonId: cambio.garzonId` sin validar; el DTO solo pide `@IsUUID()`. Las
  entidades no tienen FK a `garzones`, así que tampoco hay backstop de integridad. El caso
  más probable no es el cross-tenant sino un **uuid inexistente**: entra como participante
  fantasma con `incluido: true` y diluye el reparto de todos. La defensa correcta ya existe:
  `GarzonesService.obtenerActivoPorId(tenantId, garzonId)`, del fix de ventas de jul-2026.
- [x] ~~**Excluir a un participante le deja el `monto` viejo persistido**~~ — cerrado
  2026-07-27: `redistribuirGrupo` devuelve los omitidos con `monto: '0.0000'` y
  `recalcularParticipantesExistentes` los persiste junto con los activos. Detalle original:
  (backend,
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
- [x] ~~**`etiquetasGarzones` no filtra `eliminado_el IS NULL`**~~ — cerrado 2026-07-27
  agregando el filtro, que es lo que manda la invariante de soft delete y lo que hacían ya
  sus tres queries hermanas del mismo archivo. El fallback `'Trabajador eliminado'` deja de
  ser código muerto y el test lo ejerce. Detalle original: (backend,
  `propinas/propina-reportes.service.ts:643-651`) — contra la invariante de soft delete y
  contra sus tres queries hermanas del mismo archivo, que sí filtran. La prueba de la
  intención: deja **inalcanzable** el fallback `'Trabajador eliminado'` (`:203`). **Al
  cerrarlo hay una decisión chica:** filtrar (y el fallback revive) **o** documentar la
  excepción deliberada, como ya se hizo con `metodos_pago` en `caja/caja.service.ts:322`,
  donde el nombre histórico es intrínseco al movimiento.
- [x] ~~**Un garzón en dos grupos revienta la liquidación con un 23505 crudo**~~ — cerrado
  2026-07-27 **con la salida acotada que decidió el owner**: no se cambió el modelo, se
  cambió el crash por un 400 accionable. `assertGarzonEnUnSoloGrupo` corre en los **cuatro**
  puntos de entrada; en crear, liquidar y **el preview** corta antes de escribir nada (así
  que se ve antes de intentar liquidar), y en `actualizarConfig` corre después de rehacer el
  snapshot, dentro de la misma transacción que revierte. El mensaje nombra a la persona, sus dos grupos, y
  la fecha de corte sugerida —el primer tip del rol que arrancó después—, de modo que
  liquidar hasta ahí deja cada rol en su propia liquidación sin tocar la configuración.
  ⚠️ **Queda abierto el cambio de modelo** (que la persona cobre en los dos grupos): es
  índice `(liquidacion_id, grupo_id, garzon_id)` **más** re-keyear los ajustes, que hoy se
  identifican solo por `garzonId` —excluir la sacaría de los dos grupos y un monto manual
  escribiría el mismo número en sus dos filas, rompiendo la conservación de ambos—. Toca
  DTO, service, composable, la página y la impresión por persona: medio día a un día, con
  la decisión de cómo se imprime adentro. Se encara si el caso aparece de verdad.
  ⚠️ **Dos precisiones que dejó la revisión independiente:** la fecha de corte sale solo de
  los tips, así que si la persona tiene una sesión del primer rol que se extiende más allá
  del corte, el conflicto reaparece en el segundo intento (vuelve a cortar con el mismo 400,
  no genera datos malos, pero un solo corte no alcanza y hay que acotar turnos). Y falta un
  test dedicado del conflicto por el camino de `actualizarConfig`: hoy solo se ejerce por
  `crear`, aunque ambos comparten la misma función.
  Detalle original: (backend + BD,
  `startup-pos.sql:1606`, `propinas/liquidacion-propinas.service.ts:1216-1236`) —
  `uq_liquidacion_propinas_participante_garzon` es único por `(liquidacion_id, garzon_id)`,
  **sin `grupo_id`**, y `buildParticipantesData` itera por grupo sin deduplicar. Un garzón
  reclasificado a mitad de período (`UpdateGarzonDto.tipo` es editable) genera tips con dos
  `tipo_garzon`, la liquidación arma dos participantes con el mismo `garzonId`, el segundo
  `INSERT` viola el índice y **nadie del período puede liquidarse**. Tensión con la doc: el
  motor documenta la pertenencia por el snapshot `tipo_garzon` del tip y no por
  `garzon.tipo`, lo que hace el caso alcanzable por diseño; el esquema no lo soporta.


### Baja

- [x] ~~**`registrarMovimientoEnTransaccion` no valida signo ni estado de la caja**~~ —
  cerrado 2026-07-27 en el eje del signo, con **dos** capas: el helper rechaza negativos con
  422, y `movimientos_caja` gana un `CHECK ("monto" >= 0)` declarado en la entidad (lo que
  `synchronize` crea) y replicado en el `.sql`. Ese CHECK cubre cualquier camino, presente o
  futuro, sin depender de que alguien se acuerde del guard.
  ⚠️ **Es `>= 0`, no `> 0`, y el primer intento fue `> 0`.** La revisión independiente lo
  bloqueó reproduciendo contra el backend real una venta legítima que devolvía 422: cuando
  un pago se devuelve **íntegro** como vuelto, su `montoNeto = monto − vuelto` da 0
  (`pagos.service.ts`), y el guard tumbaba la venta entera. El movimiento en cero no altera
  el esperado del arqueo y conserva la traza del pago. Hay un e2e con dos pagos en efectivo
  —uno devuelto entero— que lo fija, y el unit acepta 0 explícitamente.
  **Lección:** endurecer un límite exige enumerar quién lo produce hoy, no suponerlo. Mi
  texto original afirmaba que ningún caller producía `<= 0`: era cierto para negativos y
  falso para el cero, justo el vecino del bug que este mismo hilo venía a cerrar.
  El eje del **estado** queda como está a propósito: el patrón del módulo es "el caller toma
  `bloquearCajaAbierta` y el helper confía", y re-chequear acá sería una query extra por
  venta duplicando el lock que el llamador ya tiene. Detalle original: (backend,
  `caja/caja.service.ts:785-809`) — recibe un objeto plano y lo inserta tal cual: sin
  `@IsDecimalPositivo` (que solo cubre el camino HTTP vía `CrearMovimientoDto`) y sin
  verificar el estado. `startup-pos.sql:886` tampoco tiene `CHECK` sobre `monto`. Hoy **no
  es explotable**: sus dos llamadores (`ventas.service.ts`, `pagos.service.ts`) toman
  `bloquearCajaAbierta` antes y ya no producen montos negativos desde el fix del vuelto. Es
  endurecimiento del chokepoint por donde entró ese bug, no un bug activo. Cierra el hilo
  que la auditoría de ventas mandó acá: defendido en el endpoint, no en el método compartido.
- [x] ~~**`asegurarDefault` de propinas devuelve 500 en el primer uso concurrente**~~ —
  cerrado 2026-07-27: el 23505 se atrapa y se relee la config que ganó la carrera; cualquier
  otro error se propaga (hay un test por cada lado). Mismo patrón que `caja.abrir()`.
  Detalle original: (backend,
  `propinas/propina-distribucion.service.ts:68`) — el `lock: pessimistic_write` sobre una
  fila que **todavía no existe** no bloquea nada; dos requests insertan y el segundo viola
  `uq_propina_config_tenant` (`startup-pos.sql:1457`) sin `catch`. No corrompe (el índice
  hace su trabajo) y se cura tras el primer insert. El patrón correcto está tres módulos más
  allá, en `caja/caja.service.ts:241`.
- [x] ~~**El monto manual de propina no valida signo en el DTO**~~ — cerrado 2026-07-27:
  los dos campos usan `@IsDecimalNoNegativo()`, así que el negativo se rechaza con 400 en
  vez de llegar al `CHECK` de BD como 500 — y el **preview**, que no persiste y por eso no
  tocaba ese CHECK, deja de devolver una propina negativa. Detalle original: (backend,
  `propinas/dto/ajustes-reparto.dto.ts:14`, `propinas/dto/update-liquidacion.dto.ts:34`) —
  `@IsNumberString()` a secas acepta `'-5000'`; son los dos campos que quedaron fuera del
  barrido de signo de `74f3f35`. **No llega a persistir**: `chk_liquidacion_participante_metricas`
  (`startup-pos.sql:1595`) exige `monto >= 0`. Queda un 500 crudo donde correspondía un 400,
  y el **preview** (que no persiste) devolviendo una propina negativa en pantalla.
- [x] ~~**`crearFuentes` inserta fila por fila sobre un conjunto sin tope**~~ — cerrado
  2026-07-27 con un solo `save` del array. **Verificado empíricamente, como pedía esta
  entrada**: con `log_statement='all'` en Postgres, la suite e2e de propinas produce **dos**
  sentencias `INSERT INTO liquidacion_propinas_fuente` —una de 12 filas y otra de 3—, o sea
  un INSERT multi-fila por liquidación y no uno por tip. El test lo fija asserteando que
  hubo un único `save` y que recibió un array. Detalle original: (backend,
  `propinas/liquidacion-propinas.service.ts:1187-1195`) — dentro de la transacción de
  `liquidar()`, y `buscarTipsElegibles` no tiene `LIMIT`, así que N = ventas con propina del
  período. Al cerrarlo, **verificar de verdad** que `save(array)` colapsa a un INSERT
  multi-fila y no a N inserts igual.

### Huecos de test (el gate verde no los ve)

- [x] ~~**Eliminar la rama muerta `MANUAL`+`MONTOS` de `repartirGrupo`**~~ (backend,
  `propinas/liquidacion-propinas.service.ts`) — cerrado 2026-07-29: se borró. Los dos
  caminos se **verificaron leyendo el código antes de tocarlo**, no se tomaron de esta
  entrada: `redistribuirGrupo:1069` chequea el par por su cuenta y se queda con `delGrupo`
  sin llamar a `repartirGrupo`; y por `buildParticipantesData:1458` los borradores entran
  con `monto: '0.0000'` (fijado en `crearParticipanteData:1611`), así que devolverlos tal
  cual daba lo mismo que el camino normal —`pesoParticipante` no puntúa ese par, `sumaPesos`
  queda en 0 y el retorno temprano produce el mismo `'0.0000'`—.
  **Sin test, a propósito y documentado en el código:** la rama era inobservable, así que
  ningún test podía discriminarla; lo que sostiene el cambio son las 76 pruebas de
  `propinas` en verde y un comentario en el lugar donde estaba, para que no la reintroduzca
  quien lea el `if` de `redistribuirGrupo` y lo crea faltante acá.

- [x] ~~**El guard de estado de la caja no lo ejercita ningún test real**~~ — cerrado
  2026-07-27 con tres e2e: una caja **cerrada** y una **en conciliación** rechazan el
  movimiento, y una nota de crédito con devolución no puede sacar plata de una caja en
  conciliación.
  ⚠️ **El detalle que importa:** `registrarMovimiento` chequea el estado **dos veces** (el
  lock y un `findOne` posterior), así que relajar solo `bloquearCajaAbierta` queda tapado
  por el otro — lo comprobé y el mutante sobrevivía. El camino de la **nota de crédito** es
  donde ese lock está solo, y ahí el mutante de una sola capa sí mata el test. Es defensa en
  profundidad real, no debilidad del test, pero conviene saber cuál es el que discrimina.
  Detalle original: (test,
  `caja/caja.service.spec.ts:209`, `:460`, `:827`) — los tres mockean
  `managerMock.query.mockResolvedValueOnce([])` sin relación con el SQL emitido: el
  resultado lo decide el mock, no el `WHERE estado='abierta'`. Y `test/caja.e2e-spec.ts`
  nunca intenta escribir contra una caja `cerrada`/`en_conciliacion`. Relajar el filtro a
  `estado IN ('abierta','en_conciliacion')` no rompe nada. Es justamente la defensa que dos
  lentes dieron por buena leyendo el código.
- [x] ~~**El criterio `MANUAL` (`PESOS` y `MONTOS`) no tiene ningún test de reparto**~~ —
  cerrado 2026-07-27: `MANUAL/PESOS` reparte 3:1 por el peso configurado, y `MANUAL/MONTOS`
  se cubre por donde de verdad importa —**recalcular** una liquidación existente no pisa los
  montos fijados a mano—, no por el preview, donde los ajustes escriben el monto **después**
  del reparto y la rama es irrelevante.
  ⚠️ **La rama `MANUAL+MONTOS` de `repartirGrupo` es código muerto CONFIRMADO, y sigue sin
  test que la discrimine** — a propósito, porque no se puede escribir uno honesto. Está
  muerta por dos caminos: `redistribuirGrupo` tiene su **propio** chequeo de
  `MANUAL+MONTOS` que la saltea antes de llegar, y el único call site que sí la alcanza
  (`buildParticipantesData`) produce el mismo `'0.0000'` que daría el retorno temprano de
  "suma de pesos cero". Borrarla no cambia ningún resultado observable.
  Escribí un test que decía cubrirla y **no la cubría**: pasaba por el mecanismo genérico de
  `ajustes.montosManuales`, que pisa el monto para cualquier criterio después del reparto.
  Lo saqué en vez de dejarlo dando una falsa sensación de cobertura. **Cierre correcto:**
  eliminar la rama, no testearla. Detalle original: (test) —
  el único `criterio` ejercido en `liquidacion-propinas.service.spec.ts` y en el e2e es
  `PARTES_IGUALES`/`VENTAS_NETAS`. `validarManualMontos` se puede borrar entera sin que
  falle nada. (`propina-distribucion.service.spec.ts` sí prueba `MANUAL`, pero solo a nivel
  **config**, no de reparto.)
- [x] ~~**El test de partes iguales no discrimina `PARTES_IGUALES` de `CANTIDAD_CUENTAS`**~~
  — cerrado 2026-07-27 con un fixture **asimétrico** (un garzón cierra dos cuentas y el otro
  una), que es lo que separa las dos fórmulas: 75/75 contra 100/50. Tres mutantes cruzados
  verificados —que partes iguales devuelva cuentas, que cuentas devuelva 1, y que el peso
  manual se ignore— y cada uno mata su propio test. Detalle original:
  (test, `propinas/liquidacion-propinas.service.spec.ts:151-186`) — el fixture da
  exactamente 1 tip a cada garzón, así que `cuentas = 1` para ambos y las dos fórmulas dan
  `75.0000`/`75.0000`. `CANTIDAD_CUENTAS` no aparece en ningún test. Es el mismo error del
  test del vuelto (ver [`anti-patterns.md`](anti-patterns.md)): el escenario tiene que
  descartar las implementaciones incorrectas, no coincidir con ellas.
- [x] ~~**`actualizarConfig` no assertea `result.participantes`**~~ — cerrado 2026-07-27
  junto con el fix de conservación: su fixture tenía pool 150 y **cero tips**, un estado
  imposible, y ahora ejerce el reparto de verdad (VENTAS_NETAS sobre bases 1000 y 500 → 100
  y 50; con el criterio viejo daría 75/75). Detalle original: (test,
  `propinas/liquidacion-propinas.service.spec.ts:348-389`) — si `crearParticipantes`
  devolviera siempre `[]` el test sigue verde, porque el fixture monta `tips = []`.
- [x] ~~**El e2e de historial por `cajonId` no discrimina**~~ — cerrado 2026-07-27: ahora
  abre la caja el **cajero** y consulta el **supervisor**, que es para lo que existe la rama
  `cajonId && tieneVerTodas`. Antes consultaba el mismo usuario que había abierto, así que
  el filtro "solo mis cajas" daba idéntico resultado y borrar la rama no rompía nada.
  Detalle original: (test,
  `test/caja.e2e-spec.ts:331-339`) — quien consulta es el mismo usuario que abrió la caja,
  así que borrar la rama `cajonId && tieneVerTodas` (`caja/caja.service.ts:949`) sigue dando
  200 con array no vacío. Solo assertea `status` y `Array.isArray`.

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

### Refutados (no entran)

Hallazgos que **no** sobrevivieron a la refutación. Se conservan para que la próxima
pasada no los vuelva a reportar como nuevos.

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

---

## Refactor Caja → "Mi caja" / "Cajas"

Sub-proyectos entregados del brainstorm del 2026-07-23. Los poderes del encargado que
siguen diferidos están en `pendientes.md`.

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
  "Ocultar el resultado post-cierre" **sigue** diferido incluso después del sub-proyecto C
  (ver [investigación
  §6](investigaciones/2026-07-23-gestion-caja.md#6-poderes-del-encargado-sobre-la-caja-del-cajero-investigación-2026-07-23)),
  en [`pendientes.md`](pendientes.md).
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
  ítem sigue diferido en [`pendientes.md`](pendientes.md). Detalle:
  [`docs/features/gestion-cajas.md` § Cierre en dos fases](../features/gestion-cajas.md#cierre-en-dos-fases--motivos-de-diferencia-sub-proyecto-c).

## Auditoría `items` + `calculo-precios` (2026-07-28)

### Alta

- [x] ~~**Los grupos de un componente-combo se descuentan aunque el componente se haya
  omitido por falta de stock**~~ — cerrado 2026-07-28 (`items.service.ts`). Si un componente
  `receta` no bloqueante no alcanzaba el stock, el pre-chequeo hacía `continue` y lograba
  "cero escrituras" por él, pero después del loop `gruposComponentes` se armaba con **todo**
  `snapshot.componentes`: el combo se vendía sin la hamburguesa y la chuleta elegida para
  esa hamburguesa se descontaba igual. Ahora los componentes omitidos se registran en un
  `Set` y se filtran antes de llamar a `venderOpcionesGrupos`. **La regla la fijó el owner**
  ("se descuenta lo que se sirvió"), y el fix no la inventa: hace consistente una decisión
  que el código ya tomaba dos líneas antes. Cubierto por
  *"componente omitido por falta de stock → tampoco descuenta sus grupos de modificadores"*;
  mutante verificado (sin el filtro, `venderOpcionesGrupos` se llama 2 veces en vez de 1).
- [x] ~~**Vender un extra cuyo catálogo cambió tras congelar el snapshot descuenta 1000× de
  más**~~ — cerrado 2026-07-28 (`items.service.ts`). El fallback
  `cat?.ingredienteUnidadMedida ?? extra.unidadCodigo` sustituía la unidad **de stock** por
  la de la **porción** cuando el extra ya no estaba en `receta_extras_permitidos`, y
  `convertirUnidad` terminaba convirtiendo una unidad a sí misma: 20 g de queso descontados
  como 20 kg. La unidad de stock ahora se resuelve por id contra `items`+`item_producto`,
  que es donde vive, en vez de contra la lista de extras de la receta — eso saca la causa,
  no el síntoma. Si el ingrediente ya no existe en el catálogo, **no se descuenta y se
  advierte** — no se mueve stock de un ítem borrado, mismo criterio que ya usaba
  `venderOpcionesGrupos` con una opción borrada, más la advertencia que aquel no emite.
  **Lo que cubre cada test, sin inflar el recibo** (corregido por la revisión independiente,
  que refutó la primera versión de este párrafo): los **dos unit** son los que discriminan
  fix de pre-fix — uno fija que la búsqueda va por id de ingrediente y tenant en vez de por
  la receta, el otro cubre la rama del ingrediente ausente; los dos con mutante verificado.
  El **e2e nuevo** (`recetas.e2e-spec.ts` §7) **no** distingue el fix del código anterior:
  su extra sigue en la carta, así que la búsqueda vieja también encontraba `kg` y el
  resultado era idéntico. Lo que aporta es real pero es otra cosa: ejecuta el SQL nuevo
  contra Postgres —ningún e2e tocaba `extras`, así que la query no se había ejecutado nunca—
  y deja fija la conversión g→kg.
  **Y el escenario del hallazgo original no es alcanzable hoy.** La auditoría supuso que el
  flujo de Salones cobraba con el snapshot congelado; no lo hace: `cerrarCuenta`
  (`salones.service.ts:653-720`) lo mapea de vuelta a **solo ids** y `ventas.service.ts`
  lo **re-resuelve** contra el catálogo vivo en la misma transacción que descuenta, así que
  un extra fuera de carta muere en el mismo `400` que por `POST /ventas`
  (`items.service.ts:1937`). O sea que este fix es **corrección y defensa en profundidad**,
  no el cierre de un agujero explotable.
  **La invariante que en realidad sostiene esto —y que no estaba escrita en ningún lado—**
  es que *todo snapshot se re-resuelve en la misma transacción que descuenta stock*. El día
  que alguien persista un snapshot y lo reutilice sin re-resolver (que es, conceptualmente,
  para lo que un snapshot existe), este bug y su hermano del combo se vuelven reales. Queda
  registrada acá porque es el supuesto del que cuelgan los dos fixes.

### Alta (continuación)

- [x] ~~**El motor de precios resuelve cada línea con el `findOne` pesado**~~ — cerrado
  2026-07-28. Era el hilo que la pasada de `ventas` dejó anotado, y sobrevivía **del lado
  del precio**: `cargarBasePorIds` había resuelto la persistencia de la venta, no el
  cálculo. Cierre: `ItemsService.cargarReglasPorIds` —una query con `UNION ALL` sobre las
  tres tablas puente— acompaña a `cargarBasePorIds`, y `calcular()` carga el carrito
  entero en **2 queries fijas** antes del loop en vez de 4+ por línea. `resolverLinea`
  dejó de ser `async`: ya no hace I/O. Beneficia **en la capa de precio** a los tres
  llamadores (`ventas`, `suscripciones`, `online`) — pero no cierra el request entero:
  el checkout online sigue con su propio `findOne` por línea antes de llamar al motor,
  anotado como entrada propia en [`pendientes.md`](pendientes.md) para no perderle el
  rastro al cerrar esta.
  **Lo que hizo falta decidir y no se decidió acá:** el orden de las reglas cambia el total
  en modo `compuesto`, y no estaba definido en ninguna query. El `ORDER BY` nuevo lo vuelve
  determinista por id; qué orden *debería* tener quedó abierto como decisión de negocio en
  [`pendientes.md`](pendientes.md), con el insumo de mercado que aportó el owner.
  ⚠️ **Corregido por la revisión independiente, que bloqueó el cierre:** la primera versión
  de este párrafo afirmaba que el `ORDER BY` *reproducía* el orden previo y que por lo tanto
  batchear no podía mover ningún total. **Es falso, y se verificó con `EXPLAIN`:** estas
  tablas resuelven con `Bitmap Heap Scan`, que reordena por página del heap, así que las
  queries por ítem devolvían orden de **inserción**, no de índice. El cambio sí puede dar un
  total distinto en un tenant `compuesto` que mezcle `monto_fijo` con porcentaje en un mismo
  ítem. Que hoy no exista ninguno (ambos tenants del seed en `base`, ningún ítem con dos
  reglas de la misma clase, sin datos productivos) es lo que lo vuelve inocuo — **no** la
  garantía que se había escrito. La lección es la misma de
  [`anti-patterns.md`](anti-patterns.md): una afirmación deducida ("la PK es compuesta,
  luego el orden es el del índice") no es una afirmación verificada.
  **Tests, con mutante verificado cada uno:** uno fija que N líneas producen un número
  **constante** de cargas (el mutante que vuelve a cargar por línea lo mata), otro cubre el
  agrupado de las tres clases en `cargarReglasPorIds`. Y se comprobó **empíricamente que el
  e2e ejecuta la query nueva**, en vez de asumirlo: con la clase de impuesto mal etiquetada,
  `ventas.e2e-spec.ts` pasa de 26 verdes a 15 fallos.
- [x] ~~**La resolución de recargos por id nunca corre con datos**~~ — cerrado 2026-07-28,
  junto con el batch de arriba. El fixture fijaba `recargosIds: []` en los 9 tests, así que
  un mutante que le pasara el mapa de descuentos sobrevivía. Al reescribir el fixture para
  los dos loaders nuevos, dejar la tercera lista sin ejercer habría repetido el mismo hueco
  sobre código recién escrito. Hay un test con un recargo real y el mutante muere. Queda
  abierta la mitad de `ventas.service.spec.ts` (otro archivo, otro alcance).
- [x] ~~**`online.service.ts` sigue con un `findOne` por línea en el checkout**~~ — cerrado
  2026-07-28, resto del N+1 del motor de precios. `prepararLineasCheckout` iteraba
  `dto.lineas` llamando al `findOne` pesado para leer **solo** `tipo` y `unidadMedida`;
  ahora una sola `cargarBasePorIds` para todo el carrito, que ya trae los dos campos y
  lanza el mismo 404. Las validaciones por línea (`assertPresentacionPareada`) se movieron
  **antes** de la carga, para no repetir el cambio de precedencia 400↔404 que la revisión
  independiente había marcado en el fix hermano.
  Lo fija un test con mutante verificado (volver a cargar por línea sube el contador de 1
  a 3). **Sin SQL nuevo**: reutiliza un método que el e2e de ventas ya ejecuta contra
  Postgres — distinto del caso de los extras, donde la query era nueva y hubo que probarla.
  ⚠️ **Hueco de cobertura preexistente, que este fix no cierra:** ningún e2e toca el
  checkout online. Lo cubierto acá es unit.

### Media / Baja — los tres N+1 restantes de la pasada

- [x] ~~**`findOne` de una receta con 5 grupos son 6 queries**~~ — cerrado 2026-07-28: los
  grupos del propio ítem salen de `cargarGruposPorItem`, la función batcheada que ya vivía
  en el mismo archivo y que `findOne` **ya usaba** para los componentes de un combo. 2
  queries fijas en vez de 1 + N, y ~60 líneas menos de duplicación. La discriminación quedó
  demostrada al revés y sirve igual: la aserción que fijaba los parámetros de la query por
  grupo (`['grupo-1', TENANT, 'item-grupo-1']`) **falló** contra la implementación nueva
  (`[['item-grupo-1'], TENANT]`). El test ahora fija esos params batcheados y el total de
  queries.
- [x] ~~**`aplicarDesfases`/`descartarDesfases` hacen 3-4 queries por receta**~~ — cerrado
  2026-07-28. Resultó **peor que lo reportado**: además de las 2 lecturas por receta, el
  costo propuesto llamaba `convertirUnidad` **una vez por ingrediente** — un N+1 anidado, y
  con `convertirUnidades` ya escrito al lado para exactamente esto. Ahora son 2 lecturas
  para todo el lote + 1 carga de unidades para todos los ingredientes de todas las recetas.
  **Beneficia también al camino de lectura**: `listarDesfases` compartía el mismo helper y
  tenía el mismo N+1 anidado. Los `UPDATE` siguen siendo N — son escrituras de N filas, no
  un N+1.
  **El loop por receta se conservó a propósito**, para que el orden en que fallan las
  validaciones no cambie: si la receta B no existe y la A no tiene ingredientes, sigue
  ganando el error de A. Es la precedencia 400↔404 que la revisión independiente ya había
  marcado dos veces ese día. ⚠️ **La primera versión no lo lograba y la revisión lo
  bloqueó:** el cálculo del costo corría *antes* del loop y **también lanza** (unidad no
  reconocida, magnitudes incompatibles), así que adelantaba ese 400 por encima del 404.
  Cerrado con `CatalogService.crearConversor()`: el catálogo se carga una vez —una lectura
  que no lanza— y la conversión vuelve a ocurrir dentro del loop, en su punto original.
  Mutante verificado: crear el conversor dentro del loop en vez de afuera sube
  `crearConversor` de 1 a N.
- [x] ~~**Las tres `validarY…` hacen un `SELECT` por fila del payload**~~ — cerrado
  2026-07-28 con `filasValidacionPorIds`: una query para todos los ids del payload,
  compartida por ingredientes, componentes y extras. Los tres loops quedan intactos, así que
  ninguna validación cambia de orden (la carga no lanza).
  ⚠️ **Lo que el fix destapó en los tests:** al pasar a un lookup por id, varios tests de
  **rechazo** empezaron a pasar por la razón equivocada — su fila mockeada no traía
  `item_id`, así que el lookup no la encontraba y el error saltaba antes de evaluar el tipo
  o el modo de inventario. Se corrigieron esos mocks además de los que fallaban.
  Dos mutantes, cada uno en el nivel que le corresponde: cargar por fila hace que el unit
  cuente 2 SELECT en vez de 1; truncar el lote al primer id no lo ve el unit (el mock ignora
  los parámetros) pero **rompe 6 tests de `recetas`/`combos` e2e** contra Postgres real.
  ⚠️ **Segundo bloqueo de la revisión, también correcto:** la primera versión dejaba el
  `convertirUnidad` por fila de `validarYCostearIngredientes` y `validarExtrasPermitidos`,
  argumentando que batchearlo cambiaría el orden en que fallan dos 400 distintos. Era una
  excusa: ese argumento solo refuta la variante de resolver todas las conversiones antes
  del loop. La tercera variante —cargar el catálogo una vez y convertir en memoria **en el
  mismo punto del loop**— no mueve ningún error, y la pieza pura para hacerlo
  (`convertirConMapa`) ya existía sin exponer. Se agregó `CatalogService.crearConversor()`
  y los dos loops quedaron sin query por iteración.
  El costo por fila **no se había eliminado, se había cambiado de tabla**: el pendiente
  hablaba de 15 `SELECT` para 15 ingredientes, y tras el primer intento eran 1 batch + 15
  lecturas de `unidades_medida`.

### Media / Baja — cerrados el 2026-07-29

- [x] ~~**Un `itemId` en mayúsculas devuelve 404 desde que se batchea**~~ (backend,
  `items.service.ts`) — cerrado 2026-07-29 en un solo lugar, como decía la entrada, pero
  **el alcance que proponía era insuficiente y habría dejado algo peor que el 404**:
  normalizar solo `cargarBasePorIds` encuentra la fila base y deja pasar la línea, pero
  `cargarReglasPorIds` sigue sin match y sus llamadores hacen `?? []` — o sea el ítem se
  cobra **sin sus impuestos ni descuentos, en silencio**. El alias se aplica a los dos mapas
  (`aliasarCasingDeIds`): se consulta y compara en minúsculas, y el mapa queda indexado
  también por la forma que mandó el cliente, así que el `get(linea.itemId)` de los tres
  llamadores (venta, `/calculo-precios/calcular`, checkout online) sigue sirviendo con
  cualquier casing sin normalizar en cada uno.
  Lo fija un e2e que **compara el cálculo en mayúsculas contra el mismo en minúsculas** en
  vez de contra números escritos a mano, con `totalImpuestos > 0` como diente: sin eso, dos
  cálculos igualmente vacíos pasarían el `toEqual`. RED verificado (404 antes del fix) y
  **mutante del segundo mapa verificado**: sin el alias en `cargarReglasPorIds` el mismo
  ítem da `5000` en vez de `5950` —el IVA perdido—, que es exactamente el modo de falla que
  el fix a medias habría introducido.
- [x] ~~**Ingrediente o extra duplicado en una receta devuelve 500, no 400**~~ (backend,
  `items.service.ts`) — cerrado 2026-07-29. El chequeo con `Set` que solo tenía
  `validarYCostearComponentes` pasó a un `assertSinIdsRepetidos` compartido por las tres
  (componentes de combo, ingredientes y extras de receta), que es el **tercer** uso y por eso
  se extrajo en vez de duplicar. Va antes de la primera query en las tres.
  ℹ️ **Cambio de precedencia, deliberado:** el chequeo es en memoria y ahora precede a las
  validaciones por fila, así que un payload con un duplicado **y** una cantidad inválida
  reporta el duplicado. Los dos son 400 accionables, y es la precedencia que el gemelo de
  combos ya tenía.
  Dos tests RED verificados: antes del fix ambos llegaban a `filasValidacionPorIds` (el
  síntoma exacto de "consultó la BD"), y el del gemelo de combos sigue verde a través del
  helper compartido.

### Decidido por el owner y ya implementado

- [x] ~~**¿El descuento debe tener piso en cero?**~~ — **sí**, decidido por el owner el
  2026-07-28 ("si el piso no es 0, terminaría pagando el tenant") e implementado el mismo
  día en `calculo-precios.engine.ts`. Tres precisiones que no estaban en la pregunta y
  hacen a la regla:
  - **Se topea regla por regla, al aplicarla**, no al final sobre el total. Es lo único que
    mantiene coherente el comprobante: topear al final dejaría la traza diciendo "500" con
    un total que solo bajó 100, y `subtotal − descuentos` dejaría de dar el total. Con tres
    descuentos del 40% en modo `base` sobre 100, la traza queda 40 / 40 / 20.
  - **Aplica también a los descuentos a nivel venta.** Sin eso el agujero se mudaba: tres
    líneas con piso propio y un descuento de venta que hunde el total igual.
    ⚠️ **La primera versión lo afirmaba y no lo cumplía; la revisión independiente bloqueó
    el cierre.** El tope de venta medía contra el **neto agregado** en vez del total real
    (`Σ totalLinea`, que ya trae descuentos e impuestos de línea). Con una línea de 1000,
    90% de descuento propio e IVA, un descuento de venta de 500 dejaba `totalFinal: -381`
    **y `advertencias: []`** — el bug exacto que la tarea venía a cerrar, ahora con el
    agravante de estar documentado como resuelto. Y en el sentido inverso recortaba
    descuentos sanos: 1190 de total menos un cupón de 1100 daba 190 en vez de 90, cobrando
    100 de más con un aviso que afirmaba un motivo falso.
    **Por qué no lo vi:** mi test usaba una línea sin descuentos ni impuestos, donde
    `subtotalNeto == totalFinal` — el único escenario en que las dos magnitudes coinciden y
    el bug es invisible. Tercera vez en el día que un test pasa por la razón equivocada.
    Cerrado separando `disponible` (la plata sobre la que se topea) de `acc` (la base de
    los `%`), con dos tests que reproducen los dos sentidos y dos mutantes verificados.
  - **No frena la venta**, decisión explícita del owner entre topear en silencio, rechazar
    con 400 y topear avisando: emite advertencia, igual que un ingrediente no bloqueante sin
    stock. Viaja al POS por el canal que ya existía.
  - **Ninguna regla aporta una magnitud negativa**, invariante que hizo falta agregar tras
    el **segundo bloqueo**: al desacoplar la plata de la base de los `%`, el acumulado de
    venta quedó sin piso, y un `compuesto` sobre esa base negativa devolvía un "recargo" de
    `-19.00` que **restaba** —total negativo otra vez, y sin advertencia— o un segundo
    descuento negativo que le cobraba al cliente. Ambos se imprimían así en la traza. El
    revisor lo encontró con un fuzz de 40.000 ventas de configuración válida: 0,78%. No era
    regresión contra `HEAD`, pero la doc volvía a certificar cerrado un agujero abierto.
  Los recargos no tienen **tope superior** (subir el total no es el problema que el piso
  resuelve), pero sí el piso en cero: un recargo nunca resta.
  Nueve tests en el motor puro y tres mutantes verificados. La identidad del comprobante
  (`subtotal − descuentos + recargos + impuestos == totalFinal`) se verificó con un fuzz de
  60.000 ventas sobre las 4 órdenes de fórmula, `base`/`compuesto`, 3 escalas y los 4 modos
  de redondeo: 0 fallos.
- [x] ~~**¿`remove()` debe bloquear el borrado de un ingrediente usado solo como
  extra?**~~ — **no bloquea, advierte con confirmación informada**, decidido por el
  owner e implementado el 2026-07-28. Ser extra es opcional por definición — sin él la
  receta sigue completa — a diferencia de ser ingrediente fijo, componente de combo u
  opción de grupo, que sí bloquean porque dejan la composición incompleta.
  `GET /items/:id/uso` (guard `Items:Eliminar`) devuelve los cuatro usos ya
  clasificados en una sola query `UNION`: `{ bloqueos: [{tipo, nombre}], advertencias:
  [{tipo:'extra', nombre}] }`. `remove()` reusa esa misma query dentro de su
  transacción para decidir si bloquea, y al confirmar marca `eliminado_el` en las
  filas de `receta_extras_permitidos` del ingrediente en la misma transacción que el
  soft-delete del item. El modal de Configuración → Items la consulta antes de
  abrirse: con bloqueos muestra "No se puede eliminar" + motivos y solo "Entendido";
  con solo advertencias nombra las recetas y deja confirmar; sin usos, el texto
  genérico de siempre. Detalle y regla de negocio:
  [`recetas.md`](../features/recetas.md#delete-itemsid).
  ⚠️ **Corrige una afirmación falsa del ítem original.** Decía que este hueco era "la
  condición habilitante del bug de conversión de unidad" de la sección Alta de esta
  misma auditoría. Es falso desde `51df04c` (el cierre de los tres N+1 restantes de
  `items`): las dos lecturas de extras del catálogo —
  `obtenerExtrasPermitidos` (`items.service.ts:1875`), que corre dentro de la
  transacción de venta al resolver la personalización, y el `findOne` de receta
  (`items.service.ts:577`), que alimenta el detalle del item y el drawer de
  personalización, no la transacción de venta — hacen ambas `JOIN items i ON
  i.item_id = re.ingrediente_item_id AND i.eliminado_el IS NULL` (misma condición en
  ambas, distinto momento en que corre). Un ingrediente borrado
  desaparece del `JOIN`, así que el extra queda **ausente** del catálogo de extras de
  la receta, no con una unidad de medida equivocada: vender ese extra da
  `400 'Extra no permitido para esta receta'` (`items.service.ts:1937`), el mismo
  error que un extra sacado de la carta por cualquier otro motivo — verificado leyendo
  ambas queries antes de escribir esta entrada, no asumido del texto original. El bug
  de conversión de unidad real (fallback de unidad de porción vs. unidad de stock) ya
  está cerrado y documentado en su propia entrada, arriba en esta misma sección de
  auditoría ("Vender un extra cuyo catálogo cambió tras congelar el snapshot descuenta
  1000× de más").
- [x] ~~**`advertenciasReceta` de la venta ya no son solo de receta**~~ — cerrado
  2026-07-28, rename mecánico sin cambio de forma (sigue siendo `string[]` plano).
  `ventas.service.ts` renombra la variable local y la propiedad de la respuesta a
  `advertencias`; tocó las 21 referencias esperadas en 7 archivos (`ventas.service.ts`,
  `ventas.service.spec.ts`, las cuatro suites e2e de `combos`/`recetas`/
  `grupos-modificadores`/`grupos-modificadores-overrides`, y `pos.vue`).
  El rename destapó un shadowing que no estaba en el plan: dentro del `for` de
  movimientos de inventario, los bloques `receta` y `combo` ya declaraban su propio
  `const advertencias` local antes de acumular al array externo — con el externo
  renombrado igual, `advertencias.push(...advertencias)` habría hecho que el array se
  duplicara a sí mismo en vez de sumar los avisos de receta/combo, silencioso porque
  compila y tipa igual. Se renombraron esos dos locales a `advertenciasIngrediente` y
  `advertenciasComponente` para que el externo pueda ocupar `advertencias` sin
  colisión; misma lógica, ningún cambio de comportamiento.
  El riesgo real de un rename de campo no es el gate en rojo: es que el frontend siga
  leyendo el nombre viejo, reciba `undefined`, y el `?? []` de `pos.vue` lo convierta en
  lista vacía sin que ningún test lo note — se verificó con grep de cero resultados
  sobre todo el repo (backend, frontend, docs) después del cambio, no solo con las
  cuatro suites e2e en verde.
- [x] ~~**Las advertencias del motor de precios llegan a un solo consumidor**~~ —
  cerrado **parcialmente** 2026-07-28: el motor gana `ResultadoVenta.advertenciasVenta`
  (solo las advertencias de descuentos a nivel venta, que no pertenecen a ninguna línea),
  sin tocar `advertencias`, que sigue siendo el aplanado de línea + venta. Los tres
  carritos (POS `CarritoPanel.vue`, Salones `salones/index.vue`, Tienda
  `CarritoOnline.vue`) dibujan ambas granularidades con el componente compartido nuevo
  `components/AdvertenciasPrecio.vue`: por línea con `resultado.lineas[index].advertencias`
  (cruce por índice, nunca por `itemId` — el mismo ítem puede repetirse en dos líneas con
  personalizaciones distintas) y junto al total con `resultado.advertenciasVenta`.
  `useCalculoPrecios.ts` incorpora los dos campos al tipo. El seed suma el tipo de regla
  `directo` ("Descuento directo") y el descuento `monto_fijo` "Promo fija $5.000" —ningún
  descuento sembrado antes ejercitaba la rama plana del motor—, más el primer e2e de
  `POST /calculo-precios/calcular`, que confirma que las dos granularidades no se
  mezclan entre sí.
  ⚠️ **Lo que sigue abierto, a propósito no cerrado acá:** `online.service.ts` y
  `suscripciones.service.ts` siguen descartando `resultado.advertencias` al crear el
  pedido/la suscripción, y `pasarela.vue` no lee el campo — ver la entrada viva en
  [`pendientes.md`](pendientes.md). Y `advertenciasVenta` es hoy superficie sin UI: ningún
  archivo de `frontend/app` arma `descuentosVentaIds`/`recargosVentaIds`, así que el render
  junto al total está construido y correcto pero queda inerte hasta que exista esa pantalla
  — detalle en [`motor-calculo-precios.md`](../features/motor-calculo-precios.md).

## Revisión final `borrado-ingrediente-extra` (2026-07-28)

- [x] ~~**El modal de confirmación nunca nombra el item que se va a borrar**~~ (frontend,
  `configuracion/items.vue`) — cerrado 2026-07-29: los tres mensajes nombran el item
  (bloqueado, con extras y confirmación normal). El nombre se fija y se limpia **siempre
  junto con `confirmDeleteId`** en vez de buscarse en la lista por id: así no puede quedar
  mostrando otra fila si la lista se refiltra o se pagina con el modal abierto.
  `confirmarEliminar` pasó a recibir el `Item` completo en lugar del id, que es lo que
  `menuAcciones` ya tenía a mano.
  Verificado en navegador real (el proyecto no testea páginas, así que build/typecheck no
  ven esto): rama bloqueada → `El item "Papas fritas" está en uso y no se puede eliminar:`
  con su viñeta "Es componente de Combo Especial"; rama normal → `¿Estás seguro de que
  deseas eliminar "Producto demo (unidad · CLP)"?`.
- [x] ~~**`:disabled="!!verificandoEliminarId"` es global en `items.vue`**~~ (frontend) —
  cerrado 2026-07-29: el `disabled` quedó acotado a la fila en verificación
  (`verificandoEliminarId === row.original.id`), la misma condición que su `:loading`.
  Antes, verificar el uso de un item deshabilitaba el menú de **todas** las demás filas,
  incluidas acciones que no tienen nada que ver (ajustar stock, historial).
  ℹ️ **Lo que esto deja como contrapartida chica:** durante la verificación en vuelo, un
  click en "Eliminar" de otra fila es ahora un no-op silencioso (el guard de reentrancia de
  `confirmarEliminar` lo corta) en vez de un botón visiblemente deshabilitado. Se acepta: la
  ventana es la de un request y el precio anterior era bloquear toda la tabla.
  ⚠️ **Este cambio afloja una de las dos capas que cubrían la carrera de "se borra el item
  equivocado"**, así que se verificó con el escenario obligatorio de dos entidades solapadas
  (el que un smoke de un item por vez no ve): con la respuesta de `/uso` demorada 5 s a
  propósito, click en "Eliminar" de la fila A y después en la de B **con A en vuelo**. Se
  disparó **un solo** request —el de A— y el modal abrió nombrando **A**, no B. El guard de
  reentrancia es el que sostiene la invariante; el `disabled` global era redundante.
  Técnica, por si hay que repetirlo: `navigate_page` con un `initScript` que envuelve
  `window.fetch` y demora las URLs que matchean `/uso`.
