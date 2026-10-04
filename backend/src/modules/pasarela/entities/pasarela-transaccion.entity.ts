import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_transacciones')
// Un REFUND pedido con `Idempotency-Key` sabe quién lo pidió: un usuario o una
// llave de API, exactamente uno (ADR-029). Las filas de antes y los otros
// tipos no tienen reclamo, y no se les exige.
@Check(
  'chk_pasarela_transacciones_quien_pidio',
  '"solicitud_idempotente_id" IS NULL OR (("usuario_id" IS NULL) <> ("api_key_id" IS NULL))',
)
@Index(['tenantPasarelaId', 'identificadorTransaccionExterno'], {
  unique: true,
  where: '"identificador_transaccion_externo" IS NOT NULL',
})
export class PasarelaTransaccion {
  @PrimaryGeneratedColumn('uuid', { name: 'transaccion_id' })
  transaccionId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  // Índice: historial por orden y agregado de REFUNDs del listado de ventas.
  @Index()
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

  /**
   * Solo en un REFUND aprobado de una orden con venta: la fila de `ventas` (la
   * corrección, con `venta_referencia_id`) que el reembolso dejó en el lado de
   * ventas. Se escribe DESPUÉS del commit del REFUND —la corrección la crea el
   * hook post-commit—, así que `NULL` en un REFUND aprobado con venta es la señal
   * de que la corrección no se pudo crear (el reembolso respondió con
   * `warning`). Sin FK, como el resto del dominio de pasarela.
   */
  @Column({ name: 'correccion_venta_id', type: 'uuid', nullable: true })
  correccionVentaId: string | null;

  /**
   * Solo en un REFUND: el reclamo de `Idempotency-Key` que lo pidió
   * (`solicitudes_idempotentes`). El REFUND se escribe en `iniciada` en la
   * misma transacción que commitea el reclamo, ANTES de llamar al proveedor
   * (ADR-029): un reintento con esa clave mira el estado de SU REFUND. El
   * vínculo vive acá y no en la tabla compartida. Sin FK, como el resto.
   */
  @Column({ name: 'solicitud_idempotente_id', type: 'uuid', nullable: true })
  solicitudIdempotenteId: string | null;

  /**
   * Quién PIDIÓ el REFUND (no quién lo resolvió, que es `resueltaPor`): la
   * corrección que deja se atribuye a esta persona aunque lo haya aclarado
   * otra. `NULL` si lo pidió una llave de API (`apiKeyId`) o es de antes.
   */
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  /** La llave de API que pidió el REFUND por la API externa. */
  @Column({ name: 'api_key_id', type: 'uuid', nullable: true })
  apiKeyId: string | null;

  /**
   * Cómo llegó un REFUND a su estado final desde `iniciada`/`error`:
   * `'proveedor'` (la respuesta de la llamada), `'saldo'` (se perdió la
   * respuesta y lo aclaró la consulta de saldo), `'manual'`, o `'no_enviado'`
   * (la re-verificación previa a llamar rebotó: nunca salió). `NULL` en las
   * filas que nacieron finales (todas las de antes de ADR-029).
   */
  @Column({ name: 'resolucion', type: 'varchar', nullable: true })
  resolucion: 'proveedor' | 'saldo' | 'manual' | 'no_enviado' | null;

  /** Quién lo resolvió (usuario del JWT); `NULL` si fue una llave de API. */
  @Column({ name: 'resuelta_por', type: 'uuid', nullable: true })
  resueltaPor: string | null;

  @Column({ name: 'resuelta_el', type: 'timestamptz', nullable: true })
  resueltaEl: Date | null;

  @Column()
  tipo: string; // 'INSCRIPTION' | 'AUTHORIZATION' | 'CAPTURE' | 'REVERSAL' | 'REFUND' | 'RECURRENT_PAYMENT'

  // 'iniciada' | 'aprobada' | 'rechazada' | 'error' — inmutable una vez terminal.
  // En un REFUND, `iniciada` y `error` NO son terminales: son "sin confirmar"
  // (el proveedor pudo haber devuelto la plata) y solo pasan a aprobada o
  // rechazada, una vez (`TransaccionesService.resolverReembolso`, ADR-029).
  @Column()
  estado: string;

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

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
