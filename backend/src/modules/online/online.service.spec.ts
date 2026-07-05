import { Test, type TestingModule } from '@nestjs/testing';
import { OnlineService } from './online.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116';

const mockResultado = {
  lineas: [],
  totales: {
    subtotalNeto: '100.0000',
    totalDescuentos: '0.0000',
    totalRecargos: '0.0000',
    totalImpuestos: '0.0000',
    totalFinal: '100.0000',
  },
  trazasVenta: { descuentos: [], recargos: [] },
};

describe('OnlineService', () => {
  let service: OnlineService;
  let calculoPreciosService: jest.Mocked<CalculoPreciosService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnlineService,
        {
          provide: CalculoPreciosService,
          useValue: { calcular: jest.fn().mockResolvedValue(mockResultado) },
        },
      ],
    }).compile();

    service = module.get(OnlineService);
    calculoPreciosService = module.get(CalculoPreciosService);
  });

  it('calcula el carrito sin persistir y devuelve una URL de checkout dummy', async () => {
    const dto = { lineas: [{ itemId: ITEM_ID, cantidad: '1' }] };
    const result = await service.checkout(TENANT_ID, dto);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(calculoPreciosService.calcular).toHaveBeenCalledWith(TENANT_ID, dto);
    expect(result.resultado).toBe(mockResultado);
    expect(result.checkoutRef).toEqual(expect.any(String));
    expect(result.checkoutUrl).toBe(
      `/tienda/pasarela?ref=${result.checkoutRef}`,
    );
  });

  it('genera checkoutRef distintos en cada llamada', async () => {
    const dto = { lineas: [{ itemId: ITEM_ID, cantidad: '1' }] };
    const r1 = await service.checkout(TENANT_ID, dto);
    const r2 = await service.checkout(TENANT_ID, dto);
    expect(r1.checkoutRef).not.toBe(r2.checkoutRef);
  });
});
