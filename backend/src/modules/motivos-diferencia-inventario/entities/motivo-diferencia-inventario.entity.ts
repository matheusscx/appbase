import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

// `uq_motivo_dif_inv_tenant_nombre` es sobre `lower(nombre)`: TypeORM no sabe
// expresar una función en `@Index`, así que acá solo se registra el NOMBRE
// con `synchronize: false` para que `synchronize` no lo tire al arrancar
// (pendientes.md, "synchronize no tira los 17 índices del seeder"). Lo sigue
// creando `SeederService.seedMotivosDiferenciaInventario()` con SQL cruda.
@Index('uq_motivo_dif_inv_tenant_nombre', { synchronize: false })
@Entity('motivo_diferencia_inventario')
export class MotivoDiferenciaInventario {
  @PrimaryGeneratedColumn('uuid', { name: 'motivo_diferencia_inventario_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ name: 'es_fijo', type: 'boolean', default: false })
  esFijo: boolean;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({
    name: 'actualizado_el',
    type: 'timestamptz',
    nullable: true,
  })
  actualizadoEl: Date | null;

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;

  @Column({ name: 'eliminado_por', type: 'uuid', nullable: true })
  eliminadoPor: string | null;
}
