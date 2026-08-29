import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
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
  nombre?: string;
  correo?: string;
  esTotem?: boolean;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
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

/**
 * Los miembros del tenant son administración, no operación.
 *
 * Hasta jul-2026 el alta y la baja colgaban solo de `JwtAuthGuard + TenantGuard`
 * —las únicas del controller sin `TenantAdminGuard`, con `PATCH me` al lado que
 * sí lo tenía—, así que cualquier miembro autenticado podía sumar cuentas al
 * tenant y, sobre todo, **eliminar al admin del suyo**.
 *
 * La **lectura** quedó abierta en aquella pasada y se cerró el 2026-08-09, con
 * lo que la Fase 2 del garzón la convirtió en superficie de UI: una pantalla que
 * no es admin-only empezó a llamarla al montar y el roster entero —con el correo
 * de cada miembro— pasó a renderizarse en un dropdown. Lo que esos selectores
 * necesitan son nombres, y para eso está `members/para-selector`.
 */
describe('Tenants — miembros (e2e): el roster es admin-only', () => {
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
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenNoAdmin = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);

    const res = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    miembroExistenteId = (res.body as Member[])[0].usuarioId;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /tenants/members sin ser admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenNoAdmin}`);

    expect(res.status).toBe(403);
  });

  it('GET /tenants/members con admin devuelve el correo de cada miembro', async () => {
    // El contrapeso del test de arriba: un guard que rechazara a TODOS lo
    // pasaría igual, y la pantalla de usuarios quedaría sin datos.
    const res = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    expect((res.body as Member[]).every((m) => !!m.correo)).toBe(true);
  });

  it('para-selector: cualquier miembro lo lee, y NO trae correo ni roles', async () => {
    // Lo que hace que el selector de garzones —pantalla que no es admin-only—
    // no reparta el correo de todo el tenant en un dropdown.
    const res = await request(app.getHttpServer())
      .get('/api/tenants/members/para-selector')
      .set('Authorization', `Bearer ${tokenNoAdmin}`);

    expect(res.status).toBe(200);
    const miembros = res.body as Member[];
    expect(miembros.length).toBeGreaterThan(0);
    for (const m of miembros) {
      expect(m.usuarioId).toBeTruthy();
      expect(m.nombre).toBeTruthy();
      // `esTotem` no es decorativo: es con lo que el selector de garzones
      // descarta las cuentas de tótem. Sin esta línea, sacar `ut.es_totem` del
      // SELECT deja la suite en verde —el tipo de `rows` es una aserción a mano
      // sobre `dataSource.query`, no algo que TypeScript verifique— y la
      // pantalla vuelve a ofrecer cuentas que el backend rechaza con un 400.
      expect(typeof m.esTotem).toBe('boolean');
      expect(m).not.toHaveProperty('correo');
      expect(m).not.toHaveProperty('roles');
    }
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
