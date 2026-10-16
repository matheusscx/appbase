import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
// Cajero: miembro autenticado del tenant, no administrador.
const VENDEDOR = { email: 'vendedor@paris.cl', pass: 'admin' };
const UUID_AJENO = '550e8400-e29b-41d4-a716-4466554499ff';

interface TokenResponse {
  access_token: string;
}
interface ModuloDisponible {
  moduloTenantId: string;
  permisos: { moduloAppPermisoId: string }[];
}
interface Rol {
  id: string;
  nombre: string;
  cantidadUsuarios: number;
}
interface Permiso {
  moduloTenantId: string;
  moduloAppPermisoId: string;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<{ token: string; usuarioId: string }> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
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
  const token = (resTenant.body as TokenResponse).access_token;
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString(),
  ) as { sub: string };
  return { token, usuarioId: payload.sub };
}

/**
 * Auditoría UX 07.11 (owner, 2026-10-16): guardar un rol es todo o nada. Antes la pantalla lanzaba
 * un PUT por módulo, y uno que fallaba a mitad dejaba los anteriores aplicados.
 * Y 07.9: la lista de roles dice cuántas personas tiene cada uno.
 */
describe('Roles (e2e): permisos de todos los módulos en una sola llamada', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let vendedorId: string;
  let modulos: ModuloDisponible[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();

    tokenAdmin = (await login(app, ADMIN.email, ADMIN.pass)).token;
    const v = await login(app, VENDEDOR.email, VENDEDOR.pass);
    tokenVendedor = v.token;
    vendedorId = v.usuarioId;

    const res = await request(app.getHttpServer())
      .get('/api/roles/modulos-disponibles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    modulos = (res.body as ModuloDisponible[]).filter(
      (m) => m.permisos.length > 0,
    );
    expect(modulos.length).toBeGreaterThanOrEqual(2);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  async function crearRol(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/roles')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `E2E rol ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  async function permisosDe(rolId: string): Promise<Permiso[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/roles/${rolId}/permissions`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    return res.body as Permiso[];
  }

  function cuerpo(pares: { m: ModuloDisponible; permisoId: string }[]) {
    return {
      modulos: pares.map(({ m, permisoId }) => ({
        moduloTenantId: m.moduloTenantId,
        moduloAppPermisoIds: [permisoId],
      })),
    };
  }

  it('PUT /roles/:id/permissions guarda los permisos de varios módulos de una vez', async () => {
    const rolId = await crearRol();
    const [a, b] = modulos;

    const res = await request(app.getHttpServer())
      .put(`/api/roles/${rolId}/permissions`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(
        cuerpo([
          { m: a, permisoId: a.permisos[0].moduloAppPermisoId },
          { m: b, permisoId: b.permisos[0].moduloAppPermisoId },
        ]),
      );

    expect(res.status).toBe(204);
    const guardados = await permisosDe(rolId);
    expect(guardados.map((p) => p.moduloTenantId).sort()).toEqual(
      [a.moduloTenantId, b.moduloTenantId].sort(),
    );
  });

  it('un módulo que no es del tenant rechaza TODO: el módulo válido tampoco se guarda', async () => {
    const rolId = await crearRol();
    const [a] = modulos;

    const res = await request(app.getHttpServer())
      .put(`/api/roles/${rolId}/permissions`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        modulos: [
          {
            moduloTenantId: a.moduloTenantId,
            moduloAppPermisoIds: [a.permisos[0].moduloAppPermisoId],
          },
          { moduloTenantId: UUID_AJENO, moduloAppPermisoIds: [] },
        ],
      });

    expect(res.status).toBe(400);
    expect(await permisosDe(rolId)).toEqual([]);
  });

  it('si la escritura falla ADENTRO de la transacción, lo del primer módulo se deshace', async () => {
    // El caso que justifica el endpoint: los dos módulos pasan la validación, pero el segundo trae
    // el mismo permiso dos veces y la PK (rol, módulo, permiso) rompe el INSERT después de haber
    // escrito el primero. (Un permiso inexistente no sirve: la columna no tiene FK.)
    const rolId = await crearRol();
    const [a, b] = modulos;

    const res = await request(app.getHttpServer())
      .put(`/api/roles/${rolId}/permissions`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        modulos: [
          {
            moduloTenantId: a.moduloTenantId,
            moduloAppPermisoIds: [a.permisos[0].moduloAppPermisoId],
          },
          {
            moduloTenantId: b.moduloTenantId,
            moduloAppPermisoIds: [
              b.permisos[0].moduloAppPermisoId,
              b.permisos[0].moduloAppPermisoId,
            ],
          },
        ],
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await permisosDe(rolId)).toEqual([]);
  });

  it('un módulo repetido se rechaza', async () => {
    const rolId = await crearRol();
    const [a] = modulos;
    const id = a.permisos[0].moduloAppPermisoId;

    const res = await request(app.getHttpServer())
      .put(`/api/roles/${rolId}/permissions`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(
        cuerpo([
          { m: a, permisoId: id },
          { m: a, permisoId: id },
        ]),
      );

    expect(res.status).toBe(400);
  });

  it('sin ser admin → 403, y no se escribe nada', async () => {
    const rolId = await crearRol();
    const [a] = modulos;

    const res = await request(app.getHttpServer())
      .put(`/api/roles/${rolId}/permissions`)
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send(cuerpo([{ m: a, permisoId: a.permisos[0].moduloAppPermisoId }]));

    expect(res.status).toBe(403);
    expect(await permisosDe(rolId)).toEqual([]);
  });

  it('GET /roles trae cuántas personas tiene cada rol (07.9)', async () => {
    const rolId = await crearRol();

    const antes = await request(app.getHttpServer())
      .get('/api/roles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(antes.status).toBe(200);
    expect(
      (antes.body as Rol[]).find((r) => r.id === rolId)?.cantidadUsuarios,
    ).toBe(0);

    const asignar = await request(app.getHttpServer())
      .post(`/api/roles/${rolId}/users`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ usuarioId: vendedorId });
    expect(asignar.status).toBe(201);

    const despues = await request(app.getHttpServer())
      .get('/api/roles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(despues.status).toBe(200);
    expect(
      (despues.body as Rol[]).find((r) => r.id === rolId)?.cantidadUsuarios,
    ).toBe(1);

    const quitar = await request(app.getHttpServer())
      .delete(`/api/roles/${rolId}/users/${vendedorId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(quitar.status).toBe(204);
    const quitado = await request(app.getHttpServer())
      .get('/api/roles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(quitado.status).toBe(200);
    expect(
      (quitado.body as Rol[]).find((r) => r.id === rolId)?.cantidadUsuarios,
    ).toBe(0);
  });

  it('GET /tenants/members dice si la cuenta es la credencial de un garzón (07.20)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    for (const m of res.body as { garzonNombre?: string | null }[]) {
      expect(
        m.garzonNombre === null || typeof m.garzonNombre === 'string',
      ).toBe(true);
    }
  });
});
