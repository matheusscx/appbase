import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ImpuestosService } from './impuestos.service';
import { Impuesto } from './entities/impuesto.entity';

const TENANT = 'tenant-uuid';
const IMP = 'impuesto-uuid';
const PAIS = 'pais-uuid';

describe('ImpuestosService', () => {
  let service: ImpuestosService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([{ pais_id: PAIS }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpuestosService,
        { provide: getRepositoryToken(Impuesto), useValue: repo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<ImpuestosService>(ImpuestosService);
  });

  describe('findAll', () => {
    it('lista la unión de impuestos del tenant y del país, con origen', async () => {
      const rows = [
        {
          id: 'sys-1',
          tenantId: null,
          paisId: PAIS,
          nombre: 'IVA',
          tipo: 'iva',
        },
        {
          id: IMP,
          tenantId: TENANT,
          paisId: null,
          nombre: 'Propina',
          tipo: 'otro',
        },
      ];
      repo.find.mockResolvedValue(rows);

      const result = await service.findAll(TENANT);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('pais_id'),
        [TENANT],
      );
      expect(repo.find).toHaveBeenCalledWith({
        where: [{ tenantId: TENANT }, { paisId: PAIS }],
        order: { nombre: 'ASC' },
      });
      expect(result[0].origen).toBe('sistema');
      expect(result[1].origen).toBe('personalizado');
    });

    it('sin país resuelto, lista solo los del tenant', async () => {
      dataSource.query.mockResolvedValue([]);
      repo.find.mockResolvedValue([]);

      await service.findAll(TENANT);

      expect(repo.find).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
        order: { nombre: 'ASC' },
      });
    });
  });

  describe('create', () => {
    it('crea un impuesto con porcentaje en decimal', async () => {
      const result = await service.create(TENANT, {
        nombre: 'IVA',
        porcentaje: '0.19',
      });

      expect(repo.create).toHaveBeenCalledWith({
        tenantId: TENANT,
        nombre: 'IVA',
        porcentaje: '0.19',
        activo: true,
        tipo: 'otro',
      });
      expect(result).toMatchObject({ nombre: 'IVA', porcentaje: '0.19' });
    });

    it('acepta tipo iva explícito', async () => {
      await service.create(TENANT, {
        nombre: 'IVA propio',
        porcentaje: '0.19',
        tipo: 'iva',
      });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: 'iva' }),
      );
    });

    it('rechaza porcentaje igual a 0', async () => {
      await expect(
        service.create(TENANT, { nombre: 'IVA', porcentaje: '0' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rechaza porcentaje negativo', async () => {
      await expect(
        service.create(TENANT, { nombre: 'IVA', porcentaje: '-0.1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('lanza NotFound si el impuesto no pertenece al tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update(TENANT, IMP, { nombre: 'Otro' }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rechaza actualizar a porcentaje <= 0', async () => {
      repo.findOne.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'IVA',
        porcentaje: '0.19',
        activo: true,
      });

      await expect(
        service.update(TENANT, IMP, { porcentaje: '0' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('actualiza el impuesto del tenant', async () => {
      repo.findOne.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'IVA',
        porcentaje: '0.19',
        activo: true,
      });

      const result = await service.update(TENANT, IMP, { porcentaje: '0.21' });

      expect(result.porcentaje).toBe('0.21');
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lanza NotFound al eliminar impuesto de otro tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.remove(TENANT, IMP)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('hace soft delete del impuesto del tenant', async () => {
      repo.findOne.mockResolvedValue({ id: IMP, tenantId: TENANT });

      await service.remove(TENANT, IMP);

      expect(repo.softDelete).toHaveBeenCalledWith({
        id: IMP,
        tenantId: TENANT,
      });
    });
  });
});
