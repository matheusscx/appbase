import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { BaseVentasGrupo } from './enums/base-ventas-grupo.enum';
import { CriterioDistribucion } from './enums/criterio-distribucion.enum';
import { EstadoLiquidacion } from './enums/estado-liquidacion.enum';
import { ManualModo } from './enums/manual-modo.enum';
import { OrigenParticipante } from './enums/origen-participante.enum';
import { TipoEventoLiquidacion } from './enums/tipo-evento-liquidacion.enum';
import { LiquidacionPropinas } from './entities/liquidacion-propinas.entity';
import { LiquidacionPropinasEvento } from './entities/liquidacion-propinas-evento.entity';
import { LiquidacionPropinasFuente } from './entities/liquidacion-propinas-fuente.entity';
import { LiquidacionPropinasGrupo } from './entities/liquidacion-propinas-grupo.entity';
import { LiquidacionPropinasParticipante } from './entities/liquidacion-propinas-participante.entity';
import { PropinaDistribucionService } from './propina-distribucion.service';
import { LiquidacionPropinasService } from './liquidacion-propinas.service';

const TENANT = '550e8400-e29b-41d4-a716-446655440007';
const USER = '550e8400-e29b-41d4-a716-446655440056';
const MONEDA = '550e8400-e29b-41d4-a716-446655440003';

