import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum EstadoCuenta {
  ABIERTA = 'abierta',
  CERRADA = 'cerrada',
  CANCELADA = 'cancelada',
}

@Entity('cuentas')
export class Cuenta {
  @PrimaryGeneratedColumn('uuid', { name: 'cuenta_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'mesa_id', type: 'uuid' })
  mesaId: string;

  // Correlativo por tenant para identificar la cuenta ("Cuenta 85").
  @Column({ type: 'int' })
  numero: number;

  @Column({ type: 'text', nullable: true })
  nombre: string | null;

  @Column({ type: 'text', default: EstadoCuenta.ABIERTA })
  estado: EstadoCuenta;

  // Venta generada al cerrar la cuenta (null mientras está abierta/cancelada).
  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  @Column({ name: 'abierta_el', type: 'timestamptz', default: () => 'now()' })
  abiertaEl: Date;

  @Column({ name: 'cerrada_el', type: 'timestamptz', nullable: true })
  cerradaEl: Date | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
