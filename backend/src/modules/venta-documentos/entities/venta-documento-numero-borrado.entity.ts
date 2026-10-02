import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cada vez que alguien con `Ventas:Anular` borra el número de un documento hecho
 * por fuera (`externo`), queda **una fila acá**: qué decía, quién lo borró y
 * cuándo (PRODUCTO § 10, decisión del owner del 2026-10-02; ADR-028).
 *
 * Es una tabla de eventos y no tres columnas en `venta_documentos`, por la misma
 * razón que `garzon_pin_evento`: columnas guardan solo el **último** borrado, y
 * el caso que importa es justo el que las pisa (se anotó un número, se borró, se
 * anotó otro, se borró). Las filas son **hechos con hora**: se insertan y nunca
 * se editan ni se borran; el soft delete está por convención del repo. `creado_el`
 * es el momento del borrado.
 *
 * Solo se registra el **borrado**. Reescribir un número con el `PATCH` no deja
 * nada: el owner pidió el rastro de lo que se borra, no de cada edición.
 *
 * Sin relaciones (`@ManyToOne`) a `venta_documentos` ni a `usuarios`, como
 * `garzon_pin_evento`: el esquema real lo genera `synchronize` desde ESTA entity y
 * `startup-pos.sql` es documentación, así que el índice va acá.
 */
@Entity('venta_documento_numero_borrados')
// La lectura siempre es "los borrados de estos documentos", acotada al tenant.
@Index('idx_venta_documento_numero_borrados_documento', [
  'tenantId',
  'documentoId',
  'creadoEl',
])
export class VentaDocumentoNumeroBorrado {
  @PrimaryGeneratedColumn('uuid', { name: 'numero_borrado_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'documento_id', type: 'uuid' })
  documentoId: string;

  /** Lo que decía el documento antes de borrarlo. Nunca vacío: sin número no hay nada que borrar. */
  @Column({ name: 'numero_anterior', type: 'text' })
  numeroAnterior: string;

  /** Quién lo borró (el del token). NOT NULL: un borrado sin actor no sirve como registro. */
  @Column({ name: 'usuario_id', type: 'uuid' })
  usuarioId: string;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
