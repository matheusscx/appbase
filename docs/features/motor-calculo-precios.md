# Feature: Motor de cálculo de precios

**Status**: Complete
**Owner**: Cesar Matheus
**Last Updated**: 2026-06-28

---

## Overview

### What is it?

Motor que, dada una lista de líneas (ítem + cantidad) y un contexto (método de
pago, reglas a nivel venta), devuelve el **desglose de precio**: neto →
descuentos → recargos → impuestos → total, con trazabilidad por regla. Es un
**servicio puro y stateless**: no persiste nada. Lo consumirán ventas, notas de
crédito y la previsualización de precio en el POS.

### Why does it exist?

Todos los insumos de precio ya estaban modelados (ítems, impuestos, descuentos,
recargos, fórmula y preferencias financieras por tenant) pero faltaba la pieza
que los combina aplicando la configuración del tenant de forma consistente y
auditable. El cálculo de dinero usa **Decimal.js** en todo (nunca `number`).

### Scope

- **Incluido**: cálculo por línea y por venta; reglas planas (% o monto fijo),
  tramos (`por_mayor` por cantidad, `por_monto_venta` por monto) y filtro por
  método de pago; desbruteo cuando `precio_incluye_impuesto`; `base` vs
  `compuesto`; orden de fórmula configurable; `escala_calculo` + `modo_redondeo`.
- **NO incluido (futuro)**: reglas por fecha (`promocional`) y por vencimiento
  (`mora`, `pronto_pago`) — requieren datos de venta/crédito aún inexistentes;
  condiciones `monto_minimo`/`cantidad_minima`/`customer`/`categoria`;
  persistencia de ventas; conversión a moneda oficial.

---

## API Endpoints

```
POST /calculo-precios/calcular
Authorization: Bearer <token>   (JwtAuthGuard + TenantGuard; tenant del token)

Request:
{
  "lineas": [
    { "itemId": "uuid", "cantidad": "2",
      "precioUnitario": "100",            // opcional (override de precio_base)
      "descuentoIds": ["uuid"],           // opcional (reemplaza los del ítem)
      "recargoIds": [],                   // opcional (reemplaza los del ítem)
      "impuestoIds": []                   // opcional (reemplaza los ADICIONALES del
                                           // ítem, tipo='otro'; el IVA no se puede
                                           // pisar ni quitar — 400 si trae un id
                                           // tipo='iva', ver ADR-018)
    }
  ],
  "metodoPagoId": "uuid",                 // opcional (habilita reglas metodo_pago)
  "descuentosVentaIds": ["uuid"],         // opcional (reglas a nivel venta)
  "recargosVentaIds": []
}

Response (201):
{
  "lineas": [{
    "itemId", "cantidad", "precioUnitario",
    "subtotalNeto", "descuentoAplicado", "recargoAplicado",
    "impuestoAplicado", "totalLinea",
    "trazas": {
      "descuentos": [{ "id", "nombre", "monto" }],
      "recargos":   [...],
      "impuestos":  [{ "id", "nombre", "tasa", "monto" }]
    },
    "advertencias": [{ "titulo": "Descuento \"X\"", "detalle": "no se aplicó completo porque superaba el monto disponible" }]
  }],
  "totales": {
    "subtotalNeto", "totalDescuentos", "totalRecargos",
    "totalImpuestos", "totalFinal"
  },
  "trazasVenta": { "descuentos": [...], "recargos": [...] },
  "advertenciasVenta": [{ "titulo": "…", "detalle": "…" }],
  "advertencias": [{ "titulo": "…", "detalle": "…" }]
}
```

