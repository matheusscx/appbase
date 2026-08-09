import { Exclude } from 'class-transformer';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import type { UsuarioPreferencias } from '../../common/types/usuario-preferencias.interface';

@Entity('usuarios')
export class Usuario {
  @PrimaryGeneratedColumn('uuid', { name: 'usuario_id' })
  id: string;

  @Column({
    name: 'nombre_usuario',
    type: 'varchar',
    unique: true,
    nullable: true,
  })
  nombreUsuario: string | null;

  @Column({ name: 'contrasena', type: 'varchar', nullable: true })
  @Exclude()
  contrasena: string | null;

  @Column()
  nombre: string;

  @Column({ type: 'varchar', nullable: true })
  apellido: string | null;

  @Column({ type: 'varchar', nullable: true })
  telefono: string | null;

  @Column({ unique: true })
  correo: string;

  @Column({ name: 'es_superadmin', default: false })
  esSuperadmin: boolean;

  /**
   * La cuenta la creó un admin de tenant con una contraseña **temporal
   * generada por el sistema**, y la persona todavía no la cambió.
   *
   * Mientras esté en `true`, `switchTenant` no emite token de tenant: se puede
   * loguear y llegar a `PATCH /me/contrasena` —que corre con `JwtAuthGuard`
   * solo, sin `TenantGuard`— pero no operar nada. Ese es todo el enforcement:
   * un solo lugar, sin costo por request y **sin tocar el payload del JWT**
   * (invariante 4).
   */
  @Column({ name: 'debe_cambiar_contrasena', type: 'boolean', default: false })
  debeCambiarContrasena: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  preferencias: UsuarioPreferencias;

  @Column({ type: 'varchar', nullable: true, name: 'google_id' })
  googleId: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
