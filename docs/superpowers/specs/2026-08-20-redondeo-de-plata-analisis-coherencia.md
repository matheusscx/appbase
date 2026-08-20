# Redondeo de plata — análisis de coherencia e impacto de las once decisiones

**Fecha:** 2026-08-20
**Estado:** 📋 Análisis cerrado — **insumo para la spec, no diseño y no toca código.**
**Qué analiza:** [las once decisiones](2026-08-20-redondeo-de-plata-decisiones.md),
contrastadas entre sí, contra la configuración que existe y contra el código en `main`
(`f5e539ed`). El estado del código lo fija
[la lectura independiente](2026-08-20-redondeo-de-plata-lectura-independiente.md); el
[relevamiento](2026-08-20-redondeo-de-plata-estado.md) se usó por contexto, no por cifras.
**Método:** lectura completa de los cinco documentos del frente + cinco pasadas de
verificación puntual por agentes de contexto fresco (config/snapshot congelado, motor,
bordes de entrada, los 34 tests, NC/desbruteo) — cada afirmación de código de este
documento fue verificada abriendo el archivo en esta pasada, salvo lo listado en §7.
La base de dev se consultó solo con `SELECT`.

---

## 0. El titular

1. **Las once cierran entre sí en casi todos los pares.** Los choques reales no son entre
   decisiones sino entre una decisión y un hueco que ninguna cubre: la posición
   `documento` de la perilla de c) no tiene mecánica definida (§1.1), y el rechazo de d)
   tiene gemelos de capa que su propio conteo de tests no ve (§4).
2. **La premisa de b) — "`modo_redondeo` aplica a los montos cobrados" — hoy es falsa en
   el pipeline, no solo en los once sitios.** El motor respeta el modo a `escala_calculo`
   (6), pero el recorte final de 6→4 al persistir lo hace el **cast de Postgres con su
   regla fija** (half away from zero) en *todo* campo de plata de la venta salvo
   `precio_unitario` — sin recuantización alguna en `ventas.service.ts` entre el motor y
   el `INSERT` (§2.2). Con un tenant en `FLOOR`/`CEIL`/`HALF_EVEN`, el modo elegido se
   pisa en el último paso. Hoy es invisible porque los 6 tenants del seed están en
   `HALF_UP`. La consecuencia: la pregunta "abierta" de dónde vive la cuantización no es
   un detalle de diseño — **es la condición de implementabilidad de b)**.
3. **e) exige una rama nueva del motor, no un ajuste.** No existe hoy ningún camino de
   código que produzca `IVA = total − neto`: el impuesto de línea sale siempre de
   `tasa × base` (`calculo-precios.engine.ts:581`), en un bloque único sin rama por
   `precioIncluyeImpuesto`. Y sí: **e) se puede honrar sin tocar f)** — los bloques son
   disjuntos, verificado (§1.4).
4. **g) es implementable pero con tres huecos:** `lockVentaOriginal` no trae
   `config_calculo` (falta 1 columna en el SELECT), no hay fallback definido para una
   venta original con config `NULL`, y **la NC misma queda con `config_calculo = NULL`
   para siempre** — ninguna decisión dice si la NC congela el criterio que usó (§1.5).
5. De los 36 tests: **8 rompen** (los que d) ya cuenta — el conteo verifica exacto),
   **2 dependen** de dónde se implemente e), **23 sobreviven**, y **3 marcan conducta que
   las decisiones no contemplan**: `montoTolerancia` sin dueño de escala, y los gemelos
   de nivel-servicio de `montoContado`/`saldoInicial` (§4).
6. **Solo c) necesita configuración nueva.** Las otras diez se implementan con lo que
   hay: constantes nombradas, ramas de código, validación y documentación. La superficie
   de un campo nuevo de preferencias son ~12 sitios enumerados a mano, ninguno generado
   desde otro (§2.1).

---

## 1. Coherencia entre las once

### 1.1 b) × c) — dos perillas independientes, y una posición sin mecánica

