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

/**
 * Un cobro que ya se procesó, por su `Idempotency-Key`: lo que se contestó y
 * con qué datos. Existe para que un reintento —el cajero que vuelve a
 * confirmar después de un corte de red— reproduzca la respuesta original en
 * vez de crear una segunda venta (ADR-026).
 *
 * La fila la escribe `IdempotenciaService.ejecutar` como PRIMERA sentencia de
 * la transacción de la operación, y la respuesta al final de esa misma
 * transacción: o existen las dos cosas o ninguna.
 *
 * **Única por `(tenant, actor, clave)`**, no solo por clave: la clave de otro
 * usuario no reproduce una respuesta ajena. Una boleta trae pagos, vuelto y
 * cajero, que es lo que el alcance por caja protege. El actor es el usuario
 * del JWT o, en la API externa de la pasarela, la llave de API (que no tiene
 * usuario): exactamente uno de los dos (`chk_solicitudes_idempotentes_un_actor`).
 * Un índice único por cada uno, y no uno sobre `COALESCE(usuario_id,
 * api_key_id)`: el `@Index` de TypeORM no expresa un índice de expresión (el
 * esquema sale de las entities) y mezclaría dos dominios de id. Con `NULL`
 * distintos, cada fila choca solo en el suyo.
 *
 * ⚠️ **Sin relación (`@ManyToOne`) a `ventas` ni a `usuarios`, a propósito**,
 * con el criterio de `caja_intentos_rechazados` y `movimientos_caja`: la fila
 * se escribe dentro de transacciones que ya tienen `FOR UPDATE` sobre la venta
 * (el abono), y un FK sumaría un `FOR KEY SHARE` sobre esa misma fila.
 *
 * No vence y no se borra: la clave vive con el carrito hasta que el cobro sale
 * bien (decisión del owner, 2026-09-19), y un vencimiento reabriría el doble
 * cobro justo en el POS que quedó abierto de un día para otro.
 */
@Index(
  'uq_solicitudes_idempotentes_clave',
  ['tenantId', 'usuarioId', 'clave'],
  {
    unique: true,
    where: '"eliminado_el" IS NULL',
  },
)
@Index(
  'uq_solicitudes_idempotentes_clave_api_key',
  ['tenantId', 'apiKeyId', 'clave'],
  {
    unique: true,
    where: '"eliminado_el" IS NULL',
  },
)
@Check(
  'chk_solicitudes_idempotentes_un_actor',
  '("usuario_id" IS NULL) <> ("api_key_id" IS NULL)',
)
@Entity('solicitudes_idempotentes')
export class SolicitudIdempotente {
  @PrimaryGeneratedColumn('uuid', { name: 'solicitud_idempotente_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  /** Quién hizo el request, del JWT. `NULL` si entró por una llave de API. */
  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  /** La llave de API de la pasarela (`pasarela_api_keys`) que hizo el request. */
  @Column({ name: 'api_key_id', type: 'uuid', nullable: true })
  apiKeyId: string | null;

  /** El valor de la cabecera `Idempotency-Key`. */
  @Column({ name: 'clave', type: 'uuid' })
  clave: string;

  /** `OperacionIdempotente`: `'venta.crear'`, `'pasarela.reembolso'`, … */
  @Column({ name: 'operacion', type: 'varchar' })
  operacion: string;

  /** SHA-256 hex de lo que el request pidió (`huellaDe`). Nunca incluye el PIN. */
  @Column({ name: 'huella', type: 'varchar', length: 64 })
  huella: string;

  /**
   * Lo que se devolvió, ya serializado. Con `ejecutar`, `null` solo dentro de
   * la transacción que la está creando: una fila commiteada siempre la tiene.
   * Con `ejecutarConEfectoExterno` el reclamo se commitea ANTES del efecto, así
   * que una fila commiteada sin respuesta es un efecto "sin confirmar".
   */
  @Column({ name: 'respuesta', type: 'jsonb', nullable: true })
  respuesta: Record<string, unknown> | null;

  /** La venta creada o abonada: la que el 422 de "otros datos" linkea. */
  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
