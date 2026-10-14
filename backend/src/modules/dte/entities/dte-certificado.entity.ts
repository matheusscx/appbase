import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Certificado del firmante de la razón social emisora (`docs/features/emision-electronica.md`,
 * "Perfil fiscal del emisor"). Vigente hay uno por razón social; al reemplazarlo, el anterior queda con `reemplazado_el` y el blob en
 * null: no se guarda la llave de un certificado que ya no firma.
 */
@Entity('dte_certificados')
@Index('idx_dte_certificados_razon_social', ['razonSocialId'])
@Index('uq_dte_certificados_vigente', ['razonSocialId'], {
  unique: true,
  where: '"reemplazado_el" IS NULL AND "eliminado_el" IS NULL',
})
export class DteCertificado {
  @PrimaryGeneratedColumn('uuid', { name: 'certificado_id' }) id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'razon_social_id', type: 'uuid' }) razonSocialId: string;
  /** `CertificadoLeido` en JSON, cifrado con `CifradoDteService`. Null = reemplazado. */
  @Column({ name: 'credencial_cifrada', type: 'text', nullable: true })
  credencialCifrada: string | null;
  @Column({ name: 'rut_firmante', type: 'varchar', length: 12 })
  rutFirmante: string;
  @Column({ name: 'nombre_firmante', type: 'text' }) nombreFirmante: string;
  @Column({ name: 'vence_el', type: 'timestamptz' }) venceEl: Date;
  @Column({ name: 'reemplazado_el', type: 'timestamptz', nullable: true })
  reemplazadoEl: Date | null;
  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
