import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('terceros')
export class Tercero {
  @PrimaryGeneratedColumn('uuid', { name: 'tercero_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  tipo: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  rut: string | null;

  @Column({ name: 'nombre_legal', type: 'varchar', length: 100, nullable: true })
  nombreLegal: string | null;

  @Column({ name: 'rut_fiscal', type: 'varchar', length: 50, nullable: true })
  rutFiscal: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  correo: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  telefono: string | null;

  @Column({ type: 'text', nullable: true })
  direccion: string | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
