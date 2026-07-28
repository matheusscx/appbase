import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

// Índice único parcial: máximo una sesión abierta por cajón (backstop duro bajo
// concurrencia). La virtual tiene cajon_id null → no participa del índice único.
@Entity('cajas')
@Index('ux_cajas_cajon_abierta', ['cajonId'], {
  unique: true,
  where: 'estado = \'abierta\' AND "eliminado_el" IS NULL',
})
// Backstop duro de "una caja física por tenant+usuario": el chequeo aplicativo de
// `abrir()` corre FUERA de la transacción, así que dos aperturas simultáneas sobre
// cajones DISTINTOS no competían por nada y el mismo cajero terminaba con dos cajas
// abiertas. Incluye `en_conciliacion` porque también ocupa al cajero (`findActiva`).
@Index('ux_cajas_activa_por_usuario', ['tenantId', 'usuarioId'], {
  unique: true,
  where: `tipo = 'fisica' AND estado IN ('abierta', 'en_conciliacion') AND "eliminado_el" IS NULL`,
})
export class Caja {
  @PrimaryGeneratedColumn('uuid', { name: 'caja_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'cajon_id', type: 'uuid', nullable: true })
  cajonId: string | null;

  @Column({ name: 'moneda_id', type: 'uuid', nullable: true })
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
  estado: string; // 'abierta' | 'en_conciliacion' | 'cerrada'

  @Column({ type: 'varchar', nullable: true })
  comentario: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
