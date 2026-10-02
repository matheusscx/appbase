import Decimal from 'decimal.js';
import type { EntityManager } from 'typeorm';
import { unwrap } from '../../common/utils/pg-returning.util';
import { EstadoVenta } from './entities/venta.entity';

/**
 * El saldo de una venta, escrito UNA vez.
 *
 *   saldo = total_final − Σ aplicado a la venta − Σ correcciones "sin plata"
 *
 * con piso 0. Lo que debe el cliente. Lo leen TODOS los que muestran, topan o
 * deciden con un saldo: "Por cobrar" del inicio, el saldo de `/ventas/resumen`, el
 * saldo por venta del listado y del detalle, el tope de un abono, el "no vuelve
 * plata" de las correcciones y el estado de la venta. Ninguno lo recalcula: todos
 * usan este fragmento (o `recalcularEstadoDeLaVenta`, que lo usa), así que no hay
 * dos números posibles para la misma venta.
 *
 * **Qué rebaja la deuda y qué no.** Una corrección que devolvió plata (efectivo,
 * tarjeta, pasarela) no cambia lo que se debe: el cliente ya la recibió de vuelta,
 * y esa plata sale del pagado, no de la deuda. Solo "no vuelve plata" la rebaja
 * (`ventas.devolucion_via = 'sin_plata'`). Esa es la regla de negocio de PRODUCTO
 * § 10 ("un abono cobra solo lo que de verdad se debe").
 *
 * **Correcciones sin `devolucion_via`** (anteriores a ese campo; hoy ni el seed ni
 * los tests las crean): una con salida de caja devolvió efectivo, es "con plata";
 * una sin salida de caja no deja otro rastro de plata devuelta, así que cuenta como
 * "sin plata" —es lo que hacía la fórmula anterior (total − notas − pagado)—.
 *
 * **Un fragmento SQL y no una función de la base**: el esquema sale de las
 * entities (`synchronize`), y una función de SQL no tendría dónde declararse. Va
 * dentro de la misma consulta que ya lee las ventas, como subconsultas
 * correlacionadas: no es una consulta por venta.
 *
 * Los alias internos llevan prefijo `sv_` para no pisar los de la consulta que lo
 * incluye.
 */

/** Los estados de una venta que admiten un abono. La usa también el detalle. */
export const ESTADOS_QUE_ADMITEN_ABONO: readonly string[] = [
  EstadoVenta.PENDIENTE,
  EstadoVenta.PAGADA_PARCIAL,
];

/** ¿Se puede registrar un pago? Hace falta un estado que lo admita Y algo que deber. */
export function puedeAbonar(estado: string, saldo: string): boolean {
  return ESTADOS_QUE_ADMITEN_ABONO.includes(estado) && new Decimal(saldo).gt(0);
}

/** ¿La venta `c` (una corrección) rebajó lo que se debía, sin devolver plata? */
function correccionSinPlataSql(c: string): string {
  return `(${c}.devolucion_via = 'sin_plata'
        OR (${c}.devolucion_via IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM movimientos_caja sv_mc
               WHERE sv_mc.venta_id = ${c}.venta_id
                 AND sv_mc.tipo = 'salida'
                 AND sv_mc.eliminado_el IS NULL)))`;
}

/**
 * Lo aplicado a la venta `v`: `pago_aplicaciones` con `tipo = 'venta'`, no
 * `pagos.monto` (que trae el vuelto y la propina).
 */
export function aplicadoDeVentaSql(v: string): string {
  return `COALESCE((
            SELECT SUM(sv_pa.monto)
              FROM pagos sv_p
              JOIN pago_aplicaciones sv_pa
                ON sv_pa.pago_id = sv_p.pago_id
               AND sv_pa.tipo = 'venta'
               AND sv_pa.eliminado_el IS NULL
             WHERE sv_p.venta_id = ${v}.venta_id
               AND sv_p.tenant_id = ${v}.tenant_id
               AND sv_p.eliminado_el IS NULL
          ), 0)`;
}

/**
 * El saldo de la venta `v` (el alias de `ventas` en la consulta que lo incluye).
 * Una corrección no es una venta que se deba: da 0.
 */
export function saldoDeVentaSql(v: string): string {
  return `(CASE WHEN ${v}.venta_referencia_id IS NOT NULL THEN 0
         ELSE GREATEST(
           ${v}.total_final
           - ${aplicadoDeVentaSql(v)}
           - COALESCE((
               SELECT SUM(sv_c.total_final)
                 FROM ventas sv_c
                WHERE sv_c.venta_referencia_id = ${v}.venta_id
                  AND sv_c.tenant_id = ${v}.tenant_id
                  AND sv_c.eliminado_el IS NULL
                  AND ${correccionSinPlataSql('sv_c')}
             ), 0),
           0)
       END)`;
}

/**
 * El estado de una venta sale de su saldo, en UN solo lugar: sin saldo es
 * `pagada`; con saldo y algo aplicado, `pagada_parcial`; con saldo y nada
 * aplicado, `pendiente`. Lo corre cada operación que mueve lo que se debe (crear
 * la venta, un abono, una corrección "sin plata"), bajo el lock de la venta, y
 * devuelve el estado y el saldo resultantes.
 *
 * Nunca toca una venta cancelada.
 */
export async function recalcularEstadoDeLaVenta(
  manager: EntityManager,
  tenantId: string,
  ventaId: string,
): Promise<{ estado: EstadoVenta; saldo: string }> {
  const filas = unwrap<{ estado: EstadoVenta; saldo: string }>(
    await manager.query(
      `WITH s AS (
       SELECT v.venta_id,
              ${saldoDeVentaSql('v')} AS saldo,
              ${aplicadoDeVentaSql('v')} AS aplicado
         FROM ventas v
        WHERE v.venta_id = $1
          AND v.tenant_id = $2
          AND v.eliminado_el IS NULL
          AND v.estado <> 'cancelada'
     )
     UPDATE ventas
        SET estado = (CASE WHEN s.saldo <= 0 THEN 'pagada'
                           WHEN s.aplicado > 0 THEN 'pagada_parcial'
                           ELSE 'pendiente' END)::ventas_estado_enum,
            actualizado_el = NOW()
       FROM s
      WHERE ventas.venta_id = s.venta_id
  RETURNING ventas.estado, s.saldo::text AS saldo`,
      [ventaId, tenantId],
    ),
  );
  // Sin fila no hay venta que recalcular: no existe, no es de este tenant, está
  // borrada o está cancelada. Hoy ningún llamador lo alcanza (todos recalculan una
  // venta que acaban de bloquear), así que si pasa es un bug: falla fuerte, con
  // el motivo, y no con un TypeError sobre `undefined`.
  if (!filas.length)
    throw new Error(
      `No se pudo recalcular el estado de la venta ${ventaId}: no existe en este tenant, está borrada o está cancelada.`,
    );
  return {
    estado: filas[0].estado,
    saldo: new Decimal(filas[0].saldo).toFixed(4),
  };
}
