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
import { Tercero } from '../../terceros/entities/tercero.entity';
import { TarifaPago } from './tarifa-pago.entity';

@Entity('paquetes')
@Index('uq_paquetes_tenant_codigo', ['tenantId', 'codigo'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
@Index('idx_paquetes_remitente', ['remitenteTerceroId'])
export class Paquete {
  @PrimaryGeneratedColumn('uuid', { name: 'paquete_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  codigo: string;

  @Column({
    name: 'destinatario_nombre',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  destinatarioNombre: string | null;

  @Column({
    name: 'destinatario_telefono',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  destinatarioTelefono: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  direccion: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  comuna: string | null;

  @Column({ type: 'text', nullable: true })
  nota: string | null;

  @Column({ name: 'remitente_tercero_id', type: 'uuid', nullable: true })
  remitenteTerceroId: string | null;

  @ManyToOne(() => Tercero, { nullable: true })
  @JoinColumn({ name: 'remitente_tercero_id' })
  remitente?: Tercero;

  @Column({ name: 'cobro_en_destino', type: 'boolean', default: false })
  cobroEnDestino: boolean;

  @Column({ name: 'precio_envio', type: 'numeric', precision: 18, scale: 4 })
  precioEnvio: string;

  @Column({ name: 'pago_repartidor', type: 'numeric', precision: 18, scale: 4 })
  pagoRepartidor: string;

  /** Tarifa especial de este paquete (p. ej. "Colina"); reemplaza a la del repartidor. */
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
