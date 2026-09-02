# Lo que una mesa pide queda apartado — plan de implementación

> **Para quien lo ejecute:** REQUIRED SUB-SKILL: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans`, tarea por tarea. Los pasos usan checkbox
> (`- [ ]`) para ir marcando.

**Goal:** que pedir una línea en una mesa aparte el stock que esa línea va a consumir, para
que dos mesas no puedan pedir la misma última unidad y el choque no aparezca recién al cobrar.

**Architecture:** la reserva **no se guarda en ningún lado**. `disponible` pasa a ser
`stock − comprometido`, donde el comprometido se deduce de las líneas vivas de cuentas
`abierta`. Cerrar, cancelar, quitar la línea, bajarle la cantidad y fusionar cuentas sueltan
la reserva sin código nuevo, porque la reserva no es un estado: es una consecuencia.

**Tech Stack:** NestJS + TypeORM + PostgreSQL 15 (backend), Nuxt 4 (frontend), Decimal.js
para toda la aritmética.

**Spec:** [`docs/superpowers/specs/2026-09-01-reserva-de-stock-al-pedir-design.md`](../specs/2026-09-01-reserva-de-stock-al-pedir-design.md)

## Global Constraints

- **`tenant_id` siempre del token**, nunca del body ni de la ruta.
- **Toda cantidad y toda plata con `Decimal.js`**, nunca `number` nativo.
- **Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`**, salvo excepción con el porqué
  escrito en la propia consulta.
- **Nunca una query por fila (N+1).** El comprometido se resuelve batcheado o con agregación.
- **No se toca `movimientos_inventario`.** La reserva no escribe movimientos, no crea
  entidades y no agrega columnas. Si alguna tarea parece necesitarlo, **parar y preguntar**.
- **No se toca el motor de cálculo de precios** ni nada fiscal.
- Trabajo directo sobre `main`, con el [checklist de cierre](../../../CLAUDE.md) antes de cada
  commit y el recibo de la revisión independiente que pide el pre-commit.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/src/modules/items/items.service.ts` | **Modificar.** Nace `consumoDeLineas` (la expansión pura, Tarea 1) y `calcularDisponibilidadBatch` pasa a descontar el comprometido (Tarea 2) |
| `backend/src/modules/salones/salones.service.ts` | **Modificar.** `agregarLinea` y `actualizarLinea` hacen cumplir el tope (Tareas 3 y 4) |
| `backend/test/reserva-stock-mesa.e2e-spec.ts` | **Crear.** El spec del frente: el choque, la receta, el soltar, el no bloqueante y la concurrencia |
| `frontend/app/composables/useVenta.ts` | **Modificar.** `disponible` deja de distinguir producto de receta (Tarea 8) |
| Docs vivas | `features/salones-mesas.md`, `features/inventario-kardex.md`, `PRODUCTO.md`, `ESTADO.md`, `agent/pendientes.md` (Tarea 9) |

⚠️ **No se crea ningún archivo de servicio nuevo.** `consumoDeLineas` vive en
`ItemsService` porque ahí ya vive la expansión de recetas y combos; sacarla a un archivo
propio sería una segunda forma de resolver lo mismo.

---

## Tarea 1 — La expansión pura: qué consume un conjunto de líneas

> 🔴 **Esta tarea DECIDE la forma de todas las demás.** Por eso las siguientes llevan
> *intención y contrato*, no código exacto: si acá se descubre que la expansión no se puede
> batchear como se espera, las demás se ajustan a lo que salga, no al revés.

**El problema que la hace no-trivial:** una línea no consume lo que dice su receta, consume
lo que dice su receta **modulada por su `personalizacion`** — la hamburguesa sin queso no
gasta queso, la que lleva doble carne gasta el doble, y un combo se abre en sus componentes.
`ItemsService.venderIngredientesReceta` (`items.service.ts:3389`) ya sabe hacer eso, pero
**escribe movimientos**: no sirve para *preguntar* cuánto se consumiría.

**Files:**
- Modify: `backend/src/modules/items/items.service.ts`
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Cuánto consume de cada ingrediente un conjunto de líneas ya pedidas. */
  async consumoDeLineas(
    tenantId: string,
    lineas: {
      itemId: string;
      cantidad: string;
      personalizacion: PersonalizacionRecetaSnapshot | null;
    }[],
    convertir?: ConvertirUnidad,
  ): Promise<Map<string, { cantidad: Decimal; bloqueante: boolean }>>
  ```
  La clave del `Map` es el `itemId` del **ingrediente o producto consumido**. `bloqueante`
  es `false` si **alguna** de las líneas lo consume de forma no bloqueante (el más
  permisivo gana: si un solo camino no frena, no frena).

