import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

// Índice único parcial: nombre único por tenant entre no-borrados. Es la garantía
// dura (bajo concurrencia el check de `count` del service podría saltearse); el
// service igual valida primero para devolver un 409 con mensaje amable.
//
// ⚠️ `ux_cajones_tenant_nombre` NO se declara acá a propósito: tiene que ser sobre
// `LOWER("nombre")` —la unicidad de nombre es case-insensitive en todo el
// proyecto (docs/PRODUCTO.md)— y **TypeORM no sabe expresar una función en
// `@Index`**. Mientras estuvo declarado acá, `synchronize` creaba en dev un
// índice sobre `nombre` PELADO y la base enforzaba otra regla que el código.
// Lo crea `seeder.service.ts` → `seedCajones()` con SQL cruda, mismo patrón que
// `grupos_modificadores`, `causas_merma` y los dos `motivos_diferencia`.
@Entity('cajones')
export class Cajon {
  @PrimaryGeneratedColumn('uuid', { name: 'cajon_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
