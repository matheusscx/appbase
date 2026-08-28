# El separador tecleado no llega a ninguna parte — decidibilidad del monto enmascarado

**Fecha:** 2026-08-28 · **Tipo:** investigación técnica de programación — **no de mercado**
(pedido explícito del owner: *"es un problema de programación"*) · **Estado:** medición
cerrada, sin decisión tomada, sin código tocado.

**Entrada que la pidió:** [`pendientes.md`](../pendientes.md) § 2, *"El `.` que multiplica por
10 no lo ataja ningún 400"* (2026-08-26).
**Componente:** `frontend/app/components/MoneyInput.vue` · contrato en `MoneyInput.spec.ts`.

> Marcas: **[M]** = medido, ejecutando · **[R]** = razonado.
> Método al final. Cuatro frentes en paralelo; cada afirmación sobre el repo lleva
> `archivo:línea` verificada abriendo la línea.

---

## 0. Lo que esta investigación cambia

El repo documenta este frente como *"una limitación conocida: el separador se lee como
miles"*, descrita como un problema de **ambigüedad**. La medición dice que **eso está mal en
los dos extremos**:

1. **En CLP (0 decimales) no hay ninguna ambigüedad.** Cero. `1000.5` no es una cadena
   ambigua: **no pertenece al lenguaje**, y su única lectura correcta es *rechazar*. maska
   acierta **352 de 352** casos decidibles con 0 decimales; todos sus errores caen sobre
   cadenas que son lisa y llanamente inválidas, donde inventa un número en vez de rechazar.
2. **Sí hay un frente genuinamente ambiguo, y no es el que está documentado.** Aparece con
   **4 decimales sobre separadores es-CL** — o sea la moneda UF y **todo campo `@EsCosto()`
   sobre un ítem en pesos**. Ahí `1.500` tiene dos lecturas legítimas (`1500` y `1,5`) y el
   componente elige una en silencio. Ese frente no está escrito en ninguna parte.
3. **Y el error más grande no es el ×10 documentado, es USD.** Con 2 decimales maska falla
   en **570 de 944** cadenas que tienen una única lectura correcta.

📌 El titular, entonces, no es "hay una ambigüedad que no sabemos resolver". Es: **el
separador que la persona teclea no lleva información a ninguna parte**, y encima el
componente falla en la mayoría de los casos donde *sí* hay una respuesta correcta.

---

## 1. El mecanismo, medido [M]

**maska 3.2.0** (`frontend/node_modules/maska/package.json:5`). Deriva los separadores
llamando a `Intl.NumberFormat(locale, {…, maximumFractionDigits: fraction}).formatToParts()`
y buscando las partes `"group"` y `"decimal"` (`maska.mjs:9-19`). No tiene tabla propia de
locales.

**Con `fraction: 0`, `formatToParts` nunca devuelve una parte `"decimal"`** — verificado
ejecutando la llamada real en Node con `es-CL`. Entonces cae a un default **hardcodeado**:
`"."` (`maska.mjs:19`). Consecuencia: en una moneda de 0 decimales con separadores chilenos,
**el agrupador y el "decimal" terminan siendo el mismo carácter**, por diseño de la
librería, no por el locale.

La normalización completa (`maska.mjs:8`) es:

```js
n.replaceAll(agrupador, "")     // borra TODOS los separadores de miles, sin mirar posición
 .replace(decimal, ".")          // recién ahora el decimal
 .replace("..", ".")
 .replace(/[^.\d]/g, "")         // tira lo que no sea dígito o punto
```

**maska no valida la agrupación en ningún momento.** Borra el carácter de miles
incondicionalmente y después re-deriva la agrupación desde la cantidad de dígitos. Por eso
`1000.5` → `10005`: el punto se borra en el paso 1, antes de que el paso 2 pudiera leerlo
como decimal. Con coma, muere en el paso 4.

### 1.1 El hallazgo que ninguna lectura del código anticipaba [M]

La traza tecla por tecla:

```
f=0 es-CL  "1.500"   1→"1"  .→"1"  5→"15"  0→"150"  0→"1.500"
f=0 es-CL  "1000.5"  1→"1"  0→"10" 0→"100" 0→"1.000"  .→"1.000"  5→"10.005"
```

**El punto se destruye en el instante en que se teclea** (`1` + `.` → `"1"`). El `1.500` que
aparece cuatro teclas después **no es el punto de la persona**: es un punto nuevo que puso el
formateador de miles, en la misma posición, por coincidencia. **El caso chileno normal
funciona por accidente.**

De ahí sale la consecuencia dura: *"que decida al salir del campo"* **no es implementable**
sin volver el enmascarado no-destructivo primero. Al hacer blur el carácter ya no existe, ni
en el DOM ni en el modelo. No queda qué decidir.

