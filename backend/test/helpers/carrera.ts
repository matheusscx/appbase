import type { DataSource } from 'typeorm';

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Corre `pedidos` en carrera detrás de una compuerta: una transacción propia
 * retiene con `FOR UPDATE` las filas de `compuerta`, se disparan los pedidos,
 * se espera a que lleguen y se suelta. Devuelve sus respuestas y cuántas
 * sesiones estaban frenadas por la compuerta justo antes de soltar.
 *
 * `esperando` cuenta solo las sesiones que la compuerta frena, directa o
 * transitivamente (la que espera a otra que espera a la compuerta): contar
 * todas las de la base dejaba pasar el test con esperas ajenas, sin que los
 * pedidos hubieran llegado a la compuerta. El test afirma el número, porque
 * con menos no hubo carrera y mediría el camino en serie.
 */
export async function correrCarrera<T>(
  ds: DataSource,
  compuerta: [string, unknown[]],
  pedidos: (() => Promise<T>)[],
): Promise<{ esperando: number; respuestas: T[] }> {
  const qr = ds.createQueryRunner();
  try {
    await qr.connect();
    await qr.startTransaction();
    const retenidas: unknown[] = await qr.query(...compuerta);
    // Una compuerta que no retiene ninguna fila no frena a nadie.
    if (!retenidas.length) throw new Error('La compuerta no retuvo filas');
    const [{ pid }]: { pid: number }[] = await qr.query(
      `SELECT pg_backend_pid() AS pid`,
    );

    const enCurso = pedidos.map((p) => p());
    await dormir(800);
    const [{ n }] = await ds.query<{ n: number }[]>(
      `WITH RECURSIVE frenadas AS (
         SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))
         UNION
         SELECT a.pid FROM pg_stat_activity a
           JOIN frenadas f ON f.pid = ANY(pg_blocking_pids(a.pid))
       )
       SELECT count(*)::int AS n FROM frenadas`,
      [pid],
    );
    await qr.rollbackTransaction();
    return { esperando: n, respuestas: await Promise.all(enCurso) };
  } finally {
    if (qr.isTransactionActive) await qr.rollbackTransaction();
    await qr.release();
  }
}
