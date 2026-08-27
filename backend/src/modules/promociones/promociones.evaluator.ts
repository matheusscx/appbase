import Decimal from 'decimal.js';

/**
 * Evaluador de promociones — núcleo PURO (sin BD, sin NestJS), mismo molde que
 * `calculo-precios.engine.ts`.
 *
 * Recibe promos ya resueltas por el service (elegibles por `activo`/fecha, con sus
 * scopes e ítems cargados) y las líneas de la venta, ya con el neto unitario
 * convertido a moneda oficial y el instante local en que se pidieron. Devuelve
 * **aplicaciones candidatas** en plata FINA (sin cuantizar) — el motor las suma
 * como un descuento más al cerrar su paso, y ese cierre es quien cuantiza.
 *
 * Esta versión conoce `porcentaje` y `nxm`. `precio_fijo` (combo) y el conflicto
 * greedy entre promos (una unidad toma a lo sumo una aplicación, entre promos
 * distintas) llegan en la Task 4 — hasta entonces, `evaluarPromos` no coordina
 * nada entre promos: cada una se evalúa de forma independiente contra el carrito
 * completo. Dentro de `nxm` ya no hay ese problema: la propia agrupación en
 * `cadaN` consume unidades sin repetirlas.
 */

// ── Tipos de entrada (estructura resuelta por el service) ──────────────────

/**
 * Ventana de vigencia de una promo, ya resuelta (sin tocar BD desde acá).
 * `horaInicio > horaFin` es la franja que cruza medianoche (ej. 18:00–02:00),
 * ver `instanteEnVentana`.
 */
export interface VentanaPromo {
  fechaInicio: string; // 'YYYY-MM-DD'
  fechaFin: string;
  horaInicio: string | null; // 'HH:mm'; inicio > fin = cruza medianoche
  horaFin: string | null;
  diasSemana: number[] | null; // ISO 1..7; null = todos
  canal: string | null; // 'fisico' | 'online' | null = ambos
}

export interface ScopePromoResuelto {
  slot: number;
  tipoScope: 'items' | 'categoria' | 'venta';
  categoriaId: string | null;
  cantidad: number;
  itemIds: string[]; // solo tipoScope='items'
}

export interface PromoElegible {
  id: string;
  nombre: string;
  tipo: 'porcentaje' | 'nxm' | 'precio_fijo';
  valorPorcentaje: string | null;
  cadaN: number | null;
  valorMonto: string | null;
  ventana: VentanaPromo;
  scopes: ScopePromoResuelto[];
}

/** El instante LOCAL de una línea, ya colapsado por el service. */
export interface InstanteLocal {
  fecha: string; // 'YYYY-MM-DD'
  hora: string; // 'HH:mm'
  diaIso: number; // 1=lunes..7=domingo
}

export interface LineaPromo {
  index: number; // índice en dto.lineas — el cruce es SIEMPRE por índice
  itemId: string;
  categoriaId: string | null;
  cantidad: string; // canónica (Decimal string)
  netoUnitario: string; // convertido a oficial, ANTES de descuentos
  instante: InstanteLocal; // cuándo se pidió (decisión 4 del owner)
}

export interface AplicacionPromo {
  promocionId: string;
  nombre: string;
  tipo: string;
  valorEfectivo: string; // el % decimal o el precio fijo
  montosPorLinea: { lineaIndex: number; monto: string }[]; // fino, todos > 0
}

const ZERO = new Decimal(0);

// ── Ventana / elegibilidad ───────────────────────────────────────────────────

/**
 * ¿Este instante local cae en la ventana de la promo?
 *
 * Compara STRINGS, no `Date`: `fecha` e `hora` ya son locales al tenant —el
 * service las resolvió con la zona de la provincia (`fechaLocalTenant`)— y
 * comparar como string evita reintroducir un huso horario acá. El formato
 * `'YYYY-MM-DD'`/`'HH:mm'` hace que el orden lexicográfico sea el orden real.
 *
 * `horaInicio > horaFin` es la franja que cruza medianoche (ej. happy hour
 * 18:00–02:00): la ventana pasa a ser `[inicio, 24:00) ∪ [00:00, fin]`, que en
 * comparación de strings es `hora >= inicio || hora <= fin`. Bordes inclusivos
 * en los dos casos, igual que fecha y día de semana.
 */
