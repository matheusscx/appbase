import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('item_unidad')
// La serie es única **por producto**, no por tenant (owner, 2026-09-19): cada
// proveedor numera como quiere y no hay estándar global, así que dos productos
// distintos del mismo tenant sí pueden repetir número. `tenant_id` no entra en
// la clave porque `item_id` ya lo determina.
//
// Va acá y no en el seeder porque son columnas peladas: `@Index` las expresa y
// `synchronize` crea el índice. El seeder se usa para los índices que TypeORM
// no sabe declarar —los de `lower(nombre)`, ver `seedGruposModificadores()`—.
//
// El índice es la red del lado de la base; el 400 que nombra la serie repetida
// lo da `InventarioService.moverSerie`, el único lugar que inserta unidades.
@Index('uq_unidad_item_serie', ['itemId', 'serie'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class ItemUnidad {
  @PrimaryGeneratedColumn('uuid', { name: 'unidad_id' })
  unidadId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ name: 'lote_id', type: 'uuid', nullable: true })
  loteId: string | null;

  @Column({ type: 'text' })
  serie: string;

  @Column({ type: 'text', default: 'disponible' })
  estado: string; // 'disponible' | 'reservado' | 'vendido' | 'baja'

  @Column({ type: 'text', default: 'nuevo' })
  condicion: string; // 'nuevo' | 'usado' | 'reacondicionado'

  @Column({ name: 'garantia_hasta', type: 'timestamptz', nullable: true })
  garantiaHasta: Date | null;

  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  /** Dónde está físicamente esta unidad. Una unidad está en un solo lugar. */
  @Column({ name: 'ubicacion_id', type: 'uuid' })
  ubicacionId: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
