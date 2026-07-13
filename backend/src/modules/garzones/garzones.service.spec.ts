import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { GarzonesService } from './garzones.service';
import { Garzon } from './entities/garzon.entity';

const TENANT = 'tenant-uuid';

type Repo = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  softDelete: jest.Mock;
};

function makeRepo(): Repo {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
    softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
  };
}

/** Construye un garzón de prueba con el PIN ya hasheado. */
function garzon(over: Partial<Garzon> & { pin?: string }): Garzon {
  const { pin, ...rest } = over;
  return {
    id: 'g1',
    tenantId: TENANT,
    nombre: 'Ana',
    pinHash: pin ? bcrypt.hashSync(pin, 10) : 'x',
    activo: true,
    creadoEl: new Date(),
    actualizadoEl: new Date(),
    eliminadoEl: null,
    ...rest,
  };
}

describe('GarzonesService', () => {
  let service: GarzonesService;
  let repo: Repo;

  beforeEach(async () => {
    repo = makeRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GarzonesService,
        { provide: getRepositoryToken(Garzon), useValue: repo },
      ],
    }).compile();
    service = module.get<GarzonesService>(GarzonesService);
  });

  describe('crear', () => {
    it('hashea el PIN y nunca expone el hash en la vista pública', async () => {
      const result = await service.crear(TENANT, {
        nombre: 'Ana',
        pin: '123456',
      });

      const saved = (repo.save.mock.calls[0] as [Garzon])[0];
      expect(saved.pinHash).not.toBe('123456');
      expect(await bcrypt.compare('123456', saved.pinHash)).toBe(true);
      expect(result).not.toHaveProperty('pinHash');
      expect(result.nombre).toBe('Ana');
    });

    it('rechaza un PIN ya usado por otro garzón del tenant', async () => {
      repo.find.mockResolvedValue([garzon({ id: 'g1', pin: '123456' })]);

      await expect(
        service.crear(TENANT, { nombre: 'Bruno', pin: '123456' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('resolverGarzonPorPin', () => {
    it('devuelve el garzón activo cuyo PIN coincide', async () => {
      const g = garzon({ id: 'g2', nombre: 'Bruno', pin: '654321' });
      repo.find.mockResolvedValue([g]);

      const result = await service.resolverGarzonPorPin(TENANT, '654321');
      expect(result.id).toBe('g2');
      expect(repo.find).toHaveBeenCalledWith({
        where: { tenantId: TENANT, activo: true },
      });
    });

    it('lanza 400 si ningún PIN coincide', async () => {
      repo.find.mockResolvedValue([garzon({ pin: '111111' })]);

      await expect(
        service.resolverGarzonPorPin(TENANT, '999999'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resetPin', () => {
    it('re-hashea el PIN del garzón existente', async () => {
      const g = garzon({ id: 'g1', pin: '111111' });
      repo.findOne.mockResolvedValue(g);
      repo.find.mockResolvedValue([g]);

      await service.resetPin(TENANT, 'g1', { pin: '222222' });

      const saved = (repo.save.mock.calls[0] as [Garzon])[0];
      expect(await bcrypt.compare('222222', saved.pinHash)).toBe(true);
    });

    it('lanza NotFound si el garzón no existe en el tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.resetPin(TENANT, 'inexistente', { pin: '222222' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
