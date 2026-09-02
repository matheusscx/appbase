import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

export enum EstadoCuenta {
  ABIERTA = 'abierta',
  CERRADA = 'cerrada',
  CANCELADA = 'cancelada',
}

/**
 * `idx_cuentas_venta`: lo pide el `EXISTS` de `VentasService.findOne`, que
 * pregunta si la venta vino de una cuenta con líneas ya despachadas a cocina.
 * Corre en cada `GET /ventas/:id` —o sea cada vez que alguien abre el detalle de
 * una venta— y `cuentas` crece con cada mesa atendida en la historia del tenant,
 * soft-deletes incluidos. Sin él es un seq scan que escala con el volumen del
 * salón. Postgres no indexa las FK por su cuenta, y `venta_id` no tenía ningún
 * lector antes de esa consulta.
 */
@Index('idx_cuentas_venta', ['tenantId', 'ventaId'])
@Index('idx_cuentas_responsable', ['tenantId', 'garzonResponsableId'])
/**
 * `idx_cuentas_estado`: lo pide `ItemsService.comprometidoPorItem`, la consulta
 * que le resta a `disponible`/`stockDisponible` lo que las cuentas ABIERTAS ya
 * pidieron. Cuelga de `GET /items`, o sea del menú del POS, y las pantallas
 * disparan **tres `GET /items` en paralelo** cada vez (`pos.vue:138,141,144` y
 * `salones/index.vue:638-640`), así que el costo se multiplica por tres. En el
 * POS eso pasa por carga de pantalla; en `/salones`, por cada ráfaga de mutación
 * (`refrescarItems`, debounce de 250 ms).
 *
 * ⚠️ **Solo no sirve de nada, y eso está medido con un control**: agregándolo
 * sin `idx_cuenta_lineas_cuenta` la consulta pasa de 13,99 ms a 12,52 ms — sigue
 * barriendo `cuenta_lineas` entera. El que cambia el plan es aquel (1,22 ms);
 * este recorta el lado chico una vez que el grande dejó de ser un seq scan
 * (0,36 ms con los dos, y el scan de `cuentas` cae de 124 buffers a 3). Las
 * cuatro corridas y su escala están en el docblock de `idx_cuenta_lineas_cuenta`.
 * **Va junto con aquel o no va.**
 *
 * `estado` y no solo `tenant_id` porque el filtro selectivo es justamente ese:
 * de 8.031 cuentas del tenant, 31 están abiertas.
 */
@Index('idx_cuentas_estado', ['tenantId', 'estado'])
@Entity('cuentas')
export class Cuenta {
  @PrimaryGeneratedColumn('uuid', { name: 'cuenta_id' })
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'mesa_id', type: 'uuid' })
  mesaId: string;

  // Correlativo por tenant para identificar la cuenta ("Cuenta 85").
  @Column({ type: 'int' })
  numero: number;

  @Column({ type: 'text', nullable: true })
  nombre: string | null;

  @Column({ type: 'text', default: EstadoCuenta.ABIERTA })
  estado: EstadoCuenta;

  // Venta generada al cerrar la cuenta (null mientras está abierta/cancelada).
  @Column({ name: 'venta_id', type: 'uuid', nullable: true })
  ventaId: string | null;

  // Garzón que abrió la cuenta (identificado por PIN). Trazabilidad operativa.
  @Column({ name: 'garzon_apertura_id', type: 'uuid', nullable: true })
  garzonAperturaId: string | null;

  // Garzón responsable vigente. Cambia al transferir; D/E atribuyen a este ID.
  @Column({ name: 'garzon_responsable_id', type: 'uuid', nullable: true })
  garzonResponsableId: string | null;

  // Garzón que cerró la cuenta (identificado por PIN al generar la venta).
  @Column({ name: 'garzon_cierre_id', type: 'uuid', nullable: true })
  garzonCierreId: string | null;

  @Column({ name: 'abierta_el', type: 'timestamptz', default: () => 'now()' })
  abiertaEl: Date;

  @Column({ name: 'cerrada_el', type: 'timestamptz', nullable: true })
  cerradaEl: Date | null;

  @CreateDateColumn({ name: 'creado_el', type: 'timestamptz' })
  creadoEl: Date;

  @UpdateDateColumn({ name: 'actualizado_el', type: 'timestamptz' })
  actualizadoEl: Date;

  @DeleteDateColumn({ name: 'eliminado_el', type: 'timestamptz' })
  eliminadoEl: Date | null;
}
