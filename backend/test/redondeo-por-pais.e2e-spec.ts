import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';

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

describe('Redondeo por país (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
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

    ds = app.get(DataSource);
    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('el token del admin de Paris sigue sirviendo', () => {
    expect(token).toBeTruthy();
  });

  describe('la regla que el país guarda', () => {
    it('un país no puede declarar "es ley" sin decir cuál es el valor que impone', async () => {
      // El CHECK es de la BASE, no del service: se prueba por SQL directo, que
      // es el único camino que lo puede violar. Un país mal cargado por el
      // futuro panel de superadmin dejaría el candado cerrado contra NULL y
      // ningún tenant de ese país podría guardar sus preferencias nunca más.
      await expect(
        ds.query(
          `INSERT INTO pais (pais_id, nombre, codigo_iso, zona_horaria_principal,
                             modo_redondeo_es_ley, creado_el, actualizado_el)
           VALUES ($1, 'Paisdeprueba', 'XX', 'UTC', true, NOW(), NOW())`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/chk_pais_modo_redondeo_ley/);
    });

    it('el mismo CHECK existe para la otra perilla — el candado es por perilla', async () => {
      await expect(
        ds.query(
          `INSERT INTO pais (pais_id, nombre, codigo_iso, zona_horaria_principal,
                             nivel_redondeo_es_ley, creado_el, actualizado_el)
           VALUES ($1, 'Paisdeprueba', 'XY', 'UTC', true, NOW(), NOW())`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/chk_pais_nivel_redondeo_ley/);
    });
  });
});
