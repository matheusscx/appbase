const OCTETO = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = `${OCTETO}(?:\\.${OCTETO}){3}`;
const ETIQUETA = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
// Un nombre de host de la red: una o más etiquetas ("cocina", "cocina.local"). En una red local
// un nombre de una sola palabra es válido, así que no se exige punto (no es regla del owner). Lo
// que solo tiene dígitos y puntos tiene que ser una IPv4 válida.
const NOMBRE = `(?!\\d+(?:\\.\\d+)*$)${ETIQUETA}(?:\\.${ETIQUETA})*`;

/** Host de una impresora de red: una IPv4 o un nombre de host. Espejo de `utils/host-impresora.ts`. */
export const HOST_IMPRESORA = new RegExp(`^(?:${IPV4}|${NOMBRE})$`);
export const HOST_IMPRESORA_MENSAJE =
  'host debe ser una IP (por ejemplo 192.168.1.50) o un nombre de la red (por ejemplo cocina.local)';
