# La boleta sale de la venta — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la boleta se arme con lo que el servidor cobró —no con el carrito vivo— y que una
venta ya cobrada se pueda reimprimir marcada como copia.

**Architecture:** un armador de boleta en el backend (`VentasService.armarBoleta`) que lee la
venta persistida y devuelve un payload cerrado; el cierre de cuenta y la creación de venta lo
adjuntan a su respuesta, y `GET /api/ventas/:id/boleta` lo sirve para reimprimir con
`Ventas:Anular`. La pantalla deja de recalcular para imprimir: pasa el payload a
`buildBoletaTicket`, que aprende un modo copia.

**Tech Stack:** NestJS + TypeORM con SQL crudo vía `Db`/`EntityManager`; Nuxt 4 + Nuxt UI;
Jest (unit + e2e supertest); Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-boleta-desde-la-venta-design.md`

## Global Constraints

- Directo sobre `main`, sin ramas ni PRs. **Push solo si el owner lo pide. Nunca `--no-verify`.**
- **Los implementadores no commitean.** Dejan staged **con rutas explícitas** (nunca `git add -A`:
  hay otras sesiones en el repo). El controlador revisa y commitea.
- Antes de cada `npm run test:e2e`: `./scripts/reset-db.sh`. **Todo e2e en primer plano.** No tocar
  `backend/src` con un e2e corriendo: el watcher recompila y re-siembra.
- Gate completo por tarea: backend `lint:check`, `typecheck`, `npm test`, `test:e2e`; frontend
  `build`, `npm test`, `typecheck:ratchet`, `design:check`.
- **Motor de cálculo intocable** (`backend/src/modules/calculo-precios/`). La boleta se arma con lo
  ya persistido en `venta_detalles` y sus tablas hijas: **ninguna tarea llama al motor**.
- Soft delete: toda lectura nueva filtra `eliminado_el IS NULL`; la excepción lleva su porqué
  dentro del SQL. **Sin N+1**: las líneas, impuestos, promociones y pagos se leen una vez cada uno
  para la venta entera.
- `tenant_id` y el usuario salen del token (`JwtUser`), nunca del body.
- Plata con Decimal.js; los importes ya vienen cuantizados de la venta y **no se recalculan**.
- Permiso de la reimpresión: el que ya existe, `Ventas` × `Anular`
  (`moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440334'`). **No se crea un permiso nuevo.**
- Texto de la copia: la palabra `COPIA` y la fecha/hora de reimpresión. El original no lleva marca.
- Sin reintento automático de impresión: se avisa y el usuario reimprime.
- Subagentes en Sonnet salvo decisión del owner.

---

