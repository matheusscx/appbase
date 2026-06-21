import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('modulos_roles')
export class ModuloRol {
  @PrimaryColumn({ name: 'rol_id', type: 'uuid' })
  rolId: string;

  @PrimaryColumn({ name: 'modulo_tenant_id', type: 'uuid' })
  moduloTenantId: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
