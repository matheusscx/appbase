import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { ProviderFactory } from '../src/modules/pasarela/providers/provider.factory';
import { ProviderComunicacionError } from '../src/modules/pasarela/providers/payment-provider.interface';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris: Webpay Plus activo (seed)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };

const SIN_CONGELADO =
  'El pago se inició antes de una actualización del sistema y la orden no guarda lo que se cobró: devolvé el cargo o registrá la venta a mano';

interface OrdenAdmin {
  ordenId: string;
  estado: string;
  ventaId: string | null;
  motivoSinVenta: string | null;
}

/**
 * `POST /pasarela/api/ordenes/:id/verificar` sobre una orden de la tienda
 * (`docs/agent/pendientes.md` § 3, decidido por el owner el 2026-10-11).
 *
 * Una orden de la tienda llega a `verificar` cuando el comprador pagó y el
 * retorno no volvió, o volvió con un error de comunicación que la dejó
 * `en_proceso`. `verificar` crea la venta con lo que la orden congeló al
 * pagar, por el mismo callback que el retorno, y la deja `conciliada`. Si la
 * venta no se puede crear (falta stock, el ítem ya no existe, la orden no
 * guarda lo cobrado) queda `pagada` sin venta, con el motivo, como en el
 * retorno (`tienda-dos-ahoras.e2e-spec.ts`).
 *
 * Y la carrera de § 5: `verificar` y el retorno a la vez dan una sola venta.
 */
