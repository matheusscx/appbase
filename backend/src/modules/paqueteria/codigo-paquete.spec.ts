import { BadRequestException } from '@nestjs/common';
import { normalizarCodigoPaquete, MAX_CODIGO } from './codigo-paquete';

describe('normalizarCodigoPaquete', () => {
  it('texto plano: recorta los bordes', () => {
    expect(normalizarCodigoPaquete('  46123456789 \n')).toBe('46123456789');
  });

  it('JSON con id (QR de Mercado Libre): el código es el id', () => {
    // La forma de una etiqueta real (owner, 2026-10-16), con los números cambiados.
    const qr =
      '{"id":"46123456789","sender_id":1234567890,"hash_code":null,"security_digit":null}';
    expect(normalizarCodigoPaquete(qr)).toBe('46123456789');
  });

  it('JSON con id numérico: lo pasa a texto', () => {
    expect(normalizarCodigoPaquete('{"id":46123456789}')).toBe('46123456789');
  });

  it('JSON sin id: el código es el texto entero, recortado', () => {
    expect(normalizarCodigoPaquete(' {"otro":1} ')).toBe('{"otro":1}');
  });

  it('JSON con id vacío o no escalar: el texto entero', () => {
    expect(normalizarCodigoPaquete('{"id":""}')).toBe('{"id":""}');
    expect(normalizarCodigoPaquete('{"id":{"a":1}}')).toBe('{"id":{"a":1}}');
  });

  it('JSON inválido que empieza con llave: el texto entero', () => {
    expect(normalizarCodigoPaquete('{no es json')).toBe('{no es json');
  });

  it('vacío o solo espacios: 400', () => {
    expect(() => normalizarCodigoPaquete('   ')).toThrow(BadRequestException);
  });

  it(`más de ${MAX_CODIGO} caracteres después de normalizar: 400`, () => {
    expect(() => normalizarCodigoPaquete('x'.repeat(MAX_CODIGO + 1))).toThrow(
      BadRequestException,
    );
    expect(normalizarCodigoPaquete('x'.repeat(MAX_CODIGO))).toHaveLength(
      MAX_CODIGO,
    );
  });
});
