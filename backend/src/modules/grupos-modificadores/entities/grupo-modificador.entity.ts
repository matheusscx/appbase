import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

// Nota: el índice único parcial de producción (startup-pos.sql) usa
// LOWER("nombre") para ser case-insensitive. TypeORM @Index no soporta
// expresiones tipo LOWER() en las columnas listadas, así que este índice
// (el que synchronize:true crea en dev) es case-sensitive — discrepancia
// dev/prod menor y aceptada, no bloqueante.
@Entity('grupos_modificadores')
@Index('uq_grupo_modificador_nombre_vivo', ['tenantId', 'nombre'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
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
