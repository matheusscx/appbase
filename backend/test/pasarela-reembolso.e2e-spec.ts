import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { ProviderFactory } from '../src/modules/pasarela/providers/provider.factory';
import { VentasReembolsoHandler } from '../src/modules/ventas/reembolso-callback.handler';
import { PasarelaOrden } from '../src/modules/pasarela/entities/pasarela-orden.entity';
import { PasarelaTransaccion } from '../src/modules/pasarela/entities/pasarela-transaccion.entity';
import { TransaccionesService } from '../src/modules/pasarela/services/transacciones.service';
import { ProviderComunicacionError } from '../src/modules/pasarela/providers/payment-provider.interface';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
const CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
// Paris → Webpay Plus modo MALL (seed): las credenciales salen de la plataforma.
const TP_PARIS_WEBPAY_ID = '550e8400-e29b-41d4-a716-446655440217';
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };

interface Venta {
  id: string;
}
interface RespuestaReembolso {
  estado: string;
  reembolsoAprobado: boolean;
  notaCreditoId?: string;
  warning?: string;
  reembolso: { transaccionId: string };
}

/**
 * Todo reembolso aprobado de una orden con venta deja su corrección y el REFUND
 * queda ligado a ella (`pasarela_transacciones.correccion_venta_id`). Ya no hay
 * casilla ni campo `generarNotaCredito` (spec `2026-10-01-emision-por-venta`,
 * § 3.6; ADR-028).
 *
 * El proveedor es un doble: Transbank necesita red y el reembolso real no se
 * puede ejercer en el e2e. Lo demás (la orden, la autorización, la venta, la
 * corrección y su documento) corre contra la base real.
 *
 * ⚠️ Los ítems son propios (servicios): el stock sembrado lo comparten todas las
 * suites. La venta de $100.000 es un servicio afecto de 60.000 neto (71.400 con
 * IVA) más uno exento de 28.600; los reembolsos (23.800 y 17.000) no son ni 1
 * ni factores iguales.
 */
