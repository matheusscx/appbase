import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('grupos_modificadores')
export class GrupoModificador {
  @PrimaryGeneratedColumn('uuid', { name: 'grupo_modificador_id' })
  grupoModificadorId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ name: 'creado_el', type: 'timestamptz', default: () => 'NOW()' })
  creadoEl: Date;

  @Column({ name: 'actualizado_el', type: 'timestamptz', nullable: true })
  actualizadoEl: Date | null;

  @Column({ name: 'eliminado_el', type: 'timestamptz', nullable: true })
  eliminadoEl: Date | null;
}
