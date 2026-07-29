# Advertencias del motor de precios en la previsualización del carrito

**Fecha:** 2026-07-28
**Estado:** diseño aprobado, pendiente de plan
**Alcance:** que los tres carritos —POS, Salones y Tienda online— muestren las advertencias
del motor de precios **antes** de crear la venta, atribuidas a la línea que las produjo.
Agrega un campo al resultado del motor para separar las advertencias de venta de las de
línea; el resto es frontend. Incluye además el rename de `advertenciasReceta` a
`advertencias` en la respuesta de la venta (§6). Backend (solo forma del resultado) +
frontend.
**Origen:** pendiente abierto en [`docs/agent/pendientes.md`](../../agent/pendientes.md),
surgido del piso en cero del descuento (commit `32c1452`).

---

## 1. Contexto y problema

El motor de precios produce **avisos que no frenan el cálculo**. Hoy existe uno solo
([`calculo-precios.engine.ts:280`](../../../backend/src/modules/calculo-precios/calculo-precios.engine.ts)):
cuando un descuento supera el monto disponible, se topea y se avisa.

```
Descuento "<nombre>": se aplicó $X en vez de $Y porque superaba el monto disponible
```

Ese aviso llega **una sola vez, y tarde**: `ventas.service.ts:460` lo mete en
`advertenciasReceta` y el POS lo muestra como toast **después de crear la venta**, cuando
ya es irreversible. La previsualización del carrito muestra un total ya topeado sin decir
por qué.

**El dato ya viaja.** `POST /calculo-precios/calcular` devuelve lo que arma el motor sin
filtrar, y el motor incluye las advertencias en **dos granularidades**:

- `ResultadoLinea.advertencias` — atribuidas a la línea que las produjo (`engine.ts:93`)
- `ResultadoVenta.advertencias` — el aplanado de las de línea **más** las de los descuentos
  a nivel venta (`engine.ts:480-483`)

Los tres carritos reciben ambas y ninguno las mira, porque `ResultadoVenta` en
[`useCalculoPrecios.ts:52-66`](../../../frontend/app/composables/useCalculoPrecios.ts) no
declara el campo.

**Son tres previsualizaciones, no una.** Las tres llaman al mismo endpoint y comparten el
tipo, pero cada una dibuja su carrito por su cuenta:

| Carrito | Obtiene el resultado en | Dibuja en |
|---|---|---|
| POS | `useVenta.ts:391` | `components/ventas/CarritoPanel.vue` |
| Salones | `salones/index.vue:368` (llamada propia) | lista inline, `salones/index.vue:1118` |
| Tienda online | `useTiendaCarrito.ts:52` | `components/tienda/CarritoOnline.vue` |

Salones es el que más lo necesita: la cuenta se arma durante todo el servicio antes de
cerrarse.

---

## 2. Decisiones de diseño

1. **Se muestra en los tres carritos, con un componente compartido.** Es la tercera
   duplicación, justo donde la convención del proyecto dice extraer. El precedente pesa: la
   lógica de `personalizacionVacia` vivió en tres archivos y solo uno recibió el fix, con
   POS y Salones descartando la personalización del combo.

2. **Atribuido por línea, más un resumen en el total.** El backend ya manda las dos
   granularidades; usarlas evita que el cajero tenga que deducir a qué línea se refiere cada
   aviso. Los descuentos de venta no pertenecen a ninguna línea y van junto al total.

3. **El cruce línea↔resultado es por índice, nunca por `itemId`.** Los tres carritos
   construyen su input con un `.map()` sobre sus líneas
   (`cuentaToCalcularInput` en `useSalones.ts:167-180`, y sus equivalentes), así que la
   correspondencia es 1:1 y en orden. Cruzar por `itemId` **sería un bug**: el mismo ítem
   puede aparecer en dos líneas con personalizaciones distintas.

4. **El motor gana un campo, no cambia una cuenta.** Para separar las advertencias de venta
   de las de línea hace falta exponerlas por separado; derivarlas en el frontend restando
   strings se rompe cuando dos advertencias tienen el mismo texto, y ese caso es alcanzable
   (el mismo descuento topeado al mismo monto en dos líneas).

---

## 3. Backend — un campo en el resultado

`calculo-precios.engine.ts`: agregar `advertenciasVenta: string[]` a `ResultadoVenta`,
poblado con `dv.advertencias`, que ya se calcula en esa misma función.

```typescript
return {
  lineas,
  totales: { ... },
  trazasVenta: { ... },
  advertencias: [                    // sin cambios
    ...lineas.flatMap((l) => l.advertencias),
    ...dv.advertencias,
  ],
  advertenciasVenta: dv.advertencias, // nuevo
};
```

`advertencias` queda **idéntico**, así que `ventas.service.ts:460` —que lo consume entero
para armar `advertenciasReceta`— no cambia, ni sus e2e.

> **Invariante de este trabajo.** No se toca ninguna operación `Decimal`, ni el orden de la
> fórmula, ni el piso en cero, ni los redondeos, ni `escala_calculo`. La prueba de que se
> cumplió es que **los tests actuales del motor pasan sin modificación**. Si alguno hay que
> tocar, el trabajo se detiene y se consulta: `CLAUDE.md` exige parar antes de cambiar el
> motor de cálculo de precios.

---

## 4. Frontend

### 4.1 Tipar lo que ya llega

`useCalculoPrecios.ts`: `advertencias: string[]` en `ResultadoLinea`, y `advertencias` +
`advertenciasVenta` en `ResultadoVenta`. No hay lógica nueva: el dato ya está en la
respuesta.

### 4.2 El componente compartido

