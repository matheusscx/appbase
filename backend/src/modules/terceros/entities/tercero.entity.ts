import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('terceros')
@Check(
  'chk_terceros_plazo_pago_positivo',
  `"plazo_pago_dias" IS NULL OR "plazo_pago_dias" > 0`,
)
export class Tercero {
  @PrimaryGeneratedColumn('uuid', { name: 'tercero_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  tipo: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  rut: string | null;

  @Column({
    name: 'nombre_legal',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  nombreLegal: string | null;

  @Column({ name: 'rut_fiscal', type: 'varchar', length: 50, nullable: true })
  rutFiscal: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  correo: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  telefono: string | null;

  @Column({ type: 'text', nullable: true })
  direccion: string | null;

  /**
   * Giro y comuna, para precargar el receptor de una Factura (ver
   * `VentaCustomer.giro`). Opcionales: un proveedor no los necesita.
   */
  @Column({ type: 'varchar', length: 40, nullable: true })
  giro: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  comuna: string | null;

  @Column({ default: true })
  activo: boolean;

  /**
   * El plazo de pago en días, para un proveedor (spec
   * compras-deuda-proveedor § 2, decisión 4). `null` = 30 días (el default
   * de la ley 19.983, ver la spec). Se usa desde `deuda.ts → vencimiento`.
   */
  @Column({ name: 'plazo_pago_dias', type: 'int', nullable: true })
  plazoPagoDias: number | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