Son **ejes ortogonales de la misma política de cobro**, no una perilla con dos caras:
`modo_redondeo` dice *cómo* se redondea (HALF_UP/FLOOR/…), el nivel dice *con qué grano*
(línea vs documento), y la escala objetivo (la de la moneda) la fija la moneda, no una
perilla. Los dos aplican solo al dominio "cobrado" que b) delimita: los costos no tienen
eje de nivel — un costo es por naturaleza "por línea" y queda en escala 4 HALF_UP fijo
(a, b). Hasta acá, cierran.

**El choque no es entre b y c: es entre c y el vacío.** La perilla nace con dos
posiciones y solo una tiene semántica:

- **`linea` (default):** coherente con la arquitectura del motor (calcula por línea y
  suma, `calculo-precios.engine.ts:629`), con la obligación c.1 (definir `dv`/`rv` en el
  documento) ya registrada en decisiones.md.
- **`documento`:** ninguna de las once define qué pasa con las líneas. Si solo el total
  se cuantiza, `venta_detalles.total_linea` sigue persistiendo `.5000` en CLP-0 — **el
  bug medido que motivó el frente entero**, ahora elegible por configuración. Si las
  líneas también se cuantizan, el descuadre entre Σ líneas y el total necesita un lugar,
  y ese lugar **no existe**: el DTE chileno no tiene campo de ajuste (cero coincidencias,
  verificado en la investigación) y el modelo no tiene el "ítem no facturable" que la
  práctica usa (Clover/Laudus). La matriz que c.4 obliga puede *declarar* esta
  combinación, pero no puede *resolverla* — es decisión de negocio pendiente (§5.1).

**Combinación sin sentido que el DTO permite hoy:** `escala_calculo` acepta 0–12
(`update-preferencias-financieras.dto.ts:25-28`, `@Min(0)`). Un tenant con USD (2
decimales) y `escala_calculo = 0` tendría el borrador *más grueso* que el objetivo. La
matriz de c.4 tiene que prohibirla o declararla.

### 1.2 d) × k) × lo que el sistema mismo genera

d) y k) son coherentes entre sí — la misma regla mental contra dos escalas (moneda para
lo cobrable, 4 para costos) — pero **solo cubren la puerta de entrada**. Verificado en
esta pasada: **nada en el camino interno frena ni cuantiza a la escala legal de la
moneda**. Lo que existe internamente cuantiza a 4 decimales de columna (`NUMERIC(18,4)`),
que es escala de almacenamiento, no regla de plata:

- El `.5000` interno existe hoy en dev: `pagos.vuelto = 994942.5000` y `983042.5000`,
  `ventas.total_final = 16957.5000` y `5057.5000` (medido por `SELECT`).
- El único freno que **rechaza** es `montoEntero()` (`webpay-plus.provider.ts:89-95`,
  `oneclick.provider.ts:85-91`) — y solo corre si el pago pasa por Transbank. El efectivo
  y el pago manual nunca pasan por ahí.
- El vuelto es resta pura y hereda cualquier fracción: `targetCobro = totalFinal +
  propina` (`ventas.service.ts:768-770`, `.toFixed(4)` sin modo), `excedente` y `vuelto`
  en `pagos.service.ts:170-171`, `:215-217`, `:225` (`.toFixed(4)`, escala de columna).

O sea: **d y k sin la cuantización del cierre dejan al sistema generando montos que sus
propios bordes de pago rechazan** — el hueco "el momento cobrable no tiene dueño" queda
igual de abierto. La cadena cierra solo si cierran las tres patas a la vez: la entrada
(d), el total del documento (la cuantización pendiente de diseño) y la propina (d);
recién ahí el vuelto es entero *por construcción*, porque es resta de enteros.

**Dos tensiones internas de d):**

1. Su prosa enumera `pagos.monto`, NC, movimientos de caja, contado y propinas — pero su
   propia lista de tests rotos incluye `saldoInicial` de apertura (`caja.e2e-spec.ts:810`),
   que la prosa no nombra. El alcance real de d) es "lo que su lista de tests toca", y
   conviene que la spec lo enumere por campo, no por ejemplo.
2. Su obligación *"el frontend cuantiza antes de mandar"* choca de frente con su propio
   porqué (y el de k): *"el sistema nunca cambia calladamente un número que una persona
   escribió"*. Un frontend que cuantiza lo tipeado es exactamente eso. La lectura
   coherente es que el frontend **impida tipear** de más (máscara/validación), no que
   recorte después — pero eso es una decisión de UX que nadie tomó (§5.6).

