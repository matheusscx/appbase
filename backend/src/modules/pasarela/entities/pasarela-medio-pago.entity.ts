import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_medios_pago')
export class PasarelaMedioPago {
  @PrimaryGeneratedColumn('uuid', { name: 'medio_pago_id' })
  medioPagoId: string;

  @Column({ name: 'inscripcion_id', type: 'uuid' })
  inscripcionId: string;

  @Column()
  tipo: string; // 'TARJETA_CREDITO' | 'TARJETA_DEBITO' | 'TARJETA' | ...

  @Column({ type: 'varchar', nullable: true })
  marca: string | null; // Visa, Mastercard...

  @Column({ name: 'ultimos_4', length: 4 })
  ultimos4: string;

  @Column({ name: 'fecha_expiracion', type: 'varchar', nullable: true })
  fechaExpiracion: string | null;

  // token por tarjeta cifrado (proveedores tipo Stripe); Oneclick no lo usa
  @Column({ name: 'token_externo', type: 'text', nullable: true })
  tokenExterno: string | null;

  @Column({ default: 'activo' })
  estado: string; // 'activo' | 'eliminado'

  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
