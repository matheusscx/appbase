import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { VentasReembolsoHandler } from '../src/modules/ventas/reembolso-callback.handler';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)
const OTRO_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
const CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const FACTURA_ID = '550e8400-e29b-41d4-a716-446655440146';
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };

interface Venta {
  id: string;
  totalFinal: string;
  estado: string;
}
interface NotaCreada {
  id: string;
  totalFinal: string;
  movimientoCajaId: string | null;
}
interface DocFila {
  documento_id: string;
  emisor: string;
  tipo_documento_id: string | null;
  estado_envio: string | null;
  numero: string | null;
  monto: string;
  monto_afecto: string | null;
  monto_exento: string | null;
  monto_impuestos: string | null;
  pago_id: string | null;
  documento_corregido_id: string | null;
  es_duplicado: boolean;
}
interface OpcionDevolucion {
  pagoId: string | null;
  sinPlata: boolean;
  metodo: string | null;
  monto: string;
  mueveCaja: boolean;
  registro: string;
}
interface Detalle {
  esCorreccion: boolean;
  esNotaCredito: boolean;
  tipoDocumentoId: string | null;
  opcionesDevolucion: OpcionDevolucion[];
  disponibleNotaCredito: { total: string };
  detalles: { clasificacionTributaria: string; totalLinea: string }[];
}
interface ResumenNegocio {
  ventas: { vendido: { hoy: string } };
  masVendidos: { itemId: string; monto: string }[];
}

/**
 * Las correcciones llevan su documento según por dónde vuelve la plata (spec
 * `2026-10-01-emision-por-venta`, § 3.6; ADR-028).
 *
 * Los montos discriminan (nada de 50/50): la venta de $100.000 es un servicio
 * afecto de 60.000 neto (71.400 con IVA) más uno exento de 28.600.
 *
 * ⚠️ Los ítems son propios (servicios, que no mueven inventario): el stock
 * sembrado lo comparten todas las suites. Cada caso fija el emisor del medio y
 * el facturador por la API y `afterAll` los devuelve a `'sistema'`.
 */
