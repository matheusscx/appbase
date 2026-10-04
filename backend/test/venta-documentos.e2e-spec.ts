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
import { loginSegundoTenant } from './helpers/segundo-tenant';
import { TokensAccesoService } from '../src/modules/auth/tokens-acceso.service';
import { TipoTokenAcceso } from '../src/modules/auth/entities/token-acceso.entity';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
const CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
const FACTURA_ID = '550e8400-e29b-41d4-a716-446655440146';
// La Factura es `customer_requerido` en el seed: la venta tiene que traerlo.
// El receptor completo que la Factura chilena exige (SII, Formato DTE).
const RECEPTOR = {
  nombre: 'Comercial Andes SpA',
  rut: '76.123.456-0',
  giro: 'Venta de artículos de ferretería',
  direccion: 'Av. Matta 1234',
  comuna: 'Santiago',
};
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };
// `Ventas:Leer` + `Ventas:Crear` y sin `Cajas:Leer` (rol Vendedor): ve solo lo de su caja.
const VENDEDOR = { email: 'vendedor@paris.cl', password: 'admin' };
// Mesa 1 y Bruno Díaz, como `combos.e2e-spec.ts` (no Ana: la sesión es única por
// garzón y Ana está vinculada a una cuenta desde el seed).
const MESA_1_ID = '550e8400-e29b-41d4-a716-446655440232';
const BRUNO = {
  garzonId: '550e8400-e29b-41d4-a716-446655440239',
  pin: '222222',
};
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
// "Directo": descuento de valor plano sin condiciones (`seedTiposRegla`).
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const TIPO_RECARGO_GENERAL = '550e8400-e29b-41d4-a716-446655440122';

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
  let item5000: string; // 5.000 con IVA incluido: 4.202 neto
  // 5.000 con IVA incluido y una promo del 99,99 %, que redondea a $0. La del
  // 100 % ya no se puede crear ("Topar la promo bajo 100 %", owner, 2026-10-04).
  let itemPromo100: string;

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
    precioIncluyeImpuesto = false,
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
        precioIncluyeImpuesto,
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
  /** El id del único documento vigente de ese emisor en la venta. */
  const docIdDe = async (ventaId: string, emisor: string): Promise<string> => {
    const rows: { documento_id: string }[] = await ds.query(
      `SELECT documento_id FROM venta_documentos
        WHERE venta_id = $1 AND emisor = $2 AND eliminado_el IS NULL`,
      [ventaId, emisor],
    );
    expect(rows).toHaveLength(1);
    return rows[0].documento_id;
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
    item5000 = await crearItem('Doc 5000 E2E', '5000', 'afecto', true);
    itemPromo100 = await crearItem(
      'Doc promo 9999 E2E',
      '5000',
      'afecto',
      true,
    );
    // La promo se acota a su ítem propio: no toca a nadie más del seed.
    const promo = await request(app.getHttpServer())
      .post('/api/promociones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Doc promo 9999 E2E ${Date.now()}`,
        tipo: 'porcentaje',
        fechaInicio: '2020-01-01',
        fechaFin: '2035-12-31',
        valorPorcentaje: '0.9999',
        scopes: [{ tipoScope: 'items', itemIds: [itemPromo100] }],
      });
    expect(promo.status).toBe(201);

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

    it('una cuenta que una promo del 99,99 % dejó en $0 cierra con la boleta del sistema por $0', async () => {
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
      const linea = await request(app.getHttpServer())
        .post(`/api/cuentas/${cuentaId}/lineas`)
        .set('Authorization', `Bearer ${token}`)
        .send({ itemId: itemPromo100, cantidad: '1' });
      expect(linea.status).toBe(201);

      const cierre = await request(app.getHttpServer())
        .post(`/api/cuentas/${cuentaId}/cerrar`)
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({ ...BRUNO, pagos: [] });
      expect(cierre.status).toBe(201);
      const docs = await documentosDe(
        (cierre.body as { ventaId: string }).ventaId,
      );
      expect(docs.map((d) => [d.emisor, d.tipo_documento_id, d.monto])).toEqual(
        [['sistema', BOLETA_ID, '0.0000']],
      );
    });

    // `customer_requerido` (Factura): el cierre fija el tipo por el body igual que
    // el POS y pasa por la misma validación. El 400 deja la cuenta abierta, y la
    // misma cuenta cierra cuando el customer llega.
    it('factura sin customer: 400 y la cuenta sigue abierta; con customer cierra con la factura', async () => {
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
      const linea = await request(app.getHttpServer())
        .post(`/api/cuentas/${cuentaId}/lineas`)
        .set('Authorization', `Bearer ${token}`)
        .send({ itemId: itemAfecto100, cantidad: '1' });
      expect(linea.status).toBe(201);

      const cerrar = (extra: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post(`/api/cuentas/${cuentaId}/cerrar`)
          .set('Idempotency-Key', randomUUID())
          .set('Authorization', `Bearer ${token}`)
          .send({
            ...BRUNO,
            tipoDocumentoId: FACTURA_ID,
            pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '119000' }],
            ...extra,
          });
      const estadoCuenta = async () => {
        const rows: { estado: string; venta_id: string | null }[] =
          await ds.query(
            `SELECT estado, venta_id FROM cuentas WHERE cuenta_id = $1`,
            [cuentaId],
          );
        return rows[0];
      };

      const sinCustomer = await cerrar({});
      expect(sinCustomer.status).toBe(400);
      expect((sinCustomer.body as { message: string }).message).toBe(
        'Este tipo de documento requiere los datos del cliente',
      );
      expect(await estadoCuenta()).toEqual({
        estado: 'abierta',
        venta_id: null,
      });

      const comoArray = await cerrar({ customer: [] });
      expect(comoArray.status).toBe(400);
      expect(JSON.stringify(comoArray.body)).toContain('customer');
      expect(await estadoCuenta()).toEqual({
        estado: 'abierta',
        venta_id: null,
      });

      const conCustomer = await cerrar({ customer: RECEPTOR });
      expect(conCustomer.status).toBe(201);
      const ventaId = (conCustomer.body as { ventaId: string }).ventaId;
      const venta: { tipo_documento_id: string }[] = await ds.query(
        `SELECT tipo_documento_id FROM ventas WHERE venta_id = $1`,
        [ventaId],
      );
      expect(venta[0].tipo_documento_id).toBe(FACTURA_ID);
      expect((await estadoCuenta()).venta_id).toBe(ventaId);
    });
  });

  describe('factura', () => {
    it('de $119.000 pagada con tarjeta (máquina): un solo documento, del sistema', async () => {
      const venta = await vender({
        tipoDocumentoId: FACTURA_ID,
        customer: RECEPTOR,
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
        customer: RECEPTOR,
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
        customer: RECEPTOR,
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

  // Res. Ex. SII 60/2023, resolutivo 1°: si el total es $0 "como resultado de la
  // aplicación de descuentos o alguna otra condición de venta", la boleta se
  // emite igual, informando el descuento (que la venta ya congeló en sus líneas).
  describe('venta de $0', () => {
    const crearDescuento = async (body: Record<string, unknown>) => {
      const res = await request(app.getHttpServer())
        .post('/api/descuentos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Doc cero E2E ${randomUUID()}`,
          tipoReglaId: TIPO_DESCUENTO_DIRECTO,
          activo: true,
          ...body,
        });
      expect(res.status).toBe(201);
      return (res.body as { id: string }).id;
    };
    const porcentaje = (valorPorcentaje: string) =>
      crearDescuento({ modo: 'porcentaje', valorPorcentaje });

    /** La boleta del sistema por $0, con los baldes en 0. */
    const BOLETA_CERO = {
      emisor: 'sistema',
      tipo_documento_id: BOLETA_ID,
      estado_envio: 'armado',
      monto: '0.0000',
      monto_afecto: '0.0000',
      monto_exento: '0.0000',
      monto_impuestos: '0.0000',
    };

    it.each([
      [
        'dos descuentos de 60 %',
        async () => [await porcentaje('0.6'), await porcentaje('0.6')],
      ],
      [
        'un descuento de 99,99 % que redondea a $0',
        async () => [await porcentaje('0.9999')],
      ],
      [
        'un descuento fijo de $9.000 topeado por el piso en cero',
        async () => [
          await crearDescuento({ modo: 'monto_fijo', valorMonto: '9000' }),
        ],
      ],
    ])(
      'un producto de $5.000 con %s deja la boleta del sistema por $0',
      async (_caso, descuentos) => {
        const venta = await vender({
          lineas: [
            {
              itemId: item5000,
              cantidad: '1',
              descuentoIds: await descuentos(),
            },
          ],
        });
        expect(venta.totalFinal).toBe('0.0000');
        expect(venta.estado).toBe('pagada');
        const docs = await documentosDe(venta.id);
        expect(docs).toHaveLength(1);
        expect(docs[0]).toMatchObject(BOLETA_CERO);
      },
    );

    it('un producto de $5.000 con una promo del 99,99 % deja la boleta del sistema por $0', async () => {
      const venta = await vender({
        lineas: [{ itemId: itemPromo100, cantidad: '1' }],
      });
      expect(venta.totalFinal).toBe('0.0000');
      const docs = await documentosDe(venta.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject(BOLETA_CERO);
    });

    it('con facturador externo queda un documento hecho por fuera por $0, sin número', async () => {
      await patchFacturador('externo');
      const venta = await vender({
        lineas: [{ itemId: itemPromo100, cantidad: '1' }],
      });
      const docs = await documentosDe(venta.id);
      expect(
        docs.map((d) => [d.emisor, d.tipo_documento_id, d.numero, d.monto]),
      ).toEqual([['externo', BOLETA_ID, null, '0.0000']]);
    });

    it('la online de $0 por una promo la documenta el sistema', async () => {
      const venta = await vender({
        canal: 'online',
        lineas: [{ itemId: itemPromo100, cantidad: '1' }],
      });
      const docs = await documentosDe(venta.id);
      expect(docs.map((d) => [d.emisor, d.monto])).toEqual([
        ['sistema', '0.0000'],
      ]);
    });

    it('la factura de $0 por una promo lleva su documento por el total (E2)', async () => {
      const venta = await vender({
        tipoDocumentoId: FACTURA_ID,
        customer: RECEPTOR,
        lineas: [{ itemId: itemPromo100, cantidad: '1' }],
      });
      const docs = await documentosDe(venta.id);
      expect(docs.map((d) => [d.emisor, d.tipo_documento_id, d.monto])).toEqual(
        [['sistema', FACTURA_ID, '0.0000']],
      );
    });

    // Un precio de lista $0 no es un monto que algo rebajó: es una entrega
    // gratuita. No paga, pero se ve (owner, 2026-10-04): una fila `nadie` por
    // $0, que es la que lee el filtro "Sin documento".
    const NADIE_EN_CERO = {
      emisor: 'nadie',
      tipo_documento_id: null,
      estado_envio: null,
      monto: '0.0000',
      monto_afecto: null,
      pago_id: null,
    };

    it('un producto de lista $0, sin rebaja, deja una fila nadie por $0', async () => {
      const venta = await vender({
        lineas: [{ itemId: itemGratis, cantidad: '1' }],
      });
      expect(venta.totalFinal).toBe('0.0000');
      const docs = await documentosDe(venta.id);
      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject(NADIE_EN_CERO);
    });

    it('también la online y la factura de un producto de lista $0', async () => {
      for (const body of [
        { canal: 'online' },
        { tipoDocumentoId: FACTURA_ID, customer: RECEPTOR },
      ]) {
        const venta = await vender({
          ...body,
          lineas: [{ itemId: itemGratis, cantidad: '1' }],
        });
        const docs = await documentosDe(venta.id);
        expect(docs).toHaveLength(1);
        expect(docs[0]).toMatchObject(NADIE_EN_CERO);
      }
    });

    // `totalBruto` es el neto antes de los recargos: un envío de $2.000 sobre un
    // producto de $0 es una venta cobrada, y se documenta como cualquiera.
    it('un producto de lista $0 con un recargo de $2.000 deja la boleta del sistema por $2.000', async () => {
      const recargo = await request(app.getHttpServer())
        .post('/api/recargos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Doc envío E2E ${randomUUID()}`,
          tipoReglaId: TIPO_RECARGO_GENERAL,
          modo: 'monto_fijo',
          valorMonto: '2000',
          activo: true,
        });
      expect(recargo.status).toBe(201);
      const recargoId = (recargo.body as { id: string }).id;
      try {
        const venta = await vender({
          lineas: [
            { itemId: itemGratis, cantidad: '1', recargoIds: [recargoId] },
          ],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000' }],
        });
        expect(venta.totalFinal).toBe('2000.0000');
        const docs = await documentosDe(venta.id);
        expect(
          docs.map((d) => [d.emisor, d.tipo_documento_id, d.monto]),
        ).toEqual([['sistema', BOLETA_ID, '2000.0000']]);
      } finally {
        // El recargo es del tenant que comparten todas las suites.
        await request(app.getHttpServer())
          .delete(`/api/recargos/${recargoId}`)
          .set('Authorization', `Bearer ${token}`);
      }
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
              customer: RECEPTOR,
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
        customer: RECEPTOR,
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
        const res0 = await request(app.getHttpServer())
          .patch(
            `/api/ventas/${venta.id}/documentos/${await docIdDe(venta.id, 'externo')}`,
          )
          .set('Authorization', `Bearer ${token}`)
          .send({ numero: 'F-98123' });
        expect(res0.status).toBe(200);
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
      // documento del sistema está enviado porque no hay envío (llegará con la
      // emisión, ADR-010). Se arma el dato por SQL para fijar que la regla lee la
      // tabla real. El `PATCH /documentos/:id` no lo produce: solo anota el número
      // de un documento que ya existe.
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

  describe('el detalle de la venta trae los documentos y lo que el backend decide (§ 3.4, § 3.5)', () => {
    interface DocumentoDetalle {
      id: string;
      ventaId: string;
      emisor: string;
      tipoDocumento: {
        id: string;
        codigo: string | null;
        nombre: string;
      } | null;
      claseMaquina: string | null;
      numero: string | null;
      estadoEnvio: string | null;
      monto: string;
      pagoId: string | null;
      documentoCorregidoId: string | null;
      esDuplicado: boolean;
      descarte: string | null;
      descartadoEl: string | null;
      descartadoPorNombre: string | null;
      numerosBorrados: unknown[];
    }
    interface Detalle {
      documentos: DocumentoDetalle[];
      anulable: boolean;
      anularPreguntaExterno: boolean;
      abonoConMaquinaDuplica: boolean;
    }
    const detalle = async (ventaId: string): Promise<Detalle> => {
      const res = await request(app.getHttpServer())
        .get(`/api/ventas/${ventaId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return res.body as Detalle;
    };
    const anular = (ventaId: string, extra: Record<string, unknown> = {}) =>
      request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Se ingresó por error en la caja', ...extra });
    const pendienteDeFactura = () =>
      vender({
        tipoDocumentoId: FACTURA_ID,
        customer: RECEPTOR,
        lineas: [{ itemId: itemAfecto100, cantidad: '1' }],
      });
    /** La mesa de $100.000: $40.000 con la máquina (sin número) y $60.000 debidos. */
    const mesaConVoucher = () =>
      vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '40000' }],
      });

    describe('documentos[]', () => {
      it('trae cada documento con su tipo, número, clase, pago y sin descarte', async () => {
        const venta = await vender({
          lineas: lineas100k(),
          pagos: [
            { metodoPagoId: EFECTIVO_ID, monto: '60000' },
            {
              metodoPagoId: DEBITO_ID,
              monto: '40000',
              numeroDocumento: '445566',
              claseDocumento: 'voucher',
            },
          ],
        });
        const { documentos } = await detalle(venta.id);
        expect(documentos).toHaveLength(2);
        const maquina = documentos.find((d) => d.emisor === 'maquina')!;
        const sistema = documentos.find((d) => d.emisor === 'sistema')!;
        expect(maquina).toEqual({
          id: await docIdDe(venta.id, 'maquina'),
          ventaId: venta.id,
          emisor: 'maquina',
          tipoDocumento: null,
          claseMaquina: 'voucher',
          numero: '445566',
          estadoEnvio: null,
          monto: '40000.0000',
          pagoId: await pagoDe(venta.id, DEBITO_ID),
          documentoCorregidoId: null,
          esDuplicado: false,
          descarte: null,
          descartadoEl: null,
          descartadoPorNombre: null,
          numerosBorrados: [],
        });
        expect(sistema).toMatchObject({
          ventaId: venta.id,
          tipoDocumento: { id: BOLETA_ID, codigo: '39' },
          estadoEnvio: 'armado',
          monto: '60000.0000',
          numero: null,
          esDuplicado: false,
        });
        expect(sistema.tipoDocumento!.nombre).toEqual(expect.any(String));
      });

      it('trae también los de las correcciones de la venta, y no los de otra venta', async () => {
        const venta = await vender({
          lineas: lineas100k(),
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000' }],
        });
        const otra = await vender({
          lineas: lineas100k(),
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000' }],
        });
        // La corrección escribe su propio documento:
        // por el pago en efectivo, corrige la boleta del sistema.
        const nc = await request(app.getHttpServer())
          .post(`/api/ventas/${venta.id}/notas-credito`)
          .set('Idempotency-Key', randomUUID())
          .set('Authorization', `Bearer ${token}`)
          .send({
            monto: '10000',
            comentario: 'devolución parcial',
            devolucion: { pagoId: await pagoDe(venta.id, EFECTIVO_ID) },
          });
        expect(nc.status).toBe(201);
        const ncId = (nc.body as { id: string }).id;
        const original = await docIdDe(venta.id, 'sistema');

        const { documentos } = await detalle(venta.id);
        expect(documentos).toHaveLength(2);
        expect(documentos.find((d) => d.ventaId === ncId)).toMatchObject({
          documentoCorregidoId: original,
          monto: '10000.0000',
        });
        expect(documentos.some((d) => d.ventaId === otra.id)).toBe(false);
        // La corrección, vista desde ella misma, trae solo el suyo.
        expect((await detalle(ncId)).documentos).toHaveLength(1);
      });

      it('un documento descartado se lista con su motivo, la hora y el nombre de quien lo afirmó', async () => {
        await patchFacturador('externo');
        const venta = await pendienteDeFactura();
        const res = await anular(venta.id, { externoHecho: false });
        expect(res.status).toBe(201);

        const quien: { nombre: string; apellido: string | null }[] =
          await ds.query(
            `SELECT nombre, apellido FROM usuarios WHERE usuario_id = $1`,
            [usuarioId],
          );
        const { documentos } = await detalle(venta.id);
        expect(documentos).toHaveLength(1);
        expect(documentos[0]).toMatchObject({
          emisor: 'externo',
          descarte: 'afirmado_no_hecho',
          descartadoPorNombre: [quien[0].nombre, quien[0].apellido]
            .filter(Boolean)
            .join(' '),
        });
        expect(new Date(documentos[0].descartadoEl!).getTime()).not.toBeNaN();
      });

      it('un tipo de documento o un usuario borrados después igual se muestran (excepción deliberada)', async () => {
        await patchFacturador('externo');
        const venta = await pendienteDeFactura();
        const pais: { pais_id: string }[] = await ds.query(
          `SELECT pais_id FROM tipos_documento_tributario WHERE tipo_documento_id = $1`,
          [BOLETA_ID],
        );
        const marca = Date.now();
        const tipo: { tipo_documento_id: string }[] = await ds.query(
          `INSERT INTO tipos_documento_tributario (pais_id, nombre, codigo, eliminado_el)
           VALUES ($1, $2, 'ZZ', NOW()) RETURNING tipo_documento_id`,
          [pais[0].pais_id, `Tipo borrado E2E ${marca}`],
        );
        const usuario: { usuario_id: string }[] = await ds.query(
          `INSERT INTO usuarios (nombre, apellido, correo, eliminado_el)
           VALUES ('Borrada', 'E2E', $1, NOW()) RETURNING usuario_id`,
          [`borrada-${marca}@e2e.test`],
        );
        await ds.query(
          `UPDATE venta_documentos
              SET tipo_documento_id = $2, descarte = 'afirmado_no_hecho',
                  descartado_el = NOW(), descartado_por_usuario_id = $3
            WHERE venta_id = $1`,
          [venta.id, tipo[0].tipo_documento_id, usuario[0].usuario_id],
        );
        const { documentos } = await detalle(venta.id);
        expect(documentos).toHaveLength(1);
        expect(documentos[0].tipoDocumento).toEqual({
          id: tipo[0].tipo_documento_id,
          codigo: 'ZZ',
          nombre: `Tipo borrado E2E ${marca}`,
        });
        expect(documentos[0].descartadoPorNombre).toBe('Borrada E2E');
      });

      it('un documento borrado (eliminado_el) no se lista', async () => {
        const venta = await mesaConVoucher();
        await ds.query(
          `UPDATE venta_documentos SET eliminado_el = NOW()
            WHERE venta_id = $1 AND emisor = 'maquina'`,
          [venta.id],
        );
        const { documentos } = await detalle(venta.id);
        expect(documentos.map((d) => d.emisor)).toEqual(['sistema']);
      });
    });

    describe('anulable y anularPreguntaExterno: la misma regla que POST /anular', () => {
      it('pendiente sin pagos con la boleta del sistema: anulable, sin pregunta; y anular lo confirma', async () => {
        const venta = await vender({ lineas: lineas100k() });
        const d = await detalle(venta.id);
        expect(d.anulable).toBe(true);
        expect(d.anularPreguntaExterno).toBe(false);
        expect((await anular(venta.id)).status).toBe(201);
      });

      it('con una factura externa sin número: anulable y pregunta; anotarle el número cierra las dos y anular da 400', async () => {
        await patchFacturador('externo');
        const venta = await pendienteDeFactura();
        let d = await detalle(venta.id);
        expect(d.anulable).toBe(true);
        expect(d.anularPreguntaExterno).toBe(true);

        const res = await request(app.getHttpServer())
          .patch(
            `/api/ventas/${venta.id}/documentos/${await docIdDe(venta.id, 'externo')}`,
          )
          .set('Authorization', `Bearer ${token}`)
          .send({ numero: 'F-77' });
        expect(res.status).toBe(200);

        d = await detalle(venta.id);
        expect(d.anulable).toBe(false);
        expect(d.anularPreguntaExterno).toBe(false);
        const anulada = await anular(venta.id, { externoHecho: false });
        expect(anulada.status).toBe(400);
      });

      it('con un voucher de la máquina: no es anulable (tiene pagos, y la máquina ya emitió)', async () => {
        const venta = await mesaConVoucher();
        const d = await detalle(venta.id);
        expect(d.anulable).toBe(false);
        expect(d.anularPreguntaExterno).toBe(false);
        expect((await anular(venta.id)).status).toBe(400);
      });

      it('un documento de la máquina sin pagos (armado por SQL) tampoco: lo emitido bloquea aunque el estado y los pagos dejen pasar', async () => {
        const venta = await vender({ lineas: lineas100k() });
        await ds.query(
          `INSERT INTO venta_documentos (tenant_id, venta_id, emisor, monto)
           VALUES ($1, $2, 'maquina', 1000)`,
          [TENANT_ID, venta.id],
        );
        const d = await detalle(venta.id);
        expect(d.anulable).toBe(false);
        expect((await anular(venta.id)).status).toBe(400);
      });

      it('una venta ya anulada no es anulable', async () => {
        const venta = await vender({ lineas: lineas100k() });
        expect((await anular(venta.id)).status).toBe(201);
        const d = await detalle(venta.id);
        expect(d.anulable).toBe(false);
        expect(d.anularPreguntaExterno).toBe(false);
      });
    });

    describe('abonoConMaquinaDuplica: lo que decide el backend antes de cobrar un abono con la máquina', () => {
      it('con deuda ya documentada: true, y el abono con la máquina de verdad deja un duplicado', async () => {
        const venta = await mesaConVoucher();
        expect((await detalle(venta.id)).abonoConMaquinaDuplica).toBe(true);

        const abono = await request(app.getHttpServer())
          .post('/api/pagos')
          .set('Idempotency-Key', randomUUID())
          .set('Authorization', `Bearer ${token}`)
          .send({
            ventaId: venta.id,
            pagos: [{ metodoPagoId: CREDITO_ID, monto: '60000' }],
          });
        expect(abono.status).toBe(201);
        expect(
          (await documentosDe(venta.id)).filter((d) => d.es_duplicado),
        ).toHaveLength(1);
      });

      it('una venta pendiente sin pagar tiene la deuda documentada: true', async () => {
        const venta = await vender({ lineas: lineas100k() });
        expect((await detalle(venta.id)).abonoConMaquinaDuplica).toBe(true);
      });

      it('con propina el saldo es lo aplicado a la venta: pagó $100.000, $10.000 son propina y quedan debiendo $10.000', async () => {
        // Medido por monto bruto el saldo sería 0 y diría false.
        const venta = await vender({
          lineas: lineas100k(),
          propinaDirecta: { montoPagado: '10000' },
          pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
        });
        expect(venta.estado).toBe('pagada_parcial');
        expect((await detalle(venta.id)).abonoConMaquinaDuplica).toBe(true);
      });

      it('sin saldo (pagada) no hay deuda que duplicar: false', async () => {
        const venta = await vender({
          lineas: lineas100k(),
          pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
        });
        expect(venta.estado).toBe('pagada');
        expect((await detalle(venta.id)).abonoConMaquinaDuplica).toBe(false);
      });

      it('una venta anulada no admite abonos: false', async () => {
        const venta = await vender({ lineas: lineas100k() });
        expect((await anular(venta.id)).status).toBe(201);
        expect((await detalle(venta.id)).abonoConMaquinaDuplica).toBe(false);
      });

      it('una venta de $0 no tiene documentos que duplicar: false', async () => {
        const venta = await vender({
          lineas: [{ itemId: itemGratis, cantidad: '1' }],
        });
        expect((await detalle(venta.id)).abonoConMaquinaDuplica).toBe(false);
      });
    });
  });

  describe('PATCH /ventas/:id/documentos/:documentoId: completar el número después (§ 3.4)', () => {
    const patchDoc = (
      ventaId: string,
      documentoId: string,
      body: Record<string, unknown>,
      tok = token,
    ) =>
      request(app.getHttpServer())
        .patch(`/api/ventas/${ventaId}/documentos/${documentoId}`)
        .set('Authorization', `Bearer ${tok}`)
        .send(body);
    const numeroEnBase = async (documentoId: string) => {
      const r: { numero: string | null; clase_maquina: string | null }[] =
        await ds.query(
          `SELECT numero, clase_maquina FROM venta_documentos WHERE documento_id = $1`,
          [documentoId],
        );
      return r[0];
    };
    const mesaConVoucher = () =>
      vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '40000' }],
      });
    /**
     * Un usuario propio con un rol propio que tiene `Ventas:Leer` y NO `Ventas:Crear`:
     * no hay uno así en el seed (el Vendedor tiene los dos), así que se arma por
     * la API, como `resumen-negocio.e2e-spec.ts`. Cuenta propia y no
     * `vendedor@paris.cl`, que comparten ~20 specs. `afterAll` los da de baja
     * (soft delete) para no dejar un rol de pruebas en el seed.
     */
    let rolSoloLeerId: string | null = null;
    let usuarioSoloLeerId: string | null = null;
    const tokenSoloVentasLeer = async (): Promise<string> => {
      const modulos = await request(app.getHttpServer())
        .get('/api/roles/modulos-disponibles')
        .set('Authorization', `Bearer ${token}`);
      expect(modulos.status).toBe(200);
      const ventas = (
        modulos.body as {
          moduloTenantId: string;
          nombre: string;
          permisos: { moduloAppPermisoId: string; permisoNombre: string }[];
        }[]
      ).find((m) => m.nombre === 'Ventas')!;
      const leer = ventas.permisos.find((p) => p.permisoNombre === 'Leer')!;

      const rol = await request(app.getHttpServer())
        .post('/api/roles')
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: `E2E docs solo Ventas Leer ${Date.now()}` });
      expect(rol.status).toBe(201);
      rolSoloLeerId = (rol.body as { id: string }).id;
      const permisos = await request(app.getHttpServer())
        .put(
          `/api/roles/${rolSoloLeerId}/modules/${ventas.moduloTenantId}/permissions`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({ moduloAppPermisoIds: [leer.moduloAppPermisoId] });
      expect(permisos.status).toBe(200);

      const correo = `docs-solo-leer.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.cl`;
      const alta = await request(app.getHttpServer())
        .post('/api/tenants/usuarios')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: 'Solo',
          apellido: 'Leer',
          correo,
          rolIds: [rolSoloLeerId],
        });
      expect(alta.status).toBe(201);
      usuarioSoloLeerId = (alta.body as { usuarioId: string }).usuarioId;

      const invitacion = await app
        .get(TokensAccesoService)
        .emitir(usuarioSoloLeerId, TipoTokenAcceso.INVITACION);
      const contrasena = 'clave-e2e-docs-solo-leer-1234';
      const elegir = await request(app.getHttpServer())
        .post(`/api/auth/invitacion/${invitacion}`)
        .send({ contrasena });
      expect(elegir.status).toBe(200);

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: correo, password: contrasena });
      expect(loginRes.status).toBe(200);
      const enTenant = await request(app.getHttpServer())
        .post('/api/auth/switch-tenant')
        .set(
          'Cookie',
          (loginRes.headers['set-cookie'] as unknown as string[]) ?? [],
        )
        .set(
          'Authorization',
          `Bearer ${(loginRes.body as { access_token: string }).access_token}`,
        )
        .send({ tenantId: TENANT_ID });
      expect(enTenant.status).toBe(200);
      return (enTenant.body as { access_token: string }).access_token;
    };
    afterAll(async () => {
      // Soft delete, nunca DELETE: el rol y el usuario de la prueba dejan de valer.
      if (usuarioSoloLeerId)
        await ds.query(
          `UPDATE usuarios SET eliminado_el = NOW() WHERE usuario_id = $1`,
          [usuarioSoloLeerId],
        );
      if (rolSoloLeerId)
        await ds.query(
          `UPDATE roles SET eliminado_el = NOW() WHERE rol_id = $1`,
          [rolSoloLeerId],
        );
    });

    const facturaExterna = async () => {
      await patchFacturador('externo');
      return vender({
        tipoDocumentoId: FACTURA_ID,
        customer: RECEPTOR,
        lineas: [{ itemId: itemAfecto100, cantidad: '1' }],
      });
    };

    it('el voucher de la máquina: 200 con el documento actualizado, y el número queda', async () => {
      const venta = await mesaConVoucher();
      const docId = await docIdDe(venta.id, 'maquina');
      const res = await patchDoc(venta.id, docId, {
        numero: '  445566  ',
        clase: 'voucher',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: docId,
        ventaId: venta.id,
        emisor: 'maquina',
        numero: '445566',
        claseMaquina: 'voucher',
        monto: '40000.0000',
        esDuplicado: false,
      });
      expect(await numeroEnBase(docId)).toEqual({
        numero: '445566',
        clase_maquina: 'voucher',
      });
    });

    it('sin clase conserva la que había', async () => {
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [
          {
            metodoPagoId: DEBITO_ID,
            monto: '40000',
            claseDocumento: 'boleta',
          },
        ],
      });
      const docId = await docIdDe(venta.id, 'maquina');
      const res = await patchDoc(venta.id, docId, { numero: '123' });
      expect(res.status).toBe(200);
      expect(await numeroEnBase(docId)).toEqual({
        numero: '123',
        clase_maquina: 'boleta',
      });
    });

    it('la factura hecha por fuera (externo): 200 y el número queda', async () => {
      const venta = await facturaExterna();
      const docId = await docIdDe(venta.id, 'externo');
      const res = await patchDoc(venta.id, docId, { numero: 'F-98123' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        emisor: 'externo',
        numero: 'F-98123',
        tipoDocumento: { id: FACTURA_ID },
      });
      expect((await numeroEnBase(docId)).numero).toBe('F-98123');
    });

    it('sirve también para el voucher duplicado de un abono (E1b)', async () => {
      const venta = await mesaConVoucher();
      const abono = await request(app.getHttpServer())
        .post('/api/pagos')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          ventaId: venta.id,
          pagos: [{ metodoPagoId: CREDITO_ID, monto: '60000' }],
        });
      expect(abono.status).toBe(201);
      const duplicado: { documento_id: string }[] = await ds.query(
        `SELECT documento_id FROM venta_documentos
          WHERE venta_id = $1 AND es_duplicado = true AND eliminado_el IS NULL`,
        [venta.id],
      );
      expect(duplicado).toHaveLength(1);
      const res = await patchDoc(venta.id, duplicado[0].documento_id, {
        numero: '990011',
        clase: 'boleta',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        numero: '990011',
        claseMaquina: 'boleta',
        esDuplicado: true,
      });
    });

    it('un documento del sistema: 404 y no se toca', async () => {
      const venta = await mesaConVoucher();
      const docId = await docIdDe(venta.id, 'sistema');
      const res = await patchDoc(venta.id, docId, { numero: '1' });
      expect(res.status).toBe(404);
      expect((await numeroEnBase(docId)).numero).toBeNull();
    });

    it('una fila "nadie": 404', async () => {
      await patchMetodo(DEBITO_ID, 'nadie');
      const venta = await mesaConVoucher();
      const docId = await docIdDe(venta.id, 'nadie');
      const res = await patchDoc(venta.id, docId, { numero: '1' });
      expect(res.status).toBe(404);
      expect((await numeroEnBase(docId)).numero).toBeNull();
    });

    it('un documento descartado (la venta se anuló): 404 y no se escribe', async () => {
      const venta = await facturaExterna();
      const docId = await docIdDe(venta.id, 'externo');
      const anulada = await request(app.getHttpServer())
        .post(`/api/ventas/${venta.id}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Se ingresó por error', externoHecho: false });
      expect(anulada.status).toBe(201);
      const res = await patchDoc(venta.id, docId, { numero: 'F-1' });
      expect(res.status).toBe(404);
      expect((await numeroEnBase(docId)).numero).toBeNull();
    });

    it('un documento borrado: 404', async () => {
      const venta = await mesaConVoucher();
      const docId = await docIdDe(venta.id, 'maquina');
      await ds.query(
        `UPDATE venta_documentos SET eliminado_el = NOW() WHERE documento_id = $1`,
        [docId],
      );
      expect((await patchDoc(venta.id, docId, { numero: '1' })).status).toBe(
        404,
      );
    });

    it('el documento de OTRA venta del mismo tenant: 404, aunque la venta de la ruta exista y sea tuya', async () => {
      const a = await mesaConVoucher();
      const b = await mesaConVoucher();
      const docDeB = await docIdDe(b.id, 'maquina');
      const res = await patchDoc(a.id, docDeB, { numero: '1' });
      expect(res.status).toBe(404);
      expect((await numeroEnBase(docDeB)).numero).toBeNull();
    });

    it('el documento de una corrección no se completa por la venta original: 404', async () => {
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000' }],
      });
      const nc = await request(app.getHttpServer())
        .post(`/api/ventas/${venta.id}/notas-credito`)
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          monto: '10000',
          comentario: 'devolución parcial',
          devolucion: { pagoId: await pagoDe(venta.id, EFECTIVO_ID) },
        });
      expect(nc.status).toBe(201);
      const inserted: { documento_id: string }[] = await ds.query(
        `INSERT INTO venta_documentos (tenant_id, venta_id, emisor, monto)
         VALUES ($1, $2, 'maquina', 10000) RETURNING documento_id`,
        [TENANT_ID, (nc.body as { id: string }).id],
      );
      const res = await patchDoc(venta.id, inserted[0].documento_id, {
        numero: '1',
      });
      expect(res.status).toBe(404);
    });

    it('un documento de otro tenant: 404 con el token del otro tenant (no ve la venta), y no se toca', async () => {
      const venta = await mesaConVoucher();
      const docId = await docIdDe(venta.id, 'maquina');
      const tokenAjeno = await loginSegundoTenant(app);
      const res = await patchDoc(venta.id, docId, { numero: '1' }, tokenAjeno);
      expect(res.status).toBe(404);
      expect((await numeroEnBase(docId)).numero).toBeNull();
    });

    it('IDOR: con la ruta de TU venta (que ves) y el documentId de otra venta del mismo tenant: 404 por el documento, no por el alcance', async () => {
      const mia = await mesaConVoucher();
      const ajena = await mesaConVoucher();
      const docDeLaAjena = await docIdDe(ajena.id, 'maquina');
      const docMio = await docIdDe(mia.id, 'maquina');

      const res = await patchDoc(mia.id, docDeLaAjena, { numero: 'ROBADO' });
      expect(res.status).toBe(404);
      expect((res.body as { message: string }).message).toBe(
        'Documento no encontrado',
      );
      expect((await numeroEnBase(docDeLaAjena)).numero).toBeNull();
      // Control: la venta de la ruta SÍ es visible (su propio documento da 200),
      // así que el 404 de arriba no salió del alcance.
      expect((await patchDoc(mia.id, docMio, { numero: '1' })).status).toBe(
        200,
      );
    });

    it('IDOR: con la ruta de TU venta y el documentId de OTRO TENANT: 404 por el documento, no por el alcance', async () => {
      const mia = await mesaConVoucher();
      const docMio = await docIdDe(mia.id, 'maquina');
      // Un documento que pertenece a otro tenant. No hay ventas del segundo
      // tenant a mano, así que se arma la fila con el `tenant_id` ajeno: lo que
      // se fija es que el documento se busca por tenant, no solo por venta.
      const ajeno: { documento_id: string }[] = await ds.query(
        `INSERT INTO venta_documentos (tenant_id, venta_id, emisor, monto)
         VALUES ('550e8400-e29b-41d4-a716-446655440040', $1, 'maquina', 5000)
         RETURNING documento_id`,
        [mia.id],
      );

      const res = await patchDoc(mia.id, ajeno[0].documento_id, {
        numero: 'ROBADO',
      });
      expect(res.status).toBe(404);
      expect((res.body as { message: string }).message).toBe(
        'Documento no encontrado',
      );
      expect((await numeroEnBase(ajeno[0].documento_id)).numero).toBeNull();
      expect((await patchDoc(mia.id, docMio, { numero: '1' })).status).toBe(
        200,
      );
    });

    it('un cajero de otra caja, sin Cajas:Leer: 404 (no 403) y no se toca; el admin, sobre el mismo documento, 200', async () => {
      const venta = await mesaConVoucher();
      const docId = await docIdDe(venta.id, 'maquina');
      const resLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(VENDEDOR);
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
      const tokenVendedor = (resTenant.body as { access_token: string })
        .access_token;

      const ajeno = await patchDoc(
        venta.id,
        docId,
        { numero: '1' },
        tokenVendedor,
      );
      expect(ajeno.status).toBe(404);
      expect((await numeroEnBase(docId)).numero).toBeNull();

      const propio = await patchDoc(venta.id, docId, { numero: '1' });
      expect(propio.status).toBe(200);
    });

    it.each([
      ['un número vacío', { numero: '' }],
      ['un número de solo espacios', { numero: '   ' }],
      ['sin número', {}],
      ['un número null', { numero: null }],
      ['un número de 41 caracteres', { numero: '9'.repeat(41) }],
      ['un número con un salto de línea', { numero: '12\n34' }],
      ['una clase fuera de voucher/boleta', { numero: '1', clase: 'factura' }],
      ['una clase null', { numero: '1', clase: null }],
      ['un campo de más (emisor)', { numero: '1', emisor: 'sistema' }],
    ])('%s: 400 y no escribe nada', async (_nombre, body) => {
      const venta = await mesaConVoucher();
      const docId = await docIdDe(venta.id, 'maquina');
      const res = await patchDoc(venta.id, docId, body);
      expect(res.status).toBe(400);
      expect(await numeroEnBase(docId)).toEqual({
        numero: null,
        clase_maquina: null,
      });
    });

    it('la clase con un documento externo: 400 y no escribe', async () => {
      const venta = await facturaExterna();
      const docId = await docIdDe(venta.id, 'externo');
      const res = await patchDoc(venta.id, docId, {
        numero: 'F-1',
        clase: 'voucher',
      });
      expect(res.status).toBe(400);
      expect(await numeroEnBase(docId)).toEqual({
        numero: null,
        clase_maquina: null,
      });
    });

    it('ids que no son uuid: 400', async () => {
      const venta = await mesaConVoucher();
      const docId = await docIdDe(venta.id, 'maquina');
      expect(
        (await patchDoc('no-es-uuid', docId, { numero: '1' })).status,
      ).toBe(400);
      expect(
        (await patchDoc(venta.id, 'no-es-uuid', { numero: '1' })).status,
      ).toBe(400);
    });

    it('con Ventas:Leer pero sin Ventas:Crear: 403 y no se toca; el admin, sobre el mismo documento, 200', async () => {
      // Sin esta prueba nada cazaría que el `@RequiresPermiso` se saque de la
      // ruta: el guard deja pasar lo que no lleva decorador.
      const tokenSoloLeer = await tokenSoloVentasLeer();
      const venta = await mesaConVoucher();
      const docId = await docIdDe(venta.id, 'maquina');

      const res = await patchDoc(
        venta.id,
        docId,
        { numero: '1' },
        tokenSoloLeer,
      );
      expect(res.status).toBe(403);
      expect((await numeroEnBase(docId)).numero).toBeNull();
      expect((await patchDoc(venta.id, docId, { numero: '1' })).status).toBe(
        200,
      );
    });

    it('sin token: 401', async () => {
      const venta = await mesaConVoucher();
      const docId = await docIdDe(venta.id, 'maquina');
      const res = await request(app.getHttpServer())
        .patch(`/api/ventas/${venta.id}/documentos/${docId}`)
        .send({ numero: '1' });
      expect(res.status).toBe(401);
    });

    it('toma el lock de la venta: no escribe mientras otra transacción la tiene tomada', async () => {
      const venta = await facturaExterna();
      const docId = await docIdDe(venta.id, 'externo');

      let soltar!: () => void;
      const retenida = new Promise<void>((r) => (soltar = r));
      let tomado!: () => void;
      const tomada = new Promise<void>((r) => (tomado = r));
      // Hace de la anulación que está a medio commit: tiene la venta tomada.
      const otraTransaccion = ds.transaction(async (m) => {
        await m.query(`SELECT 1 FROM ventas WHERE venta_id = $1 FOR UPDATE`, [
          venta.id,
        ]);
        tomado();
        await retenida;
      });
      await tomada;

      let termino = false;
      const pendiente = patchDoc(venta.id, docId, { numero: 'F-5' }).then(
        (r) => {
          termino = true;
          return r;
        },
      );
      await new Promise((r) => setTimeout(r, 500));
      expect(termino).toBe(false);
      expect((await numeroEnBase(docId)).numero).toBeNull();

      soltar();
      await otraTransaccion;
      const res = await pendiente;
      expect(res.status).toBe(200);
      expect((await numeroEnBase(docId)).numero).toBe('F-5');
    });

    // No prueba el lock de la venta (pasa igual sin él: la sentencia del UPDATE
    // ya exige `descarte IS NULL`); lo prueba "toma el lock de la venta". Fija
    // solo el resultado: si la anulación ya descartó el documento cuando el PATCH
    // toma su turno, no se escribe el número y se responde 404.
    it('un documento que una anulación ya descartó cuando el PATCH toma su turno: 404, sin escribir el número', async () => {
      const venta = await facturaExterna();
      const docId = await docIdDe(venta.id, 'externo');

      let soltar!: () => void;
      const retenida = new Promise<void>((r) => (soltar = r));
      let tomado!: () => void;
      const tomada = new Promise<void>((r) => (tomado = r));
      const anulacion = ds.transaction(async (m) => {
        await m.query(`SELECT 1 FROM ventas WHERE venta_id = $1 FOR UPDATE`, [
          venta.id,
        ]);
        await m.query(
          `UPDATE venta_documentos
              SET descarte = 'afirmado_no_hecho', descartado_el = NOW(),
                  descartado_por_usuario_id = $2
            WHERE documento_id = $1`,
          [docId, usuarioId],
        );
        tomado();
        await retenida;
      });
      await tomada;

      const pendiente = patchDoc(venta.id, docId, { numero: 'F-6' });
      await new Promise((r) => setTimeout(r, 300));
      soltar();
      await anulacion;
      const res = await pendiente;
      expect(res.status).toBe(404);
      expect((await numeroEnBase(docId)).numero).toBeNull();
    });
  });

  describe('POST /ventas/:id/documentos/:documentoId/borrar-numero: el encargado borra el número de un documento hecho por fuera (PRODUCTO § 10)', () => {
    interface NumeroBorrado {
      numeroAnterior: string;
      borradoEl: string;
      borradoPorNombre: string | null;
    }
    interface DocumentoBorrado {
      id: string;
      numero: string | null;
      numerosBorrados: NumeroBorrado[];
    }
    const borrar = (ventaId: string, documentoId: string, tok = token) =>
      request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/documentos/${documentoId}/borrar-numero`)
        .set('Authorization', `Bearer ${tok}`);
    const anotar = (ventaId: string, documentoId: string, numero: string) =>
      request(app.getHttpServer())
        .patch(`/api/ventas/${ventaId}/documentos/${documentoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ numero });
    const detalleDe = async (ventaId: string) => {
      const res = await request(app.getHttpServer())
        .get(`/api/ventas/${ventaId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return res.body as {
        anulable: boolean;
        anularPreguntaExterno: boolean;
        documentos: DocumentoBorrado[];
      };
    };
    const numeroEnBase = async (documentoId: string) => {
      const r: { numero: string | null }[] = await ds.query(
        `SELECT numero FROM venta_documentos WHERE documento_id = $1`,
        [documentoId],
      );
      return r[0].numero;
    };
    const borrados = (documentoId: string) =>
      ds.query<
        {
          numero_anterior: string;
          usuario_id: string;
          tenant_id: string;
          creado_el: Date;
        }[]
      >(
        `SELECT numero_anterior, usuario_id, tenant_id, creado_el
           FROM venta_documento_numero_borrados
          WHERE documento_id = $1 AND eliminado_el IS NULL
          ORDER BY creado_el, numero_borrado_id`,
        [documentoId],
      );
    const facturaExterna = async () => {
      await patchFacturador('externo');
      return vender({
        tipoDocumentoId: FACTURA_ID,
        customer: RECEPTOR,
        lineas: [{ itemId: itemAfecto100, cantidad: '1' }],
      });
    };
    /** Factura hecha por fuera con su número ya anotado. */
    const externaConNumero = async (numero = 'F-4471') => {
      const venta = await facturaExterna();
      const docId = await docIdDe(venta.id, 'externo');
      expect((await anotar(venta.id, docId, numero)).status).toBe(200);
      return { venta, docId };
    };

    /**
     * Usuarios propios con un rol propio y SOLO los permisos de Ventas que se
     * piden: no hay uno así en el seed (el Vendedor tiene Leer y Crear, y el
     * admin todo). Cuenta propia y no `vendedor@paris.cl`, que comparten ~20
     * specs. `afterAll` los da de baja (soft delete).
     */
    const roles: string[] = [];
    const usuarios: string[] = [];
    const tokenConVentas = async (permisos: string[]): Promise<string> => {
      const modulos = await request(app.getHttpServer())
        .get('/api/roles/modulos-disponibles')
        .set('Authorization', `Bearer ${token}`);
      expect(modulos.status).toBe(200);
      const ventas = (
        modulos.body as {
          moduloTenantId: string;
          nombre: string;
          permisos: { moduloAppPermisoId: string; permisoNombre: string }[];
        }[]
      ).find((m) => m.nombre === 'Ventas')!;
      const ids = permisos.map(
        (p) =>
          ventas.permisos.find((x) => x.permisoNombre === p)!
            .moduloAppPermisoId,
      );

      const rol = await request(app.getHttpServer())
        .post('/api/roles')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `E2E borrar numero ${permisos.join('+')} ${Date.now()}`,
        });
      expect(rol.status).toBe(201);
      const rolId = (rol.body as { id: string }).id;
      roles.push(rolId);
      const asignados = await request(app.getHttpServer())
        .put(`/api/roles/${rolId}/modules/${ventas.moduloTenantId}/permissions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ moduloAppPermisoIds: ids });
      expect(asignados.status).toBe(200);

      const correo = `borrar-numero.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.cl`;
      const alta = await request(app.getHttpServer())
        .post('/api/tenants/usuarios')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: 'Borra',
          apellido: 'Numero',
          correo,
          rolIds: [rolId],
        });
      expect(alta.status).toBe(201);
      const usuario = (alta.body as { usuarioId: string }).usuarioId;
      usuarios.push(usuario);

      const invitacion = await app
        .get(TokensAccesoService)
        .emitir(usuario, TipoTokenAcceso.INVITACION);
      const contrasena = 'clave-e2e-borrar-numero-1234';
      const elegir = await request(app.getHttpServer())
        .post(`/api/auth/invitacion/${invitacion}`)
        .send({ contrasena });
      expect(elegir.status).toBe(200);

      const loginRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: correo, password: contrasena });
      expect(loginRes.status).toBe(200);
      const enTenant = await request(app.getHttpServer())
        .post('/api/auth/switch-tenant')
        .set(
          'Cookie',
          (loginRes.headers['set-cookie'] as unknown as string[]) ?? [],
        )
        .set(
          'Authorization',
          `Bearer ${(loginRes.body as { access_token: string }).access_token}`,
        )
        .send({ tenantId: TENANT_ID });
      expect(enTenant.status).toBe(200);
      return (enTenant.body as { access_token: string }).access_token;
    };
    afterAll(async () => {
      // Soft delete, nunca DELETE: los usuarios y roles de la prueba dejan de valer.
      for (const id of usuarios)
        await ds.query(
          `UPDATE usuarios SET eliminado_el = NOW() WHERE usuario_id = $1`,
          [id],
        );
      for (const id of roles)
        await ds.query(
          `UPDATE roles SET eliminado_el = NOW() WHERE rol_id = $1`,
          [id],
        );
    });

    it('con Ventas:Anular: 200, el número queda vacío y el borrado queda registrado con quién, cuándo y qué decía', async () => {
      const { venta, docId } = await externaConNumero('F-4471');

      const res = await borrar(venta.id, docId);
      expect(res.status).toBe(201);
      const doc = res.body as DocumentoBorrado;
      expect(doc.id).toBe(docId);
      expect(doc.numero).toBeNull();
      expect(doc.numerosBorrados).toHaveLength(1);
      expect(doc.numerosBorrados[0].numeroAnterior).toBe('F-4471');
      expect(doc.numerosBorrados[0].borradoPorNombre).toEqual(
        expect.any(String),
      );
      expect(
        Date.now() - new Date(doc.numerosBorrados[0].borradoEl).getTime(),
      ).toBeLessThan(60_000);

      expect(await numeroEnBase(docId)).toBeNull();
      const filas = await borrados(docId);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        numero_anterior: 'F-4471',
        usuario_id: usuarioId,
        tenant_id: TENANT_ID,
      });
    });

    it('el detalle muestra el borrado, y un documento que nunca se borró trae la lista vacía', async () => {
      const { venta, docId } = await externaConNumero('F-9102');
      expect((await detalleDe(venta.id)).documentos[0].numerosBorrados).toEqual(
        [],
      );

      expect((await borrar(venta.id, docId)).status).toBe(201);

      const d = (await detalleDe(venta.id)).documentos.find(
        (x) => x.id === docId,
      )!;
      expect(d.numero).toBeNull();
      expect(d.numerosBorrados.map((n) => n.numeroAnterior)).toEqual([
        'F-9102',
      ]);
    });

    it('un registro de borrado dado de baja (eliminado_el) no se lista en el detalle', async () => {
      const { venta, docId } = await externaConNumero('F-9103');
      expect((await borrar(venta.id, docId)).status).toBe(201);
      await ds.query(
        `UPDATE venta_documento_numero_borrados SET eliminado_el = NOW() WHERE documento_id = $1`,
        [docId],
      );

      const d = (await detalleDe(venta.id)).documentos.find(
        (x) => x.id === docId,
      )!;
      expect(d.numerosBorrados).toEqual([]);
    });

    it('después de borrar la venta vuelve a "sin número": anular otra vez pregunta (E10) y con "no" anula', async () => {
      const { venta, docId } = await externaConNumero('F-3318');
      // Con número se da por hecho: no pregunta, va por NC.
      let d = await detalleDe(venta.id);
      expect(d.anulable).toBe(false);
      expect(d.anularPreguntaExterno).toBe(false);

      expect((await borrar(venta.id, docId)).status).toBe(201);

      d = await detalleDe(venta.id);
      expect(d.anulable).toBe(true);
      expect(d.anularPreguntaExterno).toBe(true);
      const sinRespuesta = await request(app.getHttpServer())
        .post(`/api/ventas/${venta.id}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Se anotó el número por error' });
      expect(sinRespuesta.status).toBe(400);
      const anulada = await request(app.getHttpServer())
        .post(`/api/ventas/${venta.id}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Se anotó el número por error', externoHecho: false });
      expect(anulada.status).toBe(201);
    });

    it('dos borrados del mismo documento dejan dos registros y el primero queda intacto', async () => {
      const { venta, docId } = await externaConNumero('A-111');
      expect((await borrar(venta.id, docId)).status).toBe(201);
      const primero = (await borrados(docId))[0];

      expect((await anotar(venta.id, docId, 'B-222')).status).toBe(200);
      const res = await borrar(venta.id, docId);
      expect(res.status).toBe(201);

      const filas = await borrados(docId);
      expect(filas.map((f) => f.numero_anterior)).toEqual(['A-111', 'B-222']);
      // El primero no se tocó: mismo valor, misma hora.
      expect(filas[0].creado_el).toEqual(primero.creado_el);
      // El detalle los lista a los dos, el más nuevo primero.
      const d = (await detalleDe(venta.id)).documentos.find(
        (x) => x.id === docId,
      )!;
      expect(d.numerosBorrados.map((n) => n.numeroAnterior)).toEqual([
        'B-222',
        'A-111',
      ]);
      expect(
        (res.body as DocumentoBorrado).numerosBorrados.map(
          (n) => n.numeroAnterior,
        ),
      ).toEqual(['B-222', 'A-111']);
    });

    it('reescribir un número con el PATCH no deja registro: solo el borrado', async () => {
      const { venta, docId } = await externaConNumero('C-1');
      expect((await anotar(venta.id, docId, 'C-2')).status).toBe(200);
      expect((await anotar(venta.id, docId, 'C-3')).status).toBe(200);
      expect(await borrados(docId)).toHaveLength(0);
    });

    it('sin Ventas:Anular: 403 y no se toca; con Leer y Crear tampoco. El admin, sobre el mismo documento, puede', async () => {
      // Sin esta prueba nada cazaría que el `@RequiresPermiso` se saque de la
      // ruta: el guard deja pasar lo que no lleva decorador.
      const tokenSinAnular = await tokenConVentas(['Leer', 'Crear']);
      const { venta, docId } = await externaConNumero('F-5050');

      const res = await borrar(venta.id, docId, tokenSinAnular);
      expect(res.status).toBe(403);
      expect(await numeroEnBase(docId)).toBe('F-5050');
      expect(await borrados(docId)).toHaveLength(0);

      expect((await borrar(venta.id, docId)).status).toBe(201);
      expect(await numeroEnBase(docId)).toBeNull();
    });

    it('con Ventas:Anular pero sin Cajas:Leer, sobre la venta de otra caja: 404 (no 403) y no se toca', async () => {
      const tokenSoloAnular = await tokenConVentas(['Anular']);
      const { venta, docId } = await externaConNumero('F-6060');

      const res = await borrar(venta.id, docId, tokenSoloAnular);
      expect(res.status).toBe(404);
      expect((res.body as { message: string }).message).toBe(
        'Venta no encontrada',
      );
      expect(await numeroEnBase(docId)).toBe('F-6060');
      expect(await borrados(docId)).toHaveLength(0);
    });

    it('un documento que no es hecho por fuera (máquina, sistema, nadie): 404 y no se toca', async () => {
      // Voucher de la máquina con número + boleta del sistema por lo debido.
      await patchFacturador('sistema');
      const mesa = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '40000' }],
      });
      const voucher = await docIdDe(mesa.id, 'maquina');
      expect((await anotar(mesa.id, voucher, 'V-77')).status).toBe(200);
      const delSistema = await docIdDe(mesa.id, 'sistema');
      await patchMetodo(DEBITO_ID, 'nadie');
      const sinDoc = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
      });
      const nadie = await docIdDe(sinDoc.id, 'nadie');

      for (const [ventaId, docId] of [
        [mesa.id, voucher],
        [mesa.id, delSistema],
        [sinDoc.id, nadie],
      ]) {
        const res = await borrar(ventaId, docId);
        expect(res.status).toBe(404);
        expect((res.body as { message: string }).message).toBe(
          'Documento no encontrado',
        );
        expect(await borrados(docId)).toHaveLength(0);
      }
      expect(await numeroEnBase(voucher)).toBe('V-77');
    });

    it('un documento descartado o borrado: 404 y no se toca', async () => {
      const { venta, docId } = await externaConNumero('F-7070');
      await ds.query(
        `UPDATE venta_documentos
            SET descarte = 'afirmado_no_hecho', descartado_el = NOW(),
                descartado_por_usuario_id = $2
          WHERE documento_id = $1`,
        [docId, usuarioId],
      );
      expect((await borrar(venta.id, docId)).status).toBe(404);

      const otra = await externaConNumero('F-7071');
      await ds.query(
        `UPDATE venta_documentos SET eliminado_el = NOW() WHERE documento_id = $1`,
        [otra.docId],
      );
      expect((await borrar(otra.venta.id, otra.docId)).status).toBe(404);
      expect(await numeroEnBase(docId)).toBe('F-7070');
      expect(await numeroEnBase(otra.docId)).toBe('F-7071');
      expect(await borrados(docId)).toHaveLength(0);
      expect(await borrados(otra.docId)).toHaveLength(0);
    });

    it('un documento hecho por fuera que no tiene número: 400 y no deja registro', async () => {
      const venta = await facturaExterna();
      const docId = await docIdDe(venta.id, 'externo');

      const res = await borrar(venta.id, docId);
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toMatch(
        /no tiene número/i,
      );
      expect(await borrados(docId)).toHaveLength(0);
    });

    it('un número de solo espacios es "sin número": 400 (el mismo criterio con el que anular lo da por no hecho)', async () => {
      const venta = await facturaExterna();
      const docId = await docIdDe(venta.id, 'externo');
      await ds.query(
        `UPDATE venta_documentos SET numero = '   ' WHERE documento_id = $1`,
        [docId],
      );
      expect((await borrar(venta.id, docId)).status).toBe(400);
      expect(await borrados(docId)).toHaveLength(0);
    });

    it('IDOR: la ruta de TU venta (que ves) con el documento de otra venta del mismo tenant: 404 por el documento, y no se toca', async () => {
      const mia = await externaConNumero('F-8001');
      const ajena = await externaConNumero('F-8002');

      const res = await borrar(mia.venta.id, ajena.docId);
      expect(res.status).toBe(404);
      expect((res.body as { message: string }).message).toBe(
        'Documento no encontrado',
      );
      expect(await numeroEnBase(ajena.docId)).toBe('F-8002');
      expect(await borrados(ajena.docId)).toHaveLength(0);
      // Control: la venta de la ruta SÍ es visible; el 404 no salió del alcance.
      expect((await borrar(mia.venta.id, mia.docId)).status).toBe(201);
    });

    it('IDOR: la ruta de TU venta con un documento de OTRO TENANT: 404 y no se toca', async () => {
      const mia = await externaConNumero('F-8101');
      const ajeno: { documento_id: string }[] = await ds.query(
        `INSERT INTO venta_documentos (tenant_id, venta_id, emisor, numero, monto)
         VALUES ('550e8400-e29b-41d4-a716-446655440040', $1, 'externo', 'AJENO-1', 5000)
         RETURNING documento_id`,
        [mia.venta.id],
      );

      const res = await borrar(mia.venta.id, ajeno[0].documento_id);
      expect(res.status).toBe(404);
      expect((res.body as { message: string }).message).toBe(
        'Documento no encontrado',
      );
      expect(await numeroEnBase(ajeno[0].documento_id)).toBe('AJENO-1');
      expect(await borrados(ajeno[0].documento_id)).toHaveLength(0);
      expect((await borrar(mia.venta.id, mia.docId)).status).toBe(201);
    });

    it('con el token del otro tenant la venta no existe: 404 y no se toca', async () => {
      const { venta, docId } = await externaConNumero('F-8201');
      const tokenAjeno = await loginSegundoTenant(app);

      const res = await borrar(venta.id, docId, tokenAjeno);
      expect(res.status).toBe(404);
      expect(await numeroEnBase(docId)).toBe('F-8201');
      expect(await borrados(docId)).toHaveLength(0);
    });

    it('el documento de una corrección no se borra por la venta original: 404', async () => {
      const venta = await vender({
        lineas: lineas100k(),
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000' }],
      });
      const nc = await request(app.getHttpServer())
        .post(`/api/ventas/${venta.id}/notas-credito`)
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          monto: '10000',
          comentario: 'devolución parcial',
          devolucion: { pagoId: await pagoDe(venta.id, EFECTIVO_ID) },
        });
      expect(nc.status).toBe(201);
      const insertado: { documento_id: string }[] = await ds.query(
        `INSERT INTO venta_documentos (tenant_id, venta_id, emisor, numero, monto)
         VALUES ($1, $2, 'externo', 'NC-1', 10000) RETURNING documento_id`,
        [TENANT_ID, (nc.body as { id: string }).id],
      );
      const docId = insertado[0].documento_id;

      expect((await borrar(venta.id, docId)).status).toBe(404);
      // Por la ruta de la corrección, que es la suya, sí se puede.
      expect((await borrar((nc.body as { id: string }).id, docId)).status).toBe(
        201,
      );
    });

    it('ids que no son uuid: 400. Sin token: 401', async () => {
      const { venta, docId } = await externaConNumero('F-8301');
      expect((await borrar('no-es-uuid', docId)).status).toBe(400);
      expect((await borrar(venta.id, 'no-es-uuid')).status).toBe(400);
      const sinToken = await request(app.getHttpServer()).post(
        `/api/ventas/${venta.id}/documentos/${docId}/borrar-numero`,
      );
      expect(sinToken.status).toBe(401);
      expect(await numeroEnBase(docId)).toBe('F-8301');
    });

    it('toma el lock de la venta: no escribe mientras otra transacción la tiene tomada', async () => {
      const { venta, docId } = await externaConNumero('F-8401');

      let soltar!: () => void;
      const retenida = new Promise<void>((r) => (soltar = r));
      let tomado!: () => void;
      const tomada = new Promise<void>((r) => (tomado = r));
      // Hace de la anulación que está a medio commit: tiene la venta tomada.
      const otraTransaccion = ds.transaction(async (m) => {
        await m.query(`SELECT 1 FROM ventas WHERE venta_id = $1 FOR UPDATE`, [
          venta.id,
        ]);
        tomado();
        await retenida;
      });
      await tomada;

      let termino = false;
      const pendiente = borrar(venta.id, docId).then((r) => {
        termino = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 500));
      expect(termino).toBe(false);
      expect(await numeroEnBase(docId)).toBe('F-8401');

      soltar();
      await otraTransaccion;
      expect((await pendiente).status).toBe(201);
      expect(await numeroEnBase(docId)).toBeNull();
    });
  });

  describe('GET /ventas?documento=: quién emitió (E1, E1b, E9)', () => {
    // Una venta de cada caso, creadas una vez en `beforeAll`: los filtros se
    // leen sobre el mismo conjunto, y cada uno afirma lo que trae Y lo que deja
    // afuera. El listado es del tenant entero y otras suites venden en él, así
    // que se afirma sobre ESTAS ventas (inclusión y exclusión), no sobre el total.
    const v: Record<string, string> = {};

    interface FilaLista {
      id: string;
      esCorreccion: boolean;
      emisores: string[];
      tieneDuplicado: boolean;
    }
    const listar = async (query = ''): Promise<FilaLista[]> => {
      const res = await request(app.getHttpServer())
        .get(`/api/ventas?pageSize=100${query}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return (res.body as { data: FilaLista[] }).data;
    };
    /** De las ventas de este describe, cuáles trae el filtro. */
    const traeDeLasMias = async (documento: string): Promise<string[]> => {
      const propias = new Set(Object.values(v));
      return (await listar(`&documento=${documento}`))
        .map((f) => f.id)
        .filter((id) => propias.has(id))
        .map((id) => Object.keys(v).find((k) => v[k] === id)!)
        .sort();
    };
    const corregir = async (ventaId: string, metodoPagoId: string) => {
      const res = await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/notas-credito`)
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          monto: '10000',
          comentario: 'devolución parcial',
          devolucion: { pagoId: await pagoDe(ventaId, metodoPagoId) },
        });
      expect(res.status).toBe(201);
      return (res.body as { id: string }).id;
    };
    const anularConMotivo = (ventaId: string, extra = {}) =>
      request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Se ingresó por error en la caja', ...extra });

    beforeAll(async () => {
      await patchFacturador('sistema');
      await patchMetodo(DEBITO_ID, 'maquina');
      await patchMetodo(CREDITO_ID, 'maquina');

      v.sistema = (
        await vender({
          lineas: lineas100k(),
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000' }],
        })
      ).id;
      v.maquinaConNumero = (
        await vender({
          lineas: lineas100k(),
          pagos: [
            {
              metodoPagoId: DEBITO_ID,
              monto: '100000',
              numeroDocumento: '778899',
              claseDocumento: 'voucher',
            },
          ],
        })
      ).id;
      v.maquinaSinNumero = (
        await vender({
          lineas: lineas100k(),
          pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
        })
      ).id;
      // Boleta del sistema por 60.000 + voucher con número por 40.000.
      v.mixto = (
        await vender({
          lineas: lineas100k(),
          pagos: [
            { metodoPagoId: EFECTIVO_ID, monto: '60000' },
            {
              metodoPagoId: DEBITO_ID,
              monto: '40000',
              numeroDocumento: '445566',
            },
          ],
        })
      ).id;
      // La deuda ya la documentó la boleta del sistema: la tarjeta de la máquina
      // que la paga después deja solo el voucher duplicado (E1b).
      v.duplicado = (
        await vender({
          lineas: lineas100k(),
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '40000' }],
        })
      ).id;
      const abono = await request(app.getHttpServer())
        .post('/api/pagos')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          ventaId: v.duplicado,
          pagos: [{ metodoPagoId: CREDITO_ID, monto: '60000' }],
        });
      expect(abono.status).toBe(201);
      // Su corrección (por el pago de la máquina) lleva un documento propio que,
      // sin la exclusión de las correcciones, se colaría en `maquina`/`duplicado`.
      v.correccionDeDuplicado = await corregir(v.duplicado, CREDITO_ID);

      await patchMetodo(DEBITO_ID, 'nadie');
      v.nadie = (
        await vender({
          lineas: lineas100k(),
          pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
        })
      ).id;
      // La devolución de un pago de "nadie" es la interna: su fila también es `nadie`.
      v.correccionDeNadie = await corregir(v.nadie, DEBITO_ID);
      await patchMetodo(DEBITO_ID, 'maquina');

      v.correccionDeSistema = await corregir(v.sistema, EFECTIVO_ID);
      v.correccionDeMaquina = await corregir(v.maquinaSinNumero, DEBITO_ID);
      // La NC de la máquina nace sin número; ésta ya se anotó, así que no le
      // falta nada y "Sin número" la deja afuera.
      v.correccionDeMaquinaNumerada = await corregir(
        v.maquinaConNumero,
        DEBITO_ID,
      );
      const numerarNota = await request(app.getHttpServer())
        .patch(
          `/api/ventas/${v.correccionDeMaquinaNumerada}/documentos/${await docIdDe(v.correccionDeMaquinaNumerada, 'maquina')}`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({ numero: 'NC-5501' });
      expect(numerarNota.status).toBe(200);

      await patchFacturador('externo');
      v.externo = (await vender({ lineas: lineas100k() })).id;
      // Una factura pagada con tarjeta tiene un solo documento, el externo (E2):
      // se corrige por ese pago, y la corrección deja su propio documento externo,
      // sin número, que sin la exclusión de las correcciones se colaría en
      // `externo` y `sin_numero`.
      v.externoConNumero = (
        await vender({
          tipoDocumentoId: FACTURA_ID,
          customer: RECEPTOR,
          lineas: [{ itemId: itemAfecto100, cantidad: '1' }],
          pagos: [{ metodoPagoId: DEBITO_ID, monto: '119000' }],
        })
      ).id;
      const numerar = await request(app.getHttpServer())
        .patch(
          `/api/ventas/${v.externoConNumero}/documentos/${await docIdDe(v.externoConNumero, 'externo')}`,
        )
        .set('Authorization', `Bearer ${token}`)
        .send({ numero: 'F-9001' });
      expect(numerar.status).toBe(200);
      v.correccionDeExterno = await corregir(v.externoConNumero, DEBITO_ID);
      // Anulada diciendo que no estaba hecho: su documento externo queda descartado.
      v.externoDescartado = (await vender({ lineas: lineas100k() })).id;
      expect(
        (await anularConMotivo(v.externoDescartado, { externoHecho: false }))
          .status,
      ).toBe(201);

      await patchFacturador('sistema');
      // Su boleta del sistema queda descartada.
      v.sistemaDescartado = (await vender({ lineas: lineas100k() })).id;
      expect((await anularConMotivo(v.sistemaDescartado)).status).toBe(201);

      // Una cancelada con un `nadie` vigente. Inalcanzable por la API: la fila
      // `nadie` nace de un pago con un medio `nadie`, y anular exige que no haya
      // pagos. Se arma por SQL para fijar que el filtro es una defensa real y no
      // un efecto de que hoy nadie llegue ahí.
      v.canceladaConNadie = (await vender({ lineas: lineas100k() })).id;
      expect((await anularConMotivo(v.canceladaConNadie)).status).toBe(201);
      await ds.query(
        `INSERT INTO venta_documentos (tenant_id, venta_id, emisor, monto)
         VALUES ($1, $2, 'nadie', 100000)`,
        [TENANT_ID, v.canceladaConNadie],
      );

      // La entrega gratuita (un producto de lista $0, sin rebaja) no paga, pero
      // se ve: su fila `nadie` por $0 la pone en "Sin documento" (owner,
      // 2026-10-04, "No paga, pero se ve").
      v.entregaGratuita = (
        await vender({ lineas: [{ itemId: itemGratis, cantidad: '1' }] })
      ).id;

      // Un documento dado de baja (soft delete) no cuenta. Ningún camino de la
      // API los da de baja hoy: el dato se arma por SQL, igual que en "lo que ya
      // emitió alguien bloquea".
      v.maquinaDadaDeBaja = (
        await vender({
          lineas: lineas100k(),
          pagos: [{ metodoPagoId: DEBITO_ID, monto: '100000' }],
        })
      ).id;
      await ds.query(
        `UPDATE venta_documentos SET eliminado_el = now() WHERE venta_id = $1`,
        [v.maquinaDadaDeBaja],
      );
    }, 120000);

    it.each([
      ['sistema', ['duplicado', 'mixto', 'sistema']],
      ['maquina', ['maquinaConNumero', 'maquinaSinNumero', 'mixto']],
      ['externo', ['externo', 'externoConNumero']],
      ['sin_documento', ['entregaGratuita', 'nadie']],
      ['duplicado', ['duplicado']],
    ])(
      'documento=%s trae exactamente sus ventas, sin las correcciones, canceladas, descartes ni bajas',
      async (documento, esperadas) => {
        expect(await traeDeLasMias(documento)).toEqual([...esperadas].sort());
      },
    );

    it('documento=sin_numero trae también las notas de crédito sin número, como filas propias', async () => {
      // Todo lo que tiene un documento de la máquina o por fuera sin número, el
      // voucher duplicado incluido (también es de la máquina y se completa
      // igual). Y, a diferencia de los otros valores, las NC de la máquina y de
      // afuera que todavía no se anotaron: es lo que el contador tiene que
      // completar. La NC ya numerada, la del sistema (no folia todavía), la
      // devolución interna (`nadie`) y la que corrige por la boleta del
      // sistema quedan afuera.
      expect(await traeDeLasMias('sin_numero')).toEqual(
        [
          'correccionDeExterno',
          'correccionDeMaquina',
          'duplicado',
          'externo',
          'maquinaSinNumero',
        ].sort(),
      );
      const filas = await listar('&documento=sin_numero');
      const nota = filas.find((f) => f.id === v.correccionDeMaquina)!;
      expect(nota.esCorreccion).toBe(true);
      expect(nota.emisores).toEqual(['maquina']);
    });

    it('meta.total cuenta lo filtrado: el mismo conjunto que trae la página', async () => {
      // Pocas ventas del tenant tienen un duplicado: cabe en una página, así
      // que el total tiene que ser exactamente lo que trae.
      const res = await request(app.getHttpServer())
        .get('/api/ventas?pageSize=100&documento=duplicado')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      const body = res.body as {
        data: FilaLista[];
        meta: { total: number };
      };
      expect(body.meta.total).toBeGreaterThanOrEqual(1);
      expect(body.meta.total).toBeLessThanOrEqual(100);
      expect(body.data).toHaveLength(body.meta.total);
      expect(body.data.every((f) => f.tieneDuplicado)).toBe(true);
      expect(body.data.map((f) => f.id)).toContain(v.duplicado);
    });

    it('el voucher duplicado no vuelve "de la máquina" a una venta que solo lo tiene a él', async () => {
      const ids = (await listar('&documento=maquina')).map((f) => f.id);
      expect(ids).not.toContain(v.duplicado);
    });

    it('sin el filtro vienen todas, también las correcciones y las anuladas', async () => {
      const ids = (await listar()).map((f) => f.id);
      for (const id of Object.values(v)) expect(ids).toContain(id);
    });

    it('un valor que no es ninguno de los seis: 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/ventas?documento=otro')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('un documento vacío es un 400, no "sin filtro"', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/ventas?documento=')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('se suma al filtro de estado: las ventas de la máquina son pagadas, ninguna pendiente', async () => {
      const pagadas = (await listar('&documento=maquina&estado=pagada')).map(
        (f) => f.id,
      );
      expect(pagadas).toContain(v.maquinaSinNumero);
      const pendientes = (
        await listar('&documento=maquina&estado=pendiente')
      ).map((f) => f.id);
      expect(pendientes).not.toContain(v.maquinaSinNumero);
    });

    it('cada fila trae su resumen: los emisores de lo vigente, sin duplicado, y si tiene un duplicado', async () => {
      const filas = new Map((await listar()).map((f) => [f.id, f]));
      const resumen = (clave: string) => {
        const f = filas.get(v[clave])!;
        return { emisores: f.emisores, tieneDuplicado: f.tieneDuplicado };
      };
      expect(resumen('sistema')).toEqual({
        emisores: ['sistema'],
        tieneDuplicado: false,
      });
      expect(resumen('maquinaConNumero')).toEqual({
        emisores: ['maquina'],
        tieneDuplicado: false,
      });
      expect(resumen('mixto')).toEqual({
        emisores: ['maquina', 'sistema'],
        tieneDuplicado: false,
      });
      // El voucher duplicado no cuenta como emisor: se avisa aparte.
      expect(resumen('duplicado')).toEqual({
        emisores: ['sistema'],
        tieneDuplicado: true,
      });
      expect(resumen('externo')).toEqual({
        emisores: ['externo'],
        tieneDuplicado: false,
      });
      expect(resumen('nadie')).toEqual({
        emisores: ['nadie'],
        tieneDuplicado: false,
      });
      // La entrega gratuita se lee igual: el chip "Sin documento" del listado.
      expect(resumen('entregaGratuita')).toEqual({
        emisores: ['nadie'],
        tieneDuplicado: false,
      });
      // Lo descartado y lo dado de baja no figura.
      expect(resumen('externoDescartado')).toEqual({
        emisores: [],
        tieneDuplicado: false,
      });
      expect(resumen('sistemaDescartado')).toEqual({
        emisores: [],
        tieneDuplicado: false,
      });
      expect(resumen('maquinaDadaDeBaja')).toEqual({
        emisores: [],
        tieneDuplicado: false,
      });
      // La corrección lleva su propio documento y su propio resumen.
      expect(filas.get(v.correccionDeSistema)).toMatchObject({
        esCorreccion: true,
        emisores: ['sistema'],
      });
      expect(filas.get(v.correccionDeNadie)).toMatchObject({
        esCorreccion: true,
        emisores: ['nadie'],
      });
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
