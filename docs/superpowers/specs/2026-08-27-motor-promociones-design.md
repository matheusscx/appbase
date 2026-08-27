# Motor de promociones — diseño (Fase 1)

**Fecha:** 2026-08-27 · **Estado:** Diseño aprobado por secciones con el owner e
investigación de mercado cruzada el mismo día (ver la sección al final); pendiente la
revisión final del owner · **Plan:** pendiente
**Análisis de origen:** [`2026-07-22-motor-promociones-analisis.md`](2026-07-22-motor-promociones-analisis.md)
— alcance de Fase 1 CERRADO ahí; este documento agrega solo la arquitectura.

⛔ **Toca el motor de precios: la implementación va sola y con el sistema quieto**
(`CLAUDE.md`). Este diseño se escribió mientras otra sesión ocupa el stack con el e2e del
`401` intermitente; el frente no arranca hasta que el stack se libere.

---

## Qué es, en una frase

Un módulo `promociones` con tres piezas: **CRUD de campañas** (2x1/NxM, happy hour %,
precio fijo de combo), un **evaluador puro cross-carrito** que decide qué promo toca qué
unidades, y la **aplicación dentro del motor de precios** como familia propia de descuento
—trazable, congelable y medible como promoción, nunca fundida con los descuentos de
catálogo.

## Lo que ya estaba decidido (julio 2026 — no re-preguntar)

Del análisis: solo familia (A) —descuentos sobre líneas ya pedidas—; activación solo
automática; entre promos **no hay acumulación** (una unidad pertenece a una sola promo,
gana la de mayor descuento); scope por promo en tres formas (lista de ítems / categoría /
todo el pedido); todo beneficio expresado como **descuento portable** (monto o %) sin
inventar concepto fiscal (ADR-010); `descuentos` y `promociones` conviven; la regla
producto-vs-promo se escribe en `PRODUCTO.md`.

**Requisito heredado del frente de vigencia (2026-08-23), no opcional:** al eliminar el
tipo `promocional` se perdió el único guardarraíl que obligaba fechas — acá se restituye:
**una campaña sin fecha de fin no se acepta.**

## Las decisiones del owner de hoy (2026-08-27)

1. **Promo vs. descuento común: configurable, con UN solo interruptor por tenant** (no por
   promo). Vive en las preferencias financieras.
2. **Default: NO acumula** — si el local nunca tocó el interruptor, el día de la promo
   aplica solo la rebaja mayor. Protege la plata del local por defecto; regalar las dos
   rebajas es decisión explícita. *(Default propuesto por el agente y aprobado con la
   sección 1 del diseño.)*
3. **Criterio pro-cliente al armar aplicaciones** (aprobado con la sección 2): cuando hay
   más candidatas que cupo, la aplicación se arma a favor del cliente — al combo entran
   las unidades más caras, el 2x1 regala la más barata del par más caro. Una sola regla
   para todo el módulo.
4. **El instante que decide la promo es cuándo se PIDE el ítem** — no la apertura de la
   cuenta ni el pago. Decidido tras el cruce de mercado: el primer borrador heredaba el
   instante de la vigencia por fecha (`cuenta.abierta_el`) y con granularidad de hora eso
   dejaba sin happy hour a la mesa abierta 17:30 que pide a las 18:30 — el caso más común
   de un bar. Toast, el único POS que documenta el instante, evalúa al enviar el ítem a
   cocina. El caso original de la herencia queda cubierto igual: lo pedido 19:50 mantiene
   su promo aunque se pague 20:30. ⚠️ **La vigencia por fecha de las reglas comunes NO se
   toca** — sigue decidida por la apertura de la cuenta, como la construyó su frente. La
   asimetría queda dicha: la regla es por día (el borde es marginal), la promo es por
   franja horaria (el borde es el caso central). Unificarlas, si algún día molesta, es
   una decisión aparte.

---

## Modelo de datos

El patrón genérico Condición/Beneficio del análisis se concreta en **columnas tipadas**
—el idioma del repo (ADR-006, relacional, no jsonb)—. En Fase 1 una promo tiene
exactamente un beneficio, así que va inline en la fila; si una fase posterior necesita
varios, la tabla de beneficios se agrega sin migrar lo existente (no hay datos
productivos, ver memoria del proyecto).

