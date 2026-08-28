# El costo se tipea en la unidad que uno elige, no en decimales

**Fecha:** 2026-08-28 · **Tipo:** spec de diseño
**Investigación de origen:** [`docs/agent/investigaciones/2026-08-28-separador-decimal-vs-miles.md`](../../agent/investigaciones/2026-08-28-separador-decimal-vs-miles.md)
**Decisión del owner:** 2026-08-28, en la conversación que siguió a esa investigación.

---

## 1. El problema, en una línea

Un campo de costo forzado a 4 decimales sobre un ítem en pesos es el **único** caso
genuinamente ambiguo del sistema: ahí `1.500` significa a la vez `1500` y `1,5`, y el
componente elige una lectura en silencio. Con 0 o 2 decimales no hay ninguna ambigüedad
(medido: 0 casos sobre un corpus de 3332 cadenas).

## 2. La decisión

**No se resuelve la ambigüedad: se saca.**

> **Los inputs de costo siguen los decimales de la moneda del ítem.** La precisión que
> antes daban los decimales la da **elegir la unidad**: se tipea "5.050 por kilo" en pesos
> enteros, no "5,0500 por gramo".

La pregunta del owner que la origina: *"si el costo del ítem es CLP, ¿por qué aceptar
decimales?"*

### 2.1 Por qué es correcta, medido

- **Los decimales del costo no los teclea nadie: los produce el motor.** De 104 productos
  en la base, **2** tienen costo fraccionario, y los dos son promedios ponderados que
  calculó CPP (`56.6667`, `8181.8182`). Ningún humano escribió eso.
- **Los 4 ítems en gramos tienen costo entero** (mínimo `5.0000`/g). Hoy **ningún caso
  medido** exige que una persona tipee un costo fraccionario.
- **El escape ya existe y está construido:** `costoUnitario` significa *"costo por la
  unidad ingresada"*, y el backend lo convierte a unidad base preservando el valor total
  (`common/utils/costo-conversion-unidad.util.ts`). `mermas.vue` ya expone el selector, con
  la etiqueta *"Costo unitario (por {unidad})"*.
- **Cero ítems en UF** (165 CLP, 2 USD). La escala 4 por moneda no está en uso.

### 2.2 Qué NO cambia

**La escala del backend se queda en 4** (`ESCALA_COSTO`, `@EsCosto()`). No es negociable y
no es lo mismo que la escala de captura:

- CPP **genera** fracciones al promediar, se tipeen o no.
- `precioSugerido` devuelve con `.toFixed(4)`; tratarlo como monto cobrado ya rompió la
  bandeja de desfases una vez (medido, comentado en `AplicarDesfaseItemDto`).
- Un costo es una **tasa**, no un monto cobrado: la frontera se cruza en la multiplicación
  (`tasa × cantidad ⇒ monto`), y ahí manda la escala de la moneda.

O sea: **la columna guarda 4 decimales; el teclado humano sigue a la moneda.** La
conversión de unidad es el puente entre las dos.

### 2.3 El único hueco que abre, y cómo se tapa

El **ajuste manual de costo** (`POST /inventario/ajustes-costo`) es hoy el único camino de
costo **sin** selector de unidad: `AjusteCostoDto` no tiene `unidadCodigo`, así que el
número se interpreta siempre en unidad base. Para un insumo en gramos, sin decimales y sin
selector, no habría forma de expresar un costo correcto.

**Se le agrega el selector**, igual que ya lo tienen la merma y la entrada de stock.

⚠️ **Detalle aritmético que hay que respetar:** el ajuste de costo mueve **cantidad 0**, y
`convertirCostoUnitario(cantidadIngresada, costo, cantidadBase)` divide por la cantidad
convertida — con 0 es una división por cero. La conversión que corresponde acá es de
**tasa**, no de operación: se pasa `cantidadIngresada = '1'` y como divisor el factor
`convertirUnidad('1', unidadElegida, unidadBase)`. El util existente sirve tal cual con
esos argumentos; **no se escribe aritmética nueva.**

## 3. Alcance

**Entra:**
1. `AjusteCostoDto` acepta `unidadCodigo` opcional; el service convierte la tasa antes de
   persistir. Sin `unidadCodigo`, el comportamiento es idéntico al de hoy.
2. El drawer de ajuste de costo gana el selector de unidad y la etiqueta dice por cuál.
3. `mermas.vue` deja de forzar `:decimales="4"` — ya tiene selector, así que la precisión
   no se pierde.

**No entra (frente propio, [`pendientes.md`](../../agent/pendientes.md)):**
- Que `MoneyInput` **rechace** una cadena inválida en 0 decimales en vez de inventar un
  número. Es la mitad que el owner ya decidió en concepto, toca el contrato del componente
  y obliga a reescribir 3 tests que hoy documentan el bug.
- El barrido de los `:decimales="4"` restantes de `items.vue` (6 sitios): cada uno necesita
  verificar **primero** que tenga selector de unidad disponible; sin ese escape, quitar los
  decimales pierde precisión de verdad.
- `ReembolsoModal` (moneda del tenant contra una orden siempre CLP) — ortogonal a esto.

## 4. Lo que este diseño da por bueno, y conviene saberlo

> ⛔ **CORREGIDO el 2026-08-28 — lo que sigue es falso a nivel componente.** El `watch` no
> emite, cierto; pero lo que escribe va a `display`, y `display` entra al `<input>` con
> `v-maska`: maska lo reformatea, dispara `onMaska` → `syncFromMaska` → **`emit`**. O sea que
> `MoneyInput` **sí redondea y emite en silencio** cuando el valor entrante no es
> representable en los decimales de la moneda. Medido en `mermas.vue` sacando el prop
> `:decimales="4"`: un costo de `6.5` en CLP salió al POST como `"7"` — 7,69% de
> sobrevaloración, sin que nadie tocara el campo. Por eso la Task 4 del plan **no se ejecutó**
> y `mermas.vue` va a su propio frente
> ([`2026-08-28-merma-sin-costo-tipeado-design.md`](2026-08-28-merma-sin-costo-tipeado-design.md)).
> La regla del §2 **sigue en pie** donde el costo se tipea sin cantidad —el ajuste de costo—;
> lo que no vale es extenderla a un campo cuyo selector gobierna cantidad y costo a la vez.
> Detalle y criterio: [`docs/patterns/frontend.md`](../../patterns/frontend.md) §8.
> ⚠️ **Lo que esto le hace al párrafo de abajo NO se midió.** Por el mismo mecanismo, la
> sugerencia de 4 decimales de `DesfasesPanel` en un `MoneyInput oficial` (CLP, 0 decimales)
> debería redondearse sola al montar, sin que nadie toque el campo — pero eso es deducción,
> no medición: el número del 7,69% salió de `mermas.vue`, no de este panel. **Antes de citar
> el párrafo siguiente en cualquier dirección, medirlo.**

**Texto original, SUPERADO — se conserva porque es lo que se le prometió al owner al decidir,
no porque siga valiendo. No citarlo:**

> ~~`DesfasesPanel` muestra una sugerencia de 4 decimales en un input de 0 decimales.
> **Medido: el modelo NO se trunca solo** — el `watch` de `MoneyInput` solo escribe
> `display`, nunca emite. La sugerencia se aplica exacta si nadie toca el campo; si la
> editan, queda en pesos enteros. Bajo esta decisión eso **es el comportamiento correcto**,
> no un bug: el motor propone con su precisión, la persona corrige con la suya.~~

Lo que hay que hacer con `DesfasesPanel`, entonces: **medirlo**, no deducirlo de acá.
