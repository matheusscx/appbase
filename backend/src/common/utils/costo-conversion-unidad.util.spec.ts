import { BadRequestException } from '@nestjs/common';
import {
  assertCostoNoColapsaACero,
  convertirCostoUnitario,
} from './costo-conversion-unidad.util';

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

/**
 * La línea que separa los dos ceros: el que alguien eligió (mercadería de
 * donación, legítimo desde el 2026-08-29) y el que se perdió en la conversión.
 * Sin este chequeo el segundo se persistiría como costo real, en silencio.
 */
describe('assertCostoNoColapsaACero', () => {
  it('rechaza el costo positivo que la conversión deja en 0', () => {
    // 0,0001/kg convertido a gramos: 0,0000001 ⇒ '0.0000' a escala 4.
    const convertido = convertirCostoUnitario('1', '0.0001', '1000');
    expect(convertido).toBe('0.0000');
    expect(() => assertCostoNoColapsaACero('0.0001', convertido, 'g')).toThrow(
      BadRequestException,
    );
  });

  it('deja pasar el 0 que venía de origen', () => {
    expect(() =>
      assertCostoNoColapsaACero(
        '0',
        convertirCostoUnitario('1', '0', '1000'),
        'g',
      ),
    ).not.toThrow();
  });

  it('deja pasar el costo positivo que sobrevive la conversión', () => {
    expect(() =>
      assertCostoNoColapsaACero(
        '5000',
        convertirCostoUnitario('1', '5000', '1000'),
        'g',
      ),
    ).not.toThrow();
  });

  it('nombra la unidad de destino en el mensaje', () => {
    // El 400 tiene que decir a qué unidad se estaba convirtiendo: es el dato
    // con el que la persona corrige (cargar en otra unidad, o revisar el costo).
    expect(() =>
      assertCostoNoColapsaACero('0.0001', '0.0000', 'gramo'),
    ).toThrow(/"gramo"/);
  });
});
