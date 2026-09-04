# Spec: la nota de crédito descompone su monto

**Fecha:** 2026-09-04
**Estado:** diseño aprobado por el owner — pendiente de plan
**Decisión que implementa:** la del owner del 2026-09-03 (monto suelto permitido, expresado
como **línea de ajuste con glosa libre**), más las cuatro respuestas del 2026-09-04 que abajo
se citan por su nombre.
**Entrada de backlog:** `docs/agent/pendientes.md` § 3, *"La nota de crédito descompone su
monto — con línea de ajuste y glosa libre"*.
**Investigación que la sostiene:**
[`2026-08-22-descomposicion-nota-credito.md`](../../agent/investigaciones/2026-08-22-descomposicion-nota-credito.md)
y [`2026-09-03-facturacion-electronica-latam.md`](../../agent/investigaciones/2026-09-03-facturacion-electronica-latam.md)
**Materia fiscal:** este frente va solo, con su propia sesión y su propia verificación
(`CLAUDE.md` → *"Lo fiscal va solo"*, **ADR-010**).

---

## 1. El problema, medido

`crearNotaCreditoEnTransaccion` (`ventas.service.ts:1361`) construye la fila de `ventas`
**a mano** —no por `crearEnTransaccion`— y hardcodea:

```ts
totalBruto: params.monto,
totalDescuentos: '0',
totalRecargos: '0',
totalImpuestos: '0',
totalFinal: params.monto,
```

Tres consecuencias, todas verificadas en el código el 2026-09-04:

1. **La NC no declara impuesto.** `total_impuestos = 0` sobre un monto que sí lo lleva
   adentro. Es el hueco fiscal: la nota corrige un documento con IVA y no dice cuánto de lo
   que devuelve era IVA.
2. **`total_bruto` guarda el bruto**, cuando en toda venta normal esa columna guarda el
   **neto** (`crear` escribe `totalBruto: resultado.totales.subtotalNeto`,
   `ventas.service.ts:606`). La misma columna significa dos cosas según quién la escribió.
3. **`base_ventas_total_final` y `base_ventas_sin_impuestos` quedan en `0`** — la NC no las
   escribe. Medido a quién le pega: **no** a propinas (lee esas columnas por `venta_propina`,
   y una NC no tiene filas ahí, `liquidacion-propinas.service.ts:1160-1180`); **sí** a
   `GET /ventas/:id`, que las devuelve tal cual (`ventas.service.ts:2376`).

Y hay una cuarta, que aparece recién cuando las líneas empiezan a importar:

4. **La línea de devolución ignora el descuento que el cliente recibió.** Hoy se valúa a
   `precio_unitario × cantidad` del detalle original, que es el precio de lista congelado, no
   lo que esa unidad efectivamente costó en esa boleta. Hoy no rompe nada porque el
   `total_final` de la NC es `params.monto`, independiente de las líneas. Con las líneas
   sumando el total, sí rompe.

## 2. Por qué la forma elegida es la línea de ajuste

Resuelve tres cosas que ningún otro camino resolvía junto (detalle en la entrada de backlog):

- **Chile**: la zona Detalle es obligatoria en los diez tipos de documento, NC incluida.
- **Argentina**: `ImpNeto`/`ImpIVA` son obligatorios y ARCA **rechaza** si la suma no cierra
  (error 10048).
- **Inventario**: una línea de ajuste no es un producto del catálogo, así que **no repone
  stock**. Exigir líneas reales habría metido al inventario la pasta que el cliente ya se
  comió.

## 3. Cómo queda compuesta la nota de crédito

### 3.1 Las líneas

Una NC tiene, en este orden:

1. **Las líneas de devolución** — un renglón por ítem que vuelve a stock, como hoy, pero
   valuado a **lo que esa unidad costó en esa venta**, no al precio de lista.
2. **La línea (o las dos líneas) de ajuste** — por lo que queda del monto después de las
   devoluciones.

Y vale, por construcción:

```
Σ total_linea  =  total_final  =  params.monto
```

### 3.2 Cuánto vale una unidad devuelta

Sobre la venta ORIGINAL, para el ítem devuelto:

```
valorUnitarioBruto = Σ total_linea de las filas de ese ítem
                     ─────────────────────────────────────
                     Σ cantidad de esas mismas filas

valorDevuelto = cuantizar(valorUnitarioBruto × cantidadDevuelta)
```

