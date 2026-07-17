import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum TipoPagoAplicacion {
  VENTA = 'venta',
  PROPINA = 'propina',
}

@Index('idx_pago_aplicaciones_pago', ['pagoId'], {
  where: '"eliminado_el" IS NULL',
})
@Index('idx_pago_aplicaciones_ref', ['tenantId', 'tipo', 'referenciaId'])
@Entity('pago_aplicaciones')
export class PagoAplicacion {
  @PrimaryGeneratedColumn('uuid', { name: 'pago_aplicacion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'pago_id', type: 'uuid' })
  pagoId: string;

  @Column({ type: 'text' })
  tipo: TipoPagoAplicacion;

  @Column({ name: 'referencia_id', type: 'uuid', nullable: true })
  referenciaId: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  monto: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
