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

/**
 * El cierre de la cuenta de UN repartidor sobre las hojas que se eligieron: lleva congelados los
 * totales y el saldo (`cobrado − pago − entregado a cuenta`). Nace al rendir y es de solo lectura:
 * no se edita ni se anula. Sus hojas y sus entregas de plata apuntan a ella con `rendicion_id`.
 */
@Entity('rendiciones')
@Index('idx_rendiciones_repartidor', ['tenantId', 'repartidorId', 'rendidaEl'])
export class Rendicion {
  @PrimaryGeneratedColumn('uuid', { name: 'rendicion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'repartidor_id', type: 'uuid' })
  repartidorId: string;

  @ManyToOne(() => Repartidor)
  @JoinColumn({ name: 'repartidor_id' })
  repartidor?: Repartidor;

  /** Null cuando la rinde el seed del demo (sin usuario). */
  @Column({ name: 'rendida_por', type: 'uuid', nullable: true })
  rendidaPor: string | null;

  @Column({ name: 'rendida_el', type: 'timestamptz', default: () => 'now()' })
  rendidaEl: Date;

  @Column({ name: 'total_entregados', type: 'int' })
  totalEntregados: number;

  @Column({
    name: 'monto_cobrado_destino',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  montoCobradoDestino: string;

  @Column({
    name: 'monto_cobrado_efectivo',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  montoCobradoEfectivo: string;

  @Column({
    name: 'monto_cobrado_transferencia',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  montoCobradoTransferencia: string;

  @Column({
    name: 'monto_pago_repartidor',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  montoPagoRepartidor: string;

  @Column({
    name: 'monto_entregado_a_cuenta',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  montoEntregadoACuenta: string;

  /** Positivo: lo debe el repartidor. Negativo: la empresa le paga. */
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  saldo: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
