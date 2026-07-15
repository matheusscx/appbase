import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('receta_ingredientes')
export class RecetaIngrediente {
  @PrimaryGeneratedColumn('uuid', { name: 'receta_ingrediente_id' })
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

  @Column({ type: 'boolean', default: true })
  bloqueante: boolean;

  // Obligatorios: con synchronize:true TypeORM alinea el schema a la entidad;
  // sin estas columnas se perderían las del SQL y se rompería el soft delete.
  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
