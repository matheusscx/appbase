import { Exclude } from 'class-transformer';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('usuarios')
export class Usuario {
  @PrimaryGeneratedColumn('uuid', { name: 'usuario_id' })
  id: string;

  @Column({ name: 'nombre_usuario', unique: true, nullable: true })
  nombreUsuario: string | null;

  @Column({ name: 'contrasena', nullable: true })
  @Exclude()
  contrasena: string | null;

  @Column()
  nombre: string;

  @Column({ nullable: true })
  apellido: string | null;

  @Column({ nullable: true })
  telefono: string | null;

  @Column({ unique: true })
  correo: string;

  @Column({ name: 'es_superadmin', default: false })
  esSuperadmin: boolean;

  @Column({ type: 'varchar', nullable: true, name: 'google_id' })
  googleId: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
