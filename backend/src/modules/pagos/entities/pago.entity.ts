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
 * Índice por venta. Lo leen, entre otros, los pagos del detalle (`findOne`), la
 * comprobación de si la venta tiene pagos antes de cancelarla, el tope de
 * devolución en efectivo adentro de la transacción de la nota de crédito, y la
 * subconsulta correlacionada que suma `pago_aplicaciones` por venta.
 *
 * ⚠️ **Esa subconsulta es el caso peor y no está en el detalle**: corre en
 * `listar()` una vez por fila de la página, y en `resumen()` —otro endpoint— una
 * vez por **cada** venta que pase los filtros, o sea decenas de miles de seq scans
 * en un tenant con volumen. Medido con 60.000 pagos: 5,3 ms de seq scan → 0,07 ms
 * **una sola** de esas ejecuciones.
 *
 * Es una de las seis que el detalle de una venta lee por `venta_id`, indexadas
 * juntas el 2026-09-06. El costo de escritura y las trampas de la medición:
 * `docs/patterns/backend.md` § 17, que es donde vive la tabla completa — acá va
 * solo el número de esta, para no tener el total copiado en ocho archivos.
 */
@Index('idx_pagos_venta', ['ventaId'])
@Entity('pagos')
export class Pago {
  @PrimaryGeneratedColumn('uuid', { name: 'pago_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  @Column({ name: 'metodo_pago_id', type: 'uuid' })
  metodoPagoId: string;

  @Column({ name: 'moneda_oficial_id', type: 'uuid' })
  monedaOficialId: string;

  @Column({ name: 'caja_id', type: 'uuid', nullable: true })
  cajaId: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  monto: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: '0' })
  vuelto: string;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  fecha: Date;

  @Column({ type: 'text', nullable: true })
  referencia: string | null;

  // Detalle de tarjeta devuelto por la pasarela (Webpay). Null en pagos manuales/POS.
  @Column({ name: 'numero_cuotas', type: 'int', nullable: true })
  numeroCuotas: number | null;

  @Column({ name: 'tipo_pago', type: 'varchar', nullable: true })
  tipoPago: string | null; // payment_type_code Transbank: VD/VN/VC/SI/S2/NC/VP

  @Column({
    name: 'tarjeta_ultimos4',
    type: 'varchar',
    length: 4,
    nullable: true,
  })
  tarjetaUltimos4: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
