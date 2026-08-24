# La vigencia por fecha se evalúa — diseño

**Fecha:** 2026-08-23 · **Estado:** Diseño aprobado, sin implementar · **Plan:** pendiente

## De dónde sale

De la entrada *"Cinco tipos de regla no hacen lo que la pantalla promete"* de
[`pendientes.md`](../../agent/pendientes.md) § 6, medida el 2026-08-23. De los cinco tipos,
`promocional` es el único que **no espera nada**: no necesita vencimiento de venta ni
aritmética de crédito, solo saber si el día cae en el rango. Sus cuatro decisiones de producto
están tomadas y viven en esa entrada.

⛔ **Toca el motor de precios**, así que por `CLAUDE.md` va solo y con el sistema quieto.

## El frente no es `promocional`: son tres tipos, y dos ya cobran mal

Al abrirlo apareció que la vigencia no es una propiedad de `promocional` sino de **cualquier
regla que tenga fechas**. Tres tipos las ofrecen en la pantalla
([`reglas-form-config.ts`](../../../frontend/app/utils/reglas-form-config.ts)), y el DTO las
acepta en **cualquier** tipo:

| Tipo | Fechas | Qué hace hoy al vender |
|---|---|---|
| `promocional` | requeridas | **Nada.** Está en `DIFERIDAS`: el motor lo saltea entero, dentro y fuera del rango |
| `por_monto_venta` (descuento) | opcionales | **Descuenta siempre.** El escalón funciona; las fechas se ignoran |
| `recargo_por_monto_venta` | opcionales | **Cobra siempre.** Igual |

Son **dos problemas distintos, y el segundo es peor**: `promocional` molesta pero no cobra de
más; los otros dos cobran fuera de la ventana que el local configuró, sin avisar. Es un bug
vivo en una feature entregada el 2026-08-22.

📊 **Medido el 2026-08-23:** hoy solo existen dos reglas con fechas, las dos `promocional`
(*"Promo verano 2026-27"*, 1-dic→31-ene, y una de test). **Ninguna** de los otros dos tipos.
Así que evaluar la vigencia **no le cambia el cobro a nadie hoy**: cierra el agujero antes de
que alguien se caiga.

✅ **Decisión del owner (2026-08-23): la vigencia vale para cualquier regla que tenga fechas.**
Una sola frase para explicarle a un local —*"si le pusiste fechas, vale solo entre esas
fechas"*—, el mismo código en el mismo lugar, y sin un campo "desde/hasta" que en unos tipos se
respete y en otros no.

⚠️ **Consecuencia real sobre un dato que ya existe:** la promo *"Promo verano 2026-27"* del
seed **empieza a descontar en diciembre**. Es lo correcto, y se dice acá para que no sorprenda.

## Las cuatro decisiones de producto que gobiernan el diseño

Tomadas por el owner el 2026-08-23. Se repiten acá porque el diseño argumenta desde ellas.

1. **El instante que decide es cuándo se ABRIÓ la cuenta**, no cuándo se cobra. La mesa que se
   sienta 23:50 con la promo vigente y paga 00:10 **sí** lleva el descuento: se le prometió al
   sentarse. Sin cuenta previa (POS directo, tienda, suscripciones) el instante de apertura y
   el de la venta son el mismo.
2. **«Hoy» es el día local, y sale de la zona horaria de la PROVINCIA.** Ya resuelto: ver
   [`resueltos.md`](../../agent/resueltos.md) § *"Una sola noción de zona horaria"*. Se pide con
   `zonaHorariaTenant(db, tenantId)` y no hay nada que decidir ni agregar.
3. **Los dos bordes son inclusivos del día.** Sin criterio nuevo: se reusa el ya tomado el
   2026-08-22 para los filtros de fecha.
4. **Una regla fuera de vigencia NO avisa al vender.** La pantalla de configuración la marca
   vencida; el POS no dice nada. El motivo está abajo.

## Por qué no avisa, si la regla pausada sí avisa

