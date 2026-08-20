# Redondeo de plata — lectura independiente: veredictos, refutación y residuos

**Fecha:** 2026-08-20
**Estado:** 📋 Lectura cerrada — **insumo para la spec, no diseño y no toca código.**
**Qué revisa:** [`2026-08-20-redondeo-de-plata-estado.md`](2026-08-20-redondeo-de-plata-estado.md)
(el relevamiento) y
[`2026-08-20-redondeo-por-linea-o-por-total.md`](../../agent/investigaciones/2026-08-20-redondeo-por-linea-o-por-total.md)
(la investigación), contrastados contra el código en `a62b49a4` (idéntico a `ccd08aef` en
`backend/src`: diff vacío) y contra la base de dev con tráfico de la suite e2e.
**Qué se decidió después de esta lectura:**
[`2026-08-20-redondeo-de-plata-decisiones.md`](2026-08-20-redondeo-de-plata-decisiones.md)
— **las once preguntas de la §6 están contestadas ahí**, y una de ellas (el nivel de
redondeo, §5) se decidió al revés de lo que esta lectura recomendaba. Leer las dos: acá está
la evidencia, allá lo que se hace con ella.
**Método:** lectura directa de los once sitios y del camino motor→persistencia→pagos→NC;
reproducción de las mediciones del §7 del relevamiento; cuatro pasadas de agentes (barrido
ampliado por conducta, inventario de tests, verificación web de pasarelas, rastreo de
consumidores) cuyos hallazgos clave se re-verificaron abriendo el código antes de afirmarse
acá. La base solo se consultó con `SELECT`.

---

## 0. El titular

1. **El "son once" se refuta por su propia conducta declarada: son al menos trece.** Los
   gemelos de escritura del costo de receta y combo (`items.service.ts:3508` y `:3580`)
   son la misma multiplicación → redondeo → persistencia que los sitios 3 y 4, y quedaron
   afuera. El patrón "cuatro→once" del backlog se repitió en chico.
2. **Hay dos clases enteras que el barrido por conducta no puede ver:** plata que entra
   cruda por DTO y la redondea **Postgres** (`pagos.monto`, movimientos de caja), y clamps
   de input a 4 decimales con HALF_UP fijo (propinas manuales, ajuste de costo, contado del
   cierre, precio al aplicar desfases). La tabla de "tres capas" tiene una cuarta puerta.
3. **Las mediciones del relevamiento reproducen casi todas.** Excepciones: el conteo "113
   en 17 archivos" no reproduce (106 líneas / 108 ocurrencias, mismos 17 archivos) y el
   "PATCH" es un PUT. Todo lo demás: exacto.
4. **El dato de pasarelas del owner es mitad cierto.** Transbank confirmado (CLP entero, y
   el repo ya lo implementa **rechazando** en el borde). Colombia refutado: la escala no es
   del país — **Wompi cobra ×100 y PayU/MercadoPago/ePayco cobran pesos directos**. La
   escala del cable es de cada provider; el dominio solo necesita el monto exacto en
   `moneda.decimales`.
5. **La cascada del medio peso está medida completa:** IVA sobre base descontada (19% ×
   14.250 = 2.707,5) → `total_linea` → `total_final` → **`pagos.vuelto` = `994942.5000`**.
   Y esas ventas serían **incobrables por Webpay hoy**: `montoEntero()` valida y tira 400,
   no redondea.
6. **Cuantizar todo cierra las identidades aditivas por construcción, pero deja tres
   residuos multiplicativos** (desbruteo vs góndola, Σ IVA de línea vs IVA de documento,
   `MontoItem` vs `PrcItem × QtyItem`) **y un hueco que no es de redondeo y pesa más: el
   descuento de nivel venta no toca la base del IVA.**
7. **Costos: precisión propia**, con evidencia estructural de este repo (cadena cerrada,
   amplificación ×1000 por unidad base, el corte tasa/monto ya existe en
   `precio_unitario`). Pero el corte del alcance es por campo, no por sitio: de los once,
   el único que se *toca* es el 11 — el trabajo real está donde el relevamiento no miraba.

---

## 1. Veredictos por sitio

Contexto común, verificado: los once números de línea coinciden exactos con el código
actual (sin drift); los once son HALF_UP en la práctica —explícito o default de Decimal.js,
sin ningún `Decimal.set()` global que lo cambie—; ninguno mira `modo_redondeo`.

| # | Sitio | Tasa o monto | Persiste | Veredicto |
|---|---|---|---|---|
| 1 | `inventario.service.ts:410` (CPP) | tasa | sí (`item_producto.costo_actual`) | **queda como está** |
| 2 | `inventario.service.ts:914` (kardex) | monto informativo | no (proyección) | **queda como está** |
| 3 | `items.service.ts:3879` (costo receta) | tasa | al aplicar (`item_receta.costo_actual`) | **queda — con su gemelo `:3508`** |
| 4 | `items.service.ts:4017` (costo combo) | tasa | al aplicar (`item_combo.costo_actual`) | **queda — con su gemelo `:3580`** |
| 5 | `items.service.ts:3697` (precio sugerido) | tasa (propuesta) | no (el usuario decide) | **queda como está** |
| 6 | `mermas.service.ts:200` | monto informativo | no (respuesta HTTP) | **queda como está** |
| 7 | `mermas.service.ts:343` | monto informativo | no (listado) | **queda como está** |
| 8 | `mayores-restos.ts:44` | monto | sí (liquidación) | **queda — ya cumple el criterio decidido** |
| 9 | `mayores-restos.ts:75` | monto | sí (liquidación) | **queda — ídem** |
| 10 | `costo-conversion-unidad.util.ts:28` | tasa | sí (kardex/CPP vía `registrarMovimiento`) | **queda como está** |
| 11 | `ventas.service.ts:1010` (línea NC) | **monto cobrable** | **sí** (`venta_detalles`) | **MAL — viola el criterio decidido** |

