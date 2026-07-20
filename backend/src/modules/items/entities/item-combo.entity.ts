import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('item_combo')
export class ItemCombo {
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
}
