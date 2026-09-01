import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Db } from '../../common/db/db.service';
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
  let dbMock: {
    transaccion: jest.Mock;
    query: jest.Mock;
    sinTransaccion: (fn: () => unknown) => unknown;
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
    dbMock = {
      transaccion: dataSource.transaction,
      query: dataSource.query,
      sinTransaccion: (fn: () => unknown) => fn(),
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
        { provide: Db, useValue: dbMock },
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

    it('sin incluirEliminados filtra eliminado_el IS NULL y no trae auditoría', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.findAll(TENANT, {});

      expect(dataSource.query.mock.calls[0][0]).toContain(
        'eliminado_el IS NULL',
      );
      // Sin filas, la query batch de auditoría ni se dispara.
      expect(dataSource.query).toHaveBeenCalledTimes(2);
    });

    it('incluirEliminados=true no EXCLUYE lo borrado por una persona y trae quién borró (batch, no N+1)', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }]) // count
        .mockResolvedValueOnce([
          {
            item_id: ITEM_ID,
            nombre: 'Smartphone',
            descripcion: null,
            tipo: 'producto',
            activo: false,
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
        ]) // filas
        .mockResolvedValueOnce([
          {
            item_id: ITEM_ID,
            eliminado_el: '2026-07-31T12:00:00.000Z',
            eliminado_por: USUARIO,
            eliminado_por_nombre: 'admin',
          },
        ]); // auditoría batch

      const result = await service.findAll(TENANT, {
        incluirEliminados: true,
      });

      // Revisión final: `incluirEliminados` ya NO es "sin filtro alguno" —
      // decisión del owner, la papelera solo expone lo que borró una
      // persona. La query SÍ contiene `eliminado_el IS NULL` (rama de los
      // vivos), pero como parte de un OR con `eliminado_por IS NOT NULL`,
      // nunca como un AND que excluya lo borrado sin más (eso es lo que el
      // test original cazaba: que no hubiera un filtro duro de "solo
      // vivos").
      expect(dataSource.query.mock.calls[0][0]).toContain(
        '(i.eliminado_el IS NULL OR i.eliminado_por IS NOT NULL)',
      );
      expect(dataSource.query.mock.calls[0][0]).not.toContain(
        'AND i.eliminado_el IS NULL',
      );
      // 3 llamadas totales (count + filas + UNA de auditoría): la de
      // auditoría es batch por página, no una por fila.
      expect(dataSource.query).toHaveBeenCalledTimes(3);
      expect(result.data[0].eliminadoEl).toBe('2026-07-31T12:00:00.000Z');
      expect(result.data[0].eliminadoPor).toBe(USUARIO);
      expect(result.data[0].eliminadoPorNombre).toBe('admin');
    });

    // Regla 5 de docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md.
    // El `toContain` se acota a la cláusula propia del filtro (el `IN` de
    // tipos y los alias de las tres subconsultas correlacionadas), no a
    // `IS NULL` a secas: la query YA trae `eliminado_el IS NULL` sin este
    // filtro, así que afirmar sobre ese fragmento daría un verde falso incluso
    // sin la feature. El whitespace del SQL se normaliza a un solo espacio
    // antes de afirmar: el alineado del template literal (los espacios extra
    // que alinean `item_producto`/`item_receta`/`item_combo` entre sí) es
    // cosmético, y una aserción acoplada a esa alineación se rompe con un
    // reindent que no cambia ningún comportamiento.
    it('sinCosto=true agrega el filtro por subconsultas correlacionadas, sin parámetro nuevo', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.findAll(TENANT, { sinCosto: true });

      const sql = (dataSource.query.mock.calls[0][0] as string).replace(
        /\s+/g,
        ' ',
      );
      expect(sql).toContain(`i.tipo IN ('producto','ingrediente')`);
      expect(sql).toContain(
        'FROM item_producto ip2 WHERE ip2.item_id = i.item_id',
      );
      expect(sql).toContain(
        'FROM item_receta ir2 WHERE ir2.item_id = i.item_id',
      );
      expect(sql).toContain(
        'FROM item_combo icb2 WHERE icb2.item_id = i.item_id',
      );
      expect(sql).toContain(') IS NULL');
      // Sin valor de usuario en la cláusula: el único parámetro sigue siendo
      // el tenant.
      expect(dataSource.query.mock.calls[0][1]).toEqual([TENANT]);
    });

    it('sin sinCosto no agrega el filtro por costo', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.findAll(TENANT, {});

      const sql = dataSource.query.mock.calls[0][0] as string;
      expect(sql).not.toContain('item_producto ip2');
    });

    // `sinCosto` se activa por truthiness (`if (query.sinCosto)`), no por
    // `!== undefined` como su vecino `activo` (línea ~265). Sin este test,
    // cambiar el `if` al molde de `activo` pasaría los dos tests de arriba
    // igual —siguen mandando `true`/ausente— y filtraría también con
    // `sinCosto=false`, que el DTO acepta como valor válido (dos estados:
    // ausente no filtra, `true` sí).
    it('sinCosto=false no agrega el filtro (evita que un `!== undefined` lo active)', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 0 }])
        .mockResolvedValueOnce([]);

      await service.findAll(TENANT, { sinCosto: false });

      const sql = dataSource.query.mock.calls[0][0] as string;
      expect(sql).not.toContain('item_producto ip2');
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
            receta_item_id: 'receta-uuid',
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
            receta_item_id: 'receta-uuid',
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

      it('un ingrediente se guarda sin clasificación tributaria (NULL)', async () => {
        managerMock.query
          .mockResolvedValueOnce([{ codigo_iso: 'CLP', simbolo: '$' }]) // moneda
          .mockResolvedValueOnce([{ item_id: ITEM_ID, creado_el: new Date() }])
          .mockResolvedValueOnce(undefined); // INSERT item_producto
        inventarioServiceMock.registrarMovimiento.mockResolvedValue({
          movimientoId: 'mov-ing',
          stockAnterior: '0',
          stockResultante: '10',
        });

        const result = await service.create(TENANT, 'user-uuid', dtoIng);

        const insertItemsCall = managerMock.query.mock.calls.find(
          (c: unknown[]) => String(c[0]).includes('INSERT INTO items'),
        );
        expect(insertItemsCall[1][9]).toBeNull(); // clasificacion_tributaria
        expect(result).toMatchObject({ clasificacionTributaria: null });
      });

      it('rechaza mandar clasificación tributaria en un ingrediente', async () => {
        await expect(
          service.create(TENANT, 'user-uuid', {
            ...dtoIng,
            clasificacionTributaria: 'afecto',
          } as any),
        ).rejects.toThrow(
          'Un ingrediente no tiene clasificación tributaria: no se vende',
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

    it('create producto persiste costo_actual = 0 (mercadería de donación)', async () => {
      // Decisión del owner (2026-08-29): el 0 es un costo conocido —donación o
      // muestra—, distinto de `null` = "no sé cuánto costó". Hasta acá
      // `validarCostoPositivo` lo rechazaba con 400 y contradecía al propio
      // `CreateItemDto`, que documenta y valida `>= 0` desde antes: no había
      // ningún camino por API para dejar un ítem en `costo_actual = '0'`.
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
        .mockResolvedValueOnce([]); // INSERT item_producto

      await service.create(TENANT, 'user-uuid', {
        nombre: 'Merchandising de muestra',
        precioBase: '0',
        monedaId: 'moneda-uuid',
        tipo: 'producto',
        costo: '0',
      });

      const insertProducto = managerMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('INSERT INTO item_producto'),
      );
      // Por índice y no con `toContain`: los params de este INSERT ya llevan
      // un '0' (el stock inicial), así que un `toContain('0')` pasaría con el
      // costo en null. El costo es el último.
      // Y es '0', NO null: el ítem no queda "sin costo" —`sinCosto` filtra por
      // `IS NULL`, así que este producto no aparece en esa bandeja.
      const paramsProducto = insertProducto?.[1] as unknown[];
      expect(paramsProducto[paramsProducto.length - 1]).toBe('0');
    });

    it('create rechaza un costo negativo', async () => {
      // Lo que el 0 habilitado NO arrastra: el negativo entra a `costo_actual`
      // sin que ninguna regla lo neutralice y ensucia el CPP.
      await expect(
        service.create(TENANT, 'user-uuid', {
          nombre: 'Costo imposible',
          precioBase: '6000',
          monedaId: 'moneda-uuid',
          tipo: 'producto',
          costo: '-1',
        }),
      ).rejects.toThrow(BadRequestException);
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
        .mockResolvedValueOnce([{ impuesto_id: 'iva-sistema', tipo: 'otro' }]) // validarImpuestos
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

    it('rechaza el IVA en impuestosIds al crear un ítem', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([{ impuesto_id: 'iva-cl', tipo: 'iva' }]); // validarImpuestos

      await expect(
        service.create(TENANT, 'user-uuid', {
          ...baseDtoProducto,
          impuestosIds: ['iva-cl'],
        }),
      ).rejects.toThrow(
        'El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria',
      );
    });

    it('sigue aceptando impuestos adicionales (tipo distinto de iva)', async () => {
      // El rechazo mira SOLO las filas tipo='iva': una lista de 'otro' es
      // válida en cualquier clasificación, y eso es la regla de negocio, no
      // un detalle.
      managerMock.query
        .mockResolvedValueOnce([{ '?column?': 1 }]) // moneda ok
        .mockResolvedValueOnce([{ impuesto_id: 'otro-1', tipo: 'otro' }]) // validarImpuestos
        .mockResolvedValueOnce([{ item_id: ITEM_ID }]) // INSERT items RETURNING
        .mockResolvedValue([]); // extensión + item_impuestos
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-0',
        stockAnterior: '0',
        stockResultante: '5',
      });

      await expect(
        service.create(TENANT, 'user-uuid', {
          ...baseDtoProducto,
          impuestosIds: ['otro-1'],
        }),
      ).resolves.toBeDefined();
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
        .mockResolvedValueOnce([{ impuesto_id: 'imp-nuevo', tipo: 'otro' }]) // validarImpuestos
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

    it('rechaza el IVA en impuestosIds al editar un ítem', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'producto' }]) // SELECT existing
        .mockResolvedValueOnce([{ impuesto_id: 'iva-cl', tipo: 'iva' }]); // validarImpuestos

      await expect(
        service.update(TENANT, USUARIO, ITEM_ID, {
          impuestosIds: ['iva-cl'],
        }),
      ).rejects.toThrow(
        'El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria',
      );
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

    it('lee la regla con FOR SHARE al asociarla, en el mismo statement que el nivel', async () => {
      // La otra mitad del par que cierra la carrera del nivel de una regla: el
      // cambio de nivel toma `FOR UPDATE` sobre esta misma fila
      // (`descuentos.service.ts` / `recargos.service.ts` →
      // `validarCambioDeNivel`). Sin este lock la lectura es un phantom: bajo
      // READ COMMITTED las dos transacciones commitean y queda una regla de
      // nivel venta asociada a un ítem, que es el estado que las dos puertas
      // existen para impedir.
      //
      // Se afirma también que `nivel` viaja en el MISMO statement, porque de
      // eso depende el arreglo: al resolverse la espera, Postgres reevalúa la
      // fila ya actualizada (EvalPlanQual) y el nivel comparado es el nuevo.
      // Un `SELECT ... FOR SHARE` aparte del que lee `nivel` volvería a
      // comparar el valor viejo.
      managerMock.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM descuentos'))
          return Promise.resolve([{ nivel: 'linea' }]);
        if (sql.includes('FROM items'))
          return Promise.resolve([{ item_id: ITEM_ID, tipo: 'producto' }]);
        return Promise.resolve([]);
      });

      await service.update(TENANT, USUARIO, ITEM_ID, {
        descuentosIds: ['desc-1'],
      });

      const lectura = managerMock.query.mock.calls
        .map((c: unknown[]) => c[0] as string)
        .find((sql) => sql.includes('FROM descuentos'));
      // Anclado al `SELECT`, no un `toContain('nivel')` suelto: un statement de
      // solo-lock con un comentario SQL que diga "nivel" contiene las dos
      // substrings sin que el lock y la lectura estén juntos, y el test pasaría
      // con el arreglo roto (es el mismo modo de falla que ya está anotado en
      // `docs/agent/anti-patterns.md` sobre afirmar contra el SQL).
      expect(lectura).toContain('FOR SHARE');
      expect(lectura).toMatch(/SELECT\s+nivel\s+FROM descuentos/);
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
        .mockResolvedValueOnce([]) // ingredientes vivos (diff del guard)
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
        5,
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

    // Gemelos de los dos de `extrasPermitidos` de más abajo, por la cuarta
    // puerta: el e2e prueba que el guard bloquea, pero no puede ver la FORMA de
    // la consulta —un viaje para los N que se sacan, y ninguno si no se saca
    // nada—.
    it('ingredientes: pregunta por los N que se sacan en UNA sola consulta', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'receta' }])
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
        .mockResolvedValueOnce([
          { ingrediente_item_id: 'ingrediente-queso' },
          { ingrediente_item_id: 'ingrediente-pan' },
          { ingrediente_item_id: 'ingrediente-carne' },
        ]) // ingredientes vivos
        .mockResolvedValueOnce([]) // guard: ninguna cuenta abierta los omitió
        .mockResolvedValueOnce([]) // soft-delete
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([]); // UPDATE item_receta
      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('1');

      await service.update(TENANT, USUARIO, ITEM_ID, {
        ingredientes: [
          {
            ingredienteItemId: 'ingrediente-queso',
            cantidad: '1',
            unidadCodigo: 'kg',
          },
        ],
      });

      const guardCalls = managerMock.query.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].includes('cuenta_lineas'),
      );
      expect(guardCalls).toHaveLength(1);
      // Los dos que se sacan, juntos; el queso sigue entrando y no se pregunta
      // por él.
      expect(guardCalls[0][1]).toEqual([
        TENANT,
        ITEM_ID,
        ['ingrediente-pan', 'ingrediente-carne'],
      ]);
      const sql = guardCalls[0][0] as string;
      expect(sql).toMatch(/c\.estado = 'abierta'/);
      expect(sql).toMatch(/cl\.item_id = \$2/);
      expect(sql).toMatch(/'omitidos', jsonb_build_array\(x\.id\)/);
      expect(sql).toMatch(/cl\.eliminado_el IS NULL/);
      expect(sql).toMatch(/c\.eliminado_el IS NULL/);
      expect(sql).toMatch(/m\.eliminado_el IS NULL/);
    });

    it('ingredientes: no pregunta nada si no se saca ninguno', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'receta' }])
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
        ])
        .mockResolvedValueOnce([{ ingrediente_item_id: 'ingrediente-queso' }])
        .mockResolvedValueOnce([]) // soft-delete
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([]); // UPDATE item_receta
      catalogServiceMock.convertirUnidad.mockResolvedValueOnce('2');

      // Cambiarle la CANTIDAD al único ingrediente: la lista no pierde a nadie.
      await service.update(TENANT, USUARIO, ITEM_ID, {
        ingredientes: [
          {
            ingredienteItemId: 'ingrediente-queso',
            cantidad: '2',
            unidadCodigo: 'kg',
          },
        ],
      });

      expect(
        managerMock.query.mock.calls.filter(
          (c: unknown[]) =>
            typeof c[0] === 'string' && c[0].includes('cuenta_lineas'),
        ),
      ).toHaveLength(0);
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
            // El `mockResolvedValue` contesta también la lectura de vivos del
            // guard de omitidos: con el queso ya adentro, el diff queda vacío
            // y este test sigue midiendo solo el orden de locks.
            ingrediente_item_id: 'ingrediente-queso',
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

    it('toma `item_combo` ANTES del UPDATE items — orden de locks contra aplicarDesfases', async () => {
      // Gemelo del test de recetas de más arriba, por el otro ciclo:
      // `aplicarDesfases` bloquea `item_combo` y después escribe `items` (el
      // precio). Si el PATCH de combo los toma al revés, las dos se abrazan
      // (40P01) con un "editar combo" corriendo contra un "aplicar desfase
      // con actualizar precio".
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'combo' }])
        .mockResolvedValue([
          {
            item_id: 'producto-queso',
            nombre: 'Queso',
            tipo: 'producto',
            costo_actual: '500',
          },
        ]);

      await service.update(TENANT, USUARIO, ITEM_ID, {
        nombre: 'Combo renombrado',
        componentes: [{ componenteItemId: 'producto-queso', cantidad: '1' }],
      });

      const sqls = managerMock.query.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      const lockCombo = sqls.findIndex((sql) =>
        sql.includes('FROM item_combo WHERE item_id = $1 FOR UPDATE'),
      );
      const updateItems = sqls.findIndex((sql) =>
        sql.includes('UPDATE items SET'),
      );
      expect(lockCombo).toBeGreaterThan(-1);
      expect(updateItems).toBeGreaterThan(-1);
      expect(lockCombo).toBeLessThan(updateItems);
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

    // El e2e prueba que el guard bloquea; lo que NO puede ver es la forma de la
    // consulta. Estos dos fijan eso: un solo viaje para los N extras que se
    // sacan (no uno por extra), acotado a esta receta y a cuentas abiertas.
    it('extrasPermitidos: pregunta por los N extras que se sacan en UNA sola consulta', async () => {
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
        .mockResolvedValueOnce([
          { ingrediente_item_id: 'ingrediente-queso' },
          { ingrediente_item_id: 'ingrediente-tocino' },
          { ingrediente_item_id: 'ingrediente-cebolla' },
        ]) // extras vivos
        .mockResolvedValueOnce([]) // guard: ninguna cuenta abierta los pidió
        .mockResolvedValueOnce([]) // soft-delete
        .mockResolvedValueOnce([]); // INSERT

      await service.update(TENANT, USUARIO, ITEM_ID, {
        extrasPermitidos: [
          {
            ingredienteItemId: 'ingrediente-queso',
            cantidad: '30',
            unidadCodigo: 'g',
            precioExtra: '600',
          },
        ],
      });

      const guardCalls = managerMock.query.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].includes('cuenta_lineas'),
      );
      expect(guardCalls).toHaveLength(1);
      // Los dos que se sacan, juntos. El queso sigue entrando: no se pregunta
      // por él, y ésa es la mitad que separa "este extra se saca" de "la lista
      // cambió".
      expect(guardCalls[0][1]).toEqual([
        TENANT,
        ITEM_ID,
        ['ingrediente-tocino', 'ingrediente-cebolla'],
      ]);
      const sql = guardCalls[0][0] as string;
      expect(sql).toMatch(/c\.estado = 'abierta'/);
      expect(sql).toMatch(/cl\.item_id = \$2/);
      expect(sql).toMatch(/cl\.eliminado_el IS NULL/);
      expect(sql).toMatch(/c\.eliminado_el IS NULL/);
      expect(sql).toMatch(/m\.eliminado_el IS NULL/);
    });

    it('extrasPermitidos: no pregunta nada si no se saca ninguno', async () => {
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
        ])
        .mockResolvedValueOnce([{ ingrediente_item_id: 'ingrediente-queso' }])
        .mockResolvedValueOnce([]) // soft-delete
        .mockResolvedValueOnce([]); // INSERT

      await service.update(TENANT, USUARIO, ITEM_ID, {
        extrasPermitidos: [
          {
            ingredienteItemId: 'ingrediente-queso',
            cantidad: '30',
            unidadCodigo: 'g',
            precioExtra: '900',
          },
        ],
      });

      // Repreciar sin sacar a nadie no toca `cuenta_lineas`: sin este test, un
      // guard que pregunta siempre pasa igual el e2e y cuesta una consulta por
      // cada edición de receta del sistema.
      expect(
        managerMock.query.mock.calls.filter(
          (c: unknown[]) =>
            typeof c[0] === 'string' && c[0].includes('cuenta_lineas'),
        ),
      ).toHaveLength(0);
    });

    // Y los de la quinta puerta, `gruposModificadores`. Lo que el e2e no puede
    // ver acá, además de la forma, es que la pregunta va ANTES de los dos
    // soft-deletes: al revés contestaría igual (la lista viva se lee al
    // principio) pero escribiendo sobre una transacción que después aborta.
    it('gruposModificadores: pregunta por los N que se desasocian en UNA sola consulta, antes de borrar', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'receta' }]) // SELECT existing
        .mockResolvedValueOnce([
          { item_grupo_id: 'ig-salsa', grupo_modificador_id: 'grupo-salsa' },
          { item_grupo_id: 'ig-bebida', grupo_modificador_id: 'grupo-bebida' },
          { item_grupo_id: 'ig-postre', grupo_modificador_id: 'grupo-postre' },
        ]) // asociaciones vivas
        .mockResolvedValueOnce([{ grupo_modificador_id: 'grupo-salsa' }]) // el que se queda existe
        .mockResolvedValueOnce([]) // UPDATE de la asociación que persiste
        .mockResolvedValueOnce([]) // SELECT overrides vivos
        .mockResolvedValueOnce([]) // guard: ninguna cuenta abierta los eligió
        .mockResolvedValueOnce([]) // soft-delete de los overrides
        .mockResolvedValueOnce([]); // soft-delete de las asociaciones

      await service.update(TENANT, USUARIO, ITEM_ID, {
        gruposModificadores: [
          { grupoModificadorId: 'grupo-salsa', min: 1, max: 1 },
        ],
      });

      const sqls = managerMock.query.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      const guardCalls = managerMock.query.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' && c[0].includes('cuenta_lineas'),
      );
      expect(guardCalls).toHaveLength(1);
      expect(guardCalls[0][1]).toEqual([
        TENANT,
        ITEM_ID,
        ['grupo-bebida', 'grupo-postre'],
      ]);
      const sql = guardCalls[0][0] as string;
      expect(sql).toMatch(/c\.estado = 'abierta'/);
      // Las dos cotas por ítem, una por rama: afuera para el grupo propio,
      // adentro del containment para el del componente.
      expect(sql).toMatch(/cl\.item_id = \$2/);
      expect(sql).toMatch(/'componenteItemId', \$2::uuid/);
      expect(sql).toMatch(/cl\.eliminado_el IS NULL/);
      expect(sql).toMatch(/c\.eliminado_el IS NULL/);
      expect(sql).toMatch(/m\.eliminado_el IS NULL/);

      const iGuard = sqls.findIndex((q) => q.includes('cuenta_lineas'));
      const iBorrado = sqls.findIndex(
        (q) =>
          q.includes('UPDATE item_grupos_modificadores') &&
          q.includes('eliminado_el = NOW()'),
      );
      expect(iBorrado).toBeGreaterThan(-1);
      expect(iGuard).toBeLessThan(iBorrado);
    });

    it('gruposModificadores: no pregunta nada si no se desasocia ninguno', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ item_id: ITEM_ID, tipo: 'receta' }]) // SELECT existing
        .mockResolvedValueOnce([
          { item_grupo_id: 'ig-salsa', grupo_modificador_id: 'grupo-salsa' },
        ]) // asociaciones vivas
        .mockResolvedValueOnce([{ grupo_modificador_id: 'grupo-salsa' }])
        .mockResolvedValueOnce([]) // UPDATE de la asociación que persiste
        .mockResolvedValueOnce([]); // SELECT overrides vivos

      // Cambiarle el min/max al único grupo asociado: no se va nadie.
      await service.update(TENANT, USUARIO, ITEM_ID, {
        gruposModificadores: [
          { grupoModificadorId: 'grupo-salsa', min: 0, max: 3 },
        ],
      });

      expect(
        managerMock.query.mock.calls.filter(
          (c: unknown[]) =>
            typeof c[0] === 'string' && c[0].includes('cuenta_lineas'),
        ),
      ).toHaveLength(0);
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

    it('rechaza editar la clasificación tributaria de un ingrediente', async () => {
      // El tipo es inmutable (update-item.dto.ts no lo expone), así que se
      // compara contra el tipo guardado, no contra el DTO.
      managerMock.query.mockResolvedValueOnce([
        { item_id: ITEM_ID, tipo: 'ingrediente' },
      ]);

      await expect(
        service.update(TENANT, USUARIO, ITEM_ID, {
          clasificacionTributaria: 'exento',
        }),
      ).rejects.toThrow(
        'Un ingrediente no tiene clasificación tributaria: no se vende',
      );
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
          .mockResolvedValueOnce([]) // SELECT item_combo ... FOR UPDATE (orden de locks)
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

      it('limpia `costo_propuesto_omitido` al reemplazar componentes', async () => {
        // El snapshot descartado es de la lista vieja. Combo = 1×Papas($500),
        // Papas sube a $600 y el usuario descarta (omitido = 600); después
        // edita el combo a 2×Papas (cacheado 1.200) y Papas baja a $300: el
        // propuesto vuelve a dar 600 y coincide con el omitido stale, así que
        // el combo desaparece de la bandeja con 1.200 cacheado contra 600
        // reales. Limpiar la columna en esta misma sentencia lo cierra.
        managerMock.query
          .mockResolvedValueOnce([{ item_id: COMBO_ID, tipo: 'combo' }]) // SELECT existing
          .mockResolvedValueOnce([]) // SELECT item_combo ... FOR UPDATE (orden de locks)
          .mockResolvedValueOnce([
            {
              item_id: PROD_ID,
              nombre: 'Papas fritas',
              tipo: 'producto',
              costo_actual: '600',
            },
          ]) // lookup batch de componentes
          .mockResolvedValueOnce([]) // soft-delete combo_componentes
          .mockResolvedValueOnce([]) // INSERT combo_componentes
          .mockResolvedValueOnce([]) // UPDATE item_combo
          .mockResolvedValueOnce([{ componentes: '1', grupos: '0' }]); // conteo vivos post-cambio

        await service.update(TENANT, USUARIO, COMBO_ID, {
          componentes: [
            { componenteItemId: PROD_ID, cantidad: '2', bloqueante: true },
          ],
        });

        const updateCombo = managerMock.query.mock.calls.find(
          (c: unknown[]) =>
            typeof c[0] === 'string' &&
            c[0].includes('UPDATE item_combo') &&
            c[0].includes('costo_actual'),
        );
        expect(updateCombo?.[0]).toContain('costo_propuesto_omitido = NULL');
        expect(updateCombo?.[1]).toEqual(['1200', COMBO_ID]); // 600 × 2
      });

      it('permite vaciar los componentes si el combo conserva un grupo vivo (solo-grupos, costo 0)', async () => {
        // Simétrico con create(): un combo puede quedar solo-grupos vía PATCH
        // `componentes: []` mientras sobreviva ≥1 grupo. No debe llamar a
        // validarYCostearComponentes (que rechaza []) y su costo se vuelve 0.
        managerMock.query
          .mockResolvedValueOnce([{ item_id: COMBO_ID, tipo: 'combo' }]) // SELECT existing
          .mockResolvedValueOnce([]) // SELECT item_combo ... FOR UPDATE (orden de locks)
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

        await expect(service.remove(TENANT, USUARIO, PROD_ID)).rejects.toThrow(
          /No se puede eliminar.*componente de/i,
        );
      });
    });
  });

  // ── remove ─────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('lanza NotFoundException cuando el item no pertenece al tenant', async () => {
      itemRepo.findOne.mockResolvedValue(null);
      await expect(service.remove(TENANT, USUARIO, ITEM_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-delete cuando el item pertenece al tenant', async () => {
      itemRepo.findOne.mockResolvedValue({ id: ITEM_ID, tenantId: TENANT });
      managerMock.query.mockResolvedValue([]);

      await service.remove(TENANT, USUARIO, ITEM_ID);

      // Llamada 4: la UNION de uso es la 1, los dos soft-delete de
      // `receta_extras_permitidos` (por ingrediente y por receta) son la 2 y la 3
      // — las tres comparten firma `[ITEM_ID, TENANT]` con esta, así que hay que
      // aislar la del `UPDATE items` puntual para no matchear cualquiera.
      expect(managerMock.query).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('UPDATE items'),
        [ITEM_ID, TENANT, USUARIO],
      );
    });

    it('registra quién borró en la misma sentencia', async () => {
      itemRepo.findOne.mockResolvedValue({ id: ITEM_ID, tenantId: TENANT });
      managerMock.query.mockResolvedValue([]);

      await service.remove(TENANT, USUARIO, ITEM_ID);

      const sql = managerMock.query.mock.calls[3][0] as string;
      expect(sql).toMatch(/eliminado_por\s*=\s*\$3/);
      expect(managerMock.query.mock.calls[3][1]).toEqual([
        ITEM_ID,
        TENANT,
        USUARIO,
      ]);
    });

    it('bloquea el borrado si el item es ingrediente de una receta activa', async () => {
      itemRepo.findOne.mockResolvedValueOnce({ id: ITEM_ID, tenantId: TENANT });
      managerMock.query.mockResolvedValueOnce([
        { clase: 'ingrediente', nombre: 'Hamburguesa Clásica' },
      ]);

      await expect(service.remove(TENANT, USUARIO, ITEM_ID)).rejects.toThrow(
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

      await expect(
        service.remove(TENANT, USUARIO, ITEM_ID),
      ).resolves.toBeUndefined();
    });

    it('limpia primero las filas donde el item borrado es el ingrediente ofrecido como extra', async () => {
      itemRepo.findOne.mockResolvedValueOnce({ id: ITEM_ID, tenantId: TENANT });
      managerMock.query
        .mockResolvedValueOnce([]) // sin usos que lo bloqueen
        .mockResolvedValueOnce([]) // soft-delete receta_extras_permitidos (ingrediente_item_id)
        .mockResolvedValueOnce([]) // soft-delete receta_extras_permitidos (receta_item_id)
        .mockResolvedValueOnce([]); // UPDATE items (soft delete)

      await service.remove(TENANT, USUARIO, ITEM_ID);

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

      await service.remove(TENANT, USUARIO, ITEM_ID);

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

  // ── restaurar ──────────────────────────────────────────────────────────────

  describe('restaurar', () => {
    // Una sola sentencia (CTEs encadenadas) por `dataSource.query`, no una
    // transacción con `manager.query`: la primera versión pasaba el
    // timestamp de `eliminado_el` por JS entre dos queries, y el e2e real
    // (Postgres de verdad, no mocks) mostró que eso pierde precisión — ver
    // el comentario en `restaurar()`. Por eso estos tests miran UNA sola
    // llamada a `dataSource.query` para la escritura.
    function mockFindOneServicio() {
      dataSource.query
        .mockResolvedValueOnce([
          {
            item_id: ITEM_ID,
            nombre: 'Servicio restaurado',
            descripcion: null,
            tipo: 'servicio',
            activo: false,
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
            duracion_estimada: null,
            requiere_cita: null,
          },
        ]) // BASE_QUERY
        .mockResolvedValueOnce([]) // impuestos
        .mockResolvedValueOnce([]) // recargos
        .mockResolvedValueOnce([]); // descuentos
    }

    it('deja el item inactivo: la sentencia no toca `activo`', async () => {
      dataSource.query.mockResolvedValueOnce([{ item_id: ITEM_ID }]); // CTE de restaurar
      mockFindOneServicio();

      await service.restaurar(TENANT, ITEM_ID);

      // `items.remove()` es el único de los 16 que pisa `activo = false`, y
      // el valor previo se perdió: si la sentencia mencionara `activo` (por
      // ejemplo para "reactivar" junto con restaurar), el ítem volvería a
      // la venta sin que nadie lo pidiera. Es la única aserción que prueba
      // algo acá: `restaurar()` delega el valor de retorno enteramente en
      // `findOne`, que este test mockea con `activo: false` fijo — afirmar
      // `item.activo === false` sobre esa respuesta sería tautológico (pasa
      // sin importar lo que haga el código real). Que el ítem *de verdad*
      // vuelva inactivo lo prueba el e2e (`papelera.e2e-spec.ts`, contra
      // Postgres real, sin mocks).
      const sql = dataSource.query.mock.calls[0][0] as string;
      expect(sql).not.toMatch(/activo/i);
    });

    it('revive los extras que ESTE mismo borrado se llevó, acotando por el timestamp dentro del mismo SQL', async () => {
      dataSource.query.mockResolvedValueOnce([{ item_id: ITEM_ID }]);
      mockFindOneServicio();

      await service.restaurar(TENANT, ITEM_ID);

      const sql = dataSource.query.mock.calls[0][0] as string;
      expect(sql).toContain('receta_extras_permitidos');
      expect(sql).toMatch(/eliminado_el\s*=\s*NULL/);
      // Acotado al timestamp que le puso `remove()`, leído por una subquery
      // a la CTE `restaurado` — nunca por un parámetro que haya pasado por
      // JS (por eso pierde precisión de microsegundos). Una fila borrada
      // antes por otro motivo tiene otro `eliminado_el` y no debe revivir
      // solo por compartir el `item_id`. Este es el mutante importante:
      // cambiar esta condición por `eliminado_el IS NOT NULL` revivería
      // cualquier fila borrada, no solo la de este borrado.
      expect(sql).toMatch(
        /eliminado_el\s*=\s*\(SELECT eliminado_el_previo FROM restaurado\)/,
      );
      // Y la comparación va **sin** cast de zona horaria. Hasta el 2026-08-06
      // acá se exigía `AT TIME ZONE 'UTC'`, porque `items.eliminado_el` era
      // `timestamp` sin zona y el otro lado `timestamptz`: el cast anclaba los
      // dos a UTC a mano. Con el esquema uniformado a `timestamptz`
      // (`common/invariants/timestamptz-columns.invariant.spec.ts`) el cast se
      // da vuelta y **reintroduce** el bug que arreglaba — convierte la columna
      // a un `timestamp` sin zona que Postgres re-castea con el `TimeZone` de
      // sesión. Medido: 4 horas de corrimiento con la sesión en
      // `America/Santiago`. Por eso la aserción es negativa: que vuelva a
      // aparecer el cast es hoy la regresión, no la ausencia.
      expect(sql).not.toContain('AT TIME ZONE');
    });

    it('revive en las dos direcciones: como ingrediente y como receta', async () => {
      dataSource.query.mockResolvedValueOnce([{ item_id: ITEM_ID }]);
      mockFindOneServicio();

      await service.restaurar(TENANT, ITEM_ID);

      const sql = dataSource.query.mock.calls[0][0] as string;
      expect(sql).toContain('ingrediente_item_id = $1');
      expect(sql).toContain('receta_item_id = $1');
    });

    it('item que no está en la papelera (no existe o sigue vivo) → 404, sin llamar a findOne', async () => {
      dataSource.query.mockResolvedValueOnce([]); // CTE sin match

      await expect(service.restaurar(TENANT, ITEM_ID)).rejects.toThrow(
        NotFoundException,
      );
      // `findOne` no corrió: una sola llamada, la de la sentencia de arriba.
      expect(dataSource.query).toHaveBeenCalledTimes(1);
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

    it('cambiar la unidad de un producto a costo 0 no rebota (mercadería donada)', async () => {
      // Reproduce el bug que cazó la revisión independiente: prohibir el 0 en
      // `registrarMovimiento` por motivo `ajuste_costo` tumbaba ESTE camino —el
      // mismo motivo lo usa la reconversión interna—, así que un producto de
      // donación no podía corregir su unidad de medida. Y `:1470` solo permite
      // cambiar la unidad de un producto SIN movimientos, o sea justo el recién
      // creado: el caso quedaba sin salida.
      // ⚠️ Este test es un ANCLA, no la red: `inventarioService` está mockeado,
      // así que no puede ver el guard que causaba el 400. Lo que caza la
      // regresión de verdad es el e2e homónimo de `costeo-cpp.e2e-spec.ts`
      // —medido: con el guard por motivo puesto, este test sigue verde—.
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([
          {
            modo_inventario: 'cantidad',
            unidad_medida: 'kg',
            costo_actual: '0.0000',
          },
        ])
        .mockResolvedValueOnce([{ cnt: '0' }])
        .mockResolvedValue([]);
      catalogServiceMock.convertirUnidad.mockResolvedValue('1000');
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        movimientoId: 'mov-donado',
      });

      await service.update('tenant-uuid', USUARIO, 'item-uuid', {
        unidadMedida: 'g',
      });

      // 0 por kg sigue siendo 0 por gramo: se reconvierte igual que cualquier
      // otro costo, sin caso especial.
      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({
          motivo: 'ajuste_costo',
          costoUnitario: '0.0000',
        }),
      );
    });

    it('rechaza el cambio de unidad que hace desaparecer un costo positivo', async () => {
      // La otra mitad de la regla: 0,0001/kg reconvertido a gramos es
      // 0,0000001/g ⇒ '0.0000'. Ese 0 no lo eligió nadie, y dejarlo pasar
      // convertiría un producto costeado en uno costeado en cero, en silencio.
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([
          {
            modo_inventario: 'cantidad',
            unidad_medida: 'kg',
            costo_actual: '0.0001',
          },
        ])
        .mockResolvedValueOnce([{ cnt: '0' }])
        .mockResolvedValue([]);
      catalogServiceMock.convertirUnidad.mockResolvedValue('1000');

      await expect(
        service.update('tenant-uuid', USUARIO, 'item-uuid', {
          unidadMedida: 'g',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(inventarioServiceMock.registrarMovimiento).not.toHaveBeenCalled();
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

    it('rechaza el costo positivo que se pierde al convertirlo a la unidad base', async () => {
      // 0,0001/kg en un producto por gramo son 0,0000001/g, y
      // `convertirCostoUnitario` cuantiza a 4 decimales ⇒ '0.0000'. Antes lo
      // frenaba el guard de `registrarMovimiento` ("debe ser mayor a 0"); desde
      // que el 0 es un costo legítimo ese guard ya no lo ve, y sin este chequeo
      // la compra quedaría costeada en 0 en silencio. Lo que se pierde no es el
      // 0 que alguien quiso poner: es un costo positivo que nadie escribió como 0.
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([
          { unidad_medida: 'g', modo_inventario: 'cantidad' },
        ]);
      catalogServiceMock.convertirUnidad.mockResolvedValue('1000'); // 1 kg → 1000 g

      await expect(
        service.ajustarStock('tenant-uuid', 'usuario-uuid', 'item-uuid', {
          cantidad: 1,
          tipo: 'entrada',
          motivo: 'compra',
          unidadCodigo: 'kg',
          costoUnitario: '0.0001',
        } as never),
      ).rejects.toThrow(BadRequestException);

      expect(inventarioServiceMock.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('deja pasar el costo 0 TIPEADO aunque haya conversión de unidad', async () => {
      // El chequeo de arriba mira el costo tipeado, no el convertido: 0 × lo
      // que sea es 0, y ese 0 es el caso que el owner habilitó.
      managerMock.query
        .mockResolvedValueOnce([{ tipo: 'producto' }])
        .mockResolvedValueOnce([
          { unidad_medida: 'g', modo_inventario: 'cantidad' },
        ]);
      catalogServiceMock.convertirUnidad.mockResolvedValue('1000');
      inventarioServiceMock.registrarMovimiento.mockResolvedValue({
        stockResultante: '1000',
      });

      await service.ajustarStock('tenant-uuid', 'usuario-uuid', 'item-uuid', {
        cantidad: 1,
        tipo: 'entrada',
        motivo: 'compra',
        unidadCodigo: 'kg',
        costoUnitario: '0',
      } as never);

      expect(inventarioServiceMock.registrarMovimiento).toHaveBeenCalledWith(
        managerMock,
        expect.objectContaining({ cantidad: '1000', costoUnitario: '0.0000' }),
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
            receta_item_id: RECETA_ID,
            ingrediente_item_id: PAN_ID,
            ingrediente_nombre: 'Pan',
            ingrediente_unidad_medida: 'unidad',
            cantidad: '1',
            unidad_codigo: 'unidad',
            bloqueante: true,
          },
          {
            receta_item_id: RECETA_ID,
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
            receta_item_id: RECETA_ID,
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

    /**
     * El guard del lote, y del modo de falla que se le escapó a la primera
     * versión: los mapas tienen que traer **clave para todo id pedido**, aunque
     * ese ítem no tenga filas. Si el mapa solo se puebla con lo que la consulta
     * devuelve, una receta sin extras da `undefined`, el `??` del resolver cae
     * al método de un solo id y vuelve la consulta por línea que el lote vino a
     * matar. Y el caso "sin filas" es el del seed: no siembra ni una fila de
     * `receta_extras_permitidos`.
     */
    it('con los catálogos precargados no toca la base, ni siquiera si la receta no tiene extras', async () => {
      const catalogos = await (async () => {
        // Consultas del lote: componentes (no hay combos → no se llama),
        // ingredientes, extras (vacío: la receta no tiene) y las de grupos, que
        // son UNA sola acá: `cargarCatalogoGrupos` corta después de las
        // asociaciones cuando nadie tiene grupos asociados.
        managerMock.query
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              ingrediente_item_id: PAN_ID,
              ingrediente_nombre: 'Pan',
              ingrediente_unidad_medida: 'unidad',
              cantidad: '1',
              unidad_codigo: 'unidad',
              bloqueante: true,
            },
          ])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);
        return service.cargarCatalogosPersonalizacion(
          managerMock as any,
          TENANT,
          [{ itemId: RECETA_ID, tipo: 'receta' }],
        );
      })();

      // La clave existe aunque no haya filas: eso es lo que corta el `??`.
      expect(catalogos.extras.has(RECETA_ID)).toBe(true);
      expect(catalogos.extras.get(RECETA_ID)).toEqual([]);

      managerMock.query.mockClear();
      const result = await service.resolverPersonalizacionReceta(
        managerMock as any,
        TENANT,
        RECETA_ID,
        { omitidos: [PAN_ID], extras: [] },
        catalogos,
      );

      expect(managerMock.query).not.toHaveBeenCalled();
      expect(result.precioExtraTotal).toBe('0.0000');
    });

    /**
     * El gemelo del de arriba por el segundo mapa del lote —el tercero está en
     * `resolverPersonalizacionCombo`—. Van los tres y no uno porque el
     * pre-poblado se revierte **por loader**: un mutante sobre
     * `obtenerIngredientesRecetaPorIds` o sobre `obtenerComponentesComboPorIds`
     * sobrevivía la suite entera cuando el único caso montado era el de extras.
     * Lo que se protege es siempre lo mismo: el ítem SIN filas tiene que quedar
     * en el mapa igual, o el `??` del resolver vuelve a consultar por línea.
     */
    it('una receta SIN ingredientes tampoco toca la base con el catálogo precargado', async () => {
      managerMock.query
        .mockResolvedValueOnce([]) // ingredientes: ninguno
        .mockResolvedValueOnce([]) // extras: ninguno
        .mockResolvedValueOnce([]); // grupos: sin asociaciones (corta acá)
      const catalogos = await service.cargarCatalogosPersonalizacion(
        managerMock as any,
        TENANT,
        [{ itemId: RECETA_ID, tipo: 'receta' }],
      );
      expect(catalogos.ingredientes.get(RECETA_ID)).toEqual([]);

      managerMock.query.mockClear();
      const result = await service.resolverPersonalizacionReceta(
        managerMock as any,
        TENANT,
        RECETA_ID,
        { omitidos: [], extras: [] },
        catalogos,
      );

      expect(managerMock.query).not.toHaveBeenCalled();
      expect(result.precioExtraTotal).toBe('0.0000');
    });

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
          {
            item_id: ITEM_ID,
            grupo_modificador_id: GRUPO_ID,
            item_grupo_id: 'ig-tamano',
            nombre: 'Tamaño',
            min: 1,
            max: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: GRUPO_ID,
            item_grupo_id: 'ig-tamano',
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
          {
            item_id: ITEM_ID,
            grupo_modificador_id: GRUPO_ID,
            item_grupo_id: 'ig-tamano',
            nombre: 'Tamaño',
            min: 1,
            max: 1,
          },
          {
            item_id: ITEM_ID,
            grupo_modificador_id: GRUPO_B,
            item_grupo_id: 'ig-salsa',
            nombre: 'Salsa',
            min: 1,
            max: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: GRUPO_ID,
            item_grupo_id: 'ig-tamano',
            item_id: OPCION_ID,
            nombre: 'Grande',
            cantidad: '1',
            unidad_codigo: null,
            precio_extra: '1500.0000',
          },
          {
            grupo_modificador_id: GRUPO_B,
            item_grupo_id: 'ig-salsa',
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
          {
            item_id: ITEM_ID,
            grupo_modificador_id: GRUPO_ID,
            item_grupo_id: 'ig-tamano',
            nombre: 'Tamaño',
            min: 1,
            max: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: GRUPO_ID,
            item_grupo_id: 'ig-tamano',
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
          {
            item_id: ITEM_ID,
            grupo_modificador_id: GRUPO_ID,
            item_grupo_id: 'ig-tamano',
            nombre: 'Tamaño',
            min: 1,
            max: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            grupo_modificador_id: GRUPO_ID,
            item_grupo_id: 'ig-tamano',
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
    /**
     * El tercero de los mapas del lote —los otros dos están en
     * `resolverPersonalizacionReceta`—. Si `obtenerComponentesComboPorIds` no
     * pre-poblara clave para todo id pedido, un combo sin componentes receta
     * daría `undefined`, el `??` caería a la lectura de un solo id y volvería la
     * consulta por línea.
     */
    it('un combo SIN componentes receta tampoco toca la base con el catálogo precargado', async () => {
      managerMock.query
        .mockResolvedValueOnce([]) // combo_componentes: ninguno de tipo receta
        .mockResolvedValueOnce([]); // grupos: sin asociaciones (corta acá)
      const catalogos = await service.cargarCatalogosPersonalizacion(
        managerMock as any,
        TENANT,
        [{ itemId: COMBO_ID, tipo: 'combo' }],
      );
      expect(catalogos.componentesCombo.get(COMBO_ID)).toEqual([]);

      managerMock.query.mockClear();
      const result = await service.resolverPersonalizacionCombo(
        managerMock as any,
        TENANT,
        COMBO_ID,
        { omitidos: [], extras: [] },
        catalogos,
      );

      expect(managerMock.query).not.toHaveBeenCalled();
      expect(result.precioExtraTotal).toBe('0.0000');
    });

    /**
     * El `every` del combo, que hasta esta línea era una rama que ningún test
     * ejercitaba (medido: su mutante sobrevivía la suite entera). Hoy es
     * inalcanzable por construcción —el único productor de
     * `CatalogosPersonalizacion` carga los grupos del combo Y de sus
     * componentes—, así que el catálogo se arma **a mano** para montar el
     * escenario del segundo productor futuro que precargue de menos.
     *
     * Lo que se protege es que un precargado incompleto cueste una consulta y no
     * PLATA: sin el `every`, `catalogoDe` devolvería catálogo vacío para el
     * componente, el `continue` saltearía sus grupos y el combo se cobraría más
     * barato, sin excepción ni advertencia.
     */
    it('con un precargado al que le falta un componente, relee en vez de cobrar de menos', async () => {
      const COMPONENTE_ID = 'componente-receta-uuid';
      const OPCION_ID = 'opcion-cara-uuid';
      const GRUPO_ID = 'grupo-uuid';
      const ITEM_GRUPO = 'item-grupo-uuid';
      // Precargado MUTILADO: trae al combo pero no a su componente.
      const catalogosIncompletos = {
        ingredientes: new Map(),
        extras: new Map(),
        grupos: new Map([
          [COMBO_ID, { asociados: [], opcionesPorGrupo: new Map() }],
        ]),
        componentesCombo: new Map([
          [
            COMBO_ID,
            [
              {
                componente_item_id: COMPONENTE_ID,
                nombre: 'Hamburguesa',
                cantidad: '1',
              },
            ],
          ],
        ]),
      };

      // Al releer, el catálogo real sí trae el grupo pago del componente.
      managerMock.query
        .mockResolvedValueOnce([
          {
            item_id: COMPONENTE_ID,
            grupo_modificador_id: GRUPO_ID,
            item_grupo_id: ITEM_GRUPO,
            nombre: 'Proteína',
            min: 1,
            max: 1,
          },
        ])
        .mockResolvedValueOnce([
          {
            item_grupo_id: ITEM_GRUPO,
            grupo_modificador_id: GRUPO_ID,
            item_id: OPCION_ID,
            nombre: 'Chuleta',
            cantidad: '1',
            unidad_codigo: null,
            precio_extra: '1500.0000',
          },
        ]);

      const result = await service.resolverPersonalizacionCombo(
        managerMock as any,
        TENANT,
        COMBO_ID,
        {
          omitidos: [],
          extras: [],
          componentes: [
            {
              componenteItemId: COMPONENTE_ID,
              unidad: 1,
              grupos: [
                { grupoId: GRUPO_ID, opciones: [{ itemId: OPCION_ID }] },
              ],
            },
          ],
        },
        catalogosIncompletos,
      );

      // Releyó (no se quedó con el catálogo mutilado) y cobró el grupo.
      expect(managerMock.query).toHaveBeenCalled();
      expect(result.precioExtraTotal).toBe('1500.0000');
    });

    const RECETA_ID = 'receta-combo-uuid';
    const PROTEINA_ID = 'proteina-uuid';
    const ITEM_GRUPO_ID = 'item-grupo-uuid';
    const CHULETA_ID = 'chuleta-uuid';
    const CARNE_ID = 'carne-uuid';
    const ITEM_AJENO_ID = 'item-ajeno-uuid';

    // El catálogo de grupos se pide UNA vez por lote para el combo y sus
    // componentes, así que estas son las filas de esas dos consultas —no una
    // pareja de respuestas por unidad, como cuando cada unidad releía todo.
    const ASOCIADOS_PROTEINA = [
      {
        item_id: RECETA_ID,
        grupo_modificador_id: PROTEINA_ID,
        item_grupo_id: ITEM_GRUPO_ID,
        nombre: 'Proteína',
        min: 1,
        max: 1,
      },
    ];
    const OPCIONES_PROTEINA = [
      {
        grupo_modificador_id: PROTEINA_ID,
        item_grupo_id: ITEM_GRUPO_ID,
        item_id: CHULETA_ID,
        nombre: 'Chuleta',
        cantidad: '1',
        unidad_codigo: null,
        precio_extra: '1500.0000',
      },
      {
        grupo_modificador_id: PROTEINA_ID,
        item_grupo_id: ITEM_GRUPO_ID,
        item_id: CARNE_ID,
        nombre: 'Carne',
        cantidad: '1',
        unidad_codigo: null,
        precio_extra: '0.0000',
      },
    ];

    it('resuelve los grupos de un componente receta por unidad y suma el recargo', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          {
            combo_item_id: COMBO_ID,
            componente_item_id: RECETA_ID,
            nombre: 'Hamburguesa',
            cantidad: '2',
          },
        ]) // 1. combo_componentes receta con cantidad 2
        .mockResolvedValueOnce(ASOCIADOS_PROTEINA) // 2. catálogo por lote: asociaciones
        .mockResolvedValueOnce(OPCIONES_PROTEINA); // 3. catálogo por lote: opciones

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

    it('el catálogo de grupos se lee por lote: el conteo no crece ni con las unidades ni con los componentes', async () => {
      // Guarda contra la regresión al N+1: antes esto costaba dos consultas por
      // CADA (componente con grupos × unidad) —acá serían 12— más una tercera
      // para averiguar qué componentes tenían grupos. Las dos dimensiones van
      // juntas a propósito: un combo de UN componente con cantidad 1 no
      // distingue el arreglo del bug.
      const RECETA_B_ID = 'receta-b-uuid';
      const ITEM_GRUPO_B_ID = 'item-grupo-b-uuid';
      // El mock contesta por el SQL y no por el orden de llamada, a propósito:
      // así una consulta de más devuelve datos válidos y lo ÚNICO que puede
      // fallar es el conteo. Con una cadena de `mockResolvedValueOnce`, el
      // regreso al N+1 reventaba con un mock agotado y el error no decía nada
      // de lo que este test protege.
      const componentes = [
        {
          combo_item_id: COMBO_ID,
          componente_item_id: RECETA_ID,
          nombre: 'Hamburguesa',
          cantidad: '3',
        },
        {
          combo_item_id: COMBO_ID,
          componente_item_id: RECETA_B_ID,
          nombre: 'Pizza',
          cantidad: '3',
        },
      ];
      const asociados = [
        {
          item_id: RECETA_ID,
          grupo_modificador_id: PROTEINA_ID,
          item_grupo_id: ITEM_GRUPO_ID,
          nombre: 'Proteína',
          min: 0, // opcional: solo una de las tres unidades elige
          max: 1,
        },
        {
          item_id: RECETA_B_ID,
          grupo_modificador_id: PROTEINA_ID,
          item_grupo_id: ITEM_GRUPO_B_ID,
          nombre: 'Proteína',
          min: 0,
          max: 1,
        },
      ];
      const opciones = [
        ...OPCIONES_PROTEINA,
        {
          grupo_modificador_id: PROTEINA_ID,
          item_grupo_id: ITEM_GRUPO_B_ID,
          item_id: CHULETA_ID,
          nombre: 'Chuleta',
          cantidad: '1',
          unidad_codigo: null,
          precio_extra: '900.0000', // override propio del componente B
        },
      ];
      managerMock.query.mockImplementation((sql: string) => {
        if (sql.includes('combo_componentes'))
          return Promise.resolve(componentes);
        if (sql.includes('item_grupos_modificadores'))
          return Promise.resolve(asociados);
        if (sql.includes('grupo_modificador_opciones'))
          return Promise.resolve(opciones);
        return Promise.resolve([]);
      });

      const res = await service.resolverPersonalizacionCombo(
        managerMock as any,
        TENANT,
        COMBO_ID,
        {
          componentes: [
            {
              componenteItemId: RECETA_ID,
              unidad: 2,
              grupos: [
                {
                  grupoId: PROTEINA_ID,
                  opciones: [{ itemId: CHULETA_ID, unidades: 1 }],
                },
              ],
            },
            {
              componenteItemId: RECETA_B_ID,
              unidad: 3,
              grupos: [
                {
                  grupoId: PROTEINA_ID,
                  opciones: [{ itemId: CHULETA_ID, unidades: 1 }],
                },
              ],
            },
          ],
        },
      );

      // Componentes y combo_componentes + las dos del catálogo. Nada más.
      expect(managerMock.query).toHaveBeenCalledTimes(3);
      // Y el catálogo compartido resuelve de verdad: el override del componente
      // B (900) es distinto del de A (1500), así que si el lote se repartiera
      // mal entre items este total no daría.
      expect(res.precioExtraTotal).toBe('2400.0000');
      expect(res.snapshot.componentes).toHaveLength(2);
    });

    it('rechaza un componenteItemId que no es componente vivo del combo', async () => {
      managerMock.query
        .mockResolvedValueOnce([
          {
            combo_item_id: COMBO_ID,
            componente_item_id: RECETA_ID,
            nombre: 'Hamburguesa',
            cantidad: '2',
          },
        ]) // 1. combo_componentes
        .mockResolvedValueOnce(ASOCIADOS_PROTEINA) // 2. catálogo por lote: asociaciones
        .mockResolvedValueOnce(OPCIONES_PROTEINA); // 3. catálogo por lote: opciones

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
        .mockResolvedValueOnce([
          {
            combo_item_id: COMBO_ID,
            componente_item_id: RECETA_ID,
            nombre: 'Hamburguesa',
            cantidad: '2',
          },
        ]) // 1. combo_componentes
        .mockResolvedValueOnce(ASOCIADOS_PROTEINA) // 2. catálogo por lote: asociaciones
        .mockResolvedValueOnce(OPCIONES_PROTEINA); // 3. catálogo por lote: opciones

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
            item_id: ITEM_ID,
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
            item_grupo_id: 'IG1',
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
            item_id: ITEM_ID,
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
            item_grupo_id: 'IG1',
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
            receta_item_id: 'receta-uuid',
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
      //
      // Desde el 2026-08-30 la consulta es la del loader por lote
      // (`obtenerIngredientesRecetaPorIds`), así que ordena primero por receta:
      // lo que importa acá es que `ingrediente_item_id` siga siendo la clave
      // **final**, porque dentro de una receta ese es el orden de bloqueo.
      managerMock.query.mockResolvedValueOnce([]);

      await service.venderIngredientesReceta(managerMock as any, PARAMS);

      expect(managerMock.query).toHaveBeenNthCalledWith(
        1,
        expect.stringMatching(
          /ORDER BY\s+ri\.receta_item_id,\s*ri\.ingrediente_item_id/,
        ),
        [['receta-uuid'], TENANT],
      );
    });

    it('genera un movimiento de salida por cada ingrediente con la cantidad convertida', async () => {
      managerMock.query.mockResolvedValueOnce([
        {
          receta_item_id: 'receta-uuid',
          ingrediente_item_id: 'pan',
          ingrediente_nombre: 'Pan',
          ingrediente_unidad_medida: 'unidad',
          cantidad: '1',
          unidad_codigo: 'unidad',
          bloqueante: true,
        },
        {
          receta_item_id: 'receta-uuid',
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
          receta_item_id: 'receta-uuid',
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
          receta_item_id: 'receta-uuid',
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
          receta_item_id: 'receta-uuid',
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
            receta_item_id: 'receta-uuid',
            ingrediente_item_id: 'pan',
            ingrediente_nombre: 'Pan',
            ingrediente_unidad_medida: 'unidad',
            cantidad: '1',
            unidad_codigo: 'unidad',
            bloqueante: true,
          },
          {
            receta_item_id: 'receta-uuid',
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

  // ── consumoDeLineas ────────────────────────────────────────────────────────

  describe('consumoDeLineas', () => {
    // Ítems y cantidades REALES del seed (`seeder.service.ts`:
    // `seedIngredientesBase`, `seedPapasFritas`, `seedGruposModificadores`,
    // `seedComboEspecial`). Se usan los del seed y no números inventados
    // porque un test que afirma una cantidad que nadie sirvió pasa igual y no
    // prueba nada.
    const uuid = (n: number): string =>
      `550e8400-e29b-41d4-a716-44665544${String(n).padStart(4, '0')}`;
    const PAN = uuid(256); // ingrediente, se compra por unidad
    const CARNE = uuid(257); // ingrediente, se compra en kg
    const QUESO = uuid(258); // ingrediente, se compra en kg
    const PAPAS = uuid(281); // producto, se vende y se compra por unidad
    const PROTEINA = uuid(290); // grupo modificador "Proteína"
    const HAMBURGUESA = uuid(294); // receta: pan 1 unidad + queso 20 g
    const COMBO = uuid(313); // combo: Hamburguesa Especial + Papas fritas

    /** Las dos filas de `receta_ingredientes` de la Hamburguesa Especial. */
    const ingredientesHamburguesa = [
      {
        receta_item_id: HAMBURGUESA,
        ingrediente_item_id: PAN,
        ingrediente_nombre: 'Pan de hamburguesa',
        ingrediente_unidad_medida: 'unidad',
        cantidad: '1',
        unidad_codigo: 'unidad',
        bloqueante: true,
      },
      {
        receta_item_id: HAMBURGUESA,
        ingrediente_item_id: QUESO,
        ingrediente_nombre: 'Queso laminado',
        ingrediente_unidad_medida: 'kg',
        cantidad: '20',
        unidad_codigo: 'g',
        bloqueante: false,
      },
    ];

    /** La opción "Carne molida" del grupo Proteína: 150 g por elección. */
    const opcionCarne = {
      itemId: CARNE,
      nombre: 'Carne molida',
      cantidad: '150',
      unidadCodigo: 'g',
      precioExtra: '0',
      unidades: '1',
    };

    it('una línea que omite un ingrediente no lo consume', async () => {
      dataSource.query
        // 1) tipo de los ítems de las líneas
        .mockResolvedValueOnce([{ item_id: HAMBURGUESA, tipo: 'receta' }])
        // 2) catálogo de las opciones de grupo elegidas
        .mockResolvedValueOnce([
          { item_id: CARNE, tipo: 'ingrediente', unidad_medida: 'kg' },
        ])
        // 3) ingredientes de las recetas involucradas
        .mockResolvedValueOnce(ingredientesHamburguesa);

      const consumo = await service.consumoDeLineas(TENANT, [
        {
          itemId: HAMBURGUESA,
          cantidad: '1',
          personalizacion: {
            omitidos: [QUESO],
            extras: [],
            grupos: [
              {
                grupoId: PROTEINA,
                grupoNombre: 'Proteína',
                opciones: [opcionCarne],
              },
            ],
          },
        },
      ]);

      expect(consumo.has(QUESO)).toBe(false);
      // 150 g de carne en la unidad de STOCK del ingrediente (kg).
      expect(consumo.get(CARNE)!.cantidad.toString()).toBe('0.15');
      expect(consumo.get(PAN)!.cantidad.toString()).toBe('1');
    });

    it('un producto suelto se consume a sí mismo, sin expandir nada', async () => {
      dataSource.query.mockResolvedValueOnce([
        { item_id: PAPAS, tipo: 'producto' },
      ]);

      const consumo = await service.consumoDeLineas(TENANT, [
        { itemId: PAPAS, cantidad: '2', personalizacion: null },
      ]);

      expect(consumo.get(PAPAS)).toEqual({
        cantidad: new Decimal('2'),
        bloqueante: true,
      });
      // Ni receta ni combo ni grupos: una sola consulta, la del tipo.
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it('una receta sin personalización consume sus ingredientes por la cantidad pedida', async () => {
      dataSource.query
        // 1) tipos
        .mockResolvedValueOnce([{ item_id: HAMBURGUESA, tipo: 'receta' }])
        // 2) ingredientes de la receta
        .mockResolvedValueOnce(ingredientesHamburguesa);

      const consumo = await service.consumoDeLineas(TENANT, [
        { itemId: HAMBURGUESA, cantidad: '2', personalizacion: null },
      ]);

      expect(consumo.get(PAN)).toEqual({
        cantidad: new Decimal('2'),
        bloqueante: true,
      });
      // 20 g × 2 = 40 g, y el queso se guarda en kg.
      expect(consumo.get(QUESO)).toEqual({
        cantidad: new Decimal('0.04'),
        bloqueante: false,
      });
    });

    it('convierte a la unidad de stock: una receta en gramos sobre un ingrediente en kilos', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ item_id: HAMBURGUESA, tipo: 'receta' }])
        .mockResolvedValueOnce(ingredientesHamburguesa);

      const consumo = await service.consumoDeLineas(TENANT, [
        { itemId: HAMBURGUESA, cantidad: '3', personalizacion: null },
      ]);

      // Se convierte DESPUÉS de multiplicar, una sola vez: 20 g × 3 = 60 g.
      expect(conversorMock).toHaveBeenCalledWith('60', 'g', 'kg');
      expect(consumo.get(QUESO)!.cantidad.toString()).toBe('0.06');
    });

    it('un extra pagado suma su porción por las veces que se agregó, y no bloquea', async () => {
      dataSource.query
        // 1) tipos
        .mockResolvedValueOnce([{ item_id: HAMBURGUESA, tipo: 'receta' }])
        // 2) ingredientes de la receta
        .mockResolvedValueOnce(ingredientesHamburguesa)
        // 3) catálogo de los extras del snapshot
        .mockResolvedValueOnce([
          { item_id: CARNE, nombre: 'Carne molida', unidad_medida: 'kg' },
        ]);

      const consumo = await service.consumoDeLineas(TENANT, [
        {
          itemId: HAMBURGUESA,
          cantidad: '1',
          personalizacion: {
            omitidos: [],
            extras: [
              {
                ingredienteItemId: CARNE,
                cantidad: '150',
                unidadCodigo: 'g',
                precioExtra: '1500',
                unidades: '2',
              },
            ],
          },
        },
      ]);

      // 150 g × 2 veces = 300 g = 0.3 kg. Un extra nunca frena la venta.
      expect(consumo.get(CARNE)).toEqual({
        cantidad: new Decimal('0.3'),
        bloqueante: false,
      });
    });

    it('un combo consume sus componentes, y los grupos elegidos para ellos', async () => {
      dataSource.query
        // 1) tipos
        .mockResolvedValueOnce([{ item_id: COMBO, tipo: 'combo' }])
        // 2) componentes del combo
        .mockResolvedValueOnce([
          {
            combo_item_id: COMBO,
            componente_item_id: HAMBURGUESA,
            tipo: 'receta',
            cantidad: '1',
            bloqueante: true,
          },
          {
            combo_item_id: COMBO,
            componente_item_id: PAPAS,
            tipo: 'producto',
            cantidad: '1',
            bloqueante: true,
          },
        ])
        // 3) catálogo de las opciones elegidas para el componente receta
        .mockResolvedValueOnce([
          { item_id: CARNE, tipo: 'ingrediente', unidad_medida: 'kg' },
        ])
        // 4) ingredientes de la receta que es componente
        .mockResolvedValueOnce(ingredientesHamburguesa);

      // DOS combos, no uno: con `cantidad: '1'` los tres factores de la
      // multiplicación valen lo mismo que no multiplicar, y el test pasa igual
      // con la aritmética rota.
      const consumo = await service.consumoDeLineas(TENANT, [
        {
          itemId: COMBO,
          cantidad: '2',
          personalizacion: {
            omitidos: [],
            extras: [],
            componentes: [
              {
                componenteItemId: HAMBURGUESA,
                componenteNombre: 'Hamburguesa Especial',
                unidad: 1,
                grupos: [
                  {
                    grupoId: PROTEINA,
                    grupoNombre: 'Proteína',
                    opciones: [opcionCarne],
                  },
                ],
              },
            ],
          },
        },
      ]);

      // 1 papa por combo × 2 combos.
      expect(consumo.get(PAPAS)!.cantidad.toString()).toBe('2');
      // 1 hamburguesa por combo × 2 → 2 panes y 40 g de queso.
      expect(consumo.get(PAN)!.cantidad.toString()).toBe('2');
      expect(consumo.get(QUESO)!.cantidad.toString()).toBe('0.04');
      // El grupo del COMPONENTE cuenta igual que si la receta se hubiera
      // pedido suelta, y también escala: 150 g × 2 = 300 g.
      expect(consumo.get(CARNE)!.cantidad.toString()).toBe('0.3');
    });

    it('una opción de grupo escala por sus unidades Y por la cantidad pedida', async () => {
      // Los dos factores por encima de 1 y distintos entre sí (2 y 3): si
      // fueran iguales, cambiarlos de lugar daría el mismo número y el test no
      // distinguiría un factor del otro.
      dataSource.query
        // 1) tipos
        .mockResolvedValueOnce([{ item_id: HAMBURGUESA, tipo: 'receta' }])
        // 2) catálogo de las opciones elegidas
        .mockResolvedValueOnce([
          { item_id: CARNE, tipo: 'ingrediente', unidad_medida: 'kg' },
        ])
        // 3) ingredientes de la receta
        .mockResolvedValueOnce(ingredientesHamburguesa);

      const consumo = await service.consumoDeLineas(TENANT, [
        {
          itemId: HAMBURGUESA,
          cantidad: '3',
          personalizacion: {
            omitidos: [],
            extras: [],
            grupos: [
              {
                grupoId: PROTEINA,
                grupoNombre: 'Proteína',
                // Doble proteína.
                opciones: [{ ...opcionCarne, unidades: '2' }],
              },
            ],
          },
        },
      ]);

      // 150 g × 2 unidades × 3 hamburguesas = 900 g = 0.9 kg.
      expect(consumo.get(CARNE)!.cantidad.toString()).toBe('0.9');
      // Y los ingredientes fijos escalan solo por la cantidad pedida.
      expect(consumo.get(PAN)!.cantidad.toString()).toBe('3');
      expect(consumo.get(QUESO)!.cantidad.toString()).toBe('0.06');
    });

    it('un componente de combo no bloqueante arrastra a sus ingredientes: el combo entero se puede omitir', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ item_id: COMBO, tipo: 'combo' }])
        .mockResolvedValueOnce([
          {
            combo_item_id: COMBO,
            componente_item_id: HAMBURGUESA,
            tipo: 'receta',
            cantidad: '1',
            // El componente no frena: `venderComponentesCombo` lo omite entero
            // en vez de tirar la venta, así que su pan tampoco frena.
            bloqueante: false,
          },
        ])
        .mockResolvedValueOnce(ingredientesHamburguesa);

      const consumo = await service.consumoDeLineas(TENANT, [
        { itemId: COMBO, cantidad: '1', personalizacion: null },
      ]);

      expect(consumo.get(PAN)!.bloqueante).toBe(false);
    });

    it('dos líneas del mismo ingrediente se suman', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ item_id: HAMBURGUESA, tipo: 'receta' }])
        .mockResolvedValueOnce(ingredientesHamburguesa);

      const consumo = await service.consumoDeLineas(TENANT, [
        { itemId: HAMBURGUESA, cantidad: '1', personalizacion: null },
        { itemId: HAMBURGUESA, cantidad: '2', personalizacion: null },
      ]);

      expect(consumo.get(PAN)!.cantidad.toString()).toBe('3');
      // 20 g + 40 g = 60 g → 0.06 kg.
      expect(consumo.get(QUESO)!.cantidad.toString()).toBe('0.06');
    });

    it('el más permisivo gana: si un solo camino no frena, el ingrediente no frena', async () => {
      // El no bloqueante va PRIMERO a propósito: si la última línea pisara el
      // flag en vez de combinarlo, este test pasaría igual con el orden
      // inverso y no probaría nada.
      dataSource.query
        .mockResolvedValueOnce([
          { item_id: COMBO, tipo: 'combo' },
          { item_id: PAPAS, tipo: 'producto' },
        ])
        .mockResolvedValueOnce([
          {
            combo_item_id: COMBO,
            componente_item_id: PAPAS,
            tipo: 'producto',
            cantidad: '1',
            bloqueante: false,
          },
        ]);

      const consumo = await service.consumoDeLineas(TENANT, [
        { itemId: COMBO, cantidad: '1', personalizacion: null },
        { itemId: PAPAS, cantidad: '1', personalizacion: null },
      ]);

      expect(consumo.get(PAPAS)).toEqual({
        cantidad: new Decimal('2'),
        bloqueante: false,
      });
    });

    it('un servicio no consume stock', async () => {
      dataSource.query.mockResolvedValueOnce([
        { item_id: 'servicio-uuid', tipo: 'servicio' },
      ]);

      const consumo = await service.consumoDeLineas(TENANT, [
        { itemId: 'servicio-uuid', cantidad: '3', personalizacion: null },
      ]);

      expect(consumo.size).toBe(0);
    });

    it('sin líneas no consulta nada', async () => {
      const consumo = await service.consumoDeLineas(TENANT, []);

      expect(consumo.size).toBe(0);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('hace lecturas CONSTANTES en la cantidad de líneas: una por nivel, no una por línea', async () => {
      // 12 líneas de tres formas distintas, y las recetas van CON
      // personalización a propósito: sin extras ni grupos, los niveles 3 y 5
      // no se consultan nunca y un cambio que los hiciera por línea pasaría
      // este test igual. Si la expansión consultara por línea —el N+1 que este
      // método existe para no cometer— serían ≥ 12.
      dataSource.query
        // 1) tipos de los tres ítems distintos
        .mockResolvedValueOnce([
          { item_id: HAMBURGUESA, tipo: 'receta' },
          { item_id: COMBO, tipo: 'combo' },
          { item_id: PAPAS, tipo: 'producto' },
        ])
        // 2) componentes de TODOS los combos
        .mockResolvedValueOnce([
          {
            combo_item_id: COMBO,
            componente_item_id: PAPAS,
            tipo: 'producto',
            cantidad: '1',
            bloqueante: true,
          },
        ])
        // 3) catálogo de TODAS las opciones de grupo elegidas
        .mockResolvedValueOnce([
          { item_id: CARNE, tipo: 'ingrediente', unidad_medida: 'kg' },
        ])
        // 4) ingredientes de TODAS las recetas
        .mockResolvedValueOnce(ingredientesHamburguesa)
        // 5) catálogo de TODOS los extras
        .mockResolvedValueOnce([
          { item_id: QUESO, nombre: 'Queso laminado', unidad_medida: 'kg' },
        ]);

      const lineas = Array.from({ length: 4 }).flatMap(() => [
        {
          itemId: HAMBURGUESA,
          cantidad: '1',
          personalizacion: {
            omitidos: [],
            extras: [
              {
                ingredienteItemId: QUESO,
                cantidad: '20',
                unidadCodigo: 'g',
                precioExtra: '500',
                unidades: '1',
              },
            ],
            grupos: [
              {
                grupoId: PROTEINA,
                grupoNombre: 'Proteína',
                opciones: [opcionCarne],
              },
            ],
          },
        },
        { itemId: COMBO, cantidad: '1', personalizacion: null },
        { itemId: PAPAS, cantidad: '1', personalizacion: null },
      ]);

      await service.consumoDeLineas(TENANT, lineas);

      // Los cinco niveles, una consulta cada uno.
      expect(dataSource.query).toHaveBeenCalledTimes(5);
    });
  });

  describe('desfases de costo', () => {
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
      // Bloque de combos: sin cabeceras, así que `filasDesfaseCombos` no
      // aporta filas y no dispara la 2ª query de componentes.
      dataSource.query.mockResolvedValueOnce([]);
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

    it('itemsAfectadosPorInsumo filtra por insumo', async () => {
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
      const rows = await service.itemsAfectadosPorInsumo(TENANT, CARNE_ID);
      expect(rows).toHaveLength(1);
      // calls[0] = exists check; calls[1] = cabeceras filtradas por ingrediente
      expect(dataSource.query.mock.calls[0][0]).toContain(
        "tipo IN ('ingrediente', 'producto')",
      );
      expect(dataSource.query.mock.calls[1][0]).toContain(
        'ingrediente_item_id',
      );
      expect(dataSource.query.mock.calls[1][1]).toEqual(
        expect.arrayContaining([TENANT, CARNE_ID]),
      );
    });

    const COMBO_ID = 'combo-1';
    const PAPAS_ID = 'papas-1';

    /**
     * Fixture de este test, NO un combo del seed: 1 Hamburguesa (receta,
     * $1.200) + 1 Papas (producto). El único combo que siembra el seeder es
     * "Combo Especial" (Hamburguesa Especial $620 + Papas fritas $800 =
     * $1.420) y no es este — confundirlos ya mandó una cifra equivocada a
     * `combos.md`.
     */
    function mockComboConComponentes(opts: {
      costoCacheado: string;
      omitido: string | null;
      precioBase: string;
      costoPapas: string;
    }) {
      // 1) cabeceras de recetas: vacío, así el bloque de recetas no aporta filas
      dataSource.query.mockResolvedValueOnce([]);
      // 2) cabeceras de combos
      dataSource.query.mockResolvedValueOnce([
        {
          combo_item_id: COMBO_ID,
          nombre: 'Combo Clásico',
          costo_actual: opts.costoCacheado,
          costo_propuesto_omitido: opts.omitido,
          precio_base: opts.precioBase,
        },
      ]);
      // 3) componentes del combo
      dataSource.query.mockResolvedValueOnce([
        {
          combo_item_id: COMBO_ID,
          componente_item_id: RECETA_ID,
          componente_nombre: 'Hamburguesa',
          cantidad: '1',
          costo_actual: '1200.0000',
        },
        {
          combo_item_id: COMBO_ID,
          componente_item_id: PAPAS_ID,
          componente_nombre: 'Papas fritas',
          cantidad: '1',
          costo_actual: opts.costoPapas,
        },
      ]);
    }

    it('listarDesfases incluye el combo cuando sube un componente producto', async () => {
      mockComboConComponentes({
        costoCacheado: '1700.0000',
        omitido: null,
        precioBase: '4200.0000',
        costoPapas: '600.0000',
      });

      const rows = await service.listarDesfases(TENANT);

      expect(rows).toHaveLength(1);
      expect(rows[0].itemId).toBe(COMBO_ID);
      expect(rows[0].tipo).toBe('combo');
      expect(rows[0].costoActual).toBe('1700.0000');
      expect(rows[0].costoPropuesto).toBe('1800.0000');
      expect(rows[0].deltaCosto).toBe('100.0000');
      expect(rows[0].afectados.map((a) => a.itemId)).toEqual([
        RECETA_ID,
        PAPAS_ID,
      ]);
    });

    it('listarDesfases NO incluye el combo mientras la receta que contiene sigue sin aplicarse', async () => {
      // La carne subió: la Hamburguesa propone 1350, pero su CACHEADO sigue en
      // 1200, así que la Σ del combo no se movió. Es la Decisión 1 del spec.
      mockComboConComponentes({
        costoCacheado: '1700.0000',
        omitido: null,
        precioBase: '4200.0000',
        costoPapas: '500.0000',
      });

      const rows = await service.listarDesfases(TENANT);

      expect(rows).toHaveLength(0);
    });

    it('listarDesfases omite el combo cuando propuesto == costo_propuesto_omitido', async () => {
      mockComboConComponentes({
        costoCacheado: '1700.0000',
        omitido: '1800.0000',
        precioBase: '4200.0000',
        costoPapas: '600.0000',
      });

      const rows = await service.listarDesfases(TENANT);

      expect(rows).toHaveLength(0);
    });

    it('un componente servicio aporta 0 y no rompe la fila', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([
        {
          combo_item_id: COMBO_ID,
          nombre: 'Combo con servicio',
          costo_actual: '500.0000',
          costo_propuesto_omitido: null,
          precio_base: '4200.0000',
        },
      ]);
      dataSource.query.mockResolvedValueOnce([
        {
          combo_item_id: COMBO_ID,
          componente_item_id: PAPAS_ID,
          componente_nombre: 'Papas fritas',
          cantidad: '1',
          costo_actual: '600.0000',
        },
        {
          combo_item_id: COMBO_ID,
          componente_item_id: 'servicio-1',
          componente_nombre: 'Delivery',
          cantidad: '1',
          costo_actual: null,
        },
      ]);

      const rows = await service.listarDesfases(TENANT);

      expect(rows[0].costoPropuesto).toBe('600.0000');
      expect(rows[0].afectados[1].costoActual).toBeNull();
    });

    describe('aplicarDesfases / descartarDesfases', () => {
      it('aplicar recomputa costo, limpia omitido y actualiza precio si checkbox', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            {
              item_id: RECETA_ID,
              tipo: 'receta',
              nombre: 'Hamburguesa',
            },
          ]) // cabecerasCompuestas
          .mockResolvedValueOnce([]) // SELECT item_receta ... ORDER BY item_id FOR UPDATE
          .mockResolvedValueOnce([]) // SELECT item_combo ... ORDER BY item_id FOR UPDATE
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValueOnce([]) // UPDATE item_receta
          .mockResolvedValueOnce([]) // UPDATE items SET precio_base
          .mockResolvedValueOnce([]); // combos candidatos de `afectados`: ninguno

        const result = await service.aplicarDesfases(TENANT, [
          {
            itemId: RECETA_ID,
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
            { item_id: RECETA_ID, tipo: 'receta', nombre: 'Hamburguesa' },
          ]) // cabecerasCompuestas
          .mockResolvedValueOnce([]) // SELECT item_receta ... ORDER BY item_id FOR UPDATE
          .mockResolvedValueOnce([]) // SELECT item_combo ... ORDER BY item_id FOR UPDATE
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValueOnce([]) // UPDATE item_receta
          .mockResolvedValueOnce([]); // combos candidatos de `afectados`: ninguno

        await service.aplicarDesfases(TENANT, [
          { itemId: RECETA_ID, actualizarPrecio: false },
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
              itemId: RECETA_ID,
              actualizarPrecio: true,
              precioBase: '0',
            },
          ]),
        ).rejects.toThrow(BadRequestException);
      });

      it('descartar setea costo_propuesto_omitido al propuesto actual', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { item_id: RECETA_ID, tipo: 'receta', nombre: 'Hamburguesa' },
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

        const result = await service.descartarDesfases(TENANT, [
          { itemId: RECETA_ID, costoPropuestoVisto: '200' },
        ]);
        expect(result.descartados).toBe(1);
        expect(managerMock.query).toHaveBeenCalledWith(
          expect.stringContaining('costo_propuesto_omitido'),
          expect.arrayContaining(['200.0000', RECETA_ID]),
        );
      });

      // ── El descarte archiva lo que el usuario VIO ────────────────────────
      //
      // El bug que esto cierra, medido contra la API el 2026-08-24: el descarte
      // RECALCULABA el propuesto y archivaba ese, así que un cambio entre abrir
      // la bandeja y hacer clic dejaba archivado un número que nunca estuvo en
      // pantalla y la fila desaparecía. No hace falta ninguna carrera: el mismo
      // usuario, en otra pestaña.

      it('si el propuesto cambió, esa fila NO se descarta y vuelve en `cambiados`', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { item_id: RECETA_ID, tipo: 'receta', nombre: 'Hamburguesa' },
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
          // Las dos lecturas con que `descartarDesfases` arma la fila que vuelve.
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              nombre: 'Hamburguesa',
              costo_actual: '150',
              costo_propuesto_omitido: null,
              precio_base: '500',
            },
          ])
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              ingrediente_item_id: 'ing-1',
              ingrediente_nombre: 'Pan',
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValue([]);

        // El usuario vio 180; el costo del ingrediente ya está en 200.
        const result = await service.descartarDesfases(TENANT, [
          { itemId: RECETA_ID, costoPropuestoVisto: '180' },
        ]);

        expect(result.descartados).toBe(0);
        expect(result.cambiados).toHaveLength(1);
        expect(result.cambiados[0].itemId).toBe(RECETA_ID);
        expect(result.cambiados[0].nombre).toBe('Hamburguesa');
        expect(result.cambiados[0].costoPropuestoActual).toBe('200.0000');
        // Y NO se archivó nada: archivar el recalculado es exactamente el bug.
        const escribio = (managerMock.query.mock.calls as unknown[][]).some(
          (c) =>
            typeof c[0] === 'string' &&
            c[0].includes('SET costo_propuesto_omitido'),
        );
        expect(escribio).toBe(false);
      });

      // ── La fila vuelve ENTERA, no solo su número ─────────────────────────
      //
      // El drawer del simulador recargaba con `afectados(insumo)`, un alcance
      // más angosto que lo que muestra: los combos que `onAplicarDesfases` le
      // agrega no son alcanzables desde un ingrediente, así que el aviso hablaba
      // de una fila que la recarga sacaba de pantalla. Parchearle solo el
      // `costoPropuesto` no era salida: `deltaCosto`, `margenPctPropuesto` y
      // `precioSugerido` se derivan de él, y ese `precioSugerido` viejo termina
      // escrito en `items.precio_base`.

      it('la fila que cambió vuelve completa y coherente, no solo su costo', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { item_id: RECETA_ID, tipo: 'receta', nombre: 'Hamburguesa' },
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
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              nombre: 'Hamburguesa',
              costo_actual: '150',
              costo_propuesto_omitido: null,
              precio_base: '500',
            },
          ])
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              ingrediente_item_id: 'ing-1',
              ingrediente_nombre: 'Pan',
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValue([]);

        const result = await service.descartarDesfases(TENANT, [
          { itemId: RECETA_ID, costoPropuestoVisto: '180' },
        ]);

        const fila = result.cambiados[0].fila;
        expect(fila).not.toBeNull();
        // El propuesto de la fila es el mismo que se informa: si divergieran, el
        // toast diría un número y la tabla mostraría otro.
        expect(fila!.costoPropuesto).toBe(
          result.cambiados[0].costoPropuestoActual,
        );
        expect(fila!.costoActual).toBe('150.0000');
        expect(fila!.deltaCosto).toBe('50.0000');
        // Y los derivados salen del propuesto NUEVO, que es lo que el parche a
        // mano no podía dar: 500 × 200 / 150.
        expect(fila!.precioSugerido).toBe('666.6667');
        expect(fila!.afectados).toEqual([
          { itemId: 'ing-1', nombre: 'Pan', costoActual: '200' },
        ]);
        // Y el catálogo de unidades se leyó UNA vez, no dos: `crearConversor`
        // hace un `find()` sin caché, así que armar la fila de vuelta sin
        // pasarle el conversor ya cargado lo releía entero.
        expect(catalogServiceMock.crearConversor).toHaveBeenCalledTimes(1);
      });

      it('si al recalcular ya no está desfasada, la fila vuelve en `null`', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { item_id: RECETA_ID, tipo: 'receta', nombre: 'Hamburguesa' },
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
          // El costo cacheado ya coincide con el propuesto: el predicado de la
          // bandeja la filtra, así que no hay fila que pintar. Devolverla con
          // delta 0 sería inventar un desfase que no existe.
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              nombre: 'Hamburguesa',
              costo_actual: '200',
              costo_propuesto_omitido: null,
              precio_base: '500',
            },
          ])
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              ingrediente_item_id: 'ing-1',
              ingrediente_nombre: 'Pan',
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValue([]);

        const result = await service.descartarDesfases(TENANT, [
          { itemId: RECETA_ID, costoPropuestoVisto: '180' },
        ]);

        expect(result.cambiados).toHaveLength(1);
        expect(result.cambiados[0].fila).toBeNull();
      });

      it('una fila que cambió no bloquea a las demás del lote', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { item_id: 'receta-a', tipo: 'receta', nombre: 'Receta A' },
            { item_id: 'receta-b', tipo: 'receta', nombre: 'Receta B' },
          ])
          .mockResolvedValueOnce([
            {
              receta_item_id: 'receta-a',
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '150',
            },
            {
              receta_item_id: 'receta-b',
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValue([]);

        // `receta-a` coincide; `receta-b` cambió bajo los pies del usuario.
        const result = await service.descartarDesfases(TENANT, [
          { itemId: 'receta-a', costoPropuestoVisto: '150' },
          { itemId: 'receta-b', costoPropuestoVisto: '190' },
        ]);

        // Es la decisión del owner (2026-08-25): la que cambió se informa, las
        // demás se descartan igual. Un lote de diez no se cae por una fila.
        expect(result.descartados).toBe(1);
        expect(result.cambiados.map((c) => c.itemId)).toEqual(['receta-b']);
        const updates = (managerMock.query.mock.calls as unknown[][]).filter(
          (c) =>
            typeof c[0] === 'string' && c[0].includes('UPDATE item_receta'),
        );
        expect(updates).toHaveLength(1);
        expect((updates[0][1] as unknown[])[1]).toBe('receta-a');
      });

      it('descartar escribe `item_receta` ANTES que `item_combo` aunque el lote venga al revés', async () => {
        // Orden de bloqueo declarado: item_receta → item_combo → items. Los UPDATE
        // toman lock de fila igual que un FOR UPDATE, así que recorrer el lote en el
        // orden del cliente dejaba que `descartar([combo, receta])` y
        // `descartar([receta, combo])` se abrazaran (40P01). `aplicarDesfases` ya
        // ordena receta → combo.
        managerMock.query
          .mockResolvedValueOnce([
            { item_id: 'combo-x', tipo: 'combo', nombre: 'Combo X' },
            { item_id: 'receta-y', tipo: 'receta', nombre: 'Receta Y' },
          ])
          .mockResolvedValueOnce([
            {
              receta_item_id: 'receta-y',
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
          ])
          .mockResolvedValueOnce([
            {
              combo_item_id: 'combo-x',
              componente_item_id: 'ingrediente-z',
              cantidad: '1',
              costo_actual: '100',
            },
          ])
          .mockResolvedValue([]);

        // El lote viene combo PRIMERO: es el orden que hoy se respeta y que abraza.
        await service.descartarDesfases(TENANT, [
          { itemId: 'combo-x', costoPropuestoVisto: '100' },
          { itemId: 'receta-y', costoPropuestoVisto: '200' },
        ]);

        const sqls = managerMock.query.mock.calls.map(
          (c: unknown[]) => c[0] as string,
        );
        const updReceta = sqls.findIndex((s) =>
          s.includes('UPDATE item_receta'),
        );
        const updCombo = sqls.findIndex((s) => s.includes('UPDATE item_combo'));
        expect(updReceta).toBeGreaterThan(-1);
        expect(updCombo).toBeGreaterThan(-1);
        expect(updReceta).toBeLessThan(updCombo);
      });

      it.each([
        {
          tipo: 'receta' as const,
          idMenor: 'receta-a',
          idMayor: 'receta-b',
          // El propuesto de cada una, para que el descarte COINCIDA y el test
          // siga midiendo el ORDEN y no la rama de "cambió".
          vistoMenor: '150',
          vistoMayor: '200',
          // ingredientesPorReceta: misma unidad en ambos lados, sin
          // conversión real (crearConversor ya tiene default en beforeEach).
          datosDelTipo: [
            {
              receta_item_id: 'receta-b',
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '200',
            },
            {
              receta_item_id: 'receta-a',
              cantidad: '1',
              unidad_codigo: 'kg',
              unidad_base: 'kg',
              costo_actual: '150',
            },
          ],
          updateSql: 'UPDATE item_receta',
        },
        {
          tipo: 'combo' as const,
          idMenor: 'combo-a',
          idMayor: 'combo-b',
          vistoMenor: '80',
          vistoMayor: '100',
          // componentesPorCombo: mismo shape que en el test del ciclo
          // item_receta ↔ item_combo de más arriba.
          datosDelTipo: [
            {
              combo_item_id: 'combo-b',
              componente_item_id: 'ingrediente-z',
              cantidad: '1',
              costo_actual: '100',
            },
            {
              combo_item_id: 'combo-a',
              componente_item_id: 'ingrediente-z',
              cantidad: '1',
              costo_actual: '80',
            },
          ],
          updateSql: 'UPDATE item_combo',
        },
      ])(
        'descartar ordena por `item_id` DENTRO de la pasada de $tipo, aunque el lote venga al revés',
        async ({
          tipo,
          idMenor,
          idMayor,
          vistoMenor,
          vistoMayor,
          datosDelTipo,
          updateSql,
        }) => {
          // `descartarDesfases` no toma ningún FOR UPDATE: el lock lo toma cada
          // UPDATE, en el orden en que se ejecuta. Sin ordenar DENTRO de la
          // pasada, dos filas del mismo tipo (sin ningún ítem del otro tipo de
          // por medio) todavía podían abrazarse si dos lotes las traían en
          // sentidos opuestos. El orden por `item_id` lo aplica el helper
          // `porTipo` de `descartarDesfases`, que alimenta las dos pasadas; el
          // reproductor e2e usa una sola
          // receta y un solo combo, así que el orden intra-tabla de la pasada
          // de combos no lo cubría ningún test hasta acá.
          managerMock.query
            .mockResolvedValueOnce([
              { item_id: idMayor, tipo, nombre: `${tipo} mayor` },
              { item_id: idMenor, tipo, nombre: `${tipo} menor` },
            ]) // cabecerasCompuestas
            .mockResolvedValueOnce(datosDelTipo) // ingredientesPorReceta o componentesPorCombo, según el tipo
            .mockResolvedValue([]); // UPDATE item_receta/item_combo x2

          // El lote viene el id MAYOR primero (orden descendente): es el orden
          // que hoy se respeta y que abraza.
          await service.descartarDesfases(TENANT, [
            { itemId: idMayor, costoPropuestoVisto: vistoMayor },
            { itemId: idMenor, costoPropuestoVisto: vistoMenor },
          ]);

          const updates = managerMock.query.mock.calls.filter(
            (c: unknown[]) =>
              typeof c[0] === 'string' && c[0].includes(updateSql),
          ) as [string, unknown[]][];
          expect(updates).toHaveLength(2);
          expect(updates[0][1][1]).toBe(idMenor);
          expect(updates[1][1][1]).toBe(idMayor);
        },
      );

      it('aplicar sobre N recetas hace lecturas CONSTANTES, no por receta', async () => {
        const IDS = ['receta-a', 'receta-b', 'receta-c'];
        managerMock.query
          .mockResolvedValueOnce(
            IDS.map((id) => ({
              item_id: id,
              tipo: 'receta',
              nombre: `Receta ${id}`,
            })),
          ) // cabecerasCompuestas
          .mockResolvedValueOnce([]) // SELECT item_receta ... ORDER BY item_id FOR UPDATE
          .mockResolvedValueOnce([]) // SELECT item_combo ... ORDER BY item_id FOR UPDATE
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
          IDS.map((id) => ({ itemId: id })),
        );

        expect(result.aplicados).toBe(3);
        const sqls = managerMock.query.mock.calls.map(
          (c: unknown[]) => c[0] as string,
        );
        // 5 lecturas para el lote entero —los 2 locks, las cabeceras, los
        // ingredientes y los combos afectados por las recetas aplicadas— + 1
        // UPDATE por receta (esas son escrituras de N filas, no un N+1). El
        // número es fijo a propósito: con 3 recetas, si alguien vuelve a leer o
        // a bloquear POR RECETA, los SELECT se multiplican.
        expect(sqls.filter((s) => s.trim().startsWith('SELECT'))).toHaveLength(
          5,
        );
        // Un lock por tabla para todo el lote, ordenados y SIEMPRE en el mismo
        // orden entre tablas (`item_receta` → `item_combo`): dos lotes con
        // filas en común tienen que tomarlas igual o se abrazan.
        const locks = sqls.filter((s) => s.includes('FOR UPDATE'));
        expect(locks).toHaveLength(2);
        expect(locks[0]).toContain('FROM item_receta');
        expect(locks[1]).toContain('FROM item_combo');
        expect(locks[0]).toContain('ORDER BY item_id');
        expect(locks[1]).toContain('ORDER BY item_id');
        expect(
          sqls.filter((s) => s.includes('UPDATE item_receta')),
        ).toHaveLength(3);
        // Y una sola carga del catálogo de unidades para los 3 ingredientes:
        // el conversor se crea una vez por lote y convierte en memoria, sin
        // una query por ingrediente.
        expect(catalogServiceMock.crearConversor).toHaveBeenCalledTimes(1);
        expect(catalogServiceMock.convertirUnidad).not.toHaveBeenCalled();
      });

      it('aplicar sobre N combos hace lecturas CONSTANTES, no por combo', async () => {
        const IDS = ['combo-a', 'combo-b', 'combo-c'];
        managerMock.query
          .mockResolvedValueOnce(
            IDS.map((id) => ({
              item_id: id,
              tipo: 'combo',
              nombre: `Combo ${id}`,
            })),
          ) // cabecerasCompuestas
          // El lock de `item_receta` se toma igual —siempre, primero y para
          // todo el lote— pero devuelve `[]` porque este lote es puro combos:
          // no hay ninguna fila de `item_receta` que bloquear.
          .mockResolvedValueOnce([]) // SELECT item_receta ... ORDER BY item_id FOR UPDATE
          .mockResolvedValueOnce([]) // SELECT item_combo ... ORDER BY item_id FOR UPDATE
          .mockResolvedValueOnce(
            IDS.map((id) => ({
              combo_item_id: id,
              componente_item_id: `ingrediente-${id}`,
              cantidad: '2',
              costo_actual: '600.0000',
            })),
          ) // componentesPorCombo
          .mockResolvedValue([]); // los UPDATE

        const result = await service.aplicarDesfases(
          TENANT,
          IDS.map((id) => ({ itemId: id })),
        );

        expect(result.aplicados).toBe(3);
        const sqls = managerMock.query.mock.calls.map(
          (c: unknown[]) => c[0] as string,
        );
        // 4 lecturas para el lote entero —cabeceras, los 2 locks y los
        // componentes— aunque el lote tenga 3 combos: `ingredientesPorReceta`
        // corta en seco con lista vacía (recetasDelLote.length === 0), el
        // catálogo de unidades no se carga (solo lo piden las recetas) y el
        // bloque de `afectados` se saltea entero porque `recetasAplicadas.size`
        // es 0. El número es fijo a propósito: con 3 combos, si alguien vuelve
        // a leer o a bloquear POR COMBO, los SELECT se multiplican y este
        // número lo caza.
        expect(sqls.filter((s) => s.trim().startsWith('SELECT'))).toHaveLength(
          4,
        );
        expect(
          sqls.filter((s) => s.includes('UPDATE item_combo')),
        ).toHaveLength(3);
        expect(catalogServiceMock.crearConversor).not.toHaveBeenCalled();
      });

      it('valida el tenant ANTES de tomar los locks', async () => {
        // Con los locks primero, un id de otro tenant bloquea filas ajenas hasta el
        // rollback del 404. La lectura de cabeceras es la que filtra tenant_id.
        managerMock.query.mockResolvedValueOnce([]).mockResolvedValue([]);

        await expect(
          service.aplicarDesfases(TENANT, [{ itemId: 'de-otro-tenant' }]),
        ).rejects.toThrow(NotFoundException);

        const sqls = managerMock.query.mock.calls.map(
          (c: unknown[]) => c[0] as string,
        );
        expect(sqls.some((s) => s.includes('FOR UPDATE'))).toBe(false);
      });

      it('descartar sin ingredientes vivos lanza BadRequest', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { item_id: RECETA_ID, tipo: 'receta', nombre: 'Hamburguesa' },
          ])
          .mockResolvedValueOnce([]);

        await expect(
          service.descartarDesfases(TENANT, [
            { itemId: RECETA_ID, costoPropuestoVisto: '200' },
          ]),
        ).rejects.toThrow(BadRequestException);
        const omitSql = managerMock.query.mock.calls.find(
          (c: unknown[]) =>
            typeof c[0] === 'string' &&
            c[0].includes('SET costo_propuesto_omitido'),
        );
        expect(omitSql).toBeUndefined();
      });

      it('aplicar un combo escribe Σ de los costos cacheados de sus componentes', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { item_id: COMBO_ID, tipo: 'combo', nombre: 'Combo Clásico' },
          ]) // 1) cabecerasCompuestas
          .mockResolvedValueOnce([]) // 2) lock item_receta
          .mockResolvedValueOnce([]) // 3) lock item_combo
          // sin recetas en el lote: `ingredientesPorReceta` retorna sin consultar
          .mockResolvedValueOnce([
            {
              combo_item_id: COMBO_ID,
              componente_item_id: PAPAS_ID,
              cantidad: '2',
              costo_actual: '600.0000',
            },
          ]) // 4) componentesPorCombo
          .mockResolvedValueOnce([]); // 5) UPDATE item_combo

        const result = await service.aplicarDesfases(TENANT, [
          { itemId: COMBO_ID },
        ]);

        expect(result.aplicados).toBe(1);
        const update = managerMock.query.mock.calls.find(
          (c: unknown[]) =>
            typeof c[0] === 'string' && c[0].includes('UPDATE item_combo'),
        ) as [string, unknown[]] | undefined;
        expect(update).toBeDefined();
        expect(update![0]).toContain('costo_propuesto_omitido = NULL');
        expect(update![1][0]).toBe('1200.0000');
        // Y no hubo consulta de afectados: no se aplicó ninguna receta.
        expect(result.afectados).toEqual([]);
      });

      it('el lote que mezcla una receta con el combo que la contiene omite el combo', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { item_id: RECETA_ID, tipo: 'receta', nombre: 'Hamburguesa' },
            { item_id: COMBO_ID, tipo: 'combo', nombre: 'Combo Clásico' },
          ]) // 1) cabecerasCompuestas
          .mockResolvedValueOnce([]) // 2) lock item_receta
          .mockResolvedValueOnce([]) // 3) lock item_combo
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              cantidad: '150',
              unidad_codigo: 'g',
              unidad_base: 'kg',
              costo_actual: '9000',
            },
          ]) // 4) ingredientesPorReceta
          .mockResolvedValueOnce([]) // 5) UPDATE item_receta
          .mockResolvedValueOnce([
            {
              combo_item_id: COMBO_ID,
              componente_item_id: RECETA_ID,
              cantidad: '1',
              costo_actual: '1200.0000',
            },
          ]) // 6) componentesPorCombo
          .mockResolvedValueOnce([{ combo_item_id: COMBO_ID }]) // 7) combos candidatos de `afectados`
          .mockResolvedValueOnce([
            {
              combo_item_id: COMBO_ID,
              nombre: 'Combo Clásico',
              costo_actual: '1700.0000',
              costo_propuesto_omitido: null,
              precio_base: '4200.0000',
            },
          ]) // 8) filasDesfaseCombos: cabeceras
          .mockResolvedValueOnce([
            {
              combo_item_id: COMBO_ID,
              componente_item_id: RECETA_ID,
              componente_nombre: 'Hamburguesa',
              cantidad: '1',
              costo_actual: '1350.0000',
            },
            {
              combo_item_id: COMBO_ID,
              componente_item_id: PAPAS_ID,
              componente_nombre: 'Papas fritas',
              cantidad: '1',
              costo_actual: '500.0000',
            },
          ]) // 9) filasDesfaseCombos: componentes
          // Cualquier query de más allá de esas 9 sale vacía a propósito: si la
          // implementación deja de omitir el combo, el rojo cae en la aserción
          // del contrato y no en un `TypeError` de mock agotado.
          .mockResolvedValue([]);

        const result = await service.aplicarDesfases(TENANT, [
          { itemId: RECETA_ID },
          { itemId: COMBO_ID },
        ]);

        expect(result.aplicados).toBe(1);
        expect(result.omitidos).toHaveLength(1);
        expect(result.omitidos[0].itemId).toBe(COMBO_ID);
        expect(result.omitidos[0].nombre).toBe('Combo Clásico');
        expect(
          managerMock.query.mock.calls.some(
            (c: unknown[]) =>
              typeof c[0] === 'string' && c[0].includes('UPDATE item_combo'),
          ),
        ).toBe(false);
        // El combo vuelve con el número correcto: 1350 + 500.
        expect(result.afectados).toHaveLength(1);
        expect(result.afectados[0].costoPropuesto).toBe('1850.0000');
      });

      it('aplicar una receta devuelve en afectados los combos que la contienen', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { item_id: RECETA_ID, tipo: 'receta', nombre: 'Hamburguesa' },
          ]) // 1) cabecerasCompuestas
          .mockResolvedValueOnce([]) // 2) lock item_receta
          .mockResolvedValueOnce([]) // 3) lock item_combo
          .mockResolvedValueOnce([
            {
              receta_item_id: RECETA_ID,
              cantidad: '150',
              unidad_codigo: 'g',
              unidad_base: 'kg',
              costo_actual: '9000',
            },
          ]) // 4) ingredientesPorReceta
          .mockResolvedValueOnce([]) // 5) UPDATE item_receta
          // sin combos en el lote: `componentesPorCombo` retorna sin consultar
          .mockResolvedValueOnce([{ combo_item_id: COMBO_ID }]) // 6) candidatos
          .mockResolvedValueOnce([
            {
              combo_item_id: COMBO_ID,
              nombre: 'Combo Clásico',
              costo_actual: '1700.0000',
              costo_propuesto_omitido: null,
              precio_base: '4200.0000',
            },
          ]) // 7) filasDesfaseCombos: cabeceras
          .mockResolvedValueOnce([
            {
              combo_item_id: COMBO_ID,
              componente_item_id: RECETA_ID,
              componente_nombre: 'Hamburguesa',
              cantidad: '1',
              costo_actual: '1350.0000',
            },
            {
              combo_item_id: COMBO_ID,
              componente_item_id: PAPAS_ID,
              componente_nombre: 'Papas fritas',
              cantidad: '1',
              costo_actual: '500.0000',
            },
          ]); // 8) filasDesfaseCombos: componentes

        const result = await service.aplicarDesfases(TENANT, [
          { itemId: RECETA_ID },
        ]);

        expect(result.afectados.map((f) => f.itemId)).toContain(COMBO_ID);
        expect(result.afectados[0].tipo).toBe('combo');
      });

      it('descartar un combo guarda el propuesto en item_combo', async () => {
        managerMock.query
          .mockResolvedValueOnce([
            { item_id: COMBO_ID, tipo: 'combo', nombre: 'Combo Clásico' },
          ]) // 1) cabecerasCompuestas
          // sin recetas en el lote: `ingredientesPorReceta` retorna sin consultar
          .mockResolvedValueOnce([
            {
              combo_item_id: COMBO_ID,
              componente_item_id: PAPAS_ID,
              cantidad: '1',
              costo_actual: '600.0000',
            },
          ]) // 2) componentesPorCombo
          .mockResolvedValueOnce([]); // 3) UPDATE item_combo

        const result = await service.descartarDesfases(TENANT, [
          { itemId: COMBO_ID, costoPropuestoVisto: '600' },
        ]);

        expect(result.descartados).toBe(1);
        const update = managerMock.query.mock.calls.find(
          (c: unknown[]) =>
            typeof c[0] === 'string' && c[0].includes('UPDATE item_combo'),
        ) as [string, unknown[]] | undefined;
        expect(update).toBeDefined();
        expect(update![0]).toContain('costo_propuesto_omitido = $1');
        expect(update![1][0]).toBe('600.0000');
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

      await expect(
        service.remove(TENANT, USUARIO, ITEM_OPCION_ID),
      ).rejects.toThrow(/No se puede eliminar.*opción de/i);
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

      await service.remove(TENANT, USUARIO, ITEM_ID);

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

      await expect(service.remove(TENANT, USUARIO, ITEM_ID)).rejects.toThrow(
        'No se puede eliminar: es componente de Menú del día',
      );
    });

    it('prioriza ingrediente sobre combo en el mensaje, como hacían las tres queries', async () => {
      managerMock.query.mockResolvedValueOnce([
        { clase: 'combo', nombre: 'Menú del día' },
        { clase: 'ingrediente', nombre: 'Pizza' },
      ]);

      await expect(service.remove(TENANT, USUARIO, ITEM_ID)).rejects.toThrow(
        'No se puede eliminar: es ingrediente de Pizza',
      );
    });

    it('bloquea si está pedido en una cuenta abierta', async () => {
      managerMock.query.mockResolvedValueOnce([
        { clase: 'cuenta', nombre: 'Mesa 5 · cuenta 2' },
      ]);

      await expect(service.remove(TENANT, USUARIO, ITEM_ID)).rejects.toThrow(
        'No se puede eliminar: está pedido en Mesa 5 · cuenta 2',
      );
    });

    it('prioriza la cuenta abierta sobre los usos de catálogo', async () => {
      // Los de catálogo se resuelven cuando el admin quiera; la cuenta abierta
      // tiene a alguien esperando en la mesa.
      managerMock.query.mockResolvedValueOnce([
        { clase: 'ingrediente', nombre: 'Pizza' },
        { clase: 'cuenta', nombre: 'Mesa 5 · cuenta 2' },
      ]);

      await expect(service.remove(TENANT, USUARIO, ITEM_ID)).rejects.toThrow(
        'No se puede eliminar: está pedido en Mesa 5 · cuenta 2',
      );
    });

    it('la rama de cuentas solo mira cuentas abiertas y no borradas', async () => {
      managerMock.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.remove(TENANT, USUARIO, ITEM_ID);

      // Las DOS ramas que leen `cuenta_lineas`, no la primera que aparezca: el
      // ítem puede estar pedido como línea (`cl.item_id`) o adentro de la
      // personalización de una línea (el extra), y las dos tienen que llevar
      // los mismos cuatro filtros. Un `find` miraba solo la primera y dejaba la
      // otra sin cubrir.
      const ramas = (managerMock.query.mock.calls[0][0] as string)
        .split(/\bUNION\b/)
        .filter((r) => r.includes('cuenta_lineas'));
      expect(ramas).toHaveLength(2);
      // Sin `estado = 'abierta'` una cuenta cerrada hace inborrable al ítem
      // para siempre; sin los filtros de borrado, una cuenta o una mesa en la
      // papelera hacen lo mismo.
      for (const rama of ramas) {
        expect(rama).toMatch(/c\.estado = 'abierta'/);
        expect(rama).toMatch(/c\.eliminado_el IS NULL/);
        expect(rama).toMatch(/cl\.eliminado_el IS NULL/);
        expect(rama).toMatch(/m\.eliminado_el IS NULL/);
      }
    });

    it('acota la consulta de uso por tenant', async () => {
      managerMock.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.remove(TENANT, USUARIO, ITEM_ID);

      expect(managerMock.query.mock.calls[0][1]).toEqual([ITEM_ID, TENANT]);

      // Afirmar sobre los params no alcanza: si alguien saca la condición de
      // tenant de UNA sola rama del UNION, los params ($1, $2) no cambian y una
      // aserción solo de parámetros seguiría en verde. Partir el SQL por `UNION`
      // y exigir la condición de tenant en cada una de las seis ramas.
      const sql = managerMock.query.mock.calls[0][0] as string;
      const ramas = sql.split(/\bUNION\b/);
      expect(ramas).toHaveLength(6);
      for (const rama of ramas) {
        expect(rama).toMatch(/tenant_id = \$2/);
      }
    });
  });
});
