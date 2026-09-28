import Decimal from 'decimal.js';
import {
  cuantizar,
  type ConfigCalculo,
} from '../calculo-precios/calculo-precios.engine';

/**
 * El plazo de pago cuando el proveedor no tiene uno cargado (spec
 * compras-deuda-proveedor § 2, decisión 4). Es el default de la propia ley
 * (19.983, art. 2, texto de la ley 21.131): "se entenderá que debe ser
 * pagada dentro de los treinta días corridos siguientes a la recepción de
 * la factura".
 */
export const PLAZO_PAGO_DIAS_DEFAULT = 30;

/**
 * `fecha + días`, en aritmética de calendario (sin zona horaria: es una
 * fecha pura `YYYY-MM-DD`, no un instante). `Date.UTC` evita que la resta de
 * huso horario del entorno corra la fecha un día.
 */
function sumarDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * El vencimiento de una compra (spec § 4.2): la fecha tipeada (o la del XML,
 * `FchVenc`) manda; si no hay, `fecha_documento + plazo` — el plazo del
 * proveedor, o `PLAZO_PAGO_DIAS_DEFAULT` si no tiene uno cargado.
 *
 * Por qué desde `fechaDocumento` y no desde la recepción: la compra no
 * guarda cuándo llegó la factura, y como la recepción nunca es anterior a la
 * emisión, el vencimiento calculado cae el mismo día o antes que el legal
 * (spec § 2, "Los 30 días, verificados contra el texto legal").
 */
export function vencimiento(
  fechaDocumento: string,
  plazoPagoDias: number | null,
  fechaTipeada?: string | null,
): string {
  if (fechaTipeada) return fechaTipeada;
  return sumarDias(fechaDocumento, plazoPagoDias ?? PLAZO_PAGO_DIAS_DEFAULT);
}

/**
 * El total de una compra `suma_lineas` (spec § 4.1 y § 14): Σ cantidad ×
 * precio − descuento, cuantizado UNA sola vez a la escala de la moneda
 * oficial del tenant, con `cuantizar` del motor de precios (importada, no
 * modificada) — es la única cuantización de esta pieza. `null` si no hay
 * líneas o falta el precio de alguna: ahí el total es desconocido.
 *
 * Los tipos `obligatorio`/`opcional` no pasan por acá: su total es el
 * transcrito (`compras.total_documento`), tal cual (decisión 10).
 */
export function totalCompra(
  lineas: { cantidad: string; precioUnitario: string | null }[],
  descuentoTotal: string | null,
  cfg: ConfigCalculo,
): string | null {
  if (!lineas.length || lineas.some((l) => l.precioUnitario == null)) {
    return null;
  }
  const bruto = lineas.reduce(
    (acc, l) => acc.plus(new Decimal(l.cantidad).times(l.precioUnitario!)),
    new Decimal(0),
  );
  const neto = bruto.minus(descuentoTotal ?? 0);
  return cuantizar(neto, cfg).toString();
}