export function instanteEnVentana(v: VentanaPromo, i: InstanteLocal): boolean {
  if (i.fecha < v.fechaInicio || i.fecha > v.fechaFin) return false;
  if (v.diasSemana != null && !v.diasSemana.includes(i.diaIso)) return false;

  if (v.horaInicio != null && v.horaFin != null) {
    const dentro =
      v.horaInicio <= v.horaFin
        ? i.hora >= v.horaInicio && i.hora <= v.horaFin
        : i.hora >= v.horaInicio || i.hora <= v.horaFin;
    if (!dentro) return false;
  }

  return true;
}

/**
 * ¿La línea cae dentro del scope de la promo? `porcentaje`/`nxm` siempre
 * traen exactamente un scope (lo exige `validarScopes` al escribir la promo,
 * ver `promociones.service.ts`), así que acá no hay que combinar varios.
 */
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

// ── `porcentaje` ─────────────────────────────────────────────────────────────

/**
 * Happy hour: cada línea del scope, dentro de su propia franja horaria, recibe
 * `valorPorcentaje × neto × cantidad`. Es el único tipo que trabaja con la
 * LÍNEA entera —no con unidades enteras— porque una cantidad fraccionaria
 * (venta al peso) participa con su neto proporcional; `nxm`/`precio_fijo`
 * exigen unidad entera, que acá no aplica.
 *
 * Todas las líneas que califican se agrupan en UNA sola aplicación (a
 * diferencia de `nxm`, que emite una aplicación por grupo — ver `evaluarNxm`):
 * un 20% no tiene "grupos" que repetir, es el mismo porcentaje sobre cada
 * línea que entra.
 */
function evaluarPorcentaje(
  promo: PromoElegible,
  scope: ScopePromoResuelto,
  lineas: LineaPromo[],
): AplicacionPromo[] {
  const valor = new Decimal(promo.valorPorcentaje as string);
  const montosPorLinea: { lineaIndex: number; monto: string }[] = [];

  for (const linea of lineas) {
    if (!perteneceAScope(scope, linea)) continue;
    if (!instanteEnVentana(promo.ventana, linea.instante)) continue;

    const monto = valor.times(linea.netoUnitario).times(linea.cantidad);
    if (monto.greaterThan(ZERO)) {
      montosPorLinea.push({ lineaIndex: linea.index, monto: monto.toString() });
    }
  }

  if (montosPorLinea.length === 0) return [];
  return [
    {
      promocionId: promo.id,
      nombre: promo.nombre,
      tipo: promo.tipo,
      valorEfectivo: promo.valorPorcentaje as string,
      montosPorLinea,
    },
  ];
}

// ── `nxm` ─────────────────────────────────────────────────────────────────

/** Una unidad concreta del carrito, explotada de su línea de origen. */
interface UnidadNxm {
  lineaIndex: number;
  neto: Decimal;
}

/**
 * NxM (2x1, "2do al 50%", etc.): explota las líneas del scope —dentro de su
 * franja— en unidades enteras (`⌊cantidad⌋`; una cantidad fraccionaria como
 * '0.7' no aporta ninguna, a diferencia de `porcentaje`), las ordena por neto
 * DESCENDENTE y arma grupos completos de `cadaN` consecutivos. En cada grupo,
 * la unidad más barata —la última tras ordenar desc— recibe
 * `valorPorcentaje × neto` (2x1 = 100% de la más barata: "paga la más cara").
 * Un grupo incompleto al final no aplica.
 *
 * Desempate de neto por `lineaIndex` ASCENDENTE: sin él, dos unidades del
 * mismo precio en líneas distintas dejarían el resultado a merced del orden
 * de entrada del array (que en este evaluador es estable, pero dos llamadas
 * con el mismo carrito armado en otro orden darían grupos distintos).
 *
 * Cada grupo completo es UNA `AplicacionPromo` propia (no se agregan en una
 * sola, a diferencia de `porcentaje`): 4 cervezas en el 2x1 son 2 aplicaciones,
 * cada una con su propia línea beneficiada — así lo pide la spec (§El
 * evaluador) y así lo espera el desglose de venta, que nombra cada aplicación.
 */
