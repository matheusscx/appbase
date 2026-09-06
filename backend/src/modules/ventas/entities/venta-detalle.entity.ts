import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import type { PersonalizacionRecetaSnapshot } from '../../../common/dto/personalizacion-receta.dto';

/**
 * Índice por venta. Lo usa **toda** lectura de esta tabla filtrada por `venta_id`,
 * que en `ventas.service.ts` son cinco: las líneas del detalle y el remanente por
 * porción (las dos en `findOne`), el contador de unidades comprometidas
 * (`unidadesComprometidasPorItem`, que entra por `JOIN`), la validación de la
 * devolución (`validarDevolucionesReembolso`) y la composición de la nota de
 * crédito (`crearNotaCreditoEnTransaccion`). Sin índice, todas hacían seq scan:
 * medido con 240.000 detalles, 16,6 ms → 0,08 ms la lectura de líneas.
 *
 * ⚠️ **El índice no alcanza si la consulta lo apaga.** Dos de esas cinco filtraban
 * `venta_id = $1 OR venta_id IN (SELECT …)` —el remanente por porción y la
 * composición de la nota de crédito—, y con esa forma el planner ignora el índice.
 * Se reescribieron como una sola lista en el mismo commit; el porqué, el mecanismo
 * y los números están en `docs/patterns/backend.md` § 17.
 */
@Index('idx_venta_detalles_venta', ['ventaId'])
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

  /**
   * Parte de esta línea en los descuentos y recargos de NIVEL VENTA, en neto y
   * con signo. Es un componente de la identidad de la fila, igual que
   * `descuento_aplicado`: sin él, `subtotal − descuento + recargo + impuesto`
   * deja de dar `total_linea` en toda venta con un descuento global, y el dato
   * para reconstruir el desglose se pierde en el `INSERT`.
   *
   * Se persiste y no se deriva porque `venta_detalles` es el snapshot fiscal de
   * la línea: una reimpresión o una nota de crédito lo leen de acá, no lo
   * recalculan con las reglas de hoy.
   */
  @Column({
    name: 'ajuste_venta',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  ajusteVenta: string;

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

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
