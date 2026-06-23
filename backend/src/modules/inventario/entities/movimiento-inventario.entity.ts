import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('movimientos_inventario')
export class MovimientoInventario {
  @PrimaryGeneratedColumn('uuid', { name: 'movimiento_id' })
  movimientoId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'text' })
  tipo: string; // 'entrada' | 'salida' | 'ajuste'

  @Column({ type: 'text' })
  motivo: string; // 'compra' | 'venta' | 'devolucion' | 'merma' | 'ajuste_manual' | 'inventario_inicial'

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({ name: 'stock_anterior', type: 'numeric', precision: 18, scale: 4 })
  stockAnterior: string;

  @Column({
    name: 'stock_resultante',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  stockResultante: string;

  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ type: 'text', nullable: true })
  comentario: string | null;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
