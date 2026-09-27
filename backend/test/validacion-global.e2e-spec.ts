import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { bodyPreferencias } from './helpers/preferencias';

/**
 * El pipe global rechaza lo que el DTO no declara (`forbidNonWhitelisted`,
 * 2026-09-27). Hasta esa fecha lo borraba en silencio y contestaba 200: el caso
 * que lo destapó fue `soloConVarianza` en el resumen de varianza, un filtro que
 * ese DTO no declara y que se descartaba sin que nadie se enterara.
 *
 * Este spec fija las dos mitades: que un campo de más es un 400 que lo nombra
 * —en el body y en la querystring—, y lo que el flag **no** toca a propósito:
 *
 * - `POST /auth/login`: el `LocalAuthGuard` lee el body antes de cualquier pipe
 *   y el handler no declara `@Body()`, así que no hay DTO que mirar.
 * - Los retornos de Webpay: leen campos sueltos con `@Body('x')`/`@Query('x')`,
 *   y Transbank manda campos que no controlamos (`TBK_ID_SESION`, entre otros).
 *   Si alguien los pasara a un `@Body() dto`, cada retorno con un campo que el
 *   DTO no nombre rebotaría con 400 y el pago quedaría colgado.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}

describe('ValidationPipe global (e2e) — lo no declarado es 400', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`,
    // que el e2e no ejecuta.
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
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
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('un campo de más en el body es 400 nombrándolo; sin él, el mismo body pasa', async () => {
    // El PUT de preferencias reemplaza la config entera: mandar la actual sin
    // cambios no mueve nada, y el control del 200 no deja estado sucio.
    const actual = await request(app.getHttpServer())
      .get('/api/tenants/preferencias-financieras')
      .set('Authorization', `Bearer ${token}`);
    expect(actual.status).toBe(200);
    const guardar = (body: object) =>
      request(app.getHttpServer())
        .put('/api/tenants/preferencias-financieras')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    const conCampo = await guardar({
      ...bodyPreferencias(actual.body as object),
      campoInventado: 'x',
    });
    expect(conCampo.status).toBe(400);
    expect(JSON.stringify(conCampo.body)).toContain(
      'property campoInventado should not exist',
    );

    const sinCampo = await guardar(bodyPreferencias(actual.body as object));
    expect(sinCampo.status).toBe(200);
  });

  it('un filtro que el DTO de la querystring no declara es 400, no un filtro que no filtra', async () => {
    const pedir = (extra: string) =>
      request(app.getHttpServer())
        .get(
          `/api/reportes/varianza/resumen?desde=2025-01-01&hasta=2025-12-31${extra}`,
        )
        .set('Authorization', `Bearer ${token}`);

    const conFiltro = await pedir('&soloConVarianza=true');
    expect(conFiltro.status).toBe(400);
    expect(JSON.stringify(conFiltro.body)).toContain(
      'property soloConVarianza should not exist',
    );

    expect((await pedir('')).status).toBe(200);
  });

  it('el login no pasa por el pipe: un campo de más no lo rechaza', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: ADMIN_PARIS.email,
        password: ADMIN_PARIS.pass,
        recordarme: true,
      });
    expect(res.status).toBe(200);
    expect((res.body as TokenResponse).access_token).toEqual(
      expect.any(String),
    );
  });

  describe('los retornos de Webpay aceptan campos que no controlamos', () => {
    // Sin token ni orden, el retorno llega al handler y es el propio
    // controller el que contesta 400 con SU mensaje. Si el pipe rechazara los
    // campos de más, el 400 vendría antes y nombraría el campo.
    const SIN_TOKEN = 'Retorno de pago sin token';

    it('POST /pasarela/retorno/pago', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/pasarela/retorno/pago')
        .send({ TBK_ID_SESION: 'sesion-e2e', campoDeTransbank: 'x' });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain(SIN_TOKEN);
      expect(JSON.stringify(res.body)).not.toContain('should not exist');
    });

    it('GET /pasarela/retorno/pago', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/pasarela/retorno/pago?TBK_ID_SESION=sesion-e2e&campoDeTransbank=x',
      );
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain(SIN_TOKEN);
      expect(JSON.stringify(res.body)).not.toContain('should not exist');
    });

    it('POST /pasarela/retorno/inscripcion', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/pasarela/retorno/inscripcion')
        .send({ TBK_ORDEN_COMPRA: 'orden-e2e', campoDeTransbank: 'x' });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('TBK_TOKEN requerido');
      expect(JSON.stringify(res.body)).not.toContain('should not exist');
    });
  });
});
