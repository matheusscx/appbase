# Advertencias del motor de precios en la previsualización — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los tres carritos —POS, Salones y Tienda online— muestren las advertencias del motor de precios **antes** de crear la venta, atribuidas a la línea que las produjo.

**Architecture:** El backend ya manda las advertencias en dos granularidades y los tres carritos las descartan porque el tipo del frontend no las declara. El motor gana un campo (`advertenciasVenta`) para separar las de venta de las de línea —sin tocar una sola cuenta—, el frontend tipa lo que ya llega, y un componente compartido en la raíz de `components/` las dibuja en los tres carritos. Al final, un rename independiente: `advertenciasReceta` → `advertencias`.

**Tech Stack:** NestJS + Decimal.js en el motor, Jest para unit, Nuxt 4 + Nuxt UI en el frontend.

**Spec:** [`docs/superpowers/specs/2026-07-28-advertencias-previsualizacion-design.md`](../specs/2026-07-28-advertencias-previsualizacion-design.md) (commits `dbf5f6d` + `31ac87d`)

## Global Constraints

- **El motor de cálculo NO cambia de comportamiento.** No se toca ninguna operación `Decimal`, ni el orden de la fórmula, ni el piso en cero, ni los redondeos, ni `escala_calculo`. **La prueba es que los tests actuales de `calculo-precios.engine.spec.ts` pasan sin modificación.** Si hay que tocar uno, **parar y consultar** — `CLAUDE.md` exige detenerse antes de cambiar el motor.
- **Dinero y porcentajes con Decimal.js**, nunca `number` nativo.
- **Design System:** tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado. Hay un check (`npm run design:check`) y un pre-commit que bloquea.
- **`$fetch`/`useApiFetch`, nunca axios.**
- **Sin `TODO`, sin código comentado, sin código muerto.**
- **No refactorizar fuera del alcance pedido.**
- Trabajo directo sobre `main`, un commit por tarea. Sin ramas ni PRs.
- **`./scripts/reset-db.sh` se corre inmediatamente antes del `test:e2e`**, sin lint ni unit en el medio.
- **No commitear `.claude/settings.local.json`.** `git add` con rutas explícitas.

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `backend/src/modules/calculo-precios/calculo-precios.engine.ts` | Campo `advertenciasVenta` en `ResultadoVenta` | 1 |
| `backend/src/modules/calculo-precios/calculo-precios.engine.spec.ts` | Unit que separa venta de línea | 1 |
| `frontend/app/composables/useCalculoPrecios.ts` | Tipar `advertencias` y `advertenciasVenta` | 2 |
| `frontend/app/components/AdvertenciasPrecio.vue` | **Nuevo.** Render compartido de la lista | 2 |
| `frontend/app/components/ventas/CarritoPanel.vue` | Carrito del POS | 2 |
| `frontend/app/pages/salones/index.vue` | Carrito de Salones (+ índice en el `v-for`) | 2 |
| `frontend/app/components/tienda/CarritoOnline.vue` | Carrito de la Tienda | 2 |
| `backend/src/modules/ventas/ventas.service.ts` + spec, 4 suites e2e, `pages/ventas/pos.vue` | Rename | 3 |
| `docs/features/motor-calculo-precios.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `resueltos.md` | Documentación viva | 4 |

---

## Task 1: `advertenciasVenta` en el resultado del motor

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.engine.ts` (interfaz `ResultadoVenta` y el `return` de `calcularVenta`)
- Test: `backend/src/modules/calculo-precios/calculo-precios.engine.spec.ts`

**Interfaces:**
- Produces: `ResultadoVenta.advertenciasVenta: string[]`, las advertencias de los descuentos a nivel venta. `ResultadoVenta.advertencias` **no cambia**: sigue siendo el aplanado de las de línea más las de venta.
- Consumes: nada de tareas previas.

- [ ] **Step 1: Escribir el test que falla**

En `calculo-precios.engine.spec.ts`, dentro del mismo `describe` donde ya viven los tests de piso en cero (buscar el que dice `el piso de venta no recorta un descuento que el total sí aguanta`), agregar:

