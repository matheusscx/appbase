import { BadRequestException } from '@nestjs/common';
import { resolverClaveIdempotencia } from './clave-idempotencia.decorator';

describe('resolverClaveIdempotencia', () => {
  it('devuelve el UUID de la cabecera', () => {
    const clave = '2f1c8a3e-6a1b-4d8e-9a55-0c7b1f7d2e10';
    expect(resolverClaveIdempotencia(clave)).toBe(clave);
  });

  it('sin cabecera: 400', () => {
    expect(() => resolverClaveIdempotencia(undefined)).toThrow(
      BadRequestException,
    );
  });

  it('un valor que no es UUID: 400', () => {
    expect(() => resolverClaveIdempotencia('no-es-uuid')).toThrow(
      BadRequestException,
    );
  });

  it('la cabecera repetida (Node la entrega como array): 400', () => {
    expect(() =>
      resolverClaveIdempotencia([
        '2f1c8a3e-6a1b-4d8e-9a55-0c7b1f7d2e10',
        '3a1c8a3e-6a1b-4d8e-9a55-0c7b1f7d2e10',
      ]),
    ).toThrow(BadRequestException);
  });
});
