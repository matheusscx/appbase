# El ajuste de costo se tipea en la unidad que uno elige — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el ajuste manual de costo acepte el costo "por la unidad elegida" —igual que ya hacen la merma y la entrada de stock—, para que la precisión venga de elegir la unidad y no de teclear decimales que la moneda no tiene.

**Architecture:** `AjusteCostoDto` gana un `unidadCodigo` opcional. `registrarAjusteCosto` lee la unidad base del producto y, si difieren, convierte la **tasa** reutilizando `convertirCostoUnitario` con `cantidadIngresada = '1'` y como divisor el factor `convertirUnidad('1', elegida, base)`. Sin `unidadCodigo` el comportamiento es idéntico al de hoy. En el frontend, el drawer de ajuste replica el selector que `mermas.vue` ya tiene, y el input de costo de mermas deja de forzar 4 decimales.

**Tech Stack:** NestJS + TypeORM (SQL raw vía `manager.query`), PostgreSQL 15, Decimal.js, Jest + supertest (e2e), Nuxt 4 + Nuxt UI, Vitest.

**Spec:** [`docs/superpowers/specs/2026-08-28-costo-por-unidad-elegida-design.md`](../specs/2026-08-28-costo-por-unidad-elegida-design.md)
**Investigación de origen:** [`docs/agent/investigaciones/2026-08-28-separador-decimal-vs-miles.md`](../../agent/investigaciones/2026-08-28-separador-decimal-vs-miles.md)

## Global Constraints

- **`tenant_id` sale siempre del token**, nunca del body/query/ruta. `usuario_id` igual.
- **Dinero y tasas con Decimal.js**, nunca `number` nativo. El costo se persiste con la escala `ESCALA_COSTO` (4).
- **`ESCALA_COSTO = 4` NO se toca.** La escala del backend se queda en 4; lo que sigue a la moneda es el teclado humano. Ver §2.2 de la spec.
- **Soft delete:** toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`. Nunca `DELETE` físico.
- **Nunca una query por iteración (N+1).**
- **No se escribe aritmética nueva de conversión:** se reutiliza `convertirCostoUnitario`. Si aparece la tentación de escribir una fórmula, es señal de que el argumento está mal armado.
- **Trabajar y commitear directo sobre `main`.** No crear ramas ni PRs.
- **Documentación en el mismo commit que el código.**
- **No refactorizar fuera del alcance.** El rechazo de cadenas inválidas en `MoneyInput` es frente aparte y NO entra acá.
- **Gate obligatorio antes de dar por terminada la última tarea** (Task 5).

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `backend/src/modules/inventario/dto/ajuste-costo.dto.ts` | Campo `unidadCodigo` opcional | 1 |
| `backend/src/modules/inventario/inventario.service.ts` | Leer unidad base + convertir la tasa en `registrarAjusteCosto` | 1 |
| `backend/src/modules/inventario/inventario.module.ts` | Importar `CatalogModule` (hoy no está) | 1 |
| `backend/src/modules/inventario/inventario.service.spec.ts` | Unit de la conversión de tasa | 1 |
| `backend/test/inventario.e2e-spec.ts` | E2E del ajuste con unidad distinta de la base | 2 |
| `frontend/app/pages/inventario/index.vue` | Selector de unidad + etiqueta "Costo nuevo (por X)" | 3 |
| `frontend/app/pages/mermas.vue` | Sacar `:decimales="4"` del costo unitario | 4 |
| `docs/features/inventario-kardex.md` · `docs/ESTADO.md` · `docs/agent/pendientes.md` | Documentación viva | 5 |

---

### Task 1: El backend acepta el costo en otra unidad

**Files:**
- Modify: `backend/src/modules/inventario/dto/ajuste-costo.dto.ts`
- Modify: `backend/src/modules/inventario/inventario.service.ts` (`registrarAjusteCosto`, desde la línea ~342)
- Modify: `backend/src/modules/inventario/inventario.module.ts`
- Test: `backend/src/modules/inventario/inventario.service.spec.ts`

**Interfaces:**
- Consumes: `convertirCostoUnitario(cantidadIngresada, costoUnitario, cantidadConvertidaABase): string` de `common/utils/costo-conversion-unidad.util.ts`; `CatalogService.convertirUnidad(cantidad, codigoDesde, codigoHacia): Promise<string>`.
- Produces: `AjusteCostoDto.unidadCodigo?: string`. `registrarAjusteCosto` mantiene su firma y su retorno `{ movimientoId, costoAnterior, costoNuevo }`; `costoNuevo` es siempre **en unidad base**.

- [ ] **Step 1: Escribir el test que falla**

En `inventario.service.spec.ts`, siguiendo el molde de los tests que ya existen para `registrarAjusteCosto`:

```ts
it('convierte el costo cuando se ingresa en una unidad distinta de la base', async () => {
  // Producto en gramos; la persona carga el costo por kilo.
  // 1 kg = 1000 g ⇒ 5050/kg debe persistirse como 5.0500/g.
  const resultado = await service.registrarAjusteCosto(TENANT_ID, USUARIO_ID, {
    itemId: ITEM_EN_GRAMOS,
    costoNuevo: '5050',
    unidadCodigo: 'kg',
    comentario: 'Ajuste por unidad E2E',
  });

  expect(resultado.costoNuevo).toBe('5.0500');
});

