import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';

/**
 * El alta de suscripción mostraba **"Precio del período" con `item.precioBase`**
 * —el neto del catálogo— mientras el backend le autorizaba a la tarjeta
 * `resultado.totales.totalFinal`, que sale del motor con impuestos aplicados. El
 * cliente confirmaba un número y se le cobraba otro un 19% mayor.
 *
 * El drawer ahora muestra el `totalFinal` del mismo endpoint que se ejercita
 * acá, así que este caso fija **los dos números concretos de la medición** y, de
 * paso, el ítem de seed sin el cual la pantalla se ve vacía y no hay nada que
 * mirar ni testear.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const SUSCRIPCION_DEMO_ID = '550e8400-e29b-41d4-a716-446655440352';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ResultadoVenta {
  totales: {
    subtotalNeto: string;
    totalImpuestos: string;
    totalFinal: string;
  };
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

describe('Precio de una suscripción: neto vs lo que se cobra (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

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

    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('el seed trae un ítem de suscripción, sin el cual la pantalla se ve vacía', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/items?tipo=suscripcion&pageSize=50')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const items = (res.body as { data: { id: string; precioBase: string }[] })
      .data;
    const demo = items.find((i) => i.id === SUSCRIPCION_DEMO_ID);
    expect(demo).toBeDefined();
    expect(demo!.precioBase).toBe('30000.0000');
  });

  it('el motor cobra 35.700 sobre un neto de 30.000: la diferencia que el drawer escondía', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/calculo-precios/calcular')
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId: SUSCRIPCION_DEMO_ID, cantidad: '1' }] });
    expect(res.status).toBe(201);

    const { totales } = res.body as ResultadoVenta;
    // El motor devuelve la escala de cálculo del tenant (6 decimales), no la de
    // la columna: se compara por valor, no por el string.
    expect(new Decimal(totales.subtotalNeto).toFixed(4)).toBe('30000.0000');
    expect(new Decimal(totales.totalImpuestos).toFixed(4)).toBe('5700.0000');
    // El número que de verdad se le autoriza a la tarjeta, y que ahora es el que
    // el drawer muestra en grande. Si alguien volviera a rotular `precioBase`,
    // la pantalla diría 30.000 y se cobrarían 35.700.
    expect(new Decimal(totales.totalFinal).toFixed(4)).toBe('35700.0000');

    // Y que no sean iguales es el punto: si el ítem del seed dejara de ser
    // afecto, este spec pasaría en verde sin probar nada.
    expect(new Decimal(totales.totalFinal).eq(totales.subtotalNeto)).toBe(
      false,
    );
  });
});
