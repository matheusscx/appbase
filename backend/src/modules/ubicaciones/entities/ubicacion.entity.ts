import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * Un lugar donde vive stock. `tipo` es el corte que define todo el resto:
 * el `local` **vende** (toda venta descuenta de él) y una `bodega` solo
 * guarda. Ese corte es también el que mantiene a las bodegas fuera de lo
 * fiscal: una bodega no se declara al SII y no aparece en ningún documento
 * (ver «El corte: qué es una bodega, y qué no» en
 * `docs/features/bodegas-y-traslados.md`, y ADR-010).
 *
 * Cada tenant tiene exactamente una fila `tipo='local'`, sembrada al crearlo.
 * No se elimina ni se desactiva.
 */
@Index('idx_ubicaciones_tenant', ['tenantId'])
@Entity('ubicaciones')
export class Ubicacion {
  @PrimaryGeneratedColumn('uuid', { name: 'ubicacion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  // `type: 'text'` explícito y no inferido: estrechar el tipo TS a una unión
  // sin declarar el tipo de columna deja `design:type` en `Object` y TypeORM
  // **no arranca**. No lo caza ni el unitario ni el typecheck, solo el e2e.
  @Column({ type: 'text' })
  tipo: 'local' | 'bodega';

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
