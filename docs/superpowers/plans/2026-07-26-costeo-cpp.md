# Costeo por promedio ponderado móvil (CPP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el "último costo" de `item_producto.costo_actual` por un promedio ponderado móvil, y cerrar todo camino que escriba el costo sin dejar rastro en el kardex.

**Architecture:** `registrarMovimiento` (`inventario.service.ts`) queda como el **único** lugar que escribe `costo_actual`. Una entrada `motivo='compra'` recalcula el promedio; la nueva operación `ajuste_costo` (`tipo='ajuste'`, cantidad 0) lo pisa dejando `costo_anterior → costo_unitario` en el kardex. El campo `costo` de `PATCH /items/:id` pasa a rechazar con 400, y un test de invariante en CI impide que la puerta trasera vuelva.

**Tech Stack:** NestJS + TypeORM (SQL raw vía `manager.query`), PostgreSQL 15, Decimal.js, Jest + supertest (e2e), Nuxt 4 + Nuxt UI.

**Spec:** [`docs/superpowers/specs/2026-07-26-costeo-cpp-design.md`](../specs/2026-07-26-costeo-cpp-design.md)

## Global Constraints

- **`tenant_id` sale siempre del token**, nunca del body/query/ruta. `usuario_id` igual.
- **Dinero con Decimal.js**, nunca `number` nativo. Persistir con `.toFixed(4)` (`NUMERIC(18,4)`).
- **Soft delete:** toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`. Nunca `DELETE` físico.
- **Nunca una query por iteración (N+1):** el dato derivado por fila sale de un `JOIN` o de un batch.
- **Documentación en el mismo commit que el código** que la genera (tabla en `CLAUDE.md`).
- **Trabajar y commitear directo sobre `main`.** No crear ramas ni PRs.
- **Gate obligatorio antes de dar por terminada la última tarea** (Task 7).
- **No refactorizar fuera del alcance.** El N+1 preexistente de `insertarDetalleMovimiento` NO se toca.
- El costo es **de gestión**, no tributario: no se construye reporte de existencias valorizadas ni elección de método por tenant.

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `backend/src/modules/inventario/inventario.service.ts` | Fórmula CPP + branch `ajuste_costo` + `costo_anterior` en el kardex | 1, 2, 5 |
| `backend/src/modules/inventario/inventario.service.spec.ts` | Unit de la fórmula y del ajuste | 1, 2 |
| `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts` | Columna `costoAnterior` | 2 |
| `backend/src/modules/inventario/dto/ajuste-costo.dto.ts` | **Nuevo** — body del endpoint | 3 |
| `backend/src/modules/inventario/inventario.controller.ts` | `POST /inventario/ajustes-costo` | 3 |
| `backend/src/modules/items/dto/update-item.dto.ts` | `costo` pasa a rechazar siempre | 4 |
| `backend/src/modules/items/items.service.ts` | Se borra la rama que escribía `costo_actual` | 4 |
| `backend/src/common/invariants/costo-actual-choke-point.invariant.spec.ts` | **Nuevo** — invariante en CI | 4 |
| `backend/src/modules/seeder/seeder.service.ts` | Permiso `Inventario/Actualizar` | 3 |
| `startup-pos.sql` | Columna `costo_anterior`, motivo nuevo, semántica de `costo_actual` | 2 |
| `frontend/app/pages/configuracion/items.vue` | Sacar costo del form de edición; mudar disparo del simulador | 6 |
| `frontend/app/pages/inventario.vue` | Drawer de ajuste de costo + fila `anterior → nuevo` | 6 |

---

## Task 1: Fórmula CPP en la compra

**Files:**
- Modify: `backend/src/modules/inventario/inventario.service.ts:113-120, 173-178`
- Test: `backend/src/modules/inventario/inventario.service.spec.ts`
- Docs: `docs/features/inventario-kardex.md`

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces: `private calcularCostoPromedio(stockAnterior: Decimal, costoActualPrevio: string | null, cantidad: Decimal, costoCompra: string): string` — devuelve el costo ya redondeado a 4 decimales. Las tareas 2 y 5 asumen que el `UPDATE` de `costo_actual` está centralizado en una variable `costoActualNuevo: string | null`.

**Contexto para quien implementa:** hoy `registrarMovimiento` escribe `costo_actual` con el costo de compra crudo (`aplicaCostoNuevo` en la línea 115, `UPDATE` en la 173). Eso es el "último costo": una compra a precio atípico corrompe el margen de todo el stock que ya estaba. Lo reemplazamos por un promedio ponderado. **Ojo con la distinción:** el kardex sigue congelando en `costo_unitario` lo que se **pagó** en ese movimiento; el promedio va solo a `item_producto.costo_actual`.

- [ ] **Step 1: Escribir el test que falla**

En `backend/src/modules/inventario/inventario.service.spec.ts`, agregar el bloque:

```typescript
describe('costo promedio ponderado (CPP)', () => {
  it('promedia el costo previo con el de compra según las cantidades', () => {
    // 10 unidades a 100 + 10 unidades a 200 → 150
    const resultado = (service as any).calcularCostoPromedio(
      new Decimal('10'),
      '100',
      new Decimal('10'),
      '200',
    );
    expect(resultado).toBe('150.0000');
  });

  it('sin stock previo, el costo de compra manda', () => {
    const resultado = (service as any).calcularCostoPromedio(
      new Decimal('0'),
      '999',
      new Decimal('5'),
      '200',
    );
    expect(resultado).toBe('200.0000');
  });

  it('sin costo previo, el costo de compra manda', () => {
    const resultado = (service as any).calcularCostoPromedio(
      new Decimal('10'),
      null,
      new Decimal('5'),
      '200',
    );
    expect(resultado).toBe('200.0000');
  });

  it('pondera por cantidad, no promedia los precios', () => {
    // 1 a 100 + 9 a 200 → 190, no 150
    const resultado = (service as any).calcularCostoPromedio(
      new Decimal('1'),
      '100',
      new Decimal('9'),
      '200',
    );
    expect(resultado).toBe('190.0000');
  });

  it('redondea a 4 decimales', () => {
    // (3×10 + 1×20) / 4 = 12.5 ; con divisiones no exactas no debe explotar
    const resultado = (service as any).calcularCostoPromedio(
      new Decimal('3'),
      '10',
      new Decimal('1'),
      '20',
    );
    expect(resultado).toBe('12.5000');
  });
});
```

Si el archivo no importa `Decimal`, agregar arriba: `import Decimal from 'decimal.js';` (usar la misma forma de import que ya use el resto del archivo).

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx jest src/modules/inventario/inventario.service.spec.ts -t "CPP" --silent=false`
Expected: FAIL — `calcularCostoPromedio is not a function`.

