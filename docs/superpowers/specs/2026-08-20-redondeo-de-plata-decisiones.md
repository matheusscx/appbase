# Redondeo de plata — decisiones del owner

**Fecha:** 2026-08-20
**Estado:** ✅ Ronda de decisiones cerrada — **insumo directo de la spec.** No toca código.
**Sobre qué se decidió:**
[relevamiento](2026-08-20-redondeo-de-plata-estado.md) ·
[investigación por línea o total](../../agent/investigaciones/2026-08-20-redondeo-por-linea-o-por-total.md) ·
[lectura independiente](2026-08-20-redondeo-de-plata-lectura-independiente.md)

> Once decisiones, tomadas de a una con contexto breve. Cada una dice **qué se decidió**,
> **por qué** y **qué obliga** — la tercera columna es la que la spec tiene que honrar, y es
> lo que se pierde si solo se anota el "sí".

---

## Resumen

| # | Pregunta | Decisión |
|---|---|---|
| a | ¿Los costos siguen el criterio de los precios? | **No: precisión propia** (escala 4) |
| b | ¿`modo_redondeo` alcanza a todo redondeo de plata? | **No: solo montos cobrados** |
| c | ¿El nivel de redondeo se configura o se fija? | **Perilla configurable, ahora** |
| d | Plata cobrable que entra por API con decimales de más | **Rechazar con 400** |
| e | Desbruteo entero: ¿qué identidad cede? | **Cede el IVA: cierra a góndola** |
| f | IVA vs descuento de nivel venta | **Frente propio, fuera de esta spec** |
| g | Alcance de la nota de crédito | **Mínimo: línea + modo heredado** |
| h | Redondeo de efectivo / denominación mínima | **Diferido, con el dato preparado** |
| i | Escala que exige cada pasarela | **En el adaptador de cada provider** |
| j | `escala_calculo` | **Queda, documentada como intermedia** |
| k | Costo ingresado con más de 4 decimales | **Rechazar también, con 400** |

---

## a) Los costos mantienen precisión propia

**Decidido:** los costos no siguen el criterio de la moneda. CPP, costo de receta y de combo,
conversión de costo por unidad, precio sugerido y los costos de merma quedan en **escala 4**.

**Por qué:** la cadena de costos es cerrada —CPP → `costo_actual` → costo de receta/combo →
merma/kardex— y no toca ningún documento de venta; hay ítems costeados por gramo (mínimo
medido en dev: `5.0000/g`), donde cuantizar a peso entero mete hasta 10% de error por gramo,
multiplicado ×1000 al costear un kilo. El corte tasa/monto ya existe en el campo más
importante del sistema (`precio_unitario` a 4 decimales, con test que lo fija).

**Qué obliga:**
- Los sitios 1, 2, 3, 4, 5, 6, 7 y 10 de la tabla de los once **quedan como están**, y cada
  uno se documenta con el comentario que explica por qué (los textos propuestos están en la
  §1 de la lectura independiente).
- Se documentan también los **gemelos de escritura omitidos** del relevamiento
  (`items.service.ts:3508` y `:3580`), que son la misma cuenta en el camino que persiste al
  crear o editar una receta/combo. Hoy divergen en forma: uno pasa el modo explícito y el
  otro usa el default.
- La **escala de costo (4)** pasa a ser un concepto nombrado, no un `toFixed(4)` repetido a
  mano en 106 lugares.

## b) `modo_redondeo` es política de cobro, no de medición

**Decidido:** `modo_redondeo` aplica **solo a montos cobrados** (motor, conversión a moneda
oficial, documentos de venta). Los costos y las mediciones internas quedan en HALF_UP fijo.

**Por qué:** un tenant que elige `FLOOR` está eligiendo cómo redondea lo que le cobra al
cliente. Aplicárselo al CPP sesgaría la valorización del inventario hacia abajo en cada
compra, con el error compuesto promedio tras promedio — un efecto que nadie pidió y que el
tenant no puede prever.

**Qué obliga:** el comentario de cada sitio de costo tiene que decir **que no mira
`modo_redondeo` a propósito**, no quedar mudo. El silencio es lo que obligó a reconstruir
todo midiendo; un `toFixed(4)` sin nota vuelve a ser sospechoso en seis meses.

## c) El nivel de redondeo nace como perilla configurable

**Decidido:** se construye ahora el eje **nivel de redondeo** (línea vs documento) como
configuración del tenant, con **por línea** de default.

⚠️ **Esta decisión voltea la recomendación de la lectura independiente** (§5), que proponía
fijarlo por diseño y diferir la perilla. Queda registrada la contra que la lectura levantó,
porque es lo que la spec tiene que resolver, no ignorar:

**Qué obliga —y esto es la parte cara de la decisión:**
1. **La promesa "por línea ⇒ Σ líneas = total" es falsa en este motor tal como está.**
   `totalFinal = Σ totalLinea − dv + rv` (`calculo-precios.engine.ts:685`): con un descuento
   de nivel venta, el cliente que suma el ticket no llega al total ni en modo por-línea. La
   spec **tiene que definir qué son `dv`/`rv` en el documento** —campo de documento
   cuantizado tipo `DscRcgGlobal`, o repartidos a las líneas—; sin eso, la perilla promete
   algo que no entrega.
