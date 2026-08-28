/**
 * CONTROL POSITIVO de la sonda del pool (`setup-pool.ts`).
 *
 * ⚠️ **Apagado por defecto**: se corre a mano con `CONTROL_SONDA=1`. No entra en
 * el gate porque tarda ~30 s, levanta un proxy TCP y bloquea el event loop a
 * propósito. Sale del repo junto con la sonda, cuando la entrada del backlog
 * cierre.
 *
 * ```bash
 * CONTROL_SONDA=1 npx jest --config ./test/jest-e2e.json \
 *   --runTestsByPath test/control-sonda-pool.e2e-spec.ts
 * ```
 *
 * **Qué prueba, y por qué existe.** Las dos capturas del intermitente
 * (`docs/agent/pendientes.md` § 2) comparten un estado exacto —
 * `antes {total:1, idle:1, esperando:1, max:10}` → `despues {total:3, idle:2,
 * esperando:0}`— que nadie había podido explicar. Acá se reproduce esa firma
 * **deterministamente** con un proxy que demora una conexión elegida, y se
 * verifica que la correlación nueva la atribuye al pedido correcto.
 *
 * 📌 Y es el control positivo de la sonda misma: una sonda muda se ve igual que
 * una sonda sin nada que reportar, que es el error que ya se cometió dos veces
 * en este frente.
 *
 * ⚠️ **Escribe en el mismo `tmp-pool.jsonl` que la corrida real**, y con fallos
 * fabricados. Si estás peritando una caída del intermitente, leé el archivo
 * **antes** de correr esto, o vas a estar mirando timeouts de utilería.
 */
import * as net from 'net';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';

const ARCHIVO = resolve(__dirname, 'tmp-pool.jsonl');

type Registro = Record<string, any>;

function lineas(): Registro[] {
  return readFileSync(ARCHIVO, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Registro);
}

/**
 * Perezoso a propósito: el `testRegex` de `jest-e2e.json` matchea este archivo en
 * toda corrida, así que el módulo se **carga** siempre aunque el suite esté
 * apagado. Resolverlo a nivel de módulo haría fallar la carga sin `DATABASE_URL`.
 */
function destino(): URL {
  return new URL(process.env.DATABASE_URL as string);
}

/** Proxy que demora a propósito las conexiones cuyo índice se le pida. */
function proxy(demoradas: Set<number>, demoraMs: number) {
  let n = 0;
  const server = net.createServer((abajo) => {
    const i = ++n;
    const conectar = () => {
      const d = destino();
      const arriba = net.connect(Number(d.port), d.hostname);
      arriba.on('error', () => abajo.destroy());
      abajo.on('error', () => arriba.destroy());
      abajo.pipe(arriba);
      arriba.pipe(abajo);
    };
    if (demoradas.has(i)) setTimeout(conectar, demoraMs).unref();
    else conectar();
  });
  return server;
}

function urlDelProxy(puerto: number): string {
  const u = destino();
  u.hostname = '127.0.0.1';
  u.port = String(puerto);
  return u.toString();
}

/** Apagado salvo pedido explícito: ver el docblock de arriba. */
const suite = process.env.CONTROL_SONDA === '1' ? describe : describe.skip;

