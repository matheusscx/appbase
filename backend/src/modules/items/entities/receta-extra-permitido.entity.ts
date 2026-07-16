import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('receta_extras_permitidos')
export class RecetaExtraPermitido {
  @PrimaryGeneratedColumn('uuid', { name: 'receta_extra_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'receta_item_id', type: 'uuid' })
  recetaItemId: string;

  @Column({ name: 'ingrediente_item_id', type: 'uuid' })
  ingredienteItemId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({ name: 'unidad_codigo', type: 'text' })
  unidadCodigo: string;

  @Column({ name: 'precio_extra', type: 'numeric', precision: 18, scale: 4 })
  precioExtra: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({
    name: 'actualizado_el',
    type: 'timestamptz',
    nullable: true,
  })
  actualizadoEl: Date | null;

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;
}