### 1.2 No es un problema de maska [M]

`@internationalized/number` —la librería detrás del `UInputNumber` de Nuxt UI, vía
`reka-ui`— hace exactamente lo mismo: `replaceAll(agrupador, '')` incondicional antes de
mapear el decimal (`NumberParser.ts:165-167`). **Cualquier parser que reconstruya los
separadores desde `Intl.NumberFormat` hereda el problema.** Y además ese componente emite
`modelValue?: number | null` (`NumberFieldRoot.vue:11`), que choca de frente con la regla de
Decimal.js del proyecto. **Cambiar de librería no es salida.**

---

## 2. Decidibilidad — la tabla [M]

Gramática del entero agrupado válido: `^[0-9]{1,3}(G[0-9]{3})+$` — cabeza de 1 a 3 dígitos,
todo grupo posterior exactamente 3, sin separadores repetidos, iniciales ni finales.

Corpus enumerado de **3332 cadenas** es-CL, veredictos calculados por un parser de
referencia y comparados contra la salida real de maska. `f` = decimales efectivos del campo.

| f | AMBIGUO | DECIDIBLE | INVÁLIDO | maska yerra sobre lo DECIDIBLE |
|---:|---:|---:|---:|---|
| **0** (CLP) | **0** | 352 | 2980 | **0 / 352** |
| **2** (USD) | **0** | 944 | 2388 | **570 / 944** |
| **4** (UF, `@EsCosto()`) | **352** | 672 | 2308 | **396 / 672** |

⚠️ **Esos conteos son proporciones sobre un corpus enumerado, no una tasa de error de
campo.** Dicen qué fracción del *lenguaje* se lee mal, no con qué frecuencia un operador
real escribe cada forma.

Casillas que más plata mueven, con lo que hace hoy el componente:

| f | ejemplo | veredicto | lectura correcta | maska |
|---|---|---|---|---|
| 0 | `1.500` | decidible | 1500 | 1500 ✅ |
| 0 | `1000.5` | **inválido** | — rechazar | 10005 ❌ ×10 |
| 0 | `1.500,25` | **inválido** | — rechazar | 150025 ❌ ×100 |
| 2 | `1000.5` | decidible | **1000.5** | 10005 ❌ ×10 |
| 2 | `1.23` | decidible | **1.23** | 123 ❌ ×100 |
| 4 | `1.5000` | decidible | **1.5** | 15000 ❌ **×10000** |
| 4 | `1234.500` | decidible | **1234.5** | 1234500 ❌ ×1000 |
| 4 | `1.500` | **AMBIGUO** | {1500 \| 1,5} | 1500 ⚠️ por fiat |
| 4 | `1.500.000` | **AMBIGUO** | {1500000 \| 1500} | 1500000 ⚠️ por fiat |

### 2.1 El caso ambiguo tiene nombre y forma exacta [M]

**La colisión del grupo terminal.** Una cadena es a la vez agrupación válida y decimal
válido cuando su última corrida de dígitos mide exactamente 3 — porque un grupo de miles
mide 3 y una fracción de escala `f` admite hasta `f` dígitos: las dos definiciones se pisan
en el 3 apenas `f ≥ 3`. Tres resultados verificados por enumeración:

- **Aparece exactamente en `f ≥ 3`**: f=0 → 0 ambiguos, f=1 → 0, f=2 → 0, f=3 → 352, f=4 → 352.
- **Con `f ≥ 3`, el conjunto ambiguo ES el lenguaje entero de las agrupaciones bien
  formadas** — igualdad de conjuntos, no de cardinales. No es un caso borde: es *todas*.
- Toda cadena ambigua tiene la última corrida de exactamente 3 dígitos. Cero contraejemplos.

**Una palanca gratis:** prohibir el cero inicial en la cabeza (`0.500` deja de ser
agrupación válida) baja los ambiguos de **352 a 288** sin pedirle nada a nadie, y no mueve
f=0 ni f=2, que ya estaban en cero.

### 2.2 La regla que se propuso en la conversación, evaluada [M]

> *"Si la cadena completa no es una agrupación bien formada, el separador no es de miles."*

Corrida contra las 3332 cadenas: **0 fallos sobre casos decidibles en las tres escalas**, y
0 rechazos indebidos. Es correcta — es el contrapositivo de la definición de decidibilidad
por eliminación. Pero tiene dos salvedades que la conversación no vio:

1. **Su consecuente está mal para f=0.** "No es de miles" no implica "es decimal": con 0
   decimales el rol decimal **no existe**. La versión correcta tiene **tres** salidas, no
   dos: agrupación bien formada → miles; si no, y admite lectura decimal con cola ≤ f →
   decimal; **si no → rechazar**.