suite('control positivo de la sonda del pool', () => {
  let server: net.Server;
  let puerto: number;

  beforeAll(async () => {
    server = proxy(new Set([2]), 30000);
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    puerto = (server.address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((ok) => server.close(() => ok()));
  });

  it('reproduce la firma de las capturas y la atribuye al pedido correcto', async () => {
    const pool = new Pool({
      connectionString: urlDelProxy(puerto),
      max: 10,
      connectionTimeoutMillis: 1500,
    });

    // total 1, idle 1 — el estado del que parten las dos capturas.
    const c0 = await pool.connect();
    c0.release();

    // A y B en el MISMO tick: ambos se encolan porque hay un idle, y B ve
    // `antes {total:1, idle:1, esperando:1}`, que es la firma capturada.
    //
    // ⚠️ Cada uno de los dos agenda **su propio** `process.nextTick(_pulseQueue)`
    // (`node_modules/pg-pool/index.js:198-203`), y ahí está toda la mecánica: el
    // primer pulso le da el cliente idle a A; el **segundo** encuentra la cola con
    // B, sin idles y el pool no lleno, y le crea a B un cliente propio
    // (`index.js:165-167`) — el que el proxy demora, la conexión #2. Los dos
    // nextTicks corren antes de que `await pa` reanude.
    const pa = pool.connect();
    const pb = pool.connect();

    const a = await pa; // el primer pulso le dio el cliente idle
    // Devolverlo CON error lo saca del pool (`index.js:392-397`). NO es lo que
    // crea el cliente de B —eso ya pasó en el segundo pulso—: es lo que hace que
    // el `total` final dé 3 y no 4, que es el número de las capturas.
    a.release(new Error('control: sacar del pool el cliente reusado'));

    // Dos pedidos que llegan con la cola ya vacía: se crean clientes propios,
    // conectan rápido y quedan idle. Con el cliente demorado de B, son los que
    // completan `total:3, idle:2`.
    const extra1 = await pool.connect();
    const extra2 = await pool.connect();
    extra1.release();
    extra2.release();

    await expect(pb).rejects.toThrow('timeout exceeded when trying to connect');
    await new Promise((ok) => setTimeout(ok, 500));

    const todas = lineas();
    const fallo = todas
      .filter((r) => r.error === 'timeout exceeded when trying to connect')
      .pop() as Registro;

    expect(fallo).toBeDefined();
    expect(fallo.antes).toMatchObject({
      total: 1,
      idle: 1,
      esperando: 1,
      max: 10,
    });
    expect(fallo.despues).toMatchObject({ total: 3, idle: 2, esperando: 0 });
    // Lo que la entrada del backlog no podía contestar: a este pedido SÍ le
    // asignaron un cliente, y era nuevo.
    expect(fallo.via).toBe('nuevo');
    expect(typeof fallo.pedido).toBe('number');

    const suCliente = todas.filter(
      (r) => r.capa === 'client.connect' && r.pedido === fallo.pedido,
    );
    expect(suCliente.length).toBeGreaterThan(0);

    await pool.end();
  }, 25000);

  it('un encolado al que NUNCA le dan cliente se distingue: via null', async () => {
    const pool = new Pool({
      connectionString: urlDelProxy(puerto),
      max: 1,
      connectionTimeoutMillis: 1200,
    });
    const unico = await pool.connect(); // ocupa el único cliente
    await expect(pool.connect()).rejects.toThrow(
      'timeout exceeded when trying to connect',
    );
    const fallo = lineas()
      .filter((r) => r.error === 'timeout exceeded when trying to connect')
      .pop() as Registro;
    expect(fallo.via).toBeNull();
    expect(fallo.clienteMs).toBeNull();
    // El `despues` de este camino NO es el de las capturas, y por eso se asierta:
    // el backlog se apoya en esta diferencia.
    expect(fallo.despues).toMatchObject({ total: 1, idle: 0, esperando: 0 });
    unico.release();
    await pool.end();
  }, 25000);

  it('un release con alguien en cola lo desencola en el MISMO frame', async () => {
    // Esto es lo que vuelve imposible la otra lectura de las capturas: si al
    // pedido nunca le hubieran dado cliente, no podrían existir clientes idle
    // mientras él sigue encolado, porque cada `release` pulsa la cola en el acto.
    const pool = new Pool({
      connectionString: urlDelProxy(puerto),
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    const unico = await pool.connect();
    const encolado = pool.connect();
    await new Promise((ok) => setImmediate(ok));
    expect(pool.waitingCount).toBe(1);
    unico.release();
    expect(pool.waitingCount).toBe(0); // sin ceder el loop
    (await encolado).release();
    await pool.end();
  }, 25000);

  it('el muestreo del loop ve un bloqueo deliberado', async () => {
    const pool = new Pool({
      connectionString: urlDelProxy(puerto),
      max: 1,
      connectionTimeoutMillis: 600,
    });
    const unico = await pool.connect();
    const hasta = Date.now() + 1300;
    while (Date.now() < hasta) {
      /* bloqueo deliberado del event loop */
    }
    await expect(pool.connect()).rejects.toThrow();
    const fallo = lineas()
      .filter((r) => r.error === 'timeout exceeded when trying to connect')
      .pop() as Registro;
    expect(fallo.loopMax).toBeGreaterThanOrEqual(1000);
    expect(Array.isArray(fallo.loopPicos)).toBe(true);
    unico.release();
    await pool.end();
  }, 25000);
});
