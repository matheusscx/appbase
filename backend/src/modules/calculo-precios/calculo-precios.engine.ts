import Decimal from 'decimal.js';

/**
 * Motor de cálculo de precios — núcleo PURO (sin BD, sin NestJS).
 *
 * Recibe una venta ya "resuelta" (ítems, reglas e impuestos cargados desde la
 * capa de servicio) y devuelve el desglose de precio respetando la
 * configuración financiera del tenant: orden de fórmula, base|compuesto,
 * escala de cálculo y modo de redondeo. Toda la aritmética usa Decimal.js.
 *
 * Reglas evaluadas en esta fase: valor plano (% o monto fijo), tramos
 * (`por_mayor` por cantidad, `por_monto_venta` por monto) y filtro por método
 * de pago. Las reglas por fecha/vencimiento quedan modeladas pero NO se
 * evalúan todavía (ver DIFERIDAS).
 */

// ── Tipos de entrada (estructura resuelta) ──────────────────────────────────

export type ModoRegla = 'porcentaje' | 'monto_fijo';

export interface ReglaResuelta {
  id: string;
  nombre: string;
  /** `tipos_regla.codigo` — determina la estrategia de evaluación. */
  codigo: string | null;
  modo: ModoRegla;
  /** Decimal en string; null cuando la regla usa tramos. */
  valor: string | null;
  tramos: { minimo: string; valor: string }[];
  metodoPagoIds: string[];
  /**
   * `false` = pausada: no se aplica y emite advertencia. Requerido a propósito:
   * si fuera opcional, olvidarse de mapearlo en el service haría que la regla
   * pausada volviera a cobrarse en silencio, que es justo el bug que esto cierra.
   */
  activo: boolean;
}

export interface ImpuestoResuelto {
  id: string;
  nombre: string;
  /** Porcentaje en decimal (0.19 = 19%). */
  porcentaje: string;
  /**
   * `false` = pausado: no se cobra y emite advertencia. El IVA llega siempre en
   * `true` — no se gobierna con este interruptor sino con la clasificación
   * tributaria del ítem (afecto/exento). Lo fuerza el service, ver ADR-018.
   */
  activo: boolean;
}

export interface LineaResuelta {
  itemId: string;
  cantidad: string;
  /** Precio unitario ya resuelto (override o precio_base del ítem). */
  precioUnitario: string;
  precioIncluyeImpuesto: boolean;
  descuentos: ReglaResuelta[];
  recargos: ReglaResuelta[];
  impuestos: ImpuestoResuelto[];
}

export interface ConfigCalculo {
  /** Orden de los tres pasos, p.ej. ['descuentos','recargos','impuestos']. */
  formula: string[];
  calculoDescuentos: string; // 'base' | 'compuesto'
  calculoRecargos: string; // 'base' | 'compuesto'
  escalaCalculo: number;
  modoRedondeo: string; // 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL'
  /** 'linea' | 'documento'. Ver ADR/spec de redondeo. */
  nivelRedondeo: string;
  /**
   * Minor unit de la moneda OFICIAL del tenant: la escala a la que se cuantiza
   * todo monto cobrado al cerrar el documento. Es dato derivado congelado, no
   * configuración: si mañana cambia la moneda del tenant, una venta vieja tiene
   * que seguir siendo interpretable con lo que valía entonces.
   */
  decimalesMoneda: number;
}

export interface VentaResuelta {
  lineas: LineaResuelta[];
  metodoPagoId: string | null;
  descuentosVenta: ReglaResuelta[];
  recargosVenta: ReglaResuelta[];
  config: ConfigCalculo;
}

// ── Tipos de salida ─────────────────────────────────────────────────────────

export interface TrazaRegla {
  id: string;
  nombre: string;
  monto: string;
  /** Cómo se expresaba la regla al aplicarse. */
  modo: ModoRegla;
  /**
   * El valor de la regla que realmente se usó — el del **tramo elegido** cuando
   * la regla es por tramos. Es lo que permite decir "este descuento era 10%"
   * después de que alguien lo edite a 20%.
   *
   * `null` cuando la regla no aportó ningún valor: diferida, sin tramo
   * aplicable, o método de pago que no coincide. Distinto de `'0'`, que sería
   * una regla que sí aplicó y valía cero.
   */
  valorEfectivo: string | null;
  /**
   * Lo que la regla pidió antes del tope al monto disponible. Igual a `monto`
   * salvo en un descuento topeado, donde `monto` es lo que entró en el total y
   * esto es lo que la regla valía.
   *
   * Se captura después del guard de "ninguna regla aporta un monto negativo",
   * así que una regla que evaluó negativo sobre una base negativa reporta `0`
   * en los dos campos: acá tampoco hay montos negativos. Qué regla era sigue
   * en `valorEfectivo`.
   */
  valorSolicitado: string;
}
export interface TrazaImpuesto {
  id: string;
  nombre: string;
  monto: string;
  tasa: string;
}