### `promociones`

| Columna | Tipo | Notas |
|---|---|---|
| `promocion_id` | UUID PK | |
| `tenant_id` | UUID | del token, como siempre |
| `nombre` | text | único por tenant vivo (molde del índice de `descuentos`) |
| `descripcion` | text NULL | |
| `activo` | boolean | pausa. **Pausada no aplica y NO avisa** — ver abajo |
| `fecha_inicio` | date NOT NULL | borde inclusivo, día local |
| `fecha_fin` | date NOT NULL | **obligatoria: el guardarraíl heredado.** Inclusiva |
| `hora_inicio` | time NULL | las dos o ninguna (CHECK). Hora local del tenant |
| `hora_fin` | time NULL | `inicio > fin` = la franja cruza medianoche (18:00–02:00) |
| `dias_semana` | smallint[] NULL | ISO-8601: 1=lunes…7=domingo. NULL = todos. CHECK 1..7 |
| `canal` | text NULL | `'fisico'` \| `'online'`; NULL = ambos |
| `tipo` | text CHECK | `'porcentaje'` \| `'nxm'` \| `'precio_fijo'` |
| `valor_porcentaje` | numeric(7,4) | `porcentaje` y `nxm`. Decimal: 2x1 = `1.0000`, "2do al 50%" = `0.5000` (invariante 2) |
| `cada_n` | smallint | solo `nxm`: 2x1→2, 3x2→3. CHECK `>= 2` |
| `valor_monto` | numeric(18,4) | solo `precio_fijo`: el precio del conjunto. `@EsMontoCobrado` en el DTO |

**CHECKs de forma por tipo** — cada tipo llena exactamente sus columnas y el resto queda
NULL (la lección del frente "los demás no eligen": una fila no puede decir dos cosas):

- `porcentaje` → `valor_porcentaje` NOT NULL; `cada_n` y `valor_monto` NULL.
- `nxm` → `valor_porcentaje` y `cada_n` NOT NULL; `valor_monto` NULL.
- `precio_fijo` → `valor_monto` NOT NULL; los otros dos NULL.

Soft delete (`eliminado_el`) + `creado_el`/`actualizado_el` en todas las tablas
(invariante 3). PKs/FKs con `type: 'uuid'` explícito (test de ADR-004 lo fuerza).

**Por qué `tipo` es columna con CHECK y no una tabla tipo `tipos_regla`:** un tipo nuevo
de promo exige sí o sí una rama nueva en el evaluador — no existe el caso "agregar un tipo
sin tocar código" que justificó la tabla en descuentos. La config de formulario por tipo
vive en el frontend (molde `reglas-form-config.ts`), como allá.

**Por qué la pausa no avisa, si la regla pausada sí:** el aviso de la regla pausada existe
porque la pausa de un descuento asociado a un ítem es una anomalía que alguien provocó y
el POS se la recuerda al cajero. Pausar una campaña es el gesto **normal** de apagarla;
avisarla en cada venta sería el toast de diez meses que la spec de vigencia ya descartó
para las reglas fuera de fecha. La pantalla de configuración la marca `Pausada`.

### `promocion_scopes` — los "slots" (la Condición, concreta)

| Columna | Tipo | Notas |
|---|---|---|
| `scope_id` | UUID PK | |
| `promocion_id` | UUID FK | |
| `slot` | smallint | orden dentro de la promo |
| `tipo_scope` | text CHECK | `'items'` \| `'categoria'` \| `'venta'` (= todo el pedido) |
| `categoria_id` | UUID NULL FK | NOT NULL ⇔ `tipo_scope = 'categoria'` (CHECK) |
| `cantidad` | smallint | default 1. Solo significa algo en `precio_fijo`: cuántas unidades pide este slot |

- `porcentaje` y `nxm`: **exactamente 1 slot** (a qué aplica la promo). Lo exige el
  service, no un CHECK (es regla entre tablas, como `validarMontosDeRegla`).
- `precio_fijo`: **1..N slots**, cada uno un componente del combo — "2 pizzas + 1 bebida
  = $9.990" son dos slots (`cantidad` 2 y 1). La condición de la promo es el **AND** de
  sus slots (el OR de julio = varias promos; fase posterior si hace falta).