- [ ] **Step 3: Implementar el helper**

En `inventario.service.ts`, agregar como método privado de `InventarioService` (junto a los otros helpers, después de `registrarMovimiento`):

```typescript
/**
 * Promedio ponderado móvil (CPP). Solo la compra lo recalcula: las salidas
 * nunca mueven el promedio, y la devolución tampoco (la unidad que vuelve ya
 * salió con un costo congelado; re-promediarla metería costo de venta dentro
 * del costo de compra).
 *
 * Sin stock previo o sin costo previo no hay masa que promediar: manda el
 * costo de compra. Eso además evita dividir por cero.
 */
private calcularCostoPromedio(
  stockAnterior: Decimal,
  costoActualPrevio: string | null,
  cantidad: Decimal,
  costoCompra: string,
): string {
  const compra = new Decimal(costoCompra);
  if (stockAnterior.lessThanOrEqualTo(0) || costoActualPrevio == null) {
    return compra.toFixed(4);
  }
  const valorPrevio = stockAnterior.mul(new Decimal(costoActualPrevio));
  const valorEntrante = cantidad.mul(compra);
  return valorPrevio
    .plus(valorEntrante)
    .div(stockAnterior.plus(cantidad))
    .toFixed(4);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd backend && npx jest src/modules/inventario/inventario.service.spec.ts -t "CPP" --silent=false`
Expected: PASS (5 tests).

- [ ] **Step 5: Cablear el helper en `registrarMovimiento`**

Reemplazar el bloque de las líneas 113-120:

```typescript
    // Solo la compra actualiza costo_actual; otras entradas pueden congelar un
    // costoUnitario en el movimiento sin pisar el vigente del producto.
    const aplicaCostoNuevo =
      params.costoUnitario != null &&
      params.tipo === 'entrada' &&
      params.motivo === 'compra';
    const costoUnitarioCongelado =
      params.costoUnitario != null ? params.costoUnitario : costoActualPrevio;
```

por:

```typescript
    // Costo a persistir en item_producto. null = no se toca.
    // Solo la compra lo recalcula (promedio ponderado móvil); las demás entradas
    // pueden congelar un costoUnitario en el movimiento sin pisar el vigente.
    let costoActualNuevo: string | null = null;
    if (
      params.costoUnitario != null &&
      params.tipo === 'entrada' &&
      params.motivo === 'compra'
    ) {
      costoActualNuevo = this.calcularCostoPromedio(
        stockAnterior,
        costoActualPrevio,
        cantidad,
        params.costoUnitario,
      );
    }

    // El kardex congela lo que se PAGÓ en este movimiento, no el promedio.
    const costoUnitarioCongelado =
      params.costoUnitario != null ? params.costoUnitario : costoActualPrevio;
```

Y reemplazar el bloque de las líneas 173-178:

```typescript
    if (aplicaCostoNuevo) {
      await manager.query(
        `UPDATE item_producto SET costo_actual = $1 WHERE item_id = $2`,
        [params.costoUnitario, params.itemId],
      );
    }
```

por:

```typescript
    if (costoActualNuevo != null) {
      await manager.query(
        `UPDATE item_producto SET costo_actual = $1 WHERE item_id = $2`,
        [costoActualNuevo, params.itemId],
      );
    }
```

Actualizar además el comentario de `RegistrarMovimientoParams` (líneas 36-38):

```typescript
  // Costo pagado en este movimiento. En una entrada por compra recalcula el
  // promedio ponderado de item_producto.costo_actual; en el resto solo se
  // congela en el kardex. Si no viene, se congela el costo_actual vigente.
  costoUnitario?: string | null;
```

- [ ] **Step 6: Correr los tests del módulo y el typecheck**

Run: `cd backend && npx jest src/modules/inventario && npm run typecheck`
Expected: PASS. Si algún test existente esperaba que `costo_actual` quedara igual al costo de compra con stock previo > 0, **actualizarlo** — ese era el bug que estamos arreglando; dejar un comentario en el test explicando el valor esperado.

- [ ] **Step 7: Actualizar la doc de la feature**

