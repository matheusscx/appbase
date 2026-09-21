import {
  Check,
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export type OrigenStockMinimo = 'manual' | 'sistema';

/**
 * El mínimo de stock de un producto en una ubicación: bajo este número, el
 * aviso de stock bajo lo marca (`docs/features/aviso-stock-bajo.md`).
 *
 * Tabla propia y no una columna de `stock_ubicacion`, porque esa tabla tiene
 * un solo escritor —el chokepoint de movimientos— y su fila puede no existir
 * todavía: cargar un mínimo en una bodega nueva obligaría a crear saldo por
 * fuera de `registrarMovimiento`.
 *
 * **Sin fila = nunca se cargó un mínimo** para ese par, y sin mínimo no hay
 * aviso. Una fila con `minimo = 0` es un cero puesto a propósito, distinguible
 * de "nunca se cargó".
 *
 * Sin `tenant_id` propio: se acota por `JOIN` a `items`, igual que las demás
 * tablas que cuelgan de un ítem (`docs/patterns/backend.md` § 4).
 *
 * ⛔ Nada la borra en cascada: borrar o desactivar el ítem o la ubicación deja
 * de evaluarla (lo filtran las lecturas), pero el número que alguien decidió
 * queda para cuando se restaure.
 */
@Entity('stock_minimo')
@Check('chk_stock_minimo_origen', `"origen" IN ('manual', 'sistema')`)
@Check('chk_stock_minimo_no_negativo', `"minimo" >= 0`)
export class StockMinimo {
  @PrimaryColumn({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @PrimaryColumn({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

  /** Misma escala que `stock_ubicacion.stock`: se comparan entre sí. */
  @Column({ type: 'numeric', precision: 18, scale: 4 })
  minimo: string;

  /**
   * Quién puso el número. Hoy siempre `'manual'`: el mínimo sugerido que
   * escribiría `'sistema'` está fuera de alcance, y la columna existe para que
   * esa feature no tenga que migrar el esquema el día que llegue.
   * `type: 'text'` explícito: con la unión de TS sola, `design:type` queda en
   * `Object` y TypeORM no arranca.
   */
  @Column({ type: 'text', default: 'manual' })
  origen: OrigenStockMinimo;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;
}
