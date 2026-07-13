import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum FormaMesa {
  REDONDA = 'redonda',
  CUADRADA = 'cuadrada',
  RECTANGULAR = 'rectangular',
}

export enum TamanoMesa {
  PEQUENO = 'pequeno',
  MEDIANO = 'mediano',
  GRANDE = 'grande',
  EXTRA_GRANDE = 'extra_grande',
}

@Entity('mesas')
export class Mesa {
  @PrimaryGeneratedColumn('uuid', { name: 'mesa_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'salon_id', type: 'uuid' })
  salonId: string;

  @Column({ type: 'text' })
  nombre: string;

  // Posición en el plano como fracción 0..1 del contenedor (plano responsivo).
  @Column({
    name: 'pos_x',
    type: 'numeric',
    precision: 6,
    scale: 5,
    default: 0,
  })
  posX: string;

  @Column({
    name: 'pos_y',
    type: 'numeric',
    precision: 6,
    scale: 5,
    default: 0,
  })
  posY: string;

  @Column({ type: 'text', default: FormaMesa.CUADRADA })
  forma: FormaMesa;

  @Column({ type: 'text', default: TamanoMesa.MEDIANO })
  tamano: TamanoMesa;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