**Advertencias.** El motor emite avisos que **no frenan el cálculo**. Hoy son cuatro:
un descuento que supera el monto disponible y se topea; una **regla pausada**
(`activo = false`) que por eso no se aplica; un **impuesto pausado**, ídem; y un **ítem
pausado**, que a diferencia de los anteriores **sí se cobra** —el aviso es que ya no se
ofrece en el catálogo, no que no se aplicó— y por eso lo emite el service y no el motor
(un ítem pausado no cambia ningún monto). Ver
[descuentos-recargos.md](./descuentos-recargos.md). Cada advertencia viaja
partida en `{ titulo, detalle }` (`AdvertenciaPrecio` en el motor) en vez de una
frase única: el carrito es angosto y una sola línea de texto con todo el mensaje
ocupaba varios renglones, así que `titulo` (ej. `Descuento "X"`) se muestra en la
línea y `detalle` (ej. `no se aplicó completo porque superaba el monto disponible`,
sin nombrar montos: el aplicado ya viaja en la traza, que el front formatea) queda
en un tooltip. El resultado los expone en dos granularidades porque se muestran en
lugares distintos: `ResultadoLinea.advertencias` va bajo la línea que lo produjo, y
`advertenciasVenta` —las reglas a nivel venta, que no pertenecen a ninguna línea— va
junto al total. `advertencias` es el aplanado de ambos.

> ⚠️ `advertenciasVenta` son **descuentos Y recargos** de venta. Hasta 2026-08-03 decía
> "solo los descuentos", y era cierto por accidente: la única advertencia que existía
> —el tope— solo se emite en descuentos, así que el ensamblado leía `dv` e ignoraba `rv`
> sin que se notara. Cuando las reglas pausadas hicieron que un recargo también pudiera
> avisar, ese supuesto se volvió un bug: un recargo de venta pausado bajaba la plata
> cobrada sin traza ni advertencia. Si tocás esta parte, las dos ramas van siempre.

La razón de
separarlos en vez de que el consumidor reste por igualdad: dos advertencias con el
mismo `titulo`+`detalle` son alcanzables (dos descuentos distintos topeados al mismo
monto producen el mismo mensaje).

Al persistir la venta, `ventas.service.ts` vuelve a componer cada advertencia en una
sola frase (`` `${titulo}: ${detalle}` ``) para el campo `advertencias: string[]` de
la respuesta de la venta —el mismo formato de siempre, que consumen los toasts del
POS—. Ese contrato no cambia; la partición en `titulo`/`detalle` solo viaja por el
motor y la previsualización del carrito.

Todos los montos son strings con `escala_calculo` decimales.

---

## Backend

### Module & Services

- **Module**: `src/modules/calculo-precios/calculo-precios.module.ts`
  (importa `ItemsModule`, `ImpuestosModule`, `DescuentosModule`,
  `RecargosModule`, `TenantsModule` — **reúsa** sus servicios, no crea entidades).
- **Controller**: `calculo-precios.controller.ts` — `POST /calculo-precios/calcular`.
- **Service**: `calculo-precios.service.ts` — resuelve datos del tenant (ítems,
  catálogos de reglas, preferencias) y delega en el motor puro. **Carga el
  carrito entero en 2 queries fijas**, no una por línea:
  `ItemsService.cargarBasePorIds` (fila base + validación de pertenencia al
  tenant, 404 si falta) y `cargarReglasPorIds` (los ids de
  impuestos/descuentos/recargos de todos los ítems en un `UNION ALL`).
  `resolverLinea` no hace I/O.
- **Motor puro**: `calculo-precios.engine.ts` — `calcularVenta(VentaResuelta)`,
  sin BD ni NestJS; 100% testeable de forma aislada.

**Orden de las reglas (decisión abierta).** En modo `compuesto` cada regla se
aplica sobre el acumulado de la anterior, así que el orden dentro de la lista de
un ítem **cambia el total** cuando se mezclan `monto_fijo` y porcentaje (entre
porcentajes no conmuta el redondeo, pero la composición sí es multiplicativa).
Ese orden nunca estuvo definido y la tabla puente no guarda cuándo se asoció cada
regla.

