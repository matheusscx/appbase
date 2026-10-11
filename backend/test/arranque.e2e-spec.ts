import { type ChildProcess, spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { resolve } from 'node:path';
import { Client } from 'pg';
import request from 'supertest';

/**
 * Lo que `main.ts` le pone a la app (`src/arranque.ts`), medido sobre el
 * `main.ts` de verdad corriendo en un proceso aparte: cabeceras de helmet, CORS
 * por lista, Swagger bajo la CSP, y el apagado ordenado con una señal real.
 *
 * Proceso aparte y no `createNestApplication()` como el resto del e2e: el resto
 * no ejecuta `main.ts`, y lo que se prueba acá es justamente lo que `main.ts`
 * monta y cómo muere el proceso.
 */

const ORIGEN_APP = 'https://app.ejemplo.cl';
const ORIGEN_ADMIN = 'https://admin.ejemplo.cl';
const ORIGEN_AJENO = 'https://ajeno.ejemplo.cl';
// Fuera de la lista a propósito: con CORS_ORIGINS definida, FRONTEND_URL deja
// de contar para CORS.
const FRONTEND_URL = 'http://localhost:5173';

function puertoLibre(): Promise<number> {
  return new Promise((listo, falla) => {
    const s = net.createServer();
    s.once('error', falla);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => listo(port));
    });
  });
}

/** `'aceptada'` o el código del error (`ECONNREFUSED`, …). */
function intentarConectar(puerto: number): Promise<string> {
  return new Promise((listo) => {
    const s = net.connect(puerto, '127.0.0.1');
    s.once('connect', () => {
      s.destroy();
      listo('aceptada');
    });
    s.once('error', (e: NodeJS.ErrnoException) => listo(e.code ?? e.message));
  });
}

