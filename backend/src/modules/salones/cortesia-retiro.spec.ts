import Decimal from 'decimal.js';
import { baldesDeCortesia, type DatosCortesia } from './cortesia-retiro';

// CLP: escala 0, HALF_UP — la del tenant del seed.
const qClp = (d: Decimal) => d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
const qUsd = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

const base: DatosCortesia = {
  cantidad: '1',
  precioUnitario: '3000',
  clasificacion: 'afecto',
  precioIncluyeImpuesto: true,
  tasaIva: '0.19',
  tasasAdicionales: [],
};

const comoTexto = (b: ReturnType<typeof baldesDeCortesia>) => ({
  montoAfecto: b.montoAfecto.toFixed(0),
  montoExento: b.montoExento.toFixed(0),
  montoImpuestos: b.montoImpuestos.toFixed(0),
});

describe('baldesDeCortesia (spec 2026-10-03 § 3.2)', () => {
  it('precio de carta con IVA incluido: la escena del owner, $3.000 → base 2.521 + IVA 479', () => {
    expect(comoTexto(baldesDeCortesia(base, qClp))).toEqual({
      montoAfecto: '2521',
      montoExento: '0',
      montoImpuestos: '479',
    });
  });

  it('con precio incluido el IVA es lo que sobra, no tasa × base: la carta cierra exacta', () => {
    // Góndola $993: neto 834, y 0,19 × 834 = 158,46 → 158 daría 992. El IVA
    // absorbe el residuo (159), como la línea de góndola del motor.
    expect(
      comoTexto(baldesDeCortesia({ ...base, precioUnitario: '993' }, qClp)),
    ).toEqual({ montoAfecto: '834', montoExento: '0', montoImpuestos: '159' });
  });

  it('precio neto: la carta ya es la base y el IVA es tasa × base, sin ida y vuelta', () => {
    expect(
      comoTexto(
        baldesDeCortesia(
          { ...base, precioUnitario: '2521', precioIncluyeImpuesto: false },
          qClp,
        ),
      ),
    ).toEqual({ montoAfecto: '2521', montoExento: '0', montoImpuestos: '479' });
  });

  it('exento: la base va al balde exento y el impuesto es 0, nunca null', () => {
    expect(
      comoTexto(baldesDeCortesia({ ...base, clasificacion: 'exento' }, qClp)),
    ).toEqual({ montoAfecto: '0', montoExento: '3000', montoImpuestos: '0' });
  });

  it('un adicional incluido se saca para llegar a la base, pero no se congela (art. 43)', () => {
    // 3000 / 1,505 = 1993,35 → 1993; adicional q(1993 × 0,315) = 628;
    // IVA = 3000 − 1993 − 628 = 379 (absorbe el residuo, como la góndola).
    expect(
      comoTexto(
        baldesDeCortesia({ ...base, tasasAdicionales: ['0.315'] }, qClp),
      ),
    ).toEqual({ montoAfecto: '1993', montoExento: '0', montoImpuestos: '379' });
  });

  it('con precio neto, el adicional no toca ni la base ni el IVA', () => {
    expect(
      comoTexto(
        baldesDeCortesia(
          {
            ...base,
            precioUnitario: '1993',
            precioIncluyeImpuesto: false,
            tasasAdicionales: ['0.315'],
          },
          qClp,
        ),
      ),
    ).toEqual({ montoAfecto: '1993', montoExento: '0', montoImpuestos: '379' });
  });

  it('exento con un adicional incluido: base sin el adicional y sin IVA', () => {
    // 3000 / 1,315 = 2281,37 → 2281.
    expect(
      comoTexto(
        baldesDeCortesia(
          { ...base, clasificacion: 'exento', tasasAdicionales: ['0.315'] },
          qClp,
        ),
      ),
    ).toEqual({ montoAfecto: '0', montoExento: '2281', montoImpuestos: '0' });
  });

  it('cantidad fraccionaria: tasa la carta de lo anulado, no del unitario', () => {
    // 1,5 × 2.990 = 4.485 → 4485 / 1,19 = 3768,9 → 3769; IVA 716.
    expect(
      comoTexto(
        baldesDeCortesia(
          { ...base, cantidad: '1.5', precioUnitario: '2990' },
          qClp,
        ),
      ),
    ).toEqual({ montoAfecto: '3769', montoExento: '0', montoImpuestos: '716' });
  });

  it('cuantiza a la escala de la moneda oficial que le pasan', () => {
    const b = baldesDeCortesia({ ...base, precioUnitario: '10.00' }, qUsd);
    expect(b.montoAfecto.toFixed(2)).toBe('8.40');
    expect(b.montoImpuestos.toFixed(2)).toBe('1.60');
  });

  it('un afecto sin IVA del país es un error: no se congela un afecto sin impuesto', () => {
    expect(() => baldesDeCortesia({ ...base, tasaIva: null }, qClp)).toThrow();
  });
});
