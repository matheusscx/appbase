import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Los documentos que un local RECIBE de un proveedor, por país. Tabla y no
 * enum, por la misma regla que los de venta. Va aparte de
 * `tipos_documento_tributario` porque esa alimenta el selector del POS
 * (spec compras-recepcion § 3.3).
 */
@Entity('tipos_documento_compra')
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
