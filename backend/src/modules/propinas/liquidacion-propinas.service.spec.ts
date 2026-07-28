import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { BaseVentasGrupo } from './enums/base-ventas-grupo.enum';
import { CriterioDistribucion } from './enums/criterio-distribucion.enum';
import { EstadoLiquidacion } from './enums/estado-liquidacion.enum';
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
  let dataSource: { transaction: jest.Mock; manager: unknown };
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
      save: jest.fn(
        (entity: { name?: string }, data: Record<string, unknown>) =>
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
      manager,
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
        {
          provide: getRepositoryToken(LiquidacionPropinas),
          useValue: liquidacionRepo,
        },
        {
          provide: getRepositoryToken(LiquidacionPropinasGrupo),
          useValue: grupoRepo,
        },
        {
          provide: getRepositoryToken(LiquidacionPropinasParticipante),
          useValue: participanteRepo,
        },
        {
          provide: getRepositoryToken(LiquidacionPropinasFuente),
          useValue: fuenteRepo,
        },
        {
          provide: getRepositoryToken(LiquidacionPropinasEvento),
          useValue: eventoRepo,
        },
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

  // Decisión de owner (2026-07-27): el pool se reparte SIEMPRE entero. Un grupo
  // del que nadie puede cobrar no reserva su porcentaje — se redistribuye entre
  // los que sí. Antes esto tenía dos comportamientos opuestos según hubiera o no
  // una fila de sesión: reventaba la liquidación entera, o se comía la plata.
  describe('grupo que no puede recibir su parte', () => {
    const CONFIG_DOS_GRUPOS = {
      ...config,
      grupos: [
        { ...config.grupos[0], id: 'cfg-garzon', porcentaje: '0.800000' },
        {
          ...config.grupos[0],
          id: 'cfg-barra',
          tipoGarzon: TipoGarzon.BARRA,
          nombre: 'Barra',
          porcentaje: '0.200000',
          criterio: CriterioDistribucion.VENTAS_NETAS,
        },
      ],
    };

    const crear = () =>
      service.crear(TENANT, USER, {
        fechaDesde: '2026-07-17T00:00:00.000Z',
        fechaHasta: '2026-07-18T00:00:00.000Z',
        turnoIds: ['turno-1'],
      });

    it('sin nadie en el grupo: su 20% va a los demás, no desaparece', async () => {
      distribucion.obtener.mockResolvedValue(CONFIG_DOS_GRUPOS);

      const result = await crear();

      const porTipo = new Map(
        result.grupos.map((g) => [g.tipoGarzon, g.montoGrupo]),
      );
      expect(porTipo.get(TipoGarzon.GARZON)).toBe('150.0000');
      expect(porTipo.get(TipoGarzon.BARRA)).toBe('0.0000');
      // Sin redistribuir, Garzones se llevaría 120 y los 30 de Barra no
      // aparecerían en ninguna fila: la suma repartida tiene que dar el pool.
      const repartido = result.participantes.reduce(
        (acc, p) => acc + Number(p.monto),
        0,
      );
      expect(repartido).toBe(150);
    });

    it('con gente pero todos en peso 0: reparte igual y los deja en 0, sin reventar', async () => {
      distribucion.obtener.mockResolvedValue(CONFIG_DOS_GRUPOS);
      // Ana abrió turno en barra y no cerró ninguna cuenta → ventasBase 0, que
      // con VENTAS_NETAS es peso 0. Antes, esto lanzaba 400 y se llevaba puesta
      // la liquidación entera, incluidos los garzones que estaban bien.
      manager.query
        .mockReset()
        .mockResolvedValueOnce(monedaRows)
        .mockResolvedValueOnce(tips)
        .mockResolvedValueOnce([
          {
            sesion_garzon_id: 'ses-1',
            garzon_id: 'ana',
            tipo_garzon: TipoGarzon.BARRA,
            turno_id: 'turno-1',
            inicio_el: new Date('2026-07-17T10:00:00.000Z'),
            fin_el: new Date('2026-07-17T18:00:00.000Z'),
          },
        ]);

      const result = await crear();

      const ana = result.participantes.find((p) => p.garzonId === 'ana');
      expect(ana?.monto).toBe('0.0000');
      expect(
        result.grupos.find((g) => g.tipoGarzon === TipoGarzon.GARZON)
          ?.montoGrupo,
      ).toBe('150.0000');
    });

    it('si NADIE puede recibir y hay pool, corta con un mensaje que dice qué revisar', async () => {
      // Un solo grupo, criterio VENTAS_NETAS, y el único presente sin ventas.
      distribucion.obtener.mockResolvedValue({
        ...config,
        grupos: [
          {
            ...config.grupos[0],
            criterio: CriterioDistribucion.VENTAS_NETAS,
          },
        ],
      });
      manager.query
        .mockReset()
        .mockResolvedValueOnce(monedaRows)
        .mockResolvedValueOnce([
          { ...tips[0], base_ventas_total_final: '0.0000' },
        ])
        .mockResolvedValueOnce([]);

      // Asserteamos el MENSAJE, no el tipo: sin el corte explícito igual sale un
      // 400, pero el genérico de `repartirMayoresRestos` ("la suma de pesos debe
      // ser mayor a cero"), que no le dice al usuario qué mirar.
      await expect(crear()).rejects.toThrow(/ningún participante puede/);
    });

    it('período sin propinas: no es un error, todos en cero', async () => {
      distribucion.obtener.mockResolvedValue(CONFIG_DOS_GRUPOS);
      manager.query
        .mockReset()
        .mockResolvedValueOnce(monedaRows)
        .mockResolvedValueOnce([]) // sin tips
        .mockResolvedValueOnce([]); // sin sesiones

      const result = await crear();

      expect(result.poolTotal).toBe('0.0000');
      expect(result.grupos.every((g) => g.montoGrupo === '0.0000')).toBe(true);
    });
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

  /**
   * Participante de `grupo-1`. Los montos por defecto suman los 150 de
   * `grupoBase()`: confirmar exige que lo repartido cuadre con el monto del
   * grupo, así que un fixture con el grupo lleno y cero participantes no es un
   * estado alcanzable.
   */
  function participanteBase(
    garzonId: string,
    monto: string,
  ): LiquidacionPropinasParticipante {
    return {
      id: `part-${garzonId}`,
      tenantId: TENANT,
      liquidacionId: 'liq-1',
      grupoId: 'grupo-1',
      garzonId,
      tipoGarzon: TipoGarzon.GARZON,
      incluido: true,
      origen: OrigenParticipante.SUGERIDO,
      motivoAjuste: null,
      horas: '0.0000',
      ventasBase: '0.0000',
      cuentas: '1.0000',
      pesoManual: null,
      monto,
      ajusteMotivoMonto: null,
      creadoEl: new Date('2026-07-17T12:00:00.000Z'),
      actualizadoEl: new Date('2026-07-17T12:00:00.000Z'),
      eliminadoEl: null,
    };
  }

  const participantesQueCuadran = () => [
    participanteBase('garzon-1', '75.0000'),
    participanteBase('garzon-2', '75.0000'),
  ];

  function fuenteBase(
    id = 'fuente-1',
    tipId = 'tip-1',
  ): LiquidacionPropinasFuente {
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
      .mockResolvedValueOnce([grupoBase()]) // grupos
      .mockResolvedValueOnce([]) // participantes
      // fuentes: de acá sale la lista de tips (sin fuentes no hay query de tips)
      .mockResolvedValueOnce(
        tips.map((t) => ({ ventaPropinaId: t.venta_propina_id })),
      )
      .mockResolvedValueOnce([]) // eventos
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    // El pool (150) sale de los tips de las fuentes: un fixture con pool > 0 y
    // cero tips es imposible en la realidad, y además dejaba el reparto sin nada
    // que verificar.
    manager.query
      .mockReset()
      .mockResolvedValueOnce(tips) // buscarTipsPorFuentes
      .mockResolvedValueOnce([]); // buscarSesionesPeriodo

    const result = await service.actualizarConfig(TENANT, USER, 'liq-1');

    expect(result.configuracionVersion).toBe(4);
    // VENTAS_NETAS sobre bases 1000 y 500 → 2/3 y 1/3 de 150. Con PARTES_IGUALES
    // (el criterio de la config vieja) daría 75/75, así que el reparto se ejerce
    // de verdad y no solo el número de versión.
    expect(
      result.participantes.map((p) => [p.garzonId, p.monto]).sort(),
    ).toEqual([
      ['garzon-1', '100.0000'],
      ['garzon-2', '50.0000'],
    ]);
    expect(manager.softDelete).toHaveBeenCalledWith(LiquidacionPropinasGrupo, {
      liquidacionId: 'liq-1',
    });
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
      .mockResolvedValueOnce(participantesQueCuadran())
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
      .mockResolvedValueOnce(participantesQueCuadran())
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

  const garzonAId = 'garzon-a';
  const garzonBId = 'garzon-b';

  function mockeaTipsParaPreview(): void {
    manager.query
      .mockReset()
      .mockResolvedValueOnce(monedaRows)
      .mockResolvedValueOnce([
        {
          venta_propina_id: 'tip-a',
          garzon_id: garzonAId,
          tipo_garzon: TipoGarzon.GARZON,
          turno_id: 'turno-1',
          monto_pagado: '1000.0000',
          venta_id: 'venta-a',
          base_ventas_total_final: '1000.0000',
          base_ventas_sin_impuestos: '1000.0000',
        },
        {
          venta_propina_id: 'tip-b',
          garzon_id: garzonBId,
          tipo_garzon: TipoGarzon.GARZON,
          turno_id: 'turno-1',
          monto_pagado: '1000.0000',
          venta_id: 'venta-b',
          base_ventas_total_final: '1000.0000',
          base_ventas_sin_impuestos: '1000.0000',
        },
      ])
      .mockResolvedValueOnce([]);
  }

  it('computarReparto calcula el pool y reparte sin persistir', async () => {
    mockeaTipsParaPreview();

    const result = await service.computarReparto(
      TENANT,
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-08T00:00:00Z'),
      [],
    );

    expect(result.poolTotal).toBe('2000.0000');
    expect(result.grupos).toHaveLength(1);
    expect(result.grupos[0].montoGrupo).toBe('2000.0000');
    expect(result.participantes).toHaveLength(2);
    expect(result.participantes.map((p) => p.monto).sort()).toEqual([
      '1000.0000',
      '1000.0000',
    ]);
    // no se guardó ninguna liquidación
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('computarReparto excluye un participante y redistribuye', async () => {
    mockeaTipsParaPreview();

    const result = await service.computarReparto(
      TENANT,
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-08T00:00:00Z'),
      [],
      { exclusiones: [garzonBId] },
    );

    const incluidos = result.participantes.filter((p) => p.incluido);
    expect(incluidos).toHaveLength(1);
    expect(incluidos[0].garzonId).toBe(garzonAId);
    expect(incluidos[0].monto).toBe('2000.0000'); // recibe todo el grupo
  });

  it('liquidar crea, aplica exclusión y confirma bloqueando las propinas', async () => {
    mockeaTipsParaPreview();
    manager.query
      // SELECT ... FOR UPDATE (lock de tips antes de bloquear)
      .mockResolvedValueOnce([])
      // UPDATE ... RETURNING → [rows, rowCount]
      .mockResolvedValueOnce([
        [{ venta_propina_id: 'tip-a' }, { venta_propina_id: 'tip-b' }],
        2,
      ]);

    const result = await service.liquidar(TENANT, USER, {
      fechaDesde: '2026-07-01T00:00:00Z',
      fechaHasta: '2026-07-08T00:00:00Z',
      ajustes: { exclusiones: [garzonBId] },
    });

    expect(result.estado).toBe(EstadoLiquidacion.CONFIRMADA);
    const incluidos = result.participantes.filter((p) => p.incluido);
    expect(incluidos).toHaveLength(1);
    expect(incluidos[0].monto).toBe('2000.0000');
    // se ejecutó el UPDATE de bloqueo de venta_propina
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE venta_propina'),
      expect.anything(),
    );
    expect(manager.save).toHaveBeenCalledWith(
      LiquidacionPropinasEvento,
      expect.objectContaining({ tipo: TipoEventoLiquidacion.CREADA }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      LiquidacionPropinasEvento,
      expect.objectContaining({ tipo: TipoEventoLiquidacion.CONFIRMADA }),
    );
  });

  // El monto manual pisaba el monto de un participante sin recalcular a los
  // demás, y la única validación de suma se salteaba todo grupo que no fuera
  // MANUAL+MONTOS: en un grupo por partes iguales se podía repartir más plata de
  // la que había en el pool, y confirmarlo.
  it('un monto manual que no cuadra con el grupo no se puede confirmar', async () => {
    mockeaTipsParaPreview();
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        [{ venta_propina_id: 'tip-a' }, { venta_propina_id: 'tip-b' }],
        2,
      ]);

    // Grupo de 2000 con dos participantes a 1000. Fijarle 1900 a uno deja 2900
    // repartidos sobre un pool de 2000.
    await expect(
      service.liquidar(TENANT, USER, {
        fechaDesde: '2026-07-01T00:00:00Z',
        fechaHasta: '2026-07-08T00:00:00Z',
        ajustes: {
          montosManuales: [{ garzonId: garzonAId, monto: '1900.0000' }],
        },
      }),
    ).rejects.toThrow(/no coincide con el monto del grupo/);
  });

  it('un monto manual compensado entre los dos sí se confirma', async () => {
    mockeaTipsParaPreview();
    manager.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        [{ venta_propina_id: 'tip-a' }, { venta_propina_id: 'tip-b' }],
        2,
      ]);

    // 1200 + 800 = 2000: la regla es que la plata cuadre, no prohibir el ajuste.
    const result = await service.liquidar(TENANT, USER, {
      fechaDesde: '2026-07-01T00:00:00Z',
      fechaHasta: '2026-07-08T00:00:00Z',
      ajustes: {
        montosManuales: [
          { garzonId: garzonAId, monto: '1200.0000' },
          { garzonId: garzonBId, monto: '800.0000' },
        ],
      },
    });

    expect(result.estado).toBe(EstadoLiquidacion.CONFIRMADA);
  });
});
