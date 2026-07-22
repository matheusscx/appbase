# Análisis: Motor de promociones

**Status**: En análisis (borrador — NO es diseño cerrado ni plan ejecutable)
**Owner**: Cesar Matheus
**Last Updated**: 2026-07-22

> Documento de exploración. Captura el mapa de casos, la investigación de
> mercado, las decisiones ya tomadas y las preguntas abiertas. Cuando el
> esqueleto quede cerrado, se promueve a un `-design.md` y luego a un plan.

---

## Punto de partida

La conversación arrancó por "los grupos modificadores solo dejan agregar
ingredientes" (premisa que resultó **falsa**: el modelo ya soporta opciones
`producto | receta | servicio`, ver `docs/features/grupos-modificadores.md`).
Al buscar casos reales, el usuario apuntó a **promociones** (2x1, promos por
día, precio fijo de combo), que son un problema distinto al de estructura de
producto.

**Objetivo real:** un motor de promociones flexible, reutilizable a futuro en
otros rubros (restaurante, minimarket, retail) cambiando solo las reglas
disponibles.

---

## Los mecanismos son distintos (no mezclar)

| Mecanismo | Ejemplo | ¿Existe hoy? |
|---|---|---|
| **A. Estructura de producto** — grupos modificadores / combos con elección | "elige tu bebida", "elige tu combo" | ✅ (grupos modificadores) |
| **B. Motor de promociones** — descuentos condicionales cross-carrito | "2x1 los martes", "happy hour", "precio fijo combo" | ❌ (foco de este análisis) |

- El **grupo aditivo** (recargo por opción, `precioExtra`) ya existe.
- "Combo como opción de grupo" (elige tu combo) sigue siendo estructura (A) y
  queda como tema aparte — ver `grupos-modificadores.md` / ADR-013.
- **Este documento es sobre (B).**

---

## Casos reales recogidos

- **2x1 de tragos**: ítem con opciones cerveza / ron / tequila; el cliente elige
  2; se cobra **el más caro** (el barato gratis). En el mercado esto es un
  **BOGO** ("descontá el de menor valor"), no un modo de precio de modifier.
- **Promo por día / franja horaria** (happy hour, "solo martes 18–20h").
- **Promo acotada a ciertos ítems/categorías** (solo algunos combos).
- **Precio fijo de combo** (pizza + bebida = $9.990).
- **NxM** general (3x2, 2do al 50%).

---

## Investigación de mercado (Toast / Square / Lightspeed)

Los POS maduros **separan** en dos subsistemas, y tienen los dos:

### A) Modifier groups / option sets / combos
- Combo con elección = bundle + un grupo por cada elección (min/max). **Igual a
  nuestros grupos modificadores.**
- Modos de precio de modifier: *sin cargo* / *precio compartido* / *upcharge
  individual* (= nuestro `precioExtra`) / *price override* (toma el precio propio
  del ítem) / *size & sequence pricing*.
- **Gap nuestro:** hoy solo tenemos "upcharge individual".

### B) Discount / BOGO engine (aplicado al vender)
- BOGO: *Buy Items* + *Get Items* (ítem/grupo, AND/OR), y "el descuento aplica al
  **más barato / más caro / primero**". "De igual o menor valor" = el más barato
  gratis → **es exactamente el "2x1 paga la más cara"**.
- Restricciones por día/hora y scoping por ítem/categoría son **propiedades del
  descuento**, no tipos nuevos.