En `docs/features/inventario-kardex.md`, en la sección de modelo/reglas, dejar explícito que `item_producto.costo_actual` es un **promedio ponderado móvil** (ya no el último costo), que solo la entrada por compra lo recalcula, y la fórmula. Agregar la nota de que el kardex congela el costo pagado, no el promedio.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/inventario/ docs/features/inventario-kardex.md
git commit -m "feat(inventario): costo por promedio ponderado móvil en la compra"
```

---

## Task 2: `ajuste_costo` en el kardex

**Files:**
- Modify: `startup-pos.sql:726-744` (tabla `movimientos_inventario`), `startup-pos.sql:524`
- Modify: `backend/src/modules/inventario/entities/movimiento-inventario.entity.ts`
- Modify: `backend/src/modules/inventario/inventario.service.ts` (`RegistrarMovimientoParams`, validaciones, branch de modo, INSERT)
- Test: `backend/src/modules/inventario/inventario.service.spec.ts`

**Interfaces:**
- Consumes: `calcularCostoPromedio` y la variable `costoActualNuevo` de Task 1.
- Produces: `registrarMovimiento` acepta `{ tipo: 'ajuste', motivo: 'ajuste_costo', cantidad: '0', costoUnitario: <nuevo> }` y devuelve el mismo `{ movimientoId, stockAnterior, stockResultante }`. La columna `movimientos_inventario.costo_anterior` queda poblada solo en ese motivo.

**Contexto:** el ajuste de costo **no mueve cantidad, mueve valor**. Por eso `cantidad = 0`, `stock_resultante = stock_anterior`, y no se toca `item_producto.stock`. `tipo='ajuste'` ya estaba reservado en el enum del esquema sin implementar; esta tarea lo estrena.

- [ ] **Step 1: Agregar la columna al esquema**

En `startup-pos.sql`, dentro de `CREATE TABLE "movimientos_inventario"`, después de `"costo_unitario"`:

```sql
  "costo_anterior"   NUMERIC(18,4),   -- costo vigente ANTES del movimiento; solo en motivo 'ajuste_costo'
```

Actualizar el comentario de `motivo` en la misma tabla para incluir `'ajuste_costo'`:

```sql
  "motivo"           TEXT          NOT NULL,   -- 'compra' | 'venta' | 'devolucion' | 'merma' | 'ajuste_manual' | 'inventario_inicial' | 'ajuste_costo'
```

Y en `CREATE TABLE "item_producto"`, cambiar el comentario de la columna de costo:

```sql
  "costo_actual"      NUMERIC(18,4)  -- promedio ponderado móvil (CPP); solo lo recalcula la entrada por compra
);
```

- [ ] **Step 2: Escribir el test que falla**

En `inventario.service.spec.ts`:

```typescript
describe('ajuste de costo', () => {
  it('registra el movimiento sin mover stock y guarda el costo anterior', async () => {
    // El mock de manager.query debe devolver el producto con stock 10 y costo 100.
    // (Seguir el patrón de mocks ya usado en este archivo para registrarMovimiento.)
    const res = await service.registrarMovimiento(manager, {
      tenantId: TENANT_ID,
      itemId: ITEM_ID,
      usuarioId: USUARIO_ID,
      tipo: 'ajuste',
      motivo: 'ajuste_costo',
      cantidad: '0',
      costoUnitario: '250',
      comentario: 'Corrección de costo inicial mal tipeado',
    });

    expect(res.stockAnterior).toBe('10');
    expect(res.stockResultante).toBe('10');

    const insert = manager.query.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('INSERT INTO movimientos_inventario'),
    );
    expect(insert).toBeDefined();
    // costo_anterior = 100 (el vigente), costo_unitario = 250 (el nuevo)
    expect(insert![1]).toEqual(expect.arrayContaining(['100', '250']));

    // No debe haber UPDATE de stock
    const updateStock = manager.query.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('SET stock ='),
    );
    expect(updateStock).toBeUndefined();

    // Sí debe haber UPDATE de costo_actual con el valor nuevo
    const updateCosto = manager.query.mock.calls.find((c: unknown[]) =>
      String(c[0]).includes('SET costo_actual ='),
    );
    expect(updateCosto![1][0]).toBe('250.0000');
  });

  it('rechaza el ajuste de costo con cantidad distinta de cero', async () => {
    await expect(
      service.registrarMovimiento(manager, {
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        usuarioId: USUARIO_ID,
        tipo: 'ajuste',
        motivo: 'ajuste_costo',
        cantidad: '3',
        costoUnitario: '250',
      }),
    ).rejects.toThrow('El ajuste de costo no mueve cantidad');
  });

  it('rechaza el ajuste de costo sin costoUnitario', async () => {
    await expect(
      service.registrarMovimiento(manager, {
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        usuarioId: USUARIO_ID,
        tipo: 'ajuste',
        motivo: 'ajuste_costo',
        cantidad: '0',
      }),
    ).rejects.toThrow('El ajuste de costo requiere el costo nuevo');
  });

  it('sigue rechazando cantidad cero en los demás motivos', async () => {
    await expect(
      service.registrarMovimiento(manager, {
        tenantId: TENANT_ID,
        itemId: ITEM_ID,
        usuarioId: USUARIO_ID,
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '0',
      }),
    ).rejects.toThrow('La cantidad debe ser mayor a cero');
  });
});
```

Reusar los nombres de constantes y el patrón de mock del `manager` que ya existan en el archivo; si el archivo usa otro estilo de mock, adaptarlo sin cambiar las aserciones.

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd backend && npx jest src/modules/inventario/inventario.service.spec.ts -t "ajuste de costo" --silent=false`
Expected: FAIL — hoy `cantidad = 0` lanza "La cantidad debe ser mayor a cero".

- [ ] **Step 4: Agregar la columna a la entidad**

En `movimiento-inventario.entity.ts`, después de `costoUnitario`:

```typescript
  @Column({
    name: 'costo_anterior',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoAnterior: string | null;
```

Y actualizar el comentario de `motivo` en la línea 25 para incluir `| 'ajuste_costo'`.

