# Redondeo de plata: la moneda manda al cerrar el documento — Design Spec

**Fecha:** 2026-08-20
**Estado:** 📐 Revisada y aprobada por el owner (2026-08-20) — lista para plan de
implementación. **No toca código.**
**Decisiones que honra:**
[once decisiones](2026-08-20-redondeo-de-plata-decisiones.md) ·
[segunda ronda](2026-08-20-redondeo-de-plata-segunda-ronda.md)
**Estado del código:**
[lectura independiente](2026-08-20-redondeo-de-plata-lectura-independiente.md) ·
[análisis de coherencia](2026-08-20-redondeo-de-plata-analisis-coherencia.md)
**Investigación:**
[por línea o por total](../../agent/investigaciones/2026-08-20-redondeo-por-linea-o-por-total.md) ·
[decimales y redondeo](../../agent/investigaciones/2026-08-15-decimales-y-redondeo.md)
**Feature relacionada:** [motor de cálculo de precios](../../features/motor-calculo-precios.md)

---

## Contexto

`moneda.decimales` existe, CLP está sembrada con **0**, y el motor no lo consulta nunca.
La consecuencia está en la base de dev después de una suite e2e:

```
 total_final | codigo_iso | decimales        pagos.vuelto
 16957.5000  | CLP        |     0            994942.5000
  5057.5000  | CLP        |     0            983042.5000
```

Medio peso chileno persistido y cobrable en una moneda que el propio sistema declara sin
decimales. No es de laboratorio: sale del camino normal de la venta (IVA 19% sobre una
base descontada de 14.250 = 2.707,5). **Y esas ventas son incobrables por Webpay hoy:**
`montoEntero()` valida y tira 400, no redondea (`webpay-plus.provider.ts:89-95`).

Detrás hay algo más grande que los sitios sueltos. Entre el motor y el `INSERT` **no hay
ninguna cuantización**: los cinco campos de `VentaDetalle` (`ventas.service.ts:477-481`),
los cinco totales de `Venta` (`:430-435`) y las trazas de reglas (`:502-581`) viajan como
strings a `escala_calculo` (6) hacia columnas `NUMERIC(18,4)`, y **el último redondeo lo
decide el cast de Postgres** con su regla fija —media hacia afuera del cero—, sin mirar el
`modo_redondeo` del tenant. El único campo protegido de punta a punta es
`precio_unitario`, vía `convertirAMonedaOficial`.

Eso significa que la promesa de la decisión (b) —*"`modo_redondeo` aplica a los montos
cobrados"*— **hoy es falsa en el pipeline**. Un tenant en `FLOOR` obtiene FLOOR en los
cálculos intermedios y la regla de Postgres en lo que se guarda. Hoy nadie lo nota porque
los seis tenants están en `HALF_UP`, que coincide con esa regla.

**Esta spec resuelve las dos cosas con la misma pieza**, porque son la misma: un monto que
llega a la persistencia ya cuantizado a la escala de su moneda no deja nada que Postgres
pueda recortar.

---

## La decisión de diseño que la spec propone

> Las once decisiones dejaron una pregunta explícitamente abierta: *"¿dónde vive la
> cuantización a la escala de la moneda: una pasada al cerrar la venta en el motor, o cada
> campo en su punto de escritura?"*. **Se propone acá y se confirma al revisar.**

**La cuantización vive en el motor, y la escala de la moneda entra a `ConfigCalculo`.**

Tres razones, en orden de peso:

1. **El nivel de redondeo es aritmética, no persistencia.** "Por línea" significa cuantizar
   cada línea *antes* de sumarlas; "por documento" significa sumar y cuantizar al final.
   Son dos cuentas distintas que dan resultados distintos — no dos formas de guardar el
   mismo número. Si la cuantización viviera en el punto de escritura, la perilla de (c) no
   tendría dónde ejecutarse, o habría que reimplementar la decisión en cada punto.
2. **El snapshot se enriquece solo.** `ventas.service.ts:440` congela `resultado.config`,
   el objeto `ConfigCalculo` entero. Agregar `decimalesMoneda` y `nivelRedondeo` ahí los
   deja congelados **sin tocar el punto de congelado**, que es lo que (c.2) obliga. Los
   dos únicos lectores del snapshot (`findOne` y `VentaDetalleDrawer.vue`) no se rompen:
   leen por campo, con fallback.
3. **El motor es puro y testeable sin base.** La cuenta más delicada del sistema queda
   cubierta por tests unitarios, no por e2e contra Postgres.

**Lo que NO pasa por el motor no necesita su propia cuantización**, con una excepción. Si
todos los insumos son enteros, las restas y sumas posteriores lo son por construcción:

| Campo | Por qué queda entero |
|---|---|
| `baseVentasSinImpuestos` (`:417-419`) | `totalFinal − totalImpuestos`, resta de dos enteros |
| `targetCobro` (`:768-770`) | `totalFinal + propina`; la propina la valida el borde (d) |
| `pagos.vuelto`, saldos | restas contra `targetCobro` |
| `pagos.monto` | lo valida el borde (d) |
| **La línea de NC** (`:1010`) | ⚠️ **la excepción**: no pasa por el motor y se cuantiza explícita (decisión g) |

