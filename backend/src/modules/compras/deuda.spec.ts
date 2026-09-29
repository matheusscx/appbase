import Decimal from 'decimal.js';
import type { ConfigCalculo } from '../calculo-precios/calculo-precios.engine';
import {
  PLAZO_PAGO_DIAS_DEFAULT,
  estadoPagoCompra,
  fondear,
  recortar,
  totalCompra,
  vencimiento,
} from './deuda';

const cfgCLP = {
  formula: ['descuentos', 'recargos', 'impuestos'],
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  escalaCalculo: 4,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  promosAcumulanDescuentos: false,
  decimalesMoneda: 0,
} as unknown as ConfigCalculo;

const cfgUSD = {
  ...cfgCLP,
  decimalesMoneda: 2,
};

describe('vencimiento (spec compras-deuda-proveedor § 4.2)', () => {
  it('el 1 de octubre + 15 días de plazo vence el 16', () => {
    expect(vencimiento('2026-10-01', 15, null)).toBe('2026-10-16');
  });

  it('sin plazo cargado (null), el default es 30 días — la ley 19.983', () => {
    expect(PLAZO_PAGO_DIAS_DEFAULT).toBe(30);
    expect(vencimiento('2026-10-01', null, null)).toBe('2026-10-31');
  });

  it('la fecha tipeada manda, aunque haya plazo', () => {
    expect(vencimiento('2026-10-01', 15, '2026-12-25')).toBe('2026-12-25');
  });

  it('cruza de mes y de año correctamente', () => {
    expect(vencimiento('2026-12-20', 30, null)).toBe('2027-01-19');
  });
});

describe('totalCompra (spec § 4.1 y § 14: cuantización única)', () => {
  it('Σ cantidad × precio − descuento, sin decimales de más', () => {
    expect(
      totalCompra(
        [
          { cantidad: '10', precioUnitario: '1500' },
          { cantidad: '5', precioUnitario: '2000' },
        ],
        null,
        cfgCLP,
      ),
    ).toBe('25000');
  });

  it('resta el descuento antes de cuantizar', () => {
    expect(
      totalCompra([{ cantidad: '10', precioUnitario: '1500' }], '1000', cfgCLP),
    ).toBe('14000');
  });

  it('null si falta el precio de alguna línea', () => {
    expect(
      totalCompra(
        [
          { cantidad: '10', precioUnitario: '1500' },
          { cantidad: '5', precioUnitario: null },
        ],
        null,
        cfgCLP,
      ),
    ).toBeNull();
  });

  it('null sin líneas', () => {
    expect(totalCompra([], null, cfgCLP)).toBeNull();
  });

  it('un total con decimales de más se cuantiza UNA vez con el modo del tenant (HALF_UP, CLP → 0 decimales)', () => {
    // 10 × 1500.5555 = 15005.555 → HALF_UP a 0 decimales = 15006
    expect(
      totalCompra(
        [{ cantidad: '10', precioUnitario: '1500.5555' }],
        null,
        cfgCLP,
      ),
    ).toBe('15006');
  });

  it('con una moneda de 2 decimales, cuantiza a esa escala', () => {
    expect(
      totalCompra([{ cantidad: '3', precioUnitario: '10.005' }], null, cfgUSD),
    ).toBe(
      new Decimal('30.015')
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toString(),
    );
  });
});

