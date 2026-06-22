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

  @Column({ length: 100 })
  nombre: string;

  @Column({ length: 50 })
  rut: string;

  @Column({ length: 255, nullable: true, type: 'varchar' })
  direccion: string | null;

  @Column({ length: 50, nullable: true, type: 'varchar' })
  telefono: string | null;

  @Column({ default: false })
  habilitado: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