El motor ya tiene resuelto qué hacer con una regla que no participa: el guard de la pausada
avisa y hace `continue` **antes** de evaluar, sin dejar traza
([`calculo-precios.engine.ts:618`](../../../backend/src/modules/calculo-precios/calculo-precios.engine.ts)).
Copiar esa forma entera sería lo cómodo, y es lo que se descartó.

Las advertencias del motor salen como **toast en el POS, una por advertencia, en cada venta**
([`pos.vue`](../../../frontend/app/pages/ventas/pos.vue)). Una promo de verano asociada a sus
productos seguiría asociada en marzo: avisar la convertiría en un toast en **cada venta durante
diez meses**, y el aviso que aparece siempre deja de leerse — se lleva puestos a los demás.

La diferencia de fondo: una regla **pausada** es una anomalía que alguien provocó y el aviso se
la recuerda. Una regla **fuera de fecha** es la regla funcionando como se configuró. El *"¿por
qué no aplica?"* lo contesta la pantalla de configuración.

## Diseño

### Dónde se decide: el servicio, no el motor

Se evaluaron tres:

- **(A) El servicio decide, el motor recibe un booleano.** ✅ **Elegida.**
- **(B) El motor recibe fechas + instante y compara.** Descartada: en este repo la aritmética
  de husos la hace **Postgres** (`AT TIME ZONE`), y el motor es una función **pura y
  sincrónica, sin I/O**. Comparar una fecha local contra un instante ahí adentro exigiría una
  librería de zonas horarias, y una **dependencia nueva** obliga a frenar y preguntar
  (`CLAUDE.md`). B convierte *"el motor no sabe de tiempo"* en *"el motor sabe de husos"*, que
  es mucho más de lo que el problema pide.
- **(C) El servicio filtra y no le pasa las reglas fuera de vigencia.** Descartada: rompe la
  simetría con `activo` —que sí viaja al motor y se descarta adentro— y vuelve la regla
  invisible, sin siquiera la posibilidad de dejar traza. Es un descarte mudo.

### El motor: un campo y un guard

`ReglaResuelta` gana **`vigente: boolean`, requerido**. Requerido a propósito y por el mismo
motivo que dicen los docblocks de `activo`, `tipo` y `clasificacionTributaria`: si fuera
opcional, olvidarse de mapearlo en el service haría que una regla vencida **volviera a cobrarse
en silencio**, que es justo el bug que esto cierra.

En el bucle de reglas, junto al guard de la pausada:

- `!regla.vigente` → `continue`, **sin advertencia y sin traza**. No es un "aplicó 0".
- El `continue` va **antes** de evaluar, para que ni siquiera se calcule el monto.

`promocional` sale de `DIFERIDAS`. `mora` y `pronto_pago` **se quedan**.

### El servicio: `indexarReglas` calcula `vigente`

`indexarReglas` es el **único** punto que arma `ReglaResuelta` desde la BD, y las reglas ya
llegan con `fechaInicio`/`fechaFin` porque `findAll` devuelve la entidad entera: **ninguna
consulta cambia**.

Recibe la fecha local del tenant (`YYYY-MM-DD`) y decide por comparación de **strings**:

```
vigente = (fechaInicio == null || fechaInicio <= fechaLocal)
       && (fechaFin    == null || fechaLocal <= fechaFin)
```

Las fechas ISO comparan lexicográficamente igual que cronológicamente, así que esto es exacto y
no necesita nada más. Una regla **sin fechas está vigente siempre**. Los dos bordes son
inclusivos (decisión 3).

El mapa **conserva** las reglas no vigentes, por el mismo motivo ya escrito para las pausadas:
sacarlas de ahí haría que `requerir()` tirara 400 por id ausente en cada ítem que la tenga
asociada, y el POS dejaría de vender.

### La fecha local: `Intl`, y por qué no Postgres

`zonaHorariaTenant(db, tenantId)` da la zona; `Intl.DateTimeFormat('en-CA', { timeZone })`
convierte el instante a `YYYY-MM-DD`.

