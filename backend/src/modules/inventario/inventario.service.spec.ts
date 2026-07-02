// backend/src/modules/inventario/inventario.service.spec.ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { InventarioService } from './inventario.service';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';

const TENANT = 'tenant-uuid';
const ITEM_ID = 'item-uuid';
const USER_ID = 'user-uuid';
const UNIDAD_1 = 'unidad-uuid-1';
const UNIDAD_2 = 'unidad-uuid-2';
const LOTE_ID = 'lote-uuid-1';

describe('InventarioService', () => {
  let service: InventarioService;
  let managerMock: { query: jest.Mock };
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    managerMock = { query: jest.fn() };
    dataSource = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventarioService,
        { provide: getRepositoryToken(MovimientoInventario), useValue: {} },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<InventarioService>(InventarioService);
  });

  // ---------------------------------------------------------------------------
  // Modo 'cantidad' (comportamiento original)
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — modo cantidad', () => {
    it('entrada: suma al stock y registra el movimiento', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '10', modo_inventario: 'cantidad' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE item_producto
        .mockResolvedValueOnce([{ movimiento_id: 'mov-1' }]); // INSERT movimiento

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        },
      );

      expect(res).toEqual({
        movimientoId: 'mov-1',
        stockAnterior: '10',
        stockResultante: '15',
      });
      // La 2ª llamada es UPDATE item_producto con el nuevo saldo
      expect(managerMock.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE item_producto'),
        ['15', ITEM_ID],
      );
    });

    it('salida: resta del stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '10', modo_inventario: 'cantidad' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce([{ movimiento_id: 'mov-2' }]);

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '4',
          usuarioId: USER_ID,
        },
      );

      expect(res.stockResultante).toBe('6');
    });

    it('salida con stock insuficiente lanza BadRequest', async () => {
      managerMock.query.mockResolvedValueOnce([
        { stock: '3', modo_inventario: 'cantidad' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '5',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('item sin fila item_producto lanza BadRequest', async () => {
      managerMock.query.mockResolvedValueOnce([]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // Modo 'serie'
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — modo serie', () => {
    it('entrada serie: inserta unidades, recalcula stock y registra movimiento', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '0', modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_1 }]) // INSERT unidad 1
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_2 }]) // INSERT unidad 2
        .mockResolvedValueOnce([{ cnt: '2' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-s1' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined) // INSERT detalle 1
        .mockResolvedValueOnce(undefined); // INSERT detalle 2

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          cantidad: '2',
          usuarioId: USER_ID,
          series: [
            { serie: 'IMEI-001', condicion: 'nuevo' },
            { serie: 'IMEI-002', condicion: 'nuevo' },
          ],
        },
      );

      expect(res.stockResultante).toBe('2');
      expect(res.movimientoId).toBe('mov-s1');
    });

    it('entrada serie: lanza BadRequest si cantidad != series.length', async () => {
      managerMock.query.mockResolvedValueOnce([
        { stock: '0', modo_inventario: 'serie' },
      ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '3',
          usuarioId: USER_ID,
          series: [{ serie: 'IMEI-001' }, { serie: 'IMEI-002' }], // solo 2, pero cantidad=3
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida serie: cambia estado de unidades y recalcula stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '2', modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([
          { estado: 'disponible', item_id: ITEM_ID, tenant_id: TENANT },
        ]) // SELECT unidad
        .mockResolvedValueOnce(undefined) // UPDATE unidad
        .mockResolvedValueOnce([{ cnt: '1' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-s2' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          usuarioId: USER_ID,
          unidadIds: [UNIDAD_1],
        },
      );

      expect(res.stockResultante).toBe('1');
    });

    it('salida serie sin unidadIds: auto-selecciona FIFO las unidades disponibles', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '2', modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([{ unidad_id: UNIDAD_1 }]) // SELECT FIFO unidades
        .mockResolvedValueOnce([
          { estado: 'disponible', item_id: ITEM_ID, tenant_id: TENANT },
        ]) // SELECT unidad (validación)
        .mockResolvedValueOnce(undefined) // UPDATE unidad
        .mockResolvedValueOnce([{ cnt: '1' }]) // COUNT disponibles
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-s3' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '1',
          usuarioId: USER_ID,
        },
      );

      expect(res.stockResultante).toBe('1');
      // La 2ª query es el SELECT FIFO con ORDER BY creado_el ASC
      expect(managerMock.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('ORDER BY u.creado_el ASC'),
        expect.arrayContaining([ITEM_ID, TENANT]),
      );
    });

    it('salida serie sin unidadIds: lanza BadRequest si no hay suficientes disponibles', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '0', modo_inventario: 'serie' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([]); // SELECT FIFO unidades (0 disponibles)

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '1',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida serie: lanza BadRequest si unidad no está disponible', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '1', modo_inventario: 'serie' }])
        .mockResolvedValueOnce([
          { estado: 'vendido', item_id: ITEM_ID, tenant_id: TENANT },
        ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          usuarioId: USER_ID,
          unidadIds: [UNIDAD_1],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // Modo 'lote'
  // ---------------------------------------------------------------------------
  describe('registrarMovimiento — modo lote', () => {
    it('entrada lote: crea lote nuevo y recalcula stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '0', modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([]) // SELECT lote existente (no existe)
        .mockResolvedValueOnce([{ lote_id: LOTE_ID }]) // INSERT lote
        .mockResolvedValueOnce([{ total: '50' }]) // SUM cantidad_disponible
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-l1' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '50',
          usuarioId: USER_ID,
          lote: { codigoLote: 'LOTE-001', fechaVencimiento: '2027-01-01' },
        },
      );

      expect(res.stockResultante).toBe('50');
    });

    it('salida lote: descuenta del lote y recalcula stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '50', modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([
          { cantidad_disponible: '50', tenant_id: TENANT },
        ]) // SELECT lote FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE lote
        .mockResolvedValueOnce([{ total: '40' }]) // SUM
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-l2' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '10',
          usuarioId: USER_ID,
          loteId: LOTE_ID,
        },
      );

      expect(res.stockResultante).toBe('40');
    });

    it('salida lote sin loteId: auto-selecciona FIFO el lote más antiguo', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '50', modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([
          { lote_id: LOTE_ID, cantidad_disponible: '50' },
        ]) // SELECT lotes FIFO FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE lote
        .mockResolvedValueOnce([{ total: '40' }]) // SUM
        .mockResolvedValueOnce(undefined) // UPDATE stock
        .mockResolvedValueOnce([{ movimiento_id: 'mov-l3' }]) // INSERT movimiento
        .mockResolvedValueOnce(undefined); // INSERT detalle

      const res = await service.registrarMovimiento(
        managerMock as unknown as EntityManager,
        {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '10',
          usuarioId: USER_ID,
        },
      );

      expect(res.stockResultante).toBe('40');
      expect(managerMock.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('ORDER BY creado_el ASC'),
        expect.arrayContaining([ITEM_ID, TENANT]),
      );
    });

    it('salida lote sin loteId: lanza BadRequest si el stock total es insuficiente', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '5', modo_inventario: 'lote' }]) // SELECT FOR UPDATE
        .mockResolvedValueOnce([
          { lote_id: LOTE_ID, cantidad_disponible: '5' },
        ]); // SELECT lotes FIFO (total 5 < 10)

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'venta',
          cantidad: '10',
          usuarioId: USER_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('salida lote: lanza BadRequest si lote insuficiente', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '5', modo_inventario: 'lote' }])
        .mockResolvedValueOnce([
          { cantidad_disponible: '5', tenant_id: TENANT },
        ]);

      await expect(
        service.registrarMovimiento(managerMock as unknown as EntityManager, {
          tenantId: TENANT,
          itemId: ITEM_ID,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '10',
          usuarioId: USER_ID,
          loteId: LOTE_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // findMovimientos
  // ---------------------------------------------------------------------------
  describe('findMovimientos', () => {
    it('mapea filas snake_case a camelCase y filtra por item con paginación', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([
          {
            movimiento_id: 'mov-1',
            item_id: ITEM_ID,
            item_nombre: 'Smartphone',
            tipo: 'entrada',
            motivo: 'compra',
            cantidad: '5.0000',
            stock_anterior: '10.0000',
            stock_resultante: '15.0000',
            usuario_id: USER_ID,
            usuario_nombre: 'Admin',
            comentario: null,
            creado_el: new Date('2026-06-23T10:00:00Z'),
          },
        ]);

      const res = await service.findMovimientos(TENANT, {
        itemId: ITEM_ID,
        page: 1,
        pageSize: 15,
      });

      expect(res.data).toHaveLength(1);
      expect(res.data[0]).toMatchObject({
        id: 'mov-1',
        itemId: ITEM_ID,
        itemNombre: 'Smartphone',
        tipo: 'entrada',
        motivo: 'compra',
        stockResultante: '15.0000',
        usuarioNombre: 'Admin',
      });
      expect(res.meta).toMatchObject({
        page: 1,
        pageSize: 15,
        total: 1,
        totalPages: 1,
      });
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*)'),
        expect.arrayContaining([TENANT, ITEM_ID]),
      );
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT $3 OFFSET $4'),
        expect.arrayContaining([TENANT, ITEM_ID, 15, 0]),
      );
    });
  });
});
