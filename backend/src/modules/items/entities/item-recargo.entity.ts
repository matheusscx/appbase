import { Entity, PrimaryColumn } from 'typeorm';

@Entity('item_recargos')
export class ItemRecargo {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @PrimaryColumn({ name: 'recargo_id', type: 'uuid' })
  recargoId: string;
}
