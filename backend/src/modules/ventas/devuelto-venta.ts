/**
 * Lo devuelto por las correcciones, escrito UNA vez.
 *
 *   devuelto = efectivo que salió de la caja + reversa en la máquina o el banco
 *            + REFUND aprobado de pasarela
 *
 * Es lo que se resta del cobrado. Lo leen el "Cobrado" del inicio
 * (`ResumenNegocioService.hoy`) y el resumen de Pagos (`PagosService.resumen`):
 * los dos usan este fragmento, así que el mismo día no puede dar dos devueltos.
 *
 * **Sin contar dos veces.** Cada devolución entra en un solo bloque:
 * - `e` — efectivo: la salida de caja que lleva el `venta_id` de una
 *   corrección. Un retiro de caja no lleva `venta_id` y no entra. La caja no
 *   tiene `tenant_id`: el alcance va por la corrección.
 * - `m` — máquina o banco: la corrección "por un pago" de un medio que NO es
 *   efectivo. La plata volvió reversando en el terminal o por transferencia, y
 *   eso no deja salida de caja ni REFUND, así que ni `e` ni `r` lo ven. Se
 *   cuenta por su `total_final` y en SU fecha. `devolucion_via = 'pago'`
 *   descarta la `sin_plata` (no devolvió nada) y la de pasarela (la cuenta `r`
 *   por su REFUND); el `NOT EXISTS` descarta la que sí dejó salida de caja (el
 *   efectivo, que ya cuenta `e`). Una legacy con `devolucion_via` NULL tampoco
 *   entra: solo cuenta por su salida de caja, si la tuvo. `e` y `m` son
 *   complementarios por construcción.
 * - `r` — pasarela, con o sin NC (D6). Solo de órdenes con venta: el cobro de
 *   una orden sin venta nunca entró a pagos, así que su reembolso tampoco sale
 *   del cobrado. El reembolso del webhook no deja salida de caja (no pide
 *   devolver dinero), así que `r` y `e` no se pisan.
 *
 * Spec 2026-10-01-vendido-neto § 3.2. La suma es de `numeric` en Postgres
 * (exacta): `pasarela_transacciones.monto` trae escala 6 y `movimientos_caja` 4,
 * así que quien lo lee lo cuantiza con `toFixed`.
 *
 * Los alias internos llevan prefijo `dv_` para no pisar los de la consulta que
 * lo incluye.
 */

/**
 * Una ventana de tiempo: recibe la columna de fecha de cada fuente
 * (`dv_mc.fecha`, `dv_nc.fecha`, `dv_t.fecha_transaccion`) y devuelve la
 * condición. La ventana sin borde es `() => 'TRUE'`.
 */
export type VentanaDevuelto = (columna: string) => string;

/** Las columnas de una fila (un pago, o lo que hace de pago) que mira un alcance. */
export interface FilaDeAlcance {
  ventaId: string;
  cajaId: string;
  tenantId: string;
}

export interface DevueltoSqlParams {
  /** Posición del bind param con el `tenant_id`. */
  idxTenant: number;
  /** Una columna `devuelto_<clave>` (texto) por cada ventana. */
  ventanas: Record<string, VentanaDevuelto>;
  /**
   * Quién ve qué, si el que lee no ve todo (el cajero de Pagos sin
   * `Cajas:Leer`): la condición que hace "mío" a un pago. Una devolución es
   * del **pago que reversa** (`devolucion_pago_id`), así el "cobrado −
   * devuelto" del cajero son siempre sus filas. Una corrección vieja sin
   * `devolucion_pago_id` se juzga por la venta que corrige y su caja (la NC
   * copia el `caja_id` de la original). Un REFUND no tiene pago: entra solo
   * por la rama de la venta (online), con la caja en NULL, que no es de nadie.
   * Sin alcance, todo el tenant (el inicio, y Pagos con `verTodas`).
   */
  alcance?: (fila: FilaDeAlcance) => string;
}

