# Borrado informado de un ingrediente usado como extra — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que borrar un item del catálogo diga qué se rompe *antes* de confirmar, y que borrar un ingrediente usado solo como extra deje de dejar filas colgadas en `receta_extras_permitidos`.

**Architecture:** Un método privado resuelve los cuatro usos de un item con una sola query `UNION` y los clasifica en `bloqueos` (ingrediente fijo, componente de combo, opción de grupo) y `advertencias` (extra). `remove()` y la ruta nueva `GET /items/:id/uso` consumen ese mismo método, así que la regla de qué bloquea existe una sola vez. El frontend consulta `/uso` al abrir el modal de confirmación que ya existe y lo llena con el resultado.

**Tech Stack:** NestJS + TypeORM (queries SQL crudas vía `DataSource`/`EntityManager`), Jest + supertest para e2e, Nuxt 4 + Nuxt UI en el frontend.

**Spec:** [`docs/superpowers/specs/2026-07-28-borrado-ingrediente-extra-design.md`](../specs/2026-07-28-borrado-ingrediente-extra-design.md) (commit `d60392c`)

## Global Constraints

- **`tenant_id` sale siempre del token.** Nunca del body, query ni parámetro de ruta.
- **Soft delete en todo.** Nunca `DELETE` físico; marcar `eliminado_el`. Toda lectura filtra `eliminado_el IS NULL`.
- **Nunca una query por iteración (N+1).** El dato derivado se resuelve en una query o en batch.
- **Los textos de error existentes no cambian:** `No se puede eliminar: es ingrediente de …`, `… es componente de …`, `… es opción de …`. Hay e2e que los afirman.
- **Sin `TODO`, sin código comentado, sin código muerto.**
- **Trabajo directo sobre `main`**, un commit por tarea. Sin ramas ni PRs.
- **Gate obligatorio antes de cada commit** (`verify-feature`). `./scripts/reset-db.sh` se corre **inmediatamente antes** del `test:e2e`, sin lint ni unit en el medio.

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `backend/src/modules/items/items.service.ts` | `obtenerUsoItem()` privado, `obtenerUso()` público, `remove()` reescrito | 1, 2 |
| `backend/src/modules/items/items.service.spec.ts` | Unit de clasificación, prioridad de mensajes y limpieza | 1 |
| `backend/src/modules/items/items.controller.ts` | Ruta `GET :id/uso` | 2 |
| `backend/test/recetas.e2e-spec.ts` | e2e de `/uso` y de la fila soft-deleted | 2 |
| `frontend/app/components/crud/CrudModal.vue` | Slot de detalle + modo solo-cerrar | 3 |
| `frontend/app/pages/configuracion/items.vue` | Consulta `/uso` y arma el modal | 3 |
| `docs/features/recetas.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/resueltos.md` | Documentación viva | 4 |

---

## Task 1: Clasificación de usos y `remove()` transaccional

**Files:**
- Modify: `backend/src/modules/items/items.service.ts:1527-1579` (`remove()`)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Produces:
  - `export type UsoItemTipo = 'ingrediente' | 'combo' | 'opcion' | 'extra'`
  - `export interface UsoItemRef { tipo: UsoItemTipo; nombre: string }`
  - `export interface UsoItem { bloqueos: UsoItemRef[]; advertencias: UsoItemRef[] }`
  - `private obtenerUsoItem(manager: EntityManager, tenantId: string, itemId: string): Promise<UsoItem>`
- Consumes: nada de tareas previas.

- [ ] **Step 1: Agregar `manager` al mock de `dataSource` en el spec**

En `items.service.spec.ts:35-41`, el mock de `DataSource` no expone `.manager`, y la Tarea 2 lo va a necesitar. Cambiar la declaración y el `beforeEach`:

```typescript
let dataSource: {
  query: jest.Mock;
  transaction: jest.Mock;
  manager: { query: jest.Mock };
};
```

```typescript
managerMock = { query: jest.fn() };
dataSource = {
  query: jest.fn(),
  manager: managerMock,
  transaction: jest.fn((cb: (m: typeof managerMock) => unknown) =>
    cb(managerMock),
  ),
};
```

