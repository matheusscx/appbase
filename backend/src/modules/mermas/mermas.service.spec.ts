import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { MermasService } from './mermas.service';
import { CausasMermaService } from './causas-merma.service';
import { InventarioService } from '../inventario/inventario.service';
import { CatalogService } from '../catalog/catalog.service';

const TENANT = 'tenant-uuid';
const USER = 'user-uuid';
const ITEM = 'item-uuid';
const CAUSA = 'causa-uuid';

const itemRow = (overrides: Record<string, unknown> = {}) => ({
  tipo: 'producto',
  nombre: 'Harina',
  unidad_medida: 'kg',
  modo_inventario: 'cantidad',
  costo_actual: '100',
  ...overrides,
});

describe('MermasService', () => {
  let service: MermasService;
  let transactionQueryMock: jest.Mock;
  let transactionMock: jest.Mock;
  let inventarioService: { registrarMovimiento: jest.Mock };
  let catalogService: { convertirUnidad: jest.Mock };
  let causasService: { assertCausaActiva: jest.Mock };

  beforeEach(async () => {
    transactionQueryMock = jest.fn();
    transactionMock = jest.fn((cb: (manager: { query: jest.Mock }) => unknown) =>
      cb({ query: transactionQueryMock }),
    );
    inventarioService = { registrarMovimiento: jest.fn() };
    catalogService = { convertirUnidad: jest.fn() };
    causasService = { assertCausaActiva: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MermasService,
        {
          provide: getDataSourceToken(),
          useValue: { transaction: transactionMock },
        },
        { provide: InventarioService, useValue: inventarioService },
        { provide: CatalogService, useValue: catalogService },
        { provide: CausasMermaService, useValue: causasService },
      ],
    }).compile();

    service = module.get<MermasService>(MermasService);
  });

  describe('registrar', () => {
    it('con costo_actual congela vigente y calcula costoPerdido', async () => {
      transactionQueryMock.mockResolvedValueOnce([itemRow()]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });
      inventarioService.registrarMovimiento.mockResolvedValueOnce({
        movimientoId: 'mov-1',
        stockAnterior: '10',
        stockResultante: '9',
      });

      const result = await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '1',
        causaMermaId: CAUSA,
      });

      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: TENANT,
          itemId: ITEM,
          usuarioId: USER,
          tipo: 'salida',
          motivo: 'merma',
          cantidad: '1',
          causaMermaId: CAUSA,
          costoUnitario: undefined,
        }),
      );
      expect(result).toEqual({
        movimientoId: 'mov-1',
        stockResultante: '9',
        costoUnitario: '100',
        costoPerdido: '100.0000',
        causaNombre: 'Vencimiento',
      });
    });

    it('rechaza sin costo_actual ni costoUnitario', async () => {
      transactionQueryMock.mockResolvedValueOnce([
        itemRow({ costo_actual: null }),
      ]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });

      await expect(
        service.registrar(TENANT, USER, {
          itemId: ITEM,
          cantidad: '1',
          causaMermaId: CAUSA,
        }),
      ).rejects.toThrow(
        'El producto no tiene costo actual; indica costoUnitario para valorizar esta merma',
      );
      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('registra con costoUnitario explícito sin actualizar costo_actual', async () => {
      transactionQueryMock.mockResolvedValueOnce([
        itemRow({ costo_actual: null }),
      ]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Rotura',
      });
      inventarioService.registrarMovimiento.mockResolvedValueOnce({
        movimientoId: 'mov-2',
        stockAnterior: '5',
        stockResultante: '4',
      });

      const result = await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '2',
        causaMermaId: CAUSA,
        costoUnitario: '50',
      });

      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          motivo: 'merma',
          costoUnitario: '50',
        }),
      );
      const updateCostoCalls = transactionQueryMock.mock.calls.filter(
        ([sql]: [string]) =>
          typeof sql === 'string' && sql.includes('UPDATE item_producto SET costo_actual'),
      );
      expect(updateCostoCalls).toHaveLength(0);
      expect(result.costoPerdido).toBe('100.0000');
    });

    it('convierte unidad cuando unidadCodigo difiere de la base', async () => {
      transactionQueryMock.mockResolvedValueOnce([itemRow()]);
      causasService.assertCausaActiva.mockResolvedValueOnce({
        id: CAUSA,
        nombre: 'Vencimiento',
      });
      catalogService.convertirUnidad.mockResolvedValueOnce('0.5');
      inventarioService.registrarMovimiento.mockResolvedValueOnce({
        movimientoId: 'mov-3',
        stockAnterior: '2',
        stockResultante: '1.5',
      });

      await service.registrar(TENANT, USER, {
        itemId: ITEM,
        cantidad: '500',
        unidadCodigo: 'g',
        causaMermaId: CAUSA,
      });

      expect(catalogService.convertirUnidad).toHaveBeenCalledWith(
        '500',
        'g',
        'kg',
      );
      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cantidad: '0.5' }),
      );
    });

    it('rechaza causa inactiva vía assertCausaActiva', async () => {
      transactionQueryMock.mockResolvedValueOnce([itemRow()]);
      causasService.assertCausaActiva.mockRejectedValueOnce(
        new BadRequestException('Causa de merma no válida o inactiva'),
      );

      await expect(
        service.registrar(TENANT, USER, {
          itemId: ITEM,
          cantidad: '1',
          causaMermaId: CAUSA,
        }),
      ).rejects.toThrow('Causa de merma no válida o inactiva');
      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });
  });
});
