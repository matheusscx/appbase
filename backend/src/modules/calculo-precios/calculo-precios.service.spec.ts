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
  let tenantsService: { getPreferenciasFinancieras: jest.Mock };
  let monedasService: { findMonedas: jest.Mock };

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
          valor: '0.10',
          tipoRegla: { codigo: 'general' },
          tramos: [],
          metodoPagoIds: [],
          activo: true,
        },
        {
          id: 'desc-2',
          nombre: 'Otro 20%',
          modo: 'porcentaje',
          valor: '0.20',
          tipoRegla: { codigo: 'general' },
          tramos: [],
          metodoPagoIds: [],
          activo: true,
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
        { monedaId: 'moneda-clp', valorDelDia: '1', esDefault: true },
        { monedaId: 'moneda-usd', valorDelDia: '950.123456', esDefault: false },
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
      const config = await service.cargarConfig(TENANT);
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
        activo: true,
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
      expect(r.lineas[0].subtotalNeto).toBe('84.033613');
      expect(r.lineas[0].impuestoAplicado).toBe('15.966386');
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
});
