/**
 * Sufijo numérico para proponer un nombre libre cuando restaurar una fila de
 * la papelera choca con una viva que ya tomó ese nombre.
 *
 * ⚠️ **Hoy lo consume UN solo recurso: `descuentos`.** Vive en `common/` y no en
 * su service porque el molde está pensado para los 8 con unicidad de nombre por
 * tenant (`descuentos`, `recargos`, `turnos`, `cajones`, `causas-merma`,
 * `motivos-diferencia`, `motivos-diferencia-inventario`,
 * `grupos-modificadores`) — en los 8 la ARITMÉTICA es la misma aunque la query
 * no lo sea: cada uno lee de su tabla y le pasa acá los nombres ya tomados.
 * Pero los otros 7 **todavía no están** (backlog: `docs/agent/pendientes.md`), y
 * no son un copiar-pegar: 5 detectan la colisión capturando el `23505` de
 * Postgres, o sea recién DESPUÉS de fallar el INSERT, mientras `descuentos`
 * —sin índice— puede consultar antes.
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
