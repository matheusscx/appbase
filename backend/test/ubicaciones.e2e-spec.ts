import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const PROV_RM = '550e8400-e29b-41d4-a716-446655440001'; // Chile

// Supervisor: rol Administrador, es_fijo=true → short-circuit de permisos.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// Cajero: rol Vendedor, no es admin del tenant → TenantAdminGuard lo rechaza.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

const SUPERADMIN_EMAIL = 'admin@sistema.com';
const SUPERADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface UbicacionItem {
  id: string;
  nombre: string;
  tipo: 'local' | 'bodega';
  activo: boolean;
  eliminadoEl?: string | null;
  eliminadoPorNombre?: string | null;
}
interface TenantCreado {
  id: string;
}

describe('Ubicaciones (e2e) — CRUD admin-only + local sembrado + papelera', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenTenantNuevo: string;
  let localParisId: string;
  let bodegaCreadaId: string;

  async function login(
    email: string,
    password: string,
    tenantId?: string,
  ): Promise<string> {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
    expect(resLogin.status).toBe(200);
    const initialToken = (resLogin.body as TokenResponse).access_token;
    if (!tenantId) return initialToken;

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

  /** Un tenant propio y recién creado: caso 1 necesita medir el estado
   *  de nacimiento, que tocar Paris (compartido con el resto de la suite)
   *  no puede darle. El superadmin que lo crea queda como su admin. */
  async function crearTenantNuevo(): Promise<string> {
    const tokenSuperLogin = await login(SUPERADMIN_EMAIL, SUPERADMIN_PASS);
    const sufijo = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const res = await request(app.getHttpServer())
      .post('/api/admin/tenants')
      .set('Authorization', `Bearer ${tokenSuperLogin}`)
      .send({
        nombre: `E2E Ubicaciones ${sufijo}`,
        correo: `ubicaciones-${sufijo}@e2e.test`,
        provinciaId: PROV_RM,
      });
    expect(res.status).toBe(201);
    return (res.body as TenantCreado).id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`,
    // que el e2e no ejecuta. Sin esto corta con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    tokenAdmin = await login(ADMIN_EMAIL, ADMIN_PASS, PARIS_TENANT_ID);
    tokenVendedor = await login(VENDEDOR_EMAIL, VENDEDOR_PASS, PARIS_TENANT_ID);

    const tenantNuevoId = await crearTenantNuevo();
    tokenTenantNuevo = await login(
      SUPERADMIN_EMAIL,
      SUPERADMIN_PASS,
      tenantNuevoId,
    );
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  // Caso 1: un tenant recién creado nace con exactamente una ubicación.
  it('GET /ubicaciones de un tenant recién creado devuelve exactamente una fila, tipo local', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${tokenTenantNuevo}`);

    expect(res.status).toBe(200);
    const ubicaciones = res.body as UbicacionItem[];
    expect(ubicaciones).toHaveLength(1);
    expect(ubicaciones[0].tipo).toBe('local');
    expect(ubicaciones[0].nombre).toBe('Local');
    expect(ubicaciones[0].activo).toBe(true);
  });

  // Caso 6 (isolation), reforzado por el mismo caso 1: si Paris se filtrara
  // para acá, el conteo de arriba ya no daría 1. Se deja un test propio para
  // que el fallo diga isolation y no "conteo raro".
  it('aislamiento: un tenant no ve las ubicaciones de otro', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${tokenTenantNuevo}`);

    expect(res.status).toBe(200);
    const nombres = (res.body as UbicacionItem[]).map((u) => u.nombre);
    expect(nombres).not.toContain('Bodega Subsuelo');
  });

  it('GET /ubicaciones con admin de Paris incluye el local sembrado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const ubicaciones = res.body as UbicacionItem[];
    const local = ubicaciones.find((u) => u.tipo === 'local');
    expect(local).toBeDefined();
    localParisId = local!.id;
  });

  // Caso 2: POST con tipo 'bodega' la crea; con tipo 'local' → 400.
  it('POST /ubicaciones con tipo bodega → 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ubicaciones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `Bodega E2E ${Date.now()}`, tipo: 'bodega' });

    expect(res.status).toBe(201);
    const body = res.body as UbicacionItem;
    expect(body.tipo).toBe('bodega');
    expect(body.activo).toBe(true);
    bodegaCreadaId = body.id;
  });

  it('POST /ubicaciones con tipo local → 400 (el local es uno y se siembra, no se crea)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ubicaciones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Otro local', tipo: 'local' });

    expect(res.status).toBe(400);
  });

  // Caso 3: DELETE sobre el local → 400.
  it('DELETE sobre el local → 400', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/ubicaciones/${localParisId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(/local/i);
  });

  // Caso 4: DELETE sobre una bodega vacía → 204, y restaurar la trae de vuelta.
  it('DELETE sobre una bodega vacía → 204, y POST .../restaurar la trae de vuelta', async () => {
    const resDelete = await request(app.getHttpServer())
      .delete(`/api/ubicaciones/${bodegaCreadaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resDelete.status).toBe(204);

    const resListaSinEliminados = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resListaSinEliminados.status).toBe(200);
    expect(
      (resListaSinEliminados.body as UbicacionItem[]).some(
        (u) => u.id === bodegaCreadaId,
      ),
    ).toBe(false);

    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/ubicaciones/${bodegaCreadaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({});
    expect(resRestaurar.status).toBe(201);
    expect((resRestaurar.body as UbicacionItem).eliminadoEl).toBeNull();

    const resListaFinal = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resListaFinal.status).toBe(200);
    expect(
      (resListaFinal.body as UbicacionItem[]).some(
        (u) => u.id === bodegaCreadaId,
      ),
    ).toBe(true);
  });

  // Caso 5: un no-admin recibe 403 en escritura y 200 en lectura.
  it('GET con no-admin → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${tokenVendedor}`);
    expect(res.status).toBe(200);
  });

  it('POST/PATCH/DELETE con no-admin → 403', async () => {
    const resPost = await request(app.getHttpServer())
      .post('/api/ubicaciones')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ nombre: 'Bodega no autorizada', tipo: 'bodega' });
    expect(resPost.status).toBe(403);

    const resPatch = await request(app.getHttpServer())
      .patch(`/api/ubicaciones/${localParisId}`)
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({ nombre: 'Cocina' });
    expect(resPatch.status).toBe(403);

    const resDelete = await request(app.getHttpServer())
      .delete(`/api/ubicaciones/${bodegaCreadaId}`)
      .set('Authorization', `Bearer ${tokenVendedor}`);
    expect(resDelete.status).toBe(403);
  });

  it('PATCH permite renombrar el local, pero no desactivarlo', async () => {
    const resRename = await request(app.getHttpServer())
      .patch(`/api/ubicaciones/${localParisId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Local' });
    expect(resRename.status).toBe(200);

    const resDesactivar = await request(app.getHttpServer())
      .patch(`/api/ubicaciones/${localParisId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ activo: false });
    expect(resDesactivar.status).toBe(400);
  });
});
