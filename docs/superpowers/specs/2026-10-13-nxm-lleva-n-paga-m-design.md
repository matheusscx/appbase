# NxM de verdad: lleva N, paga M

**Fecha:** 2026-10-13 · **Entrada:** `docs/agent/pendientes.md` § 4, *"Una promoción `nxm` acepta un
`valorPorcentaje` mayor a 1, y con 2 regala las dos unidades"* · **Decidido:** owner, 2026-10-13, por
AskUserQuestion de la orquestadora con la tabla de 2x1, 3x2, "segunda al 50%" y 3x1: *"Hacer el NxM
de verdad"*. Frente que toca el motor de cálculo: va solo y con el sistema quieto.

## 1. Problema

Un `nxm` hoy es "cada `cadaN` unidades, la más barata recibe `valorPorcentaje`". Con eso:

- El 2x1 (`cadaN` 2, `1.0`), el 3x2 (`cadaN` 3, `1.0`) y la "segunda al 50%" (`cadaN` 2, `0.5`) salen bien.
- El 3x1 y el 4x2 **no se pueden expresar**. El único truco es un valor mayor a 1, que descuenta
  *dos veces la más barata*: con $1.000, $1.000 y $800, un 2x1 al 200% cobra $800, y un "cada 3 al
  200%" cobra $1.200. El 3x1 real cobra $1.000.
- Nada topa el valor. Medido: un 2x1 al 200% sobre dos unidades de $1.000 cobra $0.

## 2. Decisiones

| Qué | Decisión | Procedencia |
|---|---|---|
| Modelo | La promo se configura como "lleva N, paga M" | owner, 2026-10-13, AskUserQuestion de la orquestadora |
| Motor | En cada grupo de N, las N−M unidades más baratas reciben el porcentaje | owner, ídem |
| Tope | `valorPorcentaje ≤ 1`, el % que se descuenta de **cada** unidad regalada | owner, ídem |
| Sobrantes | El grupo incompleto no recibe nada: 5 cervezas de $1.000 en un 3x1 → $3.000. Descartado: "las sueltas también llevan algo" | owner, 2026-10-13, AskUserQuestion de la orquestadora, con escena y costo |
| Pantalla | El % arranca **vacío** con el placeholder "1.00 (gratis)", para conservar la protección del cambio de tipo. Descartado: "que arranque en 1.00" | owner, ídem |
| Nombre de la columna | `paga_m` / `pagaM` junto a `cada_n` / `cadaN`, sin renombrar `cadaN` | orquestadora (técnico), 2026-10-13 |
| M ≥ 1 | Un grupo siempre paga al menos su unidad más cara: es la regla del 2026-10-04 ("una promo no regala": la boleta en $0 es una cortesía) | orquestadora, 2026-10-13, derivada de la decisión del owner del 2026-10-04 |
| Promos viejas con valor > 1 | Mismo precedente que `porcentaje`: siguen aplicando mientras estén activas, se pueden pausar y no se reactivan ni se reescriben sin bajar el valor | orquestadora, 2026-10-13 |

Descartadas por el owner: "un tope que dependa del tamaño del grupo, para conservar el truco" y
"dejarlo".

## 3. Modelo

- Columna nueva `promociones.paga_m smallint NULL`, entity `pagaM: number | null`.
- `chk_promociones_valor_segun_tipo`: la rama `nxm` exige `paga_m IS NOT NULL AND paga_m >= 1 AND
  paga_m < cada_n`; las ramas `porcentaje` y `precio_fijo` exigen `paga_m IS NULL`.
- **Migración** generada con `migration:generate` y leída. Antes de recrear el CHECK lleva
  `UPDATE promociones SET paga_m = cada_n - 1 WHERE tipo = 'nxm'`. El demo de Railway conserva sus
  filas desde ADR-030 y sin ese paso no arrancaría. `cada_n - 1` es una **derivación exacta** de la
  regla anterior ("la más barata de cada `cada_n`" = "paga `cada_n − 1`"), no una copia que pueda
  divergir: el 2x1 existente cobra igual.
- Seed: "2x1 de la casa" pasa a `cadaN` 2, `pagaM` 1.
- `startup-pos.sql` refleja la columna y el CHECK.

## 4. Validación (service)

En `PromocionesService`, con el mismo alcance que el tope de `porcentaje` (al crear, al editar el
valor o el tipo, y al activar):

- `validarFormaSegunTipo`: `pagaM` es requerido en `nxm` y prohibido en los otros tipos.
  `pagaM < cadaN`: el 400 dice que tiene que pagar menos de lo que lleva.
