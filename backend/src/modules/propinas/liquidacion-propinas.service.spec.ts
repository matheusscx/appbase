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
    save: jest.Mock;
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
      save: jest.fn((entity: { name?: string }, data: Record<string, unknown>) =>
        Promise.resolve({
          id: `${entity.name ?? 'Entity'}-${manager.save.mock.calls.length + 1}`,
          ...data,
        }),
      ),
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

  it('carga el detalle con grupos, participantes, fuentes y eventos', async () => {
    const liquidacion = {
      id: 'liq-1',
      tenantId: TENANT,
      estado: EstadoLiquidacion.BORRADOR,
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
    } as LiquidacionPropinas;
    liquidacionRepo.findOne.mockResolvedValueOnce(liquidacion);
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
});