### Task 1: El armador de la boleta en el backend

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` (interfaz exportada + `armarBoleta`)
- Test: `backend/src/modules/ventas/ventas.service.spec.ts`

**Interfaces:**
- Consumes: la venta ya persistida (`ventas`, `venta_detalles`, `venta_impuestos`,
  `venta_promociones`, `pagos`).
- Produces:
  ```ts
  export interface BoletaVenta {
    ventaId: string
    fecha: Date
    canal: string
    mesa: string | null
    cuentaNumero: number | null
    cajero: string | null
    items: {
      descripcion: string
      cantidad: string
      cantidadPresentacion: string | null
      unidadCodigoPresentacion: string | null
      unidadCodigoBase: string
      precioUnitario: string
      totalLinea: string
      personalizacionDetalle?: { texto: string; monto: string }[]
      comentario?: string
    }[]
    totales: {
      subtotalNeto: string
      totalDescuentos: string
      totalRecargos: string
      totalImpuestos: string
      totalFinal: string
    }
    impuestos: { nombre: string; tasa: string; monto: string }[]
    promociones: { id: string; nombre: string; monto: string }[]
    propina: { monto: string } | null
    pagos: { nombre: string; monto: string }[]
    vuelto: string | null
  }

  async armarBoleta(
    runner: EntityManager | Db,
    tenantId: string,
    ventaId: string,
  ): Promise<BoletaVenta>
  ```
  Los nombres de `totales` son **los de `TicketTotales` del frontend**
  (`frontend/app/utils/ticket-builder.ts:151-157`), no los de la fila de `ventas`
  (`total_bruto`, `total_descuentos`…): el mapeo se hace acá, una vez, y no en la pantalla.

**Contexto que el implementador necesita:**
- `findOne` ya arma casi todo esto, pero **su `SELECT` de detalles no trae
  `personalizacion`** (`backend/src/modules/ventas/ventas.service.ts:2964-2979`): el armador
  nuevo sí la trae, y de ahí salen `personalizacionDetalle` y `comentario`. El helper que
  convierte el snapshot en líneas con monto ya existe (`detallePersonalizacion`, usado en
  `ventas.service.ts:1049-1065`); reusarlo, no reescribirlo.
- Los nombres de método de pago salen de `metodos_pago`; hoy los resuelve la pantalla
  (`index.vue:2822-2825`). Acá se resuelven en **una** query con `= ANY($1)`, no una por pago.
- `runner` acepta el `EntityManager` de una transacción abierta (lo usa la Task 3) o el `Db`
  (lo usa la Task 2).
- ⚠️ **La propina hay que rastrearla antes de escribirla**: el cierre la recibe en el body
  (`propinaMonto`, `index.vue:2797`), pero de dónde sale al leerla —columna de `ventas`, tabla
  propia o aplicación de pago (`pago_aplicaciones` tipo `'propina'`, `ventas.service.ts:3391-3400`)—
  se mide abriendo el código, no se supone. Si la venta no la guarda donde el payload la pide,
  **parar y reportar** en vez de inventar el campo.

- [x] **Step 1: Escribir los tests que fallan**

En `ventas.service.spec.ts`, con el molde de mock que ya usa ese archivo:
- una venta de dos líneas devuelve `items` en el orden persistido, con `descripcion`,
  `precioUnitario` y `totalLinea` **tal como están guardados** (fixtures con valores distintos
  entre sí: nada de `1`);
- una línea con personalización devuelve `personalizacionDetalle` con su monto y el
  `comentario`;
- los totales se mapean con los nombres del ticket (`subtotalNeto` sale de `total_bruto`);
- dos pagos de métodos distintos devuelven sus **nombres**, y el vuelto del pago en efectivo;
- una venta de otro tenant no se encuentra (404).

- [x] **Step 2: Verlos fallar** — `cd backend && npx jest src/modules/ventas/ventas.service.spec.ts`

- [x] **Step 3: Implementar `armarBoleta`**

Una query por tabla, todas con `tenant_id` y `eliminado_el IS NULL`, y **cero queries dentro de
un loop**. La cabecera (mesa, número de cuenta, cajero) sale del `JOIN` a `cuentas`/`mesas` y al
usuario que cerró, con `LEFT JOIN`: una venta del POS no tiene mesa y eso no es un error.

- [x] **Step 4: Verlos pasar** — el mismo comando, y `npm run lint:check && npm run typecheck`

---

### Task 2: La ruta para reimprimir

**Files:**
- Modify: `backend/src/modules/ventas/ventas.controller.ts`
- Test: `backend/test/boleta-reimpresion.e2e-spec.ts` (nuevo)
- Docs: `docs/features/roles-permisos.md`

**Interfaces:**
- Consumes: `VentasService.armarBoleta` (Task 1).
- Produces: `GET /api/ventas/:id/boleta` → `BoletaVenta`, con
  `@RequiresPermiso('Ventas', 'Anular')`.

El molde exacto de la ruta —decoradores, `ParseUUIDPipe`, cómo se lee `req.user`— está en el
`anular` del mismo controller (`backend/src/modules/ventas/ventas.controller.ts:66-82`).
**Abrirlo y copiar esa forma**, no escribirla de memoria.

- [x] **Step 1: Escribir el e2e que falla**

`backend/test/boleta-reimpresion.e2e-spec.ts`, con el molde de
`backend/test/salones-anular-linea.e2e-spec.ts` (login propio, datos propios, limpieza en
`afterAll` con `console.warn`, nunca la garzona Ana del seed):
- un usuario **con** `Ventas:Leer` y **sin** `Ventas:Anular` recibe **403**;
- el admin recibe **200** y el payload trae líneas, totales, impuestos y pagos;
- una venta de **otro tenant** recibe **404**;
- una venta con un plato personalizado trae su `personalizacionDetalle` (el caso que
  `GET /api/ventas/:id` no puede dar).

⚠️ Todo helper que lea `.body` mira antes el `.status` (`node scripts/check-e2e-status.mjs --staged`).

- [x] **Step 2: Verlos fallar** — `./scripts/reset-db.sh` y después
  `cd backend && npx jest --config ./test/jest-e2e.json test/boleta-reimpresion.e2e-spec.ts`

- [x] **Step 3: Implementar la ruta**

- [x] **Step 4: Verlos pasar, y documentar** en `roles-permisos.md` que `Ventas:Anular` ahora
  también habilita reimprimir una boleta, con el porqué (es la operación sensible del módulo y
  el owner eligió no crear un permiso nuevo).

---

### Task 3: El cierre de cuenta devuelve la boleta, y el salón la imprime

**Files:**
- Modify: `backend/src/modules/salones/salones.service.ts` (`cerrarCuenta`)
- Modify: `frontend/app/composables/useSalones.ts` (tipo de `cerrarCuenta`)
- Modify: `frontend/app/pages/salones/index.vue` (`cerrarCuentaConPin`)
- Test: `backend/src/modules/salones/salones.service.spec.ts`,
  `backend/test/salones-cerrar-cuenta.e2e-spec.ts` (o el e2e de cierre que ya exista),
  `frontend/app/pages/salones/index.nuxt.spec.ts`

**Interfaces:**
- Consumes: `armarBoleta` (Task 1), llamado **dentro de la transacción del cierre** con su
  `manager`.
- Produces: `POST /api/cuentas/:id/cerrar` → `{ cuenta: CuentaDetalle; ventaId: string; boleta: BoletaVenta }`.

Hoy el cierre termina así (`backend/src/modules/salones/salones.service.ts:2006-2007`):

```ts
      const detalle = await this.armarDetalle(tenantId, cuenta, manager);
      return { cuenta: detalle, ventaId: venta.id };
