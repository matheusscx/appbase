import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { TipoGarzon } from '../../garzones/enums/tipo-garzon.enum';

export enum TipoVentaPropina {
  SUGERIDA = 'sugerida',
  MANUAL = 'manual',
}

export enum EstadoVentaPropina {
  PAGADA = 'pagada',
  SIN_PROPINA = 'sin_propina',
}

@Index('uq_venta_propina_venta', ['ventaId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
@Index('idx_venta_propina_garzon', ['tenantId', 'garzonId', 'creadoEl'])
@Entity('venta_propina')
export class VentaPropina {
  @PrimaryGeneratedColumn('uuid', { name: 'venta_propina_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  @Column({
    name: 'porcentaje_sugerido',
    type: 'numeric',
    precision: 10,
    scale: 6,
  })
  porcentajeSugerido: string;

  @Column({
    name: 'monto_sugerido',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  montoSugerido: string;

  @Column({
    name: 'monto_pagado',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  montoPagado: string;

  @Column({ type: 'text' })
  tipo: TipoVentaPropina;

  @Column({ type: 'text' })
  estado: EstadoVentaPropina;

  @Column({ name: 'sesion_garzon_id', type: 'uuid', nullable: true })
  sesionGarzonId: string | null;

  @Column({ name: 'turno_id', type: 'uuid', nullable: true })
  turnoId: string | null;

  @Column({ name: 'tipo_garzon', type: 'text', nullable: true })
  tipoGarzon: TipoGarzon | null;

  @Column({ name: 'liquidacion_id', type: 'uuid', nullable: true })
  liquidacionId: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
