import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { ItemsService } from './items.service';
import { Item } from './entities/item.entity';
import { ItemServicio } from './entities/item-servicio.entity';
import { InventarioService } from '../inventario/inventario.service';
import { CatalogService } from '../catalog/catalog.service';

const TENANT = 'tenant-uuid';
const ITEM_ID = 'item-uuid';
const USUARIO = 'usuario-uuid';
const MONEDA_ID = 'moneda-uuid';
const CATEGORIA_ID = 'categoria-uuid';
const COMBO_ID = 'combo-uuid';
const COMBO_SIN_BLOQUEANTES_ID = 'combo-sin-bloqueantes-uuid';

describe('ItemsService', () => {
  let service: ItemsService;
  let itemRepo: { findOne: jest.Mock };
  let itemServicioRepo: { findOne: jest.Mock };
  let managerMock: { query: jest.Mock };
  let dataSource: {
    query: jest.Mock;
    transaction: jest.Mock;
    manager: { query: jest.Mock };
  };
  let inventarioServiceMock: { registrarMovimiento: jest.Mock };
  let catalogServiceMock: {
    findAllUnidadesMedida: jest.Mock;
    convertirUnidad: jest.Mock;
    convertirUnidades: jest.Mock;
    crearConversor: jest.Mock;
  };
  let conversorMock: jest.Mock;

  beforeEach(async () => {
    managerMock = { query: jest.fn() };
    dataSource = {
      query: jest.fn(),
      manager: managerMock,
      transaction: jest.fn((cb: (m: typeof managerMock) => unknown) =>
        cb(managerMock),
      ),
    };
    itemRepo = { findOne: jest.fn() };
    itemServicioRepo = { findOne: jest.fn() };
    inventarioServiceMock = { registrarMovimiento: jest.fn() };
    // El conversor que devuelve `crearConversor`, con el catálogo ya cargado.
    // Su implementación por defecto reproduce la semántica real para las
    // unidades que usan los tests, así el costo se calcula de verdad en vez de
    // salir de un valor mockeado; los tests que necesitan un valor puntual (o
    // que la conversión falle) lo pisan con `mockReturnValueOnce` /
    // `mockImplementationOnce`. Es síncrono: el catálogo ya está en memoria.
    conversorMock = jest.fn(
      (cantidad: string, desde: string, hacia: string): string => {
        if (desde === hacia) return cantidad;
        const factor: Record<string, string> = {
          g: '1',
          kg: '1000',
          unidad: '1',
        };
        return new Decimal(cantidad)
          .mul(factor[desde] ?? '1')
          .div(factor[hacia] ?? '1')
          .toString();
      },
    );
    catalogServiceMock = {
      findAllUnidadesMedida: jest.fn().mockResolvedValue([
        { codigo: 'unidad', magnitud: 'conteo', factorBase: '1' },
        { codigo: 'g', magnitud: 'masa', factorBase: '1' },
        { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
      ]),
      convertirUnidad: jest.fn(),
      convertirUnidades: jest.fn().mockResolvedValue([]),
      crearConversor: jest.fn().mockResolvedValue(conversorMock),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemsService,
        { provide: getRepositoryToken(Item), useValue: itemRepo },
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
            receta_item_id: 'receta-uuid',
            cantidad: '1',
            unidad_codigo: 'unidad',
            ingrediente_unidad_medida: 'unidad',
            stock: '8',
          }, // pan
          {
            receta_item_id: 'receta-uuid',
            cantidad: '150',
            unidad_codigo: 'g',
            ingrediente_unidad_medida: 'kg',
            stock: '1',
          }, // carne: 1kg = 1000g
        ]);
      catalogServiceMock.convertirUnidades.mockResolvedValueOnce([
        '1', // pan
        '0.15', // carne 150g → 0.15kg
      ]);

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

  describe('disponible de combo (batch)', () => {
    it('es el mínimo floor(stock/cantidad) entre componentes bloqueantes; servicio se ignora', async () => {
      // producto stock 10, cantidad 2 → 5 ; receta disponible 3, cantidad 1 → 3 ; servicio ignorado
      // se espera 3
      dataSource.query
        .mockResolvedValueOnce([
          // 1) combo_componentes bloqueantes
          {
            combo_item_id: COMBO_ID,
            componente_item_id: 'prod-uuid',
            tipo: 'producto',
            cantidad: '2',
            stock: '10',
          },
          {
            combo_item_id: COMBO_ID,
            componente_item_id: 'receta-uuid',
            tipo: 'receta',
            cantidad: '1',
            stock: null,
          },
          {
            combo_item_id: COMBO_ID,
            componente_item_id: 'servicio-uuid',
            tipo: 'servicio',
            cantidad: '1',
            stock: null,
          },
        ])
        .mockResolvedValueOnce([
          // 2) ingredientes bloqueantes de receta-uuid → disponibilidad 3
          {
            receta_item_id: 'receta-uuid',
            cantidad: '1',
            unidad_codigo: 'unidad',
            ingrediente_unidad_medida: 'unidad',
            stock: '3',
          },
        ]);
      catalogServiceMock.convertirUnidades.mockResolvedValueOnce(['1']);

      const disp = await (service as any).calcularDisponibilidadBatch(
        TENANT,
        [],
        [COMBO_ID],
      );
      expect(disp.get(COMBO_ID)).toBe(3);
    });

    it('devuelve null si el combo no tiene componentes bloqueantes', async () => {
      dataSource.query.mockResolvedValueOnce([]);

      const disp = await (service as any).calcularDisponibilidadBatch(
        TENANT,
        [],
        [COMBO_SIN_BLOQUEANTES_ID],
      );
      expect(disp.get(COMBO_SIN_BLOQUEANTES_ID)).toBeNull();
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
        .mockResolvedValueOnce([]) // cargarGruposPorItem: asoc (sin grupos en el componente receta)
        .mockResolvedValueOnce([]); // grupoRows (sin grupos asociados al combo)

      const result = await service.findOne(TENANT, COMBO_ID);

      expect(result.componentes).toEqual([
        {
          componenteItemId: 'ingrediente-pan',
          componenteNombre: 'Hamburguesa',
          tipo: 'receta',
          cantidad: '1',
          bloqueante: true,
          stock: null,
          grupos: [],
        },
        {
          componenteItemId: 'servicio-envoltorio',
          componenteNombre: 'Envoltorio para llevar',
          tipo: 'servicio',
          cantidad: '1',
          bloqueante: false,
          stock: null,
          grupos: [],
        },
      ]);
      expect(result.componentes.some((c) => c.bloqueante === true)).toBe(true);
      expect(result.componentes.some((c) => c.bloqueante === false)).toBe(true);

      const compQuery = dataSource.query.mock.calls[4][0] as string;
      expect(compQuery).toContain('combo_componentes');
      expect(compQuery).toContain('ip.stock');
      expect(compQuery).not.toContain('cc.bloqueante = true');
    });

    it('findOne combo: grupos incluye cantidad efectiva (COALESCE) y esPendiente', async () => {
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
        .mockResolvedValueOnce([]) // impuestos
        .mockResolvedValueOnce([]) // recargos
        .mockResolvedValueOnce([]) // descuentos
        .mockResolvedValueOnce([]) // componentes (combo)
        // Los grupos del propio ítem se resuelven con `cargarGruposPorItem`:
        // 2 queries fijas (asociaciones + opciones de todas ellas), no una de
        // opciones por cada grupo.
        .mockResolvedValueOnce([
          {
            item_id: COMBO_ID,
            grupo_modificador_id: 'grupo-1',
            item_grupo_id: 'item-grupo-1',
            nombre: 'Salsas',
            min: 0,
            max: 2,
            orden: 0,
          },
        ]) // asociaciones
        .mockResolvedValueOnce([
          {
            item_grupo_id: 'item-grupo-1',
            grupo_opcion_id: 'op-1',
            item_id: 'item-salsa-bbq',
            item_nombre: 'Salsa BBQ',
            tipo: 'producto',
            cantidad_efectiva: '2',
            cantidad_default: '1',
            unidad_codigo: 'unidad',
            precio_extra: '300',
            orden: 0,
            stock: '10',
          },
          {
            item_grupo_id: 'item-grupo-1',
            grupo_opcion_id: 'op-2',
            item_id: 'item-salsa-mayo',
            item_nombre: 'Mayo',
            tipo: 'producto',
            cantidad_efectiva: null,
            cantidad_default: null,
            unidad_codigo: null,
            precio_extra: '0',
            orden: 1,
            stock: '5',
          },
        ]); // opciones de TODAS las asociaciones

      const result = await service.findOne(TENANT, COMBO_ID);

      expect(result.grupos).toHaveLength(1);
      expect(result.grupos[0].grupoModificadorId).toBe('grupo-1');
      expect(result.grupos[0].opciones).toEqual([
        {
          grupoOpcionId: 'op-1',
          itemId: 'item-salsa-bbq',
          itemNombre: 'Salsa BBQ',
          tipo: 'producto',
          cantidad: '2',
          cantidadDefault: '1',
          unidadCodigo: 'unidad',
          precioExtra: '300',
          orden: 0,
          stock: '10',
          esPendiente: false,
        },
        {
          grupoOpcionId: 'op-2',
          itemId: 'item-salsa-mayo',
          itemNombre: 'Mayo',
          tipo: 'producto',
          cantidad: null,
          cantidadDefault: null,
          unidadCodigo: null,
          precioExtra: '0',
          orden: 1,
          stock: '5',
          esPendiente: true,
        },
      ]);

      const opQueryCall = dataSource.query.mock.calls[6];
      expect(opQueryCall[0]).toContain('grupo_modificador_opciones');
      expect(opQueryCall[0]).toContain('COALESCE');
      // Las opciones se piden para TODAS las asociaciones de una (array de
      // `item_grupo_id`), no de a un grupo por vez: si alguien vuelve al loop,
      // el parámetro deja de ser un array y este assert falla.
      expect(opQueryCall[1]).toEqual([['item-grupo-1'], TENANT]);
      // Y no hay una séptima query: 2 fijas para los grupos, no 1 + N.
      expect(dataSource.query).toHaveBeenCalledTimes(7);
    });

    it('adjunta los grupos de cada componente receta en el detalle del combo', async () => {
      const RECETA_ID = 'receta-componente-uuid';
      const PROTEINA_ID = 'proteina-uuid';
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
        .mockResolvedValueOnce([]) // impuestos
        .mockResolvedValueOnce([]) // recargos
        .mockResolvedValueOnce([]) // descuentos
        .mockResolvedValueOnce([
          {
            componente_item_id: RECETA_ID,
            componente_nombre: 'Hamburguesa',
            tipo: 'receta',
            cantidad: '1',
            bloqueante: true,
            stock: null,
          },
        ]) // componentes (combo)
        .mockResolvedValueOnce([
          {
            item_id: RECETA_ID,
            grupo_modificador_id: PROTEINA_ID,
            item_grupo_id: 'item-grupo-proteina',
            nombre: 'Proteína',
            min: 1,
            max: 1,
            orden: 0,
          },
        ]) // cargarGruposPorItem: asoc
        .mockResolvedValueOnce([
          {
            item_grupo_id: 'item-grupo-proteina',
            grupo_opcion_id: 'op-carne',
            item_id: 'item-carne',
            item_nombre: 'Carne',
            tipo: 'producto',
            cantidad_efectiva: '1',
            cantidad_default: '1',
            unidad_codigo: 'unidad',
            precio_extra: '0',
            orden: 0,
            stock: '5',
          },
        ]) // cargarGruposPorItem: ops
        .mockResolvedValueOnce([]); // grupoRows (el combo no tiene grupos propios)

      const result = await service.findOne(TENANT, COMBO_ID);

      const comp = result.componentes.find(
        (c: any) => c.componenteItemId === RECETA_ID,
      )!;
      expect(comp.grupos).toHaveLength(1);
      expect(comp.grupos[0]).toMatchObject({
        grupoModificadorId: PROTEINA_ID,
        min: 1,
        max: 1,
      });
      expect(result.disponibleCondicional).toBe(true);
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
              item_id: 'ingrediente-pan',
              nombre: 'Pan',
              tipo: 'producto',
              modo_inventario: 'cantidad',
              unidad_medida: 'unidad',
              costo_actual: '500',
            },
          ]); // lookup batch → pan es producto vendible, no vale como insumo

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
              item_id: 'ingrediente-pan',
              nombre: 'Pan',
              tipo: 'producto',
              modo_inventario: 'cantidad',
              unidad_medida: 'unidad',
              costo_actual: '500',
            },
          ]); // lookup batch → pan no es ingrediente

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
              item_id: 'ingrediente-pan',
              nombre: 'Pan',
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
          // UNA query para los dos ingredientes, no una por ingrediente
          .mockResolvedValueOnce([
            {
              item_id: 'ingrediente-pan',
              nombre: 'Pan',
              tipo: 'ingrediente',
              modo_inventario: 'cantidad',
              unidad_medida: 'unidad',
              costo_actual: '500',
            },
            {
              item_id: 'ingrediente-carne',
              nombre: 'Carne',
              tipo: 'ingrediente',
              modo_inventario: 'cantidad',
              unidad_medida: 'kg',
              costo_actual: '8000',
            },
          ]) // lookup batch de ingredientes
          .mockResolvedValueOnce([]) // INSERT item_receta
          .mockResolvedValueOnce([]) // INSERT receta_ingredientes pan
          .mockResolvedValueOnce([]); // INSERT receta_ingredientes carne

        catalogServiceMock.convertirUnidad
          .mockResolvedValueOnce('1') // pan: unidad → unidad (sin cambio)
          .mockResolvedValueOnce('0.15'); // carne: 150 g → 0.15 kg

        const result = await service.create(TENANT, 'user-uuid', dtoReceta);

        expect(result).toMatchObject({ id: ITEM_ID });
        // Orden de llamadas a managerMock.query: 1=moneda, 2=INSERT items,
        // 3=lookup batch de LOS DOS ingredientes, 4=INSERT item_receta,
        // 5/6=INSERT receta_ingredientes. Antes el lookup era uno por
        // ingrediente y el INSERT caía en la 5ª.
        // costo = 500*1 + 8000*0.15 = 500 + 1200 = 1700
        expect(managerMock.query).toHaveBeenNthCalledWith(
          4,
          expect.stringContaining('INSERT INTO item_receta'),
          [ITEM_ID, '1700'],
        );
        // Un solo SELECT de validación para los dos ingredientes.
        const selects = (
          managerMock.query.mock.calls as [string, unknown[]][]
        ).filter(([sql]) => sql.includes('LEFT JOIN item_producto ip'));
        expect(selects).toHaveLength(1);
        // Y una sola carga del catálogo de unidades: la conversión corre en
        // memoria dentro del loop, no con una query por ingrediente.
        expect(catalogServiceMock.crearConversor).toHaveBeenCalledTimes(1);
        expect(catalogServiceMock.convertirUnidad).not.toHaveBeenCalled();
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
              item_id: 'ingrediente-pan',
              tipo: 'ingrediente',
              nombre: 'Pan',
              modo_inventario: 'cantidad',
              unidad_medida: 'unidad',
              costo_actual: '500',
            },
          ]) // lookup batch de ingredientes
          .mockResolvedValueOnce([]) // INSERT item_receta
          .mockResolvedValueOnce([]) // INSERT receta_ingredientes pan
          .mockResolvedValueOnce([
            {
              item_id: 'ingrediente-queso',
              tipo: 'ingrediente',
              nombre: 'Queso',
              modo_inventario: 'cantidad',
              unidad_medida: 'kg',
            },
          ]) // lookup batch de extras
          .mockResolvedValueOnce([]); // INSERT receta_extras_permitidos

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
        // La compatibilidad de unidades del extra se valida con el conversor ya
        // cargado, no con una query por fila (sin esto, revertir a
        // `convertirUnidad` dejaba toda la suite en verde).
        expect(catalogServiceMock.convertirUnidad).not.toHaveBeenCalled();
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

      // Mismo chequeo que ya tenía `validarYCostearComponentes` para combos: sin
      // él el payload pasaba la validación y reventaba contra el índice único
      // parcial de la tabla, o sea 500 en vez de 400. El dato quedaba a salvo
      // (la transacción revierte); lo que fallaba era la calidad del error.
      it('rechaza extras duplicados (mismo ingredienteItemId dos veces) sin consultar la BD', async () => {
        await expect(
          (service as any).validarExtrasPermitidos(managerMock, TENANT, [
            extraQueso,
            { ...extraQueso, cantidad: '40' },
          ]),
        ).rejects.toThrow(
          new BadRequestException(
            'Un ingrediente no puede aparecer más de una vez como extra permitido',
          ),
        );
        expect(managerMock.query).not.toHaveBeenCalled();
      });

      it('rechaza ingredientes duplicados (mismo ingredienteItemId dos veces) sin consultar la BD', async () => {
        await expect(
          (service as any).validarYCostearIngredientes(managerMock, TENANT, [
            ingredientePan,
            { ...ingredientePan, cantidad: '3' },
          ]),
        ).rejects.toThrow(
          new BadRequestException(
            'Un ingrediente no puede aparecer más de una vez en la receta',
          ),
        );
        expect(managerMock.query).not.toHaveBeenCalled();
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
          // UNA query para los dos componentes, no una por componente
          .mockResolvedValueOnce([
            {
              item_id: PROD_ID,
              nombre: 'Producto base',
              tipo: 'producto',
              costo_actual: '500',
            },
            {
              item_id: RECETA_ID,
              nombre: 'Receta base',
              tipo: 'receta',
              costo_actual: '1200',
            },
          ]) // lookup batch de componentes
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
              item_id: OTRO_COMBO_ID,
              nombre: 'Otro combo',
              tipo: 'combo',
              costo_actual: '5000',
            },
          ]); // lookup batch de componentes

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
        service.update(TENANT, USUARIO, ITEM_ID, { nombre: 'Nuevo nombre' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('reemplaza impuestosIds cuando se proveen (reemplazo total)', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }]) // SELECT existing
        .mockResolvedValueOnce([{ cnt: '1' }]) // validarReglas impuestos
        .mockResolvedValueOnce([]) // DELETE item_impuestos
        .mockResolvedValueOnce([]); // INSERT item_impuestos

      await service.update(TENANT, USUARIO, ITEM_ID, {
        impuestosIds: ['imp-nuevo'],
      });

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

      await service.update(TENANT, USUARIO, ITEM_ID, { activo: false });

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
        service.update(TENANT, USUARIO, ITEM_ID, { modoInventario: 'lote' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lee `item_producto` con FOR UPDATE antes de decidir sobre el kardex', async () => {
      // El guard de "no cambiar `modo_inventario` con movimientos existentes"
      // decide sobre `movimientos_inventario`, que `registrarMovimiento`
      // escribe tomando `FOR UPDATE` sobre esta misma fila de `item_producto`
      // (`inventario.service.ts`). Sin el lock acá los dos leen a la vez, no se
      // serializan, y el modo cambia con un movimiento recién escrito debajo.
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }])
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', unidad_medida: 'kg' },
        ])
        .mockResolvedValueOnce([{ cnt: '0' }])
        .mockResolvedValue(undefined);

      await service.update(TENANT, USUARIO, ITEM_ID, {
        modoInventario: 'lote',
      });

      const lectura = managerMock.query.mock.calls
        .map((c: unknown[]) => c[0] as string)
        .find((sql) => sql.includes('FROM item_producto WHERE item_id'));
      expect(lectura).toContain('FOR UPDATE');
    });

    it('permite reenviar el mismo modoInventario con movimientos al actualizar costo', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }]) // SELECT existing
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', unidad_medida: 'kg' },
        ]) // SELECT actual — mismo modo
        .mockResolvedValueOnce(undefined); // UPDATE item_producto

      await service.update(TENANT, USUARIO, ITEM_ID, {
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

      await service.update(TENANT, USUARIO, ITEM_ID, {
        modoInventario: 'lote',
      });

      const calls = managerMock.query.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(calls.some((sql) => sql.includes('modo_inventario'))).toBe(true);
    });

    it('permite cambiar modoInventario cuando el único movimiento registrado es un ajuste_costo', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }]) // SELECT existing
        .mockResolvedValueOnce([
          { modo_inventario: 'cantidad', unidad_medida: 'kg' },
        ]) // SELECT actual
        .mockResolvedValueOnce([{ cnt: '0' }]) // COUNT excluye tipo='ajuste' → 0
        .mockResolvedValueOnce(undefined); // UPDATE item_producto

      await expect(
        service.update(TENANT, USUARIO, ITEM_ID, { modoInventario: 'lote' }),
      ).resolves.not.toThrow();

      const calls = managerMock.query.mock.calls as [string, unknown[]][];
      const countCall = calls.find(([sql]) =>
        sql.includes('FROM movimientos_inventario'),
      );
      expect(countCall).toBeDefined();
      expect(countCall?.[0]).toContain("tipo <> 'ajuste'");
    });

    it('actualiza frecuencia de un item suscripción existente', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'suscripcion' }]) // SELECT existing
        .mockResolvedValueOnce([]); // UPDATE item_suscripcion

      const result = await service.update(TENANT, USUARIO, ITEM_ID, {
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
        service.update(TENANT, USUARIO, ITEM_ID, {
          frecuencia: 'mensual',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('ignora costo en el update: ya no se edita desde el item', async () => {
      managerMock.query.mockResolvedValueOnce([
        { item_id: ITEM_ID, tipo: 'producto' },
      ]); // SELECT existing

      await service.update(TENANT, USUARIO, ITEM_ID, { costo: '4300' });

      const calls = managerMock.query.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(calls.some((sql) => sql.includes('UPDATE item_producto'))).toBe(
        false,
      );
    });

    it('receta: reemplaza los ingredientes y recalcula costoActual', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'receta' }]) // SELECT existente
        .mockResolvedValueOnce([]) // SELECT item_receta FOR UPDATE
        .mockResolvedValueOnce([
          {
            item_id: 'ingrediente-queso',
            nombre: 'Queso',
            tipo: 'ingrediente',
            modo_inventario: 'cantidad',
            unidad_medida: 'kg',
            costo_actual: '6000',
          },
        ]) // lookup batch de ingredientes
        .mockResolvedValueOnce([]) // soft-delete receta_ingredientes
        .mockResolvedValueOnce([]) // INSERT receta_ingredientes queso
        .mockResolvedValueOnce([]); // UPDATE item_receta costo_actual

      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('0.02'); // 20 g → 0.02 kg

      await service.update(TENANT, USUARIO, ITEM_ID, {
        ingredientes: [
          {
            ingredienteItemId: 'ingrediente-queso',
            cantidad: '20',
            unidadCodigo: 'g',
            bloqueante: false,
          },
        ],
      });

      // El lock sobre `item_receta` va ANTES de costear: si se tomara después
      // de leer los ingredientes, otra transacción alcanza a cambiarlos entre
      // la lectura y el lock y el costo sale de una receta que ya no existe.
      expect(managerMock.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(
          'FROM item_receta WHERE item_id = $1 FOR UPDATE',
        ),
        [ITEM_ID],
      );
      // soft-delete de la lista anterior (nunca hard DELETE)
      expect(managerMock.query).toHaveBeenNthCalledWith(
        4,
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

    it('toma `item_receta` ANTES del UPDATE items — orden de locks contra aplicarDesfases', async () => {
      // Deadlock real, no teórico: `aplicarDesfases` bloquea `item_receta` y
      // después `items` (para el precio). Si `update()` los toma al revés
      // —`UPDATE items` primero y la receta después— las dos se abrazan y
      // Postgres mata una con 40P01, que acá nadie reintenta. Se dispara con un
      // PATCH normal de receta: nombre + ingredientes en el mismo payload.
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'receta' }])
        .mockResolvedValue([
          {
            item_id: 'ingrediente-queso',
            nombre: 'Queso',
            tipo: 'ingrediente',
            modo_inventario: 'cantidad',
            unidad_medida: 'kg',
            costo_actual: '6000',
          },
        ]);
      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('1');

      await service.update(TENANT, USUARIO, ITEM_ID, {
        nombre: 'Receta renombrada',
        ingredientes: [
          {
            ingredienteItemId: 'ingrediente-queso',
            cantidad: '1',
            unidadCodigo: 'kg',
          },
        ],
      });

      const sqls = managerMock.query.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      const lockReceta = sqls.findIndex((sql) =>
        sql.includes('FROM item_receta WHERE item_id = $1 FOR UPDATE'),
      );
      const updateItems = sqls.findIndex((sql) =>
        sql.includes('UPDATE items SET'),
      );
      expect(lockReceta).toBeGreaterThan(-1);
      expect(updateItems).toBeGreaterThan(-1);
      expect(lockReceta).toBeLessThan(updateItems);
    });

    it('extrasPermitidos: update soft-deletea extras previos e inserta nuevos', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'receta' }])
        .mockResolvedValueOnce([
          {
            item_id: 'ingrediente-queso',
            tipo: 'ingrediente',
            nombre: 'Queso',
            modo_inventario: 'cantidad',
            unidad_medida: 'kg',
          },
        ]) // lookup batch de extras
        .mockResolvedValueOnce([]) // soft-delete receta_extras_permitidos
        .mockResolvedValueOnce([]); // INSERT receta_extras_permitidos

      const result = await service.update(TENANT, USUARIO, ITEM_ID, {
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
        service.update(TENANT, USUARIO, ITEM_ID, { [field]: value } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza modoInventario distinto de cantidad en ingrediente', async () => {
      managerMock.query.mockResolvedValueOnce([
        { item_id: ITEM_ID, tipo: 'ingrediente' },
      ]);

      await expect(
        service.update(TENANT, USUARIO, ITEM_ID, { modoInventario: 'lote' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('persiste precio_base = 0 al actualizar ingrediente con precioBase', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'ingrediente' }]) // SELECT existing
        .mockResolvedValueOnce(undefined); // UPDATE items

      await service.update(TENANT, USUARIO, ITEM_ID, { precioBase: '999' });

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
              item_id: PROD_ID,
              nombre: 'Producto base',
              tipo: 'producto',
              costo_actual: '500',
            },
          ]) // lookup batch de componentes
          .mockResolvedValueOnce([]) // soft-delete combo_componentes
          .mockResolvedValueOnce([]) // INSERT combo_componentes
          .mockResolvedValueOnce([]) // UPDATE item_combo
          .mockResolvedValueOnce([{ componentes: '1', grupos: '0' }]); // conteo vivos post-cambio

        const patch = await service.update(TENANT, USUARIO, COMBO_ID, {
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

        const patch = await service.update(TENANT, USUARIO, COMBO_ID, {
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
          service.update(TENANT, USUARIO, COMBO_ID, {
            gruposModificadores: [],
          }),
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

        const patch = await service.update(TENANT, USUARIO, COMBO_ID, {
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
        managerMock.query.mockResolvedValueOnce([
          { clase: 'combo', nombre: 'Combo Clásico' },
        ]);

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
      managerMock.query.mockResolvedValue([]);

      await service.remove(TENANT, ITEM_ID);

      // Llamada 4: la UNION de uso es la 1, los dos soft-delete de
      // `receta_extras_permitidos` (por ingrediente y por receta) son la 2 y la 3
      // — las tres comparten firma `[ITEM_ID, TENANT]` con esta, así que hay que
      // aislar la del `UPDATE items` puntual para no matchear cualquiera.
      expect(managerMock.query).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('UPDATE items'),
        [ITEM_ID, TENANT],
      );
    });

    it('bloquea el borrado si el item es ingrediente de una receta activa', async () => {
      itemRepo.findOne.mockResolvedValueOnce({ id: ITEM_ID, tenantId: TENANT });
      managerMock.query.mockResolvedValueOnce([
        { clase: 'ingrediente', nombre: 'Hamburguesa Clásica' },
      ]);

      await expect(service.remove(TENANT, ITEM_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('permite el borrado si el item no es ingrediente de ninguna receta', async () => {
      itemRepo.findOne.mockResolvedValueOnce({ id: ITEM_ID, tenantId: TENANT });
      managerMock.query
        .mockResolvedValueOnce([]) // sin usos que lo bloqueen
        .mockResolvedValueOnce([]) // soft-delete receta_extras_permitidos (ingrediente_item_id)
        .mockResolvedValueOnce([]) // soft-delete receta_extras_permitidos (receta_item_id)
        .mockResolvedValueOnce([]); // UPDATE items (soft delete)

      await expect(service.remove(TENANT, ITEM_ID)).resolves.toBeUndefined();
    });

    it('limpia primero las filas donde el item borrado es el ingrediente ofrecido como extra', async () => {
      itemRepo.findOne.mockResolvedValueOnce({ id: ITEM_ID, tenantId: TENANT });
      managerMock.query
        .mockResolvedValueOnce([]) // sin usos que lo bloqueen
        .mockResolvedValueOnce([]) // soft-delete receta_extras_permitidos (ingrediente_item_id)
        .mockResolvedValueOnce([]) // soft-delete receta_extras_permitidos (receta_item_id)
        .mockResolvedValueOnce([]); // UPDATE items (soft delete)

      await service.remove(TENANT, ITEM_ID);

      // Llamada 2 (índice 1): limpia por `ingrediente_item_id`, no por
      // `receta_item_id` — aislada por índice de llamada porque las llamadas 2
      // y 3 comparten el mismo texto `UPDATE receta_extras_permitidos` y los
      // mismos params `[ITEM_ID, TENANT]`.
      expect(managerMock.query.mock.calls[1][0]).toEqual(
        expect.stringContaining(
          'WHERE ingrediente_item_id = $1 AND tenant_id = $2',
        ),
      );
      expect(managerMock.query.mock.calls[1][1]).toEqual([ITEM_ID, TENANT]);
    });

    it('limpia también las filas donde el item borrado es la receta que ofrece el extra', async () => {
      itemRepo.findOne.mockResolvedValueOnce({ id: ITEM_ID, tenantId: TENANT });
      managerMock.query
        .mockResolvedValueOnce([]) // sin usos que lo bloqueen
        .mockResolvedValueOnce([]) // soft-delete receta_extras_permitidos (ingrediente_item_id)
        .mockResolvedValueOnce([]) // soft-delete receta_extras_permitidos (receta_item_id)
        .mockResolvedValueOnce([]); // UPDATE items (soft delete)

      await service.remove(TENANT, ITEM_ID);

      // Llamada 3 (índice 2): limpia por `receta_item_id`, no por
      // `ingrediente_item_id` — aislada por índice de llamada porque las
      // llamadas 2 y 3 comparten el mismo texto `UPDATE receta_extras_permitidos`
      // y los mismos params `[ITEM_ID, TENANT]`.
      expect(managerMock.query.mock.calls[2][0]).toEqual(
        expect.stringContaining('WHERE receta_item_id = $1 AND tenant_id = $2'),
      );
      expect(managerMock.query.mock.calls[2][1]).toEqual([ITEM_ID, TENANT]);
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
        costoActualPrevio: '100.0000',
        costoActual: '150.0000',
      });

      const res = await service.ajustarStock(TENANT, 'user-uuid', ITEM_ID, {
        cantidad: '5',
        tipo: 'entrada',
        motivo: 'compra',
      });

      expect(res).toEqual({ stock: '15', costoActual: '150.0000' });
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
          cantidad: '5',
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
          cantidad: '5',
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
        cantidad: '5',
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
        service.update('tenant-uuid', USUARIO, 'item-uuid', {
          unidadMedida: 'g',
        }),
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
        service.update('tenant-uuid', USUARIO, 'item-uuid', {
          unidadMedida: 'kg',
        }),
      ).resolves.toMatchObject({ id: 'item-uuid', unidadMedida: 'kg' });
    });

    // Sin esto, un producto creado con stock 0 (que no genera movimiento, así
    // que el guard de arriba no dispara) pasaba de kg a g conservando 5000 de
    // costo: el mismo número, interpretado por gramo. Error de 1000×.
    it('reconvierte el costo al cambiar de unidad, por el choke point', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }]) // lectura del item
        .mockResolvedValueOnce([
          {
            modo_inventario: 'cantidad',
            unidad_medida: 'kg',
            costo_actual: '5000.0000',
          },
        ])
        .mockResolvedValueOnce([{ cnt: '0' }]) // sin movimientos: el cambio se permite
        .mockResolvedValue([]);
      catalogServiceMock.convertirUnidad.mockResolvedValue('1000'); // 1 kg = 1000 g
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-1',
      });

      await service.update('tenant-uuid', USUARIO, 'item-uuid', {
        unidadMedida: 'g',
      });

      // El costo NO se escribe con un UPDATE directo: va por registrarMovimiento
      // (ADR-016), que además lo deja auditado en el kardex.
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          tipo: 'ajuste',
          motivo: 'ajuste_costo',
          cantidad: '0',
          costoUnitario: '5.0000', // 5.000/kg → 5/g
          usuarioId: USUARIO,
        }),
      );
    });

    it('no toca el costo si la unidad cambia pero no hay costo vigente', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([
          {
            modo_inventario: 'cantidad',
            unidad_medida: 'kg',
            costo_actual: null,
          },
        ])
        .mockResolvedValueOnce([{ cnt: '0' }])
        .mockResolvedValue([]);

      await service.update('tenant-uuid', USUARIO, 'item-uuid', {
        unidadMedida: 'g',
      });

      expect(inventarioServiceMock.registrarMovimiento).not.toHaveBeenCalled();
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

    it('convierte costoUnitario junto con la cantidad preservando el valor total', async () => {
      // Producto en base 'g'; se compran 2 kg a $5.000/kg.
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([
          { unidad_medida: 'g', modo_inventario: 'cantidad' },
        ]);
      catalogServiceMock.convertirUnidad.mockResolvedValue('2000'); // 2 kg → 2000 g
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        stockResultante: '2000',
      });

      await service.ajustarStock('tenant-uuid', 'usuario-uuid', 'item-uuid', {
        cantidad: 2,
        tipo: 'entrada',
        motivo: 'compra',
        unidadCodigo: 'kg',
        costoUnitario: '5000',
      } as never);

      // Valor total preservado: 2 kg × 5.000/kg = 10.000 = 2000 g × 5/g.
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({ cantidad: '2000', costoUnitario: '5.0000' }),
      );
    });

    it('no convierte costoUnitario cuando la compra ya viene en la unidad base', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([
          { unidad_medida: 'kg', modo_inventario: 'cantidad' },
        ]);
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        stockResultante: '2',
      });

      await service.ajustarStock('tenant-uuid', 'usuario-uuid', 'item-uuid', {
        cantidad: 2,
        tipo: 'entrada',
        motivo: 'compra',
        unidadCodigo: 'kg',
        costoUnitario: '5000',
      } as never);

      expect(catalogServiceMock.convertirUnidad).not.toHaveBeenCalled();
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({ cantidad: '2', costoUnitario: '5000' }),
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
            grupo_modificador_id: GRUPO_ID,
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

    it('carga las opciones de todos los grupos en una sola query', async () => {
      // Guarda contra la regresión al N+1: antes se disparaba una query por
      // grupo asociado al ítem.
      const GRUPO_B = 'grupo-b-uuid';
      const OPCION_B = 'opcion-b-uuid';
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: GRUPO_ID, nombre: 'Tamaño', min: 1, max: 1 },
          { grupo_modificador_id: GRUPO_B, nombre: 'Salsa', min: 1, max: 1 },
        ])
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: GRUPO_ID,
            item_id: OPCION_ID,
            nombre: 'Grande',
            cantidad: '1',
            unidad_codigo: null,
            precio_extra: '1500.0000',
          },
          {
            grupo_modificador_id: GRUPO_B,
            item_id: OPCION_B,
            nombre: 'BBQ',
            cantidad: '1',
            unidad_codigo: null,
            precio_extra: '500.0000',
          },
        ]);

      const res = await service.resolverGruposDeItem(
        managerMock as any,
        TENANT,
        ITEM_ID,
        [
          { grupoId: GRUPO_ID, opciones: [{ itemId: OPCION_ID, unidades: 1 }] },
          { grupoId: GRUPO_B, opciones: [{ itemId: OPCION_B, unidades: 1 }] },
        ],
      );

      // 1 query de grupos asociados + 1 de opciones, con 2 grupos: no 3.
      expect(managerMock.query).toHaveBeenCalledTimes(2);
      expect(res.precioExtraTotal).toBe('2000.0000');
      expect(res.grupos).toHaveLength(2);
    });

    it('rechaza Σ unidades fuera de [min, max]', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          { grupo_modificador_id: GRUPO_ID, nombre: 'Tamaño', min: 1, max: 1 },
        ])
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: GRUPO_ID,
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
            grupo_modificador_id: GRUPO_ID,
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

  describe('resolverPersonalizacionCombo', () => {
    const RECETA_ID = 'receta-combo-uuid';
    const PROTEINA_ID = 'proteina-uuid';
    const ITEM_GRUPO_ID = 'item-grupo-uuid';
    const CHULETA_ID = 'chuleta-uuid';
    const CARNE_ID = 'carne-uuid';
    const ITEM_AJENO_ID = 'item-ajeno-uuid';

    function mockAsociadosYOpcionesProteina() {
      managerMock.query
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: PROTEINA_ID,
            item_grupo_id: ITEM_GRUPO_ID,
            nombre: 'Proteína',
            min: 1,
            max: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: PROTEINA_ID,
            item_id: CHULETA_ID,
            nombre: 'Chuleta',
            cantidad: '1',
            unidad_codigo: null,
            precio_extra: '1500.0000',
          },
          {
            grupo_modificador_id: PROTEINA_ID,
            item_id: CARNE_ID,
            nombre: 'Carne',
            cantidad: '1',
            unidad_codigo: null,
            precio_extra: '0.0000',
          },
        ]);
    }

    it('resuelve los grupos de un componente receta por unidad y suma el recargo', async () => {
      managerMock.query
        .mockResolvedValueOnce([]) // resolverGruposDeItem del combo: sin grupos propios
        .mockResolvedValueOnce([
          {
            componente_item_id: RECETA_ID,
            nombre: 'Hamburguesa',
            cantidad: '2',
          },
        ]) // combo_componentes receta con cantidad 2
        .mockResolvedValueOnce([{ item_id: RECETA_ID }]); // batch: componentes con ≥1 grupo asociado
      mockAsociadosYOpcionesProteina(); // resolverGruposDeItem(RECETA_ID) — unidad 1
      mockAsociadosYOpcionesProteina(); // resolverGruposDeItem(RECETA_ID) — unidad 2

      const dto = {
        componentes: [
          {
            componenteItemId: RECETA_ID,
            unidad: 1,
            grupos: [
              {
                grupoId: PROTEINA_ID,
                opciones: [{ itemId: CHULETA_ID, unidades: 1 }],
              },
            ],
          },
          {
            componenteItemId: RECETA_ID,
            unidad: 2,
            grupos: [
              {
                grupoId: PROTEINA_ID,
                opciones: [{ itemId: CARNE_ID, unidades: 1 }],
              },
            ],
          },
        ],
      };

      const res = await service.resolverPersonalizacionCombo(
        managerMock as any,
        TENANT,
        COMBO_ID,
        dto,
      );

      expect(res.precioExtraTotal).toBe('1500.0000');
      expect(res.snapshot.componentes).toHaveLength(2);
      expect(res.snapshot.componentes![0]).toMatchObject({
        componenteItemId: RECETA_ID,
        unidad: 1,
      });
      expect(res.snapshot.componentes![1]).toMatchObject({
        componenteItemId: RECETA_ID,
        unidad: 2,
      });
    });

    it('rechaza un componenteItemId que no es componente vivo del combo', async () => {
      managerMock.query
        .mockResolvedValueOnce([]) // resolverGruposDeItem del combo: sin grupos propios
        .mockResolvedValueOnce([
          {
            componente_item_id: RECETA_ID,
            nombre: 'Hamburguesa',
            cantidad: '2',
          },
        ]) // combo_componentes
        .mockResolvedValueOnce([{ item_id: RECETA_ID }]); // batch componentes con grupos

      const dto = {
        componentes: [
          { componenteItemId: ITEM_AJENO_ID, unidad: 1, grupos: [] },
        ],
      };

      await expect(
        service.resolverPersonalizacionCombo(
          managerMock as any,
          TENANT,
          COMBO_ID,
          dto as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza una unidad fuera del rango 1..cantidad del componente', async () => {
      managerMock.query
        .mockResolvedValueOnce([]) // resolverGruposDeItem del combo: sin grupos propios
        .mockResolvedValueOnce([
          {
            componente_item_id: RECETA_ID,
            nombre: 'Hamburguesa',
            cantidad: '2',
          },
        ]) // combo_componentes
        .mockResolvedValueOnce([{ item_id: RECETA_ID }]); // batch componentes con grupos

      const dto = {
        componentes: [{ componenteItemId: RECETA_ID, unidad: 3, grupos: [] }], // cantidad = 2
      };

      await expect(
        service.resolverPersonalizacionCombo(
          managerMock as any,
          TENANT,
          COMBO_ID,
          dto as any,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resolución de grupos con override (COALESCE)', () => {
    const ITEM_OPCION = 'opcion-carne-uuid';

    it('resolverGruposDeItem usa el override de cantidad y precio sobre el default', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: 'G1',
            item_grupo_id: 'IG1',
            nombre: 'Proteína',
            min: 0,
            max: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: 'G1',
            item_id: ITEM_OPCION,
            nombre: 'Carne',
            cantidad: '250',
            unidad_codigo: 'g',
            precio_extra: '700',
          },
        ]);

      const res = await service.resolverGruposDeItem(
        managerMock as any,
        TENANT,
        ITEM_ID,
        [{ grupoId: 'G1', opciones: [{ itemId: ITEM_OPCION, unidades: 1 }] }],
      );

      expect(res.grupos[0].opciones[0].cantidad).toBe('250');
      expect(res.grupos[0].opciones[0].precioExtra).toBe('700');
      expect(res.precioExtraTotal).toBe('700.0000');
    });

    it('rechaza elegir una opción pendiente (cantidad efectiva null)', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: 'G1',
            item_grupo_id: 'IG1',
            nombre: 'Proteína',
            min: 1,
            max: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: 'G1',
            item_id: ITEM_OPCION,
            nombre: 'Carne',
            cantidad: null,
            unidad_codigo: null,
            precio_extra: '0',
          },
        ]);

      await expect(
        service.resolverGruposDeItem(managerMock as any, TENANT, ITEM_ID, [
          { grupoId: 'G1', opciones: [{ itemId: ITEM_OPCION, unidades: 1 }] },
        ]),
      ).rejects.toThrow(/sin cantidad configurada|pendiente/i);
    });
  });

  describe('cargarReglasPorIds', () => {
    it('agrupa las tres clases por ítem en UNA sola query, preservando el orden', async () => {
      dataSource.query.mockResolvedValueOnce([
        { clase: 'descuento', item_id: 'item-a', regla_id: 'desc-1' },
        { clase: 'descuento', item_id: 'item-a', regla_id: 'desc-2' },
        { clase: 'impuesto', item_id: 'item-a', regla_id: 'imp-1' },
        { clase: 'recargo', item_id: 'item-b', regla_id: 'rec-1' },
      ]);

      const mapa = await service.cargarReglasPorIds(TENANT, [
        'item-a',
        'item-b',
        'item-a', // duplicado: se deduplica antes de la query
      ]);

      expect(dataSource.query).toHaveBeenCalledTimes(1);
      expect(dataSource.query).toHaveBeenCalledWith(expect.any(String), [
        ['item-a', 'item-b'],
        TENANT,
      ]);
      // El orden dentro de cada lista importa en modo `compuesto`: desc-1 antes
      // que desc-2, tal como los devolvió la query.
      expect(mapa.get('item-a')).toEqual({
        impuestosIds: ['imp-1'],
        descuentosIds: ['desc-1', 'desc-2'],
        recargosIds: [],
      });
      expect(mapa.get('item-b')).toEqual({
        impuestosIds: [],
        descuentosIds: [],
        recargosIds: ['rec-1'],
      });
    });

    it('no consulta si no hay ids', async () => {
      const mapa = await service.cargarReglasPorIds(TENANT, []);
      expect(mapa.size).toBe(0);
      expect(dataSource.query).not.toHaveBeenCalled();
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

    it('los extras del snapshot NO se bloquean al final: entran al orden por id', async () => {
      // `ingredientes` viene ordenado de la query, pero los extras salen del
      // snapshot —el orden en que el cliente los agregó al carrito—, así que
      // concatenarlos devolvía el orden del cliente a la mitad del bloqueo.
      const spyMov = jest
        .spyOn(inventarioServiceMock, 'registrarMovimiento')
        .mockResolvedValue({} as any);
      managerMock.query
        .mockResolvedValueOnce([
          {
            ingrediente_item_id: 'b',
            ingrediente_nombre: 'B',
            ingrediente_unidad_medida: 'unidad',
            cantidad: '1',
            unidad_codigo: 'unidad',
            bloqueante: true,
          },
        ])
        .mockResolvedValueOnce([
          { item_id: 'a', nombre: 'A', unidad_medida: 'unidad' },
          { item_id: 'c', nombre: 'C', unidad_medida: 'unidad' },
        ]);

      await service.venderIngredientesReceta(managerMock as any, {
        ...PARAMS,
        snapshot: {
          omitidos: [],
          // El cliente los agregó al revés: c y después a.
          extras: [
            {
              ingredienteItemId: 'c',
              cantidad: '1',
              unidadCodigo: 'unidad',
              precioExtra: '0',
            },
            {
              ingredienteItemId: 'a',
              cantidad: '1',
              unidadCodigo: 'unidad',
              precioExtra: '0',
            },
          ],
        },
      });

      expect(
        spyMov.mock.calls.map((c) => (c[1] as { itemId: string }).itemId),
      ).toEqual(['a', 'b', 'c']);
    });

    it('pide los ingredientes ordenados por id: ese es el orden de bloqueo', async () => {
      // Aserción sobre el SQL, no sobre el resultado, porque el orden lo aplica
      // Postgres — un mock devuelve lo que se le pida. Sin `ORDER BY` el orden
      // es el físico del heap, que cambia solo con cada UPDATE de la tabla, así
      // que dos ventas de la MISMA receta pueden bloquear en orden distinto.
      managerMock.query.mockResolvedValueOnce([]);

      await service.venderIngredientesReceta(managerMock as any, PARAMS);

      expect(managerMock.query).toHaveBeenNthCalledWith(
        1,
        expect.stringMatching(/ORDER BY\s+ri\.ingrediente_item_id/),
        ['receta-uuid', TENANT],
      );
    });

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
      // `carne` primero aunque el mock devuelva `pan` primero: el orden de los
      // movimientos es el de bloqueo, por id ascendente. En producción la query
      // ya viene ordenada y el `.sort()` no mueve nada; acá el mock devuelve el
      // orden crudo, así que se ve el efecto del sort — que es justamente el
      // backstop si alguien borra el `ORDER BY`.
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenNthCalledWith(
        1,
        managerMock,
        expect.objectContaining({
          itemId: 'carne',
          cantidad: '0.3',
          motivo: 'venta',
        }),
      );
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenNthCalledWith(
        2,
        managerMock,
        expect.objectContaining({
          itemId: 'pan',
          cantidad: '2',
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
        // Unidad de stock del extra: se resuelve por id contra items+item_producto,
        // no contra la lista de extras permitidos de la receta.
        .mockResolvedValueOnce([
          { item_id: 'queso', nombre: 'Queso', unidad_medida: 'kg' },
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
          { item_id: 'queso', nombre: 'Queso', unidad_medida: 'kg' },
        ]);
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
      expect(conversorMock).toHaveBeenCalledWith('120', 'g', 'kg');
    });

    it('descuenta bien un extra que ya no está en los extras permitidos de la receta', async () => {
      // El admin sacó el queso de la carta después de congelar el snapshot. La
      // unidad de STOCK sale del ingrediente, no de la lista de extras: si
      // saliera de ahí, caería a la unidad de la PORCIÓN ('g'), convertirUnidad
      // convertiría g→g y se descontarían 60 kg en vez de 0.06.
      managerMock.query
        .mockResolvedValueOnce([]) // sin ingredientes base
        .mockResolvedValueOnce([
          { item_id: 'queso', nombre: 'Queso', unidad_medida: 'kg' },
        ]);
      await service.venderIngredientesReceta(managerMock as any, {
        ...PARAMS,
        snapshot: {
          omitidos: [],
          extras: [
            {
              ingredienteItemId: 'queso',
              cantidad: '30',
              unidadCodigo: 'g',
              precioExtra: '500.0000',
            },
          ],
        },
      });

      // La búsqueda es por id de ingrediente y tenant, no por la receta: es lo
      // que la vuelve inmune a que el extra siga o no en la carta.
      expect(managerMock.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('item_producto'),
        [['queso'], TENANT],
      );
      expect(conversorMock).toHaveBeenCalledWith('60', 'g', 'kg');
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({ itemId: 'queso', cantidad: '0.06' }),
      );
    });

    it('no descuenta un extra cuyo ingrediente ya no existe: advierte en vez de descontar mal', async () => {
      managerMock.query
        .mockResolvedValueOnce([]) // sin ingredientes base
        .mockResolvedValueOnce([]); // el ingrediente del extra fue borrado

      const advertencias = await service.venderIngredientesReceta(
        managerMock as any,
        {
          ...PARAMS,
          snapshot: {
            omitidos: [],
            extras: [
              {
                ingredienteItemId: 'queso',
                cantidad: '30',
                unidadCodigo: 'g',
                precioExtra: '500.0000',
              },
            ],
          },
        },
      );

      expect(inventarioServiceMock.registrarMovimiento).not.toHaveBeenCalled();
      expect(catalogServiceMock.convertirUnidad).not.toHaveBeenCalled();
      expect(advertencias).toEqual([
        'Hamburguesa: no se pudo descontar un extra porque su ingrediente ya no está en el catálogo',
      ]);
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

    it('pide los componentes ordenados por id: ese es el orden de bloqueo', async () => {
      // Mismo criterio que su gemelo de `venderIngredientesReceta`: el orden lo
      // aplica Postgres, así que lo que se puede afirmar acá es el SQL.
      managerMock.query.mockResolvedValueOnce([]);

      await service.venderComponentesCombo(managerMock as any, {
        tenantId: TENANT,
        usuarioId: USUARIO_ID,
        ventaId: VENTA_ID,
        comboItemId: COMBO_ID,
        comboNombre: 'Combo',
        cantidadVendida: '1',
      });

      expect(managerMock.query).toHaveBeenNthCalledWith(
        1,
        expect.stringMatching(/ORDER BY\s+cc\.componente_item_id/),
        [COMBO_ID, TENANT],
      );
    });

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

    it('lee el catálogo de unidades UNA vez para todo el combo, no una por componente-receta', async () => {
      // Guarda contra la regresión al N+1 anidado: `venderIngredientesReceta`
      // convertía la unidad de cada ingrediente con una query, y el combo la
      // llama una vez por componente → N componentes × M ingredientes. El
      // conversor se carga arriba y baja por parámetro; si alguien saca ese
      // parámetro, cada componente vuelve a leer el catálogo y este test cae.
      managerMock.query
        .mockResolvedValueOnce([
          {
            componente_item_id: 'receta-a',
            componente_nombre: 'Hamburguesa',
            tipo: 'receta',
            cantidad: '1',
            bloqueante: true,
          },
          {
            componente_item_id: 'receta-b',
            componente_nombre: 'Papas',
            tipo: 'receta',
            cantidad: '1',
            bloqueante: true,
          },
        ])
        // Ingredientes de cada receta (dos por receta, todos con conversión).
        .mockResolvedValue([
          {
            ingrediente_item_id: 'ing-1',
            ingrediente_nombre: 'Pan',
            cantidad: '50',
            unidad_codigo: 'g',
            ingrediente_unidad_medida: 'kg',
            bloqueante: true,
          },
          {
            ingrediente_item_id: 'ing-2',
            ingrediente_nombre: 'Carne',
            cantidad: '120',
            unidad_codigo: 'g',
            ingrediente_unidad_medida: 'kg',
            bloqueante: true,
          },
        ]);
      jest
        .spyOn(inventarioServiceMock, 'registrarMovimiento')
        .mockResolvedValue({} as any);

      await service.venderComponentesCombo(managerMock as any, {
        tenantId: TENANT,
        usuarioId: USUARIO_ID,
        ventaId: VENTA_ID,
        comboItemId: COMBO_ID,
        comboNombre: 'Combo',
        cantidadVendida: '2',
      });

      expect(catalogServiceMock.crearConversor).toHaveBeenCalledTimes(1);
      // 4 conversiones (2 recetas × 2 ingredientes) con UNA sola carga.
      expect(conversorMock).toHaveBeenCalledTimes(4);
      expect(catalogServiceMock.convertirUnidad).not.toHaveBeenCalled();
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

      // El tercer argumento es el conversor que el combo cargó UNA vez: el
      // pre-chequeo lo recibe en vez de releer el catálogo por componente.
      expect(spyDisponible).toHaveBeenCalledWith(
        TENANT,
        'receta-uuid',
        conversorMock,
      );
      // venderIngredientesReceta (y por ende registrarMovimiento para sus
      // ingredientes) NUNCA se llama: cero escrituras para esta receta.
      expect(spyReceta).not.toHaveBeenCalled();
      expect(inventarioServiceMock.registrarMovimiento).not.toHaveBeenCalled();
      expect(advertencias).toEqual([
        'Combo: no había stock suficiente de Hamburguesa, se vendió sin ese componente',
      ]);
    });

    it('componente omitido por falta de stock → tampoco descuenta sus grupos de modificadores', async () => {
      // El combo se vende sin la hamburguesa: la proteína que el cliente había
      // elegido PARA esa hamburguesa tampoco salió de la cocina. Sin el filtro,
      // el pre-chequeo lograba "cero escrituras" por el componente y la deriva
      // de inventario se colaba igual por sus modificadores.
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
        .mockResolvedValueOnce(0);
      jest.spyOn(service, 'venderIngredientesReceta').mockResolvedValue([]);
      const spyOpciones = jest
        .spyOn(service as any, 'venderOpcionesGrupos')
        .mockResolvedValue(undefined);

      const grupoDeLaHamburguesa = {
        grupoId: 'proteina-uuid',
        grupoNombre: 'Proteína',
        opciones: [
          {
            itemId: 'chuleta-uuid',
            nombre: 'Chuleta',
            cantidad: '150',
            unidadCodigo: 'g',
            precioExtra: '1500',
            unidades: '1',
          },
        ],
      };

      const advertencias = await service.venderComponentesCombo(
        managerMock as any,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          comboItemId: COMBO_NO_BLOQ_ID,
          comboNombre: 'Combo',
          cantidadVendida: '2',
          snapshot: {
            omitidos: [],
            extras: [],
            componentes: [
              {
                componenteItemId: 'receta-uuid',
                componenteNombre: 'Hamburguesa',
                unidad: 1,
                grupos: [grupoDeLaHamburguesa],
              },
            ],
          },
        },
      );

      // Una sola llamada: la de los grupos del combo en sí (snapshot.grupos).
      // Sin el filtro habría una segunda con los grupos del componente omitido.
      expect(spyOpciones).toHaveBeenCalledTimes(1);
      expect(spyOpciones).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        [grupoDeLaHamburguesa],
      );
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

    it('descuenta el stock de la opción de grupo de cada componente-unidad', async () => {
      const RECETA_ID = 'receta-combo-componentes-uuid';
      const PROTEINA_ID = 'proteina-componentes-uuid';
      const CHULETA_ID = 'chuleta-componentes-uuid';
      const POLLO_ID = 'pollo-componentes-uuid';

      const spyMov = jest
        .spyOn(inventarioServiceMock, 'registrarMovimiento')
        .mockResolvedValue({} as any);

      managerMock.query
        .mockResolvedValueOnce([]) // combo_componentes: sin componentes fijos
        .mockResolvedValueOnce([{ tipo: 'producto', unidad_medida: 'g' }]) // lookup de la opción de la unidad 1 (chuleta)
        .mockResolvedValueOnce([{ tipo: 'producto', unidad_medida: 'g' }]); // lookup de la opción de la unidad 2 (pollo)

      // Dos "componente-unidad" (dos hamburguesas del combo), cada una con su
      // propia elección de grupo. Cada entrada del snapshot es UNA unidad: si
      // venderOpcionesGrupos multiplicara además por `unidad` (1, 2) o por el
      // número de entradas (2), las cantidades calculadas abajo no coincidirían.
      const snapshot = {
        omitidos: [],
        extras: [],
        componentes: [
          {
            componenteItemId: RECETA_ID,
            componenteNombre: 'Hamburguesa',
            unidad: 1,
            grupos: [
              {
                grupoId: PROTEINA_ID,
                grupoNombre: 'Proteína',
                opciones: [
                  {
                    itemId: CHULETA_ID,
                    nombre: 'Chuleta',
                    cantidad: '150',
                    unidadCodigo: 'g',
                    precioExtra: '1500',
                    unidades: '2',
                  },
                ],
              },
            ],
          },
          {
            componenteItemId: RECETA_ID,
            componenteNombre: 'Hamburguesa',
            unidad: 2,
            grupos: [
              {
                grupoId: PROTEINA_ID,
                grupoNombre: 'Proteína',
                opciones: [
                  {
                    itemId: POLLO_ID,
                    nombre: 'Pollo',
                    cantidad: '200',
                    unidadCodigo: 'g',
                    precioExtra: '1200',
                    unidades: '1',
                  },
                ],
              },
            ],
          },
        ],
      };

      await service.venderComponentesCombo(managerMock as any, {
        tenantId: TENANT,
        usuarioId: USUARIO_ID,
        ventaId: VENTA_ID,
        comboItemId: COMBO_ID,
        comboNombre: 'Combo',
        cantidadVendida: '3',
        snapshot,
      });

      // unidad 1 (chuleta): 150 × 2 × 3 = 900 — sin multiplicar por `unidad` (1) ni por las 2 entradas del snapshot
      expect(spyMov).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          itemId: CHULETA_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '900', // 150 × 2 × 3
        }),
      );
      // unidad 2 (pollo): 200 × 1 × 3 = 600 — si se multiplicara por `unidad` (2) o por las 2 entradas, daría 1200
      expect(spyMov).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          itemId: POLLO_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '600', // 200 × 1 × 3
        }),
      );
      expect(spyMov).toHaveBeenCalledTimes(2);
    });
  });

  describe('venderOpcionesGrupos', () => {
    const USUARIO_ID = 'usuario-uuid';
    const VENTA_ID = 'venta-uuid';
    const PROD_ID = 'bebida-uuid';
    const ING_ID = 'carne-uuid';
    const RECETA_ID = 'salsa-uuid';

    it('bloquea las opciones por itemId ascendente, no en el orden del snapshot', async () => {
      // Este loop toma FOR UPDATE por opción: si el orden lo pone el snapshot,
      // lo pone el cliente al armar el carrito, y dos ventas con las mismas
      // opciones en orden distinto se bloquean en cruz. El orden tiene que ser
      // global ENTRE grupos, no determinista dentro de cada uno — por eso se
      // aplanan antes de ordenar.
      const spyMov = jest
        .spyOn(inventarioServiceMock, 'registrarMovimiento')
        .mockResolvedValue({} as any);
      managerMock.query.mockResolvedValue([
        { tipo: 'producto', unidad_medida: 'unidad' },
      ]);

      const opcion = (itemId: string) => ({
        itemId,
        nombre: itemId,
        cantidad: '1',
        unidadCodigo: null,
        precioExtra: '0',
        unidades: '1',
      });

      await (service as any).venderOpcionesGrupos(
        managerMock,
        {
          tenantId: TENANT,
          usuarioId: USUARIO_ID,
          ventaId: VENTA_ID,
          cantidadVendida: '1',
          convertir: conversorMock,
        },
        // Dos grupos, con los ids cruzados a propósito: el orden del snapshot
        // es d, b | c, a.
        [
          {
            grupoId: 'G1',
            grupoNombre: 'Uno',
            opciones: [opcion('d'), opcion('b')],
          },
          {
            grupoId: 'G2',
            grupoNombre: 'Dos',
            opciones: [opcion('c'), opcion('a')],
          },
        ],
      );

      expect(
        spyMov.mock.calls.map((c) => (c[1] as { itemId: string }).itemId),
      ).toEqual(['a', 'b', 'c', 'd']);
    });

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
          convertir: conversorMock,
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
          convertir: conversorMock,
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
          convertir: conversorMock,
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

      // cantidadTotal = 100 × 3 × 2 = 600 se convierte antes de la salida.
      expect(conversorMock).toHaveBeenCalledWith('600', 'g', 'g');
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
            convertir: conversorMock,
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
          convertir: conversorMock,
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
          convertir: conversorMock,
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
          .mockResolvedValueOnce([]) // SELECT item_receta ... ORDER BY item_id FOR UPDATE
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              tipo: 'receta',
            },
          ])
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);

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
          .mockResolvedValueOnce([]) // SELECT item_receta ... ORDER BY item_id FOR UPDATE
          .mockResolvedValueOnce([
            { receta_item_id: RECETA_ID, tipo: 'receta' },
          ])
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValueOnce([]);

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
          .mockResolvedValueOnce([
            { receta_item_id: RECETA_ID, tipo: 'receta' },
          ])
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValueOnce([]);

        const result = await service.descartarDesfases(TENANT, [RECETA_ID]);
        expect(result.descartados).toBe(1);
        expect(managerMock.query).toHaveBeenCalledWith(
          expect.stringContaining('costo_propuesto_omitido'),
          expect.arrayContaining(['200.0000', RECETA_ID]),
        );
      });

      it('aplicar sobre N recetas hace lecturas CONSTANTES, no por receta', async () => {
        const IDS = ['receta-a', 'receta-b', 'receta-c'];
        managerMock.query
          .mockResolvedValueOnce([]) // SELECT item_receta ... ORDER BY item_id FOR UPDATE
          .mockResolvedValueOnce(
            IDS.map((id) => ({ receta_item_id: id, tipo: 'receta' })),
          )
          .mockResolvedValueOnce(
            IDS.map((id) => ({
              receta_item_id: id,
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            })),
          )
          .mockResolvedValue([]); // los UPDATE

        const result = await service.aplicarDesfases(
          TENANT,
          IDS.map((id) => ({ recetaItemId: id })),
        );

        expect(result.aplicados).toBe(3);
        const sqls = managerMock.query.mock.calls.map(
          (c: unknown[]) => c[0] as string,
        );
        // 3 lecturas para el lote entero —el lock, las cabeceras y los
        // ingredientes— + 1 UPDATE por receta (esas son escrituras de N filas,
        // no un N+1). El número es fijo a propósito: con 3 recetas, si alguien
        // vuelve a leer o a bloquear POR RECETA, los SELECT pasan de 3 a 9.
        expect(sqls.filter((s) => s.trim().startsWith('SELECT'))).toHaveLength(
          3,
        );
        // El lock es uno solo para el lote y ordenado: dos lotes con recetas en
        // común tienen que tomarlas en el mismo orden o se abrazan.
        const locks = sqls.filter((s) => s.includes('FOR UPDATE'));
        expect(locks).toHaveLength(1);
        expect(locks[0]).toContain('ORDER BY item_id');
        expect(
          sqls.filter((s) => s.includes('UPDATE item_receta')),
        ).toHaveLength(3);
        // Y una sola carga del catálogo de unidades para los 3 ingredientes:
        // el conversor se crea una vez por lote y convierte en memoria, sin
        // una query por ingrediente.
        expect(catalogServiceMock.crearConversor).toHaveBeenCalledTimes(1);
        expect(catalogServiceMock.convertirUnidad).not.toHaveBeenCalled();
      });

      it('descartar sin ingredientes vivos lanza BadRequest', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { receta_item_id: RECETA_ID, tipo: 'receta' },
          ])
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
          {
            item_id: PROD_ID,
            nombre: 'Producto base',
            tipo: 'producto',
            costo_actual: '500',
          },
        ]) // lookup batch de componentes
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

    it('rechaza un override de cantidad en opción ingrediente sin unidad efectiva', async () => {
      managerMock.query
        .mockResolvedValueOnce([]) // sin asociaciones vivas
        .mockResolvedValueOnce([{ grupo_modificador_id: GRUPO_ID }]) // grupo existe
        .mockResolvedValueOnce([{ item_grupo_id: 'IG-NEW' }]) // INSERT asociación RETURNING
        .mockResolvedValueOnce([]) // sin overrides vivos previos
        .mockResolvedValueOnce([
          {
            grupo_opcion_id: OPCION_ID,
            tipo: 'ingrediente',
            default_cantidad: null,
            default_unidad: null,
            unidad_medida: 'g',
          },
        ]); // opción pertenece (ingrediente, sin default de cantidad/unidad)
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
              opciones: [{ grupoOpcionId: OPCION_ID, cantidad: '250' }], // sin unidadCodigo
            },
          ],
        ),
      ).rejects.toThrow(/unidad de medida/i);
    });

    it('rechaza un override con unidad incompatible en opción ingrediente', async () => {
      // La validación va por el conversor ya cargado, no por `convertirUnidad`:
      // el catálogo se lee una vez para todos los grupos del item.
      conversorMock.mockImplementationOnce(() => {
        throw new Error('unidad incompatible');
      });
      managerMock.query
        .mockResolvedValueOnce([]) // sin asociaciones vivas
        .mockResolvedValueOnce([{ grupo_modificador_id: GRUPO_ID }]) // grupo existe
        .mockResolvedValueOnce([{ item_grupo_id: 'IG-NEW' }]) // INSERT asociación RETURNING
        .mockResolvedValueOnce([]) // sin overrides vivos previos
        .mockResolvedValueOnce([
          {
            grupo_opcion_id: OPCION_ID,
            tipo: 'ingrediente',
            default_cantidad: null,
            default_unidad: null,
            unidad_medida: 'g',
          },
        ]);
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
              opciones: [
                {
                  grupoOpcionId: OPCION_ID,
                  cantidad: '250',
                  unidadCodigo: 'ml',
                },
              ],
            },
          ],
        ),
      ).rejects.toThrow(/incompatible/i);
    });

    it('bloquea borrar un item usado como opción de un grupo vivo', async () => {
      itemRepo.findOne.mockResolvedValueOnce({
        id: ITEM_OPCION_ID,
        tenantId: TENANT,
      });
      managerMock.query.mockResolvedValueOnce([
        { clase: 'opcion', nombre: 'Proteína' },
      ]);

      await expect(service.remove(TENANT, ITEM_OPCION_ID)).rejects.toThrow(
        /No se puede eliminar.*opción de/i,
      );
    });
  });

  describe('remove — clasificación de usos', () => {
    beforeEach(() => {
      itemRepo.findOne.mockResolvedValue({ id: ITEM_ID, tenantId: TENANT });
    });

    it('borra un ingrediente usado solo como extra y soft-deletea sus filas de extras', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ clase: 'extra', nombre: 'Hamburguesa' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.remove(TENANT, ITEM_ID);

      const sqls = managerMock.query.mock.calls.map((c) => c[0] as string);
      expect(sqls).toHaveLength(4);
      expect(sqls[1]).toContain('UPDATE receta_extras_permitidos');
      expect(sqls[1]).toContain('eliminado_el = NOW()');
      expect(sqls[2]).toContain('UPDATE receta_extras_permitidos');
      expect(sqls[2]).toContain('eliminado_el = NOW()');
      expect(sqls[3]).toContain('UPDATE items');
    });

    it('bloquea si es componente de un combo, sin filtrar el extra al mensaje', async () => {
      managerMock.query.mockResolvedValueOnce([
        { clase: 'combo', nombre: 'Menú del día' },
        { clase: 'extra', nombre: 'Hamburguesa' },
      ]);

      await expect(service.remove(TENANT, ITEM_ID)).rejects.toThrow(
        'No se puede eliminar: es componente de Menú del día',
      );
    });

    it('prioriza ingrediente sobre combo en el mensaje, como hacían las tres queries', async () => {
      managerMock.query.mockResolvedValueOnce([
        { clase: 'combo', nombre: 'Menú del día' },
        { clase: 'ingrediente', nombre: 'Pizza' },
      ]);

      await expect(service.remove(TENANT, ITEM_ID)).rejects.toThrow(
        'No se puede eliminar: es ingrediente de Pizza',
      );
    });

    it('acota la consulta de uso por tenant', async () => {
      managerMock.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.remove(TENANT, ITEM_ID);

      expect(managerMock.query.mock.calls[0][1]).toEqual([ITEM_ID, TENANT]);

      // Afirmar sobre los params no alcanza: si alguien saca la condición de
      // tenant de UNA sola rama del UNION, los params ($1, $2) no cambian y una
      // aserción solo de parámetros seguiría en verde. Partir el SQL por `UNION`
      // y exigir la condición de tenant en cada una de las cuatro ramas.
      const sql = managerMock.query.mock.calls[0][0] as string;
      const ramas = sql.split(/\bUNION\b/);
      expect(ramas).toHaveLength(4);
      for (const rama of ramas) {
        expect(rama).toMatch(/tenant_id = \$2/);
      }
    });
  });
});
