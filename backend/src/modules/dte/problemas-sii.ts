/**
 * Las boletas con problemas en el SII: qué es cada grupo (la condición SQL) y por qué está así
 * (el motivo, en palabras del local). Vive aparte para que la franja del cajero, la lista de
 * soporte y el listado cuenten lo mismo.
 */
export type GrupoProblema = 'atrasada' | 'rechazada' | 'con_reparos';

/**
 * Condiciones sobre `dte_documentos` con alias `d`. No incluyen `d.eliminado_el IS NULL`: cada
 * consulta lo pone.
 */
export const COND_ATRASADA = `d.estado IN ('pendiente','enviado') AND d.emitido_el < now() - interval '1 hour'`;
export const COND_RECHAZADA = `d.estado = 'rechazado'`;
export const COND_CON_REPAROS = `d.estado = 'reparos' AND d.emitido_el >= now() - interval '30 days'`;
/** Atrasada o rechazada: lo que avisa la franja y lo que ve soporte. */
export const COND_CON_PROBLEMAS = `((${COND_ATRASADA}) OR (${COND_RECHAZADA}))`;

const ERROR_DEL_SISTEMA = 'Error del sistema al enviarla al SII.';

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null;
}

/**
 * Lo que el SII explicó de la boleta: la `descripcion` del primer elemento de `error[]` que la
 * traiga (el SII manda objetos `{ codigo, descripcion, … }`; un texto suelto también vale) o, si
 * no hay, la `descripcion` de la entrada.
 */
function descripcionDe(entrada: Record<string, unknown>): string | null {
  const errores: unknown = entrada.error;
  if (Array.isArray(errores)) {
    for (const e of errores as unknown[]) {
      const d = texto(e) ?? texto(objeto(e)?.descripcion);
      if (d) return d;
    }
  }
  return texto(entrada.descripcion);
}

/** `Prefijo: descripción.` sin duplicar el punto que la descripción ya traiga. */
function conDescripcion(
  prefijo: string,
  d: string | null,
  sinD: string,
): string {
  return d === null ? sinD : `${prefijo}: ${d.replace(/\.+$/, '')}.`;
}

/**
 * El motivo en palabras del local (spec § 6), o null si no hay nada que decir. Nunca lanza:
 * `detalleSii` viene del SII sin validar.
 */
export function motivoDe(
  grupo: GrupoProblema,
  detalleSii: unknown,
  ultimoError: string | null,
): string | null {
  if (grupo === 'atrasada') return ultimoError;
  const detalle = objeto(detalleSii);
  if (!detalle) return null;
  // El origen manda sobre el estado: el rechazo del sobre entero trae `estado: 'RCH'`, pero es
  // el sistema el que falló.
  if (
    detalle.origen === 'esquema' ||
    detalle.origen === 'sobre' ||
    detalle.origen === 'envio'
  )
    return ERROR_DEL_SISTEMA;
  if (detalle.estado === 'RCH')
    return conDescripcion(
      'El SII la rechazó',
      descripcionDe(detalle),
      'El SII la rechazó.',
    );
  if (detalle.estado === 'RPR' || detalle.estado === 'RLV')
    return conDescripcion(
      'El SII avisa',
      descripcionDe(detalle),
      'El SII la aceptó con reparos.',
    );
  return null;
}
