import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CallbackDispatcherService } from './callback-dispatcher.service';
import { PagoCallbackRegistry } from './pago-callback.registry';
import { PasarelaOrden } from '../entities/pasarela-orden.entity';

describe('CallbackDispatcherService', () => {
  let service: CallbackDispatcherService;
  const ordenRepo = { save: jest.fn((x) => Promise.resolve(x)) };
  const registry = { get: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        CallbackDispatcherService,
        { provide: getRepositoryToken(PasarelaOrden), useValue: ordenRepo },
        { provide: PagoCallbackRegistry, useValue: registry },
      ],
    }).compile();
    service = module.get(CallbackDispatcherService);
  });

  function orden(over: Partial<PasarelaOrden> = {}): PasarelaOrden {
    return {
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'pagada',
      metadata: { callbackModo: 'interno' },
      ...over,
    } as PasarelaOrden;
  }

  it('interno: espera al handler y marca la orden conciliada', async () => {
    const handler = { onOrdenResuelta: jest.fn().mockResolvedValue(undefined) };
    registry.get.mockReturnValue(handler);
    const o = orden();
    await service.dispatch(o);
    expect(handler.onOrdenResuelta).toHaveBeenCalledWith(o);
    expect(o.estado).toBe('conciliada');
    expect(ordenRepo.save).toHaveBeenCalledWith(o);
  });

  it('interno: si el handler falla con un error de dominio, la orden queda pagada con ese motivo', async () => {
    const handler = {
      onOrdenResuelta: jest
        .fn()
        .mockRejectedValue(
          new BadRequestException(
            'Las ventas online requieren el pago completo',
          ),
        ),
    };
    registry.get.mockReturnValue(handler);
    const o = orden();
    await expect(service.dispatch(o)).resolves.toBeUndefined();
    expect(o.estado).toBe('pagada');
    expect(o.motivoSinVenta).toBe(
      'Las ventas online requieren el pago completo',
    );
    expect(ordenRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: 'pagada',
        motivoSinVenta: 'Las ventas online requieren el pago completo',
      }),
    );
  });

  it('interno: un 400 de validación (mensaje en array) se une en un solo texto', async () => {
    const handler = {
      onOrdenResuelta: jest
        .fn()
        .mockRejectedValue(
          new BadRequestException(['cantidad debe ser positiva', 'otro']),
        ),
    };
    registry.get.mockReturnValue(handler);
    const o = orden();
    await service.dispatch(o);
    expect(o.motivoSinVenta).toBe('cantidad debe ser positiva; otro');
  });

  it('interno: un error que no es de dominio no filtra su texto (puede traer SQL)', async () => {
    const handler = {
      onOrdenResuelta: jest
        .fn()
        .mockRejectedValue(
          new Error('duplicate key value violates "ventas_pkey" SELECT ...'),
        ),
    };
    registry.get.mockReturnValue(handler);
    const o = orden();
    await service.dispatch(o);
    expect(o.estado).toBe('pagada');
    expect(o.motivoSinVenta).toBe(
      'Error interno al registrar la venta; el detalle quedó en el log del servidor',
    );
    expect(o.motivoSinVenta).not.toContain('ventas_pkey');
  });

  it('interno: si guardar el motivo falla, igual no rompe el retorno', async () => {
    registry.get.mockReturnValue({
      onOrdenResuelta: jest.fn().mockRejectedValue(new Error('boom')),
    });
    ordenRepo.save.mockRejectedValueOnce(new Error('db caída'));
    const o = orden();
    await expect(service.dispatch(o)).resolves.toBeUndefined();
    expect(o.estado).toBe('pagada');
  });

  it('interno: sin handler registrado, no lanza', async () => {
    registry.get.mockReturnValue(null);
    const o = orden();
    await expect(service.dispatch(o)).resolves.toBeUndefined();
    expect(o.estado).toBe('pagada');
  });

  it('no dispatch si la orden no está pagada (fallida)', async () => {
    registry.get.mockReturnValue({ onOrdenResuelta: jest.fn() });
    const o = orden({ estado: 'fallida' });
    await service.dispatch(o);
    expect(registry.get).not.toHaveBeenCalled();
    expect(ordenRepo.save).not.toHaveBeenCalled();
  });

  it('http: hace POST fire-and-forget y marca conciliada al recibir 2xx', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
    const o = orden({
      metadata: { callbackModo: 'http', urls: { callback: 'https://ext/cb' } },
    });
    await service.dispatch(o);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://ext/cb',
      expect.objectContaining({ method: 'POST' }),
    );
    // fire-and-forget: esperar a que resuelva la promesa interna
    await new Promise((r) => setImmediate(r));
    expect(o.estado).toBe('conciliada');
  });

  it('http: sin urlCallback, no hace nada', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const o = orden({ metadata: { callbackModo: 'http', urls: {} } });
    await service.dispatch(o);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
