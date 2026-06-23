// backend/src/modules/inventario/inventario.service.spec.ts
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { InventarioService } from './inventario.service';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';

const TENANT = 'tenant-uuid';
const ITEM_ID = 'item-uuid';
const USER_ID = 'user-uuid';

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

  describe('registrarMovimiento', () => {
    it('entrada: suma al stock y registra el movimiento', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '10' }]) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce(undefined) // UPDATE item_producto
        .mockResolvedValueOnce([{ movimiento_id: 'mov-1' }]); // INSERT

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
      // UPDATE recibe el nuevo stock
      expect(managerMock.query.mock.calls[1][1]).toEqual(['15', ITEM_ID]);
    });

    it('salida: resta del stock', async () => {
      managerMock.query
        .mockResolvedValueOnce([{ stock: '10' }])
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
      managerMock.query.mockResolvedValueOnce([{ stock: '3' }]);

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
});