### 1.3 a) × "la moneda manda al cerrar" — la frontera exacta

La frontera es **por naturaleza del número, y se cruza en una multiplicación**: tasa ×
cantidad ⇒ monto.

- Del lado tasa/costo (escala 4): CPP, costos de receta/combo, conversión de costo,
  `precio_unitario` (fijado por `ESCALA_PERSISTIDA = 4`,
  `calculo-precios.service.ts:31`, usos `:403-404`) y `precio_base`
  (`items.service.ts:4292/:4344`, clamp a 4).
- El cruce: `subtotalNeto = redondear(netoUnitario × cantidad)`
  (`calculo-precios.engine.ts:520`) — ahí nace el primer **monto** de la cadena de venta
  — y su gemelo fuera del motor, la línea de NC (`ventas.service.ts:1010`).
- El único puente costo→precio es `precioSugerido` (`items.service.ts:3697`), mediado por
  un humano que edita y confirma. No hay campo que cruce solo.

Coherente y implementable. Un matiz para los comentarios que b) obliga: k protege **lo
tipeado**; el sistema sigue cuantizando en silencio **sus propios cálculos** (el CPP en
`inventario.service.ts:410` produce más de 4 decimales y se recorta). "Una sola regla
mental" vale para la plata que escribe una persona — el comentario de cada sitio tiene
que decir esa diferencia, o el próximo lector va a leer una contradicción.

### 1.4 e) × f) — separables, verificado en el código

- El IVA de línea nace **siempre** de `tasa × baseImponible`
  (`calculo-precios.engine.ts:581`), en el bloque `:577-590`, **sin ninguna rama** por
  `precioIncluyeImpuesto` — el desbruteo (`:511-519`) solo cambia cómo se obtiene
  `netoUnitario`. No existe camino `IVA = total − neto`: **e) es una rama nueva** dentro
  de `calcularLinea`.
- El paso `impuestos` a nivel venta **no existe**: el loop de reglas de venta
  (`:654-681`) no tiene rama `impuestos` (comentario explícito `:633-634`). f) difiere
  exactamente ese vacío.
- `calcularLinea` (`:498-606`) y el bloque de nivel venta (`:624-685`) son disjuntos:
  **la spec puede honrar e) sin tocar f)**.

Lo que sí hay que decir fuerte: después de e), la boleta va a desviar del `tasa × base`
por **dos razones de naturaleza distinta a la vez** — la elegida (e: ≤1 unidad por línea
desbruteada, para cerrar a góndola) y la diferida (f: el descuento de venta no baja la
base del IVA). Si la spec no las documenta separadas, el que audite una boleta va a
"arreglar" la consecuencia elegida de e) creyendo que persigue el defecto de f).

### 1.5 g) × c) — herencia coherente, con tres huecos de implementación

La herencia del criterio congelado (modo en g, nivel en c.3) es coherente. Pero:

1. **El dato no está a mano:** `lockVentaOriginal` (`ventas.service.ts:1227-1257`)
   selecciona 7 columnas y `config_calculo` no está (`:1249-1253`). Es +1 columna en un
   SELECT ya bajo `FOR UPDATE` — trivial, pero hoy el método no puede heredar nada.
2. **Fallback sin definir:** una venta original con `config_calculo = NULL` (anteriores
   al congelado — y el comentario `ventas.service.ts:1738-1740` confirma que existen como
   estado). ¿La NC hereda el default del tenant vigente, o `HALF_UP`? Nadie lo dijo.
3. **La NC misma no congela nada:** `crearNotaCredito` (`:926-1122`) crea la fila sin
   asignar `configCalculo` → `NULL` (sin default de columna, verificado en BD). Bajo las
   decisiones, la NC *usaría* el modo heredado pero *no dejaría rastro* de cuál usó. Como
   toda NC nace con `config_calculo = NULL` **por construcción**, este estado no
   desaparece con ningún reset — cualquier consumidor futuro del snapshot tiene que
   manejar `NULL` para siempre, o la spec decide que la NC congela lo que heredó (§5.4).

### 1.6 Los pares menores