- DTO: `pagaM` `@IsInt @Min(1) @Max(MAX_SMALLINT)`, como `cadaN`.
- `validarTopeDelPorcentaje` gana la rama `nxm`: `valorPorcentaje > 1` → 400. En `porcentaje` el
  tope sigue siendo `< 1`; en `nxm`, `1` es la unidad gratis, que es precio.

## 5. Motor

Solo cambia `evaluarNxm` (`promociones.evaluator.ts`). `calculo-precios.engine.ts` no se toca.

- Los grupos se arman igual que hoy: unidades enteras en orden de precio de lista descendente
  (desempate por `lineaIndex`), N consecutivas por grupo, sin explotar los lotes.
- En cada grupo, las **últimas N−M** unidades (las más baratas) reciben `valor × precioLista` cada
  una. Si vienen de líneas distintas, la aplicación lleva un `montosPorLinea` por línea, con las
  unidades de una misma línea sumadas. Es la forma que el combo ya usa, y el motor ya la maneja:
  el interruptor `promosAcumulanDescuentos` compara la aplicación entera contra el catálogo de las
  líneas que toca.
- Cada candidata sigue pidiendo al greedy **las N unidades del grupo**, no solo las regaladas.
- La cuantización no cambia: el evaluador entrega plata fina en precio de lista, y el motor la pasa
  a neto y cierra el paso `descuentos` de cada línea cuantizado, como hoy con dos grupos de un 2x1
  en la misma línea.
- La memoria de "mismo monto que el grupo anterior" pasa a comparar los tramos regalados, no el
  lote de la barata.

## 6. Ejemplos (precio de lista, al 100% salvo que diga otra cosa)

| Promo | Unidades | Regala | Cobra |
|---|---|---|---|
| 3x1 | $1.000, $1.000, $800 | $1.000 + $800 | $1.000 |
| 4x2 | $1.500, $1.200, $1.000, $700 | $1.000 + $700 | $2.700 |
| 2x1 al 50% | $1.000, $800 | $400 | $1.400 (igual que hoy) |
| 3x1 | $1.200, $1.000, $1.000, $800, $500 | $1.000 + $1.000 (grupo $1.200/$1.000/$1.000) | $2.500; $800 y $500 sobran y pagan completo |
| 3x1 | 5 × $1.000 | $2.000 | $3.000 |

## 7. Pantalla (`/configuracion/promociones`)

```
Tipo                [ N x M (ej. 2x1, 3x1, 4x2) ]
Lleva [ 3 ]   Paga [ 1 ]
   De cada 3 unidades, las 2 más baratas llevan el descuento.
Descuento en cada unidad regalada [            ]   ← placeholder "1.00 (gratis)"
   1.00 = gratis · 0.50 = a mitad de precio · máximo 1.00
```

- Los tres campos arrancan vacíos con placeholder (2 / 1 / "1.00 (gratis)"). `onTipoChange` los
  limpia como hoy.
- La columna Valor de la tabla dice "Lleva 3, paga 1", o "Lleva 2, paga 1 · regalada al 50%"
  cuando el valor es menor a 1.
- La frase de ayuda y el resumen de la tabla son utilidades de presentación: van fuera del `.vue`.

## 8. Fuera de alcance

- `ventas_promociones` sigue congelando nombre, tipo y valor, sin N ni M: la aplicación la
  identifica el nombre ("3x1 martes").
- Renombrar `cadaN`.
- Un default silencioso de `pagaM` en la API: es requerido.

## 9. Tests

- **Unit del evaluador:** 3x1 con precios mezclados (las regaladas en dos líneas), 4x2, 2x1 al
  50%, sobrantes de un 3x1 y M = N−1 idéntico a hoy. El oráculo sigue comparando contra el
  evaluador anterior con `pagaM = cadaN − 1`.
- **Unit del service:** `pagaM` faltante, `≥ cadaN`, presente en otro tipo; valor > 1 en `nxm`
  rechazado y `1` aceptado.
- **e2e** (`promociones.e2e-spec.ts`): `/calcular`, POS con congelado, cuenta de salón y online con
  un 3x1 de precios distintos; 3x1 sobre una etiqueta de $993 con IVA incluido que cobra $993
  exacto (el ancla); los 400. Los e2e de 2x1 existentes solo suman `pagaM: 1` y dan los mismos
  montos.
- **Frontend:** form-config y página (`promociones.nuxt.spec.ts`).
- **Mutantes que revierten:** volver a "solo la más barata" y sacar el tope.
