import { normalizeIp } from '@nestjs/throttler';
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export interface ConfigIpDelCliente {
  /** `PROXY_SECRETO`: el que comparte con el proxy del frontend. */
  secretoProxy?: string;
  /** `IP_CABECERA_BORDE`: la cabecera con la que el borde de Railway nombra al cliente. */
  cabeceraBorde?: string;
}

interface RequestConIp {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

/**
 * La IP del cliente para los límites por IP, **sin creerle a nada que el cliente
 * pueda escribir**.
 *
 * Por qué no `req.ip`: desde ADR-022 el navegador no llega al backend, llega el
 * proxy del frontend, así que el par TCP es el mismo para todos (medido en
 * Railway el 2026-10-13: `152.55.176.109` para cualquier usuario). Un límite
 * sobre eso es un balde compartido por todo el SaaS. Y `trust proxy` +
 * `X-Forwarded-For` tampoco: el proxy de h3 reenvía esa cabecera tal cual la
 * mandó el cliente.
 *
 * El orden, de más a menos confiable:
 * 1. `x-cliente-ip`, **solo** si viene con `x-proxy-secreto` igual al nuestro.
 *    El proxy la pone desde lo que ve él, y el secreto prueba que la puso él.
 * 2. La cabecera del borde (`IP_CABECERA_BORDE`), solo si está configurada y
 *    trae **una** IP: es lo que llega directo al backend sin pasar por el
 *    proxy, como el retorno de Webpay. Una lista se descarta entera, porque su
 *    primer elemento lo escribe el cliente.
 * 3. El par TCP. En local es el host; en Railway, sin las dos de arriba, es el
 *    borde: un balde compartido, que es la falla segura (limita de más, no deja
 *    pasar).
 *
 * IPv6 se agrupa por /64, como la librería: un cliente recibe el bloque entero
 * y rotar dentro de él no le da un balde nuevo.
 */
export function ipDelCliente(
  req: RequestConIp,
  config: ConfigIpDelCliente,
): string {
  if (
    config.secretoProxy &&
    secretoCoincide(req.headers['x-proxy-secreto'], config.secretoProxy)
  ) {
    const delProxy = unaIp(req.headers['x-cliente-ip']);
    if (delProxy) return normalizeIp(delProxy);
  }
  if (config.cabeceraBorde) {
    const delBorde = unaIp(req.headers[config.cabeceraBorde.toLowerCase()]);
    if (delBorde) return normalizeIp(delBorde);
  }
  return normalizeIp(req.socket?.remoteAddress ?? 'desconocida');
}

function unaIp(valor: string | string[] | undefined): string | null {
  if (typeof valor !== 'string') return null;
  const ip = valor.trim();
  return isIP(ip) ? ip : null;
}

function secretoCoincide(
  recibido: string | string[] | undefined,
  esperado: string,
): boolean {
  if (typeof recibido !== 'string') return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
