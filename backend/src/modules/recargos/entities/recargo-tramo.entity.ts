import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Check,
} from 'typeorm';

@Entity('recargo_tramos')
@Check(
  'chk_recargo_tramos_una_unidad',
  '("valor_monto" IS NULL) <> ("valor_porcentaje" IS NULL)',
)
export class RecargoTramo {
  @PrimaryGeneratedColumn('uuid', { name: 'recargo_tramo_id' })
  id: string;

  @Column({ name: 'recargo_id', type: 'uuid' })
  recargoId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  minimo: string | null; // cantidad o monto mínimo para este tramo

  // Exactamente una de las dos, y la misma que el `modo` de su regla. Lo
  // primero lo garantiza el CHECK de abajo; lo segundo es entre tablas y NO se
  // puede expresar como CHECK: lo valida `validarMontosDeRegla` en el service.
  @Column({
    name: 'valor_monto',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  valorMonto: string | null; // importe del recargo en este tramo, en plata

  @Column({
    name: 'valor_porcentaje',
    type: 'numeric',
    precision: 7,
    scale: 4,
    nullable: true,
  })
  valorPorcentaje: string | null; // importe del recargo en este tramo, decimal

  @Column({ type: 'int', default: 0 })
  orden: number;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
