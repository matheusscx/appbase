import Decimal from 'decimal.js';
import {
  evaluarPromos,
  instanteEnVentana,
  type AplicacionPromo,
  type InstanteLocal,
  type LineaPromo,
  type PromoElegible,
  type VentanaPromo,
} from './promociones.evaluator';

// ───────────────────────────────────────────────────────────────────────────
// Helpers para construir entradas de forma concisa (defaults + overrides)
// ───────────────────────────────────────────────────────────────────────────

const ventanaBase: VentanaPromo = {
  fechaInicio: '2026-06-10',
  fechaFin: '2026-06-20',
  horaInicio: null,
  horaFin: null,
  diasSemana: null,
  canal: null,
};

function promo(over: Partial<PromoElegible> = {}): PromoElegible {
  return {
    id: 'promo-1',
    nombre: 'Promo test',
    tipo: 'porcentaje',
    valorPorcentaje: '0.20',
    cadaN: null,
    valorMonto: null,
    ventana: ventanaBase,
    scopes: [
      {
        slot: 0,
        tipoScope: 'venta',
        categoriaId: null,
        cantidad: 1,
        itemIds: [],
      },
    ],
    ...over,
  };
}

/** Fixture de nxm: mismo `promo()`, con la forma que exige ese tipo. */
function nxmPromo(over: Partial<PromoElegible> = {}): PromoElegible {
  return promo({ tipo: 'nxm', cadaN: 2, valorPorcentaje: '1', ...over });
}

/**
 * Fixture de precio_fijo (combo "1 pizza + 1 bebida"): dos slots por
 * `itemId`, uno por línea. `over.scopes` reemplaza los slots enteros — así
 * los tests de `cantidad` > 1 o de 3 slots no arrastran estos dos.
 */
function precioFijoPromo(over: Partial<PromoElegible> = {}): PromoElegible {
  return promo({
    id: 'promo-combo',
    tipo: 'precio_fijo',
    valorPorcentaje: null,
    valorMonto: '9990',
    scopes: [
      {
        slot: 0,
        tipoScope: 'items',
        categoriaId: null,
        cantidad: 1,
        itemIds: ['pizza'],
      },
      {
        slot: 1,
        tipoScope: 'items',
        categoriaId: null,
        cantidad: 1,
        itemIds: ['bebida'],
      },
    ],
    ...over,
  });
}

function instante(over: Partial<InstanteLocal> = {}): InstanteLocal {
  return { fecha: '2026-06-15', hora: '12:00', diaIso: 1, ...over };
}

function linea(over: Partial<LineaPromo> = {}): LineaPromo {
  return {
    index: 0,
    itemId: 'item-1',
    categoriaId: null,
    cantidad: '1',
    netoUnitario: '1000',
    instante: instante(),
    ...over,
  };
}

function montos(
  res: AplicacionPromo[],
): { lineaIndex: number; monto: string }[] {
  expect(res).toHaveLength(1);
  return res[0].montosPorLinea;
}

// ───────────────────────────────────────────────────────────────────────────

