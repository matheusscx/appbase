import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Catálogo global de unidades de medida (sin tenant_id — un kg es un kg en
 * todos los tenants, igual que `moneda` y `pais`).
 *
 * La conversión dentro de una misma magnitud es:
 *   cantidad × (factor_base_desde / factor_base_hacia)
 */
@Entity('unidades_medida')
export class UnidadMedida {
  @PrimaryGeneratedColumn('uuid', { name: 'unidad_medida_id' })
  unidadMedidaId: string;

  /** Código guardado en `item_producto.unidad_medida` (kg, g, l, ml, unidad, m, cm). */
  @Column({ type: 'text', unique: true })
  codigo: string;

  @Column({ type: 'text' })
  nombre: string;

  /** 'masa' | 'volumen' | 'conteo' | 'longitud'. Solo se convierte dentro de una magnitud. */
  @Column({ type: 'text' })
  magnitud: string;

  /** Cuántas unidades base de la magnitud equivale 1 de esta (kg → 1000 g). */
  @Column({ name: 'factor_base', type: 'numeric', precision: 18, scale: 6 })
  factorBase: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date;
}
