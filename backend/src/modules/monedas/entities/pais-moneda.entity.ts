import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('pais_moneda')
export class PaisMoneda {
  @PrimaryColumn({ name: 'pais_id', type: 'uuid' })
  paisId: string;

  @PrimaryColumn({ name: 'moneda_id', type: 'uuid' })
  monedaId: string;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
