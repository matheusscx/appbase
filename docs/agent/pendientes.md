# Pendientes — a corregir al terminar el harness

Backlog de correcciones que se **difirieron a propósito** mientras trabajamos en el
harness, para no mezclar el meta-trabajo (reglas, gates, docs) con cambios de código de
producto. Cada entrada dice qué, dónde, por qué se difirió y cómo se cierra.

Regla de este archivo: **acá solo vive lo que falta hacer.** Cuando una entrada se cierra,
en el mismo commit se muda —con el texto de su cierre— a
[`resueltos.md`](resueltos.md). Nada de `[x]` acumulándose: una lista de trabajo con más
entradas tachadas que vivas deja de leerse. No es un TODO genérico: solo va lo que ya
identificamos con ubicación concreta.

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

Pasada de 7 lentes según `docs/agent/auditoria-codigo.md`: 20 hallazgos crudos → 15
confirmados tras refutación. **Los 14 que ya se cerraron están en
[`resueltos.md`](resueltos.md)** con el detalle de cada fix; acá quedan los tres que no.

- [ ] **Otros tres `LEFT JOIN garzones` sin filtro de `tenant_id`** (backend,
  `turnos/sesiones-garzon.service.ts:181` y `:239`, `salones/cuenta-asignaciones.service.ts:131`
  y `:133`) — mismo patrón que el JOIN de `garzones` de ventas ya cerrado
  ([`resueltos.md`](resueltos.md)): la tabla principal filtra por tenant
  y la unida solo por `eliminado_el`. Hoy **no son explotables por sí solos** (el
  `garzon_id` de esas filas se escribe por caminos tenant-scoped), pero son la misma
  defensa faltante y quedan a un bug de distancia de convertirse en fuga. Fuera del
  alcance auditado (`ventas`+`pagos`); entran cuando se audite `turnos` y `salones`.
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
- [ ] **Otros 14 `.vue`/composables arman el mensaje de error a mano** (frontend,
  `components/caja/*` ×5, `components/configuracion/*` ×2, `composables/usePaginatedList`,
  `useTarjetas`, `useUserPreferences`, `pages/tienda/*` ×3, `pages/ventas/index.vue`,
  `pages/pagos/index.vue`) — mismo patrón que se acaba de cerrar en ventas/pagos: tipan
  `data.message` como `string` y el `ValidationPipe` global devuelve `string[]` en errores
  de validación, así que el toast muestra el array interpolado. Degrada, no rompe. Quedan
  fuera porque no son del alcance auditado (`ventas`+`pagos`); es un barrido de una línea
  por archivo usando `apiErrorMsg`, que ya existe y está testeado.

### Decidido por el owner tras investigación de mercado (2026-07-27)

Cuatro decisiones de owner sobre reglas de negocio no documentadas; tres ya se
implementaron ([`resueltos.md`](resueltos.md)). Método, cruce contra el código y fuentes:
**`docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`**. Lo que queda es
**trabajo pendiente con la forma ya definida**, no una pregunta abierta.

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

## Auditoría `caja` + `propinas` (2026-07-27) — hallazgos confirmados

Pasada de 8 lentes según [`auditoria-codigo.md`](auditoria-codigo.md): 25 hallazgos crudos →
22 únicos (3 los vieron dos lentes por separado) → **20 sobreviven** tras refutación.
**Los 20 se cerraron el 2026-07-27**; el detalle de cada fix, con sus mutantes, está en
[`resueltos.md`](resueltos.md). Acá queda lo que esos cierres dejaron abierto: la mitad de
la reconciliación de propinas que exige spec propia, un hallazgo que trajo la revisión
independiente, y las ramas que ningún test toca.

### Huecos de test

- [ ] **Eliminar la rama muerta `MANUAL`+`MONTOS` de `repartirGrupo`** (backend,
  `propinas/liquidacion-propinas.service.ts`) — código muerto **confirmado por dos
  caminos**: `redistribuirGrupo` tiene su propio chequeo de `MANUAL`+`MONTOS` que la
  saltea antes de llegar, y el único call site que sí la alcanza (`buildParticipantesData`)
  produce el mismo `'0.0000'` que daría el retorno temprano de "suma de pesos cero".
  Borrarla no cambia ningún resultado observable, y por eso **no se puede escribir un test
  honesto que la discrimine**: el cierre correcto es sacarla, no cubrirla. Quedó fuera del
  batch de huecos de test del 2026-07-27 porque es un cambio de producción, no de tests
  (contexto completo en [`resueltos.md`](resueltos.md)).