describe('fondear (spec § 5.1 y § 11): saldo primero, más viejo primero, partición', () => {
  const PAGO_NUEVO = 'pago-nuevo';

  it('sin saldo a favor, todo sale del pago nuevo', () => {
    const { partes, sobranteNuevo } = fondear(
      [{ compraId: 'c1', monto: '1000' }],
      [],
      '1000',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: PAGO_NUEVO, monto: '1000' },
    ]);
    expect(sobranteNuevo).toBe('0');
  });

  it('con saldo a favor suficiente, no toca el pago nuevo', () => {
    const { partes, sobranteNuevo } = fondear(
      [{ compraId: 'c1', monto: '400' }],
      [{ pagoId: 'p-viejo', disponible: '400' }],
      '1000',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '400' },
    ]);
    expect(sobranteNuevo).toBe('1000');
  });

  it('el saldo a favor se consume del pago MÁS VIEJO primero (el array ya viene ordenado así)', () => {
    const { partes } = fondear(
      [{ compraId: 'c1', monto: '150' }],
      [
        { pagoId: 'p-viejo', disponible: '100' },
        { pagoId: 'p-nuevo-de-los-dos', disponible: '100' },
      ],
      '0',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '100' },
      { compraId: 'c1', pagoId: 'p-nuevo-de-los-dos', monto: '50' },
    ]);
  });

  it('una aplicación puede partirse en dos: saldo a favor + el pago nuevo', () => {
    const { partes, sobranteNuevo } = fondear(
      [{ compraId: 'c1', monto: '150' }],
      [{ pagoId: 'p-viejo', disponible: '100' }],
      '50',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '100' },
      { compraId: 'c1', pagoId: PAGO_NUEVO, monto: '50' },
    ]);
    expect(sobranteNuevo).toBe('0');
  });

  it('varias aplicaciones consumen las fuentes EN EL ORDEN pedido, cada una hasta agotarse', () => {
    const { partes, sobranteNuevo } = fondear(
      [
        { compraId: 'c1', monto: '80' },
        { compraId: 'c2', monto: '80' },
      ],
      [{ pagoId: 'p-viejo', disponible: '100' }],
      '100',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '80' },
      { compraId: 'c2', pagoId: 'p-viejo', monto: '20' },
      { compraId: 'c2', pagoId: PAGO_NUEVO, monto: '60' },
    ]);
    expect(sobranteNuevo).toBe('40');
  });

  it('monto 0 con aplicaciones: usa el saldo a favor y no crea partes del pago nuevo', () => {
    const { partes, sobranteNuevo } = fondear(
      [{ compraId: 'c1', monto: '30' }],
      [{ pagoId: 'p-viejo', disponible: '100' }],
      '0',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '30' },
    ]);
    expect(sobranteNuevo).toBe('0');
  });

  it('sin aplicaciones, todo el monto nuevo queda a favor (anticipo)', () => {
    const { partes, sobranteNuevo } = fondear([], [], '500', PAGO_NUEVO);
    expect(partes).toEqual([]);
    expect(sobranteNuevo).toBe('500');
  });

  it('una fuente agotada no deja una parte en cero', () => {
    const { partes } = fondear(
      [{ compraId: 'c1', monto: '100' }],
      [{ pagoId: 'p-viejo', disponible: '100' }],
      '0',
      PAGO_NUEVO,
    );
    expect(partes).toEqual([
      { compraId: 'c1', pagoId: 'p-viejo', monto: '100' },
    ]);
  });

  it('pedir más de lo disponible (saldo + monto) revienta: el caller valida esto ANTES', () => {
    expect(() =>
      fondear(
        [{ compraId: 'c1', monto: '1000' }],
        [{ pagoId: 'p-viejo', disponible: '100' }],
        '100',
        PAGO_NUEVO,
      ),
    ).toThrow();
  });
});

