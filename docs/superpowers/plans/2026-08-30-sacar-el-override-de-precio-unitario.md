# Sacar el override de `precioUnitario` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que ningún cliente pueda decirle al motor de precios cuánto vale una línea.
El precio de una línea personalizada —`precioBase + Σ extras`— se calcula **solo en el
servidor** y se convierte a moneda oficial **una sola vez**, tanto en el cobro (que ya lo
hace bien) como en la previsualización (que hoy miente).

**Architecture:** El campo `precioUnitario` existe en dos DTOs distintos y **no es el
mismo canal**:

- `LineaVentaDto.precioUnitario` (`POST /ventas`) — **no lo alimenta ningún cliente**:
  `toVentaLineasBody` no lo incluye, la Tienda lo evita a propósito
  (`online.service.ts:37-41`) y `cerrarCuenta` arma el body en el servidor. Sale entero.
- `LineaDto.precioUnitario` (`POST /calculo-precios/calcular`) — **es el que miente**. Lo
  alimentan `toCalcularInput` (POS) y `cuentaToCalcularInput` (salones) con
  `precioBase + extras` **en la moneda del ítem**, y `resolverLinea` lo usa tal cual:
  la conversión a moneda oficial vive en la rama del `else`.

La salida no es borrar el campo del preview y ya —eso cambiaría una mentira cara por una
barata (el precio base convertido, **sin** los extras)—. Es que `calcular` aprenda a tasar
la personalización él mismo: recibe `personalizacion`, la resuelve con `ItemsService`
—que `CalculoPreciosService` **ya inyecta**, sin dependencia ni ciclo nuevos—, suma
`precioExtraTotal` y convierte una sola vez. El override sobrevive **solo como canal
interno** entre `ventas.service` y el motor, renombrado a lo que realmente es: un precio
**ya convertido**, no un override del catálogo.

**Tech Stack:** NestJS + TypeORM + Decimal.js (backend), Nuxt 4 + Vue 3 + Vitest
(frontend), Jest + supertest (e2e de API).

**Spec:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) § 4, entrada *"El override
de `precioUnitario` no se convierte…"*, **con su premisa corregida por este plan** (ver
"Lo que la entrada decía mal"). Decisión del owner del 2026-08-30: sacar los dos, con el
preview tasando.

## Global Constraints

- ⛔ **Toca el motor de cálculo de precios.** Va solo, con el sistema quieto, y el gate
  completo antes de cada commit (`CLAUDE.md` § Detenerse y preguntar).
- Dinero con `Decimal.js`, nunca `number`. La conversión usa
  `convertirAMonedaOficial(precio, monedaId, tasaMap, modoRedondeo)` — **una sola vez por
  línea**, nunca sobre un valor ya convertido.
- Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`.
- Sin query por iteración. La resolución de personalización va en un `for` secuencial, no en
  `Promise.all`: comparte el `pg.Client` de la transacción (mismo motivo y mismo comentario
  que `ventas.service.ts:355-373`).
  ⚠️ **Esta línea decía además que la resolución por línea era "inherente, cada línea tiene la
  suya", y es FALSO** — lo midió la tercera revisión: los tres catálogos que hacen falta se
  piden con `(tenantId, itemId)` y nada de la línea, así que se batchean enteros. Queda
  corregida acá y no borrada porque la constraint leída sola bendecía justo el N+1 que después
  hubo que sacar; ver el bloque de ejecución.
- El cruce por índice `dto.lineas[i]` ↔ `resultado.lineas[i]` es invariante del motor: no
  filtrar ni reordenar líneas en el camino.


---

## ✅ Ejecutado el 2026-08-30

**Las cinco tareas fueron a un solo commit**, contra lo que este plan decía. Lo forzó la
primera revisión independiente: con la Task 1 sola, `main` quedaba con un backend que ignora
`precioUnitario` y dos clientes que lo siguen mandando sin mandar `personalizacion`. El pipe
descarta el campo y el preview cae a `item.precioBase`, o sea **pierde los extras enteros**.
Antes el preview mentía solo en moneda extranjera; partido, mentiría en **todas**, CLP
incluida — y ese número es el que cobra el cajero. Las Tasks 4 y 5 se sumaron porque sin la 4
el docblock de la 1 afirmaba algo falso, y porque la tabla de documentación viva pide las docs
en el mismo commit.

**Gate** (corrido entero contra el diff final, no contra un árbol anterior): backend
`lint:check` 0 errores, `typecheck`, `test` **2391/2391** y `test:e2e` **completo** (51 suites,
665 tests) con `reset-db.sh` antes y `--verificar` después; frontend `build`, `test` 927,
`typecheck:ratchet`, `design:check`, y los **22 de Playwright** contra el stack real, incluida
la cuenta de salón de punta a punta. Smoke en el navegador: el POS manda `personalizacion` sin
ningún precio y recibe `precioUnitario: "5400.0000"` calculado en el servidor.

**Seis revisiones independientes, las seis bloquearon.** La primera por siete hallazgos —el
reparto en un commit, la tienda online reenviando el campo nuevo al monto que se autoriza
contra la tarjeta pero no al snapshot que materializa la venta, la rama de combo sin test, un
comentario de e2e que contradecía a su test, una afirmación más ancha que el sistema, un
puntero muerto y el costo de consultas—. La segunda, con todo eso corregido, por dos más:

- **El monto de línea del salón había quedado en `subtotalNeto`**, que viene desbruteado con
  `precio_incluye_impuesto = true`: un plato de carta de $10.000 se dibujaba $8.403 con el
  Total de abajo en bruto. El seed trae la columna en `false`, así que ni el e2e ni el smoke
  lo veían. Va por `precioUnitario × cantidad`, el mismo campo que elige el POS.
- **El N+1 nuevo del preview.** Primero se sacó lo que el cambio agregaba de cero: una línea
  que solo omite no se resuelve y no consulta nada. La **tercera** revisión bloqueó de nuevo, y
  con razón: yo había escrito que la relectura por línea era *"inherente"* y es falso — las
  tres consultas toman `(tenantId, itemId)` y nada de la línea. Se batchearon enteras
  (`cargarCatalogosPersonalizacion`, 2 a 5 consultas que no crecen con las líneas, pasadas a
  los resolvers por un parámetro opcional que no cambia el cobro). Una precuenta de cinco
  líneas con extras pasó de ~18 consultas a 3 o 4, según si alguna receta tiene grupos
  asociados. La **cuarta** revisión encontró que el
  lote quedaba a medias —los mapas solo creaban clave para los ítems CON filas, y la única
  receta personalizable del seed no tiene extras—, así que el N+1 seguía vivo justo en el caso
  sembrado. Y la **quinta** midió que un solo test no alcanzaba: el pre-poblado se revierte por
  loader, así que hace falta **un caso por mapa** (receta sin extras, receta sin ingredientes,
  combo sin componentes receta) para que los tres mutantes fallen. La **sexta** bajó a
  veracidad pura: dos docblocks que mis inserciones dejaron pegados al símbolo equivocado, el
  conteo viejo sobreviviendo en este mismo archivo, y el `every` del combo, que quedó con un
  test que arma el catálogo mutilado a mano —sin él, cobra 0 donde debe cobrar 1500—.

---

## Lo que la entrada del backlog decía mal (verificado el 2026-08-30)

La § 4 afirma que POS y salones mandan el override **en la venta** y que el motor lo cobra
sin convertir. **Es falso, y el `calcular.dto.ts` ya lo decía por escrito** ("al de venta no
lo manda nadie"). Lo medido:

| | Qué manda | Qué pasa |
|---|---|---|
| `POST /ventas` | Nadie manda `precioUnitario` | `ventas.service.ts:441` recalcula `precioBase + precioExtraTotal` y **convierte**. El cobro está bien. |
| `POST /calculo-precios/calcular` | POS y salones mandan `precioBase + extras` sin convertir | `resolverLinea` lo usa tal cual. **La pantalla miente.** |

La escena medida (receta en USD a 10, extra 2, tasa 950, IVA 19%): el POS muestra
`Total $14` y la venta se persiste con `totalFinal: "13566.0000"`. El daño es que el cajero
cobra contra el número falso — la venta quedó `pagada_parcial`.

**Segundo hallazgo, del mismo tipo y hasta hoy sin anotar:** en salones el preview tasa
desde el **snapshot congelado** de la línea (`precioExtra` del momento en que se agregó) y
`cerrarCuenta` mapea ese snapshot de vuelta a ids y deja que `ventas.service` **re-tase
contra el catálogo vivo** (`salones.service.ts:1133-1167`). Si un extra cambia de precio con
la mesa sentada, la pantalla y el cobro difieren. Este plan lo cierra por construcción: el
preview pasa a re-tasar por el mismo camino que el cobro.

---

> ⚠️ **Los pasos de cierre de cada tarea dicen "commit" y hubo UNO SOLO.** Las cinco tareas
> fueron a un commit por la razón que explica el bloque de ejecución de arriba: partirlas
> dejaba `main` peor. Los checkboxes marcan que el trabajo de cada paso se hizo, no que hubo
> cinco commits.

## Task 1: El motor tasa la personalización

**Files:**
- Modify: `backend/src/modules/calculo-precios/dto/calcular.dto.ts`
- Modify: `backend/src/modules/calculo-precios/calculo-precios.service.ts`
- Modify: `backend/src/modules/ventas/ventas.service.ts` (el llamador interno)
- Test: `backend/src/modules/calculo-precios/calculo-precios.service.spec.ts`
- Test: `backend/test/calculo-precios.e2e-spec.ts`

**Interfaces:**
- Produce: `LineaDto.personalizacion?: PersonalizacionRecetaDto` (el mismo DTO que ya usa
  `LineaVentaDto`, importado de `common/dto/personalizacion-receta.dto.ts`).
- Produce: el canal interno que reemplaza al override. Nombre y forma exactos los decide
  el spike del paso 1 —hay dos salidas razonables: un campo aparte en un tipo más ancho que
  el DTO HTTP, o un parámetro de `calcular()`—; lo que **no** es negociable es que sobre
  HTTP no quede ninguna forma de fijar el precio de una línea, y que el nombre diga
  "ya convertido", no "override".
- Consume: `ItemsService.resolverPersonalizacionReceta` / `resolverPersonalizacionCombo`
  (ya inyectado, `calculo-precios.service.ts:67`), que devuelven `{ snapshot, precioExtraTotal }`
  con `precioExtraTotal` ya en `toFixed(4)`.

- [x] **Paso 1 — Spike: decidir el canal interno.** ✅ **Decidido, medido sobre el código:**

      `calcular(tenantId, dto, configPrecargada?)` recibe de `ventas.service` un **objeto
      literal**, no una instancia del DTO (`ventas.service.ts:468`). Así que el DTO HTTP y la
      entrada del service pueden divergir sin tocar el llamador:

      - `LineaDto` (HTTP): `precioUnitario` **fuera**, `personalizacion` **adentro**.
      - Entrada del service: `LineaDto & { precioUnitarioResuelto?: string }`. El nombre dice
        lo que es —**un precio ya convertido a moneda oficial**, no un override del catálogo—
        y el `ValidationPipe` corre con `whitelist: true` (`main.ts:19`), así que un cliente
        que lo mande por HTTP **se lo comen**: el campo no está en la clase del DTO y el pipe
        lo saca. Fijar el precio desde afuera queda estructuralmente imposible.
      - `calcular()` resuelve la personalización **solo en las líneas sin
        `precioUnitarioResuelto`**. La venta ya la resolvió para el snapshot y el stock, así
        que `POST /ventas` no paga ni una consulta nueva.

      **No hace falta ninguna dependencia nueva:** `CalculoPreciosService` ya inyecta
      `ItemsService` y `Db` (`:67` y `:74`), y los dos resolvers aceptan `EntityManager | Db`
      (`items.service.ts:2371`, `:2646`). El constructor no cambia → su spec no se rompe por DI.

      **Dónde va:** después de `cargarBasePorIds` (que devuelve `tipo` en `mapRow`) y antes
      del `.map(resolverLinea)`. `resolverLinea` deja de leer `linea.precioUnitario` y recibe
      el precio ya decidido por índice.

- [x] **Paso 2 — Test unitario que falla.** En `calculo-precios.service.spec.ts`, reemplazar
      los dos tests contiguos que fijan las dos ramas (`'respeta el override de precioUnitario'`
      y `'convierte el precio del ítem a moneda oficial cuando no hay override'`) por el par
      que corresponde a la conducta nueva: (a) una línea **sin** personalización de un ítem en
      USD sigue convirtiendo; (b) una línea **con** personalización de un ítem en USD suma el
      extra **y convierte el total**. Con la receta a 10 USD, extra 2 y tasa 950, (b) tiene que
      dar `subtotalNeto: '11400.000000'`.

- [x] **Paso 3 — Correrlo y verlo fallar.** `cd backend && npm test -- calculo-precios.service`
      Esperado: (b) falla porque el motor todavía no conoce `personalizacion`.

- [x] **Paso 4 — Implementar.** En `calcular()`, antes de resolver líneas: recorrer
      `dto.lineas` en un `for` secuencial y, para las de `tipo` `receta`/`combo` con
      `personalizacion`, resolver con `ItemsService` (pasándole `this.db`, como hace
      `salones.service.ts:660`) y quedarse con `precioExtraTotal`. El precio de la línea pasa a
      ser `convertirAMonedaOficial(precioBase + precioExtraTotal, item.monedaId, …)`, con el
      `.toFixed(4)` de la suma **sin redondear** (los dos sumandos ya vienen con 4 decimales
      exactos — copiar el razonamiento de `ventas.service.ts:428-437`, no reinventarlo).
      Sacar `precioUnitario` de `LineaDto` y agregar `personalizacion`.

- [x] **Paso 5 — Verde y mutante.** `npm test -- calculo-precios.service`.
      Después, el mutante que **revierte**: volver la línea a usar el precio sin convertir y
      confirmar que (b) falla. ✅ **Medido: falla con `subtotalNeto '12.000000'`** —el precio
      en dólares leído como pesos, o sea la conducta vieja exacta—. Este paso decía `14.28`,
      que era la predicción escrita antes de ejecutar: ese número es el `totalFinal` con IVA,
      no el `subtotalNeto` que el test afirma. Revertir el mutante y verificar
      en los logs del backend que el watcher re-arrancó con el fuente limpio.

- [x] **Paso 6 — E2E.** En `calculo-precios.e2e-spec.ts`: los dos tests del override
      (`:159` negativo, `:179` cero) pierden su sujeto — reemplazarlos por el caso real, que es
      lo que protegen de verdad: una línea con personalización de un ítem en moneda extranjera
      devuelve el total convertido. Correr `./scripts/reset-db.sh` antes.
      ✅ **Desviación:** en `calculo-precios.e2e-spec.ts` quedó el test del strip del whitelist
      (que el campo ya no decida la plata) y **el caso de la moneda se escribió en
      `recetas.e2e-spec.ts`**, donde ya vivía el fixture en USD — y cubre más: compara el total
      del preview contra el de la venta y cobra con el número del preview, así que si vuelven a
      divergir la venta queda `pagada_parcial`.

- [x] **Paso 7 — Gate + revisión + commit.** Gate completo de backend. Revisión
      independiente `domain-reviewer` sobre el diff staged, recibo, commit.

---

## Task 2: El POS deja de mandar precio

**Files:**
- Modify: `frontend/app/composables/useVenta.ts`
- Modify: `frontend/app/components/ventas/CarritoPanel.vue`
- Modify: `frontend/app/components/ventas/ItemPersonalizacionDrawer.vue` (si el parámetro
  del emit queda huérfano)
- Test: `frontend/app/composables/useVenta.spec.ts`

**Interfaces:**
- Consume: `LineaDto.personalizacion` de la Task 1.
- Produce: `toCalcularInput` manda `personalizacion` y **ningún** precio. `CarritoLinea`
  pierde `precioUnitarioOverride`.

- [x] **Paso 1 — Test que falla:** `toCalcularInput` de una línea con extras manda
      `personalizacion` y no manda `precioUnitario`.
- [x] **Paso 2 — Correrlo y verlo fallar.** `cd frontend && npm test -- useVenta`
- [x] **Paso 3 — Implementar.** `toCalcularInput` mapea la personalización con la **misma
      forma** que `toVentaLineasBody` (que ya la manda bien): ids y `unidades`, nunca precios.
      Sacar `precioUnitarioOverride` de `CarritoLinea`, de `agregarLinea` y de `add`.
- [x] **Paso 4 — El `c/u` del carrito.** `CarritoPanel.vue:207` calcula el precio unitario en
      el cliente (`convertirAMonedaOficial(precioUnitarioOverride ?? precioBase)`). Pasa a leer
      `calculoVigente?.lineas[index]?.precioUnitario`, que ya viene convertido del backend.
      **Decidir y dejar escrito qué muestra cuando el preview no está vigente** — la fila de
      al lado (`AdvertenciasPrecio`) resuelve el mismo caso con `?? []`; el precio no puede
      quedar en blanco ni mostrar un número viejo sin avisar.
- [x] **Paso 5 — Verde.** `npm test -- useVenta` + `npm run build` + `typecheck:ratchet`.
- [x] **Paso 6 — Smoke en el navegador** (devtools sobre la ventana real, no Claude Browser):
      agregar al carrito una receta con extra pago, confirmar que el total del POS coincide con
      el `totalFinal` que devuelve `POST /ventas`.
- [x] **Paso 7 — Gate + revisión + commit.**

---

## Task 3: Salones deja de mandar precio

**Files:**
- Modify: `frontend/app/composables/useSalones.ts`
- Modify: `frontend/app/pages/salones/index.vue`
- Test: `frontend/app/composables/useSalones.spec.ts`

**Interfaces:**
- Consume: `LineaDto.personalizacion` de la Task 1.
- Produce: `cuentaToCalcularInput` manda `personalizacion` mapeada desde el snapshot de la
  línea, con **la misma transformación que ya hace `cerrarCuenta` en el backend**
  (`salones.service.ts:1133-1167`): snapshot → ids + `unidades`. Es la garantía de que
  preview y cobro tasan lo mismo.

- [x] **Paso 1 — Test que falla:** `cuentaToCalcularInput` de una cuenta con una línea con
      extras manda `personalizacion` y no manda `precioUnitario`.
- [x] **Paso 2 — Correrlo y verlo fallar.**
- [x] **Paso 3 — Implementar** el mapeo snapshot → payload. Ojo con los tres niveles:
      `extras`, `grupos` y `componentes` (los combos anidados). El backend ya tiene el molde
      exacto; copiarlo, no improvisarlo.
- [x] **Paso 4 — El subtotal de la línea.** `lineaSubtotal` (`index.vue:1064`) multiplica
      `precioUnitarioLinea × cantidad` y lo formatea **en la moneda del ítem**
      (`formatMonto(…, linea.monedaId)`). Pasa a leer `calculoVigente?.lineas[index]` —ya
      convertido, ya en moneda oficial— con la misma decisión de "preview no vigente" de la
      Task 2. Con eso `precioUnitarioLinea` queda sin consumidores: **verificarlo con un grep
      del repo entero antes de borrarlo**, y borrar también su spec.
- [x] **Paso 5 — Verde** + `npm run build` + `typecheck:ratchet` + `design:check`.
- [x] **Paso 6 — Smoke en el navegador:** abrir una cuenta, agregar una receta con extra
      pago, confirmar que el total de la precuenta coincide con el de la venta al cerrar.
- [x] **Paso 7 — Gate + revisión + commit.**

---

## Task 4: Sacar el override de la venta

**Files:**
- Modify: `backend/src/modules/ventas/dto/create-venta.dto.ts`
- Modify: `backend/src/modules/ventas/ventas.service.ts`
- Test: `backend/test/ventas.e2e-spec.ts`, `backend/test/venta-total-cero.e2e-spec.ts`

- [x] **Paso 1 — Sacar el campo.** `LineaVentaDto.precioUnitario` fuera, con sus decoradores
      (`@IsDecimalPositivo`, `@EsCosto`) y los imports que queden sin uso.
      ⚠️ El `ValidationPipe` corre con `whitelist: true` **sin** `forbidNonWhitelisted`
      (`main.ts:19`): un cliente viejo que lo siga mandando **no recibe 400, se le ignora en
      silencio**. Dejarlo escrito en el commit.
- [x] **Paso 2 — Simplificar el service.** `ventas.service.ts:441` pasa de
      `pers != null ? … : (linea.precioUnitario ?? item.precioBase)` a
      `pers != null ? … : item.precioBase`.
- [x] **Paso 3 — Los e2e que lo usaban.** `ventas.e2e-spec.ts:327` manda `precioUnitario` en
      el body de la venta: entender **qué está protegiendo ese test** antes de tocarlo (si el
      escenario necesita un precio distinto al del catálogo, el camino es un ítem sembrado con
      ese precio, no un override). Actualizar el comentario de
      `venta-total-cero.e2e-spec.ts:82`, que explica el campo.
- [x] **Paso 4 — Gate completo + revisión + commit.**

---

## Task 5: Documentación y cierre

**Files:**
- Modify: `docs/features/motor-calculo-precios.md`
- Modify: `docs/features/personalizacion-recetas.md`
- Modify: `docs/agent/pendientes.md` (sacar la entrada de § 4)
- Modify: `docs/agent/resueltos.md` (entrada de cierre)

- [x] **Paso 1 — El motor.** Documentar la regla nueva en una línea que se pueda citar:
      *el precio de una línea lo calcula el servidor; el cliente manda qué se pidió, nunca
      cuánto vale*. Y el porqué: el override era el único lugar del sistema donde un precio
      cruzaba la frontera sin convertir.
- [x] **Paso 2 — El cierre en `resueltos.md`**, con las dos premisas que resultaron falsas
      (el override no viajaba en la venta; el cobro estaba bien) y el hallazgo extra
      (preview congelado vs. cobro re-tasado en salones).
- [x] **Paso 3 — `CLAUDE.md`:** revisar si el párrafo de "Detenerse y preguntar" nombra este
      frente. Si lo nombra, se actualiza **en el mismo commit** (es la regla que ya se rompió
      cuatro veces).
- [x] **Paso 4 — Commit.**