Es el argumento de cierre completo: la cadena del vuelto —el caso peor, medido en
`994942.5000`— sale entera sin tocar `pagos.service.ts`.

---

## Las tres escalas, y quién manda en cada una

| Escala | Valor | Qué gobierna | Quién la fija |
|---|---|---|---|
| **Borrador** | `escala_calculo` (def. 6) | pasos intermedios encadenados | tenant, ya existe |
| **Tasa** | 4 (`ESCALA_PERSISTIDA`, `ESCALA_COSTO`) | `precio_unitario`, CPP, costos de receta/combo, conversión de costo | fija, decisión (a) |
| **Monto** | `moneda.decimales` | todo monto cobrado que se persiste | la moneda, **nueva** |

La frontera entre tasa y monto se cruza **en una multiplicación**: `tasa × cantidad ⇒
monto`. En el motor eso ocurre en `calculo-precios.engine.ts:520`
(`netoUnitario × cantidad`); fuera del motor, en la línea de NC. No hay ningún campo que
cruce la frontera solo.

### ✅ Qué representa `moneda.decimales` — decidido el 2026-08-20

**Decidido:** `moneda.decimales` es el **minor unit** de la moneda —cuántas unidades
mínimas tiene, o sea lo que se debe y se cobra—, **no** un formato de exhibición. La
presentación se **deriva** de él.