Se promedia sobre todas las filas del ítem porque `validarDevolucionesReembolso` ya agrega así
(`ventas.service.ts:1749`): el mismo ítem puede aparecer en dos líneas con personalizaciones
distintas, y la devolución no dice de cuál de las dos viene.

`total_linea` es bruto y ya lleva adentro el descuento de línea, el recargo, **y la parte
prorrateada del descuento de nivel venta** (`ajuste_venta`) — esa identidad está declarada en
el docblock de `venta-detalle.entity.ts:116` y es lo que hace que este promedio sea "lo que el
cliente pagó por esa unidad" y no una aproximación.

### 3.3 Cuánto va a la línea de ajuste

```
ajusteTotal = params.monto − Σ valorDevuelto
```

- `ajusteTotal < 0` → **400** (ver § 6.1).
- `ajusteTotal = 0` → **no se crea línea de ajuste**. La NC son sus devoluciones y nada más.
- `ajusteTotal > 0` → se reparte entre las porciones afecta y exenta (§ 3.4).

### 3.4 El reparto afecto/exento

**La base NO es la venta entera: es lo que queda por devolver.** Si ya hubo notas de crédito
antes, repartir sobre la venta original completa reparte de más sobre un balde ya devuelto. Es
el mismo criterio del tope de reembolso, que ya existe y ya descuenta las NC previas bajo el
lock.

Para cada porción `P ∈ {afecto, exento}`:

```
restante_P = Σ total_linea de la venta original en P
           − Σ total_linea de las NC previas de esa venta en P
           − Σ total_linea de las líneas de devolución de ESTA nota en P
```

⚠️ **El tercer término se agregó al implementar (2026-09-04)**, y no es un detalle: la
mercadería que esta misma nota devuelve tampoco está ya "por devolver". Sin él, el ajuste puede
acreditar de una porción **más de lo que esa porción tenía** —medido: devolver las 7 unidades
afectas de 8.330 acreditando 9.000 dejaba 493 de ajuste sobre la porción afecta— y la nota
**siguiente** arranca con `restante_P` negativo: una línea de nota de crédito con importe e
impuesto en negativo, y un `total_impuestos` que ninguna fila de `ventas_impuestos` reproduce.
Detrás del descuento queda un piso en cero como red, no como regla.

y entonces:

```
partes = repartirProporcional(ajusteTotal, [restante_afecto, restante_exento], cfg, q)
```

- **Nada de líneas en cero.** Una parte que da `0` —porque la venta era toda afecta, o porque
  el redondeo dejó vacío un balde chico— no se escribe. Con la venta toda afecta o toda
  exenta sale **una sola** línea.
- **El residuo** lo resuelve `repartirProporcional`: resto más grande, desempate por posición.
  No se inventa un criterio nuevo.
- Una NC vieja sin líneas aporta `0` a `restante_P`. No hay datos productivos y el entorno se
  resetea, así que no existe ese caso; queda escrito para que no se lea como olvido.

### 3.5 Qué se persiste por línea

Cada línea de la NC —de devolución o de ajuste— se escribe con `descuento_aplicado`,
`recargo_aplicado` y `ajuste_venta` en **cero**: la NC no vuelve a correr las reglas, el monto
que acredita ya viene neto de ellas. Con esos ceros, la identidad de la fila queda:

```
subtotal + impuesto_aplicado = total_linea
```

| Campo | Línea de devolución | Línea de ajuste |
|---|---|---|
| `item_id` | el ítem devuelto | el ítem de sistema "Ajuste" (§ 4) |
| `descripcion` | la del detalle original | la **glosa**: `comentario` de la NC, o `'Ajuste'` si vino vacío |
| `clasificacion_tributaria` | la del detalle original | `'afecto'` o `'exento'` según la porción |
| `precio_unitario` | `valorUnitarioBruto` (§ 3.2) | `total_linea` (cantidad 1) |
| `cantidad` | la devuelta | `1` |
| `unidad_codigo_base` | la del detalle original | `'unidad'` — lo que `resolverUnidadBaseDeItem` devuelve para un servicio sin `unidad_medida` |
| `subtotal` | el neto acreditado (§ 5) | el neto acreditado (§ 5) |
| `impuesto_aplicado` | el impuesto acreditado (§ 5) | el impuesto acreditado (§ 5) |
| `total_linea` | `valorDevuelto` | su parte del reparto |

⚠️ `precio_unitario` de la línea de devolución **cambia de significado** respecto de hoy: pasa
del precio de lista al valor efectivo por unidad. Es deliberado, y es lo que hace que
`precio × cantidad = total_linea` se lea en el documento sin una resta mental.

