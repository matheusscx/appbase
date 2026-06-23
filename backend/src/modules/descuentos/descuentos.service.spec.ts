import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DescuentosService } from './descuentos.service';
import { Descuento } from './entities/descuento.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { ModoRegla, CondicionTipo } from '../../common/enums/reglas.enums';

const TENANT = 'tenant-uuid';
const TIPO_OK = 'tipo-descuento';
const TIPO_WRONG = 'tipo-recargo';

describe('DescuentosService', () => {
  let service: DescuentosService;
  let descuentoRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };
  let tipoReglaRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    descuentoRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((row: Partial<Descuento>) => row),
      save: jest.fn((row) => Promise.resolve(row)),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    tipoReglaRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DescuentosService,
        { provide: getRepositoryToken(Descuento), useValue: descuentoRepo },
        { provide: getRepositoryToken(TipoRegla), useValue: tipoReglaRepo },
      ],
    }).compile();

    service = module.get<DescuentosService>(DescuentosService);
  });

  const baseDto = {
    nombre: 'Pronto pago',
    tipoReglaId: TIPO_OK,
    modo: ModoRegla.PORCENTAJE,
    valor: '0.10',
    condicionTipo: CondicionTipo.NINGUNA,
  };

  describe('create', () => {
    it('rechaza cuando el tipo de regla no existe', async () => {
      tipoReglaRepo.findOne.mockResolvedValue(null);
      await expect(service.create(TENANT, baseDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza cuando la clase del tipo no es descuento', async () => {
      tipoReglaRepo.findOne.mockResolvedValue({
        id: TIPO_WRONG,
        clase: 'recargo',
      });
      await expect(
        service.create(TENANT, { ...baseDto, tipoReglaId: TIPO_WRONG }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza un porcentaje >= 1', async () => {
      tipoReglaRepo.findOne.mockResolvedValue({
        id: TIPO_OK,
        clase: 'descuento',
      });
      await expect(
        service.create(TENANT, { ...baseDto, valor: '10' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('happy path: crea con tipo válido', async () => {
      tipoReglaRepo.findOne.mockResolvedValue({
        id: TIPO_OK,
        clase: 'descuento',
      });
      const result = await service.create(TENANT, baseDto);
      expect(descuentoRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT, tipoReglaId: TIPO_OK }),
      );
      expect(descuentoRepo.save).toHaveBeenCalled();
      expect(result).toMatchObject({ tenantId: TENANT });
    });
  });

  describe('update', () => {
    it('lanza NotFound al editar un descuento de otro tenant', async () => {
      descuentoRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update(TENANT, 'x', { nombre: 'nuevo' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('lanza NotFound al borrar un descuento de otro tenant', async () => {
      descuentoRepo.findOne.mockResolvedValue(null);
      await expect(service.remove(TENANT, 'x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-delete cuando pertenece al tenant', async () => {
      descuentoRepo.findOne.mockResolvedValue({ id: 'd1', tenantId: TENANT });
      await service.remove(TENANT, 'd1');
      expect(descuentoRepo.softDelete).toHaveBeenCalledWith({
        id: 'd1',
        tenantId: TENANT,
      });
    });
  });
});
