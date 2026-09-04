import Decimal from 'decimal.js';
import {
  cuantizar,
  type ConfigCalculo,
  type Cuantizador,
} from '../calculo-precios/calculo-precios.engine';
import {
  descomponer,
  escalarDevoluciones,
  repartirAjuste,
  tasaEfectiva,
  type PorcionOriginal,
} from './nota-credito-composicion';

// Peso chileno: 0 decimales es la escala que MÁS residuo produce, y por eso la
// que discrimina. Con 2 decimales varios de estos casos cerrarían solos.
const CFG: ConfigCalculo = {
  formula: ['descuentos', 'recargos', 'impuestos'],
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  escalaCalculo: 4,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  decimalesMoneda: 0,
  promosAcumulanDescuentos: false,
};
const q: Cuantizador = (d) => cuantizar(d, CFG);

describe('tasaEfectiva', () => {
  it('sale de los importes congelados, no del catálogo', () => {
    // 11.900 con 1.900 de IVA → neto 10.000 → 19%. Dividir por el TOTAL en vez
    // de por el neto daría 0,1596…, que es el mutante que este caso mata.
    const porciones: PorcionOriginal[] = [
      { clasificacion: 'afecto', total: '11900', impuesto: '1900' },
    ];
    expect(tasaEfectiva(porciones, 'afecto').toString()).toBe('0.19');
  });

  it('suma solo las porciones de su clasificación', () => {
    const porciones: PorcionOriginal[] = [
      { clasificacion: 'afecto', total: '11900', impuesto: '1900' },
      { clasificacion: 'exento', total: '5000', impuesto: '0' },
    ];
    // Mezclar la exenta en el denominador daría 1900/15000 = 0,1266…
    expect(tasaEfectiva(porciones, 'afecto').toString()).toBe('0.19');
    expect(tasaEfectiva(porciones, 'exento').isZero()).toBe(true);
  });

  it('neto 0 no divide por cero', () => {
    const porciones: PorcionOriginal[] = [
      { clasificacion: 'afecto', total: '0', impuesto: '0' },
    ];
    expect(tasaEfectiva(porciones, 'afecto').isZero()).toBe(true);
  });

  it('una clasificación que no está en el documento da 0', () => {
    const porciones: PorcionOriginal[] = [
      { clasificacion: 'afecto', total: '11900', impuesto: '1900' },
    ];
    expect(tasaEfectiva(porciones, 'exento').isZero()).toBe(true);
  });
});

describe('descomponer', () => {
  it('el impuesto sale por resta: neto + impuesto = bruto, exacto', () => {
    const { subtotal, impuesto } = descomponer(
      new Decimal('11900'),
      new Decimal('0.19'),
      q,
    );
    expect(subtotal.toString()).toBe('10000');
    expect(impuesto.toString()).toBe('1900');
    expect(subtotal.plus(impuesto).toString()).toBe('11900');
  });

  it('cierra exacto aunque la división no cierre', () => {
    // 1.000 / 1,19 = 840,336… → neto 840, impuesto 160. Calcular el impuesto
    // como `q(bruto × tasa)` daría 190, y 840 + 190 = 1.030 ≠ 1.000.
    const { subtotal, impuesto } = descomponer(
      new Decimal('1000'),
      new Decimal('0.19'),
      q,
    );
    expect(subtotal.toString()).toBe('840');
    expect(impuesto.toString()).toBe('160');
    expect(subtotal.plus(impuesto).toString()).toBe('1000');
  });

  it('tasa 0 deja todo en el neto', () => {
    const { subtotal, impuesto } = descomponer(
      new Decimal('5000'),
      new Decimal(0),
      q,
    );
    expect(subtotal.toString()).toBe('5000');
    expect(impuesto.isZero()).toBe(true);
  });
});