**Ramas sin cobertura alguna**, para decidir si entran: `HORAS_TRABAJADAS`;
`advertenciasSesionesAbiertas` con `fin_el = null`; las guardas `fechaHasta <= fechaDesde`,
`gruposConfig.length === 0` y moneda oficial ausente; `aplicarCambioParticipante` (alta
manual); `actualizar` con `recalcular: false`; los endpoints HTTP `confirmar`/`anular`;
el rechazo de `peso <= 0` en `MANUAL/PESOS`; el spillover de propina entre pagos en
`asignacion-propina.ts`; toda la capa SQL de `propina-reportes` (cero e2e);
`registrarMovimientoEnTransaccion`; el backstop 23505 de `abrir()`; y el aislamiento
multi-tenant de caja.

### Decidido por el owner (2026-07-27)

- [ ] **Una persona cobrando en dos grupos de la misma liquidación** (backend + frontend,
  tema propio) — hoy el conflicto se corta con un 400 accionable que sugiere la fecha de
  corte (cerrado el 2026-07-27, ver [`resueltos.md`](resueltos.md)); **soportarlo de
  verdad es un cambio de modelo** que el owner difirió hasta que el caso aparezca:
  índice `(liquidacion_id, grupo_id, garzon_id)` **más** re-keyear los ajustes, que hoy se
  identifican solo por `garzonId` —excluir la sacaría de los dos grupos, y un monto manual
  escribiría el mismo número en sus dos filas rompiendo la conservación de ambos—. Toca
  DTO, service, composable, la página y la impresión por persona: **medio día a un día**,
  con la decisión de cómo se imprime adentro.
  Dos cosas chicas que quedaron de la salida acotada: la fecha de corte sugerida sale solo
  de los tips, así que una sesión del primer rol que se extienda más allá del corte hace
  reaparecer el conflicto en el segundo intento (vuelve a cortar con el mismo 400, no
  genera datos malos, pero un corte no alcanza y hay que acotar turnos); y falta un test
  dedicado del conflicto por el camino de `actualizarConfig` —hoy solo se ejerce por
  `crear`, aunque ambos comparten la misma función.
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
  liquidaciones **futuras**— ya está cerrada ([`resueltos.md`](resueltos.md)).

## Auditoría `items` + `calculo-precios` (2026-07-28) — hallazgos confirmados

Pasada de 8 lentes según [`auditoria-codigo.md`](auditoria-codigo.md): 21 hallazgos crudos
→ **21 sobreviven, ninguno se cayó entero**. El trabajo del refutador fue el documentado:
**6 bajaron de severidad**, 2 se reclasificaron como decisión de owner, y tres afirmaciones
perdieron la mitad que no aguantaba (ver cada entrada). Se suma 1 hallazgo del refutador
que ninguna lente vio.

**Lo que salió limpio, que es lo que la pasada vino a producir:** soft delete **0 hallazgos
sobre 98 queries** revisadas una por una (cruzadas contra `startup-pos.sql` para no reportar
filtro faltante donde la tabla no tiene la columna); **multi-tenant limpio en los 63 JOIN** y
en cada id que llega del cliente; y la suite de `items.service.spec.ts` (4.136 líneas) resultó
inusualmente rigurosa — trae la derivación aritmética comentada, así que mata mutantes.

### Alta

- [ ] **El motor de precios resuelve cada línea con el `findOne` pesado** (backend,
  `calculo-precios.service.ts:71-83` y `:144`) — un `for` sobre las líneas del carrito, cada
  una llamando `itemsService.findOne`: 4 queries fijas, más ingredientes/extras/grupos si es
  receta o combo. **Es el hilo que la pasada de `ventas` dejó anotado**, y ahora se entiende
  por qué `cargarBasePorIds` no lo cerró: ese fix resolvió el lado de **persistencia** de la
  venta, no el de **precio**. No se puede reusar tal cual — `cargarBasePorIds` deliberadamente
  no trae `impuestosIds`/`descuentosIds`/`recargosIds`, que es justo lo que el motor necesita.
  Corre en los tres llamadores reales: `ventas.service.ts`, `suscripciones.service.ts` y
  `online.service.ts`.
