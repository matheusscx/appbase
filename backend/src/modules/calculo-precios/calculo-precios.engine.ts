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
  /**
   * El importe vive en UNA de las dos, la que dice `modo`. Las dos en null es
   * el estado de una regla por tramos, que lo expresa en `tramos[]`.
   */
  valorMonto: string | null;
  /** Decimal en string: 0.10 = 10%. */
  valorPorcentaje: string | null;
  tramos: {
    minimo: string;
    valorMonto: string | null;
    valorPorcentaje: string | null;
  }[];
  metodoPagoIds: string[];
  /**
   * `false` = pausada: no se aplica y emite advertencia. Requerido a propósito:
   * si fuera opcional, olvidarse de mapearlo en el service haría que la regla
   * pausada volviera a cobrarse en silencio, que es justo el bug que esto cierra.
   */
  activo: boolean;
  /**
   * `false` = fuera de su rango de fechas: no se aplica y **NO** avisa.
   *
   * La diferencia con `activo` no es un descuido: una regla **pausada** es una
   * anomalía que alguien provocó y el aviso se la recuerda; una regla **fuera de
   * fecha** es la regla funcionando como se configuró, y avisarla sería un toast
   * en cada venta durante los meses que no rige.
   *
   * Requerido a propósito, igual que `activo`: si fuera opcional, olvidarse de
   * mapearlo en el service haría que una regla vencida volviera a cobrarse en
   * silencio, que es justo el bug que esto cierra. Lo calcula
   * `CalculoPreciosService.indexarReglas` — el motor no sabe de fechas ni de
   * husos horarios.
   */
  vigente: boolean;
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
  /**
   * `'iva'` | `'otro'` (`impuestos.tipo`). Lo necesita el desbruteo: cuando el
   * precio ya incluye impuesto y la línea no lleva reglas, el total cierra al
   * precio de góndola y los adicionales se calculan por su fórmula mientras el
   * IVA se queda con el residuo. Ver `calcularLinea`.
   *
   * Requerido a propósito, igual que `activo`: el service ya lo manda, y dejarlo
   * opcional haría que olvidarse de mapearlo eligiera absorbente en silencio.
   */
  tipo: string;
}

export interface LineaResuelta {
  itemId: string;
  cantidad: string;
  /** Precio unitario ya resuelto (override o precio_base del ítem). */
  precioUnitario: string;
  precioIncluyeImpuesto: boolean;
  /**
   * Estado fiscal de la línea (`'afecto'` | `'exento'` | `null`), tal como lo
   * decide **ADR-018**: sale de `items.clasificacion_tributaria` y **no** se
   * deriva de la lista de impuestos.
   *
   * El motor no puede reconstruirlo por su cuenta —una línea sin IVA puede ser
   * un ítem exento, pero también un `tipo='ingrediente'` con la columna en
   * `NULL`, que es lo que ya explica `elegirAbsorbente`— y adivinarlo violaría
   * la invariante de que exento es un estado fiscal explícito y nunca la
   * ausencia de impuesto.
   *
   * Lo consume el prorrateo del descuento de nivel venta, que reparte contra la
   * base afecta y la exenta por separado porque el DTE las declara separadas
   * (`MntNeto` suma solo los items con `IndExe = 0`). Llega en un cambio propio
   * y **antes** que ese reparto para que el cambio de contrato se verifique
   * aislado: decisiones (c) y (f) de
   * `docs/superpowers/specs/2026-08-21-descuento-global-vs-iva-decisiones.md`.
   *
   * Requerido a propósito, igual que `activo` y `tipo`: si fuera opcional,
   * olvidarse de mapearlo en el service dejaría la línea sin estado fiscal y el
   * reparto la trataría como exenta —sin IVA que bajar— en silencio.
   */
  clasificacionTributaria: string | null;
  descuentos: ReglaResuelta[];
  recargos: ReglaResuelta[];
  impuestos: ImpuestoResuelto[];
}

/**
 * Los cuatro modos que `modoToRounding` sabe traducir. Es unión y no `string`
 * porque el `default:` de esa traducción cae a `HALF_UP`: escrito como `string`,
 * un typo no falla en compilación ni en runtime — redondea distinto, en silencio,
 * y sobre plata. La misma razón vale para `NivelRedondeo`, donde el typo cae al
 * comportamiento de `'linea'`.
 *
 * El valor entra por `UpdatePreferenciasFinancierasDto` (`@IsIn`) y `nivel_redondeo`
 * tiene además un CHECK en la tabla. Lo que la unión agrega es el tramo interno: de
 * la preferencia del tenant hasta el motor, nadie puede inventar un quinto modo sin
 * que el compilador lo diga.
 */