Agregar la propiedad, **no** tocar `query` ni `transaction`: hay ~40 tests que dependen de su forma actual.

- [ ] **Step 2: Escribir los tests que fallan**

Agregar un `describe` nuevo al final de `items.service.spec.ts`. Usa las constantes `TENANT` e `ITEM_ID` que el archivo ya define en las líneas 12-13:

```typescript
describe('remove — clasificación de usos', () => {
  beforeEach(() => {
    itemRepo.findOne.mockResolvedValue({ id: ITEM_ID, tenantId: TENANT });
  });

  it('borra un ingrediente usado solo como extra y soft-deletea sus filas de extras', async () => {
    managerMock.query
      .mockResolvedValueOnce([{ clase: 'extra', nombre: 'Hamburguesa' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.remove(TENANT, ITEM_ID);

    const sqls = managerMock.query.mock.calls.map((c) => c[0] as string);
    expect(sqls).toHaveLength(3);
    expect(sqls[1]).toContain('UPDATE receta_extras_permitidos');
    expect(sqls[1]).toContain('eliminado_el = NOW()');
    expect(sqls[2]).toContain('UPDATE items');
  });

  it('bloquea si es componente de un combo, sin filtrar el extra al mensaje', async () => {
    managerMock.query.mockResolvedValueOnce([
      { clase: 'combo', nombre: 'Menú del día' },
      { clase: 'extra', nombre: 'Hamburguesa' },
    ]);

    await expect(service.remove(TENANT, ITEM_ID)).rejects.toThrow(
      'No se puede eliminar: es componente de Menú del día',
    );
  });

  it('prioriza ingrediente sobre combo en el mensaje, como hacían las tres queries', async () => {
    managerMock.query.mockResolvedValueOnce([
      { clase: 'combo', nombre: 'Menú del día' },
      { clase: 'ingrediente', nombre: 'Pizza' },
    ]);

    await expect(service.remove(TENANT, ITEM_ID)).rejects.toThrow(
      'No se puede eliminar: es ingrediente de Pizza',
    );
  });

  it('acota la consulta de uso por tenant', async () => {
    managerMock.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.remove(TENANT, ITEM_ID);

    expect(managerMock.query.mock.calls[0][1]).toEqual([ITEM_ID, TENANT]);
  });
});
```

**Por qué estos y no "borrar un extra funciona":** ese caso pasa igual con el código actual — hoy también funciona. Lo que revierte es la **limpieza** (test 1: hoy `managerMock.query` no se llama nunca porque `remove()` no usa transacción) y la **prioridad del mensaje** (tests 2 y 3).

- [ ] **Step 3: Correr los tests y verificar que fallan**

```bash
cd backend && npx jest items.service.spec --silent -t "clasificación de usos"
```

Esperado: los cuatro FALLAN. Los tres primeros porque `managerMock.query` no recibe llamadas (el `remove()` actual usa `this.dataSource.query`, no `transaction`).

- [ ] **Step 4: Agregar los tipos exportados**

En `items.service.ts`, junto a los demás tipos exportados del archivo:

```typescript
export type UsoItemTipo = 'ingrediente' | 'combo' | 'opcion' | 'extra';

export interface UsoItemRef {
  tipo: UsoItemTipo;
  nombre: string;
}

export interface UsoItem {
  bloqueos: UsoItemRef[];
  advertencias: UsoItemRef[];
}
```

- [ ] **Step 5: Implementar `obtenerUsoItem()`**

Agregar como método privado de `ItemsService`, arriba de `remove()`:

