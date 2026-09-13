import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const PROV_CDMX = '550e8400-e29b-41d4-a716-446655440377'; // México
const SUPERADMIN = { email: 'admin@sistema.com', pass: 'admin' };
// Un tenant nuevo nace sin módulos contratados, y el admin del tenant solo pasa
// `PermisosGuard` dentro de los que el tenant tiene (`RbacService.userHasPermiso`).
const MODULO_PASARELAS = '550e8400-e29b-41d4-a716-446655440208';

interface TokenResponse {
  access_token: string;
}

interface PasarelaGlobal {
  pasarelaId: string;
  codigo: string;
}

/**
 * Oneclick y Webpay Plus son de Transbank y liquidan en pesos chilenos
 * (`MONEDA_ORDEN_V1`): un local de otro país no los puede configurar (owner,
 * 2026-09-13). Antes podía, y el checkout online mandaba el total en su moneda
 * como si fuera CLP. Se prueba con un tenant propio en México: tocar las
 * pasarelas de Demo Restaurante le cambiaría el checkout a las otras suites.
 */
describe('Pasarela — Transbank solo para locales de Chile (e2e)', () => {
  let app: INestApplication<App>;
  let tokenSuper: string;
  let ds: DataSource;

  async function entrarA(tenantId: string): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: SUPERADMIN.email, password: SUPERADMIN.pass });
    expect(login.status).toBe(200);
    const res = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId });
    expect(res.status).toBe(200);
    return (res.body as TokenResponse).access_token;
  }

  async function catalogo(token: string): Promise<PasarelaGlobal[]> {
    const res = await request(app.getHttpServer())
      .get('/api/pasarela/admin/pasarelas-disponibles')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as PasarelaGlobal[];
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
    ds = app.get(DataSource);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: SUPERADMIN.email, password: SUPERADMIN.pass });
    expect(login.status).toBe(200);
    tokenSuper = (login.body as TokenResponse).access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('a un local de México el catálogo le ofrece solo la demo, y dar de alta o prender Webpay u Oneclick responde 400', async () => {
    // Control: el local de Chile ve las tres. Sin esto, un catálogo vacío
    // también pasaría la aserción de abajo.
    const enChile = await catalogo(await entrarA(PARIS_TENANT_ID));
    expect(enChile.map((p) => p.codigo)).toEqual(
      expect.arrayContaining(['demo', 'oneclick', 'webpay_plus']),
    );
    const idPorCodigo = new Map(enChile.map((p) => [p.codigo, p.pasarelaId]));

    const sufijo = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const alta = await request(app.getHttpServer())
      .post('/api/admin/tenants')
      .set('Authorization', `Bearer ${tokenSuper}`)
      .send({
        nombre: `E2E Pasarela MX ${sufijo}`,
        correo: `pasarela-mx-${sufijo}@e2e.test`,
        provinciaId: PROV_CDMX,
      });
    expect(alta.status).toBe(201);
    const tenantMxId = (alta.body as { id: string }).id;
    const contratar = await request(app.getHttpServer())
      .post(`/api/admin/tenants/${tenantMxId}/modules`)
      .set('Authorization', `Bearer ${tokenSuper}`)
      .send({ moduloAppId: MODULO_PASARELAS });
    expect(contratar.status).toBe(201);
    const tokenMx = await entrarA(tenantMxId);

    expect((await catalogo(tokenMx)).map((p) => p.codigo)).toEqual(['demo']);

    // El catálogo es lo que ve la pantalla; el alta es la puerta. Un cliente
    // que mande el id a mano tiene que chocar igual.
    for (const codigo of ['webpay_plus', 'oneclick']) {
      const res = await request(app.getHttpServer())
        .post('/api/pasarela/admin/config')
        .set('Authorization', `Bearer ${tokenMx}`)
        .send({
          pasarelaId: idPorCodigo.get(codigo),
          ambiente: 'pruebas',
          modoIntegracion: 'mall',
        });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'solo están disponibles para locales de Chile',
      );
    }

    const demo = await request(app.getHttpServer())
      .post('/api/pasarela/admin/config')
      .set('Authorization', `Bearer ${tokenMx}`)
      .send({
        pasarelaId: idPorCodigo.get('demo'),
        ambiente: 'pruebas',
        modoIntegracion: 'individual',
      });
    expect(demo.status).toBe(201);

    // Una config de Transbank que viniera de antes de la regla. La app ya no deja
    // crearla —es justo lo de arriba—, así que se inserta directo: es el único
    // modo de armar ese estado, y el owner pidió cortar también ahí (2026-09-13).
    const [vieja] = await ds.query<{ tenant_pasarela_id: string }[]>(
      `INSERT INTO tenant_pasarela
         (tenant_id, pasarela_id, ambiente, modo_integracion, configuracion, activo, prioridad)
       VALUES ($1, $2, 'pruebas', 'mall', NULL, false, 1)
       RETURNING tenant_pasarela_id`,
      [tenantMxId, idPorCodigo.get('oneclick')],
    );

    const prender = await request(app.getHttpServer())
      .patch(`/api/pasarela/admin/config/${vieja.tenant_pasarela_id}`)
      .set('Authorization', `Bearer ${tokenMx}`)
      .send({ activo: true });
    expect(prender.status).toBe(400);
    expect((prender.body as { message: string }).message).toContain(
      'solo están disponibles para locales de Chile',
    );

    // Y sigue apagada, leída por la API y no por SQL.
    const configs = await request(app.getHttpServer())
      .get('/api/pasarela/admin/config')
      .set('Authorization', `Bearer ${tokenMx}`);
    expect(configs.status).toBe(200);
    const oneclick = (
      configs.body as { tenantPasarelaId: string; activo: boolean }[]
    ).find((c) => c.tenantPasarelaId === vieja.tenant_pasarela_id);
    expect(oneclick?.activo).toBe(false);
  });
});
