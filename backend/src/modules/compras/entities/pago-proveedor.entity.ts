import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type EstadoPagoProveedor = 'vigente' | 'anulado';

/**
 * Un pago real a un proveedor (spec compras-deuda-proveedor § 3): plata que
 * salió, por un medio, un día. Puede quedar sin aplicaciones (anticipo,
 * decisión 5) o repartido entre varias compras (`pago_proveedor_aplicaciones`).
 *
 * `id` es `@PrimaryColumn` y NO `@PrimaryGeneratedColumn`: el service lo
 * pre-genera con `randomUUID()` (mismo patrón que `TenantsService.rolId`) para
 * poder referenciarlo como fuente en `fondear()` ANTES del `INSERT` — el
 * fondeo arma las partes de `pago_proveedor_aplicaciones` en memoria, y el
 * pago recién se inserta junto con ellas, en la misma transacción.
 *
 * Sin `@ManyToOne` a `terceros` ni `metodos_pago`: mismo criterio que
 * `pagos`/`movimientos_caja` en el resto del proyecto — el catálogo se
 * resuelve con un `JOIN` al leer, no con una relación de TypeORM.
 */
@Index('idx_pagos_proveedor_proveedor', ['tenantId', 'proveedorId'])
@Check('chk_pagos_proveedor_monto_positivo', '"monto" > 0')
@Entity('pagos_proveedor')
export class PagoProveedor {
  @PrimaryColumn('uuid', { name: 'pago_proveedor_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'proveedor_id', type: 'uuid' })
  proveedorId: string;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  fecha: Date;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  monto: string;

  @Column({ name: 'metodo_pago_id', type: 'uuid' })
  metodoPagoId: string;

  @Column({ type: 'text', nullable: true })
  referencia: string | null;

  /** Solo si salió de una caja física (efectivo). `null` en otro medio. */
  @Column({ name: 'caja_id', type: 'uuid', nullable: true })
  cajaId: string | null;

  @Column({ name: 'creado_por', type: 'uuid' })
  creadoPor: string;

  // `text` explícito: sin él, `design:type` queda en Object y TypeORM no arranca
  // (docs/patterns/backend.md, ver Compra.estado).
  @Column({ type: 'text', default: 'vigente' })
  estado: EstadoPagoProveedor;

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

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;
}
