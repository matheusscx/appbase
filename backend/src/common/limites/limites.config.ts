import { type ExecutionContext, Logger, SetMetadata } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { ipDelCliente, type ConfigIpDelCliente } from './ip-del-cliente';

/**
 * Los límites de intentos del sistema, en un solo lugar (ADR-032).
 *
 * Cada número lo decidió el owner o la orquestadora el 2026-10-13 sobre lo
 * medido (una venta de 3 líneas son ~8 requests; el peor caso de una persona,
 * ~55-70 por minuto): está en el ADR, con su porqué. Acá vive **cuánto** y
 * **por qué clave**; las ventanas son fijas y los conteos salen de una
 * variable de entorno, para subirlos en Railway sin tocar código.
 */

/** Rutas con un límite propio, además del global. */
export type LimiteDeRuta = 'login' | 'refresh' | 'correo' | 'token';

const META_RUTA = 'limites:ruta';
const META_SIN_LIMITE = 'limites:sin-limite';

/** Suma a la ruta los límites propios de `nombres`, además del global. */
export const Limite = (...nombres: LimiteDeRuta[]) =>
  SetMetadata(META_RUTA, nombres);

/**
 * La ruta no cuenta para ningún límite. Solo `/api/health`: el healthcheck de
 * Railway pega desde una IP compartida durante el deploy, y la ruta ya se
 * defiende sola (ventana de 2 s + single-flight, `app.service.ts`).
 */
export const SinLimite = () => SetMetadata(META_SIN_LIMITE, true);

/**
 * Un conteo del entorno, por la escala. `LIMITES_ESCALA` existe para los
 * entornos de prueba: el e2e y Playwright entran cientos de veces con el mismo
 * admin y se chocarían con el límite de login en el primer minuto. En
 * producción no se define y vale 1.
 */
export function leerLimite(
  config: ConfigService,
  variable: string,
  porDefecto: number,
): number {
  const escala = numeroPositivo(config.get<string>('LIMITES_ESCALA')) ?? 1;
  return (numeroPositivo(config.get<string>(variable)) ?? porDefecto) * escala;
}

