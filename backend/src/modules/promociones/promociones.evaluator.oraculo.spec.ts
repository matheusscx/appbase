import Decimal from 'decimal.js';
import {
  evaluarPromos,
  instanteEnVentana,
  type AplicacionPromo,
  type InstanteLocal,
  type LineaPromo,
  type PromoElegible,
  type ScopePromoResuelto,
  type VentanaPromo,
} from './promociones.evaluator';

/**
 * **El evaluador cuenta unidades por lote; este test prueba que da la misma
 * plata que cuando las explotaba.**
 *
 * Hasta el 2026-10-06 `evaluarNxm` y `evaluarPrecioFijo` armaban un array con
 * un elemento por unidad y lo ordenaban, y `cantidad` la elige el cliente: una
 * línea de 10⁶ unidades con un 2x1 colgaba el backend de todos los tenants.
 * El refactor a lotes es de conducta igual, y "salida idéntica" es una
 * afirmación sobre plata: se prueba, no se asegura.
 *
 * El oráculo de abajo es **el evaluador tal como estaba en `6cecf160`**, sin
 * los comentarios: es la definición de la conducta, no se corrige ni se
 * moderniza. Si un cambio de reglas de promociones lo hace divergir, el
 * cambio es deliberado y el oráculo se reemplaza en el mismo commit, diciendo
 * por qué.
 */

// ── Oráculo: el evaluador que explotaba unidades (6cecf160) ─────────────────

const ZERO = new Decimal(0);

interface CandidataGreedy {
  aplicacion: AplicacionPromo;
  unidadesPorLinea: { lineaIndex: number; unidades: number }[];
}

function perteneceAScope(
  scope: ScopePromoResuelto,
  linea: LineaPromo,
): boolean {
  switch (scope.tipoScope) {
    case 'venta':
      return true;
    case 'categoria':
      return linea.categoriaId === scope.categoriaId;
    case 'items':
      return scope.itemIds.includes(linea.itemId);
  }
}

function evaluarPorcentaje(
  promo: PromoElegible,
  scope: ScopePromoResuelto,
  lineas: LineaPromo[],
): CandidataGreedy[] {
  const valor = new Decimal(promo.valorPorcentaje as string);
  const montosPorLinea: { lineaIndex: number; monto: string }[] = [];
  const unidadesPorLinea: { lineaIndex: number; unidades: number }[] = [];

  for (const linea of lineas) {
    if (!perteneceAScope(scope, linea)) continue;
    if (!instanteEnVentana(promo.ventana, linea.instante)) continue;

    const monto = valor.times(linea.precioListaUnitario).times(linea.cantidad);
    if (monto.greaterThan(ZERO)) {
      montosPorLinea.push({ lineaIndex: linea.index, monto: monto.toString() });
      unidadesPorLinea.push({
        lineaIndex: linea.index,
        unidades: new Decimal(linea.cantidad).floor().toNumber(),
      });
    }
  }

  if (montosPorLinea.length === 0) return [];
  return [
    {
      aplicacion: {
        promocionId: promo.id,
        nombre: promo.nombre,
        tipo: promo.tipo,
        valorEfectivo: promo.valorPorcentaje as string,
        montosPorLinea,
      },
      unidadesPorLinea,
    },
  ];
}

interface UnidadNxm {
  lineaIndex: number;
  precioLista: Decimal;
}

function evaluarNxm(
  promo: PromoElegible,
  scope: ScopePromoResuelto,
  lineas: LineaPromo[],
): CandidataGreedy[] {
  const cadaN = promo.cadaN as number;
  const valor = new Decimal(promo.valorPorcentaje as string);

  const unidades: UnidadNxm[] = [];
  for (const linea of lineas) {
    if (!perteneceAScope(scope, linea)) continue;
    if (!instanteEnVentana(promo.ventana, linea.instante)) continue;

    const cantidadEntera = new Decimal(linea.cantidad).floor().toNumber();
    const precioLista = new Decimal(linea.precioListaUnitario);
    for (let u = 0; u < cantidadEntera; u++) {
      unidades.push({ lineaIndex: linea.index, precioLista });
    }
  }

  unidades.sort((a, b) => {
    const cmp = b.precioLista.comparedTo(a.precioLista);
    return cmp !== 0 ? cmp : a.lineaIndex - b.lineaIndex;
  });

  const gruposCompletos = Math.floor(unidades.length / cadaN);
  const candidatas: CandidataGreedy[] = [];

  for (let g = 0; g < gruposCompletos; g++) {
    const inicio = g * cadaN;
    const grupo = unidades.slice(inicio, inicio + cadaN);
    const barata = grupo[grupo.length - 1];
    const monto = valor.times(barata.precioLista);
    if (monto.greaterThan(ZERO)) {
      const conteo = new Map<number, number>();
      for (const u of grupo) {
        conteo.set(u.lineaIndex, (conteo.get(u.lineaIndex) ?? 0) + 1);
      }
      candidatas.push({
        aplicacion: {
          promocionId: promo.id,
          nombre: promo.nombre,
          tipo: promo.tipo,
          valorEfectivo: promo.valorPorcentaje as string,
          montosPorLinea: [
            { lineaIndex: barata.lineaIndex, monto: monto.toString() },
          ],
        },
        unidadesPorLinea: [...conteo.entries()].map(
          ([lineaIndex, unidades]) => ({ lineaIndex, unidades }),
        ),
      });
    }
  }

  return candidatas;
}

