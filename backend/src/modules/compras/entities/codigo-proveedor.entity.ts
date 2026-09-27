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
 * Lo que el sistema aprendió de la factura de un proveedor: "su código
 * CC350-12 es la Coca-Cola en Caja (12)", o "su FLETE no es mercadería"
 * (spec compras-xml-dte § 5.1). Tabla propia y no una columna de la
 * presentación: un código también apunta a un producto en su unidad base y a
 * "no es mercadería", que no tienen presentación.
 *
 * Reaprender NO pisa: marca la fila vieja con `eliminado_el` e inserta otra
 * (el owner pide reversibilidad). Por eso el único es parcial.
 */
@Entity('codigos_proveedor')
@Index('uq_codigos_proveedor_clave', ['tenantId', 'proveedorId', 'clave'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
@Check(
  'chk_codigos_proveedor_destino',
  `("no_mercaderia" AND "item_id" IS NULL AND "presentacion_compra_id" IS NULL AND "unidad_codigo" IS NULL)
   OR (NOT "no_mercaderia" AND "item_id" IS NOT NULL
       AND ("presentacion_compra_id" IS NULL) <> ("unidad_codigo" IS NULL))`,
)
export class CodigoProveedor {
  @PrimaryGeneratedColumn('uuid', { name: 'codigo_proveedor_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'proveedor_id', type: 'uuid' })
  proveedorId: string;

  @Column({ type: 'varchar', length: 160 })
  clave: string;

  @Column({ type: 'varchar', length: 80 })
  descripcion: string;

  @Column({ name: 'no_mercaderia', type: 'boolean', default: false })
  noMercaderia: boolean;

  @Column({ name: 'item_id', type: 'uuid', nullable: true })
  itemId: string | null;

  @Column({ name: 'presentacion_compra_id', type: 'uuid', nullable: true })
  presentacionCompraId: string | null;

  @Column({ name: 'unidad_codigo', type: 'text', nullable: true })
  unidadCodigo: string | null;

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
