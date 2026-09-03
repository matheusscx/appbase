# ADR-024: Decimales y redondeo — un criterio, tres capas, y el nivel lo fija el país

**Status**: Accepted (con una medición pendiente, ver *Lo que queda abierto*)

**Date**: 2026-09-03

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
| **Dónde cierra** | `nivelRedondeo` (preferencia del tenant, default `linea`) | `linea` = cada línea cierra y el total es la suma; `documento` = las líneas corren finas y **solo los totales** se cuantizan al final |

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

⚠️ **Costo aceptado y explícito:** un tenant que piensa en UF ve sus reportes históricos en
pesos, así que comparar dos meses le mezcla la inflación. Es el precio de que la moneda
oficial sea con lo que se paga.

### 4. Los decimales del documento se **congelan**; el reparto por mayores restos **no** se generaliza

Propinas ya resuelve bien el reparto de centavos: unidades mínimas enteras, **mayores restos**
(= método Hamilton) y `decimales_moneda` congelado dentro del documento. De ese patrón:

- **Se generaliza congelar los decimales en el documento** — a ventas y pagos. Una venta
  guardada hoy no puede cambiar de significado porque mañana alguien reconfigure la moneda, y
  tiene que quedar escrito con cuántos decimales se emitió.
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
