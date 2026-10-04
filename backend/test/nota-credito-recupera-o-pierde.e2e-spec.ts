import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';
import { Db } from '../src/common/db/db.service';
import { MotivosBajaService } from '../src/modules/motivos-baja/motivos-baja.service';

const TENANT_DEMO = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const DEBITO = '550e8400-e29b-41d4-a716-446655440106';
const PROVINCIA_ID = '550e8400-e29b-41d4-a716-446655440001';
const SUPERADMIN = { email: 'admin@sistema.com', pass: 'admin' };

/**
 * La venta de todos los casos (CLP, IVA 19% encima del neto):
 *
 *   3 × Hamburguesa (receta: 1 pan + 0,25 kg de carne)   1.190 c/u → 3.570
 *   1 × Combo (1 Hamburguesa + 1 Bebida)                  2.380
 *   2 × Bebida (producto suelto, la misma del combo)      1.190 c/u → 2.380
 *   1 × Instalación (servicio exento)                     3.000
 *                                                 total 11.330
 *
 * La Bebida va suelta Y dentro del combo a propósito: es el caso en que la
 * vuelta de un componente se mezclaba con las unidades devueltas del producto
 * suelto.
 */
const TOTAL = '11330';

interface TokenResponse {
  access_token: string;
}

/**
 * La nota de crédito pregunta si lo devuelto se recupera o se pierde (owner,
 * 2026-08-23; spec `2026-10-04-nc-recupera-o-pierde-design.md`).
 */
