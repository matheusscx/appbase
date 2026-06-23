import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('tenant_moneda')
export class TenantMoneda {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @PrimaryColumn({ name: 'moneda_id', type: 'uuid' })
  monedaId: string;

  @Column({ name: 'es_default', default: false })
  esDefault: boolean;

  @Column({ default: false })
  habilitada: boolean;

  @Column({
    name: 'valor_del_dia',
    type: 'numeric',
    precision: 18,
    scale: 6,
    nullable: true,
  })
  valorDelDia: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