describe('repartirAjuste', () => {
  const pesos = (afecto: string, exento: string) => [
    { clasificacion: 'afecto', peso: new Decimal(afecto) },
    { clasificacion: 'exento', peso: new Decimal(exento) },
  ];

  it('reparte en la proporción del remanente', () => {
    // Remanente 7.000 afecto / 3.000 exento; ajuste 1.000 → 700 / 300.
    // Proporción despareja a propósito: con 50/50 un reparto mal escrito pasa.
    const partes = repartirAjuste(
      new Decimal('1000'),
      pesos('7000', '3000'),
      CFG,
      q,
    );
    expect(partes.map((p) => [p.clasificacion, p.bruto.toString()])).toEqual([
      ['afecto', '700'],
      ['exento', '300'],
    ]);
  });

  it('el residuo de la cuantización se corrige y la suma cierra exacta', () => {
    // 1.001 entre dos pesos iguales: las dos partes finas son 500,5 y HALF_UP
    // las sube a 501 → 1.002, uno de más. El paso de unidad se lo saca a la de
    // mayor resto, y con restos empatados desempata la POSICIÓN.
    const partes = repartirAjuste(new Decimal('1001'), pesos('1', '1'), CFG, q);
    expect(partes.map((p) => p.bruto.toString())).toEqual(['500', '501']);
    const suma = partes.reduce((a, p) => a.plus(p.bruto), new Decimal(0));
    expect(suma.toString()).toBe('1001');
  });

  it('no devuelve líneas en cero', () => {
    // Ajuste chico sobre una venta casi toda afecta: el balde exento redondea
    // a 0 y esa línea no se escribe.
    const partes = repartirAjuste(
      new Decimal('10'),
      pesos('99000', '1000'),
      CFG,
      q,
    );
    expect(partes).toHaveLength(1);
    expect(partes[0].clasificacion).toBe('afecto');
    expect(partes[0].bruto.toString()).toBe('10');
  });

  it('una venta toda afecta sale en una sola línea', () => {
    const partes = repartirAjuste(
      new Decimal('1000'),
      pesos('10000', '0'),
      CFG,
      q,
    );
    expect(partes).toHaveLength(1);
    expect(partes[0].clasificacion).toBe('afecto');
    expect(partes[0].bruto.toString()).toBe('1000');
  });
});

describe('escalarDevoluciones', () => {
  it('si lo devuelto entra en el monto, las líneas NO se tocan', () => {
    const partes = escalarDevoluciones(
      [new Decimal('1190'), new Decimal('3000')],
      new Decimal('8000'),
      CFG,
      q,
    );
    expect(partes.map((p) => p.toString())).toEqual(['1190', '3000']);
  });

  it('si no entra, las líneas suman EXACTAMENTE el monto', () => {
    // 3.000 + 5.000 = 8.000 devueltos, se acreditan 500. Las dos partes finas
    // caen justo en el medio —187,5 y 312,5— así que HALF_UP sube LAS DOS y la
    // suma se pasa en uno. Ahí es donde dividir línea por línea y repartir
    // dejan de coincidir: la división daría 188 + 313 = 501. El paso de unidad
    // se lo saca a la de mayor resto, y con restos empatados desempata la
    // POSICIÓN.
    const partes = escalarDevoluciones(
      [new Decimal('3000'), new Decimal('5000')],
      new Decimal('500'),
      CFG,
      q,
    );
    const suma = partes.reduce((a, p) => a.plus(p), new Decimal(0));
    expect(suma.toString()).toBe('500');
    expect(partes.map((p) => p.toString())).toEqual(['187', '313']);
  });

  it('el monto igual a lo devuelto no escala nada', () => {
    const partes = escalarDevoluciones(
      [new Decimal('1190'), new Decimal('3000')],
      new Decimal('4190'),
      CFG,
      q,
    );
    expect(partes.map((p) => p.toString())).toEqual(['1190', '3000']);
  });

  it('sin devoluciones devuelve una lista vacía', () => {
    expect(escalarDevoluciones([], new Decimal('1000'), CFG, q)).toEqual([]);
  });

  // El caso llega a `repartirProporcional` con monto 0 —lo clampea el
  // `Decimal.min`— y ahí su rama de peso total cero devuelve el monto entero a
  // la primera parte: 0. Sin el `min`, en cambio, mandaría los 1.000 a la
  // primera línea, que es una línea de plata sacada de una devolución que no
  // vale nada.
  it('devoluciones que valen cero no dividen por cero', () => {
    const partes = escalarDevoluciones(
      [new Decimal(0), new Decimal(0)],
      new Decimal('1000'),
      CFG,
      q,
    );
    expect(partes.map((p) => p.toString())).toEqual(['0', '0']);
  });
});
