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

const MOTIVO =
  'El pago se confirmó por verificación, no en el retorno de la compra';

interface OrdenAdmin {
  ordenId: string;
  estado: string;
  motivoSinVenta: string | null;
}

/**
 * `POST /pasarela/api/ordenes/:id/verificar` sobre una orden de la tienda
 * (`docs/agent/pendientes.md` § 3, decidido por el owner el 2026-10-10).
 *
 * `verificar` resuelve la orden con lo que dice el proveedor y no pasa por
 * `CallbackDispatcherService`, así que la venta no se crea. Una orden de la
 * tienda llega ahí cuando el comprador pagó y el retorno no volvió, o volvió
 * con un error de comunicación que la dejó `en_proceso`. Sin marca quedaba
 * `pagada` sin venta y sin aviso: el admin no la veía en "Pagada sin venta" y
 * el comprador leía "registrada".
 *
 * Lo decidido: queda `pagada` con un motivo, como las de D
 * (`tienda-dos-ahoras.e2e-spec.ts`), y **no** crea la venta. Las órdenes que
 * no son de la tienda —una app por llave de API— no cambian.
 */
describe('Tienda: verificar una orden pagada la deja pagada sin venta, con aviso (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let apiKey: string;
  const itemsCreados: string[] = [];

  const confirmarPago = jest.fn();
  const consultarEstado = jest.fn();
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

  const crearItem = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Servicio verificar E2E ${randomUUID()}`,
        precioBase: '10000',
        monedaId: CLP,
        tipo: 'servicio',
      });
    expect(res.status).toBe(201);
    const id = (res.body as { id: string }).id;
    itemsCreados.push(id);
    return id;
  };

  const pagarEnLaTienda = async (): Promise<string> => {
    const itemId = await crearItem();
    const res = await request(app.getHttpServer())
      .post('/api/online/pagar')
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId, cantidad: '1' }] });
    expect(res.status).toBe(201);
    expect((res.body as { modo: string }).modo).toBe('webpay');
    return (res.body as { ordenId: string }).ordenId;
  };

  const ordenDe = async (ordenId: string) => {
    const [fila]: {
      estado: string;
      venta_id: string | null;
      codigo_orden: string;
      token_proveedor: string;
    }[] = await ds.query(
      `SELECT estado, venta_id, codigo_orden, token_proveedor
         FROM pasarela_ordenes
        WHERE orden_id = $1 AND eliminado_el IS NULL`,
      [ordenId],
    );
    return fila;
  };

  /** El retorno de Webpay; da la ubicación del redirect, o el status si no es 302. */
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
   * Lo que D fija para la orden pagada sin venta, ahora llegando por
   * `verificar`: sin venta, con el motivo para el admin y el estado propio
   * para el comprador, en la página de retorno y en un retorno tardío.
   */
  const afirmarSinVentaConAviso = async (
    ordenId: string,
    ventasAntes: number,
  ): Promise<void> => {
    const orden = await ordenDe(ordenId);
    expect(orden.estado).toBe('pagada');
    expect(orden.venta_id).toBeNull();
    // No crea la venta: sería otro "ahora".
    expect(await ventasOnline()).toBe(ventasAntes);

    expect((await ordenAdmin(ordenId)).motivoSinVenta).toBe(MOTIVO);
    expect(await sinVentaEnElListado(ordenId)).toEqual([
      expect.objectContaining({
        ordenId,
        estado: 'pagada',
        motivoSinVenta: MOTIVO,
      }),
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

    // Webpay reintenta el retorno: la orden ya no está `en_proceso`, así que
    // redirige con el estado actual, que es el propio.
    const tardio = await volver(ordenId);
    expect(tardio.status).toBe(302);
    expect(tardio.headers.location).toContain(
      `ordenId=${ordenId}&estado=pagada_sin_venta`,
    );
    expect(await ventasOnline()).toBe(ventasAntes);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderFactory)
      .useValue({
        getPagoRedirect: () => proveedor,
        getReembolsable: () => ({ consultarEstado }),
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
      .send({ nombre: `verificar sin venta e2e ${Date.now()}` });
    expect(resKey.status).toBe(201);
    apiKey = (resKey.body as { apiKey: string }).apiKey;
  });

  beforeEach(() => {
    confirmarPago.mockReset().mockResolvedValue(aprobado);
    consultarEstado
      .mockReset()
      .mockResolvedValue({ estado: 'pagada', response: {} });
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

  it('el retorno volvió con un error de comunicación: verificar la deja pagada sin venta, con aviso', async () => {
    const ventasAntes = await ventasOnline();
    const ordenId = await pagarEnLaTienda();
    confirmarPago.mockRejectedValueOnce(
      new ProviderComunicacionError('timeout', {}),
    );
    expect((await volver(ordenId)).status).toBe(502);
    expect((await ordenDe(ordenId)).estado).toBe('en_proceso');

    // La API por llave es un contrato: dice `pagada`, sin el estado propio.
    expect((await verificar(ordenId)).estado).toBe('pagada');
    expect(consultarEstado).toHaveBeenCalledTimes(1);

    await afirmarSinVentaConAviso(ordenId, ventasAntes);
  });

  it('el comprador pagó y el retorno nunca volvió: verificar la deja pagada sin venta, con aviso', async () => {
    const ventasAntes = await ventasOnline();
    const ordenId = await pagarEnLaTienda();

    expect((await verificar(ordenId)).estado).toBe('pagada');
    expect(confirmarPago).not.toHaveBeenCalled();

    await afirmarSinVentaConAviso(ordenId, ventasAntes);
  });

  it('control: si el proveedor dice que no se pagó, queda fallida y sin aviso', async () => {
    const ordenId = await pagarEnLaTienda();
    consultarEstado.mockResolvedValueOnce({ estado: 'fallida', response: {} });

    expect((await verificar(ordenId)).estado).toBe('fallida');
    expect((await ordenAdmin(ordenId)).motivoSinVenta).toBeNull();
    expect(await sinVentaEnElListado(ordenId)).toEqual([]);
  });

  it('control: una orden de una app por llave de API queda pagada, sin la marca de la tienda', async () => {
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
  });
});
