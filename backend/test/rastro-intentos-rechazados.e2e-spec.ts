import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Rastro de los intentos rechazados contra la plata de una caja — la salida
 * "detectiva" que el owner eligió el 2026-08-22 para los dos oráculos del modo
 * ciego (`docs/agent/resueltos.md`, "El modo ciego deja de prometer lo que no sostiene").
 *
 * **Lo que solo este spec puede probar, y por eso existe:** que el rastro
 * SOBREVIVE AL ROLLBACK contra Postgres de verdad. El 422 aborta la
 * transacción del movimiento; el unit test fija que la escritura sale por
 * `db.sinTransaccion` y después de que la transacción terminó, pero solo acá se
 * ve el resultado de las dos cosas juntas: el movimiento NO quedó y el intento
 * SÍ.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Admin del tenant: el ciego no le aplica, y es quien lo prende y lo apaga.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
// Supervisor de verdad: rol 'Cajas · Supervisión' (Cajas:Leer y nada más), NO
// admin del tenant. Es a quien está destinada esta lectura.
const SUPERVISOR_EMAIL = 'supervisor@paris.cl';
const SUPERVISOR_PASS = 'admin';
// Cajero: rol Vendedor, solo MiCaja. El vigilado — el que NO puede leer el
// rastro, y el único que puede producirlo.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';

interface TokenResponse {
  access_token: string;
}
interface Member {
  usuarioId: string;
  correo: string;
}
interface ArqueoLinea {
  metodoPagoId: string | null;
  nombre: string;
  esEfectivo: boolean;
  esperado: string | null;
  requiereConteo: boolean;
  diferencia?: string | null;
}
interface IntentoRechazado {
  id: string;
  cajaId: string;
  cajonNombre: string | null;
  usuarioId: string;
  usuarioNombre: string;
  tipo: string;
  motivo: string;
  montoSolicitado: string;
  ventaId: string | null;
  fecha: string;
}
interface Paginado<T> {
  data: T[];
  meta: { total: number };
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
  const initial = (resLogin.body as TokenResponse).access_token;

  // La cookie de refresh se reenvía a mano: `switch-tenant` la exige y
  // supertest no arrastra cookies entre requests. Responde 200, no 201.
  const resSwitch = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initial}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resSwitch.status).toBe(200);
  return (resSwitch.body as TokenResponse).access_token;
}

