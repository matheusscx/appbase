import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * `docs/agent/pendientes.md` § 1 ("42 campos de fecha… `2026-02-31`, 500"),
 * punto 3 de la ronda de cierre: mide contra la API real (no el validador
 * suelto) la otra mitad del Grupo B — un campo `timestamptz` de bind
 * DIRECTO (sin pasar por `rango-fecha.util.ts`, sin `::date`), a diferencia
 * de los filtros `desde`/`hasta` que ya cubre `reportes-varianza.e2e-spec.ts`.
 * `item_producto.fecha_vencimiento` es el caso más simple: `CreateItemDto`
 * la bindea cruda en el `INSERT` (`items.service.ts`).
 *
 * Mismo hallazgo que en el filtro: `@IsDateString({ strict: true })` sola
 * acepta `2026-08` (sintácticamente ISO 8601, `isISO8601` con `strict` no lo
 * rechaza porque no tiene día) y Postgres lo rechaza recién al bindearlo
 * contra `timestamptz` (`'2026-08'::timestamptz` → 22007) → 500 sin fix.
 * `EsFechaOTimestamp()` (`common/decorators/fecha-pura.decorator.ts`) lo
 * ataja acá, en el pipe.
 */

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

interface TokenResponse {
  access_token: string;
}

describe('fecha_vencimiento (timestamptz, bind directo) — 2026-08 no es 500 (e2e)', () => {
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
    token = (resTenant.body as TokenResponse).access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  const crear = (fechaVencimiento: string) =>
    request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto fecha bind directo E2E ${Date.now()}-${Math.random()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        fechaVencimiento,
      });

  it('fechaVencimiento=2026-08 (sin día) → 400, no 500', async () => {
    const res = await crear('2026-08');
    expect(res.status).toBe(400);
  });

  it('fechaVencimiento=2026-02-31 (no existe en el calendario) → 400, no 500', async () => {
    const res = await crear('2026-02-31');
    expect(res.status).toBe(400);
  });

  it('fechaVencimiento con fecha pura real → 201, y con timestamp completo → 201', async () => {
    const resPura = await crear('2026-12-31');
    expect(resPura.status).toBe(201);

    const resTimestamp = await crear('2026-12-31T15:30:00Z');
    expect(resTimestamp.status).toBe(201);
  });
});