**Fuentes:** [Toast Modifier Groups](https://support.toasttab.com/en/article/Creating-Modifier-Groups-and-Modifiers-1492803987509),
[Toast Pricing modifiers](https://doc.toasttab.com/doc/platformguide/adminPricingModifierOptions.html),
[Toast BOGO](https://support.toasttab.com/en/article/BOGO-Buy-One-Get-One-Discounts),
[Toast Meal Combo](https://support.toasttab.com/en/article/How-do-I-create-a-customizable-item-bundle-that-guests-can-order-online),
[Square Combos](https://squareup.com/help/us/en/article/8558-create-and-sell-combos),
[Lightspeed Option Sets](https://o-series-support.lightspeedhq.com/hc/en-us/articles/31329530217883-Creating-combo-deals-with-Option-Sets).

---

## Arquitectura objetivo (north star)

Motor **declarativo** (datos, no código-por-promo), módulo **independiente** de
ventas. Estructura propuesta por el usuario:

- **Promoción**: nombre, descripción, estado, vigencia (fecha inicio/fin),
  prioridad, acumulabilidad, máximo de aplicaciones, canales, horario.
- **Condiciones**: una o varias reglas (cantidad, monto, producto, receta,
  categoría, día, hora, medio de pago, mesa, primera compra…) combinadas con
  AND/OR. Determinan **cuándo se activa**.
- **Beneficios**: una o varias acciones (descuento %, descuento fijo, precio
  fijo, producto gratis, NxM, upgrade, envío gratis…).
- **Evaluador**: interpreta condiciones, genera candidatas, **resuelve
  conflictos** (prioridad, exclusión, acumulación) y produce un resultado
  **auditable**.

Flujo del evaluador:

```
Venta → promos activas → filtra fecha → filtra horario → filtra sucursal
     → evalúa condiciones → candidatas → resuelve conflictos → aplica beneficios
     → registra auditoría
```

**Auditoría:** guardar promoción aplicada, regla, monto original, descuento,
usuario, fecha, motivo. **Nunca recalcular una venta histórica.**

---

## Aterrizaje en el proyecto (qué existe vs. especulativo)

Verificado en código el 2026-07-22:

| Dimensión del doc | ¿Existe? | Decisión |
|---|---|---|
| Día / Hora | ✅ (dato de venta) | Incluir |
| Medio de pago | ✅ módulo `metodos-pago` | Incluir |
| Producto / receta / combo / categoría / monto / cantidad | ✅ | Incluir |
| Canales | ⚠️ solo `'fisico' \| 'online'` | Usar esos dos, no inventar Delivery/Web |
| **Sucursales / Locales** | ❌ no existe | **No modelar** |
| **Tipo de cliente / fidelización / primera compra** | ❌ no existe | **No modelar** (es otro proyecto: loyalty) |
| Mesa > N personas | ⚠️ hay `salones`; falta ver si guarda nº de comensales | Verificar antes de prometer |

**Patrón:** tablas genéricas de Condición/Beneficio (tipo + parámetros), pero
**sembrar solo los tipos con caso real y dato existente**. Agregar dimensiones
después = un registro nuevo, no una migración.

### Piezas existentes relevantes
- **`calculo-precios.engine.ts`**: motor de precios **puro/stateless**
  (neto → descuentos → recargos → impuestos → total, con trazas por regla). Ya
  reserva el tipo de regla `promocional` (por fecha) como *deferred* → **hoy
  devuelve monto 0**. La arquitectura ya apuntaba acá.
- **Módulo `descuentos`/`recargos` + `tipos_regla`** (10 tipos, `descuento_tramos`,
  `item_descuentos`): descuentos **definidos pero NO aplicados al vender**
  (`descuentos-recargos.md` → *NOT included (future): aplicación a ventas*).

---

## Decisiones tomadas

1. **`descuentos` y `promociones` conviven**; el motor decide por
   **configuración** cuál/es aplican. No se fusionan a la fuerza.
2. **La representación fiscal queda por configuración / fuera de alcance ahora.**
   No conocemos la realidad SII de cada país y ADR-010 pide no construir
   infraestructura fiscal especulativa.
3. **Consecuencia clave — beneficios como descuento portable:** al no decidir el
   modelo fiscal por país, en **Fase 1 todo beneficio se expresa como un
   descuento (monto o %) con motivo trazable** sobre línea o venta. Colapsa:

   | Beneficio | Se expresa como |
   |---|---|
   | Descuento % / fijo | descuento directo |
   | 2x1 "paga la más cara" | 100% sobre la unidad más barata |
   | Segundo al 50% | 50% sobre la 2ª unidad |
   | 3x2 | 100% sobre la más barata de cada 3 |
   | Precio fijo combo ($9.990) | descuento = (suma de líneas − 9.990) |

   Ventajas: no inventa concepto fiscal de ningún país (un "producto gratis" NO
   es una línea a precio 0 —tributa distinto— sino 100% de descuento); calza con
   la invariante de **congelar el hecho fiscal** (el monto de descuento *es* el
   hecho, auditado por snapshot); **reusa** lo que el motor ya sabe (descuentos
   por línea + trazas). El "cómo se ve en la boleta" queda como formateo futuro.

---

## Insight arquitectónico central

El motor de precios actual es **por-línea** (+ reglas simples a nivel venta).
Pero casi todos los beneficios de promo son **cross-línea / a nivel pedido**
(2x1 mira varias unidades; "compra 2 pizzas → bebida gratis" cruza líneas;
precio fijo combo reemplaza el precio de un conjunto).

→ El **evaluador de promos es una etapa nueva que corre sobre el carrito
entero**, alrededor del motor de precios: detecta combinaciones, marca líneas
afectadas y entrega al motor un resultado (líneas con descuento). **Toca el
motor de precios → zona "detenerse y preguntar" de CLAUDE.md.**

---

## Dos familias de beneficio

- **(A) Descuentan líneas ya pedidas** — %, fijo, 2x1/NxM, 2do al 50%, precio
  fijo combo. Fiscalmente portable. **Candidata a Fase 1.**
- **(B) Reestructuran el carrito** — regala un ítem que el cliente **no** pidió
  (agrega línea), combo automático, upgrade, envío gratis. Otra mecánica
  (el evaluador **agrega/cambia ítems**). **Fase posterior.**

---

## Propuesta de alcance — Fase 1

- Tablas genéricas Promoción / Condición / Beneficio + evaluador cross-carrito.
- Set chico de tipos atados a casos reales: **happy hour %, 2x1/NxM (paga la más
  cara), precio fijo combo**.
- **Solo familia (A)** (descuentos sobre líneas existentes).
- **Solo aplicación automática** (cupón/manual después).
- **Sin** sucursales, fidelización, canales ricos.
- Representación fiscal decidida como "descuento portable" (arriba).

---

## Preguntas abiertas (para cerrar el esqueleto)

1. **¿Fase 1 = solo familia (A)?** ¿O hay un caso (B) —típicamente "regalo una
   bebida que el cliente no tenía en el pedido"— que ya se necesita sí o sí?
2. **Confirmar exclusiones de Fase 1:** sucursales, fidelización, canales ricos,
   cupón/manual → afuera. (Pendiente de confirmación explícita.)
3. **Resolución de conflictos** (prioridad / exclusión / acumulación): definir la
   estrategia mínima de Fase 1 (¿"gana el de mayor descuento"? ¿grupos de
   exclusión?).
4. **Mesa > N comensales:** ¿`salones` guarda nº de personas? (verificar antes de
   ofrecer esa condición).

---

## Relacionados

- `docs/features/grupos-modificadores.md` — estructura (A), no confundir con esto
- `docs/features/descuentos-recargos.md` — reglas definidas, no aplicadas
- `docs/features/motor-calculo-precios.md` — pipeline de precios, punto de integración
- ADR-010 — congelar el hecho fiscal, diferir lo que solo transmite/formatea
- ADR-013 — grupos modificadores (opción combo prohibida hoy)