it('sin unidadCodigo el costo se interpreta en unidad base, como hasta hoy', async () => {
  const resultado = await service.registrarAjusteCosto(TENANT_ID, USUARIO_ID, {
    itemId: ITEM_EN_GRAMOS,
    costoNuevo: '7',
    comentario: 'Ajuste sin unidad',
  });

  expect(resultado.costoNuevo).toBe('7.0000');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx jest inventario.service.spec --silent`
Expected: FAIL — el primero por `5050.0000` en vez de `5.0500` (hoy no convierte); el segundo debería pasar ya (es la regresión que protege el camino actual).

- [ ] **Step 3: Agregar el campo al DTO**

En `ajuste-costo.dto.ts`, junto a los campos existentes:

```ts
  // Unidad en la que la persona tipeó el costo. Ausente = unidad base del
  // producto (comportamiento histórico). Existe para que la precisión venga de
  // elegir la unidad y no de teclear decimales que la moneda no admite: en un
  // insumo por gramo se carga "5050 por kilo", no "5,0500 por gramo".
  // Ver docs/superpowers/specs/2026-08-28-costo-por-unidad-elegida-design.md
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  unidadCodigo?: string;
```

Agregar `IsOptional` al import de `class-validator` (hoy no está).

- [ ] **Step 4: Importar `CatalogModule` e inyectar `CatalogService`**

`InventarioModule` **no** importa `CatalogModule` hoy. Agregarlo a `imports` (verificado: `CatalogModule` no importa `InventarioModule`, así que no hay ciclo):

```ts
import { CatalogModule } from '../catalog/catalog.module';
// … imports: [ RepositoriosModule.forFeature([...]), MonedasModule, CatalogModule ],
```

E inyectar `private readonly catalogService: CatalogService` en el constructor de `InventarioService`.

- [ ] **Step 5: Convertir la tasa en `registrarAjusteCosto`**

Agregar `p.unidad_medida` al `SELECT` que ya existe (línea ~358, el que trae `i.tipo, p.costo_actual` — mantiene su `eliminado_el IS NULL`), y convertir **antes** del `toFixed(ESCALA_COSTO)`:

```ts
// El ajuste mueve cantidad 0, así que NO se puede usar la conversión de
// operación (divide por la cantidad convertida ⇒ división por cero). Acá la
// conversión es de TASA: cuánto vale una unidad base si una unidad elegida
// vale `costoNuevo`. Se reusa el mismo util con cantidad 1.
let costoEnBase = costoNuevo;
const unidadBase = rows[0].unidad_medida;
if (dto.unidadCodigo && dto.unidadCodigo !== unidadBase) {
  const factor = await this.catalogService.convertirUnidad(
    '1',
    dto.unidadCodigo,
    unidadBase,
  );
  costoEnBase = new Decimal(
    convertirCostoUnitario('1', costoNuevo.toString(), factor),
  );
}
const costoNuevo4 = costoEnBase.toFixed(ESCALA_COSTO);
```

Reemplazar el `costoNuevo.toFixed(ESCALA_COSTO)` de hoy por `costoEnBase`, y dejar el resto (la comparación contra el costo vigente y el `registrarMovimiento`) intacto — **la comparación "igual al vigente" tiene que correr sobre el costo ya convertido**, o cargar 5050/kg sobre un producto que ya vale 5,05/g dejaría un ajuste que no cambia nada.

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `cd backend && npx jest inventario.service.spec --silent`
Expected: PASS los dos.

- [ ] **Step 7: Matar un mutante**

Borrar el bloque `if (dto.unidadCodigo && …)` y correr de nuevo: el primer test tiene que fallar. **Revertir el mutante y verificar en los logs del contenedor que el backend reinició** antes de seguir.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/inventario backend/src/modules/inventario/inventario.module.ts
git commit -m "feat(inventario): el ajuste de costo acepta el costo por la unidad elegida"
```

---

### Task 2: E2E del camino completo

**Files:**
- Modify: `backend/test/inventario.e2e-spec.ts`

**Interfaces:**
- Consumes: `POST /api/inventario/ajustes-costo` con `{ itemId, costoNuevo, unidadCodigo, comentario }`.

- [ ] **Step 1: Escribir el test que falla**

⚠️ Este archivo tiene **6 aserciones de status agregadas en la sesión del 2026-08-28 y sin commitear**. Si siguen sin commitear al empezar, commitearlas aparte antes de tocar nada.

Agregar al describe existente, con producto propio (no reusar los del seed):

```ts
it('el ajuste de costo acepta el costo por una unidad distinta de la base', async () => {
  const resCreate = await request(app.getHttpServer())
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: `Insumo por gramo E2E ${Date.now()}`,
      precioBase: '10000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      unidadMedida: 'g',
      costo: '4',
    });
  expect(resCreate.status).toBe(201);
  const itemId = (resCreate.body as ItemResponse).id;

  const resAjuste = await request(app.getHttpServer())
    .post('/api/inventario/ajustes-costo')
    .set('Authorization', `Bearer ${token}`)
    .send({
      itemId,
      costoNuevo: '5050',
      unidadCodigo: 'kg',
      comentario: 'Costo por kilo E2E',
    });
  expect(resAjuste.status).toBe(201);
  expect((resAjuste.body as AjusteCostoResponse).costoNuevo).toBe('5.0500');

  const resGet = await request(app.getHttpServer())
    .get(`/api/items/${itemId}`)
    .set('Authorization', `Bearer ${token}`);
  expect(resGet.status).toBe(200);
  expect((resGet.body as ItemResponse).costoActual).toBe('5.0500');
});
```

- [ ] **Step 2: Resetear la base y correr**

Run: `./scripts/reset-db.sh && cd backend && npm run test:e2e -- inventario`
Expected: FAIL en la aserción de `5.0500` si Task 1 no está, PASS si está.

- [ ] **Step 3: Verificar que la base no se movió**

Run: `./scripts/reset-db.sh --verificar`
Expected: `1 solo 'Seed complete'`.

- [ ] **Step 4: Commit**

```bash
git add backend/test/inventario.e2e-spec.ts
git commit -m "test(inventario): e2e del ajuste de costo por unidad elegida"
```

---

### Task 3: El drawer de ajuste gana el selector

**Files:**
- Modify: `frontend/app/pages/inventario/index.vue` (el `UFormField` "Costo nuevo", línea ~346)

**Interfaces:**
- Consumes: `useUnidadesMedidaStore()` (`magnitudDe`, `unidades`), el mismo que usa `mermas.vue:51,118-128`.
- Produces: `ajusteCostoForm.unidadCodigo: string` — se manda en el body solo si no está vacío.

- [ ] **Step 1: Leer el molde antes de escribir**

Abrir `frontend/app/pages/mermas.vue:51`, `:102`, `:118-137` y copiar la forma: `unidadesOpts`, la condición de mostrar el selector (solo si hay más de una unidad en la magnitud) y la etiqueta dinámica *"Costo unitario (por {unidad})"*. **No inventar una forma nueva** — el proyecto ya tiene esta.

- [ ] **Step 2: Agregar el campo al form y el selector al template**

`ajusteCostoForm` gana `unidadCodigo: ''`. El `UFormField` de "Costo nuevo" pasa a usar la etiqueta dinámica, y arriba se agrega el selector con la misma condición que mermas. El `MoneyInput` **se deja como está** — con `:moneda-id` y sin `:decimales`, que es exactamente lo que la spec quiere.

- [ ] **Step 3: Mandar `unidadCodigo` solo si está elegida**

En la función que arma el body del `POST /inventario/ajustes-costo`, agregar el campo condicionalmente (mandar `''` haría fallar el `@IsNotEmpty()`).

- [ ] **Step 4: Verificar en el navegador, no solo compilando**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Después, con `docker-compose up`: abrir `/inventario`, elegir un producto en gramos, comprobar que el selector aparece, que la etiqueta dice "por kg", cargar `5050` y verificar que el detalle del ítem queda en `5.0500`.
⚠️ Este drawer no tiene test unitario: build y typecheck **no ven** bugs de runtime (auto-import de Nuxt, campos que no viajan en el body). El smoke de navegador no es opcional.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/pages/inventario/index.vue
git commit -m "feat(inventario): selector de unidad en el ajuste de costo"
```

---

### Task 4: La merma deja de forzar 4 decimales

**Files:**
- Modify: `frontend/app/pages/mermas.vue` (el `MoneyInput` de costo unitario, línea ~465)

- [ ] **Step 1: Verificar primero que el escape existe en todos los casos**

Antes de tocar nada, comprobar en `mermas.vue:118-128` en qué condiciones se muestra el selector de unidad. **Si hay algún producto cuya magnitud tenga una sola unidad y cuyo costo pueda ser fraccionario, quitar los decimales le saca precisión sin darle salida** — en ese caso PARAR y reportar, no seguir con la tarea.

- [ ] **Step 2: Sacar el prop y actualizar el comentario**

Quitar `:decimales="4"` del `MoneyInput`. El comentario de arriba explica hoy por qué los 4 decimales hacían falta; reemplazarlo por el motivo nuevo: la precisión la da el selector de unidad, y el input sigue los decimales de la moneda del ítem (con link a la spec).

- [ ] **Step 3: Correr los tests del frontend**

Run: `cd frontend && npm test && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: PASS. Si algún test de `mermas` afirmaba sobre los 4 decimales, actualizarlo — y dejar escrito en el test por qué cambió.

- [ ] **Step 4: Smoke de navegador**

Cargar una merma de un insumo en gramos eligiendo kilo, y verificar que el costo valorizado queda bien.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/pages/mermas.vue
git commit -m "fix(mermas): el costo unitario sigue los decimales de la moneda, no una escala fija"
```

---

### Task 5: Documentación y gate

**Files:**
- Modify: `docs/features/inventario-kardex.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/patterns/frontend.md`

- [ ] **Step 1: Documentar la regla nueva**

En `docs/patterns/frontend.md`, junto a lo que ya dice de `MoneyInput`: **los inputs de costo siguen los decimales de la moneda del ítem; la precisión viene del selector de unidad, no del prop `decimales`.** Corregir ahí la parte que hoy presenta el prop `decimales` como la forma correcta para costos.

- [ ] **Step 2: Actualizar el feature doc y el estado**

`docs/features/inventario-kardex.md`: el ajuste de costo acepta `unidadCodigo`. `docs/ESTADO.md`: la fila del CPP/ajuste de costo menciona la unidad elegible, con fecha.

- [ ] **Step 3: Actualizar el backlog**

En `docs/agent/pendientes.md`, la entrada del `MoneyInput` ×10: dejar asentado que el frente ambiguo de 4 decimales **se cerró sacándolo** en los campos de costo, y que lo que queda abierto es solo el rechazo en 0 decimales y el barrido de los `:decimales="4"` de `items.vue`. Enlazar la investigación y esta spec.

- [ ] **Step 4: Gate completo**

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

⚠️ `reset-db.sh` **antes** del `test:e2e`, y `reset-db.sh --verificar` después. El e2e va **completo**, no un subset.

- [ ] **Step 5: Revisión independiente**

Invocar `verify-feature` (paso 7) sobre el diff completo. El pre-commit exige el recibo.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs(inventario): el costo se tipea por unidad elegida, no con decimales fijos"
```