```typescript
it('advertenciasVenta trae solo las de venta; advertencias sigue trayendo todo', () => {
  // Línea de 1000 con un descuento fijo de 5000 → se topea y avisa.
  // Descuento de venta fijo de 9000 sobre lo que quedó → se topea y avisa.
  const r = calcularVenta(
    venta({
      lineas: [
        linea({
          precioUnitario: '1000',
          descuentos: [
            regla({ nombre: 'Fijo 5000', modo: 'monto_fijo', valor: '5000' }),
          ],
        }),
      ],
      descuentosVenta: [
        regla({ nombre: 'Venta 9000', modo: 'monto_fijo', valor: '9000' }),
      ],
    }),
  );

  // El campo nuevo aísla las de venta: la de línea NO puede estar acá.
  expect(r.advertenciasVenta).toHaveLength(1);
  expect(r.advertenciasVenta[0]).toContain('Venta 9000');

  // El campo viejo sigue trayendo las dos, que es lo que consume ventas.service.
  expect(r.advertencias).toHaveLength(2);
  expect(r.advertencias.some((a) => a.includes('Fijo 5000'))).toBe(true);
  expect(r.advertencias.some((a) => a.includes('Venta 9000'))).toBe(true);
});
```

Los helpers `venta()`, `linea()` y `regla()` ya existen en ese archivo con esas firmas — se usan igual en los tests vecinos.

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
cd backend && npx jest calculo-precios.engine.spec -t "advertenciasVenta"
```

Esperado: FALLA. `r.advertenciasVenta` es `undefined`, así que `toHaveLength` tira.

- [ ] **Step 3: Agregar el campo a la interfaz**

En `calculo-precios.engine.ts`, en `interface ResultadoVenta`, debajo del campo `advertencias` existente y su docblock:

```typescript
  /**
   * Solo las advertencias de los descuentos a nivel venta — las que no
   * pertenecen a ninguna línea. `advertencias` las incluye junto con las de
   * línea; este campo existe para que el carrito pueda mostrar cada aviso
   * donde corresponde sin tener que restar strings.
   */
  advertenciasVenta: string[];
```

- [ ] **Step 4: Poblarlo en el return de `calcularVenta`**

En el `return` de `calcularVenta`, agregar la propiedad **sin tocar las demás**:

```typescript
  return {
    lineas,
    totales: {
      subtotalNeto: fmt(subtotalNeto, cfg),
      totalDescuentos: fmt(totalDescuentos, cfg),
      totalRecargos: fmt(totalRecargos, cfg),
      totalImpuestos: fmt(totalImpuestos, cfg),
      totalFinal: fmt(totalFinal, cfg),
    },
    trazasVenta: { descuentos: dv.trazas, recargos: rv.trazas },
    advertencias: [
      ...lineas.flatMap((l) => l.advertencias),
      ...dv.advertencias,
    ],
    advertenciasVenta: dv.advertencias,
  };
```

- [ ] **Step 5: Correr el test y verificar que pasa**

```bash
cd backend && npx jest calculo-precios.engine.spec
```

Esperado: PASS, **incluidos todos los tests preexistentes del archivo sin haberlos tocado**. Eso es la evidencia de que la aritmética no cambió; si alguno falla, **parar y reportar** en vez de ajustarlo.

- [ ] **Step 6: Verificar con mutación que el test discrimina**

Cambiar temporalmente la línea nueva a:

```typescript
    advertenciasVenta: [
      ...lineas.flatMap((l) => l.advertencias),
      ...dv.advertencias,
    ],
```

Correr `npx jest calculo-precios.engine.spec -t "advertenciasVenta"`. Esperado: **FALLA** en `expect(r.advertenciasVenta).toHaveLength(1)` (recibe 2). Revertir la mutación y confirmar verde. Poner comando y salida en el reporte.

- [ ] **Step 7: Gate y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```

El e2e no hace falta acá: el campo es aditivo y ningún endpoint cambia de contrato.

```bash
git add backend/src/modules/calculo-precios/calculo-precios.engine.ts \
        backend/src/modules/calculo-precios/calculo-precios.engine.spec.ts
git commit -m "feat(precios): el resultado separa las advertencias de venta de las de línea"
```

---

## Task 2: Los tres carritos muestran las advertencias

**Files:**
- Modify: `frontend/app/composables/useCalculoPrecios.ts`
- Create: `frontend/app/components/AdvertenciasPrecio.vue`
- Modify: `frontend/app/components/ventas/CarritoPanel.vue:187` y `:229`
- Modify: `frontend/app/pages/salones/index.vue:1118` y `:1147`
- Modify: `frontend/app/components/tienda/CarritoOnline.vue:55` y `:95`

**Interfaces:**
- Consumes de Task 1: `ResultadoVenta.advertenciasVenta: string[]`.
- Produces: componente `<AdvertenciasPrecio :advertencias="string[]" />`.

- [ ] **Step 1: Tipar lo que ya llega**

En `useCalculoPrecios.ts`, agregar a `interface ResultadoLinea`, después de `trazas`:

```typescript
  /** Descuentos topeados por el piso en cero en esta línea. */
  advertencias: string[]
```

Y a `interface ResultadoVenta`, después de `trazasVenta`:

```typescript
  /** Aplanado: las de cada línea más las de venta. */
  advertencias: string[]
  /** Solo las de los descuentos a nivel venta. */
  advertenciasVenta: string[]
```

No hay lógica nueva: el backend ya mandaba los tres campos y el tipo los ignoraba.

- [ ] **Step 2: Crear el componente compartido**

`frontend/app/components/AdvertenciasPrecio.vue` — va en la **raíz** porque lo consumen tres módulos; los subdirectorios (`ventas/`, `salones/`, `tienda/`) son por módulo.

```vue
<script setup lang="ts">
defineProps<{ advertencias: string[] }>()
</script>

<template>
  <p
    v-for="(advertencia, i) in advertencias"
    :key="i"
    class="flex items-start gap-1 text-xs text-warning"
  >
    <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
    <span>{{ advertencia }}</span>
  </p>
</template>
```

Con lista vacía el `v-for` no renderiza nada, que es el caso normal. El patrón visual (`flex items-center gap-1 text-xs text-warning` + `UIcon i-lucide-triangle-alert size-3.5 shrink-0`) es el que ya usa `components/ventas/ItemPersonalizacionDrawer.vue:392-397`; se copia para no inventar un estilo nuevo.

> **Cuidado con el auto-import.** Al estar en la raíz, Nuxt lo expone **sin prefijo**: el tag es `<AdvertenciasPrecio>`. Los de subcarpeta llevan el nombre de la carpeta (`<VentasMonedaTasasInfo>`, que se ve en `CarritoPanel.vue:232`). Un tag con el prefijo equivocado **no falla el build**: no resuelve en runtime y no renderiza nada.

- [ ] **Step 3: Conectar el carrito del POS**

En `CarritoPanel.vue`, dentro del `<li v-for="(linea, index) in lineas">` (línea 187), al final del `<div class="flex-1 min-w-0">` —después del `<p>` del precio unitario— agregar:

```vue
          <AdvertenciasPrecio :advertencias="resultado?.lineas[index]?.advertencias ?? []" />
```

`resultado` es `ResultadoVenta | null` (prop declarada en `:12`), por eso el encadenamiento opcional.

Y en el bloque de totales, **antes** del `<div>` de la fila Total (línea 229):

```vue
          <AdvertenciasPrecio :advertencias="resultado.advertenciasVenta" class="mb-1" />
```

Ahí `resultado` ya está garantizado no-nulo por el `v-if` que envuelve el bloque —lo demuestra que la línea 218 hace `resultado.totales.subtotalNeto` sin guarda—, así que no lleva `?.`.

- [ ] **Step 4: Conectar el carrito de la Tienda**

En `CarritoOnline.vue`, dentro del `<li v-for="(linea, index) in lineas">` (línea 55), al final del `<div class="flex-1 min-w-0">`:

```vue
          <AdvertenciasPrecio :advertencias="resultado?.lineas[index]?.advertencias ?? []" />
```

Y **antes del `<div>` de la fila Total**, que empieza en la línea 94
(`<div class="flex justify-between items-center font-semibold ...">`):

```vue
          <AdvertenciasPrecio :advertencias="resultado.advertenciasVenta" class="mb-1" />
```

- [ ] **Step 5: Conectar el carrito de Salones**

Es el único con un cambio estructural: hoy itera **sin índice**. En `salones/index.vue:1118`, cambiar

```vue
                    v-for="linea in activeCuenta.lineas"
```

por

```vue
                    v-for="(linea, index) in activeCuenta.lineas"
```

dejando el `:key="linea.id"` como está. Después, al final del `<div class="min-w-0 flex-1">` de esa fila:

```vue
                      <AdvertenciasPrecio :advertencias="resultado?.lineas[index]?.advertencias ?? []" />
```

Y en el bloque del total, **antes del `<div class="mb-3 flex justify-between text-base font-semibold text-default">`** que está en la línea 1147:

```vue
                <AdvertenciasPrecio :advertencias="resultado?.advertenciasVenta ?? []" class="mb-2" />
```

Acá `resultado` es un `ref` que arranca en `null` (`salones/index.vue:75`), así que sí lleva `?.`.

> **El cruce es por índice, nunca por `itemId`.** Los tres carritos construyen el input del motor con un `.map()` sobre sus líneas (`cuentaToCalcularInput` en `useSalones.ts:167-180` y sus equivalentes), así que `resultado.lineas[index]` corresponde 1:1 con la línea dibujada. Cruzar por `itemId` sería un bug: el mismo ítem puede aparecer en dos líneas con personalizaciones distintas.

