import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

// Detalle del cierre por método de pago, CONGELADO al cerrar (nunca se recomputa).
// Una fila por línea del arqueo. metodo_pago_id NULL = la línea de efectivo agregada.
@Entity('caja_arqueo_medio')
@Index('ux_caja_arqueo_medio', ['cajaId', 'metodoPagoId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class CajaArqueoMedio {
  @PrimaryGeneratedColumn('uuid', { name: 'arqueo_medio_id' })
  arqueoMedioId: string;

  @Column({ name: 'caja_id', type: 'uuid' })
  cajaId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  // NULL = línea de efectivo agregada (fondo + es_efectivo + manuales − salidas).
  @Column({ name: 'metodo_pago_id', type: 'uuid', nullable: true })
  metodoPagoId: string | null;

  @Column({ name: 'es_efectivo' })
  esEfectivo: boolean;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  esperado: string;

  // NULL = línea informativa (no se contó).
  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true })
  contado: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true })
  diferencia: string | null;

  @Column({ name: 'motivo_diferencia_id', type: 'uuid', nullable: true })
  motivoDiferenciaId: string | null;

  @Column({ name: 'comentario_diferencia', type: 'text', nullable: true })
  comentarioDiferencia: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
