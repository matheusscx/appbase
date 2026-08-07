import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Usuario } from '../../users/usuario.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  token: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => Usuario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Usuario;

  @Column({ name: 'active_tenant_id', type: 'uuid', nullable: true })
  activeTenantId: string | null;

  // `type` explícito en las dos fechas (ADR-019). `expires_at` es la que le
  // dio sentido al segundo test: el invariante unit de `common/invariants/`
  // sólo mira las tres columnas de auditoría, así que **a ésta no la veía** —
  // se encontró a mano al migrar `created_at`, y dejarla sin zona habría
  // dejado mixta justo la tabla que decide si un token sigue vivo. Hoy sí la
  // cubre `test/esquema.e2e-spec.ts`, que va sobre el esquema entero
  // precisamente por este caso.
  // La comparación de expiración vive en JS (`auth.service.ts` →
  // `existing.expiresAt < new Date()`), no en SQL: por eso el cambio de tipo
  // no mueve ninguna lógica de tokens (invariante 4, autorizado por el owner).
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
