import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}

interface DesfaseRecetaResponse {
  recetaItemId: string;
  precioSugerido: string | null;
}

interface ItemDetalleResponse {
  id: string;
  costoActual: string | null;
  precioBase: string;
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

describe('Simulador impacto costos (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('compra → afectadas → aplicar con precio → sale de bandeja', async () => {
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Carne E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'kg',
        stock: '10',
        costo: '8000',
      });
    expect(resIng.status).toBe(201);
    const carneId = resIng.body.id as string;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Burger E2E ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: carneId,
            cantidad: '150',
            unidadCodigo: 'g',
            bloqueante: true,
          },
        ],
      });
    expect(resRec.status).toBe(201);
    const recetaId = resRec.body.id as string;
    // costo cacheado ≈ 8000 * 0.15 = 1200

    await request(app.getHttpServer())
      .patch(`/api/items/${carneId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '1',
        costoUnitario: '10000',
      })
      .expect(200);

    const afectadas = await request(app.getHttpServer())
      .get(`/api/items/${carneId}/recetas-afectadas`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (afectadas.body as DesfaseRecetaResponse[]).some(
        (r) => r.recetaItemId === recetaId,
      ),
    ).toBe(true);

    const fila = (afectadas.body as DesfaseRecetaResponse[]).find(
      (r) => r.recetaItemId === recetaId,
    );
    await request(app.getHttpServer())
      .post('/api/recetas/desfases/aplicar')
      .set('Authorization', `Bearer ${token}`)
      .send({
        items: [
          {
            recetaItemId: recetaId,
            actualizarPrecio: true,
            precioBase: fila?.precioSugerido ?? '4000',
          },
        ],
      })
      .expect(201);

    const bandeja = await request(app.getHttpServer())
      .get('/api/recetas/desfases')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (bandeja.body as DesfaseRecetaResponse[]).some(
        (r) => r.recetaItemId === recetaId,
      ),
    ).toBe(false);

    const detalle = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = detalle.body as ItemDetalleResponse;
    expect(body.costoActual).not.toBe('1200.0000');
    expect(body.precioBase).not.toBe('3500.0000');
  });

  it('descartar oculta hasta nuevo cambio de costo', async () => {
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Pan E2E ${Date.now()}`,
        precioBase: '500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '20',
        costo: '500',
      });
    expect(resIng.status).toBe(201);
    const panId = resIng.body.id as string;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Simple E2E ${Date.now()}`,
        precioBase: '2000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
      });
    expect(resRec.status).toBe(201);
    const recetaId = resRec.body.id as string;

    await request(app.getHttpServer())
      .patch(`/api/items/${panId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costo: '700' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/recetas/desfases/descartar')
      .set('Authorization', `Bearer ${token}`)
      .send({ recetaItemIds: [recetaId] })
      .expect(201);

    let bandeja = await request(app.getHttpServer())
      .get('/api/recetas/desfases')
      .set('Authorization', `Bearer ${token}`);
    expect(
      (bandeja.body as DesfaseRecetaResponse[]).some(
        (r) => r.recetaItemId === recetaId,
      ),
    ).toBe(false);

    await request(app.getHttpServer())
      .patch(`/api/items/${panId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costo: '800' })
      .expect(200);

    bandeja = await request(app.getHttpServer())
      .get('/api/recetas/desfases')
      .set('Authorization', `Bearer ${token}`);
    expect(
      (bandeja.body as DesfaseRecetaResponse[]).some(
        (r) => r.recetaItemId === recetaId,
      ),
    ).toBe(true);
  });

  it('aplicar sin checkbox no cambia precio_base', async () => {
    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Queso E2E ${Date.now()}`,
        precioBase: '100',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'kg',
        stock: '5',
        costo: '6000',
      });
    expect(resIng.status).toBe(201);
    const quesoId = resIng.body.id as string;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Con queso E2E ${Date.now()}`,
        precioBase: '2500.0000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: quesoId,
            cantidad: '20',
            unidadCodigo: 'g',
            bloqueante: false,
          },
        ],
      });
    expect(resRec.status).toBe(201);
    const recetaId = resRec.body.id as string;

    await request(app.getHttpServer())
      .patch(`/api/items/${quesoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costo: '9000' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/recetas/desfases/aplicar')
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ recetaItemId: recetaId, actualizarPrecio: false }] })
      .expect(201);

    const detalle = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detalle.body as ItemDetalleResponse).precioBase).toBe('2500.0000');
  });
});
