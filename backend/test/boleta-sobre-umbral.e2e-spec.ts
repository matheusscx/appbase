import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';
import { loginSegundoTenant } from './helpers/segundo-tenant';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)
const CHILE_ID = '550e8400-e29b-41d4-a716-446655440000';
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
const FACTURA_ID = '550e8400-e29b-41d4-a716-446655440146';
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };
// Mesa 1 y Bruno Díaz, como `venta-documentos.e2e-spec.ts` (no Ana: la sesión
// es única por garzón y Ana está vinculada a una cuenta desde el seed).
const MESA_1_ID = '550e8400-e29b-41d4-a716-446655440232';
const BRUNO = {
  garzonId: '550e8400-e29b-41d4-a716-446655440239',
  pin: '222222',
};
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const RECEPTOR_FACTURA = {
  nombre: 'Comercial Andes SpA',
  rut: '76.123.456-0',
  giro: 'Venta de artículos de ferretería',
  direccion: 'Av. Matta 1234',
  comuna: 'Santiago',
};
const PAGADOR = { nombre: 'Juana Pérez Soto', rut: '12.345.678-5' };
const MENSAJE = 'el nombre y el RUT de quien paga';

/**
 * Una boleta de más de 135 UF lleva el nombre y el RUT de quien paga (Res. Ex.
 * SII 44/2025, art. 92 ter del Código Tributario; spec
 * `2026-10-04-identidad-del-pagador-sobre-135-uf`).
 *
 * Los montos salen del umbral que devuelve `GET /tipos-documento`, no de una
 * constante: `arriba` es el primer peso que lo excede y `abajo` el último que
 * no. Los ítems son servicios propios (no mueven el stock compartido del seed).
 */
