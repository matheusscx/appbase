import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { VentasService } from './ventas.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { CajaService } from '../caja/caja.service';
import { InventarioService } from '../inventario/inventario.service';
import { ItemsService } from '../items/items.service';
import { PagosService } from '../pagos/pagos.service';
import { VentaPropinaService } from '../propinas/venta-propina.service';
import { CatalogService } from '../catalog/catalog.service';
import { EstadoVenta, Venta } from './entities/venta.entity';
import { VentaDetalle } from './entities/venta-detalle.entity';
import { TIPO_DOCUMENTO_NC_ID } from './entities/tipo-documento-tributario.entity';

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

const CAJA_VIRTUAL_ID = 'caja-uuid-virtual-001';
const mockCajaVirtual = {
  id: CAJA_VIRTUAL_ID,
  tenantId: TENANT_ID,
  tipo: 'virtual',
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
  unidadMedida: 'kg',
  impuestosIds: [],
  descuentosIds: [],
  recargosIds: [],
  clasificacionTributaria: 'afecto',
};

const UNIDADES_CATALOGO = [
  { codigo: 'g', magnitud: 'masa', factorBase: '1' },
  { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
  { codigo: 'unidad', magnitud: 'conteo', factorBase: '1' },
];

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
  let ventaPropinaServiceMock: { crearEnTransaccion: jest.Mock };
  let catalogService: jest.Mocked<CatalogService>;
  let dataSourceMock: { transaction: jest.Mock; query: jest.Mock };

  beforeEach(async () => {
    const manager = buildManagerMock();
    pagosServiceMock = { registrar: jest.fn().mockResolvedValue({ pagos: [], montoAplicadoVenta: '0.0000' }) };
    ventaPropinaServiceMock = {
      crearEnTransaccion: jest.fn().mockResolvedValue({
        id: 'venta-propina-1',
      }),
    };
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
            findVirtual: jest.fn().mockResolvedValue(mockCajaVirtual),
            calcularSaldoEsperado: jest.fn().mockResolvedValue('50000.0000'),
            bloquearCajaAbierta: jest.fn().mockResolvedValue(undefined),
            registrarMovimientoEnTransaccion: jest
              .fn()
              .mockResolvedValue({ id: 'mov-caja-nc-1' }),
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
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockItem),
            resolverPersonalizacionReceta: jest.fn(),
            resolverPersonalizacionCombo: jest.fn(),
            venderIngredientesReceta: jest.fn().mockResolvedValue([]),
            venderComponentesCombo: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: PagosService,
          useValue: pagosServiceMock,
        },
        {
          provide: VentaPropinaService,
          useValue: ventaPropinaServiceMock,
        },
        {
          provide: CatalogService,
          useValue: {
            findAllUnidadesMedida: jest
              .fn()
              .mockResolvedValue(UNIDADES_CATALOGO),
          },
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
    catalogService = module.get(CatalogService);
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
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-001', monto: '100.0000', vuelto: '0.0000' }],
        montoAplicadoVenta: '100.0000',
      });
      const result = await service.crear(TENANT_ID, USUARIO_ID, baseDto);
      expect(result).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(calculoPreciosService.calcular).toHaveBeenCalled();
      expect(dataSourceMock.transaction).toHaveBeenCalled();
      expect(result.estado).toBe(EstadoVenta.PAGADA);
    });

    it('congela bases de venta al crear', async () => {
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        totales: {
          subtotalNeto: '10000.0000',
          totalDescuentos: '0.0000',
          totalRecargos: '0.0000',
          totalImpuestos: '1900.0000',
          totalFinal: '11900.0000',
        },
      });
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      const ventaCreate = manager.create.mock.calls.find(
        (call) => call[0] === Venta,
      );
      expect(ventaCreate?.[1]).toEqual(
        expect.objectContaining({
          totalFinal: '11900.0000',
          baseVentasTotalFinal: '11900.0000',
          baseVentasSinImpuestos: '10000.0000',
        }),
      );
    });

    it('congela la clasificación tributaria del item en el detalle', async () => {
      itemsService.findOne.mockResolvedValueOnce({
        ...mockItem,
        clasificacionTributaria: 'exento',
      } as any);
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      await service.crear(TENANT_ID, USUARIO_ID, baseDto);

      const detalleCreate = manager.create.mock.calls.find(
        (call) => call[0] === VentaDetalle,
      );
      expect(detalleCreate?.[1]).toEqual(
        expect.objectContaining({ clasificacionTributaria: 'exento' }),
      );
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

    it('persiste presentación y usa canónica para precio/stock', async () => {
      const manager = buildManagerMock();
      dataSourceMock.transaction.mockImplementationOnce(
        (cb: (m: typeof manager) => unknown) => cb(manager),
      );

      calculoPreciosService.calcular.mockImplementationOnce(
        async (_tenantId, calcDto) => ({
          ...mockResultadoVenta,
          lineas: [
            {
              ...mockResultadoVenta.lineas[0],
              cantidad: calcDto.lineas[0].cantidad,
            },
          ],
        }),
      );

      const dtoPresentacion = {
        lineas: [
          {
            itemId: ITEM_ID,
            cantidad: '999',
            cantidadPresentacion: '500',
            unidadCodigoPresentacion: 'g',
          },
        ],
        pagos: [basePago],
      };

      const result = await service.crear(
        TENANT_ID,
        USUARIO_ID,
        dtoPresentacion as any,
      );

      expect(catalogService.findAllUnidadesMedida).toHaveBeenCalled();
      expect(calculoPreciosService.calcular).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          lineas: [expect.objectContaining({ cantidad: '0.5' })],
        }),
      );
      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ cantidad: '0.5' }),
      );
      expect(result.detalles[0]).toMatchObject({
        cantidad: '0.5',
        cantidadPresentacion: '500',
        unidadCodigoPresentacion: 'g',
      });
    });

    it('no llama registrarMovimiento del inventario para items tipo servicio', async () => {
      itemsService.findOne.mockResolvedValueOnce({
        ...mockItem,
        tipo: 'servicio',
      } as never);
      await service.crear(TENANT_ID, USUARIO_ID, baseDto);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('rechaza línea con item tipo ingrediente', async () => {
      itemsService.findOne.mockResolvedValueOnce({
        ...mockItem,
        tipo: 'ingrediente',
      } as never);
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, baseDto as any),
      ).rejects.toThrow(
        new BadRequestException(
          'Los ingredientes no se pueden vender directamente',
        ),
      );
    });

    it('llama a pagosService.registrar con los params correctos cuando hay pagos', async () => {
      // pago de 150 cuando total es 100 → PagosService calcula el vuelto internamente
      const dtoConExcedente = {
        ...baseDto,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '150.0000' }],
      };
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-001', monto: '150.0000', vuelto: '50.0000' }],
        montoAplicadoVenta: '100.0000',
      });
      const result = await service.crear(
        TENANT_ID,
        USUARIO_ID,
        dtoConExcedente,
      );
      expect(pagosServiceMock.registrar).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ target: '100.0000' }),
      );
      expect(result.estado).toBe(EstadoVenta.PAGADA);
    });

    it('con propinaCierreMesa eleva target y crea venta_propina', async () => {
      const dtoConPropina = {
        ...baseDto,
        propinaCierreMesa: {
          montoPagado: '10.0000',
          montoSugerido: '10.0000',
          porcentajeSugerido: '0.10',
          garzonId: '550e8400-e29b-41d4-a716-446655440200',
        },
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '110.0000' }],
      };
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-tip', monto: '110.0000', vuelto: '0.0000' }],
        montoAplicadoVenta: '100.0000',
      });

      await service.crear(TENANT_ID, USUARIO_ID, dtoConPropina as any);

      expect(ventaPropinaServiceMock.crearEnTransaccion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          montoPagado: '10.0000',
          garzonId: '550e8400-e29b-41d4-a716-446655440200',
          sesionGarzonId: null,
          turnoId: null,
          tipoGarzon: null,
        }),
      );
      expect(pagosServiceMock.registrar).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          target: '110.0000',
          propinaMonto: '10.0000',
          ventaPropinaId: 'venta-propina-1',
        }),
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

  describe('crear() — recetas', () => {
    const mockReceta = {
      id: 'receta-uuid',
      nombre: 'Hamburguesa',
      tipo: 'receta',
      precioBase: '3500.0000',
      precioIncluyeImpuesto: false,
      monedaId: MONEDA_OFICIAL_ID,
      impuestosIds: [],
      descuentosIds: [],
      recargosIds: [],
    };
    const dtoReceta = {
      lineas: [{ itemId: 'receta-uuid', cantidad: '2' }],
      pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '7000.0000' }],
    };

    it('delega en itemsService.venderIngredientesReceta y no llama registrarMovimiento directo', async () => {
      itemsService.findOne.mockResolvedValueOnce(mockReceta as never);
      await service.crear(TENANT_ID, USUARIO_ID, dtoReceta);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(itemsService.venderIngredientesReceta).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: TENANT_ID,
          recetaItemId: 'receta-uuid',
          recetaNombre: 'Hamburguesa',
          cantidadVendida: '2',
        }),
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('agrega advertenciasReceta a la respuesta cuando hay advertencias', async () => {
      itemsService.findOne.mockResolvedValueOnce(mockReceta as never);
      (
        itemsService.venderIngredientesReceta as jest.Mock
      ).mockResolvedValueOnce([
        'Hamburguesa: no había stock suficiente de Queso, se vendió sin ese insumo',
      ]);

      const result = await service.crear(TENANT_ID, USUARIO_ID, dtoReceta);

      expect(result.advertenciasReceta).toEqual([
        'Hamburguesa: no había stock suficiente de Queso, se vendió sin ese insumo',
      ]);
    });

    it('recalcula precio con extras, persiste personalizacion y pasa snapshot al stock', async () => {
      const QUESO_ID = 'queso-extra-uuid';
      const snapshot = {
        omitidos: [],
        extras: [
          {
            ingredienteItemId: QUESO_ID,
            cantidad: '30',
            unidadCodigo: 'g',
            precioExtra: '500.0000',
          },
        ],
      };
      const dtoPersonalizada = {
        lineas: [
          {
            itemId: 'receta-uuid',
            cantidad: '1',
            precioUnitario: '9999.0000',
            personalizacion: {
              extras: [{ ingredienteItemId: QUESO_ID }],
            },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '4000.0000' }],
      };

      itemsService.findOne.mockResolvedValueOnce(mockReceta as never);
      (
        itemsService.resolverPersonalizacionReceta as jest.Mock
      ).mockResolvedValueOnce({
        snapshot,
        precioExtraTotal: '500.0000',
      });
      calculoPreciosService.calcular.mockResolvedValueOnce({
        ...mockResultadoVenta,
        lineas: [
          {
            ...mockResultadoVenta.lineas[0],
            itemId: 'receta-uuid',
            precioUnitario: '4000.0000',
            subtotalNeto: '4000.0000',
            totalLinea: '4000.0000',
          },
        ],
        totales: {
          ...mockResultadoVenta.totales,
          subtotalNeto: '4000.0000',
          totalFinal: '4000.0000',
        },
      });
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-001', monto: '4000.0000', vuelto: '0.0000' }],
        montoAplicadoVenta: '4000.0000',
      });

      const result = await service.crear(
        TENANT_ID,
        USUARIO_ID,
        dtoPersonalizada,
      );

      expect(itemsService.resolverPersonalizacionReceta).toHaveBeenCalledWith(
        expect.anything(),
        TENANT_ID,
        'receta-uuid',
        dtoPersonalizada.lineas[0].personalizacion,
      );
      expect(calculoPreciosService.calcular).toHaveBeenCalledWith(
        TENANT_ID,
        expect.objectContaining({
          lineas: [
            expect.objectContaining({
              itemId: 'receta-uuid',
              precioUnitario: '4000.0000',
            }),
          ],
        }),
      );
      expect(result.detalles[0].precioUnitarioOrigen).toBe('4000.0000');
      expect(result.detalles[0].personalizacion).toEqual(snapshot);
      expect(itemsService.venderIngredientesReceta).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ snapshot }),
      );
    });
  });

  describe('crear() — grupos de modificadores obligatorios sin personalizacion', () => {
    // Regresión: el gate en crearEnTransaccion antes exigía
    // `linea.personalizacion` truthy para llamar a resolverPersonalizacionReceta
    // /resolverPersonalizacionCombo. Si el cliente omitía por completo el campo
    // `personalizacion`, resolverGruposDeItem nunca se ejecutaba y la validación
    // "min >= 1 => grupo obligatorio" se saltaba silenciosamente. El resolver
    // debe llamarse SIEMPRE (con dto undefined si corresponde) para que la
    // validación de grupos obligatorios se aplique también en ese caso.
    const mockReceta = {
      id: 'receta-uuid',
      nombre: 'Hamburguesa',
      tipo: 'receta',
      precioBase: '3500.0000',
      precioIncluyeImpuesto: false,
      monedaId: MONEDA_OFICIAL_ID,
      impuestosIds: [],
      descuentosIds: [],
      recargosIds: [],
    };
    const mockCombo = {
      id: 'combo-uuid',
      nombre: 'Combo Familiar',
      tipo: 'combo',
      precioBase: '9000.0000',
      precioIncluyeImpuesto: false,
      monedaId: MONEDA_OFICIAL_ID,
      impuestosIds: [],
      descuentosIds: [],
      recargosIds: [],
    };

    it('rechaza la venta de una receta con grupo obligatorio (min:1,max:1) cuando la linea omite personalizacion', async () => {
      const dtoSinPersonalizacion = {
        lineas: [{ itemId: 'receta-uuid', cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3500.0000' }],
      };

      itemsService.findOne.mockResolvedValueOnce(mockReceta as never);
      // Simula el comportamiento real de resolverGruposDeItem: con
      // gruposDto=undefined evalúa cada grupo asociado contra cero unidades
      // elegidas y lanza si algún grupo tiene min >= 1.
      (
        itemsService.resolverPersonalizacionReceta as jest.Mock
      ).mockRejectedValueOnce(
        new BadRequestException(
          'El grupo "Tamaño" requiere elegir entre 1 y 1 unidades',
        ),
      );

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoSinPersonalizacion),
      ).rejects.toThrow(BadRequestException);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(itemsService.resolverPersonalizacionReceta).toHaveBeenCalledWith(
        expect.anything(),
        TENANT_ID,
        'receta-uuid',
        undefined,
      );
    });

    it('rechaza la venta de un combo con grupo obligatorio (min:1,max:1) cuando la linea omite personalizacion', async () => {
      const dtoSinPersonalizacion = {
        lineas: [{ itemId: 'combo-uuid', cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '9000.0000' }],
      };

      itemsService.findOne.mockResolvedValueOnce(mockCombo as never);
      (
        itemsService.resolverPersonalizacionCombo as jest.Mock
      ).mockRejectedValueOnce(
        new BadRequestException(
          'El grupo "Bebida" requiere elegir entre 1 y 1 unidades',
        ),
      );

      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoSinPersonalizacion),
      ).rejects.toThrow(BadRequestException);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(itemsService.resolverPersonalizacionCombo).toHaveBeenCalledWith(
        expect.anything(),
        TENANT_ID,
        'combo-uuid',
        undefined,
      );
    });
  });

  describe('crear() — canal online', () => {
    const dtoOnline = {
      ...baseDto,
      canal: 'online' as const,
    };

    it('usa la caja virtual del tenant en vez de la caja física del usuario', async () => {
      pagosServiceMock.registrar.mockResolvedValueOnce({
        pagos: [{ id: 'pago-uuid-001', monto: '100.0000', vuelto: '0.0000' }],
        montoAplicadoVenta: '100.0000',
      });
      const result = await service.crear(TENANT_ID, USUARIO_ID, dtoOnline);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cajaService.findVirtual).toHaveBeenCalledWith(TENANT_ID);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cajaService.findActiva).not.toHaveBeenCalled();
      expect(result.cajaId).toBe(CAJA_VIRTUAL_ID);
      expect(result.canal).toBe('online');
    });

    it('lanza BadRequestException si el tenant no tiene caja virtual', async () => {
      cajaService.findVirtual.mockResolvedValueOnce(null);
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoOnline),
      ).rejects.toThrow(
        new BadRequestException(
          'El tenant no tiene una caja virtual configurada',
        ),
      );
    });

    it('lanza BadRequestException si el pago no cubre el total', async () => {
      const dtoIncompleto = {
        ...dtoOnline,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
      };
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoIncompleto as any),
      ).rejects.toThrow(
        new BadRequestException('Las ventas online requieren el pago completo'),
      );
    });

    it('lanza BadRequestException si no hay pagos', async () => {
      const dtoSinPago = { ...dtoOnline, pagos: undefined };
      await expect(
        service.crear(TENANT_ID, USUARIO_ID, dtoSinPago as any),
      ).rejects.toThrow(
        new BadRequestException('Las ventas online requieren el pago completo'),
      );
    });
  });

  describe('crearNotaCredito() / registrarDevolucionesPorReembolso()', () => {
    const VENTA_ORIG_ID = 'venta-orig-uuid-001';
    const ITEM_SERIE_ID = 'item-serie-uuid-001';
    const SERVICIO_ID = 'item-servicio-uuid-001';

    const ventaOriginalRow = {
      venta_id: VENTA_ORIG_ID,
      caja_id: CAJA_VIRTUAL_ID,
      moneda_id: MONEDA_OFICIAL_ID,
      canal: 'online',
      total_final: '11305.0000',
      estado: 'pagada',
      tipo_documento_id: 'tipo-doc-boleta-uuid',
    };
    const detallesRows = [
      {
        item_id: ITEM_ID,
        cantidad: '3',
        precio_unitario: '100.0000',
        precio_unitario_origen: '100.0000',
        tasa_cambio: '1.000000',
        moneda_id_origen: MONEDA_OFICIAL_ID,
        descripcion: 'Smartphone',
        clasificacion_tributaria: 'exento',
        modo_inventario: 'cantidad',
      },
      {
        item_id: ITEM_SERIE_ID,
        cantidad: '1',
        precio_unitario: '500.0000',
        precio_unitario_origen: '500.0000',
        tasa_cambio: '1.000000',
        moneda_id_origen: MONEDA_OFICIAL_ID,
        descripcion: 'Notebook serializado',
        modo_inventario: 'serie',
      },
      {
        item_id: SERVICIO_ID,
        cantidad: '1',
        precio_unitario: '50.0000',
        precio_unitario_origen: '50.0000',
        tasa_cambio: '1.000000',
        moneda_id_origen: MONEDA_OFICIAL_ID,
        descripcion: 'Instalación',
        modo_inventario: null,
      },
    ];

    let ncManager: ReturnType<typeof buildManagerMock>;
    // Resultados configurables por test para las queries dentro de la tx
    let ventaRows: unknown[];
    let ncPreviasTotal: string;
    let devueltosRows: { item_id: string; devuelto: string }[];

    beforeEach(() => {
      ncManager = buildManagerMock();
      ventaRows = [ventaOriginalRow];
      ncPreviasTotal = '0';
      devueltosRows = [];
      ncManager.query.mockImplementation((sql: string) => {
        if (sql.includes('FOR UPDATE')) return Promise.resolve(ventaRows);
        if (sql.includes('SUM(total_final)'))
          return Promise.resolve([{ total: ncPreviasTotal }]);
        if (sql.includes('FROM venta_detalles'))
          return Promise.resolve(detallesRows);
        if (sql.includes('FROM movimientos_inventario'))
          return Promise.resolve(devueltosRows);
        return Promise.resolve([]);
      });
      dataSourceMock.transaction.mockImplementation(
        (cb: (m: typeof ncManager) => unknown) => cb(ncManager),
      );
    });

    const baseParams = {
      tenantId: TENANT_ID,
      usuarioId: USUARIO_ID,
      ventaOriginalId: VENTA_ORIG_ID,
      monto: '1100.0000',
      comentario: 'NC por reembolso orden O-1',
    };

    it('NC sin líneas: totales copiados del monto, estado pagada, referencia y caja/canal/moneda de la original; sin detalles ni movimientos', async () => {
      const res = await service.crearNotaCredito(baseParams);
      expect(res.id).toBeDefined();
      expect(res.totalFinal).toBe('1100.0000');
      expect(ncManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tenantId: TENANT_ID,
          tipoDocumentoId: TIPO_DOCUMENTO_NC_ID,
          ventaReferenciaId: VENTA_ORIG_ID,
          estado: EstadoVenta.PAGADA,
          cajaId: CAJA_VIRTUAL_ID,
          monedaId: MONEDA_OFICIAL_ID,
          canal: 'online',
          totalBruto: '1100.0000',
          totalFinal: '1100.0000',
          totalDescuentos: '0',
          totalRecargos: '0',
          totalImpuestos: '0',
          comentario: 'NC por reembolso orden O-1',
        }),
      );
      // una sola persistencia: la cabecera (sin líneas)
      expect(ncManager.save).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('NC con devoluciones: crea la línea copiada y registra entrada/devolucion ligada a la NC', async () => {
      const res = await service.crearNotaCredito({
        ...baseParams,
        devoluciones: [{ itemId: ITEM_ID, cantidad: '2' }],
      });
      expect(ncManager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          itemId: ITEM_ID,
          cantidad: '2',
          precioUnitario: '100.0000',
          monedaIdOrigen: MONEDA_OFICIAL_ID,
          totalLinea: '200.0000',
          clasificacionTributaria: 'exento',
        }),
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        ncManager,
        expect.objectContaining({
          tenantId: TENANT_ID,
          itemId: ITEM_ID,
          tipo: 'entrada',
          motivo: 'devolucion',
          cantidad: '2',
          usuarioId: USUARIO_ID,
          ventaId: res.id,
        }),
      );
    });

    it('rechaza cuando Σ(NCs previas) + monto excede el total de la venta', async () => {
      ncPreviasTotal = '10500.0000';
      await expect(service.crearNotaCredito(baseParams)).rejects.toThrow(
        BadRequestException,
      );
      expect(ncManager.save).not.toHaveBeenCalled();
    });

    it('rechaza monto <= 0 sin abrir transacción', async () => {
      await expect(
        service.crearNotaCredito({ ...baseParams, monto: '0' }),
      ).rejects.toThrow(BadRequestException);
      expect(dataSourceMock.transaction).not.toHaveBeenCalled();
    });

    it('rechaza cantidad devuelta mayor a vendida menos ya devuelta', async () => {
      devueltosRows = [{ item_id: ITEM_ID, devuelto: '2' }];
      await expect(
        service.crearNotaCredito({
          ...baseParams,
          devoluciones: [{ itemId: ITEM_ID, cantidad: '2' }],
        }),
      ).rejects.toThrow(BadRequestException);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('rechaza un ítem que no pertenece a la venta', async () => {
      await expect(
        service.crearNotaCredito({
          ...baseParams,
          devoluciones: [{ itemId: 'item-ajeno', cantidad: '1' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza ítems modo serie/lote antes de tocar inventario', async () => {
      await expect(
        service.crearNotaCredito({
          ...baseParams,
          devoluciones: [{ itemId: ITEM_SERIE_ID, cantidad: '1' }],
        }),
      ).rejects.toThrow(BadRequestException);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(inventarioService.registrarMovimiento).not.toHaveBeenCalled();
    });

    it('rechaza ítems sin stock (servicios) con mensaje propio', async () => {
      await expect(
        service.crearNotaCredito({
          ...baseParams,
          devoluciones: [{ itemId: SERVICIO_ID, cantidad: '1' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFoundException si la venta no existe o es de otro tenant', async () => {
      ventaRows = [];
      await expect(service.crearNotaCredito(baseParams)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('no modifica la venta original (ni save ni UPDATE sobre ella)', async () => {
      await service.crearNotaCredito(baseParams);
      const saves = ncManager.save.mock.calls.map(
        (c: unknown[]) => c[1] as Record<string, unknown>,
      );
      expect(saves.some((d) => d['id'] === VENTA_ORIG_ID)).toBe(false);
      const updates = ncManager.query.mock.calls.filter((c: unknown[]) =>
        String(c[0]).trim().toUpperCase().startsWith('UPDATE VENTAS'),
      );
      expect(updates).toHaveLength(0);
    });

    it('findOne expone referencia, tipo documento, modo/devuelto por detalle, reembolsos y NCs hijas', async () => {
      dataSourceMock.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM movimientos_inventario'))
          return Promise.resolve([{ item_id: ITEM_ID, devuelto: '1' }]);
        if (sql.includes('pasarela_transacciones'))
          return Promise.resolve([
            {
              transaccion_id: 'tx-refund-1',
              monto: '1100.0000',
              estado: 'aprobada',
              fecha_transaccion: new Date('2026-07-10'),
              orden_id: 'orden-1',
              codigo_orden: 'O-1',
            },
          ]);
        if (sql.includes('FROM venta_detalles'))
          return Promise.resolve([
            {
              detalle_id: 'det-1',
              item_id: ITEM_ID,
              descripcion: 'Smartphone',
              cantidad: '3',
              precio_unitario: '100.0000',
              precio_unitario_origen: '100.0000',
              tasa_cambio: '1.000000',
              moneda_id_origen: MONEDA_OFICIAL_ID,
              subtotal: '300.0000',
              descuento_aplicado: '0',
              recargo_aplicado: '0',
              impuesto_aplicado: '0',
              total_linea: '300.0000',
              modo_inventario: 'cantidad',
            },
          ]);
        if (sql.includes('WHERE venta_referencia_id'))
          return Promise.resolve([
            {
              venta_id: 'nc-1',
              total_final: '1100.0000',
              fecha: new Date('2026-07-10'),
              comentario: 'NC por reembolso orden O-1',
            },
          ]);
        if (sql.includes('FROM venta_propina'))
          return Promise.resolve([
            {
              venta_propina_id: 'vp-1',
              porcentaje_sugerido: '0.100000',
              monto_sugerido: '1131.0000',
              monto_pagado: '1000.0000',
              tipo: 'manual',
              estado: 'pagada',
              garzon_id: 'garzon-1',
              garzon_nombre: 'Ana',
            },
          ]);
        if (sql.includes('FROM pagos '))
          return Promise.resolve([
            {
              pago_id: 'pago-1',
              metodo_pago_id: EFECTIVO_ID,
              moneda_oficial_id: MONEDA_OFICIAL_ID,
              caja_id: CAJA_VIRTUAL_ID,
              monto: '12305.0000',
              vuelto: '0.0000',
              fecha: new Date('2026-07-10'),
              referencia: null,
            },
          ]);
        if (sql.includes('FROM pago_aplicaciones'))
          return Promise.resolve([
            {
              pago_aplicacion_id: 'pa-1',
              pago_id: 'pago-1',
              tipo: 'venta',
              referencia_id: VENTA_ORIG_ID,
              monto: '11305.0000',
            },
            {
              pago_aplicacion_id: 'pa-2',
              pago_id: 'pago-1',
              tipo: 'propina',
              referencia_id: 'vp-1',
              monto: '1000.0000',
            },
          ]);
        if (sql.includes('FROM ventas'))
          return Promise.resolve([
            {
              venta_id: VENTA_ORIG_ID,
              caja_id: CAJA_VIRTUAL_ID,
              moneda_id: MONEDA_OFICIAL_ID,
              tipo_documento_id: 'doc-boleta',
              canal: 'online',
              estado: 'pagada',
              total_bruto: '11305.0000',
              total_descuentos: '0',
              total_recargos: '0',
              total_impuestos: '0',
              total_final: '11305.0000',
              comentario: null,
              fecha: new Date('2026-07-10'),
              creado_el: new Date('2026-07-10'),
              venta_referencia_id: null,
              tipo_documento_codigo: '39',
              tipo_documento_nombre: 'Boleta de Venta',
            },
          ]);
        return Promise.resolve([]);
      });

      const res = await service.findOne(TENANT_ID, VENTA_ORIG_ID);
      expect(res.ventaReferenciaId).toBeNull();
      expect(res.tipoDocumento).toEqual({
        id: 'doc-boleta',
        codigo: '39',
        nombre: 'Boleta de Venta',
      });
      expect(res.detalles[0]).toEqual(
        expect.objectContaining({
          itemId: ITEM_ID,
          modoInventario: 'cantidad',
          cantidadDevuelta: '1',
        }),
      );
      expect(res.reembolsos).toEqual([
        expect.objectContaining({
          id: 'tx-refund-1',
          monto: '1100.0000',
          estado: 'aprobada',
          ordenId: 'orden-1',
          codigoOrden: 'O-1',
        }),
      ]);
      expect(res.notasCredito).toEqual([
        expect.objectContaining({
          id: 'nc-1',
          totalFinal: '1100.0000',
          comentario: 'NC por reembolso orden O-1',
        }),
      ]);
      expect(res.propina).toEqual({
        id: 'vp-1',
        porcentajeSugerido: '0.100000',
        montoSugerido: '1131.0000',
        montoPagado: '1000.0000',
        tipo: 'manual',
        estado: 'pagada',
        garzonId: 'garzon-1',
        garzonNombre: 'Ana',
      });
      expect(res.pagos[0]).toEqual(
        expect.objectContaining({
          id: 'pago-1',
          montoAplicadoVenta: '11305.0000',
          montoAplicadoPropina: '1000.0000',
          aplicaciones: [
            {
              tipo: 'venta',
              monto: '11305.0000',
              referenciaId: VENTA_ORIG_ID,
            },
            {
              tipo: 'propina',
              monto: '1000.0000',
              referenciaId: 'vp-1',
            },
          ],
        }),
      );
    });

    it('listar mapea totalReembolsado y esNotaCredito', async () => {
      dataSourceMock.query.mockImplementation((sql: string) => {
        if (sql.includes('COUNT(*)')) return Promise.resolve([{ total: 2 }]);
        return Promise.resolve([
          {
            venta_id: 'v-1',
            canal: 'online',
            estado: 'pagada',
            total_final: '11305.0000',
            fecha: new Date('2026-07-10'),
            creado_el: new Date('2026-07-10'),
            monto_pagado: '11305.0000',
            total_reembolsado: '1100.0000',
            tipo_documento_id: 'doc-boleta',
          },
          {
            venta_id: 'nc-1',
            canal: 'online',
            estado: 'pagada',
            total_final: '1100.0000',
            fecha: new Date('2026-07-10'),
            creado_el: new Date('2026-07-10'),
            monto_pagado: '0',
            total_reembolsado: '0',
            tipo_documento_id: TIPO_DOCUMENTO_NC_ID,
          },
        ]);
      });

      const res = await service.listar(TENANT_ID, {});
      const listSql = dataSourceMock.query.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          (c[0] as string).includes('FROM ventas v') &&
          (c[0] as string).includes('LIMIT'),
      )?.[0] as string;
      expect(listSql).toContain("pa.tipo = 'venta'");
      expect(listSql).toContain('pago_aplicaciones');
      expect(res.data[0]).toEqual(
        expect.objectContaining({
          totalReembolsado: '1100.0000',
          esNotaCredito: false,
        }),
      );
      expect(res.data[1]).toEqual(
        expect.objectContaining({
          totalReembolsado: '0.0000',
          esNotaCredito: true,
        }),
      );
    });

    it('resumen excluye las notas de crédito de los KPIs', async () => {
      dataSourceMock.query.mockResolvedValueOnce([
        { total_ventas: 5, total_facturado: '100', saldo_pendiente: '0' },
      ]);
      await service.resumen(TENANT_ID);
      const [sql, params] = dataSourceMock.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('IS DISTINCT FROM');
      expect(sql).toContain("pa.tipo = 'venta'");
      expect(sql).toContain('pago_aplicaciones');
      expect(params).toContain(TIPO_DOCUMENTO_NC_ID);
    });

    it('registrarDevolucionesPorReembolso liga los movimientos a la venta original y no crea cabecera', async () => {
      await service.registrarDevolucionesPorReembolso({
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        ventaOriginalId: VENTA_ORIG_ID,
        devoluciones: [{ itemId: ITEM_ID, cantidad: '1' }],
        comentario: 'Devolución por reembolso orden O-1',
      });
      expect(ncManager.save).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(inventarioService.registrarMovimiento).toHaveBeenCalledWith(
        ncManager,
        expect.objectContaining({
          tipo: 'entrada',
          motivo: 'devolucion',
          itemId: ITEM_ID,
          cantidad: '1',
          ventaId: VENTA_ORIG_ID,
        }),
      );
    });

    describe('crearNotaCreditoDesdeVenta()', () => {
      it('feliz sin dinero: delega en crearNotaCredito y devuelve movimientoCajaId null', async () => {
        const res = await service.crearNotaCreditoDesdeVenta(baseParams);
        expect(res.totalFinal).toBe('1100.0000');
        expect(res.movimientoCajaId).toBeNull();
        // prettier-ignore
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cajaService.registrarMovimientoEnTransaccion).not.toHaveBeenCalled();
      });

      it.each(['pendiente', 'borrador', 'cancelada'])(
        'rechaza ventas en estado %s',
        async (estado) => {
          ventaRows = [{ ...ventaOriginalRow, estado }];
          await expect(
            service.crearNotaCreditoDesdeVenta(baseParams),
          ).rejects.toThrow(
            'Solo se puede emitir nota de crédito de ventas pagadas o pagadas parcialmente',
          );
        },
      );

      it('rechaza NC sobre otra NC', async () => {
        ventaRows = [
          { ...ventaOriginalRow, tipo_documento_id: TIPO_DOCUMENTO_NC_ID },
        ];
        await expect(
          service.crearNotaCreditoDesdeVenta(baseParams),
        ).rejects.toThrow(
          'No se puede emitir una nota de crédito sobre otra nota de crédito',
        );
      });

      it('devolverDinero: registra salida en la caja activa ligada a la NC', async () => {
        const res = await service.crearNotaCreditoDesdeVenta({
          ...baseParams,
          devolverDinero: true,
        });
        expect(res.movimientoCajaId).toBe('mov-caja-nc-1');
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cajaService.findActiva).toHaveBeenCalledWith(
          TENANT_ID,
          USUARIO_ID,
        );
        // prettier-ignore
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cajaService.registrarMovimientoEnTransaccion).toHaveBeenCalledWith(
          ncManager,
          expect.objectContaining({
            cajaId: CAJA_ID,
            tipo: 'salida',
            concepto: 'Devolución · Nota de crédito',
            monto: '1100.0000',
            ventaId: res.id,
          }),
        );
      });

      it('devolverDinero sin caja física abierta → 422', async () => {
        cajaService.findActiva.mockResolvedValueOnce(null);
        await expect(
          service.crearNotaCreditoDesdeVenta({
            ...baseParams,
            devolverDinero: true,
          }),
        ).rejects.toThrow(UnprocessableEntityException);
      });

      it('devolverDinero con saldo insuficiente → 422 y no registra movimiento', async () => {
        cajaService.calcularSaldoEsperado.mockResolvedValueOnce('1000.0000');
        await expect(
          service.crearNotaCreditoDesdeVenta({
            ...baseParams,
            devolverDinero: true,
          }),
        ).rejects.toThrow('Saldo insuficiente en caja');
        // prettier-ignore
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cajaService.registrarMovimientoEnTransaccion).not.toHaveBeenCalled();
      });

      it('regresión: crearNotaCredito directo (flujo pasarela) no valida estado ni toca caja', async () => {
        ventaRows = [{ ...ventaOriginalRow, estado: 'pendiente' }];
        const res = await service.crearNotaCredito(baseParams);
        expect(res.movimientoCajaId).toBeNull();
        // prettier-ignore
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(cajaService.registrarMovimientoEnTransaccion).not.toHaveBeenCalled();
      });
    });
  });
});
