import type { DataSource, ObjectLiteral, Repository } from 'typeorm';

/**
 * Sufijo numérico para proponer un nombre libre cuando restaurar una fila de
 * la papelera choca con una viva que ya tomó ese nombre.
 *
 * Lo consumen los 8 recursos con unicidad de nombre por tenant (`descuentos`,
 * `recargos`, `turnos`, `cajones`, `causas-merma`, `motivos-diferencia`,
 * `motivos-diferencia-inventario`, `grupos-modificadores`), y los 8 la detectan
 * igual: capturando el `23505` de Postgres, o sea recién DESPUÉS de que falla
 * el UPDATE que revive la fila. Pre-consultar sería una query extra en TODOS
 * los restaurar sin poder sacar el `catch` —entre consultar y escribir, otra
 * transacción puede tomar el nombre—, así que es una opción dominada.
 *
 * ⚠️ `garzones` NO usa esto: también devuelve 400 al restaurar, pero su
 * colisión no es de nombre (`uq_garzones_mostrador_tenant` permite un solo
 * placeholder "Mostrador" vivo por tenant). Renombrar no la resuelve.
 */

/**
 * Nombre sin su último grupo de dígitos: "Black Friday 2" → "Black Friday".
 * **No decide sola si hay que sacarlo** — para eso está `baseParaSugerir`.
 */
export function baseSinSufijo(nombre: string): string {
  return nombre.replace(/ \d+$/, '');
}

/**
 * Sobre qué base se numera. NO alcanza con sacar el número final: hay nombres
 * donde el número es parte del nombre y no un sufijo nuestro ("Descuento 50",
 * "Turno 2", "Caja 3"). Sacárselo produciría "Descuento 2", que pierde el
 * significado y encima compite con otra familia de nombres.
 *
 * La regla: el número final se trata como sufijo **solo si la base pelada está
 * realmente en juego**, o sea si existe una fila viva llamada exactamente así.
 * Es la única señal de que ese número lo pusimos nosotros — no podríamos haber
 * generado "X 2" si "X" no existiera.
 *
 *   "Black Friday 2" + hay un "Black Friday" vivo  → base "Black Friday"
 *   "Descuento 50"   + no hay ningún "Descuento"   → base "Descuento 50"
 *
 * (Lo encontró el e2e contra Postgres real: el nombre de la fixture terminaba
 * en un timestamp y la sugerencia le arrancó los dígitos.)
 */
export function baseParaSugerir(
  nombreIntentado: string,
  tomados: string[],
  ignorarMayusculas = false,
): string {
  const pelado = baseSinSufijo(nombreIntentado);
  if (pelado === nombreIntentado) return nombreIntentado;
  const clave = (s: string) => (ignorarMayusculas ? s.toLowerCase() : s);
  return tomados.map(clave).includes(clave(pelado)) ? pelado : nombreIntentado;
}

/**
 * Primer `"<base> N"` libre con N ≥ 2. El 1 no se usa: el "1" implícito es la
 * fila viva que ya ocupa la base.
 *
 * `tomados` son los nombres VIVOS del tenant que compiten (los que empiezan
 * con la base pelada, que es un superconjunto de los que empiezan con la base
 * final); quien llame debe pasarlos tal cual están en la base de datos.
 * Devuelve siempre un nombre distinto de los tomados — si `base 2` … `base N`
 * están todos ocupados, sigue subiendo.
 *
 * `ignorarMayusculas` tiene que reflejar **cómo enforcea la unicidad la tabla
 * de destino**, no una preferencia. Desde el 2026-08-01 las 8 la indexan por
 * `lower(nombre)` (decisión del owner: "Extras" y "extras" son el mismo
 * nombre), así que las 8 llamadas lo pasan en `true` — pero el parámetro sigue
 * existiendo porque es la tabla la que manda, no una convención: si mañana
 * alguna se indexa distinto, el default en `false` sobre una tabla
 * case-insensitive haría sugerir "Merma 2" habiendo un "merma 2" vivo, un
 * nombre que **vuelve a chocar** y el usuario recibe el mismo 400 tras
 * confirmar el modal.
 */
export function sugerirNombreLibre(
  nombreIntentado: string,
  tomados: string[],
  ignorarMayusculas = false,
): string {
  const clave = (s: string) => (ignorarMayusculas ? s.toLowerCase() : s);
  const base = baseParaSugerir(nombreIntentado, tomados, ignorarMayusculas);
  const ocupados = new Set(tomados.map(clave));
  for (let n = 2; ; n++) {
    const candidato = `${base} ${n}`;
    if (!ocupados.has(clave(candidato))) return candidato;
  }
}

/**
 * Patrón `LIKE` para traer de la base los nombres que compiten con `base`:
 * el propio `base` y cualquier `"<base> …"`. Escapa los comodines de `LIKE`
 * (`%`, `_`, `\`) para que un nombre como "50%_off" no matchee de más — sin
 * esto, un nombre con `%` traería filas ajenas y la sugerencia saltearía
 * números libres. Usar siempre con `ESCAPE '\'`.
 */
export function patronLikeNombre(base: string): string {
  const escapado = base.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `${escapado} %`;
}

