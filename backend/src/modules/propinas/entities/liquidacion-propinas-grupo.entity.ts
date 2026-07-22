import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TipoGarzon } from '../../garzones/enums/tipo-garzon.enum';
import { BaseVentasGrupo } from '../enums/base-ventas-grupo.enum';
import { CriterioDistribucion } from '../enums/criterio-distribucion.enum';
import { ManualModo } from '../enums/manual-modo.enum';

@Entity('liquidacion_propinas_grupo')
@Index('idx_liquidacion_propinas_grupo_liquidacion', ['liquidacionId', 'orden'])
export class LiquidacionPropinasGrupo {
  @PrimaryGeneratedColumn('uuid', { name: 'liquidacion_propinas_grupo_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'liquidacion_id', type: 'uuid' })
  liquidacionId: string;

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

  @Column({
    name: 'monto_grupo',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: '0',
  })
  montoGrupo: string;

  @Column({ type: 'int', default: 0 })
  orden: number;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
