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
import { OrigenParticipante } from '../enums/origen-participante.enum';

@Entity('liquidacion_propinas_participante')
@Index('idx_liquidacion_propinas_participante_liquidacion', [
  'liquidacionId',
  'grupoId',
])
@Index('uq_liquidacion_propinas_participante_garzon', [
  'liquidacionId',
  'garzonId',
], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class LiquidacionPropinasParticipante {
  @PrimaryGeneratedColumn('uuid', {
    name: 'liquidacion_propinas_participante_id',
  })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'liquidacion_id', type: 'uuid' })
  liquidacionId: string;

  @Column({ name: 'grupo_id', type: 'uuid' })
  grupoId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  @Column({ name: 'tipo_garzon', type: 'text' })
  tipoGarzon: TipoGarzon;

  @Column({ default: true })
  incluido: boolean;

  @Column({ type: 'text' })
  origen: OrigenParticipante;

  @Column({ name: 'motivo_ajuste', type: 'text', nullable: true })
  motivoAjuste: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  horas: string;

  @Column({
    name: 'ventas_base',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: '0',
  })
  ventasBase: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  cuentas: string;

  @Column({
    name: 'peso_manual',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  pesoManual: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  monto: string;

  @Column({ name: 'ajuste_motivo_monto', type: 'text', nullable: true })
  ajusteMotivoMonto: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
