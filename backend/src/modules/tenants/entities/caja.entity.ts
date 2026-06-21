import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('cajas')
export class Caja {
  @PrimaryGeneratedColumn('uuid', { name: 'caja_id' })
  id: string;

  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'usuario_id', type: 'varchar', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'moneda_id', type: 'varchar', nullable: true })
  monedaId: string | null;

  @Column({ default: 'virtual' })
  tipo: string; // 'fisica' | 'virtual'

  @Column({
    name: 'fecha_apertura',
    type: 'timestamptz',
    default: () => 'NOW()',
  })
  fechaApertura: Date;

  @Column({ name: 'fecha_cierre', type: 'timestamptz', nullable: true })
  fechaCierre: Date | null;

  @Column({
    name: 'saldo_inicial',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
  })
  saldoInicial: string;

  @Column({
    name: 'saldo_final',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  saldoFinal: string | null;

  @Column({
    name: 'monto_contado',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  montoContado: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true })
  diferencia: string | null;

  @Column({ default: 'abierta' })
  estado: string; // 'abierta' | 'cerrada'

  @Column({ type: 'varchar', nullable: true })
  comentario: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