2. **`nivelRedondeo` se congela en `config_calculo`**, junto a `modoRedondeo`,
   `escalaCalculo` y `formula` (verificado: el JSON congelado por venta ya guarda esos
   tres). Un documento emitido no se reinterpreta con la config de hoy.
3. **NC y reembolsos heredan el nivel congelado** de la venta original, nunca el vigente.
4. **Matriz de interacción explícita** entre `nivelRedondeo` × `modo_redondeo` ×
   `escala_calculo`: qué combinación significa qué, y cuál no puede darse.
5. **El campo tiene que poder quedar fijado desde afuera** el día que exista la tabla
   país→nivel (UK obliga por línea, México al total): nace como preferencia, pero no como
   preferencia libre para siempre.

## d) La plata cobrable con decimales de más se rechaza

**Decidido:** un monto cobrable que llega por API con más decimales de los que la moneda
puede representar se rechaza con **400**. No se cuantiza en silencio.

**Por qué:** hoy ese recorte lo decide Postgres (media hacia afuera del cero, fuera de la
config y sin test) o un clamp HALF_UP escrito a mano — en los dos casos el número guardado
no es el que el cajero tecleó, y nadie se entera. El borde de Webpay ya eligió este criterio
y lo tiene testeado (`webpay-plus.provider.spec.ts:45`).

**Qué obliga:**
- Alcanza a `pagos.monto`, el monto de la NC, los movimientos manuales de caja, el contado
  del cierre y los montos de propina —los sitios donde hoy el DTO valida signo y formato
  pero **no escala** (`decimal-signo.decorator.ts`, leído completo).
- **Rompe 8 tests de aceptación** que hoy afirman que un monto decimal es válido
  (`decimal-signo.decorator.spec.ts:21/:51`, `ajustes-reparto.dto.spec.ts:30`,
  `linea-cierre.dto.spec.ts:20`, `dinero-signo.dto.spec.ts:58`, `monto-regla.util.spec.ts:51`,
  `caja.e2e-spec.ts:810/:815`). Se actualizan como parte del cambio, no se descubren después.
- El **frontend cuantiza antes de mandar**: si el backend rechaza, la pantalla no puede
  ofrecer un monto que el backend va a rechazar.
- Queda pendiente de barrido: ~30 DTOs más con `@IsNumberString` sin trazar hasta su punto
  de persistencia (declarado como hueco por la pasada de barrido).

## e) En el desbruteo cede el IVA: el total cierra a góndola

**Decidido:** con precio que incluye impuesto, el total cobrado es la etiqueta y el **IVA se
deriva por resta** (`IVA = total − neto`). Góndola $993 → neto 834, IVA **159**, total 993.

**Por qué:** es la misma lógica de "la etiqueta manda" ya decidida el 2026-08-04 para el
impuesto pausado — lo cobrado tiene que coincidir con el precio impreso en góndola, y lo que
se ajusta es el reparto interno. La alternativa (mantener `IVA = tasa × base`) deja al
cliente pagando un peso menos que la etiqueta, multiplicado por cantidad.

**Qué obliga:**
- El IVA persistido puede diferir hasta 1 peso de `tasa × base` por línea. Eso es
  **consecuencia elegida**, y tiene que estar dicho en el código y en
  `docs/features/impuestos.md`, no descubrirse leyendo una boleta.
- Aplica solo al camino `precio_incluye_impuesto`. En el camino normal (precio neto + IVA
  calculado) la fórmula sigue mandando.
- Necesita test con el caso numérico exacto (993 → 834 + 159), no solo un mutante.

## f) IVA vs descuento de nivel venta: frente propio, fuera de esta spec

**Decidido:** el defecto se documenta con su evidencia y entrada de backlog propia; **esta
spec no lo toca**.

**El defecto, para que la entrada no lo subcuente:** el paso `impuestos` no corre a nivel
venta (`calculo-precios.engine.ts:633-634`), así que un descuento de venta baja lo cobrado
pero **no la base del IVA**. La boleta declara más IVA del que corresponde a lo cobrado, y
`IVA ≠ tasa × MntNeto` — que es justo la relación que un DTE con `DscRcgGlobal` afecto exige.

**Por qué se difiere:** no es un problema de redondeo y ninguna cuantización lo arregla;
meterlo acá sería dos cambios del motor en una pasada, contra la regla de aislamiento de la
tanda 🔴.

## g) Nota de crédito: mínimo, línea y modo heredado

**Decidido:** la línea de NC (`ventas.service.ts:1010` — el único de los once con veredicto
MAL) se cuantiza a la escala de la moneda con el `modo_redondeo` **congelado en la venta
original**. El desglose de IVA y el cuadre cabecera↔líneas quedan como entrada de backlog
propia.