describe('LiquidacionPropinasService', () => {
  let service: LiquidacionPropinasService;
  let distribucion: { obtener: jest.Mock };
  let manager: {
    create: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
    query: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let liquidacionRepo: { find: jest.Mock; findOne: jest.Mock };
  let grupoRepo: { find: jest.Mock };
  let participanteRepo: { find: jest.Mock };
  let fuenteRepo: { find: jest.Mock };
  let eventoRepo: { find: jest.Mock };

  const config = {
    id: 'cfg-1',
    version: 3,
    actualizadoPor: null,
    actualizadoEl: new Date('2026-07-17T00:00:00.000Z'),
    grupos: [
      {
        id: 'cfg-garzon',
        tipoGarzon: TipoGarzon.GARZON,
        nombre: 'Garzones',
        porcentaje: '1.000000',
        criterio: CriterioDistribucion.PARTES_IGUALES,
        baseVentas: BaseVentasGrupo.TOTAL_FINAL,
        manualModo: null,
        activo: true,
        orden: 0,
        pesos: [],
      },
    ],
  };

  const monedaRows = [{ moneda_id: MONEDA, decimales: 0 }];
  const tips = [
    {
      venta_propina_id: 'tip-1',
      garzon_id: 'garzon-1',
      tipo_garzon: TipoGarzon.GARZON,
      turno_id: 'turno-1',
      monto_pagado: '100.0000',
      venta_id: 'venta-1',
      base_ventas_total_final: '1000.0000',
      base_ventas_sin_impuestos: '800.0000',
    },
    {
      venta_propina_id: 'tip-2',
      garzon_id: 'garzon-2',
      tipo_garzon: TipoGarzon.GARZON,
      turno_id: 'turno-1',
      monto_pagado: '50.0000',
      venta_id: 'venta-2',
      base_ventas_total_final: '500.0000',
      base_ventas_sin_impuestos: '400.0000',
    },
  ];

  beforeEach(async () => {
    distribucion = { obtener: jest.fn().mockResolvedValue(config) };
    manager = {
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
        ...data,
      })),
      find: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn((entity: { name?: string }, data: Record<string, unknown>) =>
        Promise.resolve({
          id: `${entity.name ?? 'Entity'}-${manager.save.mock.calls.length + 1}`,
          ...data,
        }),
      ),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      query: jest
        .fn()
        .mockResolvedValueOnce(monedaRows)
        .mockResolvedValueOnce(tips)
        .mockResolvedValueOnce([]),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: typeof manager) => unknown) =>
        cb(manager),
      ),
    };
    liquidacionRepo = { find: jest.fn(), findOne: jest.fn() };
    grupoRepo = { find: jest.fn() };
    participanteRepo = { find: jest.fn() };
    fuenteRepo = { find: jest.fn() };
    eventoRepo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidacionPropinasService,
        { provide: PropinaDistribucionService, useValue: distribucion },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: getRepositoryToken(LiquidacionPropinas), useValue: liquidacionRepo },
        { provide: getRepositoryToken(LiquidacionPropinasGrupo), useValue: grupoRepo },
        {
          provide: getRepositoryToken(LiquidacionPropinasParticipante),
          useValue: participanteRepo,
        },
        { provide: getRepositoryToken(LiquidacionPropinasFuente), useValue: fuenteRepo },
        { provide: getRepositoryToken(LiquidacionPropinasEvento), useValue: eventoRepo },
      ],
    }).compile();

    service = module.get(LiquidacionPropinasService);
  });

  it('crea un borrador con fuentes, snapshot de config y reparto por partes iguales', async () => {
    const result = await service.crear(TENANT, USER, {
      fechaDesde: '2026-07-17T00:00:00.000Z',
      fechaHasta: '2026-07-18T00:00:00.000Z',
      turnoIds: ['turno-1'],
    });

    expect(distribucion.obtener).toHaveBeenCalledWith(TENANT);
    expect(result.estado).toBe(EstadoLiquidacion.BORRADOR);
    expect(result.poolTotal).toBe('150.0000');
    expect(result.configuracionVersion).toBe(3);
    expect(result.grupos[0]).toMatchObject({
      tipoGarzon: TipoGarzon.GARZON,
      montoGrupo: '150.0000',
    });
    expect(result.participantes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          garzonId: 'garzon-1',
          origen: OrigenParticipante.SUGERIDO,
          monto: '75.0000',
        }),
        expect.objectContaining({
          garzonId: 'garzon-2',
          origen: OrigenParticipante.SUGERIDO,
          monto: '75.0000',
        }),
      ]),
    );
    expect(result.fuentes).toHaveLength(2);
    expect(result.advertencias).toEqual([]);
    expect(manager.save).toHaveBeenCalledWith(
      LiquidacionPropinasEvento,
      expect.objectContaining({ tipo: TipoEventoLiquidacion.CREADA }),
    );
  });

  it('usa el filtro de turnos al buscar tips elegibles', async () => {
    await service.crear(TENANT, USER, {
      fechaDesde: '2026-07-17T00:00:00.000Z',
      fechaHasta: '2026-07-18T00:00:00.000Z',
      turnoIds: ['turno-1', 'turno-2'],
    });

    expect(manager.query.mock.calls[1][1]).toEqual([
      TENANT,
      new Date('2026-07-17T00:00:00.000Z'),
      new Date('2026-07-18T00:00:00.000Z'),
      ['turno-1', 'turno-2'],
    ]);
  });

  it('lista liquidaciones activas del tenant', async () => {
    liquidacionRepo.find.mockResolvedValueOnce([
      {
        id: 'liq-1',
        tenantId: TENANT,
        estado: EstadoLiquidacion.BORRADOR,
        fechaDesde: new Date('2026-07-17T00:00:00.000Z'),
        fechaHasta: new Date('2026-07-18T00:00:00.000Z'),
        poolTotal: '150.0000',
        configuracionVersion: 3,
        creadoEl: new Date('2026-07-17T12:00:00.000Z'),
      },
    ]);

    await expect(service.listar(TENANT)).resolves.toEqual([
      expect.objectContaining({ id: 'liq-1', poolTotal: '150.0000' }),
    ]);
    expect(liquidacionRepo.find).toHaveBeenCalledWith({
      where: { tenantId: TENANT, eliminadoEl: IsNull() },
      order: { creadoEl: 'DESC' },
    });
  });

  function liquidacionBase(
    estado: EstadoLiquidacion = EstadoLiquidacion.BORRADOR,
  ): LiquidacionPropinas {
    return {
      id: 'liq-1',
      tenantId: TENANT,
      estado,
      fechaDesde: new Date('2026-07-17T00:00:00.000Z'),
      fechaHasta: new Date('2026-07-18T00:00:00.000Z'),
      turnoIds: [],
      poolTotal: '150.0000',
      configuracionVersion: 3,
      monedaId: MONEDA,
      decimalesMoneda: 0,
      creadoPor: USER,
      confirmadoPor: null,
      confirmadoEl: null,
      anuladoPor: null,
      anuladoEl: null,
      motivoAnulacion: null,
      creadoEl: new Date('2026-07-17T12:00:00.000Z'),
      actualizadoEl: new Date('2026-07-17T12:00:00.000Z'),
      eliminadoEl: null,
    };
  }

  function grupoBase(): LiquidacionPropinasGrupo {
    return {
      id: 'grupo-1',
      tenantId: TENANT,
      liquidacionId: 'liq-1',
      tipoGarzon: TipoGarzon.GARZON,
      nombre: 'Garzones',
      porcentaje: '1.000000',
      criterio: CriterioDistribucion.PARTES_IGUALES,
      baseVentas: BaseVentasGrupo.TOTAL_FINAL,
      manualModo: null,
      montoGrupo: '150.0000',
      orden: 0,
      creadoEl: new Date('2026-07-17T12:00:00.000Z'),
      actualizadoEl: new Date('2026-07-17T12:00:00.000Z'),
      eliminadoEl: null,
    };
  }

  function fuenteBase(id = 'fuente-1', tipId = 'tip-1'): LiquidacionPropinasFuente {
    return {
      id,
      tenantId: TENANT,
      liquidacionId: 'liq-1',
      ventaPropinaId: tipId,
      montoPagado: '150.0000',
      creadoEl: new Date('2026-07-17T12:00:00.000Z'),
      actualizadoEl: new Date('2026-07-17T12:00:00.000Z'),
      eliminadoEl: null,
    };
  }

  it('carga el detalle con grupos, participantes, fuentes y eventos', async () => {
    liquidacionRepo.findOne.mockResolvedValueOnce(liquidacionBase());
    grupoRepo.find.mockResolvedValueOnce([]);
    participanteRepo.find.mockResolvedValueOnce([]);
    fuenteRepo.find.mockResolvedValueOnce([]);
    eventoRepo.find.mockResolvedValueOnce([]);

    await expect(service.detalle(TENANT, 'liq-1')).resolves.toMatchObject({
      id: 'liq-1',
      grupos: [],
      participantes: [],
      fuentes: [],
      eventos: [],
    });
  });

  it('exige motivo al excluir un participante sugerido', async () => {
    const participante = {
      id: 'part-1',
      tenantId: TENANT,
      liquidacionId: 'liq-1',
      grupoId: 'grupo-1',
      garzonId: 'garzon-1',
      tipoGarzon: TipoGarzon.GARZON,
      incluido: true,
      origen: OrigenParticipante.SUGERIDO,
      motivoAjuste: null,
      horas: '0.0000',
      ventasBase: '0.0000',
      cuentas: '1.0000',
      pesoManual: null,
      monto: '150.0000',
      ajusteMotivoMonto: null,
      creadoEl: new Date(),
      actualizadoEl: new Date(),
      eliminadoEl: null,
    } as LiquidacionPropinasParticipante;
    manager.findOne.mockResolvedValueOnce(liquidacionBase());
    manager.find
      .mockResolvedValueOnce([grupoBase()])
      .mockResolvedValueOnce([participante])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await expect(
      service.actualizar(TENANT, USER, 'liq-1', {
        participantes: [{ id: 'part-1', incluido: false }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza edición de una liquidación confirmada', async () => {
    manager.findOne.mockResolvedValueOnce(
      liquidacionBase(EstadoLiquidacion.CONFIRMADA),
    );

    await expect(
      service.actualizar(TENANT, USER, 'liq-1', { participantes: [] }),
    ).rejects.toThrow(BadRequestException);
  });

  it('actualiza snapshot desde la configuración vigente y registra diff', async () => {
    const nuevaConfig = {
      ...config,
      version: 4,
      grupos: [
        {
          ...config.grupos[0],
          id: 'cfg-garzon-v4',
          porcentaje: '0.800000',
          criterio: CriterioDistribucion.VENTAS_NETAS,
        },
      ],
    };
    distribucion.obtener.mockResolvedValueOnce(nuevaConfig);
    manager.findOne.mockResolvedValueOnce(liquidacionBase());
    manager.find
      .mockResolvedValueOnce([grupoBase()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    manager.query.mockReset().mockResolvedValueOnce([]);

    const result = await service.actualizarConfig(TENANT, USER, 'liq-1');

    expect(result.configuracionVersion).toBe(4);
    expect(manager.softDelete).toHaveBeenCalledWith(
      LiquidacionPropinasGrupo,
      { liquidacionId: 'liq-1' },
    );
    expect(manager.save).toHaveBeenCalledWith(
      LiquidacionPropinasEvento,
      expect.objectContaining({
        tipo: TipoEventoLiquidacion.CONFIG_ACTUALIZADA,
        payload: expect.objectContaining({
          antes: expect.any(Array),
          despues: expect.any(Array),
        }),
      }),
    );
  });

  it('confirma un borrador asignando liquidacion_id a sus tips', async () => {
    const liquidacion = liquidacionBase();
    manager.findOne.mockResolvedValueOnce(liquidacion);
    manager.find
      .mockResolvedValueOnce([grupoBase()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([fuenteBase('fuente-1', 'tip-1')])
      .mockResolvedValueOnce([]);
    manager.query
      .mockReset()
      .mockResolvedValueOnce([])
      // TypeORM pg: UPDATE RETURNING → [rows, rowCount]
      .mockResolvedValueOnce([[{ venta_propina_id: 'tip-1' }], 1]);

    const result = await service.confirmar(TENANT, USER, 'liq-1');

    expect(result.estado).toBe(EstadoLiquidacion.CONFIRMADA);
    expect(liquidacion.estado).toBe(EstadoLiquidacion.CONFIRMADA);
    expect(manager.query.mock.calls[1][0]).toContain('UPDATE venta_propina');
    expect(manager.query.mock.calls[1][1]).toEqual(['liq-1', ['tip-1']]);
    expect(manager.save).toHaveBeenCalledWith(
      LiquidacionPropinasEvento,
      expect.objectContaining({ tipo: TipoEventoLiquidacion.CONFIRMADA }),
    );
  });

  it('falla al confirmar si otra corrida ya tomó un tip', async () => {
    manager.findOne.mockResolvedValueOnce(liquidacionBase());
    manager.find
      .mockResolvedValueOnce([grupoBase()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        fuenteBase('fuente-1', 'tip-1'),
        fuenteBase('fuente-2', 'tip-2'),
      ])
      .mockResolvedValueOnce([]);
    manager.query
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[{ venta_propina_id: 'tip-1' }], 1]);

    await expect(service.confirmar(TENANT, USER, 'liq-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('anula una confirmada liberando solo sus tips', async () => {
    const liquidacion = liquidacionBase(EstadoLiquidacion.CONFIRMADA);
    manager.findOne.mockResolvedValueOnce(liquidacion);
    manager.find
      .mockResolvedValueOnce([grupoBase()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([fuenteBase('fuente-1', 'tip-1')])
      .mockResolvedValueOnce([]);
    manager.query.mockReset().mockResolvedValueOnce([]);

    const result = await service.anular(TENANT, USER, 'liq-1', {
      motivo: 'Error de período',
    });

    expect(result.estado).toBe(EstadoLiquidacion.ANULADA);
    expect(manager.query.mock.calls[0][0]).toContain('UPDATE venta_propina');
    expect(manager.query.mock.calls[0][1]).toEqual(['liq-1']);
    expect(liquidacion.motivoAnulacion).toBe('Error de período');
    expect(manager.save).toHaveBeenCalledWith(
      LiquidacionPropinasEvento,
      expect.objectContaining({ tipo: TipoEventoLiquidacion.ANULADA }),
    );
  });
});