- [ ] **Los grupos de un componente-combo se descuentan aunque el componente se haya
  omitido por falta de stock** (backend, `items.service.ts:2418-2436`) — si un componente
  `receta` no bloqueante no tiene stock, el pre-chequeo hace `continue` y no escribe nada
  por él (cero movimientos, correcto). Pero después del loop `gruposComponentes` se arma
  con **todo** `snapshot.componentes`, sin filtrar los omitidos, y se venden igual.
  Escenario: combo con una hamburguesa no bloqueante y grupo "Proteína"; falta el pan, la
  hamburguesa se omite con advertencia, y la chuleta elegida **se descuenta igual**.
  Lo que lo vuelve alto: el comentario de `:2320-2329` dice explícitamente que el
  pre-chequeo existe para evitar "deriva silenciosa de inventario" — y la deriva se cuela
  por la puerta de al lado. El seed usa `bloqueante: true`, así que no se ve en el demo.
- [ ] **Vender un extra cuyo catálogo cambió tras congelar el snapshot descuenta 1000× de
  más** (backend, `items.service.ts:2201-2202`) — `ingredienteUnidadMedida:
  cat?.ingredienteUnidadMedida ?? extra.unidadCodigo`. Si el extra ya no está en
  `receta_extras_permitidos` al cobrar (un `PATCH` reemplaza la lista completa), el fallback
  sustituye la unidad **de stock** por la unidad **de la porción**, y `convertirUnidad`
  termina convirtiendo una unidad a sí misma. 20 g de queso pasan a descontarse como 20 kg.
  Con stock bajo salta "Stock insuficiente" y queda en advertencia; con stock alto el
  descuento silencioso ocurre. El `?? 'Extra'` de la línea de al lado muestra que el caso
  "no está en el catálogo" se anticipó: el default elegido para la unidad es el equivocado.

### Media

- [ ] **Un descuento, recargo o impuesto desactivado sigue aplicándose** (backend,
  `calculo-precios.service.ts:50-62` + `items.service.ts:408-419`) — `descuentos.findAll` e
  `impuestos.findAll` no filtran `activo`, `indexarReglas` ni siquiera mapea el campo, y al
  desactivar la regla nadie toca `item_descuentos`. **Refutada la mitad peor del hallazgo:**
  las entidades usan `@DeleteDateColumn`, así que una regla **borrada** sí queda excluida por
  TypeORM — es solo `activo`. Lo que lo vuelve bug y no decisión: `items.vue:685` ya filtra
  por `activo` al ofrecer asociaciones nuevas, así que el front la esconde y el back la
  sigue cobrando.
- [ ] **`precio_base` se puede crear o editar en negativo** (backend,
  `dto/create-item.dto.ts:147`, `dto/update-item.dto.ts:59`) — solo `@IsNumberString()`, sin
  `CHECK` en la tabla (`startup-pos.sql:503`) y sin validación en `create`/`update`. El dato
  que importa para priorizarlo: el barrido de positividad de jul-2026 dejó
  `@IsDecimalNoNegativo` en `ventas`, `caja` y `propinas` — **los tres módulos que se
  auditaron**. Se detuvo en el borde del alcance y el catálogo quedó afuera. El propio
  módulo sabe hacerlo: `aplicarDesfases:3138` exige `precioBase > 0`.
- [ ] **`AjusteStockDto.cantidad` es `number` nativo** (backend, `dto/ajuste-stock.dto.ts:51`)
  — único en el módulo; los otros cinco campos de cantidad son string + `@IsNumberString()`.
  **Escenario del buscador descartado** (exigía que el cliente ya mandara el número roto).
  El sólido: la columna es `NUMERIC(18,4)` —18 dígitos significativos— y un double aguanta
  15-17, así que una cantidad grande con decimales se corrompe al pasar por
  `@Type(() => Number)`, y de ahí entra a `convertirCostoUnitario`, que es dinero.
- [ ] **Deadlock en la expansión de recetas y combos** (backend,
  `items.service.ts:1726-1735` y `:2301-2308`) — ninguna de las dos queries lleva `ORDER BY`:
  iteran en orden físico y toman `FOR UPDATE` en ese orden. Es el mismo bug ya cerrado un
  nivel más arriba, reaparecido adentro. **Corrección al hallazgo: no alcanza con agregar
  `ORDER BY` a las dos queries** — un carrito que mezcla una línea de receta y una de combo
  sigue tomando locks en orden de línea. El fix correcto es el de arriba: ordenar globalmente
  los ids a bloquear.