- [ ] **Step 6: Gate del frontend**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

`design:check` tiene que pasar: `text-warning` es un token semántico ya usado en el repo (`ItemPersonalizacionDrawer.vue:394`), no un color hardcodeado.

- [ ] **Step 7: Smoke test en navegador — los tres carritos**

El repo **no tiene specs `.vue`**, así que esto es la única red. Con `docker-compose up` levantado (frontend `http://localhost:5173`, backend `http://localhost:3000`, credenciales `admin.paris@paris.cl` / `admin`).

**Preparar el escenario que dispara el aviso:** en `/configuracion/descuentos` crear un descuento de **monto fijo** mayor al precio de un ítem barato (p. ej. $99.999 sobre un ítem de $1.000), y asignárselo a ese ítem desde `/configuracion/items`.

Después, en cada uno de los tres carritos, agregar ese ítem y verificar:

1. **POS** (`/ventas/pos`) — el aviso aparece **bajo la línea de ese ítem**, no bajo otra, con el texto del descuento y los dos montos.
2. **Salones** (`/salones`) — abrir una cuenta en una mesa, agregar el ítem, mismo resultado. Es el que cambió el `v-for`, así que verificar además que **las demás líneas no muestran el aviso de esta**.
3. **Tienda** (`/tienda`) — mismo resultado.
4. **Caso normal:** un ítem sin descuento topeado no dibuja **nada** — ni espacio en blanco ni icono suelto.

Si alguna de las cuatro no se puede ejecutar, **decirlo** en el reporte en vez de darla por buena.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/composables/useCalculoPrecios.ts \
        frontend/app/components/AdvertenciasPrecio.vue \
        frontend/app/components/ventas/CarritoPanel.vue \
        frontend/app/components/tienda/CarritoOnline.vue \
        frontend/app/pages/salones/index.vue
git commit -m "feat(carrito): los tres carritos avisan el descuento topeado antes de cobrar"
```

---

## Task 3: Rename `advertenciasReceta` → `advertencias`

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` (produce el campo)
- Modify: `backend/src/modules/ventas/ventas.service.spec.ts`
- Modify: `backend/test/combos.e2e-spec.ts`, `backend/test/recetas.e2e-spec.ts`, `backend/test/grupos-modificadores.e2e-spec.ts`, `backend/test/grupos-modificadores-overrides.e2e-spec.ts`
- Modify: `frontend/app/pages/ventas/pos.vue:209-215`

**Interfaces:**
- Consumes: nada de las tareas anteriores. Es independiente — no comparte un solo archivo con las tareas 1 y 2.
- Produces: la respuesta de `POST /ventas` pasa a tener `advertencias` en vez de `advertenciasReceta`.

**Por qué:** el campo hace rato dejó de ser solo de receta — desde el piso en cero también transporta avisos del motor de precios (`ventas.service.ts:460` lo inicializa con `resultado.advertencias`). El cierre es renombrarlo de una, no ir agregando un campo nuevo por tipo de aviso.

- [ ] **Step 1: Medir el punto de partida**

```bash
grep -rn "advertenciasReceta" backend/src backend/test frontend/app | wc -l
```

Esperado: **21**. Si da otro número, algo cambió desde que se escribió el plan — reportarlo antes de seguir.

- [ ] **Step 2: Renombrar en el backend**

En `ventas.service.ts`: la variable local `advertenciasReceta` (declarada en `:460`, con `push` en `:497` y `:511`) y la propiedad del objeto devuelto en `:615`. El nombre de la variable local y el de la propiedad pasan ambos a `advertencias`.

Cuidado en `:615`: hoy es `return { ...venta, detalles, advertenciasReceta }`. Queda `return { ...venta, detalles, advertencias }`. No hay colisión — la venta no tiene ningún otro campo con ese nombre.

- [ ] **Step 3: Renombrar en los tests del backend**

`ventas.service.spec.ts` y las cuatro suites e2e (`combos`, `recetas`, `grupos-modificadores`, `grupos-modificadores-overrides`). Son aserciones sobre el nombre del campo; el valor esperado no cambia.

- [ ] **Step 4: Renombrar en el POS**

En `pos.vue`, el tipo inline de la respuesta y el bucle de toasts (líneas 209-215):

