# La devolución se acredita por línea, reponga o no el stock

**Diseño aprobado por el owner el 2026-09-04.** Sale de
[`pendientes.md` § 3](../../agent/pendientes.md) y de la investigación de mercado
[`2026-09-04-devolucion-con-credito-parcial.md`](../../agent/investigaciones/2026-09-04-devolucion-con-credito-parcial.md),
que relevó 11 productos y la normativa chilena.

⛔ **Materia fiscal**: este frente va solo, con su propia sesión y su propia verificación
(`CLAUDE.md`, **ADR-010**).

---

## 1. El problema, en una escena

Un cliente devuelve 2 empanadas que en esa boleta costaron **$2.380** y se le acreditan
**$500** — por cargo de reposición, porque volvieron dañadas, o porque el encargado acordó ese
monto. Hoy el sistema **lo rechaza con 400** en el mostrador, y por la pasarela lo acepta
dejando las líneas fuera del documento. Dos conductas para el mismo hecho.

Y hay un problema más grande atrás: **82 de los 193 ítems vendibles del tenant demo no se
pueden acreditar por línea** —44 recetas, 26 servicios, 11 combos, 1 suscripción—, porque
`validarDevolucionesReembolso` los rechaza por no tener fila de stock. Un cliente que se queja
de una pizza no puede ver *"Pizza grande"* en su nota de crédito: cae al balde genérico de
ajuste.

### 1.1 Por qué el rechazo se cae

| Lo que se creía | Lo que dice la evidencia |
|---|---|
| La norma exige que la nota refleje la mercadería | **No.** En la Zona Detalle de una NC solo `NroLinDet`, `NmbItem` y `MontoItem` son obligatorios; **cantidad y precio unitario son condicionales** |
| El SII valida esta consistencia | **No.** Cinco causales cerradas de rechazo (Res. Ex. SII N°45/2003, resolutivo Cuarto N°12), ninguna sobre el detalle |
| El mercado rechaza este caso | **Casi nadie.** De 11 productos, solo Lightspeed X lo prohíbe en el camino ligado — y su escape lo habilita el fabricante |
| Rechazar protege el documento | **No.** Medido: el documento sale idéntico se acepte o se rechace |
| Rechazar protege el estado | **No.** Medido: `PATCH /items/:id/stock` con `motivo: 'devolucion'` devuelve 200 |

📌 **Y lo que el rechazo sí rompe está medido:** el hilo de auditoría, porque empuja al operador
a una vuelta a stock que queda **sin `venta_id`** — el vínculo que ninguno de los 11 productos
relevados tiene y que nosotros sí.

---

## 2. Las tres decisiones del owner

1. **Se acepta, en los dos caminos.** Se saca el 400 de *"la mercadería vale más que el monto"*.
2. **Motivo obligatorio** cuando lo devuelto vale más que la nota — el patrón de Square y Toast
   (*donde el monto es libre, el motivo es obligatorio*). **Reemplaza a la confirmación modal**,
   que ninguno de los 11 productos usa.
3. **Cualquier ítem vendido se acredita por línea, reponga o no el stock**, con la reposición
   elegible. Es el `restock_type` de Shopify y el *"Select items to restock or Skip this step"*
   de Square.

Y una cuarta, recomendada por el agente y aceptada: **el tope por porción fiscal sobrevive como
rechazo** (§ 6).

---

## 3. `devoluciones` cambia de significado

Hoy son *"ítems a devolver a stock"*. Pasan a ser **"ítems que se acreditan por línea"**, con la
reposición como una propiedad de cada uno.

```ts
export class DevolucionNotaCreditoDto {
  @IsUUID()
  itemId: string;

  @IsNumberString()
  cantidad: string;

  /**
   * ¿Vuelve al stock? Ausente = `true` para lo que puede reponer, que es la
   * conducta de hoy. Para lo que no puede (§ 3.1) se ignora si viene `false` y
   * se rechaza si viene `true`, para no confirmar en silencio algo que no pasó.
   */
  @IsOptional()
  @IsBoolean()
  reponerStock?: boolean;
}
```

⚠️ **El cambio de significado es lo caro de esta tarea, no el campo.** Toda la validación de
`validarDevolucionesReembolso` está escrita bajo el supuesto *"esto va a mover stock"*, y ese
supuesto deja de valer para la mayoría de los ítems.

### 3.1 Quién puede reponer

