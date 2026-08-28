# El costo de una merma no se tipea: sale del producto

**Fecha:** 2026-08-28 · **Tipo:** spec de diseño
**Decisión del owner:** 2026-08-28, en la conversación que siguió a la Task 4 de
[`2026-08-28-ajuste-costo-por-unidad.md`](../plans/2026-08-28-ajuste-costo-por-unidad.md).
**Investigación de origen:** [`docs/agent/investigaciones/2026-08-28-separador-decimal-vs-miles.md`](../../agent/investigaciones/2026-08-28-separador-decimal-vs-miles.md)

---

## 1. Cómo llegamos acá

La Task 4 del plan del ajuste de costo iba a sacarle a `mermas.vue` el prop
`:decimales="4"` del campo de costo. **Paró en el gate del Step 1**, con esto medido:

En `mermas.vue` el selector de unidad es **uno solo y gobierna a la vez la cantidad y el
costo**. Para mermar 100 g de un producto stockeado en kilos hay que elegir gramos, y eso
arrastra el costo a gramos, donde `6500/kg → 6,5/g` no es representable en CLP. Medido
sobre Queso laminado del seed, mismo producto y mismo escenario:

| | campo costo (por g) | `costoUnitario` en el POST | `costoPerdido` |
|---|---|---|---|
| con `:decimales="4"` | `6,5000` | `"6.5"` | $650 |
| sacando el prop | `7` | `"7"` | $700 |

Sobrevaloración del **7,69%**, sin aviso ni error. No es solo display: el POST llevó `"7"`.
El `watch` de `MoneyInput` no emite, pero **maska sí** — al reformatearse `display` dispara
`onMaska → syncFromMaska → emit`, y el modelo queda redondeado. Eso **corrige** el §4 de
[`2026-08-28-costo-por-unidad-elegida-design.md`](2026-08-28-costo-por-unidad-elegida-design.md),
que daba por bueno que el modelo no se truncaba solo.

Y lo peor: **el campo viene prefilleado**, así que ese error de $50 ocurre sin que nadie
toque el campo.

La pregunta del owner que reencuadró el problema: *"¿por qué tiene que tipear el costo? El
cocinero no tiene ni idea del costo."*

## 2. La decisión

> **El costo de los productos se maneja en los productos.** El formulario de merma pide
> cuánto se perdió; el sistema valoriza con el costo del ítem. Si el ítem no tiene costo,
> la merma se registra igual y queda sin valorizar — para siempre.

Cinco reglas, todas del owner:

| # | Regla |
|---|---|
| 1 | La merma de un producto sin costo **se registra igual**, sin valorizar. Nunca se inventa un costo. |
| 2 | Queda sin valorizar **para siempre**: el hecho vale lo que valía cuando pasó, como en las ventas. |
| 3 | **El campo de costo desaparece** del formulario de merma. Se pone la cantidad; el sistema calcula. |
| 4 | Si el producto no tiene costo, **cartel en el formulario que no frena** el registro. |
| 5 | Cuando exista un reporte de mermas, tiene que decir **cuántas quedaron sin valorizar**. |

### 2.1 Lo que la regla 3 se lleva puesto, a propósito

Hoy ese campo cumple **dos** funciones, no una:

- **Obligatoria**, cuando el producto no tiene costo: hoy el backend rebota con 400
  (`mermas.service.ts:159-166`, *"El producto no tiene costo actual; indica costoUnitario
  para valorizar esta merma"*) y el frontend lo empuja con un modal bloqueante.
- **Override opcional**, cuando el producto **sí** tiene costo: el texto de ayuda dice
  *"Prefill con el costo actual; puedes ajustarlo solo para este movimiento."*

**Las dos se van.** La primera porque contradice la regla 1; la segunda porque contradice
la 3 — el owner lo confirmó explícitamente: *"saquemos ese override, que los costos de los
productos se manejen en los productos"*.

### 2.2 Por qué la regla 2 y no la alternativa

La alternativa era valorizar la merma vieja cuando el producto reciba un costo. Se
descartó porque **es un precio que no existía cuando se perdió la mercadería**, y haría que
un número ya mirado cambie después. Es la misma razón por la que la venta congela su precio
y **ADR-010** congela el hecho fiscal en la transacción.

Consecuencia aceptada: *la única forma de que una merma valga algo es cargarle el costo al
producto **antes** de mermarlo.* Después no hay vuelta, y no se construye pantalla de
valorización manual.

## 3. Alcance

**Entra:**

1. `CreateMermaDto` pierde `costoUnitario`. El endpoint deja de aceptarlo.
2. `MermasService.registrar` deja de rebotar por falta de costo; valoriza con `costo_actual`
   y devuelve `costoUnitario`/`costoPerdido` en `null` cuando no hay.
3. `mermas.vue` pierde el campo de costo, su prefill, su modal bloqueante y su alerta;
   gana un cartel no bloqueante cuando el producto no tiene costo.
4. El toast de "merma registrada" contempla el caso sin monto.

**No entra:**

- **Valorización manual posterior** — descartada por la regla 2, no diferida.
- **El reporte de mermas** — no existe hoy (`mermas.controller.ts` tiene solo `GET` listado
  y `POST`; no hay agregación en ningún módulo). La regla 5 queda anotada en
  [`pendientes.md`](../../agent/pendientes.md) para cuando se construya.
- **El `costoUnitario` del movimiento de inventario** (compras, `POST /inventario/movimientos`):
  es otro endpoint y ahí el costo sí lo trae quien compra. No se toca.
- **El barrido de `:decimales="4"` en `items.vue`** y el rechazo de cadenas inválidas en
  `MoneyInput`: siguen siendo frentes propios.

## 4. Lo que este diseño deja peor, y hay que saberlo

Una merma sin valorizar es **invisible en plata**. Hoy no hay total que mienta porque no hay
total; el día que exista, un `SUM(costo_perdido)` que ignore las filas en `NULL` va a
reportar menos pérdida de la real sin decirlo. Por eso la regla 5 no es un adorno: es la
contrapartida de haber elegido congelar.
