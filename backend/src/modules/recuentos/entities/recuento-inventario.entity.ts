import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('recuento_inventario')
export class RecuentoInventario {
  @PrimaryGeneratedColumn('uuid', { name: 'recuento_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text', default: 'borrador' })
  estado: string; // 'borrador' | 'aplicado' | 'cancelado'

  @Column({
    name: 'motivo_diferencia_default_id',
    type: 'uuid',
    nullable: true,
  })
  motivoDiferenciaDefaultId: string | null;

  @Column({ type: 'text', nullable: true })
  comentario: string | null;

  @Column({ name: 'usuario_creador_id', type: 'uuid' })
  usuarioCreadorId: string;

  @Column({ name: 'usuario_aplicador_id', type: 'uuid', nullable: true })
  usuarioAplicadorId: string | null;

  @Column({ name: 'aplicado_el', type: 'timestamptz', nullable: true })
  aplicadoEl: Date | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({
    name: 'actualizado_el',
    type: 'timestamptz',
    nullable: true,
  })
  actualizadoEl: Date | null;

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;
}