Desde el batch de 2026-07-28 el orden es **determinista por id**
(`ORDER BY` en `cargarReglasPorIds`). No es el mismo que antes: `EXPLAIN` sobre
esas tablas da `Bitmap Heap Scan`, que reordena por página del heap, así que las
queries por ítem devolvían **orden de inserción**. El cambio por lo tanto
**puede** dar un total distinto en un tenant `compuesto` que mezcle modos en un
mismo ítem — hoy no existe ninguno (ambos tenants del seed están en `base`,
ningún ítem tiene dos reglas de la misma clase, y no hay datos productivos), pero
la garantía es "determinista", no "idéntico a antes". Qué orden debería tener es
una decisión de negocio abierta — ver
[`docs/agent/pendientes.md`](../agent/pendientes.md).

### DTOs

- `CalcularVentaDto` / `LineaDto` (`dto/calcular.dto.ts`) — validación con
  `class-validator`. `cantidad`/`precioUnitario` como `@IsNumberString`.

### Algoritmo (núcleo)

**Desbruteo.** Si `precio_incluye_impuesto`, el neto sale de dividir por `1 + Σ tasas`
de **todos** los impuestos vigentes de la línea, no solo el IVA: el precio de góndola de
una botella con ILA ya trae los dos, y tratarlo como "IVA solamente" cobraría el ILA dos
veces. Un impuesto **pausado sale de esa suma antes de dividir** (si no se cobra, no puede
inflar el divisor), y eso tiene una consecuencia querida y decidida por el owner el
2026-08-04: **la etiqueta manda**. El precio final no cambia y lo que se dejó de cobrar
pasa a ser neto. La boleta reporta más neto y menos impuesto, que es exactamente lo que
pasó. La alternativa —bajar el precio final para preservar el neto— se descartó porque
dejaba lo cobrado sin coincidir con el precio impreso en góndola.
Lo fija el test *"el desbruteo no usa la tasa del impuesto pausado"*.

Por línea: neto unitario (desbruteo si incluye impuesto) × cantidad → recorrer la
fórmula (`paso 1,2,3`) sobre un acumulador. Descuentos restan, recargos suman;
el `%` se calcula sobre el neto (`base`) o sobre el acumulado (`compuesto`).
Impuestos sobre la base ya descontada/recargada (sin impuesto sobre impuesto).
Cada paso redondea con `escala_calculo` + `modo_redondeo`. Reglas a nivel venta
se aplican sobre el neto agregado.

**Decisiones**: `monto_fijo` se aplica por línea (no por unidad); las reglas
diferidas (`promocional`, `mora`, `pronto_pago`) devuelven monto 0; los ids de
descuento/recargo/impuesto en la línea **reemplazan** a los asociados al ítem
(override) — con una excepción: para impuestos, el override solo alcanza a los
**adicionales** (`tipo='otro'`). El IVA nunca sale de `impuestoIds`, ni del ítem
ni de la línea — lo deriva el motor de `clasificacion_tributaria` y no se puede
pisar ni quitar por payload (400 si llega un id `tipo='iva'` explícito, ver
[ADR-018](../adr/018-iva-derivado-de-la-clasificacion.md)).

**Piso en cero del descuento** (decisión del owner, 2026-07-28). **Ninguna regla
puede dejar el total bajo cero** — un `precio_base` negativo sí puede, y eso es
otro pendiente. Sin tope, un `monto_fijo` de 500 sobre un ítem de 100
dejaba `totalLinea: -400` y el tenant terminaba pagándole al cliente. Cuatro
precisiones que hacen a la regla:

- Se topea **regla por regla, al aplicarla**, no al final sobre el total. Así la
  traza registra lo que realmente se descontó y el comprobante cuadra
  (`subtotalNeto − totalDescuentos` sigue dando el total). Con tres descuentos
  del 40% en modo `base` sobre 100, la traza queda 40 / 40 / 20.
