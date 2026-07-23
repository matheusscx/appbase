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
 * Abre una caja física para el usuario del token. Si ya tiene una abierta
 * (409 — residuo de una corrida local previa abortada), la reutiliza vía
 * GET /api/caja/activa en vez de fallar.
 */
async function abrirOReusarCaja(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const resAbrir = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({ saldoInicial: '10000.0000', comentario: 'Apertura E2E caja' });

  if (resAbrir.status === 201) {
    return (resAbrir.body as CajaResponse).id;
  }

  // 409 esperado: ya existe una caja abierta para este usuario. Reusarla.
  const resActiva = await request(app.getHttpServer())
    .get('/api/caja/activa')
    .set('Authorization', `Bearer ${token}`);
  return (resActiva.body as CajaResponse).id;
}

describe('Caja (e2e) — aislamiento cajero (MiCaja) vs supervisor (Cajas)', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenSupervisor: string;
  let cajaDelCajeroId: string;

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
  }, 60000);

  afterAll(async () => {
    // Higiene de reruns locales: cerrar la caja abierta por el cajero para
    // que la próxima corrida no choque con el límite de una física abierta
    // por (tenant, usuario).
    if (cajaDelCajeroId) {
      await request(app.getHttpServer())
        .post(`/api/caja/${cajaDelCajeroId}/cerrar`)
        .set('Authorization', `Bearer ${tokenCajero}`)
        // montoContado usa IsNumberString({ no_symbols: true }): sin punto decimal.
        .send({ montoContado: '10000' });
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
      cajaDelCajeroId = await abrirOReusarCaja(app, tokenCajero);

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
  });
});
