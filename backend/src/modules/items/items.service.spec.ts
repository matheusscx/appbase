import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
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
const COMBO_ID = 'combo-uuid';
const COMBO_SIN_BLOQUEANTES_ID = 'combo-sin-bloqueantes-uuid';

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

    it('receta: agrega disponible = mínimo entre ingredientes bloqueantes', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            item_id: 'receta-uuid',
            nombre: 'Hamburguesa',
            descripcion: null,
            tipo: 'receta',
            activo: true,
            precio_base: '3500',
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
            modo_inventario: null,
            costo_actual: '1700',
            duracion_estimada: null,
            requiere_cita: null,
            frecuencia: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            cantidad: '1',
            unidad_codigo: 'unidad',
            ingrediente_unidad_medida: 'unidad',
            stock: '8',
          }, // pan
          {
            cantidad: '150',
            unidad_codigo: 'g',
            ingrediente_unidad_medida: 'kg',
            stock: '1',
          }, // carne: 1kg = 1000g
        ]);
      catalogServiceMock.convertirUnidad
        .mockResolvedValueOnce('1') // pan
        .mockResolvedValueOnce('0.15'); // carne 150g → 0.15kg

      const result = await service.findAll(TENANT, { tipo: 'receta' } as any);

      // pan: floor(8/1)=8; carne: floor(1/0.15)=6 → mínimo 6
      expect(result.data[0].disponible).toBe(6);
    });

    it('producto: disponible siempre es null', async () => {
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
            modo_inventario: 'cantidad',
            costo_actual: null,
            duracion_estimada: null,
            requiere_cita: null,
            frecuencia: null,
          },
        ]);

      const result = await service.findAll(TENANT, {});
      expect(result.data[0].disponible).toBeNull();
    });
  });

  // ── disponible de combo ────────────────────────────────────────────────────

  describe('disponible de combo', () => {
    it('es el mínimo floor(stock/cantidad) entre componentes bloqueantes; servicio se ignora', async () => {
      // producto stock 10, cantidad 2 → 5 ; receta disponible 3, cantidad 1 → 3 ; servicio ignorado
      // se espera 3
      dataSource.query.mockResolvedValueOnce([
        // calcularDisponibleCombo query
        {
          componente_item_id: 'prod-uuid',
          tipo: 'producto',
          cantidad: '2',
          stock: '10',
        },
        {
          componente_item_id: 'receta-uuid',
          tipo: 'receta',
          cantidad: '1',
          stock: null,
        },
        {
          componente_item_id: 'servicio-uuid',
          tipo: 'servicio',
          cantidad: '1',
          stock: null,
        },
      ]);

      jest
        .spyOn(service as any, 'calcularDisponibleReceta')
        .mockResolvedValueOnce(3);

      const disp = await (service as any).calcularDisponibleCombo(
        TENANT,
        COMBO_ID,
      );
      expect(disp).toBe(3);
    });

    it('devuelve null si el combo no tiene componentes bloqueantes', async () => {
      dataSource.query.mockResolvedValueOnce([]);

      const disp = await (service as any).calcularDisponibleCombo(
        TENANT,
        COMBO_SIN_BLOQUEANTES_ID,
      );
      expect(disp).toBeNull();
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

    it('extrasPermitidos: findOne receta incluye stock en ingredientes y extras', async () => {
      const baseRow = {
        item_id: ITEM_ID,
        nombre: 'Hamburguesa',
        descripcion: null,
        tipo: 'receta',
        activo: true,
        precio_base: '3500',
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
        modo_inventario: null,
        costo_actual: '1700',
        duracion_estimada: null,
        requiere_cita: null,
        frecuencia: null,
      };
      dataSource.query
        .mockResolvedValueOnce([baseRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            ingrediente_item_id: 'ingrediente-pan',
            ingrediente_nombre: 'Pan',
            cantidad: '1',
            unidad_codigo: 'unidad',
            bloqueante: true,
            stock: '8',
          },
        ])
        .mockResolvedValueOnce([
          {
            ingrediente_item_id: 'ingrediente-queso',
            ingrediente_nombre: 'Queso',
            cantidad: '20',
            unidad_codigo: 'g',
            precio_extra: '500',
            stock: '2.5',
          },
        ])
        .mockResolvedValueOnce([]); // grupoRows (sin grupos asociados)

      const result = await service.findOne(TENANT, ITEM_ID);

      expect(result.ingredientes).toEqual([
        {
          ingredienteItemId: 'ingrediente-pan',
          ingredienteNombre: 'Pan',
          cantidad: '1',
          unidadCodigo: 'unidad',
          bloqueante: true,
          stock: '8',
        },
      ]);
      expect(result.extrasPermitidos).toEqual([
        {
          ingredienteItemId: 'ingrediente-queso',
          ingredienteNombre: 'Queso',
          cantidad: '20',
          unidadCodigo: 'g',
          precioExtra: '500',
          stock: '2.5',
        },
      ]);
      const ingQuery = dataSource.query.mock.calls[4][0] as string;
      expect(ingQuery).toContain('ip.stock');
      const extrasQuery = dataSource.query.mock.calls[5][0] as string;
      expect(extrasQuery).toContain('receta_extras_permitidos');
      expect(extrasQuery).toContain('ip.stock');
    });

    it('findOne combo incluye componentes bloqueantes y no bloqueantes', async () => {
      const baseRow = {
        item_id: COMBO_ID,
        nombre: 'Combo Hamburguesa + Bebida',
        descripcion: null,
        tipo: 'combo',
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
        modo_inventario: null,
        costo_actual: '3000',
        duracion_estimada: null,
        requiere_cita: null,
        frecuencia: null,
      };
      dataSource.query
        .mockResolvedValueOnce([baseRow])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            componente_item_id: 'ingrediente-pan',
            componente_nombre: 'Hamburguesa',
            tipo: 'receta',
            cantidad: '1',
            bloqueante: true,
            stock: null,
          },
          {
            componente_item_id: 'servicio-envoltorio',
            componente_nombre: 'Envoltorio para llevar',
            tipo: 'servicio',
            cantidad: '1',
            bloqueante: false,
            stock: null,
          },
        ])
        .mockResolvedValueOnce([]); // grupoRows (sin grupos asociados)

      const result = await service.findOne(TENANT, COMBO_ID);

      expect(result.componentes).toEqual([
        {
          componenteItemId: 'ingrediente-pan',
          componenteNombre: 'Hamburguesa',
          tipo: 'receta',
          cantidad: '1',
          bloqueante: true,
          stock: null,
        },
        {
          componenteItemId: 'servicio-envoltorio',
          componenteNombre: 'Envoltorio para llevar',
          tipo: 'servicio',
          cantidad: '1',
          bloqueante: false,
          stock: null,
        },
      ]);
      expect(result.componentes.some((c) => c.bloqueante === true)).toBe(true);
      expect(result.componentes.some((c) => c.bloqueante === false)).toBe(true);

      const compQuery = dataSource.query.mock.calls[4][0] as string;
      expect(compQuery).toContain('combo_componentes');
      expect(compQuery).toContain('ip.stock');
      expect(compQuery).not.toContain('cc.bloqueante = true');
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
      expect(result).toMatchObject({ id: ITEM_ID });
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

      expect(result).toMatchObject({ id: ITEM_ID });
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

      expect(res).toMatchObject({ id: 'nuevo-item' });
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

      expect(res).toMatchObject({ id: 'item-s' });
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

      expect(result).toMatchObject({ id: ITEM_ID });
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

      it('rechaza un ingrediente que no es un ingrediente', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
          .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items
          .mockResolvedValueOnce([
            {
              tipo: 'producto',
              modo_inventario: 'cantidad',
              unidad_medida: 'unidad',
              costo_actual: '500',
            },
          ]); // lookup pan → producto vendible ya no vale como insumo

        await expect(
          service.create(TENANT, 'user-uuid', dtoReceta as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('validarYCostear rechaza insumo tipo producto', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
          .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items
          .mockResolvedValueOnce([
            {
              tipo: 'producto',
              modo_inventario: 'cantidad',
              unidad_medida: 'unidad',
              costo_actual: '500',
            },
          ]); // lookup pan → no es ingrediente

        await expect(
          service.create(TENANT, 'user-uuid', dtoReceta as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('rechaza un ingrediente en modo serie/lote', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }])
          .mockResolvedValueOnce([{ item_id: ITEM_ID }])
          .mockResolvedValueOnce([
            {
              tipo: 'ingrediente',
              modo_inventario: 'serie',
              unidad_medida: 'unidad',
              costo_actual: '500',
            },
          ]);

        await expect(
          service.create(TENANT, 'user-uuid', dtoReceta as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('happy path: calcula costoActual convirtiendo cada ingrediente a su unidad base', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
          .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items
          .mockResolvedValueOnce([
            {
              tipo: 'ingrediente',
              modo_inventario: 'cantidad',
              unidad_medida: 'unidad',
              costo_actual: '500',
            },
          ]) // pan
          .mockResolvedValueOnce([
            {
              tipo: 'ingrediente',
              modo_inventario: 'cantidad',
              unidad_medida: 'kg',
              costo_actual: '8000',
            },
          ]) // carne
          .mockResolvedValueOnce([]) // INSERT item_receta
          .mockResolvedValueOnce([]) // INSERT receta_ingredientes pan
          .mockResolvedValueOnce([]); // INSERT receta_ingredientes carne

        catalogServiceMock.convertirUnidad
          .mockResolvedValueOnce('1') // pan: unidad → unidad (sin cambio)
          .mockResolvedValueOnce('0.15'); // carne: 150 g → 0.15 kg

        const result = await service.create(TENANT, 'user-uuid', dtoReceta);

        expect(result).toMatchObject({ id: ITEM_ID });
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

    describe('extrasPermitidos', () => {
      const ingredientePan = {
        ingredienteItemId: 'ingrediente-pan',
        cantidad: '1',
        unidadCodigo: 'unidad',
        bloqueante: true,
      };
      const extraQueso = {
        ingredienteItemId: 'ingrediente-queso',
        cantidad: '20',
        unidadCodigo: 'g',
        precioExtra: '500',
      };
      const dtoRecetaConExtras = {
        nombre: 'Hamburguesa con extras',
        precioBase: '3500',
        monedaId: MONEDA_ID,
        tipo: 'receta',
        ingredientes: [ingredientePan],
        extrasPermitidos: [extraQueso],
      };

      it('create receta con extrasPermitidos válidos persiste e incluye extras en respuesta', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ codigo_iso: 'CLP', simbolo: '$' }]) // moneda
          .mockResolvedValueOnce([{ item_id: ITEM_ID, creado_el: new Date() }]) // INSERT items
          .mockResolvedValueOnce([
            {
              tipo: 'ingrediente',
              nombre: 'Pan',
              modo_inventario: 'cantidad',
              unidad_medida: 'unidad',
              costo_actual: '500',
            },
          ]) // lookup pan
          .mockResolvedValueOnce([]) // INSERT item_receta
          .mockResolvedValueOnce([]) // INSERT receta_ingredientes pan
          .mockResolvedValueOnce([
            {
              tipo: 'ingrediente',
              nombre: 'Queso',
              modo_inventario: 'cantidad',
              unidad_medida: 'kg',
            },
          ]) // lookup queso extra
          .mockResolvedValueOnce([]); // INSERT receta_extras_permitidos

        catalogServiceMock.convertirUnidad.mockResolvedValueOnce('1');

        const result = await service.create(
          TENANT,
          'user-uuid',
          dtoRecetaConExtras,
        );

        expect(result.extrasPermitidos).toEqual([
          {
            ingredienteItemId: 'ingrediente-queso',
            ingredienteNombre: 'Queso',
            cantidad: '20',
            unidadCodigo: 'g',
            precioExtra: '500',
          },
        ]);
        const insertExtra = managerMock.query.mock.calls.find(
          (c: unknown[]) =>
            typeof c[0] === 'string' &&
            c[0].includes('INSERT INTO receta_extras_permitidos'),
        );
        expect(insertExtra).toBeDefined();
        expect(insertExtra?.[1]).toEqual([
          TENANT,
          ITEM_ID,
          'ingrediente-queso',
          '20',
          'g',
          '500',
        ]);
      });

      it('create rechaza precioExtra negativo', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ codigo_iso: 'CLP', simbolo: '$' }])
          .mockResolvedValueOnce([{ item_id: ITEM_ID, creado_el: new Date() }])
          .mockResolvedValueOnce([
            {
              tipo: 'ingrediente',
              nombre: 'Pan',
              modo_inventario: 'cantidad',
              unidad_medida: 'unidad',
              costo_actual: '500',
            },
          ])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);

        catalogServiceMock.convertirUnidad.mockResolvedValueOnce('1');

        await expect(
          service.create(TENANT, 'user-uuid', {
            ...dtoRecetaConExtras,
            extrasPermitidos: [{ ...extraQueso, precioExtra: '-100' }],
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('create rechaza precioExtra no numérico', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ codigo_iso: 'CLP', simbolo: '$' }])
          .mockResolvedValueOnce([{ item_id: ITEM_ID, creado_el: new Date() }])
          .mockResolvedValueOnce([
            {
              tipo: 'ingrediente',
              nombre: 'Pan',
              modo_inventario: 'cantidad',
              unidad_medida: 'unidad',
              costo_actual: '500',
            },
          ])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);

        catalogServiceMock.convertirUnidad.mockResolvedValueOnce('1');

        await expect(
          service.create(TENANT, 'user-uuid', {
            ...dtoRecetaConExtras,
            extrasPermitidos: [{ ...extraQueso, precioExtra: 'abc' }],
          } as any),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('create combo', () => {
      const PROD_ID = 'producto-uuid';
      const RECETA_ID = 'receta-uuid';
      const OTRO_COMBO_ID = 'combo-uuid';

      it('calcula costo_actual = Σ(costo componente × cantidad) e inserta componentes', async () => {
        // producto costo 500 ×1  +  receta costo 1200 ×1  = 1700
        const dto = {
          nombre: 'Combo Clásico',
          precioBase: '5000',
          monedaId: MONEDA_ID,
          tipo: 'combo',
          componentes: [
            { componenteItemId: PROD_ID, cantidad: '1', bloqueante: true },
            { componenteItemId: RECETA_ID, cantidad: '1', bloqueante: true },
          ],
        } as any;
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }]) // validarMoneda
          .mockResolvedValueOnce([{ item_id: ITEM_ID, creado_el: new Date() }]) // INSERT items
          .mockResolvedValueOnce([
            {
              nombre: 'Producto base',
              tipo: 'producto',
              costo_actual: '500',
            },
          ]) // lookup PROD_ID
          .mockResolvedValueOnce([
            {
              nombre: 'Receta base',
              tipo: 'receta',
              costo_actual: '1200',
            },
          ]) // lookup RECETA_ID
          .mockResolvedValueOnce([]) // INSERT item_combo
          .mockResolvedValueOnce([]) // INSERT combo_componentes PROD_ID
          .mockResolvedValueOnce([]); // INSERT combo_componentes RECETA_ID

        const res = await service.create(TENANT, 'user-uuid', dto);
        expect(res.tipo).toBe('combo');
        expect(res.costoActual).toBe('1700');
        expect(res.componentes).toHaveLength(2);
      });

      it('rechaza un combo sin componentes', async () => {
        const dto = {
          nombre: 'X',
          precioBase: '1',
          monedaId: MONEDA_ID,
          tipo: 'combo',
          componentes: [],
        } as any;
        await expect(service.create(TENANT, 'user-uuid', dto)).rejects.toThrow(
          'Los combos requieren al menos un componente',
        );
      });

      it('rechaza un componente de tipo combo o suscripcion', async () => {
        const dto = {
          nombre: 'X',
          precioBase: '1',
          monedaId: MONEDA_ID,
          tipo: 'combo',
          componentes: [{ componenteItemId: OTRO_COMBO_ID, cantidad: '1' }],
        } as any;
        managerMock.query
          .mockResolvedValueOnce([{ '?column?': 1 }]) // validarMoneda
          .mockResolvedValueOnce([{ item_id: ITEM_ID, creado_el: new Date() }]) // INSERT items
          .mockResolvedValueOnce([
            {
              nombre: 'Otro combo',
              tipo: 'combo',
              costo_actual: '5000',
            },
          ]); // lookup OTRO_COMBO_ID

        await expect(service.create(TENANT, 'user-uuid', dto)).rejects.toThrow(
          /componente.*producto.*receta.*servicio/i,
        );
      });

      it('rechaza componentes duplicados (mismo componenteItemId dos veces) sin consultar la BD', async () => {
        const componentes = [
          { componenteItemId: PROD_ID, cantidad: '1', bloqueante: true },
          { componenteItemId: PROD_ID, cantidad: '2', bloqueante: true },
        ];

        await expect(
          (service as any).validarYCostearComponentes(
            managerMock,
            TENANT,
            componentes,
          ),
        ).rejects.toThrow(
          new BadRequestException(
            'Un item no puede aparecer más de una vez como componente del combo',
          ),
        );
        expect(managerMock.query).not.toHaveBeenCalled();
      });
    });

    describe('ingrediente', () => {
      const dtoIng = {
        nombre: 'Carne molida',
        precioBase: '999',
        monedaId: MONEDA_ID,
        tipo: 'ingrediente',
        stock: '10',
        unidadMedida: 'kg',
        costo: '8000',
      };

      it('persiste precio_base = 0 aunque llegue precioBase distinto', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ codigo_iso: 'CLP', simbolo: '$' }]) // moneda
          .mockResolvedValueOnce([{ item_id: ITEM_ID, creado_el: new Date() }])
          .mockResolvedValueOnce(undefined); // INSERT item_producto
        inventarioServiceMock.registrarMovimiento.mockResolvedValue({
          movimientoId: 'mov-ing',
          stockAnterior: '0',
          stockResultante: '10',
        });

        await service.create(TENANT, 'user-uuid', dtoIng);

        const insertItemsCall = managerMock.query.mock.calls.find(
          (c: unknown[]) => String(c[0]).includes('INSERT INTO items'),
        );
        expect(insertItemsCall[1][5]).toBe('0'); // precio_base
        expect(insertItemsCall[1][8]).toBe('ingrediente'); // tipo
      });

      it('rechaza modoInventario serie', async () => {
        await expect(
          service.create(TENANT, 'user-uuid', {
            ...dtoIng,
            modoInventario: 'serie',
          } as any),
        ).rejects.toThrow(BadRequestException);
      });

      it('rechaza impuestosIds', async () => {
        await expect(
          service.create(TENANT, 'user-uuid', {
            ...dtoIng,
            impuestosIds: ['imp-1'],
          } as any),
        ).rejects.toThrow(BadRequestException);
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

      expect(res).toMatchObject({ id: 'item-l' });
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

      await service.create(TENANT, 'user-uuid', {
        nombre: 'Carne molida',
        precioBase: '6000',
        monedaId: 'moneda-uuid',
        tipo: 'producto',
        costo: '4000',
      });

      const insertProducto = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('INSERT INTO item_producto'),
      );
      expect(insertProducto?.[0]).toContain('costo_actual');
      expect(insertProducto?.[1]).toContain('4000');
    });

    it('persiste la clasificación tributaria y la devuelve en la respuesta', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
        .mockResolvedValueOnce([]); // INSERT item_producto
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-0',
        stockAnterior: '0',
        stockResultante: '5',
      });

      const result = await service.create(TENANT, 'user-uuid', {
        ...baseDtoProducto,
        clasificacionTributaria: 'exento',
      });

      const insertCall = managerMock.query.mock.calls.find((c) =>
        (c[0] as string).includes('INSERT INTO items'),
      );
      expect(insertCall?.[1]).toContain('exento');
      expect(result).toMatchObject({ clasificacionTributaria: 'exento' });
    });

    it('default afecto cuando no se envía clasificación', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }])
        .mockResolvedValueOnce([{ item_id: ITEM_ID }])
        .mockResolvedValueOnce([]);
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-0',
        stockAnterior: '0',
        stockResultante: '5',
      });

      const result = await service.create(TENANT, 'user-uuid', baseDtoProducto);

      expect(result).toMatchObject({ clasificacionTributaria: 'afecto' });
    });

    it('valida impuestos aceptando los del catálogo del sistema (pais_id)', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([{ cnt: '1' }]) // validarImpuestos
        .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
        .mockResolvedValue([]); // extensión + item_impuestos
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-0',
        stockAnterior: '0',
        stockResultante: '5',
      });

      await service.create(TENANT, 'user-uuid', {
        ...baseDtoProducto,
        impuestosIds: ['iva-sistema'],
      });

      const valCall = managerMock.query.mock.calls[1];
      expect(valCall[0]).toContain('pais_id');
      expect(valCall[1]).toEqual([['iva-sistema'], TENANT]);
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
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', unidad_medida: 'kg' },
        ]) // SELECT actual
        .mockResolvedValueOnce([{ cnt: '3' }]); // COUNT movimientos > 0

      await expect(
        service.update(TENANT, ITEM_ID, { modoInventario: 'lote' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('permite reenviar el mismo modoInventario con movimientos al actualizar costo', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }]) // SELECT existing
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', unidad_medida: 'kg' },
        ]) // SELECT actual — mismo modo
        .mockResolvedValueOnce(undefined); // UPDATE item_producto

      await service.update(TENANT, ITEM_ID, {
        modoInventario: 'cantidad',
        costo: '9000',
      });

      const calls = managerMock.query.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(
        calls.some((sql) => sql.includes('FROM movimientos_inventario')),
      ).toBe(false);
      expect(calls.some((sql) => sql.includes('UPDATE item_producto'))).toBe(
        true,
      );
    });

    it('permite cambio de modoInventario si NO existen movimientos', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }]) // SELECT existing
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', unidad_medida: 'kg' },
        ]) // SELECT actual
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

      expect(result).toMatchObject({ id: ITEM_ID });
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

      await service.update(TENANT, ITEM_ID, { costo: '4300' });

      const updateProducto = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('UPDATE item_producto') &&
          c[0].includes('costo_actual'),
      );
      expect(updateProducto).toBeDefined();
      expect(updateProducto?.[1]).toContain('4300');
    });

    it('receta: reemplaza los ingredientes y recalcula costoActual', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'receta' }]) // SELECT existente
        .mockResolvedValueOnce([
          {
            tipo: 'ingrediente',
            modo_inventario: 'cantidad',
            unidad_medida: 'kg',
            costo_actual: '6000',
          },
        ]) // queso
        .mockResolvedValueOnce([]) // soft-delete receta_ingredientes
        .mockResolvedValueOnce([]) // INSERT receta_ingredientes queso
        .mockResolvedValueOnce([]); // UPDATE item_receta costo_actual

      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('0.02'); // 20 g → 0.02 kg

      await service.update(TENANT, ITEM_ID, {
        ingredientes: [
          {
            ingredienteItemId: 'ingrediente-queso',
            cantidad: '20',
            unidadCodigo: 'g',
            bloqueante: false,
          },
        ],
      });

      // soft-delete de la lista anterior (nunca hard DELETE)
      expect(managerMock.query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('SET eliminado_el = NOW()'),
        [ITEM_ID],
      );
      // costo = 6000 * 0.02 = 120; limpia omitido al editar ingredientes
      const updateReceta = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('UPDATE item_receta') &&
          c[0].includes('costo_actual'),
      );
      expect(updateReceta?.[0]).toContain('costo_propuesto_omitido = NULL');
      expect(updateReceta?.[1]).toEqual(['120', ITEM_ID]);
    });

    it('extrasPermitidos: update soft-deletea extras previos e inserta nuevos', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'receta' }])
        .mockResolvedValueOnce([
          {
            tipo: 'ingrediente',
            nombre: 'Queso',
            modo_inventario: 'cantidad',
            unidad_medida: 'kg',
          },
        ])
        .mockResolvedValueOnce([]) // soft-delete receta_extras_permitidos
        .mockResolvedValueOnce([]); // INSERT receta_extras_permitidos

      const result = await service.update(TENANT, ITEM_ID, {
        extrasPermitidos: [
          {
            ingredienteItemId: 'ingrediente-queso',
            cantidad: '30',
            unidadCodigo: 'g',
            precioExtra: '600',
          },
        ],
      });

      const softDeleteCall = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('receta_extras_permitidos') &&
          c[0].includes('eliminado_el = NOW()'),
      );
      expect(softDeleteCall).toBeDefined();
      expect(softDeleteCall?.[1]).toEqual([ITEM_ID, TENANT]);
      const insertCall = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('INSERT INTO receta_extras_permitidos'),
      );
      expect(insertCall?.[1]).toEqual([
        TENANT,
        ITEM_ID,
        'ingrediente-queso',
        '30',
        'g',
        '600',
      ]);
      expect(result.extrasPermitidos).toEqual([
        {
          ingredienteItemId: 'ingrediente-queso',
          ingredienteNombre: 'Queso',
          cantidad: '30',
          unidadCodigo: 'g',
          precioExtra: '600',
        },
      ]);
    });

    it.each([
      { field: 'impuestosIds', value: ['imp-1'] },
      { field: 'recargosIds', value: ['rec-1'] },
      { field: 'descuentosIds', value: ['desc-1'] },
    ])('rechaza $field en ingrediente', async ({ field, value }) => {
      managerMock.query.mockResolvedValueOnce([
        { item_id: ITEM_ID, tipo: 'ingrediente' },
      ]);

      await expect(
        service.update(TENANT, ITEM_ID, { [field]: value } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza modoInventario distinto de cantidad en ingrediente', async () => {
      managerMock.query.mockResolvedValueOnce([
        { item_id: ITEM_ID, tipo: 'ingrediente' },
      ]);

      await expect(
        service.update(TENANT, ITEM_ID, { modoInventario: 'lote' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('persiste precio_base = 0 al actualizar ingrediente con precioBase', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'ingrediente' }]) // SELECT existing
        .mockResolvedValueOnce(undefined); // UPDATE items

      await service.update(TENANT, ITEM_ID, { precioBase: '999' });

      const updateItems = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].includes('UPDATE items'),
      );
      expect(updateItems).toBeDefined();
      expect(updateItems?.[1]?.[0]).toBe('0');
    });

    describe('update/remove combo', () => {
      const PROD_ID = 'producto-uuid';

      it('reemplaza componentes y recalcula costo en update', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ item_id: COMBO_ID, tipo: 'combo' }]) // SELECT existing
          .mockResolvedValueOnce([
            {
              nombre: 'Producto base',
              tipo: 'producto',
              costo_actual: '500',
            },
          ]) // lookup PROD_ID
          .mockResolvedValueOnce([]) // soft-delete combo_componentes
          .mockResolvedValueOnce([]) // INSERT combo_componentes
          .mockResolvedValueOnce([]) // UPDATE item_combo
          .mockResolvedValueOnce([{ componentes: '1', grupos: '0' }]); // conteo vivos post-cambio

        const patch = await service.update(TENANT, COMBO_ID, {
          componentes: [
            { componenteItemId: PROD_ID, cantidad: '2', bloqueante: true },
          ],
        });
        expect(patch.costoActual).toBe('1000'); // costo 500 × 2
        expect(patch.componentes).toHaveLength(1);
      });

      it('permite vaciar los componentes si el combo conserva un grupo vivo (solo-grupos, costo 0)', async () => {
        // Simétrico con create(): un combo puede quedar solo-grupos vía PATCH
        // `componentes: []` mientras sobreviva ≥1 grupo. No debe llamar a
        // validarYCostearComponentes (que rechaza []) y su costo se vuelve 0.
        managerMock.query
          .mockResolvedValueOnce([{ item_id: COMBO_ID, tipo: 'combo' }]) // SELECT existing
          .mockResolvedValueOnce([]) // soft-delete combo_componentes
          .mockResolvedValueOnce([]) // UPDATE item_combo costo_actual = 0
          .mockResolvedValueOnce([{ componentes: '0', grupos: '1' }]); // conteo vivos post-cambio

        const patch = await service.update(TENANT, COMBO_ID, {
          componentes: [],
        });
        expect(patch.costoActual).toBe('0');
        expect(patch.componentes).toEqual([]);
      });

      it('rechaza vaciar los grupos de un combo solo-grupos (queda huérfano)', async () => {
        // Combo creado sin componentes fijos (solo grupos, Ticket B). El PATCH
        // no toca `componentes` (nunca existieron) y vacía `gruposModificadores`
        // — sin la validación, el combo queda sin componentes NI grupos.
        managerMock.query
          .mockResolvedValueOnce([{ item_id: COMBO_ID, tipo: 'combo' }]) // SELECT existing
          .mockResolvedValueOnce([]) // SELECT asociaciones vivas (ninguna)
          .mockResolvedValueOnce([{ componentes: '0', grupos: '0' }]); // conteo vivos post-cambio

        await expect(
          service.update(TENANT, COMBO_ID, { gruposModificadores: [] }),
        ).rejects.toThrow(BadRequestException);
      });

      it('permite vaciar los grupos si el combo conserva otro grupo vivo', async () => {
        const OTRO_GRUPO_ID = 'otro-grupo-uuid';
        managerMock.query
          .mockResolvedValueOnce([{ item_id: COMBO_ID, tipo: 'combo' }]) // SELECT existing
          .mockResolvedValueOnce([]) // SELECT asociaciones vivas (ninguna)
          .mockResolvedValueOnce([{ grupo_modificador_id: OTRO_GRUPO_ID }]) // grupo existe/pertenece al tenant
          .mockResolvedValueOnce([{ item_grupo_id: 'ig-otro-uuid' }]) // INSERT asociación RETURNING
          .mockResolvedValueOnce([]) // SELECT overrides vivos (ninguno)
          .mockResolvedValueOnce([{ componentes: '0', grupos: '1' }]); // conteo vivos post-cambio

        const patch = await service.update(TENANT, COMBO_ID, {
          gruposModificadores: [
            { grupoModificadorId: OTRO_GRUPO_ID, min: 1, max: 1, orden: 0 },
          ],
        });

        expect(patch.gruposModificadores).toHaveLength(1);
      });

      it('bloquea borrar un item usado como componente de un combo vivo', async () => {
        itemRepo.findOne.mockResolvedValueOnce({
          id: PROD_ID,
          tenantId: TENANT,
        });
        dataSource.query
          .mockResolvedValueOnce([]) // no receta_ingredientes
          .mockResolvedValueOnce([{ nombre: 'Combo Clásico' }]); // combo usage

        await expect(service.remove(TENANT, PROD_ID)).rejects.toThrow(
          /No se puede eliminar.*componente de/i,
        );
      });
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

    it('bloquea el borrado si el item es ingrediente de una receta activa', async () => {
      itemRepo.findOne.mockResolvedValueOnce({ id: ITEM_ID, tenantId: TENANT });
      dataSource.query.mockResolvedValueOnce([
        { nombre: 'Hamburguesa Clásica' },
      ]);

      await expect(service.remove(TENANT, ITEM_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('permite el borrado si el item no es ingrediente de ninguna receta', async () => {
      itemRepo.findOne.mockResolvedValueOnce({ id: ITEM_ID, tenantId: TENANT });
      dataSource.query
        .mockResolvedValueOnce([]) // sin recetas que lo usen
        .mockResolvedValueOnce([]) // sin combos que lo usen
        .mockResolvedValueOnce([]) // sin grupos que lo usen como opción
        .mockResolvedValueOnce([]); // UPDATE items (soft delete)

      await expect(service.remove(TENANT, ITEM_ID)).resolves.toBeUndefined();
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

    it('rechaza si el item no es inventariable', async () => {
      managerMock.query.mockResolvedValueOnce([{ tipo: 'servicio' }]);

      await expect(
        service.ajustarStock(TENANT, 'user-uuid', ITEM_ID, {
          cantidad: 5,
          tipo: 'entrada',
          motivo: 'compra',
        }),
      ).rejects.toThrow('El item no es inventariable');
    });

    it('ajustarStock acepta ingrediente', async () => {
      managerMock.query.mockResolvedValueOnce([{ tipo: 'ingrediente' }]);
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-1',
        stockAnterior: '0',
        stockResultante: '1',
      });

      await expect(
        service.ajustarStock(TENANT, 'user-uuid', ITEM_ID, {
          tipo: 'entrada',
          motivo: 'ajuste_manual',
          cantidad: '1',
        } as any),
      ).resolves.toEqual(expect.objectContaining({ stock: expect.anything() }));
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
      ).resolves.toMatchObject({ id: 'item-uuid', unidadMedida: 'kg' });
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

      expect(catalogServiceMock.convertirUnidad).toHaveBeenCalledWith(
        '500',
        'g',
        'kg',
      );
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

  describe('resolverPersonalizacionReceta', () => {
    const RECETA_ID = 'receta-uuid';
    const PAN_ID = 'pan-uuid';
    const QUESO_ID = 'queso-uuid';
    const TOMATE_ID = 'tomate-uuid';

    function mockIngredientesYExtras() {
      managerMock.query
        .mockResolvedValueOnce([
          {
            ingrediente_item_id: PAN_ID,
            ingrediente_nombre: 'Pan',
            ingrediente_unidad_medida: 'unidad',
            cantidad: '1',
            unidad_codigo: 'unidad',
            bloqueante: true,
          },
          {
            ingrediente_item_id: TOMATE_ID,
            ingrediente_nombre: 'Tomate',
            ingrediente_unidad_medida: 'kg',
            cantidad: '50',
            unidad_codigo: 'g',
            bloqueante: false,
          },
        ])
        .mockResolvedValueOnce([
          {
            ingrediente_item_id: QUESO_ID,
            ingrediente_nombre: 'Queso',
            cantidad: '30',
            unidad_codigo: 'g',
            precio_extra: '500.0000',
          },
        ])
        // resolverGruposDeItem: la receta no tiene grupos de modificadores asociados.
        .mockResolvedValueOnce([]);
    }

    it('suma precios de extras del catálogo y arma snapshot', async () => {
      mockIngredientesYExtras();

      const result = await service.resolverPersonalizacionReceta(
        managerMock as any,
        TENANT,
        RECETA_ID,
        {
          omitidos: [TOMATE_ID],
          extras: [{ ingredienteItemId: QUESO_ID }],
          comentario: '  sin tomate  ',
        },
      );

      expect(result.precioExtraTotal).toBe('500.0000');
      expect(result.snapshot).toEqual({
        omitidos: [TOMATE_ID],
        extras: [
          {
            ingredienteItemId: QUESO_ID,
            cantidad: '30',
            unidadCodigo: 'g',
            precioExtra: '500.0000',
            unidades: '1',
          },
        ],
        comentario: 'sin tomate',
      });
    });

    it('multiplica el precio del extra por unidades y las guarda en el snapshot', async () => {
      mockIngredientesYExtras();

      const result = await service.resolverPersonalizacionReceta(
        managerMock as any,
        TENANT,
        RECETA_ID,
        { extras: [{ ingredienteItemId: QUESO_ID, unidades: 3 }] },
      );

      expect(result.precioExtraTotal).toBe('1500.0000');
      expect(result.snapshot.extras).toEqual([
        {
          ingredienteItemId: QUESO_ID,
          cantidad: '30',
          unidadCodigo: 'g',
          precioExtra: '500.0000',
          unidades: '3',
        },
      ]);
    });

    it('rechaza extra no permitido para la receta', async () => {
      mockIngredientesYExtras();

      await expect(
        service.resolverPersonalizacionReceta(
          managerMock as any,
          TENANT,
          RECETA_ID,
          { extras: [{ ingredienteItemId: 'extra-ajeno' }] },
        ),
      ).rejects.toThrow(
        new BadRequestException('Extra no permitido para esta receta'),
      );
    });

    it('rechaza omitido que no pertenece a la receta', async () => {
      mockIngredientesYExtras();

      await expect(
        service.resolverPersonalizacionReceta(
          managerMock as any,
          TENANT,
          RECETA_ID,
          { omitidos: ['ingrediente-ajeno'] },
        ),
      ).rejects.toThrow(
        new BadRequestException('Ingrediente omitido no pertenece a la receta'),
      );
    });

    it('rechaza extra duplicado en la personalización', async () => {
      await expect(
        service.resolverPersonalizacionReceta(
          managerMock as any,
          TENANT,
          RECETA_ID,
          {
            extras: [
              { ingredienteItemId: QUESO_ID },
              { ingredienteItemId: QUESO_ID },
            ],
          },
        ),
      ).rejects.toThrow(
        new BadRequestException('Extra duplicado en la personalización'),
      );
      expect(managerMock.query).not.toHaveBeenCalled();
    });

    it('rechaza omitido duplicado en la personalización', async () => {
      await expect(
        service.resolverPersonalizacionReceta(
          managerMock as any,
          TENANT,
          RECETA_ID,
          { omitidos: [TOMATE_ID, TOMATE_ID] },
        ),
      ).rejects.toThrow(
        new BadRequestException(
          'Ingrediente omitido duplicado en la personalización',
        ),
      );
      expect(managerMock.query).not.toHaveBeenCalled();
    });
  });

  describe('resolverGruposDeItem', () => {
    const GRUPO_ID = 'grupo-uuid';
    const OPCION_ID = 'opcion-uuid';
    const OPCION_AJENA_ID = 'opcion-ajena-uuid';

    it('congela opciones y suma precioExtra × unidades; valida min/max', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: GRUPO_ID, nombre: 'Tamaño', min: 1, max: 1 },
        ])
        .mockResolvedValueOnce([
          {
            item_id: OPCION_ID,
            nombre: 'Grande',
            cantidad: '1',
            unidad_codigo: null,
            precio_extra: '1500.0000',
          },
        ]);

      const res = await service.resolverGruposDeItem(
        managerMock as any,
        TENANT,
        ITEM_ID,
        [{ grupoId: GRUPO_ID, opciones: [{ itemId: OPCION_ID, unidades: 1 }] }],
      );

      expect(res.precioExtraTotal).toBe('1500.0000');
      expect(res.grupos[0].opciones[0].nombre).toBeDefined();
    });

    it('rechaza Σ unidades fuera de [min, max]', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: GRUPO_ID, nombre: 'Tamaño', min: 1, max: 1 },
        ])
        .mockResolvedValueOnce([
          {
            item_id: OPCION_ID,
            nombre: 'Grande',
            cantidad: '1',
            unidad_codigo: null,
            precio_extra: '1500.0000',
          },
        ]);

      await expect(
        service.resolverGruposDeItem(managerMock as any, TENANT, ITEM_ID, [
          { grupoId: GRUPO_ID, opciones: [] }, // min 1 → 0 elegido
        ]),
      ).rejects.toThrow(/elegir|mínimo|entre/i);
    });

    it('rechaza una opción que no pertenece al grupo', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: GRUPO_ID, nombre: 'Tamaño', min: 1, max: 1 },
        ])
        .mockResolvedValueOnce([
          {
            item_id: OPCION_ID,
            nombre: 'Grande',
            cantidad: '1',
            unidad_codigo: null,
            precio_extra: '1500.0000',
          },
        ]);

      await expect(
        service.resolverGruposDeItem(managerMock as any, TENANT, ITEM_ID, [
          {
            grupoId: GRUPO_ID,
            opciones: [{ itemId: OPCION_AJENA_ID, unidades: 1 }],
          },
        ]),
      ).rejects.toThrow(/no pertenece|opción/i);
    });
  });

  describe('venderIngredientesReceta', () => {
    const PARAMS = {
      tenantId: TENANT,
      usuarioId: 'user-uuid',
      ventaId: 'venta-uuid',
      recetaItemId: 'receta-uuid',
      recetaNombre: 'Hamburguesa',
      cantidadVendida: '2',
    };

    it('genera un movimiento de salida por cada ingrediente con la cantidad convertida', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          ingrediente_item_id: 'pan',
          ingrediente_nombre: 'Pan',
          ingrediente_unidad_medida: 'unidad',
          cantidad: '1',
          unidad_codigo: 'unidad',
          bloqueante: true,
        },
        {
          ingrediente_item_id: 'carne',
          ingrediente_nombre: 'Carne',
          ingrediente_unidad_medida: 'kg',
          cantidad: '150',
          unidad_codigo: 'g',
          bloqueante: true,
        },
      ]);
      catalogServiceMock.convertirUnidad
        .mockResolvedValueOnce('2') // pan: 1*2 unidad → unidad
        .mockResolvedValueOnce('0.3'); // carne: 150*2=300 g → 0.3 kg

      const advertencias = await service.venderIngredientesReceta(
        managerMock as any,
        PARAMS,
      );

      expect(advertencias).toEqual([]);
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledTimes(
        2,
      );
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenNthCalledWith(
        1,
        managerMock,
        expect.objectContaining({
          itemId: 'pan',
          cantidad: '2',
          motivo: 'venta',
        }),
      );
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenNthCalledWith(
        2,
        managerMock,
        expect.objectContaining({
          itemId: 'carne',
          cantidad: '0.3',
          motivo: 'venta',
        }),
      );
    });

    it('propaga el error si un ingrediente bloqueante no tiene stock (aborta la venta)', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          ingrediente_item_id: 'carne',
          ingrediente_nombre: 'Carne',
          ingrediente_unidad_medida: 'kg',
          cantidad: '150',
          unidad_codigo: 'g',
          bloqueante: true,
        },
      ]);
      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('0.3');
      inventarioServiceMock.registrarMovimiento.mockRejectedValueOnce(
        new BadRequestException('Stock insuficiente para la salida'),
      );

      await expect(
        service.venderIngredientesReceta(managerMock as any, PARAMS),
      ).rejects.toThrow(BadRequestException);
    });

    it('omite el movimiento y agrega advertencia si un ingrediente no bloqueante no tiene stock', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          ingrediente_item_id: 'queso',
          ingrediente_nombre: 'Queso',
          ingrediente_unidad_medida: 'kg',
          cantidad: '20',
          unidad_codigo: 'g',
          bloqueante: false,
        },
      ]);
      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('0.04'); // 20*2=40 g → 0.04 kg
      // Sin pre-chequeo de stock: registrarMovimiento lanza y se convierte en advertencia
      inventarioServiceMock.registrarMovimiento.mockRejectedValueOnce(
        new BadRequestException('Stock insuficiente para la salida'),
      );

      const advertencias = await service.venderIngredientesReceta(
        managerMock as any,
        PARAMS,
      );

      expect(advertencias).toEqual([
        'Hamburguesa: no había stock suficiente de Queso, se vendió sin ese insumo',
      ]);
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledTimes(
        1,
      );
    });

    it('no engulle errores distintos de stock insuficiente en no-bloqueantes', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          ingrediente_item_id: 'queso',
          ingrediente_nombre: 'Queso',
          ingrediente_unidad_medida: 'kg',
          cantidad: '20',
          unidad_codigo: 'g',
          bloqueante: false,
        },
      ]);
      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('0.04');
      inventarioServiceMock.registrarMovimiento.mockRejectedValueOnce(
        new BadRequestException('El item no tiene control de stock'),
      );

      await expect(
        service.venderIngredientesReceta(managerMock as any, PARAMS),
      ).rejects.toThrow('El item no tiene control de stock');
    });

    it('con snapshot omite ingredientes omitidos y descuenta extras como no bloqueantes', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          {
            ingrediente_item_id: 'pan',
            ingrediente_nombre: 'Pan',
            ingrediente_unidad_medida: 'unidad',
            cantidad: '1',
            unidad_codigo: 'unidad',
            bloqueante: true,
          },
          {
            ingrediente_item_id: 'tomate',
            ingrediente_nombre: 'Tomate',
            ingrediente_unidad_medida: 'kg',
            cantidad: '50',
            unidad_codigo: 'g',
            bloqueante: false,
          },
        ])
        .mockResolvedValueOnce([
          {
            ingrediente_item_id: 'queso',
            ingrediente_nombre: 'Queso',
            ingrediente_unidad_medida: 'kg',
            cantidad: '30',
            unidad_codigo: 'g',
            precio_extra: '500.0000',
          },
        ]);
      catalogServiceMock.convertirUnidad
        .mockResolvedValueOnce('2') // pan
        .mockResolvedValueOnce('0.06'); // extra queso: 30*2 g → kg

      const snapshot = {
        omitidos: ['tomate'],
        extras: [
          {
            ingredienteItemId: 'queso',
            cantidad: '30',
            unidadCodigo: 'g',
            precioExtra: '500.0000',
          },
        ],
      };

      const advertencias = await service.venderIngredientesReceta(
        managerMock as any,
        { ...PARAMS, snapshot },
      );

      expect(advertencias).toEqual([]);
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledTimes(
        2,
      );
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenNthCalledWith(
        1,
        managerMock,
        expect.objectContaining({ itemId: 'pan', cantidad: '2' }),
      );
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenNthCalledWith(
        2,
        managerMock,
        expect.objectContaining({ itemId: 'queso', cantidad: '0.06' }),
      );
      expect(
        inventarioServiceMock.registrarMovimiento,
      ).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ itemId: 'tomate' }),
      );
    });

    it('multiplica el consumo del extra por sus unidades', async () => {
      managerMock.query
        .mockResolvedValueOnce([]) // sin ingredientes base
        .mockResolvedValueOnce([
          {
            ingrediente_item_id: 'queso',
            ingrediente_nombre: 'Queso',
            ingrediente_unidad_medida: 'kg',
            cantidad: '30',
            unidad_codigo: 'g',
            precio_extra: '500.0000',
          },
        ]);
      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('0.12');

      const snapshot = {
        omitidos: [],
        extras: [
          {
            ingredienteItemId: 'queso',
            cantidad: '30',
            unidadCodigo: 'g',
            precioExtra: '500.0000',
            unidades: '2',
          },
        ],
      };

      await service.venderIngredientesReceta(managerMock as any, {
        ...PARAMS,
        snapshot,
      });

      // porción 30 g × 2 unidades × 2 vendidas = 120 g
      expect(catalogServiceMock.convertirUnidad).toHaveBeenCalledWith(
        '120',
        'g',
        'kg',
      );
    });

    it('descuenta también las opciones de grupo del snapshot (siempre bloqueante)', async () => {
      managerMock.query.mockResolvedValueOnce([]); // sin ingredientes base
      const spyOpciones = jest
        .spyOn(service as any, 'venderOpcionesGrupos')
        .mockResolvedValue(undefined);

      const grupos = [
        {
          grupoId: 'G',
          grupoNombre: 'Extra',
          opciones: [
            {
              itemId: 'bebida-uuid',
              nombre: 'Coca',
              cantidad: '1',
              precioExtra: '800',
              unidades: '1',
            },
          ],
        },
      ];

      await service.venderIngredientesReceta(managerMock as any, {
        ...PARAMS,
        snapshot: { omitidos: [], extras: [], grupos },
      });

      expect(spyOpciones).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          tenantId: PARAMS.tenantId,
          usuarioId: PARAMS.usuarioId,
          ventaId: PARAMS.ventaId,
          cantidadVendida: PARAMS.cantidadVendida,
        }),
        grupos,
      );
    });
  });

  describe('venderComponentesCombo', () => {
    const USUARIO_ID = 'usuario-uuid';
    const VENTA_ID = 'venta-uuid';
    const COMBO_NO_BLOQ_ID = 'combo-no-bloq-uuid';
    const COMBO_BLOQ_ID = 'combo-bloq-uuid';

    it('producto → salida; receta → venderIngredientesReceta; servicio → nada', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          componente_item_id: 'prod-uuid',
          componente_nombre: 'Papas',
          tipo: 'producto',
          cantidad: '1',
          bloqueante: true,
        },
        {
          componente_item_id: 'receta-uuid',
          componente_nombre: 'Hamburguesa',
          tipo: 'receta',
          cantidad: '1',
          bloqueante: true,
        },
        {
          componente_item_id: 'servicio-uuid',
          componente_nombre: 'Envoltura',
          tipo: 'servicio',
          cantidad: '1',
          bloqueante: true,
        },
      ]);
      const spyMov = jest
        .spyOn(inventarioServiceMock, 'registrarMovimiento')
        .mockResolvedValue({} as any);
      const spyReceta = jest
        .spyOn(service, 'venderIngredientesReceta')
        .mockResolvedValue([]);

      const advertencias = await service.venderComponentesCombo(
        managerMock as any,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          comboItemId: COMBO_ID,
          comboNombre: 'Combo',
          cantidadVendida: '2',
        },
      );

      expect(advertencias).toEqual([]);
      expect(spyMov).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({ itemId: 'prod-uuid', cantidad: '2' }),
      );
      expect(spyReceta).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          recetaItemId: 'receta-uuid',
          cantidadVendida: '2',
        }),
      );
      // servicio no genera movimiento ni delega en receta
      expect(spyMov).not.toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({ itemId: 'servicio-uuid' }),
      );
    });

    it('componente NO bloqueante sin stock → advertencia (no aborta)', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          componente_item_id: 'prod-uuid',
          componente_nombre: 'Papas',
          tipo: 'producto',
          cantidad: '1',
          bloqueante: false,
        },
      ]);
      jest
        .spyOn(inventarioServiceMock, 'registrarMovimiento')
        .mockRejectedValue(
          new BadRequestException('Stock insuficiente para la salida'),
        );

      const advertencias = await service.venderComponentesCombo(
        managerMock as any,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          comboItemId: COMBO_NO_BLOQ_ID,
          comboNombre: 'Combo',
          cantidadVendida: '1',
        },
      );

      expect(advertencias.length).toBe(1);
    });

    it('componente bloqueante sin stock → aborta', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          componente_item_id: 'prod-uuid',
          componente_nombre: 'Papas',
          tipo: 'producto',
          cantidad: '1',
          bloqueante: true,
        },
      ]);
      jest
        .spyOn(inventarioServiceMock, 'registrarMovimiento')
        .mockRejectedValue(
          new BadRequestException('Stock insuficiente para la salida'),
        );

      await expect(
        service.venderComponentesCombo(managerMock as any, {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          comboItemId: COMBO_BLOQ_ID,
          comboNombre: 'Combo',
          cantidadVendida: '1',
        }),
      ).rejects.toThrow('Stock insuficiente para la salida');
    });

    it('componente receta NO bloqueante sin disponible suficiente → pre-chequeo omite el llamado (cero escrituras)', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          componente_item_id: 'receta-uuid',
          componente_nombre: 'Hamburguesa',
          tipo: 'receta',
          cantidad: '1',
          bloqueante: false,
        },
      ]);
      // La receta solo tiene disponible 1, pero se necesitan 2 (cantidad 1 × cantidadVendida 2)
      const spyDisponible = jest
        .spyOn(service as any, 'calcularDisponibleReceta')
        .mockResolvedValueOnce(1);
      const spyReceta = jest
        .spyOn(service, 'venderIngredientesReceta')
        .mockResolvedValue([]);

      const advertencias = await service.venderComponentesCombo(
        managerMock as any,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          comboItemId: COMBO_NO_BLOQ_ID,
          comboNombre: 'Combo',
          cantidadVendida: '2',
        },
      );

      expect(spyDisponible).toHaveBeenCalledWith(TENANT, 'receta-uuid');
      // venderIngredientesReceta (y por ende registrarMovimiento para sus
      // ingredientes) NUNCA se llama: cero escrituras para esta receta.
      expect(spyReceta).not.toHaveBeenCalled();
      expect(inventarioServiceMock.registrarMovimiento).not.toHaveBeenCalled();
      expect(advertencias).toEqual([
        'Combo: no había stock suficiente de Hamburguesa, se vendió sin ese componente',
      ]);
    });

    it('componente receta NO bloqueante con disponible suficiente → procede normalmente', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          componente_item_id: 'receta-uuid',
          componente_nombre: 'Hamburguesa',
          tipo: 'receta',
          cantidad: '1',
          bloqueante: false,
        },
      ]);
      jest
        .spyOn(service as any, 'calcularDisponibleReceta')
        .mockResolvedValueOnce(5);
      const spyReceta = jest
        .spyOn(service, 'venderIngredientesReceta')
        .mockResolvedValue([]);

      const advertencias = await service.venderComponentesCombo(
        managerMock as any,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          comboItemId: COMBO_NO_BLOQ_ID,
          comboNombre: 'Combo',
          cantidadVendida: '2',
        },
      );

      expect(spyReceta).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          recetaItemId: 'receta-uuid',
          cantidadVendida: '2',
        }),
      );
      expect(advertencias).toEqual([]);
    });

    it('componente receta NO bloqueante con disponible=null (sin ingredientes bloqueantes) → procede normalmente', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          componente_item_id: 'receta-uuid',
          componente_nombre: 'Hamburguesa',
          tipo: 'receta',
          cantidad: '1',
          bloqueante: false,
        },
      ]);
      jest
        .spyOn(service as any, 'calcularDisponibleReceta')
        .mockResolvedValueOnce(null);
      const spyReceta = jest
        .spyOn(service, 'venderIngredientesReceta')
        .mockResolvedValue([]);

      const advertencias = await service.venderComponentesCombo(
        managerMock as any,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          comboItemId: COMBO_NO_BLOQ_ID,
          comboNombre: 'Combo',
          cantidadVendida: '2',
        },
      );

      expect(spyReceta).toHaveBeenCalled();
      expect(advertencias).toEqual([]);
    });

    it('descuenta también las opciones de grupo del snapshot (siempre bloqueante)', async () => {
      managerMock.query.mockResolvedValueOnce([]); // combo sin componentes fijos
      const spyOpciones = jest
        .spyOn(service as any, 'venderOpcionesGrupos')
        .mockResolvedValue(undefined);

      const grupos = [
        {
          grupoId: 'G',
          grupoNombre: 'Bebida',
          opciones: [
            {
              itemId: 'bebida-uuid',
              nombre: 'Coca',
              cantidad: '1',
              precioExtra: '800',
              unidades: '1',
            },
          ],
        },
      ];

      await service.venderComponentesCombo(managerMock as any, {
        tenantId: TENANT,
        usuarioId: USUARIO_ID,
        ventaId: VENTA_ID,
        comboItemId: COMBO_ID,
        comboNombre: 'Combo',
        cantidadVendida: '2',
        snapshot: { omitidos: [], extras: [], grupos },
      });

      expect(spyOpciones).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          cantidadVendida: '2',
        }),
        grupos,
      );
    });
  });

  describe('venderOpcionesGrupos', () => {
    const USUARIO_ID = 'usuario-uuid';
    const VENTA_ID = 'venta-uuid';
    const PROD_ID = 'bebida-uuid';
    const ING_ID = 'carne-uuid';
    const RECETA_ID = 'salsa-uuid';

    it('producto → salida; ingrediente → salida con conversión; receta → venderIngredientesReceta; servicio → nada', async () => {
      const spyMov = jest
        .spyOn(inventarioServiceMock, 'registrarMovimiento')
        .mockResolvedValue({} as any);
      const spyReceta = jest
        .spyOn(service, 'venderIngredientesReceta')
        .mockResolvedValue([]);
      catalogServiceMock.convertirUnidad.mockResolvedValue('200');
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto', unidad_medida: 'unidad' }])
        .mockResolvedValueOnce([{ tipo: 'ingrediente', unidad_medida: 'g' }])
        .mockResolvedValueOnce([{ tipo: 'receta', unidad_medida: null }]);

      await (service as any).venderOpcionesGrupos(
        managerMock,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          cantidadVendida: '2',
        },
        [
          {
            grupoId: 'G',
            grupoNombre: 'Proteína',
            opciones: [
              {
                itemId: PROD_ID,
                nombre: 'Coca',
                cantidad: '1',
                precioExtra: '0',
                unidades: '1',
              },
              {
                itemId: ING_ID,
                nombre: 'Carne',
                cantidad: '100',
                unidadCodigo: 'g',
                precioExtra: '0',
                unidades: '1',
              },
              {
                itemId: RECETA_ID,
                nombre: 'Salsa',
                cantidad: '1',
                precioExtra: '0',
                unidades: '1',
              },
            ],
          },
        ],
      );

      expect(spyMov).toHaveBeenCalledTimes(2); // producto + ingrediente
      expect(spyReceta).toHaveBeenCalled(); // receta
    });

    it('calcula cantidad = cantidad × unidades × cantidadVendida (producto, sin conversión)', async () => {
      const spyMov = jest
        .spyOn(inventarioServiceMock, 'registrarMovimiento')
        .mockResolvedValue({} as any);
      managerMock.query.mockResolvedValueOnce([
        { tipo: 'producto', unidad_medida: 'unidad' },
      ]);

      await (service as any).venderOpcionesGrupos(
        managerMock,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          cantidadVendida: '4',
        },
        [
          {
            grupoId: 'G',
            grupoNombre: 'Proteína',
            opciones: [
              {
                itemId: PROD_ID,
                nombre: 'Coca',
                cantidad: '2',
                precioExtra: '0',
                unidades: '3',
              },
            ],
          },
        ],
      );

      expect(spyMov).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          itemId: PROD_ID,
          tipo: 'salida',
          cantidad: '24', // 2 × 3 × 4
        }),
      );
    });

    it('para ingrediente convierte la cantidadTotal (cantidad × unidades × cantidadVendida) a la unidad base', async () => {
      jest
        .spyOn(inventarioServiceMock, 'registrarMovimiento')
        .mockResolvedValue({} as any);
      catalogServiceMock.convertirUnidad.mockResolvedValue('600');
      managerMock.query.mockResolvedValueOnce([
        { tipo: 'ingrediente', unidad_medida: 'g' },
      ]);

      await (service as any).venderOpcionesGrupos(
        managerMock,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          cantidadVendida: '2',
        },
        [
          {
            grupoId: 'G',
            grupoNombre: 'Proteína',
            opciones: [
              {
                itemId: ING_ID,
                nombre: 'Carne',
                cantidad: '100',
                unidadCodigo: 'g',
                precioExtra: '0',
                unidades: '3',
              },
            ],
          },
        ],
      );

      // cantidadTotal = 100 × 3 × 2 = 600 se pasa a convertirUnidad antes de la salida.
      expect(catalogServiceMock.convertirUnidad).toHaveBeenCalledWith(
        '600',
        'g',
        'g',
      );
    });

    it('opción sin stock → aborta (siempre bloqueante)', async () => {
      jest
        .spyOn(inventarioServiceMock, 'registrarMovimiento')
        .mockRejectedValue(
          new BadRequestException('Stock insuficiente para la salida'),
        );
      managerMock.query.mockResolvedValueOnce([
        { tipo: 'producto', unidad_medida: 'unidad' },
      ]);

      await expect(
        (service as any).venderOpcionesGrupos(
          managerMock,
          {
            tenantId: TENANT,
            usuarioId: USUARIO_ID,
            ventaId: VENTA_ID,
            cantidadVendida: '1',
          },
          [
            {
              grupoId: 'G',
              grupoNombre: 'Bebida',
              opciones: [
                {
                  itemId: PROD_ID,
                  nombre: 'Coca',
                  cantidad: '1',
                  precioExtra: '0',
                  unidades: '1',
                },
              ],
            },
          ],
        ),
      ).rejects.toThrow('Stock insuficiente para la salida');
    });

    it('grupos undefined → no hace nada', async () => {
      const spyMov = jest.spyOn(inventarioServiceMock, 'registrarMovimiento');

      await (service as any).venderOpcionesGrupos(
        managerMock,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          cantidadVendida: '1',
        },
        undefined,
      );

      expect(spyMov).not.toHaveBeenCalled();
      expect(managerMock.query).not.toHaveBeenCalled();
    });

    it('item tipo servicio → no genera movimiento ni delega en receta', async () => {
      const spyMov = jest.spyOn(inventarioServiceMock, 'registrarMovimiento');
      const spyReceta = jest.spyOn(service, 'venderIngredientesReceta');
      managerMock.query.mockResolvedValueOnce([
        { tipo: 'servicio', unidad_medida: null },
      ]);

      await (service as any).venderOpcionesGrupos(
        managerMock,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          cantidadVendida: '1',
        },
        [
          {
            grupoId: 'G',
            grupoNombre: 'Bebida',
            opciones: [
              {
                itemId: 'servicio-uuid',
                nombre: 'Envoltura',
                cantidad: '1',
                precioExtra: '0',
                unidades: '1',
              },
            ],
          },
        ],
      );

      expect(spyMov).not.toHaveBeenCalled();
      expect(spyReceta).not.toHaveBeenCalled();
    });
  });

  describe('desfases de costo de recetas', () => {
    const RECETA_ID = 'receta-1';
    const CARNE_ID = 'carne-1';

    function mockRecetaConIngredientes(opts: {
      costoCacheado: string;
      omitido: string | null;
      precioBase: string;
      ingredientes: {
        itemId: string;
        nombre: string;
        cantidad: string;
        unidadCodigo: string;
        unidadBase: string;
        costoActual: string | null;
      }[];
    }) {
      dataSource.query.mockResolvedValueOnce([
        {
          receta_item_id: RECETA_ID,
          nombre: 'Hamburguesa',
          costo_actual: opts.costoCacheado,
          costo_propuesto_omitido: opts.omitido,
          precio_base: opts.precioBase,
        },
      ]);
      dataSource.query.mockResolvedValueOnce(
        opts.ingredientes.map((i) => ({
          receta_item_id: RECETA_ID,
          ingrediente_item_id: i.itemId,
          ingrediente_nombre: i.nombre,
          cantidad: i.cantidad,
          unidad_codigo: i.unidadCodigo,
          unidad_base: i.unidadBase,
          costo_actual: i.costoActual,
        })),
      );
      for (const i of opts.ingredientes) {
        catalogServiceMock.convertirUnidad.mockResolvedValueOnce(
          i.unidadCodigo === i.unidadBase
            ? new Decimal(i.cantidad).toDecimalPlaces(4).toString()
            : new Decimal(i.cantidad).div(1000).toDecimalPlaces(4).toString(),
        );
      }
    }

    it('listarDesfases incluye receta cuando propuesto ≠ cacheado', async () => {
      mockRecetaConIngredientes({
        costoCacheado: '1820.0000',
        omitido: null,
        precioBase: '3500.0000',
        ingredientes: [
          {
            itemId: CARNE_ID,
            nombre: 'Carne',
            cantidad: '150',
            unidadCodigo: 'g',
            unidadBase: 'kg',
            costoActual: '9000',
          },
        ],
      });
      const rows = await service.listarDesfases(TENANT);
      expect(rows).toHaveLength(1);
      expect(rows[0].costoPropuesto).toBe('1350.0000');
      expect(rows[0].deltaCosto).toBe('-470.0000');
      expect(rows[0].margenPctActual).toBeTruthy();
      // Preserva margen %: 1350 × 3500 / 1820 = 2596.1538
      expect(rows[0].precioSugerido).toBe('2596.1538');
    });

    it('listarDesfases omite cuando propuesto == costo_propuesto_omitido', async () => {
      mockRecetaConIngredientes({
        costoCacheado: '1820.0000',
        omitido: '1350.0000',
        precioBase: '3500.0000',
        ingredientes: [
          {
            itemId: CARNE_ID,
            nombre: 'Carne',
            cantidad: '150',
            unidadCodigo: 'g',
            unidadBase: 'kg',
            costoActual: '9000',
          },
        ],
      });
      const rows = await service.listarDesfases(TENANT);
      expect(rows).toHaveLength(0);
    });

    it('listarDesfases no incluye cuando propuesto == cacheado', async () => {
      mockRecetaConIngredientes({
        costoCacheado: '1350.0000',
        omitido: null,
        precioBase: '3500.0000',
        ingredientes: [
          {
            itemId: CARNE_ID,
            nombre: 'Carne',
            cantidad: '150',
            unidadCodigo: 'g',
            unidadBase: 'kg',
            costoActual: '9000',
          },
        ],
      });
      const rows = await service.listarDesfases(TENANT);
      expect(rows).toHaveLength(0);
    });

    it('precioSugerido es null si precioBase = 0', async () => {
      mockRecetaConIngredientes({
        costoCacheado: '100.0000',
        omitido: null,
        precioBase: '0',
        ingredientes: [
          {
            itemId: CARNE_ID,
            nombre: 'Carne',
            cantidad: '1',
            unidadCodigo: 'kg',
            unidadBase: 'kg',
            costoActual: '200',
          },
        ],
      });
      const rows = await service.listarDesfases(TENANT);
      expect(rows[0].margenPctActual).toBeNull();
      expect(rows[0].precioSugerido).toBeNull();
    });

    it('recetasAfectadasPorIngrediente filtra por ingrediente', async () => {
      dataSource.query.mockResolvedValueOnce([{ '?column?': 1 }]);
      mockRecetaConIngredientes({
        costoCacheado: '100.0000',
        omitido: null,
        precioBase: '500.0000',
        ingredientes: [
          {
            itemId: CARNE_ID,
            nombre: 'Carne',
            cantidad: '1',
            unidadCodigo: 'kg',
            unidadBase: 'kg',
            costoActual: '200',
          },
        ],
      });
      const rows = await service.recetasAfectadasPorIngrediente(
        TENANT,
        CARNE_ID,
      );
      expect(rows).toHaveLength(1);
      // calls[0] = exists check; calls[1] = cabeceras filtradas por ingrediente
      expect(dataSource.query.mock.calls[0][0]).toContain(
        "tipo = 'ingrediente'",
      );
      expect(dataSource.query.mock.calls[1][0]).toContain(
        'ingrediente_item_id',
      );
      expect(dataSource.query.mock.calls[1][1]).toEqual(
        expect.arrayContaining([TENANT, CARNE_ID]),
      );
    });

    describe('aplicarDesfases / descartarDesfases', () => {
      it('aplicar recomputa costo, limpia omitido y actualiza precio si checkbox', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              tipo: 'receta',
            },
          ])
          .mockResolvedValueOnce([
            {
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);
        catalogServiceMock.convertirUnidad.mockResolvedValue('1');

        const result = await service.aplicarDesfases(TENANT, [
          {
            recetaItemId: RECETA_ID,
            actualizarPrecio: true,
            precioBase: '600.0000',
          },
        ]);
        expect(result.aplicados).toBe(1);
        expect(managerMock.query).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE item_receta'),
          expect.arrayContaining(['200.0000', RECETA_ID]),
        );
        expect(managerMock.query).toHaveBeenCalledWith(
          expect.stringContaining('UPDATE items SET precio_base'),
          expect.arrayContaining(['600.0000', RECETA_ID, TENANT]),
        );
      });

      it('aplicar sin checkbox no toca precio_base', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { receta_item_id: RECETA_ID, tipo: 'receta' },
          ])
          .mockResolvedValueOnce([
            {
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValueOnce([]);
        catalogServiceMock.convertirUnidad.mockResolvedValue('1');

        await service.aplicarDesfases(TENANT, [
          { recetaItemId: RECETA_ID, actualizarPrecio: false },
        ]);
        const sqls = managerMock.query.mock.calls.map(
          (c: unknown[]) => c[0] as string,
        );
        expect(
          sqls.some((s) => s.includes('UPDATE items SET precio_base')),
        ).toBe(false);
      });

      it('aplicar con actualizarPrecio exige precioBase > 0', async () => {
        await expect(
          service.aplicarDesfases(TENANT, [
            {
              recetaItemId: RECETA_ID,
              actualizarPrecio: true,
              precioBase: '0',
            },
          ]),
        ).rejects.toThrow(BadRequestException);
      });

      it('descartar setea costo_propuesto_omitido al propuesto actual', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ tipo: 'receta' }])
          .mockResolvedValueOnce([
            {
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValueOnce([]);
        catalogServiceMock.convertirUnidad.mockResolvedValue('1');

        const result = await service.descartarDesfases(TENANT, [RECETA_ID]);
        expect(result.descartados).toBe(1);
        expect(managerMock.query).toHaveBeenCalledWith(
          expect.stringContaining('costo_propuesto_omitido'),
          expect.arrayContaining(['200.0000', RECETA_ID]),
        );
      });

      it('descartar sin ingredientes vivos lanza BadRequest', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ tipo: 'receta' }])
          .mockResolvedValueOnce([]);

        await expect(
          service.descartarDesfases(TENANT, [RECETA_ID]),
        ).rejects.toThrow(BadRequestException);
        const omitSql = managerMock.query.mock.calls.find(
          (c: unknown[]) =>
            typeof c[0] === 'string' &&
            c[0].includes('SET costo_propuesto_omitido'),
        );
        expect(omitSql).toBeUndefined();
      });
    });
  });

  // ── grupos modificadores en item ──────────────────────────────────────────

  describe('grupos modificadores en item', () => {
    const GRUPO_ID = 'grupo-modificador-uuid';
    const PROD_ID = 'producto-uuid';
    const ITEM_OPCION_ID = 'item-opcion-uuid';
    const OPCION_ID = 'grupo-opcion-uuid';
    const OPCION_AJENA = 'grupo-opcion-ajena-uuid';

    it('asocia grupos a un combo con min/max válidos', async () => {
      const dto = {
        nombre: 'Combo Bebida',
        precioBase: '5000',
        monedaId: MONEDA_ID,
        tipo: 'combo',
        componentes: [
          { componenteItemId: PROD_ID, cantidad: '1', bloqueante: true },
        ],
        gruposModificadores: [
          { grupoModificadorId: GRUPO_ID, min: 1, max: 1, orden: 0 },
        ],
      } as any;
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // validarMoneda
        .mockResolvedValueOnce([{ item_id: ITEM_ID, creado_el: new Date() }]) // INSERT items
        .mockResolvedValueOnce([
          { nombre: 'Producto base', tipo: 'producto', costo_actual: '500' },
        ]) // lookup PROD_ID
        .mockResolvedValueOnce([]) // INSERT item_combo
        .mockResolvedValueOnce([]) // INSERT combo_componentes
        .mockResolvedValueOnce([]) // SELECT asociaciones vivas (ninguna)
        .mockResolvedValueOnce([{ grupo_modificador_id: GRUPO_ID }]) // grupo existe/pertenece al tenant
        .mockResolvedValueOnce([{ item_grupo_id: 'ig-nuevo-uuid' }]) // INSERT asociación RETURNING
        .mockResolvedValueOnce([]); // SELECT overrides vivos (ninguno)

      const res = await service.create(TENANT, 'user-uuid', dto);

      expect(res.tipo).toBe('combo');
      expect(managerMock.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO item_grupos_modificadores'),
        [TENANT, ITEM_ID, GRUPO_ID, 1, 1, 0],
      );
    });

    it('rechaza max < min', async () => {
      managerMock.query.mockResolvedValueOnce([]); // SELECT asociaciones vivas
      await expect(
        (service as any).asociarGruposModificadores(
          managerMock,
          TENANT,
          ITEM_ID,
          [{ grupoModificadorId: GRUPO_ID, min: 3, max: 1 }],
        ),
      ).rejects.toThrow(/máximo.*mayor o igual/i);
      expect(managerMock.query).not.toHaveBeenCalledWith(
        expect.stringContaining(
          'SELECT grupo_modificador_id FROM grupos_modificadores',
        ),
        expect.anything(),
      );
    });

    it('permite crear un combo sin componentes fijos si tiene un grupo', async () => {
      const dto = {
        nombre: 'Combo Solo Grupo',
        precioBase: '3000',
        monedaId: MONEDA_ID,
        tipo: 'combo',
        componentes: [],
        gruposModificadores: [{ grupoModificadorId: GRUPO_ID, min: 1, max: 1 }],
      } as any;
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // validarMoneda
        .mockResolvedValueOnce([{ item_id: ITEM_ID, creado_el: new Date() }]) // INSERT items
        .mockResolvedValueOnce([]) // INSERT item_combo (costo_actual = '0', sin componentes)
        .mockResolvedValueOnce([]) // SELECT asociaciones vivas (ninguna)
        .mockResolvedValueOnce([{ grupo_modificador_id: GRUPO_ID }]) // grupo existe/pertenece al tenant
        .mockResolvedValueOnce([{ item_grupo_id: 'ig-nuevo-uuid' }]) // INSERT asociación RETURNING
        .mockResolvedValueOnce([]); // SELECT overrides vivos (ninguno)

      const res = await service.create(TENANT, 'user-uuid', dto);
      expect(res).toBeDefined();
      expect(res.costoActual).toBe('0');
      expect(res.componentes).toEqual([]);
    });

    it('preserva item_grupo_id de una asociación que persiste (UPDATE min/max)', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { item_grupo_id: 'IG-EXIST', grupo_modificador_id: GRUPO_ID },
        ]) // asociaciones vivas
        .mockResolvedValueOnce([{ grupo_modificador_id: GRUPO_ID }]) // grupo existe/pertenece
        .mockResolvedValueOnce([]) // UPDATE de la asociación
        .mockResolvedValueOnce([]); // SELECT overrides vivos (ninguno)
      await (service as any).asociarGruposModificadores(
        managerMock,
        TENANT,
        ITEM_ID,
        [{ grupoModificadorId: GRUPO_ID, min: 1, max: 2, opciones: [] }],
      );
      const upd = managerMock.query.mock.calls.find((c) =>
        /UPDATE item_grupos_modificadores\s+SET min/i.test(c[0]),
      );
      expect(upd).toBeTruthy();
      expect(upd![1]).toContain('IG-EXIST');
    });

    it('persiste un override de cantidad para una opción del grupo asociado', async () => {
      managerMock.query
        .mockResolvedValueOnce([]) // sin asociaciones vivas
        .mockResolvedValueOnce([{ grupo_modificador_id: GRUPO_ID }]) // grupo existe
        .mockResolvedValueOnce([{ item_grupo_id: 'IG-NEW' }]) // INSERT asociación RETURNING
        .mockResolvedValueOnce([]) // sin overrides vivos previos
        .mockResolvedValueOnce([{ grupo_opcion_id: OPCION_ID }]) // opción pertenece al grupo
        .mockResolvedValueOnce([]); // INSERT override
      await (service as any).asociarGruposModificadores(
        managerMock,
        TENANT,
        ITEM_ID,
        [
          {
            grupoModificadorId: GRUPO_ID,
            min: 1,
            max: 1,
            opciones: [
              { grupoOpcionId: OPCION_ID, cantidad: '250', unidadCodigo: 'g' },
            ],
          },
        ],
      );
      const ins = managerMock.query.mock.calls.find((c) =>
        /INSERT INTO item_grupo_modificador_opciones/i.test(c[0]),
      );
      expect(ins).toBeTruthy();
      expect(ins![1]).toEqual(expect.arrayContaining(['250', 'g']));
    });

    it('rechaza un override cuya opción no pertenece al grupo', async () => {
      managerMock.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ grupo_modificador_id: GRUPO_ID }])
        .mockResolvedValueOnce([{ item_grupo_id: 'IG-NEW' }])
        .mockResolvedValueOnce([]) // sin overrides vivos previos
        .mockResolvedValueOnce([]); // opción NO pertenece
      await expect(
        (service as any).asociarGruposModificadores(
          managerMock,
          TENANT,
          ITEM_ID,
          [
            {
              grupoModificadorId: GRUPO_ID,
              min: 1,
              max: 1,
              opciones: [{ grupoOpcionId: OPCION_AJENA, cantidad: '1' }],
            },
          ],
        ),
      ).rejects.toThrow(/opción.*no pertenece al grupo/i);
    });

    it('bloquea borrar un item usado como opción de un grupo vivo', async () => {
      itemRepo.findOne.mockResolvedValueOnce({
        id: ITEM_OPCION_ID,
        tenantId: TENANT,
      });
      dataSource.query
        .mockResolvedValueOnce([]) // sin recetas que lo usen
        .mockResolvedValueOnce([]) // sin combos que lo usen
        .mockResolvedValueOnce([{ nombre: 'Proteína' }]); // usado como opción de grupo

      await expect(service.remove(TENANT, ITEM_OPCION_ID)).rejects.toThrow(
        /No se puede eliminar.*opción de/i,
      );
    });
  });
});