- Aplica **también a los descuentos a nivel venta**, y ahí el tope se mide
  contra el **total real** (`Σ totalLinea`, ya con descuentos e impuestos de
  línea adentro), **no** contra el neto agregado. El neto sigue siendo la base de
  los `%` —esa es la semántica de las reglas a nivel venta—, pero la plata
  disponible para topear es otra magnitud. Confundirlas dejaba ventas en negativo
  sin advertencia **y** recortaba descuentos sanos cobrando de más; lo detectó la
  revisión independiente porque el primer test usaba una línea pelada, el único
  caso donde las dos magnitudes coinciden.
- **No frena la venta**: emite una advertencia, igual que un ingrediente no
  bloqueante sin stock. Viaja en `advertencias`/`advertenciasVenta`, tanto del
  cálculo como de la respuesta de la venta. La previsualización del carrito
  (POS, Salones, Tienda) ya la muestra **antes** de cobrar — ver "Frontend"
  más abajo. Los caminos de tienda online y suscripciones siguen
  descartándola al crear el pedido/la suscripción (ver
  `docs/agent/pendientes.md`).

- **Ninguna regla aporta una magnitud negativa.** El signo lo pone el tipo de
  regla, nunca el valor calculado. Hace falta porque el acumulado que sirve de
  base en modo `compuesto` **sí** puede quedar negativo a nivel venta (arranca en
  el neto agregado mientras la plata disponible es `Σ totalLinea`), y un `%`
  sobre esa base producía un "recargo" que restaba y un "descuento" que le
  cobraba al cliente, ambos impresos así en la traza. Un fuzz de 40.000 ventas
  con configuración válida encontró el caso en el 0,78%.

Los recargos **no tienen tope superior** —subir el total no tiene el problema
que el piso resuelve— pero sí el piso en cero de arriba: un recargo nunca resta.

### La venta congela la regla que aplicó (2026-08-02)

**El problema:** las tablas `ventas_descuentos` / `ventas_recargos` /
`ventas_impuestos` guardaban el monto y un puntero al catálogo vivo. Editar un
descuento de 10% a 20% —o borrarlo— reescribía el pasado: la venta ya no podía
decir cuánto valía la regla cuando se cobró.

**La regla ahora:** la fila se basta sola. No se consulta el catálogo para leer
una venta vieja. Es la misma idea de [ADR-010](../adr/010-preparacion-sii-datos-fiscales.md)
—congelar el hecho fiscal en la transacción— extendida a las tres familias, y el
mismo idioma que `venta_detalles`, que ya congela `descripcion` y
`clasificacion_tributaria` del ítem.

Qué congela cada familia. **Las asimetrías son intencionales:**

| Columna | `ventas_descuentos` | `ventas_recargos` | `ventas_impuestos` | Por qué |
|---|:--:|:--:|:--:|---|
| `nombre_regla` | ✅ | ✅ | ✅ | El catálogo puede renombrarla o borrarla |
| `modo` | ✅ | ✅ | — | Un impuesto es siempre porcentaje |
| `porcentaje_aplicado` | ✅ | ✅ | ✅ | Ya existía; solo impuestos la poblaba |
| `valor_solicitado` | ✅ | — | — | Solo a los descuentos los topea el piso |
| `detalle_id` | ✅ | ✅ | ✅ | Nullable: las de nivel venta no son de ninguna línea |

Tres decisiones que no se deducen de la tabla:

- **`porcentaje_aplicado` va `null` explícito en las reglas de monto fijo.** Un
  `0` se leería después como "valía 0%", que es una regla distinta. El otro
  `null` posible —una regla de porcentaje que no llegó a aplicar (diferida,
  método de pago que no coincide, sin tramo)— lo desambigua `modo`.
- **`valor_solicitado` separa lo que la regla pedía de lo que el piso dejó
  aplicar.** `valor_aplicado` sigue siendo lo que entró en el total, para que el
  comprobante cuadre. Sin la columna, un cupón de $5.000 topeado a $2.000 es
  indistinguible de uno que valía $2.000.