```typescript
/**
 * Los cuatro lugares donde un item puede estar en uso, en una sola query.
 * `UNION` y no `UNION ALL`: el dedupe es el mismo `DISTINCT` que hacía cada
 * query por separado. El `ORDER BY` es por determinismo — sin él el orden lo
 * decide el plan y el modal lista los motivos distinto entre llamadas.
 *
 * El filtro por tenant va sobre la entidad padre de cada rama (`items`, o
 * `grupos_modificadores` en la de opciones), no sobre la tabla puente: es la
 * misma defensa que `cargarReglasPorIds`, que el llamador no debería tener que
 * garantizar solo.
 */
private async obtenerUsoItem(
  manager: EntityManager,
  tenantId: string,
  itemId: string,
): Promise<UsoItem> {
  const rows: { clase: UsoItemTipo; nombre: string }[] = await manager.query(
    `SELECT 'ingrediente' AS clase, r.nombre
       FROM receta_ingredientes ri
       JOIN items r ON r.item_id = ri.receta_item_id
        AND r.tenant_id = $2 AND r.eliminado_el IS NULL
      WHERE ri.ingrediente_item_id = $1 AND ri.eliminado_el IS NULL
     UNION
     SELECT 'combo', c.nombre
       FROM combo_componentes cc
       JOIN items c ON c.item_id = cc.combo_item_id
        AND c.tenant_id = $2 AND c.eliminado_el IS NULL
      WHERE cc.componente_item_id = $1 AND cc.eliminado_el IS NULL
     UNION
     SELECT 'opcion', g.nombre
       FROM grupo_modificador_opciones o
       JOIN grupos_modificadores g
         ON g.grupo_modificador_id = o.grupo_modificador_id
        AND g.tenant_id = $2 AND g.eliminado_el IS NULL
      WHERE o.item_id = $1 AND o.eliminado_el IS NULL
     UNION
     SELECT 'extra', r.nombre
       FROM receta_extras_permitidos re
       JOIN items r ON r.item_id = re.receta_item_id
        AND r.tenant_id = $2 AND r.eliminado_el IS NULL
      WHERE re.ingrediente_item_id = $1 AND re.eliminado_el IS NULL
      ORDER BY 1, 2`,
    [itemId, tenantId],
  );

  const uso: UsoItem = { bloqueos: [], advertencias: [] };
  for (const r of rows) {
    const ref: UsoItemRef = { tipo: r.clase, nombre: r.nombre };
    if (r.clase === 'extra') uso.advertencias.push(ref);
    else uso.bloqueos.push(ref);
  }
  return uso;
}
```

Verificar que `EntityManager` ya esté importado de `typeorm` en el archivo (lo está: lo usan `resolverPersonalizacionReceta` y otros).

- [ ] **Step 6: Reescribir `remove()`**

Reemplazar el cuerpo completo (`items.service.ts:1527-1579`):

```typescript
async remove(tenantId: string, itemId: string): Promise<void> {
  const item = await this.itemRepo.findOne({
    where: { id: itemId, tenantId },
  });
  if (!item) throw new NotFoundException('Item no encontrado');

  await this.dataSource.transaction(async (manager) => {
    const { bloqueos } = await this.obtenerUsoItem(manager, tenantId, itemId);

    // Mismo orden de prioridad que las tres queries que esto reemplaza: la
    // primera clase con coincidencias es la que arma el mensaje, y los textos
    // son los de siempre porque hay e2e que los afirman.
    const etiquetas: [UsoItemTipo, string][] = [
      ['ingrediente', 'es ingrediente de'],
      ['combo', 'es componente de'],
      ['opcion', 'es opción de'],
    ];
    for (const [tipo, etiqueta] of etiquetas) {
      const nombres = bloqueos
        .filter((b) => b.tipo === tipo)
        .map((b) => b.nombre);
      if (nombres.length) {
        throw new BadRequestException(
          `No se puede eliminar: ${etiqueta} ${nombres.join(', ')}`,
        );
      }
    }

    // El item se va, pero las filas que lo ofrecen como extra quedarían vivas
    // apuntando a un muerto. Las lecturas ya las filtran por el JOIN, así que
    // esto es higiene referencial, no corrección.
    await manager.query(
      `UPDATE receta_extras_permitidos
       SET eliminado_el = NOW(), actualizado_el = NOW()
       WHERE ingrediente_item_id = $1 AND tenant_id = $2
         AND eliminado_el IS NULL`,
      [itemId, tenantId],
    );

    await manager.query(
      `UPDATE items SET activo = false, eliminado_el = NOW(), actualizado_el = NOW()
       WHERE item_id = $1 AND tenant_id = $2`,
      [itemId, tenantId],
    );
  });
}
```

