import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

// Task 2 de la feature "papelera": categorías es la entidad de referencia —
// familia TypeORM, sin nombre único, sin colaterales. Este spec es el patrón
// que las tareas siguientes (3-6) replican para el resto de los 16 recursos.

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Admin: rol Administrador, es_fijo=true → short-circuit de permisos, y el
// único que pasa TenantAdminGuard.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// Vendedor: no es admin del tenant → TenantAdminGuard lo rechaza tanto en
// DELETE como en restaurar.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CategoriaItem {
  id: string;
  nombre: string;
  activo: boolean;
  eliminadoEl: string | null;
  eliminadoPor: string | null;
  eliminadoPorNombre?: string | null;
}
interface CausaMermaItem {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
  eliminadoEl?: string | null;
  eliminadoPor?: string | null;
  eliminadoPorNombre?: string | null;
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

describe('Papelera (e2e) — categorías, patrón de referencia', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenNoAdmin: string;
  let categoriaId: string;

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
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('POST /categorias con admin → 201 crea la categoría de prueba', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/categorias')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `Categoría papelera E2E ${Date.now()}` });

    expect(res.status).toBe(201);
    const body = res.body as CategoriaItem;
    expect(body.id).toBeDefined();
    expect(body.eliminadoEl).toBeNull();
    categoriaId = body.id;
  });

  it('DELETE /categorias/:id por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/categorias/${categoriaId}`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /categorias/:id con admin → 200 (soft delete)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/categorias/${categoriaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
  });

  it('GET /categorias sin flag no trae la categoría borrada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categorias')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const categorias = res.body as CategoriaItem[];
    expect(categorias.find((c) => c.id === categoriaId)).toBeUndefined();
  });

  it('GET /categorias?incluirEliminados=true trae la categoría con el nombre de quien borró', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/categorias?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const categorias = res.body as CategoriaItem[];
    const borrada = categorias.find((c) => c.id === categoriaId);
    expect(borrada).toBeDefined();
    expect(borrada?.eliminadoEl).not.toBeNull();
    expect(borrada?.eliminadoPorNombre).toBe('admin.paris');
  });

  it('POST /categorias/:id/restaurar por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/categorias/${categoriaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('POST /categorias/:id/restaurar con admin → 201 y vuelve al listado normal', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/categorias/${categoriaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    const body = res.body as CategoriaItem;
    expect(body.eliminadoEl).toBeNull();

    const listado = await request(app.getHttpServer())
      .get('/api/categorias')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const categorias = listado.body as CategoriaItem[];
    expect(categorias.find((c) => c.id === categoriaId)).toBeDefined();
  });

  it('POST /categorias/:id/restaurar de nuevo (ya no está en la papelera) → 404', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/categorias/${categoriaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });
});

// Task 3: causas de merma — segunda referencia. Familia SQL cruda (no
// softDelete() de TypeORM) y con nombre único por tenant, así que agrega el
// 400 de colisión al restaurar: el índice único es parcial (WHERE
// eliminado_el IS NULL), así que mientras la causa está borrada, otra causa
// puede tomar su nombre y competir cuando se intenta revivirla.
describe('Papelera (e2e) — causas de merma, SQL cruda + colisión de nombre', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenNoAdmin: string;
  let causaId: string;
  let causaNombre: string;

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
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('POST /causas-merma con admin → 201 crea la causa de prueba', async () => {
    causaNombre = `Vencimiento E2E ${Date.now()}`;
    const res = await request(app.getHttpServer())
      .post('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: causaNombre });

    expect(res.status).toBe(201);
    const body = res.body as CausaMermaItem;
    expect(body.id).toBeDefined();
    causaId = body.id;
  });

  it('DELETE /causas-merma/:id por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/causas-merma/${causaId}`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('DELETE /causas-merma/:id con admin → 204 (soft delete)', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/causas-merma/${causaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(204);
  });

  it('GET /causas-merma sin flag no trae la causa borrada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const causas = res.body as CausaMermaItem[];
    expect(causas.find((c) => c.id === causaId)).toBeUndefined();
  });

  it('GET /causas-merma?incluirEliminados=true trae la causa con el nombre de quien borró', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/causas-merma?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const causas = res.body as CausaMermaItem[];
    const borrada = causas.find((c) => c.id === causaId);
    expect(borrada).toBeDefined();
    expect(borrada?.eliminadoEl).not.toBeNull();
    expect(borrada?.eliminadoPorNombre).toBe('admin.paris');
  });

  it('POST /causas-merma/:id/restaurar por no-admin → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(res.status).toBe(403);
  });

  it('colisión real de Postgres: crear otra causa con el mismo nombre y restaurar la borrada → 400, nada cambia', async () => {
    // Mientras `causaId` estaba borrada, nadie competía por su nombre: se
    // puede crear una causa nueva y activa con el mismo nombre.
    const otra = await request(app.getHttpServer())
      .post('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: causaNombre });
    expect(otra.status).toBe(201);
    const otraId = (otra.body as CausaMermaItem).id;

    // El 23505 lo tira Postgres de verdad (índice único parcial), no un mock.
    const restaurar = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(restaurar.status).toBe(400);

    const listado = await request(app.getHttpServer())
      .get('/api/causas-merma?incluirEliminados=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const causas = listado.body as CausaMermaItem[];
    const viva = causas.find((c) => c.id === otraId);
    const borrada = causas.find((c) => c.id === causaId);
    expect(viva?.eliminadoEl).toBeNull();
    expect(borrada?.eliminadoEl).not.toBeNull();

    // Limpieza: sin la causa activa que ocupa el nombre, restaurar sí puede.
    const deleteOtra = await request(app.getHttpServer())
      .delete(`/api/causas-merma/${otraId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(deleteOtra.status).toBe(204);
  });

  it('POST /causas-merma/:id/restaurar con admin (sin colisión) → 201 y vuelve al listado normal', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(201);
    const body = res.body as CausaMermaItem;
    expect(body.eliminadoEl).toBeNull();

    const listado = await request(app.getHttpServer())
      .get('/api/causas-merma')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const causas = listado.body as CausaMermaItem[];
    expect(causas.find((c) => c.id === causaId)).toBeDefined();
  });

  it('POST /causas-merma/:id/restaurar de nuevo (ya no está en la papelera) → 404', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/causas-merma/${causaId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });
});
