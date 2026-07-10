import { descripcionCodigoRespuesta } from './codigos-respuesta';

describe('descripcionCodigoRespuesta', () => {
  it('0 → aprobada', () => {
    expect(descripcionCodigoRespuesta('0')).toBe('Transacción aprobada');
    expect(descripcionCodigoRespuesta(0)).toBe('Transacción aprobada');
  });

  it('mapea rechazos nivel 2 conocidos', () => {
    expect(descripcionCodigoRespuesta('-1')).toBe('Tarjeta inválida');
    expect(descripcionCodigoRespuesta(-7)).toBe('Tarjeta bloqueada');
    expect(descripcionCodigoRespuesta('-8')).toBe('Tarjeta vencida');
  });

  it('null/vacío/desconocido → motivo genérico', () => {
    expect(descripcionCodigoRespuesta(null)).toBe(
      'Pago rechazado por el emisor',
    );
    expect(descripcionCodigoRespuesta('')).toBe('Pago rechazado por el emisor');
    expect(descripcionCodigoRespuesta('-99')).toBe(
      'Pago rechazado por el emisor',
    );
  });
});
