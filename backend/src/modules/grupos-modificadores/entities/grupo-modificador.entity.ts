import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// ⚠️ `uq_grupo_modificador_nombre_vivo` NO se declara acá a propósito.
//
// El índice tiene que ser sobre `LOWER("nombre")` —así lo declara
// `startup-pos.sql` y así compara `assertNombreLibre`—, y **TypeORM no sabe
// expresar una función en `@Index`**. Mientras estuvo declarado acá,
// `synchronize` creaba en dev un índice sobre `nombre` PELADO: la regla del
// producto era una sola, pero la base de dev enforzaba otra, y el único guard
// que quedaba del lado del motor era el equivocado (el `restaurar()` de la
// papelera no pasa por `assertNombreLibre`).
//
// Lo crea `seeder.service.ts` → `seedGruposModificadores()` con SQL cruda,
// mismo patrón que `causas_merma` y los dos `motivos_diferencia`, cuyas
// entities tampoco lo declaran por la misma razón.
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

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
