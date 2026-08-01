import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CajonesService } from './cajones.service';
import { Cajon } from './entities/cajon.entity';
import { CajonUsuario } from './entities/cajon-usuario.entity';
import { UsuarioTenant } from '../tenants/entities/usuario-tenant.entity';
import { Caja } from '../caja/entities/caja.entity';

const TENANT = 'tenant-uuid';
const USUARIO_ID = 'usuario-uuid';

describe('CajonesService', () => {
  let service: CajonesService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    restore: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let cuRepo: {
    find: jest.Mock;
  };
  let utRepo: {
    count: jest.Mock;
  };
  let cajaRepo: { count: jest.Mock };
  let manager: {
    softDelete: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      count: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      restore: jest.fn(() => Promise.resolve({ affected: 1 })),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
      createQueryBuilder: jest.fn(),
    };
    cuRepo = { find: jest.fn() };
    utRepo = { count: jest.fn() };
    cajaRepo = { count: jest.fn() };
    manager = {
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
        ...data,
      })),
    };
    dataSource = {
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajonesService,
        { provide: getRepositoryToken(Cajon), useValue: repo },
        { provide: getRepositoryToken(CajonUsuario), useValue: cuRepo },
        { provide: getRepositoryToken(UsuarioTenant), useValue: utRepo },
        { provide: getRepositoryToken(Caja), useValue: cajaRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<CajonesService>(CajonesService);
  });

  it('findAll filtra por tenant y ordena por nombre', async () => {
    repo.find.mockResolvedValue([]);
    await service.findAll(TENANT);
    expect(repo.find).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      order: { nombre: 'ASC' },
    });
  });

  it('create rechaza nombre duplicado con 409', async () => {
    repo.count.mockResolvedValue(1);
    await expect(
      service.create(TENANT, { nombre: 'Mostrador' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('create guarda cuando el nombre es único', async () => {
    repo.count.mockResolvedValue(0);
    const res = await service.create(TENANT, { nombre: 'Mostrador' });
    expect(repo.save).toHaveBeenCalled();
    expect(res).toMatchObject({ tenantId: TENANT, nombre: 'Mostrador' });
  });

  it('update lanza 404 si el cajón no existe', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.update(TENANT, 'x', { nombre: 'A' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update renombra validando unicidad y togglea activo', async () => {
    repo.findOne.mockResolvedValue({
      id: 'x',
      tenantId: TENANT,
      nombre: 'Viejo',
      activo: true,
    });
    repo.count.mockResolvedValue(0);
    const res = await service.update(TENANT, 'x', {
      nombre: 'Nuevo',
      activo: false,
    });
    expect(res).toMatchObject({ nombre: 'Nuevo', activo: false });
  });

  it('remove() registra quién borró y cuándo, en una sola escritura', async () => {
    repo.findOne.mockResolvedValue({ id: 'x', tenantId: TENANT });
    cajaRepo.count.mockResolvedValue(0);
    await service.remove(TENANT, USUARIO_ID, 'x');
    // Objeto exacto (no `objectContaining`): si `eliminadoEl` faltara del
    // payload, esta aserción debe fallar — es el corazón del soft delete, no
    // un detalle opcional de `eliminadoPor`.
    expect(repo.update).toHaveBeenCalledWith(
      { id: 'x', tenantId: TENANT },
      { eliminadoPor: USUARIO_ID, eliminadoEl: expect.any(Date) },
    );
  });

  it('remove lanza 404 si no existe', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(
      service.remove(TENANT, USUARIO_ID, 'x'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  describe('restaurar', () => {
    it('restaurar() devuelve el cajón RE-CONSULTADO tras el restore', async () => {
      repo.findOne.mockResolvedValue({
        id: 'x',
        tenantId: TENANT,
        nombre: 'Mostrador (en la papelera)',
        eliminadoEl: new Date(),
      });
      repo.findOneOrFail.mockResolvedValue({
        id: 'x',
        tenantId: TENANT,
        nombre: 'Mostrador',
        eliminadoEl: null,
      });

      const restaurado = await service.restaurar(TENANT, 'x');

      expect(repo.restore).toHaveBeenCalledWith({ id: 'x', tenantId: TENANT });
      expect(repo.findOneOrFail).toHaveBeenCalledWith({
        where: { id: 'x', tenantId: TENANT },
      });
      expect(restaurado.eliminadoEl).toBeNull();
      expect(restaurado.nombre).toBe('Mostrador');
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.restaurar(TENANT, 'x')).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.restore).not.toHaveBeenCalled();
    });

    it('restaurar() un cajón vivo (no eliminado) es 404', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 'x',
        tenantId: TENANT,
        eliminadoEl: null,
      });

      await expect(service.restaurar(TENANT, 'x')).rejects.toThrow(
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
      const cajonEliminado = {
        id: 'x',
        tenantId: TENANT,
        nombre: 'Mostrador',
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
          entities: [cajonEliminado],
          raw: [{ c_eliminado_por_nombre: 'admin.paris' }],
        }),
      };
      repo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.findAll(TENANT, true);

      // getMany() descarta los addSelect que no mapean a una columna de la
      // entity: el service debe usar getRawAndEntities() y fusionar a mano.
      expect(qbMock.getRawAndEntities).toHaveBeenCalled();
      expect(result[0]).toMatchObject({
        id: 'x',
        eliminadoPorNombre: 'admin.paris',
      });
    });
  });

  describe('allow-list de usuarios', () => {
    const CAJON = 'cajon-uuid';

    it('getUsuarios devuelve los ids habilitados y valida el cajón', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      cuRepo.find.mockResolvedValue([{ usuarioId: 'u1' }, { usuarioId: 'u2' }]);
      const res = await service.getUsuarios(TENANT, CAJON);
      expect(res).toEqual(['u1', 'u2']);
    });

    it('getUsuarios lanza 404 si el cajón no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getUsuarios(TENANT, CAJON)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('setUsuarios agrega los que entran y no borra nada cuando parte vacío', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      utRepo.count.mockResolvedValue(2);
      cuRepo.find.mockResolvedValue([]); // sin habilitaciones vivas
      const res = await service.setUsuarios(TENANT, CAJON, ['u1', 'u2']);
      expect(res).toEqual(['u1', 'u2']);
      expect(manager.softDelete).not.toHaveBeenCalled();
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('setUsuarios hace el diff: quita uno, agrega otro, conserva el resto', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      utRepo.count.mockResolvedValue(2);
      cuRepo.find.mockResolvedValue([
        { id: 'r-a', usuarioId: 'A' },
        { id: 'r-b', usuarioId: 'B' },
      ]);
      const res = await service.setUsuarios(TENANT, CAJON, ['A', 'C']);
      expect(res).toEqual(['A', 'C']);
      // quita B
      expect(manager.softDelete).toHaveBeenCalledWith(CajonUsuario, {
        id: expect.anything(),
      });
      // agrega solo C (no re-crea A)
      const saved = manager.save.mock.calls[0][0] as Array<{
        usuarioId: string;
      }>;
      expect(saved).toHaveLength(1);
      expect(saved[0].usuarioId).toBe('C');
    });

    it('setUsuarios idempotente: mismo set no borra ni crea', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      utRepo.count.mockResolvedValue(1);
      cuRepo.find.mockResolvedValue([{ id: 'r-a', usuarioId: 'A' }]);
      await service.setUsuarios(TENANT, CAJON, ['A']);
      expect(manager.softDelete).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('setUsuarios rechaza (400) un usuario que no es del tenant', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      utRepo.count.mockResolvedValue(1); // pidieron 2, solo 1 es miembro
      await expect(
        service.setUsuarios(TENANT, CAJON, ['A', 'ajeno']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('setUsuarios con array vacío deja el cajón sin asignados (borra los vivos)', async () => {
      repo.findOne.mockResolvedValue({ id: CAJON, tenantId: TENANT });
      cuRepo.find.mockResolvedValue([{ id: 'r-a', usuarioId: 'A' }]);
      const res = await service.setUsuarios(TENANT, CAJON, []);
      expect(res).toEqual([]);
      expect(utRepo.count).not.toHaveBeenCalled(); // no valida si no hay ids
      expect(manager.softDelete).toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('setUsuarios lanza 404 si el cajón no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.setUsuarios(TENANT, CAJON, ['A']),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('integridad de cajón en uso', () => {
    it('remove rechaza si el cajón tiene una caja abierta (409)', async () => {
      repo.findOne.mockResolvedValue({ id: 'x', tenantId: TENANT });
      cajaRepo.count.mockResolvedValue(1);
      await expect(
        service.remove(TENANT, USUARIO_ID, 'x'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('remove borra si no hay caja abierta', async () => {
      repo.findOne.mockResolvedValue({ id: 'x', tenantId: TENANT });
      cajaRepo.count.mockResolvedValue(0);
      await service.remove(TENANT, USUARIO_ID, 'x');
      expect(repo.update).toHaveBeenCalled();
    });

    it('update rechaza desactivar un cajón con caja abierta (409)', async () => {
      repo.findOne.mockResolvedValue({
        id: 'x',
        tenantId: TENANT,
        nombre: 'M',
        activo: true,
      });
      cajaRepo.count.mockResolvedValue(1);
      await expect(
        service.update(TENANT, 'x', { activo: false }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
