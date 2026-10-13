# Feature: Motor de promociones

**Status**: Implementado y verificado contra el stack. El desarrollo corrió en un worktree
aislado mientras otra sesión ocupaba Docker, y se integró y verificó al liberarse: gate
completo, `reset-db.sh --verificar` y smoke de navegador de punta a punta (el detalle, con los
números de esa corrida, está en la fila de [`ESTADO.md`](../ESTADO.md)).
**Owner**: Cesar Matheus
**Last Updated**: 2026-10-13

---

## Overview

### Qué es

Un módulo `promociones` con tres piezas: **CRUD de campañas** (2x1/NxM, happy hour %, combo
a precio fijo), un **evaluador puro** que decide qué unidades del carrito gana cada promo, y
la **aplicación dentro del motor de precios** como familia propia de descuento — trazable,
congelable y medible como promoción, nunca fundida con los descuentos de catálogo
(`descuentos`/`recargos`).

El diseño completo, con el porqué de cada decisión y la investigación de mercado que lo
respalda, vive en
[`docs/superpowers/specs/2026-08-27-motor-promociones-design.md`](../superpowers/specs/2026-08-27-motor-promociones-design.md).
Este documento no lo repite: describe lo que el código construido **hace hoy**, incluido lo
que cambió respecto del diseño durante la implementación.

### Por qué existe

El análisis de julio (`docs/superpowers/specs/2026-07-22-motor-promociones-analisis.md`)
cerró el alcance de Fase 1: familia (A) — descuentos sobre líneas ya pedidas — activada
solo automáticamente, sin acumulación entre promos por default. El módulo de descuentos ya
podía expresar una regla acotada por fecha (`directo` con `fechaInicio`/`fechaFin`), pero no
tenía forma de expresar 2x1, NxM ni un combo a precio fijo — y mezclar esos casos en
`descuentos` habría fundido en una sola traza y un solo congelado dos cosas que el negocio
mide distinto: "cuánto descontamos" vs. "cuánto regalamos en promos".

### Scope

- Incluido en esta versión: los tres tipos (`porcentaje`, `nxm`, `precio_fijo`), scope por
  ítems/categoría/venta, vigencia por fecha+hora+día+canal, el interruptor de tenant
  promo-vs-descuento de catálogo, congelado en `ventas_promociones`, pantalla de
  configuración, desglose en el drawer de venta y en el ticket.
- NO incluido (diferido a Fase 2, ver la spec §"Qué NO entra en Fase 1"): regalar un ítem no
  pedido, combos automáticos que agregan líneas, cupones, activación manual, grupos de
  exclusión configurables, prioridad manual, tope de aplicaciones por ticket, sucursales,
  fidelización, representación fiscal específica por país.

---

## Las 4 decisiones del owner (2026-08-27)

1. **Promo vs. descuento común: un solo interruptor por TENANT**, no por promo. Vive en
   Preferencias financieras.
2. **Default: NO acumula.** Si nadie tocó el interruptor, el día de la promo aplica solo la
   rebaja mayor entre la promo y el descuento de catálogo que tocarían la misma línea.
   Protege la plata del local por defecto.
3. **Criterio pro-cliente al armar aplicaciones**: cuando hay más candidatas que cupo, gana
   el cliente — al combo entran las unidades más caras, el 2x1 regala la más barata del par
   más caro.
4. **El instante que decide la promo es cuándo se PIDE el ítem**, no la apertura de la
   cuenta ni el pago — ver "El instante por línea" abajo. Reabierta y re-decidida el mismo
   día tras el cruce con la investigación de mercado (Toast documenta exactamente este
   instante).

Investigación de mercado completa (Toast/Square/Lightspeed/Clover + norma chilena SII/SERNAC)
y el cruce contra cada decisión: spec §"Investigación de mercado".

---

## El interruptor: `promosAcumulanDescuentos`

Columna `promos_acumulan_descuentos` en `tenants` (default `false`), editable por
`PUT /tenants/preferencias-financieras` junto a fórmula y redondeo — es conducta de precio,
no configuración de catálogo. Obligatorio en ese `PUT` desde el 2026-10-04: omitirlo es un
400, no un `false`. Viaja al motor por `ConfigCalculo.promosAcumulanDescuentos`
(campo **requerido**, no opcional: un default silencioso cambiaría plata sin que nadie lo
decidiera) y se **congela** en `ventas.config_calculo` como el resto de la config de cálculo.

