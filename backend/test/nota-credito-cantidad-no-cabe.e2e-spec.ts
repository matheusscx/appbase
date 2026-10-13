import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { ProviderFactory } from '../src/modules/pasarela/providers/provider.factory';
import { VentasReembolsoHandler } from '../src/modules/ventas/reembolso-callback.handler';
import { PasarelaOrden } from '../src/modules/pasarela/entities/pasarela-orden.entity';
import { PasarelaTransaccion } from '../src/modules/pasarela/entities/pasarela-transaccion.entity';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
const TP_PARIS_WEBPAY_ID = '550e8400-e29b-41d4-a716-446655440217';

/**
 * La `cantidad` de una línea de nota de crédito llega con `@IsNumberString()`
 * y sin `IsDecimalPersistible`, a propósito: una cantidad que no cabe en
 * `NUMERIC(18,4)` no llega a ninguna columna, porque antes la frena el tope de
 * la propia nota —no se acredita más de lo vendido menos lo ya comprometido
 * (`validarDevolucionesReembolso`, en las dos políticas)—. Medido el
 * 2026-10-13 por HTTP en los tres caminos que crean una nota con cantidad
 * (`docs/agent/resueltos.md`, "La cantidad de una nota de crédito que no cabe
 * en su columna"). Si ese tope se fuera, este spec cae y el campo necesita su
 * techo de columna.
 *
 * El reembolso por la llave de API usa el mismo DTO y el mismo
 * `CobrosService.reembolsar` que el del admin: no tiene caso propio.
 *
 * ⚠️ Sin `eliminado_el IS NULL` en los conteos de "no escribió nada", a
 * propósito: lo que se cuenta es si el pedido escribió algo, y una fila
 * borrada también sería una escritura.
 */

/** El primer valor que no cabe en `NUMERIC(18,4)`. */
const NO_CABE = '100000000000000';
/** Pasa por debajo del techo, pero redondeado a la escala de la columna es el techo. */
const REDONDEA_AL_TECHO = '99999999999999.99999';
const VALORES = [NO_CABE, REDONDEA_AL_TECHO];

interface TokenResponse {
  access_token: string;
}

