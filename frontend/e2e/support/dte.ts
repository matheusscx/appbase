import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

/**
 * Un certificado del firmante (.pfx) autofirmado, para subirlo por la API. El RUT va en el
 * `serialNumber` del sujeto, que es donde el backend lo lee (`leerCertificado`).
 *
 * Lo arma el `openssl` del sistema y no `node-forge`: Playwright no lo tiene entre sus
 * dependencias, y sumarlo sería una dependencia nueva solo para un fixture. Las opciones
 * `-certpbe`/`-keypbe` 3DES y `-macalg sha1` son las que el backend sabe abrir (`node-forge`
 * no lee el AES-256 que OpenSSL 3 usa por defecto); LibreSSL (macOS) y OpenSSL 3 (CI) las
 * aceptan igual. La llave nunca se escribe fuera de un directorio temporal que se borra.
 */
export function certificadoPfxDePrueba(opts: { rut: string, clave?: string }): { pfx: Buffer, clave: string } {
  const clave = opts.clave ?? 'clave-e2e'
  const dir = mkdtempSync(join(tmpdir(), 'cert-e2e-'))
  try {
    const llave = join(dir, 'llave.pem')
    const cert = join(dir, 'cert.pem')
    const pfx = join(dir, 'cert.pfx')
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-keyout', llave, '-out', cert,
      '-subj', `/CN=Firmante e2e/serialNumber=${opts.rut}`,
    ], { stdio: 'pipe' })
    // La clave viaja por un archivo y no por la línea de comandos (`ps` la mostraría).
    const archivoClave = join(dir, 'clave.txt')
    writeFileSync(archivoClave, clave)
    execFileSync('openssl', [
      'pkcs12', '-export', '-inkey', llave, '-in', cert, '-out', pfx,
      '-passout', `file:${archivoClave}`,
      '-certpbe', 'PBE-SHA1-3DES', '-keypbe', 'PBE-SHA1-3DES', '-macalg', 'sha1',
    ], { stdio: 'pipe' })
    return { pfx: readFileSync(pfx), clave }
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
