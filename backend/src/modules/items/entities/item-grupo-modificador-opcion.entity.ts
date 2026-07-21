import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('item_grupo_modificador_opciones')
export class ItemGrupoModificadorOpcion {
  @PrimaryGeneratedColumn('uuid', { name: 'item_grupo_opcion_id' })
  itemGrupoOpcionId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  // FK a item_grupos_modificadores(item_grupo_id) — la asociación item↔grupo.
  @Column({ name: 'item_grupo_id', type: 'uuid' })
  itemGrupoId: string;

  // FK a grupo_modificador_opciones(grupo_opcion_id) — la opción reutilizable.
  @Column({ name: 'grupo_opcion_id', type: 'uuid' })
  grupoOpcionId: string;

  // Override; null = hereda el default del grupo. Si default también es null → pendiente.
  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  cantidad: string | null;

  @Column({ name: 'unidad_codigo', type: 'text', nullable: true })
  unidadCodigo: string | null;

  // Override del recargo; null = hereda el default (que nunca es null).
  @Column({
    name: 'precio_extra',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  precioExtra: string | null;

  @Column({ name: 'creado_el', type: 'timestamptz', default: () => 'NOW()' })
  creadoEl: Date;

  @Column({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @Column({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