- El scope **nunca** reusa un grupo modificador (decisión 6 de julio: acopla catálogo con
  precios). El punto de contacto con estructura es la categoría.

### `promocion_scope_items` — bridge scope ↔ ítem

`scope_id` + `item_id`, PK compuesta, soft delete — molde exacto de
`descuento_metodo_pago`. Solo para `tipo_scope = 'items'`.

### `ventas_promociones` — el congelado

Molde de `ventas_descuentos`: la fila se basta sola para leer la venta vieja, columnas
NOT NULL, **un solo camino de escritura** (`crearEnTransaccion`).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `venta_id` | UUID FK NOT NULL | |
| `detalle_id` | UUID FK NOT NULL | el monto siempre aterriza en una línea |
| `aplicacion` | smallint NOT NULL | agrupador: la aplicación #1 del 2x1 tocó estas filas |
| `promocion_id` | UUID FK NOT NULL | resoluble para siempre: el catálogo es soft delete |
| `nombre_promocion` | text NOT NULL | congelado — el catálogo puede renombrarla |
| `tipo` | text NOT NULL | congelado |
| `valor_efectivo` | numeric(18,4) NOT NULL | qué valía: el `%` (decimal, cabe de sobra) o el precio fijo — `tipo` dice cómo leerlo |
| `monto` | numeric(18,4) NOT NULL | lo que restó **en esa línea** |

"¿Cuánto descontamos en promos este mes?" es un `SUM` sobre esta tabla — sin flags, sin
filtrar `ventas_descuentos`. Esa medibilidad es la razón del enfoque elegido (ver ADR-023).

### El interruptor del tenant

`promos_acumulan_descuentos boolean NOT NULL DEFAULT false` en las preferencias
financieras del tenant (donde viven fórmula y redondeo — es conducta de precio). Viaja al
motor por `ConfigCalculo` y **se congela en `ventas.config_calculo`** como el resto: una
venta vieja explica su total sin consultar la config vigente.

---

## El evaluador

`promociones.evaluator.ts`: **función pura, sin I/O ni NestJS** — el mismo molde que
`calculo-precios.engine.ts`, 100% testeable aislada. Recibe promos elegibles + líneas
resueltas; devuelve **aplicaciones candidatas** en plata fina (la cuantización la hace el
motor al cerrar el paso, como con todo).

### Elegibilidad (la resuelve el service, que tiene la zona horaria)

`activo = true`, fecha local ∈ `[fecha_inicio, fecha_fin]`, hora local dentro de la
franja —con cruce de medianoche: si `hora_inicio > hora_fin`, la franja es
`[inicio, 24) ∪ [0, fin]`—, día de semana ∈ `dias_semana`, canal compatible.

**El instante es POR LÍNEA: cuándo se pidió el ítem** (decisión 4 del owner). Una línea
que nace de una cuenta de salón evalúa con el `creado_el` de su línea de cuenta; una venta
sin cuenta (POS directo, tienda, suscripciones) evalúa todas sus líneas con **ahora** —
ahí pedir y cobrar son el mismo acto. Fecha, hora y día de semana se evalúan todos con ese
mismo instante: una línea pedida el 31 dentro de la campaña la conserva aunque se cobre el
1. Consecuencia asumida: en la misma mesa, las cervezas de las 18:30 llevan el happy hour
y las de las 20:15 no — es lo prometido en cada pedido.

**El instante nunca viaja por valor desde el cliente** — la forma de abuso que la spec de
vigencia ya cerró sigue cerrada: el cierre de mesa arma las líneas del lado del servidor
(ya conoce el `creado_el` de cada una), y la previsualización de salón pasa `cuentaId` y
el service resuelve los instantes contra las líneas de esa cuenta, acotada por tenant.
**El cruce exacto línea-del-DTO ↔ línea-de-cuenta en la previsualización lo fija el plan**
(la venta real no tiene el problema: sus líneas nacen de la cuenta); el contrato que el
plan no puede aflojar es que el instante salga de la BD, jamás del body.

Para la **hora** local hace falta el gemelo de `fechaLocalTenant` que devuelva
`HH:mm` + día ISO — misma mecánica `Intl` con la zona de la provincia, mismo docblock de
por qué no es Postgres (colapsar un instante en memoria, no expandir un rango en SQL).

