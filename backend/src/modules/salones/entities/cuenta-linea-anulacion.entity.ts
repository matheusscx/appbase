import {
  Check,
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
/**
 * Los tres baldes fiscales van juntos: una cortesía con base y sin impuesto
 * (o al revés) no se puede escribir. El tipo del motivo vive en `motivos_baja`
 * y un CHECK no lo alcanza; que solo la cortesía los llene lo hace el service.
 */
@Check(
  'chk_cuenta_linea_anulaciones_baldes_juntos',
  '("monto_afecto" IS NULL) = ("monto_exento" IS NULL) AND ("monto_afecto" IS NULL) = ("monto_impuestos" IS NULL)',
)
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

  /**
   * Precio de carta de la línea al anular (`cuenta_lineas.precio_unitario`,
   * ya en la moneda oficial, antes de descuentos/recargos/impuestos): la
   * línea se borra cuando queda en cero, así que este es el único rastro
   * que sobrevive (spec § 3.1).
   */
  @Column({
    name: 'precio_unitario',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  precioUnitario: string;

  /** Unidad canónica de la línea, la misma que `cuenta_lineas.cantidad_enviada`. */
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({ name: 'motivo_baja_id', type: 'uuid' })
  motivoBajaId: string;

  @Column({ name: 'autorizado_por', type: 'uuid' })
  autorizadoPor: string;

  /**
   * `cuentas.garzon_responsable_id` en el momento de anular, no el actual:
   * ni una transferencia ni una fusión posterior lo cambian. Null si la
   * cuenta no tenía responsable (spec § 3.1).
   */
  @Column({ name: 'garzon_id', type: 'uuid', nullable: true })
  garzonId: string | null;

  /**
   * Los baldes del retiro, congelados al anular: **solo una cortesía los
   * llena** (DL 825 art. 8 d), owner 2026-10-03: *"Guardar el IVA ya"* y
   * *"Siempre paga IVA"*); `merma` y `no_elaborado` quedan en NULL. Mismos
   * nombres y escala que `venta_documentos` (ADR-028), para que el emisor del
   * SII lea un solo vocabulario. Base = precio de carta sin descuentos ni
   * promociones, neto de impuestos; `monto_impuestos` es solo el IVA. Exento
   * es explícito: base en `monto_exento` e impuesto 0, nunca NULL. Spec
   * `2026-10-03-cortesia-retiro-iva-design.md` § 3.
   */
  @Column({
    name: 'monto_afecto',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  montoAfecto: string | null;

  @Column({
    name: 'monto_exento',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  montoExento: string | null;

  @Column({
    name: 'monto_impuestos',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  montoImpuestos: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
