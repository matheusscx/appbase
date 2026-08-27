import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OnlineService } from './online.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { MetodosPagoService } from '../metodos-pago/metodos-pago.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';
import { PagosRedirectService } from '../pasarela/services/pagos-redirect.service';
import { ItemsService } from '../items/items.service';
import { CatalogService } from '../catalog/catalog.service';

const UNIDADES = [
  { codigo: 'g', magnitud: 'masa', factorBase: '1' },
  { codigo: 'kg', magnitud: 'masa', factorBase: '1000' },
];

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
  const metodos = {
    findMetodosPago: jest.fn(),
    resolverMetodoCredito: jest.fn(),
  };
  const tenantPasarela = {
    resolverConfiguracionActiva: jest.fn(),
    codigoActivo: jest.fn(),
  };
  const pagosRedirect = { iniciar: jest.fn(), obtenerResultado: jest.fn() };
  const config = { get: jest.fn().mockReturnValue('http://localhost:5173') };
  /** Fila base como la devuelve `cargarBasePorIds` (BASE_QUERY trae `activo`). */
  const itemBase = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    nombre: 'Producto demo',
    tipo: 'producto',
    unidadMedida: 'kg',
    activo: true,
    ...over,
  });
  const items = {
    cargarBasePorIds: jest
      .fn()
      .mockImplementation((_t: string, ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, itemBase(id)]))),
      ),
  };
  const catalog = {
    findAllUnidadesMedida: jest.fn().mockResolvedValue(UNIDADES),
  };

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
        { provide: ItemsService, useValue: items },
        { provide: CatalogService, useValue: catalog },
      ],
    }).compile();
    service = module.get(OnlineService);
  });

  const dto = { lineas: [{ itemId: ITEM_ID, cantidad: '2' }] };

  it('checkout: calcula sin persistir y devuelve URL dummy', async () => {
    const result = await service.checkout(TENANT_ID, dto);
    expect(calculo.calcular).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        lineas: [expect.objectContaining({ itemId: ITEM_ID, cantidad: '2' })],
      }),
    );
    expect(result.checkoutUrl).toBe(
      `/tienda/pasarela?ref=${result.checkoutRef}`,
    );
  });

  /**
   * Online se bloquea porque el cliente todavía no recibió nada; el POS solo
   * advierte. El mensaje nombra el producto: con ocho líneas en el carrito, un
   * "no disponible" genérico deja al cliente adivinando cuál sacar.
   */
  describe('ítem pausado', () => {
    const pausarSegundaLinea = () =>
      items.cargarBasePorIds.mockImplementationOnce(
        (_t: string, ids: string[]) =>
          Promise.resolve(
            new Map(
              ids.map((id, i) => [
                id,
                itemBase(id, i === 1 ? { nombre: 'Torta', activo: false } : {}),
              ]),
            ),
          ),
      );

    const dosLineas = {
      lineas: [
        { itemId: ITEM_ID, cantidad: '1' },
        { itemId: '550e8400-e29b-41d4-a716-446655440117', cantidad: '1' },
      ],
    };

    it('checkout: rechaza nombrando el producto y no calcula nada', async () => {
      pausarSegundaLinea();
      await expect(service.checkout(TENANT_ID, dosLineas)).rejects.toThrow(
        'El producto "Torta" ya no se encuentra disponible',
      );
      expect(calculo.calcular).not.toHaveBeenCalled();
    });

    it('pagar con Webpay activo: no llega a crear la orden', async () => {
      tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
      metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
      pausarSegundaLinea();

      await expect(
        service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dosLineas),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pagosRedirect.iniciar).not.toHaveBeenCalled();
    });
  });

  describe('sin Webpay activo', () => {
    const sinWebpay = () =>
      tenantPasarela.resolverConfiguracionActiva.mockRejectedValue(
        new Error('no config'),
      );

    it('con la pasarela demo prendida: cae a modo simulado', async () => {
      sinWebpay();
      tenantPasarela.codigoActivo.mockResolvedValue(true);
      metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');

      const res = await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto);

      expect(res.modo).toBe('simulado');
      expect(tenantPasarela.codigoActivo).toHaveBeenCalledWith(
        TENANT_ID,
        'demo',
      );
      expect(pagosRedirect.iniciar).not.toHaveBeenCalled();
    });

    /**
     * El defecto que cierra esta rama: sin ninguna pasarela configurada la
     * tienda entregaba mercadería y anotaba la venta cobrada, heredando el
     * simulado por el solo hecho de que faltara Webpay.
     */
    it('sin ninguna pasarela configurada: rechaza en vez de simular', async () => {
      sinWebpay();
      tenantPasarela.codigoActivo.mockResolvedValue(false);

      await expect(
        service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto),
      ).rejects.toThrow(
        'Este local todavía no tiene un medio de cobro online configurado',
      );
      expect(calculo.calcular).not.toHaveBeenCalled();
      expect(pagosRedirect.iniciar).not.toHaveBeenCalled();
    });

    /**
     * El método lo resuelve el backend con la misma regla que la rama Webpay;
     * la pantalla lo elegía sola por el nombre y caía en `metodos[0]`, sin
     * mirar siquiera si estaba habilitado.
     */
    it('devuelve el método con el que la pantalla registra el pago', async () => {
      sinWebpay();
      tenantPasarela.codigoActivo.mockResolvedValue(true);
      metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');

      const res = await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto);

      expect(res).toMatchObject({
        modo: 'simulado',
        metodoPagoId: 'mp-credito',
      });
    });

    /**
     * Un carrito de $0 (100% de descuento) es una venta pagada SIN línea de
     * pago. Resolver el método igual abortaría con 400 —`resolverMetodoCredito`
     * tira si no hay ninguno habilitado— un checkout que hoy funciona.
     */
    it('carrito de $0: no resuelve método alguno', async () => {
      sinWebpay();
      tenantPasarela.codigoActivo.mockResolvedValue(true);
      calculo.calcular.mockResolvedValueOnce({
        ...mockResultado,
        totales: { ...mockResultado.totales, totalFinal: '0.0000' },
      });

      const res = await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto);

      expect(res).toMatchObject({ modo: 'simulado', metodoPagoId: null });
      expect(metodos.resolverMetodoCredito).not.toHaveBeenCalled();
    });
  });

  it('pagar con Webpay activo: inicia orden interno con snapshot y devuelve webpay', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
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

  it('pagar con presentación conserva campos en snapshot y calcula canónica', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
    metodos.findMetodosPago.mockResolvedValue([
      { metodoPagoId: 'mp-credito', nombre: 'Crédito', habilitada: true },
    ]);
    pagosRedirect.iniciar.mockResolvedValue({
      ordenId: 'orden-2',
      urlWebpay: 'https://webpay/redirect',
    });
    calculo.calcular.mockResolvedValueOnce({
      ...mockResultado,
      lineas: [{ ...mockResultado.lineas[0], cantidad: '0.5' }],
    });

    await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', {
      lineas: [
        {
          itemId: ITEM_ID,
          cantidad: '999',
          cantidadPresentacion: '500',
          unidadCodigoPresentacion: 'g',
        },
      ],
    });

    expect(calculo.calcular).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        lineas: [expect.objectContaining({ cantidad: '0.5' })],
      }),
    );
    const opts = pagosRedirect.iniciar.mock.calls[0][2] as {
      metadataExtra: { checkout: { lineas: unknown[] } };
    };
    expect(opts.metadataExtra.checkout.lineas[0]).toEqual({
      itemId: ITEM_ID,
      cantidad: '0.5',
      cantidadPresentacion: '500',
      unidadCodigoPresentacion: 'g',
    });
  });

  it('resuelve las líneas del checkout con UNA carga, no una por línea', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
    metodos.findMetodosPago.mockResolvedValue([
      { metodoPagoId: 'mp-credito', nombre: 'Crédito', habilitada: true },
    ]);
    pagosRedirect.iniciar.mockResolvedValue({
      ordenId: 'orden-3',
      urlWebpay: 'https://webpay/redirect',
    });
    calculo.calcular.mockResolvedValueOnce({
      ...mockResultado,
      lineas: [
        { ...mockResultado.lineas[0], itemId: 'item-a' },
        { ...mockResultado.lineas[0], itemId: 'item-b' },
        { ...mockResultado.lineas[0], itemId: 'item-c' },
      ],
    });

    await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', {
      lineas: [
        { itemId: 'item-a', cantidad: '1' },
        { itemId: 'item-b', cantidad: '1' },
        { itemId: 'item-c', cantidad: '1' },
      ],
    });

    // Si alguien vuelve a resolver ítem por ítem, este contador pasa a 3.
    expect(items.cargarBasePorIds).toHaveBeenCalledTimes(1);
    expect(items.cargarBasePorIds).toHaveBeenCalledWith(TENANT_ID, [
      'item-a',
      'item-b',
      'item-c',
    ]);
  });

  it('pagar con Webpay pero sin métodos habilitados: rechaza', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.resolverMetodoCredito.mockRejectedValue(
      new BadRequestException(
        'No hay métodos de pago habilitados para la tienda online',
      ),
    );
    await expect(
      service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto),
    ).rejects.toThrow('métodos de pago');
  });

  it('pagar: nunca reenvía al motor el cuentaId que manda el cliente', async () => {
    // `pagar` autoriza el cargo a la tarjeta contra `resultado.totales.totalFinal`.
    // Si un `cuentaId` de una cuenta abierta dentro de una promo vieja llegara
    // al motor, movería la vigencia de las reglas con fecha y el monto cobrado
    // divergiría del total que la venta persiste después (que recalcula sin
    // `cuentaId`, con "ahora"). La tienda no tiene noción de cuenta de salón.
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
    metodos.findMetodosPago.mockResolvedValue([
      { metodoPagoId: 'mp-credito', nombre: 'Crédito', habilitada: true },
    ]);
    pagosRedirect.iniciar.mockResolvedValue({
      ordenId: 'orden-4',
      urlWebpay: 'https://webpay/redirect',
    });

    await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', {
      ...dto,
      cuentaId: 'cuenta-de-una-promo-vencida',
    });

    const [, calcularDto] = calculo.calcular.mock.calls[0] as [
      string,
      { cuentaId?: string },
    ];
    expect(calcularDto.cuentaId).toBeUndefined();
  });

  it("pagar: fuerza canal 'online' aunque el body diga otra cosa", async () => {
    // Mismo peligro que el `cuentaId` de arriba, en la otra punta: el `canal`
    // decide qué promociones aplican, y este camino AUTORIZA el cargo contra la
    // tarjeta con el total que sale de este cálculo. Un navegador mandando
    // `'fisico'` colaría una promo que solo rige en el local, mientras el
    // callback persiste la venta con canal `'online'` — otro total.
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
    metodos.findMetodosPago.mockResolvedValue([
      { metodoPagoId: 'mp-credito', nombre: 'Crédito', habilitada: true },
    ]);
    pagosRedirect.iniciar.mockResolvedValue({
      ordenId: 'orden-5',
      urlWebpay: 'https://webpay/redirect',
    });

    await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', {
      ...dto,
      canal: 'fisico',
    });

    const [, calcularDto] = calculo.calcular.mock.calls[0] as [
      string,
      { canal?: string },
    ];
    expect(calcularDto.canal).toBe('online');
  });

  it("checkout: fuerza canal 'online' aunque el body diga otra cosa", async () => {
    await service.checkout(TENANT_ID, { ...dto, canal: 'fisico' });

    const [, calcularDto] = calculo.calcular.mock.calls[0] as [
      string,
      { canal?: string },
    ];
    expect(calcularDto.canal).toBe('online');
  });

  it('resultadoOrden: mapea a { estado, ventaId, detalle del pago }', async () => {
    pagosRedirect.obtenerResultado.mockResolvedValue({
      ordenId: 'orden-1',
      estado: 'conciliada',
      ventaId: 'venta-9',
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