describe('Tienda: verificar una orden pagada crea la venta por lo cobrado (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let apiKey: string;
  const itemsCreados: string[] = [];

  const confirmarPago = jest.fn();
  const consultarEstado = jest.fn();
  const reembolsar = jest.fn(() =>
    Promise.resolve({
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: 'AUT-E2E',
      tipoPago: 'NULLIFIED',
      request: {},
      response: {},
    }),
  );
  const proveedor = {
    iniciarPago: (_cred: unknown, p: { codigoOrden: string }) =>
      Promise.resolve({
        tokenExterno: `tok-verificar-${p.codigoOrden}`,
        urlRedireccion: 'https://webpay.falso/iniciar',
        aprobada: true,
        codigoRespuesta: null,
        request: {},
        response: {},
      }),
    confirmarPago,
  };
  const aprobado = {
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
  };
  /** Lo que Transbank informa de una transacción pagada con débito. */
  const pagadaConDebito = {
    estado: 'pagada',
    estadoProveedor: 'AUTHORIZED',
    saldo: null,
    detallePago: {
      tipoPago: 'VD',
      numeroCuotas: 0,
      tarjetaUltimos4: '4321',
      codigoRespuesta: '0',
      codigoAutorizacion: '7788',
    },
    response: {},
  };

  const login = async (): Promise<string> => {
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
    return (resTenant.body as { access_token: string }).access_token;
  };

  const crearItem = async (extra: Record<string, unknown> = {}) => {
    const nombre = `Servicio verificar E2E ${randomUUID()}`;
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre,
        precioBase: '10000',
        monedaId: CLP,
        tipo: 'servicio',
        ...extra,
      });
    expect(res.status).toBe(201);
    const id = (res.body as { id: string }).id;
    itemsCreados.push(id);
    return { itemId: id, nombre: (extra.nombre as string) ?? nombre };
  };

  const pagar = async (itemId: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/online/pagar')
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId, cantidad: '1' }] });
    expect(res.status).toBe(201);
    expect((res.body as { modo: string }).modo).toBe('webpay');
    return (res.body as { ordenId: string }).ordenId;
  };

  const pagarEnLaTienda = async (): Promise<string> =>
    pagar((await crearItem()).itemId);

  const ordenDe = async (ordenId: string) => {
    const [fila]: {
      estado: string;
      venta_id: string | null;
      codigo_orden: string;
      token_proveedor: string;
      metadata: Record<string, unknown>;
    }[] = await ds.query(
      `SELECT estado, venta_id, codigo_orden, token_proveedor, metadata
         FROM pasarela_ordenes
        WHERE orden_id = $1 AND eliminado_el IS NULL`,
      [ordenId],
    );
    return fila;
  };

  /** El retorno de Webpay. */
  const volver = async (ordenId: string) => {
    const { token_proveedor } = await ordenDe(ordenId);
    return request(app.getHttpServer()).get(
      `/api/pasarela/retorno/pago?token_ws=${token_proveedor}`,
    );
  };

  const verificar = async (ordenId: string) => {
    const res = await request(app.getHttpServer())
      .post(`/api/pasarela/api/ordenes/${ordenId}/verificar`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(201);
    return res.body as { estado: string };
  };

  const ventasOnline = async (): Promise<number> => {
    const [fila]: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM ventas
        WHERE tenant_id = $1 AND canal = 'online' AND eliminado_el IS NULL`,
      [TENANT_ID],
    );
    return Number(fila.n);
  };

  const ordenAdmin = async (ordenId: string): Promise<OrdenAdmin> => {
    const res = await request(app.getHttpServer())
      .get(`/api/pasarela/admin/ordenes/${ordenId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as OrdenAdmin;
  };

  const sinVentaEnElListado = async (
    ordenId: string,
  ): Promise<OrdenAdmin[]> => {
    const { codigo_orden } = await ordenDe(ordenId);
    const res = await request(app.getHttpServer())
      .get(`/api/pasarela/admin/ordenes?sinVenta=true&search=${codigo_orden}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { data: OrdenAdmin[] }).data;
  };

  /**
   * La orden quedó conciliada con una venta nueva, la única para el cobro, y
   * por lo que se cobró: el total de la orden, con el detalle del pago que
   * informó Transbank. Devuelve la venta.
   */
  const afirmarConciliadaConSuVenta = async (
    ordenId: string,
    ventasAntes: number,
  ) => {
    const orden = await ordenDe(ordenId);
    expect(orden.estado).toBe('conciliada');
    expect(orden.venta_id).not.toBeNull();
    expect(await ventasOnline()).toBe(ventasAntes + 1);
    expect((await ordenAdmin(ordenId)).motivoSinVenta).toBeNull();
    expect(await sinVentaEnElListado(ordenId)).toEqual([]);

    const venta = await request(app.getHttpServer())
      .get(`/api/ventas/${orden.venta_id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(venta.status).toBe(200);
    return { orden, venta: venta.body as Record<string, unknown> };
  };

  /** Lo que el retorno ya fija para la venta que no se puede crear. */
  const afirmarPagadaSinVenta = async (
    ordenId: string,
    ventasAntes: number,
    motivo: string,
  ): Promise<void> => {
    const orden = await ordenDe(ordenId);
    expect(orden.estado).toBe('pagada');
    expect(orden.venta_id).toBeNull();
    expect(await ventasOnline()).toBe(ventasAntes);

    expect((await ordenAdmin(ordenId)).motivoSinVenta).toBe(motivo);
    expect(await sinVentaEnElListado(ordenId)).toEqual([
      expect.objectContaining({ ordenId, estado: 'pagada' }),
    ]);

    const resultado = await request(app.getHttpServer())
      .get(`/api/online/orden/${ordenId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resultado.status).toBe(200);
    expect(resultado.body).toMatchObject({
      estado: 'pagada_sin_venta',
      ventaId: null,
    });
    expect(resultado.body).not.toHaveProperty('motivoSinVenta');
  };

  /** Las AUTHORIZATION de la orden, en orden: el historial es solo-INSERT. */
  const autorizacionesDe = async (ordenId: string): Promise<string[]> => {
    const filas: { estado: string }[] = await ds.query(
      `SELECT estado FROM pasarela_transacciones
        WHERE orden_id = $1 AND tipo = 'AUTHORIZATION' AND eliminado_el IS NULL
        ORDER BY fecha_transaccion`,
      [ordenId],
    );
    return filas.map((f) => f.estado);
  };

  const localDelTenant = async (): Promise<string> => {
    const [fila]: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [TENANT_ID],
    );
    return fila.ubicacion_id;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderFactory)
      .useValue({
        getPagoRedirect: () => proveedor,
        getReembolsable: () => ({ consultarEstado, reembolsar }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    token = await login();
    const resKey = await request(app.getHttpServer())
      .post('/api/pasarela/admin/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `verificar tienda e2e ${Date.now()}` });
    expect(resKey.status).toBe(201);
    apiKey = (resKey.body as { apiKey: string }).apiKey;
  });

  beforeEach(() => {
    reembolsar.mockClear();
    confirmarPago.mockReset().mockResolvedValue(aprobado);
    consultarEstado.mockReset().mockResolvedValue(pagadaConDebito);
  });

  afterAll(async () => {
    const fallas: string[] = [];
    for (const id of itemsCreados) {
      const res = await request(app.getHttpServer())
        .delete(`/api/items/${id}`)
        .set('Authorization', `Bearer ${token}`);
      if (res.status >= 300) fallas.push(`items/${id}: ${res.status}`);
    }
    await app.close();
    expect(fallas).toEqual([]);
  });

  describe('crea la venta con lo congelado y concilia la orden', () => {
    it('el retorno volvió con un error de comunicación: verificar crea la venta', async () => {
      const ventasAntes = await ventasOnline();
      const ordenId = await pagarEnLaTienda();
      confirmarPago.mockRejectedValueOnce(
        new ProviderComunicacionError('timeout', {}),
      );
      expect((await volver(ordenId)).status).toBe(502);
      expect((await ordenDe(ordenId)).estado).toBe('en_proceso');

      expect((await verificar(ordenId)).estado).toBe('conciliada');
      expect(consultarEstado).toHaveBeenCalledTimes(1);

      const { orden, venta } = await afirmarConciliadaConSuVenta(
        ordenId,
        ventasAntes,
      );
      // Por lo cobrado: el total de la orden, pagado entero.
      const [{ monto }]: { monto: string }[] = await ds.query(
        `SELECT monto FROM pasarela_ordenes
          WHERE orden_id = $1 AND eliminado_el IS NULL`,
        [ordenId],
      );
      expect(venta).toMatchObject({ canal: 'online', estado: 'pagada' });
      // El `error` del retorno queda como rastro; `verificar` agrega la
      // aprobada, sin tocarlo.
      expect(await autorizacionesDe(ordenId)).toEqual(['error', 'aprobada']);
      expect(Number(venta.totalFinal)).toBe(Number(monto));
      // El detalle del pago sale de lo que informó Transbank, como en el
      // retorno: débito, sus últimos 4 y el código de autorización.
      expect(orden.metadata.resultadoPago).toMatchObject({
        tipoPago: 'VD',
        tarjetaUltimos4: '4321',
        codigoAutorizacion: '7788',
      });
      const [pago]: {
        referencia: string | null;
        tarjeta_ultimos4: string | null;
        metodo: string;
      }[] = await ds.query(
        `SELECT p.referencia, p.tarjeta_ultimos4, mp.nombre AS metodo
           FROM pagos p
           JOIN metodos_pago mp
             ON mp.metodo_pago_id = p.metodo_pago_id
            AND mp.eliminado_el IS NULL
          WHERE p.venta_id = $1 AND p.eliminado_el IS NULL`,
        [orden.venta_id],
      );
      expect(pago).toMatchObject({
        referencia: '7788',
        tarjeta_ultimos4: '4321',
      });
      expect(pago.metodo.toLowerCase()).toContain('débito');

      // Webpay reintenta el retorno: la orden ya no está `en_proceso`, así
      // que redirige al éxito sin crear otra venta.
      const tardio = await volver(ordenId);
      expect(tardio.status).toBe(302);
      expect(tardio.headers.location).toContain(
        `ordenId=${ordenId}&estado=pagada`,
      );
      expect(await ventasOnline()).toBe(ventasAntes + 1);
    });

    it('el comprador pagó y el retorno nunca volvió: verificar crea la venta', async () => {
      const ventasAntes = await ventasOnline();
      const ordenId = await pagarEnLaTienda();

      expect((await verificar(ordenId)).estado).toBe('conciliada');
      expect(confirmarPago).not.toHaveBeenCalled();

      await afirmarConciliadaConSuVenta(ordenId, ventasAntes);
      const resultado = await request(app.getHttpServer())
        .get(`/api/online/orden/${ordenId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(resultado.status).toBe(200);
      expect(resultado.body).toMatchObject({ estado: 'conciliada' });
    });

    it('la orden que cerró verificar se puede reembolsar desde la app', async () => {
      const ordenId = await pagarEnLaTienda();
      expect((await verificar(ordenId)).estado).toBe('conciliada');
      expect(await autorizacionesDe(ordenId)).toEqual(['aprobada']);

      const [{ monto }]: { monto: string }[] = await ds.query(
        `SELECT monto FROM pasarela_ordenes
          WHERE orden_id = $1 AND eliminado_el IS NULL`,
        [ordenId],
      );
      const reembolso = await request(app.getHttpServer())
        .post(`/api/pasarela/admin/ordenes/${ordenId}/reembolsos`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ monto });
      expect(reembolso.status).toBe(201);
      expect(reembolso.body).toMatchObject({ reembolsoAprobado: true });
      expect(reembolsar).toHaveBeenCalledTimes(1);
      expect((await ordenDe(ordenId)).estado).toBe('reembolsada');
    });

    it('verificar dos veces: la segunda es 400 y no agrega otra autorización', async () => {
      const ordenId = await pagarEnLaTienda();
      await verificar(ordenId);
      const segunda = await request(app.getHttpServer())
        .post(`/api/pasarela/api/ordenes/${ordenId}/verificar`)
        .set('Authorization', `Bearer ${apiKey}`);
      expect(segunda.status).toBe(400);
      expect(await autorizacionesDe(ordenId)).toEqual(['aprobada']);
    });

    it('una orden ya expirada por reloj también: verificar crea la venta', async () => {
      const ventasAntes = await ventasOnline();
      const ordenId = await pagarEnLaTienda();
      // La expiración perezosa la marca por reloj; el pago pudo haber salido.
      await ds.query(
        `UPDATE pasarela_ordenes SET estado = 'expirada' WHERE orden_id = $1`,
        [ordenId],
      );

      expect((await verificar(ordenId)).estado).toBe('conciliada');
      await afirmarConciliadaConSuVenta(ordenId, ventasAntes);
    });
  });

  describe('la venta no se puede crear: queda pagada sin venta, con su motivo', () => {
    it('falta stock: el local vendió lo último mientras el retorno no volvía', async () => {
      const { itemId, nombre } = await crearItem({
        nombre: `Producto verificar E2E ${randomUUID()}`,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '1',
        costo: '500',
      });
      const ventasAntes = await ventasOnline();
      const ordenId = await pagar(itemId);
      const salida = await request(app.getHttpServer())
        .patch(`/api/items/${itemId}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipo: 'salida',
          motivo: 'ajuste_manual',
          ubicacionId: await localDelTenant(),
          cantidad: '1',
        });
      expect(salida.status).toBe(200);

      expect((await verificar(ordenId)).estado).toBe('pagada');
      await afirmarPagadaSinVenta(
        ordenId,
        ventasAntes,
        `Stock insuficiente de "${nombre}" en el local: quedan 0 unidad y lo que se está agregando necesita 1 unidad`,
      );
    });

    it('el ítem ya no existe', async () => {
      const { itemId } = await crearItem();
      const ventasAntes = await ventasOnline();
      const ordenId = await pagar(itemId);
      const borrado = await request(app.getHttpServer())
        .delete(`/api/items/${itemId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(borrado.status).toBeLessThan(300);
      itemsCreados.splice(itemsCreados.indexOf(itemId), 1);

      expect((await verificar(ordenId)).estado).toBe('pagada');
      await afirmarPagadaSinVenta(ordenId, ventasAntes, 'Item no encontrado');
    });

    it('la orden no guarda lo que se cobró', async () => {
      const ventasAntes = await ventasOnline();
      const ordenId = await pagarEnLaTienda();
      // Una orden de antes de "vale lo que pagó" (`fb779b2b`): hoy `pagar`
      // siempre congela, así que la única forma de armarla es sacárselo.
      await ds.query(
        `UPDATE pasarela_ordenes
            SET metadata = metadata #- '{checkout,congelado}'
          WHERE orden_id = $1`,
        [ordenId],
      );

      expect((await verificar(ordenId)).estado).toBe('pagada');
      await afirmarPagadaSinVenta(ordenId, ventasAntes, SIN_CONGELADO);
    });
  });

  describe('verificar y el retorno a la vez (pendientes.md § 5)', () => {
    /**
     * ¿El retorno está esperando un lock de fila? Lo que distingue "lo
     * frenó la orden bloqueada" de "corrió entero en el medio".
     */
    const hayUnRetornoEsperando = async (): Promise<boolean> => {
      const filas: unknown[] = await ds.query(
        `SELECT 1 FROM pg_stat_activity
          WHERE wait_event_type = 'Lock'
            AND query ILIKE '%pasarela_ordenes%'`,
      );
      return filas.length > 0;
    };

    it('el comprador vuelve mientras verificar consulta a Transbank: una sola venta, la orden conciliada con ella', async () => {
      const ventasAntes = await ventasOnline();
      const ordenId = await pagarEnLaTienda();

      let retorno: Promise<request.Response> | undefined;
      let retornoTermino = false;
      consultarEstado.mockImplementationOnce(async () => {
        // El retorno arranca con `verificar` ya adentro, esperando a
        // Transbank. Sin lock corre entero en el medio; con lock queda
        // esperando la fila. Se suelta la consulta en cuanto pasa una de las
        // dos cosas.
        retorno = volver(ordenId).then((r) => {
          retornoTermino = true;
          return r;
        });
        const limite = Date.now() + 10_000;
        while (
          !retornoTermino &&
          !(await hayUnRetornoEsperando()) &&
          Date.now() < limite
        )
          await new Promise((r) => setTimeout(r, 50));
        return pagadaConDebito;
      });

      await verificar(ordenId);
      expect(retorno).toBeDefined();
      expect((await retorno!).status).toBe(302);

      // Una sola venta para el cobro, y es la que tiene la orden.
      const { orden } = await afirmarConciliadaConSuVenta(ordenId, ventasAntes);
      expect(orden.metadata.resultadoPago).toBeDefined();
    });

    it('control: verificar llega con el retorno ya adentro: 400 y la venta es la del retorno', async () => {
      const ventasAntes = await ventasOnline();
      const ordenId = await pagarEnLaTienda();

      let verificacion: request.Response | undefined;
      confirmarPago.mockImplementationOnce(async () => {
        verificacion = await request(app.getHttpServer())
          .post(`/api/pasarela/api/ordenes/${ordenId}/verificar`)
          .set('Authorization', `Bearer ${apiKey}`);
        return aprobado;
      });

      expect((await volver(ordenId)).status).toBe(302);
      expect(verificacion?.status).toBe(400);
      expect(consultarEstado).not.toHaveBeenCalled();
      await afirmarConciliadaConSuVenta(ordenId, ventasAntes);
    });
  });

  it('control: si el proveedor dice que no se pagó, queda fallida, sin venta ni aviso', async () => {
    const ventasAntes = await ventasOnline();
    const ordenId = await pagarEnLaTienda();
    consultarEstado.mockResolvedValueOnce({ estado: 'fallida', response: {} });

    expect((await verificar(ordenId)).estado).toBe('fallida');
    expect((await ordenAdmin(ordenId)).motivoSinVenta).toBeNull();
    expect(await sinVentaEnElListado(ordenId)).toEqual([]);
    expect(await ventasOnline()).toBe(ventasAntes);
  });

  it('control: una orden de una app por llave de API queda pagada, sin venta ni marca', async () => {
    const ventasAntes = await ventasOnline();
    const res = await request(app.getHttpServer())
      .post('/api/pasarela/api/pagos')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        monto: '5000',
        descripcion: 'Pago de una app externa E2E',
        urlExito: 'http://localhost/exito',
        urlFracaso: 'http://localhost/fracaso',
      });
    expect(res.status).toBe(201);
    const { ordenId } = res.body as { ordenId: string };

    expect((await verificar(ordenId)).estado).toBe('pagada');
    expect((await ordenDe(ordenId)).estado).toBe('pagada');
    expect((await ordenAdmin(ordenId)).motivoSinVenta).toBeNull();
    expect(await sinVentaEnElListado(ordenId)).toEqual([]);
    expect(await ventasOnline()).toBe(ventasAntes);
  });
});
