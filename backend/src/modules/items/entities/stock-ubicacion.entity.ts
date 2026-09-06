import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * Saldo de un ítem en una ubicación: PK `(item_id, ubicacion_id)` → `stock`.
 *
 * Nace en la Tarea 1 del frente "bodegas y traslados"
 * (`docs/superpowers/specs/2026-09-06-bodegas-y-traslados-design.md`), antes
 * de lo previsto en el plan: el guard de `UbicacionesService.remove()` —no
 * dejar borrar una bodega con stock adentro— ya la consulta, así que sin la
 * tabla ese guard no podría escribirse. Desde la Tarea 2 (este commit), el
 * chokepoint de escritura (`registrarMovimiento`) la puebla: cada movimiento
 * escribe el saldo acá **y** en `item_producto.stock`, que siguen siempre
 * iguales mientras conviven. `item_producto.stock` es todavía la fuente de
 * verdad que leen el resto de los services; la Tarea 4 la borra y deja a esta
 * tabla como único dueño del saldo.
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