**Qué obliga:** la entrada diferida tiene que nombrar lo medido, no una impresión: hoy la
cabecera es un monto libre del cliente, `totalImpuestos = '0'` fijo
(`ventas.service.ts:1001`), las líneas son informativas sin relación exigida con ese monto, y
el camino se dispara también por el webhook de reembolso
(`reembolso-callback.handler.ts:36`), no solo por un humano.

## h) Redondeo de efectivo: diferido, con el dato preparado

**Decidido:** no se implementa en esta pasada, pero **la decisión sobre el dato se nombra
ahora** para que `moneda.decimales` no nazca siendo "el número que sirve para todo".

**Por qué:** son dos datos distintos —`moneda.decimales = 0` dice que el peso existe; la
moneda física más chica en Chile es $10— y CLDR los modela separados (`digits` +
`cashRounding`). Además la Ley 20.956 es explícita: ese redondeo **no toca el documento
tributario ni el impuesto**, es una diferencia de caja aparte, así que su lugar en el modelo
no es el mismo.

## i) La escala de la pasarela vive en el adaptador del provider

**Decidido:** el dominio guarda el monto exacto en `moneda.decimales`; **cada provider
convierte al formato de cable en su borde**, como ya hace `montoEntero()`. No se agrega
ninguna columna de "escala cobrable".

**Por qué —y esto corrige el dato de campo del owner:** la escala no es del país. Verificado
contra documentación oficial: Transbank pide CLP entero (*"Formato número entero para
transacciones en peso y decimal para transacciones en dólares"*), pero en Colombia **Wompi
cobra en centavos** (`amount_in_cents`, *"if you wish to charge $95.000 COP, you will enter:
9500000"*) mientras **PayU** (*"este valor no puede tener decimales"*), **MercadoPago** y
**ePayco** cobran pesos directos. Misma moneda, dos formatos: la escala es de la pasarela, y
por eso pertenece al adaptador, no al modelo.

**Qué obliga:** el criterio de `montoEntero()` deja de ser una particularidad de Webpay y
pasa a ser el contrato de todo provider: **validar en el borde, nunca redondear ahí**. Un
provider que redondee estaría cambiando lo que el documento dice que se cobró.

## j) `escala_calculo` queda, documentada como intermedia

**Decidido:** sigue configurable y sigue siendo la precisión del borrador con que el motor
arrastra pasos encadenados. Lo que cambia es el **contrato**: se documenta explícitamente que
**no decide nada de lo persistido** — eso lo decide la escala de la moneda.

**Qué obliga:** es la perilla que más invita a "completar" arreglos ajenos (ya pasó con la
conversión a moneda oficial, que tiene un test justamente para frenar eso). La documentación
tiene que decir qué **no** hace, no solo qué hace.

## k) Un costo ingresado con más de 4 decimales también se rechaza

**Decidido:** mismo criterio que (d), pero contra la **escala de costo (4)**: si el usuario
tipeó más precisión de la que el sistema guarda, se le dice con un 400 en vez de recortarle
el número en silencio.

**Por qué:** una sola regla mental para toda la plata — el sistema nunca cambia calladamente
un número que una persona escribió.

**Qué obliga:** alcanza al ajuste de costo (`inventario.service.ts:353`, y su reclamp en
`:227`), al costo de compra (`:403`) y al costo por unidad de mermas y compras que pasa por
`convertirCostoUnitario`. Los clamps de input de propinas manuales
(`liquidacion-propinas.service.ts:980, :1033, :1070, :1507`) caen bajo (d), no bajo ésta:
son montos cobrados/pagados, no costos.

---

## Lo que queda diferido, con entrada propia en el backlog

Cada uno con su evidencia, para que la entrada no subcuente el hueco como pasó con
*"cuatro redondeos"*:

1. **IVA vs descuento/recargo de nivel venta** (decisión f) — `calculo-precios.engine.ts:633`.
2. **La NC como documento**: desglose de IVA y cuadre cabecera↔líneas (decisión g) —
   `ventas.service.ts:998-1004`.
3. **Denominación mínima de efectivo** (`cashRounding`) y contabilización de la diferencia
   (decisión h) — Ley 20.956 + Decreto 1.266.
4. **Los ~30 DTOs con `@IsNumberString` sin trazar** hasta su punto de persistencia: la misma
   auditoría que destapó `pagos.service.ts:234` y `caja.service.ts:946` podría encontrar más
   sitios donde el redondeo real lo hace Postgres.

## Lo que sigue abierto y todavía no se preguntó

- **Dónde vive la cuantización a la escala de la moneda**: ¿una pasada al cerrar la venta en
  el motor, o cada campo en su punto de escritura? Es diseño de la spec, no decisión de
  producto — se propone ahí y se confirma al revisarla.
- **El espejo del frontend** (`useMonedaConversion.ts:23`, en `toFixed(4)` sin
  `modo_redondeo`) entra al alcance por arrastre: es la misma divergencia
  mostrado-vs-guardado que el arreglo del 2026-08-11 cerró del otro lado.
