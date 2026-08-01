import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RecargosService } from './recargos.service';
import { Recargo } from './entities/recargo.entity';
import { RecargoTramo } from './entities/recargo-tramo.entity';
import { RecargoMetodoPago } from './entities/recargo-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { CondicionTipo } from '../../common/enums/reglas.enums';

const TENANT = 'tenant-uuid';
const USUARIO_ID = 'usuario-uuid';

function makeTipo(codigo: string, clase: string = 'recargo') {
  return { id: `tipo-${codigo}`, codigo, clase, nombre: `Tipo ${codigo}` };
}

describe('RecargosService', () => {
  let service: RecargosService;
  let qbMock: {
    where: jest.Mock;
    andWhere: jest.Mock;
    getCount: jest.Mock;
    leftJoin: jest.Mock;
    addSelect: jest.Mock;
    withDeleted: jest.Mock;
    orderBy: jest.Mock;
    getRawAndEntities: jest.Mock;
  };
  let managerMock: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    softDelete: jest.Mock;
    update: jest.Mock;
  };
  let dataSourceMock: { transaction: jest.Mock };
  let recargoRepoMock: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let tipoReglaRepoMock: { findOne: jest.Mock; find: jest.Mock };
  let tramoRepoMock: { find: jest.Mock };
  let metodoPagoRepoMock: { find: jest.Mock };

  beforeEach(async () => {
    qbMock = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
    };

    managerMock = {
      create: jest.fn((_, data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((e: unknown) => Promise.resolve(e)),
      delete: jest.fn().mockResolvedValue(undefined),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    dataSourceMock = {
      transaction: jest.fn((cb: (m: typeof managerMock) => Promise<unknown>) =>
        cb(managerMock),
      ),
    };

    recargoRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((e: unknown) => Promise.resolve(e)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qbMock),
    };

    tipoReglaRepoMock = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    tramoRepoMock = { find: jest.fn().mockResolvedValue([]) };
    metodoPagoRepoMock = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecargosService,
        { provide: getDataSourceToken(), useValue: dataSourceMock },
        { provide: getRepositoryToken(Recargo), useValue: recargoRepoMock },
        { provide: getRepositoryToken(TipoRegla), useValue: tipoReglaRepoMock },
        {
          provide: getRepositoryToken(RecargoTramo),
          useValue: tramoRepoMock,
        },
        {
          provide: getRepositoryToken(RecargoMetodoPago),
          useValue: metodoPagoRepoMock,
        },
      ],
    }).compile();

    service = module.get<RecargosService>(RecargosService);
  });

  // ─── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('rejects when tipoRegla does not exist', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(null);
      await expect(
        service.create(TENANT, { nombre: 'X', tipoReglaId: 'tr-x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when tipo clase is not recargo', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('pronto_pago', 'descuento'),
      );
      await expect(
        service.create(TENANT, {
          nombre: 'X',
          tipoReglaId: 'tipo-pronto_pago',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates general recargo with modo and valor', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      await service.create(TENANT, {
        nombre: 'Recargo general',
        tipoReglaId: 'tipo-general',
        valor: '0.05',
        modo: 'porcentaje',
      });
      expect(managerMock.save).toHaveBeenCalledTimes(1);
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({
        condicionTipo: CondicionTipo.NINGUNA,
        condicionValor: null,
      });
    });

    it('rejects general without valor', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      await expect(
        service.create(TENANT, {
          nombre: 'General sin valor',
          tipoReglaId: 'tipo-general',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates mora with diasVencimiento', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('mora'));
      await service.create(TENANT, {
        nombre: 'Mora',
        tipoReglaId: 'tipo-mora',
        diasVencimiento: 30,
        valor: '0.05',
        modo: 'porcentaje',
      });
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({
        condicionTipo: CondicionTipo.VENCIMIENTO,
        condicionValor: '30',
      });
    });

    it('rejects mora without diasVencimiento', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('mora'));
      await expect(
        service.create(TENANT, {
          nombre: 'Mora sin dias',
          tipoReglaId: 'tipo-mora',
          valor: '0.05',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects mora with diasVencimiento out of range (> 365)', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('mora'));
      await expect(
        service.create(TENANT, {
          nombre: 'Mora fuera rango',
          tipoReglaId: 'tipo-mora',
          diasVencimiento: 400,
          valor: '0.05',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates recargo_metodo_pago with metodoPagoIds', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      await service.create(TENANT, {
        nombre: 'Recargo MP',
        tipoReglaId: 'tipo-recargo_metodo_pago',
        metodoPagoIds: ['mp-1'],
        valor: '0.03',
        modo: 'porcentaje',
      });
      expect(managerMock.save).toHaveBeenCalledTimes(2);
      const [, metodoArgs] = managerMock.save.mock.calls as Array<[unknown[]]>;
      expect(metodoArgs[0]).toHaveLength(1);
    });

    it('rejects recargo_metodo_pago without metodoPagoIds', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );
      await expect(
        service.create(TENANT, {
          nombre: 'Recargo MP',
          tipoReglaId: 'tipo-recargo_metodo_pago',
          valor: '0.03',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates interes_simple and forces modo=porcentaje', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('interes_simple'));
      await service.create(TENANT, {
        nombre: 'Interés simple',
        tipoReglaId: 'tipo-interes_simple',
        valor: '0.02',
      });
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({ modo: 'porcentaje' });
    });

    it('creates interes_compuesto and forces modo=porcentaje', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('interes_compuesto'),
      );
      await service.create(TENANT, {
        nombre: 'Interés compuesto',
        tipoReglaId: 'tipo-interes_compuesto',
        valor: '0.02',
      });
      const createArgs = managerMock.create.mock.calls[0] as [
        unknown,
        Record<string, unknown>,
      ];
      expect(createArgs[1]).toMatchObject({ modo: 'porcentaje' });
    });

    it('rejects duplicate nombre', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      qbMock.getCount.mockResolvedValue(1);
      await expect(
        service.create(TENANT, {
          nombre: 'Existing',
          tipoReglaId: 'tipo-general',
          valor: '0.05',
          modo: 'porcentaje',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws NotFoundException when recargo not found', async () => {
      recargoRepoMock.findOne.mockResolvedValue(null);
      await expect(
        service.update(TENANT, 'x', { nombre: 'nuevo' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('replaces metodoPagoIds on update via soft-stamp', async () => {
      const existing = {
        id: 'r-1',
        tenantId: TENANT,
        nombre: 'Rec MP',
        tipoReglaId: 'tipo-recargo_metodo_pago',
        condicionValor: null,
        modo: 'porcentaje',
      };
      recargoRepoMock.findOne.mockResolvedValue(existing);
      tipoReglaRepoMock.findOne.mockResolvedValue(
        makeTipo('recargo_metodo_pago'),
      );

      await service.update(TENANT, 'r-1', {
        tipoReglaId: 'tipo-recargo_metodo_pago',
        metodoPagoIds: ['mp-5'],
        valor: '0.03',
        modo: 'porcentaje',
      });

      expect(managerMock.update).toHaveBeenCalledWith(
        RecargoMetodoPago,
        { recargoId: 'r-1' },
        expect.objectContaining({ eliminadoEl: expect.any(Date) }),
      );
      const typedCalls = managerMock.save.mock.calls as Array<[unknown[]]>;
      const lastCallArgs = typedCalls[typedCalls.length - 1];
      expect(lastCallArgs[0]).toHaveLength(1);
    });

    it('does not touch children when not in dto (partial update)', async () => {
      const existing = {
        id: 'r-2',
        tenantId: TENANT,
        nombre: 'Rec',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'porcentaje',
      };
      recargoRepoMock.findOne.mockResolvedValue(existing);
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await service.update(TENANT, 'r-2', { activo: false });

      expect(managerMock.softDelete).not.toHaveBeenCalled();
      expect(managerMock.update).not.toHaveBeenCalled();
    });
  });

  // ─── remove ───────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('throws NotFoundException when recargo not found', async () => {
      recargoRepoMock.findOne.mockResolvedValue(null);
      await expect(service.remove(TENANT, USUARIO_ID, 'x')).rejects.toThrow(
        NotFoundException,
      );
      expect(recargoRepoMock.update).not.toHaveBeenCalled();
    });

    it('remove() registra quién borró y cuándo, en una sola escritura', async () => {
      recargoRepoMock.findOne.mockResolvedValue({ id: 'r1', tenantId: TENANT });
      await service.remove(TENANT, USUARIO_ID, 'r1');
      // Objeto exacto (no `objectContaining`): si `eliminadoEl` faltara del
      // payload, esta aserción debe fallar — es el corazón del soft delete,
      // no un detalle opcional de `eliminadoPor`.
      expect(recargoRepoMock.update).toHaveBeenCalledWith(
        { id: 'r1', tenantId: TENANT },
        { eliminadoPor: USUARIO_ID, eliminadoEl: expect.any(Date) },
      );
    });
  });

  // ─── restaurar ──────────────────────────────────────────────────────────

  describe('restaurar', () => {
    it('restaurar() devuelve el recargo RE-CONSULTADO tras el restore', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Rec (en la papelera)',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.findOneOrFail.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Rec',
        eliminadoEl: null,
      });

      const restaurado = await service.restaurar(TENANT, 'r1');

      expect(recargoRepoMock.update).toHaveBeenCalledWith(
        { id: 'r1', tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null },
      );
      expect(recargoRepoMock.findOneOrFail).toHaveBeenCalledWith({
        where: { id: 'r1', tenantId: TENANT },
      });
      expect(restaurado.eliminadoEl).toBeNull();
      expect(restaurado.nombre).toBe('Rec');
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      recargoRepoMock.findOne.mockResolvedValueOnce(null);

      await expect(service.restaurar(TENANT, 'r1')).rejects.toThrow(
        NotFoundException,
      );
      expect(recargoRepoMock.update).not.toHaveBeenCalled();
    });

    it('restaurar() un recargo vivo (no eliminado) es 404', async () => {
      recargoRepoMock.findOne.mockResolvedValueOnce({
        id: 'r1',
        tenantId: TENANT,
        eliminadoEl: null,
      });

      await expect(service.restaurar(TENANT, 'r1')).rejects.toThrow(
        NotFoundException,
      );
      expect(recargoRepoMock.update).not.toHaveBeenCalled();
    });

    // Revisión final: `recargos` no tiene índice único de nombre en la base
    // (medido: no hay `CREATE UNIQUE INDEX` sobre la tabla) — la unicidad la
    // garantiza `create()`/`update()` SOLO en código (`validarNombreUnico`).
    // `restaurar()` no la reusaba: se podía crear "Black Friday", borrarlo,
    // crear OTRO "Black Friday", y restaurar el viejo dejaba dos recargos
    // vivos con el mismo nombre.
    it('restaurar() con el nombre ya ocupado por un recargo vivo es 400, no revive nada', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Black Friday',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      qbMock.getCount.mockResolvedValueOnce(1);

      await expect(service.restaurar(TENANT, 'r1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(recargoRepoMock.update).not.toHaveBeenCalled();
    });
  });

  // ─── findAll con incluirEliminados ────────────────────────────────────────

  describe('findAll con incluirEliminados', () => {
    it('sin el flag no devuelve eliminados', async () => {
      await service.findAll(TENANT);

      expect(recargoRepoMock.find).toHaveBeenCalledWith(
        expect.not.objectContaining({ withDeleted: true }),
      );
    });

    it('con el flag trae eliminados con el nombre de quien borró (vía getRawAndEntities)', async () => {
      const recargoEliminado = {
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Rec',
        tipoReglaId: 'tipo-x',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      };
      qbMock.getRawAndEntities.mockResolvedValue({
        entities: [recargoEliminado],
        raw: [{ r_eliminado_por_nombre: 'admin.paris' }],
      });

      const result = await service.findAll(TENANT, true);

      // getMany() descarta los addSelect que no mapean a una columna de la
      // entity: el service debe usar getRawAndEntities() y fusionar a mano.
      expect(qbMock.getRawAndEntities).toHaveBeenCalled();
      // Sin esta aserción el test no probaba nada de lo que su nombre dice:
      // borrando el `.andWhere(...)` del service la suite unitaria seguía
      // 100% verde y el agujero solo aparecía al levantar Postgres.
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        '(r.eliminado_el IS NULL OR r.eliminado_por IS NOT NULL)',
      );
      // Y el ORDEN, que `toHaveBeenCalledWith` no mira: `where()` resetea
      // `expressionMap.wheres`, así que un `andWhere` que quede arriba se
      // descarta entero y el listado se queda sin filtro.
      expect(qbMock.andWhere.mock.invocationCallOrder[0]).toBeGreaterThan(
        qbMock.where.mock.invocationCallOrder[0],
      );
      expect(result[0]).toMatchObject({
        id: 'r1',
        eliminadoPorNombre: 'admin.paris',
      });
    });
  });

  // ─── nombreDisponible ─────────────────────────────────────────────────────

  describe('nombreDisponible', () => {
    it('returns disponible:true when no match', async () => {
      qbMock.getCount.mockResolvedValue(0);
      const result = await service.nombreDisponible(TENANT, 'Nuevo');
      expect(result).toEqual({ disponible: true });
    });

    it('returns disponible:false when match exists', async () => {
      qbMock.getCount.mockResolvedValue(1);
      const result = await service.nombreDisponible(TENANT, 'Existente');
      expect(result).toEqual({ disponible: false });
    });

    it('adds excludeId condition when provided', async () => {
      qbMock.getCount.mockResolvedValue(0);
      await service.nombreDisponible(TENANT, 'Nombre', 'some-id');
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('recargo_id'),
        expect.objectContaining({ excludeId: 'some-id' }),
      );
    });
  });
});
