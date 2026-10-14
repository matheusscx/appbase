import { createHash } from 'crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizarRut, rutValido } from '../../common/utils/rut.util';
import type { AmbienteSii } from './entities/dte-caf.entity';
import { type CertificadoLeido, firmarDocumento } from './firma';
import { aLatin1 } from './texto';

export type RespuestaSii<T> =
  | { tipo: 'ok'; datos: T; reintentarEnMs: number | null } // reintentarEnMs = X-Retry-After en ms
  // 401 en envío o consulta (ya reintentó con token nuevo), o 400/401/403 al pedir la semilla o el
  // token. El job lo trata como reintento con espera, nunca como rechazo de las boletas.
  | { tipo: 'no_autorizado' }
  | { tipo: 'peticion_invalida'; mensaje: string } // 400
  | { tipo: 'no_encontrado' } // 404
  | { tipo: 'transitorio'; mensaje: string }; // red, timeout, 5xx, 405, pausa

export interface ResultadoEnvio {
  trackid: string;
  estado: string;
}

export interface EstadoEnvioSii {
  estado: string;
  detalle_rep_rech?: {
    tipo: number | null;
    folio: number | null;
    estado: string;
    descripcion?: string;
    error?: unknown[];
  }[];
}

/** Reloj del cliente (ms epoch). Se inyecta solo en las pruebas; sin él vale `Date.now`. */
export const RELOJ_SII = Symbol('RELOJ_SII');

export const TOKEN_VIGENCIA_MS = 50 * 60_000;
const TIMEOUT_MS = 20_000;
/** Tope de lo que se lee de una respuesta del SII, y de lo que se copia de ella a un mensaje. */
const MAX_CUERPO = 1_048_576;
const MAX_MENSAJE = 500;
/** El límite del SII es por hora: ninguna pausa dura más. */
const PAUSA_MAXIMA_S = 3600;
/** Pausa cuando el SII limita los pedidos y no dice hasta cuándo. */
const PAUSA_POR_DEFECTO_S = 60;
/** El del ejemplo del OpenAPI; el SII exige un `User-Agent`. */
const USER_AGENT = 'Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)';

const URLS_POR_DEFECTO = {
  SII_BOLETA_API_CERTIFICACION: 'https://apicert.sii.cl/recursos/v1',
  SII_BOLETA_ENVIO_CERTIFICACION: 'https://pangal.sii.cl/recursos/v1',
  SII_BOLETA_API_PRODUCCION: 'https://api.sii.cl/recursos/v1',
  SII_BOLETA_ENVIO_PRODUCCION: 'https://rahue.sii.cl/recursos/v1',
} as const;

type Fallo = Exclude<RespuestaSii<never>, { tipo: 'ok' }>;

type Transitorio = { tipo: 'transitorio'; mensaje: string };

type Bruta =
  | { tipo: 'respuesta'; status: number; cuerpo: string; headers: Headers }
  | Transitorio;

const transitorio = (mensaje: string): Transitorio => ({
  tipo: 'transitorio',
  mensaje,
});

/** Lee `<SEMILLA>` o `<TOKEN>` del XML del SII sin depender del prefijo de namespace. */
function leerCampo(
  xml: string,
  campo: 'SEMILLA' | 'TOKEN',
): { valor: string } | Fallo {
  const estado = /<(?:[\w.-]+:)?ESTADO>\s*([^<\s]*)\s*</.exec(xml)?.[1];
  if (estado !== undefined && estado !== '00') {
    const glosa = /<(?:[\w.-]+:)?GLOSA>([^<]*)</.exec(xml)?.[1]?.trim();
    return transitorio(
      `El SII no entregó el ${campo.toLowerCase()} (estado ${estado.slice(0, 20)}${glosa ? `: ${glosa.slice(0, MAX_MENSAJE)}` : ''})`,
    );
  }
  const valor = new RegExp(
    `<(?:[\\w.-]+:)?${campo}>\\s*([^<\\s]+)\\s*</(?:[\\w.-]+:)?${campo}>`,
  ).exec(xml)?.[1];
  return valor
    ? { valor }
    : transitorio(
        `La respuesta del SII no trae el ${campo.toLowerCase()} esperado`,
      );
}

/** El cuerpo como texto, o `null` si pasa de `MAX_CUERPO` (no se guarda; se cancela la lectura). */
async function leerAcotado(r: Response): Promise<string | null> {
  const declarado = Number(r.headers.get('content-length'));
  if (Number.isFinite(declarado) && declarado > MAX_CUERPO) {
    await r.body?.cancel();
    return null;
  }
  const lector = r.body?.getReader();
  if (!lector) return '';
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CUERPO) {
      await lector.cancel();
      return null;
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos).toString('utf8');
}

