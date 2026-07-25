import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
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
  const initialToken = (resLogin.body as TokenResponse).access_token;

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
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

      // Nota: no se afirma sobre `res.body` acá — el UPDATE...RETURNING vía
      // TypeORM+pg devuelve la tupla `[rows, rowCount]` (no `rows` directo);
      // `MotivosDiferenciaService.update()` no la desenvuelve (a diferencia
      // de `liquidacion-propinas.service.ts:854`, que sí lo hace para el
      // mismo gotcha), así que el body de ESTA respuesta puntual sale `{}`.
      // Es un bug de producción real fuera del alcance de esta tarea
      // (solo test files) — se reporta en el informe de la tarea. El efecto
      // (persistencia) se verifica acá vía GET, que sí es de solo lectura.
      const verificar = await request(app.getHttpServer())
        .get('/api/motivos-diferencia')
        .set('Authorization', `Bearer ${tokenAdmin}`);
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
