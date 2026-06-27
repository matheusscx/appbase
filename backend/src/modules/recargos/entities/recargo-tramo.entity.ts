import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('recargo_tramos')
export class RecargoTramo {
  @PrimaryGeneratedColumn('uuid', { name: 'recargo_tramo_id' })
  id: string;

  @Column({ name: 'recargo_id', type: 'uuid' })
  recargoId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  minimo: string; // cantidad o monto mínimo para este tramo

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  valor: string; // valor del recargo en este tramo

  @Column({ type: 'int', default: 0 })
  orden: number;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