/**
 * Una advertencia del cálculo. Va partida porque el carrito muestra el título
 * en la línea —que es angosta— y deja el detalle en un tooltip; la respuesta de
 * la venta las junta de nuevo en una frase para los toasts del POS.
 */
export interface AdvertenciaPrecio {
  /** Qué la produjo. Ej: `Descuento "Promo fija $5.000"`. */
  titulo: string;
  /** Qué pasó, sin repetir el título. Ej: `no se aplicó completo porque superaba el monto disponible`. */
  detalle: string;
}

export interface ResultadoLinea {
  itemId: string;
  cantidad: string;
  precioUnitario: string;
  subtotalNeto: string;
  descuentoAplicado: string;
  recargoAplicado: string;
  impuestoAplicado: string;
  totalLinea: string;
  trazas: {
    descuentos: TrazaRegla[];
    recargos: TrazaRegla[];
    impuestos: TrazaImpuesto[];
  };
  /** Descuentos topeados por el piso en cero en esta línea. */
  advertencias: AdvertenciaPrecio[];
}

export interface ResultadoVenta {
  lineas: ResultadoLinea[];
  totales: {
    subtotalNeto: string;
    totalDescuentos: string;
    totalRecargos: string;
    totalImpuestos: string;
    totalFinal: string;
  };
  trazasVenta: {
    descuentos: TrazaRegla[];
    recargos: TrazaRegla[];
  };
  /**
   * Avisos que no frenan el cálculo. Cuatro fuentes: un descuento topeado por el
   * piso en cero, una regla pausada (descuento o recargo), un impuesto pausado
   * y —emitido por el service, no acá— un ítem pausado. Vacío en el caso normal.
   */
  advertencias: AdvertenciaPrecio[];
  /**
   * Las advertencias de las reglas a nivel venta — las que no pertenecen a
   * ninguna línea. `advertencias` las incluye junto con las de línea; este campo
   * existe para que el carrito pueda mostrar cada aviso donde corresponde sin
   * tener que restar strings.
   *
   * ⚠️ **Descuentos Y recargos.** Hasta 2026-08-03 este comentario decía "solo
   * los descuentos", y era cierto por accidente: la única advertencia que
   * existía —el tope— solo se emite en descuentos, así que el ensamblado leía
   * `dv` e ignoraba `rv` sin que se notara. Cuando las reglas pausadas hicieron
   * que un recargo también pudiera avisar, ese supuesto se volvió un bug: un
   * recargo de venta pausado bajaba la plata cobrada sin traza ni advertencia.
   * Las dos ramas van siempre.
   */
  advertenciasVenta: AdvertenciaPrecio[];
  /**
   * La config con la que se calculó, devuelta tal cual. La venta la congela:
   * sin ella las reglas congeladas no son interpretables, porque el mismo 10%
   * da distinto según el orden de la fórmula y según base|cascada.
   */
  config: ConfigCalculo;
}

// ── Constantes de estrategia ────────────────────────────────────────────────

/** Reglas que requieren datos de venta/crédito aún inexistentes: no se evalúan. */
const DIFERIDAS = new Set(['promocional', 'mora', 'pronto_pago']);
const METODO_PAGO_CODIGOS = new Set(['metodo_pago', 'recargo_metodo_pago']);
const ZERO = new Decimal(0);

// ── Helpers de redondeo ─────────────────────────────────────────────────────

/**
 * Traduce el `modo_redondeo` del tenant al enum de Decimal.js.
 *
 * Exportada —el resto de los helpers de redondeo no lo está— porque la conversión
 * a moneda oficial la necesita, y esa ocurre en la capa de servicio, antes de que
 * el motor vea la línea. Vive acá igual para que agregar un modo nuevo se haga en
 * un solo lugar: duplicado el `switch`, el modo nuevo andaría en el cálculo y se
 * caería al default en la conversión.
 */
