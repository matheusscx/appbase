import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid', { name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'provincia_id', type: 'uuid' })
  provinciaId: string;

  @Column()
  nombre: string;

  @Column({ unique: true })
  correo: string;

  @Column({ type: 'varchar', nullable: true })
  telefono: string | null;

  @Column({ type: 'varchar', nullable: true })
  direccion: string | null;

  @Column({ name: 'calculo_descuentos', default: 'base' })
  calculoDescuentos: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date;
}