> No hay entidad nueva, así que **no** hay que tocar el array `entities` de `app.module.ts`.

- [ ] **Step 5: Implementar el branch en `registrarMovimiento`**

En `inventario.service.ts`, reemplazar la validación de cantidad (líneas ~88-90):

```typescript
    if (cantidad.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }
```

por:

```typescript
    // El ajuste de costo no mueve cantidad, mueve valor: es el único motivo
    // que registra cantidad 0.
    const esAjusteCosto = params.motivo === 'ajuste_costo';
    if (esAjusteCosto) {
      if (params.tipo !== 'ajuste') {
        throw new BadRequestException("El ajuste de costo usa tipo 'ajuste'");
      }
      if (!cantidad.isZero()) {
        throw new BadRequestException('El ajuste de costo no mueve cantidad');
      }
      if (params.costoUnitario == null) {
        throw new BadRequestException('El ajuste de costo requiere el costo nuevo');
      }
    } else if (cantidad.lessThanOrEqualTo(0)) {
      throw new BadRequestException('La cantidad debe ser mayor a cero');
    }
```

Agregar la rama del ajuste al `if` de modos (línea ~124), **antes** de `if (modo === 'cantidad')`:

```typescript
    let result: MoverResult;

    if (esAjusteCosto) {
      // No hay movimiento de stock: ni branch por modo, ni UPDATE de stock,
      // ni filas en movimiento_inventario_detalle (insertarDetalleMovimiento
      // es no-op cuando result solo trae stockResultante).
      result = { stockResultante: stockAnterior };
    } else if (modo === 'cantidad') {
```

Extender el cálculo de `costoActualNuevo` de Task 1 con la rama del ajuste:

```typescript
    } else if (esAjusteCosto) {
      costoActualNuevo = new Decimal(params.costoUnitario!).toFixed(4);
    }
```

Y en el `INSERT INTO movimientos_inventario`, agregar la columna `costo_anterior` con su parámetro:

```typescript
    const insertRows: { movimiento_id: string }[] = await manager.query(
      `INSERT INTO movimientos_inventario
         (tenant_id, item_id, tipo, motivo, cantidad,
          stock_anterior, stock_resultante, venta_id, usuario_id, comentario,
          costo_unitario, costo_anterior, causa_merma_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING movimiento_id`,
      [
        params.tenantId,
        params.itemId,
        params.tipo,
        params.motivo,
        cantidad.toString(),
        stockAnterior.toString(),
        stockResultante.toString(),
        params.ventaId ?? null,
        params.usuarioId,
        params.comentario ?? null,
        costoUnitarioCongelado,
        esAjusteCosto ? costoActualPrevio : null,
        params.causaMermaId ?? null,
      ],
    );
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `cd backend && npx jest src/modules/inventario && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/inventario/ startup-pos.sql
git commit -m "feat(inventario): movimiento ajuste_costo con costo anterior en el kardex"
```

---

## Task 3: Endpoint `POST /inventario/ajustes-costo`

**Files:**
- Create: `backend/src/modules/inventario/dto/ajuste-costo.dto.ts`
- Modify: `backend/src/modules/inventario/inventario.controller.ts`
- Modify: `backend/src/modules/inventario/inventario.service.ts` (método público nuevo)
- Modify: `backend/src/modules/seeder/seeder.service.ts:714-729`
- Test: `backend/test/costeo-cpp.e2e-spec.ts` (nuevo)
- Docs: `docs/features/inventario-kardex.md`

**Interfaces:**
- Consumes: `registrarMovimiento` con `motivo: 'ajuste_costo'` (Task 2).
- Produces: `InventarioService.registrarAjusteCosto(tenantId: string, usuarioId: string, dto: AjusteCostoDto): Promise<{ movimientoId: string; costoAnterior: string | null; costoNuevo: string }>`.

**Contexto:** el módulo Inventario hoy solo tiene sembrados los permisos `Leer`, `Crear` y `Ver todas` (`seeder.service.ts:714-729`). **Falta `Actualizar`**, que es el que va a exigir este endpoint — hay que sembrarlo. El siguiente ID libre de la serie es `550e8400-e29b-41d4-a716-446655440291` (verificar con `grep -o "446655440[0-9]\{3\}" backend/src/modules/seeder/seeder.service.ts | sort -u | tail -1` antes de usarlo).

- [ ] **Step 1: Sembrar el permiso `Inventario/Actualizar`**

En `seeder.service.ts`, en el array de `modulo_app_permiso`, dentro del bloque `// Inventario`, agregar:

```typescript
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440291',
        moduloAppId: INVENTARIO,
        permisoId: ACTUALIZAR,
      },
```

Verificar que la constante `ACTUALIZAR` ya exista en el archivo (la usan Items y otros módulos); si el nombre difiere, usar el que esté.

- [ ] **Step 2: Escribir el test e2e que falla**

Crear `backend/test/costeo-cpp.e2e-spec.ts`, siguiendo la estructura de `backend/test/mermas.e2e-spec.ts` (mismo bootstrap de app, mismo login para obtener el token):

```typescript
describe('Costeo CPP (e2e)', () => {
  // ... bootstrap igual que mermas.e2e-spec.ts ...

  it('la segunda compra promedia el costo en vez de pisarlo', async () => {
    // Crear producto con stock 0 y sin costo
    const { body: item } = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'CPP Test', tipo: 'producto', precio: '1000', stock: 0 })
      .expect(201);

    // Compra 1: 10 unidades a 100 → costo 100
    await request(app.getHttpServer())
      .patch(`/api/items/${item.id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidad: 10, tipo: 'entrada', motivo: 'compra', costoUnitario: '100' })
      .expect(200);

    // Compra 2: 10 unidades a 200 → promedio 150 (con el bug daría 200)
    await request(app.getHttpServer())
      .patch(`/api/items/${item.id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidad: 10, tipo: 'entrada', motivo: 'compra', costoUnitario: '200' })
      .expect(200);

    const { body: detalle } = await request(app.getHttpServer())
      .get(`/api/items/${item.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(new Decimal(detalle.costoActual).toFixed(4)).toBe('150.0000');
  });

  it('el ajuste de costo pisa el promedio y queda en el kardex', async () => {
    // Reusar el item de arriba o crear uno nuevo con costo conocido.
    const { body } = await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId, costoNuevo: '250', comentario: 'Corrección de costo' })
      .expect(201);

    expect(new Decimal(body.costoNuevo).toFixed(4)).toBe('250.0000');
    expect(new Decimal(body.costoAnterior!).toFixed(4)).toBe('150.0000');

    const { body: kardex } = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const mov = kardex.data.find((m: { motivo: string }) => m.motivo === 'ajuste_costo');
    expect(mov).toBeDefined();
    expect(mov.cantidad).toBe('0.0000');
  });

  it('rechaza el ajuste de costo si el costo nuevo es igual al vigente', async () => {
    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId, costoNuevo: '250', comentario: 'Sin cambio' })
      .expect(400);
  });

  it('rechaza el ajuste de costo sin comentario', async () => {
    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId, costoNuevo: '300' })
      .expect(400);
  });
});
```

> **Sobre el stock del seed:** este spec crea sus propios items en vez de usar los del seeder, para no depender del stock acumulado (ver memoria del proyecto sobre corridas locales repetidas).

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd backend && npx jest --config test/jest-e2e.json costeo-cpp`
Expected: FAIL — 404 en `/api/inventario/ajustes-costo`.

