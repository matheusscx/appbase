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

export type AmbienteSii = 'certificacion' | 'produccion';

/**
 * Un CAF subido (spec perfil fiscal § 2.3). `siguiente_folio` es el próximo a entregar; el CAF
 * está agotado cuando pasa `hasta`. Los usados se derivan (`siguiente_folio - desde`): el folio
 * de cada documento lo guarda el documento. El XML va cifrado porque trae `RSASK`.
 * El SII numera cada ambiente por separado: el mismo rango puede existir en certificación y en
 * producción, así que `ambiente` entra en la clave de unicidad de `desde`.
 */
@Entity('dte_cafs')
@Check('chk_dte_cafs_tipo', '"tipo" IN (39, 41)')
@Check('chk_dte_cafs_ambiente', `"ambiente" IN ('certificacion','produccion')`)
@Check('chk_dte_cafs_rango', '"desde" >= 1 AND "desde" <= "hasta"')
@Check(
  'chk_dte_cafs_siguiente',
  '"siguiente_folio" >= "desde" AND "siguiente_folio" <= "hasta" + 1',
)
@Index('idx_dte_cafs_razon_social', ['razonSocialId'])
@Index('uq_dte_cafs_desde', ['razonSocialId', 'tipo', 'ambiente', 'desde'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class DteCaf {
  @PrimaryGeneratedColumn('uuid', { name: 'caf_id' }) id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'razon_social_id', type: 'uuid' }) razonSocialId: string;
  @Column({ type: 'smallint' }) tipo: TipoBoleta;
  @Column({ name: 'rut_emisor', type: 'varchar', length: 12 })
  rutEmisor: string;
  @Column({ type: 'text' }) ambiente: AmbienteSii;
  @Column({ type: 'integer' }) desde: number;
  @Column({ type: 'integer' }) hasta: number;
  @Column({ name: 'siguiente_folio', type: 'integer' }) siguienteFolio: number;
  @Column({ type: 'integer' }) idk: number;
  @Column({ name: 'fecha_autorizacion', type: 'date' })
  fechaAutorizacion: string;
  @Column({ name: 'xml_cifrado', type: 'text' }) xmlCifrado: string;
  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
