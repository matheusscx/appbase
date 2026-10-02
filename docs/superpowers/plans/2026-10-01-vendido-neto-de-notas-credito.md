# Plan: el vendido, el cobrado y el "Total facturado" restan las notas de crédito

> **Para agentes:** se ejecuta con `superpowers:subagent-driven-development`, tarea por tarea, con
> implementadores **Sonnet**. Los pasos usan checkboxes (`- [ ]`). El implementador **no commitea**:
> stagea por ruta explícita. La revisión (`domain-reviewer` con las dudas que el controlador no
> verificó), el recibo del pre-commit y el commit los hace el controlador.

- **Status:** Draft — listo para que lo apruebe el owner
- **Date:** 2026-10-01
- **Owner:** César (owner) · redacta la sesión del frente (worktree `admiring-bouman-9d6d3e`) · coordina
  la orquestadora ("Listado de sesiones activas")

**Goal:** que el inicio y `/ventas` muestren lo vendido y lo cobrado **netos** de las notas de crédito
y de lo devuelto, con el bruto y lo restado a la vista, y que el saldo por cobrar descuente las NC.

**Spec:** [`docs/superpowers/specs/2026-10-01-vendido-neto-de-notas-credito-design.md`](../specs/2026-10-01-vendido-neto-de-notas-credito-design.md).
Las decisiones (D1–D12) y su procedencia están ahí y en `pendientes.md` § 3. No se repiten acá. Quien
ejecuta lee las dos.

**Architecture:** no hay arquitectura nueva. Cambian **cinco consultas** que ya existen (cuatro de
`ResumenNegocioService.hoy` y la de `VentasService.resumen`), dos tipos de respuesta con campos
aditivos y dos pantallas. Una corrección se reconoce por **`v.venta_referencia_id IS NOT NULL`**
(spec § 3.1), lo que saca el cruce con `tipos_documento_tributario` de todas ellas. El neto se arma
con signo dentro de la misma consulta: no se agrega ninguna consulta por fila ni por período.

**Tech Stack:** NestJS + SQL crudo vía `Db`, PostgreSQL 18, Decimal.js, Nuxt 4 + Nuxt UI v4, Jest +
supertest (e2e), Vitest, Playwright.

## Global Constraints

- **Fiscal, frente solo** (`CLAUDE.md`, ADR-010): no se toma nada de arrastre. No se toca
  `crearNotaCreditoEnTransaccion`, el motor de precios ni ningún otro lector del tipo NC (tope,
  composición, listado, detalle): esos los inventaría el frente de emisión.
- **Dinero con Decimal.js**, nunca `number`. Toda cuenta en TypeScript sobre montos usa `Decimal`;
  los montos salen como `string`.
- **Soft delete:** toda tabla nueva en una consulta filtra `eliminado_el IS NULL`. Este plan **saca**
  la única lectura sin filtro que había en estas consultas (el `LEFT JOIN tipos_documento_tributario`
  sin `td.eliminado_el`), junto con su comentario.
- **Sin N+1:** cada número sale de una consulta fija. Las subconsultas correlacionadas del saldo van
  dentro de **una** consulta agregada, la forma que ya tiene hoy.
- **42P18:** cada `$n` que se manda a `db.query` aparece en el texto, y cada `$n` del texto tiene su
  parámetro (comentario de `paramsMasVendidos` en el servicio).
- **Nombres de campo nuevos, exactos:** `ventas.vendidoDesglose: { bruto, notasCredito }`,
  `ventas.cobradoDesglose: { cobrado, devuelto }` (de hoy); en `/ventas/resumen`, `totalBruto` y
  `totalNotasCredito`. Los campos existentes no cambian de forma, sí de significado (pasan a netos).
- **Rótulos, exactos:** debajo del vendido, `bruto $X · notas de crédito −$Y`; debajo del cobrado,
  `cobrado $X · devuelto −$Y`; debajo de "Total facturado", la misma línea que el vendido. Sale el
  rótulo "(antes de notas de crédito)". El signo es `−` (U+2212).
- **Montos de prueba que discriminan:** ni 1, ni factores iguales, ni el mismo monto en dos lados.
- **Cada test nuevo lleva un mutante que revierte** a la consulta de hoy (no que solo la rompe), y lo
  tiene que matar. Un superviviente se declara con el motivo medido, después de intentar matarlo.
- **Entorno:** `./scripts/entorno.sh db` para `test:e2e`; `./scripts/entorno.sh stack` para
  Playwright. `./scripts/reset-db.sh` **antes** del e2e, `--verificar` después. No tocar un `.ts` del
  backend con el e2e corriendo.

---

## Lo medido al escribir el plan

La spec § 4 dejaba cuatro preguntas para una tarea 1. Se midieron al escribir el plan (spec § 4,
reescrita), así que no hay spike: ninguna vuelve al owner y todas fijan SQL.

| Qué | Resultado | Dónde |
|---|---|---|
| Quién escribe `venta_referencia_id` | solo `crearNotaCreditoEnTransaccion`; el seed no | grep sobre `backend/src` |
| Moneda del `REFUND` | `CLP` (`MONEDA_ORDEN_V1`), validada con la escala de CLP; la pasarela es solo de Chile | `pasarela-orden.entity.ts`, `CobrosService.reembolsar`, `pasarela-solo-chile.e2e-spec.ts` |
| `REVERSAL` | nadie lo escribe | grep sobre `backend/src` |
| Fecha del `REFUND` | `fecha_transaccion` (`new Date()` al registrar) | `TransaccionesService.registrar` |
| Fecha de la salida de caja | `movimientos_caja.fecha` | `movimiento-caja.entity.ts` |
| Alcance de la salida de caja | `movimientos_caja` **no** tiene `tenant_id`: va por la NC | entity |
| Signo de las líneas de la NC | positivas (`totalLinea: l.bruto`) | `crearNotaCreditoEnTransaccion` |
| Doble cuenta `REFUND` + caja | el webhook no pasa `devolverDinero` | `VentasReembolsoHandler.onReembolsoAprobado` |
| `REFUND` en el e2e | no se alcanza por la app: `getReembolsable` solo conoce Transbank y la demo no reembolsa | `provider.factory.ts` |
| Parche local del saldo en `/ventas` | `onDetalleUpdated` resta y suma el `saldo` de la fila; tras una NC o una anulación el resumen cambia y la fila no | `pages/ventas/index.vue`, `VentaDetalleDrawer.vue` (`emitPatch` tras cobro, anulación y NC) |