### La unidad de trabajo es la unidad, no la línea

El evaluador explota cada línea por su `cantidad` (una línea de 2 cervezas = 2 unidades)
y trabaja con el **neto unitario ya convertido a moneda oficial, ANTES de descuentos**: el
precio de lista, que es lo que el cartel "20% los martes" promete. Cantidades
fraccionarias (venta al peso) participan del tipo `porcentaje` con su neto proporcional;
para `nxm` y `precio_fijo` solo cuentan **unidades enteras** (⌊cantidad⌋ del ítem — un
2x1 de "0,7 kg" no significa nada).

**Una unidad pertenece a lo sumo a una aplicación** (decisión de julio).

### Por tipo

- **`porcentaje`** (happy hour): cada unidad dentro del scope recibe
  `valor_porcentaje × neto`. Sin tope propio — el piso en cero del motor gobierna.
- **`nxm`**: unidades del scope ordenadas por neto **descendente**; grupos completos de
  `cada_n`; en cada grupo, **la más barata** recibe `valor_porcentaje` (2x1 = 100% de la
  más barata: "paga la más cara"). Grupo incompleto no aplica. Repetible: 4 cervezas en
  el 2x1 = 2 aplicaciones.
- **`precio_fijo`**: mientras alcancen unidades para llenar **todos** los slots (con su
  `cantidad`), se arma el combo con las unidades **más caras** disponibles de cada slot
  (decisión 3 del owner) y el descuento es `Σ netos del combo − valor_monto`, repartido
  entre las líneas afectadas **a prorrata del neto con residuo por mayores restos** — el
  idioma que el motor ya usa para las reglas de documento. **Si el descuento da ≤ 0, la
  aplicación no se hace: una promoción nunca encarece.** Repetible (2 pizzas + 2 bebidas
  = 2 combos).

### Conflictos

- **Promo vs. promo** (decidido en julio): el evaluador genera todas las candidatas, las
  ordena por **monto total descendente** (desempate estable por id de promo, para que dos
  cálculos de la misma venta den lo mismo) y aplica greedy — una unidad tomada no entra
  en otra. "Gana la de mayor descuento", medible en plata.
- **Promo vs. descuento de catálogo** (el interruptor): las candidatas se arman **sin
  mirar** los descuentos de catálogo; la comparación la hace el **motor**, único que
  conoce los montos de las dos familias (tramos, método de pago, base/compuesto). Ver la
  sección siguiente.

### Lo que el evaluador NO hace

No agrega líneas ni cambia ítems (familia B, fase posterior). No avisa cuando una promo
no aplica — misma decisión que la vigencia: una promo fuera de franja es la promo
funcionando como se configuró; el "¿por qué no?" lo contesta la pantalla de
configuración. No toca impuestos: el beneficio es un descuento más para el paso de
impuestos (ADR-010 intacto — el monto del descuento *es* el hecho congelado).

---

## Integración con el motor y el service

```
CalculoPreciosService.calcular
  1. resuelve líneas (netos convertidos)                       ← existe
  2. carga promos vigentes (batch: promos + scopes + items,
     WHERE activo AND fecha; hora/día/canal se afinan en memoria) ← nuevo, 1 query
  3. evaluador puro → aplicaciones candidatas                  ← nuevo
  4. calcularVenta({ …, promociones, config })                 ← el motor aplica
```

La carga es **una consulta batch** (promos del tenant vivas y en fecha, con sus scopes e
ítems por `JOIN`), nunca una por promo ni por línea (regla N+1). Toda lectura filtra
`eliminado_el IS NULL`.

### Cambios en el motor (`calculo-precios.engine.ts`)

- `VentaResuelta.promociones: AplicacionPromo[]` — cada aplicación referencia sus líneas
  **por índice**, nunca por `itemId` (el mismo ítem puede estar en dos líneas con
  personalizaciones distintas — el precedente de `detalle_id`), con el monto fino por
  línea y su identidad (`promocionId`, `nombre`, `tipo`, `valorEfectivo`).
- `ConfigCalculo.promosAcumulanDescuentos: boolean` — **requerido**, como
  `decimalesMoneda`: opcional significaría que olvidarse de mapearlo cambia plata en
  silencio.