describe('Correcciones: el documento según por dónde vuelve la plata (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta;
  let itemAfecto60: string; // 71.400 con IVA
  let itemExento: string; // 28.600
  let itemAfecto100: string; // 119.000 con IVA
  let itemUnico: string; // exento y carísimo: sale primero en "más vendidos"
  let precioUnico: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const patchMetodo = async (metodoPagoId: string, emisor: string) => {
    const res = await request(app.getHttpServer())
      .patch(`/api/metodos-pago/${metodoPagoId}`)
      .set(auth())
      .send({ emisor });
    expect(res.status).toBe(200);
  };
  const patchFacturador = async (facturador: string) => {
    const res = await request(app.getHttpServer())
      .patch('/api/tenants/me')
      .set(auth())
      .send({ facturador });
    expect(res.status).toBe(200);
  };
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
  const vender = async (body: Record<string, unknown>): Promise<Venta> => {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set(auth())
      .send(body);
    expect(res.status).toBe(201);
    return res.body as Venta;
  };
  const lineas100k = () => [
    { itemId: itemAfecto60, cantidad: '1' },
    { itemId: itemExento, cantidad: '1' },
  ];
  const pagoDe = async (
    ventaId: string,
    metodoPagoId: string,
  ): Promise<string> => {
    const rows: { pago_id: string }[] = await ds.query(
      `SELECT pago_id FROM pagos
        WHERE venta_id = $1 AND metodo_pago_id = $2 AND eliminado_el IS NULL
        ORDER BY creado_el`,
      [ventaId, metodoPagoId],
    );
    expect(rows.length).toBeGreaterThan(0);
    return rows[0].pago_id;
  };
  const docsDe = (ventaId: string): Promise<DocFila[]> =>
    ds.query(
      `SELECT documento_id, emisor, tipo_documento_id, estado_envio, numero,
              monto::text AS monto, monto_afecto::text AS monto_afecto,
              monto_exento::text AS monto_exento,
              monto_impuestos::text AS monto_impuestos, pago_id,
              documento_corregido_id, es_duplicado
         FROM venta_documentos
        WHERE venta_id = $1 AND eliminado_el IS NULL
        ORDER BY emisor, monto`,
      [ventaId],
    );
  const docId = async (ventaId: string, emisor: string): Promise<string> => {
    const docs = (await docsDe(ventaId)).filter(
      (d) => d.emisor === emisor && !d.es_duplicado,
    );
    expect(docs).toHaveLength(1);
    return docs[0].documento_id;
  };
  const tipoDeLaVenta = async (ventaId: string): Promise<string | null> => {
    const rows: { tipo_documento_id: string | null }[] = await ds.query(
      `SELECT tipo_documento_id FROM ventas WHERE venta_id = $1`,
      [ventaId],
    );
    return rows[0].tipo_documento_id;
  };
  const crearNc = (ventaId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api/ventas/${ventaId}/notas-credito`)
      .set(auth())
      .send({ comentario: 'devolución de prueba', ...body });
  const nc = async (
    ventaId: string,
    body: Record<string, unknown>,
  ): Promise<NotaCreada> => {
    const res = await crearNc(ventaId, body);
    expect(res.status).toBe(201);
    return res.body as NotaCreada;
  };
  const detalle = async (ventaId: string): Promise<Detalle> => {
    const res = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set(auth());
    expect(res.status).toBe(200);
    return res.body as Detalle;
  };
  const mensaje = (res: request.Response) =>
    (res.body as { message: string | string[] }).message.toString();
  const salidasDeCaja = async (ncId: string): Promise<number> => {
    const rows: { n: number }[] = await ds.query(
      `SELECT COUNT(*)::int AS n FROM movimientos_caja
        WHERE venta_id = $1 AND tipo = 'salida' AND eliminado_el IS NULL`,
      [ncId],
    );
    return rows[0].n;
  };
  const abonar = async (ventaId: string, pago: Record<string, unknown>) => {
    const res = await request(app.getHttpServer())
      .post('/api/pagos')
      .set('Idempotency-Key', randomUUID())
      .set(auth())
      .send({ ventaId, pagos: [pago] });
    expect(res.status).toBe(201);
  };
  const resumenVentas = async (): Promise<{
    totalFacturado: string;
    saldoPendiente: string;
  }> => {
    const res = await request(app.getHttpServer())
      .get('/api/ventas/resumen')
      .set(auth());
    expect(res.status).toBe(200);
    return res.body as { totalFacturado: string; saldoPendiente: string };
  };
  const resumenNegocio = async (): Promise<ResumenNegocio> => {
    const res = await request(app.getHttpServer())
      .get('/api/resumen-negocio/hoy')
      .set(auth());
    expect(res.status).toBe(200);
    return res.body as ResumenNegocio;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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

    itemAfecto60 = await crearItem('Corr afecto 60k E2E', '60000', 'afecto');
    itemExento = await crearItem('Corr exento E2E', '28600', 'exento');
    itemAfecto100 = await crearItem('Corr afecto 100k E2E', '100000', 'afecto');
    // El doble de Date.now(): le gana a cualquier venta del día de otros specs
    // (que suman Date.now() a un fijo) y nunca empata entre corridas. Como le
    // gana a todos, el caso que lo vende lo da de baja al terminar: si no,
    // desplazaría el primer puesto de "más vendidos" a las suites que siguen.
    precioUnico = (Date.now() * 2).toString();
    itemUnico = await crearItem('Corr carísimo E2E', precioUnico, 'exento');

    // Saldo para que las salidas de efectivo no choquen con el saldo de la caja.
    caja = await abrirCaja(app, token, { saldoInicial: '2000000.0000' });
  }, 60000);

  afterAll(async () => {
    try {
      await patchFacturador('sistema');
      await patchMetodo(EFECTIVO_ID, 'sistema');
      await patchMetodo(DEBITO_ID, 'sistema');
      await patchMetodo(CREDITO_ID, 'sistema');
    } finally {
      try {
        if (caja) await cerrarCaja(app, token, caja);
      } finally {
        await app.close();
      }
    }
  });

  beforeEach(async () => {
    await patchFacturador('sistema');
    await patchMetodo(EFECTIVO_ID, 'sistema');
    await patchMetodo(DEBITO_ID, 'maquina');
    await patchMetodo(CREDITO_ID, 'maquina');
  });

  /** $60.000 en efectivo (sistema) + $40.000 con débito (máquina). */
  const ventaMixta = () =>
    vender({
      lineas: lineas100k(),
      pagos: [
        { metodoPagoId: EFECTIVO_ID, monto: '60000' },
        { metodoPagoId: DEBITO_ID, monto: '40000' },
      ],
    });
  /** La mesa de $100.000: $40.000 con débito (máquina) y $60.000 debidos. */
  const mesaConDeuda = () =>
    vender({
      lineas: lineas100k(),
      pagos: [{ metodoPagoId: DEBITO_ID, monto: '40000' }],
    });

  describe('por qué documento pasa la corrección', () => {
    it('NC por el pago en efectivo del pago mixto: corrige la boleta del sistema (no el voucher) y deja la salida de caja', async () => {
      const venta = await ventaMixta();
      const boleta = await docId(venta.id, 'sistema');

      const creada = await nc(venta.id, {
        monto: '23800',
        devolucion: { pagoId: await pagoDe(venta.id, EFECTIVO_ID) },
      });

      expect(creada.movimientoCajaId).not.toBeNull();
      expect(await salidasDeCaja(creada.id)).toBe(1);
      expect(await tipoDeLaVenta(creada.id)).not.toBeNull();
      const docs = await docsDe(creada.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'sistema',
        estado_envio: 'armado',
        numero: null,
        monto: '23800.0000',
        documento_corregido_id: boleta,
        es_duplicado: false,
      });
      // El tipo del documento es el tipo NC de la fila de `ventas`.
      expect(docs[0].tipo_documento_id).toBe(await tipoDeLaVenta(creada.id));
      // Los baldes salen de las líneas de la propia corrección: suman el monto.
      const baldes =
        Number(docs[0].monto_afecto) +
        Number(docs[0].monto_exento) +
        Number(docs[0].monto_impuestos);
      expect(baldes).toBe(23800);
      expect(Number(docs[0].monto_impuestos)).toBeGreaterThan(0);
    });

    it('NC por el pago con tarjeta: NC de la máquina sin número, corrige el voucher y no mueve caja', async () => {
      const venta = await ventaMixta();
      const voucher = await docId(venta.id, 'maquina');

      const creada = await nc(venta.id, {
        monto: '12345',
        devolucion: { pagoId: await pagoDe(venta.id, DEBITO_ID) },
      });

      expect(creada.movimientoCajaId).toBeNull();
      expect(await salidasDeCaja(creada.id)).toBe(0);
      const docs = await docsDe(creada.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'maquina',
        numero: null,
        estado_envio: null,
        monto: '12345.0000',
        documento_corregido_id: voucher,
        monto_afecto: null,
        pago_id: null,
      });
      expect(docs[0].tipo_documento_id).toBe(await tipoDeLaVenta(creada.id));
      expect(docs[0].tipo_documento_id).not.toBeNull();
    });

    it('un comercio con el efectivo en la máquina: NC de la máquina Y salida de caja (el contrato es por pago, no por efectivo)', async () => {
      await patchMetodo(EFECTIVO_ID, 'maquina');
      const venta = await ventaMixta();
      const pagoEfectivo = await pagoDe(venta.id, EFECTIVO_ID);
      const creada = await nc(venta.id, {
        monto: '10000',
        devolucion: { pagoId: pagoEfectivo },
      });

      expect(await salidasDeCaja(creada.id)).toBe(1);
      const docs = await docsDe(creada.id);
      expect(docs[0].emisor).toBe('maquina');
      const corregido = (await docsDe(venta.id)).find(
        (d) => d.documento_id === docs[0].documento_corregido_id,
      );
      expect(corregido).toMatchObject({
        emisor: 'maquina',
        pago_id: pagoEfectivo,
        monto: '60000.0000',
      });
    });

    it('NC sobre una venta en "nadie": devolución interna, tipo nulo, y la venta original baja su disponible', async () => {
      await patchMetodo(DEBITO_ID, 'nadie');
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
      });
      expect((await docsDe(venta.id)).map((d) => d.emisor)).toEqual(['nadie']);
      expect((await detalle(venta.id)).disponibleNotaCredito.total).toBe(
        '100000.0000',
      );

      const creada = await nc(venta.id, {
        monto: '30000',
        devolucion: { pagoId: await pagoDe(venta.id, DEBITO_ID) },
      });

      expect(await tipoDeLaVenta(creada.id)).toBeNull();
      const docs = await docsDe(creada.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'nadie',
        tipo_documento_id: null,
        monto: '30000.0000',
        documento_corregido_id: await docId(venta.id, 'nadie'),
      });
      expect((await detalle(venta.id)).disponibleNotaCredito.total).toBe(
        '70000.0000',
      );
      // Y la devolución interna, vista desde ella misma, es una corrección que
      // no lleva el tipo NC.
      const propia = await detalle(creada.id);
      expect(propia.esCorreccion).toBe(true);
      expect(propia.esNotaCredito).toBe(false);
      expect(propia.tipoDocumentoId).toBeNull();
      // Una corrección no se corrige: su detalle no ofrece nada que devolver.
      expect(propia.disponibleNotaCredito.total).toBe('0.0000');
      expect(propia.opcionesDevolucion).toEqual([]);
    });

    it('en una factura, la factura siempre: el pago con tarjeta y el de efectivo corrigen la misma factura', async () => {
      const venta = await vender({
        tipoDocumentoId: FACTURA_ID,
        lineas: [{ itemId: itemAfecto100, cantidad: '1' }],
        pagos: [
          { metodoPagoId: EFECTIVO_ID, monto: '19000' },
          { metodoPagoId: DEBITO_ID, monto: '100000' },
        ],
      });
      const factura = await docId(venta.id, 'sistema');

      const conTarjeta = await nc(venta.id, {
        monto: '5000',
        devolucion: { pagoId: await pagoDe(venta.id, DEBITO_ID) },
      });
      const conEfectivo = await nc(venta.id, {
        monto: '7000',
        devolucion: { pagoId: await pagoDe(venta.id, EFECTIVO_ID) },
      });

      for (const creada of [conTarjeta, conEfectivo]) {
        const docs = await docsDe(creada.id);
        expect(docs).toHaveLength(1);
        expect(docs[0]).toMatchObject({
          emisor: 'sistema',
          documento_corregido_id: factura,
        });
      }
      expect(conTarjeta.movimientoCajaId).toBeNull();
      expect(conEfectivo.movimientoCajaId).not.toBeNull();
    });
  });

  describe('cada pago queda enlazado al documento que lo cubre (pagos.documento_id)', () => {
    const documentoDelPago = async (pagoId: string): Promise<string | null> => {
      const filas: { documento_id: string | null }[] = await ds.query(
        `SELECT documento_id FROM pagos WHERE pago_id = $1`,
        [pagoId],
      );
      return filas[0].documento_id;
    };

    it('al cobrar: el pago de la máquina lleva su voucher y el del sistema la boleta', async () => {
      const venta = await ventaMixta();

      expect(await documentoDelPago(await pagoDe(venta.id, DEBITO_ID))).toBe(
        await docId(venta.id, 'maquina'),
      );
      expect(await documentoDelPago(await pagoDe(venta.id, EFECTIVO_ID))).toBe(
        await docId(venta.id, 'sistema'),
      );
    });

    it('al cobrar: el pago de nadie lleva la fila nadie, y en una factura todos llevan la factura', async () => {
      await patchMetodo(CREDITO_ID, 'nadie');
      const conNadie = await vender({
        lineas: lineas100k(),
        pagos: [
          { metodoPagoId: EFECTIVO_ID, monto: '70000' },
          { metodoPagoId: CREDITO_ID, monto: '30000' },
        ],
      });
      expect(
        await documentoDelPago(await pagoDe(conNadie.id, CREDITO_ID)),
      ).toBe(await docId(conNadie.id, 'nadie'));
      expect(
        await documentoDelPago(await pagoDe(conNadie.id, EFECTIVO_ID)),
      ).toBe(await docId(conNadie.id, 'sistema'));

      await patchFacturador('externo');
      const factura = await vender({
        tipoDocumentoId: FACTURA_ID,
        lineas: [{ itemId: itemAfecto100, cantidad: '1' }],
        pagos: [
          { metodoPagoId: EFECTIVO_ID, monto: '19000' },
          { metodoPagoId: DEBITO_ID, monto: '100000' },
        ],
      });
      const laFactura = await docId(factura.id, 'externo');
      expect(
        await documentoDelPago(await pagoDe(factura.id, EFECTIVO_ID)),
      ).toBe(laFactura);
      expect(await documentoDelPago(await pagoDe(factura.id, DEBITO_ID))).toBe(
        laFactura,
      );
    });

    it('al abonar: el pago del abono lleva el documento de la deuda, nunca el voucher duplicado', async () => {
      const venta = await mesaConDeuda();
      await abonar(venta.id, { metodoPagoId: CREDITO_ID, monto: '60000' });
      const duplicado = (await docsDe(venta.id)).find((d) => d.es_duplicado)!;

      const delAbono = await documentoDelPago(
        await pagoDe(venta.id, CREDITO_ID),
      );

      expect(delAbono).toBe(await docId(venta.id, 'sistema'));
      expect(delAbono).not.toBe(duplicado.documento_id);
      // Y el del cierre sigue con su voucher.
      expect(await documentoDelPago(await pagoDe(venta.id, DEBITO_ID))).toBe(
        await docId(venta.id, 'maquina'),
      );
    });

    it('REGRESIÓN: el emisor del medio cambia entre la venta y el reembolso y el reembolso sigue corrigiendo el voucher', async () => {
      const venta = await ventaMixta(); // débito en la máquina: voucher de 40.000
      const voucher = await docId(venta.id, 'maquina');
      await patchMetodo(DEBITO_ID, 'sistema');

      const creada = await nc(venta.id, {
        monto: '5000',
        devolucion: { pagoId: await pagoDe(venta.id, DEBITO_ID) },
      });

      expect((await docsDe(creada.id))[0]).toMatchObject({
        emisor: 'maquina',
        documento_corregido_id: voucher,
      });
    });

    it('REGRESIÓN: un medio que pasa a "nadie" no arrastra a su pago de la boleta del sistema a la fila nadie', async () => {
      await patchMetodo(CREDITO_ID, 'nadie');
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [
          { metodoPagoId: EFECTIVO_ID, monto: '70000' },
          { metodoPagoId: CREDITO_ID, monto: '30000' },
        ],
      });
      const boleta = await docId(venta.id, 'sistema');
      // Hoy el efectivo es "nadie": inferir por el emisor actual lo mandaba a la
      // fila nadie (una devolución interna sobre plata que el sistema documentó).
      await patchMetodo(EFECTIVO_ID, 'nadie');

      const creada = await nc(venta.id, {
        monto: '5000',
        devolucion: { pagoId: await pagoDe(venta.id, EFECTIVO_ID) },
      });

      expect((await docsDe(creada.id))[0]).toMatchObject({
        emisor: 'sistema',
        documento_corregido_id: boleta,
      });
      expect(await tipoDeLaVenta(creada.id)).not.toBeNull();
    });

    it('REGRESIÓN: el pago de un abono sigue corrigiendo la deuda aunque el emisor de su medio haya cambiado', async () => {
      await patchFacturador('externo');
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '30000' }],
      });
      await abonar(venta.id, { metodoPagoId: DEBITO_ID, monto: '70000' });
      await patchMetodo(DEBITO_ID, 'nadie');

      const creada = await nc(venta.id, {
        monto: '2000',
        devolucion: { pagoId: await pagoDe(venta.id, DEBITO_ID) },
      });

      expect((await docsDe(creada.id))[0]).toMatchObject({
        emisor: 'externo',
        documento_corregido_id: await docId(venta.id, 'externo'),
      });
    });
  });

  describe('"no vuelve plata"', () => {
    it('sin_plata en una venta pagada: 400', async () => {
      const venta = await ventaMixta();
      const res = await crearNc(venta.id, {
        monto: '10000',
        devolucion: { sinPlata: true },
      });
      expect(res.status).toBe(400);
      expect(mensaje(res)).toMatch(/no tiene saldo/);
      expect(await docsDe(venta.id)).toHaveLength(2);
    });

    it('sin_plata en la mesa que debe $60.000: corrige la boleta del sistema y no es devolución interna', async () => {
      const venta = await mesaConDeuda();
      const boleta = await docId(venta.id, 'sistema');

      const creada = await nc(venta.id, {
        monto: '25000',
        devolucion: { sinPlata: true },
      });

      expect(creada.movimientoCajaId).toBeNull();
      expect(await tipoDeLaVenta(creada.id)).not.toBeNull();
      const docs = await docsDe(creada.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'sistema',
        documento_corregido_id: boleta,
        monto: '25000.0000',
      });
    });

    it('sin_plata no pasa de lo que la venta todavía debe, aunque el documento de lo debido sea mayor (hubo abonos)', async () => {
      const venta = await mesaConDeuda(); // debe 60.000: boleta del sistema por 60.000
      await abonar(venta.id, { metodoPagoId: EFECTIVO_ID, monto: '20000' });
      // Ahora debe 40.000, pero la boleta de lo debido sigue siendo de 60.000: el
      // tope por documento solo no lo ve.

      const arriba = await crearNc(venta.id, {
        monto: '40001',
        devolucion: { sinPlata: true },
      });
      expect(arriba.status).toBe(400);
      expect(mensaje(arriba)).toMatch(/todavía debe/);
      expect(mensaje(arriba)).not.toMatch(/\d/);
      const corregidas: { n: number }[] = await ds.query(
        `SELECT COUNT(*)::int AS n FROM ventas WHERE venta_referencia_id = $1`,
        [venta.id],
      );
      expect(corregidas[0].n).toBe(0);

      const justo = await nc(venta.id, {
        monto: '40000',
        devolucion: { sinPlata: true },
      });
      expect((await docsDe(justo.id))[0]).toMatchObject({
        emisor: 'sistema',
        documento_corregido_id: await docId(venta.id, 'sistema'),
      });
    });

    it('sin_plata es una SERIE: lo ya rebajado sin plata baja el saldo, y al agotarlo ni se ofrece ni se acepta más', async () => {
      const venta = await mesaConDeuda(); // debe 60.000
      await abonar(venta.id, { metodoPagoId: EFECTIVO_ID, monto: '20000' }); // debe 40.000
      expect(
        (await detalle(venta.id)).opcionesDevolucion.find((o) => o.sinPlata)
          ?.monto,
      ).toBe('40000.0000');

      await nc(venta.id, { monto: '40000', devolucion: { sinPlata: true } });

      // Ya se rebajaron los 40.000 que se debían: una segunda, aunque sea de 1,
      // sacaría plata de una deuda que no existe.
      const segunda = await crearNc(venta.id, {
        monto: '1',
        devolucion: { sinPlata: true },
      });
      expect(segunda.status).toBe(400);
      expect(mensaje(segunda)).toMatch(/no tiene saldo|todavía debe/);
      expect(
        (await detalle(venta.id)).opcionesDevolucion.some((o) => o.sinPlata),
      ).toBe(false);
    });

    it('sin_plata: la parte rebajada se descuenta de a poco (20.000 y 20.000 sí, 1 más no)', async () => {
      const venta = await mesaConDeuda();
      await abonar(venta.id, { metodoPagoId: EFECTIVO_ID, monto: '20000' });

      await nc(venta.id, { monto: '20000', devolucion: { sinPlata: true } });
      expect(
        (await detalle(venta.id)).opcionesDevolucion.find((o) => o.sinPlata)
          ?.monto,
      ).toBe('20000.0000');
      const arriba = await crearNc(venta.id, {
        monto: '20001',
        devolucion: { sinPlata: true },
      });
      expect(arriba.status).toBe(400);
      await nc(venta.id, { monto: '20000', devolucion: { sinPlata: true } });
      expect(
        (
          await crearNc(venta.id, {
            monto: '1',
            devolucion: { sinPlata: true },
          })
        ).status,
      ).toBe(400);
    });

    it('una nota por el pago de la tarjeta NO reduce el margen de "no vuelve plata": la plata volvió por fuera y la deuda sigue igual', async () => {
      const venta = await mesaConDeuda(); // débito 40.000 (voucher) y debe 60.000
      await nc(venta.id, {
        monto: '10000',
        devolucion: { pagoId: await pagoDe(venta.id, DEBITO_ID) },
      });

      const o = (await detalle(venta.id)).opcionesDevolucion.find(
        (x) => x.sinPlata,
      );
      expect(o?.monto).toBe('60000.0000');
      // Y se puede rebajar la deuda entera.
      await nc(venta.id, { monto: '60000', devolucion: { sinPlata: true } });
    });

    it('cada corrección deja registrado por dónde volvió la plata (ventas.devolucion_via / devolucion_pago_id)', async () => {
      const venta = await mesaConDeuda();
      const pago = await pagoDe(venta.id, DEBITO_ID);
      const porPago = await nc(venta.id, {
        monto: '1000',
        devolucion: { pagoId: pago },
      });
      const sinPlata = await nc(venta.id, {
        monto: '2000',
        devolucion: { sinPlata: true },
      });
      const via = async (id: string) => {
        const f: {
          devolucion_via: string | null;
          devolucion_pago_id: string | null;
        }[] = await ds.query(
          `SELECT devolucion_via, devolucion_pago_id FROM ventas WHERE venta_id = $1`,
          [id],
        );
        return f[0];
      };

      expect(await via(porPago.id)).toEqual({
        devolucion_via: 'pago',
        devolucion_pago_id: pago,
      });
      expect(await via(sinPlata.id)).toEqual({
        devolucion_via: 'sin_plata',
        devolucion_pago_id: null,
      });
      // Una venta que no es corrección no lo lleva.
      expect(await via(venta.id)).toEqual({
        devolucion_via: null,
        devolucion_pago_id: null,
      });
    });

    it('sin_plata con facturador externo: corrige el documento hecho por fuera de lo debido, NC externa sin número', async () => {
      await patchFacturador('externo');
      const venta = await mesaConDeuda();
      const externo = await docId(venta.id, 'externo');

      const creada = await nc(venta.id, {
        monto: '25000',
        devolucion: { sinPlata: true },
      });

      const docs = await docsDe(creada.id);
      expect(docs[0]).toMatchObject({
        emisor: 'externo',
        numero: null,
        documento_corregido_id: externo,
      });
      expect(docs[0].tipo_documento_id).toBe(await tipoDeLaVenta(creada.id));
    });
  });

  describe('el pago de un abono', () => {
    it('NC por el pago de un abono con tarjeta (E1b): corrige la boleta de la deuda, no el voucher duplicado', async () => {
      const venta = await mesaConDeuda();
      await abonar(venta.id, { metodoPagoId: CREDITO_ID, monto: '60000' });
      const docs = await docsDe(venta.id);
      const duplicado = docs.find((d) => d.es_duplicado)!;
      expect(duplicado).toBeDefined();
      const boleta = await docId(venta.id, 'sistema');

      const creada = await nc(venta.id, {
        monto: '15000',
        devolucion: { pagoId: await pagoDe(venta.id, CREDITO_ID) },
      });

      const corregida = await docsDe(creada.id);
      expect(corregida).toHaveLength(1);
      expect(corregida[0]).toMatchObject({
        emisor: 'sistema',
        documento_corregido_id: boleta,
      });
      expect(corregida[0].documento_corregido_id).not.toBe(
        duplicado.documento_id,
      );
    });

    it('NC por el pago de un abono en efectivo: corrige la boleta de la deuda y saca la plata de la caja', async () => {
      await patchFacturador('externo');
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '30000' }],
      });
      // Pagó 30.000 del sistema y quedó debiendo 70.000 en un documento externo.
      const externo = await docId(venta.id, 'externo');
      await abonar(venta.id, { metodoPagoId: EFECTIVO_ID, monto: '70000' });
      const pagos: { pago_id: string; monto: string }[] = await ds.query(
        `SELECT pago_id, monto::text AS monto FROM pagos
          WHERE venta_id = $1 AND eliminado_el IS NULL ORDER BY creado_el`,
        [venta.id],
      );
      expect(pagos.map((p) => p.monto)).toEqual(['30000.0000', '70000.0000']);

      // El pago del cierre cae en la boleta del sistema; el del abono, en lo debido.
      const delCierre = await nc(venta.id, {
        monto: '1000',
        devolucion: { pagoId: pagos[0].pago_id },
      });
      const delAbono = await nc(venta.id, {
        monto: '2000',
        devolucion: { pagoId: pagos[1].pago_id },
      });

      expect((await docsDe(delCierre.id))[0]).toMatchObject({
        emisor: 'sistema',
        documento_corregido_id: await docId(venta.id, 'sistema'),
      });
      expect((await docsDe(delAbono.id))[0]).toMatchObject({
        emisor: 'externo',
        documento_corregido_id: externo,
      });
      expect(delAbono.movimientoCajaId).not.toBeNull();
    });
  });

  describe('los topes', () => {
    it('el tope por documento rechaza el excedente aunque el total de la venta alcance', async () => {
      const venta = await ventaMixta(); // débito: voucher de 40.000
      const pagoDebito = await pagoDe(venta.id, DEBITO_ID);

      const res = await crearNc(venta.id, {
        monto: '50000',
        devolucion: { pagoId: pagoDebito },
      });

      expect(res.status).toBe(400);
      expect(mensaje(res)).toMatch(/queda por corregir del documento/);
      // El mensaje no revela ningún monto (ni el del efectivo de la caja).
      expect(mensaje(res)).not.toMatch(/\d/);
      // Nada quedó escrito.
      const corregidas: { n: number }[] = await ds.query(
        `SELECT COUNT(*)::int AS n FROM ventas WHERE venta_referencia_id = $1`,
        [venta.id],
      );
      expect(corregidas[0].n).toBe(0);

      // Lo corregido se acumula contra el mismo documento: 30.000 + 11.000 > 40.000.
      await nc(venta.id, {
        monto: '30000',
        devolucion: { pagoId: pagoDebito },
      });
      const segunda = await crearNc(venta.id, {
        monto: '11000',
        devolucion: { pagoId: pagoDebito },
      });
      expect(segunda.status).toBe(400);
      await nc(venta.id, {
        monto: '10000',
        devolucion: { pagoId: pagoDebito },
      });
    });

    it('la devolución interna cuenta en el tope de la venta original', async () => {
      await patchMetodo(DEBITO_ID, 'nadie');
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
      });
      const pago = await pagoDe(venta.id, DEBITO_ID);
      await nc(venta.id, { monto: '70000', devolucion: { pagoId: pago } });

      const res = await crearNc(venta.id, {
        monto: '40000',
        devolucion: { pagoId: pago },
      });

      expect(res.status).toBe(400);
      // El tope de la VENTA (que corre primero) y no el del documento: con el
      // filtro por tipo, la interna no sumaría y este mensaje sería el otro.
      expect(mensaje(res)).toMatch(/excede lo disponible para nota de crédito/);
    });

    it('la devolución interna cuenta en la composición por porción: la siguiente nota no vuelve a acreditar lo ya devuelto', async () => {
      await patchMetodo(DEBITO_ID, 'nadie');
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
      });
      const pago = await pagoDe(venta.id, DEBITO_ID);
      // Devuelve la línea afecta entera (71.400): la porción afecta queda en cero.
      await nc(venta.id, {
        monto: '71400',
        devolucion: { pagoId: pago },
        devoluciones: [{ itemId: itemAfecto60, cantidad: '1' }],
      });

      const segunda = await nc(venta.id, {
        monto: '28600',
        devolucion: { pagoId: pago },
      });

      // Con el remanente bien contado, lo que queda se parte solo en la porción
      // exenta; sin contar la interna, se repartiría también en la afecta.
      const lineas = (await detalle(segunda.id)).detalles;
      expect(lineas).toHaveLength(1);
      expect(lineas[0]).toMatchObject({
        clasificacionTributaria: 'exento',
        totalLinea: '28600.0000',
      });
    });

    it('la devolución interna que sacó efectivo cuenta en el tope del efectivo de la venta', async () => {
      // Efectivo y débito en `nadie`: un solo documento por 90.000 y 60.000 de
      // efectivo. Las devoluciones internas por el pago en efectivo sacan plata
      // de la caja, y lo ya devuelto tiene que contar aunque la fila no lleve
      // el tipo NC.
      await patchMetodo(EFECTIVO_ID, 'nadie');
      await patchMetodo(DEBITO_ID, 'nadie');
      const venta = await vender({
        lineas: [
          { itemId: itemAfecto60, cantidad: '1' },
          { itemId: itemExento, cantidad: '1' },
        ],
        pagos: [
          { metodoPagoId: EFECTIVO_ID, monto: '60000' },
          { metodoPagoId: DEBITO_ID, monto: '40000' },
        ],
      });
      const efectivo = await pagoDe(venta.id, EFECTIVO_ID);
      const primera = await nc(venta.id, {
        monto: '55000',
        devolucion: { pagoId: efectivo },
      });
      expect(primera.movimientoCajaId).not.toBeNull();
      expect(await tipoDeLaVenta(primera.id)).toBeNull();

      // Al documento le quedan 45.000, pero del efectivo de la venta solo 5.000.
      const res = await crearNc(venta.id, {
        monto: '20000',
        devolucion: { pagoId: efectivo },
      });
      expect(res.status).toBe(422);
    });
  });

  describe('lo que NO suma una devolución interna', () => {
    it('no suma a totalFacturado ni a saldoPendiente de GET /ventas/resumen, ni al vendido ni a lo más vendido del dashboard', async () => {
      await patchMetodo(DEBITO_ID, 'nadie');
      // Pagada A MEDIAS: la venta debe la mitad. Si la corrección contara como una
      // venta (por filtrar por tipo y no por `venta_referencia_id`), su monto entero
      // entraría al saldo pendiente —no tiene pagos—; con la venta pagada entera el
      // saldo no discriminaría nada. (`precioUnico` es par: la mitad es entera.)
      const mitad = (BigInt(precioUnico) / 2n).toString();
      const venta = await vender({
        lineas: [{ itemId: itemUnico, cantidad: '1' }],
        pagos: [{ metodoPagoId: DEBITO_ID, monto: mitad }],
      });
      expect(venta.estado).toBe('pagada_parcial');
      try {
        const ventasAntes = await resumenVentas();
        const negocioAntes = await resumenNegocio();
        const topAntes = negocioAntes.masVendidos.find(
          (m) => m.itemId === itemUnico,
        );
        expect(topAntes?.monto).toBe(`${precioUnico}.0000`);

        await nc(venta.id, {
          monto: mitad,
          devolucion: { pagoId: await pagoDe(venta.id, DEBITO_ID) },
          devoluciones: [{ itemId: itemUnico, cantidad: '1' }],
        });

        const ventasDespues = await resumenVentas();
        // El saldo primero: es el que cambiaría por el monto de la corrección.
        expect(ventasDespues.saldoPendiente).toBe(ventasAntes.saldoPendiente);
        expect(ventasDespues.totalFacturado).toBe(ventasAntes.totalFacturado);
        const negocioDespues = await resumenNegocio();
        expect(negocioDespues.ventas.vendido.hoy).toBe(
          negocioAntes.ventas.vendido.hoy,
        );
        expect(
          negocioDespues.masVendidos.find((m) => m.itemId === itemUnico)?.monto,
        ).toBe(`${precioUnico}.0000`);
      } finally {
        await ds.query(
          `UPDATE ventas SET eliminado_el = NOW()
            WHERE venta_id = $1 OR venta_referencia_id = $1`,
          [venta.id],
        );
      }
    });
  });

  describe('lo que se rechaza', () => {
    it('corregir una corrección: 400', async () => {
      const venta = await ventaMixta();
      const primera = await nc(venta.id, {
        monto: '1000',
        devolucion: { pagoId: await pagoDe(venta.id, EFECTIVO_ID) },
      });
      const res = await crearNc(primera.id, {
        monto: '500',
        devolucion: { sinPlata: true },
      });
      expect(res.status).toBe(400);
      expect(mensaje(res)).toMatch(/otra nota de crédito/);
    });

    it('el pagoId de otra venta del mismo tenant: 400, y no corrige nada', async () => {
      const a = await ventaMixta();
      const b = await ventaMixta();
      const res = await crearNc(a.id, {
        monto: '1000',
        devolucion: { pagoId: await pagoDe(b.id, EFECTIVO_ID) },
      });
      expect(res.status).toBe(400);
      expect(mensaje(res)).toMatch(/no es de esta venta/);
      const corregidas: { n: number }[] = await ds.query(
        `SELECT COUNT(*)::int AS n FROM ventas WHERE venta_referencia_id = ANY($1::uuid[])`,
        [[a.id, b.id]],
      );
      expect(corregidas[0].n).toBe(0);
    });

    it('el pagoId de otro tenant y uno inexistente: el mismo 400', async () => {
      const venta = await ventaMixta();
      const pagoAjeno = await pagoDe(venta.id, EFECTIVO_ID);
      // El pago queda marcado como de otro tenant (sin cambiar de venta): la
      // lectura filtra por tenant y no lo encuentra.
      await ds.query(`UPDATE pagos SET tenant_id = $2 WHERE pago_id = $1`, [
        pagoAjeno,
        OTRO_TENANT_ID,
      ]);
      try {
        const ajeno = await crearNc(venta.id, {
          monto: '1000',
          devolucion: { pagoId: pagoAjeno },
        });
        const inexistente = await crearNc(venta.id, {
          monto: '1000',
          devolucion: { pagoId: randomUUID() },
        });
        expect(ajeno.status).toBe(400);
        expect(inexistente.status).toBe(400);
        expect(mensaje(ajeno)).toBe(mensaje(inexistente));
      } finally {
        await ds.query(`UPDATE pagos SET tenant_id = $2 WHERE pago_id = $1`, [
          pagoAjeno,
          TENANT_ID,
        ]);
      }
    });

    it.each([
      [
        'las dos cosas',
        { devolucion: { pagoId: randomUUID(), sinPlata: true } },
      ],
      ['ninguna', { devolucion: {} }],
      ['sin devolucion', {}],
      ['sinPlata en false', { devolucion: { sinPlata: false } }],
      ['pagoId que no es uuid', { devolucion: { pagoId: 'efectivo' } }],
      [
        'devolverDinero, que ya no existe',
        { devolverDinero: true, devolucion: { sinPlata: true } },
      ],
    ])('devolucion mal formada (%s): 400', async (_nombre, extra) => {
      const venta = await mesaConDeuda();
      const res = await crearNc(venta.id, { monto: '1000', ...extra });
      expect(res.status).toBe(400);
    });
  });

  describe('lo que el detalle ofrece (opcionesDevolucion)', () => {
    it('una opción por pago, con su método, su monto y el registro que va a quedar; sin "no vuelve plata" si no hay saldo', async () => {
      const venta = await ventaMixta();
      const { opcionesDevolucion } = await detalle(venta.id);
      expect(opcionesDevolucion).toHaveLength(2);
      const efectivo = opcionesDevolucion.find(
        (o) => o.pagoId === null || o.mueveCaja,
      )!;
      expect(efectivo).toMatchObject({
        pagoId: await pagoDe(venta.id, EFECTIVO_ID),
        sinPlata: false,
        monto: '60000.0000',
        mueveCaja: true,
        registro: 'nota_credito_sistema',
      });
      expect(efectivo.metodo).toEqual(expect.any(String));
      const tarjeta = opcionesDevolucion.find((o) => !o.mueveCaja)!;
      expect(tarjeta).toMatchObject({
        pagoId: await pagoDe(venta.id, DEBITO_ID),
        sinPlata: false,
        monto: '40000.0000',
        registro: 'nota_maquina',
      });
      expect(opcionesDevolucion.some((o) => o.sinPlata)).toBe(false);
    });

    it('"no vuelve plata" solo aparece con saldo, con lo que se debe y la nota de crédito del sistema', async () => {
      const venta = await mesaConDeuda();
      const { opcionesDevolucion } = await detalle(venta.id);
      expect(opcionesDevolucion).toHaveLength(2);
      expect(opcionesDevolucion.find((o) => o.sinPlata)).toEqual({
        pagoId: null,
        sinPlata: true,
        metodo: null,
        monto: '60000.0000',
        mueveCaja: false,
        registro: 'nota_credito_sistema',
      });
    });

    it('con facturador externo, lo debido deja una nota hecha por fuera; con nadie, una devolución interna', async () => {
      await patchFacturador('externo');
      await patchMetodo(CREDITO_ID, 'nadie');
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [
          { metodoPagoId: DEBITO_ID, monto: '40000' },
          { metodoPagoId: CREDITO_ID, monto: '10000' },
        ],
      });
      const { opcionesDevolucion } = await detalle(venta.id);
      expect(opcionesDevolucion.map((o) => o.registro).sort()).toEqual([
        'devolucion_interna',
        'nota_externa',
        'nota_maquina',
      ]);
    });

    it('lo que ofrece es lo que el servidor acepta: cada opción crea la nota con el registro que anunció', async () => {
      const venta = await mesaConDeuda();
      const { opcionesDevolucion } = await detalle(venta.id);
      const emisorDe: Record<string, string> = {
        nota_credito_sistema: 'sistema',
        nota_maquina: 'maquina',
        nota_externa: 'externo',
        devolucion_interna: 'nadie',
      };
      for (const o of opcionesDevolucion) {
        const creada = await nc(venta.id, {
          monto: '1100',
          devolucion: o.sinPlata ? { sinPlata: true } : { pagoId: o.pagoId },
        });
        expect((await docsDe(creada.id))[0].emisor).toBe(emisorDe[o.registro]);
      }
    });
  });

  describe('el reembolso por pasarela es un hecho consumado: se registra, no se rechaza', () => {
    const reembolsar = async (ventaId: string, monto: string) =>
      app.get(VentasReembolsoHandler).onReembolsoAprobado({
        tenantId: TENANT_ID,
        ordenId: randomUUID(),
        codigoOrden: 'O-E2E-CORR',
        ventaId,
        monto,
        generarNotaCredito: true,
        devoluciones: [],
        usuarioId: await usuarioIdAdmin(),
      });
    const usuarioIdAdmin = async (): Promise<string> => {
      const u: { usuario_id: string }[] = await ds.query(
        `SELECT usuario_id FROM usuarios WHERE correo = $1 AND eliminado_el IS NULL`,
        [ADMIN.email],
      );
      return u[0].usuario_id;
    };

    it('una venta online con DOS pagos (POST /ventas lo permite): la corrección existe y corrige la boleta del sistema, el único documento de la venta', async () => {
      const venta = await vender({
        canal: 'online',
        lineas: lineas100k(),
        pagos: [
          { metodoPagoId: DEBITO_ID, monto: '40000' },
          { metodoPagoId: CREDITO_ID, monto: '60000' },
        ],
      });
      const boleta = await docId(venta.id, 'sistema');
      expect(await docsDe(venta.id)).toHaveLength(1);

      const { notaCreditoId } = await reembolsar(venta.id, '5000');

      expect(notaCreditoId).toBeDefined();
      const docs = await docsDe(notaCreditoId!);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'sistema',
        monto: '5000.0000',
        documento_corregido_id: boleta,
      });
      expect(await tipoDeLaVenta(notaCreditoId!)).not.toBeNull();
      // La plata ya volvió por el proveedor: no mueve caja.
      expect(await salidasDeCaja(notaCreditoId!)).toBe(0);
    });

    it('una venta sin documentos que corregir también se registra: nota con el tipo NC y sin fila de documento', async () => {
      const venta = await vender({
        canal: 'online',
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
      });
      // El único documento de la venta deja de valer: sin documento válido, la
      // nota sale igual y el reembolso no se pierde.
      await ds.query(
        `UPDATE venta_documentos SET descarte = 'armado_sin_enviar', descartado_el = NOW()
          WHERE venta_id = $1`,
        [venta.id],
      );

      const { notaCreditoId } = await reembolsar(venta.id, '3000');

      expect(notaCreditoId).toBeDefined();
      expect(await docsDe(notaCreditoId!)).toHaveLength(0);
      expect(await tipoDeLaVenta(notaCreditoId!)).not.toBeNull();
    });

    it('una orden ligada a una corrección: no se emite una nota sobre una nota, el error trae su motivo y no queda ninguna corrección nueva', async () => {
      const venta = await ventaMixta();
      const primera = await nc(venta.id, {
        monto: '1000',
        devolucion: { pagoId: await pagoDe(venta.id, EFECTIVO_ID) },
      });

      await expect(reembolsar(primera.id, '500')).rejects.toThrow(
        /otra nota de crédito/,
      );

      const hijas: { n: number }[] = await ds.query(
        `SELECT COUNT(*)::int AS n FROM ventas WHERE venta_referencia_id = $1`,
        [primera.id],
      );
      expect(hijas[0].n).toBe(0);
    });
  });

  describe('listado y detalle: esCorreccion', () => {
    it('la NC con documento y la devolución interna son correcciones; la NC lleva el tipo y la interna no', async () => {
      const venta = await ventaMixta();
      const conTipo = await nc(venta.id, {
        monto: '1000',
        devolucion: { pagoId: await pagoDe(venta.id, DEBITO_ID) },
      });
      await patchMetodo(DEBITO_ID, 'nadie');
      const ventaNadie = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
      });
      const interna = await nc(ventaNadie.id, {
        monto: '1000',
        devolucion: { pagoId: await pagoDe(ventaNadie.id, DEBITO_ID) },
      });

      const dConTipo = await detalle(conTipo.id);
      expect(dConTipo).toMatchObject({
        esCorreccion: true,
        esNotaCredito: true,
      });
      const dInterna = await detalle(interna.id);
      expect(dInterna).toMatchObject({
        esCorreccion: true,
        esNotaCredito: false,
      });
      expect(await detalle(venta.id)).toMatchObject({
        esCorreccion: false,
        esNotaCredito: false,
      });

      const lista = await request(app.getHttpServer())
        .get('/api/ventas?pageSize=100')
        .set(auth());
      expect(lista.status).toBe(200);
      const filas = (
        lista.body as {
          data: { id: string; esCorreccion: boolean; esNotaCredito: boolean }[];
        }
      ).data;
      expect(filas.find((f) => f.id === conTipo.id)).toMatchObject({
        esCorreccion: true,
        esNotaCredito: true,
      });
      expect(filas.find((f) => f.id === interna.id)).toMatchObject({
        esCorreccion: true,
        esNotaCredito: false,
      });
    });
  });
});
