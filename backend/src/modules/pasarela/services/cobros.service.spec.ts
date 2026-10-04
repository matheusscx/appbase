import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Db } from '../../../common/db/db.service';
import { CobrosService, veredictoPorSaldo } from './cobros.service';
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
import { BadRequestException, ConflictException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { IdempotenciaService } from '../../idempotencia/idempotencia.service';
import type { PasosConEfectoExterno } from '../../idempotencia/idempotencia.service';

const inscripcionActiva = {
  inscripcionId: 'insc-1',
  tenantPasarelaId: 'tp-1',
  pagadorRef: 'rut-123',
  identificadorUsuarioExterno: 'insc-abc',
  identificadorExterno: 'v1:blob-tbk',
};

type Fila = Record<string, unknown>;
const CLAVE = '2f1c8a3e-6a1b-4d8e-9a55-0c7b1f7d2e10';

describe('CobrosService', () => {
  let service: CobrosService;
  let historialBase: Fila[] = [];
  let filas: Fila[] = [];
  const conHistorial = (h: Fila[]) => {
    historialBase = h;
  };
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
    // Con estado, porque el REFUND nace en `iniciada` (write-ahead) y se
    // cierra después (ADR-029): el historial que lee el service es el
    // sembrado (`conHistorial`) más lo que el propio test fue registrando.
    transacciones: {
      registrar: jest.fn((datos: Fila) => {
        const fila: Fila = {
          transaccionId: `tx-${filas.length + 1}`,
          metadata: {},
          ...datos,
        };
        filas.push(fila);
        return Promise.resolve(fila);
      }),
      vincularCorreccion: jest.fn().mockResolvedValue(true),
      listarPorOrden: jest.fn(() =>
        Promise.resolve([...historialBase, ...filas]),
      ),
      resolverReembolso: jest.fn(
        (_t: string, id: string, r: Record<string, unknown>) => {
          const fila = [...historialBase, ...filas].find(
            (f) => f.transaccionId === id,
          );
          if (!fila || !['iniciada', 'error'].includes(fila.estado as string))
            return Promise.resolve(false);
          Object.assign(fila, {
            estado: r.estado,
            resolucion: r.resolucion,
            ...(r.codigoAutorizacion !== undefined && {
              codigoAutorizacion: r.codigoAutorizacion,
            }),
            metadata: {
              ...(fila.metadata as object),
              ...(r.metadata as object),
            },
          });
          return Promise.resolve(true);
        },
      ),
      registrarIntentoSinConfirmar: jest.fn().mockResolvedValue(undefined),
      reembolsoDeSolicitud: jest.fn((_t: string, sol: string) =>
        Promise.resolve(
          [...historialBase, ...filas].find(
            (f) => f.solicitudIdempotenteId === sol,
          ) ?? null,
        ),
      ),
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
  // Pasa-manos de la primera vez (tx0 → tx1). Lo que importa del reclamo
  // —commit antes del efecto, lock, reproducción— solo se prueba contra
  // Postgres: `test/pasarela-reembolso.e2e-spec.ts`.
  const efectuarDeUna = async (
    _s: unknown,
    pasos: PasosConEfectoExterno<unknown, Record<string, unknown>>,
  ) => {
    const preparado = await pasos.preparar('sol-1');
    const r = await pasos.efectuar('sol-1', preparado);
    if ('soltar' in r) throw r.soltar;
    return { origen: 'efectuada', respuesta: r.respuesta };
  };
  const idempotencia = {
    ejecutarConEfectoExterno: jest.fn(efectuarDeUna),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    historialBase = [];
    filas = [];
    idempotencia.ejecutarConEfectoExterno.mockImplementation(efectuarDeUna);
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
        { provide: IdempotenciaService, useValue: idempotencia },
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
    conHistorial([
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
    const res = await service.reembolsar(
      't-1',
      'orden-1',
      { monto: '5000' },
      { apiKeyId: 'key-1' },
      CLAVE,
    );
    expect(res.estado).toBe('reembolsada');
    // Write-ahead (ADR-029): el REFUND nace en `iniciada`, ligado al reclamo
    // de la clave, y la respuesta del proveedor lo cierra.
    expect(deps.transacciones.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'REFUND',
        estado: 'iniciada',
        transaccionPadreId: 'tx-auth',
        solicitudIdempotenteId: 'sol-1',
      }),
    );
    expect(filas).toEqual([
      expect.objectContaining({
        tipo: 'REFUND',
        estado: 'aprobada',
        resolucion: 'proveedor',
      }),
    ]);
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
    conHistorial([
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
    const res = await service.reembolsar(
      't-1',
      'orden-1',
      { monto: '5000' },
      { apiKeyId: 'key-1' },
      CLAVE,
    );
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
      conHistorial(authAprobada);
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
        { usuarioId: 'user-1' },
        CLAVE,
      );
      expect(reembolsoHandler.onReembolsoAprobado).toHaveBeenCalledWith({
        tenantId: 't-1',
        ordenId: 'orden-1',
        codigoOrden: 'O-1',
        ventaId: 'venta-1',
        monto: '1100',
        devoluciones: [{ itemId: 'item-1', cantidad: '2' }],
        usuarioId: 'user-1',
        ligarCorreccion: expect.any(Function),
      });
      expect(res.notaCreditoId).toBe('nc-1');
      expect(res.warning).toBeUndefined();
    });

    describe('el vínculo REFUND → corrección va dentro de la transacción de la corrección', () => {
      type Ligar = (m: unknown, id: string) => Promise<void>;
      const ligarDelEvento = (): Ligar =>
        (
          reembolsoHandler.onReembolsoAprobado.mock.calls[0][0] as {
            ligarCorreccion: Ligar;
          }
        ).ligarCorreccion;

      it('el evento trae cómo ligar: con el manager que le pasen liga el REFUND recién registrado (tx-1), bajo el tenant del token', async () => {
        await service.reembolsar(
          't-1',
          'orden-1',
          { monto: '1100' },
          { usuarioId: 'user-1' },
          CLAVE,
        );
        const managerDeLaNota = { soy: 'la transacción de la nota' };

        await ligarDelEvento()(managerDeLaNota, 'nc-1');

        expect(deps.transacciones.vincularCorreccion).toHaveBeenCalledWith(
          't-1',
          'tx-1',
          'nc-1',
          managerDeLaNota,
        );
      });

      it('si no ligó ninguna fila (affected != 1) lanza, para que la corrección se revierta', async () => {
        await service.reembolsar(
          't-1',
          'orden-1',
          { monto: '1100' },
          { usuarioId: 'user-1' },
          CLAVE,
        );
        deps.transacciones.vincularCorreccion.mockResolvedValueOnce(false);

        await expect(ligarDelEvento()({}, 'nc-1')).rejects.toThrow('tx-1');
      });

      it('CobrosService no liga por fuera después del handler: el único camino es el de adentro de la transacción', async () => {
        // El handler de este test resuelve sin correr `ligarCorreccion`.
        const res = await service.reembolsar(
          't-1',
          'orden-1',
          { monto: '1100' },
          { usuarioId: 'user-1' },
          CLAVE,
        );

        expect(res.notaCreditoId).toBe('nc-1');
        expect(deps.transacciones.vincularCorreccion).not.toHaveBeenCalled();
      });

      it('si el vínculo falla, el handler lanza (la corrección se revirtió): warning FIJO, sin notaCreditoId, y el detalle con orden y REFUND en el log', async () => {
        const log = jest.spyOn(service['logger'], 'error').mockImplementation();
        deps.transacciones.vincularCorreccion.mockRejectedValueOnce(
          new Error('conexión caída a pg-interno'),
        );
        reembolsoHandler.onReembolsoAprobado.mockImplementationOnce(
          async (evento: { ligarCorreccion: Ligar }) => {
            await evento.ligarCorreccion({}, 'nc-1');
            return { correccionVentaId: 'nc-1' };
          },
        );

        const res = await service.reembolsar(
          't-1',
          'orden-1',
          { monto: '1100' },
          { usuarioId: 'user-1' },
          CLAVE,
        );

        expect(res.notaCreditoId).toBeUndefined();
        expect(res.warning).toContain('reembolso fue procesado');
        expect(res.warning).not.toContain('pg-interno');
        expect(log).toHaveBeenCalledWith(
          expect.stringMatching(/orden-1.*tx-1.*pg-interno/),
        );
      });
    });

    describe('el tope por pago del lado de ventas, ANTES de llamar al proveedor', () => {
      it('con venta vinculada lo consulta con la transacción, el tenant del token, la venta de la orden y el monto, y recién después llama al proveedor', async () => {
        await service.reembolsar(
          't-1',
          'orden-1',
          { monto: '1100' },
          { usuarioId: 'user-1' },
          CLAVE,
        );

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
          service.reembolsar(
            't-1',
            'orden-1',
            { monto: '1100' },
            { usuarioId: 'user-1' },
            CLAVE,
          ),
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

        await service.reembolsar(
          't-1',
          'orden-1',
          { monto: '1100' },
          { usuarioId: 'user-1' },
          CLAVE,
        );

        expect(reembolsoHandler.exigirTopeDelReembolso).not.toHaveBeenCalled();
        expect(provider.reembolsar).toHaveBeenCalled();
      });
    });

    it('el reembolso sin devoluciones también deja su corrección (ya no hay casilla que la pida)', async () => {
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        { usuarioId: 'user-1' },
        CLAVE,
      );
      expect(reembolsoHandler.onReembolsoAprobado).toHaveBeenCalledWith(
        expect.objectContaining({ ventaId: 'venta-1', devoluciones: [] }),
      );
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
        { usuarioId: 'user-1' },
        CLAVE,
      );
      expect(res.warning).toContain('reembolso fue procesado');
      expect(filas).toEqual([
        expect.objectContaining({ tipo: 'REFUND', estado: 'aprobada' }),
      ]);
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
        { usuarioId: 'user-1' },
        CLAVE,
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
        { usuarioId: 'user-1' },
        CLAVE,
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
        { usuarioId: 'user-1' },
        CLAVE,
      );
      expect(res.warning).toContain('Venta no elegible para esta nota');
    });

    it('por la llave de API no hay usuario: el evento lleva null, no una cadena vacía', async () => {
      await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        { apiKeyId: 'key-1' },
        CLAVE,
      );
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
      await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        { usuarioId: 'user-1' },
        CLAVE,
      );
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
        { usuarioId: 'user-1' },
        CLAVE,
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
        { usuarioId: 'user-1' },
        CLAVE,
      );
      expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
      expect(res.warning).toContain('venta vinculada');
    });

    it('sin handler registrado el reembolso sigue y el warning lo dice', async () => {
      // Tres lecturas del registro: el tope por pago en tx0 y en tx1, y el hook
      // de después.
      reembolsoRegistry.get
        .mockReturnValueOnce(null as never)
        .mockReturnValueOnce(null as never)
        .mockReturnValueOnce(null as never);
      const res = await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1100' },
        { usuarioId: 'user-1' },
        CLAVE,
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
    conHistorial([
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
      service.reembolsar(
        't-1',
        'orden-1',
        { monto: '5000' },
        { apiKeyId: 'key-1' },
        CLAVE,
      ),
    ).rejects.toThrow('excede');
    // corrió dentro de una transacción y con lock pesimista de la orden
    expect(dataSource.transaction).toHaveBeenCalled();
    expect(ordenRepo.findOne).toHaveBeenCalledWith(
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
    conHistorial([
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
      service.reembolsar(
        't-1',
        'orden-1',
        { monto: '2000' },
        { apiKeyId: 'key-1' },
        CLAVE,
      ),
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
      service.reembolsar(
        't-1',
        'orden-1',
        { monto: '1000.50' },
        { apiKeyId: 'key-1' },
        CLAVE,
      ),
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
      service.reembolsar(
        't-1',
        'orden-1',
        { monto: '-1000' },
        { apiKeyId: 'key-1' },
        CLAVE,
      ),
    ).rejects.toThrow('mayor a cero');
    expect(ordenRepo.findOne).not.toHaveBeenCalled();
  });

  it('timeout en reembolso: 502 "sin confirmar", el REFUND queda en iniciada con el intento anotado, la orden no cambia', async () => {
    ordenRepo.findOne.mockResolvedValue({
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'pagada',
      monto: '5000',
      moneda: 'CLP',
      codigoOrden: 'O-1',
    });
    conHistorial([
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
      new ProviderComunicacionError('timeout', { url: 'tbk' }, { x: 1 }),
    );
    await expect(
      service.reembolsar(
        't-1',
        'orden-1',
        { monto: '5000' },
        { apiKeyId: 'key-1' },
        CLAVE,
      ),
    ).rejects.toThrow('no sabemos si la plata salió');
    // "Sin confirmar" no es rechazo: el REFUND write-ahead sigue en `iniciada`
    // (el reintento lo aclara por saldo) y el intento se anota sobre él, fuera
    // de la tx que hizo rollback.
    expect(filas).toEqual([
      expect.objectContaining({ tipo: 'REFUND', estado: 'iniciada' }),
    ]);
    expect(
      deps.transacciones.registrarIntentoSinConfirmar,
    ).toHaveBeenCalledWith('t-1', 'tx-1', {
      request: { url: 'tbk' },
      response: { x: 1 },
    });
    const estadosGuardados = ordenRepo.save.mock.calls.map((c) => c[0].estado);
    expect(estadosGuardados).not.toContain('reembolsada');
  });

  describe('reembolso idempotente con efecto externo (ADR-029)', () => {
    const orden = {
      ordenId: 'orden-1',
      tenantId: 't-1',
      estado: 'conciliada',
      monto: '100000',
      moneda: 'CLP',
      codigoOrden: 'O-1',
      ventaId: 'venta-1',
    };
    const auth = {
      transaccionId: 'tx-auth',
      tipo: 'AUTHORIZATION',
      estado: 'aprobada',
      tenantPasarelaId: 'tp-1',
      inscripcionId: 'insc-1',
      monto: '100000',
    };
    const aprobado = {
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: 'AUT-1',
      tipoPago: 'NULLIFIED',
      request: {},
      response: {},
    };
    /** Un REFUND de $17.000 que quedó sin confirmar, de un intento anterior. */
    const sinConfirmar = (estado = 'iniciada'): Fila => ({
      transaccionId: 'tx-pend',
      ordenId: 'orden-1',
      tipo: 'REFUND',
      estado,
      monto: '17000.000000',
      tenantPasarelaId: 'tp-1',
      solicitudIdempotenteId: 'sol-viejo',
      metadata: { devoluciones: [{ itemId: 'item-1', cantidad: '1' }] },
    });
    const saldo = (s: string | null, estadoProveedor = 'PARTIALLY_NULLIFIED') =>
      provider.consultarEstado.mockResolvedValue({
        estado: 'pagada',
        estadoProveedor,
        saldo: s,
        response: { balance: s },
      });
    const reembolsar = (monto = '10000') =>
      service.reembolsar(
        't-1',
        'orden-1',
        { monto },
        { usuarioId: 'user-1' },
        CLAVE,
      );

    beforeEach(() => {
      ordenRepo.findOne.mockResolvedValue({ ...orden });
      provider.reembolsar.mockResolvedValue(aprobado);
      reembolsoHandler.onReembolsoAprobado.mockResolvedValue({
        correccionVentaId: 'nc-1',
      });
    });

    describe('veredictoPorSaldo', () => {
      const d = (v: string) => new Decimal(v);
      const consulta = (saldo: string | null, estadoProveedor: string) => ({
        estado: 'pagada' as const,
        estadoProveedor,
        saldo,
        response: {},
      });
      // Orden de 100.000, sin aprobados: esperado 100.000; el de 17.000 dejaría 83.000.
      it.each([
        ['83000', 'PARTIALLY_NULLIFIED', 'salio'],
        ['100000', 'AUTHORIZED', 'no_salio'],
        ['70000', 'PARTIALLY_NULLIFIED', 'no_se_puede'],
      ])('saldo %s (%s) → %s', (s, e, esperado) => {
        expect(
          veredictoPorSaldo(consulta(s, e), d('100000'), d('83000'), d('0')),
        ).toBe(esperado);
      });

      it('sin balance: anulada entera es "salió" solo si el REFUND la completaba', () => {
        expect(
          veredictoPorSaldo(
            consulta(null, 'NULLIFIED'),
            d('100000'),
            d('0'),
            d('0'),
          ),
        ).toBe('salio');
        expect(
          veredictoPorSaldo(
            consulta(null, 'NULLIFIED'),
            d('100000'),
            d('83000'),
            d('0'),
          ),
        ).toBe('no_se_puede');
      });

      it('sin balance: autorizada es "no salió" solo si no hubo ningún reembolso aprobado', () => {
        expect(
          veredictoPorSaldo(
            consulta(null, 'AUTHORIZED'),
            d('100000'),
            d('83000'),
            d('0'),
          ),
        ).toBe('no_salio');
        // Con un aprobado previo el proveedor tendría que informar balance: su
        // ausencia no prueba nada.
        expect(
          veredictoPorSaldo(
            consulta(null, 'AUTHORIZED'),
            d('90000'),
            d('73000'),
            d('10000'),
          ),
        ).toBe('no_se_puede');
      });
    });

    it('tx1 relee SU REFUND: si otro camino lo cerró entre tx0 y tx1, NO llama al proveedor y responde lo que la fila dice', async () => {
      idempotencia.ejecutarConEfectoExterno.mockImplementationOnce(
        async (_s, pasos) => {
          const preparado = await pasos.preparar('sol-1');
          // El aclarado de otro request lo cerró "no salió" en la ventana.
          Object.assign(filas[0], {
            estado: 'rechazada',
            resolucion: 'saldo',
            metadata: { motivo: 'no salió' },
          });
          const r = await pasos.efectuar('sol-1', preparado);
          if ('soltar' in r) throw r.soltar;
          return { origen: 'efectuada', respuesta: r.respuesta };
        },
      );
      conHistorial([auth]);

      const res = await reembolsar();

      expect(provider.reembolsar).not.toHaveBeenCalled();
      expect(res.reembolsoAprobado).toBe(false);
      expect(res.motivo).toBe('no salió');
    });

    it('si la re-verificación de tx1 rebota, el REFUND se cierra "no se envió" (nunca se borra) y se suelta el reclamo con ese error', async () => {
      let soltado: unknown;
      idempotencia.ejecutarConEfectoExterno.mockImplementationOnce(
        async (_s, pasos) => {
          const preparado = await pasos.preparar('sol-1');
          // Entre tx0 y tx1 otro reembolso agotó el disponible.
          historialBase.push({
            transaccionId: 'tx-otro',
            tipo: 'REFUND',
            estado: 'aprobada',
            monto: '95000',
          });
          const r = await pasos.efectuar('sol-1', preparado);
          soltado = 'soltar' in r ? r.soltar : undefined;
          if ('soltar' in r) throw r.soltar;
          return { origen: 'efectuada', respuesta: r.respuesta };
        },
      );
      conHistorial([auth]);

      await expect(reembolsar()).rejects.toThrow('excede');

      expect(soltado).toBeInstanceOf(BadRequestException);
      expect(provider.reembolsar).not.toHaveBeenCalled();
      expect(filas).toEqual([
        expect.objectContaining({
          estado: 'rechazada',
          resolucion: 'no_enviado',
          metadata: expect.objectContaining({
            motivo: expect.stringContaining('No se envió'),
          }),
        }),
      ]);
    });

    describe('el reintento de un intento sin confirmar (misma clave, reclamo sin respuesta)', () => {
      const retomar = () =>
        idempotencia.ejecutarConEfectoExterno.mockImplementationOnce(
          async (_s, pasos) => {
            const r = await pasos.resolverSinConfirmar('sol-viejo');
            if ('soltar' in r) throw r.soltar;
            return { origen: 'resuelta', respuesta: r.respuesta };
          },
        );

      it('el saldo bajó en el monto: lo cierra aprobado "por saldo", deja su corrección con lo que pidió el intento, y se ve como "ya se había hecho"', async () => {
        retomar();
        // El aclarado previo de la orden también lo vería: acá se prueba el de
        // `resolverSinConfirmar`, así que la orden llega sin pendientes ahí.
        conHistorial([auth]);
        jest
          .spyOn(service as never, 'aclararSinConfirmarDeLaOrden')
          .mockResolvedValueOnce(undefined as never);
        historialBase.push(sinConfirmar());
        saldo('83000');

        const res = await reembolsar('17000');

        expect(provider.reembolsar).not.toHaveBeenCalled();
        expect(historialBase[1]).toMatchObject({
          estado: 'aprobada',
          resolucion: 'saldo',
        });
        expect(reembolsoHandler.onReembolsoAprobado).toHaveBeenCalledWith(
          expect.objectContaining({
            monto: '17000',
            devoluciones: [{ itemId: 'item-1', cantidad: '1' }],
          }),
        );
        expect(res).toMatchObject({
          reembolsoAprobado: true,
          repetida: true,
          notaCreditoId: 'nc-1',
        });
      });

      it('el saldo no cambió: lo cierra rechazado con el motivo, sin corrección y sin volver a llamar', async () => {
        retomar();
        conHistorial([auth, sinConfirmar()]);
        jest
          .spyOn(service as never, 'aclararSinConfirmarDeLaOrden')
          .mockResolvedValueOnce(undefined as never);
        saldo('100000', 'AUTHORIZED');

        const res = await reembolsar('17000');

        expect(provider.reembolsar).not.toHaveBeenCalled();
        expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
        expect(res.reembolsoAprobado).toBe(false);
        expect(res.repetida).toBeUndefined();
        expect(res.motivo).toContain('Podés reembolsar de nuevo');
      });

      it('el saldo no cuadra: 409 al portal, y la fila sigue sin confirmar', async () => {
        retomar();
        conHistorial([auth, sinConfirmar()]);
        jest
          .spyOn(service as never, 'aclararSinConfirmarDeLaOrden')
          .mockResolvedValueOnce(undefined as never);
        saldo('60000');

        await expect(reembolsar('17000')).rejects.toThrow(ConflictException);
        expect(historialBase[1].estado).toBe('iniciada');
      });
    });

    describe('otro reembolso con un pendiente en la orden (decisión 4)', () => {
      it('primero aclara el pendiente; si salió, deja su corrección y recién después sale el nuevo', async () => {
        conHistorial([auth, sinConfirmar('error')]);
        saldo('83000');

        const res = await reembolsar('10000');

        expect(historialBase[1]).toMatchObject({
          estado: 'aprobada',
          resolucion: 'saldo',
        });
        expect(
          provider.consultarEstado.mock.invocationCallOrder[0],
        ).toBeLessThan(provider.reembolsar.mock.invocationCallOrder[0]);
        // Dos correcciones: la del aclarado (17.000) y la del nuevo (10.000).
        expect(
          reembolsoHandler.onReembolsoAprobado.mock.calls.map(
            (c) => (c[0] as { monto: string }).monto,
          ),
        ).toEqual(['17000', '10000']);
        expect(res.reembolsoAprobado).toBe(true);
      });

      it('si no se puede aclarar, 409 en preparar: el nuevo no llega al proveedor ni escribe un REFUND (el rollback suelta la clave)', async () => {
        conHistorial([auth, sinConfirmar()]);
        provider.consultarEstado.mockRejectedValue(
          new ProviderComunicacionError('caído', {}),
        );

        await expect(reembolsar('10000')).rejects.toThrow(
          'Hay un reembolso de $17000 sin confirmar',
        );
        expect(provider.reembolsar).not.toHaveBeenCalled();
        expect(deps.transacciones.registrar).not.toHaveBeenCalled();
      });

      it('con dos pendientes (filas de antes) no consulta: el saldo no diría cuál salió', async () => {
        conHistorial([
          auth,
          sinConfirmar('error'),
          { ...sinConfirmar('error'), transaccionId: 'tx-pend-2' },
        ]);

        await expect(reembolsar('10000')).rejects.toThrow(ConflictException);
        expect(provider.consultarEstado).not.toHaveBeenCalled();
      });
    });

    it('la corrección del pendiente aclarado es de quien lo PIDIÓ, no de quien lo aclaró', async () => {
      conHistorial([
        auth,
        { ...sinConfirmar('iniciada'), usuarioId: 'user-a' },
      ]);
      saldo('83000');

      await reembolsar('10000');

      const porMonto = Object.fromEntries(
        reembolsoHandler.onReembolsoAprobado.mock.calls.map((c) => {
          const e = c[0] as { monto: string; usuarioId: string | null };
          return [e.monto, e.usuarioId];
        }),
      );
      expect(porMonto).toEqual({ '17000': 'user-a', '10000': 'user-1' });
    });

    it('el REFUND nuevo guarda quién lo pidió (usuario o llave de API)', async () => {
      conHistorial([auth]);
      await reembolsar('10000');
      await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '5000' },
        { apiKeyId: 'key-1' },
        CLAVE,
      );
      expect(deps.transacciones.registrar.mock.calls.map((c) => c[0])).toEqual([
        expect.objectContaining({ usuarioId: 'user-1', apiKeyId: null }),
        expect.objectContaining({ usuarioId: null, apiKeyId: 'key-1' }),
      ]);
    });

    it('si otro cerró el pendiente en el medio (compare-and-set perdido), el aclarado no deja corrección', async () => {
      conHistorial([auth, sinConfirmar()]);
      saldo('83000');
      // Otro escritor la cerró justo antes: el UPDATE no encuentra la fila.
      deps.transacciones.resolverReembolso.mockImplementationOnce(() => {
        Object.assign(historialBase[1], { estado: 'aprobada' });
        return Promise.resolve(false);
      });

      await reembolsar('10000');

      expect(
        reembolsoHandler.onReembolsoAprobado.mock.calls.map(
          (c) => (c[0] as { monto: string }).monto,
        ),
      ).toEqual(['10000']);
    });

    describe('el admin lo marca a mano tras revisar el portal', () => {
      const marcar = (salio: boolean, codigoAutorizacion?: string) =>
        service.resolverReembolsoAMano(
          't-1',
          'orden-1',
          'tx-pend',
          { salio, codigoAutorizacion },
          'admin-2',
        );

      it('"Salió": aprobado a mano con el código del portal, y su corrección es de quien lo pidió', async () => {
        conHistorial([auth, { ...sinConfirmar(), usuarioId: 'user-a' }]);

        const res = await marcar(true, '1213');

        expect(deps.transacciones.resolverReembolso).toHaveBeenCalledWith(
          't-1',
          'tx-pend',
          expect.objectContaining({
            estado: 'aprobada',
            resolucion: 'manual',
            resueltaPor: 'admin-2',
            codigoAutorizacion: '1213',
          }),
        );
        expect(reembolsoHandler.onReembolsoAprobado).toHaveBeenCalledWith(
          expect.objectContaining({ monto: '17000', usuarioId: 'user-a' }),
        );
        expect(res).toMatchObject({
          reembolsoAprobado: true,
          notaCreditoId: 'nc-1',
        });
        expect(provider.reembolsar).not.toHaveBeenCalled();
        expect(provider.consultarEstado).not.toHaveBeenCalled();
      });

      it('"No salió": rechazado a mano, sin corrección, y la orden queda sin pendientes', async () => {
        conHistorial([auth, sinConfirmar()]);

        const res = await marcar(false);

        expect(historialBase[1]).toMatchObject({
          estado: 'rechazada',
          resolucion: 'manual',
        });
        expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
        expect(res.reembolsoAprobado).toBe(false);
      });

      it('uno ya resuelto da 409 y no toca nada; si lo cierra otro en el medio, también', async () => {
        conHistorial([auth, sinConfirmar('aprobada')]);
        await expect(marcar(false)).rejects.toThrow('ya estaba resuelto');

        conHistorial([auth, sinConfirmar()]);
        deps.transacciones.resolverReembolso.mockResolvedValueOnce(false);
        await expect(marcar(true, '1213')).rejects.toThrow(ConflictException);
        expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
      });

      it('"Salió" no puede pasar el monto de la orden', async () => {
        conHistorial([
          auth,
          {
            transaccionId: 'tx-ok',
            tipo: 'REFUND',
            estado: 'aprobada',
            monto: '90000',
          },
          sinConfirmar(),
        ]);
        await expect(marcar(true, '1213')).rejects.toThrow(BadRequestException);
        expect(deps.transacciones.resolverReembolso).not.toHaveBeenCalled();
      });
    });

    it('la reproducción agrega la corrección que el REFUND tiene HOY, sin volver a crearla', async () => {
      idempotencia.ejecutarConEfectoExterno.mockResolvedValueOnce({
        origen: 'reproducida',
        respuesta: {
          ordenId: 'orden-1',
          ventaId: 'venta-1',
          reembolsoAprobado: true,
          reembolso: { transaccionId: 'tx-r' },
          repetida: true,
        },
      });
      conHistorial([
        auth,
        {
          transaccionId: 'tx-r',
          tipo: 'REFUND',
          estado: 'aprobada',
          monto: '17000',
          correccionVentaId: 'nc-9',
        },
      ]);

      const res = await reembolsar('17000');

      expect(res).toMatchObject({ repetida: true, notaCreditoId: 'nc-9' });
      expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
    });

    it('la reproducción de un REFUND aprobado sin corrección lo dice, y tampoco la crea', async () => {
      idempotencia.ejecutarConEfectoExterno.mockResolvedValueOnce({
        origen: 'reproducida',
        respuesta: {
          ordenId: 'orden-1',
          ventaId: 'venta-1',
          reembolsoAprobado: true,
          reembolso: { transaccionId: 'tx-r' },
          repetida: true,
        },
      });
      conHistorial([
        auth,
        {
          transaccionId: 'tx-r',
          tipo: 'REFUND',
          estado: 'aprobada',
          monto: '17000',
          correccionVentaId: null,
        },
      ]);

      const res = await reembolsar('17000');

      expect(res.correccionPendiente).toBe(true);
      expect(reembolsoHandler.onReembolsoAprobado).not.toHaveBeenCalled();
    });

    it('la huella es la misma con otro formato de cantidad y las devoluciones en otro orden', async () => {
      conHistorial([auth]);
      const huellas: string[] = [];
      idempotencia.ejecutarConEfectoExterno.mockImplementation(
        (sol: { huella: string }) => {
          huellas.push(sol.huella);
          return Promise.resolve({ origen: 'reproducida', respuesta: {} });
        },
      );
      const a = { itemId: 'a', cantidad: '1' };
      const b = { itemId: 'b', cantidad: '2' };
      await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '17000', devoluciones: [a, b] },
        { usuarioId: 'user-1' },
        CLAVE,
      );
      await service.reembolsar(
        't-1',
        'orden-1',
        { monto: '17000', devoluciones: [{ ...b, cantidad: '2.00' }, a] },
        { usuarioId: 'user-1' },
        CLAVE,
      );
      expect(huellas[0]).toBe(huellas[1]);
    });
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
    conHistorial([
      { transaccionId: 'tx-1', tipo: 'AUTHORIZATION', estado: 'error' },
    ]);
    const res = await service.obtenerOrden('t-1', 'orden-1');
    // se mantiene en_proceso: solo /verificar puede cerrarla (pudo pagarse)
    expect(res.estado).toBe('en_proceso');
    expect(ordenRepo.save).not.toHaveBeenCalled();
  });
});