**La comparación es POR BLOQUE: las aplicaciones que comparten una línea compiten juntas**
(owner, 2026-10-13, *"Juntas solo si comparten producto"*; [ADR-031](../adr/031-arbitraje-promo-catalogo-por-bloques.md)).
Una aplicación es una tanda de un NxM, un combo o la aplicación única de un `porcentaje`. Las
que comparten alguna línea, de la misma promo o de otra, forman un bloque, y la relación es
transitiva: si A comparte una línea con B y B otra con C, van las tres juntas. Cada bloque suma lo
que regala, en neto y cuantizado, y lo compara contra los descuentos de catálogo de sus líneas.
Si gana, aplican todas sus aplicaciones y el catálogo se anula en esas líneas. Si no gana,
sale entero. Los bloques que no comparten líneas compiten por separado.

- **Por qué juntas:** el catálogo se anula por línea, así que toda la plata de promo que cae en
  una línea se decide junta. Comparando cada tanda sola, la segunda tanda de un 3x1 competía
  contra el 30 % que la primera ya le había sacado a las cervezas, y perdía.
- **Por qué solo si comparten línea:** una tanda que pierde en su línea no la arrastra otra que
  gana en una línea ajena. El combo sigue yendo entero: es una sola aplicación, y dejarlo en la
  línea donde gana y sacarlo de la otra cobraría medio combo.
- **"Lo que toca" son las líneas donde la promo pone plata.** La unidad que paga en un grupo no
  cuenta: en un 2x1 de vino + cerveza que regala la cerveza, el vino conserva su catálogo.
- **Empate: gana el catálogo** (no cambia la plata que el cliente paga, y es la opción que menos
  sorprende). El bloque perdedor se descarta **entero y sin traza**: no es "aplicó 0", es que en
  este tenant las dos familias no conviven, y eso lo explica la pantalla de configuración, no una
  línea del ticket. El catálogo perdedor, en cambio, sí deja traza con monto `'0'` (el patrón ya
  existente de "la regla que no aportó").
- **El catálogo contra el que se compara es el de la pasada normal**, calculado una sola vez:
  dos bloques no comparten líneas, así que ninguno le apaga el catálogo al otro y el resultado
  no depende del orden.

Con "no se suman" (todo exento, CLP):

| Carrito | Hasta el 2026-10-13 | Hoy | Solo catálogo |
|---|---|---|---|
| 5 cervezas de $1.000 al 30 % y un agua de $100, 3x1 | $3.100 | **$2.000** | $3.600 |
| El mismo, 2x1 | $3.500 | **$3.000** | $3.600 |
| 5 cervezas al 30 % con un 3x1 y un 2x1 a la vez (3 unidades para el 3x1, 2 para el 2x1) | $3.000 | **$2.000** | $3.500 |
| 2x1 sobre 2 vinos de $5.000 al 65 % y 2 cervezas de $1.000 | $4.500 | $4.500 | $5.500 |
| El mismo con el vino al 55 % | $5.500 | $5.500 | $6.500 |

**Cómo se llegó, el mismo día, en dos decisiones.** Hasta el 2026-10-13 regía la regla del
2026-08-27, *"la comparación es por aplicación, no por línea"*. Cada tanda se comparaba sola
contra el catálogo de toda su línea, aunque otra tanda ya lo hubiera anulado. Lo vio la
revisión del NxM (`30622fcf`). La orquestadora le preguntó al owner con el carrito de las
cervezas, y el owner eligió *"La promo entera contra el catálogo de lo que toca"*: sumar todas
las tandas de una promo. Las otras opciones eran *"cada grupo contra lo que queda"*, que depende
del orden, y *"dejarlo"*. Al diseñarla, la sesión del frente midió dos cosas que la pregunta no
mostraba:

- Aplicada al pie de la letra, cobraba **más que la regla anterior** en los carritos de vinos
  ($5.500 y $6.000). En el primero, la tanda de los vinos perdía y arrastraba consigo a la de las
  cervezas. En el segundo, la promo ganaba en total y le sacaba al vino un catálogo que daba más
  que su tanda.
- No decía qué pasaba con **dos promos distintas sobre la misma línea**.

La orquestadora reabrió la decisión con esos dos carritos, y el owner eligió *"Juntas solo si
comparten producto"*. Descartadas en esa segunda pregunta: la regla literal por promo, y la
literal más "las promos que comparten línea se comparan juntas".

Implementación: `resolverPromociones` en
`backend/src/modules/calculo-precios/calculo-precios.engine.ts` (bloques por unión-búsqueda
sobre las líneas, en memoria y sin consultas).

---

## El instante por línea, y la asimetría con la vigencia de reglas comunes

La promo se evalúa contra el instante en que **se pidió** cada línea, no contra cuándo se
cobra la cuenta:

- Con `cuentaId` (salones): cada línea evalúa con el `creado_el` de su fila de
  `cuenta_lineas`. La cerveza pedida a las 18:30 lleva el happy hour de 17–20 aunque la mesa
  cobre a las 22:00; la pedida a las 20:15 no, aunque se cobre en el mismo ticket.
