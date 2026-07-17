import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('liquidacion_propinas_fuente')
@Index('uq_liquidacion_propinas_fuente_propina', [
  'liquidacionId',
  'ventaPropinaId',
], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class LiquidacionPropinasFuente {
  @PrimaryGeneratedColumn('uuid', { name: 'liquidacion_propinas_fuente_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'liquidacion_id', type: 'uuid' })
  liquidacionId: string;

  @Column({ name: 'venta_propina_id', type: 'uuid' })
  ventaPropinaId: string;

  @Column({
    name: 'monto_pagado',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  montoPagado: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
