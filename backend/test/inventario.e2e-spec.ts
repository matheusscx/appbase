import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Credentials seeded in dev (seed password: 'admin')
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
  costoActual: string | null;
  stock: string | null;
  unidadMedida: string | null;
}
interface MovimientoListItem {
  id: string;
  tipo: string;
  motivo: string;
  costoUnitario: string | null;
}
interface PaginatedMovimientos {
  data: MovimientoListItem[];
  meta: { total: number };
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  const initialToken = (resLogin.body as TokenResponse).access_token;

  // Switch to Paris tenant so token carries tenant_id
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

describe('Inventario — flujo de costo (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

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

  it('recorre el flujo completo de costo: creación, compra, edición manual y congelado en salida', async () => {
    // 1. Crear item producto con costo inicial 4000
    const resCreate = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto costo E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        costo: '4000',
      });

    expect(resCreate.status).toBe(201);
    const itemId = (resCreate.body as ItemResponse).id;
    expect(itemId).toBeDefined();

    const resGet1 = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resGet1.status).toBe(200);
    expect((resGet1.body as ItemResponse).costoActual).toBe('4000.0000');

    // 2. Entrada por compra con costoUnitario 4500 → costoActual sube a 4500
    const resCompra = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: 10,
        costoUnitario: '4500',
      });
    expect(resCompra.status).toBe(200);

    const resGet2 = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect((resGet2.body as ItemResponse).costoActual).toBe('4500.0000');

    // 3. El movimiento de compra quedó con costoUnitario 4500
    const resMovs1 = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resMovs1.status).toBe(200);
    const movs1 = (resMovs1.body as PaginatedMovimientos).data;
    const movCompra = movs1.find((m) => m.motivo === 'compra');
    expect(movCompra).toBeDefined();
    expect(movCompra?.costoUnitario).toBe('4500.0000');
    const cantidadMovimientosAntes = movs1.length;

    // 4. Edición manual de costo (sin pasar por stock) → costoActual = 4300, sin nuevo movimiento
    const resUpdate = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costo: '4300' });
    expect(resUpdate.status).toBe(200);

    const resGet3 = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect((resGet3.body as ItemResponse).costoActual).toBe('4300.0000');

    const resMovs2 = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    const movs2 = (resMovs2.body as PaginatedMovimientos).data;
    expect(movs2.length).toBe(cantidadMovimientosAntes);

    // 5. Salida por merma sin costoUnitario → congela el costo vigente (4300)
    const resMerma = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'salida',
        motivo: 'merma',
        cantidad: 1,
      });
    expect(resMerma.status).toBe(200);

    const resMovs3 = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    const movs3 = (resMovs3.body as PaginatedMovimientos).data;
    const movMerma = movs3.find((m) => m.motivo === 'merma');
    expect(movMerma).toBeDefined();
    expect(movMerma?.costoUnitario).toBe('4300.0000');

    // El costo actual no cambió por la salida
    const resGet4 = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect((resGet4.body as ItemResponse).costoActual).toBe('4300.0000');
  });

  it('convierte a la unidad base del producto en entradas y salidas', async () => {
    // 1. Producto stockeado en kg
    const resCreate = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto unidades E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'kg',
      });
    expect(resCreate.status).toBe(201);
    const itemId = (resCreate.body as ItemResponse).id;

    // 2. Entrada de 500 g → 0,5 kg
    const resCompra = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'entrada', motivo: 'compra', cantidad: 500, unidadCodigo: 'g' });
    expect(resCompra.status).toBe(200);

    const resGet1 = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect((resGet1.body as ItemResponse).stock).toBe('0.5000');

    // 3. Merma de 250 g → 0,25 kg
    const resMerma = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'salida', motivo: 'merma', cantidad: 250, unidadCodigo: 'g' });
    expect(resMerma.status).toBe(200);

    const resGet2 = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect((resGet2.body as ItemResponse).stock).toBe('0.2500');

    // 4. Cross-magnitud: litros sobre un producto en kg → rechazado
    const resCross = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'entrada', motivo: 'compra', cantidad: 1, unidadCodigo: 'l' });
    expect(resCross.status).toBe(400);

    // 5. Cambiar la unidad base con movimientos ya registrados → rechazado
    const resCambio = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ unidadMedida: 'g' });
    expect(resCambio.status).toBe(400);
  });

  it('rechaza crear un producto con una unidad fuera del catálogo', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto unidad inválida E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'inventada',
      });
    expect(res.status).toBe(400);
  });
});