- **b) × sitios 8/9 (propinas):** asimetría real y sin nombre. Para d), la propina es
  plata cobrable (rechaza con 400); para b), la liquidación no está en la enumeración
  (motor, conversión, documentos de venta) y el reparto queda en HALF_UP fijo
  (`mayores-restos.ts:44` — apportionment: Σ partes = total no depende de ningún modo).
  Defendible, pero es una regla implícita: la matriz de c.4 tiene que nombrarla.
- **i) × d):** coherentes — doble borde con el mismo criterio (validar, nunca redondear).
  El contrato "todo provider valida en su borde" no tiene casa documental asignada (§3).
- **j) × c):** compatibles; la interacción `escala_calculo` × moneda es la combinación
  absurda de §1.1. El contrato de j ("no decide nada de lo persistido") es **hoy
  literalmente cierto solo para `precio_unitario`** — para el resto de los campos lo que
  decide lo persistido es el cast de Postgres (§2.2), que no es ni `escala_calculo` ni la
  moneda. La documentación que j obliga solo se puede escribir con honestidad después de
  la cuantización del cierre.
- **h):** sin choque. Su obligación es ambigua: "la decisión sobre el dato **se nombra**
  ahora" — ¿nombrar en doc, o crear la columna `cashRounding`? Una columna sin consumidor
  repetiría el patrón que este mismo frente criticó en `moneda.decimales` (§6).

---

## 2. Implementabilidad con la configuración que existe

### 2.1 Por decisión

| # | ¿Config nueva? | Dónde viviría | ¿Entra al snapshot? | `NULL` en venta vieja |
|---|---|---|---|---|
| a | **No** — constante nombrada (`ESCALA_COSTO = 4`), hoy inexistente (los 106 `toFixed(4)` son literales) | código | No (los costos no viven en la venta) | n/a |
| b | **No** — `tenants.modo_redondeo` ya existe | — | Ya está (clave `modoRedondeo`, medido en vivo) | Ya resuelto por los lectores actuales |
| c | **Sí — la única.** `nivelRedondeo` | `tenants` (columna nueva) + `ConfigCalculo` | **Sí** (obliga c.2) | Default `linea`; el patrón de fallback ya existe (`VentaDetalleDrawer.vue:388-390` con `FORMULA_DEFAULT`) — pero ver §1.5.3: el `NULL` de las NC es permanente |
| d | **No** — pero la escala a validar es `moneda.decimales` del tenant, un dato **dinámico**: un validador estático de class-validator no lo conoce. Dónde vive el rechazo (pipe con contexto vs service) es diseño sin dueño (§3) | — | No | n/a |
| e | **No** — rama de código en `calcularLinea` | código | No (cambia el algoritmo, no la config; el snapshot congela config, no versión de código) | n/a |
| f | **No** — nada (diferida) | — | — | — |
| g | **No** — lee el snapshot existente | — | Usa el de la venta original; el propio queda indefinido (§1.5.3) | Fallback sin definir (§1.5.2) |
| h | **No** (diferida); el "dato nombrado" es ambiguo (§1.6) | — | — | — |
| i | **No** — explícitamente decidido: cero columnas | adaptador de cada provider | No | n/a |
| j | **No** — `escala_calculo` ya existe | — | Ya está | Ya resuelto |
| k | **No** — validación contra la constante fija 4 (estática, sí puede vivir en el DTO) | — | No | n/a |

**Respuesta directa al pedido:** diez de las once no necesitan ninguna perilla nueva.
La única deuda de configuración posible es c) — que ya fue pesada y elegida por el owner
con la contra registrada.

### 2.2 La superficie real de c), medida

Un campo nuevo de preferencias que llegue al motor toca **~12 sitios, ninguno generado
desde otro** (verificado uno por uno):

