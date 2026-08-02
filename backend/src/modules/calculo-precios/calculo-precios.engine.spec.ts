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
              impuestos: [{ id: 'iva', nombre: 'IVA', porcentaje: '0.19' }],
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
              impuestos: [{ id: 'iva', nombre: 'IVA', porcentaje: '0.19' }],
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
              impuestos: [{ id: 'iva', nombre: 'IVA', porcentaje: '0.19' }],
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

    it('un segundo descuento `compuesto` sobre base negativa no le cobra al cliente', () => {
      const r = calcularVenta(
        venta({
          lineas: [
            linea({
              precioUnitario: '1000',
              impuestos: [{ id: 'iva', nombre: 'IVA', porcentaje: '0.19' }],
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

      // Sin el piso por regla, el segundo daba -10 y SUBÍA el total.
      expect(r.trazasVenta.descuentos[1].monto).toBe('0.000000');
      expect(r.totales.totalFinal).toBe('90.000000');
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