- **`detalle_id` se cruza por índice** contra `resultado.lineas`, **nunca por
  `itemId`**: el mismo ítem puede aparecer en dos líneas con personalizaciones
  distintas, y buscar por ítem atribuiría las dos reglas a la misma.

**`ventas.config_calculo` (`jsonb`)** guarda la config con la que se calculó
(`formula`, `calculoDescuentos`, `calculoRecargos`, `escalaCalculo`,
`modoRedondeo`). Sin ella el congelado no es interpretable: el mismo 10% da un
total distinto según el orden de la fórmula y según base|cascada, las dos cosas
editables desde Preferencias. Va en `jsonb` y no en columnas por una razón de
forma —`formula` es un array y el objeto se lee entero—, no por contradecir la
decisión de columnas del resto.

`nombre_regla`, `modo` y `valor_solicitado` son **`NOT NULL`**:
`crearEnTransaccion` es el único camino de escritura de estas tablas, así que el
congelado es invariante de esquema y no convención. Un segundo camino que se
olvide de poblarlas falla al insertar.

**Dónde se ve** (2026-08-02): `VentaDetalleDrawer.vue` → tarjeta **"Líneas de
venta"**. Las reglas **no tienen tarjeta propia**: cuelgan de su ítem, en la
misma tabla, y cada línea se lee como la derivación que es —neto, los pasos con
su signo, total de línea:

El desglose viene **plegado**: una venta de 10 líneas no puede abrirse en 40
filas para responder "¿qué se vendió?". Se expande por línea, y solo las que
tienen reglas ofrecen el toggle.

```
Concepto                    Cantidad    Valor      Monto
› Producto demo               1.0000   $5.000     $5.653     ← plegado
                                                    total

⌄ Producto demo               1.0000   $5.000     $5.653     ← expandido
    Neto                                          $5.000
    Descuento  Socio 10%               10,00%      -$500
    Recargo    Delivery 5%              5,00%      +$250
    Impuesto   IVA                     19,00%      +$903
```

⛔ **El monto de la fila del ítem va rotulado `total` en la propia celda. Es lo
que hace honesta la tabla, y costó tres intentos.** Sin rótulo, esa plata al
lado de `Cantidad` y `Valor` invita a leer una multiplicación que **no cierra**:

- Con el **neto** ahí falla cuando `precio_incluye_impuesto`: el motor desbrutea,
  así que el neto es `precio / (1 + tasas) × cantidad`. Un ítem de $5.950 con IVA
  incluido tiene neto $5.000, y `1 × 5.950` no da `5.000`. *(Ningún ítem
  **vendible** del seeder tiene la marca —solo ingredientes, que no se venden—;
  se reprodujo creando uno por API.)*
- Con el **total** ahí falla en el caso **normal**: el IVA se suma sobre el
  precio, así que una línea de `1 × $1.500` termina en `$1.785`. Esto alcanza a
  todos los ítems del seed, no a un borde.
- Y en cualquiera de los dos, una **venta por presentación** muestra en Cantidad
  la presentación ("2 cajas") mientras el motor multiplicó por la cantidad
  **canónica** (24 unidades).

El rótulo va **en la celda y no en la cabecera** porque esa columna sirve a dos
cosas: totales de línea y montos de regla. La versión que quitó los rótulos
viejos (`Precio unit.` / `Total línea`) para poner cabeceras genéricas fue
justamente la que se rechazó. **No sacar el rótulo `total`.**

El bloque expandido empieza en `Neto` —el punto de partida del que salen las
reglas— y no repite el total al cerrar: ya está arriba, en la fila del ítem.
Una línea sin reglas no ofrece toggle: no hay nada que derivar.

La otra versión descartada, por si alguien la reintenta: listar **por familia**
(todos los descuentos, después todos los recargos) describe la venta pero no el
cálculo, y deja al lector reconstruyendo a qué ítem pertenecía cada fila.