- [ ] **Step 7: Correr los tests y verificar que pasan**

```bash
cd backend && npx jest items.service.spec --silent
```

Esperado: PASS, incluidos los ~40 tests preexistentes del archivo.

- [ ] **Step 8: Gate y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh && cd backend && npm run test:e2e
```

El e2e completo importa acá: `recetas.e2e-spec.ts` test 6 afirma el 400 del bloqueo y es la regresión de que no aflojamos las guardas.

```bash
git add backend/src/modules/items/items.service.ts \
        backend/src/modules/items/items.service.spec.ts
git commit -m "refactor(items): los cuatro usos de un item salen de una query y remove() limpia los extras"
```

---

## Task 2: Ruta `GET /items/:id/uso`

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (método público `obtenerUso`)
- Modify: `backend/src/modules/items/items.controller.ts:74` (ruta nueva, antes del `@Delete`)
- Test: `backend/test/recetas.e2e-spec.ts`

**Interfaces:**
- Consumes de Task 1: `obtenerUsoItem()`, `UsoItem`, `UsoItemRef`, `UsoItemTipo`.
- Produces: `async obtenerUso(tenantId: string, itemId: string): Promise<UsoItem>` y la ruta `GET /api/items/:id/uso`.

- [ ] **Step 1: Escribir los tests e2e que fallan**

En `recetas.e2e-spec.ts`, agregar el import y la variable del `DataSource` (el patrón ya existe en `combos.e2e-spec.ts:169`):

```typescript
import { DataSource } from 'typeorm';
```

Dentro del `describe`, junto a las otras variables:

```typescript
let ds: DataSource;
```

Y en el `beforeAll`, después de que `app` esté inicializada:

```typescript
ds = app.get(DataSource);
```

Agregar los dos tests al final del `describe`, después del test 7:

```typescript
it('8. /uso reporta como bloqueo el ingrediente que el DELETE rechaza', async () => {
  const res = await request(app.getHttpServer())
    .get(`/api/items/${panId}/uso`)
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).toBe(200);
  const uso = res.body as {
    bloqueos: { tipo: string; nombre: string }[];
    advertencias: { tipo: string; nombre: string }[];
  };
  // Es el mismo item que el test 6 no deja borrar: /uso y remove() tienen que
  // coincidir, porque leen la misma clasificación.
  expect(uso.bloqueos.length).toBeGreaterThan(0);
  expect(uso.bloqueos.every((b) => b.tipo === 'ingrediente')).toBe(true);
});

