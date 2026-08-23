import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';

/**
 * Nivel del descuadre del cierre contra los dos umbrales del tenant. Ninguno
 * bloquea el cierre (owner, 2026-08-23): 'aviso' se le advierte al cajero,
 * 'alto' además manda el cierre a la bandeja de pendientes de revisar.
 */
export type NivelDescuadre = 'ninguno' | 'aviso' | 'alto';

// Índice único parcial: máximo una sesión abierta por cajón (backstop duro bajo
// concurrencia). La virtual tiene cajon_id null → no participa del índice único.
@Entity('cajas')
@Index('ux_cajas_cajon_abierta', ['cajonId'], {
  unique: true,
  where: 'estado = \'abierta\' AND "eliminado_el" IS NULL',
})
// Backstop duro de "una caja física por tenant+usuario": el chequeo aplicativo de
// `abrir()` corre FUERA de la transacción, así que dos aperturas simultáneas sobre
// cajones DISTINTOS no competían por nada y el mismo cajero terminaba con dos cajas
// abiertas. Incluye `en_conciliacion` porque también ocupa al cajero (`findActiva`).
@Index('ux_cajas_activa_por_usuario', ['tenantId', 'usuarioId'], {
  unique: true,
  where: `tipo = 'fisica' AND estado IN ('abierta', 'en_conciliacion') AND "eliminado_el" IS NULL`,
})
// Bandeja de pendientes de revisar: la consulta es siempre por este predicado
// exacto y la respuesta es una minoría de las filas, así que el índice parcial
// es el que corresponde. Sin él, la bandeja hace seq scan sobre el histórico
// entero de cierres del tenant, que solo crece.
@Index('ix_cajas_pendientes_revision', ['tenantId'], {
  where: `nivel_descuadre = 'alto' AND "revisado_el" IS NULL AND "eliminado_el" IS NULL`,
})
export class Caja {
  @PrimaryGeneratedColumn('uuid', { name: 'caja_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'cajon_id', type: 'uuid', nullable: true })
  cajonId: string | null;

  @Column({ name: 'moneda_id', type: 'uuid', nullable: true })
  monedaId: string | null;

  @Column({ default: 'virtual' })
  tipo: string; // 'fisica' | 'virtual'

  @Column({
    name: 'fecha_apertura',
    type: 'timestamptz',
    default: () => 'NOW()',
  })
  fechaApertura: Date;

  @Column({ name: 'fecha_cierre', type: 'timestamptz', nullable: true })
  fechaCierre: Date | null;

  @Column({
    name: 'saldo_inicial',
    type: 'decimal',
    precision: 18,
    scale: 4,
    default: 0,
  })
  saldoInicial: string;

  @Column({
    name: 'saldo_final',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  saldoFinal: string | null;

  @Column({
    name: 'monto_contado',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  montoContado: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true })
  diferencia: string | null;

  @Column({ default: 'abierta' })
  estado: string; // 'abierta' | 'en_conciliacion' | 'cerrada'

  // Comentario de la APERTURA (`abrir`) — nunca lo toca el cierre. Antes de
  // Task 4 del plan `testigo-cierre-forzado`, `enviarConteo` (fase 1 del
  // cierre) pisaba esta misma columna con el comentario del cierre, y el de
  // apertura se perdía sin dejar rastro (`docs/agent/resueltos.md`, "El
  // cierre de caja pisaba el comentario de la apertura"). Separado en
  // `comentarioCierre` para que ninguno de los dos pise al otro: son hechos
  // de dos momentos distintos.
  @Column({ type: 'varchar', nullable: true })
  comentario: string | null;

  // Comentario del CIERRE — lo escribe `enviarConteo` (fase 1) y, si llega
  // uno nuevo, `cerrar` (fase 2) lo actualiza; las dos fases son el mismo
  // proceso de cierre, así que fase 2 SÍ puede refinar/reemplazar lo que dejó
  // fase 1 acá. Lo que nunca toca es `comentario` (la apertura, arriba).
  @Column({ name: 'comentario_cierre', type: 'varchar', nullable: true })
  comentarioCierre: string | null;

  @Column({ name: 'cerrada_por', type: 'uuid', nullable: true })
  cerradaPor: string | null;

  @Column({ name: 'testigos_disponibles', type: 'smallint', nullable: true })
  testigosDisponibles: number | null;

  /**
   * Nivel del descuadre, CONGELADO en la fase 1 del cierre (`enviarConteo`)
   * junto con el arqueo. No se recomputa al leer: si el encargado sube el
   * umbral el mes que viene, un cierre que YA fue alto no deja de haberlo
   * sido — el nivel es un hecho de ese cierre, no una vista de la config de
   * hoy. Mismo criterio que `caja_arqueo_medio`, que congela y nunca recalcula.
   *
   * `type` explícito y no inferido: `NivelDescuadre` es una unión de strings y
   * TypeORM lee `design:type`, que para una unión queda en `Object` y revienta
   * al construir el esquema (ver el docblock de `modoRedondeo` en `Tenant`).
   */
  @Column({ name: 'nivel_descuadre', type: 'varchar', default: 'ninguno' })
  nivelDescuadre: NivelDescuadre;

  /**
   * Lo que el cajero escribe al cerrar cuando su diferencia pasó un umbral:
   * texto libre, distinto del motivo CATEGORIZADO por línea que ya vive en
   * `caja_arqueo_medio.motivo_diferencia_id`/`comentario_diferencia`. Son dos
   * cosas: el motivo clasifica cada línea, esto cuenta qué pasó en el turno.
   * El encargado revisa con esta explicación al lado, no con un número pelado.
   */
  @Column({ name: 'explicacion_descuadre', type: 'text', nullable: true })
  explicacionDescuadre: string | null;

  /**
   * Quién marcó visto el cierre en la bandeja, y cuándo. Se registra SIEMPRE,
   * incluso si es la misma persona que cerró —el caso del cierre forzado, donde
   * el encargado cuenta y después revisa lo suyo—: ahí el umbral ya no es un
   * control preventivo sino un rastro, y que el rastro exista y sea legible
   * **es** el control (owner, 2026-08-15, ampliado el 2026-08-23).
   */
  @Column({ name: 'revisado_por', type: 'uuid', nullable: true })
  revisadoPor: string | null;

  @Column({ name: 'revisado_el', type: 'timestamptz', nullable: true })
  revisadoEl: Date | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
