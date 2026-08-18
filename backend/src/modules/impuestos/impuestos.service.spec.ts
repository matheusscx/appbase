import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { ImpuestosService } from './impuestos.service';
import { Impuesto } from './entities/impuesto.entity';
import type { CreateImpuestoDto } from './dto/create-impuesto.dto';

const TENANT = 'tenant-uuid';
const IMP = 'impuesto-uuid';
const PAIS = 'pais-uuid';
const USUARIO_ID = 'usuario-uuid';

describe('ImpuestosService', () => {
  let service: ImpuestosService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let qbMock: {
    where: jest.Mock;
    andWhere: jest.Mock;
    leftJoin: jest.Mock;
    addSelect: jest.Mock;
    select: jest.Mock;
    withDeleted: jest.Mock;
    orderBy: jest.Mock;
    getRawAndEntities: jest.Mock;
    getCount: jest.Mock;
    getRawMany: jest.Mock;
  };
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    qbMock = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
      // `0` = nombre libre: es el default de `nombreDisponible`, así que los
      // tests que no hablan de unicidad siguen pasando por `create`/`update`
      // sin tener que declarar nada.
      getCount: jest.fn().mockResolvedValue(0),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
      createQueryBuilder: jest.fn(() => qbMock),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([{ pais_id: PAIS }]),
    };
    const dbMock = {
      transaccion: jest.fn(),
      query: dataSource.query,
      sinTransaccion: (fn: () => unknown) => fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpuestosService,
        { provide: getRepositoryToken(Impuesto), useValue: repo },
        { provide: Db, useValue: dbMock },
      ],
    }).compile();

    service = module.get<ImpuestosService>(ImpuestosService);
  });

  describe('findAll', () => {
    it('lista la unión de impuestos del tenant y del país, con origen', async () => {
      const rows = [
        {
          id: 'sys-1',
          tenantId: null,
          paisId: PAIS,
          nombre: 'IVA',
          tipo: 'iva',
        },
        {
          id: IMP,
          tenantId: TENANT,
          paisId: null,
          nombre: 'Propina',
          tipo: 'otro',
        },
      ];
      repo.find.mockResolvedValue(rows);

      const result = await service.findAll(TENANT);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('pais_id'),
        [TENANT],
      );
      expect(repo.find).toHaveBeenCalledWith({
        where: [{ tenantId: TENANT }, { paisId: PAIS }],
        order: { nombre: 'ASC' },
      });
      expect(result[0].origen).toBe('sistema');
      expect(result[1].origen).toBe('personalizado');
    });

    it('sin país resuelto, lista solo los del tenant', async () => {
      dataSource.query.mockResolvedValue([]);
      repo.find.mockResolvedValue([]);

      await service.findAll(TENANT);

      expect(repo.find).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
        order: { nombre: 'ASC' },
      });
    });
  });

  describe('create', () => {
    it('crea un impuesto con porcentaje en decimal', async () => {
      const result = await service.create(TENANT, {
        nombre: 'IVA',
        porcentaje: '0.19',
      });

      expect(repo.create).toHaveBeenCalledWith({
        tenantId: TENANT,
        nombre: 'IVA',
        porcentaje: '0.19',
        activo: true,
        tipo: 'otro',
      });
      expect(result).toMatchObject({ nombre: 'IVA', porcentaje: '0.19' });
    });

    it('siempre persiste tipo=otro, aunque el caller intente inyectar tipo=iva bypasseando el DTO', async () => {
      // `CreateImpuestoDto` ya no declara `tipo` (no compila pasarlo desde TS),
      // pero simulamos un caller que bypasea el tipado (ej. un cliente HTTP
      // enviando `tipo` en el body) para confirmar que el service lo ignora
      // por completo y siempre persiste 'otro'.
      const dtoConTipoInyectado = {
        nombre: 'IVA propio',
        porcentaje: '0.19',
        tipo: 'iva',
      } as unknown as CreateImpuestoDto;

      await service.create(TENANT, dtoConTipoInyectado);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tipo: 'otro' }),
      );
    });

    it('rechaza porcentaje igual a 0', async () => {
      await expect(
        service.create(TENANT, { nombre: 'IVA', porcentaje: '0' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rechaza porcentaje negativo', async () => {
      await expect(
        service.create(TENANT, { nombre: 'IVA', porcentaje: '-0.1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('lanza NotFound si el impuesto no pertenece al tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update(TENANT, IMP, { nombre: 'Otro' }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('rechaza actualizar a porcentaje <= 0', async () => {
      repo.findOne.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'IVA',
        porcentaje: '0.19',
        activo: true,
      });

      await expect(
        service.update(TENANT, IMP, { porcentaje: '0' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('actualiza el impuesto del tenant', async () => {
      repo.findOne.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'IVA',
        porcentaje: '0.19',
        activo: true,
      });

      const result = await service.update(TENANT, IMP, { porcentaje: '0.21' });

      expect(result.porcentaje).toBe('0.21');
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('lanza NotFound al eliminar impuesto de otro tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.remove(TENANT, USUARIO_ID, IMP)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('remove() registra quién borró y cuándo, en una sola escritura', async () => {
      repo.findOne.mockResolvedValue({ id: IMP, tenantId: TENANT });

      await service.remove(TENANT, USUARIO_ID, IMP);

      // Objeto exacto (no `objectContaining`): si `eliminadoEl` faltara del
      // payload, esta aserción debe fallar — es el corazón del soft delete,
      // no un detalle opcional de `eliminadoPor`.
      expect(repo.update).toHaveBeenCalledWith(
        { id: IMP, tenantId: TENANT },
        { eliminadoPor: USUARIO_ID, eliminadoEl: expect.any(Date) },
      );
    });
  });

  describe('restaurar', () => {
    it('restaurar() devuelve el impuesto RE-CONSULTADO tras el restore', async () => {
      repo.findOne.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'IVA (en la papelera)',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      repo.findOneOrFail.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'IVA',
        eliminadoEl: null,
      });

      const restaurado = await service.restaurar(TENANT, IMP);

      // Las DOS columnas: si `eliminadoPor` sobrevive al restore, el próximo
      // borrado del seeder (`remapImpuestosOficialesDuplicados`) queda
      // disfrazado de borrado de persona y el duplicado de IVA se puede
      // restaurar por API — la doble tributación de ADR-018 otra vez.
      expect(repo.update).toHaveBeenCalledWith(
        { id: IMP, tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null },
      );
      expect(repo.findOneOrFail).toHaveBeenCalledWith({
        where: { id: IMP, tenantId: TENANT },
      });
      expect(restaurado.eliminadoEl).toBeNull();
      expect(restaurado.nombre).toBe('IVA');
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.restaurar(TENANT, IMP)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('restaurar() un impuesto vivo (no eliminado) es 404', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: IMP,
        tenantId: TENANT,
        eliminadoEl: null,
      });

      await expect(service.restaurar(TENANT, IMP)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('restaurar() con el nombre tomado NO revienta con 500: es un 400 con sugerencia', async () => {
      repo.findOne.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'Impuesto verde',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      // 23505 del índice parcial: mientras estaba borrado nadie competía por el
      // nombre, y al revivirlo vuelve a competir. Antes del 2026-08-16 esto
      // subía crudo y el usuario veía un 500.
      repo.update.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      );
      qbMock.getRawMany.mockResolvedValue([{ nombre: 'Impuesto verde' }]);

      await expect(service.restaurar(TENANT, IMP)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('restaurar() con nombre nuevo revive y renombra en UNA sola escritura', async () => {
      repo.findOne.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'Impuesto verde',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      repo.findOneOrFail.mockResolvedValue({ id: IMP, tenantId: TENANT });

      await service.restaurar(TENANT, IMP, 'Impuesto verde 2');

      // Las tres columnas en el MISMO update: partirlo dejaría una ventana con
      // la fila viva y el nombre todavía en colisión.
      expect(repo.update).toHaveBeenCalledWith(
        { id: IMP, tenantId: TENANT },
        {
          eliminadoEl: null,
          eliminadoPor: null,
          nombre: 'Impuesto verde 2',
        },
      );
      expect(repo.update).toHaveBeenCalledTimes(1);
    });

    it('un error que NO es 23505 sube tal cual: no se disfraza de colisión de nombre', async () => {
      repo.findOne.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'Impuesto verde',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      repo.update.mockRejectedValueOnce(
        Object.assign(new Error('conexión caída'), { code: '08006' }),
      );

      await expect(service.restaurar(TENANT, IMP)).rejects.toThrow(
        'conexión caída',
      );
    });
  });

  /**
   * La unicidad de nombre por tenant, que `descuentos` y `recargos` ya tenían y
   * `impuestos` no (2026-08-16). El índice
   * `uq_impuestos_tenant_nombre_vivo` es quien decide; esto es lo que hace que
   * el usuario lea un 400 con texto en vez de un 500 de Postgres.
   */
  describe('unicidad de nombre por tenant', () => {
    it('crear con un nombre ya usado es 400 y no llega a guardar', async () => {
      qbMock.getCount.mockResolvedValue(1);

      await expect(
        service.create(TENANT, {
          nombre: 'Impuesto verde',
          porcentaje: '0.05',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('editar con un nombre ya usado es 400 y no llega a guardar', async () => {
      repo.findOne.mockResolvedValue({ id: IMP, tenantId: TENANT });
      qbMock.getCount.mockResolvedValue(1);

      await expect(
        service.update(TENANT, IMP, { nombre: 'Impuesto verde' }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('editar SIN tocar el nombre no consulta la unicidad: no hay nombre nuevo que validar', async () => {
      repo.findOne.mockResolvedValue({ id: IMP, tenantId: TENANT });

      await service.update(TENANT, IMP, { porcentaje: '0.07' });

      expect(qbMock.getCount).not.toHaveBeenCalled();
    });

    it('editar dejándose el MISMO nombre se excluye a sí mismo del chequeo', async () => {
      repo.findOne.mockResolvedValue({ id: IMP, tenantId: TENANT });

      await service.update(TENANT, IMP, { nombre: 'Impuesto verde' });

      // Sin el `excludeId` la fila chocaría contra sí misma y editar el
      // porcentaje de un impuesto sería imposible.
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        'i.impuesto_id != :excludeId',
        { excludeId: IMP },
      );
    });

    it('compara en minúsculas, como el índice: si no, diría "libre" y el guardado fallaría 23505', async () => {
      await service.nombreDisponible(TENANT, 'Impuesto Verde');

      expect(qbMock.andWhere).toHaveBeenCalledWith(
        'LOWER(i.nombre) = LOWER(:nombre)',
        { nombre: 'Impuesto Verde' },
      );
    });

    it('acota por tenant y por vivo: el catálogo del país no compite y la papelera tampoco', async () => {
      await service.nombreDisponible(TENANT, 'IVA');

      // `tenant_id = :tenantId` deja afuera las filas del país (`tenant_id`
      // nulo), igual que el índice — que no las cubre porque en Postgres dos
      // NULL nunca colisionan. Un tenant PUEDE llamar "IVA" al suyo.
      expect(qbMock.where).toHaveBeenCalledWith('i.tenant_id = :tenantId', {
        tenantId: TENANT,
      });
      // Y el índice es parcial: borrar y volver a crear con el mismo nombre
      // tiene que funcionar.
      expect(qbMock.andWhere).toHaveBeenCalledWith('i.eliminado_el IS NULL');
    });
  });

  describe('findAll con incluirEliminados', () => {
    it('sin el flag no devuelve eliminados', async () => {
      repo.find.mockResolvedValue([]);
      await service.findAll(TENANT);

      expect(repo.find).toHaveBeenCalledWith(
        expect.not.objectContaining({ withDeleted: true }),
      );
    });

    it('con el flag trae eliminados con el nombre de quien borró (vía getRawAndEntities)', async () => {
      const impuestoEliminado = {
        id: IMP,
        tenantId: TENANT,
        paisId: null,
        nombre: 'Propina',
        tipo: 'otro',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      };
      qbMock.getRawAndEntities.mockResolvedValue({
        entities: [impuestoEliminado],
        raw: [{ i_eliminado_por_nombre: 'admin.paris' }],
      });

      const result = await service.findAll(TENANT, true);

      // getMany() descarta los addSelect que no mapean a una columna de la
      // entity: el service debe usar getRawAndEntities() y fusionar a mano.
      expect(qbMock.getRawAndEntities).toHaveBeenCalled();
      expect(result[0]).toMatchObject({
        id: IMP,
        eliminadoPorNombre: 'admin.paris',
        origen: 'personalizado',
      });
    });

    // El bug real que este bloque no veía: los mocks de `where`/`andWhere`
    // eran `mockReturnThis()` sin aserción sobre el argumento, así que el
    // listado podía emitir cualquier WHERE y la suite seguía verde.
    //
    // Este WHERE tiene DOS formas de perder el filtro, y las dos son
    // refactors que alguien haría de buena fe:
    //  1. sacarle los paréntesis al `OR` (el bug que existía) — `AND` liga
    //     más fuerte, así que quedaría
    //     `tenant_id = $1 OR (pais_id = $2 AND <filtro>)` y las filas del
    //     tenant se saltarían el filtro entero;
    //  2. subir el `andWhere` arriba del `if (paisId)` para "agrupar la
    //     construcción del where" — `SelectQueryBuilder.where()` resetea
    //     `expressionMap.wheres`, así que descartaría el filtro completo.
    // Se asertan las dos: el argumento Y el orden.
    it('el filtro de borrado-del-sistema se aplica a las DOS ramas del OR', async () => {
      await service.findAll(TENANT, true);

      expect(qbMock.where).toHaveBeenCalledWith(
        '(i.tenant_id = :tenantId OR i.pais_id = :paisId)',
        { tenantId: TENANT, paisId: PAIS },
      );
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        '(i.eliminado_el IS NULL OR i.eliminado_por IS NOT NULL)',
      );
      // Mutante 2: `where()` borra lo acumulado, así que el filtro tiene que
      // aplicarse DESPUÉS. Sin esta aserción, moverlo arriba deja el listado
      // sin filtro y los dos `toHaveBeenCalledWith` de arriba —que son
      // agnósticos al orden— siguen en verde.
      expect(qbMock.andWhere.mock.invocationCallOrder[0]).toBeGreaterThan(
        qbMock.where.mock.invocationCallOrder[0],
      );
    });

    it('sin país (tenant sin provincia) el filtro se sigue aplicando sobre la rama única', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.findAll(TENANT, true);

      // Subcadena, no igualdad: parentizar una rama única es SQL idéntico, y
      // un test que se pone rojo sin que cambie la conducta entrena a
      // ignorarlo. Pero el scoping por tenant SÍ se asserta —no alcanza con
      // `expect.any(String)`—: un `where('1=1', { tenantId })` pasaría esa
      // versión laxa en verde y sería una fuga multi-tenant.
      expect(qbMock.where).toHaveBeenCalledWith(
        expect.stringContaining('i.tenant_id = :tenantId'),
        { tenantId: TENANT },
      );
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        '(i.eliminado_el IS NULL OR i.eliminado_por IS NOT NULL)',
      );
      expect(qbMock.andWhere.mock.invocationCallOrder[0]).toBeGreaterThan(
        qbMock.where.mock.invocationCallOrder[0],
      );
    });
  });

  // ─── obtenerUso ─────────────────────────────────────────────────────────

  describe('obtenerUso', () => {
    it('lanza NotFound si el impuesto no pertenece al tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.obtenerUso(TENANT, IMP)).rejects.toThrow(
        NotFoundException,
      );
      // El precheck corta ANTES del JOIN: es lo que impide que un id de otro
      // tenant llegue a consultar la tabla puente. Sus dos gemelos ya lo fijan.
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('devuelve los ítems vivos que usan el impuesto', async () => {
      repo.findOne.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'Propina',
      });
      dataSource.query.mockResolvedValue([
        { id: 'item-1', nombre: 'Café' },
        { id: 'item-2', nombre: 'Torta' },
      ]);

      const result = await service.obtenerUso(TENANT, IMP);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('item_impuestos'),
        [IMP, TENANT],
      );
      expect(result).toEqual({
        items: [
          { id: 'item-1', nombre: 'Café' },
          { id: 'item-2', nombre: 'Torta' },
        ],
      });
    });

    it('devuelve lista vacía cuando nadie usa el impuesto', async () => {
      repo.findOne.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'Sin uso',
      });
      dataSource.query.mockResolvedValue([]);

      const result = await service.obtenerUso(TENANT, IMP);

      expect(result).toEqual({ items: [] });
    });
  });
});