```

y la pantalla imprime con lo que recalculó (`frontend/app/pages/salones/index.vue:2808-2836`),
con el `else` que avisa *"Venta generada, pero no se pudo generar la boleta"*. **Ese `else`
desaparece**: la boleta ya viene en la respuesta. El único aviso que queda es el `catch` de la
impresión.

⚠️ **La cantidad del ticket:** hoy sale de `itemsParaTicket`, que cruza por índice el resultado
del motor con las líneas de la cuenta y resuelve la unidad base mirando el catálogo cargado
(`index.vue:2392`). Con el payload nuevo la unidad viene en la línea
(`unidadCodigoBase`/`unidadCodigoPresentacion`), así que el cruce por índice **no se usa para la
boleta**. `itemsParaTicket` sigue vivo para la precuenta: no se toca.

- [x] **Step 1: Escribir los tests que fallan**
  - Unit del service: el cierre devuelve `boleta` y sale de `armarBoleta` (mock), con el
    `manager` de la transacción.
  - E2E: cerrar una cuenta con dos líneas devuelve la boleta con esas dos líneas y el total
    cobrado; el payload es **igual** al que devuelve `GET /api/ventas/:id/boleta` para esa
    misma venta (la comparación es la prueba que importa).
  - Unit de pantalla: `cerrarCuentaConPin` imprime con los datos de `boleta` **aunque
    `activeCuenta` haya cambiado a otra cuenta durante el `await`** — hoy ese es justo el caso
    que se queda sin papel. Y ya no muestra el aviso "no se pudo generar la boleta".
- [x] **Step 2: Verlos fallar**
- [x] **Step 3: Implementar** backend y pantalla.
- [x] **Step 4: Verlos pasar y gate completo**

---

### Task 4: El POS también imprime lo que cobró

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` (respuesta de `crear`),
  `backend/src/modules/ventas/ventas.controller.ts` si hace falta