describe('instanteEnVentana', () => {
  it('fecha antes del rango → false', () => {
    expect(
      instanteEnVentana(ventanaBase, instante({ fecha: '2026-06-09' })),
    ).toBe(false);
  });

  it('primer día del rango (inclusive) → true', () => {
    expect(
      instanteEnVentana(ventanaBase, instante({ fecha: '2026-06-10' })),
    ).toBe(true);
  });

  it('último día del rango (inclusive) → true', () => {
    expect(
      instanteEnVentana(ventanaBase, instante({ fecha: '2026-06-20' })),
    ).toBe(true);
  });

  it('fecha después del rango → false', () => {
    expect(
      instanteEnVentana(ventanaBase, instante({ fecha: '2026-06-21' })),
    ).toBe(false);
  });

  it('sin horas configuradas = todo el día', () => {
    expect(instanteEnVentana(ventanaBase, instante({ hora: '00:00' }))).toBe(
      true,
    );
    expect(instanteEnVentana(ventanaBase, instante({ hora: '23:59' }))).toBe(
      true,
    );
  });

  describe('franja normal 18:00–20:00', () => {
    const v: VentanaPromo = {
      ...ventanaBase,
      horaInicio: '18:00',
      horaFin: '20:00',
    };

    it('17:59 → false', () => {
      expect(instanteEnVentana(v, instante({ hora: '17:59' }))).toBe(false);
    });
    it('18:00 (borde inicio) → true', () => {
      expect(instanteEnVentana(v, instante({ hora: '18:00' }))).toBe(true);
    });
    it('20:00 (borde fin) → true', () => {
      expect(instanteEnVentana(v, instante({ hora: '20:00' }))).toBe(true);
    });
    it('20:01 → false', () => {
      expect(instanteEnVentana(v, instante({ hora: '20:01' }))).toBe(false);
    });
  });

  describe('franja que cruza medianoche 18:00–02:00', () => {
    const v: VentanaPromo = {
      ...ventanaBase,
      horaInicio: '18:00',
      horaFin: '02:00',
    };

    it('17:59 → false', () => {
      expect(instanteEnVentana(v, instante({ hora: '17:59' }))).toBe(false);
    });
    it('23:00 → true', () => {
      expect(instanteEnVentana(v, instante({ hora: '23:00' }))).toBe(true);
    });
    it('01:59 → true', () => {
      expect(instanteEnVentana(v, instante({ hora: '01:59' }))).toBe(true);
    });
    it('02:00 (borde fin) → true', () => {
      expect(instanteEnVentana(v, instante({ hora: '02:00' }))).toBe(true);
    });
    it('02:01 → false', () => {
      expect(instanteEnVentana(v, instante({ hora: '02:01' }))).toBe(false);
    });
  });

  describe('diasSemana [2] (solo martes)', () => {
    const v: VentanaPromo = { ...ventanaBase, diasSemana: [2] };

    it('martes (diaIso 2) → true', () => {
      expect(instanteEnVentana(v, instante({ diaIso: 2 }))).toBe(true);
    });
    it('miércoles (diaIso 3) → false', () => {
      expect(instanteEnVentana(v, instante({ diaIso: 3 }))).toBe(false);
    });
  });
});

describe('evaluarPromos — canal', () => {
  it('canal null acepta ambos canales', () => {
    const p = promo({ ventana: { ...ventanaBase, canal: null } });
    expect(
      evaluarPromos({ promos: [p], lineas: [linea()], canal: 'fisico' }),
    ).toHaveLength(1);
    expect(
      evaluarPromos({ promos: [p], lineas: [linea()], canal: 'online' }),
    ).toHaveLength(1);
  });

  it("canal 'fisico' rechaza 'online'", () => {
    const p = promo({ ventana: { ...ventanaBase, canal: 'fisico' } });
    expect(
      evaluarPromos({ promos: [p], lineas: [linea()], canal: 'online' }),
    ).toHaveLength(0);
    expect(
      evaluarPromos({ promos: [p], lineas: [linea()], canal: 'fisico' }),
    ).toHaveLength(1);
  });
});

describe('evaluarPromos — porcentaje', () => {
  it('20% sobre 2 líneas del scope → una aplicación con 2 montos', () => {
    const p = promo({ valorPorcentaje: '0.20' });
    const l1 = linea({ index: 0, netoUnitario: '1000', cantidad: '2' });
    const l2 = linea({ index: 1, netoUnitario: '500', cantidad: '3' });
    const res = evaluarPromos({
      promos: [p],
      lineas: [l1, l2],
      canal: 'fisico',
    });
    expect(montos(res)).toEqual([
      { lineaIndex: 0, monto: '400' }, // 0.20 × 1000 × 2
      { lineaIndex: 1, monto: '300' }, // 0.20 × 500 × 3
    ]);
  });

  it('línea fuera del scope no aparece', () => {
    const p = promo({
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['item-a'],
        },
      ],
    });
    const dentro = linea({ index: 0, itemId: 'item-a' });
    const fuera = linea({ index: 1, itemId: 'item-b' });
    const res = evaluarPromos({
      promos: [p],
      lineas: [dentro, fuera],
      canal: 'fisico',
    });
    expect(montos(res).map((m) => m.lineaIndex)).toEqual([0]);
  });

  it('línea con instante fuera de franja no aparece aunque otra línea de la misma venta sí', () => {
    const p = promo({
      ventana: { ...ventanaBase, horaInicio: '18:00', horaFin: '20:00' },
    });
    const dentroFranja = linea({
      index: 0,
      instante: instante({ hora: '19:00' }),
    });
    const fueraFranja = linea({
      index: 1,
      instante: instante({ hora: '12:00' }),
    });
    const res = evaluarPromos({
      promos: [p],
      lineas: [dentroFranja, fueraFranja],
      canal: 'fisico',
    });
    expect(montos(res).map((m) => m.lineaIndex)).toEqual([0]);
  });

  it("scope tipoScope: 'categoria' — matchea por categoriaId, otra categoría queda afuera", () => {
    const p = promo({
      valorPorcentaje: '0.10',
      scopes: [
        {
          slot: 0,
          tipoScope: 'categoria',
          categoriaId: 'cat-bebidas',
          cantidad: 1,
          itemIds: [],
        },
      ],
    });
    const dentro = linea({
      index: 0,
      categoriaId: 'cat-bebidas',
      netoUnitario: '1000',
    });
    const fuera = linea({
      index: 1,
      categoriaId: 'cat-comida',
      netoUnitario: '2000',
    });
    const res = evaluarPromos({
      promos: [p],
      lineas: [dentro, fuera],
      canal: 'fisico',
    });
    expect(montos(res)).toEqual([{ lineaIndex: 0, monto: '100' }]);
  });
});

