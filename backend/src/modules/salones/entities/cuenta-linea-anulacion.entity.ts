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
 * Una fila por anulación de un plato ya despachado; varias por línea.
 * **Sobrevive al borrado de la línea**: es el único rastro que queda en la
 * cuenta cuando `cuenta_lineas` la borra por quedar en cero.
 */
/**
 * `(tenant_id, cuenta_id)` y no `cuenta_id` solo, mismo criterio que
 * `idx_cuenta_lineas_cuenta`: la consulta filtra por tenant en las dos tablas
 * y en ese orden. La usa `SalonesService.anulacionesPorCuenta`, el bloque
 * `anulaciones` de `armarDetalles` — batch para N cuentas con
 * `cuenta_id = ANY($1)` — y crece con cada anulación de la historia del
 * tenant. Postgres no indexa las FK por su cuenta.
 */
@Index('idx_cuenta_linea_anulaciones_cuenta', ['tenantId', 'cuentaId'])
@Entity('cuenta_linea_anulaciones')
export class CuentaLineaAnulacion {
  @PrimaryGeneratedColumn('uuid', { name: 'cuenta_linea_anulacion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** La cuenta, no solo la línea: la línea se borra cuando se anula entera. */
  @Column({ name: 'cuenta_id', type: 'uuid' })
  cuentaId: string;

  @Column({ name: 'cuenta_linea_id', type: 'uuid' })
  cuentaLineaId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  /** Congelado: el catálogo puede renombrar o borrar el ítem después. */
  @Column({ name: 'item_nombre', type: 'text' })
  itemNombre: string;

  /** Unidad canónica de la línea, la misma que `cuenta_lineas.cantidad_enviada`. */
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({ name: 'motivo_baja_id', type: 'uuid' })
  motivoBajaId: string;

  @Column({ name: 'autorizado_por', type: 'uuid' })
  autorizadoPor: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