- Modify: `frontend/app/pages/ventas/pos.vue`
- Test: `backend/test/` (el e2e de ventas que ya cubre `POST /api/ventas`),
  `frontend/app/pages/ventas/pos.nuxt.spec.ts` si existe; si no, el spec de la página que haya

`crearEnTransaccion` ya devuelve `{ ...venta, detalles, advertencias }`
(`backend/src/modules/ventas/ventas.service.ts:1069`). La respuesta de la ruta suma `boleta`,
del mismo `armarBoleta`. La pantalla imprime ese payload y pierde su `else`
(`frontend/app/pages/ventas/pos.vue:305-307`), igual que el salón.

- [x] **Step 1: Tests que fallan** — e2e: la creación de venta devuelve la boleta con sus
  líneas y totales; unit de pantalla: imprime desde el payload.
- [x] **Step 2: Verlos fallar**
- [x] **Step 3: Implementar**
- [x] **Step 4: Verlos pasar y gate completo**

---

### Task 5: Reimprimir, marcada COPIA

**Files:**
- Modify: `frontend/app/utils/ticket-builder.ts` (`buildBoletaTicket`),
  `frontend/app/composables/useImpresoras.ts` (`imprimirBoleta`)
- Modify: `frontend/app/components/ventas/VentaDetalleDrawer.vue`
- Test: `frontend/app/utils/ticket-builder.spec.ts`,
  `frontend/app/components/ventas/VentaDetalleDrawer.nuxt.spec.ts` (o el spec que cubra ese
  componente)
- Docs: `docs/features/impresion-termica.md`, `docs/features/ventas.md`

**Interfaces:**
- Consumes: `GET /api/ventas/:id/boleta` (Task 2) y el payload de la Task 1.
- Produces: `buildBoletaTicket({ …, copia?: { impresaEl: Date } })`.

`buildBoletaTicket` arma la cabecera en `frontend/app/utils/ticket-builder.ts:452-467`
(emisor → tipo de documento → separador). La marca va **después del tipo de documento**, para que
se lea antes que los ítems. `imprimirBoleta` (`frontend/app/composables/useImpresoras.ts:261-280`)
suma el mismo parámetro opcional y lo pasa derecho.

El botón va en el bloque `#actions` del drawer, al lado de *Anular* y *Nota de crédito*
(`VentaDetalleDrawer.vue:1182-1204`), con la misma forma de `UButton` y con
`v-if="permissionsStore.can('Ventas', 'Anular')"` — el permiso de verdad lo enforcea la ruta.
El drawer ya trae la venta por `ventaId` y la pide con `useApiFetch`
(`VentaDetalleDrawer.vue:620-630`): la boleta se pide igual, **al apretar el botón**, no al abrir.

- [x] **Step 1: Tests que fallan**
  - `ticket-builder.spec.ts`: con `copia` imprime `COPIA` y la fecha/hora; **sin** `copia` el
    ticket sale **idéntico** al de hoy (control: sin este segundo test, un ticket que siempre
    imprime la marca pasaría igual).
  - Drawer: el botón no aparece sin `Ventas:Anular` y sí aparece con él; al apretarlo pide
    `GET /api/ventas/:id/boleta` e imprime con `copia`.
- [x] **Step 2: Verlos fallar**
- [x] **Step 3: Implementar**
- [x] **Step 4: Verlos pasar, gate completo y docs**

