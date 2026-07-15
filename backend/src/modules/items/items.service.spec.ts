import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service';
import { Item } from './entities/item.entity';
import { ItemProducto } from './entities/item-producto.entity';
import { ItemServicio } from './entities/item-servicio.entity';
import { InventarioService } from '../inventario/inventario.service';
import { CatalogService } from '../catalog/catalog.service';

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
  let inventarioServiceMock: { registrarMovimiento: jest.Mock };
  let catalogServiceMock: {
    findAllUnidadesMedida: jest.Mock;
    convertirUnidad: jest.Mock;
  };

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
    inventarioServiceMock = { registrarMovimiento: jest.fn() };
    catalogServiceMock = {
      findAllUnidadesMedida: jest.fn().mockResolvedValue([
        { codigo: 'unidad', magnitud: 'conteo', factorBase: '1' },
        { codigo: 'g', magnitud: 'masa', factorBase: '1' },
        { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
      ]),
      convertirUnidad: jest.fn(),
    };

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
        { provide: InventarioService, useValue: inventarioServiceMock },
        { provide: CatalogService, useValue: catalogServiceMock },
      ],
    }).compile();

    service = module.get<ItemsService>(ItemsService);
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('devuelve lista paginada mapeada al formato camelCase', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
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

      const result = await service.findAll(TENANT, {});

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(ITEM_ID);
      expect(result.data[0].tipo).toBe('producto');
      expect(result.data[0].stock).toBe('10');
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
    });

    it('devuelve lista vacía cuando no hay items', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);
      const result = await service.findAll(TENANT, {});
      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });

    it('filtra por búsqueda en nombre o descripción', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.findAll(TENANT, { search: 'smart' });

      expect(dataSource.query.mock.calls[0][0]).toContain('ILIKE');
      expect(dataSource.query.mock.calls[0][1]).toEqual([TENANT, '%smart%']);
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
      await expect(
        service.create(TENANT, 'user-uuid', baseDtoProducto as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException cuando la categoría no pertenece al tenant', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([]); // categoria no encontrada
      await expect(
        service.create(TENANT, 'user-uuid', {
          ...baseDtoProducto,
          categoriaId: CATEGORIA_ID,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('happy path: crea producto con extensión y sin reglas', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
        .mockResolvedValueOnce([]); // INSERT item_producto
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-0',
        stockAnterior: '0',
        stockResultante: '5',
      });

      const result = await service.create(TENANT, 'user-uuid', baseDtoProducto);

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

      const result = await service.create(TENANT, 'user-uuid', dtoServicio);

      expect(result).toEqual({ id: ITEM_ID });
    });

    it('producto con stock inicial > 0 registra movimiento inventario_inicial', async () => {
      // moneda válida, sin categoría/reglas
      managerMock.query
        .mockResolvedValueOnce([{ ok: 1 }]) // validarMoneda
        .mockResolvedValueOnce([{ item_id: 'nuevo-item' }]) // INSERT items RETURNING
        .mockResolvedValueOnce(undefined); // INSERT item_producto
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-1',
        stockAnterior: '0',
        stockResultante: '25',
      });

      const res = await service.create(TENANT, 'user-uuid', {
        nombre: 'Smartphone',
        precioBase: '899000',
        monedaId: MONEDA_ID,
        tipo: 'producto',
        stock: '25',
        unidadMedida: 'unidad',
      });

      expect(res).toEqual({ id: 'nuevo-item' });
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          itemId: 'nuevo-item',
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          cantidad: '25',
          usuarioId: 'user-uuid',
        }),
      );
    });

    it('producto con stock = 0 NO registra movimiento inventario_inicial', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ ok: 1 }]) // validarMoneda
        .mockResolvedValueOnce([{ item_id: 'nuevo-item' }]) // INSERT items RETURNING
        .mockResolvedValueOnce(undefined); // INSERT item_producto

      await service.create(TENANT, 'user-uuid', {
        nombre: 'Producto sin stock',
        precioBase: '100',
        monedaId: MONEDA_ID,
        tipo: 'producto',
        stock: '0',
        unidadMedida: 'unidad',
      });

      expect(inventarioServiceMock.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('modo serie: registra movimiento con series[]', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ ok: 1 }]) // validarMoneda
        .mockResolvedValueOnce([{ item_id: 'item-s' }]) // INSERT items RETURNING
        .mockResolvedValueOnce(undefined); // INSERT item_producto
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-s',
        stockAnterior: '0',
        stockResultante: '2',
      });

      const res = await service.create(TENANT, 'user-uuid', {
        nombre: 'iPhone 15',
        precioBase: '999000',
        monedaId: MONEDA_ID,
        tipo: 'producto',
        modoInventario: 'serie',
        series: [{ serie: 'IMEI-001' }, { serie: 'IMEI-002' }],
      });

      expect(res).toEqual({ id: 'item-s' });
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          cantidad: '2',
          series: [{ serie: 'IMEI-001' }, { serie: 'IMEI-002' }],
        }),
      );
    });

    it('happy path: crea suscripción con extensión', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
        .mockResolvedValueOnce([]); // INSERT item_suscripcion

      const result = await service.create(TENANT, 'user-uuid', {
        nombre: 'Plan mensual',
        precioBase: '15000',
        monedaId: MONEDA_ID,
        tipo: 'suscripcion',
        frecuencia: 'mensual',
      });

      expect(result).toEqual({ id: ITEM_ID });
      const calls = managerMock.query.mock.calls as [string, unknown[]][];
      const insertCall = calls.find(([sql]) =>
        sql.includes('INSERT INTO item_suscripcion'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall?.[1]).toEqual([ITEM_ID, 'mensual']);
    });

    describe('receta', () => {
      const ingredientePan = {
        ingredienteItemId: 'ingrediente-pan',
        cantidad: '1',
        unidadCodigo: 'unidad',
        bloqueante: true,
      };
      const ingredienteCarne = {
        ingredienteItemId: 'ingrediente-carne',
        cantidad: '150',
        unidadCodigo: 'g',
        bloqueante: true,
      };
      const dtoReceta = {
        nombre: 'Hamburguesa test',
        precioBase: '3500',
        monedaId: MONEDA_ID,
        tipo: 'receta',
        ingredientes: [ingredientePan, ingredienteCarne],
      };

      it('rechaza una receta sin ingredientes', async () => {
        await expect(
          service.create(TENANT, 'user-uuid', {
            ...dtoReceta,
            ingredientes: [],
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('rechaza un ingrediente que no es producto', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
          .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items
          .mockResolvedValueOnce([{ tipo: 'servicio', modo_inventario: null, unidad_medida: null, costo_actual: null }]); // lookup pan → no es producto

        await expect(
          service.create(TENANT, 'user-uuid', dtoReceta as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('rechaza un ingrediente en modo serie/lote', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }])
          .mockResolvedValueOnce([{ item_id: ITEM_ID }])
          .mockResolvedValueOnce([{ tipo: 'producto', modo_inventario: 'serie', unidad_medida: 'unidad', costo_actual: '500' }]);

        await expect(
          service.create(TENANT, 'user-uuid', dtoReceta as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('happy path: calcula costoActual convirtiendo cada ingrediente a su unidad base', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
          .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items
          .mockResolvedValueOnce([{ tipo: 'producto', modo_inventario: 'cantidad', unidad_medida: 'unidad', costo_actual: '500' }]) // pan
          .mockResolvedValueOnce([{ tipo: 'producto', modo_inventario: 'cantidad', unidad_medida: 'kg', costo_actual: '8000' }]) // carne
          .mockResolvedValueOnce([]) // INSERT item_receta
          .mockResolvedValueOnce([]) // INSERT receta_ingredientes pan
          .mockResolvedValueOnce([]); // INSERT receta_ingredientes carne

        catalogServiceMock.convertirUnidad
          .mockResolvedValueOnce('1') // pan: unidad → unidad (sin cambio)
          .mockResolvedValueOnce('0.15'); // carne: 150 g → 0.15 kg

        const result = await service.create(TENANT, 'user-uuid', dtoReceta as any);

        expect(result).toEqual({ id: ITEM_ID });
        // Orden de llamadas a managerMock.query: 1=moneda, 2=INSERT items,
        // 3=lookup pan, 4=lookup carne, 5=INSERT item_receta, 6/7=INSERT receta_ingredientes.
        // costo = 500*1 + 8000*0.15 = 500 + 1200 = 1700
        expect(managerMock.query).toHaveBeenNthCalledWith(
          5,
          expect.stringContaining('INSERT INTO item_receta'),
          [ITEM_ID, '1700'],
        );
      });
    });

    it('lanza BadRequestException cuando tipo suscripcion no trae frecuencia', async () => {
      await expect(
        service.create(TENANT, 'user-uuid', {
          nombre: 'Plan sin frecuencia',
          precioBase: '15000',
          monedaId: MONEDA_ID,
          tipo: 'suscripcion',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException cuando frecuencia se envía con tipo producto', async () => {
      await expect(
        service.create(TENANT, 'user-uuid', {
          ...baseDtoProducto,
          frecuencia: 'mensual',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('modo lote: registra movimiento con lote', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ ok: 1 }]) // validarMoneda
        .mockResolvedValueOnce([{ item_id: 'item-l' }]) // INSERT items RETURNING
        .mockResolvedValueOnce(undefined); // INSERT item_producto
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-l',
        stockAnterior: '0',
        stockResultante: '100',
      });

      const res = await service.create(TENANT, 'user-uuid', {
        nombre: 'Paracetamol 500mg',
        precioBase: '1500',
        monedaId: MONEDA_ID,
        tipo: 'producto',
        modoInventario: 'lote',
        stock: '100',
        lote: { codigoLote: 'LOTE-001', fechaVencimiento: '2027-01-01' },
      });

      expect(res).toEqual({ id: 'item-l' });
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          cantidad: '100',
          lote: { codigoLote: 'LOTE-001', fechaVencimiento: '2027-01-01' },
        }),
      );
    });

    it('create producto persiste costo_actual', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
        .mockResolvedValueOnce([]); // INSERT item_producto

      await service.create(
        TENANT,
        'user-uuid',
        {
          nombre: 'Carne molida',
          precioBase: '6000',
          monedaId: 'moneda-uuid',
          tipo: 'producto',
          costo: '4000',
        } as never,
      );

      const insertProducto = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].includes('INSERT INTO item_producto'),
      );
      expect(insertProducto?.[0]).toContain('costo_actual');
      expect(insertProducto?.[1]).toContain('4000');
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

    it('bloquea cambio de modoInventario si existen movimientos', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }]) // SELECT existing
        .mockResolvedValueOnce([{ cnt: '3' }]); // COUNT movimientos > 0

      await expect(
        service.update(TENANT, ITEM_ID, { modoInventario: 'lote' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('permite cambio de modoInventario si NO existen movimientos', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }]) // SELECT existing
        .mockResolvedValueOnce([{ cnt: '0' }]) // COUNT movimientos = 0
        .mockResolvedValueOnce(undefined); // UPDATE item_producto

      await service.update(TENANT, ITEM_ID, { modoInventario: 'lote' });

      const calls = managerMock.query.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(calls.some((sql) => sql.includes('modo_inventario'))).toBe(true);
    });

    it('actualiza frecuencia de un item suscripción existente', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'suscripcion' }]) // SELECT existing
        .mockResolvedValueOnce([]); // UPDATE item_suscripcion

      const result = await service.update(TENANT, ITEM_ID, {
        frecuencia: 'quincenal',
      });

      expect(result).toEqual({ id: ITEM_ID });
      const calls = managerMock.query.mock.calls as [string, unknown[]][];
      const updateCall = calls.find(([sql]) =>
        sql.includes('UPDATE item_suscripcion'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toEqual(['quincenal', ITEM_ID]);
    });

    it('lanza BadRequestException al enviar frecuencia en un item que no es suscripción', async () => {
      managerMock.query.mockResolvedValueOnce([
        { item_id: ITEM_ID, tipo: 'producto' },
      ]); // SELECT existing

      await expect(
        service.update(TENANT, ITEM_ID, { frecuencia: 'mensual' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('update producto cambia costo_actual sin crear movimiento', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }]) // SELECT existing
        .mockResolvedValueOnce(undefined); // UPDATE item_producto

      await service.update(TENANT, ITEM_ID, { costo: '4300' } as never);

      const updateProducto = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('UPDATE item_producto') &&
          c[0].includes('costo_actual'),
      );
      expect(updateProducto).toBeDefined();
      expect(updateProducto?.[1]).toContain('4300');
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
    it('delega el registro del movimiento y devuelve el nuevo stock', async () => {
      managerMock.query.mockResolvedValueOnce([{ tipo: 'producto' }]); // SELECT tipo
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-1',
        stockAnterior: '10',
        stockResultante: '15',
      });

      const res = await service.ajustarStock(TENANT, 'user-uuid', ITEM_ID, {
        cantidad: 5,
        tipo: 'entrada',
        motivo: 'compra',
      });

      expect(res).toEqual({ stock: '15' });
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          tenantId: TENANT,
          itemId: ITEM_ID,
          usuarioId: 'user-uuid',
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
        }),
      );
    });

    it('rechaza si el item no es producto', async () => {
      managerMock.query.mockResolvedValueOnce([{ tipo: 'servicio' }]);

      await expect(
        service.ajustarStock(TENANT, 'user-uuid', ITEM_ID, {
          cantidad: 5,
          tipo: 'entrada',
          motivo: 'compra',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFoundException cuando el item no existe', async () => {
      managerMock.query.mockResolvedValueOnce([]); // SELECT tipo → vacío

      await expect(
        service.ajustarStock(TENANT, 'user-uuid', ITEM_ID, {
          cantidad: 5,
          tipo: 'entrada',
          motivo: 'compra',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('ajustarStock reenvía costoUnitario a registrarMovimiento', async () => {
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-x',
        stockAnterior: '0',
        stockResultante: '5',
      });

      managerMock.query.mockResolvedValueOnce([{ tipo: 'producto' }]); // SELECT tipo

      await service.ajustarStock(TENANT, 'user-uuid', ITEM_ID, {
        cantidad: 5,
        tipo: 'entrada',
        motivo: 'compra',
        costoUnitario: '4500',
      } as never);

      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({ costoUnitario: '4500' }),
      );
    });
  });

  // ── validación de unidad de medida ────────────────────────────────────────

  describe('validación de unidad de medida', () => {
    it('rechaza crear un producto con una unidad que no está en el catálogo', async () => {
      // La validación ocurre dentro de create(), después de validarMoneda y del
      // INSERT en items (mismo orden real de queries que el resto del describe
      // "create"), antes del INSERT INTO item_producto.
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([{ item_id: 'item-x' }]); // INSERT items RETURNING

      await expect(
        service.create('tenant-uuid', 'usuario-uuid', {
          nombre: 'Producto raro',
          precioBase: '1000',
          monedaId: 'moneda-uuid',
          tipo: 'producto',
          unidadMedida: 'inventada',
        }),
      ).rejects.toThrow('Unidad de medida no reconocida: inventada');
    });

    it('rechaza cambiar la unidad de un producto que ya tiene movimientos', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }]) // lectura del item
        .mockResolvedValueOnce([{ unidad_medida: 'kg' }]) // unidad actual
        .mockResolvedValueOnce([{ cnt: '3' }]); // movimientos existentes

      await expect(
        service.update('tenant-uuid', 'item-uuid', { unidadMedida: 'g' }),
      ).rejects.toThrow(
        'No se puede cambiar la unidad de medida de un producto con movimientos registrados',
      );
    });

    it('permite reenviar la misma unidad en una edición aunque haya movimientos', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([{ unidad_medida: 'kg' }])
        .mockResolvedValue([]);

      await expect(
        service.update('tenant-uuid', 'item-uuid', { unidadMedida: 'kg' }),
      ).resolves.toBeDefined();
    });
  });

  describe('ajustarStock — conversión de unidades', () => {
    it('convierte la cantidad a la unidad base antes de registrar el movimiento', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([
          { unidad_medida: 'kg', modo_inventario: 'cantidad' },
        ]);
      catalogServiceMock.convertirUnidad.mockResolvedValue('0.5');
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        stockResultante: '0.5000',
      });

      await service.ajustarStock('tenant-uuid', 'usuario-uuid', 'item-uuid', {
        cantidad: 500,
        tipo: 'entrada',
        motivo: 'compra',
        unidadCodigo: 'g',
      } as never);

      expect(catalogServiceMock.convertirUnidad).toHaveBeenCalledWith('500', 'g', 'kg');
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({ cantidad: '0.5' }),
      );
    });

    it('no consulta el catálogo si no se envía unidadCodigo', async () => {
      managerMock.query.mockResolvedValueOnce([{ tipo: 'producto' }]);
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        stockResultante: '10.0000',
      });

      await service.ajustarStock('tenant-uuid', 'usuario-uuid', 'item-uuid', {
        cantidad: 10,
        tipo: 'entrada',
        motivo: 'compra',
      } as never);

      expect(catalogServiceMock.convertirUnidad).not.toHaveBeenCalled();
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({ cantidad: '10' }),
      );
    });

    it('rechaza una unidad distinta a la base en productos por serie', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([
          { unidad_medida: 'unidad', modo_inventario: 'serie' },
        ]);

      await expect(
        service.ajustarStock('tenant-uuid', 'usuario-uuid', 'item-uuid', {
          cantidad: 2,
          tipo: 'entrada',
          motivo: 'compra',
          unidadCodigo: 'kg',
        } as never),
      ).rejects.toThrow('solo admiten su unidad base');

      expect(inventarioServiceMock.registrarMovimiento).not.toHaveBeenCalled();
    });
  });
});
