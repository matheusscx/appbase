import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('metodo_pago_pais')
export class MetodoPagoPais {
  @PrimaryColumn({ name: 'pais_id', type: 'uuid' })
  paisId: string;

  @PrimaryColumn({ name: 'metodo_pago_id', type: 'uuid' })
  metodoPagoId: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
