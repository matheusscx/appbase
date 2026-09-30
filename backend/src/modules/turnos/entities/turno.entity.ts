import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Turno referencial del restaurante (ej. Almuerzo, Cena).
 * Los horarios son informativos y no bloquean entrada/salida de sesión.
 */
@Entity('turnos')
// `uq_turnos_tenant_nombre_vivo` es sobre `lower(nombre)`: TypeORM no sabe
// expresar una función en `@Index`, así que acá solo se registra el NOMBRE
// con `synchronize: false` para que `synchronize` no lo tire al arrancar
// (pendientes.md, "synchronize no tira los 17 índices del seeder"). Lo sigue
// creando `SeederService.seedTurnos()` con SQL cruda.
@Index('uq_turnos_tenant_nombre_vivo', { synchronize: false })
export class Turno {
  @PrimaryGeneratedColumn('uuid', { name: 'turno_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  /** Referencial HH:mm — no bloquea operación. */
  @Column({ name: 'hora_inicio', type: 'varchar', length: 5 })
  horaInicio: string;

  @Column({ name: 'hora_fin', type: 'varchar', length: 5 })
  horaFin: string;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
