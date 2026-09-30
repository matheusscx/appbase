import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * `GET /items` para el rol **Salón** (`ana.torres@paris.cl`) — Tarea 4 de
 * `docs/superpowers/plans/2026-09-30-impresion-quien-opera.md`, decisión del
 * owner en `docs/agent/pendientes.md` § 3 ("Enviar a cocina exige
 * `Impresoras:Leer`"): el rol sembrado del garzón recibe `Items:Leer`
 * (`seedRolSalon`) — sin él, `refrescarItems()` (`/salones`) le rebotaba 403
 * y no podía cargar ningún pedido. Medido antes de sembrarlo: con
 * `Items:Leer` el garzón ve `costoActual`/stock igual que `Vendedor` (POS),
 * que ya tenía este mismo permiso — el owner eligió dárselo igual.
 *
 * Antes del seed nuevo esto daba 403 (medido contra la base, no por un e2e:
 * no había ninguno que lo cubriera). El mutante de este archivo es sacar
 * `Items:Leer` de `seedRolSalon` — con eso, este test vuelve a fallar.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const GARZON = { email: 'ana.torres@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}

async function entrar(
  app: INestApplication<App>,
  email: string,
  pass: string,
): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: pass });
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

describe('GET /items — el rol Salón tiene Items:Leer (e2e)', () => {
  let app: INestApplication<App>;
  let tokenGarzon: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();

    tokenGarzon = await entrar(app, GARZON.email, GARZON.pass);
  });

  afterAll(async () => {
    await app.close();
  });

  it('ana.torres (rol Salón) obtiene 200, con el catálogo del tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/items')
      .set('Authorization', `Bearer ${tokenGarzon}`);
    expect(res.status).toBe(200);
    // No vacuo: el 200 tiene que venir con datos reales del tenant, no un
    // array vacío que pasaría igual si el guard filtrara todo por error.
    const body = res.body as { data?: unknown[] } | unknown[];
    const data = Array.isArray(body) ? body : body.data;
    expect(Array.isArray(data)).toBe(true);
    expect((data as unknown[]).length).toBeGreaterThan(0);
  });
});
