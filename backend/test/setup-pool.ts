/**
 * Sonda del pool de `pg`, para el `timeout exceeded when trying to connect`
 * intermitente del e2e (`docs/agent/pendientes.md` § 2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO Y NO SEGUIR CAZANDO EL FALLO
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Ese error lo tira **`pg-pool` cuando `pool.connect()` no consigue un cliente
 * dentro de `connectionTimeoutMillis`** —5 s acá, `app.module.ts:166`—, y eso
 * pasa por dos motivos que se parecen en el síntoma y no en la causa:
 *
 * | Causa | Cómo se ve en esta sonda |
 * |---|---|
 * | El pool está **saturado**: los 10 clientes ocupados y alguien esperando | `esperando > 0` y `total === max` |
 * | Establecer una conexión nueva es **lento** (red, DNS, Docker) | `total < max` y `esperando === 0`, pero `ms` alto |
 *
 * La entrada del backlog concluyó "no es agotamiento" desde `pg_stat_activity`
 * —pico 16 contra `max_connections = 100`—, pero **eso mide el total del
 * servidor, no si UN pool concreto se quedó sin clientes**. Cada spec levanta su
 * propia app con su propio pool de 10: un pool saturado se ve como ~10
 * conexiones en Postgres, que contra 100 parece holgado. El agotamiento acá es
 * **por pool**, y esta sonda es lo único que lo mira.
 *
 * 📌 **Y no hace falta atrapar el fallo de 5 s.** Registrando toda adquisición
 * que pase de `LENTO_MS`, la cola de la distribución se ve en cualquier corrida
 * normal: si hay esperas de 2-3 s con `esperando > 0`, el mecanismo queda a la
 * vista sin depender de un intermitente raro. Ése fue el error de las pasadas
 * anteriores — esperar al fallo en vez de medir lo que pasa siempre.
 *
 * ⛔ Lo que NO hay que hacer con lo que esto muestre: subir
 * `connectTimeoutMS`. Haría desaparecer el síntoma y debilitaría la defensa que
 * ADR-020 puso a propósito, que es que un agotamiento futuro falle ruidoso en
 * vez de dejar la API muerta hasta reiniciar.
 *
 * El archivo es **append-only** y no se borra solo: cada línea lleva su `t` y
 * borrarlo le toca a quien lanza la corrida. El porqué está en
 * `setup-supertest.ts` — intentarlo desde adentro de jest ya falló dos veces.
 */
import { appendFileSync } from 'fs';
import { resolve } from 'path';
import * as pg from 'pg';

const ARCHIVO = resolve(__dirname, 'tmp-pool.jsonl');

/**
 * Umbral de demora para registrar. Línea base medida en un spec chico:
 * **p50 = 0 ms, p99 = 1 ms, máximo 19 ms** sobre 752 adquisiciones. Con 0 el
 * archivo se llena de miles de líneas instantáneas y tapa lo que importa.
 */
const LENTO_MS = 250;

/**
 * Lo poco del pool de `pg` que esta sonda usa, descrito acá a propósito:
 * `pg@8` no trae tipos propios y `@types/pg` no está instalado. Agregar una
 * dependencia para una sonda de test no vale — y sin esto, `Pool` entra como
 * tipo de error y contamina todo lo que toca.
 */
interface PoolInterno {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  options?: { max?: number };
  connect: (...args: unknown[]) => unknown;
}

/** Lo mínimo de `pg.Client` que la sonda de capa usa. Mismo motivo que `PoolInterno`. */
interface ClienteInterno {
  connect: (...args: unknown[]) => unknown;
}

const Pool = (pg as unknown as { Pool: { prototype: PoolInterno } }).Pool;
const Client = (pg as unknown as { Client: { prototype: ClienteInterno } })
  .Client;

/**
 * Cuántos `client.connect()` hay EN VUELO ahora mismo, en **todo el proceso**.
 *
 * ⚠️ **Es contexto, NO una regla de decisión**, y conviene leerlo con el freno
 * puesto: es global y se lee en un instante. Medido en una suite entera llega a
 * **8** durante las ráfagas, así que `conectando > 0` **no atribuye** ese connect
 * al pedido que está fallando, y `conectando === 0` **no descarta** una conexión
 * que arrancó y terminó dentro de la ventana. La versión anterior de este
 * docblock lo enunciaba como regla ("`> 0` es conexión nueva, `=== 0` es cola") y
 * eso es más de lo que el número da.
 *
 * ⚠️ Y sólo baja cuando el connect **settlea**: un TCP colgado en un pool sin
 * `connectionTimeoutMillis` lo deja en +1 para siempre. El `try/catch` de abajo
 * cubre el throw sincrónico, no el connect que no vuelve.
 */
let conectando = 0;

/** El pool no tiene más clientes que dar: los `max` están creados. */
function lleno(e: { total: number; max: number | null }): boolean {
  return e.max !== null && e.total >= e.max;
}

function estado(p: PoolInterno) {
  return {
    total: p.totalCount,
    idle: p.idleCount,
    esperando: p.waitingCount,
    max: p.options?.max ?? null,
    conectando,
  };
}

function registrar(campos: Record<string, unknown>): void {
  try {
    appendFileSync(
      ARCHIVO,
      JSON.stringify({
        t: new Date().toISOString(),
        test: expect.getState().currentTestName ?? '(fuera de un test)',
        ...campos,
      }) + '\n',
    );
  } catch {
    // Una sonda nunca puede romper la corrida que observa.
  }
}