| Tipo de ítem | Se acredita por línea | Repone stock | Qué pasa si piden `reponerStock: true` |
|---|---|---|---|
| `producto`, `modo_inventario = 'cantidad'` | ✅ | ✅ **default** | Se repone |
| `producto`, `modo_inventario = 'serie'` o `'lote'` | ✅ | ❌ | **400** con el mensaje que ya existe: la reposición se registra desde Inventario, donde se elige la serie o el lote |
| `receta`, `combo`, `servicio`, `suscripcion` | ✅ | ❌ | **400**: no maneja stock |

**El default es reponer** solo donde hoy ya se repone: un `producto` por cantidad sin flag se
comporta exactamente como antes de esta tarea. Para todo lo demás el default es no reponer,
porque no hay stock que mover.

📌 **Los dos mensajes de rechazo de hoy no se tiran: cambian de disparador.** Hoy los tira el
solo hecho de nombrar el ítem; pasan a tirarlos únicamente pedir que reponga. El texto sirve
igual y ya tiene e2e.

### 3.2 Lo que esto abre, y es deliberado

Acreditar por línea una **receta** o un **combo** es el caso más común de un restaurante y hoy
es imposible. Con este cambio, la nota de crédito de una pizza dice *"Pizza grande"* en vez de
*"Ajuste"*. Ese es el valor principal de la tarea, más que el caso del crédito parcial que la
originó.

---

## 4. Una sola fórmula para los dos casos

El monto de la nota lo decide la persona; lo que el sistema decide es **cómo se reparte entre
las líneas**.

```
valorDevuelto = Σ q(valorUnitarioBruto_i × cantidad_i)      (como hoy)
factor        = min(1, monto / valorDevuelto)                (1 si valorDevuelto = 0)

líneas de devolución = repartirProporcional(
                          q(valorDevuelto × factor),
                          [valor_1, valor_2, …],
                          cfg, q)
ajusteTotal   = monto − Σ líneas de devolución
```

- **Si lo devuelto entra en el monto** (`factor = 1`): las líneas van a su valor real y el resto
  sale como ajuste. **Es exactamente la conducta de hoy** — esta tarea no la toca.
- **Si no entra** (`factor < 1`): las líneas se escalan para sumar el monto y `ajusteTotal = 0`.
  La glosa obligatoria (§ 5) explica por qué la línea vale menos que la mercadería.

⚠️ **El escalado usa `repartirProporcional`, no una división por línea.** Con dos ítems
devueltos y un factor que no divide exacto, dividir cada línea por separado deja la suma
corrida; el reparto proporcional cierra exacto y desempata con la regla que el motor ya usa.
Es el mismo criterio que la nota ya aplica para el ajuste afecto/exento.

📌 **Por qué las líneas se escalan en vez de ir a su valor real con un ajuste negativo:** la
línea negativa se descartó por dos razones independientes — **ningún POS la usa** (solo SAP y
PeopleSoft entre los ERP) y **el DTE no tiene un campo con esa semántica**; lo más cercano es un
descuento global con una glosa libre de 45 caracteres.

### 4.1 El orden importa, y hay que fijarlo

Las tres cosas dependen unas de otras, así que el orden **no es libre**:

1. **Valuar** cada devolución a su valor congelado (`valorUnitarioBruto × cantidad`, cuantizado).
2. **Calcular el factor** y **escalar** las líneas con `repartirProporcional`.
3. **Sumar el crédito por porción** a partir de las líneas **ya escaladas** — no de los valores
   crudos — y recién ahí aplicar el tope de la § 6.
4. **Repartir el ajuste** (`monto − Σ líneas`) sobre los remanentes **descontando lo que estas
   líneas ya acreditan**, como se hace hoy.

⚠️ **El paso 3 va después del 2 a propósito.** Si el tope se evaluara sobre los valores crudos,
rechazaría casos que el escalado deja perfectamente dentro de la porción: devolver $2.380 de
empanadas acreditando $500 asigna **$500** a la porción afecta, no $2.380.

### 4.2 Lo que se pierde, dicho de frente

Con `factor < 1`, **el documento deja de decir cuánto valía la mercadería**. Square resuelve lo
mismo guardando los dos números en campos distintos (`return_amounts.total_money` ≠
`refunds[].amount_money`), y nosotros no podemos: nuestras líneas tienen que sumar
`total_final`.

**Esa exigencia es decisión nuestra, no requisito fiscal** — el SII pide que `MntTotal` cuadre
con neto + exento + IVA, no que las líneas reflejen la mercadería. Se deja anotado porque es la
restricción de la que nace todo el conflicto, y porque **el dato no se pierde del todo**: la
cantidad devuelta queda en `movimientos_inventario` con su costo congelado, atada a la nota.

