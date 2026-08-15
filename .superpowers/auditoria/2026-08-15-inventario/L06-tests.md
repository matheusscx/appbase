## Lente: tests que no prueban nada
## Veredicto: 4 hallazgos

### Qué revisé para poder afirmarlo

Leí completos y línea por línea: `inventario.service.ts` (871) + su spec (1034),
`mermas.service.ts` (298) + su spec (377), `recuentos.service.ts` (693) + su spec (754),
`catalog.service.ts` (167, solo la porción de conversión de unidades) + su spec (192),
`causas-merma.service.spec.ts` (394) completo, `query-causas-merma.dto.spec.ts` (52)
completo. De los e2e leí `inventario.e2e-spec.ts` (293), `mermas.e2e-spec.ts` (186),
`recuentos.e2e-spec.ts` (1110, las 26 `it` una por una) y `simulador-costos.e2e-spec.ts`
(281) completos. Del frontend leí `useUnidadConversion.spec.ts`, `useRecuentoInventario.spec.ts`
y `useDevolucionInventario.spec.ts` completos, y `motivos-diferencia-inventario.nuxt.spec.ts`
(502 líneas) completo como muestra del molde que comparte con `causas-merma.nuxt.spec.ts`.

Para cada service recorrí cada `if`/`throw`/rama de negocio y busqué, con grep dirigido,
si algún `it(...)` la ejercitaba (por mensaje de excepción o por el nombre del branch).
Marqué como candidato todo `toBeDefined/toBeTruthy/toContain` y verifiqué si la aserción
inmediatamente vecina cerraba el caso o lo dejaba abierto.

Nota de scope: `Tests del alcance` en el brief lista literalmente
`{inventario,recuentos,mermas,catalog}/**/*.spec.ts`, que **no incluye**
`motivos-diferencia-inventario/motivos-diferencia-inventario.service.spec.ts` pese a que
el módulo sí figura en "Alcance". Respeté el glob tal como está escrito y no audité ese
spec — lo señalo por si fue un olvido y no una exclusión deliberada.

Hallazgo general: la suite de este dominio es la más madura que vi en esta pasada —
varios specs (`causas-merma.service.spec.ts`, `motivos-diferencia-inventario.nuxt.spec.ts`)
tienen comentarios propios documentando bugs de test que ya se corrigieron (aserciones que
"pasaban en verde" sin probar nada) y quedan como red — eso reduce cupo real de hallazgos
nuevos en esa zona.

### H1. El reintento por deadlock (40P01) en `RecuentosService.aplicar` no lo ejercita ningún test
- **Severidad:** media
- **Ubicación:** `backend/src/modules/recuentos/recuentos.service.ts:473-489`
- **Qué está mal:** `aplicar()` envuelve `aplicarEnTransaccion` en un `try/catch` que
  detecta `QueryFailedError` con `code === '40P01'` (deadlock de Postgres) y reintenta una
  vez; cualquier otro error se repropaga tal cual. Ningún test — ni unitario ni e2e —
  simula ese error para comprobar que el reintento ocurre, ni que un error NO-40P01 se
  repropaga sin reintentar.
- **Escenario:** dos `aplicar()` concurrentes sobre recuentos que lockean `item_producto`
  en órdenes cruzados (el propio comentario del código describe el caso: recuento en
  orden `item_id` vs. venta en el orden del carrito) hacen que Postgres aborte una
  transacción con 40P01. Si alguien borra el `catch` (o invierte la condición y reintenta
  ante *cualquier* error, incluyendo uno real de negocio), la suite entera sigue en verde:
  nada en `recuentos.service.spec.ts` ni en `recuentos.e2e-spec.ts` (que corre con
  `maxWorkers: 1`, sin concurrencia real) puede fallar por eso.
- **Por qué ningún test lo caza:** el mutante "borrar todo el `try/catch` y dejar
  `return this.aplicarEnTransaccion(...)` a secas" no rompe ningún test existente —
  confirmado con grep: cero referencias a `40P01`, `QueryFailedError` o `deadlock` en
  `recuentos.service.spec.ts`. Es mockeable sin concurrencia real (mockear
  `dataSource.transaction` para que la primera llamada rechace con
  `Object.assign(new QueryFailedError(...), {code:'40P01'})` y la segunda resuelva), así
  que no depende del hueco ya conocido de `maxWorkers: 1`.
- **Confianza:** alta — grep confirmado contra el archivo abierto; el gap es la ausencia
  total del escenario, no una interpretación de la aserción.

### H2. El e2e del simulador de costos no verifica que el precio aplicado sea el correcto, solo que cambió
- **Severidad:** media
- **Ubicación:** `backend/test/simulador-costos.e2e-spec.ts:150-151`
- **Qué está mal:** el test `'compra → afectadas → aplicar con precio → sale de bandeja'`
  aplica el `precioSugerido` que devolvió `GET /items/:id/recetas-afectadas` y luego
  solo comprueba:
  ```
  expect(body.costoActual).not.toBe('1200.0000');
  expect(body.precioBase).not.toBe('3500.0000');
  ```
  Nunca compara contra el valor esperado (ni contra `fila?.precioSugerido`, que el propio
  test ya tiene en una variable, ni contra un cálculo independiente de margen).
- **Escenario:** si `precioSugerido` se calculara mal (fórmula de margen invertida, el
  costo cacheado de la receta desactualizado, un `NaN` que `Decimal` convierte en `'0'`,
  o directamente el valor sugerido de OTRA receta), el `precioBase` resultante seguiría
  siendo distinto de `'3500.0000'` — el test pasa igual, certificando un precio
  incorrecto como si fuera el correcto.
