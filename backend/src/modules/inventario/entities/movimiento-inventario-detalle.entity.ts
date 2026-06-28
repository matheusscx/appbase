import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('movimiento_inventario_detalle')
export class MovimientoInventarioDetalle {
  @PrimaryGeneratedColumn('uuid', { name: 'detalle_id' })
  detalleId: string;

  @Column({ name: 'movimiento_id', type: 'uuid' })
  movimientoId: string;

  @Column({ name: 'unidad_id', type: 'uuid', nullable: true })
  unidadId: string | null;

  @Column({ name: 'lote_id', type: 'uuid', nullable: true })
  loteId: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
}
