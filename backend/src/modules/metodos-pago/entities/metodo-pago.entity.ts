import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('metodos_pago')
export class MetodoPago {
  @PrimaryGeneratedColumn('uuid', { name: 'metodo_pago_id' })
  metodoPagoId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'varchar', length: 5, nullable: true })
  abreviatura: string | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
