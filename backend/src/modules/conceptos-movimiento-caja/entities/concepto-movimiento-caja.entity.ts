import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Atajo de concepto para los movimientos de caja (entrada/salida de efectivo).
 * Lo arma el admin del tenant; la cajera puede ignorarlo y escribir otro
 * concepto, así que `caja_movimientos.concepto` sigue siendo texto libre y
 * esta tabla NO se referencia desde ahí.
 */
// `uq_concepto_mov_caja_tenant_nombre` es sobre `lower(nombre)` parcial: TypeORM no sabe
// expresar una función en `@Index`, así que lo crea la migración con SQL cruda y acá
// solo se registra el NOMBRE con `synchronize: false` (ADR-030).
@Index('uq_concepto_mov_caja_tenant_nombre', { synchronize: false })
@Check('chk_concepto_mov_caja_tipo', `"tipo" IN ('entrada', 'salida', 'ambos')`)
@Entity('concepto_movimiento_caja')
export class ConceptoMovimientoCaja {
  @PrimaryGeneratedColumn('uuid', { name: 'concepto_movimiento_caja_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  /** A qué movimientos se ofrece: `entrada`, `salida` o `ambos`. */
  @Column({ type: 'text', default: 'ambos' })
  tipo: string;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({
    name: 'actualizado_el',
    type: 'timestamptz',
    nullable: true,
  })
  actualizadoEl: Date | null;

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
