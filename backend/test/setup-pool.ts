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

const Pool = (pg as unknown as { Pool: { prototype: PoolInterno } }).Pool;

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