- [ ] **Tres carreras del mismo molde: leer para validar, escribir sin lock** (backend,
  `items.service.ts`) — (a) `remove():1508` no es transaccional, así que su chequeo de uso
  puede quedar obsoleto antes del `UPDATE`; (b) el guard de `modo_inventario` lee
  `item_producto` **sin `FOR UPDATE`** (`:1166`) mientras `registrarMovimiento` sí lo toma,
  así que no colisionan y el modo puede cambiar con un movimiento recién escrito; (c)
  `item_receta.costo_actual` se puede pisar entre editar ingredientes y aplicar desfases.
  Las tres bajadas de alta a media: ventana angosta, consecuencia silenciosa.
- [ ] **No se puede vaciar `descripcion` ni `categoriaId` al editar un ítem** (frontend,
  `configuracion/items.vue:816` y `:818`) — el backend distingue bien `undefined` ("no tocar")
  de `''`/`null` ("borrar"), pero el front colapsa todo lo falsy con `|| undefined` y el campo
  ni viaja. El usuario borra el texto, ve "Item actualizado", y el valor sigue ahí. Mismo bug
  en `duracionEstimada` (`:866`), donde además tapa el `0` legítimo.
- [ ] **La resolución de recargos por id nunca corre con datos** (backend,
  `calculo-precios.service.spec.ts`) — el fixture fija `recargosIds: []` y el mock de
  `findAll` devuelve `[]` en los 9 tests. Mutante que sobrevive: cambiar `recargoMap` por
  `descuentoMap` en `calculo-precios.service.ts:169` y nada falla. El motor puro sí prueba
  recargos a fondo, pero construyendo las reglas a mano — la capa que las resuelve por id no
  la ejerce nadie. `ventas.service.spec.ts` también fija `recargosIds: []` en sus tres
  fixtures.
- [ ] **`findOne` de una receta con 5 grupos son 6 queries** (backend,
  `items.service.ts:552`) — un `SELECT` de opciones por cada grupo, con la versión batcheada
  (`cargarGruposPorItem:274`) ya escrita en el mismo archivo y usada dos líneas más arriba
  para los componentes de un combo.

### Baja

- [ ] **`remove()` chequea uso sin filtrar por tenant** (backend, `items.service.ts:1514`,
  `:1528`, `:1542`) — defensa en profundidad faltante, misma clase que los `LEFT JOIN
  garzones` de `turnos`/`salones`. No explotable: el ítem ya se validó contra el tenant y
  ningún camino de escritura permite que otro tenant lo referencie. Si la invariante se
  rompiera, el fallo **no sería silencioso sino una fuga de nombres** — el mensaje de error
  interpola el `nombre` de las recetas/combos/grupos encontrados.
- [ ] **`precioUnitario` negativo en `/calculo-precios/calcular`** (backend,
  `dto/calcular.dto.ts:27`) — `cantidad` se valida con `<= 0` en `resolverLinea:140` y
  `precioUnitario` no. Bajado de media: el endpoint no persiste nada y el camino real de
  venta ya exige `@IsDecimalNoNegativo`.
- [ ] **`convertirAMonedaOficial` redondea a 4 fijo** (backend,
  `calculo-precios.service.ts:188`) — **hallazgo del refutador, ninguna lente lo vio**: el
  `.toFixed(4)` ignora `escalaCalculo` y `modoRedondeo` del tenant, y ocurre justo antes de
  entregarle el precio al motor que sí los respeta. Un paso de redondeo fuera de la config.
- [ ] **`aplicarDesfases`/`descartarDesfases` hacen 3-4 queries por receta** (backend,
  `items.service.ts:3122` y `:3208`) — en un endpoint que la UI usa con "Seleccionar todas"
  (`RecetasDesfasesPanel.vue`) y cuyo DTO solo exige `@ArrayMinSize(1)`, sin tope superior.
- [ ] **Las tres `validarY…` hacen un `SELECT` por fila del payload** (backend,
  `items.service.ts:2717`, `:2813`, `:2880`) — crear una receta con 15 ingredientes son 15
  `SELECT` secuenciales. Son lecturas de validación, no el `INSERT` de N filas que está al
  lado (ese está bien).
