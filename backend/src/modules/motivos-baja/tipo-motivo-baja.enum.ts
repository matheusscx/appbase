/**
 * Qué es un motivo de baja. Decide si la baja descuenta stock (lo usa la parte 2
 * del frente "anular un plato enviado a cocina"): `merma`, `cortesia` y
 * `consumo_personal` descuentan; `no_elaborado` no. No hay un flag aparte a
 * propósito: permitiría una merma que no descuenta.
 *
 * `consumo_personal` es la comida del personal **dentro** del local: descuenta
 * como la cortesía pero no es retiro (Oficio 734/2002), así que no congela IVA
 * (spec `2026-10-04-comida-del-personal-design.md`).
 */
export enum TipoMotivoBaja {
  MERMA = 'merma',
  CORTESIA = 'cortesia',
  NO_ELABORADO = 'no_elaborado',
  CONSUMO_PERSONAL = 'consumo_personal',
}

/**
 * Si una baja con este tipo descuenta stock. Un solo lugar para la regla: los
 * caminos de la mesa (`anularLinea`, `cancelarConMotivo`) la repetían a mano, y
 * un tipo nuevo que se olvide en uno de ellos dejaría un plato servido sin
 * descontar. El `switch` es exhaustivo: un quinto tipo no compila hasta que
 * alguien decida acá si descuenta.
 */
export function tipoMotivoBajaDescuenta(tipo: TipoMotivoBaja): boolean {
  switch (tipo) {
    case TipoMotivoBaja.MERMA:
    case TipoMotivoBaja.CORTESIA:
    case TipoMotivoBaja.CONSUMO_PERSONAL:
      return true;
    case TipoMotivoBaja.NO_ELABORADO:
      return false;
    default: {
      const sinDecidir: never = tipo;
      return sinDecidir;
    }
  }
}
