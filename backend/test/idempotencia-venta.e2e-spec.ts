import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { MENSAJE_OTROS_DATOS } from '../src/modules/idempotencia/idempotencia.service';
import { MENSAJE_NOTA_CREDITO_OTROS_DATOS } from '../src/modules/ventas/ventas.service';
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
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
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
interface NotaRes {
  id: string;
  movimientoCajaId: string | null;
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
    app.useGlobalPipes(validacionGlobal());
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

    it('una clave ya usada en una venta no se reusa para un abono: 422, y no se abona nada', async () => {
      // La clave es de `(tenant, usuario, clave)` y NO de la operación: el
      // abono cae en la MISMA fila que reclamó el cobro de mostrador. Lo que
      // lo delata es el `ventaId` del 422 — es la venta de la primera
      // operación, no la que el abono venía a pagar.
      const clave = randomUUID();
      const mostrador = await cobrar('/api/ventas', lineaVenta(), clave);
      expect(mostrador.status).toBe(201);

      const ventaId = await ventaPendiente();
      const res = await cobrar('/api/pagos', abono(ventaId), clave);

      expect(res.status).toBe(422);
      expect(res.body as OtrosDatosRes).toEqual({
        statusCode: 422,
        message: MENSAJE_OTROS_DATOS,
        ventaId: (mostrador.body as VentaRes).id,
      });
      expect(await pagosDe(ventaId)).toBe(0);
    });

