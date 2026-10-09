import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { abrirCaja } from './helpers/caja';

/**
 * Una entrada que dejaría el esperado de una caja sin caber en `NUMERIC(18,4)`
 * es 400 al entrar la plata, no un 500 en el conteo (owner, 2026-10-09).
 *
 * El esperado es `saldo inicial + entradas − salidas` y se congela al contar
 * (`caja_arqueo_medio.esperado`, `cajas.saldo_final`). Lo que desborda es la
 * SUMA: cada movimiento cabe. Hasta esa fecha el conteo daba 500 y la caja
 * quedaba trabada hasta que alguien registraba una salida.
 *
 * Una prueba por camino por el que entra plata —el movimiento manual, la venta
 * del POS, el cierre de una cuenta, el abono, la reversa del pago a un
 * proveedor— y, en cada una, tres cosas: el 400, que no quedó nada escrito, y
 * que **el conteo de la caja cierra** (es la razón de ser del freno). Los
 * controles prueban que lo que cabe justo pasa y que otro medio de pago no se
 * mira. Montos distintos entre sí, ningún 1 ni factor repetido que deje vivo un
 * mutante.
 *
 * ⚠️ **El techo se alcanza con el fondo de la caja (o un movimiento plantado) y
 * ventas de $1.490, nunca con ventas de 10^13.** Esas ventas quedan en `ventas`
 * del tenant y desplazan al ítem de `resumen-negocio.e2e-spec.ts` del primer
 * puesto de «más vendidos» (medido el 2026-10-09).
 *
 * ⚠️ Sin `eliminado_el IS NULL` en los conteos, a propósito: lo que se cuenta es
 * si el pedido escribió algo, y una fila borrada también sería una escritura.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const TARJETA_CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
/** Sobre el umbral de la Res. Ex. SII 44/2025 la boleta lleva quién paga. */
const PAGADOR = { nombre: 'Juana Pérez Soto', rut: '12.345.678-5' };

const TECHO = '100.000.000.000.000';
const MENSAJE_EFECTIVO = `dejaría el saldo de la caja en $${TECHO} o más`;

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface ArqueoLinea {
  metodoPagoId: string | null;
  esperado: string | null;
}

