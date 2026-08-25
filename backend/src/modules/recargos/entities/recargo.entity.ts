import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Check,
} from 'typeorm';
import {
  ModoRegla,
  CondicionTipo,
  NivelRegla,
} from '../../../common/enums/reglas.enums';

@Entity('recargos')
@Check(
  'chk_recargos_valor_segun_modo',
  `("modo" = 'monto_fijo' AND "valor_porcentaje" IS NULL)
   OR ("modo" = 'porcentaje' AND "valor_monto" IS NULL)`,
)
export class Recargo {
  @PrimaryGeneratedColumn('uuid', { name: 'recargo_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'enum', enum: ModoRegla, enumName: 'modo_regla' })
  modo: ModoRegla;

  /**
   * Dónde se aplica: por línea o sobre el total de la venta. Ver `NivelRegla`.
   *
   * **Con default y NOT NULL a propósito.** El default no es comodidad del DTO:
   * es lo que deja que `synchronize` agregue la columna sobre las filas que ya
   * existen —el demo de Railway— sin el `23502` que dejó el backend en CRASHED
   * el 2026-08-09 (`e163dbb7`, `docs/ARCHITECTURE.md`). Y `'linea'` es el valor
   * VERDADERO para esas filas: hasta hoy la única forma de usar una regla era
   * asociarla a un ítem.
   */
  @Column({
    type: 'enum',
    enum: NivelRegla,
    enumName: 'nivel_regla',
    default: NivelRegla.LINEA,
  })
  nivel: NivelRegla;

  // El importe vive en UNA de las dos, la que dice `modo`. Las dos en null es
  // el estado válido de una regla por tramos, que lo expresa en `recargo_tramos`.
  // Partirlo es lo que HABILITA marcar `valorMonto` con `@EsMontoCobrado` en el
  // DTO —el decorador no puede leer el campo hermano `modo`—; que esa marca se
  // haga efectiva depende de que el controller pase por `EscalaMonedaPipe`.
  @Column({
    name: 'valor_monto',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  valorMonto: string | null; // numeric ↦ string en JS

  // (7,4) y no (18,4): el tipo dice por sí solo que acá no entra plata. Mismo
  // tipo que `venta_recargos.porcentaje_aplicado`, que ya resolvió esto.
  @Column({
    name: 'valor_porcentaje',
    type: 'numeric',
    precision: 7,
    scale: 4,
    nullable: true,
  })
  valorPorcentaje: string | null; // decimal: 0.10 = 10%

  @Column({ name: 'tipo_regla_id', type: 'uuid' })
  tipoReglaId: string;

  @Column({
    name: 'condicion_tipo',
    type: 'enum',
    enum: CondicionTipo,
    enumName: 'condicion_tipo',
    default: CondicionTipo.NINGUNA,
  })
  condicionTipo: CondicionTipo;

  @Column({ name: 'condicion_valor', type: 'text', nullable: true })
  condicionValor: string | null;

  @Column({ name: 'fecha_inicio', type: 'date', nullable: true })
  fechaInicio: string | null;

  @Column({ name: 'fecha_fin', type: 'date', nullable: true })
  fechaFin: string | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
