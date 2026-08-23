import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Rastro de un intento RECHAZADO contra la plata de una caja: quién, cuándo,
 * qué caja y cuánto pidió. Existe porque el rechazo mismo es un oráculo — el
 * 422 "Saldo insuficiente en caja" y el tope de la devolución en efectivo
 * contestan sobre el esperado del turno, que es justo lo que el modo ciego
 * retiene. La decisión del owner (2026-08-22) fue **rastro, no ocultamiento**:
 * el chequeo queda intacto (impide sacar plata que no está) y el control pasa
 * de preventivo a detectivo. Veinte retiros rechazados en dos minutos es una
 * firma inconfundible, y ahora queda escrita.
 *
 * ⚠️ **Sin relación (`@ManyToOne`) a `cajas` ni a `usuarios`, a propósito.** Un
 * FK obliga a Postgres a tomar `FOR KEY SHARE` sobre la fila referenciada, y
 * esta fila se escribe **fuera** de la transacción que se está deshaciendo —
 * transacción que retiene `FOR UPDATE` sobre esa misma caja
 * (`bloquearCajaAbierta`). El FK esperaría a que suelte; ella espera a que el
 * rastro se escriba. Cuelgue mutuo, en el camino del rechazo. Mismo criterio
 * que `movimientos_caja`, que tampoco declara relaciones.
 */
@Entity('caja_intentos_rechazados')
export class CajaIntentoRechazado {
  @PrimaryGeneratedColumn('uuid', { name: 'intento_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'caja_id', type: 'uuid' })
  cajaId: string;

  /** Quién lo intentó. No es `cajas.usuario_id`: lo que importa es el actor. */
  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  /** `'retiro'` (movimiento manual de salida) | `'devolucion_nc'`. */
  @Column({ type: 'varchar' })
  tipo: string;

  /** `'saldo_insuficiente'` | `'supera_efectivo_de_la_venta'`. */
  @Column({ type: 'varchar' })
  motivo: string;

  /**
   * Lo que se PIDIÓ, no lo que había. El monto disponible no se guarda: es el
   * dato que el rechazo filtraba, y persistirlo lo dejaría a un endpoint de
   * distancia del cajero. Lo que el supervisor necesita para leer un barrido
   * binario es la secuencia de montos pedidos.
   */
  @Column({
    name: 'monto_solicitado',
    type: 'decimal',
    precision: 18,
    scale: 4,
  })
  montoSolicitado: string;

  /** La venta original de la NC; `null` en un retiro manual. */
  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  @Column({ name: 'fecha', type: 'timestamptz', default: () => 'NOW()' })
  fecha: Date;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
