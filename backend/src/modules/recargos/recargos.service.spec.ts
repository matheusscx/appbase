import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RecargosService } from './recargos.service';
import { Recargo } from './entities/recargo.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { ModoRegla, CondicionTipo } from '../../common/enums/reglas.enums';

const TENANT = 'tenant-uuid';
const TIPO_OK = 'tipo-recargo';
const TIPO_WRONG = 'tipo-descuento';

describe('RecargosService', () => {
  let service: RecargosService;
  let recargoRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let tipoReglaRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    recargoRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((row: Partial<Recargo>) => row),
      save: jest.fn((row) => Promise.resolve(row)),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    tipoReglaRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecargosService,
        { provide: getRepositoryToken(Recargo), useValue: recargoRepo },
        { provide: getRepositoryToken(TipoRegla), useValue: tipoReglaRepo },
      ],
    }).compile();

    service = module.get<RecargosService>(RecargosService);
  });

  const baseDto = {
    nombre: 'Interés simple',
    tipoReglaId: TIPO_OK,
    modo: ModoRegla.PORCENTAJE,
    valor: '0.05',
    condicionTipo: CondicionTipo.NINGUNA,
  };

  describe('create', () => {
    it('rechaza cuando el tipo de regla no existe', async () => {
      tipoReglaRepo.findOne.mockResolvedValue(null);
      await expect(service.create(TENANT, baseDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza cuando la clase del tipo no es recargo', async () => {
      tipoReglaRepo.findOne.mockResolvedValue({
        id: TIPO_WRONG,
        clase: 'descuento',
      });
      await expect(
        service.create(TENANT, { ...baseDto, tipoReglaId: TIPO_WRONG }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un porcentaje >= 1', async () => {
      tipoReglaRepo.findOne.mockResolvedValue({
        id: TIPO_OK,
        clase: 'recargo',
      });
      await expect(
        service.create(TENANT, { ...baseDto, valor: '5' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('happy path: crea con tipo válido', async () => {
      tipoReglaRepo.findOne.mockResolvedValue({
        id: TIPO_OK,
        clase: 'recargo',
      });
      const result = await service.create(TENANT, baseDto);
      expect(recargoRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT, tipoReglaId: TIPO_OK }),
      );
      expect(recargoRepo.save).toHaveBeenCalled();
      expect(result).toMatchObject({ tenantId: TENANT });
    });
  });

  describe('update', () => {
    it('lanza NotFound al editar un recargo de otro tenant', async () => {
      recargoRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update(TENANT, 'x', { nombre: 'nuevo' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('lanza NotFound al borrar un recargo de otro tenant', async () => {
      recargoRepo.findOne.mockResolvedValue(null);
      await expect(service.remove(TENANT, 'x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-delete cuando pertenece al tenant', async () => {
      recargoRepo.findOne.mockResolvedValue({ id: 'r1', tenantId: TENANT });
      await service.remove(TENANT, 'r1');
      expect(recargoRepo.softDelete).toHaveBeenCalledWith({
        id: 'r1',
        tenantId: TENANT,
      });
    });
  });
});