**Sobre el `REFUND` en el e2e.** El estado que deja el proveedor (orden conciliada y transacción
`REFUND` aprobada) se arma con las piezas de la app: `PasarelaOrden` por su repositorio y la
transacción por `TransaccionesService.registrar`, el mismo método que usa `CobrosService.reembolsar`.
Lo que sigue va por el camino real: la NC del webhook se emite con
`VentasReembolsoHandler.onReembolsoAprobado`, que es lo que llama `aplicarPostReembolso`. El porqué
va escrito en el test, para que nadie lo lea como estado inalcanzable.

---

## File Structure

| Archivo | Cambia |
|---|---|
| `backend/src/modules/resumen-negocio/resumen-negocio.service.ts` | vendido, cobrado, por cobrar y lo más vendido netos; `calcularVariacion` con semana ≤ 0; ticket con neto ≤ 0; tipos de respuesta |
| `backend/src/modules/resumen-negocio/resumen-negocio.service.spec.ts` | la aritmética (variación, ticket, desgloses) con `Db` mockeado |
| `backend/src/modules/ventas/ventas.service.ts` | `resumen()` y `VentasResumen` (solo eso) |
| `backend/test/resumen-negocio.e2e-spec.ts` | escenarios del inicio |
| `backend/test/ventas.e2e-spec.ts` | escenarios de `/ventas/resumen` |
| `backend/test/visibilidad-ventas-pagos.e2e-spec.ts` | alcance "mis cajas" del resumen |
| `frontend/app/types/resumen-negocio.ts` | espejo con los desgloses |
| `frontend/app/components/inicio/InicioVentas.vue` | rótulo fuera, líneas de desglose |
| `frontend/app/components/inicio/InicioHoy.nuxt.spec.ts` | fixture y casos del desglose |
| `frontend/app/pages/ventas/index.vue` | línea bajo "Total facturado"; el resumen se vuelve a pedir tras un cambio en el drawer |
| `frontend/app/pages/ventas/index.nuxt.spec.ts` | fixture y casos |
| `frontend/e2e/inicio/dashboard.spec.ts` | el selector que usaba el rótulo; caso del desglose |
| Docs | `docs/features/dashboard-inicio.md`, `docs/features/ventas.md`, `docs/ESTADO.md`, `pendientes.md` → `resueltos.md` |

---

### Task 1: Vendido, cantidad, canal, ticket y variación netos (`/resumen-negocio/hoy`)

D1, D4, D7, D8. Spec § 3.2, primeros tres párrafos.

**Files:**
- Modify: `backend/src/modules/resumen-negocio/resumen-negocio.service.ts` (interfaces `VentasHoy`,
  `VentasRow`; `calcularVariacion`; consulta de ventas; armado de la respuesta)
- Test: `backend/src/modules/resumen-negocio/resumen-negocio.service.spec.ts`
- Test: `backend/test/resumen-negocio.e2e-spec.ts`

**Interfaces:**
- Produces: `VentasHoy.vendidoDesglose: { bruto: string; notasCredito: string }`, de hoy.
  `vendido.hoy` = `bruto − notasCredito`.
- Produces: `calcularVariacion(hoy, semanaPasada)` devuelve `null` si `semanaPasada.lte(0)`.

- [ ] **Step 1: test unitario de la aritmética (falla).** En el spec unitario, sumar al helper que
  encadena respuestas los campos nuevos de la fila de ventas (`bruto_hoy`, `notas_hoy`, `neto_hoy`)
  y escribir:

  ```ts
  it('vendidoDesglose sale de bruto_hoy y notas_hoy; vendido.hoy es el neto', async () => {
    encadenar({ ventas: { bruto_hoy: '300000.0000', notas_hoy: '20000.0000', neto_hoy: '280000.0000' } });
    const r = await service.hoy(TENANT);
    expect(r.ventas.vendido.hoy).toBe('280000.0000');
    expect(r.ventas.vendidoDesglose).toEqual({ bruto: '300000.0000', notasCredito: '20000.0000' });
  });

  it('variación es null cuando la semana pasada es negativa', async () => {
    encadenar({ ventas: { neto_hoy: '50000.0000', vendido_semana_pasada: '-12000.0000' } });
    expect((await service.hoy(TENANT)).ventas.vendido.variacion).toBeNull();
  });

  it('ticket es null con neto ≤ 0 aunque haya ventas', async () => {
    encadenar({ ventas: { neto_hoy: '-7000.0000', cantidad_hoy: 3 } });
    expect((await service.hoy(TENANT)).ventas.ticketPromedio.hoy).toBeNull();
  });
  ```

  (`encadenar` y `TENANT` son los nombres del helper y la constante que ya tiene el archivo: usar los
  reales. Los casos existentes que leen `vendido_hoy` pasan a leer `neto_hoy`.)

- [ ] **Step 2: correrlo y verlo fallar.** `cd backend && npx jest src/modules/resumen-negocio` →
  FAIL en los tres (`vendidoDesglose` undefined, variación `-5.1667`, ticket negativo).

- [ ] **Step 3: la consulta.** Reemplazar la consulta de ventas por esta. Sale el `LEFT JOIN` a
  `tipos_documento_tributario` y su comentario completo:

  ```ts
  // Una corrección (hoy, la nota de crédito) es la fila con
  // `venta_referencia_id`: resta en SU fecha, aunque la venta que corrige sea
  // de otro día (spec 2026-10-01-vendido-neto § 2 D1, § 3.1). Su total_final
  // es positivo: el signo lo pone esta consulta.
  const firmado =
    'CASE WHEN v.venta_referencia_id IS NULL THEN v.total_final ELSE -v.total_final END';

  const ventasRows: VentasRow[] = await this.db.query(
    `SELECT
        COALESCE(SUM(v.total_final)
          FILTER (WHERE ${condHoyVenta} AND v.venta_referencia_id IS NULL), 0)::text
          AS bruto_hoy,
        COALESCE(SUM(v.total_final)
          FILTER (WHERE ${condHoyVenta} AND v.venta_referencia_id IS NOT NULL), 0)::text
          AS notas_hoy,
        COALESCE(SUM(${firmado}) FILTER (WHERE ${condHoyVenta}), 0)::text
          AS neto_hoy,
        COALESCE(SUM(${firmado}) FILTER (WHERE ${condSemanaPasadaVenta}), 0)::text
          AS vendido_semana_pasada,
        COUNT(*) FILTER (WHERE ${condHoyVenta} AND v.venta_referencia_id IS NULL)::int
          AS cantidad_hoy,
        COUNT(*) FILTER (WHERE ${condSemanaPasadaVenta} AND v.venta_referencia_id IS NULL)::int
          AS cantidad_semana_pasada,
        COALESCE(SUM(${firmado})
          FILTER (WHERE ${condHoyVenta} AND v.canal = 'fisico'), 0)::text
          AS vendido_fisico_hoy,
        COALESCE(SUM(${firmado})
          FILTER (WHERE ${condHoyVenta} AND v.canal = 'online'), 0)::text
          AS vendido_online_hoy
       FROM ventas v
      WHERE v.tenant_id = $1
        AND v.eliminado_el IS NULL
        AND v.estado <> 'cancelada'`,
    params,
  );
  ```

  La NC copia el `canal` de la venta que corrige, así que resta en el mismo canal (spec § 1).

