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
 * Índice por venta. Medido con 18.000 filas: 1,2 ms de seq scan → 0,05 ms.
 *
 * 📌 Va como índice pelado y no como UNIQUE parcial —el molde de
 * `uq_venta_propina_venta`, que daría el índice y el invariante al mismo costo—
 * porque eso cambia conducta: un segundo `INSERT` pasaría de guardarse a fallar.
 * Es una decisión de dominio, no de performance, y no entra en un frente de índices.
 *
 * Es una de las seis que el detalle de una venta lee por `venta_id`, indexadas
 * juntas el 2026-09-06. El costo de escritura y las trampas de la medición:
 * `docs/patterns/backend.md` § 17, que es donde vive la tabla completa — acá va
 * solo el número de esta, para no tener el total copiado en ocho archivos.
 */
@Index('idx_venta_customer_venta', ['ventaId'])
@Entity('venta_customer')
export class VentaCustomer {
  @PrimaryGeneratedColumn('uuid', { name: 'customer_id' })
  id: string;

  @Column({ name: 'venta_id', type: 'uuid' })
  ventaId: string;

  @Column({ name: 'tercero_id', type: 'uuid', nullable: true })
  terceroId: string | null;

  @Column({ type: 'text' })
  nombre: string;

  @Column({ type: 'text', nullable: true })
  rut: string | null;

  @Column({ type: 'text', nullable: true })
  direccion: string | null;

  @Column({ type: 'text', nullable: true })
  telefono: string | null;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
