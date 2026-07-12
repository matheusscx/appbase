import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('pasarela_inscripciones')
@Index(['tenantId', 'pagadorRef'])
export class PasarelaInscripcion {
  @PrimaryGeneratedColumn('uuid', { name: 'inscripcion_id' })
  inscripcionId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'tenant_pasarela_id', type: 'uuid' })
  tenantPasarelaId: string;

  @Column({ name: 'pagador_ref', length: 100 })
  pagadorRef: string; // opaco, lo aporta la app consumidora

  // tbkUser cifrado ('v1:iv:tag:data') — con él + commerce code se puede cobrar
  @Column({ name: 'identificador_externo', type: 'text', nullable: true })
  identificadorExterno: string | null;

  // username generado por nosotros ('insc-<uuid sin guiones>'), NUNCA el pagador_ref crudo
  @Column({ name: 'identificador_usuario_externo' })
  identificadorUsuarioExterno: string;

  @Column({ default: 'pendiente' })
  estado: string; // 'pendiente' | 'procesando' | 'activa' | 'fallida' | 'eliminada'

  // Preferida del pagador para cobros sin inscripción explícita (solo una por tenant+pagador)
  @Column({ default: false })
  preferida: boolean;

  // token temporal del start (correlación del retorno de Webpay)
  @Index()
  @Column({ name: 'token_proveedor', type: 'varchar', nullable: true })
  tokenProveedor: string | null;

  @Column({ name: 'url_retorno_app' })
  urlRetornoApp: string;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'creado_el' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el' }) actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el' }) eliminadoEl: Date | null;
}
