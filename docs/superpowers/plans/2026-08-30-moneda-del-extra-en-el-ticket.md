# La moneda del extra en el ticket — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el monto de cada extra de personalización que se imprime en el ticket
salga convertido a la moneda oficial del tenant, producido en un solo lugar (el
backend), en vez de calcularse en el cliente en la moneda del ítem y formatearse con
la oficial.

**Architecture:** Hoy el detalle priceado de la personalización tiene **dos
productores**: `detallePersonalizacion` (backend, `personalizacion-receta.util.ts`)
que alimenta la cuenta de salón, y `detallePersonalizacionPreview` (frontend,
`useRecetaPersonalizacion.ts`) que alimenta el carrito del POS. Los dos hacen
`precioExtra × unidades` **sin convertir**. El plan deja un solo productor: el
backend convierte cada extra con `convertirAMonedaOficial` en los dos caminos que
producen ticket (`POST /ventas` y la lectura de la cuenta), el POS imprime el que
viene en la respuesta, y el preview del cliente queda **solo** para el drawer.

**Tech Stack:** NestJS + TypeORM + Decimal.js (backend), Nuxt 4 + Vue 3 + Vitest
(frontend), Jest + supertest (e2e de API).

**Spec:** [`docs/agent/pendientes.md`](../../agent/pendientes.md) § 3, última entrada
—*"El extra de una personalización se imprime con la moneda equivocada, y el ticket no
suma"*—, con las tres respuestas del owner del 2026-08-30 y su plan en cinco puntos.

---

## ✅ Ejecutado el 2026-08-30 (`3a2f1c92`, `98a36254`, `ae4694a5`, `2a3f4505`)

Gate completo en verde: backend `lint:check` 0 errores, `typecheck`, `test` (2386/2387) y
`test:e2e` **completo** (51 suites, 664 tests) con `reset-db.sh` antes y `--verificar` después;
frontend `build`, `test` (931), `typecheck:ratchet` y `design:check`. Cada commit con revisión
independiente `domain-reviewer` sobre su diff exacto.

**El 1 de 2387 en rojo es preexistente y no es de esta tarea:** el unitario de vigencia de
tokens afirma que 7 días son 168 horas y cruzando el cambio de hora son 167. Se reprodujo
idéntico en un worktree de `149d3bc3`, el commit anterior a este trabajo. Quedó anotado en
`pendientes.md` § 1.

**Tres desviaciones del plan, las tres por medición:**

1. **Las tareas 3 y 4 fueron un solo commit.** La 3 sola dejaba el campo del carrito muerto
   entre commits, y son la misma causa.
2. **El punto 5 asumía un preview que no existe.** El drawer nunca renderizó el detalle
   priceado —muestra el resumen de texto y el total—: lo calculaba **solo** para pasárselo al
   carrito. Al sacar el campo del carrito, `detallePersonalizacionPreview` quedó muerta entera,
   así que se borró con su spec en vez de dejarle un docblock describiendo un consumidor
   inexistente. Lo encontró la revisión independiente del frontend.
3. **La Tarea 2 necesitó mocks nuevos en `salones.service.spec.ts`**, que el plan no preveía:
   cambiar el constructor de un service rompe su unitario, y correr solo el e2e dirigido de esa
   tarea no lo mostró. Se arreglaron en el commit de cierre.

---

## Global Constraints

- **Dinero con Decimal.js**, nunca `number` nativo. La conversión se hace **siempre**
  con `CalculoPreciosService.convertirAMonedaOficial(precio, monedaId, tasaMap, modoRedondeo)`,
  nunca multiplicando a mano: es la única función que redondea con el `modo_redondeo`
  del tenant.
- **`tenant_id` sale del token**, nunca del body ni de la ruta.
- **Ninguna query por iteración (N+1).** Los nombres de ingredientes se resuelven en
  **una** query con `WHERE item_id = ANY($1)`, nunca una por línea.
- Toda `SELECT`/`JOIN` nueva filtra `eliminado_el IS NULL`.
- **No se toca el motor de cálculo.** Este plan llama a `convertirAMonedaOficial` para
  producir un número que se imprime; no cambia una fórmula, ni un paso, ni un valor
  persistido. Si al implementarlo aparece que hay que tocar el cálculo de verdad:
  **frenar y preguntar** (decisión del owner, 2026-08-30).
- **Nada nuevo que persistir.** `venta_detalles` ya congela `precio_unitario_origen`,
  `tasa_cambio`, `moneda_id_origen` y el snapshot completo: alcanza para reproducir el
  extra convertido de una venta vieja. Ninguna columna nueva, ninguna migración.
- **Cada extra se convierte por su cuenta.** Sin reparto por mayores restos: el ticket
  no imprime `precioBase`, así que el desglose de extras es transparencia sobre el
  P.UNIT que ya está arriba, no un sumando que el cliente pueda cerrar contra el papel.

## Medición previa (hecha el 2026-08-30, antes de escribir esto)

Lo que se verificó contra el código, y que el ejecutor puede dar por cierto:

| Afirmación de la entrada | Estado |
|---|---|
| Las tres páginas pasan `formatMonto` sin moneda ([pos.vue:277](../../../frontend/app/pages/ventas/pos.vue), [salones/index.vue:1159](../../../frontend/app/pages/salones/index.vue), [:1251](../../../frontend/app/pages/salones/index.vue)) | ✅ confirmado |
| `detallePersonalizacion` hace `precioExtra × unidades` sin convertir | ✅ confirmado (`personalizacion-receta.util.ts:95-103`) |
| `ventas.service.ts` convierte `precioUnitario` con `convertirAMonedaOficial` | ✅ confirmado (líneas 444-450) |
| `salones.service.ts:1540` produce el detalle al leer la cuenta | ✅ confirmado |
| El ticket no imprime `precioBase` (`ticket-builder.ts:245-251`) | ✅ confirmado |
| Ningún camino reimprime una venta pasada | ✅ confirmado: 3 call sites (`pos.vue:240`, `salones/index.vue:1139` y `:1234`), todos contra estado vivo |

⚠️ **Dos correcciones que la medición obligó, y que este plan ya incorpora:**

1. **El backend NO tiene los nombres de los ingredientes en el camino de la venta.**
   `detallePersonalizacion` necesita un `Map<itemId, nombre>`; el snapshot guarda
   `ingredienteItemId`, no el nombre. `SalonesService` resuelve eso con
   `nombresIngredientesPersonalizacion` (privado, una query batcheada);
   `VentasService` no tiene nada equivalente. La Tarea 1 lo agrega.

2. **El punto 4 apunta a una respuesta que el POS hoy ignora.** El ticket del POS se
   arma con `resultadoVenta = await asegurarVigente()`, que es la respuesta de
   **`POST /calculo-precios/calcular`** ([useCalculoPrecios.ts:126](../../../frontend/app/composables/useCalculoPrecios.ts)),
   no la de `POST /ventas` —que hoy se tipea como `{ estado, advertencias }` y cuyo
   `detalles` se descarta—. "Usa el de la respuesta" significa entonces: seguir
   sacando `precioUnitario`/`totalLinea` de `resultadoVenta`, y sacar **solo** el
   detalle de `venta.detalles[i]`. El cruce por índice ya es carga estructural del
   código (`ventas.service.ts:537-539` y `:592`), no se está inventando acá.

📌 **Hallazgo fuera de alcance, medido en la misma pasada.** Para una línea con extras
pagos, POS y salones mandan `precioUnitario` como override **sin convertir**
(`useVenta.ts:213`, `useSalones.ts:235-237`) y el motor usa el override tal cual
(`calculo-precios.service.ts:591-598`, fijado por dos tests contiguos en
`calculo-precios.service.spec.ts:202` y `:209`). O sea que en un ítem en moneda no
oficial el P.UNIT del ticket **tampoco** está convertido, y `POST /ventas` registra un
total distinto del que el POS cobró. **El owner decidió el 2026-08-30 no ampliar el
frente**: este plan hace los cinco puntos y el hallazgo queda anotado en el backlog
(Tarea 5). No intentar arreglarlo acá.

---

### Task 1: El detalle de una venta sale convertido desde `POST /ventas`

**Files:**
- Modify: `backend/src/modules/ventas/ventas.service.ts` (imports; método privado
  nuevo; armado de la respuesta en `crearEnTransaccion`, hoy `return` en `:921`)
- Test: `backend/test/recetas.e2e-spec.ts` (test nuevo al final del archivo)

**Interfaces:**
- Consumes: `detallePersonalizacion(snapshot, nombres)` y el tipo
  `PersonalizacionDetalleLinea` de `../../common/utils/personalizacion-receta.util`;
  `this.calculoPreciosService.convertirAMonedaOficial(precio, monedaId, tasaMap, modoRedondeo)`.
- Produces: la respuesta de `POST /ventas` gana, por cada elemento de `detalles`, un
  campo opcional `personalizacionDetalle: { nombre: string; tipo: 'omitido' | 'extra';
  unidades?: number; monto: string }[]`. Solo aparece cuando la línea tiene
  personalización; `monto` viene con 4 decimales (`ESCALA_PERSISTIDA`) y **en moneda
  oficial**. La Tarea 3 lo consume.

- [x] **Step 1: Escribir el test e2e que falla**

En `backend/test/recetas.e2e-spec.ts`, agregar al principio del archivo (junto a las
otras constantes de id):

```ts
// USD: habilitada para Paris con valor_del_dia '950' (`seedTenantMonedas`). Es la
// única moneda con tasa != 1 del seed además de UF, y 950 separa a años luz un
// monto convertido de uno sin convertir.
const USD_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440005';
```

Y un `it` nuevo **dentro del describe de arriba de todo** (`'Recetas — flujo completo
(e2e)'`, `:156`), que ya tiene `app`, `token` y su `beforeAll`/`afterAll`. **No crear
un `describe` con su propia app**: el archivo levanta una sola y así queda.

