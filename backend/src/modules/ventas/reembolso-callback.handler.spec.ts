import { Test, type TestingModule } from '@nestjs/testing';
import { VentasReembolsoHandler } from './reembolso-callback.handler';
import { ReembolsoCallbackRegistry } from '../pasarela/services/reembolso-callback.registry';
import { VentasService } from './ventas.service';
import { MonedasService } from '../monedas/monedas.service';

describe('VentasReembolsoHandler', () => {
  let handler: VentasReembolsoHandler;
  let registry: ReembolsoCallbackRegistry;
  let ventasService: {
    crearNotaCredito: jest.Mock;
    registrarDevolucionesPorReembolso: jest.Mock;
  };
  let monedasService: { decimalesDeLaVenta: jest.Mock };

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
    monedasService = {
      decimalesDeLaVenta: jest
        .fn()
        .mockResolvedValue({ decimales: 0, modoRedondeo: 'HALF_UP' }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VentasReembolsoHandler,
        ReembolsoCallbackRegistry,
        { provide: VentasService, useValue: ventasService },
        { provide: MonedasService, useValue: monedasService },
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

  it('un reembolso con decimales de más se cuantiza y se registra, no se rechaza', async () => {
    const logger = jest.spyOn(handler['logger'], 'warn');

    await handler.onReembolsoAprobado({
      ...eventoBase,
      generarNotaCredito: true,
      monto: '1000.5000',
    });

    expect(ventasService.crearNotaCredito).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '1001' }),
    );
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('1000.5000'), // el valor original queda en la traza
    );
  });

  it('la traza deja el número original de la pasarela, no solo un mensaje genérico', async () => {
    const logger = jest.spyOn(handler['logger'], 'warn');

    await handler.onReembolsoAprobado({
      ...eventoBase,
      generarNotaCredito: true,
      monto: '1000.5000',
    });

    const [mensaje] = logger.mock.calls[0] as [string];
    expect(mensaje).toContain('1000.5000');
    expect(mensaje).toContain('1001');
    expect(mensaje).toContain(eventoBase.ventaId);
  });

  it('un reembolso con monto ya válido para la moneda no deja traza', async () => {
    const logger = jest.spyOn(handler['logger'], 'warn');

    await handler.onReembolsoAprobado({
      ...eventoBase,
      generarNotaCredito: true,
      monto: '1000',
    });

    expect(ventasService.crearNotaCredito).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '1000' }),
    );
    expect(logger).not.toHaveBeenCalled();
  });

  it('cuantiza con el modo de redondeo CONGELADO en la venta, no con HALF_UP fijo: dos ventas con modo distinto dan resultados distintos', async () => {
    monedasService.decimalesDeLaVenta.mockResolvedValueOnce({
      decimales: 0,
      modoRedondeo: 'HALF_UP',
    });
    await handler.onReembolsoAprobado({
      ...eventoBase,
      generarNotaCredito: true,
      monto: '1000.5000',
    });
    const montoHalfUp = (
      ventasService.crearNotaCredito.mock.calls[0] as [{ monto: string }]
    )[0].monto;

    ventasService.crearNotaCredito.mockClear();
    monedasService.decimalesDeLaVenta.mockResolvedValueOnce({
      decimales: 0,
      modoRedondeo: 'FLOOR',
    });
    await handler.onReembolsoAprobado({
      ...eventoBase,
      generarNotaCredito: true,
      monto: '1000.5000',
    });
    const montoFloor = (
      ventasService.crearNotaCredito.mock.calls[0] as [{ monto: string }]
    )[0].monto;

    expect(montoHalfUp).toBe('1001');
    expect(montoFloor).toBe('1000');
    expect(montoHalfUp).not.toBe(montoFloor);
  });

  it('si la venta no tiene config_calculo (modoRedondeo null, como toda NC hoy) cuantiza con el fallback HALF_UP, sin rechazar', async () => {
    monedasService.decimalesDeLaVenta.mockResolvedValueOnce({
      decimales: 0,
      modoRedondeo: null,
    });

    await handler.onReembolsoAprobado({
      ...eventoBase,
      generarNotaCredito: true,
      monto: '1000.5000',
    });

    expect(ventasService.crearNotaCredito).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '1001' }),
    );
  });
});
