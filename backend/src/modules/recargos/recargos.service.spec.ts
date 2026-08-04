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
    select: jest.Mock;
    addSelect: jest.Mock;
    withDeleted: jest.Mock;
    orderBy: jest.Mock;
    getRawAndEntities: jest.Mock;
    getRawMany: jest.Mock;
  };
  let managerMock: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
    softDelete: jest.Mock;
    update: jest.Mock;
  };
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };
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
  let tramoRepoMock: { find: jest.Mock; count: jest.Mock };
  let metodoPagoRepoMock: { find: jest.Mock; count: jest.Mock };

  beforeEach(async () => {
    qbMock = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
      getRawMany: jest.fn().mockResolvedValue([]),
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
      query: jest.fn().mockResolvedValue([]),
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

    tramoRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      // `validarEstadoResultante` cuenta tramos/métodos cuando el PATCH no los
      // trae: sin esto, cualquier test que cambie de tipo explota con TypeError.
      count: jest.fn().mockResolvedValue(0),
    };
    metodoPagoRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      // `validarEstadoResultante` cuenta tramos/métodos cuando el PATCH no los
      // trae: sin esto, cualquier test que cambie de tipo explota con TypeError.
      count: jest.fn().mockResolvedValue(0),
    };

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

    it('rechaza un tramo en porcentaje con valor >= 1', async () => {
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));
      await expect(
        service.create(TENANT, {
          nombre: 'Recargo con tramo',
          tipoReglaId: 'tipo-general',
          valor: '0.05',
          modo: 'porcentaje',
          tramos: [{ minimo: '10', valor: '50' }],
        }),
      ).rejects.toThrow(/decimal/);
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

    it('un PATCH de valor sobre una regla monto_fijo no lo lee como porcentaje', async () => {
      // Gemelo del de descuentos: rechazaba con 400 una edición legítima por
      // asumir `porcentaje` cuando el DTO no reenviaba el modo.
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-fijo',
        tenantId: TENANT,
        nombre: 'Servicio',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'monto_fijo',
        valor: '1000',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await expect(
        service.update(TENANT, 'r-fijo', { valor: '5000' }),
      ).resolves.toBeDefined();
    });

    it('valida los tramos aunque ningún tipo de recargo los pida', async () => {
      // La plomería de tramos es alcanzable por API y el motor los evalúa
      // mirando `tramos.length` antes que el código del tipo.
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r-tramos',
        tenantId: TENANT,
        nombre: 'Rec tramos',
        tipoReglaId: 'tipo-general',
        condicionValor: null,
        modo: 'porcentaje',
        valor: '0.10',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('general'));

      await expect(
        service.update(TENANT, 'r-tramos', {
          tramos: [{ minimo: '10', valor: '50' }],
        }),
      ).rejects.toThrow(/decimal/);
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
        // Un recargo `general` VÁLIDO tiene valor: sin esto la fixture
        // representa un estado que el sistema ya no permite.
        valor: '0.05',
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

    // `uq_recargos_tenant_nombre_vivo` es parcial (WHERE eliminado_el IS NULL):
    // mientras el recargo estaba borrado, otro pudo tomar su nombre. El UPDATE
    // que lo revive vuelve a hacerlo competir y Postgres responde 23505. Sin
    // traducirlo, el usuario recibe un 500.
    it('restaurar() con el nombre ya ocupado por un recargo vivo es 400, no 500', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Black Friday',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );

      await expect(service.restaurar(TENANT, 'r1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // No debe intentar releer la fila si el restore falló.
      expect(recargoRepoMock.findOneOrFail).not.toHaveBeenCalled();
    });

    it('propaga un error de Postgres que no es 23505 sin traducirlo a 400', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Black Friday',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('deadlock detected'), { code: '40P01' }),
      );

      await expect(service.restaurar(TENANT, 'r1')).rejects.toThrow(
        'deadlock detected',
      );
    });

    // El 400 no puede ser solo un "no se pudo": la pantalla precarga
    // `nombreSugerido` en el campo del modal, así que si el backend deja de
    // mandarlo el usuario vuelve a quedar adivinando qué nombre está libre.
    it('el 400 de colisión trae un nombre libre ya calculado, salteando los tomados', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Recargo finde',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );
      qbMock.getRawMany.mockResolvedValueOnce([
        { nombre: 'Recargo finde' },
        { nombre: 'Recargo finde 2' },
      ]);

      await expect(service.restaurar(TENANT, 'r1')).rejects.toMatchObject({
        response: {
          message: 'Ya existe un recargo activo con el nombre "Recargo finde".',
          nombreSugerido: 'Recargo finde 3',
        },
      });
    });

    // La sugerencia tiene que ignorar mayúsculas porque el índice es sobre
    // `lower(nombre)`: si propusiera un nombre que la base considera tomado, el
    // usuario confirmaría el modal y recibiría el mismo 400.
    it('la sugerencia saltea los tomados sin importar mayúsculas', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Recargo finde',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value'), { code: '23505' }),
      );
      qbMock.getRawMany.mockResolvedValueOnce([
        { nombre: 'RECARGO FINDE' },
        { nombre: 'recargo finde 2' },
      ]);

      await expect(service.restaurar(TENANT, 'r1')).rejects.toMatchObject({
        response: { nombreSugerido: 'Recargo finde 3' },
      });
    });

    it('con `nombreNuevo` libre, restaura Y renombra en la misma escritura', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Recargo finde',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.findOneOrFail.mockResolvedValue({ id: 'r1' });

      await service.restaurar(TENANT, 'r1', 'Recargo finde 2');

      // Una sola escritura con las tres columnas: revivir y renombrar en dos
      // sentencias podría dejar la fila viva con el nombre que colisiona.
      expect(recargoRepoMock.update).toHaveBeenCalledWith(
        { id: 'r1', tenantId: TENANT },
        {
          eliminadoEl: null,
          eliminadoPor: null,
          nombre: 'Recargo finde 2',
        },
      );
    });

    it('sin `nombreNuevo` no toca el nombre (comportamiento de siempre)', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Recargo finde',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      recargoRepoMock.findOneOrFail.mockResolvedValue({ id: 'r1' });

      await service.restaurar(TENANT, 'r1');

      expect(recargoRepoMock.update).toHaveBeenCalledWith(
        { id: 'r1', tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null },
      );
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

    // Ver descuentos.service.spec.ts: mismo motivo. Este endpoint es público y
    // si comparara exacto diría "libre" donde el índice sobre `lower(nombre)`
    // va a rechazar.
    it('compara el nombre ignorando mayúsculas, igual que el índice', async () => {
      qbMock.getCount.mockResolvedValue(0);
      await service.nombreDisponible(TENANT, 'Recargo finde');
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        'LOWER(r.nombre) = LOWER(:nombre)',
        { nombre: 'Recargo finde' },
      );
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

  // ─── Todo recargo expresa su monto ────────────────────────────────────────
  // `create()` ya exigía valor en los 5 tipos, pero `update()` dejaba vaciarlo
  // por PATCH: un `{ "valor": null }` respondía 200 y dejaba un interés sin
  // tasa — entrada directa del motor de precios. Verificado contra la API real.
  // La regla del owner era sobre descuentos; acá se aplica la que este módulo
  // YA tenía en `create()`, no una nueva.
  describe('todo recargo expresa su monto', () => {
    it('rechaza vaciar el valor por PATCH', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Interés',
        tipoReglaId: 'tipo-interes_simple',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('interes_simple'));

      await expect(
        service.update(TENANT, 'r1', { valor: null }),
      ).rejects.toThrow(BadRequestException);
    });

    it('un PATCH que no toca el valor sigue funcionando (ancla positiva)', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Interés',
        tipoReglaId: 'tipo-interes_simple',
        valor: '0.05',
      });
      tipoReglaRepoMock.findOne.mockResolvedValue(makeTipo('interes_simple'));

      await expect(
        service.update(TENANT, 'r1', { nombre: 'Interés renombrado' }),
      ).resolves.toBeDefined();
    });
  });

  // ─── obtenerUso ─────────────────────────────────────────────────────────

  describe('obtenerUso', () => {
    it('lanza NotFound si el recargo no pertenece al tenant', async () => {
      recargoRepoMock.findOne.mockResolvedValue(null);

      await expect(service.obtenerUso(TENANT, 'r1')).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSourceMock.query).not.toHaveBeenCalled();
    });

    it('devuelve los ítems vivos que usan el recargo', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Recargo tarjeta',
      });
      dataSourceMock.query.mockResolvedValue([
        { id: 'item-1', nombre: 'Café' },
        { id: 'item-2', nombre: 'Torta' },
      ]);

      const result = await service.obtenerUso(TENANT, 'r1');

      expect(dataSourceMock.query).toHaveBeenCalledWith(
        expect.stringContaining('item_recargos'),
        ['r1', TENANT],
      );
      expect(result).toEqual({
        items: [
          { id: 'item-1', nombre: 'Café' },
          { id: 'item-2', nombre: 'Torta' },
        ],
      });
    });

    it('devuelve lista vacía cuando nadie usa el recargo', async () => {
      recargoRepoMock.findOne.mockResolvedValue({
        id: 'r1',
        tenantId: TENANT,
        nombre: 'Sin uso',
      });
      dataSourceMock.query.mockResolvedValue([]);

      const result = await service.obtenerUso(TENANT, 'r1');

      expect(result).toEqual({ items: [] });
    });
  });
});
