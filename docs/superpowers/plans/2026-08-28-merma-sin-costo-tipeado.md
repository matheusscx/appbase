# La merma no pide costo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el formulario de merma pida solo cuánto se perdió y el sistema valorice con el costo del ítem; que una merma de un producto sin costo se registre igual, sin valorizar, y quede así para siempre.

**Architecture:** `CreateMermaDto` pierde `costoUnitario`. `MermasService.registrar` borra el rechazo por falta de costo y toda la rama de conversión del costo tipeado: el congelado pasa a ser `costo_actual` a secas, y `costoUnitario`/`costoPerdido` viajan en `null` cuando no hay costo. En el frontend, `mermas.vue` pierde el campo, su prefill, su modal bloqueante y su alerta, y gana un cartel que avisa sin frenar.

**Tech Stack:** NestJS + TypeORM (SQL raw vía `manager.query`), PostgreSQL 15, Decimal.js, Jest + supertest (e2e), Nuxt 4 + Nuxt UI, Vitest.

**Spec:** [`docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md`](../specs/2026-08-28-merma-sin-costo-tipeado-design.md)

## Global Constraints

- **Las seis reglas del owner** están en el §2 de la spec. Si una tarea empuja a violar una, **parar y reportar**.
- **`tenant_id` y `usuario_id` salen del token**, nunca del body.
- **Dinero y tasas con Decimal.js**, nunca `number` nativo. `ESCALA_COSTO` (4) no se toca.
- **Soft delete:** toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`. Nunca `DELETE` físico.
- **Nunca una query por iteración (N+1).**
- **`costoUnitario` del movimiento de inventario (`POST /inventario/movimientos`) NO se toca** — es otro endpoint, y ahí el costo lo trae quien compra. Solo se toca el de `POST /mermas`.
- **No hay datos productivos:** no se diseñan backfills, migraciones incrementales ni deprecaciones. Se cambia el contrato, se actualiza el seeder si hace falta, se resetea.
- **Trabajar y commitear directo sobre `main`.** No ramas ni PRs. **Nunca `git commit --no-verify`.**
- **Documentación en el mismo commit que el código.**
- **Gate obligatorio antes de dar por terminada la última tarea** (Task 6).

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `backend/src/modules/mermas/dto/create-merma.dto.ts` | Sacar `costoUnitario` | 1 |
| `backend/src/modules/mermas/mermas.service.ts` | Valorizar solo desde `costo_actual`; permitir `null` | 1 |
| `backend/src/modules/mermas/mermas.service.spec.ts` | Unit del registro sin costo y del congelado | 1 |
| `backend/test/mermas.e2e-spec.ts` | E2E del camino sin costo | 2 |
| `frontend/app/pages/mermas.vue` | Sacar campo/prefill/modal; cartel no bloqueante | 3 |
| `frontend/app/pages/configuracion/items.vue` | Cartel en la entrada por compra | 4 |
| `backend/src/modules/items/dto/query-items.dto.ts` · `items.service.ts` | Filtro `sinCosto` | 5 |
| `frontend/app/pages/configuracion/items.vue` | Marca en la fila + filtro en la barra | 5 |
| `docs/features/mermas-valorizadas.md` · `docs/ESTADO.md` · `docs/PRODUCTO.md` · `docs/agent/pendientes.md` | Documentación viva | 6 |

---

### Task 1: El backend valoriza solo desde el producto

**Files:**
- Modify: `backend/src/modules/mermas/dto/create-merma.dto.ts`
- Modify: `backend/src/modules/mermas/mermas.service.ts` (`registrar`, desde la línea 88)
- Test: `backend/src/modules/mermas/mermas.service.spec.ts`

**Interfaces:**
- Produces: `MermaResponse.costoUnitario: string | null` y `MermaResponse.costoPerdido: string | null` (hoy son `string` a secas, líneas 30-31). `MermaListItem` ya los tiene nullable (líneas 42-43) — no se toca.
- `CreateMermaDto` queda: `itemId`, `cantidad`, `unidadCodigo?`, `causaMermaId`, `comentario?`.

- [x] **Step 1: Escribir los tests que fallan**

En `mermas.service.spec.ts`. **Antes de escribirlos, abrir el archivo y copiar el molde real** — los tests existentes de `registrar` son de mock puro (`managerMock.query.mockResolvedValueOnce(...)` encadenado). Adaptar estos al molde, no al revés:

```ts
it('registra la merma sin valorizar cuando el producto no tiene costo', async () => {
  // Regla 1 de la spec: nunca se inventa un costo. Antes esto era un 400.
  const result = await service.registrar(TENANT_ID, USUARIO_ID, {
    itemId: ITEM_SIN_COSTO,
    cantidad: '2',
    causaMermaId: CAUSA_ID,
  });

  expect(result.costoUnitario).toBeNull();
  expect(result.costoPerdido).toBeNull();
  expect(result.merma.costoPerdido).toBeNull();
});

