import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('items')
/**
 * Un solo ítem de ajuste por tenant. `asegurarItemAjuste` toma la primera fila
 * marcada: con dos, de cuál cuelga la línea de la nota de crédito dependería
 * del orden que elija el planner. Mismo patrón que
 * `uq_tipo_documento_nota_credito_pais` y `uq_sesion_garzon_abierta`.
 */
@Index('uq_item_ajuste_nc_tenant', ['tenantId'], {
  unique: true,
  where: `"es_ajuste_nota_credito" = true AND "eliminado_el" IS NULL`,
})
export class Item {
  @PrimaryGeneratedColumn('uuid', { name: 'item_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'moneda_id', type: 'uuid' })
  monedaId: string;

  @Column({ name: 'categoria_id', type: 'uuid', nullable: true })
  categoriaId: string | null;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ name: 'precio_base', type: 'numeric', precision: 18, scale: 4 })
  precioBase: string;

  @Column({ name: 'precio_incluye_impuesto', default: false })
  precioIncluyeImpuesto: boolean;

  @Column({ default: true })
  activo: boolean;

  @Column({ type: 'text' })
  tipo: string;

  // Nullable a propósito: `tipo='ingrediente'` no tiene tratamiento fiscal
  // porque no se vende. NO es "afecto por defecto" — ver ADR-018 y el
  // `=== 'afecto'` de calculo-precios.service.ts.
  //
  // El DEFAULT se conserva a propósito, junto con `nullable`: son dos
  // protecciones distintas, no una redundancia. `nullable` + el `=== 'afecto'`
  // positivo del motor de precios protegen la LECTURA (un NULL existente
  // nunca deriva IVA). El DEFAULT protege la ESCRITURA: sin él, cualquier
  // INSERT crudo que omita la columna (seed, scripts, futuras migraciones)
  // produce un NULL "por accidente" en vez de 'afecto' — el seeder de esta
  // misma tarea lo probó: 4 de sus 6 INSERT de items dejaban de especificar
  // la columna y confiaban en el default. Sacarlo no tapa ningún agujero que
  // no tape ya `nullable`, y sí abre uno nuevo.
  @Column({
    name: 'clasificacion_tributaria',
    type: 'text',
    nullable: true,
    default: 'afecto',
  })
  clasificacionTributaria: string | null; // 'afecto' | 'exento' | null

  /**
   * El ítem de sistema del que cuelga la línea de ajuste de una nota de
   * crédito. `venta_detalles.item_id` es NOT NULL, así que esa línea necesita
   * colgar de algún ítem, y tiene que ser un `servicio`: en este sistema solo
   * `tipo='producto'` tiene stock, y una línea de ajuste no repone nada.
   *
   * Se marca con columna y no por nombre —que es editable— igual que
   * `tipos_documento_tributario.es_nota_credito` y `garzones.es_placeholder`.
   */
  @Column({ name: 'es_ajuste_nota_credito', default: false })
  esAjusteNotaCredito: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
