import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { OnlineCallbackHandler } from '../src/modules/online/online-callback.handler';
import type { PasarelaOrden } from '../src/modules/pasarela/entities/pasarela-orden.entity';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
const CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
const FACTURA_ID = '550e8400-e29b-41d4-a716-446655440146';
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };
// Mesa 1 y Bruno Díaz, como `combos.e2e-spec.ts` (no Ana: la sesión es única por
// garzón y Ana está vinculada a una cuenta desde el seed).
const MESA_1_ID = '550e8400-e29b-41d4-a716-446655440232';
const BRUNO = {
  garzonId: '550e8400-e29b-41d4-a716-446655440239',
  pin: '222222',
};
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

interface Documento {
  emisor: string;
  tipo_documento_id: string | null;
  clase_maquina: string | null;
  numero: string | null;
  estado_envio: string | null;
  monto: string;
  monto_afecto: string | null;
  monto_exento: string | null;
  monto_impuestos: string | null;
  pago_id: string | null;
  es_duplicado: boolean;
  tenant_id: string;
}

/**
 * Los documentos que deja cada venta al crearse (spec
 * `2026-10-01-emision-por-venta`, § 3.3; ADR-028). Los números están elegidos
 * para que discriminen (nada de 50/50): una venta de $100.000 es un servicio
 * afecto de 60.000 neto (71.400 con IVA) más uno exento de 28.600.
 *
 * ⚠️ **Los ítems son propios** (servicios, que no mueven inventario): el stock
 * sembrado lo comparten todas las suites y ya está al límite.
 *
 * Cada caso fija el emisor del medio y el facturador del comercio por la API, y
 * `afterAll` los devuelve a `'sistema'`: el seed lo comparten todas las suites.
 */
