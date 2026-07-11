import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

/**
 * Tipo de documento "Nota de Crédito" (código 61 Chile), sembrado con
 * `activo: false` para que no aparezca en el selector del POS. Las NC se
 * crean solo desde el flujo de reembolso usando este ID directamente.
 */
export const TIPO_DOCUMENTO_NC_ID = '550e8400-e29b-41d4-a716-446655440218';

@Entity('tipos_documento_tributario')
export class TipoDocumentoTributario {
  @PrimaryGeneratedColumn('uuid', { name: 'tipo_documento_id' })
  id: string;

  @Column({ name: 'pais_id', type: 'uuid' })
  paisId: string;

  @Column({ type: 'varchar', length: 100 })
  nombre: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  codigo: string | null;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ default: true })
  activo: boolean;

  @Column({ name: 'customer_requerido', default: false })
  customerRequerido: boolean;

  @CreateDateColumn({ name: 'creado_el' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el' })
  eliminadoEl: Date | null;
}