`startup-pos.sql:186-190` (el bloque de las 5 columnas — la línea `:187` del contexto es
específicamente `calculo_recargos`) · `tenant.entity.ts:30-49` (`@Column` con default —
**cuarta copia** de los defaults) · `update-preferencias-financieras.dto.ts` ·
`tenants.service.ts:1391-1414` (SELECT) · `:1436-1449` (el UPDATE que enumera columnas a
mano — **corrección al contexto del pedido: es `:1436-1449`, no `:1424`**, que cae en un
tipo de retorno) · `:191-205` (alta de tenant, segunda copia de defaults) ·
`seeder.service.ts:1113-1117` (tercera copia) ·
`preferencias-financieras.vue` (4 sub-puntos: refs `:14-19`, `cargar()` `:39-56`,
`formState` `:66-73`, `guardar()` `:75-88`) · `ConfigCalculo`
(`calculo-precios.engine.ts:63-70`) · `cargarConfig`
(`calculo-precios.service.ts:61-71`).

Dos datos del snapshot que la spec necesita saber:

- `ConfigCalculo` tiene **5 campos**; `montoTolerancia` se descarta a propósito al
  armarlo (`calculo-precios.service.ts:64-70`). decisiones.md c.2 dice "el JSON congelado
  ya guarda esos tres" — son **cinco** claves (medido en vivo: las 83 ventas de dev las
  tienen todas). No cambia la conclusión; cambia el inventario.
- Los lectores del snapshot son exactamente dos: `findOne`
  (`ventas.service.ts:1555/:1566/:1741`, propaga `NULL` tal cual) y
  `VentaDetalleDrawer.vue` (fallbacks por campo; el bloque "Cómo se redondeó" directamente
  **no se renderiza** si es `NULL`, `:845`). Nadie más lo consume — agregar
  `nivelRedondeo` al JSON no rompe a ningún lector existente.

### 2.3 El hallazgo que condiciona todo: el cast de Postgres pisa el modo

Verificado en esta pasada (no estaba en ningún documento del frente con este alcance):

- En `ventas.service.ts` **no hay ninguna cuantización** entre el motor y el `INSERT`
  para los 5 campos de `VentaDetalle` (`:477-481`), los 5 totales de `Venta`
  (`:430-435`) ni las trazas de `ventas_descuentos`/`recargos`/`impuestos`
  (`:502-581`). Todo viaja como string a `escala_calculo` (6) hacia columnas
  `NUMERIC(18,4)`.
- El recorte 6→4 lo hace el cast implícito de Postgres, regla fija *nearest, ties away
  from zero* (medido: `'1.999950'::numeric(18,4) → 2.0000`), **que no mira
  `modo_redondeo`**.
- Las dos únicas cuantizaciones explícitas del camino — `baseVentasSinImpuestos`
  (`:417-419`) y `targetCobro` (`:768-770`) — son `.toFixed(4)` **sin modo** (default
  global de Decimal.js; verificado que no hay `Decimal.set` en el repo).
- El único campo protegido de punta a punta es `precio_unitario`
  (`convertirAMonedaOficial`, `calculo-precios.service.ts:403-404`, con test que fija
  FLOOR/CEIL/HALF_UP en `calculo-precios.service.spec.ts:220-224`). Ningún test cubre el
  resto: `ventas.e2e-spec.ts:1315-1328` solo verifica que el JSON congelado exista.

Consecuencia para la spec: **la cuantización del cierre no es "dónde conviene ponerla",
es lo que hace verdadera la premisa de b)**. Y su inventario de campos no es solo la
salida del motor: incluye `baseVentasSinImpuestos`, `targetCobro`/vuelto y la línea de NC
— tres sitios que el barrido por conducta de los once no listó porque son restas o clamps,
no multiplicaciones.

---

## 3. Qué obliga cada una, y quién lo hace

Inventario de trabajo por decisión (tipo: E=esquema, S=servicio/motor, D=DTO/validación,
U=UI, T=test, Doc=documentación). "Dueño" = qué documento ya lo asigna.