describe('El esperado de una caja que no cabe se frena al entrar la plata (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let garzon: { id: string; pin: string };
  let mesaId: string;
  let productoId: string;
  let proveedorId: string;
  const cuentasAbiertas: string[] = [];
  const cajasAbiertas: string[] = [];

  function enviar(ruta: string, body: object) {
    return request(app.getHttpServer())
      .post(`/api/${ruta}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  async function crear<T = IdResponse>(ruta: string, body: object): Promise<T> {
    const res = await enviar(ruta, body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  /** El 400 y su mensaje, juntos: un 500 o un 422 no pasan por acá. */
  function mensajes(res: { status: number; body: unknown }): string {
    expect(res.status).toBe(400);
    const m = (res.body as { message?: string | string[] }).message ?? '';
    return [m].flat().join(' ');
  }

  async function contar(sql: string, params: unknown[]): Promise<number> {
    const filas: { n: string }[] = await ds.query(sql, params);
    return Number(filas[0].n);
  }

  /** Todo lo que entra plata a una caja deja alguna de estas tres filas. */
  async function escrito(cajaId: string) {
    return {
      ventas: await contar(
        `SELECT count(*) AS n FROM ventas WHERE caja_id = $1`,
        [cajaId],
      ),
      pagos: await contar(
        `SELECT count(*) AS n FROM pagos WHERE caja_id = $1`,
        [cajaId],
      ),
      movimientos: await contar(
        `SELECT count(*) AS n FROM movimientos_caja WHERE caja_id = $1`,
        [cajaId],
      ),
    };
  }

  async function arqueo(cajaId: string): Promise<ArqueoLinea[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/arqueo`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { lineas: ArqueoLinea[] }).lineas;
  }

  /**
   * El conteo que la fase 1 tiene que poder cerrar: cuenta EXACTO el esperado
   * de cada línea, así que si el freno funcionó la caja cuadra y se auto-cierra.
   * Es la prueba de que la caja no quedó trabada. Devuelve el esperado de
   * efectivo para que el test lo afirme.
   */
  async function contarYCerrar(cajaId: string): Promise<string> {
    const lineas = await arqueo(cajaId);
    const res = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/conteo`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: lineas.map((l) => ({
          metodoPagoId: l.metodoPagoId,
          montoContado: l.esperado,
        })),
      });
    expect(res.status).toBe(201);
    expect((res.body as { estado: string }).estado).toBe('cerrada');
    const i = cajasAbiertas.indexOf(cajaId);
    if (i >= 0) cajasAbiertas.splice(i, 1);
    return lineas.find((l) => l.metodoPagoId === null)!.esperado!;
  }

  async function abrir(saldoInicial: string): Promise<string> {
    const caja = await abrirCaja(app, token, {
      saldoInicial,
      comentario: 'Apertura E2E esperado',
    });
    cajasAbiertas.push(caja.id);
    return caja.id;
  }

  function movimiento(cajaId: string, tipo: string, monto: string) {
    return request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo, concepto: `${tipo} E2E`, monto });
  }

  function vender(productoDe: string, pagos: object[]) {
    return enviar('ventas', {
      lineas: [{ itemId: productoDe, cantidad: '1' }],
      pagos,
      customer: PAGADOR,
    });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;

    const marca = randomUUID().slice(0, 8);
    productoId = (
      await crear('items', {
        nombre: `Producto E2E ${marca}`,
        precioBase: '1490',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        clasificacionTributaria: 'exento',
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '100',
      })
    ).id;
    proveedorId = (
      await crear('terceros', {
        tipo: 'proveedor',
        nombre: `Proveedor esperado E2E ${marca}`,
      })
    ).id;

    // Garzón PROPIO: la sesión es única por garzón y las suites comparten seed.
    garzon = await crear<{ id: string; pin: string }>('garzones', {
      nombre: `Garzón esperado E2E ${marca}`,
    });
    await crear('sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salon = await crear('salones', {
      nombre: `Salón esperado E2E ${marca}`,
    });
    mesaId = (
      await crear(`salones/${salon.id}/mesas`, { nombre: 'Mesa esperado' })
    ).id;
  }, 60000);

  afterAll(async () => {
    try {
      for (const cuentaId of cuentasAbiertas) {
        await enviar(`cuentas/${cuentaId}/cancelar`, {});
      }
      await enviar('sesiones-garzon/cerrar', {
        garzonId: garzon.id,
        pin: garzon.pin,
      });
      // Higiene: si un test falló a mitad, la caja quedó abierta y la suite
      // siguiente toparía con un 409 al abrir.
      for (const cajaId of [...cajasAbiertas]) await contarYCerrar(cajaId);
    } finally {
      await app.close();
    }
  });

  describe('la apertura', () => {
    it('un saldo inicial que no cabe es 400 y no abre la caja', async () => {
      const disp = await request(app.getHttpServer())
        .get('/api/caja/cajones-disponibles')
        .set('Authorization', `Bearer ${token}`);
      expect(disp.status).toBe(200);
      const cajonId = (disp.body as { cajonId: string }[])[0].cajonId;
      const cuentaCajas = () =>
        contar(`SELECT count(*) AS n FROM cajas WHERE tenant_id = $1`, [
          PARIS_TENANT_ID,
        ]);
      const antes = await cuentaCajas();

      const res = await enviar('caja/abrir', {
        cajonId,
        saldoInicial: '100000000000000',
      });
      expect(mensajes(res)).toContain(`$${TECHO} o más`);
      expect(await cuentaCajas()).toBe(antes);
    });
  });

  describe('el movimiento manual de entrada', () => {
    it('con la apertura en el techo, +$1 es 400, no escribe y el conteo cierra', async () => {
      const cajaId = await abrir('99999999999999');
      const antes = await escrito(cajaId);

      expect(mensajes(await movimiento(cajaId, 'entrada', '1'))).toContain(
        MENSAJE_EFECTIVO,
      );
      expect(await escrito(cajaId)).toEqual(antes);

      expect(await contarYCerrar(cajaId)).toBe('99999999999999.0000');
    });

    it('controles: lo que cabe justo pasa y las salidas siguen andando', async () => {
      const cajaId = await abrir('99999999999998');

      // 99.999.999.999.998 + 1 = 99.999.999.999.999: el máximo que cabe.
      expect((await movimiento(cajaId, 'entrada', '1')).status).toBe(201);
      // ...y ahí una unidad más ya no.
      expect(mensajes(await movimiento(cajaId, 'entrada', '1'))).toContain(
        MENSAJE_EFECTIVO,
      );
      // La salida resta: no se mira contra el techo.
      expect((await movimiento(cajaId, 'salida', '7')).status).toBe(201);
      // Con la salida, otra entrada de 7 vuelve a llenar la caja sin pasarla.
      expect((await movimiento(cajaId, 'entrada', '7')).status).toBe(201);

      expect(await contarYCerrar(cajaId)).toBe('99999999999999.0000');
    });
  });

  describe('la venta del POS', () => {
    it('efectivo: la segunda venta que desborda es 400, no escribe y el conteo cierra', async () => {
      // 99.999.999.998.000 de fondo: caben dos ventas de $1.490 sobre cero, no
      // sobre el techo. Una venta de 10^13 ensuciaría el ranking de más
      // vendidos de las otras suites; el freno se prueba igual con el fondo.
      const cajaId = await abrir('99999999998000');
      const pagoEfectivo = [{ metodoPagoId: EFECTIVO_ID, monto: '1490' }];

      // 99.999.999.998.000 + 1.490 = 99.999.999.999.490: cabe.
      expect((await vender(productoId, pagoEfectivo)).status).toBe(201);
      const antes = await escrito(cajaId);

      // 99.999.999.999.490 + 1.490 = 100.000.000.000.980: no cabe.
      expect(mensajes(await vender(productoId, pagoEfectivo))).toContain(
        MENSAJE_EFECTIVO,
      );
      expect(await escrito(cajaId)).toEqual(antes);

      expect(await contarYCerrar(cajaId)).toBe('99999999999490.0000');
    });

    it('dos pagos en efectivo que caben cada uno y desbordan juntos: 400 sin escribir ninguno', async () => {
      const cajaId = await abrir('99999999999000');
      const antes = await escrito(cajaId);

      // 99.999.999.999.000 + 700 y + 790 caben por separado; juntos suman
      // 100.000.000.000.490. El primero no puede quedar escrito.
      expect(
        mensajes(
          await vender(productoId, [
            { metodoPagoId: EFECTIVO_ID, monto: '700' },
            { metodoPagoId: EFECTIVO_ID, monto: '790' },
          ]),
        ),
      ).toContain(MENSAJE_EFECTIVO);
      expect(await escrito(cajaId)).toEqual(antes);

      // Control: la misma venta con parte en tarjeta entra; el efectivo solo
      // sube 400 y la tarjeta tiene su propio esperado.
      expect(
        (
          await vender(productoId, [
            { metodoPagoId: EFECTIVO_ID, monto: '400' },
            { metodoPagoId: TARJETA_CREDITO_ID, monto: '1090' },
          ])
        ).status,
      ).toBe(201);

      expect(await contarYCerrar(cajaId)).toBe('99999999999400.0000');
    });

    it('otro medio: la tarjeta tiene su propio esperado, y el efectivo no la mira', async () => {
      const cajaId = await abrir('0');
      // Las entradas de tarjeta de esta caja ya suman 99.999.999.999.000: se
      // planta el movimiento (y se borra al contar) en vez de vender 10^14.
      const [plantado]: { movimiento_id: string }[] = await ds.query(
        `INSERT INTO movimientos_caja
           (movimiento_id, caja_id, tipo, concepto, monto, metodo_pago_id,
            creado_el, actualizado_el)
         VALUES (gen_random_uuid(), $1, 'entrada', 'Plantado E2E esperado',
                 99999999999000, $2, NOW(), NOW())
         RETURNING movimiento_id`,
        [cajaId, TARJETA_CREDITO_ID],
      );
      const antes = await escrito(cajaId);

      // La línea de la tarjeta sumaría 100.000.000.000.490 y también se
      // congela en `caja_arqueo_medio.esperado`.
      const rechazo = mensajes(
        await vender(productoId, [
          { metodoPagoId: TARJETA_CREDITO_ID, monto: '1490' },
        ]),
      );
      expect(rechazo).toContain(`sumarían $${TECHO} o más`);
      expect(await escrito(cajaId)).toEqual(antes);

      // Control: el efectivo de esa misma caja está en cero y recibe la venta.
      expect(
        (
          await vender(productoId, [
            { metodoPagoId: EFECTIVO_ID, monto: '1490' },
          ])
        ).status,
      ).toBe(201);

      expect(await contarYCerrar(cajaId)).toBe('1490.0000');
      await ds.query(
        `UPDATE movimientos_caja SET eliminado_el = NOW()
          WHERE movimiento_id = $1`,
        [plantado.movimiento_id],
      );
    });
  });

  describe('la caja virtual', () => {
    it('no se mira: nunca se cuenta, y un cobro ya capturado por la pasarela no se rechaza', async () => {
      const [virtual]: { caja_id: string }[] = await ds.query(
        `SELECT caja_id FROM cajas
          WHERE tenant_id = $1 AND tipo = 'virtual' AND eliminado_el IS NULL`,
        [PARIS_TENANT_ID],
      );
      // La virtual acumula todas las ventas online del tenant: se le planta un
      // movimiento que, con el cobro de abajo, pasaría el techo en su línea de
      // tarjeta, y se borra (soft delete) al terminar.
      const [plantado]: { movimiento_id: string }[] = await ds.query(
        `INSERT INTO movimientos_caja
           (movimiento_id, caja_id, tipo, concepto, monto, metodo_pago_id,
            creado_el, actualizado_el)
         VALUES (gen_random_uuid(), $1, 'entrada', 'Plantado E2E esperado',
                 99999999999999, $2, NOW(), NOW())
         RETURNING movimiento_id`,
        [virtual.caja_id, TARJETA_CREDITO_ID],
      );
      try {
        const res = await enviar('ventas', {
          canal: 'online',
          lineas: [{ itemId: productoId, cantidad: '1' }],
          pagos: [{ metodoPagoId: TARJETA_CREDITO_ID, monto: '1490' }],
          customer: PAGADOR,
        });
        expect(res.status).toBe(201);
      } finally {
        await ds.query(
          `UPDATE movimientos_caja SET eliminado_el = NOW()
            WHERE movimiento_id = $1`,
          [plantado.movimiento_id],
        );
      }
    });
  });

  describe('el abono a una venta pendiente', () => {
    it('el abono en efectivo que desborda es 400, y el resto se cobra con otro medio', async () => {
      const cajaId = await abrir('99999999999000');
      // La venta pendiente no toca el esperado: no entra plata.
      const venta = await vender(productoId, []);
      expect(venta.status).toBe(201);
      const ventaId = (venta.body as IdResponse).id;
      const abonar = (metodoPagoId: string, monto: string) =>
        enviar('pagos', { ventaId, pagos: [{ metodoPagoId, monto }] });
      const antes = await escrito(cajaId);

      // 99.999.999.999.000 + 1.490 = 100.000.000.000.490.
      expect(mensajes(await abonar(EFECTIVO_ID, '1490'))).toContain(
        MENSAJE_EFECTIVO,
      );
      expect(await escrito(cajaId)).toEqual(antes);

      // Control: 490 caben (esperado 99.999.999.999.490)...
      expect((await abonar(EFECTIVO_ID, '490')).status).toBe(201);
      // ...y los 1.000 que faltan ya no, en efectivo.
      expect(mensajes(await abonar(EFECTIVO_ID, '1000'))).toContain(
        MENSAJE_EFECTIVO,
      );
      // Con otro medio de pago la venta se termina de cobrar.
      expect((await abonar(TARJETA_CREDITO_ID, '1000')).status).toBe(201);

      expect(await contarYCerrar(cajaId)).toBe('99999999999490.0000');
    });
  });

  describe('el cierre de una cuenta del salón', () => {
    it('cobrar en efectivo lo que desborda es 400 y la cuenta sigue abierta; con una salida entra', async () => {
      const cajaId = await abrir('99999999999000');
      const cuenta = await crear(`mesas/${mesaId}/cuentas`, {
        garzonId: garzon.id,
        pin: garzon.pin,
      });
      cuentasAbiertas.push(cuenta.id);
      await crear(`cuentas/${cuenta.id}/lineas`, {
        itemId: productoId,
        cantidad: '1',
      });
      const cerrar = () =>
        enviar(`cuentas/${cuenta.id}/cerrar`, {
          garzonId: garzon.id,
          pin: garzon.pin,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1490' }],
          customer: PAGADOR,
        });
      const antes = await escrito(cajaId);

      expect(mensajes(await cerrar())).toContain(MENSAJE_EFECTIVO);
      expect(await escrito(cajaId)).toEqual(antes);
      const [fila]: { estado: string }[] = await ds.query(
        `SELECT estado FROM cuentas
          WHERE cuenta_id = $1 AND eliminado_el IS NULL`,
        [cuenta.id],
      );
      expect(fila.estado).toBe('abierta');

      // Control: el cajero baja el saldo con una salida y la cuenta se cobra.
      expect((await movimiento(cajaId, 'salida', '1000')).status).toBe(201);
      expect((await cerrar()).status).toBe(201);
      cuentasAbiertas.splice(cuentasAbiertas.indexOf(cuenta.id), 1);

      // 99.999.999.999.000 − 1.000 + 1.490.
      expect(await contarYCerrar(cajaId)).toBe('99999999999490.0000');
    });
  });

  describe('la reversa del pago a un proveedor', () => {
    it('anular un pago cuya reversa desborda es 400 y el pago sigue vigente; con una salida se anula', async () => {
      const cajaId = await abrir('99999999999000');
      const pago = await enviar('compras/pagos', {
        proveedorId,
        monto: '500',
        metodoPagoId: EFECTIVO_ID,
        aplicaciones: [],
      });
      expect(pago.status).toBe(201);
      const pagoId = (pago.body as IdResponse).id;
      // 99.999.999.999.000 − 500 + 1.000 = 99.999.999.999.500: cabe.
      expect((await movimiento(cajaId, 'entrada', '1000')).status).toBe(201);
      const anular = () =>
        enviar(`compras/pagos/${pagoId}/anular`, { motivo: 'Prueba E2E' });
      const antes = await escrito(cajaId);

      // La reversa devuelve 500: 99.999.999.999.500 + 500 = 10^14 justo.
      expect(mensajes(await anular())).toContain(MENSAJE_EFECTIVO);
      expect(await escrito(cajaId)).toEqual(antes);
      const [fila]: { estado: string }[] = await ds.query(
        `SELECT estado FROM pagos_proveedor WHERE pago_proveedor_id = $1`,
        [pagoId],
      );
      expect(fila.estado).toBe('vigente');

      // Control: con 600 menos en la caja la reversa cabe (…998.900 + 500).
      expect((await movimiento(cajaId, 'salida', '600')).status).toBe(201);
      expect((await anular()).status).toBe(201);

      expect(await contarYCerrar(cajaId)).toBe('99999999999400.0000');
    });
  });
});