it('valoriza con el costo del producto, sin que nadie lo tipee', async () => {
  const result = await service.registrar(TENANT_ID, USUARIO_ID, {
    itemId: ITEM_CON_COSTO, // costo_actual = '100.0000', unidad base kg
    cantidad: '0.5',
    causaMermaId: CAUSA_ID,
  });

  expect(result.costoUnitario).toBe('100.0000');
  expect(result.costoPerdido).toBe('50.0000');
});
```

Y **actualizar el test que hoy afirma lo contrario**: `mermas.service.spec.ts:110` (`'rechaza sin costo_actual ni costoUnitario'`, que espera el mensaje de la línea 126). Ese test documenta la regla vieja; se borra, y en su lugar queda el primero de arriba. **Dejar escrito en el test por qué cambió**, con link a la spec.

- [x] **Step 2: Correr y verificar que fallan**

Run: `cd backend && npx jest mermas.service.spec --silent`
Expected: FAIL — el primero por el `BadRequestException` que todavía se lanza.

- [x] **Step 3: Sacar el campo del DTO**

En `create-merma.dto.ts`, borrar el bloque `costoUnitario` completo (líneas 25-33, con su comentario). Sacar del import de `class-validator` y de los decoradores propios lo que quede sin uso — **verificar uno por uno**: `IsNumberString` lo sigue usando `cantidad`; `IsDecimalPositivo` y `EsCosto` probablemente queden sin uso en este archivo.

- [x] **Step 4: Simplificar `registrar`**

En `mermas.service.ts`, entre las líneas 156 y 184, borrar:
- el `throw new BadRequestException('El producto no tiene costo actual; …')` (líneas 159-166);
- todo el `if (dto.costoUnitario != null && dto.costoUnitario !== '')` con su rama `else` (líneas 167-185), incluida la llamada a `convertirCostoUnitario`.

Queda:

```ts
      // El costo NO se tipea: sale del producto. Si el ítem no tiene costo,
      // la merma se registra igual y queda sin valorizar para siempre — el
      // hecho vale lo que valía cuando pasó, como la venta congela su precio.
      // Ver docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md
      const costoActual = itemRows[0].costo_actual;
```

Y más abajo, donde hoy dice `const costoCongelado = costoUnitarioParam ?? costoActual!;`:

```ts
      const costoCongelado = costoActual;
      const costoPerdido =
        costoCongelado == null
          ? null
          : new Decimal(cantidadStr).mul(costoCongelado).toFixed(ESCALA_COSTO);
