import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('item_receta')
export class ItemReceta {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({
    name: 'costo_actual',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoActual: string | null;

  @Column({
    name: 'costo_propuesto_omitido',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoPropuestoOmitido: string | null;
}
