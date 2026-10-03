import Decimal from 'decimal.js';
import type { Cuantizador } from '../calculo-precios/calculo-precios.engine';

/**
 * Lo que hace falta para tasar una cortesía, ya leído por el llamador: la
 * cantidad anulada, el precio de carta congelado en la línea y el tratamiento
 * tributario del ítem **vigente al anular** (el retiro se devenga al retirar,
 * art. 9 c) del DL 825).
 */
export interface DatosCortesia {
  cantidad: string;
  /** `cuenta_lineas.precio_unitario`: carta + extras, en moneda oficial, sin reglas. */
  precioUnitario: string;
  clasificacion: 'afecto' | 'exento';
  precioIncluyeImpuesto: boolean;
  /** IVA del país del tenant, fracción (`0.19`). `null` si el país no tiene. */
  tasaIva: string | null;
  /** Tasas de los impuestos `'otro'` del ítem, activos y no borrados. */
  tasasAdicionales: string[];
}

/**
 * El art. 8 d) grava el retiro de **bienes corporales muebles**: un servicio o
 * una suscripción regalados no son retiro y su cortesía no congela baldes.
 * Mismo corte que el stock (`consumirLineaAnulada` solo acepta estos tres).
 */
export function esBienRetirable(tipoItem: string | undefined): boolean {
  return (
    tipoItem === 'producto' || tipoItem === 'receta' || tipoItem === 'combo'
  );
}

export interface BaldesCortesia {
  montoAfecto: Decimal;
  montoExento: Decimal;
  /** Solo el IVA: el adicional no grava la venta del minorista al consumidor (art. 43). */
  montoImpuestos: Decimal;
}

/**
 * Los baldes fiscales de una cortesía, que es un retiro gravado (DL 825 art. 8
 * d), decisión del owner del 2026-10-03: *"Siempre paga IVA"*). La base es el
 * **precio de carta sin descuentos ni promociones, neto de todo impuesto
 * incluido** (art. 16 b) y art. 15; owner, *"Precio de carta"*). Spec
 * `2026-10-03-cortesia-retiro-iva-design.md` § 3.
 *
 * No pasa por el motor (`CalculoPreciosService.calcular`) a propósito: el motor
 * aplicaría las promociones del día y rechaza un ítem borrado del catálogo,
 * cuya anulación está permitida. Con precio incluido, el IVA absorbe el
 * residuo —mismo anclaje que la línea de góndola del motor— para que
 * `base + IVA + adicionales = carta` cierre exacto; con precio neto, la carta
 * ya es la base y no se hace la ida y vuelta.
 */
export function baldesDeCortesia(
  d: DatosCortesia,
  q: Cuantizador,
): BaldesCortesia {
  const afecto = d.clasificacion === 'afecto';
  if (afecto && d.tasaIva === null) {
    throw new Error('Una cortesía afecta necesita el IVA del país');
  }
  const tasaIva = afecto ? new Decimal(d.tasaIva!) : new Decimal(0);
  const adicionales = d.tasasAdicionales.map((t) => new Decimal(t));
  const carta = q(new Decimal(d.cantidad).times(d.precioUnitario));

  let neto: Decimal;
  let iva: Decimal;
  if (d.precioIncluyeImpuesto) {
    const divisor = adicionales.reduce((s, t) => s.plus(t), tasaIva.plus(1));
    neto = q(carta.dividedBy(divisor));
    const montoAdicionales = adicionales.reduce(
      (s, t) => s.plus(q(neto.times(t))),
      new Decimal(0),
    );
    iva = afecto ? carta.minus(neto).minus(montoAdicionales) : new Decimal(0);
  } else {
    neto = carta;
    iva = q(neto.times(tasaIva));
  }

  return {
    montoAfecto: afecto ? neto : new Decimal(0),
    montoExento: afecto ? new Decimal(0) : neto,
    montoImpuestos: iva,
  };
}
