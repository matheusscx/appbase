import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('item_unidad')
export class ItemUnidad {
  @PrimaryGeneratedColumn('uuid', { name: 'unidad_id' })
  unidadId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'lote_id', type: 'uuid', nullable: true })
  loteId: string | null;

  @Column({ type: 'text' })
  serie: string;

  @Column({ type: 'text', default: 'disponible' })
  estado: string; // 'disponible' | 'reservado' | 'vendido' | 'baja'

  @Column({ type: 'text', default: 'nuevo' })
  condicion: string; // 'nuevo' | 'usado' | 'reacondicionado'

  @Column({ name: 'garantia_hasta', type: 'timestamptz', nullable: true })
  garantiaHasta: Date | null;

  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