- **Por qué ningún test lo caza:** el mutante "devolver `precioSugerido` con la fórmula de
  margen invertida (multiplicar en vez de dividir)" no lo detecta este test: cualquier
  número distinto de 3500 satisface `not.toBe('3500.0000')`. El fix mínimo es
  `expect(body.precioBase).toBe(fila?.precioSugerido)` (o `toFixed(4)` de ese valor), que
  si aparece un valor absurdo (`'0.0000'`, negativo, etc.) al menos deja rastro de qué se
  aplicó — o, mejor, computar el margen esperado a mano como hace
  `'aplicar sin checkbox no cambia precio_base'` con `'2500.0000'` fijo unas líneas más
  abajo en el mismo archivo (esa sí compara contra un valor exacto).
- **Confianza:** alta — la lógica de `precioSugerido` vive en `items.service.ts`, fuera de
  mi lectura de este pase (auditado por su propio lado en jul-2026 según el brief), pero
  el defecto que reporto es específico de la aserción del e2e, no de esa fórmula.

### H3. Las validaciones de aislamiento de tenant/item en salida por serie y por lote no tienen ningún test
- **Severidad:** media
- **Ubicación:** `backend/src/modules/inventario/inventario.service.ts:463-468` (salida
  serie: `unidad_id` no pertenece al tenant / no pertenece al item) y `:611-613` (salida
  lote con `loteId` explícito: lote no pertenece al tenant)
- **Qué está mal:** `moverSerie` (salida con `unidadIds` explícitos) valida, unidad por
  unidad, que `rows[0].tenant_id === params.tenantId` y `rows[0].item_id === params.itemId`
  antes de tocar el estado. `moverLote` (salida con `loteId` explícito) hace la misma
  validación de tenant sobre el lote. Ninguna de las tres ramas tiene un `it(...)` en
  `inventario.service.spec.ts` — confirmado con grep: cero coincidencias para "no
  pertenece al tenant" ni "no pertenece al item" en el spec.
- **Escenario:** un request de venta/merma en modo serie o lote que llega con un
  `unidadIds`/`loteId` de OTRO tenant (el DTO los recibe como UUID sueltos, sin
  scoping por token salvo esta verificación manual) tiene que ser rechazado — es la única
  barrera entre "cliente manda cualquier UUID" y una fuga de stock/kardex entre tenants.
  El resto del sistema saca `tenant_id` del token (invariante del proyecto), pero acá el
  UUID de la unidad/lote es un input del body y esta es la única línea que lo ata al
  tenant correcto.
- **Por qué ningún test lo caza:** un mutante que borre estas tres validaciones (o invierta
  la comparación) deja los 24 tests de `inventario.service.spec.ts` en verde: nada llama
  a `registrarMovimiento` con una unidad o lote de un `tenant_id`/`item_id` distinto al de
  los params. El test que sí existe para modo serie ("lanza BadRequest si unidad no está
  disponible") solo cubre el chequeo de `estado`, no los dos anteriores.
- **Confianza:** alta para la ausencia del test (grep sobre el archivo abierto); media
  para el impacto real en producción, porque no verifiqué si el controller/DTO de arriba
  ya sanitiza esos UUIDs contra el catálogo del tenant antes de llegar acá — si lo hiciera,
  esto sería defensa en profundidad y no explotable, pero seguiría sin tener test propio.

### H4. El e2e de mermas nunca vuelve a leer el stock del item tras registrar la merma
- **Severidad:** baja
- **Ubicación:** `backend/test/mermas.e2e-spec.ts:116-149`
- **Qué está mal:** el test `'POST /mermas registra merma con Vencimiento y costoPerdido'`
  solo mira la respuesta del propio `POST` (`costoUnitario`, `costoPerdido > 0`,
  `causaNombre`). El siguiente test, `'GET /mermas incluye causaNombre y costoPerdido'`,
  vuelve a leer la lista de mermas pero tampoco trae `stockAnterior`/`stockResultante`
  (el propio `MermaListItem` de la interfaz del test no declara esos campos). En ningún
  punto del archivo hay un `GET /api/items/:id` posterior a un `POST /mermas` que
  confirme que el stock realmente bajó en la cantidad mermada.
- **Escenario:** si `mermas.service.ts` llamara a `registrarMovimiento` con
  `tipo: 'entrada'` en vez de `'salida'` (o con la cantidad sin convertir de unidad), el
  e2e seguiría en verde porque nunca vuelve a consultar el stock del item.
- **Por qué ningún test lo caza:** parcialmente cazado en otra capa —
  `mermas.service.spec.ts` sí asierta `objectContaining({ tipo: 'salida' })` al mockear
  `inventarioService.registrarMovimiento`, así que ese mutante puntual no sobrevive del
  todo. Pero el e2e —la única capa que corre contra Postgres real y el FOR UPDATE de
  `registrarMovimiento`— no vuelve a comprobar el efecto persistido, que es justamente lo
  que un e2e existe para blindar (un bug de conversión de unidad al mermar, o un
  problema de redondeo dentro de la transacción real, no lo vería nada en este archivo).
- **Confianza:** media — el hallazgo es real (grep confirma que `stock` del item nunca se
  vuelve a pedir en este archivo tras un `POST /mermas`), pero el riesgo está parcialmente
  mitigado por el unit test de motivo/tipo.