### Sitio 1 — `calcularCostoPromedio`, `inventario.service.ts:410`

- **Qué representa:** CPP tras una compra — `(valorPrevio + valorEntrante) ÷ stock`. Es
  una **tasa**: dinero por unidad base de stock, no un monto que alguien paga.
- **Quién lo consume:** persiste en `item_producto.costo_actual` (`NUMERIC(18,4)`, UPDATE
  en `inventario.service.ts:293-297`) y alimenta el CPP siguiente, el costo de
  recetas/combos, el costo de mermas, el margen y el precio sugerido. Nunca llega a un
  documento de venta.
- **Veredicto: queda como está** (escala 4, HALF_UP fijo), condicionado a la decisión de
  costos (§4). `modo_redondeo` **no** debe aplicar: es la política de redondeo de lo que se
  cobra, y un tenant en `FLOOR` sesgaría la valorización del inventario hacia abajo en cada
  compra, con el error compuesto promedio tras promedio.
- **Matiz que el relevamiento no nombra:** el mismo método tiene una segunda salida en la
  rama sin stock previo (`:403`, `compra.toFixed(4)`) — el clamp del costo de compra
  tipeado por el usuario. El veredicto cubre el método entero.
- **Comentario propuesto:**

  ```
  // HALF_UP fijo a escala de costo (4): el CPP es una tasa interna —dinero por
  // unidad base de stock—, no un monto cobrable, y por eso no mira modo_redondeo:
  // esa perilla es la política de lo que se le cobra al cliente. Un tenant en
  // FLOOR/CEIL sesgaría acá la valorización en cada compra, compuesto en cada
  // promedio. La escala de la moneda tampoco aplica: hay costos por gramo (< $1).
  ```

### Sitio 2 — costo perdido del kardex, `inventario.service.ts:914`

- **Qué representa:** `cantidad × costo_unitario` congelado del movimiento. **Monto
  informativo**, proyección de lectura pura — verificado: no existe columna
  `costo_perdido`; se recalcula en cada `GET /inventario/movimientos`.
- **Veredicto: queda como está.** Deriva de dos datos ya persistidos a escala 4; aplicarle
  el `modo_redondeo` vigente haría que un reporte histórico cambie con la config de hoy. El
  formateo a moneda es del frontend.
- **Comentario propuesto:**

  ```
  // Proyección de lectura: cantidad × costo congelado del kardex, a escala de
  // costo (4). Nadie paga este número y no se persiste. Redondearlo con la config
  // vigente haría que el historial cambie al cambiar la preferencia del tenant;
  // el formateo a moneda es de presentación, no de acá.
  ```

### Sitios 3 y 4 — costo propuesto de receta y combo, `items.service.ts:3879` y `:4017`

- **Qué representan:** Σ(costo del insumo × cantidad) — **tasas** (costo por unidad de
  receta/combo). Proyección en la bandeja de desfases; persisten en
  `item_receta.costo_actual` / `item_combo.costo_actual` si el usuario aplica
  (`items.service.ts:4285` / `:4338`).
- **Veredicto: quedan como están** (escala 4, HALF_UP), **pero el veredicto está incompleto
  si no alcanza a sus gemelos de escritura** (§2): la misma cuenta vive en
  `validarYCostearIngredientes` (`:3508`) y `validarYCostearComponentes` (`:3580`), que es
  lo que se persiste al **crear o editar** la receta/combo (llamadores `:1069`/`:1636` y
  `:1120`/`:1706`). Si los pares divergieran en criterio, la bandeja de desfases compararía
  manzanas con peras: el ocultamiento usa `eq4` (`items.service.ts:3669`). Hoy ya divergen
  en **forma**: `:3508` pasa el modo explícito, `:3580` usa el default.
- **Comentario propuesto (para los cuatro, cruzándose entre sí):**

  ```
  // Costo por unidad de receta/combo: tasa interna a escala de costo (4), HALF_UP
  // fijo — mismo criterio que el CPP. La MISMA cuenta vive dos veces: acá y en
  // validarYCostear{Ingredientes,Componentes} (el camino de escritura al crear o
  // editar). Si cambiás el criterio en una, cambialo en la otra: la bandeja de
  // desfases compara ambos resultados con eq4 y un criterio distinto la hace
  // proponer o esconder desfases fantasma.
  ```

### Sitio 5 — precio sugerido, `items.service.ts:3697`

- **Qué representa:** `costoNuevo × precioViejo ÷ costoViejo` — una **propuesta de precio
  de lista** (tasa: el precio unitario es dinero por unidad, y el SII le da 6 decimales a
  `PrcItem`). No persiste por sí sola: prellena `precioEditado` en `DesfasesPanel.vue`, el
  usuario lo edita, y lo que persiste pasa por `items.service.ts:4292`.
- **Veredicto: queda como está.** Cuantizarlo a la escala de exhibición (que el prefill no
  muestre `5987.3456` en CLP) sería pulido de UX, no corrección contable.
