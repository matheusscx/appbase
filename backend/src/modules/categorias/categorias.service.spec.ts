import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CategoriasService } from './categorias.service';
import { Categoria } from './entities/categoria.entity';

const TENANT = 'tenant-uuid';
const CAT = 'categoria-uuid';
const IMPRESORA = 'impresora-uuid';

describe('CategoriasService', () => {
  let service: CategoriasService;
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
      query: jest.fn().mockResolvedValue([{ impresora_id: IMPRESORA }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriasService,
        { provide: getRepositoryToken(Categoria), useValue: repo },
        { provide: getDataSourceToken(), useValue: dataSource },
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
        impresoraId: null,
      });
      expect(result).toMatchObject({ nombre: 'Bebidas', aplicaA: 'ambos' });
    });

    it('acepta un impresoraId válido (de rol comanda, activa, del tenant)', async () => {
      const result = await service.create(TENANT, {
        nombre: 'Bebidas',
        impresoraId: IMPRESORA,
      });

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining("rol = 'comanda'"),
        [IMPRESORA, TENANT],
      );
      expect(result).toMatchObject({ impresoraId: IMPRESORA });
    });

    it('rechaza un impresoraId que no existe o no es de rol comanda', async () => {
      dataSource.query.mockResolvedValue([]);
      await expect(
        service.create(TENANT, { nombre: 'Bebidas', impresoraId: IMPRESORA }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
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

    it('valida el impresoraId al actualizarlo', async () => {
      repo.findOne.mockResolvedValue({
        id: CAT,
        tenantId: TENANT,
        nombre: 'Bebidas',
        impresoraId: null,
      });
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.update(TENANT, CAT, { impresoraId: IMPRESORA }),
      ).rejects.toThrow(BadRequestException);
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