describe('Documentos de la venta (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta;
  let usuarioId: string;
  let itemAfecto60: string; // 60.000 neto → 71.400
  let itemExento: string; // 28.600
  let itemAfecto100: string; // 100.000 neto → 119.000
  let itemGratis: string;

  const patchMetodo = async (metodoPagoId: string, emisor: string) => {
    const res = await request(app.getHttpServer())
      .patch(`/api/metodos-pago/${metodoPagoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ emisor });
    expect(res.status).toBe(200);
  };
  const patchFacturador = async (facturador: string) => {
    const res = await request(app.getHttpServer())
      .patch('/api/tenants/me')
      .set('Authorization', `Bearer ${token}`)
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
      .set('Authorization', `Bearer ${token}`)
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
  const vender = async (body: Record<string, unknown>) => {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as { id: string; totalFinal: string; estado: string };
  };
  /** La venta de $100.000: 60.000 neto afecto + 28.600 exento. */
  const lineas100k = () => [
    { itemId: itemAfecto60, cantidad: '1' },
    { itemId: itemExento, cantidad: '1' },
  ];
  const documentosDe = async (ventaId: string): Promise<Documento[]> =>
    ds.query(
      `SELECT emisor, tipo_documento_id, clase_maquina, numero, estado_envio,
              monto, monto_afecto, monto_exento, monto_impuestos, pago_id,
              es_duplicado, tenant_id
         FROM venta_documentos
        WHERE venta_id = $1 AND eliminado_el IS NULL
        ORDER BY emisor, monto`,
      [ventaId],
    );
  const pagoDe = async (
    ventaId: string,
    metodoPagoId: string,
  ): Promise<string> => {
    const rows: { pago_id: string }[] = await ds.query(
      `SELECT pago_id FROM pagos
        WHERE venta_id = $1 AND metodo_pago_id = $2 AND eliminado_el IS NULL`,
      [ventaId, metodoPagoId],
    );
    expect(rows).toHaveLength(1);
    return rows[0].pago_id;
  };
  const suma = (docs: Documento[]) =>
    docs.reduce((a, d) => a + Number(d.monto), 0);

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

    const u: { usuario_id: string }[] = await ds.query(
      `SELECT usuario_id FROM usuarios WHERE correo = $1 AND eliminado_el IS NULL`,
      [ADMIN.email],
    );
    usuarioId = u[0].usuario_id;

    itemAfecto60 = await crearItem('Doc afecto 60k E2E', '60000', 'afecto');
    itemExento = await crearItem('Doc exento E2E', '28600', 'exento');
    itemAfecto100 = await crearItem('Doc afecto 100k E2E', '100000', 'afecto');
    itemGratis = await crearItem('Doc gratis E2E', '0', 'exento');

    caja = await abrirCaja(app, token, { saldoInicial: '10000.0000' });
  }, 60000);

  afterAll(async () => {
    // El seed lo comparten todas las suites: vuelve a como estaba, pase lo que pase.
    try {
      await patchFacturador('sistema');
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
    // Cada caso parte de la configuración que declara el comercio nuevo (E3, E9)
    // y fija solo lo que prueba.
    await patchFacturador('sistema');
    await patchMetodo(DEBITO_ID, 'maquina');
    await patchMetodo(CREDITO_ID, 'maquina');
  });

  describe('boleta', () => {
    it('efectivo $60.000 (sistema) + débito $40.000 (máquina) con número: boleta del sistema + voucher', async () => {
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [
          {
            metodoPagoId: EFECTIVO_ID,
            monto: '60000',
            // Se ignora sin error: el efectivo lo documenta el sistema.
            numeroDocumento: 'NO-DEBE-QUEDAR',
            claseDocumento: 'boleta',
          },
          {
            metodoPagoId: DEBITO_ID,
            monto: '40000',
            numeroDocumento: '445566',
            claseDocumento: 'voucher',
          },
        ],
      });
      expect(venta.totalFinal).toBe('100000.0000');
      expect(venta.estado).toBe('pagada');

      const docs = await documentosDe(venta.id);
      expect(docs).toHaveLength(2);
      const maquina = docs.find((d) => d.emisor === 'maquina')!;
      const sistema = docs.find((d) => d.emisor === 'sistema')!;
      expect(maquina).toMatchObject({
        tenant_id: TENANT_ID,
        tipo_documento_id: null,
        numero: '445566',
        clase_maquina: 'voucher',
        monto: '40000.0000',
        estado_envio: null,
        monto_afecto: null,
        es_duplicado: false,
      });
      expect(maquina.pago_id).toBe(await pagoDe(venta.id, DEBITO_ID));
      expect(sistema).toMatchObject({
        tenant_id: TENANT_ID,
        tipo_documento_id: BOLETA_ID,
        estado_envio: 'armado',
        numero: null,
        clase_maquina: null,
        monto: '60000.0000',
        // 60.000 de 100.000 a prorrata: 42.840 afecto (36.000 + IVA 6.840) y 17.160 exento.
        monto_afecto: '36000.0000',
        monto_exento: '17160.0000',
        monto_impuestos: '6840.0000',
        pago_id: null,
      });
      expect(suma(docs)).toBe(100000);
    });

    it('mesa: $40.000 con tarjeta (máquina) y $60.000 sin pagar: voucher y boleta del sistema por lo debido', async () => {
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '40000' }],
      });
      expect(venta.estado).toBe('pagada_parcial');

      const docs = await documentosDe(venta.id);
      expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
        ['maquina', '40000.0000'],
        ['sistema', '60000.0000'],
      ]);
      expect(docs[1]).toMatchObject({
        tipo_documento_id: BOLETA_ID,
        estado_envio: 'armado',
      });
      expect(docs[0].numero).toBeNull();
      expect(suma(docs)).toBe(100000);
    });

    it('la mesa que debe $60.000 con facturador externo: voucher + externo con el tipo boleta y sin número', async () => {
      await patchFacturador('externo');
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '40000' }],
      });

      const docs = await documentosDe(venta.id);
      expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
        ['externo', '60000.0000'],
        ['maquina', '40000.0000'],
      ]);
      expect(docs[0]).toMatchObject({
        tipo_documento_id: BOLETA_ID,
        numero: null,
        estado_envio: null,
        monto_afecto: '36000.0000',
        monto_exento: '17160.0000',
        monto_impuestos: '6840.0000',
      });
      expect(suma(docs)).toBe(100000);
    });

    it('boleta pendiente sin pagos: boleta del sistema por el total, con sus baldes', async () => {
      const venta = await vender({ lineas: lineas100k() });
      expect(venta.estado).toBe('pendiente');

      const docs = await documentosDe(venta.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'sistema',
        tipo_documento_id: BOLETA_ID,
        estado_envio: 'armado',
        monto: '100000.0000',
        monto_afecto: '60000.0000',
        monto_exento: '28600.0000',
        monto_impuestos: '11400.0000',
      });
    });

    it('con facturador externo, la boleta pendiente sin pagos queda en un externo', async () => {
      await patchFacturador('externo');
      const venta = await vender({ lineas: lineas100k() });

      const docs = await documentosDe(venta.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'externo',
        tipo_documento_id: BOLETA_ID,
        numero: null,
        monto: '100000.0000',
      });
    });

    it('un medio en "nadie" deja una fila nadie, sin tipo ni baldes', async () => {
      await patchMetodo(DEBITO_ID, 'nadie');
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
      });

      const docs = await documentosDe(venta.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'nadie',
        tipo_documento_id: null,
        monto: '100000.0000',
        monto_afecto: null,
        estado_envio: null,
        pago_id: null,
      });
    });

    it('con propina, los documentos suman lo aplicado a la venta, sin la propina', async () => {
      // La propina se descuenta primero de los medios sin vuelto: sale del débito.
      const venta = await vender({
        lineas: lineas100k(),
        propinaDirecta: { montoPagado: '5000' },
        pagos: [
          { metodoPagoId: EFECTIVO_ID, monto: '60000' },
          { metodoPagoId: DEBITO_ID, monto: '45000' },
        ],
      });
      expect(venta.totalFinal).toBe('100000.0000');

      const docs = await documentosDe(venta.id);
      expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
        ['maquina', '40000.0000'],
        ['sistema', '60000.0000'],
      ]);
      expect(suma(docs)).toBe(100000);
    });
  });

  describe('salones: cierre de cuenta (POST /cuentas/:id/cerrar)', () => {
    afterAll(async () => {
      await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${token}`)
        .send(BRUNO);
    });

    it('pago mixto con propina: los documentos suman lo aplicado a la venta, sin la propina', async () => {
      // Cierra una sesión que haya dejado una corrida local anterior.
      await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${token}`)
        .send(BRUNO);
      const sesion = await request(app.getHttpServer())
        .post('/api/sesiones-garzon/iniciar')
        .set('Authorization', `Bearer ${token}`)
        .send({ ...BRUNO, turnoId: TURNO_MANANA_ID });
      expect(sesion.status).toBe(201);

      const cuenta = await request(app.getHttpServer())
        .post(`/api/mesas/${MESA_1_ID}/cuentas`)
        .set('Authorization', `Bearer ${token}`)
        .send(BRUNO);
      expect(cuenta.status).toBe(201);
      const cuentaId = (cuenta.body as { id: string }).id;

      for (const itemId of [itemAfecto60, itemExento]) {
        const linea = await request(app.getHttpServer())
          .post(`/api/cuentas/${cuentaId}/lineas`)
          .set('Authorization', `Bearer ${token}`)
          .send({ itemId, cantidad: '1' });
        expect(linea.status).toBe(201);
      }

      // 100.000 de cuenta + 5.000 de propina. La propina sale primero de los
      // medios sin vuelto (el débito): el débito aplica 40.000 a la venta.
      const cierre = await request(app.getHttpServer())
        .post(`/api/cuentas/${cuentaId}/cerrar`)
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          ...BRUNO,
          propinaMonto: '5000',
          pagos: [
            { metodoPagoId: EFECTIVO_ID, monto: '60000' },
            {
              metodoPagoId: DEBITO_ID,
              monto: '45000',
              numeroDocumento: '998877',
              claseDocumento: 'boleta',
            },
          ],
        });
      expect(cierre.status).toBe(201);
      const ventaId = (cierre.body as { ventaId: string }).ventaId;

      const docs = await documentosDe(ventaId);
      expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
        ['maquina', '40000.0000'],
        ['sistema', '60000.0000'],
      ]);
      expect(docs[0]).toMatchObject({
        numero: '998877',
        clase_maquina: 'boleta',
      });
      expect(docs[1]).toMatchObject({
        tipo_documento_id: BOLETA_ID,
        monto_afecto: '36000.0000',
        monto_exento: '17160.0000',
        monto_impuestos: '6840.0000',
      });
      expect(suma(docs)).toBe(100000);
    });
  });

  describe('factura', () => {
    it('de $119.000 pagada con tarjeta (máquina): un solo documento, del sistema', async () => {
      const venta = await vender({
        tipoDocumentoId: FACTURA_ID,
        lineas: [{ itemId: itemAfecto100, cantidad: '1' }],
        pagos: [
          {
            metodoPagoId: DEBITO_ID,
            monto: '119000',
            numeroDocumento: '777',
          },
        ],
      });
      expect(venta.totalFinal).toBe('119000.0000');

      const docs = await documentosDe(venta.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'sistema',
        tipo_documento_id: FACTURA_ID,
        estado_envio: 'armado',
        monto: '119000.0000',
        monto_afecto: '100000.0000',
        monto_exento: '0.0000',
        monto_impuestos: '19000.0000',
        numero: null,
        pago_id: null,
      });
    });

    it('con facturador externo: un solo documento externo con el tipo factura y sin número', async () => {
      await patchFacturador('externo');
      const venta = await vender({
        tipoDocumentoId: FACTURA_ID,
        lineas: [{ itemId: itemAfecto100, cantidad: '1' }],
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '119000' }],
      });

      const docs = await documentosDe(venta.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'externo',
        tipo_documento_id: FACTURA_ID,
        numero: null,
        estado_envio: null,
        monto: '119000.0000',
        monto_impuestos: '19000.0000',
      });
    });

    it('una factura sin pagos igual lleva su documento por el total (E2)', async () => {
      const venta = await vender({
        tipoDocumentoId: FACTURA_ID,
        lineas: [{ itemId: itemAfecto100, cantidad: '1' }],
      });
      const docs = await documentosDe(venta.id);
      expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
        ['sistema', '119000.0000'],
      ]);
    });
  });

  describe('online', () => {
    it('con el crédito en máquina: documento del sistema por el total, sin mirar el medio', async () => {
      const venta = await vender({
        canal: 'online',
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: CREDITO_ID, monto: '100000' }],
      });

      const docs = await documentosDe(venta.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'sistema',
        tipo_documento_id: BOLETA_ID,
        estado_envio: 'armado',
        monto: '100000.0000',
        pago_id: null,
      });
    });

    it('la venta que crea el retorno de Webpay deja el código de autorización en pagos.referencia', async () => {
      const handler = app.get(OnlineCallbackHandler, { strict: false });
      const orden = {
        ordenId: randomUUID(),
        tenantId: TENANT_ID,
        estado: 'pagada',
        ventaId: null,
        metadata: {
          origenApp: 'tienda-online',
          checkout: {
            lineas: [{ itemId: itemAfecto60, cantidad: '1' }],
            metodoCreditoId: CREDITO_ID,
            metodoDebitoId: null,
            totalFinal: '71400.0000',
            usuarioId,
            customerNombre: 'cliente@e2e.cl',
          },
          resultadoPago: {
            tipoPago: 'VN',
            numeroCuotas: 0,
            tarjetaUltimos4: '6623',
            codigoRespuesta: '0',
            codigoAutorizacion: '1213',
          },
        },
      } as unknown as PasarelaOrden;

      await handler.onOrdenResuelta(orden);

      expect(orden.ventaId).toBeTruthy();
      const pagos: { referencia: string | null }[] = await ds.query(
        `SELECT referencia FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [orden.ventaId],
      );
      expect(pagos).toEqual([{ referencia: '1213' }]);
      const docs = await documentosDe(orden.ventaId!);
      expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
        ['sistema', '71400.0000'],
      ]);
    });
  });

  describe('venta de $0', () => {
    it('no lleva documento (E6)', async () => {
      const venta = await vender({
        lineas: [{ itemId: itemGratis, cantidad: '1' }],
      });
      expect(venta.totalFinal).toBe('0.0000');
      expect(await documentosDe(venta.id)).toEqual([]);
    });

    it('tampoco la online de $0', async () => {
      const venta = await vender({
        canal: 'online',
        lineas: [{ itemId: itemGratis, cantidad: '1' }],
      });
      expect(await documentosDe(venta.id)).toEqual([]);
    });
  });

  describe('el cliente nunca manda quién emitió', () => {
    it('un campo "emisor" en el pago se rechaza con 400 y no crea la venta', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: lineas100k(),
          pagos: [
            { metodoPagoId: EFECTIVO_ID, monto: '100000', emisor: 'nadie' },
          ],
        });
      expect(res.status).toBe(400);
    });

    it.each([
      ['un salto de línea', '12\n34'],
      ['un NUL', '12\u000034'],
    ])(
      'un número con %s se rechaza con 400 (no con un 500 de la base) y no crea la venta',
      async (_n, numeroDocumento) => {
        const antes: { n: string }[] = await ds.query(
          `SELECT COUNT(*) AS n FROM ventas WHERE tenant_id = $1`,
          [TENANT_ID],
        );
        const res = await request(app.getHttpServer())
          .post('/api/ventas')
          .set('Idempotency-Key', randomUUID())
          .set('Authorization', `Bearer ${token}`)
          .send({
            lineas: lineas100k(),
            pagos: [
              { metodoPagoId: DEBITO_ID, monto: '100000', numeroDocumento },
            ],
          });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain('numeroDocumento');
        const despues: { n: string }[] = await ds.query(
          `SELECT COUNT(*) AS n FROM ventas WHERE tenant_id = $1`,
          [TENANT_ID],
        );
        expect(despues[0].n).toBe(antes[0].n);
      },
    );

    it('una clase fuera de voucher/boleta se rechaza con 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: lineas100k(),
          pagos: [
            {
              metodoPagoId: DEBITO_ID,
              monto: '100000',
              claseDocumento: 'factura',
            },
          ],
        });
      expect(res.status).toBe(400);
    });
  });

  describe('el abono de una deuda ya documentada (E1, E1b)', () => {
    const abonar = async (
      ventaId: string,
      pago: Record<string, unknown>,
      esperado = 201,
    ) => {
      const res = await request(app.getHttpServer())
        .post('/api/pagos')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({ ventaId, pagos: [pago] });
      expect(res.status).toBe(esperado);
      return res.body as { venta: { estado: string; saldo: string } };
    };
    /** La mesa de $100.000 que paga $40.000 con tarjeta y se va debiendo $60.000. */
    const mesaConDeuda = async (facturaOBoleta: 'boleta' | 'factura') => {
      const venta =
        facturaOBoleta === 'boleta'
          ? await vender({
              lineas: lineas100k(),
              pagos: [{ metodoPagoId: DEBITO_ID, monto: '40000' }],
            })
          : await vender({
              tipoDocumentoId: FACTURA_ID,
              lineas: [{ itemId: itemAfecto100, cantidad: '1' }],
              pagos: [{ metodoPagoId: DEBITO_ID, monto: '19000' }],
            });
      expect(venta.estado).toBe('pagada_parcial');
      return venta;
    };

    it('la mesa que debe $60.000 paga en efectivo al día siguiente: ningún documento nuevo', async () => {
      const venta = await mesaConDeuda('boleta');
      const antes = await documentosDe(venta.id);
      expect(antes.map((d) => [d.emisor, d.monto])).toEqual([
        ['maquina', '40000.0000'],
        ['sistema', '60000.0000'],
      ]);

      const res = await abonar(venta.id, {
        metodoPagoId: EFECTIVO_ID,
        monto: '60000',
      });
      expect(res.venta.estado).toBe('pagada');

      expect(await documentosDe(venta.id)).toEqual(antes);
    });

    it('un medio del sistema y uno de nadie tampoco documentan el abono', async () => {
      await patchMetodo(CREDITO_ID, 'sistema');
      await patchMetodo(DEBITO_ID, 'nadie');
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '40000' }],
      });
      const antes = await documentosDe(venta.id);
      expect(antes).toHaveLength(1); // la boleta del sistema por los $100.000 (efectivo + lo debido)

      await abonar(venta.id, {
        metodoPagoId: CREDITO_ID,
        monto: '25000',
        numeroDocumento: 'IGNORADO',
      });
      await abonar(venta.id, { metodoPagoId: DEBITO_ID, monto: '35000' });

      expect(await documentosDe(venta.id)).toEqual(antes);
    });

    it('la misma deuda pagada con tarjeta en la máquina: un duplicado marcado, con su pago y su número; el cobro pasa', async () => {
      const venta = await mesaConDeuda('boleta');

      const res = await abonar(venta.id, {
        metodoPagoId: CREDITO_ID,
        monto: '60000',
        numeroDocumento: '990011',
        claseDocumento: 'boleta',
      });
      expect(res.venta).toMatchObject({ estado: 'pagada', saldo: '0.0000' });

      const docs = await documentosDe(venta.id);
      expect(docs).toHaveLength(3);
      const duplicado = docs.find((d) => d.es_duplicado)!;
      expect(duplicado).toMatchObject({
        tenant_id: TENANT_ID,
        emisor: 'maquina',
        tipo_documento_id: null,
        clase_maquina: 'boleta',
        numero: '990011',
        estado_envio: null,
        monto: '60000.0000',
        monto_afecto: null,
        monto_exento: null,
        monto_impuestos: null,
      });
      expect(duplicado.pago_id).toBe(await pagoDe(venta.id, CREDITO_ID));
      // No cuenta para la cobertura: lo que no es duplicado sigue sumando el total.
      expect(suma(docs.filter((d) => !d.es_duplicado))).toBe(100000);
      expect(docs.filter((d) => d.es_duplicado)).toHaveLength(1);
    });

    it('sin número ni clase el duplicado queda con ambos nulos', async () => {
      const venta = await mesaConDeuda('boleta');
      await abonar(venta.id, { metodoPagoId: CREDITO_ID, monto: '60000' });
      const duplicado = (await documentosDe(venta.id)).find(
        (d) => d.es_duplicado,
      )!;
      expect(duplicado.numero).toBeNull();
      expect(duplicado.clase_maquina).toBeNull();
    });

    it('factura con abono en efectivo: ningún documento nuevo; con tarjeta en la máquina: un duplicado', async () => {
      const venta = await mesaConDeuda('factura');
      const antes = await documentosDe(venta.id);
      expect(antes.map((d) => [d.emisor, d.monto])).toEqual([
        ['sistema', '119000.0000'],
      ]);
      // Es la factura: el test mide lo que su título promete.
      expect(antes[0].tipo_documento_id).toBe(FACTURA_ID);

      await abonar(venta.id, { metodoPagoId: EFECTIVO_ID, monto: '50000' });
      expect(await documentosDe(venta.id)).toEqual(antes);

      await abonar(venta.id, { metodoPagoId: DEBITO_ID, monto: '50000' });
      const docs = await documentosDe(venta.id);
      expect(docs.map((d) => [d.emisor, d.monto, d.es_duplicado])).toEqual([
        ['maquina', '50000.0000', true],
        ['sistema', '119000.0000', false],
      ]);
      expect(docs.find((d) => d.emisor === 'sistema')!.tipo_documento_id).toBe(
        FACTURA_ID,
      );
    });

    it('un abono con un número con salto de línea se rechaza con 400 y no registra el pago', async () => {
      const venta = await mesaConDeuda('boleta');
      const res = await request(app.getHttpServer())
        .post('/api/pagos')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          ventaId: venta.id,
          pagos: [
            {
              metodoPagoId: CREDITO_ID,
              monto: '60000',
              numeroDocumento: '12\n34',
            },
          ],
        });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('numeroDocumento');
      expect(await documentosDe(venta.id)).toHaveLength(2);
    });
  });

  describe('anular mira lo emitido (E8, E10)', () => {
    interface Descarte {
      emisor: string;
      descarte: string | null;
      descartado_el: Date | null;
      descartado_por_usuario_id: string | null;
      numero: string | null;
      eliminado_el: Date | null;
    }
    const descartesDe = async (ventaId: string): Promise<Descarte[]> =>
      ds.query(
        // Sin filtrar `eliminado_el` a propósito: el test afirma que anular NO borra.
        `SELECT emisor, descarte, descartado_el, descartado_por_usuario_id,
                numero, eliminado_el
           FROM venta_documentos
          WHERE venta_id = $1
          ORDER BY emisor, monto`,
        [ventaId],
      );
    const estadoDe = async (ventaId: string): Promise<string> => {
      const r: { estado: string }[] = await ds.query(
        `SELECT estado FROM ventas WHERE venta_id = $1`,
        [ventaId],
      );
      return r[0].estado;
    };
    const anular = (ventaId: string, extra: Record<string, unknown> = {}) =>
      request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Se ingresó por error en la caja', ...extra });
    const pendienteDeFactura = () =>
      vender({
        tipoDocumentoId: FACTURA_ID,
        lineas: [{ itemId: itemAfecto100, cantidad: '1' }],
      });
    const MENSAJE_PIDE_RESPUESTA =
      'Esta venta tiene un documento hecho por fuera: falta decir si ya lo hiciste en tu facturador.';
    const MENSAJE_YA_HECHO =
      'Ya está hecho: se revierte con una nota de crédito, hecha por fuera y anotada con su número.';

    it('boleta pendiente sin pagos: se anula y su boleta queda descartada, con el usuario y la hora, sin borrar la fila (E8)', async () => {
      const venta = await vender({ lineas: lineas100k() });
      const otra = await vender({ lineas: lineas100k() });

      const res = await anular(venta.id);
      expect(res.status).toBe(201);
      expect(await estadoDe(venta.id)).toBe('cancelada');

      const docs = await descartesDe(venta.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'sistema',
        descarte: 'armado_sin_enviar',
        descartado_por_usuario_id: usuarioId,
        eliminado_el: null,
      });
      expect(docs[0].descartado_el).toBeInstanceOf(Date);
      // El descarte de una venta no toca los documentos de otra.
      expect((await descartesDe(otra.id))[0].descarte).toBeNull();
    });

    it('factura del sistema sin pagos: se anula y queda descartada', async () => {
      const venta = await pendienteDeFactura();
      expect((await anular(venta.id)).status).toBe(201);
      const docs = await descartesDe(venta.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({
        emisor: 'sistema',
        descarte: 'armado_sin_enviar',
        descartado_por_usuario_id: usuarioId,
      });
    });

    it('un documento descartado ya no cuenta como vigente: no se lista entre los documentos de la venta', async () => {
      const venta = await pendienteDeFactura();
      await anular(venta.id);
      // `documentosDe` solo filtra `eliminado_el`: el descarte lo distingue la columna.
      const vigentes: { n: string }[] = await ds.query(
        `SELECT COUNT(*) AS n FROM venta_documentos
          WHERE venta_id = $1 AND descarte IS NULL AND eliminado_el IS NULL`,
        [venta.id],
      );
      expect(vigentes[0].n).toBe('0');
    });

    describe('factura hecha por fuera (externo)', () => {
      beforeEach(() => patchFacturador('externo'));

      it('sin externoHecho: 400 que pide la respuesta, y no se anula ni se descarta nada', async () => {
        const venta = await pendienteDeFactura();
        const res = await anular(venta.id);
        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toBe(
          MENSAJE_PIDE_RESPUESTA,
        );
        expect(await estadoDe(venta.id)).toBe('pendiente');
        expect((await descartesDe(venta.id))[0].descarte).toBeNull();
      });

      it('externoHecho true: 400 (va por nota de crédito) y no se anula', async () => {
        const venta = await pendienteDeFactura();
        const res = await anular(venta.id, { externoHecho: true });
        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toBe(
          MENSAJE_YA_HECHO,
        );
        expect(await estadoDe(venta.id)).toBe('pendiente');
        expect((await descartesDe(venta.id))[0].descarte).toBeNull();
      });

      it('externoHecho false: se anula y el externo queda afirmado_no_hecho, con el usuario y la hora', async () => {
        const venta = await pendienteDeFactura();
        const res = await anular(venta.id, { externoHecho: false });
        expect(res.status).toBe(201);
        expect(await estadoDe(venta.id)).toBe('cancelada');
        const docs = await descartesDe(venta.id);
        expect(docs).toHaveLength(1);
        expect(docs[0]).toMatchObject({
          emisor: 'externo',
          descarte: 'afirmado_no_hecho',
          descartado_por_usuario_id: usuarioId,
          eliminado_el: null,
        });
        expect(docs[0].descartado_el).toBeInstanceOf(Date);
      });

      it('con el número anotado: 400 aunque venga externoHecho false (el número salió del otro facturador)', async () => {
        const venta = await pendienteDeFactura();
        // El número lo anota la tarea 6 (PATCH) o una integración futura; acá se
        // anota por SQL para fijar el efecto de la regla, no el camino que lo escribe.
        await ds.query(
          `UPDATE venta_documentos SET numero = 'F-98123' WHERE venta_id = $1`,
          [venta.id],
        );
        for (const externoHecho of [false, true, undefined]) {
          const res = await anular(venta.id, { externoHecho });
          expect(res.status).toBe(400);
          expect((res.body as { message: string }).message).toBe(
            MENSAJE_YA_HECHO,
          );
        }
        expect(await estadoDe(venta.id)).toBe('pendiente');
        expect((await descartesDe(venta.id))[0].descarte).toBeNull();
      });

      it('externoHecho null se rechaza con 400 por el pipe real y la venta no se anula', async () => {
        const venta = await pendienteDeFactura();
        const res = await anular(venta.id, { externoHecho: null });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain('externoHecho');
        expect(await estadoDe(venta.id)).toBe('pendiente');
        expect((await descartesDe(venta.id))[0].descarte).toBeNull();
      });

      it('un externoHecho que no es booleano se rechaza con 400', async () => {
        const venta = await pendienteDeFactura();
        const res = await anular(venta.id, { externoHecho: 'no' });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain('externoHecho');
      });
    });

    describe('lo que ya emitió alguien bloquea', () => {
      // Hoy no hay forma de llegar a esto por la API: una venta con un documento
      // de la máquina tiene pagos, y los pagos ya impiden anular, y ningún
      // documento del sistema está enviado porque no hay envío. Se arma el dato
      // por SQL para fijar que la regla lee la tabla real; los datos que lo
      // producirán (la integración, el PATCH de la tarea 6) llegan después.
      const insertar = async (
        ventaId: string,
        emisor: string,
        estadoEnvio: string | null,
      ) =>
        ds.query(
          `INSERT INTO venta_documentos
             (tenant_id, venta_id, emisor, estado_envio, monto)
           VALUES ($1, $2, $3, $4, 1000)`,
          [TENANT_ID, ventaId, emisor, estadoEnvio],
        );

      it('un documento de la máquina: 400 con nota de crédito, y no se anula', async () => {
        const venta = await vender({ lineas: lineas100k() });
        await insertar(venta.id, 'maquina', null);
        const res = await anular(venta.id);
        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toMatch(
          /máquina de tarjeta.*nota de crédito/,
        );
        expect(await estadoDe(venta.id)).toBe('pendiente');
        // Ni siquiera la boleta del sistema, que sola sí se descartaría.
        expect(
          (await descartesDe(venta.id)).every((d) => d.descarte === null),
        ).toBe(true);
      });

      it('un documento del sistema ya enviado: 400, y no se anula', async () => {
        const venta = await vender({ lineas: lineas100k() });
        await ds.query(
          `UPDATE venta_documentos SET estado_envio = 'enviado' WHERE venta_id = $1`,
          [venta.id],
        );
        const res = await anular(venta.id);
        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toMatch(
          /enviado al SII.*nota de crédito/,
        );
        expect(await estadoDe(venta.id)).toBe('pendiente');
      });
    });

    it('una venta con pagos sigue sin anularse (queda pagada_parcial) y sus documentos quedan vigentes', async () => {
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '40000' }],
      });
      const res = await anular(venta.id);
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toMatch(
        /Solo se anula una venta pendiente/,
      );
      expect(
        (await descartesDe(venta.id)).every((d) => d.descarte === null),
      ).toBe(true);
    });
  });

  describe('el esquema', () => {
    it('las columnas cerradas chocan con su CHECK', async () => {
      const filas: { documento_id: string }[] = await ds.query(
        `SELECT documento_id FROM venta_documentos WHERE tenant_id = $1 LIMIT 1`,
        [TENANT_ID],
      );
      expect(filas.length).toBe(1);
      for (const [col, valor, chk] of [
        ['emisor', 'otro', 'chk_venta_documentos_emisor'],
        ['clase_maquina', 'otra', 'chk_venta_documentos_clase_maquina'],
        ['estado_envio', 'otro', 'chk_venta_documentos_estado_envio'],
        ['descarte', 'otro', 'chk_venta_documentos_descarte'],
      ]) {
        await expect(
          ds.query(
            `UPDATE venta_documentos SET ${col} = $1 WHERE documento_id = $2`,
            [valor, filas[0].documento_id],
          ),
        ).rejects.toThrow(new RegExp(chk));
      }
    });
  });
});
