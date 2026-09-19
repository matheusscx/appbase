import Decimal from 'decimal.js';
import {
  cuantizar,
  repartirProporcional,
  type ConfigCalculo,
} from '../calculo-precios/calculo-precios.engine';

export interface LineaParaCostear {
  /** Como se tipeó. */
  cantidad: string;
  /** Por unidad tipeada. */
  precioUnitario: string;
  /** Ya convertida a la unidad base del producto. */
  cantidadBase: string;
}

/** Escala del costo: es una tasa interna, no plata cobrada (`ESCALA_COSTO`). */
const ESCALA_COSTO = 4;

/**
 * Costo por unidad base de cada línea de una compra, con el descuento al
 * total repartido según el valor de cada línea (spec compras-recepcion § 4.2).
 *
 * El descuento se reparte con `repartirProporcional`, la regla de residuo que
 * ya usan la nota de crédito y los combos (resto más grande, desempate por
 * posición): así lo descontado suma exacto el descuento, y no se inventa una
 * cuarta regla. Una línea a $0 pesa 0 y no recibe nada.
 *
 * El costo por unidad sale a escala 4 con HALF_UP fijo, el mismo criterio que
 * el CPP: no es plata cobrada y no mira `modo_redondeo`.
 */
export function costearLineas(
  lineas: LineaParaCostear[],
  descuentoTotal: string | null,
  cfg: ConfigCalculo,
): string[] {
  const valores = lineas.map((l) =>
    new Decimal(l.cantidad).times(l.precioUnitario),
  );
  const descuento = new Decimal(descuentoTotal ?? 0);
  const partes = descuento.isZero()
    ? valores.map(() => new Decimal(0))
    : repartirProporcional(descuento, valores, cfg, (d) => cuantizar(d, cfg));
  return lineas.map((l, i) =>
    valores[i]
      .minus(partes[i])
      .dividedBy(l.cantidadBase)
      .toDecimalPlaces(ESCALA_COSTO, Decimal.ROUND_HALF_UP)
      .toFixed(ESCALA_COSTO),
  );
}
