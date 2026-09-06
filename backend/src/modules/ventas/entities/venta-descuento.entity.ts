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
 * Índice por venta, como en sus tres gemelas del congelado. Medido con 20.000
 * filas: 1,8 ms de seq scan → 0,07 ms.
 *
 * Es una de las seis que el detalle de una venta lee por `venta_id`, indexadas
 * juntas el 2026-09-06. El costo de escritura y las trampas de la medición:
 * `docs/patterns/backend.md` § 17, que es donde vive la tabla completa — acá va
 * solo el número de esta, para no tener el total copiado en ocho archivos.
 */
@Index('idx_ventas_descuentos_venta', ['ventaId'])
@Entity('ventas_descuentos')
export class VentaDescuento {
  @PrimaryGeneratedColumn('uuid', { name: 'venta_descuento_id' })
  id: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  @Column({ name: 'descuento_id', type: 'uuid' })
  descuentoId: string;

  /**
   * A qué línea pertenece la regla. `null` en las filas `aplicado_en = 'venta'`,
   * que no pertenecen a ninguna: sin esto, la misma regla aplicada a dos líneas
   * deja dos filas indistinguibles.
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

  @Column({ name: 'valor_aplicado', type: 'decimal', precision: 18, scale: 4 })
  valorAplicado: string;

  /**
   * Lo que el descuento pedía antes del piso en cero. Difiere de
   * `valor_aplicado` solo cuando la regla superaba el monto disponible: sin
   * esta columna, un descuento de $5.000 topeado a $1.500 es indistinguible de
   * uno que valía $1.500.
   */
  @Column({
    name: 'valor_solicitado',
    type: 'decimal',
    precision: 18,
    scale: 4,
  })
  valorSolicitado: string;

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
