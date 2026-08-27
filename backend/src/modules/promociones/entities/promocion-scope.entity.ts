import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Un slot de la promo: qué se le pide al cliente para que aplique (N ítems, una
 * categoría, o toda la venta). Diseño: docs/superpowers/specs/2026-08-27-motor-promociones-design.md
 */
@Entity('promocion_scopes')
@Check(
  'chk_promocion_scopes_categoria',
  `("tipo_scope" = 'categoria') = ("categoria_id" IS NOT NULL)`,
)
export class PromocionScope {
  @PrimaryGeneratedColumn('uuid', { name: 'scope_id' })
  id: string;

  @Column({ name: 'promocion_id', type: 'uuid' })
  promocionId: string;

  /** Orden del slot dentro de la promo (0-based). */
  @Column({ type: 'smallint' })
  slot: number;

  /** 'items' | 'categoria' | 'venta' (todo el pedido). */
  @Column({ name: 'tipo_scope', type: 'text' })
  tipoScope: string;

  @Column({ name: 'categoria_id', type: 'uuid', nullable: true })
  categoriaId: string | null;

  /** Unidades que pide el slot; solo significa algo en precio_fijo. */
  @Column({ type: 'smallint', default: 1 })
  cantidad: number;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