### 3.6 Los totales de la cabecera

Dejan de ser constantes y se **derivan de las líneas**:

```
total_bruto      = Σ subtotal            (el neto, igual que en una venta normal)
total_impuestos  = Σ impuesto_aplicado
total_final      = params.monto          (sin cambio: es el que topea contra el disponible)
total_descuentos = '0'                   (sin cambio)
total_recargos   = '0'                   (sin cambio)
base_ventas_total_final    = total_final
base_ventas_sin_impuestos  = total_final − total_impuestos
```

Las dos `base_ventas_*` se calculan igual que en `crear` (`ventas.service.ts:592-611`). La NC
copia `moneda_id` de la venta original, que ya es la moneda oficial, así que no hay conversión
que hacer.

## 4. El ítem de sistema "Ajuste"

`venta_detalles.item_id` es **NOT NULL**: la línea de ajuste necesita colgar de algún ítem.

- **Tipo `servicio`**, nunca `producto`: en este sistema solo `tipo='producto'` tiene stock.
- **`activo: false`**, para que no aparezca en el selector del POS — mismo truco que la fila
  de nota de crédito en `tipos_documento_tributario`.
- **Se marca con una columna, no con el nombre.** `items` gana `es_ajuste_nota_credito`
  (boolean, default `false`) más un índice único parcial por tenant:

  ```
  uq_item_ajuste_nc_tenant  UNIQUE (tenant_id)
    WHERE es_ajuste_nota_credito = true AND eliminado_el IS NULL
  ```

  Buscarlo por nombre sería frágil y el nombre es editable. La columna es el mismo patrón que
  `tipos_documento_tributario.es_nota_credito` y que `garzones.es_placeholder`, y el índice
  parcial es el mismo que `uq_tipo_documento_nota_credito_pais`: con dos filas marcadas, cuál
  se usa dependería del orden que elija el planner.
- **Find-or-create**, con la firma y la forma de `GarzonesService.asegurarMostrador`
  (`garzones.service.ts:1426`): se siembra al crear el tenant, junto al rol admin, la fórmula
  de precio y la caja virtual, **y además se asegura dentro de la transacción de la NC**.

  Ese segundo llamado no es redundancia: el camino del webhook de reembolso (decisión P3) **no
  puede fallar** por un dato de configuración faltante, porque la plata ya volvió por el
  proveedor y el evento se perdería. Con find-or-create, un tenant sin el ítem se cura solo en
  vez de rechazar.
- **Seed:** ID fijo `550e8400-e29b-41d4-a716-446655440381` (el siguiente libre; el último usado
  es `…440380`, la NC interna de México).
- `clasificacion_tributaria` del ítem: `'afecto'`. No la usa nadie —la línea escribe la suya
  explícita, § 3.5— pero la columna tiene default y dejarla en `NULL` diría "no se vende",
  que no es el caso.

## 5. De dónde sale el IVA

**Del documento que se corrige, no del catálogo de hoy.** El código ya declara ese criterio
para el redondeo (*"La NC corrige aquel documento: hereda su criterio, no el vigente"*,
decisión g) y acá vale igual.

No se puede leer una tasa única del catálogo porque **`item_impuestos` es por ítem**: dos
líneas afectas de la misma venta pueden llevar impuestos distintos. Así que la tasa se
**deriva de los importes ya congelados**.

Para cada porción `P` de la venta ORIGINAL:

```
imp_P  = Σ impuesto_aplicado  de las líneas de P
neto_P = Σ (total_linea − impuesto_aplicado) de las líneas de P
r_P    = imp_P / neto_P        (0 si neto_P = 0)
```

Y para una línea de la NC con bruto `A` en la porción `P`:

```
neto     = cuantizar(A / (1 + r_P))
impuesto = A − neto
```

El impuesto sale **por resta**, no por `tasa × neto`. Es el mismo anclaje que usa el motor
cuando el paso de impuestos es el último que mueve plata (`calculo-precios.engine.ts`, el
comentario del ancla): garantiza `neto + impuesto = A` exacto, sin depender de que la división
cierre.

Para la porción exenta, `r_P = 0` y la línea va con impuesto `0` — que es el punto de tener la
clasificación explícita, no la ausencia de impuesto (invariante 5 de `CLAUDE.md`).

**La tasa se deriva de la venta original entera, no del remanente.** Las NC hijas se componen
con esta misma regla, así que la tasa no se mueve a medida que se emiten; el remanente decide
la **proporción** (§ 3.4), no la tasa.