---

## 5. El motivo, obligatorio cuando la línea vale menos

Cuando `factor < 1`, `comentario` deja de ser opcional: sin él, **400**.

No se valida en el DTO —depende de la venta, que el DTO no conoce— sino en el service, junto al
cálculo del factor.

**Y mejora el documento**: esa glosa ya viaja como `descripcion` de las líneas de la nota, así
que el papel queda explicando por qué se acreditó menos. Es exactamente para lo que el DTE deja
un campo de texto libre.

### 5.1 El frontend pregunta, el backend exige

⚠️ **El navegador NO puede decidir esto con exactitud**, y ya nos pasó: replicar la
cuantización del motor en el frontend fue un error medido el 2026-09-04 —bloqueaba notas que el
backend acepta y mostraba *"vale $333, más que los $333"*—.

La regla acá: **el frontend pide el motivo cuando su cuenta aproximada da `valorDevuelto ≥
monto`**, y el backend es el que exige. La asimetría es deliberada y benigna: pedir un motivo un
peso antes de tiempo no molesta a nadie; **no pedirlo y comerse un 400 sí**. Por eso `≥` y no
`>`.

📌 Nunca deshabilita el botón. El único guard es el del backend (invariante 6 de `CLAUDE.md`).

---

## 6. El tope por porción sobrevive, y es el único rechazo que queda

**Escena:** venta de $11.330 — $8.330 en empanadas afectas y $3.000 de delivery exento. Ya se
emitió una nota de $1.000 que se llevó $735 de la parte afecta. Ahora se devuelven las 7
empanadas y se quieren acreditar $8.330, pero de esa porción **solo quedan $7.595**.

```
Σ crédito asignado a la porción P  ≤  Σ total_linea original en P − Σ ya acreditado en P
```

**Se rechaza con 400**, diciendo cuánto queda. Tres razones:

1. **El sistema no le cambia la plata al operador.** Acreditar $7.595 cuando pidió $8.330 es una
   decisión de dinero tomada en silencio. Acá el servidor calcula el precio de una línea; el
   monto de la nota lo decide la persona.
2. **Este rechazo sí tiene fundamento y el otro no lo tenía.** Sin él, la **serie** de notas
   acredita IVA que la venta nunca cobró — medido: **1.447 contra 1.330**. Y ese error **no se
   ve en el documento**: cada nota cierra bien por separado. Es el criterio de ADR-010.
3. **Es asimétrico en el tiempo.** Relajarlo mañana es una línea; documentos ya emitidos con IVA
   de más no se arreglan.

### 6.1 Y para que casi nunca dispare: el disponible por porción

`GET /ventas/:id` expone **el remanente acreditable por porción fiscal**, ya calculado y
cuantizado por el backend. Va en la cabecera de la venta y no por línea —es un dato del
documento, no del detalle—, con la forma:

```ts
disponibleNotaCredito: {
  total: string;                                  // el tope global de hoy
  porPorcion: { clasificacion: string; monto: string }[];
}
```

⚠️ **`porPorcion` es una lista y no dos campos fijos**: hoy las clasificaciones son `afecto` y
`exento`, pero el resto del modelo ya las trata como dato (`clasificacion_tributaria` es `text`,
no un enum), y ADR-010 anticipa países con más baldes. Dos campos fijos serían la única parte
del sistema que las congela.

El modal lo muestra antes de tipear:

> Disponible para nota de crédito: **$10.330** · con IVA **$7.595** · exento **$3.000**

**El backend calcula, el frontend muestra.** No es duplicar lógica de plata: es el servidor
diciendo el número. Es la diferencia con el guard que se sacó el 2026-09-04, que lo **recalculaba**.

---

## 7. El camino de la pasarela

Por el webhook de reembolso la plata ya volvió por el proveedor y el hook corre **después** del
commit: un `throw` se traga como warning y se perderían la nota **y** el movimiento de stock.

Con este diseño, **ahí ya casi nada rechaza**:

| Caso | Mostrador | Pasarela |
|---|---|---|
| Lo devuelto vale más que el monto | ✅ se acepta, líneas escaladas + motivo obligatorio | ✅ igual, con la glosa que arma el handler |
| Piden reponer algo que no puede | 400 | Se ignora el flag y **no se repone**; el resto sigue |
| Porción agotada | **400** (§ 6) | Las líneas quedan **fuera del documento**, el monto va a ajuste y **el stock vuelve igual** |

La última fila es la conducta que ya existe (`noEntraEnElDocumento`), ahora acotada al único
caso que la necesita.

