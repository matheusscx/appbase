# Inventario: los DTOs con `@IsNumberString` y el borde de escala

**Fecha:** 2026-08-24 · **Tipo:** medición, no arreglo · **Entrada que la pidió:**
[`pendientes.md`](../pendientes.md) § 3, *"Los DTOs con `@IsNumberString` sin trazar hasta su
punto de persistencia"*

## Por qué se midió antes de arreglar

La entrada decía *"66 usos, 29 evidentemente plata"* y proponía un barrido. Un barrido de 30
campos son **30 decisiones de juicio con error silencioso**: marcar como monto un campo que era
tasa hace que el backend rechace valores válidos, y dejar sin marcar uno que era plata deja el
agujero igual. Ninguna de las dos cosas rompe un test.

Por eso primero se midió. **El resultado cambia la entrada: el barrido no existe.**

## Resultado

**72 campos de DTO** con `@IsNumberString`, en 17 módulos.

| Veredicto | Campos |
|---|---|
| **OK** — es plata, está marcada, y el controller cuelga el pipe | **30** |
| **NO APLICA** — cantidad, tasa, o no se persiste | **39** |
| **DUDOSO** — ambigüedad real, ver abajo | **2** |
| **FALTA MARCA** — plata persistida sin marcar | **0** |
| **MARCA SIN PIPE** — marcada pero el controller no lo cuelga | **0** |

⚠️ **Cero campos de plata sin marca. Cero marcas sin pipe.** La premisa de la entrada —"29
evidentemente plata" esperando ser marcadas— **no se sostiene**. El borde de escala está
razonablemente cerrado; lo que falta es otra cosa.

📌 **Del grep al campo hay una diferencia que la entrada no hacía:** el grep da 79 hits, pero
**7 no son campos** — son menciones de `@IsNumberString` en comentarios de services y specs, y
en el propio decorador y el pipe. Contar hits y llamarlos campos es lo que inflaba la entrada.

## El hallazgo: `minimo` es la ambigüedad que `valor` ya resolvió, en el campo de al lado

> ✅ **CERRADO el 2026-08-24**, el mismo día, por la vía que esta sección anticipaba: se partió
> en `minimo_cantidad` / `minimo_monto`. Detalle en [`resueltos.md`](../resueltos.md).
> 📌 Una cosa que esta medición subestimó: decía que la consecuencia era "un umbral raro, no
> una plata mal calculada", y es cierto para el CÁLCULO — pero al construirlo apareció que el
> mismo hueco tapaba un bug de frontend (`recargos.vue` nunca mostraba el `MoneyInput` del
> umbral, por comparar contra un código que no existe).

`TramoDto.minimo` (`descuentos/dto/create-descuento.dto.ts:18` y su gemelo en `recargos`)
lleva **solo `@IsNumberString()`**: ni marca de escala, ni validación de signo, nada.

Y significa dos cosas distintas según un hermano que el decorador no puede leer
(`calculo-precios.engine.ts:459`):

```ts
const magnitud = codigo === 'por_mayor' ? ctx.cantidad : ctx.monto;
```

Para `por_mayor` el `minimo` son **unidades**; para `por_monto_venta`, **plata**. El comentario
de la propia entidad lo dice sin rodeos: *"cantidad o monto mínimo para este tramo"*.

**Es exactamente la forma del problema que el corte de `valor` vino a resolver el 2026-08-23** —
un campo que es monto o porcentaje según el hermano `modo`, y por eso no se podía marcar—.
Aquel se partió en dos columnas. **`minimo` quedó sin tocar.**

⚠️ **Pero su consecuencia es mucho más chica, y decirlo importa para no inflar el arreglo.** Un
`valor` mal leído multiplicaba el cobro por cien. Un `minimo` con decimales que la moneda no
admite es **un umbral raro, no una plata mal calculada**: la comparación `magnitud >= minimo`
sigue funcionando. Lo que se pierde es que el dato sea expresable, no que el cobro sea correcto.

📌 **Y en `recargos` la ambigüedad es teórica hoy:** `TIPOS_CON_TRAMOS` tiene un solo código
(`recargo_por_monto_venta`), así que ahí `minimo` **siempre** es monto y sería marcable sin
ambigüedad. La certeza descansa en una lista hardcodeada, no en un invariante de tipos: el día
que entre un segundo tipo por tramos, se vuelve ambiguo como en descuentos.

## El otro hallazgo: la pasarela valida la escala por su cuenta

