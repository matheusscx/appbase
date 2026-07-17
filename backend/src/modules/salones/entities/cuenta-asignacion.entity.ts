import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum MotivoCuentaAsignacion {
  APERTURA = 'apertura',
  TRANSFERENCIA_PIN = 'transferencia_pin',
  TRANSFERENCIA_ADMIN = 'transferencia_admin',
}

@Index('uq_cuenta_asignacion_vigente', ['cuentaId'], {
  unique: true,
  where: '"hasta_el" IS NULL AND "eliminado_el" IS NULL',
})
@Index('idx_cuenta_asignaciones_timeline', ['tenantId', 'cuentaId', 'desdeEl'])
@Entity('cuenta_asignaciones')
export class CuentaAsignacion {
  @PrimaryGeneratedColumn('uuid', { name: 'cuenta_asignacion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'cuenta_id', type: 'uuid' })
  cuentaId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  @Column({ name: 'desde_el', type: 'timestamptz' })
  desdeEl: Date;

  @Column({ name: 'hasta_el', type: 'timestamptz', nullable: true })
  hastaEl: Date | null;

  @Column({ type: 'text' })
  motivo: MotivoCuentaAsignacion;

  @Column({ name: 'origen_garzon_id', type: 'uuid', nullable: true })
  origenGarzonId: string | null;

  @Column({ name: 'actor_usuario_id', type: 'uuid', nullable: true })
  actorUsuarioId: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
