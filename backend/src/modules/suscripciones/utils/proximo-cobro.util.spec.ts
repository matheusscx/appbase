import { calcularProximoCobro } from './proximo-cobro.util';

describe('calcularProximoCobro', () => {
  // mensual: el diaMes del mes siguiente al alta
  it('mensual: 2026-07-05 con diaMes 10 → 2026-08-10', () => {
    expect(calcularProximoCobro('mensual', new Date(2026, 6, 5), 10)).toBe(
      '2026-08-10',
    );
  });
  it('mensual: cruza fin de año (2026-12-20, diaMes 5 → 2027-01-05)', () => {
    expect(calcularProximoCobro('mensual', new Date(2026, 11, 20), 5)).toBe(
      '2027-01-05',
    );
  });

  // quincenal: primera ocurrencia de diaMes o diaMes+15 posterior al alta
  it('quincenal: alta 2026-07-05 con diaMes 5 → 2026-07-20 (X+15)', () => {
    expect(calcularProximoCobro('quincenal', new Date(2026, 6, 5), 5)).toBe(
      '2026-07-20',
    );
  });
  it('quincenal: alta 2026-07-25 con diaMes 5 → 2026-08-05 (mes siguiente)', () => {
    expect(calcularProximoCobro('quincenal', new Date(2026, 6, 25), 5)).toBe(
      '2026-08-05',
    );
  });
  it('quincenal: alta 2026-07-01 con diaMes 3 → 2026-07-03 (X este mes)', () => {
    expect(calcularProximoCobro('quincenal', new Date(2026, 6, 1), 3)).toBe(
      '2026-07-03',
    );
  });

  // semanal: el diaSemana de la semana siguiente al alta
  it('semanal: domingo 2026-07-05 eligiendo domingo (0) → 2026-07-12', () => {
    expect(calcularProximoCobro('semanal', new Date(2026, 6, 5), null, 0)).toBe(
      '2026-07-12',
    );
  });
  it('semanal: domingo 2026-07-05 eligiendo miércoles (3) → 2026-07-15', () => {
    expect(calcularProximoCobro('semanal', new Date(2026, 6, 5), null, 3)).toBe(
      '2026-07-15',
    );
  });
});
