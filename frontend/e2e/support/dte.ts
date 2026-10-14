import { generateKeyPairSync } from 'node:crypto'

/**
 * Un archivo de folios (CAF) como lo descarga el dueño del local, para subirlo por la pantalla.
 *
 * Es la versión corta de `cafDePrueba` del backend (`__fixtures__/credenciales-prueba.ts`): la
 * llave RSA de 512 bits se genera en cada corrida y la `FRMA` es falsa, porque el backend lee
 * la forma del CAF y que `RSASK` sea la par de `RSAPK`, pero no verifica la firma del SII.
 * Las cabeceras PEM salen del `export` de Node, nunca de un literal en el archivo (el repo es
 * público).
 *
 * Devuelve los **bytes en ISO-8859-1**, que es como el SII entrega el archivo: pasarlos por
 * UTF-8 cambiaría la Ñ de la razón social, y la pantalla tiene que subirlos tal cual.
 */
export function cafDePrueba(opts: {
  rut: string
  tipo: 39 | 41
  desde: number
  hasta: number
}): Buffer {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 512 })
  const jwk = publicKey.export({ format: 'jwk' })
  // M y E van en base64 estándar; el JWK las da en base64url.
  const b64 = (s: string) => Buffer.from(s, 'base64url').toString('base64')
  const rsask = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
  const rsapubk = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const xml = [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<AUTORIZACION>',
    '<CAF version="1.0">',
    '<DA>',
    `<RE>${opts.rut}</RE><RS>EMPRESA DE PRUEBA ÑANDÚ LTDA</RS><TD>${opts.tipo}</TD>`,
    `<RNG><D>${opts.desde}</D><H>${opts.hasta}</H></RNG><FA>2026-10-01</FA>`,
    `<RSAPK><M>${b64(jwk.n!)}</M><E>${b64(jwk.e!)}</E></RSAPK><IDK>100</IDK>`,
    '</DA>',
    '<FRMA algoritmo="SHA1withRSA">RlJNQSBkZSBwcnVlYmE=</FRMA>',
    '</CAF>',
    `<RSASK>${rsask}</RSASK>`,
    `<RSAPUBK>${rsapubk}</RSAPUBK>`,
    '</AUTORIZACION>',
  ].join('\r\n')
  return Buffer.from(`${xml}\r\n`, 'latin1')
}
