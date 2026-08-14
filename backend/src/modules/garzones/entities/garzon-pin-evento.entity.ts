import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  Check,
} from 'typeorm';

/**
 * Qué le pasó al PIN. Los dos de invalidación se distinguen porque dicen cosas
 * distintas: `invalidado_por_vinculo` es "te di una cuenta, tu PIN viejo ya no
 * hace falta"; `invalidado_por_encargado` es "te corté el PIN".
 */
export type TipoEventoPin =
  | 'emitido_en_alta'
  | 'regenerado_por_encargado'
  | 'invalidado_por_encargado'
  | 'invalidado_por_vinculo'
  | 'fijado_por_garzon';

/**
 * Historia de los cambios de PIN de un garzón. Las filas son **hechos con
 * hora**: se insertan y nunca se editan ni se borran. El soft delete está por
 * convención del repo.
 *
 * **Nunca guarda el PIN**, ni en claro ni hasheado — solo el hecho de que
 * cambió. Lo que hace visible el abuso es la frecuencia ("le regeneró el PIN a
 * Ana tres veces esta semana"), y para eso alcanza con quién, a quién y cuándo.
 * Por eso es una tabla y no dos columnas en `garzones`: dos columnas guardan
 * solo el último cambio, y el patrón se pierde en cada sobrescritura.
 *
 * `startup-pos.sql` es documentación de referencia — el esquema real lo genera
 * `synchronize` desde ESTA entity, así que el índice y el CHECK van acá.
 */
@Entity('garzon_pin_evento')
// La lectura siempre es "la historia de este garzón, más nueva primero",
// acotada al tenant — mismo patrón que venta-propina.entity.ts:26.
@Index('idx_garzon_pin_evento_garzon', ['tenantId', 'garzonId', 'creadoEl'])
@Check(
  'chk_garzon_pin_evento_tipo',
  `"tipo" IN ('emitido_en_alta','regenerado_por_encargado','invalidado_por_encargado','invalidado_por_vinculo','fijado_por_garzon')`,
)
export class GarzonPinEvento {
  @PrimaryGeneratedColumn('uuid', { name: 'garzon_pin_evento_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  @Column({ type: 'text' })
  tipo: TipoEventoPin;

  /**
   * Quién ejecutó la acción. En `fijado_por_garzon` es la cuenta del propio
   * garzón; en el resto, el encargado. NOT NULL a propósito: un evento sin
   * actor no sirve como registro.
   */
  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl?: Date | null;
}
