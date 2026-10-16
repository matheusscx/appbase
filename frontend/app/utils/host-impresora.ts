const OCTETO = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const ETIQUETA = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?'
// Espejo de `backend/src/modules/impresoras/dto/host-impresora.ts`: una IPv4 o un nombre de host
// ("cocina" o "cocina.local"). Solo dígitos y puntos tiene que ser una IPv4 válida.
const HOST = new RegExp(
  `^(?:${OCTETO}(?:\\.${OCTETO}){3}|(?!\\d+(?:\\.\\d+)*$)${ETIQUETA}(?:\\.${ETIQUETA})*)$`,
)

/** Auditoría UX 07.17: el dueño se enteraba de una IP mal escrita cuando la cocina no recibía la comanda. */
export function hostImpresoraValido(host: string): boolean {
  return HOST.test(host.trim())
}