```

`registrarMovimiento` recibe `costoUnitario: costoCongelado ?? undefined`.
Ampliar `MermaResponse` (líneas 30-31) a `string | null` en los dos campos.

⚠️ **Verificar antes de asumir**: que `movimientos_inventario.costo_unitario` acepta `NULL` en la entity (`registrarMovimiento` ya calcula `costoUnitarioCongelado = params.costoUnitario ?? costoActualPrevio`, `inventario.service.ts:260-261`, y con los dos en null queda null). Si la columna es `NOT NULL`, **parar y reportar** — cambia el alcance.

- [x] **Step 5: Correr los tests y verificar que pasan**

Run: `cd backend && npx jest mermas.service.spec --silent`
Expected: PASS todos. Si otro test del archivo asumía el override, actualizarlo dejando escrito por qué.

- [x] **Step 6: Matar un mutante**

Cambiar `costoCongelado == null ? null : …` por que siempre calcule: el primer test tiene que fallar. **Revertir y verificar en los logs del contenedor que el backend reinició** antes de seguir — el fuente limpio no prueba que el proceso lo esté.

- [x] **Step 7: Commit**

```bash
git add backend/src/modules/mermas
git commit -m "feat(mermas): el costo sale del producto, no se tipea al registrar"
```

---

### Task 2: E2E de los dos caminos

**Files:**
- Modify: `backend/test/mermas.e2e-spec.ts`

**Interfaces:**
- Consumes: `POST /api/mermas` con `{ itemId, cantidad, unidadCodigo?, causaMermaId, comentario? }`.

- [x] **Step 1: Escribir el test que falla**

Con producto propio (no del seed: el stock del seed es acumulativo entre corridas locales y contamina). Crear un producto **sin** `costo`, darle stock con una entrada, y mermarlo:

```ts
it('la merma de un producto sin costo se registra sin valorizar', async () => {
  const resCreate = await request(app.getHttpServer())
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: `Insumo sin costo E2E ${Date.now()}`,
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      unidadMedida: 'kg',
    });
  expect(resCreate.status).toBe(201);
  const itemId = (resCreate.body as ItemResponse).id;

  // …entrada de stock SIN costoUnitario, para que costo_actual quede en NULL…

  const resMerma = await request(app.getHttpServer())
    .post('/api/mermas')
    .set('Authorization', `Bearer ${token}`)
    .send({ itemId, cantidad: '1', causaMermaId: CAUSA_ID });
  expect(resMerma.status).toBe(201);
  expect((resMerma.body as MermaResponse).costoPerdido).toBeNull();
});
```

✅ **Ya medido: el escenario es alcanzable por API.** `costo` es opcional en `CreateItemDto` y `costoUnitario` es opcional en `AjusteStockDto` (`ajuste-stock.dto.ts:76-81`), así que un producto puede tener stock y `costo_actual` en `NULL`. **No montar el escenario con SQL directo** — si por lo que sea no sale por API, parar y reportar en vez de forzarlo.

- [x] **Step 2: Actualizar el test que afirma lo viejo**

`mermas.e2e-spec.ts:143` (`expect(body.costoUnitario).toBeTruthy()`) sigue siendo válido para el producto **con** costo. Verificar que su producto lo tiene; si el test mandaba `costoUnitario` en el body, sacarlo — el endpoint ya no lo acepta.

- [x] **Step 3: Resetear la base y correr**

Run: `./scripts/reset-db.sh && cd backend && npm run test:e2e -- mermas`
Expected: PASS. Usar el **exit code**, no la última línea.

⚠️ No tocar ningún `.ts` del backend mientras el e2e corre: el watcher recompila, reinicia y vuelve a sembrar.

- [x] **Step 4: Verificar que la base no se movió**

Run: `./scripts/reset-db.sh --verificar`
Expected: `1 solo 'Seed complete'`.

- [x] **Step 5: Commit**

```bash
git add backend/test/mermas.e2e-spec.ts
git commit -m "test(mermas): e2e de la merma sin valorizar"
```

---

### Task 3: El formulario deja de pedir el costo

**Files:**
- Modify: `frontend/app/pages/mermas.vue`

- [x] **Step 1: Borrar el campo y su maquinaria**

Sacar, verificando cada referencia con un grep antes de borrar:
- el `UFormField` del costo con su `MoneyInput` (líneas 455-471) y el `UAlert` de "Sin costo actual" (473-480);
- el `UModal` `costoSinActualModalOpen` (510-533) y `confirmarCostoSinActual` (191-194);
- los refs `costoSinActualModalOpen` / `costoSinActualAck` (95-96) y sus usos en `abrirRegistrar` (187) y `registrar` (201-210);
- `prefillCostoUnitario` (139-149), `costoUnitarioLabel` (131-134), el campo `costoUnitario` de `emptyForm` (105) y la línea que lo mete en el body (226-228);
- el import `useUnidadConversion` (52) **si `convertirCosto` no se usa en ningún otro lado del archivo** — grepear antes.

`sinCostoActual` (114-116) **se conserva**: pasa a gobernar el cartel del Step 2.

⚠️ Los `watch` de `itemId` (151-160) y de `unidadCodigo` (162-165) llaman a `prefillCostoUnitario`. El de `unidadCodigo` puede quedar vacío: si no le queda cuerpo, borrarlo entero.

- [x] **Step 2: El cartel que no frena**

Donde estaba el campo, un `UAlert` gobernado por `sinCostoActual`, con tokens semánticos de Nuxt UI (nunca Tailwind hardcodeado) y el mismo estilo del `UAlert` que se borró:

```vue
          <UAlert
            v-if="sinCostoActual"
            color="warning"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Este producto no tiene costo cargado"
            description="La merma se va a registrar igual, pero no va a quedar valorizada — y después no se puede corregir. Para valorizarla, cárgale el costo al producto antes de mermarlo."
          />