- **Dentro del paso `descuentos`** de cada línea: primero las reglas de catálogo, después
  los montos de promo como **monto fijo** (coherente con "porcentajes antes que fijos":
  el monto de la promo ya viene resuelto en plata). El **piso en cero** (regla por regla,
  con su advertencia de tope) y la **cuantización al cierre del paso** aplican por
  construcción — para la aritmética de cierre la promo es un descuento más. Ningún camino
  de redondeo nuevo.
- **Interruptor en NO acumula:** el motor compara **por aplicación**: la rebaja total de
  la aplicación contra la suma de los descuentos de catálogo de las líneas que toca —
  gana la mayor y la otra familia no aplica **en esas líneas**. Una aplicación
  cross-línea (combo) se compara **entera**, no se parte. En acumula, las dos familias
  conviven en la línea.
- **Traza propia:** `ResultadoLinea.trazas.promociones` (`id`, `nombre`, `monto`,
  `valorEfectivo`), separada de `descuentos` — la razón de ser del enfoque. En NO
  acumula, la familia perdedora queda con el patrón existente de la regla que no aporta
  ("No aplicó": traza sin monto), nunca desaparece muda.

### DTOs

Las promos **nunca viajan en el request** — se resuelven server-side, siempre. Lo único
nuevo es `CalcularVentaDto.canal?: 'fisico' | 'online'` (default `fisico`) para que la
previsualización de la tienda filtre igual que la venta. Manipularlo solo miente en
pantalla: el cobro recalcula con el canal real de la venta (`crearEnTransaccion` lo pasa
él mismo — el mismo argumento que `cuentaId` en la spec de vigencia).

---

## Congelado y dónde se ve

- **`crearEnTransaccion`** persiste `ventas_promociones` desde el resultado, cruzando
  línea→detalle **por índice** contra `resultado.lineas` (nunca por `itemId`), en la
  misma transacción. `config_calculo` gana `promosAcumulanDescuentos`.
- **Drawer de venta** (`VentaDetalleDrawer`): las promos son una familia más en el
  desglose expandido de la línea — `Promoción  2x1 martes  −$5.000` — con el mismo
  formato que descuento/recargo/impuesto. Las aplicaciones cross-línea se leen línea por
  línea (cada fila muestra lo que restó ahí), con el nombre repetido: es la derivación
  del total de ESA línea, que es el contrato de esa tabla.
- **Ticket** (`ticket-builder.ts`): la promo se imprime **nombrada**
  (`2x1 martes  −$5.000`), no fundida en el agregado de descuentos — es la promesa que el
  cliente vino a buscar y lo que evita la discusión en caja. Igual que los recargos en
  cero: una promo sin monto no se imprime.
- **Carrito (POS / Salones / Tienda):** la previsualización ya corre este mismo cálculo;
  la promo aplicada aparece en el desglose con su nombre. **Sin toasts nuevos.**

---

## Pantalla de configuración

- **`/configuracion/promociones`** — molde de descuentos/recargos: `CrudTable` + drawer
  con formulario **por tipo** (config declarativa, molde `reglas-form-config.ts`):
  `porcentaje` pide %, `nxm` pide N y %, `precio_fijo` pide precio + armado de slots
  (selector de ítems o categoría por slot, con cantidad — componentes existentes del
  catálogo, nada nuevo).
- Guard **`TenantAdminGuard`**: es catálogo/configuración (admin-only, lectura abierta) —
  el mapa de permisos existente.
- **Badges derivados** en la lista: `Programada` / `Vigente` / `Vencida` / `Pausada`.
  Misma limitación asumida que las reglas: fecha del navegador — es etiqueta, no plata.
- **El interruptor del tenant** va en la pantalla de Preferencias financieras, junto a
  fórmula y redondeo, en lenguaje de local: *"Cuando una promoción y un descuento tocan
  el mismo producto: ¿se suman, o aplica solo la rebaja mayor?"*
- Tokens semánticos de Nuxt UI, `useApiFetch`, lógica en composables — las convenciones
  de siempre.

**La regla producto-vs-promo se escribe en `docs/PRODUCTO.md`** (decisión 5 de julio,
pendiente desde entonces): *¿está siempre en la carta con su precio → catálogo (combo con
grupos modificadores); aparece/desaparece según día/hora/cantidad → promoción?* El
descuento tiene que vivir donde se mide como descuento.

