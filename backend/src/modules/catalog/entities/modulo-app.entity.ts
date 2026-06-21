import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('modulos_app')
export class ModuloApp {
  @PrimaryGeneratedColumn('uuid', { name: 'modulo_app_id' })
  moduloAppId: string;

  @Column()
  nombre: string;

  @Column({ type: 'varchar', nullable: true })
  descripcion: string | null;

  @Column({ type: 'varchar', nullable: true })
  url: string | null;

  @Column({ type: 'varchar', nullable: true })
  icono: string | null;

  @Column({ name: 'tiene_configuracion', default: true })
  tieneConfiguracion: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date;
}
