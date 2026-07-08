import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('tenant_pasarela')
export class TenantPasarela {
  @PrimaryGeneratedColumn('uuid', { name: 'tenant_pasarela_id' })
  tenantPasarelaId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'pasarela_id', type: 'uuid' })
  pasarelaId: string;

  @Column()
  ambiente: string; // 'pruebas' | 'produccion'

  @Column({ name: 'modo_integracion' })
  modoIntegracion: string; // 'mall' | 'individual'

  // Blob cifrado — INDIVIDUAL: credenciales completas; MALL: { "commerceCodeHijo": "..." }
  @Column({ type: 'text', nullable: true })
  configuracion: string | null;

  @Column({ default: true })
  activo: boolean;

  @Column({ default: 1 })
  prioridad: number;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
