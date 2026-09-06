import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Índice por venta, como en sus tres gemelas del congelado. Medido con 6.000
 * filas: 0,6 ms de seq scan → 0,05 ms.
 *
 * Es una de las seis que el detalle de una venta lee por `venta_id`, indexadas
 * juntas el 2026-09-06. El costo de escritura y las trampas de la medición:
 * `docs/patterns/backend.md` § 17, que es donde vive la tabla completa — acá va
 * solo el número de esta, para no tener el total copiado en ocho archivos.
 */
@Index('idx_ventas_recargos_venta', ['ventaId'])
@Entity('ventas_recargos')
export class VentaRecargo {
  @PrimaryGeneratedColumn('uuid', { name: 'venta_recargo_id' })
  id: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  @Column({ name: 'recargo_id', type: 'uuid' })
  recargoId: string;

  /**
   * A qué línea pertenece la regla. `null` en las filas `aplicado_en = 'venta'`,
   * que no pertenecen a ninguna.
   */
  @Column({ name: 'detalle_id', type: 'uuid', nullable: true })
  detalleId: string | null;

  /**
   * Nombre de la regla al momento de la venta; el del catálogo puede cambiar
   * después, o la regla puede no existir más.
   */
  @Column({ name: 'nombre_regla', type: 'text' })
  nombreRegla: string;

  /** `'porcentaje' | 'monto_fijo'` al momento de la venta. */
  @Column({ name: 'modo', type: 'text' })
  modo: string;

  // Sin `valor_solicitado`: el piso en cero solo topea descuentos, así que un
  // recargo siempre aplica lo que pide.

  @Column({ name: 'valor_aplicado', type: 'decimal', precision: 18, scale: 4 })
  valorAplicado: string;

  @Column({
    name: 'porcentaje_aplicado',
    type: 'decimal',
    precision: 7,
    scale: 4,
    nullable: true,
  })
  porcentajeAplicado: string | null;

  @Column({ name: 'aplicado_en', type: 'text', default: 'venta' })
  aplicadoEn: string; // 'detalle' | 'venta'

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