> ⛔ **CORREGIDO EL MISMO DÍA, al construirlo.** Esta sección tiene el diagnóstico invertido y
> se deja como estaba —el documento registra lo que se midió— con la corrección al lado.
> **`montoEntero` no era una segunda noción de escala compitiendo: era la noción CORRECTA**, en
> el lugar equivocado. Una orden de pasarela va en la moneda de la pasarela, no en la oficial
> del tenant, así que colgar `EscalaMonedaPipe` habría hecho que un tenant con oficial USD
> aceptara dos decimales en una orden CLP. Y la pregunta que esta sección declaraba abierta
> —de dónde saca el tenant un controller sin JWT— **ya estaba contestada**: `ApiKeyGuard` lo
> deja en `req.pasarelaAuth`. El cierre completo, y el defecto que apareció al medirlo (una
> orden huérfana por un error de formato), en [`resueltos.md`](../resueltos.md).
>
> 📌 **La lección es sobre el método de este inventario**, no sobre la pasarela: recorrer DTOs
> buscando marcas hace que "falta la marca" sea la única forma que el problema puede tener. Un
> campo de plata **sin** marca puede ser correcto — la marca afirma *"la moneda es la del
> tenant"*, y eso es dominio, no un checkbox.

Los cuatro montos de `pasarela` no son "no aplica porque vienen de un tercero". Es estructural:

- `PasarelaApiController` usa `ApiKeyGuard`, **no** `JwtAuthGuard`, así que `req.user` nunca
  existe y `SembrarContextoInterceptor` no siembra el `RequestContext`. **Colgar
  `EscalaMonedaPipe` ahí tiraría 403 en cada request**, porque el pipe resuelve el tenant de ese
  contexto.
- La moneda de esas órdenes está **hardcodeada a `'CLP'`**, nunca la oficial del tenant.
- La validación de escala que sí existe vive dentro de `webpay-plus.provider.ts` (`montoEntero`),
  o sea **un segundo sistema de validación de escala en paralelo** al que este inventario mapea.

Son dos nociones compitiendo, que es el patrón que ya mordió a este repo con la zona horaria
(ver [`resueltos.md`](../resueltos.md) § *"Una sola noción de zona horaria"*). Hoy no diverge
porque todo es CLP; diverge el día que un tenant opere en otra moneda oficial.

## Un falso positivo que vale registrar, porque el argumento suena bien

Se reportó que `propinaSugerida` (`salones/dto/cerrar-cuenta.dto.ts:40`) tenía el decorador
equivocado, porque se persiste en una columna de escala fija 4 en vez de la escala de la moneda.
**Es falso, y por dos razones independientes:**

1. `monto_sugerido` es `numeric(18,4)` — **la misma columna que `monto_pagado`**, que es el que
   sí se cobra y cuya marca nadie discute. La escala de la columna no distingue nada.
2. La sugerencia ya se calcula redondeada a la escala de la moneda antes de mandarse
   (`frontend/app/composables/usePropina.ts:7`, *"half-up a la escala de la MONEDA"*).

## Lo que el inventario corrigió de otra entrada del backlog

La entrada *"`grupos-modificadores` sigue sin `MoneyInput`"* se leyó como *"el único módulo donde
se tipea plata sin escala validada"*. Medido: `precioExtra` está marcado con `@EsCosto()` en los
dos DTOs y los controllers cuelgan el pipe. **La entrada es sobre un input de FRONTEND que falta,
y ella misma aclara que no bloquea nada** porque el backend valida igual. Citada fuera de
contexto llevaba a un diagnóstico equivocado — y llevó, en una recomendación de esta misma
sesión.

## El criterio, corregido por la medición

Se arrancó con *"¿es monto cobrado o es tasa?"*. **Es más ancho:** `montoSugerido` de propina
**no se cobra** —lo cobrado es `montoPagado`— y sin embargo su `@EsMontoCobrado()` está bien
puesto, porque el service los compara con `Decimal.equals()` para decidir si la propina fue
sugerida o manual. Con escalas distintas, esa comparación falla en silencio.

👉 **El criterio real: "¿necesita ser comparable con algo que se cobra?"**, no "¿se cobra?".

## Riesgo sistémico anotado, fuera del alcance de esta medición

Ningún campo `porcentaje` del repo lleva marca de escala — es un patrón consistente y
deliberado (un ratio no es plata). Pero eso significa que **Postgres redondea en silencio** los
`NUMERIC(7,4)` de los porcentajes sin ningún guardia en el borde. No es específico de ningún
módulo y no se midió acá; queda dicho para que exista.

## Método

Cinco lotes en paralelo, uno piloto (`items`) para fijar la forma de la tabla antes de repartir
los otros cuatro. Cada lote contestó, por campo: qué es, si está marcado, si se persiste, si el
controller cuelga el pipe, y el veredicto. **Las afirmaciones que decidían un veredicto se
verificaron una por una contra el código** por quien coordinó — así se cayó el falso positivo de
`propinaSugerida` y se confirmaron los dos hallazgos.
