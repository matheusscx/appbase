import {
  BadRequestException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';

/**
 * La cabecera `Idempotency-Key` es obligatoria en los endpoints que cobran:
 * el backend no puede depender de que cada pantalla se acuerde de mandarla
 * (ADR-026). Una clave por intento de cobro,
 * generada por el cliente.
 */
export function resolverClaveIdempotencia(valor: unknown): string {
  if (typeof valor !== 'string' || !isUUID(valor))
    throw new BadRequestException(
      'Falta la cabecera Idempotency-Key, o no es un UUID. Cada intento de cobro manda la suya.',
    );
  return valor;
}

/**
 * Los guards de ruta corren antes que los parámetros: sin permiso sigue
 * saliendo 401/403, no este 400.
 */
export const ClaveIdempotencia = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    resolverClaveIdempotencia(
      ctx.switchToHttp().getRequest<Request>().headers['idempotency-key'],
    ),
);
