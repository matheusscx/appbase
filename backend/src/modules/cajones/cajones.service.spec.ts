import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CajonesService } from './cajones.service';
import { Cajon } from './entities/cajon.entity';

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

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajonesService,
        { provide: getRepositoryToken(Cajon), useValue: repo },
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
});