```typescript
    const venta = await useApiFetch<{ estado: string; advertencias?: string[] }>(`${apiUrl}/ventas`, {
      method: 'POST',
      body,
    })
    toast.add({ title: estadoToastTitle[venta.estado] ?? 'Venta registrada', color: 'success' })
    for (const advertencia of venta.advertencias ?? []) {
      toast.add({ title: advertencia, color: 'warning' })
    }
```

- [ ] **Step 5: Verificar que no quedó ninguna**

```bash
grep -rn "advertenciasReceta" backend/src backend/test frontend/app
```

Esperado: **sin resultados**.

- [ ] **Step 6: Gate completo**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh   # desde la raíz
cd backend && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet
```

Las cuatro suites e2e son la red del rename en el backend: si quedó una referencia sin cambiar, fallan.

- [ ] **Step 7: Smoke test — que los toasts sigan apareciendo**

**Este paso no es opcional, y es el que más importa de la tarea.** El riesgo real del rename no es romper, es **renombrar a medias**: si el frontend lee un campo que el backend ya no manda, recibe `undefined`, el `?? []` lo convierte en lista vacía **en silencio**, los toasts desaparecen y todo el gate sigue verde.

En el POS (`/ventas/pos`), con el mismo descuento topeado de la Task 2 (o un ítem cuya receta tenga un ingrediente sin stock), **cobrar una venta** y verificar que **aparecen los toasts de advertencia** después de cobrar. Que compile y que el e2e pase no prueba esto.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/ventas/ventas.service.ts \
        backend/src/modules/ventas/ventas.service.spec.ts \
        backend/test/combos.e2e-spec.ts \
        backend/test/recetas.e2e-spec.ts \
        backend/test/grupos-modificadores.e2e-spec.ts \
        backend/test/grupos-modificadores-overrides.e2e-spec.ts \
        frontend/app/pages/ventas/pos.vue
git commit -m "refactor(ventas): advertenciasReceta pasa a advertencias, que es lo que transporta"
```

---

## Task 4: Documentación viva

**Files:**
- Modify: `docs/features/motor-calculo-precios.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/agent/pendientes.md` (sacar dos ítems)
- Modify: `docs/agent/resueltos.md` (agregarlos cerrados)

**Interfaces:** ninguna — es documentación.

- [ ] **Step 1: Documentar el campo en `docs/features/motor-calculo-precios.md`**

Explicar la regla, no el código:

> **Advertencias.** El motor emite avisos que **no frenan el cálculo**: hoy, cuando un
> descuento supera el monto disponible, se topea y se avisa con cuánto se aplicó y cuánto
> valía la regla. El resultado los expone en dos granularidades porque se muestran en
> lugares distintos: `ResultadoLinea.advertencias` va bajo la línea que lo produjo, y
> `advertenciasVenta` —solo los descuentos a nivel venta, que no pertenecen a ninguna
> línea— va junto al total. `advertencias` es el aplanado de ambos y es lo que consume la
> venta al persistirse.

- [ ] **Step 2: Actualizar `docs/ESTADO.md`**

Agregar una fila debajo de la de **"Motor de cálculo de precios"** (línea 34):

```markdown
| Advertencias del motor de precios en la previsualización del carrito (POS, Salones, Tienda) | ✅ Implementado (2026-07-28) |
```

- [ ] **Step 3: Cerrar los dos pendientes**

Sacar de `docs/agent/pendientes.md` y agregar a `docs/agent/resueltos.md`, con el formato que `resueltos.md` ya usa:

1. **"Las advertencias del motor de precios llegan a un solo consumidor"** — cerrado **parcialmente**: la previsualización de los tres carritos ya las muestra. **Dejar constancia explícita de lo que sigue abierto**: `online.service.ts` y `suscripciones.service.ts` siguen descartando `resultado.advertencias` al crear el pedido y la suscripción, y `pasarela.vue` sigue sin leerlas.
2. **"`advertenciasReceta` de la venta ya no son solo de receta"** — cerrado del todo por la Task 3.

Como el ítem 1 se cierra a medias, **el resto tiene que quedar como entrada viva en `pendientes.md`**, no desaparecer con el resto del texto.

- [ ] **Step 4: Verificar enlaces y commitear**

El pre-commit valida los enlaces internos de los `.md` staged.

```bash
git add docs/features/motor-calculo-precios.md docs/ESTADO.md \
        docs/agent/pendientes.md docs/agent/resueltos.md
git commit -m "docs(precios): el carrito avisa el descuento topeado antes de cobrar"
```

---

## Cierre

Gate completo sobre el diff acumulado, más la revisión independiente del paso 7 de `verify-feature`:

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh && cd backend && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```
