import { Entity, PrimaryColumn } from 'typeorm';

@Entity('item_impuestos')
export class ItemImpuesto {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @PrimaryColumn({ name: 'impuesto_id', type: 'uuid' })
  impuestoId: string;
}