- Sin cuenta (POS directo, tienda, suscripciones): todas las líneas evalúan con **ahora** —
  pedir y cobrar son el mismo acto.
- El instante **nunca viaja por valor desde el cliente**: sale siempre de la BD
  (`instantesDeLineas` en `calculo-precios.service.ts`).

✅ **La asimetría se cerró el 2026-08-31, y la cerró el owner.** Hasta entonces la vigencia
por fecha de las reglas comunes (`descuentos`/`recargos`) se decidía por `cuenta.abierta_el`
mientras la de las promos ya era por línea, y esta nota decía que unificarlas era "una
decisión aparte del owner". Lo fue: al decidir que **lo pedido se cobra como se pidió**, la
línea pasó a congelar sus descuentos y recargos al pedirse, con su vigencia ya resuelta. Los
dos instantes son ahora el mismo — cuándo se pidió la línea.

Lo que eso cambia en la práctica, y está fijado por test
(`vigencia-cuenta.e2e-spec.ts`): una cuenta abierta la semana pasada con una línea pedida
hoy **ya no** lleva la promo de la semana pasada; y una línea pedida con el descuento vivo
lo conserva aunque venza antes de cobrar.

✅ **La precarga también es por línea desde el 2026-10-11.** Fecha, día de la semana y hora
ya se evaluaban contra el instante de cada línea (`instanteEnVentana`), pero antes de evaluar,
`cargarVigentes` traía solo las promos cuyo rango contenía el día de `cuenta.abierta_el`. Una
promo que empezaba después de que se sentó la mesa nunca llegaba a mirarse: promo "solo el
31", mesa abierta el 30 a las 23:30, cerveza pedida el 31 a las 00:30 → sin promo. Ahora se
cargan las promos cuyo rango **toca** el de los días de las líneas, del pedido más temprano al
más tarde, en la misma única consulta. Lo cargado de más lo descarta `instanteEnVentana` por
línea, así que el ejemplo del owner sigue igual: mesa abierta el 31 a las 23:30 y cerveza
pedida el 1 a las 00:30 → sin la promo del 31.

El rango sale de los instantes de las líneas y no de "la apertura hasta hoy" a propósito: es
exacto por construcción y no depende de que ninguna línea sea más vieja que la apertura de
su cuenta. Hoy eso vale (al fusionar, el destino es la cuenta abierta primero), pero es una
regla de otro módulo. Lo fijan los cuatro casos de *"una promo de un solo día"* en
`vigencia-cuenta.e2e-spec.ts`, por la precuenta y por el cierre. Volver a cargar por el día de
la apertura da rojo el primero y el cuarto. Detalle en [`../agent/resueltos.md`](../agent/resueltos.md).

---

## Modelo de datos

| Tabla | Qué guarda |
|---|---|
| `promociones` | La campaña: vigencia (fecha+hora+día+canal), `tipo` (`porcentaje`\|`nxm`\|`precio_fijo`) y las columnas de su beneficio (`nxm`: `valor_porcentaje`, `cada_n` y `paga_m`), el resto `NULL` (CHECK de forma por tipo). `fecha_fin` es **obligatoria** — guardarraíl heredado del frente de vigencia, que perdió el suyo al eliminar el tipo `promocional`. |
| `promocion_scopes` | Los "slots" (la Condición): `items`\|`categoria`\|`venta`. `porcentaje`/`nxm` llevan exactamente 1; `precio_fijo` lleva 1..N (cada uno un componente del combo, AND entre sí). |
| `promocion_scope_items` | Bridge scope↔ítem, solo para `tipoScope='items'`. |
| `ventas_promociones` | El congelado — molde de `ventas_descuentos`: nombre/tipo/valor efectivo congelados, `aplicacion` agrupa (1-based por promo), un solo camino de escritura (`crearEnTransaccion`). `SUM(monto)` sobre esta tabla es "cuánto descontamos en promos", sin filtrar `ventas_descuentos` por ningún flag — la razón de ser del enfoque, ver ADR-023. |

