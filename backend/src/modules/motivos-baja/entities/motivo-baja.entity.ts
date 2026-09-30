import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { TipoMotivoBaja } from '../tipo-motivo-baja.enum';

// `uq_motivo_baja_tenant_nombre` es sobre `lower(nombre)`: TypeORM no sabe
// expresar una función en `@Index`, así que acá solo se registra el NOMBRE
// con `synchronize: false` para que `synchronize` no lo tire al arrancar
// (pendientes.md, "synchronize no tira los 17 índices del seeder"). Lo sigue
// creando `SeederService.seedMotivosBaja()` con SQL cruda.
@Index('uq_motivo_baja_tenant_nombre', { synchronize: false })
@Entity('motivo_baja')
export class MotivoBaja {
  @PrimaryGeneratedColumn('uuid', { name: 'motivo_baja_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @Column({ name: 'es_fijo', type: 'boolean', default: false })
  esFijo: boolean;

  @Column({ type: 'enum', enum: TipoMotivoBaja, enumName: 'tipo_motivo_baja' })
  tipo: TipoMotivoBaja;

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
