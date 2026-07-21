import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('grupo_modificador_opciones')
@Index('uq_grupo_opcion_item_vivo', ['grupoModificadorId', 'itemId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class GrupoModificadorOpcion {
  @PrimaryGeneratedColumn('uuid', { name: 'grupo_opcion_id' })
  grupoOpcionId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'grupo_modificador_id', type: 'uuid' })
  grupoModificadorId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  cantidad: string | null;

  @Column({ name: 'unidad_codigo', type: 'text', nullable: true })
  unidadCodigo: string | null;

  @Column({
    name: 'precio_extra',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
  })
  precioExtra: string;

  @Column({ type: 'int', default: 0 })
  orden: number;

  @Column({ name: 'creado_el', type: 'timestamptz', default: () => 'NOW()' })
  creadoEl: Date;

  @Column({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @Column({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