### 5.1 Las filas de `ventas_impuestos`

La NC escribe sus impuestos a nivel línea (`aplicado_en = 'detalle'`, `detalle_id` = la línea
de la NC). No reproduce filas `aplicado_en = 'venta'`: todos sus impuestos cuelgan de una
línea.

Por cada línea de la NC con `impuesto_aplicado > 0`, una fila por cada impuesto distinto que la
venta original cobró en esa porción (para una línea de devolución: los de las filas de ese
ítem). Cada fila hereda `impuesto_id`, `nombre_regla` y `porcentaje_aplicado` congelados del
original, y su `valor_aplicado` sale de repartir el impuesto de la línea entre esos impuestos
**en la proporción que tenían en el original**, con el mismo `repartirProporcional` — así la
suma de las filas es exactamente el `impuesto_aplicado` de la línea.

⚠️ Con **un solo impuesto** —el caso normal, y el único que hoy tiene el seed— esto es trivial
y `porcentaje_aplicado × subtotal = valor_aplicado` cierra exacto. Con dos impuestos repartidos
entre líneas que no los comparten, los **importes** siguen siendo fieles a la venta pero el
porcentaje de la fila describe la regla, no reproduce su propio importe. Va escrito en el
docblock: es el precio de derivar de hechos congelados en vez de recalcular con el catálogo.

## 6. Lo que se rechaza, y lo que no

### 6.1 Devolver más mercadería que plata → 400

⛔ **REVERTIDA POR EL OWNER EL 2026-09-04**, el mismo día, y **ya reemplazada por código**. Al ver
que el camino de la pasarela no puede aplicarla dijo *"la decisión del mostrador la tomé mal"*, se
corrió una investigación de mercado, y con sus resultados —**el SII acepta la nota por monto**
(cantidad y precio unitario son condicionales en la Zona Detalle de una NC) y **de 11 productos
relevados solo Lightspeed rechaza**— la regla quedó al revés: **se acepta**, las líneas se escalan
a prorrata y el motivo pasa a ser obligatorio, con la opción de reponer o no el stock por línea.

📌 **Lo de abajo es historia: describe lo que este frente construyó, no lo que el sistema hace.**
La conducta vigente está en
[`features/reembolsos-nota-credito.md`](../../features/reembolsos-nota-credito.md); el frente que
la reemplazó, en
[`2026-09-04-devolucion-con-credito-parcial-design.md`](2026-09-04-devolucion-con-credito-parcial-design.md);
la evidencia, en
`docs/agent/investigaciones/2026-09-04-devolucion-con-credito-parcial.md`.

**Decisión del owner, 2026-09-04.** Escena: el cliente devuelve 2 empanadas que en esa boleta
costaron $3.000, y se le acredita $1.000.

```
Σ valorDevuelto > params.monto                     →  400   (solo en el camino MANUAL)
Σ valorDevuelto en P > restante_P (previo a esta nota)  →  400   (ídem)
```

⚠️ **El segundo corte se agregó al implementar (2026-09-04)** y no estaba en la spec. El tope
global mira el bruto y no ve la porción fiscal: una nota por monto libre se come capacidad
**afecta**, y la devolución siguiente —valuada a su valor congelado— la vuelve a usar. Cada
documento cierra bien por separado y **la serie acredita más IVA del que la venta cobró**.
Medido con las funciones reales: venta de 8.330 afecto (IVA 1.330) + 3.000 exento, una nota
libre de 1.000 y otra que devuelve las 7 unidades ⇒ **1.447 de IVA acreditado contra 1.330
cobrado**.

El corte por porción cierra esa fuga —**medido: 0 violaciones de `Σ bruto acreditado por porción
≤ el original` en 16.000 secuencias de hasta 4 notas**— pero **no la hace imposible en el IVA**, y
conviene no escribirlo así. Cada nota descompone su propio bruto y cuantiza a la escala de la
moneda, así que partir un mismo bruto en varios documentos acumula residuo: sobre 100.000 series,
el **12,15 % acredita 1 o 2 minor units de IVA de más**, con **2 como techo medido**. No escala
con el monto —lo acota la cantidad de notas, no la plata—. Sacarlo exigiría derivar el neto de
cada nota contra el remanente de la serie en vez de contra su propio bruto: **decisión del owner,
no la toma el agente**.

Dos costos del corte, los dos medidos:

