import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * Saldo de un ítem en una ubicación: PK `(item_id, ubicacion_id)` → `stock`.
 * Único dueño del saldo de stock del sistema.
 *
 * Nace en el frente de bodegas y traslados
 * (`docs/features/bodegas-y-traslados.md`), antes de lo que ese frente tenía
 * previsto: el guard de `UbicacionesService.remove()` —no dejar borrar una
 * bodega con stock adentro— ya la consulta, así que sin la tabla ese guard no
 * podría escribirse. La puebla el chokepoint de escritura
 * (`registrarMovimiento`), y el mismo frente borró `item_producto.stock`: ya no
 * hay doble escritura ni fuente de verdad paralela, esta tabla es la única.
 *
 * El lock de `registrarMovimiento` sigue anclado en `item_producto`, no acá
 * (docs/patterns/backend.md §15): su fila siempre existe, la de esta tabla
 * puede no existir todavía para un ítem que nunca se movió en esa ubicación,
 * y `FOR UPDATE` sobre una fila inexistente no lockea nada.
 *
 * ⛔ **Consecuencia de eso, y la regla que hay que respetar para escribir acá:
 * esta tabla NO es la fila lockeada, así que su saldo se lee en un statement
 * APARTE, emitido ya con el lock tomado — nunca en el mismo `SELECT … FOR
 * UPDATE`.** Bajo READ COMMITTED, el snapshot del statement se toma antes de
 * encolarse en el lock y al despertar Postgres re-evalúa solo la fila lockeada:
 * leído por join en ese mismo statement, el saldo llega VIEJO. Y como la
 * escritura es un upsert ABSOLUTO (`ON CONFLICT DO UPDATE SET stock =
 * EXCLUDED.stock`, no `stock - $1`), un saldo viejo es un lost update: stock 10,
 * dos salidas concurrentes de 6, pasan las dos. Red:
 * `test/sobreventa-concurrente-ubicacion.e2e-spec.ts`.
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
