import Decimal from 'decimal.js';

/**
 * La forma con la que el libro mayor de ventas guarda plata: `precio_unitario`,
 * `subtotal`, `descuento_aplicado`, `total_linea`, los totales de la cabecera y
 * los montos de las reglas aplicadas son todos `NUMERIC(18,4)`. Lo fija
 * `monto-persistible.util.spec.ts` contra la metadata de las entities.
 *
 * **La escala no es `escalaCalculo`**, y la distinción es la que decide el
 * redondeo de la conversión — el porqué está en
 * `CalculoPreciosService.convertirAMonedaOficial`. (Tampoco es universal en el
 * esquema: `tenants.monto_tolerancia` y los montos de la pasarela son
 * `NUMERIC(18,6)`. La afirmación acotada al libro de ventas es la que se
 * sostiene.)
 */
export const PRECISION_PERSISTIDA = 18;
export const ESCALA_PERSISTIDA = 4;

/** El primer monto que ya no cabe: 14 dígitos enteros, `10^(18−4)`. */
const TECHO = new Decimal(10).pow(PRECISION_PERSISTIDA - ESCALA_PERSISTIDA);

/**
 * ¿Postgres acepta este monto en una columna `NUMERIC(18,4)`? Replica lo que
 * hace él al escribir: primero redondea a 4 decimales —el empate, hacia afuera
 * del cero, que es lo que hace `ROUND_HALF_UP` en Decimal.js— y después exige
 * menos de 14 dígitos enteros. Por eso `99.999.999.999.999,99995` no cabe: llega
 * redondeado a `10^14`.
 *
 * Solo mira: no cuantiza ni devuelve nada que alguien vaya a persistir.
 */
export function cabeEnColumnaDePlata(monto: Decimal.Value): boolean {
  return new Decimal(monto)
    .toDecimalPlaces(ESCALA_PERSISTIDA, Decimal.ROUND_HALF_UP)
    .abs()
    .lessThan(TECHO);
}

/** El techo como lo lee el cajero, para el mensaje del rechazo. */
export const TECHO_PERSISTIBLE_FORMATEADO = formatearMontoPersistible(TECHO);

/**
 * `146913578024690.000000` → `146.913.578.024.690`. Sin `number`: un monto que
 * no cabe pasa de 2^53 y `Intl.NumberFormat` perdería los últimos dígitos, que
 * son justo los que el cajero compara contra su pantalla.
 */
export function formatearMontoPersistible(monto: Decimal.Value): string {
  const d = new Decimal(monto);
  const [entero, decimales] = d.abs().toFixed().split('.');
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const signo = d.isNegative() ? '-' : '';
  return decimales
    ? `${signo}${conPuntos},${decimales}`
    : `${signo}${conPuntos}`;
}
