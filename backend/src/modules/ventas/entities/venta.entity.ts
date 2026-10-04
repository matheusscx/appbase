import {
  Check,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import type { ConfigCalculo } from '../../calculo-precios/calculo-precios.engine';

/**
 * No hay `borrador`: la venta en construcción vive en `cuenta`/`cuenta_lineas`
 * de salones, que es el *open ticket* del dominio. Un estado paralelo en `ventas`
 * sería una segunda forma de resolver lo mismo.
 * Decidido 2026-07-27 — ver `docs/agent/investigaciones/2026-07-27-anulacion-y-notas-credito.md`.
 */
export enum EstadoVenta {
  PENDIENTE = 'pendiente',
  PAGADA_PARCIAL = 'pagada_parcial',
  PAGADA = 'pagada',
  CANCELADA = 'cancelada',
}

/** Por dónde volvió la plata de una corrección (spec § 3.6). */
export type DevolucionVia = 'pago' | 'sin_plata' | 'pasarela';

/**
 * Índice por venta referenciada: es la búsqueda *"¿qué notas de crédito tiene
 * esta venta?"*, que corre en cada lectura del detalle. Sin él, seq scan de
 * `ventas` — medido con 60.000 filas: 6,8 ms → 0,11 ms—.
 */
@Index('idx_ventas_venta_referencia', ['ventaReferenciaId'])
@Entity('ventas')
@Check(
  'chk_ventas_devolucion_via',
  `"devolucion_via" IN ('pago','sin_plata','pasarela')`,
)
@Check(
  'chk_ventas_receptor_es_emisor',
  `NOT "receptor_es_emisor" OR "venta_referencia_id" IS NOT NULL`,
)
export class Venta {
  @PrimaryGeneratedColumn('uuid', { name: 'venta_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'caja_id', type: 'uuid', nullable: true })
  cajaId: string | null;

  @Column({ name: 'moneda_id', type: 'uuid' })
  monedaId: string;

  @Column({ name: 'tipo_documento_id', type: 'uuid', nullable: true })
  tipoDocumentoId: string | null;

  @Column({ type: 'text', default: 'fisico' })
  canal: string;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  fecha: Date;

  @Column({
    type: 'enum',
    enum: EstadoVenta,
    default: EstadoVenta.PENDIENTE,
  })
  estado: EstadoVenta;

  @Column({
    name: 'total_bruto',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  totalBruto: string;

  @Column({
    name: 'total_descuentos',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  totalDescuentos: string;

  @Column({
    name: 'total_recargos',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  totalRecargos: string;

  @Column({
    name: 'total_impuestos',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  totalImpuestos: string;

  @Column({
    name: 'total_final',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  totalFinal: string;

  @Column({
    name: 'base_ventas_total_final',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  baseVentasTotalFinal: string;

  @Column({
    name: 'base_ventas_sin_impuestos',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: '0',
  })
  baseVentasSinImpuestos: string;

  @Column({ name: 'venta_referencia_id', type: 'uuid', nullable: true })
  ventaReferenciaId: string | null;

  /**
   * En una corrección: por dónde volvió la plata (`'pago'` por uno de los pagos de
   * la venta, `'sin_plata'` rebajando lo que se debía, `'pasarela'` el reembolso
   * de una orden). Nulo en lo que no es corrección. Es la auditoría de ese dato y
   * lo que hace que "no vuelve plata" sea una **serie**: lo ya rebajado sin plata
   * baja el saldo que queda por rebajar.
   */
  @Column({ name: 'devolucion_via', type: 'text', nullable: true })
  devolucionVia: DevolucionVia | null;

  /**
   * El pago por el que volvió la plata: con `devolucion_via = 'pago'`, el que eligió el usuario;
   * con `'pasarela'`, el único pago de la venta (con 0 o más de uno queda nulo: elegir uno sería
   * adivinar). En los dos casos lo devuelto gasta el tope de ese pago. Nulo con `'sin_plata'`.
   */
  @Column({ name: 'devolucion_pago_id', type: 'uuid', nullable: true })
  devolucionPagoId: string | null;

  /**
   * Una nota de crédito con tipo de documento sin datos del comprador (la venta no
   * tenía customer y el cajero no los capturó, o la nota es automática) va a nombre
   * del propio emisor: la excepción que publica el SII (FAQ 001.380.6571.003). Se
   * congela el hecho, no los datos del local, que se derivan al emitir. Solo
   * `true` en una corrección (`@Check`). Quién la escribe:
   * `VentasService.crearNotaCreditoEnTransaccion`.
   */
  @Column({
    name: 'receptor_es_emisor',
    type: 'boolean',
    nullable: false,
    default: false,
  })
  receptorEsEmisor: boolean;

  @Column({ type: 'text', nullable: true })
  comentario: string | null;

  /**
   * La configuración financiera del tenant con la que se calculó esta venta.
   * Va en `jsonb` y no en columnas por una razón de forma: `formula` es un
   * array, y el objeto se lee entero o no se lee.
   *
   * Sin ella el congelado de las reglas no es interpretable: el mismo 10% da
   * un total distinto según el orden de la fórmula y según base|cascada, y las
   * dos cosas se editan desde Preferencias.
   *
   * Ver `ConfigCalculo` en `calculo-precios.engine.ts`.
   */
  @Column({ name: 'config_calculo', type: 'jsonb', nullable: true })
  configCalculo: ConfigCalculo | null;

  /** Auditoría de la anulación. Ver `VentasService.cancelar`. */
  @Column({ name: 'cancelada_el', type: 'timestamptz', nullable: true })
  canceladaEl: Date | null;

  @Column({ name: 'cancelada_por_usuario_id', type: 'uuid', nullable: true })
  canceladaPorUsuarioId: string | null;

  @Column({ name: 'motivo_cancelacion', type: 'text', nullable: true })
  motivoCancelacion: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
