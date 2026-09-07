import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * Saldo de un ítem en una ubicación: PK `(item_id, ubicacion_id)` → `stock`.
 * Único dueño del saldo de stock del sistema.
 *
 * Nace en la Tarea 1 del frente "bodegas y traslados"
 * (`docs/superpowers/specs/2026-09-06-bodegas-y-traslados-design.md`), antes
 * de lo previsto en el plan: el guard de `UbicacionesService.remove()` —no
 * dejar borrar una bodega con stock adentro— ya la consulta, así que sin la
 * tabla ese guard no podría escribirse. Desde la Tarea 2 la puebla el
 * chokepoint de escritura (`registrarMovimiento`), y desde la Tarea 4
 * `item_producto.stock` se borró: ya no hay doble escritura ni fuente de
 * verdad paralela, esta tabla es la única.
 *
 * El lock de `registrarMovimiento` sigue anclado en `item_producto`, no acá
 * (docs/patterns/backend.md §15): su fila siempre existe, la de esta tabla
 * puede no existir todavía para un ítem que nunca se movió en esa ubicación,
 * y `FOR UPDATE` sobre una fila inexistente no lockea nada.
 *
 * El índice por `ubicacion_id` sirve al acceso por ubicación (el guard de
 * borrado de una bodega, y más adelante el recuento por bodega); la PK ya
 * cubre el acceso por ítem.
 */
@Index('idx_stock_ubicacion_ubicacion', ['ubicacionId'])
@Entity('stock_ubicacion')
export class StockUbicacion {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @PrimaryColumn({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  stock: string;
}
