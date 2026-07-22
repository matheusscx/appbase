# Grupos modificadores anidados en combos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que un combo exponga y venda, por unidad, los grupos de modificadores de sus componentes receta (elegir la proteína de la hamburguesa además de la bebida del combo), y reemplazar globalmente los radio buttons de grupos por un selector (simple/múltiple según `max`).

**Architecture:** reuso total de la maquinaria de grupos existente. `resolverGruposDeItem` ya es agnóstico del item → se llama con el `itemId` de cada componente. El recargo viaja por `precioExtraTotal` (el motor de precios no se toca) y el stock por `venderOpcionesGrupos` (siempre bloqueante). Cero tablas nuevas: solo se extiende la forma del JSON de `personalizacion` con una dimensión `componentes[]` (opcional, aditiva, cero migración).

**Tech Stack:** NestJS + TypeORM (SQL raw), Decimal.js, class-validator; frontend Nuxt 4 (Vue 3) + Nuxt UI; Jest (unit + e2e supertest).

## Global Constraints

- **Dinero y porcentajes con Decimal.js**, nunca `number` nativo. Toda suma de recargo con `Decimal`.
- **`tenant_id` sale del token**, nunca del body/query/ruta.
- **Soft delete**: toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`.
- **Sin N+1**: el dato derivado por fila se resuelve en batch (`WHERE id = ANY($1)`), no una query por iteración. Excepción aceptada: resolución de una sola línea de venta (componentes × unidades de UN combo, constante y acotado — mismo patrón que `resolverPersonalizacionReceta`).
- **No tocar** `calculo-precios.engine.ts` ni el sistema de tokens JWT.
- **Stock de opción de grupo siempre bloqueante** (regla ya existente, no configurable).
- **Design System**: tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado. Correr `design:check`.
- Diseño fuente: `docs/superpowers/specs/2026-07-22-grupos-modificadores-anidados-combo-design.md`.

---

## Estructura de archivos

**Backend (modificar):**
- `backend/src/common/dto/personalizacion-receta.dto.ts` — tipos snapshot + DTO de entrada (`componentes`).
- `backend/src/modules/items/items.service.ts` — `findOne` (lectura), `findAll` (`disponibleCondicional`), `resolverPersonalizacionCombo` (resolución), `venderComponentesCombo` (stock).
- `backend/src/modules/items/items.service.spec.ts` — unit tests.
- `backend/test/combos.e2e-spec.ts` — e2e.

**Frontend (modificar):**
- `frontend/app/composables/useRecetaPersonalizacion.ts` — tipos + payload builder.
- `frontend/app/components/ventas/ItemPersonalizacionDrawer.vue` — selector global + render por componente/unidad.
- `frontend/app/composables/useVenta.ts` y `frontend/app/composables/useSalones.ts` — clave de merge.

**Docs (mismo commit que el código que las toca):**
- `docs/features/grupos-modificadores.md`, `docs/features/combos.md`, `docs/PRODUCTO.md`, `docs/ESTADO.md`, `docs/adr/` (ADR nuevo), `docs/adr/README.md`.

---

## Task 1: Extender tipos de snapshot y DTO de entrada

**Files:**
- Modify: `backend/src/common/dto/personalizacion-receta.dto.ts`

**Interfaces:**
- Consumes: `SnapshotGrupo`, `PersonalizacionGrupoInputDto` (ya existen en este archivo).
- Produces:
  - `PersonalizacionRecetaSnapshot.componentes?: { componenteItemId: string; componenteNombre: string; unidad: number; grupos: SnapshotGrupo[] }[]`
  - `class PersonalizacionComponenteInputDto { componenteItemId: string; unidad: number; grupos: PersonalizacionGrupoInputDto[] }`
  - `PersonalizacionRecetaDto.componentes?: PersonalizacionComponenteInputDto[]`

- [ ] **Step 1: Agregar el campo `componentes` a la interfaz de snapshot**

En `PersonalizacionRecetaSnapshot`, después de `grupos?: SnapshotGrupo[];`, agregar:

```ts
  /**
   * Combos: elección de grupos de los componentes receta, por unidad.
   * Una entrada por (componente, unidad). Ausente en snapshots antiguos
   * y en combos sin componentes con grupos.
   */
  componentes?: {
    componenteItemId: string;
    componenteNombre: string;
    /** 1..cantidad del componente en el combo. */
    unidad: number;
    grupos: SnapshotGrupo[];
  }[];
```

- [ ] **Step 2: Agregar la clase de entrada `PersonalizacionComponenteInputDto`**

Después de `PersonalizacionGrupoInputDto` (antes de `PersonalizacionRecetaDto`), agregar:

```ts
export class PersonalizacionComponenteInputDto {
  @IsUUID()
  componenteItemId: string;

  @IsInt()
  @Min(1)
  unidad: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionGrupoInputDto)
  grupos: PersonalizacionGrupoInputDto[];
}
```

- [ ] **Step 3: Agregar `componentes` al `PersonalizacionRecetaDto`**

Al final de la clase `PersonalizacionRecetaDto`, después de `grupos?`, agregar:

```ts
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonalizacionComponenteInputDto)
  componentes?: PersonalizacionComponenteInputDto[];
```

- [ ] **Step 4: Verificar que compila**

Run: `cd backend && npm run typecheck`
Expected: PASS (sin errores).

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/dto/personalizacion-receta.dto.ts
git commit -m "feat(combos): tipos de personalizacion por componente en snapshot y DTO"
```