📊 **Medido el 2026-08-23 dentro del contenedor:** Node tiene **ICU completo**, así que `Intl`
resuelve husos sin dependencia nueva y es DST-correcto (`2026-12-01T02:30Z` da `2026-11-30` en
`America/Santiago` y en `Pacific/Easter`, `2026-12-01` en UTC).

⚠️ **Tensión que se asume y se documenta en el código:** el repo hace la aritmética de husos en
Postgres, y esto introduce un segundo mecanismo. No es el mismo problema: Postgres se usa para
**expandir** una fecha a un rango dentro de un `WHERE`, donde tiene que estar en SQL; acá hay
que **colapsar** un instante a una fecha local para comparar contra datos que ya están en
memoria, y hacerlo en SQL sería un viaje a la base solo para formatear una fecha. Sin esta nota
en el docblock, la próxima lectura lo va a leer como una inconsistencia.

### De dónde sale el instante

`CalcularVentaDto` gana **`cuentaId?: string`** (UUID). El servicio resuelve:

- **con `cuentaId`** → lee `abierta_el` de esa cuenta, **acotado por tenant**;
- **sin `cuentaId`** → ahora.

**Nunca acepta un instante mandado por el cliente.** Sería la forma de hacer que una promo
vencida aplique en pantalla.

Un `cuentaId` que no resuelve —inexistente, o de otro tenant— es **400**, no un silencioso
"entonces ahora": el descarte mudo es exactamente lo que este repo evita.

`cuentas.abierta_el` **ya existe** (`timestamptz`, default `now()`): no hay columna nueva.

Quién lo pasa:

| Camino | Qué pasa |
|---|---|
| `salones.cerrarCuenta` → `ventas.crearEnTransaccion` | el `cuentaId`, como **parámetro explícito del método** |
| POS directo, tienda, suscripciones | nada → ahora |
| Previsualización de la pantalla de salón (`POST /calculo-precios/calcular`) | el mismo `cuentaId`, por el DTO |

La última fila no es cosmética: **sin ella la previsualización y el cobro muestran promos
distintas justo en la mesa que cruza la medianoche**, que es el caso que la decisión 1 vino a
resolver.

⛔ **`CreateVentaDto` NO gana `cuentaId`, y esto es deliberado.** El primer borrador de esta
spec lo ponía ahí, y la autorrevisión lo cazó: hoy ese DTO **no expone** ninguna cuenta
(verificado el 2026-08-23), así que agregarlo abriría un camino que no existe. El abuso es
concreto y no hace falta ser ingenioso para encontrarlo: dejar una cuenta abierta en diciembre
y mandar su id en un `POST /ventas` directo de marzo para cobrar con la promo de verano. El
acotado por tenant no lo frena — la cuenta es propia.

Por eso el instante llega a `crearEnTransaccion` como **parámetro del método**, que solo
`salones.cerrarCuenta` puede pasar, y **nunca por el body**. La previsualización sí lo acepta
por DTO porque no cobra: lo peor que consigue quien lo manipule es una pantalla que miente, y
el cobro se recalcula igual del lado del servidor.

### La pantalla

Badge **"Vencida"** / **"Programada"** en la lista de descuentos y recargos, derivado de las dos
fechas que la respuesta ya trae. Es presentación: ninguna columna ni endpoint nuevo.

⚠️ **Limitación asumida y dicha:** usa la fecha del **navegador**, no la del tenant, así que un
dueño mirando desde otro huso puede ver el badge corrido un día justo en el límite. Es una
etiqueta, no plata. La alternativa exacta —que el backend devuelva el estado ya calculado en el
listado— cuesta más y cambia la forma de la respuesta; si alguna vez el badge tiene que ser
exacto, ese es el camino.

## Cómo se prueba

- **Unit del motor:** una regla no vigente no deja traza ni monto y **no** produce advertencia;
  una vigente aplica normal. Y que una regla **pausada y vencida a la vez** siga avisando por la
  pausa: los dos guards conviven.