const MENSAJE_FIRMA =
  'El certificado digital no sirve para firmar; súbalo de nuevo';
const MENSAJE_RUT = 'El RUT del emisor o del certificado no es válido';

/** `[cuerpo, dv]` del RUT normalizado, o `null` si no es un RUT válido. */
function partirRut(rut: string): [string, string] | null {
  return rutValido(rut)
    ? (normalizarRut(rut).split('-') as [string, string])
    : null;
}

/** La causa de una falla de red, sin datos del pedido (nunca el token). */
function describirFalla(e: unknown): string {
  // Por nombre y no por `instanceof`: el DOMException del timeout puede venir de otro contexto.
  const { name, cause } = (e ?? {}) as {
    name?: unknown;
    cause?: { code?: unknown };
  };
  if (name === 'TimeoutError' || name === 'AbortError')
    return 'El SII no respondió a tiempo';
  return typeof cause?.code === 'string'
    ? `No se pudo comunicar con el SII (${cause.code})`
    : 'No se pudo comunicar con el SII';
}

/**
 * Cliente de la API REST de la boleta electrónica del SII: semilla, token, envío del sobre y
 * consulta del envío. `enviar` y `consultarEnvio` devuelven `RespuestaSii` para todo lo que viene
 * del SII, de la red, del certificado (llave que no firma) o de los RUT: quien lo usa decide qué
 * hacer con cada caso (spec cola-envio-sii § 6). Un error de programación sí tira.
 *
 * Ningún mensaje, resultado ni log lleva el token ni la llave del certificado.
 */
