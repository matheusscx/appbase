import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { EntityManager } from 'typeorm';
import { VentasReembolsoHandler } from './reembolso-callback.handler';
import { ReembolsoCallbackRegistry } from '../pasarela/services/reembolso-callback.registry';
import { VentasService } from './ventas.service';
import { MonedasService } from '../monedas/monedas.service';

describe('VentasReembolsoHandler', () => {
  let handler: VentasReembolsoHandler;
  let registry: ReembolsoCallbackRegistry;
  let ventasService: {
    crearNotaCredito: jest.Mock;
    viaDeReembolsoPasarela: jest.Mock;
    exigirTopeDelReembolsoPasarela: jest.Mock;
  };
  let monedasService: { decimalesDeLaVenta: jest.Mock };

  const eventoBase = {
    tenantId: 't-1',
    ordenId: 'orden-1',
    codigoOrden: 'O-1',
    ventaId: 'venta-1',
    monto: '1100.0000',
    devoluciones: [] as { itemId: string; cantidad: string }[],
    usuarioId: 'user-1',
    ligarCorreccion: jest.fn(),
  };

  beforeEach(async () => {
    ventasService = {
      crearNotaCredito: jest
        .fn()
        .mockResolvedValue({ id: 'nc-1', totalFinal: '1100.0000' }),
      exigirTopeDelReembolsoPasarela: jest.fn().mockResolvedValue(undefined),
      viaDeReembolsoPasarela: jest.fn().mockResolvedValue({
        tipo: 'pasarela',
        documentoId: 'doc-boleta',
        pagoId: 'pago-1',
      }),
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

  it('el tope por pago del REFUND lo resuelve ventas, con la misma transacción y sin tocar nada más', async () => {
    const manager = {} as EntityManager;
    const params = {
      tenantId: 't-1',
      ventaId: 'venta-1',
      monto: '70000',
      excluirReembolsoId: 'refund-propio',
    };

    await handler.exigirTopeDelReembolso(manager, params);

    expect(ventasService.exigirTopeDelReembolsoPasarela).toHaveBeenCalledWith(
      manager,
      params,
    );
    expect(ventasService.crearNotaCredito).not.toHaveBeenCalled();
  });

  it('un 400 del tope se propaga tal cual (lo ve el cliente)', async () => {
    ventasService.exigirTopeDelReembolsoPasarela.mockRejectedValueOnce(
      new BadRequestException('tope'),
    );

    await expect(
      handler.exigirTopeDelReembolso({} as EntityManager, {
        tenantId: 't-1',
        ventaId: 'venta-1',
        monto: '70001',
        excluirReembolsoId: null,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('se registra en el registry al iniciar el módulo', () => {
    handler.onModuleInit();
    expect(registry.get()).toBe(handler);
  });

  it('delega a crearNotaCredito con comentario autodescriptivo, las devoluciones dentro, y devuelve el id de la corrección', async () => {
    const res = await handler.onReembolsoAprobado({
      ...eventoBase,
      devoluciones: [{ itemId: 'item-1', cantidad: '2' }],
    });
    expect(ventasService.crearNotaCredito).toHaveBeenCalledWith({
      tenantId: 't-1',
      usuarioId: 'user-1',
      ventaOriginalId: 'venta-1',
      monto: '1100.0000',
      devoluciones: [{ itemId: 'item-1', cantidad: '2' }],
      comentario: 'NC por reembolso orden O-1',
      // La plata ya volvió por el proveedor: corrige el único documento válido
      // de la venta y no mueve caja.
      via: { tipo: 'pasarela', documentoId: 'doc-boleta', pagoId: 'pago-1' },
      // El vínculo con el REFUND corre adentro de la transacción de la nota.
      enLaTransaccion: eventoBase.ligarCorreccion,
    });
    expect(ventasService.viaDeReembolsoPasarela).toHaveBeenCalledWith(
      't-1',
      'venta-1',
      'orden-1',
    );
    expect(res).toEqual({ correccionVentaId: 'nc-1' });
  });

  it('"Generar nota": la clave del intento y el chequeo bajo el lock de la venta llegan a la nota, y la reproducción se informa', async () => {
    const idempotencia = {
      tenantId: 't-1',
      usuarioId: 'admin-1',
      clave: 'clave-1',
      operacion: 'pasarela.generarNota' as const,
      huella: 'h',
      mensajeOtrosDatos: 'otros datos',
    };
    const alTomarLaVenta = jest.fn();
    ventasService.crearNotaCredito.mockResolvedValueOnce({
      id: 'nc-1',
      totalFinal: '1100.0000',
      repetida: true,
    });

    const res = await handler.onReembolsoAprobado({
      ...eventoBase,
      idempotencia,
      alTomarLaVenta,
    });

    expect(ventasService.crearNotaCredito).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencia,
        alTomarLaVenta,
        enLaTransaccion: eventoBase.ligarCorreccion,
      }),
    );
    expect(res).toEqual({ correccionVentaId: 'nc-1', repetida: true });
  });

  it('el hook no pasa clave: la nota no reclama nada y la respuesta no dice "repetida"', async () => {
    const res = await handler.onReembolsoAprobado(eventoBase);

    const params = ventasService.crearNotaCredito.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(params.idempotencia).toBeUndefined();
    expect(params.alTomarLaVenta).toBeUndefined();
    expect(res).not.toHaveProperty('repetida');
  });

  it('todo reembolso deja su corrección, también el que no pide devolver ningún ítem', async () => {
    // Antes la nota dependía de una casilla y, sin ella, un reembolso sin
    // devoluciones no dejaba ningún registro del lado de ventas.
    const res = await handler.onReembolsoAprobado(eventoBase);

    expect(ventasService.crearNotaCredito).toHaveBeenCalledTimes(1);
    expect(ventasService.crearNotaCredito).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '1100.0000', devoluciones: [] }),
    );
    expect(res).toEqual({ correccionVentaId: 'nc-1' });
  });

  it('propaga los errores (los captura pasarela, que responde con warning)', async () => {
    ventasService.crearNotaCredito.mockRejectedValueOnce(new Error('boom'));
    await expect(handler.onReembolsoAprobado(eventoBase)).rejects.toThrow(
      'boom',
    );
  });

  it('una nota sobre una corrección (la orden quedó ligada a una nota) no se emite: el error llega con su motivo, para que la pasarela lo devuelva como warning', async () => {
    ventasService.crearNotaCredito.mockRejectedValueOnce(
      new BadRequestException(
        'No se puede emitir una nota de crédito sobre otra nota de crédito',
      ),
    );

    const resultado = handler.onReembolsoAprobado({
      ...eventoBase,
    });

    await expect(resultado).rejects.toThrow(
      'No se puede emitir una nota de crédito sobre otra nota de crédito',
    );
    // Y no devolvió ningún id: no hay corrección creada que anunciar.
    await expect(resultado).rejects.not.toHaveProperty('correccionVentaId');
  });

  it('un reembolso con decimales de más se cuantiza y se registra, no se rechaza', async () => {
    const logger = jest.spyOn(handler['logger'], 'warn');

    await handler.onReembolsoAprobado({
      ...eventoBase,
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
      monto: '1000.5000',
    });

    expect(ventasService.crearNotaCredito).toHaveBeenCalledWith(
      expect.objectContaining({ monto: '1001' }),
    );
  });
});
