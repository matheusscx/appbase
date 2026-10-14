import { type ExecutionContext, Injectable } from '@nestjs/common';
import {
  ThrottlerException,
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerRequest,
} from '@nestjs/throttler';
import type { Response } from 'express';
import { mensajeDeLimite } from './limites.config';

/** Dónde deja `throwThrottlingException` la espera, para que la lea `handleRequest`. */
const ESPERA = Symbol('limites:espera-segundos');

/**
 * El `ThrottlerGuard` de la librería, con dos cosas que no trae:
 *
 * - **El mensaje en español y por límite.** La librería tira el mismo texto en
 *   inglés para todos, y su `errorMessage` no recibe cuál de los límites se
 *   chocó; acá sí se sabe, y el de login ofrece recuperar la contraseña.
 * - **`Retry-After` sin sufijo.** La librería nombra la cabecera
 *   `Retry-After-<límite>` para todo límite que no se llame `default`, y
 *   ninguno de los nuestros se llama así: sin esto el estándar no llegaba nunca.
 *   Sale también en los límites por correo, que no mandan `X-RateLimit-*`.
 *
 * La espera se toma del detalle que arma la librería al bloquear, y no de su
 * cabecera, que en esos límites no existe. `throwThrottlingException` recibe el
 * detalle pero no el nombre del límite; `handleRequest`, al revés. Se cruzan
 * por la respuesta, que es de este request y de ningún otro.
 */
@Injectable()
export class LimitesGuard extends ThrottlerGuard {
  protected async handleRequest(peticion: ThrottlerRequest): Promise<boolean> {
    try {
      return await super.handleRequest(peticion);
    } catch (error) {
      if (!(error instanceof ThrottlerException)) throw error;
      const nombre = peticion.throttler.name ?? 'default';
      const res = peticion.context.switchToHttp().getResponse<Response>();
      const espera = (res as unknown as Record<symbol, number | undefined>)[
        ESPERA
      ];
      const segundos = Math.max(1, Math.ceil(espera ?? 1));
      res.setHeader('Retry-After', segundos);
      throw new ThrottlerException(mensajeDeLimite(nombre, segundos));
    }
  }

  protected async throwThrottlingException(
    contexto: ExecutionContext,
    detalle: ThrottlerLimitDetail,
  ): Promise<void> {
    const res = contexto.switchToHttp().getResponse<Response>();
    (res as unknown as Record<symbol, number>)[ESPERA] =
      detalle.timeToBlockExpire;
    return super.throwThrottlingException(contexto, detalle);
  }
}
