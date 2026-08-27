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
});
