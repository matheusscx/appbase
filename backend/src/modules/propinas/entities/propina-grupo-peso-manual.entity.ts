import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('propina_grupo_peso_manual')
@Index('uq_propina_peso_grupo_garzon', ['grupoId', 'garzonId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class PropinaGrupoPesoManual {
  @PrimaryGeneratedColumn('uuid', { name: 'propina_grupo_peso_manual_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'grupo_id', type: 'uuid' })
  grupoId: string;

  @Column({ name: 'garzon_id', type: 'uuid' })
  garzonId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  peso: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
