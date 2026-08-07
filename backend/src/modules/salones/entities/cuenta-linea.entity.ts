import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import type { PersonalizacionRecetaSnapshot } from '../../../common/dto/personalizacion-receta.dto';

/**
 * `idx_cuenta_lineas_item`: lo pide la rama `'cuenta'` de
 * `ItemsService.obtenerUsoItem`, que busca por `item_id` para bloquear el
 * borrado de un ítem pedido en una cuenta abierta. Corre en cada
 * `DELETE /items/:id` y en cada `GET /items/:id/uso` —que el frontend dispara
 * antes de abrir el modal de confirmación—, y `cuenta_lineas` crece con cada
 * producto pedido en la historia del tenant, soft-deletes incluidos. Sin él es
 * un seq scan que escala con el volumen transaccional. Postgres no indexa las
 * FK por su cuenta.
 */
@Index('idx_cuenta_lineas_item', ['itemId'])
@Entity('cuenta_lineas')
export class CuentaLinea {
  @PrimaryGeneratedColumn('uuid', { name: 'cuenta_linea_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'cuenta_id', type: 'uuid' })
  cuentaId: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @Column({ type: 'numeric', precision: 18, scale: 4 })
  cantidad: string;

  @Column({
    name: 'cantidad_presentacion',
    type: 'numeric',
    precision: 18,
    scale: 4,
    nullable: true,
  })
  cantidadPresentacion: string | null;

  @Column({ name: 'unidad_codigo_presentacion', type: 'text', nullable: true })
  unidadCodigoPresentacion: string | null;

  // Cuánto de `cantidad` ya se envió a cocina/barra (POST /cuentas/:id/comanda).
  // El diff (cantidad - cantidad_enviada) es lo que se imprime en el próximo envío.
  @Column({
    name: 'cantidad_enviada',
    type: 'numeric',
    precision: 18,
    scale: 4,
    default: 0,
  })
  cantidadEnviada: string;

  @Column({ type: 'jsonb', nullable: true })
  personalizacion: PersonalizacionRecetaSnapshot | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