---

## Task 2: Resolución al vender — `resolverPersonalizacionCombo` resuelve grupos de componentes por unidad

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (método `resolverPersonalizacionCombo`, ~línea 1781)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `resolverGruposDeItem(manager, tenantId, itemId, gruposDto)` → `{ grupos: SnapshotGrupo[]; precioExtraTotal: string }` (ya existe, línea 1662); `PersonalizacionRecetaDto.componentes` (Task 1).
- Produces: `resolverPersonalizacionCombo` sigue devolviendo `{ snapshot: PersonalizacionRecetaSnapshot; precioExtraTotal: string }`, ahora con `snapshot.componentes` poblado y `precioExtraTotal` incluyendo el recargo de los componentes.

**Reglas de la resolución (spec §3):**
1. Enumerar los componentes receta del combo que tienen ≥1 grupo asociado, con su `cantidad`.
2. Para cada (componenteItemId, unidad ∈ 1..cantidad): buscar la entrada de `dto.componentes` que matchee `componenteItemId` + `unidad`; resolver sus grupos con `resolverGruposDeItem` (si no vino, se resuelve con `[]` → dispara la validación de `min` de grupos obligatorios).
3. Rechazar entradas de `dto.componentes` cuyo `componenteItemId` no sea componente vivo del combo, o cuya `unidad` esté fuera de `1..cantidad`, o unidad duplicada por componente.
4. Sumar `precioExtraTotal` de combo + todas las (componente, unidad) con Decimal.js.
5. Congelar `snapshot.componentes` solo con las (componente, unidad) que tienen al menos un grupo con opciones.

- [ ] **Step 1: Escribir el test que falla — vender combo con proteína por unidad**

En `items.service.spec.ts`, en el describe de `resolverPersonalizacionCombo` (si no existe, crearlo siguiendo el patrón de los tests de `resolverGruposDeItem`), agregar:

```ts
it('resuelve los grupos de un componente receta por unidad y suma el recargo', async () => {
  // combo con componente receta (id receta) cantidad 2, grupo "Proteína" (min 1, max 1)
  // opción "chuleta" +1500. Se elige chuleta en la unidad 1 y carne (+0) en la unidad 2.
  const dto = {
    componentes: [
      { componenteItemId: RECETA_ID, unidad: 1, grupos: [{ grupoId: PROTEINA_ID, opciones: [{ itemId: CHULETA_ID, unidades: 1 }] }] },
      { componenteItemId: RECETA_ID, unidad: 2, grupos: [{ grupoId: PROTEINA_ID, opciones: [{ itemId: CARNE_ID, unidades: 1 }] }] },
    ],
  };
  const res = await service.resolverPersonalizacionCombo(manager, TENANT_ID, COMBO_ID, dto as any);
  expect(res.precioExtraTotal).toBe('1500.0000');
  expect(res.snapshot.componentes).toHaveLength(2);
  expect(res.snapshot.componentes![0]).toMatchObject({ componenteItemId: RECETA_ID, unidad: 1 });
});

it('rechaza un componenteItemId que no es componente vivo del combo', async () => {
  const dto = { componentes: [{ componenteItemId: ITEM_AJENO_ID, unidad: 1, grupos: [] }] };
  await expect(
    service.resolverPersonalizacionCombo(manager, TENANT_ID, COMBO_ID, dto as any),
  ).rejects.toThrow(BadRequestException);
});

it('rechaza una unidad fuera del rango 1..cantidad del componente', async () => {
  const dto = { componentes: [{ componenteItemId: RECETA_ID, unidad: 3, grupos: [] }] }; // cantidad = 2
  await expect(
    service.resolverPersonalizacionCombo(manager, TENANT_ID, COMBO_ID, dto as any),
  ).rejects.toThrow(BadRequestException);
});
```