- **Comentario propuesto:**

  ```
  // Propuesta de precio de lista que preserva el margen: tasa, no monto (el
  // precio unitario tiene decimales propios — el propio SII da 6 a PrcItem).
  // Escala 4 solo para viajar en el DTO; el precio real lo decide el usuario al
  // aplicar el desfase. Cuantizarlo a la escala de la moneda sería UX del
  // prefill, no una corrección.
  ```

### Sitios 6 y 7 — costo de merma, `mermas.service.ts:200` y `:343`

- **Qué representan:** `cantidad × costo congelado` — **montos informativos**, proyección
  pura (verificado: sin columna; `:200` es la respuesta del POST para el upsert del front,
  `:343` el listado).
- **Veredicto: quedan como están.** Mismo razonamiento y mismo comentario que el sitio 2.

### Sitios 8 y 9 — mayores restos, `mayores-restos.ts:44` y `:75`

- **Qué representan:** montos repartidos. `:44` lleva el total del grupo a unidades mínimas
  enteras (con `decimales` congelados en la liquidación); `:75` reconvierte cada cuota.
  Persisten en `liquidacion_propinas_grupo.monto_grupo` y el monto por participante.
- **Veredicto: quedan como están — es el único lugar del repo que ya cumple el criterio
  decidido** (escala de la moneda al cerrar el documento). `modo_redondeo` **no** debe
  entrar al reparto: floor + mayores restos es apportionment — la garantía Σ partes = total
  no depende de ningún modo, y abrirla a config es romper lo que el método compra. El único
  HALF_UP real es el de `:44` al cuantizar el total del grupo; queda fijo mientras la plata
  de propinas entre sin cuantizar aguas arriba.
- **Comentario propuesto (en `:44`):**

  ```
  // El monto del grupo se lleva a unidades mínimas ENTERAS de la moneda
  // (decimales congelados en la liquidación) con HALF_UP fijo, y recién ahí se
  // reparte. El reparto (floor + mayores restos) garantiza Σ partes = total con
  // cualquier modo: modo_redondeo no entra acá a propósito — en un apportionment
  // no hay "modo" que elegir, solo el desempate, que es determinista por id.
  ```

### Sitio 10 — `costo-conversion-unidad.util.ts:28`

- **Qué representa:** `(cantidadIngresada × costoUnitario) ÷ cantidadBase` — **tasa**
  (costo por unidad base). Sus tres llamadores de producción terminan en
  `registrarMovimiento`: kardex y CPP.
- **Veredicto: queda como está** (escala 4, HALF_UP), con la obligación del espejo
  (`useUnidadConversion.convertirCosto`, confirmado por ambos docblocks).
- **Comentario propuesto** (el docblock ya explica el espejo; falta la línea de criterio):

  ```
  // Escala de costo (4), HALF_UP fijo: tasa interna, misma familia que el CPP —
  // no mira modo_redondeo ni la escala de la moneda (hay costos por gramo).
  ```

### Sitio 11 — línea de nota de crédito, `ventas.service.ts:1010`

- **Qué representa:** `precioUnitario × cantidad` → `venta_detalles.subtotal` y
  `.total_linea` de la NC. **Monto cobrable persistido en un documento de venta.**
- **Veredicto: MAL — el único de los once que viola el criterio ya decidido.** Con
  `precio_unitario` a 4 decimales y cantidad fraccionaria, persiste medios pesos en CLP;
  usa HALF_UP fijo cuando la venta original congeló su `config_calculo` con el modo del
  tenant (verificado en la base: el JSON congelado incluye `modoRedondeo`); y no lo dispara
  solo el humano — también el webhook de reembolso de la pasarela
  (`reembolso-callback.handler.ts:36`).
- **Y alrededor hay algo más grande que el redondeo** (§6.2): la cabecera de la NC es
  `params.monto` del cliente, con `totalImpuestos: '0'` fijo (`ventas.service.ts:1001`) y
  **ninguna relación exigida entre Σ líneas y el monto de cabecera**.
- **Comentario propuesto (post-arreglo):**

  ```
  // Línea de NC: monto cobrable — se cuantiza a los decimales de la moneda con el
  // modo_redondeo CONGELADO en el config_calculo de la venta referenciada (la NC
  // corrige aquel documento: hereda su criterio, no el vigente). Antes quedaba en
  // HALF_UP fijo a 4 decimales y persistía medios pesos en CLP.
  ```

---

## 2. Refutación

### 2.1 Números que el código contradice

| Afirmación del relevamiento | Lo medido | Peso |
|---|---|---|
| "113 apariciones en 17 archivos" | **106 líneas / 108 ocurrencias en 17 archivos** (`grep -rn "toFixed(4\|toDecimalPlaces(4" backend/src --include="*.ts" \| grep -v .spec.`; con `-o`: 108). Ninguna variante natural da 113 (con specs: 109; backend+frontend: 121/29 archivos), y `backend/src` no cambió desde `ccd08aef` (diff vacío). El "17 archivos" sí calza | menor |
| "se activa con un `PATCH`" | Es `PUT` (`tenants.controller.ts:296`) | cosmético |
| "19 sitios matchean; 11 son plata" | Con el grep ampliado (`Math.*`, `.round(`, `.floor(`, `.ceil(`, `.trunc(`, `.toNearest(`) son **128 hits en 20 archivos**, y por la propia conducta declarada del barrido los sitios de plata son **≥13** (§2.2) | **mayor** |