- Una devolución legítima después de una nota por monto libre puede quedar topeada; el mensaje
  dice cuánto queda por acreditar y ofrece la vuelta a stock desde Inventario.
- **La última unidad de un ítem cuyo valor unitario no divide exacto puede no entrar.** Con
  `total_linea` 1.001 en 3 unidades, cada unidad vale 334 cuantizado: la tercera pide 334 contra
  333 que quedan. Es 1 minor unit y la mercadería vuelve igual desde Inventario, pero el operador
  lo ve como un rechazo, así que el mensaje **no** lo atribuye solo a notas anteriores.

⚠️ **Solo en el camino manual** (agregado al implementar, 2026-09-04). Por el webhook de
reembolso el hook corre **después** del commit, con la plata ya devuelta por el proveedor, y un
throw ahí se traga como warning: se perderían la nota **y** el movimiento de stock. Es el mismo
principio de la decisión P3, que la § 4 aplica al ítem de sistema faltante. Así que por ese
camino la nota se emite igual, por el monto que el proveedor devolvió, **con las líneas de
devolución fuera del documento** —incluirlas rompería `Σ líneas = total_final`— y el movimiento
de inventario corre sobre **todas** las devoluciones pedidas. Lo que se pierde es el detalle de
qué volvió *en la nota*; queda en `movimientos_inventario`. **Decisión del agente, pendiente de
confirmación del owner:** la alternativa es dejar el 400 también ahí y aceptar perder el evento.

Mensaje, en lenguaje de mostrador: que lo devuelto vale más que la nota, con los dos números, y
que para devolver el stock sin acreditarlo todo van dos operaciones — la NC por su monto, y la
vuelta a stock desde Inventario.

Se valida **dentro de la transacción**, después del lock de la venta original y del tope
contra `disponible`, porque necesita los `total_linea` congelados.

### 6.2 La trampa del inventario

`crearNotaCreditoEnTransaccion` llama a `registrarMovimiento` **por cada línea**, y ese método
rechaza con 400 *"El item no tiene control de stock"* cualquier ítem que no sea producto
(`inventario.service.ts:165`, el guard después del `SELECT … FOR UPDATE OF ip`). La línea de
ajuste lo dispararía y **haría fallar el reembolso entero**.

El movimiento corre **solo sobre las líneas de devolución**, que son las únicas que pueden ser
producto: `validarDevolucionesReembolso` ya rechaza servicios y los modos `serie`/`lote` antes
de tocar inventario. La línea de ajuste no entra a ese loop **por decisión escrita en el
código**, no porque no llegue.

⛔ **La segunda mitad se derogó el 2026-09-04, igual que el § 6.1.** Hoy
`validarDevolucionesReembolso` rechaza **solo si se PIDIÓ** reponer lo que no puede, así que las
líneas de devolución ya NO son "las únicas que pueden ser producto": una receta o un servicio se
acreditan por línea sin volver al stock. Lo que sigue en pie es la primera mitad —el corte que
mantiene la línea de ajuste fuera del loop—, ahora expresado como un filtro por `reponeStock`.
Conducta vigente en
[`features/reembolsos-nota-credito.md`](../../features/reembolsos-nota-credito.md).

### 6.3 Sin `config_calculo` congelada

Solo alcanzable por el webhook (decisión P3, el camino manual falla ruidoso antes). Se
conserva el fallback que ya existe: cuantizar con `toDecimalPlaces(4, HALF_UP)` en vez de la
escala de la moneda, para no perder el evento. Aplica igual al reparto y a la descomposición.

## 7. `repartirProporcional` se exporta, no se muda

La regla de reparto con residuo por mayor resto está escrita **dos veces** en el repo, y esta
sería la tercera:

- `repartirProporcional` (`calculo-precios.engine.ts:1540`) — privada, cuantiza a la escala de
  la moneda. **Es la que necesita la NC.**
- `repartirDescuentoCombo` (`promociones.evaluator.ts:449`) — sin cuantización.

**Decisión del owner, 2026-09-04: se le agrega `export` donde está, y ventas la importa.** No
se muda a un módulo común.

El motivo es un hecho que apareció al medir: `ventas.service.ts` **ya importa tres cosas del
motor** —el tipo `ConfigCalculo`, `TrazaRegla` y la función `cuantizar`
(`ventas.service.ts:12-16`)— y `cuantizar` no tiene ningún otro importador fuera del motor.
Sacar solo el reparto a un módulo nuevo lo obligaría a importar `ConfigCalculo` de vuelta del
motor: más cableado, y dos hogares para la misma familia de funciones. La mudanza completa
—`cuantizar` + `ConfigCalculo` + el reparto— es un frente propio del motor, y `CLAUDE.md`
pide tomar el motor solo y con el sistema quieto.

