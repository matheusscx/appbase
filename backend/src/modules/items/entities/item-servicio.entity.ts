import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('item_servicio')
export class ItemServicio {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'duracion_estimada', type: 'integer', nullable: true })
  duracionEstimada: number | null;

  @Column({ name: 'requiere_cita', default: false })
  requiereCita: boolean;
}
