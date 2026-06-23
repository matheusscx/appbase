import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service';
import { Item } from './entities/item.entity';
import { ItemProducto } from './entities/item-producto.entity';
import { ItemServicio } from './entities/item-servicio.entity';

const TENANT = 'tenant-uuid';
const ITEM_ID = 'item-uuid';
const MONEDA_ID = 'moneda-uuid';
const CATEGORIA_ID = 'categoria-uuid';

describe('ItemsService', () => {
  let service: ItemsService;
  let itemRepo: { findOne: jest.Mock };
  let itemProductoRepo: { findOne: jest.Mock };
  let itemServicioRepo: { findOne: jest.Mock };
  let managerMock: { query: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };

  beforeEach(async () => {
    managerMock = { query: jest.fn() };
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn((cb: (m: typeof managerMock) => unknown) =>
        cb(managerMock),
      ),
    };
    itemRepo = { findOne: jest.fn() };
    itemProductoRepo = { findOne: jest.fn() };
    itemServicioRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemsService,
        { provide: getRepositoryToken(Item), useValue: itemRepo },
        {
          provide: getRepositoryToken(ItemProducto),
          useValue: itemProductoRepo,
        },
        {
          provide: getRepositoryToken(ItemServicio),
          useValue: itemServicioRepo,
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<ItemsService>(ItemsService);
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('devuelve lista mapeada al formato camelCase', async () => {
      dataSource.query.mockResolvedValue([
        {
          item_id: ITEM_ID,
          nombre: 'Smartphone',
          descripcion: null,
          tipo: 'producto',
          activo: true,
          precio_base: '100000',
          precio_incluye_impuesto: false,
          moneda_id: MONEDA_ID,
          moneda_codigo: 'CLP',
          moneda_simbolo: '$',
          categoria_id: null,
          categoria_nombre: null,
          creado_el: new Date(),
          stock: '10',
          unidad_medida: 'unidad',
          fecha_elaboracion: null,
          fecha_vencimiento: null,
          duracion_estimada: null,
          requiere_cita: null,
        },
      ]);

      const result = await service.findAll(TENANT);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(ITEM_ID);
      expect(result[0].tipo).toBe('producto');
      expect(result[0].stock).toBe('10');
    });

    it('devuelve lista vacía cuando no hay items', async () => {
      dataSource.query.mockResolvedValue([]);
      const result = await service.findAll(TENANT);
      expect(result).toHaveLength(0);
    });
  });

  // ── findOne ────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('lanza NotFoundException cuando el item no existe', async () => {
      dataSource.query.mockResolvedValue([]);
      await expect(service.findOne(TENANT, ITEM_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('incluye impuestosIds, recargosIds, descuentosIds', async () => {
      const baseRow = {
        item_id: ITEM_ID,
        nombre: 'Test',
        descripcion: null,
        tipo: 'servicio',
        activo: true,
        precio_base: '5000',
        precio_incluye_impuesto: false,
        moneda_id: MONEDA_ID,
        moneda_codigo: 'CLP',
        moneda_simbolo: '$',
        categoria_id: null,
        categoria_nombre: null,
        creado_el: new Date(),
        stock: null,
        unidad_medida: null,
        fecha_elaboracion: null,
        fecha_vencimiento: null,
        duracion_estimada: 60,
        requiere_cita: true,
      };
      dataSource.query
        .mockResolvedValueOnce([baseRow])
        .mockResolvedValueOnce([{ impuesto_id: 'imp-1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.findOne(TENANT, ITEM_ID);

      expect(result.impuestosIds).toEqual(['imp-1']);
      expect(result.recargosIds).toEqual([]);
      expect(result.descuentosIds).toEqual([]);
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    const baseDtoProducto = {
      nombre: 'Producto test',
      precioBase: '10000',
      monedaId: MONEDA_ID,
      tipo: 'producto',
      stock: '5',
    };

    it('lanza BadRequestException cuando la moneda no pertenece al tenant', async () => {
      managerMock.query.mockResolvedValue([]); // moneda no encontrada
      await expect(service.create(TENANT, baseDtoProducto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException cuando la categoría no pertenece al tenant', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([]); // categoria no encontrada
      await expect(
        service.create(TENANT, {
          ...baseDtoProducto,
          categoriaId: CATEGORIA_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('happy path: crea producto con extensión y sin reglas', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
        .mockResolvedValueOnce([]); // INSERT item_producto

      const result = await service.create(TENANT, baseDtoProducto);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result).toEqual({ id: ITEM_ID });
    });

    it('happy path: crea servicio con extensión', async () => {
      const dtoServicio = {
        nombre: 'Servicio test',
        precioBase: '5000',
        monedaId: MONEDA_ID,
        tipo: 'servicio',
        duracionEstimada: 60,
        requiereCita: true,
      };
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
        .mockResolvedValueOnce([]); // INSERT item_servicio

      const result = await service.create(TENANT, dtoServicio);

      expect(result).toEqual({ id: ITEM_ID });
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('lanza NotFoundException cuando el item no existe', async () => {
      managerMock.query.mockResolvedValue([]);
      await expect(
        service.update(TENANT, ITEM_ID, { nombre: 'Nuevo nombre' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('reemplaza impuestosIds cuando se proveen (reemplazo total)', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }]) // SELECT existing
        .mockResolvedValueOnce([{ cnt: '1' }]) // validarReglas impuestos
        .mockResolvedValueOnce([]) // DELETE item_impuestos
        .mockResolvedValueOnce([]); // INSERT item_impuestos

      await service.update(TENANT, ITEM_ID, { impuestosIds: ['imp-nuevo'] });

      const calls = managerMock.query.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(
        calls.some((sql) => sql.includes('DELETE FROM item_impuestos')),
      ).toBe(true);
      expect(
        calls.some((sql) => sql.includes('INSERT INTO item_impuestos')),
      ).toBe(true);
    });

    it('no toca impuestosIds cuando no se proveen en el DTO', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'servicio' }])
        .mockResolvedValueOnce([]); // UPDATE items con activo

      await service.update(TENANT, ITEM_ID, { activo: false });

      const calls = managerMock.query.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(
        calls.some((sql) => sql.includes('DELETE FROM item_impuestos')),
      ).toBe(false);
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('lanza NotFoundException cuando el item no pertenece al tenant', async () => {
      itemRepo.findOne.mockResolvedValue(null);
      await expect(service.remove(TENANT, ITEM_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-delete cuando el item pertenece al tenant', async () => {
      itemRepo.findOne.mockResolvedValue({ id: ITEM_ID, tenantId: TENANT });
      dataSource.query.mockResolvedValue([]);

      await service.remove(TENANT, ITEM_ID);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('eliminado_el = NOW()'),
        [ITEM_ID, TENANT],
      );
    });
  });

  // ── ajustarStock ───────────────────────────────────────────────────────────

  describe('ajustarStock', () => {
    it('lanza NotFoundException cuando el item no existe', async () => {
      managerMock.query.mockResolvedValue([]);
      await expect(
        service.ajustarStock(TENANT, ITEM_ID, {
          cantidad: 5,
          tipo: 'entrada',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException cuando el item es servicio', async () => {
      managerMock.query.mockResolvedValue([{ tipo: 'servicio' }]);
      await expect(
        service.ajustarStock(TENANT, ITEM_ID, {
          cantidad: 5,
          tipo: 'entrada',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException cuando el stock es insuficiente para salida', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([{ stock: '3' }]);
      await expect(
        service.ajustarStock(TENANT, ITEM_ID, {
          cantidad: 5,
          tipo: 'salida',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('suma stock en entrada', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([{ stock: '10' }])
        .mockResolvedValueOnce([]);

      const result = await service.ajustarStock(TENANT, ITEM_ID, {
        cantidad: 5,
        tipo: 'entrada',
      });

      expect(result.stock).toBe('15');
    });

    it('resta stock en salida válida', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([{ stock: '10' }])
        .mockResolvedValueOnce([]);

      const result = await service.ajustarStock(TENANT, ITEM_ID, {
        cantidad: 3,
        tipo: 'salida',
      });

      expect(result.stock).toBe('7');
    });
  });
});
