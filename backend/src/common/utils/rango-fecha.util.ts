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

/** Día del negocio del tenant: zona horaria + hora de corte (0-6). */
export interface DiaNegocio {
  zona: string;
  horaCorte: number;
}

/** Posiciones ($n, 1-based) de zona y corte en la lista de params del llamador. */
export interface IdxDiaNegocio {
  zona: number;
  corte: number;
}

/**
 * ¿Hay que resolver el día del negocio del tenant para estos bordes?
 *
 * Solo si alguno es fecha pura: el timestamp no la usa. **No es una
 * optimización, es corrección** — Postgres rechaza el bind con un parámetro que
 * la consulta no referencia (*"bind message supplies N parameters, but prepared
 * statement requires N-1"*), así que pasar la zona/corte "por si acaso" cuando
 * los dos bordes vienen con hora tira un 500. Lo cazó el e2e al filtrar con un
 * timestamp.
 */
export function requiereDiaNegocio(
  ...valores: (string | undefined | null)[]
): boolean {
  return valores.some((v) => v != null && v !== '' && esFechaPura(v));
}

/**
 * Empuja `zona` y `horaCorte` a la lista de params del llamador y devuelve
 * sus posiciones (`$n`, 1-based) para pasarlas a `bordeFechaSql`/
 * `bordeHastaSql`/`inicioDiaNegocioSql`.
 */
export function empujarDiaNegocio(
  params: unknown[],
  dia: DiaNegocio,
): IdxDiaNegocio {
  params.push(dia.zona);
  const zona = params.length;
  params.push(dia.horaCorte);
  return { zona, corte: params.length };
}

/** Instante en que empieza el día del negocio `fechaSql` (una expresión `date`). */
export function inicioDiaNegocioSql(
  fechaSql: string,
  idx: IdxDiaNegocio,
): string {
  return `((${fechaSql})::timestamp + make_interval(hours => $${idx.corte}::int)) AT TIME ZONE $${idx.zona}`;
}

function exigirIdx(idx: IdxDiaNegocio | null): IdxDiaNegocio {
  if (idx == null) {
    throw new Error(
      'rango-fecha: hay una fecha pura sin zona ni corte resueltos (requiereDiaNegocio)',
    );
  }
  return idx;
}

/**
 * Fragmento SQL para un borde de rango, resolviendo fecha pura vs timestamp.
 *
 * - Fecha pura → el inicio del **día del negocio** de esa fecha: la
 *   medianoche local **más la hora de corte del tenant** (`inicioDiaNegocioSql`).
 *   Con corte 0 es exactamente la medianoche local de siempre.
 * - Timestamp → `columna >= $n`, tal cual vino: ya trae su instante.
 *
 * `idxValor` es la posición de parámetro ya reservada por el llamador
 * (`$1`-based); `idx` son las de zona/corte (`null` si ningún borde del
 * llamador es fecha pura — ver `requiereDiaNegocio`).
 */
