import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { ModuloApp } from './modulo-app.entity';
import { Permiso } from './permiso.entity';

@Entity('modulo_app_permisos')
export class ModuloAppPermiso {
  @PrimaryGeneratedColumn('uuid', { name: 'modulo_app_permiso_id' })
  moduloAppPermisoId: string;

  @Column({ name: 'modulo_app_id', type: 'uuid' })
  moduloAppId: string;

  @Column({ name: 'permiso_id', type: 'uuid' })
  permisoId: string;

  @ManyToOne(() => ModuloApp)
  @JoinColumn({ name: 'modulo_app_id' })
  moduloApp: ModuloApp;

  @ManyToOne(() => Permiso)
  @JoinColumn({ name: 'permiso_id' })
  permiso: Permiso;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date;
}