2. **No cubre el caso que importa.** Los 352 ambiguos de f=4 son agrupaciones *bien*
   formadas, así que la regla ni los toca: los manda por fiat a "miles". Lo que haría falta
   para cerrarlos es su **recíproca**, y la recíproca es justamente lo que el punto anterior
   refuta.

### 2.3 Por tecla nunca alcanza, y eso no es culpa de la implementación [M]

Sobre 17150 prefijos con separador, cuántos son viables a la vez como prefijo de una lectura
de miles y de una decimal:

| f | prefijos con rol indeterminado |
|---|---|
| 0 | **0 %** |
| 2 | **48 %** |
| 4 | **55 %** |

Con `f ≥ 1`, después de `1.` no hay ninguna información que permita elegir: `1.5` es
**simultáneamente** un decimal completo y un prefijo viable de `1.500`. Cualquier masker que
decida en esa tecla está adivinando — es **propiedad del lenguaje, no de la
implementación**. Lo único negociable es si se equivoca de forma *recuperable* (conserva el
carácter y re-decide) o *destructiva*, que es la de hoy.

Con `f = 0` el rol nunca está en duda —hay un solo rol—; lo único indeterminado es la
**validez** (`1.5` es inválido como cadena completa pero es prefijo legítimo de `1.500`).
**Por eso el arreglo de CLP es mucho más barato que el del resto: hay que diferir el
rechazo, no la decisión.**

---

## 3. Conclusión: son tres problemas, no uno

| f | ¿por tecla? | ¿sobre la cadena completa? | qué haría falta |
|---|---|---|---|
| **0** CLP | rol sí, validez no | **sí, totalmente** (0 ambiguos) | diferir el *rechazo* al blur. **Ninguna señal del usuario.** |
| **2** USD | no (48 %) | **sí, totalmente** (0 ambiguos) | masker no-destructivo + resolver al blur con la regla de tres salidas |
| **4** UF / costos | no (55 %) | **no** — 352 ambiguos | lo anterior **más una señal extra**: indecidible sin ella |

---

## 4. Técnicas de captura evaluadas [R]

Sin comparación de productos: son decisiones de diseño de software, cruzadas contra las tres
restricciones del repo (0/2/4 decimales; el valor emitido es un `string` para Decimal.js;
tiene que pasar el describe *"tecleo real"*).

| Técnica | Garantía | Falla / límite |
|---|---|---|
| **Unidades menores** (solo dígitos, el separador se coloca solo) | Elimina la clase de bug **de raíz**: no hay glifo que interpretar | Reemplaza el motor de entrada; hay que reescribir el describe entero; el pegado necesita ruta aparte |
| `type="number"` nativo | `.value` siempre con `.`, sin agrupador | **Rompe el caso feliz chileno de plano** (invalida `1.500.000`); riesgo de emitir `number` |
| Parseo al blur | Decide sobre la cadena completa, evita el pozo del `preProcess` | **Hoy no es implementable**: maska ya destruyó el carácter (§1.1) |
| Eco formateado | Hace visible el error antes de guardar; **no rompe nada del spec actual** | No es una garantía de programa, es un control humano |
| Gramática por posición | Resuelve todo lo decidible (§2.2) | Solo sobre la cadena completa; no cubre los 352 ambiguos |
| Rechazo explícito | Única que por construcción **nunca guarda plata equivocada en silencio** | Mal acotada rompe el caso feliz igual que el intento revertido |

⛔ **El pozo a no repetir:** ya se intentó parchear desde el input con un `preProcess` con
memoria de la última tecla, y se revirtió porque rompía `1.500` → `1` — montos válidos y
**menores**, guardados en silencio. Está escrito en el docblock de `MoneyInput.vue`.
Cualquier propuesta tiene que explicar por qué no cae ahí. Las dos que no caen son las que
deciden sobre la **cadena completa**, no tecla a tecla.

---

## 5. Alcance medido, y tres desacuerdos frontend↔backend [M]

**30 montajes de `MoneyInput` en 17 archivos** de `frontend/app`: 20 con `oficial`, 7 con
`:moneda-id` dinámico + `:decimales="4"`, y 2 con `:moneda-id` dinámico **sin** `decimales`.
Ningún `:moneda-id` literal. Los 2 campos de plata que no usan `MoneyInput`
(`grupos-modificadores.vue:758` y `:839`) son **deliberados y están comentados** en el
template — no hay olvidos.

Donde el input deja teclear una escala distinta de la que el backend valida:

