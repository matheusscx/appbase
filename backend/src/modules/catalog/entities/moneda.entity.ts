import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('moneda')
export class Moneda {
  @PrimaryGeneratedColumn('uuid', { name: 'moneda_id' })
  monedaId: string;

  @Column()
  nombre: string;

  @Column({ name: 'codigo_iso', type: 'char', length: 3, unique: true })
  codigoIso: string;

  @Column({ name: 'codigo_numero', type: 'char', length: 3, unique: true })
  codigoNumero: string;

  @Column({ type: 'varchar', nullable: true })
  simbolo: string | null;

  @Column({ type: 'smallint', default: 0 })
  decimales: number;

  /** Separador decimal para presentación (ej. ',' en Chile, '.' en México). */
  @Column({ name: 'separador_decimal', type: 'char', length: 1, default: ',' })
  separadorDecimal: string;

  /** Separador de miles para presentación (ej. '.' en Chile, ',' en México). */
  @Column({ name: 'separador_miles', type: 'char', length: 1, default: '.' })
  separadorMiles: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date;
}