⚠️ **La segunda fila es nueva y hay que decidirla a propósito**: por la pasarela, pedir reponer
un servicio no puede tirar 400. Se ignora el flag, se acredita la línea igual, y **queda en el
comentario de la nota** que esa reposición no se hizo.

---

## 8. Qué NO cambia

- El **tope global** contra `disponible` (`total_final − Σ NCs previas`).
- La **descomposición neto/IVA** por porción, con la tasa efectiva derivada de los importes
  congelados y el impuesto por resta.
- El **vínculo `movimientos_inventario.venta_id → id de la nota`**, que es lo que esta decisión
  protege y que ninguno de los 11 productos relevados tiene.
- El **costo congelado** de la venta original en el movimiento de inventario
  (`costosDeSalidaPorItem`) — NetSuite advierte que perderlo corrompe el costeo.
- El **fallback sin `config_calculo`** del camino del webhook.
- El **ítem de sistema "Ajuste"** y su find-or-create.

---

## 9. Verificación

### 9.1 Unitarios de la aritmética nueva

El factor y el escalado son puros: entran `Decimal`, salen `Decimal`. Van al módulo que ya
existe (`nota-credito-composicion.ts`), con `decimalesMoneda: 0` — la escala que más residuo
produce.

1. `factor = 1` cuando lo devuelto entra: las líneas conservan su valor real.
2. `factor < 1`: las líneas escaladas **suman exactamente el monto**.
3. Dos ítems devueltos con un factor que no divide exacto: la suma cierra y el residuo va donde
   manda `repartirProporcional`. ⚠️ **Fixture con proporciones desparejas** — con dos ítems del
   mismo valor y un factor que divide exacto, un escalado mal escrito pasa igual.
4. `valorDevuelto = 0`: `factor = 1`, sin división por cero.

### 9.2 e2e — el camino de la app

1. **Se acredita una receta por línea**, que hoy es imposible: la nota dice *"Pizza grande"* y
   **no** se escribe movimiento de inventario.
2. **Producto por cantidad con `reponerStock: false`**: la línea entra al documento y **no** hay
   movimiento.
3. **Crédito parcial**: devolver 2 empanadas de $2.380 acreditando $500 → **201**, una línea de
   $500, sin ajuste, y el movimiento de inventario presente y atado a la nota.
4. **Sin motivo en ese mismo caso** → **400**.
5. **Pedir reponer un servicio** → 400 con el mensaje de "no maneja stock".
6. **Pedir reponer un serializado** → 400 remitiendo a Inventario.
7. **Porción agotada** → 400 diciendo cuánto queda (el caso de la § 6, con sus números).
8. **`GET /ventas/:id` trae el remanente por porción**, y suma el disponible total.

### 9.3 Mutantes

| Mutante | Test que debe caer |
|---|---|
| `factor` sin el `min(1, …)` | "las líneas escaladas suman exactamente el monto" |
| Escalar dividiendo línea por línea en vez de `repartirProporcional` | el caso de dos ítems con factor que no divide exacto |
| El movimiento de inventario corre aunque `reponerStock` sea `false` | "con `reponerStock: false` no hay movimiento" |
| El motivo deja de ser obligatorio con `factor < 1` | "sin motivo → 400" |
| El tope por porción vuelve a no existir | el caso de la § 6 |

⚠️ Cada mutante tiene que **revertir al código anterior**, no solo romper: mutar la línea nueva
prueba que el test la toca; solo revertir prueba que habría cazado el bug.

### 9.4 Y en el navegador

El modal de nota de crédito, en Chrome real: el disponible por porción se ve antes de tipear, la
columna de reponer aparece con su estado por tipo de ítem, y el motivo se pide cuando
corresponde **sin deshabilitar el botón**.

---

## 10. Lo que este frente NO hace

- **No construye el selector de series/lotes** en el modal (decisión del owner): esa reposición
  sigue registrándose desde Inventario.
- **No toca el motor de cálculo de precios.**
- **No construye la validación previa al cobro** en la pasarela — con este diseño deja de hacer
  falta, porque ya casi nada rechaza por ese camino.
- **No resuelve si el cargo por reposición es servicio afecto a IVA o indemnización no gravada.**
  No hay doctrina del SII y **es pregunta del owner o de su contador**; no hace falta para esto,
  pero va a aparecer si algún día el cargo se cobra como tal.
- **No revisa la exigencia `Σ líneas = total_final`**, aunque la investigación mostró que es
  nuestra y no del SII. Queda anotado en la § 4.2 por si algún día conviene.