function evaluarPrecioFijo(
  promo: PromoElegible,
  lineas: LineaPromo[],
): CandidataGreedy[] {
  const valorMonto = new Decimal(promo.valorMonto as string);

  const pools = promo.scopes.map((scope) => {
    const unidades: UnidadNxm[] = [];
    for (const linea of lineas) {
      if (!perteneceAScope(scope, linea)) continue;
      if (!instanteEnVentana(promo.ventana, linea.instante)) continue;

      const cantidadEntera = new Decimal(linea.cantidad).floor().toNumber();
      const precioLista = new Decimal(linea.precioListaUnitario);
      for (let u = 0; u < cantidadEntera; u++) {
        unidades.push({ lineaIndex: linea.index, precioLista });
      }
    }
    unidades.sort((a, b) => {
      const cmp = b.precioLista.comparedTo(a.precioLista);
      return cmp !== 0 ? cmp : a.lineaIndex - b.lineaIndex;
    });
    return { cantidad: scope.cantidad, unidades, cursor: 0 };
  });

  const candidatas: CandidataGreedy[] = [];

  for (;;) {
    const tomas: UnidadNxm[][] = [];
    let alcanza = true;
    for (const pool of pools) {
      const grupo = pool.unidades.slice(
        pool.cursor,
        pool.cursor + pool.cantidad,
      );
      if (grupo.length < pool.cantidad) {
        alcanza = false;
        break;
      }
      tomas.push(grupo);
    }
    if (!alcanza) break;

    const unidadesCombo = tomas.flat();
    const sumaListas = unidadesCombo.reduce(
      (a, u) => a.plus(u.precioLista),
      ZERO,
    );
    const descuento = sumaListas.minus(valorMonto);
    if (!descuento.greaterThan(ZERO)) break;

    for (const pool of pools) pool.cursor += pool.cantidad;

    const pesosPorLinea = new Map<number, Decimal>();
    const conteoPorLinea = new Map<number, number>();
    for (const u of unidadesCombo) {
      pesosPorLinea.set(
        u.lineaIndex,
        (pesosPorLinea.get(u.lineaIndex) ?? ZERO).plus(u.precioLista),
      );
      conteoPorLinea.set(
        u.lineaIndex,
        (conteoPorLinea.get(u.lineaIndex) ?? 0) + 1,
      );
    }
    const aportes = [...pesosPorLinea.entries()]
      .map(([lineaIndex, peso]) => ({ lineaIndex, peso }))
      .sort((a, b) => a.lineaIndex - b.lineaIndex);

    candidatas.push({
      aplicacion: {
        promocionId: promo.id,
        nombre: promo.nombre,
        tipo: promo.tipo,
        valorEfectivo: promo.valorMonto as string,
        montosPorLinea: repartirDescuentoCombo(descuento, aportes),
      },
      unidadesPorLinea: [...conteoPorLinea.entries()].map(
        ([lineaIndex, unidades]) => ({ lineaIndex, unidades }),
      ),
    });
  }

  return candidatas;
}

function repartirDescuentoCombo(
  descuento: Decimal,
  aportes: { lineaIndex: number; peso: Decimal }[],
): { lineaIndex: number; monto: string }[] {
  const total = aportes.reduce((a, p) => a.plus(p.peso), ZERO);
  const finas = aportes.map((a) => descuento.times(a.peso).dividedBy(total));
  const suma = finas.reduce((a, f) => a.plus(f), ZERO);
  const sobra = descuento.minus(suma);

  if (!sobra.isZero()) {
    const orden = aportes
      .map((a, i) => ({
        i,
        lineaIndex: a.lineaIndex,
        resto: finas[i].minus(finas[i].floor()),
      }))
      .sort((x, y) => {
        const cmp = y.resto.comparedTo(x.resto);
        return cmp !== 0 ? cmp : x.lineaIndex - y.lineaIndex;
      });
    finas[orden[0].i] = finas[orden[0].i].plus(sobra);
  }

  return aportes.map((a, i) => ({
    lineaIndex: a.lineaIndex,
    monto: finas[i].toString(),
  }));
}

