import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ImpresorasService } from './impresoras.service';
import { Impresora } from './entities/impresora.entity';

const TENANT = 'tenant-uuid';
const IMPRESORA = 'impresora-uuid';
const USUARIO_ID = 'usuario-uuid';

describe('ImpresorasService', () => {
  let service: ImpresorasService;
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
    it('eliminar() registra quién borró y cuándo, en una sola escritura', async () => {
      repo.findOne.mockResolvedValue({ id: IMPRESORA, tenantId: TENANT });
      await service.eliminar(TENANT, USUARIO_ID, IMPRESORA);
      // Objeto exacto (no `objectContaining`): si `eliminadoEl` faltara del
      // payload, esta aserción debe fallar — es el corazón del soft delete,
      // no un detalle opcional de `eliminadoPor`.
      expect(repo.update).toHaveBeenCalledWith(
        { id: IMPRESORA, tenantId: TENANT },
        { eliminadoPor: USUARIO_ID, eliminadoEl: expect.any(Date) },
      );
    });
  });

  describe('restaurar', () => {
    it('restaurar() devuelve la impresora RE-CONSULTADA tras el restore', async () => {
      repo.findOne.mockResolvedValue({
        id: IMPRESORA,
        tenantId: TENANT,
        nombre: 'Cocina (en la papelera)',
        eliminadoEl: new Date(),
      });
      repo.findOneOrFail.mockResolvedValue({
        id: IMPRESORA,
        tenantId: TENANT,
        nombre: 'Cocina',
        eliminadoEl: null,
      });

      const restaurada = await service.restaurar(TENANT, IMPRESORA);

      expect(repo.restore).toHaveBeenCalledWith({
        id: IMPRESORA,
        tenantId: TENANT,
      });
      expect(repo.findOneOrFail).toHaveBeenCalledWith({
        where: { id: IMPRESORA, tenantId: TENANT },
      });
      expect(restaurada.eliminadoEl).toBeNull();
      expect(restaurada.nombre).toBe('Cocina');
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.restaurar(TENANT, IMPRESORA)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it('restaurar() una impresora viva (no eliminada) es 404', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: IMPRESORA,
        tenantId: TENANT,
        eliminadoEl: null,
      });

      await expect(service.restaurar(TENANT, IMPRESORA)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.restore).not.toHaveBeenCalled();
    });
  });

  describe('listar con incluirEliminados', () => {
    it('sin el flag no devuelve eliminados', async () => {
      repo.find.mockResolvedValue([]);
      await service.listar(TENANT);

      expect(repo.find).toHaveBeenCalledWith(
        expect.not.objectContaining({ withDeleted: true }),
      );
    });

    it('con el flag trae eliminados con el nombre de quien borró (vía getRawAndEntities)', async () => {
      const impresoraEliminada = {
        id: IMPRESORA,
        tenantId: TENANT,
        nombre: 'Cocina',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      };
      const qbMock = {
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockResolvedValue({
          entities: [impresoraEliminada],
          raw: [{ i_eliminado_por_nombre: 'admin.paris' }],
        }),
      };
      repo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.listar(TENANT, undefined, true);

      // getMany() descarta los addSelect que no mapean a una columna de la
      // entity: el service debe usar getRawAndEntities() y fusionar a mano.
      expect(qbMock.getRawAndEntities).toHaveBeenCalled();
      expect(result[0]).toMatchObject({
        id: IMPRESORA,
        eliminadoPorNombre: 'admin.paris',
      });
    });

    it('con el flag y rol filtra también por rol', async () => {
      const qbMock = {
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawAndEntities: jest
          .fn()
          .mockResolvedValue({ entities: [], raw: [] }),
      };
      repo.createQueryBuilder.mockReturnValue(qbMock);

      await service.listar(TENANT, 'comanda', true);

      expect(qbMock.andWhere).toHaveBeenCalledWith('i.rol = :rol', {
        rol: 'comanda',
      });
    });
  });
});