describe('Nota de crédito: ¿se recupera o se pierde? (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let panId: string;
  let carneId: string;
  let bebidaId: string;
  let hamburguesaId: string;
  let comboId: string;
  let servicioId: string;

  const http = () => request(app.getHttpServer());

  const crearItem = async (body: Record<string, unknown>): Promise<string> => {
    const res = await http()
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ monedaId: CLP, ...body });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  };

  const crearVenta = async (): Promise<string> => {
    const res = await http()
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({
        canal: 'online',
        lineas: [
          { itemId: hamburguesaId, cantidad: '3' },
          { itemId: comboId, cantidad: '1' },
          { itemId: bebidaId, cantidad: '2' },
          { itemId: servicioId, cantidad: '1' },
        ],
        pagos: [{ metodoPagoId: DEBITO, monto: `${TOTAL}.0000` }],
      });
    expect(res.status).toBe(201);
    expect((res.body as { totalFinal: string }).totalFinal).toBe(
      `${TOTAL}.0000`,
    );
    return (res.body as { id: string }).id;
  };

  const pagoDe = async (ventaId: string): Promise<string> => {
    const pagos: { pago_id: string }[] = await ds.query(
      `SELECT pago_id FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    expect(pagos).toHaveLength(1);
    return pagos[0].pago_id;
  };

  const nota = async (
    ventaId: string,
    monto: string,
    devoluciones: Record<string, unknown>[],
  ) =>
    http()
      .post(`/api/ventas/${ventaId}/notas-credito`)
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({
        monto,
        comentario: 'Devolución E2E',
        devolucion: { pagoId: await pagoDe(ventaId) },
        devoluciones,
      });

  const stock = async (itemId: string): Promise<string> => {
    const filas: { stock: string }[] = await ds.query(
      `SELECT COALESCE(SUM(stock), 0)::text AS stock
         FROM stock_ubicacion WHERE item_id = $1`,
      [itemId],
    );
    return new Decimal(filas[0].stock).toString();
  };

  const cpp = async (itemId: string): Promise<string | null> => {
    const filas: { costo_actual: string | null }[] = await ds.query(
      `SELECT costo_actual FROM item_producto WHERE item_id = $1`,
      [itemId],
    );
    return filas[0].costo_actual;
  };

  /** Los movimientos que dejó la nota, sin los de la venta. */
  const movimientosDe = async (
    ncId: string,
  ): Promise<
    {
      item_id: string;
      tipo: string;
      motivo: string;
      cantidad: string;
      costo_unitario: string | null;
      costo_informado: boolean;
      venta_detalle_id: string | null;
      motivo_baja: string | null;
    }[]
  > =>
    ds.query(
      `SELECT m.item_id, m.tipo, m.motivo, m.cantidad::text AS cantidad,
              m.costo_unitario::text AS costo_unitario, m.costo_informado,
              m.venta_detalle_id, mb.nombre AS motivo_baja
         FROM movimientos_inventario m
         LEFT JOIN motivo_baja mb ON mb.motivo_baja_id = m.motivo_baja_id
        WHERE m.venta_id = $1
        ORDER BY m.secuencia`,
      [ncId],
    );

  const lineaDe = async (ventaId: string, itemId: string): Promise<string> => {
    const filas: { detalle_id: string }[] = await ds.query(
      `SELECT detalle_id FROM venta_detalles
        WHERE venta_id = $1 AND item_id = $2 AND eliminado_el IS NULL`,
      [ventaId, itemId],
    );
    expect(filas).toHaveLength(1);
    return filas[0].detalle_id;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const login = await http()
      .post('/api/auth/login')
      .send({ email: 'admin.paris@paris.cl', password: 'admin' });
    expect(login.status).toBe(200);
    const tenant = await http()
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: TENANT_DEMO });
    expect(tenant.status).toBe(200);
    token = (tenant.body as TokenResponse).access_token;

    // Todo propio: el stock del seed lo mueven otras suites.
    const sufijo = Date.now();
    panId = await crearItem({
      nombre: `RP pan E2E ${sufijo}`,
      precioBase: '0',
      tipo: 'ingrediente',
      unidadMedida: 'unidad',
      stock: '200',
      costo: '200',
    });
    carneId = await crearItem({
      nombre: `RP carne E2E ${sufijo}`,
      precioBase: '0',
      tipo: 'ingrediente',
      unidadMedida: 'kg',
      stock: '100',
      costo: '8000',
    });
    bebidaId = await crearItem({
      nombre: `RP bebida E2E ${sufijo}`,
      precioBase: '1000',
      tipo: 'producto',
      clasificacionTributaria: 'afecto',
      modoInventario: 'cantidad',
      unidadMedida: 'unidad',
      stock: '200',
      costo: '500',
    });
    hamburguesaId = await crearItem({
      nombre: `RP hamburguesa E2E ${sufijo}`,
      precioBase: '1000',
      tipo: 'receta',
      clasificacionTributaria: 'afecto',
      ingredientes: [
        {
          ingredienteItemId: panId,
          cantidad: '1',
          unidadCodigo: 'unidad',
          bloqueante: true,
        },
        {
          ingredienteItemId: carneId,
          cantidad: '0.25',
          unidadCodigo: 'kg',
          bloqueante: true,
        },
      ],
    });
    comboId = await crearItem({
      nombre: `RP combo E2E ${sufijo}`,
      precioBase: '2000',
      tipo: 'combo',
      clasificacionTributaria: 'afecto',
      componentes: [
        { componenteItemId: hamburguesaId, cantidad: '1', bloqueante: true },
        { componenteItemId: bebidaId, cantidad: '1', bloqueante: true },
      ],
    });
    servicioId = await crearItem({
      nombre: `RP instalación E2E ${sufijo}`,
      precioBase: '3000',
      tipo: 'servicio',
      clasificacionTributaria: 'exento',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('la venta liga cada salida a su línea, también los ingredientes y los componentes', async () => {
    const ventaId = await crearVenta();
    const salidas: { item_id: string; venta_detalle_id: string | null }[] =
      await ds.query(
        `SELECT item_id, venta_detalle_id FROM movimientos_inventario
          WHERE venta_id = $1 AND motivo = 'venta'`,
        [ventaId],
      );
    const lineaHamburguesa = await lineaDe(ventaId, hamburguesaId);
    const lineaCombo = await lineaDe(ventaId, comboId);
    const lineaBebida = await lineaDe(ventaId, bebidaId);
    const porLinea = (linea: string) =>
      salidas
        .filter((s) => s.venta_detalle_id === linea)
        .map((s) => s.item_id)
        .sort();
    expect(porLinea(lineaHamburguesa)).toEqual([panId, carneId].sort());
    expect(porLinea(lineaCombo)).toEqual([panId, carneId, bebidaId].sort());
    expect(porLinea(lineaBebida)).toEqual([bebidaId]);
    expect(salidas.every((s) => s.venta_detalle_id !== null)).toBe(true);
  });

  it('el detalle dice qué preguntar por línea: la receta y el combo tienen stock, el servicio no', async () => {
    const ventaId = await crearVenta();
    const res = await http()
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const porItem = new Map(
      (
        res.body as {
          detalles: { itemId: string; devolucionStock: string }[];
        }
      ).detalles.map((d) => [d.itemId, d.devolucionStock]),
    );
    expect(porItem.get(hamburguesaId)).toBe('recuperable');
    expect(porItem.get(comboId)).toBe('recuperable');
    expect(porItem.get(bebidaId)).toBe('recuperable');
    expect(porItem.get(servicioId)).toBe('sin_stock');
  });

  describe('la respuesta es obligatoria donde hay stock, y solo ahí', () => {
    it('una receta sin respuesta es 400 y no emite nada', async () => {
      const ventaId = await crearVenta();
      const res = await nota(ventaId, '1190', [
        { itemId: hamburguesaId, cantidad: '1' },
      ]);
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toMatch(
        /Falta decir si ".*hamburguesa.*" se recupera/,
      );
      const notas: unknown[] = await ds.query(
        `SELECT 1 FROM ventas WHERE venta_referencia_id = $1`,
        [ventaId],
      );
      expect(notas).toHaveLength(0);
    });

    it('un servicio con respuesta es 400: no sacó nada del inventario', async () => {
      const ventaId = await crearVenta();
      const res = await nota(ventaId, '3000', [
        { itemId: servicioId, cantidad: '1', stock: 'pierde' },
      ]);
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toMatch(
        /no sacó nada del inventario/,
      );
    });

    it('el campo viejo `reponerStock` ya no existe: 400 que lo nombra', async () => {
      const ventaId = await crearVenta();
      const res = await nota(ventaId, '1190', [
        { itemId: bebidaId, cantidad: '1', reponerStock: true },
      ]);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('reponerStock');
    });
  });

  it('se recupera: la receta repone sus ingredientes al costo de la salida, ligados a la línea', async () => {
    const ventaId = await crearVenta();
    const [panAntes, carneAntes] = [await stock(panId), await stock(carneId)];
    const res = await nota(ventaId, '1190', [
      { itemId: hamburguesaId, cantidad: '1', stock: 'recupera' },
    ]);
    expect(res.status).toBe(201);
    const ncId = (res.body as { id: string }).id;

    expect(await stock(panId)).toBe(new Decimal(panAntes).plus(1).toString());
    expect(await stock(carneId)).toBe(
      new Decimal(carneAntes).plus('0.25').toString(),
    );
    const linea = await lineaDe(ventaId, hamburguesaId);
    const movs = await movimientosDe(ncId);
    expect(movs.map((m) => [m.item_id, m.tipo, m.motivo, m.cantidad])).toEqual(
      [
        [panId, 'entrada', 'devolucion', '1.0000'],
        [carneId, 'entrada', 'devolucion', '0.2500'],
      ].sort((a, b) => a[0].localeCompare(b[0])),
    );
    expect(movs.every((m) => m.venta_detalle_id === linea)).toBe(true);
    expect(movs.find((m) => m.item_id === carneId)!.costo_unitario).toBe(
      '8000.0000',
    );
  });

  it('se pierde: vuelve y sale como merma "Devolución" — stock y CPP intactos, y el reporte de mermas la ve', async () => {
    const ventaId = await crearVenta();
    const [panAntes, carneAntes] = [await stock(panId), await stock(carneId)];
    const cppAntes = await cpp(carneId);
    const res = await nota(ventaId, '1190', [
      { itemId: hamburguesaId, cantidad: '1', stock: 'pierde' },
    ]);
    expect(res.status).toBe(201);
    const ncId = (res.body as { id: string }).id;

    expect(await stock(panId)).toBe(panAntes);
    expect(await stock(carneId)).toBe(carneAntes);
    expect(await cpp(carneId)).toBe(cppAntes);

    const carne = (await movimientosDe(ncId)).filter(
      (m) => m.item_id === carneId,
    );
    expect(carne).toEqual([
      expect.objectContaining({
        tipo: 'entrada',
        motivo: 'devolucion',
        cantidad: '0.2500',
        // Al costo de la salida pero sin promediar: rehacer la cuenta tampoco
        // la promedia (`costo_informado` en falso).
        costo_unitario: '8000.0000',
        costo_informado: false,
      }),
      expect.objectContaining({
        tipo: 'salida',
        motivo: 'merma',
        cantidad: '0.2500',
        costo_unitario: '8000.0000',
        motivo_baja: 'Devolución',
      }),
    ]);

    const mermas = await http()
      .get(`/api/mermas?itemId=${carneId}&pageSize=100`)
      .set('Authorization', `Bearer ${token}`);
    expect(mermas.status).toBe(200);
    const deLaNota = (
      mermas.body as {
        data: {
          motivoBajaNombre: string;
          cantidad: string;
          costoPerdido: string;
        }[];
      }
    ).data.filter((m) => m.motivoBajaNombre === 'Devolución');
    expect(deLaNota.length).toBeGreaterThanOrEqual(1);
    expect(new Decimal(deLaNota[0].costoPerdido).toString()).toBe('2000');
  });

  // Decidido por la Sesión de esfuerzo máximo (2026-10-04): la entrada de lo que
  // se pierde congela el MISMO costo de salida que la merma y no promedia. Para
  // que el caso discrimine, entre la venta y la nota una compra mueve el CPP: con
  // el CPP de hoy congelado en la entrada, el teórico de varianza quedaría en 0
  // unidades pero con plata.
  it('punta a punta: lo que se pierde no cambia stock ni CPP, y el teórico de varianza queda en 0 en cantidad y en plata', async () => {
    const res = await http()
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({
        canal: 'online',
        lineas: [{ itemId: bebidaId, cantidad: '1' }],
        pagos: [{ metodoPagoId: DEBITO, monto: '1190.0000' }],
      });
    expect(res.status).toBe(201);
    const ventaId = (res.body as { id: string }).id;
    const salida: { costo_unitario: string }[] = await ds.query(
      `SELECT costo_unitario::text AS costo_unitario FROM movimientos_inventario
        WHERE venta_id = $1 AND item_id = $2 AND motivo = 'venta'`,
      [ventaId, bebidaId],
    );
    const costoSalida = salida[0].costo_unitario;

    const local: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [TENANT_DEMO],
    );
    const compra = await http()
      .patch(`/api/items/${bebidaId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ubicacionId: local[0].ubicacion_id,
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '10',
        costoUnitario: '900',
      });
    expect(compra.status).toBe(200);
    const cppAntes = await cpp(bebidaId);
    expect(new Decimal(cppAntes!).eq(costoSalida)).toBe(false);
    const stockAntes = await stock(bebidaId);

    const nc = await nota(ventaId, '1190', [
      { itemId: bebidaId, cantidad: '1', stock: 'pierde' },
    ]);
    expect(nc.status).toBe(201);
    const ncId = (nc.body as { id: string }).id;

    expect(await stock(bebidaId)).toBe(stockAntes);
    expect(await cpp(bebidaId)).toBe(cppAntes);
    const movs = await movimientosDe(ncId);
    expect(movs.map((m) => [m.motivo, m.costo_unitario])).toEqual([
      ['devolucion', costoSalida],
      ['merma', costoSalida],
    ]);

    // El teórico de varianza (`reportes/varianza`, predicados TEORICO_SALIDA y
    // TEORICO_ENTRADA, con `Σ ROUND(cantidad × costo, 4)`) sobre la venta y su nota.
    const teorico: { cantidad: string; plata: string }[] = await ds.query(
      `SELECT
         (COALESCE(SUM(mv.cantidad) FILTER (WHERE mv.motivo = 'venta' AND mv.tipo = 'salida'), 0)
          - COALESCE(SUM(mv.cantidad) FILTER (
              WHERE mv.motivo IN ('anulacion', 'devolucion') AND mv.tipo = 'entrada'
                AND mv.venta_id IS NOT NULL), 0))::text AS cantidad,
         (COALESCE(SUM(ROUND(mv.cantidad * mv.costo_unitario, 4)) FILTER (
              WHERE mv.motivo = 'venta' AND mv.tipo = 'salida'), 0)
          - COALESCE(SUM(ROUND(mv.cantidad * mv.costo_unitario, 4)) FILTER (
              WHERE mv.motivo IN ('anulacion', 'devolucion') AND mv.tipo = 'entrada'
                AND mv.venta_id IS NOT NULL), 0))::text AS plata
         FROM movimientos_inventario mv
        WHERE mv.item_id = $1 AND mv.venta_id IN ($2, $3)
          AND mv.eliminado_el IS NULL`,
      [bebidaId, ventaId, ncId],
    );
    expect(new Decimal(teorico[0].cantidad).isZero()).toBe(true);
    expect(new Decimal(teorico[0].plata).isZero()).toBe(true);
    // Y la merma, por q × costo de salida.
    const merma = await http()
      .get(`/api/mermas?itemId=${bebidaId}&pageSize=100`)
      .set('Authorization', `Bearer ${token}`);
    expect(merma.status).toBe(200);
    const deLaNota = (
      merma.body as {
        data: { motivoBajaNombre: string; costoPerdido: string }[];
      }
    ).data.filter((m) => m.motivoBajaNombre === 'Devolución');
    expect(
      deLaNota.map((m) => new Decimal(m.costoPerdido).toString()),
    ).toContain(new Decimal(costoSalida).toString());
  });

  it('una serie de notas parciales devuelve exacto lo que salió por la línea', async () => {
    const ventaId = await crearVenta();
    const carneAntes = await stock(carneId);
    for (const destino of ['recupera', 'pierde', 'recupera']) {
      const res = await nota(ventaId, '1190', [
        { itemId: hamburguesaId, cantidad: '1', stock: destino },
      ]);
      expect(res.status).toBe(201);
    }
    // Lo que salió por las 3 hamburguesas (0,75 kg): 0,5 volvió y 0,25 se mermó.
    expect(await stock(carneId)).toBe(
      new Decimal(carneAntes).plus('0.5').toString(),
    );
    const vueltas: { total: string }[] = await ds.query(
      `SELECT SUM(m.cantidad)::text AS total
         FROM movimientos_inventario m
         JOIN ventas nc ON nc.venta_id = m.venta_id
        WHERE nc.venta_referencia_id = $1 AND m.item_id = $2
          AND m.motivo = 'devolucion'`,
      [ventaId, carneId],
    );
    expect(new Decimal(vueltas[0].total).toString()).toBe('0.75');
    // Y una cuarta no entra: ya no quedan hamburguesas por devolver.
    const cuarta = await nota(ventaId, '1190', [
      { itemId: hamburguesaId, cantidad: '1', stock: 'recupera' },
    ]);
    expect(cuarta.status).toBe(400);
  });

  // Revisión independiente (2026-10-04): una línea que queda FUERA del documento
  // —escalada a $0 porque la nota acredita poco frente a lo devuelto— igual
  // devuelve su stock. Para una receta, sus vueltas son de ingredientes y no
  // cuentan como unidades de la receta: si el contador no leyera lo que la nota
  // guardó (`ventas.devoluciones`), quedaba en 0 y la misma hamburguesa volvía
  // dos veces.
  it('una receta escalada a $0 fuera del documento igual cuenta como devuelta: no vuelve dos veces', async () => {
    const tele = await crearItem({
      nombre: `RP tele E2E ${Date.now()}`,
      precioBase: '1000000',
      tipo: 'producto',
      clasificacionTributaria: 'afecto',
      modoInventario: 'cantidad',
      unidadMedida: 'unidad',
      stock: '5',
      costo: '500000',
    });
    const venta = await http()
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({
        canal: 'online',
        lineas: [
          { itemId: tele, cantidad: '1' },
          { itemId: hamburguesaId, cantidad: '1' },
        ],
        pagos: [{ metodoPagoId: DEBITO, monto: '1191190.0000' }],
      });
    expect(venta.status).toBe(201);
    const ventaId = (venta.body as { id: string }).id;
    const panAntes = await stock(panId);

    const primera = await nota(ventaId, '10', [
      { itemId: tele, cantidad: '1', stock: 'recupera' },
      { itemId: hamburguesaId, cantidad: '1', stock: 'recupera' },
    ]);
    expect(primera.status).toBe(201);
    const ncId = (primera.body as { id: string }).id;
    // Premisa: la hamburguesa quedó fuera del documento y su pan volvió igual.
    const lineas: { item_id: string }[] = await ds.query(
      `SELECT item_id FROM venta_detalles WHERE venta_id = $1`,
      [ncId],
    );
    expect(lineas.map((l) => l.item_id)).not.toContain(hamburguesaId);
    expect(await stock(panId)).toBe(new Decimal(panAntes).plus(1).toString());

    const segunda = await nota(ventaId, '1190', [
      { itemId: hamburguesaId, cantidad: '1', stock: 'recupera' },
    ]);
    expect(segunda.status).toBe(400);
    expect((segunda.body as { message: string }).message).toContain(
      'excede lo disponible (0)',
    );
    expect(await stock(panId)).toBe(new Decimal(panAntes).plus(1).toString());
  });

  // Sesión de esfuerzo máximo (2026-10-04, duda 8): la nota guarda lo que
  // devolvió y el contador cuenta de ahí. Un celular con serie que "se pierde" no
  // deja movimiento, y escalado a $0 tampoco deja línea: sin `ventas.devoluciones`
  // la misma unidad se podía devolver otra vez.
  it('un producto con serie que se pierde, escalado a $0 fuera del documento, tampoco vuelve dos veces', async () => {
    const sufijo = `${Date.now()}`;
    const tele = await crearItem({
      nombre: `RP tele serie E2E ${sufijo}`,
      precioBase: '1000000',
      tipo: 'producto',
      clasificacionTributaria: 'afecto',
      modoInventario: 'cantidad',
      unidadMedida: 'unidad',
      stock: '5',
      costo: '500000',
    });
    const celular = await crearItem({
      nombre: `RP celular E2E ${sufijo}`,
      precioBase: '1000',
      tipo: 'producto',
      clasificacionTributaria: 'afecto',
      modoInventario: 'serie',
    });
    const local: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [TENANT_DEMO],
    );
    const entrada = await http()
      .patch(`/api/items/${celular}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: local[0].ubicacion_id,
        cantidad: '1',
        series: [{ serie: `IMEI-RP-${sufijo}`, condicion: 'nuevo' }],
      });
    expect(entrada.status).toBe(200);
    const unidades = await http()
      .get(`/api/items/${celular}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(unidades.status).toBe(200);
    const [unidad] = unidades.body as { id: string }[];

    const venta = await http()
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({
        canal: 'online',
        lineas: [
          { itemId: tele, cantidad: '1' },
          { itemId: celular, cantidad: '1', unidadIds: [unidad.id] },
        ],
        pagos: [{ metodoPagoId: DEBITO, monto: '1191190.0000' }],
      });
    expect(venta.status).toBe(201);
    const ventaId = (venta.body as { id: string }).id;

    const primera = await nota(ventaId, '10', [
      { itemId: tele, cantidad: '1', stock: 'recupera' },
      { itemId: celular, cantidad: '1', stock: 'pierde' },
    ]);
    expect(primera.status).toBe(201);
    const ncId = (primera.body as { id: string }).id;
    // Premisa: el celular no dejó ni línea en el documento ni movimiento.
    const lineas: { item_id: string }[] = await ds.query(
      `SELECT item_id FROM venta_detalles WHERE venta_id = $1`,
      [ncId],
    );
    expect(lineas.map((l) => l.item_id)).not.toContain(celular);
    const movs: unknown[] = await ds.query(
      `SELECT 1 FROM movimientos_inventario WHERE venta_id = $1 AND item_id = $2`,
      [ncId, celular],
    );
    expect(movs).toHaveLength(0);
    // Lo que sí queda: lo que devolvió, con lo que contestó el cajero.
    const congeladas: { devoluciones: unknown }[] = await ds.query(
      `SELECT devoluciones FROM ventas WHERE venta_id = $1`,
      [ncId],
    );
    expect(congeladas[0].devoluciones).toEqual(
      expect.arrayContaining([
        { itemId: celular, cantidad: '1', stock: 'pierde' },
      ]),
    );

    const segunda = await nota(ventaId, '1190', [
      { itemId: celular, cantidad: '1', stock: 'pierde' },
    ]);
    expect(segunda.status).toBe(400);
    expect((segunda.body as { message: string }).message).toContain(
      'excede lo disponible (0)',
    );
  });

  it('una nota anterior a la columna (devoluciones en NULL) se sigue contando por sus huellas', async () => {
    const ventaId = await crearVenta();
    const primera = await nota(ventaId, '2380', [
      { itemId: bebidaId, cantidad: '2', stock: 'recupera' },
    ]);
    expect(primera.status).toBe(201);
    // Así quedaba una nota antes del 2026-10-04.
    await ds.query(
      `UPDATE ventas SET devoluciones = NULL WHERE venta_id = $1`,
      [(primera.body as { id: string }).id],
    );

    const detalle = await http()
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detalle.status).toBe(200);
    const bebida = (
      detalle.body as {
        detalles: { itemId: string; cantidadDevuelta: string }[];
      }
    ).detalles.find((d) => d.itemId === bebidaId)!;
    expect(new Decimal(bebida.cantidadDevuelta).toString()).toBe('2');

    const otra = await nota(ventaId, '1190', [
      { itemId: bebidaId, cantidad: '1', stock: 'recupera' },
    ]);
    expect(otra.status).toBe(400);
  });

  it('el combo devuelve sus componentes, y su Bebida no se descuenta de la Bebida suelta', async () => {
    const ventaId = await crearVenta();
    const bebidaAntes = await stock(bebidaId);
    const combo = await nota(ventaId, '2380', [
      { itemId: comboId, cantidad: '1', stock: 'recupera' },
    ]);
    expect(combo.status).toBe(201);
    expect(await stock(bebidaId)).toBe(
      new Decimal(bebidaAntes).plus(1).toString(),
    );

    // Las 2 Bebidas sueltas siguen disponibles enteras: la del combo es otra
    // línea. Antes de ligar el kardex a la línea, la vuelta del componente
    // contaba como una Bebida devuelta y esto daba 400.
    const sueltas = await nota(ventaId, '2380', [
      { itemId: bebidaId, cantidad: '2', stock: 'recupera' },
    ]);
    expect(sueltas.status).toBe(201);
    expect(await stock(bebidaId)).toBe(
      new Decimal(bebidaAntes).plus(3).toString(),
    );
  });

  describe('la causa fija "Devolución"', () => {
    it('está en el catálogo como fija y marcada, y POST /mermas la rechaza', async () => {
      const motivos = await http()
        .get('/api/motivos-baja')
        .set('Authorization', `Bearer ${token}`);
      expect(motivos.status).toBe(200);
      const devolucion = (
        motivos.body as {
          id: string;
          nombre: string;
          esFijo: boolean;
          esDevolucion: boolean;
          tipo: string;
        }[]
      ).filter((m) => m.esDevolucion);
      expect(devolucion).toEqual([
        expect.objectContaining({
          nombre: 'Devolución',
          esFijo: true,
          tipo: 'merma',
        }),
      ]);

      const local: { ubicacion_id: string }[] = await ds.query(
        `SELECT ubicacion_id FROM ubicaciones
          WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
        [TENANT_DEMO],
      );
      const merma = await http()
        .post('/api/mermas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          itemId: bebidaId,
          ubicacionId: local[0].ubicacion_id,
          cantidad: '1',
          motivoBajaId: devolucion[0].id,
        });
      expect(merma.status).toBe(400);
      expect((merma.body as { message: string }).message).toMatch(
        /la deja la nota de crédito/,
      );
    });

    it('un tenant nuevo nace con ella, y uno sin ella la recibe al necesitarla', async () => {
      const login = await http()
        .post('/api/auth/login')
        .send({ email: SUPERADMIN.email, password: SUPERADMIN.pass });
      expect(login.status).toBe(200);
      const creado = await http()
        .post('/api/admin/tenants')
        .set(
          'Authorization',
          `Bearer ${(login.body as TokenResponse).access_token}`,
        )
        .send({
          nombre: `E2E Devolución ${Date.now()}`,
          correo: `e2e.devolucion.${Date.now()}@test.cl`,
          provinciaId: PROVINCIA_ID,
        });
      expect(creado.status).toBe(201);
      const tenantId = (creado.body as { id: string }).id;
      const marcadas = (): Promise<
        { motivo_baja_id: string; nombre: string; es_fijo: boolean }[]
      > =>
        ds.query(
          `SELECT motivo_baja_id, nombre, es_fijo FROM motivo_baja
            WHERE tenant_id = $1 AND es_devolucion AND eliminado_el IS NULL`,
          [tenantId],
        );
      expect(await marcadas()).toEqual([
        expect.objectContaining({ nombre: 'Devolución', es_fijo: true }),
      ]);

      // Un tenant de antes de la causa (Railway) que además tiene un motivo
      // PROPIO llamado "Devolución": lo que queda es eso, sin marca ni fijo.
      const [propio]: { motivo_baja_id: string }[] = await ds
        .query(
          `UPDATE motivo_baja SET es_devolucion = false, es_fijo = false
          WHERE tenant_id = $1 AND es_devolucion
        RETURNING motivo_baja_id`,
          [tenantId],
        )
        .then((r: [unknown[], number]) => r[0] as { motivo_baja_id: string }[]);
      const motivos = app.get(MotivosBajaService);
      const db = app.get(Db);
      // Dos notas a la vez del mismo tenant: el `ON CONFLICT` deja una sola.
      const [a, b] = await Promise.all([
        db.transaccion(() => motivos.asegurarDevolucion(tenantId)),
        db.transaccion(() => motivos.asegurarDevolucion(tenantId)),
      ]);
      expect(a).toBe(b);
      // El propio no se adopta (Sesión de esfuerzo máximo, 2026-10-04): la causa
      // nace con otro nombre, y el del tenant queda como estaba.
      expect(a).not.toBe(propio.motivo_baja_id);
      expect(await marcadas()).toEqual([
        expect.objectContaining({
          motivo_baja_id: a,
          nombre: 'Devolución (nota de crédito)',
          es_fijo: true,
        }),
      ]);
      const delTenant: { nombre: string; es_fijo: boolean }[] = await ds.query(
        `SELECT nombre, es_fijo FROM motivo_baja WHERE motivo_baja_id = $1`,
        [propio.motivo_baja_id],
      );
      expect(delTenant).toEqual([{ nombre: 'Devolución', es_fijo: false }]);
    });
  });
});
