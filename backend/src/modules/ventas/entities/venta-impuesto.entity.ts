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
 * Índice por venta. Es la que más crece de las seis: los impuestos se congelan
 * **siempre por línea** —los dos escritores que hay hoy fijan
 * `aplicado_en = 'detalle'`, y la nota de crédito filtra por ese valor—, así que
 * lleva una fila por impuesto y por línea y escala con los detalles, no con las
 * ventas —y una línea exenta no genera ninguna, que es el otro lado de la misma
 * regla—. El `default` del esquema es `'venta'`, un modo que hoy no escribe nadie.
 * En la medición se sembraron dos por venta (120.000 filas) y ya era la más cara de
 * las seis: 9,2 ms de seq scan → 0,09 ms. Lo que cuesta es el tamaño en páginas, no
 * el número de columnas.
 *
 * Es una de las seis que el detalle de una venta lee por `venta_id`, indexadas
 * juntas el 2026-09-06. El costo de escritura y las trampas de la medición:
 * `docs/patterns/backend.md` § 17, que es donde vive la tabla completa — acá va
 * solo el número de esta, para no tener el total copiado en ocho archivos.
 */
@Index('idx_ventas_impuestos_venta', ['ventaId'])
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

  /**
   * Nombre del impuesto al momento de la venta; el del catálogo puede cambiar
   * después, o el impuesto puede no existir más.
   */
  @Column({ name: 'nombre_regla', type: 'text' })
  nombreRegla: string;

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

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
