import { createHash } from 'node:crypto';

export type OperacionIdempotente =
  | 'venta.crear'
  | 'cuenta.cerrar'
  | 'pago.abono';

/**
 * Lo que distingue "el mismo cobro reintentado" de "otro cobro con la misma
 * clave": SHA-256 de un JSON canónico —claves ordenadas a toda profundidad,
 * arrays en su orden— de la operación más lo que el request pidió.
 *
 * El llamador arma `datos` a mano y decide qué NO entra. El PIN del garzón no
 * entra nunca: el hash de un PIN de pocos dígitos se revierte por fuerza bruta,
 * así que guardarlo sería guardar el PIN. Que la lista de exclusiones no viva
 * acá es a propósito: un campo sensible nuevo en un DTO se decide en su
 * llamador, no se filtra por un helper que no lo conoce.
 */
export function huellaDe(
  operacion: OperacionIdempotente,
  datos: unknown,
): string {
  const plano: unknown = JSON.parse(JSON.stringify(datos ?? null));
  return createHash('sha256')
    .update(JSON.stringify({ operacion, datos: ordenar(plano) }))
    .digest('hex');
}

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenar);
  if (valor && typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(objeto)
        .sort()
        .map((k) => [k, ordenar(objeto[k])]),
    );
  }
  return valor;
}