- [ ] **Step 4: Crear el DTO**

`backend/src/modules/inventario/dto/ajuste-costo.dto.ts`:

```typescript
import { IsUUID, IsNumberString, IsString, IsNotEmpty } from 'class-validator';

export class AjusteCostoDto {
  @IsUUID()
  itemId: string;

  // Costo nuevo del producto. Pisa el promedio ponderado vigente.
  @IsNumberString()
  costoNuevo: string;

  // Obligatorio: un ajuste de costo es una corrección y tiene que quedar
  // explicada. No lleva causa tipificada (a diferencia de las mermas): es un
  // evento puntual, no un fenómeno recurrente que se reporte por categoría.
  @IsString()
  @IsNotEmpty()
  comentario: string;
}
```

- [ ] **Step 5: Implementar el método del service**

En `inventario.service.ts`, método público nuevo:

```typescript
async registrarAjusteCosto(
  tenantId: string,
  usuarioId: string,
  dto: AjusteCostoDto,
): Promise<{
  movimientoId: string;
  costoAnterior: string | null;
  costoNuevo: string;
}> {
  const costoNuevo = new Decimal(dto.costoNuevo);
  if (costoNuevo.isNaN() || costoNuevo.lessThanOrEqualTo(0)) {
    throw new BadRequestException('El costo nuevo debe ser mayor a 0');
  }

  return this.dataSource.transaction(async (manager) => {
    const rows: { tipo: string; costo_actual: string | null }[] =
      await manager.query(
        `SELECT i.tipo, p.costo_actual
           FROM items i
           JOIN item_producto p ON p.item_id = i.item_id
          WHERE i.item_id = $1 AND i.tenant_id = $2 AND i.eliminado_el IS NULL`,
        [dto.itemId, tenantId],
      );
    if (!rows.length) {
      throw new NotFoundException('Item no encontrado');
    }
    if (rows[0].tipo !== 'producto' && rows[0].tipo !== 'ingrediente') {
      throw new BadRequestException(
        'Solo un producto o un ingrediente tiene costo propio',
      );
    }

    const costoAnterior = rows[0].costo_actual;
    if (costoAnterior != null && costoNuevo.equals(new Decimal(costoAnterior))) {
      throw new BadRequestException(
        'El costo nuevo es igual al vigente: no hay nada que ajustar',
      );
    }

    const mov = await this.registrarMovimiento(manager, {
      tenantId,
      itemId: dto.itemId,
      usuarioId,
      tipo: 'ajuste',
      motivo: 'ajuste_costo',
      cantidad: '0',
      costoUnitario: costoNuevo.toFixed(4),
      comentario: dto.comentario,
    });

    return {
      movimientoId: mov.movimientoId,
      costoAnterior,
      costoNuevo: costoNuevo.toFixed(4),
    };
  });
}
```

Agregar los imports que falten (`NotFoundException`, `AjusteCostoDto`).

- [ ] **Step 6: Exponer el endpoint**

En `inventario.controller.ts`, agregar `Post` y `Body` a los imports de `@nestjs/common`, importar `AjusteCostoDto`, y agregar:

```typescript
  @Post('ajustes-costo')
  @RequiresPermiso('Inventario', 'Actualizar')
  registrarAjusteCosto(@Req() req: Request, @Body() dto: AjusteCostoDto) {
    const { tenantId, id: usuarioId } = req.user as {
      tenantId: string;
      id: string;
    };
    return this.inventarioService.registrarAjusteCosto(tenantId, usuarioId, dto);
  }
```

- [ ] **Step 7: Correr el e2e y verificar que pasa**