function numeroPositivo(valor: string | undefined): number | null {
  if (valor === undefined || valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const MINUTO = 60_000;

interface Definicion {
  nombre: string;
  variable: string;
  porDefecto: number;
  ventanaMs: number;
  /** Sin `ruta`, el límite es global; con `ruta`, solo donde la pide `@Limite`. */
  ruta?: LimiteDeRuta;
  /** Solo para los globales: a quién le toca. */
  aplica?: (identidad: string | null) => boolean;
  clave: (req: Request, contexto: Contexto) => string;
  /**
   * Sin `X-RateLimit-*` en la respuesta. Para los límites por correo: el
   * `Remaining` le contaría a cualquiera cuánta actividad tuvo una casilla ajena.
   * `Retry-After` sale igual, al chocar.
   */
  sinCabeceras?: boolean;
}

interface Contexto {
  ip: () => string;
  identidad: () => string | null;
}

const DEFINICIONES: Definicion[] = [
  {
    // P1 del owner: "100 por minuto por persona".
    nombre: 'usuario',
    variable: 'LIMITE_USUARIO_POR_MINUTO',
    porDefecto: 100,
    ventanaMs: MINUTO,
    aplica: (identidad) => identidad !== null,
    clave: (_req, c) => `usuario:${c.identidad()}`,
  },
  {
    nombre: 'anonimo',
    variable: 'LIMITE_ANONIMO_POR_MINUTO',
    porDefecto: 30,
    ventanaMs: MINUTO,
    aplica: (identidad) => identidad === null,
    clave: (_req, c) => `ip:${c.ip()}`,
  },
  // ⚠️ El orden entre límites de la misma ventana ES la evaluación (la librería
  // los ordena por ventana, de forma estable) y el primero que bloquea corta.
  // El de IP va antes que el de correo a propósito: una IP ya bloqueada no
  // llega a crear una clave por cada correo que invente, que es lo que
  // acota la memoria frente a quien rota correos.
  {
    nombre: 'login-ip',
    variable: 'LIMITE_LOGIN_POR_IP',
    porDefecto: 30,
    ventanaMs: 15 * MINUTO,
    ruta: 'login',
    clave: (_req, c) => `ip:${c.ip()}`,
  },
  {
    // P3 del owner: "10 intentos cada 15 min", por correo.
    nombre: 'login-correo',
    variable: 'LIMITE_LOGIN_POR_CORREO',
    porDefecto: 10,
    ventanaMs: 15 * MINUTO,
    ruta: 'login',
    clave: (req) => `correo:${correoDelLogin(req)}`,
    sinCabeceras: true,
  },
  {
    nombre: 'refresh',
    variable: 'LIMITE_REFRESH_POR_MINUTO',
    porDefecto: 20,
    ventanaMs: MINUTO,
    ruta: 'refresh',
    clave: (_req, c) => `ip:${c.ip()}`,
  },
  {
    nombre: 'correo-ip',
    variable: 'LIMITE_CORREO_POR_IP',
    porDefecto: 10,
    ventanaMs: 60 * MINUTO,
    ruta: 'correo',
    clave: (_req, c) => `ip:${c.ip()}`,
  },
  {
    // El daño de `recuperar` es bombardear una casilla ajena: se frena por
    // destino. `register` manda el mismo tipo de correo y lleva el mismo límite.
    nombre: 'correo-destino',
    variable: 'LIMITE_CORREO_POR_DESTINO',
    porDefecto: 3,
    ventanaMs: 60 * MINUTO,
    ruta: 'correo',
    clave: (req) => `correo:${correoDelBody(req, 'correo')}`,
    sinCabeceras: true,
  },
  {
    nombre: 'token',
    variable: 'LIMITE_TOKEN_POR_MINUTO',
    porDefecto: 10,
    ventanaMs: MINUTO,
    ruta: 'token',
    clave: (_req, c) => `ip:${c.ip()}`,
  },
];

/**
 * Un correo como clave de límite. Puede no ser string: el guard corre antes que
 * el pipe.
 *
 * Fuera de ASCII van todos al mismo balde. La búsqueda del usuario compara con
 * `LOWER()` de Postgres, que minusculiza distinto que JavaScript (`İ` da `i` en
 * la base y `i̇` acá), así que una variante con esas letras encontraría la misma
 * cuenta y caería en un balde nuevo: con n letras, 2^n baldes para una casilla.
 */
function normalizarCorreo(valor: unknown): string {
  if (typeof valor !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(valor)) return 'fuera-de-ascii';
  return valor.trim().toLowerCase();
}

/** `recuperar` y `register` leen el correo solo del body, por su DTO. */
function correoDelBody(req: Request, campo: string): string {
  return normalizarCorreo(
    (req.body as Record<string, unknown> | undefined)?.[campo],
  );
}

/**
 * El correo contra el que `login` va a autenticar, leído **como lo lee
 * passport-local**: el `email` del body si es un escalar no vacío, y si no, el
 * de la query (`lookup(req.body) || lookup(req.query)`, con `usernameField:
 * 'email'`). Mirar solo el body dejaba autenticar contra la víctima con
 * `?email=` y un body sin `email`, contando el intento en otro balde (lo
 * encontró la revisión de seguridad).
 */
function correoDelLogin(req: Request): string {
  // Como `lookup` de passport-local: un objeto no cuenta, y el `||` mira la
  // verdad del valor original (un `0` o un `false` en el body pasan a la query).
  const escalar = (fuente: unknown): string | null => {
    const v = (fuente as Record<string, unknown> | undefined)?.email;
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    )
      return v ? String(v) : null;
    return null;
  };
  return normalizarCorreo(escalar(req.body) ?? escalar(req.query) ?? '');
}

const IDENTIDAD = Symbol('limites:identidad');

/**
 * El usuario del access token, **con la firma verificada**, o `null`.
 *
 * El guard de límites es global y corre antes que `JwtAuthGuard`, así que
 * `req.user` todavía no existe. Leer el `sub` sin verificar sería regalarle el
 * límite a cualquiera: cambia el `sub` en cada request y estrena balde. Por eso
 * se verifica con el mismo secreto que el JWT de la app.
 *
 * Un token **vencido pero bien firmado** sigue identificando a su usuario: es el
 * request que dispara el refresh, y contarlo por IP lo mandaría al balde
 * anónimo, que con el proxy delante es compartido.
 */
function identidadDe(
  req: Request,
  jwt: JwtService,
  secreto: string,
): string | null {
  const cache = req as unknown as Record<symbol, string | null | undefined>;
  if (cache[IDENTIDAD] !== undefined) return cache[IDENTIDAD];
  let identidad: string | null = null;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify<{ sub?: unknown }>(auth.slice(7), {
        secret: secreto,
        ignoreExpiration: true,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub === 'string' && payload.sub)
        identidad = payload.sub;
    } catch {
      identidad = null;
    }
  }
  cache[IDENTIDAD] = identidad;
  return identidad;
}

