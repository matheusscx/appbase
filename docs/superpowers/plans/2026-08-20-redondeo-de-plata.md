# Plan: Redondeo de plata — la moneda manda al cerrar el documento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Status:** Draft
**Date:** 2026-08-20
**Owner:** Cesar Matheus
**Spec:** [`2026-08-20-redondeo-de-plata-design.md`](../specs/2026-08-20-redondeo-de-plata-design.md)
· [decisiones](../specs/2026-08-20-redondeo-de-plata-decisiones.md)
· [segunda ronda](../specs/2026-08-20-redondeo-de-plata-segunda-ronda.md)

**Goal:** que ningún monto cobrado se persista con más decimales de los que su moneda
tiene, y que el `modo_redondeo` del tenant gobierne ese último paso en vez del cast de
Postgres.

**Architecture:** la cuantización a la escala de la moneda vive **en el motor de precios**,
como paso de cierre de línea y de venta. `decimalesMoneda` y `nivelRedondeo` entran a
`ConfigCalculo`, con lo que quedan congelados en `ventas.config_calculo` sin tocar el punto
de congelado. Lo que no pasa por el motor queda entero por construcción (son restas de
enteros); la única excepción es la línea de nota de crédito, que se cuantiza explícita con
el criterio congelado de la venta original. Los bordes de API rechazan con 400 la plata que
llega con decimales de más.

**Tech Stack:** NestJS + TypeORM + Postgres 15, Decimal.js (nunca `number`), Jest +
supertest, Nuxt 4 / Vue 3 con Nuxt UI.

## Global Constraints

- **Dinero y porcentajes con Decimal.js**, nunca `number` nativo. Porcentajes en decimal
  (`0.19` = 19%).
- **`tenant_id` sale siempre del token**, nunca del body, query o ruta.
- **Soft delete en todo**: nunca `DELETE`; toda lectura filtra `eliminado_el IS NULL`.
- **Nunca una query por iteración (N+1)**: el dato derivado por fila se resuelve con
  `JOIN`/agregación o batch con `WHERE id = ANY($1)`.
- **No se toca el sistema de tokens JWT.**
- **"Exento" es un estado fiscal explícito**, nunca la ausencia de impuesto.
- **El proyecto no tiene datos productivos**: se cambia el esquema, se actualiza el seeder
  y se resetea. No se diseñan migraciones incrementales ni backfills.
- **Se trabaja directo sobre `main`**, sin ramas ni PRs. El
  [checklist de cierre](../../../CLAUDE.md) es obligatorio antes de cada commit.
- ⚠️ **No tocar un `.ts` del backend con el e2e corriendo:** el compose recompila y
  **vuelve a sembrar**, y eso produce decenas de fallos repartidos que no son regresiones.
- ⚠️ **El gate se corre entero** (`npm run test:e2e` completo, no un subset): un cambio de
  validación en DTOs compartidos rompe specs lejanas.

---

## File Structure

| Archivo | Responsabilidad en este plan |
|---|---|
| `startup-pos.sql` | `tenants.nivel_redondeo`; CHECK en `moneda.decimales` |
| `backend/src/modules/tenants/entities/tenant.entity.ts` | columna + default |
| `backend/src/modules/tenants/dto/update-preferencias-financieras.dto.ts` | `nivelRedondeo`, escala de `montoTolerancia` |
| `backend/src/modules/tenants/tenants.service.ts` | SELECT/UPDATE de preferencias, defaults del alta, **matriz de validación** |
| `backend/src/modules/calculo-precios/calculo-precios.engine.ts` | `ConfigCalculo` +2 campos, `cuantizar()`, cierre de línea y de venta, rama del desbruteo |
| `backend/src/modules/calculo-precios/calculo-precios.service.ts` | `cargarConfig` mapea los campos nuevos |
| `backend/src/modules/ventas/ventas.service.ts` | `JOIN moneda`, NC: herencia + congelado |
| `backend/src/common/decorators/escala-moneda.decorator.ts` | **nuevo** — metadata `@EsMontoCobrado` / `@EsCosto` |
| `backend/src/common/pipes/escala-moneda.pipe.ts` | **nuevo** — resuelve la escala del tenant y valida |
| `backend/src/modules/seeder/seeder.service.ts` | default de `nivel_redondeo` |
| `frontend/app/components/MoneyInput.vue` | máscara por `moneda.decimales` |
| `frontend/app/composables/useMonedaConversion.ts` | espejo alineado con el backend |
| `frontend/app/pages/configuracion/preferencias-financieras.vue` | control de `nivelRedondeo` |

---

## Fase 0 — Cimientos que no cambian conducta

### Task 1: Nombrar la escala de costo y escribir los veredictos en el código

**Files:**
- Create: `backend/src/common/constants/escalas.ts`
- Modify: `backend/src/modules/inventario/inventario.service.ts:410`, `:914`, `:227`,
  `:353`, `:403`; `backend/src/modules/items/items.service.ts:3879`, `:4017`, `:3697`,
  `:3508`, `:3580`; `backend/src/modules/mermas/mermas.service.ts:200`, `:343`;
  `backend/src/common/utils/costo-conversion-unidad.util.ts:28`;
  `backend/src/modules/propinas/utils/mayores-restos.ts:44`
- Test: ninguno nuevo (esta tarea **no cambia conducta**)

**Interfaces:**
- Produces: `ESCALA_COSTO = 4` — la usan las tareas 11 y 13.

⚠️ **Esta tarea no tiene ciclo TDD porque no cambia ningún resultado**: reemplaza literales
por una constante y agrega comentarios. Su verificación es que la suite existente siga en
verde, sin un solo número distinto.

- [ ] **Step 1: Crear la constante**

```typescript
// backend/src/common/constants/escalas.ts
/**
 * Escala de los COSTOS y de las TASAS (dinero por unidad de otra cosa): 4
 * decimales. No es la escala de la moneda: hay ítems costeados por gramo
 * (mínimo medido en dev: 5.0000/g), y cuantizar eso a peso entero mete hasta
 * 10% de error por gramo, ×1000 al costear un kilo.
 *
 * Decisión (a) del 2026-08-20. La escala de los montos COBRADOS es la de la
 * moneda y la aplica el motor al cerrar el documento — ver ConfigCalculo.
 */
export const ESCALA_COSTO = 4;
```

- [ ] **Step 2: Reemplazar los literales en los sitios de costo**

En cada sitio, `toFixed(4)` → `toFixed(ESCALA_COSTO)` y
`toDecimalPlaces(4, Decimal.ROUND_HALF_UP)` →
`toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP)`.

⚠️ **Solo los sitios listados en "Files"**, que son los de costo/tasa. **No** tocar los
`toFixed(4)` de conversión de cantidades (`cantidad-presentacion.util.ts`,
`catalog.service.ts:177`), de horas (`horas-interseccion.ts:16`) ni de porcentaje
(`items.service.ts:3680`): no son plata y meterlos sería el error contrario.

- [ ] **Step 3: Escribir el veredicto de cada sitio**

Los textos exactos están en la §1 de
[`…-lectura-independiente.md`](../specs/2026-08-20-redondeo-de-plata-lectura-independiente.md)
— **copiarlos de ahí**, no reescribirlos. Ejemplo del sitio 1
(`inventario.service.ts:410`):

```typescript
// HALF_UP fijo a escala de costo (4): el CPP es una tasa interna —dinero por
// unidad base de stock—, no un monto cobrable, y por eso no mira modo_redondeo:
// esa perilla es la política de lo que se le cobra al cliente. Un tenant en
// FLOOR/CEIL sesgaría acá la valorización en cada compra, compuesto en cada
// promedio. La escala de la moneda tampoco aplica: hay costos por gramo (< $1).
```

⚠️ **Los gemelos `items.service.ts:3508` y `:3580` llevan el comentario cruzado** (el de
los sitios 3/4 de la lectura), y **`:3580` además pasa a usar el modo explícito**
`toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP)`: hoy usa el default y diverge en
forma de su par.

- [ ] **Step 4: Verificar que nada cambió de valor**

