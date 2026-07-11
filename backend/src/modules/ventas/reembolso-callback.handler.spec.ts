import { Test, type TestingModule } from '@nestjs/testing';
import { VentasReembolsoHandler } from './reembolso-callback.handler';
import { ReembolsoCallbackRegistry } from '../pasarela/services/reembolso-callback.registry';
import { VentasService } from './ventas.service';

describe('VentasReembolsoHandler', () => {
  let handler: VentasReembolsoHandler;
  let registry: ReembolsoCallbackRegistry;
  let ventasService: {
    crearNotaCredito: jest.Mock;
    registrarDevolucionesPorReembolso: jest.Mock;
  };

  const eventoBase = {
    tenantId: 't-1',
    ordenId: 'orden-1',
    codigoOrden: 'O-1',
    ventaId: 'venta-1',
    monto: '1100.0000',
    generarNotaCredito: false,
    devoluciones: [] as { itemId: string; cantidad: string }[],
    usuarioId: 'user-1',
  };

  beforeEach(async () => {
    ventasService = {
      crearNotaCredito: jest
        .fn()
        .mockResolvedValue({ id: 'nc-1', totalFinal: '1100.0000' }),
      registrarDevolucionesPorReembolso: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VentasReembolsoHandler,
        ReembolsoCallbackRegistry,
        { provide: VentasService, useValue: ventasService },
      ],
    }).compile();

    handler = module.get(VentasReembolsoHandler);
    registry = module.get(ReembolsoCallbackRegistry);
  });

  it('se registra en el registry al iniciar el módulo', () => {
    handler.onModuleInit();
    expect(registry.get()).toBe(handler);
  });

  it('con generarNotaCredito delega a crearNotaCredito con comentario autodescriptivo y devuelve el id', async () => {
    const res = await handler.onReembolsoAprobado({
      ...eventoBase,
      generarNotaCredito: true,
      devoluciones: [{ itemId: 'item-1', cantidad: '2' }],
    });
    expect(ventasService.crearNotaCredito).toHaveBeenCalledWith({
      tenantId: 't-1',
      usuarioId: 'user-1',
      ventaOriginalId: 'venta-1',
      monto: '1100.0000',
      devoluciones: [{ itemId: 'item-1', cantidad: '2' }],
      comentario: 'NC por reembolso orden O-1',
    });
    expect(res).toEqual({ notaCreditoId: 'nc-1' });
    expect(
      ventasService.registrarDevolucionesPorReembolso,
    ).not.toHaveBeenCalled();
  });

  it('sin NC pero con devoluciones delega al método hermano ligado a la venta original', async () => {
    const res = await handler.onReembolsoAprobado({
      ...eventoBase,
      devoluciones: [{ itemId: 'item-1', cantidad: '1' }],
    });
    expect(
      ventasService.registrarDevolucionesPorReembolso,
    ).toHaveBeenCalledWith({
      tenantId: 't-1',
      usuarioId: 'user-1',
      ventaOriginalId: 'venta-1',
      devoluciones: [{ itemId: 'item-1', cantidad: '1' }],
      comentario: 'Devolución por reembolso orden O-1',
    });
    expect(res).toEqual({});
    expect(ventasService.crearNotaCredito).not.toHaveBeenCalled();
  });

  it('sin NC ni devoluciones no hace nada', async () => {
    const res = await handler.onReembolsoAprobado(eventoBase);
    expect(res).toEqual({});
    expect(ventasService.crearNotaCredito).not.toHaveBeenCalled();
    expect(
      ventasService.registrarDevolucionesPorReembolso,
    ).not.toHaveBeenCalled();
  });

  it('propaga los errores (los captura pasarela, que responde con warning)', async () => {
    ventasService.crearNotaCredito.mockRejectedValueOnce(new Error('boom'));
    await expect(
      handler.onReembolsoAprobado({ ...eventoBase, generarNotaCredito: true }),
    ).rejects.toThrow('boom');
  });
});
