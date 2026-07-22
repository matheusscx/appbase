import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { EstrategiaAsignacionPropina } from '../propinas/enums/estrategia-asignacion-propina.enum';

export interface PagoNetoInput {
  pagoIdx: number;
  metodoPagoId: string;
  permiteVuelto: boolean;
  neto: string;
}

export interface AplicacionCalculada {
  pagoIdx: number;
  tipo: 'venta' | 'propina';
  monto: string;
}

/**
 * Split determinista: tip primero a métodos sin vuelto, ordenados por
 * metodoPagoId ASC; luego métodos con vuelto, mismo orden. No usa el orden
 * de ingreso del array.
 */
export function calcularAplicacionesNoVuelto(
  pagos: PagoNetoInput[],
  propinaMonto: string,
): AplicacionCalculada[] {
  let restantePropina = new Decimal(propinaMonto || '0');
  if (restantePropina.lt(0)) {
    throw new BadRequestException('Propina inválida');
  }

  const ordenados = [...pagos].sort((a, b) => {
    if (a.permiteVuelto !== b.permiteVuelto) {
      return a.permiteVuelto ? 1 : -1; // false (sin vuelto) primero
    }
    return a.metodoPagoId.localeCompare(b.metodoPagoId);
  });

  const porPago = new Map<number, { venta: Decimal; propina: Decimal }>();

  for (const p of ordenados) {
    const neto = new Decimal(p.neto || '0');
    const aplicadoPropina = Decimal.min(neto, restantePropina);
    const aplicadoVenta = neto.minus(aplicadoPropina);
    restantePropina = restantePropina.minus(aplicadoPropina);
    porPago.set(p.pagoIdx, { venta: aplicadoVenta, propina: aplicadoPropina });
  }

  const result: AplicacionCalculada[] = [];
  // Emitir en orden de pagoIdx original para estabilidad de tests / persistencia
  const idxs = [...porPago.keys()].sort((a, b) => a - b);
  for (const idx of idxs) {
    const { venta, propina } = porPago.get(idx)!;
    if (venta.gt(0)) {
      result.push({
        pagoIdx: idx,
        tipo: 'venta',
        monto: venta.toFixed(4),
      });
    }
    if (propina.gt(0)) {
      result.push({
        pagoIdx: idx,
        tipo: 'propina',
        monto: propina.toFixed(4),
      });
    }
  }
  return result;
}

export function dispatchAsignacionPropina(
  estrategia: EstrategiaAsignacionPropina,
  pagos: PagoNetoInput[],
  propinaMonto: string,
): AplicacionCalculada[] {
  if (estrategia === EstrategiaAsignacionPropina.NO_VUELTO) {
    return calcularAplicacionesNoVuelto(pagos, propinaMonto);
  }
  throw new BadRequestException('Estrategia de asignación no soportada');
}