function evaluarPromosOraculo(input: {
  promos: PromoElegible[];
  lineas: LineaPromo[];
  canal: 'fisico' | 'online';
}): AplicacionPromo[] {
  const capacidadPorLinea = new Map<number, number>();
  for (const linea of input.lineas) {
    capacidadPorLinea.set(
      linea.index,
      new Decimal(linea.cantidad).floor().toNumber(),
    );
  }

  const candidatas: {
    candidata: CandidataGreedy;
    monto: Decimal;
    promoId: string;
    orden: number;
  }[] = [];
  let orden = 0;

  for (const promo of input.promos) {
    if (promo.ventana.canal != null && promo.ventana.canal !== input.canal) {
      continue;
    }

    let generadas: CandidataGreedy[] = [];
    switch (promo.tipo) {
      case 'porcentaje': {
        const scope = promo.scopes[0];
        if (scope) generadas = evaluarPorcentaje(promo, scope, input.lineas);
        break;
      }
      case 'nxm': {
        const scope = promo.scopes[0];
        if (scope) generadas = evaluarNxm(promo, scope, input.lineas);
        break;
      }
      case 'precio_fijo':
        generadas = evaluarPrecioFijo(promo, input.lineas);
        break;
    }

    for (const candidata of generadas) {
      const monto = candidata.aplicacion.montosPorLinea.reduce(
        (a, m) => a.plus(m.monto),
        ZERO,
      );
      candidatas.push({
        candidata,
        monto,
        promoId: promo.id,
        orden: orden++,
      });
    }
  }

  candidatas.sort((a, b) => {
    const cmpMonto = b.monto.comparedTo(a.monto);
    if (cmpMonto !== 0) return cmpMonto;
    if (a.promoId !== b.promoId) return a.promoId < b.promoId ? -1 : 1;
    return a.orden - b.orden;
  });

  const consumidasPorLinea = new Map<number, number>();
  const resultado: AplicacionPromo[] = [];
  for (const { candidata } of candidatas) {
    const alcanza = candidata.unidadesPorLinea.every(
      ({ lineaIndex, unidades }) => {
        const capacidad = capacidadPorLinea.get(lineaIndex) ?? 0;
        const consumidas = consumidasPorLinea.get(lineaIndex) ?? 0;
        return consumidas + unidades <= capacidad;
      },
    );
    if (!alcanza) continue;

    for (const { lineaIndex, unidades } of candidata.unidadesPorLinea) {
      consumidasPorLinea.set(
        lineaIndex,
        (consumidasPorLinea.get(lineaIndex) ?? 0) + unidades,
      );
    }
    resultado.push(candidata.aplicacion);
  }

  return resultado;
}

// ── Generador determinista de carritos ──────────────────────────────────────

/** mulberry32: el mismo seed da los mismos casos en cualquier máquina. */
function generador(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VENTANA: VentanaPromo = {
  fechaInicio: '2026-06-10',
  fechaFin: '2026-06-20',
  horaInicio: null,
  horaFin: null,
  diasSemana: null,
  canal: null,
};
const DENTRO: InstanteLocal = { fecha: '2026-06-15', hora: '12:00', diaIso: 1 };
const FUERA: InstanteLocal = { fecha: '2026-06-25', hora: '12:00', diaIso: 4 };

// Precios con empates entre líneas, decimales largos y el cero.
const PRECIOS = [
  '1000',
  '1000',
  '500',
  '993',
  '1000.5',
  '0.3333333333',
  '12345.6789012345678',
  '2500',
  '0',
];
// Enteros, fraccionarios (venta al peso: solo cuenta ⌊cantidad⌋) y grandes.
const CANTIDADES = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0.7',
  '1.5',
  '2.9999',
  '3.0001',
  '4.5',
  '10.0000',
  '199',
  '1000',
  '2047',
];

function elegir<T>(r: () => number, opciones: readonly T[]): T {
  return opciones[Math.floor(r() * opciones.length)];
}

function scopeAlAzar(r: () => number, slot: number): ScopePromoResuelto {
  const tipoScope = elegir(r, ['venta', 'categoria', 'items'] as const);
  return {
    slot,
    tipoScope,
    categoriaId: tipoScope === 'categoria' ? 'cat-1' : null,
    cantidad: 1 + Math.floor(r() * 3),
    itemIds: tipoScope === 'items' ? elegir(r, [['A'], ['A', 'B']]) : [],
  };
}

