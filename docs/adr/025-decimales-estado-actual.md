# ADR-025: Estado actual de los decimales — la línea base contra la que se mide ADR-024

**Status**: Accepted

**Date**: 2026-09-03

## Context

[ADR-024](./024-decimales-redondeo-y-unidades-de-cuenta.md) fijó **a dónde vamos** con
decimales y redondeo. Se escribió sin una descripción medida de **dónde estamos**, y eso deja
un problema concreto: sin línea base, cualquiera puede leer 024 como "hay que construir todo
esto", cuando **buena parte ya está construida** — de hecho, tres de las cinco preguntas de la
investigación se cerraron justamente porque el código ya las contestaba.

Este ADR fija ese estado actual **medido contra el código el 2026-09-03**, no recordado. Es un
ADR y no un documento de feature porque varias de las conductas de abajo **son decisiones que
nunca se escribieron como tales**: el tope de 4 decimales, las tres combinaciones prohibidas,
y que la presentación ya tenga columnas propias. Quedan aceptadas acá, con su razón, para que
el delta contra 024 sea un dato y no una interpretación.

## Decision

Se acepta como línea base lo siguiente, y **no se cambia nada de esto hasta que exista la spec
aprobada de ADR-024**.

### Las cuatro perillas que existen hoy

| Perilla | Dónde vive | Tipo y default | Qué decide |
|---|---|---|---|
| `tenants.escala_calculo` | `tenant.entity.ts` | `smallint`, default **6** | La precisión del **borrador**. No decide nada de lo persistido |
| `tenants.modo_redondeo` | `tenant.entity.ts` | default **`HALF_UP`** (seed) | El modo con el que se redondea |
| `tenants.nivel_redondeo` | `tenant.entity.ts`, `CHECK IN ('linea','documento')` | default **`linea`** | **Dónde cierra** el redondeo |
| `moneda.decimales` | `moneda.entity.ts`, `CHECK BETWEEN 0 AND 4` | `smallint`, default **0** | La escala a la que **cierra** todo monto cobrado |

Monedas sembradas: **CLP 0, USD 2, UF 4**.

**El tope de 4 tiene una razón escrita en la entidad**: toda columna de dinero es
`NUMERIC(18,4)`, así que una moneda con más decimales haría que el recorte final lo decidiera
el cast de Postgres, con su propia regla y fuera de `modo_redondeo`. Subir el tope exige subir
la escala de las columnas.

### El motor distingue redondear de cerrar, y son dos funciones distintas

- **`redondear(d, cfg)`** → `toDecimalPlaces(escalaCalculo, modo)`. Es el borrador: mantiene el
  cálculo intermedio a `escala_calculo`.
- **`cuantizar(d, cfg)`** → `toDecimalPlaces(decimalesMoneda, modo)`. Es el **cierre**: decide
  la plata que el documento declara. Su docblock dice por qué existe: *"sin ella el último
  redondeo lo hacía el cast a `NUMERIC(18,4)` de Postgres"*, con un caso medido en dev
  (`total_final = 16957.5000`, medio peso).

**Se cuantiza al cerrar cada paso de la fórmula, nunca por regla.** Adentro de un paso el
acumulado corre fino, porque cuantizar regla por regla **compone** el error. Y **los totales
se derivan de sus componentes**, no se cuantizan aparte: medido durante el frente, 3.965 de
10.000 carritos quedaban con `MntTotal ≠ MntNeto − Desc + Rec + IVA` al cuantizar cada total
por su cuenta.

### ⚠️ `nivelRedondeo = 'documento'` no es "cuantizar al final": es **no cuantizar la línea**

Esto es lo más fácil de leer mal, y está en una sola línea del motor:

```ts
cfg.nivelRedondeo === 'linea' ? (d) => cuantizar(d, cfg) : SIN_CUANTIZAR
```

Con `documento`, `SIN_CUANTIZAR` es la identidad: la línea corre fina de punta a punta **y se
persiste así**, con `escalaCalculo` decimales. Por eso `documento` arrastra restricciones que
`linea` no tiene.

### Las tres combinaciones que la API rechaza con 400

