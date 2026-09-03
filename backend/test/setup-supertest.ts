/**
 * Dos cosas sobre el mismo intermitente, y por eso viven juntas: **el arreglo**
 * del `401` fantasma del e2e, y **la caja negra** que lo cazó y queda de red.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CAUSA, medida el 2026-08-25 después de seis avistajes en cuatro specs
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **No era un bug del proyecto: era otro proceso de la máquina contestando por
 * nosotros.** `supertest` bindea una dirección y le habla a otra
 * (`node_modules/supertest/lib/test.js:60-70`):
 *
 * ```js
 * if (!addr) this._server = app.listen(0);          // bindea el WILDCARD (::)
 * return protocol + '://127.0.0.1:' + port + path;  // pero direcciona 127.0.0.1
 * ```
 *
 * En macOS eso abre un hueco: un bind al wildcard **convive** con un bind ajeno
 * a `127.0.0.1` en el mismo puerto —no da `EADDRINUSE`—, y una conexión a
 * `127.0.0.1` se la lleva **el bind más específico**, o sea el ajeno. Como
 * `listen(0)` saca puertos del rango efímero (49152-65535 acá), alcanza con que
 * cualquier programa escuche ahí adentro.
 *
 * En esta máquina era el agente de Battle.net en `127.0.0.1:56561`, y su
 * respuesta a cualquier cosa es, textual:
 *
 * ```
 * HTTP/1.1 401 Unauthorized
 * Content-Length: 0
 * Connection: close
 * ```
 *
 * Idéntica a lo capturado. Eso explica **todo** lo que la entrada del backlog
 * no podía: un `401` en `POST /auth/register`, que no tiene guard ni rama de
 * 401 (el request nunca llegó a la app); el token válido rechazado (la app
 * nunca lo vio); el spec distinto cada vez (el que pidiera algo justo después);
 * y el verde al repetir (otro puerto). También el `TypeError: body.find is not
 * a function` del avistaje de `caja`: un body vacío no es un array.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EL ARREGLO — segunda versión. La primera NO cerraba nada.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Que el bind coincida con la dirección a la que se habla: `127.0.0.1`. Ahí el
 * puerto ocupado **sí** da conflicto y el sistema entrega otro libre, en vez de
 * dejarnos con uno que contesta otro.
 *
 * ⛔ **La primera versión parcheaba `Test.prototype.serverAddress`** —
 * `if (!app.address()) app.listen(0, '127.0.0.1')` antes de delegar— y se dio
 * por buena razonando que después de eso `app.address()` ya no sería null. **Es
 * falso, y medido** (node v22.18):
 *
 * ```
 * listen(0)             -> address() inmediato: {"address":"::",...}
 * listen(0,'127.0.0.1') -> address() inmediato: null
 *   ...tras setImmediate:                       {"address":"127.0.0.1",...}
 * ```
 *
 * `listen` con host pasa por `dns.lookup` y **bindea asincrónicamente**. Así que
 * en el mismo tick `serverAddress` seguía viendo `null`, hacía su
 * `this._server = app.listen(0)` —**wildcard, y sincrónico**— y ganaba la
 * carrera; cuando el lookup volvía, el handle ya existía y su bind era un no-op.
 * Medido sobre la secuencia exacta: el server terminaba en `::`. O sea el estado
 * vulnerable, con el parche puesto. Y como supertest cierra el server que él
 * levantó (`test/…/test.js:141`), el sorteo de puerto se repetía **en cada
 * request**, no una vez por archivo. Por eso el `401` volvió a las pocas horas,
 * en cuatro specs distintos el mismo día.
 *
 * ✅ **Esta versión bindea donde SÍ se puede esperar el bind: `app.init()`**, que
 * es async y que los 50 specs ya hacen `await`. Con la dirección puesta antes del
 * primer request, el `if (!addr)` de supertest no se cumple nunca, `_server`
 * queda `undefined` y el server no se cierra ni se re-bindea en toda la corrida.
 * No hay carrera que perder porque no hay nada sincrónico compitiendo.
 *
 * 📌 La red está en `app.e2e-spec.ts` y afirma sobre `address()`, el **estado**.
 * El test anterior espiaba la **llamada** (`toHaveBeenCalledWith(0,'127.0.0.1')`)
 * y por eso estuvo verde todo el tiempo que el arreglo no funcionó.
 *
 * ⚠️ **No se arregla cerrando Battle.net.** Hoy es ése; mañana es cualquier
 * programa que escuche en el rango efímero, y el síntoma vuelve sin relación
 * aparente con nada.
 */
import { appendFileSync } from 'fs';
import { type Server } from 'http';
import { resolve } from 'path';
import supertest from 'supertest';
import { NestApplication } from '@nestjs/core';

const ARCHIVO = resolve(__dirname, 'tmp-401.jsonl');

const initOriginal = NestApplication.prototype.init;

