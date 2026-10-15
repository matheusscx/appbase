import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AmbienteSii } from './dte-caf.entity';

/**
 * Un sobre mandado al SII (cola de envío). El estado de cada boleta vive en `dte_documentos`;
 * acá queda lo del envío: el trackid, lo que contestó el SII y cuándo volver a preguntar.
 * `reservado_hasta` es la reserva del sobre en vuelo: si el proceso se cae, vence y las boletas
 * vuelven a la cola. `trackid` es bigint en la base pero `pg` lo devuelve como string, y así se
 * guarda en la entity (cabe sobradamente en 15 dígitos).
 */
@Entity('dte_envios')
@Check(
  'chk_dte_envios_ambiente',
  `"ambiente" IN ('certificacion','produccion')`,
)
@Index('idx_dte_envios_consulta', ['consultarDesde'], {
  where: '"trackid" IS NOT NULL AND "eliminado_el" IS NULL',
})
@Index('idx_dte_envios_reserva', ['reservadoHasta'], {
  where: '"trackid" IS NULL AND "eliminado_el" IS NULL',
})
export class DteEnvio {
  @PrimaryGeneratedColumn('uuid', { name: 'envio_id' }) id: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId: string;
  @Column({ name: 'razon_social_id', type: 'uuid' }) razonSocialId: string;
  @Column({ type: 'text' }) ambiente: AmbienteSii;
  @Column({
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (valor: string | null): string | null => valor,
      from: (valor: string | null): string | null =>
        valor === null ? null : String(valor),
    },
  })
  trackid: string | null;
  @Column({ name: 'estado_sii', type: 'varchar', length: 3, nullable: true })
  estadoSii: string | null;
  @Column({ name: 'enviado_el', type: 'timestamptz', nullable: true })
  enviadoEl: Date | null;
  @Column({ name: 'consultar_desde', type: 'timestamptz', nullable: true })
  consultarDesde: Date | null;
  @Column({ name: 'reservado_hasta', type: 'timestamptz', nullable: true })
  reservadoHasta: Date | null;
  @Column({ name: 'intentos_consulta', type: 'integer', default: 0 })
  intentosConsulta: number;
  @Column({ name: 'ultimo_error', type: 'text', nullable: true })
  ultimoError: string | null;
  @Column({ name: 'respuesta_sii', type: 'jsonb', nullable: true })
  respuestaSii: unknown;
  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' }) creadoEl: Date;
  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;
  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
