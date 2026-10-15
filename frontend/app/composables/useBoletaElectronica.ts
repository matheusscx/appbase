import type { BoletaVenta } from '~/types/boleta'
import type { BoletaElectronicaTicket, BoletaEmisor } from '~/utils/ticket-builder'

/**
 * Qué agrega la boleta electrónica de la venta al ticket y al aviso del cajero (spec
 * `2026-10-14-boleta-desde-la-venta` § 7 y § 8.2). El servidor decide si hubo boleta; acá solo
 * se traduce el payload (`BoletaVenta`) a lo que consume `buildBoletaTicket`.
 */
export function useBoletaElectronica() {
  /**
   * Lo que se esparce sobre el `imprimirBoleta` del cobro, del cierre y de la reimpresión:
   * `electronica` + `emisor` si la boleta salió, `pendienteDeEmision` si debía salir y no pudo,
   * `{}` si no aplica (el ticket de hoy). Sin la clave `emisor` cuando no hay boleta: un
   * `emisor: undefined` esparcido taparía el de la pantalla.
   */
  function paraTicket(boleta: BoletaVenta): {
    electronica?: BoletaElectronicaTicket
    pendienteDeEmision?: boolean
    emisor?: BoletaEmisor
  } {
    const e = boleta.boletaElectronica
    if (e) {
      return {
        electronica: {
          tipo: e.tipo,
          folio: e.folio,
          monto: e.monto,
          cubreTodo: e.cubreTodo,
          certificacion: e.ambiente === 'certificacion',
          resolucion: e.resolucion,
        },
        // El emisor del papel es el de la boleta (la razón social de su CAF), no la preferida.
        emisor: {
          nombre: e.emisor.razonSocial,
          rut: e.emisor.rut,
          giro: e.emisor.giro,
          direccion: `${e.emisor.direccion}, ${e.emisor.comuna}`,
        },
      }
    }
    return boleta.boletaSinEmitir ? { pendienteDeEmision: true } : {}
  }

  /** El motivo para el cajero si la boleta debía emitirse y no se pudo; `null` si no hay aviso. */
  function avisoSinEmitir(boleta: BoletaVenta): string | null {
    return boleta.boletaSinEmitir?.mensaje ?? null
  }

  return { paraTicket, avisoSinEmitir }
}
