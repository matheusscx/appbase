import { normalizarRut, rutValido } from './rut.util';

describe('normalizarRut', () => {
  it.each([
    ['76.543.210-3', '76543210-3'],
    ['76543210-3', '76543210-3'],
    ['765432103', '76543210-3'],
    [' 9.876.543-k ', '9876543-K'],
  ])('%s → %s', (entrada, salida) => {
    expect(normalizarRut(entrada)).toBe(salida);
  });
});

/**
 * Mismos casos que `rutValido` en `frontend/app/composables/useReceptor.spec.ts`.
 * Los DV salen de un cálculo módulo 11 hecho aparte, no de esta función.
 */
describe('rutValido', () => {
  it.each([
    ['76.543.210-3', true],
    ['76543210-3', true],
    ['765432103', true],
    ['9.876.543-3', true],
    ['10.000.013-k', true],
    ['10000013-K', true],
    ['10000004-0', true],
    ['100000-4', true],
    ['99999999-9', true],
  ])('%s es un RUT', (rut, esperado) => {
    expect(rutValido(rut)).toBe(esperado);
  });

  it.each([
    ['76.543.210-5', 'DV equivocado'],
    ['9.876.543-K', 'K donde va un número'],
    ['10000013-0', 'cero donde va K'],
    ['99999-7', 'cuerpo bajo 100.000, aunque el DV calce'],
    ['100000000-1', 'cuerpo sobre 99.999.999'],
    ['7654321A-3', 'letra en el cuerpo'],
    ['76543210-X', 'DV que no es dígito ni K'],
    ['', 'vacío'],
    ['-', 'solo guion'],
  ])('%s no es un RUT (%s)', (rut) => {
    expect(rutValido(rut)).toBe(false);
  });
});
