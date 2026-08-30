import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CalculoPreciosService } from './calculo-precios.service';
import * as engine from './calculo-precios.engine';
import { ItemsService } from '../items/items.service';
import { ImpuestosService } from '../impuestos/impuestos.service';
import { DescuentosService } from '../descuentos/descuentos.service';
import { RecargosService } from '../recargos/recargos.service';
import { TenantsService } from '../tenants/tenants.service';
import { MonedasService } from '../monedas/monedas.service';
import { PromocionesService } from '../promociones/promociones.service';
import { Db } from '../../common/db/db.service';
import * as rangoFechaUtil from '../../common/utils/rango-fecha.util';

const TENANT = 't-1';
const CUENTA_ID = '550e8400-e29b-41d4-a716-446655440777';

const prefs = {
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  formula: ['descuentos', 'recargos', 'impuestos'],
  escalaCalculo: 6,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  montoTolerancia: '0',
  promosAcumulanDescuentos: false,
};

describe('CalculoPreciosService', () => {
  let service: CalculoPreciosService;
  let itemsService: {
    cargarBasePorIds: jest.Mock;
    cargarReglasPorIds: jest.Mock;
    cargarCatalogosPersonalizacion: jest.Mock;
    resolverPersonalizacionReceta: jest.Mock;
    resolverPersonalizacionCombo: jest.Mock;
  };
  let impuestosService: { findAll: jest.Mock };
  let descuentosService: { findAll: jest.Mock };
  let recargosService: { findAll: jest.Mock };
  let tenantsService: { getPreferenciasFinancieras: jest.Mock };
  let monedasService: { findMonedas: jest.Mock; decimalesOficiales: jest.Mock };
  let promocionesService: { cargarVigentes: jest.Mock };
  let db: { query: jest.Mock };

  const base = (over: Record<string, unknown> = {}) => ({
    id: 'item-1',
    nombre: 'Item 1',
    precioBase: '100',
    monedaId: 'moneda-clp',
    precioIncluyeImpuesto: false,
    clasificacionTributaria: 'afecto',
    // `BASE_QUERY` siempre trae `i.activo`: el fixture lo refleja para que el
    // caso normal no sea "ítem sin el campo" (que es un estado imposible).
    activo: true,
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
      // El catálogo por lote: una consulta para todas las líneas, en vez de
      // tres por línea. El mock devuelve mapas vacíos —los resolvers están
      // mockeados igual—; lo que los tests afirman es QUIÉN se llama y con qué.
      cargarCatalogosPersonalizacion: jest.fn().mockResolvedValue({
        ingredientes: new Map(),
        extras: new Map(),
        grupos: new Map(),
        componentesCombo: new Map(),
      }),
      // Sin personalización en el body no se llaman nunca: el default tira si
      // alguien los alcanza sin querer, para que el caso base no pase por acá
      // en silencio.
      resolverPersonalizacionReceta: jest.fn(),
      resolverPersonalizacionCombo: jest.fn(),
    };
    mockItems();
    impuestosService = {
      findAll: jest.fn().mockResolvedValue([
        {
          id: 'imp-1',
          nombre: 'IVA',
          porcentaje: '0.19',
          tipo: 'iva',
          activo: true,
        },
        {
          id: 'imp-2',
          nombre: 'Adicional',
          porcentaje: '0.10',
          tipo: 'otro',
          activo: true,
        },
      ]),
    };
    descuentosService = {
      findAll: jest.fn().mockResolvedValue([
        {
          id: 'desc-1',
          nombre: 'Desc 10%',
          modo: 'porcentaje',
          valorPorcentaje: '0.10',
          tipoRegla: { codigo: 'general' },
          tramos: [],
          metodoPagoIds: [],
          activo: true,
          nivel: 'linea',
        },
        {
          id: 'desc-2',
          nombre: 'Otro 20%',
          modo: 'porcentaje',
          valorPorcentaje: '0.20',
          tipoRegla: { codigo: 'general' },
          tramos: [],
          metodoPagoIds: [],
          activo: true,
          nivel: 'linea',
        },
      ]),
    };
    recargosService = { findAll: jest.fn().mockResolvedValue([]) };
    tenantsService = {
      getPreferenciasFinancieras: jest.fn().mockResolvedValue(prefs),
    };
    monedasService = {
      findMonedas: jest.fn().mockResolvedValue([
        {
          monedaId: 'moneda-clp',
          valorDelDia: '1',
        },
        {
          monedaId: 'moneda-usd',
          valorDelDia: '950',
        },
      ]),
      // 4 = el máximo que admite el sistema (UF); el motor todavía no
      // cuantiza con este valor (Task 5).
      decimalesOficiales: jest.fn().mockResolvedValue(4),
    };

    // `calcular()` ahora resuelve `fechaLocalTenant` siempre, no solo cuando
    // una regla tiene fechas. Se mockea acá (default sin efecto real: ninguna
    // regla del fixture base tiene `fechaInicio`/`fechaFin`) para que el resto
    // del spec no dependa de `Db` de verdad ni de la fecha real del runner —
    // el describe de vigencia la pisa por test con `mockResolvedValue`.
    jest
      .spyOn(rangoFechaUtil, 'fechaLocalTenant')
      .mockResolvedValue('2026-01-01');

    // Un tenant sin promos es el caso base de todo el resto del spec: la
    // lista vacía corta antes del evaluador y nada cambia.
    promocionesService = { cargarVigentes: jest.fn().mockResolvedValue([]) };
    db = { query: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CalculoPreciosService,
        { provide: ItemsService, useValue: itemsService },
        { provide: ImpuestosService, useValue: impuestosService },
        { provide: DescuentosService, useValue: descuentosService },
        { provide: RecargosService, useValue: recargosService },
        { provide: TenantsService, useValue: tenantsService },
        { provide: MonedasService, useValue: monedasService },
        { provide: PromocionesService, useValue: promocionesService },
        { provide: Db, useValue: db },
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

  /**
   * El precio de una línea lo calcula el servidor. Hasta el 2026-08-30 el cliente
   * podía fijarlo con un `precioUnitario` en el body, y el motor lo usaba tal cual
   * —o sea **sin convertir**: la conversión vivía en la rama del `else`—. Como POS y
   * salones lo alimentaban con `precioBase + extras` en la moneda del ítem, una
   * receta en USD se previsualizaba en dólares y se cobraba en pesos.
   *
   * Estos dos tests son el par que reemplaza a aquel par: la conversión ya no
   * depende de que el cliente se calle, y el extra entra ANTES de convertir.
   */
  it('tasa la personalización en el servidor y convierte el total a moneda oficial', async () => {
    mockItems({ precioBase: '10', monedaId: 'moneda-usd', tipo: 'receta' });
    itemsService.resolverPersonalizacionReceta.mockResolvedValue({
      snapshot: { omitidos: [], extras: [] },
      precioExtraTotal: '2.0000',
    });
    const r = await service.calcular(TENANT, {
      lineas: [
        {
          itemId: 'item-usd',
          cantidad: '1',
          descuentoIds: [],
          personalizacion: { extras: [{ ingredienteItemId: 'ing-1' }] },
        },
      ],
    });
    // (10 + 2) × 950, no (10 + 2) ni 10 × 950.
    expect(r.lineas[0].subtotalNeto).toBe('11400.000000');
  });

  /**
   * **El guard del N+1.** Los catálogos que necesitan los resolvers son por
   * ÍTEM —`(tenantId, itemId)`, nada de la línea—, así que se precargan por lote
   * UNA vez para todo el cálculo. Sin esto, tres líneas personalizadas costaban
   * tres relecturas de ingredientes, extras y grupos, en el endpoint que corre
   * con cada tecleo del carrito (debounce de 300 ms).
   *
   * El test afirma las dos mitades: **una sola** carga por lote, y que a cada
   * resolver le llegue el catálogo precargado (si no, lo lee él y el lote no
   * sirvió de nada).
   */
  it('precarga los catálogos de personalización UNA vez para todas las líneas', async () => {
    mockItems({ precioBase: '10', tipo: 'receta' });
    itemsService.resolverPersonalizacionReceta.mockResolvedValue({
      snapshot: { omitidos: [], extras: [] },
      precioExtraTotal: '1.0000',
    });
    const conExtra = (itemId: string) => ({
      itemId,
      cantidad: '1',
      descuentoIds: [],
      personalizacion: { extras: [{ ingredienteItemId: 'ing-1' }] },
    });

    await service.calcular(TENANT, {
      lineas: [
        conExtra('receta-1'),
        conExtra('receta-2'),
        conExtra('receta-3'),
      ],
    });

    expect(itemsService.cargarCatalogosPersonalizacion).toHaveBeenCalledTimes(
      1,
    );
    expect(itemsService.resolverPersonalizacionReceta).toHaveBeenCalledTimes(3);
    for (const llamada of itemsService.resolverPersonalizacionReceta.mock
      .calls) {
      // 5º argumento: el catálogo precargado.
      expect(llamada[4]).toBeDefined();
    }
  });

  /**
   * La otra mitad del guard: una línea que no puede costar nada tampoco entra al
   * lote. Con un carrito entero de "sin cebolla" no se toca la base.
   */
  it('no precarga nada si ninguna línea puede agregar precio', async () => {
    mockItems({ precioBase: '10', tipo: 'receta' });
    await service.calcular(TENANT, {
      lineas: [
        {
          itemId: 'receta-1',
          cantidad: '1',
          descuentoIds: [],
          personalizacion: { omitidos: ['cebolla'], extras: [] },
        },
      ],
    });
    expect(itemsService.cargarCatalogosPersonalizacion).not.toHaveBeenCalled();
  });

  /**
   * El gemelo por la otra rama del discriminador. No es simetría decorativa:
   * `resolverPersonalizacionCombo` es el ÚNICO que recorre `componentes` —los
   * grupos anidados de un combo—, así que un mutante que llamara siempre a la
   * variante receta devolvería un `precioExtraTotal` sin las opciones pagas de
   * los componentes, y el preview volvería a quedar por debajo del cobro.
   */
  it('un combo se tasa por resolverPersonalizacionCombo, no por el de receta', async () => {
    mockItems({ precioBase: '10', monedaId: 'moneda-usd', tipo: 'combo' });
    itemsService.resolverPersonalizacionCombo.mockResolvedValue({
      snapshot: { omitidos: [], extras: [] },
      precioExtraTotal: '2.0000',
    });
    const r = await service.calcular(TENANT, {
      lineas: [
        {
          itemId: 'combo-usd',
          cantidad: '1',
          descuentoIds: [],
          personalizacion: {
            componentes: [
              {
                componenteItemId: 'burger-1',
                unidad: 1,
                grupos: [
                  { grupoId: 'g-1', opciones: [{ itemId: 'proteina-1' }] },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(itemsService.resolverPersonalizacionCombo).toHaveBeenCalled();
    expect(itemsService.resolverPersonalizacionReceta).not.toHaveBeenCalled();
    expect(r.lineas[0].subtotalNeto).toBe('11400.000000');
  });

  /**
   * El criterio "sacar no cobra, agregar sí", que hasta el 2026-08-30 vivía
   * duplicado en los dos clientes y ahora vive solo acá. El test afirma las dos
   * mitades: el precio no se mueve **y** no se paga ni una consulta — que es lo
   * que evita que tasar la personalización le agregue costo a una precuenta
   * llena de "sin cebolla".
   */
  it('una personalización que solo omite no mueve el precio ni consulta nada', async () => {
    mockItems({ precioBase: '100', tipo: 'receta' });
    const r = await service.calcular(TENANT, {
      lineas: [
        {
          itemId: 'receta-1',
          cantidad: '1',
          descuentoIds: [],
          personalizacion: {
            omitidos: ['ingrediente-cebolla'],
            extras: [],
            comentario: 'Bien cocido',
          },
        },
      ],
    });
    expect(r.lineas[0].subtotalNeto).toBe('100.000000');
    expect(itemsService.resolverPersonalizacionReceta).not.toHaveBeenCalled();
    expect(itemsService.resolverPersonalizacionCombo).not.toHaveBeenCalled();
  });

  it('convierte el precio del ítem a moneda oficial', async () => {
    mockItems({ precioBase: '10', monedaId: 'moneda-usd' });
    const r = await service.calcular(TENANT, {
      lineas: [{ itemId: 'item-usd', cantidad: '1', descuentoIds: [] }],
    });
    expect(r.lineas[0].subtotalNeto).toBe('9500.000000');
    expect(r.lineas[0].impuestoAplicado).toBe('1805.000000');
    expect(r.lineas[0].totalLinea).toBe('11305.000000');
    expect(r.totales.totalFinal).toBe('11305.000000');
  });

  // La conversión a moneda oficial es el único lugar que hace la cuenta
  // `precio × tasa`, y hasta el 2026-08-11 era un `.toFixed(4)` liso: 4 decimales —bien, es la
  // escala del libro mayor de ventas— pero con el redondeo default de Decimal.js,
  // HALF_UP, pasara lo que pasara. Un tenant en 'FLOOR' eligió no redondear nunca
  // hacia arriba y este paso se lo desobedecía.
  //
  // La tasa lleva 6 decimales a propósito (`valor_del_dia` es `NUMERIC(18,6)`):
  // 19.99 × 950.123456 = 18992.96788544, y el 5º decimal es justo lo que separa un
  // modo del otro. Con la tasa redonda del resto del spec (950) los cuatro modos
  // dan lo mismo y el test no probaría nada.
  describe('conversión a moneda oficial', () => {
    const conModo = async (modo: string) => {
      monedasService.findMonedas.mockResolvedValue([
        { monedaId: 'moneda-clp', valorDelDia: '1' },
        { monedaId: 'moneda-usd', valorDelDia: '950.123456' },
      ]);
      mockItems({ precioBase: '19.99', monedaId: 'moneda-usd' });
      tenantsService.getPreferenciasFinancieras.mockResolvedValue({
        ...prefs,
        modoRedondeo: modo,
      });
      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-usd', cantidad: '1', descuentoIds: [] }],
      });
      return r.lineas[0].precioUnitario;
    };

    it('redondea con el modo del tenant, no con HALF_UP fijo', async () => {
      expect(await conModo('FLOOR')).toBe('18992.9678');
      expect(await conModo('CEIL')).toBe('18992.9679');
      expect(await conModo('HALF_UP')).toBe('18992.9679');
    });

    // El contrapeso del test de arriba: que el modo se respete NO habilita a
    // cambiar la escala. Estos 4 decimales no son `escalaCalculo` (6 en `prefs`):
    // son los de `venta_detalles.precio_unitario`, `NUMERIC(18,4)`. Si alguien
    // "completa" el arreglo llevándolo a `escalaCalculo`, el recorte no
    // desaparece —lo hace Postgres en el INSERT, sin config y sin test—. El
    // arreglo a medias **se ve** incompleto, y por eso este test existe.
    it('mantiene la escala persistida (4), no la de cálculo del tenant (6)', async () => {
      expect(prefs.escalaCalculo).toBe(6);
      expect((await conModo('HALF_UP')).split('.')[1]).toHaveLength(4);
    });

    // `cargarConfig` existe para que ventas pueda convertir con el mismo modo sin
    // consultar dos veces. Si `calcular` ignorara la config precargada, la venta
    // pagaría las dos consultas de nuevo y —peor— podría calcular con una config
    // distinta de la que usó para convertir.
    it('con config precargada no vuelve a consultar las preferencias', async () => {
      const config = await service.cargarConfig(TENANT, 4);
      tenantsService.getPreferenciasFinancieras.mockClear();

      await service.calcular(
        TENANT,
        { lineas: [{ itemId: 'item-1', cantidad: '1' }] },
        config,
      );

      expect(tenantsService.getPreferenciasFinancieras).not.toHaveBeenCalled();
    });
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

  // ── El nivel decide por qué puerta se usa una regla ──────────────────────
  //
  // Las dos puertas del nivel viven acá y en `ItemsService.validarReglas`. Ésta
  // es la que cubre el camino que la otra no ve: una línea puede mandar sus
  // propios `descuentoIds` y pisar los del ítem, sin pasar nunca por el catálogo.
  describe('nivel de la regla', () => {
    const reglaDeVenta = {
      id: 'desc-venta',
      nombre: 'Promo del total',
      modo: 'porcentaje',
      valorPorcentaje: '0.10',
      tipoRegla: { codigo: 'general' },
      tramos: [],
      metodoPagoIds: [],
      activo: true,
      nivel: 'venta',
    };

    it('una regla de venta pedida en la línea es 400', async () => {
      descuentosService.findAll.mockResolvedValue([reglaDeVenta]);

      await expect(
        service.calcular(TENANT, {
          lineas: [
            { itemId: 'item-1', cantidad: '1', descuentoIds: ['desc-venta'] },
          ],
        }),
      ).rejects.toThrow(/nivel venta/);
    });

    it('una regla de línea pedida en la venta es 400', async () => {
      await expect(
        service.calcular(TENANT, {
          lineas: [{ itemId: 'item-1', cantidad: '1' }],
          descuentosVentaIds: ['desc-1'],
        }),
      ).rejects.toThrow(/nivel línea/);
    });

    it('cada una por su puerta sí se aplica (ancla positiva)', async () => {
      descuentosService.findAll.mockResolvedValue([reglaDeVenta]);
      // El ítem por default trae `desc-1`, que este mock ya no devuelve.
      mockItems({}, { impuestosIds: [], descuentosIds: [], recargosIds: [] });

      // Sin esto, los dos 400 de arriba pasarían igual con la puerta tapiada
      // de los dos lados.
      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
        descuentosVentaIds: ['desc-venta'],
      });

      expect(Number(r.totales.totalDescuentos)).toBeGreaterThan(0);
    });
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
        valorPorcentaje: '0.05',
        tipoRegla: { codigo: 'general' },
        tramos: [],
        metodoPagoIds: [],
        activo: true,
        nivel: 'linea',
      },
    ]);
    // Ítem exento: aísla la resolución de recargos sin que la derivación de
    // IVA (Task 1, ADR-018) contamine el total esperado.
    mockItems(
      { clasificacionTributaria: 'exento' },
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

  /**
   * Un ítem pausado se COBRA igual en el POS (el producto puede estar ya en la
   * mano del cliente) y solo se avisa. Por eso la advertencia vive acá y no en
   * el motor: no cambia ningún monto. El caso del ítem activo es el control —
   * sin él, un servicio que empujara la advertencia siempre también pasaría.
   */
  describe('un ítem pausado se cobra igual y avisa', () => {
    const calcular = () =>
      service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });

    it('pausado: avisa en la línea y en la venta, sin tocar ningún total', async () => {
      const activo = await calcular();
      mockItems({ nombre: 'Papas fritas', activo: false });
      const pausado = await calcular();

      expect(pausado.lineas[0].advertencias).toEqual([
        {
          titulo: 'Producto "Papas fritas"',
          detalle: 'está en pausa y ya no se ofrece en el catálogo',
        },
      ]);
      // La misma advertencia también en la lista agregada, que es la que
      // `ventas.service.ts` aplana a los toasts del POS.
      expect(pausado.advertencias).toEqual(pausado.lineas[0].advertencias);
      // Pausar no es una regla a nivel venta: no ensucia `advertenciasVenta`.
      expect(pausado.advertenciasVenta).toEqual([]);
      // Los montos son idénticos a los del mismo ítem activo: la línea se cobra.
      expect(pausado.totales).toEqual(activo.totales);
      expect(pausado.lineas[0].totalLinea).toBe('107.100000');
    });

    /**
     * Decisión del owner (2026-08-11): el aviso de un ítem pausado es
     * información de catálogo, no de una línea. El mismo ítem en tres líneas
     * —receta personalizada dos veces, salones— daba tres toasts idénticos.
     *
     * La deduplicación NO puede vivir en el motor: esta advertencia se empuja
     * después de que `calcularVenta` devolvió, así que `sinRepetidas` ya corrió.
     */
    it('el mismo ítem pausado en 3 líneas avisa UNA vez, pero marca las 3', async () => {
      mockItems({ nombre: 'Papas fritas', activo: false });
      const r = await service.calcular(TENANT, {
        lineas: [
          { itemId: 'item-1', cantidad: '1' },
          { itemId: 'item-1', cantidad: '2' },
          { itemId: 'item-1', cantidad: '1' },
        ],
      });

      expect(r.advertencias).toHaveLength(1);
      // Las tres líneas siguen marcadas: sin esto el carrito no sabría cuáles
      // son, que es justo lo que el aviso agregado no puede decir.
      expect(r.lineas.map((l) => l.advertencias.length)).toEqual([1, 1, 1]);
    });

    it('activo: no avisa nada', async () => {
      const r = await calcular();
      expect(r.lineas[0].advertencias).toEqual([]);
      expect(r.advertencias).toEqual([]);
    });

    it('en un carrito mixto, el aviso va SOLO en la línea del ítem pausado', async () => {
      // Fija la correspondencia 1:1 por índice entre `dto.lineas` y
      // `resultado.lineas`: con un `forEach` mal indexado el aviso aterriza en
      // la línea equivocada y el cajero saca de la venta el producto que sí se
      // vendía.
      itemsService.cargarBasePorIds.mockImplementation(
        (_t: string, ids: string[]) =>
          Promise.resolve(
            new Map(
              ids.map((id) => [
                id,
                base({ id, nombre: id, activo: id !== 'item-b' }),
              ]),
            ),
          ),
      );

      const r = await service.calcular(TENANT, {
        lineas: [
          { itemId: 'item-a', cantidad: '1' },
          { itemId: 'item-b', cantidad: '1' },
          { itemId: 'item-c', cantidad: '1' },
        ],
      });

      expect(r.lineas[0].advertencias).toEqual([]);
      expect(r.lineas[1].advertencias[0].titulo).toBe('Producto "item-b"');
      expect(r.lineas[2].advertencias).toEqual([]);
      expect(r.advertencias).toHaveLength(1);
    });
  });

  describe('el IVA se deriva de la clasificación tributaria', () => {
    // imp-1 ('IVA', tipo iva) e imp-2 ('Adicional', tipo otro) ya están en el
    // catálogo mockeado en el beforeEach de arriba.
    it('un ítem afecto sin impuestos asociados igual lleva el IVA', async () => {
      mockItems({}, { impuestosIds: [], descuentosIds: [], recargosIds: [] });
      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });
      expect(r.lineas[0].trazas.impuestos.map((i) => i.id)).toEqual(['imp-1']);
    });

    it('un ítem afecto con adicionales lleva los adicionales MÁS el IVA', async () => {
      mockItems(
        {},
        { impuestosIds: ['imp-2'], descuentosIds: [], recargosIds: [] },
      );
      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });
      expect(r.lineas[0].trazas.impuestos.map((i) => i.id)).toEqual([
        'imp-2',
        'imp-1',
      ]);
    });

    // El IVA no se pausa: lo gobierna afecto/exento. Este test existe para que
    // una fila de IVA con `activo = false` —mal sembrada, o tocada por SQL
    // directo— NO deje de cobrarse. Dejar de cobrar IVA en silencio es un
    // problema fiscal, no un descuento mal aplicado.
    it('un ítem afecto paga IVA aunque la fila del IVA esté en activo = false', async () => {
      impuestosService.findAll.mockResolvedValue([
        {
          id: 'imp-1',
          nombre: 'IVA',
          porcentaje: '0.19',
          tipo: 'iva',
          activo: false,
        },
        {
          id: 'imp-2',
          nombre: 'Adicional',
          porcentaje: '0.10',
          tipo: 'otro',
          activo: true,
        },
      ]);
      mockItems({}, { impuestosIds: [], descuentosIds: [], recargosIds: [] });
      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });
      expect(r.lineas[0].trazas.impuestos.map((i) => i.id)).toEqual(['imp-1']);
      expect(r.lineas[0].impuestoAplicado).toBe('19.000000');
      expect(r.lineas[0].advertencias).toEqual([]);
    });

    // El adicional del MISMO catálogo sí se pausa: prueba que el `activo: true`
    // forzado es solo para el IVA y no un "todo activo" que anule la feature.
    it('en cambio un adicional pausado del mismo catálogo no se cobra', async () => {
      impuestosService.findAll.mockResolvedValue([
        {
          id: 'imp-1',
          nombre: 'IVA',
          porcentaje: '0.19',
          tipo: 'iva',
          activo: true,
        },
        {
          id: 'imp-2',
          nombre: 'Adicional',
          porcentaje: '0.10',
          tipo: 'otro',
          activo: false,
        },
      ]);
      mockItems(
        {},
        { impuestosIds: ['imp-2'], descuentosIds: [], recargosIds: [] },
      );
      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });
      expect(r.lineas[0].trazas.impuestos.map((i) => i.id)).toEqual(['imp-1']);
      expect(r.lineas[0].advertencias[0].titulo).toBe('Impuesto "Adicional"');
    });

    it('un ítem exento con adicionales lleva los adicionales SIN IVA', async () => {
      mockItems(
        { clasificacionTributaria: 'exento' },
        { impuestosIds: ['imp-2'], descuentosIds: [], recargosIds: [] },
      );
      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });
      expect(r.lineas[0].trazas.impuestos.map((i) => i.id)).toEqual(['imp-2']);
    });

    it('una línea que pisa los impuestos con [] igual lleva el IVA si el ítem es afecto', async () => {
      mockItems({}, { impuestosIds: [], descuentosIds: [], recargosIds: [] });
      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1', impuestoIds: [] }],
      });
      expect(r.lineas[0].trazas.impuestos.map((i) => i.id)).toEqual(['imp-1']);
    });

    it('una clasificación null no deriva IVA', async () => {
      // Un ingrediente: no tiene tratamiento fiscal. Fija el `=== 'afecto'`
      // contra el `!== 'exento'`, que con null derivaría IVA.
      mockItems(
        { clasificacionTributaria: null },
        { impuestosIds: [], descuentosIds: [], recargosIds: [] },
      );
      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });
      expect(r.lineas[0].trazas.impuestos).toEqual([]);
    });

    it('un ítem afecto sin IVA en el país revienta en vez de vender sin IVA', async () => {
      impuestosService.findAll.mockResolvedValue([
        {
          id: 'imp-2',
          nombre: 'Adicional',
          porcentaje: '0.10',
          tipo: 'otro',
          activo: true,
        },
      ]);
      mockItems({}, { impuestosIds: [], descuentosIds: [], recargosIds: [] });
      await expect(
        service.calcular(TENANT, {
          lineas: [{ itemId: 'item-1', cantidad: '1' }],
        }),
      ).rejects.toThrow(/afecto a IVA/);
    });

    it('un item_impuestos con el IVA viejo no lo cobra dos veces', async () => {
      // Defensa contra datos previos a este cambio: item_impuestos = [IVA, OTRO]
      mockItems(
        {},
        {
          impuestosIds: ['imp-1', 'imp-2'],
          descuentosIds: [],
          recargosIds: [],
        },
      );
      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });
      expect(r.lineas[0].trazas.impuestos.map((i) => i.id)).toEqual([
        'imp-2',
        'imp-1',
      ]);
    });

    // I-2 (revisión independiente, ronda 1): antes del fix, un ítem afecto
    // con precio bruto-inclusivo y sin item_impuestos tenía `impuestos: []`
    // → el motor nunca desbruteaba (`netoUnitario = bruto`) ni generaba
    // traza fiscal. Ahora el IVA se deriva igual por acá, así que el motor
    // SÍ desbrutea sobre la tasa derivada — mismo código de
    // `calculo-precios.engine.ts:332-338`, sin cambios, pero ahora alcanzado
    // por un camino que antes nunca le pasaba impuestos. Va a nivel
    // servicio (no engine.spec, que arma `impuestos` a mano y por
    // construcción es ciego a la derivación) porque es el único nivel que
    // ejercita la derivación real sin inventar infraestructura nueva.
    it('un ítem afecto con precioIncluyeImpuesto y sin impuestos asociados desbrutea sobre el IVA derivado', async () => {
      mockItems(
        { precioIncluyeImpuesto: true },
        { impuestosIds: [], descuentosIds: [], recargosIds: [] },
      );
      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });
      // precioBase 100, bruto-inclusivo, IVA 0.19 derivado: neto = 100/1.19.
      //
      // Los valores cambiaron cuando el motor empezó a cuantizar en la escala
      // de la moneda: antes eran '84.033613' y '15.966386' —el cálculo crudo a
      // `escalaCalculo: 6`, que sumaba 99.999999 y dejaba el último redondeo en
      // manos del cast a NUMERIC(18,4) de Postgres—. La moneda de este mock
      // tiene 4 decimales (`decimalesOficiales` mockeado en 4), así que el neto
      // cierra en 84.0336. La cuantización cambia el VALOR, no el formato: los
      // strings siguen teniendo los 6 decimales de `escalaCalculo`.
      //
      // El IVA ya NO sale de 84.0336 × 0.19: desde que el desbruteo cierra a
      // góndola, la línea sin reglas declara como impuesto lo que sobra sobre
      // el neto (100 − 84.0336). Acá el número no se movió —las dos cuentas dan
      // 15.9664— y por eso el esperado sigue igual; lo que cambió es de dónde
      // viene. El caso donde sí difieren es CLP sin centavos ($993 → IVA 159 y
      // no 158), y lo cubre `calculo-precios.engine.spec.ts`.
      expect(r.lineas[0].subtotalNeto).toBe('84.033600');
      expect(r.lineas[0].impuestoAplicado).toBe('15.966400');
      // Y ahora el desbruteo cierra: neto + IVA = el bruto que entró.
      expect(r.lineas[0].totalLinea).toBe('100.000000');
      expect(r.lineas[0].trazas.impuestos).toEqual([
        expect.objectContaining({ id: 'imp-1', tasa: '0.19' }),
      ]);
    });

    it('rechaza el IVA mandado explícito en una línea', async () => {
      // El IVA no entra por payload, mismo contrato que POST/PATCH /items
      // (`validarImpuestos`, ADR-018): imp-1 es tipo 'iva' en el catálogo
      // mockeado del beforeEach.
      await expect(
        service.calcular(TENANT, {
          lineas: [{ itemId: 'item-1', cantidad: '1', impuestoIds: ['imp-1'] }],
        }),
      ).rejects.toThrow(
        'El IVA no se asigna por ítem ni por línea: sale de la clasificación tributaria',
      );
    });
  });

  describe('el estado fiscal de la línea viaja al motor', () => {
    /**
     * ADR-018 resuelve la clasificación acá y el motor **no puede
     * reconstruirla**: una línea sin IVA puede ser un ítem exento, pero también
     * un ingrediente con la columna en `NULL`. El prorrateo del descuento de
     * nivel venta reparte contra la base afecta y la exenta por separado
     * —el DTE las declara separadas— así que necesita el estado fiscal, no la
     * lista de impuestos.
     *
     * El `null` se afirma explícitamente: rellenarlo con `'afecto'` es
     * exactamente el bug que `ventas.service` ya se cuida de no cometer al
     * escribir el snapshot de `venta_detalles`.
     */
    it('le pasa a calcularVenta la clasificación de cada línea, sin coercionar el null', async () => {
      const porItem: Record<string, string | null> = {
        'item-afecto': 'afecto',
        'item-exento': 'exento',
        'item-ingrediente': null,
      };
      itemsService.cargarBasePorIds.mockImplementation(
        (_t: string, ids: string[]) =>
          Promise.resolve(
            new Map(
              ids.map((id) => [
                id,
                base({ id, clasificacionTributaria: porItem[id] }),
              ]),
            ),
          ),
      );
      itemsService.cargarReglasPorIds.mockImplementation(
        (_t: string, ids: string[]) =>
          Promise.resolve(
            new Map(
              ids.map((id) => [
                id,
                reglas({
                  impuestosIds: [],
                  descuentosIds: [],
                  recargosIds: [],
                }),
              ]),
            ),
          ),
      );

      const spy = jest.spyOn(engine, 'calcularVenta');
      await service.calcular(TENANT, {
        lineas: Object.keys(porItem).map((itemId) => ({
          itemId,
          cantidad: '1',
        })),
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(
        spy.mock.calls[0][0].lineas.map((l) => [
          l.itemId,
          l.clasificacionTributaria,
        ]),
      ).toEqual([
        ['item-afecto', 'afecto'],
        ['item-exento', 'exento'],
        ['item-ingrediente', null],
      ]);
      spy.mockRestore();
    });
  });

  describe('vigencia por fecha', () => {
    // Forma copiada del mock de `descuentosService.findAll` de arriba: mismos
    // campos que ya usa el resto del archivo, sumando `fechaInicio`/`fechaFin`
    // (Task 1 / entidad `Descuento`). `desc-1` es el id que ya trae por
    // default `reglas()` en `descuentoIds`, así que no hace falta tocar el
    // mock de `itemsService.cargarReglasPorIds`.
    const reglaConVigencia = (over: Record<string, unknown> = {}) => ({
      id: 'desc-1',
      nombre: 'Promo verano',
      modo: 'porcentaje',
      valorPorcentaje: '0.10',
      tipoRegla: { codigo: 'general' },
      tramos: [],
      metodoPagoIds: [],
      activo: true,
      nivel: 'linea',
      fechaInicio: null,
      fechaFin: null,
      ...over,
    });

    // Las fechas del test son fijas: el instante entra por el service, nunca
    // se afirma contra `new Date()` del runner — se pisa `fechaLocalTenant`
    // (que ya vive mockeada en el `beforeEach` de arriba) con el valor fijo
    // que cada test necesita.
    it('una regla cuyo rango ya pasó llega al motor con vigente = false', async () => {
      // Fecha local del tenant: 2026-03-05. Rango: diciembre a enero.
      // Sin este chequeo la promo de verano descuenta en marzo.
      jest
        .spyOn(rangoFechaUtil, 'fechaLocalTenant')
        .mockResolvedValue('2026-03-05');
      descuentosService.findAll.mockResolvedValue([
        reglaConVigencia({
          fechaInicio: '2025-12-01',
          fechaFin: '2026-01-31',
        }),
      ]);

      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });

      // Fuera de rango: no aplica, ni traza ni descuenta.
      expect(r.lineas[0].descuentoAplicado).toBe('0.000000');
    });

    it('una regla dentro del rango llega con vigente = true', async () => {
      jest
        .spyOn(rangoFechaUtil, 'fechaLocalTenant')
        .mockResolvedValue('2026-03-05');
      descuentosService.findAll.mockResolvedValue([
        reglaConVigencia({
          fechaInicio: '2026-03-01',
          fechaFin: '2026-03-31',
        }),
      ]);

      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });

      expect(r.lineas[0].descuentoAplicado).toBe('10.000000'); // 100 * 0.10
    });

    it('el primer día y el último día están DENTRO (bordes inclusivos)', async () => {
      descuentosService.findAll.mockResolvedValue([
        reglaConVigencia({
          fechaInicio: '2026-03-01',
          fechaFin: '2026-03-31',
        }),
      ]);
      const aplicadoEn = async (fechaLocal: string) => {
        jest
          .spyOn(rangoFechaUtil, 'fechaLocalTenant')
          .mockResolvedValue(fechaLocal);
        const r = await service.calcular(TENANT, {
          lineas: [{ itemId: 'item-1', cantidad: '1' }],
        });
        return r.lineas[0].descuentoAplicado;
      };

      // El primer día del rango: fechaInicio === fechaLocal. DENTRO.
      expect(await aplicadoEn('2026-03-01')).toBe('10.000000');
      // El último día del rango: fechaFin === fechaLocal. DENTRO.
      expect(await aplicadoEn('2026-03-31')).toBe('10.000000');
      // Un día antes / un día después del rango: FUERA. Sin este par, un
      // mutante que fije `vigente: true` (o que cambie `<=` por `<`) pasa
      // igual: los dos casos DENTRO de arriba no lo distinguen porque ya
      // eran `true` de verdad.
      expect(await aplicadoEn('2026-02-28')).toBe('0.000000');
      expect(await aplicadoEn('2026-04-01')).toBe('0.000000');
    });

    it('una regla sin fechas está vigente siempre', async () => {
      jest
        .spyOn(rangoFechaUtil, 'fechaLocalTenant')
        .mockResolvedValue('2026-03-05');
      descuentosService.findAll.mockResolvedValue([reglaConVigencia()]);

      const r = await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });

      expect(r.lineas[0].descuentoAplicado).toBe('10.000000');
    });
  });

  // ─── promociones ──────────────────────────────────────────────────────────
  //
  // El evaluador NO se mockea: es puro, y mockearlo dejaría sin probar
  // justamente lo que este service arma para él (los netos, el índice, la
  // categoría y —lo que más importa— el instante de cada línea). Lo que sí se
  // observa es qué recibe el motor, porque la aplicación del monto es Task 7.

  describe('promociones', () => {
    /** Happy hour 20% sobre toda la venta, 18:00–20:00 en zona del tenant. */
    const promoHappyHour = (over: Record<string, unknown> = {}) => ({
      id: 'promo-1',
      nombre: 'Happy Hour',
      tipo: 'porcentaje',
      valorPorcentaje: '0.2000',
      cadaN: null,
      valorMonto: null,
      ventana: {
        fechaInicio: '2026-01-01',
        fechaFin: '2026-12-31',
        horaInicio: '18:00',
        horaFin: '20:00',
        diasSemana: null,
        canal: null,
        ...((over.ventana as Record<string, unknown>) ?? {}),
      },
      scopes: [
        {
          slot: 0,
          tipoScope: 'venta',
          categoriaId: null,
          cantidad: 1,
          itemIds: [],
        },
      ],
    });

    /** Lo que `calcularVenta` recibió: la lista de aplicaciones ya resueltas. */
    const promocionesQueVieronElMotor = () =>
      (
        calcularVentaSpy.mock.calls[0][0] as {
          promociones: { promocionId: string; montosPorLinea: unknown[] }[];
        }
      ).promociones;

    let calcularVentaSpy: jest.SpyInstance;

    beforeEach(() => {
      // Zona fija: los instantes de las líneas se colapsan con ella, y sin
      // fijarla el test dependería de la zona del runner.
      jest.spyOn(rangoFechaUtil, 'zonaHorariaTenant').mockResolvedValue('UTC');
      calcularVentaSpy = jest.spyOn(engine, 'calcularVenta');
      // Los espías sobreviven entre tests (el proyecto no usa `clearMocks`), y
      // sin esto `mock.calls[0]` sería la llamada del PRIMER test del bloque.
      jest.clearAllMocks();
      jest.useFakeTimers().setSystemTime(new Date('2026-06-15T19:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('carga las promos con la fecha local del tenant', async () => {
      await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });

      expect(promocionesService.cargarVigentes).toHaveBeenCalledWith(
        TENANT,
        '2026-01-01', // lo que devuelve el mock de `fechaLocalTenant`
      );
    });

    // Un tenant sin promos no paga NADA por esta feature: ni la zona horaria,
    // ni las líneas de la cuenta, ni el evaluador.
    it('sin promos vigentes no resuelve instantes ni consulta la cuenta', async () => {
      await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });

      expect(rangoFechaUtil.zonaHorariaTenant).not.toHaveBeenCalled();
      expect(promocionesQueVieronElMotor()).toEqual([]);
    });

    it('con una promo vigente el motor recibe la aplicación evaluada', async () => {
      promocionesService.cargarVigentes.mockResolvedValue([promoHappyHour()]);

      await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });

      expect(promocionesQueVieronElMotor()).toEqual([
        {
          promocionId: 'promo-1',
          nombre: 'Happy Hour',
          tipo: 'porcentaje',
          valorEfectivo: '0.2000',
          // 20% de 100 (el precio ya convertido a moneda oficial).
          montosPorLinea: [{ lineaIndex: 0, monto: '20' }],
        },
      ]);
    });

    it('el neto que se evalúa es el convertido a moneda oficial', async () => {
      promocionesService.cargarVigentes.mockResolvedValue([promoHappyHour()]);
      mockItems({ precioBase: '10', monedaId: 'moneda-usd' }); // tasa 950

      await service.calcular(TENANT, {
        lineas: [{ itemId: 'item-1', cantidad: '1' }],
      });

      expect(promocionesQueVieronElMotor()[0].montosPorLinea).toEqual([
        { lineaIndex: 0, monto: '1900' }, // 20% de 9.500
      ]);
    });

    describe('instante por línea', () => {
      it('sin cuentaId todas las líneas evalúan con "ahora"', async () => {
        promocionesService.cargarVigentes.mockResolvedValue([promoHappyHour()]);

        await service.calcular(TENANT, {
          lineas: [
            { itemId: 'item-1', cantidad: '1' },
            { itemId: 'item-2', cantidad: '1' },
          ],
        });

        // 19:00 UTC cae en la franja: las DOS líneas entran.
        expect(promocionesQueVieronElMotor()[0].montosPorLinea).toEqual([
          { lineaIndex: 0, monto: '20' },
          { lineaIndex: 1, monto: '20' },
        ]);
      });

      // El contrato de la spec: el instante sale de la BD (el `creado_el` de la
      // línea de cuenta), jamás del body. Acá se prueba que dos líneas de la
      // misma venta evalúan con instantes DISTINTOS — que es lo que separa
      // "cuándo se pidió" de "cuándo se cobra".
      it('con cuentaId cada línea usa el creado_el de su línea de cuenta', async () => {
        promocionesService.cargarVigentes.mockResolvedValue([promoHappyHour()]);
        db.query.mockImplementation((sql: string) => {
          if (sql.includes('FROM cuentas')) {
            return Promise.resolve([
              { abierta_el: new Date('2026-06-15T19:00:00Z') },
            ]);
          }
          return Promise.resolve([
            // pedida a las 19:00 → DENTRO de la franja
            {
              item_id: 'item-1',
              creado_el: new Date('2026-06-15T19:00:00Z'),
            },
            // pedida a las 21:00 → FUERA
            {
              item_id: 'item-2',
              creado_el: new Date('2026-06-15T21:00:00Z'),
            },
          ]);
        });

        await service.calcular(TENANT, {
          cuentaId: CUENTA_ID,
          lineas: [
            { itemId: 'item-1', cantidad: '1' },
            { itemId: 'item-2', cantidad: '1' },
          ],
        });

        expect(promocionesQueVieronElMotor()[0].montosPorLinea).toEqual([
          { lineaIndex: 0, monto: '20' },
        ]);
      });

      // Una línea agregada en el cobro (no está en la cuenta) usa "ahora": el
      // fallback no puede ser "sin instante", porque entonces la promo no
      // aplicaría a algo que el cliente sí acaba de pedir.
      it('una línea del DTO sin fila de cuenta usa "ahora"', async () => {
        promocionesService.cargarVigentes.mockResolvedValue([promoHappyHour()]);
        db.query.mockImplementation((sql: string) =>
          Promise.resolve(
            sql.includes('FROM cuentas')
              ? [{ abierta_el: new Date('2026-06-15T19:00:00Z') }]
              : [
                  {
                    item_id: 'item-1',
                    creado_el: new Date('2026-06-15T21:00:00Z'), // FUERA
                  },
                ],
          ),
        );

        await service.calcular(TENANT, {
          cuentaId: CUENTA_ID,
          lineas: [
            { itemId: 'item-1', cantidad: '1' },
            { itemId: 'item-2', cantidad: '1' }, // sin fila: "ahora" = 19:00
          ],
        });

        expect(promocionesQueVieronElMotor()[0].montosPorLinea).toEqual([
          { lineaIndex: 1, monto: '20' },
        ]);
      });

      // Las líneas de cuenta se consumen POR ORDEN dentro del mismo ítem: dos
      // líneas del mismo producto pedidas en momentos distintos no pueden
      // colapsar en el instante de la primera.
      it('dos líneas del mismo ítem consumen sus filas por orden', async () => {
        promocionesService.cargarVigentes.mockResolvedValue([promoHappyHour()]);
        db.query.mockImplementation((sql: string) =>
          Promise.resolve(
            sql.includes('FROM cuentas')
              ? [{ abierta_el: new Date('2026-06-15T19:00:00Z') }]
              : [
                  {
                    item_id: 'item-1',
                    creado_el: new Date('2026-06-15T19:00:00Z'), // DENTRO
                  },
                  {
                    item_id: 'item-1',
                    creado_el: new Date('2026-06-15T21:00:00Z'), // FUERA
                  },
                ],
          ),
        );

        await service.calcular(TENANT, {
          cuentaId: CUENTA_ID,
          lineas: [
            { itemId: 'item-1', cantidad: '1' },
            { itemId: 'item-1', cantidad: '1' },
          ],
        });

        expect(promocionesQueVieronElMotor()[0].montosPorLinea).toEqual([
          { lineaIndex: 0, monto: '20' },
        ]);
      });

      // La zona se resuelve UNA vez para todas las líneas: `instanteLocalTenant`
      // por línea sería un viaje a `tenants` por cada producto de la cuenta.
      it('resuelve la zona horaria una sola vez', async () => {
        promocionesService.cargarVigentes.mockResolvedValue([promoHappyHour()]);
        db.query.mockImplementation((sql: string) =>
          Promise.resolve(
            sql.includes('FROM cuentas')
              ? [{ abierta_el: new Date('2026-06-15T19:00:00Z') }]
              : [
                  { item_id: 'item-1', creado_el: new Date() },
                  { item_id: 'item-2', creado_el: new Date() },
                  { item_id: 'item-3', creado_el: new Date() },
                ],
          ),
        );

        await service.calcular(TENANT, {
          cuentaId: CUENTA_ID,
          lineas: [
            { itemId: 'item-1', cantidad: '1' },
            { itemId: 'item-2', cantidad: '1' },
            { itemId: 'item-3', cantidad: '1' },
          ],
        });

        expect(rangoFechaUtil.zonaHorariaTenant).toHaveBeenCalledTimes(1);
      });
    });

    describe('canal', () => {
      it('el default es fisico: una promo de canal físico aplica', async () => {
        promocionesService.cargarVigentes.mockResolvedValue([
          promoHappyHour({ ventana: { canal: 'fisico' } }),
        ]);

        await service.calcular(TENANT, {
          lineas: [{ itemId: 'item-1', cantidad: '1' }],
        });

        expect(promocionesQueVieronElMotor()).toHaveLength(1);
      });

      it("canal 'online' descarta la promo de canal físico", async () => {
        promocionesService.cargarVigentes.mockResolvedValue([
          promoHappyHour({ ventana: { canal: 'fisico' } }),
        ]);

        await service.calcular(TENANT, {
          canal: 'online',
          lineas: [{ itemId: 'item-1', cantidad: '1' }],
        });

        expect(promocionesQueVieronElMotor()).toEqual([]);
      });
    });

    // El interruptor es parte del congelado: sin él en `config_calculo`, una
    // venta vieja no se puede reinterpretar (el mismo monto de promo da otro
    // total según si el descuento de catálogo convivía o no).
    it('cargarConfig incluye promosAcumulanDescuentos', async () => {
      tenantsService.getPreferenciasFinancieras.mockResolvedValue({
        ...prefs,
        promosAcumulanDescuentos: true,
      });

      expect(await service.cargarConfig(TENANT, 4)).toMatchObject({
        promosAcumulanDescuentos: true,
      });
    });
  });
});
