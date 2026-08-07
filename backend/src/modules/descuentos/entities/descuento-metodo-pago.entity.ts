import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('descuento_metodo_pago')
export class DescuentoMetodoPago {
  @PrimaryColumn({ name: 'descuento_id', type: 'uuid' })
  descuentoId: string;

  @PrimaryColumn({ name: 'metodo_pago_id', type: 'uuid' })
  metodoPagoId: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
