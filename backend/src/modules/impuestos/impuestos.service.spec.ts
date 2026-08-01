import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
    restore: jest.Mock;
    softDelete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let qbMock: {
    where: jest.Mock;
    andWhere: jest.Mock;
    leftJoin: jest.Mock;
    addSelect: jest.Mock;
    withDeleted: jest.Mock;
    orderBy: jest.Mock;
    getRawAndEntities: jest.Mock;
  };
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    qbMock = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
    };
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      restore: jest.fn(() => Promise.resolve({ affected: 1 })),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
      createQueryBuilder: jest.fn(() => qbMock),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([{ pais_id: PAIS }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImpuestosService,
        { provide: getRepositoryToken(Impuesto), useValue: repo },
        { provide: getDataSourceToken(), useValue: dataSource },
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
      });
      repo.findOneOrFail.mockResolvedValue({
        id: IMP,
        tenantId: TENANT,
        nombre: 'IVA',
        eliminadoEl: null,
      });

      const restaurado = await service.restaurar(TENANT, IMP);

      expect(repo.restore).toHaveBeenCalledWith({
        id: IMP,
        tenantId: TENANT,
      });
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
      expect(repo.restore).not.toHaveBeenCalled();
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
      expect(repo.restore).not.toHaveBeenCalled();
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
  });
});