function promoAlAzar(r: () => number, id: string): PromoElegible {
  const tipo = elegir(r, ['porcentaje', 'nxm', 'precio_fijo'] as const);
  const ventana: VentanaPromo = {
    ...VENTANA,
    canal: elegir(r, [null, null, 'fisico', 'online']),
  };
  if (tipo === 'precio_fijo') {
    const slots = 1 + Math.floor(r() * 3);
    return {
      id,
      nombre: `Combo ${id}`,
      tipo,
      valorPorcentaje: null,
      cadaN: null,
      valorMonto: elegir(r, ['1500', '2000', '999', '0.5', '100000']),
      ventana,
      scopes: Array.from({ length: slots }, (_, s) => scopeAlAzar(r, s)),
    };
  }
  return {
    id,
    nombre: `${tipo} ${id}`,
    tipo,
    valorPorcentaje:
      tipo === 'nxm'
        ? elegir(r, ['1', '0.5', '0.25', '0'])
        : elegir(r, ['0.2', '0.1', '1']),
    cadaN: tipo === 'nxm' ? 2 + Math.floor(r() * 3) : null,
    valorMonto: null,
    ventana,
    scopes: [scopeAlAzar(r, 0)],
  };
}

function carritoAlAzar(r: () => number): Parameters<typeof evaluarPromos>[0] {
  const lineas: LineaPromo[] = Array.from(
    { length: 1 + Math.floor(r() * 6) },
    (_, index) => ({
      index,
      itemId: elegir(r, ['A', 'B', 'C', 'D']),
      categoriaId: elegir(r, ['cat-1', 'cat-2', null]),
      cantidad: elegir(r, CANTIDADES),
      precioListaUnitario: elegir(r, PRECIOS),
      instante: r() < 0.85 ? DENTRO : FUERA,
    }),
  );
  // Ids desordenados a propósito: el desempate del greedy es por id de promo.
  const ids = ['p3', 'p1', 'p4', 'p2'];
  const promos = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) =>
    promoAlAzar(r, ids[i]),
  );
  return { promos, lineas, canal: elegir(r, ['fisico', 'online'] as const) };
}

function linea(
  index: number,
  cantidad: string,
  precioListaUnitario: string,
  itemId = 'A',
): LineaPromo {
  return {
    index,
    itemId,
    categoriaId: 'cat-1',
    cantidad,
    precioListaUnitario,
    instante: DENTRO,
  };
}

function nxm(cadaN: number, valorPorcentaje = '1'): PromoElegible {
  return {
    id: 'p-nxm',
    nombre: `${cadaN}x`,
    tipo: 'nxm',
    valorPorcentaje,
    cadaN,
    valorMonto: null,
    ventana: VENTANA,
    scopes: [
      {
        slot: 0,
        tipoScope: 'venta',
        categoriaId: null,
        cantidad: 1,
        itemIds: [],
      },
    ],
  };
}

function combo(valorMonto: string, cantidades: number[]): PromoElegible {
  return {
    id: 'p-combo',
    nombre: 'Combo',
    tipo: 'precio_fijo',
    valorPorcentaje: null,
    cadaN: null,
    valorMonto,
    ventana: VENTANA,
    scopes: cantidades.map((cantidad, slot) => ({
      slot,
      tipoScope: 'items' as const,
      categoriaId: null,
      cantidad,
      itemIds: [slot === 0 ? 'A' : 'B'],
    })),
  };
}

