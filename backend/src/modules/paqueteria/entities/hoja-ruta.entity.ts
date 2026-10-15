import {
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
import { Repartidor } from './repartidor.entity';

@Entity('hojas_ruta')
@Index(
  'uq_hojas_ruta_repartidor_fecha',
  ['tenantId', 'repartidorId', 'fecha'],
  { unique: true, where: '"eliminado_el" IS NULL' },
)
@Index('idx_hojas_ruta_tenant_fecha', ['tenantId', 'fecha'])
export class HojaRuta {
  @PrimaryGeneratedColumn('uuid', { name: 'hoja_ruta_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'repartidor_id', type: 'uuid' })
  repartidorId: string;

  @ManyToOne(() => Repartidor)
  @JoinColumn({ name: 'repartidor_id' })
  repartidor?: Repartidor;

  /** Día de la ruta, elegido en pantalla (por defecto el día del negocio). Columna `date`: no pasa por rango-fecha.util. */
  @Column({ type: 'date' })
  fecha: string;

  @Column({ type: 'varchar', length: 20, default: 'abierta' })
  estado: 'abierta' | 'rendida';

  @Column({ name: 'rendida_por', type: 'uuid', nullable: true })
  rendidaPor: string | null;

  @Column({ name: 'rendida_el', type: 'timestamptz', nullable: true })
  rendidaEl: Date | null;

  // Totales congelados al rendir; null mientras está abierta (spec § 2).
  @Column({ name: 'total_asignados', type: 'int', nullable: true })
  totalAsignados: number | null;

  @Column({ name: 'total_entregados', type: 'int', nullable: true })
  totalEntregados: number | null;

  @Column({ name: 'total_cobro_destino', type: 'int', nullable: true })
  totalCobroDestino: number | null;

  @Column({
    name: 'monto_cobrado_destino',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  montoCobradoDestino: string | null;

  @Column({
    name: 'monto_pago_repartidor',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  montoPagoRepartidor: string | null;

  @Column({
    name: 'monto_total_general',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  montoTotalGeneral: string | null;

  @Column({
    name: 'neto_a_rendir',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  netoARendir: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
