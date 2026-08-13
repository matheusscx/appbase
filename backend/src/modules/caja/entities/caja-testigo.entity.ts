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

export type EstadoTestigo =
  | 'pendiente'
  | 'firmada'
  | 'rechazada'
  | 'cancelada'
  | 'caducada';

/**
 * Cómo se probó la identidad al resolver. `cuenta` = el garzón está vinculado
 * a una cuenta (`garzones.usuario_id`) y el JWT que llamó era esa cuenta —
 * prueba fuerte, no se puede esquivar yendo al tótem. `pin` = identificación
 * por PIN, como el resto del sistema — el tótem compartido no prueba de qué
 * cuenta salió el request, solo que alguien tecleó el PIN correcto.
 */
export type ViaFirma = 'cuenta' | 'pin';

/**
 * Quién dio fe de un conteo de caja. Las filas son **hechos con hora**: se
 * insertan y se resuelven una vez, nunca se editan ni se borran. El soft delete
 * está por convención del repo; ninguna operación de esta feature lo usa.
 *
 * `startup-pos.sql` es documentación de referencia — no lo ejecuta nadie
 * (ver docblock de `test/esquema.e2e-spec.ts`). El esquema real de cualquier
 * ambiente (dev, CI) lo genera `synchronize` a partir de ESTA entity, así que
 * todo índice o constraint que tenga que existir de verdad va acá, no solo en
 * el `.sql`. `idx_caja_testigo_caja` e `idx_caja_testigo_pendiente` estaban
 * solo en el `.sql` y por eso nunca se creaban — la Task 3 los necesita para
 * la consulta "¿tengo algo pendiente?" del garzón.
 */
@Entity('caja_testigo')
// Solo bloquea estados VIVOS ('pendiente', 'firmada'): no se puede tener dos
// solicitudes pendientes al mismo garzón por la misma caja, ni que firme dos
// veces. 'rechazada' | 'cancelada' | 'caducada' quedan afuera a propósito —
// el garzón puede cerrar turno y volver, y hay que poder volver a pedirle fe
// (decisión del owner, 2026-08-11). `"eliminado_el" IS NULL` a secas
// bloquearía ese caso real: no lo simplifiques a eso.
@Index('ux_caja_testigo_caja_garzon', ['cajaId', 'garzonId'], {
  unique: true,
  where: `"estado" IN ('pendiente','firmada') AND "eliminado_el" IS NULL`,
})
@Index('idx_caja_testigo_caja', ['cajaId'])
@Index('idx_caja_testigo_pendiente', ['tenantId', 'garzonId'], {
  where: `"estado" = 'pendiente' AND "eliminado_el" IS NULL`,
})
@Check(
  'chk_caja_testigo_estado',
  `"estado" IN ('pendiente','firmada','rechazada','cancelada','caducada')`,
)
@Check('chk_caja_testigo_via_firma', `"via_firma" IN ('cuenta','pin')`)
export class CajaTestigo {
  @PrimaryGeneratedColumn('uuid', { name: 'caja_testigo_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'caja_id', type: 'uuid' })
  cajaId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  /** La prueba de que estaba en turno, no solo de quién es. */
  @Column({ name: 'sesion_garzon_id', type: 'uuid' })
  sesionGarzonId: string;

  @Column({ name: 'solicitada_por', type: 'uuid' })
  solicitadaPor: string;

  @Column({ name: 'estado', type: 'text', default: 'pendiente' })
  estado: EstadoTestigo;

  @Column({ name: 'comentario_garzon', type: 'text', nullable: true })
  comentarioGarzon: string | null;

  @Column({
    name: 'solicitada_el',
    type: 'timestamptz',
    default: () => 'NOW()',
  })
  solicitadaEl: Date;

  @Column({ name: 'resuelta_el', type: 'timestamptz', nullable: true })
  resueltaEl: Date | null;

  /**
   * Qué cuenta envió la resolución — el hecho crudo. Con `via_firma: 'pin'`
   * es la cuenta del dispositivo/tótem, NO la del garzón (el garzón no tiene
   * login). Se guarda siempre, en las dos vías: es lo que permite auditar
   * "quién tecleó esto" incluso cuando la identidad del garzón se probó por
   * PIN y no por cuenta.
   */
  @Column({ name: 'resuelta_por_usuario_id', type: 'uuid', nullable: true })
  resueltaPorUsuarioId: string | null;

  /**
   * Cómo se probó la identidad — decisión del owner (2026-08-12): se
   * **guarda**, no se deriva, y es la única excepción documentada a la regla
   * general de este módulo (derivar en vez de guardar conclusiones, ver
   * `Caja.cerradaPor`). El motivo es que lo que habría que comparar para
   * derivarlo — `garzones.usuario_id` — **puede vincularse y desvincularse
   * después** de resuelta la firma. Si se derivara, una firma que hoy es
   * prueba fuerte (vía cuenta) se leería como PIN débil el día que alguien
   * desvincule esa cuenta, y viceversa. En un registro de auditoría el
   * veredicto se congela junto con el hecho, no se recalcula contra un
   * estado que cambia.
   */
  @Column({ name: 'via_firma', type: 'text', nullable: true })
  viaFirma: ViaFirma | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;
}
