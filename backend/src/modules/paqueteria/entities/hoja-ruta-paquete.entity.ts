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
import { HojaRuta } from './hoja-ruta.entity';
import { Paquete } from './paquete.entity';
import { TarifaEnvio } from './tarifa-envio.entity';
import { TarifaPago } from './tarifa-pago.entity';

@Entity('hoja_ruta_paquetes')
@Check(
  'chk_hoja_ruta_paquetes_medio_cobro',
  `"medio_cobro" IN ('efectivo', 'transferencia')`,
)
@Check(
  'chk_hoja_ruta_paquetes_pago',
  `("estado" = 'entregado') = ("pago_repartidor" IS NOT NULL)`,
)
@Check(
  'chk_hoja_ruta_paquetes_precio',
  `("estado" = 'entregado') = ("precio_envio" IS NOT NULL)`,
)
@Check(
  'chk_hoja_ruta_paquetes_medio_entregado',
  `"medio_cobro" IS NULL OR "estado" = 'entregado'`,
)
@Index('uq_hoja_ruta_paquetes_en_ruta', ['paqueteId'], {
  unique: true,
  where: `"estado" = 'en_ruta' AND "eliminado_el" IS NULL`,
})
@Index('idx_hoja_ruta_paquetes_hoja', ['hojaRutaId'])
@Index('idx_hoja_ruta_paquetes_paquete', ['paqueteId'])
export class HojaRutaPaquete {
  @PrimaryGeneratedColumn('uuid', { name: 'hoja_ruta_paquete_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'hoja_ruta_id', type: 'uuid' })
  hojaRutaId: string;

  @ManyToOne(() => HojaRuta)
  @JoinColumn({ name: 'hoja_ruta_id' })
  hoja?: HojaRuta;

  @Column({ name: 'paquete_id', type: 'uuid' })
  paqueteId: string;

  @ManyToOne(() => Paquete)
  @JoinColumn({ name: 'paquete_id' })
  paquete?: Paquete;

  @Column({ type: 'varchar', length: 20, default: 'en_ruta' })
  estado: 'en_ruta' | 'entregado' | 'no_entregado';

  /**
   * Lo que se le paga al repartidor por esta entrega, FIJADO al marcarla entregada: cambiar
   * después el monto de la tarifa no lo mueve. Null mientras no está entregada (el CHECK
   * `chk_hoja_ruta_paquetes_pago` lo exige en las dos direcciones).
   */
  @Column({ name: 'tarifa_pago_id', type: 'uuid', nullable: true })
  tarifaPagoId: string | null;

  @ManyToOne(() => TarifaPago, { nullable: true })
  @JoinColumn({ name: 'tarifa_pago_id' })
  tarifaPago?: TarifaPago;

  @Column({
    name: 'pago_repartidor',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  pagoRepartidor: string | null;

  /**
   * Lo que se COBRA por el envío de esta entrega, FIJADO al marcarla entregada (igual que el pago):
   * cambiar después el monto de la tarifa de envío no lo mueve. `tarifa_envio_id` es la tarifa de
   * la que salió; queda NULL en una línea anterior a las tarifas (solo se conoce el precio). Null
   * mientras no está entregada (`chk_hoja_ruta_paquetes_precio` lo exige en las dos direcciones).
   */
  @Column({ name: 'tarifa_envio_id', type: 'uuid', nullable: true })
  tarifaEnvioId: string | null;

  @ManyToOne(() => TarifaEnvio, { nullable: true })
  @JoinColumn({ name: 'tarifa_envio_id' })
  tarifaEnvio?: TarifaEnvio;

  @Column({
    name: 'precio_envio',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  precioEnvio: string | null;

  /** Cómo se pagó un cobro en destino: solo en una línea entregada de un paquete con cobro en destino. */
  @Column({ name: 'medio_cobro', type: 'varchar', length: 20, nullable: true })
  medioCobro: 'efectivo' | 'transferencia' | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