---

## Qué NO entra en Fase 1

- **Familia (B)**: regalar un ítem no pedido, combo automático que agrega líneas,
  upgrade, envío gratis.
- Cupones / activación manual; grupos de exclusión y stacking configurable **entre**
  promos; prioridad manual (el conflicto lo resuelve la plata); máximo de aplicaciones
  por ticket.
- Sucursales, fidelización, tipo de cliente, mesa > N comensales (no existen los datos).
- Representación fiscal específica por país (ADR-010: el descuento portable ya congela el
  hecho).
- El redondeo, la conversión de moneda, el orden de la fórmula y el desbruteo. **Si el
  diff los toca, el alcance se desbordó.**

---

## Cómo se prueba

- **Unit del evaluador** (el grueso del valor): agrupación NxM con empates de precio; 4
  unidades = 2 aplicaciones; grupo incompleto no aplica; combo con slots de
  `cantidad > 1`; combo que encarece no aplica; prorrateo con residuo (333/333/334);
  unidad en una sola promo; "gana la mayor" entre promos con desempate estable; franja
  que cruza medianoche; días ISO; canal; pausada y fuera de fecha no entran; cantidades
  fraccionarias solo en `porcentaje`.
- **Unit del motor:** promo como monto fijo después del catálogo; piso en cero; traza
  propia; el interruptor en las dos posiciones, incluida la aplicación cross-línea
  comparada entera; la familia perdedora deja traza "No aplicó".
- **Unit del service:** elegibilidad (fecha/hora/día/canal), instantes por línea desde
  las líneas de la cuenta, carga batch.
- **E2E de API:** una promo aplica en una venta real y queda congelada en
  `ventas_promociones`; **previsualización y venta dicen lo mismo**; en una cuenta de
  salón, **la línea pedida dentro de la franja lleva la promo y la pedida fuera no,
  aunque se cobren juntas** (la decisión 4, punta a punta — la única forma de probarla);
  tenant en acumula vs. no acumula; canal online. Con **garzón propio** si toca salones
  (la sesión es única por garzón; no reusar los del seed).
- **Mutantes exigidos** (parte del entregable, no un extra; cada uno mata tests
  distintos, y el mutante va acotado a la cláusula y revertido verificando el restart del
  watcher):
  1. quitar la obligatoriedad de `fecha_fin`;
  2. evaluador devolviendo `[]` fijo;
  3. la comparación del interruptor invertida;
  4. `promosAcumulanDescuentos` sin mapear al congelado;
  5. el instante por línea reemplazado por un "ahora" fijo — tiene que matar el e2e de
     la línea pedida fuera de franja.
- Los tests de fecha/hora **no dependen del día ni de la hora del runner**: el instante
  entra por `cuentaId` o se controla en el unit.

## Traps para quien lo implemente

1. **Entidades nuevas van también en el array `entities` de `app.module.ts`** — no hay
   `autoLoadEntities`; unit y typecheck no lo cazan, solo el e2e real.
2. **`RepositoriosModule.forFeature`, nunca `TypeOrmModule.forFeature`** (ADR-020).
3. **Seeder:** promos demo con el siguiente UUID libre del patrón
   `550e8400-…-446655440XXX`; al crear tenant NO se siembra ninguna promo (no es parte
   del kit mínimo rol/fórmula/caja virtual).
4. **Gate completo al cierre:** `reset-db.sh` antes, e2e **entero** (no subset),
   `--verificar` después, sin tocar `.ts` del backend mientras corre.
5. ⛔ **Sistema quieto:** toca el motor — no arranca hasta que el frente del `401` libere
   el stack, y no comparte sesión con ninguna otra tarea.
6. El cruce aplicación→línea es **por índice**; si aparece un cruce por `itemId`, es el
   bug de las personalizaciones otra vez.
7. `ConfigCalculo.promosAcumulanDescuentos` y `AplicacionPromo` **requeridos** en sus
   tipos: si el compilador no obliga a mapearlos, el diseño se perdió.
8. La comparación de strings de hora (`HH:mm`) con cruce de medianoche tiene el borde en
   los límites exactos: `hora_fin` inclusive o exclusive **se decide en el plan y se fija
   con test** — proponer inclusive ambos, como las fechas.

