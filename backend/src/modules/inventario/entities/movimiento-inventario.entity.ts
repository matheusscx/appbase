import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Índice por venta: lo usan los tres lectores de esta tabla por `venta_id` en
 * `ventas.service.ts` —el contador de unidades ya devueltas
 * (`unidadesComprometidasPorItem`, que entró al camino de lectura caliente con la
 * nota de crédito por línea), los costos de salida (`costosDeSalidaPorItem`) y la
 * reposición de stock al cancelar (`cancelarUnaVez`)—. Medido con 30.000
 * movimientos: 2,9 ms → 0,07 ms.
 *
 * **Va sin filtrar por `motivo`**, y la alternativa se midió. Un índice **parcial**
 * por `motivo = 'devolucion'` sí sirve mientras la consulta tenga el `OR` que
 * apagaba el índice completo (3,8 ms → 1,4–1,9 ms con un 20% de filas `devolucion`),
 * pero es la salida chica: sacando el `OR` —que es lo que se hizo— el índice
 * completo deja ese mismo **nodo** en 0,10 ms (la consulta entera, en 0,35–0,42 ms),
 * sin un segundo índice que mantener. ⚠️ La primera versión de este comentario decía que el parcial "no
 * cambia el plan": era falso y venía de medirlo con un seed donde el 99% de los
 * movimientos eran devoluciones, o sea donde el parcial no filtra nada. Lo levantó
 * la revisión.
 */
@Index('idx_movimientos_inventario_venta', ['ventaId'])
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
  motivo: string; // 'compra' | 'venta' | 'devolucion' | 'anulacion' | 'merma' | 'ajuste_manual' | 'inventario_inicial' | 'ajuste_costo' | 'recuento'

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

  @Column({
    name: 'costo_unitario',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoUnitario: string | null;

  @Column({
    name: 'costo_anterior',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  costoAnterior: string | null;

  @Column({ name: 'causa_merma_id', type: 'uuid', nullable: true })
  causaMermaId: string | null;

  @Column({ name: 'motivo_diferencia_id', type: 'uuid', nullable: true })
  motivoDiferenciaId: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
