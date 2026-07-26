/**
 * TypeORM + pg: `INSERT/UPDATE ... RETURNING` llega como `[rows, rowCount]`,
 * no como `rows`. Tipar el resultado directo compila pero devuelve la forma
 * equivocada en runtime — un bug silencioso que ya apareció dos veces en este
 * repo. Toda query con RETURNING pasa por acá.
 */
export function unwrap<T>(raw: unknown): T[] {
  return Array.isArray((raw as unknown[])[0])
    ? ((raw as T[][])[0] ?? [])
    : ((raw as T[]) ?? []);
}
