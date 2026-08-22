import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
  costoActual: string | null;
  stock: string | null;
}
interface AjusteCostoResponse {
  movimientoId: string;
  costoAnterior: string | null;
  costoNuevo: string;
}
interface MovimientoListItem {
  motivo: string;
  cantidad: string;
  costoUnitario: string | null;
  costoAnterior: string | null;
}
interface PaginatedMovimientos {
  data: MovimientoListItem[];
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

/**
 * La venta `pendiente` (sin pagos) del test de anulación es del canal físico,
 * que exige una caja abierta — `online` no sirve: rechaza con "las ventas
 * online requieren el pago completo", y una venta pagada no es anulable.
 */
async function abrirCaja(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const disp = await request(app.getHttpServer())
    .get('/api/caja/cajones-disponibles')
    .set('Authorization', `Bearer ${token}`);
  const cajonId = (disp.body as Array<{ cajonId: string }>)[0]?.cajonId;
  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      cajonId,
      saldoInicial: '100000.0000',
      comentario: 'Apertura E2E costeo CPP',
    });
  expect([200, 201]).toContain(res.status);
  return (res.body as { id: string }).id;
}

/**
 * Cierra por las DOS fases reales (conteo → auto-cierre si cuadra). Sin esto
 * el cajón queda ocupado y la fuga reaparece como un `409` críptico al abrir
 * en otra suite. Mismo patrón que `recetas.e2e-spec.ts`.
 */