---

### Task 6: El caso que hoy se pierde, en el navegador, y el cierre del frente

**Files:**
- Create: `frontend/e2e/salones/boleta-al-cobrar.spec.ts`
- Docs: `docs/features/impresion-termica.md`, `docs/features/ventas.md`, `docs/PRODUCTO.md`,
  `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/resueltos.md`

**El e2e:** con el molde de `frontend/e2e/salones/cuenta-hasta-cobro.spec.ts` (el cobro con PIN
está en `:292-307`), pedir en una cuenta, **navegar a otra cuenta o salir de la mesa**, cobrar la
primera, y verificar que **no** aparece el aviso *"no se pudo generar la boleta"*.

⚠️ **Lo que el navegador puede probar y lo que no:** en el e2e no hay QZ Tray, así que el papel
no se imprime y no se puede afirmar su contenido — eso lo cubren los unit de
`buildBoletaTicket`. Lo que sí prueba, y es exactamente el bug, es que el camino ya no se queda
sin boleta. El test tiene que **fallar** contra el código de antes de la Task 3: verificarlo
revirtiendo esa tarea, no suponerlo.

**Docs de cierre:** `pendientes.md` mueve la entrada *"La venta que se cierra sin cálculo queda
sin boleta"* a `resueltos.md` con los commits (la regla del repo: en `pendientes.md` queda solo
lo abierto). En `resueltos.md` hay que corregir la afirmación *"ningún camino reimprime una
venta pasada"*, que esta feature deja falsa: buscarla y dejar el puntero a la ruta nueva.
`impresion-termica.md` suma la copia y de dónde sale la boleta; `ventas.md`, el botón de
reimprimir; `PRODUCTO.md` y `ESTADO.md`, la regla y la fila.

- [x] **Step 1: Escribir el e2e y verlo fallar contra el código viejo**
- [x] **Step 2: Verlo pasar con el código nuevo**
- [x] **Step 3: Docs**
- [x] **Step 4: Gate completo**

## Verification

- **Cada tarea:** gate completo y `domain-reviewer` LIMPIO sobre lo staged; además
  `api-security-reviewer` en las tareas 2, 3 y 4 (tocan controllers o respuestas de la API).
- **La prueba de fondo:** el payload del cierre y el de la reimpresión, para la misma venta,
  tienen que ser iguales. Si divergen, la boleta reimpresa miente.
- **Mutantes**, al cerrar la Task 6. Cada uno revierte al código anterior y tiene que matar al
  menos un test:
  - la ruta de boleta sin `@RequiresPermiso('Ventas', 'Anular')`;
  - `armarBoleta` sin el filtro de tenant;
  - el `SELECT` de detalles sin `personalizacion`;
  - `buildBoletaTicket` imprimiendo siempre la marca de copia;
  - el cierre sin adjuntar la boleta.
- **Al final:** revisión de toda la rama, desde el commit de la spec (`7a698453`) hasta el
  último de la Task 6.
- **Railway:** no hay tabla ni columna nueva; el deploy es código. Verificar igual el CI y el
  smoke después del push.

## Decisions / Open questions

- **Decidido por el owner (2026-09-17):** la boleta la manda el servidor; el botón de reimprimir
  se construye ahora; reimprimir usa `Ventas:Anular`; la copia sale marcada.
- **Decidido en este plan, no en la spec:**
  - los nombres de `totales` en el payload son los del ticket (`subtotalNeto`…), no los de la
    tabla `ventas`, para que el mapeo viva en un solo lado;
  - la boleta se pide al apretar el botón, no al abrir el drawer;
  - `itemsParaTicket` y la precuenta no se tocan.
- **Fuera de alcance, anotado en la spec:** la nota de crédito, la venta anulada y la emisión
  electrónica (**ADR-010**). Cuando exista el DTE, la reimpresión se revisa en su propio frente.
