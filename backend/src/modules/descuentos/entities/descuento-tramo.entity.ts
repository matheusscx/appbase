import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('descuento_tramos')
export class DescuentoTramo {
  @PrimaryGeneratedColumn('uuid', { name: 'descuento_tramo_id' })
  id: string;

  @Column({ name: 'descuento_id', type: 'uuid' })
  descuentoId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  minimo: string | null; // cantidad o monto mínimo para este tramo

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  valor: string | null; // valor del descuento en este tramo

  @Column({ type: 'int', default: 0 })
  orden: number;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