async function esperarHasta<T>(
  fn: () => Promise<T | undefined>,
  msMax: number,
  que: string,
): Promise<T> {
  const limite = Date.now() + msMax;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > limite) throw new Error(`Timeout esperando ${que}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('Arranque de main.ts: seguridad HTTP y apagado ordenado (e2e)', () => {
  let hijo: ChildProcess;
  let puerto: number;
  let base: string;
  let salida = '';
  let salidaDelHijo: Promise<number | null>;

  beforeAll(async () => {
    puerto = await puertoLibre();
    base = `http://127.0.0.1:${puerto}`;
    hijo = spawn(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', 'src/main.ts'],
      {
        cwd: resolve(__dirname, '..'),
        env: {
          ...process.env,
          PORT: String(puerto),
          CORS_ORIGINS: ` ${ORIGEN_APP} , ${ORIGEN_ADMIN} `,
          FRONTEND_URL,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    hijo.stdout!.on('data', (d: Buffer) => (salida += d.toString()));
    hijo.stderr!.on('data', (d: Buffer) => (salida += d.toString()));
    salidaDelHijo = new Promise((listo) => hijo.once('exit', listo));

    await esperarHasta(
      async () => {
        if (hijo.exitCode !== null)
          throw new Error(`main.ts murió al arrancar:\n${salida}`);
        if ((await intentarConectar(puerto)) !== 'aceptada') return undefined;
        const res = await request(base).get('/api/health');
        return res.status === 200 ? true : undefined;
      },
      110_000,
      'que main.ts conteste /api/health',
    );
  }, 120_000);

  afterAll(async () => {
    if (hijo.exitCode === null) {
      hijo.kill('SIGKILL');
      await salidaDelHijo;
    }
  });

  describe('cabeceras de seguridad (helmet)', () => {
    it('una respuesta de la API las trae y no anuncia Express', async () => {
      const res = await request(base).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['content-security-policy']).toContain(
        "default-src 'self'",
      );
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS por lista (CORS_ORIGINS)', () => {
    it.each([ORIGEN_APP, ORIGEN_ADMIN])(
      'refleja un origen de la lista (%s), recortado',
      async (origen) => {
        const res = await request(base)
          .get('/api/health')
          .set('Origin', origen);
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBe(origen);
        expect(res.headers['access-control-allow-credentials']).toBe('true');
      },
    );

    it.each([ORIGEN_AJENO, FRONTEND_URL])(
      'no refleja un origen fuera de la lista (%s), pero atiende el request',
      async (origen) => {
        const res = await request(base)
          .get('/api/health')
          .set('Origin', origen);
        expect(res.status).toBe(200);
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      },
    );

    it('el preflight responde solo al origen de la lista', async () => {
      const preflight = (origen: string) =>
        request(base)
          .options('/api/auth/login')
          .set('Origin', origen)
          .set('Access-Control-Request-Method', 'POST')
          .set('Access-Control-Request-Headers', 'content-type');

      const permitido = await preflight(ORIGEN_APP);
      expect(permitido.status).toBe(204);
      expect(permitido.headers['access-control-allow-origin']).toBe(ORIGEN_APP);

      const ajeno = await preflight(ORIGEN_AJENO);
      expect(ajeno.status).toBe(204);
      expect(ajeno.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('el retorno de Webpay (POST de navegación desde Transbank) no lo frena CORS', async () => {
      const res = await request(base)
        .post('/api/pasarela/retorno/pago')
        .set('Origin', 'https://webpay3gint.transbank.cl')
        .type('form')
        .send({});
      // El 400 es del controller (retorno sin token): el request llegó.
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Retorno de pago sin token');
    });
  });

  describe('Swagger bajo la CSP', () => {
    it('/api/docs carga y todos sus scripts son externos del mismo origen', async () => {
      const res = await request(base).get('/api/docs');
      expect(res.status).toBe(200);
      expect(res.headers['content-security-policy']).toContain(
        "script-src 'self'",
      );
      // `script-src 'self'` bloquea todo <script> inline: si una versión nueva
      // de @nestjs/swagger mete uno, la página queda en blanco sin otro aviso.
      const scripts = [...res.text.matchAll(/<script\b([^>]*)>/g)].map(
        (m) => m[1],
      );
      expect(scripts.length).toBeGreaterThan(0);
      for (const atributos of scripts) expect(atributos).toMatch(/\bsrc=/);

      const init = await request(base).get('/api/docs/swagger-ui-init.js');
      expect(init.status).toBe(200);
      const bundle = await request(base).get('/api/docs/swagger-ui-bundle.js');
      expect(bundle.status).toBe(200);
    });
  });

  describe('apagado ordenado (SIGTERM)', () => {
    it('termina el request en vuelo, rechaza conexiones nuevas y sale con 0', async () => {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      const agente = new http.Agent({ keepAlive: true });
      try {
        // Un request real que queda en vuelo: el login lee `usuarios`, que
        // está bloqueada hasta el COMMIT. Un lock así de ancho vale porque el
        // e2e corre con `maxWorkers: 1` (jest-e2e.json): con más workers
        // congelaría a las otras suites mientras dura.
        await db.query('BEGIN');
        await db.query('LOCK TABLE usuarios IN ACCESS EXCLUSIVE MODE');

        let resuelto = false;
        const enVuelo = new Promise<{
          status: number;
          connection?: string;
        }>((listo, falla) => {
          const req = http.request(
            {
              agent: agente, // keep-alive, como el proxy del frontend
              host: '127.0.0.1',
              port: puerto,
              path: '/api/auth/login',
              method: 'POST',
              headers: { 'content-type': 'application/json' },
            },
            (res) => {
              res.resume();
              res.on('end', () => {
                resuelto = true;
                listo({
                  status: res.statusCode!,
                  connection: res.headers.connection,
                });
              });
            },
          );
          req.on('error', falla);
          req.end(JSON.stringify({ email: 'nadie@apagado.cl', password: 'x' }));
        });

        await esperarHasta(
          async () => {
            const { rows } = await db.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM pg_stat_activity
               WHERE wait_event_type = 'Lock' AND query ILIKE '%usuarios%'`,
            );
            return rows[0].n > 0 ? true : undefined;
          },
          10_000,
          'que el login quede esperando el lock',
        );

        const desdeLaSenal = salida.length;
        hijo.kill('SIGTERM');

        await esperarHasta(
          async () =>
            (await intentarConectar(puerto)) === 'ECONNREFUSED'
              ? true
              : undefined,
          10_000,
          'que el servidor deje de aceptar conexiones',
        );
        expect(resuelto).toBe(false);
        expect(hijo.exitCode).toBeNull();

        await db.query('COMMIT');

        const respuesta = await enVuelo;
        expect(respuesta.status).toBe(401);
        // Sin esto el socket keep-alive deja vivo al proceso después de
        // contestar, hasta que el cliente lo suelte.
        expect(respuesta.connection).toBe('close');

        let tope: NodeJS.Timeout | undefined;
        const codigo = await Promise.race([
          salidaDelHijo,
          new Promise<string>((r) => {
            tope = setTimeout(() => r('sigue vivo a los 5 s'), 5_000);
          }),
        ]);
        clearTimeout(tope);
        expect(codigo).toBe(0);
        const trasLaSenal = salida.slice(desdeLaSenal);
        expect(trasLaSenal).toContain('SIGTERM recibida: apagado ordenado');
        expect(trasLaSenal).not.toMatch(/ERROR/);
      } finally {
        await db.query('ROLLBACK').catch(() => undefined);
        await db.end();
        agente.destroy();
      }
    }, 30_000);
  });
});
