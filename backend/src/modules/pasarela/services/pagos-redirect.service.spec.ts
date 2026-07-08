import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PagosRedirectService } from './pagos-redirect.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { ProviderFactory } from '../providers/provider.factory';
import { PasarelaOrden } from '../entities/pasarela-orden.entity';
import { ProviderComunicacionError } from '../providers/payment-provider.interface';

describe('PagosRedirectService', () => {
  let service: PagosRedirectService;
  const ordenRepo = {
    create: jest.fn((x: Partial<PasarelaOrden>) => x),
    save: jest.fn((x: Partial<PasarelaOrden>) =>
      Promise.resolve({ ordenId: 'orden-1', ...x }),
    ),
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const provider = { iniciarPago: jest.fn(), confirmarPago: jest.fn() };
  const deps = {
    tenantPasarela: {
      resolverConfiguracionActiva: jest.fn().mockResolvedValue({
        tenantPasarela: { tenantPasarelaId: 'tp-w' },
        pasarela: { codigo: 'webpay_plus' },
        cred: {},
      }),
    },
    transacciones: {
      registrar: jest.fn().mockResolvedValue({ transaccionId: 'tx-1' }),
    },
    config: { get: jest.fn().mockReturnValue('http://localhost:3000') },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    ordenRepo.update.mockResolvedValue({ affected: 1 });
    const module = await Test.createTestingModule({
      providers: [
        PagosRedirectService,
        { provide: getRepositoryToken(PasarelaOrden), useValue: ordenRepo },
        { provide: TenantPasarelaService, useValue: deps.tenantPasarela },
        { provide: TransaccionesService, useValue: deps.transacciones },
        {
          provide: ProviderFactory,
          useValue: { getPagoRedirect: () => provider },
        },
        { provide: ConfigService, useValue: deps.config },
      ],
    }).compile();
    service = module.get(PagosRedirectService);
  });

  it('iniciar: crea orden en_proceso con token del proveedor y devuelve urlWebpay', async () => {
    provider.iniciarPago.mockResolvedValue({
      tokenExterno: 'tok-1',
      urlRedireccion: 'https://webpay/redirect',
      aprobada: true,
      request: {},
      response: {},
    });
    const res = await service.iniciar('t-1', {
      monto: '10000',
      descripcion: 'Pago test',
      urlRetorno: 'https://app/ok',
    });
    expect(res.urlWebpay).toBe('https://webpay/redirect');
    expect(res.token).toBe('tok-1');
    const creada = ordenRepo.create.mock.calls[0][0];
    expect(creada.estado).toBe('en_proceso');
    expect(creada.tokenProveedor).toBe('tok-1');
    expect((creada.codigoOrden ?? '').length).toBeLessThanOrEqual(26);
    expect((creada.codigoOrden ?? '').length).toBeGreaterThan(0);
  });

  it('iniciar: monto <= 0 es rechazado', async () => {
    await expect(
      service.iniciar('t-1', {
        monto: '0',
        descripcion: 'x',
        urlRetorno: 'https://app/ok',
      }),
    ).rejects.toThrow('mayor a cero');
  });

  it('confirmarRetorno aprobado: orden pagada + transacción AUTHORIZATION aprobada, redirige con estado', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'en_proceso',
      monto: '10000',
      moneda: 'CLP',
      codigoOrden: 'W-1',
      metadata: { urlRetornoApp: 'https://app/ok', tenantPasarelaId: 'tp-w' },
    });
    provider.confirmarPago.mockResolvedValue({
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: '1213',
      identificadorTransaccionExterno: 'tok-1',
      tipoPago: 'VN',
      request: {},
      response: {},
    });
    const res = await service.confirmarRetorno('tok-1');
    expect(res.urlRedireccion).toContain('ordenId=orden-1');
    expect(res.urlRedireccion).toContain('estado=pagada');
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'AUTHORIZATION', estado: 'aprobada' }),
    );
  });

  it('confirmarRetorno doble: si el claim no afecta filas, redirige sin re-confirmar', async () => {
    ordenRepo.update.mockResolvedValue({ affected: 0 });
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'pagada',
      metadata: { urlRetornoApp: 'https://app/ok' },
    });
    const res = await service.confirmarRetorno('tok-1');
    expect(res.urlRedireccion).toContain('estado=pagada');
    expect(provider.confirmarPago).not.toHaveBeenCalled();
  });

  it('confirmarRetorno timeout: orden vuelve a en_proceso, transacción error, lanza BadGateway', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'procesando',
      monto: '10000',
      moneda: 'CLP',
      codigoOrden: 'W-1',
      metadata: { urlRetornoApp: 'https://app/ok', tenantPasarelaId: 'tp-w' },
    });
    provider.confirmarPago.mockRejectedValue(
      new ProviderComunicacionError('timeout', {}),
    );
    await expect(service.confirmarRetorno('tok-1')).rejects.toThrow(
      'verifique el estado',
    );
    // compensación: procesando → en_proceso
    expect(ordenRepo.update).toHaveBeenCalledWith(
      { ordenId: 'orden-1', estado: 'procesando' },
      { estado: 'en_proceso' },
    );
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'AUTHORIZATION', estado: 'error' }),
    );
  });
});
