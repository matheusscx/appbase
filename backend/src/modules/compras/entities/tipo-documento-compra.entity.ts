import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TotalDocumentoTipo = 'suma_lineas' | 'obligatorio' | 'opcional';

/**
 * Los documentos que un local RECIBE de un proveedor, por país. Tabla y no
 * enum, por la misma regla que los de venta. Va aparte de
 * `tipos_documento_tributario` porque esa alimenta el selector del POS
 * (spec compras-recepcion § 3.3).
 */
@Entity('tipos_documento_compra')
@Check(
  'chk_tipos_documento_compra_total_documento',
  `"total_documento" IN ('suma_lineas', 'obligatorio', 'opcional')`,
)
export class TipoDocumentoCompra {
  @PrimaryGeneratedColumn('uuid', { name: 'tipo_documento_compra_id' })
  id: string;

  @Column({ name: 'pais_id', type: 'uuid' })
  paisId: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  /** Código tributario (33, 34, 46, 52, 39). Null si no es tributario. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  codigo: string | null;

  /** "Sin documento" es el único que no lo pide. */
  @Column({ name: 'requiere_folio', type: 'boolean', default: true })
  requiereFolio: boolean;

  /**
   * Qué total lleva este documento (spec compras-deuda-proveedor § 3,
   * decisión 10): `obligatorio` se tipea o sale del XML y el sistema no lo
   * calcula ni lo valida contra el neto de las líneas; `opcional` (la guía
   * de despacho) se recibe sin él y se completa después; `suma_lineas`
   * (boleta, sin documento) es Σ cantidad × precio − descuento, como siempre.
   */
  @Column({ name: 'total_documento', type: 'text' })
  totalDocumento: TotalDocumentoTipo;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

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