`frontend/app/components/AdvertenciasPrecio.vue`, en la **raíz** de `components/` porque lo
consumen tres módulos — los subdirectorios son por módulo (`ventas/`, `salones/`,
`tienda/`), y la raíz es donde ya viven los compartidos (`MoneyInput.vue`,
`RecetasDesfasesPanel.vue`).

Props: `advertencias: string[]`. Con lista vacía **no renderiza nada**, que es el caso
normal.

> **Cuidado con el auto-import.** Al estar en la raíz, Nuxt lo expone **sin prefijo**
> (`<AdvertenciasPrecio>`), a diferencia de los de subcarpeta, que llevan el nombre de la
> carpeta (`<VentasCarritoPanel>`). Un tag con el prefijo equivocado **no falla el build**:
> no resuelve en runtime y no renderiza nada. Ya pasó en este repo.

### 4.3 Los tres carritos

El mismo componente, dos veces en cada uno:

| Carrito | Bajo cada línea | Junto al total |
|---|---|---|
| POS | `CarritoPanel.vue:187` (`v-for="(linea, index)"`) | `CarritoPanel.vue:231-234` |
| Salones | `salones/index.vue:1118` — **itera sin índice**, hay que agregarlo | `salones/index.vue:1149` |
| Tienda | `CarritoOnline.vue:55` (`v-for="(linea, index)"`) | `CarritoOnline.vue:99` |

Por línea: `resultado.lineas[index].advertencias`. Junto al total:
`resultado.advertenciasVenta`.

Los dos componentes de carrito ya iteran con `(linea, index)`, así que el índice está
disponible. Salones itera `v-for="linea in activeCuenta.lineas"` y necesita el índice
agregado — es el único cambio estructural de los tres.

---

## 5. Testing

**Motor (unit).** Un test que fije que `advertenciasVenta` trae **solo** las de venta
mientras `advertencias` sigue trayendo todo. El mutante que lo revierte: poblar
`advertenciasVenta` con el aplanado completo — si el test sigue verde, no discrimina.

**Regresión del cálculo.** Los tests actuales del motor pasan sin tocarlos. Esa es la
evidencia de que la aritmética no cambió, y es parte del entregable.

**Frontend.** El repo no tiene specs `.vue`, así que va **smoke test en navegador de los
tres carritos**. Escenario que dispara el aviso: un ítem con un descuento de monto fijo
mayor a su neto. Verificar en cada carrito que el aviso aparece bajo la línea correcta,
que un descuento de venta topeado aparece junto al total, y que sin advertencias no se
dibuja nada.

---

## 6. Rename: `advertenciasReceta` → `advertencias`

Trabajo **independiente** del resto de este spec: no comparte un solo archivo con las
secciones 3 a 5. Va al final por eso — si se complica, la feature ya está entregada.

`ventas.service.ts:615` devuelve la venta con un campo `advertenciasReceta` que **hace rato
dejó de ser solo de receta**: desde el piso en cero (`32c1452`) también transporta avisos
del motor de precios (`ventas.service.ts:460` lo inicializa con `resultado.advertencias`).
El POS las renderiza como toasts sueltos y cada mensaje se explica solo, así que
**funciona**; lo que quedó mal es el nombre.

Se renombra a `advertencias`. Sin colisión: la respuesta de la venta es
`{ ...venta, detalles, advertenciasReceta }` y no tiene ningún otro campo con ese nombre.

**Alcance medido: 21 referencias en 7 archivos.**

| Archivo | |
|---|---|
| `backend/src/modules/ventas/ventas.service.ts` | produce el campo |
| `backend/src/modules/ventas/ventas.service.spec.ts` | unit |
| `backend/test/combos.e2e-spec.ts` | afirma el nombre |
| `backend/test/recetas.e2e-spec.ts` | afirma el nombre |
| `backend/test/grupos-modificadores.e2e-spec.ts` | afirma el nombre |
| `backend/test/grupos-modificadores-overrides.e2e-spec.ts` | afirma el nombre |
| `frontend/app/pages/ventas/pos.vue` | consume el campo |

**El cierre es hacerlo de una vez**, no ir agregando un campo nuevo por cada tipo de aviso.

Que las cuatro suites e2e afirmen el nombre es la red: si queda una referencia sin
renombrar, fallan. El riesgo real no es romper, es **renombrar a medias** — el frontend
leyendo un campo que el backend ya no manda devuelve `undefined`, y el `?? []` de
`pos.vue:214` lo convierte en silencio. Verificación explícita: que el POS **siga mostrando
los toasts** después del rename, no solo que compile.

---

## 7. Documentación

| Archivo | Qué |
|---|---|
| `docs/features/motor-calculo-precios.md` | El campo nuevo y qué distingue de `advertencias` |
| `docs/ESTADO.md` | Fila de la funcionalidad |
| `docs/agent/pendientes.md` | Cerrar **dos** ítems (previsualización y rename); dejar abierto el del checkout online |

---

## 8. Fuera de alcance

- **`online.service.ts` y `suscripciones.service.ts` siguen descartando las advertencias**
  al *crear* el pedido y la suscripción, y `pasarela.vue` sigue sin leerlas. Es un problema
  hermano —el mismo que el rename de §6 corrige en el nombre, pero en otros dos módulos—,
  no el de la previsualización. Queda abierto en `pendientes.md`.
- **No se agregan tipos de advertencia nuevos.** Hoy el motor produce uno solo y así queda.
- **El campo renombrado no cambia de forma.** Sigue siendo `string[]` plano en la respuesta
  de la venta; no se le agrega atribución por línea como la que §4 usa en el carrito.