- [ ] **Ingrediente o extra duplicado en una receta devuelve 500, no 400** (backend,
  `items.service.ts:2695` y `:2860`) — `validarYCostearComponentes` rechaza duplicados con un
  `Set` (`:2796`); sus dos funciones gemelas no. El payload pasa la validación y revienta
  contra el índice único parcial. Bajado de media: la transacción revierte y el índice
  sostiene el dato, lo único malo es la calidad del error. Asimetría entre gemelas, no
  decisión consciente.

### Decidido por el owner (pendiente de respuesta)

- [ ] **¿El descuento debe tener piso en cero?** (backend,
  `calculo-precios.engine.ts:239`) — `acc.plus(monto.times(signo))` sin `max(acc, 0)`. Un
  `monto_fijo` de 500 sobre un ítem de 100 devuelve `totalLinea: -400`; `validarValor` de
  descuentos solo topea el `< 1` cuando el modo es porcentaje. También se llega apilando
  tres descuentos de 0.40 en modo `base`. **No hay regla documentada** que diga qué debe
  pasar, y las opciones no son equivalentes: topear en cero en silencio, rechazar la línea
  con 400, o permitirlo porque un total negativo podría ser legítimo en una nota de crédito.
- [ ] **¿`remove()` debe bloquear el borrado de un ingrediente usado solo como extra?**
  (backend, `items.service.ts:1508`) — bloquea si es ingrediente fijo, componente de combo u
  opción de grupo, pero nunca consulta `receta_extras_permitidos`. `recetas.md` solo documenta
  el bloqueo del ingrediente fijo. No está claro si omitirlo para extras fue deliberado
  (menos fricción para borrar un insumo poco usado) o descuido, dado que sí se bloquea para
  los otros tres usos vivos. **Es la condición habilitante del bug de conversión de unidad de
  la sección Alta**, así que la respuesta cambia cuánto queda de ese bug tras corregirlo.

## Refactor Caja → "Mi caja" / "Cajas" (diferido del brainstorm 2026-07-23)

El refactor separa la operación del cajero (**"Mi caja"**) de la supervisión del encargado
(**"Cajas"**). Se decidió que **"Cajas" arranca solo-lectura**; los poderes de escritura del
encargado se difieren a propósito para no acoplar el refactor de IA/permisos a un cambio de
modelo con implicancias de auditoría. Investigación y cruce de mercado:
[`investigaciones/2026-07-23-gestion-caja.md §6`](investigaciones/2026-07-23-gestion-caja.md).
El refactor de IA/permisos y los sub-proyectos A (arqueo multi-medio), B (cierre ciego) y
C (cierre en dos fases) **ya se entregaron** — ver [`resueltos.md`](resueltos.md). Lo que
sigue son los poderes del encargado que se difirieron a propósito:

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
  **resuelto** por el sub-proyecto A) — el umbral se evaluaría sobre la
  diferencia de cada línea del arqueo multi-medio, ya no sobre un total mezclado que
  inflaba cualquier diferencia.
- [ ] **Ocultar el resultado post-cierre al cajero** (backend + frontend) — en el cierre
  ciego (sub-proyecto B) el cajero **sí** ve su propia diferencia al enviar el conteo (la
  revelación es inmediata, vía el detalle), aunque la caja quede `en_conciliacion`. El
  sub-proyecto C resolvió la conciliación operador→supervisor de §6, pero no
  condicionó la revelación a que solo el supervisor la vea de inmediato — sigue diferido.
- [ ] **Conteo por denominación** (§5/§8.3 de la investigación) — los motivos categorizados
  de diferencia de §5 quedaron **resueltos** por el sub-proyecto C; lo que sigue
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

## Features diferidas (necesitan spec y decisión de negocio)

No son correcciones ni deuda: son funcionalidad que todavía no existe y que **no se puede
empezar sin una decisión del owner**. Se listan acá para no perderlas, con la pregunta que
hay que responder antes de diseñar. Encararlas es brainstorm → spec → plan, nunca "un rato".

Los otros tres temas de esta clase viven donde los dejó su procedencia, porque el contexto
de dónde salieron es parte del enunciado: **saldo en contra por propina ya liquidada**,
**una persona cobrando en dos grupos** y **devolución por medio de pago con plazos**, los
tres en la sección de auditorías de arriba.

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