- [ ] **Step 4: la aritmética.**

  ```ts
  /** `(hoy − semanaPasada) / semanaPasada`; `null` si `semanaPasada` ≤ 0: contra
   *  un día negativo o vacío el porcentaje no dice nada (D7). */
  function calcularVariacion(hoy: Decimal, semanaPasada: Decimal): string | null {
    if (semanaPasada.lte(0)) return null;
    return hoy.minus(semanaPasada).dividedBy(semanaPasada).toFixed(ESCALA_COSTO);
  }
  ```

  El ticket de cada período es `neto / cantidad` solo si `cantidad > 0` **y** `neto > 0`; si no,
  `null` (D8). `vendido.hoy` = `neto_hoy`; `vendidoDesglose` = `{ bruto: bruto_hoy, notasCredito:
  notas_hoy }`. Actualizar los docblocks de `Comparado.variacion` y `VentasHoy.ticketPromedio`, que
  hoy dicen "si semanaPasada = 0" y "cuando esa cantidad es 0".

- [ ] **Step 5: unitarios en verde.** `npx jest src/modules/resumen-negocio` → PASS.

- [ ] **Step 6: e2e (falla primero con la consulta vieja).** En `resumen-negocio.e2e-spec.ts`,
  dentro de `el delta, por el camino de la app`:

  ```ts
  it('una NC de hoy sobre una venta de ayer resta del vendido de hoy, no de ayer, y no cuenta como venta', async () => {
    // Venta de 7 unidades del ítem propio, pagada entera en efectivo. El total
    // lo calcula el servidor (puede llevar IVA): leerlo de la respuesta.
    // ...crear y pagar como en el test de A...
    // La venta pasa a ayer. No es un estado inventado: es el reloj. La app
    // no deja fechar una venta, y lo que se prueba es justamente que la NC
    // cuenta en SU día y no en el de la venta.
    await ds.query(
      `UPDATE ventas SET fecha = fecha - interval '1 day' WHERE venta_id = $1`,
      [venta.id],
    );
    const antes = (await leerResumen(tokenAdmin)).body as ResumenHoyResponse;
    const nc = await request(app.getHttpServer())
      .post(`/api/ventas/${venta.id}/notas-credito`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ monto: '3150' });
    expect(nc.status).toBe(201);
    const despues = (await leerResumen(tokenAdmin)).body as ResumenHoyResponse;

    const delta = (a: string, b: string) => new Decimal(b).minus(a).toString();
    expect(delta(antes.ventas.vendido.hoy, despues.ventas.vendido.hoy)).toBe('-3150');
    expect(delta(antes.ventas.vendidoDesglose.bruto, despues.ventas.vendidoDesglose.bruto)).toBe('0');
    expect(delta(antes.ventas.vendidoDesglose.notasCredito, despues.ventas.vendidoDesglose.notasCredito)).toBe('3150');
    expect(despues.ventas.cantidad.hoy).toBe(antes.ventas.cantidad.hoy);
    expect(delta(antes.ventas.porCanal.fisico, despues.ventas.porCanal.fisico)).toBe('-3150');
  });
  ```

  Si el archivo no tiene un `DataSource` a mano (`ds`), tomarlo con `app.get(DataSource)` como hace
  `ventas.e2e-spec.ts`. Sumar `vendidoDesglose` y `cobradoDesglose` a `ResumenHoyResponse`.

- [ ] **Step 7: correr el e2e.** `./scripts/reset-db.sh`, después
  `cd backend && npx jest --config ./test/jest-e2e.json test/resumen-negocio.e2e-spec.ts` → PASS.
  Después `./scripts/reset-db.sh --verificar`.

- [ ] **Step 8: mutante que revierte.** Volver a poner la consulta de hoy (con
  `COALESCE(td.es_nota_credito, false) = false` y `SUM(v.total_final)` sin signo) → el test nuevo
  falla en `-3150` (da `0`). Restaurar y mirar la hora del restart del watcher si el stack está arriba.

- [ ] **Step 9: stagear** los tres archivos por ruta y reportar al controlador.

---

### Task 2: Cobrado neto de lo devuelto (`/resumen-negocio/hoy`)

D2, D6. Spec § 3.2, "Cobrado".

**Files:**
- Modify: `backend/src/modules/resumen-negocio/resumen-negocio.service.ts` (consulta de cobrado,
  `CobradoRow`, `VentasHoy`)
- Test: `backend/src/modules/resumen-negocio/resumen-negocio.service.spec.ts`
- Test: `backend/test/resumen-negocio.e2e-spec.ts`

**Interfaces:**
- Consumes: `calcularVariacion` de la Task 1.
- Produces: `VentasHoy.cobradoDesglose: { cobrado: string; devuelto: string }`, de hoy.
  `cobrado.hoy` = `cobrado − devuelto`. `devuelto` = efectivo devuelto por correcciones + `REFUND`
  aprobados de órdenes con venta.

