import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid', { name: 'tenant_id' })
  id: string;

  @Column({ name: 'provincia_id', type: 'uuid' })
  provinciaId: string;

  @Column()
  nombre: string;

  @Column({ unique: true })
  correo: string;

  @Column({ type: 'varchar', nullable: true })
  telefono: string | null;

  @Column({ type: 'varchar', nullable: true })
  direccion: string | null;

  @Column({ name: 'calculo_descuentos', default: 'base' })
  calculoDescuentos: string;

  @Column({ name: 'calculo_recargos', default: 'base' })
  calculoRecargos: string;

  @Column({ name: 'escala_calculo', type: 'smallint', default: 6 })
  escalaCalculo: number;

  @Column({ name: 'modo_redondeo', default: 'HALF_UP' })
  modoRedondeo: string;

  @Column({
    name: 'monto_tolerancia',
    type: 'numeric',
    precision: 18,
    scale: 6,
    default: 0,
  })
  montoTolerancia: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
