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
 * EL ARREGLO
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Que el bind coincida con la dirección a la que se habla: `listen(0, '127.0.0.1')`.
 * Ahí el puerto ocupado **sí** da conflicto y el sistema entrega otro libre, en
 * vez de dejarnos con uno que contesta otro. Se parchea `serverAddress` en vez
 * de cada spec: son 50 y ninguno tiene por qué saber esto.
 *
 * ⚠️ **No se arregla cerrando Battle.net.** Hoy es ése; mañana es cualquier
 * programa que escuche en el rango efímero, y el síntoma vuelve sin relación
 * aparente con nada.
 */
import { appendFileSync } from 'fs';
import { resolve } from 'path';
import supertest from 'supertest';

const ARCHIVO = resolve(__dirname, 'tmp-401.jsonl');

interface TestSupertest {
  serverAddress: (app: AppConDireccion, path: string) => string;
}
interface AppConDireccion {
  address: () => { port: number } | null;
  listen: (puerto: number, host?: string) => unknown;
}

const Test = (supertest as unknown as { Test: { prototype: TestSupertest } })
  .Test;

const direccionOriginal = Test.prototype.serverAddress;
Test.prototype.serverAddress = function (
  this: { _server?: unknown },
  app: AppConDireccion,
  path: string,
): string {
  // Adelantarse al `listen(0)` pelado de supertest: si el server todavía no
  // escucha, lo levantamos nosotros atado a 127.0.0.1. Después su `if (!addr)`
  // ya no se cumple y el resto de su lógica corre igual.
  if (!app.address()) app.listen(0, '127.0.0.1');
  return direccionOriginal.call(this, app, path);
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
        // La ruta, no la URL: supertest levanta un puerto efímero por request
        // (`http://127.0.0.1:54028/api/…`), así que comparar contra la URL
        // entera marcaba como sospechoso hasta un 401 esperado. Medido al
        // estrenar esto: los 3 legítimos de `rbac-y-contrasena` salían
        // marcados, o sea el filtro no filtraba nada.
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
