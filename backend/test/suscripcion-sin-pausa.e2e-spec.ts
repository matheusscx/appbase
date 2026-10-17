import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };
const PLAN_MENSUAL_DEMO = '550e8400-e29b-41d4-a716-446655440352'; // seedSuscripcionDemo

/**
 * Las suscripciones no se pausan (owner, 2026-10-17, 09.8): "o está suscrito
 * vigente o se da de baja". `pausar` y `reanudar` no existen: el DTO las
 * rechaza con 400 y la suscripción queda como estaba. Dar de baja sigue.
 */
describe('Suscripciones: no se pausan (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let usuarioId: string;

  const nueva = async (): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO suscripciones
         (suscripcion_id, tenant_id, usuario_id, item_id, frecuencia, dia_mes,
          estado, proximo_cobro)
       VALUES ($1, $2, $3, $4, 'mensual', 5, 'activa', '2099-01-05')`,
      [id, TENANT_ID, usuarioId, PLAN_MENSUAL_DEMO],
    );
    return id;
  };
  const estadoDe = async (id: string) =>
    (
      await ds.query<{ estado: string }[]>(
        `SELECT estado FROM suscripciones WHERE suscripcion_id = $1`,
        [id],
      )
    )[0].estado;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(ADMIN);
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as { access_token: string }).access_token}`,
      )
      .send({ tenantId: TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as { access_token: string }).access_token;
    const [u] = await ds.query<{ usuario_id: string }[]>(
      `SELECT usuario_id FROM usuarios WHERE correo = $1 AND eliminado_el IS NULL`,
      [ADMIN.email],
    );
    usuarioId = u.usuario_id;
  });

  afterAll(async () => {
    await ds.query(
      `UPDATE suscripciones SET eliminado_el = NOW()
       WHERE tenant_id = $1 AND usuario_id = $2 AND proximo_cobro = '2099-01-05'`,
      [TENANT_ID, usuarioId],
    );
    await app.close();
  });

  const patch = (ruta: string, id: string, accion: string) =>
    request(app.getHttpServer())
      .patch(`/api/suscripciones/${ruta}${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ accion });

  it.each(['pausar', 'reanudar'])(
    '%s da 400 en la ruta propia y en la de admin, y no toca el estado',
    async (accion) => {
      const id = await nueva();
      const propia = await patch('', id, accion);
      const admin = await patch('admin/', id, accion);
      expect(propia.status).toBe(400);
      expect(admin.status).toBe(400);
      expect(await estadoDe(id)).toBe('activa');
    },
  );

  it('dar de baja sigue andando: la propia y la de admin', async () => {
    const a = await nueva();
    const propia = await patch('', a, 'cancelar');
    expect(propia.status).toBe(200);
    expect((propia.body as { estado: string }).estado).toBe('cancelada');
    expect(await estadoDe(a)).toBe('cancelada');

    const b = await nueva();
    const admin = await patch('admin/', b, 'cancelar');
    expect(admin.status).toBe(200);
    expect(await estadoDe(b)).toBe('cancelada');
  });
});
