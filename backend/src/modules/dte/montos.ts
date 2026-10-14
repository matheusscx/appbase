import Decimal from 'decimal.js';
import { type DatosBoleta, DteError } from './dte.types';

/** IVA de Chile. El motor solo emite boletas chilenas (otros países en pausa). */
const TASA_IVA = new Decimal('0.19');

const d = (v: string | undefined) => new Decimal(v ?? '0');

function entero(campo: string, v: Decimal): Decimal {
  if (!v.isInteger())
    throw new DteError(
      'MONTO_NO_ENTERO',
      `${campo} tiene que ir en pesos enteros y vale ${v.toString()}`,
    );
  return v;
}

function noNegativo(campo: string, v: Decimal): Decimal {
  if (v.isNegative())
    throw new DteError(
      'MONTO_NEGATIVO',
      `${campo} no puede ser negativo: ${v.toString()}`,
    );
  return v;
}

/**
 * Verifica las igualdades del Formato Boletas v4.2 (campos 32–35 y 21–26) sobre lo
 * congelado. No recalcula: el IVA congelado manda (ADR-010), y lo que se aparta de
 * `tasa × neto` vuelve como aviso, no como error (spec § 4.4).
 */
export function verificarMontos(datos: DatosBoleta): {
  diferenciaIvaRedondeo: string;
} {
  const m = datos.montos;
  if (d(m.adicionales).gt(0)) {
    throw new DteError(
      'IMPUESTO_ADICIONAL_NO_SOPORTADO',
      'La boleta no informa impuestos adicionales; falta definir cómo los trata el SII',
    );
  }
  const neto = noNegativo('MntNeto', entero('MntNeto', d(m.neto)));
  const exento = noNegativo('MntExe', entero('MntExe', d(m.exento)));
  const iva = noNegativo('IVA', entero('IVA', d(m.iva)));
  const total = entero('MntTotal', d(m.total));
  if (!total.gt(0))
    throw new DteError(
      'TOTAL_NO_POSITIVO',
      `MntTotal tiene que ser mayor que cero y vale ${total.toString()}`,
    );

  let afectas = new Decimal(0);
  let exentas = new Decimal(0);
  datos.lineas.forEach((l, i) => {
    const monto = noNegativo(
      `MontoItem de la línea ${i + 1}`,
      entero(`MontoItem de la línea ${i + 1}`, d(l.monto)),
    );
    if (l.cantidad !== undefined && l.precioUnitario !== undefined) {
      const esperado = d(l.precioUnitario)
        .mul(d(l.cantidad))
        .minus(d(l.descuentoMonto))
        .plus(d(l.recargoMonto));
      if (esperado.minus(monto).abs().gte(1)) {
        throw new DteError(
          'LINEA_NO_CIERRA',
          `La línea ${i + 1} vale ${monto.toString()} y precio × cantidad − descuento + recargo da ${esperado.toString()}`,
        );
      }
    }
    if (l.exenta) exentas = exentas.plus(monto);
    else afectas = afectas.plus(monto);
  });
  for (const a of datos.ajustesGlobales) {
    const v = noNegativo(
      `ValorDR "${a.glosa}"`,
      entero(`ValorDR "${a.glosa}"`, d(a.monto)),
    );
    const signo = a.tipo === 'D' ? v.neg() : v;
    if (a.exento) exentas = exentas.plus(signo);
    else afectas = afectas.plus(signo);
  }

  if (datos.tipo === 41) {
    if (!afectas.isZero() || !neto.isZero() || !iva.isZero()) {
      throw new DteError(
        'BOLETA_EXENTA_CON_AFECTO',
        'Una boleta exenta (41) no lleva líneas afectas, neto ni IVA',
      );
    }
  }
  if (
    !neto.plus(iva).plus(exento).eq(total) ||
    !afectas.eq(neto.plus(iva)) ||
    !exentas.eq(exento)
  ) {
    throw new DteError(
      'TOTALES_NO_CIERRAN',
      `Neto ${neto.toString()} + IVA ${iva.toString()} + exento ${exento.toString()} = total ${total.toString()}; líneas afectas ${afectas.toString()}; exentas ${exentas.toString()}`,
    );
  }
  const ivaFormula = neto
    .mul(TASA_IVA)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return {
    diferenciaIvaRedondeo:
      datos.tipo === 41 ? '0' : iva.minus(ivaFormula).toString(),
  };
}
