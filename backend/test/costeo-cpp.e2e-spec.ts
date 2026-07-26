import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
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
}
interface AjusteCostoResponse {
  movimientoId: string;
  costoAnterior: string | null;
  costoNuevo: string;
}
interface MovimientoListItem {
  motivo: string;
  cantidad: string;
}
interface PaginatedMovimientos {
  data: MovimientoListItem[];
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  const initialToken = (resLogin.body as TokenResponse).access_token;

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

describe('Costeo CPP (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let itemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    token = await login(app);
  });

  afterAll(async () => {
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
        cantidad: 10,
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
        cantidad: 10,
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
});
