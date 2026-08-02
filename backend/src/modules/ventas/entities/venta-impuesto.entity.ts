import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('ventas_impuestos')
export class VentaImpuesto {
  @PrimaryGeneratedColumn('uuid', { name: 'venta_impuesto_id' })
  id: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  @Column({ name: 'impuesto_id', type: 'uuid' })
  impuestoId: string;

  /**
   * A qué línea pertenece el impuesto. `null` en las filas
   * `aplicado_en = 'venta'`, que no pertenecen a ninguna.
   */
  @Column({ name: 'detalle_id', type: 'uuid', nullable: true })
  detalleId: string | null;

  /** Nombre del impuesto al momento de la venta; puede cambiar después. */
  @Column({ name: 'nombre_regla', type: 'text', nullable: true })
  nombreRegla: string | null;

  // Sin `modo` ni `valor_solicitado`: un impuesto es siempre un porcentaje
  // —ya congelado en `porcentaje_aplicado`— y el piso en cero no lo topea.

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

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