    it('sin cabecera: 400', async () => {
      const ventaId = await ventaPendiente();
      const res = await cobrar('/api/pagos', abono(ventaId));
      expect(res.status).toBe(400);
    });
  });
  describe('POST /ventas/:id/notas-credito', () => {
    async function ventaCobradaEnEfectivo(): Promise<{
      ventaId: string;
      pagoId: string;
    }> {
      const venta = await post<VentaRes>('/api/ventas', lineaVenta());
      const pagos: { pago_id: string }[] = await ds.query(
        `SELECT pago_id FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [venta.id],
      );
      expect(pagos).toHaveLength(1);
      return { ventaId: venta.id, pagoId: pagos[0].pago_id };
    }

    async function ventaPendiente(): Promise<string> {
      const venta = await post<VentaRes>('/api/ventas', {
        lineas: [{ itemId, cantidad: '1' }],
      });
      expect(venta.estado).toBe('pendiente');
      return venta.id;
    }

    /** La SERIE de correcciones de la venta, no una nota suelta. */
    async function serieDe(
      ventaId: string,
    ): Promise<{ notas: number; acreditado: string }> {
      const filas: { notas: string; acreditado: string }[] = await ds.query(
        `SELECT count(*) AS notas,
                COALESCE(SUM(total_final), 0)::numeric(18,0)::text AS acreditado
           FROM ventas
          WHERE venta_referencia_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );
      return {
        notas: Number(filas[0].notas),
        acreditado: filas[0].acreditado,
      };
    }

    /** Lo que salió de la caja por las notas de esa venta. */
    const salidasDeCaja = (ventaId: string) =>
      contar(
        `SELECT COALESCE(SUM(mc.monto), 0)::numeric(18,0) AS n
           FROM movimientos_caja mc
           JOIN ventas nc ON nc.venta_id = mc.venta_id
                         AND nc.eliminado_el IS NULL
          WHERE nc.venta_referencia_id = $1
            AND mc.tipo = 'salida' AND mc.eliminado_el IS NULL`,
        [ventaId],
      );

    const nota = (monto: string, devolucion: Record<string, unknown>) => ({
      monto,
      devolucion,
    });

    it('la misma clave dos veces: una sola nota en la serie, y la segunda reproduce la primera', async () => {
      const ventaId = await ventaPendiente();
      const clave = randomUUID();
      const url = `/api/ventas/${ventaId}/notas-credito`;
      const cuerpo = nota('300', { sinPlata: true });

      const primera = await cobrar(url, cuerpo, clave);
      expect(primera.status).toBe(201);
      const segunda = await cobrar(url, cuerpo, clave);
      expect(segunda.status).toBe(201);

      const a = primera.body as NotaRes;
      const b = segunda.body as NotaRes;
      expect(a.repetida).toBeUndefined();
      expect(b).toEqual({ ...a, repetida: true });
      expect(await serieDe(ventaId)).toEqual({ notas: 1, acreditado: '300' });
    });

    it('devolviendo en efectivo, la misma clave dos veces: el efectivo sale una sola vez', async () => {
      const { ventaId, pagoId } = await ventaCobradaEnEfectivo();
      const clave = randomUUID();
      const url = `/api/ventas/${ventaId}/notas-credito`;
      const cuerpo = nota('300', { pagoId });

      const primera = await cobrar(url, cuerpo, clave);
      expect(primera.status).toBe(201);
      const segunda = await cobrar(url, cuerpo, clave);
      expect(segunda.status).toBe(201);

      // La reproducción trae el MISMO movimiento: la pantalla sabe que la
      // salida de caja ya está registrada, y es una sola.
      expect((segunda.body as NotaRes).movimientoCajaId).toBe(
        (primera.body as NotaRes).movimientoCajaId,
      );
      expect(await serieDe(ventaId)).toEqual({ notas: 1, acreditado: '300' });
      expect(await salidasDeCaja(ventaId)).toBe(300);
    });

    it('la nota que dejó la venta pagada (y sin disponible) se reproduce: el reintento no rebota con el tope', async () => {
      // "No vuelve plata" por todo lo que se debía: la venta pasa a pagada y la
      // serie agota su disponible. Si el tope corriera antes del reclamo, el
      // reintento diría "excede lo disponible" sobre una nota que sí entró.
      const ventaId = await ventaPendiente();
      const [{ total }]: { total: string }[] = await ds.query(
        `SELECT total_final::numeric(18,0)::text AS total
           FROM ventas WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );
      const clave = randomUUID();
      const url = `/api/ventas/${ventaId}/notas-credito`;
      const cuerpo = nota(total, { sinPlata: true });

      const primera = await cobrar(url, cuerpo, clave);
      expect(primera.status).toBe(201);
      const [{ estado }]: { estado: string }[] = await ds.query(
        `SELECT estado FROM ventas
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );
      expect(estado).toBe('pagada');

      const segunda = await cobrar(url, cuerpo, clave);
      expect(segunda.status).toBe(201);
      expect((segunda.body as NotaRes).repetida).toBe(true);
      expect(await serieDe(ventaId)).toEqual({ notas: 1, acreditado: total });
    });

    it('la misma clave con otro monto: 422 con la nota que entró, y la serie no crece', async () => {
      const { ventaId, pagoId } = await ventaCobradaEnEfectivo();
      const clave = randomUUID();
      const url = `/api/ventas/${ventaId}/notas-credito`;
      const primera = await cobrar(url, nota('300', { pagoId }), clave);
      expect(primera.status).toBe(201);

      const otra = await cobrar(url, nota('200', { pagoId }), clave);

      expect(otra.status).toBe(422);
      expect(otra.body as OtrosDatosRes).toEqual({
        statusCode: 422,
        message: MENSAJE_NOTA_CREDITO_OTROS_DATOS,
        ventaId: (primera.body as NotaRes).id,
      });
      expect(await serieDe(ventaId)).toEqual({ notas: 1, acreditado: '300' });
      expect(await salidasDeCaja(ventaId)).toBe(300);
    });

    it('dos intentos distintos con el mismo cuerpo son dos notas: la serie legítima no se frena', async () => {
      // El cliente devolvió un producto y, más tarde, otro igual: el mismo
      // monto por el mismo pago, pero dos intentos de la pantalla.
      const { ventaId, pagoId } = await ventaCobradaEnEfectivo();
      const url = `/api/ventas/${ventaId}/notas-credito`;
      const cuerpo = nota('300', { pagoId });

      expect((await cobrar(url, cuerpo, randomUUID())).status).toBe(201);
      expect((await cobrar(url, cuerpo, randomUUID())).status).toBe(201);

      expect(await serieDe(ventaId)).toEqual({ notas: 2, acreditado: '600' });
      expect(await salidasDeCaja(ventaId)).toBe(600);
    });

    it('un primer intento rechazado no deja la clave tomada: el reintento corregido emite', async () => {
      // $1.000 cobrados: $700 con débito y $300 en efectivo.
      const venta = await post<VentaRes>('/api/ventas', {
        lineas: [{ itemId, cantidad: '1' }],
        pagos: [
          { metodoPagoId: DEBITO_ID, monto: '700.0000' },
          { metodoPagoId: EFECTIVO_ID, monto: '300.0000' },
        ],
      });
      const ventaId = venta.id;
      const [{ pago_id: pagoId }]: { pago_id: string }[] = await ds.query(
        `SELECT pago_id FROM pagos
          WHERE venta_id = $1 AND metodo_pago_id = $2 AND eliminado_el IS NULL`,
        [ventaId, EFECTIVO_ID],
      );
      const clave = randomUUID();
      const url = `/api/ventas/${ventaId}/notas-credito`;

      // Más efectivo del que la venta cobró en efectivo: 422 por plata, con
      // su rastro escrito FUERA de la transacción que soltó la clave.
      const excedida = await cobrar(url, nota('500', { pagoId }), clave);
      expect(excedida.status).toBe(422);
      expect(await serieDe(ventaId)).toEqual({ notas: 0, acreditado: '0' });
      expect(
        await contar(
          `SELECT count(*) AS n FROM caja_intentos_rechazados
            WHERE venta_id = $1 AND eliminado_el IS NULL`,
          [ventaId],
        ),
      ).toBe(1);

      const corregida = await cobrar(url, nota('300', { pagoId }), clave);
      expect(corregida.status).toBe(201);
      expect((corregida.body as NotaRes).repetida).toBeUndefined();
      expect(await serieDe(ventaId)).toEqual({ notas: 1, acreditado: '300' });
    });

    it('dos requests simultáneos con la misma clave: una sola nota y una sola salida de caja', async () => {
      const { ventaId, pagoId } = await ventaCobradaEnEfectivo();
      const clave = randomUUID();
      const url = `/api/ventas/${ventaId}/notas-credito`;
      const cuerpo = nota('300', { pagoId });

      const [a, b] = await Promise.all([
        cobrar(url, cuerpo, clave),
        cobrar(url, cuerpo, clave),
      ]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      const ra = a.body as NotaRes;
      const rb = b.body as NotaRes;
      expect(ra.id).toBe(rb.id);
      expect([ra.repetida, rb.repetida].filter(Boolean)).toEqual([true]);
      expect(await serieDe(ventaId)).toEqual({ notas: 1, acreditado: '300' });
      expect(await salidasDeCaja(ventaId)).toBe(300);
    });

    it('sin cabecera o con una que no es UUID: 400, y no se emite nada', async () => {
      const ventaId = await ventaPendiente();
      const url = `/api/ventas/${ventaId}/notas-credito`;
      const cuerpo = nota('300', { sinPlata: true });

      expect((await cobrar(url, cuerpo)).status).toBe(400);
      expect((await cobrar(url, cuerpo, 'no-es-uuid')).status).toBe(400);
      expect(await serieDe(ventaId)).toEqual({ notas: 0, acreditado: '0' });
    });
  });
});
