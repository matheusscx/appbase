import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';

const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const VENDEDOR_PARIS = { email: 'vendedor@paris.cl', pass: 'admin' }; // MiCaja, sin Cajas
// `contacto@falabella.cl` es el correo de contacto del tenant (no un usuario logueable);
// el admin real es_fijo de Falabella es `admin@sistema.com` (superadmin con rol
// Administrador asignado en Falabella vía seedRolesUsuarios/seedUsuariosTenants).
const ADMIN_FALABELLA = { email: 'admin@sistema.com', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface CajonResponse {
  id: string;
  nombre: string;
  activo: boolean;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
  tenantId: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId });
  return (resTenant.body as TokenResponse).access_token;
}

describe('Cajones (e2e) — CRUD admin-only + aislamiento', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenFalabella: string;
  const creados: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    tokenAdmin = await login(
      app,
      ADMIN_PARIS.email,
      ADMIN_PARIS.pass,
      PARIS_TENANT_ID,
    );
    tokenVendedor = await login(
      app,
      VENDEDOR_PARIS.email,
      VENDEDOR_PARIS.pass,
      PARIS_TENANT_ID,
    );
    tokenFalabella = await login(
      app,
      ADMIN_FALABELLA.email,
      ADMIN_FALABELLA.pass,
      FALABELLA_TENANT_ID,
    );
  });

  afterAll(async () => {
    for (const id of creados) {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    }
    await app.close();
  });

  it('admin crea, lista, renombra/desactiva y borra un cajón', async () => {
    const nombre = `E2E Cajón ${Date.now()}`;
    const resCrear = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(resCrear.status).toBe(201);
    const id = (resCrear.body as CajonResponse).id;
    creados.push(id);

    const resLista = await request(app.getHttpServer())
      .get('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resLista.status).toBe(200);
    expect((resLista.body as CajonResponse[]).some((c) => c.id === id)).toBe(
      true,
    );

    const resPatch = await request(app.getHttpServer())
      .patch(`/api/cajones/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `${nombre} v2`, activo: false });
    expect(resPatch.status).toBe(200);
    expect((resPatch.body as CajonResponse).activo).toBe(false);

    const resDel = await request(app.getHttpServer())
      .delete(`/api/cajones/${id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDel.status).toBe(200);
  });

  it('nombre duplicado en el mismo tenant devuelve 409', async () => {
    const nombre = `Dup ${Date.now()}`;
    const r1 = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(r1.status).toBe(201);
    creados.push((r1.body as CajonResponse).id);

    const r2 = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(r2.status).toBe(409);
  });

  it('vendedor (no admin) recibe 403 en todos los endpoints', async () => {
    const get = await request(app.getHttpServer())
      .get('/api/cajones')
      .set('Authorization', `Bearer ${tokenVendedor}`);
    expect(get.status).toBe(403);

    const post = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ nombre: 'X' });
    expect(post.status).toBe(403);
  });

  it('aislamiento multi-tenant: Falabella no ve un cajón de Paris', async () => {
    const nombre = `Solo Paris ${Date.now()}`;
    const resCrear = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(resCrear.status).toBe(201);
    creados.push((resCrear.body as CajonResponse).id);

    const resFalabella = await request(app.getHttpServer())
      .get('/api/cajones')
      .set('Authorization', `Bearer ${tokenFalabella}`);
    expect(resFalabella.status).toBe(200);
    expect(
      (resFalabella.body as CajonResponse[]).some((c) => c.nombre === nombre),
    ).toBe(false);
  });
});
