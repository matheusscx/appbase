import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cuánto de un pago cubre una compra (spec compras-deuda-proveedor § 3,
 * decisión 2). Lo no aplicado de un pago es saldo a favor (decisión 5).
 *
 * **No se editan** (spec § 3): un ajuste marca `eliminado_el` acá y, si queda
 * un resto, inserta OTRA fila por ese resto — nunca `UPDATE` del monto. El
 * recorte de la § 6 (correcciones y anulaciones de compra) es de una tarea
 * futura; esta pieza solo escribe filas nuevas.
 */
@Index('idx_pago_prov_aplic_pago', ['pagoProveedorId'], {
  where: '"eliminado_el" IS NULL',
})
@Index('idx_pago_prov_aplic_compra', ['compraId'], {
  where: '"eliminado_el" IS NULL',
})
@Check('chk_pago_prov_aplic_monto_positivo', '"monto" > 0')
@Entity('pago_proveedor_aplicaciones')
export class PagoProveedorAplicacion {
  @PrimaryGeneratedColumn('uuid', { name: 'pago_proveedor_aplicacion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'pago_proveedor_id', type: 'uuid' })
  pagoProveedorId: string;

  @Column({ name: 'compra_id', type: 'uuid' })
  compraId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  monto: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;
}