- [x] **Paso 1: leer los tres caminos de expansión que ya existen y anotar qué comparten**

Leer, sin escribir nada todavía: `venderIngredientesReceta` (`:3389`),
`venderComponentesCombo`, y `calcularDisponibilidadBatch` (`:3903`). Anotar en el mismo
commit, como comentario del docblock de `consumoDeLineas`, **qué parte de la expansión es
común y cuál no**. Esto no es ceremonia: el repo ya pagó caro tener dos expansiones que
derivan.

- [x] **Paso 2: decidir y ESCRIBIR la decisión antes de implementar**

Elegir entre: (a) una consulta agregada que expanda en SQL leyendo el `jsonb` de
`personalizacion`; (b) cargar las líneas y expandir en JS reusando lo que ya existe. Escribir
la decisión y su porqué en el docblock. **Criterio:** gana lo que no duplique la lógica de
personalización, aunque cueste una query más. Si la opción elegida no puede batchearse sin
N+1, **parar y reportar** en vez de aceptar el N+1.

- [x] **Paso 3: escribir el test que falla — la personalización manda**

```ts
it('una línea que omite un ingrediente no lo consume', async () => {
  const consumo = await service.consumoDeLineas(TENANT, [
    { itemId: HAMBURGUESA, cantidad: '1', personalizacion: { omitidos: [QUESO] } },
  ]);
  expect(consumo.has(QUESO)).toBe(false);
  expect(consumo.get(CARNE)!.cantidad.toString()).toBe('0.18');
});
```

- [x] **Paso 4: correr el test y confirmar que falla**

```bash
cd backend && npx jest items.service.spec -t 'omite un ingrediente'
```
Esperado: FAIL, `service.consumoDeLineas is not a function`.

- [x] **Paso 5: implementar según lo decidido en el paso 2**

- [x] **Paso 6: agregar los casos que la expansión tiene que cubrir**

Uno por cada forma, porque son caminos distintos y un solo test no los toca: producto suelto
(consumo directo), receta simple, receta con extra pagado, combo con componentes, opción de
grupo elegida, y **dos líneas del mismo ingrediente que se suman**. Más uno de conversión de
unidades (una receta en gramos sobre un ingrediente en kilos).

