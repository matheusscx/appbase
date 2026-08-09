import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('usuarios_tenants')
export class UsuarioTenant {
  @PrimaryColumn({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /**
   * Esta cuenta se usa como **tótem compartido** en este tenant: el dispositivo
   * queda logueado y lo usan varias personas, así que quién opera **no se puede
   * presumir del JWT** y siempre se pide PIN.
   *
   * Vive acá y no en `usuarios` porque ser tótem es propiedad de **cómo se usa
   * la cuenta en este tenant**, no de la persona. Y es explícito, no inferido:
   * una cuenta marcada así no se vuelve personal aunque alguien le vincule un
   * garzón por error.
   */
  @Column({ name: 'es_totem', type: 'boolean', default: false })
  esTotem: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