export function modoToRounding(modo: string): Decimal.Rounding {
  switch (modo) {
    case 'HALF_EVEN':
      return Decimal.ROUND_HALF_EVEN;
    case 'FLOOR':
      return Decimal.ROUND_FLOOR;
    case 'CEIL':
      return Decimal.ROUND_CEIL;
    case 'HALF_UP':
    default:
      return Decimal.ROUND_HALF_UP;
  }
}

function redondear(d: Decimal, cfg: ConfigCalculo): Decimal {
  return d.toDecimalPlaces(cfg.escalaCalculo, modoToRounding(cfg.modoRedondeo));
}

/**
 * Lleva un MONTO a la escala de la moneda (`decimalesMoneda`) con el modo de
 * redondeo del tenant. Es el paso de **CIERRE**, no un redondeo más: `redondear`
 * mantiene el cálculo intermedio a `escala_calculo`, y esto decide la plata que
 * el documento declara.
 *
 * Existe porque sin ella el último redondeo lo hacía el cast a `NUMERIC(18,4)`
 * de Postgres — con su propia regla y sin mirar la configuración del tenant.
 * Medido en dev: ventas en CLP con `total_final = 16957.5000`, medio peso en una
 * moneda sin centavos que la pasarela rechaza.
 *
 * ⚠️ **Cambia el VALOR, no el formato.** `fmt` sigue emitiendo strings con
 * `escala_calculo` decimales (contrato de la API), así que un neto de 84 en CLP
 * sale como `'84.000000'`.
 *
 * Se aplica **una sola vez por monto declarado**, nunca en cascada sobre el
 * acumulado de cada regla: componer redondeos es el caso del Vancouver Stock
 * Exchange, y la norma (SAT, IRS) instruye lo contrario. Dónde se aplica exacto:
 * ver `calcularLinea`.
 */
export function cuantizar(d: Decimal, cfg: ConfigCalculo): Decimal {
  return d.toDecimalPlaces(
    cfg.decimalesMoneda,
    modoToRounding(cfg.modoRedondeo),
  );
}

/** Cuantiza o no según el nivel de redondeo del tenant. Ver `calcularLinea`. */
type Cuantizador = (d: Decimal) => Decimal;

/** Identidad: el monto queda a `escala_calculo`, como antes de que esto existiera. */
const SIN_CUANTIZAR: Cuantizador = (d) => d;

function fmt(d: Decimal, cfg: ConfigCalculo): string {
  return d.toFixed(cfg.escalaCalculo);
}

// ── Evaluación de una regla individual ──────────────────────────────────────

interface ContextoRegla {
  /** Base sobre la que se calcula el porcentaje (neto o acumulado). */
  base: Decimal;
  /** Magnitud para tramos `por_mayor`. */
  cantidad: Decimal;
  /** Magnitud para tramos `por_monto_venta` (monto neto). */
  monto: Decimal;
  metodoPagoId: string | null;
}

function aplicarValor(
  modo: ModoRegla,
  valor: string | null,
  base: Decimal,
): Decimal {
  if (valor == null) return ZERO;
  const v = new Decimal(valor);
  // monto_fijo se aplica plano a la línea; porcentaje sobre la base.
  return modo === 'monto_fijo' ? v : base.times(v);
}

function seleccionarTramo(
  tramos: { minimo: string; valor: string }[],
  magnitud: Decimal,
): { minimo: string; valor: string } | null {
  let elegido: { minimo: string; valor: string } | null = null;
  let mejorMin = new Decimal(-1);
  for (const t of tramos) {
    const min = new Decimal(t.minimo);
    if (magnitud.greaterThanOrEqualTo(min) && min.greaterThan(mejorMin)) {
      elegido = t;
      mejorMin = min;
    }
  }
  return elegido;
}

/**
 * Resultado de evaluar una regla. Lleva el valor usado además del monto porque
 * el monto solo no reconstruye la regla: 10 sobre 100 puede ser un 10% o un
 * monto fijo de 10, y en una regla por tramos el valor sale del tramo elegido,
 * no de `regla.valor` (que es `null`).
 */
interface EvaluacionRegla {
  monto: Decimal;
  valorEfectivo: string | null;
}

/** La regla no aportó valor: diferida, sin tramo, o método que no coincide. */
const SIN_VALOR: EvaluacionRegla = { monto: ZERO, valorEfectivo: null };

