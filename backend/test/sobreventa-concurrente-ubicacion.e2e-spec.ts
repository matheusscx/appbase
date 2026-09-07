import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import type { Server, AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

// Seed (IDs fijos, ver seeder.service.ts)
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUÉ PRUEBA ESTE SPEC Y QUÉ NO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PRUEBA: que dos salidas concurrentes del MISMO ítem en la MISMA ubicación no
 * sobrevenden. Con stock 10 y dos salidas de 6, una tiene que pasar y la otra
 * rebotar con "Stock insuficiente para la salida".
 *
 * POR QUÉ EXISTE: el saldo dejó de vivir en la fila que el chokepoint lockea
 * (`item_producto`) y pasó a `stock_ubicacion`. Bajo READ COMMITTED, cuando una
 * transacción despierta de un `FOR UPDATE`, Postgres re-evalúa (EvalPlanQual)
 * **solo la fila lockeada**: el resto del join se queda con el snapshot que el
 * statement tomó ANTES de encolarse. Mientras el saldo vivía en la fila
 * lockeada se refrescaba solo; leído por `LEFT JOIN` desde otra tabla, en el
 * MISMO statement que toma el lock, llega viejo. Medido antes del arreglo:
 * stock 10, dos salidas de 6, **pasaban las dos** — se vendieron 12 de 10, el
 * guard `stockResultante < 0` nunca disparó, y el `ON CONFLICT DO UPDATE`
 * (escritura absoluta, no `stock - $1`) dejó el saldo en 4 como si hubiera
 * habido una sola salida.
 *
 * El arreglo NO mueve el ancla del lock —sigue siendo `item_producto`, cuya
 * fila siempre existe, a diferencia de la de `stock_ubicacion`—: lee el saldo
 * en un **statement aparte, emitido ya con el lock en la mano**. Ese segundo
 * statement toma snapshot nuevo y ve lo que commiteó quien acaba de soltar el
 * lock. Ver `docs/patterns/backend.md` §15.
 *
 * CÓMO: el interleaving es DETERMINISTA, no una ráfaga probabilística. Una
 * compuerta (un `QueryRunner` propio, fuera de Nest) retiene con `FOR UPDATE`
 * la fila de `item_producto` —la misma que el chokepoint usa de ancla— mientras
 * las dos requests entran y se encolan detrás, y recién después la suelta:
 *
 *   compuerta: FOR UPDATE item_producto   → retiene la fila ancla
 *   request A: PATCH stock salida 6       → encola en el ancla
 *   request B: PATCH stock salida 6       → encola detrás de A
 *   compuerta: ROLLBACK                   → A entra, lee, escribe, commitea
 *                                         → B despierta con el lock en la mano
 *
 * Sin la compuerta las dos requests podrían no solaparse y el spec daría verde
 * sin ejercitar nada. `esperandoLockEnLaCompuerta` es lo único que separa este
 * verde del verde de un test mudo: `{ statuses: [200, 400] }` es TAMBIÉN la
 * salida de dos requests que corrieron una después de la otra. Contar los
 * esperadores (`pg_stat_activity.wait_event_type = 'Lock'`) justo ANTES de
 * soltar afirma que las dos estaban de verdad encoladas. Medido: 2.
 *
 * Se usa `PATCH /items/:id/stock` y no la venta porque es el camino más corto
 * al chokepoint: `ajustarStock` no tiene ningún pre-chequeo de saldo propio, así
 * que lo único que decide es el guard de `registrarMovimiento`. La venta pasa
 * por el mismo `registrarMovimiento` (`ventas.service.ts:872`) y encima sin lock
 * previo sobre `item_producto`, o sea que está igual de expuesta: cubrir el
 * chokepoint la cubre.
 *
 * NO PRUEBA:
 * - Modo `serie`/`lote`: `recalcularStockSerie` / `recalcularStockLote` derivan
 *   el saldo absoluto contando `item_unidad` / sumando `item_lote` DESPUÉS del
 *   guard, así que no pierden la actualización aunque el `stockAnterior` que
 *   reporten sea viejo. El caso que sobrevendía es `cantidad`, que escribe el
 *   saldo calculado a partir de esa lectura. (Y no, no hay `lote_ubicacion`
 *   todavía: el saldo del lote por ubicación llega en la Tarea 7 del plan.)
 * - Nada sobre traslados entre ubicaciones (Tarea 9): acá las dos salidas
 *   golpean la MISMA ubicación.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('Sobreventa concurrente sobre la misma ubicación (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let port: number;
  let itemId: string;
  let localId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`, que
    // el e2e no ejecuta. Sin esto corta con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);

    // Login en DOS pasos: el token de `/auth/login` de un usuario multi-tenant
    // sale con `tenant_id: null` y PermisosGuard lo rechaza con 403.
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;

    const ubic: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    localId = ubic[0].ubicacion_id;

    // Producto propio del spec, no un fixture compartido: este test se come el
    // stock que planta, y compartirlo lo volvería dependiente del orden de las
    // suites.
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Sobreventa concurrente E2E ${Date.now()}`,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '10',
        costo: '500',
      });
    expect(resItem.status).toBe(201);
    itemId = (resItem.body as ItemResponse).id;

    // El escenario tiene que arrancar con 10 EN EL LOCAL. Afirmarlo acá y no
    // deducirlo: si el alta plantara el stock en otra ubicación, las dos salidas
    // rebotarían por saldo cero y el spec daría rojo por el motivo equivocado.
    const saldo: { stock: string }[] = await ds.query(
      `SELECT stock FROM stock_ubicacion WHERE item_id = $1 AND ubicacion_id = $2`,
      [itemId, localId],
    );
    expect(saldo).toHaveLength(1);
    expect(Number(saldo[0].stock)).toBe(10);

    // Por HTTP real contra un puerto bindeado: dos requests concurrentes de
    // verdad, no dos llamadas de supertest sobre el mismo agente.
    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      // El host va explícito por la misma razón que en `setup-supertest.ts`:
      // `listen(0)` bindea el wildcard y acá abajo se le habla a 127.0.0.1, y
      // ese desencuentro es el `401` fantasma.
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
    }
    port = (server.address() as AddressInfo).port;
  }, 120000);

  afterAll(async () => {
    // Acumular fallos de limpieza y afirmar DESPUÉS de `app.close()`: un expect
    // que tira antes de cerrar deja el pool abierto y jest no termina nunca
    // (patrón de concurrencia-pool.e2e-spec.ts:93).
    const fallos: string[] = [];
    try {
      if (itemId) {
        const res = await request(app.getHttpServer())
          .delete(`/api/items/${itemId}`)
          .set('Authorization', `Bearer ${token}`);
        if (res.status !== 200) fallos.push(`DELETE item: ${res.status}`);
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  /** Sesiones frenadas en un lock ahora mismo. Es lo que separa el verde real
   * del verde de una compuerta que no enganchó. */
  const esperandoLock = async (): Promise<number> => {
    const filas: { count: string }[] = await ds.query(
      `SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    return Number(filas[0].count);
  };

  const salida = (cantidad: string) => () =>
    fetch(`http://127.0.0.1:${port}/api/items/${itemId}/stock`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tipo: 'salida',
        motivo: 'ajuste_manual',
        cantidad,
        comentario: 'Sobreventa concurrente E2E',
      }),
    });

  it('dos salidas de 6 sobre un stock de 10 no pasan las dos', async () => {
    const compuerta = ds.createQueryRunner();
    let esperandoLockEnLaCompuerta = -1;
    let statuses: number[] = [];
    let cuerpos: unknown[] = [];
    try {
      await compuerta.connect();
      await compuerta.startTransaction();
      // La MISMA fila que el chokepoint usa de ancla (`FOR UPDATE OF ip`).
      await compuerta.query(
        `SELECT item_id FROM item_producto WHERE item_id = $1 FOR UPDATE`,
        [itemId],
      );

      const primera = salida('6')();
      // 600 ms: sobra para que la request llegue al chokepoint y se encole. Es
      // el único punto sensible al tiempo, y solo puede fallar de más — por eso
      // se cuentan los esperadores antes de soltar.
      await dormir(600);
      const segunda = salida('6')();
      await dormir(600);

      esperandoLockEnLaCompuerta = await esperandoLock();
      await compuerta.rollbackTransaction();

      const [rPrimera, rSegunda] = await Promise.all([primera, segunda]);
      statuses = [rPrimera.status, rSegunda.status].sort((a, b) => a - b);
      cuerpos = await Promise.all([rPrimera.json(), rSegunda.json()]);
    } finally {
      // Sin esto, un throw arriba se lleva el `release()` puesto y deja la
      // conexión colgada: una falla ruidosa se convierte en un cuelgue.
      if (compuerta.isTransactionActive) await compuerta.rollbackTransaction();
      await compuerta.release();
    }

    // Las dos estaban encoladas de verdad. Sin esto el spec podría estar
    // midiendo dos requests que corrieron una después de la otra.
    expect(esperandoLockEnLaCompuerta).toBe(2);
    // Una pasa, la otra rebota. Antes del arreglo: `[200, 200]`.
    expect(statuses).toEqual([200, 400]);
    expect(JSON.stringify(cuerpos)).toContain(
      'Stock insuficiente para la salida',
    );

    // El saldo final. NO alcanza por sí solo para cazar el bug —con la
    // escritura absoluta del `ON CONFLICT DO UPDATE`, las dos salidas dejaban
    // 4 igual— pero fija que la que sí pasó descontó una vez.
    const saldo: { stock: string }[] = await ds.query(
      `SELECT stock FROM stock_ubicacion WHERE item_id = $1 AND ubicacion_id = $2`,
      [itemId, localId],
    );
    expect(Number(saldo[0].stock)).toBe(4);

    // Y el kardex: UNA sola salida, con el saldo previo real. Esto sí distingue
    // el arreglo de un parche que hubiera dejado pasar las dos y escrito bien
    // el saldo: con el bug hay dos movimientos, los dos con `stock_anterior` 10.
    const movs: { stock_anterior: string; stock_resultante: string }[] =
      await ds.query(
        `SELECT stock_anterior, stock_resultante FROM movimientos_inventario
          WHERE item_id = $1 AND tipo = 'salida' AND eliminado_el IS NULL`,
        [itemId],
      );
    expect(movs).toHaveLength(1);
    expect(Number(movs[0].stock_anterior)).toBe(10);
    expect(Number(movs[0].stock_resultante)).toBe(4);
  }, 60000);
});
