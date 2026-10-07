import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { ProviderFactory } from '../src/modules/pasarela/providers/provider.factory';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris: Webpay Plus activo (seed)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };

/**
 * El cargo sin venta de la tienda, por los impuestos de una línea (owner,
 * 2026-10-06; fiscal, su propia sesión).
 *
 * `prepararLineasCheckout` esparce `...linea` en el cálculo cuyo total
 * `/online/pagar` autoriza contra la tarjeta, y el callback crea la venta desde
 * un snapshot que solo lleva `itemId` y `cantidad`, recalculando con los
 * impuestos del ítem. Mientras `impuestoIds` existía, `impuestoIds: []`
 * autorizaba de menos: Webpay cobraba y `ventas.service` rechazaba la venta
 * (*"Las ventas online requieren el pago completo"*). Con uno ajeno autorizaba
 * de más y `PagosService` la rechazaba por vuelto. En los dos casos, un cargo
 * sin venta.
 *
 * Esto recorre el camino entero con el proveedor falso —`pagar`, el retorno de
 * Webpay por HTTP y el callback en proceso— y fija las dos mitades del cierre:
 * con el campo el proveedor nunca se llama, y sin él lo autorizado es lo que la
 * venta cobra, con los dos impuestos del ítem.
 */
describe('Tienda: lo que se autoriza en Webpay es lo que cobra la venta (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let itemId: string;

  /** Lo que el proveedor falso recibió para autorizar, en orden. */
  const autorizados: string[] = [];
  const proveedor = {
    iniciarPago: (
      _cred: unknown,
      p: { codigoOrden: string; monto: string },
    ) => {
      autorizados.push(p.monto);
      return Promise.resolve({
        tokenExterno: `tok-${p.codigoOrden}`,
        urlRedireccion: 'https://webpay.falso/iniciar',
        aprobada: true,
        codigoRespuesta: null,
        request: {},
        response: {},
      });
    },
    confirmarPago: () =>
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
      }),
  };

  const pagar = (linea: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/online/pagar')
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId, cantidad: '1', ...linea }] });

  const contarOrdenes = async (): Promise<string> => {
    // Sin `eliminado_el IS NULL` a propósito: se cuenta si el pedido escribió.
    const filas: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM pasarela_ordenes WHERE tenant_id = $1`,
      [TENANT_ID],
    );
    return filas[0].n;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderFactory)
      .useValue({ getPagoRedirect: () => proveedor })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

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

    const resImp = await request(app.getHttpServer())
      .post('/api/impuestos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Adicional tienda E2E ${randomUUID()}`,
        porcentaje: '0.10',
      });
    expect(resImp.status).toBe(201);

    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Servicio tienda con adicional E2E ${randomUUID()}`,
        precioBase: '1000',
        monedaId: CLP,
        tipo: 'servicio',
        clasificacionTributaria: 'afecto',
        impuestosIds: [(resImp.body as { id: string }).id],
      });
    expect(resItem.status).toBe(201);
    itemId = (resItem.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('con impuestoIds en la línea: 400, sin orden y sin llamar al proveedor', async () => {
    const ordenesAntes = await contarOrdenes();
    const autorizadosAntes = autorizados.length;

    const res = await pagar({ impuestoIds: [] });

    expect(res.status).toBe(400);
    expect(
      [(res.body as { message?: string | string[] }).message ?? []].flat(),
    ).toContain('lineas.0.property impuestoIds should not exist');
    expect(autorizados).toHaveLength(autorizadosAntes);
    expect(await contarOrdenes()).toBe(ordenesAntes);
  });

  it('sin el campo: se autoriza el total con los dos impuestos, y la venta del callback cobra eso mismo', async () => {
    const res = await pagar({});
    expect(res.status).toBe(201);
    const { modo, ordenId } = res.body as { modo: string; ordenId: string };
    expect(modo).toBe('webpay');
    // $1.000 neto: $190 de IVA más $100 del adicional.
    expect(Number(autorizados.at(-1))).toBe(1290);

    const [orden]: { token_proveedor: string }[] = await ds.query(
      `SELECT token_proveedor FROM pasarela_ordenes WHERE orden_id = $1`,
      [ordenId],
    );
    const retorno = await request(app.getHttpServer()).get(
      `/api/pasarela/retorno/pago?token_ws=${orden.token_proveedor}`,
    );
    expect(retorno.status).toBe(302);

    // El callback no rompe el redirect si la venta falla: el 302 solo no
    // prueba nada. Lo que prueba el cierre es que la orden tenga venta.
    const [conVenta]: { venta_id: string | null; estado: string }[] =
      await ds.query(
        `SELECT venta_id, estado FROM pasarela_ordenes WHERE orden_id = $1`,
        [ordenId],
      );
    expect(conVenta.estado).toBe('conciliada');
    expect(conVenta.venta_id).not.toBeNull();

    const [venta]: { total_final: string; pagado: string }[] = await ds.query(
      `SELECT v.total_final,
              (SELECT sum(p.monto) FROM pagos p
                WHERE p.venta_id = v.venta_id AND p.eliminado_el IS NULL) AS pagado
         FROM ventas v
        WHERE v.venta_id = $1 AND v.eliminado_el IS NULL`,
      [conVenta.venta_id],
    );
    expect(Number(venta.total_final)).toBe(1290);
    expect(Number(venta.pagado)).toBe(1290);

    const impuestos: { porcentaje_aplicado: string }[] = await ds.query(
      `SELECT porcentaje_aplicado FROM ventas_impuestos
        WHERE venta_id = $1 AND eliminado_el IS NULL
        ORDER BY porcentaje_aplicado`,
      [conVenta.venta_id],
    );
    expect(impuestos.map((i) => Number(i.porcentaje_aplicado))).toEqual([
      0.1, 0.19,
    ]);
  });
});