> Seguir el estilo de mocking de `manager.query` ya usado en el archivo (ver los tests existentes de `resolverGruposDeItem` para los ids fijos y el patrón de stubs). Definir las constantes `COMBO_ID`, `RECETA_ID`, `PROTEINA_ID`, `CHULETA_ID`, `CARNE_ID`, `ITEM_AJENO_ID` como uuids de prueba.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && npm test -- items.service.spec.ts -t "resolverPersonalizacionCombo"`
Expected: FAIL (los tests nuevos no pasan — `componentes` aún no se procesa).

- [ ] **Step 3: Implementar la resolución de componentes**

Reemplazar el cuerpo de `resolverPersonalizacionCombo` (líneas ~1781-1805) por:

```ts
  async resolverPersonalizacionCombo(
    manager: EntityManager,
    tenantId: string,
    comboItemId: string,
    dto?: PersonalizacionRecetaDto,
  ): Promise<{
    snapshot: PersonalizacionRecetaSnapshot;
    precioExtraTotal: string;
  }> {
    // 1. Grupos propios del combo (comportamiento existente).
    const propios = await this.resolverGruposDeItem(
      manager,
      tenantId,
      comboItemId,
      dto?.grupos,
    );
    let precioExtraTotal = new Decimal(propios.precioExtraTotal);

    // 2. Componentes receta del combo con sus cantidades (para validar
    //    pertenencia y rango de unidad, y saber cuántas unidades esperar).
    const compRows: { componente_item_id: string; nombre: string; cantidad: string }[] =
      await manager.query(
        `SELECT cc.componente_item_id, i.nombre, cc.cantidad
         FROM combo_componentes cc
         JOIN items i ON i.item_id = cc.componente_item_id AND i.eliminado_el IS NULL
         WHERE cc.combo_item_id = $1 AND cc.tenant_id = $2
           AND cc.eliminado_el IS NULL AND i.tipo = 'receta'`,
        [comboItemId, tenantId],
      );
    const compById = new Map(compRows.map((c) => [c.componente_item_id, c]));

    // 3. Qué componentes receta tienen ≥1 grupo asociado (batch, sin N+1).
    const recetaIds = compRows.map((c) => c.componente_item_id);
    const conGrupos = new Set<string>();
    if (recetaIds.length) {
      const rows: { item_id: string }[] = await manager.query(
        `SELECT DISTINCT item_id FROM item_grupos_modificadores
         WHERE item_id = ANY($1) AND tenant_id = $2 AND eliminado_el IS NULL`,
        [recetaIds, tenantId],
      );
      for (const r of rows) conGrupos.add(r.item_id);
    }

    // 4. Validar las entradas que mandó el front: componente vivo + unidad en rango + sin duplicar.
    const elegidasPorClave = new Map<string, PersonalizacionGrupoInputDto[]>();
    for (const c of dto?.componentes ?? []) {
      const comp = compById.get(c.componenteItemId);
      if (!comp) {
        throw new BadRequestException(
          'El componente no pertenece a este combo o no admite grupos',
        );
      }
      if (
        !Number.isInteger(c.unidad) ||
        c.unidad < 1 ||
        new Decimal(comp.cantidad).lt(c.unidad)
      ) {
        throw new BadRequestException(
          `Unidad inválida para el componente ${comp.nombre}`,
        );
      }
      const clave = `${c.componenteItemId}#${c.unidad}`;
      if (elegidasPorClave.has(clave)) {
        throw new BadRequestException(
          `Unidad ${c.unidad} duplicada para el componente ${comp.nombre}`,
        );
      }
      elegidasPorClave.set(clave, c.grupos);
    }

    // 5. Resolver TODA (componente con grupos, unidad) esperada — aunque el
    //    front la haya omitido — para que un grupo obligatorio sin elección
    //    dispare la validación de min dentro de resolverGruposDeItem.
    const componentesSnap: NonNullable<
      PersonalizacionRecetaSnapshot['componentes']
    > = [];
    for (const comp of compRows) {
      if (!conGrupos.has(comp.componente_item_id)) continue;
      const unidades = new Decimal(comp.cantidad).toNumber();
      for (let u = 1; u <= unidades; u++) {
        const grupos = elegidasPorClave.get(`${comp.componente_item_id}#${u}`);
        const resuelto = await this.resolverGruposDeItem(
          manager,
          tenantId,
          comp.componente_item_id,
          grupos,
        );
        precioExtraTotal = precioExtraTotal.plus(resuelto.precioExtraTotal);
        if (resuelto.grupos.length) {
          componentesSnap.push({
            componenteItemId: comp.componente_item_id,
            componenteNombre: comp.nombre,
            unidad: u,
            grupos: resuelto.grupos,
          });
        }
      }
    }

    return {
      snapshot: {
        omitidos: [],
        extras: [],
        comentario: dto?.comentario?.trim() || undefined,
        grupos: propios.grupos.length ? propios.grupos : undefined,
        componentes: componentesSnap.length ? componentesSnap : undefined,
      },
      precioExtraTotal: precioExtraTotal.toFixed(4),
    };
  }
```

> Verificar que `PersonalizacionGrupoInputDto` ya está importado en el archivo (se usa en `resolverGruposDeItem`). Si no, agregarlo al import de `../../common/dto/personalizacion-receta.dto`.

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd backend && npm test -- items.service.spec.ts -t "resolverPersonalizacionCombo"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit -m "feat(combos): resuelve grupos de componentes receta por unidad al vender"
```

---

## Task 3: Descuento de stock — `venderComponentesCombo` descuenta las opciones de componente por unidad

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (método `venderComponentesCombo`, ~línea 1950; el bloque `venderOpcionesGrupos` de ~línea 2074)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Consumes: `venderOpcionesGrupos(manager, params, grupos)` (privado, línea 2095) — descuenta stock por `SnapshotGrupo[]`, siempre bloqueante, multiplicando `op.cantidad × op.unidades × cantidadVendida`. `snapshot.componentes` (Task 1).
- Produces: `venderComponentesCombo` descuenta también las opciones congeladas en `snapshot.componentes[].grupos`.

**Nota de multiplicidad:** cada entrada de `snapshot.componentes` es UNA unidad. `venderOpcionesGrupos` ya multiplica por `cantidadVendida` (cantidad de combos). No multiplicar por la cantidad del componente: la multiplicidad del componente ya está enumerada como unidades separadas en el snapshot.

- [ ] **Step 1: Escribir el test que falla — el stock de la opción de componente se descuenta**

En `items.service.spec.ts`, en el describe de `venderComponentesCombo`, agregar:

```ts
it('descuenta el stock de la opción de grupo de cada componente-unidad', async () => {
  const registrarMovimiento = jest.spyOn(inventarioService, 'registrarMovimiento');
  const snapshot = {
    omitidos: [], extras: [],
    componentes: [
      { componenteItemId: RECETA_ID, componenteNombre: 'Hamburguesa', unidad: 1,
        grupos: [{ grupoId: PROTEINA_ID, grupoNombre: 'Proteína',
          opciones: [{ itemId: CHULETA_ID, nombre: 'Chuleta', cantidad: '150', unidadCodigo: 'g', precioExtra: '1500', unidades: '1' }] }] },
    ],
  };
  await service.venderComponentesCombo(manager, {
    tenantId: TENANT_ID, usuarioId: USER_ID, ventaId: VENTA_ID,
    comboItemId: COMBO_ID, comboNombre: 'Combo', cantidadVendida: '1',
    snapshot: snapshot as any,
  });
  // se registró una salida para la chuleta (ítem de la opción de grupo del componente)
  expect(registrarMovimiento).toHaveBeenCalledWith(
    manager,
    expect.objectContaining({ itemId: CHULETA_ID, tipo: 'salida', motivo: 'venta' }),
  );
});
```

> Reusar los stubs de `manager.query` del bloque de tests existente de `venderComponentesCombo` (el que devuelve `combo_componentes`). Para la opción chuleta, el stub de `venderOpcionesGrupos` consulta `items`/`item_producto` — replicar el patrón ya usado en los tests de venta de grupos.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && npm test -- items.service.spec.ts -t "venderComponentesCombo"`
Expected: FAIL (la opción de componente aún no se descuenta).

- [ ] **Step 3: Implementar la segunda pasada de descuento**

En `venderComponentesCombo`, localizar el bloque final (líneas ~2074-2083):

```ts
    await this.venderOpcionesGrupos(
      manager,
      {
        tenantId: params.tenantId,
        usuarioId: params.usuarioId,
        ventaId: params.ventaId,
        cantidadVendida: params.cantidadVendida,
      },
      params.snapshot?.grupos,
    );

    return advertencias;
```

Insertar, **antes** del `return advertencias;` y después del `venderOpcionesGrupos` existente, la pasada por los grupos de componente:

```ts
    // Grupos de los componentes receta (elección por unidad congelada en el
    // snapshot). Cada entrada es UNA unidad → venderOpcionesGrupos ya
    // multiplica por cantidadVendida; no multiplicar por la cantidad del
    // componente (ya está enumerada como unidades separadas).
    const gruposComponentes = (params.snapshot?.componentes ?? []).flatMap(
      (c) => c.grupos,
    );
    if (gruposComponentes.length) {
      await this.venderOpcionesGrupos(
        manager,
        {
          tenantId: params.tenantId,
          usuarioId: params.usuarioId,
          ventaId: params.ventaId,
          cantidadVendida: params.cantidadVendida,
        },
        gruposComponentes,
      );
    }

    return advertencias;
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `cd backend && npm test -- items.service.spec.ts -t "venderComponentesCombo"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit -m "feat(combos): descuenta stock de las opciones de grupo de cada componente"
```

---

## Task 4: Lectura — `GET /items/:id` adjunta los grupos de cada componente receta

**Files:**
- Modify: `backend/src/modules/items/items.service.ts` (`findOne`, bloque combo ~línea 343-368 y el return ~línea 460; `findAll` `disponibleCondicional` ~línea 233)
- Test: `backend/src/modules/items/items.service.spec.ts`

**Interfaces:**
- Produces: cada objeto de `componentes[]` en la respuesta de `findOne` de un combo gana `grupos: GrupoDetalle[]` (misma forma que el `grupos[]` top-level del item: `{ grupoModificadorId, nombre, min, max, orden, opciones: {...}[] }`). `disponibleCondicional` del combo pasa a `true` si el combo tiene grupos propios **o** algún componente los tiene.

- [ ] **Step 1: Escribir el test que falla — el detalle del combo trae los grupos del componente**

En `items.service.spec.ts`, en el describe de `findOne`, agregar:

```ts
it('adjunta los grupos de cada componente receta en el detalle del combo', async () => {
  // stub: combo con un componente receta que tiene el grupo "Proteína"
  const res = await service.findOne(TENANT_ID, COMBO_ID);
  const comp = res.componentes.find((c: any) => c.componenteItemId === RECETA_ID);
  expect(comp.grupos).toHaveLength(1);
  expect(comp.grupos[0]).toMatchObject({ grupoModificadorId: PROTEINA_ID, min: 1, max: 1 });
  expect(res.disponibleCondicional).toBe(true);
});
```

> Extender los stubs de `manager.query`/`dataSource.query` del test de combo existente para devolver las filas de `item_grupos_modificadores` y `grupo_modificador_opciones` del componente. Copiar la forma de las filas de los stubs ya usados para los grupos top-level.

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `cd backend && npm test -- items.service.spec.ts -t "componente receta en el detalle"`
Expected: FAIL (`comp.grupos` es `undefined`).

- [ ] **Step 3: Extraer un helper de carga de grupos por item (batch)**

En `items.service.ts`, agregar un método privado que cargue los grupos de un conjunto de item_ids en **2 queries constantes** (no una por item). Colocarlo cerca de `findOne`:

```ts
  /**
   * Carga los grupos de modificadores (con opciones y override efectivo) de un
   * conjunto de items, en un nº constante de queries (batch, sin N+1). Devuelve
   * un Map itemId → grupos con la MISMA forma que el `grupos[]` de findOne.
   */
  private async cargarGruposPorItem(
    tenantId: string,
    itemIds: string[],
  ): Promise<Map<string, GrupoDetalle[]>> {
    const out = new Map<string, GrupoDetalle[]>();
    if (!itemIds.length) return out;

    const asoc: {
      item_id: string; grupo_modificador_id: string; item_grupo_id: string;
      nombre: string; min: number; max: number; orden: number;
    }[] = await this.dataSource.query(
      `SELECT igm.item_id, igm.grupo_modificador_id, igm.item_grupo_id,
              g.nombre, igm.min, igm.max, igm.orden
       FROM item_grupos_modificadores igm
       JOIN grupos_modificadores g ON g.grupo_modificador_id = igm.grupo_modificador_id
         AND g.eliminado_el IS NULL
       WHERE igm.item_id = ANY($1) AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL
       ORDER BY igm.orden ASC`,
      [itemIds, tenantId],
    );
    if (!asoc.length) return out;

    const itemGrupoIds = asoc.map((a) => a.item_grupo_id);
    const ops: {
      item_grupo_id: string; grupo_opcion_id: string; item_id: string;
      item_nombre: string; tipo: string; cantidad_efectiva: string | null;
      cantidad_default: string | null; unidad_codigo: string | null;
      precio_extra: string; orden: number; stock: string | null;
    }[] = await this.dataSource.query(
      `SELECT igm.item_grupo_id, o.grupo_opcion_id, o.item_id, i.nombre AS item_nombre, i.tipo,
              COALESCE(ovr.cantidad, o.cantidad) AS cantidad_efectiva,
              o.cantidad AS cantidad_default,
              COALESCE(ovr.unidad_codigo, o.unidad_codigo) AS unidad_codigo,
              COALESCE(ovr.precio_extra, o.precio_extra) AS precio_extra,
              o.orden, ip.stock
       FROM item_grupos_modificadores igm
       JOIN grupo_modificador_opciones o ON o.grupo_modificador_id = igm.grupo_modificador_id
         AND o.tenant_id = igm.tenant_id AND o.eliminado_el IS NULL
       JOIN items i ON i.item_id = o.item_id AND i.eliminado_el IS NULL
       LEFT JOIN item_producto ip ON ip.item_id = o.item_id
       LEFT JOIN item_grupo_modificador_opciones ovr
         ON ovr.grupo_opcion_id = o.grupo_opcion_id
        AND ovr.item_grupo_id = igm.item_grupo_id
        AND ovr.eliminado_el IS NULL
       WHERE igm.item_grupo_id = ANY($1) AND igm.tenant_id = $2 AND igm.eliminado_el IS NULL
       ORDER BY o.orden ASC`,
      [itemGrupoIds, tenantId],
    );
    const opsPorItemGrupo = new Map<string, typeof ops>();
    for (const o of ops) {
      const arr = opsPorItemGrupo.get(o.item_grupo_id) ?? [];
      arr.push(o);
      opsPorItemGrupo.set(o.item_grupo_id, arr);
    }

    for (const a of asoc) {
      const arr = out.get(a.item_id) ?? [];
      arr.push({
        grupoModificadorId: a.grupo_modificador_id,
        nombre: a.nombre,
        min: a.min, max: a.max, orden: a.orden,
        opciones: (opsPorItemGrupo.get(a.item_grupo_id) ?? []).map((r) => ({
          grupoOpcionId: r.grupo_opcion_id,
          itemId: r.item_id,
          itemNombre: r.item_nombre,
          tipo: r.tipo,
          cantidad: r.cantidad_efectiva,
          cantidadDefault: r.cantidad_default,
          unidadCodigo: r.unidad_codigo,
          precioExtra: r.precio_extra,
          orden: r.orden,
          stock: r.stock,
          esPendiente: r.cantidad_efectiva == null,
        })),
      });
      out.set(a.item_id, arr);
    }
    return out;
  }
```

Definir el tipo `GrupoDetalle` (una interfaz privada o `type`) reutilizando la forma del array `grupos` que hoy declara `findOne` inline (líneas ~370-389). Extraerlo a un `type GrupoDetalle = { grupoModificadorId: string; nombre: string; min: number; max: number; orden: number; opciones: {...}[] }` a nivel de módulo y usarlo tanto en `findOne` como en el helper.

- [ ] **Step 4: Usar el helper en `findOne` para adjuntar grupos a los componentes**

En el bloque `if (rows[0].tipo === 'combo')` de `findOne` (después de armar `componentes` en línea ~360-367), reemplazar el mapeo por uno que adjunte los grupos batcheados:

```ts
      const gruposPorComp = await this.cargarGruposPorItem(
        tenantId,
        compRows.filter((r) => r.tipo === 'receta').map((r) => r.componente_item_id),
      );
      componentes = compRows.map((r) => ({
        componenteItemId: r.componente_item_id,
        componenteNombre: r.componente_nombre,
        tipo: r.tipo,
        cantidad: r.cantidad,
        bloqueante: r.bloqueante,
        stock: r.stock,
        grupos: gruposPorComp.get(r.componente_item_id) ?? [],
      }));
```

Agregar `grupos` al tipo del array `componentes` declarado arriba (línea ~283-290): `grupos: GrupoDetalle[];`.

- [ ] **Step 5: Ajustar `disponibleCondicional` en el return de `findOne`**

En el return de `findOne` (línea ~469), cambiar:

```ts
      disponibleCondicional: rows[0].tipo === 'combo' && grupos.length > 0,
```

por:

```ts
      disponibleCondicional:
        rows[0].tipo === 'combo' &&
        (grupos.length > 0 ||
          componentes.some((c) => (c.grupos?.length ?? 0) > 0)),
```

- [ ] **Step 6: Ajustar `disponibleCondicional` en `findAll` (listado)**

En `findAll`, el `Set` `comboIdsConGrupos` (línea ~203-211) hoy solo mira `item_grupos_modificadores.item_id`. Un combo cuyo componente tiene grupos también debe marcarse. Cambiar la query del set por una que incluya combos con componentes-con-grupos:

```ts
    let comboIdsConGrupos = new Set<string>();
    if (rows.some((r) => r.tipo === 'combo')) {
      const grupoItemRows: { item_id: string }[] = await this.dataSource.query(
        `SELECT DISTINCT item_id FROM item_grupos_modificadores
         WHERE tenant_id = $1 AND eliminado_el IS NULL
         UNION
         SELECT DISTINCT cc.combo_item_id AS item_id
         FROM combo_componentes cc
         JOIN item_grupos_modificadores igm ON igm.item_id = cc.componente_item_id
           AND igm.tenant_id = cc.tenant_id AND igm.eliminado_el IS NULL
         WHERE cc.tenant_id = $1 AND cc.eliminado_el IS NULL`,
        [tenantId],
      );
      comboIdsConGrupos = new Set(grupoItemRows.map((r) => r.item_id));
    }
```

- [ ] **Step 7: Correr los tests**

Run: `cd backend && npm test -- items.service.spec.ts`
Expected: PASS (incluido el test nuevo y los existentes de `findOne`/`findAll`).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/items/items.service.ts backend/src/modules/items/items.service.spec.ts
git commit -m "feat(combos): GET /items/:id adjunta los grupos de cada componente receta (batch)"
```

---

## Task 5: Frontend — tipos y payload por componente

**Files:**
- Modify: `frontend/app/composables/useRecetaPersonalizacion.ts`

**Interfaces:**
- Produces:
  - `RecetaIngredientePersonalizacion`/`GrupoPersonalizacion` sin cambios; `RecetaDetallePersonalizacion` gana en su `componentes` (para combos) un `grupos: GrupoPersonalizacion[]` por componente. Agregar el tipo `ComponentePersonalizacion { componenteItemId, componenteNombre, tipo, cantidad, grupos: GrupoPersonalizacion[] }` y `RecetaDetallePersonalizacion.componentes?: ComponentePersonalizacion[]`.
  - `PersonalizacionComponentePayload { componenteItemId: string; unidad: number; grupos: PersonalizacionGrupoPayload[] }` y `PersonalizacionPayload.componentes?: PersonalizacionComponentePayload[]`.
  - `buildPersonalizacionPayload` acepta un 5º parámetro `componentes: PersonalizacionComponentePayload[] = []` y lo agrega al payload si tiene entradas con grupos.

- [ ] **Step 1: Agregar los tipos**

En `useRecetaPersonalizacion.ts`, después de `GrupoPersonalizacion` (línea ~46), agregar:

```ts
/** Componente receta de un combo, con sus grupos — `GET /items/:id`. */
export interface ComponentePersonalizacion {
  componenteItemId: string
  componenteNombre: string
  tipo: string
  cantidad: string
  grupos: GrupoPersonalizacion[]
}
```

En `RecetaDetallePersonalizacion` (línea ~48), agregar:

```ts
  /** Combos: componentes con sus grupos (para la elección por unidad). */
  componentes?: ComponentePersonalizacion[]
```

Después de `PersonalizacionGrupoPayload` (línea ~73), agregar:

```ts
export interface PersonalizacionComponentePayload {
  componenteItemId: string
  /** 1..cantidad del componente. */
  unidad: number
  grupos: PersonalizacionGrupoPayload[]
}
```

En `PersonalizacionPayload` (línea ~75), agregar:

```ts
  componentes?: PersonalizacionComponentePayload[]
