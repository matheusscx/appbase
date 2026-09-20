/**
 * Assertion compartida por specs UNITARIOS de services que arman SQL crudo
 * para `Db.query()` (`./db.service.ts`): reconstruye, desde el string y el
 * array de `params` que el service realmente le mandó a `Db.query`, la regla
 * de que todo `$n` referenciado en el SQL tiene un bind y todo bind está
 * referenciado.
 *
 * Por qué importa: un `$n` sin bind, o un bind sin `$n` que lo referencie,
 * revienta en Postgres real con `42P18` ("could not determine data type of
 * parameter") — Postgres infiere el tipo de cada parámetro por dónde
 * aparece EN EL TEXTO de la consulta, y uno que no aparece ahí no tiene de
 * dónde inferirlo. Un mock de `Db.query`/`DataSource.query` en un test
 * unitario NUNCA ve este error: devuelve la fila que se le pida sin mirar
 * los binds. Esta función es la única manera de que un test unitario
 * (sin Postgres real) pueda fallar por este bug.
 *
 * `params` es opcional porque así es la firma real de `Db.query(sql,
 * params?)` — algunos sitios destructuran `jest.Mock.mock.calls` sin
 * castear la tupla y el tipo de esa posición sale `unknown[] | undefined`.
 *
 * Extraído (ítem 3 de `2026-09-19-residuos-hora-de-corte`, fix round 1):
 * vivía copiado, con esta misma lógica, en CUATRO specs — dos veces inline
 * (`resumen-negocio.service.spec.ts`, `caja.service.spec.ts`) y dos como
 * helper local del archivo (`propina-reportes.service.spec.ts`, y el que
 * agregó `pagos.service.spec.ts`). Va en `common/db/` porque las cuatro
 * copias verifican lo mismo: llamadas a `Db.query`, no lógica de un módulo
 * en particular — ninguna de las cuatro es más dueña que las otras.
 */
export function assertSinHuecos(
  sql: string,
  params: unknown[] | undefined,
): void {
  const referenciados = new Set(
    Array.from(sql.matchAll(/\$(\d+)/g)).map((m) => Number(m[1])),
  );
  const total = params?.length ?? 0;
  expect(Math.max(0, ...referenciados)).toBeLessThanOrEqual(total);
  for (let i = 1; i <= total; i++) {
    expect(referenciados.has(i)).toBe(true);
  }
}