- [ ] **Step 1: unitario (falla).**

  ```ts
  it('cobrado.hoy es lo cobrado menos el efectivo devuelto y los REFUND; el desglose los separa', async () => {
    encadenar({ cobrado: {
      cobrado_hoy: '500000.0000', efectivo_hoy: '12000.0000', pasarela_hoy: '7300.000000',
    } });
    const r = await service.hoy(TENANT);
    expect(r.ventas.cobrado.hoy).toBe('480700.0000');
    expect(r.ventas.cobradoDesglose).toEqual({ cobrado: '500000.0000', devuelto: '19300.0000' });
  });
  ```

  (`pasarela_transacciones.monto` puede venir con otra escala que `pagos`: por eso el resultado
  derivado sale con `toFixed(4)`.)

- [ ] **Step 2: verlo fallar.**

- [ ] **Step 3: la consulta.** Una sola consulta, tres agregados que devuelven una fila cada uno,
  cruzados. Usa los mismos cinco parámetros que la de ventas (todos referenciados):

  ```ts
  const condHoyMov = condicion('mc.fecha', IDX_FECHA_HOY);
  const condSemanaPasadaMov = condicionSemanaPasada('mc.fecha', IDX_FECHA_SEMANA_PASADA);
  const condHoyRefund = condicion('t.fecha_transaccion', IDX_FECHA_HOY);
  const condSemanaPasadaRefund = condicionSemanaPasada('t.fecha_transaccion', IDX_FECHA_SEMANA_PASADA);

  const cobradoRows: CobradoRow[] = await this.db.query(
    `SELECT c.cobrado_hoy, c.cobrado_semana_pasada,
            e.efectivo_hoy, e.efectivo_semana_pasada,
            r.pasarela_hoy, r.pasarela_semana_pasada
       FROM (
         SELECT COALESCE(SUM(pa.monto) FILTER (WHERE ${condHoyPago}), 0)::text AS cobrado_hoy,
                COALESCE(SUM(pa.monto) FILTER (WHERE ${condSemanaPasadaPago}), 0)::text
                  AS cobrado_semana_pasada
           FROM pagos p
           JOIN pago_aplicaciones pa
             ON pa.pago_id = p.pago_id AND pa.tipo = 'venta' AND pa.eliminado_el IS NULL
          WHERE p.tenant_id = $1 AND p.eliminado_el IS NULL
       ) c
       -- Efectivo devuelto: la salida de caja que lleva el venta_id de una
       -- corrección. Un retiro de caja no lleva venta_id y no entra.
       -- movimientos_caja no tiene tenant_id: el alcance va por la corrección.
       CROSS JOIN (
         SELECT COALESCE(SUM(mc.monto) FILTER (WHERE ${condHoyMov}), 0)::text AS efectivo_hoy,
                COALESCE(SUM(mc.monto) FILTER (WHERE ${condSemanaPasadaMov}), 0)::text
                  AS efectivo_semana_pasada
           FROM movimientos_caja mc
           JOIN ventas nc
             ON nc.venta_id = mc.venta_id
            AND nc.venta_referencia_id IS NOT NULL
            AND nc.tenant_id = $1
            AND nc.eliminado_el IS NULL
          WHERE mc.tipo = 'salida' AND mc.eliminado_el IS NULL
       ) e
       -- Reembolso por pasarela, con o sin NC (D6). Solo de órdenes con venta:
       -- el cobro de una orden sin venta nunca entró a pagos, así que su
       -- reembolso tampoco sale del cobrado. El webhook no deja salida de caja
       -- (no pasa devolverDinero), así que esto y lo de arriba no se pisan.
       CROSS JOIN (
         SELECT COALESCE(SUM(t.monto) FILTER (WHERE ${condHoyRefund}), 0)::text AS pasarela_hoy,
                COALESCE(SUM(t.monto) FILTER (WHERE ${condSemanaPasadaRefund}), 0)::text
                  AS pasarela_semana_pasada
           FROM pasarela_transacciones t
           JOIN pasarela_ordenes o
             ON o.orden_id = t.orden_id
            AND o.tenant_id = t.tenant_id
            AND o.venta_id IS NOT NULL
            AND o.eliminado_el IS NULL
          WHERE t.tenant_id = $1
            AND t.tipo = 'REFUND'
            AND t.estado = 'aprobada'
            AND t.eliminado_el IS NULL
       ) r`,
    params,
  );
  ```

  El comentario largo del "Step 1 (medido antes de escribir, 2026-09-18)" se queda: sigue siendo
  cierto que ninguna NC ni cancelada escribe `pagos`. Se le agrega una línea: lo que la NC devuelve
  se resta aparte, en `e` y `r`.

- [ ] **Step 4: la aritmética.** Con `Decimal`, para hoy y la semana pasada:
  `devuelto = efectivo + pasarela`, `neto = cobrado − devuelto`, los dos con `toFixed(4)`.
  `cobrado.hoy` / `cobrado.semanaPasada` son los netos; la variación es
  `calcularVariacion(netoHoy, netoSemanaPasada)`; `cobradoDesglose = { cobrado: cobrado_hoy,
  devuelto: devueltoHoy.toFixed(4) }`.

- [ ] **Step 5: unitarios en verde.**

