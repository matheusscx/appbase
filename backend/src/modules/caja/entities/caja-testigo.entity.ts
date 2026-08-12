import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

export type EstadoTestigo =
  | 'pendiente'
  | 'firmada'
  | 'rechazada'
  | 'cancelada'
  | 'caducada';

/**
 * Quién dio fe de un conteo de caja. Las filas son **hechos con hora**: se
 * insertan y se resuelven una vez, nunca se editan ni se borran. El soft delete
 * está por convención del repo; ninguna operación de esta feature lo usa.
 */
@Entity('caja_testigo')
@Index('ux_caja_testigo_caja_garzon', ['cajaId', 'garzonId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class CajaTestigo {
  @PrimaryGeneratedColumn('uuid', { name: 'caja_testigo_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'caja_id', type: 'uuid' })
  cajaId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  /** La prueba de que estaba en turno, no solo de quién es. */
  @Column({ name: 'sesion_garzon_id', type: 'uuid' })
  sesionGarzonId: string;

  @Column({ name: 'solicitada_por', type: 'uuid' })
  solicitadaPor: string;

  @Column({ name: 'estado', type: 'text', default: 'pendiente' })
  estado: EstadoTestigo;

  @Column({ name: 'comentario_garzon', type: 'text', nullable: true })
  comentarioGarzon: string | null;

  @Column({ name: 'solicitada_el', type: 'timestamptz' })
  solicitadaEl: Date;

  @Column({ name: 'resuelta_el', type: 'timestamptz', nullable: true })
  resueltaEl: Date | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({
    name: 'actualizado_el',
    type: 'timestamptz',
    nullable: true,
  })
  actualizadoEl: Date | null;

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;
}
