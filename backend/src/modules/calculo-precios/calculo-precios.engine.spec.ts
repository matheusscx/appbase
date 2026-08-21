import Decimal from 'decimal.js';
import {
  calcularVenta,
  cuantizar,
  type ConfigCalculo,
  type ImpuestoResuelto,
  type LineaResuelta,
  type ReglaResuelta,
  type ResultadoLinea,
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
  nivelRedondeo: 'linea',
  // 4 = el máximo que admite el sistema (UF). Con `escalaCalculo: 6`, cuantizar
  // a 4 y formatear a 6 deja igual a casi todos los casos de este archivo: por
  // eso las cifras siguen siendo las de antes de que el motor cuantizara.
  decimalesMoneda: 4,
  ...over,
});

/** CLP: sin centavos. `escalaCalculo` sigue en 6 — cuantizar no es formatear. */
const cfgCLP = config({ decimalesMoneda: 0 });

const regla = (over: Partial<ReglaResuelta> = {}): ReglaResuelta => ({
  id: 'r1',
  nombre: 'Regla',
  codigo: 'general',
  modo: 'porcentaje',
  valor: '0.10',
  tramos: [],
  metodoPagoIds: [],
  activo: true,
  ...over,
});

const impuesto = (over: Partial<ImpuestoResuelto> = {}): ImpuestoResuelto => ({
  id: 't1',
  nombre: 'IVA',
  porcentaje: '0.19',
  activo: true,
  tipo: 'iva',
  ...over,
});

