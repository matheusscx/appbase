import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import type { AmbienteSii } from '../../dte/entities/dte-caf.entity';

@Entity('razones_sociales')
@Check(
  'chk_razones_sociales_ambiente_sii',
  `"ambiente_sii" IN ('certificacion','produccion')`,
)
@Check('chk_razones_sociales_numero_resolucion', '"numero_resolucion" >= 0')
export class RazonSocial {
  @PrimaryGeneratedColumn('uuid', { name: 'razon_social_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ length: 100 })
  nombre: string;

  @Column({ length: 50 })
  rut: string;

  @Column({ length: 255, nullable: true, type: 'varchar' })
  direccion: string | null;

  @Column({ length: 50, nullable: true, type: 'varchar' })
  telefono: string | null;

  @Column({ default: false })
  habilitado: boolean;

  @Column({ default: false })
  preferida: boolean;

  @Column({ type: 'varchar', length: 80, nullable: true })
  giro: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  comuna: string | null;

  /**
   * Ambiente del SII en que emite: decide qué CAF sirven (`docs/features/emision-electronica.md`,
   * "Perfil fiscal del emisor").
   */
  @Column({ name: 'ambiente_sii', type: 'text', nullable: true })
  ambienteSii: AmbienteSii | null;

  /** `FchResol` de la carátula, AAAA-MM-DD. */
  @Column({ name: 'fecha_resolucion', type: 'date', nullable: true })
  fechaResolucion: string | null;

  /** `NroResol` de la carátula; 0 en certificación. */
  @Column({ name: 'numero_resolucion', type: 'integer', nullable: true })
  numeroResolucion: number | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
