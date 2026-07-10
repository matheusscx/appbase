import { Test, type TestingModule } from '@nestjs/testing';
import { OnlineCallbackHandler } from './online-callback.handler';
import { PagoCallbackRegistry } from '../pasarela/services/pago-callback.registry';
import { VentasService } from '../ventas/ventas.service';
import { type PasarelaOrden } from '../pasarela/entities/pasarela-orden.entity';

const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116';

describe('OnlineCallbackHandler', () => {
  let handler: OnlineCallbackHandler;
  const registry = { register: jest.fn(), get: jest.fn() };
  const ventas = { crear: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnlineCallbackHandler,
        { provide: PagoCallbackRegistry, useValue: registry },
        { provide: VentasService, useValue: ventas },
      ],
    }).compile();
    handler = module.get(OnlineCallbackHandler);
  });

  function orden(
    over: Partial<PasarelaOrden> = {},
    resultadoPago: Record<string, unknown> = {
      tipoPago: 'VN',
      numeroCuotas: 0,
      tarjetaUltimos4: '6623',
    },
  ): PasarelaOrden {
    return {
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'pagada',
      ventaId: null,
      metadata: {
        origenApp: 'tienda-online',
        checkout: {
          lineas: [{ itemId: ITEM_ID, cantidad: '2' }],
          metodoCreditoId: 'mp-credito',
          metodoDebitoId: 'mp-debito',
          totalFinal: '100.0000',
          usuarioId: 'u-1',
          customerNombre: 'user@x.cl',
        },
        resultadoPago,
      },
      ...over,
    } as PasarelaOrden;
  }

  it('onModuleInit se registra en el registry', () => {
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('crea la venta canal online (crédito VN) con detalle de tarjeta y ventaId = venta.id', async () => {
    ventas.crear.mockResolvedValue({ id: 'venta-9' });
    const o = orden();
    await handler.onOrdenResuelta(o);

    expect(ventas.crear).toHaveBeenCalledWith(
      't-1',
      'u-1',
      expect.objectContaining({
        canal: 'online',
        lineas: [{ itemId: ITEM_ID, cantidad: '2' }],
        pagos: [
          {
            metodoPagoId: 'mp-credito',
            monto: '100.0000',
            numeroCuotas: 0,
            tipoPago: 'VN',
            tarjetaUltimos4: '6623',
          },
        ],
        customer: { nombre: 'user@x.cl' },
      }),
    );
    expect(o.ventaId).toBe('venta-9');
  });

  it('débito RedCompra (VD) → usa el método débito del tenant', async () => {
    ventas.crear.mockResolvedValue({ id: 'venta-10' });
    const o = orden(
      {},
      { tipoPago: 'VD', numeroCuotas: 0, tarjetaUltimos4: '0044' },
    );
    await handler.onOrdenResuelta(o);

    const [, , dto] = ventas.crear.mock.calls[0] as [
      string,
      string,
      { pagos: { metodoPagoId: string; tipoPago: string }[] },
    ];
    expect(dto.pagos[0].metodoPagoId).toBe('mp-debito');
    expect(dto.pagos[0].tipoPago).toBe('VD');
  });

  it('VD sin método débito configurado → cae a crédito', async () => {
    ventas.crear.mockResolvedValue({ id: 'venta-11' });
    const o = orden();
    (
      o.metadata as { checkout: { metodoDebitoId: string | null } }
    ).checkout.metodoDebitoId = null;
    (
      o.metadata as { resultadoPago: { tipoPago: string } }
    ).resultadoPago.tipoPago = 'VD';
    await handler.onOrdenResuelta(o);

    const [, , dto] = ventas.crear.mock.calls[0] as [
      string,
      string,
      { pagos: { metodoPagoId: string }[] },
    ];
    expect(dto.pagos[0].metodoPagoId).toBe('mp-credito');
  });

  it('idempotente: si ya hay ventaId, no crea venta', async () => {
    const o = orden({ ventaId: 'venta-previa' });
    await handler.onOrdenResuelta(o);
    expect(ventas.crear).not.toHaveBeenCalled();
  });

  it('ignora órdenes de otras apps', async () => {
    const o = orden({ metadata: { origenApp: 'otra-app' } });
    await handler.onOrdenResuelta(o);
    expect(ventas.crear).not.toHaveBeenCalled();
  });

  it('ignora órdenes no pagadas', async () => {
    const o = orden({ estado: 'fallida' });
    await handler.onOrdenResuelta(o);
    expect(ventas.crear).not.toHaveBeenCalled();
  });
});
