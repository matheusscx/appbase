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

  @Column({ type: 'jsonb', default: () => "'{}'" })
  preferencias: UsuarioPreferencias;

  @Column({ type: 'varchar', nullable: true, name: 'google_id' })
  googleId: string | null;

  /**
   * Cuándo se probó que esta dirección es de quien dice. `NULL` = sin probar.
   *
   * Existe porque **"el correo coincide" dejó de ser prueba de identidad**
   * (decisión del owner, 2026-08-15). `POST /auth/register` es público y creaba
   * cuentas con un correo que nadie tocó, y eso alimentaba dos agujeros más:
   * el alta de un tenant adoptaba esa cuenta por coincidencia, y el aviso de
   * "alguien intentó registrarse con tu correo" iría a una dirección sin dueño
   * comprobado.
   *
   * **Se sella por tres caminos, y ninguno es el registro mismo:**
   * - el link de verificación del auto-registro (`TipoTokenAcceso.VERIFICACION`);
   * - aceptar una invitación: llegó al mail y lo abrió, así que la dirección
   *   está probada por construcción;
   * - Google, **sólo** si el perfil viene con `email_verified`.
   *
   * ⚠️ **El corte vive en `validateUser`, o sea que rige el login con
   * contraseña y sólo ése.** Está escrito así a propósito y no es una omisión:
   * `googleLogin` no lo consulta porque para las cuentas que crea Google la
   * dirección ya viene probada (se exige `email_verified` y se sella la fecha
   * al crearla), y el PIN de garzón y el tótem no emiten JWT — operan sobre una
   * sesión ya autenticada, así que no son un camino de entrada.
   *
   * El rechazo va **después** de comprobar la contraseña: si fuera antes, sería
   * un oráculo para saber qué correos existen — justo lo que el `409` que se
   * sacó de `register` regalaba.
   */
  @Column({ name: 'correo_verificado_el', type: 'timestamptz', nullable: true })
  correoVerificadoEl: Date | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