const original = Pool.prototype.connect;
Pool.prototype.connect = function (this: PoolInterno, ...args: unknown[]) {
  const antes = estado(this);
  const inicio = Date.now();
  const anotar = (ms: number, error?: unknown) => {
    if (error !== undefined && error !== null) {
      registrar({
        ms,
        error: error instanceof Error ? error.message : JSON.stringify(error),
        antes,
        despues: estado(this),
      });
    } else if (ms >= LENTO_MS || antes.esperando > 0 || lleno(antes)) {
      // ⚠️ **También se registra por ESTADO y no solo por demora**, y es la
      // mitad que importa: el `timeout exceeded when trying to connect` llega
      // después de que el pool se queda sin clientes, no después de un
      // `connect()` lento. Una adquisición instantánea pedida con `esperando > 0`
      // o con el pool lleno es el estado que precede al fallo; esperar a que
      // tarde 5 s es llegar tarde y solo cuando ya explotó.
      registrar({ ms, antes, despues: estado(this) });
    }
  };

  // ⚠️ **La forma con CALLBACK es la que importa, y saltearla dejó la sonda
  // muda.** La primera versión de esto la delegaba sin instrumentar "porque la
  // usa poco código": medido en `node_modules/typeorm/driver/postgres/
  // PostgresDriver.js:1085,1106,1401`, TypeORM usa **solo** esa forma. Con el
  // umbral en 0 y una app entera arrancando, el archivo salía vacío — que es
  // exactamente cómo se ve una sonda rota y cómo se vería una sonda sin nada
  // que reportar. Verificar que engancha ANTES de creerle a un archivo vacío.
  if (typeof args[0] === 'function') {
    const cb = args[0] as (...a: unknown[]) => void;
    args[0] = (err: unknown, ...resto: unknown[]) => {
      anotar(Date.now() - inicio, err);
      cb(err, ...resto);
    };
    return original.apply(this, args);
  }

  const p = (original as (...a: unknown[]) => Promise<unknown>).apply(
    this,
    args,
  );

  return p.then(
    (cliente) => {
      anotar(Date.now() - inicio);
      return cliente;
    },
    (e: unknown) => {
      anotar(Date.now() - inicio, e);
      throw e;
    },
  );
};

/**
 * ⚠️ **La otra mitad, agregada el 2026-08-27: cuánto tarda ESTABLECER la
 * conexión.** El parche de arriba mide `pool.connect()`, que es *conseguir un
 * cliente* — y esas dos cosas se separan justo en el caso que interesa: con un
 * cliente idle en el pool, `pg-pool` **encola** en vez de crear cliente, y le da
 * el idle al primero de la cola (`node_modules/pg-pool/index.js`). Un pedido que
 * llega con `esperando > 0` sale entonces por `newClient` → `client.connect()`,
 * o sea una conexión TCP nueva, y esta sonda no la veía.
 *
 * Sirve para acotar **una** de las cuatro ramas vivas —que los segundos se vayan
 * estableciendo la conexión—, no para elegir entre ellas. Las otras tres (el
 * event loop tapado, el pedido esperando el pulso de la cola, y de qué lado del
 * puerto publicado de Docker cae la demora) **no se deciden desde acá**.
 * ⚠️ Y este registro no lleva identidad de pool ni de pedido, así que un
 * `client.connect` lento en la ventana del fallo puede ser de **otro** pedido: un
 * `connect()` posterior con la cola sin idles saltea la cola y va derecho a
 * `newClient`.
 * **El estado de la investigación no se repite acá**: vive en
 * `docs/agent/pendientes.md` § 2, que es el único lugar que hay que mantener.
 */
const clienteOriginal = Client.prototype.connect;
Client.prototype.connect = function (this: ClienteInterno, ...args: unknown[]) {
  const inicio = Date.now();
  conectando++;
  let cerrado = false;
  const anotar = (ms: number, error?: unknown) => {
    // Idempotente: si alguna vez llegaran callback y promise por el mismo
    // connect, el contador no puede quedar en negativo ni doblar el registro.
    if (cerrado) return;
    cerrado = true;
    conectando--;
    if (ms >= LENTO_MS || (error !== undefined && error !== null)) {
      registrar({
        capa: 'client.connect',
        ms,
        ...(error !== undefined && error !== null
          ? {
              error:
                error instanceof Error ? error.message : JSON.stringify(error),
            }
          : {}),
      });
    }
  };

  // Misma lección que arriba: la forma con callback es la que usa TypeORM.
  // ⚠️ El `try` no es decorativo: si `connect` tirara **sincrónico** (config
  // inválida, puerto fuera de rango), `conectando` quedaría en +1 para siempre en
  // ese archivo de spec y **todo** registro posterior leería `conectando > 0`. Una
  // sonda que se invierte en silencio es peor que no tenerla.
  try {
    if (typeof args[0] === 'function') {
      const cb = args[0] as (...a: unknown[]) => void;
      args[0] = (err: unknown, ...resto: unknown[]) => {
        anotar(Date.now() - inicio, err);
        cb(err, ...resto);
      };
      return clienteOriginal.apply(this, args);
    }

    const p = (clienteOriginal as (...a: unknown[]) => Promise<unknown>).apply(
      this,
      args,
    );

    return p.then(
      (v) => {
        anotar(Date.now() - inicio);
        return v;
      },
      (e: unknown) => {
        anotar(Date.now() - inicio, e);
        throw e;
      },
    );
  } catch (e) {
    anotar(Date.now() - inicio, e);
    throw e;
  }
};
