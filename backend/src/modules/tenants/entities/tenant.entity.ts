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
  id: string;

  @Column({ name: 'provincia_id' })
  provinciaId: string;

  @Column()
  nombre: string;

  @Column({ unique: true })
  correo: string;

  @Column({ nullable: true })
  telefono: string | null;

  @Column({ nullable: true })
  direccion: string | null;

  @Column({ name: 'calculo_descuentos', default: 'base' })
  calculoDescuentos: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
