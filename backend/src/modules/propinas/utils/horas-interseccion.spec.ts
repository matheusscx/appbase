import { horasInterseccionHoras } from './horas-interseccion';

describe('horasInterseccionHoras', () => {
  it('devuelve la duración completa cuando la sesión está dentro del período', () => {
    expect(
      horasInterseccionHoras(
        new Date('2026-07-17T10:00:00.000Z'),
        new Date('2026-07-17T14:30:00.000Z'),
        new Date('2026-07-17T00:00:00.000Z'),
        new Date('2026-07-18T00:00:00.000Z'),
      ),
    ).toBe('4.5000');
  });

  it('prorratea cuando cruza el límite del período', () => {
    expect(
      horasInterseccionHoras(
        new Date('2026-07-16T23:00:00.000Z'),
        new Date('2026-07-17T03:00:00.000Z'),
        new Date('2026-07-17T00:00:00.000Z'),
        new Date('2026-07-18T00:00:00.000Z'),
      ),
    ).toBe('3.0000');
  });

  it('devuelve cero cuando no hay intersección', () => {
    expect(
      horasInterseccionHoras(
        new Date('2026-07-16T10:00:00.000Z'),
        new Date('2026-07-16T12:00:00.000Z'),
        new Date('2026-07-17T00:00:00.000Z'),
        new Date('2026-07-18T00:00:00.000Z'),
      ),
    ).toBe('0.0000');
  });

  it('usa el fin entregado para sesiones abiertas', () => {
    expect(
      horasInterseccionHoras(
        new Date('2026-07-17T22:00:00.000Z'),
        new Date('2026-07-18T01:00:00.000Z'),
        new Date('2026-07-17T00:00:00.000Z'),
        new Date('2026-07-18T00:00:00.000Z'),
      ),
    ).toBe('2.0000');
  });
});
