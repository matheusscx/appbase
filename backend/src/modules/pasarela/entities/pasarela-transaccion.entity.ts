import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_transacciones')
@Index(['tenantPasarelaId', 'identificadorTransaccionExterno'], {
  unique: true,
  where: '"identificador_transaccion_externo" IS NOT NULL',
})
export class PasarelaTransaccion {
  @PrimaryGeneratedColumn('uuid', { name: 'transaccion_id' })
  transaccionId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'orden_id', type: 'uuid', nullable: true })
  ordenId: string | null; // null para INSCRIPTION

  @Column({ name: 'tenant_pasarela_id', type: 'uuid' })
  tenantPasarelaId: string;

  @Column({ name: 'inscripcion_id', type: 'uuid', nullable: true })
  inscripcionId: string | null;

  @Column({ name: 'medio_pago_id', type: 'uuid', nullable: true })
  medioPagoId: string | null;

  @Column({ name: 'transaccion_padre_id', type: 'uuid', nullable: true })
  transaccionPadreId: string | null; // liga REFUND/REVERSAL a su AUTHORIZATION

  @Column()
  tipo: string; // 'INSCRIPTION' | 'AUTHORIZATION' | 'CAPTURE' | 'REVERSAL' | 'REFUND' | 'RECURRENT_PAYMENT'

  @Column()
  estado: string; // 'iniciada' | 'aprobada' | 'rechazada' | 'error' — inmutable una vez terminal

  @Column({ type: 'numeric', precision: 18, scale: 6, nullable: true })
  monto: string | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  moneda: string | null;

  @Column({ name: 'codigo_orden', type: 'varchar', nullable: true })
  codigoOrden: string | null;

  @Column({ name: 'codigo_autorizacion', type: 'varchar', nullable: true })
  codigoAutorizacion: string | null;

  @Column({
    name: 'identificador_transaccion_externo',
    type: 'varchar',
    nullable: true,
  })
  identificadorTransaccionExterno: string | null;

  @Column({ name: 'codigo_respuesta', type: 'varchar', nullable: true })
  codigoRespuesta: string | null;

  @Column({ name: 'tipo_pago', type: 'varchar', nullable: true })
  tipoPago: string | null; // VN, VC, SI... (payment_type_code)

  @Column({ name: 'numero_cuotas', type: 'int', nullable: true })
  numeroCuotas: number | null;

  @Column({
    name: 'monto_cuota',
    type: 'numeric',
    precision: 18,
    scale: 6,
    nullable: true,
  })
  montoCuota: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  request: Record<string, unknown>; // REDACTADO antes de persistir

  @Column({ type: 'jsonb', default: () => `'{}'` })
  response: Record<string, unknown>; // REDACTADO antes de persistir

  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: Record<string, unknown>;

  @Column({ name: 'fecha_transaccion', type: 'timestamptz' })
  fechaTransaccion: Date;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
