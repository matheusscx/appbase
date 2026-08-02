import {
  Entity,
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

@Entity('ventas')
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

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
