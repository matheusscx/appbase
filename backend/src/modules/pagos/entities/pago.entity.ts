import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('pagos')
export class Pago {
  @PrimaryGeneratedColumn('uuid', { name: 'pago_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  @Column({ name: 'metodo_pago_id', type: 'uuid' })
  metodoPagoId: string;

  @Column({ name: 'moneda_oficial_id', type: 'uuid' })
  monedaOficialId: string;

  @Column({ name: 'caja_id', type: 'uuid', nullable: true })
  cajaId: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  monto: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: '0' })
  vuelto: string;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  fecha: Date;

  @Column({ type: 'text', nullable: true })
  referencia: string | null;

  // Detalle de tarjeta devuelto por la pasarela (Webpay). Null en pagos manuales/POS.
  @Column({ name: 'numero_cuotas', type: 'int', nullable: true })
  numeroCuotas: number | null;

  @Column({ name: 'tipo_pago', type: 'varchar', nullable: true })
  tipoPago: string | null; // payment_type_code Transbank: VD/VN/VC/SI/S2/NC/VP

  @Column({
    name: 'tarjeta_ultimos4',
    type: 'varchar',
    length: 4,
    nullable: true,
  })
  tarjetaUltimos4: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
