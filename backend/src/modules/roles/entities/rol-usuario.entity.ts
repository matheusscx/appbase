import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('roles_usuarios')
export class RolUsuario {
  @PrimaryColumn({ name: 'usuario_id' })
  usuarioId: string;

  @PrimaryColumn({ name: 'tenant_id' })
  tenantId: string;

  @PrimaryColumn({ name: 'rol_id' })
  rolId: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