@Injectable()
export class SiiBoletaCliente {
  private readonly tokens = new Map<
    string,
    { token: string; usadoEn: number }
  >();
  /** Pedidos de token en vuelo: dos llamadas a la vez comparten uno solo. */
  private readonly obteniendo = new Map<
    string,
    Promise<{ token: string } | Fallo>
  >();
  private pausa = 0;
  private readonly logger = new Logger(SiiBoletaCliente.name);

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(RELOJ_SII)
    private readonly ahora: () => number = Date.now,
  ) {}

  /** ms epoch hasta el que no se le pega al SII (405 o X-RateLimit-Remaining 0). */
  pausadoHasta(): number {
    return this.pausa;
  }

  async enviar(
    ambiente: AmbienteSii,
    cert: CertificadoLeido,
    rutEmisor: string,
    sobre: string,
  ): Promise<RespuestaSii<ResultadoEnvio>> {
    const sender = partirRut(cert.rut);
    const company = partirRut(rutEmisor);
    if (!sender || !company) return transitorio(MENSAJE_RUT);
    const [rutSender, dvSender] = sender;
    const [rutCompany, dvCompany] = company;
    const url = `${this.base(ambiente, 'ENVIO')}/boleta.electronica.envio`;

    const r = await this.conToken(ambiente, cert, (token) => {
      // El FormData se arma de nuevo en cada intento: un cuerpo ya enviado no se reusa.
      const form = new FormData();
      form.set('rutSender', rutSender);
      form.set('dvSender', dvSender);
      form.set('rutCompany', rutCompany);
      form.set('dvCompany', dvCompany);
      form.set(
        'archivo',
        new Blob([new Uint8Array(aLatin1(sobre))], { type: 'text/xml' }),
        'envio.xml',
      );
      return this.pedir(url, { method: 'POST', body: form }, token);
    });

    return this.interpretar(r, (cuerpo) => {
      const datos = this.json(cuerpo);
      const trackid = datos?.trackid;
      if (
        (typeof trackid !== 'number' && typeof trackid !== 'string') ||
        trackid === ''
      )
        return null;
      return {
        trackid: String(trackid),
        estado: typeof datos?.estado === 'string' ? datos.estado : '',
      };
    });
  }

  async consultarEnvio(
    ambiente: AmbienteSii,
    cert: CertificadoLeido,
    rutEmisor: string,
    trackid: string,
  ): Promise<RespuestaSii<EstadoEnvioSii>> {
    const emisor = partirRut(rutEmisor);
    if (!emisor) return transitorio(MENSAJE_RUT);
    const url = `${this.base(ambiente, 'API')}/boleta.electronica.envio/${emisor[0]}-${emisor[1]}-${encodeURIComponent(trackid)}`;

    const r = await this.conToken(ambiente, cert, (token) =>
      this.pedir(url, { method: 'GET' }, token),
    );

    return this.interpretar(r, (cuerpo) => {
      const datos = this.json(cuerpo);
      return typeof datos?.estado === 'string'
        ? (datos as unknown as EstadoEnvioSii)
        : null;
    });
  }

  // ---------------------------------------------------------------- token

  /**
   * Corre `hacer` con un token vigente. Un 401 borra el token, pide otro y reintenta una vez;
   * el segundo 401 se devuelve tal cual.
   */
  private async conToken(
    ambiente: AmbienteSii,
    cert: CertificadoLeido,
    hacer: (token: string) => Promise<Bruta>,
  ): Promise<Bruta | Fallo> {
    const clave = this.claveToken(ambiente, cert);
    let r: Bruta | Fallo = transitorio('Sin respuesta del SII');
    for (let intento = 0; intento < 2; intento++) {
      const t = await this.token(ambiente, cert, clave);
      if ('tipo' in t) return t;
      r = await hacer(t.token);
      if (r.tipo === 'respuesta' && r.status === 401) {
        this.tokens.delete(clave);
        continue;
      }
      if (r.tipo === 'respuesta' && r.status < 300) {
        // Cada uso exitoso renueva la hora de último uso.
        this.tokens.set(clave, { token: t.token, usadoEn: this.ahora() });
      }
      return r;
    }
    return r;
  }

  private claveToken(ambiente: AmbienteSii, cert: CertificadoLeido): string {
    return `${ambiente}:${createHash('sha256').update(cert.certificadoB64).digest('hex')}`;
  }

  private async token(
    ambiente: AmbienteSii,
    cert: CertificadoLeido,
    clave: string,
  ): Promise<{ token: string } | Fallo> {
    const guardado = this.tokens.get(clave);
    if (guardado) {
      if (this.ahora() - guardado.usadoEn < TOKEN_VIGENCIA_MS)
        return { token: guardado.token };
      this.tokens.delete(clave);
    }

    const enVuelo = this.obteniendo.get(clave);
    if (enVuelo) return enVuelo;
    const nuevo = this.pedirToken(ambiente, cert).then((r) => {
      if (!('tipo' in r))
        this.tokens.set(clave, { token: r.token, usadoEn: this.ahora() });
      return r;
    });
    this.obteniendo.set(clave, nuevo);
    try {
      return await nuevo;
    } finally {
      this.obteniendo.delete(clave);
    }
  }

  private async pedirToken(
    ambiente: AmbienteSii,
    cert: CertificadoLeido,
  ): Promise<{ token: string } | Fallo> {
    const api = this.base(ambiente, 'API');

    const s = await this.pedir(`${api}/boleta.electronica.semilla`, {
      method: 'GET',
    });
    const cuerpoSemilla = this.cuerpoDelToken(s);
    if ('tipo' in cuerpoSemilla) return cuerpoSemilla;
    const semilla = leerCampo(cuerpoSemilla.cuerpo, 'SEMILLA');
    if ('tipo' in semilla) return semilla;
    // Va dentro del XML que se firma: solo dígitos.
    if (!/^\d+$/.test(semilla.valor))
      return transitorio(
        'El SII entregó una semilla con un formato inesperado',
      );

    let firmado: string;
    try {
      firmado = firmarDocumento(
        `<?xml version="1.0" encoding="UTF-8"?>\n<getToken><item><Semilla>${semilla.valor}</Semilla></item></getToken>`,
        cert,
      );
    } catch (e) {
      // Solo el nombre y el mensaje del error: nunca el certificado ni la llave.
      const { name, message } = e as Error;
      this.logger.warn(`No se pudo firmar el getToken: ${name}: ${message}`);
      return transitorio(MENSAJE_FIRMA);
    }
    const t = await this.pedir(`${api}/boleta.electronica.token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: firmado,
    });
    const cuerpoToken = this.cuerpoDelToken(t);
    if ('tipo' in cuerpoToken) return cuerpoToken;
    const token = leerCampo(cuerpoToken.cuerpo, 'TOKEN');
    return 'tipo' in token ? token : { token: token.valor };
  }

  /** El cuerpo de una respuesta de semilla o token, o por qué no sirve. */
  private cuerpoDelToken(r: Bruta): { cuerpo: string } | Fallo {
    if (r.tipo === 'transitorio') return r;
    if (r.status < 300) return { cuerpo: r.cuerpo };
    // 400, 401 y 403 al pedir el token: el SII no acepta nuestra firma ni el certificado.
    if ([400, 401, 403].includes(r.status)) return { tipo: 'no_autorizado' };
    return transitorio(this.mensajeDeStatus(r.status));
  }

  // ----------------------------------------------------------------- HTTP

  private base(ambiente: AmbienteSii, servidor: 'API' | 'ENVIO'): string {
    const sufijo = ambiente === 'produccion' ? 'PRODUCCION' : 'CERTIFICACION';
    const nombre = `SII_BOLETA_${servidor}_${sufijo}` as const;
    const url = this.config.get<string>(nombre) || URLS_POR_DEFECTO[nombre];
    return url.replace(/\/+$/, '');
  }

  private respuestaPausada(): Transitorio | null {
    const falta = this.pausa - this.ahora();
    return falta > 0
      ? transitorio(
          `El SII pidió espaciar los pedidos; se reintenta en ${Math.ceil(falta / 1000)} s`,
        )
      : null;
  }

  /** Un pedido al SII: respeta la pausa, pone el timeout y anota los límites de la respuesta. */
  private async pedir(
    url: string,
    init: RequestInit,
    token?: string,
  ): Promise<Bruta> {
    const pausado = this.respuestaPausada();
    if (pausado) return pausado;
    try {
      const headers = new Headers(init.headers);
      headers.set('User-Agent', USER_AGENT);
      if (token) headers.set('Cookie', `TOKEN=${token}`);
      const r = await fetch(url, {
        ...init,
        headers,
        // La cookie con el token no debe seguir un redirect: se trata como falla.
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      this.anotarLimite(r.status, r.headers);
      const cuerpo = await leerAcotado(r);
      if (cuerpo === null)
        return transitorio('La respuesta del SII es demasiado grande');
      return {
        tipo: 'respuesta',
        status: r.status,
        cuerpo,
        headers: r.headers,
      };
    } catch (e) {
      return transitorio(describirFalla(e));
    }
  }

  /**
   * Un 405 o `X-RateLimit-Remaining: 0` pausa al cliente hasta `X-RateLimit-Reset`: segundos de
   * espera, o (si pasa de 1e9) la hora epoch en segundos. Sin un valor útil, 60 s; nunca más de 1 h.
   */
  private anotarLimite(status: number, headers: Headers): void {
    const restante = headers.get('x-ratelimit-remaining')?.trim();
    const agotado =
      restante !== undefined &&
      /^\d+$/.test(restante) &&
      Number(restante) === 0;
    if (status !== 405 && !agotado) return;

    const texto = headers.get('x-ratelimit-reset')?.trim();
    let segundos = PAUSA_POR_DEFECTO_S;
    if (texto && /^\d+$/.test(texto)) {
      const valor = Number(texto);
      const espera = valor > 1e9 ? valor - this.ahora() / 1000 : valor;
      if (espera > 0) segundos = espera;
    }
    this.pausa = Math.max(
      this.pausa,
      this.ahora() + Math.min(segundos, PAUSA_MAXIMA_S) * 1000,
    );
  }

  private mensajeDeStatus(status: number): string {
    return status === 405
      ? 'El SII limitó los pedidos de este servidor'
      : `El SII respondió con el código ${status}`;
  }

  private json(cuerpo: string): Record<string, unknown> | null {
    try {
      const datos: unknown = JSON.parse(cuerpo);
      return datos && typeof datos === 'object'
        ? (datos as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private interpretar<T>(
    r: Bruta | Fallo,
    extraer: (cuerpo: string) => T | null,
  ): RespuestaSii<T> {
    if (r.tipo !== 'respuesta') return r;
    if (r.status >= 200 && r.status < 300) {
      const datos = extraer(r.cuerpo);
      if (datos === null)
        return transitorio('El SII contestó con un formato inesperado');
      const espera = Number(r.headers.get('x-retry-after'));
      return {
        tipo: 'ok',
        datos,
        reintentarEnMs:
          r.headers.get('x-retry-after') !== null &&
          Number.isFinite(espera) &&
          espera >= 0
            ? espera * 1000
            : null,
      };
    }
    switch (r.status) {
      case 400:
        return {
          tipo: 'peticion_invalida',
          mensaje:
            r.cuerpo.trim().slice(0, MAX_MENSAJE) || 'El SII rechazó el pedido',
        };
      case 401:
        return { tipo: 'no_autorizado' };
      case 404:
        return { tipo: 'no_encontrado' };
      default:
        return transitorio(this.mensajeDeStatus(r.status));
    }
  }
}
