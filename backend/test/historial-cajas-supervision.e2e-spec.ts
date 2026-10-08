import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * El historial de cajas es de supervisión (decisión del owner del 2026-09-29,
 * opción A): el cajero —`MiCaja` sin `Cajas:Leer`— deja de ver sus turnos ya
 * cerrados, y el supervisor —`Cajas:Leer`— los sigue viendo. El cajero sigue
 * viendo y operando su caja ACTIVA: abierta, y en conciliación mientras
 * termina su propio cierre.
 *
 * Corre con los usuarios del rol real, no con el admin: el admin tiene
 * `Cajas:Leer` por el rol fijo y taparía el 403.
 * - cajero: `vendedor@paris.cl` (rol Vendedor, `MiCaja` sin `Cajas`)
 * - supervisor: `supervisor@paris.cl` (rol `Cajas · Supervisión`, `Cajas:Leer`
 *   a secas, sin `MiCaja`)
 *
 * La caja del cajero es única por usuario y la comparten otras suites
 * (`docs/patterns/backend.md` § 7): el `afterAll` la deja cerrada pase lo que
 * pase.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CAJERO = { email: 'vendedor@paris.cl', pass: 'admin' };
const SUPERVISOR = { email: 'supervisor@paris.cl', pass: 'admin' };
const MENSAJE = 'El historial de cajas es solo para supervisión';
const SALDO = '10000';

