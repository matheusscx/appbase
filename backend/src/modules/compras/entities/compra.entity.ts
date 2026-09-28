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

export type EstadoCompra = 'borrador' | 'confirmada' | 'anulada';

/**
 * Encabezado de una compra (spec compras-recepcion § 3.1).
 *
 * El índice único es la red contra el folio repetido: por ley el folio es
 * único por emisor y tipo de documento, así que un repetido es siempre un
 * error (owner, 2026-09-18). "Sin documento" no tiene folio y queda fuera; una
 * compra anulada libera el suyo para cargarla bien.
 */
@Entity('compras')
@Index(
  'uq_compra_folio',
  ['tenantId', 'proveedorId', 'tipoDocumentoCompraId', 'folio'],
  {
    unique: true,
    where: `"folio" IS NOT NULL AND "estado" <> 'anulada' AND "eliminado_el" IS NULL`,
  },
)
@Check(
  'chk_compras_total_documento_positivo',
  `"total_documento" IS NULL OR "total_documento" > 0`,
)
export class Compra {
  @PrimaryGeneratedColumn('uuid', { name: 'compra_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'proveedor_id', type: 'uuid' })
  proveedorId: string;

  @Column({ name: 'tipo_documento_compra_id', type: 'uuid' })
  tipoDocumentoCompraId: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  folio: string | null;

  /** La del papel, no la de la carga. */
  @Column({ name: 'fecha_documento', type: 'date' })
  fechaDocumento: string;

  /** Adonde entra todo: una ubicación por compra (owner, 2026-09-18). */
  @Column({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

  // `text` explícito: sin él, el tipo de la propiedad deja `design:type` en
  // Object y TypeORM no arranca.
  @Column({ type: 'text', default: 'borrador' })
  estado: EstadoCompra;

  /**
   * Monto a la escala de la moneda oficial. Solo se acepta con todas las
   * líneas con precio (spec § 4.4).
   */
  @Column({
    name: 'descuento_total',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  descuentoTotal: string | null;

  @Column({ type: 'text', nullable: true })
  observacion: string | null;

  /**
   * Lo que el documento dice que hay que pagar, transcrito (spec
   * compras-deuda-proveedor § 3 y § 4.1, decisión 10): null en un tipo
   * `suma_lineas`, y en un `opcional` (la guía) hasta que se carga. El
   * sistema no lo calcula ni lo valida contra el neto de las líneas.
   */
  @Column({
    name: 'total_documento',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  totalDocumento: string | null;

  /**
   * Se fija al confirmar (spec § 4.2: la tipeada, o `fecha_documento` + el
   * plazo del proveedor) y se corrige con `PATCH /compras/:id/documento`.
   */
  @Column({ name: 'fecha_vencimiento', type: 'date', nullable: true })
  fechaVencimiento: string | null;

  @Column({ name: 'creado_por', type: 'uuid' })
  creadoPor: string;

  @Column({ name: 'confirmado_por', type: 'uuid', nullable: true })
  confirmadoPor: string | null;

  @Column({ name: 'confirmado_el', type: 'timestamptz', nullable: true })
  confirmadoEl: Date | null;

  @Column({ name: 'anulado_por', type: 'uuid', nullable: true })
  anuladoPor: string | null;

  @Column({ name: 'anulado_el', type: 'timestamptz', nullable: true })
  anuladoEl: Date | null;

  @Column({ name: 'motivo_anulacion', type: 'text', nullable: true })
  motivoAnulacion: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  /**
   * Solo un BORRADOR descartado se borra. Una confirmada se anula, nunca se
   * borra.
   *
   * Sin `eliminado_por`, y es deliberado: esa columna es la que decide qué va
   * a la papelera ("solo lo que borró una persona", `docs/features/papelera.md`),
   * y un borrador descartado NO se ofrece para restaurar (owner, 2026-09-18).
   * No movió stock ni plata, y restaurarlo chocaría con el folio que otro
   * borrador ya tomó. Sigue siendo soft delete: nunca un `DELETE` físico.
   */
  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;
}
