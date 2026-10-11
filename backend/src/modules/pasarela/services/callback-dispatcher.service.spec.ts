import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CallbackDispatcherService } from './callback-dispatcher.service';
import { PagoCallbackRegistry } from './pago-callback.registry';
import { PasarelaOrden } from '../entities/pasarela-orden.entity';
import { Db } from '../../../common/db/db.service';
import { assertSinHuecos } from '../../../common/db/db.spec-helper';

describe('CallbackDispatcherService', () => {
  let service: CallbackDispatcherService;
  const ordenRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
  const registry = { get: jest.fn() };
  // El cierre es un UPDATE … RETURNING (pg: [filas, rowCount]). Lo que se
  // escribe y sobre qué estado lo decide el SQL, y eso solo lo ve Postgres:
  // las carreras están en `pasarela-escritores-orden.e2e-spec.ts`. Acá, lo
  // que la orden en memoria recibe de vuelta.
  const db = { query: jest.fn() };
  const devuelve = (fila: Record<string, unknown>) =>
    db.query.mockResolvedValueOnce([[fila], 1]);

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        CallbackDispatcherService,
        { provide: getRepositoryToken(PasarelaOrden), useValue: ordenRepo },
        { provide: PagoCallbackRegistry, useValue: registry },
        { provide: Db, useValue: db },
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
    devuelve({ estado: 'conciliada', venta_id: 'venta-1' });
    await service.dispatch(o);
    expect(handler.onOrdenResuelta).toHaveBeenCalledWith(o);
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    assertSinHuecos(sql, params);
    expect(o.estado).toBe('conciliada');
    expect(o.ventaId).toBe('venta-1');
  });

  it('interno: la orden en memoria queda como la dejó la base (reembolsada en el medio)', async () => {
    registry.get.mockReturnValue({
      onOrdenResuelta: jest.fn().mockResolvedValue(undefined),
    });
    const o = orden();
    devuelve({ estado: 'reembolsada', venta_id: 'venta-1' });
    await service.dispatch(o);
    expect(o.estado).toBe('reembolsada');
    expect(o.ventaId).toBe('venta-1');
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
    devuelve({
      estado: 'pagada',
      motivo_sin_venta: 'Las ventas online requieren el pago completo',
    });
    await expect(service.dispatch(o)).resolves.toBeUndefined();
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    assertSinHuecos(sql, params);
    expect(params).toEqual([
      'orden-1',
      'Las ventas online requieren el pago completo',
    ]);
    expect(o.estado).toBe('pagada');
    expect(o.motivoSinVenta).toBe(
      'Las ventas online requieren el pago completo',
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
    expect((db.query.mock.calls[0] as [string, unknown[]])[1][1]).toBe(
      'cantidad debe ser positiva; otro',
    );
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
    const motivo = (db.query.mock.calls[0] as [string, unknown[]])[1][1];
    expect(motivo).toBe(
      'Error interno al registrar la venta; el detalle quedó en el log del servidor',
    );
    expect(motivo).not.toContain('ventas_pkey');
  });

  it('interno: si guardar el motivo falla, igual no rompe el retorno', async () => {
    registry.get.mockReturnValue({
      onOrdenResuelta: jest.fn().mockRejectedValue(new Error('boom')),
    });
    db.query.mockRejectedValueOnce(new Error('db caída'));
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
    expect(db.query).not.toHaveBeenCalled();
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
    // Condicionado al estado: un reembolso en el medio ya la dejó reembolsada.
    expect(ordenRepo.update).toHaveBeenCalledWith(
      { ordenId: 'orden-1', estado: 'pagada' },
      { estado: 'conciliada' },
    );
  });

  it('http: sin urlCallback, no hace nada', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const o = orden({ metadata: { callbackModo: 'http', urls: {} } });
    await service.dispatch(o);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
