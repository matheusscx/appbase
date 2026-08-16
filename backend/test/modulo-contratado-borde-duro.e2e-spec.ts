import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * `PRODUCTO.md`: *"Cada ruta valida rol + **módulo contratado** + permiso"*, y los
 * módulos son lo que se vende. El borde es **duro también para el admin del
 * tenant**: su rol `es_fijo` le da todos los permisos, pero solo dentro de lo
 * que la empresa contrató.
 *
 * Antes el short-circuit de `es_fijo` no miraba `tenant_modulos`, así que el
 * admin pegaba 200 en cualquier ruta de negocio mientras el frontend —que sí
 * filtra por `getMisPermisos`— ni le mostraba el link. **No era un problema de
 * aislamiento sino comercial:** no veía datos ajenos, veía módulos que no pagó.
 *
 * Los dos tenants del seed sirven de fixture natural: Demo Restaurante tiene
 * `Propinas` contratado y Demo Bodega no.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';

interface TokenResponse {
  access_token: string;
}

/**
 * Login + switch al tenant pedido. `admin@sistema.com` es el superadmin, que
 * además tiene rol Administrador (`es_fijo`) en los dos tenants del seed — o sea
 * el MISMO usuario y el MISMO rol en ambos. Eso es lo que hace la comparación
 * limpia: lo único que cambia entre los dos casos es qué contrató la empresa.
 */
async function loginEn(
  app: INestApplication<App>,
  tenantId: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: 'admin@sistema.com', password: 'admin' });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

describe('El módulo contratado es un borde duro, también para el admin (e2e)', () => {
  let app: INestApplication<App>;

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
  });

  afterAll(async () => {
    await app.close();
  });

  const RUTA_PROPINAS =
    '/api/propinas/reportes/resumen?desde=2026-08-01&hasta=2026-08-31';

  it('el admin del tenant CON el módulo contratado entra', async () => {
    const token = await loginEn(app, PARIS_TENANT_ID);
    const res = await request(app.getHttpServer())
      .get(RUTA_PROPINAS)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('el mismo admin, en el tenant SIN el módulo, recibe 403', async () => {
    const token = await loginEn(app, FALABELLA_TENANT_ID);
    const res = await request(app.getHttpServer())
      .get(RUTA_PROPINAS)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('lo que se le niega es el módulo, no la condición de admin', async () => {
    const token = await loginEn(app, FALABELLA_TENANT_ID);

    // Sigue siendo admin del tenant. La ruta tiene que estar detrás de
    // `TenantAdminGuard` —que resuelve por `userIsTenantAdmin`, sin tocar
    // `tenant_modulos`— o el caso no distingue "sigue siendo admin" de "es un
    // miembro cualquiera": `GET /roles`, por ejemplo, solo pide `TenantGuard` y
    // se lo daría a cualquier miembro. `POST /causas-merma` sí es admin-only.
    // Sin esto, el 403 de arriba podría estar diciendo "perdiste el rol" en vez
    // de "ese módulo no está contratado".
    const res = await request(app.getHttpServer())
      .post('/api/causas-merma')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `Causa borde duro E2E ${Date.now()}` });
    expect(res.status).toBe(201);

    // Y un módulo que ese tenant SÍ contrató le responde.
    const resItems = await request(app.getHttpServer())
      .get('/api/items?pageSize=1')
      .set('Authorization', `Bearer ${token}`);
    expect(resItems.status).toBe(200);
  });
});