async function cerrarCaja(
  app: INestApplication<App>,
  token: string,
  cajaId: string,
): Promise<void> {
  const conteo = await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/conteo`)
    .set('Authorization', `Bearer ${token}`)
    .send({ lineas: [{ metodoPagoId: null, montoContado: '100000' }] });
  expect([200, 201]).toContain(conteo.status);
}

describe('Costeo CPP (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let itemId: string;
  let cajaId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    token = await login(app);
    cajaId = await abrirCaja(app, token);
  });

  afterAll(async () => {
    if (cajaId) await cerrarCaja(app, token, cajaId);
    await app.close();
  });

  it('la segunda compra promedia el costo en vez de pisarlo', async () => {
    // Crear producto propio con stock 0 y sin costo, para no depender del
    // stock acumulado del seed.
    const resCreate = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `CPP Test ${Date.now()}`,
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        stock: '0',
      });
    expect(resCreate.status).toBe(201);
    itemId = (resCreate.body as ItemResponse).id;

    // Compra 1: 10 unidades a 100 → costo 100
    const resCompra1 = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        cantidad: '10',
        tipo: 'entrada',
        motivo: 'compra',
        costoUnitario: '100',
      });
    expect(resCompra1.status).toBe(200);

    // Compra 2: 10 unidades a 200 → promedio 150 (con el bug daría 200)
    const resCompra2 = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        cantidad: '10',
        tipo: 'entrada',
        motivo: 'compra',
        costoUnitario: '200',
      });
    expect(resCompra2.status).toBe(200);

    const { body: detalle } = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(new Decimal((detalle as ItemResponse).costoActual!).toFixed(4)).toBe(
      '150.0000',
    );
  });

  /**
   * El escenario numérico exacto de la entrada 🚩 del backlog: anular una venta
   * reingresaba la mercadería al CPP **de hoy** y no al que salió, así que el
   * inventario se inflaba solo y contaminaba cada promedio posterior.
   * Decisión del owner (2026-08-15): vuelve al costo con el que salió, y el
   * promedio se recalcula incluyéndola.
   */
  it('anular una venta reingresa al costo con el que la unidad salió, no al CPP de hoy', async () => {
    const resCreate = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `CPP anulacion ${Date.now()}`,
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        stock: '0',
      });
    expect(resCreate.status).toBe(201);
    const anulacionItemId = (resCreate.body as ItemResponse).id;

    // 10 unidades a $50 → stock 10, CPP 50, valorizado en $500.
    await request(app.getHttpServer())
      .patch(`/api/items/${anulacionItemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        cantidad: '10',
        tipo: 'entrada',
        motivo: 'compra',
        costoUnitario: '50',
      })
      .expect(200);

    // Vende 1 (sin pagos: `pendiente` es el único estado anulable) → stock 9,
    // valorizado en $450. La salida congela en el kardex el costo $50.
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: anulacionItemId, cantidad: '1' }],
        pagos: [],
      });
    expect(resVenta.status).toBe(201);
    const ventaId = (resVenta.body as { id: string }).id;

    // Compra 5 a $70 → stock 14, CPP (450 + 350) / 14 = 57.1429.
    await request(app.getHttpServer())
      .patch(`/api/items/${anulacionItemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        cantidad: '5',
        tipo: 'entrada',
        motivo: 'compra',
        costoUnitario: '70',
      })
      .expect(200);

    const { body: antes } = await request(app.getHttpServer())
      .get(`/api/items/${anulacionItemId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((antes as ItemResponse).costoActual).toBe('57.1429');

    await request(app.getHttpServer())
      .post(`/api/ventas/${ventaId}/anular`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivo: 'Anulada para medir el costo de reingreso' })
      .expect(201);

    const { body: despues } = await request(app.getHttpServer())
      .get(`/api/items/${anulacionItemId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // La unidad vuelve a $50, no a $57,1429: el promedio se recalcula
    // incluyéndola → (14 × 57,1429 + 50) / 15 = 56,6667.
    // Con el bug el CPP quedaba intacto en 57,1429 y las 15 unidades
    // valorizaban $857,14: $7,14 que no entraron por ninguna compra.
    expect((despues as ItemResponse).stock).toBe('15.0000');
    expect((despues as ItemResponse).costoActual).toBe('56.6667');

    // Y el kardex congela el costo REAL de esa reposición, que es el dato que
    // ya existía ligado a la venta y no se leía.
    const { body: movs } = await request(app.getHttpServer())
      .get('/api/inventario/movimientos?motivo=anulacion&pageSize=100')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const delItem = (movs as PaginatedMovimientos).data.filter(
      (m) => m.cantidad === '1.0000' && m.costoUnitario === '50.0000',
    );
    expect(delItem.length).toBeGreaterThan(0);
  });

  it('compra en unidad no-base convierte cantidad y costo preservando el valor total', async () => {
    // Producto con unidad base 'g'; se compra en 'kg' (2 kg a $5.000/kg).
    const resCreate = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `CPP Conversión Test ${Date.now()}`,
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        stock: '0',
        unidadMedida: 'g',
      });
    expect(resCreate.status).toBe(201);
    const itemUnidadId = (resCreate.body as ItemResponse).id;

    const resCompra = await request(app.getHttpServer())
      .patch(`/api/items/${itemUnidadId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        cantidad: '2',
        tipo: 'entrada',
        motivo: 'compra',
        unidadCodigo: 'kg',
        costoUnitario: '5000',
      });
    expect(resCompra.status).toBe(200);
    expect(
      new Decimal((resCompra.body as { stock: string }).stock).toFixed(4),
    ).toBe('2000.0000');

    const { body: detalle } = await request(app.getHttpServer())
      .get(`/api/items/${itemUnidadId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Valor total preservado: 2 kg × 5.000/kg = 10.000 = 2000 g × 5/g.
    expect(new Decimal((detalle as ItemResponse).costoActual!).toFixed(4)).toBe(
      '5.0000',
    );
  });

  it('el ajuste de costo pisa el promedio y queda en el kardex', async () => {
    const { body } = await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId, costoNuevo: '250', comentario: 'Corrección de costo' })
      .expect(201);

    const ajuste = body as AjusteCostoResponse;
    expect(new Decimal(ajuste.costoNuevo).toFixed(4)).toBe('250.0000');
    expect(new Decimal(ajuste.costoAnterior!).toFixed(4)).toBe('150.0000');

    const { body: kardex } = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const mov = (kardex as PaginatedMovimientos).data.find(
      (m) => m.motivo === 'ajuste_costo',
    );
    expect(mov).toBeDefined();
    expect(mov?.cantidad).toBe('0.0000');
    expect(new Decimal(mov!.costoAnterior!).toFixed(4)).toBe('150.0000');
    expect(new Decimal(mov!.costoUnitario!).toFixed(4)).toBe('250.0000');
  });

  it('GET /inventario/movimientos?motivo=ajuste_costo trae el movimiento del ajuste', async () => {
    const { body: kardex } = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${itemId}&motivo=ajuste_costo`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const movimientos = (kardex as PaginatedMovimientos).data;
    expect(movimientos.length).toBeGreaterThan(0);
    expect(movimientos.every((m) => m.motivo === 'ajuste_costo')).toBe(true);
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

  it('PATCH /items/:id rechaza el costo con mensaje explícito', async () => {
    const { body } = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costo: '999' })
      .expect(400);

    expect(JSON.stringify(body.message)).toContain('Ajuste de costo');
  });

  it('PATCH /items/:id rechaza costo: null explícito (no es lo mismo que omitirlo)', async () => {
    const { body } = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costo: null })
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

  it('PATCH /items/:id rechaza el stock con mensaje explícito', async () => {
    const { body } = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stock: '999' })
      .expect(400);

    expect(JSON.stringify(body.message)).toContain('/items/:id/stock');
  });

  it('PATCH /items/:id rechaza stock: null explícito (no es lo mismo que omitirlo)', async () => {
    const { body } = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stock: null })
      .expect(400);

    expect(JSON.stringify(body.message)).toContain('/items/:id/stock');
  });

  it('POST /items sigue aceptando stock al crear (stock inicial vía inventario_inicial)', async () => {
    const resCreate = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `CPP Stock inicial Test ${Date.now()}`,
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        stock: '25',
      });
    expect(resCreate.status).toBe(201);
    const itemStockInicialId = (resCreate.body as ItemResponse).id;

    const { body: detalle } = await request(app.getHttpServer())
      .get(`/api/items/${itemStockInicialId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(new Decimal((detalle as ItemResponse).stock!).toFixed(4)).toBe(
      '25.0000',
    );
  });

  it('un ajuste_costo con stock 0 no bloquea cambiar modoInventario/unidadMedida después', async () => {
    // Producto nuevo, sin compras todavía: solo un ajuste_costo (corrige la
    // semilla antes de recibir mercadería — spec §6). No debe congelar el modo
    // ni la unidad, porque el ajuste no movió stock.
    const resCreate = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `CPP Ajuste sin stock ${Date.now()}`,
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        stock: '0',
        modoInventario: 'cantidad',
        costo: '50',
      });
    expect(resCreate.status).toBe(201);
    const itemSinStockId = (resCreate.body as ItemResponse).id;

    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId: itemSinStockId,
        costoNuevo: '80',
        comentario: 'Corrige el costo de la semilla',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/items/${itemSinStockId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ modoInventario: 'lote' })
      .expect(200);
  });
});
