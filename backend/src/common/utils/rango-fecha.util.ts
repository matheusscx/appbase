import type { DataSource, EntityManager } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import type { Db } from '../db/db.service';

/**
 * Bordes de rango por fecha en filtros de listado.
 *
 * El problema, medido como efecto lateral de ADR-019: los DTOs de estos filtros
 * validan con `@IsDateString()`, que acepta **una fecha pura** (`2026-08-01`)
 * **y** un timestamp completo (`2026-08-01T15:30:00Z`). Con la columna sin zona,
 * Postgres tomaba los dígitos literales; con `timestamptz` interpreta la fecha
 * pura en el `TimeZone` **de la sesión** antes de convertir — una dependencia
 * que antes no existía y que nadie fija explícitamente (ni el compose ni el pool).
 *
 * La decisión del owner: *"desde el 1 de agosto"* es la medianoche **del local**,
 * o sea de la zona horaria del tenant, que es lo que espera quien mira el reporte.
 *
 * Por qué NO se copia tal cual el molde de `propina-reportes.service.ts`
 * (`$N::date::timestamp AT TIME ZONE $M`): ahí el rango llega ya normalizado a
 * fechas puras (`RangoReporteNormalizado`, con `@Matches(/^\d{4}-\d{2}-\d{2}$/)`).
 * Acá no. Y `'2026-08-01T15:30:00Z'::date` devuelve `2026-08-01` — **el `::date`
 * descarta la hora en silencio**, así que aplicarlo a ciegas haría que un llamador
 * que hoy filtra desde las 15:30 pasara a filtrar desde la medianoche. Un filtro
 * que se ensancha sin avisar es peor que uno con la zona ambigua.
 *
 * Por eso la **decisión** de qué forma tiene el valor vive acá, en el service, y
 * solo la fecha pura se expande. La aritmética de la expansión sí la sigue
 * haciendo Postgres: es DST-correcta sin traer una librería de zonas, y es el
 * mismo mecanismo ya probado en propinas.
 */

/** `2026-08-01` sí; `2026-08-01T15:30:00Z` no. */
export function esFechaPura(valor: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

/**
 * ¿Hay que resolver la zona del tenant para estos bordes?
 *
 * Solo si alguno es fecha pura: el timestamp no la usa. **No es una
 * optimización, es corrección** — Postgres rechaza el bind con un parámetro que
 * la consulta no referencia (*"bind message supplies N parameters, but prepared
 * statement requires N-1"*), así que pasar la zona "por si acaso" cuando los dos
 * bordes vienen con hora tira un 500. Lo cazó el e2e al filtrar con un timestamp.
 */
export function requiereZonaTenant(
  ...valores: (string | undefined | null)[]
): boolean {
  return valores.some((v) => v != null && v !== '' && esFechaPura(v));
}

/**
 * Fragmento SQL para un borde de rango, resolviendo fecha pura vs timestamp.
 *
 * - Fecha pura → `columna >= ($n::date::timestamp AT TIME ZONE $z)`, o sea la
 *   medianoche **local del tenant** de ese día.
 * - Timestamp → `columna >= $n`, tal cual vino: ya trae su instante.
 *
 * `idxValor` e `idxZona` son posiciones de parámetro ya reservadas por el
 * llamador (`$1`-based), porque cada service arma su propia lista.
 */
export function bordeFechaSql(
  columna: string,
  operador: '>=' | '<=' | '<' | '>',
  valor: string,
  idxValor: number,
  idxZona: number,
): string {
  return esFechaPura(valor)
    ? ` AND ${columna} ${operador} ($${idxValor}::date::timestamp AT TIME ZONE $${idxZona})`
    : ` AND ${columna} ${operador} $${idxValor}`;
}

/**
 * Borde **superior** de un rango por fecha. Es un caso propio y no un
 * `bordeFechaSql(columna, '<=', …)`, por lo que le pasa a una fecha pura.
 *
 * El bug que cierra (medido el 2026-08-16, decidido por el owner el
 * 2026-08-22): `hasta` llega como `YYYY-MM-DD` —lo que emite `AppDateInput`— y
 * compararla contra un `timestamptz` la castea a la **medianoche** de ese día.
 * Con `<= hasta`, *"hasta el 16 de agosto"* dejaba fuera **el 16 entero**. No es
 * el off-by-one del huso: normalizar la zona movió ese borde, no lo creó.
 *
 * La regla es **inclusivo del día**: quien elige "16" ve el 16 completo. Se
 * resuelve en el backend y no compensando en cada pantalla, que es lo que el
 * owner eligió para que la respuesta no dependa de qué llamador la arme.
 *
 * ⚠️ **Solo se expande la fecha pura.** Un timestamp explícito
 * (`2026-08-16T15:30:00Z`) pidió ese instante como corte y sigue con `<=`:
 * sumarle un día sería el mismo ensanche mudo que `bordeFechaSql` evita al no
 * aplicarle `::date`.
 *
 * ⚠️ **`::date + 1` y no `23:59:59`.** El molde del "final del día" se come el
 * último segundo, y falla distinto según los decimales del `timestamptz`. La
 * suma la hace Postgres sobre `date`, así que es DST-correcta sin librería de
 * zonas.
 *
 * El precedente probado es `sesiones-garzon.service.ts` →
 * `buildHistorialFilters`, que ya tenía exactamente este SQL por el mismo
 * motivo ("Desde hoy / Hasta hoy" no devolvía ninguna sesión).
 */
export function bordeHastaSql(
  columna: string,
  valor: string,
  idxValor: number,
  idxZona: number,
): string {
  return esFechaPura(valor)
    ? ` AND ${columna} < (($${idxValor}::date + 1)::timestamp AT TIME ZONE $${idxZona})`
    : ` AND ${columna} <= $${idxValor}`;
}

/**
 * Zona horaria del tenant, que sale del **país**, no de una preferencia del
 * tenant — misma fuente y misma consulta que usa el reporte de propinas.
 */
export async function zonaHorariaTenant(
  db: DataSource | EntityManager | Db,
  tenantId: string,
): Promise<string> {
  const rows: { zona_horaria: string }[] = await db.query(
    `SELECT p.zona_horaria_principal AS zona_horaria
       FROM tenants t
       JOIN provincia pr
         ON pr.provincia_id = t.provincia_id
        AND pr.eliminado_el IS NULL
       JOIN pais p
         ON p.pais_id = pr.pais_id
        AND p.eliminado_el IS NULL
      WHERE t.tenant_id = $1
        AND t.eliminado_el IS NULL`,
    [tenantId],
  );
  if (!rows[0]?.zona_horaria) {
    throw new NotFoundException('No se encontró la zona horaria del tenant');
  }
  return rows[0].zona_horaria;
}
