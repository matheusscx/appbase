import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { ProviderFactory } from '../src/modules/pasarela/providers/provider.factory';
import { VentasReembolsoHandler } from '../src/modules/ventas/reembolso-callback.handler';
import { PasarelaOrden } from '../src/modules/pasarela/entities/pasarela-orden.entity';
import { PasarelaTransaccion } from '../src/modules/pasarela/entities/pasarela-transaccion.entity';

/**
 * Una cantidad con más de 4 decimales es 400, no se redondea (owner,
 * 2026-10-13, por AskUserQuestion de la orquestadora: "Rechazar con aviso").
 * Toda columna de cantidad es `NUMERIC(18,4)`, y hasta esta fecha Postgres
 * redondeaba el quinto decimal al guardar: `1.00005` entraba con 201 y quedaba
 * `1.0001`, en la venta, la cuenta, la nota de crédito y el kardex. Con dos
 * notas (`1.00005` y `0.99995`) sobre 2 vendidas, el kardex recibía 2,0001.
 * Medido camino por camino por HTTP (`docs/agent/resueltos.md`, "Una cantidad
 * con más de 4 decimales se redondea en silencio").
 *
 * Cada camino, con `1.0001` (entra y se guarda tal cual) y con `1.00005` (400
 * y no escribe nada). Lo pone `@EsCantidad()` con `EscalaMonedaPipe`, la misma
 * mecánica del porcentaje de un impuesto (`cac160f9`).
 *
 * ⚠️ Sin `eliminado_el IS NULL` en los conteos de "no escribió nada", a
 * propósito: lo que se cuenta es si el pedido escribió algo, y una fila borrada
 * también sería una escritura.
 */

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
const TP_PARIS_WEBPAY_ID = '550e8400-e29b-41d4-a716-446655440217';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const FACTURA_COMPRA = '550e8400-e29b-41d4-a716-446655440420';
const MOTIVO_VENCIMIENTO_ID = '550e8400-e29b-41d4-a716-446655440266';
const TIPO_DESCUENTO_POR_MAYOR = '550e8400-e29b-41d4-a716-446655440101';

const ENTRA = '1.0001';
const NO_ENTRA = '1.00005';

const CANTIDAD = 'La cantidad admite como máximo 4 decimales.';
const CONTADA = 'La cantidad contada admite como máximo 4 decimales.';
const STOCK = 'El stock inicial admite como máximo 4 decimales.';
const CONTENIDO =
  'El contenido de la presentación admite como máximo 4 decimales.';
const MINIMO = 'La cantidad mínima admite como máximo 4 decimales.';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
type Respuesta = { status: number; body: unknown };
/** Qué, cómo pedirlo con una cantidad, y el mensaje del 400. */
type Camino = [string, (cantidad: string) => Promise<Respuesta>, string];