describe('evaluarPromos — nxm', () => {
  it('2x1: 2 cervezas $5.000 y $3.000 → 1 aplicación, monto $3.000 en la línea de la barata', () => {
    const p = nxmPromo();
    const cara = linea({ index: 0, netoUnitario: '5000' });
    const barata = linea({ index: 1, netoUnitario: '3000' });
    const res = evaluarPromos({
      promos: [p],
      lineas: [cara, barata],
      canal: 'fisico',
    });
    expect(montos(res)).toEqual([{ lineaIndex: 1, monto: '3000' }]);
  });

  it('4 unidades → 2 aplicaciones', () => {
    const p = nxmPromo();
    const lineas = [
      linea({ index: 0, netoUnitario: '5000' }),
      linea({ index: 1, netoUnitario: '4000' }),
      linea({ index: 2, netoUnitario: '3000' }),
      linea({ index: 3, netoUnitario: '2000' }),
    ];
    const res = evaluarPromos({ promos: [p], lineas, canal: 'fisico' });
    expect(res).toHaveLength(2);
    expect(res[0].montosPorLinea).toEqual([{ lineaIndex: 1, monto: '4000' }]);
    expect(res[1].montosPorLinea).toEqual([{ lineaIndex: 3, monto: '2000' }]);
  });

  it('3 unidades → 1 aplicación (grupo incompleto afuera)', () => {
    const p = nxmPromo();
    const lineas = [
      linea({ index: 0, netoUnitario: '5000' }),
      linea({ index: 1, netoUnitario: '4000' }),
      linea({ index: 2, netoUnitario: '3000' }),
    ];
    const res = evaluarPromos({ promos: [p], lineas, canal: 'fisico' });
    expect(montos(res)).toEqual([{ lineaIndex: 1, monto: '4000' }]);
  });

  it('2 unidades en la MISMA línea (cantidad 2) → monto = 1 × neto unitario en esa línea', () => {
    const p = nxmPromo();
    const l = linea({ index: 0, netoUnitario: '3000', cantidad: '2' });
    const res = evaluarPromos({ promos: [p], lineas: [l], canal: 'fisico' });
    expect(montos(res)).toEqual([{ lineaIndex: 0, monto: '3000' }]);
  });

  it("'2do al 50%' → 50% de la más barata", () => {
    const p = nxmPromo({ valorPorcentaje: '0.5' });
    const cara = linea({ index: 0, netoUnitario: '5000' });
    const barata = linea({ index: 1, netoUnitario: '3000' });
    const res = evaluarPromos({
      promos: [p],
      lineas: [cara, barata],
      canal: 'fisico',
    });
    expect(montos(res)).toEqual([{ lineaIndex: 1, monto: '1500' }]);
  });

  it('cantidad fraccionaria 0.7 no aporta unidades a un nxm', () => {
    const p = nxmPromo();
    const fraccionaria = linea({
      index: 0,
      netoUnitario: '5000',
      cantidad: '0.7',
    });
    const entera = linea({ index: 1, netoUnitario: '3000', cantidad: '1' });
    const res = evaluarPromos({
      promos: [p],
      lineas: [fraccionaria, entera],
      canal: 'fisico',
    });
    // Solo 1 unidad total (la fraccionaria no aporta ninguna) — no alcanza cadaN=2.
    expect(res).toHaveLength(0);
  });

  it('empate de precios → resultado determinista (desempate por index ascendente)', () => {
    const p = nxmPromo();
    const a = linea({ index: 0, netoUnitario: '3000' });
    const b = linea({ index: 1, netoUnitario: '3000' });
    const res = evaluarPromos({ promos: [p], lineas: [a, b], canal: 'fisico' });
    // Empatadas en neto: el orden lo fija el índice ascendente, así que la
    // "más barata" del grupo (última tras ordenar) es siempre la de mayor índice.
    expect(montos(res)).toEqual([{ lineaIndex: 1, monto: '3000' }]);
  });

  it('UNA línea con cantidad=4 y cadaN=2 → 2 aplicaciones (no chocan entre sí, greedy por conteo)', () => {
    const p = nxmPromo();
    const l = linea({ index: 0, netoUnitario: '5000', cantidad: '4' });
    const res = evaluarPromos({ promos: [p], lineas: [l], canal: 'fisico' });

    // 4 unidades / cadaN=2 = 2 grupos completos, ambos con la misma línea
    // (es la única disponible): $5.000 cada uno, $10.000 en total. Con el
    // greedy anterior (conflicto por LÍNEA, no por conteo de unidades) el
    // segundo grupo se descartaba por "chocar" con el primero pese a usar
    // unidades físicas distintas — bug medido, esto lo fija.
    expect(res).toHaveLength(2);
    expect(res[0].montosPorLinea).toEqual([{ lineaIndex: 0, monto: '5000' }]);
    expect(res[1].montosPorLinea).toEqual([{ lineaIndex: 0, monto: '5000' }]);
    expect(sumaMontos(res).toString()).toBe('10000');
  });
});

