import type { ObjectLiteral, Repository } from 'typeorm';

/**
 * Sufijo numérico para proponer un nombre libre cuando restaurar una fila de
 * la papelera choca con una viva que ya tomó ese nombre.
 *
 * Lo consumen los recursos con unicidad de nombre por tenant (`descuentos`,
 * `recargos`, `turnos`, `cajones`, `causas-merma`, `motivos-diferencia`,
 * `motivos-diferencia-inventario`, `grupos-modificadores`). Hoy están los 3
 * primeros; los 5 restantes quedan en `docs/agent/pendientes.md` y **no son un
 * copiar-pegar**: detectan la colisión capturando el `23505` de Postgres, o sea
 * recién DESPUÉS de fallar el INSERT, mientras estos 3 —que garantizan la
 * unicidad solo por código, sin índice— pueden consultar antes.
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
): string {
  const pelado = baseSinSufijo(nombreIntentado);
  if (pelado === nombreIntentado) return nombreIntentado;
  return tomados.includes(pelado) ? pelado : nombreIntentado;
}

/**
 * Primer `"<base> N"` libre con N ≥ 2. El 1 no se usa: el "1" implícito es la
 * fila viva que ya ocupa la base.
 *
 * `tomados` son los nombres VIVOS del tenant que compiten (los que empiezan
 * con la base pelada, que es un superconjunto de los que empiezan con la base
 * final); la comparación es exacta, así que quien llame debe pasarlos tal cual
 * están en la base de datos. Devuelve siempre un nombre distinto de los
 * tomados — si `base 2` … `base N` están todos ocupados, sigue subiendo.
 */
export function sugerirNombreLibre(
  nombreIntentado: string,
  tomados: string[],
): string {
  const base = baseParaSugerir(nombreIntentado, tomados);
  const ocupados = new Set(tomados);
  for (let n = 2; ; n++) {
    const candidato = `${base} ${n}`;
    if (!ocupados.has(candidato)) return candidato;
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
 * código** (`'d'`, `'r'`, `'t'`) y nunca un dato de request. Los valores sí van
 * parametrizados.
 */
export async function errorDeColisionNombre<T extends ObjectLiteral>(
  repo: Repository<T>,
  alias: string,
  etiqueta: string,
  tenantId: string,
  nombre: string,
): Promise<{ message: string; nombreSugerido: string }> {
  const base = baseSinSufijo(nombre);
  const filas = await repo
    .createQueryBuilder(alias)
    .select(`${alias}.nombre`, 'nombre')
    .where(`${alias}.tenant_id = :tenantId`, { tenantId })
    .andWhere(`${alias}.eliminado_el IS NULL`)
    .andWhere(
      `(${alias}.nombre = :base OR ${alias}.nombre LIKE :patron ESCAPE '\\')`,
      { base, patron: patronLikeNombre(base) },
    )
    .getRawMany<{ nombre: string }>();
  return {
    message: `Ya existe un ${etiqueta} activo con el nombre "${nombre}".`,
    nombreSugerido: sugerirNombreLibre(
      nombre,
      filas.map((f) => f.nombre),
    ),
  };
}
