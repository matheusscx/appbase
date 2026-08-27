import {
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Bridge: qué ítems concretos satisfacen un scope `tipo_scope = 'items'`.
 * Molde: `descuento-metodo-pago.entity.ts` (PK compuesta + soft delete).
 * Diseño: docs/superpowers/specs/2026-08-27-motor-promociones-design.md
 */
@Entity('promocion_scope_items')
export class PromocionScopeItem {
  @PrimaryColumn({ name: 'scope_id', type: 'uuid' })
  scopeId: string;

  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
