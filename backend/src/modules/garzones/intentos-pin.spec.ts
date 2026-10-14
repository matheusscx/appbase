import { HttpException, HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { IntentosPin } from './intentos-pin';

function config(valores: Record<string, string> = {}): ConfigService {
  return { get: (k: string) => valores[k] } as unknown as ConfigService;
}

function estado(fn: () => void): number | 'ok' {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : -1;
  }
}

const BLOQUEADO = HttpStatus.TOO_MANY_REQUESTS;

describe('IntentosPin', () => {
  const CLAVE = 'tenant-1:garzon-1';
  let ahora: number;
  let intentos: IntentosPin;

  /** Lo que hace `verificarPin` con un PIN equivocado: reservar y fallar. */
  function fallar(pin = intentos, clave = CLAVE): number | 'ok' {
    return estado(() => {
      pin.reservarIntento(clave);
      pin.registrarFallo(clave);
    });
  }

  /** Lo que hace `verificarPin` con el PIN correcto. */
  function acertar(clave = CLAVE): number | 'ok' {
    return estado(() => {
      intentos.reservarIntento(clave);
      intentos.registrarAcierto(clave);
    });
  }

  beforeEach(() => {
    ahora = 1_000_000;
    intentos = new IntentosPin(config());
    intentos.ahora = () => ahora;
  });

  it('cuatro fallos no bloquean; el quinto sí, con 429', () => {
    for (let i = 0; i < 4; i++) expect(fallar()).toBe('ok');
    expect(fallar()).toBe(BLOQUEADO);
  });

  it('bloqueado, ni siquiera se deja probar: el PIN correcto también espera', () => {
    for (let i = 0; i < 5; i++) fallar();
    expect(acertar()).toBe(BLOQUEADO);
  });

  // El caso que la revisión independiente encontró abierto: si el intento se
  // contara recién al fallar, los diez pasarían el chequeo antes del primer
  // `bcrypt.compare` y llegarían todos a comparar.
  it('en paralelo, el sexto intento en vuelo ya encuentra el cupo lleno', () => {
    const reservas: (number | 'ok')[] = [];
    for (let i = 0; i < 10; i++) {
      reservas.push(estado(() => intentos.reservarIntento(CLAVE)));
    }
    expect(reservas).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      BLOQUEADO,
      BLOQUEADO,
      BLOQUEADO,
      BLOQUEADO,
      BLOQUEADO,
    ]);
  });

  it('un acierto que llega con el bloqueo ya puesto no lo levanta', () => {
    for (let i = 0; i < 5; i++) intentos.reservarIntento(CLAVE);
    estado(() => intentos.reservarIntento(CLAVE)); // el sexto bloquea
    intentos.registrarAcierto(CLAVE); // uno de los cinco en vuelo acertó
    expect(estado(() => intentos.reservarIntento(CLAVE))).toBe(BLOQUEADO);
  });

  it('el aviso dice cuánto falta, en minutos', () => {
    for (let i = 0; i < 4; i++) fallar();
    expect(() => {
      intentos.reservarIntento(CLAVE);
      intentos.registrarFallo(CLAVE);
    }).toThrow(/5 minutos/);
    ahora += 4 * 60_000 + 1;
    expect(() => intentos.reservarIntento(CLAVE)).toThrow(/1 minuto/);
  });

  it('pasados los 5 minutos se puede volver a probar, desde cero', () => {
    for (let i = 0; i < 5; i++) fallar();
    ahora += 5 * 60_000;
    for (let i = 0; i < 4; i++) expect(fallar()).toBe('ok');
    expect(fallar()).toBe(BLOQUEADO);
  });

  it('un acierto borra los fallos: son "seguidos"', () => {
    for (let i = 0; i < 4; i++) fallar();
    expect(acertar()).toBe('ok');
    for (let i = 0; i < 4; i++) expect(fallar()).toBe('ok');
  });

  it('cada garzón cuenta aparte', () => {
    for (let i = 0; i < 5; i++) fallar();
    expect(acertar('tenant-1:garzon-2')).toBe('ok');
  });

  it('fallos viejos se olvidan: 15 minutos sin intentar vuelve a cero', () => {
    for (let i = 0; i < 4; i++) fallar();
    ahora += 15 * 60_000;
    for (let i = 0; i < 4; i++) expect(fallar()).toBe('ok');
  });

  it('los números salen del entorno, por la escala', () => {
    const otro = new IntentosPin(
      config({ LIMITE_PIN_FALLOS: '2', LIMITES_ESCALA: '2' }),
    );
    otro.ahora = () => ahora;
    for (let i = 0; i < 3; i++) expect(fallar(otro)).toBe('ok');
    expect(fallar(otro)).toBe(BLOQUEADO);
  });
});
