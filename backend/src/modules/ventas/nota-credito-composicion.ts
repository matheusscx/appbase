import Decimal from 'decimal.js';
import {
  repartirProporcional,
  type ConfigCalculo,
  type Cuantizador,
} from '../calculo-precios/calculo-precios.engine';

const ZERO = new Decimal(0);

/**
 * La config que usa el reparto cuando la venta original no tiene
 * `config_calculo` congelada — solo alcanzable por el webhook de reembolso
 * (decisión P3), que no puede perder un evento ya consumado por un dato de
 * configuración faltante.
 *
 * `repartirProporcional` lee de acá **únicamente** `decimalesMoneda`, para el
 * paso de la unidad mínima; los otros campos van con el default del sistema
 * porque la interfaz los exige, no porque este reparto los mire. Los 4
 * decimales son los del fallback de cuantización de ese mismo camino, así que
 * el paso de unidad y la cuantización hablan de la misma escala.
 */
export const CFG_SIN_CONGELAR: ConfigCalculo = {
  formula: ['descuentos', 'recargos', 'impuestos'],
  calculoDescuentos: 'base',
  calculoRecargos: 'base',
  escalaCalculo: 4,
  modoRedondeo: 'HALF_UP',
  nivelRedondeo: 'linea',
  decimalesMoneda: 4,
  promosAcumulanDescuentos: false,
};

/** Lo que una porción (afecta o exenta) suma en un documento ya congelado. */
export interface PorcionOriginal {
  clasificacion: string; // 'afecto' | 'exento'
  total: string; // Σ total_linea (bruto)
  impuesto: string; // Σ impuesto_aplicado
}

export interface ParteAjuste {
  clasificacion: string;
  bruto: Decimal;
}

/**
 * La tasa que esa porción cobró EN ESA VENTA, derivada de sus importes
 * congelados. No se lee del catálogo: `item_impuestos` es por ítem, así que dos
 * líneas afectas de la misma venta pueden llevar impuestos distintos y no hay
 * "la tasa" que leer. La nota de crédito corrige aquel documento: hereda su
 * criterio, no el vigente — misma decisión que el redondeo heredado.
 */
export function tasaEfectiva(
  porciones: PorcionOriginal[],
  clasificacion: string,
): Decimal {
  let impuesto = ZERO;
  let neto = ZERO;
  for (const p of porciones) {
    if (p.clasificacion !== clasificacion) continue;
    const imp = new Decimal(p.impuesto);
    impuesto = impuesto.plus(imp);
    neto = neto.plus(new Decimal(p.total).minus(imp));
  }
  return neto.isZero() ? ZERO : impuesto.dividedBy(neto);
}

/**
 * Parte un bruto en neto + impuesto. **El impuesto sale por RESTA**, no por
 * `tasa × neto`: es el mismo anclaje que usa el motor cuando el paso de
 * impuestos es el último que mueve plata, y es lo que garantiza
 * `neto + impuesto = bruto` exacto sin depender de que la división cierre.
 */
export function descomponer(
  bruto: Decimal,
  tasa: Decimal,
  q: Cuantizador,
): { subtotal: Decimal; impuesto: Decimal } {
  const subtotal = q(bruto.dividedBy(tasa.plus(1)));
  return { subtotal, impuesto: bruto.minus(subtotal) };
}

/**
 * Reparte el ajuste entre las porciones, en la proporción del REMANENTE (lo que
 * queda por devolver), y descarta las partes en cero: una línea de importe cero
 * es ruido en el documento y puede no ser válida al emitirlo.
 *
 * Usa `repartirProporcional` del motor —resto más grande, desempate por
 * posición— en vez de un criterio propio: es la tercera vez que este reparto
 * hace falta en el repo y no se inventa una cuarta regla de residuo.
 */
export function repartirAjuste(
  ajusteTotal: Decimal,
  pesos: { clasificacion: string; peso: Decimal }[],
  cfg: ConfigCalculo,
  q: Cuantizador,
): ParteAjuste[] {
  const partes = repartirProporcional(
    ajusteTotal,
    pesos.map((p) => p.peso),
    cfg,
    q,
  );
  return pesos
    .map((p, i) => ({ clasificacion: p.clasificacion, bruto: partes[i] }))
    .filter((p) => !p.bruto.isZero());
}

/**
 * Escala las líneas de devolución para que sumen, **como máximo**, el monto de
 * la nota. Con `Σ devoluciones ≤ monto` las devuelve intactas —que es la
 * conducta de siempre— y con `Σ devoluciones > monto` las baja a prorrata.
 *
 * Se acredita menos de lo que vale la mercadería en casos reales: cargo por
 * reposición, producto que vuelve dañado, un monto acordado en el mostrador. El
 * documento no puede mostrar el valor original **porque sus líneas tienen que
 * sumar `total_final`**; el porqué lo lleva la glosa, que en ese caso es
 * obligatoria. La alternativa —línea negativa de "cargo por reposición"— se
 * descartó: ningún POS la usa y el DTE no tiene un campo con esa semántica
 * (investigación del 2026-09-04).
 *
 * Reparte con `repartirProporcional` y no dividiendo línea por línea: con un
 * factor que no divide exacto, dividir cada una por separado deja la suma
 * corrida. Es la misma regla de residuo que usa el ajuste afecto/exento.
 */
export function escalarDevoluciones(
  brutos: Decimal[],
  monto: Decimal,
  cfg: ConfigCalculo,
  q: Cuantizador,
): Decimal[] {
  if (!brutos.length) return [];
  const valorDevuelto = brutos.reduce((a, b) => a.plus(b), ZERO);
  // El `min` es también lo que hace seguro el caso de devoluciones que no valen
  // nada: manda un objetivo de 0 y `repartirProporcional`, sin peso que
  // repartir, deja todas las partes en cero. Un guard aparte para eso sería
  // código muerto.
  return repartirProporcional(
    q(Decimal.min(valorDevuelto, monto)),
    brutos,
    cfg,
    q,
  );
}