function mismaSalida(input: Parameters<typeof evaluarPromos>[0]): void {
  expect(evaluarPromos(input)).toEqual(evaluarPromosOraculo(input));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('evaluarPromos — misma salida que el evaluador que explotaba unidades', () => {
  it.each([2, 3, 4, 5])(
    'nxm cadaN=%i: en el borde de cada grupo, en una línea y partido en dos',
    (cadaN) => {
      for (const n of [
        cadaN - 1,
        cadaN,
        cadaN + 1,
        2 * cadaN - 1,
        2 * cadaN,
        2 * cadaN + 1,
      ]) {
        mismaSalida({
          promos: [nxm(cadaN)],
          lineas: [linea(0, String(n), '1000')],
          canal: 'fisico',
        });
        for (let k = 0; k <= n; k++) {
          mismaSalida({
            promos: [nxm(cadaN, '0.5')],
            lineas: [
              linea(0, String(k), '700'),
              linea(1, String(n - k), '1000'),
            ],
            canal: 'fisico',
          });
        }
      }
    },
  );

  it('cantidades fraccionarias: solo cuenta la parte entera, y el porcentaje toma la línea entera', () => {
    for (const cantidad of [
      '0.7',
      '1.9999',
      '2.0001',
      '3.5',
      '4.0000',
      '7.25',
    ]) {
      mismaSalida({
        promos: [nxm(2), combo('1500', [1, 1])],
        lineas: [
          linea(0, cantidad, '1000'),
          linea(1, '2.5', '800', 'B'),
          linea(2, cantidad, '1000'),
        ],
        canal: 'fisico',
      });
    }
  });

  it('varias líneas del mismo ítem con precios distintos y empatados', () => {
    mismaSalida({
      promos: [nxm(3, '0.5')],
      lineas: [
        linea(0, '4', '1000'),
        linea(1, '5', '993'),
        linea(2, '3', '1000'),
        linea(3, '2', '1000.5'),
      ],
      canal: 'fisico',
    });
  });

  it('combos repetidos que cruzan de una línea a otra dentro del slot, con slots de 1 a 3 unidades', () => {
    for (const cantidades of [
      [1, 1],
      [2, 1],
      [3, 2],
      [1, 3],
    ]) {
      mismaSalida({
        promos: [combo('1500', cantidades)],
        lineas: [
          linea(0, '7', '1000'),
          linea(1, '4', '900'),
          linea(2, '5', '800', 'B'),
          linea(3, '6', '850', 'B'),
        ],
        canal: 'fisico',
      });
    }
  });

  /**
   * Con 20 cifras significativas —la precisión por defecto de `Decimal`—
   * sumar 7 veces un precio no da lo mismo que multiplicarlo por 7: cada suma
   * redondea. El combo suma unidad por unidad, como cuando las explotaba.
   */
  it('combo con un precio de 20 cifras significativas: la suma va unidad por unidad', () => {
    mismaSalida({
      promos: [combo('1', [7])],
      lineas: [linea(0, '14', '9.8765432109876543219')],
      canal: 'fisico',
    });
  });

  it('cantidades grandes: 20.000 unidades con 2x1 y con combo, mezcladas con un porcentaje', () => {
    mismaSalida({
      promos: [nxm(2), combo('1500', [2, 1])],
      lineas: [
        linea(0, '20000', '1000'),
        linea(1, '20000', '1000', 'B'),
        linea(2, '3', '1200'),
      ],
      canal: 'fisico',
    });
  });

  it('4.000 carritos generados: promos mezcladas, scopes que se pisan, franjas y canales', () => {
    const r = generador(20261006);
    const conAplicaciones = { porcentaje: 0, nxm: 0, precio_fijo: 0 };
    for (let caso = 0; caso < 4000; caso++) {
      const input = carritoAlAzar(r);
      const salida = evaluarPromos(input);
      expect({ caso, salida }).toEqual({
        caso,
        salida: evaluarPromosOraculo(input),
      });
      for (const tipo of new Set(salida.map((a) => a.tipo))) {
        conAplicaciones[tipo as keyof typeof conAplicaciones]++;
      }
    }
    // Que el generador no sea decorativo: cada tipo tiene que haber ganado
    // aplicaciones en una parte apreciable de los casos.
    expect(conAplicaciones.porcentaje).toBeGreaterThan(400);
    expect(conAplicaciones.nxm).toBeGreaterThan(400);
    expect(conAplicaciones.precio_fijo).toBeGreaterThan(400);
  });
});

describe('evaluarPromos — una cantidad grande no se explota en unidades', () => {
  /**
   * 10⁶ unidades en una línea, con promos que generan una sola aplicación o
   * ninguna: el costo que queda es el de explotar. El evaluador que explotaba
   * tardaba ~200 ms en esto (medido el 2026-10-06 sobre `dist`); contando por
   * lote, menos de 1 ms. El umbral deja margen para los dos lados con el host
   * cargado.
   */
  it('10⁶ unidades con un nxm de un solo grupo y un combo que no conviene resuelven en menos de 50 ms', () => {
    const input: Parameters<typeof evaluarPromos>[0] = {
      promos: [
        { ...nxm(1_000_000), id: 'p-a' },
        { ...combo('999999', [2]), id: 'p-b' },
      ],
      lineas: [linea(0, '1000000', '1000')],
      canal: 'fisico',
    };
    const inicio = performance.now();
    const salida = evaluarPromos(input);
    const ms = performance.now() - inicio;

    expect(salida).toHaveLength(1);
    expect(salida[0].montosPorLinea).toEqual([
      { lineaIndex: 0, monto: '1000' },
    ]);
    expect(ms).toBeLessThan(50);
  });
});
