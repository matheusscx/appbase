import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { OnlineService } from './online.service';
import { CalculoPreciosService } from '../calculo-precios/calculo-precios.service';
import { MetodosPagoService } from '../metodos-pago/metodos-pago.service';
import { TenantPasarelaService } from '../pasarela/services/tenant-pasarela.service';
import { PagosRedirectService } from '../pasarela/services/pagos-redirect.service';
import { ItemsService } from '../items/items.service';
import { CatalogService } from '../catalog/catalog.service';
import { VentasService } from '../ventas/ventas.service';
import { MonedasService } from '../monedas/monedas.service';

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
  const calculo = {
    calcular: jest.fn().mockResolvedValue(mockResultado),
    cargarConfig: jest.fn().mockResolvedValue({ modoRedondeo: 'FLOOR' }),
    convertirAMonedaOficial: jest.fn(
      (p: string, m: string, t: Map<string, string>) =>
        new Decimal(p).times(t.get(m) ?? '1').toFixed(4),
    ),
  };
  const monedas = {
    decimalesOficiales: jest.fn().mockResolvedValue(0),
    findMonedas: jest.fn().mockResolvedValue([
      { monedaId: 'clp', valorDelDia: '1' },
      { monedaId: 'usd', valorDelDia: '950.000000' },
    ]),
  };
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
    precioBase: '10.0000',
    monedaId: 'usd',
    clasificacionTributaria: 'afecto',
    ...over,
  });
  const items = {
    cargarBasePorIds: jest
      .fn()
      .mockImplementation((_t: string, ids: string[]) =>
        Promise.resolve(new Map(ids.map((id) => [id, itemBase(id)]))),
      ),
    validarStockAlPedir: jest.fn().mockResolvedValue(undefined),
    exigenPersonalizacion: jest.fn().mockResolvedValue(new Set()),
  };
  const catalog = {
    findAllUnidadesMedida: jest.fn().mockResolvedValue(UNIDADES),
  };
  const ventas = {
    exigirCompraOnlineBajoUmbral: jest.fn().mockResolvedValue(undefined),
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
        { provide: VentasService, useValue: ventas },
        { provide: MonedasService, useValue: monedas },
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

  /**
   * La tienda no vende productos con número de serie: no hay quien elija la
   * unidad, y rechazar la venta después de Webpay dejaría un cargo sin venta.
   */
  describe('producto con número de serie', () => {
    const serieEnLaSegundaLinea = () =>
      items.cargarBasePorIds.mockImplementationOnce(
        (_t: string, ids: string[]) =>
          Promise.resolve(
            new Map(
              ids.map((id, i) => [
                id,
                itemBase(
                  id,
                  i === 1
                    ? { nombre: 'Celular X', modoInventario: 'serie' }
                    : {},
                ),
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
      serieEnLaSegundaLinea();
      await expect(service.checkout(TENANT_ID, dosLineas)).rejects.toThrow(
        '«Celular X» se vende solo en el local',
      );
      expect(calculo.calcular).not.toHaveBeenCalled();
    });

    it('pagar con Webpay activo: no llega a crear la orden', async () => {
      tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
      metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
      serieEnLaSegundaLinea();

      await expect(
        service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dosLineas),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pagosRedirect.iniciar).not.toHaveBeenCalled();
    });
  });

  /**
   * Un ingrediente no se vende directo: la venta lo rechaza en el callback,
   * con el cargo de Webpay ya hecho. Se ataja antes de cobrar.
   */
  describe('ingrediente', () => {
    const ingredienteEnLaSegundaLinea = () =>
      items.cargarBasePorIds.mockImplementationOnce(
        (_t: string, ids: string[]) =>
          Promise.resolve(
            new Map(
              ids.map((id, i) => [
                id,
                itemBase(
                  id,
                  i === 1 ? { nombre: 'Harina', tipo: 'ingrediente' } : {},
                ),
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

    it('checkout: rechaza nombrándolo y no calcula nada', async () => {
      ingredienteEnLaSegundaLinea();
      await expect(service.checkout(TENANT_ID, dosLineas)).rejects.toThrow(
        '«Harina» es un ingrediente: no se vende directamente',
      );
      expect(calculo.calcular).not.toHaveBeenCalled();
    });

    it('pagar con Webpay activo: no llega a crear la orden', async () => {
      tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
      metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
      ingredienteEnLaSegundaLinea();

      await expect(
        service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dosLineas),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pagosRedirect.iniciar).not.toHaveBeenCalled();
    });
  });

  /**
   * Una receta o un combo con un grupo obligatorio no se cobra online: la
   * tienda no ofrece elegir y la venta del callback rechazaba con el cobro
   * hecho (medido el 2026-10-11).
   */
  describe('grupo obligatorio', () => {
    it('pregunta por todo el carrito de una vez y rechaza nombrando el ítem, sin revisar stock ni calcular', async () => {
      items.cargarBasePorIds.mockResolvedValueOnce(
        new Map([
          [ITEM_ID, itemBase(ITEM_ID, { tipo: 'receta', nombre: 'Lomo' })],
        ]),
      );
      items.exigenPersonalizacion.mockResolvedValueOnce(new Set([ITEM_ID]));

      await expect(service.checkout(TENANT_ID, dto)).rejects.toThrow(
        new BadRequestException('«Lomo» se vende solo en el local'),
      );
      expect(items.exigenPersonalizacion).toHaveBeenCalledWith(TENANT_ID, [
        { itemId: ITEM_ID, tipo: 'receta' },
      ]);
      expect(items.validarStockAlPedir).not.toHaveBeenCalled();
      expect(calculo.calcular).not.toHaveBeenCalled();
    });
  });

  /**
   * Lo que ya no hay no se cobra (owner, 2026-10-11): la tienda revisa el
   * stock con la regla del salón al pedir antes de mandar a Webpay. Al
   * comprador le llega solo el nombre, no el saldo ni las bodegas.
   */
  describe('stock agotado', () => {
    /** El 400 tal como lo arma `errorStockInsuficiente`. */
    const agotado = () =>
      items.validarStockAlPedir.mockRejectedValueOnce(
        new BadRequestException({
          message:
            'Stock insuficiente de "Pisco" en el local: quedan 0 unidad y lo que se está agregando necesita 1 unidad — hay 4 unidad en Bodega Central',
          itemId: 'pisco',
          itemNombre: 'Pisco',
          faltante: '1',
          ubicaciones: [
            { ubicacionId: 'b', nombre: 'Bodega Central', stock: '4' },
          ],
        }),
      );

    it('revisa todo el carrito de una vez, en la cantidad canónica y sin lock', async () => {
      await service.checkout(TENANT_ID, {
        lineas: [
          { itemId: ITEM_ID, cantidad: '2' },
          { itemId: '550e8400-e29b-41d4-a716-446655440117', cantidad: '1' },
        ],
      });

      expect(items.validarStockAlPedir).toHaveBeenCalledTimes(1);
      expect(items.validarStockAlPedir).toHaveBeenCalledWith(
        TENANT_ID,
        [
          { itemId: ITEM_ID, cantidad: '2', personalizacion: null },
          {
            itemId: '550e8400-e29b-41d4-a716-446655440117',
            cantidad: '1',
            personalizacion: null,
          },
        ],
        [],
        { bloquear: false },
      );
    });

    it('checkout: rechaza con el nombre y nada más, y no calcula', async () => {
      agotado();
      await expect(service.checkout(TENANT_ID, dto)).rejects.toThrow(
        new BadRequestException('«Pisco» se agotó'),
      );
      expect(calculo.calcular).not.toHaveBeenCalled();
    });

    it('pagar con Webpay activo: no llega a crear la orden', async () => {
      tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
      metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
      agotado();

      await expect(
        service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto),
      ).rejects.toThrow('«Pisco» se agotó');
      expect(pagosRedirect.iniciar).not.toHaveBeenCalled();
    });

    it('otro 400 de la revisión (sin `itemNombre`) pasa tal cual', async () => {
      items.validarStockAlPedir.mockRejectedValueOnce(
        new BadRequestException(
          'No se puede verificar el stock de "Pisco": el ítem ya no está disponible en el catálogo',
        ),
      );
      await expect(service.checkout(TENANT_ID, dto)).rejects.toThrow(
        'No se puede verificar el stock de "Pisco": el ítem ya no está disponible en el catálogo',
      );
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
      expect.anything(),
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

  it('pagar con Webpay: congela en la orden el resultado autorizado y lo que la venta necesita de cada línea', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
    metodos.findMetodosPago.mockResolvedValue([
      { metodoPagoId: 'mp-credito', nombre: 'Crédito', habilitada: true },
    ]);
    pagosRedirect.iniciar.mockResolvedValue({ ordenId: 'o', urlWebpay: 'u' });

    await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto);

    // El motor recibe el precio ya convertido, por el canal interno, y la
    // config con la que se convirtió.
    expect(calculo.calcular).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        lineas: [
          expect.objectContaining({
            precioUnitarioResuelto: '9500.0000',
            precioUnitarioOrigenResuelto: '10.0000',
          }),
        ],
      }),
      { modoRedondeo: 'FLOOR' },
    );
    // El modo de redondeo de la config llega a la conversión: un modo fijo
    // (p. ej. 'HALF_UP') desobedecería al tenant que eligió no redondear hacia arriba.
    expect(calculo.convertirAMonedaOficial).toHaveBeenCalledWith(
      '10.0000',
      'usd',
      expect.any(Map),
      'FLOOR',
    );
    const opts = pagosRedirect.iniciar.mock.calls[0][2] as {
      metadataExtra: { checkout: { congelado: unknown } };
    };
    expect(opts.metadataExtra.checkout.congelado).toEqual({
      resultado: mockResultado,
      lineas: [
        {
          precioUnitarioOrigen: '10.0000',
          monedaIdOrigen: 'usd',
          tasaCambio: '950.000000',
          clasificacionTributaria: 'afecto',
          descripcion: 'Producto demo',
        },
      ],
    });
  });

  it('pagar: las tasas y la config se leen una vez por carrito, no por línea', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
    metodos.findMetodosPago.mockResolvedValue([]);
    pagosRedirect.iniciar.mockResolvedValue({ ordenId: 'o', urlWebpay: 'u' });
    const tres = {
      lineas: [
        { itemId: '550e8400-e29b-41d4-a716-446655440116', cantidad: '1' },
        { itemId: '550e8400-e29b-41d4-a716-446655440117', cantidad: '1' },
        { itemId: '550e8400-e29b-41d4-a716-446655440118', cantidad: '1' },
      ],
    };
    calculo.calcular.mockResolvedValueOnce({
      ...mockResultado,
      lineas: tres.lineas.map((l) => ({
        ...mockResultado.lineas[0],
        itemId: l.itemId,
      })),
    });

    await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', tres);

    expect(monedas.findMonedas).toHaveBeenCalledTimes(1);
    expect(monedas.decimalesOficiales).toHaveBeenCalledTimes(1);
    expect(calculo.cargarConfig).toHaveBeenCalledTimes(1);
  });

  it('pagar: cada línea congelada lleva la moneda, la tasa y el nombre de su ítem', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    metodos.resolverMetodoCredito.mockResolvedValue('mp-credito');
    metodos.findMetodosPago.mockResolvedValue([]);
    pagosRedirect.iniciar.mockResolvedValue({ ordenId: 'o', urlWebpay: 'u' });
    const ID_CLP = '550e8400-e29b-41d4-a716-446655440116';
    const ID_USD = '550e8400-e29b-41d4-a716-446655440117';
    items.cargarBasePorIds.mockImplementationOnce((_t: string, ids: string[]) =>
      Promise.resolve(
        new Map(
          ids.map((id) => [
            id,
            itemBase(
              id,
              id === ID_CLP
                ? { precioBase: '5000.0000', monedaId: 'clp', nombre: 'Pisco' }
                : { precioBase: '10.0000', monedaId: 'usd', nombre: 'Whisky' },
            ),
          ]),
        ),
      ),
    );
    calculo.calcular.mockResolvedValueOnce({
      ...mockResultado,
      lineas: [ID_CLP, ID_USD].map((itemId) => ({
        ...mockResultado.lineas[0],
        itemId,
      })),
    });

    await service.pagar(TENANT_ID, 'u-1', 'user@x.cl', {
      lineas: [
        { itemId: ID_CLP, cantidad: '1' },
        { itemId: ID_USD, cantidad: '1' },
      ],
    });

    const opts = pagosRedirect.iniciar.mock.calls[0][2] as {
      metadataExtra: { checkout: { congelado: { lineas: unknown[] } } };
    };
    expect(opts.metadataExtra.checkout.congelado.lineas).toEqual([
      {
        precioUnitarioOrigen: '5000.0000',
        monedaIdOrigen: 'clp',
        tasaCambio: '1.000000',
        clasificacionTributaria: 'afecto',
        descripcion: 'Pisco',
      },
      {
        precioUnitarioOrigen: '10.0000',
        monedaIdOrigen: 'usd',
        tasaCambio: '950.000000',
        clasificacionTributaria: 'afecto',
        descripcion: 'Whisky',
      },
    ]);
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
      monto: '9520.000000',
      tipoPago: 'VD',
      numeroCuotas: 0,
      tarjetaUltimos4: '6623',
      motivoRechazo: null,
    });
    const res = await service.resultadoOrden(TENANT_ID, 'orden-1');
    expect(res).toEqual({
      estado: 'conciliada',
      ventaId: 'venta-9',
      monto: '9520.000000',
      tipoPago: 'VD',
      numeroCuotas: 0,
      tarjetaUltimos4: '6623',
      motivoRechazo: null,
    });
  });

  // Un monto que no cabe en su columna lo rechaza `calcular` (2026-10-08), antes
  // de iniciar la orden: sin esto el cliente pagaría en Webpay y el callback no
  // podría guardar la venta.
  it('con Webpay: si el motor rechaza el monto, no inicia la orden', async () => {
    tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
    calculo.calcular.mockRejectedValueOnce(
      new BadRequestException('el sistema no puede guardar montos'),
    );

    await expect(
      service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto),
    ).rejects.toThrow('el sistema no puede guardar montos');
    expect(pagosRedirect.iniciar).not.toHaveBeenCalled();
  });

  /**
   * Sobre el umbral de la Res. Ex. SII 44/2025 la boleta lleva nombre y RUT de
   * quien paga, y la tienda no los pide. El callback de Webpay crea la venta con
   * el cobro ya hecho: el rechazo tiene que ser antes de iniciar la orden.
   */
  describe('compra sobre el umbral de identidad', () => {
    const sobreUmbral = () =>
      ventas.exigirCompraOnlineBajoUmbral.mockRejectedValueOnce(
        new BadRequestException('lleva el nombre y el RUT de quien paga'),
      );

    it('con Webpay: se rechaza con el total calculado, antes de iniciar la orden', async () => {
      tenantPasarela.resolverConfiguracionActiva.mockResolvedValue({});
      sobreUmbral();

      await expect(
        service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto),
      ).rejects.toThrow('RUT de quien paga');
      expect(ventas.exigirCompraOnlineBajoUmbral).toHaveBeenCalledWith(
        TENANT_ID,
        '100.0000',
      );
      expect(pagosRedirect.iniciar).not.toHaveBeenCalled();
    });

    it('con la demo: se rechaza igual y no resuelve el método', async () => {
      tenantPasarela.resolverConfiguracionActiva.mockRejectedValue(
        new Error('no config'),
      );
      tenantPasarela.codigoActivo.mockResolvedValue(true);
      sobreUmbral();

      await expect(
        service.pagar(TENANT_ID, 'u-1', 'user@x.cl', dto),
      ).rejects.toThrow('RUT de quien paga');
      expect(ventas.exigirCompraOnlineBajoUmbral).toHaveBeenCalledWith(
        TENANT_ID,
        '100.0000',
      );
      expect(metodos.resolverMetodoCredito).not.toHaveBeenCalled();
    });
  });
});
