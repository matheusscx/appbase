import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('propina_configuracion')
@Index('uq_propina_config_tenant', ['tenantId'], {
  unique: true,
  where: '"eliminado_el" IS NULL',
})
export class PropinaConfiguracion {
  @PrimaryGeneratedColumn('uuid', { name: 'propina_configuracion_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  // `default: () => '0.10'` y no `default: '0.10'` (string): Postgres guarda
  // el default de un `numeric` con punto decimal SIN comillas (`0.10`, medido
  // contra la base), y `normalizeDefault` de TypeORM envuelve todo string u
  // number en comillas (`'0.10'`) salvo que venga de una función —que se toma
  // literal—. Con el string plano, `synchronize` comparaba `'0.10'` contra
  // `0.10` y tiraba un `ALTER … SET DEFAULT` en cada arranque (pendientes.md,
  // "synchronize no tira los 17 índices del seeder").
  @Column({
    name: 'porcentaje_sugerido',
    type: 'numeric',
    precision: 10,
    scale: 6,
    default: () => '0.10',
  })
  porcentajeSugerido: string;

  @Column({ name: 'habilitado_pos', type: 'boolean', default: true })
  habilitadoPos: boolean;

  @Column({ name: 'habilitado_salones', type: 'boolean', default: true })
  habilitadoSalones: boolean;

  @Column({ name: 'actualizado_por', type: 'uuid', nullable: true })
  actualizadoPor: string | null;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
