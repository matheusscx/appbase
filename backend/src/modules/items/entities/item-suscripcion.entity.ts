import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('item_suscripcion')
export class ItemSuscripcion {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'text' })
  frecuencia: string; // 'semanal' | 'quincenal' | 'mensual'
}
