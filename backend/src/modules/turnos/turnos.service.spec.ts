import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TurnosService } from './turnos.service';
import { Turno } from './entities/turno.entity';
import { SesionGarzon } from './entities/sesion-garzon.entity';

const TENANT = 'tenant-uuid';
const USUARIO_ID = 'usuario-uuid';

type Repo = {
  find: jest.Mock;
  findOne: jest.Mock;
  findOneOrFail: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  softDelete: jest.Mock;
  createQueryBuilder: jest.Mock;
};

type SesionRepo = {
  count: jest.Mock;
};

function makeRepo(): Repo {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    createQueryBuilder: jest.fn(),
  };
}

function makeSesionRepo(): SesionRepo {
  return {
    count: jest.fn().mockResolvedValue(0),
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
    eliminadoPor: null,
    ...over,
  };
}

describe('TurnosService', () => {
  let service: TurnosService;
  let repo: Repo;
  let sesionRepo: SesionRepo;

  beforeEach(async () => {
    repo = makeRepo();
    sesionRepo = makeSesionRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TurnosService,
        { provide: getRepositoryToken(Turno), useValue: repo },
        { provide: getRepositoryToken(SesionGarzon), useValue: sesionRepo },
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
      // `eliminadoEl` viaja siempre (null en un turno vivo): lo necesita la
      // papelera para distinguir "vivo" de "borrado" sin otra consulta.
      eliminadoEl: null,
    });
    expect(result).not.toHaveProperty('tenantId');
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

  it('listar ordena por nombre ASC (repo ya filtra soft-delete sin el flag)', async () => {
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
    expect(result[0].eliminadoEl).toBeNull();
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

  it('eliminar() registra quién borró y cuándo, en una sola escritura', async () => {
    repo.findOne.mockResolvedValue(turno());

    await service.eliminar(TENANT, USUARIO_ID, 't1');

    // Objeto exacto (no `objectContaining`): si `eliminadoEl` faltara del
    // payload, esta aserción debe fallar — es el corazón del soft delete, no
    // un detalle opcional de `eliminadoPor`.
    expect(repo.update).toHaveBeenCalledWith(
      { id: 't1', tenantId: TENANT },
      { eliminadoPor: USUARIO_ID, eliminadoEl: expect.any(Date) },
    );
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
    await expect(
      service.eliminar(TENANT, USUARIO_ID, 'missing'),
    ).rejects.toThrow(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('actualizar rechaza desactivar turno con sesiones abiertas', async () => {
    repo.findOne.mockResolvedValue(turno());
    sesionRepo.count.mockResolvedValue(2);

    await expect(
      service.actualizar(TENANT, 't1', { activo: false }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.actualizar(TENANT, 't1', { activo: false }),
    ).rejects.toThrow('No se puede modificar un turno con sesiones abiertas');

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('eliminar rechaza turno con sesiones abiertas', async () => {
    repo.findOne.mockResolvedValue(turno());
    sesionRepo.count.mockResolvedValue(1);

    await expect(service.eliminar(TENANT, USUARIO_ID, 't1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.eliminar(TENANT, USUARIO_ID, 't1')).rejects.toThrow(
      'No se puede modificar un turno con sesiones abiertas',
    );

    expect(repo.update).not.toHaveBeenCalled();
  });

  describe('restaurar', () => {
    it('restaurar() devuelve el turno RE-CONSULTADO tras el restore', async () => {
      repo.findOne.mockResolvedValue(
        turno({
          nombre: 'Almuerzo (en la papelera)',
          eliminadoEl: new Date(),
          eliminadoPor: USUARIO_ID,
        }),
      );
      repo.findOneOrFail.mockResolvedValue(
        turno({ nombre: 'Almuerzo', eliminadoEl: null }),
      );

      const restaurado = await service.restaurar(TENANT, 't1');

      expect(repo.update).toHaveBeenCalledWith(
        { id: 't1', tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null },
      );
      expect(repo.findOneOrFail).toHaveBeenCalledWith({
        where: { id: 't1', tenantId: TENANT },
      });
      expect(restaurado.eliminadoEl).toBeNull();
      expect(restaurado.nombre).toBe('Almuerzo');
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.restaurar(TENANT, 't1')).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('restaurar() un turno vivo (no eliminado) es 404', async () => {
      repo.findOne.mockResolvedValueOnce(turno({ eliminadoEl: null }));

      await expect(service.restaurar(TENANT, 't1')).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    // Revisión final: `turnos` no tiene índice único de nombre en la base
    // (medido: no hay `CREATE UNIQUE INDEX` sobre la tabla) — la unicidad la
    // garantiza `crear()`/`actualizar()` SOLO en código (`assertNombreUnico`).
    // `restaurar()` no la reusaba: se podía crear "Almuerzo", borrarlo, crear
    // OTRO "Almuerzo", y restaurar el viejo dejaba dos turnos vivos con el
    // mismo nombre.
    it('restaurar() con el nombre ya ocupado por un turno vivo es 400, no revive nada', async () => {
      repo.findOne
        .mockResolvedValueOnce(
          turno({
            id: 't1',
            nombre: 'Almuerzo',
            eliminadoEl: new Date(),
            eliminadoPor: USUARIO_ID,
          }),
        )
        .mockResolvedValueOnce(
          turno({ id: 't2', nombre: 'Almuerzo', eliminadoEl: null }),
        );

      await expect(service.restaurar(TENANT, 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('listar con incluirEliminados', () => {
    it('con el flag trae eliminados con el nombre de quien borró (vía getRawAndEntities)', async () => {
      const turnoEliminado = turno({
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      const qbMock = {
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockResolvedValue({
          entities: [turnoEliminado],
          raw: [{ t_eliminado_por_nombre: 'admin.paris' }],
        }),
      };
      repo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.listar(TENANT, true);

      // getMany() descarta los addSelect que no mapean a una columna de la
      // entity: el service debe usar getRawAndEntities() y fusionar a mano.
      expect(qbMock.getRawAndEntities).toHaveBeenCalled();
      expect(result[0]).toMatchObject({
        id: 't1',
        eliminadoPorNombre: 'admin.paris',
      });
    });
  });
});
