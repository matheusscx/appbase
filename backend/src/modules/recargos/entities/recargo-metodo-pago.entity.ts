import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('recargo_metodo_pago')
export class RecargoMetodoPago {
  @PrimaryColumn({ name: 'recargo_id', type: 'uuid' })
  recargoId: string;

  @PrimaryColumn({ name: 'metodo_pago_id', type: 'uuid' })
  metodoPagoId: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