interface TokenResponse {
  access_token: string;
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

describe('Historial de cajas: de supervisión, no del cajero (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenCajero: string;
  let tokenSupervisor: string;
  let cajonId: string;
  let cajaCerradaId: string;
  let cajaAbiertaId: string | undefined;

  const get = (ruta: string, token: string) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${token}`);
  const post = (ruta: string, token: string, body: object) =>
    request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  async function abrir(): Promise<string> {
    const res = await post('/api/caja/abrir', tokenCajero, {
      cajonId,
      saldoInicial: SALDO,
      comentario: 'Apertura E2E historial',
    });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  /** Conteo con `montoContado`: si cuadra, auto-cierra; si no, concilia. */
  async function contar(cajaId: string, montoContado: string) {
    const res = await post(`/api/caja/${cajaId}/conteo`, tokenCajero, {
      lineas: [{ metodoPagoId: null, montoContado }],
    });
    expect(res.status).toBe(201);
    return res.body as { estado: string };
  }

  async function finalizar(cajaId: string) {
    const motivos = await get(
      '/api/motivos-diferencia?soloActivas=true',
      tokenCajero,
    );
    expect(motivos.status).toBe(200);
    const motivoId = (motivos.body as { id: string }[])[0]?.id;
    return post(`/api/caja/${cajaId}/cerrar`, tokenCajero, {
      lineas: [
        {
          metodoPagoId: null,
          motivoDiferenciaId: motivoId,
          comentarioDiferencia: 'Cierre de la suite e2e',
        },
      ],
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();

    tokenAdmin = await login(app, ADMIN.email, ADMIN.pass);
    tokenCajero = await login(app, CAJERO.email, CAJERO.pass);
    tokenSupervisor = await login(app, SUPERVISOR.email, SUPERVISOR.pass);

    const cajon = await post('/api/cajones', tokenAdmin, {
      nombre: `E2E historial ${Date.now()}`,
    });
    expect(cajon.status).toBe(201);
    cajonId = (cajon.body as { id: string }).id;

    // Un turno ya cerrado del propio cajero: es su historial.
    cajaCerradaId = await abrir();
    expect((await contar(cajaCerradaId, SALDO)).estado).toBe('cerrada');
  }, 60000);

  afterAll(async () => {
    try {
      if (cajaAbiertaId) {
        const activa = await get('/api/caja/activa', tokenCajero);
        expect(activa.status).toBe(200);
        const estado = (activa.body as { estado?: string } | null)?.estado;
        if (estado === 'abierta') await contar(cajaAbiertaId, SALDO);
        else if (estado === 'en_conciliacion') await finalizar(cajaAbiertaId);
      }
      if (cajonId) {
        await request(app.getHttpServer())
          .delete(`/api/cajones/${cajonId}`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
      }
    } finally {
      await app.close();
    }
  });

  describe('GET /caja (el listado)', () => {
    it.each([
      ['sin filtros', '/api/caja'],
      ['con su propio usuarioId', 'self'],
      ['con todas=true', '/api/caja?todas=true'],
    ])('el cajero recibe 403 %s', async (_caso, ruta) => {
      let url = ruta;
      if (ruta === 'self') {
        const me = await get('/api/auth/me', tokenCajero);
        expect(me.status).toBe(200);
        url = `/api/caja?usuarioId=${(me.body as { id: string }).id}`;
      }
      const res = await get(url, tokenCajero);
      expect(res.status).toBe(403);
      expect((res.body as { message: string }).message).toBe(MENSAJE);
    });

    it('el supervisor sigue viendo el turno cerrado del cajero', async () => {
      const res = await get(
        '/api/caja?todas=true&pageSize=100',
        tokenSupervisor,
      );
      expect(res.status).toBe(200);
      const ids = (res.body as { data: { id: string }[] }).data.map(
        (c) => c.id,
      );
      expect(ids).toContain(cajaCerradaId);
    });
  });

  describe('el detalle de una caja propia ya cerrada', () => {
    const rutas = [
      ['GET /caja/:id', ''],
      ['GET /caja/:id/arqueo', '/arqueo'],
      ['GET /caja/:id/movimientos', '/movimientos'],
      ['GET /caja/:id/movimientos/resumen', '/movimientos/resumen'],
    ];

    it.each(rutas)('%s: el cajero (dueño) recibe 403', async (_r, sufijo) => {
      const res = await get(`/api/caja/${cajaCerradaId}${sufijo}`, tokenCajero);
      expect(res.status).toBe(403);
      expect((res.body as { message: string }).message).toBe(MENSAJE);
    });

    it.each(rutas)('%s: el supervisor recibe 200', async (_r, sufijo) => {
      const res = await get(
        `/api/caja/${cajaCerradaId}${sufijo}`,
        tokenSupervisor,
      );
      expect(res.status).toBe(200);
    });
  });

  describe('el cajero sigue operando su caja de hoy', () => {
    it('abre, la ve, registra un movimiento y lee su turno en curso', async () => {
      cajaAbiertaId = await abrir();

      const activa = await get('/api/caja/activa', tokenCajero);
      expect(activa.status).toBe(200);
      expect((activa.body as { id: string }).id).toBe(cajaAbiertaId);

      const mov = await post(
        `/api/caja/${cajaAbiertaId}/movimientos`,
        tokenCajero,
        { tipo: 'entrada', concepto: 'Fondo E2E historial', monto: '500' },
      );
      expect(mov.status).toBe(201);

      for (const sufijo of [
        '',
        '/arqueo',
        '/movimientos',
        '/movimientos/resumen',
      ]) {
        const res = await get(
          `/api/caja/${cajaAbiertaId}${sufijo}`,
          tokenCajero,
        );
        expect({ sufijo, status: res.status }).toEqual({ sufijo, status: 200 });
      }
    });

    it('en conciliación la sigue viendo, la cierra, y recién ahí pasa a historial', async () => {
      expect(cajaAbiertaId).toBeDefined();
      const cajaId = cajaAbiertaId!;

      // Cuenta solo el saldo inicial: le faltan los 500 de la entrada.
      expect((await contar(cajaId, SALDO)).estado).toBe('en_conciliacion');

      const detalle = await get(`/api/caja/${cajaId}`, tokenCajero);
      expect(detalle.status).toBe(200);
      expect((detalle.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );
      for (const sufijo of [
        '/arqueo',
        '/movimientos',
        '/movimientos/resumen',
      ]) {
        const res = await get(`/api/caja/${cajaId}${sufijo}`, tokenCajero);
        expect({ sufijo, status: res.status }).toEqual({ sufijo, status: 200 });
      }

      // La revelación ocurre al cerrar: la respuesta trae el arqueo congelado.
      const cierre = await finalizar(cajaId);
      expect(cierre.status).toBe(201);
      const linea = (
        cierre.body as {
          arqueo: { metodoPagoId: string | null; diferencia: string }[];
        }
      ).arqueo.find((l) => l.metodoPagoId === null);
      expect(linea?.diferencia).toBe('-500.0000');

      const despues = await get(`/api/caja/${cajaId}`, tokenCajero);
      expect(despues.status).toBe(403);
      expect((despues.body as { message: string }).message).toBe(MENSAJE);
    });
  });
});
