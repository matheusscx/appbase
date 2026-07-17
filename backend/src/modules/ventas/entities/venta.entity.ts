import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum EstadoVenta {
  BORRADOR = 'borrador',
  PENDIENTE = 'pendiente',
  PAGADA_PARCIAL = 'pagada_parcial',
  PAGADA = 'pagada',
  CANCELADA = 'cancelada',
}

@Entity('ventas')
export class Venta {
  @PrimaryGeneratedColumn('uuid', { name: 'venta_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'caja_id', type: 'uuid', nullable: true })
  cajaId: string | null;

  @Column({ name: 'moneda_id', type: 'uuid' })
  monedaId: string;

  @Column({ name: 'tipo_documento_id', type: 'uuid', nullable: true })
  tipoDocumentoId: string | null;

  @Column({ type: 'text', default: 'fisico' })
  canal: string;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  fecha: Date;

  @Column({
    type: 'enum',
    enum: EstadoVenta,
    default: EstadoVenta.PENDIENTE,
  })
  estado: EstadoVenta;

  @Column({
    name: 'total_bruto',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  totalBruto: string;

  @Column({
    name: 'total_descuentos',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  totalDescuentos: string;

  @Column({
    name: 'total_recargos',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  totalRecargos: string;

  @Column({
    name: 'total_impuestos',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  totalImpuestos: string;

  @Column({
    name: 'total_final',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  totalFinal: string;

  @Column({
    name: 'base_ventas_total_final',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  baseVentasTotalFinal: string;

  @Column({
    name: 'base_ventas_sin_impuestos',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  baseVentasSinImpuestos: string;

  @Column({ name: 'venta_referencia_id', type: 'uuid', nullable: true })
  ventaReferenciaId: string | null;

  @Column({ type: 'text', nullable: true })
  comentario: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
