import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ImpresorasService } from './impresoras.service';
import { Impresora } from './entities/impresora.entity';

const TENANT = 'tenant-uuid';
const IMPRESORA = 'impresora-uuid';

describe('ImpresorasService', () => {
  let service: ImpresorasService;
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
        ImpresorasService,
        { provide: getRepositoryToken(Impresora), useValue: repo },
      ],
    }).compile();

    service = module.get<ImpresorasService>(ImpresorasService);
  });

  describe('listar', () => {
    it('filtra por tenant y opcionalmente por rol', async () => {
      repo.find.mockResolvedValue([]);
      await service.listar(TENANT, 'comanda');
      expect(repo.find).toHaveBeenCalledWith({
        where: { tenantId: TENANT, rol: 'comanda' },
        order: { nombre: 'ASC' },
      });
    });
  });

  describe('crear', () => {
    it('crea una impresora de red con host y puerto', async () => {
      const result = await service.crear(TENANT, {
        nombre: 'Cocina',
        rol: 'comanda',
        tipoConexion: 'red',
        host: '192.168.1.50',
        puerto: 9100,
      });

      expect(repo.create).toHaveBeenCalledWith({
        tenantId: TENANT,
        nombre: 'Cocina',
        rol: 'comanda',
        tipoConexion: 'red',
        host: '192.168.1.50',
        puerto: 9100,
        nombreCola: null,
        activo: true,
      });
      expect(result).toMatchObject({ nombre: 'Cocina' });
    });

    it('rechaza una impresora de red sin host o puerto', async () => {
      await expect(
        service.crear(TENANT, {
          nombre: 'Cocina',
          rol: 'comanda',
          tipoConexion: 'red',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('crea una impresora de sistema con nombreCola', async () => {
      const result = await service.crear(TENANT, {
        nombre: 'Caja',
        rol: 'boleta',
        tipoConexion: 'sistema',
        nombreCola: 'EPSON_TM_T20',
      });

      expect(result).toMatchObject({
        nombreCola: 'EPSON_TM_T20',
        host: null,
        puerto: null,
      });
    });

    it('rechaza una impresora de sistema sin nombreCola', async () => {
      await expect(
        service.crear(TENANT, {
          nombre: 'Caja',
          rol: 'boleta',
          tipoConexion: 'sistema',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('actualizar', () => {
    it('lanza NotFound si la impresora no pertenece al tenant', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.actualizar(TENANT, IMPRESORA, { nombre: 'Otra' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('actualiza los campos provistos', async () => {
      repo.findOne.mockResolvedValue({
        id: IMPRESORA,
        tenantId: TENANT,
        nombre: 'Cocina',
        activo: true,
      });

      const result = await service.actualizar(TENANT, IMPRESORA, {
        activo: false,
      });

      expect(result.activo).toBe(false);
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('eliminar', () => {
    it('hace soft delete de la impresora del tenant', async () => {
      repo.findOne.mockResolvedValue({ id: IMPRESORA, tenantId: TENANT });
      await service.eliminar(TENANT, IMPRESORA);
      expect(repo.softDelete).toHaveBeenCalledWith({
        id: IMPRESORA,
        tenantId: TENANT,
      });
    });
  });
});
