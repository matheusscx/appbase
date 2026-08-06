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
  /** El query builder que `createQueryBuilder()` devuelve por default. */
  qb: {
    select: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    getRawMany: jest.Mock;
    getExists: jest.Mock;
  };
};

type SesionRepo = {
  count: jest.Mock;
};

function makeRepo(): Repo {
  // `errorDeColisionNombre` (el helper compartido del 400 de colisión) arma su
  // propia query, así que `createQueryBuilder` tiene que devolver algo
  // encadenable por default o cualquier test que llegue al 400 explota con un
  // TypeError en vez de con la excepción que está probando.
  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
    // `assertNombreUnico` compara con `LOWER(...)`, así que necesita el
    // QueryBuilder: por default el nombre está libre.
    getExists: jest.fn().mockResolvedValue(false),
  };
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
    save: jest.fn((row: unknown) => Promise.resolve(row)),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
    softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
    createQueryBuilder: jest.fn(() => qb),
    qb,
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
    repo.qb.getExists.mockResolvedValue(true);

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
    repo.findOne.mockResolvedValueOnce(existing); // getOrThrow
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
    repo.findOne.mockResolvedValueOnce(turno({ id: 't1', nombre: 'Almuerzo' }));
    repo.qb.getExists.mockResolvedValue(true);

    await expect(
      service.actualizar(TENANT, 't1', { nombre: 'Cena' }),
    ).rejects.toThrow('Ya existe un turno con ese nombre');
    // El turno que se está editando queda excluido: si no, renombrarlo a lo que
    // ya se llama sería un falso duplicado contra sí mismo.
    expect(repo.qb.andWhere).toHaveBeenCalledWith('t.turno_id != :exceptId', {
      exceptId: 't1',
    });
  });

  // Decisión del owner (2026-08-01): la unicidad de nombre es case-insensitive
  // en los 8 recursos que la tienen (docs/PRODUCTO.md). Tiene que coincidir con
  // `uq_turnos_tenant_nombre_vivo`, que es sobre `lower(nombre)`: si comparara
  // exacto, el service aceptaría y el `save` moriría con un 23505.
  it('la unicidad de nombre ignora mayúsculas, igual que el índice', async () => {
    repo.qb.getExists.mockResolvedValue(true);

    await expect(
      service.crear(TENANT, {
        nombre: 'MAÑANA',
        horaInicio: '08:00',
        horaFin: '15:00',
      }),
    ).rejects.toThrow(ConflictException);
    expect(repo.qb.andWhere).toHaveBeenCalledWith(
      'LOWER(t.nombre) = LOWER(:nombre)',
      { nombre: 'MAÑANA' },
    );
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

  // `turnos` cubre la forma `repo.save()` de la red de colisión de nombre;
  // `descuentos` cubre la de transacción y `causas-merma` la de SQL crudo. La
  // semántica del helper vive en `nombre-sugerido.util.spec.ts`: acá se fija el
  // CABLEADO —que el wrapper esté y revalide el nombre correcto—, que es lo
  // único que puede romperse por módulo.
  describe('colisión de nombre perdida por carrera', () => {
    const err23505 = () =>
      Object.assign(new Error('duplicate key'), { code: '23505' });

    const nombresConsultados = (r: Repo) =>
      r.qb.andWhere.mock.calls
        .filter(([sql]) => String(sql).includes('LOWER(t.nombre)'))
        .map(([, params]) => (params as { nombre: string }).nombre);

    it('crear traduce el 23505 al 400 del pre-chequeo, con el mismo nombre', async () => {
      // Libre al pre-consultar, tomado al revalidar: esa es la carrera.
      repo.qb.getExists
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      repo.save.mockRejectedValueOnce(err23505());

      const promesa = service.crear(TENANT, {
        nombre: 'Mañana',
        horaInicio: '08:00',
        horaFin: '15:00',
      });
      // 409, no 400: cada módulo conserva su propio código porque el helper
      // reusa SU validador en vez de inventar un error nuevo.
      await expect(promesa).rejects.toThrow(ConflictException);
      await expect(promesa).rejects.toThrow(/Ya existe un turno/);
      expect(nombresConsultados(repo)).toEqual(['Mañana', 'Mañana']);
    });

    it('actualizar revalida el nombre nuevo excluyéndose a sí mismo', async () => {
      repo.findOne.mockResolvedValue(turno());
      repo.qb.getExists
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      repo.save.mockRejectedValueOnce(err23505());

      const promesa = service.actualizar(TENANT, 't1', { nombre: 'Mañana' });
      await expect(promesa).rejects.toThrow(/Ya existe un turno/);
      expect(nombresConsultados(repo)).toEqual(['Mañana', 'Mañana']);
      expect(
        repo.qb.andWhere.mock.calls.filter(([sql]) =>
          String(sql).includes('turno_id != :exceptId'),
        ),
      ).toHaveLength(2);
    });

    it('un error que no es 23505 sale tal cual', async () => {
      repo.qb.getExists.mockResolvedValue(false);
      repo.save.mockRejectedValueOnce(new Error('db caída'));

      await expect(
        service.crear(TENANT, {
          nombre: 'Mañana',
          horaInicio: '08:00',
          horaFin: '15:00',
        }),
      ).rejects.toThrow('db caída');
    });
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

    // `uq_turnos_tenant_nombre_vivo` es parcial (WHERE eliminado_el IS NULL):
    // mientras el turno estaba borrado, otro pudo tomar su nombre. El UPDATE que
    // lo revive vuelve a hacerlo competir y Postgres responde 23505. Sin
    // traducirlo, el usuario recibe un 500.
    it('restaurar() con el nombre ya ocupado por un turno vivo es 400, no 500', async () => {
      repo.findOne.mockResolvedValueOnce(
        turno({
          id: 't1',
          nombre: 'Almuerzo',
          eliminadoEl: new Date(),
          eliminadoPor: USUARIO_ID,
        }),
      );
      repo.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );

      await expect(service.restaurar(TENANT, 't1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // No debe intentar releer la fila si el restore falló.
      expect(repo.findOneOrFail).not.toHaveBeenCalled();
    });

    it('propaga un error de Postgres que no es 23505 sin traducirlo a 400', async () => {
      repo.findOne.mockResolvedValueOnce(
        turno({
          id: 't1',
          nombre: 'Almuerzo',
          eliminadoEl: new Date(),
          eliminadoPor: USUARIO_ID,
        }),
      );
      repo.update.mockRejectedValueOnce(
        Object.assign(new Error('deadlock detected'), { code: '40P01' }),
      );

      await expect(service.restaurar(TENANT, 't1')).rejects.toThrow(
        'deadlock detected',
      );
    });

    // El 400 no puede ser solo un "no se pudo": la pantalla precarga
    // `nombreSugerido` en el campo del modal, así que si el backend deja de
    // mandarlo el usuario vuelve a quedar adivinando qué nombre está libre.
    it('el 400 de colisión trae un nombre libre ya calculado, salteando los tomados', async () => {
      repo.findOne.mockResolvedValueOnce(
        turno({
          id: 't1',
          nombre: 'Almuerzo',
          eliminadoEl: new Date(),
          eliminadoPor: USUARIO_ID,
        }),
      );
      repo.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );
      repo.qb.getRawMany.mockResolvedValueOnce([
        { nombre: 'Almuerzo' },
        { nombre: 'Almuerzo 2' },
      ]);

      await expect(service.restaurar(TENANT, 't1')).rejects.toMatchObject({
        response: {
          message: 'Ya existe un turno activo con el nombre "Almuerzo".',
          nombreSugerido: 'Almuerzo 3',
        },
      });
    });

    // La sugerencia tiene que ignorar mayúsculas porque el índice es sobre
    // `lower(nombre)`: si propusiera un nombre que la base considera tomado, el
    // usuario confirmaría el modal y recibiría el mismo 400.
    it('la sugerencia saltea los tomados sin importar mayúsculas', async () => {
      repo.findOne.mockResolvedValueOnce(
        turno({
          id: 't1',
          nombre: 'Almuerzo',
          eliminadoEl: new Date(),
          eliminadoPor: USUARIO_ID,
        }),
      );
      repo.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );
      repo.qb.getRawMany.mockResolvedValueOnce([
        { nombre: 'ALMUERZO' },
        { nombre: 'almuerzo 2' },
      ]);

      await expect(service.restaurar(TENANT, 't1')).rejects.toMatchObject({
        response: { nombreSugerido: 'Almuerzo 3' },
      });
    });

    it('con `nombreNuevo` libre, restaura Y renombra en la misma escritura', async () => {
      repo.findOne.mockResolvedValueOnce(
        turno({
          id: 't1',
          nombre: 'Almuerzo',
          eliminadoEl: new Date(),
          eliminadoPor: USUARIO_ID,
        }),
      );
      repo.findOneOrFail.mockResolvedValue(
        turno({ id: 't1', nombre: 'Almuerzo 2', eliminadoEl: null }),
      );

      await service.restaurar(TENANT, 't1', 'Almuerzo 2');

      // Una sola escritura con las tres columnas: revivir y renombrar en dos
      // sentencias podría dejar la fila viva con el nombre que colisiona.
      expect(repo.update).toHaveBeenCalledWith(
        { id: 't1', tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null, nombre: 'Almuerzo 2' },
      );
    });

    it('sin `nombreNuevo` no toca el nombre (comportamiento de siempre)', async () => {
      repo.findOne
        .mockResolvedValueOnce(
          turno({
            id: 't1',
            nombre: 'Almuerzo',
            eliminadoEl: new Date(),
            eliminadoPor: USUARIO_ID,
          }),
        )
        .mockResolvedValueOnce(null);
      repo.findOneOrFail.mockResolvedValue(
        turno({ id: 't1', eliminadoEl: null }),
      );

      await service.restaurar(TENANT, 't1');

      expect(repo.update).toHaveBeenCalledWith(
        { id: 't1', tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null },
      );
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
      // Sin esta aserción el test no probaba nada de lo que su nombre dice:
      // borrando el `.andWhere(...)` del service la suite unitaria seguía
      // 100% verde y el agujero solo aparecía al levantar Postgres.
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        '(t.eliminado_el IS NULL OR t.eliminado_por IS NOT NULL)',
      );
      // Y el ORDEN, que `toHaveBeenCalledWith` no mira: `where()` resetea
      // `expressionMap.wheres`, así que un `andWhere` que quede arriba se
      // descarta entero y el listado se queda sin filtro.
      expect(qbMock.andWhere.mock.invocationCallOrder[0]).toBeGreaterThan(
        qbMock.where.mock.invocationCallOrder[0],
      );
      expect(result[0]).toMatchObject({
        id: 't1',
        eliminadoPorNombre: 'admin.paris',
      });
    });
  });
});
