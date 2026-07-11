import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { CobrosService } from './cobros.service';
import { InscripcionesService } from './inscripciones.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CredencialesService } from './credenciales.service';
import { ProviderFactory } from '../providers/provider.factory';
import { PasarelaOrden } from '../entities/pasarela-orden.entity';
import { ProviderComunicacionError } from '../providers/payment-provider.interface';
import { ReembolsoCallbackRegistry } from './reembolso-callback.registry';

const inscripcionActiva = {
  inscripcionId: 'insc-1',
  tenantPasarelaId: 'tp-1',
  pagadorRef: 'rut-123',
  identificadorUsuarioExterno: 'insc-abc',
  identificadorExterno: 'v1:blob-tbk',
};

describe('CobrosService', () => {
  let service: CobrosService;
  const ordenRepo = {
    create: jest.fn((x: Partial<PasarelaOrden>) => x),
    save: jest.fn((x: Partial<PasarelaOrden>) =>
      Promise.resolve({ ordenId: 'orden-1', ...x }),
    ),
    findOne: jest.fn(),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
  };
  // reembolsar() corre dentro de dataSource.transaction; el manager delega en
  // los mismos mocks de ordenRepo para que los tests de reembolso no cambien.
  const manager = {
    findOne: jest.fn(
      (_entity: unknown, opts: unknown) =>
        ordenRepo.findOne(opts) as Promise<Partial<PasarelaOrden> | null>,
    ),
    save: jest.fn((x: Partial<PasarelaOrden>) => ordenRepo.save(x)),
  };
  const dataSource = {
    transaction: jest.fn((cb: (m: typeof manager) => Promise<unknown>) =>
      cb(manager),
    ),
  };
  const provider = {
    autorizarCobro: jest.fn(),
    reembolsar: jest.fn(),
    consultarEstado: jest.fn(),
  };
  const deps = {
    inscripciones: {
      resolverParaCobro: jest.fn().mockResolvedValue(inscripcionActiva),
    },
    tenantPasarela: {
      resolverConfiguracionActiva: jest.fn().mockResolvedValue({
        tenantPasarela: { tenantPasarelaId: 'tp-1' },
        pasarela: { codigo: 'oneclick' },
        cred: {},
      }),
      resolverPorId: jest.fn().mockResolvedValue({
        tenantPasarela: { tenantPasarelaId: 'tp-1' },
        pasarela: { codigo: 'oneclick' },
        cred: {},
      }),
    },
    transacciones: {
      registrar: jest.fn().mockResolvedValue({ transaccionId: 'tx-1' }),
      listarPorOrden: jest.fn().mockResolvedValue([]),
      redactar: jest.fn((o: Record<string, unknown>) => o),
    },
    credenciales: { descifrarTexto: jest.fn().mockReturnValue('tbk-u-1') },
  };
  const reembolsoHandler = {
    onReembolsoAprobado: jest.fn(),
  };
  const reembolsoRegistry = {
    register: jest.fn(),
    get: jest.fn(() => reembolsoHandler),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        CobrosService,
        { provide: getRepositoryToken(PasarelaOrden), useValue: ordenRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: InscripcionesService, useValue: deps.inscripciones },
        { provide: TenantPasarelaService, useValue: deps.tenantPasarela },
        { provide: TransaccionesService, useValue: deps.transacciones },
        { provide: CredencialesService, useValue: deps.credenciales },
        { provide: ReembolsoCallbackRegistry, useValue: reembolsoRegistry },
        {
          provide: ProviderFactory,
          useValue: {
            getTokenizado: () => provider,
            getReembolsable: () => provider,
          },
        },
      ],
    }).compile();
    service = module.get(CobrosService);
  });

  it('cobro aprobado: orden pagada + transacción AUTHORIZATION aprobada', async () => {
    provider.autorizarCobro.mockResolvedValue({
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: '1213',
      identificadorTransaccionExterno: 'O-x',
      tipoPago: 'VN',
      numeroCuotas: 0,
      montoCuota: null,
      tarjetaUltimos4: '6623',
      request: {},
      response: {},
    });
    const res = await service.cobrar(
      't-1',
      {
        pagadorRef: 'rut-123',
        monto: '5000',
        descripcion: 'Cobro test',
      },
      'api',
      'key-1',
    );
    expect(res.estado).toBe('pagada');
    // la orden se guardó con codigoOrden ≤ 26 chars (límite Oneclick)
    const ordenCreada = ordenRepo.save.mock.calls[0][0];
    expect(ordenCreada.codigoOrden?.length ?? 0).toBeLessThanOrEqual(26);
    expect(ordenCreada.codigoOrden?.length ?? 0).toBeGreaterThan(0);
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'AUTHORIZATION', estado: 'aprobada' }),
    );
  });

  it('cobro rechazado: orden fallida, respuesta 200 con detalle (no lanza)', async () => {
    provider.autorizarCobro.mockResolvedValue({
      aprobada: false,
      codigoRespuesta: '-1',
      codigoAutorizacion: null,
      identificadorTransaccionExterno: 'O-y',
      tipoPago: 'VN',
      numeroCuotas: 0,
      montoCuota: null,
      tarjetaUltimos4: null,
      request: {},
      response: {},
    });
    const res = await service.cobrar(
      't-1',
      {
        pagadorRef: 'rut-123',
        monto: '5000',
        descripcion: 'x',
      },
      'interno',
    );
    expect(res.estado).toBe('fallida');
    expect(res.codigoRespuesta).toBe('-1');
  });

  it('timeout: transacción error, orden QUEDA en_proceso y lanza BadGateway', async () => {
    provider.autorizarCobro.mockRejectedValue(
      new ProviderComunicacionError('timeout', {}),
    );
    await expect(
      service.cobrar(
        't-1',
        { pagadorRef: 'rut-123', monto: '5000', descripcion: 'x' },
        'api',
      ),
    ).rejects.toThrow('verifique el estado');
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'AUTHORIZATION', estado: 'error' }),
    );
    // ningún save posterior cambió el estado a fallida/pagada
    const estadosGuardados = ordenRepo.save.mock.calls.map((c) => c[0].estado);
    expect(estadosGuardados).not.toContain('fallida');
    expect(estadosGuardados).not.toContain('pagada');
  });

  it('reembolso total: transacción REFUND hija + orden reembolsada', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'pagada',
      monto: '5000',
      moneda: 'CLP',
      codigoOrden: 'O-1',
    });
    deps.transacciones.listarPorOrden.mockResolvedValue([
      {
        transaccionId: 'tx-auth',
        tipo: 'AUTHORIZATION',
        estado: 'aprobada',
        tenantPasarelaId: 'tp-1',
        inscripcionId: 'insc-1',
        monto: '5000',
      },
    ]);
    provider.reembolsar.mockResolvedValue({
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: null,
      identificadorTransaccionExterno: null,
      tipoPago: 'REVERSED',
      numeroCuotas: null,
      montoCuota: null,
      tarjetaUltimos4: null,
      request: {},
      response: {},
    });
    const res = await service.reembolsar('t-1', 'orden-1', { monto: '5000' });
    expect(res.estado).toBe('reembolsada');
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'REFUND',
        transaccionPadreId: 'tx-auth',
      }),
      manager,
    );
  });

  it('reembolso de una orden conciliada (checkout online) es aceptado', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'conciliada',
      monto: '5000',
      moneda: 'CLP',
      codigoOrden: 'O-1',
    });
    deps.transacciones.listarPorOrden.mockResolvedValue([
      {
        transaccionId: 'tx-auth',
        tipo: 'AUTHORIZATION',
        estado: 'aprobada',
        tenantPasarelaId: 'tp-1',
        inscripcionId: 'insc-1',
        monto: '5000',
      },
    ]);
    provider.reembolsar.mockResolvedValue({
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: null,
      identificadorTransaccionExterno: null,
      tipoPago: 'REVERSED',
      numeroCuotas: null,
      montoCuota: null,
      tarjetaUltimos4: null,
      request: {},
      response: {},
    });
    const res = await service.reembolsar('t-1', 'orden-1', { monto: '5000' });
    expect(res.estado).toBe('reembolsada');
    expect(provider.reembolsar).toHaveBeenCalled();
  });

  describe('reembolso — hook post-commit de NC/devoluciones', () => {
    const ordenConVenta = {
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'conciliada',
      monto: '5000',
      moneda: 'CLP',
      codigoOrden: 'O-1',
      ventaId: 'venta-1',
    };
    const authAprobada = [
      {
        transaccionId: 'tx-auth',
        tipo: 'AUTHORIZATION',
        estado: 'aprobada',
        tenantPasarelaId: 'tp-1',
        inscripcionId: 'insc-1',
        monto: '5000',
      },
    ];
    const refundAprobado = {
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: null,
      identificadorTransaccionExterno: null,
      tipoPago: 'REVERSED',
      numeroCuotas: null,
      montoCuota: null,
      tarjetaUltimos4: null,
      request: {},
      response: {},
    };

    beforeEach(() => {
      ordenRepo.findOne.mockResolvedValue({ ...ordenConVenta });
      deps.transacciones.listarPorOrden.mockResolvedValue(authAprobada);
      provider.reembolsar.mockResolvedValue(refundAprobado);
      reembolsoHandler.onReembolsoAprobado.mockResolvedValue({
        notaCreditoId: 'nc-1',
      });
    });

    it('reembolso aprobado con generarNotaCredito invoca el handler con el evento completo y responde notaCreditoId', async () => {
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        {
          monto: '1100',
          generarNotaCredito: true,
          devoluciones: [{ itemId: 'item-1', cantidad: '2' }],
        },
        'user-1',
      );
      expect(reembolsoHandler.onReembolsoAprobado).toHaveBeenCalledWith({
        tenantId: 't-1',
        ordenId: 'orden-1',
        codigoOrden: 'O-1',
        ventaId: 'venta-1',
        monto: '1100',
        generarNotaCredito: true,
        devoluciones: [{ itemId: 'item-1', cantidad: '2' }],
        usuarioId: 'user-1',
      });
      expect(res.notaCreditoId).toBe('nc-1');
      expect(res.warning).toBeUndefined();
    });

    it('si el handler falla, el reembolso NO se revierte: responde con warning y el REFUND queda registrado', async () => {
      reembolsoHandler.onReembolsoAprobado.mockRejectedValueOnce(
        new Error('NC falló'),
      );
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100', generarNotaCredito: true },
        'user-1',
      );
      expect(res.warning).toContain('reembolso fue procesado');
      expect(deps.transacciones.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: 'REFUND', estado: 'aprobada' }),
        manager,
      );
    });

    it('reembolso rechazado por el proveedor NO invoca el handler', async () => {
      provider.reembolsar.mockResolvedValueOnce({
        ...refundAprobado,
        aprobada: false,
        codigoRespuesta: '-1',
      });
      await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100', generarNotaCredito: true },
        'user-1',
      );
      expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
    });

    it('flags sin venta vinculada: NO invoca el handler y responde warning informativo', async () => {
      ordenRepo.findOne.mockResolvedValue({
        ...ordenConVenta,
        ventaId: null,
      });
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100', generarNotaCredito: true },
        'user-1',
      );
      expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
      expect(res.warning).toContain('venta vinculada');
    });

    it('regresión: reembolso sin flags no invoca el handler ni agrega warning', async () => {
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        'user-1',
      );
      expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
      expect(res.warning).toBeUndefined();
      expect(res.notaCreditoId).toBeUndefined();
    });
  });

  it('reembolso toma FOR UPDATE y recomputa el saldo bajo el lock: si el REFUND previo lo agota, es rechazado', async () => {
    // Unit test: verifica el contrato (findOne con lock pesimista + recálculo del
    // saldo tras leer el historial). La serialización real de dos reembolsos
    // concurrentes solo se puede comprobar con BD real (ver e2e en el plan de
    // endurecimiento, ítem 3). Aquí se simula que, tras adquirir el lock, ya se
    // ve un REFUND aprobado previo que agota el saldo → excede lo disponible.
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'pagada',
      monto: '5000',
      moneda: 'CLP',
      codigoOrden: 'O-1',
    });
    deps.transacciones.listarPorOrden.mockResolvedValue([
      {
        transaccionId: 'tx-auth',
        tipo: 'AUTHORIZATION',
        estado: 'aprobada',
        tenantPasarelaId: 'tp-1',
        inscripcionId: 'insc-1',
        monto: '5000',
      },
      {
        transaccionId: 'tx-r1',
        tipo: 'REFUND',
        estado: 'aprobada',
        monto: '5000',
      },
    ]);
    await expect(
      service.reembolsar('t-1', 'orden-1', { monto: '5000' }),
    ).rejects.toThrow('excede');
    // corrió dentro de una transacción y con lock pesimista de la orden
    expect(dataSource.transaction).toHaveBeenCalled();
    expect(manager.findOne).toHaveBeenCalledWith(
      PasarelaOrden,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(provider.reembolsar).not.toHaveBeenCalled();
  });

  it('reembolso mayor al saldo disponible es rechazado', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'pagada',
      monto: '5000',
      moneda: 'CLP',
      codigoOrden: 'O-1',
    });
    deps.transacciones.listarPorOrden.mockResolvedValue([
      {
        transaccionId: 'tx-auth',
        tipo: 'AUTHORIZATION',
        estado: 'aprobada',
        tenantPasarelaId: 'tp-1',
        inscripcionId: null,
        monto: '5000',
      },
      {
        transaccionId: 'tx-r1',
        tipo: 'REFUND',
        estado: 'aprobada',
        monto: '4000',
      },
    ]);
    await expect(
      service.reembolsar('t-1', 'orden-1', { monto: '2000' }),
    ).rejects.toThrow('excede');
  });

  it('reembolso con monto <= 0 es rechazado antes de tocar la orden', async () => {
    await expect(
      service.reembolsar('t-1', 'orden-1', { monto: '-1000' }),
    ).rejects.toThrow('mayor a cero');
    expect(ordenRepo.findOne).not.toHaveBeenCalled();
  });

  it('timeout en reembolso: transacción error + BadGateway, orden no cambia', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'pagada',
      monto: '5000',
      moneda: 'CLP',
      codigoOrden: 'O-1',
    });
    deps.transacciones.listarPorOrden.mockResolvedValue([
      {
        transaccionId: 'tx-auth',
        tipo: 'AUTHORIZATION',
        estado: 'aprobada',
        tenantPasarelaId: 'tp-1',
        inscripcionId: 'insc-1',
        monto: '5000',
      },
    ]);
    provider.reembolsar.mockRejectedValue(
      new ProviderComunicacionError('timeout', {}),
    );
    await expect(
      service.reembolsar('t-1', 'orden-1', { monto: '5000' }),
    ).rejects.toThrow('verifique el estado');
    // La auditoría del intento se registra FUERA de la transacción (sin el
    // manager): el ProviderComunicacionError se propaga, la tx hace rollback y
    // libera el FOR UPDATE, y recién ahí se escribe el rastro por conexión
    // normal. Registrarlo dentro (con el manager sobre una conexión propia)
    // auto-bloquearía por el conflicto FK FOR KEY SHARE ↔ FOR UPDATE.
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'REFUND', estado: 'error' }),
    );
    expect(deps.transacciones.registrar).not.toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'REFUND', estado: 'error' }),
      manager,
    );
    // la orden nunca pasó a 'reembolsada'
    const estadosGuardados = ordenRepo.save.mock.calls.map((c) => c[0].estado);
    expect(estadosGuardados).not.toContain('reembolsada');
  });

  it('verificar cierra una orden en_proceso según el proveedor', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'en_proceso',
      codigoOrden: 'O-1',
      tokenProveedor: null,
      metadata: { tenantPasarelaId: 'tp-1' },
      fechaExpiracion: null,
    });
    provider.consultarEstado.mockResolvedValue({
      estado: 'pagada',
      response: {},
    });
    const res = await service.verificar('t-1', 'orden-1');
    expect(res.estado).toBe('pagada');
  });

  it('verificar reconcilia también una orden expirada (no cierra la puerta al timeout)', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'expirada',
      codigoOrden: 'O-1',
      tokenProveedor: null,
      metadata: { tenantPasarelaId: 'tp-1' },
      fechaExpiracion: new Date(Date.now() - 60_000),
    });
    provider.consultarEstado.mockResolvedValue({
      estado: 'pagada',
      response: { tbk_user: 'secreto' },
    });
    const res = await service.verificar('t-1', 'orden-1');
    expect(res.estado).toBe('pagada');
    // la respuesta del proveedor se redacta antes de persistir en metadata
    expect(deps.transacciones.redactar).toHaveBeenCalledWith({
      tbk_user: 'secreto',
    });
  });

  it('obtenerOrden aplica expiración perezosa', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'en_proceso',
      fechaExpiracion: new Date(Date.now() - 60_000),
      metadata: {},
    });
    const res = await service.obtenerOrden('t-1', 'orden-1');
    expect(res.estado).toBe('expirada');
  });

  it('obtenerOrden NO expira una orden con intento de auth (timeout reconciliable)', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'en_proceso',
      fechaExpiracion: new Date(Date.now() - 60_000),
      metadata: {},
    });
    deps.transacciones.listarPorOrden.mockResolvedValue([
      { transaccionId: 'tx-1', tipo: 'AUTHORIZATION', estado: 'error' },
    ]);
    const res = await service.obtenerOrden('t-1', 'orden-1');
    // se mantiene en_proceso: solo /verificar puede cerrarla (pudo pagarse)
    expect(res.estado).toBe('en_proceso');
    expect(ordenRepo.save).not.toHaveBeenCalled();
  });
});