```ts
  it('el monto de un extra en USD sale multiplicado por la tasa, no crudo', async () => {
    const sufijo = Date.now();

    // Ingrediente base de la receta y el ingrediente que se cobra como extra.
    // Los dos en USD: lo que importa es la moneda del ÍTEM de la receta, pero
    // dejarlos en la misma moneda evita mezclar dos causas en un solo test.
    const crearProducto = async (nombre: string, precio: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre,
          precioBase: precio,
          monedaId: USD_MONEDA_ID,
          tipo: 'producto',
          clasificacionTributaria: 'afecto',
          unidadMedida: 'unidad',
          stock: '100',
        });
      expect(res.status).toBe(201);
      return (res.body as { id: string }).id;
    };

    const panId = await crearProducto(`Pan extra-moneda ${sufijo}`, '1');
    const quesoId = await crearProducto(`Queso extra-moneda ${sufijo}`, '1');

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa extra-moneda ${sufijo}`,
        precioBase: '10',
        monedaId: USD_MONEDA_ID,
        tipo: 'receta',
        clasificacionTributaria: 'afecto',
        ingredientes: [
          {
            ingredienteItemId: panId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
        extrasPermitidos: [
          {
            ingredienteItemId: quesoId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            precioExtra: '1',
          },
        ],
      });
    expect(resReceta.status).toBe(201);
    const recetaId = (resReceta.body as { id: string }).id;

    // 10 USD (base) + 1 USD (extra) = 11 USD -> x950 = 10.450 CLP + 19% IVA = 12.435,5
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: recetaId,
            cantidad: '1',
            personalizacion: {
              omitidos: [],
              extras: [{ ingredienteItemId: quesoId, unidades: 1 }],
            },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '12435.5000' }],
      });
    expect(resVenta.status).toBe(201);

    const detalle = (
      resVenta.body as {
        detalles: {
          personalizacionDetalle?: {
            nombre: string;
            tipo: string;
            monto: string;
          }[];
        }[];
      }
    ).detalles[0];

    const extra = detalle.personalizacionDetalle?.find((d) => d.tipo === 'extra');
    // 1 USD x 950 = 950. Sin convertir daría '1', que es la conducta de hoy:
    // tres órdenes de magnitud de distancia, no un tema de redondeo.
    expect(extra?.monto).toBe('950.0000');
    expect(extra?.nombre).toBe(`Queso extra-moneda ${sufijo}`);
  });
```

⚠️ Antes de correrlo: `./scripts/reset-db.sh` (~30s). El e2e no se corre con el
watcher del backend recompilando — no tocar ningún `.ts` del backend mientras corre.

- [x] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npm run test:e2e -- recetas.e2e-spec.ts -t "el monto de un extra en USD"`
Expected: FAIL. `extra` es `undefined` (el campo `personalizacionDetalle` todavía no
existe en la respuesta), así que la aserción rompe en `expect(undefined).toBe('950.0000')`.

- [x] **Step 3: Agregar el resolvedor batcheado de nombres**

En `backend/src/modules/ventas/ventas.service.ts`, agregar el import:

```ts
import {
  detallePersonalizacion,
  type PersonalizacionRecetaSnapshot,
} from '../../common/utils/personalizacion-receta.util';
```

(si `PersonalizacionRecetaSnapshot` ya está importado en el archivo, no duplicarlo)

y un método privado nuevo, junto a los otros privados de la clase:

```ts
/**
 * Nombres de los ingredientes que aparecen en las personalizaciones de estas
 * líneas, en UNA query. El snapshot guarda ids, no nombres, y el detalle
 * priceado del ticket los necesita.
 *
 * Gemelo deliberado de `SalonesService.nombresIngredientesPersonalizacion`:
 * son los dos caminos que producen ticket, y comparten la regla de que el
 * nombre se resuelve en batch, nunca uno por línea. Si aparece un tercero,
 * se extrae.
 */
private async nombresIngredientesPersonalizacion(
  manager: EntityManager,
  tenantId: string,
  filas: { personalizacion: PersonalizacionRecetaSnapshot | null }[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const fila of filas) {
    const p = fila.personalizacion;
    if (!p) continue;
    for (const id of p.omitidos ?? []) ids.add(id);
    for (const e of p.extras ?? []) ids.add(e.ingredienteItemId);
  }
  if (ids.size === 0) return new Map();
  const filasNombre: { item_id: string; nombre: string }[] = await manager.query(
    `SELECT item_id, nombre FROM items
       WHERE item_id = ANY($1) AND tenant_id = $2 AND eliminado_el IS NULL`,
    [[...ids], tenantId],
  );
  return new Map(filasNombre.map((r) => [r.item_id, r.nombre]));
}
```

- [x] **Step 4: Convertir el detalle y devolverlo**

En `crearEnTransaccion`, reemplazar el `return` final (hoy
`return { ...venta, detalles, advertencias };`, línea ~921) por:

```ts
    // Detalle priceado de la personalización, con cada extra YA convertido a
    // moneda oficial. Es el único productor: el POS lo imprime desde acá en vez
    // de recalcularlo en el cliente, que era donde el monto salía en la moneda
    // del ítem y después se formateaba con la oficial.
    //
    // Cada extra se convierte POR SU CUENTA, sin reparto por mayores restos: el
    // ticket no imprime `precioBase`, así que este desglose es transparencia
    // sobre el P.UNIT que ya está arriba, no un sumando que alguien pueda cerrar
    // contra el papel. Si algún día se imprime la base, esto se reabre.
    const nombresPersonalizacion = await this.nombresIngredientesPersonalizacion(
      manager,
      tenantId,
      detalles,
    );
    const detallesRespuesta = detalles.map((detalle, i) => {
      const lineas = detallePersonalizacion(
        detalle.personalizacion,
        nombresPersonalizacion,
      );
      if (lineas.length === 0) return detalle;
      const monedaOrigen = lineasConversion[i].item.monedaId;
      return {
        ...detalle,
        personalizacionDetalle: lineas.map((linea) => ({
          ...linea,
          monto: this.calculoPreciosService.convertirAMonedaOficial(
            linea.monto,
            monedaOrigen,
            tasaMap,
            configCalculo.modoRedondeo,
          ),
        })),
      };
    });

    return { ...venta, detalles: detallesRespuesta, advertencias };
```

⚠️ **No tocar la variable `detalles`**: `detalles[i].id` se usa más arriba (línea
~601) para atar las reglas aplicadas a su línea. Lo que cambia es lo que se
devuelve, no lo que se guardó.

- [x] **Step 5: Correr el test y verificar que pasa**

Run: `cd backend && npm run test:e2e -- recetas.e2e-spec.ts -t "el monto de un extra en USD"`
Expected: PASS

- [x] **Step 6: Verificar que el test cazaría el bug (mutante)**

Sacar la conversión, dejando `monto: linea.monto`. Correr el test: tiene que dar
FAIL con `'1'` en vez de `'950.0000'`. Revertir el mutante y **confirmar en los logs
del contenedor que el backend reinició** antes de seguir (`docker logs --tail 5
tecnica_backend`): el watcher recompila, y el fuente limpio no prueba que el proceso
lo esté.

- [x] **Step 7: Actualizar la doc y commitear**

En `docs/features/personalizacion-recetas.md`, en la sección del detalle priceado,
agregar:

```markdown
El **monto de cada extra viaja convertido a la moneda oficial del tenant**, producido
en el backend (`POST /ventas` y la lectura de la cuenta de salón). El ticket lo
imprime con el formateador de la moneda oficial, igual que el P.UNIT de la línea, así
que los dos números hablan la misma moneda. Cada extra se convierte por su cuenta: el
ticket no imprime `precioBase`, así que el desglose es transparencia sobre el P.UNIT,
no un sumando que cierre contra el papel.
```

```bash
git add backend/src/modules/ventas/ventas.service.ts backend/test/recetas.e2e-spec.ts docs/features/personalizacion-recetas.md
git commit -m "feat(ventas): el detalle de personalización sale convertido a moneda oficial"
```

---

### Task 2: La cuenta de salón lee el detalle convertido

**Files:**
- Modify: `backend/src/modules/salones/salones.service.ts` (constructor;
  `detalleCuenta` ~`:1455-1508`; `mapearDetalle` ~`:1511`; el `detallePersonalizacion`
  de `:1540`)
- Modify: `backend/src/modules/salones/salones.module.ts` (import de `CalculoPreciosModule`)
- Test: `backend/test/recetas.e2e-spec.ts` (test nuevo en el `describe` de la Tarea 1)

**Interfaces:**
- Consumes: `MonedasService.findMonedas(tenantId)` → `{ monedaId, decimales, esOficial,
  valorDelDia }[]` (la oficial ya viene forzada a `valorDelDia: '1'`);
  `CalculoPreciosService.cargarConfig(tenantId, decimalesMoneda)` → `{ modoRedondeo, ... }`;
  `CalculoPreciosService.convertirAMonedaOficial(...)`.
- Produces: `CuentaDetalle.lineas[].personalizacionDetalle[].monto` pasa a estar en
  moneda oficial. El contrato del campo no cambia (mismo nombre, mismo tipo): lo que
  cambia es la moneda del número. El frontend de salones no necesita cambios.

- [x] **Step 1: Escribir el test e2e que falla**

Primero, **subir cuatro constantes de scope**: `MESA_4_ID`, `BRUNO_PIN`, `BRUNO_ID` y
`TURNO_MANANA_ID` están declaradas dentro del describe anidado del test 12
(`:849-864`, con su comentario largo de por qué Bruno y no Ana ni Carla). Moverlas
—con su comentario— al describe de arriba de todo, junto a `app`/`token`. El test 12
las sigue viendo por scope; no se duplican.

Después, en el mismo describe de arriba de todo, al lado del `it` de la Tarea 1:

```ts
  it('la cuenta de salón devuelve el extra en USD ya convertido', async () => {
  const sufijo = Date.now();

  const crearProducto = async (nombre: string, precio: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre,
        precioBase: precio,
        monedaId: USD_MONEDA_ID,
        tipo: 'producto',
        clasificacionTributaria: 'afecto',
        unidadMedida: 'unidad',
        stock: '100',
      });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  };

  const panId = await crearProducto(`Pan cuenta-moneda ${sufijo}`, '1');
  const quesoId = await crearProducto(`Queso cuenta-moneda ${sufijo}`, '1');

  const resReceta = await request(app.getHttpServer())
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: `Hamburguesa cuenta-moneda ${sufijo}`,
      precioBase: '10',
      monedaId: USD_MONEDA_ID,
      tipo: 'receta',
      clasificacionTributaria: 'afecto',
      ingredientes: [
        {
          ingredienteItemId: panId,
          cantidad: '1',
          unidadCodigo: 'unidad',
          bloqueante: true,
        },
      ],
      extrasPermitidos: [
        {
          ingredienteItemId: quesoId,
          cantidad: '1',
          unidadCodigo: 'unidad',
          precioExtra: '1',
        },
      ],
    });
  expect(resReceta.status).toBe(201);
  const recetaId = (resReceta.body as { id: string }).id;

  // Bruno, no Ana: la sesión es única por garzón y varias specs comparten a Ana.
  await request(app.getHttpServer())
    .post('/api/sesiones-garzon/cerrar')
    .set('Authorization', `Bearer ${token}`)
    .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
  await request(app.getHttpServer())
    .post('/api/sesiones-garzon/iniciar')
    .set('Authorization', `Bearer ${token}`)
    .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN, turnoId: TURNO_MANANA_ID });

  const resCuenta = await request(app.getHttpServer())
    .post(`/api/mesas/${MESA_4_ID}/cuentas`)
    .set('Authorization', `Bearer ${token}`)
    .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
  expect(resCuenta.status).toBe(201);
  const cuentaId = (resCuenta.body as { id: string }).id;

  const resLinea = await request(app.getHttpServer())
    .post(`/api/cuentas/${cuentaId}/lineas`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      itemId: recetaId,
      cantidad: '1',
      personalizacion: {
        omitidos: [],
        extras: [{ ingredienteItemId: quesoId, unidades: 1 }],
      },
    });
  expect(resLinea.status).toBe(201);

  const cuenta = resLinea.body as {
    lineas: {
      personalizacionDetalle?: { tipo: string; monto: string }[];
    }[];
  };
  const extra = cuenta.lineas[0].personalizacionDetalle?.find(
    (d) => d.tipo === 'extra',
  );
  expect(extra?.monto).toBe('950.0000');

  // `cancelar` no lleva body: el test 12 lo llama solo con el header de auth.
  await request(app.getHttpServer())
    .post(`/api/cuentas/${cuentaId}/cancelar`)
    .set('Authorization', `Bearer ${token}`);
  await request(app.getHttpServer())
    .post('/api/sesiones-garzon/cerrar')
    .set('Authorization', `Bearer ${token}`)
    .send({ garzonId: BRUNO_ID, pin: BRUNO_PIN });
  });
```

⚠️ **Dejar la cuenta cancelada y la sesión cerrada al final es obligatorio**: la sesión
de un garzón es única, el test 12 usa el mismo Bruno y la misma mesa, y una sesión
viva al terminar hace fallar corridas locales repetidas.

- [x] **Step 2: Correr el test y verificar que falla**

Run: `cd backend && npm run test:e2e -- recetas.e2e-spec.ts -t "la cuenta de salón devuelve el extra"`
Expected: FAIL con `Expected: "950.0000" / Received: "1"` — el detalle se produce, pero
sin convertir.

- [x] **Step 3: Inyectar las dependencias en `SalonesService`**

En `backend/src/modules/salones/salones.module.ts`, agregar el import:

```ts
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
```

y `CalculoPreciosModule` al array `imports` (`MonedasModule` ya está importado).

En `backend/src/modules/salones/salones.service.ts`, agregar al constructor:

```ts
    private readonly monedasService: MonedasService,
    private readonly calculoPreciosService: CalculoPreciosService,
```

con sus imports correspondientes.

- [x] **Step 4: Convertir cada extra al leer la cuenta**

En `detalleCuenta`, después de resolver `nombres` y antes del `return cuentas.map(...)`:

```ts
    // Conversión del detalle priceado de la personalización a moneda oficial.
    // Se carga SOLO si alguna línea tiene extras: `detalleCuenta` corre cada vez
    // que se abre o refresca una cuenta, y la enorme mayoría no tiene ninguno.
    // Son dos consultas por request cuando hace falta, nunca una por línea.
    const hayExtras = lineas.some((l) => (l.personalizacion?.extras?.length ?? 0) > 0);
    let convertir = (monto: string, _monedaId: string) => monto;
    if (hayExtras) {
      const monedas = await this.monedasService.findMonedas(tenantId);
      const tasaMap = new Map(
        monedas.map((m) => [m.monedaId, m.valorDelDia ?? '1']),
      );
      const oficial = monedas.find((m) => m.esOficial);
      if (!oficial) {
        throw new BadRequestException(
          'El tenant no tiene moneda oficial configurada',
        );
      }
      const config = await this.calculoPreciosService.cargarConfig(
        tenantId,
        oficial.decimales,
      );
      convertir = (monto, monedaId) =>
        this.calculoPreciosService.convertirAMonedaOficial(
          monto,
          monedaId,
          tasaMap,
          config.modoRedondeo,
        );
    }

    return cuentas.map((cuenta) =>
      this.mapearDetalle(
        cuenta,
        porCuenta.get(cuenta.id) ?? [],
        nombresGarzon,
        nombres,
        convertir,
      ),
    );
```