- [ ] **Step 6: e2e, cuatro casos** en un `describe('lo devuelto resta del cobrado')` nuevo. Ventas de
  5 unidades del ítem propio de 1234: el total, con o sin IVA, pasa de 6170, así que los montos
  fijos de abajo caben. La caja del admin ya está abierta en el
  archivo (`abrirCaja`); si no, abrirla en el `beforeAll` y cerrarla en el `afterAll`.

  1. **NC con `devolverDinero`, y un retiro ajeno de control.** Venta pagada en efectivo. Leer
     `antes`. NC `{ monto: '2340', devolverDinero: true }`. Retiro
     `POST /api/caja/:id/movimientos { tipo: 'salida', concepto: 'Retiro e2e', monto: '4100' }`.
     Leer `despues`. Afirmar: `cobrado.hoy` −2340 (no −6440: el retiro no cuenta);
     `cobradoDesglose.devuelto` +2340; `cobradoDesglose.cobrado` 0.
  2. **`REFUND` aprobado sin NC.** Venta pagada en efectivo. Armar la orden y el `REFUND` (bloque de
     abajo) por 1785. Afirmar: `cobrado.hoy` −1785; `vendido.hoy` 0; `porCobrar` sin cambio.
  3. **`REFUND` con NC (el webhook).** Igual que 2, por 1785, y después
     `app.get(VentasReembolsoHandler).onReembolsoAprobado({ tenantId, ordenId, codigoOrden,
     ventaId, monto: '1785', generarNotaCredito: true, devoluciones: [], usuarioId })`, con el
     `usuarioId` del admin (como `getUsuarioId` de `ventas.e2e-spec.ts`). Afirmar:
     `cobrado.hoy` −1785 (**una** vez, no −3570); `vendido.hoy` −1785; y
     `SELECT COUNT(*) FROM movimientos_caja WHERE venta_id = $nc` → 0.
  4. **Control: `REFUND` de una orden sin venta** (`ventaId: null`), por 2210 → `cobrado.hoy` sin
     cambio. Es el caso que la consulta **deja pasar**.

  El armado del `REFUND`:

  ```ts
  /**
   * Lo que deja el proveedor después de un reembolso aprobado. En el e2e no
   * hay cómo llegar por la app: `ProviderFactory.getReembolsable` solo conoce
   * Oneclick y Webpay Plus (Transbank) y la pasarela demo no reembolsa. Se
   * arma con las piezas de la app —el repositorio de la orden y
   * `TransaccionesService.registrar`, el mismo que usa `CobrosService.reembolsar`—
   * y de ahí en adelante todo va por el camino real.
   */
  async function reembolsoAprobado(ventaId: string | null, monto: string) {
    // La config demo de Paris: la fila con codigo 'demo' de GET /api/pasarela/admin/config,
    // como la busca tienda-pasarela-demo.e2e-spec.ts.
    const tenantPasarelaId = await idConfigDemo();
    const orden = await ds.getRepository(PasarelaOrden).save({
      tenantId: PARIS_TENANT_ID, ventaId, codigoOrden: `e2e-${randomUUID().slice(0, 20)}`,
      descripcion: 'Orden e2e vendido neto', monto, moneda: 'CLP', estado: 'conciliada', origen: 'interno',
    });
    await app.get(TransaccionesService).registrar({
      tenantId: PARIS_TENANT_ID, ordenId: orden.ordenId, tenantPasarelaId,
      tipo: 'REFUND', estado: 'aprobada', monto, moneda: 'CLP', codigoOrden: orden.codigoOrden,
    });
    return orden;
  }
  ```

  Si `pasarela_transacciones` o `pasarela_ordenes` exigen otra columna al guardar, completarla con lo
  que deja `CobrosService` (no con un valor inventado) y anotarlo en el reporte.

- [ ] **Step 7: correr el e2e** (reset antes, `--verificar` después) → PASS.

- [ ] **Step 8: mutantes que revierten.** (a) La consulta de cobrado de hoy, sin `e` ni `r` → caen
  1, 2 y 3. (b) Sin `o.venta_id IS NOT NULL` → cae 4. (c) Sin `mc.venta_id` atado a una corrección
  (`JOIN` quitado, cualquier salida) → cae 1 en `-6440`.

- [ ] **Step 9: stagear y reportar.**

---

### Task 3: Lo más vendido resta lo devuelto con líneas

D5. Spec § 3.2, "Lo más vendido".

**Files:**
- Modify: `backend/src/modules/resumen-negocio/resumen-negocio.service.ts` (consulta de más vendidos)
- Test: `backend/src/modules/resumen-negocio/resumen-negocio.service.spec.ts` (los dos tests que
  afirman sobre la cláusula de NC y el `ORDER BY`)
- Test: `backend/test/resumen-negocio.e2e-spec.ts`

**Interfaces:**
- Produces: `MasVendidoItem.cantidad` y `.monto` netos. Forma sin cambios.

- [ ] **Step 1: la consulta.** Sale el `LEFT JOIN` a `tipos_documento_tributario` y su comentario.
  Se mantiene el comentario del `JOIN items` sin filtro de borrado y el de la lista de params propia:

  ```sql
  SELECT vd.item_id, i.nombre AS item_nombre,
         SUM(CASE WHEN v.venta_referencia_id IS NULL THEN vd.total_linea
                  ELSE -vd.total_linea END)::text AS monto,
         SUM(CASE WHEN v.venta_referencia_id IS NULL THEN vd.cantidad
                  ELSE -vd.cantidad END)::text AS cantidad
    FROM venta_detalles vd
    JOIN ventas v ON v.venta_id = vd.venta_id
    JOIN items i ON i.item_id = vd.item_id
   WHERE v.tenant_id = $1
     AND v.eliminado_el IS NULL
     AND vd.eliminado_el IS NULL
     AND v.estado <> 'cancelada'
     -- La línea "Ajuste" es la parte de una NC que no corresponde a ningún
     -- producto: resta del vendido, no de un ítem (D5).
     AND i.es_ajuste_nota_credito = false
     AND ${condHoyVentaMasVendidos}
   GROUP BY vd.item_id, i.nombre
  HAVING SUM(CASE WHEN v.venta_referencia_id IS NULL THEN vd.total_linea
                  ELSE -vd.total_linea END) > 0
   ORDER BY SUM(CASE WHEN v.venta_referencia_id IS NULL THEN vd.total_linea
                     ELSE -vd.total_linea END) DESC, vd.item_id
   LIMIT 5
  ```

  Ajustar los dos unitarios que afirman sobre el texto del SQL: el de la cláusula afirma ahora
  `venta_referencia_id IS NULL` y `es_ajuste_nota_credito = false` acotados a su cláusula, y el del
  orden afirma `ORDER BY SUM(CASE`.

- [ ] **Step 2: e2e (falla con la consulta vieja).** Molde: el test existente "una venta de un ítem
  propio con precio muy alto sale primera". Ítem propio con precio alto (para quedar en el top 5)
  y no redondo, p. ej. 9.870.000. Venta de 3 unidades pagada entera. NC con
  `devoluciones: [{ itemId, cantidad: '1' }]` y `monto` = `⌊T / 3⌋`. Leer las dos líneas con
  `GET /api/ventas/:id` (la de la venta y la de la NC) y afirmar que la fila del ítem en
  `masVendidos` trae `cantidad` 2 y `monto` = `total_linea` de la venta − `total_linea` de la NC.
  Después, una NC por monto libre (solo línea de ajuste) sobre otra venta del día, y afirmar que
  **ninguna** fila de `masVendidos` es el ítem de ajuste (`GET /api/items` no lo lista: tomar su id con
  `SELECT item_id FROM items WHERE tenant_id = $1 AND es_ajuste_nota_credito`). Si un ítem de
  servicio no admite `devoluciones`, usar un producto con stock como hace
  `nota-credito-composicion.e2e-spec.ts`.

