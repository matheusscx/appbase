import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Rendicion } from './rendicion.entity';
import { Repartidor } from './repartidor.entity';

/**
 * Plata que el repartidor le dejó a la oficina en cualquier momento (no pertenece a un día). Sin
 * `rendicion_id` está pendiente y se puede corregir o anular; al rendir queda dentro de la
 * rendición y es de solo lectura.
 */
@Entity('entregas_repartidor')
@Check('chk_entregas_repartidor_monto', `"monto" > 0`)
@Check(
  'chk_entregas_repartidor_medio',
  `"medio" IN ('efectivo', 'transferencia')`,
)
@Index('idx_entregas_repartidor_repartidor', ['tenantId', 'repartidorId'])
@Index('idx_entregas_repartidor_rendicion', ['rendicionId'])
export class EntregaRepartidor {
  @PrimaryGeneratedColumn('uuid', { name: 'entrega_repartidor_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'repartidor_id', type: 'uuid' })
  repartidorId: string;

  @ManyToOne(() => Repartidor)
  @JoinColumn({ name: 'repartidor_id' })
  repartidor?: Repartidor;

  /** Día en que la entregó, elegido en pantalla. Columna `date`: no pasa por rango-fecha.util. */
  @Column({ type: 'date' })
  fecha: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  monto: string;

  @Column({ type: 'varchar', length: 20 })
  medio: 'efectivo' | 'transferencia';

  @Column({ type: 'varchar', length: 500, nullable: true })
  nota: string | null;

  @Column({ name: 'registrada_por', type: 'uuid' })
  registradaPor: string;

  /** Null hasta que se rinde. */
  @Column({ name: 'rendicion_id', type: 'uuid', nullable: true })
  rendicionId: string | null;

  @ManyToOne(() => Rendicion, { nullable: true })
  @JoinColumn({ name: 'rendicion_id' })
  rendicion?: Rendicion;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