**Reproducen exactas:** el cast de Postgres (`10.0001 / -10.0001 / 10.0000` — media hacia
afuera del cero), los dos totales `16957.5000`/`5057.5000` en CLP-0, `ESCALA_PERSISTIDA`
(declaración en `calculo-precios.service.ts:31`, usos `:403`/`:404`, ningún otro archivo),
`moneda.decimales` solo en propinas + el endpoint que lista (`liquidacion-propinas.service.ts`,
su entity, `monedas.service.ts`), los defaults (`tenant.entity.ts:39` HALF_UP /
`escala_calculo` 6, `seeder.service.ts:1115-1116`, `tenants.service.ts:202-203`, DTO
`update-preferencias-financieras.dto.ts:30`), los dos espejos del frontend
(`useMonedaConversion.ts:19-23` — el comentario "Misma lógica que el backend" sobre un
`toFixed(4)` sin `modo_redondeo`, usado en `CatalogoGrid.vue:99`, `CarritoPanel.vue:207` y
`CarritoOnline.vue:70`; `useUnidadConversion.ts:32`/`:44` `convertirCosto`), la siembra
CLP=0 / USD=2 / UF=4, y las once líneas de la tabla sin drift.

### 2.2 Sitios de plata que el barrido dejó afuera

**De la misma conducta declarada (multiplicación → redondeo → persiste):**

1. **`items.service.ts:3508`** — `validarYCostearIngredientes`: el costo de una **receta**
   al **crearla o editarla** (llamadores `:1069` y `:1636`), Σ(costo × cantidadBase) →
   `toDecimalPlaces(4, ROUND_HALF_UP)` → persistido en `item_receta.costo_actual`. Gemelo
   de escritura del sitio 3 — el relevamiento listó la *propuesta* y omitió la *escritura
   real*.
2. **`items.service.ts:3580`** — ídem para **combo** (`validarYCostearComponentes`,
   llamadores `:1120` y `:1706`) → `item_combo.costo_actual`. Gemelo del sitio 4. Además
   usa `toDecimalPlaces(4)` **sin modo explícito** — hasta la forma diverge de su par.

**Plata redondeada sin multiplicación previa (clamp de input, HALF_UP fijo) — el criterio
del barrido las excluye por definición, pero son plata que se redondea y persiste:**

3. **`items.service.ts:4292` y `:4344`** — el **precio de venta** que el usuario confirma
   al aplicar un desfase (`it.precioBase`, viene del cliente), redondeado HALF_UP fijo y
   persistido en `items.precio_base`, sin pasar por el motor ni su `modo_redondeo`.
4. **Familia de clamps a 4 decimales de montos tipeados:**
   - propina sugerida y pagada: `venta-propina.service.ts:56-57` →
     `venta_propina.monto_sugerido` / `.monto_pagado`;
   - montos manuales de liquidación de propinas — plata que se le paga a una persona —:
     `liquidacion-propinas.service.ts:980`, `:1033`, `:1070`, `:1507`;
   - ajuste de costo: `inventario.service.ts:227`, `:353` (más la rama `:403` del CPP);
   - contado del cierre de caja: `caja.service.ts:731` (lo que el cajero tipeó al contar,
     antes de calcular la diferencia de arqueo).

**Y la clase más severa — plata que entra cruda y la redondea Postgres, no el código:**

5. **`pagos.service.ts:234`** — `Pago.monto` se inserta con el string crudo del DTO. El
   validador (`decimal-signo.decorator.ts`, leído completo) valida **signo y formato,
   nada de escala**: un `POST` con `monto: '1000.55555'` entra y el recorte a
   `NUMERIC(18,4)` lo hace Postgres con su regla (media hacia afuera del cero), no con la
   del sistema. Alcanzable desde creación de venta y desde `registrarAbono`.
6. **`caja.service.ts:946`** — `MovimientoCaja.monto`, mismo patrón, alcanzable desde el
   endpoint de movimiento manual (`:997`).

Esto corrige la tabla de "tres capas" del §1 del relevamiento **por omisión**: hay una
**cuarta puerta** — la plata que *entra* por API. "El último redondeo lo decide Postgres"
no aplica solo a los strings del motor a escala 6: aplica a cualquier monto que un cliente
mande con más de 4 decimales. Queda anotado honesto: hay ~30 DTOs más con `@IsNumberString`
sin trazar hasta su punto de persistencia — la misma auditoría podría encontrar más.

**Observación aparte (no es un sitio):** `personalizacion-receta.util.ts:100`
(`precioExtra × unidades`) toca plata y **no redondea nada** — hoy inofensivo porque
`unidades` está forzado a entero, pero es el único monto mostrado sin ninguna llamada de
redondeo; si algún día las unidades admiten fracción, el redondeo real va a ocurrir donde
el docblock del motor ya lo anticipa.

**Los excluidos del relevamiento, verificados uno por uno: bien excluidos.**
`cantidad-presentacion.util.ts:165/:247` y `catalog.service.ts:177` convierten cantidad,
`horas-interseccion.ts:16` horas, `items.service.ts:3680` un porcentaje,
`propina-distribucion.service.ts:269` un mensaje de error.

### 2.3 Clasificaciones

Las once están **bien clasificadas** (tasa/monto, persiste/proyección) — verificado sitio
por sitio y con el rastreo independiente de consumidores. Dos matices: los sitios 3/4 son
"proyección **y** escritura", con la escritura en otro método que la tabla no vio; y el
sitio 11 tiene un disparador automático (webhook de reembolso) además del manual.

---

## 3. Cuántas cuantizaciones, y dónde

### 3.1 Verificado en el motor

