import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { MAX_PAGE } from '../src/common/utils/pagination.util';

/**
 * Una página cuyo `OFFSET` no cabe en un `bigint` daba 500 en todas las rutas paginadas
 * (medido el 2026-10-03 en `/compras/productos`, `/items` y `/compras`): `page` no tenía
 * tope. Ahora `PaginationQueryDto.page` lleva `@Max(MAX_PAGE)` y eso es 400.
 *
 * Todas las rutas paginadas leen `page` por el mismo mecanismo —`@Query()` con un DTO que
 * es `PaginationQueryDto` o lo extiende; ninguna lo lee crudo—, así que se recorre una de
 * cada forma: la clase base (`/traslados`) y dos subclases (`/items`, `/compras/productos`).
 * Mutante: sin el `@Max`, la página enorme vuelve a dar 500 en las tres.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };

const RUTAS = ['/api/traslados', '/api/items', '/api/compras/productos'];

interface TokenResponse {
  access_token: string;
}

async function entrar(app: INestApplication<App>): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN.email, password: ADMIN.pass });
  expect(login.status).toBe(200);

  const enTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
    .set(
      'Authorization',
      `Bearer ${(login.body as TokenResponse).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(enTenant.status).toBe(200);
  return (enTenant.body as TokenResponse).access_token;
}

describe('Paginación: page tiene tope (e2e)', () => {
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

    token = await entrar(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const pedir = (ruta: string, page: string) =>
    request(app.getHttpServer())
      .get(`${ruta}?page=${page}&pageSize=100`)
      .set('Authorization', `Bearer ${token}`);

  it.each(RUTAS)(
    '%s: la página que daba 500 es un 400 que nombra page',
    async (ruta) => {
      const res = await pedir(ruta, '99999999999999999999');
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('page');
    },
  );

  it.each(RUTAS)(
    '%s: la última página permitida da 200 vacía, y la siguiente 400',
    async (ruta) => {
      const ultima = await pedir(ruta, String(MAX_PAGE));
      expect(ultima.status).toBe(200);
      expect((ultima.body as { data: unknown[] }).data).toEqual([]);

      const siguiente = await pedir(ruta, String(MAX_PAGE + 1));
      expect(siguiente.status).toBe(400);
    },
  );
});
