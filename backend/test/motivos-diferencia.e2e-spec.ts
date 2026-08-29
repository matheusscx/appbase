import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Supervisor: rol Administrador, es_fijo=true → short-circuit de permisos.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// Cajero: rol Vendedor, no es admin del tenant → TenantAdminGuard lo rechaza.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

// Motivo fijo del seed (`seedMotivosDiferencia`, `otro` es el último de
// MOTIVOS_DIFERENCIA_DEFAULTS → id 297 para Paris). Se usa solo para el PATCH
// de `activo` (se restaura en `finally`); nunca se toca su `nombre`.
const ERROR_OPERACIONAL_ID = '550e8400-e29b-41d4-a716-446655440296';

interface TokenResponse {
  access_token: string;
}
interface MotivoItem {
  id: string;
  nombre: string;
  activo: boolean;
  requiereComentario: boolean;
  esFijo: boolean;
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

describe('Motivos de diferencia (e2e) — CRUD admin-only + reglas de es_fijo', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenNoAdmin: string;
  let customId: string;

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
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /motivos-diferencia con admin → 200 e incluye el motivo fijo "otro"', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/motivos-diferencia')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const motivos = res.body as MotivoItem[];
    expect(Array.isArray(motivos)).toBe(true);
    const otro = motivos.find((m) => m.nombre === 'otro');
    expect(otro).toBeDefined();
    expect(otro?.esFijo).toBe(true);
    expect(otro?.requiereComentario).toBe(true);
  });

  it('GET /motivos-diferencia?soloActivas=true → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const motivos = res.body as MotivoItem[];
    expect(Array.isArray(motivos)).toBe(true);
    expect(motivos.every((m) => m.activo)).toBe(true);
  });

  it('POST /motivos-diferencia con admin → 201 crea un motivo custom (esFijo:false)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/motivos-diferencia')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `Motivo E2E ${Date.now()}` });

    expect(res.status).toBe(201);
    const body = res.body as MotivoItem;
    expect(body.esFijo).toBe(false);
    expect(body.activo).toBe(true);
    customId = body.id;
  });

  it('POST /motivos-diferencia por no-admin → 403', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/motivos-diferencia')
      .set('Authorization', `Bearer ${tokenNoAdmin}`)
      .send({ nombre: `x ${Date.now()}` });
    expect(r.status).toBe(403);
  });

  it('PATCH /motivos-diferencia/:id por no-admin → 403', async () => {
    const r = await request(app.getHttpServer())
      .patch(`/api/motivos-diferencia/${ERROR_OPERACIONAL_ID}`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`)
      .send({ activo: false });
    expect(r.status).toBe(403);
  });

  // Gemelo del test de `causas-merma`: el `@IsOptional()` sin `@IsNotEmpty()`
  // dejaba pasar `''` y el motivo quedaba sin nombre, apareciendo en blanco en
  // el override de línea de `recuentos/[id].vue`. Lo rechaza el
  // `ValidationPipe`, que en unit no corre — por eso va acá.
  it('PATCH de un motivo custom con el nombre vacío → 400, y no lo deja sin nombre', async () => {
    // Vacío, solo espacios y null: ver el comentario del gemelo en `mermas`.
    for (const invalido of ['', '   ', null]) {
      const res = await request(app.getHttpServer())
        .patch(`/api/motivos-diferencia/${customId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: invalido });
      expect(res.status).toBe(400);
    }

    const resLista = await request(app.getHttpServer())
      .get('/api/motivos-diferencia')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resLista.status).toBe(200);
    const motivo = (resLista.body as MotivoItem[]).find(
      (m) => m.id === customId,
    );
    expect(motivo?.nombre).toBeTruthy();
  });

  it('PATCH sobre un motivo fijo cambiando nombre → 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/motivos-diferencia/${ERROR_OPERACIONAL_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Nombre modificado' });
    expect(res.status).toBe(400);
  });

  it('PATCH sobre un motivo fijo cambiando activo → 200 (persiste en BD)', async () => {
    try {
      const res = await request(app.getHttpServer())
        .patch(`/api/motivos-diferencia/${ERROR_OPERACIONAL_ID}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activo: false });
      expect(res.status).toBe(200);

      // ⚠️ Este comentario decía que `MotivosDiferenciaService.update()` no
      // desenvolvía la tupla `[rows, rowCount]` del `UPDATE...RETURNING` y que
      // por eso el body salía `{}` — "un bug de producción real". **Ya no es
      // cierto, y nunca lo fue por mucho**: se escribió el 2026-07-24 a las
      // 21:01 (`b793c74b`) y el `unwrap` entró a las 21:57 del mismo día
      // (`6e74ed5f`). Verificado el 2026-08-28: el service hace
      // `unwrap<Row>(...)` y devuelve `toItem(rows[0])`.
      // Lo que sigue en pie es el criterio de este test: la persistencia se
      // comprueba con un GET aparte, que es la lectura que le importa al
      // usuario, y no con el eco del PATCH.
      const verificar = await request(app.getHttpServer())
        .get('/api/motivos-diferencia')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(verificar.status).toBe(200);
      const motivo = (verificar.body as MotivoItem[]).find(
        (m) => m.id === ERROR_OPERACIONAL_ID,
      );
      expect(motivo?.activo).toBe(false);
    } finally {
      // Higiene: restaurar el motivo fijo del seed para no afectar otras
      // corridas/specs que compartan la BD (p.ej. el cierre de caja exige
      // motivo cuando hay motivos activos).
      await request(app.getHttpServer())
        .patch(`/api/motivos-diferencia/${ERROR_OPERACIONAL_ID}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activo: true });
    }
  });

  it('DELETE sobre un motivo fijo → 400', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/motivos-diferencia/${ERROR_OPERACIONAL_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(400);
  });

  it('DELETE /motivos-diferencia/:id por no-admin → 403', async () => {
    const r = await request(app.getHttpServer())
      .delete(`/api/motivos-diferencia/${customId}`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(r.status).toBe(403);
  });

  it('DELETE sobre el motivo custom creado → 204', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/motivos-diferencia/${customId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(204);
  });
});
