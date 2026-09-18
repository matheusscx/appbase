import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * `GET /api/salones/ocupacion` (dashboard de inicio, spec
 * `2026-09-18-dashboard-inicio-design.md` § 5.2): el bloque "Ahora" del
 * dueño. `Salones:Ver todas`, no `Operar` — un garzón que solo opera su mesa
 * no ve la ocupación de todo el salón.
 *
 * Garzón, salón y mesa son PROPIOS de este archivo, no del seed: la sesión de
 * garzón es única y varias suites la comparten (`docs/agent/pendientes.md`).
 *
 * Robusto a correrse dos veces sin reset: nombres únicos con `Date.now()` y
 * aserciones por DELTA contra una foto tomada al arrancar, nunca por conteo
 * absoluto — otros tenants/specs pueden dejar cuentas abiertas de sobra.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
/** `Salones:Crear` + `Operar` + `Ver todas` (seedRolEncargadoSalon). */
const ENCARGADO = { email: 'encargado.salon@paris.cl', pass: 'admin' };
/** `Salones:Leer` + `Operar`, SIN `Ver todas`: el 403 de este spec. */
const SOLO_OPERAR = { email: 'ana.torres@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface GarzonCreado {
  id: string;
  pin: string;
}
interface OcupacionSalones {
  mesasOcupadas: number;
  mesasTotal: number;
  cuentasAbiertas: number;
}
interface CuentaDetalle {
  id: string;
  estado: string;
}

async function entrar(
  app: INestApplication<App>,
  email: string,
  pass: string,
): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: pass });
  expect(login.status).toBe(200);

  const enTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
    .set(
      'Authorization',
      `Bearer ${(login.body as TokenResponse).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(enTenant.status).toBe(200);
  return (enTenant.body as TokenResponse).access_token;
}

describe('Salones — ocupación (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenEncargado: string;
  let tokenSoloOperar: string;
  let mesaId: string;
  let garzon: GarzonCreado;

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    token = tokenEncargado,
    esperado = 201,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  async function ocupacion(token: string) {
    return request(app.getHttpServer())
      .get('/api/salones/ocupacion')
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    tokenAdmin = await entrar(app, ADMIN.email, ADMIN.pass);
    tokenEncargado = await entrar(app, ENCARGADO.email, ENCARGADO.pass);
    tokenSoloOperar = await entrar(app, SOLO_OPERAR.email, SOLO_OPERAR.pass);

    const marca = Date.now();

    // Garzón PROPIO: la sesión es única por garzón y varios specs la
    // comparten (`docs/agent/pendientes.md`).
    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón ocupación E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });

    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón ocupación E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa ocupación',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    // Mejor esfuerzo: cerrar la sesión del garzón no es el objeto de este
    // spec y no debería tumbar la suite si falla.
    try {
      await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ garzonId: garzon.id, pin: garzon.pin });
    } catch {
      // best-effort
    }
    await app.close();
  });

  it('403 sin Salones:Ver todas (Leer + Operar solamente)', async () => {
    const res = await ocupacion(tokenSoloOperar);
    expect(res.status).toBe(403);
  });

  it('200 con Ver todas (encargado.salon) y con el admin del tenant', async () => {
    const resEncargado = await ocupacion(tokenEncargado);
    expect(resEncargado.status).toBe(200);
    const body = resEncargado.body as OcupacionSalones;
    expect(typeof body.mesasOcupadas).toBe('number');
    expect(typeof body.mesasTotal).toBe('number');
    expect(typeof body.cuentasAbiertas).toBe('number');

    const resAdmin = await ocupacion(tokenAdmin);
    expect(resAdmin.status).toBe(200);
  });

  it('abrir una cuenta sube mesasOcupadas y cuentasAbiertas en 1 (delta); cancelarla los baja', async () => {
    const antes = (await ocupacion(tokenEncargado)).body as OcupacionSalones;

    const cuenta = await post<CuentaDetalle>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    expect(cuenta.estado).toBe('abierta');

    const conCuentaAbierta = (await ocupacion(tokenEncargado))
      .body as OcupacionSalones;
    expect(conCuentaAbierta.mesasOcupadas).toBe(antes.mesasOcupadas + 1);
    expect(conCuentaAbierta.cuentasAbiertas).toBe(antes.cuentasAbiertas + 1);
    // mesasTotal no se mueve por abrir/cerrar cuentas — solo por crear/borrar
    // mesas, y acá no se crea ninguna.
    expect(conCuentaAbierta.mesasTotal).toBe(antes.mesasTotal);

    const cancelada = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuenta.id}/cancelar`)
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({});
    expect(cancelada.status).toBe(201);
    expect((cancelada.body as CuentaDetalle).estado).toBe('cancelada');

    const despues = (await ocupacion(tokenEncargado)).body as OcupacionSalones;
    expect(despues.mesasOcupadas).toBe(antes.mesasOcupadas);
    expect(despues.cuentasAbiertas).toBe(antes.cuentasAbiertas);
    expect(despues.mesasTotal).toBe(antes.mesasTotal);
  });
});
