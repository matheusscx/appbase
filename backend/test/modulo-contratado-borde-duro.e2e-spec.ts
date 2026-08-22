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
 * `Salones` contratado y Demo Bodega no.
 *
 * ⚠️ **El par era `Propinas` hasta el 2026-08-22 y hubo que darlo vuelta.** Ese
 * día la gestión de garzones pasó a habilitarla `Salones` **o** `Propinas`, y
 * con eso Demo Bodega —una bodega sin mesas que cobra propina directa— dejó de
 * tener `Salones` contratado de mentira y pasó a contratar `Propinas`, que es lo
 * que de verdad usa. O sea que el módulo que Demo Bodega NO tiene ahora es
 * `Salones`. La propiedad que esta suite fija no cambió; cambió cuál de los dos
 * módulos sirve de ejemplo.
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

  // Una ruta del módulo `Salones` que NO sea de garzones: esas aceptan también
  // `Propinas` desde el 2026-08-22, así que no distinguirían nada acá.
  const RUTA_SALONES = '/api/salones';

  it('el admin del tenant CON el módulo contratado entra', async () => {
    const token = await loginEn(app, PARIS_TENANT_ID);
    const res = await request(app.getHttpServer())
      .get(RUTA_SALONES)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('el mismo admin, en el tenant SIN el módulo, recibe 403', async () => {
    const token = await loginEn(app, FALABELLA_TENANT_ID);
    const res = await request(app.getHttpServer())
      .get(RUTA_SALONES)
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

  /**
   * El garzón le sirve a los dos módulos: lo crea el alta de TODO tenant
   * (`asegurarMostrador`), atiende mesas en Salones y cobra propinas en
   * Propinas. Hasta el 2026-08-22 su gestión pedía `Salones` a secas, así que
   * una bodega que solo cobra propina directa no podía administrar el garzón
   * que el propio alta le había creado — ni abrir su pantalla de liquidación,
   * que lista garzones.
   */
  describe('la gestión de garzones la habilita Salones O Propinas', () => {
    it('el tenant con Propinas y SIN Salones puede gestionar su garzón', async () => {
      const token = await loginEn(app, FALABELLA_TENANT_ID);

      // No tiene Salones: la prueba de que el permiso ya no sale de ahí.
      const salones = await request(app.getHttpServer())
        .get('/api/salones')
        .set('Authorization', `Bearer ${token}`);
      expect(salones.status).toBe(403);

      const listado = await request(app.getHttpServer())
        .get('/api/garzones')
        .set('Authorization', `Bearer ${token}`);
      expect(listado.status).toBe(200);

      // Y no es solo lectura: el alta también.
      const creado = await request(app.getHttpServer())
        .post('/api/garzones')
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: `Garzón bodega E2E ${Date.now()}` });
      expect(creado.status).toBe(201);
    });

    it('el tenant con Salones y SIN Propinas sigue pudiendo, que es la otra mitad', async () => {
      // La mitad que se rompía si la gestión se MUDABA a Propinas en vez de
      // aceptar los dos. Paris tiene los dos módulos, así que el fixture que
      // discrimina no es el tenant sino el ROL: `encargado.salon@paris.cl`
      // lleva el rol `Salones · Encargado`, con permisos de Salones y ninguno
      // de Propinas.
      const resLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'encargado.salon@paris.cl', password: 'admin' });
      expect(resLogin.status).toBe(200);
      const inicial = (resLogin.body as TokenResponse).access_token;
      const resTenant = await request(app.getHttpServer())
        .post('/api/auth/switch-tenant')
        .set(
          'Cookie',
          (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
        )
        .set('Authorization', `Bearer ${inicial}`)
        .send({ tenantId: PARIS_TENANT_ID });
      expect(resTenant.status).toBe(200);
      const token = (resTenant.body as TokenResponse).access_token;

      // No tiene Propinas: si la gestión se hubiera mudado allá, esto sería 403.
      const propinas = await request(app.getHttpServer())
        .get('/api/propinas/distribucion')
        .set('Authorization', `Bearer ${token}`);
      expect(propinas.status).toBe(403);

      const listado = await request(app.getHttpServer())
        .get('/api/garzones')
        .set('Authorization', `Bearer ${token}`);
      expect(listado.status).toBe(200);
    });
  });
});
