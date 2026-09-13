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
  moneda: string; // ver MONEDA_ORDEN_V1

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

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}

/**
 * La moneda de TODA orden de pasarela en v1: la de Transbank, que liquida en
 * pesos chilenos. No sale de la moneda oficial del tenant —hoy coinciden solo
 * porque un local de otro país no puede configurar Transbank
 * (`PASARELAS_EN_MONEDA_ORDEN`, abajo)—, así que el monto de una orden se valida
 * contra ESTA escala y no contra `MonedasService.decimalesOficiales`.
 *
 * Existe como constante para que el día que entre una segunda moneda haya un
 * solo lugar del que sacarla, en vez de literales sueltos que se desincronizan.
 */
export const MONEDA_ORDEN_V1 = 'CLP';

/**
 * Las pasarelas que liquidan en `MONEDA_ORDEN_V1`: las de Transbank. Un local
 * cuya moneda oficial no es esa no las puede configurar ni se le ofrecen
 * (owner, 2026-09-13: *"todo Transbank, solo Chile"*). Sin el corte, el checkout
 * online de una tienda de México mandaba su total en pesos mexicanos como
 * monto de una orden en pesos chilenos. La demo no está: no cobra.
 */
export const PASARELAS_EN_MONEDA_ORDEN: ReadonlySet<string> = new Set([
  'oneclick',
  'webpay_plus',
]);
