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
 * | El pedido **se encoló** y el cliente que le crearon no terminó de conectar | `via: 'nuevo'` y **sin** `clienteMs` — si el connect llegó a settlear, su `ms` está en el `capa: 'client.connect'` del mismo `pedido` |
 *
 * ⚠️ La tercera fila no estaba y es la que resultó ser la de las dos capturas del
 * backlog: sin el `pedido` no se distinguía de la segunda, porque un `connect()`
 * posterior que llegue con la cola sin idles saltea la cola y también crea
 * cliente. El control positivo de esa distinción vive en
 * `control-sonda-pool.e2e-spec.ts` (apagado salvo `CONTROL_SONDA=1`).
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
  /** La cola de `pg-pool`. Se lee para etiquetar el pedido recién encolado. */
  _pendingQueue: ItemPendiente[];
  newClient: (pendingItem: ItemPendiente) => unknown;
  _acquireClient: (
    client: unknown,
    pendingItem: ItemPendiente,
    idleListener: unknown,
    isNew: boolean,
  ) => unknown;
}

/**
 * Un `PendingItem` de `pg-pool` (su clase interna, `node_modules/pg-pool/index.js:20`),
 * más el `__pedido` que esta sonda le cuelga para poder seguirlo.
 */
interface ItemPendiente {
  callback: (...a: unknown[]) => void;
  timedOut?: boolean;
  __pedido?: number;
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

/**
 * ────────────────────────────────────────────────────────────────────────────
 * CORRELACIÓN PEDIDO ↔ CLIENTE (2026-08-27)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * El agujero que esto tapa: hasta ahora un `capa: 'client.connect'` lento en la
 * ventana del fallo decía que **alguna** conexión tardó, no que tardara **la
 * nuestra** — y no es un detalle, porque en `pg-pool` un `connect()` posterior
 * que llegue con la cola sin idles y el pool no lleno se va derecho a
 * `newClient` y **saltea la cola**. La rama "el pedido se quedó esperando el
 * pulso" se leía por ausencia.
 *
 * Se puede correlacionar porque `pool.connect()` decide **sincrónicamente**
 * (`node_modules/pg-pool/index.js:190-237`): o empuja su `PendingItem` a
 * `_pendingQueue`, o llama a `newClient()`, que a su vez construye el `Client` y
 * llama a `client.connect()` en el mismo frame (`:240-266`). Entonces:
 *
 * - cada `pool.connect()` recibe un `pedido` correlativo;
 * - si encoló, se le cuelga el `pedido` al ítem (`__pedido`), que es como se lo
 *   sigue cuando `_pulseQueue` lo atiende **mucho después**;
 * - `newClient` publica ese `pedido` en `pedidoDelProximoCliente`, y el parche de
 *   `Client.prototype.connect` lo levanta en el mismo frame.
 *
 * Con eso, un `client.connect` lento y el `timeout` que lo acompaña se pueden
 * atribuir al mismo pedido —o descartar que sean el mismo—, que es exactamente
 * la pregunta que la entrada del backlog dejó abierta.
 */
let secuencia = 0;

/** Cómo terminó sirviéndose un pedido: con un cliente idle o con uno nuevo. */
interface PedidoEnVuelo {
  via?: 'idle' | 'nuevo';
  clienteMs?: number;
}

/**
 * Pedidos vivos. Se borra la entrada al resolverse (éxito o error).
 * ⚠️ Un pedido que **nunca vuelve** —el otro intermitente de § 2— deja su
 * entrada acá para siempre. Es un mapa chico en un proceso de test, no una fuga
 * que importe, pero al leer el archivo conviene saberlo.
 */
const enVuelo = new Map<number, PedidoEnVuelo>();

/** Pedido cuyo `pool.connect()` está corriendo AHORA, en su frame síncrono. */
let pedidoEnConnect: number | null = null;

/** Pedido para el que `newClient()` está construyendo un cliente AHORA. */
let pedidoDelProximoCliente: number | null = null;

/**
 * ────────────────────────────────────────────────────────────────────────────
 * ATRASO DEL EVENT LOOP (2026-08-27)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * La única rama viva **parcialmente reproducida**: un bloqueo del loop que
 * termine justo antes del vencimiento da `ms ≈ 5000` y el `antes` exacto de las
 * dos capturas (medido: bloqueo de 4995 ms → `ms=5000`). Un bloqueo que **cruce**
 * el vencimiento sí queda descartado, porque el `ms` sería el del bloqueo.
 *
 * Lo que faltaba era muestrear **en la corrida que falle**: la medición previa
 * (máximo 1095 ms dentro de un test, 2330 ms en el bootstrap) es de una suite
 * verde, así que no dice nada del instante del fallo. Esto va siempre puesto y
 * cada registro se lleva la ventana de los últimos 10 s.
 */
const MUESTREO_MS = 100;
const VENTANA_MUESTRAS = 100; // 10 s
const PICO_MS = 200;
const atrasos: { t: number; ms: number }[] = [];
let ultimoTick = Date.now();
const reloj = setInterval(() => {
  const ahora = Date.now();
  const atraso = ahora - ultimoTick - MUESTREO_MS;
  ultimoTick = ahora;
  atrasos.push({ t: ahora, ms: atraso > 0 ? atraso : 0 });
  if (atrasos.length > VENTANA_MUESTRAS) atrasos.shift();
}, MUESTREO_MS);
// Una sonda no puede ser la razón por la que el proceso de jest no termina.
reloj.unref();

/** Atraso máximo del loop en la ventana muestreada. */
function loopMax(): number {
  return atrasos.reduce((m, a) => (a.ms > m ? a.ms : m), 0);
}

/** Los picos de la ventana, fechados hacia atrás desde ahora. */
function loopPicos(): { hace: number; ms: number }[] {
  const ahora = Date.now();
  return atrasos
    .filter((a) => a.ms >= PICO_MS)
    .map((a) => ({ hace: ahora - a.t, ms: a.ms }));
}

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
        loopMax: loopMax(),
        ...(campos.error !== undefined ? { loopPicos: loopPicos() } : {}),
      }) + '\n',
    );
  } catch {
    // Una sonda nunca puede romper la corrida que observa.
  }
}