describe('Boleta sobre el umbral del art. 92 ter (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta;
  let umbral: string;
  let arriba: string;
  let abajo: string;
  let itemArriba: string;
  let itemAbajo: string;
  let itemMitad: string; // la mitad de `arriba`, redondeada hacia arriba

  const patchMetodo = async (metodoPagoId: string, emisor: string) => {
    const res = await request(app.getHttpServer())
      .patch(`/api/metodos-pago/${metodoPagoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ emisor });
    expect(res.status).toBe(200);
  };
  const crearItem = async (nombre: string, precio: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `${nombre} ${Date.now()}`,
        precioBase: precio,
        monedaId: CLP,
        tipo: 'servicio',
        clasificacionTributaria: 'afecto',
        precioIncluyeImpuesto: true,
      });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  };
  const vender = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const ventasDelItem = async (itemId: string): Promise<number> => {
    const rows: { n: string }[] = await ds.query(
      `SELECT COUNT(*) AS n FROM venta_detalles
        WHERE item_id = $1 AND eliminado_el IS NULL`,
      [itemId],
    );
    return Number(rows[0].n);
  };
  /** Un 400 que nombra la regla y no deja ninguna venta del ítem. */
  const rechazada = async (
    res: request.Response,
    itemId: string,
    antes: number,
  ) => {
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain(MENSAJE);
    expect(await ventasDelItem(itemId)).toBe(antes);
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

    const tipos = await request(app.getHttpServer())
      .get('/api/tipos-documento')
      .set('Authorization', `Bearer ${token}`);
    expect(tipos.status).toBe(200);
    const boleta = (
      tipos.body as { id: string; umbralIdentidad: string | null }[]
    ).find((t) => t.id === BOLETA_ID);
    expect(boleta?.umbralIdentidad).toEqual(expect.any(String));
    umbral = boleta!.umbralIdentidad!;
    arriba = new Decimal(umbral).floor().plus(1).toFixed(0);
    abajo = new Decimal(umbral).floor().toFixed(0);

    itemArriba = await crearItem('Umbral arriba E2E', arriba);
    itemAbajo = await crearItem('Umbral abajo E2E', abajo);
    itemMitad = await crearItem(
      'Umbral mitad E2E',
      new Decimal(arriba).div(2).ceil().toFixed(0),
    );

    caja = await abrirCaja(app, token, { saldoInicial: '10000.0000' });
  }, 60000);

  afterAll(async () => {
    try {
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
    await patchMetodo(CREDITO_ID, 'maquina');
  });

  describe('GET /tipos-documento', () => {
    it('la boleta trae el umbral del año (o el último anterior) y la factura, null', async () => {
      const esperado: { monto: string }[] = await ds.query(
        `SELECT monto FROM umbral_identidad_pagador
          WHERE pais_id = $1 AND eliminado_el IS NULL
            AND anio <= EXTRACT(YEAR FROM now() AT TIME ZONE 'America/Santiago')
          ORDER BY anio DESC LIMIT 1`,
        [CHILE_ID],
      );
      expect(umbral).toBe(esperado[0].monto);

      const tipos = await request(app.getHttpServer())
        .get('/api/tipos-documento')
        .set('Authorization', `Bearer ${token}`);
      expect(tipos.status).toBe(200);
      const factura = (
        tipos.body as { id: string; umbralIdentidad: string | null }[]
      ).find((t) => t.id === FACTURA_ID);
      expect(factura?.umbralIdentidad).toBeNull();
    });

    // Rige la fila del año y, sin ella, la del último anterior (*"se mantendrá
    // este monto"*); una fila de un año futuro no rige todavía. Se toca el
    // catálogo compartido con baja lógica y se restaura pase lo que pase.
    it('sin fila del año rige la del último anterior; una de un año futuro, no', async () => {
      const umbralBoleta = async () => {
        const res = await request(app.getHttpServer())
          .get('/api/tipos-documento')
          .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        return (
          res.body as { id: string; umbralIdentidad: string | null }[]
        ).find((t) => t.id === BOLETA_ID)?.umbralIdentidad;
      };
      const [{ anio }]: { anio: number }[] = await ds.query(
        `SELECT EXTRACT(YEAR FROM now() AT TIME ZONE 'America/Santiago')::int AS anio`,
      );
      const anterior: { monto: string }[] = await ds.query(
        `SELECT monto FROM umbral_identidad_pagador
          WHERE pais_id = $1 AND eliminado_el IS NULL AND anio < $2
          ORDER BY anio DESC LIMIT 1`,
        [CHILE_ID, anio],
      );
      expect(anterior).toHaveLength(1);
      const FUTURO = 2999;
      await ds.query(
        `UPDATE umbral_identidad_pagador SET eliminado_el = now()
          WHERE pais_id = $1 AND anio = $2 AND eliminado_el IS NULL`,
        [CHILE_ID, FUTURO],
      );
      const futura: { umbral_id: string }[] = await ds.query(
        `INSERT INTO umbral_identidad_pagador (pais_id, anio, monto, fuente)
         VALUES ($1, $2, 1, 'e2e: un año futuro no rige')
         RETURNING umbral_id`,
        [CHILE_ID, FUTURO],
      );
      // Los ids se leen ANTES con un SELECT: con Postgres, `ds.query` devuelve
      // un `UPDATE … RETURNING` como `[filas, cantidad]`, y mapear eso daba
      // `undefined`: el `finally` no restauraba nada y la suite seguía con el
      // umbral del año anterior (medido: 3 rojos en la suite, 2026-10-04).
      const delAnio: { umbral_id: string }[] = await ds.query(
        `SELECT umbral_id FROM umbral_identidad_pagador
          WHERE pais_id = $1 AND anio = $2 AND eliminado_el IS NULL`,
        [CHILE_ID, anio],
      );
      await ds.query(
        `UPDATE umbral_identidad_pagador SET eliminado_el = now()
          WHERE umbral_id = ANY($1::uuid[])`,
        [delAnio.map((r) => r.umbral_id)],
      );
      try {
        expect(await umbralBoleta()).toBe(anterior[0].monto);
      } finally {
        await ds.query(
          `UPDATE umbral_identidad_pagador SET eliminado_el = NULL
            WHERE umbral_id = ANY($1::uuid[])`,
          [delAnio.map((r) => r.umbral_id)],
        );
        await ds.query(
          `UPDATE umbral_identidad_pagador SET eliminado_el = now()
            WHERE umbral_id = $1`,
          [futura[0].umbral_id],
        );
      }
      expect(await umbralBoleta()).toBe(umbral);
    });
  });

  describe('POST /ventas, boleta sobre el umbral', () => {
    it('crédito de la máquina sin cliente: 400, el voucher no alcanza', async () => {
      const antes = await ventasDelItem(itemArriba);
      const res = await vender({
        lineas: [{ itemId: itemArriba, cantidad: '1' }],
        pagos: [{ metodoPagoId: CREDITO_ID, monto: arriba }],
      });
      await rechazada(res, itemArriba, antes);
    });

    it('efectivo sin cliente: 400', async () => {
      const antes = await ventasDelItem(itemArriba);
      const res = await vender({
        lineas: [{ itemId: itemArriba, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: arriba }],
      });
      await rechazada(res, itemArriba, antes);
    });

    it('cliente con nombre y sin RUT: 400', async () => {
      const antes = await ventasDelItem(itemArriba);
      const res = await vender({
        lineas: [{ itemId: itemArriba, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: arriba }],
        customer: { nombre: PAGADOR.nombre },
      });
      await rechazada(res, itemArriba, antes);
    });

    it('cliente con RUT y nombre en blanco: 400', async () => {
      const antes = await ventasDelItem(itemArriba);
      const res = await vender({
        lineas: [{ itemId: itemArriba, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: arriba }],
        customer: { nombre: '   ', rut: PAGADOR.rut },
      });
      await rechazada(res, itemArriba, antes);
    });

    it('un RUT que no es un RUT: 400 (la validación de siempre)', async () => {
      const antes = await ventasDelItem(itemArriba);
      const res = await vender({
        lineas: [{ itemId: itemArriba, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: arriba }],
        customer: { nombre: PAGADOR.nombre, rut: '12.345.678-9' },
      });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'El RUT del cliente no es válido',
      );
      expect(await ventasDelItem(itemArriba)).toBe(antes);
    });

    it('pendiente, sin pagos y sin cliente: 400 (lo fiado también es la operación)', async () => {
      const antes = await ventasDelItem(itemArriba);
      const res = await vender({
        lineas: [{ itemId: itemArriba, cantidad: '1' }],
        pagos: [],
      });
      await rechazada(res, itemArriba, antes);
    });

    it('dos pagos que pasan el umbral solo sumados: 400 (no se mide por pago)', async () => {
      // Dos líneas de la mitad: cada pago queda bajo el umbral, la venta no.
      const antes = await ventasDelItem(itemMitad);
      const mitad = new Decimal(arriba).div(2).ceil().toFixed(0);
      expect(new Decimal(mitad).lte(umbral)).toBe(true);
      const res = await vender({
        lineas: [{ itemId: itemMitad, cantidad: '2' }],
        pagos: [
          { metodoPagoId: CREDITO_ID, monto: mitad },
          { metodoPagoId: EFECTIVO_ID, monto: mitad },
        ],
      });
      await rechazada(res, itemMitad, antes);
    });

    it('con nombre y RUT: 201; el voucher se registra igual y la identidad queda congelada', async () => {
      const res = await vender({
        lineas: [{ itemId: itemArriba, cantidad: '1' }],
        pagos: [{ metodoPagoId: CREDITO_ID, monto: arriba }],
        customer: PAGADOR,
      });
      expect(res.status).toBe(201);
      const ventaId = (res.body as { id: string }).id;
      const docs: { emisor: string; monto: string }[] = await ds.query(
        `SELECT emisor, monto FROM venta_documentos
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );
      expect(docs).toEqual([
        { emisor: 'maquina', monto: new Decimal(arriba).toFixed(4) },
      ]);
      const customer: { nombre: string; rut: string }[] = await ds.query(
        `SELECT nombre, rut FROM venta_customer
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );
      expect(customer).toEqual([{ nombre: PAGADOR.nombre, rut: '12345678-5' }]);
    });
  });

  describe('POST /ventas, lo que no cambia', () => {
    it('un peso por debajo del umbral, sin cliente: 201', async () => {
      const res = await vender({
        lineas: [{ itemId: itemAbajo, cantidad: '1' }],
        pagos: [{ metodoPagoId: CREDITO_ID, monto: abajo }],
      });
      expect(res.status).toBe(201);
    });

    it('una factura sobre el umbral con su receptor: 201, no pide nada más', async () => {
      const res = await vender({
        tipoDocumentoId: FACTURA_ID,
        lineas: [{ itemId: itemArriba, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: arriba }],
        customer: RECEPTOR_FACTURA,
      });
      expect(res.status).toBe(201);
    });
  });

  describe('salones: cierre de cuenta sobre el umbral', () => {
    afterAll(async () => {
      await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${token}`)
        .send(BRUNO);
    });

    it('sin cliente: 400 y la cuenta sigue abierta; con nombre y RUT cierra', async () => {
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
        .send({ itemId: itemArriba, cantidad: '1' });
      expect(linea.status).toBe(201);

      const cerrar = (extra: Record<string, unknown>) =>
        request(app.getHttpServer())
          .post(`/api/cuentas/${cuentaId}/cerrar`)
          .set('Idempotency-Key', randomUUID())
          .set('Authorization', `Bearer ${token}`)
          .send({
            ...BRUNO,
            pagos: [{ metodoPagoId: CREDITO_ID, monto: arriba }],
            ...extra,
          });
      const estadoCuenta = async () => {
        const rows: { estado: string; venta_id: string | null }[] =
          await ds.query(
            `SELECT estado, venta_id FROM cuentas
              WHERE cuenta_id = $1 AND eliminado_el IS NULL`,
            [cuentaId],
          );
        return rows[0];
      };

      const sinCliente = await cerrar({});
      expect(sinCliente.status).toBe(400);
      expect((sinCliente.body as { message: string }).message).toContain(
        MENSAJE,
      );
      expect(await estadoCuenta()).toEqual({
        estado: 'abierta',
        venta_id: null,
      });

      const conCliente = await cerrar({ customer: PAGADOR });
      expect(conCliente.status).toBe(201);
      const ventaId = (conCliente.body as { ventaId: string }).ventaId;
      expect((await estadoCuenta()).venta_id).toBe(ventaId);
      const customer: { rut: string }[] = await ds.query(
        `SELECT rut FROM venta_customer
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );
      expect(customer).toEqual([{ rut: '12345678-5' }]);
    });
  });

  // La tienda online cobra antes de crear la venta (callback de Webpay) y no
  // pide RUT: la compra sobre el umbral se rechaza en `POST /online/pagar`,
  // antes del cobro. Demo Bodega (Chile) tiene la pasarela demo prendida desde
  // el seed, que pasa por el mismo chequeo que la rama Webpay.
  describe('tienda online: el rechazo es antes del cobro', () => {
    let tokenBodega: string;
    const crearItemBodega = async (nombre: string, precio: string) => {
      const res = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${tokenBodega}`)
        .send({
          nombre: `${nombre} ${Date.now()}`,
          precioBase: precio,
          monedaId: CLP,
          tipo: 'servicio',
          clasificacionTributaria: 'afecto',
          precioIncluyeImpuesto: true,
        });
      expect(res.status).toBe(201);
      return (res.body as { id: string }).id;
    };
    const pagar = (itemId: string) =>
      request(app.getHttpServer())
        .post('/api/online/pagar')
        .set('Authorization', `Bearer ${tokenBodega}`)
        .send({ lineas: [{ itemId, cantidad: '1' }] });

    beforeAll(async () => {
      tokenBodega = await loginSegundoTenant(app);
    });

    it('sobre el umbral: 400 que lo explica; un peso por debajo: el checkout sigue', async () => {
      const sobre = await pagar(
        await crearItemBodega('Online arriba E2E', arriba),
      );
      expect(sobre.status).toBe(400);
      expect((sobre.body as { message: string }).message).toContain(MENSAJE);

      const bajo = await pagar(
        await crearItemBodega('Online abajo E2E', abajo),
      );
      expect(bajo.status).toBe(201);
      expect((bajo.body as { modo: string }).modo).toBe('simulado');
    });
  });
});
