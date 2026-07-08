import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CobrosService } from './cobros.service';
import { InscripcionesService } from './inscripciones.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CredencialesService } from './credenciales.service';
import { ProviderFactory } from '../providers/provider.factory';
import { PasarelaOrden } from '../entities/pasarela-orden.entity';
import { ProviderComunicacionError } from '../providers/payment-provider.interface';

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
    },
    transacciones: {
      registrar: jest.fn().mockResolvedValue({ transaccionId: 'tx-1' }),
      listarPorOrden: jest.fn().mockResolvedValue([]),
    },
    credenciales: { descifrarTexto: jest.fn().mockReturnValue('tbk-u-1') },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        CobrosService,
        { provide: getRepositoryToken(PasarelaOrden), useValue: ordenRepo },
        { provide: InscripcionesService, useValue: deps.inscripciones },
        { provide: TenantPasarelaService, useValue: deps.tenantPasarela },
        { provide: TransaccionesService, useValue: deps.transacciones },
        { provide: CredencialesService, useValue: deps.credenciales },
        { provide: ProviderFactory, useValue: { get: () => provider } },
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
    expect(ordenCreada.codigoOrden.length).toBeLessThanOrEqual(26);
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
    );
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

  it('verificar cierra una orden en_proceso según el proveedor', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'en_proceso',
      codigoOrden: 'O-1',
      metadata: {},
      fechaExpiracion: null,
    });
    provider.consultarEstado.mockResolvedValue({
      estado: 'pagada',
      response: {},
    });
    const res = await service.verificar('t-1', 'orden-1');
    expect(res.estado).toBe('pagada');
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
});