describe('Una cantidad con más de 4 decimales es 400, no se redondea (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let apiKey: string;
  let marca: string;
  let localId: string;
  let bodegaId: string;
  let proveedorId: string;
  let motivoTrasladoId: string;
  let garzon: { id: string; pin: string };
  let mesaId: string;
  const reembolsarEnElProveedor = jest.fn();

  function pedir(
    metodo: 'post' | 'patch' | 'put',
    ruta: string,
    body: object = {},
    bearer = token,
  ): Promise<Respuesta> {
    return request(app.getHttpServer())
      [metodo](`/api/${ruta}`)
      .set('Authorization', `Bearer ${bearer}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  async function crear<T = IdResponse>(ruta: string, body: object): Promise<T> {
    const res = await pedir('post', ruta, body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  const nombre = (base: string) =>
    `${base} 4 decimales E2E ${marca} ${randomUUID().slice(0, 4)}`;

  /** Producto propio: el stock del seed lo mueven otras suites. */
  const producto = async (unidadMedida = 'unidad', precioBase = '5000') =>
    (
      await crear('items', {
        nombre: nombre('Producto'),
        tipo: 'producto',
        precioBase,
        precioIncluyeImpuesto: true,
        monedaId: CLP,
        unidadMedida,
        stock: '100',
        costo: '1000',
      })
    ).id;

  const ingrediente = async () =>
    (
      await crear('items', {
        nombre: nombre('Insumo'),
        precioBase: '10',
        monedaId: CLP,
        tipo: 'ingrediente',
        unidadMedida: 'g',
        costo: '1',
      })
    ).id;

  /** 2 unidades del producto ($5.000 c/u, IVA incluido) con débito. */
  async function vender(itemId: string): Promise<string> {
    const res = await pedir('post', 'ventas', {
      canal: 'online',
      lineas: [{ itemId, cantidad: '2' }],
      pagos: [{ metodoPagoId: DEBITO_ID, monto: '10000' }],
    });
    expect(res.status).toBe(201);
    return (res.body as IdResponse).id;
  }

  async function pagoDe(ventaId: string): Promise<string> {
    const [pago]: { pago_id: string }[] = await ds.query(
      `SELECT pago_id FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    return pago.pago_id;
  }

  async function ordenCobrada(ventaId: string): Promise<string> {
    const codigoOrden = `E2E-4DEC-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const orden = await ds.getRepository(PasarelaOrden).save({
      tenantId: TENANT_ID,
      codigoOrden,
      descripcion: 'Orden de cantidad con 4 decimales e2e',
      monto: '10000',
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
      monto: '10000',
      moneda: 'CLP',
      codigoOrden,
      fechaTransaccion: new Date(),
    });
    return orden.ordenId;
  }

  /** Un REFUND aprobado cuya nota falló, como en producción: "Generar nota" lo corrige. */
  async function refundSinNota(ordenId: string): Promise<string> {
    const hook = jest
      .spyOn(app.get(VentasReembolsoHandler), 'onReembolsoAprobado')
      .mockRejectedValueOnce(new Error('la nota no salió'));
    try {
      const res = await pedir(
        'post',
        `pasarela/admin/ordenes/${ordenId}/reembolsos`,
        { monto: '5000' },
      );
      expect(res.status).toBe(201);
    } finally {
      hook.mockRestore();
    }
    const [refund]: { transaccion_id: string }[] = await ds.query(
      `SELECT transaccion_id FROM pasarela_transacciones
        WHERE orden_id = $1 AND tipo = 'REFUND' AND eliminado_el IS NULL`,
      [ordenId],
    );
    return refund.transaccion_id;
  }

  async function abrirCuenta(): Promise<string> {
    return (
      await crear(`mesas/${mesaId}/cuentas`, {
        garzonId: garzon.id,
        pin: garzon.pin,
      })
    ).id;
  }

  /** Todo lo que un pedido de este spec podría escribir, en el tenant. */
  async function escrituras(): Promise<Record<string, string>> {
    const tablas = [
      'ventas',
      'venta_detalles',
      'movimientos_inventario',
      'cuenta_lineas',
      'compras',
      'compra_lineas',
      'presentaciones_compra',
      'items',
      'grupo_modificador_opciones',
      'item_grupo_modificador_opciones',
      'descuento_tramos',
      'pasarela_transacciones',
    ];
    const [fila]: Record<string, string>[] = await ds.query(
      // Sin `eliminado_el`: ver el encabezado. Las que no tienen `tenant_id`
      // se cuentan enteras: lo que importa es que no cambien.
      `SELECT ${tablas
        .map((t) => `(SELECT count(*) FROM ${t})::text AS ${t}`)
        .join(', ')},
              (SELECT string_agg(cantidad::text, ',' ORDER BY cuenta_linea_id)
                 FROM cuenta_lineas WHERE tenant_id = $1) AS cantidades_cuenta,
              (SELECT string_agg(cantidad_contada::text, ',' ORDER BY linea_id)
                 FROM recuento_inventario_linea) AS contadas,
              (SELECT string_agg(contenido::text, ',' ORDER BY presentacion_compra_id)
                 FROM presentaciones_compra WHERE tenant_id = $1) AS contenidos,
              (SELECT string_agg(cantidad::text, ',' ORDER BY compra_linea_id)
                 FROM compra_lineas) AS cantidades_compra,
              (SELECT string_agg(coalesce(cantidad::text, '-'), ',' ORDER BY 1)
                 FROM grupo_modificador_opciones) AS cantidades_opcion,
              (SELECT string_agg(coalesce(minimo_cantidad::text, '-'), ',' ORDER BY 1)
                 FROM descuento_tramos) AS minimos`,
      [TENANT_ID],
    );
    return fila;
  }

  /** Todos los pedidos antes de comparar: un rojo dice cuáles fueron, no solo el primero. */
  async function rechazados(caminos: Camino[]) {
    const antes = await escrituras();
    const obtenido: { que: string; status: number; mensaje: string }[] = [];
    for (const [que, hacer] of caminos) {
      const res = await hacer(NO_ENTRA);
      const m = (res.body as { message?: string | string[] }).message ?? '';
      obtenido.push({ que, status: res.status, mensaje: [m].flat().join(' ') });
    }
    expect(obtenido).toEqual(
      caminos.map(([que, , mensaje]) => ({ que, status: 400, mensaje })),
    );
    expect(await escrituras()).toEqual(antes);
  }

  async function aceptados(caminos: Camino[]) {
    const obtenido: { que: string; status: number }[] = [];
    for (const [que, hacer] of caminos) {
      const res = await hacer(ENTRA);
      obtenido.push({ que, status: res.status < 300 ? 200 : res.status });
    }
    expect(obtenido).toEqual(caminos.map(([que]) => ({ que, status: 200 })));
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderFactory)
      .useValue({
        getReembolsable: () => ({
          reembolsar: reembolsarEnElProveedor,
          consultarEstado: jest.fn(),
        }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin.paris@paris.cl', password: 'admin' });
    expect(login.status).toBe(200);
    const enTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: TENANT_ID });
    expect(enTenant.status).toBe(200);
    token = (enTenant.body as TokenResponse).access_token;

    marca = randomUUID().slice(0, 8);
    apiKey = (
      await crear<{ apiKey: string }>('pasarela/admin/api-keys', {
        nombre: nombre('Llave'),
      })
    ).apiKey;
    const [local]: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [TENANT_ID],
    );
    localId = local.ubicacion_id;
    bodegaId = (
      await crear('ubicaciones', { nombre: nombre('Bodega'), tipo: 'bodega' })
    ).id;
    proveedorId = (
      await crear('terceros', {
        tipo: 'proveedor',
        nombre: nombre('Proveedor'),
      })
    ).id;
    const [motivo]: { id: string }[] = await ds.query(
      `SELECT motivo_traslado_id AS id FROM motivo_traslado
        WHERE tenant_id = $1 AND activo AND eliminado_el IS NULL
        ORDER BY motivo_traslado_id LIMIT 1`,
      [TENANT_ID],
    );
    motivoTrasladoId = motivo.id;

    // Garzón y mesa PROPIOS: la sesión de garzón es única y varias suites la comparten.
    garzon = await crear<{ id: string; pin: string }>('garzones', {
      nombre: nombre('Garzón'),
    });
    expect(
      (
        await pedir('post', 'sesiones-garzon/iniciar', {
          garzonId: garzon.id,
          pin: garzon.pin,
          turnoId: TURNO_MANANA_ID,
        })
      ).status,
    ).toBe(201);
    const salonId = (await crear('salones', { nombre: nombre('Salón') })).id;
    mesaId = (await crear(`salones/${salonId}/mesas`, { nombre: 'Mesa' })).id;
  }, 120000);

  afterAll(async () => {
    try {
      await pedir('post', 'sesiones-garzon/cerrar', {
        garzonId: garzon.id,
        pin: garzon.pin,
      });
    } finally {
      await app.close();
    }
  });

  beforeEach(() => {
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

  describe('la venta: caja, cálculo del POS, tienda online y cuenta de salón', () => {
    let unidad: string;
    let kilo: string;
    let cuentaId: string;
    let lineaId: string;
    let lineaKiloId: string;

    beforeAll(async () => {
      // $10.000: 1.0001 unidades son $10.001 justos, y el pago cierra exacto
      // (una venta online no admite vuelto).
      unidad = await producto('unidad', '10000');
      kilo = await producto('kg', '10000');
      cuentaId = await abrirCuenta();
      for (const itemId of [unidad, kilo]) {
        expect(
          (
            await pedir('post', `cuentas/${cuentaId}/lineas`, {
              itemId,
              cantidad: '1',
            })
          ).status,
        ).toBe(201);
      }
      const lineas: { id: string; item_id: string }[] = await ds.query(
        `SELECT cuenta_linea_id AS id, item_id FROM cuenta_lineas
          WHERE cuenta_id = $1 AND eliminado_el IS NULL`,
        [cuentaId],
      );
      lineaId = lineas.find((l) => l.item_id === unidad)!.id;
      lineaKiloId = lineas.find((l) => l.item_id === kilo)!.id;
    });

    const venta = (linea: object) => ({
      canal: 'online',
      lineas: [linea],
      pagos: [{ metodoPagoId: DEBITO_ID, monto: '10001' }],
    });
    const caminos = (): Camino[] => [
      [
        'venta: cantidad',
        (c) => pedir('post', 'ventas', venta({ itemId: unidad, cantidad: c })),
        CANTIDAD,
      ],
      [
        'venta: cantidad por presentación',
        (c) =>
          pedir(
            'post',
            'ventas',
            venta({
              itemId: kilo,
              cantidad: ENTRA,
              cantidadPresentacion: c,
              unidadCodigoPresentacion: 'kg',
            }),
          ),
        CANTIDAD,
      ],
      [
        'cálculo del POS: cantidad',
        (c) =>
          pedir('post', 'calculo-precios/calcular', {
            lineas: [{ itemId: unidad, cantidad: c }],
          }),
        CANTIDAD,
      ],
      [
        'cálculo del POS: cantidad por presentación',
        (c) =>
          pedir('post', 'calculo-precios/calcular', {
            lineas: [
              {
                itemId: kilo,
                cantidad: ENTRA,
                cantidadPresentacion: c,
                unidadCodigoPresentacion: 'kg',
              },
            ],
          }),
        CANTIDAD,
      ],
      [
        'tienda online: checkout',
        (c) =>
          pedir('post', 'online/checkout', {
            lineas: [{ itemId: unidad, cantidad: c }],
          }),
        CANTIDAD,
      ],
      [
        'cuenta de salón: pedir',
        (c) =>
          pedir('post', `cuentas/${cuentaId}/lineas`, {
            itemId: unidad,
            cantidad: c,
          }),
        CANTIDAD,
      ],
      [
        'cuenta de salón: pedir por presentación',
        (c) =>
          pedir('post', `cuentas/${cuentaId}/lineas`, {
            itemId: kilo,
            cantidad: ENTRA,
            cantidadPresentacion: c,
            unidadCodigoPresentacion: 'kg',
          }),
        CANTIDAD,
      ],
      [
        'cuenta de salón: cambiar la cantidad',
        (c) =>
          pedir('patch', `cuentas/${cuentaId}/lineas/${lineaId}`, {
            cantidad: c,
          }),
        CANTIDAD,
      ],
    ];

    it('con 1.00005: 400 en cada camino, y no escribe nada', async () => {
      await rechazados([
        ...caminos(),
        // `/online/pagar` queda afuera del control: con una pasarela activa
        // abre una orden. El 400 llega antes.
        [
          'tienda online: pagar',
          (c) =>
            pedir('post', 'online/pagar', {
              lineas: [{ itemId: unidad, cantidad: c }],
            }),
          CANTIDAD,
        ],
        [
          'cuenta de salón: cambiar la cantidad por presentación',
          (c) =>
            pedir('patch', `cuentas/${cuentaId}/lineas/${lineaKiloId}`, {
              cantidad: ENTRA,
              cantidadPresentacion: c,
              unidadCodigoPresentacion: 'kg',
            }),
          CANTIDAD,
        ],
      ]);
    });

    it('con 1.0001: entra en cada camino', async () => {
      await aceptados(caminos());
    });

    it('con 1.0001: la venta guarda la línea y la salida del kardex tal cual', async () => {
      const ventaId = (
        await crear('ventas', venta({ itemId: unidad, cantidad: ENTRA }))
      ).id;
      expect(
        await ds.query(
          `SELECT d.cantidad::text AS linea, m.cantidad::text AS kardex
             FROM venta_detalles d
             JOIN movimientos_inventario m
               ON m.venta_id = d.venta_id AND m.item_id = d.item_id
            WHERE d.venta_id = $1 AND d.eliminado_el IS NULL
              AND m.eliminado_el IS NULL`,
          [ventaId],
        ),
      ).toEqual([{ linea: ENTRA, kardex: ENTRA }]);
    });
  });

  describe('la nota de crédito: manual, reembolso (admin y llave de API) y "Generar nota"', () => {
    let itemId: string;

    beforeAll(async () => {
      itemId = await producto();
    });

    const linea = (cantidad: string) => [
      { itemId, cantidad, stock: 'recupera' },
    ];

    /** Cada camino sobre su propia venta de 2, recién hecha. */
    const caminos = (): Camino[] => [
      [
        'nota de crédito manual',
        async (c) => {
          const ventaId = await vender(itemId);
          return pedir('post', `ventas/${ventaId}/notas-credito`, {
            monto: '5000',
            comentario: 'Devolución E2E',
            devolucion: { pagoId: await pagoDe(ventaId) },
            devoluciones: linea(c),
          });
        },
        CANTIDAD,
      ],
      [
        'reembolso de pasarela (admin)',
        async (c) => {
          const ordenId = await ordenCobrada(await vender(itemId));
          return pedir('post', `pasarela/admin/ordenes/${ordenId}/reembolsos`, {
            monto: '5000',
            devoluciones: linea(c),
          });
        },
        CANTIDAD,
      ],
      [
        'reembolso de pasarela (llave de API)',
        async (c) => {
          const ordenId = await ordenCobrada(await vender(itemId));
          return pedir(
            'post',
            `pasarela/api/cobros/${ordenId}/reembolsos`,
            { monto: '5000', devoluciones: linea(c) },
            apiKey,
          );
        },
        CANTIDAD,
      ],
      [
        '"Generar nota"',
        async (c) => {
          const ordenId = await ordenCobrada(await vender(itemId));
          const refundId = await refundSinNota(ordenId);
          return pedir(
            'post',
            `pasarela/admin/ordenes/${ordenId}/reembolsos/${refundId}/nota`,
            { devoluciones: linea(c) },
          );
        },
        CANTIDAD,
      ],
    ];

    /** Lo que acreditó cada nota de la venta: la línea del ítem y su vuelta al kardex. */
    const acreditado = (ventaId: string) =>
      ds.query(
        `SELECT d.cantidad::text AS linea, m.cantidad::text AS kardex
           FROM ventas n
           JOIN venta_detalles d
             ON d.venta_id = n.venta_id AND d.item_id = $2
            AND d.eliminado_el IS NULL
           JOIN movimientos_inventario m
             ON m.venta_id = n.venta_id AND m.item_id = $2
            AND m.motivo = 'devolucion' AND m.eliminado_el IS NULL
          WHERE n.venta_referencia_id = $1 AND n.eliminado_el IS NULL
          ORDER BY n.creado_el`,
        [ventaId, itemId],
      );

    it('con 1.00005: 400 en cada camino, sin REFUND ni nota ni vuelta al kardex', async () => {
      // `rechazados` cuenta las escrituras antes y después de TODOS los
      // pedidos, y cada camino necesita su venta (y "Generar nota", su
      // REFUND): se arma todo primero y se mide solo el pedido.
      const ventas: string[] = [];
      const pedidos: Camino[] = [];
      for (const [que, , mensaje] of caminos()) {
        const ventaId = await vender(itemId);
        ventas.push(ventaId);
        if (que === 'nota de crédito manual') {
          const pagoId = await pagoDe(ventaId);
          pedidos.push([
            que,
            (c) =>
              pedir('post', `ventas/${ventaId}/notas-credito`, {
                monto: '5000',
                comentario: 'Devolución E2E',
                devolucion: { pagoId },
                devoluciones: linea(c),
              }),
            mensaje,
          ]);
          continue;
        }
        const ordenId = await ordenCobrada(ventaId);
        if (que === '"Generar nota"') {
          const refundId = await refundSinNota(ordenId);
          pedidos.push([
            que,
            (c) =>
              pedir(
                'post',
                `pasarela/admin/ordenes/${ordenId}/reembolsos/${refundId}/nota`,
                { devoluciones: linea(c) },
              ),
            mensaje,
          ]);
          continue;
        }
        const porLlave = que === 'reembolso de pasarela (llave de API)';
        pedidos.push([
          que,
          (c) =>
            pedir(
              'post',
              porLlave
                ? `pasarela/api/cobros/${ordenId}/reembolsos`
                : `pasarela/admin/ordenes/${ordenId}/reembolsos`,
              { monto: '5000', devoluciones: linea(c) },
              porLlave ? apiKey : token,
            ),
          mensaje,
        ]);
      }
      reembolsarEnElProveedor.mockClear();

      await rechazados(pedidos);
      expect(reembolsarEnElProveedor).not.toHaveBeenCalled();
      for (const ventaId of ventas)
        expect(await acreditado(ventaId)).toEqual([]);
    });

    it('con 1.0001: cada camino acredita la línea y vuelve al kardex tal cual', async () => {
      // El reloj de la base, no el del proceso: `creado_el` lo pone Postgres.
      const [{ desde }]: { desde: Date }[] = await ds.query(
        `SELECT now() AS desde`,
      );
      await aceptados(caminos());
      const ventas: { venta_id: string }[] = await ds.query(
        `SELECT DISTINCT n.venta_referencia_id AS venta_id FROM ventas n
           JOIN venta_detalles d
             ON d.venta_id = n.venta_id AND d.item_id = $1
            AND d.eliminado_el IS NULL
          WHERE n.venta_referencia_id IS NOT NULL AND n.eliminado_el IS NULL
            AND n.creado_el >= $2`,
        [itemId, desde],
      );
      // Una nota por camino, cada una sobre su propia venta.
      expect(ventas).toHaveLength(caminos().length);
      for (const { venta_id } of ventas) {
        expect(await acreditado(venta_id)).toEqual([
          { linea: ENTRA, kardex: ENTRA },
        ]);
      }
    });

    it('la devolución en dos partes ya no pasa de lo vendido: 1.0001 + 0.9999 son las 2, y nada más', async () => {
      const ventaId = await vender(itemId);
      const pagoId = await pagoDe(ventaId);
      const nota = (cantidad: string, monto: string) =>
        pedir('post', `ventas/${ventaId}/notas-credito`, {
          monto,
          comentario: 'Devolución en partes E2E',
          devolucion: { pagoId },
          devoluciones: linea(cantidad),
        });

      // Lo que hasta el 2026-10-13 pasaba y devolvía 2,0001 de 2 vendidas.
      expect((await nota('1.00005', '5000')).status).toBe(400);
      expect((await nota('0.99995', '4999')).status).toBe(400);

      expect((await nota('1.0001', '5000')).status).toBe(201);
      expect((await nota('0.9999', '4999')).status).toBe(201);
      const resto = await nota('0.0001', '1');
      expect(resto.status).toBe(400);
      expect((resto.body as { message: string }).message).toMatch(
        /excede lo disponible \(0\)/,
      );

      const vueltas: { linea: string; kardex: string }[] =
        await acreditado(ventaId);
      expect(vueltas).toEqual([
        { linea: '1.0001', kardex: '1.0001' },
        { linea: '0.9999', kardex: '0.9999' },
      ]);
    });
  });

  describe('el kardex: ajuste, stock inicial, merma, traslado, compra y recuento', () => {
    let itemId: string;
    let contado: string;
    let recuentoId: string;
    let lineaRecuentoId: string;
    let borradorId: string;
    let confirmadaId: string;
    let lineaConfirmadaId: string;
    let presentacionId: string;

    const lineaCompra = (cantidad: string) => ({
      itemId,
      cantidad,
      unidadCodigo: 'unidad',
      precioUnitario: '1',
    });
    const compra = (cantidad: string) => ({
      proveedorId,
      tipoDocumentoCompraId: FACTURA_COMPRA,
      folio: `F${randomUUID().slice(0, 8)}`,
      fechaDocumento: '2026-09-15',
      ubicacionId: localId,
      totalDocumento: '1',
      lineas: [lineaCompra(cantidad)],
    });

    beforeAll(async () => {
      itemId = await producto();
      // El recuento abierto se queda con su ítem: va aparte.
      contado = await producto();
      recuentoId = (
        await crear('recuentos', { ubicacionId: localId, itemIds: [contado] })
      ).id;
      const [linea]: { id: string }[] = await ds.query(
        `SELECT linea_id AS id FROM recuento_inventario_linea
          WHERE recuento_id = $1 AND eliminado_el IS NULL`,
        [recuentoId],
      );
      lineaRecuentoId = linea.id;
      borradorId = (await crear('compras', compra('1'))).id;
      confirmadaId = (await crear('compras', compra('1'))).id;
      expect(
        (await pedir('post', `compras/${confirmadaId}/confirmar`)).status,
      ).toBe(201);
      const [lc]: { id: string }[] = await ds.query(
        `SELECT compra_linea_id AS id FROM compra_lineas
          WHERE compra_id = $1 AND eliminado_el IS NULL`,
        [confirmadaId],
      );
      lineaConfirmadaId = lc.id;
      presentacionId = (
        await crear('compras/presentaciones', {
          proveedorId,
          itemId,
          nombre: 'Caja',
          contenido: '12',
          unidadCodigo: 'unidad',
        })
      ).id;
    });

    const caminos = (): Camino[] => [
      [
        'ajuste de stock',
        (c) =>
          pedir('patch', `items/${itemId}/stock`, {
            ubicacionId: localId,
            tipo: 'entrada',
            motivo: 'ajuste_manual',
            cantidad: c,
          }),
        CANTIDAD,
      ],
      [
        'stock inicial de un producto nuevo',
        (c) =>
          pedir('post', 'items', {
            nombre: nombre('Inicial'),
            tipo: 'producto',
            precioBase: '1000',
            monedaId: CLP,
            clasificacionTributaria: 'exento',
            unidadMedida: 'unidad',
            stock: c,
          }),
        STOCK,
      ],
      [
        'merma',
        (c) =>
          pedir('post', 'mermas', {
            itemId,
            ubicacionId: localId,
            cantidad: c,
            motivoBajaId: MOTIVO_VENCIMIENTO_ID,
          }),
        CANTIDAD,
      ],
      [
        'traslado',
        (c) =>
          pedir('post', 'traslados', {
            origenId: localId,
            destinoId: bodegaId,
            motivoTrasladoId,
            lineas: [{ itemId, cantidad: c }],
          }),
        CANTIDAD,
      ],
      ['compra nueva', (c) => pedir('post', 'compras', compra(c)), CANTIDAD],
      [
        'editar el borrador de una compra',
        (c) => pedir('patch', `compras/${borradorId}`, compra(c)),
        CANTIDAD,
      ],
      [
        'corregir la cantidad de una compra confirmada',
        (c) =>
          pedir(
            'patch',
            `compras/${confirmadaId}/lineas/${lineaConfirmadaId}`,
            { cantidad: c },
          ),
        CANTIDAD,
      ],
      [
        'contenido de una presentación nueva',
        (c) =>
          pedir('post', 'compras/presentaciones', {
            proveedorId,
            itemId,
            nombre: nombre('Pack'),
            contenido: c,
            unidadCodigo: 'unidad',
          }),
        CONTENIDO,
      ],
      [
        'contenido al editar la presentación',
        (c) =>
          pedir('patch', `compras/presentaciones/${presentacionId}`, {
            contenido: c,
          }),
        CONTENIDO,
      ],
      [
        'conteo de un recuento',
        (c) =>
          pedir('patch', `recuentos/${recuentoId}/lineas/${lineaRecuentoId}`, {
            cantidadContada: c,
          }),
        CONTADA,
      ],
    ];

    it('con 1.00005: 400 en cada camino, y no escribe nada', async () => {
      await rechazados(caminos());
    });

    it('con 1.0001: entra en cada camino', async () => {
      await aceptados(caminos());
    });

    it('con 1.0001: el ajuste y el conteo se guardan tal cual', async () => {
      expect(
        (
          await pedir('patch', `items/${itemId}/stock`, {
            ubicacionId: localId,
            tipo: 'entrada',
            motivo: 'ajuste_manual',
            cantidad: ENTRA,
          })
        ).status,
      ).toBe(200);
      const [ajuste]: { cantidad: string }[] = await ds.query(
        `SELECT cantidad::text FROM movimientos_inventario
          WHERE item_id = $1 AND motivo = 'ajuste_manual' AND eliminado_el IS NULL
          ORDER BY creado_el DESC LIMIT 1`,
        [itemId],
      );
      expect(ajuste.cantidad).toBe(ENTRA);
      const [linea]: { contada: string }[] = await ds.query(
        `SELECT cantidad_contada::text AS contada FROM recuento_inventario_linea
          WHERE linea_id = $1 AND eliminado_el IS NULL`,
        [lineaRecuentoId],
      );
      expect(linea.contada).toBe(ENTRA);
    });
  });

  describe('lo que define cantidades: receta, combo, grupos de modificadores y descuento por mayor', () => {
    let harina: string;
    let unidad: string;
    let grupoId: string;
    let grupoOpcionId: string;
    let itemGrupoId: string;
    let recetaId: string;
    let descuentoId: string;

    beforeAll(async () => {
      harina = await ingrediente();
      unidad = await producto();
      const grupo = await crear<{
        grupoModificadorId: string;
        opciones: { grupoOpcionId: string }[];
      }>('grupos-modificadores', {
        nombre: nombre('Grupo'),
        opciones: [{ itemId: harina, precioExtra: '0' }],
      });
      grupoId = grupo.grupoModificadorId;
      grupoOpcionId = grupo.opciones[0].grupoOpcionId;
      const receta = await crear('items', {
        nombre: nombre('Receta'),
        precioBase: '1000',
        monedaId: CLP,
        tipo: 'receta',
        ingredientes: [
          { ingredienteItemId: harina, cantidad: '1', unidadCodigo: 'g' },
        ],
        gruposModificadores: [{ grupoModificadorId: grupoId, min: 1, max: 1 }],
      });
      const [ig]: { id: string }[] = await ds.query(
        `SELECT item_grupo_id AS id FROM item_grupos_modificadores
          WHERE item_id = $1 AND eliminado_el IS NULL`,
        [receta.id],
      );
      itemGrupoId = ig.id;
      recetaId = receta.id;
      // Inactivo y vencido: no le cambia el precio a nadie mientras corre el resto.
      descuentoId = (await crear('descuentos', porMayor('10'))).id;
    });

    const porMayor = (minimoCantidad: string) => ({
      nombre: nombre('Por mayor'),
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      activo: false,
      fechaInicio: '2020-01-01',
      fechaFin: '2020-12-31',
      tramos: [{ minimoCantidad, valorPorcentaje: '0.1' }],
    });
    const receta = (extra: object) =>
      pedir('post', 'items', {
        nombre: nombre('Receta'),
        precioBase: '1000',
        monedaId: CLP,
        tipo: 'receta',
        ingredientes: [
          { ingredienteItemId: harina, cantidad: '1', unidadCodigo: 'g' },
        ],
        ...extra,
      });
    const opcion = (cantidad: string) => [
      { itemId: harina, cantidad, unidadCodigo: 'g', precioExtra: '0' },
    ];

    const caminos = (): Camino[] => [
      [
        'ingrediente de una receta',
        (c) =>
          receta({
            ingredientes: [
              { ingredienteItemId: harina, cantidad: c, unidadCodigo: 'g' },
            ],
          }),
        CANTIDAD,
      ],
      [
        'ingrediente al editar una receta',
        (c) =>
          pedir('patch', `items/${recetaId}`, {
            ingredientes: [
              { ingredienteItemId: harina, cantidad: c, unidadCodigo: 'g' },
            ],
          }),
        CANTIDAD,
      ],
      [
        'extra permitido de una receta',
        (c) =>
          receta({
            extrasPermitidos: [
              {
                ingredienteItemId: harina,
                cantidad: c,
                unidadCodigo: 'g',
                precioExtra: '0',
              },
            ],
          }),
        CANTIDAD,
      ],
      [
        'override de una opción al crear la receta',
        (c) =>
          receta({
            gruposModificadores: [
              {
                grupoModificadorId: grupoId,
                min: 1,
                max: 1,
                opciones: [{ grupoOpcionId, cantidad: c, unidadCodigo: 'g' }],
              },
            ],
          }),
        CANTIDAD,
      ],
      [
        'componente de un combo',
        (c) =>
          pedir('post', 'items', {
            nombre: nombre('Combo'),
            precioBase: '1000',
            monedaId: CLP,
            tipo: 'combo',
            componentes: [{ componenteItemId: unidad, cantidad: c }],
          }),
        CANTIDAD,
      ],
      [
        'opción de un grupo nuevo',
        (c) =>
          pedir('post', 'grupos-modificadores', {
            nombre: nombre('Grupo'),
            opciones: opcion(c),
          }),
        CANTIDAD,
      ],
      [
        'opción al editar el grupo',
        (c) =>
          pedir('patch', `grupos-modificadores/${grupoId}`, {
            opciones: opcion(c),
          }),
        CANTIDAD,
      ],
      [
        'aplicar un override a todos',
        (c) =>
          pedir('patch', `grupos-modificadores/${grupoId}/overrides`, {
            itemGrupoIds: [itemGrupoId],
            grupoOpcionId,
            cantidad: c,
            unidadCodigo: 'g',
          }),
        CANTIDAD,
      ],
      [
        'mínimo de un tramo por mayor, al crear',
        (c) => pedir('post', 'descuentos', porMayor(c)),
        MINIMO,
      ],
      [
        'mínimo de un tramo por mayor, al editar',
        (c) =>
          pedir('patch', `descuentos/${descuentoId}`, {
            tramos: [{ minimoCantidad: c, valorPorcentaje: '0.1' }],
          }),
        MINIMO,
      ],
    ];

    it('con 1.00005: 400 en cada camino, y no escribe nada', async () => {
      await rechazados(caminos());
    });

    it('con 1.0001: entra en cada camino', async () => {
      await aceptados(caminos());
    });
  });
});
