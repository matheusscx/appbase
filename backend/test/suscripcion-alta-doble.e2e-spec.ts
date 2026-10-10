import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { ProviderFactory } from '../src/modules/pasarela/providers/provider.factory';
import {
  ProviderComunicacionError,
  type ResultadoCobro,
  type ResultadoEstado,
} from '../src/modules/pasarela/providers/payment-provider.interface';
import { InscripcionesService } from '../src/modules/pasarela/services/inscripciones.service';
import { TenantPasarelaService } from '../src/modules/pasarela/services/tenant-pasarela.service';
import { CredencialesService } from '../src/modules/pasarela/services/credenciales.service';
import { ExpirarOrdenesJob } from '../src/modules/cron/jobs/expirar-ordenes.job';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };
const PLAN_MENSUAL_DEMO = '550e8400-e29b-41d4-a716-446655440352'; // seedSuscripcionDemo
// Sin FK: la configuración de pasarela la resuelve el doble.
const TENANT_PASARELA_E2E = randomUUID();

interface Alta {
  id: string;
  ventaInicialId: string;
  repetida?: boolean;
}

/**
 * El alta de una suscripción cobra una vez por intento, aunque el cliente
 * confirme dos veces (ADR-029, § "El alta de suscripción").
 *
 * La escena es la de ADR-026: el alta entra, la respuesta se corta, el cliente
 * ve "No se pudo activar la suscripción" y vuelve a confirmar con la misma
 * `Idempotency-Key`. Hasta el 2026-10-10 eso daba dos cobros, dos ventas y dos
 * suscripciones (medido en `12097cfa` con este mismo archivo).
 *
 * Transbank es un doble a la altura del proveedor (`ProviderFactory`), con
 * `InscripcionesService` y `TenantPasarelaService` que resuelven una tarjeta y
 * un Oneclick activo. Todo lo demás es real: la orden write-ahead, la
 * AUTHORIZATION, la venta y la suscripción. Por eso no se sobrescribe
 * `CobrosService` como en la medición: la orden que se escribe antes de cobrar
 * ES el arreglo.
 *
 * Cada test usa una tarjeta (`inscripcionId`) propia, y las cuentas son por
 * tarjeta: así no se mezcla con las altas de otros tests ni de otras suites.
 */
