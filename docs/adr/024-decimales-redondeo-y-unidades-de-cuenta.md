# ADR-024: Decimales y redondeo — un criterio, tres capas, y el nivel lo fija el país

**Status**: Accepted **en parte** — las decisiones **2 y 3 quedaron REABIERTAS por el owner
el mismo 2026-09-03**, unas horas después de contestarlas. Ver el bloque de abajo antes de
tomar nada de este ADR.

**Date**: 2026-09-03

> 🛑 **NO ARRANCAR POR ACÁ. El owner pausó el tema para una sesión propia (2026-09-03).**
>
> Contestó las cinco preguntas por la mañana y a la tarde, al ofrecerle la medición que faltaba,
> dijo textual: *"esto tengo que analizarlo bien y profundo… no tengo el alcance de lo que
> implica si solo cotiza o no… lo de los países no sé si en todos la ley… quedé super
> confundido, creo que dejemos esto para una sesión sola"*.
>
> **Qué sigue firme** (contestado y consistente con lo que el código ya hace):
> **1** un criterio con el número puesto por la moneda · **4** congelar los decimales en el
> documento · **5** una sola columna de decimales.
>
> **Qué está REABIERTO y no se construye:**
> - **2 — el nivel de redondeo lo fija el país.** El owner no sabe si la ley es la misma en
>   todos los países, y la decisión se tomó sobre dos ejemplos opuestos (UK y México). Antes de
>   moverlo hace falta saber **para cuántos países tenemos la regla**, no dos.
> - **3 — la UF solo cotiza.** Es lo que más lo frenó, y el escenario que describió **no está
>   contestado por la decisión tal como está escrita**: *"pueden llevar toda su operación en UF,
>   pero esas UF al final se convierten a pesos para poder pagar"*. Eso suena compatible con
>   *"solo cotiza"*, pero **nadie midió qué implica** — qué pasa con los reportes históricos, con
>   la lista de precios, con la contabilidad, y qué se rompe si el negocio piensa en UF todo el
>   día y el sistema le guarda pesos.
>
> **Y la medición pendiente de más abajo NO se corrió, a propósito**: afina una prohibición que
> depende de las decisiones reabiertas. Medir antes de saber qué queremos es afinar lo que capaz
> no queremos.
>
> 📊 **Los pros y contras de las dos reabiertas ya están analizados contra el código**, a pedido
> del owner: [`2026-09-03-uf-y-nivel-por-pais-analisis.md`](../agent/investigaciones/2026-09-03-uf-y-nivel-por-pais-analisis.md).
> Recomienda **mantener "la UF solo cotiza"** (por una razón distinta de la que decía este ADR)
> y **mover al país las DOS perillas** — `nivelRedondeo` y también `modo_redondeo`, que este ADR
> no había tocado.
>
> ⛔ **El análisis se corrigió en el camino, y el error fue de premisa:** su primera versión
> razonó *"hay un solo país, entonces YAGNI"* y el owner lo corrigió — **el producto es
> multi-tenant para América Latina**, así que multi-país es el objetivo de diseño, no una
> hipótesis. Con eso, de los cinco países relevados **dos son LatAm y los dos tienen regla
> citada, distinta entre sí**: México obliga a redondear al total y Colombia exige half-to-even.
> Hoy los dos **incumplirían por default**.
>
> ⚠️ Y aparece una contradicción adentro de la investigación de agosto: afirma que *"las normas
> que fijan un modo exigen half-up"* y su propia tabla dice que Colombia exige **half-to-even**.
> Ese era el argumento con el que se dejó el modo en manos del tenant.
>
> 🌎 **Se relevaron ocho países de LatAm** (2026-09-03) →
> [`2026-09-03-redondeo-por-pais-latam.md`](../agent/investigaciones/2026-09-03-redondeo-por-pais-latam.md),
> con tres fuentes primarias extraídas de los PDF oficiales. **Da vuelta la prioridad de este
> ADR:**
> - **El MODO es lo urgente, no el nivel.** Argentina lo fija **literal** (*"El criterio de
>   redondeo que utilizamos en este servicio es Round Half Even"*) y Colombia por NTC 3711. Los
>   **dos únicos** países de la región donde se halló un modo fijado piden **half-even**, y
>   nuestro default es `HALF_UP`: un tenant de cualquiera de los dos **incumple sin tocar nada**.
>   Este ADR ni siquiera movió esa perilla.
> - **El NIVEL casi nadie lo fija:** de ocho países, **uno** (México, al total). El resto no lo
>   fija o valida con **tolerancia**. La tabla por país arrancaría con una fila con dato.
> - **Ningún país de LatAm obliga por línea** — el único es Reino Unido, fuera del mercado, y era
>   la mitad del argumento con el que se decidió mover el nivel.
>
> ✅ **PROPUESTA DEL OWNER (2026-09-03), que resuelve la decisión 2** — y que la investigación
> de países sostiene. Textual:
>
> > *"verificar si podemos cubrir estas diferentes formas de configuraciones, y dejarlo a nivel
> > de configuración de tenant, establecer default por país, y en los países que sea ley no
> > dejarlo cambiar. Con esto cubrimos los países que exigen una configuración por ley
> > manteniendo la libertad en los países que no, y solo recomendar."*
>
> **Verificado contra las ocho reglas relevadas: las cubre todas.** Argentina y Colombia
> (modo = half-even, por norma) → default + candado. México (nivel = al total, por norma) →
> default + candado. Perú, Ecuador, Uruguay y Chile (no la fijan) → default recomendado y
> editable. Y resuelve el problema que tenía "lo fija el país" a secas: **no inventa una ley
> donde no la hay** — que era justo el riesgo con Chile, que es inferencia.
>
> **Dos refinamientos que hacen falta para que sea expresable, y salen de los mismos datos:**
> 1. **El candado va por PERILLA, no por país.** México fija el **nivel** y deja libre el modo;
>    Argentina fija el **modo** y deja libre el nivel. Un candado a nivel país —"acá no se toca
>    nada"— no puede expresar ninguno de los dos. Cada perilla necesita su par
>    *(valor sugerido, ¿es ley?)*.
> 2. **Colombia no entra entera.** Además del modo exige **aproximar el IVA a múltiplos de
>    \$10**, que no es un modo ni un nivel: es un **escalón**. No tenemos perilla para eso.
>    ⚠️ Es la **misma forma** que `cashRounding` —pendiente, § 3— pero aplicada a otra cosa: aquél
>    es el escalón del **efectivo que se paga** y dice explícitamente que *"no toca el documento
>    tributario ni el impuesto"*; el colombiano toca **el impuesto del documento**. Tenemos el
>    concepto nombrado y solo del lado de la caja.
>
> ✅ **Las dos preguntas que faltaban, contestadas por el owner (2026-09-03):**
> - **Qué pasa con un tenant ya configurado → NO APLICA.** *"No tenemos ningún tenant operando,
>   aún estamos en desarrollo."* Es la regla que el proyecto ya sigue: no se diseñan backfills ni
>   migraciones incrementales — se cambia el esquema, se actualiza el seeder y se resetea.
> - **Quién mantiene la tabla → el panel de SUPERADMIN**, donde también se van a crear los
>   tenants. ⚠️ **Ese panel todavía no existe**: `frontend/app/pages/admin.vue` es un placeholder
>   que dice *"próximamente disponible"*. Lo que sí existe es el eje —`SuperadminGuard`,
>   `es_superadmin` en el JWT y `@Controller('admin/tenants')`—.
>
> 📌 **Consecuencia práctica, para que nadie busque una pantalla que no está:** hasta que el
> panel se construya, **las reglas por país viven en el seeder**. Eso es aceptable justamente
> porque no hay tenants operando; el día que los haya, editarlas sin panel deja de ser una
> opción.
>
> 📐 **La spec del redondeo está escrita** →
> [`2026-09-03-redondeo-por-pais-design.md`](../superpowers/specs/2026-09-03-redondeo-por-pais-design.md).
> Implementa la propuesta del owner con alcance acotado: **solo el redondeo**. La UF sigue
> reabierta y fuera de esa spec.
>
> 📌 **La línea base está en [ADR-025](./025-decimales-estado-actual.md)**, medida contra el
> código, y **ésa no la reabre nada**: describe lo que el sistema hace hoy. Es lo único de este
> tema que se puede leer sin riesgo.

## Context

El owner abrió el tema el **2026-08-15** con una frase: *"los redondeos son para montos; hay
cosas que no se deben redondear con la configuración"*, y **tiene que ser un solo criterio
para todo el sistema**, contemplando que es multi-país y multi-moneda. La investigación se
corrió, se cruzó contra el código y **el owner la pausó** para analizarla antes de decidir
([`../agent/investigaciones/2026-08-15-decimales-y-redondeo.md`](../agent/investigaciones/2026-08-15-decimales-y-redondeo.md)).

Se retomó el **2026-09-03**, y lo primero que apareció es que **la pregunta estaba peor
planteada que el sistema**. Al pedirle al owner que aclarara *"un solo criterio"*, describió
tres capas —cálculo, presentación y redondeo al final— y las tres **ya existen construidas,
con esos mismos nombres**. Lo que faltaba decidir era más chico y más concreto de lo que la
investigación suponía.

### Lo que ya estaba construido, y hay que saberlo antes de leer las decisiones

| Capa | Quién la gobierna | Qué decide |
|---|---|---|
| **Cálculo** | `tenants.escala_calculo` (default 6) | La precisión del **borrador**. Está escrito que *"no decide nada de lo persistido"* |
| **Lo que se guarda** | `moneda.decimales` (el minor unit, `CHECK 0..4`) | El valor final de **todo monto que la venta guarda** |
| **Cómo se redondea** | `tenants.modo_redondeo` | El modo (half-up, etc.) |
| **Dónde cierra** | `nivelRedondeo` (preferencia del tenant, default `linea`) | `linea` = cada línea cierra y el total es la suma; `documento` = las líneas corren finas y **solo los totales** se cuantizan al final. ⚠️ Medido en [ADR-025](./025-decimales-estado-actual.md): con `documento` la línea **se persiste sin cuantizar**, con `escala_calculo` decimales — de ahí las tres combinaciones que la API rechaza |

Y la intuición del owner de que *"hay montos que no necesitan toda esta precisión"* también
existe, **al revés de como la recordaba**: `ESCALA_COSTO = 4` es la escala de **costos y
tasas** y no sigue a la moneda, porque hay ítems costeados por gramo y cuantizar eso a peso
entero mete hasta 10% de error por gramo.

### Las tres cosas que la investigación trajo y que sí cambian el diseño

1. **No hay respuesta universal a "¿por línea o por total?"**, y es norma: el TJUE lo falló
   dos veces (C‑484/06, C‑302/07) como discreción nacional. **UK obliga por línea** y
   **México obliga solo al total**: son opuestos, y un sistema multi-país no puede elegir uno
   y llamarlo el correcto.
2. **Ningún ERP relevado tiene un redondeo global.** SAP lo pone por (empresa, moneda) y
   manda la diferencia a una cuenta dedicada; Odoo tiene *rounding factor* por moneda más una
   config separada para el impuesto.
3. **"Cuántos decimales tiene esta moneda" tiene cuatro respuestas** que no coinciden: el
   minor unit ISO 4217 (lo que se debe), CLDR (lo que se muestra — el afgani es 2 en ISO y
   **0** en CLDR), la de la pasarela (Adyen declara que su tabla *"toma precedencia"*) y la de
   la tasa publicada (la UVR se publica con 4 y su código tiene minor unit 2).

## Decision

### 1. Un solo *criterio*, con el *número* puesto por la moneda

La regla se escribe una vez y vale para todo el sistema:

> **Todo monto se lleva a los decimales de su propia moneda, con el `modo_redondeo` del
> tenant. Los cálculos intermedios corren en `escala_calculo` y no deciden nada de lo que se
> guarda.**

El criterio es único; el **valor** varía por moneda. Se descartó explícitamente *"un solo
número para todo el sistema"*: choca con las monedas —un CLP con 2 decimales cobra centavos
que no existen, un BHD con 2 pierde precisión que su ley exige— y ningún ERP lo hace así.
También se descartó *"un número por tenant"*: no resuelve al tenant multi-moneda, que
necesita dos números a la vez.

### 2. **El nivel de redondeo lo fija el PAÍS**, no el tenant

`nivelRedondeo` deja de ser una preferencia del tenant y pasa a derivarse del país, **sin que
el tenant pueda contradecirlo**. Es una regla tributaria, no un gusto: si México obliga a
redondear al total, el tenant mexicano no debería poder elegir mal.

El molde ya existe —la **moneda oficial ya se deriva del país** (ADR-021)—, así que esto es
la segunda cosa que el país decide, no un mecanismo nuevo.

Se descartó *"del tenant con el default puesto por su país"*: deja al tenant cambiarlo a algo
que su país no permite, y en materia fiscal **el error no se ve al escribirlo, se ve en un
documento ya emitido**.

### 3. La **UF es unidad de cotización**, nunca moneda oficial

Un tenant puede cotizar en UF; el total se guarda **en pesos**, a la tasa del día de la
venta. La UF no puede ser la moneda oficial de un tenant.

Se descartó lo contrario porque implicaría guardar totales en una unidad que cambia de valor
todos los días y con la que nadie paga: toda la plata que entra a caja necesitaría conversión
y habría que resolver a qué fecha se congela cada una.

⛔ **CORRECCIÓN MEDIDA (2026-09-03), y la escribí mal acá:** este ADR declaraba como costo
aceptado que *"un tenant que piensa en UF ve sus reportes históricos en pesos, así que comparar
dos meses le mezcla la inflación"*. **Es falso.** Cada línea de venta ya persiste
`moneda_id_origen`, `precio_unitario_origen` y `tasa_cambio` (escala 6) — el monto en UF **está
guardado**, y su docblock dice que el campo existe justamente para poder auditar la conversión.
El costo real es otro y mucho más chico: **no existe la pantalla** que lo muestre. Lo escribí
sin medir. Análisis completo, con los cinco huecos del escenario y cuáles dependen de esta
decisión (spoiler: cuatro de cinco **no**):
[`../agent/investigaciones/2026-09-03-uf-y-nivel-por-pais-analisis.md`](../agent/investigaciones/2026-09-03-uf-y-nivel-por-pais-analisis.md).

### 4. Los decimales del documento se **congelan**; el reparto por mayores restos **no** se generaliza

Propinas ya resuelve bien el reparto de centavos: unidades mínimas enteras, **mayores restos**
(= método Hamilton) y `decimales_moneda` congelado dentro del documento. De ese patrón:

- **Se generaliza congelar los decimales en el documento** — a ventas y pagos. Una venta
  guardada hoy no puede cambiar de significado porque mañana alguien reconfigure la moneda, y
  tiene que quedar escrito con cuántos decimales se emitió.
  ⚠️ **Corrección del 2026-09-03, medida:** en **ventas ya está construido** —`decimalesMoneda`
  viaja dentro de `ConfigCalculo` y se persiste en `ventas.config_calculo`, con el porqué en su
  propio docblock— y las notas de crédito lo heredan. Lo que falta es **pagos**. Detalle y
  medición en [ADR-025](./025-decimales-estado-actual.md) § 4.
- **NO se generaliza el reparto por mayores restos.** Solo tiene sentido donde hay un sobrante
  que repartir entre varios; en una venta no hay nada que repartir, y llevar maquinaria de
  reparto a donde no reparte nada es código que nadie ejercita y que se rompe en silencio.

📌 El owner no tenía preferencia acá y la decisión la tomó el agente, con ese razonamiento.

### 5. **Una sola columna de decimales por moneda** — YAGNI explícito

La investigación encontró cuatro precisiones distintas y sugería dos o tres columnas. **Se
queda en una.** Decisión del owner: *"estamos muy lejos de tener casos como el afgani"*.

En las monedas con las que el sistema opera —CLP, USD— guardar y mostrar coinciden, así que
la segunda columna sería una casilla más que llenar, siempre con el mismo valor, hasta el día
que no lo sea.

⚠️ **El costo, para que no sorprenda:** el día que entre una moneda donde guardar y mostrar
difieren, o se muestra mal o se guarda mal, y el arreglo va a ser una columna nueva **con
datos ya guardados encima** en vez de con la tabla vacía. Se acepta a sabiendas.

📌 Las otras dos precisiones **no son de la moneda y no necesitan columna**: la de la pasarela
vive en la pasarela y la de la tasa vive en la tasa.

## Lo que queda abierto — una medición, no una decisión

`nivelRedondeo = documento` (redondear solo al total) **hoy se rechaza con 400 cuando la
moneda oficial tiene 0 decimales**, con el argumento de que las líneas quedarían con decimales
que la moneda no tiene.

Esa prohibición hay que **volver a medirla antes de tocarla**, por dos razones:

1. **Lo medido apunta al revés.** Con descuento de nivel venta, `documento` se queda **plano**
   (~1 unidad de error, medido el 2026-08-28) mientras `linea` **crece con el carrito**: 2,57
   unidades con ocho líneas. Es decir que la opción prohibida es la más precisa de dos líneas
   en adelante.
2. **La premisa de la prohibición es falsa, y lo señaló el owner.** *"Moneda oficial sin
   decimales ⇒ nada tiene decimales"* no se sostiene: un tenant chileno puede **cotizar en
   UF**, que sí tiene decimales, y derivar líneas y totales con decimales; y un tenant de otro
   país puede vender en **dólares** y llegar a decimales por la **conversión**.

**Qué tiene que cubrir la medición**, entonces, y no solo el caso CLP puro:

- moneda oficial de 0 decimales, líneas en la misma moneda;
- moneda oficial de 0 decimales con **líneas cotizadas en UF**;
- moneda oficial de 0 decimales con **conversión desde otra moneda** (USD).

Si `documento` también gana ahí, la prohibición sobra y se saca. Si pierde, se queda **con el
número que la justifica escrito al lado**. Lo que no se hace es sacarla sin medir: es
exactamente lo que hubo que revertir la vez pasada en este mismo motor.

## Consequences

### Positive

- **La frase del owner queda traducida a algo verificable.** *"Un solo criterio"* dejó de ser
  ambiguo: es un criterio con valor variable por moneda, y está escrito arriba en una línea.
- **Tres de las cinco preguntas de la investigación se contestaron sin construir nada**,
  porque el sistema ya las tenía resueltas y la pregunta estaba peor planteada que el código.
- **El nivel de redondeo pasa a ser un dato del país**, que es donde vive la norma, y reusa un
  mecanismo que el sistema ya tiene (la moneda oficial también se deriva del país).
- **El documento deja de depender de la configuración viva**: congelar los decimales adentro
  cierra la clase de bug donde reconfigurar una moneda cambia el significado de una venta
  vieja.

### Negative

- **`nivelRedondeo` se muda de las preferencias del tenant a la tabla de países**, y el país
  necesita un dato que hoy no tiene. Como no hay datos productivos, se cambia el esquema y se
  resiembra — pero es un cambio de esquema igual.
- **Un tenant deja de poder elegir cómo redondea.** Si aparece un caso legítimo que la norma
  del país no contempla, no hay escape sin volver a tocar el diseño.
- **La única columna de decimales queda como deuda conocida**, con la fecha de vencimiento
  puesta en "la primera moneda donde guardar y mostrar difieran".

### Neutral

- **La UF sigue existiendo como unidad de cotización** y su entrada propia sigue viva en el
  backlog; lo que este ADR cierra es que **no puede ser moneda oficial**, no cómo se cotiza.
- **Nada de esto toca el documento tributario.** Qué muestra una boleta o un DTE —incluido si
  lleva dos montos cuando se cotiza en UF— es materia fiscal y se decide en su propio frente
  (ADR-010).
- El redondeo de efectivo (`cashRounding`: el franco suizo tiene minor unit 2 pero su moneda
  física más chica es de 5 rappen) **no es este tema** y tiene su propia entrada en el
  backlog.
