import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';

export interface PesoReparto {
  id: string;
  peso: string;
}

export interface MontoReparto {
  id: string;
  monto: string;
}

export function repartirMayoresRestos(
  montoGrupo: string,
  pesos: PesoReparto[],
  decimales: number,
): MontoReparto[] {
  if (!Number.isInteger(decimales) || decimales < 0) {
    throw new BadRequestException('Los decimales de moneda son inválidos');
  }

  const pesosValidos = pesos.map((p) => ({
    id: p.id,
    peso: new Decimal(p.peso || '0'),
  }));

  if (pesosValidos.some((p) => p.peso.lt(0))) {
    throw new BadRequestException('Los pesos no pueden ser negativos');
  }

  const participantes = pesosValidos.filter((p) => p.peso.gt(0));
  const sumaPesos = participantes.reduce(
    (acc, p) => acc.plus(p.peso),
    new Decimal(0),
  );
  if (participantes.length === 0 || sumaPesos.lte(0)) {
    throw new BadRequestException('La suma de pesos debe ser mayor a cero');
  }

  const factor = new Decimal(10).pow(decimales);
  const unidades = new Decimal(montoGrupo || '0')
    .times(factor)
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);

  const cuotas = participantes.map((p) => {
    const exacta = unidades.times(p.peso).div(sumaPesos);
    const base = exacta.floor();
    return {
      id: p.id,
      base,
      resto: exacta.minus(base),
    };
  });

  const asignadasBase = cuotas.reduce(
    (acc, c) => acc.plus(c.base),
    new Decimal(0),
  );
  const extras = unidades.minus(asignadasBase).toNumber();
  const idsConExtra = new Set(
    [...cuotas]
      .sort((a, b) => {
        const byResto = b.resto.comparedTo(a.resto);
        if (byResto !== 0) return byResto;
        return a.id.localeCompare(b.id);
      })
      .slice(0, extras)
      .map((c) => c.id),
  );

  const montos = new Map(
    cuotas.map((c) => {
      const extra = idsConExtra.has(c.id) ? 1 : 0;
      const monto = c.base.plus(extra).div(factor).toFixed(decimales);
      return [c.id, monto] as const;
    }),
  );

  return pesos.map((p) => ({
    id: p.id,
    monto: montos.get(p.id) ?? new Decimal(0).toFixed(decimales),
  }));
}