NestApplication.prototype.init = async function (
  this: NestApplication,
): Promise<NestApplication> {
  const app = (await initOriginal.call(this)) as NestApplication;
  const server = this.getHttpServer() as Server | undefined;
  // `listening` es el guard de idempotencia: `init()` es idempotente en Nest y
  // un segundo bind tiraría ERR_SERVER_ALREADY_LISTEN.
  if (server && typeof server.listen === 'function' && !server.listening) {
    await new Promise<void>((listo, falla) => {
      const alFallar = (e: Error) => falla(e);
      server.once('error', alFallar);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', alFallar);
        listo();
      });
    });
  }
  return app;
};

/**
 * Rutas donde un 401 es el resultado ESPERADO de un test. Se registran igual
 * —el archivo es el registro completo, no un filtro— pero salen marcadas
 * `sospechoso: false` para que el grep de arriba no las devuelva.
 *
 * Es una lista de rutas, no de specs, a propósito: lo que hace legítimo al 401
 * es la ruta que se pidió, no quién la pidió.
 */
const ESPERAN_401 = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/switch-tenant',
  '/api/me/contrasena',
];

interface ReqSupertest {
  method?: string;
  url?: string;
  _header?: Record<string, any>;
  header?: Record<string, any>;
}

const proto = (supertest as any).Test.prototype as {
  end: (fn?: (err: unknown, res: any) => void) => unknown;
};
const endOriginal = proto.end;

proto.end = function (
  this: ReqSupertest,
  fn?: (err: unknown, res: any) => void,
) {
  return endOriginal.call(this, (err: unknown, res: any) => {
    try {
      if (res && res.status === 401) {
        const url: string = this.url ?? '';
        // La ruta, no la URL: la URL trae el puerto (`http://127.0.0.1:54028/api/…`)
        // y comparar contra ella entera marcaba como sospechoso hasta un 401
        // esperado. Medido al estrenar esto: los 3 legítimos de
        // `rbac-y-contrasena` salían marcados, o sea el filtro no filtraba nada.
        // ℹ️ La premisa original era "supertest levanta un puerto efímero por
        // request", y desde el parche de `init()` **ya no es cierta**: el puerto
        // es uno por app. La conclusión no cambia —sigue variando entre archivos
        // y entre corridas—, pero el motivo sí.
        let ruta = url;
        try {
          ruta = new URL(url).pathname;
        } catch {
          // URL relativa: ya es la ruta.
        }
        const enviados = this.header ?? {};
        appendFileSync(
          ARCHIVO,
          JSON.stringify({
            // El instante importa: dos avistajes cayeron en el mismo spec, y
            // saber si fue al principio o al final de la corrida acota.
            t: new Date().toISOString(),
            test: expect.getState().currentTestName ?? '(fuera de un test)',
            metodo: this.method,
            url,
            ruta,
            sospechoso: !ESPERAN_401.includes(ruta),
            // El body es el discriminador: `error: 'Unauthorized'` presente
            // significa que lo tiró código de la app, ausente que lo tiró
            // Passport. Ver la tabla del docblock.
            // status-tolerante: diagnóstico del 401 anómalo: reporta el body, no lo consume
            body: res.body,
            // ⚠️ Agregados el 2026-08-25, después de la PRIMERA captura: el 401
            // anómalo vino con `body: {}` **vacío**, que no es ninguna de las dos
            // formas de la tabla de arriba —Nest siempre serializa la excepción a
            // JSON—. O sea que no salió de la capa de excepciones, y para saber de
            // dónde salió hace falta el sobre, no el contenido: `content-type`
            // ausente dice `res.end()` pelado, y `www-authenticate` dice Passport.
            texto: typeof res.text === 'string' ? res.text.slice(0, 300) : null,
            // ⚠️ TODOS los headers desde el 2026-08-25, tras la segunda captura.
            // La primera tanda de cuatro ya descartó Passport (`www-authenticate`
            // ausente) y JSON (`content-type` ausente, `content-length: 0`), pero
            // el que decide es **`x-powered-by`**: Express lo pone en TODA
            // respuesta suya. Si falta, la respuesta no pasó por Express, y
            // entonces no la escribió esta app.
            headers: res.headers ?? null,
            // Node marca `reusedSocket` cuando el request salió por un socket
            // reciclado del pool de keep-alive. Es la medición que separa "el
            // servidor contestó 401" de "el request se escribió sobre un socket
            // que el servidor estaba cerrando": el segundo explicaría un 401 que
            // ninguna capa de la app produce, y `connection: close` en la captura
            // anterior apunta para ese lado.
            socketReciclado:
              (this as { req?: { reusedSocket?: boolean } }).req
                ?.reusedSocket ?? null,
            // Nunca el token: solo si viajaba uno y de qué largo. Alcanza para
            // distinguir "no mandó nada" de "mandó `Bearer undefined`" (que
            // fue la causa que esta entrada dio por buena y resultó falsa).
            autorizacion:
              typeof enviados.Authorization === 'string'
                ? `presente(len=${enviados.Authorization.length})`
                : 'ausente',
            cookie: enviados.Cookie ? 'presente' : 'ausente',
          }) + '\n',
        );
      }
    } catch {
      // Un diagnóstico jamás puede romper la corrida que está observando.
    }
    if (fn) fn(err, res);
  });
};
