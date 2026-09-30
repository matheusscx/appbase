import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

// Único por producto sobre filas vivas: dos lotes del mismo `codigo_lote` para
// el mismo ítem son el mismo lote. Existía solo en `startup-pos.sql`
// (documentación); `ItemLote` no lo declaraba y el seeder no lo crea, así que
// no existía en la base (pendientes.md, "Declarar el índice único de
// item_lote"). Columnas peladas: no hace falta la SQL cruda del seeder, a
// diferencia de `uq_unidad_item_serie` (`item-unidad.entity.ts`).
@Entity('item_lote')
@Index('uq_lote_item_codigo', ['itemId', 'codigoLote'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class ItemLote {
  @PrimaryGeneratedColumn('uuid', { name: 'lote_id' })
  loteId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'codigo_lote', type: 'text' })
  codigoLote: string;

  @Column({ name: 'fecha_elaboracion', type: 'timestamptz', nullable: true })
  fechaElaboracion: Date | null;

  @Column({ name: 'fecha_vencimiento', type: 'timestamptz', nullable: true })
  fechaVencimiento: Date | null;

  @Column({
    name: 'cantidad_inicial',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: '0',
  })
  cantidadInicial: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
