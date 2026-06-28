import {
  calcularVenta,
  type ConfigCalculo,
  type LineaResuelta,
  type ReglaResuelta,
  type VentaResuelta,
} from './calculo-precios.engine';

// ───────────────────────────────────────────────────────────────────────────
// Helpers para construir entradas resueltas de forma concisa
// ───────────────────────────────────────────────────────────────────────────

const config = (over: Partial<ConfigCalculo> = {}): ConfigCalculo => ({
  formula: ['descuentos', 'recargos', 'impuestos'],
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  escalaCalculo: 6,
  modoRedondeo: 'HALF_UP',
  ...over,
});

const regla = (over: Partial<ReglaResuelta> = {}): ReglaResuelta => ({
  id: 'r1',
  nombre: 'Regla',
  codigo: 'general',
  modo: 'porcentaje',
  valor: '0.10',
  tramos: [],
  metodoPagoIds: [],
  ...over,
});

const linea = (over: Partial<LineaResuelta> = {}): LineaResuelta => ({
  itemId: 'i1',
  cantidad: '1',
  precioUnitario: '100',
  precioIncluyeImpuesto: false,
  descuentos: [],
  recargos: [],
  impuestos: [],
  ...over,
});

const venta = (over: Partial<VentaResuelta> = {}): VentaResuelta => ({
  lineas: [linea()],
  metodoPagoId: null,
  descuentosVenta: [],
  recargosVenta: [],
  config: config(),
  ...over,
});