- **Unit del servicio:** `indexarReglas` marca `vigente` contra la fecha local, con los cuatro
  bordes — primer día, último día (los dos **inclusive**), un día antes y un día después—, y una
  regla sin fechas siempre vigente.
- **Unit de la fecha local:** el instante se colapsa con la zona de la **provincia**, con el
  caso `Pacific/Easter` que cae en un día distinto que UTC.
- **E2E contra la API:** una promo vigente descuenta; una vencida no; y **una cuenta de salón
  abierta dentro de la vigencia y cerrada fuera sí lleva el descuento** — es la decisión 1 y es
  la única forma de probarla de punta a punta.
- **Mutantes exigidos:** quitar el guard del motor, y devolver `vigente: true` fijo en el
  servicio. Cada uno tiene que matar tests distintos.

⚠️ **Los tests de fecha no pueden depender del día en que corren.** El instante entra por el
`cuentaId` (o se controla en el unit), nunca se afirma contra `new Date()` del runner.

## Qué NO entra

- `mora`, `pronto_pago`, `interes_simple` e `interes_compuesto`: dependen del **vencimiento de
  la venta**, que no existe como concepto. Van con el frente de crédito.
- El redondeo, la conversión de moneda, el orden de la fórmula, los impuestos y el desbruteo.
  **Si el diff los toca, el alcance se desbordó.**
- El aviso al vender de una regla fuera de vigencia (decisión 4: no avisa).

## Relación con el motor de promociones (que existe como análisis, no como código)

Hay un análisis con **alcance de Fase 1 cerrado** desde el 2026-07-22
([`2026-07-22-motor-promociones-analisis.md`](2026-07-22-motor-promociones-analisis.md)) para
un evaluador **cross-carrito**: 2x1/NxM, happy hour, precio fijo de combo. **Esto no lo pisa
ni lo adelanta**, y conviene decir por qué:

- Aquello es **una etapa nueva sobre el carrito entero** —mira varias líneas a la vez para
  decidir "la más barata gratis"—. Esto es un **guard por regla** dentro del bucle que ya
  existe. Son capas distintas del mismo pipeline.
- Aquel documento decide explícitamente que **`descuentos` y `promociones` conviven**, y ya
  contaba con que el tipo `promocional` viviera en el motor de precios.
- **Granularidad:** acá la vigencia es por **día** (`fecha_inicio`/`fecha_fin` son `date`). Un
  *happy hour* necesita **hora**, que este frente no aporta y no debe inventar.

⚠️ **Colisión de nombres que este frente no resuelve y conviene decidir antes de construir el
módulo:** quedarían un **tipo de regla `promocional`** —un descuento con fechas obligatorias— y
un **módulo Promociones** que es otra cosa. Está anotado en
[`pendientes.md`](../../agent/pendientes.md) § 3; renombrar el tipo es barato hoy y caro cuando
haya reglas creadas.

## Traps para quien lo implemente

1. **`RepositoriosModule.forFeature`, nunca `TypeOrmModule.forFeature`** si hace falta registrar
   algo (ADR-020). Reabre un deadlock medido.
2. **El e2e completo, no un subconjunto**, con `reset-db.sh` antes y `--verificar` después, y
   sin tocar ningún `.ts` del backend mientras corre.
3. **`vigente` requerido** — si el compilador no te obliga a mapearlo, el diseño se perdió.
4. El instante de la cuenta viaja por **id**, no por valor: si aparece un parámetro `Date` que
   llega del cliente, es el agujero que esta spec cerró.
5. **`CreateVentaDto` no gana `cuentaId`.** Si el plan o el diff lo agregan ahí, reabren el
   abuso descrito arriba. El camino es un parámetro de `crearEnTransaccion`.
6. **Los mutantes son parte del entregable, no un extra.** Un `vigente` que nadie enforcea pasa
   la suite entera: es exactamente la forma del bug que este frente cierra.
