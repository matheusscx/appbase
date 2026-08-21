import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * El tope es 4 porque toda columna de dinero es NUMERIC(18,4): una moneda con
 * más decimales haría que el recorte final lo decidiera el cast de Postgres,
 * con su propia regla y fuera de modo_redondeo. Las 3 sembradas cumplen
 * (CLP 0, USD 2, UF 4). Subir el tope exige subir la escala de las columnas.
 */
@Entity('moneda')
@Check('chk_moneda_decimales', '"decimales" BETWEEN 0 AND 4')
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

  /** Locale BCP 47 para Intl.NumberFormat y maska (ej. es-CL, en-US). */
  @Column({ type: 'varchar', length: 10, default: 'es-CL' })
  locale: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date;
}
