import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * Un monto que la venta va a persistir y no cabe en `NUMERIC(18,4)` es 400 en
 * `CalculoPreciosService.calcular`, antes de escribir nada (2026-10-08). Hasta
 * esa fecha el motor lo calculaba, la previsualización lo mostraba con 201 y el
 * `INSERT` daba 500 (`22003 numeric field overflow`).
 *
 * Una prueba por puerta que persiste —la venta del POS, la venta online, el
 * cierre de una cuenta— y, en cada una, que no quedó nada escrito: ni venta, ni
 * detalle, ni movimiento de stock, ni pago, ni movimiento de caja. Los montos
 * caben de a uno y desbordan al multiplicarse (73.456.789.012.345 × 2), o caben
 * convertidos y no en la moneda del ítem (USD a 0,5): ningún 1, ningún factor
 * que se confunda con otro.
 *
 * ⚠️ Sin `eliminado_el IS NULL` en los conteos, a propósito: lo que se cuenta es
 * si el pedido escribió algo, y una fila borrada también sería una escritura.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const USD_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440005';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const TARJETA_CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
/** Sobre el umbral de la Res. Ex. SII 44/2025 la boleta lleva quién paga. */
const PAGADOR = { nombre: 'Juana Pérez Soto', rut: '12.345.678-5' };

const TECHO =
  'el sistema no puede guardar montos de $100.000.000.000.000 o más';
/** 73.456.789.012.345 × 2. */
const SUBTOTAL_FUERA = '146.913.578.024.690';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}