const original = Pool.prototype.connect;
Pool.prototype.connect = function (this: PoolInterno, ...args: unknown[]) {
  const pedido = ++secuencia;
  enVuelo.set(pedido, {});
  const antes = estado(this);
  const inicio = Date.now();
  let cerrado = false;
  const anotar = (ms: number, error?: unknown) => {
    // Idempotente, igual que el de `client.connect`. No es decorativo desde que
    // `via` significa algo: un segundo registro saldría con `via: null` —el mapa
    // ya está borrado—, o sea indistinguible del pedido al que nunca le
    // asignaron cliente, que es justo la rama que esta pasada descartó.
    if (cerrado) return;
    cerrado = true;
    const info = enVuelo.get(pedido);
    enVuelo.delete(pedido);
    // `via` ausente en un error es el dato: al pedido **nunca** se le asignó un
    // cliente, ni idle ni nuevo. Con `via: 'nuevo'` y sin `clienteMs`, en cambio,
    // el cliente era nuestro y su `connect()` todavía no había vuelto — que es la
    // rama que hasta ahora se leía por ausencia.
    const seguimiento = {
      pedido,
      via: info?.via ?? null,
      clienteMs: info?.clienteMs ?? null,
    };
    if (error !== undefined && error !== null) {
      registrar({
        ms,
        error: error instanceof Error ? error.message : JSON.stringify(error),
        ...seguimiento,
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
      registrar({ ms, ...seguimiento, antes, despues: estado(this) });
    }
  };

  /**
   * Llama al original publicando el `pedido`, y si el original **encoló**, le
   * cuelga la etiqueta al ítem recién empujado.
   *
   * Se puede afirmar "el recién empujado es el nuestro" porque `connect()` empuja
   * sincrónicamente y nada más corre en el medio; el `if` sobre el largo de la
   * cola es lo que distingue el camino encolado del directo, donde no hay nada
   * que etiquetar.
   */
  const invocar = (): unknown => {
    // ⚠️ Se lee con guarda y se restaura el valor **anterior** en vez de anular:
    // `_pendingQueue` es un interno privado de `pg-pool`, que entra por un rango
    // flotante (`pg: ^8`), y una sonda no puede ser la que mate la suite si
    // mañana cambia de nombre.
    const cola = Array.isArray(this._pendingQueue) ? this._pendingQueue : null;
    const largoAntes = cola?.length ?? 0;
    const anterior = pedidoEnConnect;
    pedidoEnConnect = pedido;
    try {
      return original.apply(this, args);
    } finally {
      pedidoEnConnect = anterior;
      if (cola !== null && cola.length > largoAntes) {
        const item = cola[cola.length - 1];
        if (item !== undefined && item.__pedido === undefined) {
          item.__pedido = pedido;
        }
      }
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
    return invocar();
  }

  const p = invocar() as Promise<unknown>;

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
 * Los dos caminos por los que un pedido recibe cliente, parcheados para dejar
 * asentado **cuál** le tocó y **a quién** pertenece el cliente que se crea.
 *
 * `newClient` es el único lugar donde nace un `Client`, y lo llaman dos: el
 * `connect()` directo (el pedido está en `pedidoEnConnect`) y `_pulseQueue`
 * atendiendo un encolado (el pedido viene colgado del ítem). Publicar el pedido
 * en `pedidoDelProximoCliente` alrededor del original es seguro porque el
 * original construye el cliente y lo conecta **sin ceder el loop**.
 */
const nuevoOriginal = Pool.prototype.newClient;
const adquirirOriginal = Pool.prototype._acquireClient;

/**
 * ⚠️ `newClient` y `_acquireClient` son **internos privados** de `pg-pool`, que
 * entra transitivo por un rango flotante (`pg: ^8`). Si un día no están, la
 * sonda pierde la correlación —queda como antes de esta pasada— pero **no** mata
 * la suite con un `TypeError` en cada adquisición de conexión, que es lo que
 * pasaría reemplazándolos a ciegas. La regla es la del resto del archivo: una
 * sonda nunca puede romper la corrida que observa.
 */
const hayCorrelacion =
  typeof nuevoOriginal === 'function' && typeof adquirirOriginal === 'function';

if (!hayCorrelacion) {
  registrar({
    aviso:
      'pg-pool cambió sus internos: sin correlación pedido ↔ cliente (via/pedido no son de fiar)',
  });
}

if (hayCorrelacion) {
  Pool.prototype.newClient = function (this: PoolInterno, item: ItemPendiente) {
    const pedido = item?.__pedido ?? pedidoEnConnect;
    const info =
      pedido !== null && pedido !== undefined ? enVuelo.get(pedido) : undefined;
    if (info !== undefined) info.via = 'nuevo';
    const anterior = pedidoDelProximoCliente;
    pedidoDelProximoCliente = pedido ?? null;
    try {
      return nuevoOriginal.call(this, item);
    } finally {
      pedidoDelProximoCliente = anterior;
    }
  };

  Pool.prototype._acquireClient = function (
    this: PoolInterno,
    client: unknown,
    item: ItemPendiente,
    idleListener: unknown,
    isNew: boolean,
  ) {
    const pedido = item?.__pedido ?? pedidoEnConnect;
    const info =
      pedido !== null && pedido !== undefined ? enVuelo.get(pedido) : undefined;
    // `isNew` ya quedó marcado como `'nuevo'` desde `newClient`; acá solo se
    // nombra el caso que no pasa por ahí: le tocó un cliente que ya estaba idle.
    if (info !== undefined && info.via === undefined) info.via = 'idle';
    return adquirirOriginal.call(this, client, item, idleListener, isNew);
  };
}

/**
 * ⚠️ **La otra mitad, agregada el 2026-08-27: cuánto tarda ESTABLECER la
 * conexión.** El parche de arriba mide `pool.connect()`, que es *conseguir un
 * cliente* — y esas dos cosas se separan justo en el caso que interesa: con un
 * cliente idle en el pool, `pg-pool` **encola** en vez de crear cliente, y le da
 * el idle al primero de la cola (`node_modules/pg-pool/index.js`). Un pedido que
 * llega con `esperando > 0` sale entonces por `newClient` → `client.connect()`,
 * o sea una conexión TCP nueva, y esta sonda no la veía.
 *
 * Mide cuánto tardan los segundos que se van estableciendo la conexión; de qué
 * lado del puerto publicado de Docker caen —red o backend de Postgres— eso lo
 * parte el `t` contra el log del servidor, no esta sonda.
 * ✅ **Y desde la pasada de la correlación sí lleva identidad de pedido**: el
 * `pedido` de abajo. Antes no la llevaba, y por eso un `client.connect` lento en
 * la ventana del fallo podía ser de **otro** pedido —un `connect()` posterior con
 * la cola sin idles saltea la cola y va derecho a `newClient`—; ahora se compara
 * el campo.
 * ⚠️ Lo que sigue sin poder decir: una conexión que **nunca vuelve** no genera
 * ninguna línea acá, porque esto registra al settlear. Ese caso se lee en el
 * registro del pool: `via: 'nuevo'` **sin** `clienteMs`.
 * **El estado de la investigación no se repite acá**: vive en
 * `docs/agent/pendientes.md` § 2, que es el único lugar que hay que mantener.
 */
const clienteOriginal = Client.prototype.connect;
Client.prototype.connect = function (this: ClienteInterno, ...args: unknown[]) {
  const inicio = Date.now();
  // Se levanta acá, en el frame síncrono de `newClient`. Un `Client` construido
  // fuera de un pool —TypeORM abre alguno directo— entra con `pedido: null`, y
  // eso también es información: no puede ser el que hizo caducar a nadie.
  const pedido = pedidoDelProximoCliente;
  conectando++;
  let cerrado = false;
  const anotar = (ms: number, error?: unknown) => {
    // Idempotente: si alguna vez llegaran callback y promise por el mismo
    // connect, el contador no puede quedar en negativo ni doblar el registro.
    if (cerrado) return;
    cerrado = true;
    conectando--;
    // Se anota SIEMPRE en el pedido, aunque no se registre en el archivo: es lo
    // que deja al registro del pool decir cuánto tardó **su** conexión.
    const info = pedido !== null ? enVuelo.get(pedido) : undefined;
    if (info !== undefined) info.clienteMs = ms;
    if (ms >= LENTO_MS || (error !== undefined && error !== null)) {
      registrar({
        capa: 'client.connect',
        pedido,
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
