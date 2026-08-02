import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import type { PersonalizacionRecetaSnapshot } from '../../../common/dto/personalizacion-receta.dto';

@Entity('venta_detalles')
export class VentaDetalle {
  @PrimaryGeneratedColumn('uuid', { name: 'detalle_id' })
  id: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'moneda_id_origen', type: 'uuid' })
  monedaIdOrigen: string;

  @Column({
    name: 'precio_unitario_origen',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  precioUnitarioOrigen: string | null;

  /**
   * Escala 6, igual que `tenant_moneda.valor_del_dia` de donde sale. Estaba en 4
   * y Postgres la redondeaba al insertar: recalcular
   * `precioUnitarioOrigen × tasaCambio` ya no daba `precioUnitario`, y este campo
   * existe justamente para poder auditar esa conversión.
   */
  @Column({
    name: 'tasa_cambio',
    type: 'decimal',
    precision: 18,
    scale: 6,
    nullable: true,
  })
  tasaCambio: string | null;

  @Column({ name: 'precio_unitario', type: 'decimal', precision: 18, scale: 4 })
  precioUnitario: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  // Snapshot fiscal congelado al vender (equivalente del IndExe por línea del DTE).
  @Column({
    name: 'clasificacion_tributaria',
    type: 'text',
    default: 'afecto',
  })
  clasificacionTributaria: string; // 'afecto' | 'exento'

  @Column({ type: 'decimal', precision: 18, scale: 4 })
  cantidad: string;

  @Column({
    name: 'cantidad_presentacion',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  cantidadPresentacion: string | null;

  @Column({ name: 'unidad_codigo_presentacion', type: 'text', nullable: true })
  unidadCodigoPresentacion: string | null;

  /**
   * La unidad en la que está `cantidad`, congelada al vender. Sin ella la
   * cantidad de una línea es un número sin magnitud: `2` no dice si son 2
   * unidades o 2 kg, y leer `items.unidad_medida` para saberlo mostraría la
   * unidad de HOY sobre una venta vieja — el mismo error que el congelado de
   * reglas eliminó.
   *
   * Distinta de `unidad_codigo_presentacion`, que solo existe cuando la línea
   * se vendió por presentación ("2 cajas") y describe cómo se pidió, no en qué
   * unidad está el número que usó el motor.
   */
  @Column({ name: 'unidad_codigo_base', type: 'text' })
  unidadCodigoBase: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: '0' })
  subtotal: string;

  @Column({
    name: 'descuento_aplicado',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  descuentoAplicado: string;

  @Column({
    name: 'recargo_aplicado',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  recargoAplicado: string;

  @Column({
    name: 'impuesto_aplicado',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  impuestoAplicado: string;

  @Column({
    name: 'total_linea',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  totalLinea: string;

  @Column({ type: 'jsonb', nullable: true })
  personalizacion: PersonalizacionRecetaSnapshot | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
