import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * El documento **interno** de un traslado entre dos ubicaciones del mismo
 * tenant. Lleva origen, destino, motivo y comentario; las cantidades no viven
 * acá sino en el kardex: cada línea deja **dos** filas de
 * `movimientos_inventario` —salida en el origen, entrada en el destino—
 * colgadas de este `traslado_id` (spec § 4.3).
 *
 * ⛔ **No emite nada.** El documento chileno del traslado es el **DTE 52** y
 * **viaja con la mercadería**: esta fila no lo reemplaza y tenerla registrada
 * no es lo mismo que estar en regla. El tenant lo emite por fuera, igual que
 * hoy hace con las boletas (ADR-010).
 */
@Index('idx_traslados_tenant', ['tenantId'])
@Entity('traslados')
export class Traslado {
  @PrimaryGeneratedColumn('uuid', { name: 'traslado_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'ubicacion_origen_id', type: 'uuid' })
  ubicacionOrigenId: string;

  @Column({ name: 'ubicacion_destino_id', type: 'uuid' })
  ubicacionDestinoId: string;

  @Column({ name: 'motivo_traslado_id', type: 'uuid' })
  motivoTrasladoId: string;

  @Column({ type: 'text', nullable: true })
  comentario: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({
    name: 'actualizado_el',
    type: 'timestamptz',
    nullable: true,
  })
  actualizadoEl: Date | null;

  @DeleteDateColumn({
    name: 'eliminado_el',
    type: 'timestamptz',
    nullable: true,
  })
  eliminadoEl: Date | null;
}
