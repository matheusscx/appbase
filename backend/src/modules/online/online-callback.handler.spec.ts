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

  function orden(over: Partial<PasarelaOrden> = {}): PasarelaOrden {
    return {
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'pagada',
      referenciaExterna: null,
      metadata: {
        origenApp: 'tienda-online',
        checkout: {
          lineas: [{ itemId: ITEM_ID, cantidad: '2' }],
          metodoPagoId: 'mp-credito',
          totalFinal: '100.0000',
          usuarioId: 'u-1',
          customerNombre: 'user@x.cl',
        },
      },
      ...over,
    } as PasarelaOrden;
  }

  it('onModuleInit se registra en el registry', () => {
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('crea la venta canal online y deja referenciaExterna = venta.id', async () => {
    ventas.crear.mockResolvedValue({ id: 'venta-9' });
    const o = orden();
    await handler.onOrdenResuelta(o);

    expect(ventas.crear).toHaveBeenCalledWith(
      't-1',
      'u-1',
      expect.objectContaining({
        canal: 'online',
        lineas: [{ itemId: ITEM_ID, cantidad: '2' }],
        pagos: [{ metodoPagoId: 'mp-credito', monto: '100.0000' }],
        customer: { nombre: 'user@x.cl' },
      }),
    );
    expect(o.referenciaExterna).toBe('venta-9');
  });

  it('idempotente: si ya hay referenciaExterna, no crea venta', async () => {
    const o = orden({ referenciaExterna: 'venta-previa' });
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