- [x] **Paso 7: correr los tests y el gate**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
```

- [x] **Paso 8: commit**

```bash
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit -m "feat(items): qué consume un conjunto de líneas, sin escribir movimientos"
```

---

## Tarea 2 — `disponible` descuenta lo comprometido

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`calcularDisponibilidadBatch`, `:3903`)
- Test: `backend/test/reserva-stock-mesa.e2e-spec.ts` (crear)

**Interfaces:**
- Consumes: `consumoDeLineas` de la Tarea 1.
- Produces: `GET /items` devuelve `disponible` **descontando** lo que las cuentas `abierta`
  ya pidieron, para **todos** los tipos —incluido `producto`, que hoy devuelve `null`—.

- [x] **Paso 1: escribir el e2e que falla**

Producto con `stock = 3`. Una mesa pide 2. `GET /items` tiene que devolver `disponible: 1`.

⚠️ El spec necesita **garzón propio con sesión y turno, salón y mesa propios**: el garzón del
seed lo comparten seis specs y la sesión es única por garzón.

- [x] **Paso 2: correr y confirmar que falla**

```bash
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh
cd backend && npx jest --config ./test/jest-e2e.json --testPathPatterns reserva-stock-mesa
```
Esperado: FAIL — hoy devuelve `disponible: null` para un producto.

- [x] **Paso 3: implementar el descuento**

Una sola consulta para traer las líneas vivas de cuentas `abierta` del tenant, y **una sola**
llamada a `consumoDeLineas` con todas. Nunca una por ítem.

- [x] **Paso 4: correr el e2e y confirmar que pasa**

- [x] **Paso 5: mutante — probar que el test sirve**

Revertir el descuento (volver a leer `ip.stock` pelado) y confirmar que el e2e se pone rojo.
Restaurar con una copia guardada y `diff -q`, **nunca** con `git checkout` (borra cambios sin
commitear del working tree).

- [x] **Paso 6: gate y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
git add -A && git commit -m "feat(items): disponible descuenta lo que las cuentas abiertas ya pidieron"
```

---

## Tarea 3 — Pedir de más rebota al PEDIR, no al cobrar

Es el test que da sentido a todo el frente: reproduce la sonda que abrió el frente.

**Files:**
- Modify: `backend/src/modules/salones/salones.service.ts` (`agregarLinea`)
- Test: `backend/test/reserva-stock-mesa.e2e-spec.ts`

**Interfaces:**
- Consumes: `consumoDeLineas` (Tarea 1).
- Produces: `POST /cuentas/:id/lineas` responde `400` **nombrando el ingrediente que faltó**
  cuando el comprometido más lo pedido supera el stock de un ingrediente **bloqueante**.

- [x] **Paso 1: escribir el e2e que falla — la sonda, tal cual**

Producto con `stock = 1`, dos mesas del mismo salón. La mesa A pide 1 → `201`. La mesa B pide
1 → **`400`**, y el mensaje nombra el producto. Hoy da `201` y el choque aparece al cobrar.

- [x] **Paso 2: correr y confirmar que falla con `201`**

- [x] **Paso 3: implementar el tope en `agregarLinea`**

Bajo el **mismo lock ordenado que la venta ya toma** al descontar
(`docs/patterns/backend.md` §15): se lee el comprometido de las otras líneas vivas, se suma
lo que la línea nueva consumiría, y si supera el stock de un ingrediente bloqueante → `400`
nombrándolo. El mensaje tiene que decir **qué faltó**, no "no hay stock".

- [x] **Paso 4: correr el e2e y confirmar que pasa**

- [x] **Paso 5: mutante — sacar el guard y confirmar que el test vuelve a `201`**

Esto prueba que el test **revierte**, no solo que rompe.

- [x] **Paso 6: gate completo y commit**

```bash
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh
cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd /Users/m2pro/cmatheus/startup-app && ./scripts/reset-db.sh --verificar
git add -A && git commit -m "feat(salones): pedir de más rebota al pedir, no al cobrar"
```

---

## Tarea 4 — Subir la cantidad de una línea también hace cumplir el tope

**Files:**
- Modify: `backend/src/modules/salones/salones.service.ts` (`actualizarLinea`)
- Test: `backend/test/reserva-stock-mesa.e2e-spec.ts`

**Interfaces:**
- Produces: `PATCH` de la línea con una cantidad **mayor** aplica el mismo tope. Bajarla
  **no** valida nada: solo libera.

- [x] **Paso 1: escribir los dos e2e que faltan**

Con `stock = 2` y una línea de 1: subirla a 3 → `400`; bajarla a 0.5 → `200`. El segundo es
el ancla: sin él, un guard que valide siempre pasaría igual y nadie vería que rompe el
camino de bajar.

- [x] **Paso 2: correr y confirmar que el primero falla**

- [x] **Paso 3: implementar, validando SOLO cuando la cantidad sube**

