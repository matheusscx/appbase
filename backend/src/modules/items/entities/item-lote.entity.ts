import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('item_lote')
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

  @Column({
    name: 'cantidad_disponible',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: '0',
  })
  cantidadDisponible: string;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
