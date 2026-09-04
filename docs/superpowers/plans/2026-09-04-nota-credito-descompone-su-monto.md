# Plan: la nota de crédito descompone su monto

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan
> checkbox (`- [ ]`).

**Goal:** que una nota de crédito deje de ser un monto suelto y pase a ser un documento con
líneas, neto e IVA, componible en cualquier país de LatAm.

**Architecture:** la NC sigue creándose donde se crea hoy (`crearNotaCreditoEnTransaccion`), pero
sus líneas y totales pasan a derivarse: las devoluciones se valúan a lo que costaron en esa
boleta, el resto del monto se expresa en una o dos líneas de un ítem de sistema "Ajuste" (tipo
`servicio`, sin stock), y el IVA se deriva de los importes ya congelados de la venta que se
corrige. La aritmética vive en un módulo puro y testeable; el service solo lee, llama y escribe.

**Tech Stack:** NestJS + TypeORM (`db.transaccion` / `@InjectRepository`, ADR-020), Decimal.js,
PostgreSQL 15 con `synchronize`, Jest + supertest, Nuxt 4 + Nuxt UI.

**Spec:** [`../specs/2026-09-04-nota-credito-descompone-su-monto-design.md`](../specs/2026-09-04-nota-credito-descompone-su-monto-design.md)

## Global Constraints

Además de las invariantes de `CLAUDE.md`, para este frente en particular:

- **Materia fiscal: va solo.** No se toma ninguna otra tarea de arrastre en esta sesión
  (ADR-010, `CLAUDE.md` → *"Lo fiscal va solo"*).
- **Plata y porcentajes con `Decimal.js`**, nunca `number`. Porcentajes en decimal (`0.19`).
- **El motor de cálculo de precios se toca en UNA sola cosa**, ya autorizada por el owner:
  agregar `export` a `repartirProporcional` y al tipo `Cuantizador` (Tarea 1). Cualquier otro
  cambio en `calculo-precios.engine.ts` **detiene el plan** y se consulta.
