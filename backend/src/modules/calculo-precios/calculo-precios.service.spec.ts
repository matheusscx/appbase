import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CalculoPreciosService } from './calculo-precios.service';
import { ItemsService } from '../items/items.service';
import { ImpuestosService } from '../impuestos/impuestos.service';
import { DescuentosService } from '../descuentos/descuentos.service';
import { RecargosService } from '../recargos/recargos.service';
import { TenantsService } from '../tenants/tenants.service';
import { MonedasService } from '../monedas/monedas.service';

const TENANT = 't-1';

const prefs = {
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  formula: ['descuentos', 'recargos', 'impuestos'],
  escalaCalculo: 6,
  modoRedondeo: 'HALF_UP',
  montoTolerancia: '0',
};

describe('CalculoPreciosService', () => {
  let service: CalculoPreciosService;
  let itemsService: { findOne: jest.Mock };
  let impuestosService: { findAll: jest.Mock };
  let descuentosService: { findAll: jest.Mock };
  let recargosService: { findAll: jest.Mock };

  const item = (over: Record<string, unknown> = {}) => ({
    id: 'item-1',
    precioBase: '100',
    monedaId: 'moneda-clp',
    precioIncluyeImpuesto: false,
    impuestosIds: ['imp-1'],
    descuentosIds: ['desc-1'],
    recargosIds: [],
    ...over,
  });

  beforeEach(async () => {
    itemsService = { findOne: jest.fn().mockResolvedValue(item()) };
    impuestosService = {
      findAll: jest
        .fn()
        .mockResolvedValue([
          { id: 'imp-1', nombre: 'IVA', porcentaje: '0.19' },
        ]),
    };
    descuentosService = {
      findAll: jest.fn().mockResolvedValue([
        {
          id: 'desc-1',
          nombre: 'Desc 10%',
          modo: 'porcentaje',
          valor: '0.10',
          tipoRegla: { codigo: 'general' },
          tramos: [],
          metodoPagoIds: [],
        },
        {
          id: 'desc-2',
          nombre: 'Otro 20%',
          modo: 'porcentaje',
          valor: '0.20',
          tipoRegla: { codigo: 'general' },
          tramos: [],
          metodoPagoIds: [],
        },
      ]),
    };
    recargosService = { findAll: jest.fn().mockResolvedValue([]) };
    const tenantsService = {
      getPreferenciasFinancieras: jest.fn().mockResolvedValue(prefs),
    };
    const monedasService = {
      findMonedas: jest.fn().mockResolvedValue([
        {
          monedaId: 'moneda-clp',
          valorDelDia: '1',
          esDefault: true,
        },
        {
          monedaId: 'moneda-usd',
          valorDelDia: '950',
          esDefault: false,
        },
      ]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CalculoPreciosService,
        { provide: ItemsService, useValue: itemsService },
        { provide: ImpuestosService, useValue: impuestosService },
        { provide: DescuentosService, useValue: descuentosService },
        { provide: RecargosService, useValue: recargosService },
        { provide: TenantsService, useValue: tenantsService },
        { provide: MonedasService, useValue: monedasService },
      ],
    }).compile();

    service = moduleRef.get(CalculoPreciosService);
  });

  it('resuelve las reglas asociadas al ítem y calcula la línea', async () => {
    const r = await service.calcular(TENANT, {
      lineas: [{ itemId: 'item-1', cantidad: '1' }],
    });
    expect(itemsService.findOne).toHaveBeenCalledWith(TENANT, 'item-1');
    expect(r.lineas[0].descuentoAplicado).toBe('10.000000'); // 100 * 0.10
    expect(r.lineas[0].impuestoAplicado).toBe('17.100000'); // 90 * 0.19
    expect(r.lineas[0].totalLinea).toBe('107.100000');
  });

  it('los descuentoIds de la línea reemplazan los del ítem', async () => {
    const r = await service.calcular(TENANT, {
      lineas: [{ itemId: 'item-1', cantidad: '1', descuentoIds: ['desc-2'] }],
    });
    expect(r.lineas[0].descuentoAplicado).toBe('20.000000'); // usa desc-2 (0.20)
  });

  it('respeta el override de precioUnitario', async () => {
    const r = await service.calcular(TENANT, {
      lineas: [{ itemId: 'item-1', cantidad: '1', precioUnitario: '200' }],
    });
    expect(r.lineas[0].subtotalNeto).toBe('200.000000');
  });

  it('convierte el precio del ítem a moneda oficial cuando no hay override', async () => {
    itemsService.findOne.mockResolvedValue(
      item({ precioBase: '10', monedaId: 'moneda-usd' }),
    );
    const r = await service.calcular(TENANT, {
      lineas: [{ itemId: 'item-usd', cantidad: '1', descuentoIds: [] }],
    });
    expect(r.lineas[0].subtotalNeto).toBe('9500.000000');
    expect(r.lineas[0].impuestoAplicado).toBe('1805.000000');
    expect(r.lineas[0].totalLinea).toBe('11305.000000');
    expect(r.totales.totalFinal).toBe('11305.000000');
  });

  it('lanza BadRequest si una regla pedida no existe', async () => {
    await expect(
      service.calcular(TENANT, {
        lineas: [
          { itemId: 'item-1', cantidad: '1', descuentoIds: ['no-existe'] },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lanza BadRequest si la cantidad es <= 0', async () => {
    await expect(
      service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '0' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
