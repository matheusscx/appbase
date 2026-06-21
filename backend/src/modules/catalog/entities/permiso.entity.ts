import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('permisos')
export class Permiso {
  @PrimaryGeneratedColumn('uuid', { name: 'permiso_id' })
  permisoId: string;

  @Column()
  nombre: string;

  @Column({ type: 'varchar', nullable: true })
  descripcion: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date;
}