describe('Rastro de intentos rechazados (e2e)', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenSupervisor: string;
  let tokenAdmin: string;
  let cajonId: string;
  let cajeroId: string;
  let cajaId: string;
  let ciegoOriginal = false;

  const arqueoDe = async (id: string): Promise<ArqueoLinea[]> =>
    (
      await request(app.getHttpServer())
        .get(`/api/caja/${id}/arqueo`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
    ).body.lineas as ArqueoLinea[];

  /** Los intentos que ve el supervisor, con los filtros que se le pasen. */
  async function intentos(
    token: string,
    qs = '',
  ): Promise<Paginado<IntentoRechazado>> {
    const res = await request(app.getHttpServer())
      .get(`/api/caja/intentos-rechazados${qs}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as Paginado<IntentoRechazado>;
  }

  /**
   * Deja al cajero sin caja activa, venga como venga de otra suite. Sin aserción
   * de status: si el GET falla, se sale sin hacer nada en vez de tirar un rojo
   * de limpieza encima del fallo real.
   */
  async function liberarCajero(): Promise<void> {
    const activa = await request(app.getHttpServer())
      .get('/api/caja/activa')
      .set('Authorization', `Bearer ${tokenCajero}`);
    const caja = activa.body as { id?: string; estado?: string } | null;
    if (!caja?.id) return;

    if (caja.estado === 'abierta') {
      const lineas = await arqueoDe(caja.id);
      await request(app.getHttpServer())
        .post(`/api/caja/${caja.id}/conteo`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          lineas: lineas.map((l) => ({
            metodoPagoId: l.metodoPagoId,
            montoContado: l.esperado ?? '0',
          })),
        });
    }
    const congeladas = await arqueoDe(caja.id);
    await request(app.getHttpServer())
      .post(`/api/caja/${caja.id}/cerrar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lineas: congeladas
          .filter((l) => l.diferencia != null && Number(l.diferencia) !== 0)
          .map((l) => ({
            metodoPagoId: l.metodoPagoId,
            motivoDiferenciaId: FALTA_EFECTIVO_ID,
            comentarioDiferencia: 'Higiene E2E',
          })),
        comentario: 'Higiene E2E: liberar caja atascada',
      });
  }

  async function setCiego(valor: boolean): Promise<void> {
    const res = await request(app.getHttpServer())
      .put('/api/caja/arqueo-ciego')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ arqueoCiego: valor });
    expect(res.status).toBe(200);
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

    tokenCajero = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    tokenSupervisor = await login(app, SUPERVISOR_EMAIL, SUPERVISOR_PASS);
    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);

    const resFlag = await request(app.getHttpServer())
      .get('/api/caja/arqueo-ciego')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resFlag.status).toBe(200);
    ciegoOriginal = (resFlag.body as { arqueoCiego: boolean }).arqueoCiego;

    const resCajon = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `E2E Rastro ${Date.now()}` });
    expect(resCajon.status).toBe(201);
    cajonId = (resCajon.body as { id: string }).id;

    const resMiembros = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resMiembros.status).toBe(200);
    cajeroId = (resMiembros.body as Member[]).find(
      (m) => m.correo === VENDEDOR_EMAIL,
    )!.usuarioId;

    await liberarCajero();

    const resAbrir = await request(app.getHttpServer())
      .post('/api/caja/abrir')
      .set('Authorization', `Bearer ${tokenCajero}`)
      .send({ cajonId, saldoInicial: '10000.0000' });
    expect(resAbrir.status).toBe(201);
    cajaId = (resAbrir.body as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    try {
      await setCiego(ciegoOriginal);
      await liberarCajero();
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    } finally {
      await app.close();
    }
  });

  describe('fuga 2 — el retiro rechazado deja rastro y el rechazo sigue firme', () => {
    it('el 422 sobrevive: no se crea el movimiento, pero SÍ el intento', async () => {
      const antes = await intentos(tokenSupervisor, `?cajaId=${cajaId}`);

      // Muy por encima de los 10.000 del fondo: el chequeo de saldo lo corta.
      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/movimientos`)
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ tipo: 'salida', concepto: 'Retiro E2E', monto: '99999' });
      expect(res.status).toBe(422);
      expect((res.body as { message: string }).message).toBe(
        'Saldo insuficiente en caja',
      );

      // La transacción se deshizo de verdad: el esperado no se movió.
      const arqueo = await arqueoDe(cajaId);
      const efectivo = arqueo.find((l) => l.esEfectivo);
      expect(efectivo?.esperado).toBe('10000.0000');

      // Y el rastro NO se fue con ese rollback.
      const despues = await intentos(tokenSupervisor, `?cajaId=${cajaId}`);
      expect(despues.meta.total).toBe(antes.meta.total + 1);
    });

    it('el intento dice quién, qué caja, cuánto pidió y por qué se rechazó', async () => {
      await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/movimientos`)
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ tipo: 'salida', concepto: 'Retiro E2E', monto: '88888' })
        .expect(422);

      const { data } = await intentos(tokenSupervisor, `?cajaId=${cajaId}`);
      const ultimo = data.find((i) => i.montoSolicitado === '88888.0000');
      expect(ultimo).toBeTruthy();
      expect(ultimo!.cajaId).toBe(cajaId);
      expect(ultimo!.usuarioId).toBe(cajeroId);
      expect(ultimo!.tipo).toBe('retiro');
      expect(ultimo!.motivo).toBe('saldo_insuficiente');
      expect(ultimo!.ventaId).toBeNull();
      // El JOIN resuelve el nombre del cajero y del cajón en la misma query.
      expect(ultimo!.usuarioNombre).not.toBe('Sin usuario');
      expect(ultimo!.cajonNombre).toContain('E2E Rastro');
    });

    it('el 422 NO dice cuánto había: el mensaje no es un oráculo', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/movimientos`)
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ tipo: 'salida', concepto: 'Retiro E2E', monto: '77777' });
      expect(res.status).toBe(422);
      expect((res.body as { message: string }).message).not.toMatch(/10000/);
    });

    it('el retiro que SÍ pasa no deja intento: el rastro es de rechazos', async () => {
      const antes = await intentos(tokenSupervisor, `?cajaId=${cajaId}`);

      await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/movimientos`)
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ tipo: 'salida', concepto: 'Retiro chico E2E', monto: '100' })
        .expect(201);
      // Compensar para que el arqueo del cierre vuelva a cuadrar solo.
      await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/movimientos`)
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ tipo: 'entrada', concepto: 'Reposición E2E', monto: '100' })
        .expect(201);

      const despues = await intentos(tokenSupervisor, `?cajaId=${cajaId}`);
      expect(despues.meta.total).toBe(antes.meta.total);
    });
  });

  describe('quién puede leer el rastro', () => {
    it('el cajero (solo MiCaja) recibe 403: el vigilado no ve su propio ruido', async () => {
      await request(app.getHttpServer())
        .get('/api/caja/intentos-rechazados')
        .set('Authorization', `Bearer ${tokenCajero}`)
        .expect(403);
    });

    it('el supervisor (Cajas:Leer, no admin) sí lo lee', async () => {
      const { data } = await intentos(tokenSupervisor, `?cajaId=${cajaId}`);
      expect(data.length).toBeGreaterThan(0);
    });

    it('filtra por usuario, y un usuario sin intentos devuelve vacío', async () => {
      const mios = await intentos(tokenSupervisor, `?usuarioId=${cajeroId}`);
      expect(mios.data.every((i) => i.usuarioId === cajeroId)).toBe(true);

      const resMiembros = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resMiembros.status).toBe(200);
      const adminId = (resMiembros.body as Member[]).find(
        (m) => m.correo === ADMIN_EMAIL,
      )!.usuarioId;
      const ajenos = await intentos(tokenSupervisor, `?usuarioId=${adminId}`);
      expect(ajenos.data.every((i) => i.usuarioId === adminId)).toBe(true);
      expect(ajenos.data.some((i) => i.usuarioId === cajeroId)).toBe(false);
    });
  });

  describe('fuga 6 — el 400 del conteo enumera medios', () => {
    // Se manda el conteo SIN la línea de efectivo, que es obligatoria siempre:
    // el 400 es el mismo en los dos casos, lo único que cambia es si nombra el
    // medio. La caja no se toca (el 400 corta antes de congelar nada).
    const conteoSinEfectivo = () =>
      request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ lineas: [] });

    it('sin ciego el mensaje nombra el medio que falta', async () => {
      await setCiego(false);
      const res = await conteoSinEfectivo();
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'Falta el conteo de Efectivo',
      );
    });

    it('con ciego el mensaje NO nombra ningún medio', async () => {
      await setCiego(true);
      const res = await conteoSinEfectivo();
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'Falta el conteo de un medio de pago obligatorio',
      );
    });

    it('al admin del tenant el ciego no le aplica: sigue viendo el nombre', async () => {
      await setCiego(true);
      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ lineas: [] });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'Falta el conteo de Efectivo',
      );
    });
  });
});