ℹ️ **No hace falta pasarles el `runner`, y no es un olvido.** `detalleCuenta` corre
dentro de la transacción de `agregarLinea`, así que la pregunta es legítima — pero
`findMonedas` y `getPreferenciasFinancieras` llegan a la base por `Db.query` y por un
repo inyectado, y los dos resuelven el manager de la transacción activa vía
`TxContext` (ADR-020). No se toma una segunda conexión del pool y no se reabre el
deadlock. El `runner` explícito de `nombresIngredientesPersonalizacion` es anterior a
ese mecanismo.

En `mapearDetalle`, agregar el parámetro y usarlo:

```ts
  private mapearDetalle(
    cuenta: Cuenta,
    lineas: LineaDetalleRow[],
    nombresGarzon: Record<string, string>,
    nombres: Map<string, string>,
    convertir: (monto: string, monedaId: string) => string,
  ): CuentaDetalle {
```

y en el armado de la línea (hoy `:1540`):

```ts
        // Cada extra convertido POR SU CUENTA a moneda oficial: el ticket lo
        // imprime al lado del P.UNIT, que también está convertido, y los dos
        // se formatean con la misma moneda.
        const personalizacionDetalle = detallePersonalizacion(
          l.personalizacion,
          nombres,
        ).map((linea) => ({
          ...linea,
          monto: convertir(linea.monto, l.moneda_id),
        }));
```

- [x] **Step 5: Correr el test y verificar que pasa**

Run: `cd backend && npm run test:e2e -- recetas.e2e-spec.ts -t "la cuenta de salón devuelve el extra"`
Expected: PASS

- [x] **Step 6: Verificar que no se rompió la comanda ni la cuenta en CLP**

Run: `cd backend && npm run test:e2e -- salones-comanda.e2e-spec.ts combos.e2e-spec.ts vigencia-cuenta.e2e-spec.ts`
Expected: PASS. Con la moneda oficial la tasa es `1`, así que el monto solo gana
decimales (`'1000'` → `'1000.0000'`); si alguna aserción comparaba el string exacto,
ese es el lugar donde salta.

- [x] **Step 7: Commitear**

```bash
git add backend/src/modules/salones/salones.service.ts backend/src/modules/salones/salones.module.ts backend/test/recetas.e2e-spec.ts
git commit -m "feat(salones): la cuenta devuelve el extra de personalización convertido"
```

---

### Task 3: El POS imprime el detalle que devuelve la venta

**Files:**
- Modify: `frontend/app/pages/ventas/pos.vue` (`:226` el tipo de la respuesta,
  `:249-267` el armado de los items del ticket)

**Interfaces:**
- Consumes: `venta.detalles[i].personalizacionDetalle` y
  `venta.detalles[i].personalizacion?.comentario` de la Tarea 1.
- Produces: nada nuevo. `lineasVenta[i].personalizacionDetalle` deja de leerse (la
  Tarea 4 lo saca del carrito).

- [x] **Step 1: Tipar la respuesta de `POST /ventas`**

En `pos.vue`, reemplazar:

```ts
    const venta = await useApiFetch<{ estado: string; advertencias?: string[] }>(`${apiUrl}/ventas`, {
```

por:

```ts
    // `detalles` viene en el mismo orden que `body.lineas` —y que `lineasVenta`—:
    // el backend arma las filas desde `resultado.lineas`, que respeta el orden del
    // DTO (`ventas.service.ts:537-539`). Es el mismo cruce por índice que ya usa
    // para atar las reglas a su línea.
    const venta = await useApiFetch<{
      estado: string
      advertencias?: string[]
      detalles: {
        personalizacion?: { comentario?: string } | null
        personalizacionDetalle?: PersonalizacionDetalleLinea[]
      }[]
    }>(`${apiUrl}/ventas`, {
```

- [x] **Step 2: Imprimir el detalle de la respuesta, no el del carrito**

En el `items:` del `imprimirBoleta`, reemplazar el bloque:

```ts
              ...(ln?.personalizacionDetalle
                ? { personalizacionDetalle: ln.personalizacionDetalle, comentario: ln.personalizacion?.comentario }
                : ln?.personalizacionResumen ? { nota: ln.personalizacionResumen } : {}),
```

por:

```ts
              // El detalle sale de la VENTA, no del carrito: el backend es el
              // único que lo produce y el único que lo convierte a moneda
              // oficial. El carrito lo calculaba en la moneda del ítem y el
              // ticket lo formateaba con la oficial, que era el bug.
              ...(vd?.personalizacionDetalle
                ? { personalizacionDetalle: vd.personalizacionDetalle, comentario: vd.personalizacion?.comentario }
                : ln?.personalizacionResumen ? { nota: ln.personalizacionResumen } : {}),
```

y agregar, junto a `const ln = lineasVenta[i]`:

```ts
            const vd = venta.detalles[i]
```

⚠️ `ln` **sigue usándose** para el nombre y la cantidad (`ln?.item.nombre`,
`unidadBaseItem(ln.item)`): no borrarlo.

- [x] **Step 3: Verificar tipos y build**

Run: `cd frontend && npm run typecheck:ratchet && npm run build`
Expected: PASS, sin nuevos errores en el ratchet.

- [x] **Step 4: Smoke test en el navegador**