Run: `cd backend && npm run lint:check && npm run typecheck && npm test`
Expected: PASS, **sin un solo valor esperado modificado**. Si algún test cambia de número,
la tarea tocó algo que no debía.

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/constants/escalas.ts backend/src/modules backend/src/common/utils
git commit -m "refactor(redondeo): la escala de costo tiene nombre y cada sitio dice por qué redondea así"
```

---

## Fase 1 — El dato de la moneda llega al motor

### Task 2: CHECK en `moneda.decimales`

> ⚠️ **Corregido el 2026-08-20, antes de ejecutar.** La primera versión de esta tarea
> pedía el CHECK en `startup-pos.sql`. **Eso no habría hecho nada:** el esquema real lo
> construye TypeORM con `synchronize` desde las entities (`app.module.ts:271`), y
> `startup-pos.sql` es documentación de referencia que **no ejecuta nadie** — ni el compose
> ni `reset-db.sh` (así lo dice el docblock de `backend/test/esquema.e2e-spec.ts`). Los
> CHECK del repo se declaran con `@Check` en la entity: hay 5, y
> `chk_movimientos_caja_monto_no_negativo` está en la base por esa vía
> (`movimiento-caja.entity.ts:19`). El mismo criterio vale para la Task 3.

**Files:**
- Modify: `backend/src/modules/monedas/entities/moneda.entity.ts` (decorador `@Check`),
  `startup-pos.sql` (tabla `moneda`, **como documentación de referencia**, para que no
  quede describiendo un esquema que no es)
- Test: `backend/test/esquema.e2e-spec.ts` — el spec que ya mide invariantes del esquema
  contra Postgres. **No crear un archivo nuevo**: el repo prohíbe crear uno si la
  implementación cabe en uno existente.

**Interfaces:**
- Produces: la garantía `0 ≤ moneda.decimales ≤ 4`, de la que depende toda la Fase 2 — si
  una moneda tuviera 6 decimales, el cast a `NUMERIC(18,4)` devolvería la decisión a
  Postgres en silencio.

- [ ] **Step 1: Escribir el test que falla**

En `backend/test/esquema.e2e-spec.ts`, junto a las invariantes que ya viven ahí:

```typescript
it('ninguna moneda puede tener más decimales de los que la columna de dinero guarda', async () => {
  // Toda columna de dinero es NUMERIC(18,4). Una moneda con más decimales
  // devolvería el recorte final al cast de Postgres —su regla, fuera de
  // modo_redondeo—, que es justo lo que el frente de redondeo vino a cerrar.
  await expect(
    ds.query(
      `INSERT INTO moneda (nombre, codigo_iso, codigo_numero, simbolo, decimales)
       VALUES ('Moneda de prueba', 'XTS', '963', 'X', 6)`,
    ),
  ).rejects.toThrow(/chk_moneda_decimales/);

  // Y las sembradas cumplen: si alguna no cumpliera, el CHECK no habría podido
  // crearse y este test pasaría por el motivo equivocado.
  const fuera = await ds.query(
    `SELECT codigo_iso FROM moneda WHERE decimales < 0 OR decimales > 4`,
  );
  expect(fuera).toEqual([]);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npx jest --config test/jest-e2e.json test/esquema.e2e-spec.ts -t "más decimales de los que la columna"`
Expected: FAIL — hoy el INSERT entra sin error.

- [ ] **Step 3: Agregar el CHECK en la entity**

```typescript
// backend/src/modules/monedas/entities/moneda.entity.ts, sobre la clase
// junto a @Entity(), igual que movimiento-caja.entity.ts:19
/**
 * El tope es 4 porque toda columna de dinero es NUMERIC(18,4): una moneda con
 * más decimales haría que el recorte final lo decidiera el cast de Postgres,
 * con su propia regla y fuera de modo_redondeo. Las 3 sembradas cumplen
 * (CLP 0, USD 2, UF 4). Subir el tope exige subir la escala de las columnas.
 */
@Check('chk_moneda_decimales', '"decimales" BETWEEN 0 AND 4')
```

Y reflejarlo en `startup-pos.sql` (tabla `moneda`), que es **documentación de
referencia**: no lo ejecuta nadie, pero si no se actualiza queda describiendo un esquema
que no existe.

```sql
CONSTRAINT chk_moneda_decimales CHECK ("decimales" BETWEEN 0 AND 4),
```

- [ ] **Step 4: Resetear la base y correr el test**

⚠️ Guardá el `.ts` **antes** de resetear y esperá a que el backend recompile: el compose
tiene el fuente bind-mounteado y `synchronize` aplica el CHECK al arrancar.

```bash
./scripts/reset-db.sh
cd backend && npx jest --config test/jest-e2e.json test/esquema.e2e-spec.ts
```
Expected: PASS — el test nuevo y **los dos que ya vivían en ese archivo**.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/monedas startup-pos.sql backend/test/esquema.e2e-spec.ts
git commit -m "feat(redondeo): ninguna moneda puede declarar más decimales de los que la columna guarda"
```

---

### Task 3: `tenants.nivel_redondeo`

**Files:**
- Modify: `startup-pos.sql` (tabla `tenants`);
  `backend/src/modules/tenants/entities/tenant.entity.ts:39` (junto a `modo_redondeo`);
  `backend/src/modules/tenants/tenants.service.ts:191-205` (alta);
  `backend/src/modules/seeder/seeder.service.ts:1113-1117`
- Test: `backend/src/modules/tenants/tenants.service.spec.ts`

**Interfaces:**
- Produces: `nivel_redondeo: 'linea' | 'documento'`, default `'linea'`. Lo consumen las
  tareas 4, 6 y 9.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// tenants.service.spec.ts
it('un tenant nuevo nace con nivel de redondeo por línea', async () => {
  const creado = await service.create({ nombre: 'Tenant nuevo', paisId: PAIS_ID });
  const row = await db.query(
    `SELECT nivel_redondeo FROM tenants WHERE tenant_id = $1`, [creado.id],
  );
  expect(row[0].nivel_redondeo).toBe('linea');
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && npm test -- tenants.service.spec.ts -t "nivel de redondeo por línea"`
Expected: FAIL — la columna no existe.

- [ ] **Step 3: Agregar la columna en los cuatro lugares que la declaran**

⚠️ **Igual que en la Task 2: la entity es la que crea el esquema** (`synchronize`), y
`startup-pos.sql` es documentación que se actualiza para no quedar mintiendo. El CHECK del
dominio de valores va con `@Check` en la entity, no solo en el SQL.

```sql
-- startup-pos.sql, tabla tenants, junto a modo_redondeo (DOCUMENTACIÓN)
"nivel_redondeo" TEXT NOT NULL DEFAULT 'linea',
CONSTRAINT chk_tenants_nivel_redondeo CHECK ("nivel_redondeo" IN ('linea','documento')),
```

```typescript
// tenant.entity.ts, sobre la clase, junto a los demás decoradores de la entity
@Check('chk_tenants_nivel_redondeo', `"nivel_redondeo" IN ('linea','documento')`)
```

```typescript
// tenant.entity.ts, junto a modoRedondeo
/**
 * Nivel al que se cuantiza a la escala de la moneda: 'linea' cuantiza cada
 * línea y el total es suma de enteros; 'documento' deja las líneas a
 * escala_calculo y cuantiza solo el total (la regla mexicana). Decisión (c) +
 * P1 del 2026-08-20: 'documento' está frenado para monedas de 0 decimales.
 */
@Column({ name: 'nivel_redondeo', type: 'text', default: 'linea' })
nivelRedondeo: string;
```

```typescript
// tenants.service.ts, dentro de create(), junto a modoRedondeo: 'HALF_UP'
nivelRedondeo: 'linea',
```

```typescript
// seeder.service.ts, seedTenants, junto a modoRedondeo
nivelRedondeo: 'linea',
```

- [ ] **Step 4: Resetear, correr el test y la suite de tenants**

```bash
./scripts/reset-db.sh
cd backend && npm test -- tenants.service.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add startup-pos.sql backend/src/modules/tenants backend/src/modules/seeder
git commit -m "feat(redondeo): el tenant declara a qué nivel se cuantiza, por línea de fábrica"
```

---

### Task 4: Los dos campos nuevos viajan al motor y se congelan

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.engine.ts:63-70`
  (`ConfigCalculo`); `backend/src/modules/calculo-precios/calculo-precios.service.ts:61-71`
  (`cargarConfig`); `backend/src/modules/tenants/tenants.service.ts:1391-1414`
  (`getPreferenciasFinancieras`); `backend/src/modules/ventas/ventas.service.ts:274-279`
  (la query de `tenant_moneda`)
- Test: `backend/test/ventas.e2e-spec.ts`

**Interfaces:**
- Consumes: `nivel_redondeo` (Task 3), el CHECK de `moneda.decimales` (Task 2).
- Produces: `ConfigCalculo` con `nivelRedondeo: string` y `decimalesMoneda: number`. **Toda
  la Fase 2 los consume.**

- [ ] **Step 1: Escribir el test que falla**

```typescript
// ventas.e2e-spec.ts, junto al test de "la venta congela la config del cálculo"
it('el config congelado incluye el nivel y los decimales de la moneda', async () => {
  const venta = await crearVentaSimple();           // helper ya existente en el spec
  const detalle = await request(app.getHttpServer())
    .get(`/api/ventas/${venta.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(detalle.body.configCalculo).toMatchObject({
    nivelRedondeo: 'linea',
    decimalesMoneda: 0,            // el tenant del seed opera en CLP
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `./scripts/reset-db.sh && cd backend && npx jest --config test/jest-e2e.json test/ventas.e2e-spec.ts -t "nivel y los decimales"`
Expected: FAIL — `configCalculo` trae 5 claves, sin las dos nuevas.

- [ ] **Step 3: Sumar los campos**

```typescript
// calculo-precios.engine.ts — ConfigCalculo
export interface ConfigCalculo {
  formula: string[];
  calculoDescuentos: string;
  calculoRecargos: string;
  escalaCalculo: number;
  modoRedondeo: string;
  /** 'linea' | 'documento'. Ver ADR/spec de redondeo. */
  nivelRedondeo: string;
  /**
   * Minor unit de la moneda OFICIAL del tenant: la escala a la que se cuantiza
   * todo monto cobrado al cerrar el documento. Es dato derivado congelado, no
   * configuración: si mañana cambia la moneda del tenant, una venta vieja tiene
   * que seguir siendo interpretable con lo que valía entonces.
   */
  decimalesMoneda: number;
}
```

```typescript
// tenants.service.ts — getPreferenciasFinancieras: sumar nivel_redondeo al SELECT
// y al objeto devuelto (nivelRedondeo). NO devuelve decimalesMoneda: no es una
// preferencia, sale de la moneda.
```

```typescript
// calculo-precios.service.ts — cargarConfig
async cargarConfig(tenantId: string, decimalesMoneda: number): Promise<ConfigCalculo> {
  const p = await this.tenantsService.getPreferenciasFinancieras(tenantId);
  return {
    formula: p.formula,
    calculoDescuentos: p.calculoDescuentos,
    calculoRecargos: p.calculoRecargos,
    escalaCalculo: p.escalaCalculo,
    modoRedondeo: p.modoRedondeo,
    nivelRedondeo: p.nivelRedondeo,
    decimalesMoneda,
  };
}
```

```sql
-- ventas.service.ts:274-279 — la query que ya corre, con un JOIN más
SELECT tm.moneda_id, tm.valor_del_dia, tm.es_default, m.decimales
  FROM tenant_moneda tm
  JOIN moneda m ON m.moneda_id = tm.moneda_id
 WHERE tm.tenant_id = $1 AND tm.eliminado_el IS NULL
```

⚠️ **No agregar una query nueva**: es una columna más en la que ya resuelve la moneda
oficial (`monedaRows.find(r => r.es_default)`), y de ahí sale `decimalesMoneda`.

⚠️ `calcular()` (`calculo-precios.service.ts:87`) también llama a `cargarConfig` cuando no
recibe `configPrecargada`: ahí hay que resolver la moneda oficial del tenant del mismo
modo. **Sin N+1**: una consulta por request, no una por línea.

- [ ] **Step 4: Correr el test y la suite**

```bash
./scripts/reset-db.sh
cd backend && npx jest --config test/jest-e2e.json test/ventas.e2e-spec.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/calculo-precios backend/src/modules/tenants backend/src/modules/ventas backend/test
git commit -m "feat(redondeo): la escala de la moneda y el nivel llegan al motor y quedan congelados en la venta"
```

---

## Fase 2 — El motor cuantiza

### Task 5: `cuantizar()` y el cierre de línea por línea

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.engine.ts` (`redondear`/`fmt`
  en `:221-227`, `calcularLinea` en `:498-606`)
- Test: `backend/src/modules/calculo-precios/calculo-precios.engine.spec.ts`

**Interfaces:**
- Consumes: `ConfigCalculo.decimalesMoneda`, `.nivelRedondeo` (Task 4).
- Produces: `function cuantizar(d: Decimal, cfg: ConfigCalculo): Decimal` — la usan las
  tareas 6, 7 y 8.

⚠️ **La cuantización cambia el VALOR, no el formato del string.** `fmt()` sigue
formateando a `cfg.escalaCalculo`, así que un neto de 84 en CLP sale como `'84.000000'`.
Eso mantiene el contrato de la API (*"todos los montos son strings con `escala_calculo`
decimales"*) y es la razón por la que los tests del motor que esperan `'17.100000'` siguen
pasando.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// calculo-precios.engine.spec.ts
describe('cuantización a la escala de la moneda', () => {
  const cfgCLP = {
    formula: ['descuentos', 'recargos', 'impuestos'],
    calculoDescuentos: 'base',
    calculoRecargos: 'base',
    escalaCalculo: 6,
    modoRedondeo: 'HALF_UP',
    nivelRedondeo: 'linea',
    decimalesMoneda: 0,
  };

  it('en CLP ninguna salida de línea queda con decimales', () => {
    // 15.000 − 5% = 14.250; IVA 19% = 2.707,5 → el medio peso que hoy se persiste
    const r = calcularVenta({
      config: cfgCLP,
      metodoPagoId: null,
      descuentosVenta: [],
      recargosVenta: [],
      lineas: [{
        itemId: 'i1', cantidad: '1', precioUnitario: '15000',
        precioIncluyeImpuesto: false,
        descuentos: [{ id: 'd1', nombre: '5%', modo: 'porcentaje', valor: '0.05',
                       tramos: [], metodoPagoIds: [], activo: true }],
        recargos: [],
        impuestos: [{ id: 'iva', nombre: 'IVA', porcentaje: '0.19', activo: true }],
      }],
    });

    const l = r.lineas[0];
    for (const v of [l.subtotalNeto, l.descuentoAplicado, l.recargoAplicado,
                     l.impuestoAplicado, l.totalLinea]) {
      expect(new Decimal(v).isInteger()).toBe(true);
    }
    expect(new Decimal(r.totales.totalFinal).isInteger()).toBe(true);
  });

  it('el total de línea es la suma de sus componentes ya cuantizados', () => {
    const r = calcularVenta(ventaDelMedioPeso());
    const l = r.lineas[0];
    const esperado = new Decimal(l.subtotalNeto)
      .minus(l.descuentoAplicado)
      .plus(l.recargoAplicado)
      .plus(l.impuestoAplicado);
    expect(new Decimal(l.totalLinea).eq(esperado)).toBe(true);
  });

  it('la suma de las trazas de descuento da el descuento aplicado', () => {
    const r = calcularVenta(ventaDelMedioPeso());
    const l = r.lineas[0];
    const suma = l.trazas.descuentos.reduce(
      (acc, t) => acc.plus(t.monto), new Decimal(0),
    );
    expect(suma.eq(l.descuentoAplicado)).toBe(true);
  });
});
```

El helper que comparten los tres, en el mismo `describe` (el primer test lo usa también):

```typescript
/** El caso medido en dev: 15.000 − 5% = 14.250; IVA 19% = 2.707,5. */
function ventaDelMedioPeso() {
  return {
    config: cfgCLP,
    metodoPagoId: null,
    descuentosVenta: [],
    recargosVenta: [],
    lineas: [{
      itemId: 'i1', cantidad: '1', precioUnitario: '15000',
      precioIncluyeImpuesto: false,
      descuentos: [{ id: 'd1', nombre: '5%', modo: 'porcentaje', valor: '0.05',
                     tramos: [], metodoPagoIds: [], activo: true }],
      recargos: [],
      impuestos: [{ id: 'iva', nombre: 'IVA', porcentaje: '0.19',
                    activo: true, tipo: 'iva' }],
    }],
  };
}
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && npm test -- calculo-precios.engine.spec.ts -t "cuantización"`
Expected: FAIL — hoy `impuestoAplicado` es `2707.5` y `totalLinea` `16957.5`.

- [ ] **Step 3: Implementar**

```typescript
// calculo-precios.engine.ts, junto a redondear()
/**
 * Lleva un MONTO a la escala de la moneda con el modo del tenant. Es el paso de
 * CIERRE: el acumulado interno de las reglas sigue corriendo a escala_calculo
 * (ver redondear), porque cuantizar el acumulado en cada paso compondría el
 * error —el caso Vancouver Stock Exchange— y la norma (SAT, IRS) instruye
 * redondear una sola vez, al final.
 */
function cuantizar(d: Decimal, cfg: ConfigCalculo): Decimal {
  return d.toDecimalPlaces(cfg.decimalesMoneda, modoToRounding(cfg.modoRedondeo));
}
```

En `calcularLinea`, con `nivelRedondeo === 'linea'`:

```typescript
// :520 — el primer monto de la cadena nace ya cuantizado
const porLinea = cfg.nivelRedondeo === 'linea';
const q = (d: Decimal) => (porLinea ? cuantizar(d, cfg) : d);

const subtotalNeto = q(redondear(netoUnitario.times(cantidad), cfg));
```

Cada traza se cuantiza y los totales por familia se derivan de las trazas:

```typescript
// en el paso 'descuentos' / 'recargos', después de procesarReglas:
// las trazas vienen a escala_calculo; se cuantizan y el total se re-deriva de
// ellas, para que Σ trazas = total aplicado y el ticket cuadre línea por línea.
r.trazas = r.trazas.map((t) => ({ ...t, monto: fmt(q(new Decimal(t.monto)), cfg) }));
descuentoAplicado = r.trazas.reduce((a, t) => a.plus(t.monto), ZERO);
```

Y el total de línea se **deriva**, no se cuantiza aparte:

```typescript
// :594-605 — antes: totalLinea: fmt(acc, cfg)
const totalLinea = subtotalNeto
  .minus(descuentoAplicado)
  .plus(recargoAplicado)
  .plus(impuestoAplicado);
```

⚠️ **`acc` sigue siendo el acumulado fino** que sirve de base a los porcentajes en modo
`compuesto` y a la base imponible: no reemplazarlo por el derivado.

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npm test -- calculo-precios.engine.spec.ts calculo-precios.service.spec.ts`
Expected: PASS, **incluidos los tests viejos** que esperan `'17.100000'` (la moneda de esos
casos tiene decimales; el formato no cambió).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/calculo-precios
git commit -m "feat(redondeo): la línea cierra en la escala de la moneda y su total se deriva de las partes"
```

---

### Task 6: El nivel `documento`

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.engine.ts` (`calcularVenta`
  en `:610-706`)
- Test: `backend/src/modules/calculo-precios/calculo-precios.engine.spec.ts`

**Interfaces:**
- Consumes: `cuantizar()` (Task 5).

- [ ] **Step 1: Escribir el test que falla**

```typescript
it('con nivel documento las líneas conservan decimales y solo el total se cuantiza', () => {
  const cfg = { ...cfgCLP, nivelRedondeo: 'documento' };
  const r = calcularVenta({ /* el mismo carrito del test anterior */ config: cfg });

  expect(new Decimal(r.lineas[0].impuestoAplicado).eq('2707.5')).toBe(true);
  expect(new Decimal(r.totales.totalFinal).isInteger()).toBe(true);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && npm test -- calculo-precios.engine.spec.ts -t "nivel documento"`
Expected: FAIL — hoy `nivelRedondeo` no se lee en `calcularVenta`.

- [ ] **Step 3: Implementar**

```typescript
// calcularVenta, al armar los totales (:687-695)
const alDocumento = cfg.nivelRedondeo === 'documento';
const cierre = (d: Decimal) => (alDocumento ? cuantizar(d, cfg) : d);

return {
  lineas,
  totales: {
    subtotalNeto: fmt(cierre(subtotalNeto), cfg),
    totalDescuentos: fmt(cierre(totalDescuentos), cfg),
    totalRecargos: fmt(cierre(totalRecargos), cfg),
    totalImpuestos: fmt(cierre(totalImpuestos), cfg),
    totalFinal: fmt(cierre(totalFinal), cfg),
  },
  // …
};
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npm test -- calculo-precios.engine.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/calculo-precios
git commit -m "feat(redondeo): el nivel documento cuantiza el total y deja las líneas finas"
```

---

### Task 7: Las reglas de nivel venta son campos de documento

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.engine.ts` (`calcularVenta`,
  `:654-685`)
- Test: `backend/src/modules/calculo-precios/calculo-precios.engine.spec.ts`

**Interfaces:**
- Consumes: `cuantizar()` (Task 5).

**Por qué existe esta tarea:** es la obligación (c.1). Sin ella la perilla promete que el
cliente suma el ticket y llega al total, y con un descuento de venta eso es falso —
`totalFinal = Σ totalLinea − dv + rv` con `dv` decimal.

- [ ] **Step 1: Escribir el test que falla**

```typescript
it('con descuento de nivel venta, Σ líneas − descuento global = total, todo entero', () => {
  const r = calcularVenta({
    config: cfgCLP,
    metodoPagoId: null,
    descuentosVenta: [{ id: 'dv1', nombre: 'Cupón 7%', modo: 'porcentaje',
                        valor: '0.07', tramos: [], metodoPagoIds: [], activo: true }],
    recargosVenta: [],
    // Netos 3.000 + 1.550 = 4.550, y 7% de 4.550 = 318,5 → el descuento global
    // cae justo en el medio peso, que es el caso que la identidad tiene que cerrar.
    lineas: [
      { itemId: 'i1', cantidad: '1', precioUnitario: '3000',
        precioIncluyeImpuesto: false, descuentos: [], recargos: [],
        impuestos: [{ id: 'iva', nombre: 'IVA', porcentaje: '0.19',
                      activo: true, tipo: 'iva' }] },
      { itemId: 'i2', cantidad: '1', precioUnitario: '1550',
        precioIncluyeImpuesto: false, descuentos: [], recargos: [],
        impuestos: [{ id: 'iva', nombre: 'IVA', porcentaje: '0.19',
                      activo: true, tipo: 'iva' }] },
    ],
  });

  const sumaLineas = r.lineas.reduce(
    (acc, l) => acc.plus(l.totalLinea), new Decimal(0),
  );
  const dv = new Decimal(r.trazasVenta.descuentos[0].monto);

  expect(dv.isInteger()).toBe(true);
  expect(sumaLineas.minus(dv).eq(r.totales.totalFinal)).toBe(true);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && npm test -- calculo-precios.engine.spec.ts -t "descuento global"`
Expected: FAIL — `dv.total` sale a `escala_calculo`.

- [ ] **Step 3: Implementar**

```typescript
// calcularVenta, después del loop de reglas de venta (:683)
// `porLinea` se declara acá también: el de la Task 5 es local a calcularLinea.
const porLinea = cfg.nivelRedondeo === 'linea';

// Las reglas de nivel venta son campos de DOCUMENTO (el DscRcgGlobal del DTE):
// se cuantizan como cualquier monto cobrado, y por eso el ticket cuadra sumando
// líneas y restando el descuento global. El modelo ya las trata así:
// ventas_descuentos las persiste con detalle_id null.
const dvTotal = porLinea ? cuantizar(dv.total, cfg) : dv.total;
const rvTotal = porLinea ? cuantizar(rv.total, cfg) : rv.total;

dv.trazas = dv.trazas.map((t) => ({
  ...t, monto: fmt(porLinea ? cuantizar(new Decimal(t.monto), cfg) : new Decimal(t.monto), cfg),
}));
rv.trazas = rv.trazas.map((t) => ({
  ...t, monto: fmt(porLinea ? cuantizar(new Decimal(t.monto), cfg) : new Decimal(t.monto), cfg),
}));

totalDescuentos = totalDescuentos.plus(dvTotal);
totalRecargos = totalRecargos.plus(rvTotal);
totalFinal = totalFinal.minus(dvTotal).plus(rvTotal);
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npm test -- calculo-precios.engine.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/calculo-precios
git commit -m "feat(redondeo): el descuento de nivel venta cuantiza como campo de documento"
```

---

### Task 8: El desbruteo cierra a góndola — el IVA absorbe el residuo

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.engine.ts:39-50`
  (`ImpuestoResuelto`), `:511-519` y `:577-591` (`calcularLinea`)
- Test: `backend/src/modules/calculo-precios/calculo-precios.engine.spec.ts`

**Interfaces:**
- Consumes: `cuantizar()` (Task 5).
- Produces: `ImpuestoResuelto.tipo: string` (`'iva'` | `'otro'`) — el service ya lo tiene
  en runtime (`calculo-precios.service.ts:95` lo tipa como
  `ImpuestoResuelto & { tipo: string }` y agrega el IVA como `ivaDelPais` en `:343`),
  falta declararlo.

- [ ] **Step 1: Escribir los tests que fallan**

⚠️ `cfgCLP` (definido en el `describe` de la Task 5) se **eleva al scope del archivo** para
que los dos bloques lo compartan, en vez de duplicarlo.

```typescript
describe('desbruteo: el total cierra a góndola', () => {
  const linea = (precio: string, impuestos: any[]) => ({
    itemId: 'i1', cantidad: '1', precioUnitario: precio,
    precioIncluyeImpuesto: true, descuentos: [], recargos: [], impuestos,
  });
  const IVA = { id: 'iva', nombre: 'IVA', porcentaje: '0.19', activo: true, tipo: 'iva' };

  it('góndola 993 en CLP da 834 + 159 y total 993', () => {
    const r = calcularVenta({ config: cfgCLP, metodoPagoId: null,
      descuentosVenta: [], recargosVenta: [], lineas: [linea('993', [IVA])] });

    expect(new Decimal(r.lineas[0].subtotalNeto).eq(834)).toBe(true);
    expect(new Decimal(r.lineas[0].impuestoAplicado).eq(159)).toBe(true);
    expect(new Decimal(r.lineas[0].totalLinea).eq(993)).toBe(true);
  });

  it.each(['995', '997', '1000', '1990'])(
    'los precios que ya cerraban siguen cerrando: %s', (precio) => {
      const r = calcularVenta({ config: cfgCLP, metodoPagoId: null,
        descuentosVenta: [], recargosVenta: [], lineas: [linea(precio, [IVA])] });
      expect(new Decimal(r.lineas[0].totalLinea).eq(precio)).toBe(true);
    });

  it('con IVA + adicional, el adicional queda exacto y el IVA absorbe', () => {
    const ILA = { id: 'ila', nombre: 'ILA', porcentaje: '0.10', activo: true, tipo: 'otro' };
    const r = calcularVenta({ config: cfgCLP, metodoPagoId: null,
      descuentosVenta: [], recargosVenta: [], lineas: [linea('1990', [IVA, ILA])] });

    const l = r.lineas[0];
    const neto = new Decimal(l.subtotalNeto);
    const ila = new Decimal(l.trazas.impuestos.find((t) => t.id === 'ila')!.monto);
    const iva = new Decimal(l.trazas.impuestos.find((t) => t.id === 'iva')!.monto);

    expect(ila.eq(neto.times('0.10').toDecimalPlaces(0, Decimal.ROUND_HALF_UP))).toBe(true);
    expect(iva.plus(ila).eq(new Decimal(1990).minus(neto))).toBe(true);
    expect(new Decimal(l.totalLinea).eq(1990)).toBe(true);
  });

  it('línea exenta con adicional: absorbe el adicional de mayor tasa', () => {
    const ILA = { id: 'ila', nombre: 'ILA', porcentaje: '0.10', activo: true, tipo: 'otro' };
    const OTRO = { id: 'o2', nombre: 'Otro', porcentaje: '0.05', activo: true, tipo: 'otro' };
    const r = calcularVenta({ config: cfgCLP, metodoPagoId: null,
      descuentosVenta: [], recargosVenta: [], lineas: [linea('993', [ILA, OTRO])] });

    const l = r.lineas[0];
    expect(new Decimal(l.totalLinea).eq(993)).toBe(true);   // sigue cerrando a góndola
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && npm test -- calculo-precios.engine.spec.ts -t "desbruteo"`
Expected: FAIL — hoy da `subtotalNeto` 834 e `impuestoAplicado` 158, total **992**.

- [ ] **Step 3: Implementar**

```typescript
// ImpuestoResuelto — declarar el tipo que el service ya manda
export interface ImpuestoResuelto {
  id: string;
  nombre: string;
  porcentaje: string;
  activo: boolean;
  /**
   * 'iva' | 'otro'. Lo necesita el desbruteo: con precio que incluye impuesto,
   * los adicionales se calculan por su fórmula y el IVA absorbe el residuo, para
   * que el total cierre exacto al precio de góndola (decisión e + Q1).
   */
  tipo: string;
}
```

```typescript
// calcularLinea, paso 'impuestos'
} else if (paso === 'impuestos') {
  const baseImponible = acc;

  if (linea.precioIncluyeImpuesto && impuestosVigentes.length > 0) {
    // La etiqueta manda: el total de la línea es el bruto, y los impuestos son
    // exactamente lo que sobra sobre el neto. Los adicionales van por su
    // fórmula; el IVA se queda con el residuo —o, si la línea es exenta, el
    // adicional de mayor tasa—. Ver decisión (e) y Q1 de la spec de redondeo.
    const totalObjetivo = q(bruto.times(cantidad));
    const residuo = totalObjetivo.minus(subtotalNeto);

    const absorbeId = elegirAbsorbente(impuestosVigentes);
    let repartido = ZERO;

    for (const imp of impuestosVigentes) {
      const monto =
        imp.id === absorbeId
          ? ZERO                                  // se completa después
          : q(redondear(baseImponible.times(imp.porcentaje), cfg));
      if (imp.id !== absorbeId) repartido = repartido.plus(monto);
      trazas.impuestos.push({
        id: imp.id, nombre: imp.nombre, tasa: imp.porcentaje, monto: fmt(monto, cfg),
      });
    }

    const montoAbsorbente = residuo.minus(repartido);
    const t = trazas.impuestos.find((x) => x.id === absorbeId)!;
    t.monto = fmt(montoAbsorbente, cfg);

    impuestoAplicado = residuo;
    acc = acc.plus(residuo);
  } else {
    for (const imp of impuestosVigentes) {
      const monto = q(redondear(baseImponible.times(imp.porcentaje), cfg));
      impuestoAplicado = impuestoAplicado.plus(monto);
      acc = acc.plus(monto);
      trazas.impuestos.push({
        id: imp.id, nombre: imp.nombre, tasa: imp.porcentaje, monto: fmt(monto, cfg),
      });
    }
  }
}
```

```typescript
// helper, junto a los demás del motor
/**
 * Quién absorbe el residuo del desbruteo: el IVA si la línea es afecta; si es
 * exenta (no hay IVA en la lista) el adicional de mayor tasa, con desempate
 * determinista por id para que el resultado sea reproducible.
 */
function elegirAbsorbente(impuestos: ImpuestoResuelto[]): string {
  const iva = impuestos.find((i) => i.tipo === 'iva');
  if (iva) return iva.id;
  return [...impuestos]
    .sort((a, b) => {
      const cmp = new Decimal(b.porcentaje).comparedTo(a.porcentaje);
      return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
    })[0].id;
}
```

⚠️ **Con descuentos o recargos en la línea, `totalObjetivo` ya no es la góndola pura**: la
identidad que se preserva es *lo cobrado = neto + impuestos ± reglas*. El test del caso con
descuento va en el mismo commit.

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npm test -- calculo-precios.engine.spec.ts calculo-precios.service.spec.ts`
Expected: PASS. ⚠️ `calculo-precios.service.spec.ts:632-633` **cambia de número**:
`15.966386` → `15.966387` (el IVA pasa a derivarse por resta). Actualizar el valor esperado
y **dejar el comentario** de por qué cambió.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/calculo-precios
git commit -m "feat(redondeo): con precio que incluye impuesto, el total cierra a góndola y el IVA cede"
```

---

## Fase 3 — La perilla y su matriz

### Task 9: `nivelRedondeo` en preferencias, con las combinaciones prohibidas

**Files:**
- Modify: `backend/src/modules/tenants/dto/update-preferencias-financieras.dto.ts`;
  `backend/src/modules/tenants/tenants.service.ts:1416-1475`
  (`updatePreferenciasFinancieras`, incluido el `UPDATE` de `:1436-1449`);
  `frontend/app/pages/configuracion/preferencias-financieras.vue`
- Test: `backend/src/modules/tenants/tenants.service.spec.ts`,
  `backend/test/tenants.e2e-spec.ts`

**Interfaces:**
- Consumes: `nivel_redondeo` (Task 3).

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// tenants.service.spec.ts
it('rechaza nivel documento con una moneda oficial sin decimales', async () => {
  // el tenant del seed opera en CLP (0 decimales)
  await expect(
    service.updatePreferenciasFinancieras(TENANT_ID, {
      ...prefsValidas, nivelRedondeo: 'documento',
    }),
  ).rejects.toThrow(/no admite decimales/);
});

it('rechaza una escala de cálculo menor que los decimales de la moneda', async () => {
  await expect(
    service.updatePreferenciasFinancieras(TENANT_USD, {
      ...prefsValidas, escalaCalculo: 1,      // USD tiene 2
    }),
  ).rejects.toThrow(/escala de cálculo/);
});

it('acepta nivel documento en una moneda con decimales', async () => {
  const r = await service.updatePreferenciasFinancieras(TENANT_USD, {
    ...prefsValidas, nivelRedondeo: 'documento',
  });
  expect(r.nivelRedondeo).toBe('documento');
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && npm test -- tenants.service.spec.ts -t "nivel documento"`
Expected: FAIL — el DTO no conoce el campo.

- [ ] **Step 3: Implementar**

```typescript
// update-preferencias-financieras.dto.ts
@IsIn(['linea', 'documento'])
nivelRedondeo: string;
```

```typescript
// tenants.service.ts, dentro de updatePreferenciasFinancieras, antes del UPDATE
// La matriz de interacción no es documentación: alguna combinación tiene que
// ser rechazable, o la perilla ofrece el bug que este frente vino a cerrar.
const decimales = await this.decimalesMonedaOficial(tenantId, manager);

if (dto.nivelRedondeo === 'documento' && decimales === 0) {
  throw new BadRequestException(
    'El nivel "documento" deja decimales en las líneas y la moneda oficial del ' +
    'tenant no admite decimales. Usá "linea".',
  );
}
if (dto.escalaCalculo < decimales) {
  throw new BadRequestException(
    `La escala de cálculo (${dto.escalaCalculo}) no puede ser menor que los ` +
    `decimales de la moneda oficial (${decimales}).`,
  );
}
```

Y sumar `nivel_redondeo` al `UPDATE` de `:1436-1449` y al `SELECT` de
`getPreferenciasFinancieras`.

Frontend — en `preferencias-financieras.vue`, junto a "Modo de redondeo":

```vue
<UFormField label="Nivel de redondeo"
            hint="Por línea: cada línea se redondea y el total es la suma. Por documento: solo el total.">
  <URadioGroup v-model="nivelRedondeo" :items="nivelesRedondeo" />
</UFormField>
```

⚠️ Los seis campos se declaran **cuatro veces** en esa página (refs `:14-19`, `cargar()`
`:39-56`, `formState` `:66-73`, `guardar()` `:75-88`): el campo nuevo va en las cuatro.

- [ ] **Step 4: Correr los tests**

```bash
cd backend && npm test -- tenants.service.spec.ts
cd frontend && npm run build && npm run typecheck:ratchet && npm run design:check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tenants frontend/app/pages/configuracion
git commit -m "feat(redondeo): la perilla de nivel se configura, y la matriz frena lo que no tiene sentido"
```

---

## Fase 4 — Los bordes de entrada

### Task 10: El decorador y el pipe de escala

**Files:**
- Create: `backend/src/common/decorators/escala-moneda.decorator.ts`,
  `backend/src/common/pipes/escala-moneda.pipe.ts`
- Modify: `backend/src/modules/monedas/monedas.service.ts` (dos métodos nuevos)
- Test: `backend/src/common/pipes/escala-moneda.pipe.spec.ts`

**Interfaces:**
- Produces:
  - `@EsMontoCobrado()` y `@EsCosto()` — decoradores de metadata, los consume la Task 11.
  - `EscalaMonedaPipe` — el pipe, lo consume la Task 11.
  - `MonedasService.decimalesOficiales(tenantId: string): Promise<number>` — los decimales
    de la moneda oficial del tenant. Lo consume el pipe.
  - `MonedasService.decimalesDeLaVenta(ventaId: string, tenantId: string): Promise<number>`
    — los decimales de la moneda de una venta ya emitida. **Lo consume la Task 12.**

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// escala-moneda.pipe.spec.ts
class DtoDePrueba {
  @EsMontoCobrado()
  monto: string;
}

describe('EscalaMonedaPipe', () => {
  it('rechaza un monto con más decimales de los que la moneda admite', async () => {
    const pipe = new EscalaMonedaPipe(monedasServiceFake(0)); // CLP
    await expect(
      pipe.transform({ monto: '1000.5' }, { metatype: DtoDePrueba } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('acepta un entero escrito con ceros a la derecha', async () => {
    const pipe = new EscalaMonedaPipe(monedasServiceFake(0));
    await expect(
      pipe.transform({ monto: '1000.00' }, { metatype: DtoDePrueba } as any),
    ).resolves.toEqual({ monto: '1000.00' });
  });

  it('acepta dos decimales en una moneda de dos decimales', async () => {
    const pipe = new EscalaMonedaPipe(monedasServiceFake(2)); // USD
    await expect(
      pipe.transform({ monto: '10.55' }, { metatype: DtoDePrueba } as any),
    ).resolves.toEqual({ monto: '10.55' });
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd backend && npm test -- escala-moneda.pipe.spec.ts`
Expected: FAIL — los archivos no existen.

- [ ] **Step 3: Implementar**

```typescript
// escala-moneda.decorator.ts
export const ESCALA_MONEDA_KEY = 'escala:montoCobrado';
export const ESCALA_COSTO_KEY = 'escala:costo';

/** El campo es un monto COBRADO: se valida contra los decimales de la moneda
 *  oficial del tenant. Decisión (d) del 2026-08-20. */
export const EsMontoCobrado = (): PropertyDecorator => (target, key) => {
  const campos: string[] = Reflect.getMetadata(ESCALA_MONEDA_KEY, target.constructor) ?? [];
  Reflect.defineMetadata(ESCALA_MONEDA_KEY, [...campos, key as string], target.constructor);
};

/** El campo es un COSTO o una TASA: escala fija 4. Decisión (k). */
export const EsCosto = (): PropertyDecorator => (target, key) => {
  const campos: string[] = Reflect.getMetadata(ESCALA_COSTO_KEY, target.constructor) ?? [];
  Reflect.defineMetadata(ESCALA_COSTO_KEY, [...campos, key as string], target.constructor);
};
```

```typescript
// escala-moneda.pipe.ts
@Injectable({ scope: Scope.REQUEST })
export class EscalaMonedaPipe implements PipeTransform {
  constructor(private readonly monedas: MonedasService,
              @Inject(REQUEST) private readonly req: RequestConTenant) {}

  async transform(value: any, meta: ArgumentMetadata) {
    if (!meta.metatype || typeof value !== 'object' || value === null) return value;

    const cobrados: string[] =
      Reflect.getMetadata(ESCALA_MONEDA_KEY, meta.metatype) ?? [];
    const costos: string[] =
      Reflect.getMetadata(ESCALA_COSTO_KEY, meta.metatype) ?? [];
    if (!cobrados.length && !costos.length) return value;

    // tenant_id SIEMPRE del token, nunca del body (invariante de CLAUDE.md)
    const decimales = cobrados.length
      ? await this.monedas.decimalesOficiales(this.req.user.tenantId)
      : 0;

    for (const campo of cobrados) this.validar(value[campo], decimales, campo);
    for (const campo of costos) this.validar(value[campo], ESCALA_COSTO, campo);
    return value;
  }

  private validar(valor: unknown, escala: number, campo: string) {
    if (valor === undefined || valor === null) return;
    if (typeof valor !== 'string') return;   // el formato ya lo valida @IsNumberString
    let d: Decimal;
    try { d = new Decimal(valor); } catch { return; }
    // La regla es sobre el VALOR, no sobre la cadena: '1000.00' en CLP es
    // válido porque 1000 es representable en pesos (decisión Q3).
    if (d.decimalPlaces() > escala && !d.eq(d.toDecimalPlaces(escala))) {
      throw new BadRequestException(
        `${campo} tiene más decimales de los que la moneda admite (${escala}).`,
      );
    }
  }
}
```

Los dos métodos que el pipe y la Task 12 necesitan, en `MonedasService`:

```typescript
/** Decimales (minor unit) de la moneda oficial del tenant. Una consulta
 *  indexada por request, no una por campo ni por línea. */
async decimalesOficiales(tenantId: string): Promise<number> {
  const rows: { decimales: number }[] = await this.db.query(
    `SELECT m.decimales
       FROM tenant_moneda tm
       JOIN moneda m ON m.moneda_id = tm.moneda_id
      WHERE tm.tenant_id = $1 AND tm.es_default = true AND tm.eliminado_el IS NULL`,
    [tenantId],
  );
  if (!rows.length)
    throw new BadRequestException('El tenant no tiene moneda oficial configurada');
  return rows[0].decimales;
}

/** Decimales de la moneda con la que se emitió una venta. La NC y el webhook de
 *  reembolso corrigen ESE documento, así que usan su moneda, no la vigente. */
async decimalesDeLaVenta(ventaId: string, tenantId: string): Promise<number> {
  const rows: { decimales: number }[] = await this.db.query(
    `SELECT m.decimales
       FROM ventas v
       JOIN moneda m ON m.moneda_id = v.moneda_id
      WHERE v.venta_id = $1 AND v.tenant_id = $2 AND v.eliminado_el IS NULL`,
    [ventaId, tenantId],
  );
  if (!rows.length) throw new NotFoundException('Venta no encontrada');
  return rows[0].decimales;
}
```

⚠️ **Sin caché por ahora:** una venta ya hace 113 consultas, así que una más no mueve la
aguja, y un caché exigiría invalidarlo cuando el admin cambia la moneda oficial
(`PATCH /api/monedas/:id/default`).

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npm test -- escala-moneda.pipe.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/common/decorators backend/src/common/pipes
git commit -m "feat(redondeo): el borde sabe cuántos decimales admite la plata de cada tenant"
```

---

### Task 11: Marcar los campos de plata y actualizar los tests que afirmaban lo contrario

**Files:**
- Modify: `pagos/dto/create-pago.dto.ts:18`; `ventas/dto/create-venta.dto.ts:45,:80`;
  `ventas/dto/create-nota-credito.dto.ts:23`; `ventas/dto/propina-directa.dto.ts:14,:19`;
  `ventas/dto/propina-cierre-mesa.dto.ts:15,:20`; `caja/dto/crear-movimiento.dto.ts:21`;
  `caja/dto/abrir-caja.dto.ts:9`; `caja/dto/linea-cierre.dto.ts:13`;
  `salones/dto/cerrar-cuenta.dto.ts:33,:38`; `items/dto/aplicar-desfases.dto.ts:25`;
  `tenants/dto/update-preferencias-financieras.dto.ts:33` (`montoTolerancia`);
  `inventario/dto/ajuste-costo.dto.ts:10`; `mermas/dto/create-merma.dto.ts:29`;
  `items/dto/ajuste-stock.dto.ts:78`; `items/dto/create-item.dto.ts:222`
- Test: los **nueve** de aceptación (ver Step 3)

**Interfaces:**
- Consumes: `@EsMontoCobrado`, `@EsCosto`, `EscalaMonedaPipe` (Task 10).

- [ ] **Step 1: Escribir el test que falla**

```typescript
// caja.e2e-spec.ts — el caso que hoy devuelve 201
it('rechaza abrir caja con un saldo que la moneda no puede representar', async () => {
  await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({ saldoInicial: '10000.5000' })
    .expect(400);
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `./scripts/reset-db.sh && cd backend && npx jest --config test/jest-e2e.json test/caja.e2e-spec.ts -t "que la moneda no puede representar"`
Expected: FAIL — hoy responde 201.

- [ ] **Step 3: Marcar los campos y actualizar los nueve tests**

En cada DTO de la lista, sumar el decorador junto a los existentes:

```typescript
@IsNumberString()
@IsDecimalPositivo()
@EsMontoCobrado()          // ← nuevo
monto: string;
```

`montoTolerancia` suma además el signo, que hoy no tiene:

```typescript
@IsNumberString()
@IsDecimalNoNegativo()     // ← nuevo: una tolerancia negativa no significa nada
@EsMontoCobrado()          // ← nuevo (decisión P7)
montoTolerancia: string;
```

Los de costo llevan `@EsCosto()`.

**Los nueve tests que cambian** (ocho de la decisión (d) + el que apareció en la segunda
ronda). En cada uno, el valor con decimales de más pasa de "válido" a "rechazado", y el
caso válido se reescribe con un valor representable:

| Test | Hoy afirma | Pasa a |
|---|---|---|
| `decimal-signo.decorator.spec.ts:21` | `'10.50'` válido | sigue válido (**el decorador de signo no cambia**); se agrega un caso del pipe |
| `decimal-signo.decorator.spec.ts:51` | ídem | ídem |
| `ajustes-reparto.dto.spec.ts:30` | `'5000.5000'` válido | rechazado en CLP |
| `linea-cierre.dto.spec.ts:20` | `'15300.50'` válido | rechazado en CLP |
| `dinero-signo.dto.spec.ts:58` | `precioBase: '1500.5000'` válido | rechazado |
| `monto-regla.util.spec.ts:51` | `valor: '0.10'` válido | rechazado como monto fijo en CLP |
| `caja.e2e-spec.ts:810` | 201 | **400** |
| `caja.e2e-spec.ts:815` | 201 | **400** |
| `tenants.service.spec.ts:613` | `montoTolerancia: '1.5'` round-trip | rechazado en CLP |

- [ ] **Step 4: Correr el gate entero**

```bash
./scripts/reset-db.sh
cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
./scripts/reset-db.sh --verificar
```
Expected: PASS. ⚠️ **La suite completa, no un subset:** un DTO compartido rompe specs
lejanas, y ya pasó en este repo.

- [ ] **Step 5: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(redondeo): la plata que entra por API se rechaza si trae decimales que la moneda no tiene"
```

---

### Task 12: El webhook de reembolso cuantiza y registra

**Files:**
- Modify: `backend/src/modules/ventas/reembolso-callback.handler.ts:32-45`
- Test: `backend/src/modules/ventas/reembolso-callback.handler.spec.ts`

**Interfaces:**
- Consumes: nada de tareas previas (usa la escala de la moneda de la venta original).

**Por qué no rechaza:** decisión P3. Validar una intención (un cajero tipeando) y registrar
un hecho consumado (la pasarela informando lo que **ya cobró**) no son la misma operación:
rechazar el callback pierde el evento y no deshace el cobro.

- [ ] **Step 1: Escribir el test que falla**

```typescript
it('un reembolso con decimales de más se cuantiza y se registra, no se rechaza', async () => {
  const logger = jest.spyOn(handler['logger'], 'warn');

  await handler.onReembolsoAprobado({
    tenantId: TENANT, ventaId: VENTA, monto: '1000.5000', generarNotaCredito: true,
  });

  expect(ventasService.crearNotaCredito).toHaveBeenCalledWith(
    expect.objectContaining({ monto: '1001' }),
  );
  expect(logger).toHaveBeenCalledWith(
    expect.stringContaining('1000.5000'),   // el valor original queda en la traza
  );
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd backend && npm test -- reembolso-callback.handler.spec.ts`
Expected: FAIL — hoy pasa `'1000.5000'` tal cual.

- [ ] **Step 3: Implementar**

```typescript
// reembolso-callback.handler.ts, antes de crearNotaCredito
const decimales = await this.monedas.decimalesDeLaVenta(evento.ventaId, evento.tenantId);
const montoExacto = new Decimal(evento.monto);
const monto = montoExacto.toDecimalPlaces(decimales, Decimal.ROUND_HALF_UP);

if (!monto.eq(montoExacto)) {
  // La pasarela ya cobró: el hecho consumado se registra, no se rechaza
  // (decisión P3). Queda el valor original para poder reconstruirlo.
  this.logger.warn(
    `Reembolso de la pasarela con más decimales que la moneda: ${evento.monto} → ${monto.toString()} (venta ${evento.ventaId})`,
  );
}
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npm test -- reembolso-callback.handler.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ventas
git commit -m "feat(redondeo): el reembolso de la pasarela se cuantiza con traza, no se rechaza"
```

---

## Fase 5 — La nota de crédito

### Task 13: La NC hereda el criterio congelado y congela el suyo

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts:1227-1257` (`lockVentaOriginal`),
  `:988-1004` (creación de la NC), `:1007-1010` (la línea), `:1738-1740` (el comentario que
  queda obsoleto); `frontend/app/components/ventas/VentaDetalleDrawer.vue:112-116`, `:845`
- Test: `backend/test/ventas.e2e-spec.ts`

**Interfaces:**
- Consumes: `ConfigCalculo` congelado (Task 4).

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// ventas.e2e-spec.ts
it('la línea de la NC no persiste decimales que la moneda no tiene', async () => {
  const venta = await crearVentaConCantidadFraccionaria();  // precio 4 dec × cantidad
  const nc = await emitirNotaCredito(venta, { devoluciones: [/* una línea */] });

  const lineas = await dataSource.query(
    `SELECT total_linea FROM venta_detalles WHERE venta_id = $1`, [nc.id],
  );
  expect(new Decimal(lineas[0].total_linea).isInteger()).toBe(true);
});

it('la NC hereda el modo congelado de la venta original, no el vigente', async () => {
  const venta = await crearVentaSimple();                    // tenant en HALF_UP
  await cambiarPreferencia({ modoRedondeo: 'FLOOR' });        // cambia DESPUÉS
  const nc = await emitirNotaCredito(venta, { monto: '1000' });

  const detalle = await getVenta(nc.id);
  expect(detalle.body.configCalculo.modoRedondeo).toBe('HALF_UP');
});

it('la NC congela su propia config', async () => {
  const venta = await crearVentaSimple();
  const nc = await emitirNotaCredito(venta, { monto: '1000' });
  const detalle = await getVenta(nc.id);
  expect(detalle.body.configCalculo).not.toBeNull();
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `./scripts/reset-db.sh && cd backend && npx jest --config test/jest-e2e.json test/ventas.e2e-spec.ts -t "NC"`
Expected: FAIL — hoy `config_calculo` de la NC es `null` y la línea usa HALF_UP fijo a 4.

- [ ] **Step 3: Implementar**

```sql
-- lockVentaOriginal: una columna más en el SELECT que ya corre bajo FOR UPDATE
SELECT venta_id, caja_id, moneda_id, canal, total_final, estado, tipo_documento_id,
       config_calculo
  FROM ventas
 WHERE venta_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL
 FOR UPDATE
```

```typescript
// y en el tipo de retorno
config_calculo: ConfigCalculo | null;
```

```typescript
// crearNotaCredito, después de lockVentaOriginal
// La NC corrige aquel documento: hereda su criterio, no el vigente (decisión g).
// Un null acá no es un caso histórico —después del reset toda venta tiene
// config— sino que algo se rompió aguas arriba: se falla ruidoso (decisión P5).
if (!original.config_calculo) {
  throw new BadRequestException(
    `La venta ${params.ventaOriginalId} no tiene config_calculo congelada: no se ` +
    `puede emitir una nota de crédito heredando su criterio de redondeo.`,
  );
}
const cfgOriginal = original.config_calculo;
```

```typescript
// :1010 — la línea, con el criterio heredado.
// El VALOR se cuantiza a la moneda; el string sigue formateándose a 4 decimales,
// que es la escala de la columna (venta_detalles.total_linea es NUMERIC(18,4)).
// modoToRounding ya está exportada por el motor (calculo-precios.engine.ts:207).
const totalLinea = new Decimal(linea.precioUnitario)
  .times(linea.cantidad)
  .toDecimalPlaces(cfgOriginal.decimalesMoneda, modoToRounding(cfgOriginal.modoRedondeo))
  .toFixed(4);
```

```typescript
// :990-1004 — la NC congela lo que heredó (decisión P4)
manager.create(Venta, {
  // … lo que ya había …
  configCalculo: cfgOriginal,
}),
```

Y actualizar lo que queda desmentido: el comentario de `ventas.service.ts:1738-1740` y el
de `VentaDetalleDrawer.vue:112-116` (los dos dicen que las NC tienen `config_calculo` en
`null`), más el `v-if` de `:845` que por eso las dejaba sin el bloque "Cómo se redondeó".

- [ ] **Step 4: Correr los tests**

```bash
./scripts/reset-db.sh
cd backend && npx jest --config test/jest-e2e.json test/ventas.e2e-spec.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ventas frontend/app/components/ventas backend/test
git commit -m "feat(redondeo): la nota de crédito redondea con el criterio de la venta que corrige, y lo congela"
```

---

## Fase 6 — Frontend

### Task 14: La máscara impide tipear de más, y el espejo se alinea

**Files:**
- Modify: `frontend/app/components/MoneyInput.vue`;
  `frontend/app/composables/useMonedaConversion.ts:19-23`
- Test: `frontend/tests/components/MoneyInput.spec.ts`,
  `frontend/tests/composables/useMonedaConversion.spec.ts`

**Interfaces:**
- Consumes: la validación del backend (Task 11) — la máscara existe para que la pantalla
  no ofrezca un monto que el backend va a rechazar.

- [ ] **Step 1: Escribir los tests que fallan**

```typescript
// MoneyInput.spec.ts
it('en una moneda sin decimales no deja tipear una coma decimal', async () => {
  const wrapper = mount(MoneyInput, {
    props: { modelValue: '', monedaId: 'clp-1' },   // decimales: 0
  });
  await wrapper.find('input').setValue('1000,5');
  expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe('1000');
});
```

```typescript
// useMonedaConversion.spec.ts
it('convierte con el modo de redondeo del tenant, igual que el backend', () => {
  const { convertir } = useMonedaConversion();
  expect(convertir('10.005', '1', { modoRedondeo: 'FLOOR', decimales: 2 })).toBe('10.00');
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd frontend && npm test -- MoneyInput.spec.ts useMonedaConversion.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

En `MoneyInput.vue`, la máscara ya recibe `decimales` de la moneda para formatear: usarla
también para **limitar la entrada** (maska con `fraction: decimales`, y `fraction: 0` sin
separador decimal).

En `useMonedaConversion.ts`, reemplazar el `toFixed(4)` por la conversión con el modo del
tenant y la escala que corresponda, y **corregir el comentario** *"Misma lógica que el
backend"*, que hoy es falso.

⚠️ **Enumerar los inputs de plata que NO pasan por `MoneyInput`** y llevarlos al
componente. Si alguno queda suelto, el backend lo rechaza y la pantalla no sabe por qué.

- [ ] **Step 4: Correr el gate del frontend**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app frontend/tests
git commit -m "feat(redondeo): la pantalla no deja tipear plata que la moneda no puede representar"
```

---

## Fase 7 — Cierre

### Task 15: Documentación viva, backlog y verificación final

**Files:**
- Modify: `docs/features/configuracion-monedas.md`, `docs/features/motor-calculo-precios.md`,
  `docs/features/preferencias-financieras.md`, `docs/features/impuestos.md`,
  `docs/features/reembolsos-nota-credito.md`, `docs/patterns/backend.md`,
  `docs/agent/anti-patterns.md`, `docs/ESTADO.md`, `docs/agent/pendientes.md`,
  `docs/agent/resueltos.md`

- [ ] **Step 1: Actualizar la documentación viva**

Contenido exacto por archivo: la tabla "Documentación viva" de la
[spec](../specs/2026-08-20-redondeo-de-plata-design.md). Lo que **no** puede faltar:

- `configuracion-monedas.md`: **`decimales` es el minor unit**, del que se deriva la
  presentación. Hoy la sección de formato (`:53`, `:63`) lo induce a leerse como dato de
  UI, y esa lectura es la que hay que cerrar.
- `preferencias-financieras.md`: además del campo nuevo, arrastra dos errores previos — el
  *"What is it"* enumera 3 campos cuando la pantalla tiene 6, y dice que el motor de
  precios está *"pendiente"* cuando existe desde junio.
- `impuestos.md`: que el IVA persistido puede diferir de `tasa × base`, **por dos razones
  distintas** — la elegida (decisión e, cerrar a góndola) y la diferida (decisión f, el
  descuento de venta no baja la base). Separadas, o alguien "arregla" la primera creyendo
  que persigue la segunda.
- `anti-patterns.md`: redondear dentro del bucle de reglas en vez de al cerrar (Vancouver),
  y cuantizar un total por su cuenta en vez de derivarlo de sus componentes.

- [ ] **Step 2: Cerrar la entrada del backlog**

Mover la entrada 🔴 de `pendientes.md` a `resueltos.md` con qué cubrió y qué quedó
diferido, y **abrir las entradas nuevas**: IVA vs descuento de nivel venta (decisión f), la
NC como documento, la denominación mínima de efectivo (decisión h), los ~30 DTOs con
`@IsNumberString` sin trazar.

⚠️ **Actualizar también `CLAUDE.md`**: la sección 🛑 nombra el redondeo de plata como el
frente abierto de la tanda 🔴. Al cerrarse, esa lista queda nombrando algo que ya no
existe — el mismo problema que el propio backlog documenta haber tenido dos veces.

- [ ] **Step 3: Correr el gate completo**

```bash
./scripts/reset-db.sh
cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
./scripts/reset-db.sh --verificar
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```
Expected: todo PASS. ⚠️ Verificar el **exit code**, no la última línea: `| tail` descarta el
status y el `&&` siguiente corre igual.

- [ ] **Step 4: Matar los mutantes**

Cada uno **revierte** al código anterior (no solo rompe), y el test indicado tiene que
fallar. Si alguno sobrevive, falta un test:

1. `totalLinea` cuantizado por su cuenta en vez de derivado de los componentes → el test de
   la identidad aditiva (Task 5).
2. El impuesto del desbruteo vuelve a `Q(tasa × base)` → el test de 993 (Task 8).
3. Sacar `cuantizar()` del cierre de línea y dejar que recorte Postgres → el test de CLP
   sin decimales (Task 5) y el e2e de la venta entera.
4. La NC lee el `modo_redondeo` vigente en vez del congelado → el test de herencia
   (Task 13).

⚠️ Tras revertir cada mutante, **verificar en los logs que el backend reinició**: el
watcher se come el revert y el fuente limpio no prueba que el proceso lo esté.

- [ ] **Step 5: Revisión independiente y commit**

Invocar `verify-feature` (paso 7: revisión por sub-agente de contexto fresco sobre el diff
completo). El pre-commit **exige el recibo** de esa revisión porque el diff toca services de
backend y `.vue` de `pages`/`components`.

```bash
git add docs CLAUDE.md
git commit -m "docs(redondeo): el frente queda cerrado y la documentación dice qué manda en cada escala"
```

---

## Verification

**Criterio de terminado** — todo esto en verde, ejecutado y no afirmado:

- [ ] Una venta en CLP con descuento no persiste **ningún** monto con decimales, en las
  cinco salidas de línea, los cinco totales y las trazas de reglas.
- [ ] **El vuelto de un pago en efectivo sobre esa venta queda entero** — es el caso medido
  (`pagos.vuelto = 994942.5000`) y el que prueba el argumento de cierre: lo que no pasa por
  el motor hereda enteros por construcción, sin tocar `pagos.service.ts`. La consulta que
  lo verifica:
  ```sql
  SELECT p.monto, p.vuelto FROM pagos p WHERE p.vuelto <> round(p.vuelto);
  ```
  debe devolver **0 filas** después de correr el e2e completo.
- [ ] `Σ totalLinea − dv + rv = totalFinal`, exacto, con reglas de nivel venta presentes.
- [ ] Góndola 993 → neto 834 + IVA 159 = **993**; y 995, 997, 1000 y 1990 siguen cerrando.
- [ ] `FLOOR`, `CEIL` y `HALF_UP` producen totales **distintos** sobre el mismo carrito —
  hoy el cast de Postgres los iguala.
- [ ] Las dos combinaciones prohibidas de la matriz devuelven 400.
- [ ] Los nueve tests de aceptación afirman el criterio nuevo.
- [ ] La NC hereda el modo congelado y congela el suyo.
- [ ] `./scripts/reset-db.sh --verificar` no reporta que la base se movió bajo la suite.
- [ ] Los cuatro mutantes mueren.

## Decisions / Open questions

**Decidido** (ver [decisiones](../specs/2026-08-20-redondeo-de-plata-decisiones.md),
[segunda ronda](../specs/2026-08-20-redondeo-de-plata-segunda-ronda.md) y la revisión de
la spec): la cuantización vive en el motor · `moneda.decimales` es el minor unit · el IVA
absorbe el residuo del desbruteo · el rechazo vive en el borde con decorador + pipe · el
webhook cuantiza y registra · la NC hereda y congela · máscara en el frontend ·
`montoTolerancia` va a la escala de la moneda.

**Abierto, no bloqueante:** si la combinación `nivel = documento` + moneda de 0 decimales
se rechaza con **400 duro** (lo que este plan implementa, Task 9) o con un aviso que el
admin pueda aceptar. Cambia una rama de validación y su test.

**Fuera de alcance, con entrada propia:** IVA vs descuento de nivel venta (decisión f) · la
NC como documento (desglose de IVA y cuadre cabecera↔líneas) · denominación mínima de
efectivo (decisión h) · los ~30 DTOs con `@IsNumberString` sin trazar · el guard de
NC-sobre-NC que no corre en el webhook · el signo del abono en `POST /pagos` · el rename de
`moneda.decimales` · la UF como moneda oficial.
