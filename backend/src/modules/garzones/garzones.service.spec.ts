import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { GarzonesService } from './garzones.service';
import { Garzon } from './entities/garzon.entity';
import { TipoGarzon } from './enums/tipo-garzon.enum';
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

/** Construye un garzón de prueba con el PIN ya hasheado. */
function garzon(over: Partial<Garzon> & { pin?: string }): Garzon {
  const { pin, ...rest } = over;
  return {
    id: 'g1',
    tenantId: TENANT,
    nombre: 'Ana',
    pinHash: pin ? bcrypt.hashSync(pin, 10) : 'x',
    activo: true,
    tipo: TipoGarzon.GARZON,
    esPlaceholder: false,
    creadoEl: new Date(),
    actualizadoEl: new Date(),
    eliminadoEl: null,
    eliminadoPor: null,
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

    it('crear persiste tipo cocina', async () => {
      const result = await service.crear(TENANT, {
        nombre: 'Ana',
        tipo: TipoGarzon.COCINA,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: TipoGarzon.COCINA }),
      );
      expect(result.tipo).toBe(TipoGarzon.COCINA);
    });

    it('crear sin tipo usa garzon por defecto', async () => {
      await service.crear(TENANT, { nombre: 'Pedro' });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: TipoGarzon.GARZON }),
      );
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

  describe('verificarPin', () => {
    it('devuelve el garzón cuando el PIN coincide, buscándolo por id y tenant', async () => {
      const g = garzon({ id: 'g2', nombre: 'Bruno', pin: '654321' });
      repo.findOne.mockResolvedValue(g);

      const result = await service.verificarPin(TENANT, 'g2', '654321');

      expect(result.id).toBe('g2');
      // El `activo: true` va en el WHERE y no en un chequeo posterior: sin él,
      // un garzón desactivado seguiría pudiendo operar con su PIN viejo.
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'g2', tenantId: TENANT, activo: true },
      });
    });

    // El motivo de todo el cambio. Con `find` + loop, N garzones eran N bcrypt
    // por intento (62,5 ms cada uno, medido). El fixture necesita **dos**
    // garzones: con uno solo, iterar y no iterar dan el mismo número y el test
    // pasaría por construcción.
    it('hace UNA sola consulta y no recorre a los demás garzones', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1', pin: '111111' }));
      repo.find.mockResolvedValue([
        garzon({ id: 'g1', pin: '111111' }),
        garzon({ id: 'g2', pin: '222222' }),
      ]);

      await service.verificarPin(TENANT, 'g1', '111111');

      expect(repo.findOne).toHaveBeenCalledTimes(1);
      expect(repo.find).not.toHaveBeenCalled();
    });

    it('lanza 400 si el PIN no coincide', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1', pin: '111111' }));

      await expect(
        service.verificarPin(TENANT, 'g1', '999999'),
      ).rejects.toThrow(BadRequestException);
    });

    // Mismo mensaje que el PIN incorrecto, a propósito: distinguirlos diría
    // "ese garzón no existe", que es información que no hace falta dar.
    it('lanza el MISMO 400 si el garzón no existe en el tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.verificarPin(TENANT, 'inexistente', '111111'),
      ).rejects.toThrow('PIN inválido');
    });
  });

  describe('listarParaSelector', () => {
    function qb(rows: { garzon_id: string; nombre: string }[]) {
      const mock = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      repo.createQueryBuilder.mockReturnValue(mock);
      return mock;
    }

    it('devuelve SOLO id y nombre', async () => {
      qb([{ garzon_id: 'g1', nombre: 'Ana' }]);

      const result = await service.listarParaSelector(TENANT, true);

      // Es la única lectura de garzones que ve alguien con `Salones:Operar` y
      // sin `Salones:Leer`: cualquier campo de más se le filtra.
      expect(result).toEqual([{ garzonId: 'g1', nombre: 'Ana' }]);
    });

    // Las dos variantes son complementarias, y confundirlas no da error: da la
    // lista equivocada. Por eso se afirma el operador, no solo el resultado.
    it.each([
      [true, 'EXISTS'],
      [false, 'NOT EXISTS'],
    ])('enTurno=%s usa %s sobre las sesiones abiertas', async (enTurno, op) => {
      const mock = qb([]);

      await service.listarParaSelector(TENANT, enTurno);

      const sql = mock.andWhere.mock.calls
        .map((c) => String(c[0]))
        .find((c) => c.includes('sesiones_garzon'));
      expect(sql).toBeDefined();
      expect(sql!.trimStart().startsWith(op)).toBe(true);
      expect(sql).toContain('s.eliminado_el IS NULL');
    });

    it('excluye al placeholder Mostrador, que no es una persona', async () => {
      const mock = qb([]);

      await service.listarParaSelector(TENANT, true);

      const condiciones = mock.andWhere.mock.calls.map((c) => String(c[0]));
      expect(condiciones).toContain('g.es_placeholder = false');
      expect(condiciones).toContain('g.activo = true');
      expect(condiciones).toContain('g.eliminado_el IS NULL');
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

    // Decisión del owner (2026-08-07): advertir, no bloquear. Rotar una
    // credencial es la respuesta correcta a una filtración; trabarla porque hay
    // un turno abierto sería la política al revés. Pero el admin tiene que ver
    // en el momento que deja al garzón sin poder marcar salida.
    it('con sesión abierta regenera igual, y avisa que lo deja sin operar', async () => {
      const g = garzon({ id: 'g1', nombre: 'Ana', pin: '111111' });
      repo.findOne.mockResolvedValue(g);
      repo.find.mockResolvedValue([g]);
      sesionRepo.count.mockResolvedValue(1);

      const result = await service.regenerarPin(TENANT, 'g1');

      expect(result.pin).toMatch(/^\d{6}$/);
      expect(repo.save).toHaveBeenCalled();
      expect(result.advertencias).toHaveLength(1);
      expect(result.advertencias[0]).toContain('Ana');
      expect(result.advertencias[0]).toContain('marcar salida');
    });

    it('sin sesión abierta no inventa advertencias', async () => {
      const g = garzon({ id: 'g1', pin: '111111' });
      repo.findOne.mockResolvedValue(g);
      repo.find.mockResolvedValue([g]);

      expect((await service.regenerarPin(TENANT, 'g1')).advertencias).toEqual(
        [],
      );
    });

    it('lanza NotFound si el garzón no existe en el tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.regenerarPin(TENANT, 'inexistente')).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'inexistente', tenantId: TENANT },
      });
    });
  });

  describe('actualizar', () => {
    it('aplica el cambio de tipo, que decide el grupo de reparto de propinas', async () => {
      // Es el ÚNICO método que mueve `tipo`, y ese valor se congela en cada
      // sesión que se abre después. Sin esto, un cambio de garzón a cocina se
      // guardaba en silencio como si nada y el reparto seguía yendo al grupo
      // viejo hasta que alguien lo notara contando plata.
      const g = garzon({ id: 'g1', tipo: TipoGarzon.GARZON });
      repo.findOne.mockResolvedValue(g);

      const result = await service.actualizar(TENANT, 'g1', {
        tipo: TipoGarzon.COCINA,
      });

      expect(result.tipo).toBe(TipoGarzon.COCINA);
      expect((repo.save.mock.calls[0] as [Garzon])[0].tipo).toBe(
        TipoGarzon.COCINA,
      );
    });

    it('cada campo se aplica solo si viene en el DTO', async () => {
      const g = garzon({ id: 'g1', tipo: TipoGarzon.GARZON });
      const nombreOriginal = g.nombre;
      repo.findOne.mockResolvedValue(g);

      await service.actualizar(TENANT, 'g1', { activo: false });

      const saved = (repo.save.mock.calls[0] as [Garzon])[0];
      expect(saved.activo).toBe(false);
      expect(saved.nombre).toBe(nombreOriginal);
      expect(saved.tipo).toBe(TipoGarzon.GARZON);
    });

    it('no deja desactivar a un garzón con sesión abierta', async () => {
      // `eliminar()` ya tenía este chequeo y `actualizar()` no: desactivar deja
      // al garzón sin poder cerrar su propia sesión, porque
      // `verificarPin` filtra `activo: true`.
      repo.findOne.mockResolvedValue(garzon({ id: 'g1', activo: true }));
      sesionRepo.count.mockResolvedValue(1);

      await expect(
        service.actualizar(TENANT, 'g1', { activo: false }),
      ).rejects.toThrow(
        'No se puede desactivar un garzón con una sesión abierta',
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('reactivar con sesión abierta no se bloquea: no saca a nadie de circulación', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1', activo: false }));
      sesionRepo.count.mockResolvedValue(1);

      const result = await service.actualizar(TENANT, 'g1', { activo: true });

      expect(result.activo).toBe(true);
    });

    // Decisión del owner (2026-08-07): el tipo advierte, NO bloquea como
    // `activo`. Desactivar rompe la operación del garzón ahora mismo; cambiarle
    // el tipo no rompe nada en el turno en curso, porque `sesion_garzon` se
    // quedó con el tipo del momento de abrir. Bloquear obligaría a cerrar el
    // turno para corregir un tipo mal cargado.
    it('cambiar el tipo con sesión abierta guarda igual, y avisa desde cuándo rige', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', nombre: 'Ana', tipo: TipoGarzon.GARZON }),
      );
      sesionRepo.count.mockResolvedValue(1);

      const result = await service.actualizar(TENANT, 'g1', {
        tipo: TipoGarzon.COCINA,
      });

      expect(result.tipo).toBe(TipoGarzon.COCINA);
      expect((repo.save.mock.calls[0] as [Garzon])[0].tipo).toBe(
        TipoGarzon.COCINA,
      );
      expect(result.advertencias).toHaveLength(1);
      // El mensaje nombra los dos tipos: sin el anterior, el admin no sabe qué
      // se sigue usando en el turno abierto.
      expect(result.advertencias[0]).toContain(TipoGarzon.GARZON);
      expect(result.advertencias[0]).toContain(TipoGarzon.COCINA);
    });

    it('cambiar el tipo sin sesión abierta no advierte nada', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', tipo: TipoGarzon.GARZON }),
      );

      const result = await service.actualizar(TENANT, 'g1', {
        tipo: TipoGarzon.COCINA,
      });

      expect(result.advertencias).toEqual([]);
    });

    // Los formularios mandan el objeto entero, así que `tipo` viene aunque el
    // usuario no lo haya tocado. Sin comparar contra el actual, cada cambio de
    // nombre con un turno abierto dispararía una advertencia falsa — y una
    // consulta de sesiones al pedo.
    it('mandar el mismo tipo no advierte ni consulta sesiones', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', tipo: TipoGarzon.COCINA }),
      );
      sesionRepo.count.mockResolvedValue(1);

      const result = await service.actualizar(TENANT, 'g1', {
        nombre: 'Ana María',
        tipo: TipoGarzon.COCINA,
      });

      expect(result.advertencias).toEqual([]);
      expect(sesionRepo.count).not.toHaveBeenCalled();
    });

    // Desactivar y cambiar el tipo preguntan lo mismo, y el formulario manda el
    // objeto entero: sin compartir el conteo, un PATCH que hace las dos cosas
    // corría la misma query dos veces.
    it('desactivar y cambiar el tipo a la vez consulta las sesiones UNA vez', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', activo: true, tipo: TipoGarzon.GARZON }),
      );

      await service.actualizar(TENANT, 'g1', {
        activo: false,
        tipo: TipoGarzon.COCINA,
      });

      expect(sesionRepo.count).toHaveBeenCalledTimes(1);
    });

    it('cambiar solo el nombre no consulta sesiones', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1', activo: true }));

      await service.actualizar(TENANT, 'g1', { nombre: 'Ana María' });

      expect(sesionRepo.count).not.toHaveBeenCalled();
    });

    it('lanza NotFound si el garzón no existe en el tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.actualizar(TENANT, 'inexistente', { nombre: 'X' }),
      ).rejects.toThrow(NotFoundException);
      // El título dice "en el tenant": sin afirmar el `where`, el test pasaría
      // igual con la búsqueda acotada solo por id, que es editar el garzón de
      // otra empresa.
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'inexistente', tenantId: TENANT },
      });
    });
  });

  describe('eliminar', () => {
    it('bloquea soft-delete si el garzón tiene sesión abierta', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1' }));
      sesionRepo.count.mockResolvedValue(1);

      await expect(service.eliminar(TENANT, USUARIO_ID, 'g1')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.eliminar(TENANT, USUARIO_ID, 'g1')).rejects.toThrow(
        'No se puede eliminar un garzón con una sesión abierta',
      );
      expect(sesionRepo.count).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT,
          garzonId: 'g1',
          estado: EstadoSesionGarzon.ABIERTA,
        },
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('eliminar() registra quién borró y cuándo, en una sola escritura', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1' }));
      sesionRepo.count.mockResolvedValue(0);

      await service.eliminar(TENANT, USUARIO_ID, 'g1');

      // Objeto exacto (no `objectContaining`): si `eliminadoEl` faltara del
      // payload, esta aserción debe fallar — es el corazón del soft delete,
      // no un detalle opcional de `eliminadoPor`.
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'g1', tenantId: TENANT },
        { eliminadoPor: USUARIO_ID, eliminadoEl: expect.any(Date) },
      );
    });
  });

  describe('restaurar', () => {
    it('restaurar() devuelve el garzón RE-CONSULTADO tras el restore', async () => {
      repo.findOne.mockResolvedValue(
        garzon({
          id: 'g1',
          nombre: 'Ana (en la papelera)',
          eliminadoEl: new Date(),
          eliminadoPor: USUARIO_ID,
        }),
      );
      repo.findOneOrFail.mockResolvedValue(
        garzon({ id: 'g1', nombre: 'Ana', eliminadoEl: null }),
      );

      const restaurado = await service.restaurar(TENANT, 'g1');

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'g1', tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null },
      );
      expect(repo.findOneOrFail).toHaveBeenCalledWith({
        where: { id: 'g1', tenantId: TENANT },
      });
      expect(restaurado.eliminadoEl).toBeNull();
      expect(restaurado.nombre).toBe('Ana');
      expect(restaurado).not.toHaveProperty('pinHash');
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.restaurar(TENANT, 'g1')).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('restaurar() un garzón vivo (no eliminado) es 404', async () => {
      repo.findOne.mockResolvedValueOnce(
        garzon({ id: 'g1', eliminadoEl: null }),
      );

      await expect(service.restaurar(TENANT, 'g1')).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('restaurar() el placeholder Mostrador cuando ya hay otro vivo es 400, no 500', async () => {
      // `uq_garzones_mostrador_tenant` es parcial (WHERE es_placeholder = true
      // AND eliminado_el IS NULL): un solo "Mostrador" vivo por tenant. Si
      // `asegurarMostrador()` ya creó uno nuevo mientras el viejo seguía en
      // la papelera, `restore()` dispara 23505 al revivirlo.
      repo.findOne.mockResolvedValue(
        garzon({
          id: 'g1',
          nombre: 'Mostrador',
          esPlaceholder: true,
          activo: false,
          eliminadoEl: new Date(),
          eliminadoPor: USUARIO_ID,
        }),
      );
      repo.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );

      await expect(service.restaurar(TENANT, 'g1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.findOneOrFail).not.toHaveBeenCalled();
    });

    it('restaurar() propaga cualquier otro error de Postgres tal cual (no lo traduce a 400)', async () => {
      repo.findOne.mockResolvedValue(
        garzon({
          id: 'g1',
          nombre: 'Ana',
          eliminadoEl: new Date(),
          eliminadoPor: USUARIO_ID,
        }),
      );
      const otroError = Object.assign(new Error('conexión perdida'), {
        code: '08006',
      });
      repo.update.mockRejectedValueOnce(otroError);

      await expect(service.restaurar(TENANT, 'g1')).rejects.toBe(otroError);
    });
  });

  describe('listar con incluirEliminados', () => {
    it('sin el flag no devuelve eliminados y excluye el placeholder', async () => {
      await service.listar(TENANT);

      expect(repo.find).toHaveBeenCalledWith({
        where: { tenantId: TENANT, esPlaceholder: false },
        order: { nombre: 'ASC' },
      });
    });

    it('con el flag trae eliminados con el nombre de quien borró (vía getRawAndEntities)', async () => {
      const garzonEliminado = garzon({
        id: 'g1',
        nombre: 'Ana',
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
          entities: [garzonEliminado],
          raw: [{ g_eliminado_por_nombre: 'admin.paris' }],
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
        '(g.eliminado_el IS NULL OR g.eliminado_por IS NOT NULL)',
      );
      // Y el ORDEN, que `toHaveBeenCalledWith` no mira: `where()` resetea
      // `expressionMap.wheres`, así que un `andWhere` que quede arriba se
      // descarta entero y el listado se queda sin filtro.
      expect(qbMock.andWhere.mock.invocationCallOrder[0]).toBeGreaterThan(
        qbMock.where.mock.invocationCallOrder[0],
      );
      expect(result[0]).toMatchObject({
        id: 'g1',
        eliminadoPorNombre: 'admin.paris',
      });
      expect(result[0]).not.toHaveProperty('pinHash');
    });
  });
});

describe('GarzonesService.asegurarMostrador', () => {
  let service: GarzonesService;

  beforeEach(async () => {
    const repo = makeRepo();
    const sesionRepo = makeSesionRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GarzonesService,
        { provide: getRepositoryToken(Garzon), useValue: repo },
        { provide: getRepositoryToken(SesionGarzon), useValue: sesionRepo },
      ],
    }).compile();
    service = module.get(GarzonesService);
  });

  function mockManager(existente: Partial<Garzon> | null) {
    return {
      findOne: jest.fn().mockResolvedValue(existente),
      create: jest
        .fn()
        .mockImplementation((_e: unknown, data: Record<string, unknown>) => ({
          ...data,
        })),
      save: jest
        .fn()
        .mockImplementation((_e: unknown, data: Record<string, unknown>) =>
          Promise.resolve({ id: 'mostrador-nuevo', ...data }),
        ),
    };
  }

  it('devuelve el placeholder existente sin crear otro', async () => {
    const manager = mockManager({ id: 'mostrador-1', esPlaceholder: true });
    const res = await service.asegurarMostrador(
      manager as unknown as EntityManager,
      't1',
    );
    expect(res.id).toBe('mostrador-1');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('crea el placeholder con atribución neutra si no existe', async () => {
    const manager = mockManager(null);
    const res = await service.asegurarMostrador(
      manager as unknown as EntityManager,
      't1',
    );
    expect(res.id).toBe('mostrador-nuevo');
    expect(manager.create).toHaveBeenCalledWith(
      Garzon,
      expect.objectContaining({
        tenantId: 't1',
        nombre: 'Mostrador',
        activo: false,
        esPlaceholder: true,
        pinHash: '!',
        tipo: TipoGarzon.GARZON,
      }),
    );
  });
});