## Documentación (mismo commit que el código)

| Qué | Dónde |
|---|---|
| Feature doc nueva | `docs/features/motor-promociones.md` + link en `docs/README.md` + fila en `docs/ESTADO.md` |
| Regla producto-vs-promo | `docs/PRODUCTO.md` |
| ADR-023 — promociones como familia propia del motor (evaluador afuera, aplicación y conflicto adentro; por qué no reglas sintéticas) | `docs/adr/` + índice |
| El análisis de julio se marca **promovido** a este diseño | `2026-07-22-motor-promociones-analisis.md` (header) |
| Al cerrar el frente: la entrada del backlog se muda con su cierre | `docs/agent/pendientes.md` → `resueltos.md`, con `CLAUDE.md` coherente en el mismo commit |

## Enfoques descartados (para no reabrirlos)

- **Reglas sintéticas** (fabricar `ReglaResuelta` e inyectarlas en los descuentos):
  motor sin cambios, pero promos y descuentos quedan mezclados en traza y congelado —
  `ventas_descuentos` con flag, ids sintéticos contra un congelado que hoy es invariante
  de esquema, y "¿cuánto desconté en promos?" dependiendo de un filtro frágil. La parte
  difícil (el evaluador) es idéntica; lo que se ahorraba era justo lo que da la
  medibilidad.
- **Post-proceso sobre el resultado del motor:** duplica la aritmética de cierre
  (cuantización, prorrateo, piso) fuera del motor — el segundo camino de redondeo que el
  frente de la plata eliminó.

## Investigación de mercado (2026-08-27) y su cruce contra este diseño

Dos pasadas el mismo día: motores de promos en POS internacionales (Toast, Square,
Lightspeed, Clover — documentación oficial) y norma chilena (SII/DTE, IVA, SERNAC, POS
locales). **Regla del cruce aplicada:** insumo para adaptar, no verdad a copiar; donde el
mercado difiere de una decisión del owner, se anota el porqué de la nuestra.

