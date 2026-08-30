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
 * `idx_cuenta_lineas_personalizacion` (GIN): lo pide la SEGUNDA rama `'cuenta'`
 * de `ItemsService.obtenerUsoItem` —la que busca el ítem **adentro** de
 * `personalizacion`, no en `item_id`— y lo van a pedir los guards de
 * `PATCH /items/:id` y `PATCH /grupos-modificadores/:id`, que hacen la misma
 * pregunta. Es un `@>` sobre `jsonb`: ningún btree lo resuelve.
 *
 * Medido contra el Postgres del compose, con coincidencia real: 60.315 líneas
 * (tabla de 14 MB = 1.828 páginas), 6.031 cuentas de las que 31 están abiertas,
 * 14 mesas vivas en el tenant.
 *
 *   sin índice   778 ms   25.635 buffers
 *   con GIN      0,14 ms      24 buffers
 *
 * Los 25.592 buffers de `cuenta_lineas` sin índice son 1.828 × 14: el
 * planificador **rebarre la tabla entera una vez por mesa**, porque el `JOIN` a
 * cuentas abiertas no acota nada — el filtro `jsonb` se evalúa antes. Ese ×14
 * es lo que crece: no con las mesas sentadas, sino con la historia del tenant.
 *
 * Cuesta espacio: 7,3 MB de índice sobre 14 MB de tabla, y `cuenta_lineas` se
 * escribe en cada producto que entra a una mesa. GIN amortigua eso con
 * `fastupdate`, y la alternativa era peor: sin índice, `GET /items/:id/uso`
 * —que el frontend dispara antes de abrir el modal de borrado— escanea la
 * historia entera del tenant.
 *
 * Va sin opclass a propósito: `jsonb_path_ops` es más chico y más rápido, pero
 * TypeORM no expresa el opclass (`IndexOptions` tiene `type`, no `ops`), y el
 * `jsonb_ops` por defecto resuelve `@>` igual. El esquema de este proyecto sale
 * de las entidades (`synchronize`), no de migraciones.
 */
@Index('idx_cuenta_lineas_personalizacion', ['personalizacion'], {
  type: 'gin',
})
/**
 * `idx_cuenta_lineas_item`: lo pide la PRIMERA rama `'cuenta'` del mismo
 * `obtenerUsoItem`, que busca por `item_id` para bloquear el borrado de un ítem
 * pedido en una cuenta abierta. Corre en cada `DELETE /items/:id` y en cada
 * `GET /items/:id/uso`, y `cuenta_lineas` crece con cada producto pedido en la
 * historia del tenant, soft-deletes incluidos. Sin él es un seq scan que escala
 * con el volumen transaccional. Postgres no indexa las FK por su cuenta.
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