El motor suma `totalLinea` (`calculo-precios.engine.ts:629`) y aplica las reglas de venta
después, sobre el agregado, con `totalFinal = Σ totalLinea − dv + rv` (`:685`). **Redondear
cada línea a peso entero no deja el total entero:** las reglas de venta redondean su monto
en `:453` (`procesarReglas` es compartido entre nivel línea y nivel venta) a
`escala_calculo`, y un % sobre un agregado entero produce decimales. La cuantización tiene
que alcanzar a las reglas de venta, no solo a las líneas.

### 3.2 La cascada, medida en la base de dev

Los dos totales decimales nacen del IVA sobre base descontada:

```
total_bruto 15000 − descuento 750 → base 14250 × 19% = 2707.5 → total_final 16957.5
total_bruto  5000 − descuento 750 → base  4250 × 19% =  807.5 → total_final  5057.5
```

Bajan a `venta_detalles.total_linea` e `impuesto_aplicado` (2 filas cada uno), a
`ventas_impuestos.valor_aplicado` (2), y terminan en **`pagos.vuelto`: `994942.5000` y
`983042.5000`** — medio peso de vuelto en efectivo, dos veces, por el camino normal de la
venta (pago de `1000000.0000`). `venta_detalles.subtotal` y `precio_unitario`: 0 filas con
decimales; `pagos.monto` y `ventas_descuentos.valor_aplicado`: 0; `item_producto.costo_actual`:
1 (un CPP — costo, esperable).