/** La condición de alcance sobre la corrección `dv_nc` (bloques `e` y `m`). */
function alcanceDeLaCorreccion(
  alcance: (fila: FilaDeAlcance) => string,
): string {
  const delPago = alcance({
    ventaId: 'dv_dp.venta_id',
    cajaId: 'dv_dp.caja_id',
    tenantId: 'dv_dp.tenant_id',
  });
  const deLaVentaQueCorrige = alcance({
    ventaId: 'dv_nc.venta_referencia_id',
    cajaId: 'dv_nc.caja_id',
    tenantId: 'dv_nc.tenant_id',
  });
  return `AND CASE
               WHEN dv_nc.devolucion_pago_id IS NOT NULL THEN EXISTS (
                 SELECT 1 FROM pagos dv_dp
                  WHERE dv_dp.pago_id = dv_nc.devolucion_pago_id
                    AND dv_dp.tenant_id = dv_nc.tenant_id
                    AND dv_dp.eliminado_el IS NULL
                    AND ${delPago}
               )
               ELSE ${deLaVentaQueCorrige}
             END`;
}

/**
 * Un ítem de `FROM` de una sola fila, con una columna `devuelto_<clave>` por
 * ventana. Va con `CROSS JOIN ${devueltoSql(…)} <alias>`.
 */
export function devueltoSql(params: DevueltoSqlParams): string {
  const t = `$${params.idxTenant}`;
  const claves = Object.keys(params.ventanas);
  const { alcance } = params;
  const alcanceCorreccion = alcance ? alcanceDeLaCorreccion(alcance) : '';
  const alcanceRefund = alcance
    ? `AND ${alcance({ ventaId: 'dv_o.venta_id', cajaId: 'NULL', tenantId: 'dv_t.tenant_id' })}`
    : '';
  const sumaPor = (expr: string, columna: string, prefijo: string) =>
    claves
      .map(
        (k) =>
          `COALESCE(SUM(${expr}) FILTER (WHERE ${params.ventanas[k](columna)}), 0) AS ${prefijo}_${k}`,
      )
      .join(',\n                ');

  return `(
      SELECT ${claves
        .map(
          (k) =>
            `(dv_e.efectivo_${k} + dv_m.maquina_${k} + dv_r.pasarela_${k})::text AS devuelto_${k}`,
        )
        .join(',\n             ')}
        FROM (
          SELECT ${sumaPor('dv_mc.monto', 'dv_mc.fecha', 'efectivo')}
            FROM movimientos_caja dv_mc
            JOIN ventas dv_nc
              ON dv_nc.venta_id = dv_mc.venta_id
             AND dv_nc.venta_referencia_id IS NOT NULL
             AND dv_nc.tenant_id = ${t}
             AND dv_nc.eliminado_el IS NULL
           WHERE dv_mc.tipo = 'salida'
             AND dv_mc.eliminado_el IS NULL
             ${alcanceCorreccion}
        ) dv_e
        CROSS JOIN (
          SELECT ${sumaPor('dv_nc.total_final', 'dv_nc.fecha', 'maquina')}
            FROM ventas dv_nc
           WHERE dv_nc.tenant_id = ${t}
             AND dv_nc.venta_referencia_id IS NOT NULL
             AND dv_nc.devolucion_via = 'pago'
             AND dv_nc.eliminado_el IS NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM movimientos_caja dv_mc
                WHERE dv_mc.venta_id = dv_nc.venta_id
                  AND dv_mc.tipo = 'salida'
                  AND dv_mc.eliminado_el IS NULL
             )
             ${alcanceCorreccion}
        ) dv_m
        CROSS JOIN (
          SELECT ${sumaPor('dv_t.monto', 'dv_t.fecha_transaccion', 'pasarela')}
            FROM pasarela_transacciones dv_t
            JOIN pasarela_ordenes dv_o
              ON dv_o.orden_id = dv_t.orden_id
             AND dv_o.tenant_id = dv_t.tenant_id
             AND dv_o.venta_id IS NOT NULL
             AND dv_o.eliminado_el IS NULL
           WHERE dv_t.tenant_id = ${t}
             AND dv_t.tipo = 'REFUND'
             AND dv_t.estado = 'aprobada'
             AND dv_t.eliminado_el IS NULL
             ${alcanceRefund}
        ) dv_r
    )`;
}
