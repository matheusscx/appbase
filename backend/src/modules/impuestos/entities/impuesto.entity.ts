import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  Check,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('impuestos')
// Sistema: (tenant_id NULL, pais_id set) · Personalizado: (tenant_id set, pais_id NULL)
@Check('CHK_impuestos_scope', '("tenant_id" IS NULL) <> ("pais_id" IS NULL)')
// `uq_impuestos_tenant_nombre_vivo` es sobre `lower(nombre)`: TypeORM no sabe
// expresar una función en `@Index`, así que acá solo se registra el NOMBRE
// con `synchronize: false` para que `synchronize` no lo tire al arrancar
// (pendientes.md, "synchronize no tira los 17 índices del seeder"). Lo sigue
// creando `SeederService.seedImpuestos()` con SQL cruda.
@Index('uq_impuestos_tenant_nombre_vivo', { synchronize: false })
export class Impuesto {
  @PrimaryGeneratedColumn('uuid', { name: 'impuesto_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ name: 'pais_id', type: 'uuid', nullable: true })
  paisId: string | null;

  @Column({ type: 'text', default: 'otro' })
  tipo: string; // 'iva' (se descarta SIEMPRE de la lista resuelta y se agrega
  // solo cuando el ítem es 'afecto' — se deriva, no se lee de item_impuestos,
  // ver ADR-018) | 'otro'

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'numeric', precision: 7, scale: 4 })
  porcentaje: string; // numeric ↦ string en JS, usar Decimal.js para operar

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
