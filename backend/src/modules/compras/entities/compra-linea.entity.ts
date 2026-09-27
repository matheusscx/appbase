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

export interface SerieCompraInput {
  serie: string;
  condicion?: 'nuevo' | 'usado' | 'reacondicionado';
  garantiaHasta?: string;
}

export interface LoteCompraInput {
  codigoLote: string;
  fechaElaboracion?: string;
  fechaVencimiento?: string;
}

/**
 * Línea de una compra (spec compras-recepcion § 3.2). Lo que el encargado
 * tipea (`cantidad`, `unidadCodigo`, `precioUnitario`) se guarda tal cual; lo
 * de "Congelado al confirmar" lo escribe la confirmación y no se edita.
 */
@Entity('compra_lineas')
@Index('idx_compra_lineas_compra', ['compraId'])
@Check(
  'chk_compra_lineas_unidad_o_presentacion',
  `("unidad_codigo" IS NULL) <> ("presentacion_compra_id" IS NULL)`,
)
export class CompraLinea {
  @PrimaryGeneratedColumn('uuid', { name: 'compra_linea_id' })
  id: string;

  @Column({ name: 'compra_id', type: 'uuid' })
  compraId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  /** El de la factura. */
  @Column({ type: 'int' })
  orden: number;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  /** Null cuando la línea va en una presentación: exactamente una de las dos (CHECK). */
  @Column({ name: 'unidad_codigo', type: 'text', nullable: true })
  unidadCodigo: string | null;

  /** La presentación elegida en el borrador (spec pieza 2 § 3.2). */
  @Column({ name: 'presentacion_compra_id', type: 'uuid', nullable: true })
  presentacionCompraId: string | null;

  /** Por unidad TIPEADA. Null = falta costo. `>= 0`: el 0 es el regalo. */
  @Column({
    name: 'precio_unitario',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  precioUnitario: string | null;

  @Column({ type: 'jsonb', nullable: true })
  series: SerieCompraInput[] | null;

  @Column({ type: 'jsonb', nullable: true })
  lote: LoteCompraInput | null;

  // ── Congelado al confirmar ────────────────────────────────────────────

  @Column({
    name: 'cantidad_base',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  cantidadBase: string | null;

  /** Después de convertir y de repartir el descuento. Null si falta el precio. */
  @Column({
    name: 'costo_unitario_base',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoUnitarioBase: string | null;

  /** El nombre de la presentación al confirmar: el detalle no lee una retirada. */
  @Column({
    name: 'presentacion_nombre',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  presentacionNombre: string | null;

  /** Cuántas unidades base trae UNA presentación, al confirmar. Corregir la cantidad usa este, no el vivo. */
  @Column({
    name: 'contenido_base',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  contenidoBase: string | null;

  /** La entrada original en el kardex. */
  @Column({ name: 'movimiento_id', type: 'uuid', nullable: true })
  movimientoId: string | null;

  /**
   * Stock total del producto (todas las ubicaciones) justo antes de la
   * entrada: el punto de partida de "rehacer la cuenta" (spec § 4.3).
   */
  @Column({
    name: 'stock_total_anterior',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  stockTotalAnterior: string | null;

  /** El CPP del producto justo antes de la entrada (spec § 4.3). */
  @Column({
    name: 'costo_producto_anterior',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoProductoAnterior: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;
}