function evaluarRegla(
  regla: ReglaResuelta,
  ctx: ContextoRegla,
): EvaluacionRegla {
  const codigo = regla.codigo ?? '';
  if (DIFERIDAS.has(codigo)) return SIN_VALOR;

  if (METODO_PAGO_CODIGOS.has(codigo)) {
    if (!ctx.metodoPagoId || !regla.metodoPagoIds.includes(ctx.metodoPagoId)) {
      return SIN_VALOR;
    }
    return {
      monto: aplicarValor(regla.modo, regla.valor, ctx.base),
      valorEfectivo: regla.valor,
    };
  }

  if (regla.tramos.length > 0) {
    const magnitud = codigo === 'por_mayor' ? ctx.cantidad : ctx.monto;
    const tramo = seleccionarTramo(regla.tramos, magnitud);
    if (!tramo) return SIN_VALOR;
    // El tramo elegido ES el valor de la regla en esta venta. Propagarlo es lo
    // único que permite reportarlo después: `regla.valor` es `null` acá.
    return {
      monto: aplicarValor(regla.modo, tramo.valor, ctx.base),
      valorEfectivo: tramo.valor,
    };
  }

  return {
    monto: aplicarValor(regla.modo, regla.valor, ctx.base),
    valorEfectivo: regla.valor,
  };
}

// ── Procesamiento de un conjunto de descuentos/recargos ─────────────────────

interface ResultadoPaso {
  /** Acumulado con los montos **finos** (a `escala_calculo`) ya aplicados. */
  acc: Decimal;
  /**
   * Suma de los montos tal como quedaron en las trazas. Con cuantización es
   * `Σ trazas_Q`, que es justo lo que el documento declara; sin ella coincide
   * con `acc − acc_inicial` (con signo).
   */
  total: Decimal;
  trazas: TrazaRegla[];
  advertencias: AdvertenciaPrecio[];
}

/**
 * Colapsa advertencias idénticas (decisión del owner, 2026-08-11). Un carrito de
 * 10 líneas con el mismo impuesto pausado producía **10 avisos iguales**, que el
 * POS aplana a 10 toasts; lo mismo con un ítem pausado cargado en varias líneas.
 * Es información de **catálogo**, no de una línea en particular: repetirla no
 * agrega nada y tapa los avisos que sí son de una línea.
 *
 * Solo se deduplica este campo, que es el aplanado para los toasts.
 * `ResultadoLinea.advertencias` y `advertenciasVenta` quedan intactos: cada uno
 * se muestra pegado a lo que lo produjo, y ahí la repetición es correcta.
 *
 * Deduplicar por `titulo`+`detalle` no pierde monto porque el `detalle` **no
 * nombra montos** a propósito —el aplicado viaja en la traza de cada línea—, así
 * que dos apariciones de la misma regla son literalmente el mismo mensaje.
 */
