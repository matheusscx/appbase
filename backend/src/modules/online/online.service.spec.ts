import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OnlineService } from './online.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { MetodosPagoService } from '../metodos-pago/metodos-pago.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';
import { PagosRedirectService } from '../pasarela/services/pagos-redirect.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116';

const mockResultado = {
  lineas: [
    {
      itemId: ITEM_ID,
      cantidad: '2',
      precioUnitario: '50.0000',
      subtotalNeto: '100.0000',
      descuentoAplicado: '0',
      recargoAplicado: '0',
      impuestoAplicado: '0',
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

describe('OnlineService', () => {
  let service: OnlineService;
  const calculo = { calcular: jest.fn().mockResolvedValue(mockResultado) };
  const metodos = { findMetodosPago: jest.fn() };
  const tenantPasarela = { resolverConfiguracionActiva: jest.fn() };
  const pagosRedirect = { iniciar: jest.fn(), obtenerResultado: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('http://localhost:5173') };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnlineService,
        { provide: CalculoPreciosService, useValue: calculo },
        { provide: MetodosPagoService, useValue: metodos },
        { provide: TenantPasarelaService, useValue: tenantPasarela },
        { provide: PagosRedirectService, useValue: pagosRedirect },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = module.get(OnlineService);
  });

  const dto = { lineas: [{ itemId: ITEM_ID, cantidad: '2' }] };

  it('checkout: calcula sin persistir y devuelve URL dummy', async () => {
    const result = await service.checkout(TENANT_ID, dto);
    expect(calculo.calcular).toHaveBeenCalledWith(TENANT_ID, dto);
    expect(result.checkoutUrl).toBe(
      `/tienda/pasarela?ref=${result.checkoutRef}`,
    );
  });

  it('pagar sin Webpay activo: cae a modo simulado', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockRejectedValue(
      new Error('no config'),
    );
    const res = await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto);
    expect(res.modo).toBe('simulado');
    expect(pagosRedirect.iniciar).not.toHaveBeenCalled();
  });

  it('pagar con Webpay activo: inicia orden interno con snapshot y devuelve webpay', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.findMetodosPago.mockResolvedValue([
      { metodoPagoId: 'mp-efectivo', nombre: 'Efectivo', habilitada: true },
      {
        metodoPagoId: 'mp-credito',
        nombre: 'Tarjeta de Crédito',
        habilitada: true,
      },
      {
        metodoPagoId: 'mp-debito',
        nombre: 'Tarjeta de Débito',
        habilitada: true,
      },
    ]);
    pagosRedirect.iniciar.mockResolvedValue({
      ordenId: 'orden-1',
      urlWebpay: 'https://webpay/redirect',
    });

    const res = await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto);

    expect(res).toEqual({
      modo: 'webpay',
      urlWebpay: 'https://webpay/redirect',
      ordenId: 'orden-1',
    });
    const [tid, pagoDto, opts] = pagosRedirect.iniciar.mock.calls[0] as [
      string,
      { monto: string; urlExito: string },
      {
        origen: string;
        metadataExtra: {
          origenApp: string;
          checkout: {
            metodoCreditoId: string;
            metodoDebitoId: string | null;
            totalFinal: string;
            usuarioId: string;
            lineas: { itemId: string; cantidad: string }[];
          };
        };
      },
    ];
    expect(tid).toBe(TENANT_ID);
    expect(pagoDto.monto).toBe('100.0000');
    expect(pagoDto.urlExito).toBe('http://localhost:5173/tienda/retorno');
    expect(opts.origen).toBe('interno');
    // snapshot con ambos métodos resueltos server-side (el callback elige por tipoPago)
    expect(opts.metadataExtra.origenApp).toBe('tienda-online');
    expect(opts.metadataExtra.checkout.metodoCreditoId).toBe('mp-credito');
    expect(opts.metadataExtra.checkout.metodoDebitoId).toBe('mp-debito');
    expect(opts.metadataExtra.checkout.totalFinal).toBe('100.0000');
    expect(opts.metadataExtra.checkout.usuarioId).toBe('u-1');
    expect(opts.metadataExtra.checkout.lineas).toEqual([
      { itemId: ITEM_ID, cantidad: '2' },
    ]);
  });

  it('pagar con Webpay pero sin métodos habilitados: rechaza', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.findMetodosPago.mockResolvedValue([
      { metodoPagoId: 'mp-x', nombre: 'Efectivo', habilitada: false },
    ]);
    await expect(
      service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto),
    ).rejects.toThrow('métodos de pago');
  });

  it('resultadoOrden: mapea a { estado, ventaId, detalle del pago }', async () => {
    pagosRedirect.obtenerResultado.mockResolvedValue({
      ordenId: 'orden-1',
      estado: 'conciliada',
      referenciaExterna: 'venta-9',
      tipoPago: 'VD',
      numeroCuotas: 0,
      tarjetaUltimos4: '6623',
      motivoRechazo: null,
    });
    const res = await service.resultadoOrden(TENANT_ID, 'orden-1');
    expect(res).toEqual({
      estado: 'conciliada',
      ventaId: 'venta-9',
      tipoPago: 'VD',
      numeroCuotas: 0,
      tarjetaUltimos4: '6623',
      motivoRechazo: null,
    });
  });
});
