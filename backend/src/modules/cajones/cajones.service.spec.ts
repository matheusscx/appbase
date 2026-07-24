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

describe('CajonesService', () => {
  let service: CajonesService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softDelete: jest.Mock;
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
      count: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
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

  it('remove hace soft delete', async () => {
    repo.findOne.mockResolvedValue({ id: 'x', tenantId: TENANT });
    await service.remove(TENANT, 'x');
    expect(repo.softDelete).toHaveBeenCalledWith({ id: 'x', tenantId: TENANT });
  });

  it('remove lanza 404 si no existe', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.remove(TENANT, 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
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
      await expect(service.remove(TENANT, 'x')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('remove borra si no hay caja abierta', async () => {
      repo.findOne.mockResolvedValue({ id: 'x', tenantId: TENANT });
      cajaRepo.count.mockResolvedValue(0);
      await service.remove(TENANT, 'x');
      expect(repo.softDelete).toHaveBeenCalled();
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