function sinRepetidas(avisos: AdvertenciaPrecio[]): AdvertenciaPrecio[] {
  const vistas = new Set<string>();
  return avisos.filter((a) => {
    const clave = JSON.stringify([a.titulo, a.detalle]);
    if (vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
}

/**
 * **Porcentajes antes que montos fijos** (decisión del owner, 2026-08-11, tras la
 * investigación de mercado en
 * `docs/agent/investigaciones/2026-08-11-orden-de-descuentos.md`).
 *
 * Por qué la pregunta se reduce a esto: `aplicarValor` ignora la base cuando el
 * modo es `monto_fijo`, así que un fijo **pide** lo mismo vaya donde vaya. **El
 * único cuyo monto depende de la posición es el porcentaje**, y lo que se está
 * eligiendo es si mira el precio original o el ya rebajado.
 *
 * (Lo que un fijo sí puede cambiar según la posición es cuánto **aplica**: el
 * tope contra `disponible` recorta al que llegue tarde. Eso no debilita el
 * criterio — es la razón 3.)
 *
 * Tres razones, la tercera propia de este motor:
 * 1. "20% de descuento" significa 20% del precio, que es lo que le dijimos al
 *    cliente. Si va segundo, un 20% rinde menos de 20%.
 * 2. Le conviene al cliente (700 contra 720 en 1000 con 20% + fijo 100).
 * 3. **El último es el que se recorta** cuando el piso en cero entra: un fijo
 *    recortado se explica en el ticket ("el descuento de 1200 aplicó 1000"), un
 *    porcentaje recortado no.
 *
 * Vale también para **recargos**, y no por simetría cosmética: el mismo
 * argumento 1 aplica ("5% de recargo" es 5% del precio), y el resultado también
 * favorece al cliente.
 *
 * El orden dentro de cada grupo NO se toca: `Array.prototype.sort` es estable
 * (garantizado por ES2019), así que se preserva el que trajo el llamador —hoy
 * `ORDER BY … regla_id` en `items.service.ts`, determinista pero arbitrario—.
 * Que ese desempate sea arbitrario es aceptable porque **entre reglas del mismo
 * modo el orden no cambia el total**: dos porcentajes componen
 * multiplicativamente y dos fijos suman. Con tres o más porcentajes puede mover
 * el último decimal por redondeo de paso, y eso está anotado en el backlog.
 *
 * Se copia el array en vez de ordenarlo in-place: la lista es del llamador y
 * reordenársela sería un efecto lateral invisible.
 */
function ordenarReglas(reglas: ReglaResuelta[]): ReglaResuelta[] {
  return [...reglas].sort(
    (a, b) => Number(a.modo === 'monto_fijo') - Number(b.modo === 'monto_fijo'),
  );
}

/**
 * Aplica una lista de reglas (descuentos o recargos) sobre el acumulador.
 * `signo` = -1 para descuentos (restan), +1 para recargos (suman).
 * `modoCalculo` = 'base' (% sobre neto) | 'compuesto' (% sobre acumulado).
 *
 * **Piso en cero (decisión del owner, 2026-07-28):** un descuento nunca puede
 * dejar el acumulado bajo cero — el tenant terminaría pagándole al cliente. Se
 * topea **regla por regla, al aplicarla**, no al final sobre el total: así la
 * traza guarda lo que realmente se descontó y el comprobante cuadra
 * (`subtotal − descuentos` sigue dando el total). Topear al final dejaría la
 * traza diciendo "500" con un total que solo bajó 100.
 * El tope no frena la venta: emite advertencia, igual que un ingrediente no
 * bloqueante sin stock.
 */
function procesarReglas(
  reglas: ReglaResuelta[],
  params: {
    neto: Decimal;
    acc: Decimal;
    /**
     * Monto realmente disponible para topear descuentos. Por defecto `acc`, que
     * es lo correcto por línea (ahí el acumulado ES la plata de la línea). A
     * nivel venta hay que pasarlo aparte: el acumulado arranca en el neto
     * agregado —que es la base de los `%`— mientras que la plata real es la
     * suma de `totalLinea`, ya con descuentos e impuestos de línea adentro.
     * Confundir las dos dejaba ventas en negativo sin advertencia.
     */
    disponible?: Decimal;
    cantidad: Decimal;
    signo: -1 | 1;
    modoCalculo: string;
    metodoPagoId: string | null;
    cfg: ConfigCalculo;
    /**
     * Cierra cada monto declarado en la escala de la moneda. Por defecto no
     * cuantiza —así se comporta el nivel `documento`, que redondea recién al
     * final—; el nivel `linea` lo pasa desde `calcularLinea`.
     *
     * Va acá adentro y no en un `.map` sobre las trazas de vuelta porque el
     * **tope contra `disponible`** tiene que mirar plata real: con dos fijos de
     * 50,5 sobre un neto de 100 en CLP, cuantizar las trazas después daría
     * 51 + 51 = 102 y una línea de −2. Cuantizando acá, el segundo se topea
     * contra lo que de verdad queda (49) y el piso en cero se sostiene.
     */
    cuantizar?: Cuantizador;
  },
): ResultadoPaso {
  let { acc } = params;
  const q = params.cuantizar ?? SIN_CUANTIZAR;
  let disponible = params.disponible ?? params.acc;
  let total = ZERO;
  const trazas: TrazaRegla[] = [];
  const advertencias: AdvertenciaPrecio[] = [];

  for (const regla of ordenarReglas(reglas)) {
    // Pausada: no aplica, no deja traza —no es un "aplicó 0"— y avisa. El
    // `continue` va antes de evaluar para que ni siquiera se calcule el monto.
    if (!regla.activo) {
      advertencias.push({
        titulo: `${params.signo === -1 ? 'Descuento' : 'Recargo'} "${regla.nombre}"`,
        detalle: 'está en pausa y no se aplicó',
      });
      continue;
    }

    const base = params.modoCalculo === 'compuesto' ? acc : params.neto;
    const evaluacion = evaluarRegla(regla, {
      base,
      cantidad: params.cantidad,
      monto: params.neto,
      metodoPagoId: params.metodoPagoId,
    });
    let monto = redondear(evaluacion.monto, params.cfg);

    // Ninguna regla aporta una magnitud negativa: el signo lo pone el TIPO de
    // regla (descuento resta, recargo suma), nunca el valor calculado. Hace
    // falta porque el acumulado que sirve de base en modo `compuesto` sí puede
    // quedar negativo a nivel venta —arranca en el neto agregado mientras que
    // la plata disponible es la suma de `totalLinea`—, y un `%` sobre esa base
    // producía un "recargo" que restaba y un "descuento" que le cobraba al
    // cliente, ambos impresos así en la traza.
    monto = Decimal.max(monto, ZERO);

    // Lo que la regla pidió, capturado ANTES del piso: abajo `monto` puede
    // recortarse al disponible, y sin esta línea la traza pierde para siempre
    // cuánto valía la regla que se topeó. Se cuantiza porque también es plata
    // que el ticket muestra ("el descuento de 1.200 aplicó 1.000").
    const solicitado = q(monto);

    if (params.signo === -1) {
      // El tope es plata real, o sea ya cuantizada: `disponible` se mueve con
      // los montos cuantizados, no con los finos.
      const tope = Decimal.max(disponible, ZERO);
      if (monto.greaterThan(tope)) {
        advertencias.push({
          titulo: `Descuento "${regla.nombre}"`,
          detalle: 'no se aplicó completo porque superaba el monto disponible',
        });
        monto = tope;
      }
    }

    const montoQ = q(monto);

    // `acc` sigue FINO dentro del paso: es la base de las reglas en modo
    // `compuesto`, y cuantizarla acá compondría el redondeo regla por regla.
    // El cierre del paso lo hace el llamador con `total`, que sí es la suma de
    // los montos cuantizados. Ver el bloque de `calcularLinea`.
    acc = acc.plus(monto.times(params.signo));
    disponible = disponible.plus(montoQ.times(params.signo));
    total = total.plus(montoQ);
    trazas.push({
      id: regla.id,
      nombre: regla.nombre,
      monto: fmt(montoQ, params.cfg),
      modo: regla.modo,
      valorEfectivo: evaluacion.valorEfectivo,
      valorSolicitado: fmt(solicitado, params.cfg),
    });
  }

  return { acc, total, trazas, advertencias };
}

// ── Cálculo por línea ───────────────────────────────────────────────────────

function calcularLinea(
  linea: LineaResuelta,
  metodoPagoId: string | null,
  cfg: ConfigCalculo,
): ResultadoLinea {
  const cantidad = new Decimal(linea.cantidad);
  const bruto = new Decimal(linea.precioUnitario);

  /**
   * **Dónde se cuantiza — la precisión que decide si el documento cuadra.**
   *
   * Con `nivelRedondeo === 'linea'` (el default de todos los tenants) cada
   * monto que la línea declara cierra en la escala de la moneda. La regla es:
   * se cuantiza al cerrar cada **PASO** de la fórmula, no en cada regla.
   *
   * - **Dentro** de un paso —varias reglas encadenadas en modo `compuesto`— el
   *   acumulado corre fino a `escala_calculo`. Cuantizar regla por regla
   *   compondría el error, que es el caso del Vancouver Stock Exchange.
   * - **Al cerrar el paso**, el acumulado pasa a ser el que el documento
   *   declara: `neto_Q − Σ descuentos_Q + Σ recargos_Q`. El paso siguiente
   *   parte de ahí.
   *
   * Esto importa por el IVA: la base imponible es el acumulado al inicio del
   * paso `impuestos`. Si se calculara sobre el acumulado fino, el impuesto
   * declarado no sería `tasa ×` la base que la boleta muestra — que es la
   * relación que un documento tributario espera. Como hay tres pasos como
   * máximo, el error queda acotado a tres redondeos, no a uno por regla.
   *
   * `'documento'` (redondear recién sobre el total de la venta) todavía no está
   * implementado: se comporta como antes de que esto existiera.
   */
  const q: Cuantizador =
    cfg.nivelRedondeo === 'linea' ? (d) => cuantizar(d, cfg) : SIN_CUANTIZAR;

  // Los impuestos pausados salen de la lista ACÁ, antes del desbruteo. Si se
  // filtraran recién al aplicarlos, su tasa seguiría inflando el divisor de
  // abajo y el neto quedaría mal aunque el impuesto no se cobrara.
  const impuestosVigentes = linea.impuestos.filter((imp) => imp.activo);

  // Neto unitario: desbrutear si el precio ya incluye impuestos.
  let netoUnitario = bruto;
  if (linea.precioIncluyeImpuesto && impuestosVigentes.length > 0) {
    const sumaTasas = impuestosVigentes.reduce(
      (acc, imp) => acc.plus(imp.porcentaje),
      ZERO,
    );
    netoUnitario = bruto.dividedBy(new Decimal(1).plus(sumaTasas));
  }
  // El primer monto de la cadena nace ya cuantizado: es el neto que el
  // documento declara, y la base de todo lo que sigue.
  const subtotalNeto = q(redondear(netoUnitario.times(cantidad), cfg));

  let acc = subtotalNeto;
  let descuentoAplicado = ZERO;
  let recargoAplicado = ZERO;
  let impuestoAplicado = ZERO;
  // El aviso del impuesto pausado solo tiene sentido si la fórmula del tenant
  // aplica impuestos: si el paso no está, ese impuesto no se iba a cobrar de
  // todos modos y "no se aplicó" describe la fórmula, no la pausa. Se armaba
  // antes del recorrido de `cfg.formula` y por eso salía siempre (medido
  // 2026-08-11: fórmula `['descuentos','recargos']` igual emitía el aviso).
  const advertencias: AdvertenciaPrecio[] = cfg.formula.includes('impuestos')
    ? linea.impuestos
        .filter((imp) => !imp.activo)
        .map((imp) => ({
          titulo: `Impuesto "${imp.nombre}"`,
          detalle: 'está en pausa y no se aplicó',
        }))
    : [];
  const trazas = {
    descuentos: [] as TrazaRegla[],
    recargos: [] as TrazaRegla[],
    impuestos: [] as TrazaImpuesto[],
  };

  for (const paso of cfg.formula) {
    if (paso === 'descuentos') {
      const alAbrir = acc;
      const r = procesarReglas(linea.descuentos, {
        neto: subtotalNeto,
        acc,
        cantidad,
        signo: -1,
        modoCalculo: cfg.calculoDescuentos,
        metodoPagoId,
        cfg,
        cuantizar: q,
      });
      descuentoAplicado = r.total;
      // Cierre del paso: el acumulado se rearma con el total DECLARADO, no con
      // `r.acc` (que trae los montos finos que se usaron de base adentro del
      // paso). Sin cuantizar los dos valores coinciden exactamente.
      acc = alAbrir.minus(descuentoAplicado);
      trazas.descuentos = r.trazas;
      advertencias.push(...r.advertencias);
    } else if (paso === 'recargos') {
      const alAbrir = acc;
      const r = procesarReglas(linea.recargos, {
        neto: subtotalNeto,
        acc,
        cantidad,
        signo: 1,
        modoCalculo: cfg.calculoRecargos,
        metodoPagoId,
        cfg,
        cuantizar: q,
      });
      recargoAplicado = r.total;
      acc = alAbrir.plus(recargoAplicado); // cierre del paso, ver arriba
      trazas.recargos = r.trazas;
      // Hasta que existieron las reglas pausadas, un recargo no podía generar
      // advertencias —el tope solo avisa en descuentos— y esta línea no hacía
      // falta. Ahora sí: sin ella, el aviso del recargo pausado se perdía acá.
      advertencias.push(...r.advertencias);
    } else if (paso === 'impuestos') {
      // Base imponible = acumulado al inicio del paso (no hay impuesto sobre
      // impuesto), ya cuantizado por el cierre del paso anterior: el impuesto
      // declarado es `tasa ×` la base que el documento muestra.
      const baseImponible = acc;
      for (const imp of impuestosVigentes) {
        // Cada impuesto se cuantiza por separado porque cada uno es una línea
        // declarada del documento, y todos salen de la MISMA base: acá no hay
        // cascada que componer, así que `Σ trazas = impuestoAplicado`.
        const monto = q(redondear(baseImponible.times(imp.porcentaje), cfg));
        impuestoAplicado = impuestoAplicado.plus(monto);
        acc = acc.plus(monto);
        trazas.impuestos.push({
          id: imp.id,
          nombre: imp.nombre,
          tasa: imp.porcentaje,
          monto: fmt(monto, cfg),
        });
      }
    }
  }

  // El total NO se cuantiza aparte: se DERIVA de sus partes, que ya lo están.
  // Cuantizar el total además de sus componentes es lo que rompe la identidad
  // aditiva del comprobante (`subtotal − descuentos + recargos + impuestos`).
  // Coincide con `acc` —los pasos cierran con estos mismos totales— pero se
  // escribe explícito porque la identidad es lo que el documento promete.
  const totalLinea = subtotalNeto
    .minus(descuentoAplicado)
    .plus(recargoAplicado)
    .plus(impuestoAplicado);

  return {
    itemId: linea.itemId,
    cantidad: linea.cantidad,
    precioUnitario: linea.precioUnitario,
    subtotalNeto: fmt(subtotalNeto, cfg),
    descuentoAplicado: fmt(descuentoAplicado, cfg),
    recargoAplicado: fmt(recargoAplicado, cfg),
    impuestoAplicado: fmt(impuestoAplicado, cfg),
    totalLinea: fmt(totalLinea, cfg),
    trazas,
    advertencias,
  };
}

// ── Cálculo de la venta completa ────────────────────────────────────────────

export function calcularVenta(venta: VentaResuelta): ResultadoVenta {
  const { config: cfg } = venta;

  const lineas = venta.lineas.map((l) =>
    calcularLinea(l, venta.metodoPagoId, cfg),
  );

  let subtotalNeto = ZERO;
  let totalDescuentos = ZERO;
  let totalRecargos = ZERO;
  let totalImpuestos = ZERO;
  let totalFinal = ZERO;
  let cantidadTotal = ZERO;

  for (const l of lineas) {
    subtotalNeto = subtotalNeto.plus(l.subtotalNeto);
    totalDescuentos = totalDescuentos.plus(l.descuentoAplicado);
    totalRecargos = totalRecargos.plus(l.recargoAplicado);
    totalImpuestos = totalImpuestos.plus(l.impuestoAplicado);
    totalFinal = totalFinal.plus(l.totalLinea);
    cantidadTotal = cantidadTotal.plus(l.cantidad);
  }

  // Reglas a nivel venta: aplican sobre el neto agregado, respetando el orden
  // de la fórmula del tenant (el paso `impuestos` no aplica a nivel venta).
  let accVenta = subtotalNeto;
  let dv: ResultadoPaso = {
    acc: accVenta,
    total: ZERO,
    trazas: [],
    advertencias: [],
  };
  let rv: ResultadoPaso = {
    acc: accVenta,
    total: ZERO,
    trazas: [],
    advertencias: [],
  };

  // Plata real de la venta sobre la que se topea: la suma de `totalLinea`, no
  // el neto agregado. `accVenta` sigue siendo la base de los `%` (el neto), que
  // es la semántica documentada de las reglas a nivel venta.
  let disponibleVenta = totalFinal;

  for (const paso of cfg.formula) {
    if (paso === 'descuentos') {
      dv = procesarReglas(venta.descuentosVenta, {
        neto: subtotalNeto,
        acc: accVenta,
        disponible: disponibleVenta,
        cantidad: cantidadTotal,
        signo: -1,
        modoCalculo: cfg.calculoDescuentos,
        metodoPagoId: venta.metodoPagoId,
        cfg,
      });
      accVenta = dv.acc;
      disponibleVenta = disponibleVenta.minus(dv.total);
    } else if (paso === 'recargos') {
      rv = procesarReglas(venta.recargosVenta, {
        neto: subtotalNeto,
        acc: accVenta,
        cantidad: cantidadTotal,
        signo: 1,
        modoCalculo: cfg.calculoRecargos,
        metodoPagoId: venta.metodoPagoId,
        cfg,
      });
      accVenta = rv.acc;
      disponibleVenta = disponibleVenta.plus(rv.total);
    }
  }

  totalDescuentos = totalDescuentos.plus(dv.total);
  totalRecargos = totalRecargos.plus(rv.total);
  totalFinal = totalFinal.minus(dv.total).plus(rv.total);

  return {
    lineas,
    totales: {
      subtotalNeto: fmt(subtotalNeto, cfg),
      totalDescuentos: fmt(totalDescuentos, cfg),
      totalRecargos: fmt(totalRecargos, cfg),
      totalImpuestos: fmt(totalImpuestos, cfg),
      totalFinal: fmt(totalFinal, cfg),
    },
    trazasVenta: { descuentos: dv.trazas, recargos: rv.trazas },
    // `rv.advertencias` va junto a `dv.advertencias`, no en su lugar. Hasta que
    // existieron las reglas pausadas, un recargo no podía avisar nada —el tope
    // solo avisa en descuentos— y leer solo `dv` no perdía nada. Ahora sí: sin
    // `rv`, un recargo de venta pausado bajaba la plata cobrada sin traza y sin
    // advertencia. Mismo olvido que a nivel línea, en la otra punta.
    advertencias: sinRepetidas([
      ...lineas.flatMap((l) => l.advertencias),
      ...dv.advertencias,
      ...rv.advertencias,
    ]),
    advertenciasVenta: [...dv.advertencias, ...rv.advertencias],
    config: cfg,
  };
}
