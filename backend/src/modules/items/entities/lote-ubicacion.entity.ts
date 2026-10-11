import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

/**
 * Saldo de un lote **en un lugar**. Existe porque un mismo lote puede estar
 * partido: 8 kg de la partida en la cocina y 5 en el subsuelo.
 *
 * Reemplaza a `item_lote.cantidad_disponible`, que era un escalar por lote.
 * Lo que **no** se parte es la identidad del lote —código, elaboración y
 * vencimiento— que sigue viviendo una sola vez en `item_lote`.
 *
 * Es el dueño del saldo en modo `lote`; `stock_ubicacion` se recalcula
 * sumando esta tabla, y se escribe solo desde `inventario.service.ts`.
 */
@Index('idx_lote_ubicacion_ubicacion', ['ubicacionId'])
// Los lotes que todavía tienen saldo en un lugar. Las filas en cero no se
// borran —quedan como histórico de cada lote agotado—, así que sin este índice
// "qué hay en lotes vencidos del local" (`vencidosDelLocalSql`, el catálogo)
// recorría todo el histórico: medido el 2026-10-11 con 378k lotes, 4 ms contra
// 0,7 ms. El predicado es el literal de `loteVencidoSql`.
@Index('idx_lote_ubicacion_con_saldo', ['ubicacionId', 'loteId'], {
  where: '"cantidad" > 0',
})
@Entity('lote_ubicacion')
export class LoteUbicacion {
  @PrimaryColumn({ name: 'lote_id', type: 'uuid' })
  loteId: string;

  @PrimaryColumn({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  cantidad: string;
}
