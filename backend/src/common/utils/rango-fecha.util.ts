import type { DataSource, EntityManager } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import type { Db } from '../db/db.service';
import type { InstanteLocal } from '../../modules/promociones/promociones.evaluator';

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
 * Zona horaria del tenant. **Sale de la PROVINCIA**, no de una preferencia del
 * tenant y no del país.
 *
 * ⚠️ Hasta el 2026-08-23 devolvía `pais.zona_horaria_principal`: esta consulta
 * pasaba *por* la provincia para llegar al país y se salteaba
 * `provincia.zona_horaria`, que existe, es `NOT NULL` y está sembrada con
 * valores distintos —`America/Santiago` y `Pacific/Easter`—. El nombre
 * «principal» del país ya decía que la provincia manda; la del país queda como
 * el default al **crear** una provincia, no como la zona con la que se calcula.
 * Nadie la lee en runtime.
 *
 * 📌 Y no era un lugar: eran **tres copias byte a byte** de esta consulta
 * —acá, en `sesiones-garzon.service.ts` y en `propina-reportes.service.ts`—.
 * Los dos privados se colapsaron contra esta función en el mismo commit, porque
 * corregir una sola habría dejado dos módulos leyendo la del país y uno la de
 * la provincia: dos nociones compitiendo, peor que el bug original.
 *
 * El `JOIN pais` se queda aunque ya no se lea su columna: es lo que impide
 * resolver la zona de un tenant cuyo país está dado de baja, y hay un test que
 * lo exige en `sesiones-garzon.service.spec.ts` —nació porque el mutante que
 * borraba estos filtros pasaba la suite entera—.
 */
export async function zonaHorariaTenant(
  db: DataSource | EntityManager | Db,
  tenantId: string,
): Promise<string> {
  const rows: { zona_horaria: string }[] = await db.query(
    `SELECT pr.zona_horaria AS zona_horaria
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

/**
 * El día del calendario **local del tenant** en el que cae un instante.
 *
 * Se usa para comparar contra columnas `date` —`fecha_inicio` / `fecha_fin` de
 * las reglas— que no llevan hora: la pregunta que contestan es "¿qué día es
 * hoy para este local?", y la respuesta cambia con el huso.
 *
 * ⚠️ **Por qué acá se convierte con `Intl` y no con Postgres, que es lo que hace
 * el resto de este archivo.** No es el mismo problema: los helpers de arriba
 * **expanden** una fecha a un rango dentro de un `WHERE`, y eso tiene que estar
 * en SQL. Acá hay que **colapsar** un instante a una fecha para compararlo
 * contra datos que ya están en memoria, y hacerlo en SQL sería un viaje a la
 * base solo para formatear. `Intl` es DST-correcto y no agrega dependencia: el
 * Node del contenedor tiene ICU completo (medido el 2026-08-23).
 *
 * `'en-CA'` no es una preferencia de idioma: es el locale cuyo formato corto ES
 * `YYYY-MM-DD`, que es exactamente la forma que comparan las columnas.
 */
export async function fechaLocalTenant(
  db: DataSource | EntityManager | Db,
  tenantId: string,
  instante: Date,
): Promise<string> {
  const zona = await zonaHorariaTenant(db, tenantId);
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(instante);
}

/** `Intl` con locale `en-US` y `weekday: 'short'` devuelve estos tres literales. */
const DIA_ISO_POR_WEEKDAY_CORTO: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * Colapsa un instante al `{fecha, hora, diaIso}` LOCAL del tenant (zona de la
 * provincia). Mismo mecanismo `Intl` que `fechaLocalTenant` y por la misma
 * razón (colapsar en memoria, no expandir en SQL — ver su docblock arriba):
 * acá además reusa esa misma función para la fecha y su resolución de zona
 * (`zonaHorariaTenant`), en vez de repetir la query.
 *
 * El retorno calza con `InstanteLocal` de `promociones.evaluator.ts` (el
 * consumidor): `hora` en `'HH:mm'` de 24 horas y `diaIso` en 1..7 con
 * 1=lunes..7=domingo (ISO 8601), no el 0=domingo de `Date#getDay`.
 *
 * ⚠️ `hourCycle: 'h23'` explícito para la hora, no `hour12: false` a secas:
 * con algún locale, `hour12: false` deja que el default de `hourCycle` del
 * locale gane y la medianoche exacta sale `'24:00'` en vez de `'00:00'` —
 * cubierto por el test de borde en el spec.
 */
export async function instanteLocalTenant(
  db: DataSource | EntityManager | Db,
  tenantId: string,
  instante: Date,
): Promise<InstanteLocal> {
  const zona = await zonaHorariaTenant(db, tenantId);

  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(
    instante,
  );
  const hora = new Intl.DateTimeFormat('en-GB', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instante);
  const weekdayCorto = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    weekday: 'short',
  }).format(instante);

  return { fecha, hora, diaIso: DIA_ISO_POR_WEEKDAY_CORTO[weekdayCorto] };
}