describe('Un monto que no cabe en su columna es 400, no 500 (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta | undefined;
  let garzon: { id: string; pin: string };
  let mesaId: string;
  /** La tasa del USD antes del spec (puede ser `null`); `undefined` = no se tocó. */
  let usdOriginal: string | null | undefined;
  const cuentasAbiertas: string[] = [];

  /** Producto de 73.456.789.012.345 con stock: cabe de a uno, no de a dos. */
  let productoId: string;
  let productoNombre: string;
  /** Receta en USD al tope de su columna + un extra de 1 USD. */
  let recetaUsdId: string;
  let recetaUsdNombre: string;
  let extraId: string;
  /** Servicio común, para los controles que sí se venden. */
  let servicioId: string;

  function enviar(ruta: string, body: object) {
    return request(app.getHttpServer())
      .post(`/api/${ruta}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  function mensajes(res: { status: number; body: unknown }): string[] {
    expect(res.status).toBe(400);
    return [(res.body as { message?: string | string[] }).message ?? []].flat();
  }

  async function crear<T = IdResponse>(ruta: string, body: object): Promise<T> {
    const res = await enviar(ruta, body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  async function contar(sql: string, params: unknown[]): Promise<number> {
    const filas: { n: string }[] = await ds.query(sql, params);
    return Number(filas[0].n);
  }

  /** Todo lo que una venta escribe, contado de una vez. */
  async function escrito(itemIds: string[]) {
    return {
      ventas: await contar(
        `SELECT count(*) AS n FROM ventas WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      ),
      detalles: await contar(
        `SELECT count(*) AS n FROM venta_detalles WHERE item_id = ANY($1)`,
        [itemIds],
      ),
      stock: await contar(
        `SELECT count(*) AS n FROM movimientos_inventario WHERE item_id = ANY($1)`,
        [itemIds],
      ),
      pagos: await contar(
        `SELECT count(*) AS n FROM pagos WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      ),
      // Todas las cajas del tenant, no solo la del spec: la venta online va a
      // la caja virtual.
      caja: await contar(
        `SELECT count(*) AS n FROM movimientos_caja mc
           JOIN cajas c ON c.caja_id = mc.caja_id
          WHERE c.tenant_id = $1`,
        [PARIS_TENANT_ID],
      ),
    };
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
    productoNombre = `Producto al tope E2E ${marca}`;
    productoId = (
      await crear('items', {
        nombre: productoNombre,
        precioBase: '73456789012345',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        clasificacionTributaria: 'exento',
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '100',
      })
    ).id;
    extraId = (
      await crear('items', {
        nombre: `Queso al tope E2E ${marca}`,
        precioBase: '100',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '100',
      })
    ).id;
    recetaUsdNombre = `Receta en USD al tope E2E ${marca}`;
    recetaUsdId = (
      await crear('items', {
        nombre: recetaUsdNombre,
        precioBase: '99999999999999',
        monedaId: USD_MONEDA_ID,
        tipo: 'receta',
        clasificacionTributaria: 'exento',
        ingredientes: [
          {
            ingredienteItemId: extraId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: false,
          },
        ],
        extrasPermitidos: [
          {
            ingredienteItemId: extraId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            precioExtra: '1',
          },
        ],
      })
    ).id;
    servicioId = (
      await crear('items', {
        nombre: `Servicio común E2E ${marca}`,
        precioBase: '1490',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
        clasificacionTributaria: 'exento',
      })
    ).id;

    // Garzón PROPIO: la sesión es única por garzón y las suites comparten seed.
    garzon = await crear<{ id: string; pin: string }>('garzones', {
      nombre: `Garzón al tope E2E ${marca}`,
    });
    await crear('sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salon = await crear('salones', {
      nombre: `Salón al tope E2E ${marca}`,
    });
    mesaId = (await crear(`salones/${salon.id}/mesas`, { nombre: 'Mesa tope' }))
      .id;

    caja = await abrirCaja(app, token, { comentario: 'Apertura E2E tope' });

    // USD a 0,5: la API acepta cualquier tasa, y con una menor que 1 el precio
    // en la moneda del ítem puede no caber aunque el convertido sí.
    const [usd]: { valor_del_dia: string | null }[] = await ds.query(
      `SELECT valor_del_dia::text FROM tenant_moneda
        WHERE tenant_id = $1 AND moneda_id = $2 AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID, USD_MONEDA_ID],
    );
    usdOriginal = usd?.valor_del_dia ?? null;
    const patch = await request(app.getHttpServer())
      .patch(`/api/monedas/${USD_MONEDA_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ valorDelDia: '0.5' });
    expect(patch.status).toBe(200);
  }, 60000);

  afterAll(async () => {
    try {
      if (usdOriginal !== undefined) {
        await request(app.getHttpServer())
          .patch(`/api/monedas/${USD_MONEDA_ID}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ valorDelDia: usdOriginal });
      }
      for (const cuentaId of cuentasAbiertas) {
        await enviar(`cuentas/${cuentaId}/cancelar`, {});
      }
      await enviar('sesiones-garzon/cerrar', {
        garzonId: garzon.id,
        pin: garzon.pin,
      });
      if (caja) await cerrarCaja(app, token, caja);
    } finally {
      await app.close();
    }
  });

  const lineaUsd = () => ({
    itemId: recetaUsdId,
    cantidad: '1',
    personalizacion: { extras: [{ ingredienteItemId: extraId }] },
  });
  const ORIGEN_FUERA = () =>
    `«${recetaUsdNombre}» cuesta 100.000.000.000.000 en su moneda, y ` +
    'el sistema no puede guardar montos de 100.000.000.000.000 o más: ' +
    'revisá el precio y los extras';

  describe('las puertas que persisten: 400 y nada escrito', () => {
    it('POST /ventas del POS: un subtotal que no cabe', async () => {
      const antes = await escrito([productoId]);
      const res = await enviar('ventas', {
        lineas: [{ itemId: productoId, cantidad: '2' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '5000' }],
        customer: PAGADOR,
      });
      expect(mensajes(res)).toEqual([
        `«${productoNombre}» da $${SUBTOTAL_FUERA}, y ${TECHO}: revisá el precio y la cantidad`,
      ]);
      expect(await escrito([productoId])).toEqual(antes);
    });

    it('POST /ventas del POS: un precio que no cabe en la moneda del ítem', async () => {
      const antes = await escrito([recetaUsdId, extraId]);
      const res = await enviar('ventas', {
        lineas: [lineaUsd()],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '5000' }],
        customer: PAGADOR,
      });
      expect(mensajes(res)).toEqual([ORIGEN_FUERA()]);
      expect(await escrito([recetaUsdId, extraId])).toEqual(antes);
    });

    it('POST /ventas online: pago completo, y el origen no cabe', async () => {
      // Convertido cabe: (99.999.999.999.999 + 1) × 0,5 = 50.000.000.000.000.
      const antes = await escrito([recetaUsdId, extraId]);
      const res = await enviar('ventas', {
        canal: 'online',
        lineas: [lineaUsd()],
        pagos: [{ metodoPagoId: TARJETA_CREDITO_ID, monto: '50000000000000' }],
        customer: PAGADOR,
      });
      expect(mensajes(res)).toEqual([ORIGEN_FUERA()]);
      expect(await escrito([recetaUsdId, extraId])).toEqual(antes);
    });

    it('POST /cuentas/:id/cerrar: la cuenta sigue abierta y sin venta', async () => {
      const cuenta = await crear(`mesas/${mesaId}/cuentas`, {
        garzonId: garzon.id,
        pin: garzon.pin,
      });
      cuentasAbiertas.push(cuenta.id);
      // Cada línea cabe al pedirla: 73.456.789.012.345 por unidad.
      await crear(`cuentas/${cuenta.id}/lineas`, {
        itemId: productoId,
        cantidad: '2',
      });

      const antes = await escrito([productoId]);
      const res = await enviar(`cuentas/${cuenta.id}/cerrar`, {
        garzonId: garzon.id,
        pin: garzon.pin,
        pagos: [],
        customer: PAGADOR,
      });
      expect(mensajes(res)).toEqual([
        `«${productoNombre}» da $${SUBTOTAL_FUERA}, y ${TECHO}: revisá el precio y la cantidad`,
      ]);
      expect(await escrito([productoId])).toEqual(antes);
      const [fila]: { estado: string }[] = await ds.query(
        `SELECT estado FROM cuentas
          WHERE cuenta_id = $1 AND eliminado_el IS NULL`,
        [cuenta.id],
      );
      expect(fila.estado).toBe('abierta');

      // La precuenta de la misma mesa dice lo mismo, en vez de un total que
      // después no se puede cobrar.
      const pre = await enviar('calculo-precios/calcular', {
        cuentaId: cuenta.id,
        lineas: [{ itemId: servicioId, cantidad: '1' }],
      });
      expect(mensajes(pre)).toEqual([
        `«${productoNombre}» da $${SUBTOTAL_FUERA}, y ${TECHO}: revisá el precio y la cantidad`,
      ]);
    });
  });

  describe('las previsualizaciones dicen lo mismo que la venta', () => {
    it.each(['calculo-precios/calcular', 'online/checkout'] as const)(
      'POST /%s: el subtotal que no cabe es 400; cantidad 1 calcula',
      async (ruta) => {
        const subtotal = await enviar(ruta, {
          lineas: [{ itemId: productoId, cantidad: '2' }],
        });
        expect(mensajes(subtotal)).toEqual([
          `«${productoNombre}» da $${SUBTOTAL_FUERA}, y ${TECHO}: revisá el precio y la cantidad`,
        ]);

        // Control: el mismo producto de a uno cabe, y el total es el de siempre.
        const ok = await enviar(ruta, {
          lineas: [{ itemId: productoId, cantidad: '1' }],
        });
        expect(ok.status).toBe(201);
        const body = ok.body as {
          totales?: { totalFinal: string };
          resultado?: { totales: { totalFinal: string } };
        };
        expect((body.resultado ?? body).totales!.totalFinal).toBe(
          '73456789012345.000000',
        );
      },
    );
  });

  // Solo `/calcular`: la tienda descarta la personalización a propósito
  // (`OnlineService.prepararLineasCheckout`), así que ahí el origen es el
  // `precioBase` del ítem y siempre cabe.
  it('POST /calculo-precios/calcular: el origen que no cabe es 400', async () => {
    const origen = await enviar('calculo-precios/calcular', {
      lineas: [lineaUsd()],
    });
    expect(mensajes(origen)).toEqual([ORIGEN_FUERA()]);
  });

  /**
   * Los canales internos del motor —el precio convertido, desde este frente el
   * de la moneda del ítem, y las reglas congeladas de una cuenta— no están en
   * el DTO de la línea: el pipe global los rechaza nombrándolos. Es toda su
   * protección, así que se fija acá para los tres y en las cuatro puertas que
   * reciben líneas (la tienda las esparce hacia el motor que autoriza el cargo).
   * El control —el mismo pedido sin el campo— prueba que el 400 es por el campo.
   * `/online/pagar` queda afuera del control: con una pasarela activa abre una
   * orden.
   */
  describe('los canales internos del precio no entran por el body', () => {
    const CANALES: { campo: string; valor: unknown }[] = [
      { campo: 'precioUnitarioResuelto', valor: '1' },
      { campo: 'precioUnitarioOrigenResuelto', valor: '1' },
      { campo: 'reglasCongeladas', valor: { descuentos: [], recargos: [] } },
    ];
    const FILAS = (
      [
        'ventas',
        'calculo-precios/calcular',
        'online/checkout',
        'online/pagar',
      ] as const
    ).flatMap((ruta) => CANALES.map((c) => ({ ruta, ...c })));
    const cuerpo = (ruta: string, extra: Record<string, unknown> = {}) => ({
      lineas: [{ itemId: servicioId, cantidad: '1', ...extra }],
      ...(ruta === 'ventas'
        ? { pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1490' }] }
        : {}),
    });

    it.each(FILAS)(
      'POST /$ruta con lineas.0.$campo: 400 nombrando el campo, y no escribe',
      async ({ ruta, campo, valor }) => {
        const antes = await escrito([servicioId]);
        const res = await enviar(ruta, cuerpo(ruta, { [campo]: valor }));
        expect(mensajes(res)).toContain(
          `lineas.0.property ${campo} should not exist`,
        );
        expect(await escrito([servicioId])).toEqual(antes);
      },
    );

    it.each(['ventas', 'calculo-precios/calcular', 'online/checkout'] as const)(
      'control en /%s: sin el campo, la línea se cobra a su precio de catálogo',
      async (ruta) => {
        const res = await enviar(ruta, cuerpo(ruta));
        expect(res.status).toBe(201);
        if (ruta === 'ventas') {
          const [venta]: { total_final: string }[] = await ds.query(
            `SELECT total_final::text FROM ventas
              WHERE venta_id = $1 AND eliminado_el IS NULL`,
            [(res.body as IdResponse).id],
          );
          expect(venta.total_final).toBe('1490.0000');
        } else {
          const body = res.body as {
            totales?: { totalFinal: string };
            resultado?: { totales: { totalFinal: string } };
          };
          expect((body.resultado ?? body).totales!.totalFinal).toBe(
            '1490.000000',
          );
        }
      },
    );
  });
});
