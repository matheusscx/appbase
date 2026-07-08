import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_api_keys')
export class PasarelaApiKey {
  @PrimaryGeneratedColumn('uuid', { name: 'api_key_id' })
  apiKeyId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column()
  nombre: string; // descriptivo: "app móvil bodega"

  @Column()
  prefijo: string; // visible en UI: 'pk_a1b2c3…'

  @Index({ unique: true })
  @Column({ name: 'key_hash' })
  keyHash: string; // SHA-256 hex de la key completa

  @Column({ name: 'ultimo_uso_el', type: 'timestamptz', nullable: true })
  ultimoUsoEl: Date | null;

  @Column({ name: 'revocada_el', type: 'timestamptz', nullable: true })
  revocadaEl: Date | null;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