El ticket del POS no tiene test unitario: `build` y `typecheck` no ven un auto-import
roto ni un índice corrido. Con `docker-compose up`, en el POS: agregar una receta,
personalizarla con un extra pago, cobrar, y mirar el ticket generado. El extra tiene
que imprimirse con el mismo símbolo y separadores que el P.UNIT de su línea.

- [x] **Step 5: Commitear**

```bash
git add frontend/app/pages/ventas/pos.vue
git commit -m "fix(pos): el ticket imprime el detalle de personalización que devuelve la venta"
```

---

### Task 4: El carrito deja de cargar el detalle; el preview queda solo para el drawer

**Files:**
- Modify: `frontend/app/composables/useVenta.ts` (`:47`, `:101-114`, `:163`, `:423-435`)
- Modify: `frontend/app/components/ventas/ItemPersonalizacionDrawer.vue` (`:318-325`
  el emit, y la declaración de `defineEmits`)
- Modify: `frontend/app/composables/useRecetaPersonalizacion.ts` (`:229-232` el docblock)
- Modify: `frontend/app/pages/ventas/pos.vue` (`onRecetaConfirm`)
- Test: `frontend/app/composables/useVenta.spec.ts` (`:503-534`, dos tests que se van)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `CarritoLinea` pierde `personalizacionDetalle`; `agregarLinea` y el
  `confirm` del drawer pierden su último parámetro. `detallePersonalizacionPreview`
  queda con un solo consumidor: el drawer.

- [x] **Step 1: Sacar el campo del carrito**

En `useVenta.ts`: borrar `personalizacionDetalle?: PersonalizacionDetalleLinea[]` de
`CarritoLinea` (`:47`), el parámetro `personalizacionDetalle` de `agregarLinea`
(`:104`) y de la función expuesta (`:426`), la const `detalle` (`:114`), la asignación
`if (detalle) nueva.personalizacionDetalle = detalle` (`:163`) y el paso del argumento
(`:435`). Si el import de `PersonalizacionDetalleLinea` (`:16`) queda sin uso,
borrarlo también.

- [x] **Step 2: Sacar el parámetro del emit del drawer**

En `ItemPersonalizacionDrawer.vue`, borrar `detallePreview.value` del `emit('confirm', ...)`
(`:324`) y el cuarto parámetro de la declaración de `defineEmits`. **`detallePreview`
NO se borra**: el drawer lo sigue rindiendo en su propio preview.

En `pos.vue`, `onRecetaConfirm` pierde su cuarto parámetro y deja de pasarlo a `add`:

```ts
function onRecetaConfirm(payload: PersonalizacionPayload, resumen: string, precioPreview: string) {
  const item = items.value.find((i) => i.id === recetaItemId.value)
  if (!item) return
  if (personalizacionVacia(payload)) {
    add(item)
  }
  else {
    add(item, payload, resumen || undefined, precioPreview)
  }
  recetaDrawerOpen.value = false
  recetaItemId.value = null
}
```

⚠️ `salones/index.vue` ya ignora ese parámetro (`onRecetaConfirm(payload, _resumen,
_precioPreview?)`): no necesita cambios.

- [x] **Step 3: Dejar escrito para qué queda el preview**

En `useRecetaPersonalizacion.ts`, reemplazar el docblock de
`detallePersonalizacionPreview` por:

```ts
/**
 * Detalle priceado para el **preview del drawer, y solo para eso**: omitidos
 * primero en $0 (nunca tienen costo), extras después con `precioExtra × unidades`,
 * en la moneda del ÍTEM —que es la que el drawer formatea, pasándole
 * `detalle.monedaId` a `formatMonto`—.
 *
 * ⚠️ **No alimenta ningún ticket.** El detalle que se imprime lo produce el
 * backend ya convertido a moneda oficial (`POST /ventas` y la lectura de la
 * cuenta de salón), porque el ticket formatea con la moneda oficial y acá el
 * número está en la del ítem: pasarlo al ticket imprimía dólares con símbolo y
 * separadores de peso. Si esta función vuelve a viajar a una pantalla que
 * formatea con la oficial, vuelve el bug.
 */
```

- [x] **Step 4: Borrar los tests del campo muerto**

En `useVenta.spec.ts`, borrar los dos tests de `:503-534`
(`'agregarLinea guarda personalizacionDetalle solo cuando hay personalización'` y
`'agregarLinea merge mantiene personalizacionDetalle'`). Si el archivo queda con un
import de `PersonalizacionDetalleLinea` sin uso, sacarlo.

- [x] **Step 5: Correr los tests del frontend**

Run: `cd frontend && npm test && npm run typecheck:ratchet && npm run build`
Expected: PASS. Los specs de `useRecetaPersonalizacion` y `ticket-builder` no cambian:
la función pura y el renderizado del ticket siguen igual.

- [x] **Step 6: Commitear**

```bash
git add frontend/app/composables/useVenta.ts frontend/app/composables/useVenta.spec.ts frontend/app/composables/useRecetaPersonalizacion.ts frontend/app/components/ventas/ItemPersonalizacionDrawer.vue frontend/app/pages/ventas/pos.vue
git commit -m "refactor(pos): el detalle priceado del cliente queda solo para el preview del drawer"
```

---

