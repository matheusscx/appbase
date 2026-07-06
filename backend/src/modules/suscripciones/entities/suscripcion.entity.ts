import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('suscripciones')
export class Suscripcion {
  @PrimaryGeneratedColumn('uuid', { name: 'suscripcion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'text' })
  frecuencia: string; // snapshot del item al suscribirse

  @Column({ name: 'dia_mes', type: 'smallint', nullable: true })
  diaMes: number | null;

  @Column({ name: 'dia_semana', type: 'smallint', nullable: true })
  diaSemana: number | null;

  @Column({ type: 'text', default: 'activa' })
  estado: string; // 'activa' | 'pausada' | 'cancelada'

  @Column({ name: 'proximo_cobro', type: 'date' })
  proximoCobro: string;

  @Column({ name: 'tarjeta_marca', type: 'text', nullable: true })
  tarjetaMarca: string | null;

  @Column({ name: 'tarjeta_last4', type: 'text', nullable: true })
  tarjetaLast4: string | null;

  @Column({ name: 'venta_inicial_id', type: 'uuid', nullable: true })
  ventaInicialId: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