El signo lo pone la familia, no el monto: el motor nunca guarda magnitudes
negativas, así que sin él un descuento y un recargo del mismo valor se ven
idénticos salvo por el color del badge.

El orden sale de `configCalculo.formula` de **esa** venta, no de un orden fijo
del frontend: dos ventas del mismo tenant pueden tener órdenes distintos si
alguien editó Preferencias entre una y otra. Para ventas sin `config_calculo`
—las anteriores al congelado— cae al orden por defecto.

La cabecera muestra el orden **y sobre qué base calculó cada familia**:
`orden: Descuento (base) → Recargo (cascada) → Impuesto`. Mismo vocabulario que
Preferencias financieras, que es donde se configura. No es decoración: con un
neto de $5.000 y un descuento del 10%, un recargo del **mismo** 5% da $250 en
`base` (5% del neto) y **$225** en `cascada` (5% de los $4.500 ya descontados).
El porcentaje congelado es idéntico en los dos casos, así que sin el modo el
monto no se puede reconstruir. Los impuestos no llevan modo —van siempre sobre
el acumulado del paso— y una venta sin config no muestra ninguno, en vez de
inventar el default.

Las reglas de nivel venta van en un bloque final, "Toda la venta", porque no
pertenecen a ninguna línea. Cada fila dice con qué valor aplicó la regla
(`10,00%` o `Monto fijo`) y cuánta plata. Dos casos con nombre propio: un
descuento topeado muestra **`pedía $5.000`** bajo el monto, y una regla que se
evaluó sin aportar nada dice **`No aplicó`** en vez de un guion —que hacía
dudar de si el dato se había perdido— con la fila atenuada.

⚠️ `config_calculo` se escribió durante meses sin que **nadie lo leyera**: el
`SELECT` de `findOne` no lo traía. Lo destapó necesitar el orden para esta
pantalla. El e2e de "congela la config del cálculo" ahora verifica las dos
mitades —que se persista y que viaje por la API—, no solo la primera.

---

## Frontend

- **Composable**: `app/composables/useCalculoPrecios.ts` — `calcular(input)` con
  `useApiFetch` a `POST /calculo-precios/calcular`. El tipo `AdvertenciaPrecio`
  (`{ titulo, detalle }`) espeja al del motor; el tipo `ResultadoLinea` incluye
  `advertencias: AdvertenciaPrecio[]` y el tipo `ResultadoVenta` incluye
  `advertencias` + `advertenciasVenta`, ambos `AdvertenciaPrecio[]`.
- **Previsualización del carrito** (POS `components/ventas/CarritoPanel.vue`,
  Salones `pages/salones/index.vue`, Tienda `components/tienda/CarritoOnline.vue`)
  — los tres renderizan el componente compartido `components/AdvertenciasPrecio.vue`:
  por línea con `resultado.lineas[index].advertencias`, junto al total con
  `resultado.advertenciasVenta`. Por cada advertencia el componente muestra el
  ícono de warning + el `titulo` en una sola línea, con un ícono informativo cuyo
  tooltip (alcanzable con teclado, no solo con hover) revela el `detalle`. **El
  cruce línea↔resultado es por índice, nunca por `itemId`**: el mismo ítem puede
  aparecer en dos líneas del carrito con personalizaciones distintas (por
  ejemplo, dos porciones de la misma receta con extras diferentes), y el
  `itemId` no las distingue.
- **Confirmación de la Tienda** (`pages/tienda/pasarela.vue`) — último paso antes de
  "Aprobar pago". Usa `resultado.advertencias`, el **aplanado**, no las dos
  granularidades: esa pantalla no desglosa líneas, así que renderizar
  `lineas[].advertencias` y `advertenciasVenta` por separado duplicaría las de venta.
