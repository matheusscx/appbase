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

/**
 * El primer valor que ya no cabe en `NUMERIC(precision, escala)`:
 * `10^(precision−escala)`. Con la escala de la plata, 14 dígitos enteros; con
 * `NUMERIC(18,6)` (`tenants.monto_tolerancia`), 12. Las columnas que no son de
 * plata traen su propia precisión: un porcentaje en `NUMERIC(10,6)` tiene el
 * techo en 10^4, y uno en `NUMERIC(7,4)`, en 10^3.
 */
function techo(escala: number, precision: number): Decimal {
  return new Decimal(10).pow(precision - escala);
}

/**
 * ¿Postgres acepta este monto en una columna `NUMERIC(precision, escala)` —por
 * default la de plata, `NUMERIC(18,4)`—? Replica lo que hace él al escribir:
 * primero redondea a `escala` decimales —el empate, hacia afuera
 * del cero, que es lo que hace `ROUND_HALF_UP` en Decimal.js— y después exige
 * menos de `precision − escala` dígitos enteros. Por eso `99.999.999.999.999,99995` no cabe: llega
 * redondeado a `10^14`.
 *
 * Solo mira: no cuantiza ni devuelve nada que alguien vaya a persistir.
 */
export function cabeEnColumnaDePlata(
  monto: Decimal.Value,
  escala: number = ESCALA_PERSISTIDA,
  precision: number = PRECISION_PERSISTIDA,
): boolean {
  return new Decimal(monto)
    .toDecimalPlaces(escala, Decimal.ROUND_HALF_UP)
    .abs()
    .lessThan(techo(escala, precision));
}

/** El techo de `NUMERIC(precision, escala)` como lo lee el cajero, para el mensaje. */
export function techoFormateado(
  escala: number,
  precision: number = PRECISION_PERSISTIDA,
): string {
  return formatearMontoPersistible(techo(escala, precision));
}

/** El techo de la columna de plata, `NUMERIC(18,4)`. */
export const TECHO_PERSISTIBLE_FORMATEADO = techoFormateado(ESCALA_PERSISTIDA);

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