- [ ] **Step 3: correr** (reset antes, `--verificar` después) → PASS.

- [ ] **Step 4: mutantes.** (a) La consulta de hoy → `cantidad` 3. (b) Sin `HAVING` y (c) sin
  `es_ajuste_nota_credito = false` → **se espera que los dos sobrevivan**, por el mismo motivo: un
  ítem con neto ≤ 0 se ordena último y no entra al top 5 mientras haya cinco positivos, que en el e2e
  siempre hay; y el ítem de ajuste solo aparece en correcciones, así que su neto es siempre negativo.
  Los dos filtros importan en un día con menos de cinco ítems vendidos. Intentar matarlos primero; si
  sobreviven, declararlo en el reporte y en un comentario del test con el motivo medido.

- [ ] **Step 5: stagear y reportar.**

---

### Task 4: El saldo descuenta las NC — "Por cobrar" y `/ventas/resumen`

D3, D9, D10, D11. Spec § 3.2 "Por cobrar" y § 3.3. Va en una sola tarea porque es **la misma
expresión** en dos consultas: entre una y otra el inicio y `/ventas` mostrarían dos saldos para la
misma deuda.

**Files:**
- Modify: `backend/src/modules/resumen-negocio/resumen-negocio.service.ts` (consulta de por cobrar)
- Modify: `backend/src/modules/ventas/ventas.service.ts` (`resumen()` y `VentasResumen`; nada más)
- Test: `backend/test/resumen-negocio.e2e-spec.ts`
- Test: `backend/test/ventas.e2e-spec.ts`
- Test: `backend/test/visibilidad-ventas-pagos.e2e-spec.ts`

**Interfaces:**
- Produces: `VentasResumen = { totalVentas: number; totalFacturado: string; totalBruto: string;
  totalNotasCredito: string; saldoPendiente: string }`. `totalFacturado` = `totalBruto −
  totalNotasCredito`.
- Produces: `PorCobrar.cantidad` cuenta las ventas con saldo > 0.

La expresión, idéntica en los dos servicios (se duplica dos veces; se extrae a la tercera,
`CLAUDE.md`). Cada copia lleva este comentario:

```sql
-- Saldo de una venta: total − correcciones de esa venta − (pagado − devuelto
-- en efectivo), con piso 0: lo que queda a favor del cliente no es plata por
-- cobrar (spec 2026-10-01-vendido-neto D10). Los REFUND de pasarela quedan
-- afuera porque no guardan qué NC generaron. MISMA expresión en
-- ResumenNegocioService.hoy (porCobrar) y VentasService.resumen: si cambia
-- una, cambia la otra.
GREATEST(
  v.total_final
  - COALESCE((
      SELECT SUM(nc.total_final) FROM ventas nc
       WHERE nc.venta_referencia_id = v.venta_id AND nc.eliminado_el IS NULL
    ), 0)
  - (
      COALESCE((
        SELECT SUM(pa.monto)
          FROM pagos p
          JOIN pago_aplicaciones pa
            ON pa.pago_id = p.pago_id AND pa.eliminado_el IS NULL AND pa.tipo = 'venta'
         WHERE p.venta_id = v.venta_id AND p.eliminado_el IS NULL
      ), 0)
      - COALESCE((
        SELECT SUM(mc.monto)
          FROM ventas nc
          JOIN movimientos_caja mc
            ON mc.venta_id = nc.venta_id AND mc.tipo = 'salida' AND mc.eliminado_el IS NULL
         WHERE nc.venta_referencia_id = v.venta_id AND nc.eliminado_el IS NULL
      ), 0)
    ),
  0)
```

- [ ] **Step 1: e2e del inicio (falla).** En `resumen-negocio.e2e-spec.ts`, ventas de 3 unidades
  del ítem propio. `T` es el `totalFinal` de la respuesta (el servidor calcula el total y puede
  llevar IVA); los montos salen de `T`, cuantizados a CLP hacia abajo, para que ninguno coincida con
  otro:

  1. **NC que deja el saldo en cero, con piso.** Pagar `P = ⌊0,4·T⌋` (`pagada_parcial`). Leer
     `antes`. NC por `N = T − ⌊0,1·T⌋` (sin devolver dinero), que es más que lo que se debe. Afirmar
     `porCobrar.saldo` `−(T − P)` (piso 0; sin el piso daría `−N`) y `porCobrar.cantidad` −1.
  2. **Lo devuelto en efectivo vuelve a deberse.** Pagar `P = ⌊0,6·T⌋` en efectivo. Leer `antes`.
     NC `{ monto: N = ⌊0,25·T⌋, devolverDinero: true }`. Afirmar `porCobrar.saldo` **sin cambio**:
     antes `T − P`, después `T − N − (P − N)`, que es lo mismo. La NC baja la deuda y la plata
     devuelta la sube. Sin el término del efectivo devuelto daría `−N`. `porCobrar.cantidad` sin
     cambio.

- [ ] **Step 2: la consulta del inicio.**

  ```sql
  SELECT COUNT(*) FILTER (WHERE s.saldo > 0)::int AS cantidad,
         COALESCE(SUM(s.saldo), 0)::text AS saldo
    FROM (
      SELECT <expresión> AS saldo
        FROM ventas v
       WHERE v.tenant_id = $1
         AND v.eliminado_el IS NULL
         AND v.estado IN ('pendiente', 'pagada_parcial')
         AND v.venta_referencia_id IS NULL
    ) s
  ```

  Sale el `LEFT JOIN` a `td` y el comentario "cinturón y tirantes": `venta_referencia_id IS NULL`
  dice lo mismo sin cruzar el catálogo. El comentario de arriba de la consulta dice que la fórmula es
  la de `VentasService.resumen` con el saldo por venta de D10.

- [ ] **Step 3: correr y ver pasar el inicio.**