describe('recortar (spec § 6)', () => {
  const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);

  it('el total sube y no toca nada: las dos listas vuelven vacías', () => {
    const r = recortar(
      [{ aplicacionId: 'a1', pagoId: 'p1', monto: '100', creadoEl: hace(1) }],
      '150',
    );
    expect(r).toEqual({ aBorrar: [], aReducir: [] });
  });

  it('el aplicado es igual al total nuevo: tampoco toca nada (el borde no es "supera")', () => {
    const r = recortar(
      [{ aplicacionId: 'a1', pagoId: 'p1', monto: '100', creadoEl: hace(1) }],
      '100',
    );
    expect(r).toEqual({ aBorrar: [], aReducir: [] });
  });

  it('recorta de la MÁS NUEVA primero', () => {
    const r = recortar(
      [
        {
          aplicacionId: 'vieja',
          pagoId: 'p1',
          monto: '100',
          creadoEl: hace(10),
        },
        {
          aplicacionId: 'nueva',
          pagoId: 'p2',
          monto: '100',
          creadoEl: hace(1),
        },
      ],
      '150',
    );
    // Solo hay que sacar 50, y la nueva sola alcanza: la vieja no se toca.
    expect(r.aBorrar).toEqual([]);
    expect(r.aReducir).toEqual([
      { aplicacionId: 'nueva', pagoId: 'p2', montoNuevo: '50' },
    ]);
  });

  it('baja a 0: todas las aplicaciones vivas se borran (decisión 6b, vía anular)', () => {
    const r = recortar(
      [
        { aplicacionId: 'a1', pagoId: 'p1', monto: '40', creadoEl: hace(5) },
        { aplicacionId: 'a2', pagoId: 'p2', monto: '60', creadoEl: hace(1) },
      ],
      '0',
    );
    expect(r.aBorrar.sort()).toEqual(['a1', 'a2']);
    expect(r.aReducir).toEqual([]);
  });

  it('recorta varias aplicaciones enteras antes de partir la última que toca', () => {
    const r = recortar(
      [
        { aplicacionId: 'a1', pagoId: 'p1', monto: '30', creadoEl: hace(30) },
        { aplicacionId: 'a2', pagoId: 'p2', monto: '40', creadoEl: hace(20) },
        { aplicacionId: 'a3', pagoId: 'p3', monto: '50', creadoEl: hace(10) },
      ],
      // Aplicado 120, total nuevo 45: hay que sacar 75. La más nueva (a3, 50)
      // se borra entera (50 <= 75), quedan 25 por sacar de a2 (40 -> 15).
      '45',
    );
    expect(r.aBorrar).toEqual(['a3']);
    expect(r.aReducir).toEqual([
      { aplicacionId: 'a2', pagoId: 'p2', montoNuevo: '15' },
    ]);
  });

  it('sin aplicaciones vivas, no hay nada que recortar', () => {
    expect(recortar([], '0')).toEqual({ aBorrar: [], aReducir: [] });
  });
});

