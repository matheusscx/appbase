import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CategoriasService } from './categorias.service';
import { Categoria } from './entities/categoria.entity';

const TENANT = 'tenant-uuid';
const CAT = 'categoria-uuid';
const IMPRESORA = 'impresora-uuid';
const USUARIO_ID = 'usuario-uuid';

describe('CategoriasService', () => {
  let service: CategoriasService;
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
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => ({ ...data })),
      save: jest.fn((row: unknown) => Promise.resolve(row)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
      createQueryBuilder: jest.fn(),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([{ impresora_id: IMPRESORA }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriasService,
        { provide: getRepositoryToken(Categoria), useValue: repo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<CategoriasService>(CategoriasService);
  });

  describe('findAll', () => {
    it('lista solo las categorías del tenant', async () => {
      const rows = [{ id: CAT, tenantId: TENANT, nombre: 'Bebidas' }];
      repo.find.mockResolvedValue(rows);

      const result = await service.findAll(TENANT);

      expect(repo.find).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
        order: { nombre: 'ASC' },
      });
      expect(result).toBe(rows);
    });
  });

  describe('create', () => {
    it('crea una categoría con defaults aplicaA=ambos y activo=true', async () => {
      const result = await service.create(TENANT, { nombre: 'Bebidas' });

      expect(repo.create).toHaveBeenCalledWith({
        tenantId: TENANT,
        nombre: 'Bebidas',
        aplicaA: 'ambos',
        activo: true,
        impresoraId: null,
      });
      expect(result).toMatchObject({ nombre: 'Bebidas', aplicaA: 'ambos' });
    });

    it('acepta un impresoraId válido (de rol comanda, activa, del tenant)', async () => {
      const result = await service.create(TENANT, {
        nombre: 'Bebidas',
        impresoraId: IMPRESORA,
      });

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining("rol = 'comanda'"),
        [IMPRESORA, TENANT],
      );
      expect(result).toMatchObject({ impresoraId: IMPRESORA });
    });

    it('rechaza un impresoraId que no existe o no es de rol comanda', async () => {
      dataSource.query.mockResolvedValue([]);
      await expect(
        service.create(TENANT, { nombre: 'Bebidas', impresoraId: IMPRESORA }),
      ).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('lanza NotFound si la categoría no pertenece al tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.update(TENANT, CAT, { nombre: 'Otra' }),
      ).rejects.toThrow(NotFoundException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('actualiza la categoría del tenant', async () => {
      repo.findOne.mockResolvedValue({
        id: CAT,
        tenantId: TENANT,
        nombre: 'Bebidas',
        aplicaA: 'ambos',
        activo: true,
      });

      const result = await service.update(TENANT, CAT, { nombre: 'Comidas' });

      expect(result.nombre).toBe('Comidas');
      expect(repo.save).toHaveBeenCalled();
    });

    it('valida el impresoraId al actualizarlo', async () => {
      repo.findOne.mockResolvedValue({
        id: CAT,
        tenantId: TENANT,
        nombre: 'Bebidas',
        impresoraId: null,
      });
      dataSource.query.mockResolvedValue([]);

      await expect(
        service.update(TENANT, CAT, { impresoraId: IMPRESORA }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('lanza NotFound al eliminar categoría de otro tenant', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.remove(TENANT, USUARIO_ID, CAT)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('remove() registra quién borró y cuándo, en una sola escritura', async () => {
      repo.findOne.mockResolvedValue({ id: CAT, tenantId: TENANT });

      await service.remove(TENANT, USUARIO_ID, CAT);

      // Objeto exacto (no `objectContaining`): si `eliminadoEl` faltara del
      // payload, esta aserción debe fallar — es el corazón del soft delete,
      // no un detalle opcional de `eliminadoPor`.
      expect(repo.update).toHaveBeenCalledWith(
        { id: CAT, tenantId: TENANT },
        { eliminadoPor: USUARIO_ID, eliminadoEl: expect.any(Date) },
      );
    });
  });

  describe('restaurar', () => {
    it('restaurar() devuelve la categoría RE-CONSULTADA tras el restore, y no toca `activo`', async () => {
      // `categorias.remove()` nunca pisó `activo`, así que el valor previo
      // sobrevivió: forzarlo destruiría información que el borrado respetó.
      // El pre-restore (`findOne`) y el post-restore (`findOneOrFail`) se
      // dejan deliberadamente DISTINTOS en `eliminadoEl`/`nombre` — si el
      // service devolviera el objeto viejo en vez de re-consultar tras
      // `restore()`, estas dos aserciones deben delatarlo aunque `activo`
      // sea igual en ambos.
      repo.findOne.mockResolvedValue({
        id: CAT,
        tenantId: TENANT,
        nombre: 'Bebidas (en la papelera)',
        activo: false,
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      });
      repo.findOneOrFail.mockResolvedValue({
        id: CAT,
        tenantId: TENANT,
        nombre: 'Bebidas',
        activo: false,
        eliminadoEl: null,
      });

      const restaurada = await service.restaurar(TENANT, CAT);

      // Las DOS columnas: dejar `eliminadoPor` con el valor viejo hace que un
      // borrado del sistema posterior parezca borrado de persona, y eso
      // reabre por API lo que la regla del owner cierra.
      expect(repo.update).toHaveBeenCalledWith(
        { id: CAT, tenantId: TENANT },
        { eliminadoEl: null, eliminadoPor: null },
      );
      expect(repo.findOneOrFail).toHaveBeenCalledWith({
        where: { id: CAT, tenantId: TENANT },
      });
      expect(restaurada.activo).toBe(false);
      expect(restaurada.eliminadoEl).toBeNull();
      expect(restaurada.nombre).toBe('Bebidas');
    });

    it('restaurar() algo que no está en la papelera es 404', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.restaurar(TENANT, CAT)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('restaurar() una categoría viva (no eliminada) es 404', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: CAT,
        tenantId: TENANT,
        eliminadoEl: null,
      });

      await expect(service.restaurar(TENANT, CAT)).rejects.toThrow(
        NotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll con incluirEliminados', () => {
    it('sin el flag no devuelve eliminados', async () => {
      await service.findAll(TENANT);

      expect(repo.find).toHaveBeenCalledWith(
        expect.not.objectContaining({ withDeleted: true }),
      );
    });

    it('con el flag trae eliminados con el nombre de quien borró (vía getRawAndEntities)', async () => {
      const categoriaEliminada = {
        id: CAT,
        tenantId: TENANT,
        nombre: 'Bebidas',
        eliminadoEl: new Date(),
        eliminadoPor: USUARIO_ID,
      };
      const qbMock = {
        leftJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        withDeleted: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockResolvedValue({
          entities: [categoriaEliminada],
          raw: [{ c_eliminado_por_nombre: 'admin.paris' }],
        }),
      };
      repo.createQueryBuilder.mockReturnValue(qbMock);

      const result = await service.findAll(TENANT, true);

      // getMany() descarta los addSelect que no mapean a una columna de la
      // entity: el service debe usar getRawAndEntities() y fusionar a mano.
      expect(qbMock.getRawAndEntities).toHaveBeenCalled();
      expect(result[0]).toMatchObject({
        id: CAT,
        eliminadoPorNombre: 'admin.paris',
      });
    });
  });
});