export function bordeFechaSql(
  columna: string,
  operador: '>=' | '<=' | '<' | '>',
  valor: string,
  idxValor: number,
  idx: IdxDiaNegocio | null,
): string {
  return esFechaPura(valor)
    ? ` AND ${columna} ${operador} (${inicioDiaNegocioSql(`$${idxValor}::date`, exigirIdx(idx))})`
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
 *
 * Igual que `bordeFechaSql`, una fecha pura expande al **día del negocio**
 * (medianoche local + hora de corte): "hasta el 16" incluye el 16 completo
 * empezando donde el tenant corta su jornada, no a medianoche calendario.
 */
export function bordeHastaSql(
  columna: string,
  valor: string,
  idxValor: number,
  idx: IdxDiaNegocio | null,
): string {
  return esFechaPura(valor)
    ? ` AND ${columna} < (${inicioDiaNegocioSql(`$${idxValor}::date + 1`, exigirIdx(idx))})`
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
 *
 * Trae también `hora_corte` (0-6, Task 1 de `hora-de-corte`): la hora del
 * tenant en que "cambia el día" para reportes y filtros. Vive en la misma
 * fila de `tenants`, así que sale de la misma consulta y no de una segunda —
 * ver `diaNegocioTenant`, que es la versión completa; `zonaHorariaTenant`
 * queda como el subconjunto que solo necesita la zona.
 */
export async function diaNegocioTenant(
  db: DataSource | EntityManager | Db,
  tenantId: string,
): Promise<DiaNegocio> {
  const rows: { zona_horaria: string; hora_corte: number }[] = await db.query(
    `SELECT pr.zona_horaria AS zona_horaria,
            t.hora_corte AS hora_corte
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
  return { zona: rows[0].zona_horaria, horaCorte: Number(rows[0].hora_corte) };
}

/**
 * La mitad de `diaNegocioTenant` que solo necesita la zona (sin corte): los
 * llamadores que colapsan un instante a fecha/hora de calendario (`Intl`, más
 * abajo) no usan el corte, así que no vale la pena que pidan el día del
 * negocio completo.
 */
export async function zonaHorariaTenant(
  db: DataSource | EntityManager | Db,
  tenantId: string,
): Promise<string> {
  return (await diaNegocioTenant(db, tenantId)).zona;
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
  return instanteLocalEnZona(await zonaHorariaTenant(db, tenantId), instante);
}

/**
 * La mitad PURA de `instanteLocalTenant`: colapsa el instante con una zona ya
 * resuelta, sin tocar la base.
 *
 * Existe porque hay un llamador que colapsa **muchos** instantes del mismo
 * tenant —las promociones miden su ventana contra el `creado_el` de CADA línea
 * de la cuenta— y `instanteLocalTenant` resuelve la zona con una consulta cada
 * vez: una cuenta de 12 líneas serían 12 viajes idénticos a `tenants`, que es
 * un N+1 de manual. Con esto la zona se resuelve UNA vez
 * (`zonaHorariaTenant`) y el resto es aritmética de `Intl`.
 *
 * No es una versión "rápida" con otra semántica: `instanteLocalTenant` es hoy
 * esta función más la consulta de la zona, así que las dos no pueden derivar.
 */
export function instanteLocalEnZona(
  zona: string,
  instante: Date,
): InstanteLocal {
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

/**
 * `fecha` (pura, `YYYY-MM-DD`) menos `dias`, en aritmética de CALENDARIO —no
 * de instante—: `Date.UTC` se usa acá como calculadora de fechas, nunca como
 * instante real. Restar sobre un `Date` construido desde la zona del PROCESO
 * (`new Date(fecha)` + `setDate`) movería el día en algún huso: mismo cuidado
 * que `bordeHastaSql` exige para el borde superior en SQL, llevado al lado
 * TypeScript.
 *
 * Se movió acá desde `resumen-negocio.service.ts` (2026-09-18, Task 2 de
 * `hora-de-corte`): `diaNegocioEnZona`, abajo, la necesita para el mismo
 * cálculo ("hace 7 días" del día del negocio) y no tenía sentido duplicarla.
 */
export function fechaMenosDias(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/**
 * El día del NEGOCIO —no el de calendario— en el que cae un instante, para el
 * tenant cuyo `DiaNegocio` (zona + corte) ya se resolvió.
 *
 * Colapsa primero a hora LOCAL (`instanteLocalEnZona`, DST-correcto vía
 * `Intl`) y recién ahí resta el corte **sobre la fecha**, no sobre el
 * instante: restar horas al instante y colapsar después puede aterrizar en el
 * día de calendario equivocado la noche del cambio de horario (spec § 5 —
 * medido con el salto del 2026-09-06 en Santiago: restar 5h al instante da
 * sábado, pero la hora local ya es domingo 00:xx-05:29, que tiene que seguir
 * siendo domingo).
 *
 * Corte 0 es el caso trivial: nunca es menor que la hora, así que el día del
 * negocio siempre es el de calendario — mismo comportamiento que antes de
 * esta feature.
 */
export function diaNegocioEnZona(dia: DiaNegocio, instante: Date): string {
  const { fecha, hora } = instanteLocalEnZona(dia.zona, instante);
  return Number(hora.slice(0, 2)) < dia.horaCorte
    ? fechaMenosDias(fecha, 1)
    : fecha;
}

/**
 * La contraparte en SQL de `diaNegocioEnZona`, para cuando el "hoy"/la serie
 * se calcula DENTRO de la consulta (`GROUP BY` de una tendencia, un `SELECT`
 * de `NOW()`) y no sobre un `Date` ya en memoria — un viaje a la base solo
 * para colapsar un instante sería el mismo desperdicio que el docblock de
 * `fechaLocalTenant` documenta para el otro sentido.
 *
 * Mismo orden que su gemela TypeScript y por la misma razón (spec § 5,
 * medido con el salto del 2026-09-06 en Santiago): primero `AT TIME ZONE`
 * para llegar a hora LOCAL, y RECIÉN AHÍ se resta el corte — sobre la hora
 * local, no sobre el instante crudo. Restar el corte al instante y convertir
 * a zona después puede aterrizar en el día de calendario equivocado la noche
 * del cambio de horario: restar 5h al instante da sábado, pero la hora local
 * ya es domingo 00:xx-05:29, que tiene que seguir siendo domingo.
 *
 * Corte 0 es el caso trivial: `make_interval(hours => 0)` no mueve nada, así
 * que el día del negocio es el de calendario — mismo comportamiento que
 * antes de esta feature.
 */
export function diaNegocioDeSql(
  instanteSql: string,
  idx: IdxDiaNegocio,
): string {
  return `(((${instanteSql}) AT TIME ZONE $${idx.zona}) - make_interval(hours => $${idx.corte}::int))::date`;
}
