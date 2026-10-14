import Decimal from 'decimal.js';
import { type DatosBoleta, DteError } from './dte.types';

/** IVA de Chile. El motor solo emite boletas chilenas (otros países en pausa). */
const TASA_IVA = new Decimal('0.19');

/** Topes del XSD: `Detalle` admite 1000 y `DscRcgGlobal`, 20. */
const MAX_LINEAS = 1000;
const MAX_AJUSTES = 20;

/** `QtyItem` y `PrcItem` (Dec5Type): como mucho 6 decimales. */
const DECIMALES_CANTIDAD_PRECIO = 6;

const montoInvalido = (campo: string, motivo: string) =>
  new DteError('MONTO_INVALIDO', `${campo} ${motivo}`);

/** Un texto de monto a `Decimal`; lo que no es un número finito es `MONTO_INVALIDO`, nunca un `DecimalError`. */
export function aDecimal(campo: string, v: string | undefined): Decimal {
  let n: Decimal;
  try {
    n = new Decimal(v ?? '0');
  } catch {
    throw montoInvalido(campo, `no es un número: "${v}"`);
  }
  if (!n.isFinite()) throw montoInvalido(campo, `no es un número: "${v}"`);
  return n;
}

function entero(campo: string, v: Decimal): Decimal {
  if (!v.isInteger())
    throw new DteError(
      'MONTO_NO_ENTERO',
      `${campo} tiene que ir en pesos enteros y vale ${v.toString()}`,
    );
  return v;
}

/** `QtyItem` y `PrcItem`, si vienen: mayores que cero y con a lo más 6 decimales. */
function cantidadOPrecio(campo: string, v: string | undefined) {
  if (v === undefined) return undefined;
  const n = aDecimal(campo, v);
  if (!n.gt(0))
    throw montoInvalido(campo, `tiene que ser mayor que cero y vale ${v}`);
  if (n.decimalPlaces() > DECIMALES_CANTIDAD_PRECIO)
    throw montoInvalido(
      campo,
      `admite ${DECIMALES_CANTIDAD_PRECIO.toString()} decimales y vale ${v}`,
    );
  return n;
}

/** `DescuentoMonto` y `RecargoMonto`, si vienen: pesos enteros, cero o más. Ausente vale 0. */
function montoEnteroNoNegativo(campo: string, v: string | undefined) {
  const n = aDecimal(campo, v);
  if (!n.isInteger() || n.isNegative())
    throw montoInvalido(
      campo,
      `tiene que ser un entero de cero o más y vale ${v}`,
    );
  return n;
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
  if (datos.lineas.length > MAX_LINEAS) {
    throw new DteError(
      'DEMASIADAS_LINEAS',
      `Una boleta admite ${MAX_LINEAS.toString()} líneas y trae ${datos.lineas.length.toString()}`,
    );
  }
  if (datos.ajustesGlobales.length > MAX_AJUSTES) {
    throw new DteError(
      'DEMASIADAS_LINEAS',
      `Una boleta admite ${MAX_AJUSTES.toString()} descuentos o recargos globales y trae ${datos.ajustesGlobales.length.toString()}`,
    );
  }
  const m = datos.montos;
  if (aDecimal('adicionales', m.adicionales).gt(0)) {
    throw new DteError(
      'IMPUESTO_ADICIONAL_NO_SOPORTADO',
      'La boleta no informa impuestos adicionales; falta definir cómo los trata el SII',
    );
  }
  const neto = noNegativo(
    'MntNeto',
    entero('MntNeto', aDecimal('MntNeto', m.neto)),
  );
  const exento = noNegativo(
    'MntExe',
    entero('MntExe', aDecimal('MntExe', m.exento)),
  );
  const iva = noNegativo('IVA', entero('IVA', aDecimal('IVA', m.iva)));
  const total = entero('MntTotal', aDecimal('MntTotal', m.total));
  if (!total.gt(0))
    throw new DteError(
      'TOTAL_NO_POSITIVO',
      `MntTotal tiene que ser mayor que cero y vale ${total.toString()}`,
    );

  let afectas = new Decimal(0);
  let exentas = new Decimal(0);
  datos.lineas.forEach((l, i) => {
    const n = (campo: string) => `${campo} de la línea ${i + 1}`;
    const monto = noNegativo(
      n('MontoItem'),
      entero(n('MontoItem'), aDecimal(n('MontoItem'), l.monto)),
    );
    const cantidad = cantidadOPrecio(n('QtyItem'), l.cantidad);
    const precio = cantidadOPrecio(n('PrcItem'), l.precioUnitario);
    const descuento = montoEnteroNoNegativo(
      n('DescuentoMonto'),
      l.descuentoMonto,
    );
    const recargo = montoEnteroNoNegativo(n('RecargoMonto'), l.recargoMonto);
    if (cantidad !== undefined && precio !== undefined) {
      const esperado = precio.mul(cantidad).minus(descuento).plus(recargo);
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
      entero(`ValorDR "${a.glosa}"`, aDecimal(`ValorDR "${a.glosa}"`, a.monto)),
    );
    if (v.isZero())
      throw montoInvalido(
        `ValorDR "${a.glosa}"`,
        'tiene que ser mayor que cero',
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