it('9. permite borrar un ingrediente usado solo como extra y soft-deletea la fila', async () => {
  const cheddarId = await crearIngrediente(
    app,
    token,
    'Cheddar solo extra E2E',
    'kg',
    '2',
    '6000',
  );
  const panSoloId = await crearIngrediente(
    app,
    token,
    'Pan solo extra E2E',
    'unidad',
    '10',
    '500',
  );

  const resReceta = await request(app.getHttpServer())
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: `Sandwich extras E2E ${Date.now()}`,
      precioBase: '3000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'receta',
      ingredientes: [
        {
          ingredienteItemId: panSoloId,
          cantidad: '1',
          unidadCodigo: 'unidad',
          bloqueante: true,
        },
      ],
      extrasPermitidos: [
        {
          ingredienteItemId: cheddarId,
          cantidad: '30',
          unidadCodigo: 'g',
          precioExtra: '700',
        },
      ],
    });
  expect(resReceta.status).toBe(201);

  const resUso = await request(app.getHttpServer())
    .get(`/api/items/${cheddarId}/uso`)
    .set('Authorization', `Bearer ${token}`);
  expect(resUso.status).toBe(200);
  const uso = resUso.body as {
    bloqueos: { tipo: string; nombre: string }[];
    advertencias: { tipo: string; nombre: string }[];
  };
  expect(uso.bloqueos).toEqual([]);
  expect(uso.advertencias.map((a) => a.tipo)).toEqual(['extra']);

  const resDel = await request(app.getHttpServer())
    .delete(`/api/items/${cheddarId}`)
    .set('Authorization', `Bearer ${token}`);
  expect(resDel.status).toBe(200);

  // Lo que discrimina del código anterior: que el borrado funcione pasaba
  // igual antes. Que la fila del extra quede soft-deleted, no.
  const filas: { eliminado_el: string | null }[] = await ds.query(
    `SELECT eliminado_el FROM receta_extras_permitidos
     WHERE ingrediente_item_id = $1`,
    [cheddarId],
  );
  expect(filas).toHaveLength(1);
  expect(filas[0]?.eliminado_el).not.toBeNull();
});
```

`resDel.status` es 200: `items.controller.ts:74` no tiene `@HttpCode`, y Nest devuelve 200 por defecto en `@Delete`.

- [ ] **Step 2: Correr los e2e y verificar que fallan**

```bash
./scripts/reset-db.sh && cd backend && npx jest --config ./test/jest-e2e.json recetas -t "8." 
```

Esperado: FALLA con 404 — la ruta `/uso` no existe todavía. Si el `-t` no matchea, correr el spec completo: `npx jest --config ./test/jest-e2e.json recetas`.

- [ ] **Step 3: Implementar `obtenerUso()` en el service**

Agregar como método **público**, inmediatamente arriba de `remove()`:

```typescript
async obtenerUso(tenantId: string, itemId: string): Promise<UsoItem> {
  const item = await this.itemRepo.findOne({
    where: { id: itemId, tenantId },
  });
  if (!item) throw new NotFoundException('Item no encontrado');

  return this.obtenerUsoItem(this.dataSource.manager, tenantId, itemId);
}
```

- [ ] **Step 4: Agregar la ruta al controller**

En `items.controller.ts`, insertar **antes** del `@Delete(':id')` (línea 74):

```typescript
@Get(':id/uso')
@RequiresPermiso('Items', 'Eliminar')
obtenerUso(@Req() req: Request, @Param('id') id: string) {
  const { tenantId } = req.user as { tenantId: string };
  return this.itemsService.obtenerUso(tenantId, id);
}
```

Va detrás de `Items:Eliminar` y no de `Leer`: solo quien puede borrar necesita el impacto, y abrirla a lectura sería una vía lateral para inventariar el catálogo.

Verificar que `Get` esté en el import de `@nestjs/common` (lo está: el controller ya tiene rutas `@Get`).

- [ ] **Step 5: Correr los e2e y verificar que pasan**

```bash
./scripts/reset-db.sh && cd backend && npx jest --config ./test/jest-e2e.json recetas
```

Esperado: PASS los 9 tests del spec.

- [ ] **Step 6: Gate y commit**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh && cd backend && npm run test:e2e
```

```bash
git add backend/src/modules/items/items.service.ts \
        backend/src/modules/items/items.controller.ts \
        backend/test/recetas.e2e-spec.ts
git commit -m "feat(items): GET /items/:id/uso devuelve bloqueos y advertencias del borrado"
```

---

## Task 3: El modal de confirmación informa

**Files:**
- Modify: `frontend/app/components/crud/CrudModal.vue`
- Modify: `frontend/app/pages/configuracion/items.vue:143-146` (estado), `:923-926` (`confirmarEliminar`), `:1926-1931` (template)

**Interfaces:**
- Consumes de Task 2: `GET /api/items/:id/uso` → `{ bloqueos: {tipo,nombre}[], advertencias: {tipo,nombre}[] }`.
- Produces: `CrudModal` con slot `#detalle` y prop `soloCerrar`.

- [ ] **Step 1: Extender `CrudModal.vue`**

Agregar la prop al `defineProps` existente y su default:

```typescript
withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel?: string
    confirmColor?: 'error' | 'primary' | 'neutral'
    loading?: boolean
    soloCerrar?: boolean
  }>(),
  {
    confirmLabel: 'Eliminar',
    confirmColor: 'error',
    loading: false,
    soloCerrar: false,
  },
)
```

