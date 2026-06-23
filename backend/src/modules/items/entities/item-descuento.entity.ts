import { Entity, PrimaryColumn } from 'typeorm';

@Entity('item_descuentos')
export class ItemDescuento {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @PrimaryColumn({ name: 'descuento_id', type: 'uuid' })
  descuentoId: string;
}
