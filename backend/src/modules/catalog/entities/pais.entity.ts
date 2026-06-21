import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('pais')
export class Pais {
  @PrimaryGeneratedColumn('uuid', { name: 'pais_id' })
  paisId: string;

  @Column()
  nombre: string;

  @Column({ name: 'codigo_iso', type: 'char', length: 2, unique: true })
  codigoIso: string;

  @Column({ name: 'zona_horaria_principal' })
  zonaHorariaPrincipal: string;

  @Column({ name: 'moneda_oficial_id', type: 'uuid', nullable: true })
  monedaOficialId: string | null;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date;
}