describe('calcularVenta (motor de cálculo de precios)', () => {
  describe('neto e impuestos', () => {
    it('sin reglas: total = precio × cantidad', () => {
      const r = calcularVenta(venta({ lineas: [linea({ cantidad: '2' })] }));
      expect(r.lineas[0].subtotalNeto).toBe('200.000000');
      expect(r.lineas[0].totalLinea).toBe('200.000000');
      expect(r.totales.totalFinal).toBe('200.000000');
    });

    it('aplica impuesto no incluido sobre el neto', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              cantidad: '2',
              impuestos: [{ id: 't1', nombre: 'IVA', porcentaje: '0.19' }],
            }),
          ],
        }),
      );
      expect(r.lineas[0].subtotalNeto).toBe('200.000000');
      expect(r.lineas[0].impuestoAplicado).toBe('38.000000');
      expect(r.lineas[0].totalLinea).toBe('238.000000');
    });

    it('desbrutea cuando precio incluye impuesto', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '119',
              precioIncluyeImpuesto: true,
              impuestos: [{ id: 't1', nombre: 'IVA', porcentaje: '0.19' }],
            }),
          ],
        }),
      );
      expect(r.lineas[0].subtotalNeto).toBe('100.000000');
      expect(r.lineas[0].impuestoAplicado).toBe('19.000000');
      expect(r.lineas[0].totalLinea).toBe('119.000000');
    });

    it('desbrutea con varios impuestos sumando tasas', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '130',
              precioIncluyeImpuesto: true,
              impuestos: [
                { id: 't1', nombre: 'IVA', porcentaje: '0.19' },
                { id: 't2', nombre: 'Extra', porcentaje: '0.11' },
              ],
            }),
          ],
        }),
      );
      // 130 / 1.30 = 100
      expect(r.lineas[0].subtotalNeto).toBe('100.000000');
      expect(r.lineas[0].impuestoAplicado).toBe('30.000000');
      expect(r.lineas[0].totalLinea).toBe('130.000000');
    });
  });

  describe('descuentos y recargos: base vs compuesto', () => {
    it('descuento porcentaje + impuesto en orden por defecto', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [regla({ valor: '0.10' })],
              impuestos: [{ id: 't1', nombre: 'IVA', porcentaje: '0.19' }],
            }),
          ],
        }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('10.000000'); // 100 * 0.10
      expect(r.lineas[0].impuestoAplicado).toBe('17.100000'); // 90 * 0.19
      expect(r.lineas[0].totalLinea).toBe('107.100000');
    });

    it('base: cada descuento sobre el neto', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [
                regla({ id: 'a', valor: '0.10' }),
                regla({ id: 'b', valor: '0.10' }),
              ],
            }),
          ],
          config: config({ calculoDescuentos: 'base' }),
        }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('20.000000'); // 10 + 10
      expect(r.lineas[0].totalLinea).toBe('80.000000');
    });

    it('compuesto: descuentos en cascada', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [
                regla({ id: 'a', valor: '0.10' }),
                regla({ id: 'b', valor: '0.10' }),
              ],
            }),
          ],
          config: config({ calculoDescuentos: 'compuesto' }),
        }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('19.000000'); // 10 + 9
      expect(r.lineas[0].totalLinea).toBe('81.000000');
    });

    it('recargo monto fijo se aplica plano a la línea', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              recargos: [regla({ modo: 'monto_fijo', valor: '15' })],
            }),
          ],
        }),
      );
      expect(r.lineas[0].recargoAplicado).toBe('15.000000');
      expect(r.lineas[0].totalLinea).toBe('115.000000');
    });
  });

  describe('orden de fórmula configurable', () => {
    it('impuestos antes que descuentos cambia el resultado (compuesto)', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [regla({ valor: '0.10' })],
              impuestos: [{ id: 't1', nombre: 'IVA', porcentaje: '0.19' }],
            }),
          ],
          config: config({
            formula: ['impuestos', 'descuentos', 'recargos'],
            calculoDescuentos: 'compuesto',
          }),
        }),
      );
      // impuestos: 100 + 19 = 119 ; descuento compuesto sobre 119: 11.9 ; 107.1
      expect(r.lineas[0].impuestoAplicado).toBe('19.000000');
      expect(r.lineas[0].descuentoAplicado).toBe('11.900000');
      expect(r.lineas[0].totalLinea).toBe('107.100000');
    });
  });

  describe('tramos', () => {
    const tramos = [
      { minimo: '1', valor: '0.05' },
      { minimo: '10', valor: '0.10' },
    ];

    it('por_mayor elige el tramo por cantidad', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              cantidad: '12',
              descuentos: [regla({ codigo: 'por_mayor', valor: null, tramos })],
            }),
          ],
        }),
      );
      // subtotal 1200, cantidad 12 -> tramo minimo 10 -> 0.10 -> 120
      expect(r.lineas[0].descuentoAplicado).toBe('120.000000');
    });

    it('por_monto_venta elige el tramo por monto de línea', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              cantidad: '1',
              precioUnitario: '1200',
              descuentos: [
                regla({ codigo: 'por_monto_venta', valor: null, tramos }),
              ],
            }),
          ],
        }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('120.000000');
    });

    it('sin tramo aplicable -> monto 0', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              cantidad: '0.5',
              descuentos: [regla({ codigo: 'por_mayor', valor: null, tramos })],
            }),
          ],
        }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('0.000000');
    });
  });

  describe('filtro por método de pago', () => {
    const mp = regla({
      codigo: 'metodo_pago',
      valor: '0.05',
      metodoPagoIds: ['mp1'],
    });

    it('aplica cuando el método coincide', () => {
      const r = calcularVenta(
        venta({
          lineas: [linea({ descuentos: [mp] })],
          metodoPagoId: 'mp1',
        }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('5.000000');
    });

    it('no aplica cuando el método no coincide', () => {
      const r = calcularVenta(
        venta({
          lineas: [linea({ descuentos: [mp] })],
          metodoPagoId: 'mp2',
        }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('0.000000');
    });

    it('no aplica sin método en contexto', () => {
      const r = calcularVenta(
        venta({ lineas: [linea({ descuentos: [mp] })], metodoPagoId: null }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('0.000000');
    });
  });

  describe('reglas diferidas (fuera de alcance esta fase)', () => {
    it.each(['promocional', 'mora', 'pronto_pago'])(
      'codigo %s no se evalúa (monto 0)',
      (codigo) => {
        const r = calcularVenta(
          venta({
            lineas: [linea({ descuentos: [regla({ codigo, valor: '0.50' })] })],
          }),
        );
        expect(r.lineas[0].descuentoAplicado).toBe('0.000000');
      },
    );
  });

  describe('redondeo', () => {
    it('HALF_UP redondea hacia arriba en el límite', () => {
      const r = calcularVenta(
        venta({
          lineas: [linea({ descuentos: [regla({ valor: '0.12345' })] })],
          config: config({ escalaCalculo: 2, modoRedondeo: 'HALF_UP' }),
        }),
      );
      // 100 * 0.12345 = 12.345 -> 12.35
      expect(r.lineas[0].descuentoAplicado).toBe('12.35');
    });

    it('FLOOR trunca hacia abajo', () => {
      const r = calcularVenta(
        venta({
          lineas: [linea({ descuentos: [regla({ valor: '0.12345' })] })],
          config: config({ escalaCalculo: 2, modoRedondeo: 'FLOOR' }),
        }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('12.34');
    });
  });

  describe('reglas a nivel venta', () => {
    it('aplica descuento de venta sobre el neto agregado', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({ precioUnitario: '100' }),
            linea({ precioUnitario: '100' }),
          ],
          descuentosVenta: [regla({ valor: '0.10' })],
        }),
      );
      // neto agregado 200, descuento venta 20
      expect(r.totales.subtotalNeto).toBe('200.000000');
      expect(r.totales.totalDescuentos).toBe('20.000000');
      expect(r.totales.totalFinal).toBe('180.000000');
      expect(r.trazasVenta.descuentos[0].monto).toBe('20.000000');
    });

    it('respeta el orden de la fórmula a nivel venta (recargo antes, compuesto)', () => {
      const r = calcularVenta(
        venta({
          lineas: [linea({ precioUnitario: '100' })],
          descuentosVenta: [regla({ id: 'dv', valor: '0.10' })],
          recargosVenta: [regla({ id: 'rv', valor: '0.10' })],
          config: config({
            formula: ['recargos', 'descuentos', 'impuestos'],
            calculoDescuentos: 'compuesto',
            calculoRecargos: 'compuesto',
          }),
        }),
      );
      // recargo primero: 100 + 10 = 110 ; descuento compuesto sobre 110: 11 ; 99
      expect(r.trazasVenta.recargos[0].monto).toBe('10.000000');
      expect(r.trazasVenta.descuentos[0].monto).toBe('11.000000');
      expect(r.totales.totalFinal).toBe('99.000000');
    });
  });

  describe('totales y trazas', () => {
    it('agrega totales y deja trazas por regla', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [regla({ id: 'd1', nombre: 'Desc', valor: '0.10' })],
              impuestos: [{ id: 't1', nombre: 'IVA', porcentaje: '0.19' }],
            }),
          ],
        }),
      );
      expect(r.totales.subtotalNeto).toBe('100.000000');
      expect(r.totales.totalDescuentos).toBe('10.000000');
      expect(r.totales.totalImpuestos).toBe('17.100000');
      expect(r.lineas[0].trazas.descuentos).toEqual([
        { id: 'd1', nombre: 'Desc', monto: '10.000000' },
      ]);
      expect(r.lineas[0].trazas.impuestos).toEqual([
        { id: 't1', nombre: 'IVA', tasa: '0.19', monto: '17.100000' },
      ]);
    });
  });
});