Están en `tenants.service.ts`, al guardar las preferencias financieras:

1. **`documento` + moneda oficial de 0 decimales** — *"deja decimales en las líneas y la moneda
   oficial del tenant no admite decimales"*.
2. **`escalaCalculo < decimales` de la moneda oficial** — el borrador no puede tener menos
   precisión que el cierre.
3. **`documento` + `escalaCalculo > 4`** — las líneas se persisten con la escala de cálculo, y
   las columnas son `NUMERIC(18,4)`: con más de 4 el recorte lo volvería a decidir Postgres.

📌 Por (3), el default sembrado —escala 6, nivel `linea`— es válido **solo porque el nivel es
`linea`**: ahí el valor ya viene cuantizado a ≤ 4 y lo que el formateo agrega son ceros que el
cast no toca.

### La presentación YA tiene columnas propias — todas menos "cuántos decimales"

`moneda` tiene **`separador_decimal`**, **`separador_miles`** y **`locale`** (BCP 47). O sea
que el eje presentación no está fundido con el de cálculo: lo único que hoy comparte una sola
columna con "lo que se debe" es **el número de decimales**.

Esto es lo que hace que la decisión 5 de ADR-024 (una sola columna, YAGNI) sea más chica de lo
que suena: no es "no separamos presentación de cálculo", es "de los cuatro datos de
presentación, tres ya están separados y el cuarto todavía coincide".

### El congelado del documento existe, y `decimalesMoneda` viaja adentro

`ConfigCalculo` incluye `formula`, `calculoDescuentos`, `calculoRecargos`, `escalaCalculo`,
`modoRedondeo`, `nivelRedondeo` y **`decimalesMoneda`**, y se persiste entera en
`ventas.config_calculo` (`jsonb`). El docblock de `decimalesMoneda` ya dice por qué:

> *"Es dato derivado congelado, no configuración: si mañana cambia la moneda del tenant, una
> venta vieja tiene que seguir siendo interpretable con lo que valía entonces."*

`crearNotaCredito` congela la config heredada en la NC que crea. `LiquidacionPropinas` tiene su
propia columna `decimales_moneda`.

### El borde de la API rechaza la plata que no cabe, por decorador

- **`@EsMontoCobrado`** — 34 usos en 23 archivos. Se valida contra los decimales de la **moneda
  oficial del tenant**.
- **`@EsCosto`** — 19 usos en 9 archivos. Escala fija **4** para todos los tenants, porque no
  es plata cobrada sino dinero por unidad de otra cosa.

Lo hace efectivo `EscalaMonedaPipe`, aplicado **por parámetro** (`@Body(EscalaMonedaPipe)`),
no global.

### Lo que NO sigue a la moneda, y es a propósito

