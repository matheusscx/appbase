import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('razones_sociales')
export class RazonSocial {
  @PrimaryGeneratedColumn('uuid', { name: 'razon_social_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'razon_social' })
  razonSocial: string;

  @Column({ type: 'varchar', nullable: true })
  rut: string | null;

  @Column({ type: 'varchar', nullable: true })
  representante: string | null;

  @Column({ type: 'boolean', default: false })
  principal: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
