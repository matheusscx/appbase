import type { IncomingHttpHeaders } from 'node:http'
import { isIP } from 'node:net'

/**
 * Las cabeceras con las que este proxy le dice al backend quién es el cliente
 * (ADR-032), o `null` si no corresponde mandar ninguna.
 *
 * El backend ve a este servidor como el par TCP de todos los usuarios (ADR-022),
 * así que para limitar por IP necesita que alguien le nombre al cliente. Lo hace
 * este proxy, desde lo que ve **él**, y firma con `PROXY_SECRETO`: el backend
 * solo le cree a `x-cliente-ip` si el secreto coincide, porque el navegador
 * también puede mandar esa cabecera.
 *
 * De dónde sale la IP: de `IP_CABECERA_BORDE` si está configurada y trae una
 * sola IP (detrás de Railway el par TCP es su borde, no el cliente), y si no,
 * del par TCP. Una lista se descarta entera: su primer elemento lo escribe el
 * cliente. Es la misma regla que aplica el backend a lo que le llega directo
 * (`backend/src/common/limites/ip-del-cliente.ts`).
 */
export function cabecerasDelCliente(
  entrantes: IncomingHttpHeaders,
  parTcp: string | undefined,
  env: Record<string, string | undefined>,
): Record<string, string> | null {
  if (!env.PROXY_SECRETO) return null
  const delBorde = env.IP_CABECERA_BORDE
    ? unaIp(entrantes[env.IP_CABECERA_BORDE.toLowerCase()])
    : null
  const ip = delBorde ?? unaIp(parTcp)
  if (!ip) return null
  return { 'x-cliente-ip': ip, 'x-proxy-secreto': env.PROXY_SECRETO }
}

function unaIp(valor: string | string[] | undefined): string | null {
  if (typeof valor !== 'string') return null
  const ip = valor.trim()
  return isIP(ip) ? ip : null
}
