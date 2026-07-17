import {
  Entity,
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

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
