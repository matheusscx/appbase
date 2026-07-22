import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { EstadoLiquidacion } from '../enums/estado-liquidacion.enum';

@Entity('liquidacion_propinas')
@Index('idx_liquidacion_propinas_tenant_estado', [
  'tenantId',
  'estado',
  'creadoEl',
])
export class LiquidacionPropinas {
  @PrimaryGeneratedColumn('uuid', { name: 'liquidacion_propinas_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'fecha_desde', type: 'timestamptz' })
  fechaDesde: Date;

  @Column({ name: 'fecha_hasta', type: 'timestamptz' })
  fechaHasta: Date;

  @Column({
    name: 'turno_ids',
    type: 'uuid',
    array: true,
    default: () => "'{}'",
  })
  turnoIds: string[];

  @Column({ type: 'text', default: EstadoLiquidacion.BORRADOR })
  estado: EstadoLiquidacion;

  @Column({
    name: 'pool_total',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: '0',
  })
  poolTotal: string;

  @Column({ name: 'configuracion_version', type: 'int' })
  configuracionVersion: number;

  @Column({ name: 'moneda_id', type: 'uuid' })
  monedaId: string;

  @Column({ name: 'decimales_moneda', type: 'smallint' })
  decimalesMoneda: number;

  @Column({ name: 'creado_por', type: 'uuid' })
  creadoPor: string;

  @Column({ name: 'confirmado_por', type: 'uuid', nullable: true })
  confirmadoPor: string | null;

  @Column({ name: 'confirmado_el', type: 'timestamptz', nullable: true })
  confirmadoEl: Date | null;

  @Column({ name: 'anulado_por', type: 'uuid', nullable: true })
  anuladoPor: string | null;

  @Column({ name: 'anulado_el', type: 'timestamptz', nullable: true })
  anuladoEl: Date | null;

  @Column({ name: 'motivo_anulacion', type: 'text', nullable: true })
  motivoAnulacion: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
