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

  /**
   * Dónde se cuenta esta sesión. Obligatoria e inmutable: las líneas ya
   * contadas se refieren al stock que había EN ESA ubicación al crearse la
   * sesión (`stock_sistema` congela `stock_ubicacion` de acá), así que
   * cambiarla a mitad de camino dejaría el conteo describiendo un lugar
   * distinto del que aplica el delta. `UpdateRecuentoDto` no tiene este campo
   * a propósito — el `PATCH` de la sesión no la acepta.
   */
  @Column({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

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