```

No agrega confirmación ni deshabilita el botón: **avisa y deja pasar** (regla 4 de la spec).

- [x] **Step 3: El toast contempla el caso sin monto**

Hoy (línea 254) el toast interpola `res.costoPerdido` siempre. Tipar la respuesta con `costoPerdido: string | null` (línea 231) y cambiar el título cuando venga en `null` — por ejemplo *"Merma registrada · sin valorizar"*.

- [x] **Step 4: Gate del frontend**

Run: `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`
Expected: PASS los cuatro, por **exit code**. Si algún test afirmaba sobre el campo de costo de mermas, actualizarlo dejando escrito por qué.

- [x] **Step 5: Smoke de navegador — no es opcional**

Esta página no tiene test unitario: build y typecheck **no ven** bugs de runtime (auto-import de Nuxt, campos que no viajan en el body). Con **chrome-devtools MCP** (no Claude Browser: el owner mira la ventana real de Chrome):
- Producto **con** costo: registrar la merma y verificar en el log de red que el body **no** lleva `costoUnitario`, y que el costo perdido del listado es el que corresponde.
- Producto **sin** costo: verificar que aparece el cartel, que el botón registra igual, y que la fila queda en `—`.

- [x] **Step 6: Commit**

Corre `domain-reviewer` sobre el diff staged y generar el recibo (paso 7 de `verify-feature`): el pre-commit lo exige porque el diff toca un `.vue` de `pages`.

```bash
git add frontend/app/pages/mermas.vue
git commit -m "feat(mermas): el formulario ya no pide el costo, lo avisa cuando falta"
```

---

### Task 4: El mismo cartel al comprar

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue` (drawer de ajuste de stock, `UFormField` del costo en las líneas 2340-2345)

Regla 4 de la spec: el aviso va también donde el dato de verdad existe — cuando alguien
recibe mercadería y sabe cuánto pagó. **No lo hace obligatorio** (el owner lo descartó:
frenaría a quien tiene la mercadería en la puerta y la factura no).

- [x] **Step 1: Leer el contexto real antes de escribir**

Abrir `configuracion/items.vue:2340-2345`. El campo del costo aparece solo con
`ajusteForm.tipo === 'entrada' && ajusteForm.motivo === 'compra'`, y **no** tiene `required`.
Ubicar también `stockItem` (el ítem sobre el que se abre el drawer) y confirmar que expone
`costoActual` — si no lo expone, **parar y reportar**: sin ese dato no se puede decidir
cuándo mostrar el cartel.

