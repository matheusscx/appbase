import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * **Un id que entra por `@Query` se valida igual que uno que entra por `@Param`.**
 *
 * El 2026-09-03 se puso `ParseUUIDPipe` en los 148 `@Param` de UUID del backend
 * (`docs/patterns/backend.md` § 4), y el barrido se hizo grepeando `@Param`. Eso
 * dejó afuera **el otro mecanismo por el que un id llega desde el cliente**: los
 * `@Query('...')` crudos, que no pasan por ningún DTO y por lo tanto tampoco por
 * `class-validator`.
 *
 * Medido ese mismo día, después del fix de `@Param`: **las 4 rutas de acá seguían
 * en 500**. Misma causa exacta que el caso original —el string baja al service,
 * Postgres lo castea a `uuid`, falla con `22P02` y la excepción sin manejar sale
 * como error de servidor— y misma consecuencia: una alarma de monitoreo por un
 * request mal formado.
 *
 * ⚠️ **Por qué este spec existe y no alcanzaba con los DTO.** De los 124 campos
 * `*Id` de DTOs del backend, 121 ya traían `@IsUUID()`: por body el agujero
 * estaba cerrado. El hueco vivía justo en los 4 `@Query` que **no** tienen DTO,
 * que es la forma que un grep de DTOs no encuentra y un grep de `@Param` tampoco.
 *
 * 📌 Cada caso lleva su **control en 200 con un UUID válido** al lado. Sin eso el
 * test pasaría igual si el pipe rechazara todo, incluido lo bueno — y un
 * `nombre-disponible` que contesta 400 siempre rompe la pantalla de edición sin
 * que ningún test lo note.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };

// Sembrados en `seeder.service.ts`.
const DESCUENTO_FIJO_VENTA_ID = '550e8400-e29b-41d4-a716-446655440360';
const IVA_CL_ID = '550e8400-e29b-41d4-a716-446655440280';
const CHILE_PAIS_ID = '550e8400-e29b-41d4-a716-446655440001';

const NO_ES_UUID = 'no-es-uuid';

interface TokenResponse {
  access_token: string;
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
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

describe('Ids por query (e2e) — un UUID mal formado es 400, no 500', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`, que
    // el e2e no ejecuta. Sin esto corta con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    token = await login(app);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  /**
   * `excludeId` es el id que la pantalla de EDICIÓN se excluye a sí misma para
   * preguntar "¿este nombre está libre?" sin chocar con su propia fila. Los tres
   * módulos que tienen esa ruta lo reciben por query, sin DTO.
   */
  describe.each([
    ['descuentos', DESCUENTO_FIJO_VENTA_ID],
    ['impuestos', IVA_CL_ID],
    ['recargos', DESCUENTO_FIJO_VENTA_ID],
  ])('GET /%s/nombre-disponible', (modulo, idValido) => {
    it('responde 400 —no 500— si excludeId no tiene forma de UUID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${modulo}/nombre-disponible`)
        .query({ nombre: 'cualquiera', excludeId: NO_ES_UUID })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('sigue respondiendo 200 con un excludeId válido', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${modulo}/nombre-disponible`)
        .query({ nombre: 'cualquiera', excludeId: idValido })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    /**
     * `excludeId` es OPCIONAL: la pantalla de ALTA no manda ninguno, porque no
     * hay fila propia que excluir. El pipe va con `{ optional: true }` por esto,
     * y sin este caso el mutante que lo saca sobrevive: los dos tests de arriba
     * siempre mandan el parámetro.
     */
    it('sigue respondiendo 200 cuando no se manda excludeId (alta)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/${modulo}/nombre-disponible`)
        .query({ nombre: 'cualquiera' })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /catalog/provincias', () => {
    it('responde 400 —no 500— si paisId no tiene forma de UUID', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/catalog/provincias')
        .query({ paisId: NO_ES_UUID })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });

    it('sigue respondiendo 200 con un paisId válido', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/catalog/provincias')
        .query({ paisId: CHILE_PAIS_ID })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    /** Sin `paisId` devuelve todas las provincias: es el listado completo. */
    it('sigue respondiendo 200 sin paisId', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/catalog/provincias')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });
});
