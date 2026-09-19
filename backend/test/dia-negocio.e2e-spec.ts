import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const PASS = 'admin';

interface TokenResponse {
  access_token: string;
}

/**
 * El día del negocio: la hora de corte (`tenants.hora_corte`) configurable de
 * 0 a 6 y cómo la usan los reportes que dependen de "qué día es hoy". Esta
 * suite crece por tarea del plan (docs/superpowers/specs/
 * 2026-09-18-hora-de-corte-dia-negocio-design.md); por ahora solo cubre la
 * Tarea 1 — el dato y su configuración vía `PATCH /tenants/me`.
 */
describe('Día del negocio: hora de corte (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  /** Fija el corte del tenant y espera 200. */
  async function fijarCorte(horaCorte: number): Promise<void> {
    const res = await request(app.getHttpServer())
      .patch('/api/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ horaCorte });
    expect(res.status).toBe(200);
  }

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

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: PASS });
    expect(resLogin.status).toBe(200);
    const resSwitch = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resSwitch.status).toBe(200);
    token = (resSwitch.body as TokenResponse).access_token;
  });

  afterAll(async () => {
    try {
      // El corte vuelve a 0: ningún reporte posterior de otra suite hereda un
      // corte distinto de medianoche.
      await fijarCorte(0);
    } finally {
      await app.close();
    }
  });

  describe('configuración', () => {
    it('PATCH guarda el corte y GET lo devuelve', async () => {
      await fijarCorte(5);
      const res = await request(app.getHttpServer())
        .get('/api/tenants/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect((res.body as { horaCorte: number }).horaCorte).toBe(5);
      await fijarCorte(0);
    });

    it.each([7, -1, 2.5])('rechaza %p con 400', async (horaCorte) => {
      const res = await request(app.getHttpServer())
        .patch('/api/tenants/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ horaCorte });
      expect(res.status).toBe(400);
    });
  });
});
