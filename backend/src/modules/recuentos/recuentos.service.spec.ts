import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { RecuentosService } from './recuentos.service';
import { MotivosDiferenciaInventarioService } from '../motivos-diferencia-inventario/motivos-diferencia-inventario.service';

const TENANT_ID = 'tenant-uuid';
const USUARIO_ID = 'usuario-uuid';
const ITEM_ID = 'item-uuid';
const RECUENTO_ID = 'recuento-uuid';
const LINEA_ID = 'linea-uuid';
const MOTIVO_ID = 'motivo-uuid';

describe('RecuentosService', () => {
  let service: RecuentosService;
  let manager: { query: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let motivosService: { assertMotivoActivo: jest.Mock };

  beforeEach(async () => {
    manager = { query: jest.fn() };
    dataSource = {
      query: jest.fn(),
      transaction: jest.fn((cb: (m: typeof manager) => unknown) => cb(manager)),
    };
    motivosService = { assertMotivoActivo: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecuentosService,
        { provide: getDataSourceToken(), useValue: dataSource },
        {
          provide: MotivosDiferenciaInventarioService,
          useValue: motivosService,
        },
      ],
    }).compile();

    service = module.get<RecuentosService>(RecuentosService);
  });

  describe('RecuentosService — crear sesión', () => {
    it('congela el stock del sistema en cada línea', async () => {
      manager.query
        .mockResolvedValueOnce([
          {
            item_id: ITEM_ID,
            nombre: 'Producto test',
            tipo: 'producto',
            stock: '12400',
            modo_inventario: 'cantidad',
            unidad_medida: 'un',
          },
        ])
        .mockResolvedValueOnce([{ recuento_id: 'recuento-1' }])
        .mockResolvedValueOnce(undefined);

      await service.create(TENANT_ID, USUARIO_ID, { itemIds: [ITEM_ID] });

      const insertLinea = manager.query.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('INSERT INTO recuento_inventario_linea'),
      );
      expect(insertLinea![1]).toEqual(expect.arrayContaining(['12400']));
    });

    it('rechaza un producto en modo serie o lote', async () => {
      manager.query.mockResolvedValueOnce([
        {
          item_id: ITEM_ID,
          nombre: 'Notebook',
          tipo: 'producto',
          stock: '3',
          modo_inventario: 'serie',
          unidad_medida: 'un',
        },
      ]);

      await expect(
        service.create(TENANT_ID, USUARIO_ID, { itemIds: [ITEM_ID] }),
      ).rejects.toThrow('El recuento solo admite productos por cantidad');
    });

    it('rechaza un item sin control de stock', async () => {
      manager.query.mockResolvedValueOnce([]);

      await expect(
        service.create(TENANT_ID, USUARIO_ID, { itemIds: [ITEM_ID] }),
      ).rejects.toThrow('El item no tiene control de stock');
    });

    it('rechaza crear una sesión sin items', async () => {
      await expect(
        service.create(TENANT_ID, USUARIO_ID, { itemIds: [] }),
      ).rejects.toThrow('El recuento necesita al menos un producto');
    });
  });

  describe('RecuentosService — listar sesiones', () => {
    it('formatea diferenciaNeta con Decimal.js aunque Postgres devuelva el literal entero del COALESCE', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            recuento_id: 'recuento-1',
            estado: 'borrador',
            comentario: null,
            creado_el: new Date('2026-07-26T10:00:00Z'),
            aplicado_el: null,
            cantidad_lineas: 2,
            // Postgres devuelve '0' (sin escala) cuando COALESCE cae en el
            // literal entero, no '0.0000' — el bug que este test fija.
            diferencia_neta: '0',
          },
        ]);

      const res = await service.findAll(TENANT_ID, {});

      expect(res.data[0].diferenciaNeta).toBe('0.0000');
      expect(res.data[0].cantidadLineas).toBe(2);
    });
  });

  describe('RecuentosService — cargar conteos', () => {
    it('guarda la cantidad contada de una línea', async () => {
      manager.query
        .mockResolvedValueOnce([{ estado: 'borrador' }])
        .mockResolvedValueOnce([
          {
            linea_id: LINEA_ID,
            item_id: ITEM_ID,
            stock_sistema: '12000',
            cantidad_contada: '11800.0000',
            motivo_diferencia_id: null,
          },
        ]);

      await service.updateLinea(TENANT_ID, RECUENTO_ID, LINEA_ID, {
        cantidadContada: '11800',
      });

      const update = manager.query.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('UPDATE recuento_inventario_linea'),
      );
      expect(update![1]).toEqual(expect.arrayContaining(['11800.0000']));
    });

    it('valida el motivo de diferencia contra el catálogo', async () => {
      manager.query
        .mockResolvedValueOnce([{ estado: 'borrador' }])
        .mockResolvedValueOnce([
          {
            linea_id: LINEA_ID,
            item_id: ITEM_ID,
            stock_sistema: '12000',
            cantidad_contada: '11800.0000',
            motivo_diferencia_id: MOTIVO_ID,
          },
        ]);
      motivosService.assertMotivoActivo.mockResolvedValueOnce({
        id: MOTIVO_ID,
        nombre: 'Merma no declarada',
      });

      await service.updateLinea(TENANT_ID, RECUENTO_ID, LINEA_ID, {
        motivoDiferenciaId: MOTIVO_ID,
      });

      expect(motivosService.assertMotivoActivo).toHaveBeenCalledWith(
        manager,
        TENANT_ID,
        MOTIVO_ID,
      );
    });

    it('rechaza cargar un conteo en una sesión aplicada', async () => {
      manager.query.mockResolvedValueOnce([{ estado: 'aplicado' }]);

      await expect(
        service.updateLinea(TENANT_ID, RECUENTO_ID, LINEA_ID, {
          cantidadContada: '1',
        }),
      ).rejects.toThrow('El recuento ya fue aplicado');
    });

    it('rechaza cargar un conteo en una sesión cancelada', async () => {
      manager.query.mockResolvedValueOnce([{ estado: 'cancelado' }]);

      await expect(
        service.updateLinea(TENANT_ID, RECUENTO_ID, LINEA_ID, {
          cantidadContada: '1',
        }),
      ).rejects.toThrow('El recuento fue cancelado');
    });

    it('rechaza una cantidad contada negativa', async () => {
      await expect(
        service.updateLinea(TENANT_ID, RECUENTO_ID, LINEA_ID, {
          cantidadContada: '-5',
        }),
      ).rejects.toThrow('La cantidad contada no puede ser negativa');
    });

    it('null explícito limpia el conteo cargado', async () => {
      manager.query
        .mockResolvedValueOnce([{ estado: 'borrador' }])
        .mockResolvedValueOnce([
          {
            linea_id: LINEA_ID,
            item_id: ITEM_ID,
            stock_sistema: '12000',
            cantidad_contada: null,
            motivo_diferencia_id: null,
          },
        ]);

      await service.updateLinea(TENANT_ID, RECUENTO_ID, LINEA_ID, {
        cantidadContada: null,
      });

      const update = manager.query.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('UPDATE recuento_inventario_linea'),
      );
      expect(update![1]).toEqual(expect.arrayContaining([null]));
    });

    it('rechaza editar la sesión aplicada', async () => {
      manager.query.mockResolvedValueOnce([{ estado: 'aplicado' }]);

      await expect(
        service.update(TENANT_ID, RECUENTO_ID, { comentario: 'x' }),
      ).rejects.toThrow('El recuento ya fue aplicado');
    });

    it('valida el motivo por defecto al editar la sesión', async () => {
      manager.query
        .mockResolvedValueOnce([{ estado: 'borrador' }])
        .mockResolvedValueOnce([{ recuento_id: RECUENTO_ID }]);
      motivosService.assertMotivoActivo.mockResolvedValueOnce({
        id: MOTIVO_ID,
        nombre: 'Robo',
      });

      await service.update(TENANT_ID, RECUENTO_ID, {
        motivoDiferenciaDefaultId: MOTIVO_ID,
      });

      expect(motivosService.assertMotivoActivo).toHaveBeenCalledWith(
        manager,
        TENANT_ID,
        MOTIVO_ID,
      );
    });

    it('cancelar deja la sesión en cancelado sin tocar stock', async () => {
      manager.query
        .mockResolvedValueOnce([{ estado: 'borrador' }])
        .mockResolvedValueOnce([
          { recuento_id: RECUENTO_ID, estado: 'cancelado' },
        ]);

      await service.cancelar(TENANT_ID, RECUENTO_ID);

      const upd = manager.query.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes("estado = 'cancelado'"),
      );
      expect(upd).toBeDefined();
      const tocaStock = manager.query.mock.calls.find((c: unknown[]) =>
        String(c[0]).includes('UPDATE item_producto'),
      );
      expect(tocaStock).toBeUndefined();
    });

    it('rechaza cancelar una sesión ya aplicada', async () => {
      manager.query.mockResolvedValueOnce([{ estado: 'aplicado' }]);

      await expect(service.cancelar(TENANT_ID, RECUENTO_ID)).rejects.toThrow(
        'El recuento ya fue aplicado',
      );
    });
  });
});