`ESCALA_COSTO = 4` — **43 usos**. Y la escala 4 escrita a mano como `toFixed(4)`: **92 sitios
en 14 archivos**. No es deuda uniforme: en la mayoría es la escala de la **columna**
(`NUMERIC(18,4)`), no una decisión de redondeo — `ventas.service.ts` documenta un caso
explícito: *"Este `.toFixed(4)` NO redondea nunca, y por eso no toma `modo_redondeo`"`.

## Las cinco preguntas, contestadas con lo que hay HOY

Las mismas de la §9 de la investigación, respondidas desde el código y no desde el diseño, con
el delta contra ADR-024 al lado.

### 1. ¿Un solo criterio o un solo número?

**Hoy ya es un criterio con el número puesto por la moneda.** `cuantizar` cierra contra
`decimalesMoneda`, que sale de la moneda oficial del tenant; `escala_calculo` y `modo_redondeo`
son del tenant y valen para todas sus monedas.

✅ **Coincide con ADR-024.** No hay nada que construir: lo que faltaba era escribir la regla,
no implementarla.

### 2. ¿Por línea o por total?

**Hoy es configurable, y la configura el TENANT** (`tenants.nivel_redondeo`, default `linea`),
con las tres combinaciones prohibidas de arriba.

⚠️ **Difiere de ADR-024**, que decidió que **lo fija el país**. El delta es mudar la perilla de
`tenants` a la tabla de países —que hoy no tiene ese dato— y sacarla de las preferencias
financieras del tenant. El mecanismo existe: la moneda oficial ya se deriva del país.

### 3. ¿La UF puede ser moneda oficial?

**Hoy nada lo impide en el código.** La moneda oficial sale de `pais.moneda_oficial_id`, y la
UF está sembrada como moneda de Chile en `pais_moneda` con 4 decimales. Que la oficial de Chile
sea CLP es un **dato del seed**, no un guard: poner la UF ahí sería aceptado.

⚠️ **Difiere de ADR-024**, que decidió que la UF **solo cotiza**. El delta es un guard que hoy
no existe. La regla vive únicamente en los datos.

### 4. ¿Se congela el patrón de propinas en ventas y pagos?

**Ventas: sí, ya está.** `decimalesMoneda` viaja dentro de `ConfigCalculo` y se persiste en
`ventas.config_calculo`, con el porqué escrito en su docblock. Notas de crédito heredan.

**Pagos: no.** `pagos.service.ts` no cuantiza a la moneda en ningún punto: usa `toFixed(4)`, la
escala de la columna. Lo que hoy impide un pago con centavos en CLP es **el decorador del DTO
en el borde**, no el service.

⚠️ **Parcialmente construido.** ADR-024 pide congelar en ventas **y** pagos; ventas ya lo tiene
y pagos no.

⚠️ **Y hay una asimetría medida que no está en ninguna decisión:**
`MonedasService.decimalesDeLaVenta` lee **`m.decimales` de la moneda VIVA** (por `JOIN moneda`)
y **`modoRedondeo` del congelado** (`v.config_calculo`). Los dos datos de la misma decisión de
redondeo salen de dos lugares distintos, y el congelado ya tiene el `decimalesMoneda` que esa
consulta va a buscar a la moneda. Hoy no rompe porque `moneda.decimales` no se puede editar por
API —solo lo escribe el seeder—, así que **es una asimetría latente, no un bug alcanzable**.
Anotarla es el punto: la protege un hecho que no está escrito como invariante.

### 5. ¿Cuántas columnas de decimales?

**Hoy una** (`moneda.decimales`), más **tres columnas de presentación** que ya existen
separadas: `separador_decimal`, `separador_miles` y `locale`.

✅ **Coincide con ADR-024**, que decidió quedarse en una. Con el matiz que ADR-024 no dice: la
separación de presentación **ya está hecha en tres de sus cuatro datos**.

## Consequences

### Positive

- **El delta contra ADR-024 queda en tres puntos concretos y medidos**, en vez de "hay que
  implementar el ADR": mudar `nivelRedondeo` al país, agregar el guard de la UF, y congelar en
  pagos. Los otros dos ya están.
- **Queda escrito por qué `documento` arrastra restricciones que `linea` no tiene** — que la
  línea se persiste **sin cuantizar**—, que es la confusión que hace leer las tres prohibiciones
  como arbitrarias.
- **El tope de 4 y las tres combinaciones prohibidas pasan a ser decisiones registradas.** Hoy
  viven solo en comentarios de código y en mensajes de error, donde nadie las busca antes de
  proponer un cambio de esquema.

### Negative

- **Es una foto, y las fotos envejecen.** Cualquier cambio en el motor, en las preferencias
  financieras o en el pipe de escala deja este ADR desactualizado sin que nada avise. Su valor
  está atado a la fecha del encabezado.
- **Congela el estado como aceptable**, incluida la asimetría de `decimalesDeLaVenta`: quien
  lea esto puede tomar "Accepted" como "está bien así" cuando lo que dice es "así está, y no se
  toca hasta que la spec de 024 esté aprobada".

### Neutral

- **No decide nada nuevo**: donde este ADR y el 024 difieren, manda el **024**, que es la
  decisión; éste describe el punto de partida.
- **La medición pendiente de ADR-024 no cambia por este documento** — sigue siendo repetir la
  comparación `linea` vs `documento` en los tres casos que 024 lista, incluidos los que el owner
  señaló: cotizar en UF y convertir desde dólar con moneda oficial de 0 decimales.
