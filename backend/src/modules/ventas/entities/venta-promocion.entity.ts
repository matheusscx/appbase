import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Congelado: qué promo aplicó, sobre qué línea, y cuánto restó. Molde:
 * `VentaDescuento`, mismas precisiones.
 * Diseño: docs/superpowers/specs/2026-08-27-motor-promociones-design.md
 */
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
