import { type INestApplication, Logger } from '@nestjs/common';
import helmet from 'helmet';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

/**
 * Lo que `main.ts` le pone a la app antes de escuchar. Vive aparte porque
 * `main.ts` no se puede importar sin arrancar la app, y así lo prueban por
 * unidad `arranque.spec.ts` y, de punta a punta, `test/arranque.e2e-spec.ts`,
 * que corre el `main.ts` real en un proceso hijo (el resto del e2e arma su app
 * sin pasar por `main.ts`).
 */

const ORIGEN_DEV = 'http://localhost:5173';

/**
 * Orígenes a los que el navegador puede leerles las respuestas por CORS.
 *
 * `CORS_ORIGINS` (coma-separado) manda; sin ella queda el origen de
 * `FRONTEND_URL`, que es lo que había antes de la lista: para un navegador, un
 * despliegue con `FRONTEND_URL=https://host` se comporta igual que antes. Tres
 * valores sí cambian, los tres para mejor: vacía y `'*'`, que el paquete `cors`
 * volvía `Access-Control-Allow-Origin: *`, ahora son el frontend de desarrollo
 * y un origen que no coincide con nada; y con ruta o barra final, que antes no
 * coincidía nunca con un `Origin`, ahora sí.
 *
 * `CORS_ORIGINS` se rechaza al arrancar si trae algo que nunca va a matchear, en
 * vez de dejar una lista que no deja pasar a nadie sin avisar: `'*'` no vale
 * con `credentials: true` (el paquete `cors` compara igualdad exacta, así que
 * no sería comodín sino un origen imposible), y un origen con ruta o barra
 * final tampoco, porque el navegador manda el `Origin` sin ellas.
 * `FRONTEND_URL` no se exige así: es la base de los links de los mails y de
 * los retornos de pago, y puede traer ruta; de ella se toma el origen. Y nunca
 * frena el arranque: si no tiene origen se usa tal cual, con un aviso en el
 * log; no coincide con ningún `Origin`, que para un navegador es lo mismo que
 * antes. Un valor que hoy anda en un despliegue no puede volverse un deploy que
 * no arranca por este cambio.
 */
export function origenesCors(env: NodeJS.ProcessEnv = process.env): string[] {
  const lista = (env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (lista.length === 0) {
    const frontend = env.FRONTEND_URL || ORIGEN_DEV;
    const origen = origenDe(frontend);
    if (origen) return [origen];
    new Logger('Cors').warn(
      `FRONTEND_URL "${frontend}" no tiene origen http(s): CORS no va a reflejar ningún navegador. Definí CORS_ORIGINS.`,
    );
    return [frontend];
  }
  for (const origen of lista) {
    // `*` pasa por `new URL` como carácter de host (`https://*.x.cl`), y
    // compararía literal: ni comodín ni nadie permitido.
    if (origen.includes('*') || origenDe(origen) !== origen)
      throw new Error(
        `CORS_ORIGINS: "${origen}" no es un origen (esquema://host[:puerto], sin ruta ni barra final, sin '*')`,
      );
  }
  return lista;
}

/**
 * El origen http(s) de una URL, o `null` si no lo tiene: no parsea, o es de
 * otro esquema (`ws:`, `ftp:`, o `localhost:5173`, que se lee como esquema).
 * Un navegador no manda como `Origin` de una página nada que no sea http(s).
 */
function origenDe(url: string): string | null {
  try {
    const { origin, protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Cabeceras de seguridad y CORS por lista.
 *
 * CORS no es el candado (lo es el JWT) ni está en el camino de la app: desde
 * ADR-022 el navegador habla con el origen del frontend, que reenvía `/api`.
 * Es defensa en profundidad para lo que pegue directo a la API. Un origen que
 * no está en la lista no se rechaza: el request se atiende igual y la respuesta
 * sale sin `Access-Control-Allow-Origin`, así que el navegador no deja leerla.
 * Por eso no rompe ni el proxy (server-to-server) ni el retorno de Webpay (un
 * POST de navegación desde el dominio de Transbank).
 */
export function instalarSeguridadHttp(app: INestApplication): void {
  app.use(helmet());
  app.enableCors({ origin: origenesCors(), credentials: true });
}

const SENALES_DE_APAGADO = ['SIGTERM', 'SIGINT'] as const;

/**
 * Tope para el apagado: si algo en vuelo no termina (un request colgado, el
 * deadlock de ADR-020), el proceso sale igual en vez de quedar vivo. En Railway
 * lo cortaría el SIGKILL al vencer `drainingSeconds` (`railway.json`, 30 s);
 * este tope va por debajo para que la salida sea la nuestra, con log, y para
 * que `nest start --watch` —que espera a que el proceso viejo muera antes de
 * levantar el nuevo— no quede trabado en desarrollo.
 */
export const TOPE_APAGADO_MS = 25_000;

/**
 * Apagado ordenado al recibir SIGTERM (deploy de Railway) o SIGINT (Ctrl+C).
 * Nest deja de aceptar conexiones, espera los requests en vuelo, corre los
 * hooks de apagado (el pool de TypeORM cierra último) y sale.
 *
 * `useProcessExit`: sin él Nest, al terminar, se reenvía la señal a sí mismo
 * para morir, y en el contenedor de producción `node` es el PID 1
 * (`Dockerfile.prod`), que ignora una señal sin handler (medido el 2026-10-11:
 * `node:22-alpine` como PID 1 seguía vivo 3 s después de un SIGTERM). Morir
 * dependería entonces de que nada deje vivo el event loop; `process.exit` no.
 *
 * `Connection: close` desde la señal: `server.close()` espera a que se cierren
 * TODAS las conexiones, y la respuesta en vuelo sale por defecto con
 * `keep-alive`. Con un cliente que reusa sockets —el proxy del frontend lo
 * hace— el proceso quedaba vivo después de contestar hasta que el cliente
 * soltara el socket (medido: 5 s más tarde seguía vivo). Marcándola `close`, el
 * cliente sabe que no puede reusarlo y el socket se cierra al terminar. Vale
 * también para lo que entre por una conexión ya abierta mientras corren los
 * hooks previos al cierre del servidor.
 */
export function habilitarApagadoOrdenado(app: INestApplication): void {
  app.enableShutdownHooks([...SENALES_DE_APAGADO], { useProcessExit: true });

  const servidor = app.getHttpServer() as Server;
  const enVuelo = new Set<ServerResponse>();
  let apagando = false;
  const cerrarAlTerminar = (res: ServerResponse) => {
    if (!res.headersSent) res.setHeader('Connection', 'close');
  };
  servidor.on('request', (_req: IncomingMessage, res: ServerResponse) => {
    if (apagando) return cerrarAlTerminar(res);
    enVuelo.add(res);
    res.once('close', () => enVuelo.delete(res));
  });

  const logger = new Logger('Apagado');
  for (const senal of SENALES_DE_APAGADO) {
    process.once(senal, () => {
      logger.log(`${senal} recibida: apagado ordenado`);
      apagando = true;
      enVuelo.forEach(cerrarAlTerminar);
      setTimeout(() => {
        logger.error(
          `El apagado no terminó en ${TOPE_APAGADO_MS} ms: salida forzada`,
        );
        process.exit(1);
      }, TOPE_APAGADO_MS).unref();
    });
  }
}
