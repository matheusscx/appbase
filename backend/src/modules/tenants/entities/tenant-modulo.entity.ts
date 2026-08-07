import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('tenant_modulos')
export class TenantModulo {
  @PrimaryGeneratedColumn('uuid', { name: 'modulo_tenant_id' })
  moduloTenantId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'modulo_app_id', type: 'uuid' })
  moduloAppId: string;

  @Column({ default: 'activo' })
  estado: string;

  @Column({
    name: 'contratado_en',
    type: 'timestamptz',
    default: () => 'NOW()',
  })
  contratadoEn: Date;

  @Column({ name: 'expira_en', type: 'timestamptz', nullable: true })
  expiraEn: Date | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
