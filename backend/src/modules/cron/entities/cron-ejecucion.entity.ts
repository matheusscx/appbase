import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('cron_ejecuciones')
export class CronEjecucion {
  @PrimaryGeneratedColumn('uuid', { name: 'ejecucion_id' })
  ejecucionId: string;

  // Nombre estable del job, ej. 'expirar-ordenes'. Índice: consulta de historial.
  @Index()
  @Column()
  job: string;

  @Column({ name: 'iniciado_el', type: 'timestamptz' })
  iniciadoEl: Date;

  @Column({ name: 'finalizado_el', type: 'timestamptz', nullable: true })
  finalizadoEl: Date | null;

  @Column({ default: 'en_curso' })
  estado: string; // 'en_curso' | 'ok' | 'error'

  @Column({ type: 'text', nullable: true })
  detalle: string | null; // resumen del resultado, ej. "3 órdenes expiradas"

  @Column({ type: 'text', nullable: true })
  error: string | null; // mensaje si estado = 'error'

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