function sumaMontos(res: AplicacionPromo[]): Decimal {
  return res
    .flatMap((ap) => ap.montosPorLinea)
    .reduce((a, m) => a.plus(m.monto), new Decimal(0));
}

describe('evaluarPromos — precio_fijo (combo)', () => {
  it('1 pizza + 1 bebida = $9.990: descuento a prorrata del neto, suma exacta', () => {
    const p = precioFijoPromo();
    const pizza = linea({ index: 0, itemId: 'pizza', netoUnitario: '8000' });
    const bebida = linea({ index: 1, itemId: 'bebida', netoUnitario: '3500' });

    const res = evaluarPromos({
      promos: [p],
      lineas: [pizza, bebida],
      canal: 'fisico',
    });

    expect(res).toHaveLength(1);
    const porLinea = new Map(
      res[0].montosPorLinea.map((m) => [m.lineaIndex, m.monto]),
    );
    expect(porLinea.size).toBe(2);

    // Suma exacta = 11.500 − 9.990 = 1.510, verificado con Decimal.
    expect(sumaMontos(res).toString()).toBe('1510');

    // A prorrata del neto: pizza 8000/11500, bebida el resto.
    expect(
      new Decimal(porLinea.get(0) as string).toDecimalPlaces(2).toString(),
    ).toBe('1050.43');
    expect(
      new Decimal(porLinea.get(1) as string).toDecimalPlaces(2).toString(),
    ).toBe('459.57');
  });

  it('reparto con residuo — caso dedicado 333/333/334, suma exacta', () => {
    const p = precioFijoPromo({
      valorMonto: '9000',
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['a'],
        },
        {
          slot: 1,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['b'],
        },
        {
          slot: 2,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['c'],
        },
      ],
    });
    const la = linea({ index: 0, itemId: 'a', netoUnitario: '3330' });
    const lb = linea({ index: 1, itemId: 'b', netoUnitario: '3330' });
    const lc = linea({ index: 2, itemId: 'c', netoUnitario: '3340' });

    const res = evaluarPromos({
      promos: [p],
      lineas: [la, lb, lc],
      canal: 'fisico',
    });

    expect(res).toHaveLength(1);
    const porLinea = new Map(
      res[0].montosPorLinea.map((m) => [m.lineaIndex, m.monto]),
    );
    // (3330+3330+3340) − 9000 = 1000, repartido en proporción 3330/3330/3340.
    expect(porLinea.get(0)).toBe('333');
    expect(porLinea.get(1)).toBe('333');
    expect(porLinea.get(2)).toBe('334');
    expect(sumaMontos(res).toString()).toBe('1000');
  });

  it('reparto sin división exacta (pesos iguales) — la suma sigue siendo exacta pese al residuo de precisión de Decimal', () => {
    const p = precioFijoPromo({
      valorMonto: '14000',
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['a'],
        },
        {
          slot: 1,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['b'],
        },
        {
          slot: 2,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['c'],
        },
      ],
    });
    const la = linea({ index: 0, itemId: 'a', netoUnitario: '5000' });
    const lb = linea({ index: 1, itemId: 'b', netoUnitario: '5000' });
    const lc = linea({ index: 2, itemId: 'c', netoUnitario: '5000' });

    const res = evaluarPromos({
      promos: [p],
      lineas: [la, lb, lc],
      canal: 'fisico',
    });

    expect(res).toHaveLength(1);
    // (5000×3) − 14000 = 1000 repartido en 1/3 exactos (33.33...3 repetido):
    // sin la corrección de residuo, la suma quedaría en 999.99999999999999999.
    expect(sumaMontos(res).toString()).toBe('1000');
  });

  it('slot con cantidad: 2 exige 2 unidades de ese slot', () => {
    const p = precioFijoPromo({
      valorMonto: '15000',
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 2,
          itemIds: ['pizza'],
        },
        {
          slot: 1,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['bebida'],
        },
      ],
    });
    const pizza1 = linea({ index: 0, itemId: 'pizza', netoUnitario: '8000' });
    const pizza2 = linea({ index: 1, itemId: 'pizza', netoUnitario: '6000' });
    const bebida = linea({ index: 2, itemId: 'bebida', netoUnitario: '3500' });

    // Con una sola pizza no alcanza el slot (cantidad: 2) → no arma combo.
    expect(
      evaluarPromos({ promos: [p], lineas: [pizza1, bebida], canal: 'fisico' }),
    ).toHaveLength(0);

    // Con las dos pizzas sí: descuento = (8000+6000+3500) − 15000 = 2500.
    const res = evaluarPromos({
      promos: [p],
      lineas: [pizza1, pizza2, bebida],
      canal: 'fisico',
    });
    expect(res).toHaveLength(1);
    expect(sumaMontos(res).toString()).toBe('2500');
    expect(res[0].montosPorLinea.map((m) => m.lineaIndex).sort()).toEqual([
      0, 1, 2,
    ]);
  });

  it('con candidatos de sobra en un slot, entra la unidad más cara (decisión 3)', () => {
    const p = precioFijoPromo({ valorMonto: '9000' });
    const pizzaCara = linea({
      index: 0,
      itemId: 'pizza',
      netoUnitario: '8000',
    });
    const pizzaBarata = linea({
      index: 1,
      itemId: 'pizza',
      netoUnitario: '6000',
    });
    const bebida = linea({ index: 2, itemId: 'bebida', netoUnitario: '3500' });

    const res = evaluarPromos({
      promos: [p],
      lineas: [pizzaCara, pizzaBarata, bebida],
      canal: 'fisico',
    });

    expect(res).toHaveLength(1);
    const lineasUsadas = res[0].montosPorLinea.map((m) => m.lineaIndex).sort();
    // Toma la pizza de $8.000 (índice 0), deja la de $6.000 (índice 1) afuera.
    expect(lineasUsadas).toEqual([0, 2]);
    // (8000+3500) − 9000 = 2500 — más que si hubiese tomado la de $6.000
    // ((6000+3500) − 9000 = 500).
    expect(sumaMontos(res).toString()).toBe('2500');
  });

  it('combo que encarece (valorMonto ≥ Σ netos) → 0 aplicaciones', () => {
    const p = precioFijoPromo({ valorMonto: '20000' });
    const pizza = linea({ index: 0, itemId: 'pizza', netoUnitario: '8000' });
    const bebida = linea({ index: 1, itemId: 'bebida', netoUnitario: '3500' });
    const res = evaluarPromos({
      promos: [p],
      lineas: [pizza, bebida],
      canal: 'fisico',
    });
    expect(res).toHaveLength(0);
  });

  it('repetible: unidades para 2 combos → 2 aplicaciones', () => {
    const p = precioFijoPromo({ valorMonto: '9000' });
    const pizza1 = linea({ index: 0, itemId: 'pizza', netoUnitario: '8000' });
    const pizza2 = linea({ index: 1, itemId: 'pizza', netoUnitario: '7000' });
    const bebida1 = linea({
      index: 2,
      itemId: 'bebida',
      netoUnitario: '3500',
    });
    const bebida2 = linea({
      index: 3,
      itemId: 'bebida',
      netoUnitario: '3000',
    });

    const res = evaluarPromos({
      promos: [p],
      lineas: [pizza1, pizza2, bebida1, bebida2],
      canal: 'fisico',
    });
    expect(res).toHaveLength(2);
    // Combo 1 con las más caras (8000+3500), combo 2 con lo que sobró (7000+3000).
    expect(sumaMontos([res[0]]).toString()).toBe('2500'); // 11500 − 9000
    expect(sumaMontos([res[1]]).toString()).toBe('1000'); // 10000 − 9000
  });

  it('repetible con pizza y bebida en UNA sola línea cada una (cantidad=2) → 2 combos, suma exacta', () => {
    const p = precioFijoPromo();
    // Pizza: una línea con cantidad=2 (no dos líneas separadas). Bebida: ídem.
    const pizza = linea({
      index: 0,
      itemId: 'pizza',
      netoUnitario: '8000',
      cantidad: '2',
    });
    const bebida = linea({
      index: 1,
      itemId: 'bebida',
      netoUnitario: '3500',
      cantidad: '2',
    });

    const res = evaluarPromos({
      promos: [p],
      lineas: [pizza, bebida],
      canal: 'fisico',
    });

    // Cada línea aporta 2 unidades → alcanza para 2 combos (1 pizza + 1
    // bebida cada uno). Con el greedy anterior (conflicto por LÍNEA) el
    // segundo combo chocaba con el primero por repetir lineaIndex 0 y 1 —
    // bug medido, esto lo fija.
    expect(res).toHaveLength(2);
    expect(sumaMontos([res[0]]).toString()).toBe('1510'); // 11500 − 9990
    expect(sumaMontos([res[1]]).toString()).toBe('1510');
    expect(sumaMontos(res).toString()).toBe('3020');
  });
});

