import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loginSegundoTenant } from './helpers/segundo-tenant';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
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

describe('Reporte de varianza (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;

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

    tokenAdmin = await login(app);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  function leer(token: string, query = ''): Promise<request.Response> {
    return request(app.getHttpServer())
      .get(`/api/reportes/varianza${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  describe('permiso y módulo contratado', () => {
    it('200 con lista paginada para el admin del tenant que contrató Varianza', async () => {
      const res = await leer(tokenAdmin);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray((res.body as { data: unknown[] }).data)).toBe(true);
      expect(res.body).toHaveProperty('meta.total');
      expect(res.body).toHaveProperty('meta.page');
      expect(res.body).toHaveProperty('meta.pageSize');
    });

    /**
     * El borde es COMERCIAL, no de aislamiento: el admin del segundo tenant no
     * ve datos ajenos, ve un módulo que su empresa no contrató. `userHasPermiso`
     * mira `tenant_modulos` también para el rol fijo, así que ni siquiera el
     * admin entra (`rbac.service.ts`). Por eso el seed le da `Varianza` a Paris
     * y NO al segundo tenant: sin esa asimetría este caso no existe.
     *
     * ⚠️ El segundo tenant se llama **Demo Bodega**, no "Falabella" — las
     * constantes del repo mienten (ver el docblock de `helpers/segundo-tenant`).
     */
    it('403 para el admin del segundo tenant, que no contrató el módulo', async () => {
      const tokenSegundoTenant = await loginSegundoTenant(app);

      const res = await leer(tokenSegundoTenant);

      expect(res.status).toBe(403);
    });

    it('401 sin token', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/reportes/varianza',
      );

      expect(res.status).toBe(401);
    });
  });

  describe('validación de la query', () => {
    it('400 si ubicacionId no es un uuid', async () => {
      const res = await leer(tokenAdmin, '?ubicacionId=no-es-uuid');

      expect(res.status).toBe(400);
    });

    it('400 si desde no es una fecha', async () => {
      const res = await leer(tokenAdmin, '?desde=ayer');

      expect(res.status).toBe(400);
    });

    /**
     * Fecha pura: es lo que emite `AppDateInput`, y el borde superior tiene que
     * resolverse con el día del NEGOCIO del tenant (`bordeHastaSql`), no con la
     * medianoche de calendario. Acá solo se verifica que el pipe la acepta y que
     * la consulta no revienta; que el día sea el correcto lo cubre la Tarea 2.
     */
    it('200 con fechas puras YYYY-MM-DD', async () => {
      const res = await leer(tokenAdmin, '?desde=2026-09-01&hasta=2026-09-30');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    /**
     * Un timestamp explícito también es válido (`@IsDateString()` lo acepta) y
     * NO se expande: quien lo manda pidió ese instante. El caso está acá porque
     * es el que tiró 500 en otros módulos — `requiereDiaNegocio` evita pushear
     * zona/corte cuando ningún borde es fecha pura, y sin eso Postgres rechaza
     * el bind con un parámetro que la consulta no nombra.
     */
    it('200 con un timestamp explícito, sin 500 por el bind', async () => {
      const res = await leer(
        tokenAdmin,
        '?desde=2026-09-01T15:30:00Z&hasta=2026-09-30T15:30:00Z',
      );

      expect(res.status).toBe(200);
    });
  });
});