**Y el remate:** si esas ventas se cobraran por Webpay, **el provider las rechaza** —
`webpay-plus.provider.ts:90-95` (`montoEntero()`: *"Transbank cobra CLP en enteros: validar
y convertir en el borde"*) tira `BadRequestException` con CLP decimal, no redondea. Ídem
`oneclick.provider.ts:86`. El total decimal no es solo mal formado: es **incobrable** por
la pasarela real. Es exactamente el hueco que la investigación del 15 llamó *"el momento
cobrable no tiene dueño"*, ahora con el punto de falla concreto.

### 3.3 Campos que pueden quedar con decimales aunque las líneas sean enteras

- `ventas_descuentos` / `ventas_recargos` `.valor_aplicado` de reglas **de nivel venta**, y
  con ellos `total_descuentos`, `total_recargos` y `total_final` (§3.1).
- Toda la plata que **no pasa por el motor**: `pagos.monto` (cliente),
  `venta_propina.monto_pagado`/`monto_sugerido` (cliente), la NC entera (cabecera
  `params.monto` + líneas del sitio 11), movimientos manuales de caja, contado del cierre.
- `pagos.vuelto` y los saldos son restas: **heredan** lo que haya — el target del cobro es
  `totalFinal + propina` (`ventas.service.ts:768`), así que una propina decimal contamina
  el vuelto aunque el total sea entero.
- `base_ventas_sin_impuestos` (`ventas.service.ts:417-419`) es resta de dos campos: entera
  si sus componentes lo son.

### 3.4 ¿Cuantizar todo campo cierra el DTE por construcción?

Las identidades **aditivas** sí: `totalFinal = Σ líneas − dv + rv` es suma de enteros, y
`MntTotal = MntNeto + IVA` cierra si cada campo es entero. Las **multiplicativas** no, y no
pueden — tres residuos y un hueco:

1. **Desbruteo (el residuo que más duele).** Con precio-incluye-impuesto y cuantización
   entera: góndola $993 → neto `round(993/1.19)` = 834 → IVA `round(834×0.19)` = 158 →
   total **992**. Un peso menos que la etiqueta (calculado con HALF_UP entero; 995, 997,
   1000 y 1990 sí cierran). La decisión del 2026-08-04 ("la etiqueta manda") empuja a
   derivar el IVA por resta para que cierre a góndola — pero nadie la tomó para el
   redondeo. Hoy a escala 6 el drift es de 0.000001 e invisible; a escala entera es un peso
   visible. Hay que elegir qué identidad cede (§6.4).
2. **Σ IVA por línea vs IVA del documento.** El formato DTE define `IVA` a nivel documento
   (tasa × `MntNeto`); la suma de IVAs enteros por línea puede diferir en hasta ⌈N/2⌉ pesos
   con N líneas. Qué tolera el SII es el hueco ya declarado por la investigación — sigue
   abierto.
3. **`MontoItem` vs `PrcItem × QtyItem`.** Con 6 decimales en precio y cantidad, el monto
   entero de línea nunca puede igualar el producto exacto — residuo ≤ 0,5 por línea,
   inherente al propio formato del SII. Se acepta, no se resuelve.
4. **Y un hueco que no es de redondeo y pesa más:** el paso `impuestos` **no corre a nivel
   venta** (`calculo-precios.engine.ts:633-634`) — un descuento de venta reduce lo cobrado
   pero **no la base del IVA**. Un DTE con `DscRcgGlobal` afecto exige IVA sobre la base
   descontada: hoy divergirían en el 19% del descuento global. Ninguna cuantización lo
   arregla; es pregunta de spec (§6.1).

### 3.5 Tests que afirman plata con decimales: 34

26 comparan un valor con decimales; **8 son de aceptación** — afirman que un monto decimal
**es válido** (validación en verde o HTTP 201), que es literalmente lo que se rompe si la
escala se exige en el borde. Cuáles caen depende de **dónde** cuantice la spec: si solo al
cerrar la venta, los del engine a escala 6 sobreviven; si la escala se exige en el DTO,
caen los 8 de aceptación y los dos e2e de caja.

| Archivo:línea | Capa | Valor / estilo |
|---|---|---|
| `calculo-precios.engine.spec.ts:140` | unit backend | `17.100000` |
| `calculo-precios.engine.spec.ts:141` | unit backend | `107.100000` |
| `calculo-precios.engine.spec.ts:335` | unit backend | `11.900000` |
| `calculo-precios.engine.spec.ts:336` | unit backend | `107.100000` |
| `calculo-precios.engine.spec.ts:451` | unit backend | `12.35` (HALF_UP en el límite) |
| `calculo-precios.engine.spec.ts:461` | unit backend | `12.34` (FLOOR trunca) |
| `calculo-precios.engine.spec.ts:1087` | unit backend | `17.100000` |
| `calculo-precios.service.spec.ts:164` | unit backend | `17.100000` |
| `calculo-precios.service.spec.ts:165` | unit backend | `107.100000` |
| `calculo-precios.service.spec.ts:327` | unit backend | `321.300000` |
| `calculo-precios.service.spec.ts:394` | unit backend | `107.100000` |
| `calculo-precios.service.spec.ts:632` | unit backend | `84.033613` (desbruteo) |
| `calculo-precios.service.spec.ts:633` | unit backend | `15.966386` (desbruteo) |
| `tenants.service.spec.ts:613` | unit backend | `1.5` |
| `caja.service.spec.ts:493` | unit backend | `0.5000` (diferencia de arqueo) |
| `caja.service.spec.ts:2198` | unit backend | `150.5` (saldoInicial) |
| `mayores-restos.spec.ts:39` | unit backend | `3.34` |
| `mayores-restos.spec.ts:40` | unit backend | `3.34` |
| `mayores-restos.spec.ts:41` | unit backend | `3.33` |
| `mayores-restos.spec.ts:51` | unit backend | `1234.56` |
| `decimal-signo.decorator.spec.ts:21` | unit backend | `10.50` **[aceptación]** |
| `decimal-signo.decorator.spec.ts:51` | unit backend | `10.50` **[aceptación]** |
| `ajustes-reparto.dto.spec.ts:30` | unit backend | `5000.5000` **[aceptación]** |
| `linea-cierre.dto.spec.ts:20` | unit backend | `15300.50` **[aceptación]** |
| `dinero-signo.dto.spec.ts:58` | unit backend | `1500.5000` (precioBase) **[aceptación]** |
| `monto-regla.util.spec.ts:51` | unit backend | `0.10` **[aceptación]** |
| `caja.e2e-spec.ts:810` | e2e API | `10000.5000` → 201 **[aceptación]** |
| `caja.e2e-spec.ts:815` | e2e API | `10000.5000` → 201 **[aceptación]** |
| `useVenta.spec.ts:594` | unit frontend | `0.3` (sumaPagos) |
| `currency-format.spec.ts:73` | unit frontend | `1500.5 → '$1,500.50'` (USD) |
| `currency-format.spec.ts:78` | unit frontend | `1234.5678 → '$1.234,5678'` (UF) |
| `currency-format.spec.ts:93` | unit frontend | `1500.5` (USD) |
| `currency-format.spec.ts:98` | unit frontend | `99.1234` (UF) |
| `MoneyInput.spec.ts:125` | unit frontend | `1500.5` (moneda con decimales > 0) |

Y **dos specs ya afirman el criterio decidido**, en la dirección contraria:
`webpay-plus.provider.spec.ts:45` ("CLP con decimales es rechazado") y
`oneclick.provider.spec.ts:93` ("autorizarCobro rechaza montos CLP con decimales").

---

## 4. Costos: precisión propia — la lectura de este código

**La evidencia más fuerte no es de mercado; es estructural del repo:**

1. **La cadena de costos es cerrada.** CPP → `costo_actual` → costo de receta/combo →
   merma/kardex: ningún eslabón toca un documento de venta. El único puente hacia lo
   cobrado es `precioSugerido`, que es una propuesta que un humano edita y confirma.
   Cuantizar la cadena no le mejora nada a nadie que cobre.
2. **La amplificación es real y está en la base.** Los costos son por **unidad base**: hay
   ítems en gramos con costo `5.0000/g` (medido en dev; distribución: 53 ítems en `unidad`,
   14 en `kg` de 3.000-10.000, 3 en `g`, 1 CPP con decimales). Un CPP cuantizado a peso
   entero mete hasta 10% de error por gramo, multiplicado ×1000 al costear un kilo.
   `convertirCostoUnitario` divide por `cantidadBase` y produciría ceros.
3. **El sistema ya hace el corte tasa/monto en su campo más importante:** `precio_unitario`
   persiste a 4 decimales por decisión documentada y con test que la fija
   (`ESCALA_PERSISTIDA`, [`motor-calculo-precios.md`](../../features/motor-calculo-precios.md)
   §"conversión a moneda oficial"). Los costos son el mismo animal del otro lado del
   mostrador.
4. **El contraejemplo (NetSuite) no aplica acá:** ata el costo promedio a la moneda en un
   modelo donde la unidad de stock típica es "each". Este repo costea por gramo — es
   exactamente el caso que SAP resuelve con price-unit.

**Ojo con la aritmética de "si vale, son seis":** el corte correcto no es por sitio sino
por **naturaleza del campo**. Con los costos afuera quedan: 8/9 (ya están bien), 11 (mal,
se arregla) y el 5 (tasa, afuera también). De los once originales el único que se *toca* es
el 11 — **el trabajo real del frente está donde el relevamiento no miraba**: las reglas de
venta del motor, la plata que entra por DTO, y la NC como documento.

Sub-pregunta que esto abre (nadie la hizo): ¿`modo_redondeo` aplica a costos? Lectura de
esta pasada: **no** — es política de cobro, no de medición, y FLOOR/CEIL sesgan la
valorización. Pero es decisión del owner (§6.5).

---

## 5. La recomendación (configurable, por línea, derivación diferida) — atacada

> ✅ **Decidido el 2026-08-20, y en contra de lo que esta sección concluye:** el owner
> eligió **construir la perilla configurable ahora**, con "por línea" de default. Lo que
> sigue no se archiva: los cuatro puntos de abajo pasan de ser un argumento a ser **la lista
> de lo que la spec tiene que resolver** para que la perilla no prometa algo que el motor no
> entrega — sobre todo el punto 1, que es un defecto real y medido, no una objeción de
> diseño. Ver [decisión (c)](2026-08-20-redondeo-de-plata-decisiones.md).

**Lo que la hace fallar hoy, en este motor:**

1. **Su justificación principal es falsa en cuanto hay reglas de nivel venta.** "Por línea
   hace que Σ líneas = total por construcción" — no acá: `totalFinal = Σ totalLinea − dv +
   rv` (`calculo-precios.engine.ts:685`). Con un descuento de venta, el cliente que suma el
   ticket impreso **tampoco llega al total en modo por-línea** — que era además el
   argumento de verificabilidad. La promesa se restituye solo si la spec define qué son
   dv/rv en el documento (¿campos de documento cuantizados, tipo `DscRcgGlobal`?
   ¿repartidos a líneas?). Hoy esa pregunta no existe en ningún doc.
2. **El nivel no es la variable que cierra el desglose fiscal.** Aunque el nivel sea
   "línea" y todo sea entero, el IVA no ve las reglas de venta (§3.4.4) y el desbruteo
   puede no reproducir la góndola (§3.4.1). La perilla elige dónde cae el residuo *chico*;
   los descuadres grandes están en otro lado.
3. **La perilla nace sin consumidor.** El 100% de los tenants queda en el default (lo dice
   la propia investigación), Chile no fija nivel, y UK/México necesitan **candado**, no
   preferencia — que la recomendación misma reconoce ("fijado desde afuera"). Construirla
   hoy contradice el patrón del repo (no construir sin evidencia: el reconciliador,
   ADR-010). Lectura de esta pasada: **la misma lógica de la recomendación, aplicada un
   paso antes** — nivel fijo por diseño (por línea), documentado y **congelado en
   `config_calculo`** (verificado en la base: el JSON congelado ya guarda
   `modoRedondeo`/`escalaCalculo`/`formula`/`calculoDescuentos`/`calculoRecargos` —
   `nivelRedondeo` y `decimalesMoneda` tienen su lugar natural ahí), y la perilla recién
   cuando exista quien la necesite.
4. **Si la perilla igual se construye, lo que hay que cubrir:** el freeze por venta (ya
   resuelto por `config_calculo`), la matriz de interacción con `modo_redondeo` ×
   `escala_calculo` (la investigación ya duda de la segunda), y que NC y reembolsos hereden
   el nivel congelado de la venta original, no el vigente.

**Donde esta lectura coincide:** el default por línea es correcto para este código — es la
arquitectura que el motor ya tiene (calcula por línea y suma), y el reparto tipo
mayores-restos para ventas sería inventar un problema (la investigación misma lo dice: es
el caso de la propina, no el de la venta).

---

## 6. Lo que falta preguntarle al owner — que ningún documento pregunta

> ✅ **Las ocho quedaron contestadas el 2026-08-20**, junto con las tres que la investigación
> tenía abiertas. Las respuestas, con su porqué y con lo que cada una obliga, están en
> [`2026-08-20-redondeo-de-plata-decisiones.md`](2026-08-20-redondeo-de-plata-decisiones.md):
> 1→(f), 2→(g), 3→(d), 4→(e), 5→(b), 6→(h), 7→(i), 8→(d)+(k). **Esta sección queda como el
> registro de por qué había que preguntarlas**, no como lista de pendientes.

1. **¿El descuento/recargo de nivel venta afecta la base del IVA?** Hoy no
   (`calculo-precios.engine.ts:633`), y un DTE con descuento global afecto exige que sí. Es
   la divergencia más grande del frente y no es de redondeo. Si la respuesta es "sí",
   cambia el motor; si es "no", hay que poder decir por qué la boleta muestra un IVA que no
   es el 19% de nada visible.
2. **La NC como documento: ¿debe desglosar IVA y cuadrar cabecera↔líneas?** Hoy
   `totalImpuestos = '0'` fijo, la cabecera es un monto libre del cliente (validado solo
   contra el disponible), y las líneas son informativas sin relación exigida con ese monto
   (`ventas.service.ts:998-1004`). Cualquier criterio de redondeo para la NC presupone
   contestar esto primero. Sub-pregunta: ¿la NC hereda el `modo_redondeo` congelado de la
   venta original o usa el vigente?
3. **La plata que entra por API con más decimales que la moneda: ¿se rechaza o se cuantiza
   en silencio?** Hoy decide Postgres (pagos, movimientos de caja) o un clamp HALF_UP fijo
   (propinas, contado, ajuste de costo). Rechazar es honesto con lo que el cajero tipeó;
   cuantizar cambia lo que el cliente pagó sin avisar. Webpay ya eligió: rechaza.
4. **Cuando neto + IVA no reproduce la góndola a escala entera (993 → 992): ¿qué cede?**
   ¿El IVA se deriva por resta para que cierre a la etiqueta (coherente con "la etiqueta
   manda", 2026-08-04), o la fórmula IVA = tasa × base es intocable y el total puede
   diferir un peso de góndola × cantidad? Nadie lo decidió y a escala entera deja de ser
   invisible.
5. **¿`modo_redondeo` aplica a costos o solo a montos cobrados?** Los once sitios comparten
   hoy el HALF_UP por accidente; los veredictos del §1 asumen "solo cobro" — confirmarlo
   evita que alguien "complete" el arreglo hacia los costos.
6. **¿La denominación mínima física entra como dato aparte?** `moneda.decimales = 0` dice
   que el peso existe; la moneda física más chica en Chile es $10. Son dos datos (CLDR:
   `digits` vs `cashRounding`) y el proyecto tiene uno. La investigación pregunta si el
   redondeo de efectivo entra al alcance; no pregunta con qué **dato**.
7. **La escala del monto cobrable es del provider, no del país ni de la moneda — ¿se
   ratifica ese modelo?** El dato de campo se verifica a medias: Transbank confirmado
   (*"Formato número entero para transacciones en peso y decimal para transacciones en
   dólares"* — y el repo ya lo implementa en el borde, `webpay-plus.provider.ts:89-95`).
   Pero Colombia refuta la tabla país→escala: **Wompi cobra en centavos**
   (`amount_in_cents`: *"if you wish to charge $95.000 COP, you will enter: 9500000"*), y
   **PayU** (*"este valor no puede tener decimales"*, `value: 65000`), **MercadoPago**
   (`transaction_amount: 100` en pesos) y **ePayco** mandan pesos directos. Mismo país,
   misma moneda, dos formatos. Conclusión: el "monto cobrable" **no necesita una escala
   propia en el dominio** — necesita ser exacto en `moneda.decimales`, y la conversión al
   formato de cable (×100 o no) es de cada provider en su adaptador, como `montoEntero()`
   ya hace.
8. **Los clamps de input a 4 decimales** (propinas manuales, ajuste de costo, contado,
   precio al aplicar desfase): ¿mismo tratamiento que la pregunta 3, o se documentan como
   escala de captura y quedan?

---

## 7. Cómo reproducir lo medido en esta pasada

```bash
# El conteo real de la escala 4 a mano (da 106 líneas / 108 con -o, 17 archivos — no 113)
grep -rn "toFixed(4\|toDecimalPlaces(4" --include="*.ts" backend/src | grep -v "\.spec\." | wc -l
grep -rln "toFixed(4\|toDecimalPlaces(4" --include="*.ts" backend/src | grep -v "\.spec\." | wc -l

# El grep ampliado por conducta (128 hits en 20 archivos)
grep -rnE '\.toFixed\(|\.toDecimalPlaces\(|ROUND_|Math\.round\(|Math\.floor\(|Math\.ceil\(|Math\.trunc\(|\.round\(|\.floor\(|\.ceil\(|\.trunc\(|\.toNearest\(' backend/src --include="*.ts" | grep -v "\.spec\."

# La cascada completa del medio peso (composición, líneas, reglas, vuelto)
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c \
  "SELECT v.venta_id, v.total_bruto, v.total_descuentos, v.total_impuestos, v.total_final
     FROM ventas v WHERE v.total_final <> round(v.total_final) AND v.eliminado_el IS NULL;"
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c \
  "SELECT p.monto, p.vuelto, v.total_final FROM pagos p
     JOIN ventas v ON v.venta_id = p.venta_id WHERE p.vuelto <> round(p.vuelto);"

# El residuo del desbruteo a escala entera (993 → 992)
python3 -c "
from decimal import Decimal, ROUND_HALF_UP
def q(x): return x.quantize(Decimal('1'), rounding=ROUND_HALF_UP)
for bruto in [993, 995, 997, 1000, 1990]:
    b = Decimal(bruto); neto = q(b / Decimal('1.19')); iva = q(neto * Decimal('0.19'))
    print(bruto, neto, iva, neto + iva)"

# Costos por unidad base (la amplificación)
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c \
  "SELECT ip.unidad_medida, count(*), min(ip.costo_actual), max(ip.costo_actual)
     FROM item_producto ip JOIN items i ON i.item_id = ip.item_id
    WHERE ip.costo_actual IS NOT NULL AND i.eliminado_el IS NULL GROUP BY ip.unidad_medida;"

# El config congelado por venta (dónde viviría nivelRedondeo/decimalesMoneda)
docker exec tecnica_postgres psql -U dev_user -d tecnica_db -c \
  "SELECT config_calculo FROM ventas WHERE config_calculo IS NOT NULL LIMIT 1;"
```

## Fuentes externas verificadas (pasarelas)

- [Transbank — formato de monto](https://github.com/TransbankDevelopers/transbank-developers-docs/blob/master/documentacion/webpay/README.md)
- [Wompi — transacciones (`amount_in_cents`)](https://docs.wompi.co/en/docs/colombia/transacciones/)
- [Wompi — widget checkout (ejemplo 95.000 → 9500000)](https://docs.wompi.co/en/docs/colombia/widget-checkout-web/)
- [PayU Latam Colombia — Payments API (`value` sin decimales)](https://developers.payulatam.com/latam/es/docs/integrations/api-integration/payments-api-colombia.html)
- [Mercado Pago Colombia — `transaction_amount` en pesos](https://www.mercadopago.com.co/developers/es/docs/checkout-api-payments/integration-configuration/card/integrate-via-cardform)
- [ePayco — checkout (`amount` en pesos)](https://docs.epayco.com/docs/checkout-implementacion)