export type ModoRedondeo = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL';

/** Ver `ModoRedondeo`. `'documento'` es la regla mexicana; ADR/spec de redondeo. */
export type NivelRedondeo = 'linea' | 'documento';

export interface ConfigCalculo {
  /** Orden de los tres pasos, p.ej. ['descuentos','recargos','impuestos']. */
  formula: string[];
  calculoDescuentos: string; // 'base' | 'compuesto'
  calculoRecargos: string; // 'base' | 'compuesto'
  escalaCalculo: number;
  modoRedondeo: ModoRedondeo;
  nivelRedondeo: NivelRedondeo;
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
  /**
   * Parte de esta línea en los descuentos y recargos de **nivel venta**, en
   * términos de NETO y con signo (negativo = descuento). Es un componente más
   * de la identidad aditiva de la línea, igual que `descuentoAplicado`.
   *
   * Existe porque una regla de documento no se puede declarar solo en el
   * documento: el IVA se calcula por línea y con tasas que pueden diferir entre
   * líneas (IVA + ILA), así que el descuento global tiene que bajar a la línea
   * para que su base imponible lo refleje. Es el mismo mecanismo que usa el
   * mercado —Square crea un descuento por línea para cada descuento de scope
   * `ORDER`— y lo que el DTE espera: `MntNeto` suma los items menos los
   * descuentos de `DscRcgGlobal`.
   *
   * **En NETO, no en lo cobrado.** Un descuento fijo de 100 sobre una línea con
   * IVA 19% baja lo cobrado en 100, pero declara 84 de descuento y 16 menos de
   * IVA — que es lo que `MntNeto = Σ MontoItem − Descuentos` pide. Ver la
   * decisión (a) de
   * `docs/superpowers/specs/2026-08-21-descuento-global-vs-iva-decisiones.md`.
   */
  ajusteVenta: string;
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
 *
 * Es un `Record` y no un `switch` con `default:` para que esa promesa la sostenga
 * el compilador: sumar un modo a `ModoRedondeo` sin mapearlo acá NO compila,
 * mientras que un `default:` se lo tragaba redondeando distinto en silencio.
 */
const ROUNDING_POR_MODO: Record<ModoRedondeo, Decimal.Rounding> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  HALF_EVEN: Decimal.ROUND_HALF_EVEN,
  FLOOR: Decimal.ROUND_FLOOR,
  CEIL: Decimal.ROUND_CEIL,
};

/**
 * El modo que gobierna cuando NO hay uno que elegir. Dos casos, y los dos apuntan
 * acá a propósito: un `config_calculo` ausente en la venta que un reembolso
 * corrige (ver `VentasReembolsoHandler`), y un valor que el tipo no puede
 * garantizar en runtime porque salió del JSONB. Antes el segundo vivía en el
 * `default:` de la función y el primero en una constante del handler: mismo valor,
 * dos lugares, y nada que los mantuviera sincronizados.
 */
export const MODO_REDONDEO_DEFAULT: ModoRedondeo = 'HALF_UP';

