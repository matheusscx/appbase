import {
  Entity,
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
export class Impuesto {
  @PrimaryGeneratedColumn('uuid', { name: 'impuesto_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId: string | null;

  @Column({ name: 'pais_id', type: 'uuid', nullable: true })
  paisId: string | null;

  @Column({ type: 'text', default: 'otro' })
  tipo: string; // 'iva' (suprimido en líneas exentas) | 'otro'

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'numeric', precision: 7, scale: 4 })
  porcentaje: string; // numeric ↦ string en JS, usar Decimal.js para operar

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
