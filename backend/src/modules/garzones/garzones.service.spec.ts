import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { GarzonesService } from './garzones.service';
import { Garzon } from './entities/garzon.entity';
import {
  EstadoSesionGarzon,
  SesionGarzon,
} from '../turnos/entities/sesion-garzon.entity';

// `crypto.randomInt` es no-configurable (no se puede spyOn), así que se mockea
// el módulo dejando la implementación real por defecto y sobrescribiéndola solo
// donde el test necesita forzar el valor generado.
jest.mock('crypto', () => {
  const actual = jest.requireActual<typeof crypto>('crypto');
  return { ...actual, randomInt: jest.fn(actual.randomInt) };
});

const TENANT = 'tenant-uuid';

type Repo = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  softDelete: jest.Mock;
};

type SesionRepo = {
  count: jest.Mock;
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

function makeSesionRepo(): SesionRepo {
  return {
    count: jest.fn().mockResolvedValue(0),
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
  let sesionRepo: SesionRepo;

  beforeEach(async () => {
    repo = makeRepo();
    sesionRepo = makeSesionRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GarzonesService,
        { provide: getRepositoryToken(Garzon), useValue: repo },
        { provide: getRepositoryToken(SesionGarzon), useValue: sesionRepo },
      ],
    }).compile();
    service = module.get<GarzonesService>(GarzonesService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('crear', () => {
    it('genera un PIN de 6 dígitos, lo hashea y lo devuelve una sola vez', async () => {
      const result = await service.crear(TENANT, { nombre: 'Ana' });

      expect(result.pin).toMatch(/^\d{6}$/);
      const saved = (repo.save.mock.calls[0] as [Garzon])[0];
      expect(saved.pinHash).not.toBe(result.pin);
      expect(await bcrypt.compare(result.pin, saved.pinHash)).toBe(true);
      expect(result).not.toHaveProperty('pinHash');
      expect(result.nombre).toBe('Ana');
    });

    it('reintenta si el PIN generado ya está en uso en el tenant', async () => {
      // Primer intento colisiona (123456 ya existe); el segundo (654321) es libre.
      (crypto.randomInt as unknown as jest.Mock)
        .mockReturnValueOnce(123456)
        .mockReturnValueOnce(654321);
      repo.find.mockResolvedValue([garzon({ id: 'g1', pin: '123456' })]);

      const result = await service.crear(TENANT, { nombre: 'Bruno' });

      expect(result.pin).toBe('654321');
      const saved = (repo.save.mock.calls[0] as [Garzon])[0];
      expect(await bcrypt.compare('654321', saved.pinHash)).toBe(true);
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

  describe('obtenerActivoPorId', () => {
    const GARZON = 'garzon-uuid';

    it('devuelve un garzón activo del tenant', async () => {
      repo.findOne.mockResolvedValue({
        id: GARZON,
        tenantId: TENANT,
        activo: true,
      });
      await expect(service.obtenerActivoPorId(TENANT, GARZON)).resolves.toEqual(
        expect.objectContaining({ id: GARZON }),
      );
    });

    it('rechaza un garzón inactivo', async () => {
      repo.findOne.mockResolvedValue({
        id: GARZON,
        tenantId: TENANT,
        activo: false,
      });
      await expect(service.obtenerActivoPorId(TENANT, GARZON)).rejects.toThrow(
        'Garzón no encontrado o inactivo',
      );
    });
  });

  describe('regenerarPin', () => {
    it('genera un PIN nuevo, re-hashea y lo devuelve una sola vez', async () => {
      const g = garzon({ id: 'g1', pin: '111111' });
      repo.findOne.mockResolvedValue(g);
      repo.find.mockResolvedValue([g]);

      const result = await service.regenerarPin(TENANT, 'g1');

      expect(result.pin).toMatch(/^\d{6}$/);
      const saved = (repo.save.mock.calls[0] as [Garzon])[0];
      expect(await bcrypt.compare(result.pin, saved.pinHash)).toBe(true);
    });

    it('lanza NotFound si el garzón no existe en el tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.regenerarPin(TENANT, 'inexistente')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('eliminar', () => {
    it('bloquea soft-delete si el garzón tiene sesión abierta', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1' }));
      sesionRepo.count.mockResolvedValue(1);

      await expect(service.eliminar(TENANT, 'g1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.eliminar(TENANT, 'g1')).rejects.toThrow(
        'No se puede eliminar un garzón con una sesión abierta',
      );
      expect(sesionRepo.count).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT,
          garzonId: 'g1',
          estado: EstadoSesionGarzon.ABIERTA,
        },
      });
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('soft-deletea si no hay sesión abierta', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1' }));
      sesionRepo.count.mockResolvedValue(0);

      await service.eliminar(TENANT, 'g1');

      expect(repo.softDelete).toHaveBeenCalledWith({
        id: 'g1',
        tenantId: TENANT,
      });
    });
  });
});
