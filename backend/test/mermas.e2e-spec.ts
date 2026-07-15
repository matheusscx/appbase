import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CARNE_MOLIDA_ID = '550e8400-e29b-41d4-a716-446655440257';
const CAUSA_VENCIMIENTO_ID = '550e8400-e29b-41d4-a716-446655440266';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CausaMermaItem {
  id: string;
  nombre: string;
  esFijo: boolean;
}
interface MermaResponse {
  movimientoId: string;
  stockResultante: string;
  costoUnitario: string;
  costoPerdido: string;
  causaNombre: string;
}
interface MermaListItem {
  id: string;
  itemId: string;
  causaNombre: string | null;
  costoPerdido: string | null;
}
interface PaginatedMermas {
  data: MermaListItem[];
  meta: { total: number };
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

describe('Mermas — causas, registro y rechazo en ajuste (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let itemId: string;
  let roturaCausaId: string;
  let mermaMovimientoId: string;

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

  it('GET /causas-merma devuelve al menos 5 causas fijas del seed', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/causas-merma')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const causas = res.body as CausaMermaItem[];
    expect(Array.isArray(causas)).toBe(true);
    expect(causas.length).toBeGreaterThanOrEqual(5);

    const fijas = causas.filter((c) => c.esFijo);
    expect(fijas.length).toBeGreaterThanOrEqual(5);
    expect(fijas.some((c) => c.nombre === 'Vencimiento')).toBe(true);
  });

  it('POST /causas-merma crea causa custom Rotura envase', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/causas-merma')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Rotura envase' });

    expect(res.status).toBe(201);
    roturaCausaId = (res.body as { id: string }).id;
    expect(roturaCausaId).toBeDefined();
  });

  it('usa producto seed Carne molida con stock y costo', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${CARNE_MOLIDA_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    itemId = CARNE_MOLIDA_ID;
    expect(res.body.costoActual).toBeTruthy();
    expect(parseFloat(res.body.stock as string)).toBeGreaterThan(0);
  });

  it('POST /mermas registra merma con Vencimiento y costoPerdido', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        cantidad: '1',
        causaMermaId: CAUSA_VENCIMIENTO_ID,
        comentario: 'E2E merma vencimiento',
      });

    expect(res.status).toBe(201);
    const body = res.body as MermaResponse;
    mermaMovimientoId = body.movimientoId;
    expect(body.causaNombre).toBe('Vencimiento');
    expect(body.costoUnitario).toBeTruthy();
    expect(body.costoPerdido).toBeTruthy();
    expect(parseFloat(body.costoPerdido)).toBeGreaterThan(0);
  });

  it('GET /mermas incluye causaNombre y costoPerdido', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/mermas')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const list = res.body as PaginatedMermas;
    expect(list.data.length).toBeGreaterThan(0);

    const fila = list.data.find((m) => m.id === mermaMovimientoId);
    expect(fila).toBeDefined();
    expect(fila?.causaNombre).toBe('Vencimiento');
    expect(fila?.costoPerdido).toBeTruthy();
  });

  it('PATCH /items/:id/stock con motivo merma es rechazado (400)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'salida',
        motivo: 'merma',
        cantidad: 1,
      });

    expect(res.status).toBe(400);
  });

  it('PATCH causa fija y DELETE causa en uso devuelven 400', async () => {
    const resPatch = await request(app.getHttpServer())
      .patch(`/api/causas-merma/${CAUSA_VENCIMIENTO_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Vencimiento modificado' });
    expect(resPatch.status).toBe(400);

    const resMermaCustom = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        cantidad: '0.1',
        causaMermaId: roturaCausaId,
      });
    expect(resMermaCustom.status).toBe(201);

    const resDelete = await request(app.getHttpServer())
      .delete(`/api/causas-merma/${roturaCausaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDelete.status).toBe(400);
  });
});
