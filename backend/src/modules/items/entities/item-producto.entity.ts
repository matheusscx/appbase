import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('item_producto')
export class ItemProducto {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  stock: string;

  @Column({ name: 'unidad_medida', type: 'text' })
  unidadMedida: string;

  @Column({ name: 'fecha_elaboracion', type: 'timestamptz', nullable: true })
  fechaElaboracion: Date | null;

  @Column({ name: 'fecha_vencimiento', type: 'timestamptz', nullable: true })
  fechaVencimiento: Date | null;
}
