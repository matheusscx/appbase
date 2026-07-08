import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_ordenes')
export class PasarelaOrden {
  @PrimaryGeneratedColumn('uuid', { name: 'orden_id' })
  ordenId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'pagador_ref', type: 'varchar', length: 100, nullable: true })
  pagadorRef: string | null;

  @Column({ name: 'referencia_externa', type: 'varchar', nullable: true })
  referenciaExterna: string | null; // correlación de la app: venta_id interno, folio externo...

  @Index({ unique: true })
  @Column({ name: 'codigo_orden' })
  codigoOrden: string; // buyOrder generado por nosotros, ≤26 chars

  @Column()
  descripcion: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  monto: string; // numeric ↦ string, Decimal.js para operar

  @Column({ length: 3 })
  moneda: string; // 'CLP' en v1

  @Column({ default: 'creada' })
  estado: string; // 'creada' | 'en_proceso' | 'pagada' | 'fallida' | 'expirada' | 'reembolsada'

  @Column({ name: 'fecha_expiracion', type: 'timestamptz', nullable: true })
  fechaExpiracion: Date | null;

  @Column()
  origen: string; // 'interno' | 'api'

  @Column({ name: 'api_key_id', type: 'uuid', nullable: true })
  apiKeyId: string | null; // qué llave la creó (trazabilidad)

  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