> ❓ **La levantó el owner al revisar este borrador** (*"los decimales de la moneda es solo
> para presentación, o eso tengo entendido"*), y era una premisa que la spec usaba sin
> declarar. La investigación del 2026-08-15 ya la había dejado abierta: hay **cuatro**
> precisiones distintas (ISO / CLDR / la del gateway / la de la tasa publicada) y
> *"una sola columna no puede contestar cuatro preguntas: el diseño va a tener que decidir
> cuál de las cuatro representa"*. Esta spec es ese diseño.

**Por qué:** *"¿cuántos decimales tiene un peso chileno?"* no es una pregunta de
presentación — es un hecho del mundo: no existe medio peso. Los otros campos del catálogo
sí son elecciones de exhibición (`locale`, `separadorDecimal`, `separadorMiles`: misma
plata, convenciones regionales distintas). `decimales` no es de esa familia, y la
causalidad va al revés de como la doc lo insinúa: el frontend muestra CLP sin decimales
**porque** el peso no tiene centavos. La doc agrupó una consecuencia con sus causas.

Y el sistema ya lo trata así: si fuera presentación, el uso que hace propinas
—`factor = 10^decimales` para llevar el monto a unidades mínimas antes de repartir, con el
número congelado dentro de la liquidación— sería un bug. No lo es: es el patrón financiero
que este frente quiere generalizar.

**Qué obliga:**
- **`configuracion-monedas.md` se corrige en el mismo commit que la implementación.** Es
  la doc que indujo la lectura, y si queda como está el próximo lector tropieza igual —
  con la diferencia de que para entonces habrá código financiero apoyado en ella.
- **El criterio de la separación futura queda escrito**, para no discutirlo de cero cuando
  llegue: el día que ISO y CLDR difieran para una moneda que el sistema use de verdad (el
  caso conocido es **AFN**: 2 en ISO, 0 en CLDR), lo que se separa en una columna nueva es
  **la presentación**. El cálculo se queda con el campo que ya tiene consecuencia
  contable.
- **No se renombra la columna.** `decimales` es ambiguo y por eso pasó esto, pero el
  rename toca frontend, propinas y seeder: meterlo acá sería el arrastre que el
  aislamiento de la tanda 🔴 existe para impedir. Va como tarea propia.

**Lo que se descartó, y por qué:**

| Opción | Por qué no |
|---|---|
| **B. Es solo presentación** | Obligaría a un dato nuevo para la escala de lo que se debe **y a revisar propinas**, que hoy calcula y congela con este campo. Además la asimetría de riesgo la desaconseja: tratarlo como minor unit no produce hoy **ningún** número incorrecto —los tres valores sembrados ya son los minor units correctos—, mientras que tratarlo como presentación deja vivo el medio peso en CLP, que es el bug que abrió el frente |
| **C. Dos columnas desde el día uno** | Crearía un campo cuyo valor sería idéntico al existente en las tres monedas del sistema: el mismo patrón de columna-sin-consumidor que este frente criticó en `moneda.decimales` |

🔶 **El caso que sí va a forzar esta conversación no es este eje: es la UF.** Se cotiza con
4 decimales pero se paga en pesos enteros; con UF como moneda oficial de un tenant, los
totales se persistirían en una unidad en la que ninguna pasarela cobra. Está anotado como
hueco desde la investigación del 15, se resuelve con la distinción *unidad de cuenta vs
medio de pago*, y esta decisión no lo cierra ni lo complica.

**La evidencia de los dos lados, para que la decisión no se relea como obvia:**

**A favor de "es formato de UI"** —y es de donde sale, con razón, la lectura del owner—:

- [`configuracion-monedas.md:53`](../../features/configuracion-monedas.md) dice *"Cada
  registro del catálogo `moneda` define cómo presentar montos en el UI"*, y `:63` insiste:
  *"define **cómo se muestran y editan** los montos"*. En la lista de "agregar una moneda
  nueva" (`:128`), `decimales` aparece junto a `locale` y los separadores.
- Sus tres consumidores en el frontend son de presentación: `stores/monedas.ts:98`,
  `utils/currency-format.ts`, `MoneyInput.vue`.
- ⚠️ Matiz que importa: la **tabla** que desarrolla esa sección (`:55-59`) lista solo
  `locale`, `separadorDecimal` y `separadorMiles`. **`decimales` no está ahí.** La doc
  nunca lo declara de presentación; lo deja cerca.

**A favor de "es el minor unit":**

- **Propinas ya lo usa para calcular, no para mostrar.** `mayores-restos.ts:41` hace
  `factor = 10^decimales` para llevar el monto a **unidades mínimas enteras** antes de
  repartir, y `liquidacion_propinas.decimales_moneda` lo **congela en el documento**.
  Nadie congela un formato de exhibición dentro de un comprobante.
- **Los valores sembrados son minor units ISO 4217 exactos**, no elecciones de display:
  CLP 0 (`seeder.service.ts:210`), USD 2 (`:232`), UF 4 (`:221` — y su `codigoNumero:
  '990'` es el de CLF, minor unit 4).
- La investigación del 2026-08-15 lo anticipó y lo dejó explícitamente sin decidir: hay
  **cuatro** precisiones distintas (ISO / CLDR / la del gateway / la de la tasa
  publicada), y *"`moneda.decimales` es una sola columna y no puede contestar cuatro
  preguntas: el diseño va a tener que decidir cuál de las cuatro representa"*. **Esta spec
  es ese diseño, y la decisión no está tomada.**

La contra honesta de la decisión: un tenant **no** puede mostrar con distinta precisión de
la que calcula. Hoy nadie lo pide, y el día que alguien lo pida se resuelve separando la
presentación, según el criterio de arriba.

⚠️ **Un invariante que hoy nadie enforcea:** la cuantización sobrevive al `INSERT` solo
mientras `moneda.decimales ≤ 4`, porque las columnas son `NUMERIC(18,4)`. Las tres monedas
sembradas cumplen (UF 4, USD 2, CLP 0) pero la columna es `smallint NOT NULL DEFAULT 0`
**sin CHECK**: sembrar una moneda con 6 decimales devolvería la decisión a Postgres en
silencio. Se cierra con un CHECK en `moneda.decimales` y su test.

---

## Cómo cuantiza el motor

### La regla de derivación — los totales no se cuantizan, se derivan

**Se cuantizan los componentes; los totales salen de sumarlos.** Cuantizar un total por su
cuenta, además de sus partes, es lo que rompe las identidades: `neto − desc + rec + imp`
puede no dar el mismo entero que redondear el total exacto.

⚠️ **Y la cuantización es un paso de CIERRE de línea, no un redondeo dentro del bucle de
reglas.** El acumulado sobre el que las reglas se encadenan sigue corriendo a
`escala_calculo`, exactamente como hoy: cuantizar el acumulado en cada paso, con CLP-0,
haría que tres descuentos encadenados en modo `compuesto` compongan el error paso a paso
—que es el caso del Vancouver Stock Exchange que la investigación documenta, y lo que el
SAT y el IRS instruyen evitar: *redondear una sola vez, al final*—. Cada componente se
lleva a la escala de la moneda **una vez**, cuando la línea se cierra.

Con `nivel = linea` (el default):

```
netoUnitario         tasa, NO se cuantiza a la moneda (es precio unitario, escala 4)
subtotalNeto     = Q(netoUnitario × cantidad)      ← primer monto de la cadena
descuento        = Q(…)  por regla
recargo          = Q(…)  por regla
impuesto         = Q(tasa × base)   ó  residuo (camino desbruteado, ver abajo)
totalLinea       = subtotalNeto − descuentos + recargos + impuestos   ← suma, no Q()

totalFinal       = Σ totalLinea − dv + rv                            ← suma, no Q()
```

`Q(x)` = `x.toDecimalPlaces(decimalesMoneda, modoToRounding(modoRedondeo))`. Es la misma
forma que ya tiene `redondear()` (`calculo-precios.engine.ts:221-223`), con otra escala.

Con esto **las identidades aditivas cierran por construcción**: `MntTotal = MntNeto + IVA`
y `totalFinal = Σ líneas − dv + rv` son sumas de enteros.

### Las reglas de nivel venta son campos de documento — y así se cumple (c.1)

La obligación (c.1) dice que la promesa *"por línea ⇒ el cliente suma el ticket y llega al
total"* es falsa mientras existan `dv`/`rv`, y que la spec tiene que definir qué son en el
documento. **Se propone: campos de documento cuantizados, no repartidos a las líneas.**

El modelo ya lo soporta: `ventas_descuentos`/`ventas_recargos` tienen `detalle_id`
nullable, y las reglas de nivel venta se persisten justamente con `detalle_id = null`
(`ventas.service.ts:552-581`, con el comentario que lo explica). Es el mismo objeto que el
`DscRcgGlobal` del DTE.

Con `dv`/`rv` cuantizados, el ticket se verifica sumando: **líneas enteras, descuento
global entero, total entero**. La promesa se restituye sin repartir nada.

Repartirlos a las líneas se descarta: cambiaría los montos de línea que el cliente ya vio
en el carrito, y volvería el desglose imposible de explicar ("¿por qué esta línea vale un
peso menos que su precio?").

### El camino desbruteado: el impuesto es el residuo (decisión e)

Hoy el impuesto sale **siempre** de `tasa × base` (`:581`), en un bloque sin ninguna rama
por `precioIncluyeImpuesto` — el desbruteo (`:511-519`) solo cambia cómo se obtiene el
neto. La decisión (e) exige **una rama nueva**, no un ajuste.

**La regla propuesta, general:** en el camino `precio_incluye_impuesto`, los impuestos de
la línea suman **exactamente `T − N`**, donde `T` es el total que la línea debe cobrar y
`N` el neto cuantizado.

```
T = total de la línea tras aplicar la fórmula   (sin reglas: góndola × cantidad)
N = Q(T / (1 + Σ tasas))
Σ impuestos = T − N        ← residuo exacto, no se redondea: es una resta
```

El caso que la decisión nombra: góndola **993**, IVA 19%. `N = Q(993/1.19) = Q(834.4537)
= 834`; impuesto `= 993 − 834 = 159`; total **993** = la etiqueta. Con la fórmula vieja
daba `Q(834 × 0.19) = 158` y total **992**, un peso menos que la góndola.

**Con varios impuestos** (el caso de la botella con ILA, que el motor ya contempla al
dividir por `1 + Σ tasas`) — ✅ **decidido el 2026-08-20: el IVA absorbe el residuo y los
adicionales quedan exactos.**

```
adicionales = Q(tasa × base)  cada uno, por su fórmula
IVA         = (T − N) − Σ adicionales      ← absorbe el residuo
```

**Por qué:** extiende la regla que (e) ya fijó —*"cede el IVA"*— en vez de inventar una
segunda regla de redondeo para el mismo fenómeno. Un reparto proporcional dejaría al IVA
inexacto incluso cuando un adicional podía absorber; y "el de mayor tasa absorbe" cambia
de protagonista según el caso (el IVA manda sobre un ILA del 10%, pero un licor al 31,5%
manda sobre el IVA), lo que vuelve la boleta difícil de anticipar.

**Es barato: el dato ya viaja.** El service tipa su mapa como
`ImpuestoResuelto & { tipo: string }` (`calculo-precios.service.ts:95`) y agrega el IVA
explícitamente como `ivaDelPais` (`:343`), así que los objetos que llegan al motor **ya
llevan `tipo`** — falta declararlo en la interfaz `ImpuestoResuelto`
(`calculo-precios.engine.ts:39-50`), que hoy solo tiene `id`, `nombre`, `porcentaje` y
`activo`.

⚠️ **El borde a cubrir: una línea exenta con adicionales no tiene IVA que absorba.** Si
`clasificacion_tributaria !== 'afecto'` el motor no agrega `ivaDelPais` (`:337-344`), pero
los `'otro'` aplican igual (DL 825 / `IndExe` del DTE). Ahí absorbe **el adicional de
mayor tasa**, con desempate determinista por id. Va con test propio: es el caso que una
implementación apurada deja tirando una excepción o repartiendo mal.

**No toca el nivel venta.** Verificado: `calcularLinea` (`:498-606`) y el bloque de reglas
de venta (`:624-685`) son disjuntos, y el paso `impuestos` **no existe** a nivel venta
(`:633-634`). La decisión (f) queda intacta, que era su condición.

⚠️ **Y hay que decirlo en el código y en la doc:** después de esto el IVA persistido puede
diferir de `tasa × base` por **dos razones distintas a la vez** — la elegida (e: cerrar a
góndola) y la diferida (f: el descuento de venta no baja la base del IVA). Si no quedan
separadas, quien audite una boleta va a "arreglar" la consecuencia elegida creyendo que
persigue el defecto.

---

## Modelo de datos

### `tenants` — una columna nueva

| Columna | Tipo | Notas |
|---|---|---|
| `nivel_redondeo` | `TEXT NOT NULL DEFAULT 'linea'` | `'linea'` \| `'documento'` |

**No se agrega ninguna columna de escala de moneda.** `moneda.decimales` ya existe; lo que
falta es que el camino de la venta la lea. Y **ninguna columna de "escala cobrable"**: la
decisión (i) la descartó — la escala del cable es de cada pasarela y vive en su adaptador.

### `moneda` — un CHECK

`decimales BETWEEN 0 AND 4`, por el invariante de arriba. Es el único freno que impide que
el cast de Postgres vuelva a decidir sin que nadie se entere.

### `ConfigCalculo` — dos campos nuevos, y el snapshot los hereda

`calculo-precios.engine.ts:63-70` pasa de 5 a 7 campos: se suman `nivelRedondeo` y
`decimalesMoneda`. Al congelarse `resultado.config` entero (`ventas.service.ts:440`), los
dos entran al snapshot **sin tocar el punto de congelado**.

`decimalesMoneda` sale de la **moneda oficial del tenant**, que es la moneda en que la
venta se persiste. El dato está casi a mano: `ventas.service.ts:274-279` ya consulta
`tenant_moneda` para resolverla — falta un `JOIN moneda` y una columna más **en una query
que ya corre**, no una query nueva.

⚠️ **`decimalesMoneda` es dato derivado congelado, no configuración.** Va al snapshot por
la misma razón que `tasa_cambio` se congela por línea: si mañana se corrige la moneda del
tenant, una venta vieja tiene que seguir siendo interpretable con lo que valía entonces.
No se expone en Preferencias Financieras — nadie lo elige.

---

## La matriz de interacción es validación, no documentación

La obligación (c.4) pedía una matriz explícita `nivel × modo × escala`. La decisión **P1**
la convierte en código: alguna combinación tiene que ser **rechazable**.

| Combinación | Veredicto |
|---|---|
| `nivel = documento` + moneda oficial de **0 decimales** | 🚫 **Rechazada (400)**. Reproduce a propósito el `.5000` en las líneas — el bug que motivó este frente. La posición `documento` existe para jurisdicciones tipo México, no para CLP |
| `escala_calculo < decimales` de la moneda oficial | 🚫 **Rechazada (400)**. El borrador no puede ser más grueso que el resultado |
| `nivel = linea` + cualquier modo + `escala ≥ decimales` | ✅ El camino de todos los tenants de hoy |
| `nivel = documento` + moneda con decimales (USD, UF) | ✅ Permitida, sin consumidor hoy |
| `modo_redondeo` en el **reparto de propinas** | ➖ **No entra a propósito** (decisión P8). En un apportionment la garantía Σ partes = total no depende del modo; solo el desempate, determinista por id |

La validación vive en el `PUT /api/tenants/preferencias-financieras`, que ya es
transaccional y admin-only. Exige cargar la moneda oficial del tenant en ese endpoint —
hoy no lo hace.

🔶 **A confirmar al revisar:** ¿el rechazo de `documento` + CLP es un 400 duro, o un aviso
que el admin puede aceptar? Un 400 es coherente con "la perilla no ofrece el bug como
opción"; un aviso deja salida a un caso que no previmos. La spec propone **400 duro**: si
aparece el caso, se cambia con evidencia.

---

## Los bordes de entrada

**Dónde vive el rechazo** (decisión P2): **solo en el borde de API** — DTO y pipe. Los
services no se tocan.

**Qué se valida:** que un monto no traiga más decimales de los que su escala admite.

| Familia | Escala | Sitios |
|---|---|---|
| Montos cobrados | `moneda.decimales` | `pagos.monto`, monto de NC, movimientos de caja, `saldoInicial`, `montoContado` del cierre, propinas (sugerida, pagada, montos manuales de liquidación), `precioBase` al aplicar desfase |
| Costos | 4 | ajuste de costo, costo de compra, costo por unidad de mermas y compras |
| `montoTolerancia` | `moneda.decimales` | decisión **P7** — además suma validación de **signo**: una tolerancia negativa no significa nada |

### Cómo se implementa, con la escala dinámica

La escala de los montos cobrados **depende de la moneda oficial del tenant**, y un
decorador de `class-validator` es estático: no la conoce. La de costos (4) sí es estática y
vive en el DTO como los demás decoradores.

✅ **Decidido el 2026-08-20: decorador de metadata + pipe con contexto del tenant.** El
campo se marca declarativamente (`@EsMontoCobrado()`), y un pipe resuelve la escala a
partir del tenant del token y valida.

**Por qué:** el DTO sigue siendo el contrato, y el próximo endpoint que reciba plata no se
puede olvidar de validar — que es exactamente cómo aparecieron los huecos que este frente
encontró (`pagos.monto` y el movimiento de caja entran crudos hoy). Un helper llamado a
mano en cada controller es más simple pero se dispersa, y la dispersión es el defecto que
estamos cerrando.

**El costo, dicho:** infraestructura nueva (el pipe y su decorador) y **una consulta
indexada por request que traiga plata**, para resolver la moneda oficial del tenant. **Sin
caché al principio**: una venta ya hace 113 consultas, así que una más no mueve la aguja, y
un caché exigiría invalidarlo cuando el admin cambia la moneda oficial
(`PATCH /api/monedas/:id/default`) — complejidad que conviene pagar solo si la medición la
justifica.

⚠️ **`tenant_id` sale del token, nunca del body** (invariante de `CLAUDE.md`): el pipe lee
el mismo contexto que los guards, no un campo del payload.

**El webhook de reembolso queda afuera del 400** (decisión P3): cuantiza y **registra el
valor original**. Validar una intención y registrar un hecho ya consumado no son la misma
operación — la pasarela ya cobró, y rechazar el callback pierde el evento. Por eso el
criterio de (d) se enuncia como *"la plata que una **persona** ingresa"*, no *"toda la
plata que entra por API"*.

**Los clamps internos que quedan se documentan como escala de captura**, no quedan mudos:
`caja.service.ts:731`, los cuatro de propinas manuales
(`liquidacion-propinas.service.ts:980, :1033, :1070, :1507`), los de costo
(`inventario.service.ts:227, :353, :403`) y los de precio al aplicar desfase
(`items.service.ts:4292, :4344`). Misma obligación que (b) impuso a los costos: el
silencio es lo que obligó a reconstruir todo midiendo. Mención aparte para
`caja.service.ts:247`, que no clampa nada — su comentario dice que la escala ya vino
validada del borde, no que ahí no pasa nada.

---

## Frontend

**Máscara, no recorte** (decisión P6): el input no deja tipear más decimales de los que la
moneda admite. Recortar al enviar cumpliría la letra de (d) y contradiría su porqué —el
sistema no cambia calladamente lo que una persona escribió.

- `MoneyInput.vue` ya conoce `moneda.decimales` (lo usa para formatear): falta que
  restrinja la entrada.
- **Hay que enumerar los inputs de plata que no pasan por `MoneyInput`.** Si alguno queda
  suelto, el backend lo va a rechazar y la pantalla no va a saber por qué.
- **El espejo pendiente entra acá** (decisión §abierto): `useMonedaConversion.ts:23` dice
  *"Misma lógica que el backend"* sobre un `toFixed(4)` sin `modo_redondeo` — la misma
  divergencia mostrado-vs-guardado que el arreglo del 2026-08-11 cerró del otro lado. Se
  alinea con el criterio nuevo, y su gemelo `useUnidadConversion.ts:32` queda en escala de
  costo, que es lo correcto para una tasa.

---

## La nota de crédito

**Alcance mínimo** (decisión g): se arregla **la línea**, el único de los once sitios con
veredicto MAL.

```
ventas.service.ts:1010   Q(precioUnitario × cantidad)
                         con decimalesMoneda y modoRedondeo del config_calculo
                         CONGELADO en la venta original — la NC corrige aquel
                         documento, hereda su criterio, no el vigente
```

Tres piezas de mecánica:

1. **El dato hay que traerlo.** `lockVentaOriginal` (`:1227-1257`) selecciona 7 columnas y
   `config_calculo` no está. Es una columna más en un `SELECT` que ya corre bajo
   `FOR UPDATE`, más el campo en el tipo de retorno.
2. **La NC congela lo que heredó** (decisión P4): `crearNotaCredito` (`:988-1004`) suma
   `configCalculo` al `manager.create`. Con eso `config_calculo = NULL` deja de ser un
   estado permanente del modelo, y los dos comentarios que hoy dicen lo contrario
   (`ventas.service.ts:1738-1740`, `VentaDetalleDrawer.vue:112-116`) se actualizan en el
   mismo commit. El drawer pasa a mostrar el bloque "Cómo se redondeó" también en las NC
   (`:845`).
3. **Sin config, se falla ruidosamente** (decisión P5), con un error que nombre la venta y
   el caso — no un `TypeError` de acceso a `null`. Después del reset ninguna venta queda
   sin config, así que es un **canario**, no un camino esperado.

**Lo que NO entra:** el desglose de IVA de la NC y el cuadre cabecera↔líneas. Hoy la
cabecera es `params.monto` del cliente, `totalImpuestos = '0'` fijo (`:1001`) y las líneas
son informativas sin relación exigida. Es entrada de backlog propia, y **contestarla es
requisito de cualquier criterio de redondeo más ambicioso para la NC**.

---

## Los veredictos se escriben en el código

Los once sitios están mudos hoy, y ese silencio es lo que obligó a reconstruir todo
midiendo. Cada uno queda con un comentario que diga por qué redondea como redondea —los
textos propuestos están en la §1 de la lectura independiente— **y que diga que no mira
`modo_redondeo` a propósito** (decisión b).

Alcanza a los once **más los dos gemelos de escritura** que el relevamiento omitió:
`items.service.ts:3508` (receta) y `:3580` (combo), que son la misma cuenta en el camino
que persiste al crear o editar. Hoy divergen en forma: uno pasa el modo explícito y el
otro usa el default. Si los pares divergieran en criterio, la bandeja de desfases
compararía manzanas con peras (`eq4`, `items.service.ts:3669`).

**`ESCALA_COSTO = 4` pasa a ser un concepto nombrado**, no un `toFixed(4)` repetido a mano
en 106 líneas de 17 archivos.

**Y una nota que evita una contradicción aparente:** (k) protege lo que **una persona
tipea**; el sistema sigue cuantizando en silencio **sus propios cálculos** (el CPP de
`inventario.service.ts:410` produce más de 4 decimales y se recorta). "Una sola regla
mental" vale para la plata que alguien escribe. El comentario tiene que decirlo, o el
próximo lector va a leer una incoherencia.

**El contrato de las pasarelas** (decisión i) deja de ser una particularidad de Webpay:
**todo provider valida en su borde y nunca redondea ahí** — un provider que redondee
estaría cambiando lo que el documento dice que se cobró. Va a
[`docs/patterns/backend.md`](../../patterns/backend.md), que es donde vive el playbook, y
se referencia desde `pagos.md`.

**`escala_calculo` se documenta por lo que NO hace** (decisión j): es la precisión del
borrador y **no decide nada de lo persistido**. Recién ahora esa frase es verdadera —
hasta esta spec, lo persistido lo decidía el cast de Postgres.

---

## Documentación viva — se actualiza en el mismo commit

| Archivo | Qué cambia |
|---|---|
| [`features/configuracion-monedas.md`](../../features/configuracion-monedas.md) | **Qué es `decimales`**: el minor unit de la moneda, del que se deriva la presentación — hoy la sección de formato lo induce a leerse como dato de UI (`:53`, `:63`) |
| [`features/motor-calculo-precios.md`](../../features/motor-calculo-precios.md) | La escala de cierre, el nivel de redondeo, la regla de derivación y la rama del desbruteo. Y la frase de `escala_calculo` pasa a ser verdadera: hasta ahora lo persistido lo decidía Postgres |
| [`features/preferencias-financieras.md`](../../features/preferencias-financieras.md) | `nivelRedondeo` y la matriz de combinaciones rechazadas. ⚠️ Arrastra dos desactualizaciones previas: el *"What is it"* enumera **3** campos cuando la pantalla tiene 6, y dice que el motor de precios está *"pendiente"* cuando existe desde junio |
| [`features/impuestos.md`](../../features/impuestos.md) | Que el IVA persistido puede diferir de `tasa × base` por la decisión (e) — **consecuencia elegida**, separada del defecto diferido de (f) |
| [`features/reembolsos-nota-credito.md`](../../features/reembolsos-nota-credito.md) | La NC hereda el criterio congelado y congela el suyo |
| [`patterns/backend.md`](../../patterns/backend.md) | El contrato de las pasarelas (decisión i): validar en el borde, nunca redondear ahí |
| [`agent/anti-patterns.md`](../../agent/anti-patterns.md) | Redondear dentro del bucle de reglas en vez de al cerrar (el caso Vancouver), y cuantizar un total por su cuenta en vez de derivarlo |
| [`ESTADO.md`](../../ESTADO.md) | La fila que corresponda |
| [`agent/pendientes.md`](../../agent/pendientes.md) → [`resueltos.md`](../../agent/resueltos.md) | La entrada 🔴 se cierra y se muda, con el detalle de qué cubrió y qué quedó diferido |

## Qué NO entra

- **El IVA vs el descuento de nivel venta** (decisión f) — el paso `impuestos` no corre a
  nivel venta, así que un descuento de venta baja lo cobrado pero no la base del IVA.
  Pesa más que todo lo de acá y **ninguna cuantización lo arregla**. Entrada propia.
- **La NC como documento** — desglose de IVA y cuadre cabecera↔líneas (arriba).
- **El redondeo de efectivo / denominación mínima** (decisión h) — Ley 20.956: no toca el
  documento tributario ni el impuesto, es una diferencia de caja aparte. Se **nombra** el
  dato ahora (`moneda.decimales` ≠ moneda física más chica; CLDR los modela separados)
  para que `decimales` no nazca siendo "el número que sirve para todo", **sin crear la
  columna**: una columna sin consumidor repetiría el patrón que este mismo frente
  documentó como problema.
- **Los ~30 DTOs con `@IsNumberString` sin trazar** hasta su punto de persistencia
  (medidos: 66 usos, 29 evidentemente plata). Entrada propia.
- **El guard de NC-sobre-NC que no corre en el webhook** — hallazgo de la segunda ronda,
  entrada propia.
- **El signo del abono en `POST /pagos`** — hallazgo del análisis, entrada propia.
- **La tabla país→nivel de redondeo** — (c.5) pide que el campo *pueda* fijarse desde
  afuera el día que exista; no que exista hoy. Hoy Chile no fija nivel.
- **El rename de `moneda.decimales`.** El nombre es ambiguo —es lo que causó la duda del
  owner sobre esta misma spec— pero renombrarlo toca frontend, propinas y seeder, y
  meterlo acá sería exactamente el arrastre que el aislamiento de la tanda 🔴 impide.
  Entrada propia.
- **La UF como moneda oficial de un tenant** — se persistirían totales en una unidad en la
  que ninguna pasarela cobra. Es *unidad de cuenta vs medio de pago*, no redondeo. Hueco
  declarado desde la investigación del 15.

---

## Riesgos y límites conocidos

1. **Es un cambio del motor de cálculo, la zona 🛑 de `CLAUDE.md`.** Va en una pasada
   dedicada, con el sistema quieto, y no se toca de a pedazos: el arreglo anterior del
   redondeo se hizo por partes y **hubo que revertirlo** —cubría el precio que se muestra
   y no el que se guarda—. Esa es la evidencia que originó el aislamiento de la tanda 🔴.
2. **Las identidades multiplicativas no cierran, y no pueden.** Quedan tres residuos
   conocidos: el desbruteo con varios impuestos, Σ IVA de línea vs IVA de documento
   (hasta ⌈N/2⌉ pesos con N líneas), y `MontoItem` vs `PrcItem × QtyItem` (≤ 0,5 por
   línea, inherente al formato del SII). Se aceptan y se documentan; no se resuelven.
3. **Qué tolera el SII si Σ líneas ≠ `MntTotal` sigue sin respuesta** — dos pasadas de
   investigación no encontraron la circular, y la hipótesis razonable es que no existe.
   Ninguna decisión de esta spec depende de resolverlo, pero (e) y (c) conviven con él.
4. **ADR-010 difiere las reglas exactas de redondeo del IVA a la certificación**, y (e)
   decide una ahora. No es una violación —congela el hecho fiscal en la transacción, que
   es lo que el ADR pide— pero **si la certificación exige `IVA = tasa × base` por línea,
   (e) se revierte**. Queda registrado como deuda de revisión conocida.
5. **La perilla de (c) nace sin consumidor.** El 100% de los tenants queda en el default,
   y la posición `documento` queda además frenada para CLP. El owner lo eligió sabiéndolo,
   con la contra registrada; el freno de la matriz es lo que evita que la opción prometa
   algo que no entrega.
6. **Los tests que rompen son nueve, no ocho.** Los ocho de aceptación que (d) enumera más
   `tenants.service.spec.ts:613` (`montoTolerancia: '1.5'`), que apareció en la segunda
   ronda. Se actualizan como parte del cambio, no se descubren después.

---

## Testing

**Unit — motor (`calculo-precios.engine.spec.ts`):**
- Una venta en CLP-0 no produce **ningún** monto con decimales, en las cinco salidas de
  línea y los cinco totales.
- `nivel = linea`: `Σ totalLinea − dv + rv = totalFinal`, exacto, con reglas de venta
  presentes (el caso que hace falsa la promesa hoy).
- `nivel = documento`: solo el total queda cuantizado.
- El modo se respeta **en la escala de la moneda**: FLOOR, CEIL y HALF_UP dan resultados
  distintos sobre el mismo carrito.
- Desbruteo, con el caso numérico exacto: **993 → 834 + 159 = 993**. Y sus vecinos que ya
  cerraban (995, 997, 1000, 1990), para que la rama nueva no rompa lo que andaba.
- Desbruteo con dos impuestos (IVA + ILA): la suma de impuestos es exactamente `T − N`.

**Unit — bordes:** cada familia de DTO rechaza un decimal de más, y **acepta un entero
escrito con ceros a la derecha** (`'1000.00'` en CLP-0 es válido, decisión de abajo). Los
nueve tests de aceptación existentes se actualizan.

**Unit — matriz:** las dos combinaciones prohibidas devuelven 400; las permitidas, 200.

**E2E (`ventas.e2e-spec.ts`):** una venta con descuento que hoy produce `16957.5000`
persiste **entera**, y el `config_calculo` congelado trae los siete campos. Una NC hereda
el modo de la venta original y **congela el suyo**.

**E2E (`caja.e2e-spec.ts`):** los dos casos que hoy devuelven 201 con `'10000.5000'` pasan
a 400.

**Mutantes que tienen que morir** (revertir, no solo romper):
1. **Cuantizar el total por su cuenta** en vez de derivarlo de los componentes → el test de
   la identidad aditiva tiene que cazarlo.
2. **Volver el impuesto a `Q(tasa × base)`** en el camino desbruteado → el test de 993
   tiene que cazarlo. Es la reversión exacta de (e).
3. **Quitar la cuantización y dejar que Postgres recorte** → el test de CLP sin decimales
   tiene que cazarlo.
4. **Heredar el `modo_redondeo` vigente** en vez del congelado en la NC → el test de
   herencia tiene que cazarlo (crear la venta con un modo, cambiar la preferencia, emitir
   la NC).

⚠️ **La verificación va con el gate completo** (`npm run test:e2e` entero, no un subset):
un cambio de validación en DTOs compartidos rompe specs lejanas, y ya pasó acá.

---

## Lo que se cerró al revisar, y lo que queda

**Cerrado el 2026-08-20**, en la revisión de este borrador con el owner:

| # | Pregunta | Decisión | Dónde vive |
|---|---|---|---|
| 0 | ¿Qué representa `moneda.decimales`? | **El minor unit**, no presentación | §"Qué representa `moneda.decimales`" |
| 1 | El residuo del desbruteo con varios impuestos | **El IVA absorbe; los adicionales exactos** | §"El camino desbruteado" |
| 2 | La mecánica del rechazo con escala dinámica | **Decorador de metadata + pipe con contexto**, sin caché al principio | §"Cómo se implementa, con la escala dinámica" |
| 3 | `'1000.00'` en CLP-0 | **Válido**: la regla es sobre el valor, no sobre la cadena | §"Los bordes de entrada" |

**Queda una, chica:** ¿el rechazo de `nivel = documento` + moneda de 0 decimales es un
**400 duro** o un **aviso que el admin puede aceptar**? La spec propone 400 duro —
coherente con que la perilla no ofrezca el bug como opción—, pero un aviso deja salida a un
caso que no previmos. No bloquea el plan: cambia una rama de validación y su test.