export function modoToRounding(modo: ModoRedondeo): Decimal.Rounding {
  return ROUNDING_POR_MODO[modo] ?? ROUNDING_POR_MODO[MODO_REDONDEO_DEFAULT];
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

/**
 * La columna que corresponde al modo. No elige entre dos valores: nombra cuál
 * de las dos existe. Que nunca estén las dos llenas lo garantiza el CHECK de
 * tabla, no esta función — acá el modo manda y la otra columna se ignora.
 */
function valorDelModo(
  modo: ModoRegla,
  valores: { valorMonto: string | null; valorPorcentaje: string | null },
): string | null {
  return modo === 'monto_fijo' ? valores.valorMonto : valores.valorPorcentaje;
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
  tramos: ReglaResuelta['tramos'],
  magnitud: Decimal,
): ReglaResuelta['tramos'][number] | null {
  let elegido: ReglaResuelta['tramos'][number] | null = null;
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
 * no del valor plano de la regla (que ahí es `null` en las dos columnas).
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
    const valor = valorDelModo(regla.modo, regla);
    return {
      monto: aplicarValor(regla.modo, valor, ctx.base),
      valorEfectivo: valor,
    };
  }

  if (regla.tramos.length > 0) {
    const magnitud = codigo === 'por_mayor' ? ctx.cantidad : ctx.monto;
    const tramo = seleccionarTramo(regla.tramos, magnitud);
    if (!tramo) return SIN_VALOR;
    // El tramo elegido ES el valor de la regla en esta venta. Propagarlo es lo
    // único que permite reportarlo después: el valor plano de la regla es
    // `null` acá, en las dos columnas.
    const valorTramo = valorDelModo(regla.modo, tramo);
    return {
      monto: aplicarValor(regla.modo, valorTramo, ctx.base),
      valorEfectivo: valorTramo,
    };
  }

  const valor = valorDelModo(regla.modo, regla);
  return {
    monto: aplicarValor(regla.modo, valor, ctx.base),
    valorEfectivo: valor,
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
    /**
     * Base de los `%` cuando `modoCalculo` es `base`. Por defecto `neto`, que es
     * lo correcto por línea. **A nivel venta se pasa la plata cobrada**, no el
     * neto agregado: la decisión (a) dice que un descuento global se mide contra
     * lo que el cliente paga, y un `%` sobre el neto no es el mismo número que
     * un `%` sobre el total.
     *
     * Va aparte de `neto` a propósito: `neto` sigue siendo la magnitud con la
     * que se elige el tramo de una regla `por_monto_venta`, y mezclarlos
     * cambiaría qué tramo aplica, que no es lo que esta decisión decidió.
     */
    basePorcentaje?: Decimal;
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
     * 50,5 sobre un neto de 100 en CLP, el tope fino deja pasar 50,5 y 49,5, y
     * cuantizar las trazas después daría 51 + 50 = 101 sobre un neto de 100 —
     * una línea en −1. Cuantizando acá, el segundo se topea contra lo que de
     * verdad queda (49) y el piso en cero se sostiene. Es el mismo número que
     * mide `anti-patterns.md` en su entrada de cuantización.
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

    // Fuera de vigencia: mismo trato que la pausada —no aplica, no deja traza,
    // el `continue` va antes de evaluar— salvo que acá NO se avisa. Ver el
    // docblock de `ReglaResuelta.vigente`.
    if (!regla.vigente) continue;

    const base =
      params.modoCalculo === 'compuesto'
        ? acc
        : (params.basePorcentaje ?? params.neto);
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
        // El recorte se aplica siempre —un descuento no puede pasarse de lo
        // disponible— pero el AVISO mira plata, no el monto fino. Comparando en
        // fino avisaba también cuando el recorte no sobrevive a la cuantización:
        // 49,4 topeado a 49 es el mismo peso en CLP, la traza queda idéntica a lo
        // solicitado y el cajero leía "no se aplicó completo" sobre un descuento
        // que entró entero. Un aviso que no describe nada entrena a ignorarlos.
        if (q(monto).greaterThan(q(tope))) {
          advertencias.push({
            titulo: `Descuento "${regla.nombre}"`,
            detalle:
              'no se aplicó completo porque superaba el monto disponible',
          });
        }
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

/**
 * Quién absorbe el residuo del desbruteo: el **IVA**, si la lista lo trae.
 *
 * Si no hay ningún impuesto `tipo === 'iva'`, absorbe el adicional de **mayor
 * tasa**, que es el que menos se distorsiona en términos relativos al comerse
 * un peso. Ese borde es real: los `'otro'` se aplican también sin IVA (DL 825 /
 * `IndExe` del DTE).
 *
 * ⚠️ Deliberadamente NO dice "línea exenta": exento es un estado fiscal
 * explícito y el motor no lo recibe. Lo único que ve acá es una lista sin IVA,
 * y a eso se llega de más de una forma —un ítem exento, pero también uno con
 * `clasificacion_tributaria` nula, que es el caso de los ingredientes (ver
 * `calculo-precios.service.ts`, donde la condición es POSITIVA por esto mismo)—.
 *
 * El desempate por `id` no es cosmético: sin él, dos adicionales de la misma
 * tasa harían depender la traza del orden en que el service devolvió la lista,
 * y la misma venta declararía montos distintos según la consulta.
 *
 * Se copia el array antes de ordenar: la lista es del llamador.
 */
function elegirAbsorbente(impuestos: ImpuestoResuelto[]): string {
  const iva = impuestos.find((i) => i.tipo === 'iva');
  if (iva) return iva.id;
  return [...impuestos].sort((a, b) => {
    const cmp = new Decimal(b.porcentaje).comparedTo(a.porcentaje);
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  })[0].id;
}

// ── Cálculo por línea ───────────────────────────────────────────────────────

function calcularLinea(
  linea: LineaResuelta,
  metodoPagoId: string | null,
  cfg: ConfigCalculo,
  /**
   * Parte prorrateada de las reglas de nivel venta que le toca a esta línea,
   * **en plata cobrada** y con signo (negativo = descuento). Llega en cero en
   * la primera pasada de `calcularVenta` —que es la que calcula los pesos del
   * reparto— y con su valor en la segunda.
   */
  ajusteVenta: Decimal = ZERO,
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
   * Con `'documento'` esta función es la identidad: la línea corre fina de
   * punta a punta, exactamente como antes de que `nivelRedondeo` existiera.
   * El cierre pasa a `calcularVenta`, que cuantiza los totales del documento
   * al terminar — ver el comentario ahí, antes del `return`.
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
  // Lo que el ajuste de venta declara en NETO. Sale de dividir el ajuste
  // cobrado por `1 + Σ tasas` de ESTA línea: una línea exenta se lleva su parte
  // entera como neto, una afecta la parte entre neto e IVA. Es la prorrata de
  // la decisión (c) sin necesidad de tratar las dos bases por separado.
  let ajusteVentaNeto = ZERO;
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

  /**
   * ¿Quedan reglas por aplicar DESPUÉS del paso de impuestos? Con la fórmula
   * default (descuentos → recargos → impuestos) nunca, y ahí el cierre a
   * góndola se decide con lo REALMENTE aplicado —una regla pausada, sin tramo
   * o de otro método de pago aporta 0 y la línea sigue cerrando a la etiqueta—.
   * Si el tenant puso los impuestos primero, lo aplicado todavía no se conoce:
   * con reglas en la lista se asume que van a mover el monto y se usa la
   * fórmula normal, que es la rama segura.
   */
  const hayReglasDespuesDelImpuesto = cfg.formula
    .slice(cfg.formula.indexOf('impuestos') + 1)
    .some((p) =>
      p === 'descuentos'
        ? linea.descuentos.length > 0
        : p === 'recargos' && linea.recargos.length > 0,
    );

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
      const baseSinAjuste = acc;
      const sumaTasas = impuestosVigentes.reduce(
        (a, imp) => a.plus(imp.porcentaje),
        ZERO,
      );

      /**
       * **La etiqueta manda cuando el cliente paga la etiqueta** (decisión del
       * owner, 2026-08-04, corregida el 2026-08-21): cuando el precio ya
       * incluye impuesto y la base volvió al neto de la góndola, el cliente
       * paga exactamente lo que vio, así que el total es el bruto y el impuesto
       * es lo que sobra sobre el neto declarado. Con `tasa × base` no cierra:
       * góndola 993 → neto 834, IVA 158, total 992.
       *
       * **La condición mira lo que el cliente PAGÓ, no CÓMO llegó ahí**, y esa
       * distinción es la corrección. Preguntar `descuentoAplicado.isZero() &&
       * recargoAplicado.isZero()` dejaba fuera a la línea con un descuento y un
       * recargo que se anulan —la base es la misma, el cliente paga la etiqueta
       * y el documento salía por la fórmula—. Medido: barriendo góndolas
       * 100..3000 con IVA 19% en CLP, **463 de 2901 precios (16%) declaraban ±1
       * peso contra su propia etiqueta** (993 → 992, pero también 103 → 104).
       * No hacía falta un caso exótico: alcanza un descuento y un recargo del
       * mismo porcentaje con `calculoDescuentos: 'base'`, que es el default de
       * todo tenant, porque ahí los dos aplican sobre el neto.
       *
       * **Sigue sin generalizarse a la línea cuya base SÍ se movió, y está
       * medido:** con un 10% de descuento sobre esa misma línea (base 751),
       * restar contra la góndola da un IVA de 242 —cobra la etiqueta entera e
       * ignora el descuento— y restar contra góndola−descuento da 159, cuando
       * el correcto es 143. Esa línea la excluye la comparación de bases sola,
       * sin necesitar el guard viejo.
       */
      const cierraAGondola =
        linea.precioIncluyeImpuesto &&
        impuestosVigentes.length > 0 &&
        baseSinAjuste.eq(subtotalNeto) &&
        !hayReglasDespuesDelImpuesto;

      /**
       * **El ancla del cierre — qué monto tiene que dar la línea.**
       *
       * Un descuento de nivel venta NO apaga el cierre: le **mueve el ancla**,
       * de "el precio de etiqueta" a "lo que la línea iba a cobrar menos su
       * parte del descuento". Es la decisión (e) corregida por el spike del
       * 2026-08-21, y la corrección no es cosmética: barriendo brutos 100..3000
       * contra descuentos fijos {1,7,100,333}, derivar el impuesto por resta y
       * aplicar `tasa × base` **difieren en 1.815 de 11.604 casos (15,6%)**, y
       * en esos casos `tasa × base` rompe que `base + impuesto` sea el total
       * (`87 + 17 = 104` sobre un total de 103). Por resta cierra siempre, por
       * construcción — que es lo mismo que el cierre del documento ya protege.
       *
       * Solo se ancla si el paso de impuestos es el último que mueve plata: con
       * reglas después, el acumulado va a seguir cambiando y el ancla mentiría.
       * Ahí el ajuste entra como corrimiento de la base y los impuestos van por
       * su fórmula, que es la rama segura.
       */
      const puedeAnclar = !hayReglasDespuesDelImpuesto;
      let ancla: Decimal | null = cierraAGondola
        ? q(redondear(bruto.times(cantidad), cfg))
        : null;
      if (!ajusteVenta.isZero() && puedeAnclar) {
        const sinAjuste =
          ancla ??
          baseSinAjuste.plus(
            impuestosVigentes.reduce(
              (a, imp) =>
                a.plus(q(redondear(baseSinAjuste.times(imp.porcentaje), cfg))),
              ZERO,
            ),
          );
        ancla = sinAjuste.plus(ajusteVenta);
      }

      if (ancla !== null) {
        const baseImponible = ajusteVenta.isZero()
          ? baseSinAjuste
          : q(redondear(ancla.dividedBy(new Decimal(1).plus(sumaTasas)), cfg));
        ajusteVentaNeto = baseImponible.minus(baseSinAjuste);
        // Lo que queda entre el ancla y el neto ES el impuesto de la línea.
        const residuo = ancla.minus(baseImponible);

        if (impuestosVigentes.length > 0) {
          // Los adicionales van por su fórmula y el IVA se queda con el
          // residuo: el ILA de una botella es una línea del DTE con su tasa,
          // mientras que el peso del redondeo tiene que caer en algún lado. Ver
          // `elegirAbsorbente` para la línea exenta, que no tiene IVA que ceda.
          const absorbeId = elegirAbsorbente(impuestosVigentes);
          let repartido = ZERO;

          // Se recorre en el orden de entrada —el absorbente se completa
          // después— para que las líneas de impuesto del documento salgan como
          // llegaron: el orden de las trazas es parte de lo que el comprobante
          // imprime.
          for (const imp of impuestosVigentes) {
            const monto =
              imp.id === absorbeId
                ? ZERO
                : q(redondear(baseImponible.times(imp.porcentaje), cfg));
            repartido = repartido.plus(monto);
            trazas.impuestos.push({
              id: imp.id,
              nombre: imp.nombre,
              tasa: imp.porcentaje,
              monto: fmt(monto, cfg),
            });
          }

          // La traza del absorbente dice lo que REALMENTE absorbió, no
          // `tasa × base`: cada impuesto es una línea declarada del documento y
          // `Σ trazas = impuestoAplicado` tiene que seguir valiendo.
          const traza = trazas.impuestos.find((t) => t.id === absorbeId)!;
          traza.monto = fmt(residuo.minus(repartido), cfg);
        }

        impuestoAplicado = residuo;
        acc = baseImponible.plus(residuo);
      } else {
        // Sin ancla. Si hay ajuste de venta, corre la base antes de aplicar las
        // tasas: el descuento global tiene que bajar la base imponible igual,
        // aunque acá no se pueda cerrar por resta.
        if (!ajusteVenta.isZero()) {
          ajusteVentaNeto = q(
            redondear(
              ajusteVenta.dividedBy(new Decimal(1).plus(sumaTasas)),
              cfg,
            ),
          );
        }
        const baseImponible = baseSinAjuste.plus(ajusteVentaNeto);
        acc = baseImponible;
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
  }

  // El total NO se cuantiza aparte: se DERIVA de sus partes, que ya lo están.
  // Cuantizar el total además de sus componentes es lo que rompe la identidad
  // aditiva del comprobante (`subtotal − descuentos + recargos + impuestos`).
  // Coincide con `acc` —los pasos cierran con estos mismos totales— pero se
  // escribe explícito porque la identidad es lo que el documento promete.
  const totalLinea = subtotalNeto
    .minus(descuentoAplicado)
    .plus(recargoAplicado)
    .plus(ajusteVentaNeto)
    .plus(impuestoAplicado);

  return {
    itemId: linea.itemId,
    cantidad: linea.cantidad,
    precioUnitario: linea.precioUnitario,
    subtotalNeto: fmt(subtotalNeto, cfg),
    descuentoAplicado: fmt(descuentoAplicado, cfg),
    recargoAplicado: fmt(recargoAplicado, cfg),
    ajusteVenta: fmt(ajusteVentaNeto, cfg),
    impuestoAplicado: fmt(impuestoAplicado, cfg),
    totalLinea: fmt(totalLinea, cfg),
    trazas,
    advertencias,
  };
}

/**
 * Reparte `monto` entre `pesos` en proporción, y **asigna el residuo al resto
 * fraccionario más grande** — desempatando por posición.
 *
 * El residuo no es un detalle: repartir 100 entre netos de 333/333/334
 * cuantizando cada parte da `33 + 33 + 33 = 99` (medido). Sin esta regla el
 * reparto no suma el descuento y el documento no cuadra.
 *
 * El desempate por posición vale acá y NO valdría en `elegirAbsorbente`: la
 * posición de una línea es el orden del documento —lo que el comprobante
 * imprime— mientras que allá el orden venía de una consulta y podía cambiar
 * entre dos lecturas de la misma venta.
 *
 * Con `Σ pesos = 0` (una venta que no cobra nada) reparte todo en la primera
 * línea: no hay proporción que calcular y el `disponible` de arriba ya garantizó
 * que el monto sea cero, así que es un borde defensivo, no un caso real.
 */
function repartirProporcional(
  monto: Decimal,
  pesos: Decimal[],
  cfg: ConfigCalculo,
): Decimal[] {
  const total = pesos.reduce((a, p) => a.plus(p), ZERO);
  if (pesos.length === 0) return [];
  if (total.isZero()) {
    return pesos.map((_, i) => (i === 0 ? monto : ZERO));
  }

  const finas = pesos.map((peso) => monto.times(peso).dividedBy(total));
  const partes = finas.map((f) => cuantizar(f, cfg));
  const repartido = partes.reduce((a, p) => a.plus(p), ZERO);
  let sobra = monto.minus(repartido);
  if (sobra.isZero()) return partes;

  // Un paso de la unidad mínima, con el signo de lo que falta repartir.
  const unidad = new Decimal(10).pow(-cfg.decimalesMoneda).times(sobra.s);
  const orden = finas
    .map((f, i) => ({ i, resto: f.minus(partes[i]).abs() }))
    .sort((a, b) => {
      const cmp = b.resto.comparedTo(a.resto);
      return cmp !== 0 ? cmp : a.i - b.i;
    });
  for (const { i } of orden) {
    if (sobra.isZero()) break;
    partes[i] = partes[i].plus(unidad);
    sobra = sobra.minus(unidad);
  }
  return partes;
}

/**
 * Reescribe los montos de un grupo de trazas para que sumen `total`,
 * respetando sus proporciones. Se usa al convertir las reglas de documento de
 * plata cobrada a neto: el monto de cada regla cambia, la proporción entre
 * ellas no, y `Σ trazas = lo declarado` tiene que seguir valiendo.
 */
function reescalarTrazas(
  trazas: TrazaRegla[],
  total: Decimal,
  factor: Decimal,
  cfg: ConfigCalculo,
): TrazaRegla[] {
  if (trazas.length === 0) return trazas;
  const partes = repartirProporcional(
    total,
    trazas.map((tz) => new Decimal(tz.monto)),
    cfg,
  );
  return trazas.map((tz, i) => ({
    ...tz,
    monto: fmt(partes[i], cfg),
    // `valorSolicitado` se convierte con el mismo factor y no con el reparto:
    // no tiene que sumar nada, pero SÍ tiene que seguir siendo comparable con
    // `monto` —su docblock promete que son iguales salvo en un descuento
    // topeado— y dejarlo en plata cobrada rompería justo esa comparación.
    valorSolicitado: fmt(
      cuantizar(new Decimal(tz.valorSolicitado).times(factor), cfg),
      cfg,
    ),
  }));
}

// ── Cálculo de la venta completa ────────────────────────────────────────────

export function calcularVenta(venta: VentaResuelta): ResultadoVenta {
  const { config: cfg } = venta;

  // Las reglas de nivel venta son campos de DOCUMENTO (el DscRcgGlobal del
  // DTE): se cuantizan como cualquier monto cobrado, con el mismo criterio
  // que usa `calcularLinea` — así el ticket cuadra sumando líneas y restando
  // el descuento global. El modelo ya las trata así: `ventas_descuentos` las
  // persiste con `detalle_id null`.
  const q: Cuantizador =
    cfg.nivelRedondeo === 'linea' ? (d) => cuantizar(d, cfg) : SIN_CUANTIZAR;

  /**
   * **Dos pasadas, y la primera no se tira.** La pasada 1 calcula las líneas
   * sin ajuste: da los pesos del reparto y la plata cobrada sobre la que se
   * miden las reglas de documento. La pasada 2 las recalcula con su parte
   * prorrateada, para que la base imponible de cada línea refleje el descuento
   * global. Es aritmética pura —ni una consulta— así que el costo es nulo.
   */
  const totalizar = (ls: ResultadoLinea[]) => {
    let neto = ZERO;
    let desc = ZERO;
    let rec = ZERO;
    let imp = ZERO;
    let ajuste = ZERO;
    let total = ZERO;
    let cant = ZERO;
    for (const l of ls) {
      neto = neto.plus(l.subtotalNeto);
      desc = desc.plus(l.descuentoAplicado);
      rec = rec.plus(l.recargoAplicado);
      imp = imp.plus(l.impuestoAplicado);
      ajuste = ajuste.plus(l.ajusteVenta);
      total = total.plus(l.totalLinea);
      cant = cant.plus(l.cantidad);
    }
    return { neto, desc, rec, imp, ajuste, total, cant };
  };

  let lineas = venta.lineas.map((l) =>
    calcularLinea(l, venta.metodoPagoId, cfg),
  );
  let t = totalizar(lineas);
  const subtotalNeto = t.neto;
  const cantidadTotal = t.cant;

  // Reglas a nivel venta: aplican sobre la plata cobrada, respetando el orden
  // de la fórmula del tenant. El paso `impuestos` no corre acá y no es un
  // olvido: el impuesto se recalcula por línea en la pasada 2, porque las
  // líneas pueden llevar tasas distintas (IVA + ILA) y no existe una tasa única
  // aplicable al agregado.
  let accVenta = t.total;
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

  // Plata real de la venta sobre la que se topea: la suma de `totalLinea`. Ya
  // es la misma que la base de los `%`, así que las dos no pueden divergir —
  // que era el bug que dejaba ventas en negativo sin advertencia.
  let disponibleVenta = t.total;

  for (const paso of cfg.formula) {
    if (paso === 'descuentos') {
      dv = procesarReglas(venta.descuentosVenta, {
        neto: subtotalNeto,
        basePorcentaje: accVenta,
        acc: accVenta,
        disponible: disponibleVenta,
        cantidad: cantidadTotal,
        signo: -1,
        modoCalculo: cfg.calculoDescuentos,
        metodoPagoId: venta.metodoPagoId,
        cfg,
        cuantizar: q,
      });
      accVenta = dv.acc;
      disponibleVenta = disponibleVenta.minus(dv.total);
    } else if (paso === 'recargos') {
      rv = procesarReglas(venta.recargosVenta, {
        neto: subtotalNeto,
        basePorcentaje: accVenta,
        acc: accVenta,
        cantidad: cantidadTotal,
        signo: 1,
        modoCalculo: cfg.calculoRecargos,
        metodoPagoId: venta.metodoPagoId,
        cfg,
        cuantizar: q,
      });
      accVenta = rv.acc;
      disponibleVenta = disponibleVenta.plus(rv.total);
    }
  }

  /**
   * El efecto NETO de las reglas de documento, en plata cobrada. Baja a las
   * líneas prorrateado por lo que cada una aporta, y ahí cada línea decide
   * cuánto de su parte es neto y cuánto impuesto, según SUS tasas: una línea
   * exenta se lleva su parte entera como neto y una afecta la parte. Eso es la
   * prorrata entre base afecta y exenta de la decisión (c), sin necesidad de
   * tratar las dos bases por separado.
   *
   * Se reparte el neto de descuentos y recargos junto, no cada uno por su lado:
   * el documento declara el efecto sobre `MntNeto`, y el detalle regla por
   * regla no se pierde —vive en `trazasVenta`—.
   */
  const ajusteBruto = rv.total.minus(dv.total);
  if (!ajusteBruto.isZero()) {
    const partes = repartirProporcional(
      ajusteBruto,
      lineas.map((l) => new Decimal(l.totalLinea)),
      cfg,
    );
    lineas = venta.lineas.map((l, i) =>
      calcularLinea(l, venta.metodoPagoId, cfg, partes[i]),
    );
    t = totalizar(lineas);
  }

  /**
   * **Las reglas de documento se declaran en NETO, no en plata cobrada.**
   *
   * `procesarReglas` las evaluó contra lo que el cliente paga —eso es la
   * decisión (a)— pero lo que el documento declara es el efecto sobre la base:
   * `MntNeto = Σ MontoItem − Descuentos + Recargos`. Un descuento fijo de 100
   * sobre una línea con IVA 19% baja lo cobrado en 100 y declara 84.
   *
   * La conversión se hace con el factor agregado neto/cobrado que las líneas ya
   * resolvieron, y el recargo se despeja del descuento en vez de cuantizarse
   * aparte: así `neto(recargo) − neto(descuento)` es exactamente el ajuste que
   * las líneas aplicaron, y el documento no puede quedar en desacuerdo consigo
   * mismo por un peso.
   *
   * Las trazas se reescalan al mismo total con el reparto por resto más grande,
   * porque `Σ trazas = lo declarado` es lo que permite auditar el comprobante
   * regla por regla.
   */
  let netoDescuentoVenta = ZERO;
  let netoRecargoVenta = ZERO;
  if (!ajusteBruto.isZero()) {
    const factor = t.ajuste.dividedBy(ajusteBruto);
    netoDescuentoVenta = cuantizar(dv.total.times(factor), cfg);
    netoRecargoVenta = netoDescuentoVenta.plus(t.ajuste);
    dv.trazas = reescalarTrazas(dv.trazas, netoDescuentoVenta, factor, cfg);
    rv.trazas = reescalarTrazas(rv.trazas, netoRecargoVenta, factor, cfg);
  }

  const totalDescuentos = t.desc.plus(netoDescuentoVenta);
  const totalRecargos = t.rec.plus(netoRecargoVenta);
  const totalImpuestos = t.imp;
  const totalFinal = t.total;

  /**
   * Cierre del documento — mismo invariante que `calcularLinea` (ver el
   * comentario ahí, arriba de `totalLinea`): el total NO se cuantiza aparte,
   * se DERIVA de sus componentes ya cuantizados. Cuantizar `totalFinal` por
   * separado desde su valor fino rompe la identidad aditiva del documento.
   *
   * Medido: neto 3.000, un recargo de línea de 0,1 y un impuesto de línea de
   * 0,4 (fino: total 3.000,5). Cuantizar cada total por separado da
   * `totalFinal = 3.001` (3.000,5 redondea para arriba), pero
   * `neto − desc + rec + imp` con los cuatro YA cuantizados da `3.000` — el
   * documento declararía un total que no es la suma de sus propias partes.
   * Derivar evita eso siempre, por construcción.
   *
   * Con `nivelRedondeo === 'linea'` no cambia nada: los cuatro componentes ya
   * son suma de valores cuantizados por línea, así que cuantizarlos de nuevo
   * acá sería redundante — y taparía el día que dejaran de serlo.
   */
  const alDocumento = cfg.nivelRedondeo === 'documento';
  const subtotalNetoQ = alDocumento
    ? cuantizar(subtotalNeto, cfg)
    : subtotalNeto;
  const totalDescuentosQ = alDocumento
    ? cuantizar(totalDescuentos, cfg)
    : totalDescuentos;
  const totalRecargosQ = alDocumento
    ? cuantizar(totalRecargos, cfg)
    : totalRecargos;
  const totalImpuestosQ = alDocumento
    ? cuantizar(totalImpuestos, cfg)
    : totalImpuestos;
  const totalFinalQ = alDocumento
    ? subtotalNetoQ
        .minus(totalDescuentosQ)
        .plus(totalRecargosQ)
        .plus(totalImpuestosQ)
    : totalFinal;

  return {
    lineas,
    totales: {
      subtotalNeto: fmt(subtotalNetoQ, cfg),
      totalDescuentos: fmt(totalDescuentosQ, cfg),
      totalRecargos: fmt(totalRecargosQ, cfg),
      totalImpuestos: fmt(totalImpuestosQ, cfg),
      totalFinal: fmt(totalFinalQ, cfg),
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