function rutaDe(contexto: ExecutionContext): {
  rutas: LimiteDeRuta[];
  sinLimite: boolean;
} {
  const handler = contexto.getHandler();
  const clase = contexto.getClass();
  const leer = <T>(clave: string): T | undefined =>
    (Reflect.getMetadata(clave, handler) as T | undefined) ??
    (Reflect.getMetadata(clave, clase) as T | undefined);
  return {
    rutas: leer<LimiteDeRuta[]>(META_RUTA) ?? [],
    sinLimite: leer<boolean>(META_SIN_LIMITE) ?? false,
  };
}

/** Los throttlers que arma `ThrottlerModule.forRootAsync`, leyendo el entorno. */
export function construirThrottlers(config: ConfigService): ThrottlerOptions[] {
  const jwt = new JwtService({});
  const secreto = config.get<string>('JWT_SECRET') ?? '';
  const configIp: ConfigIpDelCliente = {
    secretoProxy: config.get<string>('PROXY_SECRETO') || undefined,
    cabeceraBorde: config.get<string>('IP_CABECERA_BORDE') || undefined,
  };

  const throttlers = DEFINICIONES.map((d): ThrottlerOptions => {
    const limite = leerLimite(config, d.variable, d.porDefecto);
    return {
      name: d.nombre,
      limit: limite,
      ttl: d.ventanaMs,
      skipIf: (contexto) => {
        const { rutas, sinLimite } = rutaDe(contexto);
        if (sinLimite) return true;
        if (d.ruta) return !rutas.includes(d.ruta);
        const req = contexto.switchToHttp().getRequest<Request>();
        return !d.aplica!(identidadDe(req, jwt, secreto));
      },
      getTracker: (req) => {
        const r = req as Request;
        return d.clave(r, {
          ip: () => ipDelCliente(r, configIp),
          identidad: () => identidadDe(r, jwt, secreto),
        });
      },
      ...(d.sinCabeceras ? { setHeaders: false } : {}),
      // La clave por defecto de la librería incluye controlador y handler: el
      // límite "por persona" sería por persona Y por ruta, o sea 100 por cada
      // endpoint. Acá la clave es solo el límite y a quién se le cuenta.
      generateKey: (_contexto, tracker, nombre) =>
        createHash('sha256').update(`${nombre}|${tracker}`).digest('hex'),
    };
  });

  const escala = config.get<string>('LIMITES_ESCALA');
  if (escala !== undefined && escala.trim() !== '' && Number(escala) !== 1) {
    new Logger('Limites').warn(
      `LIMITES_ESCALA=${escala}: los límites están multiplicados. Es para pruebas y desarrollo; en producción no se define.`,
    );
  }
  new Logger('Limites').log(
    throttlers.map((t) => `${t.name}=${String(t.limit)}`).join(' ') +
      ` · proxy con secreto: ${configIp.secretoProxy ? 'sí' : 'no'}` +
      ` · cabecera del borde: ${configIp.cabeceraBorde ?? 'ninguna'}`,
  );
  return throttlers;
}

/** Lo que lee el cliente al chocar un límite. Sin reintento automático: lo decide él. */
export function mensajeDeLimite(nombre: string, segundos: number): string {
  const espera =
    segundos < 120
      ? `${segundos} segundos`
      : `${Math.ceil(segundos / 60)} minutos`;
  if (nombre.startsWith('login-')) {
    return `Demasiados intentos de ingreso. Probá de nuevo en ${espera} o recuperá tu contraseña.`;
  }
  if (nombre.startsWith('correo-')) {
    return `Ya se enviaron varios correos seguidos. Esperá ${espera} antes de pedir otro.`;
  }
  return `Demasiadas solicitudes seguidas. Esperá ${espera} y volvé a intentar.`;
}
