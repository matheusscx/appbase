/**
 * Traducción de los códigos de respuesta de autorización de Transbank (Webpay /
 * Oneclick) a un motivo legible. Se usa el detalle "nivel 2" documentado por
 * Transbank en:
 *   https://www.transbankdevelopers.cl/producto/webpay#codigos-de-respuesta-de-autorizacion
 *
 * `0` = transacción aprobada. Los negativos son rechazos. Centralizado aquí para
 * poder ajustar la redacción sin tocar la lógica de negocio.
 */
const MOTIVOS_NIVEL2: Record<string, string> = {
  '0': 'Transacción aprobada',
  '-1': 'Tarjeta inválida',
  '-2': 'Error de conexión',
  '-3': 'Excede el monto máximo',
  '-4': 'Fecha de expiración inválida',
  '-5': 'Problema en la autenticación',
  '-6': 'Rechazo general',
  '-7': 'Tarjeta bloqueada',
  '-8': 'Tarjeta vencida',
  '-9': 'Transacción no soportada',
  '-10': 'Problema en la transacción',
  '-11': 'Excede el límite de reintentos de rechazos',
};

const MOTIVO_DESCONOCIDO = 'Pago rechazado por el emisor';

/**
 * Devuelve el motivo (nivel 2) para un código de respuesta. `null`/vacío o un
 * código no mapeado caen a un mensaje genérico de rechazo (nunca `null`, para que
 * la UI siempre tenga algo que mostrar en un rechazo).
 */
export function descripcionCodigoRespuesta(
  codigo: string | number | null | undefined,
): string {
  if (codigo === null || codigo === undefined || codigo === '')
    return MOTIVO_DESCONOCIDO;
  return MOTIVOS_NIVEL2[String(codigo)] ?? MOTIVO_DESCONOCIDO;
}
