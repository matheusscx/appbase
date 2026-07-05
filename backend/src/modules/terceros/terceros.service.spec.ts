import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { TercerosService } from './terceros.service';
import { Tercero } from './entities/tercero.entity';

const TENANT = 'tenant-uuid';
const TERCERO = 'tercero-uuid';

describe('TercerosService', () => {
  let service: TercerosService;
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
        TercerosService,
        { provide: getRepositoryToken(Tercero), useValue: repo },
      ],
    }).compile();

    service = module.get<TercerosService>(TercerosService);
  });

  describe('findAll', () => {
    it('lista solo los terceros del tenant', async () => {
      const rows = [
        { id: TERCERO, tenantId: TENANT, tipo: 'proveedor', nombre: 'Acme' },
      ];
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
    it('crea un tercero con default activo=true', async () => {
      const result = await service.create(TENANT, {
        tipo: 'proveedor',
        nombre: 'Acme',
      });

      expect(repo.create).toHaveBeenCalledWith({
        tenantId: TENANT,
        tipo: 'proveedor',
        nombre: 'Acme',
        rut: undefined,
        nombreLegal: undefined,
        rutFiscal: undefined,
        correo: undefined,
        telefono: undefined,
        direccion: undefined,
        activo: true,
      });
      expect(result).toMatchObject({ nombre: 'Acme', tipo: 'proveedor' });
    });
  });

  describe('update', () => {
    it('lanza NotFound si el tercero no pertenece al tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update(TENANT, TERCERO, { nombre: 'Otro' }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('actualiza el tercero del tenant', async () => {
      repo.findOne.mockResolvedValue({
        id: TERCERO,
        tenantId: TENANT,
        tipo: 'proveedor',
        nombre: 'Acme',
        activo: true,
      });

      const result = await service.update(TENANT, TERCERO, {
        nombre: 'Acme SRL',
      });

      expect(result.nombre).toBe('Acme SRL');
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lanza NotFound al eliminar tercero de otro tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.remove(TENANT, TERCERO)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('hace soft delete del tercero del tenant', async () => {
      repo.findOne.mockResolvedValue({ id: TERCERO, tenantId: TENANT });

      await service.remove(TENANT, TERCERO);

      expect(repo.softDelete).toHaveBeenCalledWith({
        id: TERCERO,
        tenantId: TENANT,
      });
    });
  });
});