### Task 5: Cierre — backlog, hallazgo anotado y gate completo

**Files:**
- Modify: `docs/agent/pendientes.md` (sacar la entrada de la § 3; entrada nueva por el
  hallazgo del override)
- Modify: `docs/agent/resueltos.md` (entrada cerrada, con lo medido)

- [x] **Step 1: Mover la entrada cerrada a `resueltos.md`**

Mover la entrada completa de la § 3 a `resueltos.md`, agregando qué quedó construido:
el productor único en el backend, la conversión por extra en los dos caminos, el POS
imprimiendo desde la respuesta y el preview acotado al drawer. Dejar escrito **que la
premisa de la entrada era parcialmente falsa** y cómo se midió — que el P.UNIT de una
línea con extras tampoco viaja convertido, y que eso se decidió no arreglar.

- [x] **Step 2: Anotar el hallazgo del override como entrada nueva**

En `docs/agent/pendientes.md` § 4 (*Necesita que el owner conteste*), agregar:

```markdown
- [ ] **El override de `precioUnitario` no se convierte, así que una línea
  personalizada en moneda extranjera se cobra en la magnitud equivocada** (backend +
  frontend; medido el 2026-08-30 al construir la conversión del extra en el ticket;
  el owner decidió ese día **no** ampliar aquel frente) — para una línea con extras
  pagos, POS y salones mandan `precioUnitario` como override con `precioBase + extras`
  **en la moneda del ítem** (`useVenta.ts:213`, `useSalones.ts:235-237`), y el motor
  usa el override tal cual: `linea.precioUnitario !== undefined ? linea.precioUnitario
  : this.convertirAMonedaOficial(...)` (`calculo-precios.service.ts:591-598`). Dos
  tests contiguos fijan las dos ramas a propósito
  (`calculo-precios.service.spec.ts:202` y `:209`, este último titulado *"cuando no hay
  override"*).
  **La escena, receta en USD a 10 con extra de 1, tasa 950, IVA 19%:** el POS muestra
  y cobra **$13**; `POST /ventas` ignora el override cuando hay personalización,
  recalcula `precioBase + precioExtraTotal` y convierte, y registra una venta de
  **$12.436** — que nace impaga.
  ⚠️ **No le pasa a nadie hoy:** ningún ítem personalizable está en moneda extranjera,
  igual que con la UF como oficial. Nada lo impide.
  ⛔ **Toca el motor de cálculo**, así que va solo y con el sistema quieto.
  **La pregunta para el owner:** ¿el override viaja convertido desde el cliente, o el
  motor lo convierte como convierte `precioBase`? Son la misma cuenta en dos lugares
  distintos, y hay un tercer camino (`ventas.service.ts`) que ya ignora el override
  cuando hay personalización — así que quizás lo que sobra es el override.
```

- [x] **Step 3: Actualizar el párrafo de "Detenerse y preguntar" si hiciera falta**

`CLAUDE.md` nombra los frentes abiertos que hacen frenar. Esta entrada nueva **no**
va ahí: no es una tanda, es una entrada de § 4 como las demás. No tocar `CLAUDE.md`.

- [x] **Step 4: Gate completo**

```bash
cd backend && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
```

```bash
cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
```

⚠️ `./scripts/reset-db.sh` **antes** del `test:e2e`, y `./scripts/reset-db.sh --verificar`
después. El e2e va **completo**, no un subset: un cambio en una respuesta compartida
rompe specs que el subset local no mira.

- [x] **Step 5: Revisión independiente y commit final**

Correr el paso 7 del skill `verify-feature` (sub-agente `domain-reviewer` de contexto
fresco sobre el diff staged) — el pre-commit lo exige y sin el recibo bloquea.

```bash
git add docs/agent/pendientes.md docs/agent/resueltos.md
git commit -m "docs(backlog): cierra la moneda del extra en el ticket y abre el override sin convertir"
```

---

## Self-Review

**Cobertura de los cinco puntos de la spec:**

| Punto de la entrada | Tarea |
|---|---|
| (1) `POST /ventas` devuelve el detalle convertido | Tarea 1 |
| (2) Cada extra se convierte por su cuenta | Tareas 1 y 2 (el `.map` por línea de detalle) |
| (3) `salones.service.ts:1540` convierte al leer la cuenta | Tarea 2 |
| (4) El POS imprime el de la respuesta, no el del carrito | Tarea 3 |
| (5) `detallePersonalizacionPreview` queda solo para el drawer, escrito | Tarea 4, Step 3 |

**Lo que el plan agrega y la entrada no decía** (los dos salieron de la medición, están
justificados arriba): el resolvedor batcheado de nombres en `VentasService` (Tarea 1,
Step 3) y la inyección de `MonedasService` + `CalculoPreciosService` en `SalonesService`
(Tarea 2, Step 3). Ninguno de los dos toca el motor: leen configuración y llaman a una
función de conversión que ya existe.

**Consistencia de tipos:** `PersonalizacionDetalleLinea` es el mismo tipo en los dos
lados (`personalizacion-receta.util.ts` en backend, `ticket-builder.ts` en frontend);
el campo `personalizacionDetalle` conserva nombre y forma en las tres superficies, y
lo único que cambia es la moneda del `monto`.