| Dec. | Obligación | Tipo | Dueño hoy |
|---|---|---|---|
| a | Comentario en sitios 1-7 y 10 (+ gemelos `items.service.ts:3508`/`:3580`) con los textos de la lectura §1 | S (comentarios) | decisiones.md + lectura §1 |
| a | `ESCALA_COSTO` como concepto nombrado (hoy 106 literales en 17 archivos) | S | decisiones.md |
| b | Cada comentario de costo dice "no mira `modo_redondeo` a propósito" | S | decisiones.md |
| b | Que el modo del tenant gobierne **de verdad** el último recorte de todo campo cobrado (§2.3) | S+T | ⛔ **sin dueño** — implícito en b, no listado en ningún doc |
| c | Columna + DTO + UI + seeder + alta + `ConfigCalculo` + `cargarConfig` (~12 sitios, §2.2) | E+D+U+S | decisiones.md (c.2) |
| c | Definir `dv`/`rv` en el documento | S+Doc | decisiones.md (c.1) — **la spec lo diseña; nadie propuso nada aún** |
| c | Matriz `nivel × modo × escala` con las combinaciones prohibidas | Doc | decisiones.md (c.4) |
| c | Preparar el "fijado desde afuera" (candado país→nivel) | S | decisiones.md (c.5) — **sin diseño en ningún lado** |
| d | Validación de escala en los DTOs enumerados + `saldoInicial` (§1.2) | D | decisiones.md |
| d | Actualizar los 8 tests de aceptación | T | decisiones.md (lista exacta, verificada) |
| d | Frontend: impedir/cuantizar el input (tensión §1.2.2) | U | decisiones.md — **la forma (máscara vs recorte) sin decidir** |
| d | Barrido de los ~30 DTOs restantes (medido: 66 usos de `@IsNumberString`, 29 plata + 6 ambiguos) | D | diferido con entrada propia (decisiones.md §diferido 4) |
| e | Rama nueva en `calcularLinea` (no hay camino por resta hoy, §1.4) | S | decisiones.md |
| e | Test del caso 993 → 834 + 159 | T | decisiones.md |
| e | Documentar la consecuencia en `docs/features/impuestos.md` + separarla del defecto de f) (§1.4) | Doc | decisiones.md (parcial: no dice "separada de f") |
| f | Entrada de backlog con la evidencia completa | Doc | decisiones.md §diferido 1 |
| g | `lockVentaOriginal` +1 columna y cuantizar `:1010` con el modo heredado | S | decisiones.md |
| g | Fallback para original con config `NULL` | S | ⛔ **sin dueño** |
| g | ¿La NC congela su propio criterio usado? | E+S | ⛔ **sin dueño** (§1.5.3) |
| g | Test/mutante del fix (e lo obliga para sí; g no) | T | ⛔ **sin dueño** — cultura del repo lo exige, ningún doc lo dice |
| h | "Nombrar el dato" (`cashRounding` ≠ `decimales`) | Doc (¿o E?) | decisiones.md — **artefacto ambiguo** (§1.6) |
| i | El contrato "validar en el borde, nunca redondear" como regla de todo provider | Doc | ⛔ **sin casa** — ¿`docs/patterns/backend.md`? ¿`pagos.md`? nadie lo asigna |
| j | Documentar qué **no** hace `escala_calculo` | Doc | decisiones.md — solo honesto post-cuantización (§1.6) |
| k | Validación de escala 4 en DTOs de costo (`ajuste-costo`, `create-merma`, `ajuste-stock`, `create-item:222`) | D | decisiones.md |
| — | Espejo frontend `useMonedaConversion.ts:23` | U | decisiones.md §abierto |

**Las obligaciones sin dueño, juntas** (lo que la spec tiene que adoptar o devolver al
owner): el cierre real del modo contra el cast de Postgres (b); el fallback y el snapshot
propio de la NC (g); la semántica del 400 ante el webhook de reembolso (§5.2); el test del
fix de g; la casa del contrato de providers (i); la capa del rechazo de d (borde vs
service, §4); la escala de `montoTolerancia` (§4).

---

## 4. Los 34 tests (+2), clasificados

Verificados los 36, uno por uno (tabla completa por el agente del frente D; acá el
resultado y los que importan):