- [ ] **Step 4: e2e de `/ventas/resumen` (falla).** En `ventas.e2e-spec.ts`, un
  `describe('GET /ventas/resumen neto de notas de crédito')`, como admin (ve todas):

  1. **NC sobre una venta pagada.** Venta de 3 unidades pagada entera. Leer `antes`. NC por 1430.
     Afirmar: `totalFacturado` −1430, `totalBruto` 0, `totalNotasCredito` +1430, `totalVentas` 0,
     `saldoPendiente` 0.
  2. **El caso del piso**, el mismo del Step 1.1: `saldoPendiente` `−(T − P)`.
  3. **Cancelada (D9).** Leer `antes`. Crear una venta pendiente de 2 unidades y anularla
     (`POST /api/ventas/:id/anular`). Afirmar los cuatro totales sin cambio (con la consulta de hoy,
     `totalVentas` +1, y `totalFacturado` y `saldoPendiente` + su total).

- [ ] **Step 5: la consulta de `/ventas/resumen`.** `tipoNotaCreditoDelTenant` sale de `resumen()`
  (no de la clase: otros lectores lo usan) junto con el comentario de su trampa:

  ```ts
  const rows: {
    total_ventas: number;
    total_bruto: string;
    total_notas_credito: string;
    total_facturado: string;
    saldo_pendiente: string;
  }[] = await this.db.query(
    `SELECT COUNT(*) FILTER (WHERE v.venta_referencia_id IS NULL)::int AS total_ventas,
            COALESCE(SUM(v.total_final)
              FILTER (WHERE v.venta_referencia_id IS NULL), 0)::text AS total_bruto,
            COALESCE(SUM(v.total_final)
              FILTER (WHERE v.venta_referencia_id IS NOT NULL), 0)::text AS total_notas_credito,
            COALESCE(SUM(CASE WHEN v.venta_referencia_id IS NULL THEN v.total_final
                              ELSE -v.total_final END), 0)::text AS total_facturado,
            COALESCE(SUM(<expresión>)
              FILTER (WHERE v.venta_referencia_id IS NULL), 0)::text AS saldo_pendiente
       FROM ventas v
      WHERE v.tenant_id = $1 AND v.eliminado_el IS NULL
        AND v.estado <> 'cancelada'
        ${filtroPropio}`,
    params,
  );
  ```

  Un comentario corto arriba: las correcciones son filas con `venta_referencia_id`, heredan la caja
  de la venta que corrigen y por eso `filtroPropio` las acota igual (spec § 3.3); las canceladas
  salen de los cuatro números (D9).

- [ ] **Step 6: alcance "mis cajas".** En `visibilidad-ventas-pagos.e2e-spec.ts`, con el cajero del
  archivo (sin "Ver todas"): leer su `/ventas/resumen`; el admin emite una NC sobre una venta de
  **otra** caja; volver a leer. Afirmar `totalNotasCredito` y `totalFacturado` sin cambio. Y el
  contra-caso: una NC sobre una venta de la caja del cajero sí le resta (lo que el filtro deja
  pasar).

- [ ] **Step 7: correr los tres e2e** (reset antes, `--verificar` después) → PASS.

- [ ] **Step 8: mutantes.** (a) Las dos consultas de hoy → caen 1.1, 1.2, 4.1 y 4.3. (b) Sin
  `GREATEST` → caen 1.1 y 4.2 en `−N`. (c) Sin el término del efectivo devuelto → cae 1.2 en `−N`. (d) Sin
  `estado <> 'cancelada'` → cae 4.3. (e) En `/ventas/resumen`, la Σ de correcciones sacada de una
  subconsulta sin `filtroPropio` → cae el Step 6.

- [ ] **Step 9: stagear y reportar.**

---

### Task 5: Frontend — el inicio y `/ventas` muestran el neto y su desglose

Spec § 3.4.

**Files:**
- Modify: `frontend/app/types/resumen-negocio.ts`
- Modify: `frontend/app/components/inicio/InicioVentas.vue`
- Modify: `frontend/app/pages/ventas/index.vue`
- Test: `frontend/app/components/inicio/InicioHoy.nuxt.spec.ts`
- Test: `frontend/app/pages/ventas/index.nuxt.spec.ts`
- Test: `frontend/e2e/inicio/dashboard.spec.ts`

**Interfaces:**
- Consumes: los campos de las Tasks 1, 2 y 4, con esos nombres exactos.

- [ ] **Step 1: skills.** Invocar `nuxt-ui` antes de escribir (memoria del proyecto).

- [ ] **Step 2: el espejo.** En `types/resumen-negocio.ts`, `VentasHoy` suma
  `vendidoDesglose: { bruto: string, notasCredito: string }` y
  `cobradoDesglose: { cobrado: string, devuelto: string }`, y los docblocks de `Comparado.variacion` y
  `ticketPromedio` copian los del backend (Task 1).

- [ ] **Step 3: tests de componente (fallan).** En `InicioHoy.nuxt.spec.ts`, sumar los desgloses al
  fixture y escribir: (a) con `notasCredito: '20000.0000'` se ve `bruto $300.000 · notas de crédito
  −$20.000`; (b) con `notasCredito: '0.0000'` esa línea no está; (c) lo mismo para
  `cobrado $X · devuelto −$Y`; (d) el texto "antes de notas de crédito" no aparece; (e) un vendido
  negativo (`'-7000.0000'`) se ve con su signo.

- [ ] **Step 4: `InicioVentas.vue`.** Sale el `<span>` del rótulo. Debajo de cada número grande, y
  antes del "vs.":

  ```vue
  <p v-if="hayNotas" class="text-xs text-muted">
    bruto {{ formatMonto(ventas.vendidoDesglose.bruto) }}
    · notas de crédito −{{ formatMonto(ventas.vendidoDesglose.notasCredito) }}
  </p>
  ```

  ```ts
  // Mostrar o no la línea es presentación, no una cuenta: el monto ya viene
  // calculado del backend.
  const hayNotas = computed(() => !new Decimal(props.ventas.vendidoDesglose.notasCredito).isZero())
  const hayDevuelto = computed(() => !new Decimal(props.ventas.cobradoDesglose.devuelto).isZero())
  ```

  `formatMonto` ya rinde un negativo con signo (`formatMontoManual`), así que el vendido negativo no
  necesita nada. Actualizar el comentario de cabecera del componente.

- [ ] **Step 5: `/ventas` (tests primero).** En `index.nuxt.spec.ts`, el mock de `/ventas/resumen`
  suma `totalBruto` y `totalNotasCredito`. Casos: (a) con notas se ve la línea bajo "Total
  facturado"; (b) sin notas, no; (c) cuando el drawer emite `updated`, la página vuelve a pedir
  `/ventas/resumen` (cuenta de llamadas al mock) en vez de recalcular el saldo.

