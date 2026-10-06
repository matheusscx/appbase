import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';

/**
 * **Cuántas unidades (o kilos) puede sumar una venta o una mesa: 99.999.**
 * Decisión del owner del 2026-10-06, por AskUserQuestion de la Sesión de
 * esfuerzo máximo, sobre 9.999 y 999.999. La reconfirmó con el peor caso
 * medido: ~0,5 s para `/calcular` y para el resto de los usuarios, y ~2 s
 * para quien cobra una venta de 99.999 unidades con un 2x1.
 *
 * Sin tope, la cantidad la elegía el cliente y el motor de promociones trabaja
 * por unidad: con un 2x1, 10⁶ unidades tardaban 4–5 s con el event loop tomado
 * para todos los tenants, y una venta de 16.384 unidades ya daba 500 al
 * guardar sus trazas. Es **por venta y no por línea** porque el costo depende
 * de las unidades de toda la venta: 500 líneas de 9.999 se cuelgan igual. Cada
 * línea queda acotada por el mismo número, en el borde (`@IsDecimalHasta`).
 * Ver `docs/features/motor-promociones.md` § El tope de unidades.
 */
export const MAX_UNIDADES_POR_VENTA = '99999';

const formato = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 4 });

/**
 * 400 si las cantidades suman más que `MAX_UNIDADES_POR_VENTA`. `que` nombra
 * el documento en el mensaje: "una venta" o "una mesa".
 */
export function assertTopeUnidadesVenta(
  cantidades: Iterable<string | Decimal>,
  que: 'una venta' | 'una mesa',
): void {
  let total = new Decimal(0);
  for (const c of cantidades) total = total.plus(c);
  if (total.greaterThan(MAX_UNIDADES_POR_VENTA)) {
    throw new BadRequestException(
      `${que.charAt(0).toUpperCase()}${que.slice(1)} puede llevar hasta ${formato.format(Number(MAX_UNIDADES_POR_VENTA))} unidades en total, y esta suma ${formato.format(total.toNumber())}`,
    );
  }
}
