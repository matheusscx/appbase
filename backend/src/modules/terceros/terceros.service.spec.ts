import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { TercerosService } from './terceros.service';
import { Tercero } from './entities/tercero.entity';

const TENANT = 'tenant-uuid';
const TERCERO = 'tercero-uuid';
const USUARIO_ID = 'usuario-uuid';

describe('TercerosService', () => {
  let service: TercerosService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    restore: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      restore: jest.fn(() => Promise.resolve({ affected: 1 })),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
      createQueryBuilder: jest.fn(),
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

      await expect(service.remove(TENANT, USUARIO_ID, TERCERO)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('remove() registra quién borró y cuándo, en una sola escritura', async () => {
      repo.findOne.mockResolvedValue({ id: TERCERO, tenantId: TENANT });

      await service.remove(TENANT, USUARIO_ID, TERCERO);

      // Objeto exacto (no `objectContaining`): si `eliminadoEl` faltara del
      // payload, esta aserción debe fallar — es el corazón del soft delete,
      // no un detalle opcional de `eliminadoPor`.
      expect(repo.update).toHaveBeenCalledWith(
        { id: TERCERO, tenantId: TENANT },
        { eliminadoPor: USUARIO_ID, eliminadoEl: expect.any(Date) },
      );
    });
  });

  describe('restaurar', () => {
    it('restaurar() devuelve el tercero RE-CONSULTADO tras el restore', async () => {
      repo.findOne.mockResolvedValue({
        id: TERCERO,
        tenantId: TENANT,
        nombre: 'Acme (en la papelera)',
        eliminadoEl: new Date(),
      });
      repo.findOneOrFail.mockResolvedValue({
        id: TERCERO,
        tenantId: TENANT,
        nombre: 'Acme',
        eliminadoEl: null,
      });

      const restaurado = await service.restaurar(TENANT, TERCERO);

      expect(repo.restore).toHaveBeenCalledWith({
        id: TERCERO,
        tenantId: TENANT,
      });
      expect(repo.findOneOrFail).toHaveBeenCalledWith({
        where: { id: TERCERO, tenantId: TENANT },
      });
      expect(restaurado.eliminadoEl).toBeNull();
      expect(restaurado.nombre).toBe('Acme');
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.restaurar(TENANT, TERCERO)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it('restaurar() un tercero vivo (no eliminado) es 404', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: TERCERO,
        tenantId: TENANT,
        eliminadoEl: null,
      });

      await expect(service.restaurar(TENANT, TERCERO)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.restore).not.toHaveBeenCalled();
    });
  });

  describe('findAll con incluirEliminados', () => {
    it('sin el flag no devuelve eliminados', async () => {
      repo.find.mockResolvedValue([]);
      await service.findAll(TENANT);

      expect(repo.find).toHaveBeenCalledWith(
        expect.not.objectContaining({ withDeleted: true }),
      );
    });

    it('con el flag trae eliminados con el nombre de quien borró (vía getRawAndEntities)', async () => {
      const terceroEliminado = {
        id: TERCERO,
        tenantId: TENANT,
        tipo: 'proveedor',
        nombre: 'Acme',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      };
      const qbMock = {
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockResolvedValue({
          entities: [terceroEliminado],
          raw: [{ t_eliminado_por_nombre: 'admin.paris' }],
        }),
      };
      repo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.findAll(TENANT, true);

      // getMany() descarta los addSelect que no mapean a una columna de la
      // entity: el service debe usar getRawAndEntities() y fusionar a mano.
      expect(qbMock.getRawAndEntities).toHaveBeenCalled();
      expect(result[0]).toMatchObject({
        id: TERCERO,
        eliminadoPorNombre: 'admin.paris',
      });
    });
  });
});
