import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import { GarzonesService } from './garzones.service';
import { RolesService } from '../roles/roles.service';
import { Garzon } from './entities/garzon.entity';
import { GarzonPinEvento } from './entities/garzon-pin-evento.entity';
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
  // `resolverGarzonActuante`/`assertVinculable` consultan por SQL crudo a
  // través del manager del repo — eso no cambió con la Task 2.
  manager: { query: jest.Mock };
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
    manager: { query: jest.fn().mockResolvedValue([]) },
  };
}

function makeSesionRepo(): SesionRepo {
  return {
    count: jest.fn().mockResolvedValue(0),
  };
}

/**
 * `guardarConEvento` solo abre `dataSource.transaction` cuando hay un evento
 * de PIN que registrar (sin evento usa `garzonRepo.save` plano — ver comentario
 * en el service). `eventos` es la sonda del test: discrimina qué filas son de
 * `GarzonPinEvento` por la **clase** que `guardarConEvento` le pasa a
 * `m.save`/`m.create`, no por la forma del payload — `Garzon` también tiene un
 * campo `tipo` (`TipoGarzon`), así que distinguir por esa clave habría
 * empujado cada guardado de garzón al array de eventos.
 */
function makeDataSource(): {
  dataSource: { query: jest.Mock; transaction: jest.Mock };
  manager: { save: jest.Mock; create: jest.Mock };
  eventos: Record<string, unknown>[];
} {
  const eventos: Record<string, unknown>[] = [];
  const manager = {
    save: jest.fn((entity: unknown, row: Record<string, unknown>) => {
      if (entity === GarzonPinEvento) eventos.push(row);
      return Promise.resolve(row);
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({
      ...data,
    })),
  };
  const dataSource = {
    query: jest.fn().mockResolvedValue([]),
    transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
  };
  return { dataSource, manager, eventos };
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
    usuarioId: null,
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
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let manager: { save: jest.Mock; create: jest.Mock };
  let eventos: Record<string, unknown>[];
  let roles: { otorgarOperarSalon: jest.Mock };

  beforeEach(async () => {
    repo = makeRepo();
    sesionRepo = makeSesionRepo();
    roles = { otorgarOperarSalon: jest.fn() };
    ({ dataSource, manager, eventos } = makeDataSource());
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GarzonesService,
        { provide: getRepositoryToken(Garzon), useValue: repo },
        { provide: getRepositoryToken(SesionGarzon), useValue: sesionRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: RolesService, useValue: roles },
      ],
    }).compile();
    service = module.get<GarzonesService>(GarzonesService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * El garzón efectivamente guardado, sin importar si `guardarConEvento`
   * tomó el `save` plano (`repo.save(garzon)`, 1 argumento — sin evento) o
   * la transacción (`manager.save(Garzon, garzon)`, 2 argumentos — con
   * evento). Cuál de los dos caminos corre es JUSTAMENTE lo que cambia si
   * se rompe el guard `garzon.usuarioId === null` de `actualizar()` (o el
   * `tieneCuenta` de `regenerarPin()`): indexar un solo camino a ciegas
   * hace que el test se caiga con un `TypeError` bajo el mutante, en vez de
   * fallar por la aserción que importa.
   */
  function garzonGuardado(): Garzon {
    const plano = repo.save.mock.calls[0]?.[0] as Garzon | undefined;
    const enTx = manager.save.mock.calls.find(
      ([entity]: [unknown, unknown]) => entity === Garzon,
    )?.[1] as Garzon | undefined;
    const g = plano ?? enTx;
    if (!g) {
      throw new Error(
        'garzonGuardado(): no se guardó ningún Garzon ni por repo.save ' +
          'ni por la transacción de dataSource — ¿el test disparó una ' +
          'excepción antes de llegar a guardarConEvento?',
      );
    }
    return g;
  }

  describe('crear', () => {
    it('genera un PIN de 6 dígitos, lo hashea y lo devuelve una sola vez', async () => {
      const result = await service.crear(TENANT, USUARIO_ID, { nombre: 'Ana' });

      expect(result.pin).toMatch(/^\d{6}$/);
      // Alta SIN cuenta emite PIN → hay evento que registrar → pasa por la
      // transacción de `dataSource`, no por `repo.save` plano.
      const saved = manager.save.mock.calls[0][1] as Garzon;
      expect(saved.pinHash).not.toBe(result.pin);
      expect(await bcrypt.compare(result.pin as string, saved.pinHash)).toBe(
        true,
      );
      expect(result).not.toHaveProperty('pinHash');
      expect(result.nombre).toBe('Ana');
    });

    it('crear persiste tipo cocina', async () => {
      const result = await service.crear(TENANT, USUARIO_ID, {
        nombre: 'Ana',
        tipo: TipoGarzon.COCINA,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: TipoGarzon.COCINA }),
      );
      expect(result.tipo).toBe(TipoGarzon.COCINA);
    });

    it('crear sin tipo usa garzon por defecto', async () => {
      await service.crear(TENANT, USUARIO_ID, { nombre: 'Pedro' });

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

      const result = await service.crear(TENANT, USUARIO_ID, {
        nombre: 'Bruno',
      });

      expect(result.pin).toBe('654321');
      const saved = manager.save.mock.calls[0][1] as Garzon;
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

  describe('resolverGarzonActuante', () => {
    const CREDENCIAL = { garzonId: 'g1', pin: '111111' };

    /** Lo que devuelve el JOIN de `usuarios_tenants` con `garzones`. */
    function fila(over: { es_totem?: boolean; garzon_id?: string | null }) {
      return [{ es_totem: false, garzon_id: null, ...over }];
    }

    it('con la cuenta vinculada a un garzón, resuelve por JWT y NO toca el PIN', async () => {
      repo.manager.query.mockResolvedValue(fila({ garzon_id: 'g-personal' }));
      const vinculado = garzon({ id: 'g-personal', nombre: 'Ana' });
      repo.findOneOrFail.mockResolvedValue(vinculado);

      const result = await service.resolverGarzonActuante(
        TENANT,
        USUARIO_ID,
        {},
      );

      expect(result).toBe(vinculado);
      // El punto entero de la fase: sin bcrypt. `verificarPin` busca con
      // `findOne`, así que si se hubiera llamado, esto no sería 0.
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    // Un tótem es un dispositivo compartido y desatendido: quién lo está usando
    // no se puede presumir del JWT, y por eso el marcador gana sobre el vínculo.
    it('con la cuenta marcada tótem pide PIN AUNQUE tenga un garzón vinculado', async () => {
      repo.manager.query.mockResolvedValue(
        fila({ es_totem: true, garzon_id: 'g-personal' }),
      );
      const g = garzon({ id: 'g1', pin: '111111' });
      repo.findOne.mockResolvedValue(g);

      const result = await service.resolverGarzonActuante(
        TENANT,
        USUARIO_ID,
        CREDENCIAL,
      );

      // Resolvió por el PIN de la credencial, no por el vínculo.
      expect(result.id).toBe('g1');
      expect(repo.findOne).toHaveBeenCalled();
    });

    it('sin vínculo, verifica el PIN como siempre', async () => {
      repo.manager.query.mockResolvedValue(fila({}));
      const g = garzon({ id: 'g1', pin: '111111' });
      repo.findOne.mockResolvedValue(g);

      await expect(
        service.resolverGarzonActuante(TENANT, USUARIO_ID, CREDENCIAL),
      ).resolves.toBe(g);
    });

    // ⚠️ EL test de la fase. `garzonId` y `pin` son opcionales en el DTO porque
    // en modo personal no se mandan, así que el `ValidationPipe` deja pasar un
    // body vacío. Si esta rama se cae, cualquiera con `Salones:Operar` opera
    // como cualquier garzón en los 6 lugares donde se pide PIN, sin teclearlo.
    it('sin vínculo y SIN credencial corta con 400, no deja operar', async () => {
      repo.manager.query.mockResolvedValue(fila({}));

      await expect(
        service.resolverGarzonActuante(TENANT, USUARIO_ID, {}),
      ).rejects.toThrow('Elegí el garzón e ingresá su PIN');
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('el PIN a medias tampoco pasa: garzón elegido sin PIN es 400', async () => {
      repo.manager.query.mockResolvedValue(fila({}));

      await expect(
        service.resolverGarzonActuante(TENANT, USUARIO_ID, { garzonId: 'g1' }),
      ).rejects.toThrow('Elegí el garzón e ingresá su PIN');
    });

    // Una cuenta que no es miembro del tenant no tiene fila: no puede caer en
    // la rama personal por omisión.
    it('sin fila de membresía exige credencial', async () => {
      repo.manager.query.mockResolvedValue([]);

      await expect(
        service.resolverGarzonActuante(TENANT, USUARIO_ID, {}),
      ).rejects.toThrow('Elegí el garzón e ingresá su PIN');
    });

    it('resuelve el modo en UNA sola consulta, no una por rama', async () => {
      repo.manager.query.mockResolvedValue(fila({ garzon_id: 'g-personal' }));
      repo.findOneOrFail.mockResolvedValue(garzon({ id: 'g-personal' }));

      await service.resolverGarzonActuante(TENANT, USUARIO_ID, {});

      // Corre en el camino caliente —~60 veces por turno de 30 mesas— así que
      // un round trip de más se paga en cada apertura y cierre de cuenta.
      expect(repo.manager.query).toHaveBeenCalledTimes(1);
    });

    it('acota la consulta al tenant del token', async () => {
      repo.manager.query.mockResolvedValue(fila({}));

      await expect(
        service.resolverGarzonActuante(TENANT, USUARIO_ID, {}),
      ).rejects.toThrow('Elegí el garzón e ingresá su PIN');

      const [, params] = repo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params).toEqual([USUARIO_ID, TENANT]);
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
    const ACTOR = 'encargado-uuid';

    it('genera un PIN nuevo, re-hashea y lo devuelve una sola vez', async () => {
      const g = garzon({ id: 'g1', pin: '111111', usuarioId: null });
      repo.findOne.mockResolvedValue(g);
      repo.find.mockResolvedValue([g]);

      const result = await service.regenerarPin(TENANT, ACTOR, 'g1');

      expect(result.pin).toMatch(/^\d{6}$/);
      const saved = garzonGuardado();
      // `regenerarPin` SIN cuenta siempre devuelve un PIN, nunca `null`. El
      // cast solo refleja eso, no relaja el chequeo.
      expect(await bcrypt.compare(result.pin as string, saved.pinHash)).toBe(
        true,
      );
    });

    // Decisión del owner (2026-08-07): advertir, no bloquear. Rotar una
    // credencial es la respuesta correcta a una filtración; trabarla porque hay
    // un turno abierto sería la política al revés. Pero el admin tiene que ver
    // en el momento que deja al garzón sin poder marcar salida.
    it('con sesión abierta regenera igual, y avisa que lo deja sin operar', async () => {
      const g = garzon({
        id: 'g1',
        nombre: 'Ana',
        pin: '111111',
        usuarioId: null,
      });
      repo.findOne.mockResolvedValue(g);
      repo.find.mockResolvedValue([g]);
      sesionRepo.count.mockResolvedValue(1);

      const result = await service.regenerarPin(TENANT, ACTOR, 'g1');

      expect(result.pin).toMatch(/^\d{6}$/);
      // "regenera igual": la advertencia no basta, tiene que haber persistido
      // el hash del PIN nuevo (no solo devuelto en la respuesta).
      const saved = garzonGuardado();
      expect(await bcrypt.compare(result.pin as string, saved.pinHash)).toBe(
        true,
      );
      expect(result.advertencias).toHaveLength(1);
      expect(result.advertencias[0]).toContain('Ana');
      expect(result.advertencias[0]).toContain('marcar salida');
    });

    it('sin sesión abierta no inventa advertencias', async () => {
      const g = garzon({ id: 'g1', pin: '111111', usuarioId: null });
      repo.findOne.mockResolvedValue(g);
      repo.find.mockResolvedValue([g]);

      expect(
        (await service.regenerarPin(TENANT, ACTOR, 'g1')).advertencias,
      ).toEqual([]);
    });

    it('lanza NotFound si el garzón no existe en el tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.regenerarPin(TENANT, ACTOR, 'inexistente'),
      ).rejects.toThrow(NotFoundException);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'inexistente', tenantId: TENANT },
      });
    });
  });

  describe('regenerarPin se parte según el garzón', () => {
    const ACTOR = 'encargado-uuid';

    it('CON cuenta: invalida, no devuelve PIN, y lo registra', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', pin: '111111', usuarioId: 'cuenta-de-ana' }),
      );

      const res = await service.regenerarPin(TENANT, ACTOR, 'g1');

      expect(res.pin).toBeNull();
      expect(garzonGuardado().pinHash).toBe('!');
      expect(eventos).toEqual([
        expect.objectContaining({
          tipo: 'invalidado_por_encargado',
          usuarioId: ACTOR,
        }),
      ]);
    });

    it('SIN cuenta: genera y revela, como siempre', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', pin: '111111', usuarioId: null }),
      );

      const res = await service.regenerarPin(TENANT, ACTOR, 'g1');

      expect(res.pin).toMatch(/^\d{6}$/);
      expect(eventos).toEqual([
        expect.objectContaining({
          tipo: 'regenerado_por_encargado',
          usuarioId: ACTOR,
        }),
      ]);
    });

    it('en turno CON cuenta, el aviso no la da por bloqueada NI le promete el dispositivo propio', async () => {
      repo.findOne.mockResolvedValue(
        garzon({
          id: 'g1',
          nombre: 'Ana',
          pin: '111111',
          usuarioId: 'cuenta-de-ana',
        }),
      );
      sesionRepo.count.mockResolvedValue(1);

      const res = await service.regenerarPin(TENANT, ACTOR, 'g1');

      expect(res.advertencias).toHaveLength(1);
      expect(res.advertencias[0]).toContain('tótem');
      expect(res.advertencias[0]).not.toContain('marcar salida');
      // Revisión final 2026-08-15: el aviso tampoco puede prometer que
      // "opera desde su cuenta / sigue trabajando normal". Es cierto SOLO si
      // esa cuenta tiene `Salones:Operar`, y `regenerarPin` no lo consulta —
      // este mock no lo provee justamente porque el service no lo pide.
      // Revertir a la redacción anterior tiene que caer acá.
      expect(res.advertencias[0]).not.toMatch(
        /sigue trabajando|desde su cuenta|su dispositivo/,
      );
    });

    it('en turno SIN cuenta, el aviso sigue siendo el de siempre', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', nombre: 'Ana', pin: '111111', usuarioId: null }),
      );
      sesionRepo.count.mockResolvedValue(1);

      const res = await service.regenerarPin(TENANT, ACTOR, 'g1');

      expect(res.advertencias[0]).toContain('marcar salida');
    });

    // `habiaPin` es lo único que distingue, del lado de la RESPUESTA, "esto
    // destruyó una credencial real" de "no había nada que destruir" — el front
    // no puede confiar en lo que su propio listado en memoria creía saber
    // (revisión del 2026-08-14, ronda 4). El resultado técnico (`pin: null`,
    // `pinHash` en el centinela) es idéntico en los dos casos; `habiaPin` es
    // la única diferencia observable.
    it('CON cuenta y YA tenía un PIN puesto: habiaPin true', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', pin: '111111', usuarioId: 'cuenta-de-ana' }),
      );

      const res = await service.regenerarPin(TENANT, ACTOR, 'g1');

      expect(res.habiaPin).toBe(true);
    });

    it('CON cuenta y TODAVÍA no había puesto su PIN (centinela): habiaPin false', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', usuarioId: 'cuenta-de-ana', pinHash: '!' }),
      );

      const res = await service.regenerarPin(TENANT, ACTOR, 'g1');

      expect(res.habiaPin).toBe(false);
      // El resultado técnico es el mismo que arriba — sigue sin PIN. Solo
      // cambia lo que la respuesta dice que PASÓ.
      expect(res.pin).toBeNull();
      expect(garzonGuardado().pinHash).toBe('!');
    });
  });

  describe('listarEventosPin', () => {
    it('trae la historia con el nombre del actor en UNA consulta', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1' }));
      const filas = [
        {
          id: 'ev1',
          tipo: 'regenerado_por_encargado',
          usuarioNombre: 'encargado.paris',
          creadoEl: new Date(),
        },
      ];
      // Dos consultas ahora: la página y el total. Van en paralelo.
      repo.manager.query
        .mockResolvedValueOnce(filas)
        .mockResolvedValueOnce([{ total: 87 }]);

      const result = await service.listarEventosPin(TENANT, 'g1');

      expect(result).toEqual({ eventos: filas, total: 87 });
      expect(repo.manager.query).toHaveBeenCalledTimes(2);
      const [sql, params] = repo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('LEFT JOIN usuarios');
      expect(sql).toContain('e.tenant_id = $1');
      expect(sql).toContain('e.eliminado_el IS NULL');
      expect(params).toEqual([TENANT, 'g1', 50]);
    });

    // `garzon_pin_evento` solo crece y el diseño decidió guardar TODOS los
    // cambios, no solo el último. Sin tope, dos pantallas traían la tabla
    // entera en cada carga.
    it('topea la página con LIMIT y trae el total por separado', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1' }));
      repo.manager.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 200 }]);

      const result = await service.listarEventosPin(TENANT, 'g1');

      const [sqlPagina, paramsPagina] = repo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sqlPagina.replace(/\s+/g, ' ')).toContain(
        'ORDER BY e.creado_el DESC LIMIT $3',
      );
      expect(paramsPagina[2]).toBe(50);

      // El total es una consulta aparte y NO lleva el LIMIT: si lo llevara,
      // toparía en 50 y el aviso de la UI mentiría diciendo "50 de 50".
      const [sqlTotal] = repo.manager.query.mock.calls[1] as [string];
      expect(sqlTotal).toContain('COUNT(*)');
      expect(sqlTotal).not.toContain('LIMIT');
      expect(result.total).toBe(200);
    });

    it('lanza NotFound si el garzón no existe en el tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.listarEventosPin(TENANT, 'inexistente'),
      ).rejects.toThrow(NotFoundException);
      expect(repo.manager.query).not.toHaveBeenCalled();
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

      const result = await service.actualizar(TENANT, USUARIO_ID, 'g1', {
        tipo: TipoGarzon.COCINA,
      });

      expect(result.tipo).toBe(TipoGarzon.COCINA);
      // Sin `usuarioId` en el DTO no hay evento de PIN que registrar:
      // `guardarConEvento` toma el camino corto y guarda con `repo.save` plano.
      expect((repo.save.mock.calls[0] as [Garzon])[0].tipo).toBe(
        TipoGarzon.COCINA,
      );
    });

    it('cada campo se aplica solo si viene en el DTO', async () => {
      const g = garzon({ id: 'g1', tipo: TipoGarzon.GARZON });
      const nombreOriginal = g.nombre;
      repo.findOne.mockResolvedValue(g);

      await service.actualizar(TENANT, USUARIO_ID, 'g1', { activo: false });

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
        service.actualizar(TENANT, USUARIO_ID, 'g1', { activo: false }),
      ).rejects.toThrow(
        'No se puede desactivar un garzón con una sesión abierta',
      );
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('reactivar con sesión abierta no se bloquea: no saca a nadie de circulación', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1', activo: false }));
      sesionRepo.count.mockResolvedValue(1);

      const result = await service.actualizar(TENANT, USUARIO_ID, 'g1', {
        activo: true,
      });

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

      const result = await service.actualizar(TENANT, USUARIO_ID, 'g1', {
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

      const result = await service.actualizar(TENANT, USUARIO_ID, 'g1', {
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

      const result = await service.actualizar(TENANT, USUARIO_ID, 'g1', {
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

      await service.actualizar(TENANT, USUARIO_ID, 'g1', {
        activo: false,
        tipo: TipoGarzon.COCINA,
      });

      expect(sesionRepo.count).toHaveBeenCalledTimes(1);
    });

    it('cambiar solo el nombre no consulta sesiones', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1', activo: true }));

      await service.actualizar(TENANT, USUARIO_ID, 'g1', {
        nombre: 'Ana María',
      });

      expect(sesionRepo.count).not.toHaveBeenCalled();
    });

    it('lanza NotFound si el garzón no existe en el tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.actualizar(TENANT, USUARIO_ID, 'inexistente', { nombre: 'X' }),
      ).rejects.toThrow(NotFoundException);
      // El título dice "en el tenant": sin afirmar el `where`, el test pasaría
      // igual con la búsqueda acotada solo por id, que es editar el garzón de
      // otra empresa.
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: 'inexistente', tenantId: TENANT },
      });
    });
  });

  describe('el vínculo con una cuenta y el PIN', () => {
    const ACTOR = 'encargado-uuid';

    it('el alta CON cuenta no emite PIN y no escribe evento', async () => {
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_nombre: null, puede_operar_salon: true },
      ]);

      const res = await service.crear(TENANT, ACTOR, {
        nombre: 'Ana',
        usuarioId: 'cuenta-de-ana',
      });

      expect(res.pin).toBeNull();
      // Sin evento, `guardarConEvento` NO abre transacción: guarda con
      // `repo.save` plano. Si `manager.save` (el de `dataSource.transaction`)
      // se llamara acá, sería un BEGIN/COMMIT de más en la ruta de alta.
      expect(manager.save).not.toHaveBeenCalled();
      expect(eventos).toHaveLength(0);
      expect(garzonGuardado().pinHash).toBe('!');
      expect(res.advertencias).toEqual([]);
    });

    // Decisión del owner (2026-08-14): "toda vinculación" incluye el alta —
    // produce el mismo estado final (con cuenta, sin permiso de salón) que
    // vincular a un garzón vacío recién creado, así que advierte igual.
    it('el alta CON cuenta sin permiso para operar el salón advierte', async () => {
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_nombre: null, puede_operar_salon: false },
      ]);

      const res = await service.crear(TENANT, ACTOR, {
        nombre: 'Ana',
        usuarioId: 'cuenta-sin-salones',
      });

      expect(res.advertencias).toHaveLength(1);
      expect(res.advertencias[0]).toContain('permiso');
      expect(res.advertencias[0]).toContain('salón');
    });

    it('el alta SIN cuenta emite PIN y lo registra', async () => {
      const res = await service.crear(TENANT, ACTOR, { nombre: 'Bruno' });

      expect(res.pin).toMatch(/^\d{6}$/);
      expect(eventos).toEqual([
        expect.objectContaining({
          tenantId: TENANT,
          tipo: 'emitido_en_alta',
          usuarioId: ACTOR,
        }),
      ]);
    });

    it('el alta con cuenta llama assertVinculable y propaga el rechazo si esa cuenta ya está vinculada a otro garzón', async () => {
      // Mismo 409 que `actualizar()`: sin este chequeo en el alta, el admin
      // comería el 500 genérico de `uq_garzones_usuario_tenant` en vez del
      // mensaje que le dice qué garzón desvincular primero.
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_nombre: 'Bruno' },
      ]);

      await expect(
        service.crear(TENANT, ACTOR, {
          nombre: 'Ana',
          usuarioId: 'cuenta-ya-vinculada',
        }),
      ).rejects.toThrow(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('el alta con cuenta consulta assertVinculable con garzonId nulo ($3): la fila todavía no existe', async () => {
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_nombre: null },
      ]);

      await service.crear(TENANT, ACTOR, {
        nombre: 'Ana',
        usuarioId: 'cuenta-de-ana',
      });

      // `toHaveBeenCalledWith` en vez de indexar `mock.calls[0]` a ciegas: si
      // el mutante que borra el `assertVinculable(...)` del alta deja
      // `repo.manager.query` sin ninguna llamada, esto falla por su propio
      // mensaje de Jest en vez de un `TypeError` al destructurar `undefined`.
      // Sin el guard `$3::uuid IS NULL` en el SQL, mandar `null` acá haría que
      // `g.garzon_id <> $3` sea NULL para toda fila y el LEFT JOIN nunca
      // encontrara un garzón ya vinculado — el alta dejaría crear la colisión
      // que `uq_garzones_usuario_tenant` resuelve después con un 500.
      expect(repo.manager.query).toHaveBeenCalledWith(expect.any(String), [
        'cuenta-de-ana',
        TENANT,
        null,
      ]);
    });

    // La subconsulta de `puede_operar_salon` es una COPIA a mano del criterio
    // de `RbacService.userHasPermiso`, y por ser copia ya se desincronizó una
    // vez: cuando `RbacService` ató el tenant en sus JOIN, ésta quedó atrás y
    // hubo que traerla a mano (lo cazó una revisión, no un test). Esto es el
    // test que faltaba para que la próxima desincronización se ponga roja.
    it('la subconsulta de permisos ata `roles` y `tenant_modulos` al mismo tenant', async () => {
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_nombre: null, puede_operar_salon: true },
      ]);

      await service.crear(TENANT, ACTOR, {
        nombre: 'Ana',
        usuarioId: 'cuenta-de-ana',
      });

      const [sql] = repo.manager.query.mock.calls[0] as [string];
      const plano = sql.replace(/\s+/g, ' ');
      // Las DOS subconsultas de `roles` (la del rol fijo y la del JOIN
      // completo), no una: `-g` cuenta todas las ocurrencias.
      expect(
        plano.match(
          /JOIN roles r ON r\.rol_id = ru\.rol_id AND r\.tenant_id = ru\.tenant_id/g,
        ),
      ).toHaveLength(2);
      expect(plano).toMatch(
        /JOIN tenant_modulos tm ON tm\.modulo_tenant_id = mr\.modulo_tenant_id AND tm\.tenant_id = ru\.tenant_id/,
      );
    });

    it('vincular una cuenta invalida el PIN y lo registra', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', pin: '111111', usuarioId: null }),
      );
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_nombre: null },
      ]);

      await service.actualizar(TENANT, ACTOR, 'g1', {
        usuarioId: 'cuenta-de-ana',
      });

      expect(garzonGuardado().pinHash).toBe('!');
      expect(eventos).toEqual([
        expect.objectContaining({
          tenantId: TENANT,
          garzonId: 'g1',
          tipo: 'invalidado_por_vinculo',
          usuarioId: ACTOR,
        }),
      ]);
    });

    // Decisión del owner (2026-08-14): vincular con sesión abierta advierte,
    // NO bloquea — mismo criterio que `regenerarPin` ya aplicaba, pero el
    // TEXTO no puede ser el mismo string que esa rama (revisión
    // independiente): acá `vinculaCuenta` exige que la cuenta NO existiera
    // antes de este PATCH, así que en el instante del aviso la persona
    // TODAVÍA no operaba desde su cuenta — la sesión abierta que dispara
    // esto solo pudo abrirse por PIN. El texto tiene que hablar de la
    // capacidad que se abre a partir de ahora, no de una continuidad falsa.
    it('vincular con sesión abierta advierte sobre la capacidad nueva, no una continuidad falsa, y no bloquea', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', nombre: 'Ana', pin: '111111', usuarioId: null }),
      );
      // `puede_operar_salon: true` a propósito: aísla el caso de la sesión
      // abierta del caso de "la cuenta no puede operar el salón" (más
      // abajo), que es OTRA advertencia con su propio test.
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_nombre: null, puede_operar_salon: true },
      ]);
      sesionRepo.count.mockResolvedValue(1);

      const result = await service.actualizar(TENANT, ACTOR, 'g1', {
        usuarioId: 'cuenta-de-ana',
      });

      // No bloquea: guarda igual, con el PIN ya invalidado.
      expect(garzonGuardado().pinHash).toBe('!');
      expect(result.advertencias).toHaveLength(1);
      expect(result.advertencias[0]).toContain('Ana');
      expect(result.advertencias[0]).toContain('tótem');
      // Positivo: habla de la cuenta RECIÉN vinculada y de que no queda
      // bloqueado — capacidad nueva, no algo que ya venía haciendo.
      expect(result.advertencias[0]).toContain('recién vinculada');
      expect(result.advertencias[0]).toContain('no queda bloqueado');
      // Negativo: el bug que esto reemplaza decía "sigue trabajando normal"
      // — falso acá, porque antes de este PATCH la persona no tenía cuenta
      // y por lo tanto no podía estar operando desde ella.
      expect(result.advertencias[0]).not.toContain('sigue trabajando normal');
      // No es el mensaje de "marcar salida" que usa la vía SIN cuenta de
      // `regenerarPin`: con cuenta, la identidad pasa a probarla el JWT,
      // así que no deja de poder operar.
      expect(result.advertencias[0]).not.toContain('marcar salida');
    });

    it('vincular sin sesión abierta y con permiso para operar el salón no advierte nada', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', pin: '111111', usuarioId: null }),
      );
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_nombre: null, puede_operar_salon: true },
      ]);

      const result = await service.actualizar(TENANT, ACTOR, 'g1', {
        usuarioId: 'cuenta-de-ana',
      });

      expect(result.advertencias).toEqual([]);
    });

    // Decisión del owner (2026-08-14): `assertVinculable` valida membresía,
    // no-tótem y no-tomada, pero no valida `Salones:Operar` — el
    // contraejemplo real está en el propio repo
    // (`caja-testigo.e2e-spec.ts`, VENDEDOR: rol sin `Salones`). Vincular
    // sigue permitido (dar el permiso después es un flujo legítimo), pero
    // advierte — sin importar si hay sesión abierta: es sobre lo que la
    // cuenta puede hacer de acá en más.
    //
    // Lo que de verdad pierde (revisión independiente, medido contra el
    // código, no asumido): SOLO el modo personal (JWT, sin PIN) — el
    // `PermisosGuard` de los 6 puntos corre sobre la cuenta que LLAMA, y en
    // modo personal esa cuenta es la del garzón. Por el tótem sigue
    // pudiendo operar: `fijarMiPin` (`PATCH /garzones/mi-pin`) no exige
    // ningún permiso, y `verificarPin` no mira `usuario_id`, así que quien
    // llama por PIN es la cuenta del tótem (que sí tiene `Salones:Operar`),
    // no la del garzón. El texto tiene que decir las dos cosas: lo que
    // pierde (modo personal) Y lo que NO pierde (tótem con PIN propio) —
    // afirmar "no va a poder trabajar" a secas sería tan falso como el bug
    // que reemplaza.
    it('vincular una cuenta sin permiso para operar el salón advierte que pierde el modo personal, no el tótem', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', pin: '111111', usuarioId: null }),
      );
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_nombre: null, puede_operar_salon: false },
      ]);

      const result = await service.actualizar(TENANT, ACTOR, 'g1', {
        usuarioId: 'cuenta-sin-salones',
      });

      // No bloquea: guarda igual.
      expect(garzonGuardado().pinHash).toBe('!');
      expect(result.advertencias).toHaveLength(1);
      const msg = result.advertencias[0];
      // Positivo: dice específicamente "modo personal" (lo que SÍ pierde) y
      // que el tótem sigue disponible con un PIN propio.
      expect(msg).toContain('modo personal');
      expect(msg).toContain('tótem');
      expect(msg).toContain('permiso');
      expect(msg).toContain('salón');
      // Negativo: nunca "no va a poder trabajar" a secas — eso afirmaría
      // que el tótem también queda cerrado, y no es así.
      expect(msg).not.toContain('no va a poder trabajar');
    });

    // Las dos advertencias pueden darse JUNTAS, y no pueden contradecirse:
    // si la cuenta no puede operar el salón, la de sesión abierta no puede
    // seguir prometiendo "puede seguir trabajando desde la cuenta recién
    // vinculada" — pero TAMPOCO puede decir que se queda sin poder trabajar
    // del todo, porque el tótem con un PIN propio sigue abierto (mismo
    // hallazgo que el test de arriba). El texto lo tiene que decir bien.
    it('vincular sin permiso Y con sesión abierta: las dos advertencias conviven sin contradecirse, y ninguna promete de más ni de menos', async () => {
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', nombre: 'Ana', pin: '111111', usuarioId: null }),
      );
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_nombre: null, puede_operar_salon: false },
      ]);
      sesionRepo.count.mockResolvedValue(1);

      const result = await service.actualizar(TENANT, ACTOR, 'g1', {
        usuarioId: 'cuenta-sin-salones',
      });

      expect(result.advertencias).toHaveLength(2);
      const [permisoMsg, sesionMsg] = result.advertencias;
      expect(permisoMsg).toContain('permiso');
      expect(permisoMsg).toContain('modo personal');
      // La de sesión NO puede prometer continuidad que no existe (con
      // cuenta) si además no tiene permiso: nada de "puede seguir
      // trabajando desde la cuenta".
      expect(sesionMsg).not.toContain('puede seguir trabajando desde la');
      // Pero SÍ tiene que decir que el tótem sigue abierto — negarlo sería
      // tan falso como prometer la cuenta.
      expect(sesionMsg).toContain('tótem');
      expect(sesionMsg).toContain('PIN propio');
      expect(sesionMsg).not.toContain('sin poder trabajar');
    });

    it('DESVINCULAR no toca el PIN: el garzón sigue con el que eligió', async () => {
      const g = garzon({ id: 'g1', pin: '111111', usuarioId: 'cuenta-de-ana' });
      const hashOriginal = g.pinHash;
      repo.findOne.mockResolvedValue(g);

      await service.actualizar(TENANT, ACTOR, 'g1', { usuarioId: null });

      expect(garzonGuardado().pinHash).toBe(hashOriginal);
      expect(eventos).toHaveLength(0);
    });

    it('renombrar a un garzón ya vinculado no re-invalida su PIN', async () => {
      const g = garzon({ id: 'g1', pin: '111111', usuarioId: 'cuenta-de-ana' });
      const hashOriginal = g.pinHash;
      repo.findOne.mockResolvedValue(g);

      await service.actualizar(TENANT, ACTOR, 'g1', { nombre: 'Ana María' });

      expect(garzonGuardado().pinHash).toBe(hashOriginal);
      expect(eventos).toHaveLength(0);
    });

    // El caso que la UI ejecuta en CADA edición, no un extremo teórico:
    // `frontend/app/pages/configuracion/garzones.vue` manda `usuarioId` en
    // todo PATCH, incluso cuando no cambió. Sin el guard
    // `garzon.usuarioId === null` en el service, renombrar desde la pantalla
    // real le borraría el PIN al garzón y escribiría un
    // `invalidado_por_vinculo` falso en cada edición — el test de arriba
    // ("renombrar...") no lo prueba porque no manda `usuarioId`, y ese guard
    // queda sin cobertura.
    it('re-enviar el mismo usuarioId ya vinculado (como hace cada PATCH del formulario) no re-invalida el PIN', async () => {
      const g = garzon({ id: 'g1', pin: '111111', usuarioId: 'cuenta-de-ana' });
      const hashOriginal = g.pinHash;
      repo.findOne.mockResolvedValue(g);
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_nombre: null },
      ]);

      await service.actualizar(TENANT, ACTOR, 'g1', {
        usuarioId: 'cuenta-de-ana',
      });

      expect(garzonGuardado().pinHash).toBe(hashOriginal);
      expect(eventos).toHaveLength(0);
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

  describe('el garzón fija su propio PIN', () => {
    const CUENTA = 'cuenta-de-ana';
    const body = (pin: string) => ({ pin, confirmarPin: pin });

    beforeEach(() => {
      // `garzonPersonalDe` resuelve por SQL crudo: cuenta no-tótem con garzón vivo.
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_id: 'g1' },
      ]);
      repo.findOneOrFail.mockResolvedValue(
        garzon({ id: 'g1', usuarioId: CUENTA, pin: undefined }),
      );
      // `repo.findOne` NO participa del camino de `miPin`: `miGarzonOrThrow`
      // ya resuelve el garzón por `findOneOrFail`, y `miPin` llama
      // `eventosPinDe` directo (sin la re-confirmación de `getOrThrow`, que
      // es lo único que usa `repo.findOne`). Se deja mockeado igual como
      // default inofensivo por si algún test de este describe lo necesitara.
      repo.findOne.mockResolvedValue(garzon({ id: 'g1', usuarioId: CUENTA }));
    });

    it('guarda el hash del PIN elegido y lo registra a nombre del garzón', async () => {
      await service.fijarMiPin(TENANT, CUENTA, body('482915'));

      const guardado = garzonGuardado();
      expect(await bcrypt.compare('482915', guardado.pinHash)).toBe(true);
      expect(eventos).toEqual([
        expect.objectContaining({
          tipo: 'fijado_por_garzon',
          usuarioId: CUENTA,
        }),
      ]);
    });

    it('rechaza si la confirmación no coincide', async () => {
      await expect(
        service.fijarMiPin(TENANT, CUENTA, {
          pin: '482915',
          confirmarPin: '482916',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(eventos).toHaveLength(0);
    });

    it.each(['000000', '111111', '999999', '123456', '654321', '456789'])(
      'rechaza el PIN obvio %s',
      async (pin) => {
        await expect(
          service.fijarMiPin(TENANT, CUENTA, body(pin)),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('ACEPTA un PIN que ya usa otro garzón: la unicidad no aplica al elegido', async () => {
      // `pinYaUsado` recorre garzones vivos; si se consultara, encontraría match.
      repo.find.mockResolvedValue([garzon({ id: 'otro', pin: '482915' })]);

      await service.fijarMiPin(TENANT, CUENTA, body('482915'));

      expect(eventos).toHaveLength(1);
    });

    it('404 si la cuenta no es garzón en este tenant', async () => {
      repo.manager.query.mockResolvedValue([
        { es_totem: false, garzon_id: null },
      ]);

      await expect(
        service.fijarMiPin(TENANT, CUENTA, body('482915')),
      ).rejects.toThrow(NotFoundException);
    });

    // El override duro de `garzonPersonalDe`: un tótem es un dispositivo
    // compartido y desatendido, así que aunque la cuenta tenga un garzón
    // vinculado (`garzon_id: 'g1'`, no `null` — eso probaría el otro caso),
    // `es_totem: true` gana y corta con 404. Sin este test, invertir el `if`
    // de `garzonPersonalDe` dejaría que un tótem le fije el PIN a "su" garzón.
    it('404 si la cuenta es tótem, AUNQUE tenga un garzón vinculado', async () => {
      repo.manager.query.mockResolvedValue([
        { es_totem: true, garzon_id: 'g1' },
      ]);

      await expect(
        service.fijarMiPin(TENANT, CUENTA, body('482915')),
      ).rejects.toThrow(NotFoundException);
    });

    it('miPin también da 404 si la cuenta es tótem con garzón vinculado', async () => {
      repo.manager.query.mockResolvedValue([
        { es_totem: true, garzon_id: 'g1' },
      ]);

      await expect(service.miPin(TENANT, CUENTA)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('miPin dice que NO está fijado cuando el hash es el centinela', async () => {
      // `...rest` se esparce último en el helper `garzon()`, así que este
      // `pinHash` gana sobre el default.
      repo.findOneOrFail.mockResolvedValue(
        garzon({ id: 'g1', usuarioId: CUENTA, pinHash: '!' }),
      );
      repo.manager.query
        .mockResolvedValueOnce([{ es_totem: false, garzon_id: 'g1' }])
        .mockResolvedValueOnce([]);

      const res = await service.miPin(TENANT, CUENTA);

      expect(res.fijado).toBe(false);
    });

    // El garzón que `miGarzonOrThrow` ya resolvió es el mismo que la ruta
    // vieja volvía a buscar dentro de `listarEventosPin` (vía `getOrThrow`,
    // que usa `repo.findOne`). Esa cuarta consulta era redundante: sin
    // `repo.findOne` en el camino, `miPin` queda en tres.
    it('no vuelve a buscar el garzón que miGarzonOrThrow ya tiene en memoria', async () => {
      await service.miPin(TENANT, CUENTA);

      expect(repo.findOne).not.toHaveBeenCalled();
      // Las tres que sí corresponden: `garzonPersonalDe` (resolver el vínculo),
      // la página de eventos y su total. Ninguna de las tres es `repo.findOne`,
      // que es la que este cambio sacó del camino. Eran dos antes de que el
      // historial se topeara: el total es una consulta nueva y deliberada — sin
      // ella, la UI no puede decir "los últimos N de M" y recorta en silencio.
      expect(repo.manager.query).toHaveBeenCalledTimes(3);
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

  // `pinFijado` es el mismo booleano que `miPin()` ya calcula
  // (`pinHash !== PIN_INUTILIZABLE`), acá para la ficha del encargado. Sale
  // de la entidad que `listar()` YA trae completa — no dispara ninguna
  // consulta nueva ni por fila.
  describe('listar expone pinFijado', () => {
    it('CON PIN usable: pinFijado true', async () => {
      repo.find.mockResolvedValue([garzon({ id: 'g1', pin: '123456' })]);

      const [result] = await service.listar(TENANT);

      expect(result.pinFijado).toBe(true);
    });

    it('con el centinela (garzón con cuenta que todavía no fijó el suyo): pinFijado false', async () => {
      repo.find.mockResolvedValue([garzon({ id: 'g1', pinHash: '!' })]);

      const [result] = await service.listar(TENANT);

      expect(result.pinFijado).toBe(false);
    });
  });

  /**
   * Los dos hechos de la CUENTA que la ficha necesita para no mentir. Lo que
   * fijan estos tests no es el valor sino las tres decisiones que lo rodean:
   * que sin pedirlo no se paga, que pedirlo cuesta UNA query y no N, y que
   * "no se preguntó" (`null`) no se confunda con "se preguntó y da que no".
   */
  describe('listar con conPermisos', () => {
    it('SIN el flag no dispara ninguna consulta extra: las otras 5 pantallas que cargan este listado no lo pagan', async () => {
      repo.find.mockResolvedValue([
        garzon({ id: 'g1', usuarioId: 'u1' }),
        garzon({ id: 'g2', usuarioId: 'u2' }),
      ]);

      const result = await service.listar(TENANT);

      expect(repo.manager.query).not.toHaveBeenCalled();
      // Y los campos no viajan: `undefined` es "no se preguntó". Si salieran
      // en `false`, la ficha acusaría a una cuenta sana de no ser miembro.
      expect(result[0].cuentaEsMiembro).toBeUndefined();
      expect(result[0].puedeOperarSalon).toBeUndefined();
    });

    it('CON el flag son 2 consultas para N garzones, no N: los usuarios van en UN solo `unnest`', async () => {
      repo.find.mockResolvedValue([
        garzon({ id: 'g1', usuarioId: 'u1' }),
        garzon({ id: 'g2', usuarioId: 'u2' }),
        garzon({ id: 'g3', usuarioId: 'u3' }),
      ]);
      repo.manager.query.mockResolvedValue([
        { usuario_id: 'u1', es_miembro: true, puede_operar: true },
        { usuario_id: 'u2', es_miembro: true, puede_operar: false },
        { usuario_id: 'u3', es_miembro: true, puede_operar: true },
      ]);

      await service.listar(TENANT, false, true);

      // UNA sola llamada aunque sean tres garzones — es la aserción que cae si
      // alguien "simplifica" esto a un `for` con una consulta por fila.
      expect(repo.manager.query).toHaveBeenCalledTimes(1);
      const [, params] = repo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params[1]).toEqual(['u1', 'u2', 'u3']);
    });

    it('una cuenta que YA NO ES MIEMBRO vuelve en false, no ausente: es el estado que produce la baja "no sigue"', async () => {
      repo.find.mockResolvedValue([garzon({ id: 'g1', usuarioId: 'u1' })]);
      // `usuarios_tenants` no tiene fila viva para esa cuenta, así que el
      // EXISTS da false. La consulta igual devuelve la fila porque parte de
      // `unnest`, no de un JOIN contra la membresía.
      repo.manager.query.mockResolvedValue([
        { usuario_id: 'u1', es_miembro: false, puede_operar: false },
      ]);

      const [result] = await service.listar(TENANT, false, true);

      expect(result.cuentaEsMiembro).toBe(false);
    });

    it('un garzón SIN cuenta queda en null (no en false) y no entra en la consulta: no hay a quién preguntarle', async () => {
      repo.find.mockResolvedValue([
        garzon({ id: 'g1', usuarioId: null }),
        garzon({ id: 'g2', usuarioId: 'u2' }),
      ]);
      repo.manager.query.mockResolvedValue([
        { usuario_id: 'u2', es_miembro: true, puede_operar: true },
      ]);

      const [sinCuenta, conCuenta] = await service.listar(TENANT, false, true);

      expect(sinCuenta.cuentaEsMiembro).toBeNull();
      expect(sinCuenta.puedeOperarSalon).toBeNull();
      expect(conCuenta.cuentaEsMiembro).toBe(true);
      // El `null` no viaja al `unnest`: `uuid[]` lo rechazaría de plano.
      const [, params] = repo.manager.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(params[1]).toEqual(['u2']);
    });

    it('el flag vale también con incluirEliminados: la papelera es donde más cae el garzón dado de baja', async () => {
      const qbMock = {
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockResolvedValue({
          entities: [garzon({ id: 'g1', usuarioId: 'u1' })],
          raw: [{ g_eliminado_por_nombre: null }],
        }),
      };
      repo.createQueryBuilder.mockReturnValue(qbMock);
      repo.manager.query.mockResolvedValue([
        { usuario_id: 'u1', es_miembro: false, puede_operar: false },
      ]);

      const [result] = await service.listar(TENANT, true, true);

      expect(result.cuentaEsMiembro).toBe(false);
    });
  });

  describe('otorgarPermisoOperar', () => {
    it('le concede el permiso a la cuenta del garzón, y esa cuenta sale de la FILA, no del request', async () => {
      // El acotamiento de la ruta es justamente ese: el encargado dice a qué
      // garzón, no a qué usuario. Si el `usuarioId` viniera del request, el
      // camino puntual se volvería "conceder Salones:Operar a quien quieras".
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', usuarioId: 'cuenta-del-garzon' }),
      );

      await service.otorgarPermisoOperar(TENANT, 'g1');

      expect(roles.otorgarOperarSalon).toHaveBeenCalledWith(
        manager,
        TENANT,
        'cuenta-del-garzon',
      );
    });

    it('escribe DENTRO de una transacción', async () => {
      // Son cuatro escrituras (rol, modulos_roles, permiso, asignación) y a
      // medias no sirven: un rol de sistema sin su permiso es un rol que
      // concede nada, y el encargado creería que lo dio.
      repo.findOne.mockResolvedValue(
        garzon({ id: 'g1', usuarioId: 'cuenta-del-garzon' }),
      );

      await service.otorgarPermisoOperar(TENANT, 'g1');

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('un garzón sin cuenta vinculada no tiene a quién darle nada', async () => {
      repo.findOne.mockResolvedValue(garzon({ id: 'g1', usuarioId: null }));

      await expect(
        service.otorgarPermisoOperar(TENANT, 'g1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(roles.otorgarOperarSalon).not.toHaveBeenCalled();
    });

    it('un garzón de otro tenant es 404, no un otorgamiento cruzado', async () => {
      // `getOrThrow` acota por tenant; el mock devuelve null como lo haría el
      // repo real con el `where` del otro tenant.
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.otorgarPermisoOperar(TENANT, 'g-ajeno'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(roles.otorgarOperarSalon).not.toHaveBeenCalled();
    });
  });

  /**
   * Lo que ejecuta la decisión que el encargado tomó al dar de baja la cuenta
   * vinculada, dentro de la transacción de `TenantsService.removeMember`.
   *
   * ⚠️ **Estos casos NO se pueden montar desde un e2e**, y por eso viven acá.
   * La ventana que la relectura existe para cerrar es la que va entre la
   * lectura previa —que corre **fuera** de la transacción, para no retener la
   * conexión mientras se hashea el PIN— y el `BEGIN`. Un e2e que re-vincule el
   * garzón antes del `DELETE` no entra a esa ventana: `vinculadoA` devuelve
   * `null` y `removeMember` corta antes de llegar acá, así que el test pasa
   * con el bug puesto. Medido el 2026-08-16, escribiendo exactamente ese e2e.
   * Acá el `manager` es falso y el estado "el mundo se movió" se monta
   * directo, que es la única forma de ejercer la comparación.
   */
  describe('aplicarBajaDeCuenta — la relectura dentro de la transacción', () => {
    const OTRA_CUENTA = 'usuario-de-otra-persona';
    const PIN = { hash: 'hash-nuevo' };

    /** El `manager` que entrega `dataSource.transaction`, mínimo y observable. */
    function managerFalso(encontrado: Garzon | null) {
      return {
        findOne: jest.fn().mockResolvedValue(encontrado),
        save: jest.fn((_entidad: unknown, fila: unknown) =>
          Promise.resolve(fila),
        ),
        create: jest.fn((_entidad: unknown, fila: unknown) => fila),
      };
    }

    it('el garzón se re-vinculó a OTRA cuenta: no lo toca y avisa que no aplicó', async () => {
      // El caso que obliga a comparar en vez de solo mirar si hay vínculo, y
      // el más caro si se escapa: sin la comparación esta baja le arranca el
      // vínculo a un tercero y le entrega su PIN, en claro, a quien pidió la
      // baja de otra persona.
      const m = managerFalso(garzon({ id: 'g1', usuarioId: OTRA_CUENTA }));

      const aplicado = await service.aplicarBajaDeCuenta(
        m as never,
        TENANT,
        'g1',
        USUARIO_ID,
        'actor',
        PIN,
      );

      expect(aplicado.aplicado).toBe(false);
      expect(m.save).not.toHaveBeenCalled();
    });

    it('lo desvincularon en el medio: tampoco aplica', async () => {
      const m = managerFalso(garzon({ id: 'g1', usuarioId: null }));

      const aplicado = await service.aplicarBajaDeCuenta(
        m as never,
        TENANT,
        'g1',
        USUARIO_ID,
        'actor',
        PIN,
      );

      expect(aplicado.aplicado).toBe(false);
      expect(m.save).not.toHaveBeenCalled();
    });

    it('lo borraron en el medio: tampoco aplica', async () => {
      const m = managerFalso(null);

      const aplicado = await service.aplicarBajaDeCuenta(
        m as never,
        TENANT,
        'g1',
        USUARIO_ID,
        'actor',
        PIN,
      );

      expect(aplicado.aplicado).toBe(false);
      expect(m.save).not.toHaveBeenCalled();
    });

    it('sigue vinculado a ESA cuenta: desvincula, escribe el PIN y registra el evento', async () => {
      // El camino feliz, que es lo que hace falsables a los tres de arriba: sin
      // esto, un `return false` incondicional los pasaría a los tres.
      const m = managerFalso(garzon({ id: 'g1', usuarioId: USUARIO_ID }));

      const aplicado = await service.aplicarBajaDeCuenta(
        m as never,
        TENANT,
        'g1',
        USUARIO_ID,
        'actor',
        PIN,
      );

      expect(aplicado.aplicado).toBe(true);
      const guardado = m.save.mock.calls.find(
        ([entidad]: [unknown, unknown]) => entidad === Garzon,
      )?.[1] as Garzon;
      expect(guardado.usuarioId).toBeNull();
      expect(guardado.pinHash).toBe('hash-nuevo');
      const evento = m.save.mock.calls.find(
        ([entidad]: [unknown, unknown]) => entidad === GarzonPinEvento,
      )?.[1] as { tipo: string; usuarioId: string };
      expect(evento.tipo).toBe('regenerado_por_baja_de_cuenta');
      expect(evento.usuarioId).toBe('actor');
    });

    it('devuelve `garzonActivo: false` si el garzón ya estaba desactivado: ese PIN no va a operar', async () => {
      // Alcanzable sin nada raro: `actualizar()` deja desactivar un garzón
      // vinculado (no hay guard), y `verificarPin` filtra `activo: true`. Sin
      // este dato la baja devolvía un PIN en claro —la única vez que existe
      // fuera de la base— que no servía, y nadie se enteraba hasta tecleárselo.
      const m = managerFalso(
        garzon({ id: 'g1', usuarioId: USUARIO_ID, activo: false }),
      );

      const res = await service.aplicarBajaDeCuenta(
        m as never,
        TENANT,
        'g1',
        USUARIO_ID,
        'actor',
        PIN,
      );

      expect(res.aplicado).toBe(true);
      expect(res.garzonActivo).toBe(false);
    });

    it('se lee ANTES de escribir: `no-sigue` desactiva, y reportarlo después haría que toda baja avisara', async () => {
      // El orden es la conducta: `no-sigue` pone `activo = false` como su
      // efecto. Leyendo después, `garzonActivo` sería `false` SIEMPRE en esa
      // rama y el aviso perdería todo su significado.
      const m = managerFalso(
        garzon({ id: 'g1', usuarioId: USUARIO_ID, activo: true }),
      );

      const res = await service.aplicarBajaDeCuenta(
        m as never,
        TENANT,
        'g1',
        USUARIO_ID,
        'actor',
        null,
      );

      expect(res.garzonActivo).toBe(true);
      expect((m.save.mock.calls[0][1] as Garzon).activo).toBe(false);
    });

    it('"no sigue" desactiva sin tocar el vínculo ni el PIN, y sin escribir evento', async () => {
      // El vínculo sobrevive a propósito: es lo que hace reversible la salida.
      const m = managerFalso(
        garzon({ id: 'g1', usuarioId: USUARIO_ID, pin: '123456' }),
      );

      const aplicado = await service.aplicarBajaDeCuenta(
        m as never,
        TENANT,
        'g1',
        USUARIO_ID,
        'actor',
        null,
      );

      expect(aplicado.aplicado).toBe(true);
      const guardado = m.save.mock.calls[0][1] as Garzon;
      expect(guardado.activo).toBe(false);
      expect(guardado.usuarioId).toBe(USUARIO_ID);
      // Sin cambio de PIN no hay nada que registrar: el historial es de PIN, no
      // de altas y bajas.
      expect(
        m.save.mock.calls.some(
          ([entidad]: [unknown, unknown]) => entidad === GarzonPinEvento,
        ),
      ).toBe(false);
    });
  });
});

describe('GarzonesService.asegurarMostrador', () => {
  let service: GarzonesService;

  beforeEach(async () => {
    const repo = makeRepo();
    const sesionRepo = makeSesionRepo();
    // `asegurarMostrador` no pasa por `guardarConEvento`: recibe su propio
    // `manager` de transacción como parámetro. El `DataSource` mockeado acá
    // solo satisface la inyección del constructor, no lo usa ningún test de
    // este describe.
    const { dataSource } = makeDataSource();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GarzonesService,
        { provide: getRepositoryToken(Garzon), useValue: repo },
        { provide: getRepositoryToken(SesionGarzon), useValue: sesionRepo },
        { provide: DataSource, useValue: dataSource },
        // Solo para satisfacer la inyección: ningún test de este describe
        // otorga permisos.
        { provide: RolesService, useValue: { otorgarOperarSalon: jest.fn() } },
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
