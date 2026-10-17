import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// `uq_tarifas_envio_tenant_nombre` es sobre `lower(nombre)`: TypeORM no sabe expresar una
// función en `@Index`, así que lo crea la migración con SQL cruda y acá solo se registra el
// NOMBRE con `synchronize: false`, para que `migration:generate` no proponga borrarlo (ADR-030).
@Index('uq_tarifas_envio_tenant_nombre', { synchronize: false })
// Exactamente una por defecto y viva por tenant: lo garantiza el índice, no solo el service.
@Index('uq_tarifas_envio_defecto', ['tenantId'], {
  unique: true,
  where: '"es_defecto" AND "eliminado_el" IS NULL',
})
@Entity('tarifas_envio')
export class TarifaEnvio {
  @PrimaryGeneratedColumn('uuid', { name: 'tarifa_envio_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  monto: string;

  @Column({ name: 'es_defecto', type: 'boolean', default: false })
  esDefecto: boolean;

  @Column({ type: 'boolean', default: true })
  activa: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
