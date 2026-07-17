import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TurnosService } from './turnos.service';
import { Turno } from './entities/turno.entity';

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

function turno(over: Partial<Turno> = {}): Turno {
  return {
    id: 't1',
    tenantId: TENANT,
    nombre: 'Almuerzo',
    horaInicio: '12:00',
    horaFin: '16:00',
    activo: true,
    creadoEl: new Date('2026-01-01T00:00:00Z'),
    actualizadoEl: new Date('2026-01-01T00:00:00Z'),
    eliminadoEl: null,
    ...over,
  };
}

describe('TurnosService', () => {
  let service: TurnosService;
  let repo: Repo;

  beforeEach(async () => {
    repo = makeRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TurnosService,
        { provide: getRepositoryToken(Turno), useValue: repo },
      ],
    }).compile();
    service = module.get<TurnosService>(TurnosService);
  });

  it('crea un turno con horaInicio/horaFin', async () => {
    repo.findOne.mockResolvedValue(null);
    const saved = turno({
      id: 't-new',
      nombre: 'Cena',
      horaInicio: '19:00',
      horaFin: '23:00',
    });
    repo.save.mockResolvedValue(saved);

    const result = await service.crear(TENANT, {
      nombre: 'Cena',
      horaInicio: '19:00',
      horaFin: '23:00',
    });

    expect(repo.create).toHaveBeenCalledWith({
      tenantId: TENANT,
      nombre: 'Cena',
      horaInicio: '19:00',
      horaFin: '23:00',
      activo: true,
    });
    expect(result).toEqual({
      id: 't-new',
      nombre: 'Cena',
      horaInicio: '19:00',
      horaFin: '23:00',
      activo: true,
      creadoEl: saved.creadoEl,
      actualizadoEl: saved.actualizadoEl,
    });
    expect(result).not.toHaveProperty('tenantId');
    expect(result).not.toHaveProperty('eliminadoEl');
  });

  it('rechaza nombre duplicado en el tenant', async () => {
    repo.findOne.mockResolvedValue(turno({ nombre: 'Almuerzo' }));

    await expect(
      service.crear(TENANT, {
        nombre: 'Almuerzo',
        horaInicio: '12:00',
        horaFin: '16:00',
      }),
    ).rejects.toThrow(ConflictException);

    await expect(
      service.crear(TENANT, {
        nombre: 'Almuerzo',
        horaInicio: '12:00',
        horaFin: '16:00',
      }),
    ).rejects.toThrow('Ya existe un turno con ese nombre');
  });

  it('listar ordena por nombre ASC y no expone eliminados (repo soft-delete)', async () => {
    const rows = [
      turno({ id: 't1', nombre: 'Almuerzo' }),
      turno({ id: 't2', nombre: 'Cena' }),
    ];
    repo.find.mockResolvedValue(rows);

    const result = await service.listar(TENANT);

    expect(repo.find).toHaveBeenCalledWith({
      where: { tenantId: TENANT },
      order: { nombre: 'ASC' },
    });
    expect(result.map((t) => t.nombre)).toEqual(['Almuerzo', 'Cena']);
    expect(result[0]).not.toHaveProperty('eliminadoEl');
  });

  it('actualizar cambia nombre/activo/horarios', async () => {
    const existing = turno();
    repo.findOne
      .mockResolvedValueOnce(existing) // getOrThrow
      .mockResolvedValueOnce(null); // check duplicado nombre
    const updated = turno({
      nombre: 'Brunch',
      horaInicio: '10:00',
      horaFin: '14:00',
      activo: false,
    });
    repo.save.mockResolvedValue(updated);

    const result = await service.actualizar(TENANT, 't1', {
      nombre: 'Brunch',
      horaInicio: '10:00',
      horaFin: '14:00',
      activo: false,
    });

    expect(result.nombre).toBe('Brunch');
    expect(result.horaInicio).toBe('10:00');
    expect(result.horaFin).toBe('14:00');
    expect(result.activo).toBe(false);
  });

  it('eliminar hace softDelete', async () => {
    repo.findOne.mockResolvedValue(turno());

    await service.eliminar(TENANT, 't1');

    expect(repo.softDelete).toHaveBeenCalledWith({ id: 't1', tenantId: TENANT });
  });

  it('getActivoOrThrow lanza 400 si inactivo o inexistente', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.getActivoOrThrow(TENANT, 'missing')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getActivoOrThrow(TENANT, 'missing')).rejects.toThrow(
      'Turno inválido o inactivo',
    );

    repo.findOne.mockResolvedValue(turno({ activo: false }));
    await expect(service.getActivoOrThrow(TENANT, 't1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.getActivoOrThrow(TENANT, 't1')).rejects.toThrow(
      'Turno inválido o inactivo',
    );
  });

  it('actualizar rechaza nombre duplicado de otro turno', async () => {
    repo.findOne
      .mockResolvedValueOnce(turno({ id: 't1', nombre: 'Almuerzo' }))
      .mockResolvedValueOnce(turno({ id: 't2', nombre: 'Cena' }));

    await expect(
      service.actualizar(TENANT, 't1', { nombre: 'Cena' }),
    ).rejects.toThrow('Ya existe un turno con ese nombre');
  });

  it('eliminar lanza NotFound si no existe', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.eliminar(TENANT, 'missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