- [x] **Step 2: Agregar el cartel**

Debajo del `UFormField` del costo, gobernado por "el producto no tiene costo hoy":

```vue
          <UAlert
            v-if="ajusteForm.tipo === 'entrada' && ajusteForm.motivo === 'compra'
              && stockItem?.costoActual == null && !ajusteForm.costoUnitario"
            color="warning"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Este producto todavía no tiene costo"
            description="Si registras la compra sin el costo, el producto queda sin valorizar: sus mermas no van a poder calcularse, y eso después no se corrige."
          />
```

⚠️ La condición es `costoActual == null`, **no** "el campo está vacío". Si el producto ya
tiene costo y esta compra no lo trae, el costo viejo sigue vigente y las mermas valorizan
igual: ahí el cartel sería una mentira. Tokens semánticos de Nuxt UI, nunca Tailwind
hardcodeado.

- [x] **Step 3: Gate del frontend**

Run: `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`
Expected: PASS los cuatro, por **exit code**.

- [x] **Step 4: Smoke de navegador**

Con **chrome-devtools MCP**: abrir el ajuste de stock de un producto **sin** costo, motivo
compra → el cartel aparece; tipear un costo → desaparece. Repetir sobre un producto **con**
costo → el cartel **no** aparece nunca.

- [x] **Step 5: Commit**

Correr `domain-reviewer` sobre el diff staged y generar el recibo (paso 7 de `verify-feature`).

```bash
git add frontend/app/pages/configuracion/items.vue
git commit -m "feat(items): avisar al comprar que el producto va a quedar sin costo"
```

---

### Task 5: Ver todos los que están sin costo

**Files:**
- Modify: `backend/src/modules/items/dto/query-items.dto.ts`
- Modify: `backend/src/modules/items/items.service.ts` (armado del `where`, líneas 252-280)
- Test: `backend/src/modules/items/dto/query-items.dto.spec.ts` y el spec del service
- Modify: `frontend/app/pages/configuracion/items.vue` (fila del listado, línea 1493-1495; barra de filtros, `filtroTipo` en 236/252/258/262 y su `USelect` en 1435)

**Interfaces:**
- Produces: `QueryItemsDto.sinCosto?: boolean`. Ausente no filtra nada; `true` deja solo los
  ítems sin costo. **Es de dos estados, no de tres** — a diferencia de `activo`.

- [x] **Step 1: Escribir el test del DTO que falla**

En `query-items.dto.spec.ts`, siguiendo el molde de los tests que ya existen ahí. El DTO
tiene un comentario largo sobre la coerción de `activo` (tres estados) frente a la de
`incluirEliminados` (dos): **leerlo antes de elegir**, y usar la de `incluirEliminados`
—`value === 'true' || value === true`— porque acá no existe el caso "solo los que sí
tienen costo".

- [x] **Step 2: Escribir el test del service que falla**

Que con `sinCosto: true` el `where` incluya la condición y el parámetro viaje. **Ojo con el
`toContain`:** afirmar sobre un fragmento que también aparece en un comentario SQL da un
verde falso — acotar la aserción a la cláusula.

- [x] **Step 3: Correr y verificar que fallan**

Run: `cd backend && npx jest query-items.dto items.service --silent`

- [x] **Step 4: Implementar**

⚠️ **`costo_actual` no es una columna de `items`:** el SELECT lo arma con
`COALESCE(ip.costo_actual, ir.costo_actual, icb.costo_actual)` (`items.service.ts:198`), o
sea que sale de tres tablas distintas según el tipo. El filtro tiene que usar **la misma
expresión**, y **verificar primero que los tres alias existen en el `FROM` de esa query** —
si el `where` se compone para otra query que no los tiene, parar y reportar.

Acotar a los tipos que muestran costo en la fila (`producto`, `ingrediente`), que son los que
importan para la merma:

```ts
    if (query.sinCosto) {
      where += ` AND i.tipo IN ('producto','ingrediente')
                 AND COALESCE(ip.costo_actual, ir.costo_actual, icb.costo_actual) IS NULL`;
    }
```

Sin parámetro: no hay valor del usuario en la cláusula. Mantiene el `eliminado_el IS NULL`
que ya trae el `where`.

- [x] **Step 5: Correr los tests y matar un mutante**

Run: `cd backend && npx jest query-items.dto items.service --silent` → PASS.
Mutante: invertir el `IS NULL` por `IS NOT NULL` — el test del service tiene que fallar.
**Revertir y verificar en los logs del contenedor que el backend reinició.**

- [x] **Step 6: La marca en la fila**

En `configuracion/items.vue:1493-1495`, donde hoy el costo ausente se dibuja como `—` a
secas, marcarlo para que se distinga de un vistazo: un `UBadge` o el ícono
`i-lucide-circle-alert` con el título *"Sin costo"*, siguiendo el molde de los badges que la
fila ya tiene (`modoInventario`, línea 1496). **Sin Tailwind hardcodeado.**

- [x] **Step 7: El filtro en la barra**

Junto al `USelect` de `filtroTipo` (línea 1435), un control "Solo sin costo" que agregue
`sinCosto: true` a la query (línea 252) y entre en `busquedaActiva`/el reset (258/262) igual
que `filtroTipo`. **Copiar el molde de `filtroTipo`, no inventar uno nuevo.**

- [x] **Step 8: Gate del frontend y smoke**

Run: `cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check`
Smoke con **chrome-devtools MCP**: prender el filtro y verificar en el log de red que
`sinCosto=true` viaja en la query, que la lista se achica a los que están sin costo, y que
la marca se ve en esas filas. Apagarlo y verificar que vuelve la lista completa.

- [x] **Step 9: Commit**

Correr `domain-reviewer` sobre el diff staged y generar el recibo.

```bash
git add backend/src/modules/items frontend/app/pages/configuracion/items.vue
git commit -m "feat(items): marcar y filtrar los productos que están sin costo"
```

---

### Task 6: Documentación y gate

**Files:**
- Modify: `docs/features/mermas-valorizadas.md`, `docs/PRODUCTO.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`

- [x] **Step 1: La regla de negocio**

`docs/features/mermas-valorizadas.md`: el costo sale del producto, no se tipea; la merma sin costo se registra sin valorizar y **queda así para siempre**; el override por movimiento **ya no existe**. `docs/PRODUCTO.md`: la regla del congelado, con el porqué (mismo criterio que el precio de la venta y que **ADR-010**), y que el costo se carga al comprar o en el producto — nunca al mermar. `docs/features/inventario-kardex.md`: el filtro `sinCosto` del listado de ítems.

- [x] **Step 2: Estado y backlog**

`docs/ESTADO.md`: la fila de mermas y la del catálogo de ítems (filtro `sinCosto`), con fecha. En `docs/agent/pendientes.md`, entrada nueva para la **regla 6**: *cuando se construya el reporte de mermas, tiene que mostrar cuántas quedaron sin valorizar*. Ojo con el enunciado: **`costo_perdido` no es una columna**, se deriva en la lectura (`mermas.service.ts:351-352`), así que no hay un `SUM` que arreglar — hay una cuenta futura que va a nacer mal si nadie la avisa.

- [x] **Step 3: Gate completo**

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

⚠️ `reset-db.sh` **antes** del `test:e2e`, y `reset-db.sh --verificar` después. El e2e va **completo**, no un subset: sacar un campo de un DTO compartido ya rompió specs lejanas antes.

- [x] **Step 4: Revisión independiente**

`verify-feature` paso 7 sobre el diff completo del frente, no solo del último commit.

- [x] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(mermas): el costo se maneja en el producto; la merma sin costo no se valoriza"
```
