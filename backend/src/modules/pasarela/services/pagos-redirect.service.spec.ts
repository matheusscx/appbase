import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PagosRedirectService } from './pagos-redirect.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CallbackDispatcherService } from './callback-dispatcher.service';
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
    dispatcher: { dispatch: jest.fn().mockResolvedValue(undefined) },
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
        { provide: CallbackDispatcherService, useValue: deps.dispatcher },
        {
          provide: ProviderFactory,
          useValue: { getPagoRedirect: () => provider },
        },
        { provide: ConfigService, useValue: deps.config },
      ],
    }).compile();
    service = module.get(PagosRedirectService);
  });

  const dtoBase = {
    monto: '10000',
    descripcion: 'Pago test',
    urlExito: 'https://app/ok',
    urlFracaso: 'https://app/fail',
  };

  it('iniciar: crea orden en_proceso con token del proveedor y devuelve urlWebpay', async () => {
    provider.iniciarPago.mockResolvedValue({
      tokenExterno: 'tok-1',
      urlRedireccion: 'https://webpay/redirect',
      aprobada: true,
      request: {},
      response: {},
    });
    const res = await service.iniciar('t-1', dtoBase);
    expect(res.urlWebpay).toBe('https://webpay/redirect');
    expect(res.token).toBe('tok-1');
    const creada = ordenRepo.create.mock.calls[0][0];
    expect(creada.estado).toBe('en_proceso');
    expect(creada.tokenProveedor).toBe('tok-1');
    expect((creada.codigoOrden ?? '').length).toBeLessThanOrEqual(26);
    expect((creada.codigoOrden ?? '').length).toBeGreaterThan(0);
  });

  it('iniciar interno: guarda 4 URLs + callbackModo interno y fusiona metadataExtra', async () => {
    provider.iniciarPago.mockResolvedValue({
      tokenExterno: 'tok-1',
      urlRedireccion: 'https://webpay/redirect',
      aprobada: true,
      request: {},
      response: {},
    });
    await service.iniciar('t-1', dtoBase, {
      origen: 'interno',
      metadataExtra: {
        origenApp: 'tienda-online',
        checkout: { totalFinal: '10000' },
      },
    });
    const creada = ordenRepo.create.mock.calls[0][0];
    const metadata = creada.metadata as {
      callbackModo: string;
      origenApp: string;
      tenantPasarelaId: string;
      urls: Record<string, string | null>;
    };
    expect(creada.origen).toBe('interno');
    expect(metadata.callbackModo).toBe('interno');
    expect(metadata.urls).toEqual({
      exito: 'https://app/ok',
      fracaso: 'https://app/fail',
      pendiente: 'https://app/ok', // default = exito
      callback: null,
    });
    expect(metadata.origenApp).toBe('tienda-online');
    expect(metadata.tenantPasarelaId).toBe('tp-w');
  });

  it('iniciar api (default): callbackModo http', async () => {
    provider.iniciarPago.mockResolvedValue({
      tokenExterno: 'tok-1',
      urlRedireccion: 'https://webpay/redirect',
      request: {},
      response: {},
    });
    await service.iniciar('t-1', { ...dtoBase, urlCallback: 'https://ext/cb' });
    const creada = ordenRepo.create.mock.calls[0][0];
    const metadata = creada.metadata as {
      callbackModo: string;
      urls: Record<string, string | null>;
    };
    expect(creada.origen).toBe('api');
    expect(metadata.callbackModo).toBe('http');
    expect(metadata.urls.callback).toBe('https://ext/cb');
  });

  it('iniciar: monto <= 0 es rechazado', async () => {
    await expect(
      service.iniciar('t-1', { ...dtoBase, monto: '0' }),
    ).rejects.toThrow('mayor a cero');
  });

  it('confirmarRetorno aprobado: orden pagada, dispara callback y redirige a urls.exito', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'en_proceso',
      monto: '10000',
      moneda: 'CLP',
      codigoOrden: 'W-1',
      metadata: {
        urls: { exito: 'https://app/ok', fracaso: 'https://app/fail' },
        tenantPasarelaId: 'tp-w',
      },
    });
    provider.confirmarPago.mockResolvedValue({
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: '1213',
      identificadorTransaccionExterno: 'tok-1',
      tipoPago: 'VD',
      numeroCuotas: 0,
      tarjetaUltimos4: '6623',
      request: {},
      response: {},
    });
    const res = await service.confirmarRetorno('tok-1');
    expect(res.urlRedireccion).toContain('https://app/ok');
    expect(res.urlRedireccion).toContain('ordenId=orden-1');
    expect(res.urlRedireccion).toContain('estado=pagada');
    expect(deps.dispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'pagada' }),
    );
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'AUTHORIZATION', estado: 'aprobada' }),
    );
    // El detalle del commit queda en metadata.resultadoPago para el callback.
    const guardada = ordenRepo.save.mock.calls[0][0] as {
      metadata: {
        resultadoPago: { tipoPago: string; tarjetaUltimos4: string };
      };
    };
    expect(guardada.metadata.resultadoPago).toMatchObject({
      tipoPago: 'VD',
      tarjetaUltimos4: '6623',
    });
  });

  it('confirmarRetorno rechazado: orden fallida, redirige a urls.fracaso', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'en_proceso',
      monto: '10000',
      moneda: 'CLP',
      codigoOrden: 'W-1',
      metadata: {
        urls: { exito: 'https://app/ok', fracaso: 'https://app/fail' },
        tenantPasarelaId: 'tp-w',
      },
    });
    provider.confirmarPago.mockResolvedValue({
      aprobada: false,
      codigoRespuesta: '-1',
      request: {},
      response: {},
    });
    const res = await service.confirmarRetorno('tok-1');
    expect(res.urlRedireccion).toContain('https://app/fail');
    expect(res.urlRedireccion).toContain('estado=fallida');
  });

  it('confirmarRetorno doble: si el claim no afecta filas, redirige sin re-confirmar', async () => {
    ordenRepo.update.mockResolvedValue({ affected: 0 });
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'pagada',
      metadata: {
        urls: { exito: 'https://app/ok', fracaso: 'https://app/fail' },
      },
    });
    const res = await service.confirmarRetorno('tok-1');
    expect(res.urlRedireccion).toContain('estado=pagada');
    expect(provider.confirmarPago).not.toHaveBeenCalled();
    expect(deps.dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('confirmarRetorno timeout: orden vuelve a en_proceso, transacción error, lanza BadGateway', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'procesando',
      monto: '10000',
      moneda: 'CLP',
      codigoOrden: 'W-1',
      metadata: {
        urls: { exito: 'https://app/ok', fracaso: 'https://app/fail' },
        tenantPasarelaId: 'tp-w',
      },
    });
    provider.confirmarPago.mockRejectedValue(
      new ProviderComunicacionError('timeout', {}),
    );
    await expect(service.confirmarRetorno('tok-1')).rejects.toThrow(
      'verifique el estado',
    );
    expect(ordenRepo.update).toHaveBeenCalledWith(
      { ordenId: 'orden-1', estado: 'procesando' },
      { estado: 'en_proceso' },
    );
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'AUTHORIZATION', estado: 'error' }),
    );
    expect(deps.dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('abortarRetorno: anulación por ordenCompra marca fallida y redirige a fracaso', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      estado: 'en_proceso',
      metadata: {
        urls: { exito: 'https://app/ok', fracaso: 'https://app/fail' },
      },
    });
    const res = await service.abortarRetorno({ ordenCompra: 'W-1' });
    expect(ordenRepo.findOne).toHaveBeenCalledWith({
      where: { codigoOrden: 'W-1' },
    });
    const guardada = ordenRepo.save.mock.calls[0][0] as { estado: string };
    expect(guardada.estado).toBe('fallida');
    expect(res.urlRedireccion).toContain('https://app/fail');
    expect(res.urlRedireccion).toContain('estado=fallida');
  });

  it('abortarRetorno: idempotente — no pisa una orden ya pagada/conciliada', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      estado: 'conciliada',
      metadata: {
        urls: { exito: 'https://app/ok', fracaso: 'https://app/fail' },
      },
    });
    const res = await service.abortarRetorno({ tbkToken: 'tbk-1' });
    expect(ordenRepo.save).not.toHaveBeenCalled();
    // conciliada se normaliza a éxito de cara al usuario
    expect(res.urlRedireccion).toContain('https://app/ok');
  });

  it('abortarRetorno: sin identificador es rechazado', async () => {
    await expect(service.abortarRetorno({})).rejects.toThrow('identificador');
  });

  it('obtenerResultado: devuelve estado, referenciaExterna y detalle del pago scoped al tenant', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      estado: 'conciliada',
      referenciaExterna: 'venta-9',
      metadata: {
        resultadoPago: {
          tipoPago: 'VD',
          numeroCuotas: 0,
          tarjetaUltimos4: '6623',
          codigoRespuesta: '0',
        },
      },
    });
    const res = await service.obtenerResultado('t-1', 'orden-1');
    expect(res).toEqual({
      ordenId: 'orden-1',
      estado: 'conciliada',
      referenciaExterna: 'venta-9',
      tipoPago: 'VD',
      numeroCuotas: 0,
      tarjetaUltimos4: '6623',
      motivoRechazo: null,
    });
    expect(ordenRepo.findOne).toHaveBeenCalledWith({
      where: { ordenId: 'orden-1', tenantId: 't-1' },
    });
  });

  it('obtenerResultado: en fallida traduce el codigoRespuesta a motivo nivel 2', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-2',
      estado: 'fallida',
      referenciaExterna: null,
      metadata: { resultadoPago: { codigoRespuesta: '-7' } },
    });
    const res = await service.obtenerResultado('t-1', 'orden-2');
    expect(res.motivoRechazo).toBe('Tarjeta bloqueada');
  });
});