function evaluarNxm(
  promo: PromoElegible,
  scope: ScopePromoResuelto,
  lineas: LineaPromo[],
): AplicacionPromo[] {
  const cadaN = promo.cadaN as number;
  const valor = new Decimal(promo.valorPorcentaje as string);

  const unidades: UnidadNxm[] = [];
  for (const linea of lineas) {
    if (!perteneceAScope(scope, linea)) continue;
    if (!instanteEnVentana(promo.ventana, linea.instante)) continue;

    const cantidadEntera = new Decimal(linea.cantidad).floor().toNumber();
    const neto = new Decimal(linea.netoUnitario);
    for (let u = 0; u < cantidadEntera; u++) {
      unidades.push({ lineaIndex: linea.index, neto });
    }
  }

  unidades.sort((a, b) => {
    const cmp = b.neto.comparedTo(a.neto);
    return cmp !== 0 ? cmp : a.lineaIndex - b.lineaIndex;
  });

  const gruposCompletos = Math.floor(unidades.length / cadaN);
  const aplicaciones: AplicacionPromo[] = [];

  for (let g = 0; g < gruposCompletos; g++) {
    const inicio = g * cadaN;
    const grupo = unidades.slice(inicio, inicio + cadaN);
    // Ordenado desc: la última del grupo es la más barata.
    const barata = grupo[grupo.length - 1];
    const monto = valor.times(barata.neto);
    if (monto.greaterThan(ZERO)) {
      aplicaciones.push({
        promocionId: promo.id,
        nombre: promo.nombre,
        tipo: promo.tipo,
        valorEfectivo: promo.valorPorcentaje as string,
        montosPorLinea: [
          { lineaIndex: barata.lineaIndex, monto: monto.toString() },
        ],
      });
    }
  }

  return aplicaciones;
}

// ── Entrada ───────────────────────────────────────────────────────────────

/**
 * Evalúa todas las promos elegibles contra las líneas de la venta y devuelve
 * las aplicaciones candidatas, en plata fina. `canal` es propiedad de la
 * VENTA completa (no de la línea ni del instante): una promo con
 * `ventana.canal` fijado que no coincide con el canal de la venta queda fuera
 * entera, antes de mirar sus líneas.
 *
 * El `switch` por tipo conoce hoy `porcentaje` y `nxm`; `precio_fijo` llega en
 * la Task 4 junto con el conflicto greedy entre promos (una unidad tomada por
 * una promo no entra en otra) — hasta entonces una promo `precio_fijo` no
 * genera aplicaciones, sin que haga falta una rama vacía para decirlo.
 */
export function evaluarPromos(input: {
  promos: PromoElegible[];
  lineas: LineaPromo[];
  canal: 'fisico' | 'online';
}): AplicacionPromo[] {
  const aplicaciones: AplicacionPromo[] = [];

  for (const promo of input.promos) {
    if (promo.ventana.canal != null && promo.ventana.canal !== input.canal) {
      continue;
    }
    const scope = promo.scopes[0];
    if (!scope) continue;

    switch (promo.tipo) {
      case 'porcentaje':
        aplicaciones.push(...evaluarPorcentaje(promo, scope, input.lineas));
        break;
      case 'nxm':
        aplicaciones.push(...evaluarNxm(promo, scope, input.lineas));
        break;
    }
  }

  return aplicaciones;
}