describe('evaluarPromos — greedy entre promos', () => {
  it('la misma cerveza califica para 2x1 y happy hour → gana el 2x1 (mayor monto)', () => {
    const cara = linea({ index: 0, itemId: 'cerveza', netoUnitario: '5000' });
    const barata = linea({ index: 1, itemId: 'cerveza', netoUnitario: '3000' });

    const dosPorUno = nxmPromo({
      id: 'promo-2x1',
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['cerveza'],
        },
      ],
    });
    // 2x1: barata (índice 1) recibe 100% de su propio neto = 3000.

    const happyHour = promo({
      id: 'promo-hh',
      valorPorcentaje: '0.10',
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['cerveza'],
        },
      ],
    });
    // Happy hour: 10% de AMBAS líneas = 500 + 300 = 800.

    const res = evaluarPromos({
      promos: [dosPorUno, happyHour],
      lineas: [cara, barata],
      canal: 'fisico',
    });

    // 3000 (2x1) > 800 (happy hour) → gana el 2x1 entero; la happy hour, que
    // también reclamaba la línea 1 (ya tomada), se descarta completa.
    expect(res).toHaveLength(1);
    expect(res[0].tipo).toBe('nxm');
    expect(res[0].montosPorLinea).toEqual([{ lineaIndex: 1, monto: '3000' }]);
  });

  it('con los montos invertidos, gana la otra promo', () => {
    const cara = linea({ index: 0, itemId: 'cerveza', netoUnitario: '5000' });
    const barata = linea({ index: 1, itemId: 'cerveza', netoUnitario: '3000' });

    const dosPorUno = nxmPromo({
      id: 'promo-2x1',
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['cerveza'],
        },
      ],
    });
    // 2x1: 3000 (100% de la barata).

    const happyHour = promo({
      id: 'promo-hh',
      valorPorcentaje: '0.5',
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['cerveza'],
        },
      ],
    });
    // Happy hour boosteada al 50%: 2500 + 1500 = 4000 > 3000 del 2x1.

    const res = evaluarPromos({
      promos: [dosPorUno, happyHour],
      lineas: [cara, barata],
      canal: 'fisico',
    });

    expect(res).toHaveLength(1);
    expect(res[0].tipo).toBe('porcentaje');
    expect(res[0].montosPorLinea).toEqual([
      { lineaIndex: 0, monto: '2500' },
      { lineaIndex: 1, monto: '1500' },
    ]);
  });

  it('empate de monto → desempate estable por id de promo ascendente', () => {
    const cara = linea({
      index: 0,
      itemId: 'cerveza-cara',
      netoUnitario: '5000',
    });
    const barata = linea({
      index: 1,
      itemId: 'cerveza-barata',
      netoUnitario: '3000',
    });

    const dosPorUno = nxmPromo({
      id: 'promo-a',
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['cerveza-cara', 'cerveza-barata'],
        },
      ],
    });
    // 2x1: 3000 (100% de la barata, línea 1).

    const happyHour = promo({
      id: 'promo-b',
      valorPorcentaje: '1', // 100% de la línea 1 → también 3000: empate exacto.
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['cerveza-barata'],
        },
      ],
    });

    const res = evaluarPromos({
      promos: [dosPorUno, happyHour],
      lineas: [cara, barata],
      canal: 'fisico',
    });

    // Empate 3000 vs 3000: gana 'promo-a' (id menor), aunque 'promo-b' se
    // haya evaluado después en el array de entrada.
    expect(res).toHaveLength(1);
    expect(res[0].promocionId).toBe('promo-a');
  });

  it('una unidad ya usada por la aplicación #1 de una promo no entra en la #2 de la misma', () => {
    const p = nxmPromo({ id: 'promo-2x1' });
    const lineas = [
      linea({ index: 0, netoUnitario: '5000' }),
      linea({ index: 1, netoUnitario: '4000' }),
      linea({ index: 2, netoUnitario: '3000' }),
      linea({ index: 3, netoUnitario: '2000' }),
    ];
    const res = evaluarPromos({ promos: [p], lineas, canal: 'fisico' });

    // 4 unidades → 2 aplicaciones (índices 1 y 3, las "baratas" de cada
    // grupo); ninguna línea se repite entre ellas, así que ambas sobreviven
    // el greedy intactas.
    expect(res).toHaveLength(2);
    const indices = res.flatMap((ap) =>
      ap.montosPorLinea.map((m) => m.lineaIndex),
    );
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices.sort()).toEqual([1, 3]);
  });

  it('conteo parcial: una promo toma 2 de una línea cantidad=3, y otro grupo (de otra promo) toma la unidad que sobra', () => {
    // Bar: cerveza con cantidad=3 (una sola línea), refresco con cantidad=1.
    const cerveza = linea({
      index: 0,
      itemId: 'cerveza',
      netoUnitario: '5000',
      cantidad: '3',
    });
    const refresco = linea({
      index: 1,
      itemId: 'refresco',
      netoUnitario: '4000',
      cantidad: '1',
    });

    const promoA = nxmPromo({
      id: 'promo-a',
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['cerveza'],
        },
      ],
    });
    // Solo ve la cerveza: 3 unidades → 1 grupo completo, consume 2 de las 3
    // ($5.000, línea 0).

    const promoB = nxmPromo({
      id: 'promo-b',
      scopes: [
        {
          slot: 0,
          tipoScope: 'items',
          categoriaId: null,
          cantidad: 1,
          itemIds: ['cerveza', 'refresco'],
        },
      ],
    });
    // Ve cerveza Y refresco: 3+1 = 4 unidades → 2 grupos. El primer grupo
    // (2 cervezas) pide las MISMAS 2 unidades que promoA — choca y se
    // descarta. El segundo grupo (la cerveza que sobra + el refresco) solo
    // necesita 1 unidad más de la línea 0 (lo que quedó libre) — no choca.

    const res = evaluarPromos({
      promos: [promoA, promoB],
      lineas: [cerveza, refresco],
      canal: 'fisico',
    });

    expect(res).toHaveLength(2);
    const porPromo = new Map(res.map((ap) => [ap.promocionId, ap]));
    expect(porPromo.get('promo-a')?.montosPorLinea).toEqual([
      { lineaIndex: 0, monto: '5000' },
    ]);
    // El grupo de promo-b que pisaba la línea 0 entera (2 unidades) se
    // descarta; sobrevive el que solo pedía la unidad restante + el refresco.
    expect(porPromo.get('promo-b')?.montosPorLinea).toEqual([
      { lineaIndex: 1, monto: '4000' },
    ]);
  });
});
