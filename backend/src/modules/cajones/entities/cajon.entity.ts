import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

// Índice único parcial: nombre único por tenant entre no-borrados. Es la garantía
// dura (bajo concurrencia el check de `count` del service podría saltearse); el
// service igual valida primero para devolver un 409 con mensaje amable.
@Entity('cajones')
@Index('ux_cajones_tenant_nombre', ['tenantId', 'nombre'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class Cajon {
  @PrimaryGeneratedColumn('uuid', { name: 'cajon_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
