import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Supervisor: rol Administrador, es_fijo=true → short-circuit de permisos,
// incluye Cajas:Leer.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

// Cajero: rol Vendedor, solo tiene MiCaja (sin Cajas).
// Nota: el seed usa el mismo hash de dev para todos los usuarios (password 'admin');
// ventas.e2e-spec.ts prueba con 'Vendedor1234!' pero ese test se salta en silencio
// si el login falla, por eso ese valor nunca se verificó.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CajaResponse {
  id: string;
}
interface CajonResponse {
  id: string;
}
interface CajonDisponible {
  cajonId: string;
}
interface Member {
  usuarioId: string;
  correo: string;
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

  // Switch a tenant Paris para que el token cargue tenant_id
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

/**
 * Abre una caja física (sobre un cajón) para el usuario del token. Si ya
 * tiene una abierta (409 — residuo de una corrida local previa abortada),
 * la reutiliza vía GET /api/caja/activa en vez de fallar.
 */
async function abrirOReusarCaja(
  app: INestApplication<App>,
  token: string,
  cajonId: string,
): Promise<string> {
  const resAbrir = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      cajonId,
      saldoInicial: '10000.0000',
      comentario: 'Apertura E2E caja',
    });

  if (resAbrir.status === 201) {
    return (resAbrir.body as CajaResponse).id;
  }

  // 409 esperado: ya existe una caja abierta para este usuario. Reusarla.
  const resActiva = await request(app.getHttpServer())
    .get('/api/caja/activa')
    .set('Authorization', `Bearer ${token}`);
  return (resActiva.body as CajaResponse).id;
}

/**
 * Resuelve el usuarioId del dueño de `token` matcheando su correo en
 * GET /api/tenants/members (patrón de cajones.e2e-spec.ts).
 */
async function usuarioIdDe(
  app: INestApplication<App>,
  token: string,
  email: string,
): Promise<string> {
  const resMiembros = await request(app.getHttpServer())
    .get('/api/tenants/members')
    .set('Authorization', `Bearer ${token}`);
  const miembro = (resMiembros.body as Member[]).find(
    (m) => m.correo === email,
  );
  if (!miembro) {
    throw new Error(`No se encontró en /tenants/members el correo ${email}`);
  }
  return miembro.usuarioId;
}

describe('Caja (e2e) — aislamiento cajero (MiCaja) vs supervisor (Cajas)', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenSupervisor: string;
  let cajaDelCajeroId: string;
  let cajonDelCajeroId: string;

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

    tokenCajero = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    tokenSupervisor = await login(app, ADMIN_EMAIL, ADMIN_PASS);

    // Cajón dedicado para las aperturas de este describe (AbrirCajaDto exige
    // cajonId — ver `describe('apertura sobre cajón (e2e)')` más abajo).
    const resCajon = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenSupervisor}`)
      .send({ nombre: `E2E Owner-only ${Date.now()}` });
    cajonDelCajeroId = (resCajon.body as CajonResponse).id;
  }, 60000);

  afterAll(async () => {
    if (cajonDelCajeroId) {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonDelCajeroId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    }
    await app.close();
  });

  describe('GET /caja/abiertas', () => {
    it('un cajero (solo MiCaja, sin Cajas) recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/api/caja/abiertas')
        .set('Authorization', `Bearer ${tokenCajero}`)
        .expect(403);
    });

    it('un supervisor (Cajas:Leer) puede listar todas las cajas abiertas', async () => {
      await request(app.getHttpServer())
        .get('/api/caja/abiertas')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .expect(200);
    });
  });

  describe('POST /caja/:id/cerrar — owner-only', () => {
    it('un supervisor NO puede cerrar la caja abierta por el cajero', async () => {
      cajaDelCajeroId = await abrirOReusarCaja(
        app,
        tokenCajero,
        cajonDelCajeroId,
      );

      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaDelCajeroId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        // montoContado usa IsNumberString({ no_symbols: true }): sin punto decimal.
        .send({ montoContado: '10000' });

      expect(res.status).toBe(403);
      expect((res.body as { message: string }).message).toBe(
        'No tienes acceso a esta caja',
      );
    });

    afterAll(async () => {
      // Higiene de reruns locales: cerrar la caja abierta por el cajero
      // (queda abierta a propósito durante el `it` de arriba, que verifica
      // que el supervisor no puede cerrarla). Se cierra acá, antes de que
      // otros describes intenten abrir una caja nueva para el cajero — solo
      // puede tener una física abierta por (tenant, usuario) a la vez.
      if (cajaDelCajeroId) {
        await request(app.getHttpServer())
          .post(`/api/caja/${cajaDelCajeroId}/cerrar`)
          .set('Authorization', `Bearer ${tokenCajero}`)
          // montoContado usa IsNumberString({ no_symbols: true }): sin punto decimal.
          .send({ montoContado: '10000' });
      }
    });
  });

  describe('apertura sobre cajón (e2e)', () => {
    let cajonId: string;

    beforeAll(async () => {
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ nombre: `E2E Apertura ${Date.now()}` });
      cajonId = (r.body as CajonResponse).id;
    });

    afterAll(async () => {
      // Soft-delete del cajón dedicado para no dejar residuos entre corridas.
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    });

    it('el cajón recién creado aparece en cajones-disponibles del admin', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/caja/cajones-disponibles')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(r.status).toBe(200);
      expect(
        (r.body as CajonDisponible[]).some((c) => c.cajonId === cajonId),
      ).toBe(true);
    });

    it('abrir sin cajonId es rechazado (400)', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ saldoInicial: '0' });
      expect(r.status).toBe(400);
    });

    it('abre sobre el cajón, queda ocupado, y no se puede desactivar con caja abierta (409)', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId, saldoInicial: '0' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      // el cajón ya no aparece disponible mientras tiene una sesión abierta
      const disp = await request(app.getHttpServer())
        .get('/api/caja/cajones-disponibles')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(
        (disp.body as CajonDisponible[]).some((c) => c.cajonId === cajonId),
      ).toBe(false);

      // guard de integridad: no se puede desactivar un cajón con caja abierta
      const desactivar = await request(app.getHttpServer())
        .patch(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ activo: false });
      expect(desactivar.status).toBe(409);

      // cerrar para dejar limpio (higiene de reruns locales)
      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ montoContado: '0' });
      expect([200, 201]).toContain(cerrar.status);
    });

    it('un usuario fuera del allow-list del cajón recibe 403 al abrir', async () => {
      const supervisorId = await usuarioIdDe(app, tokenSupervisor, ADMIN_EMAIL);

      // restringir el cajón al admin: el cajero queda fuera del allow-list
      const restringir = await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ usuarioIds: [supervisorId] });
      expect(restringir.status).toBe(200);

      const r = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ cajonId, saldoInicial: '0' });
      expect(r.status).toBe(403);

      // limpiar el allow-list para no afectar otras corridas
      const limpiar = await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ usuarioIds: [] });
      expect(limpiar.status).toBe(200);
    });
  });
});
