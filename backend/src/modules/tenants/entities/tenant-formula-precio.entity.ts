import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('tenant_formula_precio')
export class TenantFormulaPrecio {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @PrimaryColumn({ type: 'smallint' })
  paso: number;

  @Column()
  tipo: string; // 'descuentos' | 'recargos' | 'impuestos'
}