| Categoría | Cuántos | Cuáles |
|---|---|---|
| **ROMPEN** | 8 | Los 8 que d) ya nombra — su conteo **verifica exacto**: `decimal-signo.decorator.spec.ts:21/:51`, `ajustes-reparto.dto.spec.ts:30`, `linea-cierre.dto.spec.ts:20`, `dinero-signo.dto.spec.ts:58`, `monto-regla.util.spec.ts:51`, `caja.e2e-spec.ts:810/:815` |
| **DEPENDEN** | 2 | `calculo-precios.service.spec.ts:632/:633` (desbruteo): si e) se implementa **dentro del motor**, cambian de número (`15.966386` → `15.966387` — el drift de 0.000001 es exactamente lo que fijan); si e) es un paso de cuantización **al cerrar**, sobreviven intactos. Es la primera consecuencia concreta de la pregunta abierta "dónde vive la cuantización" |
| **SOBREVIVEN** | 23 | Los del motor a escala 6 (decisión j los protege), los de `mayores-restos` (sitios 8/9, ya cumplen), los de frontend con USD/UF (monedas con decimales), los dos de providers que ya afirman el criterio (`webpay-plus.provider.spec.ts:45`, `oneclick.provider.spec.ts:93`) |
| 🔴 **DESCUBIERTOS** | 3 | Los que las decisiones no contemplan — ver abajo |

**Los tres descubiertos, que son los que pediste:**

1. **`tenants.service.spec.ts:613`** — `montoTolerancia: '1.5'` round-trip. El campo
   (`NUMERIC(18,6)`, solo `@IsNumberString`, ni siquiera pasa por
   `decimal-signo.decorator.ts`) no es monto cobrado (d), no es costo (k), y **ninguna
   decisión le asigna escala ni tratamiento**. Hoy acepta cualquier cantidad de
   decimales y recorta Postgres.
2. **`caja.service.spec.ts:493`** — `montoContado: '1000.5000'` aceptado **a nivel
   service** (clamp en `caja.service.ts:731`). d) está redactada como control del borde
   de API; este test no pasa por el pipe. Si el rechazo vive solo en el DTO, el test
   sobrevive y el service queda aceptando por atrás lo que el borde rechaza; si se exige
   también en el service, el test rompe **y** hay que resolver cómo el service conoce
   `moneda.decimales` (hoy `CajaService` no lo recibe). Decisión de capa sin tomar.
3. **`caja.service.spec.ts:2198`** — `saldoInicial: '150.5'` ídem, con el agravante de
   que `caja.service.ts:247` ni clampa: pasa crudo y recorta Postgres (la "cuarta
   puerta" de la lectura, viva en el mismo campo cuyo e2e d) sí cuenta como roto).

Es el mismo patrón que la lectura ya cazó una vez ("son once → son trece"): el conteo de
d) es un piso exacto, no un techo — los gemelos están en otra capa.

---

## 5. Lo que falta decidir — y decisiones.md no lista

Su sección de abierto tiene dos entradas (dónde vive la cuantización; el espejo del
frontend). **Está incompleta.** Lo que ninguna de las once cubre y la spec no puede
resolver sola:

1. **La mecánica de `nivel = documento`** (§1.1): qué pasa con las líneas y dónde va el
   descuadre, en un documento chileno que no tiene campo para él. Es de negocio: decide
   qué imprime la boleta. Sin esto, la perilla de c) ofrece una opción indefinida.
2. **El 400 de d) contra un webhook.** El monto de la NC llega también por
   `reembolso-callback.handler.ts:36-40` (dato de la pasarela, sin
   `validarVentaElegible`). Rechazar con 400 a un humano es UX; rechazar el callback de
   Transbank es un evento perdido o un retry — ¿se rechaza, se cuantiza ahí, se loguea y
   sigue? Operativo-negocio, nadie lo preguntó.
3. **La capa del rechazo de d)** (§4.2-3): ¿solo borde de API, o también defensa en el
   service? Cambia el destino de dos tests y el plumbing de `moneda.decimales`.
4. **¿La NC congela su criterio?** (§1.5.3) — decide si una NC es auditable por sí sola,
   el mismo argumento que motivó `config_calculo` en la venta.
5. **El fallback de herencia con config `NULL`** (§1.5.2).
6. **Frontend: máscara o recorte** (§1.2.2) — el porqué de d/k lo inclina a máscara,
   pero es elección de producto.
7. **`montoTolerancia`**: escala y dueño (§4.1). Menor, pero es el único campo de plata
   de preferencias sin regla.
8. **Ratificar la asimetría de propinas** (§1.6): cobrable para d), fuera del modo para
   b). Hoy es regla implícita.

---

## 6. Riesgo contra las invariantes

