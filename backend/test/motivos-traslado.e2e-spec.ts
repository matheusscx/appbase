import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Admin: rol Administrador, es_fijo=true → short-circuit de permisos, y el
// único que pasa TenantAdminGuard.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// Vendedor: no es admin del tenant → TenantAdminGuard lo rechaza tanto en
// escritura como en restaurar.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

// Motivo fijo del seed (`seedMotivosTraslado`, "Entrega gratuita" es el 4to
// de MOTIVOS_TRASLADO_FIJOS → id 394 para Paris). Se usa solo para el PATCH
// de `activo` (se restaura en `finally`); nunca se toca su `nombre`.
const ENTREGA_GRATUITA_ID = '550e8400-e29b-41d4-a716-446655440394';

interface TokenResponse {
  access_token: string;
}
interface MotivoItem {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
  eliminadoEl?: string | null;
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

describe('Motivos de traslado (e2e) — CRUD admin-only + reglas de es_fijo', () => {
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

  it('GET /motivos-traslado con admin → 200 e incluye los 5 motivos fijos del sistema', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/motivos-traslado')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const motivos = res.body as MotivoItem[];
    expect(Array.isArray(motivos)).toBe(true);
    const nombresFijos = [
      'Traslado interno',
      'Ventas por efectuar',
      'Consignación',
      'Entrega gratuita',
      'Devolución a proveedor',
    ];
    for (const nombre of nombresFijos) {
      const motivo = motivos.find((m) => m.nombre === nombre);
      expect(motivo).toBeDefined();
      expect(motivo?.esFijo).toBe(true);
      expect(motivo?.activo).toBe(true);
    }
  });

  it('GET /motivos-traslado sin autenticar → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/motivos-traslado');
    expect(res.status).toBe(401);
  });

  it('GET /motivos-traslado?soloActivas=true → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/motivos-traslado?soloActivas=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);

    expect(res.status).toBe(200);
    const motivos = res.body as MotivoItem[];
    expect(Array.isArray(motivos)).toBe(true);
    expect(motivos.every((m) => m.activo)).toBe(true);
  });

  it('POST /motivos-traslado con admin → 201 crea un motivo custom (esFijo:false)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/motivos-traslado')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `Motivo traslado E2E ${Date.now()}` });

    expect(res.status).toBe(201);
    const body = res.body as MotivoItem;
    expect(body.esFijo).toBe(false);
    expect(body.activo).toBe(true);
    customId = body.id;
  });

  it('POST /motivos-traslado por no-admin → 403', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/motivos-traslado')
      .set('Authorization', `Bearer ${tokenNoAdmin}`)
      .send({ nombre: `x ${Date.now()}` });
    expect(r.status).toBe(403);
  });

  it('POST /motivos-traslado con nombre duplicado en el mismo tenant → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/motivos-traslado')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Traslado interno' });
    expect(res.status).toBe(400);
  });

  it('PATCH /motivos-traslado/:id por no-admin → 403', async () => {
    const r = await request(app.getHttpServer())
      .patch(`/api/motivos-traslado/${ENTREGA_GRATUITA_ID}`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`)
      .send({ activo: false });
    expect(r.status).toBe(403);
  });

  // El `@IsOptional()` sin `@IsNotEmpty()` dejaba pasar `''` y el motivo
  // quedaba sin nombre. Lo rechaza el `ValidationPipe`, que en unit no
  // corre — por eso va acá. Gemelo de `motivos-diferencia.e2e-spec.ts`.
  it('PATCH de un motivo custom con el nombre vacío → 400, y no lo deja sin nombre', async () => {
    for (const invalido of ['', '   ', null]) {
      const res = await request(app.getHttpServer())
        .patch(`/api/motivos-traslado/${customId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: invalido });
      expect(res.status).toBe(400);
    }

    const resLista = await request(app.getHttpServer())
      .get('/api/motivos-traslado')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resLista.status).toBe(200);
    const motivo = (resLista.body as MotivoItem[]).find(
      (m) => m.id === customId,
    );
    expect(motivo?.nombre).toBeTruthy();
  });

  it('PATCH sobre un motivo fijo cambiando nombre → 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/motivos-traslado/${ENTREGA_GRATUITA_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Nombre modificado' });
    expect(res.status).toBe(400);
  });

  // A diferencia de `motivos-diferencia` (caja), este molde (calcado de
  // `motivos-diferencia-inventario`/`causas-merma`) bloquea CUALQUIER
  // `update()` sobre un motivo fijo, no solo el renombre: `esFijo` corta
  // antes de mirar qué campo cambió (`motivos-traslado.service.ts` →
  // `update()`). La pantalla lo refleja deshabilitando el switch "Activo"
  // entero cuando `esFijo` es true, igual que en `causas-merma.vue`.
  it('PATCH sobre un motivo fijo cambiando activo → 400 (no se persiste)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/motivos-traslado/${ENTREGA_GRATUITA_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ activo: false });
    expect(res.status).toBe(400);

    const verificar = await request(app.getHttpServer())
      .get('/api/motivos-traslado')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(verificar.status).toBe(200);
    const motivo = (verificar.body as MotivoItem[]).find(
      (m) => m.id === ENTREGA_GRATUITA_ID,
    );
    expect(motivo?.activo).toBe(true);
  });

  it('DELETE sobre un motivo fijo → 400', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/motivos-traslado/${ENTREGA_GRATUITA_ID}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(400);
  });

  it('DELETE /motivos-traslado/:id por no-admin → 403', async () => {
    const r = await request(app.getHttpServer())
      .delete(`/api/motivos-traslado/${customId}`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(r.status).toBe(403);
  });

  it('DELETE sobre el motivo custom creado → 204, y POST .../restaurar lo revive', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/motivos-traslado/${customId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(204);

    const resLista = await request(app.getHttpServer())
      .get('/api/motivos-traslado')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resLista.status).toBe(200);
    expect(
      (resLista.body as MotivoItem[]).find((m) => m.id === customId),
    ).toBeUndefined();

    const resRestaurarSinAdmin = await request(app.getHttpServer())
      .post(`/api/motivos-traslado/${customId}/restaurar`)
      .set('Authorization', `Bearer ${tokenNoAdmin}`);
    expect(resRestaurarSinAdmin.status).toBe(403);

    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/motivos-traslado/${customId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(201);
    expect((resRestaurar.body as MotivoItem).eliminadoEl).toBeNull();
  });

  it('colisión real de Postgres: crear otro motivo con el mismo nombre y restaurar el borrado → 400, nada cambia', async () => {
    const nombre = `Motivo colisión E2E ${Date.now()}`;
    const original = await request(app.getHttpServer())
      .post('/api/motivos-traslado')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(original.status).toBe(201);
    const originalId = (original.body as MotivoItem).id;

    const resBorrar = await request(app.getHttpServer())
      .delete(`/api/motivos-traslado/${originalId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resBorrar.status).toBe(204);

    // Mientras estaba borrado, nadie competía por su nombre.
    const otra = await request(app.getHttpServer())
      .post('/api/motivos-traslado')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(otra.status).toBe(201);
    const otraId = (otra.body as MotivoItem).id;

    const resRestaurar = await request(app.getHttpServer())
      .post(`/api/motivos-traslado/${originalId}/restaurar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resRestaurar.status).toBe(400);
    expect(
      (resRestaurar.body as { nombreSugerido?: string }).nombreSugerido,
    ).toBeTruthy();

    // Limpieza.
    await request(app.getHttpServer())
      .delete(`/api/motivos-traslado/${otraId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
  });
});
