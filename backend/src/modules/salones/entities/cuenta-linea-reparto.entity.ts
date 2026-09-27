import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Cuántas unidades de una línea de la cuenta entraron con cada responsable
 * vigente (spec `2026-09-27-porcentaje-anulaciones-por-garzon-design.md` § 3).
 * Es lo que permite repartir la venta de una mesa transferida entre los
 * garzones que la atendieron (owner, 2026-09-20).
 *
 * Invariante: para toda línea viva, Σ `cantidad` de sus filas vivas =
 * `cuenta_lineas.cantidad`. La sostiene `SalonesService`, que es el único que
 * escribe esta tabla y siempre bajo el `FOR UPDATE` de la cuenta.
 *
 * `uq_cuenta_linea_reparto_garzon`: a lo sumo una fila viva por (línea,
 * garzón). Con `garzon_id` null no cubre (Postgres trata los null como
 * distintos); ahí lo sostiene el código. También es el índice por el que se
 * leen las filas de una línea.
 */
@Index('uq_cuenta_linea_reparto_garzon', ['cuentaLineaId', 'garzonId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
@Entity('cuenta_linea_reparto')
export class CuentaLineaReparto {
  @PrimaryGeneratedColumn('uuid', { name: 'cuenta_linea_reparto_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'cuenta_linea_id', type: 'uuid' })
  cuentaLineaId: string;

  @Column({ name: 'garzon_id', type: 'uuid', nullable: true })
  garzonId: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
