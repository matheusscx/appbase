import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { TipoGarzon } from '../../garzones/enums/tipo-garzon.enum';
import { CriterioDistribucion } from '../enums/criterio-distribucion.enum';
import { BaseVentasGrupo } from '../enums/base-ventas-grupo.enum';
import { ManualModo } from '../enums/manual-modo.enum';

@Entity('propina_grupo_distribucion')
@Index('uq_propina_grupo_tipo_activo', ['tenantId', 'tipoGarzon'], {
  unique: true,
  where: `"activo" = true AND "eliminado_el" IS NULL`,
})
export class PropinaGrupoDistribucion {
  @PrimaryGeneratedColumn('uuid', { name: 'propina_grupo_distribucion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'configuracion_id', type: 'uuid' })
  configuracionId: string;

  @Column({ name: 'tipo_garzon', type: 'text' })
  tipoGarzon: TipoGarzon;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'numeric', precision: 10, scale: 6 })
  porcentaje: string;

  @Column({ type: 'text' })
  criterio: CriterioDistribucion;

  @Column({
    name: 'base_ventas',
    type: 'text',
    default: BaseVentasGrupo.TOTAL_FINAL,
  })
  baseVentas: BaseVentasGrupo;

  @Column({ name: 'manual_modo', type: 'text', nullable: true })
  manualModo: ManualModo | null;

  @Column({ default: true })
  activo: boolean;

  @Column({ type: 'int', default: 0 })
  orden: number;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
