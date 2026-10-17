import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { calcularProximoCobro } from '../src/modules/suscripciones/utils/proximo-cobro.util';

/**
 * Auditoría UX 09.9: antes de suscribirse la pantalla debe decir "el siguiente
 * cobro es el …". La fecha la calcula el servidor con la MISMA función que el
 * alta (`calcularProximoCobro`); la pantalla nunca la calcula.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
// Ítem de suscripción del seed (frecuencia mensual).
const SUSCRIPCION_DEMO_ID = '550e8400-e29b-41d4-a716-446655440352';

interface TokenResponse {
  access_token: string;
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: 'admin.paris@paris.cl', password: 'admin' });
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

describe('Suscripciones: fecha del siguiente cobro antes del alta (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const consultar = (query: string, conToken = true) => {
    const req = request(app.getHttpServer()).get(
      `/api/suscripciones/proximo-cobro?${query}`,
    );
    return conToken ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('devuelve la misma fecha que guardaría el alta', async () => {
    const res = await consultar(`itemId=${SUSCRIPCION_DEMO_ID}&diaMes=10`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      proximoCobro: calcularProximoCobro('mensual', new Date(), 10),
    });
  });

  it('rechaza con 400 un mensual sin día del mes (misma regla que el alta)', async () => {
    const res = await consultar(`itemId=${SUSCRIPCION_DEMO_ID}`);
    expect(res.status).toBe(400);
  });

  it('rechaza con 400 un día fuera de rango', async () => {
    const res = await consultar(`itemId=${SUSCRIPCION_DEMO_ID}&diaMes=29`);
    expect(res.status).toBe(400);
  });

  it('rechaza con 400 un ítem que no es una suscripción', async () => {
    const lista = await request(app.getHttpServer())
      .get('/api/items?tipo=producto&pageSize=1')
      .set('Authorization', `Bearer ${token}`);
    expect(lista.status).toBe(200);
    const producto = (lista.body as { data: { id: string }[] }).data[0];
    const res = await consultar(`itemId=${producto.id}&diaMes=10`);
    expect(res.status).toBe(400);
  });

  it('exige sesión', async () => {
    const res = await consultar(
      `itemId=${SUSCRIPCION_DEMO_ID}&diaMes=10`,
      false,
    );
    expect(res.status).toBe(401);
  });
});
