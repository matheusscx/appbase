import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// Cajero: pertenece al tenant y está autenticado, que es exactamente lo que
// bastaba antes del guard para agregar o eliminar miembros.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface Member {
  usuarioId: string;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  const initialToken = (resLogin.body as TokenResponse).access_token;

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

/**
 * Alta y baja de miembros del tenant: administración, no operación.
 *
 * Hasta jul-2026 estas dos rutas colgaban solo de `JwtAuthGuard + TenantGuard`
 * —las únicas del controller sin `TenantAdminGuard`, con `PATCH me` al lado que
 * sí lo tenía—, así que cualquier miembro autenticado podía sumar cuentas al
 * tenant y, sobre todo, **eliminar al admin del suyo**. El frontend no usa
 * estas rutas (escribe por `roles/:id/users`), así que el agujero solo se veía
 * llamando la API directo.
 */
describe('Tenants — miembros (e2e), alta y baja son admin-only', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenNoAdmin: string;
  let miembroExistenteId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenNoAdmin = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);

    const res = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    miembroExistenteId = (res.body as Member[])[0].usuarioId;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('la lectura sigue abierta a cualquier miembro del tenant', async () => {
    // El guard va sobre las escrituras: si esto empezara a dar 403, el listado
    // de usuarios de la pantalla de configuración dejaría de cargar.
    const res = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenNoAdmin}`);

    expect(res.status).toBe(200);
  });

  it('POST /tenants/members sin ser admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenNoAdmin}`)
      .send({ usuarioId: miembroExistenteId });

    expect(res.status).toBe(403);
  });

  it('DELETE /tenants/members/:userId sin ser admin → 403', async () => {
    // El caso filoso: sin guard, un cajero echaba al admin de su propio tenant.
    const res = await request(app.getHttpServer())
      .delete(`/api/tenants/members/${miembroExistenteId}`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);

    expect(res.status).toBe(403);
  });

  it('POST /tenants/members con admin sigue funcionando', async () => {
    // Sin esto, un guard que rechazara a TODOS pasaría los dos tests de arriba.
    // Se reagrega un miembro que YA está: `addMember` es idempotente y devuelve
    // la fila existente, así que no ensucia el seed.
    const res = await request(app.getHttpServer())
      .post('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ usuarioId: miembroExistenteId });

    expect(res.status).toBe(201);
  });
});
