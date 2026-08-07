import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

// Backstop duro del signo: el tipo del movimiento ('entrada'/'salida') es lo que
// codifica la dirección, así que un monto NEGATIVO invierte el aporte al esperado.
// El DTO cubre el endpoint HTTP (donde además exige > 0, porque un movimiento
// manual de cero no significa nada); esto cubre CUALQUIER camino, incluido el
// helper compartido que usan ventas y pagos.
// `>= 0` y no `> 0`: un pago devuelto íntegro como vuelto deja neto 0, y esa
// venta es legítima.
@Entity('movimientos_caja')
@Check('chk_movimientos_caja_monto_no_negativo', '"monto" >= 0')
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
  ventaId: string | null;

  @Column({ name: 'pago_id', type: 'uuid', nullable: true })
  pagoId: string | null;

  @Column({ name: 'metodo_pago_id', type: 'uuid', nullable: true })
  metodoPagoId: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