Ojo: `actualizarLinea` recibe un valor **absoluto**, no un delta. El comprometido a comparar
es el de las otras líneas más la cantidad nueva de ésta, no la suma de las dos.

- [x] **Paso 4: correr los dos e2e**

- [x] **Paso 5: mutante — validar también al bajar, y confirmar que el ancla se pone roja**

- [x] **Paso 6: gate y commit**

---

## Tarea 5 — El no bloqueante suma pero no frena

**Files:**
- Test: `backend/test/reserva-stock-mesa.e2e-spec.ts`
- Modify: solo si la Tarea 3 no dejó ya la rama correcta.

**Interfaces:**
- Produces: un ingrediente **no bloqueante** sin stock **no impide pedir**, y su `disponible`
  puede quedar **negativo**.

- [x] **Paso 1: escribir el e2e**

Receta con un ingrediente bloqueante con stock de sobra y uno no bloqueante en `0`. Pedir el
plato → `201`. `GET /items` muestra el no bloqueante en negativo.

- [x] **Paso 2: correr — puede pasar ya, y está bien**

Si la Tarea 3 filtró por `bloqueante` como corresponde, este test pasa sin código nuevo. **No
es un test de más:** fija una decisión explícita del owner que un refactor podría borrar sin
darse cuenta. Si falla, la Tarea 3 estaba frenando de más.

- [x] **Paso 3: mutante — hacer que el guard mire también los no bloqueantes**

Confirmar que el e2e se pone rojo. Ése es el valor del test.

- [x] **Paso 4: gate y commit**

---

## Tarea 6 — Soltar la reserva no necesita código, y hay que probarlo

Es la tarea que fija el argumento entero del enfoque elegido.

**Files:**
- Test: `backend/test/reserva-stock-mesa.e2e-spec.ts`

- [x] **Paso 1: escribir los tres e2e**

Con `stock = 1` y la mesa A con la línea puesta (la mesa B rebota):
1. la mesa A **quita la línea** (sin despachar) → la mesa B ahora puede pedir;
2. la mesa A **cancela la cuenta** → la mesa B puede pedir;
3. la mesa A **cierra y cobra** → la mesa B **sigue sin poder**, porque ahora el stock es 0
   de verdad. Este tercero es el que distingue "se soltó" de "se consumió".

- [x] **Paso 2: correr — los tres tienen que pasar sin código nuevo**

Si alguno falla, el enfoque tiene un agujero y hay que **parar y reportar**, no parchear.

- [x] **Paso 3: commit**

```bash
git commit -m "test(salones): soltar la reserva no necesita código, y queda probado"
```

---

## Tarea 7 — Dos garzones pidiendo el último a la vez

**Files:**
- Test: `backend/test/reserva-stock-mesa.e2e-spec.ts`

**Interfaces:**
- Produces: con `stock = 1` y dos `POST` de línea **concurrentes**, exactamente uno responde
  `201` y el otro `400`. Nunca los dos `201`.

- [x] **Paso 1: escribir el e2e concurrente**

`Promise.all` de los dos `POST`. Afirmar sobre el **conjunto** de status —uno `201`, uno
`400`—, no sobre cuál ganó: cuál gana es una carrera y fijarlo haría el test intermitente.

- [x] **Paso 2: correrlo varias veces seguidas**

```bash
cd backend && for i in 1 2 3 4 5; do npx jest --config ./test/jest-e2e.json --testPathPatterns reserva-stock-mesa -t concurrent; done
```
Un test de concurrencia que se corre una sola vez no probó nada.

- [x] **Paso 3: si los dos dan `201`, el lock no alcanza — parar y reportar**

No inventar un lock nuevo: el orden de bloqueo de filas es materia del §15 de
`docs/patterns/backend.md` y tocarlo mal produce deadlocks que ya se pagaron una vez.

- [x] **Paso 4: gate y commit**

---

## Tarea 8 — El POS deja de distinguir producto de receta

Implementa la § 4.1b de la spec: el contrato con el frontend cambia.

