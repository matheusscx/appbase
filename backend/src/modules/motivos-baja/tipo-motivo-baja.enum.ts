/**
 * Qué es un motivo de baja. Decide si la baja descuenta stock (lo usa la parte 2
 * del frente "anular un plato enviado a cocina"): `merma` y `cortesia`
 * descuentan; `no_elaborado` no. No hay un flag aparte a propósito: permitiría
 * una merma que no descuenta.
 */
export enum TipoMotivoBaja {
  MERMA = 'merma',
  CORTESIA = 'cortesia',
  NO_ELABORADO = 'no_elaborado',
}
