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
 * Sobre cuánto una boleta exige el nombre y el RUT de quien paga, por país y
 * año (Res. Ex. SII 44/2025, art. 92 ter del Código Tributario). Es un dato
 * legal, igual para todos los comercios del país: catálogo global sin
 * `tenant_id`, sembrado por el sistema cuando el SII publica el valor del año.
 * Ningún endpoint lo escribe.
 *
 * `monto` va en la moneda oficial del país y con los 2 decimales que publica
 * el SII ($5.186.253,15 para 2025). Rige la fila del año de la venta y, si no
 * hay, la del último año anterior: la ley dice que el monto *"se mantendrá"*
 * mientras no se dicte otro (ver `VentasService.resolverTipoDocumento`).
 */
@Entity('umbral_identidad_pagador')
@Index('uq_umbral_identidad_pagador_pais_anio', ['paisId', 'anio'], {
  unique: true,
  where: `"eliminado_el" IS NULL`,
})
@Check('chk_umbral_identidad_pagador_monto', '"monto" > 0')
export class UmbralIdentidadPagador {
  @PrimaryGeneratedColumn('uuid', { name: 'umbral_id' })
  id: string;

  @Column({ name: 'pais_id', type: 'uuid' })
  paisId: string;

  @Column({ type: 'int' })
  anio: number;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  monto: string;

  /** De dónde sale el valor: la resolución del SII o la UF con la que se calculó. */
  @Column({ type: 'text' })
  fuente: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
