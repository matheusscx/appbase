import {
  calcularVenta,
  type ConfigCalculo,
  type ImpuestoResuelto,
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
  nivelRedondeo: 'linea',
  // 4 = el máximo que admite el sistema (UF). El motor todavía no cuantiza
  // con este valor (Task 5); acá solo viaja congelado.
  decimalesMoneda: 4,
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
  activo: true,
  ...over,
});

const impuesto = (over: Partial<ImpuestoResuelto> = {}): ImpuestoResuelto => ({
  id: 't1',
  nombre: 'IVA',
  porcentaje: '0.19',
  activo: true,
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
});
