import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  let itemsService: {
    cargarBasePorIds: jest.Mock;
    cargarReglasPorIds: jest.Mock;
  };
  let impuestosService: { findAll: jest.Mock };
  let descuentosService: { findAll: jest.Mock };
  let recargosService: { findAll: jest.Mock };

  const base = (over: Record<string, unknown> = {}) => ({
    id: 'item-1',
    precioBase: '100',
    monedaId: 'moneda-clp',
    precioIncluyeImpuesto: false,
    clasificacionTributaria: 'afecto',
    ...over,
  });

  const reglas = (over: Record<string, unknown> = {}) => ({
    impuestosIds: ['imp-1'],
    descuentosIds: ['desc-1'],
    recargosIds: [],
    ...over,
  });

  /** Configura los dos loaders batch para todos los ids que se les pidan. */
  const mockItems = (
    baseOver: Record<string, unknown> = {},
    reglasOver: Record<string, unknown> = {},
  ) => {
    itemsService.cargarBasePorIds.mockImplementation(
      (_t: string, ids: string[]) =>
        Promise.resolve(
          new Map(ids.map((id) => [id, base({ id, ...baseOver })])),
        ),
    );
    itemsService.cargarReglasPorIds.mockImplementation(
      (_t: string, ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, reglas(reglasOver)]))),
    );
  };

  beforeEach(async () => {
    itemsService = {
      cargarBasePorIds: jest.fn(),
      cargarReglasPorIds: jest.fn(),
    };
    mockItems();
    impuestosService = {
      findAll: jest.fn().mockResolvedValue([
        { id: 'imp-1', nombre: 'IVA', porcentaje: '0.19', tipo: 'iva' },
        { id: 'imp-2', nombre: 'Adicional', porcentaje: '0.10', tipo: 'otro' },
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
    expect(itemsService.cargarBasePorIds).toHaveBeenCalledWith(TENANT, [
      'item-1',
    ]);
    expect(itemsService.cargarReglasPorIds).toHaveBeenCalledWith(TENANT, [
      'item-1',
    ]);
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
    mockItems({ precioBase: '10', monedaId: 'moneda-usd' });
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

  it('la cantidad se valida ANTES de cargar: el 400 le gana al 404', async () => {
    // Al batchear la carga, el 404 por ítem inexistente pasaría a evaluarse
    // primero si la validación viviera dentro de `resolverLinea`.
    itemsService.cargarBasePorIds.mockRejectedValue(
      new NotFoundException('Item no encontrado'),
    );

    await expect(
      service.calcular(TENANT, {
        lineas: [{ itemId: 'no-existe', cantidad: '0' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(itemsService.cargarBasePorIds).not.toHaveBeenCalled();
  });

  it('línea exenta: omite impuestos tipo iva y conserva los otros', async () => {
    mockItems(
      { clasificacionTributaria: 'exento' },
      { impuestosIds: ['imp-1', 'imp-2'], descuentosIds: [] },
    );
    const r = await service.calcular(TENANT, {
      lineas: [{ itemId: 'item-1', cantidad: '1' }],
    });
    expect(r.lineas[0].impuestoAplicado).toBe('10.000000'); // solo imp-2 (0.10 * 100)
    expect(r.lineas[0].totalLinea).toBe('110.000000');
  });

  it('línea afecta: aplica todos los impuestos asociados', async () => {
    mockItems({}, { impuestosIds: ['imp-1', 'imp-2'], descuentosIds: [] });
    const r = await service.calcular(TENANT, {
      lineas: [{ itemId: 'item-1', cantidad: '1' }],
    });
    expect(r.lineas[0].impuestoAplicado).toBe('29.000000'); // 19 + 10
  });

  it('resuelve N líneas con un número CONSTANTE de cargas, no una por línea', async () => {
    const r = await service.calcular(TENANT, {
      lineas: [
        { itemId: 'item-a', cantidad: '1' },
        { itemId: 'item-b', cantidad: '1' },
        { itemId: 'item-c', cantidad: '1' },
      ],
    });

    // Una carga para TODO el carrito, con los tres ids juntos. Si alguien
    // vuelve a resolver ítem por ítem, estos contadores pasan a 3.
    expect(itemsService.cargarBasePorIds).toHaveBeenCalledTimes(1);
    expect(itemsService.cargarReglasPorIds).toHaveBeenCalledTimes(1);
    expect(itemsService.cargarBasePorIds).toHaveBeenCalledWith(TENANT, [
      'item-a',
      'item-b',
      'item-c',
    ]);
    expect(r.lineas).toHaveLength(3);
    expect(r.totales.totalFinal).toBe('321.300000'); // 3 × 107.10
  });

  it('resuelve los recargos asociados al ítem por id', async () => {
    // El fixture fijaba `recargosIds: []` en todos los tests, así que la
    // resolución de recargos por id no la ejercía nadie: un mutante que le
    // pasara el mapa de descuentos sobrevivía (auditoría 2026-07-28).
    recargosService.findAll.mockResolvedValue([
      {
        id: 'rec-1',
        nombre: 'Recargo 5%',
        modo: 'porcentaje',
        valor: '0.05',
        tipoRegla: { codigo: 'general' },
        tramos: [],
        metodoPagoIds: [],
      },
    ]);
    mockItems(
      {},
      { impuestosIds: [], descuentosIds: [], recargosIds: ['rec-1'] },
    );

    const r = await service.calcular(TENANT, {
      lineas: [{ itemId: 'item-1', cantidad: '1' }],
    });

    expect(r.lineas[0].recargoAplicado).toBe('5.000000'); // 100 * 0.05
    expect(r.lineas[0].trazas.recargos[0]).toEqual(
      expect.objectContaining({ id: 'rec-1', nombre: 'Recargo 5%' }),
    );
    expect(r.lineas[0].totalLinea).toBe('105.000000');
  });
});