- [ ] **Step 6: `pages/ventas/index.vue`.** `VentasResumenKpi` suma los dos campos; la misma línea
  que el inicio va bajo "Total facturado", con `v-if` sobre `totalNotasCredito`. En
  `onDetalleUpdated`, el bloque que hace `saldoPendiente − saldoAnterior + patch.saldo` se reemplaza
  por `void cargarResumen()`, con este comentario:

  ```ts
  // El resumen se vuelve a pedir: ya no se puede parchar con el saldo de la
  // fila. Una NC, una anulación o un cobro sobre una venta ya acreditada mueven
  // el resumen (que descuenta las NC con piso 0 y saca las canceladas) distinto
  // de lo que mueven el `saldo` de la fila, que sigue siendo total − pagado.
  ```

  No es un reintento: es la lectura que sigue a una operación que el usuario hizo y salió bien.

- [ ] **Step 7: Playwright.** En `dashboard.spec.ts`, los cinco usos de
  `tarjeta(page, '/ventas', 'antes de notas de crédito')` pasan a `'Ticket promedio'` (único de esa
  tarjeta). Un test nuevo, **como un usuario con `Resumen del negocio:Leer` que no es admin** (molde:
  "el encargado de salón ve el turno…"; el rol y el usuario se crean por API en el `beforeAll`, como
  el e2e de la API arma el suyo): emitir por API una NC sobre una venta del día y ver
  `notas de crédito −` en la tarjeta de ventas después de "Actualizar".

- [ ] **Step 8: correr.** `cd frontend && npm test && npm run typecheck:ratchet && npm run
  design:check`. Playwright: `./scripts/entorno.sh stack`, `./scripts/reset-db.sh`,
  `npm run e2e -- inicio/dashboard.spec.ts`.

- [ ] **Step 9: stagear y reportar.**

---

### Task 6: Docs, gate completo, verificación y entrada a `main`

**Files:**
- Modify: `docs/features/dashboard-inicio.md` (§ "Las reglas de plata": **reescribir** vendido,
  cobrado y por cobrar, no anexar; y la fila de `InicioVentas.vue`)
- Modify: `docs/features/ventas.md` (§ `GET /api/ventas/resumen`: respuesta con los dos campos y qué
  es cada número; las canceladas no cuentan)
- Modify: `docs/ESTADO.md` (la fila del dashboard: sale "rotulado 'antes de notas de crédito'"; fila
  o nota del frente con la fecha)
- Modify: `docs/agent/pendientes.md` → `docs/agent/resueltos.md` (la entrada se muda entera, con el
  detalle del fix; la sección queda solo con lo abierto)
- Delete: este plan y la spec, cuando el frente esté en `main` (`docs/superpowers/README.md`), con su
  conocimiento durable ya en `docs/features/`

- [ ] **Step 1: docs.** Escribir lo de arriba. La regla del número de hoy, el porqué de
  `venta_referencia_id` y lo que D10 deja mal a sabiendas van a `dashboard-inicio.md` y `ventas.md`;
  no se copia la spec.

- [ ] **Step 2: gate completo, con exit code** (no `| tail`):

  ```bash
  cd backend  && npm run lint:check && npm run typecheck && npm test && npm run test:e2e
  cd frontend && npm run build && npm test && npm run typecheck:ratchet && npm run design:check
  ```

  `./scripts/reset-db.sh` antes del `test:e2e` y `--verificar` después. Con tres o más sesiones
  activas, las suites pesadas van por turno.

- [ ] **Step 3: `verify-feature`** entero, con la revisión de la **rama completa** (no por tarea):
  ve si una tarea contradice a otra. Dudas concretas para el revisor: que las dos copias de la
  expresión del saldo sean idénticas; que ninguna consulta nueva lea una tabla sin
  `eliminado_el IS NULL`; que el `REFUND` y la salida de caja no se cuenten dos veces; que el
  `HAVING` no se haya perdido.

- [ ] **Step 4: smoke en el navegador** con la base reseteada antes, como el usuario con
  `Resumen del negocio:Leer` (no admin): inicio con una NC y una devolución en efectivo del día, y
  `/ventas` con la línea bajo "Total facturado".

- [ ] **Step 5: entrada a `main`.** Mirar que el checkout principal esté limpio; si no, reportar y
  esperar. Merge del worktree a `main`, push, y revisar el run de CI **por SHA** y el deploy de
  Railway.

- [ ] **Step 6: avisar a la orquestadora** ("Listado de sesiones activas") que el frente está en
  `main` con el SHA, y que las consultas de `resumen-negocio` y `/ventas/resumen` ya reconocen una
  corrección por `venta_referencia_id IS NOT NULL`: eso destraba al frente de emisión.

---

## Verification

| Escenario de la spec § 5 | Dónde |
|---|---|
| Venta de ayer + NC de hoy | Task 1, Step 6 |
| NC con `devolverDinero`; retiro ajeno no resta | Task 2, caso 1 |
| `REFUND` sin NC | Task 2, caso 2 |
| `REFUND` con NC, una sola vez | Task 2, caso 3 |
| Día con neto negativo, ticket y variación `null` | Task 1, unitarios (el e2e comparte la base con todo el día y no puede dejarlo negativo) |
| Lomito devuelto + ajuste; neto ≤ 0 fuera | Task 3 (el `HAVING` y el filtro de ajuste, supervivientes esperados y declarados) |
| `pagada_parcial` + NC por el resto | Task 4, casos 1.1 y 4.2 |
| Cancelada en `/ventas` | Task 4, caso 4.3 |
| Alcance "mis cajas" | Task 4, Step 6 |

## Decisions / Open questions

No hay preguntas de negocio abiertas. Dos decisiones técnicas que el owner ve al aprobar:

- **`/ventas` vuelve a pedir el resumen** después de un cobro, una anulación o una NC desde el
  drawer, en vez de parchar el saldo con la fila (Task 5, Step 6). Es una llamada más por operación.
  La razón está medida: el parche local suponía que el saldo de la fila es lo que esa venta aporta al
  resumen, y este frente lo deja de cumplir.
- **Los campos del desglose se llaman `notasCredito`**, como el rótulo que eligió el owner. Cuando el
  frente de emisión sume la devolución interna, esa fila también entra ahí (spec § 3.1). Si hace
  falta otro rótulo, lo decide ese frente.
