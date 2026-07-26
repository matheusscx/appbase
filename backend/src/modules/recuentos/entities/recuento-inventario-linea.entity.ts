import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('recuento_inventario_linea')
export class RecuentoInventarioLinea {
  @PrimaryGeneratedColumn('uuid', { name: 'linea_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'recuento_id', type: 'uuid' })
  recuentoId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  // Congelado al crear la línea: base del delta que se aplica al stock
  // vigente cuando el recuento se aplica (Task 5), no un valor absoluto.
  @Column({
    name: 'stock_sistema',
    type: 'numeric',
    precision: 18,
    scale: 4,
  })
  stockSistema: string;

  @Column({
    name: 'cantidad_contada',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  cantidadContada: string | null; // NULL = todavía sin contar

  @Column({ name: 'motivo_diferencia_id', type: 'uuid', nullable: true })
  motivoDiferenciaId: string | null;

  @Column({ name: 'movimiento_id', type: 'uuid', nullable: true })
  movimientoId: string | null;

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