- **Dinero con Decimal.js, `tenant_id` del token, soft delete:** ninguna decisión los
  toca. d) y k) refuerzan la primera (validación, no aritmética nueva). ✅
- **Aislamiento de la tanda 🔴:** f) y g) difieren explícitamente lo que no es redondeo,
  citando la regla. Las once respetan el aislamiento. ✅
- **ADR-010 — la tensión real, dicha fuerte:** ADR-010 difiere explícitamente las
  *"reglas exactas de redondeo del IVA del SII (…) se afina en la certificación"*. **e)
  decide ahora una regla de IVA** (derivarlo por resta). No es una violación — la regla
  se elige por coherencia interna ("la etiqueta manda", 2026-08-04) y congela el hecho
  fiscal en la transacción, que es exactamente lo que ADR-010 pide — pero la spec tiene
  que registrar que **si la certificación exige `IVA = tasa × base` por línea, e) se
  revierte**, y que el residuo Σ IVA-líneas vs IVA-documento sigue sin respuesta del SII
  (hueco declarado de la investigación). Es deuda de revisión conocida, no
  infraestructura especulativa.
- **ADR-010 × h):** si "nombrar el dato" se materializa como columna sin consumidor,
  repite el patrón `moneda.decimales`-sin-consumidor que este frente documentó como
  problema. Nombrar en doc no lo repite. La ambigüedad está en §1.6.
- **c) contra el patrón "no construir sin evidencia":** el choque existe y ya está
  registrado en decisiones.md como decisión consciente del owner con la contra a la
  vista. No hay nada nuevo que levantar — salvo que c.5 (el candado) siga sin diseño
  cuando la spec se escriba.
- **Motor de precios (zona 🛑):** todo el frente es la consulta que CLAUDE.md exige.
  Este análisis es parte de ese proceso; la spec y su revisión lo completan. ✅

---

## 7. Lo que no se pudo verificar

- **Nada se verificó por HTTP en vivo** — todo es lectura de código + `SELECT`. En
  particular, el 400 de `montoEntero()` y el camino del webhook no se ejercitaron.
- **No hay filas de NC en la base de dev** (83 ventas, ninguna con
  `venta_referencia_id`): el comportamiento de la NC (`config_calculo = NULL`, cabecera
  libre) está verificado solo por lectura de código.
- **Los ~30 DTOs con `@IsNumberString` no se trazaron** hasta su persistencia (por
  instrucción): solo el inventario clasificado por nombre (66 usos: 29 plata, 6
  ambiguos, 31 no-plata). El "~30" del relevamiento cuadra con la columna plata.
- **La divergencia de forma de los gemelos** (`items.service.ts:3508` modo explícito vs
  `:3580` default) se toma de la lectura independiente; esta pasada no la re-abrió.
- **El espejo `useMonedaConversion.ts:23`** ídem — verificado en la lectura, no
  re-abierto acá (el grep de esta pasada sí confirmó que ningún `.vue` fuera de formato
  de display consume `moneda.decimales`).
- **Qué hace el SII si Σ líneas ≠ `MntTotal`** — hueco heredado de la investigación,
  sigue abierto; ninguna decisión depende de resolverlo hoy, pero e) y c) conviven con
  él.
- **`montoEntero()` para monedas ≠ CLP** — solo se leyó la rama CLP; el comportamiento
  con USD decimal no se verificó.

---

## Anexo — hallazgo colateral, fuera del frente de redondeo

Al inventariar los bordes de entrada apareció un defecto **de signo, no de escala**, que
no pertenece a esta spec (el frente 🔴 va aislado) pero no puede quedar sin registrar:
**`POST /pagos` acepta montos negativos.** `PagoItemDto.monto`
(`pagos/dto/create-pago.dto.ts:18`) solo lleva `@IsNumberString` — sin
`@IsDecimalPositivo` — a diferencia de su gemelo de creación de venta
(`create-venta.dto.ts:81`, que sí lo tiene); `registrarAbono` → `registrar()`
(`pagos.service.ts:312`, `:99`) no chequea signo, la tabla `pagos` no tiene CHECK
(verificado en `pg_constraint`), y el monto entra crudo al INSERT (`:234`). Un abono
`"-500"` pasaría entero. Va como entrada propia de backlog, no de arrastre acá.
