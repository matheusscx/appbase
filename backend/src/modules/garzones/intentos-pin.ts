import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { leerLimite } from '../../common/limites/limites.config';

const MINUTO = 60_000;
/** Intentos sin un acierto ni un intento nuevo en este lapso se olvidan. */
const OLVIDO_MS = 15 * MINUTO;

interface Registro {
  /** Intentos que no terminaron en acierto, contando los que están en vuelo. */
  intentos: number;
  ultimoIntento: number;
  bloqueadoHasta: number;
}

/**
 * Fallos de PIN seguidos por garzón (P2 del owner, 2026-10-13: "5 fallos y
 * espera 5 min"; ADR-032).
 *
 * Vive en `verificarPin` y no en un throttler de ruta porque el PIN **no tiene
 * una puerta, tiene nueve**: `/garzones/verificar-pin`, todo lo que pasa por
 * `resolverGarzonActuante` (abrir, cerrar y traspasar cuentas, las tres de la
 * sesión de garzón, los pendientes del testigo de caja) y el testigo al
 * resolver, que llama a `verificarPin` directo. Un límite en una sola ruta
 * dejaba las otras como oráculo. Y cuenta **fallos**, no requests: un garzón
 * que acierta su PIN cuarenta veces por turno no se tiene que enterar de que
 * esto existe.
 *
 * ⚠️ **El intento se reserva ANTES de comparar**, y no es estilo. Si se contara
 * recién al fallar, N requests en paralelo pasarían todas el chequeo antes de
 * que la primera llegue a fallar —el `bcrypt.compare` tarda—, y el tope real
 * sería el límite global por persona, no 5. Reservado, el sexto en vuelo ya
 * encuentra el cupo lleno. Un acierto devuelve la reserva.
 *
 * Bloqueado, el PIN correcto también espera: si no, el bloqueo no frena nada,
 * porque el que adivina sigue probando y el acierto lo destraba. Por lo mismo,
 * un acierto que llega con el bloqueo ya puesto no lo levanta.
 *
 * En memoria, igual que los demás límites: con una réplica alcanza, y un deploy
 * lo vacía. Con 5 intentos cada 5 minutos, recorrer el millón de PINes de 6
 * dígitos contra un garzón lleva unos dos años.
 */
@Injectable()
export class IntentosPin {
  private readonly registros = new Map<string, Registro>();
  private readonly maxFallos: number;
  private readonly esperaMs: number;
  /** Reemplazable en los tests. */
  ahora: () => number = () => Date.now();

  constructor(config: ConfigService) {
    this.maxFallos = leerLimite(config, 'LIMITE_PIN_FALLOS', 5);
    this.esperaMs = 5 * MINUTO;
  }

  /**
   * Toma un intento del cupo antes de comparar. Tira 429 si el garzón está
   * bloqueado, o si este intento es uno más de los que el cupo admite (llegó en
   * paralelo con los anteriores).
   */
  reservarIntento(clave: string): void {
    const ahora = this.ahora();
    this.olvidarViejos(ahora);
    const registro = this.registros.get(clave) ?? {
      intentos: 0,
      ultimoIntento: ahora,
      bloqueadoHasta: 0,
    };
    if (registro.bloqueadoHasta > ahora) {
      throw this.bloqueado(registro.bloqueadoHasta);
    }
    if (registro.bloqueadoHasta !== 0) {
      // El bloqueo anterior ya venció: se arranca de cero.
      registro.intentos = 0;
      registro.bloqueadoHasta = 0;
    }
    registro.intentos += 1;
    registro.ultimoIntento = ahora;
    this.registros.set(clave, registro);
    if (registro.intentos > this.maxFallos) {
      throw this.bloquear(registro, ahora);
    }
  }

  /** El intento reservado falló: queda contado. El que completa el cupo bloquea. */
  registrarFallo(clave: string): void {
    const ahora = this.ahora();
    const registro = this.registros.get(clave);
    if (!registro) return;
    if (registro.bloqueadoHasta > ahora) {
      throw this.bloqueado(registro.bloqueadoHasta);
    }
    if (registro.intentos >= this.maxFallos) {
      throw this.bloquear(registro, ahora);
    }
  }

  /** El intento reservado acertó: los fallos seguidos vuelven a cero, salvo con un bloqueo vigente. */
  registrarAcierto(clave: string): void {
    const registro = this.registros.get(clave);
    if (registro && registro.bloqueadoHasta > this.ahora()) return;
    this.registros.delete(clave);
  }

  private bloquear(registro: Registro, ahora: number): HttpException {
    if (registro.bloqueadoHasta <= ahora) {
      registro.bloqueadoHasta = ahora + this.esperaMs;
    }
    return this.bloqueado(registro.bloqueadoHasta);
  }

  /** Un registro sin bloqueo vigente y sin intentos recientes ya no cuenta nada. */
  private olvidarViejos(ahora: number): void {
    for (const [clave, r] of this.registros) {
      if (r.bloqueadoHasta <= ahora && ahora - r.ultimoIntento >= OLVIDO_MS) {
        this.registros.delete(clave);
      }
    }
  }

  private bloqueado(hasta: number): HttpException {
    const minutos = Math.max(1, Math.ceil((hasta - this.ahora()) / MINUTO));
    return new HttpException(
      `PIN bloqueado por intentos fallidos. Esperá ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} o pedile a otro garzón que lo haga.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