describe('estadoPagoCompra (spec § 4.1)', () => {
  const base = { hoy: '2026-09-29', esSumaLineas: true };

  it('pagada: deuda 0', () => {
    const r = estadoPagoCompra({
      ...base,
      total: '100',
      aplicado: '100',
      fechaVencimiento: '2026-09-01',
    });
    expect(r).toEqual({
      estadoPago: 'pagada',
      deuda: '0',
      deudaMinima: null,
      vencida: false,
    });
  });

  it('parcial: aplicado > 0 y deuda > 0', () => {
    const r = estadoPagoCompra({
      ...base,
      total: '100',
      aplicado: '40',
      fechaVencimiento: null,
    });
    expect(r).toEqual({
      estadoPago: 'parcial',
      deuda: '60',
      deudaMinima: null,
      vencida: false,
    });
  });

  it('pendiente: sin aplicado', () => {
    const r = estadoPagoCompra({
      ...base,
      total: '100',
      aplicado: '0',
      fechaVencimiento: null,
    });
    expect(r.estadoPago).toBe('pendiente');
    expect(r.deuda).toBe('100');
  });

  it('vencida: queda deuda y ya pasó el vencimiento', () => {
    const r = estadoPagoCompra({
      ...base,
      total: '100',
      aplicado: '0',
      fechaVencimiento: '2026-09-01',
    });
    expect(r.vencida).toBe(true);
  });

  it('pagada nunca es vencida, aunque la fecha ya haya pasado', () => {
    const r = estadoPagoCompra({
      ...base,
      total: '100',
      aplicado: '100',
      fechaVencimiento: '2026-01-01',
    });
    expect(r.vencida).toBe(false);
  });

  it('el mismo día del vencimiento no es vencida (el borde es "<", no "<=")', () => {
    const r = estadoPagoCompra({
      ...base,
      total: '100',
      aplicado: '0',
      fechaVencimiento: '2026-09-29',
    });
    expect(r.vencida).toBe(false);
  });

  it('total desconocido en suma_lineas: falta_precio, deuda null', () => {
    const r = estadoPagoCompra({
      ...base,
      total: null,
      aplicado: '0',
      fechaVencimiento: null,
    });
    expect(r).toEqual({
      estadoPago: 'falta_precio',
      deuda: null,
      deudaMinima: null,
      vencida: false,
    });
  });

  it('sin totalMinimoConocido, falta_precio queda con deudaMinima null', () => {
    const r = estadoPagoCompra({
      ...base,
      total: null,
      aplicado: '0',
      fechaVencimiento: null,
    });
    expect(r.deudaMinima).toBeNull();
  });

  it('falta_precio: deudaMinima = totalMinimoConocido − aplicado, nunca negativa', () => {
    const r = estadoPagoCompra({
      ...base,
      total: null,
      aplicado: '20000',
      fechaVencimiento: null,
      totalMinimoConocido: '60000',
    });
    expect(r).toEqual({
      estadoPago: 'falta_precio',
      deuda: null,
      deudaMinima: '40000',
      vencida: false,
    });
  });

  it('falta_precio: pagado de más deja deudaMinima en 0, nunca negativa', () => {
    const r = estadoPagoCompra({
      ...base,
      total: null,
      aplicado: '90000',
      fechaVencimiento: null,
      totalMinimoConocido: '60000',
    });
    expect(r.deudaMinima).toBe('0');
  });

  it('falta_precio sin NINGUNA línea con precio: deudaMinima null, no "0" (decisión 8b, owner 2026-09-29)', () => {
    // El caller (compras.service.ts → totalMinimoConocido) manda `null`
    // cuando `bruto` es NULL — ninguna línea tiene precio, así que no hay
    // mínimo que mostrar: la pantalla dice solo "falta el precio".
    const r = estadoPagoCompra({
      ...base,
      total: null,
      aplicado: '0',
      fechaVencimiento: null,
      totalMinimoConocido: null,
    });
    expect(r.deudaMinima).toBeNull();
  });

  it('falta_precio con UNA línea de precio $0 (el regalo) + una sin precio: deudaMinima "0", SÍ es un mínimo conocido', () => {
    // Distinto del caso de arriba: acá SÍ hay una línea con precio (el
    // regalo, `precioUnitario: '0'`), así que `bruto` es `'0'`, no `null` —
    // `totalMinimoConocido` llega como `'0'`, y el mínimo conocido es real.
    const r = estadoPagoCompra({
      ...base,
      total: null,
      aplicado: '0',
      fechaVencimiento: null,
      totalMinimoConocido: '0',
    });
    expect(r.deudaMinima).toBe('0');
  });

  it('total desconocido en obligatorio/opcional: falta_total, sin deuda mínima (decisión 10)', () => {
    const r = estadoPagoCompra({
      hoy: '2026-09-29',
      esSumaLineas: false,
      total: null,
      aplicado: '0',
      fechaVencimiento: null,
      // Un `falta_total` no tiene mínimo aunque el llamador mande el bruto
      // de líneas: decisión 10, el neto de las líneas no es la deuda de una
      // factura.
      totalMinimoConocido: '60000',
    });
    expect(r.estadoPago).toBe('falta_total');
    expect(r.deudaMinima).toBeNull();
  });

  it('total desconocido y vencida: sigue marcando vencida', () => {
    const r = estadoPagoCompra({
      ...base,
      total: null,
      aplicado: '0',
      fechaVencimiento: '2026-01-01',
    });
    expect(r.vencida).toBe(true);
  });
});
