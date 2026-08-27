import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type TipoPromocion = 'porcentaje' | 'nxm' | 'precio_fijo';

/**
 * Una campaña de promoción (Fase 1). El beneficio va inline: una promo tiene
 * exactamente un beneficio, y sus columnas son las de su `tipo` — el resto NULL
 * (CHECKs de forma: una fila no puede decir dos cosas).
 * Diseño: docs/superpowers/specs/2026-08-27-motor-promociones-design.md
 */
@Entity('promociones')
@Check(
  'chk_promociones_horario_paridad',
  `("hora_inicio" IS NULL) = ("hora_fin" IS NULL)`,
)
@Check(
  'chk_promociones_valor_segun_tipo',
  `("tipo" = 'porcentaje' AND "valor_porcentaje" IS NOT NULL AND "cada_n" IS NULL AND "valor_monto" IS NULL)
   OR ("tipo" = 'nxm' AND "valor_porcentaje" IS NOT NULL AND "cada_n" IS NOT NULL AND "valor_monto" IS NULL)
   OR ("tipo" = 'precio_fijo' AND "valor_monto" IS NOT NULL AND "valor_porcentaje" IS NULL AND "cada_n" IS NULL)`,
)
/** Todo elemento de `dias_semana` entre 1 y 7 (ISO-8601, 1=lunes…7=domingo). */
@Check(
  'chk_promociones_dias_semana',
  `"dias_semana" IS NULL OR "dias_semana" <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]`,
)
@Check(
  'chk_promociones_canal',
  `"canal" IS NULL OR "canal" IN ('fisico','online')`,
)
export class Promocion {
  @PrimaryGeneratedColumn('uuid', { name: 'promocion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  /** Pausa. Pausada no aplica y NO avisa (spec §Modelo de datos). */
  @Column({ type: 'boolean', default: true })
  activo: boolean;

  /** Los dos NOT NULL: el guardarraíl heredado de eliminar `promocional`. */
  @Column({ name: 'fecha_inicio', type: 'date' })
  fechaInicio: string;

  @Column({ name: 'fecha_fin', type: 'date' })
  fechaFin: string;

  /** Franja en hora local del tenant; inicio > fin = cruza medianoche. */
  @Column({ name: 'hora_inicio', type: 'time', nullable: true })
  horaInicio: string | null;

  @Column({ name: 'hora_fin', type: 'time', nullable: true })
  horaFin: string | null;

  /** ISO-8601: 1=lunes…7=domingo. NULL = todos los días. */
  @Column({
    name: 'dias_semana',
    type: 'smallint',
    array: true,
    nullable: true,
  })
  diasSemana: number[] | null;

  /** 'fisico' | 'online'; NULL = ambos. */
  @Column({ type: 'text', nullable: true })
  canal: string | null;

  @Column({ type: 'text' })
  tipo: TipoPromocion;

  /** Decimal: 2x1 = '1.0000', "2do al 50%" = '0.5000'. */
  @Column({
    name: 'valor_porcentaje',
    type: 'decimal',
    precision: 7,
    scale: 4,
    nullable: true,
  })
  valorPorcentaje: string | null;

  @Column({ name: 'cada_n', type: 'smallint', nullable: true })
  cadaN: number | null;

  /** Precio del conjunto en moneda oficial (precio_fijo). */
  @Column({
    name: 'valor_monto',
    type: 'decimal',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  valorMonto: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
