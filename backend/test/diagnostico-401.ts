/**
 * Caja negra del `401` intermitente del e2e (`docs/agent/pendientes.md` § 2).
 *
 * **Por qué existe.** Ese intermitente lleva cinco avistajes en cuatro specs
 * distintos y sigue sin explicación. De los cinco, ninguno registró **el body**
 * de la respuesta — solo el status —, y el body es justamente lo que dice quién
 * tiró el 401:
 *
 * | Body | Quién lo tiró |
 * |---|---|
 * | `{ message: 'Unauthorized', statusCode: 401 }` — **sin** `error` | Passport: un guard, sin pasar por código propio |
 * | `{ message: '<texto>', error: 'Unauthorized', statusCode: 401 }` | código de la app (`UnauthorizedException('…')`) |
 *
 * La distinción no es cosmética: uno de los avistajes fue un `401` en
 * `POST /auth/register`, que **no tiene `@UseGuards` ni rama de 401**
 * (verificado el 2026-08-24 contra `auth.controller.ts:63` y
 * `auth.service.ts:143`). Si el próximo trae el body, se sabe de una si la
 * respuesta salió de un guard, de la app, o de ningún lado.
 *
 * **No afirma nada y no falla nunca**: solo escribe. Un diagnóstico que puede
 * tumbar la suite no sirve para perseguir un intermitente, porque cambia lo que
 * se está midiendo.
 *
 * Se registra en `jest-e2e.json` como `setupFilesAfterEnv`, así que **no hay que
 * tocar ningún spec**: parchea el `end` de supertest, por donde pasan también
 * los `await` (el `then` de supertest llama a `end`).
 *
 * Lo escrito va a `test/tmp-401.jsonl` (gitignored), que **no se borra solo**:
 * cada línea lleva su `t` y el borrado le toca a quien lanza la corrida. Ver el
 * bloque de abajo, que explica por qué no se puede hacer desde acá. Para leerlo
 * después de un rojo:
 *
 * ```bash
 * jq -r 'select(.sospechoso) | "\(.test)\n  \(.metodo) \(.url)\n  \(.body)"' backend/test/tmp-401.jsonl
 * ```
 */
import { appendFileSync } from 'fs';
import { resolve } from 'path';
import supertest from 'supertest';

const ARCHIVO = resolve(__dirname, 'tmp-401.jsonl');

/**
 * ⚠️ **Este archivo es APPEND-ONLY: no se borra solo, y es a propósito.**
 *
 * Borrarlo "una vez por corrida" desde acá adentro **no se puede**, y costó dos
 * intentos comprobarlo (2026-08-24):
 *
 * | Intento | Por qué falla |
 * |---|---|
 * | flag en `globalThis` | jest le da a **cada archivo de test** su propio sandbox: el flag se reinicia y el log se borraba al empezar cada uno de los 50 specs |
 * | flag en `process.env` | igual — jest también le inyecta a cada archivo su propio `process`. Medido: corriendo dos specs juntos sobrevivieron solo los 401 del segundo |
 *
 * En los dos casos el efecto era el mismo y silencioso: una corrida completa
 * dejaba **cero** capturas, o las de un solo spec. Ninguno se vio al estrenar
 * esto porque se verificó con **un** spec, donde el bug es invisible por
 * construcción.
 *
 * La salida no es un tercer mecanismo: es que **cada línea lleva su `t`**, y
 * borrar el archivo le toca a quien lanza la corrida (`rm` antes, o el script
 * de la cacería, que además se guarda una copia por corrida). Un archivo que
 * crece unas pocas líneas por corrida no es un problema; una captura que se
 * borra sola a mitad de camino, sí.
 */

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
