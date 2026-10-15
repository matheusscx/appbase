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
import type { TipoBoleta } from '../dte.types';
import type { AmbienteSii } from './dte-caf.entity';

export type EstadoDocumentoDte =
  | 'pendiente'
  | 'enviado'
  | 'aceptado'
  | 'reparos'
  | 'rechazado';

/**
 * Una boleta electrónica emitida, y su camino hacia el SII (cola de envío). Una fila por boleta.
 * `xml` es el <DTE> firmado tal como lo devolvió `emitirBoleta`: el documento legal.
 * `intentos` y `ultimo_error` viven acá y no en el sobre porque la espera creciente es por boleta:
 * un sobre que falla deja de existir como unidad y sus boletas vuelven a la cola.
 * `envio_id` apunta al sobre en que viajó; sin FK en la base, como el resto del módulo.
 */
@Entity('dte_documentos')
@Check('chk_dte_documentos_tipo', '"tipo" IN (39, 41)')
@Check(
  'chk_dte_documentos_estado',
  `"estado" IN ('pendiente','enviado','aceptado','reparos','rechazado')`,
)
@Check(
  'chk_dte_documentos_ambiente',
  `"ambiente" IN ('certificacion','produccion')`,
)
@Index(
  'uq_dte_documentos_folio',
  ['razonSocialId', 'tipo', 'ambiente', 'folio'],
  { unique: true, where: '"eliminado_el" IS NULL' },
)
@Index('idx_dte_documentos_cola', ['razonSocialId', 'emitidoEl'], {
  where: `"estado" = 'pendiente' AND "eliminado_el" IS NULL`,
})
@Index('idx_dte_documentos_envio', ['envioId'])
// La franja del cajero cuenta las atrasadas y rechazadas del tenant después de cada cobro.
@Index('idx_dte_documentos_problemas', ['tenantId', 'emitidoEl'], {
  where: `"estado" IN ('pendiente','enviado','rechazado') AND "eliminado_el" IS NULL`,
})
export class DteDocumento {
  @PrimaryGeneratedColumn('uuid', { name: 'documento_id' }) id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'razon_social_id', type: 'uuid' }) razonSocialId: string;
  @Column({ name: 'caf_id', type: 'uuid' }) cafId: string;
  @Column({ type: 'smallint' }) tipo: TipoBoleta;
  @Column({ type: 'integer' }) folio: number;
  @Column({ type: 'text' }) ambiente: AmbienteSii;
  @Column({ name: 'rut_emisor', type: 'varchar', length: 12 })
  rutEmisor: string;
  /** El <DTE> firmado, tal como lo devolvió emitirBoleta. Es el documento legal. */
  @Column({ type: 'text' }) xml: string;
  @Column({ type: 'text' }) estado: EstadoDocumentoDte;
  @Column({ name: 'envio_id', type: 'uuid', nullable: true })
  envioId: string | null;
  /** Errores del SII para esta boleta, o el motivo del rechazo del sobre. */
  @Column({ name: 'detalle_sii', type: 'jsonb', nullable: true })
  detalleSii: unknown;
  @Column({ name: 'emitido_el', type: 'timestamptz' }) emitidoEl: Date;
  @Column({ name: 'proximo_intento_el', type: 'timestamptz' })
  proximoIntentoEl: Date;
  @Column({ type: 'integer', default: 0 }) intentos: number;
  @Column({ name: 'ultimo_error', type: 'text', nullable: true })
  ultimoError: string | null;
  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
