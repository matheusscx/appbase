import { esDeadlock } from './reintento-deadlock';

describe('esDeadlock', () => {
  it('reconoce 40P01 cuando `code` está en la raíz del error', () => {
    expect(esDeadlock({ code: '40P01' })).toBe(true);
  });

  it('reconoce 40P01 cuando `code` está adentro de `driverError`', () => {
    // Forma que envuelve TypeORM al relanzar el error del driver dentro de
    // QueryFailedError: cuál de las dos formas llega depende de dónde se
    // lance, así que las dos tienen que quedar cubiertas.
    expect(esDeadlock({ driverError: { code: '40P01' } })).toBe(true);
  });

  it('devuelve false para cualquier otro código', () => {
    expect(esDeadlock({ code: '23505' })).toBe(false);
    expect(esDeadlock({ driverError: { code: '23505' } })).toBe(false);
  });

  it('devuelve false para errores sin `code` ni `driverError`', () => {
    expect(esDeadlock(new Error('boom'))).toBe(false);
    expect(esDeadlock(undefined)).toBe(false);
    expect(esDeadlock(null)).toBe(false);
  });
});