**1 · Promo vs. descuento común.** El patrón dominante es **default exclusivo** (no
acumula): Toast con flag por descuento *"Allow with other discounts"* (solo check-level y
BOGO; los de ítem y combo son siempre exclusivos); Lightspeed X-Series con escalera fija
de prioridad y eCom con toggle default off; Square es la excepción (compone por default,
la exclusión es declarativa por `pricing_blocklists`); Clover no lo resuelve en el core.
→ **Nuestro default NO acumula coincide con el patrón.** El interruptor por **tenant** (y
no por promo, que es lo que hace Toast) es decisión del owner con ese dato a la vista:
una sola conducta explicable por local; el flag por promo es aditivo si aparece el caso.
Fuentes: [Toast — exclusividad](https://doc.toasttab.com/doc/platformguide/adminDiscountExclusivity.html) ·
[Square — apply discounts](https://developer.squareup.com/docs/orders-api/apply-taxes-and-discounts) ·
[Lightspeed X — multiple promotions](https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534022962843-Can-I-run-multiple-promotions-at-once).

**2 · Selección de unidades.** Donde está documentado, el descuento aterriza en **la
unidad más barata** (Lightspeed lo fija sin opción; Toast lo expone configurable:
primera/más barata/más cara). → Nuestro NxM coincide con el patrón dominante. El armado
del combo con las unidades **más caras** es decisión nuestra (pro-cliente, decisión 3);
Toast en combos aplica a los modificadores más baratos — el sentido contrario. Queda
dicho: si un local pide lo opuesto, el selector de Toast es el precedente de config.
Fuentes: [Toast — BOGO](https://doc.toasttab.com/doc/platformguide/adminDiscountsConfigureBogo.html) ·
[Lightspeed — discount rules](https://retail-support.lightspeedhq.com/hc/en-us/articles/1260805852410-Creating-discount-rules).

**3 · Repetición y topes.** La repetición automática por cada grupo que califica es el
comportamiento asumido en todos; **solo Toast documenta un tope configurable** por ticket
(*"Eligible # of Get Items"*, *"Total Quantity"*). → F1 sin tope coincide; el tope es un
knob futuro con precedente.
Fuente: [Toast — discount config reference](https://doc.toasttab.com/doc/platformguide/adminDiscountConfigReference.html).

**4 · Ventanas horarias.** Los cuatro programan día + hora; **ninguno documenta el cruce
de medianoche** (→ entrada en `DIFERENCIADORES.md`). **Toast es el único que documenta el
instante de evaluación: cuando el ítem se envía a cocina**, no al pagar — con el ejemplo
de la cerveza pedida 16:30 que no entra al happy hour de 17:00 aunque se pague adentro.
→ Este hallazgo **reabrió la decisión del instante** y produjo la decisión 4 del owner.
Fuente: [Toast — discount availability](https://doc.toasttab.com/doc/platformguide/adminDiscountAvailability.html).

**5 · Ticket y prorrateo.** La promo como **línea nombrada** es la norma (Toast con
nombre configurable en el recibo; Square con `name` en la API; Clover distingue
orden/línea) → coincide con nuestro ticket nombrado. Del prorrateo de un combo a precio
fijo, **solo Toast documenta la fórmula** (reparto proporcional al precio original, con
el impuesto recalculado sobre el monto ya prorrateado) → coincide con nuestro reparto a
prorrata del neto; el residuo determinista por mayores restos es nuestro
(→ `DIFERENCIADORES.md`).
Fuente: [Toast — effect of discounts on prices](https://doc.toasttab.com/doc/platformguide/adminDiscountPricing.html).

**6 · Pata chilena.**
- **NORMA — la fecha de fin obligatoria tiene respaldo legal**, no solo de diseño: Ley
  19.496 art. 35 — *"En toda promoción u oferta se deberá informar al consumidor sobre
  las bases de la misma y el tiempo o plazo de su duración."*
  ([SERNAC — art. 35](https://www.sernac.cl/portal/609/w3-propertyvalue-58789.html))
- **NORMA — el "2x1 como descuento del 100%" es un caso previsto por el formato:** el
  manual de boleta electrónica valida `DescuentoPct` *"entre 0 y 100 incluidos"*, y el
  Formato DTE contempla `MontoItem = 0` con texto de impresión (*"s/valor, sin costo"*).
  ([Formato DTE v2.5](https://www.sii.cl/factura_electronica/factura_mercado/formato_dte_202602.pdf) ·
  [Boletas v4.2](https://www.sii.cl/factura_electronica/factura_mercado/formato_boleta_electronica.pdf))
- **NORMA + INFERENCIA — el camino que NO tomamos era un hoyo fiscal:** la entrega
  gratuita promocional **sin venta asociada** es hecho gravado especial (art. 8 letra d)
  Ley del IVA: retiro, tributa sobre valor de mercado). Modelar el 2x1 como línea
  regalada habría rozado esa figura; como descuento del 100% **dentro de la venta**,
  reduce la base de la línea y no genera hecho gravado aparte. No hay oficio SII
  específico sobre 2x1 (buscado y no hallado): es inferencia razonable desde la mecánica
  del formato, no ratificación directa.
  ([SII — FAQ entregas promocionales](https://www.sii.cl/preguntas_frecuentes/impuestos_mensuales/001_130_4528.htm))
- **El único mandato normativo sobre descuento global:** si el documento mezcla
  afectos/exentos, `DscRcgGlobal` debe ir en % o separado por tipo de afectación (Formato
  DTE §D). Nuestro beneficio aterriza **por línea**, así que ni lo pisa — se anota para
  el día que exista emisión SII (ADR-010: esto es formateo, no hecho).
- **PRÁCTICA — los POS chilenos no publican su motor** (Bsale solo UI/API superficial;
  Toteat y Defontana detrás de login). La señal chilena es la norma, como anticipaba la
  plantilla de investigación.

**Síntesis del cruce:** ninguna decisión quedó refutada; una (el instante) se reabrió con
evidencia y el owner la re-decidió el mismo día (decisión 4); dos ganaron respaldo de
NORMA (fecha de fin, descuento 100%); y dos huecos de documentación del mercado quedaron
anotados como diferenciadores en `DIFERENCIADORES.md`.

## Pendiente antes de pasar a plan

- [x] Cruce con la investigación de mercado — hecho el 2026-08-27, sección anterior.
- [ ] Revisión final del owner sobre este documento.
- [ ] Recién después: `writing-plans` → plan ejecutable.