Reemplazar `#body` y `#footer`:

```vue
<template #body>
  <p class="text-sm">
    {{ message }}
  </p>
  <slot name="detalle" />
</template>
<template #footer>
  <AppModalFooter>
    <UButton
      v-if="soloCerrar"
      color="neutral"
      @click="cancelar"
    >
      Entendido
    </UButton>
    <template v-else>
      <UButton color="neutral" variant="ghost" @click="cancelar">
        Cancelar
      </UButton>
      <UButton
        :color="confirmColor"
        :loading="loading"
        @click="emit('confirm')"
      >
        {{ confirmLabel }}
      </UButton>
    </template>
  </AppModalFooter>
</template>
```

Ambos cambios son compatibles hacia atrás: los ~20 consumidores actuales no pasan `soloCerrar` ni el slot, y sin ellos el modal se comporta idéntico a hoy.

- [ ] **Step 2: Agregar el estado del uso en `items.vue`**

Junto a `confirmModalOpen` y `confirmDeleteId` (líneas 143-146):

```typescript
// El backend garantiza la partición: 'extra' siempre cae en `advertencias` y
// nunca en `bloqueos`. Tipar cada lado con lo que realmente puede contener deja
// que `vue-tsc` valide el acceso a ETIQUETA_USO en el template.
type UsoItemTipoBloqueante = 'ingrediente' | 'combo' | 'opcion'

interface UsoItem {
  bloqueos: { tipo: UsoItemTipoBloqueante; nombre: string }[]
  advertencias: { tipo: 'extra'; nombre: string }[]
}

const usoItem = ref<UsoItem | null>(null)

const ETIQUETA_USO: Record<UsoItemTipoBloqueante, string> = {
  ingrediente: 'Es ingrediente de',
  combo: 'Es componente de',
  opcion: 'Es opción de',
}

const eliminarBloqueado = computed(
  () => (usoItem.value?.bloqueos.length ?? 0) > 0,
)

const eliminarTitulo = computed(() =>
  eliminarBloqueado.value ? 'No se puede eliminar' : 'Eliminar item',
)

const eliminarMensaje = computed(() => {
  if (eliminarBloqueado.value) return 'Este item está en uso y no se puede eliminar:'
  const extras = usoItem.value?.advertencias ?? []
  if (extras.length) {
    return `Se ofrece como extra en ${extras.map((a) => a.nombre).join(', ')}. Si lo eliminás dejará de estar disponible en esas recetas.`
  }
  return '¿Estás seguro de que deseas eliminar este item? Esta acción no se puede deshacer.'
})
```

- [ ] **Step 3: Hacer `confirmarEliminar` asíncrona**

Reemplazar la función de `items.vue:923-926`:

```typescript
async function confirmarEliminar(id: string) {
  try {
    usoItem.value = await useApiFetch<UsoItem>(`${apiUrl}/items/${id}/uso`)
  } catch (e) {
    toast.add({
      title: apiErrorMsg(e, 'Error al verificar el uso del item'),
      color: 'error',
    })
    return
  }
  confirmDeleteId.value = id
  confirmModalOpen.value = true
}
```

Si `/uso` falla, el modal **no** abre. El guard del backend sigue siendo la defensa real; esto es solo la vista.

El llamador de `items.vue:614` (`onSelect: () => confirmarEliminar(item.id)`) no necesita cambios: descarta la promesa igual que hoy.

- [ ] **Step 4: Actualizar el template**

Reemplazar el bloque de `items.vue:1926-1931`:

```vue
<CrudModal
  v-model:open="confirmModalOpen"
  :title="eliminarTitulo"
  :message="eliminarMensaje"
  :solo-cerrar="eliminarBloqueado"
  @confirm="eliminar"
>
  <template v-if="eliminarBloqueado" #detalle>
    <ul class="mt-2 list-disc pl-5 text-sm">
      <li
        v-for="b in usoItem?.bloqueos ?? []"
        :key="`${b.tipo}-${b.nombre}`"
      >
        {{ ETIQUETA_USO[b.tipo] }} <strong>{{ b.nombre }}</strong>
      </li>
    </ul>
  </template>
</CrudModal>
```