describe('Suscripciones: el alta cobra una vez por intento (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let tbkUserCifrado: string;

  const autorizar = jest.fn<Promise<ResultadoCobro>, [unknown, unknown]>();
  const consultar = jest.fn<Promise<ResultadoEstado>, [unknown, unknown]>();

  const aprobado = (): Promise<ResultadoCobro> =>
    Promise.resolve({
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: '1213',
      identificadorTransaccionExterno: null,
      tipoPago: 'VN',
      numeroCuotas: 0,
      montoCuota: null,
      tarjetaUltimos4: '6623',
      request: {},
      response: {},
    });
  const sinRespuesta = (): Promise<ResultadoCobro> =>
    Promise.reject(
      new ProviderComunicacionError('timeout', { buy_order: 'x' }, {}),
    );
  /** Lo que Transbank dice de una orden que conoce. `fallida` es un `FAILED` explícito. */
  const estado = (e: ResultadoEstado['estado']): Promise<ResultadoEstado> =>
    Promise.resolve({
      estado: e,
      estadoProveedor:
        e === 'pagada' ? 'AUTHORIZED' : e === 'fallida' ? 'FAILED' : null,
      saldo: null,
      response: { status: e },
    });
  /** El 404 de Oneclick: no conoce la orden (o todavía no la registró). */
  const noLaConoce = (): Promise<ResultadoEstado> =>
    Promise.resolve({
      estado: 'fallida',
      estadoProveedor: null,
      saldo: null,
      noEncontrada: true,
      response: {},
    });

  const alta = (inscripcionId: string, clave: string | null, diaMes = 5) => {
    const r = request(app.getHttpServer())
      .post('/api/suscripciones')
      .set('Authorization', `Bearer ${token}`);
    if (clave) r.set('Idempotency-Key', clave);
    return r.send({ itemId: PLAN_MENSUAL_DEMO, diaMes, inscripcionId });
  };

  /** Lo que dejó una tarjeta: suscripciones, ventas y órdenes. */
  const rastroDe = async (inscripcionId: string) => {
    const suscripciones = await ds.query<{ venta_inicial_id: string }[]>(
      `SELECT venta_inicial_id FROM suscripciones
        WHERE tenant_id = $1 AND inscripcion_id = $2 AND eliminado_el IS NULL`,
      [TENANT_ID, inscripcionId],
    );
    const ordenes = await ds.query<
      { orden_id: string; estado: string; venta_id: string | null }[]
    >(
      `SELECT orden_id, estado, venta_id FROM pasarela_ordenes
        WHERE tenant_id = $1 AND metadata->>'inscripcionId' = $2
          AND eliminado_el IS NULL
        ORDER BY creado_el`,
      [TENANT_ID, inscripcionId],
    );
    const [ventas] = await ds.query<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM ventas
        WHERE venta_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
      [suscripciones.map((s) => s.venta_inicial_id)],
    );
    return { suscripciones, ordenes, ventas: Number(ventas.n) };
  };

  const autorizacionesDe = (ordenId: string) =>
    ds.query<{ estado: string }[]>(
      `SELECT estado FROM pasarela_transacciones
        WHERE orden_id = $1 AND tipo = 'AUTHORIZATION' AND eliminado_el IS NULL
        ORDER BY fecha_transaccion`,
      [ordenId],
    );

  beforeAll(async () => {
    const proveedor = {
      autorizarCobro: autorizar,
      consultarEstado: consultar,
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderFactory)
      .useValue({
        getTokenizado: () => proveedor,
        getReembolsable: () => proveedor,
      })
      .overrideProvider(InscripcionesService)
      .useValue({
        resolverMedioDeUsuario: () =>
          Promise.resolve({ marca: 'Visa', ultimos4: '6623' }),
        resolverParaCobro: (
          _tenantId: string,
          inscripcionId: string,
          pagadorRef: string,
        ) =>
          Promise.resolve({
            inscripcionId,
            pagadorRef,
            identificadorUsuarioExterno: 'cliente-e2e',
            identificadorExterno: tbkUserCifrado,
          }),
      })
      .overrideProvider(TenantPasarelaService)
      .useValue({
        resolverConfiguracionActiva: () =>
          Promise.resolve({
            tenantPasarela: { tenantPasarelaId: TENANT_PASARELA_E2E },
            pasarela: { codigo: 'oneclick' },
            cred: {},
          }),
        resolverPorId: () =>
          Promise.resolve({ pasarela: { codigo: 'oneclick' }, cred: {} }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);
    tbkUserCifrado = app.get(CredencialesService).cifrarTexto('tbk-user-e2e');

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(ADMIN);
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as { access_token: string }).access_token}`,
      )
      .send({ tenantId: TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as { access_token: string }).access_token;
  });

  beforeEach(() => {
    autorizar.mockReset().mockImplementation(aprobado);
    consultar.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('control: un alta cobra una vez y deja una venta y una suscripción', async () => {
    const tarjeta = randomUUID();

    const res = await alta(tarjeta, randomUUID());

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('repetida');
    expect(autorizar).toHaveBeenCalledTimes(1);
    // 30.000 neto + IVA 19% (el ítem del seed no incluye impuesto). El monto
    // llega con la escala de la columna: se compara el valor, no el formato.
    const { monto } = autorizar.mock.calls[0][1] as { monto: string };
    expect(new Decimal(monto).toString()).toBe('35700');
    const r = await rastroDe(tarjeta);
    expect(r.suscripciones).toHaveLength(1);
    expect(r.ventas).toBe(1);
    expect(r.ordenes).toEqual([
      {
        orden_id: expect.any(String) as string,
        estado: 'conciliada',
        venta_id: (res.body as Alta).ventaInicialId,
      },
    ]);
    expect(await autorizacionesDe(r.ordenes[0].orden_id)).toEqual([
      { estado: 'aprobada' },
    ]);
  });

  it('sin Idempotency-Key responde 400 y no cobra', async () => {
    const tarjeta = randomUUID();

    const res = await alta(tarjeta, null);

    expect(res.status).toBe(400);
    expect(autorizar).not.toHaveBeenCalled();
    expect((await rastroDe(tarjeta)).ordenes).toHaveLength(0);
  });

  it('el mismo alta dos veces cobra una vez: el segundo responde "ya estaba activa"', async () => {
    const tarjeta = randomUUID();
    const clave = randomUUID();

    const primera = await alta(tarjeta, clave);
    const segunda = await alta(tarjeta, clave);

    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(201);
    expect(autorizar).toHaveBeenCalledTimes(1);
    const a = primera.body as Alta;
    const b = segunda.body as Alta;
    expect(b.repetida).toBe(true);
    expect(b.id).toBe(a.id);
    expect(b.ventaInicialId).toBe(a.ventaInicialId);
    const r = await rastroDe(tarjeta);
    expect(r.suscripciones).toHaveLength(1);
    expect(r.ventas).toBe(1);
    expect(r.ordenes).toHaveLength(1);
  });

  it('dos a la vez: el segundo espera al primero y no cobra', async () => {
    const tarjeta = randomUUID();
    const clave = randomUUID();
    autorizar.mockImplementation(
      () =>
        new Promise<ResultadoCobro>((resolve) => {
          setTimeout(() => resolve(aprobado()), 400);
        }),
    );

    const [a, b] = await Promise.all([
      alta(tarjeta, clave),
      alta(tarjeta, clave),
    ]);

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(autorizar).toHaveBeenCalledTimes(1);
    // Esperó el lock del reclamo y reprodujo: no hubo nada que aclarar.
    expect(consultar).not.toHaveBeenCalled();
    const repetidas = [a.body as Alta, b.body as Alta].filter(
      (alta) => alta.repetida,
    );
    expect(repetidas).toHaveLength(1);
    expect((a.body as Alta).id).toBe((b.body as Alta).id);
    expect((await rastroDe(tarjeta)).suscripciones).toHaveLength(1);
  });

  it('la misma clave con otros datos responde 422 y no cobra de nuevo', async () => {
    const tarjeta = randomUUID();
    const clave = randomUUID();

    const primera = await alta(tarjeta, clave, 5);
    const otra = await alta(tarjeta, clave, 6);

    expect(primera.status).toBe(201);
    expect(otra.status).toBe(422);
    expect((otra.body as { message: string }).message).toMatch(
      /ya se había pedido con otros datos/,
    );
    expect(autorizar).toHaveBeenCalledTimes(1);
    expect((await rastroDe(tarjeta)).suscripciones).toHaveLength(1);
  });

  it('un rechazo suelta la clave: el mismo intento con otra tarjeta cobra', async () => {
    const rechazada = randomUUID();
    const otraTarjeta = randomUUID();
    const clave = randomUUID();
    autorizar.mockImplementationOnce(async () => ({
      ...(await aprobado()),
      aprobada: false,
      codigoRespuesta: '-1',
      codigoAutorizacion: null,
    }));

    const primera = await alta(rechazada, clave);
    const segunda = await alta(otraTarjeta, clave);

    expect(primera.status).toBe(400);
    expect((primera.body as { message: string }).message).toMatch(/rechazado/);
    expect(segunda.status).toBe(201);
    expect(segunda.body).not.toHaveProperty('repetida');
    expect(autorizar).toHaveBeenCalledTimes(2);
    const r1 = await rastroDe(rechazada);
    expect(r1.suscripciones).toHaveLength(0);
    expect(r1.ordenes.map((o) => o.estado)).toEqual(['fallida']);
    expect((await rastroDe(otraTarjeta)).suscripciones).toHaveLength(1);
  });

  describe('Transbank no contesta (502) y el cliente reintenta', () => {
    it('si el cobro salió, termina el alta sin cobrar de nuevo', async () => {
      const tarjeta = randomUUID();
      const clave = randomUUID();
      autorizar.mockImplementationOnce(sinRespuesta);
      consultar.mockImplementation(() => estado('pagada'));

      const primera = await alta(tarjeta, clave);
      expect(primera.status).toBe(502);
      const enDuda = await rastroDe(tarjeta);
      expect(enDuda.ordenes.map((o) => o.estado)).toEqual(['en_proceso']);
      expect(enDuda.suscripciones).toHaveLength(0);
      expect(await autorizacionesDe(enDuda.ordenes[0].orden_id)).toEqual([
        { estado: 'error' },
      ]);

      const segunda = await alta(tarjeta, clave);

      expect(segunda.status).toBe(201);
      expect((segunda.body as Alta).repetida).toBe(true);
      expect(autorizar).toHaveBeenCalledTimes(1);
      expect(consultar).toHaveBeenCalledTimes(1);
      const r = await rastroDe(tarjeta);
      expect(r.suscripciones).toHaveLength(1);
      expect(r.ventas).toBe(1);
      expect(r.ordenes).toEqual([
        {
          orden_id: enDuda.ordenes[0].orden_id,
          estado: 'conciliada',
          venta_id: (segunda.body as Alta).ventaInicialId,
        },
      ]);
      // Sin la AUTHORIZATION aprobada la orden no se podría reembolsar.
      expect(await autorizacionesDe(r.ordenes[0].orden_id)).toEqual([
        { estado: 'error' },
        { estado: 'aprobada' },
      ]);

      // Y un tercer clic reproduce, sin volver a consultar.
      const tercera = await alta(tarjeta, clave);
      expect(tercera.status).toBe(201);
      expect((tercera.body as Alta).id).toBe((segunda.body as Alta).id);
      expect(consultar).toHaveBeenCalledTimes(1);
    });

    it('si el cobro no salió, lo dice y suelta la clave: el clic siguiente cobra', async () => {
      const tarjeta = randomUUID();
      const clave = randomUUID();
      autorizar.mockImplementationOnce(sinRespuesta);
      consultar.mockImplementation(() => estado('fallida'));

      expect((await alta(tarjeta, clave)).status).toBe(502);
      const segunda = await alta(tarjeta, clave);

      expect(segunda.status).toBe(409);
      expect((segunda.body as { message: string }).message).toMatch(
        /No se cobró/,
      );
      expect(autorizar).toHaveBeenCalledTimes(1);
      expect((await rastroDe(tarjeta)).ordenes.map((o) => o.estado)).toEqual([
        'fallida',
      ]);

      const tercera = await alta(tarjeta, clave);
      expect(tercera.status).toBe(201);
      expect(tercera.body).not.toHaveProperty('repetida');
      expect(autorizar).toHaveBeenCalledTimes(2);
      expect((await rastroDe(tarjeta)).suscripciones).toHaveLength(1);
    });

    // Owner, 2026-10-10: el cargo pudo aprobarse tarde y Transbank todavía no
    // lo registró. Un "no la conozco" vale como "no se cobró" recién pasados
    // `VENTANA_COBRO_SIN_CONFIRMAR_MS` desde el intento sin respuesta.
    it('si Transbank no conoce la orden, dentro de los 5 minutos no vale como "no se cobró"; pasados, sí', async () => {
      const tarjeta = randomUUID();
      const clave = randomUUID();
      autorizar.mockImplementationOnce(sinRespuesta);
      consultar.mockImplementation(noLaConoce);

      expect((await alta(tarjeta, clave)).status).toBe(502);
      const dentro = await alta(tarjeta, clave);

      expect(dentro.status).toBe(409);
      expect((dentro.body as { message: string }).message).toMatch(
        /Esperá unos minutos.*no se te va a cobrar dos veces/,
      );
      const enDuda = await rastroDe(tarjeta);
      expect(enDuda.ordenes.map((o) => o.estado)).toEqual(['en_proceso']);

      // La ventana se cuenta desde el intento sin respuesta, no desde la
      // orden: con la orden vieja y el intento reciente, sigue adentro.
      const ordenId = enDuda.ordenes[0].orden_id;
      const [, ordenes] = await ds.query<[unknown, number]>(
        `UPDATE pasarela_ordenes SET creado_el = now() - interval '30 minutes'
          WHERE orden_id = $1`,
        [ordenId],
      );
      expect(ordenes).toBe(1);
      const ordenVieja = await alta(tarjeta, clave);
      expect(ordenVieja.status).toBe(409);
      expect((ordenVieja.body as { message: string }).message).toMatch(
        /Esperá unos minutos/,
      );

      // Pasaron los 5 minutos desde el intento sin respuesta.
      const [, intentos] = await ds.query<[unknown, number]>(
        `UPDATE pasarela_transacciones
            SET fecha_transaccion = now() - interval '6 minutes'
          WHERE orden_id = $1 AND tipo = 'AUTHORIZATION' AND estado = 'error'`,
        [ordenId],
      );
      expect(intentos).toBe(1);
      const fuera = await alta(tarjeta, clave);

      expect(fuera.status).toBe(409);
      expect((fuera.body as { message: string }).message).toMatch(
        /No se cobró/,
      );
      expect(autorizar).toHaveBeenCalledTimes(1);
      expect((await rastroDe(tarjeta)).ordenes.map((o) => o.estado)).toEqual([
        'fallida',
      ]);
    });

    it('si no se puede aclarar, el reintento vuelve a consultar y nunca cobra', async () => {
      const tarjeta = randomUUID();
      const clave = randomUUID();
      autorizar.mockImplementationOnce(sinRespuesta);
      consultar
        .mockImplementationOnce(() => estado('desconocido'))
        .mockImplementationOnce(() =>
          Promise.reject(new ProviderComunicacionError('timeout', {}, {})),
        )
        .mockImplementationOnce(() => estado('pagada'));

      expect((await alta(tarjeta, clave)).status).toBe(502);
      const segunda = await alta(tarjeta, clave);
      const tercera = await alta(tarjeta, clave);

      for (const r of [segunda, tercera]) {
        expect(r.status).toBe(409);
        expect((r.body as { message: string }).message).toMatch(
          /no se te va a cobrar dos veces/,
        );
      }
      expect(autorizar).toHaveBeenCalledTimes(1);
      const enDuda = await rastroDe(tarjeta);
      expect(enDuda.ordenes.map((o) => o.estado)).toEqual(['en_proceso']);
      expect(enDuda.suscripciones).toHaveLength(0);

      // El texto del 409 es cierto: cuando Transbank contesta, se termina.
      const cuarta = await alta(tarjeta, clave);
      expect(cuarta.status).toBe(201);
      expect((cuarta.body as Alta).repetida).toBe(true);
      expect(autorizar).toHaveBeenCalledTimes(1);
      expect(consultar).toHaveBeenCalledTimes(3);
    });
  });

  // Lo que deja `fallida` un camino ajeno al alta (`/verificar` de la API, el
  // abort de un retorno) no mira la ventana de un "no la conozco": el aclarado
  // no le cree y vuelve a consultar.
  it('una orden que otro lector dejó fallida se vuelve a consultar: si el cobro salió, termina el alta', async () => {
    const tarjeta = randomUUID();
    const clave = randomUUID();
    autorizar.mockImplementationOnce(sinRespuesta);
    consultar.mockImplementation(() => estado('pagada'));

    expect((await alta(tarjeta, clave)).status).toBe(502);
    const [orden] = (await rastroDe(tarjeta)).ordenes;
    await ds.query(
      `UPDATE pasarela_ordenes SET estado = 'fallida' WHERE orden_id = $1`,
      [orden.orden_id],
    );

    const segunda = await alta(tarjeta, clave);

    expect(segunda.status).toBe(201);
    expect((segunda.body as Alta).repetida).toBe(true);
    expect(autorizar).toHaveBeenCalledTimes(1);
    expect(consultar).toHaveBeenCalledTimes(1);
    expect((await rastroDe(tarjeta)).ordenes.map((o) => o.estado)).toEqual([
      'conciliada',
    ]);
  });

  it('el proceso cae después de cobrar: la orden no expira por reloj y el reintento termina el alta', async () => {
    const tarjeta = randomUUID();
    const clave = randomUUID();
    // Transbank cobró y el request murió antes de registrar nada (un error que
    // no es de comunicación revierte la tx del cobro entera).
    autorizar.mockImplementationOnce(() =>
      Promise.reject(new Error('el proceso cayó con el cobro hecho')),
    );
    consultar.mockImplementation(() => estado('pagada'));

    // No se sabe si se cobró: 409 que no empuja a recargar, no un 500 crudo.
    const primera = await alta(tarjeta, clave);
    expect(primera.status).toBe(409);
    expect((primera.body as { message: string }).message).toMatch(
      /Esperá unos minutos.*no se te va a cobrar dos veces/,
    );
    const enDuda = await rastroDe(tarjeta);
    expect(enDuda.ordenes.map((o) => o.estado)).toEqual(['en_proceso']);
    // Sin AUTHORIZATION 'error': lo único que frena al cron es que la orden
    // se escribió antes de llamar.
    expect(await autorizacionesDe(enDuda.ordenes[0].orden_id)).toEqual([]);

    // Pasaron las 2 h de la orden: se adelanta el reloj de ESTA orden.
    await ds.query(
      `UPDATE pasarela_ordenes SET fecha_expiracion = now() - interval '1 hour'
        WHERE orden_id = $1`,
      [enDuda.ordenes[0].orden_id],
    );
    await app.get(ExpirarOrdenesJob).expirarOrdenesVencidas();
    expect((await rastroDe(tarjeta)).ordenes.map((o) => o.estado)).toEqual([
      'en_proceso',
    ]);

    const segunda = await alta(tarjeta, clave);
    expect(segunda.status).toBe(201);
    expect((segunda.body as Alta).repetida).toBe(true);
    expect(autorizar).toHaveBeenCalledTimes(1);
    const r = await rastroDe(tarjeta);
    expect(r.suscripciones).toHaveLength(1);
    expect(r.ordenes.map((o) => o.estado)).toEqual(['conciliada']);
  });
});
