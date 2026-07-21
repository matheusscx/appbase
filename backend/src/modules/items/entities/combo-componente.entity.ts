import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('combo_componentes')
@Index('uq_combo_componente_vivo', ['comboItemId', 'componenteItemId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class ComboComponente {
  @PrimaryGeneratedColumn('uuid', { name: 'combo_componente_id' })
  comboComponenteId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'combo_item_id', type: 'uuid' })
  comboItemId: string;

  @Column({ name: 'componente_item_id', type: 'uuid' })
  componenteItemId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({ type: 'boolean', default: true })
  bloqueante: boolean;

  @Column({ name: 'creado_el', type: 'timestamptz', default: () => 'NOW()' })
  creadoEl: Date;

  @Column({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @Column({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
