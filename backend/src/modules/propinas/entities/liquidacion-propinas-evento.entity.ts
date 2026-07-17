import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TipoEventoLiquidacion } from '../enums/tipo-evento-liquidacion.enum';

@Entity('liquidacion_propinas_evento')
@Index('idx_liquidacion_propinas_evento_liquidacion', [
  'liquidacionId',
  'creadoEl',
])
export class LiquidacionPropinasEvento {
  @PrimaryGeneratedColumn('uuid', { name: 'liquidacion_propinas_evento_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'liquidacion_id', type: 'uuid' })
  liquidacionId: string;

  @Column({ type: 'text' })
  tipo: TipoEventoLiquidacion;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload: Record<string, unknown>;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
