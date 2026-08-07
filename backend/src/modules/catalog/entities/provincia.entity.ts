import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('provincia')
export class Provincia {
  @PrimaryGeneratedColumn('uuid', { name: 'provincia_id' })
  provinciaId: string;

  @Column({ name: 'pais_id', type: 'uuid' })
  paisId: string;

  @Column()
  nombre: string;

  @Column({ name: 'zona_horaria' })
  zonaHoraria: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date;
}
