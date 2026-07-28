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