1. **`pages/inventario/index.vue:347`** — "Costo nuevo" del ajuste de costo, con
   `:moneda-id` y **sin** `:decimales="4"`. El campo va a `AjusteCostoDto.costoNuevo`, que
   lleva `@EsCosto()` (escala fija 4). En un ítem CLP el input **no deja escribir decimales
   que el backend sí acepta**. El gemelo `mermas.vue:456-458` lo hace bien y explica por qué
   en un comentario. Tiene explicación histórica: el campo se construyó el 2026-07-26
   (`85cd7e76`) y el prop `decimales` estuvo inutilizable hasta el 2026-08-21 (`13cf36e5`).
   Es el más caro de los tres: ese endpoint **pisa `costo_actual` directo**, y de ahí derivan
   el costo de recetas y combos, la valorización de mermas y el margen.
2. **`components/DesfasesPanel.vue:243`** — monta con `oficial` y sin `decimales` (0 en CLP),
   pero el campo va a `AplicarDesfaseItemDto.precioBase`, que lleva `@EsCosto()` con un
   comentario largo explicando que tratarlo como monto cobrado hacía que la API **rechazara
   su propia sugerencia** y rompiera la bandeja entera. Y el campo se **inicializa con esa
   sugerencia** (`DesfasesPanel.vue:84`), que el backend produce con 4 decimales.
   🔍 **Falta medir:** si al mostrarla el componente reescribe el modelo truncado o solo el
   display. Es la diferencia entre "no se puede editar con precisión" y "se degrada sola".
3. **`components/ordenes/ReembolsoModal.vue:116`** — usa `oficial` (la moneda del tenant),
   pero `CreateReembolsoDto.monto` se valida contra `MONEDA_ORDEN_V1` (`'CLP'`), no contra la
   oficial. El propio DTO anticipa el riesgo en un comentario y el input no lo cierra.

**Los dos mecanismos de separadores conviven dentro del mismo componente:**
`formatMontoDisplay` usa los separadores **configurados** (`cfg.thousands`/`cfg.decimal`,
igual que `currency-format.ts:29,51`) para lo que se muestra en reposo, mientras que la
máscara viva usa **solo el `locale`**. Hoy no divergen —los tres registros de `moneda`
coinciden con su locale— y nada valida que sigan coincidiendo: `monedas.service.ts:96-97`
solo pone defaults. Es el patrón de "dos nociones compitiendo" que este repo ya conoce.

**Qué bloquea un cambio:** los 3 `it(...)` del describe *"limitación conocida"* fallarían **a
propósito** si se corrige el pegado — documentan el bug vigente y hay que **reescribirlos**,
no hacerlos pasar. Los 6 de *"tecleo real"*, incluida la agrupación chilena `1.500` → `1500`,
son el guardrail que cualquier arreglo tiene que seguir cumpliendo.

---

## 6. Lo que hay que corregir en la documentación vigente

No se tocó en esta pasada; queda anotado porque **describe mal el frente y desvía al que lo
tome**:

- El docblock de `MoneyInput.vue:99-120` y el describe *"limitación conocida"* de
  `MoneyInput.spec.ts` presentan el caso f=0 como ambigüedad. **No lo es**: es una cadena
  inválida, y la lectura correcta es rechazar.
- Ni ese docblock, ni `docs/patterns/frontend.md`, ni la entrada de `pendientes.md`
  mencionan el frente **realmente** ambiguo (f=4 es-CL), ni que **USD está peor que CLP**.
- La entrada de `pendientes.md` cuenta la exposición como "7 campos de escala fija + la
  familia oficial". El censo dice **30 montajes en 17 archivos**, con tres desacuerdos
  concretos contra el backend que la entrada no nombra.

---

## Método

Cuatro frentes en paralelo, por forma y no por módulo: (A) verdad de fondo de maska leyendo
su fuente en `node_modules` y ejecutando `Intl.NumberFormat` real; (B) decidibilidad formal
con enumerador exhaustivo y parser de referencia, contrastado contra la salida real de la
librería; (C) técnicas de captura contra las restricciones del repo; (D) censo de alcance y
cruce frontend↔backend campo por campo.

A los cuatro se les pidió **parar y reportar si un dato del brief no coincidía con el
código** — el brief estaba escrito de memoria. Ninguno encontró discrepancias en los datos;
uno agregó una config de prueba que el brief no mencionaba (`JPY_MIRROR`, el espejo exacto de
CLP) y otro señaló correctamente una modificación sin commitear en
`backend/test/inventario.e2e-spec.ts` que **no era suya** (son 6 aserciones de status
agregadas en esta misma sesión, en otro frente).

Los conteos salen de enumeración, no de ejemplos. Las afirmaciones sobre comportamiento de la
librería se midieron ejecutándola, no leyendo su documentación.