const linea = (over: Partial<LineaResuelta> = {}): LineaResuelta => ({
  itemId: 'i1',
  cantidad: '1',
  precioUnitario: '100',
  precioIncluyeImpuesto: false,
  clasificacionTributaria: 'afecto',
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
              impuestos: [impuesto()],
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
              impuestos: [impuesto()],
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
                impuesto(),
                impuesto({ id: 't2', nombre: 'Extra', porcentaje: '0.11' }),
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
              impuestos: [impuesto()],
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

  /**
   * Criterio propio del proyecto (owner, 2026-08-11): **porcentajes antes que
   * montos fijos**, decidido tras la investigación de mercado —donde se vio que
   * no hay estándar que copiar: Toast y Square fijan órdenes opuestos—.
   *
   * El motor lo impone él mismo (`ordenarReglas`) y no lo hereda del `ORDER BY`
   * del llamador: así vale para los tres que arman listas de reglas (ventas,
   * salones, combos) sin que ninguno tenga que acordarse.
   */
  describe('orden de aplicación: porcentajes antes que montos fijos', () => {
    const pct = regla({ id: 'a', nombre: '20%', valor: '0.20' });
    const fijo = regla({
      id: 'b',
      nombre: 'Fijo 100',
      modo: 'monto_fijo',
      valor: '100',
    });

    const totalCon = (descuentos: ReglaResuelta[], calculoDescuentos: string) =>
      calcularVenta(
        venta({
          lineas: [linea({ precioUnitario: '1000', descuentos })],
          config: config({ calculoDescuentos }),
        }),
      );

    it('en `compuesto` el resultado NO depende de cómo venga la lista', () => {
      // Antes de esta regla, la lista tal como la devolvía la query decidía el
      // total: 700 en un orden y 720 en el otro. Ese es el bug que se cierra.
      expect(totalCon([pct, fijo], 'compuesto').totales.totalFinal).toBe(
        '700.000000',
      );
      expect(totalCon([fijo, pct], 'compuesto').totales.totalFinal).toBe(
        '700.000000',
      );
    });

    it('gana el 700 y no el 720: el porcentaje mira el precio sin descontar', () => {
      const r = totalCon([fijo, pct], 'compuesto');
      // 1000 × 20% = 200 (no 180, que sería sobre 900), y después el fijo.
      expect(r.lineas[0].trazas.descuentos[0].nombre).toBe('20%');
      expect(r.lineas[0].trazas.descuentos[0].monto).toBe('200.000000');
      expect(r.lineas[0].trazas.descuentos[1].nombre).toBe('Fijo 100');
      expect(r.lineas[0].trazas.descuentos[1].monto).toBe('100.000000');
    });

    it('en `base` el total ya era insensible al orden, y sigue igual', () => {
      // Control: `aplicarValor` ignora la base en `monto_fijo`, así que acá la
      // suma siempre fue conmutativa. Si este test se pusiera rojo, el orden
      // nuevo estaría cambiando algo que no tenía que tocar.
      expect(totalCon([pct, fijo], 'base').totales.totalFinal).toBe(
        '700.000000',
      );
      expect(totalCon([fijo, pct], 'base').totales.totalFinal).toBe(
        '700.000000',
      );
    });

    it('la traza respeta el orden aplicado, no el de entrada', () => {
      // El comprobante muestra las reglas en el orden en que se aplicaron: si
      // la traza siguiera el orden de entrada, el ticket contaría una historia
      // distinta de la del cálculo.
      const r = totalCon([fijo, pct], 'base');
      expect(r.lineas[0].trazas.descuentos.map((t) => t.nombre)).toEqual([
        '20%',
        'Fijo 100',
      ]);
    });

    it('vale también para los recargos', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '1000',
              recargos: [
                regla({
                  id: 'c',
                  nombre: 'Fijo 100',
                  modo: 'monto_fijo',
                  valor: '100',
                }),
                regla({ id: 'd', nombre: '5%', valor: '0.05' }),
              ],
            }),
          ],
          config: config({ calculoRecargos: 'compuesto' }),
        }),
      );
      // 5% sobre 1000 = 50 (no 55, que sería sobre 1100).
      expect(r.lineas[0].trazas.recargos[0].nombre).toBe('5%');
      expect(r.lineas[0].trazas.recargos[0].monto).toBe('50.000000');
      expect(r.lineas[0].totalLinea).toBe('1150.000000');
    });

    it('entre reglas del mismo modo, el orden de entrada se preserva', () => {
      // El sort es estable a propósito: el desempate sigue siendo el que trajo
      // el llamador. Se verifica en la traza porque en el total no se nota —dos
      // porcentajes componen multiplicativamente y dan lo mismo en cualquier
      // orden—, que es justo la razón por la que el desempate puede ser
      // arbitrario sin consecuencias.
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '1000',
              descuentos: [
                regla({ id: 'x', nombre: 'Primero', valor: '0.10' }),
                regla({ id: 'y', nombre: 'Segundo', valor: '0.30' }),
              ],
            }),
          ],
          config: config({ calculoDescuentos: 'compuesto' }),
        }),
      );
      expect(r.lineas[0].trazas.descuentos.map((t) => t.nombre)).toEqual([
        'Primero',
        'Segundo',
      ]);
    });
  });

  describe('orden de fórmula configurable', () => {
    it('impuestos antes que descuentos cambia el resultado (compuesto)', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [regla({ valor: '0.10' })],
              impuestos: [impuesto()],
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

  describe('reglas pausadas (activo = false)', () => {
    it('un descuento pausado no descuenta nada y avisa', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [regla({ nombre: 'Promo vieja', activo: false })],
            }),
          ],
        }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('0.000000');
      expect(r.lineas[0].totalLinea).toBe('100.000000');
      expect(r.lineas[0].advertencias).toEqual([
        {
          titulo: 'Descuento "Promo vieja"',
          detalle: 'está en pausa y no se aplicó',
        },
      ]);
    });

    // El control del test de arriba: sin esto, un motor que ignorara TODOS los
    // descuentos también lo pasaría.
    it('la misma regla activa sí descuenta', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [regla({ nombre: 'Promo vieja', activo: true })],
            }),
          ],
        }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('10.000000');
      expect(r.lineas[0].advertencias).toEqual([]);
    });

    it('la regla pausada no deja traza: no es un "aplicó 0"', () => {
      const r = calcularVenta(
        venta({ lineas: [linea({ descuentos: [regla({ activo: false })] })] }),
      );
      expect(r.lineas[0].trazas.descuentos).toEqual([]);
    });

    it('un recargo pausado avisa como recargo, no como descuento', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              recargos: [regla({ nombre: 'Recargo tarjeta', activo: false })],
            }),
          ],
        }),
      );
      expect(r.lineas[0].recargoAplicado).toBe('0.000000');
      expect(r.lineas[0].advertencias[0].titulo).toBe(
        'Recargo "Recargo tarjeta"',
      );
    });

    it('un impuesto pausado no se cobra y avisa', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              impuestos: [
                impuesto({ nombre: 'Impuesto verde', activo: false }),
              ],
            }),
          ],
        }),
      );
      expect(r.lineas[0].impuestoAplicado).toBe('0.000000');
      expect(r.lineas[0].totalLinea).toBe('100.000000');
      expect(r.lineas[0].advertencias[0].titulo).toBe(
        'Impuesto "Impuesto verde"',
      );
    });

    // El impuesto pausado tiene que salir de la lista ANTES de desbrutear: si
    // se filtrara recién al aplicarlo, su tasa seguiría inflando el divisor y
    // el neto quedaría mal aunque el impuesto no se cobre.
    it('el desbruteo no usa la tasa del impuesto pausado', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '119',
              precioIncluyeImpuesto: true,
              impuestos: [
                impuesto(),
                impuesto({ id: 't2', porcentaje: '0.11', activo: false }),
              ],
            }),
          ],
        }),
      );
      expect(r.lineas[0].subtotalNeto).toBe('100.000000');
      expect(r.lineas[0].impuestoAplicado).toBe('19.000000');
      expect(r.lineas[0].totalLinea).toBe('119.000000');
    });

    it('una regla de venta pausada avisa en advertenciasVenta', () => {
      const r = calcularVenta(
        venta({
          lineas: [linea({ precioUnitario: '100' })],
          descuentosVenta: [regla({ nombre: 'Cupón viejo', activo: false })],
        }),
      );
      expect(r.totales.totalFinal).toBe('100.000000');
      expect(r.trazasVenta.descuentos).toEqual([]);
      expect(r.advertenciasVenta).toEqual([
        {
          titulo: 'Descuento "Cupón viejo"',
          detalle: 'está en pausa y no se aplicó',
        },
      ]);
    });

    // El gemelo del de arriba, y no es simetría decorativa: el ensamblado del
    // resultado leía `dv.advertencias` (descuentos de venta) y descartaba
    // `rv.advertencias`. Un recargo de venta pausado bajaba la plata cobrada sin
    // traza, sin advertencia y sin nada en el comprobante — el mismo bug que
    // esta feature vino a cerrar, en la única rama que había quedado sin cubrir.
    it('un recargo de venta pausado también avisa en advertenciasVenta', () => {
      const r = calcularVenta(
        venta({
          lineas: [linea({ precioUnitario: '100' })],
          recargosVenta: [regla({ nombre: 'Recargo feriado', activo: false })],
        }),
      );
      expect(r.totales.totalFinal).toBe('100.000000');
      expect(r.trazasVenta.recargos).toEqual([]);
      expect(r.advertenciasVenta).toEqual([
        {
          titulo: 'Recargo "Recargo feriado"',
          detalle: 'está en pausa y no se aplicó',
        },
      ]);
      expect(r.advertencias).toEqual(r.advertenciasVenta);
    });

    /**
     * Decisión del owner (2026-08-11): el aviso de algo pausado es información
     * de **catálogo**, no de una línea. Diez líneas con el mismo impuesto
     * pausado daban diez toasts idénticos en el POS.
     */
    describe('avisos repetidos: uno por regla, no uno por línea', () => {
      const pausado = impuesto({ id: 'iva', activo: false });

      it('10 líneas con el mismo impuesto pausado dan UN aviso', () => {
        const r = calcularVenta(
          venta({
            lineas: Array.from({ length: 10 }, () =>
              linea({ impuestos: [pausado] }),
            ),
          }),
        );
        expect(r.advertencias).toEqual([
          { titulo: 'Impuesto "IVA"', detalle: 'está en pausa y no se aplicó' },
        ]);
      });

      it('pero cada línea conserva el suyo', () => {
        // El aplanado se deduplica; lo que se muestra pegado a cada línea no.
        // Si esto se pusiera rojo, el carrito dejaría de marcar las líneas
        // afectadas y el aviso quedaría solo arriba, sin decir cuáles son.
        const r = calcularVenta(
          venta({
            lineas: Array.from({ length: 3 }, () =>
              linea({ impuestos: [pausado] }),
            ),
          }),
        );
        expect(r.lineas.map((l) => l.advertencias.length)).toEqual([1, 1, 1]);
      });

      /**
       * El alcance de `sinRepetidas` es más ancho que "lo pausado" y eso es
       * deliberado: **también colapsa el aviso del tope**, que sí es por línea.
       * El criterio es el mismo — dos textos idénticos no dicen que hubo dos
       * eventos, así que repetirlos no informa— y lo que distingue las líneas
       * sigue siendo `ResultadoLinea.advertencias`, intacto.
       *
       * Está acá porque lo levantó la revisión independiente como posible
       * colapso indebido: queda como decisión escrita y no como efecto lateral.
       */
      it('también colapsa el aviso del tope, que es por línea', () => {
        const tope = regla({
          nombre: 'Fijo 500',
          modo: 'monto_fijo',
          valor: '500',
        });
        const r = calcularVenta(
          venta({
            lineas: [
              linea({ descuentos: [tope] }),
              linea({ descuentos: [tope] }),
            ],
          }),
        );
        expect(r.advertencias).toHaveLength(1);
        // Las dos líneas siguen marcadas, que es donde vive el "cuáles".
        expect(r.lineas.map((l) => l.advertencias.length)).toEqual([1, 1]);
      });

      it('dos reglas pausadas DISTINTAS siguen dando dos avisos', () => {
        // El control que evita que la deduplicación se pase de lista: colapsa
        // mensajes iguales, no reglas distintas.
        const r = calcularVenta(
          venta({
            lineas: [
              linea({
                impuestos: [
                  pausado,
                  impuesto({
                    id: 'otro',
                    nombre: 'Impuesto verde',
                    activo: false,
                  }),
                ],
              }),
            ],
          }),
        );
        expect(r.advertencias).toHaveLength(2);
      });
    });

    /**
     * El aviso decía "no se aplicó" en tenants cuya fórmula **no aplica
     * impuestos**, donde no se iba a aplicar de todos modos: describía la
     * fórmula y lo hacía pasar por una consecuencia de la pausa.
     */
    it('sin el paso `impuestos` en la fórmula, el impuesto pausado NO avisa', () => {
      const r = calcularVenta(
        venta({
          lineas: [linea({ impuestos: [impuesto({ activo: false })] })],
          config: config({ formula: ['descuentos', 'recargos'] }),
        }),
      );
      expect(r.advertencias).toEqual([]);
      expect(r.lineas[0].advertencias).toEqual([]);
    });
  });

  describe('piso en cero del descuento', () => {
    it('topea un monto_fijo que supera el neto y deja el total en 0, con advertencia', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [
                regla({ nombre: 'Fijo 500', modo: 'monto_fijo', valor: '500' }),
              ],
            }),
          ],
        }),
      );

      expect(r.lineas[0].totalLinea).toBe('0.000000');
      // La traza guarda lo APLICADO (100), no lo nominal (500): si guardara 500,
      // `subtotalNeto - totalDescuentos` no daría el total del comprobante.
      expect(r.lineas[0].descuentoAplicado).toBe('100.000000');
      expect(r.lineas[0].trazas.descuentos[0].monto).toBe('100.000000');
      expect(r.totales.totalFinal).toBe('0.000000');
      expect(r.advertencias).toEqual([
        {
          titulo: 'Descuento "Fijo 500"',
          detalle: 'no se aplicó completo porque superaba el monto disponible',
        },
      ]);
    });

    it('el comprobante cuadra al apilar descuentos que se pasan del neto', () => {
      // Tres del 40% en modo `base` = 120% del neto. Sin piso, total -200.
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [
                regla({ id: 'd1', nombre: 'A', valor: '0.40' }),
                regla({ id: 'd2', nombre: 'B', valor: '0.40' }),
                regla({ id: 'd3', nombre: 'C', valor: '0.40' }),
              ],
            }),
          ],
        }),
      );

      expect(r.lineas[0].totalLinea).toBe('0.000000');
      // 40 + 40 + 20 (el tercero topeado) = 100 = el neto exacto.
      expect(r.lineas[0].trazas.descuentos.map((t) => t.monto)).toEqual([
        '40.000000',
        '40.000000',
        '20.000000',
      ]);
      expect(r.lineas[0].descuentoAplicado).toBe('100.000000');
      expect(r.advertencias).toHaveLength(1);
    });

    it('un descuento que NO se pasa no genera advertencia ni cambia nada', () => {
      const r = calcularVenta(
        venta({ lineas: [linea({ descuentos: [regla({ valor: '0.10' })] })] }),
      );
      expect(r.lineas[0].descuentoAplicado).toBe('10.000000');
      expect(r.lineas[0].totalLinea).toBe('90.000000');
      expect(r.advertencias).toEqual([]);
    });

    it('el piso de venta mide contra el TOTAL, no contra el neto (con descuentos e impuestos de línea)', () => {
      // El test de abajo usaba una línea pelada, donde subtotalNeto == totalFinal:
      // el único escenario en que este bug es invisible. Acá la línea ya trae
      // descuento propio e IVA, así que el neto agregado (1000) y el total real
      // (119) son magnitudes distintas.
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '1000',
              descuentos: [regla({ nombre: 'Linea 90%', valor: '0.90' })],
              impuestos: [impuesto({ id: 'iva' })],
            }),
          ],
          descuentosVenta: [
            regla({ nombre: 'Venta 500', modo: 'monto_fijo', valor: '500' }),
          ],
        }),
      );

      expect(r.totales.totalFinal).toBe('0.000000');
      expect(r.advertencias.some((a) => a.titulo.includes('Venta 500'))).toBe(
        true,
      );
    });

    it('el piso de venta no recorta un descuento que el total sí aguanta', () => {
      // neto 1000 + IVA 19% = 1190 de total. Un descuento de venta de 1100 deja
      // 90, no toca el piso: recortarlo a 1000 le cobraría 100 de más al cliente
      // y avisaría un motivo que no ocurrió.
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '1000',
              impuestos: [impuesto({ id: 'iva' })],
            }),
          ],
          descuentosVenta: [
            regla({ nombre: 'Cupón 1100', modo: 'monto_fijo', valor: '1100' }),
          ],
        }),
      );

      expect(r.totales.totalFinal).toBe('90.000000');
      expect(r.advertencias).toEqual([]);
    });

    it('advertenciasVenta trae solo las de venta; advertencias sigue trayendo todo', () => {
      // Línea de 1000 con un descuento fijo de 5000 → se topea y avisa.
      // Descuento de venta fijo de 9000 sobre lo que quedó → se topea y avisa.
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '1000',
              descuentos: [
                regla({
                  nombre: 'Fijo 5000',
                  modo: 'monto_fijo',
                  valor: '5000',
                }),
              ],
            }),
          ],
          descuentosVenta: [
            regla({ nombre: 'Venta 9000', modo: 'monto_fijo', valor: '9000' }),
          ],
        }),
      );

      // El campo nuevo aísla las de venta: la de línea NO puede estar acá.
      expect(r.advertenciasVenta).toHaveLength(1);
      expect(r.advertenciasVenta[0].titulo).toContain('Venta 9000');

      // El campo viejo sigue trayendo las dos, que es lo que consume ventas.service.
      expect(r.advertencias).toHaveLength(2);
      expect(r.advertencias.some((a) => a.titulo.includes('Fijo 5000'))).toBe(
        true,
      );
      expect(r.advertencias.some((a) => a.titulo.includes('Venta 9000'))).toBe(
        true,
      );
    });

    it('el piso también aplica a los descuentos a nivel VENTA', () => {
      const r = calcularVenta(
        venta({
          descuentosVenta: [
            regla({ nombre: 'Venta 999', modo: 'monto_fijo', valor: '999' }),
          ],
        }),
      );
      expect(r.totales.totalFinal).toBe('0.000000');
      expect(r.totales.totalDescuentos).toBe('100.000000');
      expect(r.advertencias[0].titulo).toContain('Venta 999');
    });

    it('un recargo no tiene tope superior: puede subir el total libremente', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              recargos: [
                regla({ nombre: 'Fijo 500', modo: 'monto_fijo', valor: '500' }),
              ],
            }),
          ],
        }),
      );
      expect(r.lineas[0].totalLinea).toBe('600.000000');
      expect(r.advertencias).toEqual([]);
    });

    /**
     * El borde que el fuzz de 20.000 ventas de la revisión independiente
     * encontró y que el owner resolvió el 2026-08-11: **el sobrante del
     * descuento se pierde**, no se guarda para compensar lo que venga después.
     *
     * Acá el cliente paga 2000 y no 1800, o sea 200 más en una venta que nunca
     * fue negativa. Es más estricto que la regla original ("una venta nunca da
     * negativo"), que habla del TOTAL y no del acumulado intermedio. Se eligió
     * igual: topear recién al final dejaría la traza mostrando un descuento de
     * 1200 sobre una línea que solo bajó 1000, y ahí el comprobante deja de
     * cuadrar — que es justo lo que el piso por regla protege.
     *
     * Este test existe para que el próximo que lea el piso en cero **no lo
     * "arregle"** creyendo que el borde es un descuido. Es raro por diseño:
     * exige un descuento fijo mayor al neto Y un recargo posterior que lo
     * levante.
     */
    it('el sobrante de un descuento topeado NO compensa un recargo posterior', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '1000',
              descuentos: [
                regla({
                  nombre: 'Fijo 1200',
                  modo: 'monto_fijo',
                  valor: '1200',
                }),
              ],
              recargos: [
                regla({
                  id: 'r2',
                  nombre: 'Fijo 2000',
                  modo: 'monto_fijo',
                  valor: '2000',
                }),
              ],
            }),
          ],
        }),
      );

      // Topeado al aplicarse: se descontaron 1000, no 1200. Los 200 sobrantes
      // se pierden ahí y el recargo entra sobre un acumulado en cero.
      expect(r.lineas[0].descuentoAplicado).toBe('1000.000000');
      expect(r.lineas[0].trazas.descuentos[0].monto).toBe('1000.000000');
      expect(r.lineas[0].totalLinea).toBe('2000.000000');
      expect(r.totales.totalFinal).toBe('2000.000000');

      // El comprobante cuadra, que es la razón de ser de la decisión:
      // neto − descuentos + recargos = 1000 − 1000 + 2000.
      expect(r.lineas[0].subtotalNeto).toBe('1000.000000');
      expect(r.lineas[0].recargoAplicado).toBe('2000.000000');

      // Y el cliente se entera de que el descuento no entró completo.
      expect(r.advertencias).toEqual([
        {
          titulo: 'Descuento "Fijo 1200"',
          detalle: 'no se aplicó completo porque superaba el monto disponible',
        },
      ]);
    });
  });

  describe('ninguna regla aporta un monto negativo', () => {
    it('un recargo `compuesto` sobre una base negativa no resta ni hunde el total', () => {
      // El descuento de venta consume TODA la plata (1190), pero `accVenta`
      // —la base de los %— arranca en el neto (1000), así que queda en -190.
      // Un recargo compuesto sobre esa base daría -19: un "recargo" que resta.
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '1000',
              impuestos: [impuesto({ id: 'iva' })],
            }),
          ],
          descuentosVenta: [
            regla({ nombre: 'Cupón 1190', modo: 'monto_fijo', valor: '1190' }),
          ],
          recargosVenta: [regla({ nombre: 'Tarjeta 10%', valor: '0.10' })],
          config: config({ calculoRecargos: 'compuesto' }),
        }),
      );

      expect(r.totales.totalRecargos).toBe('0.000000');
      expect(r.totales.totalFinal).toBe('0.000000');
      expect(r.trazasVenta.recargos[0].monto).toBe('0.000000');
    });

    /**
     * ⚠️ **Este test afirmaba lo contrario hasta el 2026-08-11**, y el cambio de
     * orden (porcentajes antes que fijos) lo dio vuelta. Vale la pena entender
     * por qué, porque **el resultado nuevo es el correcto**:
     *
     * Antes, el cupón fijo entraba primero, dejaba el acumulado en -100, y el
     * 10% de socio se calculaba sobre esa base negativa: el guard lo llevaba a
     * 0 y **el descuento del socio se evaporaba en silencio**. El cliente pagaba
     * 90. Eso no era una regla de negocio, era un artefacto del orden arbitrario
     * con que la query devolvía las reglas.
     *
     * Ahora el 10% se aplica sobre 1000 (=100) y el cupón se topea al
     * disponible que queda (1090 de 1100 pedidos, con su advertencia). Entre los
     * dos consumen los 1190 de la cuenta y el cliente **paga 0**, que es lo que
     * corresponde: tenía un cupón de 1100 y un 10% sobre una cuenta de 1190.
     *
     * El guard de `Decimal.max(monto, ZERO)` **sigue haciendo falta** y sigue
     * cubierto por el test de arriba: un descuento fijo todavía puede dejar el
     * acumulado negativo, y el paso de **recargos** —que corre después con ese
     * acumulado— sí puede evaluar un porcentaje sobre él. Lo que dejó de ser
     * alcanzable es este caso por el lado de los descuentos.
     */
    it('un descuento fijo que se topea ya no evapora al porcentaje que lo acompaña', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '1000',
              impuestos: [impuesto({ id: 'iva' })],
            }),
          ],
          descuentosVenta: [
            regla({
              id: 'd1',
              nombre: 'Cupón 1100',
              modo: 'monto_fijo',
              valor: '1100',
            }),
            regla({ id: 'd2', nombre: 'Socio 10%', valor: '0.10' }),
          ],
          config: config({ calculoDescuentos: 'compuesto' }),
        }),
      );

      // El socio aplica de verdad, sobre el neto y no sobre un acumulado hundido.
      expect(r.trazasVenta.descuentos[0].nombre).toBe('Socio 10%');
      expect(r.trazasVenta.descuentos[0].monto).toBe('100.000000');
      // El cupón se lleva lo que queda, y la traza guarda que pidió más.
      expect(r.trazasVenta.descuentos[1].nombre).toBe('Cupón 1100');
      expect(r.trazasVenta.descuentos[1].monto).toBe('1090.000000');
      expect(r.trazasVenta.descuentos[1].valorSolicitado).toBe('1100.000000');
      expect(r.totales.totalFinal).toBe('0.000000');
    });
  });

  describe('totales y trazas', () => {
    it('agrega totales y deja trazas por regla', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [regla({ id: 'd1', nombre: 'Desc', valor: '0.10' })],
              impuestos: [impuesto()],
            }),
          ],
        }),
      );
      expect(r.totales.subtotalNeto).toBe('100.000000');
      expect(r.totales.totalDescuentos).toBe('10.000000');
      expect(r.totales.totalImpuestos).toBe('17.100000');
      expect(r.lineas[0].trazas.descuentos).toEqual([
        {
          id: 'd1',
          nombre: 'Desc',
          monto: '10.000000',
          modo: 'porcentaje',
          valorEfectivo: '0.10',
          valorSolicitado: '10.000000',
        },
      ]);
      expect(r.lineas[0].trazas.impuestos).toEqual([
        { id: 't1', nombre: 'IVA', tasa: '0.19', monto: '17.100000' },
      ]);
    });
  });

  // Lo que la traza lleva para que la venta pueda congelarlo: el monto solo no
  // reconstruye la regla. Sin esto, un descuento editado de 10% a 20% deja la
  // venta vieja sin forma de decir cuánto valía cuando se cobró.
  describe('la traza congela con qué valor aplicó la regla', () => {
    it('regla plana en porcentaje: reporta la tasa, no el monto', () => {
      const r = calcularVenta(
        venta({
          lineas: [linea({ descuentos: [regla({ valor: '0.10' })] })],
        }),
      );
      const t = r.lineas[0].trazas.descuentos[0];
      expect(t.modo).toBe('porcentaje');
      expect(t.valorEfectivo).toBe('0.10');
      expect(t.monto).toBe('10.000000');
    });

    it('regla plana en monto fijo: mismo monto que un 10%, distinto modo', () => {
      // Sobre un neto de 100, un 10% y un fijo de 10 dan el MISMO monto. `modo`
      // es lo único que los distingue después.
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              recargos: [regla({ modo: 'monto_fijo', valor: '10' })],
            }),
          ],
        }),
      );
      const t = r.lineas[0].trazas.recargos[0];
      expect(t.modo).toBe('monto_fijo');
      expect(t.valorEfectivo).toBe('10');
      expect(t.monto).toBe('10.000000');
    });

    it('regla por tramos: reporta el valor del tramo que aplicó', () => {
      // El caso que obliga a propagar el tramo: `regla.valor` es null, así que
      // sin el tramo la venta no tiene ningún valor que congelar.
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              cantidad: '12',
              descuentos: [
                regla({
                  codigo: 'por_mayor',
                  valor: null,
                  tramos: [
                    { minimo: '1', valor: '0.05' },
                    { minimo: '10', valor: '0.10' },
                  ],
                }),
              ],
            }),
          ],
        }),
      );
      const t = r.lineas[0].trazas.descuentos[0];
      // El del tramo elegido: ni null, ni el primero de la lista.
      expect(t.valorEfectivo).toBe('0.10');
      expect(t.monto).toBe('120.000000');
    });

    it('descuento topeado: `valorSolicitado` guarda lo que la regla valía', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              descuentos: [
                regla({ nombre: 'Fijo 500', modo: 'monto_fijo', valor: '500' }),
              ],
            }),
          ],
        }),
      );
      const t = r.lineas[0].trazas.descuentos[0];
      // `monto` sigue siendo lo aplicado —el comprobante tiene que cuadrar—
      // y lo pedido vive aparte.
      expect(t.monto).toBe('100.000000');
      expect(t.valorSolicitado).toBe('500.000000');
    });

    it('sin tope, `valorSolicitado` es igual al monto', () => {
      const r = calcularVenta(
        venta({
          lineas: [linea({ descuentos: [regla({ valor: '0.10' })] })],
        }),
      );
      const t = r.lineas[0].trazas.descuentos[0];
      expect(t.valorSolicitado).toBe(t.monto);
    });

    it.each([
      [
        'diferida',
        regla({ codigo: 'promocional', valor: '0.50' }),
        null as string | null,
      ],
      [
        'método de pago que no coincide',
        regla({
          codigo: 'metodo_pago',
          valor: '0.05',
          metodoPagoIds: ['otro'],
        }),
        null as string | null,
      ],
      [
        'sin tramo aplicable',
        regla({
          codigo: 'por_monto_venta',
          valor: null,
          tramos: [{ minimo: '99999', valor: '0.10' }],
        }),
        null as string | null,
      ],
    ])(
      'una regla que no aportó valor (%s) reporta null, no un 0',
      (_caso, reglaSinValor, esperado) => {
        const r = calcularVenta(
          venta({ lineas: [linea({ descuentos: [reglaSinValor] })] }),
        );
        const t = r.lineas[0].trazas.descuentos[0];
        // `null` = la regla no aplicó. Un `'0'` se leería como "valía 0%",
        // que es una regla distinta.
        expect(t.valorEfectivo).toBe(esperado);
        expect(t.monto).toBe('0.000000');
      },
    );

    it('las reglas a nivel venta congelan igual que las de línea', () => {
      const r = calcularVenta(
        venta({ descuentosVenta: [regla({ valor: '0.10' })] }),
      );
      const t = r.trazasVenta.descuentos[0];
      expect(t.modo).toBe('porcentaje');
      expect(t.valorEfectivo).toBe('0.10');
    });
  });

  describe('cuantización a la escala de la moneda', () => {
    /** El caso medido en dev: 15.000 − 5% = 14.250; IVA 19% = 2.707,5. */
    const ventaDelMedioPeso = () =>
      venta({
        config: cfgCLP,
        lineas: [
          linea({
            precioUnitario: '15000',
            descuentos: [regla({ id: 'd1', nombre: '5%', valor: '0.05' })],
            impuestos: [impuesto()],
          }),
        ],
      });

    it('en CLP ninguna salida de línea queda con decimales', () => {
      const r = calcularVenta(ventaDelMedioPeso());
      const l = r.lineas[0];
      for (const v of [
        l.subtotalNeto,
        l.descuentoAplicado,
        l.recargoAplicado,
        l.impuestoAplicado,
        l.totalLinea,
      ]) {
        expect(new Decimal(v).isInteger()).toBe(true);
      }
      // `totalFinal` NO se afirma acá: con una sola línea y sin reglas de nivel
      // venta es el mismo número que `totalLinea`, que el loop ya cubrió. Que el
      // total del documento cierre en la escala es una propiedad distinta y la
      // fijan los casos de nivel `documento` y los de Σtrazas con dos reglas.
    });

    it('el medio peso desaparece: 2.707,5 de IVA cierra en 2.708', () => {
      const r = calcularVenta(ventaDelMedioPeso());
      const l = r.lineas[0];
      // El string sigue teniendo `escalaCalculo` decimales: cambió el VALOR,
      // no el formato. Antes: impuesto 2707.500000, total 16957.500000.
      expect(l.subtotalNeto).toBe('15000.000000');
      expect(l.descuentoAplicado).toBe('750.000000');
      expect(l.impuestoAplicado).toBe('2708.000000');
      expect(l.totalLinea).toBe('16958.000000');
    });

    it('el total de línea es la suma de sus componentes ya cuantizados', () => {
      const r = calcularVenta(ventaDelMedioPeso());
      const l = r.lineas[0];
      const esperado = new Decimal(l.subtotalNeto)
        .minus(l.descuentoAplicado)
        .plus(l.recargoAplicado)
        .plus(l.impuestoAplicado);
      expect(new Decimal(l.totalLinea).eq(esperado)).toBe(true);
    });

    it('Σ trazas de descuento = descuento aplicado, con DOS reglas (Q(a)+Q(b) ≠ Q(a+b))', () => {
      // Con UNA sola regla la identidad es Σ{a} = a y se cumple igual aunque el
      // total se cuantizara aparte: el test no discriminaba nada. Con dos del
      // 12,5% sobre 100 en CLP sí — cada una cuantiza a 13 (Σ = 26), mientras
      // que cuantizar la suma fina daría Q(12,5 + 12,5) = Q(25) = 25.
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          lineas: [
            linea({
              descuentos: [
                regla({ id: 'd1', nombre: 'A', valor: '0.125' }),
                regla({ id: 'd2', nombre: 'B', valor: '0.125' }),
              ],
            }),
          ],
        }),
      );
      const l = r.lineas[0];
      const suma = l.trazas.descuentos.reduce(
        (acc, t) => acc.plus(t.monto),
        new Decimal(0),
      );
      expect(suma.eq(l.descuentoAplicado)).toBe(true);
      expect(l.descuentoAplicado).toBe('26.000000');
    });

    it('la suma de las trazas de impuesto da el impuesto aplicado', () => {
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          lineas: [
            linea({
              precioUnitario: '999',
              impuestos: [
                impuesto(),
                impuesto({ id: 't2', nombre: 'Extra', porcentaje: '0.035' }),
              ],
            }),
          ],
        }),
      );
      const l = r.lineas[0];
      const suma = l.trazas.impuestos.reduce(
        (acc, t) => acc.plus(t.monto),
        new Decimal(0),
      );
      // 999 × 19% = 189,81 → 190 ; 999 × 3,5% = 34,965 → 35. Cada impuesto es
      // una línea declarada del documento, así que se cuantiza por separado y
      // el total es su suma: 225, no 224,775 redondeado (225 también, pero por
      // otro camino — lo que se fija acá es que Σ trazas = impuestoAplicado).
      expect(l.trazas.impuestos.map((t) => t.monto)).toEqual([
        '190.000000',
        '35.000000',
      ]);
      expect(suma.eq(l.impuestoAplicado)).toBe(true);
      expect(l.totalLinea).toBe('1224.000000');
    });

    it('la base imponible es el acumulado YA cuantizado al cerrar el paso anterior', () => {
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          lineas: [
            linea({
              // 100 − 7,5% = 92,5 fino. El paso cierra en 92 (el descuento
              // cuantizado es 8), así que el IVA sale de 92, no de 92,5.
              descuentos: [regla({ valor: '0.075' })],
              impuestos: [impuesto()],
            }),
          ],
        }),
      );
      const l = r.lineas[0];
      expect(l.descuentoAplicado).toBe('8.000000');
      // 92 × 0,19 = 17,48 → 17. Sobre 92,5 daría 17,575 → 18, y el documento
      // declararía un IVA que no es la tasa por la base que muestra.
      expect(l.impuestoAplicado).toBe('17.000000');
      expect(l.totalLinea).toBe('109.000000');
      const base = new Decimal(l.subtotalNeto).minus(l.descuentoAplicado);
      expect(
        new Decimal(l.impuestoAplicado).eq(
          base.times('0.19').toDecimalPlaces(0, Decimal.ROUND_HALF_UP),
        ),
      ).toBe(true);
    });

    it('DENTRO de un paso el acumulado corre fino: no se cuantiza regla por regla', () => {
      const r = calcularVenta(
        venta({
          config: config({
            decimalesMoneda: 0,
            formula: ['recargos'],
            calculoRecargos: 'compuesto',
          }),
          lineas: [
            linea({
              recargos: [
                regla({ id: 'r1', modo: 'porcentaje', valor: '0.005' }),
                regla({ id: 'r2', modo: 'porcentaje', valor: '0.50' }),
              ],
            }),
          ],
        }),
      );
      const l = r.lineas[0];
      // 100 + 0,5% = 100,5 (acumulado FINO) ; 50% de 100,5 = 50,25 → 50.
      // Cuantizando regla por regla el acumulado sería 101 y el segundo
      // recargo 50,5 → 51: un peso de más, compuesto por el paso anterior.
      // Es el error del Vancouver Stock Exchange en chico.
      expect(l.trazas.recargos.map((t) => t.monto)).toEqual([
        '1.000000',
        '50.000000',
      ]);
      expect(l.recargoAplicado).toBe('51.000000');
      expect(l.totalLinea).toBe('151.000000');
    });

    it('el piso en cero aguanta la cuantización: el total no queda negativo', () => {
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          lineas: [
            linea({
              // Dos fijos de 50,5 sobre 100: la suma fina (101) ya excede el
              // neto, y si cada uno se cuantizara sin mirar lo que queda
              // disponible darían 51 + 51 = 102 sobre un neto de 100.
              descuentos: [
                regla({ id: 'f1', modo: 'monto_fijo', valor: '50.5' }),
                regla({ id: 'f2', modo: 'monto_fijo', valor: '50.5' }),
              ],
            }),
          ],
        }),
      );
      const l = r.lineas[0];
      expect(l.descuentoAplicado).toBe('100.000000');
      // `toBe('0.000000')` ya es la afirmación de que no quedó negativo: un
      // `isNegative()` detrás no puede fallar sin que falle éste primero.
      expect(l.totalLinea).toBe('0.000000');
    });

    it('no avisa "no se aplicó completo" cuando el recorte desaparece al cuantizar', () => {
      // El aviso existe para decirle al cajero que el descuento entró recortado.
      // Con el tope comparado en fino avisaba también cuando el recorte no
      // sobrevive a la cuantización: acá el segundo fijo pide 49,4 sobre los 49
      // que quedan, y en CLP las dos cifras son el mismo peso. La traza queda
      // IDÉNTICA a lo solicitado, así que el aviso no describe nada.
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          lineas: [
            linea({
              descuentos: [
                regla({
                  id: 'f1',
                  nombre: 'A',
                  modo: 'monto_fijo',
                  valor: '50.5',
                }),
                regla({
                  id: 'f2',
                  nombre: 'B',
                  modo: 'monto_fijo',
                  valor: '49.4',
                }),
              ],
            }),
          ],
        }),
      );
      const segunda = r.lineas[0].trazas.descuentos[1];
      expect(segunda.valorSolicitado).toBe('49.000000');
      expect(segunda.monto).toBe('49.000000');
      expect(r.advertencias).toEqual([]);
    });

    it('sí avisa cuando el recorte sobrevive a la cuantización', () => {
      // El gemelo del de arriba, para que el arreglo no se coma el aviso legítimo:
      // el segundo pide 51 (cuantizado) sobre 49 disponibles y entra recortado.
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          lineas: [
            linea({
              descuentos: [
                regla({
                  id: 'f1',
                  nombre: 'A',
                  modo: 'monto_fijo',
                  valor: '50.5',
                }),
                regla({
                  id: 'f2',
                  nombre: 'B',
                  modo: 'monto_fijo',
                  valor: '50.5',
                }),
              ],
            }),
          ],
        }),
      );
      expect(r.advertencias).toEqual([
        {
          titulo: 'Descuento "B"',
          detalle: 'no se aplicó completo porque superaba el monto disponible',
        },
      ]);
    });

    it('la traza de una regla topeada declara el solicitado YA cuantizado', () => {
      // El caso topeado en CLP que le faltaba a `valorSolicitado`: el segundo
      // fijo pide 50,5 y solo entran 49. Si el solicitado no se cuantizara, la
      // traza mostraría 50,5 — plata con decimales que el peso no representa,
      // en la misma línea del ticket donde el aplicado ya es entero.
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          lineas: [
            linea({
              descuentos: [
                regla({ id: 'f1', modo: 'monto_fijo', valor: '50.5' }),
                regla({ id: 'f2', modo: 'monto_fijo', valor: '50.5' }),
              ],
            }),
          ],
        }),
      );
      const [primera, segunda] = r.lineas[0].trazas.descuentos;
      expect(primera.valorSolicitado).toBe('51.000000');
      expect(primera.monto).toBe('51.000000');
      // La topeada: pidió 51 (cuantizado), aplicó 49.
      expect(segunda.valorSolicitado).toBe('51.000000');
      expect(segunda.monto).toBe('49.000000');
    });

    it('con nivel documento las líneas conservan decimales y solo el total se cuantiza', () => {
      const cfgDocumento: ConfigCalculo = {
        ...cfgCLP,
        nivelRedondeo: 'documento',
      };
      const r = calcularVenta({ ...ventaDelMedioPeso(), config: cfgDocumento });
      // La línea sigue fina: 14.250 × 19% = 2.707,5, sin cuantizar.
      expect(new Decimal(r.lineas[0].impuestoAplicado).eq('2707.5')).toBe(true);
      // Solo el total del documento cierra en la escala de la moneda (CLP: 0).
      expect(new Decimal(r.totales.totalFinal).isInteger()).toBe(true);
    });

    it('el total del documento se DERIVA de los componentes ya cuantizados, no se cuantiza aparte', () => {
      // Discrimina de verdad entre "derivar" y "cuantizar cada total por
      // separado": necesita DOS componentes fraccionarios que empujen para el
      // mismo lado del redondeo, algo que el carrito de un solo término
      // (`ventaDelMedioPeso`) no puede exponer.
      //
      // Línea 1: neto 1.000, recargo fijo 0,1. Línea 2: neto 2.000, impuesto
      // 0,02% = 0,4. Fino: neto 3.000, recargos 0,1, impuestos 0,4, total
      // 3.000,5. Cuantizando CADA total por separado, totalFinal redondearía
      // (3.000,5 → 3.001) distinto de sus propias partes ya cuantizadas
      // (3.000 − 0 + 0 + 0 = 3.000): la identidad del documento se rompería.
      // Derivado da 3.000, que es lo correcto.
      const cfgDocumento: ConfigCalculo = {
        ...cfgCLP,
        nivelRedondeo: 'documento',
      };
      const r = calcularVenta({
        config: cfgDocumento,
        metodoPagoId: null,
        descuentosVenta: [],
        recargosVenta: [],
        lineas: [
          linea({
            precioUnitario: '1000',
            recargos: [regla({ id: 'r1', modo: 'monto_fijo', valor: '0.1' })],
          }),
          linea({
            precioUnitario: '2000',
            impuestos: [impuesto({ porcentaje: '0.0002' })],
          }),
        ],
      });
      expect(r.totales.totalRecargos).toBe('0.000000');
      expect(r.totales.totalImpuestos).toBe('0.000000');
      expect(r.totales.totalFinal).toBe('3000.000000');
    });

    it('con descuento de nivel venta, Σ líneas − descuento global = total, todo entero', () => {
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          descuentosVenta: [
            regla({ id: 'dv1', nombre: 'Cupón 7%', valor: '0.07' }),
          ],
          // Netos 3.000 + 1.550 = 4.550, y 7% de 4.550 = 318,5 → el descuento
          // global cae justo en el medio peso, el caso que la identidad tiene
          // que cerrar.
          lineas: [
            linea({
              itemId: 'i1',
              precioUnitario: '3000',
              impuestos: [impuesto()],
            }),
            linea({
              itemId: 'i2',
              precioUnitario: '1550',
              impuestos: [impuesto()],
            }),
          ],
        }),
      );
      const sumaLineas = r.lineas.reduce(
        (acc, l) => acc.plus(l.totalLinea),
        new Decimal(0),
      );
      const dv = new Decimal(r.trazasVenta.descuentos[0].monto);

      expect(dv.isInteger()).toBe(true);
      expect(sumaLineas.minus(dv).eq(r.totales.totalFinal)).toBe(true);
    });

    it('Σ trazas = total con DOS reglas de nivel venta (Q(a+b) ≠ Q(a)+Q(b))', () => {
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          descuentosVenta: [
            regla({
              id: 'f1',
              nombre: 'Fijo A',
              modo: 'monto_fijo',
              valor: '0.5',
            }),
            regla({
              id: 'f2',
              nombre: 'Fijo B',
              modo: 'monto_fijo',
              valor: '0.5',
            }),
          ],
          lineas: [linea({ precioUnitario: '3000' })],
        }),
      );
      // Cada fijo cuantiza por separado: 0,5 → 1 (HALF_UP) dos veces = 2. La
      // suma fina (0,5+0,5=1,0) cuantizada de una sola vez daría 1 — la
      // discrepancia que rompía Σtrazas = total con el `.map` al volver.
      const sumaTrazas = r.trazasVenta.descuentos.reduce(
        (acc, t) => acc.plus(t.monto),
        new Decimal(0),
      );
      expect(sumaTrazas.eq(r.totales.totalDescuentos)).toBe(true);
      expect(r.totales.totalDescuentos).toBe('2.000000');
      const sumaLineas = r.lineas.reduce(
        (acc, l) => acc.plus(l.totalLinea),
        new Decimal(0),
      );
      expect(sumaLineas.minus(sumaTrazas).eq(r.totales.totalFinal)).toBe(true);
    });

    it('el piso en cero a nivel venta: dos descuentos que exceden lo disponible no dejan el total negativo', () => {
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          descuentosVenta: [
            regla({
              id: 'f1',
              nombre: 'Fijo A',
              modo: 'monto_fijo',
              valor: '50.5',
            }),
            regla({
              id: 'f2',
              nombre: 'Fijo B',
              modo: 'monto_fijo',
              valor: '50.5',
            }),
          ],
          // Una sola línea, sin reglas propias: la plata real disponible es
          // exactamente 100. Los dos fijos piden 101 fino entre los dos.
          lineas: [linea({ precioUnitario: '100' })],
        }),
      );
      // Cada traza cierra en pesos enteros: sin cuantizar `disponible` por
      // dentro, el segundo fijo quedaría topeado a 49,5 (plata fina), no a 49
      // (plata real).
      for (const t of r.trazasVenta.descuentos) {
        expect(new Decimal(t.monto).isInteger()).toBe(true);
      }
      const disponibleReal = new Decimal(100);
      const aplicado = new Decimal(r.totales.totalDescuentos);
      expect(aplicado.lessThanOrEqualTo(disponibleReal)).toBe(true);
      expect(new Decimal(r.totales.totalFinal).isNegative()).toBe(false);
      expect(new Decimal(r.totales.totalFinal).isInteger()).toBe(true);
      // Σ trazas = total: si se cuantizara CADA traza por fuera en vez de
      // adentro de `procesarReglas`, 50,5 topeado a 49,5 (fino) redondearía a
      // 51 + 50 = 101 mientras el agregado seguiría dando 100 — el mutante
      // del `.map` sobrevive exactamente a esta aserción si falta.
      const sumaTrazas = r.trazasVenta.descuentos.reduce(
        (acc, t) => acc.plus(t.monto),
        new Decimal(0),
      );
      expect(sumaTrazas.eq(r.totales.totalDescuentos)).toBe(true);
    });

    it('el recargo de nivel venta también cuantiza: medio peso no sobrevive en CLP', () => {
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          recargosVenta: [
            regla({ id: 'rv1', nombre: 'Recargo 7%', valor: '0.07' }),
          ],
          // Netos 3.000 + 1.550 = 4.550, y 7% de 4.550 = 318,5 → el mismo
          // medio peso del test del descuento global, pero del lado del
          // recargo. Con `cuantizar` solo en la llamada de descuentos y no
          // en la de recargos, esta traza queda en '318.500000' y la
          // identidad de abajo no cierra.
          lineas: [
            linea({
              itemId: 'i1',
              precioUnitario: '3000',
              impuestos: [impuesto()],
            }),
            linea({
              itemId: 'i2',
              precioUnitario: '1550',
              impuestos: [impuesto()],
            }),
          ],
        }),
      );
      const sumaLineas = r.lineas.reduce(
        (acc, l) => acc.plus(l.totalLinea),
        new Decimal(0),
      );
      const rv = new Decimal(r.trazasVenta.recargos[0].monto);

      expect(rv.isInteger()).toBe(true);
      expect(sumaLineas.plus(rv).eq(r.totales.totalFinal)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Desbruteo: cuando el precio ya incluye impuesto, la etiqueta manda
  // ─────────────────────────────────────────────────────────────────────────
  describe('desbruteo: el total cierra a góndola', () => {
    const IVA = impuesto({ id: 'iva', nombre: 'IVA', porcentaje: '0.19' });
    const ILA = impuesto({
      id: 'ila',
      nombre: 'ILA',
      porcentaje: '0.10',
      tipo: 'otro',
    });
    const OTRO = impuesto({
      id: 'o2',
      nombre: 'Otro',
      porcentaje: '0.05',
      tipo: 'otro',
    });

    /** Línea con precio de góndola en CLP: bruto-inclusiva y sin reglas. */
    const gondola = (precio: string, impuestos: ImpuestoResuelto[]) =>
      venta({
        config: cfgCLP,
        lineas: [
          linea({
            precioUnitario: precio,
            precioIncluyeImpuesto: true,
            impuestos,
          }),
        ],
      });

    const sumaTrazas = (l: ResultadoLinea) =>
      l.trazas.impuestos.reduce((acc, t) => acc.plus(t.monto), new Decimal(0));

    // El caso que motivó la decisión: con `tasa × base` el IVA daba 158 y la
    // línea cerraba en 992 — un peso menos que la etiqueta que el cliente vio.
    it('góndola 993 en CLP da 834 + 159 y total 993', () => {
      const l = calcularVenta(gondola('993', [IVA])).lineas[0];

      expect(new Decimal(l.subtotalNeto).eq(834)).toBe(true);
      expect(new Decimal(l.impuestoAplicado).eq(159)).toBe(true);
      expect(new Decimal(l.totalLinea).eq(993)).toBe(true);
      // El impuesto derivado sigue siendo UNA línea declarada del documento.
      expect(sumaTrazas(l).eq(l.impuestoAplicado)).toBe(true);
    });

    it.each(['995', '997', '1000', '1990'])(
      'los precios que ya cerraban siguen cerrando: %s',
      (precio) => {
        const l = calcularVenta(gondola(precio, [IVA])).lineas[0];
        expect(new Decimal(l.totalLinea).eq(precio)).toBe(true);
      },
    );

    // ⚠️ El test que impide generalizar la resta a toda la rama desbruteada.
    // "La etiqueta manda" vale mientras el cliente pague la etiqueta: con un
    // descuento ya no la paga, así que no hay góndola que cerrar y lo que el
    // documento tiene que declarar es el IVA de la base realmente cobrada.
    // Medido: restar contra la góndola daría 242 (cobra la etiqueta entera e
    // ignora el descuento) y contra góndola−descuento, 159. El correcto es 143.
    it('con descuento en la línea el IVA vuelve a ser tasa × base, no la resta', () => {
      const r = calcularVenta(
        venta({
          config: cfgCLP,
          lineas: [
            linea({
              precioUnitario: '993',
              precioIncluyeImpuesto: true,
              descuentos: [regla({ id: 'd1', nombre: '10%', valor: '0.10' })],
              impuestos: [IVA],
            }),
          ],
        }),
      );
      const l = r.lineas[0];

      // neto 834 − descuento 83 = base 751; 751 × 0.19 = 142,69 → 143.
      expect(new Decimal(l.subtotalNeto).eq(834)).toBe(true);
      expect(new Decimal(l.descuentoAplicado).eq(83)).toBe(true);
      expect(new Decimal(l.impuestoAplicado).eq(143)).toBe(true);
      expect(new Decimal(l.totalLinea).eq(894)).toBe(true);
    });

    it('con IVA + adicional, el adicional queda exacto y el IVA absorbe', () => {
      const l = calcularVenta(gondola('1995', [IVA, ILA])).lineas[0];
      const neto = new Decimal(l.subtotalNeto);
      const ila = new Decimal(
        l.trazas.impuestos.find((t) => t.id === 'ila')!.monto,
      );
      const iva = new Decimal(
        l.trazas.impuestos.find((t) => t.id === 'iva')!.monto,
      );

      // 1995 / 1.29 = 1546,51… → neto 1547; residuo 448. El ILA queda exacto
      // (154,7 → 155) y el IVA absorbe 293, no los 294 de su fórmula: con
      // 294 la línea cerraría en 1.996, un peso POR ENCIMA de la etiqueta.
      expect(neto.eq(1547)).toBe(true);
      expect(ila.eq(cuantizar(neto.times('0.10'), cfgCLP))).toBe(true);
      expect(iva.eq(293)).toBe(true);
      expect(iva.plus(ila).eq(new Decimal(1995).minus(neto))).toBe(true);
      expect(sumaTrazas(l).eq(l.impuestoAplicado)).toBe(true);
      expect(new Decimal(l.totalLinea).eq(1995)).toBe(true);
      // Absorber no reordena las líneas de impuesto del documento.
      expect(l.trazas.impuestos.map((t) => t.id)).toEqual(['iva', 'ila']);
    });

    // Los 'otro' se aplican también sin IVA (DL 825 / IndExe del DTE), así que
    // el borde es real: sin IVA que ceda, absorbe el adicional de mayor tasa.
    // Lo que el motor ve es una lista sin IVA, no un estado fiscal: se llega
    // igual desde un ítem exento que desde uno sin clasificación tributaria.
    it('sin IVA en la lista, absorbe el adicional de mayor tasa', () => {
      const l = calcularVenta(gondola('993', [OTRO, ILA])).lineas[0];
      const ila = new Decimal(
        l.trazas.impuestos.find((t) => t.id === 'ila')!.monto,
      );
      const otro = new Decimal(
        l.trazas.impuestos.find((t) => t.id === 'o2')!.monto,
      );

      // 993 / 1.15 = 863,47… → neto 863; residuo 130. El 5% queda exacto
      // (43,15 → 43) y el ILA absorbe 87, no los 86 de su fórmula.
      expect(new Decimal(l.subtotalNeto).eq(863)).toBe(true);
      expect(otro.eq(cuantizar(new Decimal(863).times('0.05'), cfgCLP))).toBe(
        true,
      );
      expect(ila.eq(87)).toBe(true);
      expect(sumaTrazas(l).eq(l.impuestoAplicado)).toBe(true);
      expect(new Decimal(l.totalLinea).eq(993)).toBe(true);
    });

    it('empatadas las tasas, el absorbente se desempata por id', () => {
      const a = impuesto({
        id: 'a-otro',
        nombre: 'A',
        porcentaje: '0.05',
        tipo: 'otro',
      });
      const b = impuesto({
        id: 'b-otro',
        nombre: 'B',
        porcentaje: '0.05',
        tipo: 'otro',
      });
      const conB = calcularVenta(gondola('997', [b, a])).lineas[0];
      const conA = calcularVenta(gondola('997', [a, b])).lineas[0];

      // Mismo resultado sin importar el orden de entrada: absorbe 'a-otro'.
      for (const l of [conA, conB]) {
        const trazaA = l.trazas.impuestos.find((t) => t.id === 'a-otro')!;
        const trazaB = l.trazas.impuestos.find((t) => t.id === 'b-otro')!;
        // 997 / 1.10 = 906,36… → neto 906; residuo 91. B exacto: 45,3 → 45,
        // y el peso que sobra se lo lleva A, el primero por id.
        expect(new Decimal(trazaB.monto).eq(45)).toBe(true);
        expect(new Decimal(trazaA.monto).eq(46)).toBe(true);
        expect(new Decimal(l.totalLinea).eq(997)).toBe(true);
      }
    });

    // ⚠️ El guard de `hayReglasDespuesDelImpuesto`: con los impuestos PRIMERO,
    // cuando corre ese paso todavía no se aplicó el descuento, así que mirar
    // solo `descuentoAplicado.isZero()` daría el cierre a góndola por bueno y
    // declararía un IVA de 159 sobre una línea que el cliente no paga a 993.
    // La rama segura es la fórmula: 158 sobre la base pre-descuento.
    it('con impuestos primero, un descuento posterior devuelve la fórmula', () => {
      const l = calcularVenta(
        venta({
          config: {
            ...cfgCLP,
            formula: ['impuestos', 'descuentos', 'recargos'],
          },
          lineas: [
            linea({
              precioUnitario: '993',
              precioIncluyeImpuesto: true,
              descuentos: [regla({ id: 'd1', nombre: '10%', valor: '0.10' })],
              impuestos: [IVA],
            }),
          ],
        }),
      ).lineas[0];

      // neto 834; IVA por fórmula sobre 834 = 158,46 → 158 (por resta daría
      // 159). Descuento 10% del neto = 83,4 → 83. Total 834 − 83 + 158 = 909.
      expect(new Decimal(l.subtotalNeto).eq(834)).toBe(true);
      expect(new Decimal(l.impuestoAplicado).eq(158)).toBe(true);
      expect(new Decimal(l.descuentoAplicado).eq(83)).toBe(true);
      expect(new Decimal(l.totalLinea).eq(909)).toBe(true);
    });

    // Con `nivelRedondeo: 'documento'` la línea corre fina, pero la rama de
    // góndola NO es un no-op: el impuesto sigue saliendo por resta y ahí cierra
    // exacto, mientras que la fórmula deja el sobrante en el sexto decimal.
    it('con nivelRedondeo documento la línea también cierra exacta', () => {
      const l = calcularVenta({
        ...gondola('993', [IVA]),
        config: { ...cfgCLP, nivelRedondeo: 'documento' },
      }).lineas[0];

      // 993 / 1.19 = 834,453782 (escala 6). Por resta el IVA es 158,546218 y la
      // línea da 993,000000; por fórmula sería 158,546219 → 993,000001.
      expect(l.subtotalNeto).toBe('834.453782');
      expect(l.impuestoAplicado).toBe('158.546218');
      expect(l.totalLinea).toBe('993.000000');
      expect(sumaTrazas(l).eq(l.impuestoAplicado)).toBe(true);
    });

    // La góndola que tiene que cerrar es la de la LÍNEA (bruto × cantidad), no
    // la unitaria: el neto se cuantiza una sola vez sobre el total de la línea.
    it('con cantidad, cierra al bruto de la línea completa', () => {
      const l = calcularVenta(
        venta({
          config: cfgCLP,
          lineas: [
            linea({
              cantidad: '3',
              precioUnitario: '903',
              precioIncluyeImpuesto: true,
              impuestos: [IVA],
            }),
          ],
        }),
      ).lineas[0];

      // 903 / 1.19 × 3 = 2.276,47 → neto 2.276; el IVA por fórmula daría 432
      // (2.708) y por resta da 433, que cierra en los 2.709 de la etiqueta.
      expect(new Decimal(l.subtotalNeto).eq(2276)).toBe(true);
      expect(new Decimal(l.impuestoAplicado).eq(433)).toBe(true);
      expect(new Decimal(l.totalLinea).eq(2709)).toBe(true);
      expect(sumaTrazas(l).eq(l.impuestoAplicado)).toBe(true);
    });
  });
});
