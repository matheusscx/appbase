import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { PropinaConfiguracion } from './entities/propina-configuracion.entity';
import { PropinaGrupoDistribucion } from './entities/propina-grupo-distribucion.entity';
import { PropinaGrupoPesoManual } from './entities/propina-grupo-peso-manual.entity';
import { CriterioDistribucion } from './enums/criterio-distribucion.enum';
import { BaseVentasGrupo } from './enums/base-ventas-grupo.enum';
import { ManualModo } from './enums/manual-modo.enum';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { PropinaDistribucionService } from './propina-distribucion.service';

const TENANT = 'tenant-1';
const USER = 'user-1';

describe('PropinaDistribucionService', () => {
  let service: PropinaDistribucionService;
  let configRepo: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
  };
  let grupoRepo: { find: jest.Mock };
  let pesoRepo: { find: jest.Mock };
  let manager: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
    getRepository: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    configRepo = {
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
    };
    grupoRepo = { find: jest.fn().mockResolvedValue([]) };
    pesoRepo = { find: jest.fn().mockResolvedValue([]) };

    manager = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((_e: unknown, data: Record<string, unknown>) => ({
        ...data,
      })),
      save: jest.fn((_e: unknown, data: Record<string, unknown>) =>
        Promise.resolve({
          id: data['id'] ?? `${String(_e).includes('Grupo') ? 'g' : 'c'}-new`,
          ...data,
        }),
      ),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      getRepository: jest.fn(),
    };

    dataSource = {
      transaction: jest.fn(async (cb: (m: typeof manager) => unknown) =>
        cb(manager),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropinaDistribucionService,
        { provide: getRepositoryToken(PropinaConfiguracion), useValue: configRepo },
        {
          provide: getRepositoryToken(PropinaGrupoDistribucion),
          useValue: grupoRepo,
        },
        {
          provide: getRepositoryToken(PropinaGrupoPesoManual),
          useValue: pesoRepo,
        },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get(PropinaDistribucionService);
  });

  function stubCargarPublica(version = 1, grupos: PropinaGrupoDistribucion[] = []) {
    const config = {
      id: 'cfg-1',
      tenantId: TENANT,
      version,
      actualizadoPor: null,
      actualizadoEl: new Date(),
      eliminadoEl: null,
    } as PropinaConfiguracion;

    manager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === PropinaConfiguracion) {
        return { findOneOrFail: jest.fn().mockResolvedValue(config) };
      }
      if (entity === PropinaGrupoDistribucion) {
        return { find: jest.fn().mockResolvedValue(grupos) };
      }
      if (entity === PropinaGrupoPesoManual) {
        return { find: jest.fn().mockResolvedValue([]) };
      }
      return {};
    });

    configRepo.findOneOrFail.mockResolvedValue(config);
    grupoRepo.find.mockResolvedValue(grupos);
    pesoRepo.find.mockResolvedValue([]);
    return config;
  }

  it('obtener crea default si no existe (garzon 100% PARTES_IGUALES)', async () => {
    configRepo.findOne.mockResolvedValueOnce(null);
    manager.findOne.mockResolvedValueOnce(null);
    manager.save
      .mockResolvedValueOnce({
        id: 'cfg-1',
        tenantId: TENANT,
        version: 1,
        actualizadoPor: null,
        actualizadoEl: new Date(),
      })
      .mockResolvedValueOnce({
        id: 'g-1',
        tipoGarzon: TipoGarzon.GARZON,
        porcentaje: '1.000000',
        criterio: CriterioDistribucion.PARTES_IGUALES,
      });

    stubCargarPublica(1, [
      {
        id: 'g-1',
        tenantId: TENANT,
        configuracionId: 'cfg-1',
        tipoGarzon: TipoGarzon.GARZON,
        nombre: 'Garzones',
        porcentaje: '1.000000',
        criterio: CriterioDistribucion.PARTES_IGUALES,
        baseVentas: BaseVentasGrupo.TOTAL_FINAL,
        manualModo: null,
        activo: true,
        orden: 0,
      } as PropinaGrupoDistribucion,
    ]);
    // segunda findOne en obtener tras asegurarDefault (ya existe)
    configRepo.findOne.mockResolvedValueOnce({
      id: 'cfg-1',
      version: 1,
    });

    const result = await service.obtener(TENANT);

    expect(manager.create).toHaveBeenCalledWith(
      PropinaGrupoDistribucion,
      expect.objectContaining({
        tipoGarzon: TipoGarzon.GARZON,
        porcentaje: '1.000000',
        criterio: CriterioDistribucion.PARTES_IGUALES,
      }),
    );
    expect(result.grupos).toHaveLength(1);
    expect(result.grupos[0].tipoGarzon).toBe(TipoGarzon.GARZON);
  });

  it('reemplazar valida Σ porcentaje activos = 1.0000', async () => {
    await expect(
      service.reemplazar(TENANT, USER, {
        grupos: [
          {
            tipoGarzon: TipoGarzon.GARZON,
            nombre: 'G',
            porcentaje: '0.80',
            criterio: CriterioDistribucion.PARTES_IGUALES,
          },
          {
            tipoGarzon: TipoGarzon.COCINA,
            nombre: 'C',
            porcentaje: '0.10',
            criterio: CriterioDistribucion.PARTES_IGUALES,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('reemplazar incrementa version y reemplaza grupos', async () => {
    const config = {
      id: 'cfg-1',
      tenantId: TENANT,
      version: 1,
      actualizadoPor: null,
      actualizadoEl: new Date(),
      eliminadoEl: null,
    } as PropinaConfiguracion;
    manager.findOne.mockResolvedValue(config);
    manager.find.mockResolvedValue([{ id: 'old-g' }]);
    manager.save.mockImplementation((_e: unknown, data: Record<string, unknown>) =>
      Promise.resolve({ id: data['id'] ?? 'saved', ...data }),
    );

    stubCargarPublica(2, [
      {
        id: 'g-new',
        tenantId: TENANT,
        configuracionId: 'cfg-1',
        tipoGarzon: TipoGarzon.GARZON,
        nombre: 'Garzones',
        porcentaje: '0.800000',
        criterio: CriterioDistribucion.VENTAS_NETAS,
        baseVentas: BaseVentasGrupo.TOTAL_FINAL,
        manualModo: null,
        activo: true,
        orden: 0,
      } as PropinaGrupoDistribucion,
      {
        id: 'g-c',
        tenantId: TENANT,
        configuracionId: 'cfg-1',
        tipoGarzon: TipoGarzon.COCINA,
        nombre: 'Cocina',
        porcentaje: '0.200000',
        criterio: CriterioDistribucion.PARTES_IGUALES,
        baseVentas: BaseVentasGrupo.TOTAL_FINAL,
        manualModo: null,
        activo: true,
        orden: 1,
      } as PropinaGrupoDistribucion,
    ]);

    const result = await service.reemplazar(TENANT, USER, {
      grupos: [
        {
          tipoGarzon: TipoGarzon.GARZON,
          nombre: 'Garzones',
          porcentaje: '0.80',
          criterio: CriterioDistribucion.VENTAS_NETAS,
        },
        {
          tipoGarzon: TipoGarzon.COCINA,
          nombre: 'Cocina',
          porcentaje: '0.20',
          criterio: CriterioDistribucion.PARTES_IGUALES,
          orden: 1,
        },
      ],
    });

    expect(config.version).toBe(2);
    expect(config.actualizadoPor).toBe(USER);
    expect(manager.softDelete).toHaveBeenCalled();
    expect(result.version).toBe(2);
    expect(result.grupos).toHaveLength(2);
  });

  it('rechaza dos grupos activos con mismo tipo_garzon', async () => {
    await expect(
      service.reemplazar(TENANT, USER, {
        grupos: [
          {
            tipoGarzon: TipoGarzon.GARZON,
            nombre: 'A',
            porcentaje: '0.50',
            criterio: CriterioDistribucion.PARTES_IGUALES,
          },
          {
            tipoGarzon: TipoGarzon.GARZON,
            nombre: 'B',
            porcentaje: '0.50',
            criterio: CriterioDistribucion.PARTES_IGUALES,
          },
        ],
      }),
    ).rejects.toThrow(/mismo tipo|tipo garzon/i);
  });

  it('MANUAL exige manualModo; no-MANUAL exige manualModo null', async () => {
    await expect(
      service.reemplazar(TENANT, USER, {
        grupos: [
          {
            tipoGarzon: TipoGarzon.GARZON,
            nombre: 'G',
            porcentaje: '1',
            criterio: CriterioDistribucion.MANUAL,
          },
        ],
      }),
    ).rejects.toThrow(/manualModo/i);

    await expect(
      service.reemplazar(TENANT, USER, {
        grupos: [
          {
            tipoGarzon: TipoGarzon.GARZON,
            nombre: 'G',
            porcentaje: '1',
            criterio: CriterioDistribucion.PARTES_IGUALES,
            manualModo: ManualModo.PESOS,
          },
        ],
      }),
    ).rejects.toThrow(/solo aplica/i);
  });

  it('MANUAL + PESOS acepta pesos; MANUAL + MONTOS rechaza pesos en config', async () => {
    await expect(
      service.reemplazar(TENANT, USER, {
        grupos: [
          {
            tipoGarzon: TipoGarzon.GARZON,
            nombre: 'G',
            porcentaje: '1',
            criterio: CriterioDistribucion.MANUAL,
            manualModo: ManualModo.MONTOS,
            pesos: [{ garzonId: 'g1', peso: '2' }],
          },
        ],
      }),
    ).rejects.toThrow(/MONTOS/i);

    const config = {
      id: 'cfg-1',
      tenantId: TENANT,
      version: 1,
      actualizadoPor: null,
      actualizadoEl: new Date(),
      eliminadoEl: null,
    } as PropinaConfiguracion;
    manager.findOne.mockResolvedValue(config);
    manager.find.mockResolvedValue([]);
    stubCargarPublica(2, []);

    await service.reemplazar(TENANT, USER, {
      grupos: [
        {
          tipoGarzon: TipoGarzon.GARZON,
          nombre: 'G',
          porcentaje: '1',
          criterio: CriterioDistribucion.MANUAL,
          manualModo: ManualModo.PESOS,
          pesos: [{ garzonId: '550e8400-e29b-41d4-a716-446655440238', peso: '2' }],
        },
      ],
    });

    expect(manager.create).toHaveBeenCalledWith(
      PropinaGrupoPesoManual,
      expect.objectContaining({
        garzonId: '550e8400-e29b-41d4-a716-446655440238',
        peso: '2.0000',
      }),
    );
  });

  it('baseVentas default TOTAL_FINAL ok con VENTAS_NETAS', async () => {
    const config = {
      id: 'cfg-1',
      tenantId: TENANT,
      version: 1,
      actualizadoPor: null,
      actualizadoEl: new Date(),
      eliminadoEl: null,
    } as PropinaConfiguracion;
    manager.findOne.mockResolvedValue(config);
    manager.find.mockResolvedValue([]);
    stubCargarPublica(2, []);

    await service.reemplazar(TENANT, USER, {
      grupos: [
        {
          tipoGarzon: TipoGarzon.GARZON,
          nombre: 'G',
          porcentaje: '1',
          criterio: CriterioDistribucion.VENTAS_NETAS,
        },
      ],
    });

    expect(manager.create).toHaveBeenCalledWith(
      PropinaGrupoDistribucion,
      expect.objectContaining({
        baseVentas: BaseVentasGrupo.TOTAL_FINAL,
        criterio: CriterioDistribucion.VENTAS_NETAS,
      }),
    );
  });

  it('asegurarDefault no recrea si ya existe', async () => {
    const existing = { id: 'cfg-1', version: 3 } as PropinaConfiguracion;
    configRepo.findOne.mockResolvedValue(existing);

    const result = await service.asegurarDefault(TENANT);

    expect(result).toBe(existing);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(configRepo.findOne).toHaveBeenCalledWith({
      where: { tenantId: TENANT, eliminadoEl: IsNull() },
    });
  });
});
