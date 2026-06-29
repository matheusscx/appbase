import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('movimientos_caja')
export class MovimientoCaja {
  @PrimaryGeneratedColumn('uuid', { name: 'movimiento_id' })
  id: string;

  @Column({ name: 'caja_id', type: 'uuid' })
  cajaId: string;

  @Column({ type: 'varchar' })
  tipo: string; // 'entrada' | 'salida'

  @Column({ type: 'varchar' })
  concepto: string;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  monto: string;

  @Column({ type: 'varchar', nullable: true })
  referencia: string | null;

  @Column({ name: 'fecha', type: 'timestamptz', default: () => 'NOW()' })
  fecha: Date;

  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null; // hook futuro (ventas) — sin uso ahora

  @Column({ name: 'pago_id', type: 'uuid', nullable: true })
  pagoId: string | null; // hook futuro (pagos) — sin uso ahora

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
