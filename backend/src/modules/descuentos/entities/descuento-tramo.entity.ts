import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Check,
} from 'typeorm';

@Entity('descuento_tramos')
@Check(
  'chk_descuento_tramos_una_unidad',
  '("valor_monto" IS NULL) <> ("valor_porcentaje" IS NULL)',
)
@Check(
  'chk_descuento_tramos_un_minimo',
  '("minimo_cantidad" IS NULL) <> ("minimo_monto" IS NULL)',
)
export class DescuentoTramo {
  @PrimaryGeneratedColumn('uuid', { name: 'descuento_tramo_id' })
  id: string;

  @Column({ name: 'descuento_id', type: 'uuid' })
  descuentoId: string;

  // El mínimo va en UNA de las dos, y cuál corresponde lo decide el TIPO de la
  // regla (`por_mayor` mide cantidad; el resto, monto de venta). Antes era una
  // sola columna `minimo` que significaba kilos o pesos según un hermano que
  // estaba en otra tabla: el motor lo resolvía con un `if` sobre el código, y
  // ninguna de las dos unidades podía validarse en el borde. Ahora el tramo
  // dice por sí solo qué mide.
  @Column({
    name: 'minimo_cantidad',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  minimoCantidad: string | null; // unidades; admite decimales (2,5 kg)

  @Column({
    name: 'minimo_monto',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  minimoMonto: string | null; // plata, en la escala de la moneda oficial

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
  valorMonto: string | null; // importe del descuento en este tramo, en plata

  @Column({
    name: 'valor_porcentaje',
    type: 'numeric',
    precision: 7,
    scale: 4,
    nullable: true,
  })
  valorPorcentaje: string | null; // importe del descuento en este tramo, decimal

  @Column({ type: 'int', default: 0 })
  orden: number;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
