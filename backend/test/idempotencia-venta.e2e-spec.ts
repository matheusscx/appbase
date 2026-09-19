import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { MENSAJE_OTROS_DATOS } from '../src/modules/idempotencia/idempotencia.service';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * Un cobro que se repite no se registra dos veces
 * (`docs/adr/026-idempotencia-de-cobros.md`).
 *
 * Contra Postgres real a propósito: lo que este frente garantiza —el reclamo
 * atómico con la venta, el duplicado concurrente que espera en el índice
 * único, el rollback que se lleva el reclamo— no existe en un unitario con la
 * base mockeada.
 *
 * Ítem, salón, mesa y garzón son PROPIOS de este archivo: el stock del seed se
 * agota entre corridas locales y la sesión de garzón es única por garzón.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface GarzonCreado {
  id: string;
  pin: string;
}
interface VentaRes {
  id: string;
  estado: string;
  repetida?: boolean;
}
interface CierreRes {
  ventaId: string;
  repetida?: boolean;
}
interface AbonoRes {
  pagos: { id: string }[];
  venta: { id: string; saldo: string };
  repetida?: boolean;
}
interface OtrosDatosRes {
  statusCode: number;
  message: string;
  ventaId: string;
}

async function entrar(app: INestApplication<App>): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN.email, password: ADMIN.pass });
  expect(login.status).toBe(200);

  const enTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
    .set(
      'Authorization',
      `Bearer ${(login.body as TokenResponse).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(enTenant.status).toBe(200);
  return (enTenant.body as TokenResponse).access_token;
}

describe('Idempotencia de cobros (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta;
  let itemId: string;
  let garzon: GarzonCreado;
  let mesaId: string;

  /** POST de fixture (sin clave): afirma el status y devuelve el body. */
  async function post<T>(url: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  /** POST de cobro con la clave que el test decide (o sin ninguna). */
  function cobrar(url: string, body: Record<string, unknown>, clave?: string) {
    const req = request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`);
    if (clave !== undefined) void req.set('Idempotency-Key', clave);
    return req.send(body);
  }

  async function contar(sql: string, params: unknown[]): Promise<number> {
    const filas: { n: string }[] = await ds.query(sql, params);
    return Number(filas[0].n);
  }

  const ventasDelTenant = () =>
    contar(
      `SELECT count(*) AS n FROM ventas
        WHERE tenant_id = $1 AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );

  const stockDelLocal = () =>
    contar(
      `SELECT COALESCE(SUM(su.stock), 0) AS n
         FROM stock_ubicacion su
         JOIN ubicaciones u ON u.ubicacion_id = su.ubicacion_id
                           AND u.tipo = 'local' AND u.eliminado_el IS NULL
        WHERE su.item_id = $1`,
      [itemId],
    );

  const lineaVenta = (cantidad = '1') => ({
    lineas: [{ itemId, cantidad }],
    pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
  });

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

    ds = app.get(DataSource);
    token = await entrar(app);
    caja = await abrirCaja(app, token, {
      comentario: 'Apertura E2E idempotencia',
    });

    const marca = Date.now();
    itemId = (
      await post<IdResponse>('/api/items', {
        nombre: `Item idempotencia E2E ${marca}`,
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '100',
        costo: '100',
      })
    ).id;

    garzon = await post<GarzonCreado>('/api/garzones', {
      nombre: `Garzón idempotencia E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salonId = (
      await post<IdResponse>('/api/salones', {
        nombre: `Salón idempotencia E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa idempotencia',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    const fallos: string[] = [];
    try {
      const sesion = await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${token}`)
        .send({ garzonId: garzon.id, pin: garzon.pin });
      if (![200, 201].includes(sesion.status))
        fallos.push(`cerrar sesión del garzón → ${sesion.status}`);
      await cerrarCaja(app, token, caja);
    } catch (e) {
      fallos.push((e as Error).message);
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  it('la transacción corre en READ COMMITTED (el duplicado concurrente se apoya en esto)', async () => {
    // Si el `SELECT` de `reproducir` no viera la fila que el `ON CONFLICT`
    // esperó a que se commitee, el segundo request daría 500 en vez de
    // reproducir. En READ COMMITTED cada sentencia toma su propio snapshot.
    const nivel: { transaction_isolation: string }[] = await ds.transaction(
      (m) => m.query('SHOW transaction_isolation'),
    );
    expect(nivel[0].transaction_isolation).toBe('read committed');
  });

  describe('POST /ventas', () => {
    it('la misma clave dos veces: una sola venta, un solo descuento de stock, y la segunda dice repetida', async () => {
      const clave = randomUUID();
      const ventasAntes = await ventasDelTenant();
      const stockAntes = await stockDelLocal();

      const primera = await cobrar('/api/ventas', lineaVenta(), clave);
      expect(primera.status).toBe(201);
      const segunda = await cobrar('/api/ventas', lineaVenta(), clave);
      expect(segunda.status).toBe(201);

      const a = primera.body as VentaRes;
      const b = segunda.body as VentaRes;
      expect(a.repetida).toBeUndefined();
      expect(b.repetida).toBe(true);
      expect(b.id).toBe(a.id);
      // Reproduce la respuesta entera, boleta incluida: es lo que imprime la
      // pantalla cuando la primera respuesta se perdió.
      expect(b).toEqual({ ...a, repetida: true });
      expect(await ventasDelTenant()).toBe(ventasAntes + 1);
      expect(await stockDelLocal()).toBe(stockAntes - 1);
    });

    it('la misma clave con otros datos: 422 con la venta, y no se crea nada', async () => {
      const clave = randomUUID();
      const primera = await cobrar('/api/ventas', lineaVenta(), clave);
      expect(primera.status).toBe(201);
      const ventasAntes = await ventasDelTenant();

      const otra = await cobrar(
        '/api/ventas',
        {
          ...lineaVenta(),
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '200000.0000' }],
        },
        clave,
      );

      expect(otra.status).toBe(422);
      expect(otra.body as OtrosDatosRes).toEqual({
        statusCode: 422,
        message: MENSAJE_OTROS_DATOS,
        ventaId: (primera.body as VentaRes).id,
      });
      expect(await ventasDelTenant()).toBe(ventasAntes);
    });

    it('sin cabecera o con una que no es UUID: 400', async () => {
      const sin = await cobrar('/api/ventas', lineaVenta());
      expect(sin.status).toBe(400);
      const mala = await cobrar('/api/ventas', lineaVenta(), 'no-es-uuid');
      expect(mala.status).toBe(400);
    });

    it('un primer intento rechazado no deja rastro: el reintento con la misma clave corre como nuevo', async () => {
      const clave = randomUUID();
      const sinStock = await cobrar('/api/ventas', lineaVenta('100000'), clave);
      expect(sinStock.status).toBe(400);

      const corregido = await cobrar('/api/ventas', lineaVenta('1'), clave);
      expect(corregido.status).toBe(201);
      expect((corregido.body as VentaRes).repetida).toBeUndefined();
    });

    it('la clave es por usuario: la misma clave de otro usuario no reproduce su respuesta', async () => {
      // Por SQL: montar un segundo usuario con caja propia solo para esto
      // exige un setup de cajas que comparte usuarios del seed. El estado es
      // alcanzable por la API —otro usuario que usó la misma clave—, y lo que
      // se prueba es exactamente el alcance del índice único.
      const clave = randomUUID();
      await ds.query(
        `INSERT INTO solicitudes_idempotentes
           (tenant_id, usuario_id, clave, operacion, huella, respuesta)
         VALUES ($1, $2, $3, 'venta.crear', 'huella-ajena', '{"id":"ajena"}')`,
        [PARIS_TENANT_ID, randomUUID(), clave],
      );

      const res = await cobrar('/api/ventas', lineaVenta(), clave);
      expect(res.status).toBe(201);
      const venta = res.body as VentaRes;
      expect(venta.repetida).toBeUndefined();
      expect(venta.id).not.toBe('ajena');
    });

    it('dos requests simultáneos con la misma clave: una sola venta', async () => {
      const clave = randomUUID();
      const ventasAntes = await ventasDelTenant();

      const [a, b] = await Promise.all([
        cobrar('/api/ventas', lineaVenta(), clave),
        cobrar('/api/ventas', lineaVenta(), clave),
      ]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      const ra = a.body as VentaRes;
      const rb = b.body as VentaRes;
      expect(ra.id).toBe(rb.id);
      expect([ra.repetida, rb.repetida].filter(Boolean)).toEqual([true]);
      expect(await ventasDelTenant()).toBe(ventasAntes + 1);
    });
  });

  describe('POST /cuentas/:id/cerrar', () => {
    async function cuentaConUnaLinea(): Promise<string> {
      const cuenta = await post<IdResponse>(`/api/mesas/${mesaId}/cuentas`, {
        garzonId: garzon.id,
        pin: garzon.pin,
      });
      await post(`/api/cuentas/${cuenta.id}/lineas`, {
        itemId,
        cantidad: '1',
      });
      return cuenta.id;
    }

    const cierre = (pin: string, monto = '100000.0000') => ({
      garzonId: garzon.id,
      pin,
      pagos: [{ metodoPagoId: EFECTIVO_ID, monto }],
    });

    it('reintentar un cierre que entró reproduce la venta, no "La cuenta no está abierta"', async () => {
      const cuentaId = await cuentaConUnaLinea();
      const clave = randomUUID();
      const ventasAntes = await ventasDelTenant();

      const primera = await cobrar(
        `/api/cuentas/${cuentaId}/cerrar`,
        cierre(garzon.pin),
        clave,
      );
      expect(primera.status).toBe(201);
      const segunda = await cobrar(
        `/api/cuentas/${cuentaId}/cerrar`,
        cierre(garzon.pin),
        clave,
      );
      expect(segunda.status).toBe(201);

      expect((segunda.body as CierreRes).repetida).toBe(true);
      expect((segunda.body as CierreRes).ventaId).toBe(
        (primera.body as CierreRes).ventaId,
      );
      expect(await ventasDelTenant()).toBe(ventasAntes + 1);
    });

    it('la misma clave con otros pagos: 422 con la venta', async () => {
      const cuentaId = await cuentaConUnaLinea();
      const clave = randomUUID();
      const primera = await cobrar(
        `/api/cuentas/${cuentaId}/cerrar`,
        cierre(garzon.pin),
        clave,
      );
      expect(primera.status).toBe(201);

      const otra = await cobrar(
        `/api/cuentas/${cuentaId}/cerrar`,
        cierre(garzon.pin, '200000.0000'),
        clave,
      );
      expect(otra.status).toBe(422);
      expect((otra.body as OtrosDatosRes).ventaId).toBe(
        (primera.body as CierreRes).ventaId,
      );
    });

    it('el PIN se vuelve a pedir: un reintento con PIN equivocado se rechaza, no se reproduce', async () => {
      const cuentaId = await cuentaConUnaLinea();
      const clave = randomUUID();
      const primera = await cobrar(
        `/api/cuentas/${cuentaId}/cerrar`,
        cierre(garzon.pin),
        clave,
      );
      expect(primera.status).toBe(201);

      const pinMalo = garzon.pin === '000000' ? '111111' : '000000';
      const reintento = await cobrar(
        `/api/cuentas/${cuentaId}/cerrar`,
        cierre(pinMalo),
        clave,
      );
      // `verificarPin` rechaza con 400 a propósito (garzones.service.ts).
      expect(reintento.status).toBe(400);
      expect((reintento.body as CierreRes).repetida).toBeUndefined();
    });

    it('si el garzón marcó salida entre el cierre y el reintento, igual reproduce', async () => {
      // Garzón propio de este caso: su sesión se cierra a mitad del test.
      const otro = await post<GarzonCreado>('/api/garzones', {
        nombre: `Garzón salida E2E ${Date.now()}`,
      });
      await post('/api/sesiones-garzon/iniciar', {
        garzonId: otro.id,
        pin: otro.pin,
        turnoId: TURNO_MANANA_ID,
      });
      const cuenta = await post<IdResponse>(`/api/mesas/${mesaId}/cuentas`, {
        garzonId: otro.id,
        pin: otro.pin,
      });
      await post(`/api/cuentas/${cuenta.id}/lineas`, { itemId, cantidad: '1' });
      const cierreOtro = {
        garzonId: otro.id,
        pin: otro.pin,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
      };
      const clave = randomUUID();

      const primera = await cobrar(
        `/api/cuentas/${cuenta.id}/cerrar`,
        cierreOtro,
        clave,
      );
      expect(primera.status).toBe(201);
      await post('/api/sesiones-garzon/cerrar', {
        garzonId: otro.id,
        pin: otro.pin,
      });

      const reintento = await cobrar(
        `/api/cuentas/${cuenta.id}/cerrar`,
        cierreOtro,
        clave,
      );
      expect(reintento.status).toBe(201);
      expect((reintento.body as CierreRes).repetida).toBe(true);
      expect((reintento.body as CierreRes).ventaId).toBe(
        (primera.body as CierreRes).ventaId,
      );
    });

    it('sin cabecera: 400', async () => {
      const cuentaId = await cuentaConUnaLinea();
      const res = await cobrar(
        `/api/cuentas/${cuentaId}/cerrar`,
        cierre(garzon.pin),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('POST /pagos (abono)', () => {
    async function ventaPendiente(): Promise<string> {
      const venta = await post<VentaRes>('/api/ventas', {
        lineas: [{ itemId, cantidad: '1' }],
      });
      expect(venta.estado).toBe('pendiente');
      return venta.id;
    }

    const pagosDe = (ventaId: string) =>
      contar(
        `SELECT count(*) AS n FROM pagos
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );

    const abono = (ventaId: string, monto = '100.0000') => ({
      ventaId,
      pagos: [{ metodoPagoId: EFECTIVO_ID, monto }],
    });

    it('el mismo abono dos veces: un solo pago y la segunda dice repetida', async () => {
      const ventaId = await ventaPendiente();
      const clave = randomUUID();

      const primero = await cobrar('/api/pagos', abono(ventaId), clave);
      expect(primero.status).toBe(201);
      const segundo = await cobrar('/api/pagos', abono(ventaId), clave);
      expect(segundo.status).toBe(201);

      expect((primero.body as AbonoRes).repetida).toBeUndefined();
      expect((segundo.body as AbonoRes).repetida).toBe(true);
      expect((segundo.body as AbonoRes).venta.saldo).toBe(
        (primero.body as AbonoRes).venta.saldo,
      );
      expect(await pagosDe(ventaId)).toBe(1);
    });

    it('la misma clave con otro monto: 422 con la venta abonada', async () => {
      const ventaId = await ventaPendiente();
      const clave = randomUUID();
      const primero = await cobrar('/api/pagos', abono(ventaId), clave);
      expect(primero.status).toBe(201);

      const otro = await cobrar(
        '/api/pagos',
        abono(ventaId, '200.0000'),
        clave,
      );
      expect(otro.status).toBe(422);
      expect((otro.body as OtrosDatosRes).ventaId).toBe(ventaId);
      expect(await pagosDe(ventaId)).toBe(1);
    });

    it('sin cabecera: 400', async () => {
      const ventaId = await ventaPendiente();
      const res = await cobrar('/api/pagos', abono(ventaId));
      expect(res.status).toBe(400);
    });
  });
});
