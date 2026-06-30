import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { VentasService } from './ventas.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { CajaService } from '../caja/caja.service';
import { InventarioService } from '../inventario/inventario.service';
import { ItemsService } from '../items/items.service';
import { PagosService } from '../pagos/pagos.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const USUARIO_ID = '550e8400-e29b-41d4-a716-446655440056';
const CAJA_ID = 'caja-uuid-001';
const MONEDA_OFICIAL_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116';

const mockCajaActiva = {
  id: CAJA_ID,
  tenantId: TENANT_ID,
  tipo: 'fisica',
  estado: 'abierta',
};

const mockItem = {
  id: ITEM_ID,
  nombre: 'Smartphone',
  tipo: 'producto',
  precioBase: '100.0000',
  precioIncluyeImpuesto: false,
  monedaId: MONEDA_OFICIAL_ID,
  modoInventario: 'cantidad',
  impuestosIds: [],
  descuentosIds: [],
  recargosIds: [],
};

const mockResultadoVenta = {
  lineas: [
    {
      itemId: ITEM_ID,
      cantidad: '1',
      precioUnitario: '100.0000',
      subtotalNeto: '100.0000',
      descuentoAplicado: '0.0000',
      recargoAplicado: '0.0000',
      impuestoAplicado: '0.0000',
      totalLinea: '100.0000',
      trazas: { descuentos: [], recargos: [], impuestos: [] },
    },
  ],
  totales: {
    subtotalNeto: '100.0000',
    totalDescuentos: '0.0000',
    totalRecargos: '0.0000',
    totalImpuestos: '0.0000',
    totalFinal: '100.0000',
  },
  trazasVenta: { descuentos: [], recargos: [] },
};

const MONEDA_ROWS = [
  { moneda_id: MONEDA_OFICIAL_ID, valor_del_dia: '1.000000', es_default: true },
];

function buildManagerMock() {
  const venta = { id: 'venta-uuid-001' };
  const detalle = { id: 'detalle-uuid-001' };
  return {
    create: jest
      .fn()
      .mockImplementation(
        (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
      ),
    save: jest
      .fn()
      .mockImplementation(
        (_entity: unknown, data: Record<string, unknown>): Promise<unknown> => {
          if (data['totalFinal'] !== undefined)
            return Promise.resolve({ ...venta, ...data });
          if (data['ventaId'] !== undefined && data['cantidad'] !== undefined)
            return Promise.resolve({ ...detalle, ...data });
          return Promise.resolve({ ...data });
        },
      ),
    query: jest.fn().mockResolvedValue([]),
  };
}

describe('VentasService', () => {
  let service: VentasService;
  let cajaService: jest.Mocked<CajaService>;
  let calculoPreciosService: jest.Mocked<CalculoPreciosService>;
  let inventarioService: jest.Mocked<InventarioService>;
  let itemsService: jest.Mocked<ItemsService>;
  let pagosServiceMock: { registrar: jest.Mock };
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };

  beforeEach(async () => {
    const manager = buildManagerMock();
    pagosServiceMock = { registrar: jest.fn().mockResolvedValue([]) };
    dataSourceMock = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: typeof manager) => unknown) =>
          cb(manager),
        ),
      // dataSource.query used OUTSIDE transaction for moneda rows only
      query: jest.fn().mockResolvedValue(MONEDA_ROWS),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VentasService,
        {
          provide: CalculoPreciosService,
          useValue: {
            calcular: jest.fn().mockResolvedValue(mockResultadoVenta),
          },
        },
        {
          provide: CajaService,
          useValue: {
            findActiva: jest.fn().mockResolvedValue(mockCajaActiva),
            registrarMovimientoEnTransaccion: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: InventarioService,
          useValue: {
            registrarMovimiento: jest.fn().mockResolvedValue({
              movimientoId: 'mov-1',
              stockAnterior: '10',
              stockResultante: '9',
            }),
          },
        },
        {
          provide: ItemsService,
          useValue: { findOne: jest.fn().mockResolvedValue(mockItem) },
        },
        {
          provide: PagosService,
          useValue: pagosServiceMock,
        },
        {
          provide: getDataSourceToken(),
          useValue: dataSourceMock,
        },
      ],
    }).compile();

    service = module.get<VentasService>(VentasService);
    cajaService = module.get(CajaService);
    calculoPreciosService = module.get(CalculoPreciosService);
    inventarioService = module.get(InventarioService);
    itemsService = module.get(ItemsService);
  });

  const basePago = { metodoPagoId: EFECTIVO_ID, monto: '100.0000' };
  const baseDto = {
    lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
    pagos: [basePago],
  };

  describe('crear()', () => {
    it('lanza BadRequestException si no hay caja abierta', async () => {
      cajaService.findActiva.mockResolvedValueOnce(null);
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, baseDto as any),
      ).rejects.toThrow(new BadRequestException('No tienes una caja abierta'));
    });

    it('crea venta en estado pagada cuando monto cubre el total', async () => {
      const result = await service.crear(TENANT_ID, USUARIO_ID, baseDto);
      expect(result).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(calculoPreciosService.calcular).toHaveBeenCalled();
      expect(dataSourceMock.transaction).toHaveBeenCalled();
    });

    it('llama registrarMovimiento del inventario para items tipo producto', async () => {
      await service.crear(TENANT_ID, USUARIO_ID, baseDto);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tipo: 'salida',
          motivo: 'venta',
          itemId: ITEM_ID,
        }),
      );
    });

    it('no llama registrarMovimiento del inventario para items tipo servicio', async () => {
      itemsService.findOne.mockResolvedValueOnce({
        ...mockItem,
        tipo: 'servicio',
      });
      await service.crear(TENANT_ID, USUARIO_ID, baseDto);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('llama a pagosService.registrar con los params correctos cuando hay pagos', async () => {
      // pago de 150 cuando total es 100 → PagosService calcula el vuelto internamente
      const dtoConExcedente = {
        ...baseDto,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '150.0000' }],
      };
      pagosServiceMock.registrar.mockResolvedValueOnce([
        { id: 'pago-uuid-001', monto: '150.0000', vuelto: '50.0000' },
      ]);
      await service.crear(TENANT_ID, USUARIO_ID, dtoConExcedente);
      expect(pagosServiceMock.registrar).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ target: '100.0000' }),
      );
    });

    it('lanza BadRequestException cuando excedente > 0 y ningún método permite vuelto', async () => {
      const dtoConExcedente = {
        ...baseDto,
        pagos: [{ metodoPagoId: 'tarjeta-id', monto: '150.0000' }],
      };
      // PagosService.registrar lanza BadRequestException cuando no hay método con vuelto
      pagosServiceMock.registrar.mockRejectedValueOnce(
        new BadRequestException(
          'El pago supera el total pero ningún método de pago permite vuelto',
        ),
      );
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoConExcedente as any),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
