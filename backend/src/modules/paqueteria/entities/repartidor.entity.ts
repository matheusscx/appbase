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
import { TarifaPago } from './tarifa-pago.entity';

@Entity('repartidores')
@Index('idx_repartidores_tenant', ['tenantId'])
export class Repartidor {
  @PrimaryGeneratedColumn('uuid', { name: 'repartidor_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 150 })
  nombre: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  telefono: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  /** La tarifa de su vehículo. Sin ella se paga la del paquete o, si tampoco, la por defecto. */
  @Column({ name: 'tarifa_pago_id', type: 'uuid', nullable: true })
  tarifaPagoId: string | null;

  @ManyToOne(() => TarifaPago, { nullable: true })
  @JoinColumn({ name: 'tarifa_pago_id' })
  tarifaPago?: TarifaPago;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