describe('La cantidad de una nota de crédito que no cabe en su columna es 400, no 500 (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let productoId: string;
  const reembolsarEnElProveedor = jest.fn();

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const excede = (nombre: string) =>
    `La cantidad a devolver de "${nombre}" excede lo disponible (2)`;
  let nombreProducto: string;

  /** 2 unidades del producto propio ($5.000 c/u, IVA incluido) con débito. */
  const vender = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set(auth())
      .send({
        canal: 'online',
        lineas: [{ itemId: productoId, cantidad: '2' }],
        pagos: [{ metodoPagoId: DEBITO_ID, monto: '10000' }],
      });
    expect(res.status).toBe(201);
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

  const ordenCobrada = async (ventaId: string): Promise<string> => {
    const codigoOrden = `E2E-NCQ-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const orden = await ds.getRepository(PasarelaOrden).save({
      tenantId: TENANT_ID,
      codigoOrden,
      descripcion: 'Orden de cantidad que no cabe e2e',
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
  };

  const refundsDe = (
    ordenId: string,
  ): Promise<
    { transaccion_id: string; correccion_venta_id: string | null }[]
  > =>
    ds.query(
      // Sin filtro de borrado: un REFUND borrado también sería uno que se escribió.
      `SELECT transaccion_id, correccion_venta_id
         FROM pasarela_transacciones
        WHERE orden_id = $1 AND tipo = 'REFUND'`,
      [ordenId],
    );

  /** Lo que una nota escribiría: sus filas, las vueltas al kardex y el saldo. */
  async function estado(ventaId: string) {
    const [fila]: {
      notas: string;
      devoluciones: string;
      stock: string;
    }[] = await ds.query(
      // Sin filtro de borrado: se cuenta si el pedido escribió algo, y una fila
      // borrada también sería una escritura (`stock_ubicacion` no tiene papelera).
      `SELECT (SELECT COUNT(*) FROM ventas WHERE venta_referencia_id = $1)::text AS notas,
              (SELECT COUNT(*) FROM movimientos_inventario
                WHERE item_id = $2 AND motivo = 'devolucion')::text AS devoluciones,
              (SELECT SUM(stock) FROM stock_ubicacion WHERE item_id = $2)::text AS stock`,
      [ventaId, productoId],
    );
    return fila;
  }

  const linea = (cantidad: string) => [
    { itemId: productoId, cantidad, stock: 'recupera' },
  ];

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
    const tenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: TENANT_ID });
    expect(tenant.status).toBe(200);
    token = (tenant.body as TokenResponse).access_token;

    // Propio: el stock del seed lo mueven otras suites.
    nombreProducto = `NC cantidad no cabe E2E ${Date.now()}`;
    const producto = await request(app.getHttpServer())
      .post('/api/items')
      .set(auth())
      .send({
        nombre: nombreProducto,
        tipo: 'producto',
        precioBase: '5000',
        precioIncluyeImpuesto: true,
        monedaId: CLP,
        unidadMedida: 'unidad',
        stock: '100',
        costo: '1000',
      });
    expect(producto.status).toBe(201);
    productoId = (producto.body as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    await app.close();
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

  it.each(VALORES)(
    'nota manual con %s: 400 y no escribe nada',
    async (cantidad) => {
      const ventaId = await vender();
      const antes = await estado(ventaId);

      const res = await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/notas-credito`)
        .set('Idempotency-Key', randomUUID())
        .set(auth())
        .send({
          monto: '5000',
          comentario: 'Devolución E2E',
          devolucion: { pagoId: await pagoDe(ventaId) },
          devoluciones: linea(cantidad),
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(excede(nombreProducto));
      expect(await estado(ventaId)).toEqual(antes);
    },
  );

  it.each(VALORES)(
    'reembolso de pasarela con %s: 400 antes del proveedor, sin REFUND ni nota',
    async (cantidad) => {
      const ventaId = await vender();
      const ordenId = await ordenCobrada(ventaId);
      const antes = await estado(ventaId);

      const res = await request(app.getHttpServer())
        .post(`/api/pasarela/admin/ordenes/${ordenId}/reembolsos`)
        .set(auth())
        .set('Idempotency-Key', randomUUID())
        .send({ monto: '5000', devoluciones: linea(cantidad) });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(excede(nombreProducto));
      expect(reembolsarEnElProveedor).not.toHaveBeenCalled();
      expect(await refundsDe(ordenId)).toEqual([]);
      expect(await estado(ventaId)).toEqual(antes);
    },
  );

  it.each(VALORES)(
    '"Generar nota" con %s: 400 y el REFUND sigue sin nota',
    async (cantidad) => {
      const ventaId = await vender();
      const ordenId = await ordenCobrada(ventaId);
      // Un REFUND aprobado cuya nota falló, como en producción.
      const hook = jest
        .spyOn(app.get(VentasReembolsoHandler), 'onReembolsoAprobado')
        .mockRejectedValueOnce(new Error('la nota no salió'));
      try {
        const reembolso = await request(app.getHttpServer())
          .post(`/api/pasarela/admin/ordenes/${ordenId}/reembolsos`)
          .set(auth())
          .set('Idempotency-Key', randomUUID())
          .send({ monto: '5000' });
        expect(reembolso.status).toBe(201);
      } finally {
        hook.mockRestore();
      }
      const [refund] = await refundsDe(ordenId);
      expect(refund.correccion_venta_id).toBeNull();
      const antes = await estado(ventaId);

      const res = await request(app.getHttpServer())
        .post(
          `/api/pasarela/admin/ordenes/${ordenId}/reembolsos/${refund.transaccion_id}/nota`,
        )
        .set(auth())
        .set('Idempotency-Key', randomUUID())
        .send({ devoluciones: linea(cantidad) });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe(excede(nombreProducto));
      expect(await refundsDe(ordenId)).toEqual([refund]);
      expect(await estado(ventaId)).toEqual(antes);
    },
  );
});
