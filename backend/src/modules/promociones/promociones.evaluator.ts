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
 * Conoce los tres tipos: `porcentaje`, `nxm` y `precio_fijo` (combo). Cada tipo
 * genera sus candidatas de forma INDEPENDIENTE, sin saber nada de las otras
 * promos — el arbitraje entre promos que compiten por la misma línea (greedy,
 * "gana la de mayor descuento") es responsabilidad exclusiva de `evaluarPromos`,
 * documentado ahí.
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

/**
 * Candidata interna del greedy — no se expone, `evaluarPromos` la traduce a
 * `AplicacionPromo[]` al final. Además de la aplicación pública, lleva
 * cuántas unidades DISCRETAS consume de cada línea (`unidadesPorLinea`): el
 * greedy arbitra por CONTEO, no por presencia/ausencia de la línea — ver el
 * docblock de `evaluarPromos`.
 */
interface CandidataGreedy {
  aplicacion: AplicacionPromo;
  unidadesPorLinea: { lineaIndex: number; unidades: number }[];
}

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
 *
 * Para el greedy de `evaluarPromos`, esta candidata pide la línea ENTERA
 * (`⌊cantidad⌋` unidades) de cada línea que toca — no unidades sueltas, sigue
 * sin operar por unidad. Consecuencia: si otra promo ya consumió parte de esa
 * línea (ej. un `nxm` que tomó 2 de un bar con `cantidad`=3), esta candidata
 * no entra aunque quede una unidad libre — limitación aceptada, documentada
 * en `evaluarPromos`.
 */
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

    const monto = valor.times(linea.netoUnitario).times(linea.cantidad);
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
 *
 * Para el greedy, cada candidata pide las unidades de TODO su grupo, no solo
 * de la barata que aparece en `montosPorLinea`: la "cara" del grupo no recibe
 * descuento, pero igual ocupa una unidad física — si no se contara, otra
 * candidata podría creerla libre y pisarla. Cuando el grupo cae entero dentro
 * de la MISMA línea (ej. una línea con `cantidad`='4' y `cadaN`=2), dos
 * grupos de esa línea piden 2+2 unidades — el greedy por conteo (no por
 * presencia de línea) los deja convivir sin chocar entre sí.
 */
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
  const candidatas: CandidataGreedy[] = [];

  for (let g = 0; g < gruposCompletos; g++) {
    const inicio = g * cadaN;
    const grupo = unidades.slice(inicio, inicio + cadaN);
    // Ordenado desc: la última del grupo es la más barata.
    const barata = grupo[grupo.length - 1];
    const monto = valor.times(barata.neto);
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

// ── `precio_fijo` (combo) ────────────────────────────────────────────────

/**
 * Combo a precio fijo (ej. "1 pizza + 1 bebida = $9.990"): a diferencia de
 * `porcentaje`/`nxm` —que traen exactamente un scope—, acá se usan TODOS los
 * scopes de la promo: cada uno es un SLOT del combo, y `scope.cantidad` son
 * las unidades que ese slot exige.
 *
 * Arma tantos combos completos como alcancen las unidades disponibles,
 * tomando SIEMPRE las unidades MÁS CARAS de cada slot primero (decisión 3
 * del owner: criterio pro-cliente, maximiza el descuento) — mismo
 * ordenamiento que `evaluarNxm` (desc por neto, empate por `lineaIndex`
 * ascendente). Cada combo consume sus unidades antes de intentar el
 * siguiente, así que un segundo combo de una promo repetible usa lo que
 * sobró del primero (unidades más baratas).
 *
 * `descuento = Σ netos del combo − valorMonto`. Si no es positivo —el combo
 * encarecería o empataría con comprar suelto, una promo nunca encarece—, esa
 * combinación no se arma. Como los combos siguientes de la misma promo solo
 * pueden ser más baratos (consumen unidades cada vez menos caras que la
 * anterior), no tiene sentido seguir probando: se corta ahí.
 *
 * El descuento de cada combo se reparte entre las líneas que aportaron
 * unidades, a prorrata del neto aportado — ver `repartirDescuentoCombo`.
 *
 * Para el greedy, cada candidata pide las unidades que efectivamente tomó de
 * cada línea (conteo, no solo la línea): dos combos repetidos sobre líneas de
 * `cantidad`=2 (una por slot) piden 1+1 cada uno, y el conteo los deja
 * convivir sin que el segundo choque con el primero por compartir `lineaIndex`.
 */
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
      const neto = new Decimal(linea.netoUnitario);
      for (let u = 0; u < cantidadEntera; u++) {
        unidades.push({ lineaIndex: linea.index, neto });
      }
    }
    unidades.sort((a, b) => {
      const cmp = b.neto.comparedTo(a.neto);
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
    const sumaNetos = unidadesCombo.reduce((a, u) => a.plus(u.neto), ZERO);
    const descuento = sumaNetos.minus(valorMonto);
    if (!descuento.greaterThan(ZERO)) break;

    for (const pool of pools) pool.cursor += pool.cantidad;

    const pesosPorLinea = new Map<number, Decimal>();
    const conteoPorLinea = new Map<number, number>();
    for (const u of unidadesCombo) {
      pesosPorLinea.set(
        u.lineaIndex,
        (pesosPorLinea.get(u.lineaIndex) ?? ZERO).plus(u.neto),
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

/**
 * Reparte `descuento` entre las líneas que aportaron unidades al combo, a
 * prorrata del neto aportado. Cada parte se calcula por proporción, fina
 * (sin cuantizar a la escala de moneda — eso lo hace el cierre del motor,
 * no acá). La SUMA de las partes es EXACTAMENTE igual a `descuento`: el
 * único resto que puede aparecer es el de precisión de `Decimal` cuando el
 * reparto no divide exacto (ej. repartir 1.510 en proporción 8.000/11.500 no
 * termina), y ese resto se lo lleva la línea de mayor resto fraccionario,
 * desempate por `lineaIndex` ascendente — mismo idioma que
 * `repartirProporcional` del motor de cálculo de precios, sin su paso de
 * cuantización a la escala de moneda.
 */
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

// ── Entrada ───────────────────────────────────────────────────────────────

/**
 * Evalúa todas las promos elegibles contra las líneas de la venta y devuelve
 * las aplicaciones que sobreviven al conflicto entre promos, en plata fina.
 * `canal` es propiedad de la VENTA completa (no de la línea ni del
 * instante): una promo con `ventana.canal` fijado que no coincide con el
 * canal de la venta queda fuera entera, antes de mirar sus líneas.
 *
 * **Conflicto greedy entre promos, por CONTEO de unidades.** Cada promo
 * genera sus candidatas de forma INDEPENDIENTE (`evaluarPorcentaje`/
 * `evaluarNxm`/`evaluarPrecioFijo` no saben nada de las otras promos ni del
 * resultado del greedy) — pero cada candidata interna sabe cuántas unidades
 * DISCRETAS consume de cada línea (no solo qué líneas toca). Las unidades de
 * una línea son fungibles (mismo ítem, mismo neto), así que no hace falta
 * identidad por unidad física: alcanza con un CONTADOR de unidades
 * consumidas por línea. `porcentaje` sigue operando a nivel línea completa
 * (sin cambio de semántica): su candidata pide `⌊cantidad⌋` — la línea
 * entera —, así que solo entra si esa línea tiene CERO unidades consumidas
 * todavía.
 *
 * Todas las candidatas de TODAS las promos se juntan en una sola lista y se
 * ordenan por monto total DESCENDENTE — desempate por `id` de promo
 * ascendente, y si aun así empatan, por el orden en que se generaron. Se
 * recorren en ese orden: una candidata entra si, en TODAS sus líneas,
 * `consumidas + necesarias <= ⌊cantidad⌋` de esa línea; si entra, suma sus
 * unidades al contador de cada línea que tocó. Si no entra, se descarta
 * ENTERA (no se recorta ni se regenera parcial — simplicidad F1, ver más
 * abajo). El greedy compite tanto ENTRE TIPOS distintos (un 2x1 y una happy
 * hour por la misma unidad) como DENTRO de la misma promo: dos grupos `nxm`
 * de una única línea con `cantidad`='4' y `cadaN`=2 piden 2+2 unidades de esa
 * línea y conviven sin chocar (antes, con conflicto por LÍNEA en vez de por
 * conteo, el segundo grupo se descartaba por completo — bug medido: $5.000
 * de descuento en vez de $10.000 en ese escenario).
 *
 * **No se busca un óptimo global**: una combinación distinta de aplicaciones
 * podría dejar más descuento total sobre la mesa. La regla es "gana la de
 * mayor descuento", no la mejor combinación posible — eso es intencional
 * (simplicidad F1), no un defecto a corregir.
 *
 * **Limitación aceptada (F1):** como `porcentaje` pide la línea ENTERA, una
 * línea PARCIALMENTE consumida por otra promo (ej. un bar con `cantidad`=3
 * donde un `nxm` ya tomó 2 unidades) queda COMPLETA e indisponible para
 * `porcentaje`, aunque en teoría podría descontar solo la unidad libre —
 * `porcentaje` no opera por unidad, así que no hay forma de ofrecerle "una
 * parte" de la línea sin cambiarle la semántica. Coherente con "no busca
 * óptimo global": se acepta la plata que se deja sobre la mesa acá.
 */
export function evaluarPromos(input: {
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
