import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('item_grupos_modificadores')
@Index('uq_item_grupo_vivo', ['itemId', 'grupoModificadorId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class ItemGrupoModificador {
  @PrimaryGeneratedColumn('uuid', { name: 'item_grupo_id' })
  itemGrupoId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'grupo_modificador_id', type: 'uuid' })
  grupoModificadorId: string;

  @Column({ type: 'int', default: 1 })
  min: number;

  @Column({ type: 'int' })
  max: number;

  @Column({ type: 'int', default: 0 })
  orden: number;

  @Column({ name: 'creado_el', type: 'timestamptz', default: () => 'NOW()' })
  creadoEl: Date;

  @Column({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @Column({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
