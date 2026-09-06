import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Saldo de un ítem en una ubicación: PK `(item_id, ubicacion_id)` → `stock`.
 *
 * Nace en la Tarea 1 del frente "bodegas y traslados"
 * (`docs/superpowers/specs/2026-09-06-bodegas-y-traslados-design.md`), antes
 * de lo previsto en el plan: el guard de `UbicacionesService.remove()` —no
 * dejar borrar una bodega con stock adentro— ya la consulta, así que sin la
 * tabla ese guard no podría escribirse. **Nadie la escribe todavía.** El
 * chokepoint de escritura (`registrarMovimiento`) y el reemplazo de
 * `item_producto.stock` por esta tabla llegan en la Tarea 2, que es la que la
 * puebla; hasta entonces toda fila que se consulte acá da 0.
 */
@Entity('stock_ubicacion')
export class StockUbicacion {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @PrimaryColumn({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  stock: string;
}