describe('Reembolso por pasarela: toda corrección queda ligada al REFUND (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let itemAfecto60: string;
  let itemExento: string;
  let itemProducto: string; // producto de modo `cantidad`, con stock propio
  const reembolsarEnElProveedor = jest.fn();
  const consultarEnElProveedor = jest.fn();

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const crearItem = async (
    nombre: string,
    precioBase: string,
    clasificacionTributaria: 'afecto' | 'exento',
  ): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set(auth())
      .send({
        nombre: `${nombre} ${Date.now()}`,
        precioBase,
        monedaId: CLP,
        tipo: 'servicio',
        clasificacionTributaria,
      });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  };
  /** 2 unidades de un producto propio ($5.000 c/u, IVA incluido) pagadas con débito. */
  const ventaOnlineConProducto = async (): Promise<Venta> => {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set(auth())
      .send({
        canal: 'online',
        lineas: [{ itemId: itemProducto, cantidad: '2' }],
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '10000' }],
      });
    expect(res.status).toBe(201);
    return res.body as Venta;
  };
  const movimientosDeDevolucion = (
    correccionId: string,
  ): Promise<{ cantidad: string; usuario_id: string | null }[]> =>
    ds.query(
      `SELECT cantidad::text AS cantidad, usuario_id
         FROM movimientos_inventario
        WHERE venta_id = $1 AND motivo = 'devolucion' AND tipo = 'entrada'
          AND eliminado_el IS NULL`,
      [correccionId],
    );
  const ventaOnline = async (): Promise<Venta> => {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set(auth())
      .send({
        canal: 'online',
        lineas: [
          { itemId: itemAfecto60, cantidad: '1' },
          { itemId: itemExento, cantidad: '1' },
        ],
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
      });
    expect(res.status).toBe(201);
    return res.body as Venta;
  };
  /** Una orden de $100.000 ya cobrada (AUTHORIZATION aprobada), ligada o no a una venta. */
  const ordenCobrada = async (ventaId: string | null): Promise<string> => {
    const codigoOrden = `E2E-RMB-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const orden = await ds.getRepository(PasarelaOrden).save({
      tenantId: TENANT_ID,
      codigoOrden,
      descripcion: 'Orden de reembolso e2e',
      monto: '100000',
      moneda: 'CLP',
      estado: 'conciliada',
      origen: 'interno',
      ventaId,
    });
    await ds.getRepository(PasarelaTransaccion).save({
      tenantId: TENANT_ID,
      ordenId: orden.ordenId,
      tenantPasarelaId: TP_PARIS_WEBPAY_ID,
      tipo: 'AUTHORIZATION',
      estado: 'aprobada',
      monto: '100000',
      moneda: 'CLP',
      codigoOrden,
      fechaTransaccion: new Date(),
    });
    return orden.ordenId;
  };
  // Una clave nueva por llamada salvo que el test pase la suya (ADR-029).
  const reembolsarAdmin = (
    ordenId: string,
    body: Record<string, unknown>,
    clave: string = randomUUID(),
  ) =>
    request(app.getHttpServer())
      .post(`/api/pasarela/admin/ordenes/${ordenId}/reembolsos`)
      .set(auth())
      .set('Idempotency-Key', clave)
      .send(body);
  let apiKey: string;
  const reembolsarApi = (
    ordenId: string,
    body: Record<string, unknown>,
    clave: string = randomUUID(),
  ) =>
    request(app.getHttpServer())
      .post(`/api/pasarela/api/cobros/${ordenId}/reembolsos`)
      .set('Authorization', `Bearer ${apiKey}`)
      .set('Idempotency-Key', clave)
      .send(body);
  const refundsDe = (
    ordenId: string,
  ): Promise<{ correccion_venta_id: string | null; estado: string }[]> =>
    ds.query(
      `SELECT correccion_venta_id, estado FROM pasarela_transacciones
        WHERE orden_id = $1 AND tipo = 'REFUND' AND eliminado_el IS NULL
        ORDER BY fecha_transaccion`,
      [ordenId],
    );
  const correccionesDe = (
    ventaId: string,
  ): Promise<{ venta_id: string; total_final: string; via: string | null }[]> =>
    ds.query(
      `SELECT venta_id, total_final::text AS total_final, devolucion_via AS via
         FROM ventas
        WHERE venta_referencia_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
  const documentosDe = (
    ventaId: string,
  ): Promise<
    {
      documento_id: string;
      emisor: string;
      documento_corregido_id: string | null;
      monto: string;
    }[]
  > =>
    ds.query(
      `SELECT documento_id, emisor, documento_corregido_id, monto::text AS monto
         FROM venta_documentos
        WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderFactory)
      .useValue({
        getReembolsable: () => ({
          reembolsar: reembolsarEnElProveedor,
          consultarEstado: consultarEnElProveedor,
        }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
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

    itemAfecto60 = await crearItem('Rmb afecto 60k E2E', '60000', 'afecto');
    const resKey = await request(app.getHttpServer())
      .post('/api/pasarela/admin/api-keys')
      .set(auth())
      .send({ nombre: `rmb e2e ${Date.now()}` });
    expect(resKey.status).toBe(201);
    apiKey = (resKey.body as { apiKey: string }).apiKey;
    itemExento = await crearItem('Rmb exento E2E', '28600', 'exento');
    const resProducto = await request(app.getHttpServer())
      .post('/api/items')
      .set(auth())
      .send({
        nombre: `Rmb producto E2E ${Date.now()}`,
        tipo: 'producto',
        precioBase: '5000',
        precioIncluyeImpuesto: true,
        monedaId: CLP,
        unidadMedida: 'unidad',
        stock: '100',
        costo: '1000',
      });
    expect(resProducto.status).toBe(201);
    itemProducto = (resProducto.body as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    consultarEnElProveedor.mockReset();
    reembolsarEnElProveedor.mockReset();
    reembolsarEnElProveedor.mockResolvedValue({
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: 'AUT-E2E',
      tipoPago: 'VD',
      request: {},
      response: {},
    });
  });

  it('un reembolso aprobado SIN devoluciones deja la corrección sobre la boleta de la venta y el REFUND queda ligado a ella', async () => {
    const venta = await ventaOnline();
    const boleta = (await documentosDe(venta.id)).filter(
      (d) => d.emisor === 'sistema',
    );
    expect(boleta).toHaveLength(1);
    const ordenId = await ordenCobrada(venta.id);

    const res = await reembolsarAdmin(ordenId, { monto: '23800' });

    expect(res.status).toBe(201);
    const cuerpo = res.body as RespuestaReembolso;
    expect(cuerpo.reembolsoAprobado).toBe(true);
    expect(cuerpo.warning).toBeUndefined();
    expect(cuerpo.notaCreditoId).toEqual(expect.any(String));

    // La corrección: una fila de ventas por el monto reembolsado, por la
    // pasarela (la plata volvió por el proveedor), con la NC del sistema que
    // corrige la boleta.
    const correcciones = await correccionesDe(venta.id);
    expect(correcciones).toHaveLength(1);
    expect(correcciones[0]).toMatchObject({
      venta_id: cuerpo.notaCreditoId,
      total_final: '23800.0000',
      via: 'pasarela',
    });
    const docs = await documentosDe(cuerpo.notaCreditoId!);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      emisor: 'sistema',
      monto: '23800.0000',
      documento_corregido_id: boleta[0].documento_id,
    });

    // Y el REFUND dice cuál es: el id que la respuesta anuncia.
    const refunds = await refundsDe(ordenId);
    expect(refunds).toEqual([
      { correccion_venta_id: cuerpo.notaCreditoId, estado: 'aprobada' },
    ]);
    const filaRefund: { transaccion_id: string }[] = await ds.query(
      `SELECT transaccion_id FROM pasarela_transacciones
        WHERE orden_id = $1 AND tipo = 'REFUND'`,
      [ordenId],
    );
    expect(filaRefund[0].transaccion_id).toBe(cuerpo.reembolso.transaccionId);
  });

  it('un segundo reembolso parcial deja SU corrección, ligada a SU REFUND (cada fila lleva la suya)', async () => {
    const venta = await ventaOnline();
    const ordenId = await ordenCobrada(venta.id);

    const primero = await reembolsarAdmin(ordenId, { monto: '23800' });
    const segundo = await reembolsarAdmin(ordenId, { monto: '17000' });

    expect(primero.status).toBe(201);
    expect(segundo.status).toBe(201);
    const idPrimero = (primero.body as RespuestaReembolso).notaCreditoId;
    const idSegundo = (segundo.body as RespuestaReembolso).notaCreditoId;
    expect(idPrimero).toBeDefined();
    expect(idSegundo).toBeDefined();
    expect(idSegundo).not.toBe(idPrimero);
    expect(
      (await refundsDe(ordenId)).map((r) => r.correccion_venta_id),
    ).toEqual([idPrimero, idSegundo]);
    expect(await correccionesDe(venta.id)).toHaveLength(2);
  });

  describe('lo devuelto por la pasarela gasta el tope por pago de una devolución manual', () => {
    // La venta de mostrador pide caja abierta; el débito no mueve plata de la caja.
    let caja: CajaAbierta;
    beforeAll(async () => {
      caja = await abrirCaja(app, token);
    });
    afterAll(async () => {
      await cerrarCaja(app, token, caja);
    });
    const notaPorElPago = (ventaId: string, monto: string, pagoId: string) =>
      request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/notas-credito`)
        .set('Idempotency-Key', randomUUID())
        .set(auth())
        .send({
          monto,
          devolucion: { pagoId },
          comentario: 'por el mismo pago',
        });
    const viaYPago = async (
      correccionId: string,
    ): Promise<{ via: string; pago_id: string | null }> => {
      const f: { via: string; pago_id: string | null }[] = await ds.query(
        `SELECT devolucion_via AS via, devolucion_pago_id AS pago_id
           FROM ventas WHERE venta_id = $1`,
        [correccionId],
      );
      return f[0];
    };
    /** $100.000 con $40.000 pagados con débito (un único pago) y $60.000 debidos. */
    const ventaConUnPago = async (): Promise<{
      venta: Venta;
      pagoId: string;
    }> => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set(auth())
        .send({
          // Una venta de mostrador que se paga a medias, ligada después a la orden:
          // `vincularVenta` puede ligar una orden a cualquier venta, y la online
          // se cobra entera (con un único pago por el total, el tope de la venta
          // y el del pago valen lo mismo y no se distinguen).
          lineas: [
            { itemId: itemAfecto60, cantidad: '1' },
            { itemId: itemExento, cantidad: '1' },
          ],
          pagos: [{ metodoPagoId: DEBITO_ID, monto: '40000' }],
        });
      expect(res.status).toBe(201);
      const venta = res.body as Venta;
      const pagos: { pago_id: string }[] = await ds.query(
        `SELECT pago_id FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [venta.id],
      );
      expect(pagos).toHaveLength(1);
      return { venta, pagoId: pagos[0].pago_id };
    };

    it('con un único pago, el REFUND aprobado de 15.000 lo anota y la nota manual por ese pago solo puede devolver los 25.000 que quedan', async () => {
      const { venta, pagoId } = await ventaConUnPago();
      const ordenId = await ordenCobrada(venta.id);

      const refund = await reembolsarAdmin(ordenId, { monto: '15000' });
      expect(refund.status).toBe(201);
      const correccion = (refund.body as RespuestaReembolso).notaCreditoId!;
      // La vía sigue siendo la pasarela, pero la corrección anota el pago.
      expect(await viaYPago(correccion)).toEqual({
        via: 'pasarela',
        pago_id: pagoId,
      });

      // El pago trajo 40.000 y por él ya volvieron 15.000: pedir los 40.000
      // enteros rebota (el tope de la venta, 85.000, y el del documento no lo ven).
      const demasiado = await notaPorElPago(venta.id, '40000', pagoId);
      expect(demasiado.status).toBe(400);
      expect(JSON.stringify(demasiado.body)).toMatch(
        /por devolver por ese pago/,
      );
      expect(await correccionesDe(venta.id)).toHaveLength(1);

      const resto = await notaPorElPago(venta.id, '25000', pagoId);
      expect(resto.status).toBe(201);
    });

    it('con dos pagos la pasarela no elige ninguno: la corrección no anota pago y no gasta ningún tope', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set(auth())
        .send({
          canal: 'online',
          lineas: [
            { itemId: itemAfecto60, cantidad: '1' },
            { itemId: itemExento, cantidad: '1' },
          ],
          pagos: [
            { metodoPagoId: DEBITO_ID, monto: '40000' },
            { metodoPagoId: CREDITO_ID, monto: '60000' },
          ],
        });
      expect(res.status).toBe(201);
      const venta = res.body as Venta;
      const ordenId = await ordenCobrada(venta.id);

      const refund = await reembolsarAdmin(ordenId, { monto: '15000' });

      expect(refund.status).toBe(201);
      expect(
        await viaYPago((refund.body as RespuestaReembolso).notaCreditoId!),
      ).toEqual({ via: 'pasarela', pago_id: null });
    });
  });

  // El tope por pago, al revés (tarea 16): el modal de la nota del POS ofrece el
  // pago de Webpay de una venta online como "por la tarjeta", y esa nota gasta el
  // tope por pago. Un REFUND de la misma orden que no lo mirara devolvería la plata
  // dos veces: el proveedor la saca, y después la corrección falla por el tope.
  describe('el REFUND respeta lo que las notas manuales ya devolvieron por el pago', () => {
    let caja: CajaAbierta;
    beforeAll(async () => {
      caja = await abrirCaja(app, token);
    });
    afterAll(async () => {
      await cerrarCaja(app, token, caja);
    });
    const pagoDe = async (ventaId: string): Promise<string> => {
      const pagos: { pago_id: string }[] = await ds.query(
        `SELECT pago_id FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );
      expect(pagos).toHaveLength(1);
      return pagos[0].pago_id;
    };
    const notaPorElPago = (ventaId: string, monto: string, pagoId: string) =>
      request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/notas-credito`)
        .set('Idempotency-Key', randomUUID())
        .set(auth())
        .send({ monto, devolucion: { pagoId }, comentario: 'desde el POS' });

    it('la escena: la nota del POS devolvió los 100.000 por el pago de Webpay, y el REFUND de la misma orden da 400 SIN llamar a la pasarela', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      const nota = await notaPorElPago(
        venta.id,
        '100000',
        await pagoDe(venta.id),
      );
      expect(nota.status).toBe(201);

      const res = await reembolsarAdmin(ordenId, { monto: '100000' });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/por devolver/);
      // Sin cifras: ni el tope ni lo que cobró el pago.
      expect(JSON.stringify(res.body)).not.toMatch(/\d{4}/);
      expect(reembolsarEnElProveedor).not.toHaveBeenCalled();
      expect(await refundsDe(ordenId)).toEqual([]);
      expect(await correccionesDe(venta.id)).toHaveLength(1);
    });

    it('la API externa (llave de API) respeta el mismo tope', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      expect(
        (await notaPorElPago(venta.id, '100000', await pagoDe(venta.id)))
          .status,
      ).toBe(201);

      const res = await reembolsarApi(ordenId, { monto: '100000' });

      expect(res.status).toBe(400);
      expect(reembolsarEnElProveedor).not.toHaveBeenCalled();
      expect(await refundsDe(ordenId)).toEqual([]);
    });

    it('lo que deja pasar: con una nota de 30.000 quedan 70.000; 70.001 da 400 y 70.000 se aprueba', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      expect(
        (await notaPorElPago(venta.id, '30000', await pagoDe(venta.id))).status,
      ).toBe(201);

      const demasiado = await reembolsarAdmin(ordenId, { monto: '70001' });
      expect(demasiado.status).toBe(400);
      expect(reembolsarEnElProveedor).not.toHaveBeenCalled();
      expect(await refundsDe(ordenId)).toEqual([]);

      const justo = await reembolsarAdmin(ordenId, { monto: '70000' });
      expect(justo.status).toBe(201);
      const cuerpo = justo.body as RespuestaReembolso;
      expect(cuerpo.reembolsoAprobado).toBe(true);
      expect(cuerpo.warning).toBeUndefined();
      expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
      // Y ahora el pago quedó en cero: el siguiente REFUND, por poco que sea, rebota.
      const sobrante = await reembolsarAdmin(ordenId, { monto: '1500' });
      expect(sobrante.status).toBe(400);
      expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
    });

    it('con dos pagos no hay a cuál atribuirlo: el REFUND de 80.000 (más que cualquiera de los dos) pasa, como hoy', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set(auth())
        .send({
          canal: 'online',
          lineas: [
            { itemId: itemAfecto60, cantidad: '1' },
            { itemId: itemExento, cantidad: '1' },
          ],
          pagos: [
            { metodoPagoId: DEBITO_ID, monto: '40000' },
            { metodoPagoId: CREDITO_ID, monto: '60000' },
          ],
        });
      expect(res.status).toBe(201);
      const ordenId = await ordenCobrada((res.body as Venta).id);

      const refund = await reembolsarAdmin(ordenId, { monto: '80000' });

      expect(refund.status).toBe(201);
      expect((refund.body as RespuestaReembolso).warning).toBeUndefined();
    });

    // El hueco entre el commit del REFUND y su hook (medido: una nota lanzada
    // hasta ~5 ms detrás del REFUND pasaba el tope y la plata salía dos veces).
    // Se reproduce sin demoras con un hook que FALLA: la plata ya volvió, el
    // REFUND queda aprobado y sin corrección ligada — el mismo estado que hay
    // entre el commit y el hook.
    const opcionDelPago = async (
      ventaId: string,
    ): Promise<string | undefined> => {
      const res = await request(app.getHttpServer())
        .get(`/api/ventas/${ventaId}`)
        .set(auth());
      expect(res.status).toBe(200);
      return (
        res.body as {
          opcionesDevolucion: { sinPlata: boolean; monto: string }[];
        }
      ).opcionesDevolucion.find((o) => !o.sinPlata)?.monto;
    };

    it('un REFUND aprobado cuyo hook todavía no corrió (o falló) ya gasta el tope: la nota del POS por 30.001 da 400 sin cifras y por 30.000 pasa', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      const pagoId = await pagoDe(venta.id);
      const hook = jest
        .spyOn(app.get(VentasReembolsoHandler), 'onReembolsoAprobado')
        .mockRejectedValueOnce(new Error('el hook no llegó a crear la nota'));
      let refund;
      try {
        refund = await reembolsarAdmin(ordenId, { monto: '70000' });
      } finally {
        hook.mockRestore();
      }
      expect(refund.status).toBe(201);
      expect((refund.body as RespuestaReembolso).warning).toBeDefined();
      expect(await refundsDe(ordenId)).toEqual([
        { correccion_venta_id: null, estado: 'aprobada' },
      ]);
      expect(await correccionesDe(venta.id)).toEqual([]);
      // La pantalla ya no ofrece lo que salió por el proveedor.
      expect(await opcionDelPago(venta.id)).toBe('30000.0000');

      const demasiado = await notaPorElPago(venta.id, '30001', pagoId);
      expect(demasiado.status).toBe(400);
      expect(JSON.stringify(demasiado.body)).toMatch(/por devolver/);
      expect(JSON.stringify(demasiado.body)).not.toMatch(/\d{4}/);
      expect(await correccionesDe(venta.id)).toEqual([]);

      const resto = await notaPorElPago(venta.id, '30000', pagoId);
      expect(resto.status).toBe(201);
    });

    // El vínculo se escribe dentro de la transacción de la corrección: si falla,
    // la corrección se revierte con él y queda el estado del test de arriba
    // ("el hook falló"), que cuenta una sola vez. Antes la corrección ya estaba
    // commiteada y el REFUND sin ligar: el pago descontaba los 70.000 dos veces
    // y los 30.000 que quedaban no salían ni por el POS ni por la pasarela.
    it('si el vínculo con el REFUND falla, la corrección se revierte con él: el REFUND cuenta una sola vez y los 30.000 que quedan se pueden devolver', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      const pagoId = await pagoDe(venta.id);
      const vinculo = jest
        .spyOn(app.get(TransaccionesService), 'vincularCorreccion')
        .mockRejectedValueOnce(new Error('la conexión se cayó al ligar'));
      let refund;
      let llamadasAlVinculo: number;
      try {
        refund = await reembolsarAdmin(ordenId, { monto: '70000' });
      } finally {
        llamadasAlVinculo = vinculo.mock.calls.length;
        vinculo.mockRestore();
      }
      // Lo que falló es el vínculo, y no otra cosa de la nota: sin esto el
      // mismo warning saldría de cualquier error de la corrección.
      expect(llamadasAlVinculo).toBe(1);
      expect(refund.status).toBe(201);
      const cuerpo = refund.body as RespuestaReembolso;
      expect(cuerpo.reembolsoAprobado).toBe(true);
      expect(cuerpo.warning).toContain('reembolso fue procesado');
      expect(cuerpo.notaCreditoId).toBeUndefined();
      expect(await refundsDe(ordenId)).toEqual([
        { correccion_venta_id: null, estado: 'aprobada' },
      ]);
      expect(await correccionesDe(venta.id)).toEqual([]);

      expect(await opcionDelPago(venta.id)).toBe('30000.0000');
      const resto = await notaPorElPago(venta.id, '30000', pagoId);
      expect(resto.status).toBe(201);
    });

    it('control: con la corrección ya ligada el REFUND cuenta una sola vez (por la corrección): quedan 30.000, no 100.000−70.000−70.000', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      const pagoId = await pagoDe(venta.id);

      const refund = await reembolsarAdmin(ordenId, { monto: '70000' });
      expect(refund.status).toBe(201);
      expect((refund.body as RespuestaReembolso).warning).toBeUndefined();
      // Ligado: la corrección del hook existe y el REFUND apunta a ella.
      expect((await refundsDe(ordenId))[0].correccion_venta_id).toEqual(
        expect.any(String),
      );

      expect(await opcionDelPago(venta.id)).toBe('30000.0000');
      const demasiado = await notaPorElPago(venta.id, '30001', pagoId);
      expect(demasiado.status).toBe(400);
      const resto = await notaPorElPago(venta.id, '30000', pagoId);
      expect(resto.status).toBe(201);
    });

    it('sin una nota previa, el REFUND total sigue pasando', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);

      const res = await reembolsarAdmin(ordenId, { monto: '100000' });

      expect(res.status).toBe(201);
      const cuerpo = res.body as RespuestaReembolso;
      expect(cuerpo.reembolsoAprobado).toBe(true);
      expect(cuerpo.warning).toBeUndefined();
      expect(cuerpo.notaCreditoId).toEqual(expect.any(String));
    });
  });

  it('un body con generarNotaCredito da 400 y no llega a reembolsar nada (el campo ya no existe)', async () => {
    const venta = await ventaOnline();
    const ordenId = await ordenCobrada(venta.id);

    const res = await reembolsarAdmin(ordenId, {
      monto: '23800',
      generarNotaCredito: true,
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('generarNotaCredito');
    expect(reembolsarEnElProveedor).not.toHaveBeenCalled();
    expect(await refundsDe(ordenId)).toEqual([]);
    expect(await correccionesDe(venta.id)).toEqual([]);
  });

  describe('la API externa (llave de API) es igual', () => {
    it('con generarNotaCredito: 400, sin tocar al proveedor', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);

      const res = await reembolsarApi(ordenId, {
        monto: '17000',
        generarNotaCredito: true,
      });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('generarNotaCredito');
      expect(reembolsarEnElProveedor).not.toHaveBeenCalled();
      expect(await refundsDe(ordenId)).toEqual([]);
    });

    it('sin el campo: la corrección sale y el REFUND queda ligado igual que por la ruta del admin', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);

      const res = await reembolsarApi(ordenId, { monto: '17000' });

      expect(res.status).toBe(201);
      const cuerpo = res.body as RespuestaReembolso;
      expect(cuerpo.warning).toBeUndefined();
      expect(cuerpo.notaCreditoId).toEqual(expect.any(String));
      expect((await refundsDe(ordenId))[0].correccion_venta_id).toBe(
        cuerpo.notaCreditoId,
      );
      expect((await correccionesDe(venta.id))[0]).toMatchObject({
        total_final: '17000.0000',
        via: 'pasarela',
      });
    });
  });

  describe('devoluciones que reponen stock', () => {
    it('por la llave de API (sin usuario): la corrección sale, el REFUND queda ligado y el stock vuelve con usuario NULL', async () => {
      const venta = await ventaOnlineConProducto();
      const ordenId = await ordenCobrada(venta.id);
      // `reponerStock` ausente: repone si el ítem puede, que es el caso común.
      const res = await reembolsarApi(ordenId, {
        monto: '7000',
        devoluciones: [{ itemId: itemProducto, cantidad: '1' }],
      });

      expect(res.status).toBe(201);
      const cuerpo = res.body as RespuestaReembolso;
      expect(cuerpo.warning).toBeUndefined();
      expect(cuerpo.notaCreditoId).toEqual(expect.any(String));
      expect((await refundsDe(ordenId))[0].correccion_venta_id).toBe(
        cuerpo.notaCreditoId,
      );
      // El stock volvió, y la fila no inventa un usuario: la llave de API no
      // tiene (uuid nulo, no la cadena vacía).
      expect(await movimientosDeDevolucion(cuerpo.notaCreditoId!)).toEqual([
        { cantidad: '1.0000', usuario_id: null },
      ]);
    });

    it('por la ruta del admin: el mismo reembolso deja el movimiento con el usuario del token', async () => {
      const venta = await ventaOnlineConProducto();
      const ordenId = await ordenCobrada(venta.id);

      const res = await reembolsarAdmin(ordenId, {
        monto: '7000',
        devoluciones: [{ itemId: itemProducto, cantidad: '1' }],
      });

      expect(res.status).toBe(201);
      const cuerpo = res.body as RespuestaReembolso;
      expect(cuerpo.warning).toBeUndefined();
      const movimientos = await movimientosDeDevolucion(cuerpo.notaCreditoId!);
      expect(movimientos).toHaveLength(1);
      expect(movimientos[0].usuario_id).toEqual(expect.any(String));
    });
  });

  it('una orden SIN venta se reembolsa sin corrección y sin aviso: es legítimo', async () => {
    const ordenId = await ordenCobrada(null);

    const res = await reembolsarAdmin(ordenId, { monto: '17000' });

    expect(res.status).toBe(201);
    const cuerpo = res.body as RespuestaReembolso;
    expect(cuerpo.reembolsoAprobado).toBe(true);
    expect(cuerpo.warning).toBeUndefined();
    expect(cuerpo.notaCreditoId).toBeUndefined();
    expect(await refundsDe(ordenId)).toEqual([
      { correccion_venta_id: null, estado: 'aprobada' },
    ]);
  });

  it('si la corrección no se puede crear, la plata ya volvió: el REFUND queda aprobado, SIN corrección ligada, y el aviso trae el motivo', async () => {
    // Una orden ligada a una venta que no existe: el lado de ventas falla y el
    // reembolso, que el proveedor ya ejecutó, no se revierte.
    const ordenId = await ordenCobrada(randomUUID());

    const res = await reembolsarAdmin(ordenId, { monto: '17000' });

    expect(res.status).toBe(201);
    const cuerpo = res.body as RespuestaReembolso;
    expect(cuerpo.reembolsoAprobado).toBe(true);
    expect(cuerpo.notaCreditoId).toBeUndefined();
    expect(cuerpo.warning).toContain('reembolso fue procesado');
    expect(await refundsDe(ordenId)).toEqual([
      { correccion_venta_id: null, estado: 'aprobada' },
    ]);
  });

  describe('un reembolso que se reintenta no sale dos veces por el proveedor (ADR-029)', () => {
    /** Lo que Transbank informaría de una orden de $100.000 con este saldo sin anular. */
    const saldoEnTransbank = (saldo: string | null, estado: string) =>
      consultarEnElProveedor.mockResolvedValue({
        estado: 'pagada',
        estadoProveedor: estado,
        saldo,
        response: { balance: saldo, status: estado },
      });
    const serieDe = async (ordenId: string) =>
      (
        await ds.query<
          {
            estado: string;
            monto: string;
            resolucion: string | null;
            correccion_venta_id: string | null;
          }[]
        >(
          `SELECT estado, monto::text AS monto, resolucion, correccion_venta_id
             FROM pasarela_transacciones
            WHERE orden_id = $1 AND tipo = 'REFUND' AND eliminado_el IS NULL
            ORDER BY fecha_transaccion`,
          [ordenId],
        )
      ).map((r) => ({
        ...r,
        monto: r.monto.replace(/\.0+$/, ''),
        corregido: r.correccion_venta_id !== null,
      }));

    it('admin: dos POST iguales con la misma clave = un REFUND, una corrección, el proveedor llamado una vez; el segundo reproduce', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      const clave = randomUUID();

      const primero = await reembolsarAdmin(ordenId, { monto: '17000' }, clave);
      const segundo = await reembolsarAdmin(ordenId, { monto: '17000' }, clave);

      expect(primero.status).toBe(201);
      expect(segundo.status).toBe(201);
      expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
      const uno = primero.body as RespuestaReembolso & { repetida?: boolean };
      const dos = segundo.body as RespuestaReembolso & { repetida?: boolean };
      expect(uno.repetida).toBeUndefined();
      expect(dos).toMatchObject({
        repetida: true,
        reembolsoAprobado: true,
        notaCreditoId: uno.notaCreditoId,
      });
      expect(dos.reembolso.transaccionId).toBe(uno.reembolso.transaccionId);
      expect(await serieDe(ordenId)).toEqual([
        expect.objectContaining({
          estado: 'aprobada',
          monto: '17000',
          resolucion: 'proveedor',
          corregido: true,
        }),
      ]);
      expect(await correccionesDe(venta.id)).toHaveLength(1);
    });

    it('API: dos POST iguales con la misma clave = un REFUND, el proveedor llamado una vez', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      const clave = randomUUID();

      const primero = await reembolsarApi(ordenId, { monto: '17000' }, clave);
      const segundo = await reembolsarApi(ordenId, { monto: '17000' }, clave);

      expect(primero.status).toBe(201);
      expect(segundo.status).toBe(201);
      expect((segundo.body as { repetida?: boolean }).repetida).toBe(true);
      expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
      expect(await serieDe(ordenId)).toHaveLength(1);
      // La llave de API no tiene usuario: la clave queda a nombre de la llave.
      const [reclamo] = await ds.query<
        { usuario_id: string | null; api_key_id: string | null }[]
      >(
        `SELECT usuario_id, api_key_id FROM solicitudes_idempotentes
          WHERE clave = $1 AND eliminado_el IS NULL`,
        [clave],
      );
      expect(reclamo.usuario_id).toBeNull();
      expect(reclamo.api_key_id).toEqual(expect.any(String));
    });

    it('la clave es por actor: la misma clave por el admin y por la llave de API son dos intentos', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      const clave = randomUUID();

      expect(
        (await reembolsarAdmin(ordenId, { monto: '17000' }, clave)).status,
      ).toBe(201);
      expect(
        (await reembolsarApi(ordenId, { monto: '17000' }, clave)).status,
      ).toBe(201);

      expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(2);
      expect(await serieDe(ordenId)).toHaveLength(2);
    });

    it('duplicado concurrente: el segundo espera al primero y reproduce; el proveedor se llama una vez', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      const clave = randomUUID();
      reembolsarEnElProveedor.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  aprobada: true,
                  codigoRespuesta: '0',
                  codigoAutorizacion: 'AUT-E2E',
                  tipoPago: 'VD',
                  request: {},
                  response: {},
                }),
              300,
            ),
          ),
      );

      const [a, b] = await Promise.all([
        reembolsarAdmin(ordenId, { monto: '17000' }, clave),
        reembolsarAdmin(ordenId, { monto: '17000' }, clave),
      ]);

      expect([a.status, b.status]).toEqual([201, 201]);
      expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
      expect(
        [a.body, b.body].filter((r) => (r as { repetida?: boolean }).repetida),
      ).toHaveLength(1);
      expect(await serieDe(ordenId)).toHaveLength(1);
    });

    it('un 400 de negocio no deja rastro: el mismo intento corregido entra con la misma clave', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      const clave = randomUUID();

      const excedido = await reembolsarAdmin(
        ordenId,
        { monto: '100001' },
        clave,
      );
      expect(excedido.status).toBe(400);
      expect(reembolsarEnElProveedor).not.toHaveBeenCalled();
      expect(await serieDe(ordenId)).toEqual([]);

      // Cambió el monto: otra huella, pero la clave quedó libre (sin 422).
      const corregido = await reembolsarAdmin(
        ordenId,
        { monto: '17000' },
        clave,
      );
      expect(corregido.status).toBe(201);
      expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
    });

    it('otros datos con la misma clave: 422 con la orden, y la serie sigue con un solo REFUND', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);
      const clave = randomUUID();

      await reembolsarAdmin(ordenId, { monto: '17000' }, clave);
      const otro = await reembolsarAdmin(ordenId, { monto: '20000' }, clave);

      expect(otro.status).toBe(422);
      expect(otro.body).toMatchObject({
        message: expect.stringContaining('ya se había hecho con otros datos'),
        ordenId,
      });
      expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
      expect(await serieDe(ordenId)).toHaveLength(1);
    });

    it('sin la cabecera: 400 por las dos rutas, sin tocar al proveedor', async () => {
      const venta = await ventaOnline();
      const ordenId = await ordenCobrada(venta.id);

      const admin = await request(app.getHttpServer())
        .post(`/api/pasarela/admin/ordenes/${ordenId}/reembolsos`)
        .set(auth())
        .send({ monto: '17000' });
      const api = await request(app.getHttpServer())
        .post(`/api/pasarela/api/cobros/${ordenId}/reembolsos`)
        .set('Authorization', `Bearer ${apiKey}`)
        .send({ monto: '17000' });

      expect(admin.status).toBe(400);
      expect(api.status).toBe(400);
      expect(reembolsarEnElProveedor).not.toHaveBeenCalled();
    });

    describe('cuando Transbank devolvió la plata y no nos enteramos', () => {
      it('el proceso falla DESPUÉS de que el proveedor aprobó: el reintento NO vuelve a llamar, aclara por saldo y deja la corrección', async () => {
        const venta = await ventaOnline();
        const ordenId = await ordenCobrada(venta.id);
        const clave = randomUUID();
        // Lo que sea que rompa tx1 después de la llamada: acá, cerrar la fila.
        const transacciones = app.get(TransaccionesService);
        const cierre = jest
          .spyOn(transacciones, 'resolverReembolso')
          .mockRejectedValueOnce(new Error('se cayó la base'));

        const primero = await reembolsarAdmin(
          ordenId,
          { monto: '17000' },
          clave,
        );
        cierre.mockRestore();
        expect(primero.status).toBe(500);
        expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
        // La plata salió y la fila lo dice como puede: sin confirmar.
        expect(await serieDe(ordenId)).toEqual([
          expect.objectContaining({ estado: 'iniciada', monto: '17000' }),
        ]);

        saldoEnTransbank('83000', 'PARTIALLY_NULLIFIED');
        const reintento = await reembolsarAdmin(
          ordenId,
          { monto: '17000' },
          clave,
        );

        expect(reintento.status).toBe(201);
        expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
        expect(reintento.body).toMatchObject({
          reembolsoAprobado: true,
          repetida: true,
          notaCreditoId: expect.any(String),
        });
        expect(await serieDe(ordenId)).toEqual([
          expect.objectContaining({
            estado: 'aprobada',
            resolucion: 'saldo',
            corregido: true,
          }),
        ]);
        expect(await correccionesDe(venta.id)).toHaveLength(1);
      });

      it('Transbank no contesta: 502 sin confirmar; el reintento consulta, "no salió", y un intento nuevo sí sale', async () => {
        const venta = await ventaOnline();
        const ordenId = await ordenCobrada(venta.id);
        const clave = randomUUID();
        reembolsarEnElProveedor.mockRejectedValueOnce(
          new ProviderComunicacionError('timeout', { url: 'tbk' }),
        );

        const primero = await reembolsarAdmin(
          ordenId,
          { monto: '17000' },
          clave,
        );
        expect(primero.status).toBe(502);
        expect(await serieDe(ordenId)).toEqual([
          expect.objectContaining({ estado: 'iniciada' }),
        ]);

        saldoEnTransbank(null, 'AUTHORIZED');
        const reintento = await reembolsarAdmin(
          ordenId,
          { monto: '17000' },
          clave,
        );
        expect(reintento.status).toBe(201);
        expect(reintento.body).toMatchObject({
          reembolsoAprobado: false,
          motivo: expect.stringContaining('Podés reembolsar de nuevo'),
        });
        expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);

        // El mismo clic otra vez reproduce "no salió": no vuelve a consultar.
        consultarEnElProveedor.mockClear();
        const otraVez = await reembolsarAdmin(
          ordenId,
          { monto: '17000' },
          clave,
        );
        expect(otraVez.status).toBe(201);
        expect(otraVez.body).toMatchObject({
          reembolsoAprobado: false,
          repetida: true,
        });
        expect(consultarEnElProveedor).not.toHaveBeenCalled();

        // La decisión de reintentar es de la persona: con una clave nueva sale.
        const nuevo = await reembolsarAdmin(ordenId, { monto: '17000' });
        expect(nuevo.status).toBe(201);
        expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(2);
        expect(await serieDe(ordenId)).toEqual([
          expect.objectContaining({ estado: 'rechazada', resolucion: 'saldo' }),
          expect.objectContaining({
            estado: 'aprobada',
            resolucion: 'proveedor',
          }),
        ]);
      });

      it('si el saldo no cuadra: 409 al portal por la misma clave y por una nueva; nada sale y la fila sigue sin confirmar', async () => {
        const venta = await ventaOnline();
        const ordenId = await ordenCobrada(venta.id);
        const clave = randomUUID();
        reembolsarEnElProveedor.mockRejectedValueOnce(
          new ProviderComunicacionError('timeout', {}),
        );
        await reembolsarAdmin(ordenId, { monto: '17000' }, clave);
        // Alguien devolvió $30.000 a mano desde el portal de Transbank.
        saldoEnTransbank('70000', 'PARTIALLY_NULLIFIED');

        const mismo = await reembolsarAdmin(ordenId, { monto: '17000' }, clave);
        const otro = await reembolsarAdmin(ordenId, { monto: '10000' });

        expect(mismo.status).toBe(409);
        expect(otro.status).toBe(409);
        expect((otro.body as { message: string }).message).toContain(
          'portal de Transbank',
        );
        expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
        expect(await serieDe(ordenId)).toEqual([
          expect.objectContaining({ estado: 'iniciada' }),
        ]);
      });

      /** Deja un REFUND de $17.000 sin confirmar (Transbank no contestó) y devuelve su id. */
      const pendienteDe17000 = async (
        ordenId: string,
        reembolsar = reembolsarAdmin,
        body: Record<string, unknown> = { monto: '17000' },
      ): Promise<string> => {
        reembolsarEnElProveedor.mockRejectedValueOnce(
          new ProviderComunicacionError('timeout', {}),
        );
        expect((await reembolsar(ordenId, body)).status).toBe(502);
        const [fila] = await ds.query<{ transaccion_id: string }[]>(
          `SELECT transaccion_id FROM pasarela_transacciones
            WHERE orden_id = $1 AND tipo = 'REFUND' AND estado = 'iniciada'`,
          [ordenId],
        );
        return fila.transaccion_id;
      };
      const aclarar = (ordenId: string) =>
        request(app.getHttpServer())
          .post(`/api/pasarela/admin/ordenes/${ordenId}/reembolsos/aclarar`)
          .set(auth());
      const marcar = (
        ordenId: string,
        transaccionId: string,
        body: Record<string, unknown>,
      ) =>
        request(app.getHttpServer())
          .post(
            `/api/pasarela/admin/ordenes/${ordenId}/reembolsos/${transaccionId}/resolucion`,
          )
          .set(auth())
          .send(body);

      it('"Volver a consultar" aclara el pendiente desde la orden, sin otro reembolso', async () => {
        const venta = await ventaOnline();
        const ordenId = await ordenCobrada(venta.id);
        await pendienteDe17000(ordenId);
        saldoEnTransbank('83000', 'PARTIALLY_NULLIFIED');

        const res = await aclarar(ordenId);

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ aclarado: 'salio' });
        expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
        expect(await serieDe(ordenId)).toEqual([
          expect.objectContaining({
            estado: 'aprobada',
            resolucion: 'saldo',
            corregido: true,
          }),
        ]);
      });

      it('si la consulta no lo aclara, el admin marca "Salió" con el código del portal: aprobado a mano, con su corrección, y la orden se destraba', async () => {
        const venta = await ventaOnline();
        const ordenId = await ordenCobrada(venta.id);
        const pendiente = await pendienteDe17000(ordenId);
        saldoEnTransbank('70000', 'PARTIALLY_NULLIFIED');
        expect((await aclarar(ordenId)).status).toBe(409);

        const sinCodigo = await marcar(ordenId, pendiente, { salio: true });
        expect(sinCodigo.status).toBe(400);
        const res = await marcar(ordenId, pendiente, {
          salio: true,
          codigoAutorizacion: '1213',
        });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
          reembolsoAprobado: true,
          notaCreditoId: expect.any(String),
        });
        const [fila] = await ds.query<
          { codigo_autorizacion: string; resuelta_por: string | null }[]
        >(
          `SELECT codigo_autorizacion, resuelta_por FROM pasarela_transacciones
            WHERE transaccion_id = $1`,
          [pendiente],
        );
        expect(fila).toEqual({
          codigo_autorizacion: '1213',
          resuelta_por: expect.any(String),
        });
        expect(await serieDe(ordenId)).toEqual([
          expect.objectContaining({
            estado: 'aprobada',
            resolucion: 'manual',
            corregido: true,
          }),
        ]);
        // Destrabada: el reembolso siguiente sale sin consultar nada.
        consultarEnElProveedor.mockClear();
        expect(
          (await reembolsarAdmin(ordenId, { monto: '10000' })).status,
        ).toBe(201);
        expect(consultarEnElProveedor).not.toHaveBeenCalled();
      });

      it('"No salió" a mano: rechazado, sin corrección; y el reintento con la clave vieja responde eso sin llamar', async () => {
        const venta = await ventaOnline();
        const ordenId = await ordenCobrada(venta.id);
        const clave = randomUUID();
        reembolsarEnElProveedor.mockRejectedValueOnce(
          new ProviderComunicacionError('timeout', {}),
        );
        await reembolsarAdmin(ordenId, { monto: '17000' }, clave);
        const [{ transaccion_id: pendiente }] = await ds.query<
          { transaccion_id: string }[]
        >(
          `SELECT transaccion_id FROM pasarela_transacciones
            WHERE orden_id = $1 AND tipo = 'REFUND'`,
          [ordenId],
        );

        expect(
          (await marcar(ordenId, pendiente, { salio: false })).status,
        ).toBe(201);
        consultarEnElProveedor.mockClear();
        const reintento = await reembolsarAdmin(
          ordenId,
          { monto: '17000' },
          clave,
        );

        expect(reintento.status).toBe(201);
        expect(reintento.body).toMatchObject({ reembolsoAprobado: false });
        expect(consultarEnElProveedor).not.toHaveBeenCalled();
        expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
        expect(await serieDe(ordenId)).toEqual([
          expect.objectContaining({
            estado: 'rechazada',
            resolucion: 'manual',
            corregido: false,
          }),
        ]);
      });

      it('"Salió" y "No salió" a la vez sobre el mismo pendiente: gana uno, el otro da 409, y queda una sola resolución', async () => {
        const venta = await ventaOnline();
        const ordenId = await ordenCobrada(venta.id);
        const pendiente = await pendienteDe17000(ordenId);

        const [a, b] = await Promise.all([
          marcar(ordenId, pendiente, {
            salio: true,
            codigoAutorizacion: '1213',
          }),
          marcar(ordenId, pendiente, { salio: false }),
        ]);

        expect([a.status, b.status].sort()).toEqual([201, 409]);
        const serie = await serieDe(ordenId);
        expect(serie).toHaveLength(1);
        expect(serie[0].resolucion).toBe('manual');
        expect(await correccionesDe(venta.id)).toHaveLength(
          serie[0].estado === 'aprobada' ? 1 : 0,
        );
      });

      it('la corrección de un pendiente pedido por la llave de API es de la llave (sin usuario), aunque lo aclare el admin', async () => {
        const venta = await ventaOnlineConProducto();
        const ordenId = await ordenCobrada(venta.id);
        await pendienteDe17000(ordenId, reembolsarApi, {
          monto: '7000',
          devoluciones: [{ itemId: itemProducto, cantidad: '1' }],
        });
        saldoEnTransbank('93000', 'PARTIALLY_NULLIFIED');

        const res = await aclarar(ordenId);

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ aclarado: 'salio' });
        const [refund] = await serieDe(ordenId);
        expect(refund).toMatchObject({ estado: 'aprobada', corregido: true });
        expect(
          await movimientosDeDevolucion(refund.correccion_venta_id!),
        ).toEqual([{ cantidad: '1.0000', usuario_id: null }]);
      });

      it('el reintento de uno que ya salió reproduce aunque la orden tenga OTRO sin confirmar que no se puede aclarar', async () => {
        const venta = await ventaOnline();
        const ordenId = await ordenCobrada(venta.id);
        const clave = randomUUID();
        expect(
          (await reembolsarAdmin(ordenId, { monto: '10000' }, clave)).status,
        ).toBe(201);
        reembolsarEnElProveedor.mockRejectedValueOnce(
          new ProviderComunicacionError('timeout', {}),
        );
        expect(
          (await reembolsarAdmin(ordenId, { monto: '17000' })).status,
        ).toBe(502);
        saldoEnTransbank('50000', 'PARTIALLY_NULLIFIED');

        const reintento = await reembolsarAdmin(
          ordenId,
          { monto: '10000' },
          clave,
        );
        const nuevo = await reembolsarAdmin(ordenId, { monto: '5000' });

        expect(reintento.status).toBe(201);
        expect(reintento.body).toMatchObject({
          repetida: true,
          reembolsoAprobado: true,
        });
        expect(nuevo.status).toBe(409);
        expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(2);
      });

      it('otro reembolso con clave nueva primero aclara el pendiente: salió, deja su corrección, y después sale el nuevo', async () => {
        const venta = await ventaOnline();
        const ordenId = await ordenCobrada(venta.id);
        reembolsarEnElProveedor.mockRejectedValueOnce(
          new ProviderComunicacionError('timeout', {}),
        );
        await reembolsarAdmin(ordenId, { monto: '17000' });
        saldoEnTransbank('83000', 'PARTIALLY_NULLIFIED');

        const nuevo = await reembolsarAdmin(ordenId, { monto: '10000' });

        expect(nuevo.status).toBe(201);
        expect(await serieDe(ordenId)).toEqual([
          expect.objectContaining({
            estado: 'aprobada',
            monto: '17000',
            resolucion: 'saldo',
            corregido: true,
          }),
          expect.objectContaining({
            estado: 'aprobada',
            monto: '10000',
            resolucion: 'proveedor',
            corregido: true,
          }),
        ]);
        expect(await correccionesDe(venta.id)).toHaveLength(2);
      });
    });
  });
});
