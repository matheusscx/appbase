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
import type { EmisorMedio } from '../../metodos-pago/entities/tenant-metodo-pago.entity';

/** Quién emitió el documento: los tres emisores de un medio, más el facturador externo (E9). */
export type EmisorDocumento = EmisorMedio | 'externo';
/** Lo que la máquina de tarjeta emitió: el voucher o su propia boleta. */
export type ClaseDocumentoMaquina = 'voucher' | 'boleta';
/** `'armado'` es lo único que escribe hoy el sistema; `'enviado'` queda para la emisión (ADR-010). */
export type EstadoEnvio = 'armado' | 'enviado';
/** Por qué un documento dejó de valer al anular la venta (E8, E10). */
export type Descarte = 'armado_sin_enviar' | 'afirmado_no_hecho';

/**
 * Un documento de una venta: lo que el sistema armó, lo que emitió la máquina
 * de tarjeta, lo que el comercio hizo en otro facturador, o la constancia de
 * que nadie lo emite (spec `2026-10-01-emision-por-venta`, § 3.2; ADR-028).
 *
 * `venta_id` apunta a la venta o a su corrección. Los documentos de una venta
 * cubren su `total_final` desde que se crea (E1): la única fila que no cuenta
 * para esa cobertura es el voucher duplicado de E1b (`es_duplicado`).
 *
 * El folio del sistema **no existe todavía** y no se inventa (ADR-010): `numero`
 * es un dato externo —el de la máquina o el del otro facturador— y nace nulo.
 *
 * Los `type` de las columnas cerradas son explícitos: con la unión de TS sola
 * `design:type` queda en `Object` y TypeORM no arranca.
 */
@Index('idx_venta_documentos_venta', ['ventaId'])
@Index('idx_venta_documentos_corregido', ['documentoCorregidoId'])
@Entity('venta_documentos')
@Check(
  'chk_venta_documentos_emisor',
  `"emisor" IN ('sistema','maquina','nadie','externo')`,
)
@Check(
  'chk_venta_documentos_clase_maquina',
  `"clase_maquina" IN ('voucher','boleta')`,
)
@Check(
  'chk_venta_documentos_estado_envio',
  `"estado_envio" IN ('armado','enviado')`,
)
@Check(
  'chk_venta_documentos_descarte',
  `"descarte" IN ('armado_sin_enviar','afirmado_no_hecho')`,
)
export class VentaDocumento {
  @PrimaryGeneratedColumn('uuid', { name: 'documento_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  @Column({ type: 'text' })
  emisor: EmisorDocumento;

  /** Con `sistema` y `externo`, el tipo (boleta, factura, NC). Nulo con `nadie` y `maquina`. */
  @Column({ name: 'tipo_documento_id', type: 'uuid', nullable: true })
  tipoDocumentoId: string | null;

  /** Con `maquina`: voucher o boleta. Nulo hasta que se sepa. */
  @Column({ name: 'clase_maquina', type: 'text', nullable: true })
  claseMaquina: ClaseDocumentoMaquina | null;

  /** Con `maquina` y `externo`: el número que tipeó el comercio. Nulo hasta entonces. */
  @Column({ type: 'text', nullable: true })
  numero: string | null;

  /** Con `sistema`: `'armado'`. */
  @Column({ name: 'estado_envio', type: 'text', nullable: true })
  estadoEnvio: EstadoEnvio | null;

  /** Lo que cubre, en moneda oficial, sin propina ni vuelto. */
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  monto: string;

  /** Baldes congelados (con `sistema` y `externo`): neto afecto, neto exento y Σ de todos los impuestos. */
  @Column({
    name: 'monto_afecto',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  montoAfecto: string | null;

  @Column({
    name: 'monto_exento',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  montoExento: string | null;

  @Column({
    name: 'monto_impuestos',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  montoImpuestos: string | null;

  /** Con `maquina`: el pago que cubre (cada pasada de tarjeta es su voucher). */
  @Column({ name: 'pago_id', type: 'uuid', nullable: true })
  pagoId: string | null;

  /** En una corrección: el documento que corrige. */
  @Column({ name: 'documento_corregido_id', type: 'uuid', nullable: true })
  documentoCorregidoId: string | null;

  /** El voucher de un cobro de deuda ya documentada (E1b): no cuenta para la cobertura. */
  @Column({ name: 'es_duplicado', type: 'boolean', default: false })
  esDuplicado: boolean;

  /** Nulo mientras el documento vale. */
  @Column({ type: 'text', nullable: true })
  descarte: Descarte | null;

  @Column({ name: 'descartado_el', type: 'timestamptz', nullable: true })
  descartadoEl: Date | null;

  @Column({ name: 'descartado_por_usuario_id', type: 'uuid', nullable: true })
  descartadoPorUsuarioId: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