```

- [ ] **Step 2: Extender `buildPersonalizacionPayload`**

Reemplazar la firma y el cuerpo (líneas ~110-129) por:

```ts
export function buildPersonalizacionPayload(
  omitidos: string[],
  extras: PersonalizacionExtraPayload[],
  comentario: string,
  grupos: PersonalizacionGrupoPayload[] = [],
  componentes: PersonalizacionComponentePayload[] = [],
): PersonalizacionPayload {
  const payload: PersonalizacionPayload = {
    omitidos,
    extras: extras.map((e) => ({
      ingredienteItemId: e.ingredienteItemId,
      unidades: e.unidades,
    })),
  }
  const trimmed = comentario.trim()
  if (trimmed) payload.comentario = trimmed.slice(0, 200)
  const gruposConSeleccion = grupos.filter((g) => g.opciones.length > 0)
  if (gruposConSeleccion.length) payload.grupos = gruposConSeleccion
  const compConSeleccion = componentes
    .map((c) => ({ ...c, grupos: c.grupos.filter((g) => g.opciones.length > 0) }))
    .filter((c) => c.grupos.length > 0)
  if (compConSeleccion.length) payload.componentes = compConSeleccion
  return payload
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `cd frontend && npm run typecheck:ratchet`
Expected: PASS (0 errores nuevos).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useRecetaPersonalizacion.ts
git commit -m "feat(combos): tipos y payload de personalizacion por componente (front)"
```

---

## Task 6: Frontend — drawer: selector global (radio→USelectMenu) + elección por componente/unidad

**Files:**
- Modify: `frontend/app/components/ventas/ItemPersonalizacionDrawer.vue`

> **REQUIRED:** invocar el skill de Nuxt UI (`nuxt-ui`) antes de editar el `.vue`, y correr `npm run design:check` al cerrar. El componente hoy tiene 506 líneas; leerlo completo antes de editar.

**Interfaces:**
- Consumes: `RecetaDetallePersonalizacion.componentes` (Task 5), `PersonalizacionComponentePayload`, `buildPersonalizacionPayload` (5º arg).
- Produces: al confirmar, emite el payload con `componentes` poblado; la validación `confirmDisabled` exige min/max de cada grupo propio **y** de cada (componente, unidad).

**Cambios (spec §4):**
1. **Selector global:** reemplazar el render radio/checkbox de cada grupo por `USelectMenu` — `multiple` cuando `g.max > 1`, simple cuando `g.max === 1`. La lógica de selección (`gruposSeleccion`, `totalUnidadesGrupo`, `grupoValido`) se mantiene; cambia solo el control y su binding. Las opciones `esPendiente` u `opcionDeshabilitada` se excluyen de las items del selector.
2. **Por componente/unidad:** para cada `detalle.componentes` con `grupos.length`, renderizar su bloque de grupos **`Number(cantidad)` veces**, con estado de selección propio por (componenteItemId, unidad). Encabezar cada repetición con el nombre del componente + "#u".
3. **Payload:** construir `componentes: PersonalizacionComponentePayload[]` desde ese estado y pasarlo como 5º arg a `buildPersonalizacionPayload`.

- [ ] **Step 1: Estado de selección por componente/unidad**

Junto a `gruposSeleccion` (línea ~41), agregar un ref paralelo indexado por clave `componenteItemId#unidad#grupoId`:

```ts
/** Selección de grupos de componentes: clave `componenteItemId#unidad` → grupoId → itemId → unidades. */
const componentesSeleccion = ref<Record<string, Record<string, Record<string, number>>>>({})
```

Resetearlo donde se resetea `gruposSeleccion` (líneas ~52 y ~95): `componentesSeleccion.value = {}`.

- [ ] **Step 2: Reemplazar el control de cada grupo por `USelectMenu`**

Usar la referencia del skill nuxt-ui para `USelectMenu`. Reemplazar el bloque de template que hoy renderiza `URadioGroup`/`UCheckbox` de un grupo por un `USelectMenu` cuyas `items` sean las opciones seleccionables (excluyendo `opcionDeshabilitada`), con `:multiple="g.max > 1"`. El `v-model` se adapta con dos helpers: uno que lee la selección actual como value(s) del selector y otro que la escribe en `gruposSeleccion` (simple) o cuenta unidades (múltiple). Extraer el bloque a un subcomponente interno o a un `<template>` reutilizable para no duplicarlo entre grupos propios y grupos de componente.

> El detalle exacto de props de `USelectMenu` (single vs multiple, `value-key`, `label-key`) sale del skill nuxt-ui. Mantener el texto de regla (`reglaGrupo`) y el estado agotado (`grupoAgotado`).

- [ ] **Step 3: Render por componente/unidad**

Después del bloque de grupos propios del item, agregar el render de componentes:

```vue
<template v-for="comp in (detalle?.componentes ?? []).filter(c => c.grupos.length)" :key="comp.componenteItemId">
  <div v-for="u in Number(comp.cantidad)" :key="`${comp.componenteItemId}#${u}`" class="...">
    <p class="...">{{ comp.componenteNombre }}<span v-if="Number(comp.cantidad) > 1"> #{{ u }}</span></p>
    <!-- por cada comp.grupos: el mismo control USelectMenu, con estado en componentesSeleccion[`${comp.componenteItemId}#${u}`] -->
  </div>
</template>
```

Usar tokens semánticos de Nuxt UI para spacing/typography (nada hardcodeado).

- [ ] **Step 4: Validación e integración al payload**

Extender `gruposValidos` (línea ~158) para que también exija min/max de cada (componente, unidad):

```ts
const componentesValidos = computed(() => {
  for (const comp of detalle.value?.componentes ?? []) {
    if (!comp.grupos.length) continue
    for (let u = 1; u <= Number(comp.cantidad); u++) {
      const sel = componentesSeleccion.value[`${comp.componenteItemId}#${u}`] ?? {}
      for (const g of comp.grupos) {
        const total = Object.values(sel[g.grupoModificadorId] ?? {}).reduce((a, b) => a + b, 0)
        if (total < g.min || total > g.max) return false
      }
    }
  }
  return true
})
```

Incluir `componentesValidos.value` en `confirmDisabled` (línea ~281). Construir el array `componentes` para el payload desde `componentesSeleccion` y pasarlo como 5º arg de `buildPersonalizacionPayload` en el handler de confirmación (donde hoy se llama, cerca de línea ~252).

- [ ] **Step 5: Verificar build + typecheck + design**

Run:
```
cd frontend && npm run typecheck:ratchet && npm run design:check && npm run build
```
Expected: PASS los tres.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/ventas/ItemPersonalizacionDrawer.vue
git commit -m "feat(combos): drawer con selector global y eleccion de grupos por componente/unidad"
```

---

## Task 7: Frontend — clave de merge incluye la elección de componentes

**Files:**
- Modify: `frontend/app/composables/useSalones.ts` (y/o `useVenta.ts` donde se calcula la clave canónica de personalización)

**Interfaces:**
- Consumes: `PersonalizacionPayload.componentes` (Task 5).
- Produces: `canonicalPersonalizacion`/`mismaPersonalizacion` distinguen dos líneas del mismo combo con distinta elección de componente.

- [ ] **Step 1: Localizar la canonicalización**

Run: `cd frontend && grep -rn "canonicalPersonalizacion\|mismaPersonalizacion\|function.*[Cc]anonical" app/composables/`
Leer la función que serializa la personalización a clave de merge.

- [ ] **Step 2: Incluir `componentes` en la clave canónica**

Agregar `componentes` (ordenado determinísticamente por `componenteItemId`, luego `unidad`, luego `grupoId`, luego `itemId`) a la serialización canónica, con el mismo criterio que ya se usa para `grupos`. Reusar el helper de orden existente; no introducir uno nuevo si ya hay uno para `grupos`.

- [ ] **Step 3: Verificar typecheck + tests de composable si existen**

Run: `cd frontend && npm run typecheck:ratchet && npm test -- useVenta.spec`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/composables/useSalones.ts frontend/app/composables/useVenta.ts
git commit -m "feat(combos): la clave de merge distingue la eleccion de grupos por componente"
```

---

## Task 8: E2E + documentación viva

**Files:**
- Modify: `backend/test/combos.e2e-spec.ts`
- Modify: `docs/features/grupos-modificadores.md`, `docs/features/combos.md`, `docs/PRODUCTO.md`, `docs/ESTADO.md`
- Create: `docs/adr/015-grupos-modificadores-anidados-combo.md` (número: verificar el siguiente libre en `docs/adr/`); Modify: `docs/adr/README.md`

- [ ] **Step 1: E2E — vender un combo con proteína elegida por unidad**

En `combos.e2e-spec.ts`, agregar un caso que, contra el seed real:
1. Asocie (o use un combo del seed que tenga) un componente receta con grupo.
2. `GET /items/:id` del combo → assert que el componente trae `grupos`.
3. `POST /ventas` con `personalizacion.componentes` eligiendo una opción premium en una unidad → assert: total de la línea = `precioBase + precioExtra` (contra el valor de `docs/features/`, NO del output del código), y el movimiento de inventario de la opción quedó registrado.
4. Caso negativo: `componenteItemId` que no es del combo → 400.

> Si el seed no tiene un combo con componente-receta-con-grupo, agregarlo en `seeder.service.ts` (IDs `550e8400-…-446655440XXX`, siguiente libre) y documentarlo en la sección Seed de `grupos-modificadores.md`. Esto puede requerir asociar el grupo "Proteína" a "Hamburguesa Clásica" (`…440259`) y meterla como componente de un combo.

- [ ] **Step 2: Correr el e2e**

Run: `cd backend && npm run test:e2e -- combos.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 3: Actualizar docs**

- `grupos-modificadores.md`: sección nueva "Grupos anidados en combos (un nivel)" — automático, por unidad, solo recetas; cómo se congela en `snapshot.componentes`; mover la línea de "Grupos anidados … NOT included" al alcance cubierto (dejando fuera el anidamiento >1 nivel y grupos en productos).
- `combos.md`: en Scope/Notes, que la personalización del combo ahora incluye los grupos de sus componentes receta.
- `PRODUCTO.md`: regla de negocio — al vender un combo se elige, por unidad de componente, la opción de cada grupo del componente.
- `ESTADO.md`: fila de combos/grupos actualizada con fecha 2026-07-22.
- ADR nuevo: decisión (automático + por unidad + un nivel + cero tablas, reuso de `resolverGruposDeItem`/`venderOpcionesGrupos`); + fila en `docs/adr/README.md`. Referenciar el cambio global radio→selector.

- [ ] **Step 4: Verificar enlaces de docs**

Run: `cd /Users/m2pro/cmatheus/startup-app && node docs/scripts/check-docs-links.* 2>/dev/null || true`
(El pre-commit ya valida enlaces internos de `.md` staged; confiar en el hook si no hay script directo.)

- [ ] **Step 5: Commit**

```bash
git add backend/test/combos.e2e-spec.ts backend/src/modules/seeder/seeder.service.ts docs/
git commit -m "test(combos): e2e de grupos de componente por unidad + docs"
```

---

## Cierre — checklist obligatorio (CLAUDE.md)

- [ ] `cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e`
- [ ] `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
- [ ] Documentación actualizada (tabla de arriba)
- [ ] Sin `TODO`/código muerto; invariantes intactas (Decimal, soft-delete, tenant del token, N+1, motor de precios no tocado)
- [ ] Revisión de juicio independiente: skill `verify-feature` (sub-agente `domain-reviewer` sobre el diff)

## Notas de verificación manual (stack Docker)

- `docker-compose up`, entrar al POS, agregar el combo con componente-receta-con-grupo → el drawer pide la bebida **y** la proteína (una por unidad si cantidad ≥ 2), como selector (no radios).
- Vender y verificar en el kardex el movimiento de salida de la proteína elegida por unidad.
- En Salones, dos veces el mismo combo con proteínas distintas → dos líneas separadas (no mergean).
