import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Congelado: qué promo aplicó, sobre qué línea, y cuánto restó. Molde:
 * `VentaDescuento`, mismas precisiones.
 * Diseño: docs/superpowers/specs/2026-08-27-motor-promociones-design.md
 *
 * Índice por venta, como en sus tres gemelas del congelado. Medido con 12.000
 * filas: 1,1 ms de seq scan → 0,07 ms.
 *
 * Es una de las seis que el detalle de una venta lee por `venta_id`, indexadas
 * juntas el 2026-09-06. El costo de escritura y las trampas de la medición:
 * `docs/patterns/backend.md` § 17, que es donde vive la tabla completa — acá va
 * solo el número de esta, para no tener el total copiado en ocho archivos.
 */
@Index('idx_ventas_promociones_venta', ['ventaId'])
@Entity('ventas_promociones')
export class VentaPromocion {
  @PrimaryGeneratedColumn('uuid', { name: 'venta_promocion_id' })
  id: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  /** Siempre por línea: el monto de una promo aterriza en líneas. */
  @Column({ name: 'detalle_id', type: 'uuid' })
  detalleId: string;

  /** Agrupador: la aplicación #N de la promo tocó estas filas. */
  @Column({ type: 'smallint' })
  aplicacion: number;

  /** Resoluble para siempre: el catálogo es soft delete. */
  @Column({ name: 'promocion_id', type: 'uuid' })
  promocionId: string;

  @Column({ name: 'nombre_promocion', type: 'text' })
  nombrePromocion: string;

  @Column({ type: 'text' })
  tipo: string;

  /** Qué valía: el % (decimal) o el precio fijo — `tipo` dice cómo leerlo. */
  @Column({ name: 'valor_efectivo', type: 'decimal', precision: 18, scale: 4 })
  valorEfectivo: string;

  /** Lo que restó EN ESTA línea. */
  @Column({ type: 'decimal', precision: 18, scale: 4 })
  monto: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
