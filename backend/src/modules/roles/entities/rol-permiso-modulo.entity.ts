import { Entity, PrimaryColumn } from 'typeorm';

@Entity('roles_permisos_modulos')
export class RolPermisoModulo {
  @PrimaryColumn({ name: 'rol_id' })
  rolId: string;

  @PrimaryColumn({ name: 'modulo_tenant_id' })
  moduloTenantId: string;

  @PrimaryColumn({ name: 'modulo_app_permiso_id' })
  moduloAppPermisoId: string;
}
