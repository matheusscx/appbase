import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('paquete_configuracion')
@Index('uq_paquete_config_tenant', ['tenantId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class PaqueteConfiguracion {
  @PrimaryGeneratedColumn('uuid', { name: 'paquete_configuracion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({
    name: 'precio_envio_defecto',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  precioEnvioDefecto: string;

  @Column({
    name: 'pago_repartidor_defecto',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  pagoRepartidorDefecto: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