Run: `cd backend && npx jest --config test/jest-e2e.json costeo-cpp`
Expected: PASS. Requiere la BD levantada (`docker-compose up`) y el seeder corrido con el permiso nuevo — si el permiso no aparece, resetear con `docker-compose down -v && docker-compose up`.

- [ ] **Step 8: Documentar el endpoint**

En `docs/features/inventario-kardex.md`, agregar la sección del endpoint `POST /inventario/ajustes-costo` (body, respuesta, permiso, validaciones) con el mismo formato que las secciones de endpoint ya existentes.

- [ ] **Step 9: Commit**

```bash
git add backend/src/modules/inventario/ backend/src/modules/seeder/seeder.service.ts backend/test/costeo-cpp.e2e-spec.ts docs/features/inventario-kardex.md
git commit -m "feat(inventario): endpoint de ajuste de costo con permiso propio"
```

---

## Task 4: Cerrar la puerta trasera + invariante en CI

**Files:**
- Modify: `backend/src/modules/items/dto/update-item.dto.ts:80`
- Modify: `backend/src/modules/items/items.service.ts:1183-1190`
- Create: `backend/src/common/invariants/costo-actual-choke-point.invariant.spec.ts`
- Test: `backend/test/costeo-cpp.e2e-spec.ts` (agregar caso)

**Interfaces:**
- Consumes: el endpoint de Task 3 (es el reemplazo que el mensaje de error señala).
- Produces: nada que consuman tareas posteriores.

**Contexto crítico:** el `ValidationPipe` global usa `whitelist: true` **sin** `forbidNonWhitelisted` (`backend/src/main.ts:19`). Si simplemente se borra `costo` del DTO, la propiedad se **descarta en silencio** y el request devuelve 200 sin haber cambiado nada — un fallo callado, peor que el bug original. Por eso el campo **se queda** en el DTO con un validador que siempre falla. **No** activar `forbidNonWhitelisted` globalmente: afectaría todos los endpoints y está fuera de alcance.

- [ ] **Step 1: Escribir el test e2e que falla**

Agregar a `backend/test/costeo-cpp.e2e-spec.ts`:

```typescript
  it('PATCH /items/:id rechaza el costo con mensaje explícito', async () => {
    const { body } = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costo: '999' })
      .expect(400);

    expect(JSON.stringify(body.message)).toContain('Ajuste de costo');
  });

  it('PATCH /items/:id sigue permitiendo editar otros campos', async () => {
    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'CPP Test renombrado' })
      .expect(200);
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx jest --config test/jest-e2e.json costeo-cpp -t "rechaza el costo"`
Expected: FAIL — hoy devuelve 200 y escribe el costo.

- [ ] **Step 3: Convertir `costo` en un campo que siempre rechaza**

En `update-item.dto.ts`, reemplazar la declaración de `costo` (línea ~80, con los decoradores que tenga hoy) por:

```typescript
  // El costo ya no se edita desde el item: es una consecuencia de mover
  // mercadería (compra) o de una corrección auditada (ajuste de costo).
  // El campo se conserva —en vez de borrarse— porque el ValidationPipe global
  // usa whitelist sin forbidNonWhitelisted: borrarlo haría que la propiedad se
  // descarte en silencio y el request devuelva 200 sin cambiar nada.
  @Validate(CostoNoEditableConstraint)
  @IsOptional()
  costo?: string;
```

Y en el mismo archivo (o en `backend/src/common/validators/` si el proyecto ya tiene esa carpeta — verificar antes de crear una nueva):

```typescript
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
} from 'class-validator';

@ValidatorConstraint({ name: 'costoNoEditable', async: false })
export class CostoNoEditableConstraint implements ValidatorConstraintInterface {
  validate(): boolean {
    return false;
  }

  defaultMessage(): string {
    return 'El costo no se edita desde el item: usá Inventario → Ajuste de costo';
  }
}
```

- [ ] **Step 4: Borrar la rama que escribía el costo**

En `items.service.ts`, eliminar completo el bloque de las líneas 1183-1190:

```typescript
        if (dto.costo !== undefined) {
          if (dto.costo != null) {
            this.validarCostoPositivo(dto.costo);
          }
          prodClauses.push(`costo_actual = $${pidx++}`);
          prodParams.push(dto.costo);
          patch.costoActual = dto.costo;
        }
```

Verificar si `validarCostoPositivo` queda sin uso: si **sigue** usándose en la creación (`create`), dejarla; si queda huérfana, borrarla (sin código muerto).

- [ ] **Step 5: Correr los e2e y verificar que pasan**

Run: `cd backend && npx jest --config test/jest-e2e.json costeo-cpp`
Expected: PASS.

- [ ] **Step 6: Escribir el test de invariante**

Crear `backend/src/common/invariants/costo-actual-choke-point.invariant.spec.ts`:

```typescript
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// Invariante: item_producto.costo_actual NUNCA se escribe fuera de
// inventario.service.ts (registrarMovimiento). El costo es un valor derivado
// del kardex — un promedio ponderado móvil — y escribirlo directo lo corrompe
// sin dejar rastro. Fue exactamente el bug que originó este diseño:
// PATCH /items/:id escribía el costo sin movimiento de inventario.
// Ver docs/superpowers/specs/2026-07-26-costeo-cpp-design.md

const ARCHIVOS_AUTORIZADOS = [
  join('modules', 'inventario', 'inventario.service.ts'),
  // El INSERT de creación del producto y el seeder no son UPDATE: el INSERT
  // siembra el costo de apertura junto con el movimiento inventario_inicial.
  join('modules', 'seeder', 'seeder.service.ts'),
];

function findTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTsFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('Invariante: costo_actual solo se escribe desde el kardex', () => {
  it('ningún UPDATE de item_producto toca costo_actual fuera de inventario.service', () => {
    const srcRoot = join(__dirname, '..', '..');
    const offenders: string[] = [];

    for (const file of findTsFiles(srcRoot)) {
      if (ARCHIVOS_AUTORIZADOS.some((a) => file.endsWith(a))) continue;
      const contenido = readFileSync(file, 'utf8');
      // Busca cualquier UPDATE de item_producto que mencione costo_actual,
      // incluidos los que arman el SET dinámicamente.
      const sospechoso =
        /costo_actual\s*=\s*\$/.test(contenido) ||
        /`costo_actual = \$\{/.test(contenido);
      if (sospechoso) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 7: Correr el test de invariante**

Run: `cd backend && npx jest src/common/invariants/costo-actual-choke-point.invariant.spec.ts --silent=false`
Expected: PASS. Si falla señalando `items.service.ts`, el Step 4 quedó incompleto.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/items/ backend/src/common/invariants/ backend/test/costeo-cpp.e2e-spec.ts
git commit -m "feat(items): el costo deja de editarse desde el item + invariante en CI"
```

---

## Task 5: El kardex expone `costo_anterior`

**Files:**
- Modify: `backend/src/modules/inventario/inventario.service.ts:573-593` (`findMovimientos`) y su `mapMovimientoRow` + tipo `MovimientoRow` / `MovimientoListItem`
- Test: `backend/test/costeo-cpp.e2e-spec.ts` (extender el caso del kardex)

**Interfaces:**
- Consumes: la columna `costo_anterior` (Task 2), el movimiento creado por el endpoint (Task 3).
- Produces: cada item de `GET /inventario/movimientos` incluye `costoAnterior: string | null`. Task 6 lo consume en el frontend.

**Contexto:** `costo_anterior` se agrega al `SELECT` que ya existe — **no** se resuelve con una query por fila (invariante de N+1).

- [ ] **Step 1: Extender la aserción del e2e**

En el caso "el ajuste de costo pisa el promedio y queda en el kardex" de `costeo-cpp.e2e-spec.ts`, agregar:

```typescript
    expect(new Decimal(mov.costoAnterior).toFixed(4)).toBe('150.0000');
    expect(new Decimal(mov.costoUnitario).toFixed(4)).toBe('250.0000');
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && npx jest --config test/jest-e2e.json costeo-cpp -t "queda en el kardex"`
Expected: FAIL — `mov.costoAnterior` es `undefined`.

- [ ] **Step 3: Agregar la columna al SELECT y al mapper**

En `findMovimientos` (línea ~579), agregar `mv.costo_anterior` junto a `mv.costo_unitario`:

```sql
         mv.comentario, mv.creado_el, mv.costo_unitario, mv.costo_anterior,
```

Agregar `costo_anterior: string | null;` al tipo `MovimientoRow`, `costoAnterior: string | null;` al tipo `MovimientoListItem`, y mapearlo en `mapMovimientoRow`:

```typescript
      costoAnterior: r.costo_anterior,
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `cd backend && npx jest --config test/jest-e2e.json costeo-cpp && cd backend && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/inventario/ backend/test/costeo-cpp.e2e-spec.ts
git commit -m "feat(inventario): el kardex expone el costo anterior del ajuste"
```

---

## Task 6: Frontend — sacar el costo del item, drawer de ajuste, kardex

**Files:**
- Modify: `frontend/app/pages/configuracion/items.vue` (form de edición, `costoProductoCambio()` línea ~818)
- Modify: `frontend/app/pages/inventario.vue` (drawer nuevo + fila del kardex)

**Interfaces:**
- Consumes: `POST /api/inventario/ajustes-costo` (Task 3), `costoAnterior` en `GET /api/inventario/movimientos` (Task 5).
- Produces: nada.

**Contexto:** hoy `costoProductoCambio()` (`items.vue:818`) detecta que cambió el costo en el form y dispara el modal del simulador de impacto de costos en recetas. Ese disparo **se muda, no se pierde**: pasa a dispararse después de una compra y después de un ajuste de costo. La bandeja `/recetas-desfases` no cambia.

**Antes de escribir Vue:** invocar la skill `nuxt-ui`. Usar tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado (los colores financieros son excepción **solo** del módulo Caja, no aplican acá). El drawer sigue el patrón inline de `frontend/app/pages/mermas.vue:341-454` (`AppDrawer`).

- [ ] **Step 1: Sacar el campo costo del form de edición**

En `configuracion/items.vue`, el input de costo debe renderizarse **solo en modo creación**. Localizar el bloque del input de costo en el template y condicionarlo al modo del form (el archivo ya distingue creación de edición para otros campos — seguir esa misma variable, no inventar una nueva). En su lugar, en modo edición mostrar el costo vigente como **texto de solo lectura** con un enlace/botón a `/inventario` que diga "Ajustar costo".

- [ ] **Step 2: Mudar el disparo del simulador**

Quitar la llamada a `costoProductoCambio()` del flujo de guardado del form de edición (el costo ya no cambia ahí). Conservar la función y el modal: se invocan ahora desde `inventario.vue` tras una compra exitosa y tras un ajuste de costo exitoso. Si la lógica del modal vive en `items.vue` y no es reutilizable desde `inventario.vue`, extraerla a un composable en `frontend/app/composables/` (las utilidades de presentación van ahí, nunca locales a un `.vue`).

- [ ] **Step 3: Agregar el drawer de ajuste de costo en `inventario.vue`**

Drawer con: selector de producto, costo vigente (solo lectura), input de costo nuevo (`MoneyInput`), y textarea de comentario **obligatorio**. Al confirmar:

```typescript
await useApiFetch(`${apiUrl}/inventario/ajustes-costo`, {
  method: 'POST',
  body: { itemId: form.itemId, costoNuevo: form.costoNuevo, comentario: form.comentario },
})
```

Manejar el 400 de "costo igual al vigente" y el de comentario vacío mostrando el mensaje del backend (seguir el patrón de manejo de error que ya use `mermas.vue`).

- [ ] **Step 4: Mostrar `anterior → nuevo` en la fila del kardex**

En la tabla de movimientos de `inventario.vue`, cuando `motivo === 'ajuste_costo'`, la columna de cantidad muestra `—` y se muestra `costoAnterior → costoUnitario` formateado como dinero. Los demás motivos no cambian.

- [ ] **Step 5: Build y typecheck**

Run: `cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check`
Expected: PASS los tres.

- [ ] **Step 6: Smoke test en navegador**

Con `docker-compose up` corriendo: abrir `/inventario`, hacer un ajuste de costo, verificar que aparece en el kardex con `anterior → nuevo`, que el modal del simulador se dispara si el producto es ingrediente de una receta, y que en `/configuracion/items` el costo ya no es editable. **Los drawers no tienen test unit: build y typecheck no ven bugs de runtime.**

- [ ] **Step 7: Commit**

```bash
git add frontend/app/
git commit -m "feat(inventario): drawer de ajuste de costo y costo de solo lectura en items"
```

---

## Task 7: Documentación de cierre y gate completo

**Files:**
- Create: `docs/adr/016-costeo-promedio-ponderado-movil.md`
- Modify: `docs/adr/README.md`, `docs/ESTADO.md`, `docs/PRODUCTO.md`, `docs/agent/anti-patterns.md`

- [ ] **Step 1: Escribir el ADR-016**

`docs/adr/016-costeo-promedio-ponderado-movil.md`, con el formato de los ADR existentes. Debe responder:

1. **Por qué CPP y no FIFO** — FIFO exige capas de costo con consumo registrado, y en modo `cantidad` no hay capas naturales; además rompe el supuesto de "un costo por producto" del que dependen `item_receta.costo_actual`, `item_combo.costo_actual` y el simulador.
2. **Por qué método fijo y no elegible por tenant** — sin datos productivos, agregar la elección después no cuesta migración.
3. **Por qué el costo es de gestión y no tributario** — el **art. 41 N°3 de la LIR** obliga a corregir las existencias a **costo de reposición** al cierre del balance, así que un reporte de existencias valorizadas no sería el número tributario final: sería un insumo del contador. La compatibilidad se logra usando un método que el SII admite (CPP, art. 30 LIR). Misma forma que el **ADR-010**.
4. **Consecuencia** — `costo_actual` solo se escribe desde `registrarMovimiento`; hay un test de invariante que lo enforca.

Enlazar la investigación (`docs/agent/investigaciones/2026-07-26-inventario.md`) y la spec.

- [ ] **Step 2: Actualizar índice y estado**

- `docs/adr/README.md`: fila del ADR-016.
- `docs/ESTADO.md`: fila de la funcionalidad con fecha 2026-07-26.
- `docs/PRODUCTO.md`: regla de negocio de cómo se determina el costo de un producto (promedio ponderado; solo la compra lo recalcula; la corrección es auditada).

- [ ] **Step 3: Registrar el anti-patrón**

En `docs/agent/anti-patterns.md`, agregar el caso con ❌/✅: **"campo que escribe estado derivado sin pasar por su choke point"**. El ❌ es `PATCH /items/:id` escribiendo `costo_actual` sin movimiento de inventario. Incluir la trampa del `ValidationPipe`: borrar el campo del DTO con `whitelist: true` y sin `forbidNonWhitelisted` produce un **200 silencioso**, no un 400 — hay que rechazar explícitamente.

- [ ] **Step 4: Correr el gate completo**

```bash
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```

Los siete comandos en verde. **`test:e2e` completo, no un subset** — un cambio de DTO en un endpoint compartido puede romper specs que un subset local no ve. Si el e2e falla por stock agotado en corridas locales repetidas, resetear con `docker-compose down -v && docker-compose up` (no es regresión).

- [ ] **Step 5: Revisión independiente**

Invocar la skill `verify-feature`, que cierra con el sub-agente `domain-reviewer` de contexto fresco sobre el diff (N+1, dinero-Decimal, soft delete, alcance).

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs(inventario): ADR-016 costeo CPP + estado, producto y anti-patrones"
```

---

## Self-review

**Cobertura de la spec:**

| Sección de la spec | Tarea |
|---|---|
| §4.1 fórmula CPP + bordes | 1 |
| §4.2 qué mueve el promedio | 1, 2 |
| §4.3 cambios en `registrarMovimiento` | 2 |
| §4.4 endpoint nuevo | 3 |
| §4.5 cierre de la puerta trasera | 4 |
| §3 columna `costo_anterior` + motivo + permiso | 2, 3 |
| §5 frontend (form, simulador, drawer, kardex) | 6 |
| §6 casos borde | 1 (stock 0, costo null), 2 (cantidad ≠ 0), 3 (costo igual, item no producto) |
| §7 testing (unit, invariante, e2e, smoke) | 1, 2, 3, 4, 6 |
| §9 documentación | 1, 3, 7 |

**Nota de ejecución:** los casos borde "producto en modo `lote`/`serie`" (§6) no llevan test propio porque la fórmula es por item y no toca el branch de modo — el ajuste de costo lo saltea explícitamente (Task 2, Step 5). Si al implementar aparece que sí lo toca, agregar el caso.
