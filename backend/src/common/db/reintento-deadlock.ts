/**
 * Reintentos ante deadlock. Dos son suficientes: el deadlock exige que dos
 * ventas se crucen en el mismo instante, y Postgres mata a una de las dos —
 * la que sobrevive libera sus locks al commitear, así que el reintento entra
 * a una BD ya despejada. Un número alto solo alargaría el tiempo hasta
 * devolverle el error a un cajero que está esperando.
 *
 * Consumidores hoy: `ventas.service.ts`, `salones.service.ts` y —desde el
 * frente de bodegas y traslados— `traslados.service.ts`. Vivía duplicado a
 * propósito entre ventas y salones hasta que un tercer consumidor lo pidió; la
 * regla del repo era "el que necesite una tercera copia, extrae las tres".
 */
export const MAX_REINTENTOS_DEADLOCK = 2;

/**
 * `40P01` = `deadlock_detected`. TypeORM envuelve el error del driver en
 * `QueryFailedError`, que copia el `code` del driver pero también lo deja en
 * `driverError`: se miran los dos porque cuál de las dos formas llega depende
 * de dónde se lance, y confundirse acá significa no reintentar nunca.
 */
export function esDeadlock(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } };
  return e?.code === '40P01' || e?.driverError?.code === '40P01';
}