/**
 * Cuerpo del 400 de colisión al restaurar: el mensaje y un nombre libre para
 * reintentar. Es lo que la pantalla precarga en el campo editable del modal.
 *
 * Trae en UNA query todos los nombres VIVOS que compiten con la base (el propio
 * `base` y cualquier `"<base> …"`); numerar es después aritmética en memoria.
 * Un `SELECT` por candidato sería un N+1 disfrazado de bucle.
 *
 * Sirve para cualquier recurso de la papelera porque las 8 tablas con unicidad
 * de nombre comparten exactamente las tres columnas que toca —`tenant_id`,
 * `nombre`, `eliminado_el`— **verificado contra `information_schema` el
 * 2026-08-01**, no asumido por parecido de nombre.
 *
 * Extraído acá al aparecer el TERCER consumidor (`turnos`), que es la regla del
 * proyecto (`CLAUDE.md` → Convenciones → Archivos: duplicar dos veces es
 * aceptable, se extrae a la tercera). Antes vivía duplicado en
 * `descuentos.service.ts` y `recargos.service.ts`.
 *
 * `alias` se interpola en el SQL, así que **tiene que ser una constante del
 * código** (`'d'`, `'r'`, `'t'`, `'c'`) y nunca un dato de request. Los valores
 * sí van parametrizados.
 */
export async function errorDeColisionNombre<T extends ObjectLiteral>(
  repo: Repository<T>,
  alias: string,
  sujeto: string,
  tenantId: string,
  nombre: string,
  opciones: { ignorarMayusculas?: boolean } = {},
): Promise<{ message: string; nombreSugerido: string }> {
  const { ignorarMayusculas = false } = opciones;
  const base = baseSinSufijo(nombre);
  // El `WHERE` tiene que comparar como compara el ÍNDICE de la tabla, o la
  // sugerencia ignora filas que sí compiten: `ILIKE`/`lower()` donde el índice
  // es sobre `lower(nombre)`, comparación exacta donde es sobre `nombre`.
  const comparacion = ignorarMayusculas
    ? `(lower(${alias}.nombre) = lower(:base) OR ${alias}.nombre ILIKE :patron ESCAPE '\\')`
    : `(${alias}.nombre = :base OR ${alias}.nombre LIKE :patron ESCAPE '\\')`;
  const filas = await repo
    .createQueryBuilder(alias)
    .select(`${alias}.nombre`, 'nombre')
    .where(`${alias}.tenant_id = :tenantId`, { tenantId })
    .andWhere(`${alias}.eliminado_el IS NULL`)
    .andWhere(comparacion, { base, patron: patronLikeNombre(base) })
    .getRawMany<{ nombre: string }>();
  return armarError(
    sujeto,
    nombre,
    filas.map((f) => f.nombre),
    ignorarMayusculas,
  );
}

/**
 * Igual que `errorDeColisionNombre` pero para los services que hablan SQL
 * cruda y **no tienen repositorio** (`causas-merma`, `motivos-diferencia`,
 * `motivos-diferencia-inventario`, `grupos-modificadores`: los cuatro
 * resuelven el restaurar con un `UPDATE … RETURNING` sobre `dataSource`).
 *
 * Existe como gemela y no como parámetro opcional de la otra porque lo que
 * cambia es el motor de la query, no un detalle: `Repository.createQueryBuilder`
 * y `DataSource.query` no se sustituyen entre sí. El cálculo lo comparten.
 *
 * `tabla` se interpola en el SQL: **constante del código, nunca dato de
 * request**. Los valores van parametrizados (`$1`, `$2`).
 */
export async function errorDeColisionNombreSQL(
  ds: DataSource,
  tabla: string,
  sujeto: string,
  tenantId: string,
  nombre: string,
  opciones: { ignorarMayusculas?: boolean } = {},
): Promise<{ message: string; nombreSugerido: string }> {
  const { ignorarMayusculas = false } = opciones;
  const base = baseSinSufijo(nombre);
  const comparacion = ignorarMayusculas
    ? `(lower(nombre) = lower($2) OR nombre ILIKE $3 ESCAPE '\\')`
    : `(nombre = $2 OR nombre LIKE $3 ESCAPE '\\')`;
  const filas: { nombre: string }[] = await ds.query(
    `SELECT nombre FROM ${tabla}
      WHERE tenant_id = $1 AND eliminado_el IS NULL AND ${comparacion}`,
    [tenantId, base, patronLikeNombre(base)],
  );
  return armarError(
    sujeto,
    nombre,
    filas.map((f) => f.nombre),
    ignorarMayusculas,
  );
}

/**
 * `sujeto` es la frase nominal COMPLETA, con artículo y adjetivo ya
 * concordados ("un descuento activo", "una causa de merma activa"). Antes era
 * solo el sustantivo y el template ponía "un … activo" fijo, que producía
 * "Ya existe un causa de merma activo" en cuanto la etiqueta era femenina —
 * y el bug volvía con cada recurso nuevo de género femenino. Con la frase
 * armada por quien llama, la concordancia no puede quedar mal desde acá.
 */
function armarError(
  sujeto: string,
  nombre: string,
  tomados: string[],
  ignorarMayusculas: boolean,
): { message: string; nombreSugerido: string } {
  return {
    message: `Ya existe ${sujeto} con el nombre "${nombre}".`,
    nombreSugerido: sugerirNombreLibre(nombre, tomados, ignorarMayusculas),
  };
}
