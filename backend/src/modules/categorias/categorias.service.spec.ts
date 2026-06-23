import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { CategoriasService } from './categorias.service';
import { Categoria } from './entities/categoria.entity';

const TENANT = 'tenant-uuid';
const CAT = 'categoria-uuid';

describe('CategoriasService', () => {
  let service: CategoriasService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriasService,
        { provide: getRepositoryToken(Categoria), useValue: repo },
      ],
    }).compile();

    service = module.get<CategoriasService>(CategoriasService);
  });

  describe('findAll', () => {
    it('lista solo las categorías del tenant', async () => {
      const rows = [{ id: CAT, tenantId: TENANT, nombre: 'Bebidas' }];
      repo.find.mockResolvedValue(rows);

      const result = await service.findAll(TENANT);

      expect(repo.find).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
        order: { nombre: 'ASC' },
      });
      expect(result).toBe(rows);
    });
  });

  describe('create', () => {
    it('crea una categoría con defaults aplicaA=ambos y activo=true', async () => {
      const result = await service.create(TENANT, { nombre: 'Bebidas' });

      expect(repo.create).toHaveBeenCalledWith({
        tenantId: TENANT,
        nombre: 'Bebidas',
        aplicaA: 'ambos',
        activo: true,
      });
      expect(result).toMatchObject({ nombre: 'Bebidas', aplicaA: 'ambos' });
    });
  });

  describe('update', () => {
    it('lanza NotFound si la categoría no pertenece al tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update(TENANT, CAT, { nombre: 'Otra' }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('actualiza la categoría del tenant', async () => {
      repo.findOne.mockResolvedValue({
        id: CAT,
        tenantId: TENANT,
        nombre: 'Bebidas',
        aplicaA: 'ambos',
        activo: true,
      });

      const result = await service.update(TENANT, CAT, { nombre: 'Comidas' });

      expect(result.nombre).toBe('Comidas');
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lanza NotFound al eliminar categoría de otro tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.remove(TENANT, CAT)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('hace soft delete de la categoría del tenant', async () => {
      repo.findOne.mockResolvedValue({ id: CAT, tenantId: TENANT });

      await service.remove(TENANT, CAT);

      expect(repo.softDelete).toHaveBeenCalledWith({
        id: CAT,
        tenantId: TENANT,
      });
    });
  });
});