`paga_m` llegó el 2026-10-13 con la migración `NxmPagaM`, que llena los `nxm` existentes con
`cada_n − 1` antes de recrear el CHECK: el demo de Railway conserva sus filas y sin eso no
arrancaba. No es una copia que pueda divergir sino la regla anterior escrita de otra forma ("la
más barata de cada `cada_n`" = "paga `cada_n − 1`"), así que el 2x1 existente cobra igual.

Detalle de columnas y CHECKs: spec §"Modelo de datos". Entidades:
`backend/src/modules/promociones/entities/`.

---

## El evaluador

`backend/src/modules/promociones/promociones.evaluator.ts` — función **pura**, sin BD ni
NestJS, mismo molde que `calculo-precios.engine.ts`. Recibe promos elegibles + líneas
resueltas, devuelve las aplicaciones que ganan el conflicto entre promos, en plata fina.

⚠️ **Vive en el dominio del precio de LISTA, no del neto** — decisión tomada durante la
implementación, distinta de lo que el diseño original asumía (ver "Cambios respecto al
diseño" abajo). Un "20%" es 20% de la etiqueta y un combo de $9.990 es lo que el cliente paga
por el conjunto; el motor convierte cada monto a neto al aplicarlo, con el mismo factor con
que esa línea desbrutea.

**Conflicto promo-vs-promo: greedy por CONTEO DE UNIDADES por línea** (no por presencia de
línea — ver "Cambios respecto al diseño"). Todas las candidatas de todas las promos se
ordenan por monto total descendente (desempate por id de promo) y se recorren en ese orden:
una candidata entra si le alcanza el cupo de unidades libres en cada línea que toca.
`porcentaje` sigue operando a nivel línea entera — pide la línea completa, no unidades
sueltas — lo que es una **limitación aceptada de F1**: una línea parcialmente consumida por
otra promo queda indisponible para `porcentaje` aunque en teoría le quedara una unidad libre.

Por tipo (detalle y ejemplos en el docblock de cada función):

- **`porcentaje`**: cada línea del scope, dentro de su franja, recibe `valorPorcentaje ×
  precioLista × cantidad`. Único tipo que admite cantidad fraccionaria (venta al peso).
  **El valor es menor a 1** (owner, 2026-10-04, *"Topar la promo bajo 100 %"*): una promo no
  regala. Un plato regalado es una cortesía, que paga IVA como retiro, y con una promo del 100 %
  saldría en una boleta de $0 sin IVA. El 400 lo da `PromocionesService.validarTopeDelPorcentaje`
  al crear, al editar el valor o el tipo y al activarla (`{ activo: true }`, lo que manda el
  toggle de la pantalla). Un `PATCH` que no hace nada de eso pasa, así una promo guardada al
  100 % antes del tope se puede **pausar** (el toggle) y, por API, renombrar con un `PATCH` que no
  toque valor, tipo ni `activo: true`. El drawer de edición no sirve para eso, porque reenvía el
  valor y el tipo en cada guardado: ahí hay que bajar el valor a menos de 1 o pausarla. No se
  puede volver a activar mientras siga al 100 % (el motor la sigue aplicando mientras siga
  activa; no hay datos productivos que migrar). El tope del `nxm` es otro, ver abajo. Detalle en
  [ADR-028](../adr/028-emision-registrada-por-venta.md).
- **`nxm`**: **"lleva `cadaN`, paga `pagaM`"** (owner, 2026-10-13, por AskUserQuestion de la
  orquestadora con la tabla de 2x1, 3x2, "segunda al 50%" y 3x1: *"Hacer el NxM de verdad"*). Toma
  las unidades enteras (`⌊cantidad⌋`) por precio de lista descendente y arma grupos de `cadaN`; en
  cada grupo, las `cadaN − pagaM` **más baratas** reciben cada una `valorPorcentaje × precio`.
  Repetible. Cuando las regaladas vienen de líneas distintas, la aplicación lleva un monto por
  línea, igual que el combo.
  - **El valor es el de cada unidad regalada, como máximo 1** (100 % inclusive: la unidad gratis
    del paquete es precio). `pagaM ≥ 1` sale de la regla de arriba: el grupo paga por lo menos su
    unidad más cara. Lo valida `PromocionesService` con 400, en los mismos flujos que el tope de
    `porcentaje`, y el CHECK exige `1 ≤ paga_m < cada_n`. Una guardada con más de 1 (el truco
    del 3x1 al 200 %, que descontaba dos veces la más barata) sigue el mismo precedente: aplica
    mientras esté activa, se pausa, y no se reactiva ni se reescribe sin bajar el valor.
  - **Las sobrantes pagan completo** (owner, 2026-10-13, *"Sí, pagan completo"*; descartada *"las
    sueltas también llevan algo"*): 5 cervezas de $1.000 en un 3x1 son un grupo y dos sueltas,
    $3.000.
  - Ejemplos, en precio de lista: 3x1 sobre $1.000, $1.000 y $800 regala $1.000 + $800 y cobra
    $1.000; 4x2 sobre $1.500, $1.200, $1.000 y $700 cobra $2.700; 2x1 al 50 % sobre $1.000 y
    $800 cobra $1.400.
- **`precio_fijo`** (combo): arma combos con las unidades **más caras** de cada slot
  (decisión 3 del owner) mientras el descuento resultante sea positivo — una promoción nunca
  encarece —, y reparte el descuento a prorrata del precio aportado entre las líneas del
  combo (residuo por mayores restos). Repetible.

### Unidades contadas, no explotadas, y el tope de una venta (2026-10-06)

**`nxm` y `precio_fijo` razonan por unidad, pero no arman un elemento por unidad.** Hasta esa
fecha cada uno armaba un array con una entrada por unidad y lo ordenaba, y `cantidad` la elige
el cliente: una línea de 10⁶ unidades con un 2x1 tardaba 4–5 s por HTTP con el event loop tomado
para todos los tenants. Ahora cuentan por **lote** (las unidades de una línea, que el comparador
no distingue entre sí) con un cursor que las recorre en el mismo orden. Lo que sale es idéntico, y
lo prueba `promociones.evaluator.oraculo.spec.ts`, que tiene adentro el evaluador anterior
(`6cecf160`) como oráculo y compara la salida completa. Dos detalles que el oráculo cazó como
mutantes:

- **Dentro de un combo la suma sigue siendo unidad por unidad.** Con un precio de 20 cifras
  significativas (la precisión de `Decimal`), sumar 7 veces no da lo mismo que multiplicar por 7.
- Los grupos y combos con los mismos tramos que el anterior **reusan** la plata ya calculada:
  mismas operaciones, mismo resultado.

⚠️ **Contar no cierra el problema solo, y conviene saber por qué.** El contrato devuelve **una
aplicación por grupo o combo**: 10⁶ unidades en un 2x1 son 500.000 aplicaciones, cada una con su
traza en el motor —cuantizada aparte— y su fila en `ventas_promociones`. Medido, el evaluador
explicaba menos de la mitad del tiempo. Lo que lo cierra es el **tope**: **99.999 unidades (o
kilos) por venta o por mesa** (owner, 2026-10-06, por AskUserQuestion de la Sesión de esfuerzo
máximo: primero con los tiempos de `/calcular` —0,1 / 0,5 / 5 s para 10⁴ / 10⁵ / 10⁶—, y después
se le volvió a preguntar con la venta guardada en el peor caso, y mantuvo 99.999 sobre 9.999;
también descartó 999.999). Es por venta porque la numeración de las
aplicaciones y el costo dependen de toda la venta: 500 líneas de 9.999 se cuelgan igual.

| Dónde se aplica | Qué ve el usuario |
|---|---|
| `cantidad` de `/calcular`, la venta, agregar y cambiar una línea de cuenta (`@IsDecimalHasta`) | 400 `… no puede superar 99.999` |
| La suma de la venta, en `CalculoPreciosService.calcular` (pasan `/calcular`, el POS, el online y el cierre de una cuenta) | 400 `Una venta puede llevar hasta 99.999 unidades en total, y esta suma …` |
| La suma de la cuenta bajo su lock, al agregar, cambiar (reemplaza la cantidad vieja) y fusionar | 400 `Una mesa puede llevar hasta 99.999 …` |

**Agregar aplicaciones iguales en una sola no se hizo**, y solo se abre si el tope resulta corto
para algún negocio (Sesión de esfuerzo máximo). No cambiaría la plata: k × q(m) da el total de
hoy. Cambiaría las filas de `ventas_promociones`, el ticket y el congelado, así que sería un
frente de motor y congelado.

**Medido después**, con un 2x1 sobre un servicio de $1.000, el peor caso tiene **dos números, y
no se mezclan**:

- **~0,5 s para `/calcular` y para el resto de los usuarios.** `/calcular` con 99.999 unidades
  tarda 346 ms; con 10⁶ da 400 en 57 ms. Mientras se guarda la venta más grande, el event loop
  queda tomado ~0,1–0,3 s (el cálculo).
- **~2 s para quien cobra esa venta.** `POST /ventas` con 99.999 unidades tarda 2,2 s: el resto
  es la espera de las 49.999 filas que se insertan.

El "medio segundo" no vale para la venta guardada. Por qué la venta no se cae al guardarlas: § Congelado y dónde se ve.

Tests: `promociones.evaluator.spec.ts` (agrupación, empates, franja que cruza medianoche,
cantidades fraccionarias, greedy entre promos y dentro de la misma promo),
`promociones.evaluator.oraculo.spec.ts` (misma salida que el evaluador anterior, y 10⁶
unidades en menos de 50 ms) y `test/cantidad-grande-promo.e2e-spec.ts` (el tope por cada
puerta y la venta de 65.536 unidades).

---

## Integración con el motor

```
CalculoPreciosService.calcular
  1. resuelve líneas (precio de lista unitario, convertido a moneda oficial)
  2. instantesDeLineas: 1 query a cuenta_lineas (si hay cuentaId); la zona del tenant ya
     la resolvió calcular() para el día de la vigencia, una sola vez
  3. cargarVigentes: 1 query batch (promos + scopes + items del tenant) cuyo rango de
     fechas toca el de los días de las líneas
  4. evaluarPromos (puro) → aplicaciones candidatas
  5. calcularVenta({ …, promociones, config }) — el motor aplica y cierra
```

Costo para un tenant sin promos: **sin cuenta, ninguno**: la zona es la misma que ya se
resolvió y no hay líneas de cuenta que leer. **Con cuenta, una lectura de `cuenta_lineas`**
por el índice `(tenant_id, cuenta_id)`: hasta el 2026-10-11 no la pagaba, porque las promos
se cargaban antes que los instantes, pero el rango de la carga ahora sale de ellos. El tenant
con promos paga una consulta menos que antes, porque la zona ya no se pide dos veces.

**Dentro del paso `descuentos` de cada línea**: primero las reglas de catálogo, después los
montos de promo como monto fijo. Piso en cero y cuantización al cierre del paso aplican por
construcción — la promo es un descuento más para esa aritmética.

### El ancla del combo (por qué cierra exacto en su precio)

Un descuento de nivel venta no apaga el cierre por resta del motor (el mecanismo que deriva
el impuesto restando en vez de multiplicar `tasa × base`, adoptado el 2026-08-21 porque
`tasa × base` no cierra en el 15,6% de los casos barridos) — le mueve el **ancla**. Las
promociones corren el mismo mecanismo: el ancla de la línea pasa a ser `etiqueta − promo`, y
sobre esa cifra se aplica el descuento de documento si lo hay. Es la razón por la que un
combo declarado "$9.990" cierra en exactamente $9.990 (IVA adentro) y no en $9.991, y por la
que un 2x1 sobre una etiqueta de $993 no le cuesta un peso a la unidad "gratis" (un 3x1 sobre la
misma etiqueta cobra $993 exacto, lo fija `promociones.e2e-spec.ts`). Detalle:
`calculo-precios.engine.ts`, sección "El ancla del cierre".

---

## Congelado y dónde se ve

- **`ventas.service.ts`** persiste `ventas_promociones` desde `resultado.lineas[].trazas.promociones`,
  cruzando línea→detalle **por índice** (nunca por `itemId` — el mismo ítem puede estar en
  dos líneas con personalizaciones distintas), en la misma transacción que el resto del
  congelado. `config_calculo` gana `promosAcumulanDescuentos`.
  Dos cosas que una venta grande hizo visibles el 2026-10-06: las filas se insertan **por
  tandas** (`FILAS_POR_INSERT`, en `ventas.service.ts`). Antes, 16.384 unidades con un 2x1 daban
  500, porque Postgres cuenta en 16 bits los parámetros de un INSERT de 8.192 filas × 8. Y
  `aplicacion` es `integer`: 65.536 unidades ya pasaban las 32.767 de un `smallint`. Las dos las
  fija `test/cantidad-grande-promo.e2e-spec.ts`.
- **Drawer de venta** (`frontend/app/components/ventas/VentaDetalleDrawer.vue`): familia
  propia `'Promoción'` en el desglose expandido de la línea, mismo formato que
  descuento/recargo/impuesto, y **después** de las reglas de catálogo dentro del paso
  `descuentos` — el orden en que el motor las restó. Una aplicación cross-línea (combo) se
  lee línea por línea, con el nombre repetido — es la derivación del total de ESA línea; el
  campo `aplicacion` viaja en el congelado y esta pantalla **no** agrupa por él.
  ⚠️ El total rotulado **"Descuentos"** del panel de totales **incluye la plata de las
  promos** (`totalDescuentos` ya las trae sumadas), al revés que el ticket, que las resta del
  agregado y las nombra aparte. Es deliberado: acá el desglose por línea ya nombra cada
  promo, así que restarlas dejaría un agregado que no cuadra con nada. Congelado en
  `VentaDetalleDrawer.nuxt.spec.ts` desde el 2026-08-28.
- **Ticket** (`frontend/app/utils/ticket-builder.ts`): cada promo se imprime **nombrada**
  (`2x1 martes  −$5.000`), separada del agregado `Descuento` — `agregarPromocionesVenta`
  funde las aplicaciones de la misma promo en una sola fila, y
  `descuentoCatalogo = totalDescuentos − Σ promociones` evita contar la plata de promo dos
  veces (una en el agregado, otra en su fila nombrada). Igual que los recargos en cero: una
  promo sin monto no se imprime — y esa promo **no** es la que perdió el interruptor (esa se
  descarta entera y sin traza, ver arriba), sino la que el **piso en cero** recortó hasta la
  nada porque el catálogo ya se había llevado la línea.
- **Carrito (POS / Salones / Tienda)**: la previsualización corre el mismo cálculo; la promo
  aparece en el desglose con su nombre (`PromocionesAplicadas.vue`, el mismo componente en
  las tres pantallas). Sin toasts nuevos. **Una promo con monto `'0'` no se dibuja**, igual
  que en el ticket: la produce el piso en cero cuando el catálogo ya se llevó la línea
  entera, y lo que hay que contar en ese caso lo cuenta el aviso de al lado, no una fila
  `-$0`. Alineado desde el 2026-08-28; hasta entonces el carrito la mostraba y el ticket no.

---

## Pantalla de configuración

`/configuracion/promociones` (`frontend/app/pages/configuracion/promociones.vue`) — molde de
descuentos/recargos: `CrudTable` + drawer con formulario por tipo
(`frontend/app/utils/promociones-form-config.ts`). Guard `TenantAdminGuard` (catálogo/config:
escritura admin-only, lectura abierta a cualquier autenticado del tenant — mismo mapa de
permisos que descuentos). Badges derivados `Programada`/`Vigente`/`Vencida`/`Pausada` con
fecha del navegador (etiqueta, no plata — misma limitación asumida que las reglas de
descuento).

**Por qué cambiar de tipo avisa con un toast y no con un modal, a diferencia de
`descuentos`**: en `descuentos`, cambiar de tipo puede dejar guardado un valor que el motor
sigue leyendo aunque ya no se vea en el formulario — el 400 no lo frena porque el campo
válido sigue lleno. Acá el campo requerido del tipo nuevo **siempre** queda vacío tras el
cambio (`onTipoChange` lo limpia), así que el submit ya lo frena con un 400 legible antes de
que se pierda algo guardado de verdad — el toast solo evita la sorpresa de "¿por qué
desapareció el combo?" a mitad de la edición, no protege ningún dato. No es una
inconsistencia con `descuentos`: son dos riesgos distintos y cada pantalla responde al suyo.

**El `nxm` se configura como "Lleva [N] Paga [M]"**, con la ayuda *"De cada 3 unidades, las 2 más
baratas llevan el descuento"* debajo, y después el *Descuento en cada unidad regalada*. Ese campo
arranca **vacío con el ejemplo gris "1.00 (gratis)"** y no en 1.00 (owner, 2026-10-13, *"Vacío,
con ejemplo gris"*): así cambiar de tipo sigue dejando vacío el campo requerido, que es lo que
frena el guardado antes de pisar un combo guardado (ver el párrafo de arriba). La tabla lo resume
como "Lleva 3, paga 1", y nombra el porcentaje solo cuando no es 100 % ("Lleva 2, paga 1 ·
regalada al 50%"). Las frases salen de `resumenNxm` y `ayudaNxm` (`usePromociones.ts`).

**El interruptor de tenant** vive en Preferencias financieras, con el texto: *"Cuando una
promoción y un descuento tocan el mismo producto: ¿se suman, o aplica solo la rebaja
mayor?"*

---

## API Endpoints

```
GET /api/promociones
Authorization: Bearer <token>
Response (200): PromocionConScopes[] — incluye scopes[] con sus itemIds

POST /api/promociones
Authorization: Bearer <token> (TenantAdminGuard)
Body: CreatePromocionDto
Response (201): Promocion

PATCH /api/promociones/:id
Authorization: Bearer <token> (TenantAdminGuard)
Body: UpdatePromocionDto
Response (200): Promocion

DELETE /api/promociones/:id
Authorization: Bearer <token> (TenantAdminGuard)
Response (200)
```

No hay `GET /api/promociones/:id` — el drawer de edición reusa la fila ya cargada por el
`findAll`, mismo patrón que `descuentos`/`recargos`.

Las promos **nunca viajan en el request de cálculo** — se resuelven server-side siempre. Lo
único que `CalcularVentaDto` agrega es `canal?: 'fisico' | 'online'` (default `'fisico'`),
para que la previsualización filtre igual que la venta real; el cobro nunca lo toma del
body (`crearEnTransaccion` pasa el canal real de la venta).

---

## Backend

- **Módulo**: `backend/src/modules/promociones/promociones.module.ts`
- **Controller**: `promociones.controller.ts`
- **Service**: `promociones.service.ts` — `findAll`, `cargarVigentes` (batch para el motor:
  promos + scopes + items en 1 query, filtradas por `activo` y por un rango de fechas que toca
  el de los días de las líneas; fecha/hora/día/canal se afinan por línea en el evaluador), `create`/`update`/`remove`, validaciones de forma y
  cardinalidad de scopes por tipo.
- **Evaluador**: `promociones.evaluator.ts` (puro, ver arriba).
- **Entidades**: `entities/promocion.entity.ts`, `promocion-scope.entity.ts`,
  `promocion-scope-item.entity.ts`; el congelado vive en
  `backend/src/modules/ventas/entities/venta-promocion.entity.ts`.
- **Integración**: `calculo-precios.service.ts` (`resolverPromociones`,
  `instantesDeLineas`) y `calculo-precios.engine.ts` (`resolverPromociones` — el arbitraje
  del interruptor, y el ancla del cierre).
- **DTOs**: `dto/create-promocion.dto.ts` (con `ScopePromoDto` anidado),
  `dto/update-promocion.dto.ts`.

## Frontend

- **Página**: `app/pages/configuracion/promociones.vue`
- **Composable**: `app/composables/usePromociones.ts`
- **Config declarativa por tipo**: `app/utils/promociones-form-config.ts`
- **Desglose en carrito**: `app/components/PromocionesAplicadas.vue`
- **Desglose en detalle de venta**: `app/components/ventas/VentaDetalleDrawer.vue`
  (`filaDePromocion`, familia `'Promoción'`)
- **Ticket**: `app/utils/ticket-builder.ts` (`agregarPromocionesVenta`,
  `lineasTotalesConImpuestos`)

---

## Cambios respecto al diseño original

El diseño (`2026-08-27-motor-promociones-design.md`) se escribió antes de implementar; dos
decisiones cambiaron durante la ejecución, las dos por bugs medidos en revisión y resueltas
con el owner en el momento — quedan documentadas acá para que no se lean como desvíos sin
explicación:

1. **Dominio de la promesa: LISTA, no neto.** El evaluador originalmente calculaba sobre el
   neto. Medido: un 20% de promo sobre una etiqueta de 993 (bruto) cobraba **756**, donde un
   20% de descuento de catálogo — que sí opera en el dominio correcto — cobraba **794** sobre
   la misma etiqueta. Se corrigió a que el evaluador prometa en LISTA (lo que el cliente ve)
   y el motor convierta a neto al aplicar, mismo patrón que ya usan las reglas de nivel
   documento. Con esto, un 20% de promo y un 20% de descuento cobran lo mismo, y el combo
   cierra exacto en su precio declarado.
2. **Conflicto entre promos: por CONTEO de unidades, no por LÍNEA.** El primer greedy
   descartaba una candidata completa si tocaba una línea ya usada por otra, así que dos
   grupos de un mismo 2x1 sobre una línea de 4 unidades (`cadaN=2`) colisionaban entre sí y
   solo se cobraba la mitad del descuento esperado ($5.000 en vez de $10.000, medido). Se
   corrigió a contar unidades consumidas por línea en vez de marcar la línea entera como
   tomada.

---

## Testing

```bash
cd backend
npm test -- --testPathPattern=promociones          # evaluador + service, unit
npm run test:e2e -- promociones.e2e-spec.ts         # requiere reset-db.sh antes

cd frontend
npm test -- --testPathPattern=promociones           # composable + form-config + render spec
```

Cobertura, además de la unit del evaluador (ver arriba): el motor con el interruptor en las
dos posiciones (incluida la aplicación cross-línea comparada entera y los bloques de
aplicaciones que comparten línea, con la cadena A–B–C), traza propia, la
familia perdedora dejando "No aplicó"; el service con elegibilidad (fecha/hora/día/canal) e
instantes por línea; el e2e cubre una promo congelándose en `ventas_promociones`, que
previsualización y venta coincidan, y — punta a punta, la única forma de probar la decisión 4
del owner (`docs/superpowers/specs/2026-08-27-motor-promociones-design.md`) — que en una cuenta
de salón la línea pedida dentro de la franja lleve la promo y la pedida fuera no, aunque se
cobren juntas. Y el carrito de las cervezas con "no se suman" ($2.000 con el 3x1, $3.000 con el
2x1) por `/calcular`, POS, cuenta de salón y online.

---

## Related

- [`docs/superpowers/specs/2026-08-27-motor-promociones-design.md`](../superpowers/specs/2026-08-27-motor-promociones-design.md) — el diseño completo, con la investigación de mercado
- [`docs/superpowers/specs/2026-07-22-motor-promociones-analisis.md`](../superpowers/specs/2026-07-22-motor-promociones-analisis.md) — el análisis de alcance de Fase 1 (julio 2026), promovido a este diseño
- [ADR-023](../adr/023-promociones-familia-propia-del-motor.md) — por qué el evaluador vive afuera del motor y la aplicación/conflicto adentro
- [`docs/features/descuentos-recargos.md`](./descuentos-recargos.md) — la familia de reglas de catálogo con la que promociones compite (y de la que se separó, ver ADR-023)
- [`docs/features/motor-calculo-precios.md`](./motor-calculo-precios.md) — el motor que aplica y cierra
- [`docs/features/combos.md`](./combos.md) — la otra forma de "paquete a precio propio"; ver `docs/PRODUCTO.md` §7 para el criterio de cuándo usar cada uno
- `docs/PRODUCTO.md` — la regla producto-vs-promo