- **Las suscripciones no previsualizan nada** (decisión del owner, 2026-08-02). El alta
  (`pages/tienda/suscripciones.vue`, dos call sites: `confirmar()` en 229 y
  `reanudarAltaPendiente()` en 260) llama a `crear()`, que cobra por Oneclick en el mismo
  request, y las renovaciones son automáticas: no hay a quién avisarle.
  ⚠️ **La decisión es del owner; la razón NO es que el caso sea imposible.**
  `suscripciones.service.ts:88-91` corre **el mismo motor** y descarta `resultado.advertencias`,
  y `cargarReglasPorIds` (`items.service.ts`) hace `JOIN items` solo para acotar por tenant,
  id y no-borrado — **sin filtro por `tipo`**. O sea que nada impide hoy colgarle un descuento de monto
  fijo a un ítem de suscripción, y ahí el piso en cero sí emitiría advertencia sobre un
  cobro Oneclick irreversible. Lo que sostiene la decisión es un hecho de configuración
  ("hoy ningún ítem de suscripción tiene descuentos"), no una propiedad del código: si eso
  cambia, hay que rediscutirlo.
- ⚠️ **`advertenciasVenta` hoy no se puede ver por la UI.** El render junto al
  total está construido y correcto, pero está inerte: depende de que el request
  mande `descuentosVentaIds`/`recargosVentaIds`, y ningún archivo de
  `frontend/app` los arma ni los ofrece al usuario — los descuentos/recargos a
  nivel venta son superficie de API sin pantalla. No es un defecto, es una
  limitación conocida hasta que exista esa UI (ver `docs/agent/pendientes.md`).

---

## Testing

### Unit Tests (Backend)

```bash
cd backend && npm test            # incluye los specs del motor y del servicio
```

- `calculo-precios.engine.spec.ts` — neto/desbruteo, base vs compuesto, orden de
  fórmula, tramos, método de pago, reglas diferidas, redondeo, nivel venta, y el
  congelado en la traza (`modo`, `valorEfectivo` incluido el de una regla por
  tramos, `valorSolicitado` de un descuento topeado).
- `calculo-precios.service.spec.ts` — resolución de reglas asociadas vs override,
  errores (regla inexistente, cantidad ≤ 0).

### E2E (Backend)

```bash
./scripts/reset-db.sh && cd backend && npx jest --config test/jest-e2e.json test/calculo-precios.e2e-spec.ts
```

- `calculo-precios.e2e-spec.ts` — descuento `monto_fijo` que supera el monto
  disponible ("Promo fija $5.000", seed): confirma que la advertencia de tope
  aparece en `lineas[].advertencias` cuando el descuento va por línea y en
  `advertenciasVenta` cuando va a nivel venta, sin mezclarse entre sí.
- `ventas.e2e-spec.ts` → "la venta congela la regla aplicada" — el que prueba el
  objetivo: crea una venta con un descuento del 10%, **edita la regla a 20%** (y
  verifica contra el catálogo que el cambio ocurrió) y confirma que la venta
  sigue diciendo 10%. Su gemelo con la regla **borrada**, la misma regla en dos
  líneas atribuida a `detalle_id` distintos, el descuento topeado
  (`valor_solicitado` ≠ `valor_aplicado`) y `config_calculo` en la cabecera.

### Manual (Swagger)

1. `docker-compose up` → http://localhost:3000/api/docs
2. Autenticar con Bearer token.
3. `POST /calculo-precios/calcular` con un ítem del seed → verificar desglose.

---

## Related Features

- [features/preferencias-financieras.md](./preferencias-financieras.md) — fórmula, base/compuesto, redondeo
- [features/descuentos-recargos.md](./descuentos-recargos.md) — reglas, tramos, método de pago
- Catálogo de ítems e impuestos (insumos del motor)

---

## Notes

Primera pieza de la cadena de ventas. El módulo de ventas (por construir)
consumirá este motor para calcular y luego persistir `ventas` / `venta_detalles`
/ `ventas_descuentos`, y para convertir a moneda oficial.
