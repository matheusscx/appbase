import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Db } from '../../../common/db/db.service';
import { CobrosService } from './cobros.service';
import { InscripcionesService } from './inscripciones.service';
import { TenantPasarelaService } from './tenant-pasarela.service';
import { TransaccionesService } from './transacciones.service';
import { CredencialesService } from './credenciales.service';
import { ProviderFactory } from '../providers/provider.factory';
import {
  MONEDA_ORDEN_V1,
  PasarelaOrden,
} from '../entities/pasarela-orden.entity';
import { ProviderComunicacionError } from '../providers/payment-provider.interface';
import { ReembolsoCallbackRegistry } from './reembolso-callback.registry';
import { MonedasService } from '../../monedas/monedas.service';
import { BadRequestException } from '@nestjs/common';

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
  // reembolsar() corre dentro de db.transaccion (antes dataSource.transaction);
  // el manager delega en los mismos mocks de ordenRepo para que los tests de
  // reembolso no cambien.
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
  const dbMock = {
    transaccion: dataSource.transaction,
    query: jest.fn(),
    sinTransaccion: (fn: () => unknown) => fn(),
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
      vincularCorreccion: jest.fn().mockResolvedValue(true),
      listarPorOrden: jest.fn().mockResolvedValue([]),
      redactar: jest.fn((o: Record<string, unknown>) => o),
    },
    credenciales: { descifrarTexto: jest.fn().mockReturnValue('tbk-u-1') },
  };
  // Se comporta como la moneda de la orden (CLP, escala 0). Lo que estos tests
  // verifican no es la regla —vive en MonedasService y tiene sus propios
  // tests— sino DÓNDE se aplica: qué ya pasó cuando el monto se rechaza.
  const monedas = {
    validarEscalaDeMoneda: jest.fn((monto: string) => {
      if (monto.includes('.'))
        return Promise.reject(
          new BadRequestException(
            'El monto tiene más decimales de los que admite CLP (0).',
          ),
        );
      return Promise.resolve();
    }),
  };
  const reembolsoHandler = {
    exigirTopeDelReembolso: jest.fn(),
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
        { provide: Db, useValue: dbMock },
        { provide: InscripcionesService, useValue: deps.inscripciones },
        { provide: TenantPasarelaService, useValue: deps.tenantPasarela },
        { provide: TransaccionesService, useValue: deps.transacciones },
        { provide: CredencialesService, useValue: deps.credenciales },
        { provide: ReembolsoCallbackRegistry, useValue: reembolsoRegistry },
        { provide: MonedasService, useValue: monedas },
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

  describe('reembolso — hook post-commit de la corrección', () => {
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
        correccionVentaId: 'nc-1',
      });
    });
    it('todo reembolso aprobado de una orden con venta invoca el handler con el evento completo, liga la corrección al REFUND y responde notaCreditoId', async () => {
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        {
          monto: '1100',
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
        devoluciones: [{ itemId: 'item-1', cantidad: '2' }],
        usuarioId: 'user-1',
      });
      // El REFUND que se acaba de registrar ('tx-1') queda ligado a la
      // corrección que el handler creó, bajo el tenant del token.
      expect(deps.transacciones.vincularCorreccion).toHaveBeenCalledWith(
        't-1',
        'tx-1',
        'nc-1',
      );
      expect(res.notaCreditoId).toBe('nc-1');
      expect(res.warning).toBeUndefined();
    });

    describe('el tope por pago del lado de ventas, ANTES de llamar al proveedor', () => {
      it('con venta vinculada lo consulta con la transacción, el tenant del token, la venta de la orden y el monto, y recién después llama al proveedor', async () => {
        await service.reembolsar('t-1', 'orden-1', { monto: '1100' }, 'user-1');

        expect(reembolsoHandler.exigirTopeDelReembolso).toHaveBeenCalledWith(
          manager,
          { tenantId: 't-1', ventaId: 'venta-1', monto: '1100' },
        );
        expect(
          reembolsoHandler.exigirTopeDelReembolso.mock.invocationCallOrder[0],
        ).toBeLessThan(provider.reembolsar.mock.invocationCallOrder[0]);
      });

      it('si el tope no alcanza, el 400 corta ANTES de la pasarela: el proveedor no se llama y no se registra ningún REFUND', async () => {
        reembolsoHandler.exigirTopeDelReembolso.mockRejectedValueOnce(
          new BadRequestException('El monto supera lo que queda por devolver'),
        );

        await expect(
          service.reembolsar('t-1', 'orden-1', { monto: '1100' }, 'user-1'),
        ).rejects.toThrow(BadRequestException);

        expect(provider.reembolsar).not.toHaveBeenCalled();
        expect(deps.transacciones.registrar).not.toHaveBeenCalled();
        expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
      });

      it('una orden sin venta no tiene tope por pago: ni lo consulta (como hoy)', async () => {
        ordenRepo.findOne.mockResolvedValue({
          ...ordenConVenta,
          ventaId: null,
        });

        await service.reembolsar('t-1', 'orden-1', { monto: '1100' }, 'user-1');

        expect(reembolsoHandler.exigirTopeDelReembolso).not.toHaveBeenCalled();
        expect(provider.reembolsar).toHaveBeenCalled();
      });
    });

    it('el reembolso sin devoluciones también deja su corrección (ya no hay casilla que la pida)', async () => {
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        'user-1',
      );
      expect(reembolsoHandler.onReembolsoAprobado).toHaveBeenCalledWith(
        expect.objectContaining({ ventaId: 'venta-1', devoluciones: [] }),
      );
      expect(deps.transacciones.vincularCorreccion).toHaveBeenCalledTimes(1);
      expect(res.notaCreditoId).toBe('nc-1');
    });

    it('si el handler falla, el reembolso NO se revierte: responde con warning, el REFUND queda registrado y sin corrección ligada', async () => {
      reembolsoHandler.onReembolsoAprobado.mockRejectedValueOnce(
        new Error('NC falló'),
      );
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        'user-1',
      );
      expect(res.warning).toContain('reembolso fue procesado');
      expect(deps.transacciones.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: 'REFUND', estado: 'aprobada' }),
        manager,
      );
      expect(deps.transacciones.vincularCorreccion).not.toHaveBeenCalled();
    });

    it('si la venta de la orden es una corrección, el warning lleva el motivo y no hay nota de crédito en la respuesta', async () => {
      reembolsoHandler.onReembolsoAprobado.mockRejectedValueOnce(
        new BadRequestException(
          'No se puede emitir una nota de crédito sobre otra nota de crédito',
        ),
      );
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        'user-1',
      );
      expect(res.warning).toContain(
        'No se puede emitir una nota de crédito sobre otra nota de crédito',
      );
      expect(res.notaCreditoId).toBeUndefined();
    });

    it('un error que NO es de negocio (texto de la base, de código) no llega al cliente: warning fijo, y el detalle queda en el log', async () => {
      const log = jest.spyOn(service['logger'], 'error').mockImplementation();
      reembolsoHandler.onReembolsoAprobado.mockRejectedValueOnce(
        new Error('invalid input syntax for type uuid: "" (tabla movimientos)'),
      );
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        'user-1',
      );
      expect(res.warning).toContain('reembolso fue procesado');
      expect(res.warning).not.toContain('uuid');
      expect(res.warning).not.toContain('movimientos');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('uuid'));
    });

    it('un motivo de negocio (HttpException) SÍ se le muestra al cliente', async () => {
      reembolsoHandler.onReembolsoAprobado.mockRejectedValueOnce(
        new BadRequestException('Venta no elegible para esta nota'),
      );
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        'user-1',
      );
      expect(res.warning).toContain('Venta no elegible para esta nota');
    });

    it('si la corrección se creó pero el vínculo falla: sigue la respuesta con su id y un warning FIJO (sin el texto del error)', async () => {
      const log = jest.spyOn(service['logger'], 'error').mockImplementation();
      deps.transacciones.vincularCorreccion.mockRejectedValueOnce(
        new Error('conexión caída a pg-interno'),
      );
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        'user-1',
      );
      expect(res.notaCreditoId).toBe('nc-1');
      expect(res.warning).toContain('reembolso fue procesado');
      expect(res.warning).toContain('no se pudo ligar');
      expect(res.warning).not.toContain('pg-interno');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('pg-interno'));
    });

    it('si el vínculo no tocó ninguna fila (affected != 1): no es silencioso, warning con la nota y log', async () => {
      const log = jest.spyOn(service['logger'], 'error').mockImplementation();
      deps.transacciones.vincularCorreccion.mockResolvedValueOnce(false);
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        'user-1',
      );
      expect(res.notaCreditoId).toBe('nc-1');
      expect(res.warning).toContain('no se pudo ligar');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('tx-1'));
    });

    it('por la llave de API no hay usuario: el evento lleva null, no una cadena vacía', async () => {
      await service.reembolsar('t-1', 'orden-1', { monto: '1100' });
      expect(reembolsoHandler.onReembolsoAprobado).toHaveBeenCalledWith(
        expect.objectContaining({ usuarioId: null }),
      );
    });

    it('reembolso rechazado por el proveedor NO invoca el handler', async () => {
      provider.reembolsar.mockResolvedValueOnce({
        ...refundAprobado,
        aprobada: false,
        codigoRespuesta: '-1',
      });
      await service.reembolsar('t-1', 'orden-1', { monto: '1100' }, 'user-1');
      expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
      expect(deps.transacciones.vincularCorreccion).not.toHaveBeenCalled();
    });

    it('orden sin venta vinculada y sin devoluciones: no hay corrección que crear, y no es un aviso (es legítimo)', async () => {
      ordenRepo.findOne.mockResolvedValue({
        ...ordenConVenta,
        ventaId: null,
      });
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

    it('orden sin venta vinculada pero con devoluciones pedidas: NO invoca el handler y avisa que no se pudieron aplicar', async () => {
      ordenRepo.findOne.mockResolvedValue({
        ...ordenConVenta,
        ventaId: null,
      });
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100', devoluciones: [{ itemId: 'item-1', cantidad: '1' }] },
        'user-1',
      );
      expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
      expect(res.warning).toContain('venta vinculada');
    });

    it('sin handler registrado el reembolso sigue y el warning lo dice', async () => {
      // Dos lecturas del registro: la del tope por pago y la del hook de después.
      reembolsoRegistry.get
        .mockReturnValueOnce(null as never)
        .mockReturnValueOnce(null as never);
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        'user-1',
      );
      expect(res.warning).toContain('no hay un módulo de ventas');
      expect(deps.transacciones.vincularCorreccion).not.toHaveBeenCalled();
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

  it('cobro con monto fuera de la escala: NO queda orden creada', async () => {
    // El defecto que esto cierra: la orden se persiste ANTES de llamar al
    // proveedor, y el proveedor (`montoEntero`) era el único que miraba la
    // escala. Un monto con decimales dejaba una orden 'en_proceso' huérfana
    // —sin transacción y sin nada enviado a Transbank— por un error de formato.
    await expect(
      service.cobrar(
        't-1',
        { pagadorRef: 'rut-123', monto: '1000.50', descripcion: 'Cobro test' },
        'api',
        'key-1',
      ),
    ).rejects.toThrow('decimales');

    // La afirmación que caza el revert no es el throw —el proveedor también
    // tiraba— sino que no haya quedado NADA persistido ni enviado.
    expect(ordenRepo.save).not.toHaveBeenCalled();
    expect(provider.autorizarCobro).not.toHaveBeenCalled();
    expect(deps.transacciones.registrar).not.toHaveBeenCalled();

    // Y contra QUÉ moneda se validó, que es el punto entero del cambio: sin
    // esto, un mutante que pase la moneda oficial del tenant en vez de la de
    // la orden pasa en verde, y es justo la regresión que esto viene a cerrar.
    expect(monedas.validarEscalaDeMoneda).toHaveBeenCalledWith(
      '1000.50',
      MONEDA_ORDEN_V1,
    );
  });

  it('reembolso con monto fuera de la escala es rechazado antes de tocar la orden', async () => {
    await expect(
      service.reembolsar('t-1', 'orden-1', { monto: '1000.50' }),
    ).rejects.toThrow('decimales');
    expect(ordenRepo.findOne).not.toHaveBeenCalled();
    // El tercer call site también fija la moneda: sin esto, un mutante que
    // pusiera la oficial del tenant acá pasaba la suite entera en verde.
    expect(monedas.validarEscalaDeMoneda).toHaveBeenCalledWith(
      '1000.50',
      MONEDA_ORDEN_V1,
    );
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