- **Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`.**
- **Nunca una query por iteración.** Los tres reads que agrega la Tarea 4 son agregados
  set-based, uno por concepto.
- **`tenant_id` sale del token**, nunca del body.
- **`./scripts/reset-db.sh` ANTES de cada `test:e2e`** y `--verificar` DESPUÉS. No tocar un
  `.ts` del backend con el e2e corriendo.
- **Nunca `git commit --no-verify`.** El recibo de la revisión independiente se ata al diff
  staged.
- El gate completo de `CLAUDE.md` corre **entero** al cerrar, no un subset.

---

## Estructura de archivos

| Archivo | Qué hace |
|---|---|
| `backend/src/modules/calculo-precios/calculo-precios.engine.ts` | **Modificar:** `export` de `repartirProporcional` y del tipo `Cuantizador`. Nada más. |
| `backend/src/modules/promociones/promociones.evaluator.ts` | **Modificar:** docblock de `repartirDescuentoCombo` — por qué NO es intercambiable. |
| `backend/src/modules/items/entities/item.entity.ts` | **Modificar:** columna `es_ajuste_nota_credito` + índice único parcial por tenant. |
| `backend/src/modules/items/items.service.ts` | **Modificar:** `asegurarItemAjuste(manager, tenantId, itemId?)` find-or-create. |
| `backend/src/modules/tenants/tenants.service.ts` | **Modificar:** sembrar el ítem al crear el tenant (paso 6c). |
| `backend/src/modules/tenants/tenants.module.ts` | **Modificar:** importar `ItemsModule` (sin ciclo: `ItemsModule` no importa tenants). |
| `backend/src/modules/seeder/seeder.service.ts` | **Modificar:** ítem "Ajuste" del tenant demo con ID fijo `…440381`. |
| `backend/src/modules/ventas/nota-credito-composicion.ts` | **Crear:** la aritmética pura — tasa efectiva, descomposición, reparto afecto/exento. |
| `backend/src/modules/ventas/nota-credito-composicion.spec.ts` | **Crear:** unitarios de la aritmética. |
| `backend/src/modules/ventas/ventas.service.ts` | **Modificar:** valuación de devoluciones, rechazo 400, líneas, `ventas_impuestos`, totales derivados, skip de inventario. |
| `backend/test/nota-credito-composicion.e2e-spec.ts` | **Crear:** el camino de la app, punta a punta. |
| `frontend/app/components/ventas/VentaDetalleDrawer.vue` | **Modificar (si hace falta):** rótulos que asuman "venta" donde ahora se lee una NC. |
| `docs/features/reembolsos-nota-credito.md` | **Modificar:** cómo queda compuesta la NC. |
| `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/resueltos.md` | **Modificar:** cierre. |

---

## Tarea 1: exportar el reparto proporcional

**Files:**
- Modify: `backend/src/modules/calculo-precios/calculo-precios.engine.ts:452` y `:1540`
- Modify: `backend/src/modules/promociones/promociones.evaluator.ts:437-448` (docblock)

**Interfaces:**
- Produce: `export function repartirProporcional(monto: Decimal, pesos: Decimal[], cfg: ConfigCalculo, q: Cuantizador): Decimal[]` y `export type Cuantizador = (d: Decimal) => Decimal`.

⚠️ Este es **el único** cambio autorizado sobre el motor en todo el plan. Es un `export`, no un
cambio de comportamiento: si el diff toca una línea que no sea la firma o el docblock, se detiene.

- [ ] **Paso 1: agregar `export` al tipo y a la función**

En `calculo-precios.engine.ts:452`:

```ts
/** Cuantiza o no según el nivel de redondeo del tenant. Ver `calcularLinea`. */
export type Cuantizador = (d: Decimal) => Decimal;
```

En `calculo-precios.engine.ts:1540`:

```ts
export function repartirProporcional(
```

- [ ] **Paso 2: dejar escrito por qué se exporta y no se muda**

Agregar al final del docblock de `repartirProporcional`:

```
 *
 * **Exportada, no mudada** (owner, 2026-09-04). La usa también la nota de
 * crédito para repartir su ajuste entre las porciones afecta y exenta. Vive
 * acá y no en un módulo común porque el motor YA es el hogar de esta familia:
 * `ventas.service.ts` importa de este archivo `cuantizar`, `ConfigCalculo` y
 * `TrazaRegla`, y `cuantizar` no tiene ningún otro importador fuera del motor.
 * Sacar solo el reparto obligaría al módulo nuevo a importar `ConfigCalculo`
 * de vuelta: más cableado y dos hogares para lo mismo. La mudanza completa es
 * un frente propio del motor.
```

- [ ] **Paso 3: marcar en promociones que la copia NO es intercambiable**

El docblock de `repartirDescuentoCombo` dice hoy *"mismo idioma que `repartirProporcional` …
sin su paso de cuantización"*, y eso invita a unificarlas. Reemplazar esa frase por:

```
 * ⚠️ **NO es intercambiable con `repartirProporcional`** del motor de cálculo
 * de precios, aunque se parezcan. Además de no cuantizar, **desempata
 * distinto**: acá el resto se mide como parte fraccionaria (`f − floor(f)`) y
 * allá como resto contra la parte ya cuantizada (`|f − parte|`). Unificarlas
 * cambiaría el reparto de las promociones. Medido el 2026-09-04, al exportar
 * `repartirProporcional` para la nota de crédito.
```

- [ ] **Paso 4: verificar que el motor no se movió**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test -- calculo-precios promociones
```

Esperado: verde, y `git diff --stat` sobre el motor muestra **solo** las líneas del `export` y
los docblocks.

- [ ] **Paso 5: commit**

```bash
git add backend/src/modules/calculo-precios/calculo-precios.engine.ts backend/src/modules/promociones/promociones.evaluator.ts
git commit -m "refactor(precios): exportar repartirProporcional para la nota de crédito"
```

---

## Tarea 2: el ítem de sistema "Ajuste"

**Files:**
- Modify: `backend/src/modules/items/entities/item.entity.ts`
- Modify: `backend/src/modules/items/items.service.ts`
- Modify: `backend/src/modules/tenants/tenants.service.ts:314` (después de la caja virtual)
- Modify: `backend/src/modules/tenants/tenants.module.ts`
- Modify: `backend/src/modules/seeder/seeder.service.ts`
- Test: `backend/test/nota-credito-composicion.e2e-spec.ts` (se crea acá, crece en la Tarea 4)

**Interfaces:**
- Produce: `ItemsService.asegurarItemAjuste(manager: EntityManager, tenantId: string, itemId?: string): Promise<Item>` — find-or-create idempotente, devuelve el ítem marcado del tenant.
- Consume: nada de tareas anteriores.

- [ ] **Paso 1: escribir el test e2e que falla**

Crear `backend/test/nota-credito-composicion.e2e-spec.ts`. Seguir el patrón de
`backend/test/nota-credito-por-pais.e2e-spec.ts` para el bootstrap (app, token, DataSource).

```ts
it('cada tenant tiene exactamente un ítem "Ajuste", de tipo servicio y sin stock', async () => {
  const filas: { item_id: string; tipo: string; activo: boolean }[] = await ds.query(
    `SELECT i.item_id, i.tipo, i.activo
       FROM items i
      WHERE i.tenant_id = $1 AND i.es_ajuste_nota_credito = true
        AND i.eliminado_el IS NULL`,
    [TENANT_DEMO],
  );
  expect(filas).toHaveLength(1);
  expect(filas[0].tipo).toBe('servicio');
  expect(filas[0].activo).toBe(false);

  const producto: unknown[] = await ds.query(
    `SELECT 1 FROM item_producto WHERE item_id = $1`,
    [filas[0].item_id],
  );
  expect(producto).toHaveLength(0);
});

it('el ítem "Ajuste" no aparece en el catálogo del POS', async () => {
  const res = await request(app.getHttpServer())
    .get('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const nombres = (res.body.data ?? res.body).map((i: { nombre: string }) => i.nombre);
  expect(nombres).not.toContain('Ajuste');
});
```

⚠️ El segundo test asume la forma de respuesta de `GET /api/items`. **Abrir el controller y
ajustar el acceso al body antes de escribirlo** — no adivinar la envoltura.

- [ ] **Paso 2: correrlo y verlo fallar**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e -- nota-credito-composicion
```

Esperado: FAIL — la columna `es_ajuste_nota_credito` no existe.

- [ ] **Paso 3: la columna y el índice**

En `item.entity.ts`, junto a `clasificacionTributaria`:

```ts
/**
 * El ítem de sistema del que cuelga la línea de ajuste de una nota de crédito.
 * `venta_detalles.item_id` es NOT NULL, así que esa línea necesita colgar de
 * algún ítem, y tiene que ser un `servicio`: en este sistema solo
 * `tipo='producto'` tiene stock, y una línea de ajuste no repone nada.
 *
 * Se marca con columna y no por nombre —que es editable— igual que
 * `tipos_documento_tributario.es_nota_credito` y `garzones.es_placeholder`.
 */
@Column({ name: 'es_ajuste_nota_credito', default: false })
esAjusteNotaCredito: boolean;
```

Y el índice parcial en el decorador de clase, con el mismo criterio que
`uq_tipo_documento_nota_credito_pais`:

```ts
@Index('uq_item_ajuste_nc_tenant', ['tenantId'], {
  unique: true,
  where: `"es_ajuste_nota_credito" = true AND "eliminado_el" IS NULL`,
})
```

Con dos filas marcadas, cuál se usa dependería del orden que elija el planner.

- [ ] **Paso 4: el find-or-create en `ItemsService`**

```ts
/**
 * El ítem de sistema "Ajuste" del tenant, creándolo si no está. Se llama al
 * crear el tenant Y desde la transacción de la nota de crédito: ese segundo
 * llamado no es redundancia, es lo que impide que el webhook de reembolso
 * (decisión P3) pierda un evento ya consumado por un dato de configuración
 * faltante. Mismo patrón que `GarzonesService.asegurarMostrador`.
 *
 * `itemId` explícito solo lo usa el seeder, que necesita IDs fijos.
 */
async asegurarItemAjuste(
  manager: EntityManager,
  tenantId: string,
  itemId: string = randomUUID(),
): Promise<Item> {
  const existente = await manager.findOne(Item, {
    where: { tenantId, esAjusteNotaCredito: true, eliminadoEl: IsNull() },
  });
  if (existente) return existente;

  // La moneda oficial NO la elige el tenant: sale del país
  // (`tenant → provincia → país → moneda_oficial_id`). Misma cadena que usa
  // `crear` de ventas (`ventas.service.ts:372-385`) y que resuelve el tipo de
  // documento nota de crédito.
  const monedaRows: { moneda_oficial_id: string }[] = await manager.query(
    `SELECT p.moneda_oficial_id
       FROM tenants t
       JOIN provincia prov ON prov.provincia_id = t.provincia_id
            AND prov.eliminado_el IS NULL
       JOIN pais p ON p.pais_id = prov.pais_id AND p.eliminado_el IS NULL
      WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
    [tenantId],
  );
  const monedaId = monedaRows[0]?.moneda_oficial_id;
  if (!monedaId)
    throw new BadRequestException(
      'El tenant no tiene moneda oficial configurada: no se puede crear el ítem de ajuste',
    );

  const item = await manager.save(
    Item,
    manager.create(Item, {
      id: itemId,
      tenantId,
      monedaId,
      nombre: 'Ajuste',
      descripcion: 'Ítem de sistema: línea de ajuste de notas de crédito',
      precioBase: '0',
      precioIncluyeImpuesto: false,
      // Fuera del selector del POS, igual que la fila de nota de crédito en
      // `tipos_documento_tributario`.
      activo: false,
      tipo: 'servicio',
      // La línea escribe su propia clasificación (afecto|exento según la
      // porción); acá va 'afecto' para no dejar un NULL, que significaría
      // "no se vende".
      clasificacionTributaria: 'afecto',
      esAjusteNotaCredito: true,
    }),
  );
  // Todo `tipo='servicio'` tiene su fila de extensión — ver `create()`.
  await manager.query(
    `INSERT INTO item_servicio (item_id, duracion_estimada, requiere_cita)
     VALUES ($1, NULL, false)`,
    [item.id],
  );
  return item;
}
```

⚠️ **`monedaId` es NOT NULL en `items`.** Resolverla como ya lo hace el service para cualquier
ítem del tenant — abrir `create()` y copiar de ahí la resolución, no inventar una consulta nueva.

- [ ] **Paso 5: sembrarlo al crear el tenant**

En `tenants.service.ts`, después del paso 6 (caja virtual) y junto a `asegurarMostrador`:

```ts
// 6c. Ítem de sistema "Ajuste" (línea de las notas de crédito)
await this.itemsService.asegurarItemAjuste(manager, savedTenant.id);
```

Inyectar `ItemsService` en el constructor e importar `ItemsModule` en `tenants.module.ts`.
Verificado el 2026-09-04: **no hay ciclo** — `ItemsModule` importa `InventarioModule`,
`CatalogModule` y `MonedasModule`, y ninguno importa `TenantsModule`.

- [ ] **Paso 6: el seeder**

El seeder llama **al mismo find-or-create**, para que exista una sola forma de crear este
ítem, pasándole el ID fijo que exige la convención del seed:

```ts
await this.itemsService.asegurarItemAjuste(
  manager,
  TENANT_DEMO,
  '550e8400-e29b-41d4-a716-446655440381',
);
```

`…440381` es el siguiente libre: el último usado es `…440380`, la nota de crédito interna de
México. ⚠️ **Contar cuántos tenants siembra el seeder antes de escribir esto** — si es más de
uno, cada uno lleva el siguiente número libre, y hay que verificar que `SeederService` ya tenga
`ItemsService` inyectado (si no lo tiene, se inyecta; `SeederModule` no puede quedar con un
ciclo).

- [ ] **Paso 7: correr el e2e y verlo pasar**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e -- nota-credito-composicion && ./scripts/reset-db.sh --verificar
```

- [ ] **Paso 8: mutante — probar que el índice está vivo**

Insertar a mano una segunda fila marcada para el mismo tenant, **dentro de una transacción con
rollback garantizado** (patrón de `nota-credito-por-pais.e2e-spec.ts`: `ds.transaction` con
`throw` incondicional, y la aserción sobre el error capturado). Esperado: violación de
`uq_item_ajuste_nc_tenant`, y **cero** filas sobrantes después.

- [ ] **Paso 9: commit**

```bash
git add -A backend/src backend/test
git commit -m "feat(items): ítem de sistema Ajuste, del que cuelga la línea de la nota de crédito"
```

---

## Tarea 3: la aritmética, pura y testeada

**Files:**
- Create: `backend/src/modules/ventas/nota-credito-composicion.ts`
- Test: `backend/src/modules/ventas/nota-credito-composicion.spec.ts`

**Interfaces:**
- Consume: `repartirProporcional`, `cuantizar`, `ConfigCalculo`, `Cuantizador` (Tarea 1).
- Produce: `tasaEfectiva`, `descomponer`, `repartirAjuste` y los tipos `PorcionOriginal` /
  `ParteAjuste`, que consume la Tarea 4.

Nada de esto toca la base ni el service: entra `Decimal`, sale `Decimal`. Es lo que permite que
los ocho casos de la spec se prueben sin levantar Postgres.

- [ ] **Paso 1: escribir los tests que fallan**

En `nota-credito-composicion.spec.ts`. **Los valores tienen que discriminar**: nada de tasas 0
ni proporciones 50/50, que dejan pasar un mutante que cambie el orden o el divisor.

```ts
const CFG: ConfigCalculo = {
  formula: ['descuentos', 'recargos', 'impuestos'],
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  escalaCalculo: 4,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  decimalesMoneda: 0, // peso chileno: el caso que más residuo produce
  promosAcumulanDescuentos: false,
};
const q: Cuantizador = (d) => cuantizar(d, CFG);

describe('tasaEfectiva', () => {
  it('sale de los importes congelados, no del catálogo', () => {
    // 11.900 con 1.900 de IVA → neto 10.000 → 19%
    const porciones = [
      { clasificacion: 'afecto', total: '11900', impuesto: '1900' },
    ];
    expect(tasaEfectiva(porciones, 'afecto').toString()).toBe('0.19');
  });

  it('una porción exenta da tasa 0', () => {
    const porciones = [{ clasificacion: 'exento', total: '5000', impuesto: '0' }];
    expect(tasaEfectiva(porciones, 'exento').isZero()).toBe(true);
  });

  it('neto 0 no divide por cero', () => {
    const porciones = [{ clasificacion: 'afecto', total: '0', impuesto: '0' }];
    expect(tasaEfectiva(porciones, 'afecto').isZero()).toBe(true);
  });
});

describe('descomponer', () => {
  it('el impuesto sale por resta: neto + impuesto = bruto, exacto', () => {
    const { subtotal, impuesto } = descomponer(new Decimal('11900'), new Decimal('0.19'), q);
    expect(subtotal.toString()).toBe('10000');
    expect(impuesto.toString()).toBe('1900');
    expect(subtotal.plus(impuesto).toString()).toBe('11900');
  });

  it('cierra exacto aunque la división no cierre', () => {
    // 1.000 / 1,19 = 840,336… → neto 840, impuesto 160
    const { subtotal, impuesto } = descomponer(new Decimal('1000'), new Decimal('0.19'), q);
    expect(subtotal.plus(impuesto).toString()).toBe('1000');
  });

  it('tasa 0 deja todo en el neto', () => {
    const { subtotal, impuesto } = descomponer(new Decimal('5000'), new Decimal(0), q);
    expect(subtotal.toString()).toBe('5000');
    expect(impuesto.isZero()).toBe(true);
  });
});

describe('repartirAjuste', () => {
  it('reparte en la proporción del remanente, no de la venta original', () => {
    // Remanente: 7.000 afecto / 3.000 exento. Ajuste 1.000 → 700 / 300.
    const partes = repartirAjuste(
      new Decimal('1000'),
      [
        { clasificacion: 'afecto', peso: new Decimal('7000') },
        { clasificacion: 'exento', peso: new Decimal('3000') },
      ],
      CFG,
      q,
    );
    expect(partes.map((p) => [p.clasificacion, p.bruto.toString()])).toEqual([
      ['afecto', '700'],
      ['exento', '300'],
    ]);
  });

  it('el residuo va a la parte de mayor resto y la suma cierra', () => {
    // 1.001 sobre 7.000/3.000 → 700,7 y 300,3 → 701 / 300
    const partes = repartirAjuste(
      new Decimal('1001'),
      [
        { clasificacion: 'afecto', peso: new Decimal('7000') },
        { clasificacion: 'exento', peso: new Decimal('3000') },
      ],
      CFG,
      q,
    );
    const suma = partes.reduce((a, p) => a.plus(p.bruto), new Decimal(0));
    expect(suma.toString()).toBe('1001');
  });

  it('no devuelve líneas en cero', () => {
    // Un ajuste chico sobre una venta casi toda afecta: el balde exento
    // redondea a 0 y esa línea no se escribe.
    const partes = repartirAjuste(
      new Decimal('10'),
      [
        { clasificacion: 'afecto', peso: new Decimal('99000') },
        { clasificacion: 'exento', peso: new Decimal('1000') },
      ],
      CFG,
      q,
    );
    expect(partes).toHaveLength(1);
    expect(partes[0].clasificacion).toBe('afecto');
    expect(partes[0].bruto.toString()).toBe('10');
  });

  it('una venta toda afecta sale en una sola línea', () => {
    const partes = repartirAjuste(
      new Decimal('1000'),
      [
        { clasificacion: 'afecto', peso: new Decimal('10000') },
        { clasificacion: 'exento', peso: new Decimal('0') },
      ],
      CFG,
      q,
    );
    expect(partes).toHaveLength(1);
    expect(partes[0].bruto.toString()).toBe('1000');
  });
});
```

⚠️ Los números esperados de arriba están calculados a mano con `decimalesMoneda: 0`. **Correr
los tests antes de dar por buena cualquier constante**: si uno no da, es el número del test el
que se revisa contra la aritmética, no al revés — y si la aritmética es la que está mal, se
arregla ahí.

- [ ] **Paso 2: correrlos y verlos fallar**

```bash
cd backend && npm test -- nota-credito-composicion
```

Esperado: FAIL, el módulo no existe.

- [ ] **Paso 3: escribir el módulo**

```ts
import Decimal from 'decimal.js';
import {
  repartirProporcional,
  type ConfigCalculo,
  type Cuantizador,
} from '../calculo-precios/calculo-precios.engine';

const ZERO = new Decimal(0);

/** Lo que una porción (afecta o exenta) suma en un documento ya congelado. */
export interface PorcionOriginal {
  clasificacion: string; // 'afecto' | 'exento'
  total: string; // Σ total_linea (bruto)
  impuesto: string; // Σ impuesto_aplicado
}

export interface ParteAjuste {
  clasificacion: string;
  bruto: Decimal;
}

/**
 * La tasa que esa porción cobró EN ESA VENTA, derivada de sus importes
 * congelados. No se lee del catálogo: `item_impuestos` es por ítem, así que dos
 * líneas afectas de la misma venta pueden llevar impuestos distintos y no hay
 * "la tasa" que leer. La NC corrige aquel documento: hereda su criterio, no el
 * vigente (misma decisión que el redondeo heredado, decisión g).
 */
export function tasaEfectiva(
  porciones: PorcionOriginal[],
  clasificacion: string,
): Decimal {
  let impuesto = ZERO;
  let neto = ZERO;
  for (const p of porciones) {
    if (p.clasificacion !== clasificacion) continue;
    const imp = new Decimal(p.impuesto);
    impuesto = impuesto.plus(imp);
    neto = neto.plus(new Decimal(p.total).minus(imp));
  }
  return neto.isZero() ? ZERO : impuesto.dividedBy(neto);
}

/**
 * Parte un bruto en neto + impuesto. **El impuesto sale por RESTA**, no por
 * `tasa × neto`: es el mismo anclaje que usa el motor cuando el paso de
 * impuestos es el último que mueve plata, y es lo que garantiza
 * `neto + impuesto = bruto` exacto sin depender de que la división cierre.
 */
export function descomponer(
  bruto: Decimal,
  tasa: Decimal,
  q: Cuantizador,
): { subtotal: Decimal; impuesto: Decimal } {
  const subtotal = q(bruto.dividedBy(tasa.plus(1)));
  return { subtotal, impuesto: bruto.minus(subtotal) };
}

/**
 * Reparte el ajuste entre las porciones, en la proporción del REMANENTE (lo que
 * queda por devolver), y descarta las partes en cero: una línea de importe cero
 * es ruido en el documento y puede no ser válida al emitirlo.
 *
 * Usa `repartirProporcional` del motor —resto más grande, desempate por
 * posición— en vez de un criterio propio: es la tercera vez que este reparto
 * hace falta en el repo y no se inventa una cuarta regla de residuo.
 */
export function repartirAjuste(
  ajusteTotal: Decimal,
  pesos: { clasificacion: string; peso: Decimal }[],
  cfg: ConfigCalculo,
  q: Cuantizador,
): ParteAjuste[] {
  const partes = repartirProporcional(
    ajusteTotal,
    pesos.map((p) => p.peso),
    cfg,
    q,
  );
  return pesos
    .map((p, i) => ({ clasificacion: p.clasificacion, bruto: partes[i] }))
    .filter((p) => !p.bruto.isZero());
}
```

- [ ] **Paso 4: correrlos y verlos pasar**

```bash
cd backend && npm test -- nota-credito-composicion && npm run lint:check && npm run typecheck
```

- [ ] **Paso 5: mutantes — cada uno tiene que REVERTIR al código anterior, no solo romper**

Guardar copia del archivo antes de cada mutante y restaurar con `diff -q`, **nunca** con
`git checkout`.

| Mutante | Test que debe caer |
|---|---|
| `descomponer` devuelve `impuesto = q(bruto.times(tasa))` en vez de la resta | "cierra exacto aunque la división no cierre" |
| `repartirAjuste` no filtra las partes en cero | "no devuelve líneas en cero" |
| `tasaEfectiva` divide por `total` en vez de por `total − impuesto` | "sale de los importes congelados" |

Si un mutante **sobrevive**, sospechar del test antes que del código: probablemente el fixture
no discrimina.

- [ ] **Paso 6: commit**

```bash
git add backend/src/modules/ventas/nota-credito-composicion.ts backend/src/modules/ventas/nota-credito-composicion.spec.ts
git commit -m "feat(ventas): la aritmética de la nota de crédito, pura y testeada"
```

---

## Tarea 4: cablearla en la nota de crédito

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` — `crearNotaCreditoEnTransaccion`
  (`:1361`) y `validarDevolucionesReembolso` (`:1749`)
- Modify: `backend/test/nota-credito-composicion.e2e-spec.ts`
- Modify: `docs/features/reembolsos-nota-credito.md`

**Interfaces:**
- Consume: `asegurarItemAjuste` (Tarea 2); `tasaEfectiva` / `descomponer` / `repartirAjuste`
  (Tarea 3).

⚠️ **Esta tarea es indivisible.** Escribir la línea de ajuste sin saltear el movimiento de
inventario deja el reembolso **peor que hoy**: falla entero con 400. Los dos cambios entran
juntos o no entra ninguno.

- [ ] **Paso 1: escribir los e2e que fallan**

En `backend/test/nota-credito-composicion.e2e-spec.ts`, sobre una venta **mixta** creada por la
API (no por SQL: si el escenario necesita SQL directo, sospechar que ese estado es inalcanzable
y que el caso real quedó sin cubrir).

```ts
it('la NC de una venta mixta sale con dos líneas y sus totales derivados', async () => {
  // venta mixta ya creada y pagada arriba
  const res = await request(app.getHttpServer())
    .post(`/api/ventas/${ventaId}/notas-credito`)
    .set('Authorization', `Bearer ${token}`)
    .send({ monto: '1000', comentario: 'Cliente insatisfecho' })
    .expect(201);

  const nc = await request(app.getHttpServer())
    .get(`/api/ventas/${res.body.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  const d = nc.body.detalles;
  expect(d).toHaveLength(2);
  expect(d.map((l: { clasificacionTributaria: string }) => l.clasificacionTributaria).sort())
    .toEqual(['afecto', 'exento']);
  // La glosa que escribió el operador viaja a la línea.
  expect(d[0].descripcion).toBe('Cliente insatisfecho');

  const sumaLineas = d.reduce((a: Decimal, l: { totalLinea: string }) =>
    a.plus(l.totalLinea), new Decimal(0));
  expect(sumaLineas.toString()).toBe(new Decimal(nc.body.totalFinal).toString());
  expect(new Decimal(nc.body.totalImpuestos).gt(0)).toBe(true);
  expect(new Decimal(nc.body.baseVentasTotalFinal).eq(nc.body.totalFinal)).toBe(true);
});

it('devolver mercadería que vale más que la nota se rechaza', async () => {
  await request(app.getHttpServer())
    .post(`/api/ventas/${ventaId}/notas-credito`)
    .set('Authorization', `Bearer ${token}`)
    .send({ monto: '1', devoluciones: [{ itemId: ITEM_CARO, cantidad: '2' }] })
    .expect(400);
});

it('la línea de ajuste no dispara movimiento de inventario', async () => {
  // NC con devolución de 1 producto + ajuste por el resto
  const res = await request(app.getHttpServer()) /* … */;
  const movs: { item_id: string }[] = await ds.query(
    `SELECT item_id FROM movimientos_inventario
      WHERE venta_id = $1 AND eliminado_el IS NULL`,
    [res.body.id],
  );
  expect(movs).toHaveLength(1);
  expect(movs[0].item_id).toBe(ITEM_DEVUELTO);

  // Y las líneas —la devuelta y la de ajuste— suman el monto de la nota.
  const nc = await request(app.getHttpServer())
    .get(`/api/ventas/${res.body.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const suma = nc.body.detalles.reduce(
    (a: Decimal, l: { totalLinea: string }) => a.plus(l.totalLinea),
    new Decimal(0),
  );
  expect(suma.toString()).toBe(new Decimal(nc.body.totalFinal).toString());
});

it('con una NC previa, la proporción sale del remanente y no de la venta original', async () => {
  // Venta mixta con una porción exenta chica. Una primera NC se lleva casi todo
  // el balde exento; la segunda tiene que repartir sobre lo que QUEDA.
  // Este es el test que muere si alguien reparte sobre la venta entera.
  await emitirNC(ventaMixtaId, primerMonto);
  const segunda = await emitirNC(ventaMixtaId, segundoMonto);

  const nc = await request(app.getHttpServer())
    .get(`/api/ventas/${segunda.body.id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const exenta = nc.body.detalles.find(
    (l: { clasificacionTributaria: string }) => l.clasificacionTributaria === 'exento',
  );
  // Repartir sobre la venta original daría una parte exenta MAYOR.
  expect(exenta.totalLinea).toBe(EXENTO_ESPERADO);
});

it('sin el ítem "Ajuste", el reembolso no se pierde: se crea solo', async () => {
  // El camino del webhook (decisión P3) no puede fallar por configuración
  // faltante: la plata ya volvió por el proveedor.
  await ds.query(
    `UPDATE items SET eliminado_el = NOW()
      WHERE tenant_id = $1 AND es_ajuste_nota_credito = true`,
    [TENANT_DEMO],
  );
  const res = await request(app.getHttpServer())
    .post(`/api/ventas/${ventaId}/notas-credito`)
    .set('Authorization', `Bearer ${token}`)
    .send({ monto: '500' })
    .expect(201);
  expect(res.body.id).toBeDefined();
});
```

⚠️ El último test **borra una fila de la base compartida**. Va con la limpieza que lo deja como
estaba, o corre al final del archivo — y el `--verificar` de después no es opcional.

⚠️ **La ruta del POST y la forma del body salen del controller**, no de la memoria: abrir
`ventas.controller.ts:49` antes de escribir. Y **crear ítems y venta propios** para este spec —
no reusar los del seed que otros e2e comparten.

⚠️ `EXENTO_ESPERADO` es **un número calculado a mano** desde el fixture de esa venta, no una
desigualdad ni un valor leído del propio resultado: una referencia definida en función de lo
medido sale por identidad y no prueba nada. `emitirNC` es un helper local del spec.

⚠️ Los fixtures tienen que **discriminar**: una venta 50/50 con un ajuste que divide exacto pasa
igual con el reparto mal escrito. Que la proporción sea despareja y el monto no divida entero.

- [ ] **Paso 2: correrlos y verlos fallar**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e -- nota-credito-composicion
```

- [ ] **Paso 3: valuar la devolución a lo que costó, no al precio de lista**

`validarDevolucionesReembolso` ya lee las filas del ítem y agrega sus cantidades. Agregar a lo
que devuelve el **valor bruto por unidad**, calculado sobre esas mismas filas:

```ts
// Lo que esa unidad costó EN ESTA BOLETA, no el precio de lista: `total_linea`
// ya lleva adentro el descuento de línea, el recargo y la parte prorrateada del
// descuento de nivel venta (ver `venta-detalle.entity.ts:116`). Valuar al
// precio de lista acreditaría de más en toda venta con descuento.
const brutoDelItem = filas.reduce((a, f) => a.plus(f.total_linea), new Decimal(0));
const valorUnitarioBruto = vendida.isZero() ? ZERO : brutoDelItem.dividedBy(vendida);
```

`total_linea` no está en el `SELECT` de ese método: **agregarlo a la query existente**, no
abrir una segunda.

El otro llamador (`registrarDevolucionesPorReembolso`, `:1644`) ignora el campo nuevo — no
cambia de comportamiento.

- [ ] **Paso 4: leer la composición del original y de las NC previas, en UNA query**

Dentro de la transacción, después del lock:

```sql
SELECT (d.venta_id <> $1) AS es_nc,
       d.clasificacion_tributaria       AS clasificacion,
       COALESCE(SUM(d.total_linea), 0)::text      AS total,
       COALESCE(SUM(d.impuesto_aplicado), 0)::text AS impuesto
  FROM venta_detalles d
 WHERE d.eliminado_el IS NULL
   AND (d.venta_id = $1
        OR d.venta_id IN (SELECT venta_id FROM ventas
                           WHERE venta_referencia_id = $1
                             AND tipo_documento_id = $2
                             AND eliminado_el IS NULL))
 GROUP BY 1, 2
```

De ahí salen las dos cosas: la **tasa** por porción (de las filas del original) y el
**remanente** por porción (original − NC previas). Una NC vieja sin líneas aporta `0`: no
existe ese caso —no hay datos productivos— pero queda escrito para que no se lea como olvido.

- [ ] **Paso 5: componer las líneas y escribirlas**

Orden dentro de la transacción, después del tope contra `disponible`:

1. Valuar las devoluciones (paso 3) → `Σ valorDevuelto`.
2. `ajusteTotal = monto − Σ valorDevuelto`; si es negativo → `BadRequestException` con los dos
   números y la salida (la NC por su monto, y la vuelta a stock desde Inventario).
3. `repartirAjuste(ajusteTotal, remanentes, cfg, q)` si `ajusteTotal > 0`.
4. `asegurarItemAjuste(manager, tenantId)` **solo si hay parte de ajuste**.
5. Escribir las líneas: las de devolución con la clasificación y la unidad del detalle original;
   las de ajuste con `cantidad: '1'`, `descripcion: comentario ?? 'Ajuste'` y la clasificación
   de su porción. Todas con `descuentoAplicado`/`recargoAplicado`/`ajusteVenta` en `'0'`, y
   `subtotal` / `impuestoAplicado` de `descomponer`.
6. Las filas de `ventas_impuestos` (paso 6).
7. Los totales derivados (paso 7).

El cuantizador es siempre el de la escala de la moneda:

```ts
// Deliberadamente ignora `nivelRedondeo`: las líneas de una NC son plata
// efectivamente devuelta y tienen que sumar un `monto` que ya viene en escala
// de moneda. Es el mismo criterio que ya usaba el valor de línea de la NC.
const q: Cuantizador = cfgOriginal
  ? (d) => cuantizar(d, cfgOriginal)
  : (d) => d.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
```

Ese `else` es el fallback que ya existe para el camino del webhook sin `config_calculo`
congelada (decisión P3): no se pierde el evento.

**El movimiento de inventario corre solo sobre las líneas de devolución.** Escribirlo como
guard explícito, con el porqué:

```ts
// Solo las líneas de devolución van a inventario. La de ajuste cuelga de un
// `servicio` y `registrarMovimiento` rechaza con 400 todo lo que no sea
// producto (`inventario.service.ts:165`): sin este corte, agregar la línea de
// ajuste haría fallar el reembolso ENTERO.
```

- [ ] **Paso 6: las filas de `ventas_impuestos`**

Una query agregada sobre el original:

```sql
SELECT d.item_id,
       d.clasificacion_tributaria AS clasificacion,
       vi.impuesto_id, vi.nombre_regla, vi.porcentaje_aplicado,
       COALESCE(SUM(vi.valor_aplicado), 0)::text AS valor
  FROM ventas_impuestos vi
  JOIN venta_detalles d ON d.detalle_id = vi.detalle_id AND d.eliminado_el IS NULL
 WHERE vi.venta_id = $1 AND vi.eliminado_el IS NULL AND vi.aplicado_en = 'detalle'
 GROUP BY 1, 2, 3, 4, 5
```

Por cada línea de la NC con `impuesto_aplicado > 0`: una fila por impuesto distinto —los del
ítem para una línea de devolución, los de la porción para una de ajuste—, con `aplicado_en:
'detalle'` y `detalle_id` de la línea de la NC. El importe se reparte entre esos impuestos con
`repartirProporcional`, en la proporción que tenían en el original, para que la suma dé exacto.

Con **un solo impuesto** —el caso normal— esto es trivial. Dejar escrito en el docblock que con
dos impuestos repartidos entre líneas que no los comparten, el `porcentaje_aplicado` de la fila
describe la regla y no reproduce su propio importe: es el precio de derivar de hechos
congelados.

- [ ] **Paso 7: los totales derivados**

Reemplazar los hardcodeos de `:1428-1436`:

```ts
totalBruto: sumaSubtotales,      // el NETO, igual que en una venta normal (`:606`)
totalDescuentos: '0',
totalRecargos: '0',
totalImpuestos: sumaImpuestos,
totalFinal: params.monto,
baseVentasTotalFinal: params.monto,
baseVentasSinImpuestos: new Decimal(params.monto).minus(sumaImpuestos).toFixed(4),
```

⚠️ La cabecera se guarda **después** de componer las líneas, o los totales no existen todavía.
Si el orden actual lo impide, se guarda la cabecera y se actualiza con los totales en la misma
transacción — **no** se calculan dos veces.

- [ ] **Paso 8: correr el e2e y verlo pasar**

```bash
./scripts/reset-db.sh && cd backend && npm run test:e2e -- nota-credito-composicion && ./scripts/reset-db.sh --verificar
```

- [ ] **Paso 9: la suite entera, no un subset**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test
./scripts/reset-db.sh && cd backend && npm run test:e2e && ./scripts/reset-db.sh --verificar
```

Un DTO o un constructor tocado rompe specs lejanos: el subset no lo ve.

- [ ] **Paso 10: mutantes**

| Mutante | Test que debe caer |
|---|---|
| `totalImpuestos` vuelve a `'0'` | "totales derivados" |
| Repartir sobre la venta original en vez del remanente | el caso con NC previa |
| Sacar el guard de "solo productos" del loop de inventario | "no dispara movimiento" |
| Valuar la devolución a `precio_unitario` otra vez | el caso con descuento de línea |

⚠️ Después de revertir un mutante, **verificar la hora del restart en los logs del backend**: el
fuente limpio no prueba que el proceso lo esté.

- [ ] **Paso 11: documentación viva, en este mismo commit**

`docs/features/reembolsos-nota-credito.md`: reescribir la sección de backend con cómo queda
compuesta la NC (líneas, neto, IVA, totales derivados) y el rechazo por mercadería > monto.
**Reescribir**, no anexar una corrección al final.

- [ ] **Paso 12: revisión independiente y commit**

Lanzar `domain-reviewer` sobre el diff staged (N+1, soft delete, dinero-Decimal, alcance), atar
el recibo al diff exacto y commitear. El arreglo que pida la revisión **se vuelve a revisar**.

```bash
git add -A
git diff --cached | git hash-object --stdin > "$(git rev-parse --git-dir)/verify-feature.receipt"
git commit -m "feat(ventas): la nota de crédito descompone su monto en líneas, neto e IVA"
```

---

## Tarea 5: la pantalla y el cierre

**Files:**
- Modify (si hace falta): `frontend/app/components/ventas/VentaDetalleDrawer.vue`
- Modify: `docs/ESTADO.md`, `docs/agent/pendientes.md`, `docs/agent/resueltos.md`

**Interfaces:**
- Consume: la respuesta de `GET /ventas/:id` para una NC (Tarea 4).

- [ ] **Paso 1: mirarlo de verdad, en el navegador**

Con `docker-compose up` y la base **reseteada antes** (no después): crear una venta mixta,
emitir una NC con glosa, abrir su detalle en el drawer y mirar. El smoke test va por
**chrome-devtools** (la ventana real de Chrome), no por el navegador embebido.

Verificado el 2026-09-04 en el código: `filasDetalle` (`:479`) ya arma la tabla de líneas con
sus reglas congeladas y la fila "Impuestos" del total (`:887`) ya existe. **La expectativa es
que se vea solo.** Lo que se busca es lo que chirríe.

- [ ] **Paso 2: anotar lo que aparezca, antes de tocar nada**

Rótulos que digan "venta" donde ahora se lee una nota de crédito, columnas vacías, la glosa que
no se lee. Si aparece algo que pide más que un rótulo, **se anota y se decide** — no se agranda
el frente por dentro.

- [ ] **Paso 3: corregir los rótulos, con su test**

Solo lo anotado. Tokens semánticos de Nuxt UI, nunca Tailwind hardcodeado. Si se toca el
componente, el spec de pantalla acompaña — y **verificar que el body que afirma el mock pasaría
el DTO del backend**, o el test congela un caso imposible.

- [ ] **Paso 4: el gate del frontend**

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

- [ ] **Paso 5: cerrar la entrada del backlog**

Mover la entrada de `pendientes.md` § 3 a `resueltos.md` con el detalle del fix y los commits;
actualizar la fila de `docs/ESTADO.md`. **Listar todos los consumidores antes de redactar el
cierre**: el texto de la UI es uno más, y declarar cerrado lo que sigue vivo manda al próximo a
no buscarlo.

- [ ] **Paso 6: commit y push**

```bash
git add -A
git diff --cached | git hash-object --stdin > "$(git rev-parse --git-dir)/verify-feature.receipt"
git commit -m "feat(ventas): el detalle muestra la nota de crédito descompuesta"
git push
```

Después del push: **revisar el CI y además el deployment de Railway** — este diff toca
entidades, y un push a `main` despliega.
