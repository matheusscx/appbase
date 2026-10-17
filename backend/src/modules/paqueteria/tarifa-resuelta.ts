/**
 * La regla de qué tarifa de pago le corresponde a una entrega, en SQL y en UN solo lugar
 * (docs/features/paqueteria.md, regla 10): la del paquete; si no tiene, la del repartidor de la
 * hoja; si no tiene, la por defecto viva del tenant. La del paquete REEMPLAZA, no se suma.
 *
 * Es una expresión escalar que devuelve un `tarifa_pago_id` (o NULL si no hay ninguna), pensada
 * para colgarla de un `JOIN tarifas_pago t ON t.tarifa_pago_id = <expresión>`: la usan el
 * `UPDATE … FROM` que fija el pago al entregar y la lectura del pago estimado de una línea en
 * ruta, así lo que se estima y lo que se congela no pueden diferir. Nadie lee tarifas en
 * TypeScript para repetir esta cadena.
 *
 * Cada candidato se mira por separado y se descarta si está borrado: un candidato borrado no
 * debe tapar al siguiente. Una tarifa DESACTIVADA sí vale para el paquete o el repartidor que ya
 * la tenían (desactivar la saca de los selectores, no de lo asignado); la por defecto está
 * siempre activa.
 */
export interface AliasTarifaResuelta {
  /** Alias de `paquetes` en la consulta que la usa. */
  paquete: string;
  /** Alias de `repartidores` (el de la hoja de la línea) en la consulta que la usa. */
  repartidor: string;
}

export const tarifaResueltaSql = ({
  paquete,
  repartidor,
}: AliasTarifaResuelta): string => `COALESCE(
    (SELECT t1.tarifa_pago_id FROM tarifas_pago t1
      WHERE t1.tarifa_pago_id = ${paquete}.tarifa_pago_id
        AND t1.tenant_id = ${paquete}.tenant_id AND t1.eliminado_el IS NULL),
    (SELECT t2.tarifa_pago_id FROM tarifas_pago t2
      WHERE t2.tarifa_pago_id = ${repartidor}.tarifa_pago_id
        AND t2.tenant_id = ${paquete}.tenant_id AND t2.eliminado_el IS NULL),
    (SELECT t3.tarifa_pago_id FROM tarifas_pago t3
      WHERE t3.tenant_id = ${paquete}.tenant_id AND t3.es_defecto
        AND t3.eliminado_el IS NULL)
  )`;

/**
 * El `UPDATE … FROM` que FIJA el pago en una línea (`hoja_ruta_paquetes l`): lo que entregar
 * (`marcar`, `entregarTodos`) y corregir la tarifa de un paquete ya entregado necesitan. Junta la
 * hoja, el repartidor, el paquete y la tarifa que `tarifaResueltaSql` elige; el que llama usa
 * `tr.tarifa_pago_id` y `tr.monto` en el `SET` y suma sus propias condiciones en el `WHERE`.
 *
 * Si no hay tarifa que resolver (ninguna, ni por defecto) la línea no entra al `FROM` y el
 * `UPDATE` no toca nada: quien llama lo ve en las filas devueltas. Va en el `WHERE` y no en un
 * `JOIN … ON` porque el destino del `UPDATE` no se puede nombrar en el `ON` de un `FROM`.
 */
export const PAGO_RESUELTO_SQL = {
  from: 'hojas_ruta h, repartidores r, paquetes p, tarifas_pago tr',
  donde: `h.hoja_ruta_id = l.hoja_ruta_id AND h.tenant_id = l.tenant_id AND h.eliminado_el IS NULL
    AND r.repartidor_id = h.repartidor_id AND r.tenant_id = l.tenant_id AND r.eliminado_el IS NULL
    AND p.paquete_id = l.paquete_id AND p.tenant_id = l.tenant_id AND p.eliminado_el IS NULL
    AND tr.tarifa_pago_id = ${tarifaResueltaSql({ paquete: 'p', repartidor: 'r' })}
    AND tr.tenant_id = l.tenant_id`,
} as const;

/**
 * La regla de qué tarifa de ENVÍO se cobra por un paquete, en SQL y en UN solo lugar
 * (docs/features/paqueteria.md, regla 10b): la del paquete; si no tiene, la por defecto viva del
 * tenant. No hay nivel repartidor: cobrar el envío no depende de quién lo lleva. Mismas reglas
 * que `tarifaResueltaSql`: cada candidato se mira por separado y se descarta si está borrado; una
 * tarifa DESACTIVADA sí vale para el paquete que ya la tenía.
 *
 * Devuelve un `tarifa_envio_id` (o NULL si no hay ninguna) para colgarlo de un
 * `tarifas_envio te ON te.tarifa_envio_id = <expresión>`.
 */
export const tarifaEnvioResueltaSql = (paquete: string): string => `COALESCE(
    (SELECT e1.tarifa_envio_id FROM tarifas_envio e1
      WHERE e1.tarifa_envio_id = ${paquete}.tarifa_envio_id
        AND e1.tenant_id = ${paquete}.tenant_id AND e1.eliminado_el IS NULL),
    (SELECT e2.tarifa_envio_id FROM tarifas_envio e2
      WHERE e2.tenant_id = ${paquete}.tenant_id AND e2.es_defecto
        AND e2.eliminado_el IS NULL)
  )`;

/**
 * La mitad "precio" del `UPDATE … FROM` que fija una línea (`hoja_ruta_paquetes l`): se SUMA a
 * `PAGO_RESUELTO_SQL` (`FROM ${PAGO.from}, ${PRECIO.from} WHERE … AND ${PAGO.donde} AND
 * ${PRECIO.donde}`) para que entregar fije pago y precio en UNA sentencia, o se usa sola
 * (`PRECIO_SOLO_SQL`) cuando solo cambió la tarifa de envío del paquete. Usa `te.tarifa_envio_id`
 * y `te.monto` en el `SET`, y depende del alias `p` (paquetes) de quien la junta.
 */
export const PRECIO_RESUELTO_SQL = {
  from: 'tarifas_envio te',
  donde: `te.tarifa_envio_id = ${tarifaEnvioResueltaSql('p')}
    AND te.tenant_id = l.tenant_id`,
} as const;

/**
 * Para corregir SOLO el precio de una línea ya entregada (cambió la tarifa de envío del paquete):
 * la hoja y el paquete de la línea más la tarifa resuelta, sin pedir que haya una de pago.
 */
export const PRECIO_SOLO_SQL = {
  from: `hojas_ruta h, paquetes p, ${PRECIO_RESUELTO_SQL.from}`,
  donde: `h.hoja_ruta_id = l.hoja_ruta_id AND h.tenant_id = l.tenant_id AND h.eliminado_el IS NULL
    AND p.paquete_id = l.paquete_id AND p.tenant_id = l.tenant_id AND p.eliminado_el IS NULL
    AND ${PRECIO_RESUELTO_SQL.donde}`,
} as const;
