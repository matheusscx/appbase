import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_ordenes')
export class PasarelaOrden {
  @PrimaryGeneratedColumn('uuid', { name: 'orden_id' })
  ordenId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'pagador_ref', type: 'varchar', length: 100, nullable: true })
  pagadorRef: string | null;

  @Column({ name: 'referencia_externa', type: 'varchar', nullable: true })
  referenciaExterna: string | null; // correlación libre de apps EXTERNAS (vía API key), nunca del monolito

  // Vínculo interno tipado a la venta que materializó un callback in-process
  // (ej. Tienda Online). No es una FK física (el proyecto no declara FKs en
  // este dominio), pero es un campo propio — no reutiliza referenciaExterna.
  // Índice: el listado de ventas agrega los REFUND por venta vinculada.
  @Index()
  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  @Index({ unique: true })
  @Column({ name: 'codigo_orden' })
  codigoOrden: string; // buyOrder generado por nosotros, ≤26 chars

  @Column()
  descripcion: string;

  @Column({ type: 'numeric', precision: 18, scale: 6 })
  monto: string; // numeric ↦ string, Decimal.js para operar

  @Column({ length: 3 })
  moneda: string; // 'CLP' en v1

  @Column({ default: 'creada' })
  estado: string; // 'creada' | 'en_proceso' | 'procesando' | 'pagada' | 'pendiente' | 'conciliada' | 'fallida' | 'expirada' | 'reembolsada'
  // 'procesando': claim transitorio del retorno de pago redirect (Webpay Plus)
  // 'pendiente': pago aceptado con conciliación demorada (modelado; Webpay Plus resuelve inmediato en v1)
  // 'conciliada': pagada + la app consumidora ya materializó su lado (venta creada) vía callback

  @Column({ name: 'fecha_expiracion', type: 'timestamptz', nullable: true })
  fechaExpiracion: Date | null;

  // Token del proveedor para flujos redirect (Webpay Plus): identifica la
  // transacción en commit/estado. De un solo uso; se limpia al confirmar.
  @Index()
  @Column({ name: 'token_proveedor', type: 'varchar', nullable: true })
  tokenProveedor: string | null;

  @Column()
  origen: string; // 'interno' | 'api'

  @Column({ name: 'api_key_id', type: 'uuid', nullable: true })
  apiKeyId: string | null; // qué llave la creó (trazabilidad)

  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
