import { convertirCostoUnitario } from './costo-conversion-unidad.util';

describe('costo-conversion-unidad.util', () => {
  it('2 kg a $5.000/kg, convertido a 2000 g → $5/g (valor total preservado)', () => {
    const costoBase = convertirCostoUnitario('2', '5000', '2000');
    expect(costoBase).toBe('5.0000');
    // Valor total: 2 kg × 5.000/kg == 2000 g × 5/g == 10.000.
    expect(Number(costoBase) * 2000).toBe(2 * 5000);
  });

  it('sin conversión real (cantidadConvertida == cantidadIngresada) devuelve el mismo costo', () => {
    expect(convertirCostoUnitario('10', '100', '10')).toBe('100.0000');
  });

  it('redondea a 4 decimales', () => {
    // 1 unidad a 10, convertida a 3 → 10/3 = 3.3333...
    expect(convertirCostoUnitario('1', '10', '3')).toBe('3.3333');
  });

  it('500 g a $8/g, convertido a 0.5 kg → $8.000/kg (mismo valor total: 4.000)', () => {
    expect(convertirCostoUnitario('500', '8', '0.5')).toBe('8000.0000');
  });
});
