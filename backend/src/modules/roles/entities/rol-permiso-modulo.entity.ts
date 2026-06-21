import { Entity, PrimaryColumn } from 'typeorm';

@Entity('roles_permisos_modulos')
export class RolPermisoModulo {
  @PrimaryColumn({ name: 'rol_id', type: 'uuid' })
  rolId: string;

  @PrimaryColumn({ name: 'modulo_tenant_id', type: 'uuid' })
  moduloTenantId: string;

  @PrimaryColumn({ name: 'modulo_app_permiso_id', type: 'uuid' })
  moduloAppPermisoId: string;
}
