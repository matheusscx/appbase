import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cómo le viene un producto a un proveedor: "Caja" de 12 unidad, "Saco" de 25
 * kg (spec compras-unidad-de-compra § 3.1). Por (proveedor, producto), no por
 * producto: otro proveedor puede traerlo en pack de 6 (owner, decisión 4b).
 *
 * El contenido se guarda como se tipeó, no convertido: la conversión a la
 * unidad base la hace quien la usa, con el conversor del catálogo.
 *
 * ⚠️ `uq_presentaciones_compra_nombre` NO se declara acá: es sobre
 * `lower(nombre)` y TypeORM no sabe expresar una función en `@Index`. Lo crea
 * `seeder.service.ts` → `seedPresentacionesCompra()` con SQL cruda.
 */
@Entity('presentaciones_compra')
@Index('idx_presentaciones_compra_proveedor', ['tenantId', 'proveedorId'])
export class PresentacionCompra {
  @PrimaryGeneratedColumn('uuid', { name: 'presentacion_compra_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'proveedor_id', type: 'uuid' })
  proveedorId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'varchar', length: 40 })
  nombre: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  contenido: string;

  @Column({ name: 'unidad_codigo', type: 'text' })
  unidadCodigo: string;

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
