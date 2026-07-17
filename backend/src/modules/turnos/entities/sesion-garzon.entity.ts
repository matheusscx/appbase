import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

export enum EstadoSesionGarzon {
  ABIERTA = 'abierta',
  CERRADA = 'cerrada',
}

export enum OrigenCierreSesion {
  PIN = 'pin',
  ADMIN = 'admin',
}

@Entity('sesiones_garzon')
@Index('uq_sesion_garzon_abierta', ['tenantId', 'garzonId'], {
  unique: true,
  where: `"estado" = 'abierta' AND "eliminado_el" IS NULL`,
})
export class SesionGarzon {
  @PrimaryGeneratedColumn('uuid', { name: 'sesion_garzon_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  @Column({ name: 'turno_id', type: 'uuid' })
  turnoId: string;

  @Column({ name: 'inicio_el', type: 'timestamptz' })
  inicioEl: Date;

  @Column({ name: 'fin_el', type: 'timestamptz', nullable: true })
  finEl: Date | null;

  @Column({ type: 'text', default: EstadoSesionGarzon.ABIERTA })
  estado: EstadoSesionGarzon;

  @Column({ name: 'origen_cierre', type: 'text', nullable: true })
  origenCierre: OrigenCierreSesion | null;

  @Column({ name: 'cerrada_por_usuario_id', type: 'uuid', nullable: true })
  cerradaPorUsuarioId: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
