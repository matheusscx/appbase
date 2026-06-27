import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RecargosService } from './recargos.service';
import { Recargo } from './entities/recargo.entity';
import { RecargoTramo } from './entities/recargo-tramo.entity';
import { RecargoMetodoPago } from './entities/recargo-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { CondicionTipo } from '../../common/enums/reglas.enums';

const TENANT = 'tenant-uuid';

function makeTipo(codigo: string, clase: string = 'recargo') {
  return { id: `tipo-${codigo}`, codigo, clase, nombre: `Tipo ${codigo}` };
}

describe('RecargosService', () => {
  let service: RecargosService;
  let qbMock: { where: jest.Mock; andWhere: jest.Mock; getCount: jest.Mock };
  let managerMock: { create: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let dataSourceMock: { transaction: jest.Mock };
  let recargoRepoMock: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let tipoReglaRepoMock: { findOne: jest.Mock; find: jest.Mock };
  let tramoRepoMock: { find: jest.Mock };
  let metodoPagoRepoMock: { find: jest.Mock };

  beforeEach(async () => {
    qbMock = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };

    managerMock = {
      create: jest.fn((_, data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((e: unknown) => Promise.resolve(e)),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    dataSourceMock = {
      transaction: jest.fn((cb: (m: typeof managerMock) => Promise<unknown>) =>
        cb(managerMock),
      ),
    };

    recargoRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((e: unknown) => Promise.resolve(e)),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qbMock),
    };

    tipoReglaRepoMock = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    tramoRepoMock = { find: jest.fn().mockResolvedValue([]) };
    metodoPagoRepoMock = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecargosService,
        { provide: getDataSourceToken(), useValue: dataSourceMock },
        { provide: getRepositoryToken(Recargo), useValue: recargoRepoMock },
        { provide: getRepositoryToken(TipoRegla), useValue: tipoReglaRepoMock },
        {
          provide: getRepositoryToken(RecargoTramo),
          useValue: tramoRepoMock,
        },
        {
          provide: getRepositoryToken(RecargoMetodoPago),
          useValue: metodoPagoRepoMock,
        },
      ],
    }).compile();

    service = module.get<RecargosService>(RecargosService);
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('rejects when tipoRegla does not exist', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(null);
      await expect(
        service.create(TENANT, { nombre: 'X', tipoReglaId: 'tr-x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when tipo clase is not recargo', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('pronto_pago', 'descuento'),
      );
      await expect(
        service.create(TENANT, {
          nombre: 'X',
          tipoReglaId: 'tipo-pronto_pago',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates general recargo with modo and valor', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      await service.create(TENANT, {
        nombre: 'Recargo general',
        tipoReglaId: 'tipo-general',
        valor: '0.05',
        modo: 'porcentaje',
      });
      expect(managerMock.save).toHaveBeenCalledTimes(1);
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({
        condicionTipo: CondicionTipo.NINGUNA,
        condicionValor: null,
      });
    });

    it('rejects general without valor', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      await expect(
        service.create(TENANT, {
          nombre: 'General sin valor',
          tipoReglaId: 'tipo-general',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates mora with diasVencimiento', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('mora'));
      await service.create(TENANT, {
        nombre: 'Mora',
        tipoReglaId: 'tipo-mora',
        diasVencimiento: 30,
        valor: '0.05',
        modo: 'porcentaje',
      });
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({
        condicionTipo: CondicionTipo.VENCIMIENTO,
        condicionValor: '30',
      });
    });

    it('rejects mora without diasVencimiento', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('mora'));
      await expect(
        service.create(TENANT, {
          nombre: 'Mora sin dias',
          tipoReglaId: 'tipo-mora',
          valor: '0.05',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects mora with diasVencimiento out of range (> 365)', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('mora'));
      await expect(
        service.create(TENANT, {
          nombre: 'Mora fuera rango',
          tipoReglaId: 'tipo-mora',
          diasVencimiento: 400,
          valor: '0.05',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates recargo_metodo_pago with metodoPagoIds', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      await service.create(TENANT, {
        nombre: 'Recargo MP',
        tipoReglaId: 'tipo-recargo_metodo_pago',
        metodoPagoIds: ['mp-1'],
        valor: '0.03',
        modo: 'porcentaje',
      });
      expect(managerMock.save).toHaveBeenCalledTimes(2);
      const [, metodoArgs] = managerMock.save.mock.calls as Array<[unknown[]]>;
      expect(metodoArgs[0]).toHaveLength(1);
    });

    it('rejects recargo_metodo_pago without metodoPagoIds', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      await expect(
        service.create(TENANT, {
          nombre: 'Recargo MP',
          tipoReglaId: 'tipo-recargo_metodo_pago',
          valor: '0.03',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates interes_simple and forces modo=porcentaje', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('interes_simple'));
      await service.create(TENANT, {
        nombre: 'Interés simple',
        tipoReglaId: 'tipo-interes_simple',
        valor: '0.02',
      });
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({ modo: 'porcentaje' });
    });

    it('creates interes_compuesto and forces modo=porcentaje', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('interes_compuesto'),
      );
      await service.create(TENANT, {
        nombre: 'Interés compuesto',
        tipoReglaId: 'tipo-interes_compuesto',
        valor: '0.02',
      });
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({ modo: 'porcentaje' });
    });

    it('rejects duplicate nombre', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      qbMock.getCount.mockResolvedValue(1);
      await expect(
        service.create(TENANT, {
          nombre: 'Existing',
          tipoReglaId: 'tipo-general',
          valor: '0.05',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws NotFoundException when recargo not found', async () => {
      recargoRepoMock.findOne.mockResolvedValue(null);
      await expect(
        service.update(TENANT, 'x', { nombre: 'nuevo' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('replaces metodoPagoIds on update', async () => {
      const existing = {
        id: 'r-1',
        tenantId: TENANT,
        nombre: 'Rec MP',
        tipoReglaId: 'tipo-recargo_metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
      };
      recargoRepoMock.findOne.mockResolvedValue(existing);
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );

      await service.update(TENANT, 'r-1', {
        tipoReglaId: 'tipo-recargo_metodo_pago',
        metodoPagoIds: ['mp-5'],
        valor: '0.03',
        modo: 'porcentaje',
      });

      expect(managerMock.delete).toHaveBeenCalledWith(RecargoMetodoPago, {
        recargoId: 'r-1',
      });
      const typedCalls = managerMock.save.mock.calls as Array<[unknown[]]>;
      const lastCallArgs = typedCalls[typedCalls.length - 1];
      expect(lastCallArgs[0]).toHaveLength(1);
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('throws NotFoundException when recargo not found', async () => {
      recargoRepoMock.findOne.mockResolvedValue(null);
      await expect(service.remove(TENANT, 'x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes when recargo belongs to tenant', async () => {
      recargoRepoMock.findOne.mockResolvedValue({ id: 'r1', tenantId: TENANT });
      await service.remove(TENANT, 'r1');
      expect(recargoRepoMock.softDelete).toHaveBeenCalledWith({
        id: 'r1',
        tenantId: TENANT,
      });
    });
  });

  // ─── nombreDisponible ─────────────────────────────────────────────────────

  describe('nombreDisponible', () => {
    it('returns disponible:true when no match', async () => {
      qbMock.getCount.mockResolvedValue(0);
      const result = await service.nombreDisponible(TENANT, 'Nuevo');
      expect(result).toEqual({ disponible: true });
    });

    it('returns disponible:false when match exists', async () => {
      qbMock.getCount.mockResolvedValue(1);
      const result = await service.nombreDisponible(TENANT, 'Existente');
      expect(result).toEqual({ disponible: false });
    });

    it('adds excludeId condition when provided', async () => {
      qbMock.getCount.mockResolvedValue(0);
      await service.nombreDisponible(TENANT, 'Nombre', 'some-id');
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('recargo_id'),
        expect.objectContaining({ excludeId: 'some-id' }),
      );
    });
  });
});
