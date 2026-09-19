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
interface IdResponse {
  id: string;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUÉ PRUEBA ESTE SPEC Y QUÉ NO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PRUEBA: el gemelo de `traslado-borrado-ubicacion-concurrente.e2e-spec.ts`
 * para todo lo que escribe en una ubicación SIN ser un traslado. Medido el
 * 2026-09-18 antes del arreglo: `UbicacionesService.remove` toma `FOR UPDATE`
 * sobre la ubicación y cuenta el saldo, pero `registrarMovimiento` no tomaba
 * nada sobre esa fila. Un ajuste de stock hacia una bodega y el borrado de esa
 * bodega terminaban los dos bien, y el saldo quedaba colgado de una bodega
 * borrada: fuera de `GET /items` y del peso del CPP. Disparados a la vez, pasó
 * en todas las repeticiones. Y sin carrera: un recuento abierto sobre una
 * bodega vacía dejaba borrarla, y al aplicarlo escribía su delta ahí.
 *
 * El arreglo: `registrarMovimiento` y el alta de un recuento toman
 * `UbicacionesService.bloquearContraBorrado` (`FOR SHARE`), y `remove()`
 * rechaza la bodega con un recuento abierto (decisión del owner).
 *
 * CÓMO (caso 1): compuerta determinista, misma técnica que el gemelo. Retiene
 * con `FOR UPDATE` la fila de `item_producto`:
 *
 *   compuerta: FOR UPDATE item_producto  → retiene la fila ancla
 *   ajuste:    PATCH /items/:id/stock     → FOR SHARE sobre la bodega y se
 *                                            encola en el ancla
 *   borrado:   DELETE /ubicaciones/:id    → FOR UPDATE sobre la bodega: se
 *                                            encola DETRÁS del ajuste
 *   compuerta: ROLLBACK                   → el ajuste escribe y commitea; el
 *                                            borrado cuenta 5 y rebota con 400
 *
 * Sin el arreglo el borrado no tiene nada que lo frene: termina con la
 * compuerta todavía cerrada, y `esperandoLock` da 1 en vez de 2.
 *
 * NO PRUEBA:
 * - El lado simétrico (el borrado gana y el movimiento llega después) con una
 *   compuerta propia: no hay forma determinista de encolar el `FOR SHARE`
 *   detrás del `FOR UPDATE` del borrado sin tomar esa misma fila. Lo cubre el
 *   caso 2, sin garantía de que cada repetición caiga de ese lado, y el
 *   unitario de `bloquearContraBorrado` (rechaza la ubicación borrada).
 * - La carrera entre el alta de un recuento y el borrado: la fija el unitario
 *   de `RecuentosService.create`, que afirma el lock.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('Borrado de una bodega contra quien escribe stock en ella sin ser un traslado (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let port: number;
  const aLimpiar: { itemId: string; bodegaId: string }[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);

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

    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
    }
    port = (server.address() as AddressInfo).port;
  }, 120000);

  afterAll(async () => {
    // Acumular fallos y afirmar DESPUÉS de `app.close()`: un expect que tira
    // antes de cerrar deja el pool abierto y jest no termina nunca.
    const fallos: string[] = [];
    try {
      for (const { itemId, bodegaId } of aLimpiar) {
        // Si la bodega quedó borrada con saldo (código sin el arreglo), la
        // papelera es la única forma de sacarlo por API. Con el arreglo la
        // bodega está viva y esto da 404.
        const r = await request(app.getHttpServer())
          .post(`/api/ubicaciones/${bodegaId}/restaurar`)
          .set('Authorization', `Bearer ${token}`)
          .send({});
        if (![200, 201, 404].includes(r.status)) {
          fallos.push(`restaurar ${bodegaId}: ${r.status}`);
        }
        const saldo: { stock: string }[] = await ds.query(
          `SELECT stock FROM stock_ubicacion WHERE item_id = $1 AND ubicacion_id = $2`,
          [itemId, bodegaId],
        );
        if (saldo.length && Number(saldo[0].stock) !== 0) {
          const s = await request(app.getHttpServer())
            .patch(`/api/items/${itemId}/stock`)
            .set('Authorization', `Bearer ${token}`)
            .send({
              tipo: 'salida',
              motivo: 'ajuste_manual',
              ubicacionId: bodegaId,
              cantidad: saldo[0].stock,
            });
          if (s.status !== 200) fallos.push(`salida ${bodegaId}: ${s.status}`);
        }
        const d = await request(app.getHttpServer())
          .delete(`/api/ubicaciones/${bodegaId}`)
          .set('Authorization', `Bearer ${token}`);
        if (d.status !== 204 && d.status !== 404) {
          fallos.push(`DELETE ubicación ${bodegaId}: ${d.status}`);
        }
        const di = await request(app.getHttpServer())
          .delete(`/api/items/${itemId}`)
          .set('Authorization', `Bearer ${token}`);
        if (di.status !== 200)
          fallos.push(`DELETE item ${itemId}: ${di.status}`);
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  }, 120000);

  // Bodega e ítem PROPIOS de cada caso: la bodega se borra (o se intenta)
  // durante el test, así que compartirla lo volvería dependiente del orden.
  const crearBodegaEItem = async (etiqueta: string) => {
    const resBodega = await request(app.getHttpServer())
      .post('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Bodega ${etiqueta} E2E ${Date.now()}-${Math.random()}`,
        tipo: 'bodega',
      });
    expect(resBodega.status).toBe(201);
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Item ${etiqueta} E2E ${Date.now()}-${Math.random()}`,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
      });
    expect(resItem.status).toBe(201);
    const par = {
      bodegaId: (resBodega.body as IdResponse).id,
      itemId: (resItem.body as IdResponse).id,
    };
    aLimpiar.push(par);
    return par;
  };

  /** Sesiones frenadas en un lock ahora mismo. Es lo que separa el verde real
   * del verde de una compuerta que no enganchó. */
  const esperandoLock = async (): Promise<number> => {
    const filas: { count: string }[] = await ds.query(
      `SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    return Number(filas[0].count);
  };

  const ajusteEntrada = (itemId: string, bodegaId: string) =>
    fetch(`http://127.0.0.1:${port}/api/items/${itemId}/stock`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        tipo: 'entrada',
        motivo: 'compra',
        ubicacionId: bodegaId,
        cantidad: '5',
        costoUnitario: '500',
      }),
    });

  const borrar = (bodegaId: string) =>
    fetch(`http://127.0.0.1:${port}/api/ubicaciones/${bodegaId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

  const saldoColgado = async (itemId: string, bodegaId: string) => {
    const filas: { stock: string }[] = await ds.query(
      `SELECT su.stock FROM stock_ubicacion su
         JOIN ubicaciones u ON u.ubicacion_id = su.ubicacion_id
        WHERE su.item_id = $1 AND su.ubicacion_id = $2
          AND u.eliminado_el IS NOT NULL AND su.stock <> 0`,
      [itemId, bodegaId],
    );
    return filas.length > 0;
  };

  it('1 · el ajuste que está escribiendo stock en la bodega gana: el borrado espera y rebota con 400', async () => {
    const { itemId, bodegaId } = await crearBodegaEItem('carrera ajuste');

    const compuerta = ds.createQueryRunner();
    let esperandoLockEnLaCompuerta = -1;
    let statusAjuste = -1;
    let statusBorrado = -1;
    let cuerpoBorrado: unknown = null;
    try {
      await compuerta.connect();
      await compuerta.startTransaction();
      // La MISMA fila que `registrarMovimiento` usa de ancla (`FOR UPDATE OF ip`).
      await compuerta.query(
        `SELECT item_id FROM item_producto WHERE item_id = $1 FOR UPDATE`,
        [itemId],
      );

      const ajuste = ajusteEntrada(itemId, bodegaId);
      // El ajuste toma su `FOR SHARE` sobre la bodega antes de encolarse en
      // la compuerta: 600ms sobra para que ya lo tenga.
      await dormir(600);
      const borrado = borrar(bodegaId);
      await dormir(600);

      esperandoLockEnLaCompuerta = await esperandoLock();
      await compuerta.rollbackTransaction();

      const [rAjuste, rBorrado] = await Promise.all([ajuste, borrado]);
      statusAjuste = rAjuste.status;
      statusBorrado = rBorrado.status;
      cuerpoBorrado = await rBorrado.json();
    } finally {
      if (compuerta.isTransactionActive) await compuerta.rollbackTransaction();
      await compuerta.release();
    }

    // Las dos estaban encoladas de verdad: el ajuste en la compuerta, el
    // borrado detrás del `FOR SHARE` del ajuste.
    expect(esperandoLockEnLaCompuerta).toBe(2);
    expect(statusAjuste).toBe(200);
    expect(statusBorrado).toBe(400);
    expect(JSON.stringify(cuerpoBorrado)).toContain('todavía tiene');

    // La bodega sigue viva, y el catálogo cuenta las 5 unidades.
    const ubic: { eliminado_el: string | null }[] = await ds.query(
      `SELECT eliminado_el FROM ubicaciones WHERE ubicacion_id = $1`,
      [bodegaId],
    );
    expect(ubic[0].eliminado_el).toBeNull();
    const item = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(item.status).toBe(200);
    expect((item.body as { stock: string }).stock).toBe('5.0000');
  }, 60000);

  it('2 · sin compuerta, ajuste y borrado disparados a la vez: nunca queda saldo colgado', async () => {
    // Antes del arreglo: 20 de 20 colgados (ajuste 200, borrado 204). Con el
    // arreglo gana uno de los dos, y el otro se entera.
    const esperados = new Set(['200/400', '404/204']);
    const vistos: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { itemId, bodegaId } = await crearBodegaEItem(`carrera ${i}`);
      const [rA, rB] = await Promise.all([
        ajusteEntrada(itemId, bodegaId),
        borrar(bodegaId),
      ]);
      vistos.push(`${rA.status}/${rB.status}`);
      expect(await saldoColgado(itemId, bodegaId)).toBe(false);
    }
    expect(vistos.filter((v) => !esperados.has(v))).toEqual([]);
  }, 180000);

  it('3 · una bodega con un recuento abierto no se borra; cancelado el recuento, sí', async () => {
    const { itemId, bodegaId } = await crearBodegaEItem('recuento');

    const resCrear = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ ubicacionId: bodegaId, itemIds: [itemId] });
    expect(resCrear.status).toBe(201);
    const recuentoId = (resCrear.body as IdResponse).id;

    // La bodega está vacía: lo único que frena el borrado es el recuento.
    const resBorrado = await request(app.getHttpServer())
      .delete(`/api/ubicaciones/${bodegaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resBorrado.status).toBe(400);
    expect(JSON.stringify(resBorrado.body)).toContain('recuento abierto');

    const resCancelar = await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/cancelar`)
      .set('Authorization', `Bearer ${token}`);
    expect(resCancelar.status).toBe(201);

    const resBorrado2 = await request(app.getHttpServer())
      .delete(`/api/ubicaciones/${bodegaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resBorrado2.status).toBe(204);
  }, 60000);
});