**Files:**
- Modify: `frontend/app/composables/useVenta.ts` (la rama de `disponible !== null`, `:267`;
  `descontarStockCatalogo`, `:240-275`)
- Test: los `.nuxt.spec.ts` de las pantallas de venta que hoy fijan `disponible: null` en un
  producto.

**Interfaces:**
- Consumes: `GET /items` con `disponible` presente en productos (Tarea 2).
- Produces: la pantalla muestra `disponible` cuando existe y cae a `stock` cuando no.

- [x] **Paso 1: encontrar y listar los consumidores**

```bash
cd frontend && grep -rn 'disponible' app/ --include='*.vue' --include='*.ts' | grep -v spec
```
Anotar la lista en el commit. **Cerrar en un consumidor no es cerrar**: el texto de la UI es
uno más.

- [x] **Paso 2: escribir los tests de pantalla que fallan**

Un producto con `disponible: 1` y `stock: 3` tiene que mostrar **1**. Hoy muestra 3.

- [x] **Paso 3: correr y confirmar que fallan**

- [x] **Paso 4: implementar**

- [x] **Paso 5: gate del frontend**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

- [x] **Paso 6: smoke en el navegador, no solo tests**

Abrir el POS con un producto de stock 1 tomado por una mesa y confirmar que se ve como no
disponible. Los tests de pantalla mockean `useApiFetch` y no ven bugs de runtime.

- [x] **Paso 7: commit**

---

## Tarea 9 — Docs vivas, y la salida con motivo queda PENDIENTE

**Files:**
- Modify: `docs/features/salones-mesas.md`, `docs/features/inventario-kardex.md`,
  `docs/PRODUCTO.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`,
  `docs/agent/resueltos.md`

- [ ] **Paso 1: la regla de negocio, en `PRODUCTO.md`**

Que lo pedido en una cuenta abierta queda apartado; que dura mientras dura la cuenta; que un
plato aparta sus ingredientes; que el no bloqueante suma pero no frena.

- [ ] **Paso 2: `features/salones-mesas.md` y `features/inventario-kardex.md`**

Dónde se hace cumplir, y **que la reserva no escribe movimientos** — un lector del kardex
tiene que saber por qué no encuentra la reserva ahí.

- [ ] **Paso 3: `ESTADO.md`**

Fila de salones y fila de inventario, con la fecha.

- [ ] **Paso 4: mover la entrada de `pendientes.md` § 4 a `resueltos.md`**

Con el texto de cierre: qué se construyó, qué lo fija, y **qué no arregla**.

- [ ] **Paso 5: ⚠️ DEJAR VIVA la salida con motivo, y cruzarla**

**La entrada *"Anular o reducir una línea ya enviada a cocina"* de `pendientes.md` § 3 NO se
cierra.** Sigue abierta, y en este paso gana dos cosas:
1. un puntero a esta spec y a su § 5 (cómo compone: neto cero, automático);
2. la nota de que **si ese frente decide conservar la línea marcada como anulada** en vez de
   sacarla o bajarle la cantidad, la consulta del comprometido necesita una condición más
   para dejar de contarla.

Y en la § 6 de la spec ya está escrito lo que sigue sin arreglo: una merma, un recuento o un
ajuste manual pueden dejar el stock por debajo de lo comprometido y volver a trabar la mesa.
**Esta feature achica el caso, no lo borra.**

- [ ] **Paso 6: commit**

```bash
git add -A && git commit -m "docs(salones): lo pedido queda apartado; la salida con motivo sigue pendiente"
```

---

## Cierre del frente

- [ ] Gate completo de los dos lados, con `reset-db.sh` antes del e2e y `--verificar` después.
- [ ] Revisión independiente (`verify-feature` paso 7) sobre el diff completo del frente, no
      solo de la última tarea: la revisión de rama ve contradicciones **entre** tareas que
      ninguna revisión por-tarea puede ver.
- [ ] Marcar los checkboxes de este plan en el mismo commit que cada tarea.
