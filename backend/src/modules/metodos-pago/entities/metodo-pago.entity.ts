import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('metodos_pago')
export class MetodoPago {
  @PrimaryGeneratedColumn('uuid', { name: 'metodo_pago_id' })
  metodoPagoId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'varchar', length: 5, nullable: true })
  abreviatura: string | null;

  @Column({ default: true })
  activo: boolean;

  // Intrínseco al método (catálogo global): define qué entra a la línea de
  // efectivo del arqueo (fondo + manuales + vueltos). No confundir con
  // requiere_conteo (política por tenant). Ver spec arqueo-multimedio.
  @Column({ name: 'es_efectivo', default: false })
  esEfectivo: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
