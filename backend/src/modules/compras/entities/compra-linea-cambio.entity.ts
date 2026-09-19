import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Historial de correcciones de una línea confirmada (spec § 3.5).
 *
 * Append-only, como el kardex: sin `eliminado_el` porque un cambio ya hecho
 * no se deshace borrándolo, se corrige con otro cambio.
 */
@Entity('compra_linea_cambios')
@Index('idx_compra_linea_cambios_linea', ['compraLineaId'])
export class CompraLineaCambio {
  @PrimaryGeneratedColumn('uuid', { name: 'compra_linea_cambio_id' })
  id: string;

  @Column({ name: 'compra_linea_id', type: 'uuid' })
  compraLineaId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  campo: 'precio' | 'cantidad' | 'descuento';

  @Column({ name: 'valor_anterior', type: 'text', nullable: true })
  valorAnterior: string | null;

  @Column({ name: 'valor_nuevo', type: 'text', nullable: true })
  valorNuevo: string | null;

  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  /** La diferencia de stock o la `correccion_compra` que generó. */
  @Column({ name: 'movimiento_id', type: 'uuid', nullable: true })
  movimientoId: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;
}