⚠️ **Las dos copias NO son intercambiables**, aunque el docblock de `repartirDescuentoCombo`
diga *"mismo idioma"*: desempata por **parte fraccionaria** (`f − floor(f)`), y la del motor
por **resto contra la parte cuantizada** (`|f − parte|`). Unificarlas cambiaría el reparto de
las promociones. `repartirDescuentoCombo` se queda donde está; su docblock gana un puntero a
esta diferencia, para que el próximo no la unifique de memoria.

## 8. Qué cambia en la pantalla

**Alcance elegido por el owner el 2026-09-04:** el desglose también se muestra.

La buena noticia, verificada: `VentaDetalleDrawer.vue` **ya** arma la tabla de líneas con sus
reglas congeladas (`filasDetalle`, línea 479) y la fila "Impuestos" del total (línea 887), todo
desde `GET /ventas/:id`. Con el backend escribiendo bien las líneas y sus `ventas_impuestos`,
la nota de crédito pasa a mostrarse sola.

Lo que queda por hacer del lado del frontend es **verificarlo y ajustar lo que chirríe**, no
construir una vista nueva:

- Abrir una NC en el drawer y comprobar que las líneas, el impuesto y los totales se ven.
- La glosa se lee en la columna de descripción de la línea de ajuste — el modal ya tiene el
  campo `comentario` con placeholder *"Motivo de la devolución"*
  (`NotaCreditoModal.vue:112`), así que **no hay campo nuevo**.
- Si algún rótulo asume "venta" donde ahora se lee una NC, se corrige ahí.

Si al verificar aparece algo que pide más que un rótulo, se anota y se decide — no se agranda
el frente por dentro.

## 9. Qué NO entra

- **Emisión al SII / ARCA / DIAN / SAT.** Este frente congela el hecho fiscal; transmitirlo es
  ADR-010 y llega después.
- **La mudanza de `cuantizar`/`ConfigCalculo` a un módulo común** (§ 7).
- **Unificar `repartirDescuentoCombo`** (§ 7).
- **Tocar `crearEnTransaccion`** ni el motor de precios más allá del `export` de § 7.
- **Backfill de NC viejas.** No hay datos productivos: se cambia el esquema, se actualiza el
  seeder y se resetea.

## 10. Verificación

Además del gate completo de `CLAUDE.md` (backend `lint:check` + `typecheck` + `test` +
`test:e2e`, frontend `build` + `test` + `typecheck:ratchet` + `design:check`), este frente pide
pruebas propias:

**Unitarias** — la descomposición, con fixtures que **discriminen**: tasas distintas de 0 y de
1, y proporciones que no sean 50/50.

1. Venta toda afecta → una sola línea de ajuste, `neto + impuesto = monto` exacto.
2. Venta toda exenta → una sola línea, impuesto `0`.
3. Venta mixta → dos líneas, en la proporción del remanente, y `Σ total_linea = monto`.
4. Venta mixta con una NC previa → la proporción sale del **remanente**, no de la venta
   original. (Este es el test que muere si alguien reparte sobre la venta entera.)
5. Reparto que no divide exacto → el residuo va a la parte de mayor resto, y la suma cierra.
6. Un balde que redondea a cero → **no** se escribe esa línea.
7. Devolución + ajuste → las líneas suman el monto.
8. Devolución que vale más que el monto → 400. ⛔ Revertido el 2026-09-04: hoy se escala (§ 6.1).

**E2E** — el camino de la app, no SQL directo:

9. NC manual desde el detalle de una venta mixta: `GET /ventas/:id` devuelve las líneas, sus
   impuestos y los totales derivados; `base_ventas_*` dejan de ser `0`.
10. NC con devolución de un producto: se crea el movimiento de inventario **de la línea de
    devolución** y **no** falla por la línea de ajuste.
11. NC vía reembolso de pasarela sobre un tenant al que se le borró el ítem "Ajuste": la NC
    sale igual (find-or-create), no se pierde el evento.

**Mutantes** — cada uno tiene que **revertir al código anterior**, no solo romper:

- Volver `totalImpuestos` a `'0'` → cae el test 1.
- Repartir sobre la venta original en vez del remanente → cae el 4.
- Sacar el filtro de "solo productos" del loop de inventario → cae el 10.
