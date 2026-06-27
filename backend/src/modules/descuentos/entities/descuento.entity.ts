import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { ModoRegla, CondicionTipo } from '../../../common/enums/reglas.enums';

@Entity('descuentos')
export class Descuento {
  @PrimaryGeneratedColumn('uuid', { name: 'descuento_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'enum', enum: ModoRegla, enumName: 'modo_regla' })
  modo: ModoRegla;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  valor: string | null; // numeric ↦ string en JS; null cuando usa tramos

  @Column({ name: 'tipo_regla_id', type: 'uuid' })
  tipoReglaId: string;

  @Column({
    name: 'condicion_tipo',
    type: 'enum',
    enum: CondicionTipo,
    enumName: 'condicion_tipo',
    default: CondicionTipo.NINGUNA,
  })
  condicionTipo: CondicionTipo;

  @Column({ name: 'condicion_valor', type: 'text', nullable: true })
  condicionValor: string | null;

  @Column({ name: 'fecha_inicio', type: 'date', nullable: true })
  fechaInicio: string | null;

  @Column({ name: 'fecha_fin', type: 'date', nullable: true })
  fechaFin: string | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
