import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('tenant_metodo_pago')
export class TenantMetodoPago {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @PrimaryColumn({ name: 'metodo_pago_id', type: 'uuid' })
  metodoPagoId: string;

  @Column({ name: 'permite_vuelto', default: false })
  permiteVuelto: boolean;

  @Column({ default: false })
  habilitada: boolean;

  // Política operativa por tenant: fuerza el conteo obligatorio de un método
  // no-efectivo al cerrar. obligatorio = es_efectivo OR requiere_conteo.
  @Column({ name: 'requiere_conteo', default: false })
  requiereConteo: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