- [ ] **Step 5: Gate del frontend**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

`design:check` tiene que pasar: las clases usadas (`mt-2`, `list-disc`, `pl-5`, `text-sm`) son de layout, no tokens de color hardcodeados — `text-sm` ya se usa en el mismo `CrudModal`.

- [ ] **Step 6: Smoke test en navegador**

Las páginas no tienen test unit, y ni el build ni el typecheck ven bugs de runtime. Con `docker-compose up` levantado, en `/configuracion/items` verificar las **tres** formas del modal:

1. Borrar un ingrediente en uso como ingrediente fijo → título "No se puede eliminar", lista con el motivo, un solo botón "Entendido".
2. Borrar un ingrediente ofrecido solo como extra → mensaje que nombra las recetas, botón "Eliminar" disponible, y al confirmar el item desaparece de la tabla.
3. Borrar un item sin usos → el texto genérico de siempre, sin lista.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/crud/CrudModal.vue \
        frontend/app/pages/configuracion/items.vue
git commit -m "feat(items): el modal de borrado dice qué se rompe antes de confirmar"
```

---

## Task 4: Documentación viva

**Files:**
- Modify: `docs/features/recetas.md`
- Modify: `docs/ESTADO.md`
- Modify: `docs/agent/pendientes.md` (quitar el ítem)
- Modify: `docs/agent/resueltos.md` (agregarlo cerrado)

**Interfaces:** ninguna — es documentación.

- [ ] **Step 1: Documentar la asimetría en `docs/features/recetas.md`**

Agregar una sección que explique la regla de negocio, no el código:

> **Borrar un ingrediente que se usa como extra.** Ser ingrediente fijo de una receta,
> componente de un combo u opción de un grupo **bloquea** el borrado: sin ese item la receta,
> el combo o el grupo quedan incompletos. Ser **extra** no bloquea, porque un extra es
> opcional por definición y su ausencia no rompe nada — pero sí **advierte**, porque el efecto
> (dejar de ofrecerse en esas recetas) no es obvio desde la ficha del ingrediente.
> `GET /items/:id/uso` devuelve ambas categorías ya clasificadas; al confirmar el borrado, las
> filas de `receta_extras_permitidos` del ingrediente se marcan `eliminado_el`.

- [ ] **Step 2: Actualizar `docs/ESTADO.md`**

Agregar una fila en la sección de recetas (cerca de la línea 28-29):

```markdown
| Borrado informado de items (bloqueos vs advertencias; el extra advierte, no bloquea) | ✅ Implementado (2026-07-28) |
```

- [ ] **Step 3: Cerrar el pendiente, corrigiendo la afirmación falsa**

Quitar de `docs/agent/pendientes.md` el ítem **"¿`remove()` debe bloquear el borrado de un ingrediente usado solo como extra?"** (§"Decidido por el owner", ~línea 453) y agregarlo a `docs/agent/resueltos.md` con el detalle del fix.

En la entrada de `resueltos.md` **corregir explícitamente** la afirmación de que esto era "la condición habilitante del bug de conversión de unidad": es falsa desde `51df04c`. Ambas lecturas de extras hacen `JOIN items … eliminado_el IS NULL`, así que un ingrediente borrado produce **ausencia** del extra (`400 "Extra no permitido"` al venderlo), no una unidad equivocada. Decidido: no bloquear, advertir.

- [ ] **Step 4: Verificar los enlaces y commitear**

El pre-commit valida enlaces internos de los `.md` staged.

```bash
git add docs/features/recetas.md docs/ESTADO.md \
        docs/agent/pendientes.md docs/agent/resueltos.md
git commit -m "docs(recetas): el extra advierte y no bloquea el borrado del ingrediente"
```

---

## Cierre

Correr el gate completo una última vez y la revisión independiente del paso 7 de `verify-feature` sobre el diff acumulado de las cuatro tareas:

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh && cd backend && npm run test:e2e
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```
